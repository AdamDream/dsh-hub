#!/usr/bin/env node
// capture-gc.mjs — GC observation + (program)/builtin share + five-bucket main-thread attribution
// Line: incident2/gc-residual. Read-only against the host GUI (http://127.0.0.1:3080).
//
// Instruments per window (fresh page-level CDP session per window):
//   * PerformanceObserver({entryTypes:['gc','longtask']}) registered at document start (page clock)
//   * Runtime.getHeapUsage polled continuously (250 ms) -> heap growth / alloc rate / GC drops
//   * CDP Profiler.start/stop (sampling interval configurable) -> self-time top table incl.
//     (program) / (garbage collector) / (idle) / named-native-with-empty-url
//   * CDP Tracing (browser-level session) -> Blink recalc/layout/paint/composite spans + V8 GC events
//   * Performance.getMetrics deltas -> authoritative Task/Script/Recalc/Layout durations + counts
//   * HeapProfiler.startSampling (allocation load) -> bytes allocated per call frame
//
// Auditor-driven corrections baked in (see verify/method-audit.md):
//   S2  hard pre-launch exclusivity gate + per-window census (start/end) and invalidation flag
//   S4  trace categories include `disabled-by-default-devtools.timeline` (the category that emits
//       RunTask); without it main-thread identification failed and every paint span was dropped
//   S5  Performance.getMetrics m1 is sampled immediately at window end, BEFORE Profiler.stop and the
//       trace download/parse (which can take seconds), and the rate denominator is the metric-sampling
//       interval itself -> numerator and denominator now describe the same interval
//   S7  GC is reported as non-overlapping union + top-level MajorGC/MinorGC sums; the nested V8.GC_*
//       sum is kept but explicitly labelled as inflated
//   S8  the cold window now CONTAINS the navigation (goto runs inside the window)
//   S9  the click is anchored on a page-side performance.now() mark; the click window is closed at
//       exactly click+CLICK_POST (previously click+2s+clickLatency)
//   S10 counts are differenced WITHOUT the x1000 duration scaling; profile span integrity is checked
//   S11 L2's steady window runs with tracing disabled (instrument-overhead control)
//
// Discipline: single browser; only the Settings entry is clicked (guarded against 保存/应用/删除);
// everything is read-only; the caller must hold research-v2/.probe.lock for the whole run.
import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = '/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/gc-residual';
const RAW = path.join(ROOT, 'raw');
const LOGS = path.join(ROOT, 'logs');
const TARGET = 'http://127.0.0.1:3080';
const LOCKDIR = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/.probe.lock';
fs.mkdirSync(RAW, { recursive: true });
fs.mkdirSync(LOGS, { recursive: true });

const argv = process.argv.slice(2);
const argOf = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const MODE = argOf('mode', 'full');
const STAMP = argOf('stamp', 'gc-' + new Date().toISOString().replace(/[:.]/g, '-'));
const SAMPLING_US = Number(argOf('sampling', 500));
const CATS = argOf('cats', 'devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing,v8,disabled-by-default-v8.gc');
const SKIP_GATE = argOf('skipgate', '0') === '1';
const r3 = (x) => (x == null || !isFinite(x) ? null : Math.round(x * 1000) / 1000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => { const s = a.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' '); console.log(s); fs.appendFileSync(path.join(LOGS, `${STAMP}.log`), s + '\n'); };

const W = MODE === 'smoke'
  ? { COLD: 5000, GAP: 1000, CLICK_PRE: 1500, CLICK_POST: 1500, SETTLE: 3000, STEADY: 5000, ALLOC_TAIL: 2000 }
  : { COLD: 8000, GAP: 2000, CLICK_PRE: 2000, CLICK_POST: 2000, SETTLE: 8000, STEADY: 10000, ALLOC_TAIL: 4000 };

// ---------------------------------------------------------------- ownership / concurrency census
function exec(cmd, args) { return execFileSync(cmd, args, { maxBuffer: 32 * 1024 * 1024 }).toString().split('\n'); }
function browserInstances() {
  const out = [];
  let lines = [];
  try { lines = exec('ps', ['-eo', 'pid,ppid,etime,cmd', '--no-headers']); } catch { return out; }
  for (const l of lines) {
    if (!/--remote-debugging-pipe/.test(l)) continue;
    if (/--type=/.test(l)) continue;
    const m = l.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    const pid = Number(m[1]);
    let ppid = Number(m[2]);
    const chain = [];
    for (let i = 0; i < 6 && ppid > 1; i++) {
      chain.push(ppid);
      try { const st = fs.readFileSync(`/proc/${ppid}/stat`, 'utf8'); ppid = Number(st.slice(st.lastIndexOf(')') + 2).split(' ')[1]); } catch { break; }
    }
    out.push({ pid, ppid: Number(m[2]), etime: m[3], ancestors: chain, cmdHead: m[4].replace(/\s+/g, ' ').slice(0, 120) });
  }
  return out;
}
// host pid by /proc/<pid>/cmdline scan (deliberately NOT `pgrep -f`, which self-matches the caller)
function hostPid() {
  try {
    for (const d of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(d)) continue;
      let c = ''; try { c = fs.readFileSync(`/proc/${d}/cmdline`, 'utf8'); } catch { continue; }
      if (/bin\/dsh\0web|bin\/dsh web/.test(c)) return Number(d);
    }
  } catch { }
  return null;
}
function censusNow(myPids) {
  const inst = browserInstances();
  const mine = inst.filter((b) => b.ancestors.includes(process.pid) || b.ancestors.includes(process.ppid) || myPids.has(b.pid) || myPids.has(b.ppid));
  const foreign = inst.filter((b) => !mine.includes(b));
  let lockOwner = null;
  try { lockOwner = fs.readFileSync(path.join(LOCKDIR, 'owner.txt'), 'utf8').split('\n').slice(0, 4).join(' | '); } catch { }
  let load = null; try { load = fs.readFileSync('/proc/loadavg', 'utf8').trim(); } catch { }
  return {
    at: new Date().toISOString(), instances: inst.length, mineCount: mine.length,
    mine: mine.map((b) => ({ pid: b.pid, etime: b.etime })),
    foreignCount: foreign.length, foreign: foreign.map((b) => ({ pid: b.pid, etime: b.etime, cmdHead: b.cmdHead })),
    lockOwner, lockHeldByLine: !!(lockOwner && /owner=gc-residual/.test(lockOwner)), hostPid: hostPid(), load,
  };
}

