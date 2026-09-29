#!/usr/bin/env bash
# [맥] CPU·메모리 수집기(ml/worker/machine_stats.py)를 로그인 때 띄우고 계속 돌린다(LaunchAgent, 20초 간격).
#   ./ml/worker/register_machine_stats_launchd.sh            등록하고 시작
#   ./ml/worker/register_machine_stats_launchd.sh --remove   해제
set -euo pipefail
LABEL="com.gomijoshua.machine-stats"
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "${DIR}/../.." && pwd)"
PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
DOMAIN="gui/$(id -u)"
VENV="${ROOT}/ml/topic/.venv"
if [[ "${1:-}" == "--remove" ]]; then launchctl bootout "${DOMAIN}/${LABEL}" 2>/dev/null || true; rm -f "${PLIST}"; echo "removed: ${LABEL}"; exit 0; fi
mkdir -p "${HOME}/Library/LaunchAgents" "${DIR}/logs"
cat > "${PLIST}" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${VENV}/bin/python</string><string>${DIR}/machine_stats.py</string></array>
  <key>WorkingDirectory</key><string>${ROOT}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardErrorPath</key><string>${DIR}/logs/machine_stats.err</string>
</dict>
</plist>
PLIST
launchctl bootout "${DOMAIN}/${LABEL}" 2>/dev/null || true
launchctl bootstrap "${DOMAIN}" "${PLIST}"
echo "registered: ${LABEL}"
