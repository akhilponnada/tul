/**
 * Tul - Smart Retry Handler with Escalation
 *
 * Implements a 3-tier retry strategy:
 * - Retry 1: Simple retry (same request)
 * - Retry 2: Add clarifying prompt to help model
 * - Retry 3: Force ANY mode (relaxed tool calling)
 *
 * Supports configurable delay strategies: none, linear, exponential
 */

import type {
  RequestContext,
  ResponseContext,
  ResolvedTulConfig,
  FunctionCall,
} from '../types';
import { getLogger } from '../utils/logger.js';

const logger = getLogger();

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Retry state tracked across attempts
 */
export interface RetryState {
  /** Current attempt number (1-indexed) */
  attempt: number;

  /** Maximum attempts allowed */
  maxAttempts: number;

  /** Last error encountered */
  lastError?: Error;

  /** Last retry reason */
  lastReason?: string;

  /** Whether ANY mode is forced */
  forceAnyMode: boolean;

  /** Additional prompt injected for retry */
  injectedPrompt?: string;

  /** Timestamp of first attempt */
  startedAt: number;

  /** Total delay accumulated */
  totalDelay: number;
}

/**
 * Result of retry decision
 */
export interface RetryDecision {
  /** Whether to retry */
  shouldRetry: boolean;

  /** Delay before retry in ms */
  delayMs: number;

  /** Modified context for retry */
  modifiedContext?: RequestContext;

  /** Reason for retry */
  reason?: string;

  /** Whether to force ANY mode */
  forceAnyMode?: boolean;

  /** Prompt to inject for retry 2 */
  injectedPrompt?: string;
}

/**
 * Configuration for retry behavior
 */
export interface RetryConfig {
  /** Maximum retry attempts (default: 3) */
  maxRetries: number;

  /** Delay strategy (default: 'linear') */
  retryDelay: 'none' | 'linear' | 'exponential';

  /** Base delay in ms for linear/exponential (default: 1000) */
  baseDelayMs?: number;

  /** Maximum delay cap in ms (default: 10000) */
  maxDelayMs?: number;
}

/**
 * Retryable operation signature
 */
export type RetryableOperation<T> = (
  context: RequestContext,
  retryState: RetryState
) => Promise<T>;

// ═══════════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════════

const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 10000;

/**
 * Prompt additions for retry escalation
 */
const RETRY_PROMPTS = {
  /** Retry 2: Add clarifying guidance */
  clarify: `
IMPORTANT: Your previous tool call attempt failed or was invalid.
Please carefully:
1. Re-read the tool schema and requirements
2. Ensure all required parameters are provided
3. Ensure parameter types match the schema exactly
4. Use valid JSON values (no undefined, proper escaping)
If unsure which tool to use, select the most appropriate one based on the user's request.
`.trim(),

  /** Retry 3: Force ANY mode guidance */
  anyMode: `
CRITICAL: Multiple attempts have failed. Tool calling mode is now relaxed.
You may call ANY available tool or respond with text if no tool is appropriate.
Focus on providing a useful response to the user, even if it means using a different approach.
`.trim(),
};

// ═══════════════════════════════════════════════════════════════════════════════
// Retry State Management
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Creates initial retry state
 */
export function createRetryState(config: RetryConfig): RetryState {
  return {
    attempt: 0,
    maxAttempts: config.maxRetries,
    forceAnyMode: false,
    startedAt: Date.now(),
    totalDelay: 0,
  };
}

/**
 * Updates retry state for next attempt
 */