// ---------------------------------------------------------------- page-side hooks
function initHooks() {
  window.__hook = { gc: [], lt: [], raf: [], gcErr: null, ltErr: null };
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__hook.gc.push({ t: e.startTime, d: e.duration, name: e.name, detail: e.detail ? { kind: e.detail.kind, count: e.detail.count } : null }); }).observe({ entryTypes: ['gc'] });
  } catch (err) { window.__hook.gcErr = String(err); }
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__hook.lt.push({ t: e.startTime, d: e.duration, name: e.name }); }).observe({ entryTypes: ['longtask'] });
  } catch (err) { window.__hook.ltErr = String(err); }
  try { requestAnimationFrame(function f(t) { window.__hook.raf.push(t); requestAnimationFrame(f); }); } catch { }
  window.__drain = () => {
    const g = window.__hook.gc.splice(0), lt = window.__hook.lt.splice(0), rf = window.__hook.raf.splice(0);
    return { gc: g, lt, raf: rf, gcErr: window.__hook.gcErr, ltErr: window.__hook.ltErr, timeOrigin: performance.timeOrigin, now: performance.now() };
  };
  window.__probe = () => ({
    url: location.href, title: document.title, nodes: document.getElementsByTagName('*').length,
    mem: performance.memory ? { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize } : null,
    text: (document.body ? document.body.innerText : '').slice(0, 400),
  });
}
const guardedRe = /保存|应用|删除|重置|清空|移除|Save|Apply|Delete|Reset|Remove/i;

// ---------------------------------------------------------------- CDP helpers
function metricsOf(res) { return Object.fromEntries(res.metrics.map((m) => [m.name, m.value])); }

// main-thread paint / composite spans (bucket 4). PrePaint (wraps Paint) and DrawFrame (wraps
// Commit/CompositeLayers) are deliberately excluded so aggregator spans do not inflate the union;
// the union helper additionally removes any remaining intra-bucket nesting.
const PC_RE = /^(Paint|PaintSetup|Commit|CompositeLayers|Layerize|RasterTask|GPUTask|ImageDecodeTask|DrawLazyPixelRef|PaintImage|Rasterize)$/;
// upper-bound render lifecycle set: adds the Blink lifecycle/aggregator phases that the auditor
// showed are emitted as siblings (not parents) of Paint on this Chromium build, so that B4 can be
// reported as [lower bound, upper bound] instead of one arbitrary choice.
const RENDER_UPPER_RE = /^(Paint|PaintSetup|Commit|CompositeLayers|Layerize|RasterTask|GPUTask|ImageDecodeTask|DrawLazyPixelRef|PaintImage|Rasterize|PrePaint|UpdateLayerTree|UpdateLayer|UpdateLifecycle|AnimationFrame::StyleAndLayout|HitTest|ScrollingCoordinator)$/;
const SL_RE = /^(UpdateLayoutTree|RecalculateStyle|Layout|PrePaint|UpdateLayerTree|InvalidateLayout|ScheduleStyleRecalculation)$/;
const GC_RE = /^(MajorGC|MinorGC|BlinkGC\.|V8\.GC|IncrementalMarking|CppGC)/;
const GC_TOP_RE = /^(MajorGC|MinorGC)$/;
function unionMs(intervals) {
  if (!intervals.length) return 0;
  const a = intervals.slice().sort((x, y) => x[0] - y[0]);
  let total = 0, cs = a[0][0], ce = a[0][1];
  for (let i = 1; i < a.length; i++) {
    if (a[i][0] <= ce) ce = Math.max(ce, a[i][1]);
    else { total += ce - cs; cs = a[i][0]; ce = a[i][1]; }
  }
  total += ce - cs;
  return r3(total / 1000);
}

