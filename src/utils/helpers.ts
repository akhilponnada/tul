/**
 * Tul Helpers - Shared utility functions
 */

/**
 * Deep clone an object (handles circular references)
 */
export function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => deepClone(item)) as T;
  }

  const cloned: Record<string, unknown> = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      cloned[key] = deepClone((obj as Record<string, unknown>)[key]);
    }
  }
  return cloned as T;
}

/**
 * Sort object keys recursively for deterministic hashing
 */
export function sortObjectKeys<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sortObjectKeys(item)) as T;
  }

  const sorted: Record<string, unknown> = {};
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  for (const key of keys) {
    sorted[key] = sortObjectKeys((obj as Record<string, unknown>)[key]);
  }
  return sorted as T;
}

/**
 * Common English stopwords to filter out during tokenization
 */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
  'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those', 'it',
  'its', 'i', 'you', 'he', 'she', 'we', 'they', 'what', 'which', 'who',
  'when', 'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few',
  'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only',
  'same', 'so', 'than', 'too', 'very', 'just', 'also', 'now', 'here',
  'there', 'then', 'once', 'if', 'any', 'into', 'get', 'me', 'my', 'your',
]);

/**
 * Tokenize text into lowercase keywords
 */
export function tokenize(text: string): string[] {
  // Convert camelCase and snake_case to spaces
  const normalized = text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/-/g, ' ')
    .toLowerCase();

  // Split on non-word characters
  const words = normalized.split(/[^a-z0-9]+/).filter(Boolean);

  return words;
}

/**
 * Remove stopwords from token array
 */
export function removeStopwords(tokens: string[]): string[] {
  return tokens.filter((token) => !STOPWORDS.has(token) && token.length > 1);
}

/**
 * Simple fuzzy match - checks if query words appear in target
 * Returns a score from 0 to 1
 */
export function fuzzyMatch(query: string, target: string): number {
  const queryTokens = removeStopwords(tokenize(query));
  const targetTokens = removeStopwords(tokenize(target));

  if (queryTokens.length === 0 || targetTokens.length === 0) {
    return 0;
  }

  const targetSet = new Set(targetTokens);
  let matches = 0;

  for (const queryToken of queryTokens) {
    // Exact match
    if (targetSet.has(queryToken)) {
      matches += 1;
      continue;
    }

    // Partial match (substring)
    for (const targetToken of targetTokens) {
      if (targetToken.includes(queryToken) || queryToken.includes(targetToken)) {
        matches += 0.5;
        break;
      }
    }
  }

  return Math.min(1, matches / queryTokens.length);
}

/**
 * Calculate keyword overlap between two strings
 * Returns a score from 0 to 1
 */
export function keywordOverlap(text1: string, text2: string): number {
  const tokens1 = new Set(removeStopwords(tokenize(text1)));
  const tokens2 = new Set(removeStopwords(tokenize(text2)));

  if (tokens1.size === 0 || tokens2.size === 0) {
    return 0;
  }

  let matches = 0;
  for (const token of tokens1) {
    if (tokens2.has(token)) {
      matches++;
    } else {
      // Partial match
      for (const t2 of tokens2) {
        if (t2.includes(token) || token.includes(t2)) {
          matches += 0.5;
          break;
        }
      }
    }
  }

  // Jaccard-like similarity
  const union = new Set([...tokens1, ...tokens2]).size;
  return matches / union;
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Truncate text to max words while preserving meaning
 */
export function truncateText(text: string, maxWords: number): string {
  const words = text.split(/\s+/);
  if (words.length <= maxWords) {
    return text;
  }

  // Try to end at a sentence boundary
  let truncated = words.slice(0, maxWords).join(' ');
  const lastPeriod = truncated.lastIndexOf('.');
  const lastComma = truncated.lastIndexOf(',');

  if (lastPeriod > truncated.length * 0.5) {
    return truncated.slice(0, lastPeriod + 1);
  }
  if (lastComma > truncated.length * 0.7) {
    return truncated.slice(0, lastComma);
  }

  return truncated;
}

/**
 * Truncate to max characters
 */
export function truncateChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return text.slice(0, maxChars - 3) + '...';
}

/**
 * Format a number with commas
 */
export function formatNumber(num: number): string {
  return num.toLocaleString();
}

