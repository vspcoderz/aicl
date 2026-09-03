#!/usr/bin/env node

/**
 * AICL Dictionary Generator v3
 * Expanded: markdown, verb variants, more phrases, supplementary PUA
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

// Unicode PUA ranges — expanded into supplementary
const PUA_RANGES = {
  // English: BMP PUA (starts at E001 to RESERVE U+E000 as the escape marker)
  // + PUA-B overflow AFTER reserved blocks
  english: { start: 0xE001, end: 0xF8FF, overflow: { start: 0x100900, end: 0x10FFFF } },
  // Code: PUA-A range
  code: { start: 0xF0000, end: 0xF07FF },
  // Phrases: PUA-A range (expanded)
  phrases: { start: 0xF0800, end: 0xF0FFF },
  // Markdown: PUA-B range (dedicated, reserved)
  markdown: { start: 0x100000, end: 0x1003FF },
  // Symbols/operators: PUA-B range (dedicated, reserved)
  symbols: { start: 0x100400, end: 0x1007FF },
  // Modifiers: PUA-B range (shared across all dictionaries)
  modifiers: { start: 0x100800, end: 0x1008FF },
};

const ESCAPE_MARKER = '\uE000';

function indexToSymbol(index, range) {
  if (index < (range.end - range.start + 1)) {
    return String.fromCodePoint(range.start + index);
  }
  // Overflow into supplementary range
  if (range.overflow) {
    const overflowIndex = index - (range.end - range.start + 1);
    if (overflowIndex < (range.overflow.end - range.overflow.start + 1)) {
      return String.fromCodePoint(range.overflow.start + overflowIndex);
    }
  }
  return null; // Exhausted all ranges
}

function parseKeywordsYaml(yamlContent) {
  const languages = [];
  const lines = yamlContent.split('\n');
  let currentLang = null;
  let inKeywords = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (trimmed.startsWith('- name:')) {
      const name = trimmed.replace('- name:', '').trim().replace(/"/g, '');
      currentLang = { name, version: '', keywords: [] };
      languages.push(currentLang);
      inKeywords = false;
      continue;
    }
    if (trimmed.startsWith('version:') && currentLang) {
      currentLang.version = trimmed.replace('version:', '').trim().replace(/"/g, '');
      continue;
    }
    if (trimmed === 'keywords:' && currentLang) {
      inKeywords = true;
      continue;
    }
    if (inKeywords && trimmed.startsWith('- ')) {
      const keyword = trimmed.slice(2).trim().replace(/"/g, '');
      if (currentLang && !currentLang.keywords.includes(keyword)) {
        currentLang.keywords.push(keyword);
      }
    }
    if (inKeywords && !trimmed.startsWith('-') && !trimmed.startsWith(' ') && trimmed !== 'keywords:') {
      inKeywords = false;
    }
  }
  return languages;
}

/**
 * Generate modifier symbols — shared across ALL dictionaries.
 * Each modifier transforms the PREVIOUS base word in the output.
 * e.g. base("test") + MOD_CAPS + MOD_TRAIL_PERIOD → "Test."
 */
function generateModifiers() {
  const entries = new Map();
  let symbolIndex = 0;

  const modifiers = [
    ['MOD_CAPS',          (w) => w.charAt(0).toUpperCase() + w.slice(1)],
    ['MOD_TRAIL_SPACE',   (w) => w + ' '],
    ['MOD_TRAIL_COMMA',   (w) => w + ','],
    ['MOD_TRAIL_PERIOD',  (w) => w + '.'],
    ['MOD_TRAIL_QUESTION',(w) => w + '?'],
    ['MOD_TRAIL_EXCL',    (w) => w + '!'],
    ['MOD_TRAIL_SEMI',    (w) => w + ';'],
    ['MOD_TRAIL_COLON',   (w) => w + ':'],
    ['MOD_TRAIL_RPAREN',  (w) => w + ')'],
    ['MOD_TRAIL_RBRACKET',(w) => w + ']'],
    ['MOD_TRAIL_RBRACE',  (w) => w + '}'],
    ['MOD_TRAIL_RQUOTE',  (w) => w + '"'],
    ['MOD_LEAD_SPACE',    (w) => ' ' + w],
    ['MOD_LEAD_LPAREN',   (w) => '(' + w],
    ['MOD_LEAD_LBRACKET', (w) => '[' + w],
    ['MOD_LEAD_LBRACE',   (w) => '{' + w],
    ['MOD_LEAD_LQUOTE',   (w) => '"' + w],
  ];

  for (const [name, fn] of modifiers) {
    const sym = indexToSymbol(symbolIndex, PUA_RANGES.modifiers);
    if (sym) {
      entries.set(name, { symbol: sym, transform: fn });
      symbolIndex++;
    }
  }

  return entries;
}

/**
 * Generate English dictionary — base words + modifier variants.
 *
 * Instead of storing 14 separate symbols per word ( test ,  test,,  test., etc.),
 * we store 1 base symbol per word + ~17 shared modifier symbols.
 *
 * The encoder emits: base_word_symbol + modifier_symbols
 * The decoder applies modifiers to reconstruct the original text.
 *
 * This reduces dict size from N×14 to N+17 symbols.
 */
