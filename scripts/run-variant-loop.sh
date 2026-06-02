#!/usr/bin/env bash
# 변형문제 자동 채움 루프를 한 줄로 시작 (Pro 전용 · 완전 자동).
#
# 사용:
#   ./scripts/run-variant-loop.sh "BV-20260601-001"
#   ./scripts/run-variant-loop.sh --textbook "Booster 어법어휘"
#   ./scripts/run-variant-loop.sh --seed session-A "BV-20260601-001"
#
# 동작:
#   1. 현재 터미널에서 claude 를 띄움 (--dangerously-skip-permissions: 권한 프롬프트 모두 우회).
#   2. 첫 메시지로 scripts/cc-variant-loop-prompt.md 워크플로우 호출.
#   3. ScheduleWakeup 60~120s 자동 재진입 — 사람 개입 0 회.
#   4. 모든 슬롯이 채워지면 {done:true} 후 사용자 알림하고 종료.
#
# 주의:
#   --dangerously-skip-permissions 가 켜진 세션은 권한 확인을 건너뛴다.
#   loop 프롬프트가 cc:variant CLI 호출과 .variant-drafts/ 쓰기로만 제한하지만,
#   에이전트가 룰을 어기고 다른 명령을 실행할 가능성이 0 은 아니다 (낮음).

set -euo pipefail

SEED=""
TARGET=""
USE_TEXTBOOK=0

while [ $# -gt 0 ]; do
  case "$1" in
    --seed)
      shift
      SEED="${1:-}"
      shift || true
      ;;
    --seed=*)
      SEED="${1#*=}"
      shift
      ;;
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
  ./scripts/run-variant-loop.sh "BV-20260601-001"             # 주문번호
  ./scripts/run-variant-loop.sh --textbook "Booster 어법어휘" # 교재명
  ./scripts/run-variant-loop.sh --seed session-A "BV-…"      # 시드 지정

예:
  ./scripts/run-variant-loop.sh "BV-20260601-001"
  ./scripts/run-variant-loop.sh --seed session-A "BV-20260601-001"

여러 세션 병렬:
  ./scripts/run-variant-loop-multi.sh 4 "BV-20260601-001"
EOF
      exit 1
      ;;
    *)
      TARGET="$1"
      shift
      ;;
  esac
done

if [ -z "$TARGET" ]; then
  echo "❌ 주문번호 또는 --textbook \"교재명\" 이 필요합니다." >&2
  exit 1
fi

# 프로젝트 루트로 이동 — claude 가 CLAUDE.md / .claude/settings.local.json / .env.local 을 자연스럽게 찾도록.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# claude CLI 존재 확인.
if ! command -v claude >/dev/null 2>&1; then
  echo "❌ 'claude' 명령을 찾을 수 없습니다. Claude Code 가 설치되어 있는지 확인하세요."
  echo "    https://docs.claude.com/en/docs/claude-code/setup"
  exit 1
fi

# 첫 cycle 프롬프트 구성
if [ "$USE_TEXTBOOK" -eq 1 ]; then
  TARGET_PHRASE="교재 \"${TARGET}\""
else
  TARGET_PHRASE="주문 \"${TARGET}\""
fi

SEED_PHRASE=""
if [ -n "$SEED" ]; then
  SEED_PHRASE=" (seed=${SEED}-1)"
fi

INITIAL_PROMPT="@scripts/cc-variant-loop-prompt.md 워크플로우대로 ${TARGET_PHRASE} 1 cycle 돌려줘${SEED_PHRASE}."

# ── 로그 디렉터리 ─────────────────────────────────────────
LOG_DIR="$PROJECT_ROOT/.variant-loop-logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/runs.log"

START_TS=$(date +%s)
START_ISO=$(date -Iseconds 2>/dev/null || date +"%Y-%m-%dT%H:%M:%S%z")

echo "▶ 「${TARGET}」 변형문 자동 채움 루프 시작"
echo "  • 시작 시각: $START_ISO"
echo "  • 시드: ${SEED:-(없음 — random)}"
echo "  • 권한 프롬프트: 우회 (--dangerously-skip-permissions)"
echo "  • 사이클: ScheduleWakeup 60~120s 자동"
echo "  • 멈춤 조건: {done:true} 도달 또는 검증 실패"
echo "  • 로그: $LOG_FILE"
echo
echo "  중단하려면 Ctrl+C 두 번 (claude 정상 종료)."
echo

printf '%s\tSTART\tloop\t%s\tseed=%s\n' "$START_ISO" "$TARGET" "$SEED" >> "$LOG_FILE"

# claude 실행 — exec 안 씀 (끝난 뒤 elapsed 출력하려면 셸이 살아 있어야 함)
set +e
claude --dangerously-skip-permissions "$INITIAL_PROMPT"
RC=$?
set -e

END_TS=$(date +%s)
END_ISO=$(date -Iseconds 2>/dev/null || date +"%Y-%m-%dT%H:%M:%S%z")
ELAPSED=$((END_TS - START_TS))
ELAPSED_HMS=$(printf '%dh %02dm %02ds' $((ELAPSED/3600)) $(((ELAPSED%3600)/60)) $((ELAPSED%60)))

echo
echo "════════════════════════════════════════════════════════════════"
echo "✅ 「${TARGET}」 자동 채움 종료"
echo "   시작:    $START_ISO"
echo "   종료:    $END_ISO"
echo "   소요:    $ELAPSED_HMS  (${ELAPSED}s)"
echo "   exit:    $RC"
echo "   로그:    $LOG_FILE"
echo "════════════════════════════════════════════════════════════════"
echo

printf '%s\tDONE\tloop\t%s\telapsed_s=%d\telapsed=%s\trc=%d\tseed=%s\n' \
  "$END_ISO" "$TARGET" "$ELAPSED" "$ELAPSED_HMS" "$RC" "$SEED" >> "$LOG_FILE"

HOLD_SEC="${VARIANT_HOLD_AFTER_DONE_SEC:-300}"
if [ "$HOLD_SEC" -gt 0 ]; then
  echo "Enter 키를 누르면 창을 닫습니다 (또는 ${HOLD_SEC}초 후 자동 종료, ⌘W 로 즉시 닫기)..."
  read -t "$HOLD_SEC" -r || true
fi

exit "$RC"
