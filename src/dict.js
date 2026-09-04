/**
 * AICL Dictionary loader
 *
 * Loads the three dictionary files + modifiers, merges them into a single lookup,
 * and builds both the forward (pattern -> symbol) and reverse
 * (symbol -> pattern) maps. Patterns are sorted by length for
 * longest-match-first encoding.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { codePoints } from './unicode.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DICT_DIR = join(__dirname, '..', 'dict');

/** Cache so we only load/build once per process. */
let cache = null;

/**
 * Load the raw dictionary objects from dict/*.json
 * @returns {{ english: object, code: object, symbols: object, modifiers: object }}
 */
export function loadRaw() {
  return {
    english: JSON.parse(readFileSync(join(DICT_DIR, 'english.json'), 'utf-8')),
    code: JSON.parse(readFileSync(join(DICT_DIR, 'code.json'), 'utf-8')),
    symbols: JSON.parse(readFileSync(join(DICT_DIR, 'symbols.json'), 'utf-8')),
    modifiers: JSON.parse(readFileSync(join(DICT_DIR, 'modifiers.json'), 'utf-8')),
  };
}

/**
 * Modifier transform functions — maps modifier name to (word) => transformed word.
 * These reconstruct the original text from base words during decoding.
 */
const MODIFIER_TRANSFORMS = {
  MOD_CAPS:          (w) => w.charAt(0).toUpperCase() + w.slice(1),
  MOD_TRAIL_SPACE:   (w) => w + ' ',
  MOD_TRAIL_COMMA:   (w) => w + ',',
  MOD_TRAIL_PERIOD:  (w) => w + '.',
  MOD_TRAIL_QUESTION:(w) => w + '?',
  MOD_TRAIL_EXCL:    (w) => w + '!',
  MOD_TRAIL_SEMI:    (w) => w + ';',
  MOD_TRAIL_COLON:   (w) => w + ':',
  MOD_TRAIL_RPAREN:  (w) => w + ')',
  MOD_TRAIL_RBRACKET:(w) => w + ']',
  MOD_TRAIL_RBRACE:  (w) => w + '}',
  MOD_TRAIL_RQUOTE:  (w) => w + '"',
  MOD_LEAD_SPACE:    (w) => ' ' + w,
  MOD_LEAD_LPAREN:   (w) => '(' + w,
  MOD_LEAD_LBRACKET: (w) => '[' + w,
  MOD_LEAD_LBRACE:   (w) => '{' + w,
  MOD_LEAD_LQUOTE:   (w) => '"' + w,
};

/**
 * Build the merged, sorted lookup structures.
 * @returns {{
 *   patternToSymbol: Map<string,string>,
 *   symbolToPattern: Map<string,string>,
 *   sortedPatterns: string[],
 *   modifierSymbols: Set<string>,   // set of modifier code point chars
 *   modifierMap: Map<string,{name:string, transform:function}>,  // symbol -> {name, transform}
 *   size: number
 * }}
 */
export function build() {
  if (cache) return cache;

  const { english, code, symbols, modifiers } = loadRaw();
  const patternToSymbol = new Map();
  const symbolToPattern = new Map();

  for (const dict of [english, code, symbols]) {
    for (const [pattern, symbol] of Object.entries(dict)) {
      if (!patternToSymbol.has(pattern)) {
        patternToSymbol.set(pattern, symbol);
        symbolToPattern.set(symbol, pattern);
      }
    }
  }

  // Build modifier lookup: symbol char -> { name, transform }
  const modifierSymbols = new Set();
  const modifierMap = new Map();
  for (const [name, symbol] of Object.entries(modifiers)) {
    modifierSymbols.add(symbol);
    modifierMap.set(symbol, {
      name,
      transform: MODIFIER_TRANSFORMS[name] || ((w) => w),
    });
    // Also add to patternToSymbol so encoder can find modifiers by name
    if (!patternToSymbol.has(name)) {
      patternToSymbol.set(name, symbol);
      symbolToPattern.set(symbol, name);
    }
  }

  // Longest first so greedy matching finds the best (longest) hit.
  const sortedPatterns = [...patternToSymbol.keys()].sort(
    (a, b) => b.length - a.length || (a < b ? -1 : 1)
  );

  cache = {
    patternToSymbol,
    symbolToPattern,
    sortedPatterns,
    modifierSymbols,
    modifierMap,
    size: patternToSymbol.size,
    english,
    code,
    symbols,
    modifiers,
  };

  return cache;
}

/** Check if a code point char is a modifier symbol. */
export function isModifier(ch) {
  const { modifierSymbols } = build();
  return modifierSymbols.has(ch);
}

/** Get the modifier transform for a symbol char. Returns null if not a modifier. */
export function getModifierTransform(ch) {
  const { modifierMap } = build();
  const mod = modifierMap.get(ch);
  return mod ? mod.transform : null;
}

/** Invalidate the cache (mainly for tests). */
export function reset() {
  cache = null;
}

/**
 * Get a single dict's entries (convenience for tooling/inspection).
 * @returns {{ english: object, code: object, symbols: object, modifiers: object }}
 */
export function dicts() {
  return loadRaw();
}
