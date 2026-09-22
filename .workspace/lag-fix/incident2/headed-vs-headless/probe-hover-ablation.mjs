#!/usr/bin/env node
/**
 * Ablation: the historical Playwright/headless configuration pins
 *   --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4
 * i.e. "no hover / no fine pointer". A real headed desktop browser has hover and a
 * fine pointer, so hover/focus styling that only exists in the headed case is
 * structurally erased from every historical headless measurement.
 *
 * Arms:
 *   hoverless  -> explicitly pinned to the historical settings (control)
 *   natural    -> let Chromium report its natural capabilities for this platform
 * Compare with identical judging criteria.
 */
import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = '/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/headed-vs-headless';
const URL = 'http://127.0.0.1:3080/';
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : argv[i + 1]; };
const MODE = arg('mode', 'hoverless');
const REP = arg('rep', '1');
const OUT = arg('out', `raw/hover-${MODE}-r${REP}.json`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);

const PINNED = '--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4';
const BASE = ['--no-sandbox', '--disable-dev-shm-usage', '--enable-precise-memory-info'];
const args = MODE === 'hoverless' ? [...BASE, PINNED] : [...BASE];

function stats(a) {
  const x = a.filter((v) => v != null).slice().sort((p, q) => p - q);
  const q = (p) => (x.length ? r3(x[Math.min(x.length - 1, Math.floor((x.length - 1) * p))]) : null);
  return { n: x.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: x.length ? r3(x[x.length - 1]) : null, over50: x.filter((v) => v > 50).length };
}

async function main() {
  const rec = { probe: 'hover-ablation', mode: MODE, rep: REP, at: new Date().toISOString(), launch_args: args };
  const browser = await chromium.launch({ headless: true, args });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');

  await page.addInitScript(() => {
    const T0 = performance.now();
    window.__h = { raf: [], lt: [], clickAt: null, visibleAt: null, hovers: 0 };
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__h.lt.push({ s: Math.round((e.startTime - T0) * 10) / 10, d: Math.round(e.duration * 10) / 10 }); }).observe({ entryTypes: ['longtask'] }); } catch (e) {}
    const probe = () => { const t = document.body ? (document.body.innerText || '') : ''; return { hits: ['通用', '插件', '模型', '远程', '子代理', '外观'].filter((s) => t.includes(s)).length, dlg: document.querySelectorAll('[role="dialog"],[role="tablist"],[role="tab"]').length }; };
    window.__h.probe = probe;
    requestAnimationFrame(function tick(ts) {
      const now = ts - T0;
      window.__h.raf.push(Math.round(now * 10) / 10);
      if (window.__h.clickAt != null && window.__h.visibleAt == null) { try { const p = probe(); if (p.hits >= 3 && p.dlg >= 1) window.__h.visibleAt = now; } catch (e) {} }
      requestAnimationFrame(tick);
    });
    // count real mouse-hover style recalculations: mouseover/mouseenter on the settings entry
    document.addEventListener('mouseover', () => { window.__h.hovers++; }, true);
  });

  const caps = () => page.evaluate(() => ({
    anyHover: matchMedia('(any-hover: hover)').matches,
    anyPointerFine: matchMedia('(any-pointer: fine)').matches,
    hoverHover: matchMedia('(hover: hover)').matches,
    pointerFine: matchMedia('(pointer: fine)').matches,
    primaryPointerFine: matchMedia('(pointer: fine)').matches,
    prefersReducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
  }));

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  for (let i = 0; i < 300; i++) { if (await page.locator('button:has-text("设置")').count().catch(() => 0)) break; await sleep(200); }
  rec.capabilities = await caps();
  await sleep(2500);

  const metrics = async () => { const m = await cdp.send('Performance.getMetrics'); const o = {}; for (const { name, value } of m.metrics) o[name] = value; return o; };
  await page.evaluate(() => { window.__h.lt.length = 0; window.__h.raf.length = 0; });

  // hover the entry first (headed browsers would do this naturally before a click)
  const entry = page.locator('button:has-text("设置")').first();
  await entry.hover({ timeout: 5000 }).catch(() => {});
  await sleep(400);
  const pre = await metrics();

  // Click mark: capture the page clock immediately before the click, from node,
  // so an in-page mark cannot be stale relative to Playwright's actionability work.
  const tOrigin = await page.evaluate(() => performance.timeOrigin);
  const clickAtPage = await page.evaluate(() => { window.__h.clickAt = performance.now(); return window.__h.clickAt; });
  await entry.click({ timeout: 5000, noWaitAfter: true });
  const tWait = Date.now();
  while (Date.now() - tWait < 15000) { const v = await page.evaluate(() => window.__h.visibleAt); if (v != null) break; await sleep(20); }
  const post = await metrics();
  const s = await page.evaluate(() => window.__h);

  const iv = s.raf.slice(1).map((t, i) => t - s.raf[i]);
  rec.result = {
    click_at_page_ms: r3(clickAtPage),
    click_to_visible_frame_ms: s.visibleAt != null ? r3(s.visibleAt - clickAtPage) : null,
    hover_events_before_click: s.hovers,
    frame_stats: stats(iv),
    frames_over_50ms_ratio: iv.length ? r3(iv.filter((v) => v > 50).length / iv.length) : null,
    longtasks: s.lt,
    longtask_max_ms: s.lt.length ? Math.max(...s.lt.map((e) => e.d)) : 0,
    ScriptDuration_ms: r3((post.ScriptDuration - pre.ScriptDuration) * 1000),
    TaskDuration_ms: r3((post.TaskDuration - pre.TaskDuration) * 1000),
    RecalcStyleDuration_ms: r3((post.RecalcStyleDuration - pre.RecalcStyleDuration) * 1000),
    LayoutDuration_ms: r3((post.LayoutDuration - pre.LayoutDuration) * 1000),
    LayoutCount: post.LayoutCount - pre.LayoutCount,
    RecalcStyleCount: post.RecalcStyleCount - pre.RecalcStyleCount,
    Paint_present: 'Paint' in post, CompositeLayers_present: 'CompositeLayers' in post,
  };
  await browser.close();
  const p = path.isAbsolute(OUT) ? OUT : path.join(ROOT, OUT);
  fs.writeFileSync(p, JSON.stringify(rec, null, 2));
  console.log(JSON.stringify({ mode: MODE, rep: REP, caps: rec.capabilities.anyHover + '/' + rec.capabilities.anyPointerFine, c2v: rec.result.click_to_visible_frame_ms, p95: rec.result.frame_stats.p95, over50: rec.result.frame_stats.over50, ltmax: rec.result.longtask_max_ms, recalc_dur: rec.result.RecalcStyleDuration_ms, recalc_n: rec.result.RecalcStyleCount, layout_n: rec.result.LayoutCount, hover_ev: rec.result.hover_events_before_click }));
}
main().catch((e) => { console.error('FATAL', e); process.exitCode = 1; });
