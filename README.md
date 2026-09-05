<div align="center">

# AICL — AI Compression Language

**2–14 PUA → 1 token · 51k dictionary · Up to 10.4× fewer tokens than GPT-4o**

*Compress English, code and structured text for cheaper, faster LLM inference.*

[![Tests](https://img.shields.io/badge/tests-131%2F131_passing-brightgreen)](#test-suite)
[![License](https://img.shields.io/badge/license-MIT-black)](#license)
[![Tokenizer](https://img.shields.io/badge/tokenizer-BPE_2--14_PUA-blue)](#aicltokenizer)
[![Merges](https://img.shields.io/badge/merges-8192-informational)](#aicltokenizer)
[![Stage1](https://img.shields.io/badge/Stage1-2.87x-black)](#benchmarks)

```
Raw English → [AICL Encoder: PUA] → AICL Text → [AICLTokenizer: BPE] → Tokens → LLM
              2.87× Stage 1 · 8.75× Stage 2 · 8/8 wins vs GPT-4o
```

</div>

---

<div align="center">
  <img src="assets/benchmark.png" width="820" alt="AICL vs GPT-4o — tokens lower is better, 8 tests"/>
  <br/>
  <sub>GPT-4o vs AICL · 8/8 wins · AICLTokenizer</sub>
</div>

<div align="center">
  <img src="assets/benchmark-all.png" width="820" alt="AICL vs GPT-3/4/4o/5 + LLaMA 2 + AICL"/>
  <br/>
  <sub>6 tokenizers · GPT-3 · GPT-4 · GPT-4o · GPT-5 · LLaMA 2 · <b>AICL</b></sub>
</div>

---

## Benchmarks

### vs GPT-4o (`o200k_base`) — tokens, lower is better · `npm run benchmark`

| Test | Raw | GPT-4o | AICL | Win |
|---|---:|---:|---:|---:|
| **API response** | 193 | 73 | **7** | **10.43×** |
| **Shell** | 258 | 83 | **9** | **9.22×** |
| **Code const/let** | 140 | 36 | **4** | **9.00×** |
| **Paths/URLs** | 235 | 72 | **8** | **9.00×** |
| **Prompt** | 61 | 15 | **2** | **7.50×** |
| **Markdown** | 168 | 43 | **6** | **7.17×** |
| **SQL** | 272 | 73 | **12** | **6.08×** |
| **Common English** | 154 | 32 | **11** | **2.91×** |
| **Total** | 1481 | 427 | **59** | **7.24×** |

> AICL wins **8/8** — and beats GPT-3/4/4o/5 *and* LLaMA 2 on every test. 8192 BPE merges, `maxTokenLength: 14`. Total pipeline: 25.1× (Stage 1: 2.87×, Stage 2: 8.75×). Held-out generalization probe (12 unseen texts): 1.16× vs GPT-4o. LLaMA 2 and GPT-3/4/5 included in `benchmark-all`.

### Stage 1 — Dictionary Encoder (PUA, `node test_corpus.mjs`)

| Text Type | Ratio | Example |
|---|---:|---|
| Code const/let | **4.24×** | `const app = express(); app.get(...)` |
| Git/CLI | **3.81×** | `git diff --stat && npm test` |
| Common English | **3.08×** | Natural language |
| Markdown | **3.07×** | Headers, lists |
| Markdown full | **2.90×** | Docs + code blocks |
| Shell | **2.74×** | Terminal cmds |
| SQL | **2.75×** | `SELECT * FROM users…` |
| Paths/URLs | **2.73×** | `https://…`, `~/.config/…` |
| API response | **2.47×** | JSON |
| **Overall (19 tests)** | **2.14×** | 3577 → 1673 chars, all lossless |

> `>1× = win`. Random alphanumeric: ~1.33× (entropy limit). Every result is `decode(encode(x)) === x`.

---

## Quick Start

```bash
git clone https://github.com/vspcoderz/aicl && cd aicl
npm install

# Generate dictionaries (48k English + 2k code + 1k symbols)
npm run generate

# Encode / Decode
node src/cli.js encode "the quick brown fox jumps over the lazy dog"
node src/cli.js decode "<AICL output>"

# Playground (browser)
npm run playground        # → http://localhost:8787 — live encode, tokenize, compare vs GPT-4o/LLaMA

# Tests & benchmarks
npm test                  # 131/131 passing
npm run test:corpus       # 19 tests · 2.14× Stage 1, all lossless
npm run benchmark         # 8 tests vs GPT-3/4/4o/5 + LLaMA + AICL → assets/*.svg → *.png
npm run corpus            # rebuild 818k training corpus
```

## How It Works

### Stage 1 — Dictionary Encoder (PUA)

Maps patterns → single Unicode PUA symbols. Trie-accelerated, 3-tier greedy:

1. **Longest match** via trie `O(maxLen)` per position
2. **Word fallback** when `bestLen === 1` → whole-word lookup (`test.` → `base("test")` + `MOD_CAPS` + `MOD_TRAIL_PERIOD`) → fragments (`th`, `ing`, `tion`, `a0–z9`)
3. **Literal** (prefix with `U+E000` if input already contains PUA)

Dictionary:

- **48,723 English** — frequency-sorted + single letters + fragments
- **2,048 Code** — `console.log(`, `SELECT *`, `async`, `=>`, …
- **1,081 Phrases/Markdown/Symbols** — `# `, `**`, `"name"`, common phrases
- **17 Modifiers** — `MOD_CAPS`, `MOD_TRAIL_SPACE`, etc.
- **530+ Fragments** — `th`, `ing`, `tion`, `src`, `a0–z9`

### Stage 2 — AICLTokenizer (BPE on PUA)

Custom BPE **on PUA, not English** — 1 PUA ≈ 4.5 English chars, 1 token = 2–14 PUA = **up to 60+ chars/token**.

- `maxTokenLength: 14`, 8192 merges on a ~1.9M-char blended PUA corpus (`corpus/bpe_train_blend.txt`)
- Trained with the incremental trainer (`scripts/train_fast.mjs`) — identical merges to the reference trainer, ~8× faster
- Pair keys `"a:b"` (no int overflow on supplementary PUA)
- Retrain: `node scripts/retrain_final.mjs` · sweep configs: `node scripts/sweep_fast.mjs` (reports benchmark **and** held-out wins)

---

## API

```javascript
import { encode, decode } from './src/index.js';
import { tokenize, detokenize, loadTokenizer } from './src/tokenizer/index.js';

// Stage 1: Dictionary
const aicl = encode("the quick brown fox"); // 19 → 2 PUA, 9.5×
decode(aicl.output).output === "the quick brown fox" // true

// Stage 2: Tokenizer
const vocab = loadTokenizer(); // 8192 merges
const toks = tokenize(aicl.output, vocab);
detokenize(toks, vocab) === aicl.output // true

// Full pipeline
const raw = "aicl is Goated BTW, and this can reduce tokens very vary fast";
const tokens = tokenize(encode(raw).output, vocab); // 61 → 2 tokens, 7.50× vs GPT-4o
```

## CLI

```bash
node src/cli.js encode "text"     # Text → AICL (sanitized: strips C0 controls except \t\n\r)
node src/cli.js decode "<AICL>"   # AICL → Text (sanitized)
node src/cli.js stats "text"      # Raw → AICL → Tokens stats
node src/cli.js tok "<AICL>"      # AICL → Tokens
node src/cli.js visual "text"     # Step-by-step
```

## Playground

Live browser playground — type anything and see the full pipeline instantly:

```bash
npm run playground        # http://localhost:8787  (PORT=8787)
# or
PORT=3000 npm run playground
```

- Input → Stage 1 (PUA) → Stage 2 (tokens) with win vs GPT-4o + bar chart vs GPT-3/4/4o/5 + LLaMA 2
- **Sanitized everywhere:** `encode`/`decode`/`tokenize` validate type + 1M char cap and strip unsafe controls (NUL, lone surrogates); `decode` round-trips losslessly for valid text. Playground `POST /api/tokenize` caps at 2 MB + 1M chars and sanitizes before encoding. Pass `allowUnsafe: true` to bypass (advanced).
- Static files served safely (no `..` traversal).

## Unicode Ranges

| Dictionary | Range | Count |
|---|---|---:|
| English | `U+E001–U+F8FF` + `U+100900–U+10FFFF` | 48,723 |
| Code | `U+F0000–U+F07FF` | 2,048 |
| Phrases/Symbols | `U+F0800–U+F0FFF` + `U+100000–U+1007FF` | 1,081 |
| Modifiers | `U+100800–U+1008FF` | 17 |
| Escape | `U+E000` | Reserved |

## Test Suite

```bash
npm test              # 131/131 passing
npm run test:corpus   # 19 tests · 2.14× Stage 1, all lossless
npm run benchmark     # regenerate assets/benchmark.svg + benchmark-all.svg → .png
```

## Assets

```
assets/
  benchmark.png      # GPT-4o vs AICL — 8 tests, minimal dark
  benchmark.svg
  benchmark-all.png  # GPT-3/4/4o/5 + LLaMA 2 + AICL
  benchmark-all.svg
playground/
  index.html         # UI
  style.css          # minimal dark theme
  app.js             # client (talks to /api/tokenize)
  server.mjs         # Node http server + sanitized API
```

## License

MIT — github.com/vspcoderz/aicl
