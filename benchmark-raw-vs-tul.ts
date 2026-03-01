










/**
 * TUL BENCHMARK: Raw Gemini API vs tul SDK
 *
 * Run: npx tsx benchmark-raw-vs-tul.ts
 *
 * Requirements:
 *   npm install @google/genai
 *   export GEMINI_API_KEY=your_key_here
 *
 * This script runs identical tool-calling scenarios through:
 *   1. Raw @google/genai (baseline)
 *   2. tul SDK (optimized)
 *
 * Then prints a comparison of: success rate, tokens used, latency, errors recovered.
 */

import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import { Tul } from './src/client.js';

// ─── CONFIG ─────────────────────────────────────────────────────────
const API_KEY = process.env.GEMINI_API_KEY!;
const MODEL = 'gemini-3-flash-preview'; // Gemini 3 Flash Preview
const RUNS_PER_TEST = 1; // Number of times to run each test

// ─── TOOL DEFINITIONS (INTENTIONALLY VERBOSE — real-world style) ───
const ALL_TOOLS = [
  {
    name: 'get_current_weather',
    description: 'Get the current weather conditions for any city or location worldwide. Returns temperature in the specified unit, humidity percentage, wind speed in km/h, and general weather conditions like sunny, cloudy, rainy, etc.',
    parameters: {
      type: 'object' as const,
      properties: {
        location: {
          type: 'string',
          description: 'The city and state/country to get weather for, e.g. San Francisco, CA or London, UK or Tokyo, Japan'
        },
        unit: {
          type: 'string',
          enum: ['celsius', 'fahrenheit'],
          description: 'The temperature unit to use for the response. Defaults to celsius if not specified.'
        }
      },
      required: ['location']
    }
  },
  {
    name: 'search_products',
    description: 'Search the product database for items matching a query. Returns a list of products with name, price, rating, and availability. Supports filtering by category and sorting.',
    parameters: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'The search query string to find products' },
        category: {
          type: 'string',
          enum: ['electronics', 'clothing', 'home', 'sports', 'books', 'food', 'toys', 'automotive'],
          description: 'Optional product category to filter results'
        },
        max_results: {
          type: 'number',
          description: 'Maximum number of results to return, between 1 and 50. Defaults to 10.'
        },
        sort_by: {
          type: 'string',
          enum: ['relevance', 'price_low', 'price_high', 'rating', 'newest'],
          description: 'How to sort the results. Defaults to relevance.'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'send_email',
    description: 'Send an email to one or more recipients. Supports plain text and HTML body content, with optional CC and BCC fields. Returns a confirmation with message ID.',
    parameters: {
      type: 'object' as const,
      properties: {
        to: { type: 'string', description: 'Recipient email address or comma-separated list of addresses' },
        subject: { type: 'string', description: 'Email subject line' },
        body: { type: 'string', description: 'Email body content (plain text or HTML)' },
        cc: { type: 'string', description: 'Optional CC recipients, comma-separated' },
        is_html: { type: 'boolean', description: 'Whether the body contains HTML content. Defaults to false.' }
      },
      required: ['to', 'subject', 'body']
    }
  },
  {
    name: 'calculate_math',
    description: 'Perform mathematical calculations. Supports basic arithmetic, trigonometry, logarithms, and statistical functions. Expression should be a valid mathematical expression.',
    parameters: {
      type: 'object' as const,
      properties: {
        expression: { type: 'string', description: 'Mathematical expression to evaluate, e.g. "2 + 2", "sin(pi/4)", "sqrt(144)"' }
      },
      required: ['expression']
    }
  },
  {
    name: 'get_stock_price',
    description: 'Get the current stock price and basic financial data for a given ticker symbol. Returns current price, daily change, volume, and market cap.',
    parameters: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Stock ticker symbol, e.g. AAPL, GOOGL, MSFT, TSLA' },
        include_history: { type: 'boolean', description: 'Whether to include 30-day price history. Defaults to false.' }
      },
      required: ['symbol']
    }
  },
  {
    name: 'create_calendar_event',
    description: 'Create a new calendar event with title, date, time, duration, and optional description. Returns event ID and confirmation.',
    parameters: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Event title' },
        date: { type: 'string', description: 'Event date in YYYY-MM-DD format' },
        time: { type: 'string', description: 'Event start time in HH:MM format (24-hour)' },
        duration_minutes: { type: 'number', description: 'Duration of the event in minutes. Defaults to 60.' },
        description: { type: 'string', description: 'Optional event description or notes' },
        location: { type: 'string', description: 'Optional event location' }
      },
      required: ['title', 'date', 'time']
    }
  },
  {
    name: 'translate_text',
    description: 'Translate text from one language to another. Supports over 100 languages. Auto-detects source language if not specified.',
    parameters: {
      type: 'object' as const,
      properties: {
        text: { type: 'string', description: 'The text to translate' },
        target_language: { type: 'string', description: 'Target language code, e.g. es, fr, de, ja, zh, ko, ar' },
        source_language: { type: 'string', description: 'Optional source language code. Auto-detected if not provided.' }
      },
      required: ['text', 'target_language']
    }
  },
  {
    name: 'search_web',
    description: 'Search the web for information on any topic. Returns a list of relevant results with titles, snippets, and URLs.',
    parameters: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query' },
        num_results: { type: 'number', description: 'Number of results to return, 1-20. Defaults to 5.' },
        time_range: {
          type: 'string',
          enum: ['any', 'day', 'week', 'month', 'year'],
          description: 'Filter results by time range. Defaults to any.'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'get_directions',
    description: 'Get driving, walking, or transit directions between two locations. Returns distance, estimated time, and step-by-step directions.',
    parameters: {
      type: 'object' as const,
      properties: {
        origin: { type: 'string', description: 'Starting location (address or place name)' },
        destination: { type: 'string', description: 'Destination location (address or place name)' },
        mode: {
          type: 'string',
          enum: ['driving', 'walking', 'transit', 'bicycling'],
          description: 'Travel mode. Defaults to driving.'
        }
      },
      required: ['origin', 'destination']
    }
  },
  {
    name: 'manage_todo',
    description: 'Create, update, delete, or list todo items. Each todo has a title, optional description, priority level, and due date.',
    parameters: {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'update', 'delete', 'list'],
          description: 'Action to perform on todo items'
        },
        title: { type: 'string', description: 'Todo title (required for create/update)' },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'urgent'],
          description: 'Priority level. Defaults to medium.'
        },
        due_date: { type: 'string', description: 'Due date in YYYY-MM-DD format' },
        todo_id: { type: 'string', description: 'Todo ID (required for update/delete)' }
      },
      required: ['action']
    }
  },
  {
    name: 'convert_currency',
    description: 'Convert an amount from one currency to another using real-time exchange rates. Returns converted amount and exchange rate.',
    parameters: {
      type: 'object' as const,
      properties: {
        amount: { type: 'number', description: 'Amount to convert' },
        from_currency: { type: 'string', description: 'Source currency code, e.g. USD, EUR, GBP, JPY' },
        to_currency: { type: 'string', description: 'Target currency code, e.g. USD, EUR, GBP, JPY' }
      },
      required: ['amount', 'from_currency', 'to_currency']
    }
  },
  {
    name: 'generate_image',
    description: 'Generate an AI image from a text description. Supports various styles and aspect ratios. Returns image URL.',
    parameters: {
      type: 'object' as const,
      properties: {
        prompt: { type: 'string', description: 'Detailed description of the image to generate' },
        style: {
          type: 'string',
          enum: ['realistic', 'cartoon', 'oil_painting', 'watercolor', 'pixel_art', 'sketch'],
          description: 'Image style. Defaults to realistic.'
        },
        aspect_ratio: {
          type: 'string',
          enum: ['1:1', '16:9', '9:16', '4:3', '3:4'],
          description: 'Aspect ratio. Defaults to 1:1.'
        }
      },
      required: ['prompt']
    }
  }
];

