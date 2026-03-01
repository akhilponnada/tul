/**
 * 🔥 ADVERSARIAL BENCHMARK - Designed to BREAK Gemini
 *
 * These tests use:
 * - Highly similar tool names
 * - Misleading keywords
 * - Context that points to wrong tool
 * - Slang and informal language
 * - Multi-interpretation queries
 */

import { GoogleGenAI } from '@google/genai';
import { Tul } from './dist/index.js';
import * as dotenv from 'dotenv';

dotenv.config();

const API_KEY = process.env.GEMINI_API_KEY!;
const MODEL = 'gemini-3-flash-preview';

// ═══════════════════════════════════════════════════════════════════
// ADVERSARIAL TOOLS - Maximum confusion
// ═══════════════════════════════════════════════════════════════════

const ADVERSARIAL_TOOLS = [
  // Near-identical names
  {
    name: 'get_user',
    description: 'Get user profile information by ID',
    parameters: {
      type: 'object' as const,
      properties: {
        user_id: { type: 'string', description: 'User ID' },
      },
      required: ['user_id'],
    },
  },
  {
    name: 'get_users',
    description: 'Get list of all users',
    parameters: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number', description: 'Max users to return' },
      },
      required: [],
    },
  },
  {
    name: 'get_user_data',
    description: 'Get raw user data export for analytics',
    parameters: {
      type: 'object' as const,
      properties: {
        format: { type: 'string', enum: ['json', 'csv'], description: 'Export format' },
      },
      required: [],
    },
  },

  // delete vs remove vs clear
  {
    name: 'delete_file',
    description: 'Permanently delete a file from disk',
    parameters: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'File path to delete' },
      },
      required: ['path'],
    },
  },
  {
    name: 'remove_item',
    description: 'Remove an item from a shopping cart',
    parameters: {
      type: 'object' as const,
      properties: {
        item_id: { type: 'string', description: 'Cart item ID' },
      },
      required: ['item_id'],
    },
  },
  {
    name: 'clear_cache',
    description: 'Clear application cache',
    parameters: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'clear_history',
    description: 'Clear browser/chat history',
    parameters: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },

  // update vs edit vs modify vs change
  {
    name: 'update_profile',
    description: 'Update user profile settings',
    parameters: {
      type: 'object' as const,
      properties: {
        field: { type: 'string', description: 'Field to update' },
        value: { type: 'string', description: 'New value' },
      },
      required: ['field', 'value'],
    },
  },
  {
    name: 'edit_document',
    description: 'Edit a text document',
    parameters: {
      type: 'object' as const,
      properties: {
        doc_id: { type: 'string', description: 'Document ID' },
        content: { type: 'string', description: 'New content' },
      },
      required: ['doc_id', 'content'],
    },
  },
  {
    name: 'modify_config',
    description: 'Modify application configuration',
    parameters: {
      type: 'object' as const,
      properties: {
        key: { type: 'string', description: 'Config key' },
        value: { type: 'string', description: 'New value' },
      },
      required: ['key', 'value'],
    },
  },
  {
    name: 'change_password',
    description: 'Change user account password',
    parameters: {
      type: 'object' as const,
      properties: {
        old_password: { type: 'string', description: 'Current password' },
        new_password: { type: 'string', description: 'New password' },
      },
      required: ['old_password', 'new_password'],
    },
  },

  // log vs logger vs logging
  {
    name: 'log_event',
    description: 'Log an analytics event',
    parameters: {
      type: 'object' as const,
      properties: {
        event_name: { type: 'string', description: 'Event name' },
        properties: { type: 'object', description: 'Event properties' },
      },
      required: ['event_name'],
    },
  },
  {
    name: 'view_logs',
    description: 'View application error logs',
    parameters: {
      type: 'object' as const,
      properties: {
        lines: { type: 'number', description: 'Number of log lines' },
      },
      required: [],
    },
  },
  {
    name: 'login',
    description: 'Log in to an account',
    parameters: {
      type: 'object' as const,
      properties: {
        username: { type: 'string', description: 'Username' },
        password: { type: 'string', description: 'Password' },
      },
      required: ['username', 'password'],
    },
  },
  {
    name: 'logout',
    description: 'Log out of current session',
    parameters: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },

  // send vs post vs publish vs submit
  {
    name: 'send_notification',
    description: 'Send a push notification to user',
    parameters: {
      type: 'object' as const,
      properties: {
        user_id: { type: 'string', description: 'User ID' },
        message: { type: 'string', description: 'Notification message' },
      },
      required: ['user_id', 'message'],
    },
  },
  {
    name: 'post_comment',
    description: 'Post a comment on a blog/social media',
    parameters: {
      type: 'object' as const,
      properties: {
        post_id: { type: 'string', description: 'Post ID' },
        text: { type: 'string', description: 'Comment text' },
      },
      required: ['post_id', 'text'],
    },
  },
  {
    name: 'publish_article',
    description: 'Publish a draft article to the blog',
    parameters: {
      type: 'object' as const,
      properties: {
        article_id: { type: 'string', description: 'Article ID' },
      },
      required: ['article_id'],
    },
  },
  {
    name: 'submit_form',
    description: 'Submit a form with data',
    parameters: {
      type: 'object' as const,
      properties: {
        form_id: { type: 'string', description: 'Form ID' },
        data: { type: 'object', description: 'Form data' },
      },
      required: ['form_id', 'data'],
    },
  },

  // start vs begin vs launch vs open vs run
  {
    name: 'start_server',
    description: 'Start the development server',
    parameters: {
      type: 'object' as const,
      properties: {
        port: { type: 'number', description: 'Port number' },
      },
      required: [],
    },
  },
  {
    name: 'launch_app',
    description: 'Launch a desktop application',
    parameters: {
      type: 'object' as const,
      properties: {
        app_name: { type: 'string', description: 'Application name' },
      },
      required: ['app_name'],
    },
  },
  {
    name: 'open_file',
    description: 'Open a file in the default editor',
    parameters: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'File path' },
      },
      required: ['path'],
    },
  },
  {
    name: 'run_command',
    description: 'Run a shell command',
    parameters: {
      type: 'object' as const,
      properties: {
        command: { type: 'string', description: 'Shell command' },
      },
      required: ['command'],
    },
  },

  // stop vs end vs close vs kill vs terminate
  {
    name: 'stop_server',
    description: 'Stop the running server',
    parameters: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'close_connection',
    description: 'Close a database connection',
    parameters: {
      type: 'object' as const,
      properties: {
        connection_id: { type: 'string', description: 'Connection ID' },
      },
      required: ['connection_id'],
    },
  },
  {
    name: 'kill_process',
    description: 'Kill a running process by PID',
    parameters: {
      type: 'object' as const,
      properties: {
        pid: { type: 'number', description: 'Process ID' },
      },
      required: ['pid'],
    },
  },
  {
    name: 'terminate_session',
    description: 'Terminate a user session',
    parameters: {
      type: 'object' as const,
      properties: {
        session_id: { type: 'string', description: 'Session ID' },
      },
      required: ['session_id'],
    },
  },
];

