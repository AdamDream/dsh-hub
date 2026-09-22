// Probe v3: three exactly-separated click windows on fresh page loads.
//  W1 boot-window   : click 设置 as soon as the button exists (click lands DURING page boot)
//  W2 fresh-first   : click 设置 at +8000ms on a fresh page (true first open, page settled)
//  W3 warm-reopen   : same page as W2, after ESC + reopen (steady state)
// Every window has a single settings open. Also records ThemePresenter.apply / refreshThemeColor
// invocation counts on the prototype (effect-bearing, verified by behavioural identity check).
import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import os from 'node:os';

const ROOT = '/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/first-open-profile';
const RAW = ROOT + '/raw/';
fs.mkdirSync(RAW, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const r3 = x => (x == null || !isFinite(x)) ? null : Math.round(x * 1000) / 1000;
const loadavg = () => { const l = os.loadavg(); return { l1: r3(l[0]), l5: r3(l[1]), l15: r3(l[2]), cpus: os.cpus().length }; };
const TAG = process.argv[2] || 'v3';
const REPS = Number(process.argv[3] || 1);

const INIT = () => {
  const r3 = x => (x == null || !isFinite(x)) ? null : Math.round(x * 1000) / 1000;
  const H = {
    t0: performance.now(), raf: [], rafOn: false, muts: [], mutOn: false, longtasks: [],
    fn: {}, stackTrap: { calls: 0, armed: false, samples: [] }, captures: {},
    gcs: [], marks: {}, presenter: { wrap: null, pollTicks: 0, factoryRuns: 0, foundKey: null }, wp: {},
  };
  window.__H = H;

  const origPrepare = Error.prepareStackTrace;
  Error.prepareStackTrace = function (err, frames) {
    H.stackTrap.calls++;
    if (H.stackTrap.samples.length < 40) H.stackTrap.samples.push(frames.slice(0, 9).map(f => ({ fn: f.getFunctionName() || null, file: f.getFileName() || '', line: f.getLineNumber() })));
    return origPrepare ? origPrepare(err, frames) : frames.map(f => '    at ' + (f.getFunctionName() || '<anon>') + ' (' + f.getFileName() + ':' + f.getLineNumber() + ')').join('\n');
  };
  H.stackTrapSelfTest = () => { H.stackTrap.armed = true; const b = H.stackTrap.calls; try { void (new Error('x').stack); } catch (e) { } return { before: b, after: H.stackTrap.calls, fired: H.stackTrap.calls > b }; };
  H.cap = (key, extra) => {
    try {
      const st = String(new Error('cap').stack).split('\n').slice(1, 9).map(l => l.trim().slice(0, 180));
      if (!H.captures[key]) H.captures[key] = { n: 0, stacks: [] };
      H.captures[key].n++;
      if (H.captures[key].stacks.length < 5) H.captures[key].stacks.push({ extra: extra || null, stack: st });
    } catch (e) { }
  };
  function ownKey(o, name) { let x = o; while (x) { if (Object.prototype.hasOwnProperty.call(x, name)) return { holder: x, desc: Object.getOwnPropertyDescriptor(x, name) }; x = Object.getPrototypeOf(x); } return null; }
  H.wrapReport = [];
  H.wrap = function (target, name, key, opts) {
    opts = opts || {};
    const rec = ownKey(target, name);
    if (!rec || typeof rec.desc.value !== 'function' || rec.desc.get) { const r = { key, ok: false, why: rec ? (rec.desc.get ? 'accessor' : 'not-fn') : 'not-found' }; H.wrapReport.push(r); return r; }
    const orig = rec.desc.value;
    const state = H.fn[key] = { n: 0, ms: 0, max: 0, errors: 0, holder: rec.holder === target ? 'own' : (rec.holder.constructor && rec.holder.constructor.name) || 'proto', origName: orig.name, origLen: orig.length };
    function wrapper() {
      const t = performance.now(); let threw = false;
      try { return orig.apply(this, arguments); }
      catch (e) { threw = true; state.errors++; throw e; }
      finally {
        const d = performance.now() - t; state.n++; state.ms += d; if (d > state.max) state.max = d;
        if (opts.capIf && opts.capIf(state, d)) H.cap(key, { d: r3(d), n: state.n });
      }
    }
    try { Object.defineProperty(rec.holder, name, { configurable: true, writable: true, enumerable: rec.desc.enumerable, value: wrapper }); }
    catch (e) { const r = { key, ok: false, why: 'define:' + e.message }; H.wrapReport.push(r); return r; }
    const r = { key, ok: true, holder: state.holder, name: orig.name }; H.wrapReport.push(r); return r;
  };
  const W = (t, n, k, o) => H.wrap(t, n, k, o);
  W(Element.prototype, 'getBoundingClientRect', 'Element.getBoundingClientRect', {});
  W(Object, 'entries', 'Object.entries', { capIf: (s, d) => s.n <= 4 || d > 1.5 });
  W(Object, 'keys', 'Object.keys', { capIf: (s, d) => d > 1.5 });
  W(Document.prototype, 'querySelectorAll', 'Document.querySelectorAll', {});
  W(Element.prototype, 'querySelectorAll', 'Element.querySelectorAll', {});
  W(Element.prototype, 'getElementsByTagName', 'Element.getElementsByTagName', {});
  W(Node.prototype, 'appendChild', 'Node.appendChild', {});
  W(window, 'requestAnimationFrame', 'win.requestAnimationFrame', {});
  W(window, 'fetch', 'win.fetch', { capIf: (s, d) => s.n <= 30 });
  W(JSON, 'parse', 'JSON.parse', { capIf: (s, d) => d > 2 });
  W(JSON, 'stringify', 'JSON.stringify', { capIf: (s, d) => d > 2 });
  W(Element.prototype, 'setAttribute', 'Element.setAttribute', {});
  const gcs = window.getComputedStyle;
  H.gcsOrig = gcs;
  function gcsWrapper() {
    const t = performance.now();
    try { return gcs.apply(this, arguments); } finally {
      const d = performance.now() - t;
      const s = H.fn['win.getComputedStyle'] || (H.fn['win.getComputedStyle'] = { n: 0, ms: 0, max: 0, errors: 0 });
      s.n++; s.ms += d; if (d > s.max) s.max = d;
      if (H.gcs.length < 40) { const st = []; try { const f = String(new Error('g')).stack.split('\n').slice(2, 8); for (const l of f) st.push(l.trim().slice(0, 160)); } catch (e) { } H.gcs.push({ t: r3(performance.now()), d: r3(d), arg: (arguments[0] && arguments[0].nodeName) || '?', stack: st }); }
    }
  }
  // `value` + `native: true` makes this a REPLACEABLE ATTRIBUTE: native/binding call sites keep
  // resolving the original function, so CSSOM internals cannot end up calling our wrapper with the
  // wrong `this`. (Without `native`, V8 raises "Illegal invocation" from internal uses.)
  try { Object.defineProperty(window, 'getComputedStyle', { configurable: true, writable: true, enumerable: true, value: gcsWrapper, native: true }); H.gcsPatchMode = 'window-native-true'; }
  catch (e) {
    H.gcsPatchFailed = String(e);
    try { window.getComputedStyle = gcsWrapper; H.gcsPatchMode = 'assign'; } catch (e2) { H.gcsPatchMode = 'none'; }
  }
  // also count the unpatched path for a lower bound via a wrapper on the original, called only by our code
  H.gcsOrigName = String(gcs.name);

  (function loop(t) { if (H.rafOn) H.raf.push(r3(t)); requestAnimationFrame(loop); })(0);
  try { new PerformanceObserver(l => l.getEntries().forEach(e => H.longtasks.push({ start: r3(e.startTime), dur: r3(e.duration), name: e.name }))).observe({ entryTypes: ['longtask'] }); } catch (e) { }
  try { new MutationObserver(rs => { if (H.mutOn) for (const r of rs) H.muts.push({ t: r3(performance.now()), type: r.type, target: r.target.nodeName }); }).observe(document, { childList: true, subtree: true, attributes: true, characterData: true }); } catch (e) { }
  H.metaAdds = 0; H.tFirstMetaAdd = null;
  try { new MutationObserver(rs => { for (const r of rs) for (const n of r.addedNodes) if (n.nodeType === 1 && n.tagName === 'META' && n.name === 'theme-color') { H.metaAdds++; if (H.tFirstMetaAdd == null) H.tFirstMetaAdd = r3(performance.now()); } }).observe(document.documentElement || document, { childList: true, subtree: true }); } catch (e) { }

  H.census = () => {
    const d = document.querySelector('div[role=dialog][aria-modal=true]');
    return {
      nodes: document.getElementsByTagName('*').length, svg: document.getElementsByTagName('svg').length,
      rect: document.getElementsByTagName('rect').length, path: document.getElementsByTagName('path').length,
      metaThemeColor: document.querySelectorAll('meta[name=theme-color]').length,
      dialogPresent: !!d, dialogNodes: d ? d.getElementsByTagName('*').length : 0, dialogSvg: d ? d.getElementsByTagName('svg').length : 0,
      dialogTextLen: d ? (d.innerText || '').length : 0,
      bodyStyleLen: document.body ? document.body.style.length : null, bodyCssText: document.body ? document.body.style.cssText.slice(0, 120) : null,
      sheets: document.styleSheets.length, themeMetaContent: document.querySelector('meta[name=theme-color]')?.content ?? null,
      colorScheme: document.documentElement.style.colorScheme, styleTags: document.querySelectorAll('style').length,
    };
  };
  H.dialogAncestry = () => { const d = document.querySelector('div[role=dialog][aria-modal=true]'); if (!d) return null; const o = []; let n = d; while (n && n.nodeType === 1) { o.push({ tag: n.tagName.toLowerCase(), cls: (n.className || '').toString().slice(0, 40), role: n.getAttribute('role'), own: n.getElementsByTagName('*').length }); if (n === document.body) break; n = n.parentElement; } return o; };
  H.layers = () => { const o = []; for (const e of document.querySelectorAll('*')) { const c = (e.className || '').toString(); if (/wallpaper|overlay|mask|backdrop|blur|settingsArea|nav/i.test(c)) { const r = e.getBoundingClientRect(); o.push({ cls: c.slice(0, 50), tag: e.tagName, w: Math.round(r.width), h: Math.round(r.height), bg: (window.__H.gcsOrig ? window.__H.gcsOrig(e).backgroundImage : '').slice(0, 60) }); } } return o.slice(0, 24); };

  // ---- capture the ui-layout theme presenter INSTANCE at module materialization.
  // ThemePresenter is NOT exported (ui-layout exports only LayoutController/apply/inject), so class
  // wrapping is impossible from outside. The presenter lives in a ctx.effect callback; wrapping the
  // effect callback object in a Proxy lets the call land on the real `this` unchanged while we patch
  // `apply`/`refreshThemeColor` on the instance just before that very effect runs.
  H.presenterProbe = { ticks: 0, found: null, factoryRuns: 0, effectRuns: 0, err: null };
  (function pollLoader() {
    H.presenterProbe.ticks++;
    try {
      const ml = window.__ModuleLoader__;
      if (ml && typeof ml.load === 'function' && !ml.__probePatched) {
        ml.__probePatched = true;
        const origLoad = ml.load;
        Object.defineProperty(ml, 'load', {
          configurable: true, writable: true, value: function (registration) {
            try {
              if (registration && typeof registration.factory === 'function' && registration.id === '@deepseek-ai/dsh-client-ui-layout') {
                const origFactory = registration.factory;
                Object.defineProperty(registration, 'factory', {
                  configurable: true, writable: true, value: function (require) {
                    wrapCtxEffect(require);
                    return origFactory.call(this, require);
                  }
                });
              }
            } catch (e) { H.loaderPatchError = String(e); }
            return origLoad.call(ml, registration);
          }
        });
      }
    } catch (e) { H.loaderPollError = String(e); }
    if (!(window.__ModuleLoader__ && window.__ModuleLoader__.__probePatched)) setTimeout(pollLoader, 1);
  })();
  function wrapCtxEffect(require) {
    try {
      const ctx = require('@deepseek-ai/dsh-client-runtime/client');
      if (!ctx || typeof ctx !== 'object') { H.presenterProbe.err = 'runtime-require-shape'; return; }
      const keys = Object.keys(ctx).slice(0, 30);
      H.presenterProbe.runtimeKeys = keys;
      const targets = [];
      for (const k of keys) {
        const v = ctx[k];
        if (v && typeof v === 'object' && !targets.includes(v)) targets.push(v);
      }
      if (!targets.includes(ctx)) targets.push(ctx);
      for (const t of targets) {
        const rec = Object.getOwnPropertyDescriptor(t, 'effect');
        if (rec && typeof rec.value === 'function' && !t.__probeEffectWrapped) {
          const origEffect = rec.value;
          Object.defineProperty(t, 'effect', {
            configurable: true, writable: true, enumerable: rec.enumerable,
            value: new Proxy(origEffect, {
              apply(fn, thisArg, args) {
                try {
                  if (args[0] && (typeof args[0] === 'function' || typeof args[0] === 'object') && !args[0].__probeInner) {
                    args[0] = new Proxy(args[0], {
                      apply(inner, innerThis, innerArgs) {
                        H.presenterProbe.effectRuns++;
                        try { patchPresenterIfAny(innerThis); } catch (e) { H.presenterProbe.err = 'patch:' + e.message; }
                        return Reflect.apply(inner, innerThis, innerArgs);
                      },
                      // MUST read with the TARGET as receiver: accessor properties on the context
                      // (e.g. `ctx.theme`) throw "Illegal invocation" when invoked with the Proxy as `this`.
                      get(tgt, prop) {
                        if (prop === '__probeInner') return true;
                        return Reflect.get(tgt, prop, tgt);
                      }
                    });
                    args[0].__probeInner = true;
                  }
                } catch (e) { H.presenterProbe.err = 'proxy:' + e.message; }
                return Reflect.apply(fn, thisArg, args);
              }
            })
          });
          Object.defineProperty(t, '__probeEffectWrapped', { value: true, configurable: true });
        }
      }
    } catch (e) { H.presenterProbe.err = 'effectwrap:' + String(e).slice(0, 140); }
  }
  function patchPresenterIfAny(owner) {
    try {
      if (!owner || (typeof owner !== 'object')) return;
      for (const k of Object.getOwnPropertyNames(owner)) {
        const v = owner[k];
        if (v && typeof v === 'object' && typeof v.apply === 'function' && typeof v.refreshThemeColor === 'function' && v.themeColorMeta) {
          const first = !v.__probePatched;
          if (first) {
            Object.defineProperty(v, '__probePatched', { value: true, configurable: true });
            H.presenterProbe.found = { key: k, ctor: v.constructor && v.constructor.name, metaName: v.themeColorMeta && v.themeColorMeta.name, hasLastSignature: 'lastSignature' in v, appliedTokensLen: Array.isArray(v.appliedTokens) ? v.appliedTokens.length : null };
          }
          H.wrap(v, 'apply', 'ThemePresenter.apply', { capIf: (s, d) => s.n <= 8 });
          H.wrap(v, 'refreshThemeColor', 'ThemePresenter.refreshThemeColor', { capIf: (s, d) => s.n <= 8 });
          H.wrap(v, 'landingIntact', 'ThemePresenter.landingIntact', { capIf: (s, d) => s.n <= 8 });
          H.wrap(v, 'dispose', 'ThemePresenter.dispose', {});
        }
      }
    } catch (e) { H.presenterProbe.err = 'patchIfAny:' + String(e).slice(0, 120); }
  }
};
// ------------------------------------------------------------------ end INIT

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-precise-memory-info'] });
const results = { meta: { tag: TAG, reps: REPS, startedAt: new Date().toISOString(), loadBefore: loadavg(), noHook: process.env.NO_HOOK === '1' }, windows: [], bootEvents: [] };

async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const net = [], errs = [];
  page.on('requestfinished', async r => { try { const t = r.timing(); net.push({ url: r.url().replace('http://127.0.0.1:3080', '').split('?')[0], ms: r3(t.responseEnd - r.requestStart), status: r.response()?.status() }); } catch { } });
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
  page.on('pageerror', e => errs.push('PAGEERROR ' + String(e).slice(0, 160)));
  await page.addInitScript(INIT);
  if (process.env.NO_HOOK === '1') await page.addInitScript(() => { window.__NO_HOOK = true; });
  return { page, cdp, net, errs };
}

