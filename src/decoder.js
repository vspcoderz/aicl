/**
 * AICL Decoder — AICL → original text
 *
 * Buffer-based scan with modifier support:
 *   - Base word symbol → flush buffer, start new word
 *   - Modifier symbol → apply transform to current buffer
 *   - Escape marker (\uE000) → flush buffer, next char is literal
 *   - Known symbol → flush buffer, expand pattern
 *   - Anything else → flush buffer, emit literal
 *
 * Must exactly invert encode(): decode(encode(x)) === x
 */

import { build, isModifier, getModifierTransform } from './dict.js';
import { codePoints, isPuaCodePoint, ESCAPE_MARKER, requireText } from './unicode.js';

/**
 * Decode AICL back into original text.
 * @param {string} aiclText
 * @param {object} [opts]
 * @param {boolean} [opts.steps=false] record expansion steps
 * @returns {{ output: string, steps?: object[], expansions?: number, literals?: number }}
 */
export function decode(aiclText, opts = {}) {
  requireText(aiclText, 'aiclText');
  const { symbolToPattern, modifierMap } = build();
  const steps = opts.steps ? [] : null;

  const chars = codePoints(aiclText);
  let output = '';
  let expansions = 0;
  let literals = 0;
  let i = 0;

  // Buffer holds the current word being reconstructed.
  // Modifiers append to this buffer. It's flushed when a non-modifier is encountered.
  let buffer = '';

  const flushBuffer = () => {
    if (buffer.length > 0) {
      output += buffer;
      buffer = '';
    }
  };

  while (i < chars.length) {
    const ch = chars[i];

    // MODIFIER: apply transform to buffer
    if (modifierMap.has(ch)) {
      const { transform } = modifierMap.get(ch);
      buffer = transform(buffer);
      if (steps) steps.push({ type: 'modifier', name: modifierMap.get(ch).name, pos: i });
      i++;
      continue;
    }

    // ESCAPE MARKER: flush buffer, next char is literal
    if (ch === ESCAPE_MARKER) {
      flushBuffer();
      const literal = chars[i + 1];
      if (literal === undefined) {
        // Dangling escape marker at end — emit it as-is (defensive).
        output += ch;
        literals++;
        i += 1;
      } else {
        output += literal;
        literals++;
        i += 2;
      }
      continue;
    }

    // KNOWN SYMBOL: flush previous buffer, start new buffer with pattern
    const pattern = symbolToPattern.get(ch);
    if (pattern !== undefined) {
      flushBuffer();
      buffer = pattern;  // hold in buffer so modifiers can transform it
      expansions++;
      if (steps) steps.push({ type: 'expand', symbol: ch, pattern, pos: i });
      i += 1;
      continue;
    }

    // LITERAL: flush buffer, emit char as-is
    flushBuffer();
    output += ch;
    literals++;
    if (steps) steps.push({ type: 'literal', char: ch, pos: i });
    i += 1;
  }

  // Flush any remaining buffer
  flushBuffer();

  const result = { output, expansions, literals };
  if (steps) result.steps = steps;
  return result;
}

/** Convenience: decode and return just the text. */
export function decodeToString(aiclText) {
  return decode(aiclText).output;
}
