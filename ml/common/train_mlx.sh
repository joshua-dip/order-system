#!/usr/bin/env bash
# [맥] 유형별 MLX LoRA 학습 — 주제·제목·주장 공용. Claude/API 없음.
#   ./ml/common/train_mlx.sh <topic|title|claim> [모델] [단계]
#   예) caffeinate -i ./ml/common/train_mlx.sh title mlx-community/Qwen2.5-7B-Instruct-4bit 3000
# 데이터: npm run cc:<유형>-export → data/<유형>-finetune/{train,valid}.jsonl
# 결과:   ml/<유형>/adapters/<유형>-lora  — 워커(맥)가 다음 작업부터 알아서 잡는다
# 설정은 주제에서 쓴 것과 같다(ml/topic/train.sh): lr 1e-5, 8층, batch 1, --mask-prompt(답 부분만 학습).
set -euo pipefail
TYPE="${1:?유형을 주세요: topic|title|claim}"
case "${TYPE}" in topic|title|claim) ;; *) echo "유형은 topic|title|claim 중 하나: ${TYPE}" >&2; exit 1 ;; esac
MODEL="${2:-mlx-community/Qwen2.5-7B-Instruct-4bit}"
ITERS="${3:-3000}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DATA="${ROOT}/data/${TYPE}-finetune"
ADAPTER="${ROOT}/ml/${TYPE}/adapters/${TYPE}-lora"
VENV="${TOPIC_MLX_VENV:-${ROOT}/ml/topic/.venv}"

if [[ ! -f "${DATA}/train.jsonl" ]]; then
  echo "train.jsonl 없음. 먼저: npm run cc:${TYPE}-export" >&2
  exit 1
fi
TRAIN_N=$(wc -l < "${DATA}/train.jsonl" | tr -d ' ')
if [[ "${TRAIN_N}" -lt 10 ]]; then
  echo "train.jsonl 이 ${TRAIN_N}줄뿐이라 학습을 중단합니다." >&2
  exit 1
fi
if [[ ! -x "${VENV}/bin/mlx_lm.lora" ]]; then
  echo "mlx_lm.lora 없음 (${VENV}). python3.12 -m venv ml/topic/.venv && ml/topic/.venv/bin/pip install -r ml/topic/requirements.txt" >&2
  exit 1
fi
# 학습 중인 어댑터를 워커가 반쯤 쓴 상태로 집지 않게 — 임시 폴더에 학습하고 끝나면 바꿔 넣는다
TMP="${ADAPTER}.training"
rm -rf "${TMP}"
mkdir -p "${TMP}"
echo "type=${TYPE} model=${MODEL} iters=${ITERS} train=${TRAIN_N} data=${DATA} adapter=${ADAPTER}"
"${VENV}/bin/mlx_lm.lora" \
  --model "${MODEL}" \
  --train \
  --data "${DATA}" \
  --adapter-path "${TMP}" \
  --batch-size 1 \
  --iters "${ITERS}" \
  --learning-rate 1e-5 \
  --num-layers 8 \
  --mask-prompt \
  --fine-tune-type lora
if [[ -d "${ADAPTER}" ]]; then
  mv "${ADAPTER}" "${ADAPTER}.prev-$(date +%Y%m%d-%H%M%S)"
fi
mv "${TMP}" "${ADAPTER}"
echo "done → ${ADAPTER}"
