#!/usr/bin/env node
// analyze-gc.mjs — turns the raw campaign JSON into the GC / (program) / five-bucket tables.
// Input : raw/campaign-<stamp>.json (+ raw/win-<stamp>-*.json for profile-parent analysis)
//         out/prior-buckets.json (pre-fix baseline, produced by prior-buckets.mjs)
// Output: out/summary-<stamp>.json, out/summary-<stamp>.txt, stdout tables.
//
// Bucket definition (states its own overlaps, per auditor S6):
//   B1 = CDP `ScriptDuration`            (Blink's own JS-execution timer)
//   B2 = CDP `RecalcStyleDuration` + `LayoutDuration` (Blink lifecycle timers)
//   B3 = PerformanceObserver 'gc' total  (primary; cross-checked by trace GC spans)
//   B4 = trace non-overlapping union of main-thread paint/composite spans (null when unmeasured)
//   B5 = TaskDuration - (B1+B2+B3+B4)     "program / unclassified"
//   Overlaps: a forced style recalc triggered from JS may be counted in BOTH B1 and B2;
//   B3 may sit inside B1 when GC runs inside a JS callback. Hence B5 is a LOWER bound and a
//   negative B5 is flagged as under-attribution rather than silently clamped.
//   Robust companion: residualRobust = TaskDuration - max(B1, B2) - B3 - B4.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = '/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/gc-residual';
const RAW = path.join(ROOT, 'raw'); const OUT = path.join(ROOT, 'out');
fs.mkdirSync(OUT, { recursive: true });
const argv = process.argv.slice(2);
const argOf = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const r3 = (x) => (x == null || !isFinite(x) ? null : Math.round(x * 1000) / 1000);
const pct = (a, b) => (b > 0 ? r3((a / b) * 100) : null);
const pad = (s, n) => String(s == null ? '-' : s).padStart(n);

let file = argOf('file', null);
if (!file) {
  const c = fs.readdirSync(RAW).filter((f) => /^campaign-.*\.json$/.test(f)).sort();
  if (!c.length) { console.error('no campaign json in ' + RAW); process.exit(2); }
  file = path.join(RAW, c[c.length - 1]);
}
const rep = JSON.parse(fs.readFileSync(file, 'utf8'));
const stamp = rep.meta.stamp;
const lines = [];
const say = (...a) => { const s = a.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' '); lines.push(s); console.log(s); };

say(`# analyze-gc  file=${path.basename(file)}  mode=${rep.meta.mode}  wall=${rep.wallSec}s  cats=${rep.meta.cats}`);
say(`# hostPid=${rep.meta.hostPid}  gate=${JSON.stringify(rep.gate && { lockHeldByLine: rep.gate.lockHeldByLine, foreignCount: rep.gate.foreignCount })}`);
say(`# censusPre foreign=${rep.censusPre.foreignCount} mine=${rep.censusPre.mineCount} load=${rep.censusPre.load}`);
say(`# censusPost foreign=${rep.censusPost.foreignCount} mine=${rep.censusPost.mineCount} load=${rep.censusPost.load}`);
say(`# lock owner at pre-census: ${String(rep.censusPre.lockOwner).replace(/\n/g, ' ').slice(0, 180)}`);
say(`# windowDefs=${JSON.stringify(rep.meta.windowDefs)}`);

// ------------------------------------------------------------------ profile parent attribution
function classOf(cf) {
  const fn = cf.functionName || ''; const url = cf.url || '';
  if (fn === '(idle)') return 'idle';
  if (fn === '(root)') return 'root';
  if (fn === '(program)') return 'program';
  if (fn === '(garbage collector)') return 'gc';
  if (!url) return 'native-nourl';
  return 'js-url';
}
function profileContext(profile, want) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const selfUs = new Map();
  const { samples = [], timeDeltas = [] } = profile;
  for (let i = 0; i < samples.length; i++) { const id = samples[i]; selfUs.set(id, (selfUs.get(id) || 0) + (timeDeltas[i] || 0)); }
  const agg = new Map(); let total = 0;
  for (const [id, us] of selfUs) {
    const n = byId.get(id); if (!n) continue;
    if (classOf(n.callFrame || {}) !== want) continue;
    total += us;
    let cur = id, depth = 0, label = '(no-ancestor)';
    while (depth++ < 200) {
      const p = parent.get(cur); if (!p) break;
      const pn = byId.get(p); if (!pn) break;
      const c = classOf(pn.callFrame || {});
      if (c !== want && c !== 'root' && c !== 'idle') {
        const cf = pn.callFrame;
        label = `${cf.functionName || '(anon)'} @ ${(cf.url || '(no-url)').split('/').pop()}:${cf.lineNumber}`;
        break;
      }
      cur = p;
    }
    const b = agg.get(label) || { label, selfMs: 0, hits: 0 };
    b.selfMs += us / 1000; b.hits++; agg.set(label, b);
  }
  return { totalMs: r3(total / 1000), top: [...agg.values()].map((b) => ({ ...b, selfMs: r3(b.selfMs) })).sort((a, b) => b.selfMs - a.selfMs).slice(0, 30) };
}

