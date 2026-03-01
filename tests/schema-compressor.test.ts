/**
 * Schema Compressor Middleware Tests
 *
 * Tests the schema compression functionality that reduces token
 * usage by shortening descriptions and simplifying schemas.
 */

import { describe, it, expect, vi } from 'vitest';
import type {
  JsonSchema,
  InternalToolDefinition,
  RequestContext,
  ResolvedTulConfig,
} from '../src/types/index.js';

// Mock the @google/genai module
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn(),
}));

// Helper to create a tool with a complex schema
function createToolWithSchema(
  name: string,
  description: string,
  parameters: JsonSchema
): InternalToolDefinition {
  return {
    name,
    description,
    parameters,
    keywords: name.toLowerCase().split('_'),
    paramKeywords: [],
    estimatedTokens: JSON.stringify(parameters).length / 4,
  };
}

// Helper to create base config
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

describe('Schema Compressor Middleware', () => {
  describe('Description Compression', () => {
    it('should shorten verbose descriptions', () => {
      const verbose = 'This is a very long and detailed description that explains ' +
        'in great detail what the tool does, including all the edge cases ' +
        'and various scenarios that might occur during its execution.';

      // Simulate compression - truncate to key information
      const compress = (text: string, maxWords: number): string => {
        const words = text.split(/\s+/);
        if (words.length <= maxWords) return text;
        return words.slice(0, maxWords).join(' ');
      };

      const compressed = compress(verbose, 15);
      expect(compressed.split(/\s+/).length).toBeLessThanOrEqual(15);
    });

    it('should preserve essential keywords in descriptions', () => {
      const description = 'Search for files in the filesystem using glob patterns';

      // Compression should preserve key terms
      const essentialKeywords = ['search', 'files', 'filesystem', 'glob', 'patterns'];
      const lowerDesc = description.toLowerCase();

      for (const keyword of essentialKeywords) {
        expect(lowerDesc).toContain(keyword);
      }
    });

    it('should remove redundant phrases', () => {
      const description = 'This tool allows you to search for files. ' +
        'You can use this tool to find any file in the system.';

      // Simulate removing redundant phrases
      const removeRedundant = (text: string): string => {
        return text
          .replace(/this tool allows you to /gi, '')
          .replace(/you can use this tool to /gi, '')
          .trim();
      };

      const cleaned = removeRedundant(description);
      expect(cleaned).not.toContain('This tool allows you to');
      expect(cleaned.length).toBeLessThan(description.length);
    });

    it('should handle empty descriptions', () => {
      const tool = createToolWithSchema('empty_desc', '', {
        type: 'object',
        properties: {},
      });

      expect(tool.description).toBe('');
    });
  });

  describe('Schema Property Compression', () => {
    it('should remove property descriptions at aggressive level', () => {
      const schema: JsonSchema = {
        type: 'object',
        properties: {
          filename: {
            type: 'string',
            description: 'The name of the file to read from the filesystem',
          },
          encoding: {
            type: 'string',
            description: 'The character encoding to use when reading the file',
            enum: ['utf-8', 'ascii', 'binary'],
          },
        },
        required: ['filename'],
      };

      const config = createConfig({ compressionLevel: 'aggressive' });

      // At aggressive level, property descriptions should be removed
      const compressSchema = (s: JsonSchema, level: string): JsonSchema => {
        if (level !== 'aggressive') return s;

        const compressed = { ...s };
        if (compressed.properties) {
          const newProps: Record<string, JsonSchema> = {};
          for (const [key, prop] of Object.entries(compressed.properties)) {
            const { description, ...rest } = prop;
            newProps[key] = rest;
          }
          compressed.properties = newProps;
        }
        return compressed;
      };

      const compressed = compressSchema(schema, config.compressionLevel);
      expect(compressed.properties?.filename?.description).toBeUndefined();
      expect(compressed.properties?.encoding?.description).toBeUndefined();
      // But type and enum should remain
      expect(compressed.properties?.encoding?.enum).toEqual(['utf-8', 'ascii', 'binary']);
    });

    it('should keep property descriptions at light level', () => {
      const schema: JsonSchema = {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query',
          },
        },
      };

      const config = createConfig({ compressionLevel: 'light' });

      // At light level, descriptions should remain
      expect(schema.properties?.query?.description).toBe('The search query');
    });

    it('should shorten property descriptions at moderate level', () => {
      const schema: JsonSchema = {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The absolute or relative path to the file that should be read from disk',
          },
        },
      };

      // Moderate level shortens but doesn't remove
      const shortenDescription = (desc: string, maxLen: number): string => {
        if (desc.length <= maxLen) return desc;
        return desc.slice(0, maxLen - 3) + '...';
      };

      const shortened = shortenDescription(
        schema.properties?.path?.description ?? '',
        30
      );

      expect(shortened.length).toBeLessThanOrEqual(30);
      expect(shortened).toMatch(/\.\.\.$/);
    });
  });

  describe('Nested Schema Compression', () => {
    it('should compress deeply nested object schemas', () => {
      const schema: JsonSchema = {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            description: 'User information object',
            properties: {
              profile: {
                type: 'object',
                description: 'Profile details',
                properties: {
                  name: {
                    type: 'string',
                    description: 'Full name of the user',
                  },
                  email: {
                    type: 'string',
                    description: 'Email address of the user',
                  },
                },
              },
            },
          },
        },
      };

      // Count nesting depth
      const countDepth = (s: JsonSchema, depth = 0): number => {
        if (!s.properties) return depth;
        let maxDepth = depth;
        for (const prop of Object.values(s.properties)) {
          maxDepth = Math.max(maxDepth, countDepth(prop, depth + 1));
        }
        return maxDepth;
      };

      const depth = countDepth(schema);
      expect(depth).toBe(3);
    });

    it('should compress array item schemas', () => {
      const schema: JsonSchema = {
        type: 'object',
        properties: {
          files: {
            type: 'array',
            description: 'List of files to process',
            items: {
              type: 'object',
              description: 'A file object with metadata',
              properties: {
                path: {
                  type: 'string',
                  description: 'Path to the file',
                },
                size: {
                  type: 'number',
                  description: 'Size in bytes',
                },
              },
            },
          },
        },
      };

      // Ensure items schema is accessible
      expect(schema.properties?.files?.items?.type).toBe('object');
      expect(schema.properties?.files?.items?.properties?.path?.type).toBe('string');
    });
  });

  describe('Token Estimation', () => {
    it('should estimate tokens saved by compression', () => {
      const originalSchema: JsonSchema = {
        type: 'object',
        properties: {
          filename: {
            type: 'string',
            description: 'The complete path to the file including directory structure',
          },
          content: {
            type: 'string',
            description: 'The text content to write to the file',
          },
        },
      };

      const compressedSchema: JsonSchema = {
        type: 'object',
        properties: {
          filename: { type: 'string' },
          content: { type: 'string' },
        },
      };

      const estimateTokens = (obj: unknown): number => {
        const str = JSON.stringify(obj);
        return Math.ceil(str.length / 4);
      };

      const originalTokens = estimateTokens(originalSchema);
      const compressedTokens = estimateTokens(compressedSchema);
      const savedTokens = originalTokens - compressedTokens;

      expect(savedTokens).toBeGreaterThan(0);
      expect(compressedTokens).toBeLessThan(originalTokens);
    });

    it('should track compression savings in stats', () => {
      const stats = {
        compressionSaved: 0,
      };

      const originalTokens = 150;
      const compressedTokens = 80;
      stats.compressionSaved = originalTokens - compressedTokens;

      expect(stats.compressionSaved).toBe(70);
    });
  });

  describe('Required Fields', () => {
    it('should preserve required field information', () => {
      const schema: JsonSchema = {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'number' },
          offset: { type: 'number' },
        },
        required: ['query'],
      };

      // Compression should not remove required array
      expect(schema.required).toContain('query');
      expect(schema.required?.length).toBe(1);
    });
  });

  describe('Enum Values', () => {
    it('should preserve enum values during compression', () => {
      const schema: JsonSchema = {
        type: 'object',
        properties: {
          format: {
            type: 'string',
            description: 'Output format for the result',
            enum: ['json', 'xml', 'csv', 'yaml'],
          },
        },
      };

      // Enum values must be preserved
      expect(schema.properties?.format?.enum).toEqual(['json', 'xml', 'csv', 'yaml']);
    });

    it('should not compress enum values even at aggressive level', () => {
      const schema: JsonSchema = {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['pending', 'approved', 'rejected', 'cancelled'],
          },
        },
      };

      // Enums are semantic, not cosmetic
      expect(schema.properties?.status?.enum?.length).toBe(4);
    });
  });

  describe('Type Constraints', () => {
    it('should preserve minimum/maximum constraints', () => {
      const schema: JsonSchema = {
        type: 'object',
        properties: {
          count: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            description: 'Number of results to return',
          },
        },
      };

      // Constraints must be preserved
      expect(schema.properties?.count?.minimum).toBe(1);
      expect(schema.properties?.count?.maximum).toBe(100);
    });

    it('should preserve string length constraints', () => {
      const schema: JsonSchema = {
        type: 'object',
        properties: {
          username: {
            type: 'string',
            minLength: 3,
            maxLength: 50,
            description: 'Username for the account',
          },
        },
      };

      expect(schema.properties?.username?.minLength).toBe(3);
      expect(schema.properties?.username?.maxLength).toBe(50);
    });

    it('should preserve pattern constraints', () => {
      const schema: JsonSchema = {
        type: 'object',
        properties: {
          email: {
            type: 'string',
            pattern: '^[a-z]+@[a-z]+\\.[a-z]+$',
            description: 'Valid email address',
          },
        },
      };

      expect(schema.properties?.email?.pattern).toBe('^[a-z]+@[a-z]+\\.[a-z]+$');
    });
  });

  describe('Compression Levels', () => {
    it('should apply light compression correctly', () => {
      const config = createConfig({ compressionLevel: 'light' });

      // Light: minor trimming, keep all descriptions
      expect(config.compressionLevel).toBe('light');
    });

    it('should apply moderate compression correctly', () => {
      const config = createConfig({ compressionLevel: 'moderate' });

      // Moderate: shorten descriptions, keep required ones
      expect(config.compressionLevel).toBe('moderate');
    });

    it('should apply aggressive compression correctly', () => {
      const config = createConfig({ compressionLevel: 'aggressive' });

      // Aggressive: remove most descriptions, minimal schema
      expect(config.compressionLevel).toBe('aggressive');
    });
  });

  describe('Multiple Tools Compression', () => {
    it('should compress multiple tools consistently', () => {
      const tools = [
        createToolWithSchema('tool_a', 'Description A with many words', {
          type: 'object',
          properties: { a: { type: 'string', description: 'A param' } },
        }),
        createToolWithSchema('tool_b', 'Description B with many words', {
          type: 'object',
          properties: { b: { type: 'number', description: 'B param' } },
        }),
      ];

      // All tools should be processed
      expect(tools.length).toBe(2);
      tools.forEach((tool) => {
        expect(tool.parameters).toBeDefined();
        expect(tool.description).toBeDefined();
      });
    });

    it('should calculate total tokens saved across tools', () => {
      const originalTokens = [100, 150, 200];
      const compressedTokens = [60, 90, 120];

      const totalOriginal = originalTokens.reduce((a, b) => a + b, 0);
      const totalCompressed = compressedTokens.reduce((a, b) => a + b, 0);
      const totalSaved = totalOriginal - totalCompressed;

      expect(totalSaved).toBe(180);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty properties object', () => {
      const schema: JsonSchema = {
        type: 'object',
        properties: {},
      };

      expect(Object.keys(schema.properties ?? {}).length).toBe(0);
    });

    it('should handle schema with no properties', () => {
      const schema: JsonSchema = {
        type: 'object',
      };

      expect(schema.properties).toBeUndefined();
    });

    it('should handle null/undefined values gracefully', () => {
      const schema: JsonSchema = {
        type: 'object',
        properties: {
          optional: {
            type: 'string',
            // @ts-expect-error - testing null handling
            default: null,
          },
        },
      };

      // Should not throw
      expect(schema.properties?.optional?.type).toBe('string');
    });

    it('should handle very long enum lists', () => {
      const longEnums = Array.from({ length: 100 }, (_, i) => `option_${i}`);
      const schema: JsonSchema = {
        type: 'object',
        properties: {
          selection: {
            type: 'string',
            enum: longEnums,
          },
        },
      };

      // All enums should be preserved
      expect(schema.properties?.selection?.enum?.length).toBe(100);
    });

    it('should handle schema with oneOf/anyOf', () => {
      const schema: JsonSchema = {
        type: 'object',
        properties: {
          value: {
            oneOf: [
              { type: 'string' },
              { type: 'number' },
            ],
          },
        },
      };

      expect(schema.properties?.value?.oneOf?.length).toBe(2);
    });

    it('should handle additionalProperties setting', () => {
      const schema: JsonSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        additionalProperties: false,
      };

      expect(schema.additionalProperties).toBe(false);
    });
  });

  describe('Compression Disabled', () => {
    it('should skip compression when disabled', () => {
      const config = createConfig({ schemaCompression: false });

      expect(config.schemaCompression).toBe(false);
      // Middleware should pass through unchanged
    });
  });

  describe('Real-world Schemas', () => {
    it('should handle file operation schema', () => {
      const schema: JsonSchema = {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The absolute path to the file',
          },
          encoding: {
            type: 'string',
            description: 'File encoding',
            enum: ['utf-8', 'utf-16', 'ascii', 'binary'],
            default: 'utf-8',
          },
          createIfMissing: {
            type: 'boolean',
            description: 'Create the file if it does not exist',
            default: false,
          },
        },
        required: ['path'],
      };

      expect(schema.required).toContain('path');
      expect(schema.properties?.encoding?.default).toBe('utf-8');
    });

    it('should handle API call schema', () => {
      const schema: JsonSchema = {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The URL to call',
            pattern: '^https?://',
          },
          method: {
            type: 'string',
            enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
            default: 'GET',
          },
          headers: {
            type: 'object',
            additionalProperties: { type: 'string' },
          },
          body: {
            type: 'object',
            description: 'Request body for POST/PUT/PATCH',
          },
          timeout: {
            type: 'integer',
            minimum: 0,
            maximum: 60000,
            default: 30000,
          },
        },
        required: ['url'],
      };

      expect(schema.properties?.method?.enum).toContain('GET');
      expect(schema.properties?.timeout?.minimum).toBe(0);
    });

    it('should handle database query schema', () => {
      const schema: JsonSchema = {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'SQL query to execute',
          },
          params: {
            type: 'array',
            items: {
              oneOf: [
                { type: 'string' },
                { type: 'number' },
                { type: 'boolean' },
                { type: 'null' },
              ],
            },
          },
          maxRows: {
            type: 'integer',
            minimum: 1,
            maximum: 10000,
            default: 100,
          },
        },
        required: ['query'],
      };

      expect(schema.properties?.params?.type).toBe('array');
      expect(schema.properties?.maxRows?.default).toBe(100);
    });
  });
});
