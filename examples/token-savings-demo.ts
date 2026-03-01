/**
 * Tul Token Savings Demo
 *
 * This example demonstrates all of Tul's token-saving features
 * and provides a clear comparison of token usage with vs without Tul.
 */

import { Tul, ToolDefinition, CumulativeStats } from 'tul';

// A realistic toolset for an AI assistant application
const tools: ToolDefinition[] = [
  // Calendar tools
  {
    name: 'get_calendar_events',
    description: 'Get calendar events for a date range',
    parameters: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
        end_date: { type: 'string', description: 'End date (YYYY-MM-DD)' },
        calendar_id: { type: 'string', description: 'Calendar ID (default: primary)' },
      },
      required: ['start_date', 'end_date'],
    },
    examples: [
      { start_date: '2024-03-01', end_date: '2024-03-31', calendar_id: 'primary' },
    ],
  },
  {
    name: 'create_calendar_event',
    description: 'Create a new calendar event',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        start_time: { type: 'string', description: 'ISO datetime' },
        end_time: { type: 'string', description: 'ISO datetime' },
        attendees: { type: 'array', items: { type: 'string' } },
        location: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['title', 'start_time', 'end_time'],
    },
    examples: [
      {
        title: 'Team Meeting',
        start_time: '2024-03-15T10:00:00Z',
        end_time: '2024-03-15T11:00:00Z',
        attendees: ['alice@example.com'],
      },
    ],
    strict: true,
  },

  // Email tools
  {
    name: 'search_emails',
    description: 'Search emails with filters',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        from: { type: 'string' },
        to: { type: 'string' },
        subject_contains: { type: 'string' },
        has_attachment: { type: 'boolean' },
        date_from: { type: 'string' },
        date_to: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
    },
  },
  {
    name: 'send_email',
    description: 'Send an email',
    parameters: {
      type: 'object',
      properties: {
        to: { type: 'array', items: { type: 'string' } },
        cc: { type: 'array', items: { type: 'string' } },
        subject: { type: 'string' },
        body: { type: 'string' },
        attachments: { type: 'array', items: { type: 'string' } },
      },
      required: ['to', 'subject', 'body'],
    },
    strict: true,
  },
  {
    name: 'get_email_thread',
    description: 'Get all messages in an email thread',
    parameters: {
      type: 'object',
      properties: {
        thread_id: { type: 'string' },
      },
      required: ['thread_id'],
    },
  },

  // Task management tools
  {
    name: 'get_tasks',
    description: 'Get tasks from task list',
    parameters: {
      type: 'object',
      properties: {
        list_id: { type: 'string' },
        status: { type: 'string', enum: ['all', 'pending', 'completed'] },
        due_before: { type: 'string' },
        priority: { type: 'string', enum: ['low', 'medium', 'high'] },
      },
    },
  },
  {
    name: 'create_task',
    description: 'Create a new task',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        due_date: { type: 'string' },
        priority: { type: 'string', enum: ['low', 'medium', 'high'] },
        list_id: { type: 'string' },
      },
      required: ['title'],
    },
    examples: [
      { title: 'Review PR #123', due_date: '2024-03-10', priority: 'high' },
    ],
  },
  {
    name: 'complete_task',
    description: 'Mark a task as completed',
    parameters: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
      },
      required: ['task_id'],
    },
  },

  // Notes tools
  {
    name: 'search_notes',
    description: 'Search notes by content or tags',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        notebook: { type: 'string' },
      },
    },
  },
  {
    name: 'create_note',
    description: 'Create a new note',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        content: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        notebook: { type: 'string' },
      },
      required: ['title', 'content'],
    },
  },

  // Weather (common utility)
  {
    name: 'get_weather',
    description: 'Get weather for a location',
    parameters: {
      type: 'object',
      properties: {
        location: { type: 'string' },
        units: { type: 'string', enum: ['celsius', 'fahrenheit'] },
      },
      required: ['location'],
    },
  },

  // Web search
  {
    name: 'web_search',
    description: 'Search the web',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        num_results: { type: 'integer', minimum: 1, maximum: 20 },
      },
      required: ['query'],
    },
  },
];

