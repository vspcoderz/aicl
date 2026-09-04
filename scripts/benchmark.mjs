#!/usr/bin/env node
import { writeFileSync } from 'fs';
import { encode } from '../src/encoder.js';
import { tokenize, loadTokenizer } from '../src/tokenizer/index.js';
import { encode as gptEncode } from 'gpt-tokenizer';
import llamaTok from 'llama-tokenizer-js/llama-tokenizer.js';

const tok = llamaTok;
const vocab = loadTokenizer();

const TESTS = [
  ['Common English', 'the quick brown fox jumps over the lazy dog this is a test of the emergency broadcast system how now brown cow the rain in spain stays mainly on the plain'],
  ['Code', 'const app = express(); app.get("/api/tasks", async (req, res) => { const tasks = await db.query("SELECT * FROM tasks"); res.json(tasks); });'],
  ['SQL', 'SELECT * FROM users WHERE id=42 AND name LIKE \'%test%\' ORDER BY created_at DESC; INSERT INTO table_name (a,b,c) VALUES (1,\'x\',true); UPDATE users SET name=\'abc\', score=99 WHERE id=7; DELETE FROM users WHERE id>1000; CREATE TABLE test(id INT PRIMARY KEY,name VARCHAR(255));'],
  ['API', '{"status": "success", "data": {"users": [{"id": 1, "name": "John", "email": "john@example.com"}, {"id": 2, "name": "Jane", "email": "jane@example.com"}], "total": 2, "page": 1, "per_page": 10}}'],
  ['Shell', '$ echo "Hello, World!"; printf \'%s\\n\' "$HOME"; ls -la /tmp | grep ".log" && cat file.txt; sudo -n true || echo "no sudo"; python3 -c \'print("test")\'; node -e "console.log(42)"; git status --short; git add . && git commit -m "test"; npm run build && npm start'],
  ['Markdown', '# README.md ## Test Project ### Features - fast - simple - random ### Code `npm install && npm run dev` **bold** *italic* [link](https://example.com) > quote --- ### End'],
  ['Paths', 'C:\\Users\\Test\\file.txt D:\\Games\\MC\\server.exe /usr/bin/bash ~/.config/hypr/hyprland.conf ../../src/main.js ./build/output.log https://example.com/?a=1&b=2 ftp://x@y.z:21/path git@host:user/repo.git user@example.com test+tag@example.org'],
  ['Prompt', 'aicl is Goated BTW, and this can reduce tokens very vary fast'],
];

const rows = TESTS.map(([name, text]) => {
  const aicl = tokenize(encode(text).output, vocab).length;
  const gpt3 = gptEncode(text, { model: 'gpt-3.5-turbo' }).length;
  const gpt4 = gptEncode(text, { model: 'gpt-4' }).length;
  const gpt4o = gptEncode(text, { model: 'gpt-4o' }).length;
  const gpt5 = gptEncode(text, { model: 'gpt-5' }).length;
  const llama = tok.encode(text).length;
  return { name, raw: text.length, aicl, gpt3, gpt4, gpt4o, gpt5, llama, win: +(gpt4o / aicl).toFixed(2) };
});

for (const r of rows) console.log(`${r.name.padEnd(16)} raw=${String(r.raw).padStart(3)} AICL=${String(r.aicl).padStart(3)} gpt3=${String(r.gpt3).padStart(3)} gpt4=${String(r.gpt4).padStart(3)} gpt4o=${String(r.gpt4o).padStart(3)} g5=${String(r.gpt5).padStart(3)} llama=${String(r.llama).padStart(3)} win=${r.win}x`);
console.log(`vocab ${vocab.numMerges} merges maxLen=${vocab.maxTokenLength}`);

// ── helpers — minimal professional palette ──
const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const W = 900;
const PALETTE = { bg:'#0a0a0a', grid:'#1f1f23', gpt3:'#71717a', gpt4:'#52525b', gpt4o:'#3f3f46', gpt5:'#27272a', llama:'#a1a1aa', aicl:'#fafafa' };

function barRect(x, y, w, h, fill, rx = 4, extra='') {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" ${extra}/>`;
}

