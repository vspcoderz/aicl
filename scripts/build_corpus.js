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
  '# Taskboard API\n## Setup\n- [x] install\n- [ ] test\n```javascript\nconst api = require("taskboard");\n```\n',
  'aicl is Goated BTW, and this can reduce tokens very vary fast ',
  'machine learning deep learning transformer attention embedding vector database retrieval augmented generation ',
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
