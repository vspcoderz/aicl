# AICL v2 — AI Compressed Language

## Goal

Build a two-stage text compression pipeline for AI models:

```
English/Code → [Dict Encoder] → AICL text (PUA symbols)
                                        ↓
                              [AICL Tokenizer] → token IDs → AI model
```

**Why this works**: Standard tokenizers (BPE/WordPiece) waste tokens on PUA characters because they never saw them in training. A tokenizer *designed for AICL* guarantees 1 token per PUA symbol + merges frequent symbol pairs.

**Target**: 60-80% fewer tokens than raw English.

## Architecture

```
┌─────────────────────┐
│ 1. Dictionary        │  13,229 entries mapping patterns → PUA symbols
│    Encoder           │  3-tier: longest-match → base+modifier → literal
└──────────┬──────────┘
           │ AICL text (PUA chars)
           ▼
┌─────────────────────┐
│ 2. AICL Tokenizer   │  custom BPE trained on AICL text
│    (trainable)       │  merges frequent PUA pairs → single tokens
└──────────┬──────────┘
           │ token IDs (integers)
           ▼
┌─────────────────────┐
│ Send to AI model    │  fewer tokens = lower cost + faster inference
└─────────────────────┘
```

## Compression Results

### Stage 1: Dictionary Encoder (v5 — modifier system + fragments)

| Input Type | Chars In | Chars Out | Ratio |
|---|---|---|---|
| Common English prose | 154 | 51 | **3.02x** |
| Code (const/let patterns) | 140 | 34 | **4.12x** |
| SQL queries | 272 | 103 | **2.64x** |
| Git commands | 61 | 17 | **3.59x** |
| Test sentence (97 chars) | 97 | 36 | **2.69x** |
| Markdown | 169 | 69 | **2.45x** |
| Operator soup | 218 | 96 | **2.27x** |
| Markdown full (with code) | 229 | 81 | **2.83x** |
| Hex/Binary/Oct | 153 | 88 | **1.74x** |
| Alphanumeric random | 288 | 215 | 1.34x |
| Mixed symbols | 144 | 99 | 1.45x |
| Repeating chars | 179 | 120 | 1.49x |
| **Overall diverse corpus** | **3,577** | **1,811** | **1.98x** |

### Stage 2: AICL Tokenizer (BPE)

| Stage | Input | Output | Ratio |
|-------|-------|--------|-------|
| Dict Encoder | 817 chars (AI corpus) | 398 AICL chars | 2.05x |
| AICL Tokenizer | 398 AICL chars | 307 token IDs | 1.30x |
| **Total** | 817 chars | 307 tokens | **2.66x** |

## Files

```
aicl/
├── PLAN.md
├── package.json
├── dict/
│   ├── generate.js          # dictionary generator v4 (modifier system + fragments)
│   ├── english.json         # 10,807 English entries (words + single letters + fragments)
│   ├── code.json            # 1,663 code patterns
│   ├── symbols.json         # 742 phrase/markdown/symbol patterns
│   ├── modifiers.json       # 17 modifier symbols (MOD_CAPS, MOD_TRAIL_*, MOD_LEAD_*)
│   └── wordlists/
│       └── english.txt      # Google 10k English word list (source)
├── src/
│   ├── unicode.js           # PUA constants, escape marker, char helpers
│   ├── dict.js              # load + merge dictionaries + modifiers, build lookup
│   ├── encoder.js           # text → AICL (3-tier: longest-match → base+modifier → literal)
│   ├── decoder.js           # AICL → text (buffer-based modifier application)
│   ├── stats.js             # compression metrics
│   ├── vision.js            # ANSI color-coded output + step-by-step
│   ├── index.js             # public API (exports all modules + modifier helpers)
│   ├── cli.js               # CLI (encode/decode/stats/train/tok/visual)
│   └── tokenizer/
│       └── index.js         # AICL text ↔ token IDs (custom BPE, string pair keys)
├── tokenizer/
│   └── vocab.json           # trained tokenizer vocabulary + merges
└── test/
    └── test.js              # 131/131 passing (roundtrip + modifier + tokenizer)
```

## Core Algorithms

### Encoder (3-tier)

