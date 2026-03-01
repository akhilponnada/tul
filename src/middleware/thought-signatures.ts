/**
 * Thought Signatures Middleware
 *
 * Manages thought signatures for Gemini 3+ models that support thinking/reasoning.
 * Thought signatures are cryptographic tokens that prove thoughts were generated
 * by the model and must be passed back in subsequent requests.
 *
 * Features:
 * - Auto-detect Gemini 3+ models
 * - Extract thought signatures from responses
 * - Store signatures for multi-turn conversations
 * - Attach signatures to subsequent requests
 * - Graceful degradation for unsupported models
 */

import type {
  Middleware,
  RequestContext,
  ResponseContext,
  ContentPart,
  ThoughtPart,
  Content,
} from '../types';
import { getLogger } from '../utils/logger';

const logger = getLogger().child('thought-signatures');

// ═══════════════════════════════════════════════════════════════════════════════
// Model Detection
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Models that support thought signatures (Gemini 3+)
 */
const THOUGHT_SIGNATURE_MODELS = [
  'gemini-3',
  'gemini-3-pro',
  'gemini-3-ultra',
  'gemini-3.5',
  'gemini-3.5-pro',
  'gemini-3.5-ultra',
  'gemini-4',
];

/**
 * Check if a model supports thought signatures
 */
