#!/usr/bin/env python3
"""Measure Stage-1 and Stage-2 compression on the standard benchmark texts."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any, Sequence

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

try:
    from .eval_vocab import _load_vocab, _result_output, _tokenizer_api, vocab_summary  # noqa: E402
    from .heldout_probes import BENCH  # noqa: E402
except ImportError:
    from eval_vocab import _load_vocab, _result_output, _tokenizer_api, vocab_summary  # noqa: E402
    from heldout_probes import BENCH  # noqa: E402

HELDOUT = [
    "yesterday evening the deployment pipeline failed because the database migration timed out twice",
    "function calculateTotal(items, taxRate) { return items.reduce((s, x) => s + x.price, 0) * (1 + taxRate); }",
    "the quarterly revenue report shows significant growth across all regional markets this year",
]


def self_check() -> None:
    assert len(BENCH) == 8 and len(HELDOUT) == 3
    print("measure_cpt self-check: probe sets ok")


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vocab", type=Path, default=ROOT / "tokenizer" / "vocab.json")
    parser.add_argument("--self-check", action="store_true")
    args = parser.parse_args(argv)
    if args.self_check:
        self_check()
        return 0
    from aicl import encode

    _load, tokenize, _detokenize = _tokenizer_api()
    vocab = _load_vocab(args.vocab)
    merge_count, max_length, version = vocab_summary(vocab)
    print("test | raw | aiclChars | toks | stage1x | CPT | EN/tok")
    total_raw = 0
    total_aicl = 0
    total_tokens = 0
    for name, text in BENCH:
        aicl_text = _result_output(encode(text))
        tokens = tokenize(aicl_text, vocab)
        raw_count = len(text)
        aicl_count = len(aicl_text)
        token_count = len(tokens)
        total_raw += raw_count
        total_aicl += aicl_count
        total_tokens += token_count
        print(
            f"{name} | {raw_count} | {aicl_count} | {token_count} | "
            f"{(raw_count / aicl_count if aicl_count else 0):.2f} | "
            f"{(aicl_count / token_count if token_count else 0):.2f} | "
            f"{(raw_count / token_count if token_count else 0):.2f}"
        )
    print(
        f"TOTAL | {total_raw} | {total_aicl} | {total_tokens} | "
        f"{(total_raw / total_aicl if total_aicl else 0):.2f} | "
        f"{(total_aicl / total_tokens if total_tokens else 0):.2f} | "
        f"{(total_raw / total_tokens if total_tokens else 0):.2f}"
    )
    print(f"vocab {merge_count} merges maxLen={max_length} v={version}")
    print("--- held-out ---")
    for text in HELDOUT:
        aicl_text = _result_output(encode(text))
        tokens = tokenize(aicl_text, vocab)
        print(
            f"raw={len(text)} aicl={len(aicl_text)} toks={len(tokens)} "
            f"CPT={(len(aicl_text) / len(tokens) if tokens else 0):.2f} "
            f"EN/tok={(len(text) / len(tokens) if tokens else 0):.2f} :: {text[:60]}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
