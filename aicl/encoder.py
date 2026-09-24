"""Stage 1 dictionary encoder."""

from __future__ import annotations

import re
from typing import Any, Mapping

from .dict import TrieNode, build
from .unicode import ESCAPE_MARKER, code_points, is_pua_code_point, require_text

_WORD_RE = re.compile(r"[A-Za-z0-9_'-]")
_LOWER_RE = re.compile(r"[a-z]")
_UPPER_RE = re.compile(r"[A-Z]")
_PUNCTUATION_MODIFIERS: Mapping[str, str] = {
    " ": "MOD_TRAIL_SPACE",
    ",": "MOD_TRAIL_COMMA",
    ".": "MOD_TRAIL_PERIOD",
    "?": "MOD_TRAIL_QUESTION",
    "!": "MOD_TRAIL_EXCL",
    ";": "MOD_TRAIL_SEMI",
    ":": "MOD_TRAIL_COLON",
    ")": "MOD_TRAIL_RPAREN",
    "]": "MOD_TRAIL_RBRACKET",
    "}": "MOD_TRAIL_RBRACE",
    '"': "MOD_TRAIL_RQUOTE",
}


def _trie_match(root: TrieNode, chars: list[str], start: int) -> tuple[int, str | None]:
    node = root
    best_length = 0
    best_symbol: str | None = None
    for end in range(start, len(chars)):
        node = node.children.get(chars[end])  # type: ignore[assignment]
        if node is None:
            break
        if node.symbol is not None:
            best_length = end - start + 1
            best_symbol = node.symbol
    return best_length, best_symbol


def _extract_word(chars: list[str], start: int) -> str:
    if start >= len(chars) or _WORD_RE.fullmatch(chars[start]) is None:
        return ""
    end = start + 1
    while end < len(chars) and _WORD_RE.fullmatch(chars[end]) is not None:
        end += 1
    return "".join(chars[start:end])


def _punctuation_modifier(ch: str) -> str | None:
    return _PUNCTUATION_MODIFIERS.get(ch)


def _all_caps(word: str) -> bool:
    return word == word.upper() and _UPPER_RE.search(word) is not None


