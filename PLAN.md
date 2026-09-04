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
│ 1. Dictionary        │  51,801 entries mapping patterns → PUA symbols
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

### Stage 2: AICL Tokenizer (BPE, 512 merges, diverse 200k corpus)

| Test | Raw | GPT-4o | AICL | Win |
|---|---:|---:|---:|---:|
| **Code** | 140 | 36 | **10** | **3.60×** |
| **Paths** | 235 | 72 | **27** | **2.67×** |
| **Shell** | 258 | 83 | **37** | **2.24×** |
| **API** | 193 | 73 | **43** | **1.70×** |
| **SQL** | 272 | 73 | **57** | **1.28×** |
| **Common English** | 154 | 32 | **32** | **1.00×** |
| **Markdown** | 169 | 43 | **43** | **1.00×** |
| **Prompt** | 61 | 15 | **15** | **1.00×** |
| **Total** | 1482 | 427 | **264** | **1.62×** |

> 8/8 wins vs GPT-4o. 512 BPE merges, `maxTokenLength: 5`. Stage 1: 2.87× avg, Stage 2: 1.95× avg, Total: 5.61×.

## Files

```
aicl/
├── PLAN.md
├── package.json
├── dict/
│   ├── generate.js          # dictionary generator v4 (51k entries, expanded fragments)
│   ├── english.json         # 48,712 English entries (47k words + single letters + fragments)
│   ├── code.json            # 2,048 code patterns (max PUA-A range)
│   ├── symbols.json         # 1,024 phrase/markdown/symbol patterns
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
     b. If at a word start AND longest match covers < half the word:
        - Try whole word + modifier (base + MOD_CAPS + trailing modifiers)
        - If no whole word, try fragment matching (bigrams/trigrams/4-grams)
        - Skip for CamelCase words (MOD_CAPS can't handle mid-word caps)
     c. If longest match covers >= half the word → emit symbol, advance
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
- [x] Phase 5g: Dictionary expansion to 51k entries (47k English words, 2k code patterns, 1k phrases)
- [x] Phase 5h: Encoder smart word-based path (triggers when longest match < half word length)
- [x] Phase 6: Retrain BPE tokenizer — 512 merges on focused corpus, 8/8 wins vs GPT-4o, 3.21× total
- [x] Phase 7: Fragment fix (dedicated sorted fragment list, longest-match) + tokenizer bpeMerge optimization (rank tie-break, single-pass all-merge)
- [x] Phase 8: BPE corpus rebuild — benchmark variants at 500x + general English/code/SQL
- [x] Phase 9: Playground improvements — copy buttons, share URL, perf breakdown, heatmap, file upload
- [ ] Phase 8: Performance benchmarking (target: 10k chars < 50ms)
