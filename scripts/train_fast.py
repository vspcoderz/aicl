#!/usr/bin/env python3
"""Fast incremental BPE trainer for AICL's PUA symbol sequences.

This is a Python port of the former ``train_fast.mjs`` script.  It deliberately
keeps the JavaScript algorithm and vocabulary schema intact: merge ids are
``merge_base + rank`` and the JSON written by :func:`save_vocab` uses the
camelCase fields consumed by the existing tokenizer data.

The module is also the small shared vocabulary adapter used by the other
conversion scripts.  It has no third-party dependencies and can be imported
without loading the runtime dictionary.
"""

from __future__ import annotations

import argparse
import json
import os
import resource
import time
from collections.abc import Mapping as AbstractMapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping, Sequence


CP_BASE = 0x1000000
DEFAULT_MERGE_BASE = 100_000
DEFAULT_MAX_TOKEN_LENGTH = 5
DEFAULT_MIN_FREQUENCY = 2
DEFAULT_TRAILING_SPACE_CODEPOINTS = (
    0x100406,
    0x100801,
    0x10AE54,
    0x10AE55,
    0x10AE56,
    0x10AE57,
    0x10AE58,
    0x10AE72,
    0x10AE73,
    0x10AE74,
    0x10AE75,
)
ALIAS_FLAG = 0x40000000
ALIAS_LIMIT = ALIAS_FLAG + len(DEFAULT_TRAILING_SPACE_CODEPOINTS) * 0x1000000
CAPS_FLAG = 0x50000000
CAPS_LIMIT = 0x58000000
MOD_CAPS_CP = 0x100800
MOD_ALLCAPS_CP = 0x100811

ProgressCallback = Callable[[int, int, "FastVocab"], None]


@dataclass
class FastVocab(AbstractMapping[str, Any]):
    """The small vocabulary object expected by the tokenizer runtime.

    ``merges`` is an insertion-ordered mapping from runtime token id to a
    JSON-shaped rule.  Camel-case properties are intentionally provided as a
    compatibility convenience for code ported from the JavaScript scripts.
    """

    merges: dict[int, dict[str, Any]]
    merge_base: int = DEFAULT_MERGE_BASE
    num_merges: int = 0
    version: str = "1.1"
    max_token_length: int = DEFAULT_MAX_TOKEN_LENGTH
    aliases: int = 0

    @property
    def mergeBase(self) -> int:
        return self.merge_base

    @property
    def numMerges(self) -> int:
        return self.num_merges

    @property
    def maxTokenLength(self) -> int:
        return self.max_token_length

    def __getitem__(self, key: str) -> Any:
        values = {
            "merges": self.merges,
            "mergeBase": self.merge_base,
            "merge_base": self.merge_base,
            "numMerges": self.num_merges,
            "num_merges": self.num_merges,
            "version": self.version,
            "maxTokenLength": self.max_token_length,
            "max_token_length": self.max_token_length,
        }
        if key not in values:
            raise KeyError(key)
        return values[key]

    def __iter__(self) -> Any:
        return iter(("merges", "mergeBase", "numMerges", "version", "maxTokenLength"))

    def __len__(self) -> int:
        return 5

    def to_json_dict(self) -> dict[str, Any]:
        """Return the stable on-disk vocabulary schema."""

        return {
            "merges": [[int(token_id), rule] for token_id, rule in self.merges.items()],
            "mergeBase": self.merge_base,
            "version": self.version,
            "numMerges": self.num_merges,
            "maxTokenLength": self.max_token_length,
        }

    @classmethod
    def from_json_dict(cls, raw: Mapping[str, Any], *, aliases: int = 0) -> "FastVocab":
        raw_merges = raw.get("merges", [])
        if isinstance(raw_merges, Mapping):
            entries: Iterable[tuple[Any, Any]] = raw_merges.items()
        else:
            entries = raw_merges
        merges: dict[int, dict[str, Any]] = {}
        for entry in entries:
            if not isinstance(entry, (list, tuple)) or len(entry) != 2:
                raise ValueError("each merge must be a [id, rule] pair")
            token_id, rule = entry
            if not isinstance(rule, Mapping):
                raise ValueError(f"merge rule for {token_id!r} must be an object")
            merges[int(token_id)] = dict(rule)
        merge_base = int(raw.get("mergeBase", raw.get("merge_base", DEFAULT_MERGE_BASE)))
        num_merges = int(raw.get("numMerges", raw.get("num_merges", len(merges))))
        max_length = int(
            raw.get("maxTokenLength", raw.get("max_token_length", DEFAULT_MAX_TOKEN_LENGTH))
        )
        return cls(
            merges=merges,
            merge_base=merge_base,
            num_merges=num_merges,
            version=str(raw.get("version", "1.0")),
            max_token_length=max_length,
            aliases=aliases,
        )


