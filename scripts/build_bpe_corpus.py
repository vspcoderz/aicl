#!/usr/bin/env python3
"""Build the historical AICL BPE corpora in Python.

The versioned data banks live in ``data/corpus_banks/*.json``; the corpus
construction, shuffling, encoding, accounting, and CLI are Python.  Keeping the
input bank attached to its version avoids silently turning v1/v2/v3/v4 into
one weighted corpus. Only the standard library is required.

Examples::

    python scripts/build_bpe_corpus.py --variant v1 --seed 0
    python scripts/build_bpe_corpus_v4.py --output corpus/bpe_train_v4.txt

v1-v3 historically used JavaScript's process-randomized sort.  Python uses a
seeded Fisher-Yates shuffle by default so generation is reviewable; v4 retains
its exact mulberry32 PRNG.  The selected variant and seed are printed.
"""

from __future__ import annotations

import argparse
import json
import random
import re
import sys
from pathlib import Path
from typing import Any, Iterable, Iterator


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DICT_DIR = ROOT / "dict"
DEFAULT_OUTPUT_DIR = ROOT / "corpus"
VARIANT_SOURCES = {
    variant: ROOT / "data" / "corpus_banks" / f"{variant}.json"
    for variant in ("v1", "v2", "v3", "v4")
}
DEFAULT_OUTPUTS = {
    "v1": "bpe_train.txt",
    "v2": "bpe_train.txt",
    "v3": "bpe_train.txt",
    "v4": "bpe_train_v4.txt",
}


class LiteralError(ValueError):
    """The retained JavaScript data file is not in the expected form."""


class LiteralParser:
    """Small parser for the string/array/object literals in corpus banks."""

    IDENTIFIER = re.compile(r"[A-Za-z_$][A-Za-z0-9_$]*")

    def __init__(self, text: str, position: int = 0) -> None:
        self.text = text
        self.position = position

    def parse(self) -> Any:
        self.skip()
        value = self.value()
        self.skip()
        return value

    def skip(self) -> None:
        while self.position < len(self.text):
            if self.text[self.position].isspace():
                self.position += 1
            elif self.text.startswith("//", self.position):
                end = self.text.find("\n", self.position + 2)
                self.position = len(self.text) if end < 0 else end + 1
            elif self.text.startswith("/*", self.position):
                end = self.text.find("*/", self.position + 2)
                if end < 0:
                    raise LiteralError("unterminated comment")
                self.position = end + 2
            else:
                return

    def value(self) -> Any:
        self.skip()
        if self.position >= len(self.text):
            raise LiteralError("unexpected end of literal")
        char = self.text[self.position]
        if char in "'\"":
            return self.string()
        if char == "[":
            return self.array()
        if char == "{":
            return self.object()
        match = self.IDENTIFIER.match(self.text, self.position)
        if not match:
            raise LiteralError(f"unsupported literal at {self.position}")
        self.position = match.end()
        return match.group(0)

    def string(self) -> str:
        quote = self.text[self.position]
        self.position += 1
        result: list[str] = []
        escapes = {"b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t", "v": "\v", "0": "\0"}
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
                result.append(chr(int(self.text[self.position : self.position + 4], 16)))
                self.position += 4
            else:
                result.append(escaped)
        raise LiteralError("unterminated string")

    def array(self) -> list[Any]:
        self.position += 1
        result: list[Any] = []
        while True:
            self.skip()
            if self.position >= len(self.text):
                raise LiteralError("unterminated array")
            if self.text[self.position] == "]":
                self.position += 1
                return result
            result.append(self.value())
            self.skip()
            if self.position >= len(self.text):
                raise LiteralError("unterminated array")
            if self.text[self.position] == ",":
                self.position += 1
            elif self.text[self.position] != "]":
                raise LiteralError(f"expected ',' or ']' at {self.position}")

    def object(self) -> dict[str, Any]:
        self.position += 1
        result: dict[str, Any] = {}
        while True:
            self.skip()
            if self.position >= len(self.text):
                raise LiteralError("unterminated object")
            if self.text[self.position] == "}":
                self.position += 1
                return result
            if self.text[self.position] in "'\"":
                key = self.string()
            else:
                match = self.IDENTIFIER.match(self.text, self.position)
                if not match:
                    raise LiteralError(f"invalid key at {self.position}")
                key = match.group(0)
                self.position = match.end()
            self.skip()
            if self.position >= len(self.text) or self.text[self.position] != ":":
                raise LiteralError(f"expected ':' at {self.position}")
            self.position += 1
            result[key] = self.value()
            self.skip()
            if self.position >= len(self.text):
                raise LiteralError("unterminated object")
            if self.text[self.position] == ",":
                self.position += 1
            elif self.text[self.position] != "}":
                raise LiteralError(f"expected ',' or '}}' at {self.position}")


