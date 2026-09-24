import statistics
import time
import unittest

import aicl


class PerformanceTests(unittest.TestCase):
    """Keep the warmed development-machine budget visible in the test suite."""

    def test_warmed_ten_thousand_character_hot_paths(self) -> None:
        text = ("the quick brown fox jumps over the lazy dog " * 250)[:10_000]
        # Warm dictionary/trie, vocabulary, and compiled pair-index caches.
        encoded = aicl.encode(text)["output"]
        vocab = aicl.load_tokenizer()
        aicl.tokenize(encoded, vocab)
        aicl.encode(text)
        aicl.tokenize(encoded, vocab)

        encode_times: list[float] = []
        tokenize_times: list[float] = []
        for _ in range(5):
            started = time.perf_counter()
            encoded = aicl.encode(text)["output"]
            encode_times.append(time.perf_counter() - started)
            started = time.perf_counter()
            aicl.tokenize(encoded, vocab)
            tokenize_times.append(time.perf_counter() - started)

        encode_median = statistics.median(encode_times)
        tokenize_median = statistics.median(tokenize_times)
        self.assertLess(encode_median, 0.050, f"encode median was {encode_median * 1000:.2f} ms")
        self.assertLess(tokenize_median, 0.050, f"tokenize median was {tokenize_median * 1000:.2f} ms")


if __name__ == "__main__":
    unittest.main()
