#!/usr/bin/env node
/**
 * Sweep Stage-2 configs on canonical per-line corpus + mixed eval.
 *
 * Trains on corpus/bpe_train.txt split into LINES (boundary-preserving),
 * then reports BOTH benchmark-8 metrics AND held-out generalization metrics.
 * Selection: maximize min(heldout win) first, then benchmark total win.
 */
import { readFileSync } from 'fs';
import { encode } from '../src/encoder.js';
import { decode } from '../src/decoder.js';
import { trainTokenizer, tokenize, detokenize } from '../src/tokenizer/index.js';
import { encode as gptEncode } from 'gpt-tokenizer';

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

// NEVER in training corpus — pure generalization probe
const HELDOUT = [
  'yesterday evening the deployment pipeline failed because the database migration timed out twice',
  'the quarterly revenue report shows significant growth across all regional markets this year',
  'function calculateTotal(items, taxRate) { return items.reduce((s, x) => s + x.price, 0) * (1 + taxRate); }',
  'every morning the engineer reviews open pull requests before merging anything into main',
  'INSERT INTO inventory (sku, quantity, warehouse) VALUES ($1, $2, $3) RETURNING id;',
  'curl -fsSL https://releases.example.org/v2.tar.gz | tar -xz && ./install --prefix ~/.local',
];

const lines = readFileSync('corpus/bpe_train.txt', 'utf-8').split('\n').filter(Boolean);
console.log(`corpus lines: ${lines.length}, chars: ${lines.join('').length}`);

function evalSet(vocab, set) {
  let raw = 0, aicl = 0, tok = 0, gpt = 0, minWin = Infinity, lossless = true;
  const rows = [];
  for (const [name, text] of set) {
    const enc = encode(text);
    const a = [...enc.output].length;
    const ids = tokenize(enc.output, vocab);
    const rt = decode(detokenize(ids, vocab)).output === text;
    if (!rt) lossless = false;
    const g = gptEncode(text, { model: 'gpt-4o' }).length;
    const w = g / ids.length;
    if (w < minWin) minWin = w;
    raw += [...text].length; aicl += a; tok += ids.length; gpt += g;
    rows.push({ name, cpt: (a / ids.length).toFixed(2), win: w.toFixed(2), rt });
  }
  return { raw, aicl, tok, gpt, cpt: aicl / tok, win: gpt / tok, minWin, lossless, rows };
}

const CONFIGS = [
  { numMerges: 1024, maxTokenLength: 8, minFrequency: 2 },
  { numMerges: 2048, maxTokenLength: 8, minFrequency: 3 },
  { numMerges: 2048, maxTokenLength: 10, minFrequency: 3 },
  { numMerges: 4096, maxTokenLength: 10, minFrequency: 5 },
];

const results = [];
for (const cfg of CONFIGS) {
  const t0 = Date.now();
  const vocab = trainTokenizer(lines, { ...cfg, mergeBase: 100000 });
  const ms = Date.now() - t0;
  const b = evalSet(vocab, BENCH);
  const h = evalSet(vocab, HELDOUT.map((t, i) => ['held' + i, t]));
  results.push({ cfg, actual: vocab.numMerges, ms, b, h });
  console.log(`merges=${cfg.numMerges} maxLen=${cfg.maxTokenLength} minFreq=${cfg.minFrequency} actual=${vocab.numMerges} ${ms}ms`);
  console.log(`  bench: CPT=${b.cpt.toFixed(2)} win=${b.win.toFixed(2)}x minWin=${b.minWin.toFixed(2)} lossless=${b.lossless}`);
  console.log(`  held : CPT=${h.cpt.toFixed(2)} win=${h.win.toFixed(2)}x minWin=${h.minWin.toFixed(2)} lossless=${h.lossless}`);
}

console.log('\n' + '='.repeat(90));
console.log('SWEEP (bench CPT/win + held-out CPT/win)');
console.log('='.repeat(90));
for (const r of results) {
  console.log(`req=${r.cfg.numMerges} act=${r.actual} len=${r.cfg.maxTokenLength} | bench CPT=${r.b.cpt.toFixed(2)} win=${r.b.win.toFixed(2)}x min=${r.b.minWin.toFixed(2)} | held CPT=${r.h.cpt.toFixed(2)} win=${r.h.win.toFixed(2)}x min=${r.h.minWin.toFixed(2)} | ${r.ms}ms`);
  for (const row of r.b.rows) console.log(`    bench ${row.name}: CPT=${row.cpt} win=${row.win}x rt=${row.rt ? 'ok' : 'FAIL'}`);
  for (const row of r.h.rows) console.log(`    held  ${row.name}: CPT=${row.cpt} win=${row.win}x rt=${row.rt ? 'ok' : 'FAIL'}`);
}
