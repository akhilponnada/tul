/**
 * Tul Tool Filter Middleware
 * Smart tool filtering to reduce token usage by selecting only relevant tools per request
 */

import type {
  Middleware,
  RequestContext,
  InternalToolDefinition,
} from '../types/index.js';
import {
  fuzzyMatch,
  keywordOverlap,
  removeStopwords,
  tokenize,
  semanticSimilarity,
  diceCoefficient,
  semanticWordSimilarity,
} from '../utils/helpers.js';
import { preprocessQuery, ACTION_VERBS } from '../utils/query-preprocessor.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Scored tool with relevance breakdown
 */
export interface ScoredTool {
  tool: InternalToolDefinition;
  score: number;
  breakdown: {
    nameScore: number;
    descriptionScore: number;
    paramScore: number;
    semanticScore: number;
    recentBoost: number;
  };
}

/**
 * Filter configuration options
 */
export interface ToolFilterConfig {
  maxToolsPerRequest: number;
  filterThreshold: number;
  alwaysIncludeTools: string[];
  recentlyUsedTools: string[];
  /** Minimum number of tools to always send, even if filtering removes them. Default: 3 */
  minToolsToSend?: number;
}

/** Default minimum tools to send to prevent over-filtering */
const DEFAULT_MIN_TOOLS_TO_SEND = 3;

// ═══════════════════════════════════════════════════════════════════════════════
// Scoring Weights
// ═══════════════════════════════════════════════════════════════════════════════

const WEIGHT_NAME = 0.35;
const WEIGHT_DESCRIPTION = 0.35;
const WEIGHT_PARAMS = 0.15;
const WEIGHT_SEMANTIC = 0.15; // Semantic similarity weight
const WEIGHT_INTENT = 0.5; // Intent patterns get high weight
const RECENT_TOOL_BOOST = 0.3;
const CATEGORY_MATCH_BOOST = 0.6; // Boost for tools matching detected category

// ═══════════════════════════════════════════════════════════════════════════════
// Category Detection
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Category keywords that map to category names
 * When a query contains these keywords, all tools in that category get a boost
 */
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  // Authentication category
  'auth': ['log in', 'login', 'sign in', 'signin', 'authenticate', 'log out', 'logout', 'sign out', 'signout', 'password', 'credentials', 'session', 'token', 'auth', 'oauth', '2fa', 'mfa', 'verify identity'],

  // File operations category
  'files': ['file', 'files', 'upload', 'download', 'document', 'attachment', 'read file', 'write file', 'save', 'open', 'folder', 'directory', 'path', 'filename', 'extension', 'copy', 'move', 'rename'],

  // Data operations category
  'data': ['data', 'database', 'query', 'fetch', 'retrieve', 'store', 'save data', 'load', 'export', 'import', 'record', 'entry', 'table', 'row', 'column', 'sql', 'nosql', 'crud'],

  // Messaging category
  'messaging': ['message', 'send', 'email', 'mail', 'notify', 'notification', 'sms', 'text', 'chat', 'communicate', 'alert', 'push', 'inbox', 'outbox', 'compose'],

  // System operations category
  'system': ['system', 'config', 'configuration', 'settings', 'preferences', 'admin', 'manage', 'process', 'service', 'restart', 'shutdown', 'reboot', 'status', 'health', 'memory', 'cpu', 'disk'],

  // Cart/shopping category
  'cart': ['cart', 'basket', 'shopping', 'add to cart', 'remove from cart', 'checkout', 'purchase', 'buy', 'order', 'item', 'quantity', 'total', 'subtotal'],

  // User management category
  'users': ['user', 'account', 'profile', 'register', 'signup', 'member', 'permission', 'role', 'access', 'group', 'team', 'organization', 'invite', 'ban', 'block'],

  // Search category
  'search': ['search', 'find', 'lookup', 'query', 'filter', 'browse', 'explore', 'discover', 'list', 'enumerate', 'show all'],

  // Payment category
  'payment': ['pay', 'payment', 'charge', 'refund', 'invoice', 'billing', 'transaction', 'credit', 'debit', 'subscription', 'stripe', 'paypal', 'wallet', 'balance'],

  // Analytics category
  'analytics': ['analytics', 'stats', 'statistics', 'report', 'dashboard', 'metrics', 'track', 'monitor', 'insight', 'chart', 'graph', 'trend', 'kpi'],

  // Navigation/Maps category
  'navigation': ['directions', 'navigate', 'route', 'map', 'location', 'gps', 'distance', 'travel', 'commute', 'walk', 'drive', 'transit'],

  // Weather category
  'weather': ['weather', 'temperature', 'forecast', 'rain', 'snow', 'sunny', 'cloudy', 'humidity', 'wind', 'climate'],

  // Calendar/Scheduling category
  'calendar': ['calendar', 'schedule', 'event', 'meeting', 'appointment', 'booking', 'reservation', 'reminder', 'agenda', 'availability'],

  // Translation/Language category
  'translation': ['translate', 'translation', 'language', 'localize', 'internationalize', 'convert text', 'multilingual'],

  // Media category
  'media': ['image', 'photo', 'picture', 'video', 'audio', 'media', 'upload image', 'generate image', 'resize', 'crop', 'thumbnail'],

  // API/Integration category
  'api': ['api', 'endpoint', 'webhook', 'integration', 'connect', 'http', 'rest', 'graphql', 'request', 'response'],
};

