#!/usr/bin/env node
import { encode } from '../src/encoder.js';
import { tokenize, loadTokenizer } from '../src/tokenizer/index.js';
import { encode as gptEncode } from 'gpt-tokenizer';
import llamaTok from 'llama-tokenizer-js/llama-tokenizer.js';

const vocab = loadTokenizer();
const TESTS = [
  ['Common English', 'the quick brown fox jumps over the lazy dog this is a test of the emergency broadcast system how now brown cow the rain in spain stays mainly on the plain'],
  ['Code', 'const app = express(); app.get("/api/tasks", async (req, res) => { const tasks = await db.query("SELECT * FROM tasks"); res.json(tasks); });'],
  ['SQL', 'SELECT * FROM users WHERE id=42 AND name LIKE \'%test%\' ORDER BY created_at DESC; INSERT INTO table_name (a,b,c) VALUES (1,\'x\',true); UPDATE users SET name=\'abc\', score=99 WHERE id=7; DELETE FROM users WHERE id>1000; CREATE TABLE test(id INT PRIMARY KEY,name VARCHAR(255));'],
  ['API', '{"status": "success", "data": {"users": [{"id": 1, "name": "John", "email": "john@example.com"}, {"id": 2, "name": "Jane", "email": "jane@example.com"}], "total": 2, "page": 1, "per_page": 10}}'],
  ['Shell', '$ echo "Hello, World!"; printf \'%s\\n\' "$HOME"; ls -la /tmp | grep ".log" && cat file.txt; sudo -n true || echo "no sudo"; python3 -c \'print("test")\'; node -e "console.log(42)"; git status --short; git add . && git commit -m "test"; npm run build && npm start'],
  ['Markdown', '# README.md ## Test Project ### Features - fast - simple - random ### Code `npm install && npm run dev` **bold** *italic* [link](https://example.com) > quote --- ### End'],
  ['Paths', 'C:\\Users\\Test\\file.txt D:\\Games\\MC\\server.exe /usr/bin/bash ~/.config/hypr/hyprland.conf ../../src/main.js ./build/output.log https://example.com/?a=1&b=2 ftp://x@y.z:21/path git@host:user/repo.git user@example.com test+tag@example.org'],
  ['Prompt', 'aicl is Goated BTW, and this can reduce tokens very vary fast'],
];
console.log('test | raw | aiclChars | toks | stage1x | CPT | EN/tok | gpt4o | win');
let tRaw = 0, tAicl = 0, tTok = 0, tGpt = 0;
for (const [name, text] of TESTS) {
  const enc = encode(text);
  const aiclChars = [...enc.output].length;
  const toks = tokenize(enc.output, vocab).length;
  const raw = [...text].length;
  const gpt4o = gptEncode(text, { model: 'gpt-4o' }).length;
  tRaw += raw; tAicl += aiclChars; tTok += toks; tGpt += gpt4o;
  console.log(`${name} | ${raw} | ${aiclChars} | ${toks} | ${(raw / aiclChars).toFixed(2)} | ${(aiclChars / toks).toFixed(2)} | ${(raw / toks).toFixed(2)} | ${gpt4o} | ${(gpt4o / toks).toFixed(2)}`);
}
console.log(`TOTAL | ${tRaw} | ${tAicl} | ${tTok} | ${(tRaw / tAicl).toFixed(2)} | ${(tAicl / tTok).toFixed(2)} | ${(tRaw / tTok).toFixed(2)} | ${tGpt} | ${(tGpt / tTok).toFixed(2)}`);
console.log(`vocab ${vocab.numMerges} merges maxLen=${vocab.maxTokenLength} v=${vocab.version}`);
// held-out: paraphrases NOT in training corpus
const heldout = [
  'yesterday evening the deployment pipeline failed because the database migration timed out twice',
  'function calculateTotal(items, taxRate) { return items.reduce((s, x) => s + x.price, 0) * (1 + taxRate); }',
  'the quarterly revenue report shows significant growth across all regional markets this year',
];
console.log('--- held-out ---');
for (const text of heldout) {
  const enc = encode(text);
  const aiclChars = [...enc.output].length;
  const toks = tokenize(enc.output, vocab).length;
  const raw = [...text].length;
  const gpt4o = gptEncode(text, { model: 'gpt-4o' }).length;
  console.log(`raw=${raw} aicl=${aiclChars} toks=${toks} CPT=${(aiclChars / toks).toFixed(2)} EN/tok=${(raw / toks).toFixed(2)} gpt4o=${gpt4o} win=${(gpt4o / toks).toFixed(2)} :: ${text.slice(0, 60)}`);
}