// ------------------------------------------------------------------ per-window rows
const windows = [];
for (const L of rep.loads) {
  for (const w of L.windows) {
    const wf = path.join(RAW, `win-${stamp}-${L.label}-${w.name}.json`);
    let ctx;
    try {
      const raw = JSON.parse(fs.readFileSync(wf, 'utf8'));
      ctx = { program: profileContext(raw.profileRaw, 'program'), native: profileContext(raw.profileRaw, 'native-nourl'), gc: profileContext(raw.profileRaw, 'gc'), file: path.basename(wf) };
    } catch (e) { ctx = { err: String(e).slice(0, 80) }; }
    const task = w.cdp.TaskDuration, wall = w.wallSec, nonIdle = w.profile.busyMs, cl = w.profile.byClass;
    const b1 = w.cdp.ScriptDuration;
    const b2 = r3(w.cdp.RecalcStyleDuration + w.cdp.LayoutDuration);
    const b3 = w.gcPage.totalMs;
    const traceOk = !!(w.trace && w.trace.mainThread && !w.trace.parseError && !w.traceSkipped);
    // B4 is reported as a RANGE: lower = strict paint/composite names only; upper = + the Blink
    // lifecycle/aggregator siblings (PrePaint, UpdateLayerTree, UpdateLayer, ...) that the auditor
    // showed are emitted alongside Paint on this build. B5 is the complementary range.
    const b4lo = traceOk ? w.trace.paintCompositeUnionMs : null;
    const b4hi = traceOk && w.trace.renderUpperUnionMs != null ? w.trace.renderUpperUnionMs : b4lo;
    const b4 = b4lo;
    const sumA = r3(b1 + b2 + b3 + (b4lo || 0));
    const sumAhi = r3(b1 + b2 + b3 + (b4hi || 0));
    const b5 = r3(task - sumA);
    const b5lower = r3(task - sumAhi);
    const residualRobust = r3(task - Math.max(b1, b2) - b3 - (b4hi || 0));
    const share = (k) => pct((cl[k] || {}).selfMs, nonIdle);
    windows.push({
      load: L.label, win: w.name, noTrace: !!w.noTrace, allocLoad: !!L.alloc, wallSec: wall, wallSleepSec: w.wallSleepSec, metricSpanMs: w.metricSpanMs,
      taskMs: task, taskMsPerS: w.cdp.TaskMsPerS, scriptMs: b1, scriptMsPerS: w.cdp.ScriptMsPerS,
      recalcMs: w.cdp.RecalcStyleDuration, layoutMs: w.cdp.LayoutDuration, recalcLayoutMs: b2, recalcLayoutMsPerS: r3(b2 / wall),
      recalcCount: w.cdp.RecalcStyleCount, layoutCount: w.cdp.LayoutCount, tasksPerS: w.cdp.tasksPerS,
      gcPageN: w.gcPage.n, gcPageMs: b3, gcPageMsPerS: r3(b3 / wall), gcPagePerWinAvgMs: w.gcPage.n ? r3(b3 / w.gcPage.n) : null,
      gcPageKinds: w.gcPage.kinds, gcPageCounts: w.gcPage.counts,
      gcTraceTopMs: w.trace ? w.trace.gcMainTopLevelMs : null, gcTraceTopN: w.trace ? w.trace.gcMainTopLevelN : null,
      gcTraceUnionMs: w.trace ? w.trace.gcMainUnionMs : null, gcTraceNestedInflatedMs: w.trace ? w.trace.gcMainNestedSumMs : null,
      gcTraceAllThreadMs: w.trace ? w.trace.gcAllDurMs : null,
      gcProfileMs: (cl.gc || {}).selfMs || 0, gcProfileSharePct: share('gc'),
      paintCompositeMs: b4, paintCompositeMsPerS: b4 == null ? null : r3(b4 / wall), traceOk,
      renderUpperMs: b4hi, renderUpperMsPerS: b4hi == null ? null : r3(b4hi / wall),
      styleLayoutUnionMs: w.trace ? w.trace.styleLayoutUnionMs : null,
      paintNamesSeen: w.trace ? w.trace.paintCompositeNamesSeen : null,
      styleLayoutNamesSeen: w.trace ? w.trace.styleLayoutNamesSeen : null,
      profileNonIdleMs: nonIdle, profileNonIdleMsPerS: r3(nonIdle / wall), profileClasses: cl,
      profileShareOfNonIdle: { program: share('program'), gc: share('gc'), native: share('native-nourl'), js: share('js-url') },
      profileCoverageOfTaskPct: pct(nonIdle, task),
      buckets: {
        B1_js: { ms: b1, pctOfTask: pct(b1, task), msPerS: r3(b1 / wall) },
        B2_styleLayout: { ms: b2, pctOfTask: pct(b2, task), msPerS: r3(b2 / wall) },
        B3_gc: { ms: b3, pctOfTask: pct(b3, task), msPerS: r3(b3 / wall) },
        B4_paintComposite: { ms: b4, pctOfTask: b4 == null ? null : pct(b4, task), msPerS: b4 == null ? null : r3(b4 / wall) },
        B4_renderUpper: { ms: b4hi, pctOfTask: b4hi == null ? null : pct(b4hi, task), msPerS: b4hi == null ? null : r3(b4hi / wall) },
        B5_programUnclassified: { ms: b5, pctOfTask: pct(b5, task), msPerS: r3(b5 / wall) },
        B5_programLowerBound: { ms: b5lower, pctOfTask: pct(b5lower, task), msPerS: r3(b5lower / wall) },
        sumExplained: { ms: sumA, pctOfTask: pct(sumA, task) }, sumExplainedUpper: { ms: sumAhi, pctOfTask: pct(sumAhi, task) },
        residualRobustPct: pct(residualRobust, task), residualRobustMs: residualRobust,
        overAttribution: sumA > task * 1.02, underAttribution: b5lower < -0.5, residualIncludesUnmeasuredPaint: b4lo == null,
      },
      heap: w.heap, heap4s: w.heap4s, longtasks: w.longtasks, raf: w.raf,
      reconcile: w.reconcile, integrity: w.integrity, concurrency: w.concurrency,
      profileSpan: w.profile.spanIntegrity, traceBytes: w.traceBytes, traceParseMs: w.traceParseMs, traceSkipped: w.traceSkipped,
      traceThreads: w.trace ? w.trace.threads : null, mainAllUnionMs: w.trace ? w.trace.mainAllUnionMs : null, runTaskUnionMs: w.trace ? w.trace.runTaskUnionMs : null,
      nativeTop: w.profile.nativeNourlTop, programTop: w.profile.programTop, jsByUrl: w.profile.jsByUrl, ctx,
      traceNames: w.trace && !w.trace.parseError ? w.trace.names : null,
    });
  }
}
const clickRows = rep.loads.filter((L) => !L.alloc).map((L) => ({ label: L.label, clickHeap: L.clickHeap, gcWithin2s: L.clickGcWithin2s, gcMsWithin2s: L.clickGcTotalMsWithin2s, rel: L.clickGcEntriesRel || [], anchorOk: !!(L.clickGcEntriesRel && L.clickGcEntriesRel.length) }));

