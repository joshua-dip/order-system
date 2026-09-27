"""Generate local production drafts from a reviewed manifest; never writes to the DB.

Usage: caffeinate -i ml/topic/.venv/bin/python ml/production/generate_batch.py <batch-dir>
The immutable raw output is separate from subsequent AI edits and human approval.
"""
from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import signal
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ml/eval"))
from run_eval import MODULE, RULE_MODULES


def main() -> None:
    batch = Path(sys.argv[1]).resolve()
    manifest = json.loads((batch / "manifest.json").read_text())
    settings = manifest["settings"]
    output = batch / "raw.jsonl"
    # A repeated command must not duplicate or overwrite the original drafts.
    with output.open("x", encoding="utf-8") as out:
        signal.alarm(5400)
        sys.path.insert(0, str(ROOT / "ml/common"))
        import mlx_runtime as rt
        rt.use_as_cuda_runtime()
        model, tok = rt.load_base(settings["base"])
        needed = sorted({MODULE[t] for t in manifest["types"]} - RULE_MODULES)
        model = rt.attach_adapters(model, [(m, ROOT / f"ml/{m}/adapters/{m}-lora") for m in needed])
        model = rt.attach_reasoner(model, settings["reasoner"])
        modules = {}
        for passage in manifest["passages"]:
            for typ in manifest["types"]:
                name = MODULE[typ]
                if name not in modules:
                    sys.path[:0] = [str(ROOT / "ml" / name / "windows"), str(ROOT / "ml" / name)]
                    sys.modules.pop("_cuda_runtime", None)
                    spec = importlib.util.spec_from_file_location(f"pipeline_{name}", ROOT / f"ml/{name}/windows/pipeline_{name}.py")
                    module = importlib.util.module_from_spec(spec)
                    spec.loader.exec_module(module)
                    modules[name] = module
                started = datetime.now(timezone.utc).isoformat()
                t0 = time.monotonic()
                log = io.StringIO()
                with contextlib.redirect_stderr(log):
                    try:
                        extra = {"kind": "일치" if typ == "match" else "불일치"} if name == "fact" else {}
                        result = modules[name].run_pipeline(model, tok, passage["original"],
                            max_retries=settings["max_retries"], temp=settings["temp"], main_adapter=name, **extra)
                    except Exception as exc:
                        result = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
                row = {"key": f"{passage['number']}|{typ}", "passage_id": passage["passage_id"],
                    "type": typ, "started_at": started, "finished_at": datetime.now(timezone.utc).isoformat(),
                    "generation_seconds": round(time.monotonic() - t0, 2), "result": result,
                    "pipeline_log": log.getvalue()}
                out.write(json.dumps(row, ensure_ascii=False) + "\n")
                out.flush()
                print(row["key"], result.get("ok"), row["generation_seconds"], flush=True)
        signal.alarm(0)


if __name__ == "__main__":
    main()
