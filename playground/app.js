// AICL Playground — client side, talks to /api/tokenize with local fallback
const $ = id => document.getElementById(id);
const elInput = $('input');
const elHighlight = $('highlight');
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
const elPipeAiclWrap = $('pipeAiclWrap');
const elPipeAiclMeta = $('pipeAiclMeta');
const elPipeTokens = $('pipeTokens');
const elPipeTokensMeta = $('pipeTokensMeta');
const elPipeSummaryMeta = $('pipeSummaryMeta');
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
  modern: 'export const useAuth = () => {\n  const [user, setUser] = useState(null);\n  const login = async (email, password) => {\n    const res = await fetch("/api/login", { method: "POST", body: JSON.stringify({ email, password }) });\n    if (!res.ok) throw new Error("login failed");\n    setUser(await res.json());\n  };\n  return { user, login, logout };\n};',
  sql: "SELECT c.name, COUNT(o.id) AS orders FROM customers c LEFT JOIN orders o ON o.customer_id = c.id GROUP BY c.id HAVING COUNT(o.id) > 5 ORDER BY orders DESC LIMIT 20;",
  api: '{"status": "success", "data": {"users": [{"id": 1, "name": "John", "email": "john@example.com"}, {"id": 2, "name": "Jane", "email": "jane@example.com"}], "total": 2, "page": 1, "per_page": 10}}',
  shell: '$ echo "Hello, World!"; printf \'%s\\n\' "$HOME"; ls -la /tmp | grep ".log" && cat file.txt; sudo -n true || echo "no sudo"; python3 -c \'print("test")\'; node -e "console.log(42)"; git status --short; git add . && git commit -m "test"; npm run build && npm start',
  markdown: '# Setup Guide\n\n## Prerequisites\n- Node 20 or later\n- A valid API key\n\n### Install\n```bash\nnpm install && npm run build\n```\n\n> **Note:** migration scripts are idempotent.\n\n---\n\n### Rollback\nUse `db rollback --steps 1` to undo.',
  paths: 'C:\\Users\\Test\\file.txt D:\\Games\\MC\\server.exe /usr/bin/bash ~/.config/hypr/hyprland.conf ../../src/main.js ./build/output.log https://example.com/?a=1&b=2 ftp://x@y.z:21/path git@host:user/repo.git user@example.com test+tag@example.org',
  caps: 'LOL BRO WE GETTING LIKE LOTS OF FASTER SHIT THIS IS WHERE WE CAN LIKE LOSE TO GPT SHIT WHAT THE FUCK\n## ANNOUNCEMENT\n> THAT WE ARE NOT SAOASDH AJB AND YOUR THW WORSE SHIT WE CAN DO LIKE ATLEAST WE BEATING LLaMA 2 stuff',
  ascii: 'Verified ✅\n\n┌──────────────┐\n│ Settings     │\n├──────────────┤\n│  Description │\n│  Support     │\n│   Privacy    │\n│    Terms     │\n│   Images     │\n│  Install     │\n└──────────────┘\n\n----\n== Section ==\n**bold** and __under__\n    indented code\n        deeper indent',
  prompt: 'aicl is Goated BTW, and this can reduce tokens very vary fast',
  huge: 'the quick brown fox jumps over the lazy dog this is a test of the emergency broadcast system how now brown cow the rain in spain stays mainly on the plain we are testing the aicl compression algorithm which should compress english text into unicode private use area symbols and then tokenize those symbols with bpe to produce fewer tokens than gpt-4o would use for the same text the goal is to reduce api costs and improve inference speed when sending prompts to large language models the encoder uses a dictionary of fifty one thousand entries including words code patterns and common phrases each entry maps to a unicode character in the private use area the tokenizer then merges these symbols using byte pair encoding to create multi-symbol tokens which further reduces the token count',
};

// State
let lastData = null;
let debounce = null;
let hlScrollSync = false;

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
  renderHighlight();
  debounce = setTimeout(run, 180);
}

