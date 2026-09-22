#!/usr/bin/env node
/**
 * hover / pointer-capability ablation (v2, tightened detection).
 *
 * Question: do the historical Playwright headless launch args
 *   --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4
 * actually change what the page can see, and does the settings-open cost differ
 * between that pinned mode and the browser's natural capabilities?
 *
 * Detection is strict: the settings SURFACE must be present, proven by labels that
 * only exist once the panel is open (>=2 of ['通用设置','子代理模型']).
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
const OUT = arg('out', `raw/hover2-${MODE}-r${REP}.json`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);

const PINNED = '--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4';
const BASE = ['--no-sandbox', '--disable-dev-shm-usage', '--enable-precise-memory-info'];
const args = MODE === 'hoverless' ? [...BASE, PINNED] : [...BASE];

const STRICT = ['通用设置', '子代理模型'];

function stats(a) {
  const x = a.filter((v) => v != null).slice().sort((p, q) => p - q);
  const q = (p) => (x.length ? r3(x[Math.min(x.length - 1, Math.floor((x.length - 1) * p))]) : null);
  return { n: x.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: x.length ? r3(x[x.length - 1]) : null, over50: x.filter((v) => v > 50).length };
}

async function main() {
  const rec = { probe: 'hover-ablation-v2', mode: MODE, rep: REP, at: new Date().toISOString(), launch_args: args };
  const browser = await chromium.launch({ headless: true, args });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');

  await page.addInitScript((strict) => {
    const T0 = performance.now();
    window.__h = { raf: [], lt: [], clickAt: null, visibleAt: null, hovers: 0 };
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__h.lt.push({ s: Math.round((e.startTime - T0) * 10) / 10, d: Math.round(e.duration * 10) / 10 }); }).observe({ entryTypes: ['longtask'] }); } catch (e) {}
    const surface = () => {
      const t = document.body ? (document.body.innerText || '') : '';
      const hit = strict.filter((s) => t.includes(s));
      return { hits: hit.length, names: hit, dlg: document.querySelectorAll('[role="dialog"],[role="tablist"],[role="tab"]').length };
    };
    window.__h.surface = surface;
    requestAnimationFrame(function tick(ts) {
      const now = ts - T0;
      window.__h.raf.push(Math.round(now * 10) / 10);
      if (window.__h.clickAt != null && window.__h.visibleAt == null) {
        try { const p = surface(); if (p.hits >= 2) window.__h.visibleAt = now; } catch (e) {}
      }
      requestAnimationFrame(tick);
    });
    document.addEventListener('mouseover', () => { window.__h.hovers++; }, true);
  }, STRICT);

  const caps = () => page.evaluate(() => ({
    anyHover: matchMedia('(any-hover: hover)').matches,
    anyHoverNone: matchMedia('(any-hover: none)').matches,
    hoverHover: matchMedia('(hover: hover)').matches,
    anyPointerFine: matchMedia('(any-pointer: fine)').matches,
    anyPointerCoarse: matchMedia('(any-pointer: coarse)').matches,
    anyPointerNone: matchMedia('(any-pointer: none)').matches,
    primaryPointerFine: matchMedia('(pointer: fine)').matches,
    maxTouchPoints: navigator.maxTouchPoints,
  }));

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  for (let i = 0; i < 300; i++) { if (await page.locator('button:has-text("设置")').count().catch(() => 0)) break; await sleep(200); }
  await sleep(2500);
  rec.capabilities = await caps();
  rec.pre_click_surface_strict = await page.evaluate(() => window.__h.surface());
  rec.pre_click_loose_hits = await page.evaluate(() => {
    const t = document.body ? (document.body.innerText || '') : '';
    return ['通用', '插件', '模型', '远程', '子代理', '外观'].filter((s) => t.includes(s));
  });

  const metrics = async () => { const m = await cdp.send('Performance.getMetrics'); const o = {}; for (const { name, value } of m.metrics) o[name] = value; return o; };
  await page.evaluate(() => { window.__h.lt.length = 0; window.__h.raf.length = 0; });

  const entry = page.locator('button:has-text("设置")').first();
  await entry.hover({ timeout: 5000 }).catch(() => {});
  await sleep(400);
  const pre = await metrics();

  const clickAtPage = await page.evaluate(() => { window.__h.clickAt = performance.now(); return window.__h.clickAt; });
  await entry.click({ timeout: 5000, noWaitAfter: true });
  const tWait = Date.now();
  while (Date.now() - tWait < 15000) { const v = await page.evaluate(() => window.__h.visibleAt); if (v != null) break; await sleep(20); }
  const post = await metrics();
  const s = await page.evaluate(() => window.__h);
  const surfaceNow = await page.evaluate(() => window.__h.surface());

  const iv = s.raf.slice(1).map((t, i) => t - s.raf[i]);
  rec.result = {
    click_at_page_ms: r3(clickAtPage),
    visible_at_page_ms: r3(s.visibleAt),
    click_to_visible_frame_ms: s.visibleAt != null ? r3(s.visibleAt - clickAtPage) : null,
    frames_between_click_and_visible: s.visibleAt != null ? s.raf.filter((t) => t > clickAtPage && t < s.visibleAt).length : null,
    surface_at_visible: surfaceNow,
    hover_events_total: s.hovers,
    frame_stats: stats(iv),
    frames_over_50ms_ratio: iv.length ? r3(iv.filter((v) => v > 50).length / iv.length) : null,
    longtasks: s.lt, longtask_max_ms: s.lt.length ? Math.max(...s.lt.map((e) => e.d)) : 0,
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
  console.log(JSON.stringify({ mode: MODE, rep: REP, caps: `${rec.capabilities.anyHover}/${rec.capabilities.anyPointerFine}`, prehits: rec.pre_click_surface_strict.hits, c2v: rec.result.click_to_visible_frame_ms, nbf: rec.result.frames_between_click_and_visible, p95: rec.result.frame_stats.p95, over50: rec.result.frame_stats.over50, ltmax: rec.result.longtask_max_ms, recalc_ms: rec.result.RecalcStyleDuration_ms, recalc_n: rec.result.RecalcStyleCount, layout_n: rec.result.LayoutCount, hover_ev: rec.result.hover_events_total }));
}
main().catch((e) => { console.error('FATAL', e); process.exitCode = 1; });