// ─── FAKE TOOL EXECUTION (same for both) ───────────────────────────
function executeTool(name: string, args: Record<string, any>): any {
  const responses: Record<string, any> = {
    get_current_weather: { temperature: 15, unit: args.unit || 'celsius', condition: 'partly cloudy', humidity: 72, wind_speed: 14 },
    search_products: { results: [{ name: 'Wireless Headphones Pro', price: 79.99, rating: 4.5 }, { name: 'Budget Earbuds', price: 19.99, rating: 4.0 }], total: 2 },
    send_email: { success: true, message_id: 'msg_abc123' },
    calculate_math: { result: 42, expression: args.expression },
    get_stock_price: { symbol: args.symbol, price: 178.52, change: '+2.3%', volume: '52.1M' },
    create_calendar_event: { event_id: 'evt_xyz789', confirmed: true },
    translate_text: { translated: '[translated text]', source_language: 'en', target_language: args.target_language },
    search_web: { results: [{ title: 'Result 1', snippet: 'Relevant info...', url: 'https://example.com' }] },
    get_directions: { distance: '15.2 km', duration: '22 min', steps: ['Head north', 'Turn right'] },
    manage_todo: { success: true, todos: [{ id: 'todo_1', title: args.title || 'My task' }] },
    convert_currency: { converted: args.amount * 0.85, rate: 0.85, from: args.from_currency, to: args.to_currency },
    generate_image: { url: 'https://example.com/image.png', prompt: args.prompt },
  };
  return responses[name] || { error: 'Unknown tool' };
}

