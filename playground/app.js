// AICL Playground — client side, talks to /api/tokenize with local fallback
const $ = id => document.getElementById(id);
const elInput = $('input');
const elExample = $('example');
const elClear = $('clear');
const elStatus = $('status');
const elCharCount = $('charCount');
const elToggleSteps = $('toggleSteps');
const elToggleHex = $('toggleHex');
const elToggleHeatmap = $('toggleHeatmap');
const elKpiRaw = $('kpiRaw');
const elKpiAicl = $('kpiAicl');
const elKpiTokens = $('kpiTokens');
const elKpiStage1 = $('kpiStage1');
const elKpiStage2 = $('kpiStage2');
const elKpiWin = $('kpiWin');
const elKpiSave = $('kpiSave');
const elBars = $('bars');
const elPipeRaw = $('pipeRaw');
const elPipeAicl = $('pipeAicl');
const elPipeAiclWrap = $('pipeAiclWrap');
const elHeatmapLegend = $('heatmapLegend');
const elPipeAiclMeta = $('pipeAiclMeta');
const elPipeTokens = $('pipeTokens');
const elPipeTokensMeta = $('pipeTokensMeta');
const elRoundtrip = $('roundtrip');
const elSteps = $('steps');
const elStepsMeta = $('stepsMeta');
const elPerfSection = $('perfSection');
const elPerfStage1 = $('perfStage1');
const elPerfStage2 = $('perfStage2');
const elPerfTotal = $('perfTotal');
const elDropZone = $('dropZone');
const elFileInput = $('fileInput');
const elToast = $('toast');
const elShare = $('share');
const elUploadBtn = $('uploadBtn');
const elCopyAicl = $('copyAicl');
const elCopyTokens = $('copyTokens');
const elCopyAll = $('copyAll');

const EXAMPLES = {
  english: 'the quick brown fox jumps over the lazy dog this is a test of the emergency broadcast system how now brown cow the rain in spain stays mainly on the plain',
  code: 'const app = express(); app.get("/api/tasks", async (req, res) => { const tasks = await db.query("SELECT * FROM tasks"); res.json(tasks); });',
  sql: "SELECT * FROM users WHERE id=42 AND name LIKE '%test%' ORDER BY created_at DESC; INSERT INTO table_name (a,b,c) VALUES (1,'x',true); UPDATE users SET name='abc', score=99 WHERE id=7; DELETE FROM users WHERE id>1000; CREATE TABLE test(id INT PRIMARY KEY,name VARCHAR(255));",
  api: '{"status": "success", "data": {"users": [{"id": 1, "name": "John", "email": "john@example.com"}, {"id": 2, "name": "Jane", "email": "jane@example.com"}], "total": 2, "page": 1, "per_page": 10}}',
  shell: '$ echo "Hello, World!"; printf \'%s\\n\' "$HOME"; ls -la /tmp | grep ".log" && cat file.txt; sudo -n true || echo "no sudo"; python3 -c \'print("test")\'; node -e "console.log(42)"; git status --short; git add . && git commit -m "test"; npm run build && npm start',
  markdown: '# README.md ## Test Project ### Features - fast - simple - random ### Code `npm install && npm run dev` **bold** *italic* [link](https://example.com) > quote --- ### End',
  paths: 'C:\\Users\\Test\\file.txt D:\\Games\\MC\\server.exe /usr/bin/bash ~/.config/hypr/hyprland.conf ../../src/main.js ./build/output.log https://example.com/?a=1&b=2 ftp://x@y.z:21/path git@host:user/repo.git user@example.com test+tag@example.org',
  prompt: 'aicl is Goated BTW, and this can reduce tokens very vary fast',
  huge: 'the quick brown fox jumps over the lazy dog this is a test of the emergency broadcast system how now brown cow the rain in spain stays mainly on the plain we are testing the aicl compression algorithm which should compress english text into unicode private use area symbols and then tokenize those symbols with bpe to produce fewer tokens than gpt-4o would use for the same text the goal is to reduce api costs and improve inference speed when sending prompts to large language models the encoder uses a dictionary of fifty one thousand entries including words code patterns and common phrases each entry maps to a unicode character in the private use area the tokenizer then merges these symbols using byte pair encoding to create multi-symbol tokens which further reduces the token count',
};

// State
let lastData = null;
let debounce = null;

