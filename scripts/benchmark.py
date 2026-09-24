#!/usr/bin/env python3
"""Benchmark AICL Stage-2 token counts and render the two legacy SVG charts.

GPT/LLaMA counts are optional because the JavaScript implementation obtained
them from third-party packages.  This Python port remains stdlib-only; pass
``--baselines`` with the same per-test counts when those comparison charts are
needed.  AICL counts, warm-up independent, and the chart generation work with
no third-party package installed.
"""

from __future__ import annotations

import argparse
import html
import json
import statistics
import sys
import time
from pathlib import Path
from typing import Any, Mapping, Sequence

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

try:
    from .eval_vocab import _load_vocab, _result_output, _tokenizer_api, vocab_summary  # noqa: E402
    from .heldout_probes import BENCH  # noqa: E402
except ImportError:
    from eval_vocab import _load_vocab, _result_output, _tokenizer_api, vocab_summary  # noqa: E402
    from heldout_probes import BENCH  # noqa: E402


def load_baselines(path: Path | None) -> dict[str, dict[str, int]]:
    if path is None:
        return {}
    raw = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(raw, dict) and "rows" in raw:
        raw = raw["rows"]
    if isinstance(raw, list):
        raw = {str(item["name"]): item for item in raw}
    if not isinstance(raw, dict):
        raise ValueError("baseline file must be an object keyed by test name")
    result: dict[str, dict[str, int]] = {}
    for name, values in raw.items():
        if not isinstance(values, Mapping):
            continue
        result[str(name)] = {
            key: int(value)
            for key, value in values.items()
            if key in {"gpt3", "gpt4", "gpt4o", "gpt5", "llama"}
        }
    return result


def measure(vocab: Any, tokenize: Any, baselines: Mapping[str, Mapping[str, int]]) -> list[dict[str, Any]]:
    from aicl import encode

    rows: list[dict[str, Any]] = []
    for name, text in BENCH:
        started = time.perf_counter()
        encoded = encode(text)
        aicl = _result_output(encoded)
        ids = tokenize(aicl, vocab)
        elapsed_ms = (time.perf_counter() - started) * 1000
        row: dict[str, Any] = {
            "name": name,
            "raw": len(text),
            "aicl": len(ids),
            "ms": elapsed_ms,
            "gpt3": None,
            "gpt4": None,
            "gpt4o": None,
            "gpt5": None,
            "llama": None,
        }
        for key in ("gpt3", "gpt4", "gpt4o", "gpt5", "llama"):
            if key in baselines.get(name, {}):
                row[key] = baselines[name][key]
        if row["gpt4o"] is not None:
            row["win"] = round(row["gpt4o"] / row["aicl"], 2) if row["aicl"] else 0.0
        else:
            row["win"] = None
        rows.append(row)
    return rows


def hotpath_summary() -> dict[str, float]:
    """Measure cold startup plus warmed 10k encode/tokenize medians."""

    from aicl import encode, load_tokenizer, tokenize

    text = ("the quick brown fox jumps over the lazy dog " * 250)[:10_000]
    started = time.perf_counter()
    encoded = encode(text)["output"]
    cold_encode_ms = (time.perf_counter() - started) * 1000

    started = time.perf_counter()
    vocab = load_tokenizer()
    tokenize(encoded, vocab)
    cold_tokenize_ms = (time.perf_counter() - started) * 1000

    encode_times: list[float] = []
    tokenize_times: list[float] = []
    for _ in range(5):
        started = time.perf_counter()
        encoded = encode(text)["output"]
        encode_times.append((time.perf_counter() - started) * 1000)
        started = time.perf_counter()
        tokenize(encoded, vocab)
        tokenize_times.append((time.perf_counter() - started) * 1000)
    return {
        "cold_encode_ms": cold_encode_ms,
        "cold_tokenize_ms": cold_tokenize_ms,
        "encode_median_ms": statistics.median(encode_times),
        "tokenize_median_ms": statistics.median(tokenize_times),
    }


def _escape(value: Any) -> str:
    return html.escape(str(value), quote=True)