function generateEnglishDict(words) {
  const entries = new Map();
  let symbolIndex = 0;
  const maxEntries = (0xF8FF - 0xE001 + 1) + (0x10FFFF - 0x100900 + 1); // BMP + overflow after modifiers

  // === TIER 0: Single letters + digits (bare) ===
  // These are the most critical — without them, "a b c d" = 0 compression
  const singleLetters = [];
  for (let i = 97; i <= 122; i++) singleLetters.push(String.fromCharCode(i)); // a-z
  for (let i = 65; i <= 90; i++) singleLetters.push(String.fromCharCode(i));  // A-Z
  for (let i = 48; i <= 57; i++) singleLetters.push(String.fromCharCode(i));  // 0-9

  for (const letter of singleLetters) {
    if (!entries.has(letter) && symbolIndex < maxEntries) {
      const sym = indexToSymbol(symbolIndex, PUA_RANGES.english);
      if (sym) {
        entries.set(letter, sym);
        symbolIndex++;
      }
    }
  }

  // === TIER 1: Top 200 words — base symbol (bare, no context) ===
  // Modifier system handles variants: "Test." = base + MOD_CAPS + MOD_TRAIL_PERIOD
  const tier1 = new Set(words.slice(0, 200));
  // === TIER 2: Top 1000 words — base symbol ===
  const tier2 = new Set(words.slice(200, 1000));
  // === TIER 3: Top 5000 words — base symbol ===
  const tier3 = new Set(words.slice(1000, 5000));

  // === TIER 4: Common all-caps words (JSON, API, URL, etc.) ===
  // These need case-sensitive patterns because MOD_CAPS only capitalizes first letter
  // These are added BEFORE the main word list so they take priority
  const allCapsWords = [
    'json', 'api', 'url', 'css', 'html', 'xml', 'sql', 'http', 'https',
    'jwt', 'dns', 'tcp', 'udp', 'ssh', 'ftp', 'aws', 'gcp', 'azure',
    'node', 'npm', 'git', 'cdn', 'cors', 'csrf', 'xss',
    'ide', 'cli', 'gui', 'sdk', 'rest', 'soap', 'graphql',
    'async', 'sync', 'enum', 'bool', 'int', 'str', 'char', 'float',
    'double', 'byte', 'long', 'null', 'void', 'true', 'false',
  ];

  // Add all-caps versions FIRST (they take priority over lowercase)
  for (const lower of allCapsWords) {
    if (symbolIndex >= maxEntries) break;
    const caps = lower.toUpperCase();
    if (caps !== lower && !entries.has(caps)) {
      const sym = indexToSymbol(symbolIndex, PUA_RANGES.english);
      if (sym) {
        entries.set(caps, sym);
        symbolIndex++;
      }
    }
  }

  for (const word of words) {
    if (symbolIndex >= maxEntries) break;

    const lower = word.toLowerCase();

    // Skip single letters — already added above
    if (lower.length === 1) continue;

    // Skip if already added as all-caps version
    const caps = lower.toUpperCase();
    if (caps !== lower && entries.has(caps)) continue;

    // Emit bare base word (no context variants — modifiers handle those)
    if (!entries.has(lower) && symbolIndex < maxEntries) {
      const sym = indexToSymbol(symbolIndex, PUA_RANGES.english);
      if (sym) {
        entries.set(lower, sym);
        symbolIndex++;
      }
    }
  }

  // === TIER 5: Common letter-pair/fragment symbols ===
  // These are NOT full words — they're common sub-sequences that appear across many words.
  // Enables compression of unknown words by decomposing them into fragments.
  // e.g. "testing" = "test" + "ing", "connection" = "con" + "nect" + "ion"
  const fragments = [
    // Top 50 English bigrams (by frequency)
    'th', 'he', 'in', 'er', 'an', 're', 'on', 'at', 'en', 'nd',
    'ti', 'es', 'or', 'te', 'of', 'ed', 'is', 'it', 'al', 'ar',
    'st', 'to', 'nt', 'ng', 'se', 'ha', 'as', 'ou', 'io', 'le',
    've', 'co', 'me', 'de', 'hi', 'ri', 'ro', 'ic', 'ne', 'ea',
    'ce', 'll', 'ma', 'si', 'om', 'ur', 'ch', 'ly', 'sh', 'wh',
    // Common trigrams
    'tion', 'sion', 'ment', 'ness', 'able', 'ible', 'ful', 'less',
    'ous', 'ive', 'ing', 'ism', 'ist', 'ize', 'ise', 'ity', 'ent',
    'ant', 'ence', 'ance', 'ould', 'ight', 'ough', 'augh',
    // Common prefixes
    'un', 're', 'in', 'dis', 'pre', 'pro', 'con', 'com', 'mis',
    'over', 'sub', 'semi', 'anti', 'de', 'inter', 'trans', 'super',
    'non', 'ex', 'post', 'under', 'out', 'up',
    // Common suffixes
    'ed', 'ing', 'ly', 'er', 'est', 'tion', 'sion', 'ment',
    'ness', 'able', 'ible', 'ful', 'less', 'ous', 'ive', 'ism',
    'ist', 'ize', 'ity', 'ence', 'ance', 'dom', 'ship', 'hood',
    // Common code fragments
    'fn', 'cb', 'pt', 'rt', 'mt', 'op', 'cl', 'pr', 'tr', 'cr',
    'br', 'fr', 'gr', 'pl', 'bl', 'fl', 'sl', 'sp', 'sc', 'sk',
    'sm', 'sn', 'sw', 'tw', 'str', 'spr', 'scr', 'shr', 'spl',
    // Common number+letter combos
    '00', '01', '10', '11', '12', '20', '24', '32', '64', '128',
    // Mixed letter+digit pairs (covers random alphanumeric patterns)
    'a0','a1','a2','a3','a4','a5','a6','a7','a8','a9',
    'b0','b1','b2','b3','b4','b5','b6','b7','b8','b9',
    'c0','c1','c2','c3','c4','c5','c6','c7','c8','c9',
    'd0','d1','d2','d3','d4','d5','d6','d7','d8','d9',
    'e0','e1','e2','e3','e4','e5','e6','e7','e8','e9',
    'f0','f1','f2','f3','f4','f5','f6','f7','f8','f9',
    'g0','g1','g2','g3','g4','g5','g6','g7','g8','g9',
    'h0','h1','h2','h3','h4','h5','h6','h7','h8','h9',
    'i0','i1','i2','i3','i4','i5','i6','i7','i8','i9',
    'j0','j1','j2','j3','j4','j5','j6','j7','j8','j9',
    'k0','k1','k2','k3','k4','k5','k6','k7','k8','k9',
    'l0','l1','l2','l3','l4','l5','l6','l7','l8','l9',
    'm0','m1','m2','m3','m4','m5','m6','m7','m8','m9',
    'n0','n1','n2','n3','n4','n5','n6','n7','n8','n9',
    'o0','o1','o2','o3','o4','o5','o6','o7','o8','o9',
    'p0','p1','p2','p3','p4','p5','p6','p7','p8','p9',
    'q0','q1','q2','q3','q4','q5','q6','q7','q8','q9',
    'r0','r1','r2','r3','r4','r5','r6','r7','r8','r9',
    's0','s1','s2','s3','s4','s5','s6','s7','s8','s9',
    't0','t1','t2','t3','t4','t5','t6','t7','t8','t9',
    'u0','u1','u2','u3','u4','u5','u6','u7','u8','u9',
    'v0','v1','v2','v3','v4','v5','v6','v7','v8','v9',
    'w0','w1','w2','w3','w4','w5','w6','w7','w8','w9',
    'x0','x1','x2','x3','x4','x5','x6','x7','x8','x9',
    'y0','y1','y2','y3','y4','y5','y6','y7','y8','y9',
    'z0','z1','z2','z3','z4','z5','z6','z7','z8','z9',
    // Digit+letter pairs
    '0a','0b','0c','0d','0e','0f','0g','0h','0i','0j','0k','0l','0m','0n','0o','0p','0q','0r','0s','0t','0u','0v','0w','0x','0y','0z',
    '1a','1b','1c','1d','1e','1f','1g','1h','1i','1j','1k','1l','1m','1n','1o','1p','1q','1r','1s','1t','1u','1v','1w','1x','1y','1z',
    '2a','2b','2c','2d','2e','2f','2g','2h','2i','2j','2k','2l','2m','2n','2o','2p','2q','2r','2s','2t','2u','2v','2w','2x','2y','2z',
    '3a','3b','3c','3d','3e','3f','3g','3h','3i','3j','3k','3l','3m','3n','3o','3p','3q','3r','3s','3t','3u','3v','3w','3x','3y','3z',
    '4a','4b','4c','4d','4e','4f','4g','4h','4i','4j','4k','4l','4m','4n','4o','4p','4q','4r','4s','4t','4u','4v','4w','4x','4y','4z',
    '5a','5b','5c','5d','5e','5f','5g','5h','5i','5j','5k','5l','5m','5n','5o','5p','5q','5r','5s','5t','5u','5v','5w','5x','5y','5z',
    '6a','6b','6c','6d','6e','6f','6g','6h','6i','6j','6k','6l','6m','6n','6o','6p','6q','6r','6s','6t','6u','6v','6w','6x','6y','6z',
    '7a','7b','7c','7d','7e','7f','7g','7h','7i','7j','7k','7l','7m','7n','7o','7p','7q','7r','7s','7t','7u','7v','7w','7x','7y','7z',
    '8a','8b','8c','8d','8e','8f','8g','8h','8i','8j','8k','8l','8m','8n','8o','8p','8q','8r','8s','8t','8u','8v','8w','8x','8y','8z',
    '9a','9b','9c','9d','9e','9f','9g','9h','9i','9j','9k','9l','9m','9n','9o','9p','9q','9r','9s','9t','9u','9v','9w','9x','9y','9z',
  ];

  for (const frag of fragments) {
    if (symbolIndex >= maxEntries) break;
    if (!entries.has(frag)) {
      const sym = indexToSymbol(symbolIndex, PUA_RANGES.english);
      if (sym) {
        entries.set(frag, sym);
        symbolIndex++;
      }
    }
  }

  // === TIER 6: Common technical terms (not in Google 10k) ===
  const techTerms = [
    'markdown', 'javascript', 'typescript', 'python', 'rust', 'golang',
    'react', 'vue', 'angular', 'svelte', 'nextjs', 'nodejs', 'deno',
    'docker', 'kubernetes', 'terraform', 'ansible', 'jenkins',
    'postgresql', 'mongodb', 'redis', 'elasticsearch', 'kafka',
    'graphql', 'restful', 'websocket', 'grpc', 'protobuf',
    'algorithm', 'recursion', 'iteration', 'inheritance', 'polymorphism',
    'abstraction', 'encapsulation', 'async', 'await', 'promise',
    'callback', 'closure', 'prototype', 'module', 'package',
    'repository', 'commit', 'branch', 'merge', 'rebase', 'cherry',
    'pullrequest', 'codebase', 'refactor', 'debug',
    'benchmark', 'profiling', 'latency', 'throughput', 'bottleneck',
    'scalability', 'redundancy', 'failover', 'loadbalancer', 'microservice',
    'monolith', 'serverless', 'edge', 'caching',
    'authentication', 'authorization', 'encryption', 'decryption',
    'tokenization', 'inference', 'training', 'dataset', 'model',
    'architecture', 'hyperparameter', 'gradient', 'backpropagation',
    'neuralnetwork', 'transformer', 'attention', 'embedding',
    'vector', 'dimension', 'tensor', 'matrix', 'activation',
    'lossfunction', 'optimizer', 'learningrate', 'epoch', 'batch',
    'regularization', 'dropout', 'normalization', 'convolution',
    'pooling', 'recurrent', 'lstm', 'gru', 'bert', 'gpt',
    'diffusion', 'generative', 'discriminative', 'reinforcement',
    'supervised', 'unsupervised', 'semisupervised', 'transfer',
    'finetuning', 'prompting', 'chainofthought', 'fewshot',
    'zeroshot', 'hallucination', 'alignment', 'safety', 'bias',
    'fairness', 'interpretability', 'explainability', 'robustness',
    'adversarial', 'outofdistribution', 'distribution', 'entropy',
    'kl', 'divergence', 'likelihood', 'posterior', 'prior',
    'bayesian', 'frequentist', 'statistical', 'probability',
    'regression', 'classification', 'clustering', 'dimensionality',
    'reduction', 'manifold', 'topology', 'geometry', 'calculus',
    'derivative', 'hessian', 'jacobian', 'eigenvalue',
    'singular', 'decomposition', 'factorization', 'optimization',
    'convex', 'nonconvex', 'constraint',
    'interpolation', 'extrapolation', 'approximation',
    'unicode', 'utf', 'ascii', 'hexadecimal', 'binary', 'octal',
    'decimal', 'boolean', 'integer', 'float', 'string', 'array',
    'object', 'function', 'class', 'interface', 'enum', 'struct',
    'union', 'pointer', 'reference', 'value', 'type', 'var',
    'const', 'let', 'static', 'global', 'local', 'public', 'private',
    'protected', 'abstract', 'virtual', 'override', 'final',
    'sealed', 'readonly', 'volatile', 'atomic', 'synchronized',
    'concurrent', 'parallel', 'asynchronous', 'synchronous',
    'taskboard', 'todo', 'kanban', 'scrum', 'sprint', 'backlog',
    'standup', 'retrospective', 'planning', 'estimation',
  ];

  // === TIER 7: Case-sensitive fragments ===
  // MOD_CAPS only capitalizes first letter. These handle all-caps and camelCase fragments.
  const caseSensitiveFragments = [
    // All-caps (common in code/tech)
    'FF', 'FF00', 'FF0000', 'FF00FF', 'FFFF00', '00FF00', '0000FF',
    'OK', 'IO', 'EOF', 'EOL', 'CR', 'LF', 'CRLF', 'LF', 'TAB', 'NULL',
    'INT', 'STR', 'BOOL', 'CHAR', 'BYTE', 'LONG', 'VOID', 'NULL',
    'TRUE', 'FALSE', 'NONE', 'NaN', 'INF',
    'GET', 'POST', 'PUT', 'DEL', 'PATCH', 'HEAD', 'OPTIONS',
    'SSL', 'TLS', 'RSA', 'AES', 'MD5', 'SHA', 'HMAC',
    'CPU', 'GPU', 'RAM', 'ROM', 'SSD', 'HDD', 'USB', 'PCI',
    'LAN', 'WAN', 'NAT', 'DNS', 'DHCP', 'SMTP', 'POP3', 'IMAP',
    'HTTP', 'HTTPS', 'WSS', 'WS', 'UDP', 'TCP', 'IP', 'IPv4', 'IPv6',
    'JSON', 'XML', 'YAML', 'TOML', 'INI', 'CSV', 'TSV',
    'HTML', 'CSS', 'JS', 'TS', 'JSX', 'TSX', 'MD', 'TXT',
    'EOF', 'EOL', 'NUL', 'ACK', 'NAK', 'SYN', 'FIN', 'RST',
    // CamelCase fragments (common in code)
    'In', 'To', 'By', 'On', 'At', 'Up', 'Go', 'Do', 'If', 'Or',
    'Is', 'As', 'No', 'So', 'An', 'Be', 'It', 'We', 'He', 'My',
    'Get', 'Set', 'Add', 'Del', 'Run', 'Put', 'Try', 'Log', 'Map',
    'Use', 'New', 'Old', 'Big', 'Raw', 'Low', 'Max', 'Min', 'Avg',
    'Top', 'Bot', 'Left', 'Right', 'Up', 'Down', 'In', 'Out',
    'Push', 'Pop', 'Read', 'Play', 'Load', 'Save', 'Send', 'Sort',
    'Band', 'Key', 'Val', 'Src', 'Dst', 'Buf', 'Ctx', 'Err',
    'Req', 'Res', 'Idx', 'Pos', 'Len', 'Size', 'Type', 'Name',
    'Path', 'File', 'Dir', 'Url', 'Cmd', 'Arg', 'Env', 'Log',
    'Api', 'App', 'Db', 'Id', 'Ip', 'Ui', 'Os', 'Fs',
    // Hex patterns
    'AF', 'DE', 'AD', 'BE', 'CA', 'FE', 'BA', 'AB', 'CD',
    'EF', '00', '11', '22', '33', '44', '55', '66', '77', '88', '99',
    'AA', 'BB', 'CC', 'DD',
  ];

  for (const frag of caseSensitiveFragments) {
    if (symbolIndex >= maxEntries) break;
    if (!entries.has(frag)) {
      const sym = indexToSymbol(symbolIndex, PUA_RANGES.english);
      if (sym) {
        entries.set(frag, sym);
        symbolIndex++;
      }
    }
  }

  for (const term of techTerms) {
    if (symbolIndex >= maxEntries) break;
    if (!entries.has(term)) {
      const sym = indexToSymbol(symbolIndex, PUA_RANGES.english);
      if (sym) {
        entries.set(term, sym);
        symbolIndex++;
      }
    }
  }

  return Object.fromEntries(entries);
}

