// AICL Playground (GitHub Pages) — 100% client-side.
// Uses the same encoder/decoder/tokenizer as the library, bundled into
// ./aicl.js by scripts/build_docs.mjs. Dictionary JSONs + vocab are fetched
// relative to docs/ and primed into the ( normally fs-backed ) dict loader.
import { primeDict, encode, decode, tokenize, detokenize, makeVocab, cpToId } from './aicl.js';

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
const elToast = $('toast');
const elShare = $('share');
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
  caps: 'LOL BRO WE GETTING LIKE LOTS OF FASTER SHIT THIS IS WHERE WE CAN LIKE LOSE TO GPT SHIT\n## ANNOUNCEMENT\n> THAT WE ARE NOT SAOASDH AJB AND YOUR THW WORSE SHIT WE CAN DO LIKE ATLEAST WE BEATING LLaMA 2 stuff',
  ascii: 'Verified ✅\n\n┌──────────────┐\n│ Settings     │\n├──────────────┤\n│  Description │\n│  Support     │\n│   Privacy    │\n│    Terms     │\n│   Images     │\n│  Install     │\n└──────────────┘\n\n----\n== Section ==\n**bold** and __under__\n    indented code\n        deeper indent',
  prompt: 'aicl is Goated BTW, and this can reduce tokens very vary fast',
  huge: 'the quick brown fox jumps over the lazy dog this is a test of the emergency broadcast system how now brown cow the rain in spain stays mainly on the plain we are testing the aicl compression algorithm which should compress english text into unicode private use area symbols and then tokenize those symbols with bpe to produce fewer tokens than gpt-4o would use for the same text the goal is to reduce api costs and improve inference speed when sending prompts to large language models the encoder uses a dictionary of fifty one thousand entries including words code patterns and common phrases each entry maps to a unicode character in the private use area the tokenizer then merges these symbols using byte pair encoding to create multi-symbol tokens which further reduces the token count',
};

let vocab = null;
let lastData = null;
let debounce = null;

