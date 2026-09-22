#!/usr/bin/env node
/*
 * run-one.mjs — ONE measured run: one engine, one DPR, one cell, one rep.
 * Single browser instance, launched and closed inside this process.
 *
 *   node scripts/run-one.mjs --engine=chromium|firefox --dpr=1|2 --cell=combined \
 *        --rep=1 --ms=10000 [--port=18840] [--out=raw/x.json] [--tag=name]
 *
 * Same page, same instrument, same synthetic pointer path on both engines.
 * Blink  -> Playwright 1.49.1 (chromium-1148 from ~/.cache/ms-playwright) + CDP
 * Gecko  -> snap Firefox 155 headless + WebDriver BiDi (see lib/ff.mjs for why)
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { launchFirefox, connectBidi, ffVersion, FF_BIN } from './lib/ff.mjs';
import { CELLS, cellUrl } from '../../minimal-page/lib/cells.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);                       // .../gecko-vs-blink
const MINIMAL = path.resolve(HERE, '../../minimal-page/minimal.html');
const DSH_URL = 'http://127.0.0.1:3080/';
const PLAYWRIGHT_ROOT = '/home/CNS2026495165/playwright_scratch';

const arg = (name, dflt = null) => {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return dflt;
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : true;
};

const CFG = {
  engine: String(arg('engine', 'chromium')),
  dpr: Number(arg('dpr', 1)),
  cell: String(arg('cell', 'combined')),
  target: String(arg('target', 'minimal')),
  rep: Number(arg('rep', 1)),
  ms: Number(arg('ms', 10000)),
  hertz: Number(arg('hertz', 60)),
  port: Number(arg('port', 18840)),
  tag: String(arg('tag', '')),
  out: arg('out', null),
  viewportW: Number(arg('w', 1280)),
  viewportH: Number(arg('h', 800)),
  reflow: arg('reflow', null) === true || arg('reflow', '0') === '1',
  /* Gecko clamps content-process performance.now() to 1 ms by default
   * (privacy.reduceTimerPrecision), Blink reports a 0.1 ms grid. Any "JS self-time"
   * comparison between the two is therefore quantisation-biased. --fineclock=1
   * turns the Gecko clamp off so both engines expose a fine clock, and the two
   * runs together quantify the bias instead of hiding it. */
  fineclock: arg('fineclock', null) === true || arg('fineclock', '0') === '1',
};

/* identical start expression for both engines */
const startExpr = () => `window.__MC.reset(); window.MMP && window.MMP.reset && window.MMP.reset(); window.__DRV.start({mode:${JSON.stringify((CELLS[CFG.cell] || {}).scenario === 'none' ? 'ripple' : (CELLS[CFG.cell] || {}).scenario || 'both')}, hertz:${CFG.hertz}, ms:${CFG.ms}, reflow:${CFG.reflow ? 'true' : 'false'}})`;

const INSTRUMENT = fs.readFileSync(path.join(HERE, 'lib', 'instrument.js'), 'utf8');
const DRIVER = fs.readFileSync(path.join(HERE, 'lib', 'driver.js'), 'utf8');
/* Gecko (BiDi script.addPreloadScript) takes a function DECLARATION and calls it
 * itself. Blink (Playwright addInitScript content:) evaluates the content as a
 * plain script, so the very same function declaration must also be invoked.
 * Body text is byte-identical in both cases; only the call wrapper differs. */
const asFn = (code) => `() => {\n${code}\n}`;
const asInit = (code) => `(${asFn(code)})();`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ stats */
function stats(arr) {
  if (!arr.length) return { n: 0, p50: null, p95: null, p99: null, max: null, mean: null, over50: 0, over100: 0 };
  const s = [...arr].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))];
  return {
    n: s.length,
    p50: +q(0.5).toFixed(3), p95: +q(0.95).toFixed(3), p99: +q(0.99).toFixed(3),
    max: +s[s.length - 1].toFixed(3),
    mean: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(3),
    over50: s.filter((v) => v > 50).length,
    over100: s.filter((v) => v > 100).length,
  };
}
const intervals = (frames) => { const o = []; for (let i = 1; i < frames.length; i++) o.push(frames[i] - frames[i - 1]); return o; };

