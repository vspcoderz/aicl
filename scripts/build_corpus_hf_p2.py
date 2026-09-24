#!/usr/bin/env python3
"""Compatibility entry point for the historical HF corpus phase-2 append job."""

import sys

from build_corpus_hf import main


if __name__ == "__main__":
    raise SystemExit(main(["--mode", "p2", *sys.argv[1:]]))
