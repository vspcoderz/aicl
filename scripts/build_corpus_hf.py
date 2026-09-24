#!/usr/bin/env python3
"""Build or extend the large HF-backed corpus with configurable paths.

The old ``build_corpus_hf.py`` and ``build_corpus_hf_p2.py`` were separate
one-shot jobs.  This consolidated Python entry point keeps their mixture and
append semantics explicit while making the target, source paths, and optional
reader dependencies CLI-configurable.  ``datasets`` is imported only when an
HF stream is requested; parquet input uses optional ``pyarrow``.
"""

from __future__ import annotations

import argparse
import random
import sys
from pathlib import Path
from typing import Any, Iterator


DEFAULT_OUTPUT = Path("/root/data/aicl_corpus.txt")
DEFAULT_MAX_EXAMPLE_BYTES = 1024 * 1024
CODE_LANGS = ["python", "javascript", "typescript", "java", "go", "c++", "rust", "shell"]
SEED = 42


def _load_dataset(*args: Any, **kwargs: Any) -> Any:
    try:
        from datasets import load_dataset
    except ImportError as error:
        raise RuntimeError(
            "HF corpus streams require the optional 'datasets' package"
        ) from error
    return load_dataset(*args, **kwargs)


def _mb(value: int) -> float:
    return value / 1024 / 1024


