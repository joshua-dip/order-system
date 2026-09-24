#!/usr/bin/env bash
# [맥] 로그인하면 로컬 LoRA 워커를 백그라운드로 띄운다(LaunchAgent). 비정상 종료면 1분 뒤 다시 띄운다.
#   ./ml/worker/register_worker_launchd.sh            등록하고 바로 시작
#   ./ml/worker/register_worker_launchd.sh --remove   멈추고 등록 해제
# 로그: ml/worker/logs/worker.log · 상태: launchctl print gui/$(id -u)/com.gomijoshua.local-variant-worker
#
# ProcessType=Interactive — launchd 는 지정하지 않은 백그라운드 작업의 CPU·I/O 를 낮춰 잡을 수 있다.
# Windows 에선 작업 스케줄러 기본 우선순위·효율 모드 때문에 같은 코드가 5~9배 느렸다(#45). 맥에선 처음부터 막는다.
set -euo pipefail
LABEL="com.gomijoshua.local-variant-worker"
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "${DIR}/../.." && pwd)"
PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
DOMAIN="gui/$(id -u)"
VENV="${LOCAL_VARIANT_VENV:-${ROOT}/ml/topic/.venv}"

if [[ "${1:-}" == "--remove" ]]; then
  launchctl bootout "${DOMAIN}/${LABEL}" 2>/dev/null || true
  rm -f "${PLIST}"
  echo "removed: ${LABEL}"
  exit 0
fi

if [[ ! -x "${VENV}/bin/python" ]]; then
  echo "venv 없음: ${VENV} — ml/worker/start_worker.sh 의 안내대로 먼저 만드세요." >&2
  exit 1
fi
mkdir -p "${HOME}/Library/LaunchAgents" "${DIR}/logs"

cat > "${PLIST}" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${VENV}/bin/python</string>
    <string>${DIR}/local_variant_worker.py</string>
    <string>--log-file</string>
    <string>${DIR}/logs/worker.log</string>
  </array>
  <key>WorkingDirectory</key><string>${ROOT}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PYTHONUNBUFFERED</key><string>1</string>
    <key>PYTHONUTF8</key><string>1</string>
    <key>PYTHONIOENCODING</key><string>utf-8</string>
    <key>PATH</key><string>/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>60</integer>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>${DIR}/logs/launchd.out.log</string>
  <key>StandardErrorPath</key><string>${DIR}/logs/launchd.err.log</string>
</dict>
</plist>
PLIST
plutil -lint "${PLIST}" >/dev/null

launchctl bootout "${DOMAIN}/${LABEL}" 2>/dev/null || true
launchctl bootstrap "${DOMAIN}" "${PLIST}"
echo "registered: ${LABEL} (로그인 때 시작, 비정상 종료 시 1분 뒤 재시작)"
echo "log: ${DIR}/logs/worker.log"