```
encode(text):
  1. Load all dictionaries → single map { pattern → symbol }
  2. Sort patterns by length DESC
  3. Scan text left-to-right:
     a. Find longest matching pattern
     b. If longest match is single letter AND we're at a word start:
        - Try whole word + modifier (base + MOD_CAPS + trailing modifiers)
        - If no whole word, try fragment matching (bigrams/trigrams/4-grams)
     c. If longest match > 1 char → emit symbol, advance
     d. No match → emit literal char (prefix with \uE000 if PUA), advance 1
  4. Return concatenated AICL text
```

### Decoder (buffer-based modifiers)

```
decode(aicl_text):
  1. Build reverse map { symbol → pattern } + modifierMap { symbol → transform }
  2. Buffer holds current word being reconstructed
  3. Scan left-to-right:
     a. Char is \uE000 (escape) → flush buffer, next char is literal
     b. Char is modifier → apply transform to buffer
     c. Char is known symbol → flush buffer, start new buffer with pattern
     d. Otherwise → flush buffer, emit char as-is
  4. Flush remaining buffer
  5. Return original text
```

### Modifier System

17 shared modifiers at U+100800-U+100810:
- MOD_CAPS: capitalize first letter
- MOD_TRAIL_SPACE/COMMA/PERIOD/QUESTION/EXCL/SEMI/COLON/RPAREN/RBRACKET/RBRACE/RQUOTE
- MOD_LEAD_SPACE/LPAREN/LBRACKET/LBRACE/LQUOTE

Example: `"test."` = base("test") + MOD_TRAIL_PERIOD = 2 symbols (was 5 chars before)

### AICL Tokenizer (custom BPE)

```
train(corpus):
  1. Encode entire corpus with dict encoder → AICL text
  2. Split AICL into code points (handle surrogate pairs)
  3. Count frequency of each code point
  4. Repeat N merges:
     a. Find most frequent adjacent pair (symbol_a, symbol_b)
     b. Assign new token ID
     c. Add merge rule: (symbol_a, symbol_b) → new_token
     d. Apply merge to corpus, recount
  5. Save vocabulary + merge rules
```

## Key Design Decisions

1. **Escape marker**: `\uE000` (U+E000) reserved — if original text contains a PUA char, encode as `\uE000` + literal. **The dict generator starts English symbols at U+E001** so no pattern ever maps to the escape marker.
2. **Supplementary PUA**: Code/symbol dicts use U+F0000+ (surrogate pairs in JS, 4 bytes UTF-8)
3. **BMP PUA**: English dict uses U+E001-U+F8FF (1 char in JS, 3 bytes UTF-8)
4. **Modifiers**: Shared transform symbols (MOD_CAPS, MOD_TRAIL_*, MOD_LEAD_*) at U+100800-U+100810. Replaces N×M variant symbols with N+17 symbols.
5. **Fragments**: Common letter-pair/fragment symbols (bigrams, trigrams, 4-grams, mixed letter+digit) enable compression of unknown words by decomposing them.
6. **Case-sensitive fragments**: All-caps (FF, JSON, HTTP) and CamelCase (In, Band, Get) fragments for accurate reconstruction.
7. **Tokenizer pair keys use strings** (`"a:b"`) — integer-valued keys overflow `Number.MAX_SAFE_INTEGER` for supplementary PUA codepoints and caused corruption; string keys are collision-free
8. **Roundtrip guaranteed**: decode(encode(x)) === x always

## Status

- [x] Phase 1: Dictionary generation (72,681 → 13,229 entries with modifier system)
- [x] Phase 2: Core library (unicode, dict, encoder, decoder, stats, vision, index)
- [x] Phase 3: AICL tokenizer (train, tokenize, detokenize) — string pair keys, lossless
- [x] Phase 4: CLI + tests (131/131 passing)
- [x] Phase 5: Modifier composition system (17 shared modifiers, base+modifier encoding)
- [x] Phase 5b: Single-letter coverage (a-z, A-Z, 0-9)
- [x] Phase 5c: Bare word symbols (~270 high-frequency words from Google 10k)
- [x] Phase 5d: Technical terms (~160 AI/code/tech words)
- [x] Phase 5e: Letter-pair/fragment symbols (~360 bigrams/trigrams + mixed letter+digit)
- [x] Phase 5f: Case-sensitive fragments (all-caps + CamelCase patterns)
- [ ] Phase 6: Improve random/alphanumeric compression (currently 1.34x, target 2x+)
- [ ] Phase 7: Real-world tokenizer training (current vocab from small corpus)
- [ ] Phase 8: Performance benchmarking (target: 10k chars < 50ms)
