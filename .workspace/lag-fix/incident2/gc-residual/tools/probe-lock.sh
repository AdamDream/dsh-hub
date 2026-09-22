#!/usr/bin/env bash
# Cross-line browser-probe exclusive lock (same directory as the other lines: research-v2/.probe.lock).
#  - atomic `mkdir` acquisition; retry every 20-40s up to MAX_WAIT
#  - preemption gate: ONLY when owner age > 25 min AND owner pid is gone (accounted)
#  - release order: rm owner.txt FIRST, then rmdir (rmdir silently fails on a non-empty dir)
# Usage: probe-lock.sh acquire <agent> [owner_pid] | probe-lock.sh release <agent> | probe-lock.sh status [agent]
#
# FIX (auditor S3): previously owner pid was `$$` of this short-lived script, which is dead
# milliseconds after acquisition => other lines' pid-absence preemption could steal a live lock.
# The caller now passes the PID of the long-lived supervisor (run-locked.sh) as [owner_pid];
# both `pid=` and `owner_pid=` are written, and parsing accepts `key=value`, `key: value` and
# `key=value extra` single-line formats with a numeric anchor.
set -u
LOCK="/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/.probe.lock"
AGENT="${2:-gc-residual}"
OWNER_PID="${3:-$$}"
MODE="${1:-status}"
MAX_WAIT="${MAX_WAIT:-1800}"
STALE_SECS=1500

owner_field() { # $1 = key name; returns first numeric/ISO token after key= or key:
  sed -n -E "s/^[[:space:]]*$1[=:][[:space:]]*([^[:space:]]+).*/\1/p" "$LOCK/owner.txt" 2>/dev/null | head -1
}

case "$MODE" in
  status)
    if [ -d "$LOCK" ]; then echo "HELD"; cat "$LOCK/owner.txt" 2>/dev/null; else echo "FREE"; fi
    exit 0;;
  acquire)
    waited=0; attempt=0
    while :; do
      attempt=$((attempt+1))
      if mkdir "$LOCK" 2>/dev/null; then
        printf 'pid=%s\n' "$OWNER_PID" > "$LOCK/owner.txt"
        printf 'owner_pid=%s\n' "$OWNER_PID" >> "$LOCK/owner.txt"
        printf 'owner=%s\nts=%s\nstarted=%s\nstarted_at=%s\nstarted_epoch=%s\n' \
          "$AGENT" "$(date -Is)" "$(date -Is)" "$(date '+%F %T %Z')" "$(date +%s)" >> "$LOCK/owner.txt"
        printf 'line=gc-residual (GC observation + (program)/builtin share + five-bucket attribution)\n' >> "$LOCK/owner.txt"
        printf 'pid_writer=%s\nhost=%s\nheartbeat_epoch=%s\nattempts=%s\n' \
          "$$" "$(hostname)" "$(date +%s)" "$attempt" >> "$LOCK/owner.txt"
        echo "ACQUIRED on attempt $attempt after ${waited}s (owner_pid=$OWNER_PID)"; cat "$LOCK/owner.txt"; exit 0
      fi
      opid=$(owner_field pid)
      ostart=$(owner_field started)
      [ -z "$ostart" ] && ostart=$(owner_field started_at)
      [ -z "$ostart" ] && ostart=$(owner_field ts)
      age="?"; if [ -n "$ostart" ]; then s=$(date -d "$ostart" +%s 2>/dev/null || echo ""); [ -n "$s" ] && age=$(( $(date +%s) - s )); fi
      alive=no; if [ -n "$opid" ] && kill -0 "$opid" 2>/dev/null; then alive=yes; fi
      echo "[wait ${waited}s] held by pid=${opid:-?} age=${age}s alive=$alive owner=$(head -1 "$LOCK/owner.txt" 2>/dev/null)"
      if [ "$age" != "?" ] && [ "$age" -gt "$STALE_SECS" ] && [ "$alive" = "no" ]; then
        echo "PREEMPT: age ${age}s > ${STALE_SECS}s and pid ${opid} gone -> stealing"
        cp "$LOCK/owner.txt" "/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/gc-residual/raw/preempted-owner-$(date +%s).txt" 2>/dev/null
        rm -rf "$LOCK"; continue
      fi
      if [ "$waited" -ge "$MAX_WAIT" ]; then echo "TIMEOUT after ${waited}s; NOT stealing"; exit 2; fi
      sleep $(( 20 + RANDOM % 21 )); waited=$((waited+30))
    done;;
  heartbeat)
    if [ ! -d "$LOCK" ]; then echo "no lock"; exit 0; fi
    cur=$(owner_field owner)
    if [ "$cur" != "$AGENT" ]; then echo "REFUSE heartbeat: owner=$cur"; exit 4; fi
    if grep -q '^heartbeat_epoch=' "$LOCK/owner.txt"; then
      sed -i "s/^heartbeat_epoch=.*/heartbeat_epoch=$(date +%s)/" "$LOCK/owner.txt"
    else printf 'heartbeat_epoch=%s\n' "$(date +%s)" >> "$LOCK/owner.txt"; fi
    echo "heartbeat $(date -Is)";;
  release)
    if [ ! -d "$LOCK" ]; then echo "already free"; exit 0; fi
    cur=$(owner_field owner)
    if [ "$cur" != "$AGENT" ]; then
      echo "REFUSE: lock owner is '$cur', not '${AGENT}':"; cat "$LOCK/owner.txt" 2>/dev/null; exit 4
    fi
    rm -f "$LOCK/owner.txt"
    if rmdir "$LOCK" 2>/dev/null; then echo "RELEASED"; else
      # never leave a lock directory that nobody can preempt (no owner.txt => no age/pid):
      echo "WARN: rmdir failed; rewriting owner.txt so the lock stays attributable"; ls -la "$LOCK"
      printf 'pid=0\nowner=%s\nstarted=%s\nstarted_epoch=%s\nnote=rmdir-failed-leftover\n' "$AGENT" "$(date -Is)" "$(date +%s)" > "$LOCK/owner.txt"
      exit 5
    fi;;
  *) echo "usage: $0 acquire|release|status|heartbeat [agent] [owner_pid]"; exit 1;;
esac
