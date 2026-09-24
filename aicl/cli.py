"""Command-line interface for the canonical Python AICL runtime."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Sequence

from .decoder import decode
from .encoder import encode
from .stats import stats_for
from .tokenizer import load_tokenizer, save_tokenizer, tokenize, train_tokenizer
from .vision import render


def usage() -> str:
    return """AICL — AI Compressed Language
  Stage 1: static dictionary encode/decode
  Stage 2: custom BPE tokenizer over AICL symbols

USAGE
  aicl encode [--visual] \"text\"            # text -> AICL symbols
  aicl decode \"AICL\"                       # AICL symbols -> text
  aicl stats [--visual] file               # compression stats
  aicl train <corpus> [--merges N]         # train BPE, save tokenizer/vocab.json
  aicl tok [--train <corpus>] \"text\"       # tokenize AICL -> token IDs

OPTIONS
  --visual   ANSI-colored step-by-step view
  --merges N how many BPE merges to learn (default 4096)
"""


def _read_input(spec: str | None) -> str:
    if not spec:
        return ""
    if spec == "-":
        return sys.stdin.read()
    try:
        path = Path(spec)
        if path.is_file():
            return path.read_text(encoding="utf-8")
    except (OSError, ValueError):
        pass
    return spec


def _split_args(rest: Sequence[str]) -> tuple[list[str], list[str]]:
    return [arg for arg in rest if not arg.startswith("--")], [arg for arg in rest if arg.startswith("--")]


def _flag_value(flags: list[str], name: str, default: str | None = None) -> str | None:
    try:
        index = flags.index(name)
    except ValueError:
        return default
    return flags[index + 1] if index + 1 < len(flags) else default


def main(argv: Sequence[str] | None = None) -> int:
    """Run the CLI and return its process status code."""

    arguments = list(sys.argv[1:] if argv is None else argv)
    if not arguments:
        print(usage())
        return 0

    command = arguments[0]
    rest = arguments[1:]
    positional, flags = _split_args(rest)
    has = lambda flag: flag in flags

    if command in {"--help", "-h", "help"}:
        print(usage())
        return 0

    if command == "encode":
        text = _read_input(positional[0] if positional else "")
        result = encode(text, {"steps": has("--visual")})
        if has("--visual"):
            print(render(text, result["output"], {"title": "AICL encode"}))
        else:
            print(result["output"])
            ratio = result["charsIn"] / result["charsOut"] if result["charsOut"] else 0
            print(
                f"# chars: {result['charsIn']} -> {result['charsOut']}  ({ratio:.2f}x)",
                file=sys.stderr,
            )
        return 0

    if command == "decode":
        aicl_text = _read_input(positional[0] if positional else "")
        result = decode(aicl_text)
        print(result["output"])
        if has("--stats"):
            print(f"# expansions: {result['expansions']}", file=sys.stderr)
        return 0

    if command == "stats":
        text = _read_input(positional[0] if positional else "-")
        encoded = encode(text)
        metrics = stats_for(text, encoded["output"])
        output = {
            "inputChars": metrics["originalChars"],
            "outputChars": metrics["encodedChars"],
            "ratio": metrics["ratio"],
            "matches": encoded["matches"],
            "literals": encoded["literals"],
            "symbolCount": len(metrics["symbolCount"]),
            "percentReduction": metrics["percentReduction"],
        }
        print(json.dumps(output, ensure_ascii=False, separators=(",", ":")))
        return 0

    if command == "train":
        if not positional:
            print(usage())
            return 0
        corpus_path = Path(positional[0])
        raw = corpus_path.read_text(encoding="utf-8")
        sentences = [
            sentence
            for sentence in re.split(r"(?<=[.!?])\s+", raw)
            if sentence.strip()
        ]
        aicl_sentences = [encode(sentence)["output"] for sentence in sentences]
        merges_text = _flag_value(flags, "--merges", "4096")
        num_merges = int(merges_text or "4096")
        print(
            f"Training on {len(sentences)} sentences, {num_merges} merges...",
            file=sys.stderr,
        )
        vocab = train_tokenizer(aicl_sentences, {"numMerges": num_merges, "mergeBase": 100000})
        save_tokenizer(vocab)
        print(f"Saved tokenizer/vocab.json with {vocab['numMerges']} merges", file=sys.stderr)
        return 0

    if command == "tok":
        train_path = _flag_value(flags, "--train")
        vocab = load_tokenizer()
        if train_path:
            raw = Path(train_path).read_text(encoding="utf-8")
            sentences = [
                sentence
                for sentence in re.split(r"(?<=[.!?])\s+", raw)
                if sentence.strip()
            ]
            vocab = train_tokenizer([encode(sentence)["output"] for sentence in sentences], {"numMerges": 4096})
        text = _read_input(positional[-1] if positional else "")
        aicl_text = encode(text)["output"]
        ids = tokenize(aicl_text, vocab)
        if has("--ids"):
            print(" ".join(str(token_id) for token_id in ids))
        else:
            aicl_chars = len(aicl_text)
            reduction = (1 - len(ids) / aicl_chars) * 100 if aicl_chars else 0
            print(f"AICL chars: {aicl_chars}")
            print(f"Token IDs:  {len(ids)}")
            print(f"Reduction:  {reduction:.1f}%")
        return 0

    print(f"Unknown command: {command}", file=sys.stderr)
    print(usage(), file=sys.stderr)
    return 1


if __name__ == "__main__":  # pragma: no cover
    try:
        raise SystemExit(main())
    except Exception as error:  # keep the CLI's process-level error contract
        print(error, file=sys.stderr)
        raise SystemExit(1)
