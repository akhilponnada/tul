/**
 * Example Injector Middleware
 *
 * Injects tool examples into the system prompt to help Gemini understand
 * expected input patterns (Claude-inspired approach).
 *
 * Features:
 * - Query-relevant example selection (shows examples similar to current query)
 * - Diverse examples covering edge cases and common patterns
 * - Clear formatting to guide tool selection
 * - Enhanced handling for ambiguous tools with disambiguation hints
 * - Validates examples against tool schemas
 * - Tracks token cost of injected examples
 */

import type {
  Middleware,
  RequestContext,
  InternalToolDefinition,
  JsonSchema,
} from '../types/index.js';
import { validateAgainstSchema, estimateTokens } from '../utils/schema-utils.js';
import { getLogger } from '../utils/logger.js';

const logger = getLogger().child('example-injector');

// ═══════════════════════════════════════════════════════════════════════════════
// Example Categories for Edge Cases
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Categories of examples for comprehensive coverage
 */
export type ExampleCategory =
  | 'basic'           // Simple, typical usage
  | 'edge_case'       // Boundary conditions, special values
  | 'complex'         // Nested objects, arrays, multiple params
  | 'minimal'         // Only required params
  | 'maximal'         // All params including optional
  | 'disambiguation'; // Clarifies when to use this vs similar tools

/**
 * Extended example with metadata for smart selection
 */
export interface AnnotatedExample {
  /** The actual example data */
  data: Record<string, unknown>;
  /** Category for diverse selection */
  category?: ExampleCategory;
  /** Keywords that make this example relevant */
  keywords?: string[];
  /** Description of what this example demonstrates */
  description?: string;
  /** When to use this tool (for disambiguation) */
  useWhen?: string;
  /** When NOT to use this tool (for disambiguation) */
  notWhen?: string;
}

/**
 * Parsed example from tool definition (can be simple or annotated)
 */
interface ParsedExample {
  data: Record<string, unknown>;
  category: ExampleCategory;
  keywords: string[];
  description?: string;
  useWhen?: string;
  notWhen?: string;
  relevanceScore: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Result of example validation
 */
interface ExampleValidationResult {
  valid: boolean;
  errors: string[];
  toolName: string;
  exampleIndex: number;
}

/**
 * Formatted example for injection
 */
interface FormattedExample {
  toolName: string;
  example: ParsedExample;
  tokenCost: number;
}

/**
 * Statistics from example injection
 */
export interface ExampleInjectionStats {
  examplesInjected: number;
  exampleTokens: number;
  examplesSkipped: number;
  validationErrors: ExampleValidationResult[];
  queryRelevantExamples: number;
  categoryCoverage: Record<ExampleCategory, number>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Query Relevance Scoring
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Extract keywords from text for relevance matching
 */
function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .filter((word) => !STOP_WORDS.has(word));
}

/**
 * Common stop words to exclude from keyword matching
 */
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'her',
  'was', 'one', 'our', 'out', 'has', 'have', 'been', 'were', 'being',
  'each', 'which', 'she', 'how', 'their', 'will', 'would', 'there',
  'what', 'about', 'when', 'make', 'like', 'just', 'over', 'such',
  'into', 'than', 'them', 'some', 'could', 'other', 'after', 'most',
  'also', 'any', 'these', 'with', 'this', 'that', 'from',
]);

/**
 * Calculate relevance score between query and example keywords
 */
function calculateRelevanceScore(
  queryKeywords: string[],
  exampleKeywords: string[],
  toolKeywords: string[]
): number {
  if (queryKeywords.length === 0) return 0.5; // Default score if no query

  const querySet = new Set(queryKeywords);
  let score = 0;

  // Direct keyword matches (high weight)
  for (const keyword of exampleKeywords) {
    if (querySet.has(keyword)) {
      score += 2;
    }
    // Partial matches
    for (const queryWord of queryKeywords) {
      if (keyword.includes(queryWord) || queryWord.includes(keyword)) {
        score += 0.5;
      }
    }
  }

  // Tool keyword matches (medium weight)
  for (const keyword of toolKeywords) {
    if (querySet.has(keyword)) {
      score += 1;
    }
  }

  // Normalize by query length
  return Math.min(1, score / (queryKeywords.length * 2));
}