say('');
say('## 1. per-window core (absolute ms/s are CONTENDED-CONDITION dependent; use shares/ratios)');
say('load   win     trace wall  task/s  script/s  recalc/s  layout/s  gcPO/s  gcPO#  gcPOavg  gcTrTop  paint/s  prof/s  prof/task  gcPO/task  [program]%  native%  js%  ofNonIdle');
for (const r of windows) {
  say([r.load.padEnd(6), r.win.padEnd(6), (r.noTrace ? 'off' : 'on ').padEnd(5), pad(r.wallSec, 4), pad(r.taskMsPerS, 7), pad(r.scriptMsPerS, 9), pad(r.recalcLayoutMsPerS, 9), pad(r.cdpLayoutMsPerS === undefined ? r.layoutMs : r.layoutMs, 8), pad(r.gcPageMsPerS, 7), pad(r.gcPageN, 6), pad(r.gcPagePerWinAvgMs, 8), pad(r.gcTraceTopMs, 8), pad(r.paintCompositeMsPerS, 8), pad(r.profileNonIdleMsPerS, 8), pad(pct(r.profileNonIdleMs, r.taskMs), 9), pad(pct(r.gcPageMs, r.taskMs), 9), pad(r.profileShareOfNonIdle.program, 10), pad(r.profileShareOfNonIdle.native, 8), pad(r.profileShareOfNonIdle.js, 6)].join(' '));
}

