#!/usr/bin/env bash
# 여러 교재를 각각 새 Terminal 창에서 병렬로 자동 채움 시작 (macOS 전용).
#
# 사용:
#   ./scripts/run-essay-loop-multi.sh "교재1" "교재2" "교재3" ...
#
# 예:
#   ./scripts/run-essay-loop-multi.sh \
#     "25년 3월 고1 영어모의고사" \
#     "26년 3월 고3 영어모의고사" \
#     "24년 6월 고1 영어모의고사"
#
# 각 교재마다 새 Terminal.app 창이 열리고, 그 안에서 ./scripts/run-essay-loop.sh 가 실행된다.
# 8 개까지 동시 실행해도 Anthropic 한도 안이면 무리 없음. 다만 같은 교재를 두 창에서
# 동시에 돌리면 next-empty 가 같은 지문을 두 번 반환할 수 있으니 교재명이 겹치지 않도록 주의.

set -euo pipefail

ROUNDS=1
TEXTBOOKS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --rounds)
      shift
      ROUNDS="${1:-1}"
      shift || true
      ;;
    --rounds=*)
      ROUNDS="${1#*=}"
      shift
      ;;
    *)
      TEXTBOOKS+=("$1")
      shift
      ;;
  esac
done

if [ ${#TEXTBOOKS[@]} -lt 1 ]; then
  cat <<'EOF'
사용법: ./scripts/run-essay-loop-multi.sh [--rounds N] "교재1" "교재2" ...

옵션:
  --rounds N        각 난이도 N 건씩 채움 (기본 1). N=4 면 한 지문에 16 건 만들고 종료.

예:
  ./scripts/run-essay-loop-multi.sh \
    "25년 3월 고1 영어모의고사" \
    "26년 3월 고3 영어모의고사" \
    "24년 6월 고1 영어모의고사"

  ./scripts/run-essay-loop-multi.sh --rounds 4 \
    "26년 3월 고1 영어모의고사"

플랫폼:
  • macOS 의 Terminal.app 만 지원. iTerm 사용자는 직접 8 개 탭 열고
    각각 ESSAY_TARGET_PER_DIFFICULTY=N ./scripts/run-essay-loop.sh "..." 실행 권장.
EOF
  exit 1
fi

set -- "${TEXTBOOKS[@]}"

if [[ "$(uname)" != "Darwin" ]]; then
  echo "❌ 이 스크립트는 macOS 전용입니다. Linux 라면 tmux 로 새 창 열어 직접 호출하세요."
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SINGLE="$PROJECT_ROOT/scripts/run-essay-loop.sh"

if [[ ! -x "$SINGLE" ]]; then
  chmod +x "$SINGLE"
fi

LOG_DIR="$PROJECT_ROOT/.essay-audit-logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/runs.log"
START_ISO=$(date -Iseconds 2>/dev/null || date +"%Y-%m-%dT%H:%M:%S%z")
JOINED_TB=$(printf '%s|' "$@"); JOINED_TB="${JOINED_TB%|}"
printf '%s\tMULTI_START\tloop-multi\tcount=%d\trounds=%s\ttextbooks=%s\n' "$START_ISO" "$#" "$ROUNDS" "$JOINED_TB" >> "$LOG_FILE"

echo "▶ ${#}개 교재 병렬 시작 — Terminal.app 창이 ${#} 개 열립니다."
echo "  • 시작 시각: $START_ISO"
echo "  • 회분 수: 각 난이도 ${ROUNDS} 건씩"
echo "  • 로그: $LOG_FILE"
for TB in "$@"; do
  echo "  • ${TB}"
  # AppleScript 안에서 single-quote 충돌을 피하려고 더블 quote 로 감싸고
  # 교재명의 single-quote 는 \\'\\' 로 escape (드물지만 안전장치).
  ESCAPED_TB="${TB//\'/\'\\\'\'}"
  /usr/bin/osascript <<APPLESCRIPT
tell application "Terminal"
  activate
  do script "cd '$PROJECT_ROOT' && ESSAY_TARGET_PER_DIFFICULTY='$ROUNDS' './scripts/run-essay-loop.sh' '$ESCAPED_TB'"
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