function loadavg() { return fs.readFileSync('/proc/loadavg', 'utf8').trim(); }
function procCmdlineFor(needle) {
  const hits = [];
  for (const d of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const cl = fs.readFileSync(`/proc/${d}/cmdline`, 'utf8').split('\0').filter(Boolean);
      if (cl.length && cl.join(' ').includes(needle)) hits.push({ pid: +d, cmdline: cl.join(' ') });
    } catch { }
  }
  return hits;
}

/* -------------------------------------------------------------- the runner */
const RESULT = {
  schema: 'gvb.run/1',
  startedAt: new Date().toISOString(),
  cfg: CFG,
  host: { cpus: os.cpus().length, memGB: +(os.totalmem() / 1e9).toFixed(1), platform: `${os.platform()} ${os.release()}` },
  loadavgBefore: loadavg(),
  engineProbe: {},
  dprSelfProof: {},
  viewport: {},
  scenario: {},
  metrics: {},
  notes: [],
  errors: [],
};

const applyResult = (page) => {
  let mm;
  try { mm = JSON.parse(page.mm); } catch (e) { mm = null; }
  const mc = page.mc || {};
  RESULT.metrics = {
    fromCollector: {
      frames: mc.frames || null,
      longtasks: mc.longtasks || null,
      loafs: mc.loafs || null,
      support: mc.support || null,
      rafJs: mc.rafJs || null,
    },
    fromPage: mm,
    scenarioTicks: page.drv || null,
    domNodes: page.domNodes,
    devicePixelRatio: page.dpr,
    inner: page.inner,
    docElement: page.docElSize,
  };
  RESULT.dprSelfProof = {
    devicePixelRatioReadBack: page.dpr,
    innerWidth: page.inner && page.inner[0],
    innerHeight: page.inner && page.inner[1],
    devicePixels: page.inner ? [page.inner[0] * page.dpr, page.inner[1] * page.dpr] : null,
    canvasBacking: page.canvasBacking || null,
  };
};

const SNAPSHOT_EXPR = `(function(){
  var MC = window.__MC || {}, MMP = window.MMP || {};
  var cv = document.getElementById('cv');
  var out = {
    dpr: window.devicePixelRatio,
    inner: [window.innerWidth, window.innerHeight],
    domNodes: document.getElementsByTagName('*').length,
    docElSize: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
    canvasBacking: cv ? [cv.width, cv.height] : null,
    mc: {
      frames: MC.frames || [],
      longtasks: MC.longtasks || [],
      loafs: (MC.loafs || []).slice(0, 200),
      support: MC.support || {},
      rafJs: (function () {
        var s = (MC.rafSamples || []).slice().sort(function (a, b) { return a - b; });
        var q = function (pp) { return s.length ? s[Math.min(s.length - 1, Math.round((s.length - 1) * pp))] : null; };
        return {
          n: MC.rafN || 0, totalMs: +(MC.rafTotal || 0).toFixed(2), maxMs: +(MC.rafMax || 0).toFixed(2),
          meanMs: MC.rafN ? +((MC.rafTotal || 0) / MC.rafN).toFixed(4) : null,
          p50Ms: q(0.5), p95Ms: q(0.95), p99Ms: q(0.99),
          over8ms: MC.rafOver8 || 0, over16_7ms: MC.rafOver167 || 0, over33_3ms: MC.rafOver33 || 0,
          budgetExceedPct: MC.rafN ? +((100 * (MC.rafOver167 || 0)) / MC.rafN).toFixed(3) : null,
          samples: s.length > 600 ? s.slice(s.length - 600) : s
        };
      })(),
    },
    mm: JSON.stringify({
      page: { frames: (MMP.frames || []).slice(0, 20000), counters: MMP.counters || null, dpr: MMP.dpr },
      nav: (function(){ try { var e = performance.getEntriesByType('navigation')[0]; return e ? {domContentLoaded: +e.domContentLoadedEventEnd.toFixed(1), loadEnd: +e.loadEventEnd.toFixed(1)} : null; } catch(x){ return null; } })(),
    }),
    drv: window.__DRV ? (function () {
      /* stats() carries last = {target: <DOM element>, x, y}; a DOM node is
       * cyclic for JSON, so keep only the scalars. */
      var s = window.__DRV.stats();
      s.last = s.last ? { x: s.last.x, y: s.last.y } : null;
      return s;
    })() : null,
  };
  /* NB: deliberately NO reset here — out.mc.* are live array references, so a
   * reset before JSON.stringify would empty the very data being reported. The
   * measurement window is opened by the explicit pre-scenario reset instead. */
  return JSON.stringify(out);
})()`;

