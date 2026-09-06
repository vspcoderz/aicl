#!/usr/bin/env node
/**
 * One-shot acceptance eval for a shipped vocab:
 *   1. structural sanity (no duplicate learned rules, rank/alias integrity)
 *   2. bench-8 vs gpt-4o
 *   3. 50-probe held-out set (per-domain)
 *   4. 600-line unseen corpus eval (per-domain)
 *   5. lossless roundtrip everywhere
 *
 * Usage: node scripts/eval_all.mjs [path/to/vocab.json]   (default tokenizer/vocab.json)
 */
import { readFileSync } from 'fs';
import { encode } from '../src/encoder.js';
import { decode } from '../src/decoder.js';
import { tokenize, detokenize } from '../src/tokenizer/index.js';
import { encode as gptEncode } from 'gpt-tokenizer';
import { HELDOUT, HELDOUT_PROBES } from './heldout_probes.mjs';

const BENCH = [
  ['Common English', 'the quick brown fox jumps over the lazy dog this is a test of the emergency broadcast system how now brown cow the rain in spain stays mainly on the plain'],
  ['Code', 'const app = express(); app.get("/api/tasks", async (req, res) => { const tasks = await db.query("SELECT * FROM tasks"); res.json(tasks); });'],
  ['SQL', 'SELECT * FROM users WHERE id=42 AND name LIKE \'%test%\' ORDER BY created_at DESC; INSERT INTO table_name (a,b,c) VALUES (1,\'x\',true); UPDATE users SET name=\'abc\', score=99 WHERE id=7; DELETE FROM users WHERE id>1000; CREATE TABLE test(id INT PRIMARY KEY,name VARCHAR(255));'],
  ['API', '{"status": "success", "data": {"users": [{"id": 1, "name": "John", "email": "john@example.com"}, {"id": 2, "name": "Jane", "email": "jane@example.com"}], "total": 2, "page": 1, "per_page": 10}}'],
  ['Shell', '$ echo "Hello, World!"; printf \'%s\\n\' "$HOME"; ls -la /tmp | grep ".log" && cat file.txt; sudo -n true || echo "no sudo"; python3 -c \'print("test")\'; node -e "console.log(42)"; git status --short; git add . && git commit -m "test"; npm run build && npm start'],
  ['Markdown', '# README.md ## Test Project ### Features - fast - simple - random ### Code `npm install && npm run dev` **bold** *italic* [link](https://example.com) > quote --- ### End'],
  ['Paths', 'C:\\Users\\Test\\file.txt D:\\Games\\MC\\server.exe /usr/bin/bash ~/.config/hypr/hyprland.conf ../../src/main.js ./build/output.log https://example.com/?a=1&b=2 ftp://x@y.z:21/path git@host:user/repo.git user@example.com test+tag@example.org'],
  ['Prompt', 'aicl is Goated BTW, and this can reduce tokens very vary fast'],
];

const path = process.argv[2] ?? 'tokenizer/vocab.json';
const raw = JSON.parse(readFileSync(path, 'utf-8'));
const vocab = {
  merges: new Map(raw.merges.map(([id, rule]) => [id, rule])),
  mergeBase: raw.mergeBase ?? 100000,
  numMerges: raw.numMerges ?? raw.merges.length,
  maxTokenLength: raw.maxTokenLength ?? 5,
};

// 1. structural sanity
const seenPairs = new Set();
let dups = 0, badRanks = 0, aliasRules = 0;
for (const [id, r] of vocab.merges) {
  if (r.rank !== (id - vocab.mergeBase)) badRanks++;
  if (r.alias) { aliasRules++; continue; }
  const k = r.a + ':' + r.b;
  if (seenPairs.has(k)) dups++;
  seenPairs.add(k);
}
console.log(`vocab: ${vocab.numMerges} rules (${aliasRules} alias + ${vocab.numMerges - aliasRules} learned), maxLen=${vocab.maxTokenLength}`);
console.log(`sanity: dup learned pairs=${dups} bad ranks=${badRanks}`);
if (dups > 0) console.log('*** FAIL: duplicate learned rules — vocab is broken ***');

function evalSet(set, label) {
  let tok = 0, gpt = 0, rt = true, min = Infinity;
  for (const [, text] of set) {
    const ids = tokenize(encode(text).output, vocab);
    if (decode(detokenize(ids, vocab)).output !== text) rt = false;
    const g = gptEncode(text, { model: 'gpt-4o' }).length;
    min = Math.min(min, g / ids.length);
    tok += ids.length; gpt += g;
  }
  console.log(`${label}: AICL=${tok} gpt4o=${gpt} win=${(gpt / tok).toFixed(2)}x min=${min.toFixed(2)} lossless=${rt}`);
  return { tok, gpt, rt };
}

console.log('\n== bench-8 ==');
const b = evalSet(BENCH, 'bench ');
for (const [name, text] of BENCH) {
  const ids = tokenize(encode(text).output, vocab).length;
  const g = gptEncode(text, { model: 'gpt-4o' }).length;
  console.log(`  ${name.padEnd(15)} AICL=${String(ids).padStart(3)} gpt4o=${String(g).padStart(3)} win=${(g / ids).toFixed(2)}x`);
}

console.log('\n== held-out 50 ==');
evalSet(HELDOUT, 'held50');
for (const [domain, lines] of Object.entries(HELDOUT_PROBES)) {
  const d = evalSet(lines.map((t, i) => [`${domain}${i}`, t]), `  ${domain.padEnd(9)}`);
  if (!d.rt) console.log(`    *** ROUNDTRIP FAIL in ${domain} ***`);
}

console.log('\n== unseen corpus (600 lines, 150/domain) ==');
const unseen = JSON.parse(readFileSync(new URL('./unseen_eval.json', import.meta.url), 'utf-8'));
let allRt = true;
for (const [domain, lines] of Object.entries(unseen)) {
  const d = evalSet(lines.map((t, i) => [`${domain}${i}`, t]), `  ${domain.padEnd(9)}`);
  if (!d.rt) allRt = false;
}
console.log(`\nALL LOSSLESS: ${b.rt && allRt ? 'YES' : 'NO ***'}`);