def _literal(text: str, marker: str) -> Any:
    position = text.find(marker)
    if position < 0:
        raise LiteralError(f"missing literal: {marker}")
    start = position + len(marker)
    while start < len(text) and text[start].isspace():
        start += 1
    if start >= len(text) or text[start] not in "[{":
        raise LiteralError(f"not a literal after: {marker}")
    return LiteralParser(text, start).parse()


def _array(source: Path, name: str) -> list[str]:
    if source.suffix.lower() == ".json":
        data = json.loads(source.read_text(encoding="utf-8"))
        value = data.get(name) if isinstance(data, dict) else None
    else:
        value = _literal(source.read_text(encoding="utf-8"), f"const {name} = ")
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise LiteralError(f"{name} is not a string array")
    return value


def _pick(rng: random.Random | Mulberry32, values: list[str]) -> str:
    return values[int(rng.random() * len(values))]


def _append_unique(values: list[str], value: str) -> None:
    if value not in values:
        values.append(value)


class Mulberry32:
    """The PRNG used by the historical v4 builder."""

    def __init__(self, seed: int) -> None:
        self.state = seed & 0xFFFFFFFF

    def random(self) -> float:
        def signed(value: int) -> int:
            value &= 0xFFFFFFFF
            return value - 0x100000000 if value >= 0x80000000 else value

        def imul(left: int, right: int) -> int:
            return signed((left * right) & 0xFFFFFFFF)

        self.state = signed(self.state + 0x6D2B79F5)
        value = imul(self.state ^ (self.state & 0xFFFFFFFF) >> 15, 1 | self.state)
        value = (value + imul(value ^ (value & 0xFFFFFFFF) >> 7, 61 | value)) ^ value
        return ((value ^ (value & 0xFFFFFFFF) >> 14) & 0xFFFFFFFF) / 4294967296


def _shuffle(parts: list[str], rng: random.Random | Mulberry32, exact_v4: bool = False) -> None:
    if exact_v4:
        for index in range(len(parts) - 1, 0, -1):
            other = int(rng.random() * (index + 1))
            parts[index], parts[other] = parts[other], parts[index]
    else:
        # Python's shuffle is deterministic for a seeded Random and preserves
        # the historical "shuffle the repeated parts" behavior.
        if not isinstance(rng, random.Random):
            raise TypeError("non-v4 shuffling requires random.Random")
        rng.shuffle(parts)


