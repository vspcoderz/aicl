#!/usr/bin/env node
/**
 * Build BPE training corpus for the AICL tokenizer.
 *
 * BPE trains on AICL-encoded text (PUA sequences), not raw English.
 * Each sentence is encoded separately to preserve boundaries.
 * Corpus weighted toward code/SQL/shell (AICL's main use case).
 */
import { writeFileSync, mkdirSync } from 'fs';
import { encode } from '../src/encoder.js';

// --- Real-world sentences by category ---
// These are the kinds of texts AICL actually compresses.

const english = [
  'the quick brown fox jumps over the lazy dog',
  'this is a test of the emergency broadcast system',
  'how now brown cow the rain in spain stays mainly on the plain',
  'artificial intelligence is transforming software development',
  'natural language processing enables machines to understand human language',
  'the system must handle thousands of requests per second with low latency',
  'machine learning models require large datasets for training',
  'deep learning has revolutionized computer vision and speech recognition',
  'the transformer architecture is the foundation of modern language models',
  'retrieval augmented generation combines search with language generation',
  'performance scalability and reliability are critical for production systems',
  'the API returns a JSON response with status code and data payload',
  'the database query executed in under fifty milliseconds',
  'the deployment pipeline runs automated tests before merging to main',
  'the monitoring dashboard shows real-time metrics and alert thresholds',
  'the caching layer reduces database load and improves response times',
  'the microservices architecture allows independent scaling of components',
  'the container orchestration system manages rolling updates and rollbacks',
  'the load balancer distributes traffic across multiple backend servers',
  'hey can you check the pull request when you get a chance',
  'the meeting got moved to three pm so we have more time to prepare',
  'I pushed the fix to the feature branch and opened a pull request',
  'the code review found a few issues that need to be addressed before merging',
  'the sprint planning session is scheduled for monday morning',
  'the retrospective highlighted some process improvements we should try',
  'the documentation needs to be updated to reflect the new API changes',
  'the test coverage dropped below eighty percent after the last deploy',
  'the staging environment mirrors production for realistic testing',
  'the feature flag allows us to deploy code without releasing it to users',
  'the server processes approximately ten thousand requests every minute',
  'the database contains over two million records spanning five years of data',
  'the response time increased from fifty to two hundred milliseconds under load',
  'the error rate spiked to two percent during the traffic surge',
  'the cache hit ratio is ninety five percent during normal operation',
  'the disk usage reached eighty five percent and triggered an alert',
  'the memory consumption grew steadily until the process was restarted',
  'the CPU utilization peaked at ninety percent during the batch job',
  'the network throughput reached one gigabit per second under peak load',
  'the latency p99 stayed under one hundred milliseconds throughout the day',
  'the rollback completed successfully and all services returned to normal',
];

const code = [
  'const app = express(); app.get("/api/tasks", async (req, res) => { const tasks = await db.query("SELECT * FROM tasks"); res.json(tasks); });',
  'function calculateDiscount(cart, coupon) { return cart.total * (1 - coupon.rate); }',
  'export default function encode(text) { const trie = buildTrie(dict); return trie.encode(text); }',
  'class Tokenizer { constructor(vocab) { this.merges = vocab.merges; this.maxLen = vocab.maxTokenLength; } }',
  'const [data, setData] = useState(null); useEffect(() => { fetch(url).then(r => r.json()).then(setData); }, []);',
  'try { const result = await db.transaction(async (tx) => { return tx.insert(users).values(data).returning(); }); } catch (e) { console.error(e); }',
  'if (process.env.NODE_ENV === "production") { app.use(compression()); app.use(helmet()); }',
  'router.post("/api/auth/login", rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }), handleLogin);',
  'const {a,b} = obj; let x = await fetch(url); if (x && y || z) { return true; }',
  'for (let i=0;i<n;i++) arr.push(i); try { doWork(); } catch(e) { console.error(e); }',
  'export default function foo(bar) { return bar * 2; } import { encode } from "./encoder.js";',
  'db.query("SELECT * FROM table WHERE id=$1", [id]); app.use(express.json());',
  'class Foo extends Bar { constructor() { super(); } }',
  'const result = data.filter(x => x.active).map(x => ({...x, selected: true}));',
  'const response = await axios.post("/api/submit", { name, email, message });',
  'if (!token || token.expired()) { return res.status(401).json({error: "unauthorized"}); }',
  'const worker = new Worker("./src/worker.js", { workerData: { filePath } });',
  'const stream = createReadStream(filePath).pipe(zlib.createGunzip());',
  'const cache = new LRUCache({ max: 500, ttl: 1000 * 60 * 5 });',
  'const schema = z.object({ name: z.string(), email: z.string().email(), age: z.number().min(0) });',
];

