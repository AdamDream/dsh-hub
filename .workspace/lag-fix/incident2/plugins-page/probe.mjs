/**
 * Plugins-page click-cost probe.
 *
 * Serial by construction: exactly one browser instance exists at a time, and every
 * scenario is driven with trusted input through a single page.
 *
 * Only these controls are ever clicked: the Settings entry, the "插件" nav item,
 * the "通用设置" nav item, and the "插件列表" tab. Nothing that saves, applies,
 * resets or disables is ever clicked.
 */
import { launchChrome, newContext, BASE, writeJson, stamp } from './lib-env.mjs';
import { INIT_HOOKS, readMetrics, metricDelta } from './lib-instrument.mjs';
import os from 'node:os';

const OUT = new URL('./raw/', import.meta.url).pathname;
const TAG = stamp();

const NAV = {
  settings: () => ({ role: 'button', name: /^设置$/ }),
  plugins: () => ({ role: 'button', name: /^插件$/ }),
  general: () => ({ role: 'button', name: /^通用设置$/ }),
  inventoryTab: () => ({ role: 'tab', name: /^插件列表$/ }),
};

const WATCH_SPEC = {
  tablist: '[role=tablist]',
  tab_configurable: '[role=tab][id$="-tab-configurable"]',
  tab_inventory: '[role=tab][id$="-tab-all"]',
  section_heading: 'h2.pbvGtq_heading',
  plugin_entries: '[data-plugin-entry]',
  plugin_count: '[data-plugin-count]',
};

const condition = () => ({
  at: new Date().toISOString(),
  loadavg: os.loadavg(),
  cpus: os.cpus().length,
  freeMemMB: Math.round(os.freemem() / 1048576),
  totalMemMB: Math.round(os.totalmem() / 1048576),
});

const slice = (page) =>
  page.evaluate(() => {
    const P = window.__PP__;
    P.stopFrames();
    const res = performance.getEntriesByType('resource').map((r) => ({
      name: r.name, initiatorType: r.initiatorType, startTime: r.startTime,
      duration: r.duration, transferSize: r.transferSize, encodedBodySize: r.encodedBodySize,
      decodedBodySize: r.decodedBodySize,
    }));
    return {
      support: P.support,
      tOrigin: P.tOrigin,
      anchor: P.anchor,
      marks: P.marks,
      longTasks: P.longTasks,
      loaf: P.loaf,
      events: P.events,
      frames: P.frames,
      rpc: P.rpc,
      ws: P.ws,
      counts: P.counts(),
      resources: res,
    };
  });

async function appReady(page) {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.getByRole('button', { name: /^设置$/ }).first().waitFor({ state: 'visible', timeout: 40000 });
  await page.waitForTimeout(800);
}

async function openSettings(page) {
  const b = page.getByRole('button', { name: /^设置$/ }).first();
  await b.click();
  await page.getByRole('button', { name: /^通用设置$/ }).first().waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForTimeout(1200);
}

async function clickNav(page, key) {
  const spec = NAV[key]();
  const loc = page.getByRole(spec.role, { name: spec.name });
  const n = await loc.count();
  return { matched: n, loc };
}

/** One measured click: arm -> trusted click -> wait for milestones -> settle -> dump. */
async function measuredClick(page, cdp, { label, role, name, spec, settleMs = 400, clickTimeout = 8000 }) {
  const before = await readMetrics(cdp);
  const countsBefore = await page.evaluate(() => window.__PP__.counts());
  const rpcBefore = await page.evaluate(() => window.__PP__.rpc.length);

  await page.evaluate((l) => window.__PP__.arm(l), label);

  const loc = page.getByRole(role, { name });
  const matched = await loc.count();
  const clickErr = [];
  const watchPromise = page.evaluate((s) => window.__PP__.watch(s, 30000), spec);
  try {
    await loc.first().click({ timeout: clickTimeout });
  } catch (e) {
    clickErr.push(String(e).slice(0, 300));
  }
  let milestones = null;
  try {
    milestones = await Promise.race([
      watchPromise,
      new Promise((r) => setTimeout(() => r({ __timeout: true }), 33000)),
    ]);
  } catch (e) {
    milestones = { __error: String(e).slice(0, 300) };
  }
  const afterVisible = await readMetrics(cdp);
  const countsAtVisible = await page.evaluate(() => window.__PP__.counts());
  await page.waitForTimeout(settleMs);
  const afterSettle = await readMetrics(cdp);
  const countsAfterSettle = await page.evaluate(() => window.__PP__.counts());

  const data = await slice(page);
  data.rpcInWindow = data.rpc.slice(rpcBefore);
  return {
    label, matched, clickErr, milestones,
    cdp: {
      before,
      atVisible: afterVisible,
      afterSettle,
      deltaToVisible: metricDelta(before, afterVisible),
      deltaToSettle: metricDelta(before, afterSettle),
    },
    countsBefore,
    countsAtVisible,
    countsAfterSettle,
    data,
  };
}

/** Positive control: inject a known main-thread block and confirm the channels report it. */
async function controlBlock(page, cdp, ms, label) {
  const before = await readMetrics(cdp);
  await page.evaluate((l) => window.__PP__.arm(l), label);
  const ltBefore = await page.evaluate(() => window.__PP__.longTasks.length);
  const loafBefore = await page.evaluate(() => window.__PP__.loaf.length);
  const actual = await page.evaluate((m) => window.__PP__.block(m), ms);
  await page.waitForTimeout(600);
  const after = await readMetrics(cdp);
  const d = await slice(page);
  return {
    label,
    requestedMs: ms,
    actualBlockMs: actual,
    longTasksInSlice: d.longTasks.slice(ltBefore),
    loafInSlice: d.loaf.slice(loafBefore),
    cdpDelta: metricDelta(before, after),
    framesInSlice: d.frames,
    marks: d.marks,
  };
}