class AiclEncoder:
    """Small standalone encoder used only by the corpus builders.

    It mirrors aicl/encoder.py, including the word/fragment fallback and PUA
    escape marker.  The repository's runtime package is intentionally not
    imported because these scripts are standalone data tools.
    """

    def __init__(self, dict_dir: Path) -> None:
        self.pattern_to_symbol: dict[str, str] = {}
        for name in ("english.json", "code.json", "symbols.json"):
            with (dict_dir / name).open(encoding="utf-8") as handle:
                data = json.load(handle)
            for pattern, symbol in data.items():
                self.pattern_to_symbol.setdefault(pattern, symbol)
        with (dict_dir / "modifiers.json").open(encoding="utf-8") as handle:
            modifiers = json.load(handle)
        for name, symbol in modifiers.items():
            self.pattern_to_symbol.setdefault(name, symbol)
        self.sorted_patterns = sorted(self.pattern_to_symbol, key=lambda value: (-len(value), value))
        self.fragments = [value for value in self.sorted_patterns if 2 <= len(value) <= 4]
        self.trie: dict[str, Any] = {"children": {}, "symbol": None}
        for pattern, symbol in self.pattern_to_symbol.items():
            if pattern.startswith("MOD_"):
                continue
            node = self.trie
            for char in pattern:
                node = node["children"].setdefault(char, {"children": {}, "symbol": None})
            node["symbol"] = symbol

    def _match(self, chars: list[str], start: int) -> tuple[int, str | None]:
        node = self.trie
        best_length = 0
        best_symbol: str | None = None
        for index in range(start, len(chars)):
            child = node["children"].get(chars[index])
            if child is None:
                break
            node = child
            if node["symbol"] is not None:
                best_length = index - start + 1
                best_symbol = node["symbol"]
        return best_length, best_symbol

    @staticmethod
    def _word(chars: list[str], start: int) -> str:
        allowed = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'")
        if start >= len(chars) or chars[start] not in allowed:
            return ""
        end = start + 1
        while end < len(chars) and chars[end] in allowed:
            end += 1
        return "".join(chars[start:end])

    @staticmethod
    def _modifier(char: str) -> str | None:
        return {
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
        }.get(char)

    def encode(self, text: str) -> str:
        chars = list(text)
        output: list[str] = []
        index = 0
        while index < len(chars):
            best_length, best_symbol = self._match(chars, index)
            best_pattern = "".join(chars[index : index + best_length]) if best_symbol else ""
            if best_length == 1:
                word = self._word(chars, index)
                if len(word) > 1:
                    lower = word.lower()
                    is_all_caps = word == word.upper() and any("A" <= char <= "Z" for char in word)
                    if is_all_caps:
                        direct = self.pattern_to_symbol.get(word)
                        if direct:
                            output.append(direct)
                            index += len(word)
                            index = self._punctuation(chars, index, output)
                            continue
                        base = self.pattern_to_symbol.get(lower)
                        if base:
                            output.append(base)
                            all_caps = self.pattern_to_symbol.get("MOD_ALLCAPS")
                            if all_caps:
                                output.append(all_caps)
                            index += len(word)
                            index = self._punctuation(chars, index, output)
                            continue
                    elif word[1:] == lower[1:]:
                        base = self.pattern_to_symbol.get(lower)
                        if base:
                            output.append(base)
                            index += len(lower)
                            if word[0] != lower[0]:
                                caps = self.pattern_to_symbol.get("MOD_CAPS")
                                if caps:
                                    output.append(caps)
                            index = self._punctuation(chars, index, output)
                            continue
                    fragment_index = 0
                    matched_fragment = False
                    while fragment_index < len(lower):
                        selected: str | None = None
                        for fragment in self.fragments:
                            if len(fragment) <= len(lower) - fragment_index and lower.startswith(fragment, fragment_index):
                                if is_all_caps or word[fragment_index + 1 : fragment_index + len(fragment)] == lower[fragment_index + 1 : fragment_index + len(fragment)]:
                                    selected = fragment
                                    break
                        if selected is None:
                            break
                        symbol = self.pattern_to_symbol.get(selected)
                        if symbol is None:
                            break
                        output.append(symbol)
                        if is_all_caps:
                            if any("a" <= char <= "z" for char in selected):
                                modifier = self.pattern_to_symbol.get("MOD_ALLCAPS")
                                if modifier:
                                    output.append(modifier)
                        elif word[fragment_index] != lower[fragment_index]:
                            modifier = self.pattern_to_symbol.get("MOD_CAPS")
                            if modifier:
                                output.append(modifier)
                        fragment_index += len(selected)
                        matched_fragment = True
                    if matched_fragment and fragment_index > 0:
                        index += fragment_index
                        index = self._punctuation(chars, index, output)
                        continue
            if best_symbol:
                output.append(best_symbol)
                index += best_length
                continue
            char = chars[index]
            pua = (
                0xE000 <= ord(char) <= 0xF8FF
                or 0xF0000 <= ord(char) <= 0xF0FFF
                or 0x100000 <= ord(char) <= 0x10FFFD
            )
            output.append("\ue000" + char if pua else char)
            index += 1
        return "".join(output)

    def _punctuation(self, chars: list[str], index: int, output: list[str]) -> int:
        while index < len(chars):
            name = self._modifier(chars[index])
            if name is None:
                break
            symbol = self.pattern_to_symbol.get(name)
            if symbol is None:
                break
            output.append(symbol)
            index += 1
        return index