/**
 * Parse an example from tool definition (supports both simple and annotated formats)
 */
function parseExample(
  rawExample: Record<string, unknown>,
  toolKeywords: string[],
  queryKeywords: string[]
): ParsedExample {
  // Check if this is an annotated example
  if (rawExample._annotated && typeof rawExample.data === 'object') {
    const annotated = rawExample as unknown as AnnotatedExample & { _annotated: boolean };
    const data = annotated.data as Record<string, unknown>;
    const exampleKeywords = [
      ...(annotated.keywords || []),
      ...extractKeywords(annotated.description || ''),
      ...extractKeywords(JSON.stringify(data)),
    ];

    return {
      data,
      category: annotated.category || 'basic',
      keywords: exampleKeywords,
      description: annotated.description,
      useWhen: annotated.useWhen,
      notWhen: annotated.notWhen,
      relevanceScore: calculateRelevanceScore(queryKeywords, exampleKeywords, toolKeywords),
    };
  }

  // Simple example - extract keywords from values
  const exampleKeywords = extractKeywords(JSON.stringify(rawExample));

  return {
    data: rawExample,
    category: inferCategory(rawExample),
    keywords: exampleKeywords,
    relevanceScore: calculateRelevanceScore(queryKeywords, exampleKeywords, toolKeywords),
  };
}

/**
 * Infer example category from structure
 */
function inferCategory(example: Record<string, unknown>): ExampleCategory {
  const keys = Object.keys(example);
  const values = Object.values(example);

  // Minimal: few keys, no complex values
  if (keys.length <= 2 && values.every((v) => typeof v !== 'object' || v === null)) {
    return 'minimal';
  }

  // Complex: nested objects or arrays
  if (values.some((v) => Array.isArray(v) || (typeof v === 'object' && v !== null))) {
    return 'complex';
  }

  // Edge case: contains null, empty strings, or boundary values
  if (values.some((v) => v === null || v === '' || v === 0 || v === -1)) {
    return 'edge_case';
  }

  // Maximal: many keys
  if (keys.length >= 5) {
    return 'maximal';
  }

  return 'basic';
}

/**
 * Validate a single example against a tool's schema
 */
