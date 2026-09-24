#!/usr/bin/env python3
"""Sweep tokenizer merge counts on a compact, boundary-preserving corpus."""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path
from typing import Any, Sequence

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

try:
    from .eval_vocab import _result_output, _tokenizer_api, evaluate, vocab_summary  # noqa: E402
    from .heldout_probes import BENCH  # noqa: E402
except ImportError:
    from eval_vocab import _result_output, _tokenizer_api, evaluate, vocab_summary  # noqa: E402
    from heldout_probes import BENCH  # noqa: E402

MERGE_COUNTS = (128, 256, 384, 512)


def _train_api() -> Any:
    try:
        from aicl.tokenizer import train_tokenizer
    except ImportError:
        from aicl import train_tokenizer  # type: ignore[attr-defined]
    return train_tokenizer


def self_check() -> None:
    assert MERGE_COUNTS == (128, 256, 384, 512)
    print("sweep_tokenizer self-check: ok")


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus", type=Path, default=ROOT / "corpus" / "aicl_train.txt")
    parser.add_argument("--self-check", action="store_true")
    args = parser.parse_args(argv)
    if args.self_check:
        self_check()
        return 0
    raw = args.corpus.read_text(encoding="utf-8")
    lines = raw.split("\n")
    train_corpus = "\n".join(line for index, line in enumerate(lines) if index % 25 == 0)
    print(f"Train corpus: {len(train_corpus)} chars, {len(train_corpus.split(chr(10)))} lines")
    train_tokenizer = _train_api()
    _load, tokenize, detokenize = _tokenizer_api()
    from aicl import decode, encode

    encoded_tests = [(name, _result_output(encode(text))) for name, text in BENCH]
    results: list[dict[str, Any]] = []
    for requested in MERGE_COUNTS:
        print(f"\nTraining {requested} merges...")
        started = time.perf_counter()
        vocab = train_tokenizer(
            [train_corpus],
            {
                "num_merges": requested,
                "merge_base": 100_000,
                "max_token_length": 5,
                "min_frequency": 2,
            },
        )
        elapsed = (time.perf_counter() - started) * 1000
        rows: list[dict[str, Any]] = []
        total_aicl = 0
        total_tokens = 0
        lossless = True
        for name, raw_text in BENCH:
            aicl_text = dict(encoded_tests)[name]
            ids = tokenize(aicl_text, vocab)
            restored = detokenize(ids, vocab)
            if isinstance(restored, dict):
                restored = restored.get("output", "")
            restored = _result_output(decode(restored))
            ok = restored == raw_text
            lossless = lossless and ok
            total_aicl += len(aicl_text)
            total_tokens += len(ids)
            rows.append(
                {
                    "name": name,
                    "aicl": len(aicl_text),
                    "tokens": len(ids),
                    "cpt": len(aicl_text) / len(ids) if ids else 0.0,
                    "roundtrip": ok,
                }
            )
        result = {
            "requested": requested,
            "actual": vocab_summary(vocab)[0],
            "cpt": total_aicl / total_tokens if total_tokens else 0.0,
            "tokens": total_tokens,
            "lossless": lossless,
            "ms": elapsed,
            "rows": rows,
        }
        results.append(result)
        print(
            f"  actual: {result['actual']}, CPT: {result['cpt']:.2f}, "
            f"{total_tokens} tokens, lossless={lossless}, {elapsed:.0f}ms"
        )
    best = min(results, key=lambda result: result["tokens"])
    print("\nSWEEP RESULTS")
    print(f"{'Req':>5} | {'Act':>5} | {'CPT':>6} | {'Tok':>7} | {'ms':>9}")
    for result in results:
        print(
            f"{result['requested']:>5} | {result['actual']:>5} | {result['cpt']:>6.2f} | "
            f"{result['tokens']:>7} | {result['ms']:>9.0f}"
        )
    print(f"\nBest: {best['requested']} merges ({best['actual']} actual) -> {best['tokens']} tokens, CPT {best['cpt']:.2f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