def _add_repeated(parts: list[str], values: list[str], times: int) -> None:
    for _ in range(times):
        parts.extend(values)


def _sentences_v3(source: Path, rng: random.Random) -> list[str]:
    nouns = _array(source, "nouns")
    verbs = _array(source, "verbs")
    adjectives = _array(source, "adjs")
    prepositions = _array(source, "prepositions")
    articles = _array(source, "articles")
    conjunctions = _array(source, "conjunctions")
    adverbs = ["quickly", "slowly", "efficiently", "correctly", "properly", "immediately", "currently", "frequently", "occasionally", "automatically"]
    sentences: list[str] = []
    for _ in range(200):
        _append_unique(sentences,f"{_pick(rng, articles)} {_pick(rng, nouns)} {_pick(rng, verbs)} {_pick(rng, articles)} {_pick(rng, nouns)}")
    for _ in range(200):
        _append_unique(sentences,f"{_pick(rng, articles)} {_pick(rng, adjectives)} {_pick(rng, nouns)} {_pick(rng, verbs)} {_pick(rng, adjectives)} {_pick(rng, nouns)}")
    for _ in range(150):
        _append_unique(sentences,f"{_pick(rng, articles)} {_pick(rng, nouns)} {_pick(rng, verbs)} {_pick(rng, nouns)} {_pick(rng, conjunctions)} {_pick(rng, articles)} {_pick(rng, nouns)} {_pick(rng, verbs)} {_pick(rng, nouns)}")
    for _ in range(150):
        _append_unique(sentences,f"{_pick(rng, articles)} {_pick(rng, nouns)} {_pick(rng, verbs)} {_pick(rng, nouns)} {_pick(rng, prepositions)} {_pick(rng, articles)} {_pick(rng, adjectives)} {_pick(rng, nouns)}")
    for _ in range(100):
        _append_unique(sentences,f"{_pick(rng, articles)} {_pick(rng, nouns)} was {_pick(rng, verbs)} by {_pick(rng, articles)} {_pick(rng, nouns)}")
    for _ in range(100):
        _append_unique(sentences,f"does {_pick(rng, articles)} {_pick(rng, nouns)} {_pick(rng, verbs)} {_pick(rng, nouns)}")
    for _ in range(200):
        _append_unique(sentences,f"the {_pick(rng, nouns)} {_pick(rng, verbs)} {_pick(rng, articles)} {_pick(rng, adjectives)} {_pick(rng, nouns)} {_pick(rng, prepositions)} {_pick(rng, articles)} {_pick(rng, nouns)}")
    for _ in range(100):
        _append_unique(sentences,f"{_pick(rng, articles)} {_pick(rng, nouns)} {_pick(rng, adverbs)} {_pick(rng, verbs)} {_pick(rng, articles)} {_pick(rng, nouns)}")
    for _ in range(100):
        _append_unique(sentences,f"{_pick(rng, articles)} {_pick(rng, adjectives)} {_pick(rng, nouns)} is more {_pick(rng, adjectives)} than {_pick(rng, articles)} {_pick(rng, nouns)}")
    for _ in range(100):
        _append_unique(sentences,f"{_pick(rng, nouns)}, {_pick(rng, nouns)}, and {_pick(rng, nouns)} are {_pick(rng, adjectives)} {_pick(rng, nouns)}")
    return list(sentences)


