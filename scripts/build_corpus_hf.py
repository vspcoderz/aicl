#!/usr/bin/env python3
"""
Build ~1 GB AICL tokenizer corpus — adapted for this VPS (8 cores, 8GB RAM).

Mixture:
    45% English/web   (FineWeb, streaming)
    35% Code          (the-stack-smol: public, not gated; 8 languages)
    10% SQL           (the-stack-smol data/sql)
    10% Markdown/docs (the-stack-smol data/markdown)

Requirements (installed into /root/venv):
    pip install -U datasets
"""

from datasets import load_dataset
from pathlib import Path
import random

# ============================================================
# CONFIG
# ============================================================

TARGET_GB = 1.0
OUTPUT = Path("/root/data/aicl_corpus.txt")

TARGET_BYTES = int(TARGET_GB * 1024**3)

ALLOCATIONS = {
    "english": 0.45,
    "code": 0.35,
    "sql": 0.10,
    "markdown": 0.10,
}

SEED = 42
random.seed(SEED)

MAX_EXAMPLE_BYTES = 1 * 1024 * 1024

CODE_LANGS = ["python", "javascript", "typescript", "java", "go", "c++", "rust", "shell"]


# ============================================================
# HELPERS
# ============================================================

def mb(n):
    return n / 1024 / 1024


def write_text(f, text):
    if not text:
        return 0
    text = text.strip()
    if not text:
        return 0
    encoded = text.encode("utf-8", errors="ignore")
    if len(encoded) > MAX_EXAMPLE_BYTES:
        encoded = encoded[:MAX_EXAMPLE_BYTES]
    f.write(encoded)
    f.write(b"\n\n")
    return len(encoded) + 2


def progress(category, written, target):
    percent = min(100, written / target * 100)
    print(f"\r[{category:9}] {mb(written):8.1f} / {mb(target):8.1f} MB ({percent:5.1f}%)", end="", flush=True)


def pick(row, *keys):
    for k in keys:
        v = row.get(k)
        if isinstance(v, str) and v:
            return v
    return ""


# ============================================================
# DATASET STREAMS
# ============================================================

def english_stream():
    print("\nLoading FineWeb...")
    ds = load_dataset("HuggingFaceFW/fineweb", name="CC-MAIN-2024-10", split="train", streaming=True)
    for row in ds:
        text = row.get("text")
        if text:
            yield text


def code_stream():
    """Code from the-stack-smol (public mirror of The Stack v1 sample set)."""
    while True:
        language = random.choice(CODE_LANGS)
        try:
            print(f"\nLoading code language: {language}")
            ds = load_dataset("bigcode/the-stack-smol", data_dir=f"data/{language}", split="train", streaming=True)
            for row in ds:
                content = pick(row, "content", "text", "code")
                if content:
                    yield content
        except Exception as e:
            print(f"\nWarning: couldn't load {language}: {e}")
            if all(lang == CODE_LANGS[-1] for lang in CODE_LANGS):
                return
            continue


def sql_stream():
    print("\nLoading SQL (the-stack-smol data/sql)...")
    ds = load_dataset("bigcode/the-stack-smol", data_dir="data/sql", split="train", streaming=True)
    for row in ds:
        text = pick(row, "content", "text", "code")
        if text:
            yield text


def markdown_stream():
    print("\nLoading Markdown (the-stack-smol data/markdown)...")
    ds = load_dataset("bigcode/the-stack-smol", data_dir="data/markdown", split="train", streaming=True)
    for row in ds:
        text = pick(row, "content", "text", "code")
        if text:
            yield text


# ============================================================
# MAIN SAMPLER
# ============================================================

STREAMS = {
    "english": english_stream,
    "code": code_stream,
    "sql": sql_stream,
    "markdown": markdown_stream,
}


def collect_category(category, target_bytes, output_file):
    print(f"\n\n=== {category.upper()} target: {mb(target_bytes):.1f} MB ===")
    stream = STREAMS[category]()
    written = 0
    examples = 0
    for text in stream:
        written += write_text(output_file, text)
        examples += 1
        if examples % 100 == 0:
            progress(category, written, target_bytes)
        if written >= target_bytes:
            break
    print(f"\n{category}: {mb(written):.1f} MB from {examples:,} examples")
    return written


def main():
    print("=" * 60)
    print("AICL ~1 GB CORPUS BUILDER")
    print("=" * 60)
    print(f"Target: {TARGET_GB} GB")
    print(f"Output: {OUTPUT}")
    print(f"Seed:   {SEED}")

    if OUTPUT.exists():
        print(f"\nRemoving existing {OUTPUT}")
        OUTPUT.unlink()

    total_written = 0
    with OUTPUT.open("wb", buffering=1024 * 1024) as f:
        for category, fraction in ALLOCATIONS.items():
            target = int(TARGET_BYTES * fraction)
            total_written += collect_category(category, target, f)

    size = OUTPUT.stat().st_size
    print("\n" + "=" * 60)
    print("DONE")
    print("=" * 60)
    print(f"File:     {OUTPUT}")
    print(f"Size:     {mb(size):.2f} MB")
    print(f"Bytes:    {size:,}")
    print(f"Target:   {TARGET_GB:.2f} GB")
    print("=" * 60)


if __name__ == "__main__":
    main()
