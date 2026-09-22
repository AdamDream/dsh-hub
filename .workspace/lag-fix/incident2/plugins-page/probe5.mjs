/**
 * Probe 5 — is the user's Chrome flag an amplifier for this specific page?
 *
 * The reporting user's Chrome runs with --force-renderer-accessibility (captured in
 * raw/user-chrome-cmdline.txt). The inventory draws, per plugin card, a role="img"
 * span with aria-label plus an SVG chevron, so an always-on accessibility tree is a
 * plausible amplifier that a default headless run would not show.
 *
 * This probe runs the same two clicks as probe2's series with that flag ON, so the
 * A/B is within my own rig. Safe controls only: settings entry, nav 通用设置, nav 插件,
 * tab 插件列表.
 */
import { chromium } from 'playwright';
import { newContext, BASE, writeJson, stamp } from './lib-env.mjs';
import { INIT_HOOKS, readMetrics, metricDelta } from './lib-instrument.mjs';
import os from 'node:os';

const OUT = new URL('./raw/', import.meta.url).pathname;
const TAG = stamp();

const BASE_ARGS = [
  '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--disable-component-update', '--disable-sync',
  '--disable-extensions', '--disable-default-apps',
  '--disable-features=Translate,OptimizationHints,MediaRouter', '--lang=zh-CN',
];

const WATCH = {
  section_heading: 'h2.pbvGtq_heading',
  tablist: '[role=tablist]',
  plugin_entries: '[data-plugin-entry]',
  plugin_count: '[data-plugin-count]',
};

const snap = async (page, cdp) => ({
  metrics: await readMetrics(cdp),
  t: await page.evaluate(() => performance.now()),
  counts: await page.evaluate(() => window.__PP__.counts()),
});

const slice = (page) => page.evaluate(() => {
  const P = window.__PP__;
  return { support: P.support, anchor: P.anchor, longTasks: P.longTasks, loaf: P.loaf,
    frames: P.frames, rpc: P.rpc, events: P.events, counts: P.counts(), lastWatch: P.lastWatch };
});

async function measured(page, cdp, { label, role, name, primary, ambientMs = 300 }) {
  const lt0 = await page.evaluate(() => window.__PP__.longTasks.length);
  const loaf0 = await page.evaluate(() => window.__PP__.loaf.length);
  const rpc0 = await page.evaluate(() => window.__PP__.rpc.length);
  const amb0 = await snap(page, cdp);
  await page.waitForTimeout(ambientMs);
  const amb1 = await snap(page, cdp);
  await page.evaluate((l) => window.__PP__.arm(l), label);
  const pre = await snap(page, cdp);
  const watchP = page.evaluate(([s, p]) => window.__PP__.watchPrimary(s, p, 20000), [WATCH, primary]);
  await page.getByRole(role, { name }).first().click({ timeout: 10000 });
  const w = await watchP;
  const atPrimary = await snap(page, cdp);
  await page.evaluate((x) => window.__PP__.waitToClickPlus(x), 700);
  const at700 = await snap(page, cdp);
  const data = await slice(page);
  return {
    label, watch: w,
    ambient: { ms: amb1.t - amb0.t, delta: metricDelta(amb0.metrics, amb1.metrics) },
    windows: {
      toPrimaryMs: atPrimary.t - pre.t,
      primaryRelClickMs: w.primaryHit ? w.primaryHit.t - data.anchor.tClick : null,
      armToClickMs: data.anchor.tClick != null ? data.anchor.tClick - data.anchor.tArm : null,
      deltaToPrimary: metricDelta(pre.metrics, atPrimary.metrics),
      window700Ms: at700.t - pre.t,
      deltaTo700: metricDelta(pre.metrics, at700.metrics),
    },
    counts: { pre: pre.counts, atPrimary: atPrimary.counts },
    longTasksInWindow: data.longTasks.slice(lt0),
    loafInWindow: data.loaf.slice(loaf0),
    rpcInWindow: data.rpc.slice(rpc0),
    frames: data.frames,
  };
}

const report = { base: BASE, tag: TAG, variant: 'chrome --force-renderer-accessibility', condition: { at: new Date().toISOString(), loadavg: os.loadavg() } };

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: [...BASE_ARGS, '--force-renderer-accessibility'] });
try {
  const ctx = await newContext(browser);
  await ctx.addInitScript({ content: INIT_HOOKS });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.getByRole('button', { name: /^设置$/ }).first().waitFor({ state: 'visible', timeout: 40000 });
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: /^设置$/ }).first().click();
  await page.getByRole('button', { name: /^通用设置$/ }).first().waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForTimeout(1200);

  report.navSeries = [];
  for (let i = 0; i < 4; i++) {
    if (i > 0) { await page.getByRole('button', { name: /^通用设置$/ }).first().click(); await page.waitForTimeout(900); }
    report.navSeries.push(await measured(page, cdp, { label: `a11y-nav-${i}${i === 0 ? '-cold' : ''}`, role: 'button', name: /^插件$/, primary: 'section_heading' }));
  }
  report.inventorySeries = [];
  for (let i = 0; i < 4; i++) {
    await page.getByRole('button', { name: /^通用设置$/ }).first().click();
    await page.waitForTimeout(900);
    await page.getByRole('button', { name: /^插件$/ }).first().click();
    await page.waitForTimeout(1200);
    report.inventorySeries.push(await measured(page, cdp, { label: `a11y-inv-${i}`, role: 'tab', name: /^插件列表$/, primary: 'plugin_entries' }));
  }
  report.done = true;
} catch (e) {
  report.error = String(e).slice(0, 1200);
} finally {
  await browser.close();
}
report.conditionEnd = { at: new Date().toISOString(), loadavg: os.loadavg() };
console.log(writeJson(OUT, `click5-raw-${TAG}.json`, report));
