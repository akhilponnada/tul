<p align="center">
  <img src="https://img.shields.io/npm/v/tul-sdk?style=for-the-badge&color=blue" alt="npm version" />
  <img src="https://img.shields.io/npm/dm/tul-sdk?style=for-the-badge&color=green" alt="downloads" />
  <img src="https://img.shields.io/npm/l/tul-sdk?style=for-the-badge" alt="license" />
  <img src="https://img.shields.io/badge/TypeScript-Ready-blue?style=for-the-badge&logo=typescript" alt="typescript" />
</p>

<h1 align="center">🛠️ tul-sdk</h1>

<p align="center">
  <strong>Claude-level tool calling for Gemini. Less code. More reliability. Better DX.</strong>
</p>

<p align="center">
  <a href="#-why-tul">Why TUL?</a> •
  <a href="#-real-world-value-tests">Value Tests</a> •
  <a href="#installation">Installation</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#features">Features</a> •
  <a href="#api-reference">API</a>
</p>

---

## 🤔 Why TUL?

<table>
<tr>
<td width="50%">

### 😤 Without TUL (Raw Gemini)

```
❌ Write 40+ lines for tool loops
❌ Build your own retry logic
❌ Crash on schema errors
❌ DIY debugging (100+ LOC)
❌ Build your own caching
```

</td>
<td width="50%">

### ✅ With TUL

```
✅ Automatic multi-step workflows
✅ Built-in retry with backoff
✅ Graceful error handling
✅ Stats, events, tracing out-of-box
✅ Result caching with TTL
```

</td>
</tr>
</table>

---

## 🧪 Real-World Value Tests

We ran side-by-side tests comparing TUL vs Raw Gemini. Here's what happened:

### Test 1: Multi-Step Workflows

> **Task**: Read config.json → Update version to "2.0" and debug to true → Write it back

```
┌─────────────────────────────────────────────────────────────┐
│  📦 TUL SDK                    │  🔧 Raw Gemini              │
├─────────────────────────────────────────────────────────────┤
│  ✅ Automatic                  │  ❌ Manual loop required    │
│  ~10 lines of code             │  ~40 lines of code          │
│  Just works™                   │  YOU write the while loop   │
└─────────────────────────────────────────────────────────────┘
```

**TUL Code:**
```typescript
const tul = new Tul({ apiKey, model: 'gemini-2.0-flash' });
tul.registerTools(tools);
tul.onToolCall(executor);
await tul.chat('Read config.json, update version to 2.0, write back');
// Done. ✅
```

**Raw Gemini Code:**
```typescript
// 40 lines of manual loop, type checking, result handling...
while (response.candidates?.[0]?.content?.parts?.some(p => 'functionCall' in p)) {
  const functionCalls = response.candidates[0].content.parts.filter(p => 'functionCall' in p);
  // ... execute tools manually ...
  // ... build function response ...
  // ... send back to API ...
  // ... check for more function calls ...
  // ... repeat until done ...
}
```

---

### Test 2: Error Handling & Auto-Retry

> **Task**: Call a flaky API that fails twice before succeeding

```
┌─────────────────────────────────────────────────────────────┐
│  📦 TUL SDK                    │  🔧 Raw Gemini              │
├─────────────────────────────────────────────────────────────┤
│  ✅ Auto-retried               │  💀 CRASHED                 │
│  ✅ Success after 2 retries    │  "API temporarily unavail-  │
│  ✅ Zero extra code needed     │   able (attempt 1)"         │
└─────────────────────────────────────────────────────────────┘
```

```typescript
// TUL: Just configure retry
const tul = new Tul({
  retryOnFailure: true,
  maxRetries: 5,
});
// That's it. Retries happen automatically.

// Raw Gemini: Build it yourself (or crash)
// try { ... } catch { ... setTimeout ... retry ... }
```

---

### Test 3: Schema Validation

> **Task**: Use a tool with an invalid schema (array missing items definition)

