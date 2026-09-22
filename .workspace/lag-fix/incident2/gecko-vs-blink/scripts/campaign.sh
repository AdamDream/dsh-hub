#!/usr/bin/env bash
# campaign.sh — the serial Blink-vs-Gecko matrix.
# ONE browser instance at a time, always: every run-one.mjs invocation launches,
# measures, and closes its own browser before the next one starts.
# Holds research-v2/.probe.lock for the whole batch.
set -u
ROOT=/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/gecko-vs-blink
LOCK=/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/.probe.lock
MY_PID=$$
OUT=$ROOT/raw
mkdir -p "$OUT" "$ROOT/logs"

# ---- lock ------------------------------------------------------------------
CONCURRENT_WITH="none"
if mkdir "$LOCK" 2>/dev/null; then
  : # freshly acquired
elif [ -f "$LOCK/owner.txt" ]; then
  # stale/dead or live owner: record it, retry for up to 3 minutes, then proceed
  CONCURRENT_WITH=$(grep -E '^(agent|owner_pid|pid):' "$LOCK/owner.txt" | tr '\n' ' ')
  for i in $(seq 1 9); do
    OP=$(grep -E '^owner_pid:' "$LOCK/owner.txt" | head -1 | tr -dc '0-9')
    if [ -z "$OP" ] || ! kill -0 "$OP" 2>/dev/null; then break; fi
    sleep 20
  done
fi
cat > "$LOCK/owner.txt" <<EOF
agent: incident2-gecko-vs-blink (Blink vs Gecko controlled comparison)
line: engine=chromium+firefox cells=combined,hover-tray,dom-lefttop,hover-blur,dsh
purpose: same page + same animation + same synthetic pointer path measured on both engines
owner_pid: $MY_PID
pid: $MY_PID
host_pid: 301709   # node dsh web (read-only reference; never restarted)
started_at: $(date -Iseconds)
started_epoch: $(date +%s)
concurrentWith: $CONCURRENT_WITH
loadavg_at_acquire: $(cat /proc/loadavg)
token: CNS202649516533-$MY_PID-gvb
note: single browser at a time; release = rm owner.txt && rmdir
EOF
echo "[campaign $MY_PID] lock owner.txt written; concurrentWith=$CONCURRENT_WITH"

release() {
  if [ -f "$LOCK/owner.txt" ] && grep -q "owner_pid: $MY_PID" "$LOCK/owner.txt" 2>/dev/null; then
    rm -f "$LOCK/owner.txt"; rmdir "$LOCK" 2>/dev/null && echo "[campaign $MY_PID] lock released"
  fi
}
trap release EXIT

# ---- matrix ----------------------------------------------------------------
# engine dpr cell reps target extra-args
MATRIX=(
  "chromium 1 combined      3 minimal"
  "firefox  1 combined      3 minimal"
  "chromium 2 combined      3 minimal"
  "firefox  2 combined      3 minimal"
  "chromium 1 hover-tray    2 minimal"
  "firefox  1 hover-tray    2 minimal"
  "chromium 2 hover-tray    2 minimal"
  "firefox  2 hover-tray    2 minimal"
  "chromium 1 dom-lefttop   2 minimal"
  "firefox  1 dom-lefttop   2 minimal"
  "chromium 1 dom-lefttop   2 minimal --reflow=1"
  "firefox  1 dom-lefttop   2 minimal --reflow=1"
  "chromium 1 hover-blur    1 minimal"
  "firefox  1 hover-blur    1 minimal"
  "chromium 1 idle-floor    2 dsh"
  "firefox  1 idle-floor    2 dsh"
)

PORT=18860
MANIFEST=$ROOT/raw/campaign-manifest.jsonl
: > "$MANIFEST"
echo "{\"campaign\":\"blink-vs-gecko\",\"pid\":$MY_PID,\"startedAt\":\"$(date -Iseconds)\",\"concurrentWith\":\"$CONCURRENT_WITH\",\"loadavg\":\"$(cat /proc/loadavg)\"}" > $ROOT/raw/campaign-header.json

for row in "${MATRIX[@]}"; do
  set -- $row
  ENGINE=$1; DPR=$2; CELL=$3; REPS=$4; TARGET=$5; shift 5
  EXTRA="$*"
  for r in $(seq 1 "$REPS"); do
    PORT=$((PORT+1))
    TAG="gvb-${ENGINE}-${CELL}-dpr${DPR}-r${r}$( [ -n "$EXTRA" ] && echo "-reflow" )"
    OUTF="raw/run-${ENGINE}-dpr${DPR}-${CELL}-r${r}$( [ -n "$EXTRA" ] && echo "-reflow" ).json"
    echo "=== [$(date +%T) load=$(cut -d' ' -f1 /proc/loadavg)] $ENGINE dpr=$DPR cell=$CELL target=$TARGET rep=$r $EXTRA port=$PORT"
    timeout 300 node scripts/run-one.mjs --engine=$ENGINE --dpr=$DPR --cell=$CELL \
      --target=$TARGET --rep=$r --ms=8000 --port=$PORT --tag="$TAG" --out="$OUTF" $EXTRA 2>&1 | sed 's/^/    /'
    echo "{\"engine\":\"$ENGINE\",\"dpr\":$DPR,\"cell\":\"$CELL\",\"target\":\"$TARGET\",\"rep\":$r,\"extra\":\"$EXTRA\",\"out\":\"$OUTF\",\"rc\":$?,\"loadavg\":\"$(cat /proc/loadavg)\"}" >> "$MANIFEST"
    sleep 2
  done
done

echo "[campaign $MY_PID] done at $(date -Iseconds)"