// ═══════════════════════════════════════════════════════════════════
// ADVERSARIAL TEST CASES
// ═══════════════════════════════════════════════════════════════════

const ADVERSARIAL_TESTS = [
  // Singular vs Plural confusion
  {
    name: '1. get_user vs get_users - singular',
    prompt: 'Get the profile for user 12345',
    expectedTool: 'get_user',
    trap: 'get_users',
  },
  {
    name: '2. get_user vs get_users - plural request',
    prompt: 'Show me all the users in the system',
    expectedTool: 'get_users',
    trap: 'get_user',
  },

  // Delete/Remove/Clear confusion
  {
    name: '3. delete vs clear - file deletion',
    prompt: 'Delete the file at /tmp/test.txt',
    expectedTool: 'delete_file',
    trap: 'clear_cache',
  },
  {
    name: '4. delete vs remove - shopping cart',
    prompt: 'Remove the shoes from my cart',
    expectedTool: 'remove_item',
    trap: 'delete_file',
  },
  {
    name: '5. clear ambiguity - cache vs history',
    prompt: 'Clear my browsing history',
    expectedTool: 'clear_history',
    trap: 'clear_cache',
  },

  // Update/Edit/Modify/Change confusion with misleading context
  {
    name: '6. update vs modify - config file mentioned',
    prompt: 'Update the API key in the config',
    expectedTool: 'modify_config',
    trap: 'update_profile',
  },
  {
    name: '7. edit vs update - document',
    prompt: 'Edit the readme document and add installation steps',
    expectedTool: 'edit_document',
    trap: 'update_profile',
  },
  {
    name: '8. change - password specifically',
    prompt: 'I need to change my password to something stronger',
    expectedTool: 'change_password',
    trap: 'modify_config',
  },

  // Log confusion (log/login/logout)
  {
    name: '9. log vs login - ambiguous "log in"',
    prompt: 'Log in to my account with username admin',
    expectedTool: 'login',
    trap: 'log_event',
  },
  {
    name: '10. log vs logout - "log out"',
    prompt: 'Log me out of the system',
    expectedTool: 'logout',
    trap: 'log_event',
  },
  {
    name: '11. log as analytics',
    prompt: 'Log a page_view event for analytics',
    expectedTool: 'log_event',
    trap: 'view_logs',
  },
  {
    name: '12. view logs - error checking',
    prompt: 'Show me the last 100 lines of error logs',
    expectedTool: 'view_logs',
    trap: 'log_event',
  },

  // Send/Post/Publish/Submit confusion
  {
    name: '13. send vs post - notification',
    prompt: 'Send a notification to user 123 saying "Hello"',
    expectedTool: 'send_notification',
    trap: 'post_comment',
  },
  {
    name: '14. post - social media comment',
    prompt: 'Post a comment saying "Great article!" on post 456',
    expectedTool: 'post_comment',
    trap: 'publish_article',
  },
  {
    name: '15. publish vs post - article',
    prompt: 'Publish my draft article to the blog',
    expectedTool: 'publish_article',
    trap: 'post_comment',
  },
  {
    name: '16. submit - form data',
    prompt: 'Submit the contact form with my details',
    expectedTool: 'submit_form',
    trap: 'send_notification',
  },

  // Start/Launch/Open/Run confusion
  {
    name: '17. start vs run - server',
    prompt: 'Start the dev server on port 3000',
    expectedTool: 'start_server',
    trap: 'run_command',
  },
  {
    name: '18. open vs launch - file',
    prompt: 'Open the config.json file',
    expectedTool: 'open_file',
    trap: 'launch_app',
  },
  {
    name: '19. launch vs open - app',
    prompt: 'Launch Chrome browser',
    expectedTool: 'launch_app',
    trap: 'open_file',
  },
  {
    name: '20. run - shell command',
    prompt: 'Run npm install',
    expectedTool: 'run_command',
    trap: 'start_server',
  },

  // Stop/Close/Kill/Terminate confusion
  {
    name: '21. stop vs kill - server',
    prompt: 'Stop the server',
    expectedTool: 'stop_server',
    trap: 'kill_process',
  },
  {
    name: '22. kill - process by PID',
    prompt: 'Kill process 1234',
    expectedTool: 'kill_process',
    trap: 'stop_server',
  },
  {
    name: '23. close - database connection',
    prompt: 'Close the database connection',
    expectedTool: 'close_connection',
    trap: 'terminate_session',
  },
  {
    name: '24. terminate - user session',
    prompt: 'Terminate the active user session',
    expectedTool: 'terminate_session',
    trap: 'close_connection',
  },

  // Slang and informal language
  {
    name: '25. Slang: "nuke" the cache',
    prompt: 'Nuke the cache, it\'s causing issues',
    expectedTool: 'clear_cache',
    trap: 'delete_file',
  },
  {
    name: '26. Slang: "fire up" the server',
    prompt: 'Fire up the server',
    expectedTool: 'start_server',
    trap: 'launch_app',
  },
  {
    name: '27. Slang: "wipe" history',
    prompt: 'Wipe my browser history',
    expectedTool: 'clear_history',
    trap: 'delete_file',
  },
  {
    name: '28. Slang: "zap" a process',
    prompt: 'Zap that hung process',
    expectedTool: 'kill_process',
    trap: 'delete_file',
  },

  // Edge cases with multiple valid interpretations
  {
    name: '29. Ambiguous: "get user data"',
    prompt: 'Get user data for export',
    expectedTool: 'get_user_data',
    trap: 'get_user',
  },
  {
    name: '30. Highly ambiguous: "log the error"',
    prompt: 'Log the error that just occurred',
    expectedTool: 'log_event',
    trap: 'view_logs',
  },
];

