#!/usr/bin/env python3
"""Stream-clean the raw large-corpus sources into interleaved text.

This is the Python port of ``prepare_raw_big.mjs``.  C4 gzip shards, WikiText,
and optional parquet code are read as streams and 400-line batches are written
round-robin.  Parquet support is optional because it is the only format that
needs a development dependency; use ``pyarrow`` when code parquet files are
requested.
"""

from __future__ import annotations

import argparse
import gzip
import json
import re
import sys
import time
from pathlib import Path
from typing import Iterable, Iterator


DEFAULT_DATA_DIR = Path("/root/data")
SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-Z\"'(])")
BATCH_SIZE = 400


def utf16_units(value: str) -> int:
    """Match JavaScript's String.length for accounting and filtering."""
    return len(value.encode("utf-16-le", errors="surrogatepass")) // 2


def is_bad_line(value: str) -> bool:
    length = utf16_units(value)
    if length < 25 or length > 400:
        return True
    units = value.encode("utf-16-le", errors="surrogatepass")
    alpha = digits = spaces = 0
    for index in range(0, len(units), 2):
        code = units[index] | (units[index + 1] << 8)
        if code == 32:
            spaces += 1
        elif 97 <= code <= 122 or 65 <= code <= 90:
            alpha += 1
        elif 48 <= code <= 57:
            digits += 1
    if alpha / length < 0.45:
        return True
    if digits / length > 0.25:
        return True
    if spaces / length < 0.05:
        return True
    return len(re.findall(r"https?://", value)) > 2


def clean_prose(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def clean_code(value: str) -> str:
    value = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", value)
    return re.sub(r"\s+$", "", value)


def split_sentences(value: str) -> list[str]:
    return SENTENCE_SPLIT.split(value)


def c4_lines(files: Iterable[Path], budget: int) -> Iterator[str]:
    written = 0
    for path in files:
        if written >= budget:
            return
        if not path.is_file():
            continue
        with gzip.open(path, "rt", encoding="utf-8", errors="replace") as handle:
            for line in handle:
                if written >= budget:
                    return
                try:
                    document = json.loads(line)
                except json.JSONDecodeError:
                    continue
                text = document.get("text")
                if not isinstance(text, str):
                    continue
                for sentence in split_sentences(text):
                    cleaned = clean_prose(sentence)
                    if is_bad_line(cleaned):
                        continue
                    yield cleaned
                    written += utf16_units(cleaned) + 1
                    if written >= budget:
                        return


def wiki_lines(path: Path, budget: int) -> Iterator[str]:
    written = 0
    if not path.is_file():
        return
    with path.open(encoding="utf-8", errors="replace") as handle:
        for line in handle:
            if written >= budget:
                return
            text = line.strip()
            if not text or text.startswith("="):
                continue
            for sentence in split_sentences(text):
                cleaned = clean_prose(sentence)
                if is_bad_line(cleaned):
                    continue
                yield cleaned
                written += utf16_units(cleaned) + 1
                if written >= budget:
                    return


def _parquet_values(path: Path) -> Iterator[str]:
    if not path.is_file():
        return
    try:
        import pyarrow.parquet as parquet
    except ImportError as error:
        raise RuntimeError(
            "parquet code input requires the optional pyarrow package"
        ) from error
    parquet_file = parquet.ParquetFile(path)
    for batch in parquet_file.iter_batches(batch_size=256, columns=["func_code_string"]):
        for value in batch.column("func_code_string"):
            if value is not None:
                yield str(value.as_py() if hasattr(value, "as_py") else value)


def code_lines(path: Path, budget: int) -> Iterator[str]:
    written = 0
    for code in _parquet_values(path):
        for raw in code.split("\n"):
            line = clean_code(raw)
            if len(line) < 20 or len(line) > 400:
                continue
            if any(ord(char) < 32 and char not in "\t" or ord(char) > 126 for char in line):
                continue
            alpha = spaces = 0
            for char in line:
                if char == " ":
                    spaces += 1
                elif "a" <= char <= "z" or "A" <= char <= "Z":
                    alpha += 1
            if alpha / len(line) < 0.3 or spaces / len(line) < 0.04:
                continue
            yield line
            written += utf16_units(line) + 1
            if written >= budget:
                return


def take(iterator: Iterator[str], count: int) -> list[str]:
    result: list[str] = []
    for value in iterator:
        result.append(value)
        if len(result) >= count:
            break
    return result


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", "--output", dest="out", type=Path, default=DEFAULT_DATA_DIR / "raw_big.txt")
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    parser.add_argument("--c4-file", type=Path, action="append", dest="c4_files")
    parser.add_argument("--wiki-file", type=Path)
    parser.add_argument("--python-parquet", type=Path)
    parser.add_argument("--js-parquet", type=Path)
    parser.add_argument("--c4-chars", type=int, default=900_000_000)
    parser.add_argument("--wiki-chars", type=int, default=300_000_000)
    parser.add_argument("--code-chars", type=int, default=500_000_000)
    parser.add_argument("--batch-size", type=int, default=BATCH_SIZE)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    for name, value in (("--c4-chars", args.c4_chars), ("--wiki-chars", args.wiki_chars), ("--code-chars", args.code_chars)):
        if value < 0:
            print(f"prepare_raw_big: {name} must be non-negative", file=sys.stderr)
            return 2
    if args.batch_size <= 0:
        print("prepare_raw_big: --batch-size must be positive", file=sys.stderr)
        return 2
    data_dir = args.data_dir.resolve()
    c4_files = [path.resolve() for path in args.c4_files] if args.c4_files else [data_dir / f"c4_0000{index}.json.gz" for index in range(4)]
    wiki_file = (args.wiki_file or data_dir / "wikitext-103-raw" / "wiki.train.raw").resolve()
    python_file = (args.python_parquet or data_dir / "csn_python.parquet").resolve()
    js_file = (args.js_parquet or data_dir / "csn_js.parquet").resolve()
    output = args.out.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    c4_done = wiki_done = code_done = False
    total = 0
    last_log = 0
    started = time.monotonic()
    g_c4 = c4_lines(c4_files, args.c4_chars)
    g_wiki = wiki_lines(wiki_file, args.wiki_chars)
    g_python = code_lines(python_file, args.code_chars // 2)
    g_js = code_lines(js_file, args.code_chars // 2)
    try:
        with output.open("w", encoding="utf-8", buffering=1024 * 1024) as handle:
            while not (c4_done and wiki_done and code_done):
                if not c4_done:
                    batch = take(g_c4, args.batch_size)
                    c4_done = not batch
                    for line in batch:
                        handle.write(line + "\n")
                        total += utf16_units(line) + 1
                if not wiki_done:
                    batch = take(g_wiki, args.batch_size)
                    wiki_done = not batch
                    for line in batch:
                        handle.write(line + "\n")
                        total += utf16_units(line) + 1
                if not code_done:
                    python_batch = take(g_python, args.batch_size // 2)
                    js_batch = take(g_js, args.batch_size // 2)
                    code_done = not python_batch and not js_batch
                    for line in python_batch + js_batch:
                        handle.write(line + "\n")
                        total += utf16_units(line) + 1
                if total - last_log >= 100_000_000:
                    last_log = total
                    print(f"... {total / 1e6:.0f}M chars, {int(time.monotonic() - started)}s")
    except (OSError, RuntimeError) as error:
        print(f"prepare_raw_big: {error}", file=sys.stderr)
        return 2
    print(f"DONE: {total} chars -> {output} in {(time.monotonic() - started) / 60:.1f}min")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