const arm = p => p.evaluate(() => { const H = window.__H; H.rafOn = true; H.mutOn = true; H.raf = []; H.muts = []; H.longtasks = []; H.gcs = []; H.captures = {}; H.metaAdds = 0; H.tFirstMetaAdd = null; H.mark = { click: null, dialog: null, quiet: null, end: null }; for (const k of Object.keys(H.fn)) H.fn[k].n0 = H.fn[k].n, H.fn[k].ms0 = H.fn[k].ms; return { t: performance.now(), census: H.census() }; });
const snapshotFn = p => p.evaluate(() => { const H = window.__H; const o = {}; for (const k of Object.keys(H.fn)) { const s = H.fn[k]; o[k] = { n: s.n - (s.n0 || 0), ms: r3(s.ms - (s.ms0 || 0)), max: r3(s.max) }; } return o; });

async function clickAndSettle(page, label) {
  await page.evaluate(() => { window.__H.mark.click = performance.now(); });
  await page.locator('button:has-text("设置")').first().click({ timeout: 8000 });
  const settle = await page.evaluate(async () => {
    let H, t0;
    try { H = window.__H; t0 = performance.now(); } catch (e) { return { hard: String(e && e.message), phase: 'bootstrap' }; }
    const MAXW = 15000, QUIET = 700; const steps = [];
    H.step = 'start';
    const DB = () => document.querySelector('div[role=dialog][aria-modal=true]');
    let firstDialog = null, last = performance.now(), lastN = H.muts.length;
    try {
      while (performance.now() - t0 < MAXW) {
        H.step = 'raf-await';
        await new Promise(r => requestAnimationFrame(r));
        H.step = 'qsa';
        const d = DB();
        H.step = 'mark';
        if (firstDialog === null && d) { firstDialog = performance.now(); H.mark.dialog = firstDialog; }
        H.step = 'count';
        if (H.muts.length !== lastN) { lastN = H.muts.length; last = performance.now(); }
        else if (performance.now() - last >= QUIET) break;
        H.step = 'loop-end';
      }
    } catch (e) {
      return { error: String(e && e.message), step: H.step, at: performance.now(), t0, steps: steps.slice(-5) };
    }
    try {
      H.mark.quiet = performance.now();
      return { t0, firstDialog, quiet: H.mark.quiet, muts: H.muts.length, elapsed: performance.now() - t0, step: H.step };
    } catch (e) { return { hard: String(e && e.message), phase: 'finish', step: H.step }; }
  });
  const after = await page.evaluate(() => {
    const r3 = x => (x == null || !isFinite(x)) ? null : Math.round(x * 1000) / 1000;
    const H = window.__H; H.rafOn = false; H.mutOn = false; H.mark.end = performance.now();
    const raf = H.raf.slice(); const d = raf.slice(1).map((t, i) => r3(t - raf[i]));
    const srt = d.slice().sort((a, b) => a - b); const q = p => srt.length ? r3(srt[Math.min(srt.length - 1, Math.floor((srt.length - 1) * p))]) : null;
    return {
      marks: H.mark, census: H.census(), ancestry: H.dialogAncestry(), layers: H.layers(),
      muts: H.muts.length, mutHead: H.muts.slice(0, 5), mutTail: H.muts.slice(-5),
      rafN: raf.length, rafP50: q(.5), rafP95: q(.95), rafMax: srt.length ? r3(srt[srt.length - 1]) : null, rafOver50: d.filter(x => x > 50).length,
      longtasks: H.longtasks.slice(0, 40),
      gcs: H.gcs.slice(0, 25), metaAdds: H.metaAdds, tFirstMetaAdd: H.tFirstMetaAdd,
      captures: H.captures, presenterProbe: H.presenterProbe, wrapReport: H.wrapReport,
      stackTrapCalls: H.stackTrap.calls, stackSamples: H.stackTrap.samples.slice(0, 12),
    };
  });
  return { label, settle, after };
}

