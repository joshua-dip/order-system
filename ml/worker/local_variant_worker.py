#!/usr/bin/env python3
"""로컬 LoRA 변형문제 워커 — MongoDB 작업 큐(local_variant_jobs)를 처리한다.

관리자 화면(배포·로컬 모두)이 작업을 넣으면 이 PC 가 꺼내 GPU 로 만들고 결과를 적는다.
PC 에서 Atlas 로 나가는 연결만 쓴다 — 포트를 열거나 터널을 둘 필요가 없다.
필드·상태 규약: docs/handoff/2026-09-23-로컬-LoRA-작업큐.md · 사용법: docs/ml/local-variant-worker.md

  register_worker_task.ps1                   # [Windows] 로그인 때 창 없이 상주(권장) — 로그 ml/worker/logs/worker.log
  start_worker.bat                           # [Windows] 콘솔 창에서 직접 돌리기(창을 닫으면 멈춤)
  register_worker_launchd.sh                 # [맥] 로그인 때 상주(LaunchAgent) — 로그 ml/worker/logs/worker.log
  start_worker.sh                            # [맥] 터미널에서 직접 돌리기
  python local_variant_worker.py --fake      # GPU 없이 큐·화면 연결만 시험(고정 결과)
  python local_variant_worker.py --once      # 한 건만 처리하고 끝

모델은 자식 프로세스(inference_child.py)에 올린다. 한동안 작업이 없으면 자식을 끝내
CUDA 메모리를 통째로 돌려준다 — 같은 4GB GPU 로 학습도 돌리기 때문이다.

백엔드: Windows·Linux = CUDA(torch·peft, 어댑터 <유형>-lora-cuda),
        맥(Apple Silicon) = MLX(mlx-lm, 어댑터 <유형>-lora — ml/topic/train.sh 가 만드는 것).
큐·하트비트·lease·재시도는 백엔드와 무관하다.
"""
from __future__ import annotations

import argparse
import json
import os
import queue
import socket
import subprocess
import sys
import threading
import time
import traceback
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

_WORKER_DIR = Path(__file__).resolve().parent
_ML = _WORKER_DIR.parent
_ROOT = _ML.parent
sys.path.insert(0, str(_ML / "common"))

# 맥은 MLX, 그 밖은 CUDA. LOCAL_VARIANT_BACKEND=cuda|mlx 로 바꿀 수 있다.
BACKEND = os.environ.get("LOCAL_VARIANT_BACKEND") or ("mlx" if sys.platform == "darwin" else "cuda")
if BACKEND == "mlx":
    import mlx_runtime as rt  # noqa: E402  (어댑터 탐색만 — mlx 는 자식 프로세스에서만 쓴다)
else:
    import cuda_runtime as rt  # noqa: E402  (어댑터 탐색만 — torch 는 자식 프로세스에서만 쓴다)
from win_qos import opt_out_power_throttling  # noqa: E402
# 어댑터 폴더 이름 — MLX 와 HF/peft 어댑터는 서로 호환되지 않아 이름을 나눠 둔다
_ADAPTER_SUFFIX = "" if BACKEND == "mlx" else "-cuda"
# [맥] 주장·검증·해설(어댑터를 끈 단계)을 맡길 큰 범용 모델. 초안은 여전히 유형별 LoRA 가 쓴다.
# 같은 시험 세트에서 7B 단독 맞음 10/24 → 35B 를 붙여 21/24(통념→반박 지문이 풀림). 끄려면 --reasoner ""
DEFAULT_REASONER = "mlx-community/Qwen3.6-35B-A3B-4bit" if BACKEND == "mlx" else ""
REASONER = DEFAULT_REASONER

DB_NAME = "gomijoshua"  # 웹앱 getDb('gomijoshua') 와 같은 DB
JOBS = "local_variant_jobs"
WORKERS = "local_variant_workers"
VERSION = 1
# 한글 유형 → ml/ 아래 폴더명. lib/local-variant-types.ts 의 표와 같아야 한다.
TYPES = {"주제": "topic", "제목": "title", "주장": "claim"}
MAX_ATTEMPTS = 3
HEARTBEAT_SEC = 15
MARK = "@@RESULT@@ "
# 창 없이 뜬 워커(pythonw — 작업 스케줄러)에서 nvidia-smi·자식 프로세스가 콘솔 창을 띄우지 않게
_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def log(msg: str) -> None:
    print(f"[{datetime.now():%m-%d %H:%M:%S}] {msg}", flush=True)


