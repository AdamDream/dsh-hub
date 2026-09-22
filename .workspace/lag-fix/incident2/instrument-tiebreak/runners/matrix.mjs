#!/usr/bin/env node
/*
 * runners/matrix.mjs — four-channel blocking-injection matrix for the
 * "which instrument is trustworthy" adjudication.
 *
 * Modes
 *   --mode recon    : validate the harness assumptions (headless flavour, rAF
 *                     ticking, visibility control, PO support, trace RunTask
 *                     visibility) before spending the matrix budget.
 *   --mode matrix   : the full grid.
 *
 * Discipline: one browser at a time, shared lock held for the whole run, no
 * pkill, no product files touched, only ever navigates to our own minimal page.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { acquireLock, releaseLock, LOCK_DIR, lockStatus } from '../lib/lock.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PAGE_URL = 'file://' + path.join(ROOT, 'minimal-block.html');
const PROBE = fs.readFileSync(path.join(ROOT, 'lib', 'probe.js'), 'utf8');

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) {
    const k = a.slice(2);
    const v = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : '1';
    args[k] = v;
  }
}
const MODE = args.mode || 'recon';
const RUN = args.run || (MODE === 'recon' ? 'recon' : 'matrix');
const REPS = Number(args.reps || 5);
const OUT = path.join(ROOT, 'raw', `${RUN}-${MODE}.json`);
const LOGF = path.join(ROOT, 'logs', `${RUN}-${MODE}.log`);

const logLines = [];
function log(...a) {
  const s = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
  const line = `[${new Date().toISOString().slice(11, 23)}] ${s}`;
  console.log(line);
  logLines.push(line);
  fs.writeFileSync(LOGF, logLines.join('\n') + '\n');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();

/* ------------------------------------------------------------------ helpers */

async function foreignBrowsers() {
  const out = [];
  for (const p of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(p)) continue;
    if (Number(p) === process.pid) continue;
    let exe = '';
    try { exe = fs.readlinkSync(`/proc/${p}/exe`); } catch { continue; }
    if (/chrome|chromium|firefox/i.test(exe) && !/node|dsh/i.test(exe)) out.push({ pid: Number(p), exe });
  }
  return out;
}

/* --------------------------------------------------------------- trace read */

async function readStream(cdp, handle) {
  let out = '';
  for (;;) {
    const r = await cdp.send('IO.read', { handle, size: 1 << 20 });
    out += r.data;
    if (r.eof) break;
  }
  try { await cdp.send('IO.close', { handle }); } catch { }
  return out;
}

function parseTrace(text) {
  const s = text.indexOf('{');
  const arrS = text.indexOf('[');
  let obj;
  if (arrS !== -1 && (s === -1 || arrS < s)) obj = { traceEvents: JSON.parse(text.slice(arrS)) };
  else obj = JSON.parse(text.slice(s));
  const ev = obj.traceEvents || obj;
  // Trace event timestamps are microseconds on the trace clock; performance.now()
  // in-page is a different origin, so we align via the BLK_S mark events.
  return ev;
}

function markTraceTs(events, name) {
  const hits = events.filter((e) =>
    (e.name === 'TimeStamp' || e.name === 'Mark' || e.name === 'mark') &&
    e.args && e.args.data && (e.args.data.name === name || e.args.data.message === name));
  if (!hits.length) return null;
  return hits.sort((a, b) => (b.ts || 0) - (a.ts || 0))[0].ts; // latest occurrence
}

function sliceTasks(events, t0, t1) {
  const names = new Set(['RunTask', 'FunctionCall', 'EvaluateScript', 'TimerFire', 'EventDispatch', 'FireAnimationFrame', 'UpdateLayoutTree', 'Layout', 'Paint', 'XHRLoad']);
  const out = {};
  for (const e of events) {
    if (e.ph !== 'X' || typeof e.dur !== 'number') continue;
    if (!names.has(e.name)) continue;
    if (e.ts < t0 || e.ts > t1) continue;
    (out[e.name] = out[e.name] || []).push({ ts: e.ts, dur: e.dur, tid: e.tid, pid: e.pid });
  }
  return out;
}

