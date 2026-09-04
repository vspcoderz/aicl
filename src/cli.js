#!/usr/bin/env node
/**
 * AICL CLI
 *
 * Usage:
 *   node src/cli.js encode [--visual] [--full] "text"        encode text -> AICL
 *   node src/cli.js decode [--full] "<AICL>"                 decode AICL -> text
 *   node src/cli.js stats  [--visual] <file|->               compression stats (stdin if '-')
 *   node src/cli.js tok    [--train <corpus>] "text"         tokenizer: train + tokenize
 *   node src/cli.js train  <corpusFile> [--merges N]         train tokenizer, save vocab
 *
 * File input: pass a path instead of a quoted string.
 * Stdin: pass a leading `-` or pipe input.
 */
import { readFileSync } from 'fs';
import { encode } from './encoder.js';
import { decode } from './decoder.js';
import { statsFor } from './stats.js';
import { render as visualize } from './vision.js';
import { trainTokenizer, tokenize, detokenize, saveTokenizer, loadTokenizer } from './tokenizer/index.js';

function usage() {
  console.log(`AICL — AI Compressed Language
  Stage 1: static dictionary encode/decode
  Stage 2: custom BPE tokenizer over AICL symbols

USAGE
  aicl encode [--visual] "text"            # text -> AICL symbols
  aicl decode "AICL"                       # AICL symbols -> text
  aicl stats [--visual] file               # compression stats
  aicl train <corpus> [--merges N]         # train BPE, save tokenizer/vocab.json
  aicl tok [--train <corpus>] "text"       # tokenize AICL -> token IDs

OPTIONS
  --visual   ANSI-colored step-by-step view
  --merges N how many BPE merges to learn (default 4096)
`);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) { usage(); return; }

  const cmd = argv[0];
  const rest = argv.slice(1);

  const flags = rest.filter((a) => a.startsWith('--'));
  const args = rest.filter((a) => !a.startsWith('--'));
  const has = (f) => flags.includes(f);
  const getFlag = (f, d) => {
    const i = flags.indexOf(f);
    return i >= 0 ? flags[i + 1] : d;
  };

  const readInput = (spec) => {
    if (!spec) return '';
    if (spec === '-') return readFileSync(0, 'utf-8');
    // If it's an existing file, read it.
    try {
      return readFileSync(spec, 'utf-8');
    } catch {
      return spec; // treat as literal text
    }
  };

  switch (cmd) {
    case 'encode': {
      const text = readInput(args[0] ?? '');
      const e = encode(text, { steps: has('--visual') });
      if (has('--visual')) {
        console.log(visualize(text, e.output, { title: 'AICL encode' }));
      } else {
        console.log(e.output);
      }
      if (!has('--visual')) {
        console.error(`# chars: ${e.charsIn} -> ${e.charsOut}  (${(e.charsIn / e.charsOut).toFixed(2)}x)`);
      }
      break;
    }

    case 'decode': {
      const aicl = readInput(args[0] ?? '');
      const { output, expansions } = decode(aicl);
      console.log(output);
      if (has('--stats')) console.error(`# expansions: ${expansions}`);
      break;
    }

    case 'stats': {
      const text = readInput(args[0] ?? '-');
      const e = encode(text);
      const s = statsFor(text, e.output);
      console.log({
        inputChars: s.originalChars,
        outputChars: s.encodedChars,
        ratio: s.ratio,
        matches: e.matches,
        literals: e.literals,
        symbolCount: s.symbolCount.size,
        percentReduction: s.percentReduction,
      });
      break;
    }

    case 'train': {
      const corpusPath = args[0];
      if (!corpusPath) { usage(); return; }
      const raw = readFileSync(corpusPath, 'utf-8');
      const sentences = raw.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
      const aicl = sentences.map((s) => encode(s).output);
      const numMerges = Number(getFlag('--merges', '4096'));
      console.error(`Training on ${sentences.length} sentences, ${numMerges} merges...`);
      const vocab = trainTokenizer(aicl, { numMerges, mergeBase: 100000 });
      saveTokenizer(vocab);
      console.error(`Saved tokenizer/vocab.json with ${vocab.numMerges} merges`);
      break;
    }

    case 'tok': {
      // Optionally train first
      const trainFlag = getFlag('--train', null);
      let vocab = loadTokenizer();
      if (trainFlag) {
        const raw = readFileSync(trainFlag, 'utf-8');
        const sentences = raw.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
        vocab = trainTokenizer(sentences.map((s) => encode(s).output), { numMerges: 4096 });
      }
      const text = readInput(args[0] ?? '');
      const aicl = encode(text).output;
      const ids = tokenize(aicl, vocab);
      if (has('--ids')) {
        console.log(ids.join(' '));
      } else {
        // Show aicl length vs token count
        const aiclChars = [...aicl].length;
        console.log(`AICL chars: ${aiclChars}`);
        console.log(`Token IDs:  ${ids.length}`);
        console.log(`Reduction:  ${((1 - ids.length / aiclChars) * 100).toFixed(1)}%`);
      }
      break;
    }

    case '--help':
    case '-h':
    case 'help':
      usage();
      break;

    default:
      console.error(`Unknown command: ${cmd}`);
      usage();
      process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});