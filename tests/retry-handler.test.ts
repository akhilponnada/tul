/**
 * Retry Handler Tests
 *
 * Tests the smart retry functionality with 3-tier escalation:
 * - Simple retry
 * - Clarifying prompt injection
 * - Force ANY mode
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type {
  RequestContext,
  ResponseContext,
  ResolvedTulConfig,
} from '../src/types/index.js';
import {
  createRetryState,
  advanceRetryState,
  calculateDelay,
  isRetryableError,
  makeRetryDecision,
  modifyContextForRetry,
  wrapWithRetry,
  createRetryConfig,
  shouldRetryResponse,
  sleep,
  type RetryState,
  type RetryConfig,
} from '../src/middleware/retry-handler.js';

// Mock the logger
vi.mock('../src/utils/logger.js', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  }),
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Helper to create default config
function createDefaultConfig(overrides: Partial<ResolvedTulConfig> = {}): ResolvedTulConfig {
  return {
    apiKey: 'test-key',
    model: 'gemini-2.5-flash',
    toolFiltering: true,
    schemaCompression: true,
    exampleInjection: true,
    strictValidation: true,
    loopDetection: true,
    retryOnFailure: true,
    jsonRepair: true,
    resultCaching: true,
    contextManagement: true,
    thoughtSignatures: false,
    maxToolsPerRequest: 5,
    filterThreshold: 0.3,
    alwaysIncludeTools: [],
    compressionLevel: 'moderate',
    onValidationError: 'retry',
    maxToolCallsPerTurn: 10,
    maxIdenticalCalls: 2,
    onLoop: 'break',
    maxRetries: 3,
    retryDelay: 'linear',
    cacheTTL: 300000,
    cacheMaxSize: 100,
    maxContextTokens: 80000,
    turnsToKeepFull: 3,
    compactionStrategy: 'summarize',
    verbose: false,
    logLevel: 'warn',
    ...overrides,
  };
}

// Helper to create request context
function createRequestContext(config: Partial<ResolvedTulConfig> = {}): RequestContext {
  return {
    messages: [],
    tools: [],
    filteredTools: [],
    systemPrompt: 'You are a helpful assistant.',
    userMessage: 'test message',
    config: createDefaultConfig(config),
    metadata: {},
    stats: {},
    recentlyUsedTools: [],
  };
}

// Helper to create response context
function createResponseContext(overrides: Partial<ResponseContext> = {}): ResponseContext {
  return {
    response: {},
    functionCalls: [],
    text: '',
    requestContext: createRequestContext(),
    metadata: {},
    stats: {},
    ...overrides,
  };
}

describe('Retry Handler', () => {
  describe('createRetryState', () => {
    it('should create initial retry state with correct defaults', () => {
      const config: RetryConfig = {
        maxRetries: 3,
        retryDelay: 'linear',
      };

      const state = createRetryState(config);

      expect(state.attempt).toBe(0);
      expect(state.maxAttempts).toBe(3);
      expect(state.forceAnyMode).toBe(false);
      expect(state.totalDelay).toBe(0);
      expect(state.startedAt).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('advanceRetryState', () => {
    it('should increment attempt counter', () => {
      const initialState = createRetryState({ maxRetries: 3, retryDelay: 'none' });

      const advancedState = advanceRetryState(initialState);

      expect(advancedState.attempt).toBe(1);
    });

    it('should preserve previous state values', () => {
      const initialState = createRetryState({ maxRetries: 3, retryDelay: 'none' });
      initialState.totalDelay = 1000;

      const advancedState = advanceRetryState(initialState);

      expect(advancedState.totalDelay).toBe(1000);
    });

    it('should store last error', () => {
      const state = createRetryState({ maxRetries: 3, retryDelay: 'none' });
      const error = new Error('Test error');

      const advancedState = advanceRetryState(state, error);

      expect(advancedState.lastError).toBe(error);
    });

    it('should store retry reason', () => {
      const state = createRetryState({ maxRetries: 3, retryDelay: 'none' });

      const advancedState = advanceRetryState(state, undefined, 'Network timeout');

      expect(advancedState.lastReason).toBe('Network timeout');
    });
  });

  describe('calculateDelay', () => {
    describe('none strategy', () => {
      it('should return 0 for all attempts', () => {
        expect(calculateDelay(1, 'none')).toBe(0);
        expect(calculateDelay(2, 'none')).toBe(0);
        expect(calculateDelay(5, 'none')).toBe(0);
      });
    });

    describe('linear strategy', () => {
      it('should scale linearly with attempt number', () => {
        expect(calculateDelay(1, 'linear', 1000)).toBe(1000);
        expect(calculateDelay(2, 'linear', 1000)).toBe(2000);
        expect(calculateDelay(3, 'linear', 1000)).toBe(3000);
      });

      it('should respect maxDelay cap', () => {
        expect(calculateDelay(100, 'linear', 1000, 5000)).toBe(5000);
      });

      it('should use default base delay when not specified', () => {
        const delay = calculateDelay(1, 'linear');
        expect(delay).toBe(1000);
      });
    });

    describe('exponential strategy', () => {
      it('should grow exponentially', () => {
        // Base = 1000, attempt 1 = 1000 * 2^0 = 1000
        const delay1 = calculateDelay(1, 'exponential', 1000);
        expect(delay1).toBeGreaterThanOrEqual(1000);
        expect(delay1).toBeLessThanOrEqual(1250); // With jitter

        // attempt 2 = 1000 * 2^1 = 2000
        const delay2 = calculateDelay(2, 'exponential', 1000);
        expect(delay2).toBeGreaterThanOrEqual(2000);
        expect(delay2).toBeLessThanOrEqual(2500);
      });

      it('should respect maxDelay cap', () => {
        const delay = calculateDelay(10, 'exponential', 1000, 5000);
        expect(delay).toBe(5000);
      });

      it('should add jitter to prevent thundering herd', () => {
        // Run multiple times to check jitter variation
        const delays = new Set<number>();
        for (let i = 0; i < 10; i++) {
          delays.add(calculateDelay(2, 'exponential', 1000));
        }
        // With jitter, we should see some variation
        // (may occasionally fail due to randomness, but very unlikely)
        expect(delays.size).toBeGreaterThan(1);
      });
    });
  });

  describe('isRetryableError', () => {
    describe('network errors', () => {
      it('should retry network errors', () => {
        expect(isRetryableError(new Error('Network error'))).toBe(true);
        expect(isRetryableError(new Error('ECONNRESET'))).toBe(true);
        expect(isRetryableError(new Error('ECONNREFUSED'))).toBe(true);
        expect(isRetryableError(new Error('Socket timeout'))).toBe(true);
        expect(isRetryableError(new Error('Fetch failed'))).toBe(true);
      });

      it('should retry timeout errors', () => {
        expect(isRetryableError(new Error('Request timeout'))).toBe(true);
        expect(isRetryableError(new Error('Timeout exceeded'))).toBe(true);
      });
    });

    describe('rate limiting', () => {
      it('should retry rate limit errors', () => {
        expect(isRetryableError(new Error('Rate limit exceeded'))).toBe(true);
        expect(isRetryableError(new Error('Quota exceeded'))).toBe(true);
        expect(isRetryableError(new Error('429 Too Many Requests'))).toBe(true);
      });
    });

    describe('server errors', () => {
      it('should retry 5xx errors', () => {
        expect(isRetryableError(new Error('500 Internal Server Error'))).toBe(true);
        expect(isRetryableError(new Error('502 Bad Gateway'))).toBe(true);
        expect(isRetryableError(new Error('503 Service Unavailable'))).toBe(true);
        expect(isRetryableError(new Error('504 Gateway Timeout'))).toBe(true);
      });
    });

    describe('tool call errors', () => {
      it('should retry validation and schema errors', () => {
        expect(isRetryableError(new Error('Invalid tool call'))).toBe(true);
        expect(isRetryableError(new Error('Malformed response'))).toBe(true);
        expect(isRetryableError(new Error('Schema validation failed'))).toBe(true);
      });

      it('should retry JSON parsing errors', () => {
        expect(isRetryableError(new Error('JSON parse error'))).toBe(true);
        expect(isRetryableError(new Error('Unexpected token'))).toBe(true);
      });
    });

    describe('non-retryable errors', () => {
      it('should not retry auth errors', () => {
        expect(isRetryableError(new Error('Unauthorized'))).toBe(false);
        expect(isRetryableError(new Error('Forbidden'))).toBe(false);
        expect(isRetryableError(new Error('Invalid API key'))).toBe(false);
        expect(isRetryableError(new Error('Authentication failed'))).toBe(false);
      });
    });

    describe('unknown errors', () => {
      it('should default to retryable for unknown errors', () => {
        expect(isRetryableError(new Error('Something went wrong'))).toBe(true);
        expect(isRetryableError(new Error('Random error'))).toBe(true);
      });
    });
  });

  describe('makeRetryDecision', () => {
    const defaultConfig: RetryConfig = {
      maxRetries: 3,
      retryDelay: 'linear',
      baseDelayMs: 1000,
      maxDelayMs: 10000,
    };

    it('should not retry when max retries exceeded', () => {
      const state: RetryState = {
        attempt: 3,
        maxAttempts: 3,
        forceAnyMode: false,
        startedAt: Date.now(),
        totalDelay: 0,
      };

      const decision = makeRetryDecision(state, defaultConfig, new Error('Test'));

      expect(decision.shouldRetry).toBe(false);
    });

    it('should not retry non-retryable errors', () => {
      const state = createRetryState(defaultConfig);
      const error = new Error('Unauthorized');

      const decision = makeRetryDecision(state, defaultConfig, error);

      expect(decision.shouldRetry).toBe(false);
    });

    it('should allow retry for retryable errors', () => {
      const state = createRetryState(defaultConfig);
      const error = new Error('Network error');

      const decision = makeRetryDecision(state, defaultConfig, error);

      expect(decision.shouldRetry).toBe(true);
      expect(decision.delayMs).toBeGreaterThan(0);
    });

    it('should escalate to clarifying prompt on retry 2', () => {
      const state: RetryState = {
        attempt: 1,
        maxAttempts: 3,
        forceAnyMode: false,
        startedAt: Date.now(),
        totalDelay: 0,
      };

      const decision = makeRetryDecision(state, defaultConfig, new Error('Test'));

      expect(decision.shouldRetry).toBe(true);
      expect(decision.injectedPrompt).toBeDefined();
      expect(decision.injectedPrompt).toContain('Re-read the tool schema');
    });

    it('should escalate to ANY mode on retry 3', () => {
      const state: RetryState = {
        attempt: 2,
        maxAttempts: 3,
        forceAnyMode: false,
        startedAt: Date.now(),
        totalDelay: 0,
      };

      const decision = makeRetryDecision(state, defaultConfig, new Error('Test'));

      expect(decision.shouldRetry).toBe(true);
      expect(decision.forceAnyMode).toBe(true);
      expect(decision.injectedPrompt).toContain('relaxed');
    });

    it('should respect response context shouldRetry flag', () => {
      const state = createRetryState(defaultConfig);
      const responseContext = createResponseContext({ shouldRetry: false });

      const decision = makeRetryDecision(state, defaultConfig, undefined, responseContext);

      expect(decision.shouldRetry).toBe(false);
    });
  });

  describe('modifyContextForRetry', () => {
    it('should inject clarifying prompt into system prompt', () => {
      const context = createRequestContext();
      const decision = {
        shouldRetry: true,
        delayMs: 1000,
        injectedPrompt: 'Please try again carefully.',
      };
      const state = createRetryState({ maxRetries: 3, retryDelay: 'none' });

      const modified = modifyContextForRetry(context, decision, state);

      expect(modified.systemPrompt).toContain('Please try again carefully.');
      expect(modified.systemPrompt).toContain(context.systemPrompt);
    });

    it('should track retry attempt in metadata', () => {
      const context = createRequestContext();
      const decision = {
        shouldRetry: true,
        delayMs: 1000,
        reason: 'Network error',
      };
      const state = createRetryState({ maxRetries: 3, retryDelay: 'none' });

      const modified = modifyContextForRetry(context, decision, state);

      expect(modified.metadata.retryAttempt).toBe(1);
      expect(modified.metadata.retryReason).toBe('Network error');
    });

    it('should track forceAnyMode in metadata', () => {
      const context = createRequestContext();
      const decision = {
        shouldRetry: true,
        delayMs: 1000,
        forceAnyMode: true,
      };
      const state = createRetryState({ maxRetries: 3, retryDelay: 'none' });

      const modified = modifyContextForRetry(context, decision, state);

      expect(modified.metadata.forceAnyMode).toBe(true);
    });

    it('should increment retries in stats', () => {
      const context = createRequestContext();
      context.stats.retries = 1;
      const decision = { shouldRetry: true, delayMs: 0 };
      const state = createRetryState({ maxRetries: 3, retryDelay: 'none' });

      const modified = modifyContextForRetry(context, decision, state);

      expect(modified.stats.retries).toBe(2);
    });

    it('should not mutate original context', () => {
      const context = createRequestContext();
      const originalPrompt = context.systemPrompt;
      const decision = {
        shouldRetry: true,
        delayMs: 0,
        injectedPrompt: 'Extra prompt',
      };
      const state = createRetryState({ maxRetries: 3, retryDelay: 'none' });

      modifyContextForRetry(context, decision, state);

      expect(context.systemPrompt).toBe(originalPrompt);
    });
  });

  describe('wrapWithRetry', () => {
    it('should return result on first success', async () => {
      const operation = vi.fn().mockResolvedValue('success');
      const context = createRequestContext();
      const config: RetryConfig = { maxRetries: 3, retryDelay: 'none' };

      const { result, retryState } = await wrapWithRetry(operation, context, config);

      expect(result).toBe('success');
      expect(retryState.attempt).toBe(0);
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and eventually succeed', async () => {
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce('success');

      const context = createRequestContext();
      const config: RetryConfig = { maxRetries: 3, retryDelay: 'none' };

      const { result, retryState } = await wrapWithRetry(operation, context, config);

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should throw after exhausting all retries', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Persistent error'));
      const context = createRequestContext();
      const config: RetryConfig = { maxRetries: 2, retryDelay: 'none' };

      await expect(wrapWithRetry(operation, context, config)).rejects.toThrow('Persistent error');
      expect(operation).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    it('should not retry non-retryable errors', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Unauthorized'));
      const context = createRequestContext();
      const config: RetryConfig = { maxRetries: 3, retryDelay: 'none' };

      await expect(wrapWithRetry(operation, context, config)).rejects.toThrow('Unauthorized');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should modify context on retries', async () => {
      const contexts: RequestContext[] = [];
      const operation = vi.fn().mockImplementation((ctx: RequestContext) => {
        contexts.push(ctx);
        if (contexts.length < 4) {
          return Promise.reject(new Error('Network error'));
        }
        return Promise.resolve('success');
      });

      const context = createRequestContext();
      const config: RetryConfig = { maxRetries: 4, retryDelay: 'none' };

      await wrapWithRetry(operation, context, config);

      // contexts[0] = initial attempt (attempt=0), fails
      // contexts[1] = retry 1 (nextAttempt=1, simple retry), has retryAttempt=1
      // contexts[2] = retry 2 (nextAttempt=2, clarify prompt), has retryAttempt=2
      // contexts[3] = retry 3 (nextAttempt=3, force ANY mode), has forceAnyMode=true

      expect(contexts[1].metadata.retryAttempt).toBe(1);
      expect(contexts[2].metadata.retryAttempt).toBe(2);
      expect(contexts[3].metadata.forceAnyMode).toBe(true);
    });
  });

  describe('createRetryConfig', () => {
    it('should create config from TulConfig', () => {
      const tulConfig = createDefaultConfig({ maxRetries: 5, retryDelay: 'exponential' });

      const retryConfig = createRetryConfig(tulConfig);

      expect(retryConfig.maxRetries).toBe(5);
      expect(retryConfig.retryDelay).toBe('exponential');
    });
  });

  describe('shouldRetryResponse', () => {
    it('should retry when tools available but no response', () => {
      const response = createResponseContext({
        requestContext: {
          ...createRequestContext(),
          filteredTools: [{ name: 'tool', description: '', keywords: [], paramKeywords: [], estimatedTokens: 100 }],
        },
        text: '',
      });

      const result = shouldRetryResponse(response, []);

      expect(result.shouldRetry).toBe(true);
      expect(result.reason).toContain('No tool calls or text');
    });

    it('should retry when validation failed', () => {
      const response = createResponseContext({
        stats: { validationFailed: true, validationRecovered: false },
      });

      const result = shouldRetryResponse(response, []);

      expect(result.shouldRetry).toBe(true);
      expect(result.reason).toContain('validation');
    });

    it('should not retry when validation was recovered', () => {
      const response = createResponseContext({
        stats: { validationFailed: true, validationRecovered: true },
      });

      const result = shouldRetryResponse(response, [{ name: 'tool', args: {} }]);

      expect(result.shouldRetry).toBe(false);
    });

    it('should retry when response indicates retry needed', () => {
      const response = createResponseContext({
        shouldRetry: true,
        retryReason: 'Custom reason',
      });

      const result = shouldRetryResponse(response, []);

      expect(result.shouldRetry).toBe(true);
      expect(result.reason).toContain('Custom reason');
    });

    it('should not retry successful responses', () => {
      const response = createResponseContext({
        text: 'Here is your answer',
      });

      const result = shouldRetryResponse(response, []);

      expect(result.shouldRetry).toBe(false);
    });
  });

  describe('sleep', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should resolve after specified time', async () => {
      const promise = sleep(1000);

      vi.advanceTimersByTime(1000);

      await expect(promise).resolves.toBeUndefined();
    });

    it('should not resolve before time', async () => {
      let resolved = false;
      sleep(1000).then(() => {
        resolved = true;
      });

      vi.advanceTimersByTime(500);

      expect(resolved).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero max retries', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Error'));
      const context = createRequestContext();
      const config: RetryConfig = { maxRetries: 0, retryDelay: 'none' };

      await expect(wrapWithRetry(operation, context, config)).rejects.toThrow('Error');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should handle non-Error thrown values', async () => {
      const operation = vi.fn().mockRejectedValue('string error');
      const context = createRequestContext();
      const config: RetryConfig = { maxRetries: 1, retryDelay: 'none' };

      await expect(wrapWithRetry(operation, context, config)).rejects.toThrow('string error');
    });

    it('should accumulate total delay across retries', async () => {
      vi.useRealTimers();

      let totalDelayObserved = 0;
      const operation = vi.fn().mockImplementation((ctx, state: RetryState) => {
        totalDelayObserved = state.totalDelay;
        if (operation.mock.calls.length < 3) {
          return Promise.reject(new Error('Error'));
        }
        return Promise.resolve('success');
      });

      const context = createRequestContext();
      const config: RetryConfig = { maxRetries: 3, retryDelay: 'none' };

      await wrapWithRetry(operation, context, config);

      // With 'none' delay strategy, total delay should be 0
      expect(totalDelayObserved).toBe(0);
    });
  });
});
