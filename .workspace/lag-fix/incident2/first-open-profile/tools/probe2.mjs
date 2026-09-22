// Probe v2: click-window cost decomposition (first open vs reopen) with CDP CPU profiler.
// Clean pass: NO React devtools hook (NO_HOOK=1) so the profile is not perturbed by the instrumented census.
// Instrumentation: rAF frames, long tasks, MutationObserver settle detection, per-function counters
// injected through page.addInitScript (runs at document-start, before page scripts).
import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import os from 'node:os';

const ROOT = '/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/first-open-profile';
const RAW = ROOT + '/raw/';
fs.mkdirSync(RAW, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const r3 = x => (x == null || !isFinite(x)) ? null : Math.round(x * 1000) / 1000;
const loadavg = () => { const l = os.loadavg(); return { l1: r3(l[0]), l5: r3(l[1]), l15: r3(l[2]), cpus: os.cpus().length }; };

const TAG = process.argv[3] || 'clean';
const NOTIFY_ON_CLICK = process.env.NOTIFY === '1';

const INIT = () => {
  const r3 = x => (x == null || !isFinite(x)) ? null : Math.round(x * 1000) / 1000;
  const H = {
    t0: null, raf: [], rafOn: false, muts: [], mutOn: false, longtasks: [],
    fn: {}, funcs: {}, stackTrap: { calls: 0, armed: false, samples: [] },
    getComputedStyleCalls: [], wp: {}, notify: false, tFirstBodyStyleWrite: null, tFirstThemeMeta: null,
  };
  window.__H = H;

  // ---- stack-trap diagnostics: only fires when `.stack` is actually accessed
  const origPrepare = Error.prepareStackTrace;
  Error.prepareStackTrace = function (err, frames) {
    H.stackTrap.calls++;
    if (H.stackTrap.samples.length < 30) {
      H.stackTrap.samples.push(frames.slice(0, 8).map(f => ({ fn: f.getFunctionName() || null, file: (f.getFileName() || ''), line: f.getLineNumber() })));
    }
    return origPrepare ? origPrepare(err, frames) : String(err);
  };
  H.stackTrapSelfTest = () => {
    H.stackTrap.armed = true;
    const b = H.stackTrap.calls;
    try { void (new Error('x').stack); } catch (e) { }
    return { before: b, after: H.stackTrap.calls, fired: H.stackTrap.calls > b };
  };

  // ---- function interception
  // Wrap once on the owner that actually holds the function (own property first, then the prototype
  // that declares it) so bookkeeping wrappers are never re-wrapped and `this` stays the real receiver.
  function ownKey(o, name) { let x = o; while (x) { if (Object.prototype.hasOwnProperty.call(x, name)) return { holder: x, desc: Object.getOwnPropertyDescriptor(x, name) }; x = Object.getPrototypeOf(x); } return null; }
  H.captures = {};
  H.captureStack = function (key, extra) {
    const e = new Error('cap:' + key);
    const st = String(e.stack).split('\n').slice(2, 12).map(l => l.trim().slice(0, 170));
    if (!H.captures[key]) H.captures[key] = { n: 0, stacks: [] };
    H.captures[key].n++;
    if (H.captures[key].stacks.length < 4) H.captures[key].stacks.push({ extra: extra || null, stack: st });
  };
  H.wrap = function (target, name, key, opts) {
    opts = opts || {};
    const rec = ownKey(target, name);
    if (!rec || typeof rec.desc.value !== 'function' || rec.desc.get) return { key, ok: false, why: rec ? 'not-a-plain-function' : 'not-found' };
    const orig = rec.desc.value;
    const state = H.fn[key] || (H.fn[key] = { n: 0, ms: 0, max: 0, errors: 0, holder: (rec.holder === target ? 'own' : rec.holder.constructor?.name || 'proto'), origName: orig.name, origLength: orig.length, src: (rec.holder === target ? 'own' : 'proto') });
    function wrapper() {
      const t = performance.now();
      let threw = false;
      try { return orig.apply(this, arguments); }
      catch (e) { threw = true; state.errors++; throw e; }
      finally {
        const d = performance.now() - t;
        state.n++; state.ms += d; if (d > state.max) state.max = d;
        if (opts.captureStackIf && opts.captureStackIf(state, d, arguments)) H.captureStack(key, { d: r3(d), n: state.n, arg0: (arguments[0] && arguments[0].active) ? 'snapshot' : typeof arguments[0] });
      }
    }
    try { Object.defineProperty(rec.holder, name, { configurable: true, writable: true, enumerable: rec.desc.enumerable, value: wrapper }); }
    catch (e) { return { key, ok: false, why: 'define-failed:' + e.message }; }
    return { key, ok: true, holder: state.holder, origName: orig.name };
  };
  // ---- install wrappers (document-start globals + a poller for the ui-layout presenter class)
  H.wrapReport = [];
  function W(target, name, key, opts) { const r = H.wrap(target, name, key, opts); r.where = name; H.wrapReport.push(r); return r.ok; }
  W(Element.prototype, 'getBoundingClientRect', 'Element.getBoundingClientRect', {});
  W(Object, 'entries', 'Object.entries', { captureStackIf: (st, d, a) => st.n <= 3 || d > 2 });
  W(Document.prototype, 'querySelectorAll', 'Document.querySelectorAll', {});
  W(Element.prototype, 'querySelectorAll', 'Element.querySelectorAll', {});
  W(Element.prototype, 'getElementsByTagName', 'Element.getElementsByTagName', {});
  W(Node.prototype, 'appendChild', 'Node.appendChild', {});
  W(window, 'requestAnimationFrame', 'win.requestAnimationFrame', {});
  W(window, 'fetch', 'win.fetch', {});
  if (typeof CSS !== 'undefined' && CSS.escape) { }
  // poll the module-loader hook until the ui-layout factory has run, then wrap the presenter class
  H.presenterWrap = null;
  (function pollPresenter() {
    try {
      const h = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
      const reg = h && h.__probePresenter;
      if (reg && reg.ctor && reg.ctor.prototype && typeof reg.ctor.prototype.apply === 'function') {
        H.presenterWrap = {
          apply: H.wrap(reg.ctor.prototype, 'apply', 'ThemePresenter.apply', { captureStackIf: (st, d) => st.n <= 6 }),
          refreshThemeColor: H.wrap(reg.ctor.prototype, 'refreshThemeColor', 'ThemePresenter.refreshThemeColor', { captureStackIf: (st, d) => st.n <= 6 }),
          ctor: reg.ctor.name, proto: Object.getOwnPropertyNames(reg.ctor.prototype),
        };
        return;
      }
    } catch (e) { H.presenterWrapError = String(e); }
    setTimeout(pollPresenter, 20);
  })();
  // capture the ui-layout factory registration (does not change behaviour: the factory is still called)
  (function pollLoader() {
    try {
      const ml = window.__ModuleLoader__;
      if (ml && typeof ml.load === 'function' && !ml.__probePatched) {
        ml.__probePatched = true;
        const origLoad = ml.load;
        ml.load = function (registration) {
          try {
            if (registration && typeof registration.factory === 'function') {
              const origFactory = registration.factory;
              registration.factory = function (require) {
                const out = origFactory.call(this, require);
                try {
                  H.factoryRuns = (H.factoryRuns || 0) + 1;
                  const h = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
                  if (h && !h.__probePresenter) {
                    const ex = out;
                    if (ex && typeof ex === 'object') {
                      for (const k of Object.keys(ex)) {
                        const v = ex[k];
                        if (typeof v === 'function' && v.prototype && typeof v.prototype.apply === 'function') h.__probePresenter = { key: k, ctor: v, moduleId: registration.id };
                      }
                    }
                  }
                } catch (e) { }
                return out;
              };
            }
          } catch (e) { H.loaderPatchError = String(e); }
          return origLoad.call(this, registration);
        };
      }
    } catch (e) { H.loaderPollError = String(e); }
    if (!(window.__ModuleLoader__ && window.__ModuleLoader__.__probePatched)) setTimeout(pollLoader, 5);
  })();
  // ---- rAF timeline
  (function loop(t) { if (H.rafOn) H.raf.push(r3(t)); requestAnimationFrame(loop); })(0);
  try { new PerformanceObserver(l => l.getEntries().forEach(e => H.longtasks.push({ start: r3(e.startTime), dur: r3(e.duration), name: e.name }))).observe({ entryTypes: ['longtask'] }); } catch (e) { }
  try { new MutationObserver(recs => { if (!H.mutOn) return; for (const r of recs) H.muts.push({ t: r3(performance.now()), type: r.type, target: r.target.nodeName }); }).observe(document, { childList: true, subtree: true, attributes: true, characterData: true }); } catch (e) { }

  // ---- getComputedStyle counter (stack captured on the first call only)
  const gcs = window.getComputedStyle;
  function gcsWrapper() {
    const t = performance.now();
    try { return gcs.apply(this, arguments); } finally {
      const d = performance.now() - t;
      const s = H.fn['win.getComputedStyle'] || (H.fn['win.getComputedStyle'] = { n: 0, ms: 0, max: 0 });
      s.n++; s.ms += d; if (d > s.max) s.max = d;
      if (H.getComputedStyleCalls.length < 12) {
        const e2 = new Error('gcs'); const st = e2.stack;
        H.getComputedStyleCalls.push({ t: r3(performance.now()), d: r3(d), stack: String(st).split('\n').slice(1, 7).map(s => s.trim().slice(0, 160)) });
      }
    }
  }
  try { Object.defineProperty(window, 'getComputedStyle', { configurable: true, writable: true, value: gcsWrapper }); } catch (e) { H.gcsPatchFailed = String(e); }

  // ---- probe identity markers (must NOT change behaviour)
  const s0 = document.createElement('meta'); s0.name = '__probe_identity__';
  H.markerIdentity = (() => { try { document.head.append(s0); const ok = s0.isConnected; s0.remove(); return ok; } catch (e) { return false; } })();
  // theme-color meta creation observable without patching behaviour
  H.themeColorObserver = 0;
  try {
    const mo = new MutationObserver(recs => { for (const r of recs) for (const n of r.addedNodes) if (n.nodeType === 1 && n.tagName === 'META' && n.name === 'theme-color') { H.themeColorObserver++; if (H.tFirstThemeMeta == null) H.tFirstThemeMeta = r3(performance.now()); } });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) { }
  // body style writes observable
  H.bodyStyleObserver = 0;
  try {
    const mo2 = new MutationObserver(recs => { for (const r of recs) { H.bodyStyleObserver++; if (H.tFirstBodyStyleWrite == null) H.tFirstBodyStyleWrite = r3(performance.now()); } });
    if (document.documentElement) mo2.observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['style', 'data-theme', 'class'] });
  } catch (e) { }

  // ---- wallpaper / overlay layer discovery
  H.wpScan = function () {
    const out = [];
    for (const e of document.querySelectorAll('*')) {
      const c = (e.className || '').toString();
      if (/wallpaper|overlay|mask|backdrop|blur/i.test(c)) {
        const r = e.getBoundingClientRect();
        out.push({ cls: c.slice(0, 60), tag: e.tagName, w: Math.round(r.width), h: Math.round(r.height), z: getComputedStyle(e).zIndex, bg: getComputedStyle(e).backgroundImage.slice(0, 80) });
      }
    }
    return out.slice(0, 20);
  };
  H.usageProbe = function () {
    const hits = [];
    for (const e of document.querySelectorAll('*')) {
      const c = (e.className || '').toString();
      if (/usage|heatmap|uV2eYG|trend|gear/i.test(c)) { const r = e.getBoundingClientRect(); hits.push({ cls: c.slice(0, 60), tag: e.tagName, w: Math.round(r.width), h: Math.round(r.height) }); }
    }
    const txt = [...document.querySelectorAll('*')].filter(e => !e.children.length && /用量|Usage/.test(e.innerText || '')).map(e => ({ tag: e.tagName, txt: (e.innerText || '').slice(0, 40), cls: (e.className || '').toString().slice(0, 40) }));
    return { hits: hits.slice(0, 20), txt: txt.slice(0, 8) };
  };
  H.census = function () {
    const d = document.querySelector('div[role=dialog][aria-modal=true]');
    return {
      nodes: document.getElementsByTagName('*').length,
      svg: document.getElementsByTagName('svg').length, rect: document.getElementsByTagName('rect').length, path: document.getElementsByTagName('path').length, circle: document.getElementsByTagName('circle').length,
      metaThemeColor: document.querySelectorAll('meta[name=theme-color]').length,
      dialogPresent: !!d, dialogNodes: d ? d.getElementsByTagName('*').length : 0,
      dialogSvg: d ? d.getElementsByTagName('svg').length : 0, dialogRect: d ? d.getElementsByTagName('rect').length : 0,
      dialogTextLen: d ? (d.innerText || '').length : 0,
      bodyStyleLen: document.body ? document.body.style.length : null,
      bodyCssText: document.body ? document.body.style.cssText.slice(0, 200) : null,
      headStyleSheets: document.styleSheets.length,
      headCssRules: (() => { let n = 0; for (const ss of document.styleSheets) { try { n += ss.cssRules.length; } catch (e) { n += -1; } } return n; })(),
      themeMetaContent: document.querySelector('meta[name=theme-color]')?.content ?? null,
      docColorScheme: document.documentElement.style.colorScheme,
      bodyDarkAttr: document.body ? document.body.hasAttribute('data-theme') || document.body.getAttribute('dark') !== null : null,
      bodyAttrs: document.body ? [...document.body.attributes].map(a => a.name).slice(0, 8) : [],
    };
  };
  H.dialogAncestry = function () {
    const d = document.querySelector('div[role=dialog][aria-modal=true]');
    if (!d) return null;
    const chain = []; let n = d;
    while (n && n.nodeType === 1) {
      chain.push({ tag: n.tagName.toLowerCase(), cls: (n.className || '').toString().slice(0, 40), role: n.getAttribute('role'), ariaModal: n.getAttribute('aria-modal'), own: n.getElementsByTagName('*').length });
      if (n === document.body) break; n = n.parentElement;
    }
    return chain;
  };
};
// ---------------------------------------------------------------- end INIT

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-precise-memory-info'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
const net = [], consoleErrors = [];
page.on('requestfinished', async r => { try { const t = r.timing(); net.push({ t: Date.now(), url: r.url().replace('http://127.0.0.1:3080', '').split('?')[0], ms: r3(t.responseEnd - t.requestStart), status: r.response()?.status() }); } catch { } });
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
page.on('pageerror', e => consoleErrors.push('PAGEERROR ' + String(e).slice(0, 200)));