async function runChromium() {
  const require = createRequire(path.join(PLAYWRIGHT_ROOT, 'package.json'));
  const { chromium } = require('playwright');
  const version = require('playwright/package.json').version;
  RESULT.engineProbe = { engine: 'Blink', driver: 'playwright', playwrightVersion: version };

  const profile = `/tmp/gvb-chrome-${CFG.tag || CFG.cell}`;
  fs.rmSync(profile, { recursive: true, force: true });
  fs.mkdirSync(profile, { recursive: true });

  const ctx = await chromium.launchPersistentContext(profile, {
    headless: true,
    viewport: { width: CFG.viewportW, height: CFG.viewportH },
    deviceScaleFactor: CFG.dpr,             // <- the ACTUAL DPR switch used for Blink
    args: ['--no-first-run', '--no-default-browser-check', '--disable-dev-shm-usage'],
  });
  RESULT.engineProbe.launchFlags = {
    note: 'Playwright launchPersistentContext(deviceScaleFactor) -> chromium --force-device-scale-factor=<dpr>',
    observedBrowserCmdline: procCmdlineFor(profile).map((p) => p.cmdline).slice(0, 1),
  };
  const page = ctx.pages()[0] || await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  await ctx.addInitScript({ content: asInit(INSTRUMENT) });
  await ctx.addInitScript({ content: asInit(DRIVER) });

  const url = CFG.target === 'dsh' ? DSH_URL : cellUrl('file://' + MINIMAL, (CELLS[CFG.cell] || {}).params || {});
  RESULT.url = url;
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction('window.MMP ? window.MMP.ready === true : true', null, { timeout: 20000 }).catch(() => { });
  await sleep(1500);

  const injected = await page.evaluate('({ mc: !!window.__MC, drv: !!window.__DRV, mmp: !!window.MMP, support: (window.__MC||{}).support||null })');
  RESULT.engineProbe.injection = injected;
  if (!injected.mc || !injected.drv) throw new Error('instrument/driver injection failed in Blink: ' + JSON.stringify(injected));

  const before = await cdp.send('Performance.getMetrics');
  const t0 = Date.now();
  const drvOut = await page.evaluate(startExpr(),
    { timeoutMs: CFG.ms + 60000 }).catch((e) => ({ error: e.message }));
  const wallMs = Date.now() - t0;
  const after = await cdp.send('Performance.getMetrics');

  const snap = await page.evaluate(SNAPSHOT_EXPR);
  const obj = JSON.parse(snap);
  obj.drv = drvOut;
  obj.wallMs = wallMs;
  RESULT.cdp = {
    metricsWindowMs: wallMs,
    keysPresent: after.metrics.map((m) => m.name),
    fieldsExplicitlyAbsent: ['Paint', 'CompositeLayers', 'Layout', 'RecalcStyle', 'ScriptDuration', 'TaskDuration', 'LayoutDuration', 'RecalcStyleDuration', 'Nodes', 'Documents', 'JSHeapUsedSize']
      .filter((k) => !after.metrics.some((m) => m.name === k)),
    delta: Object.fromEntries(after.metrics.map((m) => {
      const b = before.metrics.find((x) => x.name === m.name);
      return [m.name, b ? +(m.value - b.value).toFixed(4) : null];
    })),
  };
  applyResult(obj);
  RESULT.rafJsTime = (obj.mc && obj.mc.rafJs) || null;
  RESULT.frameStats = {
    collectorFrames: stats(intervals((obj.mc && obj.mc.frames) || [])),
    pageFrames: stats(intervals((JSON.parse(obj.mm || '{}').page || {}).frames || [])),
  };
  RESULT.longTasks = {
    supported: !!(obj.mc && obj.mc.support && obj.mc.support.longtask),
    error: (obj.mc && obj.mc.support && obj.mc.support.longtaskErr) || null,
    count: ((obj.mc && obj.mc.longtasks) || []).length,
    sum: +(((obj.mc && obj.mc.longtasks) || []).reduce((a, e) => a + e.dur, 0)).toFixed(2),
    max: ((obj.mc && obj.mc.longtasks) || []).reduce((a, e) => Math.max(a, e.dur), 0),
    entries: ((obj.mc && obj.mc.longtasks) || []).slice(0, 50),
  };
  RESULT.loaf = {
    supported: !!(obj.mc && obj.mc.support && obj.mc.support.loaf),
    error: (obj.mc && obj.mc.support && obj.mc.support.loafErr) || null,
    count: ((obj.mc && obj.mc.loafs) || []).length,
    entries: ((obj.mc && obj.mc.loafs) || []).slice(0, 50),
  };

  await ctx.close();
  return RESULT;
}

