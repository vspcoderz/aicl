#!/usr/bin/env node
import { readFileSync } from 'fs';
import { encode } from '../src/encoder.js';
import { trainTokenizer, tokenize, detokenize } from '../src/tokenizer/index.js';
import { encode as gptEncode } from 'gpt-tokenizer';

const TESTS = [
  ['Common English', 'the quick brown fox jumps over the lazy dog this is a test of the emergency broadcast system how now brown cow the rain in spain stays mainly on the plain'],
  ['Code', 'const app = express(); app.get("/api/tasks", async (req, res) => { const tasks = await db.query("SELECT * FROM tasks"); res.json(tasks); });'],
  ['SQL', "SELECT * FROM users WHERE id=42 AND name LIKE '%test%' ORDER BY created_at DESC; INSERT INTO table_name (a,b,c) VALUES (1,'x',true); UPDATE users SET name='abc', score=99 WHERE id=7; DELETE FROM users WHERE id>1000; CREATE TABLE test(id INT PRIMARY KEY,name VARCHAR(255));"],
  ['API', '{"status": "success", "data": {"users": [{"id": 1, "name": "John", "email": "john@example.com"}, {"id": 2, "name": "Jane", "email": "jane@example.com"}], "total": 2, "page": 1, "per_page": 10}}'],
  ['Shell', '$ echo "Hello, World!"; printf \'%s\\n\' "$HOME"; ls -la /tmp | grep ".log" && cat file.txt; sudo -n true || echo "no sudo"; python3 -c \'print("test")\'; node -e "console.log(42)"; git status --short; git add . && git commit -m "test"; npm run build && npm start'],
  ['Markdown', '# README.md ## Test Project ### Features - fast - simple - random ### Code `npm install && npm run dev` **bold** *italic* [link](https://example.com) > quote --- ### End'],
  ['Paths', 'C:\\Users\\Test\\file.txt D:\\Games\\MC\\server.exe /usr/bin/bash ~/.config/hypr/hyprland.conf ../../src/main.js ./build/output.log https://example.com/?a=1&b=2 ftp://x@y.z:21/path git@host:user/repo.git user@example.com test+tag@example.org'],
  ['Prompt', 'aicl is Goated BTW, and this can reduce tokens very vary fast'],
];

// Use a compact corpus: 50k chars from diverse sources
const rawCorpus = readFileSync('corpus/aicl_train.txt', 'utf-8');
const lines = rawCorpus.split('\n');
// Take every 25th line → ~1400 lines, ~50k chars
const trainCorpus = lines.filter((_, i) => i % 25 === 0).join('\n');
console.log(`Train corpus: ${trainCorpus.length} chars, ${trainCorpus.split('\n').length} lines`);

const testAicl = TESTS.map(([name, text]) => {
  const enc = encode(text);
  return { name, raw: text, aicl: enc.output, rawLen: [...text].length, aiclLen: [...enc.output].length };
});

const MERGE_COUNTS = [128, 256, 384, 512];
const results = [];

for (const numMerges of MERGE_COUNTS) {
  console.log(`\nTraining ${numMerges} merges...`);
  const t0 = Date.now();
  const vocab = trainTokenizer([trainCorpus], { numMerges, mergeBase: 100000, maxTokenLength: 5, minFrequency: 2 });
  const trainMs = Date.now() - t0;

  let totalAicl = 0, totalTokens = 0, totalGpt = 0, wins = 0;
  const rows = [];
  for (const t of testAicl) {
    const ids = tokenize(t.aicl, vocab);
    const ok = detokenize(ids, vocab) === t.aicl;
    const gpt = gptEncode(t.raw, { model: 'gpt-4o' }).length;
    const w = gpt / ids.length;
    totalAicl += t.aiclLen; totalTokens += ids.length; totalGpt += gpt;
    if (w >= 1.0) wins++;
    rows.push({ name: t.name, aicl: t.aiclLen, tok: ids.length, cpt: (t.aiclLen / ids.length).toFixed(2), gpt4o: gpt, win: w.toFixed(2), ok });
  }
  const totalWin = totalGpt / totalTokens;
  const avgCpt = totalAicl / totalTokens;
  results.push({ numMerges, actual: vocab.numMerges, avgCpt, totalWin, wins, trainMs, rows });
  console.log(`  actual: ${vocab.numMerges}, CPT: ${avgCpt.toFixed(2)}, win: ${totalWin.toFixed(2)}x, ${wins}/8, ${trainMs}ms`);
}

console.log('\n' + '='.repeat(85));
console.log('SWEEP RESULTS');
console.log('='.repeat(85));
console.log(`${'Req'.padStart(5)} | ${'Act'.padStart(5)} | ${'CPT'.padStart(6)} | ${'Win×'.padStart(7)} | ${'W/L'.padStart(5)} | ${'ms'.padStart(7)}`);
console.log('-'.repeat(85));
for (const r of results) {
  console.log(`${String(r.numMerges).padStart(5)} | ${String(r.actual).padStart(5)} | ${r.avgCpt.toFixed(2).padStart(6)} | ${r.totalWin.toFixed(2).padStart(7)} | ${(r.wins+'/8').padStart(5)} | ${String(r.trainMs).padStart(7)}`);
}

const best = results.reduce((a, b) => b.totalWin > a.totalWin ? b : a);
console.log(`\nBest: ${best.numMerges} merges (${best.actual} actual) → ${best.totalWin.toFixed(2)}x total, CPT ${best.avgCpt.toFixed(2)}`);
console.log(`\n${'Test'.padStart(16)} | ${'AICL'.padStart(5)} | ${'Tok'.padStart(5)} | ${'CPT'.padStart(5)} | ${'GPT-4o'.padStart(6)} | ${'Win×'.padStart(6)}`);
console.log('-'.repeat(70));
for (const r of best.rows) console.log(`${r.name.padStart(16)} | ${String(r.aicl).padStart(5)} | ${String(r.tok).padStart(5)} | ${r.cpt.padStart(5)} | ${String(r.gpt4o).padStart(6)} | ${r.win.padStart(6)}`);