def _bar_chart(
    rows: Sequence[Mapping[str, Any]],
    *,
    title: str,
    subtitle: str,
    all_tokenizers: bool,
) -> str:
    width = 900
    height = 620 if all_tokenizers else 520
    top = 96
    bottom = 420 if all_tokenizers else 380
    chart_height = bottom - top
    values = [
        int(value)
        for row in rows
        for key, value in row.items()
        if key in {"aicl", "gpt3", "gpt4", "gpt4o", "gpt5", "llama"} and value is not None
    ]
    max_tokens = max([*values, 90])
    scale = chart_height / (max_tokens * (1.1 if all_tokenizers else 1.12))
    group_width = 86
    gap = (820 - len(rows) * group_width) / max(1, len(rows) - 1)
    palette = {
        "gpt3": "#71717a",
        "gpt4": "#52525b",
        "gpt4o": "#3f3f46",
        "gpt5": "#27272a",
        "llama": "#a1a1aa",
        "aicl": "#fafafa",
    }
    keys = ["gpt3", "gpt4", "gpt4o", "gpt5", "llama", "aicl"] if all_tokenizers else ["aicl"]
    bar_width = 10 if all_tokenizers else 28
    bar_gap = 2 if all_tokenizers else 0
    groups: list[str] = []
    for index, row in enumerate(rows):
        x = 60 + index * (group_width + gap)
        bars: list[str] = []
        for key_index, key in enumerate(keys):
            value = row.get(key)
            if value is None:
                continue
            bar_height = max(0, round(int(value) * scale))
            y = bottom - bar_height
            bx = x + key_index * (bar_width + bar_gap) if all_tokenizers else x + 29
            fill = palette[key]
            stroke = ' stroke="#e5e7eb" stroke-width="0.5"' if key == "aicl" else ""
            bars.append(
                f'<rect x="{bx:.1f}" y="{y:.1f}" width="{bar_width}" height="{bar_height}" '
                f'rx="{3 if key == "aicl" else 2}" fill="{fill}"{stroke}/>'
            )
        label = "Common" if row["name"] == "Common English" else "API" if row["name"] == "API" else row["name"]
        label_lines = ["Common", "English"] if row["name"] == "Common English" else ["API", "response"] if row["name"] == "API" else [label]
        labels = "".join(
            f'<text x="{x + group_width / 2:.1f}" y="{500 if all_tokenizers else 410 + line_index * 12}" '
            f'text-anchor="middle" class="n">{_escape(value)}</text>'
            for line_index, value in enumerate(label_lines)
        )
        groups.append(f'<g>{"".join(bars)}{labels}</g>')
    grids = "".join(
        f'<line x1="52" y1="{y}" x2="860" y2="{y}"/>'
        for y in (top, top + chart_height * 0.25, top + chart_height * 0.5, top + chart_height * 0.75, bottom)
    )
    tick_values = [round(max_tokens * fraction) for fraction in (0, 0.25, 0.5, 0.75, 1)]
    ticks = "".join(
        f'<text x="44" y="{bottom - round(max_tokens * fraction * scale) + 4}" text-anchor="end" class="a">{value}</text>'
        for fraction, value in zip((0, 0.25, 0.5, 0.75, 1), tick_values)
    )
    legend = '<rect x="0" y="0" width="10" height="10" rx="2" fill="#fafafa"/><text x="14" y="9" class="s">AICLTokenizer</text>'
    if any(row.get("gpt4o") is not None for row in rows):
        legend = '<rect x="0" y="0" width="10" height="10" rx="2" fill="#27272a"/><text x="14" y="9" class="s">GPT-4o (optional baseline)</text>' + legend
    subtitle = subtitle.replace("131/131 pass", "lossless checked")
    return f'''<svg width="{width}" height="{height}" xmlns="http://www.w3.org/2000/svg">
<style>.t{{font:700 17px 'Stack Sans Notch','Inter',system-ui,sans-serif;fill:#f9fafb;letter-spacing:-0.3px}}.s{{font:400 11px 'Stack Sans Notch','Inter',system-ui,sans-serif;fill:#9ca3af}}.n{{font:600 10px 'Stack Sans Notch','Inter',system-ui,sans-serif;fill:#e5e7eb}}.a{{font:400 9px 'Stack Sans Notch','Inter',system-ui,sans-serif;fill:#6b7280}}</style>
<rect width="{width}" height="{height}" rx="16" fill="#0a0a0a"/>
<text x="32" y="34" class="t">{_escape(title)}</text>
<text x="32" y="52" class="s">{_escape(subtitle)}</text>
<g transform="translate(32,66)">{legend}</g>
<g stroke="#1f1f23" stroke-width="1">{grids}</g>{ticks}
{''.join(groups)}
<line x1="32" y1="{520 if all_tokenizers else 460}" x2="868" y2="{520 if all_tokenizers else 460}" stroke="#1f1f23"/>
<text x="32" y="{540 if all_tokenizers else 480}" class="s">Lower is better · Stage 1: raw → AICL PUA · Stage 2: BPE → tokens</text>
<text x="32" y="{558 if all_tokenizers else 498}" class="a">AICL benchmark · {len(rows)} tests · stdlib Python</text>
</svg>'''

