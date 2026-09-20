#!/usr/bin/env bash
# Mac(Apple Silicon) MLX LoRA 학습 — Claude/API 없음
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DIR="$(cd "$(dirname "$0")" && pwd)"
DATA="${ROOT}/data/topic-finetune"
ADAPTER="${DIR}/adapters/topic-lora"
MODEL="${1:-mlx-community/Llama-3.2-3B-Instruct-4bit}"
ITERS="${2:-600}"

if [[ ! -f "${DATA}/train.jsonl" ]]; then
  echo "train.jsonl 없음. 먼저: npm run cc:topic-export" >&2
  exit 1
fi

TRAIN_N=$(wc -l < "${DATA}/train.jsonl" | tr -d ' ')
if [[ "${TRAIN_N}" -lt 10 ]]; then
  echo "train.jsonl 이 ${TRAIN_N}줄뿐이라 학습을 중단합니다. export 건수를 확인하세요." >&2
  exit 1
fi

cd "${DIR}"
# 워크스페이스 .venv 생성이 막히는 환경 → TOPIC_MLX_VENV 또는 /tmp/topic-mlx-venv
VENV="${TOPIC_MLX_VENV:-}"
if [[ -z "${VENV}" ]]; then
  if [[ -x "${DIR}/.venv/bin/mlx_lm.lora" ]]; then
    VENV="${DIR}/.venv"
  elif [[ -x /tmp/topic-mlx-venv/bin/mlx_lm.lora ]]; then
    VENV=/tmp/topic-mlx-venv
  elif [[ -d "${DIR}/.venv" ]]; then
    VENV="${DIR}/.venv"
  fi
fi
if [[ -n "${VENV}" && -f "${VENV}/bin/activate" ]]; then
  # shellcheck disable=SC1091
  source "${VENV}/bin/activate"
fi

if ! command -v mlx_lm.lora >/dev/null 2>&1; then
  echo "mlx_lm.lora 없음. 예: python3 -m venv /tmp/topic-mlx-venv && /tmp/topic-mlx-venv/bin/pip install -r requirements.txt" >&2
  exit 1
fi

mkdir -p "${ADAPTER}"
echo "model=${MODEL} iters=${ITERS} data=${DATA} adapter=${ADAPTER}"
mlx_lm.lora \
  --model "${MODEL}" \
  --train \
  --data "${DATA}" \
  --adapter-path "${ADAPTER}" \
  --batch-size 1 \
  --iters "${ITERS}" \
  --learning-rate 1e-5 \
  --num-layers 8 \
  --mask-prompt \
  --fine-tune-type lora

echo "done → ${ADAPTER}"