/**
 * Generate markdown pattern dictionary
 */
function generateMarkdownDict() {
  const entries = new Map();
  let symbolIndex = 0;

  const patterns = [
    // Headers (space-aware for compression)
    '# ', '## ', '### ', '#### ', '##### ', '###### ',
    // Bold/Italic
    '**', '__', '***', '___', '~~',
    // List markers
    '- ', '* ', '+ ',
    // Numbered lists (common prefixes)
    '1. ', '2. ', '3. ', '4. ', '5. ', '6. ', '7. ', '8. ', '9. ',
    // Blockquote
    '> ', '>> ',
    // Code blocks
    '```', '`',
    // Links and images
    ']( ', ')[', '![', '[', '](',
    // Horizontal rules
    '---', '***', '___',
    // Table
    '| ', '|--', '|--',
    // Task lists
    '- [ ] ', '- [x] ', '- [X] ',
    // Definition lists
    ': ',
    // HTML comments (common in markdown)
    '<!-- ', ' -->',
    // Escaped characters
    '\\* ', '\\_ ', '\\# ',
    // Inline code
    '` ',
    ' `',
    // Reference links
    '[^', ']: ',
    // Footnotes
    '[^1]', '[^2]', '[^3]',
    // Abbreviations
    '*[', ']: ',
    // Common markdown text patterns
    '**Note:**', '**Warning:**', '**Tip:**', '**Important:**',
    '**See also:**', '**References:**',
    // Markdown link patterns
    '[click here](', '[here](', '[read more](',
    '[learn more](', '[see documentation](',
    // Common markdown formatting
    '> **Note:**', '> **Warning:**', '> **Tip:**',
    // Code language tags
    '```javascript', '```python', '```rust', '```go',
    '```java', '```c', '```cpp', '```bash',
    '```json', '```yaml', '```markdown', '```sql',
    '```html', '```css', '```typescript', '```jsx',
    '```tsx', '```ruby', '```php', '```swift',
    '```kotlin', '```scala', '```r', '```matlab',
    '```lua', '```perl', '```shell', '```powershell',
    '```dockerfile', '```makefile', '```toml',
    '```ini', '```xml', '```csv', '```diff',
  ];

  for (const pattern of patterns) {
    if (!entries.has(pattern) && symbolIndex < 2048) {
      entries.set(pattern, indexToSymbol(symbolIndex, PUA_RANGES.markdown));
      symbolIndex++;
    }
  }

  return Object.fromEntries(entries);
}

/**
 * Generate code dictionary with expanded patterns
 */
