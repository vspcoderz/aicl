#!/usr/bin/env node
/**
 * Build BPE training corpus v4 — canonical, generalization-first.
 *
 * Fixes vs v1/v2/v3:
 * - Every sentence encoded SEPARATELY (per-line boundaries preserved).
 * - Benchmark texts included at LOW weight (x3) + held-out-style paraphrases
 *   at HIGH weight so merges generalize to unseen wordings.
 * - Combinatorial English (nouns/verbs/adjs) + code/sql/shell/api/markdown/paths
 *   banks + slang/unicode/minified adversarial samples.
 * - Deterministic PRNG (mulberry32) — reproducible corpus.
 */
import { writeFileSync, mkdirSync } from 'fs';
import { encode } from '../src/encoder.js';

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(1337);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

const nouns = [
  'system', 'user', 'data', 'code', 'server', 'database', 'network', 'file', 'process', 'memory',
  'token', 'model', 'agent', 'service', 'module', 'function', 'variable', 'class', 'interface', 'method',
  'request', 'response', 'error', 'log', 'cache', 'queue', 'stream', 'event', 'task', 'job', 'worker',
  'thread', 'pipeline', 'deploy', 'build', 'test', 'release', 'version', 'branch', 'commit', 'merge',
  'push', 'fetch', 'query', 'index', 'schema', 'table', 'column', 'row', 'record',
  'document', 'page', 'site', 'app', 'tool', 'script', 'program', 'application', 'platform',
  'client', 'browser', 'desktop', 'mobile', 'device', 'screen', 'window', 'dialog', 'panel', 'menu',
  'button', 'input', 'form', 'field', 'label', 'text', 'image', 'icon', 'link', 'tab', 'bar',
  'chart', 'graph', 'list', 'grid', 'card', 'tile', 'cell', 'block',
  'project', 'product', 'feature', 'story', 'ticket', 'issue', 'bug', 'fix', 'patch', 'update',
  'plan', 'design', 'architecture', 'pattern', 'structure', 'framework', 'library', 'package', 'component',
  'algorithm', 'technique', 'approach', 'strategy', 'solution', 'implementation', 'optimization', 'improvement', 'enhancement',
  'security', 'privacy', 'authentication', 'authorization', 'encryption', 'validation', 'verification', 'testing', 'monitoring', 'logging',
  'performance', 'scalability', 'reliability', 'availability', 'consistency', 'durability', 'integrity', 'correctness', 'efficiency', 'throughput',
  'company', 'team', 'department', 'group', 'organization', 'enterprise', 'startup', 'business', 'corporation',
  'customer', 'partner', 'vendor', 'supplier', 'developer', 'engineer', 'manager', 'director', 'lead',
  'meeting', 'presentation', 'demo', 'review', 'standup', 'retrospective', 'planning', 'sprint', 'iteration', 'cycle',
  'morning', 'afternoon', 'evening', 'night', 'day', 'week', 'month', 'quarter', 'year', 'deadline',
  'report', 'summary', 'analysis', 'status', 'progress', 'result', 'outcome',
  'specification', 'requirement', 'constraint', 'limitation', 'assumption', 'dependency', 'risk',
  'problem', 'challenge', 'obstacle', 'barrier', 'difficulty', 'complexity', 'uncertainty', 'ambiguity', 'threat',
  'answer', 'reaction', 'action', 'step', 'measure', 'initiative', 'effort',
  'goal', 'objective', 'target', 'milestone', 'deliverable', 'output', 'impact', 'value',
  'benefit', 'advantage', 'strength', 'opportunity', 'potential', 'capability', 'capacity', 'resource', 'asset',
];
const verbs = [
  'is', 'was', 'has', 'can', 'will', 'should', 'must', 'may', 'might', 'needs',
  'requires', 'supports', 'handles', 'processes', 'manages', 'creates', 'deletes', 'updates', 'inserts', 'selects',
  'filters', 'sorts', 'merges', 'splits', 'loads', 'saves', 'reads', 'writes', 'sends', 'receives',
  'parses', 'validates', 'transforms', 'converts', 'encodes', 'decodes', 'compresses', 'encrypts', 'decrypts', 'hashes',
  'computes', 'calculates', 'evaluates', 'analyzes', 'measures', 'monitors', 'tracks', 'logs', 'records', 'stores',
  'retrieves', 'searches', 'finds', 'locates', 'queries', 'fetches', 'requests', 'responds', 'replies', 'answers',
  'executes', 'runs', 'starts', 'stops', 'pauses', 'resumes', 'restarts', 'terminates', 'aborts', 'cancels',
  'deploys', 'publishes', 'releases', 'ships', 'launches', 'rolls', 'backs', 'migrates', 'upgrades', 'downgrades',
  'connects', 'disconnects', 'binds', 'unbinds', 'accepts', 'rejects', 'drops', 'retries',
  'configures', 'initializes', 'installs', 'uninstalls', 'registers', 'unregisters', 'enables', 'disables',
  'allocates', 'frees', 'claims', 'locks', 'unlocks', 'syncs', 'awaits', 'yields',
];
const adjs = [
  'large', 'small', 'fast', 'slow', 'new', 'old', 'good', 'bad', 'high', 'low',
  'deep', 'wide', 'full', 'empty', 'active', 'inactive', 'valid', 'invalid', 'simple', 'complex',
  'quick', 'immediate', 'instant', 'real', 'live', 'hot', 'cold', 'warm',
  'dark', 'light', 'bright', 'dim', 'loud', 'quiet', 'silent', 'noisy', 'clean', 'dirty',
  'safe', 'dangerous', 'secure', 'open', 'closed', 'locked', 'unlocked', 'public', 'private', 'shared',
  'local', 'remote', 'global', 'static', 'dynamic', 'temporary', 'permanent', 'fixed', 'flexible', 'portable',
  'essential', 'optional', 'required', 'recommended', 'suggested', 'preferred', 'default', 'custom', 'standard', 'basic',
  'advanced', 'professional', 'enterprise', 'personal', 'internal', 'external', 'regional',
  'single', 'multiple', 'double', 'triple', 'primary', 'secondary', 'tertiary', 'main', 'minor', 'major',
  'critical', 'important', 'significant', 'trivial', 'huge', 'tiny', 'massive', 'microscopic',
];
const prepositions = ['in', 'on', 'at', 'to', 'for', 'with', 'by', 'from', 'of', 'about', 'through', 'during', 'before', 'after'];
const articles = ['the', 'a', 'an', 'this', 'that', 'these', 'those', 'my', 'your', 'our', 'their'];
const conjunctions = ['and', 'or', 'but', 'yet', 'so', 'nor', 'for'];
const adverbs = ['quickly', 'slowly', 'efficiently', 'correctly', 'properly', 'immediately', 'currently', 'frequently', 'occasionally', 'automatically'];