```
┌─────────────────────────────────────────────────────────────┐
│  📦 TUL SDK                    │  🔧 Raw Gemini              │
├─────────────────────────────────────────────────────────────┤
│  ✅ Handles gracefully         │  💀 CRASHED                 │
│  ✅ Early validation           │  [GoogleGenerativeAI Error] │
│  ✅ Helpful error messages     │  Error fetching from API... │
└─────────────────────────────────────────────────────────────┘
```

---

### Test 4: Debugging & Statistics

> **Task**: Track tool calls, timing, cache hits, retries

```
┌─────────────────────────────────────────────────────────────┐
│  📦 TUL SDK                    │  🔧 Raw Gemini              │
├─────────────────────────────────────────────────────────────┤
│  ✅ response.stats.toolCalls   │  ❌ DIY (100+ lines)        │
│  ✅ response.stats.tokensSaved │  ❌ Count it yourself       │
│  ✅ response.stats.cacheHits   │  ❌ Build your own cache    │
│  ✅ tul.on(event => ...)       │  ❌ Build event emitter     │
│  ✅ verbose: true              │  ❌ console.log everywhere  │
└─────────────────────────────────────────────────────────────┘
```

**TUL gives you:**
```typescript
const result = await tul.chat('Calculate 15 * 7 + 23');

console.log(result.stats.toolCallsMade);  // 1
console.log(result.stats.tokensSaved);    // 0
console.log(result.stats.cacheHits);      // 0
console.log(result.stats.retries);        // 0

// Events
tul.on(event => {
  if (event.type === 'tool:call') console.log(`Calling ${event.name}`);
  if (event.type === 'tool:result') console.log(`Result: ${event.result}`);
});
```

---

### Test 5: Result Caching

> **Task**: Make 3 identical expensive API calls

```
┌─────────────────────────────────────────────────────────────┐
│  📦 TUL SDK                    │  🔧 Raw Gemini              │
├─────────────────────────────────────────────────────────────┤
│  🔥 1st call: API executed     │  💸 1st call: API executed  │
│  ⚡ 2nd call: CACHED           │  💸 2nd call: API executed  │
│  ⚡ 3rd call: CACHED           │  💸 3rd call: API executed  │
│                                │                              │
│  Total API calls: 1 ✅         │  Total API calls: 3 💀      │
└─────────────────────────────────────────────────────────────┘
```

```typescript
// TUL: Built-in caching
const tul = new Tul({
  resultCaching: true,
  cacheTTL: 60000, // 1 minute
});
// Identical tool calls are automatically cached.
```

---

## 📊 Summary

```
┌─────────────────────┬────────────────────────┬────────────────────────┐
│ Feature             │ Raw Gemini             │ TUL SDK                │
├─────────────────────┼────────────────────────┼────────────────────────┤
│ Multi-step workflow │ 😤 Manual (~40 LOC)    │ ✅ Automatic           │
│ Error handling      │ 😤 DIY try/catch       │ ✅ Auto-retry          │
│ Schema validation   │ 💀 Runtime crash       │ ✅ Graceful handling   │
│ Debugging/Stats     │ 😤 DIY (~100 LOC)      │ ✅ Built-in            │
│ Caching             │ 😤 Build yourself      │ ✅ Built-in + TTL      │
│ Loop detection      │ 😤 None                │ ✅ Automatic           │
│ Streaming           │ ⚠️ Manual              │ ✅ Built-in            │
│ Type safety         │ ⚠️ Partial             │ ✅ Full TypeScript     │
└─────────────────────┴────────────────────────┴────────────────────────┘

TUL = Less code, fewer bugs, better DX 🎉
```

---

## Raw Gemini vs tul-sdk

### Code Comparison

<table>
<tr>
<th>Raw Gemini API (~45 lines)</th>
<th>tul-sdk (4 lines)</th>
</tr>
<tr>
<td>

