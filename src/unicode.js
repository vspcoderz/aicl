/**
 * AICL Unicode helpers — PUA symbol pool management
 *
 * Central place for PUA range definitions, escape marker handling,
 * and character-level utilities (surrogate-aware iteration).
 */

/** Escape marker — reserved, never used for dictionary symbols.
 *  When the original text contains a PUA char, we emit ESC + literal.
 */
export const ESCAPE_MARKER = '\uE000';

/** Code point of the escape marker. */
export const ESCAPE_CP = 0xe000;

/**
 * The PUA ranges used across dictionaries. Mirrors dict/generate.js.
 * English spans BMP (U+E000–U+F8FF) with overflow into PUA-B.
 * Code/Phrases in PUA-A; Markdown/Symbols in PUA-B.
 */
export const PUA_RANGES = {
  english: [
    { start: 0xe001, end: 0xf8ff },
    { start: 0x100900, end: 0x10ffff },
  ],
  code: { start: 0xf0000, end: 0xf07ff },
  phrases: { start: 0xf0800, end: 0xf0fff },
  markdown: { start: 0x100000, end: 0x1003ff },
  symbols: { start: 0x100400, end: 0x1007ff },
  modifiers: { start: 0x100800, end: 0x1008ff },
};

/**
 * Is a code point in any of the PUA ranges we use for symbols?
 * @param {number} cp
 * @returns {boolean}
 */
export function isPuaCodePoint(cp) {
  if (cp === ESCAPE_CP) return true;
  for (const ranges of Object.values(PUA_RANGES)) {
    const list = Array.isArray(ranges) ? ranges : [ranges];
    for (const r of list) if (cp >= r.start && cp <= r.end) return true;
  }
  return false;
}

/**
 * Split a string into an array of code points (surrogate-aware).
 * Handles both BMP and supplementary characters correctly.
 * @param {string} str
 * @returns {string[]} array of single-character strings
 */
export function codePoints(str) {
  return Array.from(str);
}

/**
 * Count the number of actual (code point) characters in a string.
 * This differs from `str.length` for supplementary (surrogate-pair) chars.
 * @param {string} str
 * @returns {number}
 */
export function charLength(str) {
  return codePoints(str).length;
}

/**
 * Is a string a single supplementary (surrogate-pair) character?
 * Length 2 in UTF-16 but represents one code point.
 * @param {string} ch
 * @returns {boolean}
 */
export function isSurrogatePair(ch) {
  return charLength(ch) === 1 && ch.length === 2;
}

/**
 * Format a character as a human-readable U+XXXX spec.
 * @param {string} ch
 * @returns {string}
 */
export function hex(ch) {
  return `U+${ch.codePointAt(0).toString(16).toUpperCase()}`;
}
