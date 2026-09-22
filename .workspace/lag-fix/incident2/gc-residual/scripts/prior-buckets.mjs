#!/usr/bin/env node
// prior-buckets.mjs — PRE-FIX five-bucket baseline recomputed from the prior line's analysis JSON
// (research-v2/cpu-profile/out/analysis-cpu{L,X}.json windows) + raw selfTop for the GC class.
// Fields available pre-fix: taskMs, scriptMs, recalcMs, layoutMs, busyMs(profile non-idle), applyMs,
// label -> raw/profile-<batch>-<label>.json (selfTop rows for the (program)/gc/native class split).
// No pre-fix trace => paint/composite is NOT separable there; it stays inside B5.
import fs from 'node:fs';
import path from 'node:path';
const BASE = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/cpu-profile';
const OUT = '/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/gc-residual/out';
fs.mkdirSync(OUT, { recursive: true });
const r3 = (x) => (x == null || !isFinite(x) ? null : Math.round(x * 1000) / 1000);
const pct = (a, b) => (b > 0 ? r3((a / b) * 100) : null);
const cls = (fn, url) => (fn === '(idle)' ? 'idle' : fn === '(root)' ? 'root' : fn === '(program)' ? 'program' : fn === '(garbage collector)' ? 'gc' : !url ? 'native-nourl' : 'js-url');
const rows = [];
for (const batch of ['cpuL', 'cpuX', 'cpu2', 'cpu3', 'cpu4', 's1']) {
  const f = path.join(BASE, 'out', `analysis-${batch}.json`);
  if (!fs.existsSync(f)) continue;
  let d; try { d = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
  for (const w of d.windows || []) {
    const rawF = path.join(BASE, 'raw', `profile-${batch}-${w.label}.json`);
    let by = {}, rev = null, nonIdleTop = 0, programMs = 0, gcMs = 0, nativeMs = 0, jsMs = 0, rawWall = null;
    try {
      const raw = JSON.parse(fs.readFileSync(rawF, 'utf8'));
      for (const r of raw.selfTop || []) { const k = cls(r.fn, r.url); by[k] = (by[k] || 0) + r.selfMs; }
      nonIdleTop = Object.entries(by).filter(([k]) => k !== 'idle' && k !== 'root').reduce((a, b) => a + b[1], 0);
      programMs = by.program || 0; gcMs = by.gc || 0; nativeMs = by['native-nourl'] || 0; jsMs = by['js-url'] || 0;
      rev = ((raw.selfTop || []).map((r) => (r.url || '').match(/rev=([0-9a-f]{12})/)).find(Boolean) || [])[1] || null;
      rawWall = (raw.meta && (raw.meta.wallSec || raw.meta.profiledSec)) || null;
      if (!rawWall && raw.sampleCount && raw.msPerSample) rawWall = r3((raw.sampleCount * raw.msPerSample) / 1000);
    } catch { }
    const wallSec = w.wallSec || rawWall || null;
    // UNIT GUARD (invariant-based): profile non-idle execution time is always a SUBSET of TaskDuration,
    // so if the raw self-time total (ms) exceeds the stored taskMs by >5x, the earlier batch stored the
    // CDP Performance metrics in SECONDS (observed in cpu2: taskMs 2.113 for a 10 s window). Rescale.
    const t0 = w.taskMs;
    const nonIdleRef = (w.busyMs != null && w.busyMs > 0) ? w.busyMs : nonIdleTop;
    let scale = 1;
    if (t0 != null && nonIdleRef > 0 && nonIdleRef / t0 > 5) scale = 1000;
    else if (t0 != null && wallSec && t0 / wallSec < 5) scale = 1000;
    const task = t0 == null ? null : t0 * scale, script = (w.scriptMs || 0) * scale, recalc = (w.recalcMs || 0) * scale, layout = (w.layoutMs || 0) * scale;
    if (task == null || !(task > 0)) continue;
    const b1 = script, b2 = recalc + layout, b3 = gcMs, b4 = null;
    const b5 = r3(task - (b1 + b2 + b3));
    rows.push({
      batch, label: w.label, scenario: w.scenario, wallSec, unitScale: scale, rev, taskMs: r3(task), taskMsPerS: r3(task / (wallSec || 1)),
      scriptMs: r3(script), recalcLayoutMs: r3(b2), gcMs: r3(b3), busyMs: w.busyMs, applyMs: w.applyMs == null ? null : r3(w.applyMs * scale),
      profileCoverageOfTaskPct: w.busyMs == null ? null : pct(w.busyMs, task),
      classMs: { program: r3(programMs), gc: r3(gcMs), native: r3(nativeMs), js: r3(jsMs) },
      classShareOfNonIdlePct: { program: pct(programMs, nonIdleTop), gc: pct(gcMs, nonIdleTop), native: pct(nativeMs, nonIdleTop), js: pct(jsMs, nonIdleTop) },
      buckets: { B1_js: pct(b1, task), B2_styleLayout: pct(b2, task), B3_gc: pct(b3, task), B4_paintComposite: null, B5_programAndCpp: pct(b5, task) },
      applyShareOfTaskPct: w.applyMs == null ? null : pct(w.applyMs * scale, task),
      checksum: r3(b1 + b2 + b3 + Math.max(0, b5) - task),
    });
  }
}
const FIXED = '82cca1a6178a';
const agg = (rs, name) => {
  const n = rs.length; if (!n) return null;
  const m = (f) => r3(rs.reduce((a, b) => a + f(b), 0) / n);
  return {
    name, n, meanTaskMsPerS: m((r) => r.taskMsPerS), meanWallSec: m((r) => r.wallSec),
    meanBucketPctOfTask: { B1_js: m((r) => r.buckets.B1_js), B2_styleLayout: m((r) => r.buckets.B2_styleLayout), B3_gc: m((r) => r.buckets.B3_gc), B5_programAndCpp: m((r) => r.buckets.B5_programAndCpp) },
    meanApplyShareOfTaskPct: m((r) => r.applyShareOfTaskPct),
    meanProfileCoverageOfTaskPct: m((r) => r.profileCoverageOfTaskPct),
    meanClassShareOfNonIdlePct: {
      program: m((r) => r.classShareOfNonIdlePct.program), gc: m((r) => r.classShareOfNonIdlePct.gc),
      native: m((r) => r.classShareOfNonIdlePct.native), js: m((r) => r.classShareOfNonIdlePct.js),
    },
    revs: [...new Set(rs.map((r) => r.rev))],
  };
};
const byBatch = {};
for (const b of [...new Set(rows.map((r) => r.batch))]) byBatch[b] = agg(rows.filter((r) => r.batch === b), b);
const byScen = {};
for (const s of [...new Set(rows.map((r) => r.scenario))]) byScen[s] = agg(rows.filter((r) => r.scenario === s), s);
const out = { note: 'PRE-FIX (rev abdb7f55acba) bucket baseline. B4 paint/composite NOT separable without trace; it is inside B5.', rows, byBatch, byScen, all: agg(rows) };
fs.writeFileSync(path.join(OUT, 'prior-buckets.json'), JSON.stringify(out, null, 1));
const line = (a) => a ? `${String(a.name).padEnd(18)} n=${String(a.n).padStart(3)} task=${String(a.meanTaskMsPerS).padStart(7)}ms/s buckets(B1/B2/B3/B5)=${a.meanBucketPctOfTask.B1_js}/${a.meanBucketPctOfTask.B2_styleLayout}/${a.meanBucketPctOfTask.B3_gc}/${a.meanBucketPctOfTask.B5_programAndCpp}% apply=${a.meanApplyShareOfTaskPct}% profCoverage=${a.meanProfileCoverageOfTaskPct}% classes(program/gc/native/js)=${a.meanClassShareOfNonIdlePct.program}/${a.meanClassShareOfNonIdlePct.gc}/${a.meanClassShareOfNonIdlePct.native}/${a.meanClassShareOfNonIdlePct.js}%` : 'none';
console.log('# PRE-FIX bucket baseline (rev abdb7f55acba), mean over windows');
console.log(line(out.all));
console.log('\n# by batch'); for (const k of Object.keys(byBatch)) console.log(line(byBatch[k]));
console.log('\n# by scenario'); for (const k of Object.keys(byScen)) console.log(line(byScen[k]));