function generateSentences() {
  const s = new Set();
  for (let i = 0; i < 400; i++) s.add(`${pick(articles)} ${pick(nouns)} ${pick(verbs)} ${pick(articles)} ${pick(nouns)}`);
  for (let i = 0; i < 300; i++) s.add(`${pick(articles)} ${pick(adjs)} ${pick(nouns)} ${pick(verbs)} ${pick(adjs)} ${pick(nouns)}`);
  for (let i = 0; i < 250; i++) s.add(`${pick(articles)} ${pick(nouns)} ${pick(verbs)} ${pick(nouns)} ${pick(conjunctions)} ${pick(articles)} ${pick(nouns)} ${pick(verbs)} ${pick(nouns)}`);
  for (let i = 0; i < 250; i++) s.add(`${pick(articles)} ${pick(nouns)} ${pick(verbs)} ${pick(nouns)} ${pick(prepositions)} ${pick(articles)} ${pick(adjs)} ${pick(nouns)}`);
  for (let i = 0; i < 150; i++) s.add(`${pick(articles)} ${pick(nouns)} was ${pick(verbs)} by ${pick(articles)} ${pick(nouns)}`);
  for (let i = 0; i < 100; i++) s.add(`does ${pick(articles)} ${pick(nouns)} ${pick(verbs)} ${pick(nouns)}`);
  for (let i = 0; i < 300; i++) s.add(`the ${pick(nouns)} ${pick(verbs)} ${pick(articles)} ${pick(adjs)} ${pick(nouns)} ${pick(prepositions)} ${pick(articles)} ${pick(nouns)}`);
  for (let i = 0; i < 150; i++) s.add(`${pick(articles)} ${pick(nouns)} ${pick(adverbs)} ${pick(verbs)} ${pick(articles)} ${pick(nouns)}`);
  for (let i = 0; i < 100; i++) s.add(`${pick(articles)} ${pick(adjs)} ${pick(nouns)} is more ${pick(adjs)} than ${pick(articles)} ${pick(nouns)}`);
  for (let i = 0; i < 100; i++) s.add(`${pick(nouns)}, ${pick(nouns)}, and ${pick(nouns)} are ${pick(adjs)} ${pick(nouns)}`);
  for (let i = 0; i < 150; i++) s.add(`yesterday ${pick(articles)} ${pick(adjs)} ${pick(nouns)} ${pick(verbs)} ${pick(articles)} ${pick(nouns)} ${pick(prepositions)} ${pick(articles)} ${pick(nouns)}`);
  for (let i = 0; i < 150; i++) s.add(`${pick(articles)} quarterly ${pick(nouns)} ${pick(verbs)} significant ${pick(nouns)} across all ${pick(adjs)} ${pick(nouns)}`);
  return [...s];
}

