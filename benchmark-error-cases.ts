/**
 * 🎯 TUL ERROR CASE BENCHMARK
 *
 * Tests scenarios designed to confuse the model:
 * - Ambiguous queries that could match multiple tools
 * - Similar tool names that are easy to mix up
 * - Queries with misleading keywords
 *
 * Goal: Show cases where raw Gemini fails but Tul succeeds
 */

import { GoogleGenAI } from '@google/genai';
import { Tul } from './dist/index.js';
import * as dotenv from 'dotenv';

dotenv.config();

const API_KEY = process.env.GEMINI_API_KEY!;
const MODEL = 'gemini-3-flash-preview';

// ═══════════════════════════════════════════════════════════════════
// CONFUSING TOOLS - Designed to trip up the model
// ═══════════════════════════════════════════════════════════════════

const CONFUSING_TOOLS = [
  // Two "book" related tools - easy to confuse
  {
    name: 'book_flight',
    description: 'Book a flight ticket to a destination',
    parameters: {
      type: 'object' as const,
      properties: {
        destination: { type: 'string', description: 'Flight destination city' },
        date: { type: 'string', description: 'Travel date YYYY-MM-DD' },
      },
      required: ['destination', 'date'],
    },
  },
  {
    name: 'search_books',
    description: 'Search for books in a library or bookstore',
    parameters: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Book title to search' },
        author: { type: 'string', description: 'Author name' },
      },
      required: ['title'],
    },
  },

  // Two "table" related tools
  {
    name: 'book_restaurant_table',
    description: 'Make a reservation at a restaurant',
    parameters: {
      type: 'object' as const,
      properties: {
        restaurant: { type: 'string', description: 'Restaurant name' },
        party_size: { type: 'number', description: 'Number of guests' },
        time: { type: 'string', description: 'Reservation time' },
      },
      required: ['restaurant', 'party_size', 'time'],
    },
  },
  {
    name: 'create_data_table',
    description: 'Create a data table in a spreadsheet or database',
    parameters: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Table name' },
        columns: { type: 'array', items: { type: 'string' }, description: 'Column names' },
      },
      required: ['name', 'columns'],
    },
  },

  // "Set" ambiguity - settings vs mathematical set
  {
    name: 'change_settings',
    description: 'Change application settings like volume, brightness, theme',
    parameters: {
      type: 'object' as const,
      properties: {
        setting: { type: 'string', description: 'Setting name' },
        value: { type: 'string', description: 'New value' },
      },
      required: ['setting', 'value'],
    },
  },
  {
    name: 'set_reminder',
    description: 'Set a reminder for a future time',
    parameters: {
      type: 'object' as const,
      properties: {
        message: { type: 'string', description: 'Reminder message' },
        time: { type: 'string', description: 'When to remind' },
      },
      required: ['message', 'time'],
    },
  },

  // "Play" ambiguity
  {
    name: 'play_music',
    description: 'Play a song or playlist',
    parameters: {
      type: 'object' as const,
      properties: {
        song: { type: 'string', description: 'Song name or playlist' },
      },
      required: ['song'],
    },
  },
  {
    name: 'play_video',
    description: 'Play a video file or stream',
    parameters: {
      type: 'object' as const,
      properties: {
        video: { type: 'string', description: 'Video name or URL' },
      },
      required: ['video'],
    },
  },

  // "Send" ambiguity
  {
    name: 'send_email',
    description: 'Send an email message',
    parameters: {
      type: 'object' as const,
      properties: {
        to: { type: 'string', description: 'Recipient email' },
        subject: { type: 'string', description: 'Email subject' },
        body: { type: 'string', description: 'Email body' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'send_sms',
    description: 'Send a text message to a phone number',
    parameters: {
      type: 'object' as const,
      properties: {
        phone: { type: 'string', description: 'Phone number' },
        message: { type: 'string', description: 'Text message content' },
      },
      required: ['phone', 'message'],
    },
  },
  {
    name: 'send_money',
    description: 'Send money to another person via payment app',
    parameters: {
      type: 'object' as const,
      properties: {
        recipient: { type: 'string', description: 'Recipient name or ID' },
        amount: { type: 'number', description: 'Amount to send' },
      },
      required: ['recipient', 'amount'],
    },
  },

  // "Order" ambiguity
  {
    name: 'order_food',
    description: 'Order food for delivery',
    parameters: {
      type: 'object' as const,
      properties: {
        restaurant: { type: 'string', description: 'Restaurant name' },
        items: { type: 'array', items: { type: 'string' }, description: 'Food items' },
      },
      required: ['restaurant', 'items'],
    },
  },
  {
    name: 'sort_list',
    description: 'Sort a list in ascending or descending order',
    parameters: {
      type: 'object' as const,
      properties: {
        list: { type: 'array', items: { type: 'string' }, description: 'List to sort' },
        order: { type: 'string', enum: ['ascending', 'descending'], description: 'Sort order' },
      },
      required: ['list', 'order'],
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // CODING / DEV TOOLS - Easy to confuse
  // ═══════════════════════════════════════════════════════════════

  // Run ambiguity
  {
    name: 'run_tests',
    description: 'Execute the test suite for a project',
    parameters: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Path to test directory' },
        filter: { type: 'string', description: 'Test name filter' },
      },
      required: [],
    },
  },
  {
    name: 'run_build',
    description: 'Build the project, compile source code',
    parameters: {
      type: 'object' as const,
      properties: {
        target: { type: 'string', enum: ['dev', 'prod'], description: 'Build target' },
      },
      required: [],
    },
  },
  {
    name: 'run_script',
    description: 'Execute a custom npm/shell script',
    parameters: {
      type: 'object' as const,
      properties: {
        script: { type: 'string', description: 'Script name or command' },
      },
      required: ['script'],
    },
  },

  // Create ambiguity
  {
    name: 'create_file',
    description: 'Create a new file with content',
    parameters: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'File path' },
        content: { type: 'string', description: 'File content' },
      },
      required: ['path'],
    },
  },
  {
    name: 'create_folder',
    description: 'Create a new directory/folder',
    parameters: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Folder path' },
      },
      required: ['path'],
    },
  },
  {
    name: 'create_component',
    description: 'Generate a new React/Vue component with boilerplate',
    parameters: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Component name' },
        type: { type: 'string', enum: ['functional', 'class'], description: 'Component type' },
      },
      required: ['name'],
    },
  },

  // Git ambiguity
  {
    name: 'git_push',
    description: 'Push commits to remote repository',
    parameters: {
      type: 'object' as const,
      properties: {
        branch: { type: 'string', description: 'Branch name' },
        force: { type: 'boolean', description: 'Force push' },
      },
      required: [],
    },
  },
  {
    name: 'git_pull',
    description: 'Pull latest changes from remote',
    parameters: {
      type: 'object' as const,
      properties: {
        branch: { type: 'string', description: 'Branch name' },
      },
      required: [],
    },
  },
  {
    name: 'git_commit',
    description: 'Commit staged changes',
    parameters: {
      type: 'object' as const,
      properties: {
        message: { type: 'string', description: 'Commit message' },
      },
      required: ['message'],
    },
  },

  // Install ambiguity
  {
    name: 'install_package',
    description: 'Install an npm/pip package dependency',
    parameters: {
      type: 'object' as const,
      properties: {
        package: { type: 'string', description: 'Package name' },
        dev: { type: 'boolean', description: 'Install as dev dependency' },
      },
      required: ['package'],
    },
  },
  {
    name: 'install_extension',
    description: 'Install a VS Code or IDE extension',
    parameters: {
      type: 'object' as const,
      properties: {
        extension: { type: 'string', description: 'Extension ID or name' },
      },
      required: ['extension'],
    },
  },

  // Debug vs Deploy
  {
    name: 'start_debugger',
    description: 'Start debugging session with breakpoints',
    parameters: {
      type: 'object' as const,
      properties: {
        file: { type: 'string', description: 'Entry file to debug' },
        port: { type: 'number', description: 'Debug port' },
      },
      required: [],
    },
  },
  {
    name: 'deploy_app',
    description: 'Deploy application to production/staging',
    parameters: {
      type: 'object' as const,
      properties: {
        environment: { type: 'string', enum: ['staging', 'production'], description: 'Target environment' },
      },
      required: ['environment'],
    },
  },

  // Search ambiguity
  {
    name: 'search_code',
    description: 'Search for code patterns in the codebase using grep/ripgrep',
    parameters: {
      type: 'object' as const,
      properties: {
        pattern: { type: 'string', description: 'Search pattern or regex' },
        path: { type: 'string', description: 'Directory to search' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'search_files',
    description: 'Find files by name or glob pattern',
    parameters: {
      type: 'object' as const,
      properties: {
        pattern: { type: 'string', description: 'File name or glob pattern' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'search_docs',
    description: 'Search documentation or comments in code',
    parameters: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Documentation search query' },
      },
      required: ['query'],
    },
  },
];

// ═══════════════════════════════════════════════════════════════════
// TRICKY TEST CASES
// ═══════════════════════════════════════════════════════════════════

const TRICKY_TESTS = [
  {
    name: '1. "Book" ambiguity - flight vs library',
    prompt: 'I want to book a trip to Paris next Friday',
    expectedTool: 'book_flight',
    trap: 'search_books', // Model might get confused by "book"
  },
  {
    name: '2. "Book" reverse - searching for books',
    prompt: 'Find me the book "The Great Gatsby" by Fitzgerald',
    expectedTool: 'search_books',
    trap: 'book_flight', // Should NOT confuse with booking
  },
  {
    name: '3. "Table" ambiguity - restaurant vs data',
    prompt: 'I need a table for 4 at 7pm tonight',
    expectedTool: 'book_restaurant_table',
    trap: 'create_data_table',
  },
  {
    name: '4. "Set" ambiguity - reminder vs settings',
    prompt: 'Set a reminder to call mom at 5pm',
    expectedTool: 'set_reminder',
    trap: 'change_settings',
  },
  {
    name: '5. "Play" ambiguity - audio content',
    prompt: 'Play the song "Bohemian Rhapsody"',
    expectedTool: 'play_music',
    trap: 'play_video',
  },
  {
    name: '6. "Send" ambiguity - money transfer',
    prompt: 'Send $50 to John for dinner',
    expectedTool: 'send_money',
    trap: 'send_email', // or send_sms
  },
  {
    name: '7. "Send" ambiguity - text message',
    prompt: 'Text my wife that I\'ll be late',
    expectedTool: 'send_sms',
    trap: 'send_email',
  },
  {
    name: '8. Misleading keyword - "order" as food delivery',
    prompt: 'Order a pepperoni pizza from Dominos',
    expectedTool: 'order_food',
    trap: 'sort_list', // "order" could confuse
  },
  {
    name: '9. Complex: book + table combination',
    prompt: 'Reserve a spot at The Italian Kitchen for my birthday dinner',
    expectedTool: 'book_restaurant_table',
    trap: 'search_books', // "reserve" sounds like "book"
  },
  {
    name: '10. Indirect phrasing - directions',
    prompt: 'How do I get to the airport from downtown?',
    expectedTool: null, // No directions tool - should NOT call any
    trap: 'ANY_TOOL', // Might incorrectly call something
  },

  // ═══════════════════════════════════════════════════════════════
  // CODING-SPECIFIC TRICKY TESTS
  // ═══════════════════════════════════════════════════════════════
  {
    name: '11. "Run" ambiguity - tests vs build',
    prompt: 'Run the tests to make sure nothing is broken',
    expectedTool: 'run_tests',
    trap: 'run_build',
  },
  {
    name: '12. "Run" ambiguity - build for production',
    prompt: 'Build the project for production deployment',
    expectedTool: 'run_build',
    trap: 'run_tests',
  },
  {
    name: '13. "Create" ambiguity - file vs component',
    prompt: 'Create a new Button component',
    expectedTool: 'create_component',
    trap: 'create_file',
  },
  {
    name: '14. "Create" ambiguity - folder',
    prompt: 'Make a new directory called utils',
    expectedTool: 'create_folder',
    trap: 'create_file',
  },
  {
    name: '15. Git confusion - push vs commit',
    prompt: 'Save my changes with message "fix bug"',
    expectedTool: 'git_commit',
    trap: 'git_push',
  },
  {
    name: '16. Git confusion - pull latest',
    prompt: 'Get the latest code from the remote',
    expectedTool: 'git_pull',
    trap: 'git_push',
  },
  {
    name: '17. Install confusion - package vs extension',
    prompt: 'Add lodash to the project dependencies',
    expectedTool: 'install_package',
    trap: 'install_extension',
  },
  {
    name: '18. Deploy vs Debug',
    prompt: 'Ship this to production',
    expectedTool: 'deploy_app',
    trap: 'start_debugger',
  },
  {
    name: '19. Search ambiguity - code pattern',
    prompt: 'Find all usages of useState in the codebase',
    expectedTool: 'search_code',
    trap: 'search_files',
  },
  {
    name: '20. Search ambiguity - find files',
    prompt: 'Find all .tsx files in the components folder',
    expectedTool: 'search_files',
    trap: 'search_code',
  },
];

// ═══════════════════════════════════════════════════════════════════
// TOOL EXECUTION (mock)
// ═══════════════════════════════════════════════════════════════════

function executeTool(name: string, args: Record<string, any>): any {
  return { success: true, tool: name, args };
}

// ═══════════════════════════════════════════════════════════════════
// RAW GEMINI TEST
// ═══════════════════════════════════════════════════════════════════

async function runRawGemini(prompt: string): Promise<{ tools: string[], error?: string }> {
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const toolsCalled: string[] = [];

  try {
    const tools = CONFUSING_TOOLS.map(t => ({
      functionDeclarations: [{
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      }]
    }));

    let response = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        tools: tools as any,
      },
    });

    const messages: any[] = [{ role: 'user', parts: [{ text: prompt }] }];
    let iterations = 0;

    while (iterations < 3) {
      const candidate = response.candidates?.[0];
      if (!candidate?.content?.parts) break;

      const functionCalls = candidate.content.parts.filter((p: any) => p.functionCall);
      if (functionCalls.length === 0) break;

      messages.push({ role: 'model', parts: candidate.content.parts });

      const functionResponses: any[] = [];
      for (const part of functionCalls) {
        const fc = (part as any).functionCall;
        toolsCalled.push(fc.name);
        const result = executeTool(fc.name, fc.args || {});

        // Include thought signature for Gemini 3
        functionResponses.push({
          functionResponse: {
            name: fc.name,
            response: { output: result },
          }
        });
      }

      messages.push({ role: 'user', parts: functionResponses });

      response = await ai.models.generateContent({
        model: MODEL,
        contents: messages,
        config: { tools: tools as any },
      });

      iterations++;
    }

    return { tools: toolsCalled };
  } catch (e: any) {
    return { tools: toolsCalled, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════════
// TUL SDK TEST
// ═══════════════════════════════════════════════════════════════════

async function runWithTul(prompt: string): Promise<{ tools: string[], error?: string }> {
  const toolsCalled: string[] = [];

  try {
    const tul = new Tul({
      apiKey: API_KEY,
      model: MODEL,
      maxToolsPerRequest: 3, // Aggressive filtering
      compressionLevel: 'moderate',
      verbose: false,
    });

    // Register tools with examples to help disambiguation
    const toolsWithExamples = CONFUSING_TOOLS.map(t => {
      const examples = getExamplesForTool(t.name);
      return { ...t, examples };
    });

    tul.registerTools(toolsWithExamples);

    tul.onToolCall(async (name, args) => {
      toolsCalled.push(name);
      return executeTool(name, args);
    });

    await tul.chat(prompt);
    return { tools: toolsCalled };
  } catch (e: any) {
    return { tools: toolsCalled, error: e.message };
  }
}

// Examples to help model pick the right tool
function getExamplesForTool(name: string): Array<{ input: string; args: Record<string, any> }> {
  const examples: Record<string, Array<{ input: string; args: Record<string, any> }>> = {
    book_flight: [
      { input: 'Book a flight to Tokyo', args: { destination: 'Tokyo', date: '2026-03-15' } },
      { input: 'I need to fly to London next week', args: { destination: 'London', date: '2026-03-01' } },
    ],
    search_books: [
      { input: 'Find the book 1984 by George Orwell', args: { title: '1984', author: 'George Orwell' } },
      { input: 'Search for Harry Potter books', args: { title: 'Harry Potter' } },
    ],
    book_restaurant_table: [
      { input: 'Reserve a table for 2 at Olive Garden', args: { restaurant: 'Olive Garden', party_size: 2, time: '19:00' } },
      { input: 'Book dinner for 4 at 8pm', args: { restaurant: 'TBD', party_size: 4, time: '20:00' } },
    ],
    create_data_table: [
      { input: 'Create a spreadsheet table for expenses', args: { name: 'expenses', columns: ['date', 'amount', 'category'] } },
    ],
    set_reminder: [
      { input: 'Remind me to take medicine at 9am', args: { message: 'Take medicine', time: '09:00' } },
      { input: 'Set a reminder for the meeting', args: { message: 'Meeting', time: '14:00' } },
    ],
    change_settings: [
      { input: 'Turn up the volume', args: { setting: 'volume', value: 'high' } },
      { input: 'Change theme to dark mode', args: { setting: 'theme', value: 'dark' } },
    ],
    play_music: [
      { input: 'Play some jazz', args: { song: 'jazz playlist' } },
      { input: 'Play the Beatles', args: { song: 'The Beatles' } },
    ],
    play_video: [
      { input: 'Play the YouTube video', args: { video: 'youtube.com/...' } },
      { input: 'Watch the movie trailer', args: { video: 'movie trailer' } },
    ],
    send_email: [
      { input: 'Email John about the project', args: { to: 'john@email.com', subject: 'Project Update', body: '...' } },
    ],
    send_sms: [
      { input: 'Text mom I love her', args: { phone: 'mom', message: 'I love you' } },
      { input: 'Send a text to 555-1234', args: { phone: '555-1234', message: '...' } },
    ],
    send_money: [
      { input: 'Venmo $20 to Sarah', args: { recipient: 'Sarah', amount: 20 } },
      { input: 'Pay back Mike the $50', args: { recipient: 'Mike', amount: 50 } },
    ],
    order_food: [
      { input: 'Get pizza delivered', args: { restaurant: 'Pizza Hut', items: ['pizza'] } },
      { input: 'Order Chinese food', args: { restaurant: 'Chinese Restaurant', items: ['fried rice', 'dumplings'] } },
    ],
    sort_list: [
      { input: 'Sort these numbers: 5, 2, 8, 1', args: { list: ['5', '2', '8', '1'], order: 'ascending' } },
    ],
    // Coding tools
    run_tests: [
      { input: 'Run the unit tests', args: { path: './tests' } },
      { input: 'Execute the test suite', args: {} },
      { input: 'Make sure all tests pass', args: {} },
    ],
    run_build: [
      { input: 'Build for production', args: { target: 'prod' } },
      { input: 'Compile the project', args: { target: 'dev' } },
    ],
    run_script: [
      { input: 'Run the lint script', args: { script: 'lint' } },
      { input: 'Execute npm start', args: { script: 'start' } },
    ],
    create_file: [
      { input: 'Create a new config.json file', args: { path: 'config.json', content: '{}' } },
      { input: 'Make a new .env file', args: { path: '.env' } },
    ],
    create_folder: [
      { input: 'Create a utils directory', args: { path: 'src/utils' } },
      { input: 'Make a new folder called components', args: { path: 'components' } },
    ],
    create_component: [
      { input: 'Generate a Button component', args: { name: 'Button', type: 'functional' } },
      { input: 'Create a new React component called Modal', args: { name: 'Modal' } },
    ],
    git_push: [
      { input: 'Push to origin', args: { branch: 'main' } },
      { input: 'Push my commits to remote', args: {} },
    ],
    git_pull: [
      { input: 'Pull latest changes', args: {} },
      { input: 'Get updates from remote', args: { branch: 'main' } },
      { input: 'Fetch and merge from origin', args: {} },
    ],
    git_commit: [
      { input: 'Commit with message "fix typo"', args: { message: 'fix typo' } },
      { input: 'Save changes as "add feature"', args: { message: 'add feature' } },
    ],
    install_package: [
      { input: 'Install axios', args: { package: 'axios' } },
      { input: 'Add lodash as a dependency', args: { package: 'lodash' } },
      { input: 'npm install react-query', args: { package: 'react-query' } },
    ],
    install_extension: [
      { input: 'Install the Prettier extension', args: { extension: 'esbenp.prettier-vscode' } },
      { input: 'Add ESLint to VS Code', args: { extension: 'dbaeumer.vscode-eslint' } },
    ],
    start_debugger: [
      { input: 'Debug the app', args: { file: 'index.js' } },
      { input: 'Start debugging with breakpoints', args: {} },
    ],
    deploy_app: [
      { input: 'Deploy to production', args: { environment: 'production' } },
      { input: 'Ship to staging', args: { environment: 'staging' } },
      { input: 'Release to prod', args: { environment: 'production' } },
    ],
    search_code: [
      { input: 'Find all console.log statements', args: { pattern: 'console.log' } },
      { input: 'Search for TODO comments', args: { pattern: 'TODO' } },
      { input: 'Find usages of useState', args: { pattern: 'useState' } },
    ],
    search_files: [
      { input: 'Find all .ts files', args: { pattern: '*.ts' } },
      { input: 'Find files named index', args: { pattern: 'index.*' } },
      { input: 'List all .tsx files in components', args: { pattern: 'components/**/*.tsx' } },
    ],
    search_docs: [
      { input: 'Search the API documentation', args: { query: 'API' } },
      { input: 'Find documentation about authentication', args: { query: 'authentication' } },
    ],
  };
  return examples[name] || [];
}

// ═══════════════════════════════════════════════════════════════════
// MAIN BENCHMARK
// ═══════════════════════════════════════════════════════════════════

async function runBenchmark() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║          🎯 TUL ERROR CASE BENCHMARK: Tricky Scenarios                   ║');
  console.log('╠══════════════════════════════════════════════════════════════════════════╣');
  console.log(`║  Model: ${MODEL.padEnd(60)}║`);
  console.log(`║  Tools: ${CONFUSING_TOOLS.length} (designed to be confusing)                                   ║`);
  console.log(`║  Tests: ${TRICKY_TESTS.length} tricky scenarios                                              ║`);
  console.log('╚══════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  let rawCorrect = 0;
  let tulCorrect = 0;
  const results: Array<{
    test: string;
    expected: string | null;
    rawResult: string;
    tulResult: string;
    rawCorrect: boolean;
    tulCorrect: boolean;
  }> = [];

  for (const test of TRICKY_TESTS) {
    console.log(`\n▸ ${test.name}`);
    console.log(`  Prompt: "${test.prompt}"`);
    console.log(`  Expected: ${test.expectedTool || 'NO TOOL CALL'}`);
    console.log(`  Trap: ${test.trap}`);

    // Run raw Gemini
    process.stdout.write('  Raw Gemini:  ');
    const rawResult = await runRawGemini(test.prompt);
    const rawToolCalled = rawResult.tools[0] || 'NONE';
    const rawIsCorrect = test.expectedTool
      ? rawResult.tools.includes(test.expectedTool)
      : rawResult.tools.length === 0;

    if (rawIsCorrect) rawCorrect++;
    console.log(
      `${rawIsCorrect ? '✅' : '❌'} Called: ${rawToolCalled}` +
      (rawResult.error ? ` (Error: ${rawResult.error.slice(0, 40)})` : '')
    );

    // Small delay
    await new Promise(r => setTimeout(r, 1500));

    // Run Tul
    process.stdout.write('  With Tul:    ');
    const tulResult = await runWithTul(test.prompt);
    const tulToolCalled = tulResult.tools[0] || 'NONE';
    const tulIsCorrect = test.expectedTool
      ? tulResult.tools.includes(test.expectedTool)
      : tulResult.tools.length === 0;

    if (tulIsCorrect) tulCorrect++;
    console.log(
      `${tulIsCorrect ? '✅' : '❌'} Called: ${tulToolCalled}` +
      (tulResult.error ? ` (Error: ${tulResult.error.slice(0, 40)})` : '')
    );

    results.push({
      test: test.name,
      expected: test.expectedTool,
      rawResult: rawToolCalled,
      tulResult: tulToolCalled,
      rawCorrect: rawIsCorrect,
      tulCorrect: tulIsCorrect,
    });

    // Delay between tests
    await new Promise(r => setTimeout(r, 1500));
  }

  // Summary
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                            📊 RESULTS SUMMARY                            ║');
  console.log('╠══════════════════════════════════════════════════════════════════════════╣');
  console.log(`║  Raw Gemini Accuracy:  ${rawCorrect}/${TRICKY_TESTS.length} (${(rawCorrect/TRICKY_TESTS.length*100).toFixed(0)}%)                                       ║`);
  console.log(`║  Tul SDK Accuracy:     ${tulCorrect}/${TRICKY_TESTS.length} (${(tulCorrect/TRICKY_TESTS.length*100).toFixed(0)}%)                                       ║`);
  console.log(`║  Improvement:          +${tulCorrect - rawCorrect} correct answers                                   ║`);
  console.log('╚══════════════════════════════════════════════════════════════════════════╝');

  // Detailed table
  console.log('\n📋 Detailed Results:\n');
  console.log('  Test                                          Expected              Raw         Tul');
  console.log('  ────────────────────────────────────────────  ────────────────────  ──────────  ──────────');

  for (const r of results) {
    const testName = r.test.slice(0, 44).padEnd(44);
    const expected = (r.expected || 'NONE').slice(0, 20).padEnd(20);
    const raw = `${r.rawCorrect ? '✅' : '❌'} ${r.rawResult.slice(0, 8)}`.padEnd(10);
    const tul = `${r.tulCorrect ? '✅' : '❌'} ${r.tulResult.slice(0, 8)}`;
    console.log(`  ${testName}  ${expected}  ${raw}  ${tul}`);
  }

  // Cases where Tul won
  const tulWins = results.filter(r => r.tulCorrect && !r.rawCorrect);
  if (tulWins.length > 0) {
    console.log('\n🏆 Cases where Tul succeeded but Raw Gemini failed:\n');
    for (const win of tulWins) {
      console.log(`  • ${win.test}`);
      console.log(`    Expected: ${win.expected}, Raw called: ${win.rawResult}, Tul called: ${win.tulResult}`);
    }
  }

  // Cases where Raw won (unexpected)
  const rawWins = results.filter(r => r.rawCorrect && !r.tulCorrect);
  if (rawWins.length > 0) {
    console.log('\n⚠️  Cases where Raw Gemini succeeded but Tul failed:\n');
    for (const win of rawWins) {
      console.log(`  • ${win.test}`);
      console.log(`    Expected: ${win.expected}, Raw called: ${win.rawResult}, Tul called: ${win.tulResult}`);
    }
  }

  console.log('\n✅ Error case benchmark complete.\n');
}

runBenchmark().catch(console.error);
