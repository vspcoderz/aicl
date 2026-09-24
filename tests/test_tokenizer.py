import json
import tempfile
import unittest
from pathlib import Path

import aicl


def _reference_bpe(ids: list[int], merges: dict[int, dict[str, int]]) -> list[int]:
    """The original repeated-scan algorithm, used only as a differential oracle."""

    pair_index: dict[tuple[int, int], tuple[int, int, int, int]] = {}
    for merged_id, rule in merges.items():
        pair = (rule["a"], rule["b"])
        existing = pair_index.get(pair)
        if existing is None or rule["rank"] < existing[0]:
            pair_index[pair] = (rule["rank"], merged_id, rule["a"], rule["b"])
    sequence = ids[:]
    while True:
        best = None
        for index in range(len(sequence) - 1):
            candidate = pair_index.get((sequence[index], sequence[index + 1]))
            if candidate is not None and (best is None or candidate[0] < best[0]):
                best = candidate
        if best is None:
            return sequence
        _, merged_id, left, right = best
        next_sequence: list[int] = []
        index = 0
        while index < len(sequence):
            if index + 1 < len(sequence) and sequence[index : index + 2] == [left, right]:
                next_sequence.append(merged_id)
                index += 2
            else:
                next_sequence.append(sequence[index])
                index += 1
        if len(next_sequence) == len(sequence):
            return sequence
        sequence = next_sequence


class TokenizerTests(unittest.TestCase):
    def test_codepoint_ids(self) -> None:
        self.assertEqual(aicl.cp_to_id("a"), aicl.CP_BASE + ord("a"))
        self.assertEqual(aicl.id_to_cp(aicl.CP_BASE + ord("🚀")), "🚀")
        self.assertEqual(aicl.id_to_cp(aicl.CP_BASE + 0xD800), "\ud800")
        with self.assertRaises(ValueError):
            aicl.id_to_cp(aicl.CP_BASE - 1)

    def test_bpe_matches_repeated_scan_oracle(self) -> None:
        merges = {
            100: {"a": 1, "b": 2, "rank": 0},
            101: {"a": 3, "b": 4, "rank": 1},
            102: {"a": 100, "b": 3, "rank": 2},
            103: {"a": 2, "b": 3, "rank": 0},
            104: {"a": 5, "b": 6, "rank": 1},
        }
        cases = [
            [1, 2, 1, 2, 3, 4],
            [1, 2, 3, 4, 5, 6, 1, 2],
            [5, 6, 5, 6, 3, 4],
            [1, 2, 3, 2, 3, 4, 5, 6],
        ]
        for ids in cases:
            with self.subTest(ids=ids):
                self.assertEqual(aicl.bpe_merge(ids, merges), _reference_bpe(ids, merges))

    def test_packaged_vocabulary_golden_and_pipeline(self) -> None:
        vocab = aicl.load_tokenizer()
        self.assertEqual(vocab["numMerges"], 117298)
        self.assertEqual(vocab["maxTokenLength"], 14)
        source = "The quick brown fox jumps over the lazy dog"
        encoded = aicl.encode(source)["output"]
        self.assertEqual(
            aicl.tokenize(encoded, vocab),
            [154083, 100948, 102595, 108897, 107667, 100084, 16834670, 17762222, 16835681],
        )
        ids = aicl.tokenize(encoded, vocab)
        self.assertEqual(aicl.detokenize(ids, vocab), encoded)
        self.assertEqual(aicl.decode(aicl.detokenize(ids, vocab))["output"], source)

    def test_tokenize_with_map_keeps_single_pass_output(self) -> None:
        vocab = aicl.load_tokenizer()
        aicl_text = aicl.encode("The quick brown fox jumps over the lazy dog")["output"]
        ids, token_map = aicl.tokenize_with_map(aicl_text, vocab)
        self.assertEqual(ids, aicl.tokenize(aicl_text, vocab))
        self.assertEqual(len(token_map), len(aicl_text))
        self.assertTrue(all(0 <= token < len(ids) for token in token_map))


        # This fixture is intentionally authored, not produced by a trainer.
        vocab = {
            "merges": {
                500: {"a": aicl.CP_BASE + ord("a"), "b": aicl.CP_BASE + ord("a"), "rank": 0},
                501: {"a": 500, "b": aicl.CP_BASE + ord("a"), "rank": 1},
            },
            "mergeBase": 500,
            "numMerges": 2,
            "version": "1.0",
            "maxTokenLength": 5,
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "vocab.json"
            aicl.save_tokenizer(vocab, path)
            loaded = aicl.load_tokenizer(path)
            self.assertEqual(loaded["numMerges"], vocab["numMerges"])
            self.assertEqual(aicl.tokenize("aaaa", loaded), aicl.tokenize("aaaa", vocab))
            self.assertEqual(json.loads(path.read_text())["mergeBase"], 500)


if __name__ == "__main__":
    unittest.main()