def encode(text: str, opts: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """Encode *text* into the stable AICL representation.

    Result keys intentionally use the JavaScript spelling (``charsIn``,
    ``rawToAicl``, etc.) because those objects cross the Python/browser boundary.
    """

    require_text(text, "text")
    options = opts or {}
    steps_enabled = bool(options.get("steps", options.get("stepsEnabled", False)))
    track_mapping = bool(options.get("trackMapping", options.get("track_mapping", False)))
    steps: list[dict[str, Any]] | None = [] if steps_enabled else None

    data = build()
    pattern_to_symbol: Mapping[str, str] = data["patternToSymbol"]  # type: ignore[assignment]
    trie: TrieNode = data["trie"]  # type: ignore[assignment]
    fragment_patterns: tuple[str, ...] = data["fragmentPatterns"]  # type: ignore[assignment]

    chars = code_points(text)
    raw_to_aicl = [-1] * len(chars) if track_mapping else None
    output: list[str] = []
    matches = 0
    literals = 0
    aicl_pos = 0
    index = 0

    while index < len(chars):
        best_length, best_symbol = _trie_match(trie, chars, index)
        best_pattern = "".join(chars[index : index + best_length]) if best_symbol else None

        if best_length == 1:
            word = _extract_word(chars, index)
            if len(word) > 1:
                lower = word.lower()
                is_all_caps = _all_caps(word)
                is_all_lower = word == lower
                is_title_case = (
                    not is_all_lower
                    and word[0] != lower[0]
                    and word[1:] == lower[1:]
                )
                if is_all_caps:
                    caps_symbol = pattern_to_symbol.get(word)
                    if caps_symbol is not None:
                        if raw_to_aicl is not None:
                            for raw_index in range(index, index + len(word)):
                                raw_to_aicl[raw_index] = aicl_pos
                        output.append(caps_symbol)
                        matches += 1
                        if steps is not None:
                            steps.append({"type": "base", "pattern": word, "pos": index})
                        aicl_pos += 1
                        index += len(word)
                        index, matches, aicl_pos = _consume_trailing_modifiers(
                            chars, index, output, pattern_to_symbol, matches, steps, aicl_pos
                        )
                        continue

                    base_symbol = pattern_to_symbol.get(lower)
                    if base_symbol is not None:
                        if raw_to_aicl is not None:
                            for raw_index in range(index, index + len(word)):
                                raw_to_aicl[raw_index] = aicl_pos
                        output.append(base_symbol)
                        matches += 1
                        if steps is not None:
                            steps.append({"type": "base", "pattern": lower, "pos": index})
                        aicl_pos += 1
                        all_caps_symbol = pattern_to_symbol.get("MOD_ALLCAPS")
                        if all_caps_symbol is not None:
                            output.append(all_caps_symbol)
                            matches += 1
                            if steps is not None:
                                steps.append({"type": "modifier", "name": "MOD_ALLCAPS", "pos": index})
                            aicl_pos += 1
                        index += len(word)
                        index, matches, aicl_pos = _consume_trailing_modifiers(
                            chars, index, output, pattern_to_symbol, matches, steps, aicl_pos
                        )
                        continue
                else:
                    if is_all_lower or is_title_case:
                        base_symbol = pattern_to_symbol.get(lower)
                        if base_symbol is not None:
                            if raw_to_aicl is not None:
                                for raw_index in range(index, index + len(lower)):
                                    raw_to_aicl[raw_index] = aicl_pos
                            output.append(base_symbol)
                            matches += 1
                            if steps is not None:
                                steps.append({"type": "base", "pattern": lower, "pos": index})
                            aicl_pos += 1
                            index += len(lower)
                            if word[0] != lower[0]:
                                caps_symbol = pattern_to_symbol.get("MOD_CAPS")
                                if caps_symbol is not None:
                                    output.append(caps_symbol)
                                    matches += 1
                                    if steps is not None:
                                        steps.append({"type": "modifier", "name": "MOD_CAPS", "pos": index})
                                    aicl_pos += 1
                            index, matches, aicl_pos = _consume_trailing_modifiers(
                                chars, index, output, pattern_to_symbol, matches, steps, aicl_pos
                            )
                            continue

                fragment_index = 0
                matched_fragment = False
                while is_all_lower and fragment_index < len(lower):
                    best_fragment: str | None = None
                    best_fragment_length = 0
                    for fragment in fragment_patterns:
                        if len(fragment) <= len(lower) - fragment_index and lower.startswith(
                            fragment, fragment_index
                        ):
                            # All-caps words are fixed by MOD_ALLCAPS.  Other
                            # fragments may use MOD_CAPS only when all interior
                            # characters are lowercase.
                            if is_all_caps or word[fragment_index + 1 : fragment_index + len(fragment)] == lower[
                                fragment_index + 1 : fragment_index + len(fragment)
                            ]:
                                best_fragment = fragment
                                best_fragment_length = len(fragment)
                                break
                    if best_fragment is not None:
                        if raw_to_aicl is not None:
                            for raw_index in range(
                                index + fragment_index,
                                index + fragment_index + best_fragment_length,
                            ):
                                raw_to_aicl[raw_index] = aicl_pos
                        fragment_symbol = pattern_to_symbol.get(best_fragment)
                        if fragment_symbol is not None:
                            output.append(fragment_symbol)
                            matches += 1
                            if steps is not None:
                                steps.append(
                                    {
                                        "type": "fragment",
                                        "pattern": best_fragment,
                                        "pos": index + fragment_index,
                                    }
                                )
                            aicl_pos += 1
                            needs_caps = (
                                _LOWER_RE.search(best_fragment) is not None
                                if is_all_caps
                                else word[fragment_index] != lower[fragment_index]
                            )
                            if needs_caps:
                                caps_symbol = pattern_to_symbol.get(
                                    "MOD_ALLCAPS" if is_all_caps else "MOD_CAPS"
                                )
                                if caps_symbol is not None:
                                    output.append(caps_symbol)
                                    matches += 1
                                    if steps is not None:
                                        steps.append(
                                            {
                                                "type": "modifier",
                                                "name": "MOD_ALLCAPS" if is_all_caps else "MOD_CAPS",
                                                "pos": index + fragment_index,
                                            }
                                        )
                                    aicl_pos += 1
                            fragment_index += best_fragment_length
                            matched_fragment = True
                            continue
                    break
                if matched_fragment and fragment_index > 0:
                    index += fragment_index
                    index, matches, aicl_pos = _consume_trailing_modifiers(
                        chars, index, output, pattern_to_symbol, matches, steps, aicl_pos
                    )
                    continue

        if best_symbol is not None:
            if raw_to_aicl is not None:
                for raw_index in range(index, index + best_length):
                    raw_to_aicl[raw_index] = aicl_pos
            output.append(best_symbol)
            matches += 1
            if steps is not None:
                steps.append({"type": "match", "pattern": best_pattern, "pos": index})
            aicl_pos += len(best_symbol) if best_length > 1 else 1
            index += best_length
            continue

        ch = chars[index]
        if raw_to_aicl is not None:
            raw_to_aicl[index] = aicl_pos
        if is_pua_code_point(ord(ch)):
            output.append(ESCAPE_MARKER)
            output.append(ch)
        else:
            output.append(ch)
        aicl_pos += 1
        literals += 1
        if steps is not None:
            steps.append({"type": "literal", "char": ch, "pos": index})
        index += 1

    result: dict[str, Any] = {
        "output": "".join(output),
        "matches": matches,
        "literals": literals,
        "charsIn": len(chars),
        "charsOut": len("".join(output)),
    }
    if steps is not None:
        result["steps"] = steps
    if raw_to_aicl is not None:
        result["rawToAicl"] = raw_to_aicl
    return result


def _consume_trailing_modifiers(
    chars: list[str],
    index: int,
    output: list[str],
    pattern_to_symbol: Mapping[str, str],
    matches: int,
    steps: list[dict[str, Any]] | None,
    aicl_pos: int,
) -> tuple[int, int, int]:
    """Consume the same run of punctuation modifiers as the JS encoder."""

    while index < len(chars):
        modifier_name = _punctuation_modifier(chars[index])
        if modifier_name is not None:
            modifier_symbol = pattern_to_symbol.get(modifier_name)
            if modifier_symbol is not None:
                output.append(modifier_symbol)
                matches += 1
                aicl_pos += len(modifier_symbol)
                if steps is not None:
                    steps.append({"type": "modifier", "name": modifier_name, "pos": index})
                index += 1
                continue
        break
    return index, matches, aicl_pos


def encode_to_string(text: str) -> str:
    return encode(text)["output"]


# JavaScript-shaped aliases.
encodeToString = encode_to_string

__all__ = ["encode", "encodeToString", "encode_to_string"]