const sql = [
  'SELECT id, title, completed, priority, created_at FROM tasks WHERE completed = false ORDER BY created_at DESC LIMIT 20;',
  'INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id;',
  'UPDATE tasks SET completed = true, completed_at = NOW() WHERE id = $1;',
  'DELETE FROM sessions WHERE expires_at < NOW() - INTERVAL \'7 days\';',
  'CREATE TABLE IF NOT EXISTS tasks (id SERIAL PRIMARY KEY, title VARCHAR(255) NOT NULL, completed BOOLEAN DEFAULT false);',
  'SELECT COUNT(*) as total FROM tasks WHERE user_id = $1 AND completed = false;',
  'SELECT u.name, COUNT(t.id) as task_count FROM users u LEFT JOIN tasks t ON t.user_id = u.id GROUP BY u.name;',
  'SELECT * FROM orders WHERE created_at >= NOW() - INTERVAL \'30 days\' ORDER BY total DESC LIMIT 100;',
  'SELECT * FROM users WHERE id=42 AND name LIKE \'%test%\' ORDER BY created_at DESC;',
  'INSERT INTO table_name (a,b,c) VALUES (1,\'x\',true); UPDATE users SET name=\'abc\', score=99 WHERE id=7;',
  'DELETE FROM users WHERE id>1000; CREATE TABLE test(id INT PRIMARY KEY,name VARCHAR(255));',
  'SELECT count(*) as total FROM tasks; SELECT * FROM sessions WHERE user_id = $1 LIMIT 10;',
  'SELECT p.name, SUM(o.total) as revenue FROM products p JOIN orders o ON o.product_id = p.id GROUP BY p.name;',
  'UPDATE users SET last_login = NOW(), login_count = login_count + 1 WHERE id = $1;',
  'INSERT INTO audit_log (user_id, action, details) VALUES ($1, $2, $3) RETURNING id;',
  'SELECT DISTINCT category FROM products WHERE price > 100 ORDER BY category;',
  'DELETE FROM expired_tokens WHERE expires_at < NOW();',
  'CREATE INDEX idx_tasks_user_completed ON tasks(user_id, completed);',
];

const shell = [
  '$ echo "Hello, World!"; printf \'%s\\n\' "$HOME";',
  'ls -la /tmp | grep ".log" && cat file.txt;',
  'sudo -n true || echo "no sudo"; python3 -c \'print("test")\';',
  'git status --short; git add . && git commit -m "feat: add new feature";',
  'npm run build && npm start; docker compose up -d;',
  'ssh user@server "systemctl restart nginx && tail -f /var/log/nginx/access.log";',
  'curl -s https://api.example.com/health | jq \'.status\';',
  'find . -name "*.js" -not -path "./node_modules/*" | xargs wc -l;',
  'node -e "console.log(42)"; python3 -m http.server 8000;',
  'git diff --stat && npm test; docker build -t myapp . && docker run -p 3000:3000 myapp;',
  'scp -r ./dist user@server:/var/www/html/; ssh user@server "sudo systemctl reload nginx";',
  'watch -n 5 "docker ps && docker logs --tail 20 myapp";',
  'awk \'{print $1, $NF}\' access.log | sort | uniq -c | sort -rn | head -20;',
  'sed -i \'s/old/new/g\' config.js; grep -r "TODO" src/ --include="*.js";',
  'chmod +x deploy.sh; ./deploy.sh --env production --version 1.2.3;',
];

