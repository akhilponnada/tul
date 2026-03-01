/**
 * Tul Reporter - Verbose mode logging for detailed request statistics
 *
 * Logs comprehensive stats after each request including:
 * - Tools (filtered, sent, called)
 * - Examples (injected, tokens)
 * - Compression (tokens saved)
 * - Validation (passed, failed, recovered)
 * - Cache (hits, misses)
 * - Retries (count, recovered)
 * - Tokens (input, output, saved)
 */

import { Logger, getLogger } from '../utils/logger';
import type { RequestStats, CumulativeStats, ToolCallResult, ResolvedTulConfig } from '../types';

/**
 * Configuration for the reporter
 */
export interface ReporterConfig {
  /** Enable verbose output */
  verbose: boolean;

  /** Show cumulative stats periodically */
  showCumulative?: boolean;

  /** Show cumulative stats every N requests */
  cumulativeInterval?: number;

  /** Custom logger instance */
  logger?: Logger;
}

/**
 * Reporter for logging detailed request statistics
 */
export class Reporter {
  private logger: Logger;
  private verbose: boolean;
  private showCumulative: boolean;
  private cumulativeInterval: number;
  private requestCount: number = 0;

  constructor(config: ReporterConfig) {
    this.verbose = config.verbose;
    this.showCumulative = config.showCumulative ?? false;
    this.cumulativeInterval = config.cumulativeInterval ?? 10;
    this.logger = config.logger ?? getLogger();
  }

  /**
   * Set verbose mode
   */
  setVerbose(verbose: boolean): void {
    this.verbose = verbose;
  }

  /**
   * Report stats for a single request
   */
  reportRequest(
    stats: RequestStats,
    toolCalls: ToolCallResult[],
    config: ResolvedTulConfig
  ): void {
    if (!this.verbose) return;

    this.requestCount++;

    this.logger.divider('═', 60);
    this.logger.section('Request Statistics');
    this.logger.divider('─', 60);

    // Tool Statistics
    this.reportToolStats(stats, toolCalls, config);

    // Example Injection Statistics
    this.reportExampleStats(stats, config);

    // Schema Compression Statistics
    this.reportCompressionStats(stats, config);

    // Validation Statistics
    this.reportValidationStats(stats, toolCalls, config);

    // Cache Statistics
    this.reportCacheStats(stats, config);

    // Retry Statistics
    this.reportRetryStats(stats, config);

    // Token Statistics
    this.reportTokenStats(stats);

    this.logger.divider('═', 60);
  }

  /**
   * Report tool-related statistics
   */
  private reportToolStats(
    stats: RequestStats,
    toolCalls: ToolCallResult[],
    config: ResolvedTulConfig
  ): void {
    this.logger.info('Tools:');

    if (config.toolFiltering) {
      this.logger.stat('Filtered out', `${stats.toolsFiltered} tools`);
      this.logger.stat('Sent to model', `${stats.toolsSent} tools`);
    } else {
      this.logger.stat('Sent to model', `${stats.toolsSent} tools (filtering disabled)`);
    }

    this.logger.stat('Calls made', stats.toolCallsMade);

    if (toolCalls.length > 0) {
      const toolNames = toolCalls.map(tc => tc.name).join(', ');
      this.logger.stat('Tools called', toolNames);
    }

    if (stats.loopDetected) {
      this.logger.warn('Loop detected and prevented');
    }
  }

  /**
   * Report example injection statistics
   */
  private reportExampleStats(stats: RequestStats, config: ResolvedTulConfig): void {
    this.logger.info('Examples:');

    if (config.exampleInjection) {
      this.logger.stat('Injected', `${stats.examplesInjected} examples`);
      this.logger.stat('Token cost', `${stats.exampleTokens} tokens`);
    } else {
      this.logger.stat('Status', 'Example injection disabled');
    }
  }

  /**
   * Report schema compression statistics
   */
  private reportCompressionStats(stats: RequestStats, config: ResolvedTulConfig): void {
    this.logger.info('Compression:');

    if (config.schemaCompression) {
      this.logger.stat('Level', config.compressionLevel);
      this.logger.stat('Tokens saved', `${stats.compressionSaved} tokens`);
    } else {
      this.logger.stat('Status', 'Schema compression disabled');
    }
  }

  /**
   * Report validation statistics
   */
  private reportValidationStats(
    stats: RequestStats,
    toolCalls: ToolCallResult[],
    config: ResolvedTulConfig
  ): void {
    this.logger.info('Validation:');

    if (config.strictValidation) {
      const passed = toolCalls.filter(tc => tc.validationPassed).length;
      const failed = toolCalls.filter(tc => !tc.validationPassed).length;

      this.logger.stat('Passed', `${passed} tool calls`);

      if (failed > 0) {
        this.logger.stat('Failed', `${failed} tool calls`);

        if (stats.validationRecovered) {
          this.logger.stat('Recovery', 'Recovered via retry');
        } else if (stats.validationFailed) {
          this.logger.warn('Validation failures not recovered');
        }

        // Show specific validation errors
        for (const tc of toolCalls) {
          if (tc.validationErrors && tc.validationErrors.length > 0) {
            this.logger.stat(`Errors (${tc.name})`, tc.validationErrors.join('; '));
          }
        }
      }
    } else {
      this.logger.stat('Status', 'Strict validation disabled');
    }
  }

  /**
   * Report cache statistics
   */
  private reportCacheStats(stats: RequestStats, config: ResolvedTulConfig): void {
    this.logger.info('Cache:');

    if (config.resultCaching) {
      this.logger.stat('TTL', `${config.cacheTTL}ms`);
      this.logger.stat('Hits', stats.cacheHits);
      this.logger.stat('Status', stats.cacheHit ? 'Cache hit' : 'Cache miss');
    } else {
      this.logger.stat('Status', 'Result caching disabled');
    }
  }

