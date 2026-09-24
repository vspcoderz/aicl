#!/usr/bin/env python3
"""One-shot acceptance evaluation for an AICL vocabulary.

The checks mirror the legacy acceptance script: merge-table sanity, the eight
benchmark texts, the checked-in held-out probes, and the optional unseen
corpus JSON.  It uses only the public Python runtime and the standard library.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Mapping
from pathlib import Path
from typing import Any, Sequence

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

try:
    from .eval_vocab import (  # noqa: E402
        _load_vocab,
        _tokenizer_api,
        evaluate,
        self_check as eval_vocab_self_check,
        vocab_summary,
    )
    from .heldout_probes import BENCH, HELDOUT, HELDOUT_PROBES  # noqa: E402
except ImportError:
    from eval_vocab import (  # noqa: E402
        _load_vocab,
        _tokenizer_api,
        evaluate,
        self_check as eval_vocab_self_check,
        vocab_summary,
    )
    from heldout_probes import BENCH, HELDOUT, HELDOUT_PROBES  # noqa: E402


def structural_sanity(vocab: Any) -> tuple[int, int, int]:
    merge_count, _max_length, _version = vocab_summary(vocab)
    merges = vocab.get("merges", {}) if isinstance(vocab, Mapping) else getattr(vocab, "merges", {})
    entries = merges.items() if isinstance(merges, Mapping) else merges
    seen_pairs: set[tuple[int, int]] = set()
    duplicates = 0
    bad_ranks = 0
    aliases = 0
    merge_base = int(
        vocab.get("mergeBase", vocab.get("merge_base", 100000))
        if isinstance(vocab, Mapping)
        else getattr(vocab, "merge_base", getattr(vocab, "mergeBase", 100000))
    )
    for token_id, rule in entries:
        if isinstance(rule, Mapping):
            if rule.get("alias") is True:
                aliases += 1
                continue
            rank = rule.get("rank")
            pair = (int(rule["a"]), int(rule["b"]))
        else:
            rank = rule[2] if len(rule) > 2 else None
            pair = (int(rule[0]), int(rule[1]))
        if rank != int(token_id) - merge_base:
            bad_ranks += 1
        if pair in seen_pairs:
            duplicates += 1
        seen_pairs.add(pair)
    return duplicates, bad_ranks, aliases


def _unseen(path: Path) -> dict[str, list[str]]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError("unseen evaluation file must contain an object")
    return {str(domain): [str(line) for line in lines] for domain, lines in raw.items()}


def self_check() -> None:
    eval_vocab_self_check()
    print("eval_all self-check: acceptance inputs ok")


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("vocab", nargs="?", type=Path, default=ROOT / "tokenizer" / "vocab.json")
    parser.add_argument("--unseen", type=Path, default=Path(__file__).with_name("unseen_eval.json"))
    parser.add_argument("--skip-unseen", action="store_true")
    parser.add_argument("--strict", action="store_true")
    parser.add_argument("--self-check", action="store_true")
    args = parser.parse_args(argv)
    if args.self_check:
        self_check()
        return 0

    from aicl import decode

    _load, tokenize, detokenize = _tokenizer_api()
    vocab = _load_vocab(args.vocab)
    merge_count, max_length, _version = vocab_summary(vocab)
    duplicates, bad_ranks, aliases = structural_sanity(vocab)
    print(f"vocab: {merge_count} rules ({aliases} alias + {merge_count - aliases} learned), maxLen={max_length}")
    print(f"sanity: duplicate learned pairs={duplicates} bad ranks={bad_ranks}")
    if duplicates or bad_ranks:
        print("*** FAIL: vocabulary merge table is structurally invalid ***")

    bench = evaluate(BENCH, vocab, tokenize=tokenize, detokenize=detokenize, decode=decode)
    print("\n== bench-8 ==")
    print(f"bench : AICL={bench['tokens']} tokens, CPT={bench['cpt']:.2f}, lossless={bench['lossless']}")
    for row in bench["rows"]:
        print(f"  {row['name']:<15} AICL={row['tokens']:>3} CPT={row['cpt']:.2f} rt={'ok' if row['roundtrip'] else 'FAIL'}")

    held = evaluate(HELDOUT, vocab, tokenize=tokenize, detokenize=detokenize, decode=decode)
    print("\n== held-out probes ==")
    print(f"held55: AICL={held['tokens']} tokens, CPT={held['cpt']:.2f}, lossless={held['lossless']}")
    for domain, lines in HELDOUT_PROBES.items():
        result = evaluate(
            [(f"{domain}{index}", text) for index, text in enumerate(lines)],
            vocab,
            tokenize=tokenize,
            detokenize=detokenize,
            decode=decode,
        )
        print(f"  {domain:<9} AICL={result['tokens']:>4} CPT={result['cpt']:.2f} lossless={result['lossless']}")

    all_lossless = bench["lossless"] and held["lossless"]
    if not args.skip_unseen:
        print("\n== unseen corpus ==")
        unseen = _unseen(args.unseen)
        for domain, lines in unseen.items():
            result = evaluate(
                [(f"{domain}{index}", text) for index, text in enumerate(lines)],
                vocab,
                tokenize=tokenize,
                detokenize=detokenize,
                decode=decode,
            )
            all_lossless = all_lossless and result["lossless"]
            print(
                f"  {domain:<9} lines={len(lines):>3} AICL={result['tokens']:>5} "
                f"CPT={result['cpt']:.2f} lossless={result['lossless']}"
            )
    print(f"\nALL LOSSLESS: {'YES' if all_lossless else 'NO ***'}")
    return 1 if args.strict and (duplicates or bad_ranks or not all_lossless) else 0


if __name__ == "__main__":
    raise SystemExit(main())
