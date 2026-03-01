/**
 * Tul Schema Compressor Middleware
 * Compresses tool schemas to reduce token usage while preserving semantic meaning.
 * NEVER modifies: types, enums, required fields, constraints (min/max/pattern)
 */

import type {
  Middleware,
  RequestContext,
  JsonSchema,
  InternalToolDefinition,
} from '../types/index.js';
import { estimateTokens } from '../utils/schema-utils.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Compression Configuration
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Compression level determines how aggressively descriptions are shortened
 */
export type CompressionLevel = 'light' | 'moderate' | 'aggressive';

interface CompressionConfig {
  /** Max words for tool description */
  toolDescMaxWords: number;
  /** Max words for parameter descriptions */
  paramDescMaxWords: number;
  /** Remove parameter descriptions entirely */
  removeParamDescriptions: boolean;
  /** Filler words to remove */
  fillerWords: Set<string>;
}

const COMPRESSION_CONFIGS: Record<CompressionLevel, CompressionConfig> = {
  light: {
    toolDescMaxWords: 30,
    paramDescMaxWords: 20,
    removeParamDescriptions: false,
    fillerWords: new Set([
      'the', 'a', 'an', 'this', 'that', 'these', 'those',
      'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did',
      'will', 'would', 'could', 'should', 'may', 'might',
      'can', 'must', 'shall',
      'of', 'in', 'to', 'for', 'with', 'on', 'at', 'by',
      'which', 'who', 'whom', 'whose',
      'please', 'kindly', 'basically', 'essentially',
      'actually', 'really', 'very', 'quite', 'rather',
      'just', 'simply', 'only', 'also', 'too',
    ]),
  },
  moderate: {
    toolDescMaxWords: 15,
    paramDescMaxWords: 10,
    removeParamDescriptions: false,
    fillerWords: new Set([
      'the', 'a', 'an', 'this', 'that', 'these', 'those',
      'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did',
      'will', 'would', 'could', 'should', 'may', 'might',
      'can', 'must', 'shall',
      'of', 'in', 'to', 'for', 'with', 'on', 'at', 'by',
      'which', 'who', 'whom', 'whose',
      'please', 'kindly', 'basically', 'essentially',
      'actually', 'really', 'very', 'quite', 'rather',
      'just', 'simply', 'only', 'also', 'too',
      'used', 'uses', 'using',
      'allows', 'enables', 'provides', 'supports',
      'returns', 'gives', 'gets',
      'when', 'if', 'then', 'else',
      'and', 'or', 'but', 'however', 'therefore',
    ]),
  },
  aggressive: {
    toolDescMaxWords: 8,
    paramDescMaxWords: 0, // No param descriptions
    removeParamDescriptions: true,
    fillerWords: new Set([
      'the', 'a', 'an', 'this', 'that', 'these', 'those',
      'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did',
      'will', 'would', 'could', 'should', 'may', 'might',
      'can', 'must', 'shall',
      'of', 'in', 'to', 'for', 'with', 'on', 'at', 'by',
      'which', 'who', 'whom', 'whose',
      'please', 'kindly', 'basically', 'essentially',
      'actually', 'really', 'very', 'quite', 'rather',
      'just', 'simply', 'only', 'also', 'too',
      'used', 'uses', 'using',
      'allows', 'enables', 'provides', 'supports',
      'returns', 'gives', 'gets',
      'when', 'if', 'then', 'else',
      'and', 'or', 'but', 'however', 'therefore',
      'specified', 'given', 'provided', 'defined',
      'certain', 'specific', 'particular',
      'optional', 'required', 'mandatory',
      'default', 'defaults',
    ]),
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// Compression Functions
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Remove filler words from text
 */
function removeFillerWords(text: string, fillerWords: Set<string>): string {
  const words = text.split(/\s+/);
  const filtered = words.filter((word) => {
    const lower = word.toLowerCase().replace(/[^\w]/g, '');
    return !fillerWords.has(lower);
  });
  return filtered.join(' ');
}

/**
 * Truncate text to max words while preserving meaning
 * Prefers to cut at sentence boundaries when possible
 */
function truncateToWords(text: string, maxWords: number): string {
  if (maxWords <= 0) return '';

  const words = text.split(/\s+/);
  if (words.length <= maxWords) return text;

  // Try to find a sentence boundary within the limit
  const truncated = words.slice(0, maxWords);
  const result = truncated.join(' ');

  // If we cut mid-sentence, try to end cleanly
  const lastPunctuation = result.lastIndexOf('.');
  if (lastPunctuation > result.length * 0.5) {
    return result.substring(0, lastPunctuation + 1);
  }

  return result;
}

/**
 * Compress a description string
 */
function compressDescription(
  description: string | undefined,
  config: CompressionConfig,
  isToolDescription: boolean
): string | undefined {
  if (!description) return undefined;

  const maxWords = isToolDescription
    ? config.toolDescMaxWords
    : config.paramDescMaxWords;

  if (maxWords <= 0) return undefined;

  // Step 1: Remove filler words
  let compressed = removeFillerWords(description, config.fillerWords);

  // Step 2: Truncate to max words
  compressed = truncateToWords(compressed, maxWords);

  // Step 3: Clean up extra whitespace and punctuation
  compressed = compressed.replace(/\s+/g, ' ').trim();

  return compressed || undefined;
}

/**
 * Compress a JSON schema recursively
 * PRESERVES: type, enum, required, minimum, maximum, minLength, maxLength, pattern, additionalProperties
 * COMPRESSES: description
 */
function compressSchema(
  schema: JsonSchema,
  config: CompressionConfig
): JsonSchema {
  const compressed: JsonSchema = {};

  // ALWAYS preserve these fields exactly as-is
  if (schema.type !== undefined) compressed.type = schema.type;
  if (schema.required !== undefined) compressed.required = schema.required;
  if (schema.enum !== undefined) compressed.enum = schema.enum;
  if (schema.minimum !== undefined) compressed.minimum = schema.minimum;
  if (schema.maximum !== undefined) compressed.maximum = schema.maximum;
  if (schema.minLength !== undefined) compressed.minLength = schema.minLength;
  if (schema.maxLength !== undefined) compressed.maxLength = schema.maxLength;
  if (schema.pattern !== undefined) compressed.pattern = schema.pattern;
  if (schema.default !== undefined) compressed.default = schema.default;
  if (schema.additionalProperties !== undefined) {
    compressed.additionalProperties = schema.additionalProperties;
  }

  // Compress description unless we're removing param descriptions
  if (schema.description && !config.removeParamDescriptions) {
    const compressedDesc = compressDescription(schema.description, config, false);
    if (compressedDesc) {
      compressed.description = compressedDesc;
    }
  }

  // Recursively compress nested schemas
  if (schema.properties) {
    compressed.properties = {};
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      compressed.properties[key] = compressSchema(propSchema, config);
    }
  }

  if (schema.items) {
    compressed.items = compressSchema(schema.items, config);
  }

  if (schema.oneOf) {
    compressed.oneOf = schema.oneOf.map((s) => compressSchema(s, config));
  }

  if (schema.anyOf) {
    compressed.anyOf = schema.anyOf.map((s) => compressSchema(s, config));
  }

  if (schema.allOf) {
    compressed.allOf = schema.allOf.map((s) => compressSchema(s, config));
  }

  return compressed;
}

/**
 * Compress a tool definition
 */
function compressTool(
  tool: InternalToolDefinition,
  config: CompressionConfig
): InternalToolDefinition {
  const compressedDescription = compressDescription(tool.description, config, true) ?? tool.name;

  const compressed: InternalToolDefinition = {
    ...tool,
    description: compressedDescription,
  };

  if (tool.parameters) {
    compressed.parameters = compressSchema(tool.parameters, config);
  }

  // Recalculate estimated tokens after compression
  compressed.estimatedTokens = estimateTokens({
    name: compressed.name,
    description: compressed.description,
    parameters: compressed.parameters,
  });

  return compressed;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Description Enhancement
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Action verb synonyms for description enhancement
 * Maps common verbs to related actions that might trigger the same tool
 */
const ACTION_SYNONYMS: Record<string, string[]> = {
  // CRUD operations
  create: ['add', 'make', 'generate', 'build', 'new', 'insert'],
  read: ['get', 'fetch', 'retrieve', 'load', 'find', 'lookup', 'view', 'show'],
  update: ['edit', 'modify', 'change', 'set', 'alter', 'revise'],
  delete: ['remove', 'erase', 'clear', 'destroy', 'drop', 'trash'],

  // Search operations
  search: ['find', 'lookup', 'query', 'locate', 'discover', 'browse'],
  filter: ['narrow', 'refine', 'sort', 'select', 'screen'],
  list: ['show', 'display', 'enumerate', 'view', 'get all'],

  // Communication
  send: ['transmit', 'deliver', 'dispatch', 'post', 'submit'],
  receive: ['get', 'accept', 'collect', 'fetch'],
  notify: ['alert', 'inform', 'tell', 'message', 'remind'],

  // File operations
  save: ['store', 'persist', 'write', 'keep', 'preserve'],
  upload: ['attach', 'import', 'add file', 'put'],
  download: ['export', 'get file', 'fetch', 'retrieve'],

  // Calculation/Analysis
  calculate: ['compute', 'figure out', 'determine', 'evaluate'],
  analyze: ['examine', 'inspect', 'review', 'assess', 'check'],
  convert: ['transform', 'translate', 'change', 'format'],

  // User actions
  login: ['sign in', 'authenticate', 'log in'],
  logout: ['sign out', 'log out', 'disconnect'],
  register: ['sign up', 'create account', 'join', 'enroll'],

  // E-commerce
  buy: ['purchase', 'order', 'checkout', 'pay for'],
  sell: ['list', 'offer', 'put up for sale'],
  cart: ['basket', 'bag', 'shopping list'],
};

/**
 * Domain-specific trigger phrases
 * Maps tool name patterns to example phrases users might say
 */
const TRIGGER_PHRASES: Record<string, string[]> = {
  weather: ['what is the weather', 'temperature outside', 'forecast', 'will it rain'],
  search: ['look up', 'find me', 'search for', 'where is'],
  calendar: ['schedule', 'when is', 'add event', 'book time', 'meeting'],
  email: ['send message', 'write to', 'compose', 'reply to'],
  reminder: ['remind me', 'dont forget', 'set reminder', 'alert me'],
  timer: ['set timer', 'countdown', 'alarm'],
  calculator: ['how much is', 'calculate', 'whats the sum', 'multiply'],
  translate: ['say in', 'translate to', 'how do you say', 'in spanish'],
  map: ['directions to', 'how to get to', 'navigate to', 'distance to'],
  music: ['play song', 'listen to', 'play music', 'shuffle'],
  photo: ['take picture', 'capture', 'screenshot', 'snap'],
  file: ['open file', 'save document', 'create file', 'delete file'],
  contact: ['call', 'phone number', 'address of', 'find contact'],
  note: ['take note', 'write down', 'remember', 'jot down'],
  task: ['add todo', 'task list', 'complete task', 'mark done'],
  payment: ['pay', 'transfer money', 'send money', 'balance'],
  order: ['track order', 'delivery status', 'order history'],
  booking: ['reserve', 'book', 'appointment', 'reservation'],
  cart: ['add to cart', 'remove from cart', 'view cart', 'checkout'],
  product: ['product details', 'item info', 'specs', 'price of'],
};

/**
 * Extract the primary action verb from a tool name or description
 */
function extractActionVerb(text: string): string | null {
  const words = text.toLowerCase().split(/[\s_-]+/);
  const actionVerbs = Object.keys(ACTION_SYNONYMS);

  for (const word of words) {
    if (actionVerbs.includes(word)) {
      return word;
    }
    // Check if word is a synonym and find the primary verb
    for (const [primary, synonyms] of Object.entries(ACTION_SYNONYMS)) {
      if (synonyms.includes(word)) {
        return primary;
      }
    }
  }
  return null;
}

/**
 * Find matching trigger phrases for a tool based on its name
 */
function findTriggerPhrases(toolName: string): string[] {
  const nameLower = toolName.toLowerCase();
  const phrases: string[] = [];

  for (const [keyword, triggers] of Object.entries(TRIGGER_PHRASES)) {
    if (nameLower.includes(keyword)) {
      phrases.push(...triggers.slice(0, 3)); // Limit to 3 phrases per keyword match
    }
  }

  return Array.from(new Set(phrases)).slice(0, 5); // Dedupe and limit total
}

/**
 * Generate synonym hints for the description
 */
function generateSynonymHints(toolName: string, description: string): string {
  const actionVerb = extractActionVerb(toolName) || extractActionVerb(description);

  if (actionVerb && ACTION_SYNONYMS[actionVerb]) {
    const synonyms = ACTION_SYNONYMS[actionVerb].slice(0, 3);
    return `Also known as: ${synonyms.join(', ')}.`;
  }

  return '';
}

/**
 * Enhance a tool description with synonyms and trigger phrases
 */
function enhanceDescription(
  tool: InternalToolDefinition
): string {
  const parts: string[] = [tool.description];

  // Add synonym hints
  const synonymHints = generateSynonymHints(tool.name, tool.description);
  if (synonymHints) {
    parts.push(synonymHints);
  }

  // Add trigger phrases
  const triggers = findTriggerPhrases(tool.name);
  if (triggers.length > 0) {
    parts.push(`Use this tool when user wants to: ${triggers.join(', ')}.`);
  }

  // If tool has aliases, include them
  if (tool.aliases && tool.aliases.length > 0) {
    parts.push(`Alternative names: ${tool.aliases.slice(0, 3).join(', ')}.`);
  }

  return parts.join(' ');
}

/**
 * Enhance a tool definition with richer description
 */
function enhanceTool(
  tool: InternalToolDefinition
): InternalToolDefinition {
  const enhancedDescription = enhanceDescription(tool);

  const enhanced: InternalToolDefinition = {
    ...tool,
    description: enhancedDescription,
  };

  // Recalculate estimated tokens after enhancement
  enhanced.estimatedTokens = estimateTokens({
    name: enhanced.name,
    description: enhanced.description,
    parameters: enhanced.parameters,
  });

  return enhanced;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Compression Stats
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calculate tokens saved by compression
 */
function calculateTokensSaved(
  originalTools: InternalToolDefinition[],
  compressedTools: InternalToolDefinition[]
): number {
  const originalTokens = originalTools.reduce((sum, t) => sum + t.estimatedTokens, 0);
  const compressedTokens = compressedTools.reduce((sum, t) => sum + t.estimatedTokens, 0);
  return Math.max(0, originalTokens - compressedTokens);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Middleware Implementation
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create the schema compressor middleware
 */
export function createSchemaCompressor(enabled: boolean): Middleware {
  return {
    name: 'schema-compressor',
    enabled,

    async beforeRequest(context: RequestContext): Promise<RequestContext> {
      if (!this.enabled) return context;

      const level = context.config.compressionLevel;
      const config = COMPRESSION_CONFIGS[level];
      const shouldEnhance = context.config.enhanceDescriptions ?? false;

      // Start with the filtered tools
      let processedTools = context.filteredTools;

      // Step 1: Optionally enhance descriptions BEFORE compression
      // Enhancement adds synonyms and trigger phrases to improve tool matching
      if (shouldEnhance) {
        processedTools = processedTools.map((tool) => enhanceTool(tool));
      }

      // Step 2: Compress the tools (reduces token usage)
      const originalTools = processedTools;
      const compressedTools = originalTools.map((tool) => compressTool(tool, config));

      // Calculate tokens saved by compression
      const tokensSaved = calculateTokensSaved(originalTools, compressedTools);

      return {
        ...context,
        filteredTools: compressedTools,
        stats: {
          ...context.stats,
          compressionSaved: (context.stats.compressionSaved ?? 0) + tokensSaved,
        },
      };
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Utility Exports (for testing and direct use)
// ═══════════════════════════════════════════════════════════════════════════════

export {
  compressDescription,
  compressSchema,
  compressTool,
  calculateTokensSaved,
  removeFillerWords,
  truncateToWords,
  COMPRESSION_CONFIGS,
  // Enhancement exports
  enhanceDescription,
  enhanceTool,
  extractActionVerb,
  findTriggerPhrases,
  generateSynonymHints,
  ACTION_SYNONYMS,
  TRIGGER_PHRASES,
};
