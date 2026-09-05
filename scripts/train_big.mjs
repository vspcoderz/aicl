#!/usr/bin/env node
/**
 * Train the big vocab: alias pre-pass + BPE on a RAM-sized prefix of the
 * PUA corpus, save to tokenizer/vocab.json.
 *
 * Usage: node --max-old-space-size=7000 scripts/train_big.mjs \
 *          --in corpus_pua.txt --learned 24000 --maxlen 14 --take 300000000
 */
import { readFileSync, writeFileSync, openSync, readSync, closeSync } from 'fs';
import { trainTokenizerFast } from './train_fast.mjs';
import { saveTokenizer, VOCAB_PATH } from '../src/tokenizer/index.js';

const args = process.argv.slice(2);
const arg = (name, dflt) => { const i = args.indexOf('--' + name); return i >= 0 ? Number(args[i + 1]) : args[args.indexOf('--' + name) + 1]; };
const IN = args[args.indexOf('--in') + 1];
const LEARNED = arg('learned', 24000);
const MAXLEN = arg('maxlen', 14);
const TAKE = arg('take', 300_000_000); // PUA chars to train on (RAM-bound)

// read only the first TAKE chars, snapped to line end
const fd = openSync(IN, 'r');
const buf = Buffer.alloc(TAKE + 4096);
const bytes = readSync(fd, buf, 0, buf.length, 0);
closeSync(fd);
let text = buf.slice(0, bytes).toString('utf-8');
const lastNl = text.lastIndexOf('\n');
text = text.slice(0, lastNl > 0 ? lastNl : text.length);
const lines = text.split('\n');
text = '';
console.log(`training on ${lines.length} lines, ~${(lines.reduce((a, b) => a + b.length, 0) / 1e6).toFixed(0)}M PUA chars`);

const t0 = Date.now();
const vocab = trainTokenizerFast(lines, {
  numMerges: LEARNED,
  mergeBase: 100000,
  maxTokenLength: MAXLEN,
  minFrequency: 2,
  aliasTrailingSpace: true,
  trailingSpaceCodePoint: 0x100406,
});
console.log(`trained ${vocab.numMerges} merges (${vocab.aliases} aliases + ${vocab.numMerges - vocab.aliases} learned) in ${((Date.now() - t0) / 1000 / 60).toFixed(1)}min`);
saveTokenizer(vocab, VOCAB_PATH);
console.log(`saved ${VOCAB_PATH}`);