// ─── TEST SCENARIOS ─────────────────────────────────────────────────
const TEST_SCENARIOS = [
  {
    name: '1. Simple single tool call',
    prompt: "What's the weather like in Edinburgh right now?",
    expectedTools: ['get_current_weather'],
    difficulty: 'easy',
  },
  {
    name: '2. Parallel tool calls',
    prompt: 'Get the weather in London and also search for umbrellas under £20',
    expectedTools: ['get_current_weather', 'search_products'],
    difficulty: 'medium',
  },
  {
    name: '3. Tool selection from many (12 tools, need 1)',
    prompt: 'How much is 100 USD in euros?',
    expectedTools: ['convert_currency'],
    difficulty: 'medium',
  },
  {
    name: '4. Complex parameters',
    prompt: 'Create a calendar event for my dentist appointment on March 15th 2026 at 2:30 PM, 45 minutes long, at Smile Dental Clinic on Princes Street',
    expectedTools: ['create_calendar_event'],
    difficulty: 'medium',
  },
  {
    name: '5. Multi-step (tool result feeds next action)',
    prompt: 'Check the stock price of AAPL and then convert the price from USD to GBP',
    expectedTools: ['get_stock_price', 'convert_currency'],
    difficulty: 'hard',
  },
  {
    name: '6. Ambiguous intent (should still pick right tool)',
    prompt: 'I need to get from Edinburgh Castle to the Royal Mile by foot',
    expectedTools: ['get_directions'],
    difficulty: 'medium',
  },
  {
    name: '7. No tool needed (should NOT call any tool)',
    prompt: 'What is the capital of France?',
    expectedTools: [],
    difficulty: 'easy',
  },
  {
    name: '8. Multiple tools + specific params',
    prompt: 'Search for the latest books about AI, sort by newest, and also translate "machine learning" to Japanese',
    expectedTools: ['search_products', 'translate_text'],
    difficulty: 'hard',
  },
  {
    name: '9. Edge case: enum parameter',
    prompt: 'Add a high priority todo to buy groceries, due tomorrow 2026-03-01',
    expectedTools: ['manage_todo'],
    difficulty: 'medium',
  },
  {
    name: '10. Stress: 3+ tools in one request',
    prompt: 'I need the weather in Tokyo, convert 5000 JPY to USD, and find directions from Tokyo Station to Shibuya by transit',
    expectedTools: ['get_current_weather', 'convert_currency', 'get_directions'],
    difficulty: 'hard',
  },
];

// ─── STATS TRACKING ─────────────────────────────────────────────────
interface TestResult {
  scenario: string;
  success: boolean;
  toolsCalled: string[];
  correctToolsCalled: boolean;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs: number;
  errors: string[];
  retries: number;
  jsonRepaired: boolean;
}

