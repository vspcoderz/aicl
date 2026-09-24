"""Stage 2 rank-aware BPE tokenizer over AICL code-point symbols."""

from __future__ import annotations

import heapq
import json
from collections.abc import Mapping
from functools import lru_cache
from importlib import resources
from pathlib import Path
from types import MappingProxyType
from typing import Any

from .unicode import code_points, require_text

_REPOSITORY_VOCAB_PATH = Path(__file__).resolve().parents[1] / "tokenizer" / "vocab.json"
_PACKAGE_VOCAB_PATH = Path(__file__).resolve().parent / "data" / "vocab.json"
VOCAB_PATH: Path = _REPOSITORY_VOCAB_PATH if _REPOSITORY_VOCAB_PATH.exists() else _PACKAGE_VOCAB_PATH
CP_BASE: int = 0x1000000
DEFAULT_MERGE_BASE: int = 100000

# A vocabulary's merge map is immutable at runtime.  The identity-keyed cache
# retains the map object as well as its id, so Python cannot recycle an id for
# a different mapping while an entry is alive.
_PAIR_INDEX_CACHE: list[tuple[object, dict[tuple[int, int], tuple[int, int, int, int]]]] = []


def cp_to_id(ch: str) -> int:
    """Return the base token ID for a character/code point."""

    require_text(ch, "ch")
    if not ch:
        raise ValueError("ch must contain a code point")
    return CP_BASE + ord(ch[0])


def id_to_cp(token_id: int) -> str:
    """Return the character represented by a self-token ID."""

    cp = token_id - CP_BASE
    if cp < 0 or cp > 0x10FFFF:
        raise ValueError(f"invalid code-point token id: {token_id}")
    # chr() preserves lone surrogate code points, as String.fromCodePoint does.
    return chr(cp)


def empty_vocab(merge_base: int = DEFAULT_MERGE_BASE) -> Mapping[str, Any]:
    """Return an untrained vocabulary object."""

    return MappingProxyType({"merges": MappingProxyType({}), "mergeBase": merge_base, "numMerges": 0, "version": "empty"})


def _rule_value(rule: Mapping[str, Any], key: str) -> int:
    value = rule[key]
    if isinstance(value, bool) or not isinstance(value, int):
        raise TypeError(f"merge rule {key} must be an integer")
    return value


def _pair_index(merges: Mapping[int, Mapping[str, Any]]) -> dict[tuple[int, int], tuple[int, int, int, int]]:
    """Compile a pair lookup once for each runtime vocabulary object."""

    cached = next((entry for entry in _PAIR_INDEX_CACHE if entry[0] is merges), None)
    if cached is not None:
        return cached[1]

    pair_index: dict[tuple[int, int], tuple[int, int, int, int]] = {}
    for merged_id, rule in merges.items():
        a = _rule_value(rule, "a")
        b = _rule_value(rule, "b")
        rank = _rule_value(rule, "rank")
        existing = pair_index.get((a, b))
        if existing is None or rank < existing[0]:
            pair_index[(a, b)] = (rank, merged_id, a, b)
    _PAIR_INDEX_CACHE.append((merges, pair_index))
    return pair_index


class _Node:
    __slots__ = ("token", "prev", "next", "version", "pos")

    def __init__(self, token: int, pos: int) -> None:
        self.token = token
        self.prev: _Node | None = None
        self.next: _Node | None = None
        self.version = 0
        self.pos = pos


_Candidate = tuple[int, int, int, _Node, int, _Node, int, tuple[int, int, int, int]]


def _candidate(left: _Node, pair_index: Mapping[tuple[int, int], tuple[int, int, int, int]], serial: int) -> _Candidate | None:
    right = left.next
    if right is None:
        return None
    rule = pair_index.get((left.token, right.token))
    if rule is None:
        return None
    return (rule[0], left.pos, serial, left, left.version, right, right.version, rule)


