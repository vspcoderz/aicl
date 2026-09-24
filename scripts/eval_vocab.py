#!/usr/bin/env python3
"""Evaluate an AICL tokenizer vocabulary on the standard probe sets."""

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
    from .heldout_probes import BENCH, HELDOUT, HELDOUT_PROBES  # noqa: E402
except ImportError:
    from heldout_probes import BENCH, HELDOUT, HELDOUT_PROBES  # noqa: E402


def _result_output(value: Any) -> str:
    if isinstance(value, dict):
        return str(value.get("output", value.get("text", "")))
    return str(getattr(value, "output", value))


def _tokenizer_api() -> tuple[Any, Any, Any]:
    try:
        from aicl.tokenizer import detokenize, load_tokenizer, tokenize
    except ImportError:
        from aicl import detokenize, load_tokenizer, tokenize  # type: ignore[attr-defined]
    return load_tokenizer, tokenize, detokenize


def _load_vocab(path: Path) -> Any:
    if not path.is_file():
        raise FileNotFoundError(f"vocabulary file not found: {path}")
    load_tokenizer, _tokenize, _detokenize = _tokenizer_api()
    try:
        return load_tokenizer(str(path))
    except TypeError:
        # Older/simpler public loaders may only load their package default.
        # Custom paths are still supported without depending on that loader.
        try:
            from .train_fast import FastVocab
        except ImportError:
            from train_fast import FastVocab

        raw = json.loads(path.read_text(encoding="utf-8"))
        return FastVocab.from_json_dict(raw)


def _field(vocab: Any, snake: str, camel: str, default: Any) -> Any:
    if isinstance(vocab, Mapping):
        return vocab.get(camel, vocab.get(snake, default))
    return getattr(vocab, snake, getattr(vocab, camel, default))


def vocab_summary(vocab: Any) -> tuple[int, int, str]:
    merge_mapping = vocab.get("merges", {}) if isinstance(vocab, Mapping) else getattr(vocab, "merges", {})
    merge_count = int(_field(vocab, "num_merges", "numMerges", len(merge_mapping)))
    max_length = int(_field(vocab, "max_token_length", "maxTokenLength", 5))
    version = str(_field(vocab, "version", "version", "1.0"))
    return merge_count, max_length, version


def evaluate(
    pairs: Sequence[tuple[str, str]],
    vocab: Any,
    *,
    tokenize: Any,
    detokenize: Any,
    decode: Any,
) -> dict[str, Any]:
    total_raw = 0
    total_aicl = 0
    total_tokens = 0
    lossless = True
    rows: list[dict[str, Any]] = []
    for name, text in pairs:
        from aicl import encode

        encoded = encode(text)
        aicl_text = _result_output(encoded)
        ids = tokenize(aicl_text, vocab)
        restored_aicl = detokenize(ids, vocab)
        if isinstance(restored_aicl, dict):
            restored_aicl = restored_aicl.get("output", "")
        restored = decode(restored_aicl)
        roundtrip = _result_output(restored) == text
        lossless = lossless and roundtrip
        raw_count = len(text)
        aicl_count = len(aicl_text)
        token_count = len(ids)
        total_raw += raw_count
        total_aicl += aicl_count
        total_tokens += token_count
        rows.append(
            {
                "name": name,
                "raw": raw_count,
                "aicl": aicl_count,
                "tokens": token_count,
                "cpt": aicl_count / token_count if token_count else 0.0,
                "roundtrip": roundtrip,
            }
        )
    return {
        "raw": total_raw,
        "aicl": total_aicl,
        "tokens": total_tokens,
        "cpt": total_aicl / total_tokens if total_tokens else 0.0,
        "lossless": lossless,
        "rows": rows,
    }


def self_check() -> None:
    assert len(BENCH) == 8
    assert len(HELDOUT) == 55
    assert set(HELDOUT_PROBES) == {"english", "code", "sql", "shell", "json", "markdown", "paths", "mixed"}
    print("eval_vocab self-check: probe sets ok")


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("vocab", nargs="?", type=Path, default=ROOT / "tokenizer" / "vocab.json")
    parser.add_argument("--strict", action="store_true", help="return non-zero on round-trip failure")
    parser.add_argument("--self-check", action="store_true")
    args = parser.parse_args(argv)
    if args.self_check:
        self_check()
        return 0
    from aicl import decode

    load_tokenizer, tokenize, detokenize = _tokenizer_api()
    vocab = _load_vocab(args.vocab)
    merge_count, max_length, version = vocab_summary(vocab)
    print(f"vocab: {merge_count} merges, maxLen={max_length}, version={version}")

    bench = evaluate(BENCH, vocab, tokenize=tokenize, detokenize=detokenize, decode=decode)
    print(
        f"bench : AICL={bench['tokens']} tokens, CPT={bench['cpt']:.2f}, "
        f"lossless={bench['lossless']}"
    )
    for row in bench["rows"]:
        print(
            f"  {row['name']:<15} AICL={row['tokens']:>3} tokens "
            f"CPT={row['cpt']:.2f} rt={'ok' if row['roundtrip'] else 'FAIL'}"
        )
    heldout = evaluate(HELDOUT, vocab, tokenize=tokenize, detokenize=detokenize, decode=decode)
    print(
        f"held55: AICL={heldout['tokens']} tokens, CPT={heldout['cpt']:.2f}, "
        f"lossless={heldout['lossless']}"
    )
    for domain, lines in HELDOUT_PROBES.items():
        result = evaluate(
            [(f"{domain}{index}", text) for index, text in enumerate(lines)],
            vocab,
            tokenize=tokenize,
            detokenize=detokenize,
            decode=decode,
        )
        print(
            f"  {domain:<9} AICL={result['tokens']:>4} tokens "
            f"CPT={result['cpt']:.2f} lossless={result['lossless']}"
        )
    all_lossless = bench["lossless"] and heldout["lossless"]
    print(f"ALL LOSSLESS: {'YES' if all_lossless else 'NO ***'}")
    return 1 if args.strict and not all_lossless else 0


if __name__ == "__main__":
    raise SystemExit(main())
