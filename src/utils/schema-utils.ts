/**
 * Tul Schema Utilities - JSON Schema validation and hashing
 */

import { createHash } from 'crypto';
import type { JsonSchema, ValidationResult } from '../types/index.js';
import { sortObjectKeys } from './helpers.js';

/**
 * Estimate token count from an object
 * Rough approximation: ~4 characters per token
 */
export function estimateTokens(obj: unknown): number {
  const str = typeof obj === 'string' ? obj : JSON.stringify(obj);
  return Math.ceil(str.length / 4);
}

/**
 * Create a deterministic hash for a tool call (for caching)
 */
export function hashToolCall(name: string, args: Record<string, unknown>): string {
  const sorted = sortObjectKeys(args);
  const str = `${name}:${JSON.stringify(sorted)}`;
  return createHash('sha256').update(str).digest('hex').slice(0, 16);
}

/**
 * Lightweight JSON Schema validator
 * Supports: type, required, enum, minimum, maximum, minLength, maxLength,
 * properties, items, pattern, additionalProperties
 */
export function validateAgainstSchema(
  data: unknown,
  schema: JsonSchema,
  path = ''
): ValidationResult {
  const errors: string[] = [];

  // Handle null/undefined
  if (data === null || data === undefined) {
    if (schema.type && schema.type !== 'null') {
      errors.push(`${path || 'value'}: expected ${schema.type}, got ${data === null ? 'null' : 'undefined'}`);
    }
    return { valid: errors.length === 0, errors };
  }

  // Type validation
  if (schema.type) {
    const actualType = getJsonType(data);

    if (schema.type === 'integer') {
      if (typeof data !== 'number' || !Number.isInteger(data)) {
        errors.push(`${path || 'value'}: expected integer, got ${actualType}`);
      }
    } else if (schema.type !== actualType) {
      // Allow integer for number type
      if (!(schema.type === 'number' && actualType === 'integer')) {
        errors.push(`${path || 'value'}: expected ${schema.type}, got ${actualType}`);
      }
    }
  }

  // Enum validation
  if (schema.enum && !schema.enum.includes(data as string | number | boolean)) {
    errors.push(`${path || 'value'}: must be one of [${schema.enum.join(', ')}], got ${JSON.stringify(data)}`);
  }

  // Number validations
  if (typeof data === 'number') {
    if (schema.minimum !== undefined && data < schema.minimum) {
      errors.push(`${path || 'value'}: must be >= ${schema.minimum}, got ${data}`);
    }
    if (schema.maximum !== undefined && data > schema.maximum) {
      errors.push(`${path || 'value'}: must be <= ${schema.maximum}, got ${data}`);
    }
  }

  // String validations
  if (typeof data === 'string') {
    if (schema.minLength !== undefined && data.length < schema.minLength) {
      errors.push(`${path || 'value'}: length must be >= ${schema.minLength}, got ${data.length}`);
    }
    if (schema.maxLength !== undefined && data.length > schema.maxLength) {
      errors.push(`${path || 'value'}: length must be <= ${schema.maxLength}, got ${data.length}`);
    }
    if (schema.pattern) {
      const regex = new RegExp(schema.pattern);
      if (!regex.test(data)) {
        errors.push(`${path || 'value'}: must match pattern ${schema.pattern}`);
      }
    }
  }

  // Object validations
  if (typeof data === 'object' && !Array.isArray(data) && data !== null) {
    const dataObj = data as Record<string, unknown>;

    // Required fields
    if (schema.required) {
      for (const field of schema.required) {
        if (!(field in dataObj)) {
          errors.push(`${path ? `${path}.${field}` : field}: required field missing`);
        }
      }
    }

    // Property validations
    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (key in dataObj) {
          const propPath = path ? `${path}.${key}` : key;
          const propResult = validateAgainstSchema(dataObj[key], propSchema, propPath);
          errors.push(...propResult.errors);
        }
      }

      // Additional properties check
      if (schema.additionalProperties === false) {
        const allowedKeys = new Set(Object.keys(schema.properties));
        for (const key of Object.keys(dataObj)) {
          if (!allowedKeys.has(key)) {
            errors.push(`${path ? `${path}.${key}` : key}: additional property not allowed`);
          }
        }
      }
    }
  }

  // Array validations
  if (Array.isArray(data) && schema.items) {
    for (let i = 0; i < data.length; i++) {
      const itemPath = `${path}[${i}]`;
      const itemResult = validateAgainstSchema(data[i], schema.items, itemPath);
      errors.push(...itemResult.errors);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Get JSON Schema type from a JavaScript value
 */
function getJsonType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'integer' : 'number';
  }
  return typeof value;
}

/**
 * Check if a schema has required fields
 */
export function hasRequiredFields(schema: JsonSchema): boolean {
  return Boolean(schema.required && schema.required.length > 0);
}

/**
 * Get list of required field names
 */
export function getRequiredFields(schema: JsonSchema): string[] {
  return schema.required ?? [];
}

/**
 * Get list of all field names from schema
 */
export function getAllFieldNames(schema: JsonSchema): string[] {
  if (!schema.properties) return [];
  return Object.keys(schema.properties);
}

/**
 * Get enum values for a field
 */
export function getEnumValues(schema: JsonSchema, fieldPath: string): unknown[] | null {
  const parts = fieldPath.split('.');
  let current: JsonSchema | undefined = schema;

  for (const part of parts) {
    if (!current?.properties) return null;
    current = current.properties[part];
  }

  return current?.enum ?? null;
}

/**
 * Check if a value matches a schema type
 */
export function matchesType(value: unknown, schemaType: string): boolean {
  const actualType = getJsonType(value);

  if (schemaType === 'integer') {
    return typeof value === 'number' && Number.isInteger(value);
  }

  if (schemaType === 'number') {
    return typeof value === 'number';
  }

  return actualType === schemaType;
}

/**
 * Extract all keywords from a schema (for tool filtering)
 */
export function extractSchemaKeywords(schema: JsonSchema): string[] {
  const keywords: string[] = [];

  if (schema.description) {
    keywords.push(...schema.description.toLowerCase().split(/\W+/).filter(Boolean));
  }

  if (schema.properties) {
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      keywords.push(key.toLowerCase());
      keywords.push(...extractSchemaKeywords(propSchema));
    }
  }

  if (schema.items) {
    keywords.push(...extractSchemaKeywords(schema.items));
  }

  return [...new Set(keywords)];
}

/**
 * Simplify a schema for display (remove verbose fields)
 */
export function simplifySchemaForDisplay(schema: JsonSchema): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  if (schema.type) result.type = schema.type;
  if (schema.required) result.required = schema.required;
  if (schema.enum) result.enum = schema.enum;

  if (schema.properties) {
    const props: Record<string, unknown> = {};
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      props[key] = simplifySchemaForDisplay(propSchema);
    }
    result.properties = props;
  }

  return result;
}

/**
 * Generate a concise schema signature for logging
 */
export function schemaSignature(schema: JsonSchema): string {
  if (!schema.properties) return '{}';

  const fields = Object.entries(schema.properties).map(([key, prop]) => {
    const required = schema.required?.includes(key) ? '' : '?';
    const type = prop.type ?? 'any';
    return `${key}${required}:${type}`;
  });

  return `{${fields.join(', ')}}`;
}
