#!/usr/bin/env node
/** pos-debug.mjs — 判定「LongTask 通道」在本环境到底能不能报出人为阻塞。
 *  三个独立通道：
 *    A) PerformanceObserver('longtask')
 *    B) PerformanceObserver('long-animation-frame')  (LoAF)
 *    C) CDP Tracing: RunTask / AnimationFrame 事件（Chrome 权威 trace）
 *  两种注入方式：
 *    1) page.evaluate 里同步忙等（DevTools 任务）
 *    2) 页内 setTimeout 里同步忙等（真实页面任务）
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { tryAcquire, release, census, censusVerdict } from '../lib/lock.mjs';

const BASE = 'http://127.0.0.1:3080';
const HERE = '/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/tab-switch';
const AGENT = 'incident2-tab-switch';
const out = { at: new Date().toISOString(), steps: [] };
const lock = tryAcquire(AGENT, 'positive-control diagnosis (longtask channel)', 1500, (m) => console.log(m));
out.lock = lock.acquired;
if (!lock.acquired) { writeFileSync(`${HERE}/raw/pos-debug.json`, JSON.stringify(out, null, 2)); process.exit(2); }

let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await page.addInitScript(() => {
    const S = { lt: [], loaf: [], frames: [], frameTs: [], hb: [], armed: false };
    globalThis.__DBG__ = S;
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) S.lt.push({ t: +e.startTime.toFixed(1), d: +e.duration.toFixed(1), n: e.name }); }).observe({ type: 'longtask', buffered: true }); S.ltOk = true; } catch (e) { S.ltOk = 'ERR ' + e; }
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) S.loaf.push({ t: +e.startTime.toFixed(1), d: +e.duration.toFixed(1) }); }).observe({ type: 'long-animation-frame', buffered: true }); S.loafOk = true; } catch (e) { S.loafOk = 'ERR ' + e; }
    const loop = () => { const t = performance.now(); if (S.armed) { if (S.frameTs.length) S.frames.push(+(t - S.frameTs[S.frameTs.length - 1]).toFixed(2)); S.frameTs.push(+t.toFixed(2)); } requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    setInterval(() => { if (S.armed) S.hb.push(+performance.now().toFixed(1)); }, 8);
    globalThis.__DBGSPIN__ = (ms) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { /* spin */ } return +(performance.now() - t0).toFixed(1); };
    globalThis.__DBGARM__ = () => { S.armed = true; S.lt = []; S.loaf = []; S.frames = []; S.frameTs = []; S.hb = []; return performance.now(); };
    globalThis.__DBGDIS__ = () => { S.armed = false; return { lt: S.lt, loaf: S.loaf, frames: S.frames, hb: S.hb }; };
    globalThis.__DBGTASK__ = (ms) => new Promise((res) => setTimeout(() => res(globalThis.__DBGSPIN__(ms)), 0));
    globalThis.supported = () => PerformanceObserver.supportedEntryTypes;
  });
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(11000);

  out.env = await page.evaluate(() => ({
    supportedEntryTypes: PerformanceObserver.supportedEntryTypes,
    visibilityState: document.visibilityState,
    hidden: document.hidden,
    hasFocus: document.hasFocus(),
    timeOrigin: performance.timeOrigin,
    frameCount: performance.getEntriesByType('frame').length,
  }));

  async function run(kind, ms) {
    // 起 trace
    const traceEvents = [];
    cdp.on('Tracing.dataCollected', (e) => { for (const ev of e.value) traceEvents.push(ev); });
    await cdp.send('Tracing.start', { categories: 'devtools.timeline,blink.user_timing,disabled-by-default-devtools.timeline', transferMode: 'ReportEvents' });
    const armAt = await page.evaluate(() => globalThis.__DBGARM__());
    let actual;
    if (kind === 'devtools') actual = await page.evaluate((m) => globalThis.__DBGSPIN__(m), ms);
    else actual = await page.evaluate((m) => globalThis.__DBGTASK__(m), ms);
    await page.waitForTimeout(700);
    const data = await page.evaluate(() => globalThis.__DBGDIS__());
    const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r));
    await cdp.send('Tracing.end');
    await done;
    const runTasks = traceEvents.filter((e) => e.name === 'RunTask' && e.dur != null && e.dur > 40)
      .map((e) => ({ dur: +(e.dur / 1000).toFixed(2), ts: +(e.ts / 1000).toFixed(1), name: e.name }));
    const step = {
      kind, requested_ms: ms, actual_ms: actual, armAt: +armAt.toFixed(1),
      longtask: data.lt, longtask_max: data.lt.length ? Math.max(...data.lt.map((x) => x.d)) : null,
      loaf: data.loaf, loaf_max: data.loaf.length ? Math.max(...data.loaf.map((x) => x.d)) : null,
      frames_n: data.frames.length, frame_max: data.frames.length ? Math.max(...data.frames) : null,
      frames_sorted_top: data.frames.slice().sort((a, b) => b - a).slice(0, 5),
      hb_max_gap: (() => { let m = 0; for (let i = 1; i < data.hb.length; i++) m = Math.max(m, data.hb[i] - data.hb[i - 1]); return +m.toFixed(2); })(),
      trace_runtask_over40ms: runTasks.slice(0, 12), trace_runtask_max: runTasks.length ? Math.max(...runTasks.map((r) => r.dur)) : null,
      trace_event_names: [...new Set(traceEvents.map((e) => e.name))].slice(0, 25),
    };
    out.steps.push(step);
    console.log(JSON.stringify({ kind, ms, lt: step.longtask_max, loaf: step.loaf_max, frameMax: step.frame_max, hbGap: step.hb_max_gap, traceMax: step.trace_runtask_max }));
    await page.waitForTimeout(400);
  }

  for (const kind of ['devtools', 'pageTask']) for (const ms of [60, 120, 200]) await run(kind, ms);

  out.census_end = censusVerdict(census(), null);
} catch (e) { out.fatal = String(e && e.stack || e).slice(0, 900); console.log('FATAL', out.fatal); }
finally {
  try { if (browser) await browser.close(); } catch {}
  out.release = release(AGENT);
  writeFileSync(`${HERE}/raw/pos-debug.json`, JSON.stringify(out, null, 2));
  console.log('WROTE pos-debug.json');
}
