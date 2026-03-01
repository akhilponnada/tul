/**
 * Result Cache Tests
 *
 * Tests the LRU cache implementation for tool call results.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ResultCache } from '../src/middleware/result-cache.js';

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

describe('ResultCache', () => {
  let cache: ResultCache;

  beforeEach(() => {
    cache = new ResultCache(100, 300000); // 100 entries, 5 min TTL
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Basic Operations', () => {
    describe('set and get', () => {
      it('should store and retrieve a value', () => {
        cache.set('test_tool', { id: 1 }, 'result');

        const result = cache.get('test_tool', { id: 1 });

        expect(result).toBe('result');
      });

      it('should return undefined for non-existent key', () => {
        const result = cache.get('non_existent', { id: 1 });

        expect(result).toBeUndefined();
      });

      it('should handle different arg values as different keys', () => {
        cache.set('tool', { id: 1 }, 'result1');
        cache.set('tool', { id: 2 }, 'result2');

        expect(cache.get('tool', { id: 1 })).toBe('result1');
        expect(cache.get('tool', { id: 2 })).toBe('result2');
      });

      it('should handle different tool names as different keys', () => {
        cache.set('tool_a', { id: 1 }, 'resultA');
        cache.set('tool_b', { id: 1 }, 'resultB');

        expect(cache.get('tool_a', { id: 1 })).toBe('resultA');
        expect(cache.get('tool_b', { id: 1 })).toBe('resultB');
      });

      it('should overwrite existing value for same key', () => {
        cache.set('tool', { id: 1 }, 'initial');
        cache.set('tool', { id: 1 }, 'updated');

        expect(cache.get('tool', { id: 1 })).toBe('updated');
        expect(cache.size).toBe(1);
      });
    });

    describe('has', () => {
      it('should return true for existing key', () => {
        cache.set('tool', { id: 1 }, 'result');

        expect(cache.has('tool', { id: 1 })).toBe(true);
      });

      it('should return false for non-existent key', () => {
        expect(cache.has('tool', { id: 1 })).toBe(false);
      });

      it('should return false for expired key', () => {
        cache.set('tool', { id: 1 }, 'result', { ttl: 1000 });

        vi.advanceTimersByTime(2000);

        expect(cache.has('tool', { id: 1 })).toBe(false);
      });
    });

    describe('evict', () => {
      it('should remove specific entry', () => {
        cache.set('tool', { id: 1 }, 'result');

        const evicted = cache.evict('tool', { id: 1 });

        expect(evicted).toBe(true);
        expect(cache.get('tool', { id: 1 })).toBeUndefined();
      });

      it('should return false for non-existent entry', () => {
        const evicted = cache.evict('tool', { id: 1 });

        expect(evicted).toBe(false);
      });

      it('should not affect other entries', () => {
        cache.set('tool', { id: 1 }, 'result1');
        cache.set('tool', { id: 2 }, 'result2');

        cache.evict('tool', { id: 1 });

        expect(cache.get('tool', { id: 2 })).toBe('result2');
      });
    });

    describe('evictTool', () => {
      it('should remove all entries for a tool', () => {
        cache.set('tool_a', { id: 1 }, 'result1');
        cache.set('tool_a', { id: 2 }, 'result2');
        cache.set('tool_b', { id: 1 }, 'result3');

        const count = cache.evictTool('tool_a');

        expect(count).toBe(2);
        expect(cache.get('tool_a', { id: 1 })).toBeUndefined();
        expect(cache.get('tool_a', { id: 2 })).toBeUndefined();
        expect(cache.get('tool_b', { id: 1 })).toBe('result3');
      });

      it('should return 0 for non-existent tool', () => {
        const count = cache.evictTool('non_existent');

        expect(count).toBe(0);
      });
    });

    describe('clear', () => {
      it('should remove all entries', () => {
        cache.set('tool_a', { id: 1 }, 'result1');
        cache.set('tool_b', { id: 2 }, 'result2');

        cache.clear();

        expect(cache.size).toBe(0);
        expect(cache.get('tool_a', { id: 1 })).toBeUndefined();
        expect(cache.get('tool_b', { id: 2 })).toBeUndefined();
      });
    });

    describe('size', () => {
      it('should return 0 for empty cache', () => {
        expect(cache.size).toBe(0);
      });

      it('should return correct count', () => {
        cache.set('tool', { id: 1 }, 'r1');
        cache.set('tool', { id: 2 }, 'r2');
        cache.set('tool', { id: 3 }, 'r3');

        expect(cache.size).toBe(3);
      });
    });
  });

  describe('TTL Behavior', () => {
    it('should expire entries after TTL', () => {
      cache.set('tool', { id: 1 }, 'result', { ttl: 1000 });

      expect(cache.get('tool', { id: 1 })).toBe('result');

      vi.advanceTimersByTime(1001);

      expect(cache.get('tool', { id: 1 })).toBeUndefined();
    });

    it('should use default TTL when not specified', () => {
      const shortCache = new ResultCache(100, 1000); // 1 second default TTL
      shortCache.set('tool', { id: 1 }, 'result');

      expect(shortCache.get('tool', { id: 1 })).toBe('result');

      vi.advanceTimersByTime(1001);

      expect(shortCache.get('tool', { id: 1 })).toBeUndefined();
    });

    it('should allow per-entry TTL override', () => {
      cache.set('tool', { id: 1 }, 'short', { ttl: 500 });
      cache.set('tool', { id: 2 }, 'long', { ttl: 5000 });

      vi.advanceTimersByTime(1000);

      expect(cache.get('tool', { id: 1 })).toBeUndefined();
      expect(cache.get('tool', { id: 2 })).toBe('long');
    });

    it('should not cache when TTL is 0', () => {
      cache.set('tool', { id: 1 }, 'result', { ttl: 0 });

      expect(cache.get('tool', { id: 1 })).toBeUndefined();
      expect(cache.size).toBe(0);
    });

    it('should not cache when TTL is negative', () => {
      cache.set('tool', { id: 1 }, 'result', { ttl: -100 });

      expect(cache.get('tool', { id: 1 })).toBeUndefined();
    });
  });

  describe('LRU Behavior', () => {
    it('should evict oldest entry when at capacity', () => {
      const smallCache = new ResultCache(3, 300000);

      smallCache.set('tool', { id: 1 }, 'oldest');
      smallCache.set('tool', { id: 2 }, 'middle');
      smallCache.set('tool', { id: 3 }, 'newest');

      // Cache is now full
      expect(smallCache.size).toBe(3);

      // Add one more - should evict id:1
      smallCache.set('tool', { id: 4 }, 'newer');

      expect(smallCache.size).toBe(3);
      expect(smallCache.get('tool', { id: 1 })).toBeUndefined();
      expect(smallCache.get('tool', { id: 2 })).toBe('middle');
      expect(smallCache.get('tool', { id: 4 })).toBe('newer');
    });

    it('should refresh position on get', () => {
      const smallCache = new ResultCache(3, 300000);

      smallCache.set('tool', { id: 1 }, 'first');
      smallCache.set('tool', { id: 2 }, 'second');
      smallCache.set('tool', { id: 3 }, 'third');

      // Access id:1 to refresh its position
      smallCache.get('tool', { id: 1 });

      // Add new entry - should evict id:2 (now oldest)
      smallCache.set('tool', { id: 4 }, 'fourth');

      expect(smallCache.get('tool', { id: 1 })).toBe('first'); // Was refreshed
      expect(smallCache.get('tool', { id: 2 })).toBeUndefined(); // Was evicted
    });

    it('should refresh position on update', () => {
      const smallCache = new ResultCache(3, 300000);

      smallCache.set('tool', { id: 1 }, 'first');
      smallCache.set('tool', { id: 2 }, 'second');
      smallCache.set('tool', { id: 3 }, 'third');

      // Update id:1 to refresh its position
      smallCache.set('tool', { id: 1 }, 'first-updated');

      // Add new entry - should evict id:2
      smallCache.set('tool', { id: 4 }, 'fourth');

      expect(smallCache.get('tool', { id: 1 })).toBe('first-updated');
      expect(smallCache.get('tool', { id: 2 })).toBeUndefined();
    });
  });

  describe('prune', () => {
    it('should remove expired entries', () => {
      cache.set('tool', { id: 1 }, 'r1', { ttl: 1000 });
      cache.set('tool', { id: 2 }, 'r2', { ttl: 2000 });
      cache.set('tool', { id: 3 }, 'r3', { ttl: 3000 });

      vi.advanceTimersByTime(1500);

      const pruned = cache.prune();

      expect(pruned).toBe(1);
      expect(cache.size).toBe(2);
      expect(cache.get('tool', { id: 1 })).toBeUndefined();
      expect(cache.get('tool', { id: 2 })).toBe('r2');
    });

    it('should return 0 when nothing to prune', () => {
      cache.set('tool', { id: 1 }, 'result');

      const pruned = cache.prune();

      expect(pruned).toBe(0);
    });

    it('should remove all entries if all expired', () => {
      cache.set('tool', { id: 1 }, 'r1', { ttl: 100 });
      cache.set('tool', { id: 2 }, 'r2', { ttl: 100 });

      vi.advanceTimersByTime(200);

      const pruned = cache.prune();

      expect(pruned).toBe(2);
      expect(cache.size).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return cache statistics', () => {
      const stats = cache.getStats();

      expect(stats.size).toBe(0);
      expect(stats.maxSize).toBe(100);
      expect(stats.defaultTTL).toBe(300000);
    });

    it('should reflect current size', () => {
      cache.set('tool', { id: 1 }, 'r1');
      cache.set('tool', { id: 2 }, 'r2');

      const stats = cache.getStats();

      expect(stats.size).toBe(2);
    });
  });

  describe('Key Generation', () => {
    it('should generate consistent keys for same args', () => {
      cache.set('tool', { a: 1, b: 2 }, 'result');

      // Same args should retrieve same result
      expect(cache.get('tool', { a: 1, b: 2 })).toBe('result');
    });

    it('should generate consistent keys regardless of arg order', () => {
      cache.set('tool', { a: 1, b: 2, c: 3 }, 'result');

      // Different order should still match (due to sorting)
      expect(cache.get('tool', { c: 3, a: 1, b: 2 })).toBe('result');
    });

    it('should handle nested objects with same structure', () => {
      cache.set('tool', { nested: { deep: { value: 1 } } }, 'result');

      // Same nested structure should match (JSON.stringify produces same result)
      expect(cache.get('tool', { nested: { deep: { value: 1 } } })).toBe('result');
    });

    it('should differentiate args with different top-level keys', () => {
      cache.set('tool', { a: 1 }, 'result1');
      cache.set('tool', { b: 1 }, 'result2');

      // Different top-level keys should produce different cache keys
      expect(cache.get('tool', { a: 1 })).toBe('result1');
      expect(cache.get('tool', { b: 1 })).toBe('result2');
    });

    it('should handle array arguments', () => {
      cache.set('tool', { items: [1, 2, 3] }, 'result');

      expect(cache.get('tool', { items: [1, 2, 3] })).toBe('result');
      expect(cache.get('tool', { items: [1, 2] })).toBeUndefined();
    });

    it('should handle empty args', () => {
      cache.set('tool', {}, 'result');

      expect(cache.get('tool', {})).toBe('result');
    });
  });

  describe('Value Types', () => {
    it('should cache string values', () => {
      cache.set('tool', { id: 1 }, 'string result');

      expect(cache.get('tool', { id: 1 })).toBe('string result');
    });

    it('should cache number values', () => {
      cache.set('tool', { id: 1 }, 42);

      expect(cache.get('tool', { id: 1 })).toBe(42);
    });

    it('should cache boolean values', () => {
      cache.set('tool', { id: 1 }, true);
      cache.set('tool', { id: 2 }, false);

      expect(cache.get('tool', { id: 1 })).toBe(true);
      expect(cache.get('tool', { id: 2 })).toBe(false);
    });

    it('should cache null values', () => {
      cache.set('tool', { id: 1 }, null);

      expect(cache.get('tool', { id: 1 })).toBeNull();
    });

    it('should cache object values', () => {
      const obj = { name: 'test', count: 5 };
      cache.set('tool', { id: 1 }, obj);

      expect(cache.get('tool', { id: 1 })).toEqual(obj);
    });

    it('should cache array values', () => {
      const arr = [1, 2, 3, 'four'];
      cache.set('tool', { id: 1 }, arr);

      expect(cache.get('tool', { id: 1 })).toEqual(arr);
    });

    it('should cache complex nested values', () => {
      const complex = {
        users: [
          { id: 1, name: 'Alice', roles: ['admin'] },
          { id: 2, name: 'Bob', roles: ['user'] },
        ],
        metadata: {
          total: 2,
          page: 1,
        },
      };

      cache.set('tool', { query: 'users' }, complex);

      expect(cache.get('tool', { query: 'users' })).toEqual(complex);
    });
  });

  describe('Constructor Options', () => {
    it('should respect custom maxSize', () => {
      const smallCache = new ResultCache(2, 300000);

      smallCache.set('tool', { id: 1 }, 'r1');
      smallCache.set('tool', { id: 2 }, 'r2');
      smallCache.set('tool', { id: 3 }, 'r3');

      expect(smallCache.size).toBe(2);
    });

    it('should respect custom default TTL', () => {
      const shortTTLCache = new ResultCache(100, 500);

      shortTTLCache.set('tool', { id: 1 }, 'result');

      expect(shortTTLCache.get('tool', { id: 1 })).toBe('result');

      vi.advanceTimersByTime(501);

      expect(shortTTLCache.get('tool', { id: 1 })).toBeUndefined();
    });

    it('should use default values when not specified', () => {
      const defaultCache = new ResultCache();
      const stats = defaultCache.getStats();

      expect(stats.maxSize).toBe(100);
      expect(stats.defaultTTL).toBe(300000);
    });
  });

  describe('Edge Cases', () => {
    it('should handle tool names with special characters', () => {
      cache.set('tool:with:colons', { id: 1 }, 'result');

      expect(cache.get('tool:with:colons', { id: 1 })).toBe('result');
    });

    it('should handle very long tool names', () => {
      const longName = 'a'.repeat(1000);
      cache.set(longName, { id: 1 }, 'result');

      expect(cache.get(longName, { id: 1 })).toBe('result');
    });

    it('should handle very large argument objects', () => {
      const largeArgs: Record<string, number> = {};
      for (let i = 0; i < 100; i++) {
        largeArgs[`key${i}`] = i;
      }

      cache.set('tool', largeArgs, 'result');

      expect(cache.get('tool', largeArgs)).toBe('result');
    });

    it('should handle undefined in args', () => {
      cache.set('tool', { id: 1, value: undefined } as Record<string, unknown>, 'result');

      expect(cache.get('tool', { id: 1, value: undefined } as Record<string, unknown>)).toBe('result');
    });

    it('should handle rapid consecutive operations', () => {
      for (let i = 0; i < 1000; i++) {
        cache.set('tool', { id: i }, `result${i}`);
      }

      // Should only have last 100 (maxSize)
      expect(cache.size).toBe(100);
      expect(cache.get('tool', { id: 999 })).toBe('result999');
      expect(cache.get('tool', { id: 0 })).toBeUndefined();
    });

    it('should handle concurrent-like access patterns', () => {
      // Simulate interleaved reads and writes
      cache.set('tool', { id: 1 }, 'v1');
      cache.get('tool', { id: 1 });
      cache.set('tool', { id: 2 }, 'v2');
      cache.get('tool', { id: 1 });
      cache.set('tool', { id: 1 }, 'v1-updated');
      cache.get('tool', { id: 2 });

      expect(cache.get('tool', { id: 1 })).toBe('v1-updated');
      expect(cache.get('tool', { id: 2 })).toBe('v2');
    });
  });

  describe('Memory Considerations', () => {
    it('should not hold references to evicted entries', () => {
      const smallCache = new ResultCache(1, 300000);

      const obj1 = { large: 'data'.repeat(1000) };
      const obj2 = { large: 'data'.repeat(1000) };

      smallCache.set('tool', { id: 1 }, obj1);
      smallCache.set('tool', { id: 2 }, obj2);

      // obj1 should be evicted and not retrievable
      expect(smallCache.get('tool', { id: 1 })).toBeUndefined();
      expect(smallCache.size).toBe(1);
    });
  });
});