/* ------------------------------------------------------------------ matrix */

const SITES = ['raf', 'timeout', 'eval', 'evalGesture', 'click'];
const VIS = ['visible', 'hidden'];
const DURS = [120, 200];

async function applyVisibility(page, blank, mode) {
  if (mode === 'visible') {
    await page.bringToFront();
  } else {
    await blank.bringToFront();
  }
  const t0 = Date.now();
  let state = null;
  for (;;) {
    state = await page.evaluate(() => ({ v: document.visibilityState, h: document.hidden }));
    const want = mode === 'visible' ? 'visible' : 'hidden';
    if (state.v === want) break;
    if (Date.now() - t0 > 4000) break;
    await sleep(100);
  }
  return state;
}

async function runCell({ page, blank, cdp, site, vis, dur, rep }) {
  const rec = { site, vis, dur, rep, ok: false, notes: [] };

  // ---- 1. settle + open window
  rec.visBefore = await applyVisibility(page, blank, vis);
  rec.foreignBefore = (await foreignBrowsers()).length;

  await page.evaluate(() => {
    const P = window.__IT__;
    P.raf.length = 0; P.lt.length = 0; P.loaf.length = 0; P.marks.length = 0; P.blocks.length = 0;
    P.vis.length = 0; P.win = null;
    P.mark('WIN_S');
    P.mark('IDLE_A');
  });
  await sleep(400);              // idle floor, lets the page produce clean frames
  await page.evaluate(() => window.__IT__.mark('WIN_PRE'));

  // ---- 2. trace on
  const collected = [];
  const onEv = (m) => { if (m.method === 'Tracing.dataCollected') collected.push(...(m.params.value || [])); };
  cdp.on('Tracing.dataCollected', onEv);
  let useStream = true;
  try {
    await cdp.send('Tracing.start', {
      categories: 'devtools.timeline,blink.user_timing,v8,rail',
      transferMode: 'ReturnAsStream',
      bufferUsageReportingInterval: 2000,
    });
  } catch (e) {
    useStream = false;
    await cdp.send('Tracing.start', { categories: 'devtools.timeline,blink.user_timing,v8,rail' });
  }

  // ---- 3. inject
  const tInject = Date.now();
  try {
    if (site === 'raf') {
      rec.inject = await Promise.race([
        page.evaluate(() => window.__IT__.injectInRaf(window.__IT_MS__ || 120)),
        sleep(2500).then(() => ({ neverRan: 'raf-callback-did-not-fire-within-2500ms' })),
      ]);
    } else if (site === 'timeout') {
      rec.inject = await Promise.race([
        page.evaluate(() => window.__IT__.injectInTimeout(window.__IT_MS__ || 120)),
        sleep(4000).then(() => ({ neverRan: 'setTimeout-callback-did-not-fire-within-4000ms' })),
      ]);
    } else if (site === 'eval' || site === 'evalGesture') {
      rec.inject = await cdp.send('Runtime.evaluate', {
        expression: `window.__IT__.injectAt(${JSON.stringify(site)}, ${dur})`,
        awaitPromise: false,
        returnByValue: true,
        userGesture: site === 'evalGesture',
      }).then((r) => (r.result && r.result.value) || null);
    } else if (site === 'click') {
      await page.evaluate((ms) => { window.__IT_CLICK_MS__ = ms; }, dur);
      try {
        await page.click('#btn', { timeout: 5000, force: true });
        rec.clicked = true;
      } catch (e) {
        rec.clicked = false;
        rec.notes.push('click failed: ' + String(e.message).split('\n')[0]);
      }
    }
  } catch (e) {
    rec.notes.push('injection error: ' + String(e.message).split('\n')[0]);
  }
  rec.injectWallMs = Date.now() - tInject;

  // ---- 4. post window
  rec.frameAfterInject = await page.evaluate(() => window.__IT__.raf.length).catch(() => null);
  await sleep(900);
  try { await page.evaluate(() => { window.__IT__.mark('WIN_E'); }); } catch (e) { rec.notes.push('WIN_E mark failed: ' + e.message); }
  await sleep(80);

  // ---- 5. trace off
  let ev = [];
  try {
    const done = new Promise((res) => cdp.once('Tracing.tracingComplete', res));
    await cdp.send('Tracing.end');
    const comp = await done;
    cdp.off('Tracing.dataCollected', onEv);
    if (useStream && comp.stream) ev = parseTrace(await readStream(cdp, comp.stream));
    else ev = collected;
  } catch (e) {
    rec.notes.push('trace error: ' + String(e.message).split('\n')[0]);
    try { cdp.off('Tracing.dataCollected', onEv); } catch { }
    ev = collected;
  }
  rec.traceEventCount = ev.length;

  // ---- 6. dump in-page state
  rec.page = await page.evaluate(() => {
    const P = window.__IT__;
    return {
      ua: P.ua, ltErr: P.ltErr, loafErr: P.loafErr,
      raf: P.raf, lt: P.lt, loaf: P.loaf, marks: P.marks, blocks: P.blocks, vis: P.vis,
      finalVis: document.visibilityState, finalHidden: document.hidden,
      viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
    };
  });

  // ---- 7. ground truth from trace
  const blk = rec.page.blocks[rec.page.blocks.length - 1] || null;
  rec.block = blk;
  const mS = markTraceTs(ev, 'BLK_S_' + (blk ? blk.site : site));
  const mE = markTraceTs(ev, 'BLK_E_' + (blk ? blk.site : site));
  // WIN_S occurs BEFORE the block; the latest WIN_S-marked TimeStamp precedes it.
  const winMarks = ev.filter((e) => e.name === 'TimeStamp' && e.args && e.args.data &&
    (e.args.data.name === 'WIN_PRE' || e.args.data.name === 'WIN_E'));
  const wS = winMarks.filter((e) => e.args.data.name === 'WIN_PRE').map((e) => e.ts).sort((a, b) => a - b).pop() ?? null;
  const wE = winMarks.filter((e) => e.args.data.name === 'WIN_E').map((e) => e.ts).sort((a, b) => a - b).pop() ?? null;
  rec.traceAlign = { mS, mE, wS, wE, marksFound: { BLK_S: !!mS, BLK_E: !!mE, WIN_PRE: wS != null, WIN_E: wE != null } };

  if (wS != null && wE != null && wE > wS) {
    const tasks = sliceTasks(ev, wS, wE);
    rec.trace = {};
    for (const k of Object.keys(tasks)) {
      rec.trace[k] = { n: tasks[k].length, maxMs: Math.max(...tasks[k].map((t) => t.dur)) / 1000 };
    }
    if (mS != null) {
      const host = (tasks.RunTask || []).filter((t) => t.ts <= mS && t.ts + t.dur >= mS).sort((a, b) => b.dur - a.dur)[0];
      rec.trace.runTaskHostingBlockMs = host ? host.dur / 1000 : null;
    }
  }
  rec.traceAllNames = (() => {
    const c = {};
    for (const e of ev) if (e.ph === 'X' && typeof e.dur === 'number' && e.dur > 20000) c[e.name] = (c[e.name] || 0) + 1;
    return c;
  })();

  rec.ok = true;
  rec.finishedAt = nowIso();
  rec.foreignAfter = (await foreignBrowsers()).length;
  return rec;
}