/**
 * Format bytes to human readable
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Check if a value is a plain object
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Merge objects deeply
 */
export function deepMerge<T extends Record<string, unknown>>(
  target: T,
  ...sources: Partial<T>[]
): T {
  const result = { ...target };

  for (const source of sources) {
    if (!source) continue;

    for (const key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        const sourceValue = source[key];
        const targetValue = result[key];

        if (isPlainObject(sourceValue) && isPlainObject(targetValue)) {
          (result as Record<string, unknown>)[key] = deepMerge(
            targetValue as Record<string, unknown>,
            sourceValue as Record<string, unknown>
          );
        } else if (sourceValue !== undefined) {
          (result as Record<string, unknown>)[key] = sourceValue;
        }
      }
    }
  }

  return result;
}

/**
 * Create a deterministic string from an object (for comparison)
 */
export function objectToStableString(obj: unknown): string {
  return JSON.stringify(sortObjectKeys(obj));
}

/**
 * Check if two objects are deeply equal
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  return objectToStableString(a) === objectToStableString(b);
}

/**
 * Debounce function
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  ms: number
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout | null = null;

  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => fn(...args), ms);
  };
}

/**
 * Retry a function with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  baseDelay: number,
  exponential = true
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxRetries) {
        const delay = exponential
          ? baseDelay * Math.pow(2, attempt)
          : baseDelay * (attempt + 1);
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Semantic Similarity Functions
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate bigrams (2-character substrings) from a string
 * Used for Dice coefficient calculation
 */
export function getBigrams(str: string): Map<string, number> {
  const bigrams = new Map<string, number>();
  const normalized = str.toLowerCase().trim();

  if (normalized.length < 2) {
    // For single chars, use the char itself
    if (normalized.length === 1) {
      bigrams.set(normalized, 1);
    }
    return bigrams;
  }

  for (let i = 0; i < normalized.length - 1; i++) {
    const bigram = normalized.substring(i, i + 2);
    bigrams.set(bigram, (bigrams.get(bigram) || 0) + 1);
  }

  return bigrams;
}

/**
 * Dice coefficient (Sørensen-Dice) similarity
 * Compares bigrams between two strings
 * Returns a score from 0 to 1 (1 = identical)
 *
 * O(n) time complexity using Map
 */
export function diceCoefficient(str1: string, str2: string): number {
  if (str1 === str2) return 1;
  if (str1.length === 0 || str2.length === 0) return 0;

  const bigrams1 = getBigrams(str1);
  const bigrams2 = getBigrams(str2);

  if (bigrams1.size === 0 || bigrams2.size === 0) return 0;

  let intersectionSize = 0;

  // Count matching bigrams (respecting counts)
  for (const [bigram, count1] of bigrams1) {
    const count2 = bigrams2.get(bigram);
    if (count2) {
      intersectionSize += Math.min(count1, count2);
    }
  }

  // Total bigrams in both strings
  let total1 = 0;
  let total2 = 0;
  for (const count of bigrams1.values()) total1 += count;
  for (const count of bigrams2.values()) total2 += count;

  return (2 * intersectionSize) / (total1 + total2);
}

/**
 * Simple English word stemmer (Porter-like, simplified)
 * Handles common suffixes without external dependencies
 */
export function simpleStem(word: string): string {
  const w = word.toLowerCase();

  // Handle common suffixes
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
  if (w.endsWith('es') && w.length > 3) return w.slice(0, -2);
  if (w.endsWith('s') && w.length > 2 && !w.endsWith('ss')) return w.slice(0, -1);
  if (w.endsWith('ing') && w.length > 5) return w.slice(0, -3);
  if (w.endsWith('ed') && w.length > 4) return w.slice(0, -2);
  if (w.endsWith('ly') && w.length > 4) return w.slice(0, -2);
  if (w.endsWith('ment') && w.length > 6) return w.slice(0, -4);
  if (w.endsWith('tion') && w.length > 5) return w.slice(0, -4) + 't';
  if (w.endsWith('ness') && w.length > 5) return w.slice(0, -4);
  if (w.endsWith('able') && w.length > 5) return w.slice(0, -4);
  if (w.endsWith('ible') && w.length > 5) return w.slice(0, -4);
  if (w.endsWith('ful') && w.length > 4) return w.slice(0, -3);
  if (w.endsWith('ous') && w.length > 4) return w.slice(0, -3);
  if (w.endsWith('ive') && w.length > 4) return w.slice(0, -3);
  if (w.endsWith('er') && w.length > 4) return w.slice(0, -2);
  if (w.endsWith('est') && w.length > 5) return w.slice(0, -3);

  return w;
}

