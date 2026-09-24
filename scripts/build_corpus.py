#!/usr/bin/env python3
"""Build the historical raw/AICL corpus pair in Python.

``build_corpus_v2.py`` is a thin version-selecting wrapper around this module.
The versioned base arrays live in ``data/corpus_banks/*.json``; repetition,
synthetic sentence generation, chunking, encoding, paths, and statistics are
implemented here. Use ``--limit`` for a tiny smoke fixture; omitting it is the
historical full build.
"""

from __future__ import annotations

import argparse
import random
import sys
from pathlib import Path

try:
    from .build_bpe_corpus import AiclEncoder, _array, _shuffle
except ImportError:
    from build_bpe_corpus import AiclEncoder, _array, _shuffle


ROOT = Path(__file__).resolve().parents[1]
SOURCES = {
    variant: ROOT / "data" / "corpus_banks" / f"raw_{variant}.json"
    for variant in ("v1", "v2")
}


def _random_sentence(rng: random.Random, wordlist: list[str]) -> str:
    length = 5 + int(rng.random() * 12)
    words = [wordlist[int(rng.random() * min(4000, len(wordlist)))] for _ in range(length)]
    if rng.random() < 0.2:
        words[0] = words[0][:1].upper() + words[0][1:]
    sentence = " ".join(words)
    if rng.random() < 0.5:
        # The historical implementation indexes only the first three entries
        # even though its puncts list has seven values; retain that behavior.
        sentence += [". ", ", ", "! "][int(rng.random() * 3)]
    return sentence + " "


def build(variant: str, source: Path, dict_dir: Path, wordlist: Path, seed: int, limit: int | None = None) -> tuple[str, str, dict[str, int]]:
    if variant not in SOURCES:
        raise ValueError(f"unsupported corpus variant: {variant}")
    if not source.is_file():
        raise FileNotFoundError(source)
    base = _array(source, "base")
    parts: list[str] = []
    if variant == "v1":
        _add_repeated(parts, base, 800)
    else:
        if not wordlist.is_file():
            raise FileNotFoundError(wordlist)
        words = [line for line in wordlist.read_text(encoding="utf-8").splitlines() if line]
        _add_repeated(parts, base, 120)
        rng = random.Random(seed)
        parts.extend(_random_sentence(rng, words) for _ in range(25000))
        code = [
            'const {a,b} = obj; ',
            'let x = await fetch(url); ',
            'if (x && y || z) { return true; } ',
            'for (let i=0;i<n;i++) arr.push(i); ',
            'try { doWork(); } catch(e) { console.error(e); } ',
            'export default function foo(bar) { return bar * 2; } ',
            'import { encode } from "./encoder.js"; ',
            'db.query("SELECT * FROM table WHERE id=$1", [id]); ',
            'app.use(express.json()); ',
            'class Foo extends Bar { constructor() { super(); } } ',
        ]
        paths = [
            "/usr/local/bin/node ",
            "~/projects/aicl/src/index.js ",
            "https://cdn.example.com/lib.js?v=1 ",
            "./src/utils/helpers.ts ",
        ]
        parts.extend(code[int(rng.random() * len(code))] for _ in range(5000))
        parts.extend(paths[int(rng.random() * len(paths))] for _ in range(2000))
        _shuffle(parts, rng)
    if variant == "v1":
        _shuffle(parts, random.Random(seed))
    if limit is not None:
        parts = parts[:limit]
    raw = "\n".join(parts)
    encoder = AiclEncoder(dict_dir)
    encoded_parts: list[str] = []
    # Node's historical chunk size is 200,000 UTF-16 code units.  The source
    # strings are predominantly ASCII; use codepoint chunks for safe UTF-8
    # output while retaining the same nominal chunk size.
    chunk_size = 200_000
    for start in range(0, len(raw), chunk_size):
        encoded_parts.append(encoder.encode(raw[start : start + chunk_size]))
    aicl = "".join(encoded_parts)
    return raw, aicl, {"parts": len(parts), "raw_chars": len(raw), "aicl_chars": len(aicl)}


def _add_repeated(parts: list[str], values: list[str], times: int) -> None:
    for _ in range(times):
        parts.extend(values)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--variant", choices=tuple(SOURCES), default="v1")
    parser.add_argument("--source", type=Path)
    parser.add_argument("--dict-dir", type=Path, default=ROOT / "dict")
    parser.add_argument("--wordlist", type=Path, default=ROOT / "dict" / "wordlists" / "english.txt")
    parser.add_argument("--raw-output", type=Path, default=ROOT / "corpus" / "raw_train.txt")
    parser.add_argument("--aicl-output", type=Path, default=ROOT / "corpus" / "aicl_train.txt")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--limit", type=int, help="smoke-test cap; omit for the full historical corpus")
    return parser


def main(variant: str | None = None, argv: list[str] | None = None) -> int:
    parser = _parser()
    args = parser.parse_args(argv)
    selected = variant or args.variant
    if args.seed < 0:
        parser.error("--seed must be non-negative")
    if args.limit is not None and args.limit <= 0:
        parser.error("--limit must be positive")
    try:
        raw, aicl, stats = build(
            selected,
            (args.source or SOURCES[selected]).resolve(),
            args.dict_dir.resolve(),
            args.wordlist.resolve(),
            args.seed,
            args.limit,
        )
    except (FileNotFoundError, OSError, ValueError) as error:
        print(f"build_corpus: {error}", file=sys.stderr)
        return 2
    raw_output = args.raw_output.resolve()
    aicl_output = args.aicl_output.resolve()
    raw_output.parent.mkdir(parents=True, exist_ok=True)
    aicl_output.parent.mkdir(parents=True, exist_ok=True)
    raw_output.write_text(raw, encoding="utf-8")
    aicl_output.write_text(aicl, encoding="utf-8")
    print(f"raw corpus {selected} (seed={args.seed})")
    print(f"  parts: {stats['parts']}")
    print(f"  raw chars: {stats['raw_chars']}")
    print(f"  aicl chars: {stats['aicl_chars']}")
    print(f"  ratio: {stats['raw_chars'] / stats['aicl_chars']:.2f}x")
    print(f"  wrote: {raw_output}")
    print(f"  wrote: {aicl_output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
