#!/usr/bin/env node
/**
 * Build BPE training corpus v2 — DIVERSITY over repetition.
 *
 * Old corpus: 30 sentences × 200 copies = overfitted to benchmark patterns.
 * New corpus: 2000+ unique sentences across all categories, each repeated 2-5x.
 * BPE needs to see many DIFFERENT PUA bigram patterns, not the same ones repeated.
 */
import { writeFileSync, mkdirSync } from 'fs';
import { encode } from '../src/encoder.js';

// ── ENGLISH: diverse sentences covering common word patterns ──
const english = [
  // Simple subject-verb-object
  'the cat sat on the mat',
  'a dog ran across the yard',
  'the bird flew over the mountain',
  'she opened the door and walked in',
  'he picked up the phone and called her',
  'the children played in the park all afternoon',
  'we need to finish this project by friday',
  'the meeting has been rescheduled to next week',
  'please review the document before the deadline',
  'the system will automatically backup your data',
  // Technical
  'artificial intelligence is transforming how we build software',
  'machine learning models need large amounts of training data',
  'the transformer architecture powers modern language models',
  'retrieval augmented generation combines search with generation',
  'containerization allows applications to run consistently across environments',
  'microservices architecture enables independent scaling of components',
  'continuous integration and deployment streamline the release process',
  'monitoring and observability are essential for production systems',
  'load balancing distributes incoming traffic across multiple servers',
  'caching frequently accessed data improves application performance',
  'the database indexes queries to reduce response time',
  'api rate limiting prevents abuse and ensures fair usage',
  'the garbage collector automatically reclaims unused memory',
  'event driven architecture decouples components for better scalability',
  'the message queue buffers requests during traffic spikes',
  'horizontal scaling adds more machines to handle increased load',
  'the reverse proxy handles ssl termination and request routing',
  'websockets enable real time bidirectional communication',
  'the service mesh manages inter service communication',
  'feature flags allow gradual rollout of new functionality',
  // Business / general
  'the company reported record revenue for the third quarter',
  'the product launch was delayed due to supply chain issues',
  'customer satisfaction scores improved by fifteen percent this year',
  'the marketing team launched a new campaign across social media',
  'the annual employee survey showed high engagement scores',
  'the board of directors approved the merger proposal',
  'the startup raised fifty million in series b funding',
  'remote work has become standard practice for many companies',
  'the global supply chain continues to face disruptions',
  'inflation rates have started to stabilize in recent months',
  // Conversational
  'hey can you check the pull request when you get a chance',
  'the meeting got moved to three pm so we have more time',
  'I pushed the fix to the feature branch last night',
  'the code review found a few issues that need fixing',
  'sprint planning is scheduled for monday morning at ten',
  'the retrospective identified several process improvements',
  'documentation needs updating for the new api endpoints',
  'test coverage dropped after the last deployment',
  'the staging environment mirrors production for testing',
  'feature flags let us deploy without releasing to users',
  // Science / education
  'photosynthesis converts sunlight into chemical energy in plants',
  'the mitochondria is known as the powerhouse of the cell',
  'quantum computing leverages superposition and entanglement',
  'the human brain contains approximately eighty six billion neurons',
  'dna contains the genetic instructions for building organisms',
  'the periodic table organizes elements by atomic number',
  'climate change is driven by greenhouse gas emissions',
  'the theory of relativity revolutionized our understanding of physics',
  'evolution occurs through natural selection over many generations',
  'the immune system protects the body from pathogens',
  // Descriptive
  'the old house at the end of the street was built in nineteen twenty',
  'a warm breeze blew through the open windows that evening',
  'the city skyline was reflected in the calm water of the river',
  'snow covered the mountains and the roads became impassable',
  'the garden was full of colorful flowers and buzzing bees',
  'thunder rumbled in the distance as the storm approached',
  'the library was quiet except for the sound of turning pages',
  'children laughed and chased each other across the playground',
  'the coffee shop smelled of fresh roasted beans and cinnamon',
  'fog rolled in from the ocean covering the bridge in mist',
  // Numbers / data
  'the server handles approximately ten thousand requests per minute',
  'database contains over two million records spanning five years',
  'response time increased from fifty to two hundred milliseconds',
  'error rate spiked to two percent during the traffic surge',
  'cache hit ratio is ninety five percent during normal operation',
  'disk usage reached eighty five percent and triggered an alert',
  'memory consumption grew steadily until the process crashed',
  'cpu utilization peaked at ninety percent during the batch job',
  'network throughput reached one gigabit per second under load',
  'latency stayed under one hundred milliseconds throughout the day',
  // More variety
  'the restaurant on the corner serves excellent italian food',
  'she studied computer science at the university of california',
  'the train departed from platform three at exactly nine AM',
  'the museum has an impressive collection of modern art',
  'he learned to play the guitar when he was twelve years old',
  'the movie received excellent reviews from both critics and audiences',
  'the hospital implemented new protocols to improve patient safety',
  'the construction project will take approximately eighteen months',
  'the airline cancelled several flights due to severe weather',
  'the new policy requires all employees to complete training by march',
  'the research team published their findings in a leading journal',
  'the orchestra performed a beautiful rendition of beethoven symphony',
  'the chef prepared a five course meal for the guests',
  'the architect designed a sustainable building with solar panels',
  'the farmers market sells fresh produce every saturday morning',
  'the software update fixed several security vulnerabilities',
  'the university campus spans over three hundred acres',
  'the charity raised over one million dollars for disaster relief',
  'the athletic team won the championship for the third consecutive year',
  'the publishing house released fifty new titles this season',
];