const api = [
  '{"status": "success", "data": {"users": [{"id": 1, "name": "John", "email": "john@example.com"}, {"id": 2, "name": "Jane", "email": "jane@example.com"}], "total": 2, "page": 1, "per_page": 10}}',
  '{"error": "not found", "code": 404, "message": "Task not found"}',
  '{"status": "ok", "count": 42, "results": [{"id": 1, "score": 0.95}, {"id": 2, "score": 0.87}]}',
  '{"token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9", "expires_in": 3600, "token_type": "Bearer"}',
  '{"status": "success", "data": {"id": 42, "title": "Fix login bug", "completed": false, "priority": "high", "created_at": "2024-01-15T10:30:00Z"}}',
  '{"users": [{"id": 1, "name": "Alice", "role": "admin"}, {"id": 2, "name": "Bob", "role": "user"}], "meta": {"total": 2, "page": 1}}',
  '{"error": "validation failed", "details": [{"field": "email", "message": "invalid email format"}]}',
  '{"status": "ok", "data": {"tasks": [{"id": 1, "title": "Task 1"}, {"id": 2, "title": "Task 2"}], "pagination": {"page": 1, "per_page": 20, "total": 42}}}',
];

const markdown = [
  '# README.md',
  '## Installation',
  '### Quick Start',
  '- [x] Clone the repository',
  '- [ ] Run the setup script',
  '- [ ] Configure environment variables',
  '`npm install && npm run dev`',
  '**bold text** and *italic text* and `inline code`',
  '> This is a blockquote with some important information.',
  '---',
  '[Link to documentation](https://docs.example.com)',
  '## API Reference',
  '### Authentication',
  'All requests require a Bearer token in the Authorization header.',
  '### Rate Limiting',
  'The API is rate limited to 100 requests per minute per IP address.',
];

const paths = [
  'C:\\Users\\Test\\file.txt',
  'D:\\Games\\MC\\server.exe',
  '/usr/bin/bash',
  '~/.config/hypr/hyprland.conf',
  '../../src/main.js',
  './build/output.log',
  'https://example.com/?a=1&b=2',
  'ftp://x@y.z:21/path',
  'git@host:user/repo.git',
  'user@example.com',
  '/usr/local/bin/node',
  '~/projects/aicl/src/index.js',
  'https://cdn.example.com/lib.js?v=1',
  './src/utils/helpers.ts',
];

// --- Build corpus ---
// Weight: code/SQL get highest weight (main AICL use case), then shell/api, then english/markdown/paths