/**
 * Detect which categories match the user message
 * Returns array of matched category names
 */
function detectCategories(userMessage: string): string[] {
  const lowerMessage = userMessage.toLowerCase();
  const matchedCategories: string[] = [];

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const keyword of keywords) {
      if (lowerMessage.includes(keyword.toLowerCase())) {
        if (!matchedCategories.includes(category)) {
          matchedCategories.push(category);
        }
        break;
      }
    }
  }

  return matchedCategories;
}

/**
 * Check if a tool belongs to any of the matched categories
 */
function toolMatchesCategories(tool: InternalToolDefinition, matchedCategories: string[]): boolean {
  if (!tool.category || matchedCategories.length === 0) {
    return false;
  }
  return matchedCategories.includes(tool.category.toLowerCase());
}

// ═══════════════════════════════════════════════════════════════════════════════
// Intent Patterns & Synonyms
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Intent patterns that map phrases/patterns to tool names
 * These catch common phrasing that keyword matching misses
 */
const INTENT_PATTERNS: Array<{ pattern: RegExp; tools: string[]; boost: number }> = [
  // Directions/Navigation
  { pattern: /\b(get|go|travel|walk|drive|directions?|route|navigate)\b.*\b(from|to)\b/i, tools: ['get_directions', 'directions'], boost: 0.8 },
  { pattern: /\b(from)\b.*\b(to)\b.*\b(by|on|via)\s*(foot|walk|car|bus|train|transit|bike)/i, tools: ['get_directions', 'directions'], boost: 0.9 },
  { pattern: /\bhow\s+(do\s+i\s+)?(get|go)\s+(to|from)/i, tools: ['get_directions', 'directions'], boost: 0.8 },
  { pattern: /\b(walking|driving|biking|cycling)\s+(directions?|route)/i, tools: ['get_directions', 'directions'], boost: 0.9 },

  // Weather
  { pattern: /\b(weather|temperature|forecast|rain|sunny|cloudy|cold|hot|warm)\b/i, tools: ['get_weather', 'get_current_weather', 'weather'], boost: 0.8 },
  { pattern: /\bwhat('s|\s+is)\s+(the\s+)?(weather|temperature)/i, tools: ['get_weather', 'get_current_weather', 'weather'], boost: 0.9 },

  // Currency
  { pattern: /\b(convert|exchange)\b.*\b(currency|USD|EUR|GBP|JPY|money|dollars?|euros?|pounds?|yen)\b/i, tools: ['convert_currency', 'currency'], boost: 0.8 },
  { pattern: /\bhow\s+much\s+is\s+\d+\s*[A-Z]{3}\s+(in|to)\b/i, tools: ['convert_currency', 'currency'], boost: 0.9 },
  { pattern: /\b\d+\s*(USD|EUR|GBP|JPY|dollars?|euros?|pounds?|yen)\s+(in|to)\b/i, tools: ['convert_currency', 'currency'], boost: 0.9 },

  // Calendar/Events
  { pattern: /\b(schedule|book|create|add|set)\b.*\b(meeting|appointment|event|calendar|reminder)\b/i, tools: ['create_calendar_event', 'calendar', 'schedule'], boost: 0.8 },
  { pattern: /\b(meeting|appointment)\b.*\b(on|at|for)\b.*\b(date|time|\d)/i, tools: ['create_calendar_event', 'calendar'], boost: 0.7 },

  // Email
  { pattern: /\b(send|write|compose|email|mail)\b.*\b(to|email|message)\b/i, tools: ['send_email', 'email'], boost: 0.8 },

  // Todo/Tasks
  { pattern: /\b(add|create|make|set)\b.*\b(todo|task|reminder|to-do)\b/i, tools: ['manage_todo', 'todo', 'task'], boost: 0.8 },
  { pattern: /\b(todo|task|to-do)\b.*\b(list|add|create|priority)\b/i, tools: ['manage_todo', 'todo'], boost: 0.8 },

  // Translation
  { pattern: /\b(translate|translation)\b/i, tools: ['translate_text', 'translate', 'translation'], boost: 0.9 },
  { pattern: /\b(in|to)\s+(japanese|spanish|french|german|chinese|korean|arabic|italian|portuguese)/i, tools: ['translate_text', 'translate'], boost: 0.6 },

  // Search/Products
  { pattern: /\b(search|find|look\s+for|buy|shop|purchase)\b.*\b(product|item|thing|stuff)\b/i, tools: ['search_products', 'search', 'products'], boost: 0.7 },
  { pattern: /\b(under|less\s+than|below)\s*[£$€]\s*\d+/i, tools: ['search_products', 'products'], boost: 0.6 },

  // Stock/Finance
  { pattern: /\b(stock|share|price|ticker)\b.*\b(of|for)?\s*[A-Z]{2,5}\b/i, tools: ['get_stock_price', 'stock', 'finance'], boost: 0.8 },
  { pattern: /\b(AAPL|GOOGL|MSFT|TSLA|AMZN|META|NVDA)\b/i, tools: ['get_stock_price', 'stock'], boost: 0.9 },

  // Math/Calculate
  { pattern: /\b(calculate|compute|math|add|subtract|multiply|divide|sum|total)\b/i, tools: ['calculate_math', 'calculate', 'math'], boost: 0.8 },
  { pattern: /\b\d+\s*[\+\-\*\/\^]\s*\d+/i, tools: ['calculate_math', 'calculate'], boost: 0.7 },

  // Web Search
  { pattern: /\b(search|google|look\s+up|find\s+info|research)\b.*\b(web|online|internet)\b/i, tools: ['search_web', 'web_search', 'search'], boost: 0.7 },

  // Image Generation
  { pattern: /\b(generate|create|make|draw)\b.*\b(image|picture|photo|art|illustration)\b/i, tools: ['generate_image', 'image', 'art'], boost: 0.8 },

  // Cart Operations (remove/delete from cart)
  { pattern: /\b(remove|delete|clear|empty)\b.*\b(from\s+)?(my\s+)?(cart|basket|bag)\b/i, tools: ['remove_from_cart', 'delete_cart_item', 'remove_item', 'cart', 'update_cart'], boost: 0.8 },
  { pattern: /\b(cart|basket|bag)\b.*\b(remove|delete|clear|empty)\b/i, tools: ['remove_from_cart', 'delete_cart_item', 'remove_item', 'cart'], boost: 0.8 },
  { pattern: /\b(take\s+out|get\s+rid\s+of)\b.*\b(cart|basket)\b/i, tools: ['remove_from_cart', 'remove_item', 'cart'], boost: 0.7 },
  { pattern: /\b(remove)\b.*\b(item|product|thing)\b.*\b(from\s+)?(my\s+)?(cart|basket)\b/i, tools: ['remove_item', 'remove_from_cart', 'cart'], boost: 0.9 },

  // Config Operations (modify/update config)
  { pattern: /\b(modify|update|change|edit|set|configure)\b.*\b(config|configuration|settings?|preferences?|options?)\b/i, tools: ['update_config', 'modify_config', 'config', 'settings', 'set_config'], boost: 0.8 },
  { pattern: /\b(config|configuration|settings?)\b.*\b(modify|update|change|edit|set)\b/i, tools: ['update_config', 'config', 'settings'], boost: 0.8 },

  // Password Operations (change password)
  { pattern: /\b(change|update|reset|modify|set)\b.*\b(password|passwd|pwd|credentials?)\b/i, tools: ['change_password', 'update_password', 'reset_password', 'password'], boost: 0.9 },
  { pattern: /\b(password|passwd|pwd)\b.*\b(change|update|reset|modify)\b/i, tools: ['change_password', 'update_password', 'password'], boost: 0.9 },
  { pattern: /\b(new\s+password|forgot\s+password)\b/i, tools: ['change_password', 'reset_password', 'password'], boost: 0.8 },

  // Authentication (login/authenticate)
  { pattern: /\b(log\s*in|sign\s*in|authenticate|auth)\b/i, tools: ['login', 'authenticate', 'sign_in', 'auth'], boost: 0.9 },
  { pattern: /\b(log\s*out|sign\s*out|logout)\b/i, tools: ['logout', 'sign_out', 'auth'], boost: 0.9 },
  { pattern: /\b(user|account)\b.*\b(authenticate|verify|validate)\b/i, tools: ['authenticate', 'login', 'verify_user'], boost: 0.8 },

  // Publishing (publish/post article)
  { pattern: /\b(publish|post|submit|release)\b.*\b(article|blog|post|content|story|news|draft)\b/i, tools: ['publish_article', 'post_article', 'publish', 'create_post'], boost: 0.9 },
  { pattern: /\b(article|blog|post|content|draft)\b.*\b(publish|post|submit|release)\b/i, tools: ['publish_article', 'post_article', 'publish'], boost: 0.9 },
  { pattern: /\b(make|set)\b.*\b(public|live|published)\b/i, tools: ['publish', 'publish_article'], boost: 0.7 },
  { pattern: /\b(my\s+)?(draft)\b/i, tools: ['publish_article', 'publish', 'draft'], boost: 0.6 },

  // Form Operations (submit form)
  { pattern: /\b(submit|send|post)\b.*\b(form|application|request|data)\b/i, tools: ['submit_form', 'send_form', 'form', 'submit'], boost: 0.9 },
  { pattern: /\b(form)\b.*\b(submit|send|post|fill)\b/i, tools: ['submit_form', 'form'], boost: 0.9 },
  { pattern: /\b(fill\s+out|complete)\b.*\b(form|application)\b/i, tools: ['submit_form', 'fill_form', 'form'], boost: 0.7 },
  { pattern: /\b(contact|registration|signup|sign-up|feedback)\s+(form)\b/i, tools: ['submit_form', 'form', 'contact'], boost: 0.8 },

  // Connection Operations (close connection)
  { pattern: /\b(close|disconnect|end|terminate|drop)\b.*\b(connection|socket|link|stream)\b/i, tools: ['close_connection', 'disconnect', 'connection', 'end_session'], boost: 0.9 },
  { pattern: /\b(connection|socket|link)\b.*\b(close|disconnect|end|terminate|drop)\b/i, tools: ['close_connection', 'disconnect', 'connection'], boost: 0.9 },
  { pattern: /\b(database|db)\s+(connection)\b/i, tools: ['close_connection', 'connection', 'database'], boost: 0.8 },

  // Session Operations (terminate session)
  { pattern: /\b(terminate|end|close|expire|invalidate)\b.*\b(session|sessions?)\b/i, tools: ['terminate_session', 'end_session', 'session', 'logout'], boost: 0.8 },
  { pattern: /\b(session)\b.*\b(terminate|end|close|expire|invalidate|kill)\b/i, tools: ['terminate_session', 'session'], boost: 0.8 },
  { pattern: /\b(session\s+timeout|session\s+expired)\b/i, tools: ['terminate_session', 'session'], boost: 0.7 },

  // Process Operations (kill/zap process)
  { pattern: /\b(kill|terminate|stop|end|zap|abort|cancel)\b.*\b(process|proc|job|task|worker|thread)\b/i, tools: ['kill_process', 'terminate_process', 'stop_process', 'process'], boost: 0.9 },
  { pattern: /\b(process|proc|job|task|worker)\b.*\b(kill|terminate|stop|end|zap|abort)\b/i, tools: ['kill_process', 'terminate_process', 'process'], boost: 0.9 },
  { pattern: /\b(pkill|sigkill|sigterm)\b/i, tools: ['kill_process', 'terminate_process'], boost: 0.9 },
  { pattern: /\b(force\s+quit|force\s+stop|force\s+close)\b/i, tools: ['kill_process', 'terminate_process', 'force_quit'], boost: 0.8 },
  { pattern: /\b(hung|frozen|stuck|unresponsive)\s+(process|proc|job|task|app|application)\b/i, tools: ['kill_process', 'terminate_process', 'force_quit'], boost: 0.9 },
  { pattern: /\bzap\b/i, tools: ['kill_process', 'terminate_process', 'stop_process'], boost: 0.7 },

  // File Operations
  { pattern: /\b(read|open|view|show|display)\b.*\b(file|content)\b/i, tools: ['read_file', 'get_file', 'open_file', 'file'], boost: 0.8 },
  { pattern: /\b(edit|modify|update|change)\b.*\b(document|readme|doc|file)\b/i, tools: ['edit_document', 'edit_file', 'modify_document', 'document'], boost: 0.9 },
  { pattern: /\b(document|readme|doc)\b.*\b(edit|modify|update|change)\b/i, tools: ['edit_document', 'edit_file', 'document'], boost: 0.9 },
  { pattern: /\b(write|save|create|make)\b.*\b(file|document)\b/i, tools: ['write_file', 'create_file', 'save_file', 'file'], boost: 0.8 },
  { pattern: /\b(delete|remove|trash)\b.*\b(file|document)\b/i, tools: ['delete_file', 'remove_file', 'file'], boost: 0.8 },
  { pattern: /\b(upload|download)\b.*\b(file|document|attachment)\b/i, tools: ['upload_file', 'download_file', 'file'], boost: 0.8 },

  // Database/Data Operations
  { pattern: /\b(query|select|find|get)\b.*\b(from|database|db|table|record)\b/i, tools: ['query_database', 'database', 'db', 'find_records'], boost: 0.8 },
  { pattern: /\b(insert|add|create)\b.*\b(into|database|db|table|record)\b/i, tools: ['insert_record', 'database', 'db', 'create_record'], boost: 0.8 },
  { pattern: /\b(update|modify)\b.*\b(database|db|table|record)\b/i, tools: ['update_record', 'database', 'db'], boost: 0.8 },
  { pattern: /\b(delete|remove)\b.*\b(from|database|db|table|record)\b/i, tools: ['delete_record', 'database', 'db'], boost: 0.8 },

  // Notification/Alert Operations
  { pattern: /\b(send|push|trigger)\b.*\b(notification|alert|message)\b/i, tools: ['send_notification', 'push_notification', 'notify', 'alert'], boost: 0.8 },
  { pattern: /\b(notify|alert)\b.*\b(user|admin|team)\b/i, tools: ['send_notification', 'notify', 'alert'], boost: 0.8 },

  // API/HTTP Operations
  { pattern: /\b(call|invoke|request|fetch)\b.*\b(api|endpoint|url|http)\b/i, tools: ['call_api', 'http_request', 'api', 'fetch'], boost: 0.8 },
  { pattern: /\b(get|post|put|delete|patch)\s+request\b/i, tools: ['http_request', 'api', 'call_api'], boost: 0.7 },

  // List/Enumerate Operations
  { pattern: /\b(list|show|get|fetch)\b.*\b(all|every)\b/i, tools: ['list', 'get_all', 'fetch_all', 'enumerate'], boost: 0.7 },
  { pattern: /\bwhat\s+(are|is)\s+(the|all|my)\b/i, tools: ['list', 'get', 'fetch'], boost: 0.6 },

  // Timer/Delay Operations
  { pattern: /\b(set|start|create)\b.*\b(timer|timeout|delay|alarm)\b/i, tools: ['set_timer', 'create_timer', 'schedule', 'timer'], boost: 0.8 },
  { pattern: /\b(remind|reminder)\b.*\b(me|in|at)\b/i, tools: ['set_reminder', 'reminder', 'schedule'], boost: 0.8 },

  // Export/Import Operations
  { pattern: /\b(export|download)\b.*\b(data|csv|json|pdf|report)\b/i, tools: ['export', 'export_data', 'download', 'generate_report'], boost: 0.8 },
  { pattern: /\b(import|upload)\b.*\b(data|csv|json|file)\b/i, tools: ['import', 'import_data', 'upload'], boost: 0.8 },

  // Validation/Check Operations
  { pattern: /\b(validate|verify|check)\b.*\b(email|phone|address|input|data)\b/i, tools: ['validate', 'verify', 'check'], boost: 0.7 },
  { pattern: /\bis\s+(this|it|the)\s+(valid|correct|right)\b/i, tools: ['validate', 'check', 'verify'], boost: 0.6 },
];

/**
 * Synonym expansions for common terms
 */
const SYNONYMS: Record<string, string[]> = {
  // Navigation
  'directions': ['route', 'way', 'path', 'navigate', 'navigation', 'go', 'get', 'travel'],
  'walking': ['foot', 'walk', 'on foot', 'by foot', 'pedestrian'],
  'driving': ['car', 'drive', 'by car', 'automobile'],
  'transit': ['bus', 'train', 'subway', 'metro', 'public transport', 'public transportation'],

  // Weather
  'weather': ['forecast', 'temperature', 'climate', 'conditions'],

  // Finance
  'convert': ['exchange', 'change', 'swap'],
  'currency': ['money', 'dollars', 'euros', 'pounds', 'yen'],

  // Time/Calendar
  'event': ['meeting', 'appointment', 'schedule', 'reminder'],
  'create': ['add', 'make', 'schedule', 'book', 'set'],

  // Tasks
  'todo': ['task', 'reminder', 'to-do', 'item'],
  'priority': ['urgent', 'important', 'high', 'low'],

  // Cart Operations
  'remove': ['delete', 'clear', 'empty', 'take out', 'get rid of'],
  'cart': ['basket', 'bag', 'shopping cart', 'shopping bag'],

  // Config/Settings
  'config': ['configuration', 'settings', 'preferences', 'options', 'setup'],
  'modify': ['update', 'change', 'edit', 'alter', 'adjust'],

  // Password/Auth
  'password': ['passwd', 'pwd', 'passphrase', 'credentials'],
  'login': ['sign in', 'log in', 'authenticate', 'auth'],
  'logout': ['sign out', 'log out', 'sign off'],

  // Publishing
  'publish': ['post', 'release', 'deploy', 'submit', 'go live'],
  'article': ['blog', 'post', 'content', 'story', 'news', 'draft'],
  'draft': ['article', 'post', 'content', 'unpublished'],

  // Form Operations
  'submit': ['send', 'post', 'transmit', 'upload'],
  'form': ['application', 'request', 'document'],

  // Connection/Session
  'close': ['disconnect', 'end', 'terminate', 'drop', 'shutdown'],
  'connection': ['socket', 'link', 'stream', 'channel'],
  'session': ['sessions', 'user session', 'active session'],

  // Process Operations
  'kill': ['terminate', 'stop', 'end', 'zap', 'abort', 'cancel', 'halt'],
  'process': ['proc', 'job', 'task', 'worker', 'thread', 'daemon'],

  // File Operations
  'file': ['document', 'attachment', 'archive', 'record'],
  'read': ['open', 'view', 'show', 'display', 'get', 'fetch', 'retrieve'],
  'write': ['save', 'store', 'create', 'make', 'generate'],
  'upload': ['send', 'push', 'transfer', 'submit'],
  'download': ['fetch', 'pull', 'retrieve', 'get'],

  // Database Operations
  'database': ['db', 'store', 'repository', 'datastore'],
  'query': ['select', 'find', 'search', 'lookup', 'fetch'],
  'insert': ['add', 'create', 'put', 'store', 'save'],
  'update': ['modify', 'change', 'edit', 'patch', 'set', 'alter', 'adjust'],
  'delete': ['remove', 'destroy', 'drop', 'erase', 'clear'],
  'change': ['modify', 'update', 'edit', 'alter', 'adjust', 'set'],
  'edit': ['modify', 'update', 'change', 'alter', 'revise'],

  // API Operations
  'api': ['endpoint', 'service', 'interface', 'rest', 'graphql'],
  'request': ['call', 'invoke', 'fetch', 'send'],

  // Notification Operations
  'notify': ['alert', 'inform', 'message', 'warn', 'remind'],
  'notification': ['alert', 'message', 'push', 'reminder'],

  // Generic Actions
  'get': ['fetch', 'retrieve', 'obtain', 'acquire', 'pull'],
  'list': ['show', 'display', 'enumerate', 'fetch all', 'get all'],
  'start': ['begin', 'launch', 'initiate', 'run', 'execute', 'fire up', 'spin up'],
  'stop': ['end', 'terminate', 'halt', 'cancel', 'abort', 'kill'],
};

/**
 * Expand a message with synonyms for better matching
 */
function expandWithSynonyms(message: string): string {
  let expanded = message.toLowerCase();

  for (const [term, synonyms] of Object.entries(SYNONYMS)) {
    for (const synonym of synonyms) {
      if (expanded.includes(synonym)) {
        expanded += ` ${term}`;
        break;
      }
    }
  }

  return expanded;
}

/**
 * Check if a name matches any of the target tools in intent patterns
 * Uses multiple matching strategies:
 * 1. Exact match (tool name equals target)
 * 2. Tool name contains target (e.g., "remove_item" contains "remove")
 * 3. Target contains tool name (e.g., "remove_from_cart" contains "remove")
 * 4. Tool name parts match target (e.g., "remove_item" has part "remove" matching target "remove")
 * 5. Normalized comparison (underscores removed)
 */
function nameMatchesIntentTarget(name: string, targetTools: string[]): boolean {
  const lowerName = name.toLowerCase();
  const normalizedName = lowerName.replace(/_/g, '');
  const nameParts = lowerName.split('_');

  for (const targetTool of targetTools) {
    const lowerTarget = targetTool.toLowerCase();
    const normalizedTarget = lowerTarget.replace(/_/g, '');

    // Exact match
    if (lowerName === lowerTarget) {
      return true;
    }

    // Tool name contains target or vice versa
    if (lowerName.includes(lowerTarget) || lowerTarget.includes(lowerName)) {
      return true;
    }

    // Normalized comparison
    if (normalizedName.includes(normalizedTarget) || normalizedTarget.includes(normalizedName)) {
      return true;
    }

    // Check if any part of the tool name matches the target
    // e.g., "remove_item" parts ["remove", "item"] - "remove" might match target "remove"
    for (const part of nameParts) {
      if (part.length >= 3) {  // Only check meaningful parts
        if (part === lowerTarget || lowerTarget.includes(part) || part.includes(lowerTarget)) {
          return true;
        }
      }
    }

    // Check if target parts match tool name parts
    const targetParts = lowerTarget.split('_');
    for (const targetPart of targetParts) {
      if (targetPart.length >= 3) {
        for (const namePart of nameParts) {
          if (namePart.length >= 3 && namePart === targetPart) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

/**
 * Check if message matches any intent patterns for a tool
 * Also checks against tool aliases if defined
 */
function getIntentScore(toolName: string, userMessage: string, aliases?: string[]): number {
  let maxScore = 0;

  for (const { pattern, tools, boost } of INTENT_PATTERNS) {
    if (pattern.test(userMessage)) {
      // Check if the primary tool name matches any of the pattern's target tools
      if (nameMatchesIntentTarget(toolName, tools)) {
        maxScore = Math.max(maxScore, boost);
      }

      // Also check aliases
      if (aliases && aliases.length > 0) {
        for (const alias of aliases) {
          if (nameMatchesIntentTarget(alias, tools)) {
            maxScore = Math.max(maxScore, boost);
            break;
          }
        }
      }
    }
  }

  return maxScore;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Scoring Functions
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calculate relevance score for a single name against expanded message
 */
function scoreNameMatch(name: string, expandedMessage: string): number {
  const lowerName = name.toLowerCase();

  // Direct name match in message (high signal)
  if (expandedMessage.includes(lowerName)) {
    return 1.0;
  }

  // Check name parts (e.g., "get_directions" -> ["get", "directions"])
  const nameParts = lowerName.split('_');
  for (const part of nameParts) {
    if (part.length > 3 && expandedMessage.includes(part)) {
      return 0.8;
    }
  }

  // Fuzzy match on name keywords
  return fuzzyMatch(expandedMessage, name);
}

/**
 * Calculate relevance score for tool name against user message
 * Also checks against tool aliases if defined
 */
function scoreToolName(toolName: string, userMessage: string, aliases?: string[]): number {
  // Expand message with synonyms for better matching
  const expandedMessage = expandWithSynonyms(userMessage);

  // Score the primary tool name
  let bestScore = scoreNameMatch(toolName, expandedMessage);

  // Also check aliases and take the best match
  if (aliases && aliases.length > 0) {
    for (const alias of aliases) {
      const aliasScore = scoreNameMatch(alias, expandedMessage);
      if (aliasScore > bestScore) {
        bestScore = aliasScore;
      }
    }
  }

  return bestScore;
}

/**
 * Calculate relevance score for tool description against user message
 */
function scoreToolDescription(description: string, userMessage: string): number {
  return keywordOverlap(userMessage, description);
}

/**
 * Calculate relevance score for tool parameters against user message
 */
function scoreToolParams(paramKeywords: string[], userMessage: string): number {
  if (paramKeywords.length === 0) {
    return 0;
  }

  const messageTokens = new Set(removeStopwords(tokenize(userMessage)));
  if (messageTokens.size === 0) {
    return 0;
  }

  let matches = 0;
  for (const paramKeyword of paramKeywords) {
    if (messageTokens.has(paramKeyword)) {
      matches += 1;
    } else {
      // Partial match
      for (const msgToken of Array.from(messageTokens)) {
        if (msgToken.includes(paramKeyword) || paramKeyword.includes(msgToken)) {
          matches += 0.5;
          break;
        }
      }
    }
  }

  return Math.min(1, matches / Math.min(paramKeywords.length, messageTokens.size));
}

/**
 * Calculate semantic similarity score between user message and tool
 * Uses multiple techniques: Dice coefficient, word-level stemming, and n-gram overlap
 * This provides better matching for paraphrased queries and word variations
 */
function scoreToolSemantic(tool: InternalToolDefinition, userMessage: string): number {
  // Combine tool name and description for semantic matching
  // Convert name from snake_case to readable text
  const toolText = `${tool.name.replace(/_/g, ' ')} ${tool.description}`;

  // Use semantic similarity with weights tuned for tool matching
  // Higher weight on word matching (better for tool-relevant keywords)
  const similarity = semanticSimilarity(userMessage, toolText, {
    dice: 0.2,   // Character-level similarity (catches typos/misspellings)
    word: 0.6,   // Word-level with stemming (most important for semantic matching)
    ngram: 0.2,  // Phrase-level matching (catches multi-word concepts)
  });

  // Also check aliases if present
  if (tool.aliases && tool.aliases.length > 0) {
    let bestAliasScore = 0;
    for (const alias of tool.aliases) {
      const aliasText = alias.replace(/_/g, ' ');
      const aliasScore = semanticSimilarity(userMessage, aliasText, {
        dice: 0.3,
        word: 0.5,
        ngram: 0.2,
      });
      if (aliasScore > bestAliasScore) {
        bestAliasScore = aliasScore;
      }
    }
    // Return the best of main tool text or alias similarity
    return Math.max(similarity, bestAliasScore);
  }

  return similarity;
}

/**
 * Calculate action verb match score
 * Checks if tool name/description matches action categories from the query
 */
function scoreActionVerbMatch(tool: InternalToolDefinition, actionCategories: string[]): number {
  if (actionCategories.length === 0) {
    return 0;
  }

  const lowerToolName = tool.name.toLowerCase();
  const lowerDescription = tool.description.toLowerCase();
  let matches = 0;

  for (const category of actionCategories) {
    const categoryVerbs = ACTION_VERBS[category] || [];
    for (const verb of categoryVerbs) {
      if (lowerToolName.includes(verb) || lowerDescription.includes(verb)) {
        matches++;
        break; // Count each category only once
      }
    }
  }

  return matches / actionCategories.length;
}

/**
 * Calculate combined relevance score for a tool
 * Uses query preprocessing to expand contractions and normalize slang
 */
function scoreTool(
  tool: InternalToolDefinition,
  userMessage: string,
  recentlyUsedTools: Set<string>,
  matchedCategories: string[] = [],
  preprocessed?: ReturnType<typeof preprocessQuery>
): ScoredTool {
  // Preprocess the query to expand contractions and normalize slang
  const { processed, actionCategories } = preprocessed || preprocessQuery(userMessage);

  // Expand message with synonyms (on preprocessed version for better coverage)
  const expandedMessage = expandWithSynonyms(processed);

  // Pass aliases to scoring functions for better matching
  const aliases = tool.aliases;
  const nameScore = scoreToolName(tool.name, processed, aliases);
  const descriptionScore = scoreToolDescription(tool.description, expandedMessage);
  const paramScore = scoreToolParams(tool.paramKeywords, expandedMessage);
  const semanticScore = scoreToolSemantic(tool, processed);
  const recentBoost = recentlyUsedTools.has(tool.name) ? RECENT_TOOL_BOOST : 0;

  // Check if tool matches any detected categories
  const categoryBoost = toolMatchesCategories(tool, matchedCategories) ? CATEGORY_MATCH_BOOST : 0;

  // Check intent patterns (on preprocessed message for better pattern matching)
  // Also check against aliases
  const intentScore = getIntentScore(tool.name, processed, aliases);

  // Check action verb category match
  const actionVerbScore = scoreActionVerbMatch(tool, actionCategories);

  // If intent pattern matches strongly, use it as the base score
  // Otherwise, use weighted combination of other scores
  let baseScore: number;
  if (intentScore >= 0.7) {
    // Strong intent match - use intent score directly
    baseScore = intentScore;
  } else {
    // Normal weighted scoring with semantic similarity
    baseScore =
      nameScore * WEIGHT_NAME +
      descriptionScore * WEIGHT_DESCRIPTION +
      paramScore * WEIGHT_PARAMS +
      semanticScore * WEIGHT_SEMANTIC;

    // Add partial intent boost if there's a weak match
    if (intentScore > 0) {
      baseScore = Math.max(baseScore, baseScore + intentScore * 0.3);
    }

    // Add action verb category boost (up to 0.2)
    if (actionVerbScore > 0) {
      baseScore = Math.min(1.0, baseScore + actionVerbScore * 0.2);
    }
  }

  // Apply recent boost and category boost (additive, capped at 1.0)
  const score = Math.min(1.0, baseScore + recentBoost + categoryBoost);

  return {
    tool,
    score,
    breakdown: {
      nameScore,
      descriptionScore,
      paramScore,
      semanticScore,
      recentBoost,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Filter Logic
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Filter tools based on relevance to user message
 */
function filterTools(
  tools: InternalToolDefinition[],
  userMessage: string,
  config: ToolFilterConfig
): { filtered: InternalToolDefinition[]; scoredTools: ScoredTool[] } {
  const { maxToolsPerRequest, filterThreshold, alwaysIncludeTools, recentlyUsedTools } = config;
  const minToolsToSend = config.minToolsToSend ?? DEFAULT_MIN_TOOLS_TO_SEND;

  // Build set for fast lookup
  const recentToolsSet = new Set(recentlyUsedTools);
  const alwaysIncludeSet = new Set(alwaysIncludeTools.map((t) => t.toLowerCase()));

  // Preprocess query once for efficiency (expands contractions, normalizes slang)
  const preprocessed = preprocessQuery(userMessage);

  // Detect message categories for category-based boosting
  const matchedCategories = detectCategories(preprocessed.processed);

  // Score all tools with preprocessed query
  const scoredTools = tools.map((tool) => scoreTool(tool, userMessage, recentToolsSet, matchedCategories, preprocessed));

  // Separate always-include tools and category-matched tools
  const alwaysIncludedTools: InternalToolDefinition[] = [];
  const categoryMatchedTools: InternalToolDefinition[] = [];
  const candidateTools: ScoredTool[] = [];

  for (const scored of scoredTools) {
    if (alwaysIncludeSet.has(scored.tool.name.toLowerCase())) {
      alwaysIncludedTools.push(scored.tool);
    } else if (toolMatchesCategories(scored.tool, matchedCategories)) {
      // Tools matching detected categories are always included
      categoryMatchedTools.push(scored.tool);
    } else {
      candidateTools.push(scored);
    }
  }

  // Sort candidates by score (descending)
  candidateTools.sort((a, b) => b.score - a.score);

  // Calculate remaining slots after always-include and category-matched tools
  const usedSlots = alwaysIncludedTools.length + categoryMatchedTools.length;
  const remainingSlots = Math.max(0, maxToolsPerRequest - usedSlots);

  // Filter by threshold and take top N from remaining candidates
  const passingTools = candidateTools.filter((t) => t.score >= filterThreshold);
  let selectedCandidates = passingTools.slice(0, remainingSlots).map((t) => t.tool);

  // Combine always-include + category-matched + selected candidates
  let filtered = [...alwaysIncludedTools, ...categoryMatchedTools, ...selectedCandidates];

  // Minimum tools guarantee: ensure at least minToolsToSend tools are sent
  // This prevents over-filtering that could cause tool calling failures
  if (filtered.length < minToolsToSend && candidateTools.length > 0) {
    const additionalNeeded = minToolsToSend - filtered.length;
    const existingNames = new Set(filtered.map((t) => t.name));

    // Add top-scoring tools that aren't already included
    let added = 0;
    for (const scored of candidateTools) {
      if (added >= additionalNeeded) break;
      if (!existingNames.has(scored.tool.name)) {
        filtered.push(scored.tool);
        existingNames.add(scored.tool.name);
        added++;
      }
    }
  }

  // Cap at maxToolsPerRequest
  if (filtered.length > maxToolsPerRequest) {
    filtered = filtered.slice(0, maxToolsPerRequest);
  }

  return { filtered, scoredTools };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Middleware Class
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Tool Filter Middleware
 *
 * Smart tool filtering to reduce token usage by selecting only relevant tools
 * per request. Uses weighted scoring based on:
 * - Tool name match (40%)
 * - Description relevance (40%)
 * - Parameter keyword match (20%)
 * - Recent usage boost (+30%)
 */
export class ToolFilterMiddleware implements Middleware {
  readonly name = 'tool-filter';
  enabled = true;

  /**
   * Filter tools before sending request to Gemini
   */
  async beforeRequest(context: RequestContext): Promise<RequestContext> {
    const { tools, userMessage, config, recentlyUsedTools } = context;

    // Skip if filtering is disabled
    if (!config.toolFiltering) {
      return {
        ...context,
        filteredTools: tools,
        stats: {
          ...context.stats,
          toolsFiltered: 0,
          toolsSent: tools.length,
        },
      };
    }

    // Skip if no tools or very few tools
    if (tools.length <= config.maxToolsPerRequest) {
      return {
        ...context,
        filteredTools: tools,
        stats: {
          ...context.stats,
          toolsFiltered: 0,
          toolsSent: tools.length,
        },
      };
    }

    // Perform filtering
    const { filtered } = filterTools(tools, userMessage, {
      maxToolsPerRequest: config.maxToolsPerRequest,
      filterThreshold: config.filterThreshold,
      alwaysIncludeTools: config.alwaysIncludeTools,
      recentlyUsedTools,
      minToolsToSend: config.minToolsToSend,
    });

    const toolsFiltered = tools.length - filtered.length;

    return {
      ...context,
      filteredTools: filtered,
      stats: {
        ...context.stats,
        toolsFiltered,
        toolsSent: filtered.length,
      },
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Factory Function
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a new tool filter middleware instance
 */
export function createToolFilterMiddleware(): ToolFilterMiddleware {
  return new ToolFilterMiddleware();
}

/**
 * Default middleware instance for convenience
 */
export const toolFilterMiddleware = createToolFilterMiddleware();

// ═══════════════════════════════════════════════════════════════════════════════
// Utility Exports (for testing and advanced usage)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Score a single tool against a user message
 * Exported for testing and advanced filtering scenarios
 */
export function scoreToolRelevance(
  tool: InternalToolDefinition,
  userMessage: string,
  recentlyUsedTools: string[] = []
): ScoredTool {
  return scoreTool(tool, userMessage, new Set(recentlyUsedTools));
}

/**
 * Filter tools with full configuration
 * Exported for testing and advanced filtering scenarios
 */
export function filterToolsByRelevance(
  tools: InternalToolDefinition[],
  userMessage: string,
  config: ToolFilterConfig
): { filtered: InternalToolDefinition[]; scoredTools: ScoredTool[] } {
  return filterTools(tools, userMessage, config);
}