function aggProfile(profile) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const selfUs = new Map(); const hits = new Map();
  const { samples = [], timeDeltas = [] } = profile;
  for (let i = 0; i < samples.length; i++) {
    const dt = timeDeltas[i] || 0;
    const id = samples[i];
    selfUs.set(id, (selfUs.get(id) || 0) + dt);
    hits.set(id, (hits.get(id) || 0) + 1);
  }
  const rows = [];
  for (const [id, us] of selfUs) {
    const n = byId.get(id); if (!n) continue;
    const cf = n.callFrame || {};
    const fn = cf.functionName || '';
    const url = cf.url || '';
    let cls;
    if (fn === '(idle)') cls = 'idle';
    else if (fn === '(root)') cls = 'root';
    else if (fn === '(program)') cls = 'program';
    else if (fn === '(garbage collector)') cls = 'gc';
    else if (!url) cls = 'native-nourl';
    else cls = 'js-url';
    rows.push({ id, fn, url, line: cf.lineNumber, col: cf.columnNumber, cls, selfMs: us / 1000, hits: hits.get(id) || 0 });
  }
  const nonIdle = rows.filter((r) => r.cls !== 'idle' && r.cls !== 'root');
  const busyMs = nonIdle.reduce((a, b) => a + b.selfMs, 0);
  const byClass = {};
  for (const r of rows) { const b = (byClass[r.cls] = byClass[r.cls] || { selfMs: 0, hits: 0, fns: 0 }); b.selfMs += r.selfMs; b.hits += r.hits; b.fns++; }
  const totalMs = rows.reduce((a, b) => a + b.selfMs, 0);
  const dts = timeDeltas.filter((d) => d > 0).sort((a, b) => a - b);
  const medDt = dts.length ? dts[Math.floor(dts.length / 2)] : 0;
  const spanUs = (profile.endTime || 0) - (profile.startTime || 0);
  const sumDtUs = timeDeltas.reduce((a, b) => a + b, 0);
  return {
    sampleCount: samples.length, nodeCount: profile.nodes.length, totalMs: r3(totalMs), busyMs: r3(busyMs),
    medianSampleUs: medDt, byClass: Object.fromEntries(Object.entries(byClass).map(([k, v]) => [k, { selfMs: r3(v.selfMs), hits: v.hits, fns: v.fns }])),
    top: rows.slice().sort((a, b) => b.selfMs - a.selfMs).slice(0, 60),
    busyTop: nonIdle.slice().sort((a, b) => b.selfMs - a.selfMs).slice(0, 60),
    jsByUrl: (() => {
      const m = new Map();
      for (const r of rows) { if (r.cls !== 'js-url') continue; const b = m.get(r.url) || { url: r.url, selfMs: 0, fns: 0 }; b.selfMs += r.selfMs; b.fns++; m.set(r.url, b); }
      return [...m.values()].map((b) => ({ ...b, selfMs: r3(b.selfMs) })).sort((a, b) => b.selfMs - a.selfMs).slice(0, 25);
    })(),
    nativeNourlTop: rows.filter((r) => r.cls === 'native-nourl').sort((a, b) => b.selfMs - a.selfMs).slice(0, 40),
    programTop: rows.filter((r) => r.cls === 'program').sort((a, b) => b.selfMs - a.selfMs).slice(0, 20),
    spanIntegrity: { profileSpanMs: r3(spanUs / 1000), sumTimeDeltasMs: r3(sumDtUs / 1000), ratio: r3(sumDtUs / Math.max(1, spanUs)) },
  };
}

function aggTrace(events, taskMs) {
  const runByTid = new Map();
  for (const e of events) {
    if (e.ph !== 'X' || e.name !== 'RunTask') continue;
    const k = `${e.pid}:${e.tid}`;
    runByTid.set(k, (runByTid.get(k) || 0) + 1);
  }
  let main = null;
  for (const [k, n] of runByTid) if (!main || n > main.n) main = { k, n };
  const names = {}; const gcAll = []; const pidHist = {};
  const pcInt = [], pcHiInt = [], slInt = [], gcMainInt = [], gcTopInt = [], allInt = [], runInt = [];
  const mainTid = main ? main.k : null;
  for (const e of events) {
    if (e.ph !== 'X') continue;
    const k = `${e.pid}:${e.tid}`;
    pidHist[k] = (pidHist[k] || 0) + 1;
    if (GC_RE.test(e.name)) {
      const g = { name: e.name, pid: e.pid, tid: e.tid, durMs: r3((e.dur || 0) / 1000), main: k === mainTid, ts: e.ts };
      gcAll.push(g);
      if (g.main) {
        gcMainInt.push([e.ts, e.ts + (e.dur || 0)]);
        if (GC_TOP_RE.test(e.name)) gcTopInt.push([e.ts, e.ts + (e.dur || 0)]);
      }
    }
    if (k !== mainTid) continue;
    const b = (names[e.name] = names[e.name] || { n: 0, durMs: 0 });
    b.n++; b.durMs += (e.dur || 0) / 1000;
    allInt.push([e.ts, e.ts + (e.dur || 0)]);
    if (e.name === 'RunTask') runInt.push([e.ts, e.ts + (e.dur || 0)]);
    if (PC_RE.test(e.name)) pcInt.push([e.ts, e.ts + (e.dur || 0)]);
    if (RENDER_UPPER_RE.test(e.name)) pcHiInt.push([e.ts, e.ts + (e.dur || 0)]);
    if (SL_RE.test(e.name)) slInt.push([e.ts, e.ts + (e.dur || 0)]);
  }
  for (const k of Object.keys(names)) names[k].durMs = r3(names[k].durMs);
  const threads = Object.entries(pidHist).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => ({ thread: k, events: n, isMain: k === mainTid }));
  const gcMain = gcAll.filter((g) => g.main);
  const sum = (arr) => r3(arr.reduce((a, v) => a + v.durMs, 0));
  const named = (arr) => Object.entries(arr.reduce((m, g) => { m[g.name] = m[g.name] || { n: 0, durMs: 0 }; m[g.name].n++; m[g.name].durMs += g.durMs; return m; }, {})).map(([name, v]) => ({ name, n: v.n, durMs: r3(v.durMs) }));
  return {
    mainThread: mainTid, mainThreadRunTask: main ? main.n : 0, threads,
    names, gcAllCount: gcAll.length,
    gcMainCount: gcMain.length, gcAllDurMs: sum(gcAll),
    gcMainNestedSumMs: sum(gcMain),                 // INFLATED (nested V8.GC_* sub-phases) - do not use
    gcMainUnionMs: unionMs(gcMainInt),              // non-overlapping union of all main-thread GC spans
    gcMainTopLevelMs: unionMs(gcTopInt),            // union of top-level MajorGC|MinorGC only
    gcMainTopLevelN: gcAll.filter((g) => g.main && GC_TOP_RE.test(g.name)).length,
    gcMainByName: named(gcMain), gcAllByName: named(gcAll),
    paintCompositeSumMs: r3(pcInt.reduce((a, [s, e2]) => a + (e2 - s) / 1000, 0)),
    paintCompositeUnionMs: unionMs(pcInt),
    paintCompositeNamesSeen: [...new Set(Object.keys(names).filter((k) => PC_RE.test(k)))],
    renderUpperUnionMs: unionMs(pcHiInt),
    renderUpperNamesSeen: [...new Set(Object.keys(names).filter((k) => RENDER_UPPER_RE.test(k)))],
    styleLayoutUnionMs: unionMs(slInt),
    styleLayoutNamesSeen: [...new Set(Object.keys(names).filter((k) => SL_RE.test(k)))],
    runTaskUnionMs: unionMs(runInt), mainAllUnionMs: unionMs(allInt),
    mainTidSanity: taskMs > 0 ? r3(unionMs(runInt) / taskMs) : null,
  };
}

