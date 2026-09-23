#!/usr/bin/env python3
"""워커가 띄우는 추론 전용 자식 프로세스 — 모델을 한 번 올려 두고 표준입력 JSON 요청을 처리한다.

부모(local_variant_worker.py)가 이 프로세스를 끝내면 CUDA 메모리가 컨텍스트까지 통째로 풀린다.
4GB GPU 를 학습과 나눠 쓰려면 모델을 내려놓을 때 프로세스째 끝내야 한다.

  인자 1개: JSON {"base_model": str, "use_4bit": bool, "adapters": [[이름, 경로], ...]}
  표준입력: 한 줄에 요청 JSON {"en": "topic", "paragraph": str, "explain": bool}
  표준출력: 한 줄에 "@@RESULT@@ " + JSON — 그 밖의 줄은 부모가 무시한다(진행 로그는 stderr).
"""
from __future__ import annotations

import importlib.util
import json
import sys
import time
import traceback
from pathlib import Path
from typing import Any

_ML = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_ML / "common"))

import cuda_runtime as rt  # noqa: E402

MARK = "@@RESULT@@ "
_PIPELINES: dict[str, Any] = {}


def emit(obj: dict) -> None:
    sys.stdout.write(MARK + json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def pipeline(en: str) -> Any:
    if en not in _PIPELINES:
        path = _ML / en / "windows" / f"pipeline_{en}.py"
        spec = importlib.util.spec_from_file_location(f"pipeline_{en}", path)
        if spec is None or spec.loader is None:
            raise RuntimeError(f"파이프라인을 불러올 수 없습니다: {path}")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        _PIPELINES[en] = mod
    return _PIPELINES[en]


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

    spec = json.loads(sys.argv[1])
    try:
        model, tokenizer = rt.load_base(spec["base_model"], bool(spec["use_4bit"]))
        model = rt.attach_adapters(model, [(name, Path(path)) for name, path in spec["adapters"]])
    except Exception as e:  # noqa: BLE001
        traceback.print_exc(file=sys.stderr)
        emit({"ready": False, "error": f"{type(e).__name__}: {e}"[:1000], "oom": rt.is_cuda_oom(e)})
        return 3
    emit({"ready": True, "adapters": [name for name, _ in spec["adapters"]]})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req = json.loads(line)
        en = req["en"]
        t0 = time.time()
        try:
            result = pipeline(en).run_pipeline(
                model,
                tokenizer,
                req["paragraph"],
                max_retries=2,
                temp=0.3,
                has_explain_adapter=bool(req.get("explain")),
                main_adapter=en,
                explain_adapter=f"{en}_explain",
            )
            emit(
                {
                    "ok": bool(result.get("ok")),
                    "question_data": result.get("question_data"),
                    "error": result.get("error"),
                    "pipeline": result.get("pipeline"),
                    "elapsed_ms": int((time.time() - t0) * 1000),
                }
            )
        except Exception as e:  # noqa: BLE001
            oom = rt.is_cuda_oom(e)
            traceback.print_exc(file=sys.stderr)
            emit({"ok": False, "error": f"{type(e).__name__}: {e}"[:1000], "oom": oom})
            if oom:
                return 3  # 메모리 상태를 믿을 수 없다 — 부모가 필요할 때 새로 띄운다
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