say('');
say('## 2. five-bucket attribution (share of CDP TaskDuration = main-thread busy)');
say('   B1=ScriptDuration  B2=Recalc+Layout  B3=PO gc  B4=trace paint/composite union  B5=Task-(B1..B4)');
say('load   win     B1_js%  B2_style%  B3_gc%  B4_paint%(lo-hi)  B5_prog%(hi-lo)  sum%  robust_B5%  largest        flags');
for (const r of windows) {
  const b = r.buckets;
  const midB4 = b.B4_paintComposite.pctOfTask == null ? null : r3((b.B4_paintComposite.pctOfTask + b.B4_renderUpper.pctOfTask) / 2);
  const cand = [['B1_js', b.B1_js.pctOfTask], ['B2_style', b.B2_styleLayout.pctOfTask], ['B3_gc', b.B3_gc.pctOfTask], ['B4_paint', midB4], ['B5_prog', b.B5_programUnclassified.pctOfTask]].filter((x) => x[1] != null);
  const largest = cand.slice().sort((a, c) => c[1] - a[1])[0];
  const flags = [b.overAttribution ? 'OVER' : '', b.underAttribution ? 'UNDER' : '', b.residualIncludesUnmeasuredPaint ? 'B4-UNMEASURED' : ''].filter(Boolean).join(',');
  const b4s = b.B4_paintComposite.pctOfTask == null ? '-' : `${b.B4_paintComposite.pctOfTask}-${b.B4_renderUpper.pctOfTask}`;
  const b5s = b.B5_programLowerBound.pctOfTask == null ? '-' : `${b.B5_programUnclassified.pctOfTask}-${b.B5_programLowerBound.pctOfTask}`;
  say([r.load.padEnd(6), r.win.padEnd(6), pad(b.B1_js.pctOfTask, 7), pad(b.B2_styleLayout.pctOfTask, 10), pad(b.B3_gc.pctOfTask, 7), pad(b4s, 16), pad(b5s, 15), pad(b.sumExplained.pctOfTask, 5), pad(b.residualRobustPct, 11), ` ${largest[0]}(${largest[1]}%)`.padEnd(16), ' ' + flags].join(' '));
}
{
  const valid = windows.filter((r) => !r.allocLoad);
  const mean = (f, rs = valid) => r3(rs.reduce((a, b) => a + f(b), 0) / Math.max(1, rs.length));
  say(`  MEAN(L1+L2) B1=${mean((r) => r.buckets.B1_js.pctOfTask)}% B2=${mean((r) => r.buckets.B2_styleLayout.pctOfTask)}% B3=${mean((r) => r.buckets.B3_gc.pctOfTask)}% B4=${mean((r) => r.buckets.B4_paintComposite.pctOfTask)}-${mean((r) => r.buckets.B4_renderUpper.pctOfTask)}% B5=${mean((r) => r.buckets.B5_programUnclassified.pctOfTask)}-${mean((r) => r.buckets.B5_programLowerBound.pctOfTask)}% robustB5=${mean((r) => r.buckets.residualRobustPct)}% sum=${mean((r) => r.buckets.sumExplained.pctOfTask)}-${mean((r) => r.buckets.sumExplainedUpper.pctOfTask)}%`);
  say(`  cross-check B2 vs trace style/layout union: B2ms=${mean((r) => r.recalcLayoutMs)} traceUnionMs=${mean((r) => r.styleLayoutUnionMs)} ratio(trace/B2)=${r3(mean((r) => r.styleLayoutUnionMs) / Math.max(0.001, mean((r) => r.recalcLayoutMs)))}`);
  say(`  observed sampling interval (median, us): ${mean((r) => r.profile && r.profile.medianSampleUs)} (requested ${rep.meta.samplingUs}) | profile span integrity ratio: ${mean((r) => r.profileSpan && r.profileSpan.ratio)}`);
}