```typescript
const genAI = new GoogleGenAI({ apiKey });
const contents = [{ role: "user", parts: [...] }];

let response = await genAI.models.generateContent({
  model: "gemini-2.0-flash",
  contents,
  config: { tools: [...], toolConfig: {...} }
});

// Check for function calls
const parts = response.candidates?.[0]
  ?.content?.parts;
const functionCallParts = parts
  .filter(p => p.functionCall);

if (functionCallParts.length > 0) {
  // Execute tools manually
  const results = [];
  for (const part of functionCallParts) {
    const fc = part.functionCall;
    const result = await execute(fc);
    results.push({
      functionResponse: {
        name: fc.name,
        response: result
      }
    });
  }

  // Add to history
  contents.push({ role: "model", parts: ... });
  contents.push({ role: "user", parts: ... });

  // Make ANOTHER API call
  response = await genAI.models
    .generateContent({...});
}

// Extract text... handle errors... retry...
```

</td>
<td>

```typescript
const tul = new Tul({
  apiKey,
  model: "gemini-2.0-flash"
});

tul.registerTools(tools);

tul.onToolCall(async (name, args) => {
  return executeTool(name, args);
});

const response = await tul.chat(query);
// Done. Everything handled.
```

</td>
</tr>
</table>

### Feature Comparison

| Feature | Raw Gemini | tul-sdk |
|---------|:----------:|:-------:|
| Tool calling loop | ❌ Manual | ✅ Automatic |
| Error handling | ❌ Manual try/catch | ✅ Built-in + retry |
| Retry on failure | ❌ DIY | ✅ Configurable |
| Result caching | ❌ DIY | ✅ Built-in |
| Loop detection | ❌ None | ✅ Automatic |
| Tool filtering | ❌ None | ✅ Smart filtering |
| Slang understanding | ❌ None | ✅ "zap", "nuke", etc. |
| Token optimization | ❌ None | ✅ Auto-compression |
| Streaming support | ⚠️ Manual | ✅ Built-in |
| Type safety | ⚠️ Partial | ✅ Full TypeScript |
| Debug tools | ❌ None | ✅ explain/trace/diagnose |
| Chain-of-thought | ❌ DIY | ✅ Built-in |
| Validation | ❌ Manual | ✅ Zod schemas |
| Event system | ❌ None | ✅ Full events |

### Live Test Results (Gemini 2.0 Flash)

```
┌──────────────────────────────────────────────────────────────┐
│ BASIC TESTS (5/5 passed)                                     │
├──────────────────────────────────────────────────────────────┤
│ ✅ Weather in Tokyo      │ get_weather({"location":"Tokyo"}) │
│ ✅ Slang: "temp in NYC"  │ get_weather({"location":"NYC"})   │
│ ✅ Calculate 25 * 4 + 10 │ calculate({"expression":"..."})   │
│ ✅ AAPL stock price      │ get_stock_price({"symbol":"AAPL"})│
│ ✅ Multi-intent query    │ Called both tools correctly       │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│ ADVANCED TESTS (8/8 passed)                                  │
├──────────────────────────────────────────────────────────────┤
│ ✅ "Zap process 1234"        → kill_process                  │
│ ✅ "Nuke the cache"          → clear_cache                   │
│ ✅ "Fire up dev server"      → start_server                  │
│ ✅ "weathr in Paris" (typo)  → get_weather                   │
│ ✅ "GET THE WEATHER" (caps)  → get_weather                   │
│ ✅ "How hot is it?"          → get_weather                   │
│ ✅ "Find all .ts files"      → search_files                  │
│ ✅ "Spin up staging"         → start_server                  │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│ CHAIN-OF-THOUGHT (4/4 passed)                                │
├──────────────────────────────────────────────────────────────┤
│ ✅ All slang tests pass with CoT enabled                     │
│ ✅ All typo tests pass with CoT enabled                      │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│ CACHING                                                      │
├──────────────────────────────────────────────────────────────┤
│ ✅ First call: 910ms (no cache)                              │
│ ✅ Second call: Cache hit detected                           │
└──────────────────────────────────────────────────────────────┘

Overall: 17/17 tests (100% pass rate)
```

---

## Installation