/**
 * Tokenize and stem text
 * Returns array of stemmed words without stopwords
 */
export function tokenizeAndStem(text: string): string[] {
  const tokens = tokenize(text);
  const filtered = removeStopwords(tokens);
  return filtered.map(simpleStem);
}

/**
 * Compute word-level semantic similarity using stemming
 * Better than exact match for handling word variations
 */
export function semanticWordSimilarity(text1: string, text2: string): number {
  const stems1 = new Set(tokenizeAndStem(text1));
  const stems2 = new Set(tokenizeAndStem(text2));

  if (stems1.size === 0 || stems2.size === 0) return 0;

  let matches = 0;

  for (const stem of stems1) {
    if (stems2.has(stem)) {
      matches++;
    } else {
      // Check for partial stem match (prefix matching)
      for (const stem2 of stems2) {
        if (stem.length >= 3 && stem2.length >= 3) {
          if (stem.startsWith(stem2) || stem2.startsWith(stem)) {
            matches += 0.7;
            break;
          }
        }
      }
    }
  }

  // Jaccard-style similarity
  const union = new Set([...stems1, ...stems2]).size;
  return matches / union;
}

/**
 * Compute N-gram overlap for phrase-level matching
 * N-grams are sequences of N consecutive words
 */
export function ngramOverlap(text1: string, text2: string, n: number = 2): number {
  const tokens1 = tokenizeAndStem(text1);
  const tokens2 = tokenizeAndStem(text2);

  if (tokens1.length < n || tokens2.length < n) {
    // Fall back to word similarity for short texts
    return semanticWordSimilarity(text1, text2);
  }

  // Generate n-grams
  const ngrams1 = new Set<string>();
  const ngrams2 = new Set<string>();

  for (let i = 0; i <= tokens1.length - n; i++) {
    ngrams1.add(tokens1.slice(i, i + n).join(' '));
  }

  for (let i = 0; i <= tokens2.length - n; i++) {
    ngrams2.add(tokens2.slice(i, i + n).join(' '));
  }

  if (ngrams1.size === 0 || ngrams2.size === 0) return 0;

  let matches = 0;
  for (const ngram of ngrams1) {
    if (ngrams2.has(ngram)) {
      matches++;
    }
  }

  // Jaccard-style similarity
  const union = new Set([...ngrams1, ...ngrams2]).size;
  return matches / union;
}

/**
 * Combined semantic similarity score
 * Uses multiple techniques for robust matching:
 * 1. Dice coefficient (character-level)
 * 2. Word-level with stemming
 * 3. N-gram overlap (phrase-level)
 *
 * Returns weighted average of all techniques
 */
export function semanticSimilarity(
  text1: string,
  text2: string,
  weights: { dice?: number; word?: number; ngram?: number } = {}
): number {
  const { dice = 0.3, word = 0.5, ngram = 0.2 } = weights;

  // Normalize weights
  const totalWeight = dice + word + ngram;
  const normDice = dice / totalWeight;
  const normWord = word / totalWeight;
  const normNgram = ngram / totalWeight;

  const diceScore = diceCoefficient(text1, text2);
  const wordScore = semanticWordSimilarity(text1, text2);
  const ngramScore = ngramOverlap(text1, text2, 2);

  return (diceScore * normDice) + (wordScore * normWord) + (ngramScore * normNgram);
}

/**
 * Find best matching string from a list
 * Returns the best match and its score
 */
export function findBestMatch(
  target: string,
  candidates: string[]
): { match: string; score: number; index: number } | null {
  if (candidates.length === 0) return null;

  let bestMatch = candidates[0]!;
  let bestScore = 0;
  let bestIndex = 0;

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]!;
    const score = semanticSimilarity(target, candidate);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = candidate;
      bestIndex = i;
    }
  }

  return { match: bestMatch, score: bestScore, index: bestIndex };
}
