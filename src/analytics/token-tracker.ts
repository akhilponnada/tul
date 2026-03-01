/**
 * Tul - Token Usage Tracker
 * Tracks all token usage and calculates savings compared to baseline
 */

import type { RequestStats, CumulativeStats } from '../types';

/**
 * Token usage record for a single request
 */
export interface TokenUsageRecord {
  /** Timestamp of the request */
  timestamp: number;

  /** Input tokens consumed */
  inputTokens: number;

  /** Output tokens generated */
  outputTokens: number;

  /** Total tokens (input + output) */
  totalTokens: number;

  /** Estimated baseline tokens (without Tul optimizations) */
  baselineTokens: number;

  /** Tokens saved by Tul optimizations */
  tokensSaved: number;

  /** Breakdown of savings by feature */
  savingsBreakdown: {
    toolFiltering: number;
    schemaCompression: number;
    contextCompaction: number;
    caching: number;
  };

  /** Number of tools sent vs total registered */
  toolsSent: number;
  toolsTotal: number;

  /** Whether cache was hit */
  cacheHit: boolean;
}

/**
 * Aggregate statistics from the token tracker
 */
export interface TokenStats {
  /** Total number of requests tracked */
  totalRequests: number;

  /** Total input tokens consumed */
  totalInputTokens: number;

  /** Total output tokens generated */
  totalOutputTokens: number;

  /** Total tokens consumed (input + output) */
  totalTokens: number;

  /** Estimated baseline tokens without Tul */
  estimatedBaselineTokens: number;

  /** Total tokens saved */
  totalTokensSaved: number;

  /** Percentage of tokens saved */
  savingsPercentage: number;

  /** Average tokens per request */
  avgTokensPerRequest: number;

  /** Average baseline tokens per request */
  avgBaselinePerRequest: number;

  /** Savings breakdown by feature */
  savingsBreakdown: {
    toolFiltering: number;
    schemaCompression: number;
    contextCompaction: number;
    caching: number;
  };

  /** Cache statistics */
  cacheStats: {
    hits: number;
    misses: number;
    hitRate: number;
  };

  /** Tools statistics */
  toolsStats: {
    avgToolsSent: number;
    avgToolsFiltered: number;
    filterRate: number;
  };

  /** Time range of tracked data */
  timeRange: {
    start: number | null;
    end: number | null;
    durationMs: number;
  };
}

/**
 * Configuration for baseline estimation
 */
export interface BaselineConfig {
  /** Average tokens per tool definition (uncompressed) */
  avgTokensPerTool: number;

  /** Overhead multiplier for no tool filtering */
  noFilteringOverhead: number;

  /** Overhead multiplier for no context compaction */
  noCompactionOverhead: number;

  /** Average input tokens per request baseline */
  avgInputTokensBaseline: number;

  /** Average output tokens per request baseline */
  avgOutputTokensBaseline: number;
}

const DEFAULT_BASELINE_CONFIG: BaselineConfig = {
  avgTokensPerTool: 150,
  noFilteringOverhead: 1.5,
  noCompactionOverhead: 1.3,
  avgInputTokensBaseline: 2000,
  avgOutputTokensBaseline: 500,
};

/**
 * Token Tracker - tracks all token usage and calculates savings
 */
export class TokenTracker {
  private records: TokenUsageRecord[] = [];
  private baselineConfig: BaselineConfig;
  private totalTools: number = 0;

  constructor(baselineConfig: Partial<BaselineConfig> = {}) {
    this.baselineConfig = {
      ...DEFAULT_BASELINE_CONFIG,
      ...baselineConfig,
    };
  }

  /**
   * Set the total number of registered tools (for filtering calculations)
   */
  setTotalTools(count: number): void {
    this.totalTools = count;
  }

  /**
   * Record a request's token usage
   */
  recordRequest(stats: RequestStats, toolsSent: number, toolsTotal?: number): void {
    const total = toolsTotal ?? this.totalTools;
    const toolsFiltered = total - toolsSent;

    // Calculate baseline estimate
    const baseline = this.estimateBaseline(stats, toolsSent, total);

    // Calculate savings breakdown
    const savingsBreakdown = {
      toolFiltering: toolsFiltered * this.baselineConfig.avgTokensPerTool,
      schemaCompression: stats.compressionSaved,
      contextCompaction: stats.contextCompactionSaved,
      caching: stats.cacheHit ? Math.round(stats.inputTokens * 0.3) : 0,
    };

    const totalSavings = Object.values(savingsBreakdown).reduce((a, b) => a + b, 0);

    const record: TokenUsageRecord = {
      timestamp: Date.now(),
      inputTokens: stats.inputTokens,
      outputTokens: stats.outputTokens,
      totalTokens: stats.inputTokens + stats.outputTokens,
      baselineTokens: baseline,
      tokensSaved: totalSavings,
      savingsBreakdown,
      toolsSent,
      toolsTotal: total,
      cacheHit: stats.cacheHit,
    };

    this.records.push(record);
  }