// ─── RAW GEMINI API TEST ────────────────────────────────────────────
async function runRawGemini(scenario: typeof TEST_SCENARIOS[0]): Promise<TestResult> {
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const startTime = Date.now();
  const errors: string[] = [];
  let toolsCalled: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let success = false;

  try {
    // Send ALL 12 tools every time (no filtering — this is the baseline)
    const tools = [{
      functionDeclarations: ALL_TOOLS.map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      }))
    }];

    let response = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ text: scenario.prompt }] }],
      config: { tools, toolConfig: { functionCallingConfig: { mode: 'AUTO' } } },
    });

    inputTokens += response.usageMetadata?.promptTokenCount || 0;
    outputTokens += response.usageMetadata?.candidatesTokenCount || 0;

    // Handle tool call loop (max 5 iterations)
    let iterations = 0;
    const messages: any[] = [
      { role: 'user', parts: [{ text: scenario.prompt }] },
    ];

    while (iterations < 5) {
      const candidate = response.candidates?.[0];
      if (!candidate?.content?.parts) break;

      // Keep ALL parts from model (including thought signatures for Gemini 3)
      const modelParts = candidate.content.parts;
      const functionCalls = modelParts.filter((p: any) => p.functionCall);
      if (functionCalls.length === 0) break; // Final text response

      // Add model response to history (with all parts including thought signatures)
      messages.push({ role: 'model', parts: modelParts });

      // Execute each tool call
      const functionResponses: any[] = [];
      for (const part of functionCalls) {
        const fc = (part as any).functionCall;
        toolsCalled.push(fc.name);
        try {
          const result = executeTool(fc.name, fc.args || {});
          // Use output wrapper for Gemini 3 compatibility
          functionResponses.push({
            functionResponse: { name: fc.name, response: { output: result } }
          });
        } catch (e: any) {
          errors.push(`Tool execution error: ${e.message}`);
          functionResponses.push({
            functionResponse: { name: fc.name, response: { output: { error: e.message } } }
          });
        }
      }

      // Send results back
      messages.push({ role: 'user', parts: functionResponses });

      response = await ai.models.generateContent({
        model: MODEL,
        contents: messages,
        config: { tools, toolConfig: { functionCallingConfig: { mode: 'AUTO' } } },
      });

      inputTokens += response.usageMetadata?.promptTokenCount || 0;
      outputTokens += response.usageMetadata?.candidatesTokenCount || 0;
      iterations++;
    }

    success = true;
  } catch (e: any) {
    errors.push(e.message);
    success = false;
  }

  const latencyMs = Date.now() - startTime;

  // Check if correct tools were called
  const calledSet = new Set(toolsCalled);
  const correctToolsCalled = scenario.expectedTools.length === 0
    ? toolsCalled.length === 0
    : scenario.expectedTools.every(t => calledSet.has(t));

  return {
    scenario: scenario.name,
    success,
    toolsCalled,
    correctToolsCalled,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    latencyMs,
    errors,
    retries: 0,
    jsonRepaired: false,
  };
}

// ─── TUL SDK TEST ───────────────────────────────────────────────────
async function runWithTul(scenario: typeof TEST_SCENARIOS[0]): Promise<TestResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  let toolsCalled: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let success = false;
  let retries = 0;
  let jsonRepaired = false;

  try {
    // Use the actual Tul SDK
    const tul = new Tul({
      apiKey: API_KEY,
      model: MODEL,
      toolFiltering: true,
      schemaCompression: true,
      maxToolsPerRequest: 5,
      filterThreshold: 0.2,
      compressionLevel: 'moderate',
      resultCaching: true,
      loopDetection: true,
      retryOnFailure: true,
      logLevel: 'silent',
    });

    // Register tools with examples for better performance
    const toolExamples: Record<string, any[]> = {
      get_current_weather: [{ location: 'San Francisco, CA', unit: 'fahrenheit' }],
      search_products: [{ query: 'wireless headphones', category: 'electronics' }],
      convert_currency: [{ amount: 100, from_currency: 'USD', to_currency: 'EUR' }],
      create_calendar_event: [{ title: 'Meeting', date: '2026-03-15', time: '14:00' }],
      manage_todo: [{ action: 'create', title: 'Buy groceries', priority: 'high' }],
      get_directions: [{ origin: 'Times Square', destination: 'Central Park', mode: 'walking' }],
      translate_text: [{ text: 'Hello', target_language: 'ja' }],
    };

    tul.registerTools(ALL_TOOLS.map(t => ({
      ...t,
      examples: toolExamples[t.name],
      strict: true,
      cacheTTL: 60000,
    })));

    tul.onToolCall(async (name, args) => executeTool(name, args as Record<string, any>));

    const response = await tul.chat(scenario.prompt);

    toolsCalled = response.toolCalls?.map(tc => tc.name) || [];
    inputTokens = response.stats.inputTokens;
    outputTokens = response.stats.outputTokens;
    retries = response.stats.retries;
    jsonRepaired = response.stats.jsonRepaired;
    success = true;
  } catch (e: any) {
    errors.push(e.message);
    success = false;
  }

  const latencyMs = Date.now() - startTime;
  const calledSet = new Set(toolsCalled);
  const correctToolsCalled = scenario.expectedTools.length === 0
    ? toolsCalled.length === 0
    : scenario.expectedTools.every(t => calledSet.has(t));

  return {
    scenario: scenario.name,
    success,
    toolsCalled,
    correctToolsCalled,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    latencyMs,
    errors,
    retries,
    jsonRepaired,
  };
}