say('');
say('## 3. profile class shares (denominator = non-idle self time of the CDP CPU profile)');
say('load   win     nonIdleMs  idleMs  program%  gc%   native%  js-url%  noUrl%  top (program) parent');
for (const r of windows) {
  const cl = r.profileClasses, nonIdle = r.profileNonIdleMs;
  const noUrl = r3((((cl.program || {}).selfMs || 0) + ((cl['native-nourl'] || {}).selfMs || 0)) / Math.max(0.001, nonIdle) * 100);
  const tp = r.ctx && r.ctx.program && r.ctx.program.top[0] ? `${r.ctx.program.top[0].label}=${r.ctx.program.top[0].selfMs}ms` : (r.ctx && r.ctx.err ? 'ctx-err' : '-');
  say([r.load.padEnd(6), r.win.padEnd(6), pad(nonIdle, 9), pad((cl.idle || {}).selfMs || 0, 7), pad(r.profileShareOfNonIdle.program, 8), pad(r.profileShareOfNonIdle.gc, 5), pad(r.profileShareOfNonIdle.native, 8), pad(r.profileShareOfNonIdle.js, 8), pad(noUrl, 7), ' ' + tp].join(' '));
}

say('');
say('## 4. named empty-URL (builtin/native) self-time, top 8 per window');
for (const r of windows) say(`  ${r.load}/${r.win}: ${(r.nativeTop || []).slice(0, 8).map((x) => `${x.fn}=${x.selfMs}`).join(', ') || '-'}`);

say('');
say('## 5. (program) attribution path (nearest non-program ancestor of (program) samples)');
for (const r of windows) {
  if (!r.ctx || !r.ctx.program) { say(`  ${r.load}/${r.win}: ${r.ctx && r.ctx.err ? 'ctx error ' + r.ctx.err : 'no data'}`); continue; }
  say(`  ${r.load}/${r.win}: total=${r.ctx.program.totalMs}ms  ${r.ctx.program.top.slice(0, 6).map((x) => `${x.label}=${x.selfMs}ms(${x.hits})`).join(' | ') || '(none)'}`);
}

say('');
say('## 6. GC detail (three independent views)');
say('load   win     PO_n  PO_ms  PO_avg  PO_kinds            traceTop_ms  traceTop_n  traceUnion_ms  nestedINFLATED_ms  allThread_ms  profile_gc%');
for (const r of windows) {
  say([r.load.padEnd(6), r.win.padEnd(6), pad(r.gcPageN, 5), pad(r.gcPageMs, 6), pad(r.gcPagePerWinAvgMs, 7), String(JSON.stringify(r.gcPageKinds)).padEnd(20), pad(r.gcTraceTopMs, 12), pad(r.gcTraceTopN, 11), pad(r.gcTraceUnionMs, 14), pad(r.gcTraceNestedInflatedMs, 17), pad(r.gcTraceAllThreadMs, 13), pad(r.gcProfileSharePct, 10)].join(' '));
}
say(`  NOTE profile_gc% is a quantization-limited lower bound (V8 charges in-script GC to the calling JS frame); nestedINFLATED_ms double-counts nested V8.GC_* sub-phases and must not be used.`);

say('');
say('## 7. heap: allocation rate & GC drops, click±2s vs 4s window centres');
for (const r of windows) {
  const h = r.heap4s || {};
  say(`  ${r.load}/${r.win} 4s-center: alloc=${h.grossAllocMiBPerS}MiB/s net=${h.netGrowthMiB}MiB slope=${h.linSlopeMiBPerS}MiB/s gcDrops=${h.gcDropCount} avgDrop=${h.gcDropAvgMiB}MiB n=${h.n} min=${h.minMiB} max=${h.maxMiB}`);
}
for (const c of clickRows) say(`  ${c.label} click±2s: alloc=${c.clickHeap ? c.clickHeap.grossAllocMiBPerS : '-'}MiB/s net=${c.clickHeap ? c.clickHeap.netGrowthMiB : '-'}MiB slope=${c.clickHeap ? c.clickHeap.linSlopeMiBPerS : '-'}MiB/s gcDrops=${c.clickHeap ? c.clickHeap.gcDropCount : '-'} avgDrop=${c.clickHeap ? c.clickHeap.gcDropAvgMiB : '-'}MiB n=${c.clickHeap ? c.clickHeap.n : '-'} | PO gc entries within ±2s=${c.gcWithin2s} totalling ${c.gcMsWithin2s}ms`);
for (const L of rep.loads) if (L.alloc) say(`  ${L.label} ALLOC-SAMPLING total=${L.alloc.totalMiB}MiB nodes=${L.alloc.nodeCount} top=${(L.alloc.top || []).slice(0, 10).map((x) => `${x.fn}=${x.MiB}MiB`).join(', ')}`);
for (const L of rep.loads) if (L.alloc) say(`  ${L.label} ALLOC by bundle: ${(L.alloc.byUrl || []).slice(0, 8).map((x) => `${x.url.split('/').pop()}=${x.MiB}MiB`).join(', ')}`);

