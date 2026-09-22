#!/usr/bin/env node
/*
 * measure.mjs — serial, single-instance frame measurement for the DSH-free
 * minimal repro page, plus an optional read-only DSH comparison target.
 *
 * Discipline implemented here:
 *   - ONE browser at a time, always. Every run launches, measures, and closes.
 *   - Holds .workspace/lag-fix/research-v2/.probe.lock for the whole batch.
 *   - Records an exact /proc/<pid>/exe census before / during / after every run
 *     (never `pgrep -f`, which self-matches).
 *   - Never restarts, kills, or reconfigures anything: it only launches its own
 *     Chromium with its own throwaway profile and closes it. No xdotool, no real
 *     pointer motion — mouse input is CDP-synthesized inside the page only.
 *   - On the DSH target: read-only. One page load, one click on 设置, no
 *     save/apply/delete, no DSH module or internal object is read.
 *
 * Usage:
 *   node measure.mjs --mode=headless --all --reps=3 --tag=m1
 *   node measure.mjs --mode=headed   --cells=idle-floor,dom-transform --reps=1 --tag=smoke
 *   node measure.mjs --mode=headless --all --reps=2 --gpu=off --trace=1 --tag=trace
 *   node measure.mjs --target=dsh --mode=headless --reps=1 --tag=dsh-cmp
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { CELLS, cellUrl } from './lib/cells.mjs';
import { acquireLock, releaseLock, lockStatus, nowIso } from './lib/lock.mjs';
import { browserCensus, loadAvg, cpuCount } from './lib/census.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = path.join(HERE, 'minimal.html');
const COLLECTOR = path.join(HERE, 'lib', 'collector.js');
const DSH_URL = 'http://127.0.0.1:3080/';

/* ------------------------------------------------------------------ args */
const argv = process.argv.slice(2);
const flag = (name, dflt = null) => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return dflt;
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1);
  return true;
};
const CFG = {
  mode: String(flag('mode', 'headless')),
  target: String(flag('target', 'minimal')),
  cells: flag('cells', null) ? String(flag('cells')).split(',').filter(Boolean) : null,
  all: Boolean(flag('all', false)),
  reps: Number(flag('reps', 3)),
  gpu: String(flag('gpu', 'default')),
  trace: Boolean(flag('trace', false)),
  dwell: Number(flag('dwell', 3000)),
  settle: Number(flag('settle', 1200)),
  moveHz: Number(flag('movehz', 100)),
  tag: String(flag('tag', 'run')),
  out: String(flag('out', path.join(HERE, 'raw'))),
  lockWaitMin: Number(flag('lockwait', 30)),
  profile: String(flag('profile', 'fresh')),   // fresh | persistent
  headlessNew: Boolean(flag('headlessnew', false)),
  order: String(flag('order', 'repmajor')),    // repmajor | cellmajor
  reuse: Boolean(flag('reuse', false)),
  nolock: Boolean(flag('nolock', false)),      // lock already held by campaign.mjs
};
if (flag('list', false)) {
  for (const [id, c] of Object.entries(CELLS)) console.log(id.padEnd(22), c.scenario.padEnd(7), c.desc);
  process.exit(0);
}

const cellIds = CFG.all ? Object.keys(CELLS) : (CFG.cells || ['idle-floor', 'dom-transform']);
for (const id of cellIds) if (!CELLS[id]) { console.error(`unknown cell: ${id}`); process.exit(2); }

