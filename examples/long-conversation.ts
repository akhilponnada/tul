/**
 * Tul Long Conversation Example
 *
 * This example demonstrates Tul's context management feature.
 * As conversations grow, Tul automatically compacts old context
 * to stay within token limits while preserving important information.
 */

import { Tul, ToolDefinition } from 'tul';

const tools: ToolDefinition[] = [
  {
    name: 'search_products',
    description: 'Search for products in the catalog',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        category: { type: 'string' },
        min_price: { type: 'number' },
        max_price: { type: 'number' },
        sort_by: { type: 'string', enum: ['relevance', 'price_asc', 'price_desc', 'rating'] },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_product_details',
    description: 'Get detailed information about a product',
    parameters: {
      type: 'object',
      properties: {
        product_id: { type: 'string' },
        include_reviews: { type: 'boolean' },
      },
      required: ['product_id'],
    },
  },
  {
    name: 'add_to_cart',
    description: 'Add a product to the shopping cart',
    parameters: {
      type: 'object',
      properties: {
        product_id: { type: 'string' },
        quantity: { type: 'integer', minimum: 1 },
        options: { type: 'object' },
      },
      required: ['product_id', 'quantity'],
    },
  },
  {
    name: 'get_cart',
    description: 'Get current shopping cart contents',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'apply_coupon',
    description: 'Apply a coupon code to the cart',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string' },
      },
      required: ['code'],
    },
  },
  {
    name: 'checkout',
    description: 'Start the checkout process',
    parameters: {
      type: 'object',
      properties: {
        shipping_address: { type: 'object' },
        payment_method: { type: 'string' },
      },
    },
  },
  {
    name: 'get_recommendations',
    description: 'Get personalized product recommendations',
    parameters: {
      type: 'object',
      properties: {
        based_on: { type: 'string', enum: ['cart', 'browsing_history', 'similar_users'] },
        limit: { type: 'integer' },
      },
    },
  },
];

// Create Tul client with context management enabled
const tul = new Tul({
  apiKey: process.env.GOOGLE_AI_API_KEY!,
  model: 'gemini-2.5-flash',

  // Context management configuration
  contextManagement: true,
  maxContextTokens: 80000, // Compact when approaching this limit
  turnsToKeepFull: 3, // Keep last 3 turns in full
  compactionStrategy: 'summarize', // 'summarize' | 'truncate' | 'drop'

  // Other features
  toolFiltering: true,
  maxToolsPerRequest: 4,
  resultCaching: true,
  loopDetection: true,

  verbose: true,
});

tul.registerTools(tools);

// Simulated shopping cart state
let cart: { items: Array<{ id: string; name: string; price: number; quantity: number }>; total: number } = {
  items: [],
  total: 0,
};

// Mock product database
const products: Record<string, { id: string; name: string; price: number; category: string; description: string }> = {
  'prod-001': { id: 'prod-001', name: 'Wireless Headphones', price: 149.99, category: 'electronics', description: 'Premium noise-canceling wireless headphones with 30hr battery life.' },
  'prod-002': { id: 'prod-002', name: 'Mechanical Keyboard', price: 89.99, category: 'electronics', description: 'RGB mechanical keyboard with Cherry MX switches.' },
  'prod-003': { id: 'prod-003', name: 'USB-C Hub', price: 49.99, category: 'electronics', description: '7-in-1 USB-C hub with HDMI, SD card, and ethernet.' },
  'prod-004': { id: 'prod-004', name: 'Laptop Stand', price: 39.99, category: 'accessories', description: 'Adjustable aluminum laptop stand for better ergonomics.' },
  'prod-005': { id: 'prod-005', name: 'Desk Lamp', price: 59.99, category: 'accessories', description: 'LED desk lamp with adjustable color temperature.' },
};

