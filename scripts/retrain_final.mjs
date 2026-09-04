#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';
import { encode } from '../src/encoder.js';
import { trainTokenizer, saveTokenizer, tokenize, detokenize, VOCAB_PATH } from '../src/tokenizer/index.js';
import { encode as gptEncode } from 'gpt-tokenizer';

// ── Load corpus (subsample to 200k chars for fast training) ──
const rawCorpus = readFileSync('corpus/aicl_train.txt', 'utf-8');
const lines = rawCorpus.split('\n');
const trainCorpus = lines.filter((_, i) => i % 6 === 0).join('\n');
console.log(`Train corpus: ${trainCorpus.length} chars, ${lines.filter((_, i) => i % 6 === 0).length} lines`);

// ── Train ──
console.log('Training 512 merges...');
const t0 = Date.now();
const vocab = trainTokenizer([trainCorpus], {
  numMerges: 512,
  mergeBase: 100000,
  maxTokenLength: 5,
  minFrequency: 2,
});
const trainMs = Date.now() - t0;
console.log(`Trained in ${trainMs}ms — ${vocab.numMerges} merges`);

// ── Save ──
saveTokenizer(vocab);
console.log(`Saved to ${VOCAB_PATH}`);

// ── Evaluate on held-out tests ──
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

console.log('\n' + '='.repeat(85));
console.log('FINAL EVALUATION');
console.log('='.repeat(85));
console.log(`${'Test'.padStart(16)} | ${'Raw'.padStart(4)} | ${'AICL'.padStart(4)} | ${'Tok'.padStart(4)} | ${'CPT'.padStart(5)} | ${'GPT-4o'.padStart(6)} | ${'Win×'.padStart(6)} | Roundtrip`);
console.log('-'.repeat(85));

let totalRaw = 0, totalAicl = 0, totalTokens = 0, totalGpt = 0, wins = 0;
for (const [name, text] of TESTS) {
  const enc = encode(text);
  const aiclStr = enc.output;
  const ids = tokenize(aiclStr, vocab);
  const detok = detokenize(ids, vocab);
  const ok = detok === aiclStr;
  const gpt = gptEncode(text, { model: 'gpt-4o' }).length;
  const rawLen = [...text].length;
  const aiclLen = [...aiclStr].length;
  const cpt = aiclLen / ids.length;
  const win = gpt / ids.length;
  totalRaw += rawLen; totalAicl += aiclLen; totalTokens += ids.length; totalGpt += gpt;
  if (win >= 1.0) wins++;
  console.log(`${name.padStart(16)} | ${String(rawLen).padStart(4)} | ${String(aiclLen).padStart(4)} | ${String(ids.length).padStart(4)} | ${cpt.toFixed(2).padStart(5)} | ${String(gpt).padStart(6)} | ${win.toFixed(2).padStart(6)} | ${ok ? '✓' : '✗'}`);
}

const totalWin = totalGpt / totalTokens;
console.log('-'.repeat(85));
console.log(`${'TOTAL'.padStart(16)} | ${String(totalRaw).padStart(4)} | ${String(totalAicl).padStart(4)} | ${String(totalTokens).padStart(4)} | ${(totalAicl/totalTokens).toFixed(2).padStart(5)} | ${String(totalGpt).padStart(6)} | ${totalWin.toFixed(2).padStart(6)} | ${wins}/8 wins`);
console.log(`\nStage 1: ${(totalRaw/totalAicl).toFixed(2)}× · Stage 2: ${(totalAicl/totalTokens).toFixed(2)}× · Total: ${(totalRaw/totalTokens).toFixed(2)}×`);