def _bpe_merge_internal(
    ids: list[int] | tuple[int, ...],
    merges: Mapping[int, Mapping[str, Any]],
    with_map: bool,
) -> list[int] | tuple[list[int], list[int]]:
    sequence = list(ids)
    if not sequence:
        return ([], []) if with_map else []
    pair_index = _pair_index(merges)
    if not pair_index:
        return (sequence, list(range(len(sequence)))) if with_map else sequence

    nodes: list[_Node] = [_Node(token, index) for index, token in enumerate(sequence)]
    spans: list[list[int]] | None = [[index] for index in range(len(sequence))] if with_map else None
    for left, right in zip(nodes, nodes[1:]):
        left.next = right
        right.prev = left
    head = nodes[0]

    heap: list[_Candidate] = []
    serial = 0
    node = head
    while node is not None:
        candidate = _candidate(node, pair_index, serial)
        if candidate is not None:
            heap.append(candidate)
        serial += 1
        node = node.next
    heapq.heapify(heap)
    deferred: list[_Candidate] = []

    while heap:
        candidate = heapq.heappop(heap)
        _, _, _, left, left_version, right, right_version, rule = candidate
        if left.version != left_version or right.version != right_version or left.next is not right:
            continue
        _rank, merged_id, a, b = rule

        # JavaScript merges every non-overlapping occurrence of the selected
        # pair in one left-to-right pass. Newly-created pairs wait until the
        # next pass, which preserves observable rank/tie behavior.
        cursor = head
        while cursor is not None:
            following = cursor.next
            if following is not None and cursor.token == a and following.token == b:
                after = following.next
                cursor.next = after
                if after is not None:
                    after.prev = cursor
                following.version += 1
                if spans is not None:
                    spans[cursor.pos].extend(spans[following.pos])
                cursor.token = merged_id
                cursor.version += 1

                for neighbor in (cursor.prev, cursor):
                    new_candidate = _candidate(neighbor, pair_index, serial) if neighbor is not None else None
                    if new_candidate is not None:
                        deferred.append(new_candidate)
                    serial += 1
                cursor = after
            else:
                cursor = following

        for new_candidate in deferred:
            heapq.heappush(heap, new_candidate)
        deferred.clear()

    result: list[int] = []
    for node in _iter_nodes(head):
        result.append(node.token)
    if not with_map:
        return result

    assert spans is not None
    token_map = [-1] * len(sequence)
    for token_index, node in enumerate(_iter_nodes(head)):
        for position in spans[node.pos]:
            token_map[position] = token_index
    return result, token_map


def bpe_merge(ids: list[int] | tuple[int, ...], merges: Mapping[int, Mapping[str, Any]]) -> list[int]:
    """Apply the same lowest-rank BPE passes as the JavaScript implementation."""

    result = _bpe_merge_internal(ids, merges, False)
    assert isinstance(result, list)
    return result


def bpe_merge_with_map(
    ids: list[int] | tuple[int, ...],
    merges: Mapping[int, Mapping[str, Any]],
) -> tuple[list[int], list[int]]:
    """Return BPE IDs plus the original-position to final-token map."""

    result = _bpe_merge_internal(ids, merges, True)
    assert isinstance(result, tuple)
    return result


def _iter_nodes(head: _Node):
    node: _Node | None = head
    while node is not None:
        yield node
        node = node.next


def tokenize(aicl_text: str, vocab: Mapping[str, Any] | None = None) -> list[int]:
    """Tokenize AICL text into integer IDs."""

    require_text(aicl_text, "aiclText")
    active_vocab = load_tokenizer() if vocab is None else vocab
    merges = active_vocab["merges"]
    if not isinstance(merges, Mapping):
        raise TypeError("vocab.merges must be a mapping")
    return bpe_merge([cp_to_id(ch) for ch in code_points(aicl_text)], merges)


def tokenize_with_map(
    aicl_text: str,
    vocab: Mapping[str, Any] | None = None,
) -> tuple[list[int], list[int]]:
    """Tokenize once and return ``(ids, original_symbol_to_token)``."""

    require_text(aicl_text, "aiclText")
    active_vocab = load_tokenizer() if vocab is None else vocab
    merges = active_vocab["merges"]
    if not isinstance(merges, Mapping):
        raise TypeError("vocab.merges must be a mapping")
    ids = [cp_to_id(ch) for ch in code_points(aicl_text)]
    return bpe_merge_with_map(ids, merges)


