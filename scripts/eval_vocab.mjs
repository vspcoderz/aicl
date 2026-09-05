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
  '{"error": "rate limited", "retry_after": 30, "request_id": "req_8f2b91c4", "quota": {"remaining": 42}}',
  'sudo systemctl restart nginx && tail -f /var/log/nginx/error.log | grep --color upstream',
  'export const useAuth = () => { const [user, setUser] = useState(null); return { user, login, logout }; };',
  '## Changelog ### 2.1.0 - **Added** streaming responses - _Fixed_ memory leak in worker pool',
  'ssh -i ~/.ssh/id_ed25519 -p 2222 deploy@build.example.com "cd /srv/app && docker compose up -d"',
  'the camera obscura predates photography by centuries yet works on the same optical principle',
];

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
const h = evalSet(HELDOUT.map((t, i) => ['held' + i, t]));
console.log(`vocab: ${vocab.numMerges} merges, maxLen=${vocab.maxTokenLength}`);
console.log(`bench : total AICL=${b.tok} vs gpt4o=${b.gpt} win=${b.win.toFixed(2)}x min=${b.minWin.toFixed(2)} lossless=${b.lossless}`);
for (const r of b.rows) console.log(`  ${r.name.padEnd(15)} AICL=${String(r.tok).padStart(3)} gpt4o=${String(r.gpt).padStart(3)} win=${r.win.toFixed(2)}x rt=${r.rt ? 'ok' : 'FAIL'}`);
console.log(`held  : win=${h.win.toFixed(2)}x min=${h.minWin.toFixed(2)} lossless=${h.lossless}`);
for (const r of h.rows) console.log(`  ${r.name.padEnd(15)} AICL=${String(r.tok).padStart(3)} gpt4o=${String(r.gpt).padStart(3)} win=${r.win.toFixed(2)}x`);