async function runFirefox() {
  const version = await ffVersion();
  RESULT.engineProbe = {
    engine: 'Gecko', driver: 'webdriver-bidi (hand-rolled, node native WebSocket)',
    binary: FF_BIN, version,
    why: 'No firefox-* build in ~/.cache/ms-playwright (only chromium-1148 / chromium_headless_shell-1148); Playwright firefox needs its own juggler build, so the snap payload is driven over BiDi instead. Firefox 155 no longer serves /json/version (CDP removed), so BiDi is the only remote-control channel.',
    dprSwitch: 'profile user.js: user_pref("layout.css.devPixelsPerPx", "<dpr>")',
    clockPrefs: CFG.fineclock ? 'privacy.reduceTimerPrecision=false (fine clock)' : 'engine default (1 ms clamp)',
  };
  const tag = `gvb-${CFG.tag || CFG.cell}-dpr${CFG.dpr}-r${CFG.rep}`;
  const extraPrefs = CFG.fineclock ? ['user_pref("privacy.reduceTimerPrecision", false);'] : [];
  const inst = await launchFirefox({ tag, port: CFG.port, dpr: CFG.dpr, width: CFG.viewportW, height: CFG.viewportH, logDir: path.join(ROOT, 'logs'), extraPrefs });
  RESULT.engineProbe.pid = inst.pid;
  RESULT.engineProbe.wsUrl = inst.wsUrl;
  RESULT.engineProbe.profile = inst.profileDir;
  RESULT.engineProbe.userJs = fs.readFileSync(path.join(inst.profileDir, 'user.js'), 'utf8');
  RESULT.engineProbe.gfxLines = inst.gfxLines();

  const bidi = await connectBidi(inst);
  await bidi.newSession({ alwaysMatch: {} });
  const ctx = await bidi.createContext('tab');
  await bidi.addPreloadScript(asFn(INSTRUMENT), [ctx]);
  await bidi.addPreloadScript(asFn(DRIVER), [ctx]);

  const url = CFG.target === 'dsh' ? DSH_URL : cellUrl('file://' + MINIMAL, (CELLS[CFG.cell] || {}).params || {});
  RESULT.url = url;
  await bidi.navigate(ctx, url);
  try {
    await bidi.setViewport(ctx, { width: CFG.viewportW, height: CFG.viewportH });
  } catch (e) { RESULT.errors.push('setViewport: ' + e.message); }
  // wait ready
  for (let i = 0; i < 40; i++) {
    const ready = await bidi.evaluate(ctx, '!!(window.MMP && window.MMP.ready) && !!window.__DRV').catch(() => false);
    if (ready) break;
    await sleep(250);
  }
  await sleep(1500);

  const injected = JSON.parse(await bidi.evaluate(ctx, 'JSON.stringify({ mc: !!window.__MC, drv: !!window.__DRV, mmp: !!window.MMP, support: (window.__MC||{}).support||null })'));
  RESULT.engineProbe.injection = injected;
  if (!injected.mc || !injected.drv) throw new Error('instrument/driver injection failed in Gecko: ' + JSON.stringify(injected));

  const drvPromise = (async () => {
    const t0 = Date.now();
    const out = await bidi.evaluate(ctx, startExpr(), { timeoutMs: CFG.ms + 90000 })
      .catch((e) => ({ error: e.message }));
    return { out, wallMs: Date.now() - t0 };
  })();
  const drv = await drvPromise;

  const snap = await bidi.evaluate(ctx, SNAPSHOT_EXPR, { timeoutMs: 120000 });
  const obj = JSON.parse(snap);
  obj.drv = drv.out;
  obj.wallMs = drv.wallMs;
  applyResult(obj);
  RESULT.rafJsTime = (obj.mc && obj.mc.rafJs) || null;
  RESULT.frameStats = {
    collectorFrames: stats(intervals((obj.mc && obj.mc.frames) || [])),
    pageFrames: stats(intervals((JSON.parse(obj.mm || '{}').page || {}).frames || [])),
  };
  RESULT.longTasks = {
    supported: !!(obj.mc && obj.mc.support && obj.mc.support.longtask),
    error: (obj.mc && obj.mc.support && obj.mc.support.longtaskErr) || null,
    count: ((obj.mc && obj.mc.longtasks) || []).length,
    sum: +(((obj.mc && obj.mc.longtasks) || []).reduce((a, e) => a + e.dur, 0)).toFixed(2),
    max: ((obj.mc && obj.mc.longtasks) || []).reduce((a, e) => Math.max(a, e.dur), 0),
    entries: ((obj.mc && obj.mc.longtasks) || []).slice(0, 50),
  };
  RESULT.loaf = {
    supported: !!(obj.mc && obj.mc.support && obj.mc.support.loaf),
    error: (obj.mc && obj.mc.support && obj.mc.support.loafErr) || null,
    count: ((obj.mc && obj.mc.loafs) || []).length,
    entries: ((obj.mc && obj.mc.loafs) || []).slice(0, 50),
  };
  RESULT.cdp = { available: false, note: 'CDP does not exist in Firefox 155 (no /json/version, no Performance.getMetrics). Blink-only metric left null rather than fabricated.' };

  await bidi.endSession().catch(() => { });
  bidi.close();
  RESULT.engineProbe.exit = await inst.close();
  return RESULT;
}