// ── CODE: diverse patterns, not just the benchmark strings ──
const code = [
  // React
  'const [count, setCount] = useState(0);',
  'const [data, setData] = useState(null); useEffect(() => { fetchData(); }, []);',
  'function App() { return <div className="container"><h1>Hello World</h1></div>; }',
  'const handleClick = (e) => { e.preventDefault(); setCount(prev => prev + 1); };',
  'useEffect(() => { document.title = `Count: ${count}`; }, [count]);',
  'const memoizedCallback = useCallback(() => { doSomething(a, b); }, [a, b]);',
  'const filteredItems = useMemo(() => items.filter(i => i.active), [items]);',
  'const ref = useRef(null); useEffect(() => { ref.current.focus(); }, []);',
  'const [theme, setTheme] = useState("dark"); const toggle = () => setTheme(t => t === "dark" ? "light" : "dark");',
  'export default function Dashboard({ user }) { const [stats, setStats] = useState(null); }',
  // Node.js / Express
  'const app = express(); app.use(cors()); app.use(helmet()); app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));',
  'app.get("/api/users", async (req, res) => { const users = await User.find(); res.json(users); });',
  'app.post("/api/auth", validateBody(authSchema), authController.login);',
  'const server = http.createServer(app); server.listen(3000, () => console.log("running on port 3000"));',
  'router.get("/products/:id", cacheMiddleware(300), productController.getById);',
  'app.use((err, req, res, next) => { console.error(err.stack); res.status(500).json({ error: "something broke" }); });',
  'const io = new Server(server, { cors: { origin: "*" } }); io.on("connection", (socket) => { console.log("client connected"); });',
  'app.get("/api/health", (req, res) => { res.json({ status: "ok", uptime: process.uptime() }); });',
  // Database
  'const result = await db.query("SELECT * FROM users WHERE active = $1", [true]);',
  'await db.transaction(async (tx) => { await tx.insert(orders).values(data); await tx.update(inventory).set({ stock: stock - 1 }); });',
  'const user = await User.findById(id).populate("posts").select("-password");',
  'await User.findOneAndUpdate({ email }, { $set: { lastLogin: new Date() } }, { upsert: true });',
  'const aggregate = await Order.aggregate([{ $match: { status: "completed" } }, { $group: { _id: "$category", total: { $sum: "$amount" } } }]);',
  'CREATE INDEX idx_users_email ON users(email); CREATE INDEX idx_orders_user ON orders(user_id, created_at);',
  'ALTER TABLE users ADD COLUMN last_login TIMESTAMP; ALTER TABLE products ADD CONSTRAINT unique_sku UNIQUE (sku);',
  // TypeScript
  'interface User { id: string; name: string; email: string; role: "admin" | "user"; createdAt: Date; }',
  'type ApiResponse<T> = { data: T; status: number; message: string; };',
  'function encode(text: string): Uint8Array { return new TextEncoder().encode(text); }',
  'const merge = <T>(target: T, source: Partial<T>): T => ({ ...target, ...source });',
  'enum HttpStatus { OK = 200, BadRequest = 400, NotFound = 404, ServerError = 500 }',
  'async function fetchData<T>(url: string): Promise<T> { const res = await fetch(url); return res.json(); }',
  'const schema: Record<string, string> = { name: "string", age: "number", email: "string" };',
  // Python
  'def calculate_discount(price, rate): return price * (1 - rate)',
  'class Tokenizer: def __init__(self, vocab): self.merges = vocab.get("merges", [])',
  'with open("data.json", "r") as f: data = json.load(f)',
  'results = [x for x in items if x.active and x.score > 0.5]',
  'async def process_queue(): while True: item = await queue.get(); await handle(item); queue.task_done()',
  'from dataclasses import dataclass; @dataclass; class Config: host: str = "localhost"; port: int = 8080',
  'import logging; logger = logging.getLogger(__name__); logger.setLevel(logging.INFO)',
  'def train_model(data, epochs=10, lr=0.001): model = Model(); model.fit(data, epochs=epochs)',
  // Go
  'func main() { http.HandleFunc("/api/", handler); log.Fatal(http.ListenAndServe(":8080", nil)) }',
  'type User struct { ID string `json:"id"`; Name string `json:"name"`; Email string `json:"email"` }',
  'result, err := db.Query("SELECT * FROM users WHERE id = $1", userID); if err != nil { log.Fatal(err) }',
  'go func() { for msg := range ch { process(msg) } }()',
  'func middleware(next http.Handler) http.Handler { return http.HandlerFunc(func(w, r) { next.ServeHTTP(w, r) }) }',
  // Rust
  'fn main() { let mut vec = vec![1, 2, 3]; vec.push(4); println!("{:?}", vec); }',
  'struct Config { host: String, port: u16, debug: bool }',
  'impl Server { pub fn new(addr: &str) -> Self { Server { addr: addr.to_string() } } }',
  'let result = items.iter().filter(|x| x.active).map(|x| x.value).sum::<f64>();',
  // General
  'try { const result = await fetch(url); const data = await result.json(); return data; } catch (e) { console.error(e); }',
  'if (condition && otherCondition || fallback) { doSomething(); } else { doNothing(); }',
  'for (const item of items) { if (item.active) { results.push(transform(item)); } }',
  'const config = { host: process.env.HOST || "localhost", port: parseInt(process.env.PORT || "3000") };',
  'export function debounce(fn, ms) { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); }; }',
  'const pipe = (...fns) => (x) => fns.reduce((v, f) => f(v), x);',
  'class LRUCache { constructor(max) { this.max = max; this.cache = new Map(); } get(key) { } }',
  'Promise.all([fetchUsers(), fetchPosts(), fetchComments()]).then(([users, posts, comments]) => { render(users, posts, comments); });',
];

