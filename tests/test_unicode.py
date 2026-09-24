import unittest

import aicl


class UnicodeTests(unittest.TestCase):
    def test_code_point_helpers(self) -> None:
        self.assertEqual(aicl.char_length("a🚀"), 2)
        self.assertEqual(aicl.code_points("a🚀"), ["a", "🚀"])
        self.assertTrue(aicl.is_surrogate_pair("🚀"))
        self.assertEqual(aicl.hex("🚀"), "U+1F680")
        self.assertEqual(aicl.hex(""), "U+7F")

    def test_require_text_and_sanitizer(self) -> None:
        self.assertEqual(aicl.require_text("ok"), "ok")
        with self.assertRaises(TypeError):
            aicl.require_text(42)  # type: ignore[arg-type]
        with self.assertRaises(aicl.RangeError):
            aicl.require_text("x", limit=0)
        self.assertEqual(aicl.sanitize_text("a\x00\t\n\ud800b"), "a\t\nb")
        self.assertEqual(
            aicl.inspect_text("a\x00\t\ud800"),
            {"hasControl": True, "hasSurrogate": True, "hasNull": True},
        )

    def test_pua_ranges(self) -> None:
        self.assertTrue(aicl.is_pua_code_point(aicl.ESCAPE_CP))
        self.assertTrue(aicl.is_pua_code_point(0x100800))
        self.assertFalse(aicl.is_pua_code_point(0xDFFF))


if __name__ == "__main__":
    unittest.main()
