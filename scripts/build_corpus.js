#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'fs';
import { encode } from '../src/encoder.js';

const rawSamples = [
  'the quick brown fox jumps over the lazy dog '.repeat(50),
  'artificial intelligence is transforming software development '.repeat(40),
  'const app = express(); app.get("/api/tasks", async (req, res) => { const tasks = await db.query("SELECT * FROM tasks"); res.json(tasks); }); '.repeat(30),
  'SELECT id, title, completed FROM tasks WHERE completed = false ORDER BY created_at DESC LIMIT 20; '.repeat(30),
  '# Taskboard API\n## Setup\n- [x] install\n```javascript\nconst api = require("taskboard");\n```\n'.repeat(20),
];

const raw = rawSamples.join('\n');
const aicl = encode(raw).output;

mkdirSync('corpus', { recursive: true });
writeFileSync('corpus/raw_train.txt', raw);
writeFileSync('corpus/aicl_train.txt', aicl);

console.log(`raw: ${raw.length} chars, aicl: ${[...aicl].length} chars, ratio ${(raw.length/[...aicl].length).toFixed(2)}x`);
console.log(`wrote corpus/raw_train.txt and corpus/aicl_train.txt`);
