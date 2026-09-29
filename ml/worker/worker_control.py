"""웹에서 워커 켜기·끄기 — production_worker_control 의 요청을 5초마다 읽어 launchd 로 워커를 켜고 끈다(비공개 트래커의 버튼).
늘 떠 있는 가벼운 프로그램(모델 없음): ml/worker/register_worker_control_launchd.sh
  문서 main: request(start|stop) · mode(now|after-job) · requested_at  ← 웹이 쓴다
             handled{request_at, action, ok, message, at} · mac{running, pid, at}  ← 여기서 쓴다
켜기 전에 평가·판정이 돌고 있거나 여유 메모리가 모자라면 거절한다(워커와 평가를 함께 올리면 맥이 멈춘다).
  ml/topic/.venv/bin/python ml/worker/worker_control.py [--once]
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from pymongo import MongoClient

ROOT = Path(__file__).resolve().parents[2]
LABEL = "com.gomijoshua.local-variant-worker"
PLIST = Path.home() / "Library/LaunchAgents" / f"{LABEL}.plist"
DOMAIN = f"gui/{os.getuid()}"
MIN_FREE_TO_START = 45  # 워커(7B+35B)가 고정 약 27GB — 64GB 맥에서 이만큼 비어 있어야 켠다
INTERVAL = 5


def load_env() -> dict[str, str]:
    """.env → .env.local → 환경변수 순. 값은 출력하지 않는다."""
    env: dict[str, str] = {}
    for name in (".env", ".env.local"):
        p = ROOT / name
        if p.is_file():
            for raw in p.read_text(encoding="utf-8").splitlines():
                line = raw.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    env[k.strip()] = v.strip().strip('"').strip("'")
    env.update({k: v for k, v in os.environ.items() if k == "MONGODB_URI"})
    return env


def run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, timeout=30)


def worker_state() -> tuple[bool, bool, int | None]:
    """(launchd 에 올라가 있나, 프로세스가 돌고 있나, pid)"""
    r = run(["launchctl", "print", f"{DOMAIN}/{LABEL}"])
    if r.returncode != 0:
        return False, False, None
    m = re.search(r"\bpid = (\d+)", r.stdout)
    return True, bool(m), int(m.group(1)) if m else None


def free_pct() -> int | None:
    m = re.search(r"free percentage: (\d+)%", run(["memory_pressure"]).stdout)
    return int(m.group(1)) if m else None


def busy_other() -> str | None:
    out = run(["ps", "-axo", "command="]).stdout
    for needle, label in (("run_eval.py", "평가"), ("judge_distractors.py", "판정")):
        if needle in out:
            return label
    return None


def start() -> tuple[bool, str]:
    loaded, running, _ = worker_state()
    if running:
        return True, "이미 켜져 있습니다"
    other = busy_other()
    if other:
        return False, f"{other}가 돌고 있어 켜지 않았습니다(함께 올리면 메모리가 넘칩니다)"
    free = free_pct()
    if free is not None and free < MIN_FREE_TO_START:
        return False, f"여유 메모리 {free}% — {MIN_FREE_TO_START}% 이상일 때 켭니다"
    if not PLIST.is_file():
        return False, "워커 launchd 설정이 없습니다(register_worker_launchd.sh 로 먼저 등록)"
    r = run(["launchctl", "kickstart", f"{DOMAIN}/{LABEL}"]) if loaded else run(["launchctl", "bootstrap", DOMAIN, str(PLIST)])
    if r.returncode != 0:
        return False, f"launchctl 실패: {(r.stderr or r.stdout).strip()[:120]}"
    return True, f"켰습니다 — 모델을 올리는 데 1~2분 걸립니다{f' (여유 메모리 {free}%)' if free is not None else ''}"


def stop() -> tuple[bool, str]:
    loaded, running, _ = worker_state()
    if not loaded:
        return True, "이미 꺼져 있습니다"
    r = run(["launchctl", "bootout", f"{DOMAIN}/{LABEL}"])
    if r.returncode != 0 and worker_state()[0]:
        return False, f"launchctl 실패: {(r.stderr or r.stdout).strip()[:120]}"
    return True, "껐습니다" + ("" if running else "(이미 멈춰 있던 워커를 내렸습니다)")


def tick(col) -> None:
    now = datetime.now(timezone.utc)
    loaded, running, pid = worker_state()
    col.update_one({"_id": "main"}, {"$set": {"mac": {"running": running, "loaded": loaded, "pid": pid, "free_pct": free_pct(), "at": now}}}, upsert=True)
    d = col.find_one({"_id": "main"}) or {}
    req_at = d.get("requested_at")
    if not req_at or (d.get("handled") or {}).get("request_at") == req_at:
        return
    action, mode = d.get("request"), d.get("mode") or "now"
    if action == "start":
        ok, msg = start()
    elif action == "stop" and mode == "after-job":
        # 워커가 새 작업을 집기 전에 스스로 끝낸다 — 끝나 있으면(또는 원래 멈춰 있으면) launchd 에서 내린다
        if running:
            col.update_one({"_id": "main"}, {"$set": {"waiting": {"since": d.get("waiting", {}).get("since") or now, "message": "지금 하던 문항을 마치면 끕니다"}}})
            return
        ok, msg = stop()
        msg = "하던 작업을 마치고 " + msg
    elif action == "stop":
        ok, msg = stop()
        if ok and running:
            msg += " — 하던 작업은 15분 뒤 다시 큐로 돌아갑니다"
    else:
        ok, msg = False, f"알 수 없는 요청: {action}"
    col.update_one({"_id": "main"}, {"$set": {"handled": {"request_at": req_at, "action": action, "mode": mode, "ok": ok, "message": msg, "at": datetime.now(timezone.utc)}},
                                     "$unset": {"waiting": ""}})
    print(f"[worker_control] {action}/{mode}: {'OK' if ok else '거절'} — {msg}", flush=True)


def main() -> int:
    uri = load_env().get("MONGODB_URI")
    if not uri:
        print("MONGODB_URI 없음", file=sys.stderr)
        return 1
    col = MongoClient(uri, serverSelectionTimeoutMS=20000, tz_aware=True)["gomijoshua"]["production_worker_control"]
    once = "--once" in sys.argv
    while True:
        try:
            tick(col)
        except Exception as e:  # noqa: BLE001 — 네트워크가 잠깐 끊겨도 계속
            print(f"[worker_control] {type(e).__name__}", file=sys.stderr, flush=True)
        if once:
            return 0
        time.sleep(INTERVAL)


if __name__ == "__main__":
    raise SystemExit(main())