def _sentences_v4(source: Path, rng: Mulberry32) -> list[str]:
    nouns = _array(source, "nouns")
    verbs = _array(source, "verbs")
    adjectives = _array(source, "adjs")
    prepositions = _array(source, "prepositions")
    articles = _array(source, "articles")
    conjunctions = _array(source, "conjunctions")
    adverbs = _array(source, "adverbs")
    sentences: list[str] = []
    for _ in range(400):
        _append_unique(sentences,f"{_pick(rng, articles)} {_pick(rng, nouns)} {_pick(rng, verbs)} {_pick(rng, articles)} {_pick(rng, nouns)}")
    for _ in range(300):
        _append_unique(sentences,f"{_pick(rng, articles)} {_pick(rng, adjectives)} {_pick(rng, nouns)} {_pick(rng, verbs)} {_pick(rng, adjectives)} {_pick(rng, nouns)}")
    for _ in range(250):
        _append_unique(sentences,f"{_pick(rng, articles)} {_pick(rng, nouns)} {_pick(rng, verbs)} {_pick(rng, nouns)} {_pick(rng, conjunctions)} {_pick(rng, articles)} {_pick(rng, nouns)} {_pick(rng, verbs)} {_pick(rng, nouns)}")
    for _ in range(250):
        _append_unique(sentences,f"{_pick(rng, articles)} {_pick(rng, nouns)} {_pick(rng, verbs)} {_pick(rng, nouns)} {_pick(rng, prepositions)} {_pick(rng, articles)} {_pick(rng, adjectives)} {_pick(rng, nouns)}")
    for _ in range(150):
        _append_unique(sentences,f"{_pick(rng, articles)} {_pick(rng, nouns)} was {_pick(rng, verbs)} by {_pick(rng, articles)} {_pick(rng, nouns)}")
    for _ in range(100):
        _append_unique(sentences,f"does {_pick(rng, articles)} {_pick(rng, nouns)} {_pick(rng, verbs)} {_pick(rng, nouns)}")
    for _ in range(300):
        _append_unique(sentences,f"the {_pick(rng, nouns)} {_pick(rng, verbs)} {_pick(rng, articles)} {_pick(rng, adjectives)} {_pick(rng, nouns)} {_pick(rng, prepositions)} {_pick(rng, articles)} {_pick(rng, nouns)}")
    for _ in range(150):
        _append_unique(sentences,f"{_pick(rng, articles)} {_pick(rng, nouns)} {_pick(rng, adverbs)} {_pick(rng, verbs)} {_pick(rng, articles)} {_pick(rng, nouns)}")
    for _ in range(100):
        _append_unique(sentences,f"{_pick(rng, articles)} {_pick(rng, adjectives)} {_pick(rng, nouns)} is more {_pick(rng, adjectives)} than {_pick(rng, articles)} {_pick(rng, nouns)}")
    for _ in range(100):
        _append_unique(sentences,f"{_pick(rng, nouns)}, {_pick(rng, nouns)}, and {_pick(rng, nouns)} are {_pick(rng, adjectives)} {_pick(rng, nouns)}")
    for _ in range(150):
        _append_unique(sentences,f"yesterday {_pick(rng, articles)} {_pick(rng, adjectives)} {_pick(rng, nouns)} {_pick(rng, verbs)} {_pick(rng, articles)} {_pick(rng, nouns)} {_pick(rng, prepositions)} {_pick(rng, articles)} {_pick(rng, nouns)}")
    for _ in range(150):
        _append_unique(sentences,f"{_pick(rng, articles)} quarterly {_pick(rng, nouns)} {_pick(rng, verbs)} significant {_pick(rng, nouns)} across all {_pick(rng, adjectives)} {_pick(rng, nouns)}")
    return list(sentences)


