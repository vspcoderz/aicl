<div align="center">

# ◈ AICL — AI Compression Language

**A lossless text tokenizer that beats GPT-4o on every domain — English, code, SQL, markdown, ALL-CAPS, even text it has never seen.**

[![Tests](https://img.shields.io/badge/tests-131%2F131_passing-brightgreen)](#-test-suite)
[![License](https://img.shields.io/badge/license-MIT-black)](#license)
[![Vocab](https://img.shields.io/badge/vocab-117,298_rules-blue)](#-how-it-works)
[![Pages](https://img.shields.io/badge/playground-live_on_GitHub_Pages-8A2BE2)](https://vspcoderz.github.io/aicl/)

**[▶ Open the live playground](https://vspcoderz.github.io/aicl/)** — runs 100% in your browser, nothing leaves your machine.

</div>

---

<div align="center">
  <img src="assets/benchmark.png" width="820" alt="AICL vs GPT-4o — tokens lower is better, 8 tests"/>
</div>

<div align="center">
  <img src="assets/benchmark-all.png" width="820" alt="AICL vs GPT-3/4/4o/5 + LLaMA 2 + AICL"/>
</div>

---

## 📊 Benchmarks

### vs GPT-4o (`o200k_base`) — tokens, lower is better · `npm run benchmark`

| Test | Raw | GPT-4o | AICL | Win |
|---|---:|---:|---:|---:|
| **API response** | 193 | 73 | **37** | **1.97×** |
| **Code const/let** | 140 | 36 | **20** | **1.80×** |
| **SQL** | 272 | 73 | **48** | **1.52×** |
| **Paths/URLs** | 235 | 72 | **51** | **1.41×** |
| **Markdown** | 168 | 43 | **32** | **1.34×** |
| **Shell** | 258 | 83 | **66** | **1.26×** |
| **Common English** | 154 | 32 | **27** | **1.19×** |
| **Prompt** | 61 | 15 | **13** | **1.15×** |
| **Total** | 1481 | 427 | **294** | **1.45×** |

> Total pipeline: **5.04×** (Stage 1 dictionary: 2.91×, Stage 2 BPE: 1.73×). Every result is lossless — `decode(encode(x)) === x`.

### 🎯 The number that matters: *unseen* text

Benchmarks mean nothing if the tokenizer memorized them. Below, **none** of the text was in training — 600 lines pulled from a 12.6M-line corpus the tokenizer never saw, plus 50 handcrafted probes:

| Eval set | vs GPT-4o | Lossless |
|---|---:|:---:|
| **Unseen English prose** (150 real corpus lines) | **1.34×** | ✅ |
| **Unseen markdown** (150 lines) | **1.29×** | ✅ |
| **Unseen code** (150 lines) | **1.29×** | ✅ |
| **Unseen SQL** (150 lines) | **1.27×** | ✅ |
| Held-out 50 probes (8 domains) | **1.20×** | ✅ |
| ALL-CAPS rant (playground stress test) | **1.24×** | ✅ |

> Evaluate it yourself: `node scripts/eval_all.mjs` — 658 texts, structural sanity check, per-domain breakdown.

---

## 🚀 Quick Start

```bash
git clone https://github.com/vspcoderz/aicl && cd aicl
npm install

# Encode / decode from the CLI
node src/cli.js encode "the quick brown fox jumps over the lazy dog"
node src/cli.js decode "<AICL output>"
node src/cli.js stats "SELECT * FROM users WHERE id = 42"

# Local playground (server-backed, with GPT/LLaMA comparison)
npm run playground        # → http://localhost:8787

# Tests & benchmarks
npm test                  # 131/131 passing
npm run test:corpus       # 19 tests · 2.91× Stage 1, all lossless
npm run benchmark         # regenerate assets/*.svg → *.png
node scripts/eval_all.mjs # full acceptance eval (bench + held-out + unseen)
```

### As a library

```javascript
import { encode, decode } from './src/index.js';
import { tokenize, detokenize, loadTokenizer } from './src/tokenizer/index.js';

const aicl = encode("SELECT * FROM users WHERE id = 42");   // 36 → 13 PUA symbols
const vocab = loadTokenizer();                               // 117,298 rules
const tokens = tokenize(aicl.output, vocab);                 // → 7 tokens

decode(aicl.output).output === "SELECT * FROM users WHERE id = 42"; // true
detokenize(tokens, vocab) === aicl.output;                          // true
```

---

## 🧠 How It Works

Two stages, both lossless:

### Stage 1 — Dictionary Encoder (Unicode PUA)

Maps patterns → single Private Use Area symbols via a trie with greedy longest-match:

- **96k word symbols** — 48.7k English words **+ 47.3k uppercase variants** (`hello` → `hello`-symbol, `HELLO` → `HELLO`-symbol), so capitalized and ALL-CAPS text costs the same as lowercase
- **2k code patterns** — `console.log(`, `SELECT *`, `=>`, …
- **1.1k symbols & runs** — markdown (`##`, `**`), whitespace runs (2–16 spaces), box-drawing (`─`, `│`, `┌`)
- **18 modifiers** — `MOD_CAPS`, `MOD_ALLCAPS`, trailing punctuation, leading brackets

Unseen words fall back to sub-word fragments (`tion`, `ing`, `th`, …) — never bigger than the raw text.

### Stage 2 — BPE over PUA symbols

Custom byte-pair-encoding **on PUA ids, not English characters**, trained on a 2.1M-line / 87M-symbol corpus (FineWeb English + CodeSearchNet + SQL + markdown):

- **54k alias rules** — every (word, space-form) pair is deterministically fused, so *any* word — seen or unseen — compresses `word␣` into one token
- **30k caps aliases** — `(word, MOD_CAPS/ALLCAPS, space)` triples fuse the same way: capitalized text costs what lowercase costs
- **33k learned merges** — frequent collocations chain on top of the alias tokens
- `maxTokenLength: 14` → one token can carry 60+ raw characters

The alias mechanism is the key to generalization: pair-keyed BPE can only ever cover `#merges` word+space combos; the alias table covers **all of them**, and the learned merges spend their budget on collocations instead of re-learning word boundaries.

---

## 🎮 Playground

| | |
|---|---|
| **[Live on GitHub Pages](https://vspcoderz.github.io/aicl/)** | 100% client-side — the encoder, dictionary and vocab load in your browser; no server, no telemetry |
| **Local (`npm run playground`)** | Full version: token heatmap, pipeline views, live bars vs GPT-3/4/4o/5 + LLaMA 2, step-by-step encoder trace |

Both versions show per-token colors inside the input box as you type.

<details>
<summary><b>Run the Pages demo from this repo</b></summary>

GitHub Pages serves this repo's `/docs` folder, which imports `../src/encoder.js` and fetches `../dict/*.json` + `../tokenizer/vocab.json` directly from the repo — no build step.

To enable it: **Settings → Pages → Deploy from a branch → `main` → `/docs`**. Done.
</details>

---

## 📁 Layout

```
src/               encoder, decoder, tokenizer, unicode sanitizing, CLI
dict/              english + code + symbols + modifiers (pattern → PUA symbol)
tokenizer/         vocab.json — 117,298 rules (alias + learned BPE merges)
corpus/            small local training corpus
scripts/           trainer (train_fast.mjs), evals, benchmark, corpus tools
playground/        server-backed playground (npm run playground)
docs/              static client-side playground for GitHub Pages
assets/            benchmark charts (SVG/PNG)
```

## 🔧 Retraining

```bash
node scripts/train_fast.mjs            # incremental trainer (aliases + BPE)
scripts/train_resilient.mjs            # checkpoint/resume wrapper for big runs
node scripts/eval_all.mjs              # acceptance eval after any change
```

The trainer fuses alias pairs/triples before learning, translates synthetic ids to runtime ids, and supports `initMerges` resume — verified byte-identical to a fresh run.

## 📜 License

MIT · [github.com/vspcoderz/aicl](https://github.com/vspcoderz/aicl)