function generateCodeDict(languages) {
  const entries = new Map();
  let symbolIndex = 0;
  const maxEntries = 2048;

  // Collect all unique keywords
  const allKeywords = new Set();
  for (const lang of languages) {
    for (const keyword of lang.keywords) {
      allKeywords.add(keyword);
    }
  }

  const codePatterns = [
    // Console/API patterns
    'console.log(', 'console.error(', 'console.warn(', 'console.info(',
    'document.', 'window.', 'Math.', 'JSON.',
    'JSON.parse(', 'JSON.stringify(',
    'parseInt(', 'parseFloat(', 'isNaN(', 'isFinite(',
    'encodeURI(', 'decodeURI(', 'encodeURIComponent(', 'decodeURIComponent(',
    'setTimeout(', 'setInterval(', 'clearTimeout(', 'clearInterval(',
    'addEventListener(', 'removeEventListener(', 'dispatchEvent(',
    'querySelector(', 'querySelectorAll(', 'getElementById(',
    'getElementsByClassName(', 'getElementsByTagName(',
    'createElement(', 'createTextNode(', 'appendChild(',
    'removeChild(', 'insertBefore(', 'replaceChild(',
    'innerHTML', 'textContent', 'outerHTML',
    'className', 'classList', 'id', 'src', 'href', 'alt',
    'fetch(', 'XMLHttpRequest(', 'Response(', 'Request(',
    'Headers(', 'FormData(', 'URL(', 'URLSearchParams(',
    'Blob(', 'File(', 'FileReader(', 'ReadableStream(',
    'WebSocket(', 'EventSource(', 'Notification(',
    'IntersectionObserver(', 'MutationObserver(', 'ResizeObserver(',
    'PerformanceObserver(', 'console.table(', 'console.group(',
    'console.time(', 'console.trace(', 'console.assert(',

    // DOM events
    'onclick', 'onload', 'onerror', 'onsubmit', 'onchange',
    'oninput', 'onfocus', 'onblur', 'onmouseover', 'onmouseout',
    'onkeydown', 'onkeyup', 'onkeypress', 'ontouchstart', 'ontouchend',

    // Common properties/methods
    'toString(', 'valueOf(', 'hasOwnProperty(', 'isPrototypeOf(',
    'call(', 'apply(', 'bind(',
    'push(', 'pop(', 'shift(', 'unshift(', 'slice(', 'splice(',
    'map(', 'filter(', 'reduce(', 'forEach(', 'find(', 'some(', 'every(',
    'join(', 'split(', 'sort(', 'reverse(', 'flat(', 'flatMap(',
    'from(', 'of(', 'entries(', 'keys(', 'values(',
    'get(', 'set(', 'has(', 'delete(', 'clear(',
    'add(', 'size(',

    // React/JSX patterns
    'useState(', 'useEffect(', 'useContext(', 'useRef(',
    'useMemo(', 'useCallback(', 'useReducer(',
    'React.', 'Component(', 'PureComponent(',
    'useReducer(', 'createContext(',
    'useEffect(', 'useLayoutEffect(',
    'useImperativeHandle(', 'useDebugValue(',

    // Node.js patterns
    'require(', 'module.exports', 'exports.',
    'fs.readFile(', 'fs.writeFile(', 'fs.readFileSync(',
    'http.createServer(', 'https.createServer(',
    'express(', 'Router(', 'app.get(', 'app.post(', 'app.put(', 'app.delete(',
    'mongoose.', 'mongodb.',
    'process.env.', 'process.stdout.', 'process.stderr.',
    'path.', 'os.', 'util.', 'stream.', 'buffer.',
    'crypto.', 'zlib.', 'http.', 'https.', 'net.', 'tls.',
    'ws.', 'socket.io(',

    // SQL patterns
    'SELECT ', 'FROM ', 'WHERE ', 'INSERT INTO ', 'UPDATE ',
    'DELETE FROM ', 'CREATE TABLE ', 'DROP TABLE ',
    'ALTER TABLE ', 'JOIN ', 'LEFT JOIN ', 'RIGHT JOIN ',
    'INNER JOIN ', 'OUTER JOIN ', 'ON ', 'AND ', 'OR ', 'NOT ',
    'IN (', 'BETWEEN ', 'LIKE ', 'IS NULL', 'IS NOT NULL',
    'GROUP BY ', 'ORDER BY ', 'LIMIT ', 'OFFSET ',
    'HAVING ', 'UNION ', 'EXISTS ', 'ANY ', 'ALL ',
    'VALUES (', 'DEFAULT VALUES',
    'CREATE DATABASE ', 'USE ', 'DROP DATABASE ',
    'TRUNCATE TABLE ', 'INDEX ', 'VIEW ',

    // Common operators
    '=> ', '=== ', '!== ', '>= ', '<= ', '&& ', '|| ',
    '++ ', '-- ', '+= ', '-= ', '*= ', '/= ', '%= ',
    '?? ', '?. ', '??=', '&&=', '||=',
    '... ', 'typeof ', 'instanceof ', 'in ',
    'delete ', 'void ', 'yield ', 'await ',
    'export default ', 'export {', 'import ',
    'from ', 'as ', 'async ', 'extends ', 'implements ',
    'interface ', 'type ', 'enum ', 'namespace ',
    'abstract ', 'static ', 'readonly ', 'declare ',
    'module ', 'function ', 'const ',
    'let ', 'var ', 'return ', 'throw ', 'try {',
    'catch (', 'finally ', 'if (', 'else {', 'else if (',
    'for (', 'while (', 'do {', 'switch (', 'case ',
    'default:', 'break ', 'continue ', 'goto ',
    'with ', 'debugger ', 'eval(', 'arguments.',

    // Python specific
    'def ', 'class ', 'lambda ', 'yield ', 'print(',
    'input(', 'open(', 'with ', 'assert ',
    'try:', 'except ', 'finally:', 'raise ',
    'import ', 'del ', 'pass ',
    'global ', 'nonlocal ', 'self.',
    '__init__', '__name__', '__file__', '__doc__',
    'isinstance(', 'hasattr(', 'getattr(', 'setattr(',
    'dir(', 'vars(', 'type(', 'super(',
    'range(', 'enumerate(', 'zip(', 'sorted(', 'reversed(',
    'abs(', 'round(', 'pow(', 'min(', 'max(', 'sum(',
    'len(', 'list(', 'tuple(', 'dict(', 'set(', 'frozenset(',
    'str(', 'int(', 'float(', 'bool(', 'bytes(', 'bytearray(',
    'array(', 'collections.', 'itertools.', 'functools.',
    'operator.', 'threading(', 'multiprocessing(', 'asyncio(',

    // Rust patterns
    'fn ', 'let ', 'let mut ', 'const ', 'static ',
    'pub ', 'pub fn ', 'pub mod ', 'pub use ',
    'impl ', 'trait ', 'struct ', 'enum ', 'union ',
    'match ', 'if let ', 'while let ', 'loop ',
    'unsafe ', 'extern ', 'use ',
    'mod ', 'crate::', 'self::', 'super::',
    'Box::new(', 'Rc::new(', 'Arc::new(', 'Mutex::new(',
    'RefCell::new(', 'Cell::new(', 'Vec::new(',
    'String::new(', 'HashMap::new(', 'BTreeMap::new(',
    'HashSet::new(', 'BTreeSet::new(',

    // Go patterns
    'func ', 'package ', 'var ', 'const ', 'type ',
    'struct ', 'interface ', 'map[', '[]', 'chan ',
    'go ', 'defer ', 'go func(', 'select {',
    'range ', 'close(',
    'make(', 'new(', 'delete(', 'len(', 'cap(',
    'copy(', 'append(', 'print(', 'println(', 'errorf(',
    'fmt.Printf(', 'fmt.Sprintf(', 'fmt.Fprintf(',
    'http.HandleFunc(', 'http.ListenAndServe(',
    'gin.Engine(', 'gin.Default(', 'r.GET(', 'r.POST(',
    'r.PUT(', 'r.DELETE(', 'r.PATCH(',

    // C/C++ patterns
    'int ', 'float ', 'double ', 'char ', 'void ',
    'unsigned ', 'signed ', 'short ', 'long ', 'struct ',
    'typedef ', 'enum ', 'union ', 'sizeof ', 'malloc(',
    'calloc(', 'realloc(', 'free(', 'printf(', 'scanf(',
    'fopen(', 'fclose(', 'fread(', 'fwrite(', 'fgets(',
    'fputs(', 'strlen(', 'strcmp(', 'strcpy(', 'strcat(',
    'strstr(', 'atoi(', 'atof(', 'exit(', 'system(',
    '#include ', '#define ', '#ifdef ', '#ifndef ', '#endif ',
    '#pragma ', '__attribute__', '__inline__',
    'new ', 'delete ', 'this->', '::',
    'public:', 'private:', 'protected:', 'virtual ',
    'override ', 'final ', 'constexpr ',
    'noexcept ', 'static_assert(', 'thread_local ',
    'nullptr ', 'std::', 'using namespace ',

    // Java patterns
    'public ', 'private ', 'protected ', 'static ',
    'final ', 'void ', 'class ', 'interface ',
    'extends ', 'implements ', 'new ', 'this.',
    'super.', 'return ', 'throw ', 'throws ',
    'try {', 'catch (', 'finally {', 'synchronized ',
    'abstract ', 'volatile ', 'transient ', 'native ',
    'strictfp ', 'assert ', 'package ',
    'System.out.println(', 'System.out.print(',
    'Scanner(', 'BufferedReader(',
    'PrintWriter(', 'FileReader(', 'FileWriter(',
    'ArrayList(', 'HashMap(', 'HashSet(', 'TreeMap(',
    'LinkedList(', 'Collections.', 'Arrays.',
    'StringBuilder(', 'StringBuffer(', 'Math.',
    'Runtime.getRuntime(', 'ProcessBuilder(',
    'Thread(', 'Runnable(', 'Callable(', 'Future(',
    'ExecutorService(', 'CompletableFuture(', 'Stream.',

    // C# patterns
    'public ', 'private ', 'protected ', 'internal ',
    'static ', 'readonly ', 'const ', 'void ',
    'class ', 'struct ', 'interface ', 'enum ',
    'namespace ', 'using ', 'async ', 'await ',
    'yield return ', 'yield break ',
    'Console.WriteLine(', 'Console.Write(',
    'base.', 'virtual ', 'override ',
    'abstract ', 'sealed ', 'partial ',
    'IEnumerable', 'IEnumerator', 'IComparable',
    'List<', 'Dictionary<', 'HashSet<', 'Stack<',
    'Queue<', 'LinkedList<', 'StringBuilder(',
    'String.Format(', 'Convert.To', 'int.Parse(',
    'double.Parse(', 'int.TryParse(',
    'Task.Run(', 'Task.Delay(', 'Task.WhenAll(',
    'HttpClient(', 'HttpRequestMessage(',
    'HttpResponseMessage(', 'JsonSerializer.Serialize(',
    'JsonSerializer.Deserialize(',

    // PHP patterns
    'echo ', 'print ', 'printf(', 'sprintf(',
    'require(', 'require_once(', 'include(', 'include_once(',
    'function ', 'class ', 'public ', 'private ', 'protected ',
    'static ', 'abstract ', 'final ', 'const ',
    '$this->', '$GLOBALS', '$_GET', '$_POST', '$_REQUEST',
    '$_SESSION', '$_COOKIE', '$_FILES', '$_SERVER',
    'array(', 'list(', 'foreach(', 'as ',
    'count(', 'sizeof(', 'in_array(', 'array_key_exists(',
    'strpos(', 'str_replace(', 'preg_match(',
    'preg_replace(', 'array_push(', 'array_pop(',
    'array_map(', 'array_filter(', 'array_reduce(',
    'mysqli_connect(', 'PDO(', 'query(', 'prepare(',
    'execute(', 'fetch(', 'fetchAll(',

    // Ruby patterns
    'def ', 'end ', 'class ', 'module ', 'if ', 'unless ',
    'while ', 'until ', 'for ', 'case ', 'when ',
    'do ', 'begin ', 'rescue ', 'ensure ', 'then ',
    'puts ', 'print ', 'p ', 'require ', 'include ',
    'extend ', 'attr_accessor(', 'attr_reader(', 'attr_writer(',
    'initialize(', 'super(', 'yield ', 'block_given?',
    'Array(', 'Hash(', 'String(', 'Symbol(', 'Range(',
    'Regexp(', 'File(', 'Dir(', 'Time.now',
    'pp ', 'warn ', 'raise ',

    // Error handling patterns
    'Error: ', 'TypeError: ', 'ReferenceError: ',
    'SyntaxError: ', 'RangeError: ', 'URIError: ',
    'UnhandledPromiseRejection:',
    'Cannot read property', 'Cannot read properties',
    'is not defined', 'is not a function',
    'Unexpected token', 'Unexpected identifier',

    // Common abbreviations/shorthand
    'etc.', 'e.g.', 'i.e.', 'vs.', 'ca.', 'cf.',
    'a.m.', 'p.m.',

    // Number ordinals
    '1st', '2nd', '3rd', '4th', '5th',
    '6th', '7th', '8th', '9th', '10th',

    // Terminal/CLI patterns
    '$ cd ', '$ ls', '$ pwd', '$ cat ', '$ grep ',
    '$ find ', '$ sed ', '$ npm ', '$ git ',
    '$ python3', '$ node ', '$ npm run ',
    '$ npm test', '$ npm run build', '$ npm run lint',
    '$ git status', '$ git diff', '$ git log',
    '$ git diff --', '$ git config',
    '~/', './', '../', '.git',
    '--- a/', '+++ b/', 'diff --git',
    'src/', 'dist/', 'tests/', 'lib/',
    'index.', '.ts', '.js', '.json', '.md', '.env',
    '.jsx', '.tsx', '.py', '.rb', '.go', '.rs',
    '.java', '.c', '.cpp', '.h', '.css', '.html',
    '.yaml', '.yml', '.toml', '.ini', '.sh', '.bash',
    '.env.example', '.gitignore', '.env.local',
    'package.json', 'tsconfig.json', 'package-lock.json',
    'README.md', 'LICENSE', 'Makefile', 'Dockerfile',
    'tests/', 'test/', 'spec/', 'src/',
    '$ ', 'root:', 'user:', 'admin:',
    'bold', 'italic', 'underline', 'strikethrough',
    'strikethrough', 'highlight', 'code', 'quote',
    'list', 'ordered', 'unordered', 'task',
    'checkbox', 'checked', 'unchecked',
    'link', 'image', 'video', 'audio',
    'embed', 'reference', 'footnote',
    'table', 'cell', 'row', 'column',
    'header', 'footer', 'section', 'paragraph',

    // Test output patterns
    'PASS ', 'FAIL ', '✓ ', '✗ ',
    'Test Suites:', 'Tests:', 'Snapshots:',
    'Time:', 'Ran all test suites',
    'passed, ', 'failed, ', 'total',
    'expect(', 'describe(', 'it(', 'test(',
    'toBe(', 'toEqual(', 'toHaveBeenCalledWith(',
    'jest --runInBand', 'npm test --',

    // Package manager output
    'added ', 'removed ', 'changed ',
    'found ', 'vulnerabilities ',
    'audited ', 'packages ',
    'up to date', 'latest', 'version',

    // Build output
    'compiled successfully', 'compilation',
    'error TS', 'error MC', 'warning',
    'No errors', 'No warnings',
    'Found 0 errors', 'Found 0 warnings',
    'tsc', 'eslint', 'prettier', 'jest', 'vitest',
    'webpack', 'vite', 'rollup', 'esbuild', 'babel',
    'typescript compile', 'type checking',
    '✔ ', '✘ ',

    // Common code idioms
    'req.params.', 'req.query.', 'req.body.',
    'res.json(', 'res.status(', 'res.send(',
    'res.end()', 'router.', 'router.get(',
    'router.post(', 'router.put(',
    'router.delete(', 'router.patch(',
    'createRouter(', 'new Router(',
    'app.use(', 'app.get(', 'app.post(',
    'app.put(', 'app.delete(', 'app.listen(',
    'db.query(', 'db.execute(', 'db.connect(',
    'pool.query(', 'pg.Pool', 'connectionString',
    'await db', 'const db =',
    'String(req.query.', 'Number.parseInt(',
    'Number.isFinite(', 'req.query.completed',
    'req.query.priority', 'req.query.page',
    'req.query.limit',
    'conditions.push(', 'values.push(',
    'filters.completed', 'filters.priority',
    'TaskFilters', 'Task[]', 'Promise<',
    'Partial<', 'unknown[]', 'string[]',
    'export async function', 'export default',
    'export interface', 'interface Task',
    'export const', 'export function',
    'import { Router }', 'import pg from',
    'import request from', 'import { app } from',
    'import { db } from', 'import { config } from',
    'console.error(error)',
    'res.status(500)', 'res.status(400)',
    'res.status(201)', 'res.status(404)',
    'res.status(200)', 'res.status(204)',
    'error: ', '"Internal server error"',
    '"Task not found"', '"Invalid task"',
    'error: " ', 'json({ error:',
    'async (req, res) => {',
    'async (req, res) =>',
    'req, res) => {', '(req, res)',
    '=> {', '=> {',
    'try {', '} catch (error) {',
    'return result.rows.map', '.rows.map((row) => (',
    'createdAt: row.created_at', 'row.id', 'row.title',
    'row.completed', 'row.priority',
    'ORDER BY', 'ORDER BY created_at',
    'SELECT id, title, completed, priority, created_at',
    'FROM tasks', 'INSERT INTO tasks',
    'VALUES ($1, $2)', 'RETURNING id',
    'WHERE ', 'LIMIT ', 'OFFSET ',
    'GEN', 'UUID', 'PRIMARY KEY',
    'DEFAULT gen_random_uuid()', 'NOT NULL',
    'DEFAULT FALSE', 'DEFAULT NOW()',
    'TIMESTAMPTZ', 'BOOLEAN', 'TEXT', 'TEXT NOT NULL',
    'CREATE TABLE tasks', '($', '$1', '$2',
    "?? 'medium'", 'input.title', 'input.priority',

    // File path patterns
    'src/app.ts', 'src/config.ts', 'src/db.ts',
    'src/routes/tasks.ts', 'src/services/taskService.ts',
    'tests/tasks.test.ts',
    'router.get("/"', 'router.post("/"', 'router.patch("/:id"', 'router.delete("/:id"',
    'router.get("/", async',
    'get("/api', '/api/tasks',
    '/api/tasks?', 'ROUTES', 'app.ts', 'config.ts',
  ];

  for (const pattern of codePatterns) {
    if (!entries.has(pattern) && symbolIndex < maxEntries) {
      entries.set(pattern, indexToSymbol(symbolIndex, PUA_RANGES.code));
      symbolIndex++;
    }
  }

  // Add keywords with context
  for (const keyword of allKeywords) {
    if (symbolIndex >= maxEntries) break;
    const spaceVariant = ` ${keyword} `;
    if (!entries.has(spaceVariant)) {
      entries.set(spaceVariant, indexToSymbol(symbolIndex, PUA_RANGES.code));
      symbolIndex++;
    }
    if (symbolIndex < maxEntries) {
      const funcVariant = `${keyword}(`;
      if (!entries.has(funcVariant)) {
        entries.set(funcVariant, indexToSymbol(symbolIndex, PUA_RANGES.code));
        symbolIndex++;
      }
    }
  }

  return Object.fromEntries(entries);
}