/* --------------------------------------------------------------- helpers */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LOGF = path.join(HERE, 'logs', `${CFG.tag}.log`);
fs.mkdirSync(path.dirname(LOGF), { recursive: true });
fs.mkdirSync(CFG.out, { recursive: true });
fs.mkdirSync(path.join(HERE, 'screens'), { recursive: true });
function log(...a) {
  const line = `[${nowIso()}] ${a.join(' ')}`;
  console.log(line);
  try { fs.appendFileSync(LOGF, line + '\n'); } catch { }
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function quantile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

/** Frame-interval statistics from rAF timestamps (performance.now() ms). */
function frameStats(ts) {
  const iv = [];
  for (let i = 1; i < ts.length; i++) iv.push(ts[i] - ts[i - 1]);
  const sorted = iv.slice().sort((a, b) => a - b);
  const sum = iv.reduce((a, b) => a + b, 0);
  const VSYNC = 1000 / 60;
  const over = (ms) => iv.filter((v) => v > ms).length;
  const longIdx = [];
  for (let i = 0; i < iv.length; i++) if (iv[i] > 50) longIdx.push({ tRel: Math.round(ts[i + 1] - ts[0]), gap: Math.round(iv[i] * 10) / 10 });
  return {
    frameCount: ts.length,
    intervalCount: iv.length,
    spanMs: ts.length ? Math.round((ts[ts.length - 1] - ts[0]) * 10) / 10 : null,
    fpsMean: sum ? Math.round((iv.length / (sum / 1000)) * 10) / 10 : null,
    p50: quantile(sorted, 0.5), p95: quantile(sorted, 0.95), p99: quantile(sorted, 0.99),
    max: sorted.length ? sorted[sorted.length - 1] : null,
    mean: iv.length ? Math.round((sum / iv.length) * 100) / 100 : null,
    gt16_7: over(16.7), gt20: over(20), gt33: over(33), gt50: over(50), gt100: over(100),
    pctGt50: iv.length ? Math.round((over(50) / iv.length) * 1000) / 10 : null,
    framesMissedVs60: iv.length ? Math.round(iv.reduce((a, v) => a + Math.max(0, Math.round(v / VSYNC) - 1), 0)) : 0,
    longFramesGt50: longIdx.slice(0, 40),
    raw_intervals_ms: iv.map((v) => Math.round(v * 100) / 100),
  };
}

function perfDelta(a, b) {
  const get = (o, n) => (o && o[n] != null ? o[n] : 0);
  const d = {};
  for (const k of ['ScriptDuration', 'RecalcStyleDuration', 'LayoutDuration', 'TaskDuration',
    'LayoutCount', 'RecalcStyleCount', 'Nodes', 'JSEventListeners', 'JSHeapUsedSize']) {
    d[k] = Math.round((get(b, k) - get(a, k)) * 10000) / 10000;
  }
  d.Script_ms = Math.round(d.ScriptDuration * 1000 * 100) / 100;
  d.RecalcStyle_ms = Math.round(d.RecalcStyleDuration * 1000 * 100) / 100;
  d.Layout_ms = Math.round(d.LayoutDuration * 1000 * 100) / 100;
  d.Task_ms = Math.round(d.TaskDuration * 1000 * 100) / 100;
  return d;
}

/* Trace aggregation: sum of complete-event durations per event name.
 * NOTE (review S3): this mapping is an INCLUSIVE grouping, published as
 * `groupsAreInclusiveSums: true` — bracket events (BeginFrame, DrawFrame,
 * Commit) nest the work they enclose, and FunctionCall nests inside
 * EventDispatch/FireAnimationFrame, so the group values must not be added up
 * and interpreted as disjoint CPU shares. The non-overlapping main-thread
 * attribution comes from Performance.getMetrics in the same run.
 * HitTest/UpdateLayerTree are reported under 'other' rather than 'layout'
 * because they are not layout. */
const GROUPS = {
  script: ['FunctionCall', 'EvaluateScript', 'v8.compile', 'v8.compileModule', 'CompileScript', 'RunMicrotasks', 'TimerFire', 'EventDispatch', 'FireAnimationFrame', 'AnimationFrame'],
  style: ['UpdateLayoutTree', 'RecalcStyles', 'ParseAuthorStyleSheet', 'StyleRecalcInvalidationTracking'],
  layout: ['Layout', 'InvalidateLayout'],
  paint: ['Paint', 'PaintSetup', 'RasterTask', 'Rasterize', 'ImageDecodeTask', 'PaintImage', 'DecodeImage'],
  composite: ['CompositeLayers', 'ActivateLayerTree', 'UpdateLayer'],
  other: ['HitTest', 'UpdateLayerTree', 'Commit', 'BeginFrame', 'DrawFrame'],
};
function groupTrace(byName) {
  const out = {}; const ungrouped = [];
  const used = new Set();
  for (const [g, names] of Object.entries(GROUPS)) {
    let ms = 0, n = 0;
    for (const nm of names) { if (byName[nm] != null) { ms += byName[nm].ms; n += byName[nm].n; used.add(nm); } }
    out[g] = { ms: Math.round(ms * 100) / 100, events: n };
  }
  for (const [nm, v] of Object.entries(byName)) if (!used.has(nm)) ungrouped.push({ name: nm, ms: Math.round(v.ms * 100) / 100, events: v.n });
  ungrouped.sort((a, b) => b.ms - a.ms);
  return { groups: out, topEvents: Object.entries(byName).map(([name, v]) => ({ name, ms: Math.round(v.ms * 100) / 100, events: v.n })).sort((a, b) => b.ms - a.ms).slice(0, 30), ungrouped };
}

/* ------------------------------------------------------------ mouse paths */
/* FIXED (review B1): the card waypoint list used to be built only for
 * scenario==='hover', so 'both' fell through to `% Math.max(1, 0)` and chased a
 * single fixed point in the card-free zone — i.e. the `combined` and
 * `extreme-dom` cells never hovered anything and silently measured nothing.
 * Waypoints are now built for every hover-like scenario.
 * FIXED (review S5): opening a tray grows its grid row by --trayh (104 px), so
 * card centres sampled once before the dwell go stale and later legs stop
 * landing on cards. The driver therefore accepts setRects() and the runner
 * re-samples the live grid every ~400 ms while hovering. */
const HOVER_LIKE = new Set(['hover', 'both']);

function makeDriver({ scenario, zone, rects, rng, dwellMs }) {
  const cx = zone.x + zone.w / 2, cy = zone.y + zone.h / 2;
  const ax = zone.w * 0.44, ay = zone.h * 0.42;
  const phase = rng() * Math.PI * 2;
  const hoverLike = HOVER_LIKE.has(scenario);
  const shared = { rects: (rects || []).slice() };
  let order = [], wi = 0, legStart = 0, legFrom = null, legTo = null;

  const reshuffle = () => {
    order = shared.rects.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = order[i]; order[i] = order[j]; order[j] = t; }
    wi = 0;
  };
  if (hoverLike) reshuffle();

  const fallback = () => ({ x: Math.round(cx), y: Math.round(cy) });
  const nextRect = () => {
    if (!shared.rects.length) return fallback();
    if (wi >= order.length) reshuffle();
    const r = shared.rects[order[wi]];
    wi++;
    return r || fallback();
  };

  const hoverLeg = (t) => {
    if (legFrom == null || t - legStart > LEG) {
      legFrom = legTo || (shared.rects.length ? shared.rects[order[0]] : fallback());
      legTo = nextRect();
      legStart = t;
    }
    const u = Math.min(1, (t - legStart) / LEG);
    const e = u * u * (3 - 2 * u);
    return {
      x: Math.max(2, Math.round(legFrom.x + (legTo.x - legFrom.x) * e + (rng() - 0.5) * 6)),
      y: Math.max(2, Math.round(legFrom.y + (legTo.y - legFrom.y) * e + (rng() - 0.5) * 6)),
    };
  };

  const LEG = 90;   // ms per hover leg: fast enough to force enter/leave churn
  const posAt = (t) => {
    if (scenario === 'hover') return hoverLeg(t);
    if (scenario === 'both') {
      if (Math.floor(t / 250) % 2 === 0) return hoverLeg(t);
      /* fall through to the sweep on the odd segment */
    }
    const s = t / 1000;
    return {
      x: Math.round(Math.max(2, Math.min(zone.x + zone.w - 2, cx + ax * Math.sin(1.7 * Math.PI * s + phase)))),
      y: Math.round(Math.max(2, Math.min(zone.y + zone.h - 2, cy + ay * Math.sin(2.3 * Math.PI * s + phase * 1.7)))),
    };
  };
  posAt.setRects = (r) => { if (Array.isArray(r) && r.length) { shared.rects = r.slice(); reshuffle(); } };
  return posAt;
}