say('');
say('## 8. integrity & instrument self-checks');
for (const r of windows) {
  say(`  ${r.load}/${r.win}: gcObserved=${r.integrity.gcObserved} profSamples=${r.integrity.profileSamples} unitOk=${r.integrity.profileUnitOk} spanOk=${r.integrity.profileSpanOk}(${r.profileSpan ? r.profileSpan.ratio : '-'}) traceParsed=${r.integrity.traceParsed} mainTid=${r.traceThreads ? r.traceThreads[0].thread : '-'} mainTidSanity=${r.integrity.mainTidSanity} heapN=${r.integrity.heapSamples} rafOk=${r.integrity.rafCounting} reconcile(prof/(script+recalc))=${r.reconcile.ratioProfileVsScriptRecalc} traceRunTask/task=${r.reconcile.ratioTraceRunTaskVsTask} traceStyleLayout/CDP=${r.reconcile.ratioTraceStyleLayoutVsCdp} excl=${r.concurrency.exclusiveThroughout}(start f=${r.concurrency.censusW0.foreignCount}/end f=${r.concurrency.censusW1.foreignCount}) traceMB=${r3((r.traceBytes || 0) / 1048576)} traceParseMs=${r.traceParseMs}`);
}
say(`  click: ${rep.loads.map((L) => L.settings && L.settings.clickInfo ? `${L.label}: clicked=${L.settings.clickInfo.clicked} sel=${L.settings.clickInfo.selector} label=${L.settings.clickInfo.label} latency=${L.settings.clickInfo.latencyMs}ms guardSkips=${L.settings.clickInfo.guardedSkip.length}` : `${L.label}:-`).join(' | ')}`);
say(`  settingsOpened: ${rep.loads.map((L) => `${L.label}=${L.integrity.settingsOpened}`).join(' ')}`);
say(`  pageErrors: ${rep.loads.map((L) => `${L.label}=${L.errors.length}`).join(' ')} ${JSON.stringify((rep.loads[0] || {}).errors || []).slice(0, 240)}`);
say(`  paint names actually seen: ${JSON.stringify((windows.find((r) => r.paintNamesSeen) || {}).paintNamesSeen)}  styleLayout names: ${JSON.stringify((windows.find((r) => r.styleLayoutNamesSeen) || {}).styleLayoutNamesSeen)}`);

say('');
say('## 9. top main-thread trace event names (independent view of where B1/B5 live)');
for (const r of windows) {
  if (!r.traceNames) { say(`  ${r.load}/${r.win}: (no trace)`); continue; }
  const skip = /^(RunTask|Task|ThreadControllerImpl::RunTask|MessageLoop::RunTask|SequenceManager|DrawFrame|BeginFrame|PrePaint|ActivateLayerTree|ProxyMain|TracingStartedInBrowser|ResourceLoad|Frame|FramePresenter|Commit|CompositeLayers|Paint|Layout|UpdateLayoutTree)$/;
  const top = Object.entries(r.traceNames).filter(([k]) => !skip.test(k)).map(([k, v]) => ({ name: k, durMs: v.durMs, n: v.n, pct: pct(v.durMs, r.taskMs) })).sort((a, b) => b.durMs - a.durMs).slice(0, 12);
  say(`  ${r.load}/${r.win}: ` + top.map((x) => `${x.name}:${x.durMs}ms/${x.n}x/${x.pct}%`).join(' '));
}