  /**
   * Report retry statistics
   */
  private reportRetryStats(stats: RequestStats, config: ResolvedTulConfig): void {
    this.logger.info('Retries:');

    if (config.retryOnFailure) {
      this.logger.stat('Max retries', config.maxRetries);
      this.logger.stat('Delay strategy', config.retryDelay);
      this.logger.stat('Retries used', stats.retries);

      if (stats.jsonRepaired) {
        this.logger.stat('JSON repair', 'Applied');
      }
    } else {
      this.logger.stat('Status', 'Retry disabled');
    }
  }

  /**
   * Report token statistics
   */
  private reportTokenStats(stats: RequestStats): void {
    this.logger.info('Tokens:');
    this.logger.stat('Input tokens', stats.inputTokens);
    this.logger.stat('Output tokens', stats.outputTokens);
    this.logger.stat('Total tokens', stats.inputTokens + stats.outputTokens);

    // Calculate and show savings
    const totalSaved = stats.tokensSaved + stats.compressionSaved + stats.contextCompactionSaved;
    if (totalSaved > 0) {
      this.logger.stat('Saved (total)', `${totalSaved} tokens`);

      if (stats.tokensSaved > 0) {
        this.logger.stat('  - Tool filtering', `${stats.tokensSaved} tokens`);
      }
      if (stats.compressionSaved > 0) {
        this.logger.stat('  - Compression', `${stats.compressionSaved} tokens`);
      }
      if (stats.contextCompactionSaved > 0) {
        this.logger.stat('  - Context compaction', `${stats.contextCompactionSaved} tokens`);
      }
    }
  }

  /**
   * Report cumulative statistics across all requests
   */
  reportCumulative(stats: CumulativeStats): void {
    if (!this.verbose) return;

    this.logger.divider('═', 60);
    this.logger.section('Cumulative Statistics');
    this.logger.divider('─', 60);

    // Request summary
    this.logger.info('Requests:');
    this.logger.stat('Total requests', stats.totalRequests);

    // Token summary
    this.logger.info('Tokens:');
    this.logger.stat('Total input', stats.totalInputTokens);
    this.logger.stat('Total output', stats.totalOutputTokens);
    this.logger.stat('Total used', stats.totalInputTokens + stats.totalOutputTokens);
    this.logger.stat('Baseline estimate', stats.estimatedBaselineTokens);
    this.logger.stat('Total saved', `${stats.tokensSaved} (${stats.percentSaved.toFixed(1)}%)`);

    // Tool call summary
    this.logger.info('Tool Calls:');
    this.logger.stat('Total made', stats.toolCallsMade);
    this.logger.stat('Succeeded', stats.toolCallsSucceeded);
    this.logger.stat('Failed', stats.toolCallsFailed);
    this.logger.stat('Recovered', stats.failuresRecovered);
    this.logger.stat('Avg tools/request', stats.avgToolsPerRequest.toFixed(1));
    this.logger.stat('Total filtered', stats.totalToolsFiltered);

    // Validation summary
    this.logger.info('Validation:');
    this.logger.stat('Violations caught', stats.schemaViolationsCaught);
    this.logger.stat('Violations recovered', stats.schemaViolationsRecovered);

    // Loop and cache summary
    this.logger.info('Other:');
    this.logger.stat('Loops prevented', stats.loopsPrevented);
    this.logger.stat('Cache hits', stats.cacheHits);
    this.logger.stat('Cache misses', stats.cacheMisses);

    const cacheHitRate = stats.cacheHits + stats.cacheMisses > 0
      ? (stats.cacheHits / (stats.cacheHits + stats.cacheMisses) * 100).toFixed(1)
      : '0.0';
    this.logger.stat('Cache hit rate', `${cacheHitRate}%`);

    this.logger.divider('═', 60);
  }

  /**
   * Report a summary line (useful for non-verbose mode)
   */
  reportSummary(stats: RequestStats): void {
    const parts: string[] = [];

    if (stats.toolCallsMade > 0) {
      parts.push(`${stats.toolCallsMade} tool calls`);
    }

    if (stats.cacheHits > 0) {
      parts.push(`${stats.cacheHits} cache hits`);
    }

    if (stats.retries > 0) {
      parts.push(`${stats.retries} retries`);
    }

    const totalSaved = stats.tokensSaved + stats.compressionSaved + stats.contextCompactionSaved;
    if (totalSaved > 0) {
      parts.push(`${totalSaved} tokens saved`);
    }

    if (parts.length > 0) {
      this.logger.info(`Request complete: ${parts.join(', ')}`);
    }
  }

  /**
   * Check if cumulative stats should be shown
   */
  shouldShowCumulative(): boolean {
    return this.showCumulative && this.requestCount % this.cumulativeInterval === 0;
  }

  /**
   * Get the current request count
   */
  getRequestCount(): number {
    return this.requestCount;
  }

  /**
   * Reset the request count
   */
  resetRequestCount(): void {
    this.requestCount = 0;
  }
}

/**
 * Create a reporter instance from TulConfig
 */
export function createReporter(config: ResolvedTulConfig): Reporter {
  return new Reporter({
    verbose: config.verbose,
    showCumulative: true,
    cumulativeInterval: 10,
  });
}

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Format a percentage with consistent decimal places
 */
export function formatPercent(value: number, decimals: number = 1): string {
  return `${value.toFixed(decimals)}%`;
}

/**
 * Format token count with optional thousands separator
 */
export function formatTokens(tokens: number): string {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  }
  return tokens.toString();
}

export default Reporter;