// ---------------- W1: boot window (click during boot) ----------------
async function windowBoot() {
  const { page, cdp, net, errs } = await newPage();
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
  await page.goto('http://127.0.0.1:3080', { waitUntil: 'commit', timeout: 60000 });
  await cdp.send('Profiler.start');
  const tNavWall = Date.now();
  await page.waitForSelector('button:has-text("设置")', { timeout: 90000 });
  const tBtnWall = Date.now();
  await arm(page);
  const lateArm = await page.evaluate(() => ({ nodes: document.getElementsByTagName('*').length, muts: window.__H.muts.length, rafN: window.__H.raf.length, fnKeys: Object.keys(window.__H.fn), presenter: window.__H.presenterProbe }));
  const res = await clickAndSettle(page, 'W1-boot-window');
  const prof = await cdp.send('Profiler.stop');
  const tEndWall = Date.now();
  const fn = await snapshotFn(page);
  const hook = await page.evaluate(() => ({ hook: !!window.__REACT_DEVTOOLS_GLOBAL_HOOK__, noHook: window.__NO_HOOK === true }));
  await page.context().close();
  return { label: 'W1-boot-window', wall: { nav: tNavWall, btn: tBtnWall, btnToClick: res.settle.t0 ? null : null, end: tEndWall }, lateArm, ...res, fn, prof, net, errs, hook, mode: 'click-during-boot' };
}

