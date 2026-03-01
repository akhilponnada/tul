/**
 * Loop Detector Middleware Tests
 *
 * Tests the loop detection functionality that prevents
 * infinite tool call loops, oscillations, and runaway calls.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  ResponseContext,
  RequestContext,
  FunctionCall,
  ResolvedTulConfig,
  InternalToolDefinition,
} from '../src/types/index.js';
import { LoopError } from '../src/types/index.js';
import { createLoopDetector } from '../src/middleware/loop-detector.js';

// Mock the logger
vi.mock('../src/utils/logger.js', () => ({
  getLogger: () => ({
    child: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  }),
}));

// Mock schema-utils
vi.mock('../src/utils/schema-utils.js', () => ({
  hashToolCall: (name: string, args: Record<string, unknown>) =>
    `${name}:${JSON.stringify(args)}`,
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
    systemPrompt: '',
    userMessage: 'test message',
    config: createDefaultConfig(config),
    metadata: {},
    stats: {},
    recentlyUsedTools: [],
  };
}

// Helper to create response context
function createResponseContext(
  functionCalls: FunctionCall[],
  requestConfig: Partial<ResolvedTulConfig> = {}
): ResponseContext {
  return {
    response: {},
    functionCalls,
    text: '',
    requestContext: createRequestContext(requestConfig),
    metadata: {},
    stats: {},
  };
}

describe('Loop Detector Middleware', () => {
  let loopDetector: ReturnType<typeof createLoopDetector>;

  beforeEach(() => {
    loopDetector = createLoopDetector();
  });

  describe('Basic Functionality', () => {
    it('should have correct name and be enabled by default', () => {
      expect(loopDetector.name).toBe('loop-detector');
      expect(loopDetector.enabled).toBe(true);
    });

    it('should pass through when no function calls present', async () => {
      const context = createResponseContext([]);
      const result = await loopDetector.afterResponse!(context);

      expect(result.stats.loopDetected).toBeFalsy();
    });

    it('should pass through when loop detection is disabled', async () => {
      const context = createResponseContext(
        [{ name: 'test_tool', args: {} }],
        { loopDetection: false }
      );

      const result = await loopDetector.afterResponse!(context);
      expect(result.stats.loopDetected).toBeFalsy();
    });

    it('should allow normal tool calls below thresholds', async () => {
      const context = createResponseContext([
        { name: 'tool_a', args: { id: 1 } },
        { name: 'tool_b', args: { id: 2 } },
      ]);

      const result = await loopDetector.afterResponse!(context);
      expect(result.stats.loopDetected).toBeFalsy();
    });
  });

  describe('Identical Call Detection', () => {
    it('should detect identical calls exceeding threshold', async () => {
      const context = createResponseContext(
        [{ name: 'test_tool', args: { id: 1 } }],
        { maxIdenticalCalls: 2 }
      );

      // First two calls are allowed
      await loopDetector.afterResponse!(context);
      await loopDetector.afterResponse!(context);

      // Third identical call should trigger loop detection
      await expect(loopDetector.afterResponse!(context)).rejects.toThrow(LoopError);
    });

    it('should track identical calls with same name and args', async () => {
      const context1 = createResponseContext([{ name: 'tool_a', args: { x: 1 } }]);
      const context2 = createResponseContext([{ name: 'tool_a', args: { x: 2 } }]); // Different args

      await loopDetector.afterResponse!(context1);
      await loopDetector.afterResponse!(context1); // Same
      await loopDetector.afterResponse!(context2); // Different args - OK

      const state = loopDetector.getState();
      expect(state.totalCalls).toBe(3);
    });

    it('should not confuse different tools as identical', async () => {
      await loopDetector.afterResponse!(
        createResponseContext([{ name: 'tool_a', args: { id: 1 } }])
      );
      await loopDetector.afterResponse!(
        createResponseContext([{ name: 'tool_b', args: { id: 1 } }])
      );
      await loopDetector.afterResponse!(
        createResponseContext([{ name: 'tool_c', args: { id: 1 } }])
      );

      const state = loopDetector.getState();
      expect(state.detectedLoop).toBeUndefined();
    });

    it('should warn instead of break when onLoop is warn', async () => {
      loopDetector.resetTurn();

      const context = createResponseContext(
        [{ name: 'test_tool', args: {} }],
        { maxIdenticalCalls: 2, onLoop: 'warn' }
      );

      await loopDetector.afterResponse!(context);
      await loopDetector.afterResponse!(context);

      // Third call should warn but not throw
      const result = await loopDetector.afterResponse!(context);
      expect(result.stats.loopDetected).toBe(true);
      expect(result.metadata.warnings).toBeDefined();
    });
  });

  describe('Runaway Detection', () => {
    it('should detect runaway calls exceeding max per turn', async () => {
      loopDetector.resetTurn();

      const config = { maxToolCallsPerTurn: 3 };

      await loopDetector.afterResponse!(
        createResponseContext([{ name: 'tool_1', args: { i: 1 } }], config)
      );
      await loopDetector.afterResponse!(
        createResponseContext([{ name: 'tool_2', args: { i: 2 } }], config)
      );
      await loopDetector.afterResponse!(
        createResponseContext([{ name: 'tool_3', args: { i: 3 } }], config)
      );

      // Fourth call should trigger runaway
      await expect(
        loopDetector.afterResponse!(
          createResponseContext([{ name: 'tool_4', args: { i: 4 } }], config)
        )
      ).rejects.toThrow(LoopError);
    });

    it('should count multiple calls in single response', async () => {
      loopDetector.resetTurn();

      const context = createResponseContext(
        [
          { name: 'tool_1', args: {} },
          { name: 'tool_2', args: {} },
          { name: 'tool_3', args: {} },
        ],
        { maxToolCallsPerTurn: 5 }
      );

      await loopDetector.afterResponse!(context);

      const state = loopDetector.getState();
      expect(state.totalCalls).toBe(3);
    });

    it('should respect custom maxToolCallsPerTurn', async () => {
      loopDetector.resetTurn();

      const config = { maxToolCallsPerTurn: 20 };

      // Make 15 calls - should be fine with limit of 20
      for (let i = 0; i < 15; i++) {
        await loopDetector.afterResponse!(
          createResponseContext([{ name: `tool_${i}`, args: { i } }], config)
        );
      }

      const state = loopDetector.getState();
      expect(state.totalCalls).toBe(15);
      expect(state.detectedLoop).toBeUndefined();
    });
  });

  describe('Oscillation Detection', () => {
    it('should detect 2-call oscillation pattern (A->B->A->B)', async () => {
      loopDetector.resetTurn();

      const contextA = createResponseContext([{ name: 'tool_a', args: {} }]);
      const contextB = createResponseContext([{ name: 'tool_b', args: {} }]);

      await loopDetector.afterResponse!(contextA); // A
      await loopDetector.afterResponse!(contextB); // B
      await loopDetector.afterResponse!(contextA); // A
      // B completes the pattern
      await expect(loopDetector.afterResponse!(contextB)).rejects.toThrow(LoopError);
    });

    it('should detect 3-call oscillation pattern (A->B->C->A->B->C)', async () => {
      loopDetector.resetTurn();

      const contextA = createResponseContext([{ name: 'tool_a', args: {} }]);
      const contextB = createResponseContext([{ name: 'tool_b', args: {} }]);
      const contextC = createResponseContext([{ name: 'tool_c', args: {} }]);

      await loopDetector.afterResponse!(contextA); // A
      await loopDetector.afterResponse!(contextB); // B
      await loopDetector.afterResponse!(contextC); // C
      await loopDetector.afterResponse!(contextA); // A
      await loopDetector.afterResponse!(contextB); // B
      // C completes the pattern
      await expect(loopDetector.afterResponse!(contextC)).rejects.toThrow(LoopError);
    });

    it('should not false-positive on non-oscillating sequences', async () => {
      loopDetector.resetTurn();

      const calls = ['a', 'b', 'a', 'c', 'b', 'd'].map((name) =>
        createResponseContext([{ name: `tool_${name}`, args: {} }])
      );

      for (const context of calls) {
        await loopDetector.afterResponse!(context);
      }

      const state = loopDetector.getState();
      expect(state.detectedLoop).toBeUndefined();
    });
  });

  describe('State Management', () => {
    it('should reset state for new turn', async () => {
      const context = createResponseContext([{ name: 'tool_a', args: {} }]);

      await loopDetector.afterResponse!(context);
      await loopDetector.afterResponse!(context);

      expect(loopDetector.getState().totalCalls).toBe(2);

      loopDetector.resetTurn();

      expect(loopDetector.getState().totalCalls).toBe(0);
      expect(loopDetector.getState().callCounts.size).toBe(0);
    });

    it('should return a copy of state, not reference', () => {
      const state1 = loopDetector.getState();
      state1.totalCalls = 999;

      const state2 = loopDetector.getState();
      expect(state2.totalCalls).toBe(0);
    });

    it('should track recent hashes for oscillation detection', async () => {
      loopDetector.resetTurn();

      for (let i = 0; i < 5; i++) {
        await loopDetector.afterResponse!(
          createResponseContext([{ name: `tool_${i}`, args: {} }])
        );
      }

      const state = loopDetector.getState();
      expect(state.recentHashes.length).toBe(5);
    });

    it('should limit recent hashes to 10', async () => {
      loopDetector.resetTurn();

      for (let i = 0; i < 15; i++) {
        await loopDetector.afterResponse!(
          createResponseContext([{ name: `tool_${i}`, args: {} }], { maxToolCallsPerTurn: 20 })
        );
      }

      const state = loopDetector.getState();
      expect(state.recentHashes.length).toBe(10);
    });
  });

  describe('LoopError Details', () => {
    it('should include loop type in error', async () => {
      loopDetector.resetTurn();

      const context = createResponseContext(
        [{ name: 'test_tool', args: {} }],
        { maxIdenticalCalls: 1 }
      );

      await loopDetector.afterResponse!(context);

      try {
        await loopDetector.afterResponse!(context);
        expect.fail('Should have thrown LoopError');
      } catch (error) {
        expect(error).toBeInstanceOf(LoopError);
        expect((error as LoopError).loopType).toBe('identical');
      }
    });

    it('should include details about the loop', async () => {
      loopDetector.resetTurn();

      const context = createResponseContext(
        [{ name: 'my_tool', args: { foo: 'bar' } }],
        { maxIdenticalCalls: 1 }
      );

      await loopDetector.afterResponse!(context);

      try {
        await loopDetector.afterResponse!(context);
        expect.fail('Should have thrown LoopError');
      } catch (error) {
        expect(error).toBeInstanceOf(LoopError);
        expect((error as LoopError).details).toContain('my_tool');
      }
    });
  });

  describe('Stats Integration', () => {
    it('should set loopDetected stat when loop is detected', async () => {
      loopDetector.resetTurn();

      const context = createResponseContext(
        [{ name: 'test', args: {} }],
        { maxIdenticalCalls: 2, onLoop: 'warn' }
      );

      await loopDetector.afterResponse!(context);
      await loopDetector.afterResponse!(context);

      const result = await loopDetector.afterResponse!(context);
      expect(result.stats.loopDetected).toBe(true);
    });

    it('should not set loopDetected when no loop occurs', async () => {
      loopDetector.resetTurn();

      const result = await loopDetector.afterResponse!(
        createResponseContext([{ name: 'test', args: {} }])
      );

      expect(result.stats.loopDetected).toBeFalsy();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty function call args', async () => {
      loopDetector.resetTurn();

      const context = createResponseContext([{ name: 'tool', args: {} }]);
      await loopDetector.afterResponse!(context);

      const state = loopDetector.getState();
      expect(state.totalCalls).toBe(1);
    });

    it('should handle complex nested args', async () => {
      loopDetector.resetTurn();

      const context1 = createResponseContext([
        { name: 'tool', args: { nested: { deep: { value: 1 } } } },
      ]);
      const context2 = createResponseContext([
        { name: 'tool', args: { nested: { deep: { value: 2 } } } },
      ]);

      await loopDetector.afterResponse!(context1);
      await loopDetector.afterResponse!(context2); // Different args

      const state = loopDetector.getState();
      expect(state.callCounts.size).toBe(2);
    });

    it('should handle null and undefined in args', async () => {
      loopDetector.resetTurn();

      const context = createResponseContext([
        { name: 'tool', args: { nullVal: null, optionalVal: undefined } as Record<string, unknown> },
      ]);

      await loopDetector.afterResponse!(context);
      const state = loopDetector.getState();
      expect(state.totalCalls).toBe(1);
    });

    it('should handle array values in args', async () => {
      loopDetector.resetTurn();

      const context1 = createResponseContext([
        { name: 'tool', args: { items: [1, 2, 3] } },
      ]);
      const context2 = createResponseContext([
        { name: 'tool', args: { items: [1, 2, 3, 4] } },
      ]);

      await loopDetector.afterResponse!(context1);
      await loopDetector.afterResponse!(context2);

      const state = loopDetector.getState();
      expect(state.callCounts.size).toBe(2);
    });

    it('should handle very long tool names', async () => {
      loopDetector.resetTurn();

      const longName = 'a'.repeat(1000);
      const context = createResponseContext([{ name: longName, args: {} }]);

      await loopDetector.afterResponse!(context);
      const state = loopDetector.getState();
      expect(state.totalCalls).toBe(1);
    });
  });

  describe('Multiple Instances', () => {
    it('should maintain separate state per instance', async () => {
      const detector1 = createLoopDetector();
      const detector2 = createLoopDetector();

      await detector1.afterResponse!(
        createResponseContext([{ name: 'tool', args: {} }])
      );

      expect(detector1.getState().totalCalls).toBe(1);
      expect(detector2.getState().totalCalls).toBe(0);
    });
  });
});
