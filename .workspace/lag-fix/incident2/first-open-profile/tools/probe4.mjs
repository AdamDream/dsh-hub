// Probe v4: minimal, bisectable instrumentation. Groups selectable via window.__GROUPS so we can find
// exactly which interception is safe. Every wrapper is a plain data-property override; nothing proxies.
import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import os from 'node:os';

const ROOT = '/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/first-open-profile';
const RAW = ROOT + '/raw/';
fs.mkdirSync(RAW, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const r3 = x => (x == null || !isFinite(x)) ? null : Math.round(x * 1000) / 1000;
const loadavg = () => { const l = os.loadavg(); return { l1: r3(l[0]), l5: r3(l[1]), l15: r3(l[2]), cpus: os.cpus().length }; };
const TAG = process.argv[2] || 'v4';
const GROUPS = (process.argv[3] || 'none').split(',');

const INIT = ({ GROUPS }) => {
  const r3 = x => (x == null || !isFinite(x)) ? null : Math.round(x * 1000) / 1000;
  const H = {
    groups: GROUPS, fn: {}, wrapReport: [], raf: [], rafOn: false, muts: [], mutOn: false, longtasks: [],
    gcs: [], marks: {}, captures: {}, stackTrap: { calls: 0 }, metaAdds: 0, tFirstMetaAdd: null,
  };
  window.__H = H;
  const has = g => GROUPS.includes(g) || GROUPS.includes('all');

  const origPrepare = Error.prepareStackTrace;
  Error.prepareStackTrace = function (err, frames) {
    H.stackTrap.calls++;
    if (!H.stackTrap.samples) H.stackTrap.samples = [];
    if (H.stackTrap.samples.length < 40) H.stackTrap.samples.push(frames.slice(0, 9).map(f => ({ fn: f.getFunctionName() || null, file: f.getFileName() || '', line: f.getLineNumber() })));
    return origPrepare ? origPrepare(err, frames) : frames.map(f => '    at ' + (f.getFunctionName() || '<anon>') + ' (' + f.getFileName() + ':' + f.getLineNumber() + ')').join('\n');
  };
  H.stackTrapSelfTest = () => { const b = H.stackTrap.calls; try { void (new Error('x').stack); } catch (e) { } return { before: b, after: H.stackTrap.calls, fired: H.stackTrap.calls > b }; };
  H.cap = (key, extra) => {
    try {
      const st = String(new Error('cap').stack).split('\n').slice(1, 9).map(l => l.trim().slice(0, 170));
      if (!H.captures[key]) H.captures[key] = { n: 0, stacks: [] };
      H.captures[key].n++;
      if (H.captures[key].stacks.length < 5) H.captures[key].stacks.push({ extra: extra || null, stack: st });
    } catch (e) { }
  };
  function ownKey(o, name) { let x = o; while (x) { if (Object.prototype.hasOwnProperty.call(x, name)) return { holder: x, desc: Object.getOwnPropertyDescriptor(x, name) }; x = Object.getPrototypeOf(x); } return null; }
  H.wrap = function (target, name, key, opts) {
    opts = opts || {};
    const rec = ownKey(target, name);
    if (!rec || typeof rec.desc.value !== 'function' || rec.desc.get) { const r = { key, ok: false, why: rec ? (rec.desc.get ? 'accessor' : 'not-fn') : 'not-found' }; H.wrapReport.push(r); return r; }
    const orig = rec.desc.value;
    const state = H.fn[key] = { n: 0, ms: 0, max: 0, errors: 0, holder: rec.holder === target ? 'own' : ((rec.holder.constructor && rec.holder.constructor.name) || 'proto'), origName: orig.name };
    const wrapper = function () {
      const t = performance.now(); let threw = false;
      try { return orig.apply(this, arguments); }
      catch (e) { threw = true; state.errors++; throw e; }
      finally {
        const d = performance.now() - t; state.n++; state.ms += d; if (d > state.max) state.max = d;
        if (opts.capIf && opts.capIf(state, d)) H.cap(key, { d: r3(d), n: state.n, args: arguments.length });
      }
    };
    try { Object.defineProperty(rec.holder, name, { configurable: true, writable: true, enumerable: rec.desc.enumerable, value: wrapper }); }
    catch (e) { const r = { key, ok: false, why: 'define:' + e.message }; H.wrapReport.push(r); return r; }
    const r = { key, ok: true, holder: state.holder, name: orig.name }; H.wrapReport.push(r); return r;
  };
  const W = (t, n, k, o) => H.wrap(t, n, k, o);

  if (has('dom')) {
    W(Element.prototype, 'getBoundingClientRect', 'Element.getBoundingClientRect', {});
    W(Document.prototype, 'querySelectorAll', 'Document.querySelectorAll', {});
    W(Element.prototype, 'querySelectorAll', 'Element.querySelectorAll', {});
    W(Element.prototype, 'getElementsByTagName', 'Element.getElementsByTagName', {});
    W(Element.prototype, 'appendChild', 'Element.appendChild', {});
    W(Node.prototype, 'appendChild', 'Node.appendChild', {});
    W(Element.prototype, 'setAttribute', 'Element.setAttribute', {});
    W(Element.prototype, 'removeAttribute', 'Element.removeAttribute', {});
  }
  if (has('obj')) {
    W(Object, 'entries', 'Object.entries', { capIf: (s, d) => s.n <= 4 || d > 1.5 });
    W(Object, 'keys', 'Object.keys', { capIf: (s, d) => d > 1.5 });
  }
  if (has('json')) { W(JSON, 'parse', 'JSON.parse', { capIf: (s, d) => d > 2 }); W(JSON, 'stringify', 'JSON.stringify', { capIf: (s, d) => d > 2 }); }
  if (has('net')) {
    // in-flight counter for the settings-window RPCs (client-connection posts them via fetch)
    H.rpc = { started: 0, done: 0, pending: 0, items: [] };
    const f0 = window.fetch;
    Object.defineProperty(window, 'fetch', {
      configurable: true, writable: true, enumerable: true, native: true,
      value: function () {
        const url = String(arguments[0] && arguments[0].url ? arguments[0].url : arguments[0]);
        const isRpc = url.includes('client-request') || /\/(settings|usage|session|plugin|model|workspace)/.test(url);
        if (isRpc) { H.rpc.started++; H.rpc.pending++; H.rpcPending = true; if (H.rpc.items.length < 60) H.rpc.items.push({ url, t: r3(performance.now()), phase: 'start' }); }
        const t = performance.now();
        const pr = f0.apply(this, arguments);
        if (isRpc && pr && typeof pr.then === 'function') {
          return pr.then(v => { H.rpc.done++; H.rpc.pending--; H.rpcPending = H.rpc.pending > 0; const it = H.rpc.items.find(x => x.url === url && x.phase === 'start'); if (it) { it.phase = 'done'; it.ms = r3(performance.now() - t); it.status = v && v.status; } return v; },
            e => { H.rpc.done++; H.rpc.pending--; H.rpcPending = H.rpc.pending > 0; const it = H.rpc.items.find(x => x.url === url && x.phase === 'start'); if (it) { it.phase = 'error'; it.ms = r3(performance.now() - t); } throw e; });
        }
        return pr;
      }
    });
  }
  if (has('raf')) { W(window, 'requestAnimationFrame', 'win.requestAnimationFrame', {}); }
  if (has('cssom')) {
    const gcs = window.getComputedStyle;
    const gcsWrapper = function () {
      const t = performance.now();
      try { return gcs.apply(this, arguments); } finally {
        const d = performance.now() - t;
        const s = H.fn['win.getComputedStyle'] || (H.fn['win.getComputedStyle'] = { n: 0, ms: 0, max: 0, errors: 0 });
        s.n++; s.ms += d; if (d > s.max) s.max = d;
        if (H.gcs.length < 40) { const st = []; try { for (const l of String(new Error('g')).stack.split('\n').slice(2, 8)) st.push(l.trim().slice(0, 170)); } catch (e) { } H.gcs.push({ t: r3(performance.now()), d: r3(d), arg: (arguments[0] && arguments[0].nodeName) || '?', stack: st }); }
      }
    };
    try { Object.defineProperty(window, 'getComputedStyle', { configurable: true, writable: true, enumerable: true, value: gcsWrapper, native: true }); H.gcsPatchMode = 'window-native-true'; }
    catch (e) { H.gcsPatchMode = 'FAILED:' + e.message; }
  }
  H.presenterProbe = { found: null, err: null, loadersPatched: 0, moduleIds: [], tickPatch: 0 };
  // The HTML defines a QUEUE-mode window.__ModuleLoader__ inline and dsh-client-modules later REPLACES
  // it. Both assignments are trapped so `load` is instrumented from the very first registration.
  function armLoader(ml) {
    if (!ml || typeof ml.load !== 'function' || ml.__probePatched) return;
    ml.__probePatched = true;
    H.presenterProbe.loadersPatched++;
    const origLoad = ml.load;
    const patched = function (registration) {
      try {
        if (registration && typeof registration.factory === 'function') {
          if (H.presenterProbe.moduleIds.length < 80) H.presenterProbe.moduleIds.push(registration.id);
          if (registration.id === '@deepseek-ai/dsh-client-ui-layout') {
            const origFactory = registration.factory;
            registration.factory = function (require) {
              let out;
              try { out = origFactory.call(this, require); } catch (e) { H.presenterProbe.err = 'factory:' + e.message; throw e; }
              try { H.presenterProbe.factoryRan = true; wrapUiLayoutExports(out || {}); } catch (e) { H.presenterProbe.err = 'exports:' + e.message; }
              return out;
            };
          }
        }
      } catch (e) { H.loaderPatchError = String(e); }
      return origLoad.call(ml, registration);
    };
    try { ml.load = patched; } catch (e) { try { Object.defineProperty(ml, 'load', { configurable: true, writable: true, value: patched }); } catch (e2) { H.loaderPatchError = 'load:' + e2.message; } }
  }
  H.armLoader = armLoader;
  if (has('logger')) {
    try {
      let cur;
      Object.defineProperty(window, '__ModuleLoader__', {
        configurable: true, enumerable: true,
        get() { return cur; },
        set(v) { cur = v; try { armLoader(v); } catch (e) { H.loaderPollError = String(e); } }
      });
      if (window.__ModuleLoader__) armLoader(window.__ModuleLoader__);
    } catch (e) { H.loaderPollError = 'define:' + e.message; }
    (function tickPatch() { H.presenterProbe.tickPatch++; try { armLoader(window.__ModuleLoader__); } catch (e) { } setTimeout(tickPatch, 2); })();
  }
  // ui-layout exports {LayoutController, apply, inject}. `apply(ctx)` is called by the module loader with
  // the plugin context, and it is where the ThemePresenter is constructed
  // (`const presenter = new ThemePresenter(); presenter.apply(ctx.theme.getTheme())`).
  // Intercepting exports.apply therefore runs BEFORE the page's own theme writes and lets us patch the
  // real presenter instance without changing what the effect does.
  function wrapUiLayoutExports(ex) {
    const orig = ex.apply;
    if (typeof orig !== 'function' || orig.__probeWrapped) return;
    const wrapped = new Proxy(orig, {
      apply(fn, thisArg, args) {
        try {
          const ctx = args[0];
          H.presenterProbe.ctxSeen++;
          H.presenterProbe.ctxShape = ctx && typeof ctx === 'object' ? { hasTheme: !!ctx.theme, hasEffect: typeof ctx.effect, hasOn: typeof ctx.on, hasReflect: !!(ctx.reflect), keys: Object.keys(ctx).slice(0, 14) } : String(ctx);
          if (ctx && typeof ctx === 'object') {
            const t = ctx.theme;
            if (t) {
              const rec = Object.getOwnPropertyDescriptor(t, 'getTheme');
              if (rec && typeof rec.value === 'function' && !t.__probeThemeWrapped) {
                Object.defineProperty(t, '__probeThemeWrapped', { value: true, configurable: true });
                const og = rec.value;
                Object.defineProperty(t, 'getTheme', {
                  configurable: true, writable: true, enumerable: rec.enumerable,
                  value: function () { const out = og.apply(this, arguments); try { H.presenterProbe.getTheme(); if (!H.presenterProbe.getThemeCalls) H.presenterProbe.getThemeCalls = 0; H.presenterProbe.getThemeCalls++; } catch (e) { } return out; }
                });
                H.presenterProbe.themeWrapped = true;
              }
            }
            // Patch on the NEXT microtask too: the effect body creates the presenter synchronously during
            // this call, so a single synchronous attempt on a fresh object graph is enough, but re-trying
            // costs nothing and covers a deferred construction.
            try { patchPresenter(ctx); } catch (e) { H.presenterProbe.err = 'ctxPatch:' + e.message; }
            setTimeout(() => { try { patchPresenter(ctx); } catch (e) { } }, 0);
          }
        } catch (e) { H.presenterProbe.err = 'applyProxy:' + e.message; }
        return Reflect.apply(fn, thisArg, args);
      }
    });
    Object.defineProperty(ex, 'apply', { configurable: true, writable: true, enumerable: true, value: wrapped });
    orig.__probeWrapped = true;
    H.presenterProbe.exportsApplyWrapped = true;
  }
  function patchPresenter(owner) {
    if (!owner || typeof owner !== 'object') return;
    for (const k of Object.getOwnPropertyNames(owner)) {
      let v; try { v = owner[k]; } catch (e) { continue; }
      if (v && typeof v === 'object' && typeof v.apply === 'function' && typeof v.refreshThemeColor === 'function' && v.themeColorMeta) {
        if (!v.__probePatched) {
          Object.defineProperty(v, '__probePatched', { value: true, configurable: true });
          H.presenterProbe.found = { key: k, ctor: (v.constructor && v.constructor.name) || null, metaName: v.themeColorMeta && v.themeColorMeta.name, lastSignatureIn: 'lastSignature' in v, appliedTokens: Array.isArray(v.appliedTokens) ? v.appliedTokens.length : null };
        }
        H.wrap(v, 'apply', 'ThemePresenter.apply', { capIf: (s, d) => s.n <= 8 });
        H.wrap(v, 'refreshThemeColor', 'ThemePresenter.refreshThemeColor', { capIf: (s, d) => s.n <= 8 });
        H.wrap(v, 'landingIntact', 'ThemePresenter.landingIntact', { capIf: (s, d) => s.n <= 8 });
        H.wrap(v, 'dispose', 'ThemePresenter.dispose', {});
      }
    }
  }
  if (has('hook')) {
    // React DevTools global hook. react-dom only calls inject()/onCommitFiberRoot when this exists
    // BEFORE react-dom loads, which document-start init guarantees. Adoption is self-proven by the
    // returned renderer id + the renderer's reported version, and by non-zero commit callbacks.
    const HK = {
      installedAt: performance.now(), injectCalls: 0, renderers: [], onCommitCalls: 0, onPostCommitCalls: 0,
      commits: [], fiberSets: new WeakMap(), firstCommitAt: null,
    };
    H.hook = HK;
    H.hookSelfTest = () => {
      const b = H.stackTrap.calls; try { void (new Error('x').stack); } catch (e) { }
      return { stackTrapFired: H.stackTrap.calls > b, injectCalls: HK.injectCalls, renderers: HK.renderers, onCommitCalls: HK.onCommitCalls, onPostCommitCalls: HK.onPostCommitCalls, reactDomGlobal: !!window.ReactDOM, hookSeenByPage: !!window.__REACT_DEVTOOLS_GLOBAL_HOOK__ };
    };
    function typeName(f) { const t = f.type || f.elementType; if (t == null) return f.tag === 6 ? '#text' : '?'; if (typeof t === 'string') return t; if (typeof t === 'function') return t.displayName || t.name || 'anon'; if (typeof t === 'object') return t.displayName || (t.render && (t.render.displayName || t.render.name)) || 'obj'; return String(t); }
    function walk(root) { const out = []; const st = [root]; while (st.length) { const f = st.pop(); if (!f) continue; out.push(f); if (f.child) st.push(f.child); if (f.sibling) st.push(f.sibling); if (out.length > 120000) break; } return out; }
    const hook = {
      renderers: new Map(), supportsFiber: true, supportsFlight: true,
      inject(internals) {
        HK.injectCalls++;
        const id = HK.injectCalls; hook.renderers.set(id, internals);
        HK.renderers.push({ id, version: internals && internals.version, rendererPackageName: internals && internals.rendererPackageName, hasCommit: typeof (internals && internals.onCommitFiberRoot) === 'function', hasScheduleRefresh: typeof (internals && internals.scheduleRefresh) === 'function' });
        return id;
      },
      onCommitFiberRoot(rendererID, root) {
        HK.onCommitCalls++;
        try {
          const t = r3(performance.now()); if (HK.firstCommitAt === null) HK.firstCommitAt = t;
          const nodes = walk(root.current);
          let prev = HK.fiberSets.get(root); let fresh = 0;
          if (prev) { for (const f of nodes) if (!prev.has(f)) fresh++; } else fresh = nodes.length;
          HK.fiberSets.set(root, new Set(nodes));
          let fnCount = 0; for (const f of nodes) if (typeof f.type === 'function') fnCount++;
          const dlg = document.querySelector('div[role=dialog][aria-modal=true]');
          HK.commits.push({ t, n: HK.commits.length, total: nodes.length, fresh, fnCount, dialog: !!dlg, dlgNodes: dlg ? dlg.getElementsByTagName('*').length : 0 });
        } catch (e) { HK.err = String(e); }
      },
      onPostCommitFiberRoot() { HK.onPostCommitCalls++; },
      onCommitFiberUnmount() { }, checkDCE() { }, setStrictMode() { }, getFiberRoots() { return new Set(); },
    };
    if (window.__NO_HOOK !== true) window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;
    H.hookReset = () => { HK.commits = []; HK.onCommitCalls = 0; HK.onPostCommitCalls = 0; HK.firstCommitAt = null; return true; };
  }
  (function loop(t) { if (H.rafOn) H.raf.push(r3(t)); requestAnimationFrame(loop); })(0);
  try { new PerformanceObserver(l => l.getEntries().forEach(e => H.longtasks.push({ start: r3(e.startTime), dur: r3(e.duration), name: e.name }))).observe({ entryTypes: ['longtask'] }); } catch (e) { }
  try { new MutationObserver(rs => { if (H.mutOn) for (const r of rs) H.muts.push({ t: r3(performance.now()), type: r.type, target: r.target.nodeName }); }).observe(document, { childList: true, subtree: true, attributes: true, characterData: true }); } catch (e) { }
  try { new MutationObserver(rs => { for (const r of rs) for (const n of r.addedNodes) if (n.nodeType === 1 && n.tagName === 'META' && n.name === 'theme-color') { H.metaAdds++; if (H.tFirstMetaAdd == null) H.tFirstMetaAdd = r3(performance.now()); } }).observe(document.documentElement || document, { childList: true, subtree: true }); } catch (e) { }

  H.census = () => {
    const d = document.querySelector('div[role=dialog][aria-modal=true]');
    return {
      nodes: document.getElementsByTagName('*').length, svg: document.getElementsByTagName('svg').length,
      rect: document.getElementsByTagName('rect').length, path: document.getElementsByTagName('path').length,
      metaThemeColor: document.querySelectorAll('meta[name=theme-color]').length,
      dialogPresent: !!d, dialogNodes: d ? d.getElementsByTagName('*').length : 0, dialogSvg: d ? d.getElementsByTagName('svg').length : 0,
      dialogTextLen: d ? (d.innerText || '').length : 0,
      bodyStyleLen: document.body ? document.body.style.length : null,
      sheets: document.styleSheets.length, styleTags: document.querySelectorAll('style').length,
      themeMetaContent: (document.querySelector('meta[name=theme-color]') || {}).content ?? null,
      colorScheme: document.documentElement.style.colorScheme,
    };
  };
  H.dialogAncestry = () => { const d = document.querySelector('div[role=dialog][aria-modal=true]'); if (!d) return null; const o = []; let n = d; while (n && n.nodeType === 1) { o.push({ tag: n.tagName.toLowerCase(), cls: (n.className || '').toString().slice(0, 40), role: n.getAttribute('role'), own: n.getElementsByTagName('*').length }); if (n === document.body) break; n = n.parentElement; } return o; };
  H.snap = () => ({ census: H.census(), ancestry: H.dialogAncestry(), wrapReport: H.wrapReport, gcsPatchMode: H.gcsPatchMode, presenterProbe: H.presenterProbe, fn: H.fn, stackTrapCalls: H.stackTrap.calls });
};
// ------------------------------------------------------------------ end INIT

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-precise-memory-info'] });
const results = { meta: { tag: TAG, groups: GROUPS, startedAt: new Date().toISOString(), loadBefore: loadavg() }, runs: [], loadAfter: null };

async function oneRun(kind) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const net = [], errs = [];
  page.on('requestfinished', async r => { try { const t = r.timing(); net.push({ url: r.url().replace('http://127.0.0.1:3080', '').split('?')[0], ms: r3(t.responseEnd - t.requestStart), status: r.response()?.status() }); } catch { } });
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
  page.on('pageerror', e => errs.push('PAGEERROR ' + String(e).slice(0, 160)));
  await page.addInitScript(INIT, { GROUPS });
  if (process.env.NO_HOOK === '1') await page.addInitScript(() => { window.__NO_HOOK = true; });

  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
  await page.goto('http://127.0.0.1:3080', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('button:has-text("设置")', { timeout: 90000 });
  const tBtn = Date.now();
  if (kind === 'settled' || kind === 'immediate-then-first') await sleep(8000);
  const bootSnap = await page.evaluate(() => window.__H.snap());
  const snap0 = await page.evaluate(() => { const H = window.__H; for (const k of Object.keys(H.fn)) { H.fn[k].n0 = H.fn[k].n; H.fn[k].ms0 = H.fn[k].ms; } H.rafOn = true; H.mutOn = true; H.raf = []; H.muts = []; H.longtasks = []; H.gcs = []; H.captures = {}; H.metaAdds = 0; H.tFirstMetaAdd = null; H.mark = { click: null, dialog: null, quiet: null, end: null }; if (H.hookReset) H.hookReset(); return { t: performance.now(), census: window.__H.census() }; });
  await cdp.send('Profiler.start');
  const t0 = Date.now();
  const res = await page.evaluate(() => { window.__H.mark.click = performance.now(); });
  await page.locator('button:has-text("设置")').first().click({ timeout: 8000 });
  // Window end = the visibility-aware "panel is stable" condition:
  //   (a) the dialog exists,
  //   (b) NO DOM mutation for QUIET ms,
  //   (c) AND no settings-window RPC is still in flight (an RPC-bound stall shows no DOM mutations,
  //       so a mutation-only detector would end the window before the expensive work lands).
  // It never ends before MINW so that late work caused by an RPC response is inside the profile.
  const settle = await page.evaluate(async () => {
    const H = window.__H; const t0 = performance.now();
    const MAXW = 6000, QUIET = 700, MINW = 0;
    let firstDialog = null, last = performance.now(), lastN = H.muts.length;
    const txt = () => { const d = document.querySelector('div[role=dialog][aria-modal=true]'); return d ? (d.innerText || '').length : -1; };
    let lastTxt = txt(), lastTxtAt = performance.now();
    H.step = 'start';
    try {
      while (performance.now() - t0 < MAXW) {
        H.step = 'raf'; await new Promise(r => requestAnimationFrame(r));
        H.step = 'qsa'; const d = document.querySelector('div[role=dialog][aria-modal=true]');
        H.step = 'mark'; if (firstDialog === null && d) { firstDialog = performance.now(); H.mark.dialog = firstDialog; }
        H.step = 'count';
        if (H.muts.length !== lastN) { lastN = H.muts.length; last = performance.now(); }
        const ct = txt(); if (ct !== lastTxt) { lastTxt = ct; lastTxtAt = performance.now(); }
        const elapsed = performance.now() - t0;
        const quietMs = Math.max(performance.now() - last, performance.now() - lastTxtAt);
        H.quietMs = quietMs;
        if (elapsed >= MINW && firstDialog !== null && quietMs >= QUIET) break;
      }
    } catch (e) { return { err: String(e && e.message), step: H.step }; }
    H.mark.quiet = performance.now();
    H.postQuiet = { dialogTextLen: txt(), muts: H.muts.length, rpcPending: !!H.rpcPending };
    return { t0, firstDialog, quiet: H.mark.quiet, muts: H.muts.length, elapsed: performance.now() - t0, step: H.step, dialogTextLen: txt(), rpcPending: !!H.rpcPending };
  });
  const tQuiet = Date.now();
  const tail = await page.evaluate(async () => { const H = window.__H; const t = performance.now(); await new Promise(r => setTimeout(r, 1200)); return { ms: performance.now() - t, mutsAfterQuiet: H.muts.length, rpcPending: !!H.rpcPending, dialogTextLen: (document.querySelector('div[role=dialog][aria-modal=true]') || {}).innerText ? document.querySelector('div[role=dialog][aria-modal=true]').innerText.length : -1 }; });
  const prof = await cdp.send('Profiler.stop');
  const after = await page.evaluate(() => {
    const r3 = x => (x == null || !isFinite(x)) ? null : Math.round(x * 1000) / 1000;
    const H = window.__H; H.rafOn = false; H.mutOn = false; H.mark.end = performance.now();
    const raf = H.raf.slice(); const d = raf.slice(1).map((t, i) => r3(t - raf[i]));
    const srt = d.slice().sort((a, b) => a - b); const q = p => srt.length ? r3(srt[Math.min(srt.length - 1, Math.floor((srt.length - 1) * p))]) : null;
    const fnDelta = {}; for (const k of Object.keys(H.fn)) { const s = H.fn[k]; fnDelta[k] = { n: s.n - (s.n0 || 0), ms: r3(s.ms - (s.ms0 || 0)), max: r3(s.max), holder: s.holder, errors: s.errors }; }
    return {
      marks: H.mark, census: H.census(), ancestry: H.dialogAncestry(),
      muts: H.muts.length, mutHead: H.muts.slice(0, 5), mutTail: H.muts.slice(-5),
      rafN: raf.length, rafP50: q(.5), rafP95: q(.95), rafMax: srt.length ? r3(srt[srt.length - 1]) : null, rafOver50: d.filter(x => x > 50).length,
      longtasks: H.longtasks.slice(0, 40), gcs: H.gcs.slice(0, 25), metaAdds: H.metaAdds, tFirstMetaAdd: H.tFirstMetaAdd,
      captures: H.captures, presenterProbe: H.presenterProbe, wrapReport: H.wrapReport, gcsPatchMode: H.gcsPatchMode, rpc: H.rpc, postQuiet: H.postQuiet, hook: H.hook ? { injectCalls: H.hook.injectCalls, renderers: H.hook.renderers, onCommitCalls: H.hook.onCommitCalls, onPostCommitCalls: H.hook.onPostCommitCalls, commitCount: H.hook.commits.length, commits: H.hook.commits, firstCommitAt: H.hook.firstCommitAt, err: H.hook.err } : null,
      stackTrapCalls: H.stackTrap.calls, stackSamples: (H.stackTrap.samples || []).slice(0, 12), fnDelta,
    };
  });
  const hookInfo = await page.evaluate(() => ({ hook: !!window.__REACT_DEVTOOLS_GLOBAL_HOOK__, noHook: window.__NO_HOOK === true }));
  await ctx.close();
  const durMs = tQuiet - t0;
  return {
    kind, prof: { nodes: prof.profile.nodes, startTime: prof.profile.startTime, endTime: prof.profile.endTime, samples: prof.profile.samples, timeDeltas: prof.profile.timeDeltas },
    wall: { btnToClick: t0 - tBtn, clickToQuietMs: durMs, profDurMs: r3((prof.profile.endTime - prof.profile.startTime) / 1000) }, tail,
    bootSnap, snap0, settle, after, hookInfo, net, errs,
  };
}

for (const kind of (process.env.KINDS || 'settled').split(',')) results.runs.push(await oneRun(kind));
results.loadAfter = loadavg();
fs.writeFileSync(RAW + `probe4-${TAG}.json`, JSON.stringify(results, null, 2));
results.runs.forEach((r, i) => fs.writeFileSync(RAW + `probe4-${TAG}-run${i}.profile.json`, JSON.stringify({ kind: r.kind, ...r.prof })));

// report
console.log('META', JSON.stringify({ tag: TAG, groups: GROUPS, loadBefore: results.meta.loadBefore, loadAfter: results.loadAfter }));
for (const [i, r] of results.runs.entries()) {
  console.log(`\n#### run${i} kind=${r.kind} wall=${JSON.stringify(r.wall)}`);
  console.log(' bootSnap', JSON.stringify({ wrap: r.bootSnap.wrapReport, gcsMode: r.bootSnap.gcsPatchMode, presenter: r.bootSnap.presenterProbe, stackCalls: r.bootSnap.stackTrapCalls, fn: r.bootSnap.fn }));
  console.log(' settle', JSON.stringify(r.settle));
  console.log(' cube', JSON.stringify(r.after.census), 'metaAdds', r.after.metaAdds, 'tFirstMetaAdd', r.after.tFirstMetaAdd);
  console.log(' raf', JSON.stringify({ n: r.after.rafN, p50: r.after.rafP50, p95: r.after.rafP95, max: r.after.rafMax, over50: r.after.rafOver50 }), 'lt', r.after.longtasks.length, 'muts', r.after.muts);
  console.log(' fnDelta', JSON.stringify(r.after.fnDelta));
  console.log(' gcs', JSON.stringify(r.after.gcs.slice(0, 6)).slice(0, 1400));
  console.log(' captures', JSON.stringify(r.after.captures).slice(0, 1600));
  console.log(' presenter', JSON.stringify(r.after.presenterProbe));
  console.log(' HOOK', JSON.stringify(r.after.hook ? { injectCalls: r.after.hook.injectCalls, renderers: r.after.hook.renderers, onCommitCalls: r.after.hook.onCommitCalls, onPostCommitCalls: r.after.hook.onPostCommitCalls, commitCount: r.after.hook.commitCount, firstCommitAt: r.after.hook.firstCommitAt } : null));
  console.log(' COMMITS', JSON.stringify(r.after.hook ? r.after.hook.commits : null));
  console.log(' tail', JSON.stringify(r.tail), 'rpc', JSON.stringify(r.after.rpc).slice(0, 900), 'postQuiet', JSON.stringify(r.after.postQuiet));
  console.log(' errs', JSON.stringify(r.errs.slice(0, 6)));
}
await browser.close();
