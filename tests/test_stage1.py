import unittest

import aicl


class StageOneTests(unittest.TestCase):
    def test_golden_encoding_and_steps(self) -> None:
        result = aicl.encode("The quick brown fox", {"steps": True, "trackMapping": True})
        self.assertEqual(
            [ord(ch) for ch in result["output"]],
            [0xE06E, 0x100800, 0x100801, 0xE3F2, 0x100406, 0xE53E, 0x100406, 0xECC1],
        )
        self.assertEqual(result["matches"], 8)
        self.assertEqual(result["literals"], 0)
        self.assertEqual(result["charsIn"], 19)
        self.assertEqual(result["charsOut"], 8)
        self.assertEqual(result["rawToAicl"], [0, 0, 0, -1, 3, 3, 3, 3, 3, 4, 5, 5, 5, 5, 5, 6, 7, 7, 7])
        self.assertEqual(result["steps"][:4], [
            {"type": "base", "pattern": "the", "pos": 0},
            {"type": "modifier", "name": "MOD_CAPS", "pos": 3},
            {"type": "modifier", "name": "MOD_TRAIL_SPACE", "pos": 3},
            {"type": "match", "pattern": "quick", "pos": 4},
        ])

    def test_round_trip_edge_cases(self) -> None:
        values = [
            "",
            "Plain text with no matches zzqx jxkw.",
            "Leading space and   multiple  spaces",
            "Code: const x = await db.query(\"SELECT * FROM tasks\");",
            "aliteral-pua-charb",
            "Unicode: héllo wörld — emoji 🚀 and 𝄞",
            "Tab\tand\nnewline\r\nmixed",
            "The Test Phase: camelCaseWord, ALL-CAPS!",
        ]
        for value in values:
            with self.subTest(value=value):
                encoded = aicl.encode(value)
                self.assertEqual(aicl.decode(encoded["output"])["output"], value)

    def test_modifier_composition(self) -> None:
        for value in ("The", "test.", "Test!", 'test"', "test]", "test}"):
            with self.subTest(value=value):
                encoded = aicl.encode(value)
                self.assertEqual(aicl.decode(encoded["output"])["output"], value)
                self.assertLess(encoded["charsOut"], encoded["charsIn"])

    def test_all_caps_and_camel_case_golden(self) -> None:
        caps = aicl.encode("HELLO, WORLD!")
        camel = aicl.encode("camelCaseWord")
        self.assertEqual(
            [ord(ch) for ch in caps["output"]],
            [0xF1929, 0x100400, 0xF106D, 0x100436],
        )
        self.assertEqual(
            [ord(ch) for ch in camel["output"]],
            [0xF667, 0xE179, 0x100800, 0xE378, 0x100800],
        )
        self.assertEqual(aicl.decode(caps["output"])["output"], "HELLO, WORLD!")
        self.assertEqual(aicl.decode(camel["output"])["output"], "camelCaseWord")

    def test_dangling_escape_is_defensive(self) -> None:
        result = aicl.decode(aicl.ESCAPE_MARKER, {"steps": True})
        self.assertEqual(result["output"], aicl.ESCAPE_MARKER)
        self.assertEqual(result["literals"], 1)
        self.assertEqual(result["steps"], [])

    def test_stats_and_visualization(self) -> None:
        original = "SELECT * FROM users"
        encoded = aicl.encode(original)["output"]
        metrics = aicl.stats_for(original, encoded, {"matches": 2})
        self.assertEqual(metrics["originalChars"], len(original))
        self.assertEqual(metrics["encodedChars"], len(encoded))
        self.assertEqual(metrics["matches"], 2)
        self.assertIsInstance(metrics["symbolCount"], dict)
        self.assertIn("Roundtrip ✓ OK", aicl.visualize(original, encoded, {"title": "test"}))
        self.assertIn("\x1b[32m", aicl.colorize_encoded(encoded))


if __name__ == "__main__":
    unittest.main()
