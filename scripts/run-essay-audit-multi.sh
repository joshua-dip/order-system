#!/usr/bin/env bash
# 여러 교재를 각각 새 Terminal 창에서 병렬로 audit-content 자동 검증·개선 (macOS 전용).
#
# 사용:
#   ./scripts/run-essay-audit-multi.sh "교재1" "교재2" "교재3" ...
#
# 예:
#   ./scripts/run-essay-audit-multi.sh \
#     "24년 6월 고1 영어모의고사" \
#     "25년 6월 고2 영어모의고사" \
#     "26년 3월 고1 영어모의고사"
#
# 각 교재마다 새 Terminal.app 창이 열리고, 그 안에서 ./scripts/run-essay-audit.sh 가 실행된다.

set -euo pipefail

if [ $# -lt 1 ]; then
  cat <<'EOF'
사용법: ./scripts/run-essay-audit-multi.sh "교재1" "교재2" ...

예:
  ./scripts/run-essay-audit-multi.sh \
    "24년 6월 고1 영어모의고사" \
    "25년 6월 고2 영어모의고사"

플랫폼:
  • macOS 의 Terminal.app 만 지원.
EOF
  exit 1
fi

if [[ "$(uname)" != "Darwin" ]]; then
  echo "❌ 이 스크립트는 macOS 전용입니다. Linux 라면 tmux 로 새 창 열어 직접 호출하세요."
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SINGLE="$PROJECT_ROOT/scripts/run-essay-audit.sh"

if [[ ! -x "$SINGLE" ]]; then
  chmod +x "$SINGLE"
fi

LOG_DIR="$PROJECT_ROOT/.essay-audit-logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/runs.log"
START_ISO=$(date -Iseconds 2>/dev/null || date +"%Y-%m-%dT%H:%M:%S%z")
JOINED_TB=$(printf '%s|' "$@"); JOINED_TB="${JOINED_TB%|}"
printf '%s\tMULTI_START\taudit-multi\tcount=%d\ttextbooks=%s\n' "$START_ISO" "$#" "$JOINED_TB" >> "$LOG_FILE"

echo "▶ ${#}개 교재 audit 병렬 시작 — Terminal.app 창이 ${#} 개 열립니다."
echo "  • 시작 시각: $START_ISO"
echo "  • 로그: $LOG_FILE"
for TB in "$@"; do
  echo "  • ${TB}"
  ESCAPED_TB="${TB//\'/\'\\\'\'}"
  /usr/bin/osascript <<APPLESCRIPT
tell application "Terminal"
  activate
  do script "cd '$PROJECT_ROOT' && './scripts/run-essay-audit.sh' '$ESCAPED_TB'"
end tell
APPLESCRIPT
done

echo
echo "✅ ${#}개 창 열림. 각 창에서 claude 가 자동 진행합니다."
echo
echo "📊 작업 시간 확인:"
echo "   • 각 창 마무리에 시작·종료·소요 박스가 표시됩니다."
echo "   • 공용 로그: tail -f $LOG_FILE"
echo "   • 끝난 작업 요약:  grep -E 'DONE|MULTI_START' $LOG_FILE | tail -20"