// --- Utilities ---
function words(s) { const t = s.trim(); return t ? t.split(/\s+/).length : 0; }
function hexOf(ch) { return 'U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0'); }
function esc(s) { return String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'); }

function toast(msg, ms = 1800) {
  elToast.textContent = msg;
  elToast.classList.add('show');
  setTimeout(() => elToast.classList.remove('show'), ms);
}

async function copyText(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`Copied ${label}`);
  } catch { toast('Copy failed'); }
}

// --- URL sharing ---
function loadFromHash() {
  try {
    const h = location.hash.slice(1);
    if (!h) return null;
    return decodeURIComponent(atob(h));
  } catch { return null; }
}

function saveToHash(text) {
  try {
    history.replaceState(null, '', '#' + btoa(encodeURIComponent(text)));
  } catch {}
}

// --- Drag & drop / file upload ---
elDropZone.addEventListener('dragover', e => { e.preventDefault(); elDropZone.classList.add('drag-over'); });
elDropZone.addEventListener('dragleave', () => elDropZone.classList.remove('drag-over'));
elDropZone.addEventListener('drop', e => {
  e.preventDefault();
  elDropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) readFile(file);
});
elUploadBtn.addEventListener('click', () => elFileInput.click());
elFileInput.addEventListener('change', () => {
  const file = elFileInput.files[0];
  if (file) readFile(file);
  elFileInput.value = '';
});

function readFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    elInput.value = reader.result;
    schedule();
  };
  reader.readAsText(file);
}

// --- Share ---
elShare.addEventListener('click', () => {
  const text = elInput.value;
  if (!text) { toast('Nothing to share'); return; }
  saveToHash(text);
  const url = location.href;
  copyText(url, 'share URL');
});

// --- Copy buttons ---
elCopyAicl.addEventListener('click', () => {
  if (!lastData) return;
  copyText(lastData.pipeline.aicl, 'AICL output');
});
elCopyTokens.addEventListener('click', () => {
  if (!lastData) return;
  copyText(lastData.pipeline.tokenIds.join(' '), 'token IDs');
});
elCopyAll.addEventListener('click', () => {
  if (!lastData) return;
  const d = lastData;
  const lines = [
    `=== AICL Pipeline ===`,
    ``,
    `--- Raw (${d.stats.rawChars} chars) ---`,
    elInput.value,
    ``,
    `--- AICL (${d.stats.aiclChars} PUA) ---`,
    d.pipeline.aicl,
    ``,
    `--- Token IDs (${d.stats.aiclTokens} tokens) ---`,
    d.pipeline.tokenIds.join(' '),
    ``,
    `--- Stats ---`,
    `Stage 1: ${d.stats.stage1x}×`,
    `Stage 2: ${d.stats.stage2x}×`,
    `vs GPT-4o: ${d.stats.winVsGpt4o || '—'}×`,
    `Roundtrip: ${d.pipeline.roundtripOk ? 'OK' : 'FAILED'}`,
  ];
  copyText(lines.join('\n'), 'pipeline');
});

// --- Core run ---
function schedule() {
  clearTimeout(debounce);
  elStatus.textContent = 'typing…';
  debounce = setTimeout(run, 180);
}

