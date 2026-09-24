#!/usr/bin/env python3
"""Checkpoint/resume wrapper for long, full-corpus Stage-2 training runs.

A killed host process can be restarted without losing the learned prefix: the
WIP file stores the exact JSON merge list and the next invocation only learns
the missing tail.  Defaults are repository-relative rather than the old
container-specific ``/root`` paths, and every path is overridable.
"""

from __future__ import annotations

import argparse
import json
import resource
import sys
import time
from pathlib import Path
from typing import Any, Sequence

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

try:
    from .train_fast import (  # noqa: E402
        DEFAULT_MERGE_BASE,
        DEFAULT_TRAILING_SPACE_CODEPOINTS,
        FastVocab,
        read_lines,
        save_vocab,
        train_tokenizer_fast,
    )
except ImportError:
    from train_fast import (  # noqa: E402
        DEFAULT_MERGE_BASE,
        DEFAULT_TRAILING_SPACE_CODEPOINTS,
        FastVocab,
        read_lines,
        save_vocab,
        train_tokenizer_fast,
    )


def _rss_mb() -> float:
    try:
        return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0
    except (AttributeError, OSError):
        return 0.0


def _read_wip(path: Path) -> tuple[list[tuple[int, Any]], int]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    merges = raw.get("merges")
    if not isinstance(merges, list):
        raise ValueError(f"{path} has no merge list")
    aliases = sum(
        1
        for _token_id, rule in merges
        if isinstance(rule, dict) and rule.get("alias") is True
    )
    return [(int(token_id), rule) for token_id, rule in merges], aliases


def self_check() -> None:
    a = chr(0xF0000)
    b = chr(0xF0001)
    corpus = [a + b + a + b, a + b + a + b]
    first = train_tokenizer_fast(corpus, num_merges=1, min_frequency=2)
    second = train_tokenizer_fast(corpus, num_merges=2, init_merges=first.to_json_dict()["merges"])
    assert second.num_merges == 2
    assert list(second.merges)[:1] == [100000]
    print("train_resilient self-check: ok")


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--in", dest="input", type=Path, default=ROOT / "data" / "sample_pua3.txt")
    parser.add_argument("--wip", type=Path, default=ROOT / "data" / "vocab_wip.json")
    parser.add_argument("--out", type=Path, default=ROOT / "data" / "vocab_big3.json")
    parser.add_argument("--target-learned", type=int, default=32_768)
    parser.add_argument("--checkpoint", type=int, default=4_000)
    parser.add_argument("--merge-base", type=int, default=DEFAULT_MERGE_BASE)
    parser.add_argument("--max-token-length", type=int, default=14)
    parser.add_argument("--min-frequency", type=int, default=2)
    parser.add_argument("--learn-every", type=int, default=4)
    parser.add_argument("--alias-trailing-space", action="store_true", default=True)
    parser.add_argument("--no-alias-trailing-space", dest="alias_trailing_space", action="store_false")
    parser.add_argument(
        "--trailing-space-codepoints",
        type=lambda value: tuple(int(item, 0) for item in value.split(",")),
        default=DEFAULT_TRAILING_SPACE_CODEPOINTS,
    )
    parser.add_argument("--self-check", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.self_check:
        self_check()
        return 0
    if args.target_learned < 1 or args.checkpoint < 1:
        _parser().error("target and checkpoint must be positive")
    lines = read_lines(args.input)
    print(f"corpus lines: {len(lines)} chars: {sum(len(line) for line in lines)}")

    prefix: list[tuple[int, Any]] | None = None
    target_total = args.target_learned
    if args.wip.exists():
        prefix, prefix_aliases = _read_wip(args.wip)
        target_total = prefix_aliases + args.target_learned
        print(f"resuming from {len(prefix)} merges ({prefix_aliases} aliases) -> target {target_total}")

    started = time.perf_counter()

    def progress(done: int, total: int, vocab: FastVocab) -> None:
        elapsed = (time.perf_counter() - started) / 60
        if done % 100 == 0:
            print(f"learned {done}/{total} {elapsed:.1f}min rss {_rss_mb():.0f}MB")
        if done % args.checkpoint == 0 or done == total:
            save_vocab(vocab, args.wip)
            print(f"CHECKPOINT {vocab.num_merges} total merges saved ({elapsed:.1f}min)")

    vocab = train_tokenizer_fast(
        lines,
        num_merges=target_total,
        merge_base=args.merge_base,
        max_token_length=args.max_token_length,
        min_frequency=args.min_frequency,
        alias_trailing_space=args.alias_trailing_space,
        trailing_space_code_points=args.trailing_space_codepoints,
        learn_every=args.learn_every,
        skip_degenerate_pairs=True,
        init_merges=prefix,
        on_progress=progress,
    )
    elapsed = (time.perf_counter() - started) / 60
    print(
        f"trained {vocab.num_merges} merges "
        f"({vocab.aliases} aliases + {vocab.num_merges - vocab.aliases} learned) "
        f"in {elapsed:.1f}min"
    )
    save_vocab(vocab, args.out)
    save_vocab(vocab, args.wip)
    print(f"saved {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
