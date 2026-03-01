/**
 * Context Manager Middleware - Auto-compact old tool results (Claude-inspired)
 *
 * Strategies:
 * - summarize: Replace old tool results with AI-generated summaries
 * - truncate: Keep first N characters of old tool results
 * - drop: Remove old tool results entirely, keep only metadata
 *
 * Keeps recent turns intact to preserve context continuity.
 * Tracks tokens saved for statistics reporting.
 */

import type {
  Middleware,
  RequestContext,
  Content,
  ContentPart,
  FunctionResponsePart,
  TextPart,
  ResolvedTulConfig,
} from '../types/index.js';
import { getLogger } from '../utils/logger.js';
import { truncateChars } from '../utils/helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export type CompactionStrategy = 'summarize' | 'truncate' | 'drop';

export interface CompactionResult {
  /** Compacted messages */
  messages: Content[];
  /** Estimated tokens saved by compaction */
  tokensSaved: number;
  /** Number of tool results compacted */
  resultsCompacted: number;
  /** Number of turns compacted */
  turnsCompacted: number;
}

export interface ContextStats {
  /** Total estimated tokens in context */
  totalTokens: number;
  /** Tokens used by tool results */
  toolResultTokens: number;
  /** Tokens used by user messages */
  userTokens: number;
  /** Tokens used by model responses */
  modelTokens: number;
  /** Number of turns in context */
  turnCount: number;
}