await page.addInitScript(INIT);
if (process.env.NO_HOOK === '1') await page.addInitScript(() => { window.__NO_HOOK = true; });
await cdp.send('Performance.enable');

const meta = { tag: TAG, startedAt: new Date().toISOString(), loadBefore: loadavg(), noHook: process.env.NO_HOOK === '1', samplingIntervalUs: 100 };

await page.goto('http://127.0.0.1:3080', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('button:has-text("设置")', { timeout: 90000 });
await sleep(8000); // fresh page settled before the click (steady state precondition)

const preClick = await page.evaluate(() => ({
  census: window.__H.census(), dialogAncestry: window.__H.dialogAncestry(), wp: window.__H.wpScan(), usage: window.__H.usageProbe(),
  markers: { identity: window.__H.markerIdentity, themeColorAdds: window.__H.themeColorObserver, bodyStyleWrites: window.__H.bodyStyleObserver, tFirstThemeMeta: window.__H.tFirstThemeMeta, tFirstBodyStyleWrite: window.__H.tFirstBodyStyleWrite },
}));

async function openAndMeasure(label) {
  // arm
  await page.evaluate(() => {
    const H = window.__H;
    H.rafOn = true; H.mutOn = true; H.raf = []; H.muts = []; H.longtasks = [];
    H.getComputedStyleCalls = []; H.themeColorObserver = 0; H.tFirstThemeMeta = null; H.tFirstBodyStyleWrite = null;
    H.mark = { click: null, firstDialogNode: null, quiet: null, end: null };
  });
  const censusBefore = await page.evaluate(() => window.__H.census());
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
  await cdp.send('Profiler.start');
  const tClickWall = Date.now();
  await page.evaluate(() => { window.__H.mark.click = performance.now(); });
  if (NOTIFY_ON_CLICK) await new Promise(r => setTimeout(r, 150));
  await page.locator('button:has-text("设置")').first().click({ timeout: 8000 });

  // detect first dialog insertion via MutationObserver, then settle
  const settle = await page.evaluate(async () => {
    const H = window.__H; const t0 = performance.now();
    const MAXW = 15000, QUIET = 700;
    let tFirst = null, last = performance.now(), lastN = H.muts.length;
    while (performance.now() - t0 < MAXW) {
      await new Promise(r => requestAnimationFrame(r));
      if (tFirst === null && H.muts.some(m => m.target === 'DIV' || m.target === 'BODY') && document.querySelector('div[role=dialog][aria-modal=true]')) {
        tFirst = performance.now(); H.mark.firstDialogNode = tFirst;
      }
      if (H.muts.length !== lastN) { lastN = H.muts.length; last = performance.now(); }
      else if (performance.now() - last >= QUIET) break;
    }
    H.mark.quiet = performance.now();
    return { t0, tFirst: H.mark.firstDialogNode, quiet: H.mark.quiet, muts: H.muts.length, elapsed: performance.now() - t0 };
  });
  const tSettleWall = Date.now();
  const prof = await cdp.send('Profiler.stop');
  const after = await page.evaluate(() => {
    const r3 = x => (x == null || !isFinite(x)) ? null : Math.round(x * 1000) / 1000;
    const H = window.__H; H.rafOn = false; H.mutOn = false; H.mark.end = performance.now();
    const raf = H.raf.slice(); const d = raf.slice(1).map((t, i) => r3(t - raf[i]));
    return {
      census: H.census(), dialogAncestry: H.dialogAncestry(), wp: H.wpScan(), usage: H.usageProbe(),
      marks: H.mark, fn: H.fn, muts: H.muts.length, mutHead: H.muts.slice(0, 6), mutTail: H.muts.slice(-6),
      rafN: raf.length, raf: d, longtasks: H.longtasks.slice(0, 40),
      gcs: H.getComputedStyleCalls, markers: { themeColorAdds: H.themeColorObserver, bodyStyleWrites: H.bodyStyleObserver, tFirstThemeMeta: H.tFirstThemeMeta, tFirstBodyStyleWrite: H.tFirstBodyStyleWrite, themeColorMetaNodes: document.querySelectorAll('meta[name=theme-color]').length },
      stackTrap: { calls: H.stackTrap.calls, samples: H.stackTrap.samples.slice(0, 6) },
      wpKeys: Object.keys(H.wp),
    };
  });
  return { label, censusBefore, settle, after, prof, wallMs: { toClick: tClickWall, toQuiet: tSettleWall, clickToQuiet: tSettleWall - tClickWall } };
}

const phases = [];
phases.push(await openAndMeasure('first-open'));

// close (ESC first, then explicit close button) and reopen for the steady-state comparison
await page.keyboard.press('Escape'); await sleep(1200);
let closed = (await page.locator('div[role=dialog][aria-modal=true]').count()) === 0;
if (!closed) {
  const l = page.locator('div[role=dialog][aria-modal=true] button:has-text("关闭")').first();
  if (await l.count()) { try { await l.click({ timeout: 3000 }); await sleep(800); } catch { } }
  closed = (await page.locator('div[role=dialog][aria-modal=true]').count()) === 0;
}
const closedState = { escOrButtonClosed: closed, dialogCount: await page.locator('div[role=dialog][aria-modal=true]').count() };
await sleep(3000);
if (closed) phases.push(await openAndMeasure('reopen'));

const loadAfter = loadavg();
const loadMid = { mid: loadavg() };

// slim the profiles so the JSON stays reviewable but keeps samples/timeDeltas/nodes
const slimProf = p => ({ nodes: p.profile.nodes, startTime: p.profile.startTime, endTime: p.profile.endTime, samples: p.profile.samples, timeDeltas: p.profile.timeDeltas });

const out = {
  meta, preClick, closedState, loadAfter,
  phases: phases.map(p => ({
    label: p.label, wallMs: p.wallMs, censusBefore: p.censusBefore, settle: p.settle,
    census: p.after.census, dialogAncestry: p.after.dialogAncestry, wp: p.after.wp, usage: p.after.usage,
    marks: p.after.marks, fn: p.after.fn, muts: p.after.muts, mutHead: p.after.mutHead, mutTail: p.after.mutTail,
    rafN: p.after.rafN, longtasks: p.after.longtasks, gcs: p.after.gcs, markers: p.after.markers,
    stackTrap: p.after.stackTrap, raf: p.after.raf,
  })),
  net, consoleErrors,
};
fs.writeFileSync(RAW + `probe2-${TAG}.json`, JSON.stringify(out, null, 2));
phases.forEach(p => fs.writeFileSync(RAW + `cpuprofile2-${TAG}-${p.label}.json`, JSON.stringify(slimProf(p.prof))));

const who = await page.evaluate(() => ({ hook: !!window.__REACT_DEVTOOLS_GLOBAL_HOOK__, noHook: window.__NO_HOOK === true, react: Object.keys(window).filter(k => /^__REACT/.test(k)) }));
console.log('=== META ===', JSON.stringify({ meta, who, loadAfter, closedState }));
for (const p of out.phases) {
  console.log(`\n=== PHASE ${p.label} ===`);
  console.log('wall', JSON.stringify(p.wallMs), 'settle', JSON.stringify(p.settle));
  console.log('censusBefore', JSON.stringify(p.censusBefore));
  console.log('census', JSON.stringify(p.census));
  console.log('markers', JSON.stringify(p.markers), 'themeColorMeta content', p.census.themeMetaContent);
  console.log('muts', p.muts, 'rafN', p.rafN, 'longtasks', p.longtasks.length, JSON.stringify(p.longtasks.slice(0, 6)));
  console.log('fn', JSON.stringify(p.fn, null, 1));
  console.log('gcs first calls', JSON.stringify(p.gcs.slice(0, 4), null, 1));
  console.log('usage', JSON.stringify(p.usage), '\nwp', JSON.stringify(p.wp));
  console.log('stackTrap', JSON.stringify(p.stackTrap).slice(0, 400));
}
console.log('=== NET (first 40) ===', JSON.stringify(net.slice(0, 40)));
console.log('=== ERRORS ===', JSON.stringify(consoleErrors.slice(0, 10)));
await browser.close();
