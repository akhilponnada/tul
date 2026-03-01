/**
 * Tul - Claude-level tool calling for Gemini
 * Type definitions
 */

// ═══════════════════════════════════════════════════════════════════════════════
// Configuration Types
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Main configuration for Tul client
 */
export interface TulConfig {
  /** Google AI API key */
  apiKey: string;

  /** Gemini model to use (e.g., 'gemini-2.5-flash', 'gemini-3-pro') */
  model: string;

  // ── Feature Toggles (ALL default to true) ──

  /** Enable smart tool filtering per request */
  toolFiltering?: boolean;

  /** Enable schema compression to reduce tokens */
  schemaCompression?: boolean;

  /** Enable input examples injection (Claude-inspired) */
  exampleInjection?: boolean;

  /** Enable strict schema validation on tool outputs (Claude-inspired) */
  strictValidation?: boolean;

  /** Enable tool call loop detection */
  loopDetection?: boolean;

  /** Enable automatic retry on failures */
  retryOnFailure?: boolean;

  /** Enable JSON repair for malformed outputs */
  jsonRepair?: boolean;

  /** Enable result caching for identical calls */
  resultCaching?: boolean;

  /** Enable automatic context management (Claude-inspired) */
  contextManagement?: boolean;

  /** Enable thought signature management for Gemini 3+ */
  thoughtSignatures?: boolean;

  // ── Tool Filtering Config ──

  /** Maximum tools to send per request (default: 5) */
  maxToolsPerRequest?: number;

  /** Minimum tools to always include (default: 3) */
  minToolsToSend?: number;

  /** Minimum relevance score threshold (default: 0.3) */
  filterThreshold?: number;

  /** Tool names to never filter out */
  alwaysIncludeTools?: string[];

  /** Confidence threshold - if top tool confidence is below this, include more tools (default: 0.5) */
  confidenceThreshold?: number;

  // ── Schema Compression Config ──

  /** Compression level (default: 'moderate') */
  compressionLevel?: 'light' | 'moderate' | 'aggressive';

  /** Enhance descriptions with synonyms and trigger phrases (default: false) */
  enhanceDescriptions?: boolean;

  // ── Strict Validation Config ──

  /** Action on validation error (default: 'retry') */
  onValidationError?: 'retry' | 'warn' | 'throw';

  // ── Loop Detection Config ──

  /** Max tool calls allowed per turn (default: 10) */
  maxToolCallsPerTurn?: number;

  /** Max identical tool calls before loop detection (default: 2) */
  maxIdenticalCalls?: number;

  /** Action on loop detection (default: 'break') */
  onLoop?: 'break' | 'warn';

  // ── Retry Config ──

  /** Maximum retry attempts (default: 3) */
  maxRetries?: number;

  /** Delay strategy between retries (default: 'linear') */
  retryDelay?: 'none' | 'linear' | 'exponential';

  /**
   * Retry with expanded tool set when model returns text but filtered tools existed
   * When enabled, if the model returns only text (no tool calls) but tools were
   * filtered out, retries the request with more tools (less aggressive filtering)
   * (default: true)
   */
  retryWithExpandedTools?: boolean;

  /** Maximum retries with expanded tools (default: 2) */
  maxExpandedToolRetries?: number;

  // ── Cache Config ──

  /** Cache TTL in milliseconds (default: 300000 = 5 min) */
  cacheTTL?: number;

  /** Maximum cache entries (default: 100) */
  cacheMaxSize?: number;

  // ── Context Management Config ──

  /** Maximum context tokens before compaction (default: 80000) */
  maxContextTokens?: number;

  /** Number of recent turns to keep full (default: 3) */
  turnsToKeepFull?: number;

  /** Strategy for compacting old turns (default: 'summarize') */
  compactionStrategy?: 'summarize' | 'truncate' | 'drop';

  // ── System Prompt Config ──

  /** Custom system prompt (Tul adds optimization on top) */
  systemPrompt?: string;

  // ── Logging Config ──

