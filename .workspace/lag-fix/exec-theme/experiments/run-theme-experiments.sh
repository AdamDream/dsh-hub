#!/usr/bin/env bash
# run-theme-experiments.sh — drive the whole theme-batch experiment series SERIALLY.
#
# The machine allows only one browser instance at a time (the windows are CPU-bound and the
# gates require `foreignCount == 0`), so every step runs alone and takes the shared probe
# lock: .workspace/lag-fix/research-v2/.probe.lock
#
# Sequence (audit §5.5):
#   M-A baseline  ->  M-B (K-C, blocks the :378 forced recalculation)
#                 ->  M-C (K-C', no-op body writes)
#                 ->  M-D (drops session/event frames — counter-proof)
#   then the P0 instance probe, then the comparison with the audit's §4 thresholds.
#
# Usage:
#   bash experiments/run-theme-experiments.sh before        # baseline, pre-deploy
#   bash experiments/run-theme-experiments.sh after         # same series, post-deploy
#   bash experiments/run-theme-experiments.sh compare before after
#
# NOTES
#  * Each variant needs >= 2 windows. Default: 2 windows per scenario, scenarios = home,long,settings.
#  * R1..R9 (functional regression) MUST be run WITHOUT any probe: `bash ... verify` does a
#    probe-free cold start and dumps the DOM state only.
#  * A window whose gateOutcome is not EXCLUSIVE is written but must be judged INCONCLUSIVE.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXP="$HERE/experiments"
RAW="$HERE/raw"
mkdir -p "$RAW"
WIN="${WIN:-8000}"
SCEN="${SCEN:-home,long,settings}"
REPS="${REPS:-2}"

node_run() { node "$@"; echo "[exit $?] $*"; }

series() {
  local label="$1"
  for variant in A B C D; do
    for rep in $(seq 1 "$REPS"); do
      echo "===== variant=$variant rep=$rep label=${label}-${variant}${rep} $(date -Is)"
      node_run "$EXP/theme-ab.mjs" --variant "$variant" --label "${label}-${variant}${rep}" --scenarios "$SCEN" --win "$WIN"
      sleep 5
    done
  done
  echo "===== merged window list for ${label}"
  node -e '
    const fs=require("fs"), path=require("path");
    const raw=process.argv[1], label=process.argv[2];
    const files=fs.readdirSync(raw).filter(f=>f.startsWith("theme-ab-"+label+"-")&&f.endsWith(".json"));
    const windows=[]; const meta=[];
    for (const f of files) { const d=JSON.parse(fs.readFileSync(path.join(raw,f),"utf8")); windows.push(...d.windows); meta.push({f,variant:d.variant}); }
    const out=path.join(raw,"theme-ab-"+label+".json");
    fs.writeFileSync(out, JSON.stringify({label,generatedAt:new Date().toISOString(),files:meta,windows},null,2)+"\n");
    console.log("wrote", out, "windows:", windows.length, "exclusive:", windows.filter(w=>w.concurrency.gateOutcome==="EXCLUSIVE").length);
  ' "$RAW" "$label"
}

case "${1:-}" in
  before|after)
    if [ "${1}" = "before" ]; then
      echo "NOTE: run this BEFORE deploying the batch. The pre-deploy numbers are the only"
      echo "      same-condition baseline (§4.0 forbids using cpuL absolute values)."
    fi
    series "${1}"
    echo "===== P0 instance probe (label ${1})"
    node_run "$EXP/probe-instances.mjs" --scenario home --win "$WIN" --label "${1}-home"
    node_run "$EXP/probe-instances.mjs" --scenario settings --win "$WIN" --label "${1}-settings"
    ;;
  compare)
    node_run "$EXP/theme-ab.mjs" --compare "$RAW/theme-ab-${2:-before}.json" "$RAW/theme-ab-${3:-after}.json" --label "${2:-before}-vs-${3:-after}"
    ;;
  verify)
    echo "===== probe-free functional verification (R1..R9 read-only DOM dump)"
    node_run "$EXP/verify-functional.mjs" --label "verify-$(date +%H%M%S)"
    ;;
  probe)
    node_run "$EXP/probe-instances.mjs" --scenario "${2:-home}" --win "$WIN" --label "${3:-instances}"
    ;;
  *)
    sed -n '2,30p' "$0"
    exit 2
    ;;
esac
