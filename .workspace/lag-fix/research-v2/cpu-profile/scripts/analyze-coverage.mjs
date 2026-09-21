// Extract exact per-function call counts (from V8 precise coverage) alongside profiler
// self-time, so cost can be attributed per invocation rather than guessed.
import fs from 'node:fs';
import path from 'node:path';
const OUT = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/cpu-profile/out';
const d = JSON.parse(fs.readFileSync(path.join(OUT, 'campaign-cpu4.json'), 'utf8'));
const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);

// Reconstruct: coverage gives function startOffsets + counts; the profile gives top self
// functions by url+line. We cannot map offset->line here, but we CAN report:
//  - per-script total executed-function-entry counts
//  - the count distribution (top entries) which anchors "how many times did something run"
const rows = [];
for (const w of d.windows) {
  const byUrl = w.coverage.byUrl;
  const scripts = Object.entries(byUrl).map(([url, v]) => ({ url: url.split('/').pop(), total: v.total, top: v.top.map((t) => t.count) })).sort((a, b) => b.total - a.total).slice(0, 6);
  rows.push({ label: w.label, scenario: w.scenario, wallSec: w.window.wallSec, wsIn: w.ws.in, wsInPerS: w.ws.inboundPerS, scriptMs: w.cdp.ScriptDuration, bodyWrites: w.bodyStyleWrites, writesPerS: r3(w.bodyStyleWrites / w.window.wallSec), scripts });
}
console.log('=== executed-function-entry counts per script (coverage), with style-write volume ===');
for (const r of rows) {
  console.log(`\n${r.label} [${r.scenario}] wall=${r.wallSec}s script=${r.scriptMs}ms bodyStyleWrites=${r.bodyWrites} (${r.writesPerS}/s) wsIn/s=${r.wsInPerS}`);
  for (const s of r.scripts) console.log(`    ${s.url}  totalEntries=${s.total}  topCounts=${JSON.stringify(s.top.slice(0, 8))}`);
}

// correlation: bodyWrites/s vs script ms/s and vs ws rate
const pts = d.windows.map((w) => ({ writes: r3(w.bodyStyleWrites / w.window.wallSec), script: w.cdp.ScriptMsPerS, ws: w.ws.inboundPerS, busy: w.profile.busyMsPerS, recalc: w.cdp.RecalcMsPerS, label: w.label }));
const fit = (xs, ys) => { const n = xs.length; const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n; let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; } const s = sxx ? sxy / sxx : 0; return { slope: r3(s), r2: sxx && syy ? r3((sxy * sxy) / (sxx * syy)) : null, n }; };
console.log('\n=== correlations (per window) ===');
console.log('  script ms/s  vs body-style-writes/s :', JSON.stringify(fit(pts.map((p) => p.writes), pts.map((p) => p.script))));
console.log('  script ms/s  vs ws inbound/s        :', JSON.stringify(fit(pts.map((p) => p.ws), pts.map((p) => p.script))));
console.log('  profileBusy  vs body-style-writes/s :', JSON.stringify(fit(pts.map((p) => p.writes), pts.map((p) => p.busy))));
console.log('  profileBusy  vs ws inbound/s        :', JSON.stringify(fit(pts.map((p) => p.ws), pts.map((p) => p.busy))));
console.log('  recalc ms/s  vs ws inbound/s        :', JSON.stringify(fit(pts.map((p) => p.ws), pts.map((p) => p.recalc))));
console.log('  recalc ms/s  vs body-style-writes/s :', JSON.stringify(fit(pts.map((p) => p.writes), pts.map((p) => p.recalc))));
fs.writeFileSync(path.join(OUT, 'coverage-anchor-cpu4.json'), JSON.stringify({ rows, pts, fits: { scriptVsWrites: fit(pts.map((p) => p.writes), pts.map((p) => p.script)), busyVsWrites: fit(pts.map((p) => p.writes), pts.map((p) => p.busy)), busyVsWs: fit(pts.map((p) => p.ws), pts.map((p) => p.busy)), recalcVsWs: fit(pts.map((p) => p.ws), pts.map((p) => p.recalc)) } }, null, 2));