export function supportsThoughtSignatures(model: string): boolean {
  const normalizedModel = model.toLowerCase();

  // Check exact matches first
  for (const supported of THOUGHT_SIGNATURE_MODELS) {
    if (normalizedModel === supported || normalizedModel.startsWith(`${supported}-`)) {
      return true;
    }
  }

  // Check for gemini-3+ pattern (gemini-3, gemini-3.5, gemini-4, etc.)
  const gemini3PlusPattern = /^gemini-([3-9]|[1-9]\d+)(\.\d+)?(-|$)/;
  if (gemini3PlusPattern.test(normalizedModel)) {
    return true;
  }

  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Signature Storage
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * In-memory storage for thought signatures
 * Maps conversation/session ID to latest signature
 */
class ThoughtSignatureStore {
  private signatures: Map<string, string> = new Map();
  private timestamps: Map<string, number> = new Map();
  private maxAge: number;
  private maxEntries: number;

  constructor(maxAge = 30 * 60 * 1000, maxEntries = 1000) {
    this.maxAge = maxAge; // Default: 30 minutes
    this.maxEntries = maxEntries;
  }

  /**
   * Store a signature for a session
   */
  set(sessionId: string, signature: string): void {
    // Evict old entries if needed
    this.evictExpired();

    if (this.signatures.size >= this.maxEntries) {
      this.evictOldest();
    }

    this.signatures.set(sessionId, signature);
    this.timestamps.set(sessionId, Date.now());
    logger.debug(`Stored thought signature for session: ${sessionId.slice(0, 8)}...`);
  }

  /**
   * Get signature for a session
   */
  get(sessionId: string): string | undefined {
    const timestamp = this.timestamps.get(sessionId);

    if (!timestamp) {
      return undefined;
    }

    // Check if expired
    if (Date.now() - timestamp > this.maxAge) {
      this.delete(sessionId);
      return undefined;
    }

    return this.signatures.get(sessionId);
  }

  /**
   * Delete signature for a session
   */
  delete(sessionId: string): void {
    this.signatures.delete(sessionId);
    this.timestamps.delete(sessionId);
  }

  /**
   * Clear all signatures
   */
  clear(): void {
    this.signatures.clear();
    this.timestamps.clear();
  }

  /**
   * Evict expired entries
   */
  private evictExpired(): void {
    const now = Date.now();
    for (const [sessionId, timestamp] of this.timestamps) {
      if (now - timestamp > this.maxAge) {
        this.delete(sessionId);
      }
    }
  }

  /**
   * Evict oldest entry
   */
  private evictOldest(): void {
    let oldest: string | undefined;
    let oldestTime = Infinity;

    for (const [sessionId, timestamp] of this.timestamps) {
      if (timestamp < oldestTime) {
        oldest = sessionId;
        oldestTime = timestamp;
      }
    }

    if (oldest) {
      this.delete(oldest);
    }
  }

  /**
   * Get store statistics
   */
  getStats(): { size: number; maxAge: number; maxEntries: number } {
    return {
      size: this.signatures.size,
      maxAge: this.maxAge,
      maxEntries: this.maxEntries,
    };
  }
}

// Global signature store
const signatureStore = new ThoughtSignatureStore();

// ═══════════════════════════════════════════════════════════════════════════════
// Signature Extraction
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Check if a content part is a thought part
 */
function isThoughtPart(part: ContentPart): part is ThoughtPart {
  return 'thought' in part && typeof (part as ThoughtPart).thought === 'string';
}

/**
 * Extract thought signature from response parts
 */
export function extractThoughtSignature(parts: ContentPart[]): string | undefined {
  for (const part of parts) {
    if (isThoughtPart(part) && part.thoughtSignature) {
      return part.thoughtSignature;
    }
  }
  return undefined;
}

/**
 * Extract thought signature from raw API response
 * Handles various response formats from @google/genai
 */
export function extractSignatureFromRawResponse(response: unknown): string | undefined {
  if (!response || typeof response !== 'object') {
    return undefined;
  }

  const resp = response as Record<string, unknown>;

  // Try response.candidates[0].content.parts
  if (Array.isArray(resp.candidates) && resp.candidates.length > 0) {
    const candidate = resp.candidates[0] as Record<string, unknown>;
    if (candidate.content && typeof candidate.content === 'object') {
      const content = candidate.content as Record<string, unknown>;
      if (Array.isArray(content.parts)) {
        const signature = extractThoughtSignature(content.parts as ContentPart[]);
        if (signature) {
          return signature;
        }
      }
    }
  }

  // Try response.response.candidates (wrapped response)
  if (resp.response && typeof resp.response === 'object') {
    return extractSignatureFromRawResponse(resp.response);
  }

  // Try direct parts access
  if (Array.isArray(resp.parts)) {
    return extractThoughtSignature(resp.parts as ContentPart[]);
  }

  return undefined;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Signature Attachment
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Attach thought signature to message history
 * The signature should be included in the previous model response
 */
export function attachSignatureToMessages(
  messages: Content[],
  signature: string
): Content[] {
  if (!signature || messages.length === 0) {
    return messages;
  }

  // Find the last model message and ensure it has the signature
  const lastModelIndex = messages.findLastIndex((m) => m.role === 'model');

  if (lastModelIndex === -1) {
    logger.debug('No model message found to attach signature');
    return messages;
  }

  // Clone messages to avoid mutation
  const updatedMessages = messages.map((msg, idx) => {
    if (idx === lastModelIndex) {
      // Check if any part already has this signature
      const hasSignature = msg.parts.some(
        (part) => isThoughtPart(part) && part.thoughtSignature === signature
      );

      if (hasSignature) {
        return msg;
      }

      // Check if there's a thought part without signature
      const thoughtPartIndex = msg.parts.findIndex(
        (part) => isThoughtPart(part) && !part.thoughtSignature
      );

      if (thoughtPartIndex !== -1) {
        // Add signature to existing thought part
        const updatedParts = [...msg.parts];
        updatedParts[thoughtPartIndex] = {
          ...updatedParts[thoughtPartIndex],
          thoughtSignature: signature,
        } as ThoughtPart;
        return { ...msg, parts: updatedParts };
      }

      // No thought part found, signature should have been included already
      // This might indicate the signature was already processed
      logger.debug('No thought part found to attach signature');
      return msg;
    }
    return msg;
  });

  return updatedMessages;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Session ID Generation
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate a session ID from message history
 * Uses a hash of the first user message to create a stable session ID
 */
export function generateSessionId(messages: Content[]): string {
  // Find first user message
  const firstUserMessage = messages.find((m) => m.role === 'user');

  if (!firstUserMessage) {
    // Fallback to random ID if no user message
    return `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  // Create hash from first user message content
  const content = firstUserMessage.parts
    .map((part) => {
      if ('text' in part) return part.text;
      if ('functionCall' in part) return JSON.stringify(part.functionCall);
      return '';
    })
    .join('');

  // Simple hash function
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }

  return `session-${Math.abs(hash).toString(36)}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Middleware Implementation
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create thought signatures middleware
 */
export function createThoughtSignaturesMiddleware(): Middleware {
  return {
    name: 'thought-signatures',
    enabled: true,

    /**
     * Before request: Attach stored signature to context if available
     */
    async beforeRequest(context: RequestContext): Promise<RequestContext> {
      const { config, messages } = context;

      // Check if feature is enabled
      if (!config.thoughtSignatures) {
        logger.debug('Thought signatures disabled');
        return context;
      }

      // Check if model supports thought signatures
      if (!supportsThoughtSignatures(config.model)) {
        logger.debug(`Model ${config.model} does not support thought signatures`);
        return context;
      }

      // Generate session ID
      const sessionId = generateSessionId(messages);

      // Check for stored signature
      const storedSignature = signatureStore.get(sessionId);

      if (storedSignature) {
        logger.debug('Found stored thought signature, attaching to messages');

        // Attach signature to message history
        const updatedMessages = attachSignatureToMessages(messages, storedSignature);

        return {
          ...context,
          messages: updatedMessages,
          thoughtSignature: storedSignature,
          metadata: {
            ...context.metadata,
            thoughtSignatureSessionId: sessionId,
            thoughtSignatureAttached: true,
          },
        };
      }

      // No stored signature, but save session ID for later
      return {
        ...context,
        metadata: {
          ...context.metadata,
          thoughtSignatureSessionId: sessionId,
        },
      };
    },

    /**
     * After response: Extract and store thought signature if present
     */
    async afterResponse(context: ResponseContext): Promise<ResponseContext> {
      const { requestContext, response } = context;
      const { config } = requestContext;

      // Check if feature is enabled
      if (!config.thoughtSignatures) {
        return context;
      }

      // Check if model supports thought signatures
      if (!supportsThoughtSignatures(config.model)) {
        return context;
      }

      // Try to extract signature from response
      const signature = extractSignatureFromRawResponse(response);

      if (signature) {
        logger.debug('Extracted thought signature from response');

        // Get session ID from metadata
        const sessionId = requestContext.metadata.thoughtSignatureSessionId as string;

        if (sessionId) {
          // Store signature for future requests
          signatureStore.set(sessionId, signature);
        }

        return {
          ...context,
          thoughtSignature: signature,
          metadata: {
            ...context.metadata,
            thoughtSignatureExtracted: true,
          },
        };
      }

      // No signature found (might not be a thinking response)
      logger.debug('No thought signature found in response');
      return context;
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Utility Exports
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Clear all stored thought signatures
 */
export function clearThoughtSignatures(): void {
  signatureStore.clear();
  logger.debug('Cleared all thought signatures');
}

/**
 * Get thought signature store statistics
 */
export function getThoughtSignatureStats(): { size: number; maxAge: number; maxEntries: number } {
  return signatureStore.getStats();
}

/**
 * Manually store a thought signature for a session
 */
export function storeThoughtSignature(sessionId: string, signature: string): void {
  signatureStore.set(sessionId, signature);
}

/**
 * Get stored thought signature for a session
 */
export function getStoredThoughtSignature(sessionId: string): string | undefined {
  return signatureStore.get(sessionId);
}

export default createThoughtSignaturesMiddleware;
