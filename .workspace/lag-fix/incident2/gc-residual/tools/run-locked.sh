#!/usr/bin/env bash
# run-locked.sh — hold the cross-line probe lock for the whole browser run.
# Order: wait/acquire lock -> smoke (short, validates every instrument) -> full campaign -> release.
# Never preempts a live owner; release is rm owner.txt then rmdir.
#
# FIX (auditor S1): the previous version ran the acquire through a pipeline
# (`bash probe-lock.sh acquire | tee -a log || refuse`), so `$?` was tee's status and the
# "refusing to launch a browser" guard could never fire. The acquire rc is now captured directly.
set -u
ROOT=/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/gc-residual
STAMP="${1:-gcrun-$(date +%Y%m%d-%H%M%S)}"
MODE="${2:-both}"      # both | full | smoke
LOGS="$ROOT/logs"; mkdir -p "$LOGS" "$ROOT/raw"

echo "[run-locked] stamp=$STAMP mode=$MODE start=$(date -Is)"
ACQ_LOG="$LOGS/$STAMP.lock.log"
# NOTE: this shell persists for the whole run, so its PID is a truthful lock-owner anchor
# (probe-lock.sh acquire <agent> <owner_pid>).
bash "$ROOT/tools/probe-lock.sh" acquire gc-residual "$$" > "$ACQ_LOG" 2>&1
ACQ_RC=$?
sed -n '1,40p' "$ACQ_LOG"
if [ "$ACQ_RC" -ne 0 ]; then
  echo "[run-locked] LOCK NOT ACQUIRED (rc=$ACQ_RC) -> refusing to launch any browser"; exit 3
fi
# belt-and-braces: verify the lock directory is actually ours before launching anything
LOCKD=/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/.probe.lock
if [ ! -f "$LOCKD/owner.txt" ] || ! grep -q "owner=gc-residual" "$LOCKD/owner.txt"; then
  echo "[run-locked] lock verification FAILED after acquire -> refusing to launch"; exit 4
fi

release() { bash "$ROOT/tools/probe-lock.sh" release gc-residual 2>&1 | tee -a "$ACQ_LOG"; }
trap release EXIT INT TERM

RC=0
if [ "$MODE" = "smoke" ] || [ "$MODE" = "both" ]; then
  echo "[run-locked] SMOKE at $(date -Is)"
  node "$ROOT/scripts/capture-gc.mjs" --mode smoke --stamp "$STAMP-smoke" >> "$LOGS/$STAMP.log" 2>&1
  SRC=$?
  echo "[run-locked] smoke exit=$SRC at $(date -Is)" | tee -a "$LOGS/$STAMP.log"
  if [ "$SRC" -ne 0 ] && [ "$MODE" = "both" ]; then
    echo "[run-locked] smoke FAILED -> skipping full campaign (inspect logs/$STAMP.log)"; RC=$SRC; MODE="smoke-done"
  fi
fi
if [ "$MODE" = "full" ] || [ "$MODE" = "both" ]; then
  echo "[run-locked] FULL at $(date -Is)"
  node "$ROOT/scripts/capture-gc.mjs" --mode full --stamp "$STAMP" >> "$LOGS/$STAMP.log" 2>&1
  RC=$?
  echo "[run-locked] full exit=$RC at $(date -Is)" | tee -a "$LOGS/$STAMP.log"
fi
echo "[run-locked] done rc=$RC end=$(date -Is)"
exit $RC