// ---------------------------------------------------------------- settings click (read-only)
async function clickSettings(page) {
  const info = { clicked: false, selector: null, label: null, tried: [], guardedSkip: [], latencyMs: null, err: null };
  // Order matters: `button:has-text("设置")` is the selector proven to open the settings surface
  // by the earlier line (reports/settings-jank-audit-live.json -> settingsLoad.clicked).
  const cands = [
    'button:has-text("设置")', '[aria-label*="设置"]', '[title*="设置"]', '[data-testid*="settings" i]',
    'button:has-text("Settings")', '[aria-label*="Settings" i]', '[title*="Settings" i]',
    'a:has-text("设置")', '[role="button"]:has-text("设置")',
  ];
  const t0 = Date.now();
  for (const s of cands) {
    try {
      const loc = page.locator(s);
      const n = await loc.count();
      info.tried.push({ sel: s, n });
      if (!n) continue;
      const first = loc.first();
      const label = (((await first.innerText().catch(() => '')) || '') + ' ' + ((await first.getAttribute('aria-label').catch(() => '')) || '')).trim();
      if (guardedRe.test(label)) { info.guardedSkip.push({ sel: s, label }); continue; }
      await first.click({ timeout: 3000 });
      info.clicked = true; info.selector = s; info.label = label.slice(0, 80); break;
    } catch (e) { info.tried.push({ sel: s, err: String(e).slice(0, 100) }); }
  }
  info.latencyMs = Date.now() - t0;
  return info;
}
async function settingsState(page) {
  return page.evaluate(() => {
    const t = document.body ? document.body.innerText : '';
    const tabs = ['通用', '插件', '模型', '远程', '子代理', 'General', 'Plugins', 'Models'].filter((x) => t.includes(x));
    const panel = [...document.querySelectorAll('[role="dialog"],[class*=settings i],[class*=Settings]')].length;
    return { url: location.href, tabs, panelNodes: panel, textHead: t.slice(0, 300) };
  });
}

