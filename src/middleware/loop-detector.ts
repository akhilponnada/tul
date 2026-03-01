/**
 * Loop Detector Middleware
 *
 * Detects and handles tool call loops:
 * - Identical calls: Same tool with same args called multiple times
 * - Runaway calls: Too many total calls in a single turn
 * - Oscillation patterns: A->B->A->B repeating sequences
 */

import type {
  Middleware,
  ResponseContext,
  FunctionCall,
  ResolvedTulConfig,
} from '../types/index.js';
import { LoopError } from '../types/index.js';
import { hashToolCall } from '../utils/schema-utils.js';
import { getLogger } from '../utils/logger.js';

const logger = getLogger().child('loop-detector');

/**
 * Loop detection state for a single turn
 */
interface LoopState {
  /** Total call count this turn */
  totalCalls: number;

  /** Map of call hash -> count */
  callCounts: Map<string, number>;

  /** Recent call hashes for oscillation detection (circular buffer) */
  recentHashes: string[];

  /** Detected loop type if any */
  detectedLoop?: 'identical' | 'oscillation' | 'runaway';

  /** Details about the detected loop */
  loopDetails?: string;
}

/**
 * Create a fresh loop state
 */
function createLoopState(): LoopState {
  return {
    totalCalls: 0,
    callCounts: new Map(),
    recentHashes: [],
  };
}

/**
 * Detect oscillation patterns in recent calls
 * Looks for A->B->A->B or A->B->C->A->B->C patterns
 */
function detectOscillation(hashes: string[]): { detected: boolean; pattern?: string } {
  if (hashes.length < 4) {
    return { detected: false };
  }

  // Check for 2-call oscillation (A->B->A->B)
  if (hashes.length >= 4) {
    const last4 = hashes.slice(-4);
    if (last4[0] === last4[2] && last4[1] === last4[3] && last4[0] !== last4[1]) {
      return {
        detected: true,
        pattern: `2-call oscillation detected`,
      };
    }
  }

  // Check for 3-call oscillation (A->B->C->A->B->C)
  if (hashes.length >= 6) {
    const last6 = hashes.slice(-6);
    if (
      last6[0] === last6[3] &&
      last6[1] === last6[4] &&
      last6[2] === last6[5] &&
      last6[0] !== last6[1] &&
      last6[1] !== last6[2]
    ) {
      return {
        detected: true,
        pattern: `3-call oscillation detected`,
      };
    }
  }

  return { detected: false };
}

/**
 * Process a function call and check for loops
 */
function processCall(
  state: LoopState,
  call: FunctionCall,
  config: ResolvedTulConfig
): { shouldBreak: boolean; loopType?: 'identical' | 'oscillation' | 'runaway'; details?: string } {
  const hash = hashToolCall(call.name, call.args);

  // Update state
  state.totalCalls++;
  const currentCount = (state.callCounts.get(hash) ?? 0) + 1;
  state.callCounts.set(hash, currentCount);

  // Keep last 10 hashes for oscillation detection
  state.recentHashes.push(hash);
  if (state.recentHashes.length > 10) {
    state.recentHashes.shift();
  }

  // Check for runaway (too many total calls)
  if (state.totalCalls > config.maxToolCallsPerTurn) {
    state.detectedLoop = 'runaway';
    state.loopDetails = `${state.totalCalls} calls exceeds limit of ${config.maxToolCallsPerTurn}`;
    logger.warn(`Runaway loop detected: ${state.loopDetails}`);
    return {
      shouldBreak: config.onLoop === 'break',
      loopType: 'runaway',
      details: state.loopDetails,
    };
  }

  // Check for identical calls
  if (currentCount > config.maxIdenticalCalls) {
    state.detectedLoop = 'identical';
    state.loopDetails = `Tool "${call.name}" called ${currentCount} times with identical args (limit: ${config.maxIdenticalCalls})`;
    logger.warn(`Identical call loop detected: ${state.loopDetails}`);
    return {
      shouldBreak: config.onLoop === 'break',
      loopType: 'identical',
      details: state.loopDetails,
    };
  }

  // Check for oscillation
  const oscillation = detectOscillation(state.recentHashes);
  if (oscillation.detected) {
    state.detectedLoop = 'oscillation';
    state.loopDetails = oscillation.pattern;
    logger.warn(`Oscillation loop detected: ${state.loopDetails}`);
    return {
      shouldBreak: config.onLoop === 'break',
      loopType: 'oscillation',
      details: state.loopDetails,
    };
  }

  return { shouldBreak: false };
}

/**
 * Creates a loop detector middleware instance
 */
export function createLoopDetector(): Middleware & {
  /** Reset state for a new turn */
  resetTurn(): void;
  /** Get current loop state (for testing/debugging) */
  getState(): LoopState;
} {
  let state = createLoopState();

  return {
    name: 'loop-detector',
    enabled: true,

    resetTurn(): void {
      state = createLoopState();
      logger.debug('Loop detector state reset for new turn');
    },

    getState(): LoopState {
      return { ...state, callCounts: new Map(state.callCounts), recentHashes: [...state.recentHashes] };
    },

    async afterResponse(context: ResponseContext): Promise<ResponseContext> {
      const { functionCalls, requestContext } = context;
      const config = requestContext.config;

      if (!config.loopDetection || functionCalls.length === 0) {
        return context;
      }

      let shouldBreak = false;
      let loopType: 'identical' | 'oscillation' | 'runaway' | undefined;
      let loopDetails: string | undefined;

      // Process each function call
      for (const call of functionCalls) {
        const result = processCall(state, call, config);
        if (result.shouldBreak) {
          shouldBreak = true;
          loopType = result.loopType;
          loopDetails = result.details;
          break;
        } else if (result.loopType) {
          // Loop detected but configured to warn only
          loopType = result.loopType;
          loopDetails = result.details;
        }
      }

      // Update stats
      if (loopType) {
        context.stats.loopDetected = true;
      }

      // Handle loop based on config
      if (shouldBreak && loopType && loopDetails) {
        logger.warn(`Breaking loop: ${loopType} - ${loopDetails}`);
        throw new LoopError(loopType, loopDetails);
      }

      // Add warning if loop detected but not breaking
      if (loopType && loopDetails && !shouldBreak) {
        const warnings = context.metadata.warnings as string[] ?? [];
        warnings.push(`Loop detected (${loopType}): ${loopDetails}`);
        context.metadata.warnings = warnings;
      }

      return context;
    },
  };
}

/**
 * Default loop detector instance
 */
export const loopDetector = createLoopDetector();

export default loopDetector;
