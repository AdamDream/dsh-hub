#!/usr/bin/env node
// crosscheck-peer-raw.mjs — independent structural cross-check of TODAY's numbers against raw
// artifacts captured by OTHER lines on the same host/build (post-theme-fix, host restarted 10:06).
// Nothing here is my own measurement: it re-derives class shares / trace bucket unions from peer raw
// files with my own aggregation code, so it is an instrument-independent corroboration (or refutation).
import fs from 'node:fs';
import path from 'node:path';
const P = '/home/CNS2026495165/dsh/.workspace/lag-fix/incident2';
const OUT = '/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/gc-residual/out';
fs.mkdirSync(OUT, { recursive: true });
const r3 = (x) => (x == null || !isFinite(x) ? null : Math.round(x * 1000) / 1000);
const pct = (a, b) => (b > 0 ? r3((a / b) * 100) : null);
const cls = (cf) => { const fn = cf.functionName || '', url = cf.url || ''; return fn === '(idle)' ? 'idle' : fn === '(root)' ? 'root' : fn === '(program)' ? 'program' : fn === '(garbage collector)' ? 'gc' : !url ? 'native-nourl' : 'js-url'; };
function unionMs(iv) { if (!iv.length) return 0; const a = iv.slice().sort((x, y) => x[0] - y[0]); let t = 0, cs = a[0][0], ce = a[0][1]; for (let i = 1; i < a.length; i++) { if (a[i][0] <= ce) ce = Math.max(ce, a[i][1]); else { t += ce - cs; cs = a[i][0]; ce = a[i][1]; } } return r3((t + ce - cs) / 1000); }

const out = { note: 'peer-captured raw artifacts, re-aggregated by this line', profiles: [], traces: [] };
const PL = [];
for (const f of fs.readdirSync(path.join(P, 'first-open-profile/raw')).filter((x) => /\.profile\.json$|^cpuprofile.*\.json$/.test(x)).sort()) {
  let d; try { d = JSON.parse(fs.readFileSync(path.join(P, 'first-open-profile/raw', f), 'utf8')); } catch { continue; }
  const p = d.profile || d;
  if (!p.nodes || !p.samples) continue;
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const self = new Map();
  for (let i = 0; i < p.samples.length; i++) self.set(p.samples[i], (self.get(p.samples[i]) || 0) + (p.timeDeltas[i] || 0));
  const b = {}; const urls = new Map();
  for (const [id, us] of self) { const n = byId.get(id); if (!n) continue; const k = cls(n.callFrame || {}); b[k] = (b[k] || 0) + us / 1000; const u = (n.callFrame && n.callFrame.url) || ''; urls.set(u, (urls.get(u) || 0) + us / 1000); }
  const nonIdle = Object.entries(b).filter(([k]) => k !== 'idle' && k !== 'root').reduce((a, x) => a + x[1], 0);
  const span = r3(((p.endTime || 0) - (p.startTime || 0)) / 1000);
  PL.push({ file: f, spanMs: span, samples: p.samples.length, nodes: p.nodes.length, nonIdleTopMs: r3(nonIdle), idleMs: r3(b.idle || 0), classMs: Object.fromEntries(Object.entries(b).map(([k, v]) => [k, r3(v)])), classShareOfNonIdlePct: Object.fromEntries(['program', 'gc', 'native-nourl', 'js-url'].map((k) => [k, pct(b[k] || 0, nonIdle)])), topUrls: [...urls.entries()].filter(([u]) => u).sort((x, y) => y[1] - x[1]).slice(0, 6).map(([u, v]) => `${u.split('/').pop()}=${r3(v)}ms`) });
}
out.profiles = PL;