def brief(e: BaseException) -> str:
    """오류 한 줄 — MongoDB 오류는 이름만 적는다(메시지에 클러스터 호스트가 들어 있다)."""
    if type(e).__module__.startswith("pymongo"):
        return type(e).__name__
    return f"{type(e).__name__}: {e}"[:300]


def load_env() -> dict[str, str]:
    """환경변수 > .env.local > .env (Next.js 와 같은 우선순위). 값은 절대 출력하지 않는다."""
    env: dict[str, str] = {}
    for name in (".env", ".env.local"):
        p = _ROOT / name
        if not p.is_file():
            continue
        for raw in p.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    if os.environ.get("MONGODB_URI"):
        env["MONGODB_URI"] = os.environ["MONGODB_URI"]
    return env


def _mac_memory() -> dict | None:
    """맥 통합 메모리 — 칩 이름·전체·여유(free+inactive+speculative 페이지). 화면 표시용."""
    try:
        name = subprocess.run(["sysctl", "-n", "machdep.cpu.brand_string"], capture_output=True, text=True, timeout=5).stdout.strip()
        total = int(subprocess.run(["sysctl", "-n", "hw.memsize"], capture_output=True, text=True, timeout=5).stdout.strip())
        vm = subprocess.run(["vm_stat"], capture_output=True, text=True, timeout=5).stdout
        page = int(vm.split("page size of ")[1].split(" ")[0])
        pages = 0
        for line in vm.splitlines():
            if line.startswith(("Pages free", "Pages inactive", "Pages speculative")):
                pages += int(line.split(":")[1].strip().rstrip("."))
        return {"name": name or "Apple Silicon", "free_mb": pages * page // 2**20, "total_mb": total // 2**20}
    except Exception:
        return None


def gpu_memory() -> dict | None:
    """nvidia-smi 로 GPU 여유 메모리를 읽는다 — 이 프로세스에서 CUDA 를 켜지 않으려고.
    (WDDM 에서는 프로세스별 사용량이 안 나와 학습 중인지는 여유 메모리로만 알 수 있다.)
    맥은 통합 메모리 값을 돌려준다."""
    if BACKEND == "mlx":
        return _mac_memory()
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.free,memory.total", "--format=csv,noheader,nounits"],
            capture_output=True,
            text=True,
            timeout=10,
            check=True,
            creationflags=_NO_WINDOW,
        ).stdout.strip().splitlines()[0]
        name, free, total = [x.strip() for x in out.split(",")]
        return {"name": name, "free_mb": int(free), "total_mb": int(total)}
    except Exception:
        return None


def _stamp(adapter: Path) -> str:
    """어댑터가 새로 학습되면 바뀌는 값 — peft 는 adapter_model.safetensors, MLX 는 adapters.safetensors."""
    for name in ("adapter_model.safetensors", "adapters.safetensors"):
        try:
            return str(int((adapter / name).stat().st_mtime))
        except OSError:
            continue
    return ""


def discover_types(only: set[str]) -> dict[str, dict]:
    """유형별 어댑터 학습 여부 — 학습이 끝나면 다음 작업부터 워커를 다시 켜지 않아도 잡힌다."""
    out: dict[str, dict] = {}
    for ko, en in TYPES.items():
        if only and ko not in only:
            continue
        main = _ML / en / "adapters" / f"{en}-lora{_ADAPTER_SUFFIX}"
        explain = _ML / en / "adapters" / f"{en}-explain-lora{_ADAPTER_SUFFIX}"
        trained = rt.adapter_exists(main)
        base = rt.load_base_model_name(main, "") if trained else ""
        explain_ok = trained and rt.adapter_exists(explain) and rt.load_base_model_name(explain, "") == base
        out[ko] = {
            "en": en,
            "trained": trained,
            "explain": explain_ok,
            "base_model": base or None,
            "use_4bit": rt.resolve_use_4bit(main, False) if trained else False,
            "main_path": str(main),
            "explain_path": str(explain),
            "stamp": _stamp(main) + "/" + (_stamp(explain) if explain_ok else ""),
        }
    return out