def _paraphrases_v4(source: Path, rng: Mulberry32) -> list[str]:
    nouns = _array(source, "nouns")
    adjectives = _array(source, "adjs")
    articles = _array(source, "articles")
    values: list[str] = []
    for _ in range(120):
        _append_unique(values, f"the {_pick(rng, adjectives)} {_pick(rng, nouns)} {_pick(rng, ['is', 'was', 'has', 'can', 'will', 'should', 'must', 'may', 'might', 'needs'])} over the {_pick(rng, adjectives)} {_pick(rng, nouns)} while the {_pick(rng, nouns)} {_pick(rng, ['is', 'was', 'has', 'can', 'will', 'should', 'must', 'may', 'might', 'needs'])} {_pick(rng, articles)} {_pick(rng, nouns)}")
    for _ in range(120):
        _append_unique(values, f"SELECT {_pick(rng, ['id', 'name', 'email', 'title', 'score', 'status'])} FROM {_pick(rng, nouns)} WHERE {_pick(rng, ['active', 'score', 'status'])} = {_pick(rng, ['1', '42', 'true', "'x'"])} ORDER BY {_pick(rng, ['name', 'created_at', 'score'])};")
    for _ in range(120):
        _append_unique(values, f"{{\"status\": {_pick(rng, ['\"ok\"', '\"success\"', '\"error\"'])}, \"data\": {{\"{_pick(rng, ['users', 'items', 'tasks'])}\": [{{\"id\": {1 + int(rng.random() * 9)}, \"name\": \"{_pick(rng, ['Alice', 'Bob', 'Carol', 'Dave'])}\"}}], \"total\": {1 + int(rng.random() * 9)}}}}}")
    for _ in range(100):
        _append_unique(values, f"{_pick(rng, ['git status --short', 'git log --oneline', 'npm run build', 'npm test', 'ls -la /tmp', 'cat file.txt', 'docker ps', 'curl -s https://api.example.com/health'])} {_pick(rng, ['&&', '||', '|', ';'])} {_pick(rng, ['echo done', 'cat output.log', 'npm start', 'git diff --stat'])}")
    for _ in range(100):
        _append_unique(values, f"{_pick(rng, ['const', 'let', 'var'])} {_pick(rng, ['result', 'value', 'output', 'data', 'total'])} = {_pick(rng, ['items', 'input', 'records', 'cache'])}.{_pick(rng, ['filter', 'map', 'reduce', 'find'])}(x => x.{_pick(rng, ['active', 'value', 'id', 'score'])});")
    return list(values)