  /** Enable verbose logging (default: false) */
  verbose?: boolean;

  /** Log level (default: 'warn') */
  logLevel?: 'debug' | 'info' | 'warn' | 'error' | 'silent';

  // ── Tool Calling Mode Config ──

  /**
   * Force the model to call tools instead of returning text
   * - true: Always force tool calling (Gemini mode 'ANY')
   * - false: Let model decide (Gemini mode 'AUTO')
   * - 'auto': Intelligently detect if query needs tools and force accordingly
   */
  forceToolCalling?: boolean | 'auto';
}

/**
 * Resolved config with all defaults applied
 */
export interface ResolvedTulConfig extends Required<Omit<TulConfig, 'systemPrompt' | 'alwaysIncludeTools'>> {
  systemPrompt?: string;
  alwaysIncludeTools: string[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tool Definition Types
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * JSON Schema for tool parameters
 */
export interface JsonSchema {
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  enum?: (string | number | boolean)[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  description?: string;
  default?: unknown;
  additionalProperties?: boolean | JsonSchema;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  allOf?: JsonSchema[];
}

/**
 * Tool definition with Tul extensions (examples, strict mode, cache TTL)
 */
export interface ToolDefinition {
  /** Unique tool name */
  name: string;

  /** Human-readable description of what the tool does */
  description: string;

  /** JSON Schema for tool parameters */
  parameters?: JsonSchema;

  /**
   * Alternative names/synonyms for this tool
   * Used for matching when filtering tools by relevance
   * Example: ['delete_from_cart', 'take_out', 'remove_from_basket']
   */
  aliases?: string[];

  /**
   * Tool category for grouping related tools
   * When a query matches a category keyword, all tools in that category are included
   * Examples: 'auth', 'files', 'data', 'messaging', 'system', 'cart'
   */
  category?: string;

  /**
   * Input examples (Claude-inspired)
   * These get injected into the system prompt to show Gemini concrete patterns
   */
  examples?: Record<string, unknown>[];

  /**
   * Enable strict schema validation (Claude-inspired)
   * Validates Gemini's output against the schema, retries if invalid
   */
  strict?: boolean;

  /**
   * Cache TTL override for this tool (0 = no cache)
   * Falls back to global cacheTTL if not specified
   */
  cacheTTL?: number;
}

/**
 * Internal tool definition with computed fields
 */
export interface InternalToolDefinition extends ToolDefinition {
  /** Lowercase keywords from name and description for filtering */
  keywords: string[];

  /** Parameter keywords for filtering */
  paramKeywords: string[];

  /** Estimated token count for full schema */
  estimatedTokens: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Function Call Types
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Function call from Gemini
 */
export interface FunctionCall {
  name: string;
  args: Record<string, unknown>;
}

/**
 * Function response to send back to Gemini
 */
export interface FunctionResponse {
  name: string;
  response: unknown;
}

/**
 * Result of executing a tool call
 */
export interface ToolCallResult {
  /** Tool name */
  name: string;

  /** Arguments passed to the tool */
  args: Record<string, unknown>;

  /** Result returned from tool execution */
  result: unknown;

  /** Whether result was from cache */
  cached: boolean;

  /** Number of retries needed */
  retries: number;

  /** Whether JSON was repaired */
  repaired: boolean;

  /** Whether schema validation passed */
  validationPassed: boolean;

  /** Validation errors if any */
  validationErrors?: string[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Message Types (mirrors @google/genai structure)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Content part types
 */
export interface TextPart {
  text: string;
}

export interface FunctionCallPart {
  functionCall: FunctionCall;
}

export interface FunctionResponsePart {
  functionResponse: FunctionResponse;
}

export interface ThoughtPart {
  thought: string;
  thoughtSignature?: string;
}

export type ContentPart = TextPart | FunctionCallPart | FunctionResponsePart | ThoughtPart;

/**
 * Message content
 */
export interface Content {
  role: 'user' | 'model' | 'function';
  parts: ContentPart[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Response Types
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Per-request statistics
 */
export interface RequestStats {
  /** Input tokens consumed */
  inputTokens: number;

  /** Output tokens generated */
  outputTokens: number;

  /** Tokens saved compared to baseline */
  tokensSaved: number;

  /** Number of tools filtered out */
  toolsFiltered: number;

  /** Number of tools actually sent */
  toolsSent: number;

  /** Number of examples injected */
  examplesInjected: number;

  /** Tokens used by examples */
  exampleTokens: number;

  /** Tokens saved by schema compression */
  compressionSaved: number;

  /** Whether any result was from cache */
  cacheHit: boolean;

  /** Number of cache hits */
  cacheHits: number;

  /** Number of retries */
  retries: number;

  /** Whether JSON was repaired */
  jsonRepaired: boolean;

  /** Whether a loop was detected */
  loopDetected: boolean;

  /** Whether schema validation failed */
  validationFailed: boolean;

  /** Whether validation failure was recovered */
  validationRecovered: boolean;

  /** Tokens saved by context compaction */
  contextCompactionSaved: number;

  /** Number of tool calls made */
  toolCallsMade: number;
}

/**
 * Cumulative statistics across all requests
 */
export interface CumulativeStats {
  /** Total requests made */
  totalRequests: number;

  /** Total input tokens */
  totalInputTokens: number;

  /** Total output tokens */
  totalOutputTokens: number;

  /** Estimated tokens if not using Tul */
  estimatedBaselineTokens: number;

  /** Total tokens saved */
  tokensSaved: number;

  /** Percentage of tokens saved */
  percentSaved: number;

  /** Total tool calls made */
  toolCallsMade: number;

  /** Successful tool calls */
  toolCallsSucceeded: number;

  /** Failed tool calls */
  toolCallsFailed: number;

  /** Failures recovered via retry */
  failuresRecovered: number;

  /** Schema violations caught */
  schemaViolationsCaught: number;

  /** Schema violations recovered */
  schemaViolationsRecovered: number;

  /** Loops prevented */
  loopsPrevented: number;

  /** Cache hits */
  cacheHits: number;

  /** Cache misses */
  cacheMisses: number;

  /** Average tools sent per request */
  avgToolsPerRequest: number;

  /** Total tools filtered out */
  totalToolsFiltered: number;
}

/**
 * Suggested tool that should have been called
 * Helps developers debug when tools aren't being invoked
 */
export interface SuggestedTool {
  /** Tool name */
  name: string;

  /** Confidence score (0-1) that this tool should have been called */
  confidence: number;

  /** Human-readable reason why this tool was suggested */
  reason: string;
}

/**
 * Tul response wrapper
 */
export interface TulResponse {
  /** Final text response */
  text: string;

  /** Tool calls made during this request */
  toolCalls: ToolCallResult[];

  /** Per-request statistics */
  stats: RequestStats;

  /** Raw @google/genai response */
  raw: unknown;

  /** Whether the response was truncated due to loop */
  truncatedByLoop?: boolean;

  /** Warning messages if any */
  warnings?: string[];

  /**
   * Suggested tools that should have been called
   * Populated when the model returns text without making any tool calls
   * Helps developers debug tool selection issues
   */
  suggestedTools?: SuggestedTool[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Middleware Types
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Context passed through beforeRequest middleware chain
 */
export interface RequestContext {
  /** Conversation messages */
  messages: Content[];

  /** Tools to potentially include */
  tools: InternalToolDefinition[];

  /** Filtered tools (after tool filter runs) */
  filteredTools: InternalToolDefinition[];

  /** System prompt (may be modified by middleware) */
  systemPrompt: string;

  /** Current user message */
  userMessage: string;

  /** Resolved configuration */
  config: ResolvedTulConfig;

  /** Metadata for middleware communication */
  metadata: Record<string, unknown>;

  /** Per-request stats (accumulated during pipeline) */
  stats: Partial<RequestStats>;

  /** Tools used in recent turns (for filtering boost) */
  recentlyUsedTools: string[];

  /** Stored thought signature for Gemini 3+ */
  thoughtSignature?: string;
}

/**
 * Context passed through afterResponse middleware chain
 */
export interface ResponseContext {
  /** Raw API response */
  response: unknown;

  /** Extracted function calls */
  functionCalls: FunctionCall[];

  /** Final text (if present) */
  text: string;

  /** Request context that produced this response */
  requestContext: RequestContext;

  /** Metadata for middleware communication */
  metadata: Record<string, unknown>;

  /** Per-request stats (accumulated during pipeline) */
  stats: Partial<RequestStats>;

  /** Whether to trigger a retry */
  shouldRetry?: boolean;

  /** Retry reason (for prompt modification) */
  retryReason?: string;

  /** Extracted thought signature */
  thoughtSignature?: string;
}

/**
 * Middleware interface
 */
export interface Middleware {
  /** Middleware name for logging */
  name: string;

  /** Whether middleware is enabled */
  enabled: boolean;

  /** Runs before sending request to Gemini */
  beforeRequest?(context: RequestContext): Promise<RequestContext>;

  /** Runs after receiving response from Gemini */
  afterResponse?(context: ResponseContext): Promise<ResponseContext>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tool Execution Types
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Tool execution callback signature
 */
export type ToolCallHandler = (
  name: string,
  args: Record<string, unknown>
) => Promise<unknown> | unknown;

/**
 * Event types emitted by tool runner
 */
export type ToolRunnerEvent =
  | { type: 'tool:call'; name: string; args: Record<string, unknown> }
  | { type: 'tool:result'; name: string; result: unknown; cached: boolean }
  | { type: 'tool:cached'; name: string; args: Record<string, unknown> }
  | { type: 'tool:retry'; attempt: number; reason: string }
  | { type: 'tool:loop'; loopType: 'identical' | 'oscillation' | 'runaway' }
  | { type: 'tool:validation:fail'; name: string; errors: string[] }
  | { type: 'tool:validation:pass'; name: string }
  | { type: 'tool:error'; name: string; error: string };

/**
 * Event listener for tool runner events
 */
export type ToolRunnerEventListener = (event: ToolRunnerEvent) => void;

// ═══════════════════════════════════════════════════════════════════════════════
// Validation Types
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Schema validation result
 */
export interface ValidationResult {
  /** Whether validation passed */
  valid: boolean;

  /** Validation errors if any */
  errors: string[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Cache Types
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Cache entry
 */
export interface CacheEntry {
  /** Cached result */
  result: unknown;

  /** Timestamp when cached */
  timestamp: number;

  /** TTL for this entry */
  ttl: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Error Types
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Tul error with context
 */
export class TulError extends Error {
  constructor(
    message: string,
    public code: string,
    public context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'TulError';
  }
}

/**
 * Validation error thrown when strict mode fails
 */
export class ValidationError extends TulError {
  constructor(
    public toolName: string,
    public errors: string[],
    public args: Record<string, unknown>
  ) {
    super(
      `Schema validation failed for tool "${toolName}": ${errors.join(', ')}`,
      'VALIDATION_ERROR',
      { toolName, errors, args }
    );
    this.name = 'ValidationError';
  }
}

/**
 * Loop detection error
 */
export class LoopError extends TulError {
  constructor(
    public loopType: 'identical' | 'oscillation' | 'runaway',
    public details: string
  ) {
    super(
      `Tool call loop detected (${loopType}): ${details}`,
      'LOOP_ERROR',
      { loopType, details }
    );
    this.name = 'LoopError';
  }
}

/**
 * Retry exhausted error
 */
export class RetryExhaustedError extends TulError {
  constructor(
    public attempts: number,
    public lastError: Error
  ) {
    super(
      `All ${attempts} retry attempts exhausted. Last error: ${lastError.message}`,
      'RETRY_EXHAUSTED',
      { attempts, lastError: lastError.message }
    );
    this.name = 'RetryExhaustedError';
  }
}
