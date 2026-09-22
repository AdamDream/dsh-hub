/**
 * Probe 2 — tight-window decomposition of the "click the 插件 page" cost.
 *
 * Differences from probe 1 (which exposed two rig artifacts):
 *  - the milestone watch resolves on the PRIMARY selector only, so the CDP metric
 *    window is a few ms wide instead of accidentally spanning a 30 s timeout;
 *  - every click is bracketed by an ambient-only window of the same rig, so the
 *    click cost can be netted against this machine's background duty cycle;
 *  - the blocking-channel positive control is injected through three routes
 *    (Runtime.evaluate / page timer task / rAF callback) because the Long Tasks API
 *    does not attribute DevTools-initiated tasks to the page;
 *  - RPC identity is taken from the request BODY (`method`), with the URL kept
 *    alongside for cross-checking.
 *
 * Only these controls are clicked: Settings entry, nav "通用设置", nav "插件",
 * tab "插件列表". Nothing that saves, applies, resets or disables is ever clicked.
 */
import { launchChrome, newContext, BASE, writeJson, stamp } from './lib-env.mjs';
import { INIT_HOOKS, readMetrics, metricDelta } from './lib-instrument.mjs';
import os from 'node:os';

const OUT = new URL('./raw/', import.meta.url).pathname;
const TAG = stamp();

const WATCH = {
  section_heading: 'h2.pbvGtq_heading',
  tablist: '[role=tablist]',
  tab_configurable: '[role=tab][id$="-tab-configurable"]',
  tab_inventory: '[role=tab][id$="-tab-all"]',
  panel: '[role=tabpanel]',
  usage_trend: '[aria-label="usage trend"]',
  usage_heatmap: '[aria-label="usage heatmap"]',
  plugin_entries: '[data-plugin-entry]',
  plugin_count: '[data-plugin-count]',
};

const condition = () => ({
  at: new Date().toISOString(),
  loadavg: os.loadavg().map((v) => Math.round(v * 100) / 100),
  cpus: os.cpus().length,
  freeMemMB: Math.round(os.freemem() / 1048576),
});

async function snap(page, cdp) {
  const metrics = await readMetrics(cdp);
  const t = await page.evaluate(() => performance.now());
  const counts = await page.evaluate(() => window.__PP__.counts());
  return { metrics, t, counts };
}

const slice = (page) =>
  page.evaluate(() => {
    const P = window.__PP__;
    return {
      support: P.support, anchor: P.anchor, marks: P.marks,
      longTasks: P.longTasks, loaf: P.loaf, events: P.events,
      frames: P.frames, rpc: P.rpc, ws: P.ws, lastWatch: P.lastWatch,
      counts: P.counts(),
      resources: performance.getEntriesByType('resource').map((r) => ({
        name: r.name, startTime: r.startTime, duration: r.duration,
        encodedBodySize: r.encodedBodySize, transferSize: r.transferSize,
      })),
    };
  });

async function appReady(page) {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.getByRole('button', { name: /^设置$/ }).first().waitFor({ state: 'visible', timeout: 40000 });
  await page.waitForTimeout(800);
}

async function openSettings(page) {
  await page.getByRole('button', { name: /^设置$/ }).first().click();
  await page.getByRole('button', { name: /^通用设置$/ }).first().waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForTimeout(1200);
}

const clickNav = async (page, name) =>
  page.getByRole('button', { name }).first().click({ timeout: 10000 });

/** One measured click with ambient bracket and three synchronized CDP snapshots. */
async function measured(page, cdp, { label, role, name, primary, ambientMs = 300, tails = [600, 1500] }) {
  const rpcIdx0 = await page.evaluate(() => window.__PP__.rpc.length);
  const ltIdx0 = await page.evaluate(() => window.__PP__.longTasks.length);
  const loafIdx0 = await page.evaluate(() => window.__PP__.loaf.length);
  const evIdx0 = await page.evaluate(() => window.__PP__.events.length);

  // ambient bracket: no interaction at all
  const amb0 = await snap(page, cdp);
  await page.waitForTimeout(ambientMs);
  const amb1 = await snap(page, cdp);

  // arm, then a single trusted click
  await page.evaluate((l) => window.__PP__.arm(l), label);
  const pre = await snap(page, cdp);
  const loc = page.getByRole(role, { name });
  const matched = await loc.count();
  const clickErr = [];
  const watchP = page.evaluate(
    ([s, p]) => window.__PP__.watchPrimary(s, p, 20000),
    [WATCH, primary],
  );
  try { await loc.first().click({ timeout: 10000 }); } catch (e) { clickErr.push(String(e).slice(0, 200)); }
  let watchRes = null;
  try { watchRes = await watchP; } catch (e) { watchRes = { __error: String(e).slice(0, 200) }; }
  const atPrimary = await snap(page, cdp);

  const tailsOut = [];
  for (const w of tails) {
    const stamped = await page.evaluate((x) => window.__PP__.waitToClickPlus(x), w);
    const s = await snap(page, cdp);
    tailsOut.push({ w, stamped, snap: s });
  }
  // give the remaining milestones a bounded chance to show up, then read them off
  await page.evaluate(([s]) => window.__PP__.finishWatch(s, 1200), [WATCH]).catch(() => {});
  const data = await slice(page);

  return {
    label, matched, clickErr,
    ambient: { ms: amb1.t - amb0.t, delta: metricDelta(amb0.metrics, amb1.metrics) },
    pre, atPrimary, tails: tailsOut,
    windows: {
      toPrimaryMs: atPrimary.t - pre.t,
      primaryRelClickMs: watchRes && watchRes.primaryHit ? watchRes.primaryHit.t - (data.anchor ? data.anchor.tClick : NaN) : null,
      armToClickMs: data.anchor && data.anchor.tClick != null ? data.anchor.tClick - data.anchor.tArm : null,
      deltaToPrimary: metricDelta(pre.metrics, atPrimary.metrics),
      deltaTails: tailsOut.map((t) => ({ w: t.w, windowMs: t.snap.t - pre.t, delta: metricDelta(pre.metrics, t.snap.metrics) })),
    },
    watch: watchRes,
    counts: { pre: pre.counts, atPrimary: atPrimary.counts, end: data.counts },
    data: {
      ...data,
      rpcInWindow: data.rpc.slice(rpcIdx0),
      longTasksInWindow: data.longTasks.slice(ltIdx0),
      loafInWindow: data.loaf.slice(loafIdx0),
      eventsInWindow: data.events.slice(evIdx0),
    },
  };
}