/**
 * Generate phrase/symbol dictionary
 */
function generatePhraseDict() {
  const entries = new Map();
  let symbolIndex = 0;
  const maxEntries = 2048;

  const phrases = [
    // Pronoun + verb combos
    'I am ', 'you are ', 'we are ', 'they are ',
    'I was ', 'you were ', 'we were ', 'they were ',
    'I have ', 'you have ', 'we have ', 'they have ',
    'I will ', 'you will ', 'we will ', 'they will ',
    'I would ', 'you would ', 'we would ', 'they would ',
    'I can ', 'you can ', 'we can ', 'they can ',
    'I should ', 'you should ', 'we should ', 'they should ',
    'I must ', 'you must ', 'we must ', 'they must ',
    'I could ', 'you could ', 'we could ', 'they could ',
    'I might ', 'you might ', 'we might ', 'they might ',
    'he is ', 'she is ', 'it is ',
    'he was ', 'she was ', 'it was ',
    'he has ', 'she has ', 'it has ',
    'he will ', 'she will ', 'it will ',
    'he would ', 'she would ', 'it would ',
    'he can ', 'she can ', 'it can ',
    'he should ', 'she should ', 'it should ',

    // Prepositional phrases
    'in the ', 'to the ', 'of the ', 'for the ',
    'with the ', 'on the ', 'at the ', 'from the ',
    'by the ', 'about the ', 'into the ', 'through the ',
    'during the ', 'before the ', 'after the ',
    'above the ', 'below the ', 'between the ',
    'without the ', 'within the ', 'upon the ',
    'against the ', 'among the ', 'throughout the ',
    'across the ', 'along the ', 'around the ',
    'behind the ', 'beneath the ', 'beside the ',
    'beyond the ', 'near the ', 'past the ',
    'since the ', 'toward the ', 'under the ',

    // Verb phrases
    'going to ', 'have to ', 'want to ', 'need to ',
    'used to ', 'able to ', 'going to be ',
    'have been ', 'has been ', 'had been ',
    'will be ', 'would be ', 'could be ',
    'should be ', 'might be ', 'must be ',
    'can be ', 'may be ',

    // Noun phrases
    'one of the ', 'each of the ', 'all of the ',
    'some of the ', 'most of the ', 'many of the ',
    'part of the ', 'kind of ', 'type of ',
    'lot of ', 'bit of ', 'piece of ',
    'group of ', 'set of ', 'array of ',
    'list of ', 'number of ', 'amount of ',

    // Question phrases
    'what is ', 'what are ', 'what was ',
    'who is ', 'who are ', 'who was ',
    'where is ', 'where are ', 'where was ',
    'when is ', 'when are ', 'when was ',
    'why is ', 'why are ', 'why was ',
    'how is ', 'how are ', 'how was ',
    'how do ', 'how does ', 'how did ',
    'can you ', 'could you ', 'would you ',
    'will you ', 'do you ', 'does he ',
    'does she ', 'did you ',

    // Common adverbs
    'right now ', 'just now ', 'so far ',
    'as well ', 'as usual ', 'as always ',
    'for example ', 'for instance ',
    'in fact ', 'in general ', 'in total ',
    'at least ', 'at most ', 'at first ',
    'on the other hand ', 'in conclusion ',
    'as a result ', 'in other words ',
    'of course ', 'by the way ', 'in addition ',
    'more importantly ', 'less importantly ',

    // Transition phrases
    'however ', 'therefore ', 'moreover ',
    'furthermore ', 'additionally ',
    'meanwhile ', 'consequently ',
    'nevertheless ', 'nonetheless ',
    'alternatively ', 'similarly ',
    'likewise ', 'conversely ',
    'on the contrary ', 'in contrast ',
    'as mentioned ', 'as noted ',
    'to summarize ', 'in summary ',
    'to conclude ', 'in short ',

    // Common sentence openers
    'it is ', 'it was ', 'it has ', 'it will ',
    'it can ', 'it should ', 'it could ', 'it might ',
    'there is ', 'there are ', 'there was ',
    'here is ', 'here are ', 'here was ',
    'that is ', 'that was ', 'that has ',
    'this is ', 'this was ', 'this has ',

    // Business/technical phrases
    'in terms of ', 'with respect to ',
    'in regard to ', 'with regard to ',
    'as far as ', 'as much as ',
    'in addition to ', 'instead of ',
    'because of ', 'due to ', 'owing to ',
    'thanks to ', 'according to ', 'contrary to ',

    // Comparison phrases
    'more than ', 'less than ',
    'better than ', 'worse than ',
    'easier than ', 'harder than ',
    'faster than ', 'slower than ',
    'higher than ', 'lower than ',
    'longer than ', 'shorter than ',
    'older than ', 'newer than ',

    // Code documentation phrases
    'this function ', 'this method ', 'this class ',
    'this module ', 'this package ',
    'returns ', 'throws ', 'accepts ',
    'parameters ', 'arguments ',
    'the following ', 'the above ',
    'see also ', 'note that ',
    'refer to ', 'based on ',
    'according to ', 'as defined by ',
    'example usage ', 'usage example ',
    'for more information ', 'for details ',
    'please refer to ', 'please see ',

    // Common email/chat phrases
    'dear ', 'sincerely ', 'regards ',
    'best regards ', 'kind regards ',
    'thank you ', 'thanks for ',
    'please let me know ', 'please let us know ',
    'looking forward to ', 'i look forward to ',
    'as per ', 'per your request ',
    'please find ', 'please see ',
    'attached ', 'referenced ',
    'in the meantime ', 'at your convenience ',
    'please do not hesitate ',
    'feel free to ', 'don\'t hesitate to ',

    // Scientific/academic phrases
    'in this paper ', 'in this study ',
    'as shown in ', 'as described in ',
    'figure ', 'table ', 'equation ',
    'section ', 'chapter ',
    'appendix ', 'bibliography ',
    'references ', 'acknowledgments ',
    'abstract ', 'introduction ',
    'conclusion ', 'results ',
    'methodology ', 'discussion ',
    'future work ', 'open questions ',

    // Common expressions
    'a lot of ', 'a number of ',
    'the fact that ', 'the idea that ',
    'the problem is ', 'the issue is ',
    'the reason is ', 'the point is ',
    'the thing is ', 'the truth is ',
    'it turns out ', 'it seems like ',
    'it looks like ', 'it appears that ',
    'i think that ', 'i believe that ',
    'i feel like ', 'i mean ',
    'you know ', 'you see ',
    'let me ', 'let us ',
    'we need to ', 'we should ',
    'we can ', 'we have to ',
    'we will ', 'we want to ',

    // AI response patterns (from real AI outputs)
    'This is ', 'This creates ', 'This means ', 'This could ',
    'This does not ', 'This is why ', 'This is important ',
    'This is a ', 'This is not ', 'This is one ',
    'Instead of ', 'For example ', 'For instance ',
    'However, ', 'Therefore, ', 'Moreover, ',
    'Furthermore, ', 'Additionally, ',
    'In addition, ', 'As a result, ',
    'On the other hand, ', 'In other words, ',
    'It is important ', 'It is not ', 'It is a ',
    'It is possible ', 'It is worth ',
    'It can ', 'It will ', 'It would ',
    'It does not ', 'It may ',
    'The developer ', 'The system ', 'The AI ',
    'The future ', 'The problem ',
    'The key ', 'The main ',
    'The code ', 'The application ',
    'The implementation ', 'The process ',
    'The result ', 'The challenge ',
    'may also ', 'may need to ',
    'may become ', 'will also ',
    'will need to ', 'will become ',
    'can also ', 'can help ',
    'can make ', 'more important ',
    'rather than ', 'as well as ',
    'in order to ', 'so that ',
    'such as ', 'the fact that ',
    'the idea that ', 'the reason is ',
    'the point is ', 'the truth is ',
    'the thing is ', 'it is worth noting ',
    'it is important to ', 'it is possible to ',
    'it is necessary to ',
    'code generation ', 'software development ',
    'programming languages ', 'artificial intelligence ',
    'natural language ', 'version control ',
    'code review ', 'technical debt ',
    'software engineering ', 'programming education ',
    'in the future ', 'over time ',
    'AI systems ', 'AI can ',
    'AI does not ', 'AI may ',
    'AI will ', 'AI-assisted ',
    'AI-generated ', 'AI-driven ',
    'machine learning ', 'deep learning ',
    'user experience ', 'open source ',
    'development environment ', 'development workflow ',
    'production environment ', 'production systems ',
    'automated testing ', 'automated ',
    'security vulnerabilities ', 'security concerns ',
    'development process ', 'development cycle ',
    'software creation ', 'software problems ',
    'programming fundamental ', 'programming skill ',
    'programming paradigm ', 'programming interface ',
    'the AI ', 'the agent ',
    'the model ', 'the system ',
    'the environment ', 'the result ',
    'the implementation ', 'the developer ',
    'the user ', 'the problem ',
    'the solution ', 'the future ',
    'AI coding ', 'AI programming ',
    'AI assistant ', 'AI agent ',
    'AI system ', 'AI model ',
    'AI tool ', 'AI technology ',
    'AI development ', 'AI capability ',
    'AI capabilities ', 'AI-powered ',
    'AI-based ', 'AI-enabled ',
    'machine ', 'machine learning ',
    'deep learning ', 'neural network ',
    'natural language processing ',
    'natural language understanding ',
    'natural language generation ',
    'large language model ',
    'language model ', 'language models ',
    'training data ', 'training process ',
    'inference ', 'prediction ',
    'classification ', 'regression ',
    'clustering ', 'optimization ',
    'reinforcement learning ',
    'supervised learning ',
    'unsupervised learning ',
    'transfer learning ',
    'few-shot learning ',
    'zero-shot learning ',
    'prompt engineering ',
    'prompt design ',
    'prompt optimization ',
    'token ', 'tokens ',
    'tokenization ', 'tokenizer ',
    'context window ',
    'context length ',
    'attention mechanism ',
    'transformer architecture ',
    'embeddings ', 'embedding ',
    'vector database ',
    'retrieval augmented generation ',
    'fine-tuning ', 'fine-tune ',
    'fine-tuned ', 'pre-trained ',
    'pre-training ', 'pretrain ',
    'hallucination ', 'hallucinate ',
    'hallucinated ',
    'grounding ', 'grounded ',
    'evaluation ', 'benchmark ',
    'benchmarking ',
    'alignment ', 'aligned ',
    'safety ', 'harmless ',
    'helpful ', 'honest ',
    'helpfulness ', 'harmlessness ',
    'honesty ',
    'responsible AI ',
    'ethical AI ',
    'AI safety ',
    'AI alignment ',
    'AI ethics ',
    'AI governance ',
    'AI regulation ',
    'AI policy ',
    'AI research ',
    'AI application ',
    'AI applications ',
    'AI use case ',
    'AI use cases ',
    'AI workflow ',
    'AI pipeline ',
    'AI infrastructure ',
    'AI platform ',
    'AI framework ',
    'AI library ',
    'AI service ',
    'AI product ',
    'AI feature ',
    'AI capability ',
    'AI-powered ',
    'AI-driven ',
    'AI-assisted ',
    'AI-generated ',
    'AI-enhanced ',
    'AI-optimized ',
    'AI-enabled ',
    'AI-based ',
    'AI-supported ',
    'AI-augmented ',
    'AI-automated ',
    'AI-integrated ',
  ];

  for (const phrase of phrases) {
    if (!entries.has(phrase) && symbolIndex < maxEntries) {
      entries.set(phrase, indexToSymbol(symbolIndex, PUA_RANGES.phrases));
      symbolIndex++;
    }
  }

  return Object.fromEntries(entries);
}

