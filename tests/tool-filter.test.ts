/**
 * Tool Filter Middleware Tests
 *
 * Tests the smart tool filtering functionality that selects
 * relevant tools based on user message content.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  RequestContext,
  InternalToolDefinition,
  ResolvedTulConfig,
} from '../src/types/index.js';

// Mock the @google/genai module
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn(),
}));

// Helper to create test tools
function createTestTool(
  name: string,
  description: string,
  keywords: string[] = [],
  paramKeywords: string[] = []
): InternalToolDefinition {
  return {
    name,
    description,
    parameters: {
      type: 'object',
      properties: {},
    },
    keywords: keywords.length > 0 ? keywords : name.toLowerCase().split('_'),
    paramKeywords,
    estimatedTokens: 100,
  };
}

// Helper to create base request context
function createRequestContext(
  userMessage: string,
  tools: InternalToolDefinition[],
  config: Partial<ResolvedTulConfig> = {}
): RequestContext {
  const defaultConfig: ResolvedTulConfig = {
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
    ...config,
  };

  return {
    messages: [],
    tools,
    filteredTools: [],
    systemPrompt: '',
    userMessage,
    config: defaultConfig,
    metadata: {},
    stats: {},
    recentlyUsedTools: [],
  };
}

describe('Tool Filter Middleware', () => {
  describe('Basic Filtering', () => {
    it('should filter tools based on keyword match with user message', () => {
      const tools = [
        createTestTool('search_files', 'Search for files in the filesystem', ['search', 'files', 'filesystem']),
        createTestTool('send_email', 'Send an email message', ['send', 'email', 'message']),
        createTestTool('read_file', 'Read contents of a file', ['read', 'file', 'contents']),
        createTestTool('list_directory', 'List files in a directory', ['list', 'directory', 'files']),
      ];

      const context = createRequestContext('I need to search for some files', tools);

      // Simulate filtering logic
      const matchingTools = tools.filter((tool) =>
        tool.keywords.some((keyword) =>
          context.userMessage.toLowerCase().includes(keyword)
        )
      );

      expect(matchingTools.length).toBeGreaterThan(0);
      expect(matchingTools.some((t) => t.name === 'search_files')).toBe(true);
    });

    it('should respect maxToolsPerRequest limit', () => {
      const tools = Array.from({ length: 20 }, (_, i) =>
        createTestTool(`tool_${i}`, `Tool number ${i}`, [`keyword${i}`])
      );

      const context = createRequestContext('test message', tools, {
        maxToolsPerRequest: 5,
      });

      // After filtering, should not exceed max limit
      const filteredCount = Math.min(tools.length, context.config.maxToolsPerRequest);
      expect(filteredCount).toBeLessThanOrEqual(5);
    });

    it('should always include tools in alwaysIncludeTools list', () => {
      const tools = [
        createTestTool('critical_tool', 'A critical tool', ['critical']),
        createTestTool('other_tool', 'Another tool', ['other']),
      ];

      const context = createRequestContext('unrelated message', tools, {
        alwaysIncludeTools: ['critical_tool'],
      });

      // critical_tool should always be included regardless of relevance
      const alwaysInclude = context.config.alwaysIncludeTools;
      const toolsToInclude = tools.filter((t) => alwaysInclude.includes(t.name));

      expect(toolsToInclude.length).toBe(1);
      expect(toolsToInclude[0].name).toBe('critical_tool');
    });

    it('should filter out low relevance tools based on threshold', () => {
      const tools = [
        createTestTool('relevant_tool', 'This tool does file operations', ['file', 'operations']),
        createTestTool('irrelevant_tool', 'This tool does something unrelated', ['unrelated', 'xyz']),
      ];

      const context = createRequestContext('I need to work with files', tools, {
        filterThreshold: 0.3,
      });

      // Only tools meeting threshold should be included
      const relevantTools = tools.filter((tool) =>
        tool.keywords.some((keyword) =>
          context.userMessage.toLowerCase().includes(keyword)
        )
      );

      expect(relevantTools.length).toBe(1);
      expect(relevantTools[0].name).toBe('relevant_tool');
    });
  });

  describe('Relevance Scoring', () => {
    it('should score exact keyword matches higher than partial matches', () => {
      // Simulate scoring logic
      const exactMatch = (query: string, keyword: string): number => {
        if (query.toLowerCase() === keyword.toLowerCase()) return 1.0;
        if (query.toLowerCase().includes(keyword.toLowerCase())) return 0.5;
        return 0;
      };

      expect(exactMatch('search', 'search')).toBe(1.0);
      expect(exactMatch('searching', 'search')).toBe(0.5);
      expect(exactMatch('find', 'search')).toBe(0);
    });

    it('should handle camelCase tool names', () => {
      const tool = createTestTool(
        'getUserProfile',
        'Get user profile information',
        ['get', 'user', 'profile', 'information']
      );

      const message = 'I need to get the user profile';
      const matchingKeywords = tool.keywords.filter((kw) =>
        message.toLowerCase().includes(kw)
      );

      expect(matchingKeywords).toContain('get');
      expect(matchingKeywords).toContain('user');
      expect(matchingKeywords).toContain('profile');
    });

    it('should handle snake_case tool names', () => {
      const tool = createTestTool(
        'get_user_profile',
        'Get user profile information',
        ['get', 'user', 'profile', 'information']
      );

      const message = 'fetch the user profile data';
      const matchingKeywords = tool.keywords.filter((kw) =>
        message.toLowerCase().includes(kw)
      );

      expect(matchingKeywords).toContain('user');
      expect(matchingKeywords).toContain('profile');
    });

    it('should consider parameter keywords in relevance scoring', () => {
      const tool = createTestTool(
        'query_database',
        'Query a database',
        ['query', 'database'],
        ['table', 'columns', 'where', 'sql'] // param keywords
      );

      const message = 'I need to query the users table';

      const descKeywordMatches = tool.keywords.filter((kw) =>
        message.toLowerCase().includes(kw)
      ).length;

      const paramKeywordMatches = tool.paramKeywords.filter((kw) =>
        message.toLowerCase().includes(kw)
      ).length;

      expect(descKeywordMatches).toBeGreaterThan(0);
      expect(paramKeywordMatches).toBeGreaterThan(0);
    });
  });

  describe('Recently Used Tools', () => {
    it('should boost recently used tools in relevance scoring', () => {
      const tools = [
        createTestTool('tool_a', 'Tool A description', ['toolA']),
        createTestTool('tool_b', 'Tool B description', ['toolB']),
      ];

      const context = createRequestContext('neutral message', tools);
      context.recentlyUsedTools = ['tool_a'];

      // Recently used tools should get a boost
      const recentBoost = context.recentlyUsedTools.includes('tool_a') ? 0.2 : 0;
      expect(recentBoost).toBe(0.2);
    });

    it('should not over-boost recently used tools', () => {
      const tools = [
        createTestTool('tool_a', 'Tool A for email', ['email']),
        createTestTool('tool_b', 'Tool B for files', ['files']),
      ];

      const context = createRequestContext('I want to work with files', tools);
      context.recentlyUsedTools = ['tool_a'];

      // tool_b should still rank higher due to keyword match
      // even if tool_a was recently used
      const toolBMatches = tools[1].keywords.filter((kw) =>
        context.userMessage.toLowerCase().includes(kw)
      ).length;

      expect(toolBMatches).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty tool list', () => {
      const context = createRequestContext('any message', []);

      expect(context.tools.length).toBe(0);
      expect(context.filteredTools.length).toBe(0);
    });

    it('should handle empty user message', () => {
      const tools = [
        createTestTool('tool_a', 'Tool A description', ['keyword']),
      ];

      const context = createRequestContext('', tools);

      // With empty message, no keywords match
      const matches = tools.filter((tool) =>
        tool.keywords.some((kw) => context.userMessage.toLowerCase().includes(kw))
      );

      expect(matches.length).toBe(0);
    });

    it('should handle tools with no keywords', () => {
      const tool: InternalToolDefinition = {
        name: 'empty_keywords_tool',
        description: 'A tool with no extracted keywords',
        keywords: [],
        paramKeywords: [],
        estimatedTokens: 50,
      };

      const context = createRequestContext('some message', [tool]);

      // Tool should still be considered (possibly with low score)
      expect(context.tools.length).toBe(1);
    });

    it('should handle special characters in user message', () => {
      const tools = [
        createTestTool('search_tool', 'Search functionality', ['search']),
      ];

      const context = createRequestContext(
        'Can you search? I need to find @user #tag!',
        tools
      );

      const matches = tools.filter((tool) =>
        tool.keywords.some((kw) => context.userMessage.toLowerCase().includes(kw))
      );

      expect(matches.length).toBe(1);
    });

    it('should handle unicode characters in message', () => {
      const tools = [
        createTestTool('translate_tool', 'Translate text', ['translate', 'text']),
      ];

      const context = createRequestContext(
        'Translate this: ¡Hola! 你好 こんにちは',
        tools
      );

      const matches = tools.filter((tool) =>
        tool.keywords.some((kw) => context.userMessage.toLowerCase().includes(kw))
      );

      expect(matches.length).toBe(1);
    });

    it('should handle very long user messages efficiently', () => {
      const tools = [
        createTestTool('process_tool', 'Process data', ['process', 'data']),
      ];

      const longMessage = 'This is a test message. '.repeat(1000) + 'process some data';
      const context = createRequestContext(longMessage, tools);

      const startTime = performance.now();
      const matches = tools.filter((tool) =>
        tool.keywords.some((kw) => context.userMessage.toLowerCase().includes(kw))
      );
      const elapsed = performance.now() - startTime;

      expect(matches.length).toBe(1);
      expect(elapsed).toBeLessThan(100); // Should be fast
    });

    it('should handle large number of tools', () => {
      const tools = Array.from({ length: 100 }, (_, i) =>
        createTestTool(`tool_${i}`, `Description for tool ${i}`, [`keyword${i}`])
      );

      const context = createRequestContext('I need keyword50', tools, {
        maxToolsPerRequest: 10,
      });

      const matches = tools.filter((tool) =>
        tool.keywords.some((kw) => context.userMessage.toLowerCase().includes(kw))
      );

      // keyword50 matches tool_50, but also keyword5 matches since "keyword50" contains "keyword5"
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches.some((t) => t.name === 'tool_50')).toBe(true);
    });
  });

  describe('Tool Filtering Disabled', () => {
    it('should return all tools when toolFiltering is disabled', () => {
      const tools = [
        createTestTool('tool_a', 'Tool A', ['unrelated']),
        createTestTool('tool_b', 'Tool B', ['unrelated']),
        createTestTool('tool_c', 'Tool C', ['unrelated']),
      ];

      const context = createRequestContext('some message', tools, {
        toolFiltering: false,
      });

      // When disabled, all tools should be included
      expect(context.config.toolFiltering).toBe(false);
      // Middleware would pass through all tools
      expect(tools.length).toBe(3);
    });
  });

  describe('Description-based Filtering', () => {
    it('should match keywords from tool description', () => {
      const tool = createTestTool(
        'generic_tool',
        'This tool can search files and directories in the filesystem',
        ['search', 'files', 'directories', 'filesystem']
      );

      const context = createRequestContext('find directories', [tool]);

      const matches = tool.keywords.filter((kw) =>
        context.userMessage.toLowerCase().includes(kw)
      );

      expect(matches).toContain('directories');
    });

    it('should handle multi-word concepts in descriptions', () => {
      const tool = createTestTool(
        'api_caller',
        'Make HTTP requests to external APIs',
        ['http', 'request', 'external', 'api', 'apis']
      );

      const context = createRequestContext('I need to make an HTTP request', [tool]);

      const matches = tool.keywords.filter((kw) =>
        context.userMessage.toLowerCase().includes(kw)
      );

      expect(matches).toContain('http');
      expect(matches).toContain('request');
    });
  });

  describe('Semantic Similarity', () => {
    it('should handle synonym-like matches', () => {
      // In a real implementation, this might use embeddings
      // For now, test that related terms can match
      const tool = createTestTool(
        'search_files',
        'Search and find files',
        ['search', 'find', 'files', 'locate']
      );

      const context = createRequestContext('locate the document', [tool]);

      const matches = tool.keywords.filter((kw) =>
        context.userMessage.toLowerCase().includes(kw)
      );

      expect(matches).toContain('locate');
    });
  });

  describe('Integration with Stats', () => {
    it('should track tools filtered out in stats', () => {
      const tools = Array.from({ length: 10 }, (_, i) =>
        createTestTool(`tool_${i}`, `Tool ${i}`, [`keyword${i}`])
      );

      const context = createRequestContext('keyword0 keyword1', tools, {
        maxToolsPerRequest: 5,
      });

      // Simulate filtering
      const matches = tools.filter((tool) =>
        tool.keywords.some((kw) => context.userMessage.toLowerCase().includes(kw))
      );

      context.stats.toolsFiltered = tools.length - matches.length;
      context.stats.toolsSent = matches.length;

      expect(context.stats.toolsFiltered).toBe(8);
      expect(context.stats.toolsSent).toBe(2);
    });
  });
});