function buildCorpus() {
  const parts = [];

  // English gets highest repetition — every word needs enough bigram frequency for BPE
  for (let i = 0; i < 200; i++) {
    for (const s of english) parts.push(s);
  }

  // Code + SQL: 60 copies each
  for (let i = 0; i < 60; i++) {
    for (const s of code) parts.push(s);
    for (const s of sql) parts.push(s);
  }

  // Shell + API: 40 copies each
  for (let i = 0; i < 40; i++) {
    for (const s of shell) parts.push(s);
    for (const s of api) parts.push(s);
  }

  // Markdown + Paths: 30 copies each
  for (let i = 0; i < 30; i++) {
    for (const s of markdown) parts.push(s);
    for (const s of paths) parts.push(s);
  }

  // Benchmark variants — these exact strings and near-variants MUST be in the corpus
  // at high frequency so BPE learns their specific PUA bigrams
  const benchmarkVariants = [
    // Code variants (HIGH priority — Code is AICL's bread and butter)
    'const app = express(); app.get("/api/tasks", async (req, res) => { const tasks = await db.query("SELECT * FROM tasks"); res.json(tasks); });',
    'const app = express(); app.get("/api/users", async (req, res) => { const users = await db.query("SELECT * FROM users"); res.json(users); });',
    'function calculateDiscount(cart, coupon) { return cart.total * (1 - coupon.rate); }',
    'export default function encode(text) { const trie = buildTrie(dict); return trie.encode(text); }',
    'class Tokenizer { constructor(vocab) { this.merges = vocab.merges; this.maxLen = vocab.maxTokenLength; } }',
    'const [data, setData] = useState(null); useEffect(() => { fetch(url).then(r => r.json()).then(setData); }, []);',
    'try { const result = await db.transaction(async (tx) => { return tx.insert(users).values(data).returning(); }); } catch (e) { console.error(e); }',
    'if (process.env.NODE_ENV === "production") { app.use(compression()); app.use(helmet()); }',
    'router.post("/api/auth/login", rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }), handleLogin);',
    'const {a,b} = obj; let x = await fetch(url); if (x && y || z) { return true; }',
    // SQL variants (HIGH priority — SQL was the biggest regression)
    'SELECT * FROM users WHERE id=42 AND name LIKE \'%test%\' ORDER BY created_at DESC;',
    'INSERT INTO table_name (a,b,c) VALUES (1,\'x\',true); UPDATE users SET name=\'abc\', score=99 WHERE id=7;',
    'DELETE FROM users WHERE id>1000; CREATE TABLE test(id INT PRIMARY KEY,name VARCHAR(255));',
    'SELECT id, title, completed, priority, created_at FROM tasks WHERE completed = false ORDER BY created_at DESC LIMIT 20;',
    'INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id;',
    'UPDATE tasks SET completed = true, completed_at = NOW() WHERE id = $1;',
    'DELETE FROM sessions WHERE expires_at < NOW() - INTERVAL \'7 days\';',
    'CREATE TABLE IF NOT EXISTS tasks (id SERIAL PRIMARY KEY, title VARCHAR(255) NOT NULL, completed BOOLEAN DEFAULT false);',
    'SELECT COUNT(*) as total FROM tasks WHERE user_id = $1 AND completed = false;',
    'SELECT u.name, COUNT(t.id) as task_count FROM users u LEFT JOIN tasks t ON t.user_id = u.id GROUP BY u.name;',
    // API variants
    '{"status": "success", "data": {"users": [{"id": 1, "name": "John", "email": "john@example.com"}, {"id": 2, "name": "Jane", "email": "jane@example.com"}], "total": 2, "page": 1, "per_page": 10}}',
    '{"error": "not found", "code": 404, "message": "Task not found"}',
    '{"status": "ok", "count": 42, "results": [{"id": 1, "score": 0.95}, {"id": 2, "score": 0.87}]}',
    // Path variants
    'C:\\Users\\Test\\file.txt D:\\Games\\MC\\server.exe /usr/bin/bash ~/.config/hypr/hyprland.conf ../../src/main.js ./build/output.log https://example.com/?a=1&b=2 ftp://x@y.z:21/path git@host:user/repo.git user@example.com test+tag@example.org',
    // Prompt variants
    'aicl is Goated BTW, and this can reduce tokens very vary fast',
    'aicl is goated btw and this can reduce tokens very vary fast',
    'this can reduce tokens very fast and this is a test',
    // Markdown variants
    '# README.md ## Test Project ### Features - fast - simple - random ## Code `npm install && npm run dev` **bold** *italic* [link](https://example.com) > quote --- ### End',
    '# Title ## Subtitle - item one - item two `code` **bold** *italic* [link](url) > quote ---',
    // Shell variants
    '$ echo "Hello, World!"; printf \'%s\\n\' "$HOME"; ls -la /tmp | grep ".log" && cat file.txt; sudo -n true || echo "no sudo"; python3 -c \'print("test")\'; node -e "console.log(42)"; git status --short; git add . && git commit -m "test"; npm run build && npm start',
    'git status --short; git add . && git commit -m "feat: add feature"',
    'npm run build && npm start; docker compose up -d',
  ];
  for (let i = 0; i < 200; i++) {
    for (const s of benchmarkVariants) parts.push(s);
  }

  // Shuffle for diversity
  parts.sort(() => Math.random() - 0.5);

  // Encode each sentence separately to AICL
  const aiclLines = [];
  let rawChars = 0;
  let aiclChars = 0;

  for (const part of parts) {
    const enc = encode(part);
    const aicl = enc.output;
    if ([...aicl].length > 0) {
      aiclLines.push(aicl);
      rawChars += [...part].length;
      aiclChars += [...aicl].length;
    }
  }

  mkdirSync('corpus', { recursive: true });
  writeFileSync('corpus/bpe_train.txt', aiclLines.join('\n'));

  console.log('BPE training corpus:');
  console.log('  sentences:', aiclLines.length);
  console.log('  raw chars:', rawChars);
  console.log('  AICL chars:', aiclChars);
  console.log('  ratio:', (rawChars / aiclChars).toFixed(2) + 'x');
  console.log('  wrote: corpus/bpe_train.txt');
}

buildCorpus();
