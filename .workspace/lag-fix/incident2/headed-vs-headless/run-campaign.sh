#!/usr/bin/env bash
# incident2 / headed-vs-headless : serialized A/B/C runner
# Discipline: ONE browser instance at a time, never concurrent; only our own
# browser is closed (never pkill/kill of shared resources).
set -uo pipefail

HERE="/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/headed-vs-headless"
SHARED_LOCK="/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/.probe.lock"
LOCAL_LOCK="$HERE/.lock"
LOG="$HERE/logs"
mkdir -p "$LOG"

log() { echo "[$(date -Is)] $*" | tee -a "$LOG/runner.log"; }

# ---------- local mutual exclusion ----------
for i in $(seq 1 60); do
  if mkdir "$LOCAL_LOCK" 2>/dev/null; then
    printf 'pid=%s started=%s purpose=%s\n' "$$" "$(date -Is)" "headed-vs-headless" > "$LOCAL_LOCK/owner.txt"
    break
  fi
  log "local lock busy; waiting 5s ($i)"
  sleep 5
  [ "$i" = 60 ] && { log "FATAL: local lock never acquired"; exit 9; }
done
trap 'rm -rf "$LOCAL_LOCK"' EXIT

# ---------- shared cross-line probe lock ----------
acquire_shared() {
  local deadline=$(( $(date +%s) + ${1:-600} ))
  while :; do
    if mkdir "$SHARED_LOCK" 2>/dev/null; then
      printf 'agent=incident2-headed-vs-headless pid=%s started_at=%s started_epoch=%s purpose=%s\n' \
        "$$" "$(date -Is)" "$(date +%s)" "headed-vs-headless A/B/C probe" > "$SHARED_LOCK/owner.txt"
      log "SHARED LOCK ACQUIRED"
      return 0
    fi
    # stale detection: owner pid no longer exists => orphaned lock (recorded, not stolen from a live run)
    local opid
    opid=$(sed -n 's/.*pid=\([0-9]\+\).*/\1/p' "$SHARED_LOCK/owner.txt" 2>/dev/null | head -1)
    if [ -n "${opid:-}" ] && [ ! -d "/proc/$opid" ]; then
      log "STALE LOCK: owner pid=$opid does not exist -> preempting (recorded as preemption)"
      echo "preempted_owner_pid=$opid preempted_at=$(date -Is) stale_confirmed=pid-absent" >> "$LOG/preemptions.log"
      rm -rf "$SHARED_LOCK"
      continue
    fi
    log "shared lock held by pid=${opid:-unknown} (alive) -> waiting 25s"
    if [ "$(date +%s)" -ge "$deadline" ]; then
      log "SHARED LOCK WAIT EXHAUSTED -> proceeding WITHOUT cross-line lock; windows record foreign-instance counts, baseline_status=contended"
      echo "contention_no_shared_lock at=$(date -Is) holder_pid=${opid:-unknown} waited_sec=$1" >> "$LOG/preemptions.log"
      return 0
    fi
    sleep 25
  done
}
release_shared() {
  if grep -q "agent=incident2-headed-vs-headless" "$SHARED_LOCK/owner.txt" 2>/dev/null; then
    rm -rf "$SHARED_LOCK"; log "SHARED LOCK RELEASED (we owned it)"
  fi
}
trap 'rm -rf "$LOCAL_LOCK"; release_shared' EXIT

concurrency_gate() {
  local own
  own=$(pgrep -fc "chrome-linux/chrome|headless_shell" 2>/dev/null || echo 0)
  log "concurrency check ($1): chrome-family processes=$own host_pid_alive=$([ -d /proc/10806 ] && echo yes || echo NO) loadavg=$(cut -d' ' -f1-3 /proc/loadavg)"
}

acquire_shared ${SHARED_LOCK_WAIT:-180} || exit 8
concurrency_gate "pre-run"

ARMS="${ARMS:-A A A C-nogpu C-nogpu C-nogpu C-gpu C-gpu C-gpu}"
N="${N:-3}"
DISPLAY_TO_USE="${DISPLAY_TO_USE:-:1}"

# warmup (not counted) then measured reps
log "warmup (not counted)"
timeout 180 node "$HERE/measure-v2.mjs" --arm A --rep 0 --out "raw/warmup2-A.json" --settle 4000 >> "$LOG/runner.log" 2>&1
log "warmup done rc=$?"

run_arm() {
  local arm="$1" rep="$2"
  concurrency_gate "before $arm#$rep"
  log "RUN arm=$arm rep=$rep"
  timeout 240 node "$HERE/measure-v2.mjs" --arm "$arm" --rep "$rep" --display "$DISPLAY_TO_USE" \
      --out "raw/v2-${arm}-r${rep}.json" --settle 4000 >> "$LOG/runner.log" 2>&1
  local rc=$?
  log "DONE arm=$arm rep=$rep rc=$rc"
  return $rc
}

# ---- Arm A: headless default (swiftshader) ----
for r in $(seq 1 $N); do run_arm A "$r"; sleep 3; done

# ---- Arm C-nogpu: headless + --disable-gpu ----
for r in $(seq 1 $N); do run_arm C-nogpu "$r"; sleep 3; done

# ---- Arm C-gpu: headless + angle/swiftshader explicit ----
for r in $(seq 1 $N); do run_arm C-gpu "$r"; sleep 3; done

# ---- Arm B: headed (expected to be BLOCKED in this environment; recorded honestly) ----
log "RUN arm=B rep=1 (headed; expected environment block)"
timeout 120 node "$HERE/measure-v2.mjs" --arm B --rep 1 --display "$DISPLAY_TO_USE" \
    --out "raw/v2-B-r1.json" --settle 4000 >> "$LOG/runner.log" 2>&1
log "DONE arm=B rep=1 rc=$? (recorded as blocked if launch failed)"

concurrency_gate "post-run"
log "ALL DONE"