def build_variant(variant: str, source: Path, dict_dir: Path, seed: int, limit: int | None = None) -> tuple[list[str], dict[str, int]]:
    if variant not in VARIANT_SOURCES:
        raise ValueError(f"unsupported BPE variant: {variant}")
    if not source.is_file():
        raise FileNotFoundError(source)
    data = {name: _array(source, name) for name in (
        "english", "code", "sql", "shell", "api", "markdown", "paths", "nouns", "verbs", "adjs", "prepositions", "articles", "conjunctions", "adverbs", "benchmarkVariants", "codeSentences", "sqlSentences", "shellSentences", "apiSentences", "markdownSentences", "pathSentences", "adversarial", "benchmark", "benchmarkExact"
    ) if _has_name(source, name)}
    rng: random.Random | Mulberry32 = Mulberry32(seed) if variant == "v4" else random.Random(seed)
    parts: list[str] = []
    if variant == "v1":
        _add_repeated(parts, data["english"], 200)
        _add_repeated(parts, data["code"], 60)
        _add_repeated(parts, data["sql"], 60)
        _add_repeated(parts, data["shell"], 40)
        _add_repeated(parts, data["api"], 40)
        _add_repeated(parts, data["markdown"], 30)
        _add_repeated(parts, data["paths"], 30)
        _add_repeated(parts, data["benchmarkVariants"], 200)
    elif variant == "v2":
        _add_repeated(parts, data["english"], 30)
        _add_repeated(parts, data["code"], 30)
        _add_repeated(parts, data["sql"], 25)
        _add_repeated(parts, data["shell"], 25)
        _add_repeated(parts, data["api"], 25)
        _add_repeated(parts, data["markdown"], 20)
        _add_repeated(parts, data["paths"], 20)
        _add_repeated(parts, data["benchmark"], 5)
    elif variant == "v3":
        _add_repeated(parts, _sentences_v3(source, rng if isinstance(rng, random.Random) else random.Random(seed)), 20)
        _add_repeated(parts, data["codeSentences"], 20)
        _add_repeated(parts, data["sqlSentences"], 15)
        _add_repeated(parts, data["shellSentences"], 15)
        _add_repeated(parts, data["apiSentences"], 15)
        _add_repeated(parts, data["benchmark"], 5)
    else:
        english = _sentences_v4(source, rng if isinstance(rng, Mulberry32) else Mulberry32(seed))
        paraphrases = _paraphrases_v4(source, rng if isinstance(rng, Mulberry32) else Mulberry32(seed))
        _add_repeated(parts, english, 8)
        _add_repeated(parts, paraphrases, 10)
        _add_repeated(parts, data["codeSentences"], 12)
        _add_repeated(parts, data["sqlSentences"], 12)
        _add_repeated(parts, data["shellSentences"], 12)
        _add_repeated(parts, data["apiSentences"], 12)
        _add_repeated(parts, data["markdownSentences"], 10)
        _add_repeated(parts, data["pathSentences"], 10)
        _add_repeated(parts, data["adversarial"], 4)
        _add_repeated(parts, data["benchmarkExact"], 3)
    _shuffle(parts, rng, exact_v4=variant == "v4")
    if limit is not None:
        parts = parts[:limit]
    encoder = AiclEncoder(dict_dir)
    lines: list[str] = []
    raw_chars = 0
    aicl_chars = 0
    symbols: set[str] = set()
    for part in parts:
        aicl = encoder.encode(part)
        if aicl:
            lines.append(aicl)
            raw_chars += len(part)
            aicl_chars += len(aicl)
            symbols.update(aicl)
    return lines, {"sentences": len(lines), "raw_chars": raw_chars, "aicl_chars": aicl_chars, "unique_symbols": len(symbols)}


def _has_name(source: Path, name: str) -> bool:
    text = source.read_text(encoding="utf-8")
    marker = f"const {name} = "
    position = text.find(marker)
    if position < 0:
        return False
    return text[position + len(marker) :].lstrip().startswith("[")


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--variant", choices=tuple(VARIANT_SOURCES), default="v1")
    parser.add_argument("--source", type=Path)
    parser.add_argument("--dict-dir", type=Path, default=DEFAULT_DICT_DIR)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--limit", type=int, help="smoke-test cap; omit for the full historical corpus")
    return parser


def main(variant: str | None = None, argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    selected = variant or args.variant
    source = (args.source or VARIANT_SOURCES[selected]).resolve()
    output = (args.output or args.output_dir / DEFAULT_OUTPUTS[selected]).resolve()
    if args.seed < 0:
        parser.error("--seed must be non-negative")
    if args.limit is not None and args.limit <= 0:
        parser.error("--limit must be positive")
    try:
        lines, stats = build_variant(selected, source, args.dict_dir.resolve(), args.seed, args.limit)
    except (FileNotFoundError, LiteralError, OSError, ValueError) as error:
        print(f"build_bpe_corpus: {error}", file=sys.stderr)
        return 2
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text("\n".join(lines), encoding="utf-8")
    print(f"BPE corpus {selected} (seed={args.seed})")
    print(f"  sentences: {stats['sentences']}")
    print(f"  raw chars: {stats['raw_chars']}")
    print(f"  AICL chars: {stats['aicl_chars']}")
    print(f"  ratio: {stats['raw_chars'] / stats['aicl_chars']:.2f}x")
    if selected in {"v3", "v4"}:
        print(f"  unique PUA symbols: {stats['unique_symbols']}")
    print(f"  wrote: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
