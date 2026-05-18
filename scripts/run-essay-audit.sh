#!/usr/bin/env bash
# 서술형 audit-content ERROR 자동 검증·개선 (Pro 전용 · 완전 자동).
#
# 사용:
#   ./scripts/run-essay-audit.sh "교재명"
#
# 예:
#   ./scripts/run-essay-audit.sh "24년 6월 고1 영어모의고사"
#
# 동작:
#   1. 현재 터미널에서 claude 를 띄움 (--dangerously-skip-permissions: 권한 프롬프트 우회).
#   2. 첫 메시지로 scripts/cc-essay-audit-prompt.md 워크플로우 호출 — 해당 교재의
#      audit-content ERROR 를 모두 0 이 될 때까지 자동 검증·개선.
#   3. ERROR 가 0 이면 사용자에게 알림 후 종료.
#
# 주의:
#   - --dangerously-skip-permissions 가 켜진 세션은 권한 확인을 건너뛴다.
#   - 에이전트가 essay_exams 컬렉션의 conditions / structure_analysis / intent_content 를
#     수정하고 HTML 을 재빌드한다. ERROR 없는 항목은 건드리지 않도록 prompt 에 명시되어 있다.

set -euo pipefail

if [ $# -lt 1 ]; then
  cat <<'EOF'
사용법: ./scripts/run-essay-audit.sh "<교재명>"

예:
  ./scripts/run-essay-audit.sh "24년 6월 고1 영어모의고사"
  ./scripts/run-essay-audit.sh "25년 3월 고1 영어모의고사"
EOF
  exit 1
fi

TEXTBOOK="$1"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

if ! command -v claude >/dev/null 2>&1; then
  echo "❌ 'claude' 명령을 찾을 수 없습니다. Claude Code 가 설치되어 있는지 확인하세요."
  echo "    https://docs.claude.com/en/docs/claude-code/setup"
  exit 1
fi

INITIAL_PROMPT="@scripts/cc-essay-audit-prompt.md 워크플로우대로 교재 \"${TEXTBOOK}\" 의 audit-content ERROR 를 모두 검증·개선해. ERROR 가 0 이 될 때까지 반복."

# ── 로그 디렉터리 ─────────────────────────────────────────
LOG_DIR="$PROJECT_ROOT/.essay-audit-logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/runs.log"

START_TS=$(date +%s)
START_ISO=$(date -Iseconds 2>/dev/null || date +"%Y-%m-%dT%H:%M:%S%z")

echo "▶ 「${TEXTBOOK}」 audit-content 자동 검증·개선 시작"
echo "  • 시작 시각: $START_ISO"
echo "  • 권한 프롬프트: 우회 (--dangerously-skip-permissions)"
echo "  • 종료 조건: 모든 ERROR 0 도달 또는 명시적 실패"
echo "  • ERROR 없는 항목은 건드리지 않음"
echo "  • 로그: $LOG_FILE"
echo
echo "  중단하려면 Ctrl+C 두 번 (claude 정상 종료)."
echo

printf '%s\tSTART\taudit\t%s\n' "$START_ISO" "$TEXTBOOK" >> "$LOG_FILE"

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
echo "✅ 「${TEXTBOOK}」 audit 종료"
echo "   시작:    $START_ISO"
echo "   종료:    $END_ISO"
echo "   소요:    $ELAPSED_HMS  (${ELAPSED}s)"
echo "   exit:    $RC"
echo "   로그:    $LOG_FILE"
echo "════════════════════════════════════════════════════════════════"
echo

printf '%s\tDONE\taudit\t%s\telapsed_s=%d\telapsed=%s\trc=%d\n' \
  "$END_ISO" "$TEXTBOOK" "$ELAPSED" "$ELAPSED_HMS" "$RC" >> "$LOG_FILE"

# 창 자동 닫힘 방지 — 환경변수 AUDIT_HOLD_AFTER_DONE_SEC 으로 대기 시간 조절 (기본 300초). 0 이면 즉시 종료.
HOLD_SEC="${AUDIT_HOLD_AFTER_DONE_SEC:-300}"
if [ "$HOLD_SEC" -gt 0 ]; then
  echo "Enter 키를 누르면 창을 닫습니다 (또는 ${HOLD_SEC}초 후 자동 종료, ⌘W 로 즉시 닫기)..."
  read -t "$HOLD_SEC" -r || true
fi

exit "$RC"