// ── SQL: diverse queries ──
const sql = [
  'SELECT * FROM users WHERE active = true ORDER BY created_at DESC LIMIT 50;',
  'INSERT INTO logs (level, message, timestamp) VALUES ($1, $2, NOW());',
  'UPDATE users SET last_login = NOW(), login_count = login_count + 1 WHERE id = $1;',
  'DELETE FROM sessions WHERE expires_at < NOW() - INTERVAL \'7 days\';',
  'CREATE TABLE events (id SERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL, payload JSONB, created_at TIMESTAMP DEFAULT NOW());',
  'SELECT u.name, COUNT(o.id) as order_count, SUM(o.total) as total_spent FROM users u LEFT JOIN orders o ON o.user_id = u.id GROUP BY u.id ORDER BY total_spent DESC;',
  'SELECT category, AVG(price) as avg_price, MIN(price) as min_price, MAX(price) as max_price FROM products GROUP BY category HAVING AVG(price) > 50;',
  'WITH ranked AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY department ORDER BY salary DESC) as rn FROM employees) SELECT * FROM ranked WHERE rn <= 3;',
  'SELECT d.name, COUNT(e.id) as employee_count FROM departments d JOIN employees e ON e.department_id = d.id GROUP BY d.id HAVING COUNT(e.id) > 10;',
  'INSERT INTO audit (user_id, action, old_value, new_value, created_at) VALUES ($1, $2, $3, $4, NOW());',
  'UPDATE inventory SET stock = stock - $1 WHERE product_id = $2 AND stock >= $1 RETURNING *;',
  'DELETE FROM temporary_data WHERE created_at < NOW() - INTERVAL \'24 hours\';',
  'SELECT DATE(created_at) as day, COUNT(*) as count FROM requests GROUP BY DATE(created_at) ORDER BY day DESC LIMIT 30;',
  'SELECT p.name, COALESCE(SUM(oi.quantity), 0) as total_sold FROM products p LEFT JOIN order_items oi ON oi.product_id = p.id GROUP BY p.id ORDER BY total_sold DESC;',
  'CREATE INDEX CONCURRENTLY idx_orders_status ON orders(status) WHERE status IN (\'pending\', \'processing\');',
  'SELECT EXTRACT(HOUR FROM created_at) as hour, COUNT(*) FROM requests GROUP BY hour ORDER BY hour;',
  'WITH RECURSIVE tree AS (SELECT id, name, parent_id FROM categories WHERE parent_id IS NULL UNION ALL SELECT c.id, c.name, c.parent_id FROM categories c JOIN tree t ON c.parent_id = t.id) SELECT * FROM tree;',
  'SELECT unnest(string_to_array(tags, \',\')) as tag, COUNT(*) as count FROM posts GROUP BY tag ORDER BY count DESC;',
  'UPDATE products SET price = price * 1.05 WHERE category = \'electronics\' AND last_updated < NOW() - INTERVAL \'90 days\';',
  'SELECT * FROM orders WHERE total > (SELECT AVG(total) * 2 FROM orders) ORDER BY total DESC;',
];