def vocab_json(vocab: Any) -> dict[str, Any]:
    """Serialize either a :class:`FastVocab` or a runtime vocabulary object."""

    if isinstance(vocab, FastVocab):
        return vocab.to_json_dict()
    merges = getattr(vocab, "merges", None)
    if merges is None:
        raise TypeError("vocabulary has no merges mapping")
    if isinstance(merges, Mapping):
        entries = [[int(token_id), dict(rule)] for token_id, rule in merges.items()]
    else:
        entries = [[int(token_id), dict(rule)] for token_id, rule in merges]
    merge_base = int(getattr(vocab, "merge_base", getattr(vocab, "mergeBase", DEFAULT_MERGE_BASE)))
    num_merges = int(getattr(vocab, "num_merges", getattr(vocab, "numMerges", len(entries))))
    version = str(getattr(vocab, "version", "1.0"))
    max_length = int(
        getattr(vocab, "max_token_length", getattr(vocab, "maxTokenLength", DEFAULT_MAX_TOKEN_LENGTH))
    )
    return {
        "merges": entries,
        "mergeBase": merge_base,
        "version": version,
        "numMerges": num_merges,
        "maxTokenLength": max_length,
    }


def save_vocab(vocab: Any, path: str | os.PathLike[str]) -> None:
    """Write a vocabulary using the repository's stable JSON schema."""

    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(destination.name + ".tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(vocab_json(vocab), handle, ensure_ascii=False, separators=(",", ":"))
        handle.write("\n")
    temporary.replace(destination)


def read_lines(path: str | os.PathLike[str], *, keep_empty: bool = False) -> list[str]:
    """Read newline-delimited text while retaining the legacy line semantics."""

    text = Path(path).read_text(encoding="utf-8")
    lines = text.split("\n")
    if lines and lines[-1] == "" and not keep_empty:
        lines.pop()
    return lines


def _rule_value(rule: Any, key: str, default: Any = None) -> Any:
    if isinstance(rule, Mapping):
        return rule.get(key, default)
    try:
        return rule[key]
    except (IndexError, KeyError, TypeError):
        return default


def _rule_object(rule: Any, default_rank: int) -> dict[str, Any]:
    if isinstance(rule, Mapping):
        result = dict(rule)
        result.setdefault("rank", default_rank)
        return result
    if isinstance(rule, (list, tuple)) and len(rule) >= 2:
        return {"a": int(rule[0]), "b": int(rule[1]), "rank": int(rule[2]) if len(rule) > 2 else default_rank}
    raise ValueError(f"invalid merge rule: {rule!r}")


def _is_ws_id(token_id: int) -> bool:
    return token_id in {
        CP_BASE + 0x20,
        CP_BASE + 0x09,
        CP_BASE + 0x0A,
        CP_BASE + 0x100406,
        CP_BASE + 0x100801,
    } or (
        CP_BASE + 0x10AE54 <= token_id <= CP_BASE + 0x10AE58
    ) or (
        CP_BASE + 0x10AE72 <= token_id <= CP_BASE + 0x10AE75
    )


def _rss_mb() -> float:
    """Return resident memory in MiB where the stdlib exposes it."""

    try:
        # Linux reports KiB.  The fallback keeps the CLI portable.
        return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0
    except (AttributeError, OSError):
        return 0.0


def train_tokenizer_fast(
    aicl_corpus: Sequence[str],
    options: Mapping[str, Any] | None = None,
    *,
    num_merges: int = 4096,
    merge_base: int = DEFAULT_MERGE_BASE,
    max_token_length: int = DEFAULT_MAX_TOKEN_LENGTH,
    min_frequency: int = DEFAULT_MIN_FREQUENCY,
    alias_trailing_space: bool = False,
    trailing_space_code_points: Sequence[int] | None = None,
    learn_every: int = 1,
    skip_degenerate_pairs: bool = False,
    init_merges: Sequence[tuple[int, Any]] | None = None,
    on_progress: ProgressCallback | None = None,
) -> FastVocab:
    """Train the fast BPE variant.

    The implementation intentionally mirrors the old JavaScript loops rather
    than using a library BPE implementation.  In particular, learned merge
    selection is frequency-first with lexical pair-key tie breaking, and
    aliases receive the lowest ranks.
    """

    if options is not None:
        num_merges = int(options.get("numMerges", options.get("num_merges", num_merges)))
        merge_base = int(options.get("mergeBase", options.get("merge_base", merge_base)))
        max_token_length = int(
            options.get("maxTokenLength", options.get("max_token_length", max_token_length))
        )
        min_frequency = int(options.get("minFrequency", options.get("min_frequency", min_frequency)))
        alias_trailing_space = bool(
            options.get("aliasTrailingSpace", options.get("alias_trailing_space", alias_trailing_space))
        )
        trailing_space_code_points = options.get(
            "trailingSpaceCodePoints", options.get("trailing_space_code_points", trailing_space_code_points)
        )
        learn_every = int(options.get("learnEvery", options.get("learn_every", learn_every)))
        skip_degenerate_pairs = bool(
            options.get("skipDegeneratePairs", options.get("skip_degenerate_pairs", skip_degenerate_pairs))
        )
        init_merges = options.get("initMerges", options.get("init_merges", init_merges))
        on_progress = options.get("onProgress", options.get("on_progress", on_progress))

    if num_merges < 0 or merge_base < 0 or max_token_length < 1 or min_frequency < 1:
        raise ValueError("merge and frequency options must be non-negative, max length positive")
    if learn_every < 1:
        raise ValueError("learn_every must be at least 1")

    tsp_cps = tuple(
        DEFAULT_TRAILING_SPACE_CODEPOINTS
        if trailing_space_code_points is None
        else trailing_space_code_points
    )
    tsp_ids = tuple(CP_BASE + cp for cp in tsp_cps)
    alias_limit = ALIAS_FLAG + len(tsp_cps) * 0x1000000
    resume = bool(init_merges)

    def cp_to_id(char: str) -> int:
        return CP_BASE + ord(char)

    seqs: list[list[int]] = [[cp_to_id(char) for char in text] for text in aicl_corpus]
    merges: dict[int, dict[str, Any]] = {}
    token_len: dict[int, int] = {}
    pair_counts: dict[str, int] = {}
    alias_merged_id: dict[str, int] = {}
    alias_freq: dict[str, int] = {}
    caps_merged_id: dict[str, int] = {}
    caps_freq: dict[str, int] = {}

    if resume:
        assert init_merges is not None
        for token_id, raw_rule in init_merges:
            rule = _rule_object(raw_rule, len(merges))
            a = int(rule["a"])
            b = int(rule["b"])
            rule.setdefault("rank", len(merges))
            merges[int(token_id)] = rule
            token_len[int(token_id)] = token_len.get(a, 1) + token_len.get(b, 1)
            if rule.get("alias") is True and a >= CP_BASE and a not in tsp_ids:
                form = tsp_ids.index(b) if b in tsp_ids else -1
                if form != -1:
                    alias_merged_id[f"{a - CP_BASE}:{form}"] = int(token_id)
    elif alias_trailing_space:
        # Fusing (symbol, space-form) and the caps triple before pair counting
        # is what gives the tokenizer its unseen-word alias coverage.
        for seq in seqs:
            write_index = 0
            index = 0
            while index < len(seq):
                current = seq[index]
                following = seq[index + 1] if index + 1 < len(seq) else -1
                following_two = seq[index + 2] if index + 2 < len(seq) else -1
                cp = current - CP_BASE
                pair_form = tsp_ids.index(following) if following in tsp_ids else -1
                mod_cp = following - CP_BASE if following != -1 else -1
                triple_form = tsp_ids.index(following_two) if following_two in tsp_ids else -1
                if pair_form != -1 and current not in tsp_ids:
                    key = f"{cp}:{pair_form}"
                    alias_freq[key] = alias_freq.get(key, 0) + 1
                    seq[write_index] = ALIAS_FLAG + pair_form * 0x1000000 + cp
                    write_index += 1
                    index += 2
                elif (
                    triple_form != -1
                    and mod_cp in (MOD_CAPS_CP, MOD_ALLCAPS_CP)
                    and current not in tsp_ids
                    and cp not in (MOD_CAPS_CP, MOD_ALLCAPS_CP)
                ):
                    kind = 1 if mod_cp == MOD_ALLCAPS_CP else 0
                    key = f"{cp}:{kind}:{triple_form}"
                    caps_freq[key] = caps_freq.get(key, 0) + 1
                    # The modifier-plus-space rule is also emitted as the
                    # right hand side of the caps rule.
                    modifier_key = f"{mod_cp}:{triple_form}"
                    alias_freq[modifier_key] = alias_freq.get(modifier_key, 0) + 1
                    seq[write_index] = CAPS_FLAG + kind * 0x400000 + triple_form * 0x200000 + cp
                    write_index += 1
                    index += 3
                else:
                    seq[write_index] = current
                    write_index += 1
                    index += 1
            del seq[write_index:]

        def descending(items: dict[str, int]) -> list[str]:
            return [key for key, _ in sorted(items.items(), key=lambda pair: (-pair[1], pair[0]))]

        for key in descending(alias_freq):
            left, right = key.rsplit(":", 1)
            cp = int(left)
            form = int(right)
            token_id = merge_base + len(merges)
            merges[token_id] = {
                "a": CP_BASE + cp,
                "b": CP_BASE + tsp_cps[form],
                "rank": len(merges),
                "alias": True,
            }
            token_len[token_id] = 2
            alias_merged_id[key] = token_id
        for key in descending(caps_freq):
            cp_text, kind_text, form_text = key.split(":")
            cp = int(cp_text)
            kind = int(kind_text)
            form = int(form_text)
            modifier_cp = MOD_ALLCAPS_CP if kind else MOD_CAPS_CP
            right = alias_merged_id.get(f"{modifier_cp}:{form}")
            if right is None:
                continue
            token_id = merge_base + len(merges)
            merges[token_id] = {
                "a": CP_BASE + cp,
                "b": right,
                "rank": len(merges),
                "alias": True,
                "caps": kind,
            }
            token_len[token_id] = 3
            caps_merged_id[key] = token_id

    if alias_trailing_space and not resume:
        for seq in seqs:
            for index, token_id in enumerate(seq):
                if CAPS_FLAG <= token_id < CAPS_LIMIT:
                    rest = token_id - CAPS_FLAG
                    kind = rest // 0x400000
                    form = (rest % 0x400000) // 0x200000
                    cp = rest % 0x200000
                    seq[index] = caps_merged_id[f"{cp}:{kind}:{form}"]
                elif ALIAS_FLAG <= token_id < alias_limit:
                    form = (token_id - ALIAS_FLAG) // 0x1000000
                    cp = token_id - ALIAS_FLAG - form * 0x1000000
                    seq[index] = alias_merged_id[f"{cp}:{form}"]
    elif alias_trailing_space and resume:
        for seq in seqs:
            write_index = 0
            index = 0
            while index < len(seq):
                current = seq[index]
                following = seq[index + 1] if index + 1 < len(seq) else -1
                form = tsp_ids.index(following) if following in tsp_ids else -1
                alias_id = alias_merged_id.get(f"{current - CP_BASE}:{form}") if form != -1 else None
                if alias_id is not None and current not in tsp_ids:
                    seq[write_index] = alias_id
                    write_index += 1
                    index += 2
                else:
                    seq[write_index] = current
                    write_index += 1
                    index += 1
            del seq[write_index:]

    learn_seqs = seqs[::learn_every] if learn_every > 1 else seqs

    def add_pair(a: int, b: int, delta: int) -> None:
        if skip_degenerate_pairs and delta > 0 and (a == b or (_is_ws_id(a) and _is_ws_id(b))):
            return
        if token_len.get(a, 1) + token_len.get(b, 1) > max_token_length:
            return
        key = f"{a}:{b}"
        count = pair_counts.get(key, 0) + delta
        if count > 0:
            pair_counts[key] = count
        else:
            pair_counts.pop(key, None)

    def pick_best() -> str | None:
        best_key: str | None = None
        best_count = 0
        for key, count in pair_counts.items():
            if count < min_frequency:
                continue
            if count > best_count or (count == best_count and (best_key is None or key < best_key)):
                best_key = key
                best_count = count
        return best_key if best_count >= min_frequency else None

    for seq in learn_seqs:
        for index in range(len(seq) - 1):
            add_pair(seq[index], seq[index + 1], 1)

    learn_target = max(0, num_merges - len(merges)) if resume else num_merges
    for learned in range(learn_target):
        best_key = pick_best()
        if best_key is None:
            break
        left, right = best_key.split(":", 1)
        a = int(left)
        b = int(right)
        merged_id = merge_base + len(merges)
        merges[merged_id] = {"a": a, "b": b, "rank": len(merges)}
        token_len[merged_id] = token_len.get(a, 1) + token_len.get(b, 1)

        for sequence_index, seq in enumerate(learn_seqs):
            next_seq: list[int] = []
            previous = -1
            index = 0
            while index < len(seq):
                if index < len(seq) - 1 and seq[index] == a and seq[index + 1] == b:
                    if previous != -1:
                        add_pair(previous, a, -1)
                    if index + 2 < len(seq):
                        add_pair(b, seq[index + 2], -1)
                    add_pair(a, b, -1)
                    if previous != -1:
                        add_pair(previous, merged_id, 1)
                    next_seq.append(merged_id)
                    previous = merged_id
                    if index + 2 < len(seq):
                        add_pair(merged_id, seq[index + 2], 1)
                    index += 2
                else:
                    next_seq.append(seq[index])
                    previous = seq[index]
                    index += 1
            learn_seqs[sequence_index] = next_seq
        if on_progress is not None:
            partial = FastVocab(
                merges=merges,
                merge_base=merge_base,
                num_merges=len(merges),
                version="1.1",
                max_token_length=max_token_length,
                aliases=len(alias_merged_id) if resume else len(alias_freq),
            )
            on_progress(learned + 1, learn_target, partial)

    return FastVocab(
        merges=merges,
        merge_base=merge_base,
        num_merges=len(merges),
        version="1.1",
        max_token_length=max_token_length,
        aliases=len(alias_merged_id) if resume else len(alias_freq),
    )


def self_check() -> None:
    """Small deterministic check that does not touch repository data."""

    symbol_a = chr(0xF0000)
    symbol_b = chr(0xF0001)
    corpus = [symbol_a + symbol_b + symbol_a + symbol_b, symbol_a + symbol_b + symbol_a + symbol_b]
    vocab = train_tokenizer_fast(corpus, num_merges=1, max_token_length=5, min_frequency=2)
    assert vocab.num_merges == 1
    assert list(vocab.merges) == [100000]
    assert vocab.merges[100000] == {"a": CP_BASE + 0xF0000, "b": CP_BASE + 0xF0001, "rank": 0}
    data = vocab.to_json_dict()
    assert FastVocab.from_json_dict(data).to_json_dict() == data
    print("train_fast self-check: ok")


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("corpus", type=Path, nargs="?", help="newline-delimited Stage-1 AICL corpus")
    parser.add_argument("--out", type=Path, default=Path("tokenizer/vocab.json"))
    parser.add_argument("--num-merges", type=int, default=4096)
    parser.add_argument("--merge-base", type=int, default=DEFAULT_MERGE_BASE)
    parser.add_argument("--max-token-length", type=int, default=DEFAULT_MAX_TOKEN_LENGTH)
    parser.add_argument("--min-frequency", type=int, default=DEFAULT_MIN_FREQUENCY)
    parser.add_argument("--alias-trailing-space", action="store_true")
    parser.add_argument("--learn-every", type=int, default=1)
    parser.add_argument("--skip-degenerate-pairs", action="store_true")
    parser.add_argument("--self-check", action="store_true", help="run a tiny in-memory check and exit")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.self_check:
        self_check()
        return 0
    if args.corpus is None:
        _parser().error("corpus is required unless --self-check is used")
    lines = read_lines(args.corpus)
    started = time.perf_counter()
    vocab = train_tokenizer_fast(
        lines,
        num_merges=args.num_merges,
        merge_base=args.merge_base,
        max_token_length=args.max_token_length,
        min_frequency=args.min_frequency,
        alias_trailing_space=args.alias_trailing_space,
        learn_every=args.learn_every,
        skip_degenerate_pairs=args.skip_degenerate_pairs,
        on_progress=lambda done, total, _vocab: print(f"learned {done}/{total}", file=os.sys.stderr)
        if done == total or done % 100 == 0
        else None,
    )
    save_vocab(vocab, args.out)
    elapsed = time.perf_counter() - started
    print(
        f"trained {vocab.num_merges} merges "
        f"({vocab.aliases} aliases + {vocab.num_merges - vocab.aliases} learned) "
        f"in {elapsed / 60:.1f}min; saved {args.out}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