/**
 * Generate symbol/punctuation entries
 */
function generateSymbolDict() {
  const entries = new Map();
  let symbolIndex = 0;
  const maxEntries = 1024;

  const symbols = [
    // Punctuation with space
    ', ', '. ', '? ', '! ', '; ', ': ',
    // Quotes
    '"', "'", '""', "''",
    // Brackets
    '(', ')', '[', ']', '{', '}', '<', '>',
    // Operators
    '=', '+', '-', '*', '/', '%', '^',
    '&', '|', '~', '!', '@', '#', '$', '\\',
    // Comparison
    '==', '!=', '===', '!==', '<=', '>=',
    // Logical
    '&&', '||',
    // Assignment
    '+=', '-=', '*=', '/=', '%=',
    '&=', '|=', '^=', '||=', '&&=', '??=',
    // Increment/Decrement
    '++', '--',
    // Arrow functions
    '=>',
    // Spread/Rest
    '...',
    // Optional chaining
    '?.',
    // Nullish coalescing
    '??',
    // Template literals
    '${', '`',
    // Regular expressions
    '//', '/g', '/i', '/m', '/gi', '/im',
    // Comments
    '/*', '*/',
    // JSX/TSX
    '<>', '</>', '/>',
    // CSS
    'px', 'em', 'rem', 'vh', 'vw',
    'color:', 'background:', 'margin:', 'padding:',
    'border:', 'font:', 'text-align:',
    // HTML entities
    '&amp;', '&lt;', '&gt;', '&quot;', '&apos;',
  ];

  for (const symbol of symbols) {
    if (!entries.has(symbol) && symbolIndex < maxEntries) {
      entries.set(symbol, indexToSymbol(symbolIndex, PUA_RANGES.symbols));
      symbolIndex++;
    }
  }

  return Object.fromEntries(entries);
}