function validateExample(
  example: Record<string, unknown>,
  schema: JsonSchema | undefined,
  toolName: string,
  exampleIndex: number
): ExampleValidationResult {
  if (!schema) {
    // No schema means any example is valid
    return { valid: true, errors: [], toolName, exampleIndex };
  }

  const result = validateAgainstSchema(example, schema);
  return {
    valid: result.valid,
    errors: result.errors,
    toolName,
    exampleIndex,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Example Selection
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Select diverse examples covering different categories
 * Prioritizes query-relevant examples while ensuring category coverage
 */
function selectDiverseExamples(
  examples: ParsedExample[],
  maxExamples: number = 3
): ParsedExample[] {
  if (examples.length <= maxExamples) {
    return examples;
  }

  const selected: ParsedExample[] = [];
  const seenCategories = new Set<ExampleCategory>();

  // Sort by relevance score descending
  const sorted = [...examples].sort((a, b) => b.relevanceScore - a.relevanceScore);

  // First pass: pick highest relevance from each category
  for (const example of sorted) {
    if (selected.length >= maxExamples) break;
    if (!seenCategories.has(example.category)) {
      selected.push(example);
      seenCategories.add(example.category);
    }
  }

  // Second pass: fill remaining slots with highest relevance
  for (const example of sorted) {
    if (selected.length >= maxExamples) break;
    if (!selected.includes(example)) {
      selected.push(example);
    }
  }

  return selected;
}

/**
 * Detect if a tool might be ambiguous with other tools
 */
function detectAmbiguousTools(tools: InternalToolDefinition[]): Map<string, string[]> {
  const ambiguousMap = new Map<string, string[]>();

  for (let i = 0; i < tools.length; i++) {
    const tool1 = tools[i];
    if (!tool1) continue;
    const similarTools: string[] = [];

    for (let j = 0; j < tools.length; j++) {
      if (i === j) continue;
      const tool2 = tools[j];
      if (!tool2) continue;

      // Check for keyword overlap
      const overlap = tool1.keywords.filter((k) => tool2.keywords.includes(k));
      if (overlap.length >= 2) {
        similarTools.push(tool2.name);
      }

      // Check for similar names
      if (
        tool1.name.includes(tool2.name) ||
        tool2.name.includes(tool1.name) ||
        levenshteinSimilarity(tool1.name, tool2.name) > 0.6
      ) {
        if (!similarTools.includes(tool2.name)) {
          similarTools.push(tool2.name);
        }
      }
    }

    if (similarTools.length > 0) {
      ambiguousMap.set(tool1.name, similarTools);
    }
  }

  return ambiguousMap;
}

/**
 * Calculate Levenshtein similarity (0-1)
 */
function levenshteinSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  if (longer.length === 0) return 1;

  const costs = new Array<number>();
  for (let i = 0; i <= shorter.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= longer.length; j++) {
      if (i === 0) {
        costs[j] = j;
      } else if (j > 0) {
        let newValue = costs[j - 1] ?? 0;
        if (shorter.charAt(i - 1) !== longer.charAt(j - 1)) {
          newValue = Math.min(Math.min(newValue, lastValue), costs[j] ?? 0) + 1;
        }
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) {
      costs[longer.length] = lastValue;
    }
  }

  return 1 - costs[longer.length]! / longer.length;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Example Formatting
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Format examples for a single tool into a clear text block
 * Enhanced with disambiguation hints and category labels
 */
function formatToolExamples(
  tool: InternalToolDefinition,
  parsedExamples: ParsedExample[],
  similarTools?: string[]
): string {
  if (parsedExamples.length === 0) {
    return '';
  }

  const lines: string[] = [];
  lines.push(`## ${tool.name}`);

  // Add tool description summary for context
  if (tool.description) {
    const shortDesc = tool.description.length > 100
      ? tool.description.substring(0, 100) + '...'
      : tool.description;
    lines.push(`> ${shortDesc}`);
  }
  lines.push('');

  // Add disambiguation hints if this tool is similar to others
  if (similarTools && similarTools.length > 0) {
    lines.push(`**Disambiguation:** This tool differs from ${similarTools.join(', ')}.`);

    // Check if any examples have useWhen/notWhen hints
    const hintsExample = parsedExamples.find((e) => e.useWhen || e.notWhen);
    if (hintsExample) {
      if (hintsExample.useWhen) {
        lines.push(`- **Use when:** ${hintsExample.useWhen}`);
      }
      if (hintsExample.notWhen) {
        lines.push(`- **Do NOT use when:** ${hintsExample.notWhen}`);
      }
    }
    lines.push('');
  }

  // Format each example with category context
  for (let i = 0; i < parsedExamples.length; i++) {
    const example = parsedExamples[i];
    if (!example) continue;

    // Add category and description label
    const categoryLabel = formatCategoryLabel(example.category);
    const label = example.description
      ? `${categoryLabel} - ${example.description}`
      : categoryLabel;

    if (parsedExamples.length > 1) {
      lines.push(`**Example ${i + 1}** (${label}):`);
    } else {
      lines.push(`**Example** (${label}):`);
    }

    lines.push('```json');
    lines.push(JSON.stringify(example.data, null, 2));
    lines.push('```');

    if (i < parsedExamples.length - 1) {
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Format category as human-readable label
 */
function formatCategoryLabel(category: ExampleCategory): string {
  switch (category) {
    case 'basic':
      return 'Typical usage';
    case 'edge_case':
      return 'Edge case';
    case 'complex':
      return 'Complex input';
    case 'minimal':
      return 'Minimal required params';
    case 'maximal':
      return 'All parameters';
    case 'disambiguation':
      return 'Disambiguation';
    default:
      return 'Example';
  }
}

/**
 * Build the full examples section for the system prompt
 * Enhanced with query relevance and disambiguation
 */
function buildExamplesSection(
  tools: InternalToolDefinition[],
  toolExamplesMap: Map<string, ParsedExample[]>,
  ambiguousTools: Map<string, string[]>
): string {
  const toolsWithExamples = tools.filter(
    (t) => toolExamplesMap.has(t.name) && (toolExamplesMap.get(t.name)?.length || 0) > 0
  );

  if (toolsWithExamples.length === 0) {
    return '';
  }

  const lines: string[] = [];
  lines.push('');
  lines.push('# Tool Input Examples');
  lines.push('');
  lines.push('Use these examples as reference for correctly formatting tool inputs.');
  lines.push('Examples are selected based on relevance to your current task.');
  lines.push('');

  // Add a quick reference section for disambiguation
  const ambiguousToolNames = Array.from(ambiguousTools.keys());
  if (ambiguousToolNames.length > 0) {
    lines.push('## Quick Tool Selection Guide');
    lines.push('');
    for (const toolName of ambiguousToolNames) {
      const tool = tools.find((t) => t.name === toolName);
      if (tool) {
        const similar = ambiguousTools.get(toolName) || [];
        lines.push(`- **${toolName}** vs ${similar.join(', ')}: See disambiguation notes below`);
      }
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');

  // Format each tool's examples
  for (const tool of toolsWithExamples) {
    const examples = toolExamplesMap.get(tool.name) || [];
    const similarTools = ambiguousTools.get(tool.name);
    lines.push(formatToolExamples(tool, examples, similarTools));
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Collect and validate all examples from tools
 */
function collectAndValidateExamples(
  tools: InternalToolDefinition[]
): {
  validExamples: FormattedExample[];
  stats: ExampleInjectionStats;
} {
  const validExamples: FormattedExample[] = [];
  const validationErrors: ExampleValidationResult[] = [];
  let examplesSkipped = 0;

  for (const tool of tools) {
    if (!tool.examples || tool.examples.length === 0) {
      continue;
    }

    for (let i = 0; i < tool.examples.length; i++) {
      const example = tool.examples[i];
      if (!example) continue;
      const validation = validateExample(
        example,
        tool.parameters,
        tool.name,
        i
      );

      if (validation.valid) {
        const tokenCost = estimateTokens(example);
        // Convert raw example to ParsedExample format
        const parsedExample: ParsedExample = {
          data: example,
          category: inferCategory(example),
          keywords: extractKeywords(JSON.stringify(example)),
          relevanceScore: 0, // Will be updated if query-based filtering is applied
        };
        validExamples.push({
          toolName: tool.name,
          example: parsedExample,
          tokenCost,
        });
      } else {
        validationErrors.push(validation);
        examplesSkipped++;
        logger.warn(
          `Skipping invalid example ${i} for tool "${tool.name}":`,
          validation.errors
        );
      }
    }
  }

  const exampleTokens = validExamples.reduce((sum, e) => sum + e.tokenCost, 0);

  // Calculate category coverage
  const categoryCoverage: Record<ExampleCategory, number> = {
    basic: 0,
    edge_case: 0,
    complex: 0,
    minimal: 0,
    maximal: 0,
    disambiguation: 0,
  };
  for (const ve of validExamples) {
    categoryCoverage[ve.example.category]++;
  }

  return {
    validExamples,
    stats: {
      examplesInjected: validExamples.length,
      exampleTokens,
      examplesSkipped,
      validationErrors,
      queryRelevantExamples: 0, // Updated when query-based selection is applied
      categoryCoverage,
    },
  };
}

/**
 * Collect, validate, and select query-relevant examples from tools
 * This enhanced version uses the user's query to prioritize relevant examples
 */
function collectAndSelectExamples(
  tools: InternalToolDefinition[],
  userQuery: string
): {
  toolExamplesMap: Map<string, ParsedExample[]>;
  ambiguousTools: Map<string, string[]>;
  stats: ExampleInjectionStats;
} {
  const toolExamplesMap = new Map<string, ParsedExample[]>();
  const validationErrors: ExampleValidationResult[] = [];
  let examplesSkipped = 0;
  let totalExamplesInjected = 0;
  let queryRelevantExamples = 0;
  const categoryCoverage: Record<ExampleCategory, number> = {
    basic: 0,
    edge_case: 0,
    complex: 0,
    minimal: 0,
    maximal: 0,
    disambiguation: 0,
  };

  // Extract query keywords for relevance scoring
  const queryKeywords = extractKeywords(userQuery);

  // Detect ambiguous tools for disambiguation hints
  const ambiguousTools = detectAmbiguousTools(tools);

  for (const tool of tools) {
    if (!tool.examples || tool.examples.length === 0) {
      continue;
    }

    const parsedExamples: ParsedExample[] = [];

    for (let i = 0; i < tool.examples.length; i++) {
      const rawExample = tool.examples[i];
      if (!rawExample) continue;

      // Get the actual data for validation (handle annotated examples)
      const exampleData = (rawExample._annotated && typeof rawExample.data === 'object')
        ? rawExample.data as Record<string, unknown>
        : rawExample;

      const validation = validateExample(
        exampleData,
        tool.parameters,
        tool.name,
        i
      );

      if (validation.valid) {
        const parsed = parseExample(rawExample, tool.keywords, queryKeywords);
        parsedExamples.push(parsed);

        // Track query-relevant examples (score > 0.3 threshold)
        if (parsed.relevanceScore > 0.3) {
          queryRelevantExamples++;
        }
      } else {
        validationErrors.push(validation);
        examplesSkipped++;
        logger.warn(
          `Skipping invalid example ${i} for tool "${tool.name}":`,
          validation.errors
        );
      }
    }

    // Select diverse examples (max 3 per tool) prioritizing relevance
    const selectedExamples = selectDiverseExamples(parsedExamples, 3);

    // Track category coverage for statistics
    for (const example of selectedExamples) {
      categoryCoverage[example.category]++;
    }

    if (selectedExamples.length > 0) {
      toolExamplesMap.set(tool.name, selectedExamples);
      totalExamplesInjected += selectedExamples.length;
    }
  }

  // Calculate total token cost including formatting overhead
  let exampleTokens = 0;
  for (const examples of Array.from(toolExamplesMap.values())) {
    for (const example of examples) {
      exampleTokens += estimateTokens(example.data);
      // Add overhead for description, useWhen, notWhen if present
      if (example.description) exampleTokens += estimateTokens(example.description);
      if (example.useWhen) exampleTokens += estimateTokens(example.useWhen);
      if (example.notWhen) exampleTokens += estimateTokens(example.notWhen);
    }
  }

  return {
    toolExamplesMap,
    ambiguousTools,
    stats: {
      examplesInjected: totalExamplesInjected,
      exampleTokens,
      examplesSkipped,
      validationErrors,
      queryRelevantExamples,
      categoryCoverage,
    },
  };
}

/**
 * Create the example injector middleware
 * Enhanced with query-relevant example selection and tool disambiguation
 */
export function createExampleInjector(): Middleware {
  return {
    name: 'example-injector',
    enabled: true,

    async beforeRequest(context: RequestContext): Promise<RequestContext> {
      // Skip if example injection is disabled
      if (!context.config.exampleInjection) {
        logger.debug('Example injection disabled');
        return context;
      }

      // Use filtered tools if available, otherwise use all tools
      const toolsToProcess =
        context.filteredTools.length > 0
          ? context.filteredTools
          : context.tools;

      // Use query-aware example selection for better relevance
      const { toolExamplesMap, ambiguousTools, stats } = collectAndSelectExamples(
        toolsToProcess,
        context.userMessage
      );

      if (stats.examplesInjected === 0) {
        logger.debug('No examples to inject');
        return context;
      }

      // Build the examples section with disambiguation support
      const examplesSection = buildExamplesSection(
        toolsToProcess,
        toolExamplesMap,
        ambiguousTools
      );

      if (!examplesSection) {
        return context;
      }

      // Calculate overhead for the section header
      const sectionOverhead = estimateTokens(
        '\n# Tool Input Examples\n\nUse these examples as reference for correctly formatting tool inputs.\nExamples are selected based on relevance to your current task.\n\n'
      );
      const totalExampleTokens = stats.exampleTokens + sectionOverhead;

      logger.debug(
        `Injecting ${stats.examplesInjected} examples (${stats.queryRelevantExamples} query-relevant, ${totalExampleTokens} tokens)`
      );

      // Inject into system prompt
      const updatedSystemPrompt = context.systemPrompt + examplesSection;

      // Update stats
      const updatedStats = {
        ...context.stats,
        examplesInjected: stats.examplesInjected,
        exampleTokens: totalExampleTokens,
      };

      // Store detailed injection stats in metadata for debugging
      const updatedMetadata = {
        ...context.metadata,
        exampleInjection: {
          ...stats,
          ambiguousToolsDetected: ambiguousTools.size,
        },
      };

      return {
        ...context,
        systemPrompt: updatedSystemPrompt,
        stats: updatedStats,
        metadata: updatedMetadata,
      };
    },
  };
}

/**
 * Utility to estimate token cost of examples for a set of tools
 */
export function estimateExampleTokenCost(
  tools: InternalToolDefinition[]
): number {
  let total = 0;

  for (const tool of tools) {
    if (tool.examples) {
      for (const example of tool.examples) {
        total += estimateTokens(example);
      }
    }
  }

  // Add overhead for formatting
  const toolsWithExamples = tools.filter(
    (t) => t.examples && t.examples.length > 0
  );
  if (toolsWithExamples.length > 0) {
    // Header overhead
    total += estimateTokens(
      '# Tool Input Examples\n\nUse these examples as reference:\n\n'
    );
    // Per-tool overhead (## toolName, code fences, etc.)
    total += toolsWithExamples.length * 15;
  }

  return total;
}

/**
 * Validate all examples in a set of tool definitions
 * Useful for pre-flight validation during tool registration
 */
export function validateAllExamples(
  tools: InternalToolDefinition[]
): ExampleValidationResult[] {
  const results: ExampleValidationResult[] = [];

  for (const tool of tools) {
    if (!tool.examples) continue;

    for (let i = 0; i < tool.examples.length; i++) {
      const example = tool.examples[i];
      if (!example) continue;
      results.push(
        validateExample(example, tool.parameters, tool.name, i)
      );
    }
  }

  return results;
}

/**
 * Get invalid examples for error reporting
 */
export function getInvalidExamples(
  tools: InternalToolDefinition[]
): ExampleValidationResult[] {
  return validateAllExamples(tools).filter((r) => !r.valid);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Helper Functions for Creating Annotated Examples
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create an annotated example with metadata for smart selection
 * This format enables query-relevant example selection and disambiguation
 *
 * @example
 * const example = createAnnotatedExample(
 *   { query: "weather in Paris", units: "celsius" },
 *   {
 *     category: 'basic',
 *     description: 'Weather query with metric units',
 *     keywords: ['weather', 'temperature', 'forecast'],
 *     useWhen: 'User asks about weather conditions',
 *     notWhen: 'User asks about historical climate data',
 *   }
 * );
 */
export function createAnnotatedExample(
  data: Record<string, unknown>,
  options: {
    category?: ExampleCategory;
    description?: string;
    keywords?: string[];
    useWhen?: string;
    notWhen?: string;
  } = {}
): Record<string, unknown> {
  return {
    _annotated: true,
    data,
    category: options.category,
    description: options.description,
    keywords: options.keywords,
    useWhen: options.useWhen,
    notWhen: options.notWhen,
  };
}

/**
 * Create a basic example (typical usage pattern)
 */
export function createBasicExample(
  data: Record<string, unknown>,
  description?: string
): Record<string, unknown> {
  return createAnnotatedExample(data, { category: 'basic', description });
}

/**
 * Create an edge case example (boundary conditions, special values)
 */
export function createEdgeCaseExample(
  data: Record<string, unknown>,
  description?: string
): Record<string, unknown> {
  return createAnnotatedExample(data, { category: 'edge_case', description });
}

/**
 * Create a minimal example (only required parameters)
 */
export function createMinimalExample(
  data: Record<string, unknown>,
  description?: string
): Record<string, unknown> {
  return createAnnotatedExample(data, { category: 'minimal', description });
}

/**
 * Create a disambiguation example (clarifies when to use this tool vs similar ones)
 */
export function createDisambiguationExample(
  data: Record<string, unknown>,
  options: {
    description?: string;
    useWhen: string;
    notWhen: string;
  }
): Record<string, unknown> {
  return createAnnotatedExample(data, {
    category: 'disambiguation',
    description: options.description,
    useWhen: options.useWhen,
    notWhen: options.notWhen,
  });
}

export default createExampleInjector;