/** Validate the blocking channels through three injection routes. */
async function controls(page, cdp) {
  const out = [];
  for (const route of ['controlEval', 'controlTimer', 'controlRaf']) {
    const lt0 = await page.evaluate(() => window.__PP__.longTasks.length);
    const loaf0 = await page.evaluate(() => window.__PP__.loaf.length);
    const m0 = await readMetrics(cdp);
    const t0 = await page.evaluate(() => performance.now());
    await page.evaluate((r) => window.__PP__[r](120), route);
    await page.waitForTimeout(800);
    const m1 = await readMetrics(cdp);
    const t1 = await page.evaluate(() => performance.now());
    const d = await slice(page);
    out.push({
      route, requestedMs: 120, windowMs: t1 - t0,
      longTasks: d.longTasks.slice(lt0), loaf: d.loaf.slice(loaf0),
      cdpDelta: metricDelta(m0, m1),
    });
  }
  return out;
}

const report = { base: BASE, tag: TAG, watchSpec: WATCH, conditionStart: condition(), scenarios: {} };

// ---------------------------------------------------------------- P1
{
  const { browser } = await launchChrome({ headless: true });
  const P1 = { condition: condition(), navSeries: [], inventorySeries: [] };
  try {
    const ctx = await newContext(browser);
    await ctx.addInitScript({ content: INIT_HOOKS });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Performance.enable');
    P1.env = await page.evaluate(() => ({
      ua: navigator.userAgent, dpr: devicePixelRatio,
      viewport: { w: innerWidth, h: innerHeight }, lang: navigator.language,
    }));
    await appReady(page);
    await openSettings(page);
    P1.afterSettingsOpen = { counts: await page.evaluate(() => window.__PP__.counts()) };

    P1.controls = await controls(page, cdp);

    // nav "插件" series: first click cold, the rest after leaving the section
    for (let i = 0; i < 8; i++) {
      if (i > 0) {
        await clickNav(page, /^通用设置$/);
        await page.waitForTimeout(900);
      }
      P1.navSeries.push(await measured(page, cdp, {
        label: `P1-nav-${i}${i === 0 ? '-cold' : '-warm'}`,
        role: 'button', name: /^插件$/, primary: 'section_heading',
      }));
    }

    // inventory tab series: each repeat re-mounts the section so the panel is fresh
    for (let i = 0; i < 6; i++) {
      await clickNav(page, /^通用设置$/);
      await page.waitForTimeout(900);
      await clickNav(page, /^插件$/);
      await page.waitForTimeout(1200);
      P1.inventorySeries.push(await measured(page, cdp, {
        label: `P1-inv-${i}`, role: 'tab', name: /^插件列表$/, primary: 'plugin_entries',
      }));
    }
    P1.done = true;
  } catch (e) { P1.error = String(e).slice(0, 1500); } finally { await browser.close(); }
  report.scenarios.P1 = P1;
}

// ---------------------------------------------------------------- P2 (independent replicate, fresh browser)
{
  const { browser } = await launchChrome({ headless: true });
  const P2 = { condition: condition(), navSeries: [], inventorySeries: [] };
  try {
    const ctx = await newContext(browser);
    await ctx.addInitScript({ content: INIT_HOOKS });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Performance.enable');
    await appReady(page);
    await openSettings(page);
    P2.navSeries.push(await measured(page, cdp, { label: 'P2-nav-0-cold', role: 'button', name: /^插件$/, primary: 'section_heading' }));
    await page.waitForTimeout(1500);
    P2.inventorySeries.push(await measured(page, cdp, { label: 'P2-inv-0-cold', role: 'tab', name: /^插件列表$/, primary: 'plugin_entries' }));
    P2.done = true;
  } catch (e) { P2.error = String(e).slice(0, 1500); } finally { await browser.close(); }
  report.scenarios.P2 = P2;
}

report.conditionEnd = condition();
console.log(writeJson(OUT, `click2-raw-${TAG}.json`, report));