export function advanceRetryState(
  state: RetryState,
  error?: Error,
  reason?: string
): RetryState {
  return {
    ...state,
    attempt: state.attempt + 1,
    lastError: error,
    lastReason: reason,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Delay Calculation
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calculates delay for retry based on strategy
 */
export function calculateDelay(
  attempt: number,
  strategy: 'none' | 'linear' | 'exponential',
  baseDelayMs: number = DEFAULT_BASE_DELAY_MS,
  maxDelayMs: number = DEFAULT_MAX_DELAY_MS
): number {
  switch (strategy) {
    case 'none':
      return 0;

    case 'linear':
      // Linear: baseDelay * attempt (1000, 2000, 3000, ...)
      return Math.min(baseDelayMs * attempt, maxDelayMs);

    case 'exponential':
      // Exponential: baseDelay * 2^(attempt-1) with jitter
      const exponentialDelay = baseDelayMs * Math.pow(2, attempt - 1);
      // Add 0-25% jitter to prevent thundering herd
      const jitter = exponentialDelay * 0.25 * Math.random();
      return Math.min(exponentialDelay + jitter, maxDelayMs);

    default:
      return 0;
  }
}

/**
 * Async sleep utility
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ═══════════════════════════════════════════════════════════════════════════════
// Retry Decision Logic
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Determines if an error is retryable
 */
export function isRetryableError(error: Error): boolean {
  const message = error.message.toLowerCase();

  // Network/transient errors - always retryable
  if (
    message.includes('network') ||
    message.includes('timeout') ||
    message.includes('econnreset') ||
    message.includes('econnrefused') ||
    message.includes('socket') ||
    message.includes('fetch failed')
  ) {
    return true;
  }

  // Rate limiting - retryable with delay
  if (
    message.includes('rate limit') ||
    message.includes('quota') ||
    message.includes('429') ||
    message.includes('too many requests')
  ) {
    return true;
  }

  // Server errors - retryable
  if (
    message.includes('500') ||
    message.includes('502') ||
    message.includes('503') ||
    message.includes('504') ||
    message.includes('internal server error') ||
    message.includes('service unavailable')
  ) {
    return true;
  }

  // Tool call failures - retryable with escalation
  if (
    message.includes('invalid tool') ||
    message.includes('malformed') ||
    message.includes('validation') ||
    message.includes('schema')
  ) {
    return true;
  }

  // JSON parsing errors - retryable with escalation
  if (
    message.includes('json') ||
    message.includes('parse') ||
    message.includes('unexpected token')
  ) {
    return true;
  }

  // Not retryable: auth errors, invalid API key, etc.
  if (
    message.includes('unauthorized') ||
    message.includes('forbidden') ||
    message.includes('invalid api key') ||
    message.includes('authentication')
  ) {
    return false;
  }

  // Default: allow retry for unknown errors (fail open)
  return true;
}

/**
 * Determines retry decision based on current state and error
 */
export function makeRetryDecision(
  state: RetryState,
  config: RetryConfig,
  error?: Error,
  responseContext?: ResponseContext
): RetryDecision {
  const nextAttempt = state.attempt + 1;

  // Check if we have retries left
  if (nextAttempt > config.maxRetries) {
    logger.debug('retry', `No retries left (attempt ${state.attempt}/${config.maxRetries})`);
    return { shouldRetry: false, delayMs: 0 };
  }

  // Check if error is retryable
  if (error && !isRetryableError(error)) {
    logger.debug('retry', `Error not retryable: ${error.message}`);
    return { shouldRetry: false, delayMs: 0 };
  }

  // Check response context for retry signals
  if (responseContext?.shouldRetry === false) {
    logger.debug('retry', 'Response context indicates no retry');
    return { shouldRetry: false, delayMs: 0 };
  }

  // Calculate delay
  const delayMs = calculateDelay(
    nextAttempt,
    config.retryDelay,
    config.baseDelayMs,
    config.maxDelayMs
  );

  // Determine escalation level
  const decision: RetryDecision = {
    shouldRetry: true,
    delayMs,
    reason: error?.message || responseContext?.retryReason || 'Unknown error',
  };

  // Retry 1: Simple retry (no modifications)
  if (nextAttempt === 1) {
    logger.info('retry', `Retry 1: Simple retry after ${delayMs}ms`);
    return decision;
  }

  // Retry 2: Add clarifying prompt
  if (nextAttempt === 2) {
    logger.info('retry', `Retry 2: Adding clarifying prompt after ${delayMs}ms`);
    decision.injectedPrompt = RETRY_PROMPTS.clarify;
    return decision;
  }

  // Retry 3: Force ANY mode
  if (nextAttempt === 3) {
    logger.info('retry', `Retry 3: Forcing ANY mode after ${delayMs}ms`);
    decision.injectedPrompt = RETRY_PROMPTS.anyMode;
    decision.forceAnyMode = true;
    return decision;
  }

  // Additional retries: maintain ANY mode
  logger.info('retry', `Retry ${nextAttempt}: Continuing with ANY mode after ${delayMs}ms`);
  decision.forceAnyMode = true;
  return decision;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Context Modification for Retry
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Modifies request context for retry attempt
 */
export function modifyContextForRetry(
  context: RequestContext,
  decision: RetryDecision,
  state: RetryState
): RequestContext {
  const modified = { ...context };

  // Inject clarifying/escalation prompt into system prompt
  if (decision.injectedPrompt) {
    modified.systemPrompt = `${context.systemPrompt}\n\n${decision.injectedPrompt}`;
    modified.metadata = {
      ...modified.metadata,
      retryInjectedPrompt: decision.injectedPrompt,
    };
  }

  // Track retry state in metadata
  modified.metadata = {
    ...modified.metadata,
    retryAttempt: state.attempt + 1,
    retryReason: decision.reason,
    forceAnyMode: decision.forceAnyMode || false,
  };

  // Update stats
  modified.stats = {
    ...modified.stats,
    retries: (modified.stats.retries || 0) + 1,
  };

  return modified;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main Retry Wrapper
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Wraps an operation with smart retry logic
 *
 * @param operation - The async operation to retry
 * @param context - Initial request context
 * @param config - Retry configuration
 * @returns Result of successful operation
 * @throws Last error if all retries exhausted
 *
 * @example
 * ```ts
 * const result = await wrapWithRetry(
 *   async (ctx, state) => {
 *     return await callGeminiAPI(ctx);
 *   },
 *   requestContext,
 *   { maxRetries: 3, retryDelay: 'exponential' }
 * );
 * ```
 */
export async function wrapWithRetry<T>(
  operation: RetryableOperation<T>,
  context: RequestContext,
  config: RetryConfig
): Promise<{ result: T; retryState: RetryState }> {
  let state = createRetryState(config);
  let currentContext = context;
  let lastError: Error | undefined;

  while (state.attempt <= config.maxRetries) {
    try {
      logger.debug('retry', `Attempt ${state.attempt + 1}/${config.maxRetries + 1}`);

      // Execute operation
      const result = await operation(currentContext, state);

      // Success - return result with final state
      return { result, retryState: state };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      logger.warn('retry', `Attempt ${state.attempt + 1} failed: ${lastError.message}`);

      // Make retry decision
      const decision = makeRetryDecision(state, config, lastError);

      if (!decision.shouldRetry) {
        logger.error('retry', `Not retrying: ${decision.reason || 'non-retryable error'}`);
        throw lastError;
      }

      // Apply delay
      if (decision.delayMs > 0) {
        logger.debug('retry', `Waiting ${decision.delayMs}ms before retry`);
        await sleep(decision.delayMs);
        state.totalDelay += decision.delayMs;
      }

      // Modify context for next attempt
      currentContext = modifyContextForRetry(currentContext, decision, state);

      // Advance state
      state = advanceRetryState(state, lastError, decision.reason);
    }
  }

  // All retries exhausted
  logger.error('retry', `All ${config.maxRetries} retries exhausted`);
  throw lastError || new Error('All retries exhausted');
}

// ═══════════════════════════════════════════════════════════════════════════════
// Convenience Functions
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Creates retry config from TulConfig
 */
export function createRetryConfig(tulConfig: ResolvedTulConfig): RetryConfig {
  return {
    maxRetries: tulConfig.maxRetries,
    retryDelay: tulConfig.retryDelay,
    baseDelayMs: DEFAULT_BASE_DELAY_MS,
    maxDelayMs: DEFAULT_MAX_DELAY_MS,
  };
}

/**
 * Checks if response indicates need for retry
 */
export function shouldRetryResponse(
  response: ResponseContext,
  functionCalls: FunctionCall[]
): { shouldRetry: boolean; reason?: string } {
  // Empty function calls when tools were expected
  if (
    response.requestContext.filteredTools.length > 0 &&
    functionCalls.length === 0 &&
    !response.text
  ) {
    return {
      shouldRetry: true,
      reason: 'No tool calls or text response when tools were available',
    };
  }

  // Validation failures
  if (response.stats.validationFailed && !response.stats.validationRecovered) {
    return {
      shouldRetry: true,
      reason: 'Schema validation failed',
    };
  }

  // Explicit retry flag
  if (response.shouldRetry) {
    return {
      shouldRetry: true,
      reason: response.retryReason || 'Response indicated retry needed',
    };
  }

  return { shouldRetry: false };
}

/**
 * Creates a retryable wrapper for API calls
 */
export function createRetryableApiCall<TRequest, TResponse>(
  apiCall: (request: TRequest) => Promise<TResponse>,
  config: RetryConfig
): (request: TRequest) => Promise<TResponse> {
  return async (request: TRequest): Promise<TResponse> => {
    let state = createRetryState(config);
    let lastError: Error | undefined;

    while (state.attempt <= config.maxRetries) {
      try {
        return await apiCall(request);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        const decision = makeRetryDecision(state, config, lastError);

        if (!decision.shouldRetry) {
          throw lastError;
        }

        if (decision.delayMs > 0) {
          await sleep(decision.delayMs);
        }

        state = advanceRetryState(state, lastError, decision.reason);
      }
    }

    throw lastError || new Error('All retries exhausted');
  };
}
