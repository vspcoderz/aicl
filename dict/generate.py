#!/usr/bin/env python3
"""Generate the AICL dictionaries from the historical generator inputs.

The historical generator's large pattern banks are stored as
``dict/source_data.json`` so the tool works without Node.  A small literal
parser remains available for explicitly supplied legacy JavaScript fixtures.

``--variant v3`` is the behavior of the historical generator.  ``--variant
current`` makes the two post-v3 compatibility additions explicit: uppercase
word symbols and the shared ``MOD_ALLCAPS``/multi-space aliases used by the
current runtime data.  The variant is printed and recorded by the caller so a
regenerated dictionary is never mistaken for another historical version.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Iterable


# These ranges intentionally match the historical generator. U+E000 is
# reserved for escaping input that already contains a PUA character.
PUA_RANGES: dict[str, dict[str, int] | dict[str, dict[str, int]]] = {
    "english": {
        "start": 0xE001,
        "end": 0xF8FF,
        "overflow": {"start": 0x100900, "end": 0x10FFFF},
    },
    "code": {"start": 0xF0000, "end": 0xF07FF},
    "phrases": {"start": 0xF0800, "end": 0xF0FFF},
    "markdown": {"start": 0x100000, "end": 0x1003FF},
    "symbols": {"start": 0x100400, "end": 0x1007FF},
    "modifiers": {"start": 0x100800, "end": 0x1008FF},
}


class JsLiteralError(ValueError):
    """Raised when a referenced legacy literal cannot be parsed."""


class JsLiteralParser:
    """Parse the string/array/object subset used by legacy fixtures.

    This is deliberately not a JavaScript interpreter.  It accepts only the
    literals in the retained reference file, which keeps the Python tool
    dependency-free and makes unsupported input fail loudly.
    """

    _IDENTIFIER = re.compile(r"[A-Za-z_$][A-Za-z0-9_$]*")

    def __init__(self, text: str, position: int = 0) -> None:
        self.text = text
        self.position = position

    def parse(self) -> Any:
        self._skip_space()
        value = self._parse_value()
        self._skip_space()
        return value

    def _skip_space(self) -> None:
        while self.position < len(self.text):
            if self.text[self.position].isspace():
                self.position += 1
                continue
            if self.text.startswith("//", self.position):
                end = self.text.find("\n", self.position + 2)
                self.position = len(self.text) if end < 0 else end + 1
                continue
            if self.text.startswith("/*", self.position):
                end = self.text.find("*/", self.position + 2)
                if end < 0:
                    raise JsLiteralError("unterminated JavaScript comment")
                self.position = end + 2
                continue
            break

    def _parse_value(self) -> Any:
        self._skip_space()
        if self.position >= len(self.text):
            raise JsLiteralError("unexpected end of JavaScript literal")
        char = self.text[self.position]
        if char in "'\"":
            return self._parse_string()
        if char == "[":
            return self._parse_array()
        if char == "{":
            return self._parse_object()
        match = self._IDENTIFIER.match(self.text, self.position)
        if match:
            self.position = match.end()
            return match.group(0)
        raise JsLiteralError(f"unsupported JavaScript literal at {self.position}")

    def _parse_string(self) -> str:
        quote = self.text[self.position]
        self.position += 1
        result: list[str] = []
        escapes = {
            "b": "\b",
            "f": "\f",
            "n": "\n",
            "r": "\r",
            "t": "\t",
            "v": "\v",
            "0": "\0",
        }
        while self.position < len(self.text):
            char = self.text[self.position]
            self.position += 1
            if char == quote:
                return "".join(result)
            if char != "\\":
                result.append(char)
                continue
            if self.position >= len(self.text):
                break
            escaped = self.text[self.position]
            self.position += 1
            if escaped in escapes:
                result.append(escapes[escaped])
            elif escaped in "\r\n":
                if escaped == "\r" and self.position < len(self.text) and self.text[self.position] == "\n":
                    self.position += 1
            elif escaped == "x":
                result.append(chr(int(self.text[self.position : self.position + 2], 16)))
                self.position += 2
            elif escaped == "u":
                if self.text[self.position : self.position + 1] == "{":
                    end = self.text.find("}", self.position)
                    result.append(chr(int(self.text[self.position + 1 : end], 16)))
                    self.position = end + 1
                else:
                    result.append(chr(int(self.text[self.position : self.position + 4], 16)))
                    self.position += 4
            else:
                # JavaScript permits escaping punctuation in these literals.
                result.append(escaped)
        raise JsLiteralError("unterminated JavaScript string")

    def _parse_array(self) -> list[Any]:
        self.position += 1
        result: list[Any] = []
        while True:
            self._skip_space()
            if self.position >= len(self.text):
                raise JsLiteralError("unterminated JavaScript array")
            if self.text[self.position] == "]":
                self.position += 1
                return result
            result.append(self._parse_value())
            self._skip_space()
            if self.position >= len(self.text):
                raise JsLiteralError("unterminated JavaScript array")
            if self.text[self.position] == ",":
                self.position += 1
                continue
            if self.text[self.position] != "]":
                raise JsLiteralError(f"expected ',' or ']' at {self.position}")

    def _parse_object(self) -> dict[str, Any]:
        self.position += 1
        result: dict[str, Any] = {}
        while True:
            self._skip_space()
            if self.position >= len(self.text):
                raise JsLiteralError("unterminated JavaScript object")
            if self.text[self.position] == "}":
                self.position += 1
                return result
            if self.text[self.position] in "'\"":
                key = self._parse_string()
            else:
                match = self._IDENTIFIER.match(self.text, self.position)
                if not match:
                    raise JsLiteralError(f"invalid object key at {self.position}")
                key = match.group(0)
                self.position = match.end()
            self._skip_space()
            if self.position >= len(self.text) or self.text[self.position] != ":":
                raise JsLiteralError(f"expected ':' at {self.position}")
            self.position += 1
            result[key] = self._parse_value()
            self._skip_space()
            if self.position >= len(self.text):
                raise JsLiteralError("unterminated JavaScript object")
            if self.text[self.position] == ",":
                self.position += 1
                continue
            if self.text[self.position] != "}":
                raise JsLiteralError(f"expected ',' or '}}' at {self.position}")


def _literal_after(text: str, marker: str) -> Any:
    marker_position = text.find(marker)
    if marker_position < 0:
        raise JsLiteralError(f"literal marker not found: {marker}")
    start = marker_position + len(marker)
    while start < len(text) and text[start].isspace():
        start += 1
    if start >= len(text) or text[start] not in "[{":
        raise JsLiteralError(f"marker does not introduce a literal: {marker}")
    return JsLiteralParser(text, start).parse()


def _source_data(source: Path) -> dict[str, Any] | None:
    if source.suffix.lower() != ".json":
        return None
    try:
        value = json.loads(source.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise JsLiteralError(f"invalid JSON source: {source}") from error
    if not isinstance(value, dict):
        raise JsLiteralError("JSON source must contain an object")
    return value


def _read_array(source: Path, name: str) -> list[Any]:
    data = _source_data(source)
    if data is not None:
        value = data.get(name)
    else:
        text = source.read_text(encoding="utf-8")
        value = _literal_after(text, f"const {name} = ")
    if not isinstance(value, list):
        raise JsLiteralError(f"{name} is not an array")
    return value


def _read_languages(source: Path) -> list[dict[str, Any]]:
    data = _source_data(source)
    if data is not None:
        value = data.get("languages")
    else:
        text = source.read_text(encoding="utf-8")
        fallback_marker = "if (languages.length === 0)"
        marker_position = text.find(fallback_marker)
        if marker_position < 0:
            raise JsLiteralError("embedded keyword fallback not found")
        value = _literal_after(text[marker_position:], "languages = ")
    if not isinstance(value, list) or not all(isinstance(item, dict) for item in value):
        raise JsLiteralError("embedded keyword fallback is not a language list")
    return value


def index_to_symbol(index: int, range_name: str) -> str | None:
    """Return the symbol at *index* in a named PUA range, or None."""
    raw_range = PUA_RANGES[range_name]
    assert isinstance(raw_range, dict)
    start = int(raw_range["start"])
    end = int(raw_range["end"])
    if index < end - start + 1:
        return chr(start + index)
    overflow = raw_range.get("overflow")
    if isinstance(overflow, dict):
        overflow_index = index - (end - start + 1)
        overflow_start = int(overflow["start"])
        overflow_end = int(overflow["end"])
        if overflow_index < overflow_end - overflow_start + 1:
            return chr(overflow_start + overflow_index)
    return None


def _add_entry(entries: dict[str, str], key: str, symbol_index: int, range_name: str, limit: int | None = None) -> int:
    if limit is not None and symbol_index >= limit:
        return symbol_index
    if key in entries:
        return symbol_index
    symbol = index_to_symbol(symbol_index, range_name)
    if symbol is None:
        return symbol_index
    entries[key] = symbol
    return symbol_index + 1


def _generate_modifiers(variant: str) -> dict[str, str]:
    names = [
        "MOD_CAPS",
        "MOD_TRAIL_SPACE",
        "MOD_TRAIL_COMMA",
        "MOD_TRAIL_PERIOD",
        "MOD_TRAIL_QUESTION",
        "MOD_TRAIL_EXCL",
        "MOD_TRAIL_SEMI",
        "MOD_TRAIL_COLON",
        "MOD_TRAIL_RPAREN",
        "MOD_TRAIL_RBRACKET",
        "MOD_TRAIL_RBRACE",
        "MOD_TRAIL_RQUOTE",
        "MOD_LEAD_SPACE",
        "MOD_LEAD_LPAREN",
        "MOD_LEAD_LBRACKET",
        "MOD_LEAD_LBRACE",
        "MOD_LEAD_LQUOTE",
    ]
    if variant == "current":
        names.append("MOD_ALLCAPS")
    return {name: index_to_symbol(i, "modifiers") or "" for i, name in enumerate(names)}


def _generate_english(words: list[str], source: Path, variant: str) -> dict[str, str]:
    entries: dict[str, str] = {}
    if variant == "current":
        # The current checked-in data reserves the digit symbols before the
        # letter symbols.  Keep that ordering explicit in this compatibility
        # variant; historical v3 starts with a-z, A-Z, 0-9.
        single_letters = list("0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ")
    else:
        single_letters = list("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
    index = 0
    for letter in single_letters:
        index = _add_entry(entries, letter, index, "english")

    for lower in _read_array(source, "allCapsWords"):
        if not isinstance(lower, str):
            continue
        caps = lower.upper()
        if caps != lower:
            index = _add_entry(entries, caps, index, "english")

    for word in words:
        lower = word.lower()
        if len(lower) == 1:
            continue
        caps = lower.upper()
        if caps != lower and caps in entries:
            continue
        index = _add_entry(entries, lower, index, "english")

    for fragment in _read_array(source, "fragments"):
        if isinstance(fragment, str):
            index = _add_entry(entries, fragment, index, "english")
    for term in _read_array(source, "techTerms"):
        if isinstance(term, str):
            index = _add_entry(entries, term, index, "english")
    for fragment in _read_array(source, "caseSensitiveFragments"):
        if isinstance(fragment, str):
            index = _add_entry(entries, fragment, index, "english")

    if variant == "current":
        # The current data has a second block of direct all-caps symbols.  It
        # uses the gap after the code/phrases allocations, not English's
        # overflow, so preserve that separate pool and do not disturb base IDs.
        upper_index = 0xF1000
        for key in list(entries):
            if len(key) < 2 or key != key.lower() or key.upper() in entries:
                continue
            entries[key.upper()] = chr(upper_index)
            upper_index += 1
    return entries


def _generate_markdown(source: Path) -> dict[str, str]:
    entries: dict[str, str] = {}
    index = 0
    for pattern in _read_array(source, "patterns"):
        if isinstance(pattern, str):
            index = _add_entry(entries, pattern, index, "markdown", 2048)
    return entries


def _generate_code(languages: list[dict[str, Any]], source: Path) -> dict[str, str]:
    entries: dict[str, str] = {}
    index = 0
    for pattern in _read_array(source, "codePatterns"):
        if isinstance(pattern, str):
            index = _add_entry(entries, pattern, index, "code", 2048)
    for language in languages:
        for keyword in language.get("keywords", []):
            if not isinstance(keyword, str):
                continue
            if index >= 2048:
                break
            index = _add_entry(entries, f" {keyword} ", index, "code", 2048)
            index = _add_entry(entries, f"{keyword}(", index, "code", 2048)
    return entries


def _generate_phrases(source: Path) -> dict[str, str]:
    entries: dict[str, str] = {}
    index = 0
    for phrase in _read_array(source, "phrases"):
        if isinstance(phrase, str):
            index = _add_entry(entries, phrase, index, "phrases", 2048)
    return entries


def _generate_symbols(source: Path) -> dict[str, str]:
    entries: dict[str, str] = {}
    index = 0
    for symbol in _read_array(source, "symbols"):
        if isinstance(symbol, str):
            index = _add_entry(entries, symbol, index, "symbols", 1024)
    return entries


def _current_symbol_aliases() -> list[str]:
    # Added after the historical symbol bank by the all-caps/whitespace
    # compatibility work.  Order is part of the current JSON compatibility.
    return [
        "  ",
        "    ",
        "        ",
        "            ",
        "                ",
        "──",
        "────",
        "────────",
        "══",
        "════",
        "----",
        "====",
        "____",
        "##",
        "###",
        "####",
        "::",
        "│",
        "┌",
        "┐",
        "└",
        "┘",
        "├",
        "┤",
        "┬",
        "┴",
        "┼",
        "═",
        "║",
        "│ ",
        "   ",
        "     ",
        "      ",
        "       ",
    ]


def _load_words(paths: Iterable[Path], source: Path | None = None) -> list[str]:
    words: list[str] = []
    seen: set[str] = set()
    for path in paths:
        if not path.is_file():
            continue
        for raw in path.read_text(encoding="utf-8").splitlines():
            word = raw.lower().strip()
            if len(word) >= 2 and word not in seen:
                seen.add(word)
                words.append(word)
    if not words and source is not None:
        text = source.read_text(encoding="utf-8")
        marker = "const fallback = `"
        start = text.find(marker)
        if start >= 0:
            start += len(marker)
            end = text.find("`;", start)
            if end < 0:
                raise JsLiteralError("unterminated embedded English fallback")
            for word in text[start:end].split():
                word = word.lower()
                if len(word) >= 2 and word not in seen:
                    seen.add(word)
                    words.append(word)
    return words


def _load_keyword_languages(paths: Iterable[Path], source: Path) -> list[dict[str, Any]]:
    for path in paths:
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8")
        languages: list[dict[str, Any]] = []
        current: dict[str, Any] | None = None
        in_keywords = False
        for line in text.splitlines():
            trimmed = line.strip()
            if not trimmed or trimmed.startswith("#"):
                continue
            if trimmed.startswith("- name:"):
                current = {"name": trimmed[len("- name:") :].strip().replace('"', ""), "version": "", "keywords": []}
                languages.append(current)
                in_keywords = False
                continue
            if trimmed.startswith("version:") and current is not None:
                current["version"] = trimmed[len("version:") :].strip().replace('"', "")
                continue
            if trimmed == "keywords:" and current is not None:
                in_keywords = True
                continue
            if in_keywords and trimmed.startswith("- "):
                keyword = trimmed[2:].strip().replace('"', "")
                if keyword not in current["keywords"]:
                    current["keywords"].append(keyword)
            elif in_keywords and not trimmed.startswith("-"):
                in_keywords = False
        if languages:
            return languages
    return _read_languages(source)


def _write_json(path: Path, value: dict[str, str]) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def generate(
    project_root: Path,
    output_dir: Path,
    source: Path,
    variant: str = "v3",
    wordlist_paths: list[Path] | None = None,
    keyword_paths: list[Path] | None = None,
) -> dict[str, int]:
    """Generate dictionaries and return per-file entry counts."""
    if variant not in {"v3", "current"}:
        raise ValueError(f"unsupported dictionary variant: {variant}")
    if not source.is_file():
        raise FileNotFoundError(f"pattern source not found: {source}")
    wordlist_paths = wordlist_paths or [
        Path("/tmp/english_50k.txt"),
        Path("/tmp/english_50k_mixed.txt"),
        Path("/tmp/google-10000-english.txt"),
        Path("/tmp/google-10000-usa.txt"),
        Path("/tmp/google-10000-no-swears.txt"),
        Path("/tmp/combined_english.txt"),
        project_root / "dict" / "wordlists" / "english.txt",
    ]
    keyword_paths = keyword_paths or [
        Path("/tmp/keywords.yaml"),
        project_root / "dict" / "wordlists" / "keywords.yaml",
    ]
    words = _load_words(wordlist_paths, source)
    languages = _load_keyword_languages(keyword_paths, source)
    english = _generate_english(words, source, variant)
    code = _generate_code(languages, source)
    phrases = _generate_phrases(source)
    markdown = _generate_markdown(source)
    symbols = _generate_symbols(source)
    if variant == "current":
        next_symbol = max(ord(symbol) for symbol in english.values()) + 1
        for pattern in _current_symbol_aliases():
            if pattern in symbols or pattern in phrases or pattern in markdown:
                continue
            symbols[pattern] = chr(next_symbol)
            next_symbol += 1
    merged_symbols = {**phrases, **markdown, **symbols}
    modifiers = _generate_modifiers(variant)
    output_dir.mkdir(parents=True, exist_ok=True)
    _write_json(output_dir / "english.json", english)
    _write_json(output_dir / "code.json", code)
    _write_json(output_dir / "symbols.json", merged_symbols)
    _write_json(output_dir / "modifiers.json", modifiers)
    return {
        "english": len(english),
        "code": len(code),
        "symbols": len(merged_symbols),
        "modifiers": len(modifiers),
    }


def _build_parser() -> argparse.ArgumentParser:
    project_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", type=Path, default=project_root)
    parser.add_argument("--output-dir", type=Path, default=project_root / "dict")
    parser.add_argument("--pattern-source", type=Path, default=project_root / "dict" / "source_data.json")
    parser.add_argument("--variant", choices=("v3", "current"), default="v3")
    parser.add_argument("--wordlist", type=Path, action="append", dest="wordlists")
    parser.add_argument("--keywords", type=Path, action="append", dest="keywords")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    project_root = args.project_root.resolve()
    source = args.pattern_source.resolve()
    try:
        counts = generate(
            project_root,
            args.output_dir.resolve(),
            source,
            args.variant,
            args.wordlists,
            args.keywords,
        )
    except (FileNotFoundError, JsLiteralError, ValueError) as error:
        print(f"generate.py: {error}", file=sys.stderr)
        return 2
    print(f"AICL dictionary generator ({args.variant})")
    print(f"  output: {args.output_dir.resolve()}")
    print("  " + "  ".join(f"{name}={count}" for name, count in counts.items()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
