#!/usr/bin/env bash
# 터미널에 지문 붙여넣고 주제 문항 JSON 생성
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "${DIR}/../.." && pwd)"

if [[ -x /tmp/topic-mlx-venv/bin/python ]]; then
  PY=/tmp/topic-mlx-venv/bin/python
elif [[ -n "${TOPIC_MLX_VENV:-}" && -x "${TOPIC_MLX_VENV}/bin/python" ]]; then
  PY="${TOPIC_MLX_VENV}/bin/python"
elif [[ -x "${DIR}/.venv/bin/python" ]]; then
  PY="${DIR}/.venv/bin/python"
else
  echo "Python venv 없음. docs/ml/topic-local-ai.md 참고" >&2
  exit 1
fi

cd "${ROOT}"
exec "${PY}" "${DIR}/infer.py" --paste "$@"
