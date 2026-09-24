#!/usr/bin/env python3
"""Sweep canonical Stage-2 configurations on the v4 line corpus."""

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
    from .eval_vocab import _tokenizer_api, evaluate, vocab_summary  # noqa: E402
    from .heldout_probes import BENCH  # noqa: E402
    from .train_fast import read_lines  # noqa: E402
except ImportError:
    from eval_vocab import _tokenizer_api, evaluate, vocab_summary  # noqa: E402
    from heldout_probes import BENCH  # noqa: E402
    from train_fast import read_lines  # noqa: E402

HELDOUT = [
    ("held0", "yesterday evening the deployment pipeline failed because the database migration timed out twice"),
    ("held1", "the quarterly revenue report shows significant growth across all regional markets this year"),
    ("held2", "function calculateTotal(items, taxRate) { return items.reduce((s, x) => s + x.price, 0) * (1 + taxRate); }"),
    ("held3", "every morning the engineer reviews open pull requests before merging anything into main"),
    ("held4", "INSERT INTO inventory (sku, quantity, warehouse) VALUES ($1, $2, $3) RETURNING id;"),
    ("held5", "curl -fsSL https://releases.example.org/v2.tar.gz | tar -xz && ./install --prefix ~/.local"),
]
DEFAULT_CONFIGS = (
    {"num_merges": 1024, "max_token_length": 8, "min_frequency": 2},
    {"num_merges": 2048, "max_token_length": 8, "min_frequency": 3},
    {"num_merges": 2048, "max_token_length": 10, "min_frequency": 3},
    {"num_merges": 4096, "max_token_length": 10, "min_frequency": 5},
)


def _train_api() -> Any:
    try:
        from aicl.tokenizer import train_tokenizer
    except ImportError:
        from aicl import train_tokenizer  # type: ignore[attr-defined]
    return train_tokenizer


def self_check() -> None:
    assert len(HELDOUT) == 6
    assert DEFAULT_CONFIGS[0]["num_merges"] == 1024
    print("sweep_v4 self-check: ok")


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus", type=Path, default=ROOT / "corpus" / "bpe_train.txt")
    parser.add_argument("--num-merges", type=int)
    parser.add_argument("--max-token-length", type=int)
    parser.add_argument("--min-frequency", type=int)
    parser.add_argument("--self-check", action="store_true")
    args = parser.parse_args(argv)
    if args.self_check:
        self_check()
        return 0
    lines = read_lines(args.corpus)
    print(f"corpus lines: {len(lines)}, chars: {sum(map(len, lines))}")
    train_tokenizer = _train_api()
    _load, tokenize, detokenize = _tokenizer_api()
    from aicl import decode

    results: list[dict[str, Any]] = []
    for original in DEFAULT_CONFIGS:
        config = dict(original)
        if args.num_merges is not None:
            config["num_merges"] = args.num_merges
        if args.max_token_length is not None:
            config["max_token_length"] = args.max_token_length
        if args.min_frequency is not None:
            config["min_frequency"] = args.min_frequency
        started = time.perf_counter()
        vocab = train_tokenizer(
            lines,
            {
                "num_merges": config["num_merges"],
                "merge_base": 100_000,
                "max_token_length": config["max_token_length"],
                "min_frequency": config["min_frequency"],
            },
        )
        elapsed = (time.perf_counter() - started) * 1000
        bench = evaluate(BENCH, vocab, tokenize=tokenize, detokenize=detokenize, decode=decode)
        held = evaluate(HELDOUT, vocab, tokenize=tokenize, detokenize=detokenize, decode=decode)
        result = {"config": config, "actual": vocab_summary(vocab)[0], "ms": elapsed, "bench": bench, "held": held}
        results.append(result)
        print(
            f"merges={config['num_merges']} maxLen={config['max_token_length']} "
            f"minFreq={config['min_frequency']} actual={vocab_summary(vocab)[0]} {elapsed:.0f}ms "
            f"bench={bench['tokens']} held={held['tokens']} lossless={bench['lossless'] and held['lossless']}"
        )
    print("\nSWEEP (Stage-2 CPT/win without optional GPT baselines)")
    for result in results:
        config = result["config"]
        print(
            f"req={config['num_merges']} act={result['actual']} len={config['max_token_length']} | "
            f"bench CPT={result['bench']['cpt']:.2f} | held CPT={result['held']['cpt']:.2f} | {result['ms']:.0f}ms"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
