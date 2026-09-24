import json
import unittest
from pathlib import Path

import aicl


class LegacyParityTests(unittest.TestCase):
    """Keep the Python port aligned with the removed JavaScript runtime."""

    def test_python_matches_legacy_javascript_fixtures(self) -> None:
        fixture = json.loads((Path(__file__).parent / "fixtures" / "js_parity.json").read_text(encoding="utf-8"))
        vocab = aicl.load_tokenizer()
        for index, expected in enumerate(fixture["results"]):
            with self.subTest(index=index):
                encoded = aicl.encode(expected["text"])["output"]
                self.assertEqual(encoded, expected["encoded"])
                self.assertEqual(aicl.tokenize(encoded, vocab), expected["ids"])
                self.assertEqual(aicl.decode(aicl.detokenize(expected["ids"], vocab))["output"], expected["text"])


if __name__ == "__main__":
    unittest.main()
