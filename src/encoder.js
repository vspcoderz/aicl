/**
 * AICL Encoder — text → AICL
 *
 * Three-tier greedy scan with trie-accelerated longest-match:
 *   1. Longest-match-first via trie (O(max_len) per position, not O(dict_size))
 *   2. If longest match is a single letter in a word → base word + modifier symbols
 *   3. Literal char (escape-prefixed if it is a PUA char)
 *
 * Always lossless: decode(encode(x)) === x
 */

import { build, isModifier } from './dict.js';
import { codePoints, isPuaCodePoint, ESCAPE_MARKER } from './unicode.js';

/**
 * Build a trie from the pattern→symbol map for O(max_len) prefix matching.
 * Each node: { children: Map<char, node>, symbol: string|null, depth: number }
 */
function buildTrie(patternToSymbol) {
  const root = { children: new Map(), symbol: null, depth: 0 };
  let nodeCount = 1;

  for (const [pattern, symbol] of patternToSymbol) {
    // Skip modifier names — they're not matchable text patterns
    if (pattern.startsWith('MOD_')) continue;

    let node = root;
    for (const ch of pattern) {
      if (!node.children.has(ch)) {
        node.children.set(ch, { children: new Map(), symbol: null, depth: node.depth + 1 });
        nodeCount++;
      }
      node = node.children.get(ch);
    }
    node.symbol = symbol;
  }

  return { root, nodeCount };
}

/**
 * Find the longest matching pattern starting at position i using the trie.
 * Returns [pattern, symbol] or [null, null] if no match.
 */
function trieLongestMatch(root, chars, i) {
  let node = root;
  let bestPattern = null;
  let bestSymbol = null;
  let bestLen = 0;

  for (let j = i; j < chars.length; j++) {
    const ch = chars[j];
    const next = node.children.get(ch);
    if (!next) break;
    node = next;
    if (node.symbol) {
      bestLen = j - i + 1;
      bestSymbol = node.symbol;
    }
  }

  if (bestSymbol) {
    // Reconstruct the matched pattern string
    const pattern = chars.slice(i, i + bestLen).join('');
    return [pattern, bestSymbol];
  }
  return [null, null];
}

/**
 * Extract a bare word (letters/digits/underscore) starting at position i.
 * Returns the word string, or '' if chars[i] is not a word character.
 */