// ---------------------------------------------------------------- one load
async function runLoad(browser, { label, mode, allocSampling, noTraceWindows = [] }) {
  const errors = []; const ws = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(initHooks);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text().slice(0, 200)); });
  page.on('websocket', (s) => { let inb = 0, out = 0; s.on('framereceived', () => inb++); s.on('framesent', () => out++); ws.push({ url: s.url(), get inb() { return inb; }, get out() { return out; } }); });

  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  const bcdp = await browser.newBrowserCDPSession();

  // heap poller starts on about:blank so the boot-time ramp is covered; the cold window's heap
  // summary is sliced from the navigation epoch so the blank-page baseline cannot fake a drop.
  const heap = []; let heapStop = false;
  const heapPoller = (async () => { while (!heapStop) { const t = Date.now(); try { const h = await cdp.send('Runtime.getHeapUsage'); heap.push({ t, used: h.usedSize, total: h.totalSize }); } catch { } await sleep(250); } })();

  let clock = null; let tNavEpoch = null;
  const censusStart = censusNow(new Set([process.pid]));
  const tLoad = Date.now();
  const out = { label, mode, windowDefs: W, samplingIntervalUs: SAMPLING_US, cats: CATS, tLoad, tLoadISO: new Date(tLoad).toISOString(), censusStart, windows: [], errors, ws: [], alloc: null, clock: null, settings: null };
  log(`[load ${label}] start ${new Date(tLoad).toISOString()} census foreign=${censusStart.foreignCount} mine=${censusStart.mineCount} lockMine=${censusStart.lockHeldByLine} hostPid=${censusStart.hostPid}`);

  if (allocSampling) {
    await cdp.send('HeapProfiler.enable');
    try { await cdp.send('HeapProfiler.startSampling', { samplingInterval: 16384, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true }); }
    catch { await cdp.send('HeapProfiler.startSampling', { samplingInterval: 16384 }); }
  }

  async function windowRun(name, ms, preAction, opts = {}) {
    const noTrace = !!opts.noTrace;
    const cdpW = await ctx.newCDPSession(page);
    await cdpW.send('Performance.enable');
    await page.evaluate(() => window.__drain()).catch(() => null);   // discard pre-window entries
    const tM0 = Date.now();
    const m0 = metricsOf(await cdpW.send('Performance.getMetrics'));
    const censusW0 = censusNow(new Set([process.pid]));
    const heapI0 = heap.length;
    let traceOn = false, donePromise = null;
    if (!noTrace) {
      try { await bcdp.send('Tracing.start', { categories: CATS, transferMode: 'ReturnAsStream', bufferUsageReportingInterval: 2000 }); traceOn = true; }
      catch (e) { log('[trace] start failed', String(e).slice(0, 120)); }
      if (traceOn) donePromise = new Promise((res) => bcdp.once('Tracing.tracingComplete', res));
    }
    await cdpW.send('Profiler.setSamplingInterval', { interval: SAMPLING_US });
    await cdpW.send('Profiler.enable'); await cdpW.send('Profiler.start');
    const tStart = Date.now();
    let action = null;
    if (preAction) action = await preAction();
    await sleep(ms);
    const tEnd = Date.now();
    // ---- close the accounting interval FIRST: m1 and the page-side drain both happen here, before
    //      Profiler.stop / Tracing.end / trace download, which can take seconds of extra wall time.
    const tM1 = Date.now();
    const m1 = metricsOf(await cdpW.send('Performance.getMetrics'));
    const drain1 = await page.evaluate(() => window.__drain()).catch(() => null);
    const wallS = Math.max(0.001, (tM1 - tM0) / 1000);      // metric-consistent denominator
    const { profile } = await cdpW.send('Profiler.stop');
    let traceAgg = null, traceBytes = 0, traceParseMs = null, traceSkipped = null;
    if (traceOn) {
      const tTr0 = Date.now();
      await bcdp.send('Tracing.end');
      const ev = await donePromise;
      let data = '';
      if (ev && ev.stream) {
        for (; ;) {
          const r = await bcdp.send('IO.read', { handle: ev.stream, size: 8 * 1024 * 1024 });
          data += r.base64Encoded ? Buffer.from(r.data, 'base64').toString('utf8') : r.data;
          if (r.eof) break;
          if (data.length > 400 * 1024 * 1024) { traceSkipped = 'trace>400MB'; break; }
        }
        await bcdp.send('IO.close', { handle: ev.stream }).catch(() => { });
      }
      traceBytes = data.length;
      if (!traceSkipped) { try { const j = JSON.parse(data); traceAgg = aggTrace(j.traceEvents || [], 0); } catch (e) { traceAgg = { parseError: String(e).slice(0, 160) }; } }
      data = null;
      traceParseMs = Date.now() - tTr0;
    }
    const censusW1 = censusNow(new Set([process.pid]));
    await cdpW.detach().catch(() => { });
    const heapSlice = heap.slice(heapI0).filter((h) => !(name === 'cold' && tNavEpoch && h.t < tNavEpoch));
    const d = (k) => r3((m1[k] ?? 0) - (m0[k] ?? 0));           // raw delta (counts)
    const g = (k) => r3(d(k) * 1000);                           // seconds -> ms (durations)
    const prof = aggProfile(profile);
    if (traceAgg && !traceAgg.parseError) traceAgg.mainTidSanity = r3(traceAgg.runTaskUnionMs / Math.max(0.001, g('TaskDuration')));
    const rec = {
      name, noTrace, tStart, tEnd, tStartISO: new Date(tStart).toISOString(), wallSec: r3(wallS),
      wallSleepSec: r3((tEnd - tStart) / 1000), metricSpanMs: (tM1 - tM0), traceParseMs,
      action,
      cdp: {
        TaskDuration: g('TaskDuration'), ScriptDuration: g('ScriptDuration'), RecalcStyleDuration: g('RecalcStyleDuration'),
        LayoutDuration: g('LayoutDuration'), RecalcStyleCount: d('RecalcStyleCount'), LayoutCount: d('LayoutCount'),
        TaskMsPerS: r3(g('TaskDuration') / wallS), ScriptMsPerS: r3(g('ScriptDuration') / wallS),
        RecalcMsPerS: r3(g('RecalcStyleDuration') / wallS), LayoutMsPerS: r3(g('LayoutDuration') / wallS),
        JSHeapUsedDeltaKiB: r3((m1.JSHeapUsedSize - m0.JSHeapUsedSize) / 1024), Nodes: m1.Nodes, JSEventListeners: m1.JSEventListeners,
        tasksPerS: r3(d('Tasks') / wallS),
      },
      gcPage: {
        n: (drain1 ? drain1.gc.length : 0), totalMs: r3((drain1 ? drain1.gc.reduce((a, b) => a + b.d, 0) : 0)),
        entries: (drain1 ? drain1.gc.slice(0, 400) : []), err: drain1 ? drain1.gcErr : null,
        kinds: drain1 ? Object.entries(drain1.gc.reduce((m, e) => { const k = (e.detail && e.detail.kind) || 'nodetail'; m[k] = (m[k] || 0) + 1; return m; }, {})) : [],
        counts: r3(drain1 ? drain1.gc.reduce((a, b) => a + ((b.detail && b.detail.count) || 0), 0) : 0),
      },
      longtasks: { n: drain1 ? drain1.lt.length : 0, totalMs: r3(drain1 ? drain1.lt.reduce((a, b) => a + b.d, 0) : 0), maxMs: drain1 && drain1.lt.length ? r3(Math.max(...drain1.lt.map((x) => x.d))) : 0, entries: drain1 ? drain1.lt.slice(0, 60) : [] },
      raf: { n: drain1 ? drain1.raf.length : 0, p50: (() => { const r = drain1 ? drain1.raf : []; const iv = r.slice(1).map((t, i) => t - r[i]).sort((a, b) => a - b); return iv.length ? r3(iv[Math.floor(iv.length / 2)]) : null; })() },
      profile: prof,
      trace: traceAgg, traceBytes, traceSkipped,
      reconcile: {
        ratioProfileVsScriptRecalc: r3(prof.busyMs / Math.max(0.001, g('ScriptDuration') + g('RecalcStyleDuration'))),
        ratioTraceRunTaskVsTask: traceAgg && !traceAgg.parseError ? r3(traceAgg.runTaskUnionMs / Math.max(0.001, g('TaskDuration'))) : null,
        ratioTraceStyleLayoutVsCdp: traceAgg && !traceAgg.parseError ? r3(traceAgg.styleLayoutUnionMs / Math.max(0.001, g('RecalcStyleDuration') + g('LayoutDuration'))) : null,
      },
      heap: summarizeHeap(heapSlice),
      heap4s: summarizeHeap(heapSlice.filter((h) => h.t >= (tStart + tEnd) / 2 - 2000 && h.t <= (tStart + tEnd) / 2 + 2000), { tag: '4s-center' }),
      concurrency: { censusW0, censusW1, exclusiveThroughout: censusW0.foreignCount === 0 && censusW1.foreignCount === 0 && censusW0.lockHeldByLine },
      integrity: {
        gcObserved: !!(drain1 && drain1.gc.length > 0), profileSamples: prof.sampleCount, profileUnitOk: prof.medianSampleUs > 100 && prof.medianSampleUs < 6000,
        profileSpanOk: prof.spanIntegrity.ratio > 0.9 && prof.spanIntegrity.ratio < 1.1,
        traceParsed: !!(traceAgg && traceAgg.mainThread && !traceAgg.parseError), mainTidSanity: traceAgg && !traceAgg.parseError ? traceAgg.mainTidSanity : null,
        heapSamples: heapSlice.length, rafCounting: !!(drain1 && drain1.raf.length > 0), heapPollOn: !opts.noHeapPoll,
      },
    };
    try { fs.writeFileSync(path.join(RAW, `win-${STAMP}-${label}-${name}.json`), JSON.stringify({ meta: rec, profileRaw: profile }, null, 0)); } catch (e) { log('[raw] write failed', String(e).slice(0, 120)); }
    return rec;
  }

  // ---- W1 cold-open window: the navigation happens INSIDE the window (auditor S8)
  const wCold = await windowRun('cold', W.COLD, async () => {
    const t0 = Date.now();
    await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const t1 = Date.now();
    tNavEpoch = t1;
    clock = await page.evaluate(() => ({ timeOrigin: performance.timeOrigin, now: performance.now(), epoch: Date.now(), hook: !!window.__hook }));
    return { kind: 'navigate', navMs: t1 - t0, tNav: t1 };
  });
  out.clock = clock;
  out.windows.push(wCold);
  log(`[${label} cold] wall=${wCold.wallSec}s task=${wCold.cdp.TaskMsPerS}ms/s script=${wCold.cdp.ScriptMsPerS} recalc=${wCold.cdp.RecalcMsPerS} layout=${wCold.cdp.LayoutMsPerS} profBusy=${r3(wCold.profile.busyMs / wCold.wallSec)}ms/s classes=${JSON.stringify(wCold.profile.byClass)} gcPO=${wCold.gcPage.n}/${wCold.gcPage.totalMs}ms gcTrUnion=${wCold.trace ? wCold.trace.gcMainUnionMs : 'n/a'} paintUnion=${wCold.trace ? wCold.trace.paintCompositeUnionMs : 'n/a'} mainTid=${wCold.trace ? wCold.trace.mainThread : 'n/a'} sanity=${wCold.integrity.mainTidSanity} rec=${wCold.reconcile.ratioProfileVsScriptRecalc}`);

  await sleep(W.GAP);
  // ---- W2 click window: [click-2s, click+2s] anchored on a page-side mark (auditor S9)
  const st0 = await settingsState(page).catch(() => null);
  const wClick = await windowRun('click', 0, async () => {
    await sleep(W.CLICK_PRE);
    // page-clock anchor: the mark is taken in the page, immediately before the click
    const markPageMs = await page.evaluate(() => { performance.mark('click-t0'); return performance.now(); }).catch(() => null);
    const res = await clickSettings(page);
    const afterPageMs = await page.evaluate(() => performance.now()).catch(() => null);
    const tClickWall = Date.now();
    const tMarkWall = tClickWall - res.latencyMs;
    // hold the window open until exactly mark+CLICK_POST in wall time, so the window is
    // [click-2s, click+2s] regardless of how long the click itself took (auditor S9)
    const holdUntil = tMarkWall + W.CLICK_POST;
    const hold = Math.max(0, holdUntil - Date.now());
    await sleep(hold);
    return { kind: 'click', markPageMs, afterPageMs, res, tClickWall, tMarkWall, clickLatencyMs: res.latencyMs, holdMs: hold };
  });
  out.windows.push(wClick);
  const st1 = await settingsState(page).catch(() => null);
  out.settings = { before: st0, after: st1, clickInfo: wClick.action && wClick.action.res };
  log(`[${label} click] clicked=${wClick.action && wClick.action.res.clicked} sel=${wClick.action && wClick.action.res.selector} latency=${wClick.action && wClick.action.res.latencyMs}ms wall=${wClick.wallSec}s task=${wClick.cdp.TaskMsPerS}ms/s gcPO=${wClick.gcPage.n}/${wClick.gcPage.totalMs}ms gcTrUnion=${wClick.trace ? wClick.trace.gcMainUnionMs : 'n/a'} opened=${!!(st1 && st1.tabs.length)}`);

  // click +/- 2 s detail (page clock anchor)
  const anchor = wClick.action && wClick.action.markPageMs != null && clock ? clock.timeOrigin + wClick.action.markPageMs : (wClick.action ? wClick.action.tMarkWall : null);
  if (anchor != null) {
    out.clickHeap = summarizeHeap(heap.filter((h) => h.t >= anchor - 2000 && h.t <= anchor + 2000), { tag: 'click±2s', center: anchor });
    out.clickGcEntriesRel = (wClick.gcPage.entries || []).map((e) => ({ relMs: r3((clock ? clock.timeOrigin + e.t : e.t) - anchor), durMs: r3(e.d), kind: e.detail && e.detail.kind, count: e.detail && e.detail.count })).slice(0, 400);
    out.clickGcWithin2s = out.clickGcEntriesRel.filter((e) => Math.abs(e.relMs) <= 2000).length;
    out.clickGcTotalMsWithin2s = r3(out.clickGcEntriesRel.filter((e) => Math.abs(e.relMs) <= 2000).reduce((a, b) => a + b.durMs, 0));
  }

  await sleep(W.SETTLE);
  // ---- W3 steady-state window (settings open, quiet); in L2 tracing is OFF (instrument control, S11)
  const wSteady = await windowRun('steady', W.STEADY, null, { noTrace: noTraceWindows.includes('steady') });
  out.windows.push(wSteady);
  log(`[${label} steady] noTrace=${wSteady.noTrace} wall=${wSteady.wallSec}s task=${wSteady.cdp.TaskMsPerS}ms/s script=${wSteady.cdp.ScriptMsPerS} recalc=${wSteady.cdp.RecalcMsPerS} layout=${wSteady.cdp.LayoutMsPerS} profBusy=${r3(wSteady.profile.busyMs / wSteady.wallSec)}ms/s classes=${JSON.stringify(wSteady.profile.byClass)} gcPO=${wSteady.gcPage.n}/${wSteady.gcPage.totalMs}ms gcTrUnion=${wSteady.trace ? wSteady.trace.gcMainUnionMs : 'n/a'}`);

  if (allocSampling) {
    await sleep(W.ALLOC_TAIL);
    const { profile: sp } = await cdp.send('HeapProfiler.stopSampling');
    out.alloc = summarizeAlloc(sp);
    log(`[${label} alloc] total=${out.alloc.totalMiB}MiB nodes=${out.alloc.nodeCount} top=${JSON.stringify((out.alloc.top || []).slice(0, 5))}`);
  }

  out.tEnd = Date.now();
  out.censusEnd = censusNow(new Set([process.pid]));
  out.ws = ws.map((x) => ({ url: x.url.slice(0, 60), in: x.inb, out: x.out }));
  out.integrity = {
    settingsOpened: !!(st1 && st1.tabs.length > 0),
    noGuardViolation: !(out.settings && out.settings.clickInfo && out.settings.clickInfo.guardedSkip.length),
    errors: errors.slice(0, 20),
  };
  heapStop = true; await heapPoller.catch(() => { });
  out.heapSeries = heap.length;
  fs.writeFileSync(path.join(RAW, `load-${STAMP}-${label}.json`), JSON.stringify(out, null, 1));
  await bcdp.detach().catch(() => { });
  await ctx.close();
  return out;
}

