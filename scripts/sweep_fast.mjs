#!/usr/bin/env node
/**
 * Sweep Stage-2 configs across candidate corpora with the fast trainer.
 * Selection signal: benchmark win AND held-out win (vs gpt-4o).
 */
import { readFileSync } from 'fs';
import { encode } from '../src/encoder.js';
import { decode } from '../src/decoder.js';
import { tokenize, detokenize } from '../src/tokenizer/index.js';
import { trainTokenizerFast } from './train_fast.mjs';
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

// None of these appear in any training corpus — pure generalization probe
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

const CORPORA = [
  ['v1', 'corpus/bpe_train.txt'],
  ['v4', 'corpus/bpe_train_v4.txt'],
  ['blend', 'corpus/bpe_train_blend.txt'],
];

const CONFIGS = [
  { numMerges: 2048, maxTokenLength: 8, minFrequency: 2 },
  { numMerges: 2048, maxTokenLength: 9, minFrequency: 2 },
  { numMerges: 3072, maxTokenLength: 9, minFrequency: 2 },
  { numMerges: 4096, maxTokenLength: 10, minFrequency: 2 },
];

function evalSet(vocab, set) {
  let tok = 0, gpt = 0, minWin = Infinity, lossless = true;
  for (const [name, text] of set) {
    const enc = encode(text);
    const ids = tokenize(enc.output, vocab);
    if (decode(detokenize(ids, vocab)).output !== text) lossless = false;
    const g = gptEncode(text, { model: 'gpt-4o' }).length;
    const w = g / ids.length;
    if (w < minWin) minWin = w;
    tok += ids.length; gpt += g;
  }
  return { tok, gpt, win: gpt / tok, minWin, lossless };
}

const results = [];
for (const [cname, cpath] of CORPORA) {
  const lines = readFileSync(cpath, 'utf-8').split('\n').filter(Boolean);
  for (const cfg of CONFIGS) {
    const t0 = Date.now();
    const vocab = trainTokenizerFast(lines, { ...cfg, mergeBase: 100000 });
    const ms = Date.now() - t0;
    const b = evalSet(vocab, BENCH);
    const h = evalSet(vocab, HELDOUT.map((t, i) => ['held' + i, t]));
    results.push({ cname, cfg, act: vocab.numMerges, ms, b, h });
    console.log(`[${cname}] merges=${vocab.numMerges} maxLen=${cfg.maxTokenLength} minFreq=${cfg.minFrequency} (${(ms / 1000).toFixed(1)}s)`);
    console.log(`  bench: AICL=${b.tok} vs ${b.gpt} win=${b.win.toFixed(2)}x min=${b.minWin.toFixed(2)} lossless=${b.lossless}`);
    console.log(`  held : win=${h.win.toFixed(2)}x min=${h.minWin.toFixed(2)} lossless=${h.lossless}`);
  }
}

console.log('\n' + '='.repeat(80));
console.log('ranked by held-out win, then bench win (baseline: 512/5 v1 → bench 3.16x, held 0.78x)');
console.log('='.repeat(80));
for (const r of [...results].sort((x, y) => (y.h.win - x.h.win) || (y.b.win - x.b.win))) {
  console.log(`[${r.cname}] act=${r.act} len=${r.cfg.maxTokenLength} minFreq=${r.cfg.minFrequency} | bench ${r.b.win.toFixed(2)}x min=${r.b.minWin.toFixed(2)} | held ${r.h.win.toFixed(2)}x min=${r.h.minWin.toFixed(2)}`);
}