function extractWord(chars, i) {
  if (i >= chars.length) return '';
  const ch = chars[i];
  if (!/[a-zA-Z0-9_'-]/.test(ch)) return '';
  let word = ch;
  for (let j = i + 1; j < chars.length; j++) {
    const c = chars[j];
    if (/[a-zA-Z0-9_'-]/.test(c)) {
      word += c;
    } else {
      break;
    }
  }
  return word;
}

/**
 * Encode plain text into AICL (PUA symbols + modifiers + literals).
 * @param {string} text
 * @param {object} [opts]
 * @param {boolean} [opts.steps=false] record every match/literal
 * @returns {{ output: string, steps?: object[], matches?: number, literals?: number, charsIn?: number, charsOut?: number }}
 */
export function encode(text, opts = {}) {
  const { sortedPatterns, patternToSymbol } = build();
  const steps = opts.steps ? [] : null;

  // Build trie for fast longest-match lookup
  const trie = buildTrie(patternToSymbol);

  let output = '';
  let matches = 0;
  let literals = 0;

  const chars = codePoints(text);
  let i = 0;

  while (i < chars.length) {
    // Trie-accelerated longest match — O(max_pattern_length) per position
    const [bestPattern, bestSymbol] = trieLongestMatch(trie.root, chars, i);
    const bestLen = bestPattern ? bestPattern.length : 0;

    // If longest match is a single letter, try word-based encoding
    if (bestLen === 1) {
      const word = extractWord(chars, i);

      // Only try word-based encoding if we're at a word start
      if (word.length > 1) {
        const lower = word.toLowerCase();

        // FIRST: Try whole word + modifiers
        const baseSym = patternToSymbol.get(lower);
        if (baseSym) {
          output += baseSym;
          matches++;
          if (steps) steps.push({ type: 'base', pattern: lower, symbol: baseSym, pos: i });
          i += lower.length;

          if (word[0] !== lower[0]) {
            const capsSym = patternToSymbol.get('MOD_CAPS');
            if (capsSym) {
              output += capsSym;
              matches++;
              if (steps) steps.push({ type: 'modifier', name: 'MOD_CAPS', symbol: capsSym, pos: i });
            }
          }

          while (i < chars.length) {
            const modName = punctuationToModifier(chars[i]);
            if (modName) {
              const modSym = patternToSymbol.get(modName);
              if (modSym) {
                output += modSym;
                matches++;
                if (steps) steps.push({ type: 'modifier', name: modName, symbol: modSym, pos: i });
                i++;
                continue;
              }
            }
            break;
          }

          continue;
        }

        // SECOND: Try fragments ONLY if whole word not found
        let fragI = 0;
        let matchedFrag = false;
        while (fragI < lower.length) {
          let bestFrag = null;
          let bestFragLen = 0;
          for (const frag of sortedPatterns) {
            const fragLen = frag.length;
            if (fragLen < 2 || fragLen > 4) continue;
            if (fragLen > lower.length - fragI) continue; // too long
            if (fragLen < bestFragLen) break; // sorted by length desc, no better match possible
            if (lower.startsWith(frag, fragI)) {
              bestFrag = frag;
              bestFragLen = fragLen;
              break; // longest-first, first match wins
            }
          }
          if (bestFrag) {
            const fragSym = patternToSymbol.get(bestFrag);
            if (fragSym) {
              output += fragSym;
              matches++;
              if (steps) steps.push({ type: 'fragment', pattern: bestFrag, symbol: fragSym, pos: i + fragI });
              fragI += bestFragLen;
              matchedFrag = true;
              continue;
            }
          }
          break;
        }

        if (matchedFrag && fragI > 0) {
          i += fragI;

          if (word[0] !== lower[0]) {
            const capsSym = patternToSymbol.get('MOD_CAPS');
            if (capsSym) {
              output += capsSym;
              matches++;
              if (steps) steps.push({ type: 'modifier', name: 'MOD_CAPS', symbol: capsSym, pos: i });
            }
          }

          while (i < chars.length) {
            const modName = punctuationToModifier(chars[i]);
            if (modName) {
              const modSym = patternToSymbol.get(modName);
              if (modSym) {
                output += modSym;
                matches++;
                if (steps) steps.push({ type: 'modifier', name: modName, symbol: modSym, pos: i });
                i++;
                continue;
              }
            }
            break;
          }

          continue;
        }
      }
    }

    // Use the longest matching pattern from trie
    if (bestPattern) {
      output += bestSymbol;
      matches++;
      if (steps) steps.push({ type: 'match', pattern: bestPattern, symbol: bestSymbol, pos: i });
      i += charCountOf(bestPattern);
      continue;
    }

    // TIER 3: Literal character
    {
      const ch = chars[i];
      if (isPuaCodePoint(ch.codePointAt(0))) {
        output += ESCAPE_MARKER + ch;
      } else {
        output += ch;
      }
      literals++;
      if (steps) steps.push({ type: 'literal', char: ch, pos: i });
      i += 1;
    }
  }

  const result = { output, matches, literals, charsIn: chars.length, charsOut: charCount(output) };
  if (steps) result.steps = steps;
  return result;
}

/**
 * Map a punctuation character to its modifier name, or null if not a modifier.
 */
function punctuationToModifier(ch) {
  const map = {
    ' ': 'MOD_TRAIL_SPACE',
    ',': 'MOD_TRAIL_COMMA',
    '.': 'MOD_TRAIL_PERIOD',
    '?': 'MOD_TRAIL_QUESTION',
    '!': 'MOD_TRAIL_EXCL',
    ';': 'MOD_TRAIL_SEMI',
    ':': 'MOD_TRAIL_COLON',
    ')': 'MOD_TRAIL_RPAREN',
    ']': 'MOD_TRAIL_RBRACKET',
    '}': 'MOD_TRAIL_RBRACE',
    '"': 'MOD_TRAIL_RQUOTE',
  };
  return map[ch] || null;
}

/**
 * Count code points in a pattern string (for index advancement).
 */
function charCountOf(str) {
  return Array.from(str).length;
}

function charCount(str) {
  return Array.from(str).length;
}

/** Convenience: encode and return just the AICL string. */
export function encodeToString(text) {
  return encode(text).output;
}