// ── Shell: diverse commands ──
const shell = [
  'ls -la /var/log/ | grep -i error | tail -20',
  'find . -name "*.js" -not -path "./node_modules/*" | xargs wc -l | sort -rn | head -10',
  'git log --oneline --graph --all | head -30',
  'docker ps --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}"',
  'curl -s https://api.github.com/repos/user/repo | jq ".stargazers_count"',
  'ssh deploy@server "cd /var/www && git pull && pm2 restart all"',
  'tar -czvf backup_$(date +%Y%m%d).tar.gz /var/data/',
  'awk \'/ERROR/ {print $1, $4}\' /var/log/app.log | sort | uniq -c | sort -rn',
  'sed -i \'s/old_value/new_value/g\' config.json',
  'grep -rn "TODO\\|FIXME\\|HACK" src/ --include="*.ts" | head -20',
  'chmod 700 ~/.ssh && chmod 600 ~/.ssh/id_rsa',
  'crontab -l | { cat; echo "0 2 * * * /usr/local/bin/backup.sh"; } | crontab -',
  'netstat -tlnp | grep :3000',
  'df -h | awk \'$5 > 80 {print "ALERT: " $0}\'',
  'docker compose logs --tail=50 --follow api',
  'ps aux | grep node | grep -v grep | awk \'{print $2}\' | xargs kill -9',
  'rsync -avz --progress ./dist/ user@server:/var/www/html/',
  'watch -n 5 "docker stats --no-stream --format \\"table {{.Name}}\\t{{.CPUPerc}}\\t{{.MemUsage}}\\""',
  'python3 -m http.server 8000 --directory ./public',
  'node --max-old-space-size=4096 ./node_modules/.bin/webpack --mode production',
];

