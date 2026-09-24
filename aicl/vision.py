"""ANSI terminal visualization for AICL encodings."""

from __future__ import annotations

from typing import Any, Mapping

from .decoder import decode
from .unicode import ESCAPE_MARKER, code_points

_COLORS = {
    "reset": "\x1b[0m",
    "green": "\x1b[32m",
    "red": "\x1b[31m",
    "yellow": "\x1b[33m",
    "cyan": "\x1b[36m",
    "dim": "\x1b[2m",
    "bold": "\x1b[1m",
}
_PUNCTUATION = frozenset(".,;:!?\"'()[]{}<>")
_JS_WHITESPACE = frozenset(
    "\t\n\v\f\r \u0085\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007"
    "\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
)


def colorize_encoded(encoded: str) -> str:
    """Render encoded text with green symbols, red literals, and cyan punctuation."""

    output: list[str] = []
    for ch in code_points(encoded):
        if ch == ESCAPE_MARKER:
            output.append(_COLORS["dim"] + ch + _COLORS["reset"])
        elif ord(ch) >= 0xE000:
            output.append(_COLORS["green"] + ch + _COLORS["reset"])
        elif ch in _PUNCTUATION or ch in _JS_WHITESPACE:
            output.append(_COLORS["cyan"] + ch + _COLORS["reset"])
        else:
            output.append(_COLORS["red"] + ch + _COLORS["reset"])
    return "".join(output)


def render(original: str, encoded: str, opts: Mapping[str, Any] | None = None) -> str:
    """Render original, encoded, decoded, and roundtrip status sections."""

    options = opts or {}
    decoded = decode(encoded)["output"]
    lines: list[str] = []
    if options.get("title"):
        lines.append(_COLORS["bold"] + str(options["title"]) + _COLORS["reset"])
    lines.extend(
        [
            "",
            _COLORS["bold"] + "Original:" + _COLORS["reset"],
            "  " + original,
            "",
            _COLORS["bold"] + "Encoded (AICL):" + _COLORS["reset"],
            "  " + colorize_encoded(encoded),
            "",
            _COLORS["bold"] + "Decoded (roundtrip):" + _COLORS["reset"],
            "  " + decoded,
            "",
            _COLORS["bold"]
            + "Roundtrip "
            + ("✓ OK" if original == decoded else "✗ FAILED")
            + _COLORS["reset"],
        ]
    )
    return "\n".join(lines)


colorizeEncoded = colorize_encoded

__all__ = ["colorizeEncoded", "colorize_encoded", "render"]