const report = { base: BASE, tag: TAG, scenarios: {}, conditionStart: condition() };

// ---------------------------------------------------------------- Scenario A
{
  const { browser } = await launchChrome({ headless: true });
  const A = { condition: condition() };
  try {
    const ctx = await newContext(browser);
    await ctx.addInitScript({ content: INIT_HOOKS });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Performance.enable');
    A.env = await page.evaluate(() => ({
      ua: navigator.userAgent, dpr: devicePixelRatio,
      viewport: { w: innerWidth, h: innerHeight }, lang: navigator.language,
    })).catch(() => null);

    await appReady(page);
    await openSettings(page);
    A.preNav = { counts: await page.evaluate(() => window.__PP__.counts()) };

    // A1: COLD click on nav "插件"
    A.coldNav = await measuredClick(page, cdp, {
      label: 'A1-cold-nav-plugins', role: 'button', name: /^插件$/, spec: WATCH_SPEC, settleMs: 600,
    });
    // A2: WARM click (leave the section, come back) — bundles already materialized
    try {
      await page.getByRole('button', { name: /^通用设置$/ }).first().click({ timeout: 8000 });
      await page.waitForTimeout(1500);
    } catch (e) { A.warmSetupError = String(e).slice(0, 200); }
    A.warmNav = await measuredClick(page, cdp, {
      label: 'A2-warm-nav-plugins', role: 'button', name: /^插件$/, spec: WATCH_SPEC, settleMs: 600,
    });
    // A3: click the "插件列表" tab (the 149-entry inventory) on the already-warm section
    A.warmInventoryTab = await measuredClick(page, cdp, {
      label: 'A3-warm-tab-inventory', role: 'tab', name: /^插件列表$/, spec: WATCH_SPEC, settleMs: 600,
    });
    // A4: positive control at the same page state, after the measured windows
    A.controlAfterClick = await controlBlock(page, cdp, 120, 'A4-control-120ms-after-click');
    A.done = true;
  } catch (e) {
    A.error = String(e).slice(0, 1200);
  } finally {
    await browser.close();
  }
  report.scenarios.A = A;
}

// ---------------------------------------------------------------- Scenario B (fresh page: control first, then cold nav)
{
  const { browser } = await launchChrome({ headless: true });
  const B = { condition: condition() };
  try {
    const ctx = await newContext(browser);
    await ctx.addInitScript({ content: INIT_HOOKS });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Performance.enable');
    await appReady(page);
    await openSettings(page);
    B.controlFreshPageSettings = await controlBlock(page, cdp, 120, 'B1-control-120ms-fresh-page-settings');
    B.coldNav = await measuredClick(page, cdp, {
      label: 'B2-cold-nav-plugins', role: 'button', name: /^插件$/, spec: WATCH_SPEC, settleMs: 600,
    });
    B.done = true;
  } catch (e) {
    B.error = String(e).slice(0, 1200);
  } finally {
    await browser.close();
  }
  report.scenarios.B = B;
}

// ---------------------------------------------------------------- Scenario C (idle ambient + cold inventory tab)
{
  const { browser } = await launchChrome({ headless: true });
  const C = { condition: condition() };
  try {
    const ctx = await newContext(browser);
    await ctx.addInitScript({ content: INIT_HOOKS });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Performance.enable');
    await appReady(page);
    await openSettings(page);
    // Reach the plugins section first, then measure pure idle ambient cost
    await page.getByRole('button', { name: /^插件$/ }).first().click({ timeout: 8000 });
    await page.waitForTimeout(2500);

    // C1: idle ambient window, no interaction at all
    const idleBefore = await readMetrics(cdp);
    await page.evaluate(() => window.__PP__.arm('C1-idle-ambient'));
    const ltB = await page.evaluate(() => window.__PP__.longTasks.length);
    const loafB = await page.evaluate(() => window.__PP__.loaf.length);
    const rpcB = await page.evaluate(() => window.__PP__.rpc.length);
    const idleWall = await page.evaluate(() => ({ t: performance.now(), wall: Date.now() }));
    await page.waitForTimeout(2000);
    const idleAfter = await readMetrics(cdp);
    const idleSlice = await slice(page);
    C.idleAmbient = {
      windowMs: 2000,
      wall: idleWall,
      cdpDelta: metricDelta(idleBefore, idleAfter),
      longTasksInWindow: idleSlice.longTasks.slice(ltB),
      loafInWindow: idleSlice.loaf.slice(loafB),
      rpcInWindow: idleSlice.rpc.slice(rpcB),
      frameCount: idleSlice.frames.length,
      frames: idleSlice.frames,
      counts: idleSlice.counts,
    };

    // C2: cold render of the inventory tab (first ever mount of the 149-card list)
    C.coldInventoryTab = await measuredClick(page, cdp, {
      label: 'C2-cold-tab-inventory', role: 'tab', name: /^插件列表$/, spec: WATCH_SPEC, settleMs: 800,
    });
    C.done = true;
  } catch (e) {
    C.error = String(e).slice(0, 1200);
  } finally {
    await browser.close();
  }
  report.scenarios.C = C;
}

report.conditionEnd = condition();
console.log(writeJson(OUT, `click-raw-${TAG}.json`, report));
