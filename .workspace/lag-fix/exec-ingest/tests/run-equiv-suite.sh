#!/usr/bin/env bash
# E1 equivalence suite driver: 3 timezones × {patched candidate lib, original db.js}
# Usage: ./tests/run-equiv-suite.sh   (from the exec-ingest directory)
set -u
cd "$(dirname "$0")/.."
status=0
for tz in UTC Asia/Shanghai America/New_York; do
  for lib in stage/lib-cand stage/lib-origdb stage/lib-cand-ccfix; do
    label="$(basename "$lib")-$(echo "$tz" | tr '/' '-')"
    extra=""
    case "$lib" in *ccfix) extra="--expect-append-new-events=1" ;; esac
    TZ="$tz" node tests/run-worker-equiv.mjs --lib "$lib" --label "$label" $extra 2>&1 | grep -vE "ExperimentalWarning|trace-warnings"
    rc=${PIPESTATUS[0]}
    [ "$rc" -ne 0 ] && status=1
  done
done
echo "=============================="
echo "E1 SUITE EXIT: $status"
exit "$status"
