#!/bin/bash
# Poll until no foreign Playwright browser instance exists. Browser is NOT started while waiting.
DEADLINE=$(( $(date +%s) + ${1:-540} ))
while :; do
  N=0; OWNERS=""
  for p in $(ls /proc 2>/dev/null | grep -E '^[0-9]+$'); do
    CMD=$(tr '\0' ' ' < /proc/$p/cmdline 2>/dev/null) || continue
    case "$CMD" in *headless_shell*|*chromium*) ;; *) continue ;; esac
    case "$CMD" in *--type=*) continue ;; esac
    N=$((N+1))
    PP=$(awk '{print $4}' /proc/$p/stat 2>/dev/null)
    for i in 1 2 3 4; do
      [ -z "$PP" ] && break; [ "$PP" -le 1 ] 2>/dev/null && break
      O=$(tr '\0' ' ' < /proc/$PP/cmdline 2>/dev/null | grep -oE '[A-Za-z0-9_./-]+\.mjs' | head -1)
      [ -n "$O" ] && OWNERS="$OWNERS $O" && break
      PP=$(awk '{print $4}' < /proc/$PP/stat 2>/dev/null)
    done
  done
  HS=$(pgrep -c -f headless_shell 2>/dev/null || echo 0)
  if [ "$N" -eq 0 ]; then echo "IDLE now=$(date +%H:%M:%S) headless_shell=$HS"; exit 0; fi
  if [ "$(date +%s)" -ge "$DEADLINE" ]; then echo "POLL_DEADLINE now=$(date +%H:%M:%S) instances=$N headless_shell=$HS owners=$OWNERS"; exit 3; fi
  echo "poll $(date +%H:%M:%S) instances=$N headless_shell=$HS owners=$(echo $OWNERS | tr ' ' '\n' | sort -u | tr '\n' ' ')"
  sleep 12
done
