"""Dictionary loading and immutable runtime indexes for AICL stage 1."""

from __future__ import annotations

import json
from functools import lru_cache
from importlib import resources
from pathlib import Path
from types import MappingProxyType
from typing import Any, Callable, Final, Mapping

from .unicode import _utf16_length

_MODIFIER_TRANSFORMS: Final[dict[str, Callable[[str], str]]] = {
    "MOD_CAPS": lambda word: word[:1].upper() + word[1:],
    "MOD_ALLCAPS": str.upper,
    "MOD_TRAIL_SPACE": lambda word: word + " ",
    "MOD_TRAIL_COMMA": lambda word: word + ",",
    "MOD_TRAIL_PERIOD": lambda word: word + ".",
    "MOD_TRAIL_QUESTION": lambda word: word + "?",
    "MOD_TRAIL_EXCL": lambda word: word + "!",
    "MOD_TRAIL_SEMI": lambda word: word + ";",
    "MOD_TRAIL_COLON": lambda word: word + ":",
    "MOD_TRAIL_RPAREN": lambda word: word + ")",
    "MOD_TRAIL_RBRACKET": lambda word: word + "]",
    "MOD_TRAIL_RBRACE": lambda word: word + "}",
    "MOD_TRAIL_RQUOTE": lambda word: word + '"',
    "MOD_LEAD_SPACE": lambda word: " " + word,
    "MOD_LEAD_LPAREN": lambda word: "(" + word,
    "MOD_LEAD_LBRACKET": lambda word: "[" + word,
    "MOD_LEAD_LBRACE": lambda word: "{" + word,
    "MOD_LEAD_LQUOTE": lambda word: '"' + word,
}


class TrieNode:
    """A compact trie node used by the encoder's longest-match search."""

    __slots__ = ("children", "symbol")

    def __init__(self) -> None:
        self.children: dict[str, TrieNode] = {}
        self.symbol: str | None = None


_REPOSITORY_ROOT = Path(__file__).resolve().parents[1]


def _resource_json(filename: str) -> Any:
    source = _REPOSITORY_ROOT / "dict" / filename
    if source.is_file():
        return json.loads(source.read_text(encoding="utf-8"))
    resource = resources.files("aicl.data").joinpath(filename)
    return json.loads(resource.read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def _cached_raw() -> tuple[dict[str, str], dict[str, str], dict[str, str], dict[str, str]]:
    return (
        _resource_json("english.json"),
        _resource_json("code.json"),
        _resource_json("symbols.json"),
        _resource_json("modifiers.json"),
    )


def load_raw() -> dict[str, dict[str, str]]:
    """Load a defensive copy of the four dictionary JSON objects."""

    english, code, symbols, modifiers = _cached_raw()
    return {
        "english": dict(english),
        "code": dict(code),
        "symbols": dict(symbols),
        "modifiers": dict(modifiers),
    }


def _build_trie(pattern_to_symbol: Mapping[str, str]) -> TrieNode:
    root = TrieNode()
    for pattern, symbol in pattern_to_symbol.items():
        if pattern.startswith("MOD_"):
            continue
        node = root
        for ch in pattern:
            child = node.children.get(ch)
            if child is None:
                child = TrieNode()
                node.children[ch] = child
            node = child
        node.symbol = symbol
    return root


def _sorted_patterns(pattern_to_symbol: Mapping[str, str]) -> list[str]:
    # JavaScript's Array.sort comparator uses UTF-16 string length.  The
    # dictionary is ASCII today, but using the compatibility helper keeps the
    # ordering rule exact if a supplementary pattern is added later.
    return sorted(pattern_to_symbol, key=lambda pattern: (-_utf16_length(pattern), pattern))


_CACHE: dict[str, object] | None = None


def build() -> Mapping[str, object]:
    """Return the process-wide, cached dictionary indexes.

    The returned mapping has the same logical fields as the JavaScript build
    object.  Its maps and raw dictionaries are read-only views; callers that
    need to modify data can use :func:`dicts` to obtain fresh copies.
    """

    global _CACHE
    if _CACHE is not None:
        return MappingProxyType(_CACHE)

    english, code, symbols, modifiers = _cached_raw()
    pattern_to_symbol: dict[str, str] = {}
    symbol_to_pattern: dict[str, str] = {}
    for dictionary in (english, code, symbols):
        for pattern, symbol in dictionary.items():
            if pattern not in pattern_to_symbol:
                pattern_to_symbol[pattern] = symbol
                symbol_to_pattern[symbol] = pattern

    modifier_symbols: set[str] = set()
    modifier_map: dict[str, dict[str, object]] = {}
    for name, symbol in modifiers.items():
        modifier_symbols.add(symbol)
        modifier_map[symbol] = MappingProxyType(
            {
                "name": name,
                "transform": _MODIFIER_TRANSFORMS.get(name, lambda word: word),
            }
        )
        if name not in pattern_to_symbol:
            pattern_to_symbol[name] = symbol
            symbol_to_pattern[symbol] = name

    sorted_patterns = _sorted_patterns(pattern_to_symbol)
    fragment_patterns = [
        pattern
        for pattern in sorted_patterns
        if 2 <= _utf16_length(pattern) <= 4
    ]

    _CACHE = {
        "patternToSymbol": MappingProxyType(pattern_to_symbol),
        "symbolToPattern": MappingProxyType(symbol_to_pattern),
        "sortedPatterns": tuple(sorted_patterns),
        "modifierSymbols": frozenset(modifier_symbols),
        "modifierMap": MappingProxyType(modifier_map),
        "size": len(pattern_to_symbol),
        "english": MappingProxyType(english),
        "code": MappingProxyType(code),
        "symbols": MappingProxyType(symbols),
        "modifiers": MappingProxyType(modifiers),
        "trie": _build_trie(pattern_to_symbol),
        "fragmentPatterns": tuple(fragment_patterns),
    }
    return MappingProxyType(_CACHE)


def is_modifier(ch: str) -> bool:
    """Return whether *ch* is a modifier symbol."""

    return ch in build()["modifierSymbols"]  # type: ignore[operator]


def get_modifier_transform(ch: str) -> Callable[[str], str] | None:
    """Return the transform associated with a modifier, or ``None``."""

    modifier = build()["modifierMap"].get(ch)  # type: ignore[union-attr]
    if modifier is None:
        return None
    return modifier["transform"]  # type: ignore[return-value]


def reset() -> None:
    """Invalidate the process-wide dictionary index (primarily for tests)."""

    global _CACHE
    _CACHE = None
    _cached_raw.cache_clear()


def dicts() -> dict[str, dict[str, str]]:
    """Return defensive copies of the individual raw dictionaries."""

    return load_raw()


# Public JavaScript-shaped and Python-shaped aliases.
build_dict = build
reset_dict = reset
buildDict = build
resetDict = reset
isModifier = is_modifier
getModifierTransform = get_modifier_transform

__all__ = [
    "TrieNode",
    "build",
    "buildDict",
    "build_dict",
    "dicts",
    "getModifierTransform",
    "get_modifier_transform",
    "isModifier",
    "is_modifier",
    "load_raw",
    "reset",
    "resetDict",
    "reset_dict",
]
