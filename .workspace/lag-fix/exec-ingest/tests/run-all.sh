#!/usr/bin/env bash
# One-shot acceptance suite for the Ingest-v1 batch (all offline, all sandboxed).
#
#   ./tests/run-all.sh              # everything except G1 (which needs a quiet machine)
#   ./tests/run-all.sh --with-g1    # include the event-loop-latency gate (≈3 min)
#
# Every step writes its raw JSON under ../out/ and its stdout under out/*.stdout.
# Exit status is 0 only when every step passed.
set -u
cd "$(dirname "$0")/.."
mkdir -p out
WITH_G1=0
[ "${1:-}" = "--with-g1" ] && WITH_G1=1
status=0
step() {
  local name="$1"; shift
  echo "=============================== $name ==============================="
  "$@" > "out/$name.stdout" 2>&1
  local rc=$?
  grep -vE "ExperimentalWarning|trace-warnings" "out/$name.stdout" | tail -25
  echo "[$name exit=$rc]"
  [ "$rc" -ne 0 ] && status=1
  return 0
}

step verify-candidates     ./tests/verify-candidates.sh
step equiv-suite           ./tests/run-equiv-suite.sh
step wiring-assertions     env TZ=Asia/Shanghai node tests/run-wiring-assertions.mjs
step g2-singleflight       env TZ=Asia/Shanghai node tests/run-g2-singleflight.mjs
step g4-dispose            env TZ=Asia/Shanghai node tests/run-g4-dispose.mjs
step timer-shape           node tests/run-timer-shape.mjs
step counterfactuals       env TZ=Asia/Shanghai node tests/run-counterfactuals.mjs
step ig3-shanghai          env TZ=Asia/Shanghai node tests/run-ig3-acceptance.mjs
step ig3-utc               env TZ=UTC node tests/run-ig3-acceptance.mjs
step ig3-newyork           env TZ=America/New_York node tests/run-ig3-acceptance.mjs
step ig3-real-root         env TZ=Asia/Shanghai node tests/run-ig3-acceptance.mjs --real-root "$HOME/.dsh/sessions"
if [ "$WITH_G1" = "1" ]; then
  step g1-latency          env TZ=Asia/Shanghai node tests/run-g1-latency.mjs --rounds 2
else
  echo "=============================== g1-latency (skipped) ==============================="
  echo "run: ./tests/run-all.sh --with-g1   (or: node tests/run-g1-latency.mjs --rounds 2)"
  echo "existing evidence: out/g1-latency.json"
fi

echo "=============================================="
echo "INGEST-V1 SUITE EXIT: $status"
exit "$status"