async function run() {
  const text = elInput.value;
  const hex = elToggleHex.checked;
  const useSteps = elToggleSteps.checked;
  const useHeatmap = elToggleHeatmap.checked;
  elCharCount.textContent = `${[...text].length} chars · ${words(text)} words`;

  // Raw input — token-colored or plain
  if (useHeatmap && data.pipeline.rawToAicl && data.pipeline.tokenMap) {
    elPipeRaw.innerHTML = rawTokenColoredSpans(text, data.pipeline.rawToAicl, data.pipeline.tokenMap);
  } else {
    elPipeRaw.textContent = text || '—';
  }

  if (!text) {
    elStatus.textContent = 'waiting…';
    elKpiRaw.textContent = '—'; elKpiAicl.textContent = '—'; elKpiTokens.textContent = '—';
    elKpiStage1.textContent = ''; elKpiStage2.textContent = ''; elKpiWin.textContent = '—'; elKpiSave.textContent = '';
    elBars.innerHTML = ''; elPipeAicl.textContent = '—'; elPipeAiclMeta.textContent = '';
    elPipeTokens.textContent = '—'; elPipeTokensMeta.textContent = '';
    elRoundtrip.textContent = 'Type something to see the pipeline.'; elRoundtrip.className = 'roundtrip';
    elSteps.innerHTML = ''; elStepsMeta.textContent = '';
    elPerfSection.style.display = 'none';
    elHeatmapLegend.style.display = 'none';
    lastData = null;
    return;
  }

  elStatus.textContent = 'encoding…';
  try {
    const res = await fetch('/api/tokenize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    if (!res.ok) throw new Error('api ' + res.status);
    const data = await res.json();
    lastData = data;
    render(data, hex, useSteps, useHeatmap);
    elStatus.textContent = `done · ${data.encodeMs}ms · ${data.vocab.merges} merges`;
  } catch (e) {
    elStatus.textContent = 'offline — run: npm run playground';
    elRoundtrip.textContent = String(e.message || e);
    elRoundtrip.className = 'roundtrip bad';
    elPerfSection.style.display = 'none';
  }
}

// --- Token coloring: 20 distinct colors for token visualization ---
const TOKEN_COLORS = [
  '#3b82f6', // blue
  '#f97316', // orange
  '#10b981', // emerald
  '#a855f7', // purple
  '#ef4444', // red
  '#06b6d4', // cyan
  '#eab308', // yellow
  '#ec4899', // pink
  '#14b8a6', // teal
  '#8b5cf6', // violet
  '#f59e0b', // amber
  '#22c55e', // green
  '#6366f1', // indigo
  '#e11d48', // rose
  '#0ea5e9', // sky
  '#d946ef', // fuchsia
  '#84cc16', // lime
  '#f43f5e', // rose-500
  '#8b5cf6', // violet-500
  '#0891b2', // cyan-600
];

function tokenColoredSpans(aicl, tokenMap) {
  if (!aicl || !tokenMap || !tokenMap.length) return esc(aicl || '—');
  const chars = [...aicl];
  return chars.map((ch, i) => {
    const tokIdx = tokenMap[i];
    const color = TOKEN_COLORS[tokIdx % TOKEN_COLORS.length];
    return `<span class="tok" style="background:${color}22;color:${color};border-bottom:2px solid ${color}" title="token ${tokIdx}">${esc(ch)}</span>`;
  }).join('');
}

// Color raw input: each char gets the color of the token it maps to via rawToAicl→tokenMap
function rawTokenColoredSpans(rawText, rawToAicl, tokenMap) {
  if (!rawText || !rawToAicl || !tokenMap) return esc(rawText || '—');
  const chars = [...rawText];
  return chars.map((ch, i) => {
    const aiclIdx = rawToAicl[i];
    const tokIdx = aiclIdx >= 0 && aiclIdx < tokenMap.length ? tokenMap[aiclIdx] : -1;
    if (tokIdx < 0) return esc(ch);
    const color = TOKEN_COLORS[tokIdx % TOKEN_COLORS.length];
    return `<span class="tok" style="background:${color}22;color:${color};border-bottom:2px solid ${color}" title="token ${tokIdx}">${esc(ch)}</span>`;
  }).join('');
}

function render(data, hex, useSteps, useHeatmap) {
  const { stats, compare, pipeline, vocab, timings } = data;

  // KPIs
  elKpiRaw.textContent = String(stats.rawChars);
  elKpiAicl.textContent = String(stats.aiclChars);
  elKpiTokens.textContent = String(stats.aiclTokens);
  elKpiStage1.textContent = `${stats.stage1x}× · ${stats.aiclChars} PUA`;
  elKpiStage2.textContent = `${stats.stage2x}× · 2–5 PUA/token · ${vocab.maxTokenLength} max`;
  elKpiWin.textContent = stats.winVsGpt4o ? `${stats.winVsGpt4o}×` : '—';
  elKpiWin.style.color = stats.winVsGpt4o >= 2 ? '#10b981' : stats.winVsGpt4o >= 1.2 ? '#a3e635' : '#9ca3af';
  elKpiSave.textContent = stats.winVsGpt4o ? `save ${stats.savePct}% vs GPT-4o` : 'no savings';

  // Performance
  if (timings) {
    elPerfSection.style.display = '';
    elPerfStage1.textContent = timings.encodeMs != null ? `${timings.encodeMs.toFixed(1)}ms` : '—';
    elPerfStage2.textContent = timings.tokenizeMs != null ? `${timings.tokenizeMs.toFixed(1)}ms` : '—';
    elPerfTotal.textContent = timings.totalMs != null ? `${timings.totalMs.toFixed(1)}ms` : '—';
  }

  // AICL output — token-colored or hex or plain
  if (useHeatmap && !hex) {
    elPipeAiclWrap.innerHTML = `<pre class="pipe-pre mono">${tokenColoredSpans(pipeline.aicl, pipeline.tokenMap)}</pre>`;
    elHeatmapLegend.style.display = '';
  } else {
    elPipeAiclWrap.innerHTML = `<pre id="pipeAicl" class="pipe-pre mono">${hex ? [...pipeline.aicl].map(c => `${c} ${hexOf(c)}`).join('  ') : esc(pipeline.aicl || '— (all compressed)')}</pre>`;
    elHeatmapLegend.style.display = 'none';
  }
  elPipeAiclMeta.textContent = `${pipeline.aiclLen} PUA chars · ${pipeline.matches} matches · ${pipeline.literals} literals`;

  // Tokens
  const ids = pipeline.tokenIds;
  elPipeTokens.textContent = ids.length ? (hex ? ids.join(' ') : `${ids.slice(0, 120).join(' ')}${ids.length > 120 ? ' …' : ''}`) : '—';
  elPipeTokensMeta.textContent = `${ids.length} tokens · vocab ${vocab.merges} merges`;

  // Roundtrip
  elRoundtrip.textContent = pipeline.roundtripOk ? `✓ Roundtrip OK — decode(encode(x)) === x` : `✗ Roundtrip FAILED`;
  elRoundtrip.className = pipeline.roundtripOk ? 'roundtrip ok' : 'roundtrip bad';

  // Bars
  const max = Math.max(compare.gpt3, compare.gpt4, compare.gpt4o, compare.gpt5, compare.llama, compare.aicl, 1);
  const rows = [
    ['GPT-3', compare.gpt3, 'gpt3'],
    ['GPT-4', compare.gpt4, 'gpt4'],
    ['GPT-4o', compare.gpt4o, 'gpt4o'],
    ['GPT-5', compare.gpt5, 'gpt5'],
    ['LLaMA 2', compare.llama, 'llama'],
    ['AICL', compare.aicl, 'aicl'],
  ];
  elBars.innerHTML = rows.map(([label, val, cls]) => {
    const w = Math.max(6, Math.round(val / max * 100));
    const best = label === 'AICL' && val === Math.min(...rows.map(r => r[1]));
    return `<div class="bar-row"><div class="bar-label">${label}${best ? ' ★' : ''}</div><div class="bar-track"><div class="bar-fill ${cls}" style="width:${w}%"></div></div><div class="bar-value">${val}</div></div>`;
  }).join('');

  // Steps
  if (useSteps && pipeline.steps) {
    elStepsMeta.textContent = `${pipeline.steps.length} steps`;
    elSteps.innerHTML = pipeline.steps.slice(0, 260).map(s => {
      if (s.type === 'match') return `<div class="step ok"><b>match</b> ${esc(s.pattern)} → <em>${hex ? hexOf(s.symbol) : s.symbol}</em> @${s.pos}</div>`;
      if (s.type === 'base') return `<div class="step ok"><b>base</b> ${esc(s.pattern)} @${s.pos}</div>`;
      if (s.type === 'modifier') return `<div class="step"><b>modifier</b> ${esc(s.name)} @${s.pos}</div>`;
      if (s.type === 'fragment') return `<div class="step"><b>fragment</b> ${esc(s.pattern)} @${s.pos}</div>`;
      if (s.type === 'literal') return `<div class="step lit"><b>literal</b> ${esc(s.char)} @${s.pos}</div>`;
      return `<div class="step">${esc(JSON.stringify(s))}</div>`;
    }).join('') + (pipeline.steps.length > 260 ? `<div class="muted small">… ${pipeline.steps.length - 260} more steps</div>` : '');
  } else {
    elStepsMeta.textContent = useSteps ? 'no steps' : 'steps off';
    elSteps.innerHTML = useSteps ? '<div class="muted small">No steps returned.</div>' : '<div class="muted small">Enable "steps" to see the greedy trie + word fallback trace.</div>';
  }
}

// --- Events ---
elInput.addEventListener('input', schedule);
elExample.addEventListener('change', () => { const v = elExample.value; if (EXAMPLES[v]) { elInput.value = EXAMPLES[v]; schedule(); } });
elClear.addEventListener('click', () => { elInput.value = ''; elExample.value = ''; schedule(); elInput.focus(); });
elToggleSteps.addEventListener('change', () => run());
elToggleHex.addEventListener('change', () => run());
elToggleHeatmap.addEventListener('change', () => { if (lastData) render(lastData, elToggleHex.checked, elToggleSteps.checked, elToggleHeatmap.checked); });

// Keyboard shortcut
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); }
});

// Init: load from URL hash or default
const fromHash = loadFromHash();
if (fromHash) {
  elInput.value = fromHash;
} else {
  elInput.value = EXAMPLES.prompt;
}
schedule();