/**
 * Main generation function
 */
async function generate() {
  console.log('🔤 AICL Dictionary Generator v3');
  console.log('================================\n');

  // 1. Load English words
  console.log('📚 Loading English word list...');
  const englishPaths = [
    '/tmp/english_50k.txt',
    '/tmp/english_50k_mixed.txt',
    '/tmp/google-10000-english.txt',
    join(PROJECT_ROOT, 'dict', 'wordlists', 'english.txt'),
  ];

  let allWords = [];
  const seenWords = new Set();

  for (const path of englishPaths) {
    try {
      const content = readFileSync(path, 'utf-8');
      const words = content.split('\n').filter(w => w.trim());
      for (const word of words) {
        const lower = word.toLowerCase().trim();
        if (lower.length >= 2 && !seenWords.has(lower)) {
          seenWords.add(lower);
          allWords.push(lower);
        }
      }
    } catch (e) {
      // File not found, skip
    }
  }

  // Embedded fallback: ~2500 high-frequency English words
  // (used when external word lists are unavailable)
  if (allWords.length === 0) {
    console.log('   Using embedded word list (external files not found)');
    const fallback = `the be to of and a in that have i it for not on with he as you do at this but his by from they we say her she or an will my one all would there their what so up out if about who get which go me when make can like time no just him know take people into year your good some could them see other than then now look only come its over think also back after use two how our work first well way even new want because any these give day most us is are was were been has had did does doing am does being have having do did doing a about above after again against all am an and any are aren't as at be because been before being below between both but by can can't cannot could couldn't did didn't do does doesn't doing don't down during each few for from further get got had hadn't has hasn't have haven't having he he'd he'll he's her here here's hers herself him himself his how how's i i'd i'll i'm i've if in into is isn't it it's its itself let's me more most mustn't my myself no nor not of off on once only or other ought our ours ourselves out over own same shan't she she'd she'll she's should shouldn't so some such than that that's the their theirs them themselves then there there's these they they'd they'll they're they've this those through to too under until up very was wasn't we we'd we'll we're we've were weren't what what's when when's where where's which while who who's whom why why's will with won't would wouldn't you you'd you'll you're you've your yours yourself yourselves test testing tested tests thing things think going going make making made many much also just like way back even still first last long great little own old right big high different small large next early young important few public bad same able use using used need needs must should could would may might shall can will been being was were does did done do doing go goes going gone got gets getting have has had having is are am was were be been being do does did doing have has had having will would could should may might shall can must need need use using used make making made get gets getting go goes going gone come comes coming know knows knew known think thinks thinking take takes taking see sees saw seen give gives giving look looks looking want wants wanted work works working call calls called try tries trying ask asks asked feel feels feeling seem seems seemed play plays played run runs running move moves moving live lives lived believe believes held holds hold need needs needed help helps helped show shows showed turn turns turned start starts started might might may may shall shall test testing tested tests thing things going make making made many much also just like way back even still first last long great little own old right big high different small large next early young important few public bad same able using used need needs must should could would may might shall can will been being was were does did done do doing go goes going gone got gets getting have has had having is are am was were be been being do does did doing have has had having will would could should may might shall can must need need use using used make making made get gets getting go goes going gone come comes coming know knows knew known think thinks thinking take takes taking see sees saw seen give gives giving look looks looking want wants wanted work works working call calls called try tries trying ask asks asked feel feels feeling seem seems seemed play plays played run runs running move moves moving live lives lived believe believes held holds hold help helps helped show shows showed turn turns turned start starts started`;
    allWords = fallback.split(/\s+/).filter(w => w.length >= 2 && !seenWords.has(w));
    for (const w of allWords) seenWords.add(w);
  }

  console.log(`   Loaded ${allWords.length} unique words\n`);

  // 2. Load code keywords
  console.log('💻 Loading programming language keywords...');
  const keywordsPaths = [
    '/tmp/keywords.yaml',
    join(PROJECT_ROOT, 'dict', 'wordlists', 'keywords.yaml'),
  ];

  let languages = [];
  for (const keywordsPath of keywordsPaths) {
    try {
      const keywordsContent = readFileSync(keywordsPath, 'utf-8');
      languages = parseKeywordsYaml(keywordsContent);
      break;
    } catch (e) {
      // File not found, try next
    }
  }

  // Embedded fallback: common keywords for top languages
  if (languages.length === 0) {
    console.log('   Using embedded keywords (external files not found)');
    languages = [
      { name: 'javascript', version: 'ES2024', keywords: [
        'const','let','var','function','return','if','else','for','while','do',
        'switch','case','break','continue','new','delete','typeof','instanceof',
        'in','of','this','class','extends','super','import','export','default',
        'from','as','async','await','try','catch','finally','throw','yield',
        'static','get','set','constructor','undefined','null','true','false',
        'console','document','window','Math','JSON','Promise','Map','Set',
        'Array','Object','String','Number','Boolean','Symbol','BigInt',
        'Error','TypeError','RangeError','RegExp','Date','Proxy','WeakMap',
        'WeakSet','Reflect','Intl','structuredClone','queueMicrotask',
        'setTimeout','setInterval','clearTimeout','clearInterval',
        'fetch','Request','Response','Headers','URL','URLSearchParams',
        'FormData','Blob','File','FileReader','ReadableStream',
        'WritableStream','TransformStream','WebSocket','EventSource',
        'AbortController','AbortSignal','Event','CustomEvent',
        'addEventListener','removeEventListener','dispatchEvent',
        'querySelector','querySelectorAll','getElementById',
        'getElementsByClassName','getElementsByTagName',
        'createElement','createTextNode','appendChild','removeChild',
        'insertBefore','replaceChild','innerHTML','textContent','outerHTML',
        'className','classList','style','setAttribute','getAttribute',
        'onclick','onload','onerror','onsubmit','onchange','oninput',
        'onfocus','onblur','onmouseover','onmouseout',
        'onkeydown','onkeyup','onkeypress',
        'useState','useEffect','useContext','useRef','useMemo','useCallback',
        'useReducer','React','Component','PureComponent','Fragment',
        'createContext','createRef','forwardRef','memo','lazy','Suspense',
        'createElement','JSX','jsx','tsx',
      ]},
      { name: 'python', version: '3.12', keywords: [
        'def','class','lambda','return','if','elif','else','for','while','break',
        'continue','pass','raise','try','except','finally','assert','del','import',
        'from','as','global','nonlocal','yield','with','async','await',
        'True','False','None','self','cls','and','or','not','in','is',
        'print','input','open','range','enumerate','zip','map','filter',
        'sorted','reversed','list','dict','set','tuple','str','int','float',
        'bool','bytes','bytearray','type','super','isinstance','issubclass',
        'hasattr','getattr','setattr','delattr','dir','vars','locals','globals',
        'abs','round','pow','min','max','sum','len','any','all','next','iter',
        'hash','id','repr','format','callable','chr','ord','bin','hex','oct',
        'divmod','complex','frozenset','memoryview','property','staticmethod',
        'classmethod','__init__','__name__','__file__','__doc__','__all__',
        '__import__','__builtins__','__name__','__spec__','__loader__',
        'math','random','os','sys','json','re','collections','itertools',
        'functools','operator','threading','multiprocessing','asyncio',
        'pathlib','shutil','subprocess','socket','http','urllib','email',
        'html','xml','csv','sqlite3','logging','unittest','argparse',
      ]},
      { name: 'typescript', version: '5.4', keywords: [
        'const','let','var','function','return','if','else','for','while','do',
        'switch','case','break','continue','new','delete','typeof','instanceof',
        'in','of','this','class','extends','super','import','export','default',
        'from','as','async','await','try','catch','finally','throw','yield',
        'interface','type','enum','namespace','declare','abstract','readonly',
        'public','private','protected','static','override','sealed','partial',
        'keyof','typeof','infer','extends','implements','satisfies',
        'string','number','boolean','symbol','bigint','undefined','null',
        'void','never','unknown','any','object','Array','Record','Partial',
        'Required','Readonly','Pick','Omit','Exclude','Extract',
        'NonNullable','ReturnType','Parameters','ConstructorParameters',
        'Promise','Map','Set','WeakMap','WeakSet','ReadonlyMap','ReadonlySet',
        'Partial','Required','Readonly','Pick','Omit','Exclude','Extract',
      ]},
      { name: 'rust', version: '1.77', keywords: [
        'fn','let','mut','const','static','pub','impl','trait','struct','enum',
        'union','match','if','else','for','while','loop','break','continue',
        'return','use','mod','crate','self','super','where','as','ref','move',
        'unsafe','extern','async','await','dyn','type','macro_rules',
        'true','false','Some','None','Ok','Err','Self',
        'Box','Rc','Arc','Mutex','RwLock','RefCell','Cell','Pin',
        'Vec','HashMap','BTreeMap','HashSet','BTreeSet','String','str',
        'Option','Result','Future','Stream','Iterator','IntoIterator',
        'Display','Debug','Clone','Copy','Default','PartialEq','Eq',
        'PartialOrd','Ord','Hash','From','Into','TryFrom','TryInto',
        'AsRef','AsMut','Deref','DerefMut','Drop','Sized','Send','Sync',
      ]},
      { name: 'go', version: '1.22', keywords: [
        'func','package','import','var','const','type','struct','interface',
        'map','chan','go','defer','select','range','close','make','new',
        'delete','len','cap','copy','append','print','println',
        'true','false','iota','nil',
        'int','int8','int16','int32','int64','uint','uint8','uint16','uint32','uint64',
        'float32','float64','complex64','complex128','byte','rune','string','bool',
        'error','any','comparable',
        'fmt','os','io','net','http','json','log','sync','atomic',
        'strings','strconv','math','sort','time','context','errors',
      ]},
      { name: 'java', version: '21', keywords: [
        'public','private','protected','static','final','abstract','class',
        'interface','extends','implements','new','this','super','return',
        'throw','throws','try','catch','finally','synchronized','volatile',
        'transient','native','strictfp','assert','package','import',
        'void','int','long','short','byte','float','double','char','boolean',
        'true','false','null','instanceof','enum','record','sealed','permits',
        'var','yield','switch','case','default','for','while','do','break',
        'continue','if','else','String','System','Integer','Long','Double',
        'Boolean','Object','Class','Math','Arrays','Collections','List',
        'Map','Set','ArrayList','HashMap','HashSet','TreeMap','LinkedList',
        'Stream','Optional','CompletableFuture','Future','Callable','Runnable',
      ]},
    ];
  }
  console.log(`   Found ${languages.length} languages`);

  let totalKeywords = 0;
  for (const lang of languages) {
    totalKeywords += lang.keywords.length;
  }
  console.log(`   Total keywords: ${totalKeywords}\n`);

  // 3. Generate dictionaries
  console.log('📝 Generating dictionaries...');

  const englishDict = generateEnglishDict(allWords);
  console.log(`   English: ${Object.keys(englishDict).length} entries (base words + single letters)`);

  const codeDict = generateCodeDict(languages);
  console.log(`   Code: ${Object.keys(codeDict).length} entries`);

  const phraseDict = generatePhraseDict();
  console.log(`   Phrases: ${Object.keys(phraseDict).length} entries`);

  const markdownDict = generateMarkdownDict();
  console.log(`   Markdown: ${Object.keys(markdownDict).length} entries`);

  const symbolDict = generateSymbolDict();
  console.log(`   Symbols: ${Object.keys(symbolDict).length} entries`);

  const modifierDefs = generateModifiers();
  console.log(`   Modifiers: ${modifierDefs.size} entries`);

  // 4. Save dictionaries
  console.log('\n💾 Saving dictionaries...');

  const englishOutPath = join(PROJECT_ROOT, 'dict', 'english.json');
  writeFileSync(englishOutPath, JSON.stringify(englishDict, null, 2));
  console.log(`   Saved: ${englishOutPath}`);

  const codeOutPath = join(PROJECT_ROOT, 'dict', 'code.json');
  writeFileSync(codeOutPath, JSON.stringify(codeDict, null, 2));
  console.log(`   Saved: ${codeOutPath}`);

  // Merge phrases + markdown + symbols into symbols.json
  const mergedSymbols = { ...phraseDict, ...markdownDict, ...symbolDict };
  const symbolsOutPath = join(PROJECT_ROOT, 'dict', 'symbols.json');
  writeFileSync(symbolsOutPath, JSON.stringify(mergedSymbols, null, 2));
  console.log(`   Saved: ${symbolsOutPath}`);

  // Save modifiers as separate file (shared across all dicts)
  const modifierOut = {};
  for (const [name, { symbol }] of modifierDefs) {
    modifierOut[name] = symbol;
  }
  const modifierOutPath = join(PROJECT_ROOT, 'dict', 'modifiers.json');
  writeFileSync(modifierOutPath, JSON.stringify(modifierOut, null, 2));
  console.log(`   Saved: ${modifierOutPath}`);

  // 5. Summary
  const totalEntries = Object.keys(englishDict).length +
                        Object.keys(codeDict).length +
                        Object.keys(mergedSymbols).length +
                        modifierDefs.size;

  console.log('\n✨ Generation complete!');
  console.log(`   Total entries: ${totalEntries}`);
  console.log(`   English: ${Object.keys(englishDict).length} (base words)`);
  console.log(`   Code: ${Object.keys(codeDict).length}`);
  console.log(`   Phrases/Markdown/Symbols: ${Object.keys(mergedSymbols).length}`);
  console.log(`   Modifiers: ${modifierDefs.size} (shared transform symbols)`);

  // 6. Show samples
  console.log('\n📖 Sample entries:');
  const englishSamples = Object.entries(englishDict).slice(0, 5);
  for (const [pattern, symbol] of englishSamples) {
    console.log(`   ${JSON.stringify(pattern)} → U+${symbol.codePointAt(0).toString(16).toUpperCase()}`);
  }

  console.log('\n   Code samples:');
  const codeSamples = Object.entries(codeDict).slice(0, 5);
  for (const [pattern, symbol] of codeSamples) {
    console.log(`   ${JSON.stringify(pattern)} → U+${symbol.codePointAt(0).toString(16).toUpperCase()}`);
  }

  console.log('\n   Markdown samples:');
  const mdSamples = Object.entries(markdownDict).slice(0, 5);
  for (const [pattern, symbol] of mdSamples) {
    console.log(`   ${JSON.stringify(pattern)} → U+${symbol.codePointAt(0).toString(16).toUpperCase()}`);
  }

  // 7. Show size summary
  const englishSize = Buffer.byteLength(JSON.stringify(englishDict), 'utf-8');
  const codeSize = Buffer.byteLength(JSON.stringify(codeDict), 'utf-8');
  const symbolsSize = Buffer.byteLength(JSON.stringify(mergedSymbols), 'utf-8');

  console.log('\n📦 File sizes:');
  console.log(`   english.json: ${(englishSize / 1024).toFixed(1)} KB`);
  console.log(`   code.json: ${(codeSize / 1024).toFixed(1)} KB`);
  console.log(`   symbols.json: ${(symbolsSize / 1024).toFixed(1)} KB`);
  console.log(`   Total: ${((englishSize + codeSize + symbolsSize) / 1024).toFixed(1)} KB`);

  // 8. Compression test
  console.log('\n🔬 Quick compression test...');
  const allDict = { ...englishDict, ...codeDict, ...mergedSymbols };
  const sorted = Object.entries(allDict).sort((a, b) => b[0].length - a[0].length);

  const testText = 'the quick brown fox jumps over the lazy dog. I am going to the store to buy some food. The weather is nice today and I want to go outside.';
  let encoded = '';
  let ti = 0;
  let matchCount = 0;
  while (ti < testText.length) {
    let found = false;
    for (const [pattern, symbol] of sorted) {
      if (testText.startsWith(pattern, ti)) {
        encoded += symbol;
        ti += pattern.length;
        matchCount++;
        found = true;
        break;
      }
    }
    if (!found) { encoded += testText[ti]; ti++; }
  }

  const origChars = [...testText].length;
  const encChars = [...encoded].length;
  console.log(`   Input: ${origChars} chars`);
  console.log(`   Output: ${encChars} chars`);
  console.log(`   Ratio: ${(origChars / encChars).toFixed(2)}x`);
  console.log(`   Matches: ${matchCount}/${origChars} chars matched`);
}

generate().catch(console.error);