  /**
   * Estimate baseline token usage without Tul optimizations
   */
  estimateBaseline(
    stats: RequestStats,
    toolsSent: number,
    toolsTotal: number
  ): number {
    // Start with actual tokens used
    let baseline = stats.inputTokens + stats.outputTokens;

    // Add back filtered tool tokens
    const filteredTools = toolsTotal - toolsSent;
    baseline += filteredTools * this.baselineConfig.avgTokensPerTool;

    // Add back compression savings
    baseline += stats.compressionSaved;

    // Add back context compaction savings
    baseline += stats.contextCompactionSaved;

    // Factor in no-filtering overhead (sending all tools increases confusion)
    if (filteredTools > 0) {
      baseline = Math.round(baseline * this.baselineConfig.noFilteringOverhead);
    }

    // Factor in no-compaction overhead for long conversations
    if (stats.contextCompactionSaved > 0) {
      baseline = Math.round(baseline * this.baselineConfig.noCompactionOverhead);
    }

    return baseline;
  }

  /**
   * Get comprehensive statistics
   */
  getStats(): TokenStats {
    if (this.records.length === 0) {
      return this.getEmptyStats();
    }

    const totalInputTokens = this.records.reduce((sum, r) => sum + r.inputTokens, 0);
    const totalOutputTokens = this.records.reduce((sum, r) => sum + r.outputTokens, 0);
    const totalTokens = totalInputTokens + totalOutputTokens;
    const estimatedBaselineTokens = this.records.reduce((sum, r) => sum + r.baselineTokens, 0);
    const totalTokensSaved = this.records.reduce((sum, r) => sum + r.tokensSaved, 0);

    const savingsBreakdown = {
      toolFiltering: this.records.reduce((sum, r) => sum + r.savingsBreakdown.toolFiltering, 0),
      schemaCompression: this.records.reduce((sum, r) => sum + r.savingsBreakdown.schemaCompression, 0),
      contextCompaction: this.records.reduce((sum, r) => sum + r.savingsBreakdown.contextCompaction, 0),
      caching: this.records.reduce((sum, r) => sum + r.savingsBreakdown.caching, 0),
    };

    const cacheHits = this.records.filter(r => r.cacheHit).length;
    const cacheMisses = this.records.length - cacheHits;

    const totalToolsSent = this.records.reduce((sum, r) => sum + r.toolsSent, 0);
    const totalToolsAvailable = this.records.reduce((sum, r) => sum + r.toolsTotal, 0);
    const avgToolsSent = totalToolsSent / this.records.length;
    const avgToolsTotal = totalToolsAvailable / this.records.length;
    const avgToolsFiltered = avgToolsTotal - avgToolsSent;

    const timestamps = this.records.map(r => r.timestamp);
    const startTime = Math.min(...timestamps);
    const endTime = Math.max(...timestamps);

    return {
      totalRequests: this.records.length,
      totalInputTokens,
      totalOutputTokens,
      totalTokens,
      estimatedBaselineTokens,
      totalTokensSaved,
      savingsPercentage: this.calculateSavingsPercentage(totalTokens, estimatedBaselineTokens),
      avgTokensPerRequest: Math.round(totalTokens / this.records.length),
      avgBaselinePerRequest: Math.round(estimatedBaselineTokens / this.records.length),
      savingsBreakdown,
      cacheStats: {
        hits: cacheHits,
        misses: cacheMisses,
        hitRate: this.records.length > 0 ? (cacheHits / this.records.length) * 100 : 0,
      },
      toolsStats: {
        avgToolsSent: Math.round(avgToolsSent * 10) / 10,
        avgToolsFiltered: Math.round(avgToolsFiltered * 10) / 10,
        filterRate: avgToolsTotal > 0 ? (avgToolsFiltered / avgToolsTotal) * 100 : 0,
      },
      timeRange: {
        start: startTime,
        end: endTime,
        durationMs: endTime - startTime,
      },
    };
  }

  /**
   * Calculate savings percentage
   */
  private calculateSavingsPercentage(actual: number, baseline: number): number {
    if (baseline === 0) return 0;
    const saved = baseline - actual;
    return Math.round((saved / baseline) * 10000) / 100; // 2 decimal places
  }

