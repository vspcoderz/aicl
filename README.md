<div align="center">

# AICL — AI Compression Language

**2–5 PUA → 1 token · 48k dictionary · Up to 4× fewer tokens than GPT-4o**

*Compress English, code, and structured text for cheaper, faster AI inference.*

[![Tests](https://img.shields.io/badge/tests-131%2F131_passing-brightgreen)](#test-suite)
[![License](https://img.shields.io/badge/license-MIT-black)](#license)
[![Tokenizer](https://img.shields.io/badge/tokenizer-BPE_2--5_PUA-blue)](#aicltokenizer)
[![Stage1](https://img.shields.io/badge/Stage1-2.12x-black)](#benchmarks)

```
Raw English → [AICL Encoder: PUA] → AICL Text → [AICLTokenizer: BPE] → Tokens → LLM
```

</div>

---

<div align="center">
  <img src="assets/benchmark.png" width="820" alt="AICL vs GPT-4o — chars per token"/>
  <br/>
  <sub>Stage 1 + Stage 2 · Vertical square bars · Higher = fewer tokens</sub>
</div>

<div align="center">
  <img src="assets/benchmark-all.png" width="820" alt="AICL vs All OpenAI Tokenizers"/>
  <br/>
  <sub>All 5 OpenAI encodings + AICL · Square bars · Lower = cheaper</sub>
</div>

## Benchmarks

### vs GPT-4o (`o200k_base`) — chars per token, higher is better

| Test | GPT-4o | AICL | Win | Pipeline |
|---|---|---|---|---|
| **Code const/let** | 3.89 | **15.5** | **4.00×** | 140 → 33 AICL → 9 tok |
| **API response** | 2.64 | **10.1** | **3.85×** | 193 → 78 → 19 |
| **Common English** | 4.81 | **6.16** | **1.28×** | 154 → 50 → 25 |
| SQL | 3.57 | **4.26** | 1.19× | 132 → 31 tok |
| Normal Prompt | 2.61 | **2.77** | 1.06× | 133 → 65 → 48 |
| Alphanumeric | 1.36 | 1.44 | 1.06× | random — entropy limit |

### Stage 1 — Dictionary Encoder (chars → PUA)

| Text Type | Ratio | Example |
|---|---|---|
| Code const/let | **4.24x** | `const app = express(); app.get(...)` |
| Git/CLI | **3.81x** | `git diff --stat && npm test` |
| Common English | **3.08x** | Natural language |
| SQL | **2.72x** | `SELECT * FROM users...` |
| Markdown full | **2.90x** | Docs + code blocks |
| Markdown | **2.64x** | Headers, lists |
| API response | **2.54x** | JSON |
| Shell | **2.41x** | Terminal |
| **Overall (19 tests)** | **2.12x** | Diverse corpus |

> `>1× = win`. Structured text: 1.2–4.0× fewer tokens. Random: parity (Shannon limit).

## Quick Start

```bash
git clone https://github.com/vspcoderz/aicl && cd aicl
npm install

# Generate dictionaries (48k English + 2k code)
node dict/generate.js

# Encode / Decode
node src/cli.js encode "the quick brown fox jumps over the lazy dog"
node src/cli.js decode "<AICL output>"

# Benchmark
node test/test.js          # 131/131 passing
node test_corpus.mjs       # 19 tests · 2.12x

# Tokenize AICL (2–5 PUA → 1 token)
node -e "import {encode} from './src/encoder.js'; import {tokenize,loadTokenizer} from './src/tokenizer/index.js'; const v=loadTokenizer(); const a=encode('hello world').output; console.log(tokenize(a,v).length)"
```

## How It Works

### Stage 1 — Dictionary Encoder (PUA)

Maps patterns → single Unicode PUA symbols:

- **48,712 English** — 47k frequency-sorted + single letters + technical
- **2,048 Code** — `console.log(`, `SELECT *`, `async`, `=>`
- **1,024 Phrases/Markdown** — `# `, `**`, `"name"`, common phrases
- **17 Modifiers** — `MOD_CAPS`, `MOD_TRAIL_SPACE`, etc.
- **530+ Fragments** — `th`, `ing`, `tion`, `src`, `a0-z9`

**3-tier greedy:** Longest match → Base + modifiers (`"Test."` → `base("test")` + `MOD_CAPS` + `MOD_TRAIL_PERIOD`) → Fragment (`"testing"` → `"test"`+`"ing"`) → Literal.

### Stage 2 — AICLTokenizer (BPE)

Custom BPE **on PUA, not English** — 1 PUA = 4.5 English chars, 1 token = 2–5 PUA = **9–22 chars/token**.

- `maxTokenLength: 5`, 249 merges (150 actual on 818k corpus)
- String pair keys `"a:b"` (no int overflow on supplementary PUA)
- Train: `scripts/build_corpus.js` → `corpus/aicl_train.txt` → `trainTokenizer(corpus, {numMerges: 3000, maxTokenLength: 5})`

## API

```javascript
import { encode, decode } from './src/index.js';
import { tokenize, detokenize, loadTokenizer } from './src/tokenizer/index.js';

// Stage 1: Dictionary
const aicl = encode("the quick brown fox"); // 19 → 2 PUA, 9.5x
decode(aicl.output).output === "the quick brown fox" // true

// Stage 2: Tokenizer
const vocab = loadTokenizer(); // 249 merges
const toks = tokenize(aicl.output, vocab); // 2 PUA → 1 token
detokenize(toks, vocab) === aicl.output // true

// Full pipeline
const raw = "aicl is Goated BTW, and this can reduce tokens very vary fast";
const tokens = tokenize(encode(raw).output, vocab); // 133 → 65 → 48 tokens, 2.77x
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
|---|---|---|
| English | `U+E001-U+F8FF` + `U+100900+` | 48,712 |
| Code | `U+F0000-U+F07FF` | 2,048 |
| Phrases/Symbols | `U+F0800-U+F0FFF` + `U+100000-U+1007FF` | 1,024 |
| Modifiers | `U+100800-U+1008FF` | 17 |
| Escape | `U+E000` | Reserved |

## Test Suite

```bash
node test/test.js        # 131/131 passing
node test_corpus.mjs     # 19 tests · 2.12x Stage1
```

## Assets

```
assets/
  benchmark.png      # GPT-4o vs AICL (vertical square)
  benchmark.svg
  benchmark-all.png  # All 5 OpenAI + AICL (colorful vertical)
  benchmark-all.svg
```

## License

MIT — github.com/vspcoderz/aicl
