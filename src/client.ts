/**
 * Tul Client - Claude-level tool calling for Gemini
 * Main entry point for the Tul library
 */

import type {
  TulConfig,
  ResolvedTulConfig,
  ToolDefinition,
  InternalToolDefinition,
  Content,
  ContentPart,
  FunctionCall,
  FunctionResponse,
  FunctionCallPart,
  FunctionResponsePart,
  TextPart,
  ThoughtPart,
  TulResponse,
  ToolCallResult,
  RequestStats,
  CumulativeStats,
  ToolCallHandler,
  ToolRunnerEvent,
  ToolRunnerEventListener,
  RequestContext,
  ResponseContext,
  Middleware,
  SuggestedTool,
} from './types/index.js';
import { TulError } from './types/index.js';
import { Logger, getLogger, setGlobalLogLevel, type LogLevel } from './utils/logger.js';
import { estimateTokens, hashToolCall, validateAgainstSchema } from './utils/schema-utils.js';
import { tokenize, removeStopwords, deepClone, deepMerge } from './utils/helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: Omit<ResolvedTulConfig, 'apiKey' | 'model'> = {
  // Feature toggles (all default to true)
  toolFiltering: true,
  schemaCompression: true,
  exampleInjection: true,
  strictValidation: true,
  loopDetection: true,
  retryOnFailure: true,
  jsonRepair: true,
  resultCaching: true,
  contextManagement: true,
  thoughtSignatures: true,

  // Tool filtering config
  maxToolsPerRequest: 5,
  minToolsToSend: 3,
  filterThreshold: 0.3,
  alwaysIncludeTools: [],
  confidenceThreshold: 0.5,

  // Schema compression config
  compressionLevel: 'moderate',
  enhanceDescriptions: false,

  // Strict validation config
  onValidationError: 'retry',

  // Loop detection config
  maxToolCallsPerTurn: 10,
  maxIdenticalCalls: 2,
  onLoop: 'break',

  // Retry config
  maxRetries: 3,
  retryDelay: 'linear',
  retryWithExpandedTools: true,
  maxExpandedToolRetries: 2,

  // Cache config
  cacheTTL: 300000, // 5 minutes
  cacheMaxSize: 100,

  // Context management config
  maxContextTokens: 80000,
  turnsToKeepFull: 3,
  compactionStrategy: 'summarize',

  // Logging config
  verbose: false,
  logLevel: 'warn',

  // Tool calling mode config
  forceToolCalling: false,
};

/**
 * Optimized system prompt that helps Gemini use tools more effectively
 * Inspired by Claude's tool calling behavior
 */
const OPTIMIZED_SYSTEM_PROMPT = `You are an AI assistant with access to tools. Your PRIMARY function is to use these tools to help users.

## Core Principles

1. PREFER TOOLS OVER REFUSING - When a user request CAN be fulfilled by an available tool, you MUST call that tool. Never say "I can't do that" if a tool exists for it.
2. WHEN UNCERTAIN, USE THE CLOSEST MATCH - If you're not 100% sure which tool to use, pick the one that best matches the user's intent. An imperfect tool call is better than no tool call.
3. CALL TOOLS DIRECTLY - Don't ask permission or explain what you'll do. Just call the tool immediately.
4. PICK THE MOST SPECIFIC TOOL - If multiple tools seem applicable, pick the one that most specifically matches the user's request.
5. MATCH ACTION VERBS - Prefer tools that match action verbs in the request (e.g., "translate" -> translate_text, "convert" -> convert_currency, "delete" -> delete_*, "get" -> get_*).
6. USE MINIMAL CALLS - Accomplish the task with the fewest tool calls possible.
7. PROVIDE EXACT ARGUMENTS - Match the schema precisely. No extra fields, no missing required fields.
8. CHAIN WHEN NEEDED - If you need multiple tool results, call tools in sequence.
9. HANDLE ERRORS GRACEFULLY - If a tool fails, try an alternative approach or explain what went wrong.
10. RETURN RESULTS NATURALLY - After tool calls complete, synthesize results into a helpful response.

## Decision Rules

- If ANY tool can help fulfill the request, CALL IT
- If the request mentions an action (get, create, update, delete, send, etc.), there's likely a matching tool
- If you see words like "weather", "directions", "translate", "convert" - USE the corresponding tool
- If you're thinking "I could use X tool but..." - STOP and use the tool
- Synonyms and slang should trigger tools (e.g., "nuke" = delete, "fire up" = start, "zap" = stop)

## Reasoning Examples

Example 1: User asks "What's the weather in Tokyo?"
Reasoning: The user wants weather information for a location. This matches get_weather tool.
Action: Call get_weather with location="Tokyo"

Example 2: User asks "How do I get from Central Park to Times Square by walking?"
Reasoning: The user wants directions between two places using a specific mode. This matches get_directions tool.
Action: Call get_directions with origin="Central Park", destination="Times Square", mode="walking"

Example 3: User asks "Convert 100 USD to EUR"
Reasoning: The user wants currency conversion. The verb "convert" and currency codes indicate convert_currency tool.
Action: Call convert_currency with amount=100, from="USD", to="EUR"

Example 4: User asks "Translate 'hello' to Spanish"
Reasoning: The user wants text translation. The verb "translate" clearly indicates translate_text tool.
Action: Call translate_text with text="hello", target_language="Spanish"

Example 5: User asks "Add a meeting with John tomorrow at 3pm"
Reasoning: The user wants to create a calendar event. The verb "add" with "meeting" indicates create_calendar_event tool.
Action: Call create_calendar_event with appropriate parameters.

Example 6: User asks "I'll nuke the old configs"
Reasoning: "nuke" is slang for delete. User wants to remove configs. This matches delete_config or clear_config tool.
Action: Call the appropriate delete/clear tool for configs.

## Do NOT:
- Ask "Should I call X?" - just call it
- Refuse to use a tool when it can help the user
- Say "I don't have access to..." when a relevant tool exists
- Explain limitations when a tool could help
- Repeat the same tool call with identical arguments
- Call tools in a loop without making progress
- Add fields not in the schema
- Omit required fields
- Explain what you're about to do instead of doing it

## REMEMBER: Your job is to CALL TOOLS. When in doubt, call a tool.`;

// ═══════════════════════════════════════════════════════════════════════════════
// Internal Tool Registry
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Simple internal tool registry
 */
class ToolRegistry {
  private tools: Map<string, InternalToolDefinition> = new Map();