```bash
npm install tul-sdk
# or
pnpm add tul-sdk
# or
yarn add tul-sdk
```

---

## Quick Start

```typescript
import { Tul } from 'tul-sdk';

// 1. Create client
const tul = new Tul({
  apiKey: process.env.GEMINI_API_KEY,
  model: 'gemini-2.0-flash',
});

// 2. Register tools
tul.registerTools([
  {
    name: 'get_weather',
    description: 'Get current weather for a location',
    parameters: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'City name' },
      },
      required: ['location'],
    },
  },
]);

// 3. Handle tool execution
tul.onToolCall(async (name, args) => {
  if (name === 'get_weather') {
    return { temp: 22, condition: 'sunny' };
  }
});

// 4. Chat!
const response = await tul.chat("What's the weather in Tokyo?");
console.log(response.text);
// "The weather in Tokyo is 22°C and sunny."
```

---

## Features

### Core Features

| Feature | Description |
|---------|-------------|
| **🔄 Automatic Tool Loop** | Handles multi-turn tool calling automatically |
| **🎯 Smart Tool Filtering** | Sends only relevant tools to reduce tokens |
| **💾 Result Caching** | Cache tool results to avoid duplicate calls |
| **🔁 Retry with Backoff** | Automatic retries on transient failures |
| **🛡️ Loop Detection** | Prevents infinite tool calling loops |
| **📡 Streaming Support** | Real-time streaming with tool calls |
| **📘 Full TypeScript** | Complete type safety and IntelliSense |

### Advanced Features

| Feature | Description |
|---------|-------------|
| **🧠 Chain-of-Thought** | Enable reasoning for complex queries |
| **💬 Slang Understanding** | "zap process", "nuke cache" → correct tools |
| **🚑 Error Recovery** | Intelligent error classification and recovery |
| **🔍 Debug Tools** | `explain()`, `trace()`, `diagnose()`, `inspect()` |
| **🔌 Middleware System** | Extensible request/response pipeline |
| **✅ Zod Validation** | Built-in schema validation |
| **📢 Event System** | Subscribe to tool:call, tool:result, tool:error, etc. |

---

## Configuration

```typescript
const tul = new Tul({
  // Required
  apiKey: 'your-api-key',

  // Model (default: gemini-2.0-flash)
  model: 'gemini-2.0-flash',

  // Tool Filtering
  toolFiltering: true,           // Enable smart filtering
  maxToolsPerRequest: 5,         // Max tools sent per request
  minToolsToSend: 3,             // Minimum tools guarantee
  confidenceThreshold: 0.5,      // Confidence threshold

  // Retry Configuration
  retryOnFailure: true,          // Enable retries
  maxRetries: 3,                 // Max retry attempts
  retryDelay: 'exponential',     // 'none' | 'linear' | 'exponential'

  // Caching
  resultCaching: true,           // Enable result caching
  cacheTTL: 300000,              // Cache TTL in ms (5 min)

  // Loop Detection
  loopDetection: true,           // Enable loop detection
  maxToolCallsPerTurn: 10,       // Max calls per turn
  maxIdenticalCalls: 3,          // Max identical calls
  onLoop: 'break',               // 'break' | 'warn'

  // Advanced
  enableChainOfThought: false,   // Enable CoT reasoning
  enhanceDescriptions: true,     // Auto-enhance descriptions
  forceToolCalling: 'auto',      // 'auto' | 'any' | 'none'

  // Logging
  verbose: false,
  logLevel: 'info',              // 'debug' | 'info' | 'warn' | 'error' | 'silent'
});
```

---

## API Reference

### Constructor
```typescript
new Tul(config: TulConfig)
```

### Methods

| Method | Description |
|--------|-------------|
| `chat(message: string)` | Send a message and get a response |
| `stream(message: string)` | Stream a response with real-time updates |
| `registerTools(tools)` | Register tool definitions |
| `onToolCall(handler)` | Set the tool execution handler |
| `on(listener)` | Subscribe to events |
| `getTools()` | Get registered tools |
| `getStats()` | Get usage statistics |
| `clearConversation()` | Clear conversation history |
| `explain(query)` | Debug: Explain tool selection |
| `trace(query)` | Debug: Trace request flow |
| `diagnose()` | Debug: Diagnose configuration |

