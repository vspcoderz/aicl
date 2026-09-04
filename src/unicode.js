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

/** Max input size for encode/decode/tokenizer (code points). */
export const MAX_INPUT_CHARS = 1_000_000;

/** Max request body for playground API (bytes). */
export const MAX_BODY_BYTES = 2_000_000;

/**
 * Validate that `value` is a string and within size bounds.
 * Throws TypeError / RangeError with a clear message.
 * @param {unknown} value
 * @param {string} label param name for error messages
 * @param {number} [limit] max code points (default MAX_INPUT_CHARS)
 * @returns {string} the same string if valid
 */
export function requireText(value, label = 'text', limit = MAX_INPUT_CHARS) {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string, got ${typeof value}`);
  const len = Array.from(value).length;
  if (len > limit) throw new RangeError(`${label} too large: ${len} chars > ${limit} limit`);
  return value;
}

/**
 * Inspect control / surrogate anomalies in a string.
 * Does NOT mutate — callers decide whether to reject or sanitize.
 * @param {string} s
 * @returns {{ hasControl: boolean, hasSurrogate: boolean, hasNull: boolean }}
 */
export function inspectText(s) {
  let hasControl = false, hasSurrogate = false, hasNull = false;
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp === 0) hasNull = true;
    if (cp >= 0xd800 && cp <= 0xdfff) hasSurrogate = true;
    else if (cp < 0x20 && cp !== 0x09 && cp !== 0x0a && cp !== 0x0d) hasControl = true;
    else if (cp === 0x7f) hasControl = true;
  }
  return { hasControl, hasSurrogate, hasNull };
}

/**
 * Boundary sanitizer for untrusted inputs (e.g. playground HTTP body).
 * Strips C0 controls 0x00–0x1F (except \t \n \r), DEL 0x7F, and lone surrogates.
 * Returns a cleaned copy; valid text is unchanged.
 * @param {string} s
 * @returns {string}
 */
export function sanitizeText(s) {
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp === 0x09 || cp === 0x0a || cp === 0x0d) { out += ch; continue; }
    if (cp < 0x20 || cp === 0x7f) continue;
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    out += ch;
  }
  return out;
}

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