def child_spec(types_info: dict[str, dict], base: str, use_4bit: bool) -> dict:
    """같은 베이스를 쓰는 어댑터를 전부 한 모델에 붙인다(주제·제목·주장 전환은 이름으로)."""
    adapters: list[list[str]] = []
    stamps: list[str] = []
    for info in types_info.values():
        if not info["trained"] or info["base_model"] != base:
            continue
        adapters.append([info["en"], info["main_path"]])
        if info["explain"]:
            adapters.append([f"{info['en']}_explain", info["explain_path"]])
        stamps.append(info["stamp"])
    return {"base_model": base, "use_4bit": use_4bit, "adapters": adapters, "stamp": "|".join(stamps), "backend": BACKEND,
            "reasoner": REASONER}


def fake_question_data(ko: str, paragraph: str) -> dict:
    return {
        "Question": f"[워커 시험 — 저장하지 마세요] {ko}",
        "Paragraph": paragraph,
        "Options": " ### ".join(
            f"{c} worker fake mode option number {i} for plumbing tests" for i, c in enumerate("①②③④⑤", 1)
        ),
        "CorrectAnswer": "③",
        "Explanation": "정답은 ③. 워커 --fake 모드의 고정 결과입니다 — 큐와 화면 연결만 확인하는 용도라 저장하면 안 됩니다.",
        "OptionType": "English",
    }


class GpuBusy(Exception):
    """GPU 여유 메모리가 모자람(대개 학습 중) — 작업을 대기열로 되돌린다."""


class ChildError(Exception):
    """자식 프로세스 로드·응답 실패."""