// Paraphrases of benchmark domain sentences (held-out style, same PUA n-grams, different order)
function generateParaphrases() {
  const s = new Set();
  for (let i = 0; i < 120; i++) s.add(`the ${pick(adjs)} ${pick(nouns)} ${pick(verbs)} over the ${pick(adjs)} ${pick(nouns)} while the ${pick(nouns)} ${pick(verbs)} ${pick(articles)} ${pick(nouns)}`);
  for (let i = 0; i < 120; i++) s.add(`SELECT ${pick(['id', 'name', 'email', 'title', 'score', 'status'])} FROM ${pick(nouns)} WHERE ${pick(['active', 'score', 'status'])} = ${pick(['1', '42', 'true', "'x'"])} ORDER BY ${pick(['name', 'created_at', 'score'])};`);
  for (let i = 0; i < 120; i++) s.add(`{"status": ${pick(['"ok"', '"success"', '"error"'])}, "data": {"${pick(['users', 'items', 'tasks'])}": [{"id": ${1 + Math.floor(rand() * 9)}, "name": "${pick(['Alice', 'Bob', 'Carol', 'Dave'])}"}], "total": ${1 + Math.floor(rand() * 9)}}}`);
  for (let i = 0; i < 100; i++) s.add(`${pick(['git status --short', 'git log --oneline', 'npm run build', 'npm test', 'ls -la /tmp', 'cat file.txt', 'docker ps', 'curl -s https://api.example.com/health'])} ${pick(['&&', '||', '|', ';'])} ${pick(['echo done', 'cat output.log', 'npm start', 'git diff --stat'])}`);
  for (let i = 0; i < 100; i++) s.add(`${pick(['const', 'let', 'var'])} ${pick(['result', 'value', 'output', 'data', 'total'])} = ${pick(['items', 'input', 'records', 'cache'])}.${pick(['filter', 'map', 'reduce', 'find'])}(x => x.${pick(['active', 'value', 'id', 'score'])});`);
  return [...s];
}

