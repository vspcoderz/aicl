# AICL contributor rules

## Project shape

- Python 3.11+ owns the runtime library, dictionary data, Stage 2 tokenizer, CLI, training/evaluation tools, tests, and the local playground server.
- Browser code under `docs/` and `playground/` remains JavaScript because browsers do not execute Python. Keep browser logic isolated; never make it the canonical implementation of runtime algorithms.
- Runtime code uses the standard library unless a dependency measurably buys correctness or performance. Development dependencies belong in an optional dependency group.
- Load package data through `importlib.resources`; code must work from an installed wheel and from a source checkout.

## Commands

```bash
uv sync --dev
uv run python -m unittest discover -s tests -v
uv run python test_corpus.py
uv run python scripts/benchmark.py
uv run python scripts/eval_all.py
uv run python -m aicl stats "SELECT * FROM users"
uv run python -m compileall -q aicl scripts tests
```

## Coding standards

- Public functions and data structures carry type hints. Prefer small, explicit functions over clever metaprogramming.
- Use `pathlib.Path`, `json`, and other standard-library modules directly. Do not add a framework for a small CLI or local server.
- Do not rebuild dictionary indexes or vocabularies on every call. Cache immutable runtime data; return defensive copies only where callers can mutate shared state.
- Keep JSON schemas stable across Python and browser clients.
- Do not silently change encoded output, token IDs, compression behavior, or public API shape. If a deliberate change is required, document it and add migration coverage.
- Validate paths, input types, CLI arguments, and decoded UTF-8 boundaries. Never interpolate shell commands.

## Testing and performance

- Do not execute any tokenizer training or retraining code on the development machine, even on a tiny corpus, unless the user explicitly approves it. Trainer changes get import, compile, and static checks only; runtime tests use the shipped vocabulary or hand-authored merge fixtures.
- Do not run full-corpus, large-corpus, sweep, or vocabulary-generation jobs here.
- Every behavior change needs a regression test. Full-pipeline round trips are mandatory: `decode(tokenize(encode(text))) == text`.
- Run focused tests while iterating and the full suite before completion.
- Benchmark warmed steady-state performance; discard import/load time from hot-path measurements and report it separately.
- The hot-path budget is under 50 ms for 10,000 raw characters for each of encoding and tokenization on the development machine. Preserve or improve token counts unless a tokenizer change is explicitly approved.
