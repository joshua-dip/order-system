#!/usr/bin/env python3
"""로컬 변형문제 AI 를 OpenAI 호환 /v1 서버로 감싼다 — Cursor Override OpenAI Base URL 용.

  LOCAL_VARIANT_API_KEY=... ml/topic/.venv/bin/python ml/serve/openai_server.py --port 8765

모델 로딩·유형 매핑은 ml/eval/run_eval.py 와 같다. 기존 워커·파이프라인은 건드리지 않는다.
"""
from __future__ import annotations

import argparse
import contextlib
import importlib.util
import io
import json
import os
import socket
import sys
import threading
import time
import traceback
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
EVAL = ROOT / "ml" / "eval"

# run_eval 상수만 가져온다(main 은 호출하지 않음)
_spec = importlib.util.spec_from_file_location("run_eval", EVAL / "run_eval.py")
_run_eval = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
_spec.loader.exec_module(_run_eval)
KO: dict[str, str] = _run_eval.KO
MODULE: dict[str, str] = _run_eval.MODULE
RULE_MODULES: set[str] = _run_eval.RULE_MODULES
BASE: str = _run_eval.BASE
REASONER: str = _run_eval.REASONER

# Cursor 에 등록할 모델 id → 평가 유형 키
MODEL_IDS = {
    "variant-topic": "topic",
    "variant-title": "title",
    "variant-claim": "claim",
    "variant-match": "match",
    "variant-mismatch": "mismatch",
    "variant-blank": "blank",
    "variant-summary": "summary",
    "variant-order": "order",
    "variant-insert": "insert",
    "variant-irrelevant": "irrelevant",
    "variant-vocab": "vocab",
    "variant-grammar": "grammar",
}

_STATE: dict[str, Any] = {
    "model": None,
    "tok": None,
    "mods": {},
    "api_key": None,
    "lock": threading.Lock(),
    # MLX 는 모델 올린 스레드(또는 전용 추론 스레드)에서만 안전 — HTTP 스레드에서 직접 돌리면
    # RuntimeError: There is no Stream(cpu, 0) in current thread
    "infer_q": None,  # queue.Queue
}


def _infer_worker(ready: threading.Event, reasoner: str, fatal: list) -> None:
    """모델 로딩 + 모든 run_pipeline 을 이 스레드에서만 한다(MLX stream)."""
    import queue

    try:
        load_models(reasoner)
    except Exception as e:  # noqa: BLE001
        fatal.append(e)
        ready.set()
        return
    ready.set()
    q: queue.Queue = _STATE["infer_q"]
    while True:
        job = q.get()
        if job is None:
            break
        model_id, passage, out_holder, done_evt = job
        try:
            out_holder["result"] = run_one(model_id, passage)
        except Exception as e:  # noqa: BLE001
            out_holder["result"] = {
                "ok": False,
                "error": f"{type(e).__name__}: {e}",
                "trace": traceback.format_exc(),
            }
        finally:
            done_evt.set()


def submit_infer(model_id: str, passage: str) -> dict:
    """추론 큐에 넣고 끝날 때까지 기다린다(호출 스레드는 MLX 를 건드리지 않음)."""
    import queue

    q: queue.Queue = _STATE["infer_q"]
    holder: dict[str, Any] = {}
    done = threading.Event()
    q.put((model_id, passage, holder, done))
    done.wait()
    return holder.get("result") or {"ok": False, "error": "no result"}


def _load_pipeline(en: str):
    mods = _STATE["mods"]
    if en not in mods:
        for p in (ROOT / "ml" / en, ROOT / "ml" / en / "windows"):
            sys.path.insert(0, str(p))
        sys.modules.pop("_cuda_runtime", None)
        sp = importlib.util.spec_from_file_location(
            f"pipeline_{en}", ROOT / "ml" / en / "windows" / f"pipeline_{en}.py"
        )
        m = importlib.util.module_from_spec(sp)
        assert sp.loader is not None
        sp.loader.exec_module(m)
        mods[en] = m
    return mods[en]


def load_models(reasoner: str = REASONER) -> None:
    sys.path[:0] = [str(ROOT / "ml/common")]
    import mlx_runtime  # noqa: E402

    mlx_runtime.use_as_cuda_runtime()
    import cuda_runtime as rt  # noqa: E402

    print(f"[serve] base 로딩: {BASE}", flush=True)
    model, tok = rt.load_base(BASE)
    adapters = sorted({m for m in MODULE.values() if m not in RULE_MODULES})
    paths = [(m, ROOT / f"ml/{m}/adapters/{m}-lora") for m in adapters]
    missing = [str(p) for _, p in paths if not (p / "adapters.safetensors").is_file()]
    if missing:
        raise SystemExit(f"어댑터 없음: {missing}")
    print(f"[serve] 어댑터 {len(paths)}개 로딩…", flush=True)
    model = rt.attach_adapters(model, paths)
    print(f"[serve] reasoner 로딩: {reasoner}", flush=True)
    model = rt.attach_reasoner(model, reasoner)
    _STATE["model"] = model
    _STATE["tok"] = tok
    print("[serve] 모델 준비 완료", flush=True)