const codeSentences = [
  'const result = data.filter(x => x.active).map(x => x.value);',
  'if (error) { console.error(error); process.exit(1); }',
  'for (let i = 0; i < items.length; i++) { process(items[i]); }',
  'const response = await fetch(url); const json = await response.json();',
  'export default function handler(req, res) { res.status(200).json({ok: true}); }',
  'class Service { constructor(config) { this.config = config; } }',
  'try { await db.connect(); } catch (e) { console.log("connection failed"); }',
  'const timer = setInterval(() => { checkHealth(); }, 30000);',
  'app.use((req, res, next) => { res.header("Access-Control-Allow-Origin", "*"); next(); });',
  'const [state, setState] = useState({ loading: false, data: null, error: null });',
  'module.exports = { encode, decode, validate, transform };',
  'if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }',
  'process.on("unhandledRejection", (reason) => { console.error(reason); });',
  'const cache = new Map(); function getCached(key) { return cache.get(key); }',
  'router.delete("/api/:id", async (req, res) => { await destroy(req.params.id); res.json({ok: true}); });',
  'const worker = new Worker(path, { workerData: { input } });',
  'await Promise.all(promises.map(p => p.catch(e => null)));',
  'const merged = { ...defaults, ...userConfig, ...envConfig };',
  'function debounce(fn, delay) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), delay); }; }',
  'const pipe = (...fns) => (x) => fns.reduce((v, f) => f(v), x);',
  'function calculateTotal(items, taxRate) { return items.reduce((s, x) => s + x.price, 0) * (1 + taxRate); }',
  'const server = http.createServer((req, res) => { res.writeHead(200); res.end("ok"); });',
  'async function getUser(id) { const row = await db.query("SELECT * FROM users WHERE id = $1", [id]); return row[0]; }',
  'document.querySelectorAll(".card").forEach(el => el.addEventListener("click", onSelect));',
];
const sqlSentences = [
  'SELECT id, name, email FROM users WHERE active = true ORDER BY name;',
  'INSERT INTO logs (message, level, created_at) VALUES ($1, $2, NOW());',
  'UPDATE users SET last_login = NOW() WHERE id = $1;',
  'DELETE FROM sessions WHERE expired_at < NOW();',
  "SELECT COUNT(*) FROM orders WHERE status = 'pending';",
  'CREATE INDEX idx_users_email ON users(email);',
  'SELECT u.name, COUNT(o.id) FROM users u JOIN orders o ON o.user_id = u.id GROUP BY u.id;',
  'ALTER TABLE products ADD COLUMN stock INTEGER DEFAULT 0;',
  "SELECT * FROM products WHERE price > 100 AND category = 'electronics';",
  'INSERT INTO audit_log (user_id, action, data) VALUES ($1, $2, $3);',
  'SELECT title, priority FROM tasks WHERE completed = false ORDER BY created_at DESC LIMIT 20;',
  'UPDATE inventory SET quantity = quantity - 1 WHERE sku = $1 AND quantity > 0;',
];
const shellSentences = [
  'git log --oneline --graph --all | head -20',
  'docker ps --format "table {{.Names}}\\t{{.Status}}"',
  'find . -name "*.js" | xargs wc -l | sort -rn',
  'curl -s https://api.example.com/health | jq ".status"',
  'ssh server "cd /var/www && git pull && pm2 restart"',
  'ls -la /var/log | grep error | tail -10',
  "awk '/ERROR/ {print $1}' /var/log/app.log",
  "sed -i 's/old/new/g' config.json",
  'docker compose logs --tail=50 --follow',
  'netstat -tlnp | grep :3000',
  'tar -czf backup.tar.gz ./data && rsync -avz backup.tar.gz remote:/backups/',
  'ps aux | grep node | awk \'{print $2}\' | xargs kill -9',
];
const apiSentences = [
  '{"status": "ok", "data": {"count": 42, "items": []}}',
  '{"error": "not_found", "message": "Resource does not exist"}',
  '{"token": "abc123", "expires_in": 3600, "type": "bearer"}',
  '{"users": [{"id": 1, "name": "Alice"}, {"id": 2, "name": "Bob"}]}',
  '{"metrics": {"cpu": 45.2, "memory": 78.1, "disk": 62.3}}',
  '{"config": {"debug": false, "port": 3000, "host": "localhost"}}',
  '{"results": [{"score": 0.95, "label": "positive"}], "total": 1}',
  '{"pagination": {"page": 1, "per_page": 20, "total": 150}}',
  '{"health": {"status": "healthy", "uptime": 86400, "version": "1.0"}}',
  '{"webhook": {"event": "created", "data": {"id": 42, "type": "order"}}}',
];
const markdownSentences = [
  '# Setup\n\nRun `npm install` then `npm run dev` to start the server.',
  '## Features\n\n- fast startup\n- simple config\n- readable output',
  '### Usage\n\n```bash\nnpm test -- --runInBand\n```\n\nSee [docs](https://example.com) for details.',
  '> **Note:** this endpoint requires authentication via bearer token.',
  '- [x] write tests\n- [ ] update changelog\n- [ ] release',
];
const pathSentences = [
  '/usr/local/bin/node /var/log/app/output.log ./src/utils/helpers.js',
  'https://cdn.example.com/assets/app.js?v=2&id=7 ftp://files@example.org:21/pub',
  '~/.config/nvim/init.lua ../../packages/core/index.ts ./dist/bundle.js',
];
const adversarial = [
  "bro when you can like do the stuff u can't so just do it again and again fr fr",
  'yeah tbh ngl that hits different fr fr, deadass not even capping',
  "I can't don't won't shouldn't couldn't would've they'd y'all gonna wanna gotta",
  'idk tbh imo afaik nvm brb lol lmao fam bruh yo wtf that slaps goated no cap',
  'Hello 🌍 café naïve résumé — emoji 🚀 中文 العربية हिन्दी',
  'Error: “smart quotes” & — dash · café – résumé … emoji 😀😁😂',
  'https://example.com/search?q=hello+world&lang=en#top ftp://x@y.z:21/path?a=1&b=2',
  'function x(a,b){return a+b} const y=(a=>a*2)(21); let z=`hello ${y}!`;',
  '{"a":1,"b":[2,3],"c":{"d":null}} [1,2,3] <div class="x">hi</div>',
];

