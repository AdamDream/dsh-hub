/*
 * model-tab: why is the [模型] tab the slowest?
 *
 * Independent harness (does not touch sibling artifacts). ONE headless browser,
 * pointed at the already-running GUI. Read-only w.r.t. the product: it clicks
 * the settings nav (allowed) and never save/apply/delete.
 *
 * Design: within-tab event-rate CONTRAST.
 *   1. models-natural  : 模型 tab, all WS frames delivered
 *   1'. models-allmute : 模型 tab, session/event + session/projection delivery muted
 *   2. models-docmute  : 模型 tab, only settings/document-updated delivery muted
 *   3. general-natural : 通用设置 tab, all delivered (control tab)
 * Windows: >=3 x 60 s per scenario, every window kept, all derived from deltas.
 */
import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const URL_ = 'http://127.0.0.1:3080';
const ROOT = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/model-tab';
const RAW = path.join(ROOT, 'raw');
fs.mkdirSync(RAW, { recursive: true });

const argv = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const WINDOW_MS = Number(argv.window || 60_000);
const SETTLE_MS = Number(argv.settle || 8_000);
const CYCLES = Number(argv.cycles || 2);
const TAG = String(argv.tag || 'run1');
const HEARTBEAT_MS = Number(argv.heartbeat || 15_000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => process.stderr.write(`[${new Date().toISOString().slice(11, 19)}] ${a.join(' ')}\n`);
const T = (p, ms, label) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT ${label} ${ms}ms`)), ms))]);

const problems = [];
const check = (name, cond, detail) => { if (!cond) { problems.push({ name, detail }); log('FAIL', name, detail || ''); } return !!cond; };

/* -------------------------------------------------- external load sampling */
function cpuTotals() {
  try {
    const l = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
    const idle = (l[3] || 0) + (l[4] || 0);
    const busy = l.reduce((a, b) => a + b, 0) - idle;
    return { busy, idle };
  } catch (e) { return null; }
}
function procSnapshot() {
  const counts = {};
  const browsers = [];
  let pids = [];
  try { pids = fs.readdirSync('/proc').filter((p) => /^\d+$/.test(p)); } catch (e) { }
  for (const p of pids) {
    let cmd = '';
    try { cmd = fs.readFileSync(`/proc/${p}/cmdline`, 'utf8'); } catch (e) { continue; }
    const parts = cmd.split('\0').filter(Boolean);
    if (!parts.length) continue;
    const exe = parts[0].split('/').pop();
    counts[exe] = (counts[exe] || 0) + 1;
    if (exe === 'headless_shell' && parts.includes('--no-startup-window')) {
      let jif = null;
      try { const st = fs.readFileSync(`/proc/${p}/stat`, 'utf8'); const rp = st.lastIndexOf(')'); const f = st.slice(rp + 2).split(' '); jif = Number(f[11]) + Number(f[12]); } catch (e) { }
      browsers.push({ pid: Number(p), jiffies: jif, launcher: (parts[parts.length - 1] || '').slice(0, 60) });
    }
  }
  let la = null;
  try { const l = fs.readFileSync('/proc/loadavg', 'utf8').trim().split(/\s+/); la = { load1: Number(l[0]), load5: Number(l[1]), load15: Number(l[2]), runnable: l[3] }; } catch (e) { }
  return { t: Date.now(), epochMs: Date.now(), counts, browsers, browserJiffies: browsers.reduce((a, b) => a + (b.jiffies || 0), 0), cpu: cpuTotals(), load: la };
}

function p95(sorted, p) { return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : null; }

/* ---------------------------------------------------------------- main */
let browser = null;
const runs = [];
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  const page = await context.newPage();
  page.on('pageerror', (e) => log('PAGEERROR', String(e.message).slice(0, 200)));
  await page.addInitScript({ path: path.join(ROOT, 'lib', 'init.js') });
  await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  log('navigated');

  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');

  const metrics = async () => {
    const r = await T(cdp.send('Performance.getMetrics'), 30_000, 'getMetrics');
    const o = {}; for (const m of r.metrics) o[m.name] = m.value; return o;
  };

  /* wait for app shell */
  await T(page.waitForFunction(() => document.getElementsByTagName('*').length > 200, null, { timeout: 60_000 }), 65_000, 'shell');
  const hookInfo = await page.evaluate(() => ({ installed: !!window.__MT, hook: typeof window.__REACT_DEVTOOLS_GLOBAL_HOOK__, pre: window.__MT ? window.__MT.react.hookPreexisting : null }));
  log('hook', JSON.stringify(hookInfo));
  check('hook-installed-at-document-start', hookInfo.installed === true, JSON.stringify(hookInfo));

  /* open settings */
  const openSettings = async () => {
    const btn = page.locator('button, [role="button"], a').filter({ hasText: /^设置$/ }).first();
    await T(btn.click({ timeout: 20_000 }), 30_000, 'click-settings');
    await T(page.waitForFunction(() => !!document.querySelector('[role="dialog"] nav'), null, { timeout: 30_000 }), 35_000, 'dialog');
  };
  const navTo = async (label) => {
    const b = page.locator('[role="dialog"] nav button').filter({ hasText: label }).first();
    const n = await page.locator('[role="dialog"] nav button').count();
    await T(b.click({ timeout: 20_000 }), 30_000, 'nav ' + label);
    return n;
  };
  const panelSig = () => page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]'); const nav = dlg && dlg.querySelector('nav');
    const c = nav ? nav.nextElementSibling : null;
    const btns = nav ? [...nav.querySelectorAll('button')].map((b) => (b.className || '').toString()) : [];
    const freq = new Map(); for (const s of btns) freq.set(s, (freq.get(s) || 0) + 1);
    let modal = null, best = -1; for (const [s, k] of freq) if (k > best) { best = k; modal = s; }
    const act = btns.findIndex((s) => s !== modal);
    return {
      hasPanel: !!c, nodes: c ? c.getElementsByTagName('*').length : 0,
      activeIndex: act, activeLabel: act >= 0 && nav ? (nav.querySelectorAll('button')[act].textContent || '').trim() : null,
      rows: c ? { li: c.querySelectorAll('li').length, input: c.querySelectorAll('input').length, button: c.querySelectorAll('button').length, svg: c.querySelectorAll('svg').length, h2: c.querySelectorAll('h2').length } : null,
      head: c ? (c.textContent || '').replace(/\s+/g, ' ').slice(0, 160) : null,
    };
  });

  await openSettings();
  log('settings opened');

  /* smoke: does the models tab mount, and does panelSet find the fiber root? */
  const navCount = await navTo('模型');
  await sleep(1500);
  let sigModels = await panelSig();
  log('models sig', JSON.stringify(sigModels));
  const fiberProbe = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]'); const nav = dlg && dlg.querySelector('nav');
    const host = nav ? nav.nextElementSibling : null;
    if (!host) return { ok: false, why: 'no-host' };
    const key = Object.keys(host).find((k) => k.indexOf('__reactFiber$') === 0 || k.indexOf('__reactInternalInstance$') === 0);
    return { ok: !!key, key: key || null, keys: Object.keys(host).filter((k) => k.startsWith('__react')).slice(0, 4) };
  });
  log('fiber probe', JSON.stringify(fiberProbe));
  check('models-tab-mounted', sigModels.hasPanel && sigModels.nodes > 50 && sigModels.activeLabel === '模型', JSON.stringify({ active: sigModels.activeLabel, nodes: sigModels.nodes }));
  check('panel-fiber-root-reachable', fiberProbe.ok === true, JSON.stringify(fiberProbe));
  const panelInfo = await page.evaluate(() => window.__MT.panelFind());
  log('panelFind', JSON.stringify(panelInfo));
  check('panel-container-found', panelInfo.found === true && (panelInfo.nodes || 0) > 100, JSON.stringify(panelInfo));

  /* park freshly on the models tab and let the panel settle to a quiet state */
  await navTo('通用设置'); await sleep(1200); await navTo('模型'); await sleep(SETTLE_MS);
  const afterSettle = await page.evaluate(() => ({ commitsInPanel: window.__MT.react.commitsInPanel, commitsTotal: window.__MT.react.commitsTotal, names: window.__MT.react.namesInPanel, panelSetSize: window.__MT.react.fibersInPanelSet }));
  log('post-settle react', JSON.stringify(afterSettle));

  /* Interleaved so the models and general windows of one cycle sit back to back
   * in wall-clock time: the host load is non-stationary, so adjacency is what
   * makes the tab-to-tab difference interpretable. */
  const scenarioDefs = [
    { id: 'models-natural', tab: '模型', muted: [] },
    { id: 'general-natural', tab: '通用设置', muted: [] },
    { id: 'models-allmute', tab: '模型', muted: ['session/event', 'session/projection'] },
    { id: 'general-allmute', tab: '通用设置', muted: ['session/event', 'session/projection'] },
  ];

  const sequence = [];
  for (let c = 0; c < CYCLES; c++) for (const s of scenarioDefs) sequence.push({ ...s, cycle: c + 1 });

  let currentTab = '模型';
  let idx = 0;
  for (const sc of sequence) {
    idx++;
    if (argv.only && !String(argv.only).split(',').includes(String(idx))) continue;
    if (sc.tab !== currentTab) {
      await navTo(sc.tab);
      await sleep(1200);
      currentTab = sc.tab;
      await page.evaluate(() => window.__MT.panelFind());
    }
    const sigBefore = await panelSig();
    const pre = procSnapshot();
    const m0 = await metrics();
    const t0 = Date.now();
    await page.evaluate((muted) => window.__MT.windowStart(muted), sc.muted);
    log(`win ${idx}/${sequence.length} ${sc.id} start (tab=${sigBefore.activeLabel}, nodes=${sigBefore.nodes}, browsers=${pre.counts.headless_shell})`);
    const loadSeries = [];
    const hb = setInterval(() => {
      try {
        const snap = procSnapshot();
        loadSeries.push({ t: Date.now() - t0, load1: snap.load ? snap.load.load1 : null, browsers: snap.browsers.length, browserJiffies: snap.browserJiffies, busy: snap.cpu ? snap.cpu.busy : null });
      } catch (e) { }
    }, HEARTBEAT_MS);
    await sleep(WINDOW_MS);
    clearInterval(hb);
    const end = await T(page.evaluate(() => window.__MT.windowEnd()), 30_000, 'windowEnd');
    const m1 = await metrics();
    const post = procSnapshot();
    const t1 = Date.now();
    const sigAfter = await panelSig();

    const cpuBusyDelta = (post.cpu && pre.cpu) ? post.cpu.busy - pre.cpu.busy : null;
    const browserJiffiesDelta = (post.browserJiffies || 0) - (pre.browserJiffies || 0);
    const d = (k) => Math.round((m1[k] - m0[k]) * 1000) / 1000;
    const derived = {
      scriptMs: d('ScriptDuration'), taskMs: d('TaskDuration'), recalcMs: d('RecalcStyleDuration'),
      layoutMs: d('LayoutDuration'), scriptPerSec: Math.round(d('ScriptDuration') / ((t1 - t0) / 1000) * 1000) / 1000,
      taskPerSec: Math.round(d('TaskDuration') / ((t1 - t0) / 1000) * 1000) / 1000,
      recalcPerSec: Math.round(d('RecalcStyleDuration') / ((t1 - t0) / 1000) * 1000) / 1000,
      layoutPerSec: Math.round(d('LayoutDuration') / ((t1 - t0) / 1000) * 1000) / 1000,
      nodesDelta: Math.round(m1.Nodes - m0.Nodes),
      jsHeapDeltaMB: Math.round((m1.JSHeapUsedSize - m0.JSHeapUsedSize) / 1048576 * 100) / 100,
    };
    const fps = Math.round(end.frames / (end.durationMs / 1000) * 10) / 10;
    const over50Per100 = end.frameGap.n ? Math.round(end.frameGap.over50 / end.frameGap.n * 100 * 100) / 100 : null;

    const run = {
      id: sc.id, cycle: sc.cycle, tab: sc.tab, muted: sc.muted, seqIndex: idx,
      t0: new Date(t0).toISOString(), t1: new Date(t1).toISOString(), wallMs: t1 - t0,
      cdpRawStart: m0, cdpRawEnd: m1, cdpDelta: derived,
      fps, frames: end.frames, durationMs: Math.round(end.durationMs),
      frameGap: end.frameGap, over50Per100,
      longtasks: end.longtasks,
      ws: end.ws, http: end.http, xhr: end.xhr, timers: end.timers, mutations: end.mutations,
      react: end.react, dom: end.dom,
      domDelta: { panelNodes: end.dom.panelNodes, nodesDelta: derived.nodesDelta },
      panel: { textLen: end.panelTextLen, head: end.panelTextHead, rows: end.panelRows, sigBefore: sigBefore, sigAfter: sigAfter },
      externalLoad: {
        pre, post, loadSeries,
        concurrentBrowserLaunchers: Math.max(0, (pre.counts.headless_shell || 0) - 1),
        concurrentBrowserLaunchersPost: Math.max(0, (post.counts.headless_shell || 0) - 1),
        cpuBusyDelta, browserJiffiesDelta,
        siblingNodeProcs: Math.max(0, (pre.counts.node || 0) - 1),
        siblingNodePids: (pre.browsers || []).map((b) => b.pid),
      },
      errors: end.errors,
    };
    runs.push(run);
    log(`win ${idx} ${sc.id} done fps=${fps} script/s=${derived.scriptPerSec}ms recalc/s=${derived.recalcPerSec}ms frames=${end.frames} over50=${end.frameGap.over50} lt=${end.longtasks.n} wsEvent=${end.ws.byType['session/event'] || 0} commitsPanel=${end.react.commitsInPanel} fibersPanel=${end.react.fibersRenderedInPanelInWindow} http=${end.http.total}`);
    fs.writeFileSync(path.join(RAW, `phase-${TAG}.json`), JSON.stringify({ tag: TAG, windowMs: WINDOW_MS, runs, problems, navCount, fiberProbe, sigModels, afterSettle }, null, 1));
  }

  /* invariant checks */
  check('all-windows-panel-present', runs.every((r) => r.dom.panelPresent === true), runs.filter((r) => !r.dom.panelPresent).map((r) => r.id).join(','));
  check('no-page-errors-in-windows', runs.every((r) => r.errors.length === 0), JSON.stringify(runs.map((r) => ({ id: r.id, e: r.errors.length })).filter((x) => x.e)));

  await context.close();
} catch (e) {
  problems.push({ name: 'harness-threw', detail: String(e && e.stack || e).slice(0, 800) });
  log('THREW', String(e && e.stack || e).slice(0, 800));
} finally {
  try { if (browser) await browser.close(); } catch (e) { log('close-failed', String(e).slice(0, 200)); }
  fs.writeFileSync(path.join(RAW, `phase-${TAG}.json`), JSON.stringify({ tag: TAG, windowMs: WINDOW_MS, runs, problems, complete: runs.length }, null, 1));
  log('written', path.join(RAW, `phase-${TAG}.json`), 'runs=', runs.length);
}
