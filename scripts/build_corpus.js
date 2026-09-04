#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'fs';
import { encode } from '../src/encoder.js';

const base = [
  'the quick brown fox jumps over the lazy dog this is a test of the emergency broadcast system ',
  'artificial intelligence is transforming software development and natural language processing ',
  'in terms of performance scalability and reliability the system must handle thousands of requests ',
  'const app = express(); app.get("/api/tasks", async (req, res) => { const tasks = await db.query("SELECT * FROM tasks"); res.json(tasks); }); ',
  'function calculateDiscount(cart, coupon) { return cart.total * (1 - coupon.rate); } ',
  'SELECT id, title, completed, priority, created_at FROM tasks WHERE completed = false ORDER BY created_at DESC LIMIT 20; ',
  'INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id; UPDATE tasks SET completed = true WHERE id = $1; ',
  'SELECT * FROM users WHERE id = 42 AND name LIKE \'%test%\' ORDER BY created_at DESC; DELETE FROM users WHERE id>1000; CREATE TABLE test(id INT PRIMARY KEY); ',
  '{"status": "success", "data": {"users": [{"id": 1, "name": "John", "email": "john@example.com"}, {"id": 2, "name": "Jane", "email": "jane@example.com"}], "total": 2, "page": 1, "per_page": 10}} ',
  '{"error": "not found", "code": 404, "message": "Task not found"} {"status": "ok", "count": 42} ',
  'SELECT count(*) as total FROM tasks; SELECT * FROM sessions WHERE user_id = $1 LIMIT 10; ',
  '# Taskboard API\n## Setup\n- [x] install\n- [ ] test\n```javascript\nconst api = require("taskboard");\n```\n',
  'aicl is Goated BTW, and this can reduce tokens very vary fast ',
  'machine learning deep learning transformer attention embedding vector database retrieval augmented generation ',
  // Failing tests - add to ensure tokenizer learns their PUA pairs
  '$ echo "Hello, World!"; printf \'%s\\n\' "$HOME"; ls -la /tmp | grep ".log" && cat file.txt; sudo -n true || echo "no sudo"; python3 -c \'print("test")\'; node -e "console.log(42)"; git status --short; ',
  '# README.md ## Test Project ### Features - fast - simple - random ### Code `npm install && npm run dev` **bold** *italic* [link](https://example.com) > quote --- ### End ',
  'C:\\Users\\Test\\file.txt D:\\Games\\MC\\server.exe /usr/bin/bash ~/.config/hypr/hyprland.conf ../../src/main.js ./build/output.log https://example.com/?a=1&b=2 ftp://x@y.z:21/path git@host:user/repo.git user@example.com ',
];

let parts = [];
for(let i=0;i<800;i++) for(const s of base) parts.push(s);
parts = parts.sort(()=>Math.random()-0.5);
const raw = parts.join('\n');

const aicl = encode(raw).output;
mkdirSync('corpus', { recursive: true });
writeFileSync('corpus/raw_train.txt', raw);
writeFileSync('corpus/aicl_train.txt', aicl);
console.log(`raw: ${raw.length} chars, aicl: ${[...aicl].length} chars, ratio ${(raw.length/[...aicl].length).toFixed(2)}x`);