// ---- (program) attribution path on the peer's CLEAN first-open profiles (deliverable 4 evidence)
const clsOf = (cf) => { const fn = cf.functionName || '', url = cf.url || ''; return fn === '(idle)' ? 'idle' : fn === '(root)' ? 'root' : fn === '(program)' ? 'program' : fn === '(garbage collector)' ? 'gc' : !url ? 'native-nourl' : 'js-url'; };
function programParents(p, want = 'program') {
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of p.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const self = new Map();
  for (let i = 0; i < p.samples.length; i++) self.set(p.samples[i], (self.get(p.samples[i]) || 0) + (p.timeDeltas[i] || 0));
  const agg = new Map(); let total = 0;
  for (const [id, us] of self) {
    const n = byId.get(id); if (!n || clsOf(n.callFrame || {}) !== want) continue;
    total += us;
    let cur = id, d = 0, label = '(no-ancestor)';
    while (d++ < 200) {
      const pid2 = parent.get(cur); if (!pid2) break;
      const pn = byId.get(pid2); if (!pn) break;
      const c = clsOf(pn.callFrame || {});
      if (c !== want && c !== 'root' && c !== 'idle') {
        const cf = pn.callFrame; label = `${cf.functionName || '(anon)'} @ ${(cf.url || '(no-url)').split('/').pop()}:${cf.lineNumber}`; break;
      }
      cur = pid2;
    }
    const b = agg.get(label) || { label, selfMs: 0, hits: 0 }; b.selfMs += us / 1000; b.hits++; agg.set(label, b);
  }
  return { totalMs: r3(total / 1000), top: [...agg.values()].map((b) => ({ ...b, selfMs: r3(b.selfMs) })).sort((a, b) => b.selfMs - a.selfMs).slice(0, 12) };
}
out.programPaths = [];
for (const f of ['cpuprofile-first-open.json', 'cpuprofile-second-open.json', 'cpuprofile2-clean-first-open.json', 'cpuprofile2-clean-reopen.json']) {
  const fp2 = path.join(P, 'first-open-profile/raw', f);
  if (!fs.existsSync(fp2)) continue;
  const d = JSON.parse(fs.readFileSync(fp2, 'utf8'));
  const p = d.profile || d;
  out.programPaths.push({ file: f, program: programParents(p, 'program'), nativeNourl: programParents(p, 'native-nourl') });
}
console.log('\n## peer CLEAN first-open profiles: (program) nearest non-program ancestor');
for (const pp of out.programPaths) {
  console.log(`  ${pp.file}: total=${pp.program.totalMs}ms`);
  for (const t of pp.program.top.slice(0, 8)) console.log(`     ${String(t.selfMs).padStart(8)}ms  hits=${String(t.hits).padStart(5)}  ${t.label}`);
  console.log(`     native-nourl total=${pp.nativeNourl.totalMs}ms top=${pp.nativeNourl.top.slice(0, 5).map((t) => t.label + '=' + t.selfMs).join(' | ')}`);
}

