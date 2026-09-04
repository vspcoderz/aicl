/**
 * AICL — public API
 *
 * Two-stage pipeline:
 *   Stage 1: encode/decode (text <-> AICL symbols)
 *   Stage 2: tokenizer (AICL <-> token IDs) — see ./tokenizer
 */

export {
  encode,
  encodeToString,
} from './encoder.js';

export {
  decode,
  decodeToString,
} from './decoder.js';

export { build as buildDict, reset as resetDict, dicts, isModifier, getModifierTransform } from './dict.js';
export { statsFor, countSymbols, countPuaSymbols } from './stats.js';
export { render as visualize, colorizeEncoded } from './vision.js';
export {
  ESCAPE_MARKER,
  ESCAPE_CP,
  PUA_RANGES,
  MAX_INPUT_CHARS,
  MAX_BODY_BYTES,
  requireText,
  sanitizeText,
  inspectText,
  isPuaCodePoint,
  charLength,
  codePoints,
  hex,
} from './unicode.js';

export { tokenize, detokenize, loadTokenizer, trainTokenizer, VOCAB_PATH, CP_BASE } from './tokenizer/index.js';
