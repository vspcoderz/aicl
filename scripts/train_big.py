#!/usr/bin/env python3
"""Train the large Stage-2 vocabulary from a Stage-1 PUA corpus.

The legacy trainer used a RAM-sized prefix of ``sample_pua.txt``.  This port
keeps the same default limits while making every path and limit an argparse
option, so a small fixture can be used without starting a full-corpus job.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path
from typing import Sequence

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

try:
    from .train_fast import (  # noqa: E402
        DEFAULT_MERGE_BASE,
        DEFAULT_TRAILING_SPACE_CODEPOINTS,
        FastVocab,
        save_vocab,
        train_tokenizer_fast,
    )
except ImportError:
    from train_fast import (  # noqa: E402
        DEFAULT_MERGE_BASE,
        DEFAULT_TRAILING_SPACE_CODEPOINTS,
        FastVocab,
        save_vocab,
        train_tokenizer_fast,
    )


def read_prefix(path: Path, take: int) -> list[str]:
    """Read at most ``take`` Unicode characters and snap to a line boundary."""

    if take < 1:
        raise ValueError("--take must be positive")
    with path.open("r", encoding="utf-8", newline="") as handle:
        text = handle.read(take)
    last_newline = text.rfind("\n")
    if last_newline > 0:
        text = text[:last_newline]
    return text.split("\n")


def self_check() -> None:
    corpus = [chr(0xF0000) + chr(0xF0001) + chr(0xF0000) + chr(0xF0001)] * 2
    vocab = train_tokenizer_fast(corpus, num_merges=1, max_token_length=5, min_frequency=2)
    assert isinstance(vocab, FastVocab)
    assert vocab.num_merges == 1
    print("train_big self-check: ok")


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--in", dest="input", type=Path, help="Stage-1 PUA corpus")
    parser.add_argument("--out", type=Path, default=ROOT / "tokenizer" / "vocab.json")
    parser.add_argument("--learned", "--num-merges", dest="learned", type=int, default=24_000)
    parser.add_argument("--maxlen", "--max-token-length", dest="maxlen", type=int, default=14)
    parser.add_argument("--take", type=int, default=300_000_000, help="maximum Unicode characters to read")
    parser.add_argument("--merge-base", type=int, default=DEFAULT_MERGE_BASE)
    parser.add_argument("--min-frequency", type=int, default=2)
    parser.add_argument("--learn-every", type=int, default=1)
    parser.add_argument("--skip-degenerate-pairs", action="store_true")
    parser.add_argument(
        "--trailing-space-codepoints",
        type=lambda value: tuple(int(item, 0) for item in value.split(",")),
        default=DEFAULT_TRAILING_SPACE_CODEPOINTS,
        help="comma-separated hexadecimal/decimal PUA code points",
    )
    parser.add_argument("--self-check", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.self_check:
        self_check()
        return 0
    if args.input is None:
        _parser().error("--in is required unless --self-check is used")
    lines = read_prefix(args.input, args.take)
    print(f"training on {len(lines)} lines, ~{sum(len(line) for line in lines) / 1e6:.0f}M PUA chars")
    started = time.perf_counter()
    vocab = train_tokenizer_fast(
        lines,
        num_merges=args.learned,
        merge_base=args.merge_base,
        max_token_length=args.maxlen,
        min_frequency=args.min_frequency,
        alias_trailing_space=True,
        trailing_space_code_points=args.trailing_space_codepoints,
        learn_every=args.learn_every,
        skip_degenerate_pairs=args.skip_degenerate_pairs,
        on_progress=lambda done, total, _vocab: print(
            f"learned {done}/{total}", file=sys.stderr
        )
        if done == total or done % 100 == 0
        else None,
    )
    elapsed = (time.perf_counter() - started) / 60
    print(
        f"trained {vocab.num_merges} merges "
        f"({vocab.aliases} aliases + {vocab.num_merges - vocab.aliases} learned) "
        f"in {elapsed:.1f}min"
    )
    save_vocab(vocab, args.out)
    print(f"saved {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