  register(tool: ToolDefinition): InternalToolDefinition {
    const internal = this.toInternal(tool);
    this.tools.set(tool.name, internal);
    return internal;
  }

  get(name: string): InternalToolDefinition | undefined {
    return this.tools.get(name);
  }

  getAll(): InternalToolDefinition[] {
    return Array.from(this.tools.values());
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  clear(): void {
    this.tools.clear();
  }

  private toInternal(tool: ToolDefinition): InternalToolDefinition {
    // Extract keywords from name and description
    const nameTokens = tokenize(tool.name);
    const descTokens = tool.description ? tokenize(tool.description) : [];
    const keywords = removeStopwords([...nameTokens, ...descTokens]);

    // Extract keywords from parameter names and descriptions
    const paramKeywords: string[] = [];
    if (tool.parameters?.properties) {
      for (const [key, schema] of Object.entries(tool.parameters.properties)) {
        paramKeywords.push(...tokenize(key));
        if (schema.description) {
          paramKeywords.push(...tokenize(schema.description));
        }
      }
    }

    // Estimate token count
    const estimatedTokens = estimateTokens({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    });

    return {
      ...tool,
      keywords,
      paramKeywords: removeStopwords(paramKeywords),
      estimatedTokens,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Simple Result Cache
// ═══════════════════════════════════════════════════════════════════════════════

interface CacheEntry {
  result: unknown;
  timestamp: number;
  ttl: number;
}

class ResultCache {
  private cache: Map<string, CacheEntry> = new Map();
  private maxSize: number;

  constructor(maxSize = 100) {
    this.maxSize = maxSize;
  }

  get(key: string): unknown | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // Check TTL
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.result;
  }

  set(key: string, result: unknown, ttl: number): void {
    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, {
      result,
      timestamp: Date.now(),
      ttl,
    });
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Stats Tracker
// ═══════════════════════════════════════════════════════════════════════════════

class StatsTracker {
  private cumulative: CumulativeStats = {
    totalRequests: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    estimatedBaselineTokens: 0,
    tokensSaved: 0,
    percentSaved: 0,
    toolCallsMade: 0,
    toolCallsSucceeded: 0,
    toolCallsFailed: 0,
    failuresRecovered: 0,
    schemaViolationsCaught: 0,
    schemaViolationsRecovered: 0,
    loopsPrevented: 0,
    cacheHits: 0,
    cacheMisses: 0,
    avgToolsPerRequest: 0,
    totalToolsFiltered: 0,
  };

  private toolsSentHistory: number[] = [];

  recordRequest(stats: RequestStats, toolsSent: number): void {
    this.cumulative.totalRequests++;
    this.cumulative.totalInputTokens += stats.inputTokens;
    this.cumulative.totalOutputTokens += stats.outputTokens;
    this.cumulative.tokensSaved += stats.tokensSaved;
    this.cumulative.toolCallsMade += stats.toolCallsMade;
    this.cumulative.totalToolsFiltered += stats.toolsFiltered;

    if (stats.cacheHit) {
      this.cumulative.cacheHits += stats.cacheHits;
    } else {
      this.cumulative.cacheMisses++;
    }

    if (stats.loopDetected) {
      this.cumulative.loopsPrevented++;
    }

    if (stats.validationFailed) {
      this.cumulative.schemaViolationsCaught++;
      if (stats.validationRecovered) {
        this.cumulative.schemaViolationsRecovered++;
      }
    }

    this.cumulative.failuresRecovered += stats.retries;

    // Track tools sent for average
    this.toolsSentHistory.push(toolsSent);
    this.cumulative.avgToolsPerRequest =
      this.toolsSentHistory.reduce((a, b) => a + b, 0) / this.toolsSentHistory.length;

    // Calculate percent saved
    const totalTokens = this.cumulative.totalInputTokens + this.cumulative.totalOutputTokens;
    this.cumulative.estimatedBaselineTokens = totalTokens + this.cumulative.tokensSaved;
    this.cumulative.percentSaved =
      this.cumulative.estimatedBaselineTokens > 0
        ? (this.cumulative.tokensSaved / this.cumulative.estimatedBaselineTokens) * 100
        : 0;
  }

  recordToolSuccess(): void {
    this.cumulative.toolCallsSucceeded++;
  }

  recordToolFailure(): void {
    this.cumulative.toolCallsFailed++;
  }

  getStats(): CumulativeStats {
    return { ...this.cumulative };
  }

  reset(): void {
    this.cumulative = {
      totalRequests: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      estimatedBaselineTokens: 0,
      tokensSaved: 0,
      percentSaved: 0,
      toolCallsMade: 0,
      toolCallsSucceeded: 0,
      toolCallsFailed: 0,
      failuresRecovered: 0,
      schemaViolationsCaught: 0,
      schemaViolationsRecovered: 0,
      loopsPrevented: 0,
      cacheHits: 0,
      cacheMisses: 0,
      avgToolsPerRequest: 0,
      totalToolsFiltered: 0,
    };
    this.toolsSentHistory = [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main Tul Client
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Tul - Claude-level tool calling for Gemini
 *
 * @example
 * ```typescript
 * import { Tul } from 'tul';
 *
 * const tul = new Tul({
 *   apiKey: process.env.GOOGLE_AI_API_KEY,
 *   model: 'gemini-2.5-flash',
 * });
 *
 * // Register tools
 * tul.registerTools([
 *   {
 *     name: 'get_weather',
 *     description: 'Get current weather for a location',
 *     parameters: {
 *       type: 'object',
 *       properties: {
 *         location: { type: 'string', description: 'City name' },
 *       },
 *       required: ['location'],
 *     },
 *     examples: [{ location: 'San Francisco' }],
 *   },
 * ]);
 *
 * // Handle tool calls
 * tul.onToolCall(async (name, args) => {
 *   if (name === 'get_weather') {
 *     return { temp: 72, condition: 'sunny' };
 *   }
 * });
 *
 * // Chat
 * const response = await tul.chat("What's the weather in SF?");
 * console.log(response.text);
 * console.log('Tokens saved:', response.stats.tokensSaved);
 * ```
 */
export class Tul {
  private config: ResolvedTulConfig;
  private logger: Logger;
  private toolRegistry: ToolRegistry;
  private resultCache: ResultCache;
  private statsTracker: StatsTracker;
  private toolHandler: ToolCallHandler | null = null;
  private eventListeners: ToolRunnerEventListener[] = [];
  private conversationHistory: Content[] = [];
  private middleware: Middleware[] = [];
  private recentlyUsedTools: string[] = [];
  private storedThoughtSignature?: string;
  private genAI: unknown = null;
  private model: unknown = null;

  constructor(config: TulConfig) {
    // Resolve config with defaults
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      alwaysIncludeTools: config.alwaysIncludeTools ?? [],
    } as ResolvedTulConfig;

    // Initialize logger
    setGlobalLogLevel(this.config.logLevel);
    this.logger = getLogger();

    if (this.config.verbose) {
      this.logger.setLevel('debug');
    }

    // Initialize components
    this.toolRegistry = new ToolRegistry();
    this.resultCache = new ResultCache(this.config.cacheMaxSize);
    this.statsTracker = new StatsTracker();

    this.logger.debug('Tul client initialized', {
      model: this.config.model,
      features: this.getEnabledFeatures(),
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Public API
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Register tools for the AI to use
   */
  registerTools(tools: ToolDefinition[]): void {
    for (const tool of tools) {
      const internal = this.toolRegistry.register(tool);
      this.logger.debug(`Registered tool: ${tool.name}`, {
        estimatedTokens: internal.estimatedTokens,
        keywords: internal.keywords.slice(0, 5),
      });
    }

    this.logger.info(`Registered ${tools.length} tools`);
  }

  /**
   * Set the tool call handler
   */
  onToolCall(handler: ToolCallHandler): void {
    this.toolHandler = handler;
  }

  /**
   * Add an event listener for tool events
   */
  on(listener: ToolRunnerEventListener): void {
    this.eventListeners.push(listener);
  }

  /**
   * Remove an event listener
   */
  off(listener: ToolRunnerEventListener): void {
    const index = this.eventListeners.indexOf(listener);
    if (index !== -1) {
      this.eventListeners.splice(index, 1);
    }
  }

  /**
   * Chat with the model (conversational mode)
   * Maintains conversation history automatically
   */
  async chat(message: string): Promise<TulResponse> {
    // Add user message to history
    this.conversationHistory.push({
      role: 'user',
      parts: [{ text: message }],
    });

    try {
      const response = await this.generateContentInternal(message, this.conversationHistory);

      // Add model response to history
      if (response.text) {
        this.conversationHistory.push({
          role: 'model',
          parts: [{ text: response.text }],
        });
      }

      return response;
    } catch (error) {
      // Remove failed user message from history
      this.conversationHistory.pop();
      throw error;
    }
  }

  /**
   * Generate content (single-turn mode)
   * Does not maintain conversation history
   */
  async generateContent(message: string): Promise<TulResponse> {
    return this.generateContentInternal(message, []);
  }

  /**
   * Get cumulative statistics
   */
  getStats(): CumulativeStats {
    return this.statsTracker.getStats();
  }

  /**
   * Reset cumulative statistics
   */
  resetStats(): void {
    this.statsTracker.reset();
    this.logger.info('Statistics reset');
  }

  /**
   * Clear the result cache
   */
  clearCache(): void {
    this.resultCache.clear();
    this.logger.info('Cache cleared');
  }

  /**
   * Get conversation history
   */
  getConversationHistory(): Content[] {
    return deepClone(this.conversationHistory);
  }

  /**
   * Clear conversation history
   */
  clearConversation(): void {
    this.conversationHistory = [];
    this.recentlyUsedTools = [];
    this.storedThoughtSignature = undefined;
    this.logger.info('Conversation cleared');
  }

  /**
   * Add custom middleware
   */
  use(middleware: Middleware): void {
    this.middleware.push(middleware);
    this.logger.debug(`Added middleware: ${middleware.name}`);
  }

  /**
   * Get list of registered tools
   */
  getTools(): ToolDefinition[] {
    return this.toolRegistry.getAll().map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
      examples: t.examples,
      strict: t.strict,
      cacheTTL: t.cacheTTL,
    }));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Internal Methods
  // ═══════════════════════════════════════════════════════════════════════════

  private getEnabledFeatures(): string[] {
    const features: string[] = [];
    if (this.config.toolFiltering) features.push('toolFiltering');
    if (this.config.schemaCompression) features.push('schemaCompression');
    if (this.config.exampleInjection) features.push('exampleInjection');
    if (this.config.strictValidation) features.push('strictValidation');
    if (this.config.loopDetection) features.push('loopDetection');
    if (this.config.retryOnFailure) features.push('retryOnFailure');
    if (this.config.jsonRepair) features.push('jsonRepair');
    if (this.config.resultCaching) features.push('resultCaching');
    if (this.config.contextManagement) features.push('contextManagement');
    if (this.config.thoughtSignatures) features.push('thoughtSignatures');
    return features;
  }

  private async generateContentInternal(
    userMessage: string,
    history: Content[]
  ): Promise<TulResponse> {
    const startTime = Date.now();

    // Initialize per-request stats
    const stats: Partial<RequestStats> = {
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

    // Get all tools
    const allTools = this.toolRegistry.getAll();
    let filteredTools = allTools;

    // Tool filtering
    if (this.config.toolFiltering && allTools.length > this.config.maxToolsPerRequest) {
      filteredTools = this.filterTools(userMessage, allTools);
      stats.toolsFiltered = allTools.length - filteredTools.length;
      stats.tokensSaved = this.calculateTokensSaved(allTools, filteredTools);
    }

    stats.toolsSent = filteredTools.length;

    // Build system prompt
    let systemPrompt = OPTIMIZED_SYSTEM_PROMPT;
    if (this.config.systemPrompt) {
      systemPrompt = `${this.config.systemPrompt}\n\n${OPTIMIZED_SYSTEM_PROMPT}`;
    }

    // Inject examples if enabled
    if (this.config.exampleInjection) {
      const { prompt: enhancedPrompt, examplesAdded, tokensUsed } =
        this.injectExamples(systemPrompt, filteredTools);
      systemPrompt = enhancedPrompt;
      stats.examplesInjected = examplesAdded;
      stats.exampleTokens = tokensUsed;
    }

    // Prepare the request context
    const requestContext: RequestContext = {
      messages: history,
      tools: allTools,
      filteredTools,
      systemPrompt,
      userMessage,
      config: this.config,
      metadata: {},
      stats,
      recentlyUsedTools: this.recentlyUsedTools,
      thoughtSignature: this.storedThoughtSignature,
    };

    // Run beforeRequest middleware
    const processedContext = await this.runBeforeRequestMiddleware(requestContext);

    // Make API call
    const toolCalls: ToolCallResult[] = [];
    let finalText = '';
    let rawResponse: unknown = null;
    const warnings: string[] = [];
    let truncatedByLoop = false;

    try {
      // Simulate API call (in production, this would use @google/genai)
      const apiResult = await this.callGeminiAPI(
        processedContext.systemPrompt,
        processedContext.messages,
        processedContext.userMessage,
        processedContext.filteredTools
      );

      rawResponse = apiResult.raw;
      let functionCalls = apiResult.functionCalls;
      let functionCallParts = apiResult.functionCallParts;
      finalText = apiResult.text;

      // Extract thought signature if present
      if (apiResult.thoughtSignature) {
        this.storedThoughtSignature = apiResult.thoughtSignature;
      }


      // Retry with expanded tools if model returned text but no tool calls
      // and we had filtered out tools that might be relevant
      if (
        this.config.retryWithExpandedTools &&
        functionCalls.length === 0 &&
        finalText.length > 0 &&
        stats.toolsFiltered! > 0
      ) {
        let expandedToolRetries = 0;
        let currentFilteredTools = processedContext.filteredTools;
        const maxExpandedRetries = this.config.maxExpandedToolRetries;

        while (
          functionCalls.length === 0 &&
          expandedToolRetries < maxExpandedRetries &&
          currentFilteredTools.length < allTools.length
        ) {
          expandedToolRetries++;
          this.logger.debug(`Retrying with expanded tool set (attempt ${expandedToolRetries}/${maxExpandedRetries})`);

          // Expand the tool set - double the limit or add all remaining tools
          const newLimit = Math.min(
            currentFilteredTools.length * 2,
            allTools.length
          );

          // Re-filter with expanded limit
          const expandedTools = this.filterToolsWithLimit(userMessage, allTools, newLimit);

          // Only retry if we actually have more tools
          if (expandedTools.length <= currentFilteredTools.length) {
            this.logger.debug('No additional tools available for retry');
            break;
          }

          currentFilteredTools = expandedTools;
          stats.retries = (stats.retries ?? 0) + 1;

          // Update stats
          stats.toolsSent = currentFilteredTools.length;
          stats.toolsFiltered = allTools.length - currentFilteredTools.length;
          stats.tokensSaved = this.calculateTokensSaved(allTools, currentFilteredTools);

          // Make another API call with expanded tools
          const retryResult = await this.callGeminiAPI(
            processedContext.systemPrompt,
            processedContext.messages,
            processedContext.userMessage,
            currentFilteredTools
          );

          rawResponse = retryResult.raw;
          functionCalls = retryResult.functionCalls;
          functionCallParts = retryResult.functionCallParts;
          finalText = retryResult.text;

          if (retryResult.thoughtSignature) {
            this.storedThoughtSignature = retryResult.thoughtSignature;
          }

          this.logger.debug(`Expanded tool retry result: ${functionCalls.length} function calls, text length: ${finalText.length}`);
        }

        if (expandedToolRetries > 0 && functionCalls.length > 0) {
          this.logger.info(`Successfully triggered tool call after ${expandedToolRetries} expanded retries`);
        }
      }

      // Process function calls
      let turnCallCount = 0;
      const callSignatures = new Map<string, number>();

      while (functionCalls.length > 0) {
        stats.toolCallsMade = (stats.toolCallsMade ?? 0) + functionCalls.length;
        turnCallCount += functionCalls.length;

        // Loop detection
        if (this.config.loopDetection) {
          if (turnCallCount > this.config.maxToolCallsPerTurn) {
            stats.loopDetected = true;
            truncatedByLoop = true;
            warnings.push(`Loop detected: exceeded ${this.config.maxToolCallsPerTurn} tool calls per turn`);
            this.emit({ type: 'tool:loop', loopType: 'runaway' });
            break;
          }

          // Check for identical calls
          for (const fc of functionCalls) {
            const sig = hashToolCall(fc.name, fc.args);
            const count = (callSignatures.get(sig) ?? 0) + 1;
            callSignatures.set(sig, count);

            if (count > this.config.maxIdenticalCalls) {
              stats.loopDetected = true;
              truncatedByLoop = true;
              warnings.push(`Loop detected: identical call to ${fc.name} repeated ${count} times`);
              this.emit({ type: 'tool:loop', loopType: 'identical' });
              break;
            }
          }

          if (truncatedByLoop && this.config.onLoop === 'break') {
            break;
          }
        }

        // Execute tool calls
        const results: ToolCallResult[] = [];
        for (const fc of functionCalls) {
          const result = await this.executeToolCall(fc, stats);
          results.push(result);
          toolCalls.push(result);

          // Track recently used tools
          if (!this.recentlyUsedTools.includes(fc.name)) {
            this.recentlyUsedTools.unshift(fc.name);
            if (this.recentlyUsedTools.length > 5) {
              this.recentlyUsedTools.pop();
            }
          }
        }

        // Send results back to model (pass functionCallParts with thought signatures)
        const continuationResult = await this.sendToolResults(
          processedContext.systemPrompt,
          processedContext.messages,
          processedContext.userMessage,
          processedContext.filteredTools,
          functionCallParts,
          results
        );

        rawResponse = continuationResult.raw;
        functionCalls = continuationResult.functionCalls;
        functionCallParts = continuationResult.functionCallParts;
        finalText = continuationResult.text;

        if (continuationResult.thoughtSignature) {
          this.storedThoughtSignature = continuationResult.thoughtSignature;
        }
      }

      // Estimate token usage
      stats.inputTokens = estimateTokens([
        processedContext.systemPrompt,
        processedContext.userMessage,
        ...processedContext.filteredTools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })),
      ]);
      stats.outputTokens = estimateTokens(finalText) + estimateTokens(toolCalls);

    } catch (error) {
      this.logger.error('API call failed', error);
      throw error;
    }

    // Record stats
    const completeStats: RequestStats = {
      inputTokens: stats.inputTokens ?? 0,
      outputTokens: stats.outputTokens ?? 0,
      tokensSaved: stats.tokensSaved ?? 0,
      toolsFiltered: stats.toolsFiltered ?? 0,
      toolsSent: stats.toolsSent ?? 0,
      examplesInjected: stats.examplesInjected ?? 0,
      exampleTokens: stats.exampleTokens ?? 0,
      compressionSaved: stats.compressionSaved ?? 0,
      cacheHit: stats.cacheHit ?? false,
      cacheHits: stats.cacheHits ?? 0,
      retries: stats.retries ?? 0,
      jsonRepaired: stats.jsonRepaired ?? false,
      loopDetected: stats.loopDetected ?? false,
      validationFailed: stats.validationFailed ?? false,
      validationRecovered: stats.validationRecovered ?? false,
      contextCompactionSaved: stats.contextCompactionSaved ?? 0,
      toolCallsMade: stats.toolCallsMade ?? 0,
    };

    this.statsTracker.recordRequest(completeStats, stats.toolsSent ?? 0);

    // Analyze suggested tools when model returns text without making tool calls
    let suggestedTools: SuggestedTool[] | undefined;
    if (toolCalls.length === 0 && finalText && processedContext.filteredTools.length > 0) {
      suggestedTools = this.analyzeSuggestedTools(
        processedContext.userMessage,
        processedContext.filteredTools
      );
    }

    const response: TulResponse = {
      text: finalText,
      toolCalls,
      stats: completeStats,
      raw: rawResponse,
      truncatedByLoop,
      warnings: warnings.length > 0 ? warnings : undefined,
      suggestedTools,
    };

    this.logger.debug('Request completed', {
      duration: Date.now() - startTime,
      toolCalls: toolCalls.length,
      tokensSaved: completeStats.tokensSaved,
      suggestedTools: suggestedTools?.length ?? 0,
    });

    return response;
  }

  private filterTools(
    query: string,
    tools: InternalToolDefinition[]
  ): InternalToolDefinition[] {
    // Intent patterns for common phrases
    const intentPatterns: Array<{ pattern: RegExp; tools: string[]; boost: number }> = [
      // Directions/Navigation
      { pattern: /\b(get|go|travel|walk|drive|directions?|route|navigate)\b.*\b(from|to)\b/i, tools: ['get_directions', 'directions'], boost: 0.8 },
      { pattern: /\b(from)\b.*\b(to)\b.*\b(by|on|via)\s*(foot|walk|car|bus|train|transit|bike)/i, tools: ['get_directions', 'directions'], boost: 0.9 },
      { pattern: /\bhow\s+(do\s+i\s+)?(get|go)\s+(to|from)/i, tools: ['get_directions', 'directions'], boost: 0.8 },
      // Weather
      { pattern: /\b(weather|temperature|forecast)\b/i, tools: ['get_weather', 'get_current_weather', 'weather'], boost: 0.8 },
      // Currency
      { pattern: /\b(convert|exchange)\b.*\b(currency|USD|EUR|GBP|JPY)\b/i, tools: ['convert_currency', 'currency'], boost: 0.8 },
      { pattern: /\b\d+\s*(USD|EUR|GBP|JPY)\s+(in|to)\b/i, tools: ['convert_currency', 'currency'], boost: 0.9 },
      // Calendar
      { pattern: /\b(schedule|book|create|add)\b.*\b(meeting|appointment|event|calendar)\b/i, tools: ['create_calendar_event', 'calendar'], boost: 0.8 },
      // Todo
      { pattern: /\b(add|create)\b.*\b(todo|task|reminder)\b/i, tools: ['manage_todo', 'todo'], boost: 0.8 },
      // Translation
      { pattern: /\btranslate\b/i, tools: ['translate_text', 'translate'], boost: 0.9 },
      // Stock
      { pattern: /\b(stock|price)\b.*\b[A-Z]{2,5}\b/i, tools: ['get_stock_price', 'stock'], boost: 0.8 },
    ];

    // Synonyms for expansion
    const synonyms: Record<string, string[]> = {
      'directions': ['route', 'way', 'path', 'navigate', 'go', 'get', 'travel'],
      'walking': ['foot', 'walk', 'on foot', 'by foot'],
      'weather': ['forecast', 'temperature', 'climate'],
      'convert': ['exchange', 'change'],
    };

    // Expand query with synonyms
    let expandedQuery = query.toLowerCase();
    for (const [term, syns] of Object.entries(synonyms)) {
      for (const syn of syns) {
        if (expandedQuery.includes(syn)) {
          expandedQuery += ` ${term}`;
          break;
        }
      }
    }

    const queryTokens = new Set(removeStopwords(tokenize(expandedQuery)));

    // Score each tool with confidence calculation
    const scored = tools.map((tool) => {
      // Always include tools get max score and confidence
      if (this.config.alwaysIncludeTools.includes(tool.name)) {
        return { tool, score: 1000, confidence: 1.0 };
      }

      const { score, confidence } = this.calculateToolConfidence(
        tool,
        query,
        expandedQuery,
        queryTokens,
        intentPatterns
      );

      return { tool, score, confidence };
    });

    // Sort by score (descending)
    scored.sort((a, b) => b.score - a.score);

    // Get top tool confidence to determine filtering behavior
    const topConfidence = scored.length > 0 ? (scored[0]?.confidence ?? 0) : 0;
    const confidenceThreshold = this.config.confidenceThreshold;

    // Determine how many tools to include based on confidence
    let toolLimit = this.config.maxToolsPerRequest;

    // If confidence is below threshold, expand tool set proportionally
    if (topConfidence < confidenceThreshold && confidenceThreshold > 0) {
      // Low confidence: expand tool set proportionally
      // At confidence 0, double the limit; at threshold, use normal limit
      const expansionFactor = 1 + (1 - topConfidence / confidenceThreshold);
      toolLimit = Math.min(
        Math.ceil(this.config.maxToolsPerRequest * expansionFactor),
        tools.length // Don't exceed total tools
      );

      this.logger.debug(`Low confidence (${topConfidence.toFixed(2)}), expanding tool limit from ${this.config.maxToolsPerRequest} to ${toolLimit}`);
    }

    // Filter by threshold and expanded limit
    let filtered = scored
      .filter((s) => s.score >= this.config.filterThreshold ||
                     this.config.alwaysIncludeTools.includes(s.tool.name))
      .slice(0, toolLimit)
      .map((s) => s.tool);

    // Ensure minimum tools guarantee: if filtering removed too many tools,
    // add back the next-highest-scored tools until we reach minToolsToSend
    const minTools = Math.min(this.config.minToolsToSend, tools.length);
    if (filtered.length < minTools && scored.length > filtered.length) {
      const filteredNames = new Set(filtered.map((t) => t.name));
      const additionalTools = scored
        .filter((s) => !filteredNames.has(s.tool.name))
        .slice(0, minTools - filtered.length)
        .map((s) => s.tool);
      filtered = [...filtered, ...additionalTools];

      this.logger.debug(`Applied minimum tools guarantee: added ${additionalTools.length} tools`, {
        added: additionalTools.map((t) => t.name),
      });
    }

    this.logger.debug(`Filtered tools: ${tools.length} -> ${filtered.length}`, {
      kept: filtered.map((t) => t.name),
    });

    return filtered;
  }

  /**
   * Calculate confidence score for a tool based on multiple factors.
   * Returns both a raw score (for sorting) and a normalized confidence value (0-1).
   *
   * Confidence is calculated from:
   * - Intent pattern matches (strongest signal)
   * - Direct keyword matches
   * - Parameter keyword matches
   * - Description similarity
   */
  private calculateToolConfidence(
    tool: InternalToolDefinition,
    query: string,
    expandedQuery: string,
    queryTokens: Set<string>,
    intentPatterns: Array<{ pattern: RegExp; tools: string[]; boost: number }>
  ): { score: number; confidence: number } {
    let score = 0;
    let matchFactors = 0; // Track number of matching factors for confidence
    const maxPossibleFactors = 4; // intent, keywords, paramKeywords, descriptionSimilarity

    const lowerToolName = tool.name.toLowerCase();

    // Factor 1: Intent pattern matching (strongest signal)
    let intentMatched = false;
    for (const { pattern, tools: targetTools, boost } of intentPatterns) {
      if (pattern.test(query)) {
        for (const target of targetTools) {
          if (lowerToolName.includes(target) || target.includes(lowerToolName.replace(/_/g, ''))) {
            score = Math.max(score, boost);
            intentMatched = true;
            matchFactors++;
            break;
          }
        }
        if (intentMatched) break;
      }
    }

    // Factor 2: Recently used boost (moderate signal, doesn't count toward confidence)
    const recentIndex = this.recentlyUsedTools.indexOf(tool.name);
    if (recentIndex !== -1) {
      score += (5 - recentIndex) * 0.1; // 0.5 to 0.1 boost
    }

    // Factor 3: Direct keyword matching (good signal)
    let keywordMatchCount = 0;
    let paramKeywordMatchCount = 0;

    for (const token of queryTokens) {
      // Exact keyword match in tool keywords
      if (tool.keywords.includes(token)) {
        score += 0.3;
        keywordMatchCount++;
      }

      // Parameter keyword match
      if (tool.paramKeywords.includes(token)) {
        score += 0.2;
        paramKeywordMatchCount++;
      }

      // Partial match (substring) - contributes to score but not confidence
      for (const keyword of tool.keywords) {
        if (keyword.includes(token) || token.includes(keyword)) {
          score += 0.1;
        }
      }
    }

    if (keywordMatchCount > 0) matchFactors++;
    if (paramKeywordMatchCount > 0) matchFactors++;

    // Factor 4: Description similarity using word overlap
    const descriptionSimilarity = this.calculateDescriptionSimilarity(
      expandedQuery,
      tool.description || ''
    );
    if (descriptionSimilarity > 0.2) {
      score += descriptionSimilarity * 0.5; // Up to 0.5 boost
      matchFactors++;
    }

    // Calculate normalized confidence value (0-1)
    // Based on: how many factors matched and their quality
    const factorConfidence = matchFactors / maxPossibleFactors;

    // Cap score at 1.0 for confidence calculation (raw score can exceed for sorting)
    const scoreConfidence = Math.min(score, 1.0);

    // Combined confidence: weighted average of factor coverage and score magnitude
    const confidenceValue = (factorConfidence * 0.4 + scoreConfidence * 0.6);

    return {
      score,
      confidence: Math.min(confidenceValue, 1.0),
    };
  }

  /**
   * Calculate description similarity using word overlap (Jaccard-like).
   */
  private calculateDescriptionSimilarity(query: string, description: string): number {
    if (!description) return 0;

    const queryWords = new Set(removeStopwords(tokenize(query.toLowerCase())));
    const descWords = new Set(removeStopwords(tokenize(description.toLowerCase())));

    if (queryWords.size === 0 || descWords.size === 0) return 0;

    // Count intersection
    let intersection = 0;
    for (const word of queryWords) {
      if (descWords.has(word)) {
        intersection++;
      }
    }

    // Jaccard similarity: intersection / union
    const union = queryWords.size + descWords.size - intersection;
    return union > 0 ? intersection / union : 0;
  }

  /**
   * Filter tools with a custom limit (used for retry with expanded tool set)
   */
  private filterToolsWithLimit(
    query: string,
    tools: InternalToolDefinition[],
    limit: number
  ): InternalToolDefinition[] {
    // Save the original limit
    const originalLimit = this.config.maxToolsPerRequest;

    // Temporarily override the limit
    (this.config as any).maxToolsPerRequest = limit;

    // Run normal filter
    const filtered = this.filterTools(query, tools);

    // Restore original limit
    (this.config as any).maxToolsPerRequest = originalLimit;

    return filtered;
  }

  /**
   * Analyze which tools might be suggested based on the query
   * Used to provide hints when the model doesn't call any tools
   */
  private analyzeSuggestedTools(
    query: string,
    availableTools: InternalToolDefinition[]
  ): SuggestedTool[] {
    const queryTokens = new Set(removeStopwords(tokenize(query.toLowerCase())));
    const suggestions: SuggestedTool[] = [];

    for (const tool of availableTools) {
      let confidence = 0;

      // Check keyword overlap
      for (const token of queryTokens) {
        if (tool.keywords.includes(token)) {
          confidence += 0.3;
        }
        if (tool.paramKeywords.includes(token)) {
          confidence += 0.2;
        }
      }

      if (confidence > 0.2) {
        suggestions.push({
          name: tool.name,
          confidence: Math.min(confidence, 1),
          reason: `Matched keywords: ${[...queryTokens].filter(t =>
            tool.keywords.includes(t) || tool.paramKeywords.includes(t)
          ).join(', ')}`,
        });
      }
    }

    // Sort by confidence and take top 3
    return suggestions
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 3);
  }

  private calculateTokensSaved(
    all: InternalToolDefinition[],
    filtered: InternalToolDefinition[]
  ): number {
    const allTokens = all.reduce((sum, t) => sum + t.estimatedTokens, 0);
    const filteredTokens = filtered.reduce((sum, t) => sum + t.estimatedTokens, 0);
    return allTokens - filteredTokens;
  }

  private injectExamples(
    systemPrompt: string,
    tools: InternalToolDefinition[]
  ): { prompt: string; examplesAdded: number; tokensUsed: number } {
    const toolsWithExamples = tools.filter((t) => t.examples && t.examples.length > 0);

    if (toolsWithExamples.length === 0) {
      return { prompt: systemPrompt, examplesAdded: 0, tokensUsed: 0 };
    }

    let examplesSection = '\n\nTool Usage Examples:\n';
    let examplesAdded = 0;

    for (const tool of toolsWithExamples) {
      if (!tool.examples) continue;

      for (const example of tool.examples.slice(0, 2)) { // Max 2 examples per tool
        examplesSection += `- ${tool.name}: ${JSON.stringify(example)}\n`;
        examplesAdded++;
      }
    }

    const tokensUsed = estimateTokens(examplesSection);

    return {
      prompt: systemPrompt + examplesSection,
      examplesAdded,
      tokensUsed,
    };
  }

  private async executeToolCall(
    fc: FunctionCall,
    stats: Partial<RequestStats>
  ): Promise<ToolCallResult> {
    const toolDef = this.toolRegistry.get(fc.name);

    // IMPORTANT: Validate that the tool actually exists in our registry
    // This catches cases where the model hallucinates non-existent tool names
    if (!toolDef) {
      this.logger.warn(`Model hallucinated non-existent tool: ${fc.name}`);
      this.emit({ type: 'tool:error', name: fc.name, error: `Tool "${fc.name}" does not exist` });

      // Return an error result so the model can correct itself
      return {
        name: fc.name,
        args: fc.args,
        result: { error: `Tool "${fc.name}" does not exist. Please use one of the available tools.` },
        cached: false,
        retries: 0,
        repaired: false,
        validationPassed: false,
      };
    }

    this.emit({ type: 'tool:call', name: fc.name, args: fc.args });

    // Check cache
    if (this.config.resultCaching) {
      const cacheKey = hashToolCall(fc.name, fc.args);
      const cached = this.resultCache.get(cacheKey);

      if (cached !== undefined) {
        stats.cacheHit = true;
        stats.cacheHits = (stats.cacheHits ?? 0) + 1;

        this.emit({ type: 'tool:cached', name: fc.name, args: fc.args });
        this.emit({ type: 'tool:result', name: fc.name, result: cached, cached: true });

        this.statsTracker.recordToolSuccess();

        return {
          name: fc.name,
          args: fc.args,
          result: cached,
          cached: true,
          retries: 0,
          repaired: false,
          validationPassed: true,
        };
      }
    }

    // Validate arguments if strict mode
    let validationPassed = true;
    let validationErrors: string[] = [];

    if (this.config.strictValidation && toolDef?.strict && toolDef.parameters) {
      const validation = validateAgainstSchema(fc.args, toolDef.parameters);
      validationPassed = validation.valid;
      validationErrors = validation.errors;

      if (!validationPassed) {
        stats.validationFailed = true;
        this.emit({ type: 'tool:validation:fail', name: fc.name, errors: validationErrors });

        if (this.config.onValidationError === 'throw') {
          throw new TulError(
            `Validation failed for ${fc.name}: ${validationErrors.join(', ')}`,
            'VALIDATION_ERROR',
            { errors: validationErrors }
          );
        }
      } else {
        this.emit({ type: 'tool:validation:pass', name: fc.name });
      }
    }

    // Execute the tool
    let result: unknown;
    let retries = 0;
    let lastError: Error | null = null;

    const maxRetries = this.config.retryOnFailure ? this.config.maxRetries : 0;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (!this.toolHandler) {
          throw new TulError('No tool handler registered', 'NO_HANDLER');
        }

        result = await this.toolHandler(fc.name, fc.args);
        this.statsTracker.recordToolSuccess();
        break;
      } catch (error) {
        lastError = error as Error;
        retries = attempt;

        if (attempt < maxRetries) {
          this.emit({ type: 'tool:retry', attempt: attempt + 1, reason: lastError.message });
          stats.retries = (stats.retries ?? 0) + 1;

          // Wait before retry
          if (this.config.retryDelay !== 'none') {
            const delay = this.config.retryDelay === 'exponential'
              ? 100 * Math.pow(2, attempt)
              : 100 * (attempt + 1);
            await new Promise((r) => setTimeout(r, delay));
          }
        } else {
          this.statsTracker.recordToolFailure();
          throw lastError;
        }
      }
    }

    // Cache result
    if (this.config.resultCaching && result !== undefined) {
      const ttl = toolDef?.cacheTTL ?? this.config.cacheTTL;
      if (ttl > 0) {
        const cacheKey = hashToolCall(fc.name, fc.args);
        this.resultCache.set(cacheKey, result, ttl);
      }
    }

    this.emit({ type: 'tool:result', name: fc.name, result, cached: false });

    return {
      name: fc.name,
      args: fc.args,
      result,
      cached: false,
      retries,
      repaired: false,
      validationPassed,
      validationErrors: validationErrors.length > 0 ? validationErrors : undefined,
    };
  }

  private emit(event: ToolRunnerEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (error) {
        this.logger.warn('Event listener error', error);
      }
    }
  }

  private async runBeforeRequestMiddleware(context: RequestContext): Promise<RequestContext> {
    let current = context;

    for (const mw of this.middleware) {
      if (mw.enabled && mw.beforeRequest) {
        current = await mw.beforeRequest(current);
      }
    }

    return current;
  }

  private async runAfterResponseMiddleware(context: ResponseContext): Promise<ResponseContext> {
    let current = context;

    for (const mw of this.middleware) {
      if (mw.enabled && mw.afterResponse) {
        current = await mw.afterResponse(current);
      }
    }

    return current;
  }

  /**
   * Determine function calling mode based on forceToolCalling config
   * - true: Always return 'ANY' (force tool calling)
   * - false: Always return 'AUTO' (let model decide)
   * - 'auto': Intelligently detect if query needs tools
   */
  private getFunctionCallingMode(userMessage: string): 'AUTO' | 'ANY' | 'NONE' {
    const forceConfig = this.config.forceToolCalling;

    if (forceConfig === true) {
      return 'ANY';
    }

    if (forceConfig === false) {
      return 'AUTO';
    }

    // 'auto' mode - intelligently detect if query likely needs a tool
    if (forceConfig === 'auto') {
      // Patterns that strongly suggest a tool call is needed
      const toolNeedPatterns = [
        // Action verbs that typically require tools
        /\b(get|fetch|retrieve|find|search|look up|check|show|tell me|what is|what's|what are)\b/i,
        // Commands
        /\b(create|add|remove|delete|update|set|send|book|schedule|convert|translate|calculate)\b/i,
        // Questions about external data
        /\b(weather|temperature|price|stock|currency|directions|route|time in|date|news)\b/i,
        // Explicit tool references
        /\b(use|call|run|execute|invoke)\s+(the\s+)?(tool|function|api)/i,
        // Data queries
        /\bhow (much|many|far|long|often)\b/i,
        /\bwhere is\b/i,
        /\bwhen (is|was|will)\b/i,
      ];

      // Patterns that suggest NO tool is needed (conversational)
      const conversationalPatterns = [
        /\b(thank you|thanks|ok|okay|got it|understood|sure|yes|no|maybe)\b/i,
        /\bhello|hi|hey|greetings\b/i,
        /\bwhat do you think|your opinion|explain|describe|summarize\b/i,
        /\bhelp me understand|can you explain\b/i,
      ];

      // Check if query matches tool-need patterns
      const needsTool = toolNeedPatterns.some(pattern => pattern.test(userMessage));
      const isConversational = conversationalPatterns.some(pattern => pattern.test(userMessage));

      // Force tool calling if query clearly needs a tool and isn't just conversational
      if (needsTool && !isConversational) {
        this.logger.debug('Auto-detected tool need, forcing tool calling mode', { userMessage });
        return 'ANY';
      }

      return 'AUTO';
    }

    return 'AUTO';
  }

  /**
   * Make API call to Gemini
   * In production, this uses @google/genai
   */
  private async callGeminiAPI(
    systemPrompt: string,
    history: Content[],
    userMessage: string,
    tools: InternalToolDefinition[]
  ): Promise<{
    raw: unknown;
    functionCalls: FunctionCall[];
    functionCallParts: ContentPart[];
    text: string;
    thoughtSignature?: string;
  }> {
    // Lazy load @google/genai
    if (!this.genAI) {
      try {
        const { GoogleGenAI } = await import('@google/genai');
        this.genAI = new GoogleGenAI({ apiKey: this.config.apiKey });
      } catch (error) {
        throw new TulError(
          'Failed to load @google/genai. Make sure it is installed as a peer dependency.',
          'DEPENDENCY_ERROR'
        );
      }
    }

    // Convert tools to Gemini format
    const geminiTools = tools.length > 0 ? [{
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
    }] : undefined;

    // Build messages
    const contents: Content[] = [
      ...history,
      { role: 'user', parts: [{ text: userMessage }] },
    ];

    // Determine function calling mode based on config
    const functionCallingMode = this.getFunctionCallingMode(userMessage);
    this.logger.debug('Function calling mode', { mode: functionCallingMode, forceToolCalling: this.config.forceToolCalling });

    try {
      const genAI = this.genAI as { models: { generateContent: (options: unknown) => Promise<unknown> } };
      const response = await genAI.models.generateContent({
        model: this.config.model,
        systemInstruction: systemPrompt,
        contents,
        config: geminiTools ? {
          tools: geminiTools,
          toolConfig: {
            functionCallingConfig: {
              mode: functionCallingMode,
            },
          },
        } : undefined,
      });

      return this.parseGeminiResponse(response);
    } catch (error) {
      this.logger.error('Gemini API error', error);
      throw new TulError(
        `Gemini API error: ${(error as Error).message}`,
        'API_ERROR',
        { originalError: error }
      );
    }
  }

  private async sendToolResults(
    systemPrompt: string,
    history: Content[],
    userMessage: string,
    tools: InternalToolDefinition[],
    functionCallParts: ContentPart[], // Original parts with thought_signature
    results: ToolCallResult[]
  ): Promise<{
    raw: unknown;
    functionCalls: FunctionCall[];
    functionCallParts: ContentPart[];
    text: string;
    thoughtSignature?: string;
  }> {
    // Build messages including tool results
    // Use original functionCallParts to preserve thought_signature for Gemini 3
    const contents: Content[] = [
      ...history,
      { role: 'user', parts: [{ text: userMessage }] },
      {
        role: 'model',
        parts: functionCallParts, // Keep original parts with thought signatures
      },
      {
        role: 'user',
        parts: results.map((r) => ({
          functionResponse: { name: r.name, response: { output: r.result } },
        } as FunctionResponsePart)),
      },
    ];

    // Convert tools to Gemini format
    const geminiTools = tools.length > 0 ? [{
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
    }] : undefined;

    // Determine function calling mode based on config
    // For tool result continuations, use AUTO to let model decide if more calls are needed
    const functionCallingMode = this.config.forceToolCalling === true ? 'ANY' : 'AUTO';

    try {
      const genAI = this.genAI as { models: { generateContent: (options: unknown) => Promise<unknown> } };
      const response = await genAI.models.generateContent({
        model: this.config.model,
        systemInstruction: systemPrompt,
        contents,
        config: geminiTools ? {
          tools: geminiTools,
          toolConfig: {
            functionCallingConfig: {
              mode: functionCallingMode,
            },
          },
        } : undefined,
      });

      return this.parseGeminiResponse(response);
    } catch (error) {
      this.logger.error('Gemini API error', error);
      throw new TulError(
        `Gemini API error: ${(error as Error).message}`,
        'API_ERROR',
        { originalError: error }
      );
    }
  }

  private parseGeminiResponse(response: unknown): {
    raw: unknown;
    functionCalls: FunctionCall[];
    functionCallParts: ContentPart[]; // Keep original parts for thought signatures
    text: string;
    thoughtSignature?: string;
  } {
    const resp = response as {
      candidates?: Array<{
        content?: {
          parts?: ContentPart[];
        };
      }>;
    };

    const functionCalls: FunctionCall[] = [];
    const functionCallParts: ContentPart[] = [];
    let text = '';
    let thoughtSignature: string | undefined;

    const parts = resp.candidates?.[0]?.content?.parts ?? [];

    for (const part of parts) {
      if ('text' in part) {
        text += (part as TextPart).text;
      } else if ('functionCall' in part) {
        const fcPart = part as FunctionCallPart;
        functionCalls.push(fcPart.functionCall);
        // Keep the entire part including thought_signature for Gemini 3
        functionCallParts.push(part);
      } else if ('thought' in part) {
        const thought = part as ThoughtPart;
        if (thought.thoughtSignature) {
          thoughtSignature = thought.thoughtSignature;
        }
      }
    }

    return { raw: response, functionCalls, functionCallParts, text, thoughtSignature };
  }
}

// Export default
export default Tul;
