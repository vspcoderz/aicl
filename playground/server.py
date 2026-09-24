#!/usr/bin/env python3
"""Local HTTP server for the AICL playground.

The browser client is intentionally still JavaScript, but the playground's
server-side pipeline is the canonical Python runtime.  The dependency surface
of the server is kept small: the HTTP implementation is from the standard
library and the only runtime imports are the public :mod:`aicl` APIs.
"""

from __future__ import annotations

import argparse
import importlib
import json
import os
import re
import sys
import time
from functools import lru_cache
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Mapping, Sequence
from urllib.parse import unquote_to_bytes


ROOT = Path(__file__).resolve().parent.parent
# Running ``python playground/server.py`` places ``playground/`` rather than
# the repository root on sys.path.  Make the documented direct CLI invocation
# work from a source checkout as well as from an installed package.
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from aicl import (
    MAX_BODY_BYTES,
    MAX_INPUT_CHARS,
    code_points,
    decode,
    encode,
    inspect_text,
    load_tokenizer,
    sanitize_text,
    tokenize_with_map,
)


DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8787

# Keep these values in the same order and with the same names as the Node
# server.  Unknown extensions are served as application/octet-stream.
MIME_TYPES: dict[str, str] = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".txt": "text/plain; charset=utf-8",
}

_ABSENT = object()


def _field(value: Any, *names: str, default: Any = None) -> Any:
    """Read a field from either the documented dataclass or a mapping.

    The public API is typed, but accepting a mapping here keeps the HTTP
    adapter straightforward for callers that provide a small vocabulary stub
    in tests.  JSON output is always built with the JavaScript-facing names
    below, regardless of the Python implementation's naming convention.
    """

    for name in names:
        if isinstance(value, Mapping) and name in value:
            return value[name]
        try:
            return getattr(value, name)
        except AttributeError:
            pass
    return default


def _strict_url_decode(path: str) -> str | None:
    """Decode a URL path like JavaScript's ``decodeURIComponent``.

    ``urllib.parse.unquote`` replaces malformed UTF-8 and leaves malformed
    percent escapes alone, whereas the Node server rejects both.  Decoding to
    bytes first and using strict UTF-8, plus a small escape check, preserves
    that static-file protection.
    """

    for match in re.finditer(r"%[0-9A-Fa-f]{0,1}", path):
        # The regex deliberately finds the prefix of a malformed escape;
        # ``%`` must always be followed by exactly two hex digits.
        if len(match.group(0)) != 3:
            return None
    try:
        return unquote_to_bytes(path).decode("utf-8", errors="strict")
    except UnicodeDecodeError:
        return None


def _static_file(path: str, allowed_root: Path) -> Path | None:
    """Resolve a static path while keeping it inside its route's tree."""

    if path == "/":
        path = "/playground/index.html"
    elif path in {"/playground", "/playground/"}:
        path = "/playground/index.html"

    decoded = _strict_url_decode(path)
    if decoded is None or "\x00" in decoded or ".." in decoded:
        return None

    try:
        root = allowed_root.resolve()
        candidate = (ROOT / decoded.lstrip("/")).resolve()
        candidate.relative_to(root)
    except (OSError, ValueError):
        return None
    return candidate if candidate.is_file() else None


def _json_body(payload: Any) -> bytes:
    return json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")


def _one_decimal(value: float) -> float:
    """Round a number like the JavaScript ``toFixed(1)`` output."""

    return float(f"{value:.1f}")


def _two_decimals(value: float) -> float:
    """Round a positive ratio like the JavaScript ``toFixed(2)`` output."""

    return float(f"{max(0.0, value):.2f}")


@lru_cache(maxsize=1)
def _tiktoken() -> Any | None:
    """Load tiktoken lazily, if an optional integration is installed."""

    try:
        return importlib.import_module("tiktoken")
    except Exception:
        return None


@lru_cache(maxsize=8)
def _tiktoken_encoding(model: str) -> Any | None:
    module = _tiktoken()
    if module is None:
        return None
    try:
        return module.encoding_for_model(model)
    except Exception:
        return None


def _gpt_token_count(text: str, model: str) -> int:
    """Return a GPT token count, or zero when that optional API is absent."""

    encoding = _tiktoken_encoding(model)
    if encoding is not None:
        try:
            return len(encoding.encode(text))
        except Exception:
            pass

    # Some Python ports expose the same API as gpt_tokenizer.encode rather
    # than tiktoken.  Keep this optional so a bare standard-library install
    # still starts the local server.
    try:
        module = importlib.import_module("gpt_tokenizer")
        encode_fn = getattr(module, "encode", None)
        if encode_fn is None:
            return 0
        try:
            tokens = encode_fn(text, model=model)
        except TypeError:
            tokens = encode_fn(text)
        return len(tokens)
    except Exception:
        return 0


