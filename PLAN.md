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
│ 1. Dictionary        │  72,681 entries mapping patterns → PUA symbols
│    Encoder           │  longest-match-first greedy scan
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

## Compression Math (measured)

| Stage | Input | Output | Ratio |
|-------|-------|--------|-------|
| Dict Encoder | 817 chars (AI corpus) | 627 AICL chars | 1.3x |
| AICL Tokenizer | 627 AICL chars | 267 token IDs | 2.3x |
| **Total** | 817 chars | 267 tokens | **3.06x** |

Real-world AI-prose-only samples reach 2.2-2.6x on Stage-1 alone; mixed code+transcript text is closer to 1.6x Stage-1.

## Files

```
aicl/
├── PLAN.md
├── package.json
├── dict/
│   ├── generate.js          # dictionary generator (done, v3)
│   ├── english.json         # 69,888 English pattern → PUA (done, starts U+E001)
│   ├── code.json            # 2,048 code pattern → PUA (done)
│   └── symbols.json         # 745 phrase/markdown/symbol → PUA (done)
├── src/
│   ├── unicode.js           # PUA constants, escape marker, char helpers
│   ├── dict.js              # load + merge dictionaries, build lookup
│   ├── encoder.js           # text → AICL (longest-match-first)
│   ├── decoder.js           # AICL → text (reverse lookup)
│   ├── stats.js             # compression metrics
│   ├── vision.js            # ANSI color-coded output + step-by-step
│   ├── index.js             # public API
│   ├── cli.js               # CLI with --visual flag
│   └── tokenizer/
│       └── index.js         # AICL text ↔ token IDs (custom BPE, train/save/load)
├── tokenizer/
│   └── vocab.json           # trained tokenizer vocabulary + merges
└── test/
    └── test.js              # roundtrip + compression + tokenizer tests (41 checks)
```

## Core Algorithms

### Encoder (longest-match-first)

```
encode(text):
  1. Load all dictionaries → single map { pattern → symbol }
  2. Sort patterns by length DESC (longest first)
  3. Scan text left-to-right:
     a. At position i, try patterns from longest to shortest
     b. Match found → emit symbol, advance i by pattern.length
     c. No match → emit literal char (prefix with \uE000 if PUA), advance 1
  4. Return concatenated AICL text
```

### Decoder

```
decode(aicl_text):
  1. Build reverse map { symbol → pattern }
  2. Scan left-to-right:
     a. Char is \uE000 (escape) → next char is literal, emit it, skip 2
     b. Char is known symbol → emit pattern
     c. Otherwise → emit char as-is
  3. Return original text
```

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

tokenize(aicl_text):
  1. Split into code points
  2. Apply merge rules left-to-right (greedy, longest first)
  3. Return array of token IDs

detokenize(token_ids):
  1. Reverse lookup each ID → symbol/pair
  2. Concatenate
  3. Return AICL text
```

## Key Design Decisions

1. **Escape marker**: `\uE000` (U+E000) reserved — if original text contains a PUA char, encode as `\uE000` + literal. **The dict generator starts English symbols at U+E001** so no pattern ever maps to the escape marker.
2. **Supplementary PUA**: Code/symbol dicts use U+F0000+ (surrogate pairs in JS, 4 bytes UTF-8)
3. **BMP PUA**: English dict uses U+E001-U+F8FF (1 char in JS, 3 bytes UTF-8)
4. **Tokenizer is separate from encoder** — encoder is deterministic, tokenizer is trained
5. **Roundtrip guaranteed**: decode(encode(x)) === x always
6. **Vision layer optional** — doesn't affect compression, just shows what happened
7. **Tokenizer pair keys use strings** (`"a:b"`) — integer-valued keys overflow `Number.MAX_SAFE_INTEGER` for supplementary PUA codepoints and caused corruption; string keys are collision-free

## Known Gaps (v2.1)

- **Single letters** (a-z, A-Z, 0-9) have no symbols — `a b c d` = 1.00x
- **Bare short words** (is, we, you, and, this, to) only have context variants (` is `, ` we `), not bare forms — bare words pass through as literals
- **Proposed fix**: Modifier composition system — 1 base symbol per word + ~17 shared modifier symbols (MOD_CAPS, MOD_TRAIL_PERIOD, etc.) replaces 200×14 variant symbols with 200+17 = 217 symbols

## Status

- [x] Phase 1: Dictionary generation (72,681 entries total, escape-marker collision fixed)
- [x] Phase 2: Core library (unicode, dict, encoder, decoder, stats, vision, index)
- [x] Phase 3: AICL tokenizer (train, tokenize, detokenize) — string pair keys, lossless
- [x] Phase 4: CLI + tests (41/41 passing)
- [ ] Phase 5: Modifier composition system + single-letter coverage (pending user decision)
