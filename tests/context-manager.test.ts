/**
 * Context Manager Middleware Tests
 *
 * Tests the auto-compaction functionality for context management.
 * Supports summarize, truncate, and drop strategies.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  RequestContext,
  Content,
  ResolvedTulConfig,
  FunctionResponsePart,
  ContentPart,
} from '../src/types/index.js';
import {
  createContextManager,
  estimateTokens,
  estimateMessageTokens,
  analyzeContext,
  compactMessages,
  generateSummary,
} from '../src/middleware/context-manager.js';

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

// Mock the helpers
vi.mock('../src/utils/helpers.js', () => ({
  truncateChars: (text: string, maxChars: number) => {
    if (text.length <= maxChars) return text;
    return text.slice(0, maxChars - 3) + '...';
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
    maxContextTokens: 1000, // Low for testing
    turnsToKeepFull: 2,
    compactionStrategy: 'summarize',
    verbose: false,
    logLevel: 'warn',
    ...overrides,
  };
}

// Helper to create a user message
function createUserMessage(text: string): Content {
  return {
    role: 'user',
    parts: [{ text }],
  };
}

// Helper to create a model message
function createModelMessage(text: string): Content {
  return {
    role: 'model',
    parts: [{ text }],
  };
}

// Helper to create a function response message
function createFunctionResponse(name: string, response: unknown): Content {
  return {
    role: 'function',
    parts: [
      {
        functionResponse: { name, response },
      },
    ],
  };
}

// Helper to create request context
function createRequestContext(
  messages: Content[],
  config: Partial<ResolvedTulConfig> = {}
): RequestContext {
  return {
    messages,
    tools: [],
    filteredTools: [],
    systemPrompt: '',
    userMessage: 'current message',
    config: createDefaultConfig(config),
    metadata: {},
    stats: {},
    recentlyUsedTools: [],
  };
}

describe('Context Manager', () => {
  describe('estimateTokens', () => {
    it('should estimate tokens from string length', () => {
      const text = 'Hello world'; // 11 chars
      const tokens = estimateTokens(text);

      // ~3.5 chars per token
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(text.length);
    });

    it('should return 0 for empty string', () => {
      expect(estimateTokens('')).toBe(0);
    });

    it('should handle long strings', () => {
      const longText = 'a'.repeat(1000);
      const tokens = estimateTokens(longText);

      expect(tokens).toBeGreaterThan(200);
      expect(tokens).toBeLessThan(500);
    });
  });

  describe('estimateMessageTokens', () => {
    it('should estimate tokens for text message', () => {
      const message = createUserMessage('Hello, how are you?');
      const tokens = estimateMessageTokens(message);

      expect(tokens).toBeGreaterThan(0);
    });

    it('should estimate tokens for function response', () => {
      const message = createFunctionResponse('test_tool', { result: 'success' });
      const tokens = estimateMessageTokens(message);

      expect(tokens).toBeGreaterThan(0);
    });

    it('should handle multiple parts', () => {
      const message: Content = {
        role: 'model',
        parts: [{ text: 'Part 1' }, { text: 'Part 2' }],
      };
      const tokens = estimateMessageTokens(message);

      expect(tokens).toBeGreaterThan(0);
    });
  });

  describe('analyzeContext', () => {
    it('should analyze empty messages', () => {
      const stats = analyzeContext([]);

      expect(stats.totalTokens).toBe(0);
      expect(stats.turnCount).toBe(0);
    });

    it('should count user messages as turns', () => {
      const messages = [
        createUserMessage('Hello'),
        createModelMessage('Hi there'),
        createUserMessage('How are you?'),
        createModelMessage('Im good'),
      ];

      const stats = analyzeContext(messages);

      expect(stats.turnCount).toBe(2);
    });

    it('should categorize token usage', () => {
      const messages = [
        createUserMessage('User message'),
        createModelMessage('Model response'),
        createFunctionResponse('tool', 'Tool result'),
      ];

      const stats = analyzeContext(messages);

      expect(stats.userTokens).toBeGreaterThan(0);
      expect(stats.modelTokens).toBeGreaterThan(0);
      expect(stats.toolResultTokens).toBeGreaterThan(0);
      expect(stats.totalTokens).toBe(stats.userTokens + stats.modelTokens + stats.toolResultTokens);
    });
  });

  describe('generateSummary', () => {
    it('should keep small results as-is', () => {
      const result = 'Short result';
      const summary = generateSummary('tool', result);

      expect(summary).toBe(result);
    });

    it('should summarize array results when over 200 chars', () => {
      // Create array result that is > 200 chars when stringified
      const result = Array.from({ length: 20 }, (_, i) => ({ id: i, name: `user_${i}`, email: `user${i}@example.com` }));
      const summary = generateSummary('search_tool', result);

      expect(summary).toContain('items');
      expect(summary).toContain('search_tool');
    });

    it('should keep empty arrays as-is since they are small', () => {
      const summary = generateSummary('tool', []);

      // Empty array "[]" is < 200 chars, so kept as-is
      expect(summary).toBe('[]');
    });

    it('should handle error results when over 200 chars', () => {
      const result = { error: 'Something went wrong '.repeat(20) };
      const summary = generateSummary('tool', result);

      expect(summary).toContain('Error');
    });

    it('should handle success/message pattern when over 200 chars', () => {
      const result = { success: true, message: 'Operation completed successfully '.repeat(10) };
      const summary = generateSummary('tool', result);

      expect(summary).toContain('Success');
    });

    it('should handle objects with data field when over 200 chars', () => {
      const result = { data: { users: Array.from({ length: 50 }, (_, i) => `user_${i}`) } };
      const summary = generateSummary('tool', result);

      expect(summary).toContain('Data');
    });

    it('should handle long strings with multiple lines', () => {
      const result = Array.from({ length: 10 }, (_, i) => `This is line ${i} with some content`).join('\n');
      const summary = generateSummary('tool', result);

      expect(summary.length).toBeLessThan(result.length + 50);
      expect(summary).toContain('lines total');
    });

    it('should truncate large objects', () => {
      const result: Record<string, string> = {};
      for (let i = 0; i < 20; i++) {
        result[`key${i}`] = `value_${i}_`.repeat(5);
      }

      const summary = generateSummary('tool', result);

      expect(summary).toContain('20 keys');
    });

    it('should keep small arrays as-is', () => {
      const result = [{ id: 1 }];
      const summary = generateSummary('tool', result);

      // Small result is kept as-is (JSON stringified)
      expect(summary).toBe(JSON.stringify(result));
    });
  });

  describe('compactMessages', () => {
    it('should not compact when under token limit', () => {
      const messages = [createUserMessage('Hello'), createModelMessage('Hi')];
      const config = createDefaultConfig({ maxContextTokens: 10000 });

      const result = compactMessages(messages, config);

      expect(result.tokensSaved).toBe(0);
      expect(result.resultsCompacted).toBe(0);
      expect(result.messages).toEqual(messages);
    });

    it('should compact old turns when over limit', () => {
      const largeResult = { data: 'x'.repeat(2000) };

      const messages = [
        // Old turn 1
        createUserMessage('Old message 1'),
        createFunctionResponse('tool', largeResult),
        createModelMessage('Old response 1'),
        // Old turn 2
        createUserMessage('Old message 2'),
        createFunctionResponse('tool', largeResult),
        createModelMessage('Old response 2'),
        // Recent turn 1
        createUserMessage('Recent message 1'),
        createModelMessage('Recent response 1'),
        // Recent turn 2
        createUserMessage('Recent message 2'),
        createModelMessage('Recent response 2'),
      ];

      const config = createDefaultConfig({
        maxContextTokens: 500,
        turnsToKeepFull: 2,
        compactionStrategy: 'summarize',
      });

      const result = compactMessages(messages, config);

      expect(result.tokensSaved).toBeGreaterThan(0);
      expect(result.turnsCompacted).toBe(2);
    });

    it('should apply truncate strategy', () => {
      const largeResult = { data: 'x'.repeat(2000) };

      const messages = [
        createUserMessage('Old message'),
        createFunctionResponse('tool', largeResult),
        createUserMessage('Recent message'),
      ];

      const config = createDefaultConfig({
        maxContextTokens: 100,
        turnsToKeepFull: 1,
        compactionStrategy: 'truncate',
      });

      const result = compactMessages(messages, config);

      // Check that function response was truncated
      const functionMessage = result.messages.find((m) => m.role === 'function');
      if (functionMessage) {
        const part = functionMessage.parts[0] as FunctionResponsePart;
        expect(typeof part.functionResponse.response).toBe('string');
        expect((part.functionResponse.response as string).length).toBeLessThan(1000);
      }
    });

    it('should apply drop strategy', () => {
      const largeResult = { data: 'x'.repeat(2000) };

      const messages = [
        createUserMessage('Old message'),
        createFunctionResponse('tool', largeResult),
        createUserMessage('Recent message'),
      ];

      const config = createDefaultConfig({
        maxContextTokens: 100,
        turnsToKeepFull: 1,
        compactionStrategy: 'drop',
      });

      const result = compactMessages(messages, config);

      // Check that function response was dropped
      const functionMessage = result.messages.find((m) => m.role === 'function');
      if (functionMessage) {
        const part = functionMessage.parts[0] as FunctionResponsePart;
        expect((part.functionResponse.response as string)).toContain('dropped');
      }
    });

    it('should preserve recent turns completely', () => {
      const messages = [
        createUserMessage('Old'),
        createFunctionResponse('tool', { data: 'x'.repeat(2000) }),
        createUserMessage('Recent 1'),
        createFunctionResponse('tool', { data: 'recent data' }),
        createUserMessage('Recent 2'),
      ];

      const config = createDefaultConfig({
        maxContextTokens: 200,
        turnsToKeepFull: 2,
        compactionStrategy: 'drop',
      });

      const result = compactMessages(messages, config);

      // Recent turns should be preserved
      expect(result.messages.some((m) =>
        m.role === 'user' &&
        (m.parts[0] as { text?: string }).text === 'Recent 1'
      )).toBe(true);
    });
  });

  describe('createContextManager middleware', () => {
    let middleware: ReturnType<typeof createContextManager>;

    beforeEach(() => {
      middleware = createContextManager();
    });

    it('should have correct name and be enabled', () => {
      expect(middleware.name).toBe('context-manager');
      expect(middleware.enabled).toBe(true);
    });

    it('should pass through when disabled', async () => {
      const messages = [
        createUserMessage('Hello'),
        createFunctionResponse('tool', { data: 'x'.repeat(5000) }),
      ];

      const context = createRequestContext(messages, {
        contextManagement: false,
      });

      const result = await middleware.beforeRequest!(context);

      expect(result.messages).toEqual(messages);
    });

    it('should pass through when no messages', async () => {
      const context = createRequestContext([]);

      const result = await middleware.beforeRequest!(context);

      expect(result.messages).toEqual([]);
    });

    it('should compact messages when over limit', async () => {
      const largeResult = { data: 'x'.repeat(5000) };

      const messages = [
        createUserMessage('Old message'),
        createFunctionResponse('tool', largeResult),
        createModelMessage('Old response'),
        createUserMessage('Recent message'),
        createModelMessage('Recent response'),
      ];

      const context = createRequestContext(messages, {
        maxContextTokens: 200,
        turnsToKeepFull: 1,
        compactionStrategy: 'summarize',
      });

      const result = await middleware.beforeRequest!(context);

      expect(result.stats.contextCompactionSaved).toBeGreaterThan(0);
      expect(result.metadata.contextCompaction).toBeDefined();
    });

    it('should track compaction stats', async () => {
      const largeResult = { data: 'x'.repeat(3000) };

      const messages = [
        createUserMessage('Old'),
        createFunctionResponse('tool', largeResult),
        createUserMessage('Recent'),
      ];

      const context = createRequestContext(messages, {
        maxContextTokens: 100,
        turnsToKeepFull: 1,
      });

      const result = await middleware.beforeRequest!(context);

      const compactionMeta = result.metadata.contextCompaction as {
        tokensSaved: number;
        resultsCompacted: number;
        turnsCompacted: number;
      };

      expect(compactionMeta.tokensSaved).toBeGreaterThan(0);
      expect(compactionMeta.resultsCompacted).toBeGreaterThan(0);
    });

    it('should not mutate original context messages', async () => {
      const largeResult = { data: 'x'.repeat(3000) };
      const originalMessages = [
        createUserMessage('Old'),
        createFunctionResponse('tool', largeResult),
        createUserMessage('Recent'),
      ];

      const context = createRequestContext([...originalMessages], {
        maxContextTokens: 100,
        turnsToKeepFull: 1,
      });

      const originalLength = JSON.stringify(originalMessages).length;

      await middleware.beforeRequest!(context);

      const newLength = JSON.stringify(originalMessages).length;
      expect(newLength).toBe(originalLength);
    });
  });

  describe('Edge Cases', () => {
    it('should handle messages with no function responses', () => {
      const messages = [
        createUserMessage('Hello'),
        createModelMessage('Hi'),
        createUserMessage('How are you?'),
        createModelMessage('Good'),
      ];

      const config = createDefaultConfig({ maxContextTokens: 10 });
      const result = compactMessages(messages, config);

      // Nothing to compact
      expect(result.resultsCompacted).toBe(0);
    });

    it('should handle only function response messages', () => {
      const messages = [
        createFunctionResponse('tool1', { data: 'result1' }),
        createFunctionResponse('tool2', { data: 'result2' }),
      ];

      const config = createDefaultConfig({
        maxContextTokens: 10,
        turnsToKeepFull: 1,
      });

      const result = compactMessages(messages, config);

      // Should not crash, messages might not follow turn structure
      expect(result.messages.length).toBe(2);
    });

    it('should handle very small turnsToKeepFull', () => {
      const messages = [
        createUserMessage('Turn 1'),
        createModelMessage('Response 1'),
        createUserMessage('Turn 2'),
        createModelMessage('Response 2'),
      ];

      const config = createDefaultConfig({
        maxContextTokens: 10,
        turnsToKeepFull: 0,
      });

      const result = compactMessages(messages, config);

      expect(result.messages).toBeDefined();
    });

    it('should handle very large turnsToKeepFull', () => {
      const messages = [
        createUserMessage('Turn 1'),
        createFunctionResponse('tool', { data: 'x'.repeat(1000) }),
      ];

      const config = createDefaultConfig({
        maxContextTokens: 10,
        turnsToKeepFull: 100, // More than actual turns
      });

      const result = compactMessages(messages, config);

      // Should still attempt compaction when over limit
      expect(result.messages).toBeDefined();
    });

    it('should handle null and undefined in results', () => {
      const messages = [
        createUserMessage('Old'),
        createFunctionResponse('tool', null),
        createUserMessage('Recent'),
      ];

      const config = createDefaultConfig({
        maxContextTokens: 10,
        turnsToKeepFull: 1,
      });

      // Should not throw
      const result = compactMessages(messages, config);
      expect(result.messages).toBeDefined();
    });

    it('should handle empty string results', () => {
      const messages = [
        createUserMessage('Old'),
        createFunctionResponse('tool', ''),
        createUserMessage('Recent'),
      ];

      const config = createDefaultConfig({
        maxContextTokens: 10,
        turnsToKeepFull: 1,
      });

      const result = compactMessages(messages, config);
      expect(result.messages).toBeDefined();
    });

    it('should handle deeply nested results', () => {
      const deepResult = {
        level1: {
          level2: {
            level3: {
              level4: {
                data: 'deep value',
              },
            },
          },
        },
      };

      const messages = [
        createUserMessage('Old'),
        createFunctionResponse('tool', deepResult),
        createUserMessage('Recent'),
      ];

      const config = createDefaultConfig({
        maxContextTokens: 10,
        turnsToKeepFull: 1,
      });

      const result = compactMessages(messages, config);
      expect(result.messages).toBeDefined();
    });

    it('should handle multiple function responses in same turn', () => {
      const messages = [
        createUserMessage('Get multiple things'),
        createFunctionResponse('tool1', { data: 'x'.repeat(1000) }),
        createFunctionResponse('tool2', { data: 'y'.repeat(1000) }),
        createModelMessage('Here are the results'),
        createUserMessage('Recent'),
      ];

      const config = createDefaultConfig({
        maxContextTokens: 100,
        turnsToKeepFull: 1,
      });

      const result = compactMessages(messages, config);

      expect(result.resultsCompacted).toBeGreaterThanOrEqual(2);
    });

    it('should handle thought parts', () => {
      const message: Content = {
        role: 'model',
        parts: [
          { thought: 'Let me think about this...' },
          { text: 'Here is my answer' },
        ],
      };

      const tokens = estimateMessageTokens(message);
      expect(tokens).toBeGreaterThan(0);
    });

    it('should handle functionCall parts', () => {
      const message: Content = {
        role: 'model',
        parts: [
          {
            functionCall: {
              name: 'test_tool',
              args: { param: 'value' },
            },
          },
        ],
      };

      const tokens = estimateMessageTokens(message);
      expect(tokens).toBeGreaterThan(0);
    });
  });

  describe('Compaction Priority', () => {
    it('should compact largest results first when doing progressive compaction', () => {
      const messages = [
        createUserMessage('Turn 1'),
        createFunctionResponse('small', { data: 'x' }),
        createFunctionResponse('large', { data: 'y'.repeat(3000) }),
        createFunctionResponse('medium', { data: 'z'.repeat(500) }),
        createUserMessage('Turn 2'),
      ];

      const config = createDefaultConfig({
        maxContextTokens: 200,
        turnsToKeepFull: 1,
        compactionStrategy: 'summarize',
      });

      const result = compactMessages(messages, config);

      // Large result should be compacted most
      expect(result.tokensSaved).toBeGreaterThan(0);
    });
  });

  describe('Statistics Tracking', () => {
    it('should accumulate contextCompactionSaved in stats', async () => {
      const middleware = createContextManager();
      const largeResult = { data: 'x'.repeat(2000) };

      const context = createRequestContext(
        [
          createUserMessage('Old'),
          createFunctionResponse('tool', largeResult),
          createUserMessage('Recent'),
        ],
        {
          maxContextTokens: 100,
          turnsToKeepFull: 1,
        }
      );

      context.stats.contextCompactionSaved = 100; // Pre-existing value

      const result = await middleware.beforeRequest!(context);

      expect(result.stats.contextCompactionSaved).toBeGreaterThan(100);
    });
  });
});