@lru_cache(maxsize=1)
def _llama_encoder() -> Any | None:
    """Load a supported Python LLaMA tokenizer integration, if present."""

    for module_name in ("llama_tokenizer", "llama_tokenizer_python"):
        try:
            module = importlib.import_module(module_name)
        except Exception:
            continue

        # Common Python packages expose either a ready-made encode function
        # or a LlamaTokenizer class with an encode method.
        encode_fn = getattr(module, "encode", None)
        if callable(encode_fn):
            return encode_fn
        for class_name in ("LlamaTokenizer", "Tokenizer"):
            encoder_class = getattr(module, class_name, None)
            if encoder_class is not None:
                try:
                    encoder = encoder_class()
                    if callable(getattr(encoder, "encode", None)):
                        return encoder.encode
                except Exception:
                    pass
    return None


def _llama_token_count(text: str) -> int:
    encode_fn = _llama_encoder()
    if encode_fn is None:
        return 0
    try:
        return len(encode_fn(text))
    except Exception:
        return 0


def _comparison_counts(text: str, aicl_tokens: int) -> dict[str, int]:
    counts = {
        "gpt3": 0,
        "gpt4": 0,
        "gpt4o": 0,
        "gpt5": 0,
        "llama": 0,
        "aicl": aicl_tokens,
    }
    if not text:
        return counts
    counts["gpt3"] = _gpt_token_count(text, "gpt-3.5-turbo")
    counts["gpt4"] = _gpt_token_count(text, "gpt-4")
    counts["gpt4o"] = _gpt_token_count(text, "gpt-4o")
    counts["gpt5"] = _gpt_token_count(text, "gpt-5")
    counts["llama"] = _llama_token_count(text)

    return counts


def _vocab_payload(vocab: Any) -> dict[str, int]:
    merges = _field(vocab, "merges", default={})
    num_merges = _field(vocab, "numMerges", "num_merges", default=None)
    if num_merges is None:
        num_merges = len(merges)
    max_token_length = _field(vocab, "maxTokenLength", "max_token_length", default=None)
    merge_base = _field(vocab, "mergeBase", "merge_base", default=100000)
    payload: dict[str, int] = {"merges": int(num_merges)}
    # JSON.stringify drops undefined fields; the shipped vocabulary always
    # includes maxTokenLength, while an empty fallback vocabulary does not.
    if max_token_length is not None:
        payload["maxTokenLength"] = int(max_token_length)
    payload["mergeBase"] = int(merge_base)
    return payload


def _steps_payload(steps: Any) -> list[dict[str, Any]]:
    """Convert typed/snake_case encoder steps to the legacy JSON shape."""

    result: list[dict[str, Any]] = []
    for step in steps or []:
        if not isinstance(step, Mapping):
            # A dataclass has the same attribute-based access as the canonical
            # encoder result; a scalar cannot describe a step.
            converted: dict[str, Any] = {}
            for name in ("type", "pattern", "symbol", "pos", "name", "char"):
                value = _field(step, name, default=_ABSENT)
                if value is not _ABSENT:
                    converted[name] = value
        else:
            converted = {}
            for name in ("type", "pattern", "symbol", "pos", "name", "char"):
                value = _field(step, name, default=_ABSENT)
                if value is not _ABSENT:
                    converted[name] = value
        result.append(converted)
    return result


