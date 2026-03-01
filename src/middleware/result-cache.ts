/**
 * Tul Result Cache - LRU cache for tool results
 *
 * Uses Map for LRU ordering (Map maintains insertion order).
 * Supports per-tool TTL overrides.
 */

import {
  CacheEntry,
  Middleware,
  RequestContext,
  ResponseContext,
  ResolvedTulConfig,
} from '../types/index.js';
import { getLogger } from '../utils/logger.js';

/**
 * Options for cache operations
 */
export interface CacheOptions {
  /** TTL in milliseconds (overrides default) */
  ttl?: number;
}

/**
 * LRU cache for tool call results
 *
 * Features:
 * - LRU eviction using Map's insertion order
 * - Per-entry TTL with automatic expiration
 * - Per-tool TTL override support
 * - Configurable max size
 */
export class ResultCache {
  private cache: Map<string, CacheEntry>;
  private maxSize: number;
  private defaultTTL: number;
  private logger = getLogger().child('cache');

  /**
   * Create a new ResultCache
   * @param maxSize Maximum number of entries (default: 100)
   * @param defaultTTL Default TTL in milliseconds (default: 300000 = 5 min)
   */
  constructor(maxSize = 100, defaultTTL = 300000) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.defaultTTL = defaultTTL;
  }

  /**
   * Generate a cache key from tool name and arguments
   */
  private generateKey(toolName: string, args: Record<string, unknown>): string {
    const sortedArgs = JSON.stringify(args, Object.keys(args).sort());
    return `${toolName}:${sortedArgs}`;
  }

  /**
   * Check if an entry is expired
   */
  private isExpired(entry: CacheEntry): boolean {
    return Date.now() > entry.timestamp + entry.ttl;
  }

  /**
   * Get a cached result for a tool call
   * @param toolName Name of the tool
   * @param args Tool arguments
   * @returns Cached result or undefined if not found/expired
   */
  get(toolName: string, args: Record<string, unknown>): unknown | undefined {
    const key = this.generateKey(toolName, args);
    const entry = this.cache.get(key);

    if (!entry) {
      this.logger.debug(`Cache miss: ${toolName}`);
      return undefined;
    }

    if (this.isExpired(entry)) {
      this.logger.debug(`Cache expired: ${toolName}`);
      this.cache.delete(key);
      return undefined;
    }

    // Move to end for LRU (delete and re-add)
    this.cache.delete(key);
    this.cache.set(key, entry);

    this.logger.debug(`Cache hit: ${toolName}`);
    return entry.result;
  }

  /**
   * Store a tool result in the cache
   * @param toolName Name of the tool
   * @param args Tool arguments
   * @param result Result to cache
   * @param options Cache options (optional TTL override)
   */
  set(
    toolName: string,
    args: Record<string, unknown>,
    result: unknown,
    options?: CacheOptions
  ): void {
    const key = this.generateKey(toolName, args);
    const ttl = options?.ttl ?? this.defaultTTL;

    // Skip caching if TTL is 0 or negative
    if (ttl <= 0) {
      this.logger.debug(`Skipping cache (TTL=0): ${toolName}`);
      return;
    }

    // Evict if at capacity (before adding new entry)
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictOldest();
    }

    // If key exists, delete first to update position
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    const entry: CacheEntry = {
      result,
      timestamp: Date.now(),
      ttl,
    };

    this.cache.set(key, entry);
    this.logger.debug(`Cached: ${toolName} (TTL: ${ttl}ms)`);
  }

  /**
   * Check if a valid (non-expired) cache entry exists
   * @param toolName Name of the tool
   * @param args Tool arguments
   */
  has(toolName: string, args: Record<string, unknown>): boolean {
    const key = this.generateKey(toolName, args);
    const entry = this.cache.get(key);

    if (!entry) {
      return false;
    }

    if (this.isExpired(entry)) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Evict a specific tool result from the cache
   * @param toolName Name of the tool
   * @param args Tool arguments
   * @returns true if entry was evicted, false if not found
   */
  evict(toolName: string, args: Record<string, unknown>): boolean {
    const key = this.generateKey(toolName, args);
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.logger.debug(`Evicted: ${toolName}`);
    }
    return deleted;
  }

  /**
   * Evict all cached results for a specific tool
   * @param toolName Name of the tool
   * @returns Number of entries evicted
   */
  evictTool(toolName: string): number {
    const prefix = `${toolName}:`;
    let count = 0;

    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        count++;
      }
    }

    if (count > 0) {
      this.logger.debug(`Evicted ${count} entries for tool: ${toolName}`);
    }
    return count;
  }

  /**
   * Evict the oldest (least recently used) entry
   */
  private evictOldest(): void {
    // Map iterates in insertion order, so first key is oldest
    const oldestKey = this.cache.keys().next().value;
    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.logger.debug('Evicted oldest entry (LRU)');
    }
  }

  /**
   * Clear all cached entries
   */
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    this.logger.debug(`Cleared cache (${size} entries)`);
  }

  /**
   * Remove all expired entries
   * @returns Number of entries removed
   */
  prune(): number {
    let count = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (this.isExpired(entry)) {
        this.cache.delete(key);
        count++;
      }
    }

    if (count > 0) {
      this.logger.debug(`Pruned ${count} expired entries`);
    }
    return count;
  }

  /**
   * Get current cache size
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; maxSize: number; defaultTTL: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      defaultTTL: this.defaultTTL,
    };
  }
}

/**
 * Result Cache Middleware
 *
 * Middleware wrapper around ResultCache that integrates with the
 * Tul middleware pipeline. Stores cache instance in request context
 * metadata for use by the tool runner.
 */
export class ResultCacheMiddleware implements Middleware {
  name = 'result-cache';
  enabled: boolean;
  private cache: ResultCache;
  private logger = getLogger().child('result-cache-middleware');

  constructor(config: ResolvedTulConfig) {
    this.enabled = config.resultCaching;
    this.cache = new ResultCache(config.cacheMaxSize, config.cacheTTL);
    this.logger.debug(
      `Initialized: enabled=${this.enabled}, maxSize=${config.cacheMaxSize}, TTL=${config.cacheTTL}ms`
    );
  }

  /**
   * Get the underlying ResultCache instance
   */
  getCache(): ResultCache {
    return this.cache;
  }

  /**
   * Before request: attach cache to metadata for tool runner access
   */
  async beforeRequest(context: RequestContext): Promise<RequestContext> {
    if (!this.enabled) {
      return context;
    }

    // Prune expired entries periodically
    this.cache.prune();

    // Attach cache to metadata so tool runner can access it
    context.metadata.resultCache = this.cache;

    this.logger.debug(`Cache attached to context (${this.cache.size} entries)`);

    return context;
  }

  /**
   * After response: update cache stats
   */
  async afterResponse(context: ResponseContext): Promise<ResponseContext> {
    if (!this.enabled) {
      return context;
    }

    // Stats are updated by the tool runner when it uses the cache
    // This hook is available for any post-response cache maintenance

    return context;
  }

  /**
   * Clear all cached entries
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Evict cached results for a specific tool
   */
  evictTool(toolName: string): number {
    return this.cache.evictTool(toolName);
  }
}

/**
 * Factory function to create a ResultCacheMiddleware instance
 */
export function createResultCacheMiddleware(
  config: ResolvedTulConfig
): ResultCacheMiddleware {
  return new ResultCacheMiddleware(config);
}

export default ResultCache;