def _last_user_text(messages: list) -> str:
    for m in reversed(messages or []):
        if not isinstance(m, dict) or m.get("role") != "user":
            continue
        content = m.get("content")
        if isinstance(content, str):
            return content.strip()
        if isinstance(content, list):
            parts = []
            for c in content:
                if isinstance(c, dict) and c.get("type") in (None, "text") and isinstance(c.get("text"), str):
                    parts.append(c["text"])
                elif isinstance(c, str):
                    parts.append(c)
            return "\n".join(parts).strip()
    return ""


def _format_options(options_raw: str) -> str:
    opts = [o.strip() for o in str(options_raw or "").replace("\n", "###").split("###") if o.strip()]
    return "\n".join(opts)


def format_result(type_en: str, result: dict) -> str:
    if not result.get("ok"):
        err = result.get("error") or "생성 실패"
        return f"생성 실패 ({KO.get(type_en, type_en)}): {err}"

    qd = result.get("question_data") or {}
    warnings = result.get("warnings") or []
    lines = [
        f"## {KO.get(type_en, type_en)} 변형문제",
        "",
        "### 발문",
        str(qd.get("Question") or "").strip() or "(없음)",
        "",
        "### 지문 (Paragraph)",
        str(qd.get("Paragraph") or "").strip() or "(없음)",
        "",
        "### 선지",
        _format_options(str(qd.get("Options") or "")) or "(없음)",
        "",
        f"**정답:** {qd.get('CorrectAnswer') or '?'}",
        "",
        "### 해설",
        str(qd.get("Explanation") or "").strip() or "(없음)",
    ]
    if warnings:
        lines += ["", "### 경고"]
        for w in warnings:
            lines.append(f"- {w}")
    lines += ["", "```json", json.dumps(qd, ensure_ascii=False, indent=2), "```"]
    return "\n".join(lines)


def run_one(model_id: str, passage: str) -> dict:
    type_en = MODEL_IDS.get(model_id)
    if type_en is None:
        return {"ok": False, "error": f"알 수 없는 model: {model_id} (허용: {', '.join(MODEL_IDS)})"}
    if not passage or len(passage.split()) < 20:
        return {"ok": False, "error": "영어 지문이 너무 짧습니다(대략 20단어 이상)."}

    mod_name = MODULE[type_en]
    mod = _load_pipeline(mod_name)
    extra = {"kind": KO[type_en]} if mod_name == "fact" else {}
    err = io.StringIO()
    with contextlib.redirect_stderr(err):
        try:
            r = mod.run_pipeline(
                _STATE["model"],
                _STATE["tok"],
                passage,
                max_retries=2,
                temp=0.3,
                main_adapter=mod_name,
                **extra,
            )
        except Exception as e:  # noqa: BLE001
            r = {"ok": False, "error": f"{type(e).__name__}: {e}", "trace": traceback.format_exc()}
    if isinstance(r, dict):
        r.setdefault("_type", type_en)
        r.setdefault("_log", [ln for ln in err.getvalue().splitlines() if "[pipeline]" in ln])
    return r if isinstance(r, dict) else {"ok": False, "error": "파이프라인 응답이 dict 가 아님"}


def _openai_chat_response(model_id: str, content: str, *, finish_reason: str = "stop") -> dict:
    return {
        "id": f"chatcmpl-{uuid.uuid4().hex[:24]}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model_id,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": finish_reason,
            }
        ],
        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
    }


