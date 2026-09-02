# AICL v2 - Static Dictionary + BPE Phrase Rewrite

## Goal

Create a simple, no-training-needed compression system:
1. **Layer 1**: Static dictionary maps common English words + code tokens to Unicode symbols
2. **Layer 2**: BPE phrase merge handles remaining patterns

## Architecture

```
English text
    │
    ▼
┌─────────────────────────────┐
│ Layer 1: Static Dict        │  " the " → "𐂀", " is " → "𐂁"
│ (hardcoded ~400 entries)    │  Works out of the box, no training
└─────────────────────────────┘
    │
    ▼
┌─────────────────────────────┐
│ Layer 2: BPE Phrase Merge   │  "language model" → "𐃀"
│ (optional, from corpus)     │  Adds extra compression
└─────────────────────────────┘
    │
    ▼
AICL text (fewer tokens)
```

## Unicode Symbol Pool

Using these ranges (from user-provided list):
- PUA: 𐂀-𐂿, 𐃀-𐃿 (896 chars)
- Old Italic: 𐌀-𐌟 (24 chars)
- Gothic: 𐌰-𐍿 (27 chars)
- Cuneiform: 𒀀-𒎏 (300+ chars)
- Egyptian Hieroglyphs: 𓀀-𿿿 (1000+ chars)
- And more from the provided pool

## Static Dictionary Design

### English Words (~250 entries)
Most frequent English words with space context:
```
" the " → "𐂀"    " is "  → "𐂁"    " an "  → "𐂂"
" a "   → "𐂃"    " and " → "𐂄"    " that "→ "𐂅"
" this "→ "𐂆"    " for " → "𐂇"    " was " → "𐂈"
" on "  → "𐂉"    " are " → "𐂊"    " with "→ "𐂋"
" they "→ "𐂌"    " be "  → "𐂍"    " at "  → "𐂎"
```

### Code Tokens (~100 entries)
Programming keywords and operators:
```
"function " → "𐃀"    " const "  → "𐃁"    " return " → "𐃂"
" import "  → "𐃃"    " export " → "𐃄"    " async "  → "𐃅"
" await "   → "𐃆"    " this."   → "𐃇"    " ==="     → "𐃈"
```

## File Structure

```
aicl/
├── PLAN.md           # This file
├── package.json      # Project config
├── src/
│   ├── index.js      # Public API
│   ├── dict.js       # Static dictionary loader
│   ├── unicode.js    # Symbol pool
│   ├── encoder.js    # Two-layer DP encoder
│   ├── decoder.js    # Lossless decoder
│   └── cli.js        # CLI interface
├── dict/
│   ├── english.json  # Common English words
│   └── code.json     # Code tokens
└── test/
    └── test.js       # Roundtrip tests
```

## Encoder Algorithm

```
encode(text):
  1. Find all static dict matches (longest-first)
  2. Build segments: [matched-symbol] [ascii-chunk] [matched-symbol] ...
  3. For each ascii-chunk:
     a. Optionally run BPE phrase merge
     b. Or keep as literal
  4. Concatenate all segments
  5. Escape any literal symbols in output
```

## Decoder Algorithm

```
decode(aicl_text):
  1. Scan left-to-right
  2. If char is escape marker (\uE000): next char is literal
  3. If char is a phrase symbol: expand to phrase
  4. If char is a static dict symbol: expand to word
  5. Otherwise: keep literal
  6. Concatenate result
```

## Key Design Decisions

1. **No training required** - Static dict works immediately
2. **Space-aware boundaries** - " the " not "the" to avoid false matches
3. **Escape marker** - \uE000 reserved for handling literal symbols
4. **Lossless always** - decode(encode(x)) === x guaranteed
5. **Optional BPE layer** - Can run without it for simplicity

## Implementation Order

1. Create `package.json`
2. Create `src/unicode.js` - Symbol pool
3. Create `dict/english.json` - English mappings
4. Create `dict/code.json` - Code mappings
5. Create `src/dict.js` - Load dictionaries
6. Create `src/decoder.js` - Decode symbols → text
7. Create `src/encoder.js` - Encode text → symbols
8. Create `src/index.js` - Public API
9. Create `src/cli.js` - CLI interface
10. Create `test/test.js` - Verify lossless
11. Run tests, fix issues

## CLI Usage

```bash
# Encode text
echo "the quick brown fox" | node src/cli.js encode

# Decode AICL text
echo "𐂀 quick brown fox" | node src/cli.js decode

# Roundtrip test
echo "hello world" | node src/cli.js roundtrip
```
