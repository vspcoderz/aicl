<div align="center">

# AICL — AI Compression Language

**2–5 PUA → 1 token · 51k dictionary · Up to 4× fewer tokens than GPT-4o**

*Compress English, code and structured text for cheaper, faster LLM inference.*

**VSPCODERZ** · *Dream it. Design it. Craft it.*

[![Tests](https://img.shields.io/badge/tests-131%2F131_passing-brightgreen)](#test-suite)
[![License](https://img.shields.io/badge/license-MIT-black)](#license)
[![Tokenizer](https://img.shields.io/badge/tokenizer-BPE_2--5_PUA-7c3aed)](#aicltokenizer)
[![Merges](https://img.shields.io/badge/merges-386-ec4899)](#aicltokenizer)
[![Stage1](https://img.shields.io/badge/Stage1-2.18x-f97316)](#benchmarks)

```
Raw English → [AICL Encoder: PUA] → AICL Text → [AICLTokenizer: BPE] → Tokens → LLM
              2.18× Stage 1 · 2–5 PUA/token Stage 2 · 8/8 wins vs GPT-4o
```

</div>

---

<div align="center">
  <img src="assets/benchmark.png" width="820" alt="AICL vs GPT-4o — tokens lower is better, 8 tests"/>
  <br/>
  <sub>GPT-4o vs AICL · 8/8 wins · <b>purple → pink → orange</b> = AICLTokenizer</sub>
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
| **Code const/let** | 140 | 36 | **9** | **4.00×** |
| **API response** | 193 | 73 | **19** | **3.84×** |
| **Markdown** | 169 | 43 | **13** | **3.31×** |
| **Paths/URLs** | 235 | 72 | **23** | **3.13×** |
| **Prompt** | 61 | 15 | **5** | **3.00×** |
| **Shell** | 258 | 83 | **33** | **2.52×** |
| **Common English** | 154 | 32 | **25** | 1.28× |
| **SQL** | 272 | 73 | **64** | 1.14× |
| **Total** | 1542 | 427 | **191** | **2.24×** |

> AICL wins **8/8**. 386 BPE merges, `maxTokenLength: 5`. LLaMA 2 and GPT-3/4/5 included in `benchmark-all`.

### Stage 1 — Dictionary Encoder (PUA, `node test_corpus.mjs`)

| Text Type | Ratio | Example |
|---|---:|---|
| Code const/let | **4.24×** | `const app = express(); app.get(...)` |
| Git/CLI | **3.81×** | `git diff --stat && npm test` |
| Common English | **3.08×** | Natural language |
| Markdown | **3.07×** | Headers, lists |
| Markdown full | **2.90×** | Docs + code blocks |
| Shell | **2.77×** | Terminal cmds |
| Paths/URLs | **2.73×** | `https://…`, `~/.config/…` |
| SQL | **2.72×** | `SELECT * FROM users…` |
| API response | **2.47×** | JSON |
| **Overall (19 tests)** | **2.18×** | 3577 → 1639 chars |

> `>1× = win`. Random alphanumeric: ~1.38× (entropy limit). Every result is `decode(encode(x)) === x`.

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

# Tests & benchmarks
npm test                  # 131/131 passing
npm run test:corpus       # 19 tests · 2.18× Stage 1
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

Custom BPE **on PUA, not English** — 1 PUA ≈ 4.5 English chars, 1 token = 2–5 PUA = **9–22 chars/token**.

- `maxTokenLength: 5`, 386 merges on ~818k PUA corpus
- Pair keys `"a:b"` (no int overflow on supplementary PUA)
- Train: `npm run corpus` → `corpus/aicl_train.txt` → `trainTokenizer(corpus, { numMerges: 4096, maxTokenLength: 5 })`

---

## API

```javascript
import { encode, decode } from './src/index.js';
import { tokenize, detokenize, loadTokenizer } from './src/tokenizer/index.js';

// Stage 1: Dictionary
const aicl = encode("the quick brown fox"); // 19 → 2 PUA, 9.5×
decode(aicl.output).output === "the quick brown fox" // true

// Stage 2: Tokenizer
const vocab = loadTokenizer(); // 386 merges
const toks = tokenize(aicl.output, vocab); // 2 PUA → 1 token
detokenize(toks, vocab) === aicl.output // true

// Full pipeline
const raw = "aicl is Goated BTW, and this can reduce tokens very vary fast";
const tokens = tokenize(encode(raw).output, vocab); // 61 → 5 tokens, 3.00× vs GPT-4o
```

## CLI

```bash
node src/cli.js encode "text"     # Text → AICL
node src/cli.js decode "<AICL>"   # AICL → Text
node src/cli.js stats "text"      # Raw → AICL → Tokens stats
node src/cli.js tok "<AICL>"      # AICL → Tokens
node src/cli.js visual "text"     # Step-by-step
```

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
npm run test:corpus   # 19 tests · 2.18× Stage 1
npm run benchmark     # regenerate assets/benchmark.svg + benchmark-all.svg → .png
```

## Assets

```
assets/
  benchmark.png      # GPT-4o vs AICL — 8 tests, VSPCODERZ gradient
  benchmark.svg
  benchmark-all.png  # GPT-3/4/4o/5 + LLaMA 2 + AICL
  benchmark-all.svg
```

---

<div align="center">

**VSPCODERZ** · *Dream it. Design it. Craft it.*

[github.com/vspcoderz](https://github.com/vspcoderz) · MIT — github.com/vspcoderz/aicl

</div>