// Tool handlers
const handlers: Record<string, (args: Record<string, unknown>) => unknown> = {
  search_products: (args) => {
    const query = (args.query as string).toLowerCase();
    const results = Object.values(products).filter(
      (p) => p.name.toLowerCase().includes(query) || p.description.toLowerCase().includes(query)
    );
    return { results, total: results.length };
  },

  get_product_details: (args) => {
    const product = products[args.product_id as string];
    if (!product) return { error: 'Product not found' };
    return {
      ...product,
      in_stock: true,
      reviews: args.include_reviews ? [
        { rating: 5, comment: 'Great product!' },
        { rating: 4, comment: 'Good value for money.' },
      ] : undefined,
    };
  },

  add_to_cart: (args) => {
    const product = products[args.product_id as string];
    if (!product) return { error: 'Product not found' };
    const quantity = (args.quantity as number) || 1;
    cart.items.push({ id: product.id, name: product.name, price: product.price, quantity });
    cart.total += product.price * quantity;
    return { success: true, cart };
  },

  get_cart: () => cart,

  apply_coupon: (args) => {
    const code = args.code as string;
    if (code === 'SAVE20') {
      const discount = cart.total * 0.2;
      cart.total -= discount;
      return { success: true, discount, new_total: cart.total };
    }
    return { error: 'Invalid coupon code' };
  },

  checkout: () => ({
    checkout_url: `https://checkout.example.com/session-${Date.now()}`,
    cart,
    estimated_tax: cart.total * 0.08,
    estimated_total: cart.total * 1.08,
  }),

  get_recommendations: (args) => {
    return {
      recommendations: [
        { id: 'prod-003', name: 'USB-C Hub', price: 49.99 },
        { id: 'prod-004', name: 'Laptop Stand', price: 39.99 },
      ],
      based_on: args.based_on || 'cart',
    };
  },
};

async function main() {
  console.log('=== Long Conversation Example ===\n');
  console.log('Simulating a shopping session with multiple turns.\n');

  // Long conversation simulating a shopping session
  const conversation = [
    "Hi! I'm looking for some electronics for my home office setup.",
    'Can you search for headphones?',
    'Tell me more about the wireless headphones.',
    'That sounds good. Add it to my cart.',
    'What else do you recommend for a home office?',
    'Search for keyboard.',
    'Add the mechanical keyboard to my cart.',
    'What is in my cart now?',
    'Can you also find me a good desk lamp?',
    'Add the desk lamp to my cart.',
    'Actually, do you have any laptop accessories?',
    'Show me details on the laptop stand.',
    "Add the laptop stand and USB-C hub to my cart.",
    "What's my total now?",
    'I have a coupon code SAVE20. Can you apply it?',
    'Great! Show me my final cart.',
    'What other recommendations do you have based on my cart?',
    "I think I'm ready to checkout.",
  ];

  for (let i = 0; i < conversation.length; i++) {
    const message = conversation[i];
    console.log(`\n--- Turn ${i + 1} ---`);
    console.log(`User: ${message}`);

    const response = await tul.chat(
      message,
      async (name, args) => handlers[name](args)
    );

    console.log(`Assistant: ${response.text}`);

    // Show context management stats periodically
    if ((i + 1) % 5 === 0 || i === conversation.length - 1) {
      console.log(`\n[Context Stats] Tokens saved by compaction: ${response.stats.contextCompactionSaved}`);
    }
  }

  // Final statistics
  const stats = tul.getStats();
  console.log('\n=== Conversation Statistics ===');
  console.log(`Total turns: ${stats.totalRequests}`);
  console.log(`Total input tokens: ${stats.totalInputTokens.toLocaleString()}`);
  console.log(`Total output tokens: ${stats.totalOutputTokens.toLocaleString()}`);
  console.log(`Tokens saved: ${stats.tokensSaved.toLocaleString()} (${stats.percentSaved.toFixed(1)}%)`);
  console.log(`Tool calls made: ${stats.toolCallsMade}`);
  console.log(`Cache hits: ${stats.cacheHits}`);
  console.log(`Loops prevented: ${stats.loopsPrevented}`);
}

main().catch(console.error);
