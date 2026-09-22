#!/usr/bin/env node
// prior-structure.mjs — class split of the PRIOR batches' CPU profiles (read-only reuse of
// research-v2/cpu-profile/raw/profile-*.json). Used as the structural baseline for today's run.
// Each prior raw file stores selfTop (<=120 rows: fn,url,line,selfMs,samples) + busyMs + wallSec.
import fs from 'node:fs';
import path from 'node:path';
const PRIOR = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/cpu-profile/raw';
const OUT = '/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/gc-residual/out';
fs.mkdirSync(OUT, { recursive: true });
const r3 = (x) => (x == null || !isFinite(x) ? null : Math.round(x * 1000) / 1000);
const pct = (a, b) => (b > 0 ? r3((a / b) * 100) : null);
function cls(fn, url) {
  if (fn === '(idle)') return 'idle';
  if (fn === '(root)') return 'root';
  if (fn === '(program)') return 'program';
  if (fn === '(garbage collector)') return 'gc';
  if (!url) return 'native-nourl';
  return 'js-url';
}
const rows = [];
for (const f of fs.readdirSync(PRIOR).filter((x) => /^profile-.*\.json$/.test(x)).sort()) {
  let d; try { d = JSON.parse(fs.readFileSync(path.join(PRIOR, f), 'utf8')); } catch { continue; }
  const top = d.selfTop || []; if (!top.length) continue;
  const by = {};
  for (const r of top) { const k = cls(r.fn, r.url); by[k] = (by[k] || 0) + (r.selfMs || 0); }
  const nonIdle = top.filter((r) => cls(r.fn, r.url) !== 'idle' && cls(r.fn, r.url) !== 'root').reduce((a, b) => a + (b.selfMs || 0), 0);
  const rev = (top.map((r) => (r.url || '').match(/rev=([0-9a-f]{12})/)).find(Boolean) || [])[1] || (d.bundles || []).map((b) => String(b.urls || '')).join(',').match(/rev=([0-9a-f]{12})/)?.[1] || null;
  const applyMs = top.filter((r) => r.fn === 'apply').reduce((a, b) => a + (b.selfMs || 0), 0);
  const wallS = (d.meta && d.meta.wallSec) || 8;
  rows.push({
    file: f, scenario: d.scenario || (d.meta && d.meta.stage) || '', rev, wallSec: wallS,
    sampleCount: d.sampleCount, msPerSample: d.msPerSample, busyTotalMs: d.busyMs, busyMsPerS: r3((d.busyMs || 0) / wallS),
    nonIdleTopTotalMs: r3(nonIdle), classMs: Object.fromEntries(Object.entries(by).filter(([k]) => k !== 'idle' && k !== 'root').map(([k, v]) => [k, r3(v)])),
    classSharePct: Object.fromEntries(['program', 'native-nourl', 'gc', 'js-url'].map((k) => [k, pct(by[k] || 0, nonIdle)])),
    applySharePct: pct(applyMs, nonIdle),
    topNonIdle: top.filter((r) => cls(r.fn, r.url) !== 'idle' && cls(r.fn, r.url) !== 'root').slice(0, 5).map((r) => `${r.fn}@${(r.url || 'no-url').split('/').pop()}:${r.line}=${r3(r.selfMs)}ms`),
  });
}
const FIXED_REV = '82cca1a6178a';
const pre = rows.filter((r) => r.rev !== FIXED_REV), post = rows.filter((r) => r.rev === FIXED_REV);
const agg = (rs) => {
  const n = rs.length; if (!n) return null;
  const m = (f) => r3(rs.reduce((a, b) => a + f(b), 0) / n);
  const sum = (k) => rs.reduce((a, b) => a + ((b.classMs || {})[k] || 0), 0);
  const tot = rs.reduce((a, b) => a + b.nonIdleTopTotalMs, 0);
  return { n, meanBusyMsPerS: m((r) => r.busyMsPerS), meanApplySharePct: m((r) => r.applySharePct || 0), classShareOfNonIdlePct: Object.fromEntries(['program', 'native-nourl', 'gc', 'js-url'].map((k) => [k, pct(sum(k), tot)])), revs: [...new Set(rs.map((r) => r.rev))] };
};
const out = { prior: rows, aggPreFix: agg(pre), aggPostFix: agg(post), note: 'class split recomputed from each raw file selfTop rows; denominator = sum of non-idle selfTop selfMs (top-120 truncation => slight under-count)' };
fs.writeFileSync(path.join(OUT, 'prior-structure.json'), JSON.stringify(out, null, 1));
const print = (t, a) => { if (!a) { console.log(`${t}: (none)`); return; } console.log(`${t}: n=${a.n} meanBusy=${a.meanBusyMsPerS}ms/s meanApplyShare=${a.meanApplySharePct}% classShares=${JSON.stringify(a.classShareOfNonIdlePct)} revs=${a.revs.join(',')}`); };
console.log(`# prior batches: ${rows.length} profile windows from ${PRIOR}`);
for (const r of rows) console.log(`  ${r.scenario.padEnd(18)} rev=${String(r.rev).slice(0, 12)} busy=${String(r.busyMsPerS).padStart(7)}ms/s applyShare=${String(r.applySharePct).padStart(6)}% classShares=${JSON.stringify(r.classSharePct)} top=${r.topNonIdle.slice(0, 2).join(' ; ')}`);
console.log('');
print('PRE-FIX  (rev != ' + FIXED_REV + ')', out.aggPreFix);
print('POST-FIX (rev == ' + FIXED_REV + ')', out.aggPostFix);
