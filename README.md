<div align="center">

# ◈ AICL — AI Compression Language

**A lossless text tokenizer that beats GPT-4o on every domain — English, code, SQL, markdown, ALL-CAPS, even text it has never seen.**

[![Tests](https://img.shields.io/badge/tests-15%2F15_passing-brightgreen)](#-test-suite)
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

### vs GPT-4o (`o200k_base`) — tokens, lower is better · `uv run python scripts/benchmark.py`

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

> Evaluate it yourself: `uv run python scripts/eval_all.py` — 658 texts, structural sanity check, per-domain breakdown.

---

## 🚀 Quick Start

```bash
git clone https://github.com/vspcoderz/aicl && cd aicl
uv sync

# Encode / decode from the CLI
uv run python -m aicl encode "the quick brown fox jumps over the lazy dog"
uv run python -m aicl decode "<AICL output>"
uv run python -m aicl stats "SELECT * FROM users WHERE id = 42"

# Local playground (Python server)
uv run python playground/server.py  # → http://127.0.0.1:8787

# Tests & benchmarks
uv run python -m unittest discover -s tests -v
uv run python test_corpus.py
uv run python scripts/benchmark.py
uv run python scripts/eval_all.py
```

### As a library

```python
from aicl import decode, encode, detokenize, load_tokenizer, tokenize

aicl = encode("SELECT * FROM users WHERE id = 42")
vocab = load_tokenizer()
tokens = tokenize(aicl["output"], vocab)

assert decode(aicl["output"])["output"] == "SELECT * FROM users WHERE id = 42"
assert detokenize(tokens, vocab) == aicl["output"]
```

The Python package is the canonical implementation. The static browser demo
keeps a small checked-in JavaScript port because browsers cannot execute Python;
its output is covered by the same golden vocabulary contract.

## 🧪 Tests

```bash
uv run python -m unittest discover -s tests -v  # 15 Python tests
uv run python test_corpus.py                     # 19 domain round trips
```

No training is part of the test suite. Trainer code is only compiled/imported;
runtime tests use the shipped vocabulary or hand-authored merge fixtures.

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
| **[Live on GitHub Pages](https://vspcoderz.github.io/aicl/)** | 100% client-side JavaScript demo; uses the same dictionary/vocab schemas as Python |
| **Local (`uv run python playground/server.py`)** | Python server with token heatmap, pipeline views, and optional comparison integrations |

Both versions show per-token colors inside the input box as you type. The
browser implementation is intentionally isolated in `docs/aicl.js`; Python is
the canonical runtime.

<details>
<summary><b>Run the Pages demo from this repo</b></summary>

GitHub Pages serves this repo's `/docs` folder. The checked-in browser port
loads `docs/dict/*.json` and `docs/tokenizer/vocab.json` directly; regenerate
the copied assets with:

```bash
uv run python scripts/build_docs.py
```

</details>

---

## 📁 Layout

```
aicl/              canonical Python runtime, CLI, and packaged data
dict/              source dictionary JSON (generator input/output)
tokenizer/         source vocabulary JSON (packaged into the wheel)
corpus/            local corpus fixtures and historical training inputs
data/corpus_banks/ versioned Python corpus-builder inputs
scripts/           Python trainers, corpus builders, evals, and benchmarks
playground/        Python server + browser client
docs/              static browser client and copied data
assets/            benchmark charts (SVG/PNG)
tests/             Python unit, parity, and performance coverage
```

## 🔧 Retraining

Training code is Python and lives under `scripts/`, but the development machine
must not execute it. Run large corpus preparation or tokenizer training on a
separate machine with the generated data, then copy the resulting vocabulary
back into `tokenizer/vocab.json`.

```bash
# Run elsewhere; not part of local verification:
uv run python scripts/train_fast.py --help
uv run python scripts/train_resilient.py --help
uv run python scripts/eval_all.py
```

The trainer fuses alias pairs/triples before learning, translates synthetic ids
to runtime ids, and supports checkpoint/resume behavior.

## 📜 License

MIT · [github.com/vspcoderz/aicl](https://github.com/vspcoderz/aicl)
