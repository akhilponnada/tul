/**
 * Tul with Input Examples (Claude-Inspired)
 *
 * This example demonstrates how to provide input examples for tools.
 * Examples help Gemini understand the expected format and patterns,
 * similar to Claude's few-shot prompting for tool calls.
 */

import { Tul, ToolDefinition } from 'tul';

// Tools with input examples that guide Gemini
const tools: ToolDefinition[] = [
  {
    name: 'execute_sql',
    description: 'Execute a SQL query against the database',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'SQL query to execute',
        },
        database: {
          type: 'string',
          enum: ['users', 'orders', 'products', 'analytics'],
          description: 'Target database',
        },
        read_only: {
          type: 'boolean',
          description: 'If true, only SELECT queries allowed',
        },
      },
      required: ['query', 'database'],
    },
    // Examples show Gemini how to structure SQL queries
    examples: [
      {
        query: 'SELECT id, name, email FROM users WHERE status = "active" LIMIT 10',
        database: 'users',
        read_only: true,
      },
      {
        query: 'SELECT o.id, o.total, u.name FROM orders o JOIN users u ON o.user_id = u.id WHERE o.created_at > "2024-01-01"',
        database: 'orders',
        read_only: true,
      },
      {
        query: "UPDATE products SET inventory = inventory - 1 WHERE id = 'prod-123'",
        database: 'products',
        read_only: false,
      },
    ],
  },
  {
    name: 'create_chart',
    description: 'Generate a chart visualization from data',
    parameters: {
      type: 'object',
      properties: {
        chart_type: {
          type: 'string',
          enum: ['bar', 'line', 'pie', 'scatter', 'histogram'],
        },
        title: {
          type: 'string',
        },
        data: {
          type: 'object',
          properties: {
            labels: { type: 'array', items: { type: 'string' } },
            values: { type: 'array', items: { type: 'number' } },
            series_name: { type: 'string' },
          },
          required: ['labels', 'values'],
        },
        options: {
          type: 'object',
          properties: {
            show_legend: { type: 'boolean' },
            color_scheme: { type: 'string', enum: ['default', 'monochrome', 'colorful'] },
            axis_labels: {
              type: 'object',
              properties: {
                x: { type: 'string' },
                y: { type: 'string' },
              },
            },
          },
        },
      },
      required: ['chart_type', 'data'],
    },
    // Examples guide complex nested structures
    examples: [
      {
        chart_type: 'bar',
        title: 'Monthly Sales',
        data: {
          labels: ['Jan', 'Feb', 'Mar', 'Apr'],
          values: [4200, 5100, 4800, 6200],
          series_name: 'Revenue ($)',
        },
        options: {
          show_legend: true,
          color_scheme: 'default',
          axis_labels: { x: 'Month', y: 'Revenue ($)' },
        },
      },
      {
        chart_type: 'pie',
        title: 'User Distribution',
        data: {
          labels: ['Desktop', 'Mobile', 'Tablet'],
          values: [45, 40, 15],
        },
      },
    ],
  },
  {
    name: 'send_notification',
    description: 'Send a notification to users',
    parameters: {
      type: 'object',
      properties: {
        channels: {
          type: 'array',
          items: { type: 'string', enum: ['email', 'sms', 'push', 'slack'] },
          description: 'Notification channels to use',
        },
        recipients: {
          type: 'object',
          properties: {
            user_ids: { type: 'array', items: { type: 'string' } },
            segments: { type: 'array', items: { type: 'string' } },
            filter: { type: 'string' },
          },
        },
        content: {
          type: 'object',
          properties: {
            subject: { type: 'string' },
            body: { type: 'string' },
            template_id: { type: 'string' },
            variables: { type: 'object' },
          },
          required: ['body'],
        },
        schedule: {
          type: 'object',
          properties: {
            send_at: { type: 'string' },
            timezone: { type: 'string' },
          },
        },
      },
      required: ['channels', 'recipients', 'content'],
    },
    // Examples show various notification patterns
    examples: [
      {
        channels: ['email', 'push'],
        recipients: {
          segments: ['premium_users'],
        },
        content: {
          subject: 'New Feature Available',
          body: 'Check out our latest feature...',
          template_id: 'feature-announcement',
        },
      },
      {
        channels: ['sms'],
        recipients: {
          user_ids: ['user-123', 'user-456'],
        },
        content: {
          body: 'Your order has shipped! Track it here: {{tracking_url}}',
          variables: {
            tracking_url: 'https://track.example.com/abc123',
          },
        },
      },
      {
        channels: ['slack'],
        recipients: {
          filter: 'role = "developer"',
        },
        content: {
          body: 'Deployment to production completed successfully.',
        },
        schedule: {
          send_at: '2024-03-01T09:00:00Z',
          timezone: 'America/New_York',
        },
      },
    ],
  },
];

// Create Tul client with example injection enabled (default)
const tul = new Tul({
  apiKey: process.env.GOOGLE_AI_API_KEY!,
  model: 'gemini-2.5-flash',
  // exampleInjection: true is the default
});

tul.registerTools(tools);

// Mock tool handlers
const handlers: Record<string, (args: Record<string, unknown>) => unknown> = {
  execute_sql: (args) => ({
    success: true,
    rows: [
      { id: 1, name: 'Alice', email: 'alice@example.com' },
      { id: 2, name: 'Bob', email: 'bob@example.com' },
    ],
    rowCount: 2,
    query: args.query,
  }),

  create_chart: (args) => ({
    chart_id: `chart-${Date.now()}`,
    url: `https://charts.example.com/chart-${Date.now()}.png`,
    type: args.chart_type,
    title: (args as { title?: string }).title || 'Untitled',
  }),

  send_notification: (args) => ({
    notification_id: `notif-${Date.now()}`,
    status: 'queued',
    channels: args.channels,
    estimated_delivery: new Date(Date.now() + 60000).toISOString(),
  }),
};

async function main() {
  console.log('=== Tul with Input Examples ===\n');

  // The examples help Gemini generate correct SQL
  console.log('1. SQL Query Generation:\n');
  const sqlResponse = await tul.chat(
    'Get me the top 5 users by total order amount, showing their name and email.',
    async (name, args) => handlers[name](args)
  );
  console.log('Response:', sqlResponse.text);
  console.log('Tool calls:', JSON.stringify(sqlResponse.toolCalls, null, 2));

  // Examples guide complex chart creation
  console.log('\n2. Chart Generation:\n');
  const chartResponse = await tul.chat(
    'Create a line chart showing website traffic: Monday 1200, Tuesday 1500, Wednesday 1400, Thursday 1800, Friday 2000.',
    async (name, args) => handlers[name](args)
  );
  console.log('Response:', chartResponse.text);

  // Examples help with nested notification structures
  console.log('\n3. Notification with Complex Recipients:\n');
  const notifResponse = await tul.chat(
    'Send an email and push notification to all premium users announcing our new pricing starting next Monday.',
    async (name, args) => handlers[name](args)
  );
  console.log('Response:', notifResponse.text);

  // Show statistics including example injection
  const stats = tul.getStats();
  console.log('\n=== Statistics ===');
  console.log(`Total requests: ${stats.totalRequests}`);
  console.log(`Tokens saved: ${stats.tokensSaved} (${stats.percentSaved.toFixed(1)}%)`);
}

main().catch(console.error);