function words(s) { const t = s.trim(); return t ? t.split(/\s+/).length : 0; }
function hexOf(ch) { return 'U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0'); }
function esc(s) { return String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'); }

function toast(msg, ms = 1800) {
  elToast.textContent = msg;
  elToast.classList.add('show');
  setTimeout(() => elToast.classList.remove('show'), ms);
}

async function copyText(text, label) {
  try { await navigator.clipboard.writeText(text); toast(`Copied ${label}`); }
  catch { toast('Copy failed'); }
}

function loadFromHash() {
  try { const h = location.hash.slice(1); return h ? decodeURIComponent(atob(h)) : null; } catch { return null; }
}
function saveToHash(text) {
  try { history.replaceState(null, '', '#' + btoa(encodeURIComponent(text))); } catch {}
}

elShare.addEventListener('click', () => {
  const text = elInput.value;
  if (!text) { toast('Nothing to share'); return; }
  saveToHash(text);
  copyText(location.href, 'share URL');
});

elCopyAicl.addEventListener('click', () => { if (lastData) copyText(lastData.pipeline.aicl, 'AICL output'); });
elCopyTokens.addEventListener('click', () => { if (lastData) copyText(lastData.pipeline.tokenIds.join(' '), 'token IDs'); });
elCopyAll.addEventListener('click', () => {
  if (!lastData) return;
  const d = lastData;
  copyText([
    `=== AICL Pipeline ===`, ``,
    `--- Raw (${d.stats.rawChars} chars) ---`, elInput.value, ``,
    `--- AICL (${d.stats.aiclChars} PUA) ---`, d.pipeline.aicl, ``,
    `--- Token IDs (${d.stats.aiclTokens} tokens) ---`, d.pipeline.tokenIds.join(' '), ``,
    `--- Stats ---`,
    `Stage 1: ${d.stats.stage1x}× · Stage 2: ${d.stats.stage2x}×`,
    `Roundtrip: ${d.pipeline.roundtripOk ? 'OK' : 'FAILED'}`,
  ].join('\n'), 'pipeline');
});

function schedule() {
  clearTimeout(debounce);
  elStatus.textContent = 'typing…';
  renderHighlight();
  debounce = setTimeout(run, 120);
}

function run() {
  const text = elInput.value;
  elCharCount.textContent = `${[...text].length} chars · ${words(text)} words`;
  if (!text || !vocab) {
    elStatus.textContent = vocab ? 'waiting…' : 'loading dict…';
    elKpiRaw.textContent = '—'; elKpiAicl.textContent = '—'; elKpiTokens.textContent = '—';
    elKpiStage1.textContent = ''; elKpiStage2.textContent = ''; elKpiWin.textContent = '—'; elKpiSave.textContent = '';
    elBars.innerHTML = ''; elPipeAiclWrap.innerHTML = '<pre class="pipe-pre mono">—</pre>'; elPipeAiclMeta.textContent = '';
    elPipeTokens.textContent = '—'; elPipeTokensMeta.textContent = '';
    elRoundtrip.textContent = vocab ? 'Type something to see the pipeline.' : 'Loading dictionary + vocab…';
    elRoundtrip.className = 'roundtrip';
    elSteps.innerHTML = ''; elStepsMeta.textContent = '';
    elPerfSection.style.display = 'none';
    lastData = null;
    renderHighlight();
    return;
  }

  const t0 = performance.now();
  try {
    const t1 = performance.now();
    const enc = encode(text, { steps: elToggleSteps.checked, trackMapping: true });
    const t2 = performance.now();
    const ids = tokenize(enc.output, vocab);
    const t3 = performance.now();
    const roundtripOk = decode(enc.output).output === text;

    const chars = [...text].length;
    const aiclChars = [...enc.output].length;
    const data = {
      stats: {
        rawChars: chars, aiclChars, aiclTokens: ids.length,
        stage1x: aiclChars ? +(chars / aiclChars).toFixed(2) : 0,
        stage2x: aiclChars ? +(aiclChars / ids.length).toFixed(2) : 0,
      },
      pipeline: {
        aicl: enc.output, aiclLen: aiclChars, tokenIds: ids,
        rawToAicl: enc.rawToAicl, roundtripOk,
        tokenMap: computeTokenMap(enc.output),
        matches: enc.matches, literals: enc.literals,
        steps: (enc.steps || []).slice(0, 400),
      },
      vocab: { merges: vocab.numMerges, maxTokenLength: vocab.maxTokenLength },
      timings: { encodeMs: t2 - t1, tokenizeMs: t3 - t2, totalMs: t3 - t0 },
    };
    lastData = data;
    render(data);
    elStatus.textContent = `done · ${data.timings.totalMs.toFixed(0)}ms · ${vocab.numMerges} rules`;
  } catch (e) {
    elStatus.textContent = 'error';
    elRoundtrip.textContent = String(e && e.message || e);
    elRoundtrip.className = 'roundtrip bad';
  }
}

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

function renderHighlight(cursorTok) {
  const text = elInput.value;
  if (!elToggleHeatmap.checked || !lastData || !lastData.pipeline.rawToAicl || !text) {
    elHighlight.innerHTML = esc(text) + '\n';
    return;
  }
  const { rawToAicl, tokenMap } = lastData.pipeline;
  if (!tokenMap) { elHighlight.innerHTML = esc(text) + '\n'; return; }
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

elInput.addEventListener('scroll', () => {
  elHighlight.scrollTop = elInput.scrollTop;
  elHighlight.scrollLeft = elInput.scrollLeft;
});

// char→token map, mirroring the BPE merge loop (same as server version)
function computeTokenMap(aiclText) {
  const chars = [...aiclText];
  const n = chars.length;
  if (n === 0) return [];
  let slots = chars.map((_, i) => [i]);
  let ids = chars.map(ch => cpToId(ch));
  const pairIndex = new Map();
  for (const [mergedId, rule] of vocab.merges) {
    const key = rule.a + ':' + rule.b;
    const existing = pairIndex.get(key);
    if (!existing || rule.rank < existing.rank) pairIndex.set(key, { rank: rule.rank, mergedId, a: rule.a, b: rule.b });
  }
  while (true) {
    let bestRank = Infinity, bestRule = null;
    for (let i = 0; i < ids.length - 1; i++) {
      const rule = pairIndex.get(ids[i] + ':' + ids[i + 1]);
      if (rule && rule.rank < bestRank) { bestRank = rule.rank; bestRule = rule; if (bestRank === 0) break; }
    }
    if (!bestRule) break;
    const nextIds = [], nextSlots = [];
    for (let i = 0; i < ids.length; i++) {
      if (i < ids.length - 1 && ids[i] === bestRule.a && ids[i + 1] === bestRule.b) {
        nextIds.push(bestRule.mergedId);
        nextSlots.push([...slots[i], ...slots[i + 1]]);
        i++;
      } else { nextIds.push(ids[i]); nextSlots.push(slots[i]); }
    }
    ids = nextIds; slots = nextSlots;
  }
  const tokenMap = new Array(n);
  for (let tokIdx = 0; tokIdx < slots.length; tokIdx++) for (const charPos of slots[tokIdx]) tokenMap[charPos] = tokIdx;
  return tokenMap;
}

document.addEventListener('mouseover', e => {
  const t = e.target.closest?.('[data-tok]');
  if (!t || !elToggleHeatmap.checked) return;
  renderHighlight(Number(t.dataset.tok));
});
document.addEventListener('mouseout', e => {
  if (e.target.closest?.('[data-tok]')) renderHighlight();
});

function tokenColoredSpans(aicl, tokenMap) {
  if (!aicl || !tokenMap || !tokenMap.length) return esc(aicl || '—');
  const chars = [...aicl];
  const total = Math.max(...tokenMap) + 1;
  return chars.map((ch, i) => {
    const tokIdx = tokenMap[i];
    return `<span class="tok" data-tok="${tokIdx}" style="${tokenBg(tokIdx)}" title="token ${tokIdx + 1} of ${total}">${esc(ch)}</span>`;
  }).join('');
}

function render(data) {
  const { stats, pipeline, vocab: v, timings } = data;

  elKpiRaw.textContent = String(stats.rawChars);
  elKpiAicl.textContent = String(stats.aiclChars);
  elKpiStage1.textContent = `${stats.stage1x}× stage 1`;
  elKpiTokens.textContent = String(stats.aiclTokens);
  elKpiStage2.textContent = `${stats.stage2x}× stage 2 · ${stats.aiclTokens ? (stats.aiclChars / stats.aiclTokens).toFixed(1) : '—'} PUA/token`;
  // GPT-4o comparison: approximate with chars/4 heuristic, clearly labeled
  const gpt4oApprox = Math.max(1, Math.round(stats.rawChars / 4));
  const win = gpt4oApprox / stats.aiclTokens;
  elKpiWin.textContent = `~${win.toFixed(2)}×`;
  elKpiWin.style.color = win >= 1.2 ? '#10b981' : win >= 1 ? '#a3e635' : '#9ca3af';
  elKpiSave.textContent = `~vs GPT-4o (chars/4 est.)`;

  if (timings) {
    elPerfSection.style.display = '';
    elPerfStage1.textContent = `${timings.encodeMs.toFixed(1)}ms`;
    elPerfStage2.textContent = `${timings.tokenizeMs.toFixed(1)}ms`;
    elPerfTotal.textContent = `${timings.totalMs.toFixed(1)}ms`;
  }

  elPipeAiclWrap.innerHTML = elToggleHex.checked
    ? `<pre class="pipe-pre mono">${[...pipeline.aicl].map(c => `${esc(c)} ${hexOf(c)}`).join('  ')}</pre>`
    : `<pre class="pipe-pre mono">${tokenColoredSpans(pipeline.aicl, pipeline.tokenMap)}</pre>`;
  elPipeAiclMeta.textContent = `${pipeline.aiclLen} PUA chars · ${pipeline.matches} matches · ${pipeline.literals} literals`;

  const ids = pipeline.tokenIds;
  elPipeTokens.textContent = ids.length ? (elToggleHex.checked ? ids.join(' ') : `${ids.slice(0, 120).join(' ')}${ids.length > 120 ? ' …' : ''}`) : '—';
  elPipeTokensMeta.textContent = `${ids.length} tokens · vocab ${v.merges} rules · max ${v.maxTokenLength} PUA/token`;
  elPipeSummaryMeta.textContent = `· ${pipeline.aiclLen} PUA → ${ids.length} tokens`;

  elRoundtrip.textContent = pipeline.roundtripOk ? `✓ Roundtrip OK — decode(encode(x)) === x` : `✗ Roundtrip FAILED`;
  elRoundtrip.className = pipeline.roundtripOk ? 'roundtrip ok' : 'roundtrip bad';

  // bars: AICL tokens vs raw-char estimate baselines
  const rows = [
    ['Raw ÷ 4', Math.max(1, Math.round(stats.rawChars / 4)), 'gpt4o'],
    ['Raw ÷ 3', Math.max(1, Math.round(stats.rawChars / 3)), 'llama'],
    ['AICL', stats.aiclTokens, 'aicl'],
  ];
  const max = Math.max(...rows.map(r => r[1]), 1);
  elBars.innerHTML = rows.map(([label, val, cls]) => {
    const w = Math.max(6, Math.round(val / max * 100));
    const star = label === 'AICL' && val === Math.min(...rows.map(r => r[1])) ? ' ★' : '';
    return `<div class="bar-row"><div class="bar-label">${label}${star}</div><div class="bar-track"><div class="bar-fill ${cls}" style="width:${w}%"></div></div><div class="bar-value">${val}</div></div>`;
  }).join('');

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

elInput.addEventListener('input', schedule);
elExample.addEventListener('change', () => { const v = elExample.value; if (EXAMPLES[v]) { elInput.value = EXAMPLES[v]; schedule(); } });
elClear.addEventListener('click', () => { elInput.value = ''; elExample.value = ''; schedule(); elInput.focus(); });
elToggleSteps.addEventListener('change', () => run());
elToggleHex.addEventListener('change', () => { if (lastData) render(lastData); });
elToggleHeatmap.addEventListener('change', () => { renderHighlight(); if (lastData) render(lastData); });

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); }
});

