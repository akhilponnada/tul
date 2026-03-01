/**
 * Tul Tool Runner - Handles entire tool call loop (Claude-inspired)
 *
 * Executes tools, supports parallel calls with Promise.all, sends results back,
 * loops until final text response. Emits events for monitoring.
 */

import type {
  FunctionCall,
  ToolCallResult,
  ToolCallHandler,
  ToolRunnerEvent,
  ToolRunnerEventListener,
  InternalToolDefinition,
  Content,
  ContentPart,
  ResolvedTulConfig,
  RequestStats,
  TulResponse,
  CacheEntry,
} from './types/index.js';
import { hashToolCall, validateAgainstSchema } from './utils/schema-utils.js';
import { getLogger } from './utils/logger.js';
import { deepClone } from './utils/helpers.js';

/** Maximum iterations to prevent runaway loops */
const MAX_TOOL_ITERATIONS = 10;

/**
 * Options for ToolRunner
 */
export interface ToolRunnerOptions {
  /** Tool definitions for validation */
  tools: InternalToolDefinition[];

  /** Handler function to execute tools */
  handler: ToolCallHandler;

  /** Function to send messages to Gemini and get response */
  sendToGemini: (messages: Content[]) => Promise<GeminiResponse>;

  /** Resolved configuration */
  config: ResolvedTulConfig;

  /** Initial conversation history */
  history?: Content[];

  /** Result cache (shared across requests) */
  cache?: Map<string, CacheEntry>;
}

/**
 * Response from Gemini API (simplified)
 */
export interface GeminiResponse {
  /** Raw response object */
  raw: unknown;

  /** Extracted function calls */
  functionCalls: FunctionCall[];

  /** Text content if any */
  text: string;

  /** Token usage */
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };

  /** Thought signature for Gemini 3+ */
  thoughtSignature?: string;
}

/**
 * Tool Runner - Manages the tool call loop
 */
export class ToolRunner {
  private tools: Map<string, InternalToolDefinition>;
  private handler: ToolCallHandler;
  private sendToGemini: (messages: Content[]) => Promise<GeminiResponse>;
  private config: ResolvedTulConfig;
  private history: Content[];
  private cache: Map<string, CacheEntry>;
  private listeners: ToolRunnerEventListener[] = [];
  private logger = getLogger().child('runner');

  // Loop detection state
  private callHistory: Array<{ name: string; argsHash: string }> = [];
  private identicalCallCounts: Map<string, number> = new Map();

  constructor(options: ToolRunnerOptions) {
    this.tools = new Map(options.tools.map((t) => [t.name, t]));
    this.handler = options.handler;
    this.sendToGemini = options.sendToGemini;
    this.config = options.config;
    this.history = options.history ? deepClone(options.history) : [];
    this.cache = options.cache ?? new Map();
  }

