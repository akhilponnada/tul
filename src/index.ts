/**
 * Tul - Claude-level tool calling for Gemini
 *
 * A toolkit that brings Claude's superior tool calling capabilities to Gemini,
 * including smart filtering, schema compression, input examples, and strict validation.
 *
 * @packageDocumentation
 */

// ═══════════════════════════════════════════════════════════════════════════════
// Main Client
// ═══════════════════════════════════════════════════════════════════════════════

export { Tul } from './client.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Tool Runner
// ═══════════════════════════════════════════════════════════════════════════════

export { ToolRunner } from './tool-runner.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Types - Configuration
// ═══════════════════════════════════════════════════════════════════════════════

export type {
  TulConfig,
  ResolvedTulConfig,
} from './types/index.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Types - Tool Definitions
// ═══════════════════════════════════════════════════════════════════════════════

export type {
  JsonSchema,
  ToolDefinition,
  InternalToolDefinition,
} from './types/index.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Types - Function Calls
// ═══════════════════════════════════════════════════════════════════════════════

export type {
  FunctionCall,
  FunctionResponse,
  ToolCallResult,
} from './types/index.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Types - Messages
// ═══════════════════════════════════════════════════════════════════════════════

export type {
  TextPart,
  FunctionCallPart,
  FunctionResponsePart,
  ThoughtPart,
  ContentPart,
  Content,
} from './types/index.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Types - Response & Statistics
// ═══════════════════════════════════════════════════════════════════════════════

export type {
  RequestStats,
  CumulativeStats,
  TulResponse,
} from './types/index.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Types - Middleware
// ═══════════════════════════════════════════════════════════════════════════════

export type {
  RequestContext,
  ResponseContext,
  Middleware,
} from './types/index.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Types - Tool Execution
// ═══════════════════════════════════════════════════════════════════════════════

export type {
  ToolCallHandler,
  ToolRunnerEvent,
  ToolRunnerEventListener,
} from './types/index.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Types - Validation & Cache
// ═══════════════════════════════════════════════════════════════════════════════

export type {
  ValidationResult,
  CacheEntry,
} from './types/index.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Error Classes
// ═══════════════════════════════════════════════════════════════════════════════

export {
  TulError,
  ValidationError,
  LoopError,
  RetryExhaustedError,
} from './types/index.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Middleware (for advanced customization)
// ═══════════════════════════════════════════════════════════════════════════════

export { MiddlewarePipeline } from './middleware/pipeline.js';
export { ToolFilterMiddleware, createToolFilterMiddleware, toolFilterMiddleware } from './middleware/tool-filter.js';
export { createSchemaCompressor } from './middleware/schema-compressor.js';
export { default as createExampleInjector } from './middleware/example-injector.js';
export { createStrictValidator } from './middleware/strict-validator.js';
export { jsonRepairerMiddleware, repairJson } from './middleware/json-repairer.js';
export { loopDetector, createLoopDetector } from './middleware/loop-detector.js';
export { wrapWithRetry, createRetryConfig, createRetryState } from './middleware/retry-handler.js';
export { ResultCache, ResultCacheMiddleware, createResultCacheMiddleware } from './middleware/result-cache.js';
export { contextManager, createContextManager } from './middleware/context-manager.js';
export { createThoughtSignaturesMiddleware, supportsThoughtSignatures } from './middleware/thought-signatures.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Analytics (for advanced usage)
// ═══════════════════════════════════════════════════════════════════════════════

export { TokenTracker } from './analytics/token-tracker.js';
export { Reporter } from './analytics/reporter.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Utilities (for advanced customization)
// ═══════════════════════════════════════════════════════════════════════════════

export {
  Logger,
  getLogger,
  setGlobalLogLevel,
  createLogger,
} from './utils/logger.js';

export type { LogLevel } from './utils/logger.js';

export {
  validateAgainstSchema,
  estimateTokens,
  hashToolCall,
  hasRequiredFields,
  getRequiredFields,
  getAllFieldNames,
  getEnumValues,
  matchesType,
  extractSchemaKeywords,
  simplifySchemaForDisplay,
  schemaSignature,
} from './utils/schema-utils.js';

export {
  deepClone,
  sortObjectKeys,
  tokenize,
  removeStopwords,
  fuzzyMatch,
  keywordOverlap,
  sleep,
  truncateText,
  truncateChars,
  formatNumber,
  formatBytes,
  isPlainObject,
  deepMerge,
  objectToStableString,
  deepEqual,
  debounce,
  retryWithBackoff,
  // Semantic similarity functions
  getBigrams,
  diceCoefficient,
  simpleStem,
  tokenizeAndStem,
  semanticWordSimilarity,
  ngramOverlap,
  semanticSimilarity,
  findBestMatch,
} from './utils/helpers.js';
