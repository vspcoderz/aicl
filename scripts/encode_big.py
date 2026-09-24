#!/usr/bin/env python3
"""Encode a large raw text file to one AICL PUA line per input line.

Python threads are used rather than Node worker threads so the tool remains
stdlib-only while still allowing independent chunks to run concurrently.  The
runtime dictionary is immutable and cached by :mod:`aicl`.
"""

from __future__ import annotations

import argparse
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Sequence

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _output(value: Any) -> str:
    if isinstance(value, dict):
        return str(value["output"])
    output = getattr(value, "output", None)
    if output is not None:
        return str(output)
    return str(value)


def self_check() -> None:
    source = ["a", "b", "c"]
    encoded = ["!" for _source in source]
    assert len(encoded) == len(source)
    print("encode_big self-check: chunk line count ok")


def encode_lines(lines: Sequence[str], workers: int) -> list[str]:
    if workers < 1:
        raise ValueError("--workers must be positive")
    chunk_count = workers * 8
    per = (len(lines) + chunk_count - 1) // chunk_count
    chunks = [list(lines[index : index + per]) for index in range(0, len(lines), per)]
    if not chunks:
        return []

    from aicl import encode

    def encode_chunk(chunk: Sequence[str]) -> list[str]:
        return [_output(encode(line)) for line in chunk]

    results: list[list[str] | None] = [None] * len(chunks)
    done = 0
    started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=min(workers, len(chunks))) as pool:
        futures = {pool.submit(encode_chunk, chunk): index for index, chunk in enumerate(chunks)}
        for future in as_completed(futures):
            index = futures[future]
            results[index] = future.result()
            done += 1
            if done % 8 == 0 or done == len(chunks):
                seconds = int(time.perf_counter() - started)
                print(f"... {done}/{len(chunks)} chunks, {seconds}s")
    return [line for result in results if result is not None for line in result]


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--in", dest="input", type=Path, help="raw newline-delimited text")
    parser.add_argument("--out", type=Path, help="AICL PUA output")
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--self-check", action="store_true")
    args = parser.parse_args(argv)
    if args.self_check:
        self_check()
        return 0
    if args.input is None or args.out is None:
        parser.error("--in and --out are required unless --self-check is used")
    lines = args.input.read_text(encoding="utf-8").split("\n")
    print(f"input: {len(lines)} lines")
    started = time.perf_counter()
    output_lines = encode_lines(lines, args.workers)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text("\n".join(output_lines), encoding="utf-8", newline="\n")
    elapsed = (time.perf_counter() - started) / 60
    print(f"DONE: encoded {len(lines)} lines in {elapsed:.1f}min -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
