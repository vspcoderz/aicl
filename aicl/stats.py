"""Compression statistics for AICL text."""

from __future__ import annotations

from typing import Any, Mapping

from .unicode import char_length, code_points


def stats_for(
    original: str,
    encoded: str,
    extra: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Return the stable JavaScript-compatible statistics object."""

    original_chars = char_length(original)
    encoded_chars = char_length(encoded)
    saved_chars = original_chars - encoded_chars
    ratio = original_chars / encoded_chars if encoded_chars > 0 else 0
    percent_reduction = (saved_chars / original_chars) * 100 if original_chars > 0 else 0
    result: dict[str, Any] = {
        "originalChars": original_chars,
        "encodedChars": encoded_chars,
        "savedChars": saved_chars,
        "ratio": float(f"{ratio:.3f}"),
        "percentReduction": float(f"{percent_reduction:.1f}"),
        "symbolCount": count_symbols(encoded),
    }
    if extra:
        result.update(extra)
    return result


def count_symbols(encoded: str) -> dict[str, int]:
    """Count each code-point character in encoded AICL output."""

    counts: dict[str, int] = {}
    for ch in code_points(encoded):
        counts[ch] = counts.get(ch, 0) + 1
    return counts


def count_pua_symbols(encoded: str) -> dict[str, int]:
    """Count code points at or above the PUA boundary."""

    counts: dict[str, int] = {}
    for ch in code_points(encoded):
        if ord(ch) >= 0xE000:
            counts[ch] = counts.get(ch, 0) + 1
    return counts


statsFor = stats_for
countSymbols = count_symbols
countPuaSymbols = count_pua_symbols

__all__ = ["countPuaSymbols", "countSymbols", "count_pua_symbols", "count_symbols", "statsFor", "stats_for"]