function summarizeHeap(series, opt = {}) {
  if (!series || series.length < 3) return { n: series ? series.length : 0, note: 'insufficient samples' };
  const t0 = series[0].t, t1 = series[series.length - 1].t;
  const spanS = Math.max(0.001, (t1 - t0) / 1000);
  let pos = 0, neg = 0, drops = 0, dropBytes = 0;
  for (let i = 1; i < series.length; i++) {
    const d = series[i].used - series[i - 1].used;
    if (d >= 0) pos += d; else { neg += -d; drops++; dropBytes += -d; }
  }
  const used0 = series[0].used, used1 = series[series.length - 1].used;
  const n = series.length;
  const mx = series.reduce((a, b) => a + b.t, 0) / n, my = series.reduce((a, b) => a + b.used, 0) / n;
  let num = 0, den = 0;
  for (const s of series) { num += (s.t - mx) * (s.used - my); den += (s.t - mx) ** 2; }
  const slope = den ? (num / den) * 1000 : 0;
  return {
    tag: opt.tag || null, n, spanS: r3(spanS), center: opt.center || null,
    usedStartMiB: r3(used0 / 1048576), usedEndMiB: r3(used1 / 1048576), netGrowthMiB: r3((used1 - used0) / 1048576),
    grossAllocMiB: r3(pos / 1048576), grossAllocMiBPerS: r3(pos / 1048576 / spanS),
    grossFreedMiB: r3(neg / 1048576), gcDropCount: drops, gcDropMiBShown: r3(dropBytes / 1048576),
    gcDropAvgMiB: drops ? r3(dropBytes / drops / 1048576) : 0,
    linSlopeMiBPerS: r3(slope / 1048576),
    maxMiB: r3(Math.max(...series.map((s) => s.used)) / 1048576), minMiB: r3(Math.min(...series.map((s) => s.used)) / 1048576),
    sampleIntervalMs: r3((series[series.length - 1].t - series[0].t) / Math.max(1, series.length - 1)),
    firstSamples: series.slice(0, 8).map((s) => ({ dt: s.t - series[0].t, mb: r3(s.used / 1048576) })),
  };
}
function summarizeAlloc(sp) {
  const out = { totalBytes: 0, totalMiB: null, top: [], byUrl: [], nodeCount: 0 };
  if (!sp || !sp.head) return { note: 'no sampling profile' };
  const agg = new Map(); const urlAgg = new Map(); let total = 0;
  const walk = (node) => {
    out.nodeCount++;
    const cf = node.callFrame || {};
    const self = node.selfSize || 0;
    total += self;
    const k = `${cf.functionName || '(anon)'}@${(cf.url || '').split('/').pop()}:${cf.lineNumber}`;
    const b = agg.get(k) || { fn: cf.functionName || '(anon)', url: cf.url || '', line: cf.lineNumber, bytes: 0, n: 0 };
    b.bytes += self; b.n++; agg.set(k, b);
    const uk = cf.url || '(no-url)';
    const u = urlAgg.get(uk) || { url: uk, bytes: 0 }; u.bytes += self; urlAgg.set(uk, u);
    for (const c of node.children || []) walk(c);
  };
  walk(sp.head);
  out.totalBytes = total; out.totalMiB = r3(total / 1048576);
  out.top = [...agg.values()].map((b) => ({ ...b, MiB: r3(b.bytes / 1048576) })).sort((a, b) => b.bytes - a.bytes).slice(0, 40);
  out.byUrl = [...urlAgg.values()].map((b) => ({ url: b.url.slice(0, 140), MiB: r3(b.bytes / 1048576) })).sort((a, b) => b.MiB - a.MiB).slice(0, 25);
  return out;
}