/* -------------------------------------------------------------------- main */

(async () => {
  log(`MODE=${MODE} RUN=${RUN} REPS=${REPS}`);
  log(`lock status before: ${JSON.stringify(lockStatus())}`);
  const foreign = await foreignBrowsers();
  log(`foreign browsers before launch: ${JSON.stringify(foreign)}`);
  if (foreign.length) log('WARNING: foreign browser instances present; results may be contaminated');

  await acquireLock({ line: 'incident2/instrument-tiebreak', purpose: MODE, log });

  let browser = null;
  let cdp = null;
  const results = { meta: { mode: MODE, run: RUN, reps: REPS, startedAt: nowIso(), args, host: os.hostname() }, cells: [] };
  try {
    const launchArgs = ['--no-sandbox', '--disable-dev-shm-usage'];
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: launchArgs });
    log(`browser version: ${browser.version()}`);

    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    await context.addInitScript({ content: PROBE });
    const page = await context.newPage();
    const blank = await context.newPage();
    await blank.setContent('<!doctype html><title>visibility-park</title><body>park</body>');
    await page.goto(PAGE_URL, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__IT_READY__ === true, { timeout: 10000 });
    cdp = await context.newCDPSession(page);

    // --- environment evidence
    results.meta.env = await page.evaluate(async () => {
      const P = window.__IT__;
      return {
        ua: navigator.userAgent, platform: navigator.platform, dpr: devicePixelRatio,
        viewport: { w: innerWidth, h: innerHeight },
        ltErr: P.ltErr, loafErr: P.loafErr,
        visibilityState: document.visibilityState,
        hasLoAF: typeof PerformanceObserver !== 'undefined' &&
          (PerformanceObserver.supportedEntryTypes || []).includes('long-animation-frame'),
        supportedEntryTypes: PerformanceObserver.supportedEntryTypes || [],
      };
    });
    log('env: ' + JSON.stringify(results.meta.env));

    const baseline = await page.evaluate(() => ({ n: window.__IT__.raf.length, sample: window.__IT__.raf.slice(-8) }));
    log(`baseline rAF ticks after load: ${baseline.n}`);

    if (MODE === 'recon') {
      // ---- visibility control probe
      const rec = { visibility: {}, traceProbe: null, rafHidden: null };
      rec.visibility.initial = await page.evaluate(() => document.visibilityState);
      await blank.bringToFront();
      await sleep(400);
      rec.visibility.afterBlankBringToFront = await page.evaluate(() => document.visibilityState);
      rec.visibility.hiddenBool = await page.evaluate(() => document.hidden);
      const rBefore = await page.evaluate(() => window.__IT__.raf.length);
      await sleep(1000);
      const rAfter = await page.evaluate(() => window.__IT__.raf.length);
      rec.rafHidden = { ticksIn1s: rAfter - rBefore, stillTicking: rAfter > rBefore };

      // does the rAF injection site work while hidden?
      await page.evaluate(() => { window.__IT__.__r = null; });
      const hiddenRaf = await Promise.race([
        page.evaluate(() => window.__IT__.injectInRaf(120)),
        sleep(2500).then(() => ({ neverRan: true })),
      ]);
      rec.hiddenRafInject = hiddenRaf;
      const hiddenTimeout = await Promise.race([
        page.evaluate(() => window.__IT__.injectInTimeout(120)),
        sleep(4000).then(() => ({ neverRan: true })),
      ]);
      rec.hiddenTimeoutInject = hiddenTimeout;
      rec.hiddenEvalInject = await cdp.send('Runtime.evaluate', {
        expression: 'window.__IT__.injectAt("eval", 120)', returnByValue: true, awaitPromise: false,
      }).then((r) => r.result && r.result.value);

      // frozen state
      try {
        await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
        await sleep(300);
        rec.frozenState = await page.evaluate(() => document.visibilityState);
        await cdp.send('Page.setWebLifecycleState', { state: 'active' });
      } catch (e) { rec.frozenErr = String(e.message).split('\n')[0]; }

      await page.bringToFront();
      await sleep(400);
      rec.visibility.afterBringToFront = await page.evaluate(() => document.visibilityState);

      // ---- trace probe: does a page-scoped trace contain RunTask at all?
      const evs = [];
      const onEv2 = (m) => { if (m.method === 'Tracing.dataCollected') evs.push(...(m.params.value || [])); };
      cdp.on('Tracing.dataCollected', onEv2);
      let useStream = true;
      try {
        await cdp.send('Tracing.start', { categories: 'devtools.timeline,blink.user_timing,v8,rail', transferMode: 'ReturnAsStream', bufferUsageReportingInterval: 2000 });
      } catch { useStream = false; await cdp.send('Tracing.start', { categories: 'devtools.timeline,blink.user_timing,v8,rail' }); }
      await page.evaluate(() => { window.__IT__.marks.length = 0; window.__IT__.mark('PROBE_S'); });
      await page.evaluate(() => window.__IT__.injectAt('eval', 120));
      await sleep(500);
      await page.evaluate(() => window.__IT__.mark('PROBE_E'));
      await sleep(100);
      const done = new Promise((res) => cdp.once('Tracing.tracingComplete', res));
      await cdp.send('Tracing.end');
      const comp = await done;
      cdp.off('Tracing.dataCollected', onEv2);
      const ev = useStream && comp.stream ? parseTrace(await readStream(cdp, comp.stream)) : evs;
      const nameCounts = {};
      for (const e of ev) if (e.ph === 'X') nameCounts[e.name] = (nameCounts[e.name] || 0) + 1;
      rec.traceProbe = {
        useStream, totalEvents: ev.length,
        topNames: Object.entries(nameCounts).sort((a, b) => b[1] - a[1]).slice(0, 40),
        hasRunTask: !!nameCounts.RunTask,
        hasTimeStamp: !!nameCounts.TimeStamp,
        markMatch: {
          PROBE_S: markTraceTs(ev, 'PROBE_S'), PROBE_E: markTraceTs(ev, 'PROBE_E'),
        },
        // raw sample of TimeStamp events so we can see how marks are encoded
        timeStampSamples: ev.filter((e) => e.name === 'TimeStamp').slice(0, 6),
        runTaskSamples: ev.filter((e) => e.name === 'RunTask' && e.dur > 20000).slice(0, 6),
      };
      results.recon = rec;
      log('recon: ' + JSON.stringify({ vis: rec.visibility, rafHidden: rec.rafHidden, hiddenRafInject: !!rec.hiddenRafInject && !rec.hiddenRafInject.neverRan, trace: { hasRunTask: rec.traceProbe.hasRunTask, total: rec.traceProbe.totalEvents, top: rec.traceProbe.topNames.slice(0, 15) } }));
    } else {
      // ------------------------------------------------------------- MATRIX
      const grid = [];
      for (const vis of VIS) for (const site of SITES) for (const d of DURS) grid.push({ vis, site, d });
      for (const cell of grid) {
        for (let rep = 1; rep <= REPS; rep++) {
          await page.evaluate((ms) => { window.__IT_MS__ = ms; }, cell.d);
          let r;
          try {
            r = await runCell({ page, blank, cdp, site: cell.site, vis: cell.vis, dur: cell.d, rep });
          } catch (e) {
            r = { site: cell.site, vis: cell.vis, dur: cell.d, rep, ok: false, notes: ['cell threw: ' + String(e.message).split('\n')[0]] };
            log(`CELL ERROR ${cell.vis}/${cell.site}/${cell.d}/r${rep}: ${e.message.split('\n')[0]}`);
            try { await cdp.send('Tracing.end').catch(() => { }); } catch { }
            try { await page.goto(PAGE_URL, { waitUntil: 'load' }); await page.waitForFunction(() => window.__IT_READY__ === true, { timeout: 10000 }); } catch { }
          }
          results.cells.push(r);
          const b = r.block || {};
          log(`CELL ${cell.vis}/${cell.site}/${cell.d}/r${rep} actual=${b.actual == null ? 'n/a' : Math.round(b.actual)}ms frames=${(r.page && r.page.raf.length) || 0} lt=${(r.page && r.page.lt.length) || 0} loaf=${(r.page && r.page.loaf.length) || 0} gtHost=${r.trace ? r.trace.runTaskHostingBlockMs : 'n/a'} gtRunTaskMax=${r.trace && r.trace.RunTask ? r.trace.RunTask.maxMs.toFixed(1) : 'n/a'} notes=${r.notes.join('; ')}`);
          fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
          await page.bringToFront();
        }
      }
    }

    results.meta.finishedAt = nowIso();
    fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
    log(`wrote ${OUT}`);
  } catch (e) {
    log('FATAL: ' + (e && e.stack || e));
    results.meta.fatal = String(e && e.stack || e);
    fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
    process.exitCode = 1;
  } finally {
    try { if (cdp) await cdp.detach().catch(() => { }); } catch { }
    try { if (browser) await browser.close(); } catch (e) { log('browser.close: ' + e.message); }
    const rel = releaseLock(log);
    log('lock release: ' + JSON.stringify(rel));
    log('post-run foreign browsers: ' + JSON.stringify(await foreignBrowsers()));
  }
})();