def _check_auth(handler: BaseHTTPRequestHandler) -> bool:
    want = _STATE["api_key"]
    auth = handler.headers.get("Authorization") or ""
    if auth.startswith("Bearer "):
        got = auth[7:].strip()
    else:
        got = ""
    return bool(want) and got == want


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args) -> None:  # noqa: A003
        # API 키·URI 가 섞일 수 있어 경로·상태만
        sys.stderr.write(f"[serve] {self.command} {self.path} {fmt % args}\n")

    def _send(self, code: int, body: bytes, content_type: str = "application/json") -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code: int, obj: Any) -> None:
        self._send(code, json.dumps(obj, ensure_ascii=False).encode("utf-8"))

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path.rstrip("/") or "/"
        if path not in ("/v1/models", "/models"):
            self._json(404, {"error": {"message": f"not found: {path}", "type": "invalid_request_error"}})
            return
        if not _check_auth(self):
            self._json(401, {"error": {"message": "Unauthorized", "type": "invalid_request_error", "code": "invalid_api_key"}})
            return
        data = {
            "object": "list",
            "data": [
                {
                    "id": mid,
                    "object": "model",
                    "created": 0,
                    "owned_by": "local-variant",
                }
                for mid in MODEL_IDS
            ],
        }
        self._json(200, data)

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path.rstrip("/") or "/"
        if path not in ("/v1/chat/completions", "/chat/completions"):
            self._json(404, {"error": {"message": f"not found: {path}", "type": "invalid_request_error"}})
            return
        if not _check_auth(self):
            self._json(401, {"error": {"message": "Unauthorized", "type": "invalid_request_error", "code": "invalid_api_key"}})
            return

        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            self._json(400, {"error": {"message": "invalid JSON", "type": "invalid_request_error"}})
            return

        model_id = str(body.get("model") or "").strip()
        stream = bool(body.get("stream"))
        passage = _last_user_text(body.get("messages") or [])
        if model_id not in MODEL_IDS:
            self._json(
                400,
                {
                    "error": {
                        "message": f"unknown model '{model_id}'. use one of: {', '.join(MODEL_IDS)}",
                        "type": "invalid_request_error",
                    }
                },
            )
            return

        if stream:
            self._stream_completion(model_id, passage)
        else:
            self._sync_completion(model_id, passage)

    def _sync_completion(self, model_id: str, passage: str) -> None:
        with _STATE["lock"]:
            t0 = time.time()
            result = submit_infer(model_id, passage)
            sec = round(time.time() - t0, 1)
        type_en = MODEL_IDS[model_id]
        content = format_result(type_en, result)
        print(f"[serve] {model_id} {sec}s ok={result.get('ok')}", flush=True)
        self._json(200, _openai_chat_response(model_id, content))

    def _stream_completion(self, model_id: str, passage: str) -> None:
        # 추론은 전용 스레드 — HTTP 스레드는 15초마다 keep-alive
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.close_connection = True

        holder: dict[str, Any] = {}
        done = threading.Event()

        def work() -> None:
            try:
                with _STATE["lock"]:
                    t0 = time.time()
                    holder["result"] = submit_infer(model_id, passage)
                    holder["sec"] = round(time.time() - t0, 1)
            except Exception as e:  # noqa: BLE001
                holder["result"] = {"ok": False, "error": f"{type(e).__name__}: {e}"}
                holder["sec"] = None
            finally:
                done.set()

        threading.Thread(target=work, daemon=True).start()
        while not done.wait(15.0):
            try:
                self.wfile.write(b": keep-alive\n\n")
                self.wfile.flush()
            except BrokenPipeError:
                return

        type_en = MODEL_IDS[model_id]
        content = format_result(type_en, holder.get("result") or {"ok": False, "error": "no result"})
        print(f"[serve] {model_id} stream {holder.get('sec')}s ok={(holder.get('result') or {}).get('ok')}", flush=True)

        chunk_id = f"chatcmpl-{uuid.uuid4().hex[:24]}"
        created = int(time.time())

        def sse(obj: dict) -> None:
            self.wfile.write(f"data: {json.dumps(obj, ensure_ascii=False)}\n\n".encode("utf-8"))
            self.wfile.flush()

        # role 먼저
        sse(
            {
                "id": chunk_id,
                "object": "chat.completion.chunk",
                "created": created,
                "model": model_id,
                "choices": [{"index": 0, "delta": {"role": "assistant"}, "finish_reason": None}],
            }
        )
        sse(
            {
                "id": chunk_id,
                "object": "chat.completion.chunk",
                "created": created,
                "model": model_id,
                "choices": [{"index": 0, "delta": {"content": content}, "finish_reason": None}],
            }
        )
        sse(
            {
                "id": chunk_id,
                "object": "chat.completion.chunk",
                "created": created,
                "model": model_id,
                "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
            }
        )
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()
        try:
            self.connection.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self.close_connection = True


def main() -> int:
    ap = argparse.ArgumentParser(description="Local variant OpenAI-compatible server")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--reasoner", default=REASONER)
    args = ap.parse_args()

    key = (os.environ.get("LOCAL_VARIANT_API_KEY") or "").strip()
    if not key:
        print("LOCAL_VARIANT_API_KEY 환경변수가 필요합니다. 서버를 시작하지 않습니다.", file=sys.stderr)
        return 2
    _STATE["api_key"] = key

    if args.host not in ("127.0.0.1", "localhost", "::1"):
        print(f"보안: host 는 127.0.0.1 만 허용합니다 (받은 값: {args.host})", file=sys.stderr)
        return 2

    import queue

    _STATE["infer_q"] = queue.Queue()
    ready = threading.Event()
    fatal: list = []
    threading.Thread(
        target=_infer_worker,
        name="mlx-infer",
        args=(ready, args.reasoner, fatal),
        daemon=True,
    ).start()
    ready.wait()
    if fatal:
        print(f"[serve] 모델 로딩 실패: {fatal[0]}", file=sys.stderr)
        return 1
    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"[serve] http://{args.host}:{args.port}/v1  (models={len(MODEL_IDS)})", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[serve] 종료", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
