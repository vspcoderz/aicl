#!/usr/bin/env python3
"""Retrain the shipped Stage-2 vocabulary and run the final probe evaluation."""

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
    from .eval_vocab import _result_output, _tokenizer_api  # noqa: E402
    from .heldout_probes import BENCH  # noqa: E402
    from .train_fast import read_lines, save_vocab, train_tokenizer_fast  # noqa: E402
except ImportError:
    from eval_vocab import _result_output, _tokenizer_api  # noqa: E402
    from heldout_probes import BENCH  # noqa: E402
    from train_fast import read_lines, save_vocab, train_tokenizer_fast  # noqa: E402


def self_check() -> None:
    corpus = [chr(0xF0000) + chr(0xF0001)] * 2
    vocab = train_tokenizer_fast(corpus, num_merges=1, min_frequency=2)
    assert vocab.num_merges == 1
    print("retrain_final self-check: ok")


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus", type=Path, default=ROOT / "corpus" / "bpe_train_blend.txt")
    parser.add_argument("--out", type=Path, default=ROOT / "tokenizer" / "vocab.json")
    parser.add_argument("--num-merges", type=int, default=8192)
    parser.add_argument("--max-token-length", type=int, default=14)
    parser.add_argument("--min-frequency", type=int, default=2)
    parser.add_argument("--merge-base", type=int, default=100_000)
    parser.add_argument("--no-save", action="store_true")
    parser.add_argument("--self-check", action="store_true")
    args = parser.parse_args(argv)
    if args.self_check:
        self_check()
        return 0
    lines = read_lines(args.corpus)
    print(f"Train corpus: {len(lines)} lines")
    started = time.perf_counter()
    vocab = train_tokenizer_fast(
        lines,
        num_merges=args.num_merges,
        merge_base=args.merge_base,
        max_token_length=args.max_token_length,
        min_frequency=args.min_frequency,
    )
    elapsed = (time.perf_counter() - started) * 1000
    print(f"Trained in {elapsed:.0f}ms - {vocab.num_merges} merges")
    if not args.no_save:
        save_vocab(vocab, args.out)
        print(f"Saved to {args.out}")

    from aicl import decode, encode

    _load, tokenize, detokenize = _tokenizer_api()
    rows: list[dict[str, Any]] = []
    total_raw = 0
    total_aicl = 0
    total_tokens = 0
    lossless = True
    for name, text in BENCH:
        aicl_text = _result_output(encode(text))
        ids = tokenize(aicl_text, vocab)
        restored = detokenize(ids, vocab)
        if isinstance(restored, dict):
            restored = restored.get("output", "")
        roundtrip = _result_output(decode(restored)) == text
        raw_len = len(text)
        aicl_len = len(aicl_text)
        lossless = lossless and roundtrip
        total_raw += raw_len
        total_aicl += aicl_len
        total_tokens += len(ids)
        rows.append(
            {
                "name": name,
                "raw": raw_len,
                "aicl": aicl_len,
                "tokens": len(ids),
                "cpt": aicl_len / len(ids) if ids else 0.0,
                "roundtrip": roundtrip,
            }
        )
    print("\nFINAL EVALUATION")
    print(f"{'Test':>16} | {'Raw':>5} | {'AICL':>5} | {'Tok':>5} | {'CPT':>6} | Roundtrip")
    for row in rows:
        print(
            f"{row['name']:>16} | {row['raw']:>5} | {row['aicl']:>5} | {row['tokens']:>5} | "
            f"{row['cpt']:>6.2f} | {'ok' if row['roundtrip'] else 'FAIL'}"
        )
    print(
        f"TOTAL | {total_raw} | {total_aicl} | {total_tokens} | "
        f"{(total_aicl / total_tokens if total_tokens else 0):.2f} | lossless={lossless}"
    )
    print(
        f"Stage 1: {total_raw / total_aicl if total_aicl else 0:.2f}x · "
        f"Stage 2: {total_aicl / total_tokens if total_tokens else 0:.2f}x · "
        f"Total: {total_raw / total_tokens if total_tokens else 0:.2f}x"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