// ═══════════════════════════════════════════════════════════════════
// TOOL EXECUTION
// ═══════════════════════════════════════════════════════════════════

function executeTool(name: string, args: Record<string, any>): any {
  return { success: true, tool: name, args };
}

// ═══════════════════════════════════════════════════════════════════
// RAW GEMINI
// ═══════════════════════════════════════════════════════════════════

async function runRawGemini(prompt: string): Promise<{ tools: string[], error?: string }> {
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const toolsCalled: string[] = [];

  try {
    const tools = ADVERSARIAL_TOOLS.map(t => ({
      functionDeclarations: [{
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      }]
    }));

    let response = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { tools: tools as any },
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
        functionResponses.push({
          functionResponse: { name: fc.name, response: { output: result } }
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
// TUL SDK with strong examples
// ═══════════════════════════════════════════════════════════════════

async function runWithTul(prompt: string): Promise<{ tools: string[], error?: string }> {
  const toolsCalled: string[] = [];

  try {
    const tul = new Tul({
      apiKey: API_KEY,
      model: MODEL,
      maxToolsPerRequest: 8,
      compressionLevel: 'minimal', // Keep full descriptions for this test
      verbose: false,
      forceToolCalling: true, // Always force tool calling for this benchmark
      retryWithExpandedTools: true, // Retry with more tools if needed
      minToolsToSend: 5, // Ensure minimum tools available
      enhanceDescriptions: true, // SDK auto-enhances poor tool descriptions
    });

    // Add strong disambiguating examples
    const toolsWithExamples = ADVERSARIAL_TOOLS.map(t => ({
      ...t,
      examples: getExamplesForTool(t.name),
    }));

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

function getExamplesForTool(name: string): Array<{ input: string; args: Record<string, any> }> {
  const examples: Record<string, Array<{ input: string; args: Record<string, any> }>> = {
    get_user: [
      { input: 'Get profile for user 123', args: { user_id: '123' } },
      { input: 'Fetch user info for ID abc', args: { user_id: 'abc' } },
    ],
    get_users: [
      { input: 'List all users', args: {} },
      { input: 'Show me all users', args: { limit: 100 } },
    ],
    get_user_data: [
      { input: 'Export user data as CSV', args: { format: 'csv' } },
      { input: 'Get raw user data for analytics', args: { format: 'json' } },
    ],
    delete_file: [
      { input: 'Delete /tmp/old.log', args: { path: '/tmp/old.log' } },
      { input: 'Remove the file at path', args: { path: '/some/path' } },
    ],
    remove_item: [
      { input: 'Remove item from cart', args: { item_id: 'item123' } },
      { input: 'Take the shirt out of my cart', args: { item_id: 'shirt' } },
    ],
    clear_cache: [
      { input: 'Clear the app cache', args: {} },
      { input: 'Nuke the cache', args: {} },
    ],
    clear_history: [
      { input: 'Clear browser history', args: {} },
      { input: 'Wipe my browsing history', args: {} },
    ],
    update_profile: [
      { input: 'Update my profile name', args: { field: 'name', value: 'John' } },
    ],
    edit_document: [
      { input: 'Edit the readme', args: { doc_id: 'readme', content: '...' } },
    ],
    modify_config: [
      { input: 'Change the API key in config', args: { key: 'api_key', value: 'xxx' } },
      { input: 'Update config setting', args: { key: 'debug', value: 'true' } },
    ],
    change_password: [
      { input: 'Change my password', args: { old_password: 'old', new_password: 'new' } },
    ],
    log_event: [
      { input: 'Log a click event', args: { event_name: 'click' } },
      { input: 'Track page view', args: { event_name: 'page_view' } },
    ],
    view_logs: [
      { input: 'Show error logs', args: { lines: 100 } },
      { input: 'View application logs', args: {} },
    ],
    login: [
      { input: 'Login as admin', args: { username: 'admin', password: 'pass' } },
      { input: 'Sign in to my account', args: { username: 'user', password: 'pass' } },
    ],
    logout: [
      { input: 'Log out', args: {} },
      { input: 'Sign me out', args: {} },
    ],
    send_notification: [
      { input: 'Send push notification', args: { user_id: '123', message: 'Hi' } },
    ],
    post_comment: [
      { input: 'Comment on the post', args: { post_id: '123', text: 'Nice!' } },
    ],
    publish_article: [
      { input: 'Publish my article', args: { article_id: 'draft1' } },
    ],
    submit_form: [
      { input: 'Submit the form', args: { form_id: 'contact', data: {} } },
    ],
    start_server: [
      { input: 'Start dev server', args: { port: 3000 } },
      { input: 'Fire up the server', args: {} },
    ],
    launch_app: [
      { input: 'Launch Chrome', args: { app_name: 'Chrome' } },
      { input: 'Open Spotify app', args: { app_name: 'Spotify' } },
    ],
    open_file: [
      { input: 'Open config.json', args: { path: 'config.json' } },
      { input: 'Open the readme file', args: { path: 'README.md' } },
    ],
    run_command: [
      { input: 'Run npm install', args: { command: 'npm install' } },
      { input: 'Execute ls -la', args: { command: 'ls -la' } },
    ],
    stop_server: [
      { input: 'Stop the server', args: {} },
      { input: 'Shut down the dev server', args: {} },
    ],
    close_connection: [
      { input: 'Close DB connection', args: { connection_id: 'db1' } },
    ],
    kill_process: [
      { input: 'Kill PID 1234', args: { pid: 1234 } },
      { input: 'Zap that process', args: { pid: 5678 } },
    ],
    terminate_session: [
      { input: 'Terminate user session', args: { session_id: 'sess1' } },
    ],
  };
  return examples[name] || [];
}

// ═══════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════

async function runBenchmark() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║        🔥 ADVERSARIAL BENCHMARK: Maximum Confusion Tests                 ║');
  console.log('╠══════════════════════════════════════════════════════════════════════════╣');
  console.log(`║  Model: ${MODEL.padEnd(60)}║`);
  console.log(`║  Tools: ${ADVERSARIAL_TOOLS.length} (near-identical names, maximum confusion)              ║`);
  console.log(`║  Tests: ${ADVERSARIAL_TESTS.length} adversarial scenarios                                      ║`);
  console.log('╚══════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  let rawCorrect = 0;
  let tulCorrect = 0;
  const results: Array<{
    test: string;
    expected: string;
    rawResult: string;
    tulResult: string;
    rawCorrect: boolean;
    tulCorrect: boolean;
  }> = [];

  for (const test of ADVERSARIAL_TESTS) {
    console.log(`\n▸ ${test.name}`);
    console.log(`  "${test.prompt}"`);
    console.log(`  Expected: ${test.expectedTool} | Trap: ${test.trap}`);

    // Raw Gemini
    process.stdout.write('  Raw:  ');
    const rawResult = await runRawGemini(test.prompt);
    const rawToolCalled = rawResult.tools[0] || 'NONE';
    const rawIsCorrect = rawResult.tools.includes(test.expectedTool);
    if (rawIsCorrect) rawCorrect++;
    console.log(`${rawIsCorrect ? '✅' : '❌'} ${rawToolCalled}`);

    await new Promise(r => setTimeout(r, 1200));

    // Tul
    process.stdout.write('  Tul:  ');
    const tulResult = await runWithTul(test.prompt);
    const tulToolCalled = tulResult.tools[0] || 'NONE';
    const tulIsCorrect = tulResult.tools.includes(test.expectedTool);
    if (tulIsCorrect) tulCorrect++;
    console.log(`${tulIsCorrect ? '✅' : '❌'} ${tulToolCalled}`);

    results.push({
      test: test.name,
      expected: test.expectedTool,
      rawResult: rawToolCalled,
      tulResult: tulToolCalled,
      rawCorrect: rawIsCorrect,
      tulCorrect: tulIsCorrect,
    });

    await new Promise(r => setTimeout(r, 1200));
  }

  // Summary
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                         📊 ADVERSARIAL RESULTS                           ║');
  console.log('╠══════════════════════════════════════════════════════════════════════════╣');
  console.log(`║  Raw Gemini:  ${rawCorrect}/${ADVERSARIAL_TESTS.length} (${(rawCorrect/ADVERSARIAL_TESTS.length*100).toFixed(0)}%)                                            ║`);
  console.log(`║  Tul SDK:     ${tulCorrect}/${ADVERSARIAL_TESTS.length} (${(tulCorrect/ADVERSARIAL_TESTS.length*100).toFixed(0)}%)                                            ║`);
  console.log(`║  Difference:  ${tulCorrect - rawCorrect >= 0 ? '+' : ''}${tulCorrect - rawCorrect}                                                    ║`);
  console.log('╚══════════════════════════════════════════════════════════════════════════╝');

  // Wins/Losses
  const tulWins = results.filter(r => r.tulCorrect && !r.rawCorrect);
  const rawWins = results.filter(r => r.rawCorrect && !r.tulCorrect);
  const bothFailed = results.filter(r => !r.rawCorrect && !r.tulCorrect);

  if (tulWins.length > 0) {
    console.log('\n🏆 TUL WINS (Tul correct, Raw wrong):');
    for (const w of tulWins) {
      console.log(`  • ${w.test}`);
      console.log(`    Expected: ${w.expected} | Raw: ${w.rawResult} | Tul: ${w.tulResult}`);
    }
  }

  if (rawWins.length > 0) {
    console.log('\n⚠️  RAW WINS (Raw correct, Tul wrong):');
    for (const w of rawWins) {
      console.log(`  • ${w.test}`);
      console.log(`    Expected: ${w.expected} | Raw: ${w.rawResult} | Tul: ${w.tulResult}`);
    }
  }

  if (bothFailed.length > 0) {
    console.log('\n❌ BOTH FAILED:');
    for (const f of bothFailed) {
      console.log(`  • ${f.test}`);
      console.log(`    Expected: ${f.expected} | Raw: ${f.rawResult} | Tul: ${f.tulResult}`);
    }
  }

  console.log('\n✅ Adversarial benchmark complete.\n');
}

runBenchmark().catch(console.error);