  /**
   * Add event listener
   */
  on(listener: ToolRunnerEventListener): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) this.listeners.splice(index, 1);
    };
  }

  /**
   * Emit event to all listeners
   */
  private emit(event: ToolRunnerEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        this.logger.warn('Event listener error:', error);
      }
    }
  }

  /**
   * Run the tool call loop until completion
   */
  async run(userMessage: string): Promise<TulResponse> {
    const stats: RequestStats = this.initStats();
    const toolCalls: ToolCallResult[] = [];
    const warnings: string[] = [];

    // Reset loop detection state
    this.callHistory = [];
    this.identicalCallCounts.clear();

    // Add user message to history
    this.history.push({
      role: 'user',
      parts: [{ text: userMessage }],
    });

    let iterations = 0;
    let finalText = '';
    let truncatedByLoop = false;
    let lastResponse: GeminiResponse | null = null;

    while (iterations < MAX_TOOL_ITERATIONS) {
      iterations++;
      this.logger.debug(`Tool loop iteration ${iterations}/${MAX_TOOL_ITERATIONS}`);

      // Send to Gemini
      const response = await this.sendToGemini(this.history);
      lastResponse = response;

      // Accumulate token usage
      if (response.usage) {
        stats.inputTokens += response.usage.inputTokens;
        stats.outputTokens += response.usage.outputTokens;
      }

      // Check for text-only response (done)
      if (response.functionCalls.length === 0) {
        finalText = response.text;
        this.logger.debug('Got final text response, loop complete');
        break;
      }

      // Check for loop detection
      if (this.config.loopDetection) {
        const loopResult = this.detectLoop(response.functionCalls);
        if (loopResult) {
          this.emit({ type: 'tool:loop', loopType: loopResult.type });
          stats.loopDetected = true;

          if (this.config.onLoop === 'break') {
            warnings.push(`Loop detected (${loopResult.type}): ${loopResult.reason}`);
            truncatedByLoop = true;
            finalText = response.text || '[Response truncated due to tool loop]';
            this.logger.warn(`Breaking loop: ${loopResult.reason}`);
            break;
          } else {
            warnings.push(`Loop warning (${loopResult.type}): ${loopResult.reason}`);
            this.logger.warn(`Loop warning: ${loopResult.reason}`);
          }
        }
      }

      // Execute all tool calls in parallel
      const results = await this.executeToolCalls(response.functionCalls, stats);
      toolCalls.push(...results);

      // Build function response message
      const functionResponseParts: ContentPart[] = results.map((result) => ({
        functionResponse: {
          name: result.name,
          response: result.result,
        },
      }));

      // Add model response and function responses to history
      this.history.push({
        role: 'model',
        parts: response.functionCalls.map((fc) => ({
          functionCall: fc,
        })),
      });

      this.history.push({
        role: 'function',
        parts: functionResponseParts,
      });

      stats.toolCallsMade += results.length;
    }

    // Check if we hit max iterations
    if (iterations >= MAX_TOOL_ITERATIONS && !truncatedByLoop) {
      warnings.push(`Reached maximum tool iterations (${MAX_TOOL_ITERATIONS})`);
      stats.loopDetected = true;
      truncatedByLoop = true;
      this.emit({ type: 'tool:loop', loopType: 'runaway' });
    }

    return {
      text: finalText,
      toolCalls,
      stats,
      raw: lastResponse?.raw,
      truncatedByLoop: truncatedByLoop || undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  /**
   * Execute multiple tool calls in parallel
   */
  private async executeToolCalls(
    functionCalls: FunctionCall[],
    stats: RequestStats
  ): Promise<ToolCallResult[]> {
    const results = await Promise.all(
      functionCalls.map((fc) => this.executeSingleToolCall(fc, stats))
    );
    return results;
  }

  /**
   * Execute a single tool call with caching, validation, and retry support
   */
  private async executeSingleToolCall(
    functionCall: FunctionCall,
    stats: RequestStats
  ): Promise<ToolCallResult> {
    const { name, args } = functionCall;
    const tool = this.tools.get(name);

    // Emit tool call event
    this.emit({ type: 'tool:call', name, args });
    this.logger.debug(`Executing tool: ${name}`, args);

    // Check cache first
    if (this.config.resultCaching && tool) {
      const cachedResult = this.checkCache(name, args, tool);
      if (cachedResult !== undefined) {
        stats.cacheHit = true;
        stats.cacheHits++;
        this.emit({ type: 'tool:cached', name, args });
        this.emit({ type: 'tool:result', name, result: cachedResult, cached: true });
        this.logger.debug(`Cache hit for ${name}`);

        return {
          name,
          args,
          result: cachedResult,
          cached: true,
          retries: 0,
          repaired: false,
          validationPassed: true,
        };
      }
    }

    // Track for loop detection
    const argsHash = hashToolCall(name, args);
    this.callHistory.push({ name, argsHash });
    this.identicalCallCounts.set(argsHash, (this.identicalCallCounts.get(argsHash) ?? 0) + 1);

    // Execute with retry logic
    let result: unknown;
    let retries = 0;
    let lastError: Error | undefined;

    const maxRetries = this.config.retryOnFailure ? this.config.maxRetries : 0;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        result = await this.handler(name, args);
        break;
      } catch (error) {
        lastError = error as Error;
        retries = attempt;

        if (attempt < maxRetries) {
          this.emit({ type: 'tool:retry', attempt: attempt + 1, reason: lastError.message });
          stats.retries++;
          this.logger.warn(`Tool ${name} failed, retrying (${attempt + 1}/${maxRetries}):`, lastError.message);

          // Apply retry delay
          await this.applyRetryDelay(attempt);
        }
      }
    }

    // If all retries failed, return error result
    if (result === undefined && lastError) {
      result = { error: lastError.message };
      this.logger.error(`Tool ${name} failed after ${retries} retries:`, lastError.message);
    }

    // Validate result if strict mode
    let validationPassed = true;
    let validationErrors: string[] | undefined;

    if (this.config.strictValidation && tool?.strict && tool.parameters) {
      const validation = validateAgainstSchema(result, tool.parameters);
      validationPassed = validation.valid;
      validationErrors = validation.errors;

      if (!validationPassed) {
        this.emit({ type: 'tool:validation:fail', name, errors: validation.errors });
        stats.validationFailed = true;
        this.logger.warn(`Validation failed for ${name}:`, validation.errors);

        if (this.config.onValidationError === 'throw') {
          throw new Error(`Validation failed for ${name}: ${validation.errors.join(', ')}`);
        }
      } else {
        this.emit({ type: 'tool:validation:pass', name });
      }
    }

    // Cache result if caching enabled
    if (this.config.resultCaching && tool && validationPassed) {
      this.cacheResult(name, args, result, tool);
    }

    this.emit({ type: 'tool:result', name, result, cached: false });

    return {
      name,
      args,
      result,
      cached: false,
      retries,
      repaired: false, // JSON repair happens in middleware
      validationPassed,
      validationErrors,
    };
  }

  /**
   * Check cache for a tool call result
   */
  private checkCache(
    name: string,
    args: Record<string, unknown>,
    tool: InternalToolDefinition
  ): unknown | undefined {
    const hash = hashToolCall(name, args);
    const entry = this.cache.get(hash);

    if (!entry) return undefined;

    const ttl = tool.cacheTTL ?? this.config.cacheTTL;
    const now = Date.now();

    if (now - entry.timestamp > ttl) {
      this.cache.delete(hash);
      return undefined;
    }

    return entry.result;
  }

  /**
   * Cache a tool call result
   */
  private cacheResult(
    name: string,
    args: Record<string, unknown>,
    result: unknown,
    tool: InternalToolDefinition
  ): void {
    const hash = hashToolCall(name, args);
    const ttl = tool.cacheTTL ?? this.config.cacheTTL;

    // Enforce max cache size (LRU-like: just clear oldest)
    if (this.cache.size >= this.config.cacheMaxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }

    this.cache.set(hash, {
      result,
      timestamp: Date.now(),
      ttl,
    });
  }

  /**
   * Apply retry delay based on config
   */
  private async applyRetryDelay(attempt: number): Promise<void> {
    if (this.config.retryDelay === 'none') return;

    const baseDelay = 1000; // 1 second
    let delay: number;

    if (this.config.retryDelay === 'exponential') {
      delay = baseDelay * Math.pow(2, attempt);
    } else {
      // linear
      delay = baseDelay * (attempt + 1);
    }

    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  /**
   * Detect tool call loops
   */
  private detectLoop(functionCalls: FunctionCall[]): { type: 'identical' | 'oscillation' | 'runaway'; reason: string } | null {
    // Check for identical calls
    for (const fc of functionCalls) {
      const hash = hashToolCall(fc.name, fc.args);
      const count = this.identicalCallCounts.get(hash) ?? 0;

      if (count >= this.config.maxIdenticalCalls) {
        return {
          type: 'identical',
          reason: `Tool "${fc.name}" called ${count + 1} times with identical arguments`,
        };
      }
    }

    // Check for oscillation (A -> B -> A -> B pattern)
    if (this.callHistory.length >= 4) {
      const recent = this.callHistory.slice(-4);
      const r0 = recent[0];
      const r1 = recent[1];
      const r2 = recent[2];
      const r3 = recent[3];
      if (
        r0 && r1 && r2 && r3 &&
        r0.argsHash === r2.argsHash &&
        r1.argsHash === r3.argsHash &&
        r0.argsHash !== r1.argsHash
      ) {
        return {
          type: 'oscillation',
          reason: `Oscillation detected between "${r0.name}" and "${r1.name}"`,
        };
      }
    }

    // Runaway is checked at the loop level (MAX_TOOL_ITERATIONS)
    return null;
  }

  /**
   * Initialize request statistics
   */
  private initStats(): RequestStats {
    return {
      inputTokens: 0,
      outputTokens: 0,
      tokensSaved: 0,
      toolsFiltered: 0,
      toolsSent: 0,
      examplesInjected: 0,
      exampleTokens: 0,
      compressionSaved: 0,
      cacheHit: false,
      cacheHits: 0,
      retries: 0,
      jsonRepaired: false,
      loopDetected: false,
      validationFailed: false,
      validationRecovered: false,
      contextCompactionSaved: 0,
      toolCallsMade: 0,
    };
  }

  /**
   * Get current conversation history
   */
  getHistory(): Content[] {
    return deepClone(this.history);
  }

  /**
   * Clear conversation history
   */
  clearHistory(): void {
    this.history = [];
    this.callHistory = [];
    this.identicalCallCounts.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; maxSize: number } {
    return {
      size: this.cache.size,
      maxSize: this.config.cacheMaxSize,
    };
  }

  /**
   * Clear the result cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}

/**
 * Create a tool runner instance
 */
export function createToolRunner(options: ToolRunnerOptions): ToolRunner {
  return new ToolRunner(options);
}

/**
 * Helper to extract function calls from Gemini response
 */
export function extractFunctionCalls(response: unknown): FunctionCall[] {
  // Handle @google/genai response structure
  const resp = response as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          functionCall?: FunctionCall;
        }>;
      };
    }>;
  };

  const functionCalls: FunctionCall[] = [];

  if (resp.candidates) {
    for (const candidate of resp.candidates) {
      if (candidate.content?.parts) {
        for (const part of candidate.content.parts) {
          if (part.functionCall) {
            functionCalls.push(part.functionCall);
          }
        }
      }
    }
  }

  return functionCalls;
}

/**
 * Helper to extract text from Gemini response
 */
export function extractText(response: unknown): string {
  const resp = response as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string;
        }>;
      };
    }>;
  };

  if (resp.candidates) {
    for (const candidate of resp.candidates) {
      if (candidate.content?.parts) {
        for (const part of candidate.content.parts) {
          if (part.text) {
            return part.text;
          }
        }
      }
    }
  }

  return '';
}

/**
 * Helper to extract usage from Gemini response
 */
export function extractUsage(response: unknown): { inputTokens: number; outputTokens: number } | undefined {
  const resp = response as {
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
    };
  };

  if (resp.usageMetadata) {
    return {
      inputTokens: resp.usageMetadata.promptTokenCount ?? 0,
      outputTokens: resp.usageMetadata.candidatesTokenCount ?? 0,
    };
  }

  return undefined;
}

/**
 * Build function response content for history
 */
export function buildFunctionResponseContent(results: ToolCallResult[]): Content {
  return {
    role: 'function',
    parts: results.map((result) => ({
      functionResponse: {
        name: result.name,
        response: result.result,
      },
    })),
  };
}

export default ToolRunner;
