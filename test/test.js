/**
 * AICL full-pipeline test suite (self-contained).
 *
 * Covers:
 *   Stage 1: encode/decode roundtrip on many inputs, incl. edge cases
 *   Stage 2: tokenizer train/tokenize/detokenize roundtrip
 *   Combined: raw -> AICL -> tokens -> AICL -> raw must be lossless
 *   Escape-marker integrity
 */
import { encode } from '/home/vspcoderz/Projects/aicl/src/encoder.js';
import { decode } from '/home/vspcoderz/Projects/aicl/src/decoder.js';
import { build } from '/home/vspcoderz/Projects/aicl/src/dict.js';
import { ESCAPE_MARKER, isPuaCodePoint } from '/home/vspcoderz/Projects/aicl/src/unicode.js';
import {
  trainTokenizer, tokenize, detokenize,
} from '/home/vspcoderz/Projects/aicl/src/tokenizer/index.js';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗ FAIL:', name); }
}

// ---------- Stage 1: static dict ----------
console.log('\n== Stage 1: encode/decode roundtrip ==');

const stage1Inputs = [
  'the quick brown fox jumps over the lazy dog',
  'I am going to the store to buy some food.',
  'Plain text with no matches zzqx jxkw.',
  '',                                      // empty
  'Leading space and   multiple  spaces',
  'Code: const x = await db.query("SELECT * FROM tasks");',
  '# Markdown header\n- list item\n```js\nlet a = 1;\n```',
  'Special chars: $100, 50%, a+b, a&&b, x=>y',
  'a\uE000literal-pua-char\uE010b',          // literal PUA in input (must be escaped)
  'Unicode: héllo wörld — emoji 🚀 and 𝄞 (surrogate pairs)',
  'Tab\tand\nnewline\r\nmixed',
  'JSON: {"name": "taskboard-api", "version": "1.2.0"}',
  'Error: Cannot read property of undefined',
  '$ git diff --stat && npm test -- --runInBand',
];

for (let i = 0; i < stage1Inputs.length; i++) {
  const s = stage1Inputs[i];
  const enc = encode(s);
  const dec = decode(enc.output);
  check(`stage1 roundtrip #${i}: ${JSON.stringify(s.slice(0, 30))}${s.length > 30 ? '...' : ''}`, dec.output === s);
  // Compression should be <= input, EXCEPT inputs containing literal PUA chars,
  // which must be escaped (2x) to preserve them losslessly.
  const hasLiteralPua = [...s].some((c) => isPuaCodePoint(c.codePointAt(0)));
  if (!hasLiteralPua) {
    check(`stage1 charsOut<=charsIn #${i}`, enc.charsOut <= enc.charsIn);
  } else {
    check(`stage1 charsOut<=charsIn #${i} (escaped-PUA input, skip)`, true);
  }
}

// Escape marker integrity: encoder must never emit \uE000 as a bare symbol
{
  const { patternToSymbol } = build();
  let coll = 0;
  for (const [p, sym] of patternToSymbol) if (sym === ESCAPE_MARKER) coll++;
  check('no pattern maps to the escape marker', coll === 0);
}

// ---------- Modifier system ----------
console.log('\n== Modifier system: base words + modifiers ==');

// Single letters
const singleLetterTests = ['a', 'b', 'z', 'A', 'Z', '0', '9'];
for (const ch of singleLetterTests) {
  const enc = encode(ch);
  const dec = decode(enc.output);
  check(`single letter "${ch}" roundtrip`, dec.output === ch);
}

// Bare words
const bareWordTests = ['is', 'we', 'you', 'are', 'and', 'the', 'this', 'to', 'of', 'in', 'for', 'on', 'with', 'it', 'be', 'at', 'or', 'an', 'no', 'so', 'if', 'do', 'my', 'he', 'she', 'up'];
for (const word of bareWordTests) {
  const enc = encode(word);
  const dec = decode(enc.output);
  check(`bare word "${word}" roundtrip`, dec.output === word);
  check(`bare word "${word}" compressed`, enc.charsOut < enc.charsIn);
}