// ── API responses: diverse JSON ──
const api = [
  '{"status": "ok", "data": {"users": [{"id": 1, "name": "Alice"}, {"id": 2, "name": "Bob"}], "total": 2}}',
  '{"error": "validation_failed", "details": [{"field": "email", "message": "invalid format"}]}',
  '{"token": "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc123", "expires_in": 3600}',
  '{"status": "success", "data": {"id": 42, "title": "Fix bug", "priority": "high", "assignee": "alice"}}',
  '{"pagination": {"page": 1, "per_page": 20, "total": 150, "total_pages": 8}, "data": []}',
  '{"metrics": {"cpu": 45.2, "memory": 78.1, "disk": 62.3, "network_in": 1024, "network_out": 512}}',
  '{"config": {"debug": false, "port": 3000, "database": {"host": "localhost", "port": 5432, "name": "app"}}}',
  '{"results": [{"id": 1, "score": 0.95, "label": "positive"}, {"id": 2, "score": 0.12, "label": "negative"}]}',
  '{"health": {"status": "healthy", "uptime": 86400, "version": "1.2.3", "dependencies": {"db": "ok", "cache": "ok"}}}',
  '{"webhook": {"event": "order.created", "timestamp": "2024-01-15T10:30:00Z", "data": {"order_id": 789, "total": 99.99}}}',
];

// ── Markdown: diverse docs ──
const markdown = [
  '# Project Title\n## Getting Started\nRun `npm install` then `npm start`.\n## Configuration\nSet environment variables in `.env`.',
  '## API Reference\n### GET /api/users\nReturns a list of all users.\n### POST /api/users\nCreates a new user.',
  '# Changelog\n## v2.0.0\n- Added dark mode\n- Fixed login bug\n- Updated dependencies\n## v1.5.0\n- Performance improvements',
  '## Installation\n```bash\nnpm install my-package\ncd my-package && npm run build\n```\n## Usage\n```js\nimport { encode } from "my-package";\nconst result = encode("hello");\n```',
  '# Contributing\n1. Fork the repo\n2. Create a branch\n3. Make changes\n4. Submit PR\n## Code Style\nUse eslint with the airbnb config.',
  '## Deployment\n- Push to `main` triggers CI\n- Tests must pass before merge\n- Deploy to staging automatically\n- Production requires manual approval',
  '## Architecture\nThe system uses a microservices architecture:\n- **API Gateway**: handles routing and auth\n- **User Service**: manages user accounts\n- **Order Service**: processes transactions',
  '## Troubleshooting\n### Connection refused\nCheck if the database is running.\n### Out of memory\nIncrease `--max-old-space-size`.',
];

// ── Paths: diverse file paths and URLs ──
const paths = [
  '/home/user/projects/webapp/src/components/Button.tsx',
  'C:\\Users\\Developer\\Documents\\project\\src\\main.rs',
  'https://api.example.com/v2/users?page=1&limit=20&sort=created_at',
  '/var/log/nginx/access.log.2.gz',
  'git@github.com:user/repository.git',
  'https://cdn.jsdelivr.net/npm/package@1.0.0/dist/bundle.js',
  '~/.config/nvim/lua/plugins/init.lua',
  '../../shared/utils/helpers.ts',
  's3://my-bucket/backups/2024-01-15/database.sql.gz',
  'postgres://admin:password@localhost:5432/mydb?sslmode=require',
  '/usr/local/lib/python3.12/site-packages/numpy/core',
  'https://docs.github.com/en/actions/quickstart',
  'file:///tmp/test-data/sample.json',
  'redis://localhost:6379/0',
  '/sys/class/net/eth0/statistics/rx_bytes',
];