  /**
   * Get empty stats structure
   */
  private getEmptyStats(): TokenStats {
    return {
      totalRequests: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      estimatedBaselineTokens: 0,
      totalTokensSaved: 0,
      savingsPercentage: 0,
      avgTokensPerRequest: 0,
      avgBaselinePerRequest: 0,
      savingsBreakdown: {
        toolFiltering: 0,
        schemaCompression: 0,
        contextCompaction: 0,
        caching: 0,
      },
      cacheStats: {
        hits: 0,
        misses: 0,
        hitRate: 0,
      },
      toolsStats: {
        avgToolsSent: 0,
        avgToolsFiltered: 0,
        filterRate: 0,
      },
      timeRange: {
        start: null,
        end: null,
        durationMs: 0,
      },
    };
  }

  /**
   * Reset all statistics
   */
  resetStats(): void {
    this.records = [];
  }

  /**
   * Get the raw records (for debugging/export)
   */
  getRecords(): readonly TokenUsageRecord[] {
    return this.records;
  }

  /**
   * Get recent records (last N)
   */
  getRecentRecords(count: number): TokenUsageRecord[] {
    return this.records.slice(-count);
  }

  /**
   * Convert stats to CumulativeStats format (for compatibility with existing types)
   */
  toCumulativeStats(): CumulativeStats {
    const stats = this.getStats();

    // Calculate additional metrics from records
    const toolCallsMade = this.records.length; // Simplified
    const toolCallsSucceeded = this.records.length; // Assume all succeeded
    const cacheHits = stats.cacheStats.hits;

    return {
      totalRequests: stats.totalRequests,
      totalInputTokens: stats.totalInputTokens,
      totalOutputTokens: stats.totalOutputTokens,
      estimatedBaselineTokens: stats.estimatedBaselineTokens,
      tokensSaved: stats.totalTokensSaved,
      percentSaved: stats.savingsPercentage,
      toolCallsMade,
      toolCallsSucceeded,
      toolCallsFailed: 0,
      failuresRecovered: 0,
      schemaViolationsCaught: 0,
      schemaViolationsRecovered: 0,
      loopsPrevented: 0,
      cacheHits,
      cacheMisses: stats.cacheStats.misses,
      avgToolsPerRequest: stats.toolsStats.avgToolsSent,
      totalToolsFiltered: Math.round(stats.toolsStats.avgToolsFiltered * stats.totalRequests),
    };
  }

  /**
   * Format stats as a human-readable string
   */
  formatStats(): string {
    const stats = this.getStats();

    if (stats.totalRequests === 0) {
      return 'No requests tracked yet.';
    }

    const lines = [
      '=== Token Usage Statistics ===',
      '',
      `Requests: ${stats.totalRequests}`,
      `Total Tokens: ${stats.totalTokens.toLocaleString()}`,
      `  Input: ${stats.totalInputTokens.toLocaleString()}`,
      `  Output: ${stats.totalOutputTokens.toLocaleString()}`,
      '',
      `Baseline Estimate: ${stats.estimatedBaselineTokens.toLocaleString()}`,
      `Tokens Saved: ${stats.totalTokensSaved.toLocaleString()} (${stats.savingsPercentage}%)`,
      '',
      'Savings Breakdown:',
      `  Tool Filtering: ${stats.savingsBreakdown.toolFiltering.toLocaleString()}`,
      `  Schema Compression: ${stats.savingsBreakdown.schemaCompression.toLocaleString()}`,
      `  Context Compaction: ${stats.savingsBreakdown.contextCompaction.toLocaleString()}`,
      `  Caching: ${stats.savingsBreakdown.caching.toLocaleString()}`,
      '',
      `Cache Hit Rate: ${stats.cacheStats.hitRate.toFixed(1)}%`,
      `Avg Tools Sent: ${stats.toolsStats.avgToolsSent} (${stats.toolsStats.filterRate.toFixed(1)}% filtered)`,
    ];

    return lines.join('\n');
  }
}

// Singleton instance for global tracking
let globalTracker: TokenTracker | null = null;

/**
 * Get the global token tracker instance
 */
export function getGlobalTokenTracker(): TokenTracker {
  if (!globalTracker) {
    globalTracker = new TokenTracker();
  }
  return globalTracker;
}

/**
 * Reset the global token tracker
 */
export function resetGlobalTokenTracker(): void {
  if (globalTracker) {
    globalTracker.resetStats();
  }
}