/** Live card-centre re-sampling: only cards that can actually receive hover. */
async function sampleCardRects(page) {
  return await page.evaluate(() => {
    const vw = innerWidth, vh = innerHeight;
    return Array.from(document.querySelectorAll('.card')).map((c) => {
      const r = c.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    }).filter((p) => p.x > 2 && p.y > 2 && p.x < vw - 2 && p.y < vh - 2);
  });
}

async function driveMouse(page, driver, dwellMs, hz, opts = {}) {
  const step = 1000 / hz;
  const t0 = Date.now();
  const refreshEvery = opts.refreshRects ? 400 : 0;
  let k = 0, sent = 0, refreshes = 0, lastRefresh = 0;
  for (;;) {
    const target = k * step;
    if (target >= dwellMs) break;
    const wait = t0 + target - Date.now();
    if (wait > 0) await sleep(wait);
    if (refreshEvery && Date.now() - lastRefresh > refreshEvery) {
      lastRefresh = Date.now();
      try { driver.setRects(await opts.refreshRects()); refreshes++; } catch { }
    }
    const p = driver(target);
    await page.mouse.move(p.x, p.y);
    sent++; k++;
  }
  return { movesSent: sent, wallMs: Date.now() - t0, nominalHz: hz, effectiveHz: Math.round((sent / ((Date.now() - t0) / 1000)) * 10) / 10, rectRefreshes: refreshes };
}

/* ------------------------------------------------------------------ runner */
const launchArgs = () => {
  const base = [
    '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars', '--mute-audio',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-features=CalculateNativeWinOcclusion',
    '--js-flags=--expose-gc',
  ];
  if (CFG.gpu === 'off') base.push('--disable-gpu');
  if (CFG.gpu === 'swiftshader') base.push('--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu-sandbox');
  if (CFG.gpu === 'gpuraster') base.push('--enable-gpu-rasterization', '--ignore-gpu-blocklist');
  if (CFG.headlessNew) base.push('--headless=new');
  return base;
};

async function launch() {
  const args = launchArgs();
  if (CFG.mode === 'headed') args.push('--window-size=1600,960', '--window-position=60,60');
  const env = { ...process.env };
  if (CFG.mode === 'headed') env.DISPLAY = env.DISPLAY || ':1';
  const t0 = Date.now();
  const browser = await chromium.launch({
    headless: CFG.mode !== 'headed',
    args,
    env,
    slowMo: 0,
  });
  /* Playwright 1.49 has BrowserServer.process() but NOT Browser.process()
   * (verified in playwright-core types.d.ts: process() is declared only on
   * ElectronApplication and BrowserServer). Identify our own browser
   * structurally instead: the census marks every browser process that descends
   * from this node process as "mine", which is the same test used to prove that
   * foreign instances are foreign. */
  let pid = null;
  for (let i = 0; i < 30 && pid == null; i++) {
    const c = browserCensus();
    const m = c.mineInstances && c.mineInstances.find((x) => x.headless === (CFG.mode !== 'headed'));
    pid = (m || (c.mineInstances && c.mineInstances[0]) || {}).pid ?? null;
    if (pid == null) await new Promise((r) => setTimeout(r, 100));
  }
  return { browser, args, launchMs: Date.now() - t0, env: { DISPLAY: env.DISPLAY || null }, pid };
}

