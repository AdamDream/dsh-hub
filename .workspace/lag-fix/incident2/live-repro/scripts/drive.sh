#!/usr/bin/env bash
# Sequential measurement driver for incident2/live-repro.
# Order: instrument positive control (headless, headed) -> 2 headless runs -> 2 headed runs.
# One browser at a time; each step acquires the shared cross-line lock itself.
# Read-only against the product. Never saves/applies/deletes anything in the GUI.
set -u
cd /home/CNS2026495165/dsh/.workspace/lag-fix/incident2/live-repro
LOG=logs/driver.log
mkdir -p logs raw shots
: > "$LOG"
LW=900000   # 15 min lock budget per step (a peer line is campaigning on the shared lock)

run() {
  echo "=== START $* $(date -Is) ===" | tee -a "$LOG"
  "$@" >>"$LOG" 2>&1
  echo "=== END rc=$? $* $(date -Is) ===" | tee -a "$LOG"
  sleep 3
}

run node scripts/control-instrument.mjs --mode=headless --stall=180
run node scripts/control-instrument.mjs --mode=headed   --stall=180

for n in 1 2; do
  run node scripts/first-settings-probe.mjs --mode=headless --run=$n --clicks=3 \
    --idle=6000 --settle=3000 --post=3000 --lockwait=$LW --tag=headless-run$n
done
for n in 1 2; do
  run node scripts/first-settings-probe.mjs --mode=headed --run=$n --clicks=3 \
    --idle=6000 --settle=3000 --post=3000 --lockwait=$LW --tag=headed-run$n
done

echo "ALL DONE $(date -Is)" | tee -a "$LOG"