say('');
say('## 10. cold-open vs steady vs click (L1/L2 only) + tracing-off control');
{
  const pick = (win, rs = windows.filter((r) => !r.allocLoad && (r.load === 'L1' || r.load === 'L2'))) => rs.filter((r) => r.win === win);
  const mm = (rs, f) => r3(rs.reduce((a, b) => a + f(b), 0) / Math.max(1, rs.length));
  for (const win of ['cold', 'click', 'steady']) {
    const rs = pick(win); if (!rs.length) continue;
    say(`  ${win.padEnd(6)} n=${rs.length} task/s=${mm(rs, (r) => r.taskMsPerS)} script/s=${mm(rs, (r) => r.scriptMsPerS)} styleLay/s=${mm(rs, (r) => r.recalcLayoutMsPerS)} gc/s=${mm(rs, (r) => r.gcPageMsPerS)} gcN/win=${mm(rs, (r) => r.gcPageN)} gcMs/win=${mm(rs, (r) => r.gcPageMs)} paint/s=${mm(rs, (r) => r.paintCompositeMsPerS)} profBusy/s=${mm(rs, (r) => r.profileNonIdleMsPerS)}`);
    say(`         shares of task: B1=${mm(rs, (r) => r.buckets.B1_js.pctOfTask)}% B2=${mm(rs, (r) => r.buckets.B2_styleLayout.pctOfTask)}% B3=${mm(rs, (r) => r.buckets.B3_gc.pctOfTask)}% B4=${mm(rs, (r) => r.buckets.B4_paintComposite.pctOfTask)}% B5=${mm(rs, (r) => r.buckets.B5_programUnclassified.pctOfTask)}% | profile shares of non-idle: program=${mm(rs, (r) => r.profileShareOfNonIdle.program)}% gc=${mm(rs, (r) => r.profileShareOfNonIdle.gc)}% native=${mm(rs, (r) => r.profileShareOfNonIdle.native)}% js=${mm(rs, (r) => r.profileShareOfNonIdle.js)}%`);
  }
  const c = pick('cold'), s = pick('steady');
  if (c.length && s.length) say(`  cold/steady ratio: task=${r3(mm(c, (r) => r.taskMsPerS) / Math.max(0.001, mm(s, (r) => r.taskMsPerS)))} script=${r3(mm(c, (r) => r.scriptMsPerS) / Math.max(0.001, mm(s, (r) => r.scriptMsPerS)))} gc=${r3(mm(c, (r) => r.gcPageMsPerS) / Math.max(0.001, mm(s, (r) => r.gcPageMsPerS)))} gcCount=${r3(mm(c, (r) => r.gcPageN) / Math.max(0.001, mm(s, (r) => r.gcPageN)))} styleLay=${r3(mm(c, (r) => r.recalcLayoutMsPerS) / Math.max(0.001, mm(s, (r) => r.recalcLayoutMsPerS)))} profBusy=${r3(mm(c, (r) => r.profileNonIdleMsPerS) / Math.max(0.001, mm(s, (r) => r.profileNonIdleMsPerS)))}`);
  const traced = windows.filter((r) => !r.allocLoad && r.win === 'steady' && !r.noTrace);
  const untraced = windows.filter((r) => !r.allocLoad && r.win === 'steady' && r.noTrace);
  if (traced.length && untraced.length) say(`  INSTRUMENT CONTROL steady traced(n=${traced.length}) vs tracing-off(n=${untraced.length}): task/s ${mm(traced, (r) => r.taskMsPerS)} vs ${mm(untraced, (r) => r.taskMsPerS)} | script/s ${mm(traced, (r) => r.scriptMsPerS)} vs ${mm(untraced, (r) => r.scriptMsPerS)} | gcN ${mm(traced, (r) => r.gcPageN)} vs ${mm(untraced, (r) => r.gcPageN)} | profBusy/s ${mm(traced, (r) => r.profileNonIdleMsPerS)} vs ${mm(untraced, (r) => r.profileNonIdleMsPerS)}  (ratios only; single window each)`);
}

say('');
say('## 11. cross-window relation (is (program) Blink C++ or V8 builtin/IC?) — CORRELATIONAL ONLY');
{
  const rs = windows.filter((r) => r.profileNonIdleMsPerS > 0 && !r.allocLoad);
  const xs = rs.map((r) => ((r.profileClasses.program || {}).selfMs || 0) / r.wallSec);
  const ys = rs.map((r) => r.recalcLayoutMsPerS + (r.paintCompositeMsPerS || 0));
  const zs = rs.map((r) => ((r.profileClasses['native-nourl'] || {}).selfMs || 0) / r.wallSec);
  const gs = rs.map((r) => r.gcPageMsPerS);
  const pear = (a, b) => { const n = a.length; const ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n; let nu = 0, da = 0, dbb = 0; for (let i = 0; i < n; i++) { nu += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; dbb += (b[i] - mb) ** 2; } return r3(nu / Math.sqrt(Math.max(1e-9, da * dbb))); };
  say(`  n=${rs.length} pearson(program, styleLayout+paint)=${pear(xs, ys)} pearson(native, styleLayout+paint)=${pear(zs, ys)} pearson(gc, task)=${pear(gs, rs.map((r) => r.taskMsPerS))} pearson(program, native)=${pear(xs, zs)}`);
  say(`  program ms/s: ${xs.map((v) => r3(v)).join(', ')}`);
  say(`  native  ms/s: ${zs.map((v) => r3(v)).join(', ')}`);
  say(`  gcPO    ms/s: ${gs.map((v) => r3(v)).join(', ')}`);
}

