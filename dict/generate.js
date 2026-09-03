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
    // Common trigrams (frequency order)
    'the', 'and', 'ing', 'her', 'hat', 'his', 'tha', 'ere', 'for', 'ent',
    'ion', 'ter', 'was', 'you', 'ith', 'ver', 'all', 'wit', 'thi', 'igh',
    'tch', 'ight', 'ould', 'ough', 'augh',
    // Common 4-grams
    'tion', 'sion', 'ment', 'ness', 'able', 'ible', 'ful', 'less',
    'ous', 'ive', 'ism', 'ist', 'ize', 'ise', 'ity', 'ence', 'ance',
    'ould', 'ight', 'ough', 'augh', 'ight', 'ould',
    'ther', 'that', 'with', 'this', 'will', 'your', 'from', 'they',
    'been', 'have', 'more', 'when', 'some', 'them', 'than', 'many',
    'each', 'like', 'just', 'over', 'such', 'take', 'year', 'them',
    'very', 'what', 'about', 'would', 'make', 'time', 'could', 'other',
    'thing', 'these', 'two', 'may', 'then', 'call', 'first', 'know',
    'come', 'also', 'well', 'back', 'only', 'even', 'give', 'most',
    // Common 5-grams
    'ement', 'ation', 'ities', 'ously', 'ively', 'ness', 'istic',
    'ating', 'ately', 'ement', 'ously', 'ively',
    // Common prefixes
    'un', 're', 'in', 'dis', 'pre', 'pro', 'con', 'com', 'mis',
    'over', 'sub', 'semi', 'anti', 'de', 'inter', 'trans', 'super',
    'non', 'ex', 'post', 'under', 'out', 'up',
    // Common suffixes
    'ed', 'ing', 'ly', 'er', 'est', 'tion', 'sion', 'ment',
    'ness', 'able', 'ible', 'ful', 'less', 'ous', 'ive', 'ism',
    'ist', 'ize', 'ity', 'ence', 'ance', 'dom', 'ship', 'hood',
    // Common code fragments (2-3 char)
    'fn', 'cb', 'pt', 'rt', 'mt', 'op', 'cl', 'pr', 'tr', 'cr',
    'br', 'fr', 'gr', 'pl', 'bl', 'fl', 'sl', 'sp', 'sc', 'sk',
    'sm', 'sn', 'sw', 'tw', 'str', 'spr', 'scr', 'shr', 'spl',
    'src', 'dst', 'idx', 'pos', 'len', 'buf', 'ctx', 'req', 'res',
    'err', 'val', 'ret', 'ref', 'ptr', 'mem', 'num', 'str', 'arr',
    'obj', 'tmp', 'cur', 'prev', 'next', 'head', 'tail', 'node',
    'key', 'val', 'map', 'set', 'lst', 'vec', 'stk', 'que',
    'fmt', 'log', 'dbg', 'msg', 'evt', 'cmd', 'arg', 'env',
    'dir', 'file', 'path', 'url', 'uri', 'dns', 'tcp', 'udp',
    'ssl', 'tls', 'rsa', 'aes', 'md5', 'sha', 'hmac',
    'cpu', 'gpu', 'ram', 'rom', 'ssd', 'hdd', 'usb', 'pci',
    'lan', 'wan', 'nat', 'dhcp', 'smtp', 'pop3', 'imap',
    'http', 'ws', 'ws', 'api', 'sdk', 'ide', 'gui', 'cli',
    // Common number combos
    '00', '01', '10', '11', '12', '20', '24', '32', '64', '128', '256', '512', '1024',
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
    // 3-letter letter+digit combos (most common)
    'ab0','ab1','ab2','ab3','ab4','ab5','ab6','ab7','ab8','ab9',
    'ac0','ac1','ac2','ac3','ac4','ac5','ac6','ac7','ac8','ac9',
    'ad0','ad1','ad2','ad3','ad4','ad5','ad6','ad7','ad8','ad9',
    'an0','an1','an2','an3','an4','an5','an6','an7','an8','an9',
    'ar0','ar1','ar2','ar3','ar4','ar5','ar6','ar7','ar8','ar9',
    'at0','at1','at2','at3','at4','at5','at6','at7','at8','at9',
    'ca0','ca1','ca2','ca3','ca4','ca5','ca6','ca7','ca8','ca9',
    'co0','co1','co2','co3','co4','co5','co6','co7','co8','co9',
    'de0','de1','de2','de3','de4','de5','de6','de7','de8','de9',
    'di0','di1','di2','di3','di4','di5','di6','di7','di8','di9',
    'ex0','ex1','ex2','ex3','ex4','ex5','ex6','ex7','ex8','ex9',
    'fi0','fi1','fi2','fi3','fi4','fi5','fi6','fi7','fi8','fi9',
    'fo0','fo1','fo2','fo3','fo4','fo5','fo6','fo7','fo8','fo9',
    'ge0','ge1','ge2','ge3','ge4','ge5','ge6','ge7','ge8','ge9',
    'go0','go1','go2','go3','go4','go5','go6','go7','go8','go9',
    'ha0','ha1','ha2','ha3','ha4','ha5','ha6','ha7','ha8','ha9',
    'he0','he1','he2','he3','he4','he5','he6','he7','he8','he9',
    'in0','in1','in2','in3','in4','in5','in6','in7','in8','in9',
    'is0','is1','is2','is3','is4','is5','is6','is7','is8','is9',
    'it0','it1','it2','it3','it4','it5','it6','it7','it8','it9',
    'la0','la1','la2','la3','la4','la5','la6','la7','la8','la9',
    'le0','le1','le2','le3','le4','le5','le6','le7','le8','le9',
    'ma0','ma1','ma2','ma3','ma4','ma5','ma6','ma7','ma8','ma9',
    'me0','me1','me2','me3','me4','me5','me6','me7','me8','me9',
    'mu0','mu1','mu2','mu3','mu4','mu5','mu6','mu7','mu8','mu9',
    'ne0','ne1','ne2','ne3','ne4','ne5','ne6','ne7','ne8','ne9',
    'no0','no1','no2','no3','no4','no5','no6','no7','no8','no9',
    'on0','on1','on2','on3','on4','on5','on6','on7','on8','on9',
    'or0','or1','or2','or3','or4','or5','or6','or7','or8','or9',
    'pa0','pa1','pa2','pa3','pa4','pa5','pa6','pa7','pa8','pa9',
    'pe0','pe1','pe2','pe3','pe4','pe5','pe6','pe7','pe8','pe9',
    'pl0','pl1','pl2','pl3','pl4','pl5','pl6','pl7','pl8','pl9',
    'pr0','pr1','pr2','pr3','pr4','pr5','pr6','pr7','pr8','pr9',
    're0','re1','re2','re3','re4','re5','re6','re7','re8','re9',
    'se0','se1','se2','se3','se4','se5','se6','se7','se8','se9',
    'sh0','sh1','sh2','sh3','sh4','sh5','sh6','sh7','sh8','sh9',
    'st0','st1','st2','st3','st4','st5','st6','st7','st8','st9',
    'su0','su1','su2','su3','su4','su5','su6','su7','su8','su9',
    'te0','te1','te2','te3','te4','te5','te6','te7','te8','te9',
    'th0','th1','th2','th3','th4','th5','th6','th7','th8','th9',
    'to0','to1','to2','to3','to4','to5','to6','to7','to8','to9',
    'tr0','tr1','tr2','tr3','tr4','tr5','tr6','tr7','tr8','tr9',
    'un0','un1','un2','un3','un4','un5','un6','un7','un8','un9',
    'up0','up1','up2','up3','up4','up5','up6','up7','up8','up9',
    'us0','us1','us2','us3','us4','us5','us6','us7','us8','us9',
    've0','ve1','ve2','ve3','ve4','ve5','ve6','ve7','ve8','ve9',
    'vi0','vi1','vi2','vi3','vi4','vi5','vi6','vi7','vi8','vi9',
    'wh0','wh1','wh2','wh3','wh4','wh5','wh6','wh7','wh8','wh9',
    'wi0','wi1','wi2','wi3','wi4','wi5','wi6','wi7','wi8','wi9',
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

    // Additional JavaScript/Node.js patterns
    'process.exit(', 'process.argv', 'process.cwd()',
    'Buffer.from(', 'Buffer.alloc(', 'Buffer.concat(',
    'path.join(', 'path.resolve(', 'path.basename(',
    'fs.existsSync(', 'fs.mkdirSync(', 'fs.rmSync(',
    'os.platform()', 'os.arch()', 'os.cpus()',
    'util.promisify(', 'util.inspect(',
    'crypto.createHash(', 'crypto.randomBytes(',
    'zlib.createGzip(', 'zlib.createDeflate(',
    'http.request(', 'https.request(',
    'net.createServer(', 'tls.connect(',
    'cluster.fork()', 'worker_threads',
    'perf_hooks.', 'async_hooks.',
    'globalThis.', 'global.',
    'Symbol.iterator', 'Symbol.asyncIterator',
    'WeakRef', 'FinalizationRegistry',
    'AbortController', 'AbortSignal',
    'structuredClone(', 'queueMicrotask(',
    'performance.now()', 'performance.mark(',
    'performance.measure(', 'performance.clearMarks(',

    // Additional Python patterns
    'async def ', 'await ', 'async with ',
    'async for ', 'yield from ',
    'dataclass', 'dataclasses',
    'typing.', 'Type[', 'List[', 'Dict[', 'Tuple[', 'Optional[',
    'Union[', 'Any', 'Callable[', 'Iterator[', 'Generator[',
    'Protocol', 'runtime_checkable',
    'pathlib.', 'Path(', 'Path.home(',
    'logging.', 'getLogger(', 'basicConfig(',
    'json.load(', 'json.dump(', 'json.loads(', 'json.dumps(',
    'csv.reader(', 'csv.writer(', 'csv.DictReader(',
    're.match(', 're.search(', 're.findall(', 're.sub(',
    'subprocess.run(', 'subprocess.Popen(',
    'threading.Thread(', 'multiprocessing.Process(',
    'concurrent.futures.', 'ThreadPoolExecutor(',
    'asyncio.run(', 'asyncio.gather(', 'asyncio.create_task(',
    'click.command(', 'click.option(', 'click.argument(',
    'flask.Flask(', 'app.route(', 'request.json',
    'django.', 'models.Model', 'views.',
    'admin.site', 'urls.patterns',
    'pytest.fixture', 'pytest.mark', 'assert ',

    // Additional Rust patterns
    'impl ', 'trait ', 'derive(',
    '#[derive(', '#[cfg(', '#[test]',
    '#[allow(', '#[deny(', '#[warn(',
    'Option<', 'Result<', 'Some(', 'None',
    'Ok(', 'Err(', '.unwrap(', '.expect(',
    '.map(', '.and_then(', '.or_else(',
    '.unwrap_or(', '.unwrap_or_default(',
    'Vec::with_capacity(', 'String::with_capacity(',
    'HashMap::with_capacity(', 'BTreeMap::new(',
    'iter().map(', 'iter().filter(', 'iter().fold(',
    'iter().collect(', 'iter().enumerate(',
    'iter().zip(', 'iter().any(', 'iter().all(',
    'iter().find(', 'iter().position(',
    'slice::from_raw_parts(', 'mem::swap(',
    'mem::replace(', 'mem::take(',
    'std::io::', 'std::fs::', 'std::path::',
    'std::collections::', 'std::sync::',
    'std::time::', 'std::thread::',
    'tokio::', 'async_std::',
    'serde::', 'serde_json::',
    'reqwest::', 'clap::',

    // Additional Go patterns
    'func(', 'func (', 'func main()',
    'if err != nil', 'if err :=',
    'switch v :=', 'switch {',
    'select case', 'case <-',
    'go func()', 'go func() {',
    'defer func()', 'defer func() {',
    'chan ', '<-chan ', 'chan<- ',
    'make([]', 'make(map[', 'make(chan ',
    'new([]', 'new(map[',
    'append(', 'copy(', 'delete(', 'len(', 'cap(',
    'fmt.Println(', 'fmt.Printf(', 'fmt.Sprintf(',
    'fmt.Fprintf(', 'fmt.Errorf(',
    'log.Fatal(', 'log.Printf(', 'log.Println(',
    'os.Args', 'os.Open(', 'os.Create(',
    'os.Getenv(', 'os.Setenv(',
    'io.Reader', 'io.Writer', 'io.Copy(',
    'json.Marshal(', 'json.Unmarshal(',
    'http.Get(', 'http.Post(', 'http.Handle(',
    'http.HandleFunc(', 'http.ListenAndServe(',
    'gin.Context', 'c.JSON(', 'c.Bind(',
    'echo.Context', 'e.GET(', 'e.POST(',
    'gorilla/mux', 'chi.Route',

    // Additional Java patterns
    'public static void main', 'public class ',
    'private ', 'protected ', 'final ',
    'abstract class ', 'extends ', 'implements ',
    'new ArrayList<', 'new HashMap<', 'new HashSet<',
    'new LinkedList<', 'new TreeMap<', 'new LinkedHashMap<',
    'Collections.sort(', 'Collections.unmodifiableList(',
    'Arrays.asList(', 'Arrays.sort(', 'Arrays.copyOf(',
    'String.format(', 'String.join(', 'String.split(',
    'Integer.parseInt(', 'Double.parseDouble(',
    'Boolean.parseBoolean(', 'Long.parseLong(',
    'Optional.of(', 'Optional.empty(', 'Optional.ofNullable(',
    'Stream.of(', 'Stream.iterate(', 'Stream.generate(',
    '.stream().', '.parallelStream().',
    '.map(', '.filter(', '.reduce(',
    '.collect(', '.toList(', '.toSet(',
    '.forEach(', '.findFirst(', '.findAny(',
    '.anyMatch(', '.allMatch(', '.noneMatch(',
    '.count(', '.sum(', '.average(',
    'CompletableFuture.supplyAsync(',
    'CompletableFuture.allOf(',
    'HttpClient.newHttpClient(',
    'HttpRequest.newBuilder(',
    'HttpResponse.BodyHandlers.ofString(',
    '@Override', '@Deprecated', '@SuppressWarnings(',
    '@FunctionalInterface', '@SafeVarargs',

    // Additional C# patterns
    'var ', 'dynamic ', 'object ',
    'List<', 'Dictionary<', 'HashSet<', 'Queue<', 'Stack<',
    'LinkedList<', 'SortedSet<', 'SortedDictionary<',
    'ConcurrentBag<', 'ConcurrentDictionary<', 'ConcurrentQueue<',
    'System.Collections.', 'System.Linq.',
    'System.Threading.Tasks.', 'System.Net.Http.',
    'System.Text.Json.', 'System.Text.RegularExpressions.',
    'System.IO.', 'System.Security.Cryptography.',
    'Task.Run(', 'Task.WhenAll(', 'Task.WhenAny(',
    'await ', 'async Task<', 'async void ',
    'CancellationToken', 'CancellationTokenSource',
    'IAsyncEnumerable<', 'IAsyncDisposable',
    'ValueTask<', 'ValueTuple<',
    'Span<', 'Memory<', 'ReadOnlySpan<', 'ReadOnlyMemory<',
    'stackalloc ', 'fixed (', 'using (',
    'lock (', 'Monitor.', 'Mutex.',
    'SemaphoreSlim(', 'AutoResetEvent(', 'ManualResetEvent(',
    'Interlocked.', 'Volatile.', 'Thread.MemoryBarrier(',
    'GC.Collect(', 'GC.SuppressFinalize(',
    'GC.GetTotalMemory(', 'GC.WaitForPendingFinalizers(',

    // Additional PHP patterns
    'namespace ', 'use ',
    'public function ', 'private function ', 'protected function ',
    'public static function ', 'private static function ',
    'abstract class ', 'final class ', 'interface ',
    'trait ', 'enum ',
    '$this->', 'self::', 'parent::', 'static::',
    'new ', 'clone ', 'instanceof ',
    'match(', 'str_contains(', 'str_starts_with(', 'str_ends_with(',
    'array_key_first(', 'array_key_last(',
    'array_push(', 'array_pop(', 'array_shift(', 'array_unshift(',
    'array_merge(', 'array_combine(', 'array_chunk(',
    'array_slice(', 'array_splice(', 'array_search(',
    'in_array(', 'array_key_exists(', 'isset(', 'empty(',
    'unset(', 'compact(', 'extract(',
    'call_user_func(', 'call_user_func_array(',
    'func_get_args(', 'func_num_args(',
    'class_exists(', 'interface_exists(', 'trait_exists(',
    'method_exists(', 'property_exists(',
    'get_class(', 'get_parent_class(',
    'is_a(', 'is_subclass_of(', 'get_class_methods(',
    'get_class_vars(', 'get_object_vars(',

    // Additional Ruby patterns
    'attr_accessor ', 'attr_reader ', 'attr_writer ',
    'include ', 'extend ', 'prepend ',
    'module_function', 'private_class_method',
    'protected_method_defined?', 'private_method_defined?',
    'instance_methods', 'instance_methods(',
    'public_instance_methods', 'protected_instance_methods',
    'private_instance_methods', 'public_methods',
    'protected_methods', 'private_methods',
    'ancestors', 'included_modules', 'superclass',
    'method(:', 'instance_method(',
    'send(', 'public_send(', 'respond_to?(',
    'method_missing(', 'singleton_method(',
    'define_method(', 'class_eval(', 'instance_eval(',
    'module_eval(', 'class_variable_get(',
    'class_variable_set(', 'instance_variable_get(',
    'instance_variable_set(', 'const_get(', 'const_set(',
    'ObjectSpace.', 'GC.', 'Marshal.dump(',
    'Marshal.load(', 'YAML.load(', 'YAML.dump(',
    'JSON.parse(', 'JSON.generate(', 'JSON.pretty_generate(',

    // Additional TypeScript patterns
    'type ', 'interface ', 'enum ', 'namespace ',
    'declare ', 'module ', 'readonly ',
    'keyof ', 'typeof ', 'infer ',
    'Partial<', 'Required<', 'Readonly<',
    'Pick<', 'Omit<', 'Record<',
    'Extract<', 'Exclude<', 'NonNullable<',
    'ReturnType<', 'InstanceType<',
    'Parameters<', 'ConstructorParameters<',
    'AsyncGenerator<', 'Generator<',
    'Awaited<', 'PromiseLike<',
    'Disposable', 'AsyncDisposable',
    'Symbol.dispose', 'Symbol.asyncDispose',
    'satisfies ', 'as const', 'as const satisfies',
    'declare module ', 'declare namespace ',
    'declare global', 'declare function',
    'declare class', 'declare interface',
    'declare type', 'declare enum',
    'declare const', 'declare var',
    'declare let', 'declare function',

    // Additional CSS patterns
    'display:', 'position:', 'width:', 'height:',
    'margin:', 'padding:', 'border:', 'background:',
    'color:', 'font-size:', 'font-weight:', 'font-family:',
    'text-align:', 'text-decoration:', 'text-transform:',
    'line-height:', 'letter-spacing:', 'word-spacing:',
    'flex:', 'flex-direction:', 'flex-wrap:', 'justify-content:',
    'align-items:', 'align-self:', 'order:',
    'grid-template-columns:', 'grid-template-rows:',
    'grid-gap:', 'grid-column:', 'grid-row:',
    'animation:', 'transition:', 'transform:',
    'opacity:', 'visibility:', 'z-index:',
    'overflow:', 'cursor:', 'user-select:',
    'box-shadow:', 'text-shadow:', 'border-radius:',
    'border-color:', 'border-style:', 'border-width:',
    'outline:', 'resize:', 'appearance:',
    'content:', 'quotes:', 'counter-reset:',
    'counter-increment:', 'list-style:', 'table-layout:',
    'caption-side:', 'empty-cells:', 'vertical-align:',
    'white-space:', 'word-break:', 'overflow-wrap:',
    'hyphens:', 'tab-size:', 'moz-tab-size:',
    'webkit-', 'moz-', 'ms-', 'o-',
    '@media', '@keyframes', '@font-face',
    '@import', '@charset', '@supports',
    ':root', ':before', ':after', ':first-child',
    ':last-child', ':nth-child(', ':not(',
    ':hover', ':focus', ':active', ':visited',
    ':enabled', ':disabled', ':checked',
    ':required', ':optional', ':valid', ':invalid',
    '::before', '::after', '::first-line',
    '::first-letter', '::selection', '::placeholder',

    // Additional HTML patterns
    '<div', '<span', '<p', '<a', '<img',
    '<ul', '<ol', '<li', '<table', '<tr',
    '<td', '<th', '<thead', '<tbody', '<tfoot',
    '<form', '<input', '<select', '<option', '<textarea',
    '<button', '<label', '<fieldset', '<legend',
    '<h1', '<h2', '<h3', '<h4', '<h5', '<h6',
    '<header', '<footer', '<main', '<nav', '<aside',
    '<section', '<article', '<figure', '<figcaption',
    '<video', '<audio', '<source', '<track',
    '<canvas', '<svg', '<path', '<circle', '<rect',
    '<iframe', '<embed', '<object', '<param',
    '<meta', '<link', '<title', '<base',
    '<style', '<script', '<noscript', '<template',
    '<slot', '<dialog', '<details', '<summary',
    'class="', 'id="', 'style="', 'data-',
    'href="', 'src="', 'alt="', 'title="',
    'type="', 'name="', 'value="', 'placeholder="',
    'action="', 'method="', 'enctype="',
    'target="', 'rel="', 'download="',
    'aria-', 'role="', 'tabindex="',
    'xmlns="', 'viewBox="', 'd="',
    'fill="', 'stroke="', 'stroke-width="',
    'transform="', 'opacity="', 'clip-path="',

    // Additional SQL patterns
    'INSERT INTO ', 'VALUES (', 'RETURNING ',
    'UPDATE ', 'SET ', 'DELETE FROM ',
    'CREATE TABLE ', 'ALTER TABLE ', 'DROP TABLE ',
    'CREATE INDEX ', 'DROP INDEX ',
    'CREATE VIEW ', 'DROP VIEW ',
    'CREATE SCHEMA ', 'DROP SCHEMA ',
    'CREATE DATABASE ', 'DROP DATABASE ',
    'TRUNCATE TABLE ', 'RENAME TABLE ',
    'ADD COLUMN ', 'DROP COLUMN ',
    'ALTER COLUMN ', 'RENAME COLUMN ',
    'ADD CONSTRAINT ', 'DROP CONSTRAINT ',
    'PRIMARY KEY', 'FOREIGN KEY',
    'UNIQUE', 'CHECK (', 'DEFAULT ',
    'NOT NULL', 'NULL',
    'AUTO_INCREMENT', 'SERIAL', 'BIGSERIAL',
    'GENERATED ALWAYS AS', 'GENERATED BY DEFAULT AS',
    'ON DELETE CASCADE', 'ON UPDATE CASCADE',
    'ON DELETE SET NULL', 'ON DELETE RESTRICT',
    'ON UPDATE SET NULL', 'ON UPDATE RESTRICT',
    'CONSTRAINT ', 'REFERENCES ',
    'EXPLAIN ', 'EXPLAIN ANALYZE ',
    'BEGIN', 'COMMIT', 'ROLLBACK',
    'SAVEPOINT', 'RELEASE SAVEPOINT',
    'SET TRANSACTION', 'ISOLATION LEVEL',
    'READ COMMITTED', 'READ UNCOMMITTED',
    'REPEATABLE READ', 'SERIALIZABLE',
    'LOCK TABLE', 'UNLOCK TABLE',
    'GRANT ', 'REVOKE ',
    'SELECT DISTINCT', 'SELECT COUNT(',
    'SELECT SUM(', 'SELECT AVG(', 'SELECT MIN(', 'SELECT MAX(',
    'GROUP BY ', 'HAVING ',
    'ORDER BY ASC', 'ORDER BY DESC',
    'LIMIT ALL', 'FETCH FIRST', 'OFFSET ',
    'UNION ALL', 'INTERSECT', 'EXCEPT',
    'WITH RECURSIVE', 'WITH ',
    'CASE WHEN', 'END AS',
    'COALESCE(', 'NULLIF(', 'CAST(',
    'EXTRACT(', 'DATE_TRUNC(', 'NOW()',
    'CURRENT_DATE', 'CURRENT_TIMESTAMP',
    'CURRENT_USER', 'SESSION_USER',
    'INFORMATION_SCHEMA.', 'pg_catalog.',
    'pg_class', 'pg_attribute', 'pg_type',
    'pg_stat_', 'pg_locks',
    'pg_size_pretty(', 'pg_total_relation_size(',
    'pg_indexes_size(', 'pg_table_size(',

    // Additional shell/terminal patterns
    'echo ', 'printf ', 'read ',
    'if [ ', 'then ', 'else ', 'elif ',
    'fi', 'case ', 'esac',
    'for ', 'while ', 'until ',
    'do ', 'done', 'break', 'continue',
    'function ', 'return ',
    'local ', 'declare ', 'typeset ',
    'export ', 'unset ', 'readonly ',
    'source ', '. ',
    'cd ', 'pwd', 'pushd ', 'popd ',
    'ls ', 'll ', 'la ', 'l ',
    'find ', 'grep ', 'egrep ', 'fgrep ',
    'awk ', 'sed ', 'sort ', 'uniq ',
    'cut ', 'tr ', 'wc ', 'head ', 'tail ',
    'cat ', 'less ', 'more ', 'head ',
    'tail -f ', 'watch ',
    'cp ', 'mv ', 'rm ', 'mkdir ', 'rmdir ',
    'chmod ', 'chown ', 'chgrp ',
    'ln -s ', 'ln ',
    'touch ', 'stat ',
    'file ', 'du ', 'df ',
    'ps ', 'top ', 'htop ', 'kill ',
    'killall ', 'pkill ', 'pgrep ',
    'nohup ', 'disown ', 'bg ', 'fg ',
    'jobs ', 'wait ',
    'ssh ', 'scp ', 'rsync ',
    'wget ', 'curl ',
    'tar ', 'gzip ', 'gunzip ',
    'zip ', 'unzip ',
    'apt ', 'apt-get ', 'yum ', 'dnf ',
    'pacman ', 'brew ', 'snap ',
    'systemctl ', 'journalctl ',
    'docker ', 'docker-compose ',
    'kubectl ', 'helm ',
    'git ', 'git add ', 'git commit ',
    'git push ', 'git pull ', 'git fetch ',
    'git branch ', 'git checkout ', 'git switch ',
    'git merge ', 'git rebase ', 'git cherry-pick ',
    'git stash ', 'git pop ',
    'git log ', 'git diff ', 'git status ',
    'git remote ', 'git clone ',
    'npm ', 'npx ', 'yarn ', 'pnpm ',
    'node ', 'python ', 'python3 ',
    'ruby ', 'perl ', 'lua ',
    'php ', 'java ', 'javac ',
    'gcc ', 'g++ ', 'clang ',
    'make ', 'cmake ',
    'cargo ', 'rustc ',
    'go ', 'go build ', 'go run ',
    'dotnet ', 'nuget ',
    'gradle ', 'maven ', 'mvn ',
    'ant ', 'javac ',
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

    // Common English collocations
    'each other ', 'one another ',
    'at the same time ', 'in the first place ',
    'on average ', 'in particular ',
    'for the most part ', 'by far ',
    'all the time ', 'every time ',
    'each time ', 'no time ',
    'at any time ', 'at all times ',
    'from time to time ', 'in no time ',
    'for a long time ', 'for a while ',
    'right away ', 'right here ',
    'right there ', 'all day ',
    'all night ', 'all year ',
    'every day ', 'every week ',
    'every month ', 'every year ',
    'last week ', 'last month ',
    'last year ', 'next week ',
    'next month ', 'next year ',
    'this week ', 'this month ',
    'this year ', 'so long ',
    'long ago ', 'not long ',
    'just now ', 'by now ',
    'until now ', 'up to now ',
    'once again ', 'once more ',
    'over and over ', 'time and time ',
    'again and again ', 'more and more ',
    'less and less ', 'better and better ',
    'worse and worse ', 'bigger and bigger ',
    'smaller and smaller ', 'faster and faster ',
    'slower and slower ', 'higher and higher ',
    'lower and lower ',

    // Common verb collocations
    'take place ', 'make sense ',
    'make a difference ', 'make sure ',
    'keep in mind ', 'keep track ',
    'pay attention ', 'play a role ',
    'play a part ', 'set up ',
    'figure out ', 'find out ',
    'point out ', 'bring up ',
    'come up with ', 'end up ',
    'wind up ', 'look into ',
    'check out ', 'hang out ',
    'chill out ', 'calm down ',
    'slow down ', 'speed up ',
    'wake up ', 'grow up ',
    'show up ', 'give up ',
    'never mind ', 'go ahead ',
    'come back ', 'go back ',
    'look back ', 'turn around ',
    'walk away ', 'run away ',
    'stay away ', 'keep away ',

    // Technical/AI phrases (expanded)
    'is a type of ', 'is a form of ',
    'is a way to ', 'is used to ',
    'is designed to ', 'is intended to ',
    'is capable of ', 'is able to ',
    'is known for ', 'is famous for ',
    'is based on ', 'is built on ',
    'is derived from ', 'is inspired by ',
    'is similar to ', 'is different from ',
    'is related to ', 'is connected to ',
    'is part of ', 'is a subset of ',
    'is a component of ', 'is an example of ',
    'is a type of machine learning ',
    'is a subset of artificial intelligence ',
    'is a branch of computer science ',
    'is a field of study ',
    'is an area of research ',
    'is a technique for ',
    'is a method for ',
    'is an approach to ',
    'is a way of ',
    'is a process for ',
    'is a system for ',
    'is a tool for ',
    'is a framework for ',
    'is a library for ',
    'is a package for ',
    'is a module for ',

    // Time expressions
    'a long time ago ',
    'a short time ago ',
    'just a moment ',
    'in a moment ',
    'in a minute ',
    'in a second ',
    'in an instant ',
    'right this moment ',
    'at this very moment ',
    'as we speak ',
    'as of now ',
    'as of today ',
    'as of this writing ',
    'as of this moment ',
    'as of this date ',
    'as of this point ',

    // Position/direction
    'on top of ',
    'at the bottom of ',
    'on the left side ',
    'on the right side ',
    'in the middle of ',
    'at the edge of ',
    'in the center of ',
    'at the front of ',
    'at the back of ',
    'on the side of ',
    'in front of ',
    'behind the ',
    'next to the ',
    'across from ',
    'away from ',
    'toward the ',
    'away from the ',

    // Quantity expressions
    'a large number of ',
    'a small number of ',
    'a great deal of ',
    'a bit of ',
    'a little bit of ',
    'a whole lot of ',
    'a ton of ',
    'a bunch of ',
    'a handful of ',
    'dozens of ',
    'hundreds of ',
    'thousands of ',
    'millions of ',
    'billions of ',
    'trillions of ',

    // Contrast/concession
    'on the one hand ',
    'on the other hand ',
    'in contrast to ',
    'compared to ',
    'compared with ',
    'as opposed to ',
    'rather than ',
    'instead of ',
    'but also ',
    'not only ',
    'both and ',
    'either or ',
    'neither nor ',
    'whether or not ',
    'regardless of ',
    'in spite of ',
    'despite the fact that ',
    'even though ',
    'even if ',
    'as though ',
    'as if ',

    // Purpose/reason
    'in order to ',
    'so as to ',
    'for the purpose of ',
    'with the goal of ',
    'with the aim of ',
    'in hopes of ',
    'for the sake of ',
    'on behalf of ',
    'for the benefit of ',
    'for the good of ',

    // Manner
    'in a way ',
    'in many ways ',
    'in some ways ',
    'in most ways ',
    'in all ways ',
    'in terms of ',
    'with regard to ',
    'in respect to ',
    'with respect to ',
    'in relation to ',
    'relative to ',
    'concerning ',
    'regarding ',
    'pertaining to ',
    'having to do with ',

    // Probability/certainty
    'for sure ',
    'for certain ',
    'without a doubt ',
    'beyond doubt ',
    'no doubt ',
    'undoubtedly ',
    'without question ',
    'beyond question ',
    'arguably ',
    'most likely ',
    'more likely than not ',
    'less likely ',
    'unlikely ',
    'impossible ',
    'certainly ',
    'definitely ',
    'absolutely ',
    'positively ',
    'unquestionably ',
    'indisputably ',
    'undeniably ',

    // Condition/hypothesis
    'in the event that ',
    'in case ',
    'provided that ',
    'assuming that ',
    'given that ',
    'supposing that ',
    'if and only if ',
    'as long as ',
    'subject to ',
    'conditional on ',
    'contingent on ',
    'dependent on ',
    'reliant on ',
    'based on the assumption ',
    'based on the premise ',

    // Common AI assistant phrases
    'I understand ',
    'I can help ',
    'I can assist ',
    'I will help ',
    'I will assist ',
    'let me help ',
    'let me explain ',
    'let me clarify ',
    'here is how ',
    'here is what ',
    'here are the steps ',
    'first, ',
    'second, ',
    'third, ',
    'finally, ',
    'in summary, ',
    'to summarize, ',
    'in conclusion, ',
    'to conclude, ',
    'overall, ',
    'generally speaking, ',
    'broadly speaking, ',
    'in general, ',
    'for the most part, ',
    'on the whole, ',
    'all things considered, ',
    'taking everything into account, ',
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
    // JSON structure patterns (high-frequency)
    '": "', '", ', '":', '": ',
    '{"', '}"', '["', '"]',
    '"null"', '"true"', '"false"',
    '"name"', '"value"', '"data"', '"error"', '"status"',
    '"id"', '"type"', '"key"', '"item"', '"items"',
    '"count"', '"total"', '"page"', '"limit"',
    '"message"', '"result"', '"success"',
    '"user"', '"users"', '"task"', '"tasks"',
    '"title"', '"desc"', '"content"',
    '"url"', '"path"', '"method"',
    '"created"', '"updated"', '"config"',
    '"options"', '"settings"', '"response"', '"request"',
    '"header"', '"headers"', '"body"', '"params"', '"query"',
    // XML/HTML patterns
    '<div>', '</div>', '<span>', '</span>',
    '<p>', '</p>', '<a>', '</a>',
    '<ul>', '</ul>', '<ol>', '</ol>', '<li>', '</li>',
    '<table>', '</table>', '<tr>', '</tr>',
    '<td>', '</td>', '<th>', '</th>',
    '<form>', '</form>', '<input', '<button>',
    '<h1>', '</h1>', '<h2>', '</h2>', '<h3>', '</h3>',
    '<header>', '</header>', '<footer>', '</footer>',
    '<main>', '</main>', '<nav>', '</nav>',
    '<section>', '</section>', '<article>', '</article>',
    '<script>', '</script>', '<style>', '</style>',
    '<meta', '<link', '<title>', '</title>',
    '<img', '<br', '<hr',
    '<!-- ', ' -->', '<!DOCTYPE',
    'xmlns="', 'viewBox="', 'class="', 'style="',
    'data-', 'aria-', 'role="',
    'src="', 'href="', 'alt="', 'title="',
    'type="', 'name="', 'value="', 'placeholder="',
    'action="', 'method="', 'target="', 'rel="',
    'width="', 'height="', 'id="',
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
    '/tmp/google-10000-usa.txt',
    '/tmp/google-10000-no-swears.txt',
    '/tmp/combined_english.txt',
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
    const fallback = `the be to of and a in that have i it for not on with he as you do at this but his by from they we say her she or an will my one all would there their what so up out if about who get which go me when make can like time no just him know take people into year your good some could them see other than then now look only come its over think also back after use two how our work first well way even new want because any these give day most us is are was were been has had did does doing am does being have having do did doing a about above after again against all am an and any are aren't as at be because been before being below between both but by can can't cannot could couldn't did didn't do does doesn't doing don't down during each few for from further get got had hadn't has hasn't have haven't having he he'd he'll he's her here here's hers herself him himself his how how's i i'd i'll i'm i've if in into is isn't it it's its itself let's me more most mustn't my myself no nor not of off on once only or other ought our ours ourselves out over own same shan't she she'd she'll she's should shouldn't so some such than that that's the their theirs them themselves then there there's these they they'd they'll they're they've this those through to too under until up very was wasn't we we'd we'll we're we've were weren't what what's when when's where where's which while who who's whom why why's will with won't would wouldn't you you'd you'll you're you've your yours yourself yourselves test testing tested tests thing things think going going make making made many much also just like way back even still first last long great little own old right big high different small large next early young important few public bad same able use using used need needs must should could would may might shall can will been being was were does did done do doing go goes going gone got gets getting have has had having is are am was were be been being do does did doing have has had hav`;
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