interface CompactedToolResult {
  originalName: string;
  originalTokens: number;
  strategy: CompactionStrategy;
  summary?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Token Estimation
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Estimate tokens from text (rough approximation: ~4 chars per token)
 */
function estimateTokens(text: string): number {
  if (!text) return 0;
  // Average 4 characters per token for English text
  // JSON and code tend to be denser, so we use 3.5
  return Math.ceil(text.length / 3.5);
}

/**
 * Estimate tokens for a content part
 */
function estimatePartTokens(part: ContentPart): number {
  if ('text' in part) {
    return estimateTokens(part.text);
  }
  if ('functionCall' in part) {
    return estimateTokens(JSON.stringify(part.functionCall));
  }
  if ('functionResponse' in part) {
    return estimateTokens(JSON.stringify(part.functionResponse.response));
  }
  if ('thought' in part) {
    return estimateTokens(part.thought);
  }
  return 0;
}

/**
 * Estimate tokens for a message
 */
function estimateMessageTokens(message: Content): number {
  return message.parts.reduce((sum, part) => sum + estimatePartTokens(part), 0);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Context Analysis
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Analyze context to get token distribution
 */
function analyzeContext(messages: Content[]): ContextStats {
  let toolResultTokens = 0;
  let userTokens = 0;
  let modelTokens = 0;
  let turnCount = 0;

  for (const message of messages) {
    const tokens = estimateMessageTokens(message);

    if (message.role === 'user') {
      userTokens += tokens;
      turnCount++;
    } else if (message.role === 'model') {
      modelTokens += tokens;
    } else if (message.role === 'function') {
      toolResultTokens += tokens;
    }
  }

  return {
    totalTokens: toolResultTokens + userTokens + modelTokens,
    toolResultTokens,
    userTokens,
    modelTokens,
    turnCount: Math.ceil(turnCount), // Each user message starts a turn
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Compaction Strategies
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate a summary for tool result (simple extractive summary)
 * In production, this could call a small model for better summarization
 */
function generateSummary(toolName: string, result: unknown): string {
  const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
  const originalLength = resultStr.length;

  // For small results, keep as is
  if (originalLength <= 200) {
    return resultStr;
  }

  // Extract key information based on result type
  if (typeof result === 'object' && result !== null) {
    const obj = result as Record<string, unknown>;

    // For arrays, summarize count and sample
    if (Array.isArray(result)) {
      const count = result.length;
      if (count === 0) {
        return `[${toolName}] Empty result (0 items)`;
      }
      const sample = JSON.stringify(result[0]);
      const truncatedSample = truncateChars(sample, 100);
      return `[${toolName}] ${count} items. Sample: ${truncatedSample}`;
    }

    // For objects with common patterns
    if ('error' in obj) {
      return `[${toolName}] Error: ${truncateChars(String(obj.error), 150)}`;
    }
    if ('success' in obj && 'message' in obj) {
      return `[${toolName}] ${obj.success ? 'Success' : 'Failed'}: ${truncateChars(String(obj.message), 150)}`;
    }
    if ('data' in obj) {
      const dataStr = JSON.stringify(obj.data);
      return `[${toolName}] Data: ${truncateChars(dataStr, 150)}`;
    }
    if ('content' in obj) {
      return `[${toolName}] Content: ${truncateChars(String(obj.content), 150)}`;
    }
    if ('result' in obj) {
      return `[${toolName}] Result: ${truncateChars(JSON.stringify(obj.result), 150)}`;
    }

    // Generic object: show keys and truncated value
    const keys = Object.keys(obj);
    if (keys.length <= 5) {
      return `[${toolName}] {${keys.join(', ')}}: ${truncateChars(resultStr, 150)}`;
    }
    return `[${toolName}] Object with ${keys.length} keys: ${keys.slice(0, 5).join(', ')}...`;
  }

  // For strings, extract first meaningful portion
  if (typeof result === 'string') {
    // Try to find natural break points
    const lines = result.split('\n').filter(l => l.trim());
    if (lines.length > 3) {
      const preview = lines.slice(0, 3).join(' | ');
      return `[${toolName}] ${truncateChars(preview, 180)} (${lines.length} lines total)`;
    }
    return `[${toolName}] ${truncateChars(result, 180)}`;
  }

  // Fallback: simple truncation with metadata
  return `[${toolName}] ${truncateChars(resultStr, 180)} (${originalLength} chars)`;
}

/**
 * Apply truncation strategy to tool result
 */
function applyTruncation(toolName: string, result: unknown, maxChars: number = 500): string {
  const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
  if (resultStr.length <= maxChars) {
    return resultStr;
  }
  return `[${toolName} truncated] ${truncateChars(resultStr, maxChars)}`;
}

/**
 * Apply drop strategy - replace with minimal metadata
 */
function applyDrop(toolName: string, result: unknown): string {
  const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
  const originalLength = resultStr.length;

  // Determine result type for metadata
  let typeInfo = 'unknown';
  if (typeof result === 'object' && result !== null) {
    if (Array.isArray(result)) {
      typeInfo = `array[${result.length}]`;
    } else {
      const keys = Object.keys(result as Record<string, unknown>);
      typeInfo = `object{${keys.length} keys}`;
    }
  } else if (typeof result === 'string') {
    typeInfo = `string(${result.length} chars)`;
  } else {
    typeInfo = typeof result;
  }

  return `[${toolName} result dropped] Type: ${typeInfo}, Original size: ${originalLength} chars`;
}

/**
 * Compact a single tool result based on strategy
 */
function compactToolResult(
  part: FunctionResponsePart,
  strategy: CompactionStrategy
): { compactedPart: FunctionResponsePart; tokensSaved: number; metadata: CompactedToolResult } {
  const originalTokens = estimatePartTokens(part);
  const toolName = part.functionResponse.name;
  const result = part.functionResponse.response;

  let compactedResponse: string;

  switch (strategy) {
    case 'summarize':
      compactedResponse = generateSummary(toolName, result);
      break;
    case 'truncate':
      compactedResponse = applyTruncation(toolName, result);
      break;
    case 'drop':
      compactedResponse = applyDrop(toolName, result);
      break;
  }

  const compactedPart: FunctionResponsePart = {
    functionResponse: {
      name: toolName,
      response: compactedResponse,
    },
  };

  const newTokens = estimatePartTokens(compactedPart);
  const tokensSaved = Math.max(0, originalTokens - newTokens);

  return {
    compactedPart,
    tokensSaved,
    metadata: {
      originalName: toolName,
      originalTokens,
      strategy,
      summary: compactedResponse,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main Compaction Logic
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Identify turn boundaries in message history
 * A turn starts with a user message
 */
function identifyTurns(messages: Content[]): { turnStart: number; turnEnd: number }[] {
  const turns: { turnStart: number; turnEnd: number }[] = [];
  let currentTurnStart = -1;

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message && message.role === 'user') {
      if (currentTurnStart >= 0) {
        turns.push({ turnStart: currentTurnStart, turnEnd: i - 1 });
      }
      currentTurnStart = i;
    }
  }

  // Close last turn
  if (currentTurnStart >= 0) {
    turns.push({ turnStart: currentTurnStart, turnEnd: messages.length - 1 });
  }

  return turns;
}

/**
 * Compact old turns while keeping recent turns intact
 */
function compactMessages(
  messages: Content[],
  config: ResolvedTulConfig
): CompactionResult {
  const logger = getLogger().child('context-manager');
  const { turnsToKeepFull, compactionStrategy, maxContextTokens } = config;

  // Analyze current context
  const stats = analyzeContext(messages);

  // If under limit, no compaction needed
  if (stats.totalTokens <= maxContextTokens) {
    logger.debug(`Context within limit (${stats.totalTokens}/${maxContextTokens} tokens)`);
    return {
      messages,
      tokensSaved: 0,
      resultsCompacted: 0,
      turnsCompacted: 0,
    };
  }

  logger.info(`Context exceeds limit (${stats.totalTokens}/${maxContextTokens} tokens), compacting...`);

  // Identify turns
  const turns = identifyTurns(messages);
  const totalTurns = turns.length;

  if (totalTurns <= turnsToKeepFull) {
    // All turns are "recent", compact tool results within them proportionally
    logger.debug(`Only ${totalTurns} turns, all considered recent`);
    return compactAllToolResults(messages, compactionStrategy, stats.totalTokens - maxContextTokens);
  }

  // Keep last N turns intact, compact older ones
  const turnsToCompact = totalTurns - turnsToKeepFull;
  const turnToCompact = turns[turnsToCompact];
  const recentTurnStart = turnToCompact?.turnStart ?? 0;

  logger.debug(`Compacting ${turnsToCompact} old turns, keeping ${turnsToKeepFull} recent`);

  // Split messages
  const oldMessages = messages.slice(0, recentTurnStart);
  const recentMessages = messages.slice(recentTurnStart);

  // Compact old messages
  const compactedOld = compactOldMessages(oldMessages, compactionStrategy);

  // Combine
  const result: CompactionResult = {
    messages: [...compactedOld.messages, ...recentMessages],
    tokensSaved: compactedOld.tokensSaved,
    resultsCompacted: compactedOld.resultsCompacted,
    turnsCompacted: turnsToCompact,
  };

  // Check if we need more compaction
  const newStats = analyzeContext(result.messages);
  if (newStats.totalTokens > maxContextTokens) {
    // Progressive compaction: also compact some recent tool results
    const additionalCompaction = compactAllToolResults(
      result.messages,
      compactionStrategy,
      newStats.totalTokens - maxContextTokens
    );
    result.messages = additionalCompaction.messages;
    result.tokensSaved += additionalCompaction.tokensSaved;
    result.resultsCompacted += additionalCompaction.resultsCompacted;
  }

  logger.info(`Compaction complete: saved ~${result.tokensSaved} tokens, compacted ${result.resultsCompacted} results`);

  return result;
}

/**
 * Compact all tool results in old messages
 */
function compactOldMessages(
  messages: Content[],
  strategy: CompactionStrategy
): { messages: Content[]; tokensSaved: number; resultsCompacted: number } {
  let totalTokensSaved = 0;
  let resultsCompacted = 0;

  const compactedMessages: Content[] = messages.map(message => {
    if (message.role !== 'function') {
      return message;
    }

    const compactedParts: ContentPart[] = message.parts.map(part => {
      if ('functionResponse' in part) {
        const { compactedPart, tokensSaved } = compactToolResult(part, strategy);
        totalTokensSaved += tokensSaved;
        resultsCompacted++;
        return compactedPart;
      }
      return part;
    });

    return { ...message, parts: compactedParts };
  });

  return {
    messages: compactedMessages,
    tokensSaved: totalTokensSaved,
    resultsCompacted,
  };
}

/**
 * Compact tool results proportionally to hit token target
 */
function compactAllToolResults(
  messages: Content[],
  strategy: CompactionStrategy,
  tokensToSave: number
): CompactionResult {
  let savedSoFar = 0;
  let resultsCompacted = 0;

  // Find all function responses and sort by size (largest first)
  const functionResponses: { messageIdx: number; partIdx: number; tokens: number }[] = [];

  messages.forEach((message, messageIdx) => {
    if (message.role === 'function') {
      message.parts.forEach((part, partIdx) => {
        if ('functionResponse' in part) {
          functionResponses.push({
            messageIdx,
            partIdx,
            tokens: estimatePartTokens(part),
          });
        }
      });
    }
  });

  // Sort by tokens descending
  functionResponses.sort((a, b) => b.tokens - a.tokens);

  // Clone messages for modification
  const compactedMessages: Content[] = messages.map(m => ({
    ...m,
    parts: [...m.parts],
  }));

  // Compact largest results first until we hit our target
  for (const fr of functionResponses) {
    if (savedSoFar >= tokensToSave) break;

    const message = compactedMessages[fr.messageIdx];
    if (!message) continue;
    const part = message.parts[fr.partIdx] as FunctionResponsePart;

    const { compactedPart, tokensSaved } = compactToolResult(part, strategy);
    message.parts[fr.partIdx] = compactedPart;

    savedSoFar += tokensSaved;
    resultsCompacted++;
  }

  return {
    messages: compactedMessages,
    tokensSaved: savedSoFar,
    resultsCompacted,
    turnsCompacted: 0,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Middleware Implementation
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create context manager middleware
 */
export function createContextManager(): Middleware {
  const logger = getLogger().child('context-manager');

  return {
    name: 'context-manager',
    enabled: true,

    async beforeRequest(context: RequestContext): Promise<RequestContext> {
      // Skip if disabled
      if (!context.config.contextManagement) {
        return context;
      }

      // Skip if no messages yet
      if (context.messages.length === 0) {
        return context;
      }

      // Analyze and potentially compact
      const result = compactMessages(context.messages, context.config);

      // Update stats
      context.stats.contextCompactionSaved =
        (context.stats.contextCompactionSaved || 0) + result.tokensSaved;

      // Store compaction metadata
      context.metadata.contextCompaction = {
        tokensSaved: result.tokensSaved,
        resultsCompacted: result.resultsCompacted,
        turnsCompacted: result.turnsCompacted,
      };

      if (result.tokensSaved > 0) {
        logger.info(
          `Compacted context: ${result.resultsCompacted} results, ` +
          `${result.turnsCompacted} turns, ~${result.tokensSaved} tokens saved`
        );
      }

      return {
        ...context,
        messages: result.messages,
      };
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════════════════════════════════════

export const contextManager = createContextManager();

export {
  estimateTokens,
  estimateMessageTokens,
  analyzeContext,
  compactMessages,
  generateSummary,
};

export default contextManager;