async function runCell(cellId, rep, lockInfo, handle) {
  const cell = CELLS[cellId];
  const ownsBrowser = !handle;
  if (!handle) handle = await launch();
  const out = {
    tag: CFG.tag, cellId, rep, mode: CFG.mode, gpu: CFG.gpu, trace: CFG.trace,
    target: CFG.target, startedAt: nowIso(), scenario: cell.scenario, desc: cell.desc,
    params: cell.params, browserReused: !ownsBrowser,
    lockAtStart: lockStatus(), loadBefore: loadAvg(), cpuCount: cpuCount(),
  };
  const censusBefore = browserCensus();
  out.censusBefore = { foreignInstanceTotal: censusBefore.foreignInstanceTotal, foreignProcTotal: censusBefore.foreignProcTotal, instanceTotal: censusBefore.instanceTotal, foreignInstances: censusBefore.foreignInstances };

  const { browser, args, launchMs, env, pid: myPid } = handle;
  let context = null, session = null, bSession = null;
  try {
    out.launchMs = launchMs; out.browserPid = myPid; out.launchArgs = args; out.launchEnv = env;
    context = await browser.newContext({
      viewport: { width: 1600, height: 900 },
      deviceScaleFactor: 1,
      reducedMotion: 'no-preference',
    });
    await context.addInitScript({ path: COLLECTOR });
    const page = await context.newPage();
    session = await context.newCDPSession(page);
    await session.send('Performance.enable');
    bSession = await browser.newBrowserCDPSession();
    try {
      const gi = await bSession.send('SystemInfo.getInfo');
      out.gpuInfo = {
        devices: (gi.gpu && gi.gpu.devices) || [],
        auxAttributes: (gi.gpu && gi.gpu.auxAttributes) || null,
        featureStatus: (gi.gpu && gi.gpu.featureStatus) || null,
        modelName: gi.modelName, commandLine: gi.commandLine ? String(gi.commandLine).slice(0, 600) : null,
      };
    } catch (e) { out.gpuInfoError = String(e).slice(0, 200); }

    // ---- concurrency monitor during the dwell (own timer, /proc reads only)
    let censusMax = 0; const censusSamples = [];
    const mon = setInterval(() => {
      const c = browserCensus();
      censusSamples.push({ t: Date.now(), foreign: c.foreignInstanceTotal, foreignProcs: c.foreignProcTotal });
      if (c.foreignInstanceTotal > censusMax) censusMax = c.foreignInstanceTotal;
    }, 750);

    let url;
    if (CFG.target === 'dsh') url = DSH_URL;
    else url = 'file://' + cellUrl(PAGE, cell.params);

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => window.__MC && window.__MC.frames.length > 3, null, { timeout: 30000 });
    if (CFG.target === 'minimal') await page.waitForFunction(() => window.MMP && window.MMP.ready, null, { timeout: 20000 });

    let zone, rects = [];
    if (CFG.target === 'dsh') {
      const vp = page.viewportSize() || { width: 1600, height: 900 };
      zone = { x: 40, y: 40, w: vp.width - 80, h: vp.height - 80 };
      out.dshPhase = {};
      try {
      await sleep(CFG.settle);
      const envInfo0 = await page.evaluate(() => ({ vis: document.visibilityState, focus: document.hasFocus() }));
      // --- phase A: idle (no interaction) --------------------------------
      let t0 = await page.evaluate(() => window.__MC.reset());
      await sleep(1000);
      const idle = await page.evaluate(() => ({ frames: window.__MC.frames.slice(), lt: window.__MC.longtasks.slice(0, 50) }));
      out.dshPhase.idle = { stats: frameStats(idle.frames), longtasks: idle.lt };
      // --- phase B: click 设置 -------------------------------------------
      const clickT0 = await page.evaluate(() => window.__MC.reset());
      const cands = [
        ['button:has-text("设置")', () => page.locator('button', { hasText: /^设置$/ }).first()],
        ['role=button[name=设置]', () => page.getByRole('button', { name: '设置', exact: true }).first()],
        ['aria-label=设置', () => page.locator('[aria-label="设置"]').first()],
        ['text=设置', () => page.locator('text=设置').first()],
      ];
      let used = null, clickErr = null;
      for (const [label, make] of cands) {
        try { const loc = make(); await loc.waitFor({ state: 'visible', timeout: 6000 }); await loc.click({ timeout: 4000 }); used = label; break; }
        catch (e) { clickErr = `${label}: ${String(e.message).slice(0, 120)}`; }
      }
      out.dshPhase.clickSelector = used;
      out.dshPhase.clickError = used ? null : clickErr;
      await sleep(1500);
      const opened = await page.evaluate(() => ({
        frames: window.__MC.frames.slice(), lt: window.__MC.longtasks.slice(0, 50),
        settingTabs: Array.from(document.querySelectorAll('button,div[role=tab],[role=tab]')).map((e) => (e.textContent || '').trim()).filter((t) => t && t.length < 12).slice(0, 25),
      }));
      out.dshPhase.open = { stats: frameStats(opened.frames), longtasks: opened.lt, visibleTabs: opened.settingTabs };
      // --- phase C: 3 s mouse sweep over the settings page ----------------
      const mBefore = await session.send('Performance.getMetrics');
      const resetT = await page.evaluate(() => window.__MC.reset());
      const driver = makeDriver({ scenario: 'ripple', zone, rects: [], rng: mulberry32(1234), dwellMs: CFG.dwell });
      const drive = await driveMouse(page, driver, CFG.dwell, CFG.moveHz);
      const after = await page.evaluate(() => ({
        t: performance.now(), frames: window.__MC.frames.slice(),
        longtasks: window.__MC.longtasks.slice(0, 100), loafs: window.__MC.loafs.slice(0, 40),
        vis: document.visibilityState, focus: document.hasFocus(),
      }));
      const mAfter = await session.send('Performance.getMetrics');
      const toObj = (m) => Object.fromEntries(m.metrics.map((x) => [x.name, x.value]));
      out.dshPhase.move = {
        drive, resetT, endT: after.t,
        stats: frameStats(after.frames),
        longtasks: after.longtasks,
        loafs: after.loafs,
        perfDelta: perfDelta(toObj(mBefore), toObj(mAfter)),
        visibility: after.vis, hasFocus: after.focus, envBefore: envInfo0,
      };
      out.primary = out.dshPhase.move.stats;
      } catch (e) {
        /* FIXED (review B6): an exception anywhere in the DSH branch used to
         * escape through the outer finally, which then dereferenced
         * out.dshPhase.idle/open while building the summary -> no summary file
         * was written AND the probe lock was never released. Now the branch is
         * self-contained and the failure is recorded as data. */
        out.dshPhase.error = String(e && e.message || e).slice(0, 300);
        out.error = out.error || ('dsh-branch: ' + out.dshPhase.error);
      }
    } else {
      const zones = await page.evaluate(() => window.MMP.zones);
      zone = cell.scenario === 'hover' ? zones.hover : (cell.scenario === 'none' ? zones.viewport : zones.ripple);
      if (zone.h < 20) zone = zones.ripple;
      if (cell.scenario === 'hover' || cell.scenario === 'both') {
        rects = await sampleCardRects(page);
      }
      out.zone = zone; out.cardRects = rects.length;
      await sleep(CFG.settle);

      const envInfo = await page.evaluate(() => ({
        vis: document.visibilityState, focus: document.hasFocus(), dpr: devicePixelRatio,
        w: innerWidth, h: innerHeight, ua: navigator.userAgent, hw: navigator.hardwareConcurrency,
        cfg: window.MMP.config, zones: window.MMP.zones, zeroExternalDeps: window.MMP.zeroExternalDeps,
        externalRefs: document.querySelectorAll('script[src],link[href],img[src],iframe').length,
      }));
      out.env = envInfo;

      // ---- dwell 1: primary frame metrics (no tracing) -------------------
      const mBefore = await session.send('Performance.getMetrics');
      const resetT = await page.evaluate(() => window.__MC.reset());
      const counterBefore = await page.evaluate(() => ({ ...window.MMP.counters }));
      let drive = { movesSent: 0, wallMs: 0, nominalHz: CFG.moveHz };
      const refreshRects = (cell.scenario === 'hover' || cell.scenario === 'both')
        ? (() => sampleCardRects(page)) : null;
      if (cell.scenario !== 'none') {
        const driver = makeDriver({ scenario: cell.scenario, zone, rects, rng: mulberry32(0x51ED + rep * 977), dwellMs: CFG.dwell });
        drive = await driveMouse(page, driver, CFG.dwell, CFG.moveHz, { refreshRects });
      } else {
        await sleep(CFG.dwell);
      }
      /* FIXED (review B5): the arrays were sliced before their length was
       * reported, so the published "frame >50 ms" (LoAF) count could never
       * exceed 60 and the LongTask count never exceed 200, silently. Totals and
       * duration sums now come from the page unsliced; the sliced entries are
       * kept only as illustrative detail. */
      const after = await page.evaluate(() => ({
        t: performance.now(), frames: window.__MC.frames.slice(),
        longtasks: window.__MC.longtasks.slice(0, 200), loafs: window.__MC.loafs.slice(0, 60),
        longtaskTotal: window.__MC.longtasks.length,
        longtaskDurSum: window.__MC.longtasks.reduce((a, e) => a + e.dur, 0),
        loafTotal: window.__MC.loafs.length,
        loafDurSum: window.__MC.loafs.reduce((a, e) => a + e.dur, 0),
        loafBlockingSum: window.__MC.loafs.reduce((a, e) => a + (e.blocking || 0), 0),
        longtaskUnsupported: window.__MC.longtaskUnsupported || null,
        loafUnsupported: window.__MC.loafUnsupported || null,
        vis: document.visibilityState, focus: document.hasFocus(),
        screenInfo: { w: screen.width, h: screen.height, aw: screen.availWidth, ah: screen.availHeight, dpr: devicePixelRatio },
        counters: { ...window.MMP.counters }, mmpFrames: window.MMP.frames.length,
      }));
      const counterAfter = after.counters;
      const mAfter = await session.send('Performance.getMetrics');
      const toObj = (m) => Object.fromEntries(m.metrics.map((x) => [x.name, x.value]));
      out.primary = {
        drive, resetT, endT: after.t, windowMs: Math.round(after.t - resetT),
        stats: frameStats(after.frames),
        longtasks: after.longtasks,
        loafs: after.loafs,
        perfDelta: perfDelta(toObj(mBefore), toObj(mAfter)),
        visibility: after.vis, hasFocus: after.focus,
        screenInfo: after.screenInfo,
        longtaskTotal: after.longtaskTotal, longtaskDurSum: Math.round(after.longtaskDurSum * 100) / 100,
        loafTotal: after.loafTotal, loafDurSum: Math.round(after.loafDurSum * 100) / 100,
        loafBlockingSum: Math.round(after.loafBlockingSum * 100) / 100,
        observerUnsupported: { longtask: after.longtaskUnsupported, loaf: after.loafUnsupported },
        loavesGt50: (after.loafs || []).filter((l) => l.dur > 50).length,
        counters: {
          moves: counterAfter.moves - counterBefore.moves,
          ripplesSpawned: counterAfter.ripplesSpawned - counterBefore.ripplesSpawned,
          trayOpens: counterAfter.trayOpens - counterBefore.trayOpens,
          trayCloses: counterAfter.trayCloses - counterBefore.trayCloses,
          ripplesAliveEnd: counterAfter.ripplesAlive,
        },
      };
      try {
        const sp = path.join(HERE, 'screens', `${CFG.tag}-${cellId}-${CFG.mode}-${CFG.gpu}-r${rep}.png`);
        await page.screenshot({ path: sp });
        out.screenshot = sp;
      } catch (e) { out.screenshotError = String(e).slice(0, 160); }

      // ---- dwell 2 (optional): CDP trace for Script/Recalc/Layout/Paint/Composite
      if (CFG.trace) {
        try {
          const byName = Object.create(null);
          let maxBuf = 0;
          const onData = ({ value }) => { for (const ev of value) { if (ev.ph === 'X' && typeof ev.dur === 'number') { const e = byName[ev.name] || (byName[ev.name] = { ms: 0, n: 0 }); e.ms += ev.dur / 1000; e.n++; } } };
          const onBuf = ({ value }) => { if (value > maxBuf) maxBuf = value; };
          const detach = (ev, fn) => { try { if (typeof session.off === 'function') session.off(ev, fn); else session.removeListener(ev, fn); } catch { } };
          session.on('Tracing.dataCollected', onData);
          session.on('Tracing.bufferUsage', onBuf);
          const done = new Promise((res) => session.once('Tracing.tracingComplete', res));
          await session.send('Tracing.start', {
            categories: 'devtools.timeline,blink.user_timing,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.frame,disabled-by-default-devtools.timeline.invalidationTracking,latencyInfo',
            transferMode: 'ReportEvents',
            /* FIXED (review B3): without this the agent never emits any
             * Tracing.bufferUsage event, so maxBuf stayed 0 and "0 % buffer
             * usage" was published as if it were evidence that no trace events
             * were dropped. Now the number is either a real measurement or is
             * reported as unknown. */
            bufferUsageReportingInterval: 1000,
          });
          const t2reset = await page.evaluate(() => window.__MC.reset());
          const mb2 = await session.send('Performance.getMetrics');
          let drive2 = { movesSent: 0, wallMs: 0 };
          if (cell.scenario !== 'none') {
            const driver = makeDriver({ scenario: cell.scenario, zone, rects, rng: mulberry32(0xBEEF + rep * 31), dwellMs: CFG.dwell });
            drive2 = await driveMouse(page, driver, CFG.dwell, CFG.moveHz, { refreshRects });
          } else await sleep(CFG.dwell);
          const afterFrames = await page.evaluate(() => ({ t: performance.now(), frames: window.__MC.frames.slice(), lt: window.__MC.longtasks.slice(0, 100) }));
          await session.send('Tracing.end');
          await done;
          detach('Tracing.dataCollected', onData);
          detach('Tracing.bufferUsage', onBuf);
          const ma2 = await session.send('Performance.getMetrics');
          out.trace = {
            bufferUsageMaxPercent: maxBuf > 0 ? Math.round(maxBuf * 1000) / 10 : null,
            bufferUsageReported: maxBuf > 0,
            /* The accumulated trace spans [Tracing.start, Tracing.end]; the
             * 3 s dwell dominates it, but head/tail overhead and events from
             * other threads/processes ARE included, so these sums must be read
             * as inclusive same-window activity, not as a main-thread profile.
             * Per review S3 the group memberships are deliberately kept as an
             * inclusive sum (bracket events like BeginFrame/DrawFrame nest the
             * rest); the authoritative non-overlapping main-thread attribution
             * is the Performance.getMetrics delta in the same run. */
            groupsAreInclusiveSums: true,
            window: { resetT: t2reset, endT: afterFrames.t, windowMs: Math.round(afterFrames.t - t2reset) },
            drive: drive2,
            stats: frameStats(afterFrames.frames),
            longtasks: afterFrames.lt,
            perfDelta: perfDelta(toObj(mb2), toObj(ma2)),
            ...groupTrace(byName),
          };
        } catch (e) {
          /* The trace pass is secondary evidence: never let it destroy the
           * primary (untraced) frame measurement that already succeeded. */
          out.traceError = String(e && e.message || e).slice(0, 300);
          try { await session.send('Tracing.end'); } catch { }
        }
      }
    }

    clearInterval(mon);
    out.censusDuringMax = censusMax;
    out.censusSamples = censusSamples;
    await context.close(); context = null;
    if (ownsBrowser) {
      await browser.close();
      const t1 = Date.now();
      let closed = false;
      while (Date.now() - t1 < 4000) {
        const c = browserCensus();
        if (c.mineProcTotal === 0) { closed = true; break; }
        await sleep(200);
      }
      out.browserClosed = closed;
    } else {
      out.browserClosed = false;   // deliberately reused for the next rep
    }
  } catch (e) {
    out.error = String(e && e.stack || e).slice(0, 2000);
    try { if (context) await context.close(); } catch { }
    if (ownsBrowser) { try { await browser.close(); } catch { } out.browserClosed = true; }
  }
  const cAfter = browserCensus();
  out.censusAfter = { foreignInstanceTotal: cAfter.foreignInstanceTotal, foreignProcTotal: cAfter.foreignProcTotal, instanceTotal: cAfter.instanceTotal };
  out.loadAfter = loadAvg();
  out.endedAt = nowIso();
  const file = path.join(CFG.out, `${CFG.tag}-${CFG.mode}-${CFG.gpu}-${cellId}-r${rep}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 1));
  out.file = file;
  const p = out.primary || {};
  log(`RUN ${cellId} r${rep} ${CFG.mode}/${CFG.gpu}${CFG.trace ? '/trace' : ''} ` +
    `fps=${p.fpsMean ?? 'n/a'} p50=${p.p50 ?? 'n/a'} p95=${p.p95 ?? 'n/a'} p99=${p.p99 ?? 'n/a'} max=${p.max ?? 'n/a'} ` +
    `>50ms=${p.gt50 ?? 'n/a'} longTask=${(p.longtasks || []).length} ` +
    `Script=${p.perfDelta ? p.perfDelta.Script_ms : '?'}ms Recalc=${p.perfDelta ? p.perfDelta.RecalcStyle_ms : '?'}ms Layout=${p.perfDelta ? p.perfDelta.Layout_ms : '?'}ms ` +
    `foreignMax=${out.censusDuringMax} err=${out.error ? 'YES' : 'no'}`);
  return out;
}

/* -------------------------------------------------------------------- main */
(async () => {
  log(`=== ${CFG.tag} start target=${CFG.target} mode=${CFG.mode} gpu=${CFG.gpu} trace=${CFG.trace} reps=${CFG.reps} cells=${cellIds.length} ===`);
  log(`node pid=${process.pid} cwd=${process.cwd()} display=${process.env.DISPLAY || '(unset)'}`);
  const lock = CFG.nolock
    ? (log('--nolock: relying on the lock held by the parent campaign process'),
      { ok: true, token: null, external: true, waitedMs: 0, attempts: 0, preemptions: [], waits: [], acquiredAt: nowIso(), statusAtStart: lockStatus() })
    : await acquireLock({
      agent: 'incident2-minimal-page', line: `label=${CFG.tag}`,
      purpose: 'serial single-instance frame measurement (minimal repro page ' + CFG.target + ')',
      log, maxWaitMs: CFG.lockWaitMin * 60 * 1000,
      note: 'one browser at a time; never kills anything; releases with rm owner.txt && rmdir',
    });
  if (!lock.ok) { log(`lock not acquired: ${lock.reason}`); process.exit(3); }

  const results = [];
  const reuse = Boolean(CFG.reuse);
  try {
    if (CFG.order === 'cellmajor') {
      // Cell-major + browser reuse: fewer browser launches (fewer visible windows in
      // headed mode) at the cost of cell-major instead of rep-major ordering.
      for (const cellId of cellIds) {
        let handle = reuse ? await launch() : null;
        for (let rep = 1; rep <= CFG.reps; rep++) {
          const r = await runCell(cellId, rep, lock, handle);
          results.push(r);
          if (r.error && handle) { try { await handle.browser.close(); } catch { } handle = null; }
          else if (reuse && !handle) handle = await launch();
        }
        if (handle) { try { await handle.browser.close(); } catch { } }
      }
    } else {
      for (let rep = 1; rep <= CFG.reps; rep++) {
        for (const cellId of cellIds) {
          results.push(await runCell(cellId, rep, lock, null));
        }
      }
    }
  } finally {
    /* FIXED (review B6): the summary is now built defensively and the lock is
     * released in its own finally, so neither a partial run nor a throwing
     * summary builder can leave the probe lock held for the other lines. */
    const slimStats = (s) => { const { raw_intervals_ms, longFramesGt50, ...rest } = s || {}; return rest; };
    const lastOf = (arr) => (Array.isArray(arr) ? arr.reduce((a, b) => (b && b.dur > ((a && a.dur) || 0) ? b : a), null) : null);
    try {
      const summary = {
        tag: CFG.tag, config: CFG, startedCells: cellIds, reps: CFG.reps,
        lock, finishedAt: nowIso(),
        results: results.map((r) => {
          try {
            return {
              cellId: r.cellId, rep: r.rep, mode: r.mode, gpu: r.gpu, trace: !!r.trace,
              scenario: r.scenario, desc: r.desc,
              primary: r.primary ? {
                stats: slimStats(r.primary.stats),
                perfDelta: r.primary.perfDelta, counters: r.primary.counters, drive: r.primary.drive,
                longtaskCount: r.primary.longtaskTotal != null ? r.primary.longtaskTotal : (r.primary.longtasks || []).length,
                loafCount: r.primary.loafTotal != null ? r.primary.loafTotal : (r.primary.loafs || []).length,
                longtaskDurSum: r.primary.longtaskDurSum, loafDurSum: r.primary.loafDurSum,
                loafBlockingSum: r.primary.loafBlockingSum, loavesGt50: r.primary.loavesGt50,
                observerUnsupported: r.primary.observerUnsupported,
                visibility: r.primary.visibility, hasFocus: r.primary.hasFocus,
                screenInfo: r.primary.screenInfo,
                longestLongtask: lastOf(r.primary.longtasks), worstLoaf: lastOf(r.primary.loafs),
              } : null,
              dshPhase: r.dshPhase ? {
                clickSelector: r.dshPhase.clickSelector, clickError: r.dshPhase.clickError,
                error: r.dshPhase.error || null,
                idle: r.dshPhase.idle ? { stats: slimStats(r.dshPhase.idle.stats), lt: (r.dshPhase.idle.longtasks || []).length } : null,
                open: r.dshPhase.open ? { stats: slimStats(r.dshPhase.open.stats), lt: (r.dshPhase.open.longtasks || []).length, visibleTabs: r.dshPhase.open.visibleTabs } : null,
                move: r.dshPhase.move ? {
                  stats: slimStats(r.dshPhase.move.stats),
                  perfDelta: r.dshPhase.move.perfDelta,
                  longtaskCount: (r.dshPhase.move.longtasks || []).length,
                  loafCount: (r.dshPhase.move.loafs || []).length,
                  visibility: r.dshPhase.move.visibility, hasFocus: r.dshPhase.move.hasFocus,
                  longestLongtask: lastOf(r.dshPhase.move.longtasks), worstLoaf: lastOf(r.dshPhase.move.loafs),
                } : null,
              } : null,
              trace: r.trace ? {
                bufferUsageMaxPercent: r.trace.bufferUsageMaxPercent,
                bufferUsageReported: r.trace.bufferUsageReported,
                groupsAreInclusiveSums: r.trace.groupsAreInclusiveSums,
                window: r.trace.window, drive: r.trace.drive,
                groups: r.trace.groups, topEvents: (r.trace.topEvents || []).slice(0, 20),
                stats: slimStats(r.trace.stats),
              } : null,
              traceError: r.traceError || null,
              censusBefore: r.censusBefore, censusDuringMax: r.censusDuringMax, censusAfter: r.censusAfter,
              loadBefore: r.loadBefore, loadAfter: r.loadAfter,
              browserClosed: r.browserClosed, error: r.error || null,
              screenshot: r.screenshot || null, file: r.file,
            };
          } catch (e) {
            return { cellId: r.cellId, rep: r.rep, error: 'summary-build: ' + String(e && e.message || e).slice(0, 200), file: r.file };
          }
        }),
      };
      fs.writeFileSync(path.join(CFG.out, `${CFG.tag}-summary.json`), JSON.stringify(summary, null, 1));
      log(`=== ${CFG.tag} done: ${results.length} runs, ${results.filter((r) => r.error).length} errored -> ${path.join(CFG.out, CFG.tag + '-summary.json')} ===`);
    } catch (e) {
      log(`SUMMARY BUILD FAILED: ${String(e && e.stack || e).slice(0, 400)}`);
    } finally {
      if (!CFG.nolock) releaseLock(lock.token, log);
      else log('--nolock: leaving the lock held by the parent campaign process');
    }
  }
  process.exit(0);
})();
