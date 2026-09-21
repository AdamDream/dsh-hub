#!/usr/bin/env bash
# Full offline evidence suite. Run from the ingest-equiv directory.
set -u
cd "$(dirname "$0")"
export TZ
for tz in UTC Asia/Shanghai America/New_York; do
  export TZ="$tz"
  echo "################ TZ=$tz ################"
  node harness/run.mjs --label "tz-$(echo "$tz" | tr "/" "-")" 2>&1 | grep -vE "ExperimentalWarning|trace-warnings"
  node harness/run-cc-offset-matrix.mjs --label "tz-$(echo "$tz" | tr "/" "-")" 2>&1 | grep -vE "ExperimentalWarning|trace-warnings" | tail -20
done
export TZ=UTC
node harness/run-append-case.mjs --label tz-UTC 2>&1 | grep -vE "ExperimentalWarning|trace-warnings"
node harness/probe-db-clone.mjs 2>&1 | grep -vE "ExperimentalWarning|trace-warnings"
node harness/probe-lock-contention.mjs 1500 2>&1 | grep -vE "ExperimentalWarning|trace-warnings"
node harness/probe-close-race.mjs 40 2>&1 | grep -vE "ExperimentalWarning|trace-warnings"
node harness/run.mjs --label gap-barrier --gap-ms 200 --barrier 2>&1 | grep -vE "ExperimentalWarning|trace-warnings"
node harness/run-design-probes.mjs --label txn-open --hold-ms 700 2>&1 | grep -vE "ExperimentalWarning|trace-warnings"
node harness/probe-two-conn.mjs 2>&1 | grep -vE "ExperimentalWarning|trace-warnings"
node harness/probe-cache-scope.mjs 2>&1 | grep -vE "ExperimentalWarning|trace-warnings"
node probe/host.mjs 2>&1 | grep -vE "ExperimentalWarning|trace-warnings"
