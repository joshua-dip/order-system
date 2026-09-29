"""이 맥의 CPU·메모리 상태를 20초마다 DB(production_machine_stats)에 적는다 — 비공개 트래커 「이 맥」 카드가 읽는다.
모델을 올리지 않는 가벼운 수집기. 워커가 꺼져 있어도 돈다(launchd: ml/worker/register_machine_stats_launchd.sh).
  ml/topic/.venv/bin/python ml/worker/machine_stats.py [--once]
"""
from __future__ import annotations

import os
import re
import socket
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from pymongo import MongoClient

ROOT = Path(__file__).resolve().parents[2]
INTERVAL = 20
HISTORY = 180  # 20초 × 180 = 최근 1시간


def load_env() -> dict[str, str]:
    """.env → .env.local → 환경변수 순(Next.js 와 같음). 값은 출력하지 않는다."""
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


def run(cmd: list[str]) -> str:
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=15).stdout
    except Exception:
        return ""


def gb(text: str) -> float:
    """top 의 「51G」「6014M」「746M」 → GB"""
    m = re.match(r"([\d.]+)([KMGT])", text)
    if not m:
        return 0.0
    n, u = float(m.group(1)), m.group(2)
    return round(n * {"K": 1 / 1048576, "M": 1 / 1024, "G": 1, "T": 1024}[u], 2)


# 알아볼 프로세스 — 이름표만 붙이고 명령줄 전체는 저장하지 않는다
PROCS = [
    ("워커", "local_variant_worker.py"),
    ("워커 모델(7B+35B)", "inference_child.py"),  # 워커가 띄우는 자식 — 모델을 실제로 올린 프로세스
    ("평가", "run_eval.py"),
    ("판정", "judge_distractors.py"),
    ("공급기", "autofeed.ts"),
    ("트래커 미리보기", "next dev -H 127.0.0.1 -p 3107"),
]


def sample() -> dict:
    top = run(["top", "-l", "2", "-n", "0", "-s", "1"])  # 두 번째 표본이 실제 CPU 사용률
    cpu_lines = [l for l in top.splitlines() if l.startswith("CPU usage")]
    mem_lines = [l for l in top.splitlines() if l.startswith("PhysMem")]
    user = sys_ = 0.0
    if cpu_lines:
        m = re.search(r"([\d.]+)% user, ([\d.]+)% sys", cpu_lines[-1])
        if m:
            user, sys_ = float(m.group(1)), float(m.group(2))
    used = wired = comp = unused = 0.0
    if mem_lines:
        m = re.search(r"PhysMem: (\S+) used \((\S+) wired, (\S+) compressor\), (\S+) unused", mem_lines[-1])
        if m:
            used, wired, comp, unused = (gb(x) for x in m.groups())
    total = round(int(run(["sysctl", "-n", "hw.memsize"]).strip() or 0) / 2**30, 1)
    swap = run(["sysctl", "-n", "vm.swapusage"])
    sm = re.search(r"total = ([\d.]+)M\s+used = ([\d.]+)M", swap)
    pm = re.search(r"free percentage: (\d+)%", run(["memory_pressure"]))
    # 역할 프로세스(워커·평가·판정·공급기) — 켜져 있는지만. MLX 모델은 Metal 고정 메모리라 프로세스 메모리에 안 잡힌다
    roles = []
    for line in run(["ps", "-axo", "pid=,pcpu=,command="]).splitlines():
        parts = line.strip().split(None, 2)
        if len(parts) < 3:
            continue
        for label, needle in PROCS:
            if needle in parts[2] and "grep" not in parts[2] and label not in [r["name"] for r in roles]:
                roles.append({"name": label, "pid": int(parts[0]), "cpu": float(parts[1])})
    # 메모리를 많이 쓰는 프로세스 상위 6개(활성 상태 보기와 같은 footprint 기준)
    procs = []
    tops = run(["top", "-l", "1", "-o", "mem", "-n", "6", "-stats", "pid,mem,cpu,command"]).splitlines()
    hdr = next((i for i, l in enumerate(tops) if l.strip().startswith("PID")), None)
    for l in tops[hdr + 1:] if hdr is not None else []:
        parts = l.split(None, 3)
        if len(parts) == 4:
            pid = int(parts[0])
            role = next((r["name"] for r in roles if r["pid"] == pid), None)
            procs.append({"name": role or parts[3].strip()[:40], "pid": pid, "mem_gb": gb(parts[1].rstrip("+-")), "cpu": float(parts[2]), "role": bool(role)})
    return {
        "cpu": {"pct": round(user + sys_, 1), "user": user, "sys": sys_, "cores": os.cpu_count(), "load": [round(x, 2) for x in os.getloadavg()]},
        "mem": {"total_gb": total, "used_gb": used, "wired_gb": wired, "compressed_gb": comp, "free_gb": unused,
                "pressure_free_pct": int(pm.group(1)) if pm else None},
        "swap": {"total_gb": round(float(sm.group(1)) / 1024, 2) if sm else 0, "used_gb": round(float(sm.group(2)) / 1024, 2) if sm else 0},
        "roles": roles,
        "procs": procs,
    }


def main() -> int:
    uri = load_env().get("MONGODB_URI")
    if not uri:
        print("MONGODB_URI 없음", file=sys.stderr)
        return 1
    col = MongoClient(uri, serverSelectionTimeoutMS=20000)["gomijoshua"]["production_machine_stats"]
    host = socket.gethostname()
    once = "--once" in sys.argv
    while True:
        try:
            s = sample()
            now = datetime.now(timezone.utc)
            col.update_one({"_id": host}, {
                "$set": {"at": now, **s},
                "$push": {"history": {"$each": [{"at": now, "cpu": s["cpu"]["pct"], "used": s["mem"]["used_gb"], "wired": s["mem"]["wired_gb"], "swap": s["swap"]["used_gb"]}], "$slice": -HISTORY}},
            }, upsert=True)
        except Exception as e:  # 네트워크가 잠깐 끊겨도 계속 돈다
            print(f"[machine_stats] {type(e).__name__}", file=sys.stderr)
        if once:
            return 0
        time.sleep(INTERVAL)


if __name__ == "__main__":
    raise SystemExit(main())
