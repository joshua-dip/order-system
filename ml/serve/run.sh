#!/usr/bin/env bash
# 로컬 변형문제 OpenAI 호환 서버 — Cursor Override Base URL 용
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if [[ -z "${LOCAL_VARIANT_API_KEY:-}" ]]; then
  echo "LOCAL_VARIANT_API_KEY 가 비어 있습니다. 예:" >&2
  echo '  export LOCAL_VARIANT_API_KEY=$(openssl rand -hex 24); echo $LOCAL_VARIANT_API_KEY' >&2
  echo "  ./ml/serve/run.sh" >&2
  exit 2
fi

PORT="${PORT:-8765}"
exec caffeinate -i ml/topic/.venv/bin/python ml/serve/openai_server.py --port "$PORT" "$@"
