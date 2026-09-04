/**
 * AICL Vision — ANSI-colored visualization of the compression process.
 *
 * Colors:
 *   Green  = static dict symbol (successfully compressed)
 *   Red    = literal char (uncompressed / could be compressed)
 *   Yellow = BPE/tokenizer symbol (layer 2)
 *   Cyan   = punctuation/whitespace literal
 *   Dim    = escape marker
 */

import { decode } from './decoder.js';
import { isPuaCodePoint, charLength, codePoints, ESCAPE_MARKER } from './unicode.js';

const C = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
};

/**
 * Render the encoded AICL string with colors:
 * green for PUA symbols, red for ASCII literals, cyan for punctuation.
 * @param {string} encoded
 * @returns {string} ANSI-colored string
 */
export function colorizeEncoded(encoded) {
  let out = '';
  let i = 0;
  const chars = codePoints(encoded);
  while (i < chars.length) {
    const ch = chars[i];
    if (ch === ESCAPE_MARKER) {
      out += C.dim + ch + C.reset;
      i += 1;
      continue;
    }
    const cp = ch.codePointAt(0);
    if (cp >= 0xe000) {
      out += C.green + ch + C.reset;
    } else if (/[.,;:!?"'()[\]{}<>]/.test(ch) || ch.trim() === '') {
      out += C.cyan + ch + C.reset;
    } else {
      out += C.red + ch + C.reset;
    }
    i += 1;
  }
  return out;
}

/**
 * Render the roundtrip visually: original, encoded (colored), decoded, stats.
 * @param {string} original
 * @param {string} encoded
 * @param {object} [opts] { title?, showUncompressed? }
 * @returns {string} full ANSI report
 */
export function render(original, encoded, opts = {}) {
  const decoded = decode(encoded).output;
  const lines = [];

  if (opts.title) lines.push(C.bold + opts.title + C.reset);
  lines.push('');
  lines.push(C.bold + 'Original:' + C.reset);
  lines.push('  ' + original);
  lines.push('');
  lines.push(C.bold + 'Encoded (AICL):' + C.reset);
  lines.push('  ' + colorizeEncoded(encoded));
  lines.push('');
  lines.push(C.bold + 'Decoded (roundtrip):' + C.reset);
  lines.push('  ' + decoded);
  lines.push('');
  lines.push(C.bold + 'Roundtrip ' + (original === decoded ? '✓ OK' : '✗ FAILED') + C.reset);

  return lines.join('\n');
}
