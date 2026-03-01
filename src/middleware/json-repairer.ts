/**
 * JSON Repairer Middleware
 *
 * Fixes malformed JSON from Gemini outputs. Uses the jsonrepair package
 * to handle common issues like markdown fences, Python booleans,
 * single quotes, trailing commas, and truncated JSON.
 */

import { jsonrepair } from 'jsonrepair';
import type { Middleware, ResponseContext, FunctionCall } from '../types';
import logger from '../utils/logger';

/**
 * Check if a string is valid JSON
 */
function isValidJson(str: string): boolean {
  try {
    JSON.parse(str);
    return true;
  } catch {
    return false;
  }
}

/**
 * Strip markdown code fences from JSON
 * Handles ```json, ```, and variations
 */
function stripMarkdownFences(str: string): string {
  // Remove opening fence with optional language tag
  let result = str.replace(/^```(?:json|JSON)?\s*\n?/m, '');
  // Remove closing fence
  result = result.replace(/\n?```\s*$/m, '');
  return result.trim();
}

/**
 * Convert Python-style booleans to JSON booleans
 * True -> true, False -> false, None -> null
 */
function convertPythonBooleans(str: string): string {
  // Only replace when they appear as values (not inside strings)
  // This is a simplified approach that works for most cases
  return str
    .replace(/:\s*True\b/g, ': true')
    .replace(/:\s*False\b/g, ': false')
    .replace(/:\s*None\b/g, ': null')
    .replace(/\[\s*True\b/g, '[true')
    .replace(/\[\s*False\b/g, '[false')
    .replace(/\[\s*None\b/g, '[null')
    .replace(/,\s*True\b/g, ', true')
    .replace(/,\s*False\b/g, ', false')
    .replace(/,\s*None\b/g, ', null');
}

/**
 * Convert single quotes to double quotes for JSON compatibility
 * This is a simplified approach - jsonrepair handles most edge cases
 */
function convertSingleQuotes(str: string): string {
  // Let jsonrepair handle this as it's complex with escaping
  return str;
}

/**
 * Attempt to repair truncated JSON by closing brackets/braces
 */
function repairTruncated(str: string): string {
  // Count opening and closing brackets
  let braceCount = 0;
  let bracketCount = 0;
  let inString = false;
  let escapeNext = false;

  for (const char of str) {
    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\' && inString) {
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      switch (char) {
        case '{':
          braceCount++;
          break;
        case '}':
          braceCount--;
          break;
        case '[':
          bracketCount++;
          break;
        case ']':
          bracketCount--;
          break;
      }
    }
  }

  // Close unclosed strings (if odd number of unescaped quotes)
  let result = str;
  if (inString) {
    result += '"';
  }

  // Close brackets and braces
  while (bracketCount > 0) {
    result += ']';
    bracketCount--;
  }
  while (braceCount > 0) {
    result += '}';
    braceCount--;
  }

  return result;
}

/**
 * Main JSON repair function
 * Returns the repaired JSON string or null if repair failed
 */
export function repairJson(input: string): { json: string; repaired: boolean } | null {
  if (!input || typeof input !== 'string') {
    return null;
  }

  const original = input.trim();

  // Fast path: already valid JSON
  if (isValidJson(original)) {
    return { json: original, repaired: false };
  }

  // Pre-processing steps
  let processed = original;

  // Step 1: Strip markdown fences
  processed = stripMarkdownFences(processed);
  if (processed !== original && isValidJson(processed)) {
    return { json: processed, repaired: true };
  }

  // Step 2: Convert Python booleans
  const withPythonFixed = convertPythonBooleans(processed);
  if (withPythonFixed !== processed && isValidJson(withPythonFixed)) {
    return { json: withPythonFixed, repaired: true };
  }
  processed = withPythonFixed;

  // Step 3: Try jsonrepair for comprehensive fixes
  // (handles single quotes, trailing commas, missing quotes, etc.)
  try {
    const repaired = jsonrepair(processed);
    if (isValidJson(repaired)) {
      return { json: repaired, repaired: repaired !== original };
    }
  } catch {
    // jsonrepair failed, continue with manual repairs
  }

  // Step 4: Try repairing truncated JSON
  const withTruncatedFixed = repairTruncated(processed);
  if (withTruncatedFixed !== processed) {
    // Try jsonrepair on the fixed version
    try {
      const repaired = jsonrepair(withTruncatedFixed);
      if (isValidJson(repaired)) {
        return { json: repaired, repaired: true };
      }
    } catch {
      // Fall through
    }

    // Try direct parse
    if (isValidJson(withTruncatedFixed)) {
      return { json: withTruncatedFixed, repaired: true };
    }
  }

  // All repair attempts failed
  return null;
}

/**
 * Repair function call arguments
 */
function repairFunctionCallArgs(
  functionCall: FunctionCall
): { repaired: FunctionCall; wasRepaired: boolean } | null {
  // If args is already an object, check if it needs serialization/repair
  if (typeof functionCall.args === 'object' && functionCall.args !== null) {
    return { repaired: functionCall, wasRepaired: false };
  }

  // If args is a string (malformed), try to repair it
  if (typeof functionCall.args === 'string') {
    const result = repairJson(functionCall.args as unknown as string);
    if (result) {
      try {
        const parsedArgs = JSON.parse(result.json);
        return {
          repaired: {
            ...functionCall,
            args: parsedArgs,
          },
          wasRepaired: result.repaired,
        };
      } catch {
        return null;
      }
    }
    return null;
  }

  return { repaired: functionCall, wasRepaired: false };
}

/**
 * JSON Repairer Middleware
 *
 * Fixes common JSON issues in Gemini's function call outputs:
 * - Markdown code fences (```json ... ```)
 * - Python-style booleans (True, False, None)
 * - Single quotes instead of double quotes
 * - Trailing commas
 * - Truncated/incomplete JSON
 */
export const jsonRepairerMiddleware: Middleware = {
  name: 'json-repairer',
  enabled: true,

  async afterResponse(context: ResponseContext): Promise<ResponseContext> {
    const { functionCalls, requestContext } = context;

    // Skip if JSON repair is disabled
    if (!requestContext.config.jsonRepair) {
      return context;
    }

    // Skip if no function calls to repair
    if (!functionCalls || functionCalls.length === 0) {
      return context;
    }

    let anyRepaired = false;
    const repairedCalls: FunctionCall[] = [];

    for (const call of functionCalls) {
      const result = repairFunctionCallArgs(call);

      if (result) {
        repairedCalls.push(result.repaired);
        if (result.wasRepaired) {
          anyRepaired = true;
          logger.debug(`[json-repairer] Repaired JSON for tool: ${call.name}`);
        }
      } else {
        // Repair failed, keep original and log warning
        logger.warn(`[json-repairer] Failed to repair JSON for tool: ${call.name}`);
        repairedCalls.push(call);
      }
    }

    return {
      ...context,
      functionCalls: repairedCalls,
      stats: {
        ...context.stats,
        jsonRepaired: anyRepaired || context.stats.jsonRepaired,
      },
    };
  },
};

export default jsonRepairerMiddleware;
