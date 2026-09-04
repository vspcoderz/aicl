# BPE Tokenizer Best Practices for AICL (PUA Codepoints) — Research Notes

**Date:** 2026-09-04 · **Corpus:** ~650 k chars AICL (PUA symbols, not bytes/English) · **Goal:** tokens of length 2–5 PUA symbols

> Every claim below cites a primary source. URLs are canonical; doc references give exact section/param.

---

## 1. BPE Foundations

**Origin.** Gage (1994) compression → Sennrich et al. (2016) adapted to NMT as _subword units_ by operating on characters **within word boundaries**, counting pair frequencies weighted by word frequency, and merging the single most-frequent adjacent pair per iteration [arxiv.org/abs/1508.07909](https://arxiv.org/abs/1508.07909) [aclanthology.org/P16-1162](https://aclanthology.org/P16-1162) [aclanthology.org/P16-1162.pdf](https://aclanthology.org/P16-1162.pdf). The paper's contribution is explicitly: "We adapt _byte pair encoding_ (BPE) (Gage, 1994), a compression algorithm, to the task of word segmentation" — Abstract §2, line ~1715.

**Vocab = alphabet + merges.** HF course states the invariant precisely: "target vocabulary size … equals the base vocabulary size plus the number of merges" — e.g. "GPT uses BPE with … 40,478 (478 base tokens + 40,000 merges)" [huggingface.co/learn/llm-course/en/chapter6/5](https://huggingface.co/learn/llm-course/en/chapter6/5). Subword-nmt CLI exposes this as `-s {num_operations}` = number of merge operations [github.com/rsennrich/subword-nmt](https://github.com/rsennrich/subword-nmt). SentencePiece reframes it as `vocab_size` (fixed final vocab, BPE-specific merge count not exposed) [github.com/google/sentencepiece](https://github.com/google/sentencepiece) [github.com/google/sentencepiece/blob/master/doc/options.md](https://github.com/google/sentencepiece/blob/master/doc/options.md) § `vocab_size` (default 8000) and `model_type`.

**Byte-level variant.** GPT-2/RoBERTa trick: base vocab = 256 bytes, so every string is representable with zero `<unk>` — "byte-level BPE … base vocabulary has a small size (256), but every character … will still be included" [huggingface.co/learn/llm-course/en/chapter6/5](https://huggingface.co/learn/llm-course/en/chapter6/5). HF summary: "Byte-level BPE uses 256 byte values as the base vocabulary … GPT-2 uses … 50,257 (256 + 50,000 + 1)" [huggingface.co/docs/transformer/tokenizer_summary](https://huggingface.co/docs/transformer/tokenizer_summary) § Byte-level BPE. tiktoken is the reference byte-level BPE implementation: "tiktoken is a fast BPE tokeniser for use with OpenAI's models" with Rust core, 3–6× faster than HF [github.com/openai/tiktoken](https://github.com/openai/tiktoken).

**Subword-nmt vs HF vs SentencePiece semantics differ:**
- `subword-nmt learn-bpe -s N` → N merges; vocab = N + initial alphabet + special tokens.
- HF `BpeTrainer(vocab_size=V)` → final vocab size _including_ alphabet and specials [huggingface.co/docs/tokenizers/main/en/api/trainers](https://huggingface.co/docs/tokenizers/main/en/api/trainers) § BpeTrainer.
- SentencePiece `spm_train --vocab_size=V --model_type=bpe --character_coverage=…` → fixed V; `hard_vocab_limit` controls whether insufficient symbols cause failure [github.com/google/sentencepiece/blob/master/doc/options.md](https://github.com/google/sentencepiece/blob/master/doc/options.md) § 1–2.

---

## 2. Optimal Vocab Size / Num Merges for ~650 k Chars (Target 2–5 Symbols/Token)

### What the literature says

- **Sennrich 2016 regime is 10 k–90 k merges** on WMT corpora (millions of sentences). The paper explores "Joint BPE … with 89,500 merge operations" [aclanthology.org/P16-1162.pdf](https://aclanthology.org/P16-1162.pdf) §4; follow-ups note "59,500 BPE and 89,500 joint BPE operations for English-German and English-Russian" and "Sennrich et al. explored merge counts from 10,000 to 90,000" [engineermaxxing.com/veanors/papers/bpe-neural-mt](https://www.engineermaxxing.com/veanors/papers/bpe-neural-mt.html) §3. For translation, 32 k merges was the common sweet spot (see also Wu et al. 2016: "8000 to 32,000 merge operations" cited in [cse.iitb.ac.in/~pb/papers/mt21-ilnmt.pdf](https://www.cse.iitb.ac.in/~pb/papers/mt21-ilnmt.pdf) §3).

- **Small-corpus effect is decisive.** Galle (2019) and follow-ups show BPE compression requires sufficient support: tokenizers trained on limited support "take a hit" on compression/fertility, and downstream BLEU drops measurably [arxiv.org/html/2409.04599](https://arxiv.org/html/2409.04599v1) §4; [pdfs.assets.alphaxiv.org/2403.06265v2.pdf](https://pdfs.assets.alphaxiv.org/2403.06265v2.pdf) §3–4. Information-theoretic view: with a small vocab the learned dictionary is capacity-limited and need not minimize cross-entropy on held-out data [arxiv.org/pdf/2601.09039](https://arxiv.org/pdf/2601.09039) Fig.2–3.

- **Low-resource optimum is much smaller.** Indian-language MT (ILCI corpus, BiLSTM NMT) systematically varies merges 0→20 k and finds **2.5 k merges optimal for 23/24 language pairs**, 0 merges (char-level) for cross-family pairs [cse.iitb.ac.in/~pb/papers/mt21-ilnmt.pdf](https://www.cse.iitb.ac.in/~pb/papers/mt21-ilnmt.pdf) §5–Fig.2, Tables 4–7. This corpus size is closer to AICL's 650 k chars than WMT's 100 M+ chars.

- **General guidance for small vocabularies:** "Start with 32K-50K for monolingual … 10K-30K resource-constrained … <10K character-like" [ttsugriy.github.io/llm-first-principles/stages/stage-07/06-vocabulary-size](https://ttsugriy.github.io/llm-first-principles/stages/stage-07/06-vocabulary-size) § Practical Guidelines; "Optimal vocab size ≈ 30K–100K" for natural language but "diminishing returns … going from 50K to 500K saves little sequence length" — ibid.

### Translating to AICL's regime

AICL's alphabet is **not 256 bytes nor ~100 Latin chars** — it is **~5 k–50 k distinct PUA symbols** already present in the dictionary (English 48,712 + code 2,048 + phrases 1,024 + modifiers 17 + fragments 530+; `src/unicode.js:21-30` , `dict/generate.js`). Effective corpus is 650 k _symbols_ (code points), not bytes. Key implications:

| Quantity | Natural-language BPE | AICL PUA BPE |
|---|---|---|
| Initial alphabet \| 256 (bytes) or ~50–1 k (chars) | 2 k–50 k distinct PUA code points (corpus-dependent) |
| Pair space | ~256² then growing | up to |alphabet|² ≈ 4 M–2.5 B possible pairs, but observed pairs are sparse (Zipfian) |
| Target token length | 3–8 chars/token typical [ttsugriy…/06-vocabulary-size](https://ttsugriy.github.io/llm-first-principles/stages/stage-07/06-vocabulary-size) | **2–5 symbols/token** (requirement) |

**Heuristic for 2–5 symbols/token on 650 k chars:**

1. Estimate usable merges by frequency floor. With `min_frequency=2` (current `src/tokenizer/index.js:167`), the max merges before `pairCounts` hits `<2` is an upper bound. For a 650 k-symbol corpus with alphabet A, the number of distinct observed pairs is ≤ min(650 k, A²). Empirically the current AICL vocab produces **77 merges** before exhaustion (`tokenizer/vocab.json:622` `numMerges:77` at `mergeBase:100000`). That is the _data-limited_ ceiling for a small corpus — requesting 4096 merges (`src/tokenizer/index.js:142`) is never reached; the loop breaks at `bestCount < 2`.

2. **Rule of thumb from compression studies:** For <1 M chars, start with **vocab = alphabet + 500–2 000 merges**, sweep, and stop when held-out chars/token plateaus (see §5). The Indian MT optimum of 2.5 k merges on similar-scale data corroborates this order of magnitude [cse.iitb.ac.in/~pb/papers/mt21-ilnmt.pdf](https://www.cse.iitb.ac.in/~pb/papers/mt21-ilnmt.pdf).

3. **Token-length target implies vocab size.** If average token length L is desired, vocab scales roughly as `A × (L−1)` merges in the dense limit, but frequencies thin quickly. For L=3 on A≈5 k observed alphabet, 2–4 k merges is plausible; for A≈50 k, 500–1 500 merges suffices before pairs become singletons. **Recommendation for AICL:** sweep `numMerges ∈ {256, 512, 1024, 2048}` with `max_token_length=5` (see §4) and pick the knee of the compression curve rather than fixing a priori.

4. **Do not copy NL defaults blindly.** `vocab_size=32k` is "generally effective … 16K as contrasting condition when building systems on less than 1 M parallel sentences" [cse.iitb.ac.in/~pb/papers/mt21-ilnmt.pdf](https://www.cse.iitb.ac.in/~pb/papers/mt21-ilnmt.pdf) §3 (Denkowski & Neubig 2017). For 650 k chars of PUA, 32 k is excessive and will produce rare singleton tokens with poor embeddings.

**Concrete config for AICL:**

```js
// before: numMerges ?? 4096, no length cap, no alphabet pruning
// after (recommended sweep):
trainTokenizer(corpus, { numMerges: 1024, maxTokenLength: 5, minFrequency: 2, limitAlphabet: 6000 })
```

HF equivalent:

```python
from tokenizers import Tokenizer
from tokenizers.models import BPE
from tokenizers.trainers import BpeTrainer
trainer = BpeTrainer(
    vocab_size=6500,          # = alphabet (~5000) + merges (~1500) — sweep 5500/7000/8500
    min_frequency=2,
    limit_alphabet=6000,      # prune rarest PUA singletons (see §3)
    max_token_length=5,       # cap at 5 PUA code points (see §4)
    special_tokens=["<unk>"],
)
```

Refs: `vocab_size` includes alphabet [huggingface.co/docs/tokenizers/main/en/api/trainers](https://huggingface.co/docs/tokenizers/main/en/api/trainers) § BpeTrainer; `max_token_length` "prevents creating tokens longer than … *======*" ibid.; `limit_alphabet`/`initial_alphabet` docs [huggingface.co/docs/tokenizers/api/trainers](https://huggingface.co/docs/tokenizers/api/trainers) § BpeTrainer; SentencePiece `vocab_size` vs merges distinction [github.com/google/sentencepiece](https://github.com/google/sentencepiece).

---

## 3. Handling Supplementary PUA & Initial Vocab Pruning

### PUA code-point ranges (normative)

Three Private Use Areas, by definition never assigned by Unicode:

- BMP: **U+E000–U+F8FF** (6,400) — BMP PUA
- Plane 15: **U+F0000–U+FFFFD** (65,534) — SPUA-A
- Plane 16: **U+100000–U+10FFFD** (65,534) — SPUA-B [en.wikipedia.org/wiki/Private_Use_Areas](https://en.wikipedia.org/wiki/Private_Use_Areas) § Blocks table [learn.microsoft.com/en-us/globalization/encoding/pua](https://learn.microsoft.com/en-us/globalization/encoding/pua) § ranges [symbl.cc/en/unicode/blocks/private-use-area](https://symbl.cc/en/unicode/blocks/private-use-area) [graphemica.com/blocks/supplementary-private-use-area-b](https://graphemica.com/blocks/supplementary-private-use-area-b).

AICL maps into all three: `U+E000` escape, `U+E001–U+F8FF` English, `U+F0000–U+F07FF` code, etc. (`src/unicode.js:21-30`).

### UTF-16 surrogate pairs — the only pitfall

- JS `string.length` counts **UTF-16 code units**, not code points. Supplementary PUA chars (U+10000+) are **length 2** (surrogate pair) but one code point. `Array.from(str)` / `for…of` / `String.fromCodePoint` / `codePointAt` are code-point-aware; `charAt`/`charCodeAt`/`str[i]` are **not** [unicodecharacter.com/guides/surrogate-pairs](https://unicodecharacter.com/guides/surrogate-pairs) § worked example (U+E0100 → DB40 DD00) [stackoverflow.com/questions/48677520](https://stackoverflow.com/questions/48677520/how-to-correctly-represent-a-supplementary-unicode-char-in-python3-3-6-1-by-u) (use `\U`, not `\u`+surrogates, in Python; analogous in JS).

- **Primary source warning for AICL tooling:** "Claude Code silently strips all Unicode characters in the BMP Private Use Area range (U+E000–U+F8FF) from tool inputs and outputs" [github.com/anthropics/claude-code/issues/44525](https://github.com/anthropics/claude-code/issues/44525). Supplementary PUA-A (U+F0000+) is unaffected — one reason to prefer supplementary PUA for AICL (and indeed AICL does for code/phrases). Verify any viewer/editor/font preserves supplementary code points.

- **AICL tokenizer already does the right thing:** `codePoints(str) { return Array.from(str); }` and `cpToId(ch) { return CP_BASE + ch.codePointAt(0); }` (`src/tokenizer/index.js:21-55` , `src/unicode.js:53-55`) iterate by code point, not unit. Pair keys are string `a:b` to avoid 32-bit overflow for supplementary code points (`src/tokenizer/index.js:42-44` — comment: "integer overflow with supplementary PUA"). Python analogue: use `chr(cp)` / `ord(ch)` with 5–6 hex digits (`\U000F0000`), not `\uD83D\uDE00` halves [runebook.dev/en/docs/python/c-api/unicode/c.Py_UNICODE_JOIN_SURROGATES](https://runebook.dev/en/docs/python/c-api/unicode/c.Py_UNICODE_JOIN_SURROGATES).

- **Normalization:** PUA characters have **no NFKC/NFKD decomposition**; SentencePiece's default `normalization_rule_name=nmt_nfkc` is a no-op for PUA but will normalize any literal ASCII that leaks through. For a PUA-only corpus set `normalization_rule_name=identity` or use HF with no normalizer. SentencePiece docs: `normalization_rule_name` defaults to `nmt_nfkc`, options include `identity` [github.com/google/sentencepiece/blob/master/doc/options.md](https://github.com/google/sentencepiece/blob/master/doc/options.md) §6. HF `BpeTrainer` does not normalize by default; you attach a `normalizers` pipeline explicitly [huggingface.co/docs/tokenizers/main/en/api/models](https://huggingface.co/docs/tokenizers/main/en/api/models.md) § BPE.

- **Byte fallback is wrong for PUA.** HF `BPE(byte_fallback=False)` by default; SentencePiece `byte_fallback=false` by default [github.com/google/sentencepiece/blob/master/doc/options.md](https://github.com/google/sentencepiece/blob/master/doc/options.md) §5. Byte fallback decomposes unknown code points into UTF-8 bytes (`<0xE3>` tokens). For PUA this would turn one symbol (1 code point, 3–4 UTF-8 bytes) into 3–4 byte tokens — exactly the blow-up AICL aims to prevent. **Keep `byte_fallback=false`, keep `<unk>` disabled if alphabet covers all PUA, or use `initial_alphabet` to force coverage.**

### Initial vocab pruning (alphabet)

- **HF mechanism:** `limit_alphabet: Option<usize>` — "maximum different characters to keep in the alphabet … before computing merges" and `initial_alphabet: AHashSet<char>` — "absolutely to include … even if not seen" [docs.rs/tokenizers…/struct.BpeTrainer](https://docs.rs/tokenizers/latest/tokenizers/models/bpe/trainer/struct.BpeTrainer.html) § Fields; also [huggingface.co/docs/tokenizers/api/trainers](https://huggingface.co/docs/tokenizers/api/trainers) § BpeTrainer. When `limit_alphabet < alphabet.len()`, lowest-frequency characters are pruned (sorted by frequency) before merges begin — see Rust source `trainer.rs` (`kept.sort_unstable_by_key(|k| *k.1); kept.drain(..to_remove)`) [github.com/huggingface/tokenizers/blob/main/tokenizers/src/models/bpe/trainer.rs](https://github.com/huggingface/tokenizers/blob/main/tokenizers/src/models/bpe/trainer.rs) § alphabet pruning.

- **SentencePiece mechanism:** `character_coverage` (default 0.9995) — "ratio of characters … covered … Characters outside … mapped to `<unk>` (or byte fallback)" ; `vocab_size` 8000 etc.; `hard_vocab_limit` [github.com/google/sentencepiece/blob/master/doc/options.md](https://github.com/google/sentencepiece/blob/master/doc/options.md) §2. For CJK/SentencePiece recommends 0.9995; for small alphabets use 1.0.

- **For AICL:** The alphabet is large and Zipfian (few code-pattern PUA appear 10 k×; many English-word PUA appear 1×). Pruning the long tail helps:
  - Set `limit_alphabet = 5000–7000` (keep top-N frequent PUA by observed count) or `character_coverage=1.0` with explicit `required_chars` if you need lossless coverage.
  - Alternatively, keep `initial_alphabet = {ESCAPE_MARKER}` (U+E000) plus any modifier symbols to guarantee they survive pruning.
  - If using custom BPE (`src/tokenizer/index.js`), replicate pruning: count code-point frequencies, sort ascending, drop bottom `alphabet.len() - limit`.

> **AICL-specific note:** `dict/english.json` contains 48 k symbols but the 650 k-char corpus likely uses only a fraction (Zipf). Limiting alphabet to observed symbols (not the full dictionary) is already done implicitly in `trainTokenizer` — `seqs` only contains code points present in the corpus. `limit_alphabet` adds a frequency prune on top of that.

---

## 4. Pair Counting Strategy with Cap Token Length = 5 PUA

### Canonical BPE pair counting

Sennrich BPE: "search for the most frequent pair … most common patterns get merged first … iteratively combine until … vocabulary size" — HF course walkthrough with `compute_pair_freqs` weighted by word frequency [huggingface.co/learn/llm-course/en/chapter6/5](https://huggingface.co/learn/llm-course/en/chapter6/5) § Training algorithm. Formally, at step t, `pair_counts[(a,b)] = Σ freq(word) for word containing adjacent (a,b)` (weighted), pick `argmax`. Implementation in Rust uses a priority queue (`OctonaryHeap`) keyed by `(count, pair)` with tie-break by pair identity [github.com/huggingface/tokenizers/blob/main/tokenizers/src/models/bpe/trainer.rs](https://github.com/huggingface/tokenizers/blob/main/tokenizers/src/models/bpe/trainer.rs) § Merge Ord.

### Adding a length cap (max 5 PUA symbols)

**Two equivalent implementations exist; pick the one matching your trainer:**

**A. HF / Rust — `max_token_length`.** Set `BpeTrainer(max_token_length=5)`. The check is "performed inside the Word::merge method to ensure individual tokens remain within reasonable … counts" [deepwiki.com/huggingface/tokenizers/5.1-bpe-training](https://deepwiki.com/huggingface/tokenizers/5.1-bpe-training) § max_token_length; Rust struct `BpeTrainer { max_token_length: Option<usize> }` [docs.rs/tokenizers…/struct.BpeTrainer](https://docs.rs/tokenizers/latest/tokenizers/models/bpe/trainer/struct.BpeTrainer.html) § max_token_length; Python API docs: "Prevents creating tokens longer than … highly repetitive tokens like *======*" [huggingface.co/docs/tokenizers/main/en/api/trainers](https://huggingface.co/docs/tokenizers/main/en/api/trainers) § BpeTrainer `max_token_length`. Internally, before merging pair (a,b) into new token `ab`, compute `(len(a)+len(b))` in **characters** (`token.chars().count()`) and skip if `> max_token_length`. Rust test suite asserts this: `token.chars().count() <= max_token_length` [github.com/huggingface/tokenizers/blob/main/tokenizers/src/models/bpe/trainer.rs](https://github.com/huggingface/tokenizers/blob/main/tokenizers/src/models/bpe/trainer.rs) § bpe_test_max_token_length_*.

Semantics: counts in **Unicode scalar values (code points)**, not bytes or UTF-16 units. For AICL, 1 scalar = 1 PUA symbol, so `max_token_length=5` means exactly 2–5 PUA symbols per token (singles remain length 1). This is the correct knob for the requirement.

**B. SentencePiece — `max_sentencepiece_length`.** SentencePiece exposes `max_sentencepiece_length` (default 16, int32, "maximum length in Unicode characters of a learned subword") [github.com/google/sentencepiece/blob/master/doc/options.md](https://github.com/google/sentencepiece/blob/master/doc/options.md) §4. For AICL via SentencePiece, set `max_sentencepiece_length=5`.

**C. Custom BPE (`src/tokenizer/index.js`) — manual filter.** Extend `trainTokenizer`:

```js
// inside the merge loop, after selecting bestKey/bestCount, before committing:
const lenA = tokenLengths.get(a) ?? 1;   // map tokenId -> num PUA symbols it represents
const lenB = tokenLengths.get(b) ?? 1;
if (lenA + lenB > 5) {
  // mark this pair as ineligible this iteration, continue to next-best pair
  // cheapest: set pairCounts.delete(bestKey) and re-select (or skip-merge iteration)
  continue; // try next best pair
}
tokenLengths.set(mergedId, lenA + lenB);
```

Without this, long repetitive tokens (e.g., `=====` or AICL-equivalent run of same PUA) pollute the vocab — the very motivation for `max_token_length` in HF docs.

### Frequency handling for AICL

- **Weighting:** Classic BPE weights pairs by word frequency. For AICL there are no spaces/words; the corpus is a flat PUA stream. Counting adjacent pairs over the **entire sequence** (as `src/tokenizer/index.js:150-155` does) is correct for a whitespace-less symbol stream, analogous to SentencePiece's "raw sentence" mode [github.com/google/sentencepiece](https://github.com/google/sentencepiece) § "Trains from raw sentences … includes the space character in the vocabulary".

- **`min_frequency` semantics:** `BpeTrainer(min_frequency=N)` — "minimum frequency a pair should have in order to be merged" [huggingface.co/docs/tokenizers/main/en/api/trainers](https://huggingface.co/docs/tokenizers/main/en/api/trainers). AICL currently uses `bestCount < 2 → break` (`src/tokenizer/index.js:167`). `min_frequency=2` is appropriate for 650 k chars (prevents singleton merges that memorize hapax sequences); for larger corpora 3–5 is common [deepwiki.com/huggingface/tokenizers/5.1-bpe-training](https://deepwiki.com/huggingface/tokenizers/5.1-bpe-training).

- **Do not merge across semantic boundaries if they exist.** Sennrich's end-of-word marker `</w>` makes the split reversible [github.com/rsennrich/subword-nmt](https://github.com/rsennrich/subword-nmt) § end-of-word notes. For AICL, there is no cross-word boundary to respect, but if you ever re-introduce modifier suffixes as atomic units, consider a `pretokenization_delimiter` or `split_by_unicode_script` equivalent to prevent merges that cross modifier boundaries [github.com/google/sentencepiece/blob/master/doc/options.md](https://github.com/google/sentencepiece/blob/master/doc/options.md) §4.

---

## 5. Evaluation Metrics

### Intrinsic (tokenizer-only, no model)

| Metric | Definition | Direction | Source |
|---|---|---|---|
| **Chars (symbols) per token / CPT** | `total_chars / total_tokens` — average characters represented by one token | ↑ higher = more compressive | [huggingface.co/docs/tokenizer_summary](https://huggingface.co/docs/transformer/tokenizer_summary) implicitly; explicit in [ttsugriy…/06-vocabulary-size](https://ttsugriy.github.io/llm-first-principles/stages/stage-07/06-vocabulary-size) § Compression Ratio, [aicalc.com/calc/tokenizer-statistics](https://www.aicalc.com/calc/tokenizer-statistics) § Compression Ratio = chars/tokens |
| **Fertility** | `tokens / words` (or tokens/word) — avg tokens needed per whitespace-delimited word | ↓ lower = better | [emergentmind.com/topics/intrinsic-tokenizer-metrics](https://www.emergentmind.com/topics/intrinsic-tokenizer-metrics) § Formal Definitions (Ali et al. 2023) |
| **Compression ratio (bytes)** | `bytes / tokens` or `tokens(saved)/tokens(original)` — HF/SP report "corpus token count relative to vanilla BPE" | ↑ | [pdfs.assets.alphaxiv.org/2403.06265v2.pdf](https://pdfs.assets.alphaxiv.org/2403.06265v2.pdf) §3 Fig.1 |
| **Avg token length** | mean `len(token)` in chars | ↑ | [ttsugriy…/06-vocabulary-size](https://ttsugriy.github.io/llm-first-principles/stages/stage-07/06-vocabulary-size) § Compression Ratio Analysis |
| **Vocab utilization / Heaps' law** | `V ≈ K·n^β` expected distinct tokens vs n | diagnostic | [aicalc.com/calc/tokenizer-statistics](https://www.aicalc.com/calc/tokenizer-statistics) |
| **Singleton / rare-token rate** | fraction of vocab with freq <100 | ↓ | [ttsugriy…/06-vocabulary-size](https://ttsugriy.github.io/llm-first-principles/stages/stage-07/06-vocabulary-size) § Evaluation Metrics: "tokens appearing <100 times may have poor embeddings" |
| **Parity / STRR** | cross-lingual or cross-domain token-count ratio; Single-Token Retention Rate | ~1 / ↑ | [emergentmind.com/topics/intrinsic-tokenizer-metrics](https://www.emergentmind.com/topics/intrinsic-tokenizer-metrics) § Parity [toklens](https://pypi.org/project/toklens/) § Metrics |

**For AICL specifically:**

- Primary metric is **PUA-symbols per token** (CPT-AICL). Baseline without merges is 1.0. With merges, report: `CPT = 650000 / num_tokens_after_bpe`. Corroborate with `avg_token_length` distribution (should peak at 2–5).
- Also track **tokens vs charsIn baseline**: Stage 1 already compresses `charsIn → charsOut` (AICL chars) at ~2.0× overall ([PLAN.md:62](PLAN.md:62)). Stage 2 (BPE) is measured as `charsOut / tokenIds`. Total = `charsIn / tokenIds`.
- **Hold-out evaluation is mandatory.** Sennrich evaluates BLEU on held-out test; compression studies evaluate CTC on `newstest2016` held-out relative to vanilla BPE [arxiv.org/html/2409.04599v1](https://arxiv.org/html/2409.04599v1) Table 4–12; [pdfs.assets.alphaxiv.org/2403.06265v2.pdf](https://pdfs.assets.alphaxiv.org/2403.06265v2.pdf) §4.1. Split AICL corpus 90/10 train/test, train BPE on train, evaluate CPT and fertility on test to avoid overfitting the pair counts (the failure mode for tiny support — §2).

### Extrinsic (model-involved)

- Correlation between compression and downstream BLEU/accuracy is strong for generation tasks and small models, weaker for classification/large models [pdfs.assets.alphaxiv.org/2403.06265v2.pdf](https://pdfs.assets.alphaxiv.org/2403.06265v2.pdf) §5 Fig.1–3. So intrinsic compression is a sufficient proxy for AICL if the downstream model is fixed.

**Recommended AICL eval script (pseudo):**

```js
import { encode } from './src/encoder.js';
import { trainTokenizer, tokenize } from './src/tokenizer/index.js';
const corpus = texts.map(encode).map(r => r.output);
const [train, test] = split(corpus, 0.9);
for (const n of [256,512,1024,2048]) {
  const vocab = trainTokenizer(train, {numMerges:n, maxTokenLength:5});
  const cpt = chars(test)/tokens(test, vocab);
  const avg = meanTokenLen(vocab);
  const p50 = tokenLengthHistogram(vocab);
  console.log({n, cpt, avg, coverage: vocab.numMerges});
}
```

---

## 6. Common Pitfalls When Training BPE on a Custom Symbol Set (Especially PUA)

1. **Treating PUA as bytes, not code points.** Byte-level BPE (256 base + UTF-8 bytes) would split one supplementary PUA (U+100000, 4 UTF-8 bytes F0 90 80 80) into 4 byte tokens — catastrophic for AICL. Use **codepoint-level** base vocab (one id per distinct PUA code point). HF course tip "byte-level BPE … base vocabulary has small size (256)" is for *text*, not PUA; for AICL invert it [huggingface.co/learn/llm-course/en/chapter6/5](https://huggingface.co/learn/llm-course/en/chapter6/5). Bug pattern: `for (let i=0;i<str.length;i++) str.charCodeAt(i)` splits surrogates.

2. **Integer overflow in pair keys.** JS `Number` can losslessly represent up to 2^53−1; `CP_BASE(16M) + 0x10FFFF ≈ 17895679` fits, but `a*BIG+b` hashing overflows. AICL fixes this with string keys `"a:b"` (`src/tokenizer/index.js:42-44`). HF Rust uses `(u32,u32)` Pair — no overflow; Python HF uses string vocab keys.

3. **Forgetting NFKC normalization destroys PUA.** SentencePiece default `nmt_nfkc` may alter non-PUA text fed to the encoder; for PUA itself it's inert, but pipelines that concatenate PUA+ASCII must use `identity` or HF `NFKC()` vs none matters. Doc: SentencePiece `normalization_rule_name` defaults `nmt_nfkc`, options include `identity` [github.com/google/sentencepiece/blob/master/doc/options.md](https://github.com/google/sentencepiece/blob/master/doc/options.md) §6; HF `SentencePieceBPETokenizer` sets `normalizer = NFKC()` explicitly [github.com/huggingface/tokenizers/blob/main/bindings/python/py_src/tokenizers/implementations/sentencepiece_bpe.py](https://github.com/huggingface/tokenizers/blob/main/bindings/python/py_src/tokenizers/implementations/sentencepiece_bpe.py).

4. **Initial alphabet truncation without `initial_alphabet`.** With `limit_alphabet`, rare PUA symbols needed for round-tripping get dropped and become `<unk>` on encode. Fix with `initial_alphabet=[ESCAPE_MARKER, MOD_*]` [docs.rs/tokenizers…/struct.BpeTrainer](https://docs.rs/tokenizers/latest/tokenizers/models/bpe/trainer/struct.BpeTrainer.html) § initial_alphabet.

5. **No frequency floor → memorizing hapaxes.** `min_frequency=0` (HF default) or `bestCount<1` merges pairs seen once — vocabulary polluted with singleton n-grams that will never reappear and will have untrained embeddings. For 650 k chars, `min_frequency=2` (as in `src/tokenizer/index.js:167`) is the minimum; for larger corpora 5 is better [huggingface.co/docs/tokenizers/main/en/api/trainers](https://huggingface.co/docs/tokenizers/main/en/api/trainers) § BpeTrainer `min_frequency`.

6. **Unbounded token length → long repetitive tokens.** Wikipedia-style `======` or AICL run of same PUA produces tokens like `AAAAA…` that look compressive but waste vocab and have poor generalization. `max_token_length=5` (HF) / `max_sentencepiece_length=5` (SP) prevents this [huggingface.co/docs/tokenizers/main/en/api/trainers](https://huggingface.co/docs/tokenizers/main/en/api/trainers) § max_token_length.

7. **Wrong stopping condition.** Requesting `numMerges=4096` on a 650 k corpus where pairs exhaust at 77 causes wasted loop or, worse, merging across the `min_frequency` boundary. Always check the natural ceiling (`pairCounts.size()==0 || bestCount < min_frequency`) as `src/tokenizer/index.js:157,167` does, and report actual `numMerges` vs requested.

8. **Evaluating on train → optimistic CPT.** Must hold out test split; generation-task correlation with compression only holds on unseen data [pdfs.assets.alphaxiv.org/2403.06265v2.pdf](https://pdfs.assets.alphaxiv.org/2403.06265v2.pdf) §4.1–6.

9. **Ignoring tooling that strips BMP PUA.** Verified bug: BMP PUA U+E000–U+F8FF silently stripped in some pipelines [github.com/anthropics/claude-code/issues/44525](https://github.com/anthropics/claude-code/issues/44525). Test round-trip through every tool in the chain (editor, git, JSON serializer, terminal, font). Prefer supplementary PUA for new symbols if tooling is BMP-hostile.

10. **Special-token collision.** `U+E000` is reserved as ESCAPE_MARKER and must never appear as a dictionary mapping (PLAN.md § Key Design Decisions #1, `src/unicode.js:8-14`). Similarly, HF `special_tokens` occupy vocab slots and count toward `vocab_size`; don't double-count them when computing merges = vocab − alphabet − specials.

11. **tiktoken incompatibility.** tiktoken's pattern (`pat_str`) is a regex pre-tokenizer not aware of PUA; "GPT-4 uses regex preprocessing" [machinelearningplus.com/nlp/build-bpe-tokenizer-from-scratch-python](https://machinelearningplus.com/nlp/build-bpe-tokenizer-from-scratch-python) § Why GPT-4 Uses Regex Preprocessing. If you ever feed AICL through tiktoken for LM inference, override `pat_str` to treat each PUA code point as atomic or disable pre-tokenization entirely — otherwise the regex will split supplementary characters.

12. **Caching/ordering nondeterminism.** Ties in pair frequency are broken by pair identity (`other.pair.cmp(&self.pair)` ascending) in HF Rust [github.com/huggingface/tokenizers/blob/main/tokenizers/src/models/bpe/trainer.rs](https://github.com/huggingface/tokenizers/blob/main/tokenizers/src/models/bpe/trainer.rs) § Ord for Merge. Custom JS picking `>` without tie handling is nondeterministic on equal counts; for reproducibility sort candidates and pick smallest pair.

---

## 7. Recommended Configuration for AICL (650 k Chars, 2–5 PUA/Token)

```js
// src/tokenizer/index.js — proposed trainTokenizer opts
{
  numMerges: 1024,              // sweep 256/512/1024/2048; expect actual <1024 due to floor
  maxTokenLength: 5,            // hard cap at 5 PUA symbols (see §4 impl)
  minFrequency: 2,              // do not merge singletons
  limitAlphabet: 6000,          // prune rarest PUA tail (or character_coverage=1.0 + required_chars)
  initialAlphabet: ['\uE000'],  // ESCAPE_MARKER guaranteed
  // future: count by code point, not UTF-16 unit (already correct via Array.from)
}
```

**Training protocol:**

1. Encode diverse corpus → AICL strings (use `test_corpus.mjs` + larger held-out set).
2. 90/10 train/test split.
3. For each candidate `V = alphabet + merges` in {5500, 6500, 8500, 10500}: train, then compute on **test**:
   - `CPT = symbols / tokens` (target 2.5–4.0 for AICL; >3.5 is "good" for NL BPE at 50 k [ttsugriy…/06-vocabulary-size](https://ttsugriy.github.io/llm-first-principles/stages/stage-07/06-vocabulary-size) § Compression Ratio)
   - `avg_token_length` histogram (verify 90% of mass in 2–5)
   - singleton rate (<5% per [ttsugriy…/06-vocabulary-size](https://ttsugriy.github.io/llm-first-principles/stages/stage-07/06-vocabulary-size) § Evaluation Metrics)
   - total pipeline ratio `charsIn / tokens` (compare to `src/stats.js` baseline)
4. Pick the knee (elbow) where CPT gain per extra merge <0.02.
5. Persist `tokenizer/vocab.json` with `mergeBase`, `numMerges`, `maxTokenLength`, `trainChars`, `testCPT` metadata.

**Expected outcome for 650 k chars:**
- Achievable `CPT ≈ 1.8–2.5` for Stage 2 alone (AICL symbols→tokens), giving total `charsIn/tokens ≈ 2.02 × CPT ≈ 3.6–5.0` if Stage 1's 2.02× multiplies. Higher requires more diverse pair repetitions; on random alphanumeric input compression is near 1.0 and BPE cannot help (see README § Compression Results: Alphanumeric 1.33×, Brackets 1.33×).

---

## References (primary sources only)

- Sennrich et al. 2016 — *Neural Machine Translation of Rare Words with Subword Units* — [arxiv.org/abs/1508.07909](https://arxiv.org/abs/1508.07909) · [aclanthology.org/P16-1162](https://aclanthology.org/P16-1162) · [aclanthology.org/P16-1162.pdf](https://aclanthology.org/P16-1162.pdf)
- SentencePiece — GitHub docs — [github.com/google/sentencepiece](https://github.com/google/sentencepiece) · [doc/options.md](https://github.com/google/sentencepiece/blob/master/doc/options.md) (vocab_size, character_coverage, max_sentencepiece_length, split_by_*, byte_fallback, normalization_rule_name)
- HuggingFace Tokenizers (Rust + Python) — [huggingface.co/docs/tokenizers/main/en/api/models](https://huggingface.co/docs/tokenizers/main/en/api/models.md) (BPE model) · [huggingface.co/docs/tokenizers/main/en/api/trainers](https://huggingface.co/docs/tokenizers/main/en/api/trainers) (BpeTrainer params) · [huggingface.co/learn/llm-course/en/chapter6/5](https://huggingface.co/learn/llm-course/en/chapter6/5) (BPE walkthrough, byte-level BPE) · [huggingface.co/docs/tokenizer_summary](https://huggingface.co/docs/transformer/tokenizer_summary) (vocab = base + merges, GPT-2 50,257)
- Rust source — [tokenizers/src/models/bpe/trainer.rs](https://github.com/huggingface/tokenizers/blob/main/tokenizers/src/models/bpe/trainer.rs) (pair ordering, alphabet pruning, max_token_length heap) · [docs.rs/tokenizers … BpeTrainer](https://docs.rs/tokenizers/latest/tokenizers/models/bpe/trainer/struct.BpeTrainer.html)
- tiktoken — [github.com/openai/tiktoken](https://github.com/openai/tiktoken) (byte-level BPE, Rust core, 3–6× faster; cl100k_base 100,256, o200k_base 199,997)
- PUA definition — [en.wikipedia.org/wiki/Private_Use_Areas](https://en.wikipedia.org/wiki/Private_Use_Areas) · [learn.microsoft.com/en-us/globalization/encoding/pua](https://learn.microsoft.com/en-us/globalization/encoding/pua) · [unicode.scarfboy.com/?s=U+F0000](https://unicode.scarfboy.com/?s=U+F0000)
- Surrogate pairs — [unicodecharacter.com/guides/surrogate-pairs](https://unicodecharacter.com/guides/surrogate-pairs) · [stackoverflow.com/questions/48677520](https://stackoverflow.com/questions/48677520/how-to-correctly-represent-a-supplementary-unicode-char-in-python3-3-6-1-by-u) · [runebook.dev/.../Py_UNICODE_JOIN_SURROGATES](https://runebook.dev/en/docs/python/c-api/unicode/c.Py_UNICODE_JOIN_SURROGATES)
- BMP PUA stripping bug — [github.com/anthropics/claude-code/issues/44525](https://github.com/anthropics/claude-code/issues/44525)
- Low-resource BPE optimum (2.5 k merges) — [cse.iitb.ac.in/~pb/papers/mt21-ilnmt.pdf](https://www.cse.iitb.ac.in/~pb/papers/mt21-ilnmt.pdf) §5 Fig.2; general guidance [ttsugriy…/06-vocabulary-size](https://ttsugriy.github.io/llm-first-principles/stages/stage-07/06-vocabulary-size)
- Compression-vs-performance correlation — [pdfs.assets.alphaxiv.org/2403.06265v2.pdf](https://pdfs.assets.alphaxiv.org/2403.06265v2.pdf) (Unpacking Tokenization) · [arxiv.org/html/2409.04599v1](https://arxiv.org/html/2409.04599v1) (Picky BPE) · [arxiv.org/pdf/2601.09039](https://arxiv.org/pdf/2601.09039) (Information-Theoretic Perspective, incl. gzip/LZ-aware BPE)
- Intrinsic metrics (fertility, parity, CPT, STRR) — [emergentmind.com/topics/intrinsic-tokenizer-metrics](https://www.emergentmind.com/topics/intrinsic-tokenizer-metrics) · [pypi.org/project/toklens](https://pypi.org/project/toklens/) · [aicalc.com/calc/tokenizer-statistics](https://www.aicalc.com/calc/tokenizer-statistics)
- Subword-nmt implementation notes (end-of-word handling, joint BPE) — [github.com/rsennrich/subword-nmt](https://github.com/rsennrich/subword-nmt)
