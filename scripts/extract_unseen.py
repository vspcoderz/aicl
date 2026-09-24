#!/usr/bin/env python3
"""Extract deterministic unseen evaluation lines from a labelled corpus."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import TextIO

CONTAMINATION = (
    "quick brown fox",
    "rain in spain",
    "emergency broadcast",
    "brown cow",
    "express()",
    "app.get(",
    "created_at DESC",
    "PRIMARY KEY,name",
    "john@example.com",
    "per_page",
    "Hello, World!",
    "hyprland.conf",
    "git@host:user",
    "aicl is Goated",
)

_CODE_START = re.compile(
    r"(?:def |function |class |const |let |var |import |from |export |return |if\s*\(|for\s*\(|while\s*\(|elif |print\(|@)\b"
)
_CODE_SHAPE = re.compile(r"=>|;\s*$|\{\s*$|^\s+\}|^\s*[a-z_][\w.]*\(")
_SQL = re.compile(
    r"\b(?:SELECT|INSERT INTO|CREATE TABLE|UPDATE\s+\w+\s+SET|DELETE FROM|ALTER TABLE|GROUP BY|ORDER BY)\b"
)
_MARKDOWN = re.compile(r"^#{1,6} |^\s*[-*+]\s|^\||\*\*[^*]{2,}\*\*|^>\s|^```")


def is_code(line: str) -> bool:
    return bool(_CODE_START.search(line) or _CODE_SHAPE.search(line))


def is_sql(line: str) -> bool:
    return bool(_SQL.search(line))


def is_markdown(line: str) -> bool:
    return bool(_MARKDOWN.search(line))


def classify(line: str) -> str:
    if is_sql(line):
        return "sql"
    if is_markdown(line):
        return "markdown"
    if is_code(line):
        return "code"
    return "english"


def usable(line: str) -> bool:
    if len(line) < 60 or len(line) > 2000:
        return False
    non_ascii = sum(ord(char) > 127 for char in line)
    return non_ascii / len(line) < 0.02 and not any(item in line for item in CONTAMINATION)


def _lines(path: Path) -> TextIO:
    return path.open("r", encoding="utf-8", newline="")


def extract(corpus: Path, sample: Path, per_domain: int = 150) -> dict[str, list[str]]:
    if per_domain < 0:
        raise ValueError("per-domain count cannot be negative")
    seen: set[str] = set()
    with _lines(sample) as handle:
        for line in handle:
            seen.add(line.rstrip("\r\n"))
    buckets: dict[str, list[str]] = {"english": [], "code": [], "sql": [], "markdown": []}
    count = 0
    with _lines(corpus) as handle:
        for raw_line in handle:
            count += 1
            line = raw_line.rstrip("\r\n")
            if line in seen or not usable(line):
                continue
            domain = classify(line)
            if len(buckets[domain]) < per_domain:
                buckets[domain].append(line)
    for lines in buckets.values():
        for index in range(len(lines) - 1, 0, -1):
            swap = (index * 2654435761) % (index + 1)
            lines[index], lines[swap] = lines[swap], lines[index]
    print(f"corpus lines: {count}", file=sys.stderr)
    return buckets


def self_check() -> None:
    assert classify("SELECT * FROM users") == "sql"
    assert classify("## heading") == "markdown"
    assert classify("const value = 1;") == "code"
    assert classify("ordinary prose") == "english"
    assert not usable("x" * 59)
    print("extract_unseen self-check: ok")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("corpus", type=Path, nargs="?")
    parser.add_argument("sample", type=Path, nargs="?")
    parser.add_argument("out", type=Path, nargs="?")
    parser.add_argument("per_domain", type=int, nargs="?", default=150)
    parser.add_argument("--self-check", action="store_true")
    args = parser.parse_args(argv)
    if args.self_check:
        self_check()
        return 0
    if args.corpus is None or args.sample is None or args.out is None:
        parser.error("corpus, sample, and out are required unless --self-check is used")
    buckets = extract(args.corpus, args.sample, args.per_domain)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(buckets, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print("extracted:", json.dumps({key: len(value) for key, value in buckets.items()}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