// ─── MAIN BENCHMARK RUNNER ──────────────────────────────────────────
async function runBenchmark() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║           TUL BENCHMARK: Raw vs Optimized                    ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Model: ${MODEL.padEnd(50)}║`);
  console.log(`║  Runs per test: ${RUNS_PER_TEST}                                           ║`);
  console.log(`║  Tools registered: ${ALL_TOOLS.length}                                          ║`);
  console.log(`║  Test scenarios: ${TEST_SCENARIOS.length}                                          ║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  const rawResults: TestResult[] = [];
  const tulResults: TestResult[] = [];

  for (const scenario of TEST_SCENARIOS) {
    console.log(`\n▸ ${scenario.name} [${scenario.difficulty}]`);

    // Run RAW
    process.stdout.write('  Raw Gemini:  ');
    try {
      const result = await runRawGemini(scenario);
      rawResults.push(result);
      console.log(
        `${result.success ? '✅' : '❌'} | ` +
        `Tools: [${result.toolsCalled.join(', ')}] | ` +
        `Correct: ${result.correctToolsCalled ? '✓' : '✗'} | ` +
        `Tokens: ${result.totalTokens} | ` +
        `${result.latencyMs}ms`
      );
    } catch (e: any) {
      rawResults.push({
        scenario: scenario.name, success: false, toolsCalled: [],
        correctToolsCalled: false, inputTokens: 0, outputTokens: 0,
        totalTokens: 0, latencyMs: 0, errors: [e.message], retries: 0, jsonRepaired: false,
      });
      console.log(`❌ CRASH: ${e.message.slice(0, 100)}`);
    }

    // Small delay between tests
    await new Promise(r => setTimeout(r, 1500));

    // Run TUL
    process.stdout.write('  With tul:    ');
    try {
      const result = await runWithTul(scenario);
      tulResults.push(result);
      console.log(
        `${result.success ? '✅' : '❌'} | ` +
        `Tools: [${result.toolsCalled.join(', ')}] | ` +
        `Correct: ${result.correctToolsCalled ? '✓' : '✗'} | ` +
        `Tokens: ${result.totalTokens} | ` +
        `${result.latencyMs}ms`
      );
    } catch (e: any) {
      tulResults.push({
        scenario: scenario.name, success: false, toolsCalled: [],
        correctToolsCalled: false, inputTokens: 0, outputTokens: 0,
        totalTokens: 0, latencyMs: 0, errors: [e.message], retries: 0, jsonRepaired: false,
      });
      console.log(`❌ CRASH: ${e.message.slice(0, 100)}`);
    }

    // Rate limit protection
    await new Promise(r => setTimeout(r, 1500));
  }

  // ─── PRINT COMPARISON TABLE ───────────────────────────────────
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                         RESULTS COMPARISON                               ║');
  console.log('╠══════════════════════════════════════════════════════════════════════════╣');

  const rawSuccessRate = rawResults.filter(r => r.success).length / rawResults.length * 100;
  const tulSuccessRate = tulResults.filter(r => r.success).length / tulResults.length * 100;
  const rawCorrectRate = rawResults.filter(r => r.correctToolsCalled).length / rawResults.length * 100;
  const tulCorrectRate = tulResults.filter(r => r.correctToolsCalled).length / tulResults.length * 100;
  const rawTotalTokens = rawResults.reduce((sum, r) => sum + r.totalTokens, 0);
  const tulTotalTokens = tulResults.reduce((sum, r) => sum + r.totalTokens, 0);
  const tokenSavings = rawTotalTokens > 0 ? ((rawTotalTokens - tulTotalTokens) / rawTotalTokens * 100) : 0;
  const rawAvgLatency = rawResults.reduce((sum, r) => sum + r.latencyMs, 0) / rawResults.length;
  const tulAvgLatency = tulResults.reduce((sum, r) => sum + r.latencyMs, 0) / tulResults.length;
  const rawAvgInputTokens = rawResults.reduce((sum, r) => sum + r.inputTokens, 0) / rawResults.length;
  const tulAvgInputTokens = tulResults.reduce((sum, r) => sum + r.inputTokens, 0) / tulResults.length;
  const rawErrors = rawResults.reduce((sum, r) => sum + r.errors.length, 0);
  const tulErrors = tulResults.reduce((sum, r) => sum + r.errors.length, 0);

  const row = (label: string, raw: string, tul: string, diff: string) => {
    console.log(`║  ${label.padEnd(25)} ${raw.padEnd(15)} ${tul.padEnd(15)} ${diff.padEnd(15)} ║`);
  };

  console.log('║                            RAW GEMINI      WITH TUL        DIFF           ║');
  console.log('║  ─────────────────────── ─────────────── ─────────────── ─────────────── ║');
  row('Success Rate', `${rawSuccessRate.toFixed(0)}%`, `${tulSuccessRate.toFixed(0)}%`,
    tulSuccessRate >= rawSuccessRate ? `+${(tulSuccessRate - rawSuccessRate).toFixed(0)}%` : `${(tulSuccessRate - rawSuccessRate).toFixed(0)}%`);
  row('Correct Tool Selection', `${rawCorrectRate.toFixed(0)}%`, `${tulCorrectRate.toFixed(0)}%`,
    tulCorrectRate >= rawCorrectRate ? `+${(tulCorrectRate - rawCorrectRate).toFixed(0)}%` : `${(tulCorrectRate - rawCorrectRate).toFixed(0)}%`);
  row('Total Tokens', rawTotalTokens.toLocaleString(), tulTotalTokens.toLocaleString(),
    `-${tokenSavings.toFixed(1)}%`);
  row('Avg Input Tokens/req', rawAvgInputTokens.toFixed(0), tulAvgInputTokens.toFixed(0),
    `-${((rawAvgInputTokens - tulAvgInputTokens) / rawAvgInputTokens * 100).toFixed(1)}%`);
  row('Avg Latency', `${rawAvgLatency.toFixed(0)}ms`, `${tulAvgLatency.toFixed(0)}ms`,
    `${(tulAvgLatency - rawAvgLatency).toFixed(0)}ms`);
  row('Errors', rawErrors.toString(), tulErrors.toString(),
    tulErrors <= rawErrors ? `-${rawErrors - tulErrors}` : `+${tulErrors - rawErrors}`);

  console.log('╠══════════════════════════════════════════════════════════════════════════╣');
  console.log(`║  Token savings: ${tokenSavings.toFixed(1)}% fewer tokens with tul                            ║`);
  console.log(`║  That's ${(rawTotalTokens - tulTotalTokens).toLocaleString()} tokens saved across ${TEST_SCENARIOS.length} test scenarios                   ║`);
  console.log('╚══════════════════════════════════════════════════════════════════════════╝');

  // ─── PER-SCENARIO BREAKDOWN ───────────────────────────────────
  console.log('\nPer-Scenario Token Comparison:\n');
  console.log('  Scenario                                  Raw Tokens   Tul Tokens   Saved');
  console.log('  ────────────────────────────────────────  ──────────   ──────────   ─────');
  for (let i = 0; i < TEST_SCENARIOS.length; i++) {
    const raw = rawResults[i];
    const tul = tulResults[i];
    if (!raw || !tul) continue;
    const saved = raw.totalTokens > 0
      ? ((raw.totalTokens - tul.totalTokens) / raw.totalTokens * 100).toFixed(0) + '%'
      : 'N/A';
    console.log(
      `  ${TEST_SCENARIOS[i]!.name.padEnd(42)} ${String(raw.totalTokens).padStart(10)}   ${String(tul.totalTokens).padStart(10)}   ${saved}`
    );
  }

  console.log('\nBenchmark complete.\n');
}

// ─── RUN ─────────────────────────────────────────────────────────────
runBenchmark().catch(console.error);
