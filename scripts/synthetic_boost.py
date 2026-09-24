#!/usr/bin/env python3
"""Write the deterministic synthetic boost block used by the big corpus."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    from .build_bpe_corpus import _array
except ImportError:
    from build_bpe_corpus import _array


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT / "data" / "corpus_banks" / "synthetic.json"
DEFAULT_SEED = 424242


class LegacyLcg:
    def __init__(self, seed: int) -> None:
        self.state = seed & 0x7FFFFFFF

    def random(self) -> float:
        self.state = (self.state * 1103515245 + 12345) & 0x7FFFFFFF
        return self.state / 0x7FFFFFFF


def build(source: Path, seed: int = DEFAULT_SEED, limit: int | None = None) -> list[str]:
    benchmark = _array(source, "BENCH")
    collocations = _array(source, "COLLOCATIONS")
    camel_code = _array(source, "CAMEL_CODE")
    parts: list[str] = []
    parts.extend(benchmark * 50)
    parts.extend("it was " + value + " standard example that we prepared" for _ in range(30) for value in collocations)
    parts.extend(camel_code * 40)
    rng = LegacyLcg(seed)
    for index in range(len(parts) - 1, 0, -1):
        other = int(rng.random() * (index + 1))
        parts[index], parts[other] = parts[other], parts[index]
    return parts if limit is None else parts[:limit]


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", nargs="?", type=Path, default=Path("/dev/stdout"))
    parser.add_argument("--output", dest="output_option", type=Path)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--limit", type=int, help="smoke-test cap; omit for the full block")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.seed < 0:
        print("synthetic_boost: --seed must be non-negative", file=sys.stderr)
        return 2
    if args.limit is not None and args.limit <= 0:
        print("synthetic_boost: --limit must be positive", file=sys.stderr)
        return 2
    output = (args.output_option or args.output).resolve()
    try:
        parts = build(args.source.resolve(), args.seed, args.limit)
    except (FileNotFoundError, OSError, ValueError) as error:
        print(f"synthetic_boost: {error}", file=sys.stderr)
        return 2
    text = "\n".join(parts) + "\n"
    if str(output) == "/dev/stdout":
        sys.stdout.write(text)
    else:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(text, encoding="utf-8")
    print(f"synthetic block: {len(parts)} lines", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
