#!/usr/bin/env bash
# 서술형 자동 채움 루프를 한 줄로 시작 (Pro 전용 · 완전 자동).
#
# 사용:
#   ./scripts/run-essay-loop.sh "교재명"
#
# 예:
#   ./scripts/run-essay-loop.sh "25년 3월 고1 영어모의고사"
#
# 동작:
#   1. 현재 터미널에서 claude 를 띄움 (--dangerously-skip-permissions: 권한 프롬프트 모두 우회).
#   2. 첫 메시지로 scripts/cc-essay-loop-prompt.md 워크플로우 호출.
#   3. ScheduleWakeup 으로 10 분 간격 자동 재진입 — 사람 개입 0 회.
#   4. 모든 빈 지문이 채워지면 {done:true} 후 사용자 알림하고 종료.
#
# 주의:
#   --dangerously-skip-permissions 가 켜진 세션은 권한 확인을 건너뛴다.
#   loop 프롬프트가 cc:essay CLI 호출과 .essay-drafts/ 쓰기로만 제한하지만,
#   에이전트가 룰을 어기고 다른 명령을 실행할 가능성이 0 은 아니다 (낮음).

set -euo pipefail

if [ $# -lt 1 ]; then
  cat <<'EOF'
사용법: ./scripts/run-essay-loop.sh "<교재명>"

예:
  ./scripts/run-essay-loop.sh "25년 3월 고1 영어모의고사"
  ./scripts/run-essay-loop.sh "26년 3월 고3 영어모의고사"

여러 교재를 병렬로 돌리려면:
  ./scripts/run-essay-loop-multi.sh "교재1" "교재2" "교재3" ...
EOF
  exit 1
fi

TEXTBOOK="$1"

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

ROUNDS="${ESSAY_TARGET_PER_DIFFICULTY:-1}"
INITIAL_PROMPT="@scripts/cc-essay-loop-prompt.md 워크플로우대로 교재 \"${TEXTBOOK}\" 1 cycle 돌려줘 (target_per_difficulty=${ROUNDS})."

# ── 로그 디렉터리 ─────────────────────────────────────────
LOG_DIR="$PROJECT_ROOT/.essay-audit-logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/runs.log"

START_TS=$(date +%s)
START_ISO=$(date -Iseconds 2>/dev/null || date +"%Y-%m-%dT%H:%M:%S%z")

echo "▶ 「${TEXTBOOK}」 서술형 자동 채움 루프 시작"
echo "  • 시작 시각: $START_ISO"
echo "  • 회분 수: 각 난이도 ${ROUNDS} 건씩 (target_per_difficulty=${ROUNDS}; ESSAY_TARGET_PER_DIFFICULTY env 로 조절)"
echo "  • 권한 프롬프트: 우회 (--dangerously-skip-permissions)"
echo "  • 사이클: ScheduleWakeup 10 분 간격 자동"
echo "  • 멈춤 조건: {done:true} 도달 또는 검증 실패"
echo "  • 로그: $LOG_FILE"
echo
echo "  중단하려면 Ctrl+C 두 번 (claude 정상 종료)."
echo

printf '%s\tSTART\tloop\t%s\n' "$START_ISO" "$TEXTBOOK" >> "$LOG_FILE"

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
echo "✅ 「${TEXTBOOK}」 자동 채움 종료"
echo "   시작:    $START_ISO"
echo "   종료:    $END_ISO"
echo "   소요:    $ELAPSED_HMS  (${ELAPSED}s)"
echo "   exit:    $RC"
echo "   로그:    $LOG_FILE"
echo "════════════════════════════════════════════════════════════════"
echo

printf '%s\tDONE\tloop\t%s\telapsed_s=%d\telapsed=%s\trc=%d\n' \
  "$END_ISO" "$TEXTBOOK" "$ELAPSED" "$ELAPSED_HMS" "$RC" >> "$LOG_FILE"

HOLD_SEC="${AUDIT_HOLD_AFTER_DONE_SEC:-300}"
if [ "$HOLD_SEC" -gt 0 ]; then
  echo "Enter 키를 누르면 창을 닫습니다 (또는 ${HOLD_SEC}초 후 자동 종료, ⌘W 로 즉시 닫기)..."
  read -t "$HOLD_SEC" -r || true
fi

exit "$RC"
