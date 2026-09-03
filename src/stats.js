/**
 * AICL Statistics — compression metrics
 *
 * Pure helpers that compute compression ratios, savings, and
 * symbol-usage breakdowns from encodings.
 */

import { codePoints, charLength } from './unicode.js';

/**
 * Compute compression stats for a token (already encoded) vs original text.
 * @param {string} original  the plain text (pre-encode)
 * @param {string} encoded   the AICL text (post-encode)
 * @param {object} [extra]   optional counts (matches/bpe) to include
 * @returns {{
 *   originalChars, encodedChars, savedChars, ratio, percentReduction,
 *   symbols? count?, ...extra
 * }}
 */
export function statsFor(original, encoded, extra = {}) {
  const originalChars = charLength(original);
  const encodedChars = charLength(encoded);
  const savedChars = originalChars - encodedChars;
  const ratio = encodedChars > 0 ? originalChars / encodedChars : 0;
  const percentReduction = originalChars > 0 ? (savedChars / originalChars) * 100 : 0;

  return {
    originalChars,
    encodedChars,
    savedChars,
    ratio: +ratio.toFixed(3),
    percentReduction: +percentReduction.toFixed(1),
    symbolCount: countSymbols(encoded),
    ...extra,
  };
}

/**
 * Count occurrences of each distinct character in AICL output.
 * @param {string} encoded
 * @returns {Map<string, number>} char -> count (PUA symbols + literals)
 */
export function countSymbols(encoded) {
  const counts = new Map();
  for (const ch of codePoints(encoded)) {
    counts.set(ch, (counts.get(ch) || 0) + 1);
  }
  return counts;
}

/**
 * Count only the PUA symbol usages (ignoring ASCII literals).
 * @param {string} encoded
 * @returns {Map<string, number>} symbol -> count
 */
export function countPuaSymbols(encoded) {
  const counts = new Map();
  for (const ch of codePoints(encoded)) {
    const cp = ch.codePointAt(0);
    if (cp >= 0xe000) {
      counts.set(ch, (counts.get(ch) || 0) + 1);
    }
  }
  return counts;
}
