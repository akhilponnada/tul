/**
 * Tul Large Toolset Example
 *
 * This example demonstrates Tul's tool filtering capability.
 * When you have many tools, Tul intelligently selects only the
 * relevant ones for each request, dramatically reducing token usage.
 */

import { Tul, ToolDefinition } from 'tul';

// A large toolset simulating a comprehensive business application
const tools: ToolDefinition[] = [
  // User Management
  {
    name: 'create_user',
    description: 'Create a new user account',
    parameters: {
      type: 'object',
      properties: {
        email: { type: 'string' },
        name: { type: 'string' },
        role: { type: 'string', enum: ['user', 'admin', 'moderator'] },
      },
      required: ['email', 'name'],
    },
  },
  {
    name: 'update_user',
    description: 'Update user profile information',
    parameters: {
      type: 'object',
      properties: {
        user_id: { type: 'string' },
        updates: { type: 'object' },
      },
      required: ['user_id', 'updates'],
    },
  },
  {
    name: 'delete_user',
    description: 'Delete a user account',
    parameters: {
      type: 'object',
      properties: { user_id: { type: 'string' } },
      required: ['user_id'],
    },
  },
  {
    name: 'list_users',
    description: 'List all users with optional filters',
    parameters: {
      type: 'object',
      properties: {
        page: { type: 'integer' },
        limit: { type: 'integer' },
        role: { type: 'string' },
      },
    },
  },
  {
    name: 'get_user_permissions',
    description: 'Get permissions for a user',
    parameters: {
      type: 'object',
      properties: { user_id: { type: 'string' } },
      required: ['user_id'],
    },
  },

  // Order Management
  {
    name: 'create_order',
    description: 'Create a new customer order',
    parameters: {
      type: 'object',
      properties: {
        customer_id: { type: 'string' },
        items: { type: 'array', items: { type: 'object' } },
        shipping_address: { type: 'object' },
      },
      required: ['customer_id', 'items'],
    },
  },
  {
    name: 'update_order_status',
    description: 'Update the status of an order',
    parameters: {
      type: 'object',
      properties: {
        order_id: { type: 'string' },
        status: { type: 'string', enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled'] },
      },
      required: ['order_id', 'status'],
    },
  },
  {
    name: 'cancel_order',
    description: 'Cancel an existing order',
    parameters: {
      type: 'object',
      properties: {
        order_id: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['order_id'],
    },
  },
  {
    name: 'get_order_details',
    description: 'Get detailed information about an order',
    parameters: {
      type: 'object',
      properties: { order_id: { type: 'string' } },
      required: ['order_id'],
    },
  },
  {
    name: 'list_orders',
    description: 'List orders with filters',
    parameters: {
      type: 'object',
      properties: {
        customer_id: { type: 'string' },
        status: { type: 'string' },
        from_date: { type: 'string' },
        to_date: { type: 'string' },
      },
    },
  },

  // Inventory Management
  {
    name: 'check_inventory',
    description: 'Check inventory levels for products',
    parameters: {
      type: 'object',
      properties: {
        product_ids: { type: 'array', items: { type: 'string' } },
        warehouse_id: { type: 'string' },
      },
      required: ['product_ids'],
    },
  },
  {
    name: 'update_inventory',
    description: 'Update inventory counts',
    parameters: {
      type: 'object',
      properties: {
        product_id: { type: 'string' },
        quantity_change: { type: 'integer' },
        reason: { type: 'string' },
      },
      required: ['product_id', 'quantity_change'],
    },
  },
  {
    name: 'create_product',
    description: 'Create a new product in the catalog',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        sku: { type: 'string' },
        price: { type: 'number' },
        category: { type: 'string' },
      },
      required: ['name', 'sku', 'price'],
    },
  },
  {
    name: 'update_product',
    description: 'Update product information',
    parameters: {
      type: 'object',
      properties: {
        product_id: { type: 'string' },
        updates: { type: 'object' },
      },
      required: ['product_id', 'updates'],
    },
  },
  {
    name: 'list_products',
    description: 'List products with optional filters',
    parameters: {
      type: 'object',
      properties: {
        category: { type: 'string' },
        in_stock: { type: 'boolean' },
        min_price: { type: 'number' },
        max_price: { type: 'number' },
      },
    },
  },

  // Payment Processing
  {
    name: 'process_payment',
    description: 'Process a payment transaction',
    parameters: {
      type: 'object',
      properties: {
        order_id: { type: 'string' },
        amount: { type: 'number' },
        payment_method: { type: 'string' },
      },
      required: ['order_id', 'amount', 'payment_method'],
    },
  },
  {
    name: 'refund_payment',
    description: 'Process a refund for a payment',
    parameters: {
      type: 'object',
      properties: {
        payment_id: { type: 'string' },
        amount: { type: 'number' },
        reason: { type: 'string' },
      },
      required: ['payment_id'],
    },
  },
  {
    name: 'get_payment_history',
    description: 'Get payment history for a customer',
    parameters: {
      type: 'object',
      properties: {
        customer_id: { type: 'string' },
        from_date: { type: 'string' },
        to_date: { type: 'string' },
      },
      required: ['customer_id'],
    },
  },

  // Shipping & Logistics
  {
    name: 'create_shipment',
    description: 'Create a shipment for an order',
    parameters: {
      type: 'object',
      properties: {
        order_id: { type: 'string' },
        carrier: { type: 'string', enum: ['ups', 'fedex', 'usps', 'dhl'] },
        service_level: { type: 'string' },
      },
      required: ['order_id', 'carrier'],
    },
  },
  {
    name: 'track_shipment',
    description: 'Get tracking information for a shipment',
    parameters: {
      type: 'object',
      properties: { tracking_number: { type: 'string' } },
      required: ['tracking_number'],
    },
  },
  {
    name: 'update_shipping_address',
    description: 'Update shipping address for an order',
    parameters: {
      type: 'object',
      properties: {
        order_id: { type: 'string' },
        address: { type: 'object' },
      },
      required: ['order_id', 'address'],
    },
  },
  {
    name: 'get_shipping_rates',
    description: 'Get shipping rate quotes',
    parameters: {
      type: 'object',
      properties: {
        origin: { type: 'object' },
        destination: { type: 'object' },
        weight: { type: 'number' },
        dimensions: { type: 'object' },
      },
      required: ['origin', 'destination', 'weight'],
    },
  },

  // Analytics & Reporting
  {
    name: 'get_sales_report',
    description: 'Generate a sales report',
    parameters: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['day', 'week', 'month', 'quarter', 'year'] },
        from_date: { type: 'string' },
        to_date: { type: 'string' },
        group_by: { type: 'string' },
      },
      required: ['period'],
    },
  },
  {
    name: 'get_customer_analytics',
    description: 'Get customer behavior analytics',
    parameters: {
      type: 'object',
      properties: {
        metric: { type: 'string', enum: ['retention', 'ltv', 'churn', 'acquisition'] },
        segment: { type: 'string' },
      },
      required: ['metric'],
    },
  },
  {
    name: 'get_inventory_report',
    description: 'Generate an inventory status report',
    parameters: {
      type: 'object',
      properties: {
        warehouse_id: { type: 'string' },
        include_low_stock: { type: 'boolean' },
        category: { type: 'string' },
      },
    },
  },

  // Communication
  {
    name: 'send_email',
    description: 'Send an email to a customer',
    parameters: {
      type: 'object',
      properties: {
        to: { type: 'string' },
        subject: { type: 'string' },
        body: { type: 'string' },
        template_id: { type: 'string' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'send_sms',
    description: 'Send an SMS notification',
    parameters: {
      type: 'object',
      properties: {
        phone: { type: 'string' },
        message: { type: 'string' },
      },
      required: ['phone', 'message'],
    },
  },
  {
    name: 'create_support_ticket',
    description: 'Create a customer support ticket',
    parameters: {
      type: 'object',
      properties: {
        customer_id: { type: 'string' },
        subject: { type: 'string' },
        description: { type: 'string' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
      },
      required: ['customer_id', 'subject', 'description'],
    },
  },

  // System Administration
  {
    name: 'get_system_health',
    description: 'Check system health status',
    parameters: {
      type: 'object',
      properties: {
        services: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'get_audit_logs',
    description: 'Retrieve audit logs',
    parameters: {
      type: 'object',
      properties: {
        user_id: { type: 'string' },
        action: { type: 'string' },
        from_date: { type: 'string' },
        to_date: { type: 'string' },
      },
    },
  },
];

// Create Tul client with tool filtering
const tul = new Tul({
  apiKey: process.env.GOOGLE_AI_API_KEY!,
  model: 'gemini-2.5-flash',

  // Tool filtering configuration
  toolFiltering: true,
  maxToolsPerRequest: 5, // Only send top 5 most relevant tools
  filterThreshold: 0.3, // Minimum relevance score

  // Tools that should always be included (if needed)
  alwaysIncludeTools: [], // e.g., ['get_system_health'] for monitoring

  // Also enable compression for extra savings
  schemaCompression: true,
  compressionLevel: 'moderate',

  verbose: true, // See filtering in action
  logLevel: 'info',
});

tul.registerTools(tools);
console.log(`Registered ${tools.length} tools\n`);

// Generic handler for demo
const handler = async (name: string, args: Record<string, unknown>) => {
  return { success: true, tool: name, args, timestamp: new Date().toISOString() };
};

async function main() {
  console.log('=== Large Toolset Example ===\n');
  console.log(`Total tools registered: ${tools.length}`);
  console.log('Tul will filter to only the most relevant tools per request.\n');

  // Request about orders - should select order-related tools
  console.log('1. Order-related query:\n');
  const orderResponse = await tul.chat(
    'What is the status of order ORD-12345?',
    handler
  );
  console.log('Response:', orderResponse.text);
  console.log(`Tools filtered: ${orderResponse.stats.toolsFiltered}/${tools.length}`);
  console.log(`Tools sent: ${orderResponse.stats.toolsSent}`);

  // Request about inventory - should select inventory tools
  console.log('\n2. Inventory query:\n');
  const inventoryResponse = await tul.chat(
    'Check if product SKU-789 is in stock at the main warehouse.',
    handler
  );
  console.log('Response:', inventoryResponse.text);
  console.log(`Tools filtered: ${inventoryResponse.stats.toolsFiltered}/${tools.length}`);
  console.log(`Tools sent: ${inventoryResponse.stats.toolsSent}`);

  // Request about analytics - should select analytics tools
  console.log('\n3. Analytics query:\n');
  const analyticsResponse = await tul.chat(
    'Generate a sales report for last month.',
    handler
  );
  console.log('Response:', analyticsResponse.text);
  console.log(`Tools filtered: ${analyticsResponse.stats.toolsFiltered}/${tools.length}`);
  console.log(`Tools sent: ${analyticsResponse.stats.toolsSent}`);

  // Multi-domain request - should select tools from multiple categories
  console.log('\n4. Multi-domain query:\n');
  const multiResponse = await tul.chat(
    'Create a shipment for order ORD-999 using FedEx and send the customer an email with tracking info.',
    handler
  );
  console.log('Response:', multiResponse.text);
  console.log(`Tools filtered: ${multiResponse.stats.toolsFiltered}/${tools.length}`);
  console.log(`Tools sent: ${multiResponse.stats.toolsSent}`);

  // Show cumulative statistics
  const stats = tul.getStats();
  console.log('\n=== Cumulative Statistics ===');
  console.log(`Total requests: ${stats.totalRequests}`);
  console.log(`Average tools per request: ${stats.avgToolsPerRequest.toFixed(1)} (out of ${tools.length})`);
  console.log(`Total tools filtered out: ${stats.totalToolsFiltered}`);
  console.log(`Tokens saved: ${stats.tokensSaved} (${stats.percentSaved.toFixed(1)}%)`);
  console.log(`Tool calls made: ${stats.toolCallsMade}`);

  // Calculate estimated savings
  const tokensPerTool = 150; // Rough estimate
  const baselineTokensForTools = tools.length * tokensPerTool * stats.totalRequests;
  const actualTokensForTools = stats.avgToolsPerRequest * tokensPerTool * stats.totalRequests;
  const toolTokensSaved = baselineTokensForTools - actualTokensForTools;

  console.log(`\nEstimated tool schema token savings: ~${toolTokensSaved.toLocaleString()} tokens`);
  console.log(`(Sending all ${tools.length} tools vs. avg ${stats.avgToolsPerRequest.toFixed(1)} per request)`);
}

main().catch(console.error);
