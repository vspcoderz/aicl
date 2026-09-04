#!/usr/bin/env node
import { writeFileSync, mkdirSync, readFileSync } from 'fs';
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
  '$ echo "Hello, World!"; printf \'%s\\n\' "$HOME"; ls -la /tmp | grep ".log" && cat file.txt; sudo -n true || echo "no sudo"; python3 -c \'print("test")\'; node -e "console.log(42)"; git status --short; ',
  '# README.md ## Test Project ### Features - fast - simple - random ### Code `npm install && npm run dev` **bold** *italic* [link](https://example.com) > quote --- ### End ',
  'C:\\Users\\Test\\file.txt D:\\Games\\MC\\server.exe /usr/bin/bash ~/.config/hypr/hyprland.conf ../../src/main.js ./build/output.log https://example.com/?a=1&b=2 ftp://x@y.z:21/path git@host:user/repo.git user@example.com ',
  'bro when you can like do the shit to cover the stuff u can\'t so a shit to do it ',
  'yeah tbh ngl that hits different fr fr, deadass not even capping ',
  'I can\'t don\'t won\'t shouldn\'t couldn\'t would\'ve they\'d y\'all gonna wanna gotta ',
  'do it do it do it bro do it again and again bro fr fr yeah yeah ',
  'idk tbh imo afaik nvm brb lol lmao fam bruh yo wtf that slaps goated no cap ',
  'bro this is so mid but lowkey that shit is fire, no cap fr ',
  'on god that hits different, deadass not even capping rn ',
  'Hello cafe naive resume emoji rocket chinese arabic hindi ',
  'Error smart quotes dash cafe resume emoji ',
  'https://example.com/search?q=hello+world&lang=en#top ftp://x@y.z:21/path?a=1&b=2 ',
  'C:\\Users\\Test\\file.txt /usr/bin/bash ~/.config/hypr/hyprland.conf https://a.co/very/long/path?x=1 ',
  'function x(a,b){return a+b} const y=(a=>a*2)(21); let z=`hello ${y}!`; ',
  '{"a":1,"b":[2,3],"c":{"d":null}} [1,2,3] <div class="x">hi</div> ',
];

// Generate diverse synthetic sentences from wordlist
const wordlist = readFileSync('dict/wordlists/english.txt', 'utf-8').split('\n').filter(Boolean);
function randomSentence() {
  const len = 5 + Math.floor(Math.random() * 12); // 5-16 words
  let words = [];
  for (let i = 0; i < len; i++) words.push(wordlist[Math.floor(Math.random() * Math.min(4000, wordlist.length))]);
  // random caps/punct
  if (Math.random() < 0.2) words[0] = words[0][0].toUpperCase() + words[0].slice(1);
  let s = words.join(' ');
  const puncts = ['. ', ', ', '! ', '? ', '; ', ': ', ' '];
  if (Math.random() < 0.5) s += puncts[Math.floor(Math.random() * 3)];
  return s + ' ';
}
function randomCodeSnippet() {
  const snippets = [
    'const {a,b} = obj; ', 'let x = await fetch(url); ', 'if (x && y || z) { return true; } ',
    'for (let i=0;i<n;i++) arr.push(i); ', 'try { doWork(); } catch(e) { console.error(e); } ',
    'export default function foo(bar) { return bar * 2; } ', 'import { encode } from "./encoder.js"; ',
    'db.query("SELECT * FROM table WHERE id=$1", [id]); ', 'app.use(express.json()); ',
    'class Foo extends Bar { constructor() { super(); } } '
  ];
  return snippets[Math.floor(Math.random() * snippets.length)];
}
function randomPath() {
  const paths = ['/usr/local/bin/node ', '~/projects/aicl/src/index.js ', 'https://cdn.example.com/lib.js?v=1 ', './src/utils/helpers.ts '];
  return paths[Math.floor(Math.random() * paths.length)];
}

// Build diverse corpus: base * 100 (not 800) + 30k random sentences
let parts = [];
// base varied but limited repetition
for (let i = 0; i < 120; i++) for (const s of base) parts.push(s);

// 25k random natural sentences
for (let i = 0; i < 25000; i++) parts.push(randomSentence());
// 5k code-ish lines
for (let i = 0; i < 5000; i++) parts.push(randomCodeSnippet());
// 2k path/url lines
for (let i = 0; i < 2000; i++) parts.push(randomPath());

parts = parts.sort(() => Math.random() - 0.5);
const raw = parts.join('\n');

const CHUNK = 200_000;
let aiclParts = [];
for (let i = 0; i < raw.length; i += CHUNK) {
  const slice = raw.slice(i, i + CHUNK);
  aiclParts.push(encode(slice).output);
}
const aicl = aiclParts.join('');
mkdirSync('corpus', { recursive: true });
writeFileSync('corpus/raw_train.txt', raw);
writeFileSync('corpus/aicl_train.txt', aicl);
console.log(`raw: ${raw.length} chars, aicl: ${[...aicl].length} chars, ratio ${(raw.length / [...aicl].length).toFixed(2)}x`);
console.log(`parts: ${parts.length} segments`);
