#!/bin/bash
# Wait until no Playwright browser process belongs to another research line.
DEADLINE=$(( $(date +%s) + ${1:-1500} ))
while :; do
  FOUND=""
  for p in $(ls /proc | grep -E '^[0-9]+$'); do
    CMD=$(tr '\0' ' ' < /proc/$p/cmdline 2>/dev/null)
    case "$CMD" in
      *headless_shell*|*chromium*) ;;
      *) continue ;;
    esac
    case "$CMD" in *--type=*) continue ;; esac
    # owner chain
    PP=$(awk '{print $4}' /proc/$p/stat 2>/dev/null)
    CHAIN=""
    for i in 1 2 3 4 5 6; do
      [ -z "$PP" ] && break; [ "$PP" -le 1 ] 2>/dev/null && break
      C=$(tr '\0' ' ' < /proc/$PP/cmdline 2>/dev/null | cut -c1-110)
      CHAIN="$CHAIN | $PP:$C"
      PP=$(awk '{print $4}' /proc/$PP/stat 2>/dev/null)
    done
    case "$CHAIN" in
      *measure.mjs*) ;;   # ours
      *) FOUND="$FOUND\n  browser=$p$CHAIN" ;;
    esac
  done
  if [ -z "$FOUND" ]; then echo "FOREIGN_IDLE at $(date -Is)"; exit 0; fi
  if [ "$(date +%s)" -ge "$DEADLINE" ]; then echo "WAIT_TIMEOUT at $(date -Is)"; printf "$FOUND\n"; exit 2; fi
  echo "waiting $(date +%H:%M:%S) - foreign browsers present:$(printf "$FOUND")"
  sleep 25
done
