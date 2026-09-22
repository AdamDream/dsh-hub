#!/usr/bin/env node
/**
 * Follow-up probe: (a) where do the long tasks actually sit (load vs click),
 * (b) tight CDP delta strictly around the settings-entry click,
 * (c) a deliberate ~120 ms main-thread block as a CONTROL task, to establish
 *     empirically whether the headless rAF stream can register jank at all.
 *
 * Arm A (headless default) and arm C-nogpu only; headed is impossible on this
 * host (see the campaign's B artifact / audit.md).
 */
import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = '/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/headed-vs-headless';
const URL = 'http://127.0.0.1:3080/';
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : argv[i + 1]; };
const ARM = arg('arm', 'A');
const OUT = arg('out', 'raw/startup-A.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
const BASE = ['--no-sandbox', '--disable-dev-shm-usage', '--enable-precise-memory-info'];
const args = ARM === 'C-nogpu' ? [...BASE, '--disable-gpu'] : ARM === 'C-gpu' ? [...BASE, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [...BASE];

function stats(a) {
  const x = a.filter((v) => v != null).slice().sort((p, q) => p - q);
  const q = (p) => x.length ? r3(x[Math.min(x.length - 1, Math.floor((x.length - 1) * p))]) : null;
  return { n: x.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: x.length ? r3(x[x.length - 1]) : null, over50: x.filter((v) => v > 50).length, over100: x.filter((v) => v > 100).length };
}

async function main() {
  const rec = { probe: 'startup+control', arm: ARM, at: new Date().toISOString(), steps: [] };
  const browser = await chromium.launch({ headless: true, args });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');

  // Instrumentation: rAF stream + long tasks + a load-phase mark
  await page.addInitScript(() => {
    const T0 = performance.now();
    window.__s = { raf: [], lt: [], t0: T0, readyAt: null, clickAt: null, visibleAt: null, controlStart: null, controlEnd: null };
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__s.lt.push({ s: Math.round((e.startTime - T0) * 10) / 10, d: Math.round(e.duration * 10) / 10 }); }).observe({ entryTypes: ['longtask'] }); } catch (e) {}
    const probe = () => {
      const t = document.body ? (document.body.innerText || '') : '';
      const n = ['通用', '插件', '模型', '远程', '子代理', '外观'].filter((s) => t.includes(s));
      return { hits: n.length, dlg: document.querySelectorAll('[role="dialog"],[role="tablist"],[role="tab"]').length };
    };
    window.__s.probe = probe;
    requestAnimationFrame(function tick(ts) {
      const now = ts - T0;
      window.__s.raf.push(Math.round(now * 10) / 10);
      if (window.__s.clickAt != null && window.__s.visibleAt == null) { try { const p = probe(); if (p.hits >= 3 && p.dlg >= 1) window.__s.visibleAt = now; } catch (e) {} }
      requestAnimationFrame(tick);
    });
    // CONTROL: a deliberate ~120ms synchronous block, later triggered from node
    window.__s.controlSpike = (ms) => {
      const s = performance.now();
      window.__s.controlStart = s - T0;
      while (performance.now() - s < ms) { /* block main thread */ }
      window.__s.controlEnd = performance.now() - T0;
      return { start: window.__s.controlStart, end: window.__s.controlEnd };
    };
  });

  const metrics = async () => { const m = await cdp.send('Performance.getMetrics'); const o = {}; for (const { name, value } of m.metrics) o[name] = value; return o; };
  const snap = () => page.evaluate(() => window.__s);

  // ---------- step 1: cold load, observe first 6s without interacting ----------
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(6000);
  const s1 = await snap();
  rec.steps.push({
    step: 'load-phase (no interaction, 6s)',
    longtasks: s1.lt,
    longtask_total_ms: r3(s1.lt.reduce((a, b) => a + b.d, 0)),
    raf_count: s1.raf.length,
  });

  // ---------- step 2: control spike — can the rAF stream register a known block? ----------
  const rafBefore = (await snap()).raf.length;
  const m1 = await metrics();
  const ctl = await page.evaluate(() => window.__s.controlSpike(120));
  await sleep(1200);
  const m2 = await metrics();
  const s2 = await snap();
  const rafWindow = s2.raf.slice(rafBefore);
  const iv = rafWindow.slice(1).map((t, i) => t - rafWindow[i]);
  const spikeIdx = rafWindow.findIndex((t) => t >= ctl.start);
  rec.steps.push({
    step: 'CONTROL: deliberate 120ms main-thread block',
    control_span_ms: r3(ctl.end - ctl.start),
    frames_during_window: rafWindow.length,
    interval_stats_around_control: stats(iv),
    interval_at_spike: spikeIdx > 0 ? r3(rafWindow[spikeIdx] - rafWindow[spikeIdx - 1]) : null,
    control_task_delta_ms: r3((m2.TaskDuration - m1.TaskDuration) * 1000),
    control_script_delta_ms: r3((m2.ScriptDuration - m1.ScriptDuration) * 1000),
    longtasks_observed: (await snap()).lt.filter((e) => e.s > ctl.start - 50),
  });

  // ---------- step 3: tight CDP delta strictly around the settings click ----------
  await sleep(1500);
  await page.evaluate(() => { window.__s.lt.length = 0; window.__s.raf.length = 0; });
  const pre = await metrics();
  const tClick = Date.now();
  await page.evaluate(() => { window.__s.clickAt = performance.now() - window.__s.t0; });
  await page.locator('button:has-text("设置")').first().click({ timeout: 5000, noWaitAfter: true });
  // wait for visible, in-page
  let visibleMs = null;
  const tWait = Date.now();
  while (Date.now() - tWait < 15000) {
    const v = await page.evaluate(() => window.__s.visibleAt);
    if (v != null) { visibleMs = r3(v - (await page.evaluate(() => window.__s.clickAt))); break; }
    await sleep(20);
  }
  const atVisible = await metrics();
  const s3 = await snap();
  const raf3 = s3.raf;
  const iv3 = raf3.slice(1).map((t, i) => t - raf3[i]);
  rec.steps.push({
    step: 'settings click -> visible (tight CDP delta)',
    click_to_visible_frame_ms: visibleMs,
    delta_window_ms: r3((atVisible.Timestamp - pre.Timestamp) * 1000),
    ScriptDuration_ms: r3((atVisible.ScriptDuration - pre.ScriptDuration) * 1000),
    TaskDuration_ms: r3((atVisible.TaskDuration - pre.TaskDuration) * 1000),
    RecalcStyleDuration_ms: r3((atVisible.RecalcStyleDuration - pre.RecalcStyleDuration) * 1000),
    LayoutDuration_ms: r3((atVisible.LayoutDuration - pre.LayoutDuration) * 1000),
    LayoutCount: atVisible.LayoutCount - pre.LayoutCount,
    RecalcStyleCount: atVisible.RecalcStyleCount - pre.RecalcStyleCount,
    longtasks_at_click: s3.lt,
    interval_stats_after_click: stats(iv3.slice(Math.max(0, raf3.findIndex((t) => t >= s3.clickAt)))),
    raf_frames: raf3.length,
    click_frame_delta: (() => { const i = raf3.findIndex((t) => t >= s3.clickAt); return i > 0 ? r3(raf3[i] - raf3[i - 1]) : null; })(),
    wall_click_epoch_ms: tClick,
  });

  rec.paint_presence = { Paint: 'Paint' in atVisible, CompositeLayers: 'CompositeLayers' in atVisible };
  rec.metric_names = Object.keys(atVisible).sort();

  // ---------- step 4: 3s idle window, is anything painting at all? ----------
  const i1 = await metrics();
  await sleep(3000);
  const i2 = await metrics();
  rec.steps.push({
    step: 'idle 3s window',
    Paint_delta: ('Paint' in i2) ? i2.Paint - i1.Paint : 'ABSENT',
    CompositeLayers_delta: ('CompositeLayers' in i2) ? i2.CompositeLayers - i1.CompositeLayers : 'ABSENT',
    TaskDuration_ms: r3((i2.TaskDuration - i1.TaskDuration) * 1000),
    ScriptDuration_ms: r3((i2.ScriptDuration - i1.ScriptDuration) * 1000),
    RecalcStyleCount: i2.RecalcStyleCount - i1.RecalcStyleCount,
    LayoutCount: i2.LayoutCount - i1.LayoutCount,
    raf_frames: (await snap()).raf.length,
  });

  await browser.close();
  const p = path.isAbsolute(OUT) ? OUT : path.join(ROOT, OUT);
  fs.writeFileSync(p, JSON.stringify(rec, null, 2));
  console.log(JSON.stringify(rec.steps.map((s) => ({ step: s.step.slice(0, 34), c2v: s.click_to_visible_frame_ms ?? null, ctl_ms: s.control_span_ms ?? null, iv_max: s.interval_stats_around_control?.max ?? s.interval_stats_after_click?.max ?? null, iv_over50: s.interval_stats_around_control?.over50 ?? s.interval_stats_after_click?.over50 ?? null, lt_n: s.longtasks?.length ?? s.longtasks_at_click?.length ?? null, Paint: s.Paint_delta ?? rec.paint_presence.Paint, Task: s.TaskDuration_ms ?? null, Recalc: s.RecalcStyleCount ?? null, Layout: s.LayoutCount ?? null })), null, 1));
}
main().catch((e) => { console.error('FATAL', e); process.exitCode = 1; });
