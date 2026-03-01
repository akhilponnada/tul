/**
 * Tul Query Preprocessor
 * Preprocesses user queries for better tool matching by expanding contractions,
 * normalizing slang, and extracting action verbs.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// Contraction Mappings
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Common English contractions mapped to their expanded forms
 */
const CONTRACTIONS: Record<string, string> = {
  // Will/Would
  "i'll": 'i will',
  "you'll": 'you will',
  "he'll": 'he will',
  "she'll": 'she will',
  "it'll": 'it will',
  "we'll": 'we will',
  "they'll": 'they will',
  "that'll": 'that will',
  "who'll": 'who will',
  "i'd": 'i would',
  "you'd": 'you would',
  "he'd": 'he would',
  "she'd": 'she would',
  "we'd": 'we would',
  "they'd": 'they would',

  // Have/Has
  "i've": 'i have',
  "you've": 'you have',
  "we've": 'we have',
  "they've": 'they have',
  "could've": 'could have',
  "would've": 'would have',
  "should've": 'should have',
  "might've": 'might have',
  "must've": 'must have',

  // Is/Are/Am
  "i'm": 'i am',
  "you're": 'you are',
  "he's": 'he is',
  "she's": 'she is',
  "it's": 'it is',
  "we're": 'we are',
  "they're": 'they are',
  "that's": 'that is',
  "what's": 'what is',
  "who's": 'who is',
  "where's": 'where is',
  "when's": 'when is',
  "why's": 'why is',
  "how's": 'how is',
  "here's": 'here is',
  "there's": 'there is',

  // Not
  "aren't": 'are not',
  "isn't": 'is not',
  "wasn't": 'was not',
  "weren't": 'were not',
  "haven't": 'have not',
  "hasn't": 'has not',
  "hadn't": 'had not',
  "won't": 'will not',
  "wouldn't": 'would not',
  "don't": 'do not',
  "doesn't": 'does not',
  "didn't": 'did not',
  "can't": 'cannot',
  "couldn't": 'could not',
  "shouldn't": 'should not',
  "mightn't": 'might not',
  "mustn't": 'must not',
  "needn't": 'need not',
  "shan't": 'shall not',

  // Other
  "let's": 'let us',
  "gonna": 'going to',
  "wanna": 'want to',
  "gotta": 'got to',
  "gimme": 'give me',
  "lemme": 'let me',
  "kinda": 'kind of',
  "sorta": 'sort of',
  "dunno": 'do not know',
  "y'all": 'you all',
  "ain't": 'is not',
};

// ═══════════════════════════════════════════════════════════════════════════════
// Slang Mappings
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Common tech/user slang mapped to standard terms
 * Maps informal language to action words that match tool descriptions
 */