def _pick(row: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = row.get(key)
        if isinstance(value, str) and value:
            return value
    return ""


def _write_text(handle: Any, text: str, max_example_bytes: int) -> int:
    if not text:
        return 0
    text = text.strip()
    if not text:
        return 0
    encoded = text.encode("utf-8", errors="ignore")
    if len(encoded) > max_example_bytes:
        encoded = encoded[:max_example_bytes]
    handle.write(encoded)
    handle.write(b"\n\n")
    return len(encoded) + 2


def _progress(category: str, written: int, target: int) -> None:
    percent = min(100, written / target * 100) if target else 100.0
    print(f"\r[{category:9}] {_mb(written):8.1f} / {_mb(target):8.1f} MB ({percent:5.1f}%)", end="", flush=True)


def _english_stream() -> Iterator[str]:
    print("\nLoading FineWeb...")
    dataset = _load_dataset("HuggingFaceFW/fineweb", name="CC-MAIN-2024-10", split="train", streaming=True)
    for row in dataset:
        text = row.get("text")
        if text:
            yield text


def _code_stream(rng: random.Random, languages: list[str]) -> Iterator[str]:
    attempted: set[str] = set()
    while True:
        language = rng.choice(languages)
        attempted.add(language)
        print(f"\nLoading code language: {language}")
        try:
            dataset = _load_dataset("bigcode/the-stack-smol", data_dir=f"data/{language}", split="train", streaming=True)
        except Exception as error:  # dataset/network failures are isolated per language
            print(f"\nWarning: couldn't load {language}: {error}")
            if attempted >= set(languages):
                return
            continue
        for row in dataset:
            content = _pick(row, "content", "text", "code")
            if content:
                yield content
        if attempted >= set(languages):
            return


def _sql_stream() -> Iterator[str]:
    print("\nLoading SQL (the-stack-smol data/sql)...")
    dataset = _load_dataset("bigcode/the-stack-smol", data_dir="data/sql", split="train", streaming=True)
    for row in dataset:
        text = _pick(row, "content", "text", "code")
        if text:
            yield text


def _markdown_stream() -> Iterator[str]:
    print("\nLoading Markdown (the-stack-smol data/markdown)...")
    dataset = _load_dataset("bigcode/the-stack-smol", data_dir="data/markdown", split="train", streaming=True)
    for row in dataset:
        text = _pick(row, "content", "text", "code")
        if text:
            yield text


def _full_streams(rng: random.Random, languages: list[str]) -> dict[str, Iterator[str]]:
    return {
        "english": _english_stream(),
        "code": _code_stream(rng, languages),
        "sql": _sql_stream(),
        "markdown": _markdown_stream(),
    }


def _collect(category: str, stream: Iterator[str], target: int, handle: Any, max_example_bytes: int) -> tuple[int, int]:
    print(f"\n\n=== {category.upper()} target: {_mb(target):.1f} MB ===")
    written = 0
    examples = 0
    for text in stream:
        written += _write_text(handle, text, max_example_bytes)
        examples += 1
        if examples % 100 == 0:
            _progress(category, written, target)
        if written >= target:
            break
    print(f"\n{category}: {_mb(written):.1f} MB from {examples:,} examples")
    return written, examples


def _local_code_stream(paths: list[Path]) -> Iterator[str]:
    try:
        import pyarrow.parquet as parquet
    except ImportError as error:
        raise RuntimeError("local code parquet requires the optional 'pyarrow' package") from error
    for path in paths:
        print(f"\nReading {path} ...")
        parquet_file = parquet.ParquetFile(path)
        for batch in parquet_file.iter_batches(batch_size=256, columns=["func_code_string"]):
            for value in batch.column("func_code_string"):
                if value is not None:
                    yield str(value.as_py() if hasattr(value, "as_py") else value)


def _p2_sql_stream() -> Iterator[str]:
    print("\nLoading gretelai/synthetic_text_to_sql (public)...")
    dataset = _load_dataset("gretelai/synthetic_text_to_sql", split="train", streaming=True)
    for row in dataset:
        sql = row.get("sql", "")
        prompt = row.get("sql_prompt", "")
        context = row.get("sql_context", "")
        yield (prompt + "\n" + context + "\n" + sql) if prompt or context else sql


def _p2_markdown_stream() -> Iterator[str]:
    print("\nLoading FineWeb markdown-filtered...")
    signals = ("# ", "## ", "### ", "```", "- ", "* ", "> ", "](http")
    dataset = _load_dataset("HuggingFaceFW/fineweb", name="CC-MAIN-2024-10", split="train", streaming=True)
    for row in dataset:
        text = row.get("text", "")
        if text and sum(1 for signal in signals if signal in text) >= 3:
            yield text


def _p2_append(args: argparse.Namespace) -> None:
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    targets = {
        "code": args.p2_code_bytes,
        "sql": args.p2_sql_bytes,
        "markdown": args.p2_markdown_bytes,
    }
    with output.open("ab", buffering=1024 * 1024) as handle:
        _collect("code", _local_code_stream([args.python_parquet.resolve(), args.js_parquet.resolve()]), targets["code"], handle, args.max_example_bytes)
        _collect("sql", _p2_sql_stream(), targets["sql"], handle, args.max_example_bytes)
        _collect("markdown", _p2_markdown_stream(), targets["markdown"], handle, args.max_example_bytes)
    print(f"\nDONE. Total corpus: {_mb(output.stat().st_size):.1f} MB -> {output}")


def _full_build(args: argparse.Namespace) -> None:
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        print(f"\nRemoving existing {output}")
        output.unlink()
    target_bytes = int(args.target_gb * 1024**3)
    allocations = {
        "english": 0.45,
        "code": 0.35,
        "sql": 0.10,
        "markdown": 0.10,
    }
    rng = random.Random(args.seed)
    streams = _full_streams(rng, args.code_languages)
    with output.open("wb", buffering=1024 * 1024) as handle:
        for category, fraction in allocations.items():
            _collect(category, streams[category], int(target_bytes * fraction), handle, args.max_example_bytes)
    size = output.stat().st_size
    print("\n" + "=" * 60)
    print("DONE")
    print("=" * 60)
    print(f"File:     {output}")
    print(f"Size:     {_mb(size):.2f} MB")
    print(f"Bytes:    {size:,}")
    print(f"Target:   {args.target_gb:.2f} GB")
    print("=" * 60)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=("full", "p2"), default="full")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--target-gb", type=float, default=1.0)
    parser.add_argument("--seed", type=int, default=SEED)
    parser.add_argument("--max-example-bytes", type=int, default=DEFAULT_MAX_EXAMPLE_BYTES)
    parser.add_argument("--code-language", action="append", dest="code_languages", choices=CODE_LANGS)
    parser.add_argument("--python-parquet", type=Path, default=Path("/root/data/csn_python.parquet"))
    parser.add_argument("--js-parquet", type=Path, default=Path("/root/data/csn_js.parquet"))
    parser.add_argument("--p2-code-bytes", type=int, default=350_000_000)
    parser.add_argument("--p2-sql-bytes", type=int, default=100_000_000)
    parser.add_argument("--p2-markdown-bytes", type=int, default=100_000_000)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.target_gb < 0 or args.max_example_bytes <= 0:
        print("build_corpus_hf: target and max example sizes must be non-negative/positive", file=sys.stderr)
        return 2
    if any(value < 0 for value in (args.p2_code_bytes, args.p2_sql_bytes, args.p2_markdown_bytes)):
        print("build_corpus_hf: p2 targets must be non-negative", file=sys.stderr)
        return 2
    if not args.code_languages:
        args.code_languages = CODE_LANGS
    try:
        if args.mode == "p2":
            _p2_append(args)
        else:
            _full_build(args)
    except (OSError, RuntimeError) as error:
        print(f"build_corpus_hf: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
