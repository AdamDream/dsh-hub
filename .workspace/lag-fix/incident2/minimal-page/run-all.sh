#!/usr/bin/env bash
# Serial, single-instance measurement campaign for the DSH-free minimal repro page.
# Every phase runs measure.mjs, which acquires the shared probe lock BEFORE
# launching any browser and releases it when the phase ends. One browser at a time.
# Never restarts / never kills anything (no pkill anywhere in this file).
#
#   PHASES=0,1 bash run-all.sh          # run a subset
#   PHASES=6 bash run-all.sh            # DSH comparison only (exactly ONE page load)
set -u
cd "$(dirname "$0")"
mkdir -p raw logs screens

PHASES="${PHASES:-0,1,2,3,4,5,6}"
NODE=node

has() { case ",$PHASES," in *",$1,"*) return 0;; *) return 1;; esac; }
say() { echo "=== $(date -Is) PHASE $* ==="; }

phase_ok() {   # $1 = tag  -> fails when any run recorded an error
  $NODE -e '
    const fs=require("fs");const f=process.argv[1];
    const j=JSON.parse(fs.readFileSync(f,"utf8"));
    const bad=j.results.filter(r=>r.error);
    console.log(`phase ${j.tag}: ${j.results.length} runs, ${bad.length} errored`);
    if(bad.length) for(const b of bad.slice(0,3)) console.log("  ERR",b.cellId,"r"+b.rep,String(b.error).split("\n")[0]);
    process.exit(bad.length? 1:0);
  ' "raw/$1-summary.json"
}

if has 0; then
  say "0 smoke (headless, 2 cells x 1 rep)"
  $NODE measure.mjs --mode=headless --cells=idle-floor,dom-transform --reps=1 --tag=smoke --settle=800 || true
  if ! phase_ok smoke; then echo "SMOKE FAILED — aborting campaign"; exit 1; fi
fi

if has 1; then
  say "1 headless matrix (12 cells x 3 reps)"
  $NODE measure.mjs --mode=headless --all --reps=3 --tag=h1 || true
  phase_ok h1 || echo "WARN: phase 1 had errored runs (continuing)"
fi

if has 2; then
  say "2 headed matrix on real DISPLAY (12 cells x 3 reps, browser reuse)"
  $NODE measure.mjs --mode=headed --all --reps=3 --order=cellmajor --reuse=1 --tag=d1 || true
  phase_ok d1 || echo "WARN: phase 2 had errored runs (continuing)"
fi

if has 3; then
  say "3 headless trace subset (6 cells x 2 reps) for Script/Recalc/Layout/Paint/Composite"
  $NODE measure.mjs --mode=headless --cells=idle-floor,dom-transform,dom-lefttop,hover-tray,hover-blur,extreme-dom --reps=2 --trace=1 --tag=t1 || true
  phase_ok t1 || echo "WARN: phase 3 had errored runs (continuing)"
fi

if has 4; then
  say "4 headed trace subset (6 cells x 2 reps, browser reuse)"
  $NODE measure.mjs --mode=headed --cells=idle-floor,dom-transform,dom-lefttop,hover-tray,hover-blur,extreme-dom --reps=2 --trace=1 --order=cellmajor --reuse=1 --tag=t2 || true
  phase_ok t2 || echo "WARN: phase 4 had errored runs (continuing)"
fi

if has 5; then
  say "5 GPU switch matrix (headless gpu=off / gpu=swiftshader; headed gpu=off)"
  $NODE measure.mjs --mode=headless --cells=dom-transform,canvas --reps=2 --gpu=off --tag=g1h || true
  $NODE measure.mjs --mode=headless --cells=dom-transform,canvas --reps=2 --gpu=swiftshader --tag=g2h || true
  $NODE measure.mjs --mode=headed --cells=dom-transform,canvas --reps=2 --gpu=off --order=cellmajor --reuse=1 --tag=g3d || true
  phase_ok g1h || echo "WARN: g1h had errored runs"
  phase_ok g2h || echo "WARN: g2h had errored runs"
  phase_ok g3d || echo "WARN: g3d had errored runs"
fi

if has 6; then
  say "6 DSH comparison — EXACTLY ONE page load, read-only, no save/apply/delete"
  $NODE measure.mjs --target=dsh --mode=headless --reps=1 --tag=dsh1 --settle=2500 || true
  phase_ok dsh1 || echo "WARN: DSH phase had an error"
fi

echo "=== $(date -Is) campaign finished ==="
