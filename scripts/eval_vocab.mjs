#!/usr/bin/env node
/**
 * Evaluate a tokenizer vocab on the 8 benchmark tests + held-out probe.
 * Usage: node scripts/eval_vocab.mjs [path/to/vocab.json]
 */
import { readFileSync } from 'fs';
import { encode } from '../src/encoder.js';
import { decode } from '../src/decoder.js';
import { tokenize, detokenize, loadTokenizer } from '../src/tokenizer/index.js';
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

// Full 50-probe held-out set lives in heldout_probes.mjs — none of it is in any
// training corpus.

const vocab = process.argv[2]
  ? (() => {
      const raw = JSON.parse(readFileSync(process.argv[2], 'utf-8'));
      return { merges: new Map(raw.merges.map(([id, rule]) => [id, rule])), mergeBase: raw.mergeBase ?? 100000, numMerges: raw.numMerges ?? raw.merges.length, maxTokenLength: raw.maxTokenLength ?? 5 };
    })()
  : loadTokenizer();

function evalSet(set) {
  let raw = 0, tok = 0, gpt = 0, minWin = Infinity, lossless = true;
  const rows = [];
  for (const [name, text] of set) {
    const enc = encode(text);
    const ids = tokenize(enc.output, vocab);
    const rt = decode(detokenize(ids, vocab)).output === text;
    if (!rt) lossless = false;
    const g = gptEncode(text, { model: 'gpt-4o' }).length;
    const w = g / ids.length;
    if (w < minWin) minWin = w;
    raw += [...text].length; tok += ids.length; gpt += g;
    rows.push({ name, tok: ids.length, g, win: w, rt });
  }
  return { tok, gpt, win: gpt / tok, minWin, lossless, rows, raw };
}

const b = evalSet(BENCH);
const h = evalSet(HELDOUT);
console.log(`vocab: ${vocab.numMerges} merges, maxLen=${vocab.maxTokenLength}`);
console.log(`bench : total AICL=${b.tok} vs gpt4o=${b.gpt} win=${b.win.toFixed(2)}x min=${b.minWin.toFixed(2)} lossless=${b.lossless}`);
for (const r of b.rows) console.log(`  ${r.name.padEnd(15)} AICL=${String(r.tok).padStart(3)} gpt4o=${String(r.g).padStart(3)} win=${r.win.toFixed(2)}x rt=${r.rt ? 'ok' : 'FAIL'}`);
console.log(`held50: win=${h.win.toFixed(2)}x min=${h.minWin.toFixed(2)} lossless=${h.lossless}`);
for (const [domain, lines] of Object.entries(HELDOUT_PROBES)) {
  const d = evalSet(lines.map((t, i) => [`${domain}${i}`, t]));
  console.log(`  ${domain.padEnd(9)} win=${d.win.toFixed(2)}x min=${d.minWin.toFixed(2)} lossless=${d.lossless}`);
  for (const r of d.rows) if (!r.rt) console.log(`    ROUNDTRIP FAIL: ${r.name}`);
}
