#!/usr/bin/env node
/*
 * loadcurve.mjs — per-frame load curve, the headless-compatible discriminator.
 *
 * Why this exists: in headless both engines are vsync-locked at ~60 Hz with
 * p50 ≈ 16.7 ms, so a frame-interval comparison at zero added load is
 * floor-limited and can only ever show "both smooth". The question "does Gecko
 * deliver frames worse than Blink on the same content" only becomes observable
 * when the main thread is pushed toward the frame budget. So: the SAME page with
 * the SAME animation runs while the SAME rAF-locked busy-work of L ms per frame
 * is injected, for L = 0,4,8,12,16,20,28 — identical code both engines.
 *
 *   node scripts/loadcurve.mjs --engine=chromium|firefox [--cell=combined]
 *        [--levels=0,4,8,12,16,20,28] [--ms=3000] [--passes=1] [--port=18880]
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { launchFirefox, connectBidi, ffVersion } from './lib/ff.mjs';
import { CELLS, cellUrl } from '../../minimal-page/lib/cells.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const MINIMAL = path.resolve(HERE, '../../minimal-page/minimal.html');
const PLAYWRIGHT_ROOT = '/home/CNS2026495165/playwright_scratch';
const INSTRUMENT = fs.readFileSync(path.join(HERE, 'lib', 'instrument.js'), 'utf8');
const DRIVER = fs.readFileSync(path.join(HERE, 'lib', 'driver.js'), 'utf8');
const asFn = (c) => `() => {\n${c}\n}`;
const asInit = (c) => `(${asFn(c)})();`;

const arg = (n, d = null) => { const h = process.argv.find((a) => a === `--${n}` || a.startsWith(`--${n}=`)); return !h ? d : (h.includes('=') ? h.slice(h.indexOf('=') + 1) : true); };
const ENGINE = String(arg('engine', 'chromium'));
const CELL = String(arg('cell', 'combined'));
const LEVELS = String(arg('levels', '0,4,8,12,16,20,28')).split(',').map(Number);
const MS = Number(arg('ms', 3000));
const PASSES = Number(arg('passes', 1));
const PORT = Number(arg('port', 18880));
const DPR = Number(arg('dpr', 1));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stats = (arr) => {
  if (!arr.length) return { n: 0, p50: null, p95: null, p99: null, max: null, over50: 0 };
  const s = [...arr].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))];
  return { n: s.length, p50: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), p99: +q(0.99).toFixed(2), max: +s[s.length - 1].toFixed(2), over50: s.filter((v) => v > 50).length };
};
const ivs = (f) => { const o = []; for (let i = 1; i < f.length; i++) o.push(f[i] - f[i - 1]); return o; };

const LOAD_EXPR = (level, ms) => `(function(){
  window.__MC.reset();
  if (window.MMP && window.MMP.reset) window.MMP.reset();
  var stop = false, frames = 0;
  function burn(){
    if (stop) return;
    var t0 = performance.now(), x = 0;
    while (performance.now() - t0 < ${level}) { x += Math.sqrt(x + 1); }   /* rAF-locked main-thread load */
    frames++;
    requestAnimationFrame(burn);
  }
  var drvP = window.__DRV.start({mode:${JSON.stringify((CELLS[CELL] || {}).scenario === 'none' ? 'ripple' : (CELLS[CELL] || {}).scenario || 'both')}, hertz:60, ms:${ms}});
  requestAnimationFrame(burn);
  return drvP.then(function(drv){
    stop = true;
    var f = (window.__MC.frames||[]), mm = window.MMP||{};
    var v = { n: window.__MC.rafN||0, totalMs: +(window.__MC.rafTotal||0).toFixed(2), maxMs: +(window.__MC.rafMax||0).toFixed(4), meanMs: window.__MC.rafN ? +((window.__MC.rafTotal||0)/window.__MC.rafN).toFixed(4) : null };
    return JSON.stringify({
      level: ${level}, burnFrames: frames,
      frames: f.length,
      pageFrames: (mm.frames||[]).length,
      rafJs: v, drv: drv, tick: drv ? { meanMs: drv.tickMeanMs, p95Ms: drv.tickP95Ms, maxMs: drv.tickMaxMs, n: drv.tickN } : null,
      /* return the raw interval array so the summary can compute any quantile */
      raw: (function(){ var a=[]; for (var i=1;i<f.length;i++) a.push(+(f[i]-f[i-1]).toFixed(3)); return a; })()
    });
  });
})()`;

const REPORT = {
  schema: 'gvb.loadcurve/1', engine: ENGINE, cell: CELL, dpr: DPR, msPerLevel: MS, passes: PASSES,
  at: new Date().toISOString(), loadavgBefore: fs.readFileSync('/proc/loadavg', 'utf8').trim(), levels: [],
};

async function measureAll(evalFn, closeFn) {
  for (let pass = 1; pass <= PASSES; pass++) {
    for (const L of LEVELS) {
      const raw = await evalFn(LOAD_EXPR(L, MS));
      const o = JSON.parse(raw);
      const st = stats(o.raw || []);
      REPORT.levels.push({
        pass, levelMs: L, frames: o.frames, pageFrames: o.pageFrames, burnFrames: o.burnFrames,
        intervalStats: st, rafJs: o.rafJs, ticks: o.drv && o.drv.ticks, moves: o.drv && o.drv.moves,
        intervals: (o.raw || []).length > 4000 ? undefined : o.raw,
        loadavg: fs.readFileSync('/proc/loadavg', 'utf8').trim(),
      });
      console.log(`  pass${pass} L=${L}ms frames=${o.frames} p50=${st.p50} p95=${st.p95} max=${st.max} over50=${st.over50} rafJsMean=${o.rafJs && o.rafJs.meanMs}`);
      await sleep(500);
    }
  }
  await closeFn();
}

async function main() {
  const url = cellUrl('file://' + MINIMAL, (CELLS[CELL] || {}).params || {});
  REPORT.url = url;
  if (ENGINE === 'firefox') {
    const inst = await launchFirefox({ tag: 'loadcurve', port: PORT, dpr: DPR, logDir: path.join(ROOT, 'logs') });
    REPORT.pid = inst.pid; REPORT.version = (await ffVersion()).split('\n').filter((l) => /Firefox/.test(l)).join(' ');
    REPORT.gfxLines = inst.gfxLines();
    const bidi = await connectBidi(inst);
    await bidi.newSession({ alwaysMatch: {} });
    const ctx = await bidi.createContext('tab');
    await bidi.addPreloadScript(asFn(INSTRUMENT), [ctx]);
    await bidi.addPreloadScript(asFn(DRIVER), [ctx]);
    await bidi.navigate(ctx, url);
    await bidi.setViewport(ctx, { width: 1280, height: 800 }).catch(() => { });
    for (let i = 0; i < 40; i++) { if (await bidi.evaluate(ctx, '!!window.__DRV && !!(window.MMP&&window.MMP.ready)').catch(() => false)) break; await sleep(250); }
    await sleep(1500);
    await measureAll(async (e) => bidi.evaluate(ctx, e, { timeoutMs: MS + 90000 }), async () => {
      await bidi.endSession().catch(() => { }); bidi.close(); REPORT.exit = await inst.close();
    });
  } else {
    const require = createRequire(path.join(PLAYWRIGHT_ROOT, 'package.json'));
    const { chromium } = require('playwright');
    const profile = '/tmp/gvb-chrome-loadcurve';
    fs.rmSync(profile, { recursive: true, force: true }); fs.mkdirSync(profile, { recursive: true });
    const ctx = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 1280, height: 800 }, deviceScaleFactor: DPR, args: ['--no-first-run'] });
    await ctx.addInitScript({ content: asInit(INSTRUMENT) });
    await ctx.addInitScript({ content: asInit(DRIVER) });
    const page = ctx.pages()[0] || await ctx.newPage();
    REPORT.version = await page.evaluate('navigator.userAgent');
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction('!!window.__DRV && !!(window.MMP&&window.MMP.ready)', null, { timeout: 20000 }).catch(() => { });
    await sleep(1500);
    await measureAll(async (e) => page.evaluate(e), async () => { await ctx.close(); });
  }
  REPORT.loadavgAfter = fs.readFileSync('/proc/loadavg', 'utf8').trim();
  REPORT.host = { cpus: os.cpus().length };
  const out = path.join(ROOT, 'raw', `loadcurve-${ENGINE}-dpr${DPR}-${CELL}.json`);
  fs.writeFileSync(out, JSON.stringify(REPORT, null, 1));
  console.log('-> ' + out);
}

main().then(() => process.exit(0)).catch((e) => { console.error('FAIL ' + e.message); process.exit(1); });