class PlaygroundHandler(BaseHTTPRequestHandler):
    """Request handler implementing the former ``server.mjs`` routes."""

    # HTTP/1.1 plus an explicit Content-Length keeps the browser client and
    # command-line smoke tests predictable while retaining the legacy route
    # and CORS behavior.
    protocol_version = "HTTP/1.1"

    def log_message(self, format: str, *args: Any) -> None:
        # The Node server does not emit per-request access logs.
        return

    def _send(
        self,
        code: int,
        body: str | bytes = "",
        content_type: str = "text/plain; charset=utf-8",
    ) -> None:
        data = body.encode("utf-8") if isinstance(body, str) else bytes(body)
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        if self.command != "HEAD" and code != 204:
            self.wfile.write(data)

    def _send_json(self, code: int, payload: Any) -> None:
        self._send(code, _json_body(payload), "application/json; charset=utf-8")

    def _read_body(self) -> tuple[bytes | None, bool]:
        """Read a request body, returning ``(body, too_large)``."""

        transfer_encoding = self.headers.get("Transfer-Encoding", "").lower()
        if transfer_encoding and "chunked" in transfer_encoding:
            return self._read_chunked_body()

        raw_length = self.headers.get("Content-Length")
        if raw_length is None:
            return b"", False
        try:
            length = int(raw_length)
        except ValueError:
            return b"", False
        if length < 0:
            return b"", False
        if length > MAX_BODY_BYTES:
            self.close_connection = True
            return None, True
        return self.rfile.read(length), False

    def _read_chunked_body(self) -> tuple[bytes | None, bool]:
        chunks: list[bytes] = []
        total = 0
        while True:
            line = self.rfile.readline()
            if not line:
                return b"", False
            try:
                size = int(line.split(b";", 1)[0].strip(), 16)
            except ValueError:
                return b"", False
            if size < 0:
                return b"", False
            if size == 0:
                # Consume the trailer section, if any.
                while True:
                    trailer = self.rfile.readline()
                    if not trailer or trailer in {b"\r\n", b"\n"}:
                        break
                return b"".join(chunks), False
            if total + size > MAX_BODY_BYTES:
                self.close_connection = True
                return None, True
            chunk = self.rfile.read(size)
            if len(chunk) != size:
                return b"", False
            chunks.append(chunk)
            total += size
            crlf = self.rfile.read(2)
            if crlf not in {b"\r\n", b""}:
                return b"", False

    def _serve_static(self, path: str, allowed_root: Path) -> bool:
        file_path = _static_file(path, allowed_root)
        if file_path is None:
            return False
        try:
            data = file_path.read_bytes()
        except OSError:
            return False
        self._send(
            200,
            data,
            MIME_TYPES.get(file_path.suffix, "application/octet-stream"),
        )
        return True

    def _tokenize(self) -> None:
        body, too_large = self._read_body()
        if too_large:
            self._send_json(
                413,
                {"error": f"body too large > {MAX_BODY_BYTES} bytes"},
            )
            return

        try:
            parsed = json.loads((body or b"").decode("utf-8") or "{}")
        except (TypeError, ValueError, UnicodeError):
            self._send_json(400, {"error": "invalid JSON"})
            return

        # JSON null has no `.text` property in JavaScript and is caught by
        # the original handler as invalid JSON.  Other non-object JSON values
        # have an undefined `.text`, which becomes the empty string.
        if parsed is None:
            self._send_json(400, {"error": "invalid JSON"})
            return
        text = parsed.get("text", "") if isinstance(parsed, Mapping) else ""
        if text is None:
            text = ""
        if not isinstance(text, str):
            self._send_json(400, {"error": "text must be a string"})
            return

        # Do the size check before calling the canonical helper: the helper
        # intentionally raises for values over MAX_INPUT_CHARS, while this
        # route must translate that condition into its documented 413.
        text_chars = list(text)
        if len(text_chars) > MAX_INPUT_CHARS:
            self._send_json(
                413,
                {"error": f"text too large > {MAX_INPUT_CHARS} chars"},
            )
            return

        inspected_value = inspect_text(text)
        inspected = {
            "hasControl": bool(_field(inspected_value, "hasControl", "has_control", default=False)),
            "hasSurrogate": bool(_field(inspected_value, "hasSurrogate", "has_surrogate", default=False)),
            "hasNull": bool(_field(inspected_value, "hasNull", "has_null", default=False)),
        }
        sanitized = inspected["hasControl"] or inspected["hasSurrogate"]
        if sanitized:
            text = sanitize_text(text)
            text_chars = list(code_points(text))

        started = time.perf_counter()
        encoded = encode(
            text,
            {"steps": True, "trackMapping": True},
        )
        after_encode = time.perf_counter()
        aicl = str(_field(encoded, "output", default=""))
        vocab = load_tokenizer()
        token_ids, token_map = tokenize_with_map(aicl, vocab)
        raw_to_aicl = list(
            _field(encoded, "rawToAicl", "raw_to_aicl", default=[]) or []
        )
        after_tokenize = time.perf_counter()

        decoded = decode(aicl)
        decoded_text = str(_field(decoded, "output", default=""))
        raw_chars = len(text_chars)
        aicl_chars = len(list(code_points(aicl)))
        aicl_tokens = len(token_ids)
        stage1x = _two_decimals(raw_chars / aicl_chars) if aicl_chars else 0
        stage2x = _two_decimals(aicl_chars / aicl_tokens) if aicl_tokens else 0

        comparison = _comparison_counts(text, aicl_tokens)
        gpt4o = comparison["gpt4o"]
        win_vs_gpt4o = _two_decimals(gpt4o / aicl_tokens) if gpt4o and aicl_tokens else 0
        save_pct = (
            _one_decimal((1 - aicl_tokens / gpt4o) * 100)
            if gpt4o and aicl_tokens
            else 0
        )

        payload = {
            "vocab": _vocab_payload(vocab),
            "timings": {
                "encodeMs": _one_decimal((after_encode - started) * 1000),
                "tokenizeMs": _one_decimal((after_tokenize - after_encode) * 1000),
                "totalMs": _one_decimal((after_tokenize - started) * 1000),
            },
            "encodeMs": int(round((after_tokenize - started) * 1000)),
            "sanitized": sanitized,
            "inspected": inspected,
            "stats": {
                "rawChars": raw_chars,
                "aiclChars": aicl_chars,
                "aiclTokens": aicl_tokens,
                "stage1x": stage1x,
                "stage2x": stage2x,
                "winVsGpt4o": win_vs_gpt4o,
                "savePct": save_pct,
            },
            "compare": comparison,
            "pipeline": {
                "aicl": aicl,
                "aiclLen": aicl_chars,
                "tokenIds": token_ids,
                "tokenMap": token_map,
                "rawToAicl": raw_to_aicl,
                "roundtripOk": decoded_text == text,
                "matches": _field(encoded, "matches", default=0),
                "literals": _field(encoded, "literals", default=0),
                "steps": _steps_payload(_field(encoded, "steps", default=[]))[:400],
            },
        }
        self._send_json(200, payload)

    def _dispatch(self) -> None:
        try:
            path = (self.path or "").split("?", 1)[0]
            if self.command == "OPTIONS":
                self._send(204, "", "text/plain")
                return

            if path == "/api/health":
                vocab = load_tokenizer()
                health: dict[str, Any] = {
                    "ok": True,
                    "merges": int(_field(vocab, "numMerges", "num_merges", default=0)),
                }
                max_token_length = _field(
                    vocab,
                    "maxTokenLength",
                    "max_token_length",
                    default=None,
                )
                if max_token_length is not None:
                    health["maxTokenLength"] = int(max_token_length)
                self._send_json(200, health)
                return

            if path == "/api/tokenize" and self.command == "POST":
                self._tokenize()
                return

            if path.startswith("/playground/") or path in {"/playground", "/"}:
                if self._serve_static(path, ROOT / "playground"):
                    return
            elif path.startswith("/assets/") and self._serve_static(path, ROOT / "assets"):
                return

            if path == "/api/tokenize" and self.command != "POST":
                self._send(405, "Use POST", "text/plain; charset=utf-8")
                return

            self._send(404, "Not found", "text/plain; charset=utf-8")
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception:
            # Do not take down the local server if an optional integration or
            # a future runtime API fails.  The legacy server exposes a plain
            # 404 for unknown routes and has no JSON error envelope for 500s.
            try:
                self._send(500, "Internal Server Error", "text/plain; charset=utf-8")
            except (BrokenPipeError, ConnectionResetError):
                return

    # Handle all methods the way the Node callback did, including PUT/PATCH
    # and non-standard methods, instead of BaseHTTPRequestHandler's default
    # 501 response.
    def __getattr__(self, name: str) -> Any:
        if name.startswith("do_"):
            return self._dispatch
        raise AttributeError(name)


def _port(value: str) -> int:
    try:
        port = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("port must be an integer") from exc
    if not 0 <= port <= 65535:
        raise argparse.ArgumentTypeError("port must be between 0 and 65535")
    return port


def _env_port() -> int:
    # Preserve the old PORT-over-PLAYGROUND_PORT precedence.
    raw = os.environ.get("PORT") or os.environ.get("PLAYGROUND_PORT")
    return _port(raw) if raw else DEFAULT_PORT


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the local AICL playground server")
    parser.add_argument(
        "--host",
        default=os.environ.get("PLAYGROUND_HOST", DEFAULT_HOST),
        help=f"interface to bind (default: {DEFAULT_HOST})",
    )
    parser.add_argument(
        "--port",
        type=_port,
        default=_env_port(),
        help=f"TCP port to bind (default: {DEFAULT_PORT})",
    )
    args = parser.parse_args(argv)

    with ThreadingHTTPServer((args.host, args.port), PlaygroundHandler) as server:
        host, port = server.server_address[:2]
        display_host = f"[{host}]" if ":" in host else host
        print(
            f"AICL playground → http://{display_host}:{port}/  "
            "(also /playground/)",
            flush=True,
        )
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
