#!/usr/bin/env node
/**
 * Stream-clean raw dataset files into one interleaved training text.
 *
 * Sources (on VPS under /root/data):
 *   - C4 en shards (json.gz, field `text`)         → natural web English
 *   - wikitext-103 raw (.raw)                      → encyclopedic English
 *   - CodeSearchNet parquet (`code` column)        → real GitHub code
 *
 * Writes lines round-robin across sources so any prefix of the output is
 * proportionally stratified. Line units are sentences (prose) or code lines.
 * All filtering is streaming — no full-file materialization.
 *
 * Usage: node scripts/prepare_raw_big.mjs --out /root/data/raw_big.txt \
 *          [--c4-chars 900000000] [--wiki-chars 300000000] [--code-chars 500000000]
 */
import { createReadStream, createWriteStream } from 'fs';
import { createGunzip } from 'zlib';
import readline from 'readline';

const args = process.argv.slice(2);
const arg = (name, dflt) => { const i = args.indexOf('--' + name); return i >= 0 ? Number(args[i + 1]) : dflt; };
const OUT = args[args.indexOf('--out') + 1] ?? '/root/data/raw_big.txt';
const C4_CHARS = arg('c4-chars', 900_000_000);
const WIKI_CHARS = arg('wiki-chars', 300_000_000);
const CODE_CHARS = arg('code-chars', 500_000_000);
const DATA = '/root/data';

const isBadLine = (s) => {
  if (s.length < 25 || s.length > 400) return true;
  let alpha = 0, digits = 0, spaces = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 32) spaces++;
    else if ((c >= 97 && c <= 122) || (c >= 65 && c <= 90)) alpha++;
    else if (c >= 48 && c <= 57) digits++;
  }
  if (alpha / s.length < 0.45) return true;           // symbol junk / minified
  if (digits / s.length > 0.25) return true;          // number spam
  if (spaces / s.length < 0.05) return true;          // no word structure
  if ((s.match(/https?:\/\//g) || []).length > 2) return true; // URL lists
  return false;
};

const cleanProse = (s) => s.replace(/\s+/g, ' ').trim();
const cleanCode = (s) => s.replace(/\s+$/, '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');

function splitSentences(text) {
  // naive but effective: split on terminal punctuation followed by space+capital
  return text.split(/(?<=[.!?])\s+(?=[A-Z"'\(])/g);
}

async function* c4Lines(files, budget) {
  let written = 0;
  for (const f of files) {
    if (written >= budget) return;
    const rl = readline.createInterface({ input: createReadStream(f).pipe(createGunzip()) });
    for await (const line of rl) {
      if (written >= budget) { rl.close(); return; }
      let doc; try { doc = JSON.parse(line); } catch { continue; }
      if (typeof doc.text !== 'string') continue;
      for (const sent of splitSentences(doc.text)) {
        const s = cleanProse(sent);
        if (isBadLine(s)) continue;
        yield s;
        written += s.length + 1;
        if (written >= budget) return;
      }
    }
  }
}

async function* wikiLines(file, budget) {
  let written = 0;
  const rl = readline.createInterface({ input: createReadStream(file) });
  for await (const line of rl) {
    if (written >= budget) return;
    const l = line.trim();
    if (!l || l.startsWith('=') || l === '') continue; // headings/blank
    for (const sent of splitSentences(l)) {
      const s = cleanProse(sent);
      if (isBadLine(s)) continue;
      yield s;
      written += s.length + 1;
      if (written >= budget) return;
    }
  }
}

async function* codeLines(parquetFile, budget) {
  const { parquetReadObjects, asyncBufferFromFile } = await import('hyparquet');
  const file = await asyncBufferFromFile(parquetFile);
  const rows = await parquetReadObjects({ file, columns: ['func_code_string'] });
  let written = 0;
  for (const row of rows) {
    const code = row.func_code_string;
    if (typeof code !== 'string') continue;
    for (const raw of code.split('\n')) {
      const s = cleanCode(raw);
      if (s.length < 20 || s.length > 400) continue;
      if ((s.match(/[^ -~\t]/g) || []).length > 0) continue; // ascii only
      let alpha = 0, spaces = 0;
      for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c === 32) spaces++; else if ((c >= 97 && c <= 122) || (c >= 65 && c <= 90)) alpha++; }
      if (alpha / s.length < 0.3 || spaces / s.length < 0.04) continue;
      yield s;
      written += s.length + 1;
      if (written >= budget) return;
    }
  }
}

async function pullN(gen, n) { const out = []; for (const s of gen) { out.push(s); if (out.length >= n) break; } return out; }

// round-robin: K lines from each source per cycle
const K = 400;
const c4Files = [0, 1, 2, 3].map(i => `${DATA}/c4_0000${i}.json.gz`);
const gC4 = c4Lines(c4Files, C4_CHARS);
const gWiki = wikiLines(`${DATA}/wikitext-103-raw/wiki.train.raw`, WIKI_CHARS);
const gCode = codeLines(`${DATA}/csn_python.parquet`, Math.floor(CODE_CHARS / 2));
const gCodeJs = codeLines(`${DATA}/csn_js.parquet`, Math.floor(CODE_CHARS / 2));

const ws = createWriteStream(OUT);
let total = 0, c4Done = false, wikiDone = false, codeDone = false, lastLog = 0;
const t0 = Date.now();
while (!(c4Done && wikiDone && codeDone)) {
  if (!c4Done) {
    const batch = await pullN(gC4, K);
    if (!batch.length) c4Done = true;
    else for (const s of batch) { ws.write(s + '\n'); total += s.length + 1; }
  }
  if (!wikiDone) {
    const batch = await pullN(gWiki, K);
    if (!batch.length) wikiDone = true;
    else for (const s of batch) { ws.write(s + '\n'); total += s.length + 1; }
  }
  if (!codeDone) {
    const a = await pullN(gCode, K / 2 | 0);
    const b = await pullN(gCodeJs, K / 2 | 0);
    if (!a.length && !b.length) codeDone = true;
    else for (const s of [...a, ...b]) { ws.write(s + '\n'); total += s.length + 1; }
  }
  if (total - lastLog > 100_000_000) { lastLog = total; console.log(`... ${(total / 1e6).toFixed(0)}M chars, ${((Date.now() - t0) / 1000) | 0}s`); }
}
ws.end();
console.log(`DONE: ${total} chars -> ${OUT} in ${((Date.now() - t0) / 1000 / 60).toFixed(1)}min`);
