/**
 * Basic Tul Usage Example
 *
 * This example demonstrates the simplest way to get started with Tul.
 * With zero config, Tul automatically optimizes tool calling for Gemini.
 */

import { Tul, ToolDefinition } from 'tul';

// Define your tools with standard JSON Schema
const tools: ToolDefinition[] = [
  {
    name: 'get_weather',
    description: 'Get current weather for a location',
    parameters: {
      type: 'object',
      properties: {
        location: {
          type: 'string',
          description: 'City name or coordinates',
        },
        units: {
          type: 'string',
          enum: ['celsius', 'fahrenheit'],
          description: 'Temperature units',
        },
      },
      required: ['location'],
    },
  },
  {
    name: 'search_restaurants',
    description: 'Search for restaurants near a location',
    parameters: {
      type: 'object',
      properties: {
        location: {
          type: 'string',
          description: 'Location to search near',
        },
        cuisine: {
          type: 'string',
          description: 'Type of cuisine (e.g., italian, japanese)',
        },
        price_range: {
          type: 'string',
          enum: ['$', '$$', '$$$', '$$$$'],
          description: 'Price range filter',
        },
      },
      required: ['location'],
    },
  },
  {
    name: 'book_reservation',
    description: 'Book a restaurant reservation',
    parameters: {
      type: 'object',
      properties: {
        restaurant_id: {
          type: 'string',
          description: 'Restaurant ID from search results',
        },
        party_size: {
          type: 'integer',
          minimum: 1,
          maximum: 20,
          description: 'Number of guests',
        },
        date: {
          type: 'string',
          pattern: '^\\d{4}-\\d{2}-\\d{2}$',
          description: 'Date in YYYY-MM-DD format',
        },
        time: {
          type: 'string',
          pattern: '^\\d{2}:\\d{2}$',
          description: 'Time in HH:MM format',
        },
      },
      required: ['restaurant_id', 'party_size', 'date', 'time'],
    },
  },
];

// Create a Tul client with minimal config
const tul = new Tul({
  apiKey: process.env.GOOGLE_AI_API_KEY!,
  model: 'gemini-2.5-flash',
  // All optimizations are enabled by default!
});

// Register tools
tul.registerTools(tools);

// Define tool handlers
const toolHandlers: Record<string, (args: Record<string, unknown>) => unknown> = {
  get_weather: (args) => {
    // In production, call a real weather API
    return {
      location: args.location,
      temperature: 72,
      units: args.units || 'fahrenheit',
      conditions: 'Partly cloudy',
      humidity: 45,
    };
  },
  search_restaurants: (args) => {
    // In production, call a restaurant search API
    return {
      results: [
        {
          id: 'rest-001',
          name: 'The Italian Place',
          cuisine: args.cuisine || 'Italian',
          rating: 4.5,
          price_range: args.price_range || '$$',
        },
        {
          id: 'rest-002',
          name: 'Sakura Japanese',
          cuisine: 'Japanese',
          rating: 4.8,
          price_range: '$$$',
        },
      ],
    };
  },
  book_reservation: (args) => {
    // In production, call a booking API
    return {
      confirmation_number: `RES-${Date.now()}`,
      restaurant_id: args.restaurant_id,
      party_size: args.party_size,
      date: args.date,
      time: args.time,
      status: 'confirmed',
    };
  },
};

async function main() {
  console.log('=== Basic Tul Usage ===\n');

  // Simple chat request - Tul handles everything automatically
  const response = await tul.chat(
    "What's the weather like in San Francisco?",
    async (name, args) => {
      const handler = toolHandlers[name];
      if (!handler) throw new Error(`Unknown tool: ${name}`);
      return handler(args);
    }
  );

  console.log('Response:', response.text);
  console.log('\nTool calls made:', response.toolCalls.length);
  console.log('Tokens saved:', response.stats.tokensSaved);

  // Multi-turn conversation with tool filtering
  console.log('\n--- Multi-turn conversation ---\n');

  const messages = [
    "I'm in Tokyo for dinner. Find me some nice restaurants.",
    "Book the second one for 4 people tomorrow at 7pm.",
  ];

  for (const message of messages) {
    console.log(`User: ${message}`);

    const resp = await tul.chat(
      message,
      async (name, args) => {
        const handler = toolHandlers[name];
        if (!handler) throw new Error(`Unknown tool: ${name}`);
        return handler(args);
      }
    );

    console.log(`Assistant: ${resp.text}\n`);
  }

  // View cumulative statistics
  const stats = tul.getStats();
  console.log('=== Session Statistics ===');
  console.log(`Total requests: ${stats.totalRequests}`);
  console.log(`Total tokens used: ${stats.totalInputTokens + stats.totalOutputTokens}`);
  console.log(`Tokens saved: ${stats.tokensSaved} (${stats.percentSaved.toFixed(1)}%)`);
  console.log(`Tool calls: ${stats.toolCallsMade}`);
  console.log(`Cache hits: ${stats.cacheHits}`);
}

main().catch(console.error);
