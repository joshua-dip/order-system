#!/usr/bin/env bash
# [맥] 워커 자동 공급기(ml/production/autofeed.ts)를 5분마다 실행한다(LaunchAgent). 모델은 올리지 않는다.
#   ./ml/production/register_autofeed_launchd.sh            등록하고 바로 한 번 실행
#   ./ml/production/register_autofeed_launchd.sh --remove   해제
# 로그: ml/production/batches/autofeed/autofeed.log (+ launchd.out/err) · 예약·상태는 비공개 트래커 「다음에 만들 교재」
set -euo pipefail
LABEL="com.gomijoshua.variant-autofeed"
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "${DIR}/../.." && pwd)"
PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
DOMAIN="gui/$(id -u)"
NODE_BIN="$(dirname "$(command -v node)")"
OUT="${ROOT}/ml/production/batches/autofeed"

if [[ "${1:-}" == "--remove" ]]; then
  launchctl bootout "${DOMAIN}/${LABEL}" 2>/dev/null || true
  rm -f "${PLIST}"
  echo "removed: ${LABEL}"
  exit 0
fi
mkdir -p "${HOME}/Library/LaunchAgents" "${OUT}"
cat > "${PLIST}" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}/node</string>
    <string>${ROOT}/node_modules/.bin/tsx</string>
    <string>${ROOT}/ml/production/autofeed.ts</string>
  </array>
  <key>WorkingDirectory</key><string>${ROOT}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${NODE_BIN}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string></dict>
  <key>StartInterval</key><integer>300</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${OUT}/launchd.out</string>
  <key>StandardErrorPath</key><string>${OUT}/launchd.err</string>
</dict>
</plist>
PLIST
launchctl bootout "${DOMAIN}/${LABEL}" 2>/dev/null || true
launchctl bootstrap "${DOMAIN}" "${PLIST}"
echo "registered: ${LABEL} (5분마다)"