def self_check() -> None:
    rows = [{"name": "x", "aicl": 2, "gpt3": None, "gpt4": None, "gpt4o": None, "gpt5": None, "llama": None}]
    assert "<svg" in _bar_chart(rows, title="x", subtitle="x", all_tokenizers=False)
    assert "AICL" in _bar_chart(rows, title="x", subtitle="x", all_tokenizers=True)
    print("benchmark self-check: chart generation ok")


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vocab", type=Path, default=ROOT / "tokenizer" / "vocab.json")
    parser.add_argument("--out-dir", type=Path, default=ROOT / "assets")
    parser.add_argument("--baselines", type=Path, help="optional JSON with per-test GPT/LLaMA counts")
    parser.add_argument("--no-svg", action="store_true")
    parser.add_argument("--self-check", action="store_true")
    args = parser.parse_args(argv)
    if args.self_check:
        self_check()
        return 0
    hotpath = None
    if args.vocab.resolve() == (ROOT / "tokenizer" / "vocab.json").resolve():
        hotpath = hotpath_summary()
        print(
            "hotpath 10k: "
            f"cold encode={hotpath['cold_encode_ms']:.1f}ms, "
            f"cold tokenize={hotpath['cold_tokenize_ms']:.1f}ms, "
            f"warm median encode={hotpath['encode_median_ms']:.1f}ms, "
            f"warm median tokenize={hotpath['tokenize_median_ms']:.1f}ms"
        )
    _load, tokenize, _detokenize = _tokenizer_api()
    vocab = _load_vocab(args.vocab)
    rows = measure(vocab, tokenize, load_baselines(args.baselines))
    merge_count, max_length, _version = vocab_summary(vocab)
    for row in rows:
        baseline = ", ".join(f"{key}={row[key]}" for key in ("gpt3", "gpt4", "gpt4o", "gpt5", "llama") if row[key] is not None)
        print(
            f"{row['name']:<16} raw={row['raw']:>3} AICL={row['aicl']:>3}"
            + (f" {baseline}" if baseline else " external-baselines=not-configured")
            + (f" win={row['win']}x" if row["win"] is not None else "")
        )
    print(f"vocab {merge_count} merges maxLen={max_length}; total AICL={sum(row['aicl'] for row in rows)}")
    if not args.no_svg:
        args.out_dir.mkdir(parents=True, exist_ok=True)
        subtitle = f"{merge_count} merges · max {max_length} PUA/token · 8 tests"
        (args.out_dir / "benchmark.svg").write_text(
            _bar_chart(rows, title="AICL vs GPT-4o — tokens (lower is better)", subtitle=subtitle, all_tokenizers=False),
            encoding="utf-8",
        )
        (args.out_dir / "benchmark-all.svg").write_text(
            _bar_chart(rows, title="AICL vs All Tokenizers — 8 tests", subtitle=subtitle, all_tokenizers=True),
            encoding="utf-8",
        )
        print(f"wrote {args.out_dir / 'benchmark.svg'}")
        print(f"wrote {args.out_dir / 'benchmark-all.svg'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