// ---------------------------------------------------------------- main
async function main() {
  const t0 = Date.now();
  const censusPre = censusNow(new Set([process.pid]));
  const meta = { stamp: STAMP, mode: MODE, target: TARGET, windowDefs: W, cats: CATS, samplingUs: SAMPLING_US, startedAt: new Date(t0).toISOString(), hostPid: censusPre.hostPid, node: process.version, argv };
  log(`[main] mode=${MODE} stamp=${STAMP} hostPid=${meta.hostPid} cats=${CATS} sampling=${SAMPLING_US}us windows=${JSON.stringify(W)}`);
  log(`[main] census before launch: foreign=${censusPre.foreignCount} mine=${censusPre.mineCount} lockMine=${censusPre.lockHeldByLine} load=${censusPre.load}`);

  // ---- S2: HARD exclusivity gate before any browser is launched.
  // Waits up to GATE_MAX_MS for {lock held by this line AND no foreign browser instance}. Then:
  //   lock not mine                      -> ABORT (never measure without the lock)
  //   lock mine, foreign>0 after timeout -> proceed, but every window is flagged CONTENDED
  const GATE_MAX_MS = Number(argOf('gatemax', 120000));
  const gateStart = Date.now();
  let gate = null; const foreignSeen = [];
  for (; ;) {
    const c = censusNow(new Set([process.pid]));
    if (c.lockHeldByLine && c.foreignCount === 0) { gate = c; break; }
    for (const f of c.foreign) if (!foreignSeen.some((x) => x.pid === f.pid)) foreignSeen.push(f);
    log(`[gate] wait ${Date.now() - gateStart}ms lockMine=${c.lockHeldByLine} foreign=${c.foreignCount}`);
    if (Date.now() - gateStart > GATE_MAX_MS) break;
    await sleep(5000);
  }
  if (!gate) {
    const c = censusNow(new Set([process.pid]));
    if (!c.lockHeldByLine) {
      log(`[main] GATE FAIL: lock not held by this line -> refusing to launch a browser`);
      console.log(JSON.stringify({ ok: false, gateFail: true, reason: 'lock-not-mine', lockOwner: c.lockOwner }, null, 1));
      process.exitCode = 6; return;
    }
    log(`[main] GATE TIMEOUT with foreign=${c.foreignCount} (peers not honouring the lock) -> proceeding CONTENDED, windows flagged`);
    gate = { ...c, gateOutcome: 'CONTENDED', foreignSeenDuringGate: foreignSeen };
  } else gate = { ...gate, gateOutcome: 'EXCLUSIVE' };
  log(`[main] GATE ${gate.gateOutcome}: foreign=${gate.foreignCount} foreignSeenDuringGate=${(gate.foreignSeenDuringGate || []).length}`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--enable-precise-memory-info'],
  });
  const myPids = new Set([process.pid]);
  const loads = [];
  try {
    if (MODE === 'smoke') {
      loads.push(await runLoad(browser, { label: 'smoke-L1', mode: MODE, allocSampling: false }));
    } else {
      loads.push(await runLoad(browser, { label: 'L1', mode: MODE, allocSampling: false }));
      loads.push(await runLoad(browser, { label: 'L2', mode: MODE, allocSampling: false, noTraceWindows: ['steady'] }));
      loads.push(await runLoad(browser, { label: 'L3-alloc', mode: MODE, allocSampling: true, noTraceWindows: ['cold', 'click', 'steady'] }));
    }
  } finally {
    await browser.close().catch(() => { });
  }
  const censusPost = censusNow(myPids);
  const report = { meta, gate, censusPre, censusPost, loads, finishedAt: new Date().toISOString(), wallSec: r3((Date.now() - t0) / 1000) };
  const outFile = path.join(RAW, `campaign-${STAMP}.json`);
  fs.writeFileSync(outFile, JSON.stringify(report, null, 1));
  log(`[main] wrote ${outFile} wall=${report.wallSec}s censusPost foreign=${censusPost.foreignCount} mine=${censusPost.mineCount}`);
  let bad = 0;
  for (const L of loads) for (const w of L.windows) {
    if (!w.integrity.profileSamples) { log(`[integrity] ${L.label}/${w.name}: zero profile samples`); bad++; }
    if (!w.integrity.traceParsed && !w.noTrace) { log(`[integrity] ${L.label}/${w.name}: trace not parsed`); bad++; }
    if (!w.integrity.gcObserved) log(`[integrity] ${L.label}/${w.name}: NO gc entries observed by PerformanceObserver`);
    if (!w.integrity.heapSamples) { log(`[integrity] ${L.label}/${w.name}: no heap samples`); bad++; }
    if (!w.integrity.profileSpanOk) log(`[integrity] ${L.label}/${w.name}: profile span ratio ${w.profile.spanIntegrity.ratio}`);
    if (!w.concurrency.exclusiveThroughout) log(`[integrity] ${L.label}/${w.name}: NOT exclusive (start foreign=${w.concurrency.censusW0.foreignCount} end foreign=${w.concurrency.censusW1.foreignCount} lock=${w.concurrency.censusW0.lockHeldByLine})`);
  }
  console.log(JSON.stringify({
    ok: bad === 0, badWindows: bad, outFile,
    loads: loads.map((L) => ({
      label: L.label, settingsOpened: L.integrity.settingsOpened,
      windows: L.windows.map((w) => ({
        name: w.name, noTrace: w.noTrace, wall: w.wallSec, taskMsPerS: w.cdp.TaskMsPerS, gcN: w.gcPage.n, gcMs: w.gcPage.totalMs,
        gcTraceUnionMs: w.trace ? w.trace.gcMainUnionMs : null, paintUnionMs: w.trace ? w.trace.paintCompositeUnionMs : null,
        mainTid: w.trace ? w.trace.mainThread : null, allocMiB: L.alloc ? L.alloc.totalMiB : null,
      })),
    })),
  }, null, 1));
}
main().catch((e) => { console.error('FATAL', (e && e.stack) || e); fs.appendFileSync(path.join(LOGS, `${STAMP}.log`), 'FATAL ' + String((e && e.stack) || e) + '\n'); process.exitCode = 1; });