async function run() {
  const text = elInput.value;
  elCharCount.textContent = `${[...text].length} chars · ${words(text)} words`;

  if (!text) {
    elStatus.textContent = 'waiting…';
    elKpiRaw.textContent = '—'; elKpiAicl.textContent = '—'; elKpiTokens.textContent = '—';
    elKpiStage1.textContent = ''; elKpiStage2.textContent = ''; elKpiWin.textContent = '—'; elKpiSave.textContent = '';
    elBars.innerHTML = ''; elPipeAiclWrap.innerHTML = '<pre class="pipe-pre mono">—</pre>'; elPipeAiclMeta.textContent = '';
    elPipeTokens.textContent = '—'; elPipeTokensMeta.textContent = '';
    elRoundtrip.textContent = 'Type something to see the pipeline.'; elRoundtrip.className = 'roundtrip';
    elSteps.innerHTML = ''; elStepsMeta.textContent = '';
    elPerfSection.style.display = 'none';
    lastData = null;
    renderHighlight();
    return;
  }

  elStatus.textContent = 'encoding…';
  try {
    const res = await fetch('/api/tokenize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    if (!res.ok) throw new Error('api ' + res.status);
    const data = await res.json();
    lastData = data;
    render(data);
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
  '#3b82f6', '#f97316', '#10b981', '#a855f7', '#ef4444',
  '#06b6d4', '#eab308', '#ec4899', '#14b8a6', '#8b5cf6',
  '#f59e0b', '#22c55e', '#6366f1', '#e11d48', '#0ea5e9',
  '#d946ef', '#84cc16', '#f43f5e', '#8b5cf6', '#0891b2',
];

function tokenBg(tokIdx) {
  const c = TOKEN_COLORS[tokIdx % TOKEN_COLORS.length];
  return `background:${c}2e;color:${c}`;
}

/**
 * Live token highlighting inside the input box: an overlay div under the
 * transparent-text textarea renders the same text with per-token colors.
 * Mirrors trailing newline (textarea shows one, div doesn't) and keeps
 * scroll in sync. Hover on the AICL pipeline view outlines the same token
 * here (data-tok hooks).
 */
function renderHighlight(cursorTok) {
  const text = elInput.value;
  if (!elToggleHeatmap.checked || !lastData || !lastData.pipeline.rawToAicl || !text) {
    elHighlight.innerHTML = esc(text) + '\n';
    return;
  }
  const { rawToAicl, tokenMap } = lastData.pipeline;
  const chars = [...text];
  const total = tokenMap.length ? Math.max(...tokenMap) + 1 : 0;
  let html = '';
  for (let i = 0; i < chars.length; i++) {
    const aiclIdx = rawToAicl[i];
    const tokIdx = aiclIdx >= 0 && aiclIdx < tokenMap.length ? tokenMap[aiclIdx] : -1;
    if (tokIdx < 0) { html += esc(chars[i]); continue; }
    const cls = tokIdx === cursorTok ? ' class="ht curr"' : ' class="ht"';
    html += `<span${cls} data-tok="${tokIdx}" style="${tokenBg(tokIdx)}" title="token ${tokIdx + 1} of ${total}">${esc(chars[i])}</span>`;
  }
  elHighlight.innerHTML = html + '\n';
}

// keep overlay aligned while scrolling
elInput.addEventListener('scroll', () => {
  if (hlScrollSync) return;
  hlScrollSync = true;
  elHighlight.scrollTop = elInput.scrollTop;
  elHighlight.scrollLeft = elInput.scrollLeft;
  hlScrollSync = false;
});

// --- Pipeline views ---
function tokenColoredSpans(aicl, tokenMap) {
  if (!aicl || !tokenMap || !tokenMap.length) return esc(aicl || '—');
  const chars = [...aicl];
  const total = Math.max(...tokenMap) + 1;
  return chars.map((ch, i) => {
    const tokIdx = tokenMap[i];
    return `<span class="tok" data-tok="${tokIdx}" style="${tokenBg(tokIdx)}" title="token ${tokIdx + 1} of ${total}">${esc(ch)}</span>`;
  }).join('');
}

// hover a token in the pipeline → outline the same token in the input box
document.addEventListener('mouseover', e => {
  const t = e.target.closest?.('[data-tok]');
  if (!t || !elToggleHeatmap.checked) return;
  renderHighlight(Number(t.dataset.tok));
});
document.addEventListener('mouseout', e => {
  if (e.target.closest?.('[data-tok]')) renderHighlight();
});

function render(data) {
  const { stats, compare, pipeline, vocab, timings } = data;

  elKpiRaw.textContent = String(stats.rawChars);
  elKpiAicl.textContent = String(stats.aiclChars);
  elKpiStage1.textContent = `${stats.stage1x}× stage 1`;
  elKpiTokens.textContent = String(stats.aiclTokens);
  elKpiStage2.textContent = `${stats.stage2x}× stage 2 · ${stats.aiclTokens ? (stats.aiclChars / stats.aiclTokens).toFixed(1) : '—'} PUA/token`;
  elKpiWin.textContent = stats.winVsGpt4o ? `${stats.winVsGpt4o}×` : '—';
  elKpiWin.style.color = stats.winVsGpt4o >= 1.2 ? '#10b981' : stats.winVsGpt4o >= 1 ? '#a3e635' : '#9ca3af';
  elKpiSave.textContent = stats.winVsGpt4o ? `${stats.savePct}% vs GPT-4o` : 'no savings';

  if (timings) {
    elPerfSection.style.display = '';
    elPerfStage1.textContent = timings.encodeMs != null ? `${timings.encodeMs.toFixed(1)}ms` : '—';
    elPerfStage2.textContent = timings.tokenizeMs != null ? `${timings.tokenizeMs.toFixed(1)}ms` : '—';
    elPerfTotal.textContent = timings.totalMs != null ? `${timings.totalMs.toFixed(1)}ms` : '—';
  }

  // AICL output — token-colored or hex
  elPipeAiclWrap.innerHTML = elToggleHex.checked
    ? `<pre class="pipe-pre mono">${[...pipeline.aicl].map(c => `${esc(c)} ${hexOf(c)}`).join('  ')}</pre>`
    : `<pre class="pipe-pre mono">${tokenColoredSpans(pipeline.aicl, pipeline.tokenMap)}</pre>`;
  elPipeAiclMeta.textContent = `${pipeline.aiclLen} PUA chars · ${pipeline.matches} matches · ${pipeline.literals} literals`;

  // Tokens
  const ids = pipeline.tokenIds;
  elPipeTokens.textContent = ids.length ? (elToggleHex.checked ? ids.join(' ') : `${ids.slice(0, 120).join(' ')}${ids.length > 120 ? ' …' : ''}`) : '—';
  elPipeTokensMeta.textContent = `${ids.length} tokens · vocab ${vocab.merges} merges · max ${vocab.maxTokenLength} PUA/token`;
  elPipeSummaryMeta.textContent = `· ${pipeline.aiclLen} PUA → ${ids.length} tokens`;

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
  const best = Math.min(...rows.map(r => r[1]));
  elBars.innerHTML = rows.map(([label, val, cls]) => {
    const w = Math.max(6, Math.round(val / max * 100));
    const star = label === 'AICL' && val === best ? ' ★' : '';
    return `<div class="bar-row"><div class="bar-label">${label}${star}</div><div class="bar-track"><div class="bar-fill ${cls}" style="width:${w}%"></div></div><div class="bar-value">${val}</div></div>`;
  }).join('');

  // Steps
  if (elToggleSteps.checked && pipeline.steps) {
    elStepsMeta.textContent = `${pipeline.steps.length} steps`;
    elSteps.innerHTML = pipeline.steps.slice(0, 260).map(s => {
      if (s.type === 'match') return `<div class="step"><b>match</b> ${esc(s.pattern)}${elToggleHex.checked && s.symbol ? ` → <em>${hexOf(s.symbol)}</em>` : ''} @${s.pos}</div>`;
      if (s.type === 'base') return `<div class="step"><b>base</b> ${esc(s.pattern)} @${s.pos}</div>`;
      if (s.type === 'modifier') return `<div class="step"><b>modifier</b> ${esc(s.name)} @${s.pos}</div>`;
      if (s.type === 'fragment') return `<div class="step"><b>fragment</b> ${esc(s.pattern)} @${s.pos}</div>`;
      if (s.type === 'literal') return `<div class="step lit"><b>literal</b> ${esc(s.char)} @${s.pos}</div>`;
      return `<div class="step">${esc(JSON.stringify(s))}</div>`;
    }).join('') + (pipeline.steps.length > 260 ? `<div class="muted small">… ${pipeline.steps.length - 260} more steps</div>` : '');
  } else {
    elStepsMeta.textContent = elToggleSteps.checked ? 'no steps' : '';
    elSteps.innerHTML = '';
  }

  renderHighlight();
}

// --- Events ---
elInput.addEventListener('input', schedule);
elExample.addEventListener('change', () => { const v = elExample.value; if (EXAMPLES[v]) { elInput.value = EXAMPLES[v]; schedule(); } });
elClear.addEventListener('click', () => { elInput.value = ''; elExample.value = ''; schedule(); elInput.focus(); });
elToggleSteps.addEventListener('change', () => run());
elToggleHex.addEventListener('change', () => { if (lastData) render(lastData); });
elToggleHeatmap.addEventListener('change', () => { renderHighlight(); if (lastData) render(lastData); });

// Keyboard shortcut
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); }
});

// --- Dynamic vocab specs (never stale: read from the loaded vocab via server) ---
async function loadSpecs() {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) return;
    const v = await res.json();
    const el = document.getElementById('specSubtitle');
    if (el) el.textContent = `2–${v.maxTokenLength} PUA → 1 token · 51k dict · ${v.merges} merges — live encode & tokenize`;
    const foot = document.getElementById('specFooter');
    if (foot) foot.textContent = `${v.merges} merges · max ${v.maxTokenLength} PUA/token · 51k dict · strictly local — no data leaves your machine.`;
  } catch { /* offline — static text stays */ }
}
loadSpecs();

// Init: load from URL hash or default
const fromHash = loadFromHash();
if (fromHash) {
  elInput.value = fromHash;
} else {
  elInput.value = EXAMPLES.prompt;
}
schedule();
