/**
 * Quick test for hallucination prevention
 */
import { Tul } from './dist/index.js';
import * as dotenv from 'dotenv';

dotenv.config();

async function main() {
  const tul = new Tul({
    apiKey: process.env.GEMINI_API_KEY!,
    model: 'gemini-3-flash-preview',
    maxToolsPerRequest: 5,
    verbose: true,
  });

  // Register only ONE tool
  tul.registerTools([
    {
      name: 'get_weather',
      description: 'Get current weather for a city',
      parameters: {
        type: 'object',
        properties: { city: { type: 'string', description: 'City name' } },
        required: ['city'],
      },
    },
  ]);

  const toolsCalled: string[] = [];

  tul.onToolCall(async (name, args) => {
    console.log(`[TOOL CALLED] ${name}(${JSON.stringify(args)})`);
    toolsCalled.push(name);
    return { temp: 72, condition: 'sunny' };
  });

  // Listen for hallucination errors
  tul.on((event) => {
    if (event.type === 'tool:error') {
      console.log(`[HALLUCINATION CAUGHT] Model tried to call non-existent tool: ${event.name}`);
    }
  });

  console.log('\n=== TEST 1: Should use get_weather ===');
  const r1 = await tul.chat("What's the weather in Tokyo?");
  console.log('Response:', r1.text?.slice(0, 100));
  console.log('Tools called:', toolsCalled);

  toolsCalled.length = 0;
  tul.clearConversation();

  console.log('\n=== TEST 2: Should NOT hallucinate a tool ===');
  console.log('Query: "Remove the shoes from my shopping cart"');
  const r2 = await tul.chat('Remove the shoes from my shopping cart');
  console.log('Response:', r2.text?.slice(0, 200));
  console.log('Tools called:', toolsCalled);

  if (toolsCalled.length === 0) {
    console.log('\n✅ SUCCESS: No hallucinated tool calls!');
  } else if (toolsCalled.includes('get_weather')) {
    console.log('\n⚠️  Model incorrectly tried to use get_weather for shopping cart task');
  } else {
    console.log('\n❌ FAIL: Model hallucinated tools:', toolsCalled);
  }
}

main().catch(console.error);
