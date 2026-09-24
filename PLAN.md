# Python conversion and tokenizer optimization

## Goal

Replace the Node.js implementation with Python across the repository, preserve lossless behavior and token compatibility, and make the 10,000-character hot paths stay below 50 ms after warm-up.

## Approach

1. Create a typed `aicl` package with cached dictionary/vocabulary loading, Python-native CLI, and stable output schemas.
2. Port the dictionary encoder/decoder, Unicode/modifier handling, Stage 2 tokenizer, stats, and terminal visualization.
3. Optimize dictionary lookup and BPE without changing outputs: immutable compiled indexes plus rank-aware linked-list merge scheduling instead of repeated full-rule scans.
4. Port the local server, tests, benchmarks, corpus builders, trainers, sweeps, and evaluation scripts to Python. Training code is ported but never executed on this machine; verification uses hand-authored fixtures and the shipped vocabulary only. Remove obsolete Node runtime/tooling only after parity checks pass.
5. Keep only the browser client code in JavaScript, since static GitHub Pages cannot execute Python. Make the Python server and runtime canonical.
6. Update packaging, README commands, and playground integration.

## Files touched

- `pyproject.toml`, `uv.lock`, `AGENT.md`, `PLAN.md`, `README.md`, `.gitignore`
- `aicl/` (new canonical Python package)
- `data/corpus_banks/`, `dict/source_data.json` (Python-owned historical inputs)
- `tests/` and `test_corpus.py`
- `scripts/*.py`, `playground/server.py`
- Browser client files only where API/data-loading integration requires changes
- Legacy Node runtime/tooling removed after Python/JS parity checks

## Verification

- `uv run python -m unittest discover -s tests -v`
- Cross-language differential fixtures before deleting Node sources
- Corpus compression and full-pipeline round-trip checks
- `uv run python scripts/eval_all.py`
- Warmed 10k-character encode/tokenize benchmark under 50 ms each; cold load reported separately
- CLI and local HTTP server smoke tests
- `uv run python -m compileall -q aicl scripts tests`

## Status

Done. Python conversion, parity checks, performance gate, acceptance evaluation, and packaging verification passed. Baseline: Node tests 131/131; corpus 2.17x stage-1 compression; 16k-character encode 219 ms/call and 9.8k-symbol tokenize 200 ms/call. Python differential: 263/263 exact; warmed 10k medians: encode 11 ms, tokenize 15 ms.
