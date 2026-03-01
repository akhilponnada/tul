/**
 * Tul Strict Mode Example (Claude-Inspired)
 *
 * This example demonstrates strict schema validation for tools.
 * When a tool has `strict: true`, Tul validates Gemini's output
 * against the schema and automatically retries if invalid.
 */

import { Tul, ToolDefinition, ValidationError } from 'tul';

// Tools with strict validation enabled
const tools: ToolDefinition[] = [
  {
    name: 'create_user',
    description: 'Create a new user account',
    parameters: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          pattern: '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$',
          description: 'Valid email address',
        },
        username: {
          type: 'string',
          minLength: 3,
          maxLength: 30,
          pattern: '^[a-zA-Z0-9_]+$',
          description: 'Username (alphanumeric and underscore only)',
        },
        age: {
          type: 'integer',
          minimum: 13,
          maximum: 120,
          description: 'User age (must be 13+)',
        },
        role: {
          type: 'string',
          enum: ['user', 'moderator', 'admin'],
          description: 'User role',
        },
        preferences: {
          type: 'object',
          properties: {
            theme: { type: 'string', enum: ['light', 'dark', 'auto'] },
            notifications: { type: 'boolean' },
            language: { type: 'string', minLength: 2, maxLength: 5 },
          },
        },
      },
      required: ['email', 'username', 'role'],
      additionalProperties: false,
    },
    // Enable strict validation - Gemini outputs MUST match schema
    strict: true,
  },
  {
    name: 'process_payment',
    description: 'Process a payment transaction',
    parameters: {
      type: 'object',
      properties: {
        amount: {
          type: 'number',
          minimum: 0.01,
          maximum: 100000,
          description: 'Payment amount in dollars',
        },
        currency: {
          type: 'string',
          enum: ['USD', 'EUR', 'GBP', 'JPY', 'CAD'],
          description: 'Currency code',
        },
        payment_method: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['credit_card', 'debit_card', 'bank_transfer', 'crypto'],
            },
            token: {
              type: 'string',
              minLength: 10,
              description: 'Payment method token',
            },
          },
          required: ['type', 'token'],
        },
        metadata: {
          type: 'object',
          properties: {
            order_id: { type: 'string' },
            customer_id: { type: 'string' },
            description: { type: 'string', maxLength: 500 },
          },
        },
      },
      required: ['amount', 'currency', 'payment_method'],
    },
    strict: true,
    // Custom cache TTL - payment results shouldn't be cached long
    cacheTTL: 0,
  },
  {
    name: 'schedule_appointment',
    description: 'Schedule an appointment',
    parameters: {
      type: 'object',
      properties: {
        datetime: {
          type: 'string',
          pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}',
          description: 'ISO 8601 datetime',
        },
        duration_minutes: {
          type: 'integer',
          minimum: 15,
          maximum: 480,
          description: 'Appointment duration',
        },
        attendees: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              email: { type: 'string' },
              name: { type: 'string' },
              required: { type: 'boolean' },
            },
            required: ['email'],
          },
        },
        location: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['physical', 'virtual'] },
            address: { type: 'string' },
            meeting_url: { type: 'string' },
          },
        },
        reminder_minutes: {
          type: 'array',
          items: { type: 'integer', minimum: 0, maximum: 10080 },
          description: 'Reminder times in minutes before appointment',
        },
      },
      required: ['datetime', 'duration_minutes'],
    },
    strict: true,
  },
];

// Create Tul client with validation options
const tul = new Tul({
  apiKey: process.env.GOOGLE_AI_API_KEY!,
  model: 'gemini-2.5-flash',

  // strictValidation is enabled by default when tools have strict: true
  strictValidation: true,

  // What to do when validation fails
  onValidationError: 'retry', // 'retry' | 'warn' | 'throw'

  // Max retries for validation errors
  maxRetries: 3,
});

tul.registerTools(tools);

// Event listener to see validation in action
tul.on('tool:validation:fail', (event) => {
  console.log(`[Validation Failed] ${event.name}:`);
  event.errors.forEach((err) => console.log(`  - ${err}`));
});

tul.on('tool:validation:pass', (event) => {
  console.log(`[Validation Passed] ${event.name}`);
});

tul.on('tool:retry', (event) => {
  console.log(`[Retry ${event.attempt}] ${event.reason}`);
});

// Tool handlers
const handlers: Record<string, (args: Record<string, unknown>) => unknown> = {
  create_user: (args) => ({
    user_id: `user-${Date.now()}`,
    email: args.email,
    username: args.username,
    role: args.role,
    created_at: new Date().toISOString(),
  }),

  process_payment: (args) => ({
    transaction_id: `txn-${Date.now()}`,
    amount: args.amount,
    currency: args.currency,
    status: 'completed',
    processed_at: new Date().toISOString(),
  }),

  schedule_appointment: (args) => ({
    appointment_id: `apt-${Date.now()}`,
    datetime: args.datetime,
    duration_minutes: args.duration_minutes,
    status: 'scheduled',
    calendar_link: `https://calendar.example.com/apt-${Date.now()}`,
  }),
};

async function main() {
  console.log('=== Tul Strict Mode ===\n');

  // Test user creation with validation
  console.log('1. Create User (strict schema):\n');
  try {
    const userResponse = await tul.chat(
      'Create a new admin user with email john.doe@example.com, username john_doe, age 28, with dark theme and notifications enabled.',
      async (name, args) => handlers[name](args)
    );
    console.log('Response:', userResponse.text);
    console.log('Validation status:', userResponse.toolCalls[0]?.validationPassed ? 'PASSED' : 'FAILED');
  } catch (error) {
    if (error instanceof ValidationError) {
      console.log('Validation Error:', error.message);
      console.log('Tool:', error.toolName);
      console.log('Errors:', error.errors);
    } else {
      throw error;
    }
  }

  // Test payment processing
  console.log('\n2. Process Payment (strict schema):\n');
  const paymentResponse = await tul.chat(
    'Process a payment of $49.99 USD via credit card token tok_visa_4242 for order ORD-123.',
    async (name, args) => handlers[name](args)
  );
  console.log('Response:', paymentResponse.text);

  // Test appointment scheduling
  console.log('\n3. Schedule Appointment (strict schema):\n');
  const appointmentResponse = await tul.chat(
    'Schedule a 60-minute virtual meeting tomorrow at 2pm with alice@example.com and bob@example.com. Set reminders at 30 and 10 minutes before.',
    async (name, args) => handlers[name](args)
  );
  console.log('Response:', appointmentResponse.text);

  // Show validation statistics
  const stats = tul.getStats();
  console.log('\n=== Validation Statistics ===');
  console.log(`Schema violations caught: ${stats.schemaViolationsCaught}`);
  console.log(`Schema violations recovered: ${stats.schemaViolationsRecovered}`);
  console.log(`Total retries: ${stats.failuresRecovered}`);
}

main().catch(console.error);