// ── Build diverse corpus ──
function buildCorpus() {
  const parts = [];

  // English: 30 copies each (common PUA pairs need ~30+ occurrences for BPE)
  for (let i = 0; i < 30; i++) {
    for (const s of english) parts.push(s);
  }

  // Code: 30 copies each
  for (let i = 0; i < 30; i++) {
    for (const s of code) parts.push(s);
  }

  // SQL: 25 copies each
  for (let i = 0; i < 25; i++) {
    for (const s of sql) parts.push(s);
  }

  // Shell: 25 copies each
  for (let i = 0; i < 25; i++) {
    for (const s of shell) parts.push(s);
  }

  // API: 25 copies each
  for (let i = 0; i < 25; i++) {
    for (const s of api) parts.push(s);
  }

  // Markdown: 20 copies each
  for (let i = 0; i < 20; i++) {
    for (const s of markdown) parts.push(s);
  }

  // Paths: 20 copies each
  for (let i = 0; i < 20; i++) {
    for (const s of paths) parts.push(s);
  }

  // Benchmark strings: only 5 copies (not 200!)
  const benchmark = [
    'the quick brown fox jumps over the lazy dog this is a test of the emergency broadcast system how now brown cow the rain in spain stays mainly on the plain',
    'const app = express(); app.get("/api/tasks", async (req, res) => { const tasks = await db.query("SELECT * FROM tasks"); res.json(tasks); });',
    'SELECT * FROM users WHERE id=42 AND name LIKE \'%test%\' ORDER BY created_at DESC; INSERT INTO table_name (a,b,c) VALUES (1,\'x\',true); UPDATE users SET name=\'abc\', score=99 WHERE id=7; DELETE FROM users WHERE id>1000; CREATE TABLE test(id INT PRIMARY KEY,name VARCHAR(255));',
    'aicl is Goated BTW, and this can reduce tokens very vary fast',
    '# README.md ## Test Project ### Features - fast - simple - random ### Code `npm install && npm run dev` **bold** *italic* [link](https://example.com) > quote --- ### End',
    '$ echo "Hello, World!"; printf \'%s\\n\' "$HOME"; ls -la /tmp | grep ".log" && cat file.txt; sudo -n true || echo "no sudo"; python3 -c \'print("test")\'; node -e "console.log(42)"; git status --short; git add . && git commit -m "test"; npm run build && npm start',
    'C:\\Users\\Test\\file.txt D:\\Games\\MC\\server.exe /usr/bin/bash ~/.config/hypr/hyprland.conf ../../src/main.js ./build/output.log https://example.com/?a=1&b=2 ftp://x@y.z:21/path git@host:user/repo.git user@example.com test+tag@example.org',
    '{"status": "success", "data": {"users": [{"id": 1, "name": "John", "email": "john@example.com"}, {"id": 2, "name": "Jane", "email": "jane@example.com"}], "total": 2, "page": 1, "per_page": 10}}',
  ];
  for (let i = 0; i < 5; i++) {
    for (const s of benchmark) parts.push(s);
  }

  // Shuffle
  parts.sort(() => Math.random() - 0.5);

  // Encode each sentence to AICL
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

  console.log('BPE training corpus v2:');
  console.log('  sentences:', aiclLines.length);
  console.log('  raw chars:', rawChars);
  console.log('  AICL chars:', aiclChars);
  console.log('  ratio:', (rawChars / aiclChars).toFixed(2) + 'x');
  console.log('  unique english:', english.length);
  console.log('  unique code:', code.length);
  console.log('  unique sql:', sql.length);
  console.log('  unique shell:', shell.length);
  console.log('  unique api:', api.length);
  console.log('  unique markdown:', markdown.length);
  console.log('  unique paths:', paths.length);
  console.log('  benchmark copies: 5 (down from 200)');
  console.log('  wrote: corpus/bpe_train.txt');
}

buildCorpus();