say('');
say('## 12. PRE-FIX vs POST-FIX structural comparison');
say('  PRE-FIX baseline: revs abdb7f55acba, 186 profile windows from the earlier line (research-v2/cpu-profile)');
try {
  const pk = JSON.parse(fs.readFileSync(path.join(OUT, 'prior-buckets.json'), 'utf8'));
  const a = pk.all, cx = pk.byBatch.cpuX, cl2 = pk.byBatch.cpuL;
  const fmt = (x) => x ? `n=${x.n} task=${x.meanTaskMsPerS}ms/s B1=${x.meanBucketPctOfTask.B1_js}% B2=${x.meanBucketPctOfTask.B2_styleLayout}% B3=${x.meanBucketPctOfTask.B3_gc}% B5(incl.paint)=${x.meanBucketPctOfTask.B5_programAndCpp}% apply=${x.meanApplyShareOfTaskPct}% classes(program/gc/native/js)=${x.meanClassShareOfNonIdlePct.program}/${x.meanClassShareOfNonIdlePct.gc}/${x.meanClassShareOfNonIdlePct.native}/${x.meanClassShareOfNonIdlePct.js}%` : 'none';
  say(`  PRE-FIX all      : ${fmt(a)}`);
  say(`  PRE-FIX cpuX     : ${fmt(cx)}`);
  say(`  PRE-FIX cpuL     : ${fmt(cl2)}`);
  say(`  PRE-FIX by scenario:`);
  for (const [k, v] of Object.entries(pk.byScen)) say(`    ${k.padEnd(22)} ${fmt(v)}`);
} catch (e) { say('  (prior-buckets.json unavailable: ' + String(e).slice(0, 80) + ')'); }
{
  const valid = windows.filter((r) => !r.allocLoad);
  const mm = (f, rs = valid) => r3(rs.reduce((a, b) => a + f(b), 0) / Math.max(1, rs.length));
  say(`  POST-FIX today n=${valid.length}: task=${mm((r) => r.taskMsPerS)}ms/s B1=${mm((r) => r.buckets.B1_js.pctOfTask)}% B2=${mm((r) => r.buckets.B2_styleLayout.pctOfTask)}% B3=${mm((r) => r.buckets.B3_gc.pctOfTask)}% B4=${mm((r) => r.buckets.B4_paintComposite.pctOfTask)}% B5=${mm((r) => r.buckets.B5_programUnclassified.pctOfTask)}% classes(program/gc/native/js)=${mm((r) => r.profileShareOfNonIdle.program)}/${mm((r) => r.profileShareOfNonIdle.gc)}/${mm((r) => r.profileShareOfNonIdle.native)}/${mm((r) => r.profileShareOfNonIdle.js)}%`);
  const uiLayoutJs = valid.map((r) => (r.jsByUrl || []).filter((u) => /ui-layout/.test(u.url)).reduce((s, u) => s + u.selfMs, 0));
  say(`  POST-FIX ui-layout (ex-`+'`apply`'+` host) JS self ms/win: ${uiLayoutJs.map((v) => r3(v)).join(', ')}`);
}

const summary = {
  file: path.basename(file), stamp, meta: rep.meta, gate: rep.gate, censusPre: rep.censusPre, censusPost: rep.censusPost, windows, clickRows,
  settings: rep.loads.map((L) => ({ label: L.label, settings: L.settings, alloc: L.alloc || null, errors: L.errors, integrity: L.integrity })),
};
fs.writeFileSync(path.join(OUT, `summary-${stamp}.json`), JSON.stringify(summary, null, 1));
fs.writeFileSync(path.join(OUT, `summary-${stamp}.txt`), lines.join('\n') + '\n');
console.log(`\n[analyze] wrote ${path.join(OUT, `summary-${stamp}.json`)} and .txt (${windows.length} windows)`);