tokenizeWithMap = tokenize_with_map


def detokenize(ids: list[int] | tuple[int, ...], vocab: Mapping[str, Any] | None = None) -> str:
    """Expand token IDs back into exact AICL text."""

    active_vocab = load_tokenizer() if vocab is None else vocab
    merges = active_vocab["merges"]
    merge_base = active_vocab.get("mergeBase", DEFAULT_MERGE_BASE)
    num_merges = active_vocab.get("numMerges", len(merges))
    output: list[str] = []

    def expand(token_id: int) -> None:
        if merge_base <= token_id < merge_base + num_merges:
            rule = merges.get(token_id)
            if rule is not None:
                expand(_rule_value(rule, "a"))
                expand(_rule_value(rule, "b"))
                return
        if token_id >= CP_BASE:
            output.append(id_to_cp(token_id))

    for token_id in ids:
        expand(token_id)
    return "".join(output)


def _option(options: Mapping[str, Any], camel: str, snake: str, default: Any) -> Any:
    value = options.get(camel)
    if value is None:
        value = options.get(snake)
    return default if value is None else value


def train_tokenizer(
    aicl_corpus: list[str] | tuple[str, ...],
    opts: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Train deterministic BPE merges over already-encoded AICL strings."""

    options = opts or {}
    num_merges = int(_option(options, "numMerges", "num_merges", 4096))
    merge_base = int(_option(options, "mergeBase", "merge_base", DEFAULT_MERGE_BASE))
    max_token_length = int(_option(options, "maxTokenLength", "max_token_length", 5))
    min_frequency = int(_option(options, "minFrequency", "min_frequency", 2))

    sequences = [[cp_to_id(ch) for ch in code_points(text)] for text in aicl_corpus]
    merges: dict[int, dict[str, int]] = {}
    token_lengths: dict[int, int] = {}
    rank = 0

    for _ in range(num_merges):
        pair_counts: dict[str, int] = {}
        for sequence in sequences:
            for index in range(len(sequence) - 1):
                left = sequence[index]
                right = sequence[index + 1]
                if token_lengths.get(left, 1) + token_lengths.get(right, 1) > max_token_length:
                    continue
                key = f"{left}:{right}"
                pair_counts[key] = pair_counts.get(key, 0) + 1

        best_key: str | None = None
        best_count = 0
        for key, count in pair_counts.items():
            if count < min_frequency:
                continue
            if count > best_count or (count == best_count and (best_key is None or key < best_key)):
                best_key = key
                best_count = count
        if best_key is None or best_count < min_frequency:
            break

        separator = best_key.index(":")
        left = int(best_key[:separator])
        right = int(best_key[separator + 1 :])
        merged_id = merge_base + rank
        merges[merged_id] = {"a": left, "b": right, "rank": rank}
        token_lengths[merged_id] = token_lengths.get(left, 1) + token_lengths.get(right, 1)
        rank += 1

        for sequence_index, sequence in enumerate(sequences):
            next_sequence: list[int] = []
            index = 0
            while index < len(sequence):
                if index < len(sequence) - 1 and sequence[index] == left and sequence[index + 1] == right:
                    next_sequence.append(merged_id)
                    index += 2
                else:
                    next_sequence.append(sequence[index])
                    index += 1
            sequences[sequence_index] = next_sequence

    return {
        "merges": merges,
        "mergeBase": merge_base,
        "numMerges": len(merges),
        "version": "1.0",
        "maxTokenLength": max_token_length,
    }


@lru_cache(maxsize=1)
def _default_vocab_json() -> dict[str, Any]:
    if VOCAB_PATH == _REPOSITORY_VOCAB_PATH:
        return json.loads(VOCAB_PATH.read_text(encoding="utf-8"))
    resource = resources.files("aicl.data").joinpath("vocab.json")
    return json.loads(resource.read_text(encoding="utf-8"))


def _vocab_from_json(raw: Mapping[str, Any]) -> dict[str, Any]:
    raw_merges = raw.get("merges", [])
    merges: dict[int, Mapping[str, Any]] = {}
    if isinstance(raw_merges, list):
        for merged_id, rule in raw_merges:
            merges[int(merged_id)] = MappingProxyType(rule)
    elif isinstance(raw_merges, Mapping):
        for merged_id, rule in raw_merges.items():
            merges[int(merged_id)] = MappingProxyType(rule)
    else:
        raise TypeError("vocab merges must be a list or mapping")
    return {
        "merges": MappingProxyType(merges),
        "mergeBase": raw.get("mergeBase", DEFAULT_MERGE_BASE),
        "numMerges": raw.get("numMerges", len(merges)),
        "version": raw.get("version", "1.0"),
        "maxTokenLength": raw.get("maxTokenLength", 5),
    }


@lru_cache(maxsize=1)
def _default_vocab() -> Mapping[str, Any]:
    """Return one immutable runtime vocabulary for the packaged data."""

    return MappingProxyType(_vocab_from_json(_default_vocab_json()))


def load_tokenizer(path: str | Path | None = None) -> Mapping[str, Any]:
    """Load the packaged trained vocabulary, or an explicit JSON file."""

    if path is None:
        if not VOCAB_PATH.exists():
            return empty_vocab()
        return _default_vocab()
    selected = Path(path)
    if not selected.exists():
        return empty_vocab()
    raw = json.loads(selected.read_text(encoding="utf-8"))
    return MappingProxyType(_vocab_from_json(raw))


def save_tokenizer(
    vocab: Mapping[str, Any],
    path: str | Path | None = None,
) -> None:
    """Serialize a vocabulary in the legacy JSON schema."""

    if path is None and VOCAB_PATH == _PACKAGE_VOCAB_PATH:
        raise ValueError("an explicit vocabulary path is required outside a source checkout")
    destination = VOCAB_PATH if path is None else Path(path)
    merges = vocab["merges"]
    data = {
        "merges": [[int(merged_id), dict(rule)] for merged_id, rule in merges.items()],
        "mergeBase": vocab.get("mergeBase", DEFAULT_MERGE_BASE),
        "version": vocab.get("version", "1.0"),
        "numMerges": vocab.get("numMerges", len(merges)),
        "maxTokenLength": vocab.get("maxTokenLength", 5),
    }
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    if path is None:
        _default_vocab_json.cache_clear()
        _default_vocab.cache_clear()


def save_trained(
    corpus: list[str] | tuple[str, ...],
    opts: Mapping[str, Any] | None = None,
    path: str | Path | None = None,
) -> dict[str, Any]:
    """Train and save a vocabulary in one call."""

    vocab = train_tokenizer(corpus, opts)
    save_tokenizer(vocab, path)
    return vocab


# JavaScript-shaped aliases and public constants.
cpToId = cp_to_id
idToCp = id_to_cp
emptyVocab = empty_vocab
bpeMerge = bpe_merge
bpeMergeWithMap = bpe_merge_with_map
loadTokenizer = load_tokenizer
saveTokenizer = save_tokenizer
saveTrained = save_trained
trainTokenizer = train_tokenizer

__all__ = [
    "CP_BASE",
    "DEFAULT_MERGE_BASE",
    "VOCAB_PATH",
    "bpeMerge",
    "bpe_merge",
    "bpeMergeWithMap",
    "bpe_merge_with_map",
    "cpToId",
    "cp_to_id",
    "detokenize",
    "emptyVocab",
    "empty_vocab",
    "idToCp",
    "id_to_cp",
    "loadTokenizer",
    "load_tokenizer",
    "saveTokenizer",
    "saveTrained",
    "save_trained",
    "save_tokenizer",
    "tokenize",
    "tokenizeWithMap",
    "tokenize_with_map",
    "trainTokenizer",
    "train_tokenizer",
]