// Mock handlers
const handlers: Record<string, (args: Record<string, unknown>) => unknown> = {
  get_calendar_events: () => ({
    events: [
      { id: 'evt-1', title: 'Team Standup', start: '2024-03-15T09:00:00Z' },
      { id: 'evt-2', title: 'Client Call', start: '2024-03-15T14:00:00Z' },
    ],
  }),
  create_calendar_event: (args) => ({
    id: `evt-${Date.now()}`,
    title: args.title,
    created: true,
  }),
  search_emails: () => ({
    emails: [
      { id: 'mail-1', subject: 'Q4 Report', from: 'boss@company.com' },
      { id: 'mail-2', subject: 'Re: Project Update', from: 'team@company.com' },
    ],
  }),
  send_email: () => ({ sent: true, message_id: `msg-${Date.now()}` }),
  get_email_thread: () => ({
    messages: [
      { id: 'msg-1', from: 'alice@example.com', body: 'Hi!' },
      { id: 'msg-2', from: 'you@example.com', body: 'Hello!' },
    ],
  }),
  get_tasks: () => ({
    tasks: [
      { id: 'task-1', title: 'Review PR', status: 'pending', priority: 'high' },
      { id: 'task-2', title: 'Update docs', status: 'pending', priority: 'medium' },
    ],
  }),
  create_task: (args) => ({ id: `task-${Date.now()}`, title: args.title, created: true }),
  complete_task: () => ({ completed: true }),
  search_notes: () => ({
    notes: [{ id: 'note-1', title: 'Meeting Notes', snippet: 'Discussed...' }],
  }),
  create_note: (args) => ({ id: `note-${Date.now()}`, title: args.title, created: true }),
  get_weather: (args) => ({
    location: args.location,
    temperature: 68,
    conditions: 'Sunny',
  }),
  web_search: () => ({
    results: [
      { title: 'Result 1', url: 'https://example.com/1', snippet: '...' },
      { title: 'Result 2', url: 'https://example.com/2', snippet: '...' },
    ],
  }),
};

// Create Tul with all features enabled
const tulOptimized = new Tul({
  apiKey: process.env.GOOGLE_AI_API_KEY!,
  model: 'gemini-2.5-flash',

  // All optimizations ON
  toolFiltering: true,
  maxToolsPerRequest: 4,
  filterThreshold: 0.3,

  schemaCompression: true,
  compressionLevel: 'moderate',

  exampleInjection: true,
  strictValidation: true,
  loopDetection: true,
  retryOnFailure: true,
  jsonRepair: true,
  resultCaching: true,
  cacheTTL: 300000,
  contextManagement: true,

  logLevel: 'warn',
});

// Create Tul with all features disabled for comparison
const tulBaseline = new Tul({
  apiKey: process.env.GOOGLE_AI_API_KEY!,
  model: 'gemini-2.5-flash',

  // All optimizations OFF
  toolFiltering: false,
  schemaCompression: false,
  exampleInjection: false,
  strictValidation: false,
  loopDetection: false,
  retryOnFailure: false,
  jsonRepair: false,
  resultCaching: false,
  contextManagement: false,

  logLevel: 'warn',
});

tulOptimized.registerTools(tools);
tulBaseline.registerTools(tools);

async function runConversation(client: Tul, label: string): Promise<CumulativeStats> {
  console.log(`\n--- Running: ${label} ---\n`);

  const queries = [
    "What's on my calendar for next week?",
    'Create a meeting for tomorrow at 2pm with the team.',
    'Find emails from my boss about the Q4 report.',
    'What high priority tasks do I have?',
    'Create a task to review the budget proposal by Friday.',
    'Search my notes for meeting notes.',
    "What's the weather in San Francisco?",
    'Send an email to alice@example.com about the project status.',
  ];

  for (const query of queries) {
    console.log(`Query: ${query}`);
    const response = await client.chat(query, async (name, args) => handlers[name](args));
    console.log(`Response: ${response.text.substring(0, 100)}...`);
    console.log(`  Tools sent: ${response.stats.toolsSent}, Tokens saved: ${response.stats.tokensSaved}\n`);
  }

  return client.getStats();
}

