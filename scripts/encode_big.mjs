#!/usr/bin/env node
/**
 * Encode a raw text file to PUA lines in parallel (worker threads).
 * Input: raw lines. Output: same line count, PUA-encoded (one line each).
 *
 * Usage: node scripts/encode_big.mjs --in raw.txt --out pua.txt [--workers 8]
 */
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { readFileSync, writeFileSync } from 'fs';
import { encode } from '../src/encoder.js';
import { createRequire } from 'module';

if (!isMainThread) {
  const { lines } = workerData;
  const out = new Array(lines.length);
  for (let i = 0; i < lines.length; i++) {
    const enc = encode(lines[i]);
    out[i] = enc.output;
  }
  parentPort.postMessage(out);
  process.exit(0);
}

const args = process.argv.slice(2);
const IN = args[args.indexOf('--in') + 1];
const OUT = args[args.indexOf('--out') + 1];
const wi = args.indexOf('--workers');
const WORKERS = wi >= 0 ? Number(args[wi + 1]) : 8;

const raw = readFileSync(IN, 'utf-8');
const lines = raw.split('\n');
console.log(`input: ${lines.length} lines`);
const t0 = Date.now();

const CHUNKS = WORKERS * 8;
const per = Math.ceil(lines.length / CHUNKS);
const chunks = [];
for (let i = 0; i < lines.length; i += per) chunks.push(lines.slice(i, i + per));

let done = 0;
const results = new Array(chunks.length);
let next = 0;
function spawnNext() {
  if (next >= chunks.length) return;
  const idx = next++;
  const w = new Worker(new URL(import.meta.url), { workerData: { lines: chunks[idx] } });
  w.on('message', (out) => {
    results[idx] = out;
    done++;
    if (done % 8 === 0) console.log(`... ${done}/${chunks.length} chunks, ${((Date.now() - t0) / 1000) | 0}s`);
    spawnNext();
    if (done === chunks.length) {
      writeFileSync(OUT, results.flat().join('\n'));
      console.log(`DONE: encoded ${lines.length} lines in ${((Date.now() - t0) / 1000 / 60).toFixed(1)}min -> ${OUT}`);
      process.exit(0);
    }
  });
  w.on('error', (e) => { console.error(e); process.exit(1); });
}
for (let i = 0; i < WORKERS; i++) spawnNext();