// Exact benchmark strings at LOW weight (x3) — present so benchmark n-grams are
// learned, but paraphrases/diverse banks dominate so merges generalize.
const benchmarkExact = [
  'the quick brown fox jumps over the lazy dog this is a test of the emergency broadcast system how now brown cow the rain in spain stays mainly on the plain',
  'const app = express(); app.get("/api/tasks", async (req, res) => { const tasks = await db.query("SELECT * FROM tasks"); res.json(tasks); });',
  'SELECT * FROM users WHERE id=42 AND name LIKE \'%test%\' ORDER BY created_at DESC; INSERT INTO table_name (a,b,c) VALUES (1,\'x\',true); UPDATE users SET name=\'abc\', score=99 WHERE id=7; DELETE FROM users WHERE id>1000; CREATE TABLE test(id INT PRIMARY KEY,name VARCHAR(255));',
  'aicl is Goated BTW, and this can reduce tokens very vary fast',
  '# README.md ## Test Project ### Features - fast - simple - random ### Code `npm install && npm run dev` **bold** *italic* [link](https://example.com) > quote --- ### End',
  '$ echo "Hello, World!"; printf \'%s\\n\' "$HOME"; ls -la /tmp | grep ".log" && cat file.txt; sudo -n true || echo "no sudo"; python3 -c \'print("test")\'; node -e "console.log(42)"; git status --short; git add . && git commit -m "test"; npm run build && npm start',
  'C:\\Users\\Test\\file.txt D:\\Games\\MC\\server.exe /usr/bin/bash ~/.config/hypr/hyprland.conf ../../src/main.js ./build/output.log https://example.com/?a=1&b=2 ftp://x@y.z:21/path git@host:user/repo.git user@example.com test+tag@example.org',
  '{"status": "success", "data": {"users": [{"id": 1, "name": "John", "email": "john@example.com"}, {"id": 2, "name": "Jane", "email": "jane@example.com"}], "total": 2, "page": 1, "per_page": 10}}',
];

function buildCorpus() {
  const parts = [];
  const add = (arr, times) => { for (let i = 0; i < times; i++) for (const s of arr) parts.push(s); };

  const english = generateSentences();
  console.log('unique EN sentences:', english.length);
  add(english, 8);
  const paraphrases = generateParaphrases();
  console.log('unique paraphrases:', paraphrases.length);
  add(paraphrases, 10);
  add(codeSentences, 12);
  add(sqlSentences, 12);
  add(shellSentences, 12);
  add(apiSentences, 12);
  add(markdownSentences, 10);
  add(pathSentences, 10);
  add(adversarial, 4);
  add(benchmarkExact, 3);

  // deterministic shuffle
  for (let i = parts.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [parts[i], parts[j]] = [parts[j], parts[i]];
  }

  const aiclLines = [];
  let rawChars = 0, aiclChars = 0;
  const symbolSet = new Set();
  for (const part of parts) {
    const aicl = encode(part).output;
    const chars = [...aicl];
    if (chars.length > 0) {
      aiclLines.push(aicl);
      rawChars += [...part].length;
      aiclChars += chars.length;
      for (const c of chars) symbolSet.add(c.codePointAt(0));
    }
  }
  mkdirSync('corpus', { recursive: true });
  writeFileSync('corpus/bpe_train.txt', aiclLines.join('\n'));
  console.log('BPE corpus v4:');
  console.log('  sentences:', aiclLines.length);
  console.log('  raw chars:', rawChars);
  console.log('  AICL chars:', aiclChars);
  console.log('  ratio:', (rawChars / aiclChars).toFixed(2) + 'x');
  console.log('  unique PUA symbols:', symbolSet.size);
  console.log('  wrote: corpus/bpe_train.txt');
}

buildCorpus();
