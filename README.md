<p align="center">
  <img src="https://img.shields.io/npm/v/tul-sdk?style=for-the-badge&color=blue" alt="npm version" />
  <img src="https://img.shields.io/npm/dm/tul-sdk?style=for-the-badge&color=green" alt="downloads" />
  <img src="https://img.shields.io/npm/l/tul-sdk?style=for-the-badge" alt="license" />
  <img src="https://img.shields.io/badge/TypeScript-Ready-blue?style=for-the-badge&logo=typescript" alt="typescript" />
</p>

<h1 align="center">tul-sdk</h1>

<p align="center">
  <strong>Claude-level tool calling for Gemini. 70% fewer tokens. 97% accuracy.</strong>
</p>

<p align="center">
  <a href="#installation">Installation</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#benchmarks">Benchmarks</a> •
  <a href="#features">Features</a> •
  <a href="#api">API</a>
</p>

---

## The Problem

Raw Gemini API has issues with tool calling:

| Issue | What Happens |
|-------|--------------|
| **Token waste** | Sends ALL tools with every request |
| **Returns NONE** | Says "I can't help" when tools exist |
| **Poor descriptions** | Doesn't understand vague tool names |
| **Slang confusion** | "zap the process" → ??? |

## The Solution

```bash
npm install tul-sdk
```

```typescript
import { Tul } from 'tul-sdk';

const tul = new Tul({
  apiKey: process.env.GEMINI_API_KEY,
  forceToolCalling: true,      // No more empty responses
  enhanceDescriptions: true,   // Auto-improve tool descriptions
});

tul.registerTools([{ name: 'get_weather', description: 'Get weather', parameters: {...} }]);
tul.onToolCall(async (name, args) => { /* handle */ });

const response = await tul.chat("What's the weather in Tokyo?");
```

---

## Benchmarks

### Token Savings

```
┌─────────────────────────────────────────────────────────────┐
│                    TOKEN COMPARISON                          │
├─────────────────────────────────────────────────────────────┤
│  Raw Gemini    ████████████████████████████████  59,731     │
│  tul-sdk       ██████████                        18,066     │
│                                                              │
│  SAVED: 70% fewer tokens                                    │
└─────────────────────────────────────────────────────────────┘
```

### Accuracy (Adversarial Tests)

```
┌─────────────────────────────────────────────────────────────┐
│                 ACCURACY COMPARISON                          │
├─────────────────────────────────────────────────────────────┤
│  Raw Gemini    ██████████████████░░░░░░░░░░░░░░  67%        │
│  tul-sdk       █████████████████████████████░░░  97%        │
│                                                              │
│  +30% improvement on hard tests                             │
└─────────────────────────────────────────────────────────────┘
```

### Full Results

| Metric | Raw Gemini | tul-sdk | Improvement |
|--------|------------|---------|-------------|
| **Tokens Used** | 59,731 | 18,066 | **-70%** |
| **Accuracy** | 67% | 97% | **+30%** |
| **Latency** | 5.1s | 4.5s | **-12%** |
| **Empty Responses** | 33% | 3% | **-91%** |

---

## Features

### Force Tool Calling
No more "I can't help with that" when a matching tool exists.

```typescript
const tul = new Tul({
  forceToolCalling: true,  // Gemini MUST call a tool
});
```

### Auto-Enhance Descriptions
Poor tool descriptions? We fix them automatically.

```typescript
const tul = new Tul({
  enhanceDescriptions: true,  // Adds synonyms, trigger phrases
});

// Your description: "Kill a process"
// Enhanced: "Kill, terminate, stop, zap, end a running process..."
```

### Smart Tool Filtering
Only send relevant tools, not all 50 of them.

```typescript
const tul = new Tul({
  maxToolsPerRequest: 5,  // Send top 5 most relevant
});
```

### Retry Logic
First attempt filtered too aggressively? We retry with more tools.

```typescript
const tul = new Tul({
  retryWithExpandedTools: true,
});
```

### Slang Understanding
"Nuke the cache" → `clear_cache`
"Zap that process" → `kill_process`
"Fire up the server" → `start_server`

---

## Quick Start

### Installation

```bash
npm install tul-sdk @google/genai
```

### Basic Usage

```typescript
import { Tul } from 'tul-sdk';

const tul = new Tul({
  apiKey: process.env.GEMINI_API_KEY,
  model: 'gemini-2.0-flash',
});

// Register your tools
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

// Handle tool calls
tul.onToolCall(async (name, args) => {
  if (name === 'get_weather') {
    return { temp: 22, condition: 'sunny' };
  }
});

// Chat
const response = await tul.chat("What's the weather in Tokyo?");
console.log(response.text);
console.log(`Tokens saved: ${response.stats.tokensSaved}`);
```

### Optimal Configuration

```typescript
const tul = new Tul({
  apiKey: process.env.GEMINI_API_KEY,
  model: 'gemini-2.0-flash',

  // Accuracy boosters
  forceToolCalling: true,       // Force tool use
  enhanceDescriptions: true,    // Auto-improve descriptions
  retryWithExpandedTools: true, // Retry with more tools

  // Token savers
  maxToolsPerRequest: 8,        // Limit tools sent
  compressionLevel: 'moderate', // Compress schemas

  // Safety
  maxToolLoops: 5,              // Prevent infinite loops
});
```

---

## API Reference

### Constructor Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | required | Gemini API key |
| `model` | `string` | `'gemini-2.0-flash'` | Model name |
| `forceToolCalling` | `boolean \| 'auto'` | `false` | Force tool calls |
| `enhanceDescriptions` | `boolean` | `false` | Auto-enhance tool descriptions |
| `maxToolsPerRequest` | `number` | `5` | Max tools per request |
| `retryWithExpandedTools` | `boolean` | `true` | Retry with more tools |
| `compressionLevel` | `'minimal' \| 'moderate' \| 'aggressive'` | `'moderate'` | Schema compression |
| `maxToolLoops` | `number` | `10` | Max tool call iterations |

### Methods

```typescript
// Register tools
tul.registerTools(tools: ToolDefinition[]): void

// Handle tool calls
tul.onToolCall(handler: (name, args) => Promise<any>): void

// Chat
tul.chat(message: string): Promise<TulResponse>

// Events
tul.on('tool:call', ({ name, args }) => void)
tul.on('tool:result', ({ name, result }) => void)
tul.on('tool:error', ({ name, error }) => void)
```

### Response Object

```typescript
interface TulResponse {
  text: string;              // Final response
  toolCalls: ToolCall[];     // Tools called
  stats: {
    inputTokens: number;
    outputTokens: number;
    tokensSaved: number;     // vs raw Gemini
    toolsFiltered: number;   // Tools not sent
  };
}
```

---

## Why "tul"?

**T**ool **U**tility **L**ayer - a thin wrapper that makes Gemini's tool calling actually work.

---

## License

MIT © [Akhil Ponnada](https://github.com/akhilponnada)

---

<p align="center">
  <strong>Built to make Gemini tool calling not suck.</strong>
</p>
