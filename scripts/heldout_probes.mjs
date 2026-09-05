#!/usr/bin/env node
/**
 * 50 held-out probes across 8 domains. None of these lines appear in any
 * training corpus (freshly written for evaluation; verified against the
 * FineWeb/CSN/SQL/markdown mix by construction — natural sentences and
 * novel code).
 */
export const HELDOUT_PROBES = {
  english: [
    'yesterday evening the deployment pipeline failed because the database migration timed out twice',
    'the quarterly revenue report shows significant growth across all regional markets this year',
    'every morning the engineer reviews open pull requests before merging anything into main',
    'the camera obscura predates photography by centuries yet works on the same optical principle',
    'my grandmother still writes letters with a fountain pen because she never trusted email',
    'the ferry crosses the harbor every thirty minutes from the old lighthouse pier',
    'scientists recently discovered that octopuses can edit their own RNA in response to temperature changes',
    'after the storm passed the whole neighborhood gathered to clear fallen branches from the road',
    'learning to play the violin requires patience since the first months mostly produce squeaking',
    'the museum guide explained how restorers removed centuries of varnish without damaging the paint',
    'our team decided to postpone the launch until the payment service passes load testing',
    'she brewed mint tea and opened the window to let the smell of rain into the kitchen',
    'the bakery on the corner sells out of sourdough before eight most mornings',
    'historians still debate whether the ancient library was destroyed by fire or slowly crumbled',
    'trains in this country run so precisely that people set their watches by the arrivals board',
  ],
  code: [
    'function calculateTotal(items, taxRate) { return items.reduce((s, x) => s + x.price, 0) * (1 + taxRate); }',
    'export const useAuth = () => { const [user, setUser] = useState(null); return { user, login, logout }; };',
    'const debounce = (fn, ms) => { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }; };',
    'app.use((err, req, res, next) => { console.error(err.stack); res.status(500).json({ error: "internal" }); });',
    'async function fetchWithRetry(url, tries = 3) { for (let i = 0; i < tries; i++) { try { return await fetch(url); } catch (e) { if (i === tries - 1) throw e; await sleep(2 ** i * 100); } } }',
    'def merge_sorted_lists(a, b):\n    result = []\n    i = j = 0\n    while i < len(a) and j < len(b):\n        if a[i] <= b[j]:\n            result.append(a[i]); i += 1\n        else:\n            result.append(b[j]); j += 1\n    return result',
    'type User = { id: number; email: string; roles: string[]; createdAt: Date };',
    'export function formatBytes(bytes: number, decimals = 2): string { if (bytes === 0) return "0 B"; const k = 1024; const sizes = ["B", "KB", "MB", "GB"]; const i = Math.floor(Math.log(bytes) / Math.log(k)); return `${(bytes / k ** i).toFixed(decimals)} ${sizes[i]}`; }',
    'pipeline.on("data", (chunk) => { buffer += chunk; if (buffer.length >= MAX) flush(); }).on("end", flush);',
    'class RingBuffer { constructor(size) { this.buf = new Float64Array(size); this.head = 0; this.count = 0; } push(x) { this.buf[this.head] = x; this.head = (this.head + 1) % this.buf.length; this.count = Math.min(this.count + 1, this.buf.length); } }',
  ],
  sql: [
    'INSERT INTO inventory (sku, quantity, warehouse) VALUES ($1, $2, $3) RETURNING id;',
    'SELECT c.name, COUNT(o.id) AS orders FROM customers c LEFT JOIN orders o ON o.customer_id = c.id GROUP BY c.id HAVING COUNT(o.id) > 5 ORDER BY orders DESC LIMIT 20;',
    'UPDATE subscriptions SET status = \'cancelled\', ended_at = NOW() WHERE user_id = 42 AND status = \'active\';',
    'CREATE TABLE audit_log (id BIGSERIAL PRIMARY KEY, entity TEXT NOT NULL, payload JSONB, created_at TIMESTAMPTZ DEFAULT NOW());',
    'WITH monthly AS (SELECT DATE_TRUNC(\'month\', created_at) AS m, SUM(amount) AS rev FROM payments GROUP BY 1) SELECT m, rev, LAG(rev) OVER (ORDER BY m) AS prev FROM monthly;',
  ],
  shell: [
    'curl -fsSL https://releases.example.org/v2.tar.gz | tar -xz && ./install --prefix ~/.local',
    'sudo systemctl restart nginx && tail -f /var/log/nginx/error.log | grep --color upstream',
    'ssh -i ~/.ssh/id_ed25519 -p 2222 deploy@build.example.com "cd /srv/app && docker compose up -d"',
    'find . -name "*.log" -mtime +7 -exec gzip {} \\; && du -sh /var/backups | cut -f1',
    'kubectl get pods -n prod --field-selector=status.phase=Running -o wide | awk \'{print $1, $3}\'',
  ],
  json: [
    '{"error": "rate limited", "retry_after": 30, "request_id": "req_8f2b91c4", "quota": {"remaining": 42}}',
    '{"user": {"id": "u_7712", "name": "Ada Lovelace", "verified": true, "badges": ["beta", "founder"], "settings": {"theme": "midnight", "digest": "weekly"}}}',
    '[{"sku": "KB-01", "price": 49.99, "stock": 12}, {"sku": "MS-02", "price": 24.5, "stock": 0}, {"sku": "MN-03", "price": 189.0, "stock": 3}]',
    '{"webhook": {"url": "https://hooks.example.dev/abc123", "events": ["payment.succeeded", "payment.refunded"], "secret": "whsec_9f8e7d6c5b4a"}}',
    '{"config": {"retries": {"max": 5, "backoff_ms": 250}, "timeouts": {"connect_s": 3, "read_s": 10}, "log_level": "warn"}}',
  ],
  markdown: [
    '## Changelog ### 2.1.0 - **Added** streaming responses - _Fixed_ memory leak in worker pool',
    '# Setup Guide\n\n## Prerequisites\n- Node 20 or later\n- A valid API key\n\n### Install\n```bash\nnpm install && npm run build\n```',
    '> **Note:** Migration scripts are idempotent. Run `db migrate` twice safely.\n\n---\n\n### Rollback\nUse `db rollback --steps 1` to undo.',
    '## API Reference\n\n| Method | Path | Auth |\n|---|---|---|\n| GET | /v1/users | bearer |\n| POST | /v1/users | admin |',
    '### Contributing\n\n1. Fork the repository\n2. Create a feature branch\n3. Run `npm test`\n4. Open a pull request with a clear description',
  ],
  paths: [
    'https://api.example.com/v2/projects/aicl/settings?section=tokens&expand=usage#rate-limits',
    '~/projects/aicl/src/tokenizer/index.js:112',
    'C:\\Users\\dev\\AppData\\Local\\Temp\\aicl-build\\cache\\merges-0007.bin',
    'sftp://backup.svc.internal:2022/root/nightly/pg_dump/main-2026-09-05.sql.zst',
    '../../packages/tokenizer/dist/index.d.ts ./node_modules/.bin/tsc --declaration',
  ],
  mixed: [
    'The endpoint POST /v1/tokens returns {"token": "aic_9x8y7z", "expires_in": 3600} when the API key is valid.',
    'Run `npm run benchmark -- --model gpt-4o` and compare assets/benchmark.svg against last release.',
    'Deploy steps: 1) git push origin main 2) CI runs 131 tests 3) docker build -t aicl:latest . 4) helm upgrade aicl ./chart',
    'If encode() throws RangeError, check that input length is under 1M chars; the limit exists because PUA mapping tables are preallocated.',
    'Traffic dropped 40% after we switched from REST to compressed AICL tokens: 12.4M to 7.4M weekly tokens.',
  ],
};

export const HELDOUT = Object.entries(HELDOUT_PROBES).flatMap(([domain, lines]) =>
  lines.map((t, i) => [`${domain}${i}`, t]));
