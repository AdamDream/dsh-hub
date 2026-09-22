/*
 * inpage-probe.js — in-page instrumentation for the "why only these two" comparison.
 * Installed via Playwright addInitScript so it runs BEFORE any app code.
 *
 * READ-ONLY: it never writes product state; it only observes.
 * It patches window.fetch / XMLHttpRequest / WebSocket to record RPC traffic,
 * installs a rAF frame recorder, LongTask + LoAF PerformanceObservers, a
 * document-level capture listener for real input timestamps, a MutationObserver
 * based "settle" detector, and a minimal React DevTools hook so commit /
 * unmount counts (=> "whole panel remount") can be measured.
 */
(() => {
  if (window.__PROBE) return;
  // Catch uncaught init-time errors so a partial install is diagnosable.
  try { window.addEventListener('error', (e) => { if (!window.__PROBE_INIT_ERROR) window.__PROBE_INIT_ERROR = String(e.message) + ' | ' + String(e.filename || '').slice(-40) + ':' + e.lineno + ':' + e.colno; }); } catch {}
  const now = () => performance.now();
  const P = {
    installedAt: now(),
    nav: { ua: navigator.userAgent, dpr: window.devicePixelRatio, langs: navigator.languages },
    frames: [],          // rAF timestamps
    longtasks: [],       // {start,dur,name}
    loaf: [],            // long-animation-frame
    rpcs: [],            // capture of RPC traffic
    inputs: [],          // real input events (capture phase)
    errors: [],
    arms: [],            // arm/visible measurements
    commits: [],         // react commits {t, fibers, unmountsSince}
    fiberUnmountCalls: [],
    reactRenderers: 0,
    globalsSeen: null
  };
  window.__PROBE = P;

  // Defensive stubs: replaced by the real implementations below; they exist so a
  // later init-time throw leaves a diagnosable API instead of "is not a function".
  window.__census = () => ({ error: window.__PROBE_INIT_ERROR || 'init incomplete' });
  window.__phase = () => ({ error: window.__PROBE_INIT_ERROR || 'init incomplete' });
  window.__sincePhase = () => ({ error: window.__PROBE_INIT_ERROR || 'init incomplete' });
  window.__block = (ms) => { const t = performance.now(); while (performance.now() - t < ms) { /* spin */ } return performance.now() - t; };

  // ------------------------------------------------------------------ frames
  let rafCount = 0;
  function tick(ts) { P.frames.push(ts); rafCount++; requestAnimationFrame(tick); }
  requestAnimationFrame(tick);

  // ---------------------------------------------------- longtask + LoAF (CDP-free)
  P.channels = {};
  try {
    const po = new PerformanceObserver((l) => {
      for (const e of l.getEntries()) P.longtasks.push({ start: e.startTime, dur: e.duration, name: e.name });
    });
    po.observe({ type: 'longtask', buffered: true });
    P.channels.longtask = 'on';
  } catch (e) { P.channels.longtask = 'ERR:' + String(e); }
  try {
    const po2 = new PerformanceObserver((l) => {
      for (const e of l.getEntries()) P.loaf.push({
        start: e.startTime, dur: e.duration,
        renderStart: e.renderStart, styleAndLayoutStart: e.styleAndLayoutStart,
        blockingDur: e.blockingDuration,
        scripts: (e.scripts || []).map((s) => ({ dur: s.duration, src: s.sourceURL ? String(s.sourceURL).slice(-60) : null, fn: s.sourceFunctionName || null })),
        invoker: e.invoker || null
      });
    });
    po2.observe({ type: 'long-animation-frame', buffered: true });
    P.channels.loaf = 'on';
  } catch (e) { P.channels.loaf = 'ERR:' + String(e); }
  try {
    const po3 = new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        P.channels.eventTimingSeen = (P.channels.eventTimingSeen || 0) + 1;
      }
    });
    po3.observe({ type: 'event', buffered: true, durationThreshold: 16 });
    P.channels.event = 'on';
  } catch (e) { P.channels.event = 'ERR:' + String(e); }

  // ------------------------------------------------------------------- RPCs
  const RPC_URL = /\/api\//;
  const bodyPeek = (b) => {
    try {
      if (typeof b === 'string') return JSON.parse(b);
      if (b && typeof b === 'object' && !(b instanceof FormData) && !(b instanceof Blob)) return b;
    } catch (e) { /* ignore */ }
    return null;
  };
  function recRpc(o) { P.rpcs.push(o); }

  const _fetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (!RPC_URL.test(url)) return _fetch.apply(this, arguments);
    const t0 = now();
    const body = bodyPeek(init && init.body) || bodyPeek(input && input.body);
    const p = _fetch.apply(this, arguments);
    if (p && typeof p.then === 'function') {
      return p.then((res) => {
        const t1 = now();
        recRpc({ transport: 'fetch', url, method: (body && body.method) || null, type: (body && body.type) || null,
                 rpcId: (body && body.rpcId) || null, start: t0, end: t1, dur: t1 - t0, status: res.status,
                 len: Number(res.headers.get('content-length') || 0) || null });
        return res;
      }, (err) => {
        const t1 = now();
        recRpc({ transport: 'fetch', url, method: (body && body.method) || null, start: t0, end: t1, dur: t1 - t0, error: String(err) });
        throw err;
      });
    }
    return p;
  };

  const _open = XMLHttpRequest.prototype.open;
  const _send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__probe = { m, u, t0: null }; return _open.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function (b) {
    const st = this.__probe;
    if (st && RPC_URL.test(String(st.u))) {
      const t0 = now(); st.t0 = t0;
      const body = bodyPeek(b);
      this.addEventListener('loadend', () => {
        const t1 = now();
        recRpc({ transport: 'xhr', url: st.u, method: (body && body.method) || null, rpcId: (body && body.rpcId) || null,
                 start: t0, end: t1, dur: t1 - t0, status: this.status });
      });
    }
    return _send.apply(this, arguments);
  };

  const _WS = window.WebSocket;
  if (_WS) {
    const WS = function (url, protocols) {
      const ws = protocols === undefined ? new _WS(url) : new _WS(url, protocols);
      const pending = new Map();
      ws.addEventListener('message', (ev) => {
        if (typeof ev.data !== 'string') return;
        try {
          const j = JSON.parse(ev.data);
          const id = j.rpcId || (j.type === 'client-response' && j.rpcId);
          if (id && pending.has(id)) {
            const o = pending.get(id); pending.delete(id);
            const t1 = now();
            o.end = t1; o.dur = t1 - o.start; o.ok = j.ok !== false;
            recRpc(o);
          }
        } catch (e) { /* ignore */ }
      });
      const _s = ws.send.bind(ws);
      ws.send = function (data) {
        try {
          const j = JSON.parse(data);
          if (j && j.method) {
            const o = { transport: 'ws', method: j.method, rpcId: j.rpcId, start: now(), url: ws.url, bytes: data.length };
            pending.set(j.rpcId, o);
            setTimeout(() => { if (pending.has(j.rpcId)) { pending.delete(j.rpcId); o.end = now(); o.dur = o.end - o.start; o.timeout = true; recRpc(o); } }, 30000);
          }
        } catch (e) { /* ignore */ }
        return _s.apply(this, arguments);
      };
      return ws;
    };
    WS.prototype = _WS.prototype;
    ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach((k) => { try { WS[k] = _WS[k]; } catch (e) {} });
    window.WebSocket = WS;
  }

  // ------------------------------------------------------- real-input timestamps
  ['pointerdown', 'mousedown', 'click', 'wheel', 'keydown'].forEach((type) => {
    document.addEventListener(type, (ev) => {
      const t = ev.target;
      let sel = null;
      try {
        if (t && t.tagName) {
          const cls = (t.className && typeof t.className === 'string') ? '.' + t.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
          sel = t.tagName.toLowerCase() + cls;
        }
      } catch (e) {}
      P.inputs.push({ type, t: now(), sel, dy: ev.deltaY || 0 });
    }, true);
  });

  // ------------------------------------------------------------- settle detector
  // A MutationObserver over the settings content region. Arm() records the
  // first mutation and the first "quiescent" rAF (<2 consecutive rAFs with no
  // mutation), so click -> first-change and click -> settled are both measured
  // entirely in the page timebase.
  const S = { arm: null, dirtySince: 0, mutCount: 0, lastMut: 0, quiet: 0, obs: null, obsTarget: null };
  P.settle = S;
  function ensureObs() {
    const t = document.querySelector('div[class$="_options"]') ||
              document.querySelector('div.VOzbGW_panel') || document.body || document.documentElement;
    if (!t) return;
    if (S.obsTarget !== t) {
      try {
        if (S.obs) S.obs.disconnect();
        S.obsTarget = t;
        S.obs = new MutationObserver((recs) => {
          S.mutCount += recs.length;
          S.lastMut = now();
          if (S.arm && S.arm.tFirstMut === null) S.arm.tFirstMut = S.lastMut;
          if (S.arm) S.arm.muts += recs.length;
        });
        S.obs.observe(t, { childList: true, subtree: true, attributes: true, characterData: true });
      } catch (e) { P.obsError = String(e); }
    }
  }
  // NOTE: an init script runs BEFORE the document exists, so documentElement is
  // null here -- observe() must be deferred, not called eagerly.
  const mo = new MutationObserver(() => { ensureObs(); });
  const startMo = () => { try { mo.observe(document.documentElement, { childList: true, subtree: true }); } catch (e) { P.moError = String(e); } };
  if (document.documentElement) startMo();
  else document.addEventListener('DOMContentLoaded', startMo, { once: true });

  (function settleLoop() {
    requestAnimationFrame(() => {
      ensureObs();
      for (const a of P.arms) {
        if (a.done) continue;
        const n = now();
        // do not let the window close before the driving input has landed
        if (n < a.tArm + (a.floorMs || 120)) continue;
        if (a.tFirstMut === null && S.lastMut > a.tArm) a.tFirstMut = S.lastMut;
        if (a.tFirstMut !== null && n - S.lastMut >= 2 * (a.frameHint || 16.7)) {
          a.tSettled = S.lastMut; a.done = true; a.settleDelay = n - a.tArm;
        }
        if (n - a.tArm > 8000 && !a.done) { a.tSettled = S.lastMut; a.done = true; a.timedOut = true; }
      }
      settleLoop();
    });
  })();

  // arm marks the start of a measured interaction; the *marker* is the last real
  // input timestamp at or before arm time (so t0 is the true input time).
  window.__PROBE.arm = function (label, opts) {
    const t = now();
    let tInput = t;
    for (let i = P.inputs.length - 1; i >= 0; i--) { if (P.inputs[i].t <= t + 2) { tInput = P.inputs[i].t; break; } }
    const a = Object.assign({ label, tArm: t, tInput, tFirstMut: null, tSettled: null, done: false,
                              muts: 0, frameHint: 16.7, baseRpc: P.rpcs.length, baseLt: P.longtasks.length,
                              baseFrame: P.frames.length, baseCommit: P.commits.length }, opts || {});
    P.arms.push(a);
    return P.arms.length - 1;
  };
  window.__PROBE.armResult = function (idx) {
    const a = P.arms[idx];
    if (!a) return null;
    // T0 = the first real input event at/after arm time (the click/wheel that
    // drives this window). Fall back to arm time if the input never arrived.
    let T = a.tArm, tInputIsInput = false;
    for (let i = 0; i < P.inputs.length; i++) {
      if (P.inputs[i].t >= a.tArm - 1) { T = P.inputs[i].t; tInputIsInput = true; break; }
    }
    a.tInput = T; a.tInputIsInput = tInputIsInput;
    const inWin = (arr, f) => arr.filter((x) => f(x) >= T);
    const frames = inWin(P.frames, (x) => x);
    const deltas = [];
    for (let i = 1; i < frames.length; i++) deltas.push(frames[i] - frames[i - 1]);
    const lt = inWin(P.longtasks, (x) => x.end ?? (x.start + x.dur));
    return {
      label: a.label, tInput: T, tArm: a.tArm, tFirstMut: a.tFirstMut, tSettled: a.tSettled,
      tInputIsInput: a.tInputIsInput,
      timedOut: !!a.timedOut, muts: a.muts,
      clickToFirstChangeMs: a.tFirstMut === null ? null : a.tFirstMut - T,
      clickToSettledMs: a.tSettled === null ? null : a.tSettled - T,
      inputToArmMs: a.tArm - T,
      frames: deltas, nFrames: deltas.length,
      longtasks: lt.map((x) => ({ start: x.start - T, dur: x.dur })),
      rpcs: P.rpcs.slice(a.baseRpc).map((r) => ({ method: r.method, dur: r.dur, start: r.start - T, transport: r.transport, status: r.status })),
      commits: P.commits.slice(a.baseCommit)
    };
  };

  // -------------------------------------------------- React commit/unmount hook
  // Minimal DevTools hook: lets us count React commits, the committed fiber-tree
  // size, and unmounts -- i.e. "did the whole panel remount / redraw" (H5).
  // NOTE: presence of the hook changes React's bookkeeping slightly; it is
  // installed identically for every arm, so comparisons stay like-for-like.
  try {
    let uid = 0;
    const hook = {
      renderers: new Map(),
      supportsFiber: true,
      supportsFlight: true,
      isDisabled: false,
      inject(renderer) { const id = ++uid; hook.renderers.set(id, renderer); P.reactRenderers = hook.renderers.size; return id; },
      onCommitFiberRoot(id, root) {
        let n = 0, performed = 0, functionish = 0;
        try {
          const seen = new Set();
          const stack = [root.current];
          while (stack.length) {
            const f = stack.pop();
            if (!f || seen.has(f)) continue;
            seen.add(f);
            n++;
            // PerformedWork (ReactFiberFlags bit 0) marks a fiber that actually
            // did render work in this commit => "how much re-rendered".
            if (typeof f.flags === 'number' && (f.flags & 1)) performed++;
            const t = f.type;
            if (typeof t === 'function' || (t && typeof t === 'object' && t.$$typeof)) functionish++;
            if (f.child) stack.push(f.child);
            if (f.sibling) stack.push(f.sibling);
            if (seen.size > 200000) break;
          }
        } catch (e) { n = -1; }
        P.commits.push({ t: now(), fibers: n, performed, functionish, unmounts: P.fiberUnmountCalls.length });
      },
      onCommitFiberUnmount(id, fiber) { P.fiberUnmountCalls.push({ t: now(), type: (fiber && (fiber.type && (fiber.type.displayName || fiber.type.name))) || null }); },
      onPostCommitFiberRoot() {},
      checkDCE() {},
      setStrictMode() {},
      emit() {}, sub() { return () => {}; }
    };
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;
  } catch (e) { P.reactHookError = String(e); }

  // ------------------------------------------------------------ error capture
  window.addEventListener('error', (e) => P.errors.push({ t: now(), msg: String(e.message) }));
  window.addEventListener('unhandledrejection', (e) => P.errors.push({ t: now(), msg: 'rej:' + String(e.reason) }));

  // -------------------------------------------------- DOM census (on demand)
  window.__census = function (scopeSel) {
    const scope = scopeSel ? document.querySelector(scopeSel) : document.body;
    const countTextNodes = (root) => {
      let c = 0;
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => (n.nodeValue && n.nodeValue.trim().length ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT)
      });
      while (w.nextNode()) c++;
      return c;
    };
    const nodes = (root) => {
      const all = root.getElementsByTagName('*');
      let svg = 0, svgDeep = 0, path = 0, img = 0, canvas = 0, btns = 0, inputs = 0;
      for (let i = 0; i < all.length; i++) {
        const tag = all[i].tagName.toLowerCase();
        if (tag === 'svg') svg++;
        if (tag === 'path' || tag === 'circle' || tag === 'rect' || tag === 'g' || tag === 'use' || tag === 'line' || tag === 'polyline' || tag === 'polygon' || tag === 'defs' || tag === 'lineargradient' || tag === 'stop') svgDeep++;
        if (tag === 'img') img++;
        if (tag === 'canvas') canvas++;
        if (tag === 'button') btns++;
        if (tag === 'input' || tag === 'select' || tag === 'textarea') inputs++;
      }
      return { domNodes: all.length, svg, svgDeepEls: svgDeep, img, canvas, buttons: btns, inputs, textNodes: countTextNodes(root) };
    };
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
    const panel = document.querySelector('div.VOzbGW_panel');
    const opts = document.querySelector('div[class$="_options"]');
    const navList = document.querySelector('div[class$="_navList"]');
    const scrollables = [];
    if (opts) {
      const all = opts.getElementsByTagName('*');
      for (let i = 0; i < all.length; i++) {
        const el = all[i];
        if (el.scrollHeight > el.clientHeight + 24 && el.clientHeight > 50) {
          scrollables.push({ cls: String(el.className).slice(0, 60), scrollH: el.scrollHeight, clientH: el.clientHeight });
          if (scrollables.length >= 4) break;
        }
      }
    }
    const bg = panel ? getComputedStyle(document.querySelector('div[class$="_mask"]') || panel) : null;
    return {
      doc: nodes(scope),
      panel: panel ? nodes(panel) : null,
      options: opts ? nodes(opts) : null,
      navList: navList ? nodes(navList) : null,
      counts: {
        dialogCount: document.querySelectorAll('[role="dialog"]').length,
        navLabels: [...document.querySelectorAll('div[class$="_navList"] button')].map((b) => (b.textContent || '').trim()),
        tabLabels: [...document.querySelectorAll('button[class$="_tab"]')].map((b) => (b.textContent || '').trim()),
        activeNavLabel: (() => { const b = document.querySelector('button[aria-current="true"] span[class$="_navLabel"]'); return b ? b.textContent : null; })(),
        navCells: document.querySelectorAll('div[class$="_navList"] button').length,
        pluginCards: document.querySelectorAll('li[class$="_card"]').length,
        tabs: document.querySelectorAll('button[class$="_tab"]').length,
        activeTab: (() => { const b = document.querySelector('button[class$="_tab"][data-active="true"]'); return b ? b.textContent : null; })(),
        imgBytesRefs: Array.from(document.images).map((i) => ({ src: String(i.currentSrc || i.src).slice(-48), w: i.naturalWidth, h: i.naturalHeight })).slice(0, 8)
      },
      rects: { panel: r(panel), options: r(opts), navList: r(navList), mask: r(document.querySelector('div[class$="_mask"]')) },
      styles: {
        maskBackdropFilter: bg ? bg.backdropFilter : null,
        bodyBgImage: (() => { const s = getComputedStyle(document.body).backgroundImage; return s && s !== 'none' ? s.slice(0, 80) : 'none'; })(),
        wallpaperLayer: (() => { const el = [...document.body.children].find((e) => /background-size:\s*cover/.test(e.getAttribute('style') || '')); return el ? { found: true, bg: String(el.style.backgroundImage).slice(0, 100), filter: el.style.filter } : { found: false }; })(),
        bodyInlineBase: document.body.style.getPropertyValue('--dsw-alias-bg-base') || null,
        bodyAttr: document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light'
      },
      scrollables,
      probeChannels: P.channels,
      reactRenderers: P.reactRenderers,
      globals: Object.keys(window).filter((k) => /^(__|DSH|dsh)/.test(k)).slice(0, 40)
    };
  };

  window.__phase = function () {
    return { t: now(), frames: P.frames.length, longtasks: P.longtasks.length, loaf: P.loaf.length,
             rpcs: P.rpcs.length, commits: P.commits.length, unmounts: P.fiberUnmountCalls.length, muts: S.mutCount };
  };
  // Positive control hook: a synchronous main-thread block of `ms`.
  window.__block = function (ms) { const t = performance.now(); while (performance.now() - t < ms) { /* spin */ } return performance.now() - t; };
  window.__sincePhase = function (base) {
    const n = now();
    const lt = P.longtasks.slice(base.longtasks);
    const loaf = P.loaf.slice(base.loaf);
    const fr = P.frames.slice(base.frames);
    const dl = [];
    for (let i = 1; i < fr.length; i++) dl.push(fr[i] - fr[i - 1]);
    const q = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
    return {
      wallMs: n - base.t,
      nFrames: dl.length,
      frameP50: q(dl, 0.5), frameP95: q(dl, 0.95), frameP99: q(dl, 0.99), frameMax: dl.length ? Math.max(...dl) : null,
      framesGt50: dl.filter((x) => x > 50).length,
      framesGt33: dl.filter((x) => x > 33.4).length,
      frameSeries: dl,
      longtaskCount: lt.length,
      longtaskTotal: lt.reduce((a, b) => a + b.dur, 0),
      longtaskMax: lt.length ? Math.max(...lt.map((x) => x.dur)) : 0,
      longtasks: lt.map((x) => ({ start: x.start - base.t, dur: x.dur, name: x.name })),
      loafCount: loaf.length,
      loafMax: loaf.length ? Math.max(...loaf.map((x) => x.dur || 0)) : 0,
      loafBlockingMax: loaf.length ? Math.max(...loaf.map((x) => x.blockingDur || 0)) : 0,
      loafScripts: loaf.flatMap((x) => x.scripts || []).sort((a, b) => b.dur - a.dur).slice(0, 8),
      rpcs: P.rpcs.slice(base.rpcs).map((r) => ({ method: r.method, dur: r.dur, start: r.start - base.t, transport: r.transport, status: r.status, len: r.len })),
      commits: P.commits.slice(base.commits).length,
      unmounts: P.fiberUnmountCalls.length - base.unmounts,
      muts: S.mutCount - base.muts
    };
  };
})();