// Modifier composition
const modifierTests = [
  ['The', 'base + MOD_CAPS'],
  ['test.', 'base + MOD_TRAIL_PERIOD'],
  ['test,', 'base + MOD_TRAIL_COMMA'],
  ['test!', 'base + MOD_TRAIL_EXCL'],
  ['test?', 'base + MOD_TRAIL_QUESTION'],
  ['test;', 'base + MOD_TRAIL_SEMI'],
  ['test:', 'base + MOD_TRAIL_COLON'],
  ['test)', 'base + MOD_TRAIL_RPAREN'],
  ['test]', 'base + MOD_TRAIL_RBRACKET'],
  ['test}', 'base + MOD_TRAIL_RBRACE'],
  ['test"', 'base + MOD_TRAIL_RQUOTE'],
  ['Test.', 'base + MOD_CAPS + MOD_TRAIL_PERIOD'],
  ['Test,', 'base + MOD_CAPS + MOD_TRAIL_COMMA'],
  ['Test!', 'base + MOD_CAPS + MOD_TRAIL_EXCL'],
];
for (const [input, desc] of modifierTests) {
  const enc = encode(input);
  const dec = decode(enc.output);
  check(`modifier "${input}" (${desc}) roundtrip`, dec.output === input);
  check(`modifier "${input}" compressed`, enc.charsOut < enc.charsIn);
}

// User's original test cases
{
  const t1 = 'This is The Test Phase Where we fuck ai badly but yeah you know why you are gay and apple is king';
  const e1 = encode(t1);
  const d1 = decode(e1.output);
  check('user test 1 roundtrip', d1.output === t1);
  check('user test 1 compressed', e1.charsOut < e1.charsIn);
  console.log(`  user test 1: ${e1.charsIn} -> ${e1.charsOut} chars (${(e1.charsIn/e1.charsOut).toFixed(2)}x)`);
}

{
  const t2 = 'a b c d abcd';
  const e2 = encode(t2);
  const d2 = decode(e2.output);
  check('user test 2 roundtrip', d2.output === t2);
  // "a b c d abcd" = single letters + spaces + "abcd" word
  // Each letter is compressed, spaces are literals, "abcd" is a word
  console.log(`  user test 2: ${e2.charsIn} -> ${e2.charsOut} chars (${(e2.charsIn/e2.charsOut).toFixed(2)}x)`);
}

// ---------- Stage 2: tokenizer ----------
console.log('\n== Stage 2: tokenizer train/tokenize/detokenize ==');

const aiCorpus = [
  'I will check the database schema and tests so the implementation matches the existing conventions.',
  'The developer should verify each step before claiming that it works.',
  'const app = express(); app.get("/api/tasks", async (req, res) => {',
  'Error: TypeError: Cannot read properties of undefined (reading map)',
  '$ npm run build && npm test # compiles successfully then runs the suite',
  'Artificial intelligence has moved from science fiction to an important technology.',
  'This transformation is changing not only how people use technology but also how software is created.',
  '# Taskboard API\n\n## Setup\n- [ ] install dependencies\n- [x] write integration tests',
  'SELECT id, title, completed, priority FROM tasks WHERE completed = true ORDER BY created_at',
  'The result of the code generation was surprisingly consistent across multiple runs.',
];

const aiclSentences = aiCorpus.map((s) => encode(s).output);
const fullAicl = encode(aiCorpus.join('\n')).output;

const vocab = trainTokenizer(aiclSentences, { numMerges: 128, mergeBase: 100000 });
check('tokenizer learned some merges', vocab.numMerges > 0);

for (let i = 0; i < aiCorpus.length; i++) {
  const ids = tokenize(aiclSentences[i], vocab);
  const detok = detokenize(ids, vocab);
  // detokenize must reproduce the exact AICL text
  check(`tokenizer detokenize==aicl #${i}`, detok === aiclSentences[i]);
}

// ---------- Combined full pipeline ----------
console.log('\n== Combined: raw -> AICL -> tokens -> AICL -> raw ==');
{
  const ids = tokenize(fullAicl, vocab);
  const detok = detokenize(ids, vocab);
  const back = decode(detok).output;
  const orig = aiCorpus.join('\n');
  check('full pipeline lossless', back === orig);

  const rawChars = [...orig].length;
  const tokenCount = ids.length;
  console.log(`  raw chars: ${rawChars}  tokens: ${tokenCount}  ratio: ${(rawChars / tokenCount).toFixed(2)}x`);
}

console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);