function printComparison(optimized: CumulativeStats, baseline: CumulativeStats) {
  console.log('\n' + '='.repeat(60));
  console.log('TOKEN SAVINGS COMPARISON');
  console.log('='.repeat(60));

  const format = (n: number) => n.toLocaleString();

  console.log(`
Metric                      | Optimized    | Baseline     | Savings
----------------------------+--------------+--------------+---------
Total Input Tokens          | ${format(optimized.totalInputTokens).padStart(12)} | ${format(baseline.totalInputTokens).padStart(12)} | ${format(baseline.totalInputTokens - optimized.totalInputTokens).padStart(7)}
Total Output Tokens         | ${format(optimized.totalOutputTokens).padStart(12)} | ${format(baseline.totalOutputTokens).padStart(12)} | ${format(baseline.totalOutputTokens - optimized.totalOutputTokens).padStart(7)}
----------------------------+--------------+--------------+---------
Total Tokens                | ${format(optimized.totalInputTokens + optimized.totalOutputTokens).padStart(12)} | ${format(baseline.totalInputTokens + baseline.totalOutputTokens).padStart(12)} | ${format((baseline.totalInputTokens + baseline.totalOutputTokens) - (optimized.totalInputTokens + optimized.totalOutputTokens)).padStart(7)}
----------------------------+--------------+--------------+---------
Avg Tools Per Request       | ${optimized.avgToolsPerRequest.toFixed(1).padStart(12)} | ${baseline.avgToolsPerRequest.toFixed(1).padStart(12)} |
Tools Filtered Out          | ${format(optimized.totalToolsFiltered).padStart(12)} | ${format(baseline.totalToolsFiltered).padStart(12)} |
Cache Hits                  | ${format(optimized.cacheHits).padStart(12)} | ${format(baseline.cacheHits).padStart(12)} |
Loops Prevented             | ${format(optimized.loopsPrevented).padStart(12)} | ${format(baseline.loopsPrevented).padStart(12)} |
Schema Violations Recovered | ${format(optimized.schemaViolationsRecovered).padStart(12)} | ${format(baseline.schemaViolationsRecovered).padStart(12)} |
`);

  const totalSavings = (baseline.totalInputTokens + baseline.totalOutputTokens) -
                       (optimized.totalInputTokens + optimized.totalOutputTokens);
  const percentSaved = ((totalSavings / (baseline.totalInputTokens + baseline.totalOutputTokens)) * 100);

  console.log('----------------------------+--------------+--------------+---------');
  console.log(`TOTAL SAVINGS: ${format(totalSavings)} tokens (${percentSaved.toFixed(1)}%)`);
  console.log('='.repeat(60));

  // Cost estimation (using typical Gemini pricing)
  const costPer1kInput = 0.00025;  // $0.00025 per 1K input tokens
  const costPer1kOutput = 0.0005; // $0.0005 per 1K output tokens

  const optimizedCost = (optimized.totalInputTokens * costPer1kInput / 1000) +
                        (optimized.totalOutputTokens * costPer1kOutput / 1000);
  const baselineCost = (baseline.totalInputTokens * costPer1kInput / 1000) +
                       (baseline.totalOutputTokens * costPer1kOutput / 1000);
  const costSavings = baselineCost - optimizedCost;

  console.log(`\nESTIMATED COST IMPACT (at $0.25/1M input, $0.50/1M output):`);
  console.log(`  Optimized:  $${optimizedCost.toFixed(4)}`);
  console.log(`  Baseline:   $${baselineCost.toFixed(4)}`);
  console.log(`  Savings:    $${costSavings.toFixed(4)} per session`);

  // Project to monthly usage
  const sessionsPerDay = 100;
  const daysPerMonth = 30;
  const monthlySavings = costSavings * sessionsPerDay * daysPerMonth;
  console.log(`\nAt ${sessionsPerDay} sessions/day: ~$${monthlySavings.toFixed(2)}/month savings`);
}

async function main() {
  console.log('=== Token Savings Demo ===');
  console.log(`Registered ${tools.length} tools\n`);

  console.log('Running the same conversation twice:');
  console.log('1. With all Tul optimizations enabled');
  console.log('2. With all optimizations disabled (baseline)\n');

  // Run optimized version
  const optimizedStats = await runConversation(tulOptimized, 'Tul Optimized');

  // Run baseline version
  const baselineStats = await runConversation(tulBaseline, 'Baseline (No Optimization)');

  // Print comparison
  printComparison(optimizedStats, baselineStats);

  console.log('\n--- Optimization Breakdown ---\n');
  console.log('Tool Filtering: Sends only relevant tools (4 instead of 12)');
  console.log('Schema Compression: Removes verbose schema fields');
  console.log('Example Injection: Adds targeted examples without bloat');
  console.log('Result Caching: Reuses results for identical calls');
  console.log('Context Management: Compacts old conversation turns');
  console.log('JSON Repair: Fixes malformed outputs without re-calling');
  console.log('Loop Detection: Prevents infinite tool call loops');
}

main().catch(console.error);
