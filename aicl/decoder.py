"""Stage 1 dictionary decoder."""

from __future__ import annotations

from typing import Any, Mapping

from .dict import build
from .unicode import ESCAPE_MARKER, code_points, require_text


def decode(aicl_text: str, opts: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """Decode AICL text and optionally record expansion steps."""

    require_text(aicl_text, "aiclText")
    options = opts or {}
    steps_enabled = bool(options.get("steps", options.get("stepsEnabled", False)))
    steps: list[dict[str, Any]] | None = [] if steps_enabled else None

    data = build()
    symbol_to_pattern: Mapping[str, str] = data["symbolToPattern"]  # type: ignore[assignment]
    modifier_map: Mapping[str, Mapping[str, object]] = data["modifierMap"]  # type: ignore[assignment]
    chars = code_points(aicl_text)
    output: list[str] = []
    buffer = ""
    expansions = 0
    literals = 0
    index = 0

    def flush_buffer() -> None:
        nonlocal buffer
        if buffer:
            output.append(buffer)
            buffer = ""

    while index < len(chars):
        ch = chars[index]
        modifier = modifier_map.get(ch)
        if modifier is not None:
            transform = modifier["transform"]
            assert callable(transform)
            buffer = transform(buffer)
            if steps is not None:
                steps.append({"type": "modifier", "name": modifier["name"], "pos": index})
            index += 1
            continue

        if ch == ESCAPE_MARKER:
            flush_buffer()
            literal = chars[index + 1] if index + 1 < len(chars) else None
            if literal is None:
                output.append(ch)
                literals += 1
                index += 1
            else:
                output.append(literal)
                literals += 1
                index += 2
            continue

        pattern = symbol_to_pattern.get(ch)
        if pattern is not None:
            flush_buffer()
            buffer = pattern
            expansions += 1
            if steps is not None:
                steps.append({"type": "expand", "symbol": ch, "pattern": pattern, "pos": index})
            index += 1
            continue

        flush_buffer()
        output.append(ch)
        literals += 1
        if steps is not None:
            steps.append({"type": "literal", "char": ch, "pos": index})
        index += 1

    flush_buffer()
    result: dict[str, Any] = {"output": "".join(output), "expansions": expansions, "literals": literals}
    if steps is not None:
        result["steps"] = steps
    return result


def decode_to_string(aicl_text: str) -> str:
    return decode(aicl_text)["output"]


decodeToString = decode_to_string

__all__ = ["decode", "decodeToString", "decode_to_string"]