const SLANG_MAPPINGS: Record<string, string[]> = {
  // Deletion/Removal slang
  'nuke': ['clear', 'delete', 'remove', 'destroy', 'wipe'],
  'zap': ['kill', 'terminate', 'stop', 'end', 'remove'],
  'yeet': ['remove', 'delete', 'throw', 'discard'],
  'axe': ['remove', 'delete', 'cut', 'cancel'],
  'trash': ['delete', 'remove', 'discard'],
  'ditch': ['remove', 'cancel', 'abandon', 'drop'],
  'wipe': ['clear', 'delete', 'remove', 'erase'],
  'purge': ['clear', 'delete', 'remove', 'clean'],
  'scrap': ['delete', 'discard', 'remove', 'cancel'],

  // Start/Launch slang
  'fire up': ['start', 'launch', 'begin', 'initialize', 'run'],
  'spin up': ['start', 'launch', 'create', 'initialize'],
  'boot up': ['start', 'launch', 'initialize', 'run'],
  'kick off': ['start', 'begin', 'launch', 'initiate'],
  'crank up': ['start', 'increase', 'boost', 'run'],

  // Stop/End slang
  'kill': ['stop', 'terminate', 'end', 'cancel'],
  'nix': ['cancel', 'stop', 'remove', 'reject'],
  'shut down': ['stop', 'terminate', 'close', 'end'],
  'pull the plug': ['stop', 'terminate', 'cancel', 'end'],
  'hung': ['frozen', 'stuck', 'unresponsive', 'kill', 'terminate'],
  'frozen': ['hung', 'stuck', 'kill', 'terminate'],
  'stuck': ['hung', 'frozen', 'kill', 'terminate'],

  // Get/Fetch slang
  'grab': ['get', 'fetch', 'retrieve', 'download'],
  'snag': ['get', 'capture', 'fetch', 'retrieve'],
  'pull': ['get', 'fetch', 'retrieve', 'download'],
  'yank': ['get', 'remove', 'pull', 'extract'],

  // Send/Push slang
  'blast': ['send', 'broadcast', 'email', 'message'],
  'shoot': ['send', 'transmit', 'email', 'message'],
  'ping': ['send', 'notify', 'contact', 'message', 'check'],
  'drop': ['send', 'deliver', 'post', 'release'],

  // Fix/Repair slang
  'patch': ['fix', 'repair', 'update', 'correct'],
  'tweak': ['adjust', 'modify', 'fix', 'tune', 'configure'],
  'hack': ['fix', 'modify', 'workaround', 'solve'],

  // Create/Make slang
  'whip up': ['create', 'make', 'generate', 'produce'],
  'cook up': ['create', 'make', 'generate', 'devise'],
  'throw together': ['create', 'make', 'assemble', 'build'],
  'bang out': ['create', 'write', 'produce', 'generate'],

  // Check/Verify slang
  'scope out': ['check', 'examine', 'inspect', 'view'],
  'eyeball': ['check', 'look', 'inspect', 'review'],
  'peek': ['look', 'check', 'view', 'preview'],
  'snoop': ['check', 'inspect', 'search', 'browse'],

  // Improve/Enhance slang
  'beef up': ['enhance', 'improve', 'strengthen', 'boost'],
  'juice up': ['enhance', 'boost', 'improve', 'energize'],
  'pimp out': ['enhance', 'customize', 'improve', 'upgrade'],
  'soup up': ['enhance', 'improve', 'upgrade', 'boost'],

  // Misc tech slang
  'sync': ['synchronize', 'update', 'connect', 'align'],
  'debug': ['fix', 'troubleshoot', 'diagnose', 'repair'],
  'deploy': ['release', 'publish', 'launch', 'push'],
  'rollback': ['revert', 'undo', 'restore', 'reset'],
};

// ═══════════════════════════════════════════════════════════════════════════════
// Action Verbs
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Common action verbs that indicate user intent
 * Organized by action category
 */
const ACTION_VERBS: Record<string, string[]> = {
  create: ['create', 'make', 'generate', 'build', 'add', 'new', 'compose', 'draft', 'write', 'produce'],
  read: ['get', 'fetch', 'read', 'retrieve', 'find', 'search', 'lookup', 'show', 'display', 'list', 'view', 'check'],
  update: ['update', 'edit', 'modify', 'change', 'set', 'adjust', 'configure', 'rename', 'replace', 'patch'],
  delete: ['delete', 'remove', 'clear', 'cancel', 'drop', 'destroy', 'wipe', 'purge', 'erase', 'unsubscribe'],
  send: ['send', 'email', 'message', 'notify', 'post', 'publish', 'share', 'broadcast', 'transmit', 'deliver'],
  start: ['start', 'begin', 'launch', 'run', 'execute', 'initialize', 'open', 'activate', 'enable', 'trigger'],
  stop: ['stop', 'end', 'terminate', 'close', 'cancel', 'halt', 'disable', 'pause', 'suspend', 'abort'],
  convert: ['convert', 'transform', 'translate', 'change', 'exchange', 'swap', 'format'],
  calculate: ['calculate', 'compute', 'count', 'sum', 'add', 'subtract', 'multiply', 'divide', 'measure'],
  navigate: ['navigate', 'go', 'travel', 'drive', 'walk', 'route', 'directions', 'find way'],
};

/**
 * Flat set of all action verbs for quick lookup
 */
const ALL_ACTION_VERBS = new Set(
  Object.values(ACTION_VERBS).flat()
);

// ═══════════════════════════════════════════════════════════════════════════════
// Preprocessing Functions
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Expand contractions in a query string
 * Example: "I'll delete the file" -> "I will delete the file"
 *
 * @param query - The user query to process
 * @returns The query with contractions expanded
 */
