#!/bin/bash
# Poll for a GENUINELY quiet window (other agents' headless Chromium absent or
# near-idle, confirmed over 3 consecutive 1 Hz samples), then repeat the KEY
# measurements there, with 1 Hz AMD iGPU busy% sampling throughout.
# Read-only observation: never signals any process.
cd /home/CNS2026495165/dsh/.workspace/lag-fix/incident2/cross-app/costmodel || exit 1
HS=/home/CNS2026495165/.cache/ms-playwright/chromium_headless_shell-1148/chrome-linux/headless_shell
URL="file://$PWD/repro.html"
CSV="$PWD/confound-gpu-log2.csv"
STATUS="$PWD/confound-status2.txt"
V="baseline,ripple-r50,ripple-r400,ripple-r800,ripple-dom-r400,tray-layout,tray-transform"

rm -f "$CSV" "$STATUS"
# args: csv status duration mine_marker quiet_proc_cpu% quiet_streak
/usr/bin/python3 sampler.py "$CSV" "$STATUS" 660 costmodel 5.0 3 &
SPID=$!

echo "=== PHASE A: polling for a SETTLED quiet window (up to 540s, need 3 clean samples) ==="
QUIET=0
for i in $(seq 1 180); do
  if [ -f "$STATUS" ]; then
    S=$(cat "$STATUS")
    if [ $((i % 7)) -eq 1 ]; then echo "[poll $((i*3))s] $S"; fi
    case "$S" in CHROMIUM_QUIET*) QUIET=1; echo "[poll $((i*3))s] *** SETTLED QUIET WINDOW: $S"; break;; esac
  fi
  sleep 3
done
echo "QUIET_FOUND=$QUIET"
echo "status at decision: $(cat "$STATUS" 2>/dev/null)"

if [ "$QUIET" = "1" ]; then
  export EXTRA_FLAGS="--disable-frame-rate-limit --disable-gpu-vsync" ONLY="$V"
  echo "=== PHASE B: 5K key measurements in quiet window ==="
  /usr/bin/node driver.mjs "$HS" "$URL" 5120 2880 19761 \
      "$PWD/result-5120-quiet2.json" "$PWD/prof-5120-quiet2" 2>&1 | tail -12
  S2=$(cat "$STATUS" 2>/dev/null)
  echo "status after 5K run: $S2"
  sleep 6
  S3=$(cat "$STATUS" 2>/dev/null)
  echo "status after 6s settle: $S3"
  case "$S3" in CHROMIUM_QUIET*)
    echo "=== PHASE C: 720p key measurements still quiet ==="
    /usr/bin/node driver.mjs "$HS" "$URL" 1280 720 19762 \
        "$PWD/result-1280-quiet2.json" "$PWD/prof-1280-quiet2" 2>&1 | tail -12
    ;;
  *) echo "*** 720p phase skipped: window no longer quiet after the 5K run" ;;
  esac
else
  echo "*** NO SETTLED QUIET WINDOW within 540s -- no repeat measurement taken (per instruction)"
fi

echo "=== PHASE D: analysis of the 1 Hz log ==="
wait $SPID
echo "sampler finished"
