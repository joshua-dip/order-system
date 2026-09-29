#!/usr/bin/env bash
# [맥] 웹에서 워커 켜기·끄기를 처리하는 작은 프로그램을 늘 띄워 둔다(모델 없음). --remove 로 해제
# 로그: ml/worker/logs/worker_control.log
set -euo pipefail
LABEL="com.gomijoshua.worker-control"
DIR="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "${DIR}/../.." && pwd)"
PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"; DOMAIN="gui/$(id -u)"
VENV="${LOCAL_VARIANT_VENV:-${ROOT}/ml/topic/.venv}"
if [[ "${1:-}" == "--remove" ]]; then launchctl bootout "${DOMAIN}/${LABEL}" 2>/dev/null || true; rm -f "${PLIST}"; echo "removed: ${LABEL}"; exit 0; fi
mkdir -p "${HOME}/Library/LaunchAgents" "${DIR}/logs"
cat > "${PLIST}" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array><string>${VENV}/bin/python</string><string>${DIR}/worker_control.py</string></array>
  <key>WorkingDirectory</key><string>${ROOT}</string>
  <key>EnvironmentVariables</key><dict><key>PYTHONUNBUFFERED</key><string>1</string><key>PATH</key><string>/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${DIR}/logs/worker_control.log</string>
  <key>StandardErrorPath</key><string>${DIR}/logs/worker_control.log</string>
</dict></plist>
PLIST
launchctl bootout "${DOMAIN}/${LABEL}" 2>/dev/null || true
launchctl bootstrap "${DOMAIN}" "${PLIST}"
echo "registered: ${LABEL}"