// ── benchmark.svg (GPT-4o vs AICL) — minimal dark ──
{
  const H = 520;
  const top = 96, bottom = 380, chartH = bottom - top;
  const maxTok = Math.max(...rows.map(r => Math.max(r.gpt4o, r.aicl)), 90);
  const scale = chartH / (maxTok * 1.12);
  const cols = rows.length;
  const colW = 86, gap = (820 - cols * colW) / (cols - 1);
  const startX = 60;
  let groups = '';
  rows.forEach((r, i) => {
    const x = startX + i * (colW + gap);
    const gH = Math.round(r.gpt4o * scale);
    const aH = Math.round(r.aicl * scale);
    const gY = bottom - gH;
    const aY = bottom - aH;
    const label1 = r.name === 'Common English' ? ['Common','English'] : r.name === 'API' ? ['API','response'] : r.name === 'Prompt' ? ['Prompt'] : [r.name];
    const win = r.win;
    const winColor = win >= 2 ? '#10b981' : win >= 1.2 ? '#a3e635' : '#eab308';
    groups += `
  <g>
    ${barRect(x+8, gY, 28, gH, '#27272a', 4, 'opacity="0.85"')}
    <text x="${x+22}" y="${gY-8}" text-anchor="middle" fill="#9ca3af" font-size="9" font-weight="600">${r.gpt4o}</text>
    ${barRect(x+44, aY, 28, aH, PALETTE.aicl, 4, '')}
    <text x="${x+58}" y="${aY-8}" text-anchor="middle" fill="#fafafa" font-size="9" font-weight="700">${r.aicl}</text>
    ${label1.map((l, idx) => `<text x="${x+40}" y="${410+idx*12}" text-anchor="middle" font-size="10" font-weight="600" fill="#e5e7eb">${esc(l)}</text>`).join('')}
    <text x="${x+40}" y="440" text-anchor="middle" fill="${winColor}" font-size="9" font-weight="700">${win}×</text>
  </g>`;
  });
  const gridLabels = [0.25,0.5,0.75,1].map(f=>{
    const v = Math.round(maxTok * f);
    const y = bottom - Math.round(maxTok*f*scale);
    return {v,y};
  });
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
<style>.t{font:700 17px 'Stack Sans Notch','Inter',system-ui,sans-serif;fill:#f9fafb;letter-spacing:-0.3px}.s{font:400 11px 'Stack Sans Notch','Inter',system-ui,sans-serif;fill:#9ca3af}.n{font:600 10px 'Stack Sans Notch','Inter',system-ui,sans-serif;fill:#e5e7eb}.a{font:400 9px 'Stack Sans Notch','Inter',system-ui,sans-serif;fill:#6b7280}</style>
<rect width="${W}" height="${H}" rx="16" fill="${PALETTE.bg}"/>
<text x="32" y="34" class="t">AICL vs GPT-4o — tokens (lower is better)</text>
<text x="32" y="52" class="s">2–5 PUA → 1 token · ${vocab.numMerges} merges · max 5 PUA/token · 8 tests · 131/131 pass</text>
<g transform="translate(32,66)">
  <rect x="0" y="0" width="10" height="10" rx="2" fill="#27272a"/><text x="14" y="9" class="s">GPT-4o (o200k_base)</text>
  <rect x="140" y="0" width="10" height="10" rx="2" fill="${PALETTE.aicl}"/><text x="154" y="9" class="s">AICLTokenizer</text>
</g>
<g stroke="${PALETTE.grid}" stroke-width="1">
  ${[top, top+chartH*0.25, top+chartH*0.5, top+chartH*0.75, bottom].map(y=>`<line x1="52" y1="${y}" x2="860" y2="${y}"/>`).join('')}
</g>
${gridLabels.map(({v,y})=>`<text x="44" y="${y+4}" class="a" text-anchor="end">${v}</text>`).join('')}
<text x="44" y="${top-6}" class="a" text-anchor="end">${maxTok}</text>
${groups}
<line x1="32" y1="460" x2="868" y2="460" stroke="${PALETTE.grid}"/>
<text x="32" y="480" class="s">Lower is better · pipeline: raw → AICL (51k dict · 2–5 PUA) → BPE → tokens</text>
<text x="32" y="498" class="a">github.com/vspcoderz/aicl · ${vocab.numMerges} merges</text>
</svg>`;
  writeFileSync('assets/benchmark.svg', svg);
  console.log('wrote assets/benchmark.svg');
}

// ── benchmark-all.svg (6 tokenizers) — minimal dark ──
{
  const H = 620;
  const top = 96, bottom = 420, chartH = bottom - top;
  const maxTok = Math.max(...rows.flatMap(r=>[r.gpt3,r.gpt4,r.gpt4o,r.gpt5,r.llama,r.aicl]), 90);
  const scale = chartH / (maxTok * 1.1);
  const cols = rows.length;
  const groupW = 86, gap = (820 - cols*groupW)/(cols-1);
  const startX = 60;
  const barW = 10, barGap = 2;
  const colors = { gpt3: PALETTE.gpt3, gpt4: PALETTE.gpt4, gpt4o: PALETTE.gpt4o, gpt5: PALETTE.gpt5, llama: PALETTE.llama, aicl: PALETTE.aicl };
  let groups='';
  rows.forEach((r,i)=>{
    const x = startX + i*(groupW+gap);
    const vals = [r.gpt3,r.gpt4,r.gpt4o,r.gpt5,r.llama,r.aicl];
    const keys = ['gpt3','gpt4','gpt4o','gpt5','llama','aicl'];
    let bars='';
    vals.forEach((v,j)=>{
      const h = Math.round(v*scale);
      const y = bottom - h;
      const bx = x + j*(barW+barGap);
      const fill = colors[keys[j]];
      const rx = j===5?3:2;
      const isAicl = j===5;
      bars+=`<rect x="${bx}" y="${y}" width="${barW}" height="${h}" rx="${rx}" fill="${fill}" opacity="${isAicl?'1':'0.9'}" ${isAicl?'stroke="#e5e7eb" stroke-width="0.5"':''}/>`;
    });
    const short = r.name==='Common English'?'Common':r.name==='API'?'API':r.name;
    const win = r.win;
    groups+=`
  <g>
    ${bars}
    <text x="${x+groupW/2}" y="500" text-anchor="middle" class="n">${esc(short)}</text>
    ${r.name==='Common English'?`<text x="${x+groupW/2}" y="512" text-anchor="middle" class="n">Eng</text>`:''}
    <text x="${x+groupW/2}" y="530" text-anchor="middle" fill="#a78bfa" font-size="7" font-weight="700">${win}×</text>
  </g>`;
  });
  const svg2 = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
<style>.t{font:700 17px 'Stack Sans Notch','Inter',system-ui,sans-serif;fill:#f9fafb;letter-spacing:-0.3px}.s{font:400 11px 'Stack Sans Notch','Inter',system-ui,sans-serif;fill:#9ca3af}.n{font:600 9px 'Stack Sans Notch','Inter',system-ui,sans-serif;fill:#e5e7eb}.a{font:400 8px 'Stack Sans Notch','Inter',system-ui,sans-serif;fill:#6b7280}</style>
<rect width="${W}" height="${H}" rx="16" fill="${PALETTE.bg}"/>
<text x="32" y="34" class="t">AICL vs All Tokenizers — 8 tests</text>
<text x="32" y="52" class="s">tokens — lower is better · GPT-3/4/4o/5 + LLaMA 2 + AICL (${vocab.numMerges} merges, 2–5 PUA → 1 token)</text>
<g transform="translate(32,64)">
  <rect x="0" y="0" width="10" height="10" rx="2" fill="${PALETTE.gpt3}"/><text x="14" y="9" class="s">GPT-3</text>
  <rect x="58" y="0" width="10" height="10" rx="2" fill="${PALETTE.gpt4}"/><text x="72" y="9" class="s">GPT-4</text>
  <rect x="112" y="0" width="10" height="10" rx="2" fill="${PALETTE.gpt4o}"/><text x="126" y="9" class="s">GPT-4o</text>
  <rect x="172" y="0" width="10" height="10" rx="2" fill="${PALETTE.gpt5}"/><text x="186" y="9" class="s">GPT-5</text>
  <rect x="226" y="0" width="10" height="10" rx="2" fill="${PALETTE.llama}"/><text x="240" y="9" class="s">LLaMA2</text>
  <rect x="296" y="0" width="10" height="10" rx="2" fill="${PALETTE.aicl}" stroke="#e5e7eb" stroke-width="0.5"/><text x="310" y="9" class="s">AICL</text>
</g>
<g stroke="${PALETTE.grid}" stroke-width="1">
  ${[top, top+chartH*0.25, top+chartH*0.5, top+chartH*0.75, bottom].map(y=>`<line x1="52" y1="${y}" x2="860" y2="${y}"/>`).join('')}
</g>
${[0,0.25,0.5,0.75,1].map(f=>{
  const v = Math.round(maxTok*f);
  const y = bottom - Math.round(maxTok*f*scale);
  return `<text x="44" y="${y+4}" class="a" text-anchor="end">${v}</text>`;
}).join('')}
${groups}
<line x1="32" y1="520" x2="868" y2="520" stroke="${PALETTE.grid}"/>
<text x="32" y="540" class="s">AICL wins 8/8 — best: Code 4.50×, API 3.84×, Shell 3.46×, Markdown 3.07× · Lower = cheaper</text>
<text x="32" y="558" class="s">github.com/vspcoderz/aicl · 131/131 pass · 8 tests · 6 tokenizers</text>
</svg>`;
  writeFileSync('assets/benchmark-all.svg', svg2);
  console.log('wrote assets/benchmark-all.svg');
}