for (const f of ['user-capture/fixtures/real-settings-trace.json', 'user-capture/fixtures/real-settings-trace-2.json']) {
  const fp = path.join(P, f);
  if (!fs.existsSync(fp)) continue;
  const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const ev = d.traceEvents || d;
  const rt = new Map();
  for (const e of ev) if (e.ph === 'X' && e.name === 'RunTask') { const k = `${e.pid}:${e.tid}`; rt.set(k, (rt.get(k) || 0) + 1); }
  let main = null; for (const [k, n] of rt) if (!main || n > main.n) main = { k, n };
  const mt = main ? main.k : null;
  const names = {}; const sl = [], pclo = [], pchi = [], gctop = [], gcAll = [], run = [], all = [];
  for (const e of ev) {
    if (e.ph !== 'X') continue;
    const k = `${e.pid}:${e.tid}`;
    if (/^(MajorGC|MinorGC)/.test(e.name)) { gcAll.push({ n: e.name, k, ts: e.ts, dur: e.dur || 0 }); if (k === mt) gctop.push([e.ts, e.ts + (e.dur || 0)]); }
    if (k !== mt) continue;
    names[e.name] = names[e.name] || { n: 0, durMs: 0 }; names[e.name].n++; names[e.name].durMs += (e.dur || 0) / 1000;
    all.push([e.ts, e.ts + (e.dur || 0)]);
    if (e.name === 'RunTask') run.push([e.ts, e.ts + (e.dur || 0)]);
    if (/^(UpdateLayoutTree|RecalculateStyle|Layout)$/.test(e.name)) sl.push([e.ts, e.ts + (e.dur || 0)]);
    if (/^(Paint|PaintSetup|Commit|CompositeLayers|Layerize|RasterTask|GPUTask|PaintImage)$/.test(e.name)) pclo.push([e.ts, e.ts + (e.dur || 0)]);
    if (/^(Paint|PaintSetup|Commit|CompositeLayers|Layerize|RasterTask|GPUTask|PaintImage|PrePaint|UpdateLayerTree|UpdateLayer|HitTest)$/.test(e.name)) pchi.push([e.ts, e.ts + (e.dur || 0)]);
  }
  const runMs = unionMs(run), slMs = unionMs(sl), pclMs = unionMs(pclo), pchMs = unionMs(pchi), gcMs = unionMs(gctop), allMs = unionMs(all);
  const gcAnyThread = r3(gcAll.reduce((a, x) => a + x.dur / 1000, 0));
  out.traces.push({
    file: f, events: ev.length, mainThread: mt, mainThreadRunTaskN: main ? main.n : 0,
    runTaskUnionMs: runMs, mainAllUnionMs: allMs, styleLayoutMs: slMs, paintLoMs: pclMs, paintHiMs: pchMs, gcTopUnionMs: gcMs, gcAllThreadSumMs: gcAnyThread,
    sharesOfRunTaskPct: { styleLayout: pct(slMs, runMs), paintLo: pct(pclMs, runMs), paintHi: pct(pchMs, runMs), gcTop: pct(gcMs, runMs), mainAll: pct(allMs, runMs) },
    topNames: Object.entries(names).sort((a, b) => b[1].durMs - a[1].durMs).slice(0, 16).map(([n, v]) => ({ name: n, n: v.n, durMs: r3(v.durMs), pctOfRunTaskUnion: pct(v.durMs, runMs) })),
  });
}
fs.writeFileSync(path.join(OUT, 'crosscheck-peer-raw.json'), JSON.stringify(out, null, 1));
console.log('# PEER RAW CROSS-CHECK (post-fix, other lines captured these; re-aggregated here)');
console.log('\n## peer CPU profiles: class shares of non-idle');
for (const p of out.profiles) console.log(`  ${p.file.padEnd(38)} span=${p.spanMs}ms samples=${p.samples} nonIdle=${p.nonIdleTopMs}ms classes=${JSON.stringify(p.classShareOfNonIdlePct)} topUrls=${p.topUrls.join(', ').slice(0, 120)}`);
console.log('\n## peer traces: bucket unions relative to main-thread RunTask union');
for (const t of out.traces) {
  console.log(`  ${t.file} events=${t.events} main=${t.mainThread} runTaskUnion=${t.runTaskUnionMs}ms mainAllUnion=${t.mainAllUnionMs}ms`);
  console.log(`    styleLayout=${t.styleLayoutMs}ms(${t.sharesOfRunTaskPct.styleLayout}%) paintLo=${t.paintLoMs}ms(${t.sharesOfRunTaskPct.paintLo}%) paintHi=${t.paintHiMs}ms(${t.sharesOfRunTaskPct.paintHi}%) gcTop=${t.gcTopUnionMs}ms(${t.sharesOfRunTaskPct.gcTop}%) allEventsUnion=${t.mainAllUnionMs}ms(${t.sharesOfRunTaskPct.mainAll}%)`);
  console.log(`    top: ${t.topNames.map((x) => `${x.name}=${x.durMs}ms/${x.pctOfRunTaskUnion}%`).join(' ')}`);
}