// ---------------- W2/W3: fresh-first and warm-reopen ----------------
async function windowFreshThenReopen(rep) {
  const { page, cdp, net, errs } = await newPage();
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
  const tNav = Date.now();
  await page.goto('http://127.0.0.1:3080', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('button:has-text("设置")', { timeout: 90000 });
  await sleep(8000);
  const bootState = await page.evaluate(() => ({ presenterProbe: window.__H.presenterProbe, wrapReport: window.__H.wrapReport, cens: window.__H.census(), metaAdds: window.__H.metaAdds, tFirstMetaAdd: window.__H.tFirstMetaAdd, stackTrapCalls: window.__H.stackTrap.calls, stackSamples: window.__H.stackTrap.samples.slice(0, 10), fnAtBoot: window.__H.fn, caps: window.__H.captures, presenterCallCountAtBoot: (window.__H.fn['ThemePresenter.apply'] || {}).n }));
  // --- W2
  const armed = await arm(page);
  await cdp.send('Profiler.start');
  const w2 = await clickAndSettle(page, 'W2-fresh-first-open');
  const prof2 = await cdp.send('Profiler.stop');
  const fn2 = await snapshotFn(page);
  // --- close
  await page.keyboard.press('Escape'); await sleep(1200);
  let closed = (await page.locator('div[role=dialog][aria-modal=true]').count()) === 0;
  if (!closed) { const l = page.locator('div[role=dialog][aria-modal=true] button:has-text("关闭")').first(); if (await l.count()) { try { await l.click({ timeout: 3000 }); await sleep(900); } catch { } } closed = (await page.locator('div[role=dialog][aria-modal=true]').count()) === 0; }
  const closedState = { escOrButton: closed, count: await page.locator('div[role=dialog][aria-modal=true]').count() };
  await sleep(3000);
  // --- W3
  let w3 = null, prof3 = null, fn3 = null;
  if (closed) {
    const armed3 = await arm(page);
    await cdp.send('Profiler.start');
    w3 = await clickAndSettle(page, 'W3-warm-reopen');
    prof3 = await cdp.send('Profiler.stop');
    fn3 = await snapshotFn(page);
  }
  const hook = await page.evaluate(() => ({ hook: !!window.__REACT_DEVTOOLS_GLOBAL_HOOK__, noHook: window.__NO_HOOK === true, fnFinal: window.__H.fn, presenterProbe: window.__H.presenterProbe }));
  await page.context().close();
  const slim = p => p ? { nodes: p.profile.nodes, startTime: p.profile.startTime, endTime: p.profile.endTime, samples: p.profile.samples, timeDeltas: p.profile.timeDeltas } : null;
  return { rep, navWall: tNav, bootState, armedW2: armed, w2: { ...w2, fn: fn2 }, prof2: slim(prof2), closedState, armedW3: closed ? undefined : null, w3: w3 ? { ...w3, fn: fn3 } : null, prof3: slim(prof3), hook, net, errs };
}

for (let rep = 1; rep <= REPS; rep++) {
  results.windows.push(await windowBoot());
  results.windows.push(await windowFreshThenReopen(rep));
  results.loadMid = loadavg();
}
results.loadAfter = loadavg();
results.consoleErrorsSum = results.windows.flatMap(w => w.errs || []).slice(0, 20);

fs.writeFileSync(RAW + `probe3-${TAG}-summary.json`, JSON.stringify(results, (k, v) => (k === 'prof2' || k === 'prof3' || k === 'prof' ? undefined : v), null, 2));
results.windows.forEach((w, i) => {
  if (w.prof) fs.writeFileSync(RAW + `probe3-${TAG}-w${i}-W1.profile.json`, JSON.stringify({ label: 'W1', nodes: w.prof.profile.nodes, startTime: w.prof.profile.startTime, endTime: w.prof.profile.endTime, samples: w.prof.profile.samples, timeDeltas: w.prof.profile.timeDeltas }));
  if (w.prof2) fs.writeFileSync(RAW + `probe3-${TAG}-w${i}-W2.profile.json`, JSON.stringify({ label: 'W2', ...w.prof2 }));
  if (w.prof3) fs.writeFileSync(RAW + `probe3-${TAG}-w${i}-W3.profile.json`, JSON.stringify({ label: 'W3', ...w.prof3 }));
});

// ------- console report
console.log('META', JSON.stringify({ loadBefore: results.meta.loadBefore, loadMid: results.loadMid, loadAfter: results.loadAfter }));
for (const [i, w] of results.windows.entries()) {
  if (w.label === 'W1-boot-window') {
    console.log(`\n#### ${w.label}  mode=${w.mode}`);
    console.log(' lateArm', JSON.stringify(w.lateArm).slice(0, 500));
    console.log(' settle', JSON.stringify(w.settle));
    console.log(' census', JSON.stringify(w.after.census), 'metaAdds', w.after.metaAdds, 'tFirstMetaAdd', w.after.tFirstMetaAdd);
    console.log(' raf', JSON.stringify({ n: w.after.rafN, p50: w.after.rafP50, p95: w.after.rafP95, max: w.after.rafMax, over50: w.after.rafOver50 }), 'longtasks', w.after.longtasks.length);
    console.log(' fn', JSON.stringify(w.fn));
    console.log(' presenterProbe', JSON.stringify(w.after.presenterProbe).slice(0, 400));
    console.log(' wrapReport', JSON.stringify(w.after.wrapReport));
    console.log(' captures', JSON.stringify(w.after.captures).slice(0, 1500));
    console.log(' stackSamples', JSON.stringify(w.after.stackSamples).slice(0, 1200));
  } else {
    console.log(`\n#### rep${w.rep} bootState`);
    console.log('  presenterProbe', JSON.stringify(w.bootState.presenterProbe).slice(0, 300), 'applyCallsAtBoot', w.bootState.presenterCallCountAtBoot);
    console.log('  metaAdds', w.bootState.metaAdds, 'tFirstMetaAdd', w.bootState.tFirstMetaAdd, 'stackTrapCalls', w.bootState.stackTrapCalls);
    console.log('  fnAtBoot', JSON.stringify(w.bootState.fnAtBoot));
    console.log('  wrapReport', JSON.stringify(w.bootState.wrapReport));
    console.log('  censusAtBoot', JSON.stringify(w.bootState.cens));
    console.log('  captures', JSON.stringify(w.bootState.caps).slice(0, 1800));
    for (const key of ['w2', 'w3']) {
      const x = w[key]; if (!x) { console.log(`  ${key}: SKIPPED`); continue; }
      console.log(`  -- ${key} ${x.label}: settle`, JSON.stringify(x.settle));
      console.log(`     census`, JSON.stringify(x.after.census), 'metaAdds', x.after.metaAdds, 'tFirstMetaAdd', x.after.tFirstMetaAdd);
      console.log(`     raf`, JSON.stringify({ n: x.after.rafN, p50: x.after.rafP50, p95: x.after.rafP95, max: x.after.rafMax, over50: x.after.rafOver50 }), 'lt', x.after.longtasks.length, 'muts', x.after.muts);
      console.log(`     fn`, JSON.stringify(x.fn));
      console.log(`     captures`, JSON.stringify(x.after.captures).slice(0, 1200));
      console.log(`     gcs(first 3)`, JSON.stringify(x.after.gcs.slice(0, 3)).slice(0, 900));
    }
    console.log('  closedState', JSON.stringify(w.closedState));
  }
}
console.log('\nERRORS', JSON.stringify(results.consoleErrorsSum));
await browser.close();
