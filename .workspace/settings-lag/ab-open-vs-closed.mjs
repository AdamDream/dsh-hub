/*
 * LIVE A/B: does opening the settings dialog measurably change main-thread load
 * and frame jank on this GUI?
 *
 * Four consecutive 12 s windows in ONE page session, same quiet state:
 *   A  settings closed
 *   B  settings open, 通用设置 (General)
 *   C  settings open, 模型 (Models — the 131 KB bundle, 66 declared models)
 *   D  settings closed again
 *
 * Observation only: clicks the trigger and nav entries, closes the dialog.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const OUT = '/home/CNS2026495165/dsh/.workspace/settings-lag';
const URL = 'http://127.0.0.1:3080';
const WINDOW_MS = 12000;

const initScript = () => {
  window.__frames = [];
  requestAnimationFrame(function loop(t) { window.__frames.push(t); requestAnimationFrame(loop); });
  window.__longtasks = [];
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__longtasks.push(e.duration); })
      .observe({ entryTypes: ['longtask'] });
  } catch { }
  window.__mut = { panel: 0, outside: 0 };
  window.__installObs = () => {
    const panel = document.querySelector('[role="dialog"]');
    if (!panel) return false;
    new MutationObserver((rs) => {
      for (const r of rs) window.__mut.panel += r.addedNodes.length + r.removedNodes.length;
    }).observe(panel, { childList: true, subtree: true, attributes: true, characterData: true });
    return true;
  };
};

async function window_(page, cdp, label) {
  const f0 = await page.evaluate(() => window.__frames.length);
  const p0 = await cdp.send('Performance.getMetrics');
  const g = (p, n) => p.metrics.find((x) => x.name === n)?.value ?? null;
  await new Promise((r) => setTimeout(r, WINDOW_MS));
  const p1 = await cdp.send('Performance.getMetrics');

  return page.evaluate(([label, f0, a, b]) => {
    const frames = window.__frames;
    const deltas = frames.slice(f0 + 1).map((t, i) => t - frames[f0 + i]);
    const lt = window.__longtasks; window.__longtasks = [];
    const g2 = (o, n) => o[n];
    return {
      label,
      frames: frames.length - f0,
      fps: Math.round((frames.length - f0) / 12 * 10) / 10,
      frame_p50_ms: Math.round(deltas.slice().sort((x, y) => x - y)[Math.floor(deltas.length / 2)] * 10) / 10,
      frame_p95_ms: Math.round(deltas.slice().sort((x, y) => x - y)[Math.floor(deltas.length * 0.95)] * 10) / 10,
      frames_over_50ms: deltas.filter((d) => d > 50).length,
      frame_max_ms: Math.round(Math.max(...deltas) * 10) / 10,
      script_ms: Math.round((g2(b, 'ScriptDuration') - g2(a, 'ScriptDuration')) * 1000),
      task_ms: Math.round((g2(b, 'TaskDuration') - g2(a, 'TaskDuration')) * 1000),
      recalc_style_ms: Math.round((g2(b, 'RecalcStyleDuration') - g2(a, 'RecalcStyleDuration')) * 1000),
      layout_ms: Math.round((g2(b, 'LayoutDuration') - g2(a, 'LayoutDuration')) * 1000),
      longtasks: lt.length,
      longtask_total_ms: Math.round(lt.reduce((x, y) => x + y, 0)),
      dom_nodes: document.getElementsByTagName('*').length,
      panel_nodes: document.querySelector('[role="dialog"]')?.getElementsByTagName('*').length ?? 0,
      panel_mutations: window.__mut.panel,
    };
  }, [label, f0, Object.fromEntries(['ScriptDuration', 'TaskDuration', 'RecalcStyleDuration', 'LayoutDuration'].map((n) => [n, g(p0, n)])), Object.fromEntries(['ScriptDuration', 'TaskDuration', 'RecalcStyleDuration', 'LayoutDuration'].map((n) => [n, g(p1, n)]))]);
}

const run = async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.addInitScript(initScript);

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(9000);

  const rows = [];
  rows.push(await window_(page, cdp, 'A 设置关闭'));

  await page.locator('button:has-text("设置")').last().click({ timeout: 10000 });
  await page.waitForTimeout(3000);
  await page.evaluate(() => window.__installObs());
  rows.push(await window_(page, cdp, 'B 设置打开 · 通用设置'));

  await page.locator('[role="dialog"] button:has-text("模型")').first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(3000);
  await page.evaluate(() => { window.__mut.panel = 0; });
  rows.push(await window_(page, cdp, 'C 设置打开 · 模型'));

  await page.keyboard.press('Escape');
  await page.waitForTimeout(3000);
  rows.push(await window_(page, cdp, 'D 设置关闭（复原）'));

  fs.writeFileSync(`${OUT}/ab-open-vs-closed.json`, JSON.stringify(rows, null, 1));
  console.log(JSON.stringify(rows, null, 1));
  await browser.close();
};

run().catch((e) => { console.error('FATAL', e); process.exit(1); });
