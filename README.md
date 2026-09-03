# AICL — AI Compressed Language

A two-stage text compression system designed specifically for AI models. Compress English, code, and structured text into fewer tokens for cheaper, faster inference.

```
Text → [Dict Encoder] → AICL (PUA symbols) → [AICL Tokenizer] → Token IDs → AI Model
```

## Compression Results

| Text Type | Ratio | Example |
|---|---|---|
| Mixed text | **5.2x** | Code + English mixed |
| Git/CLI commands | **4.4x** | `git diff --stat && npm test` |
| JavaScript/TypeScript | **4.1x** | `const x = await db.query(...)` |
| Academic/Technical | **4.0x** | Transformer architecture docs |
| SQL queries | **3.8x** | `SELECT * FROM users WHERE...` |
| API documentation | **3.1x** | Endpoint descriptions |
| English prose | **2.9x** | Natural language text |
| ChatGPT-style text | **2.9x** | AI assistant responses |
| Python/Shell | **2.0-2.4x** | Script code |
| **Overall average** | **2.65x** | Diverse corpus |

## Quick Start

```bash
# Install
git clone https://github.com/vspcoderz/aicl.git
cd aicl
npm install

# Generate dictionaries
node dict/generate.js

# Encode text
node src/cli.js encode "the quick brown fox jumps over the lazy dog"

# Decode back
node src/cli.js decode "<AICL output>"

# Run tests (131/131 passing)
node test/test.js
```

## How It Works

### Stage 1: Dictionary Encoder

Maps common patterns to single Unicode PUA (Private Use Area) symbols:

- **10,807 English words** — single letters, high-frequency words, technical terms
- **1,663 code patterns** — `console.log(`, `SELECT *`, `const`, `async`, etc.
- **742 markdown/phrase patterns** — `# `, `**`, `- `, ```` ``` ````
- **17 shared modifiers** — `MOD_CAPS`, `MOD_TRAIL_PERIOD`, `MOD_TRAIL_SPACE`, etc.
- **360+ fragments** — common letter pairs (`th`, `ing`, `tion`) and mixed patterns (`a0-z9`)

The encoder uses a 3-tier approach:
1. **Longest match first** — context patterns like `" the "` (3 chars) beat bare words
2. **Base word + modifiers** — `"Test."` = `base("test")` + `MOD_CAPS` + `MOD_TRAIL_PERIOD`
3. **Fragment decomposition** — unknown words broken into known fragments (`"testing"` → `"test"` + `"ing"`)

### Stage 2: AICL Tokenizer (BPE)

Custom Byte-Pair Encoding trained on AICL text:
- Merges frequent symbol pairs into single token IDs
- Guarantees 1 token per PUA symbol + merges frequent pairs
- String pair keys (`"a:b"`) to avoid integer overflow with supplementary PUA codepoints

## API

```javascript
import { encode, decode, tokenize, detokenize } from './src/index.js';

// Stage 1: Dictionary compression
const aicl = encode("the quick brown fox");
// aicl.output = " quick fox" (2 symbols)
// aicl.charsIn = 19, aicl.charsOut = 2, ratio = 9.5x

const decoded = decode(aicl.output);
// decoded.output = "the quick brown fox"

// Stage 2: Token compression
import { trainTokenizer } from './src/tokenizer/index.js';
const vocab = trainTokenizer(corpus, 1000);
const tokens = tokenize(aicl.output, vocab);
const detok = detokenize(tokens, vocab);
// detok === aicl.output
```

## CLI Commands

```bash
# Encode text to AICL
node src/cli.js encode "your text here"

# Decode AICL back to text
node src/cli.js decode "<AICL symbols>"

# Show compression statistics
node src/cli.js stats "your text here"

# Train tokenizer on corpus
node src/cli.js train corpus.txt

# Tokenize AICL text
node src/cli.js tok "<AICL symbols>"

# Visual step-by-step encoding
node src/cli.js visual "your text here"
```

## Unicode Ranges

| Dictionary | Range | Count |
|---|---|---|
| English | `U+E001-U+F8FF` + overflow `U+100900+` | 10,807 |
| Code | `U+F0000-U+F07FF` | 1,663 |
| Phrases/Symbols | `U+F0800-U+F0FFF` + `U+100000-U+1007FF` | 742 |
| Modifiers | `U+100800-U+1008FF` | 17 |
| Escape marker | `U+E000` | Reserved |

## Modifier System

Instead of storing 14 variants per word (` test `, ` test,`, ` test.`, etc.), AICL stores 1 base symbol + 17 shared modifiers:

```
"test."  → base("test") + MOD_TRAIL_PERIOD     = 2 symbols (was 5 chars)
"The"    → base("the") + MOD_CAPS               = 2 symbols (was 3 chars)
"Hello!" → base("hello") + MOD_CAPS + MOD_TRAIL_EXCL = 3 symbols (was 6 chars)
```

## Performance

- **Dictionary size**: 210 KB (all JSON files)
- **Encoding**: O(n × m) where n = text length, m = longest pattern
- **Decoding**: O(n) single pass with buffer

## Test Suite

```bash
node test/test.js          # 131/131 passing
node test_corpus.mjs       # 19 diverse compression tests
```

## License

MIT
