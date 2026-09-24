"""AICL Unicode helpers.

The runtime treats text as Unicode code points rather than UTF-16 code units.
The small compatibility helpers at the end of this module make the few places
where JavaScript's UTF-16 string semantics are observable explicit.
"""

from __future__ import annotations

from typing import Final

ESCAPE_MARKER: Final[str] = "\ue000"
ESCAPE_CP: Final[int] = 0xE000
MAX_INPUT_CHARS: Final[int] = 1_000_000
MAX_BODY_BYTES: Final[int] = 2_000_000


class RangeError(ValueError):
    """Compatibility exception for the JavaScript ``RangeError`` contract."""


# Python's str.ispace() is close to, but not identical with, JavaScript's
# String.prototype.trim whitespace set.  Keeping the set here avoids a subtle
# compatibility difference in the ANSI vision output.
_JS_WHITESPACE: Final[frozenset[str]] = frozenset(
    "\t\n\v\f\r \u0085\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007"
    "\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
)

PUA_RANGES: Final[dict[str, object]] = {
    "english": [
        {"start": 0xE001, "end": 0xF8FF},
        {"start": 0x100900, "end": 0x10FFFF},
    ],
    "code": {"start": 0xF0000, "end": 0xF07FF},
    "phrases": {"start": 0xF0800, "end": 0xF0FFF},
    "markdown": {"start": 0x100000, "end": 0x1003FF},
    "symbols": {"start": 0x100400, "end": 0x1007FF},
    "modifiers": {"start": 0x100800, "end": 0x1008FF},
}


def require_text(value: object, label: str = "text", limit: int = MAX_INPUT_CHARS) -> str:
    """Validate and return a string within the code-point size limit."""

    if not isinstance(value, str):
        raise TypeError(f"{label} must be a string, got {type(value).__name__}")
    length = len(value)  # Python iterates Unicode code points.
    if length > limit:
        raise RangeError(f"{label} too large: {length} chars > {limit} limit")
    return value


def inspect_text(value: str) -> dict[str, bool]:
    """Report control, surrogate, and NUL code points in *value*."""

    require_text(value)
    has_control = False
    has_surrogate = False
    has_null = False
    for ch in value:
        cp = ord(ch)
        if cp == 0:
            has_null = True
        if 0xD800 <= cp <= 0xDFFF:
            has_surrogate = True
        elif cp < 0x20 and cp not in (0x09, 0x0A, 0x0D):
            has_control = True
        elif cp == 0x7F:
            has_control = True
    return {"hasControl": has_control, "hasSurrogate": has_surrogate, "hasNull": has_null}


def sanitize_text(value: str) -> str:
    """Remove C0 controls, DEL, and lone surrogates while preserving all else."""

    require_text(value)
    output: list[str] = []
    for ch in value:
        cp = ord(ch)
        if cp in (0x09, 0x0A, 0x0D):
            output.append(ch)
            continue
        if cp < 0x20 or cp == 0x7F:
            continue
        if 0xD800 <= cp <= 0xDFFF:
            continue
        output.append(ch)
    return "".join(output)


def is_pua_code_point(cp: int) -> bool:
    """Return whether *cp* belongs to a PUA range used by AICL."""

    if not isinstance(cp, int):
        raise TypeError(f"code point must be an int, got {type(cp).__name__}")
    if cp == ESCAPE_CP:
        return True
    for ranges in PUA_RANGES.values():
        entries = ranges if isinstance(ranges, list) else [ranges]
        for entry in entries:
            assert isinstance(entry, dict)
            if entry["start"] <= cp <= entry["end"]:
                return True
    return False


def code_points(value: str) -> list[str]:
    """Split *value* into one-character code-point strings."""

    require_text(value)
    return list(value)


def char_length(value: str) -> int:
    """Count Unicode code points (including each lone surrogate)."""

    require_text(value)
    return len(value)


def _utf16_length(value: str) -> int:
    """Return the JavaScript-style UTF-16 code-unit length."""

    return len(value.encode("utf-16-le", errors="surrogatepass")) // 2


def is_surrogate_pair(value: str) -> bool:
    """Return whether *value* is one supplementary code point (UTF-16 pair)."""

    require_text(value)
    return char_length(value) == 1 and _utf16_length(value) == 2


def hex(value: str) -> str:
    """Format a character's code point as ``U+XXXX``."""

    require_text(value)
    return f"U+{ord(value[0]):X}"


# Compatibility aliases for callers familiar with the JavaScript module.
requireText = require_text
inspectText = inspect_text
sanitizeText = sanitize_text
isPuaCodePoint = is_pua_code_point
codePoints = code_points
charLength = char_length
isSurrogatePair = is_surrogate_pair

__all__ = [
    "ESCAPE_MARKER",
    "ESCAPE_CP",
    "MAX_INPUT_CHARS",
    "MAX_BODY_BYTES",
    "PUA_RANGES",
    "RangeError",
    "charLength",
    "char_length",
    "codePoints",
    "code_points",
    "hex",
    "inspectText",
    "inspect_text",
    "isPuaCodePoint",
    "is_pua_code_point",
    "isSurrogatePair",
    "is_surrogate_pair",
    "requireText",
    "require_text",
    "sanitizeText",
    "sanitize_text",
]