class InferenceChild:
    def __init__(self, spec: dict, load_timeout: float) -> None:
        self.spec = spec
        self.results: queue.Queue[str] = queue.Queue()
        payload = {k: spec[k] for k in ("base_model", "use_4bit", "adapters", "backend", "reasoner")}
        env = {**os.environ, "PYTHONUNBUFFERED": "1", "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"}
        self.proc = subprocess.Popen(
            [sys.executable, str(_WORKER_DIR / "inference_child.py"), json.dumps(payload, ensure_ascii=False)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=env,
            cwd=str(_ROOT),
            creationflags=_NO_WINDOW,
        )
        threading.Thread(target=self._pump_stdout, daemon=True).start()
        threading.Thread(target=self._pump_stderr, daemon=True).start()
        ready = self._read(load_timeout)
        if not ready.get("ready"):
            self.stop()
            if ready.get("oom"):
                raise GpuBusy(str(ready.get("error") or "모델 로드 중 CUDA 메모리 부족"))
            raise ChildError(f"모델 로드 실패: {ready.get('error') or '원인 미상'}")
        self.last_used = time.time()

    def _pump_stdout(self) -> None:
        assert self.proc.stdout is not None
        for line in self.proc.stdout:
            if line.startswith(MARK):
                self.results.put(line[len(MARK) :])
        self.results.put("")  # 끝 표시

    def _pump_stderr(self) -> None:
        assert self.proc.stderr is not None
        for line in self.proc.stderr:
            line = line.rstrip()
            if line:
                log(f"  | {line[:300]}")

    def _read(self, timeout: float) -> dict:
        # 1초씩 나눠 기다린다 — Windows 에서 긴 timeout 한 번이면 그동안 Ctrl+C 가 먹지 않는다
        deadline = time.time() + timeout
        while True:
            try:
                raw = self.results.get(timeout=1.0)
                break
            except queue.Empty:
                if time.time() > deadline:
                    self.stop()
                    raise ChildError(f"모델 프로세스가 {int(timeout)}초 동안 응답하지 않았습니다.")
        if raw == "":
            raise ChildError(f"모델 프로세스가 끝났습니다(exit {self.proc.poll()}).")
        return json.loads(raw)

    def alive(self) -> bool:
        return self.proc.poll() is None

    def generate(self, en: str, paragraph: str, explain: bool, timeout: float) -> dict:
        assert self.proc.stdin is not None
        self.proc.stdin.write(json.dumps({"en": en, "paragraph": paragraph, "explain": explain}, ensure_ascii=False) + "\n")
        self.proc.stdin.flush()
        res = self._read(timeout)
        self.last_used = time.time()
        return res

    def stop(self) -> None:
        if self.proc.poll() is not None:
            return
        try:
            if self.proc.stdin:
                self.proc.stdin.close()  # 자식은 입력이 끝나면 스스로 종료한다
            self.proc.wait(timeout=15)
        except Exception:
            self.proc.kill()
            self.proc.wait(timeout=15)


class Worker:
    def __init__(self, args: argparse.Namespace, db: Any, return_after: Any) -> None:
        self.args = args
        self.jobs = db[JOBS]
        self.workers = db[WORKERS]
        self.return_after = return_after
        self.id = socket.gethostname()
        self.only = {t.strip() for t in args.types.split(",") if t.strip()} if args.types else set()
        self.lease = timedelta(minutes=args.lease_min)
        self.types_info = discover_types(self.only)
        self.state = "idle"
        self.current_job: Any = None
        self.child: InferenceChild | None = None
        self.started_at = utcnow()
        self.stop_event = threading.Event()
        # 같은 작업이 GPU 부족으로 계속 되돌려지면(모델이 이 GPU 에 안 맞는 경우) 끝없이 돌지 않게 센다
        self.busy_strikes: dict[str, int] = {}

    # ---- 하트비트 ----
    def heartbeat(self) -> None:
        now = utcnow()
        gpu = gpu_memory()
        child = self.child
        self.workers.update_one(
            {"_id": self.id},
            {
                "$set": {
                    "last_seen": now,
                    "state": self.state,
                    "model_loaded": bool(child and child.alive()),
                    "base_model": child.spec["base_model"] if child else None,
                    "fake": self.args.fake,
                    "pid": os.getpid(),
                    "version": VERSION,
                    "backend": BACKEND,
                    "reasoner": REASONER or None,
                    "gpu": {"name": gpu["name"], "free_mb": gpu["free_mb"], "total_mb": gpu["total_mb"]} if gpu else None,
                    "current_job": str(self.current_job) if self.current_job is not None else None,
                    "types": {
                        ko: {"trained": i["trained"], "explain": i["explain"], "base_model": i["base_model"]}
                        for ko, i in self.types_info.items()
                    },
                    "started_at": self.started_at,
                }
            },
            upsert=True,
        )
        if self.current_job is not None:
            # 오래 걸리는 생성 중에도 다른 워커가 가져가지 않게 lease 를 늘린다
            self.jobs.update_one(
                {"_id": self.current_job, "status": "running", "claimed_by": self.id},
                {"$set": {"lease_until": now + self.lease}},
            )

    def heartbeat_loop(self) -> None:
        failing, last_log = False, 0.0
        while not self.stop_event.wait(HEARTBEAT_SEC):
            try:
                self.heartbeat()
                if failing:
                    log("하트비트 복구")
                failing = False
            except Exception as e:  # noqa: BLE001
                # 네트워크가 끊긴 동안 15초마다 같은 줄을 쌓지 않게 10분에 한 번만 적는다
                if not failing or time.time() - last_log > 600:
                    log(f"하트비트 실패 — 계속 다시 시도합니다: {brief(e)}")
                    last_log = time.time()
                failing = True

    # ---- 큐 ----
    def _claimable(self) -> dict[str, Any]:
        q: dict[str, Any] = {
            "$or": [{"status": "queued"}, {"status": "running", "lease_until": {"$lt": utcnow()}}],
            "attempts": {"$lt": MAX_ATTEMPTS},
        }
        if self.only:
            q["type"] = {"$in": sorted(self.only)}
        return q

    def has_work(self) -> bool:
        return self.jobs.find_one(self._claimable(), {"_id": 1}) is not None

    def claim(self) -> dict | None:
        now = utcnow()
        return self.jobs.find_one_and_update(
            self._claimable(),
            {
                "$set": {
                    "status": "running",
                    "claimed_by": self.id,
                    "claimed_at": now,
                    "lease_until": now + self.lease,
                    "updated_at": now,
                },
                "$inc": {"attempts": 1},
            },
            sort=[("created_at", 1)],
            return_document=self.return_after,
        )

    def sweep_stale(self) -> None:
        """lease 가 끝났는데 시도 한도를 넘긴 작업은 실패로 닫는다(워커가 계속 죽은 경우)."""
        now = utcnow()
        self.jobs.update_many(
            {"status": "running", "lease_until": {"$lt": now}, "attempts": {"$gte": MAX_ATTEMPTS}},
            {
                "$set": {
                    "status": "failed",
                    "error": "작업이 여러 번 중단됐습니다(워커 재시작·시간 초과).",
                    "finished_at": now,
                    "updated_at": now,
                }
            },
        )

    def finish(self, job_id: Any, result: dict | None = None, error: str | None = None) -> None:
        self.busy_strikes.pop(str(job_id), None)
        now = utcnow()
        r = self.jobs.update_one(
            {"_id": job_id, "status": "running", "claimed_by": self.id},
            {
                "$set": {
                    "status": "failed" if error else "done",
                    "result": result,
                    "error": error,
                    "lease_until": None,
                    "finished_at": now,
                    "updated_at": now,
                }
            },
        )
        if r.matched_count == 0:
            log(f"작업 {job_id}: 결과를 버림(그사이 취소됨)")
        else:
            log(f"작업 {job_id}: " + (f"실패 — {error}" if error else "완료"))

    def release(self, job_id: Any) -> None:
        """GPU 가 바빠서 못 한 작업은 대기열로 되돌린다 — 작업 탓이 아니니 시도 횟수도 되돌린다."""
        self.jobs.update_one(
            {"_id": job_id, "status": "running", "claimed_by": self.id},
            {
                "$set": {"status": "queued", "claimed_by": None, "claimed_at": None, "lease_until": None, "updated_at": utcnow()},
                "$inc": {"attempts": -1},
            },
        )

    def is_cancelled(self, job_id: Any) -> bool:
        doc = self.jobs.find_one({"_id": job_id}, {"status": 1})
        return not doc or doc.get("status") != "running"

    # ---- 모델 ----
    def gpu_ok(self) -> bool:
        if not self.args.min_free_mb:
            return True  # 맥 기본 — 통합 메모리는 여유를 기다리지 않는다
        mem = gpu_memory()
        return mem is not None and mem["free_mb"] >= self.args.min_free_mb

    def drop_child(self) -> None:
        if self.child is not None:
            self.child.stop()
            self.child = None

    def ensure_child(self, info: dict) -> InferenceChild:
        spec = child_spec(self.types_info, info["base_model"], info["use_4bit"])
        c = self.child
        if c is not None and c.alive() and c.spec["stamp"] == spec["stamp"] and c.spec["base_model"] == spec["base_model"]:
            return c
        self.drop_child()  # 베이스가 다르거나 어댑터가 새로 학습됐으면 새로 띄운다
        if not self.gpu_ok():
            mem = gpu_memory()
            raise GpuBusy(f"GPU 여유 {mem['free_mb'] if mem else '?'}MB < {self.args.min_free_mb}MB")
        log(f"모델 로드: {spec['base_model']} + 어댑터 {[a[0] for a in spec['adapters']]}"
            + (f" + 추론 모델 {spec['reasoner']}" if spec.get("reasoner") else ""))
        self.child = InferenceChild(spec, load_timeout=self.args.load_timeout_sec)
        log("모델 준비됨")
        return self.child

    # ---- 처리 ----
    def process(self, job: dict) -> None:
        job_id = job["_id"]
        ko = job.get("type")
        en = TYPES.get(ko) if isinstance(ko, str) else None
        paragraph = job.get("paragraph")
        self.current_job = job_id
        log(f"작업 {job_id} {ko} 시작(시도 {job.get('attempts')})")
        try:
            if en is None or not isinstance(paragraph, str) or not paragraph.strip():
                self.finish(job_id, error="작업 형식이 잘못됐습니다(type/paragraph).")
                return
            if self.args.fake:
                time.sleep(2)
                self.finish(
                    job_id,
                    result={"question_data": fake_question_data(ko, paragraph), "fake": True, "elapsed_ms": 2000},
                )
                return
            info = self.types_info.get(ko)
            if not info or not info["trained"]:
                self.finish(job_id, error=f"{ko} 어댑터가 아직 학습되지 않았습니다 (ml/{en}/adapters/{en}-lora{_ADAPTER_SUFFIX}).")
                return
            self.state = "loading"
            child = self.ensure_child(info)
            if self.is_cancelled(job_id):
                log(f"작업 {job_id}: 시작 전에 취소됨")
                return
            self.state = "running"
            res = child.generate(en, paragraph, bool(info["explain"]), timeout=self.args.gen_timeout_sec)
            if res.get("oom"):
                self.drop_child()
                raise GpuBusy(str(res.get("error") or "생성 중 CUDA 메모리 부족"))
            qd = res.get("question_data")
            if res.get("ok") and isinstance(qd, dict):
                self.finish(
                    job_id,
                    result={
                        "question_data": qd,
                        "elapsed_ms": res.get("elapsed_ms"),
                        "adapter": {"main": en, "explain": bool(info["explain"]), "base_model": info["base_model"]},
                        "pipeline": res.get("pipeline"),
                    },
                )
            else:
                self.finish(job_id, error=f"생성 실패: {res.get('error') or '원인 미상'}")
        except GpuBusy as e:
            key = str(job_id)
            self.busy_strikes[key] = self.busy_strikes.get(key, 0) + 1
            if self.busy_strikes[key] >= 3:
                self.busy_strikes.pop(key, None)
                self.finish(job_id, error=f"GPU 메모리 부족으로 3번 실패했습니다 — 모델이 이 GPU 에 맞지 않을 수 있습니다. ({e})")
            else:
                log(f"GPU 사용 중 — 작업을 대기열로 되돌립니다: {e}")
                self.release(job_id)
            self.state = "gpu_busy"
        except ChildError as e:
            self.drop_child()
            self.finish(job_id, error=str(e))
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            self.finish(job_id, error=f"워커 오류: {type(e).__name__}: {e}"[:500])
        finally:
            self.current_job = None
            if self.state in ("loading", "running"):
                self.state = "idle"

    def run(self) -> None:
        try:
            self.heartbeat()
        except Exception as e:  # noqa: BLE001
            # 로그인 직후처럼 네트워크가 아직 없을 수 있다 — 끝내지 않고 루프에서 다시 시도한다
            log(f"MongoDB 에 아직 닿지 않습니다 — 계속 다시 시도합니다: {brief(e)}")
        threading.Thread(target=self.heartbeat_loop, daemon=True).start()
        trained = [ko for ko, i in self.types_info.items() if i["trained"]]
        log(
            f"워커 시작 id={self.id} backend={BACKEND} fake={self.args.fake} 학습된 유형={trained or '없음'} "
            + (f"(GPU 여유 {self.args.min_free_mb}MB 이상일 때만 모델을 올림)" if self.args.min_free_mb else "(메모리 대기 없음)")
        )
        last_busy_log = 0.0
        errors = 0
        try:
            while True:
                try:
                    self.types_info = discover_types(self.only)
                    self.sweep_stale()
                    if errors:
                        log("복구됨 — 다시 작업을 받습니다")
                        errors = 0
                    if self.child is not None and not self.child.alive():
                        self.child = None
                    if self.child is not None and time.time() - self.child.last_used > self.args.idle_unload_min * 60:
                        log("작업이 없어 모델을 내려놓습니다(GPU 메모리 반환)")
                        self.drop_child()
                    need_gpu = not self.args.fake and any(i["trained"] for i in self.types_info.values())
                    # 할 일이 있을 때만 GPU 를 확인한다(쉬는 동안 nvidia-smi 를 계속 부르지 않게)
                    if need_gpu and self.child is None and self.has_work() and not self.gpu_ok():
                        # 학습 등으로 GPU 가 차 있으면 작업을 집지 않는다 — 화면에는 「대기」로 남는다
                        if self.state != "gpu_busy" or time.time() - last_busy_log > 600:
                            log("GPU 여유 메모리가 모자라 대기합니다(학습 중?)")
                            last_busy_log = time.time()
                        self.state = "gpu_busy"
                        time.sleep(15)
                        continue
                    job = self.claim()
                    if job is None:
                        self.state = "idle"
                        time.sleep(self.args.poll_sec)
                        continue
                    self.process(job)
                    if self.args.once:
                        break
                except Exception as e:  # noqa: BLE001
                    # 네트워크 끊김·학습이 어댑터를 쓰는 중 등으로 워커가 통째로 끝나지 않게 — 쉬었다 다시 돈다(최대 1분)
                    errors += 1
                    if errors == 1 or errors % 10 == 0:
                        if not type(e).__module__.startswith("pymongo"):
                            traceback.print_exc()
                        log(f"오류 {errors}회째 — 잠시 뒤 다시 시도합니다: {brief(e)}")
                    time.sleep(min(60, 5 * errors))
        except KeyboardInterrupt:
            log("중지합니다")
        finally:
            self.stop_event.set()
            if self.current_job is not None:
                self.release(self.current_job)
            self.drop_child()
            self.state = "stopped"
            try:
                self.heartbeat()
            except Exception:  # noqa: BLE001
                pass


def acquire_lock() -> Any:
    """이 PC 에서 워커는 하나만 — 두 개가 모델을 올리면 4GB GPU 가 버티지 못한다."""
    fh = open(_WORKER_DIR / ".worker.lock", "a+")
    try:
        if os.name == "nt":
            import msvcrt

            fh.seek(0)
            msvcrt.locking(fh.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl

            fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        fh.close()
        return None
    return fh


def redirect_output(path: Path) -> None:
    """창 없이(pythonw) 뜨면 출력이 버려진다 — 파일에 덧붙인다. 자식 출력도 log() 를 거쳐 여기 남는다."""
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        if path.stat().st_size > 5_000_000:
            path.replace(path.with_suffix(".1.log"))  # worker.log → worker.1.log (직전 것 하나만 남김)
    except OSError:
        pass
    fh = open(path, "a", encoding="utf-8", errors="replace", buffering=1)
    sys.stdout = sys.stderr = fh


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

    ap = argparse.ArgumentParser(description="Local LoRA variant worker (MongoDB queue)")
    ap.add_argument("--fake", action="store_true", help="GPU 없이 고정 결과 — 큐·화면 연결 시험용")
    ap.add_argument("--once", action="store_true", help="한 건만 처리하고 끝")
    ap.add_argument("--types", default="", help="이 워커가 맡을 유형(쉼표) 예: 주제,제목 — 기본은 전부")
    ap.add_argument("--poll-sec", type=float, default=3.0)
    ap.add_argument("--idle-unload-min", type=float, default=10.0, help="작업이 없으면 이만큼 뒤 모델을 내려놓음")
    ap.add_argument("--lease-min", type=float, default=15.0)
    ap.add_argument(
        "--min-free-mb",
        type=int,
        default=0 if BACKEND == "mlx" else 2600,
        help="모델을 올리기 전에 필요한 GPU 여유 메모리(0=확인 안 함, 맥 기본)",
    )
    ap.add_argument("--load-timeout-sec", type=float, default=900)
    ap.add_argument("--gen-timeout-sec", type=float, default=900)
    ap.add_argument("--log-file", default="", help="출력을 이 파일에 덧붙임 — 창 없이 띄울 때(register_worker_task.ps1)")
    ap.add_argument(
        "--reasoner",
        default=os.environ.get("LOCAL_VARIANT_REASONER", DEFAULT_REASONER),
        help='[맥] 주장·검증·해설을 맡길 큰 모델(기본 Qwen3.6-35B-A3B-4bit, "" 이면 끔)',
    )
    args = ap.parse_args()
    global REASONER
    REASONER = args.reasoner.strip() if BACKEND == "mlx" else ""
    if args.log_file:
        redirect_output(Path(args.log_file))
    # Windows 효율 모드(EcoQoS) 끄기 — 무거운 일은 자식(inference_child)이 하지만 워커도 같은 조건으로 둔다
    opt_out_power_throttling()

    uri = load_env().get("MONGODB_URI")
    if not uri:
        log("MONGODB_URI 없음 — 저장소 루트 .env.local 을 확인하세요.")
        return 1
    try:
        from pymongo import MongoClient, ReturnDocument
    except ImportError:
        log("pymongo 없음 — venv 에서 pip install -r ml/worker/requirements.txt")
        return 1
    lock = acquire_lock()
    if lock is None:
        log("이 PC 에서 이미 워커가 돌고 있습니다(ml/worker/.worker.lock).")
        return 1

    client = MongoClient(uri, serverSelectionTimeoutMS=20000, tz_aware=True)
    Worker(args, client[DB_NAME], ReturnDocument.AFTER).run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
