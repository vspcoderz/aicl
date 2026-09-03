/**
 * AICL Encoder — text → AICL
 *
 * Three-tier greedy scan:
 *   1. Longest-match-first over the merged dictionary (existing patterns)
 *   2. If longest match is a single letter in a word → base word + modifier symbols
 *   3. Literal char (escape-prefixed if it is a PUA char)
 *
 * Always lossless: decode(encode(x)) === x
 */

import { build, isModifier } from './dict.js';
import { codePoints, isPuaCodePoint, ESCAPE_MARKER } from './unicode.js';

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

  let output = '';
  let matches = 0;
  let literals = 0;

  const chars = codePoints(text);
  let i = 0;

  while (i < chars.length) {
    const rest = chars.slice(i).join('');
    let matched = false;

    // Find the longest matching pattern
    let bestPattern = null;
    let bestSymbol = null;
    let bestLen = 0;

    for (const pattern of sortedPatterns) {
      if (pattern.length <= rest.length && rest.startsWith(pattern)) {
        const symbol = patternToSymbol.get(pattern);
        if (pattern.length > bestLen) {
          bestPattern = pattern;
          bestSymbol = symbol;
          bestLen = pattern.length;
        }
        break; // sorted longest-first, so first match is longest
      }
    }

    // If longest match is a single letter, try fragments before falling back
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
            if (fragLen <= lower.length - fragI && lower.startsWith(frag, fragI)) {
              if (fragLen > bestFragLen) {
                bestFrag = frag;
                bestFragLen = fragLen;
              }
              break;
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

    // Use the longest matching pattern
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