export function expandContractions(query: string): string {
  let result = query.toLowerCase();

  // Sort by length (descending) to match longer contractions first
  const sortedContractions = Object.entries(CONTRACTIONS).sort(
    (a, b) => b[0].length - a[0].length
  );

  for (const [contraction, expansion] of sortedContractions) {
    // Use word boundary regex to avoid partial matches
    const regex = new RegExp(`\\b${escapeRegex(contraction)}\\b`, 'gi');
    result = result.replace(regex, expansion);
  }

  return result;
}

/**
 * Normalize slang terms to standard action words
 * Example: "nuke the cache" -> "nuke clear delete remove destroy wipe the cache"
 *
 * @param query - The user query to process
 * @returns The query with slang terms expanded to include standard equivalents
 */
export function normalizeSlang(query: string): string {
  let result = query.toLowerCase();
  const additions: string[] = [];

  // Sort by length (descending) to match longer phrases first
  const sortedSlang = Object.entries(SLANG_MAPPINGS).sort(
    (a, b) => b[0].length - a[0].length
  );

  for (const [slang, standardTerms] of sortedSlang) {
    const regex = new RegExp(`\\b${escapeRegex(slang)}\\b`, 'gi');
    if (regex.test(result)) {
      // Add standard terms to help with matching
      additions.push(...standardTerms);
    }
  }

  // Append unique standard terms
  if (additions.length > 0) {
    const uniqueAdditions = Array.from(new Set(additions));
    result = `${result} ${uniqueAdditions.join(' ')}`;
  }

  return result;
}

/**
 * Extract action verbs from a query
 * Example: "I want to delete and update the user" -> ['delete', 'update']
 *
 * @param query - The user query to process
 * @returns Array of action verbs found in the query
 */
export function extractActionVerbs(query: string): string[] {
  const lowerQuery = query.toLowerCase();
  const words = lowerQuery.split(/\s+/);
  const foundVerbs: string[] = [];

  for (const word of words) {
    // Clean punctuation from word
    const cleanWord = word.replace(/[^a-z]/g, '');
    if (ALL_ACTION_VERBS.has(cleanWord)) {
      foundVerbs.push(cleanWord);
    }
  }

  // Also check for multi-word action phrases
  for (const [category, verbs] of Object.entries(ACTION_VERBS)) {
    for (const verb of verbs) {
      if (verb.includes(' ') && lowerQuery.includes(verb)) {
        foundVerbs.push(verb);
      }
    }
  }

  // Return unique verbs
  return Array.from(new Set(foundVerbs));
}

/**
 * Get action categories for extracted verbs
 * Example: ['delete', 'update'] -> ['delete', 'update'] (categories)
 *
 * @param verbs - Array of action verbs
 * @returns Array of action categories the verbs belong to
 */
export function getActionCategories(verbs: string[]): string[] {
  const categories = new Set<string>();

  for (const verb of verbs) {
    for (const [category, categoryVerbs] of Object.entries(ACTION_VERBS)) {
      if (categoryVerbs.includes(verb)) {
        categories.add(category);
      }
    }
  }

  return Array.from(categories);
}

/**
 * Full query preprocessing pipeline
 * Applies all preprocessing steps in order
 *
 * @param query - The original user query
 * @returns Preprocessed query with all transformations applied
 */
export function preprocessQuery(query: string): {
  processed: string;
  original: string;
  actionVerbs: string[];
  actionCategories: string[];
} {
  // Step 1: Expand contractions
  let processed = expandContractions(query);

  // Step 2: Normalize slang
  processed = normalizeSlang(processed);

  // Step 3: Extract action verbs (from original + processed)
  const actionVerbs = extractActionVerbs(processed);
  const actionCategories = getActionCategories(actionVerbs);

  return {
    processed,
    original: query,
    actionVerbs,
    actionCategories,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ═══════════════════════════════════════════════════════════════════════════════
// Exports for Advanced Usage
// ═══════════════════════════════════════════════════════════════════════════════

export {
  CONTRACTIONS,
  SLANG_MAPPINGS,
  ACTION_VERBS,
  ALL_ACTION_VERBS,
};