// --- boot: fetch dict + vocab, prime the fs-free dict loader ---
(async () => {
  try {
    const [english, code, symbols, modifiers, vocabRaw] = await Promise.all([
      'dict/english.json', 'dict/code.json', 'dict/symbols.json', 'dict/modifiers.json', 'tokenizer/vocab.json',
    ].map(u => fetch(u).then(r => { if (!r.ok) throw new Error(u + ' → ' + r.status); return r.json(); })));
    primeDict({ english, code, symbols, modifiers });
    vocab = makeVocab(vocabRaw);
    const sub = document.getElementById('specSubtitle');
    if (sub) sub.textContent = `2–${vocab.maxTokenLength} PUA → 1 token · 96k dict · ${vocab.numMerges} rules — runs in your browser`;
    const foot = document.getElementById('specFooter');
    if (foot) foot.textContent = `${vocab.numMerges} rules · max ${vocab.maxTokenLength} PUA/token · 96k dict · 100% client-side — no data leaves your browser.`;
    elStatus.textContent = 'ready';
    run();
  } catch (e) {
    elStatus.textContent = 'load failed';
    elRoundtrip.textContent = 'Failed to load dict/vocab: ' + (e && e.message || e);
    elRoundtrip.className = 'roundtrip bad';
  }
})();

const fromHash = loadFromHash();
if (fromHash) elInput.value = fromHash;
else elInput.value = EXAMPLES.prompt;
schedule();
