/**
 * Tul Strict Validator Middleware - Claude-inspired schema validation for tool calls
 *
 * Validates tool call arguments against their JSON schema definitions.
 * On validation failure: retry, warn, or throw based on configuration.
 */

import type {
  Middleware,
  ResponseContext,
  FunctionCall,
  InternalToolDefinition,
  JsonSchema,
  ValidationResult,
} from '../types/index.js';
import { validateAgainstSchema } from '../utils/schema-utils.js';

/**
 * Validation failure action configuration
 */
export type ValidationAction = 'retry' | 'warn' | 'throw';

/**
 * Configuration for strict validator
 */
export interface StrictValidatorConfig {
  /** Action to take on validation failure (default: 'retry') */
  onFailure: ValidationAction;

  /** Maximum retry attempts for validation failures (default: 2) */
  maxRetries: number;

  /** Whether to include detailed errors in retry prompt (default: true) */
  includeErrorsInRetry: boolean;

  /** Whether to validate even if tool doesn't have strict: true (default: false) */
  validateAll: boolean;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: StrictValidatorConfig = {
  onFailure: 'retry',
  maxRetries: 2,
  includeErrorsInRetry: true,
  validateAll: false,
};

/**
 * Validation failure details for a single tool call
 */
interface ValidationFailure {
  toolName: string;
  args: Record<string, unknown>;
  errors: string[];
  schema: JsonSchema;
}

/**
 * Create a strict validator middleware instance
 */
export function createStrictValidator(
  config: Partial<StrictValidatorConfig> = {}
): Middleware {
  const resolvedConfig: StrictValidatorConfig = {
    ...DEFAULT_CONFIG,
    ...config,
  };

  // Track retry attempts per conversation turn
  let currentRetryCount = 0;

  return {
    name: 'strict-validator',
    enabled: true,

    async afterResponse(context: ResponseContext): Promise<ResponseContext> {
      const { functionCalls, requestContext } = context;

      // No function calls to validate
      if (!functionCalls || functionCalls.length === 0) {
        currentRetryCount = 0;
        return context;
      }

      // Build tool lookup for schema access
      const toolLookup = buildToolLookup(requestContext.filteredTools);

      // Validate all function calls
      const failures = validateFunctionCalls(
        functionCalls,
        toolLookup,
        resolvedConfig.validateAll
      );

      // All validations passed
      if (failures.length === 0) {
        currentRetryCount = 0;
        context.stats.validationFailed = false;
        return context;
      }

      // Track validation failure in stats
      context.stats.validationFailed = true;

      // Handle failures based on configured action
      return handleValidationFailures(
        context,
        failures,
        resolvedConfig,
        currentRetryCount++
      );
    },
  };
}

/**
 * Build a lookup map from tool name to definition
 */
function buildToolLookup(
  tools: InternalToolDefinition[]
): Map<string, InternalToolDefinition> {
  const lookup = new Map<string, InternalToolDefinition>();
  for (const tool of tools) {
    lookup.set(tool.name, tool);
  }
  return lookup;
}

/**
 * Validate all function calls against their schemas
 */
function validateFunctionCalls(
  calls: FunctionCall[],
  toolLookup: Map<string, InternalToolDefinition>,
  validateAll: boolean
): ValidationFailure[] {
  const failures: ValidationFailure[] = [];

  for (const call of calls) {
    const tool = toolLookup.get(call.name);

    // Skip if tool not found (shouldn't happen, but be safe)
    if (!tool) {
      continue;
    }

    // Skip validation if tool doesn't require strict mode and validateAll is false
    if (!validateAll && !tool.strict) {
      continue;
    }

    // Skip if no schema defined
    if (!tool.parameters) {
      continue;
    }

    // Validate arguments against schema
    const result = validateAgainstSchema(call.args, tool.parameters);

    if (!result.valid) {
      failures.push({
        toolName: call.name,
        args: call.args,
        errors: result.errors,
        schema: tool.parameters,
      });
    }
  }

  return failures;
}

/**
 * Handle validation failures based on configured action
 */
function handleValidationFailures(
  context: ResponseContext,
  failures: ValidationFailure[],
  config: StrictValidatorConfig,
  retryCount: number
): ResponseContext {
  const failureMessages = formatFailureMessages(failures);

  switch (config.onFailure) {
    case 'retry':
      return handleRetryAction(context, failures, config, retryCount, failureMessages);

    case 'warn':
      return handleWarnAction(context, failureMessages);

    case 'throw':
      return handleThrowAction(failures);

    default:
      // Fallback to warn if unknown action
      return handleWarnAction(context, failureMessages);
  }
}

/**
 * Handle retry action for validation failures
 */
function handleRetryAction(
  context: ResponseContext,
  failures: ValidationFailure[],
  config: StrictValidatorConfig,
  retryCount: number,
  failureMessages: string
): ResponseContext {
  // Check if we've exhausted retries
  if (retryCount >= config.maxRetries) {
    // Fall back to warn behavior
    console.warn(
      `[strict-validator] Max retries (${config.maxRetries}) exhausted. ${failureMessages}`
    );
    context.metadata.validationRetryExhausted = true;
    return context;
  }

  // Signal retry with validation context
  context.shouldRetry = true;
  context.stats.validationRecovered = false;

  // Build retry reason with error details if configured
  if (config.includeErrorsInRetry) {
    context.retryReason = buildRetryPrompt(failures);
  } else {
    context.retryReason = buildSimpleRetryPrompt(failures);
  }

  context.metadata.validationFailures = failures;
  context.metadata.validationRetryAttempt = retryCount + 1;

  return context;
}

/**
 * Handle warn action for validation failures
 */
function handleWarnAction(
  context: ResponseContext,
  failureMessages: string
): ResponseContext {
  console.warn(`[strict-validator] Validation failed (warn mode): ${failureMessages}`);
  context.metadata.validationWarnings = failureMessages;
  return context;
}

/**
 * Handle throw action for validation failures
 */
function handleThrowAction(
  failures: ValidationFailure[]
): never {
  const error = new ValidationError(
    failures.map((f) => f.toolName),
    failures.flatMap((f) => f.errors),
    failures.map((f) => f.args)
  );
  throw error;
}

/**
 * Format failure messages for logging/display
 */
function formatFailureMessages(failures: ValidationFailure[]): string {
  return failures
    .map((f) => `${f.toolName}: ${f.errors.join('; ')}`)
    .join(' | ');
}

/**
 * Build a detailed retry prompt with error information
 */
function buildRetryPrompt(failures: ValidationFailure[]): string {
  const parts = [
    'The previous tool call(s) had invalid arguments. Please fix the following issues:',
    '',
  ];

  for (const failure of failures) {
    parts.push(`Tool "${failure.toolName}":`);
    for (const error of failure.errors) {
      parts.push(`  - ${error}`);
    }
    parts.push(`  Arguments provided: ${JSON.stringify(failure.args)}`);
    parts.push('');
  }

  parts.push('Please retry with corrected arguments that match the schema.');

  return parts.join('\n');
}

/**
 * Build a simple retry prompt without detailed errors
 */
function buildSimpleRetryPrompt(failures: ValidationFailure[]): string {
  const toolNames = failures.map((f) => `"${f.toolName}"`).join(', ');
  return `The arguments for ${toolNames} did not match the expected schema. Please check the parameter requirements and try again.`;
}

/**
 * Custom validation error for strict validator
 */
export class ValidationError extends Error {
  constructor(
    public toolNames: string[],
    public errors: string[],
    public argsProvided: Record<string, unknown>[]
  ) {
    super(
      `Schema validation failed for tool(s) ${toolNames.join(', ')}: ${errors.join('; ')}`
    );
    this.name = 'ValidationError';
  }
}

/**
 * Utility: Check if a tool should be validated
 */
export function shouldValidateTool(
  tool: InternalToolDefinition,
  validateAll: boolean
): boolean {
  if (validateAll) {
    return true;
  }
  return tool.strict === true;
}

/**
 * Utility: Validate a single function call manually
 */
export function validateFunctionCall(
  call: FunctionCall,
  tool: InternalToolDefinition
): ValidationResult {
  if (!tool.parameters) {
    return { valid: true, errors: [] };
  }
  return validateAgainstSchema(call.args, tool.parameters);
}

/**
 * Utility: Get validation summary for logging
 */
export function getValidationSummary(
  failures: ValidationFailure[]
): { totalFailures: number; toolsFailed: string[]; errorCount: number } {
  return {
    totalFailures: failures.length,
    toolsFailed: failures.map((f) => f.toolName),
    errorCount: failures.reduce((sum, f) => sum + f.errors.length, 0),
  };
}

/**
 * Type alias for the middleware returned by createStrictValidator
 */
export type StrictValidatorMiddleware = Middleware;

// Re-export for convenience
export { validateAgainstSchema } from '../utils/schema-utils.js';
