/**
 * Probe 3 — marginal per-plugin render cost and SVG/DOM attribution.
 *
 * Measures the same React map() path that renders the inventory, at several list
 * sizes, by driving the tab's own search filter. Uses matched-length idle windows
 * from the identical rig as the baseline, so the per-entry slope is netted against
 * this machine's background duty cycle rather than assumed.
 *
 * Safe interactions only: settings entry, nav "插件", tab "插件列表", and typing into
 * the search box. Nothing that saves, applies, resets or disables is clicked.
 */
import { launchChrome, newContext, BASE, writeJson, stamp } from './lib-env.mjs';
import { INIT_HOOKS, readMetrics, metricDelta } from './lib-instrument.mjs';
import os from 'node:os';

const OUT = new URL('./raw/', import.meta.url).pathname;
const TAG = stamp();
const report = { base: BASE, tag: TAG, condition: { at: new Date().toISOString(), loadavg: os.loadavg() } };

const snap = async (page, cdp) => ({
  metrics: await readMetrics(cdp),
  t: await page.evaluate(() => performance.now()),
});

const SVG_ATTRIB = () => {
  const panel = document.querySelectorAll('[role=tabpanel]');
  const inv = [...panel].find((p) => p.querySelector('[data-plugin-entry]'));
  const card = document.querySelector('[data-plugin-entry]');
  const tagHist = (root) => {
    const h = {};
    if (!root) return h;
    for (const el of root.getElementsByTagName('*')) h[el.tagName.toLowerCase()] = (h[el.tagName.toLowerCase()] || 0) + 1;
    return h;
  };
  return {
    docSvg: document.getElementsByTagName('svg').length,
    docElements: document.getElementsByTagName('*').length,
    panelCount: panel.length,
    invPanelFound: Boolean(inv),
    invPanelSvg: inv ? inv.getElementsByTagName('svg').length : null,
    invPanelElements: inv ? inv.getElementsByTagName('*').length : null,
    invPanelTagHist: tagHist(inv),
    firstCardSvg: card ? card.getElementsByTagName('svg').length : null,
    firstCardElements: card ? card.getElementsByTagName('*').length : null,
    firstCardTagHist: tagHist(card),
    firstCardHtml: card ? card.outerHTML.slice(0, 900) : null,
    entries: document.querySelectorAll('[data-plugin-entry]').length,
    countAttr: (document.querySelector('[data-plugin-count]') || {}).getAttribute
      ? document.querySelector('[data-plugin-count]').getAttribute('data-plugin-count') : null,
  };
};

const { browser } = await launchChrome({ headless: true });
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
  await page.getByRole('button', { name: /^插件$/ }).first().click({ timeout: 10000 });
  await page.waitForTimeout(1500);
  await page.getByRole('tab', { name: /^插件列表$/ }).first().click({ timeout: 10000 });
  await page.waitForSelector('[data-plugin-entry]', { timeout: 20000 });
  await page.waitForTimeout(1500);

  report.svgAttribution = await page.evaluate(SVG_ATTRIB);

  // matched-length idle windows from the identical rig
  report.idleWindows = [];
  for (const L of [250, 500]) {
    for (let i = 0; i < 3; i++) {
      const a = await snap(page, cdp);
      await page.waitForTimeout(L);
      const b = await snap(page, cdp);
      report.idleWindows.push({ L, windowMs: b.t - a.t, delta: metricDelta(a.metrics, b.metrics) });
    }
  }

  // filter series: same map() path, different list sizes
  const box = page.getByRole('searchbox').first();
  report.filterSeries = [];
  for (const q of ['', 'pptmaster', 'usage', 'dsh', 'cordis', 'zzz-no-match']) {
    const countBefore = await page.evaluate(() => document.querySelectorAll('[data-plugin-entry]').length);
    const a = await snap(page, cdp);
    await box.fill(q);
    await page.waitForTimeout(400);
    const b = await snap(page, cdp);
    const after = await page.evaluate(() => ({
      entries: document.querySelectorAll('[data-plugin-entry]').length,
      countAttr: (document.querySelector('[data-plugin-count]') || {}).getAttribute
        ? document.querySelector('[data-plugin-count]').getAttribute('data-plugin-count') : null,
      svg: document.getElementsByTagName('svg').length,
      all: document.getElementsByTagName('*').length,
    }));
    report.filterSeries.push({
      query: q, windowMs: b.t - a.t, countBefore, ...after,
      delta: metricDelta(a.metrics, b.metrics),
    });
  }
  report.done = true;
} catch (e) {
  report.error = String(e).slice(0, 1500);
} finally {
  await browser.close();
}
report.conditionEnd = { at: new Date().toISOString(), loadavg: os.loadavg() };
console.log(writeJson(OUT, `click3-raw-${TAG}.json`, report));
