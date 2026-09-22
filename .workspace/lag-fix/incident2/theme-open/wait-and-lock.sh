#!/usr/bin/env bash
# Take the cross-line probe lock the moment it frees, then hand off to the batch.
# Respects the protocol: never preempts a live owner; only waits.
set -u
LOCK=/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/.probe.lock
AGENT=incident2-theme-open
DEADLINE=$(( $(date +%s) + 2400 ))
while :; do
  browsers=$(ps -eo cmd --no-headers | grep -- "--remote-debugging-pipe" | grep -vc -- "--type=" )
  browsers=$(ps -eo cmd --no-headers | grep -- "--remote-debugging-pipe" | grep -v -- "--type=" | grep -vc grep)
  if [ ! -d "$LOCK" ] && [ "$browsers" -eq 0 ]; then
    if mkdir "$LOCK" 2>/dev/null; then
      printf 'agent=%s\npid=%s\nstarted_at=%s\nline=incident2/theme-open (fresh-page settings-click theme-chain audit)\n' \
        "$AGENT" "$$" "$(date '+%F %T %Z')" > "$LOCK/owner.txt"
      echo "ACQUIRED $(date '+%F %T') browsers=$browsers"
      exit 0
    fi
  fi
  now=$(date +%s)
  if [ "$now" -ge "$DEADLINE" ]; then echo "TIMEOUT waiting for lock at $(date '+%F %T')"; exit 2; fi
  echo "[$(date '+%H:%M:%S')] waiting: lockDir=$([ -d "$LOCK" ] && echo present || echo absent) foreignBrowsers=$browsers"
  sleep 15
done
