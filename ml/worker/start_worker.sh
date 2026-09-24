#!/usr/bin/env bash
# [맥] 로컬 LoRA 워커를 이 터미널에서 직접 돌린다 — Ctrl+C 로 멈춤. 로그인 때 자동으로: register_worker_launchd.sh
#   ./ml/worker/start_worker.sh          평소
#   ./ml/worker/start_worker.sh --fake   모델 없이 큐·화면 연결만 시험
#   ./ml/worker/start_worker.sh --once   한 건만 처리하고 끝
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
VENV="${LOCAL_VARIANT_VENV:-${DIR}/../topic/.venv}"
if [[ ! -x "${VENV}/bin/python" ]]; then
  echo "venv 없음: ${VENV}" >&2
  echo "python3.12 -m venv ml/topic/.venv && ml/topic/.venv/bin/pip install -r ml/topic/requirements.txt -r ml/worker/requirements.txt" >&2
  exit 1
fi
export PYTHONUNBUFFERED=1 PYTHONUTF8=1 PYTHONIOENCODING=utf-8
exec "${VENV}/bin/python" "${DIR}/local_variant_worker.py" "$@"
