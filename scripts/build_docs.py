#!/usr/bin/env python3
"""Build the static GitHub Pages playground from the checked-in browser port."""

from __future__ import annotations

import argparse
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
DICT_FILES = ("english.json", "code.json", "symbols.json", "modifiers.json")
REQUIRED_BROWSER_EXPORTS = (
    "export function primeDict(",
    "export function encode(",
    "export function decode(",
    "export function tokenize(",
    "export function tokenizeWithMap(",
    "export function detokenize(",
    "export function makeVocab(",
    "export function cpToId(",
)


def _validate_browser_runtime() -> None:
    runtime = (DOCS / "aicl.js").read_text(encoding="utf-8")
    missing = [export for export in REQUIRED_BROWSER_EXPORTS if export not in runtime]
    if missing:
        raise RuntimeError(
            "docs/aicl.js is missing required browser exports: " + ", ".join(missing)
        )


def _render_playground_html() -> str:
    html = (ROOT / "playground" / "index.html").read_text(encoding="utf-8")
    replacements = {
        "<title>AICL Playground</title>": "<title>AICL Playground — Live Demo</title>",
        '<button id="uploadBtn" class="btn ghost" title="Upload .txt file">Upload</button>': "",
        '<input type="file" id="fileInput" accept=".txt,.md,.js,.json,.sql,.html,.css,.py,.sh" hidden/>': "",
        '<link rel="stylesheet" href="/playground/style.css"/>': '<link rel="stylesheet" href="./style.css"/>',
        '<script type="module" src="/playground/app.js"></script>': '<script type="module" src="./app.js"></script>',
    }
    for old, new in replacements.items():
        html = html.replace(old, new)
    html, replacements_made = re.subn(
        r"<div class=\"legend\">[\s\S]*?</div>",
        """<div class="legend">
          <span><i class="dot gpt4o"></i> Raw ÷ 4 (≈GPT-4o)</span>
          <span><i class="dot llama"></i> Raw ÷ 3 (≈LLaMA 2)</span>
          <span><i class="dot aicl"></i> AICL</span>
        </div>""",
        html,
        count=1,
    )
    if replacements_made != 1:
        raise RuntimeError("playground legend markup changed; update scripts/build_docs.py")
    return html


def build(*, check: bool = False) -> None:
    """Regenerate static assets, or verify them in check mode."""
    _validate_browser_runtime()

    generated: dict[Path, bytes] = {
        DOCS / "index.html": _render_playground_html().encode(),
        DOCS / "style.css": (ROOT / "playground" / "style.css").read_bytes(),
        DOCS / "tokenizer" / "vocab.json": (ROOT / "tokenizer" / "vocab.json").read_bytes(),
    }
    for name in DICT_FILES:
        generated[DOCS / "dict" / name] = (ROOT / "dict" / name).read_bytes()

    stale: list[str] = []
    for path, content in generated.items():
        if check:
            if not path.is_file() or path.read_bytes() != content:
                stale.append(str(path.relative_to(ROOT)))
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)

    if stale:
        raise SystemExit("stale generated docs; run python scripts/build_docs.py:\n  " + "\n  ".join(stale))
    print("docs OK" if check else "docs/ built")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail if generated assets are stale")
    args = parser.parse_args()
    build(check=args.check)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