let rc = 0;
try {
  const fn = CFG.engine === 'firefox' ? runFirefox : runChromium;
  const r = await fn();
  r.finishedAt = new Date().toISOString();
  r.loadavgAfter = loadavg();
  r.ok = true;
  const outPath = CFG.out ? path.resolve(ROOT, CFG.out) : path.join(ROOT, 'raw', `run-${CFG.engine}-dpr${CFG.dpr}-${CFG.cell}-r${CFG.rep}.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(r, null, 1));
  console.log(`OK ${CFG.engine} dpr=${CFG.dpr} cell=${CFG.cell} rep=${CFG.rep} -> ${outPath}`);
  console.log(`  frameStats.collector=${JSON.stringify(r.frameStats && r.frameStats.collectorFrames)}`);
  console.log(`  frameStats.page     =${JSON.stringify(r.frameStats && r.frameStats.pageFrames)}`);
  console.log(`  rafJs=${JSON.stringify(r.rafJsTime)} domNodes=${r.metrics && r.metrics.domNodes} dprReadBack=${r.dprSelfProof && r.dprSelfProof.devicePixelRatioReadBack}`);
  console.log(`  longtask=${JSON.stringify({ supported: r.longTasks.supported, count: r.longTasks.count, err: r.longTasks.error })}`);
  console.log(`  loaf=${JSON.stringify({ supported: r.loaf.supported, count: r.loaf.count, err: r.loaf.error })}`);
  if (r.cdp && r.cdp.delta) console.log(`  cdpWindowMs=${r.cdp.metricsWindowMs} absentFields=${JSON.stringify(r.cdp.fieldsExplicitlyAbsent)}`);
} catch (e) {
  rc = 1;
  const err = { ok: false, error: e.message, info: e.info || null, cfg: CFG, at: new Date().toISOString(), loadavg: loadavg() };
  const outPath = CFG.out ? path.resolve(ROOT, CFG.out) : path.join(ROOT, 'raw', `FAIL-${CFG.engine}-dpr${CFG.dpr}-${CFG.cell}-r${CFG.rep}.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(err, null, 1));
  console.error('FAIL ' + e.message);
}
process.exit(rc);