### Response Object

```typescript
interface TulResponse {
  text: string;                    // Final response text
  toolCalls: ToolCallResult[];     // Tool calls made
  stats: RequestStats;             // Request statistics
  raw: unknown;                    // Raw Gemini response
  truncatedByLoop?: boolean;       // If truncated by loop detection
  warnings?: string[];             // Any warnings
  suggestedTools?: SuggestedTool[]; // Suggested but unused tools
}

interface ToolCallResult {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
  cached: boolean;
  retries: number;
}

interface RequestStats {
  inputTokens: number;
  outputTokens: number;
  tokensSaved: number;
  toolsFiltered: number;
  toolsSent: number;
  retries: number;
  cacheHits: number;
  loopDetected: boolean;
}
```

---

## Examples

### Streaming

```typescript
const stream = tul.stream('Explain quantum computing');

for await (const event of stream) {
  if (event.type === 'text') {
    process.stdout.write(event.text);
  } else if (event.type === 'tool:call') {
    console.log(`\nCalling tool: ${event.name}`);
  }
}
```

### Event Handling

```typescript
tul.on((event) => {
  switch (event.type) {
    case 'tool:call':
      console.log(`Calling: ${event.name}`);
      break;
    case 'tool:result':
      console.log(`Result: ${JSON.stringify(event.result)}`);
      break;
    case 'tool:error':
      console.error(`Error: ${event.error}`);
      break;
    case 'tool:retry':
      console.log(`Retrying (attempt ${event.attempt})`);
      break;
    case 'tool:cached':
      console.log(`Cache hit: ${event.name}`);
      break;
  }
});
```

### Debug Tools

```typescript
// Explain why tools were selected
const explanation = await tul.explain("What's the weather?");
console.log(explanation.reasoning);
console.log(explanation.selectedTools);

// Trace the full request flow
const trace = await tul.trace("Calculate 25 * 4");
console.log(trace.entries);

// Diagnose configuration issues
const diagnosis = tul.diagnose();
console.log(diagnosis.issues);
```

### Slang Support

```typescript
// All of these work correctly:
await tul.chat("Zap process 1234");        // → kill_process
await tul.chat("Nuke the cache");          // → clear_cache
await tul.chat("Fire up the dev server");  // → start_server
await tul.chat("What's the temp in NYC?"); // → get_weather
await tul.chat("weathr in tokyo");         // → get_weather (typos work!)
```

---

## Troubleshooting

### Model returns text instead of calling tools

```typescript
const tul = new Tul({
  forceToolCalling: true,  // Force tool calls
});

// Check suggested tools
const response = await tul.chat("...");
if (response.suggestedTools?.length > 0) {
  console.log('Should have called:', response.suggestedTools);
}
```

### Tool not being selected

```typescript
// Add aliases
tul.registerTools([{
  name: 'clear_cache',
  description: 'Clear the cache',
  aliases: ['nuke cache', 'delete cache', 'purge cache'],
}]);

// Or lower the threshold
const tul = new Tul({
  filterThreshold: 0.2,
  minToolsToSend: 5,
});
```

### Loop detected

```typescript
const tul = new Tul({
  maxToolCallsPerTurn: 15,  // Increase limit
  maxIdenticalCalls: 3,     // Allow more repeats
  onLoop: 'warn',           // Don't break, just warn
});
```

---

## Why "tul"?

**T**ool **U**tility **L**ayer - a thin wrapper that makes Gemini's tool calling actually work.

---

## License

MIT

---

<p align="center">
  <strong>🛠️ Built to make Gemini tool calling not suck.</strong>
</p>

<p align="center">
  <sub>Made with 🔥 by developers who got tired of writing boilerplate.</sub>
</p>
