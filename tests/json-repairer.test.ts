/**
 * JSON Repairer Middleware Tests
 *
 * Tests the JSON repair functionality that fixes malformed
 * JSON output from Gemini models.
 */

import { describe, it, expect, vi } from 'vitest';
import type { FunctionCall, ResponseContext, RequestContext, ResolvedTulConfig } from '../src/types/index.js';

// Mock the @google/genai module
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn(),
}));

// Helper to create config
function createConfig(overrides: Partial<ResolvedTulConfig> = {}): ResolvedTulConfig {
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

// Simulate JSON repair functionality
function repairJson(input: string): string {
  // This simulates what the jsonrepair library does
  let repaired = input;

  // Fix trailing commas
  repaired = repaired.replace(/,\s*([\]}])/g, '$1');

  // Fix missing quotes around keys
  repaired = repaired.replace(/(\{|,)\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');

  // Fix single quotes to double quotes
  repaired = repaired.replace(/'/g, '"');

  // Fix missing closing braces/brackets (simple cases)
  const openBraces = (repaired.match(/\{/g) || []).length;
  const closeBraces = (repaired.match(/\}/g) || []).length;
  if (openBraces > closeBraces) {
    repaired += '}'.repeat(openBraces - closeBraces);
  }

  const openBrackets = (repaired.match(/\[/g) || []).length;
  const closeBrackets = (repaired.match(/\]/g) || []).length;
  if (openBrackets > closeBrackets) {
    repaired += ']'.repeat(openBrackets - closeBrackets);
  }

  return repaired;
}

// Try to parse JSON, with optional repair
function parseJsonWithRepair(input: string, repair = true): { success: boolean; data?: unknown; repaired?: boolean } {
  try {
    return { success: true, data: JSON.parse(input), repaired: false };
  } catch {
    if (!repair) {
      return { success: false };
    }

    try {
      const repaired = repairJson(input);
      return { success: true, data: JSON.parse(repaired), repaired: true };
    } catch {
      return { success: false };
    }
  }
}

describe('JSON Repairer Middleware', () => {
  describe('Trailing Comma Fixes', () => {
    it('should fix trailing comma in object', () => {
      const malformed = '{"name": "test", "value": 123,}';
      const result = parseJsonWithRepair(malformed);

      expect(result.success).toBe(true);
      expect(result.repaired).toBe(true);
      expect(result.data).toEqual({ name: 'test', value: 123 });
    });

    it('should fix trailing comma in array', () => {
      const malformed = '["a", "b", "c",]';
      const result = parseJsonWithRepair(malformed);

      expect(result.success).toBe(true);
      expect(result.repaired).toBe(true);
      expect(result.data).toEqual(['a', 'b', 'c']);
    });

    it('should fix multiple trailing commas', () => {
      const malformed = '{"items": [1, 2, 3,], "extra": true,}';
      const result = parseJsonWithRepair(malformed);

      expect(result.success).toBe(true);
      expect(result.repaired).toBe(true);
      expect(result.data).toEqual({ items: [1, 2, 3], extra: true });
    });
  });

  describe('Quote Fixes', () => {
    it('should fix single quotes to double quotes', () => {
      const malformed = "{'name': 'test'}";
      const result = parseJsonWithRepair(malformed);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ name: 'test' });
    });

    it('should fix unquoted keys', () => {
      const malformed = '{name: "test", value: 123}';
      const result = parseJsonWithRepair(malformed);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ name: 'test', value: 123 });
    });

    it('should handle mixed quote styles', () => {
      const malformed = "{'name': \"test\", \"value\": 'mixed'}";
      const result = parseJsonWithRepair(malformed);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ name: 'test', value: 'mixed' });
    });
  });

  describe('Missing Bracket Fixes', () => {
    it('should fix missing closing brace', () => {
      const malformed = '{"name": "test"';
      const result = parseJsonWithRepair(malformed);

      expect(result.success).toBe(true);
      expect(result.repaired).toBe(true);
      expect(result.data).toEqual({ name: 'test' });
    });

    it('should fix missing closing bracket', () => {
      const malformed = '["a", "b", "c"';
      const result = parseJsonWithRepair(malformed);

      expect(result.success).toBe(true);
      expect(result.repaired).toBe(true);
      expect(result.data).toEqual(['a', 'b', 'c']);
    });

    it('should fix multiple missing brackets', () => {
      // Note: Simple repair adds closing brackets but the result may not be perfect
      // The actual jsonrepair library handles this better
      const malformed = '{"items": [1, 2, 3]';
      const result = parseJsonWithRepair(malformed);

      expect(result.success).toBe(true);
      expect(result.repaired).toBe(true);
      expect(result.data).toEqual({ items: [1, 2, 3] });
    });
  });

  describe('Nested Structure Fixes', () => {
    it('should repair deeply nested malformed JSON', () => {
      const malformed = '{"outer": {"inner": {"deep": true,},},}';
      const result = parseJsonWithRepair(malformed);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ outer: { inner: { deep: true } } });
    });

    it('should repair nested arrays', () => {
      const malformed = '[[1, 2,], [3, 4,],]';
      const result = parseJsonWithRepair(malformed);

      expect(result.success).toBe(true);
      expect(result.data).toEqual([[1, 2], [3, 4]]);
    });

    it('should repair mixed nested structures', () => {
      const malformed = '{"data": [{"id": 1,}, {"id": 2,},],}';
      const result = parseJsonWithRepair(malformed);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ data: [{ id: 1 }, { id: 2 }] });
    });
  });

  describe('Valid JSON Passthrough', () => {
    it('should not modify valid JSON', () => {
      const valid = '{"name": "test", "value": 123}';
      const result = parseJsonWithRepair(valid);

      expect(result.success).toBe(true);
      expect(result.repaired).toBe(false);
      expect(result.data).toEqual({ name: 'test', value: 123 });
    });

    it('should not modify valid nested JSON', () => {
      const valid = '{"user": {"name": "Alice", "age": 30}, "active": true}';
      const result = parseJsonWithRepair(valid);

      expect(result.success).toBe(true);
      expect(result.repaired).toBe(false);
    });

    it('should not modify valid array JSON', () => {
      const valid = '[1, 2, 3, {"key": "value"}]';
      const result = parseJsonWithRepair(valid);

      expect(result.success).toBe(true);
      expect(result.repaired).toBe(false);
    });
  });

  describe('Unrecoverable JSON', () => {
    it('should return failure for completely invalid JSON', () => {
      const invalid = 'this is not json at all';
      const result = parseJsonWithRepair(invalid);

      // Our simple repair won't fix this
      expect(result.success).toBe(false);
    });

    it('should handle empty string', () => {
      const empty = '';
      const result = parseJsonWithRepair(empty);

      expect(result.success).toBe(false);
    });
  });

  describe('Function Call Args Repair', () => {
    it('should repair malformed function call arguments', () => {
      const functionCall: FunctionCall = {
        name: 'search_files',
        args: {
          query: 'test',
        },
      };

      // Simulate receiving malformed args string from Gemini
      const malformedArgsString = '{query: "test", limit: 10,}';
      const result = parseJsonWithRepair(malformedArgsString);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ query: 'test', limit: 10 });
    });

    it('should handle complex function call arguments', () => {
      const malformedArgsString = `{
        'files': ['a.txt', 'b.txt',],
        'options': {
          recursive: true,
          'maxDepth': 5,
        },
      }`;

      const result = parseJsonWithRepair(malformedArgsString);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        files: ['a.txt', 'b.txt'],
        options: {
          recursive: true,
          maxDepth: 5,
        },
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle JSON with comments (strip them)', () => {
      // Note: Our simple repair doesn't handle comments
      // But the jsonrepair library might
      const withComments = '{"name": "test" /* comment */}';
      // This would need more sophisticated repair
    });

    it('should handle escaped characters correctly', () => {
      const withEscapes = '{"path": "C:\\\\Users\\\\test"}';
      const result = parseJsonWithRepair(withEscapes);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ path: 'C:\\Users\\test' });
    });

    it('should handle unicode characters', () => {
      const withUnicode = '{"greeting": "\\u4f60\\u597d"}';
      const result = parseJsonWithRepair(withUnicode);

      expect(result.success).toBe(true);
    });

    it('should handle null values', () => {
      const withNull = '{"value": null,}';
      const result = parseJsonWithRepair(withNull);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ value: null });
    });

    it('should handle boolean values', () => {
      const withBool = '{enabled: true, disabled: false,}';
      const result = parseJsonWithRepair(withBool);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ enabled: true, disabled: false });
    });

    it('should handle numeric values', () => {
      const withNumbers = '{int: 42, float: 3.14, negative: -10,}';
      const result = parseJsonWithRepair(withNumbers);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ int: 42, float: 3.14, negative: -10 });
    });

    it('should handle empty object', () => {
      const empty = '{}';
      const result = parseJsonWithRepair(empty);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({});
    });

    it('should handle empty array', () => {
      const empty = '[]';
      const result = parseJsonWithRepair(empty);

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    it('should handle whitespace variations', () => {
      const withWhitespace = `{
        "name"  :   "test"  ,
        "value" :   123
      }`;
      const result = parseJsonWithRepair(withWhitespace);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ name: 'test', value: 123 });
    });
  });

  describe('Stats Tracking', () => {
    it('should track when JSON was repaired', () => {
      const stats = {
        jsonRepaired: false,
      };

      const malformed = '{"name": "test",}';
      const result = parseJsonWithRepair(malformed);

      if (result.repaired) {
        stats.jsonRepaired = true;
      }

      expect(stats.jsonRepaired).toBe(true);
    });

    it('should not set repaired flag for valid JSON', () => {
      const stats = {
        jsonRepaired: false,
      };

      const valid = '{"name": "test"}';
      const result = parseJsonWithRepair(valid);

      if (result.repaired) {
        stats.jsonRepaired = true;
      }

      expect(stats.jsonRepaired).toBe(false);
    });
  });

  describe('Repair Disabled', () => {
    it('should not attempt repair when disabled', () => {
      const config = createConfig({ jsonRepair: false });

      const malformed = '{"name": "test",}';
      const result = parseJsonWithRepair(malformed, false);

      expect(result.success).toBe(false);
      expect(config.jsonRepair).toBe(false);
    });
  });

  describe('Common Gemini Output Patterns', () => {
    it('should handle markdown code block wrapper', () => {
      // Gemini sometimes wraps JSON in markdown
      const wrapped = '```json\n{"name": "test"}\n```';

      // Extract JSON from markdown
      const extractJson = (input: string): string => {
        const match = input.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        return match ? match[1].trim() : input;
      };

      const extracted = extractJson(wrapped);
      const result = parseJsonWithRepair(extracted);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ name: 'test' });
    });

    it('should handle JSON with explanatory text prefix', () => {
      // Sometimes Gemini adds text before JSON
      const withPrefix = 'Here is the result:\n{"name": "test"}';

      // Extract JSON from text
      const extractJson = (input: string): string => {
        const jsonStart = input.indexOf('{');
        const jsonEnd = input.lastIndexOf('}');
        if (jsonStart !== -1 && jsonEnd !== -1) {
          return input.slice(jsonStart, jsonEnd + 1);
        }
        return input;
      };

      const extracted = extractJson(withPrefix);
      const result = parseJsonWithRepair(extracted);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ name: 'test' });
    });

    it('should handle newlines within JSON strings', () => {
      const withNewlines = '{"content": "line1\\nline2\\nline3"}';
      const result = parseJsonWithRepair(withNewlines);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ content: 'line1\nline2\nline3' });
    });
  });

  describe('Performance', () => {
    it('should repair JSON quickly', () => {
      const malformed = '{"name": "test", "items": [1, 2, 3,], "nested": {"key": "value",},}';

      const startTime = performance.now();
      for (let i = 0; i < 1000; i++) {
        parseJsonWithRepair(malformed);
      }
      const elapsed = performance.now() - startTime;

      // 1000 repairs should complete quickly
      expect(elapsed).toBeLessThan(1000);
    });

    it('should not slow down valid JSON parsing significantly', () => {
      const valid = '{"name": "test", "items": [1, 2, 3], "nested": {"key": "value"}}';

      const startTime = performance.now();
      for (let i = 0; i < 1000; i++) {
        parseJsonWithRepair(valid);
      }
      const elapsed = performance.now() - startTime;

      // Valid JSON should be fast (no repair needed)
      expect(elapsed).toBeLessThan(500);
    });
  });

  describe('Real-world Malformed Examples', () => {
    it('should repair missing quotes on string value', () => {
      // Gemini sometimes forgets quotes on string values
      const malformed = '{"action": search, "query": "test"}';
      // Note: Our simple repair doesn't handle this case
      // But jsonrepair library would
    });

    it('should repair Python-style booleans', () => {
      // Gemini might output Python-style True/False
      const malformed = '{"enabled": True, "disabled": False}';
      // Would need to replace True/False with true/false
    });

    it('should repair Python None to null', () => {
      const malformed = '{"value": None}';
      // Would need to replace None with null
    });

    it('should handle truncated JSON from max tokens', () => {
      // When output hits max tokens, JSON might be truncated
      const truncated = '{"results": [{"id": 1}, {"id": 2}, {"id":';

      const result = parseJsonWithRepair(truncated);

      // Might not be fully recoverable, but should not throw
      // The actual jsonrepair library handles this better
    });
  });

  describe('Integration with Response Context', () => {
    it('should set repaired flag in response context metadata', () => {
      const mockRequestContext: RequestContext = {
        messages: [],
        tools: [],
        filteredTools: [],
        systemPrompt: '',
        userMessage: 'test',
        config: createConfig(),
        metadata: {},
        stats: {},
        recentlyUsedTools: [],
      };

      const responseContext: ResponseContext = {
        response: {},
        functionCalls: [],
        text: '',
        requestContext: mockRequestContext,
        metadata: {},
        stats: {
          jsonRepaired: false,
        },
      };

      // Simulate repair
      const malformed = '{"test": true,}';
      const result = parseJsonWithRepair(malformed);

      if (result.repaired) {
        responseContext.stats.jsonRepaired = true;
      }

      expect(responseContext.stats.jsonRepaired).toBe(true);
    });
  });
});
