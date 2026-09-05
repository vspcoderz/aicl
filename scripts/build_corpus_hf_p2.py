#!/usr/bin/env python3
"""
Append code/sql/markdown sections to the English corpus already collected.

Input : /root/data/aicl_corpus.txt  (~460MB FineWeb English, kept as-is)
Output: same file, appended:
    - code     from CodeSearchNet parquets (python + javascript), ~260MB
    - sql      from gretelai/synthetic_text_to_sql (public), all rows
    - markdown from FineWeb rows with markdown signals, ~100MB
"""
from datasets import load_dataset
from pathlib import Path
import random

OUT = Path("/root/data/aicl_corpus.txt")
MAX_EXAMPLE_BYTES = 1 * 1024 * 1024
random.seed(42)

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

def progress(cat, written, target):
    print(f"\r[{cat:9}] {mb(written):8.1f} / {mb(target):8.1f} MB ({min(100, written/target*100):5.1f}%)", end="", flush=True)

def csn_code_stream():
    from huggingface_hub import hf_hub_download
    for repo, fname in [
        ("code_search_net", "python/train-00000-of-00001.parquet"),
        ("code_search_net", "javascript/train-00000-of-00001.parquet"),
    ]:
        print(f"\nCSN local parquet: {fname}")
        # files already downloaded to /root/data with other names — use local paths
    import pyarrow.parquet as pq
    for path in ["/root/data/csn_python.parquet", "/root/data/csn_js.parquet"]:
        print(f"\nReading {path} ...")
        pf = pq.ParquetFile(path)
        for batch in pf.iter_batches(batch_size=256, columns=["func_code_string"]):
            for v in batch.column("func_code_string"):
                if v is not None:
                    yield str(v)

def sql_stream():
    print("\nLoading gretelai/synthetic_text_to_sql (public)...")
    ds = load_dataset("gretelai/synthetic_text_to_sql", split="train", streaming=True)
    for row in ds:
        sql = row.get("sql", "")
        prompt = row.get("sql_prompt", "")
        ctx = row.get("sql_context", "")
        yield (prompt + "\n" + ctx + "\n" + sql) if prompt or ctx else sql

def markdown_stream():
    print("\nLoading FineWeb markdown-filtered...")
    signals = ("# ", "## ", "### ", "```", "- ", "* ", "> ", "](http")
    ds = load_dataset("HuggingFaceFW/fineweb", name="CC-MAIN-2024-10", split="train", streaming=True)
    for row in ds:
        text = row.get("text", "")
        if text and sum(1 for x in signals if x in text) >= 3:
            yield text

TARGETS = {"code": 350_000_000, "sql": 100_000_000, "markdown": 100_000_000}

with OUT.open("ab", buffering=1024 * 1024) as f:
    # ---- code ----
    written, examples = 0, 0
    for text in csn_code_stream():
        written += write_text(f, text)
        examples += 1
        if examples % 200 == 0:
            progress("code", written, TARGETS["code"])
        if written >= TARGETS["code"]:
            break
    print(f"\ncode: {mb(written):.1f} MB from {examples:,} functions")

    # ---- sql ----
    written, examples = 0, 0
    for text in sql_stream():
        written += write_text(f, text)
        examples += 1
        if written >= TARGETS["sql"]:
            break
    print(f"\nsql: {mb(written):.1f} MB from {examples:,} examples")

    # ---- markdown ----
    written, examples = 0, 0
    for text in markdown_stream():
        written += write_text(f, text)
        examples += 1
        if examples % 100 == 0:
            progress("markdown", written, TARGETS["markdown"])
        if written >= TARGETS["markdown"]:
            break
    print(f"\nmarkdown: {mb(written):.1f} MB from {examples:,} docs")

size = OUT.stat().st_size
print(f"\nDONE. Total corpus: {mb(size):.1f} MB -> {OUT}")
