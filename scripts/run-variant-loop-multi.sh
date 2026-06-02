#!/usr/bin/env bash
# 같은 주문/교재를 여러 세션이 동시에 채우도록 새 Terminal.app 창 N 개 띄움 (macOS 전용).
#
# 사용:
#   ./scripts/run-variant-loop-multi.sh <세션수> "BV-20260601-001"
#   ./scripts/run-variant-loop-multi.sh 4 --textbook "Booster 어법어휘"
#
# 예:
#   ./scripts/run-variant-loop-multi.sh 8 "BV-20260601-001"
#
# 각 창은 서로 다른 시드(session-1, session-2, …)로 시작해 자연스럽게 다른 슬롯을 고른다.
# 같은 (passage,type) 조합을 우연히 두 세션이 같이 만들 가능성은 있으나 (저장 자체는 idempotent X — 같은 자리에 한 건 더 들어감) 영향은 미미.

set -euo pipefail

COUNT=""
TARGET=""
USE_TEXTBOOK=0

while [ $# -gt 0 ]; do
  case "$1" in
    --textbook)
      USE_TEXTBOOK=1
      shift
      TARGET="${1:-}"
      shift || true
      ;;
    --textbook=*)
      USE_TEXTBOOK=1
      TARGET="${1#*=}"
      shift
      ;;
    -h|--help|"")
      cat <<'EOF'
사용법:
  ./scripts/run-variant-loop-multi.sh <세션수> "BV-20260601-001"
  ./scripts/run-variant-loop-multi.sh <세션수> --textbook "Booster 어법어휘"

예:
  ./scripts/run-variant-loop-multi.sh 8 "BV-20260601-001"
  ./scripts/run-variant-loop-multi.sh 4 --textbook "Booster 어법어휘"

세션 수 권장:
  • 4~8 — 무난. Anthropic Pro 처리량 안에서 동시 가동.
  • 12 이상 — 큐 대기로 처리량 효율 안 올라감.

플랫폼:
  • macOS 의 Terminal.app 만 지원. iTerm 사용자는 직접 N 개 탭 열고
    각각 ./scripts/run-variant-loop.sh --seed session-N "..." 실행 권장.
EOF
      exit 1
      ;;
    *)
      if [ -z "$COUNT" ]; then
        COUNT="$1"
      else
        TARGET="$1"
      fi
      shift
      ;;
  esac
done

if [ -z "$COUNT" ] || [ -z "$TARGET" ]; then
  echo "❌ 세션수와 주문번호(또는 --textbook \"교재명\") 모두 필요합니다." >&2
  echo "   예: ./scripts/run-variant-loop-multi.sh 8 \"BV-20260601-001\"" >&2
  exit 1
fi

if ! [[ "$COUNT" =~ ^[0-9]+$ ]] || [ "$COUNT" -lt 1 ] || [ "$COUNT" -gt 32 ]; then
  echo "❌ 세션수는 1~32 사이 정수." >&2
  exit 1
fi

if [[ "$(uname)" != "Darwin" ]]; then
  echo "❌ 이 스크립트는 macOS 전용입니다. Linux 라면 tmux 로 새 창을 열어 직접 호출하세요." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SINGLE="$PROJECT_ROOT/scripts/run-variant-loop.sh"

if [[ ! -x "$SINGLE" ]]; then
  chmod +x "$SINGLE"
fi

LOG_DIR="$PROJECT_ROOT/.variant-loop-logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/runs.log"
START_ISO=$(date -Iseconds 2>/dev/null || date +"%Y-%m-%dT%H:%M:%S%z")

if [ "$USE_TEXTBOOK" -eq 1 ]; then
  TARGET_LABEL="textbook=\"${TARGET}\""
  TARGET_FLAGS_TEMPLATE='--textbook "%s"'
else
  TARGET_LABEL="order=\"${TARGET}\""
  TARGET_FLAGS_TEMPLATE='"%s"'
fi

printf '%s\tMULTI_START\tloop-multi\tcount=%d\t%s\n' "$START_ISO" "$COUNT" "$TARGET_LABEL" >> "$LOG_FILE"

echo "▶ ${COUNT}개 세션 병렬 시작 — Terminal.app 창이 ${COUNT}개 열립니다."
echo "  • 시작 시각: $START_ISO"
echo "  • 대상: $TARGET_LABEL"
echo "  • 로그: $LOG_FILE"
echo

i=1
while [ "$i" -le "$COUNT" ]; do
  SEED="session-${i}"
  echo "  • 창 ${i}: seed=${SEED}"
  ESCAPED_TARGET="${TARGET//\'/\'\\\'\'}"
  if [ "$USE_TEXTBOOK" -eq 1 ]; then
    CMD_LINE="cd '$PROJECT_ROOT' && './scripts/run-variant-loop.sh' --seed '$SEED' --textbook '$ESCAPED_TARGET'"
  else
    CMD_LINE="cd '$PROJECT_ROOT' && './scripts/run-variant-loop.sh' --seed '$SEED' '$ESCAPED_TARGET'"
  fi
  /usr/bin/osascript <<APPLESCRIPT
tell application "Terminal"
  activate
  do script "$CMD_LINE"
end tell
APPLESCRIPT
  i=$((i + 1))
done

echo
echo "✅ ${COUNT}개 창 열림. 각 창에서 claude 가 자동 진행합니다."
echo
echo "📊 작업 시간 확인:"
echo "   • 각 창 마무리에 시작·종료·소요 박스가 표시됩니다."
echo "   • 공용 로그: tail -f $LOG_FILE"
echo "   • 끝난 작업 요약:  grep -E 'DONE|MULTI_START' $LOG_FILE | tail -20"
echo "   • 진행 확인:      npm run cc:variant -- shortage --order-number \"$TARGET\""
