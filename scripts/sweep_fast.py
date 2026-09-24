#!/usr/bin/env python3
"""Sweep fast-trainer Stage-2 configurations on selected corpora."""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path
from typing import Any, Sequence

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

try:
    from .eval_vocab import _result_output, _tokenizer_api, evaluate  # noqa: E402
    from .heldout_probes import BENCH  # noqa: E402
    from .train_fast import read_lines, train_tokenizer_fast  # noqa: E402
except ImportError:
    from eval_vocab import _result_output, _tokenizer_api, evaluate  # noqa: E402
    from heldout_probes import BENCH  # noqa: E402
    from train_fast import read_lines, train_tokenizer_fast  # noqa: E402

SWEEP_HELDOUT = [
    ("held0", "yesterday evening the deployment pipeline failed because the database migration timed out twice"),
    ("held1", "the quarterly revenue report shows significant growth across all regional markets this year"),
    ("held2", "function calculateTotal(items, taxRate) { return items.reduce((s, x) => s + x.price, 0) * (1 + taxRate); }"),
    ("held3", "every morning the engineer reviews open pull requests before merging anything into main"),
    ("held4", "INSERT INTO inventory (sku, quantity, warehouse) VALUES ($1, $2, $3) RETURNING id;"),
    ("held5", "curl -fsSL https://releases.example.org/v2.tar.gz | tar -xz && ./install --prefix ~/.local"),
    ("held6", '{"error": "rate limited", "retry_after": 30, "request_id": "req_8f2b91c4", "quota": {"remaining": 42}}'),
    ("held7", "sudo systemctl restart nginx && tail -f /var/log/nginx/error.log | grep --color upstream"),
    ("held8", "export const useAuth = () => { const [user, setUser] = useState(null); return { user, login, logout }; };"),
    ("held9", "## Changelog ### 2.1.0 - **Added** streaming responses - _Fixed_ memory leak in worker pool"),
    ("held10", 'ssh -i ~/.ssh/id_ed25519 -p 2222 deploy@build.example.com "cd /srv/app && docker compose up -d"'),
    ("held11", "the camera obscura predates photography by centuries yet works on the same optical principle"),
]
DEFAULT_CORPORA = (
    ("v1", ROOT / "corpus" / "bpe_train.txt"),
    ("v4", ROOT / "corpus" / "bpe_train_v4.txt"),
    ("blend", ROOT / "corpus" / "bpe_train_blend.txt"),
)
DEFAULT_CONFIGS = (
    {"num_merges": 2048, "max_token_length": 8, "min_frequency": 2},
    {"num_merges": 2048, "max_token_length": 9, "min_frequency": 2},
    {"num_merges": 3072, "max_token_length": 9, "min_frequency": 2},
    {"num_merges": 4096, "max_token_length": 10, "min_frequency": 2},
)


def self_check() -> None:
    corpus = [chr(0xF0000) + chr(0xF0001) + chr(0xF0000) + chr(0xF0001)] * 2
    vocab = train_tokenizer_fast(corpus, num_merges=1, min_frequency=2)
    assert vocab.num_merges == 1
    print("sweep_fast self-check: ok")


def _configs(args: argparse.Namespace) -> list[dict[str, int]]:
    configs = [dict(config) for config in DEFAULT_CONFIGS]
    if args.num_merges is not None:
        for config in configs:
            config["num_merges"] = args.num_merges
    if args.max_token_length is not None:
        for config in configs:
            config["max_token_length"] = args.max_token_length
    if args.min_frequency is not None:
        for config in configs:
            config["min_frequency"] = args.min_frequency
    return configs


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus", action="append", type=Path, help="NAME=PATH; repeat for several corpora")
    parser.add_argument("--num-merges", type=int)
    parser.add_argument("--max-token-length", type=int)
    parser.add_argument("--min-frequency", type=int)
    parser.add_argument("--self-check", action="store_true")
    args = parser.parse_args(argv)
    if args.self_check:
        self_check()
        return 0
    corpora: list[tuple[str, Path]] = []
    for value in args.corpus or []:
        text = str(value)
        if "=" not in text:
            parser.error("--corpus must have the form NAME=PATH")
        name, path = text.split("=", 1)
        corpora.append((name, Path(path)))
    if not corpora:
        corpora = list(DEFAULT_CORPORA)

    from aicl import decode

    _load, tokenize, detokenize = _tokenizer_api()
    results: list[dict[str, Any]] = []
    for corpus_name, corpus_path in corpora:
        lines = read_lines(corpus_path)
        print(f"[{corpus_name}] corpus lines={len(lines)} chars={sum(map(len, lines))}")
        for config in _configs(args):
            started = time.perf_counter()
            vocab = train_tokenizer_fast(lines, merge_base=100_000, **config)
            elapsed = (time.perf_counter() - started) * 1000
            bench = evaluate(BENCH, vocab, tokenize=tokenize, detokenize=detokenize, decode=decode)
            held = evaluate(SWEEP_HELDOUT, vocab, tokenize=tokenize, detokenize=detokenize, decode=decode)
            result = {"corpus": corpus_name, "config": config, "actual": vocab.num_merges, "ms": elapsed, "bench": bench, "held": held}
            results.append(result)
            print(
                f"  merges={vocab.num_merges} maxLen={config['max_token_length']} "
                f"minFreq={config['min_frequency']} ({elapsed:.0f}ms) "
                f"bench={bench['tokens']} held={held['tokens']} lossless={bench['lossless'] and held['lossless']}"
            )
    print("\nSWEEP RESULTS (smaller token totals are better; GPT baselines are not required)")
    for result in sorted(results, key=lambda item: (item["held"]["tokens"], item["bench"]["tokens"])):
        config = result["config"]
        print(
            f"[{result['corpus']}] req={config['num_merges']} act={result['actual']} "
            f"len={config['max_token_length']} | bench={result['bench']['tokens']} "
            f"held={result['held']['tokens']} | {result['ms']:.0f}ms"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
