/* model-tab attribution harness — in-page instrumentation (document-start).
 * Independent implementation: does NOT import or modify any sibling artifact.
 * Read-only w.r.t. the product: it only observes, and its one intervention
 * (WS frame delivery gating) is confined to this test browser.
 */
(() => {
  'use strict';
  const S = {
    t0: performance.now(), armed: false,
    frames: [], longtasks: [], errors: [], visibility: [],
    ws: { sockets: [], byType: {}, byEnv: {}, sub: {}, bytes: 0, muted: [], delivered: 0, dropped: 0 },
    wsModels: [],
    react: {
      hookInstalled: false, hookPreexisting: false, inject: 0, renderers: [],
      commitsTotal: 0, commitsInPanel: 0,
      walkMs: 0, walkVisits: 0,
      fibersPanelTotal: 0, fibersDlgTotal: 0, fibersAllTotal: 0, updateFlagsPanelTotal: 0,
      ownersPanel: {}, ownersDlg: {}, ownersAll: {}, tagsPanel: {}, tagsDlg: {},
      panelSetSize: 0, dlgSetSize: 0, lastCommit: null, commitLog: [],
      setterCalls: 0, setterLog: [], setterSites: {},
      rootCommits: 0, postCommit: 0, unmounts: 0, profilerFailures: 0,
      base: { commitsTotal: 0, fibersPanelTotal: 0, fibersDlgTotal: 0, fibersAllTotal: 0, walkMs: 0, commitsInPanel: 0 },
    },
    http: { total: 0, byMethod: {}, log: [] },
    xhr: { total: 0, log: [] },
    timers: { setInterval: 0, setTimeout: 0, rafLoop: 0, intervalDelays: {}, timeoutDelays: {}, fires: {} },
    nodeMutations: 0, textMutations: 0, childMutations: 0,
  };
  window.__MT = S;

  /* ---------------------------------------------------------- passive rAF */
  requestAnimationFrame(function loop(t) { S.frames.push(t); requestAnimationFrame(loop); });
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) S.longtasks.push({ start: e.startTime, duration: e.duration, name: e.name }); })
      .observe({ entryTypes: ['longtask'] });
  } catch (e) { }
  window.addEventListener('error', (e) => S.errors.push({ t: performance.now(), msg: String(e.message).slice(0, 200) }));
  window.addEventListener('unhandledrejection', (e) => S.errors.push({ t: performance.now(), msg: 'rejection: ' + String(e.reason && e.reason.message || e.reason).slice(0, 200) }));
  document.addEventListener('visibilitychange', () => S.visibility.push({ t: performance.now(), state: document.visibilityState }));

  /* ------------------------------------------------------------ HTTP */
  (() => {
    const record = (method, url, ok) => {
      S.http.total++; S.http.byMethod[method] = (S.http.byMethod[method] || 0) + 1;
      if (S.http.log.length < 3000) S.http.log.push({ t: Math.round(performance.now()), method, url: String(url).slice(0, 120), ok });
    };
    const original = window.fetch;
    window.fetch = function (input, init) {
      let method = 'GET', url = '';
      try {
        if (typeof input === 'string') url = input;
        else if (input && input.url) { url = input.url; method = input.method || 'GET'; }
        if (init && init.method) method = init.method;
      } catch (e) { }
      method = String(method).toUpperCase();
      const p = original.apply(this, arguments);
      if (p && typeof p.then === 'function') p.then(() => record(method, url, true), () => record(method, url, false));
      return p;
    };
    const XO = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      try { S.xhr.total++; if (S.xhr.log.length < 600) S.xhr.log.push({ t: Math.round(performance.now()), method: String(method), url: String(url).slice(0, 120) }); } catch (e) { }
      return XO.apply(this, arguments);
    };
  })();

  /* --------------------------------------------------------- timers */
  (() => {
    const si = window.setInterval, st = window.setTimeout, rq = window.requestAnimationFrame;
    window.setInterval = function (fn, ms) {
      S.timers.setInterval++;
      const k = String(ms); S.timers.intervalDelays[k] = (S.timers.intervalDelays[k] || 0) + 1;
      if (typeof fn === 'function') { const w = function () { try { S.timers.fires['iv:' + k] = (S.timers.fires['iv:' + k] || 0) + 1; } catch (e) { } return fn.apply(this, arguments); }; return si.call(window, w, ms); }
      return si.apply(window, arguments);
    };
    window.setTimeout = function (fn, ms) {
      S.timers.setTimeout++;
      const k = String(ms); S.timers.timeoutDelays[k] = (S.timers.timeoutDelays[k] || 0) + 1;
      return st.apply(window, arguments);
    };
    window.requestAnimationFrame = function (fn) {
      S.timers.rafLoop++;
      if (typeof fn === 'function') { const w = function (t) { try { S.timers.fires['raf'] = (S.timers.fires['raf'] || 0) + 1; } catch (e) { } return fn.call(this, t); }; return rq.call(window, w); }
      return rq.apply(window, arguments);
    };
  })();

  /* ------------------------------------------------------- WebSocket gate */
  (() => {
    const Native = window.WebSocket;
    function Gate(url, protocols) {
      const sock = protocols === undefined ? new Native(url) : new Native(url, protocols);
      const meta = { url: String(url), frames: 0, bytes: 0, created: Math.round(performance.now()) };
      S.ws.sockets.push(meta);
      sock.addEventListener('message', (ev) => {
        try {
          meta.frames++;
          const d = ev.data;
          const len = typeof d === 'string' ? d.length : (d && d.byteLength) || 0;
          meta.bytes += len; S.ws.bytes += len;
          let kind = 'unparsed', env = '?', type2 = '';
          if (typeof d === 'string') {
            if (S.wsModels.length < 40 && d.length < 4000) S.wsModels.push(d.slice(0, 360));
            try {
              const o = JSON.parse(d); env = (o && o.type) || 'none'; const p = (o && o.payload) || {};
              kind = p.type || o.method || 'none'; type2 = (p.payload && p.payload.type) || '';
              const sub = (p.payload && (p.payload.payload && p.payload.payload.type)) || (p.payload && p.payload.kind) || (p.payload && p.payload.event && p.payload.event.type) || '';
              const key = kind + (type2 ? '>' + type2 : '') + (sub ? '>' + sub : '');
              S.ws.sub[key] = (S.ws.sub[key] || 0) + 1;
            } catch (e) { kind = 'non-json'; }
          } else kind = 'binary';
          S.ws.byType[kind] = (S.ws.byType[kind] || 0) + 1;
          S.ws.byEnv[env] = (S.ws.byEnv[env] || 0) + 1;
          if (S.ws.muted.length && (S.ws.muted.indexOf(kind) >= 0 || S.ws.muted.indexOf(env) >= 0 || S.ws.muted.indexOf(type2) >= 0)) {
            S.ws.dropped++; ev.stopImmediatePropagation();
          } else S.ws.delivered++;
        } catch (e) { S.ws.dropped++; }
      }, true);
      return sock;
    }
    Gate.prototype = Native.prototype;
    try { for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) Object.defineProperty(Gate, k, { value: Native[k] }); } catch (e) { }
    window.WebSocket = Gate;
  })();

  /* ----------------------------------------------------- React commit profiling */
  const fname = (f) => {
    try {
      const t = f.type;
      if (typeof t === 'string') return t;
      if (typeof t === 'function') return t.displayName || t.name || 'anon';
      if (t && typeof t === 'object') return t.displayName || (t.render && (t.render.displayName || t.render.name)) || 'obj';
      return 'memofwd';
    } catch (e) { return 'err'; }
  };
  /* DOM owner label: nearest host ancestor's tag.className, for attributing
   * rendered fibers to the DOM region they produce. */
  const ownerOf = (dom) => {
    try {
      if (!dom) return 'no-dom';
      const cls = (dom.getAttribute && dom.getAttribute('class')) || '';
      const tok = cls ? cls.split(/\s+/).filter((s) => s && !/^[A-Za-z0-9_-]{1,6}$/.test(s)).slice(0, 2).join('.') : '';
      return (dom.tagName || '?').toLowerCase() + (tok ? '.' + tok.slice(0, 60) : '');
    } catch (e) { return 'err'; }
  };

  /* --------------------------------------------- panel container discovery */
  S.panelFind = () => {
    const dlg = document.querySelector('[role="dialog"]');
    const nav = dlg && dlg.querySelector('nav');
    const chain = [];
    let node = nav ? nav.nextElementSibling : null;
    let best = null, bestN = -1;
    let cur = node;
    while (cur && cur !== dlg && chain.length < 8) {
      const n = cur.getElementsByTagName('*').length;
      chain.push({ tag: cur.tagName, cls: String(cur.className || '').slice(0, 80), nodes: n });
      if (n > bestN) { bestN = n; best = cur; }
      cur = cur.parentElement;
    }
    if (((best ? best.getElementsByTagName('*').length : 0) < 50) && nav) {
      let up = nav; let i = 0;
      while (up && up.parentElement && i++ < 6) {
        const n = up.getElementsByTagName('*').length;
        chain.push({ tag: 'UP:' + up.tagName, cls: String(up.className || '').slice(0, 80), nodes: n });
        if (n > bestN) { bestN = n; best = up; }
        if (up === dlg) break;
        up = up.parentElement;
      }
    }
    S.panel = best;
    S.panelChain = chain;
    S.panelNodes0 = best ? best.getElementsByTagName('*').length : null;
    if (S.mo) { try { S.mo.disconnect(); } catch (e) { } S.mo = null; }
    if (best) {
      S.mo = new MutationObserver((recs) => {
        for (const r of recs) {
          if (r.type === 'childList') S.childMutations += r.addedNodes.length + r.removedNodes.length;
          else if (r.type === 'characterData') S.textMutations++;
        }
      });
      S.mo.observe(best, { childList: true, subtree: true, characterData: true });
    }
    return { found: !!best, nodes: S.panelNodes0, chain, dlgNodes: dlg ? dlg.getElementsByTagName('*').length : 0 };
  };

  /* collect the DOM element set of a container once per commit */
  const elemsOf = (root) => {
    const set = new Set();
    if (!root || !document.contains(root)) return set;
    if (root.nodeType === 1) set.add(root);
    const all = root.getElementsByTagName('*');
    for (let i = 0; i < all.length; i++) set.add(all[i]);
    return set;
  };
  const dialogEl = () => document.querySelector('[role="dialog"]');

  const onCommit = (fiberRoot) => {
    const R = S.react;
    R.commitsTotal++;
    const w0 = performance.now();
    const root = fiberRoot && fiberRoot.current ? fiberRoot.current : fiberRoot;
    const elems = elemsOf(S.panel);
    const de = elemsOf(dialogEl());
    const inPanel = elems.size > 0;
    if (inPanel) R.commitsInPanel++;
    R.panelSetSize = elems.size; R.dlgSetSize = de.size;
    let panel = 0, dlgN = 0, all = 0, visits = 0;
    const ownersP = {}, ownersD = {}, ownersA = {}, tagsP = {}, tagsD = {};
    const walk = (n, depth) => {
      let c = 0;
      while (n && c < 40000) {
        visits++;
        const hasWork = (n.flags & 1) !== 0;
        const t = n.type;
        if (hasWork && t != null && (typeof t === 'function' || typeof t === 'object')) {
          all++;
          const host = n.stateNode && n.stateNode.nodeType === 1 ? n.stateNode : null;
          const own = ownerOf(host);
          ownersA[own] = (ownersA[own] || 0) + 1;
          if (host) {
            const nm = fname(n);
            if (elems.has(host)) { panel++; tagsP[nm] = (tagsP[nm] || 0) + 1; ownersP[own] = (ownersP[own] || 0) + 1; }
            if (de.has(host)) { dlgN++; tagsD[nm] = (tagsD[nm] || 0) + 1; ownersD[own] = (ownersD[own] || 0) + 1; }
          }
        }
        if (n.child && depth < 60) walk(n.child, depth + 1);
        n = n.sibling; c++;
      }
    };
    try { walk(root, 0); } catch (e) { S.errors.push({ t: performance.now(), msg: 'walk:' + String(e).slice(0, 120) }); }
    const dur = performance.now() - w0;
    R.walkMs += dur; R.walkVisits += visits;
    R.fibersPanelTotal += panel; R.fibersDlgTotal += dlgN; R.fibersAllTotal += all;
    for (const k in ownersP) R.ownersPanel[k] = (R.ownersPanel[k] || 0) + ownersP[k];
    for (const k in ownersD) R.ownersDlg[k] = (R.ownersDlg[k] || 0) + ownersD[k];
    for (const k in ownersA) R.ownersAll[k] = (R.ownersAll[k] || 0) + ownersA[k];
    for (const k in tagsP) R.tagsPanel[k] = (R.tagsPanel[k] || 0) + tagsP[k];
    for (const k in tagsD) R.tagsDlg[k] = (R.tagsDlg[k] || 0) + tagsD[k];
    R.lastCommit = { t: Math.round(w0), dur: Math.round(dur * 100) / 100, panel, dlg: dlgN, all, visits, elems: elems.size, dlgElems: de.size, hasWork: all > 0 };
    if (R.commitLog.length < 4000) R.commitLog.push(R.lastCommit);
  };

  const sitesOf = () => { try { const e = new Error(); const f = (e.stack || '').split('\n').slice(2, 4).join(' | '); return f.replace(/https?:\/\/[^ )]+/g, (m) => m.split('/').slice(-1)[0]).slice(0, 180); } catch (x) { return 'nostack'; } };

  const install = (hook) => {
    const R = S.react;
    R.hookInstalled = true;
    try {
      const prevInject = hook.inject;
      hook.inject = function (internals) {
        R.inject++;
        try {
          R.renderers.push({ id: R.inject, version: internals && internals.version, pkg: internals && internals.rendererPackageName });
          if (internals && typeof internals.injectProfilingHooks === 'function') {
            internals.injectProfilingHooks({
              markCommitStarted() { }, markCommitStopped() { }, markRenderStarted() { }, markRenderStopped() { },
              markLayoutEffectsStarted() { }, markLayoutEffectsStopped() { }, markPassiveEffectsStarted() { }, markPassiveEffectsStopped() { },
              markComponentRenderStarted() { }, markComponentRenderStopped() { }, markComponentLayoutEffectMountStarted() { },
              markComponentLayoutEffectMountStopped() { }, markComponentLayoutEffectUnmountStarted() { },
              markComponentLayoutEffectUnmountStopped() { }, markComponentPassiveEffectMountStarted() { },
              markComponentPassiveEffectMountStopped() { }, markComponentPassiveEffectUnmountStarted() { },
              markComponentPassiveEffectUnmountStopped() { }, markRenderScheduled() { },
              markStateUpdateScheduled(fiber, lane) {
                R.setterCalls++;
                if (R.setterLog.length < 1500) {
                  const nm = fname(fiber);
                  R.setterLog.push({ t: Math.round(performance.now()), fiber: nm, site: sitesOf() });
                  R.setterSites[nm] = (R.setterSites[nm] || 0) + 1;
                }
              },
              markStateUpdateProcessed() { }, markForceUpdateScheduled() { }, markRenderYielded() { },
              markRenderEventTimeAndConfig() { }, markSuspenseBoundaryWillSuspend() { }, markSuspenseBoundaryDidSuspend() { },
              markVirtualCommitTiming() { },
            });
          }
        } catch (e) { R.profilerFailures++; }
        if (typeof prevInject === 'function') { try { return prevInject.call(this, internals); } catch (e) { } }
        return internals && internals.rendererID;
      };
      const prevCommit = hook.onCommitFiberRoot;
      hook.onCommitFiberRoot = function () {
        R.rootCommits++;
        try { onCommit(arguments[1]); } catch (e) { S.errors.push({ t: performance.now(), msg: 'onCommit:' + String(e).slice(0, 120) }); }
        if (typeof prevCommit === 'function') { try { return prevCommit.apply(this, arguments); } catch (e) { } }
      };
      const prevPost = hook.onPostCommitFiberRoot;
      hook.onPostCommitFiberRoot = function () { R.postCommit++; if (typeof prevPost === 'function') { try { return prevPost.apply(this, arguments); } catch (e) { } } };
      const prevUnmount = hook.onCommitFiberUnmount;
      hook.onCommitFiberUnmount = function () { R.unmounts++; if (typeof prevUnmount === 'function') { try { return prevUnmount.apply(this, arguments); } catch (e) { } } };
    } catch (e) { S.errors.push({ t: performance.now(), msg: 'hookInstall:' + String(e).slice(0, 160) }); }
  };
  if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__) { S.react.hookPreexisting = true; install(window.__REACT_DEVTOOLS_GLOBAL_HOOK__); }
  else {
    const listeners = {};
    const hook = {
      supportsFiber: true, isDisabled: false, renderers: new Map(), _listeners: listeners,
      on(e, fn) { (listeners[e] = listeners[e] || []).push(fn); }, off(e, fn) { const a = listeners[e] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); },
      sub(e, fn) { hook.on(e, fn); return () => hook.off(e, fn); }, emit(e, ...a) { for (const fn of (listeners[e] || []).slice()) { try { fn(...a); } catch (x) { } } },
      inject() { return 1; }, onCommitFiberRoot() { }, onCommitFiberUnmount() { }, onPostCommitFiberRoot() { },
    };
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;
    install(hook);
  }

  /* --------------------------------------------------------- window gate */
  S.windowStart = (muted) => {
    S.ws.muted = muted || [];
    S.ws.byType = {}; S.ws.byEnv = {}; S.ws.sub = {}; S.ws.bytes = 0; S.ws.delivered = 0; S.ws.dropped = 0;
    S.frames = []; S.longtasks = []; S.errors = [];
    S.nodeMutations = 0; S.textMutations = 0; S.childMutations = 0;
    S.http = { total: 0, byMethod: {}, log: [] }; S.xhr = { total: 0, log: [] };
    S.timers = { setInterval: 0, setTimeout: 0, rafLoop: 0, intervalDelays: {}, timeoutDelays: {}, fires: {} };
    const R = S.react;
    R.base = { commitsTotal: R.commitsTotal, fibersPanelTotal: R.fibersPanelTotal, fibersDlgTotal: R.fibersDlgTotal, fibersAllTotal: R.fibersAllTotal, walkMs: R.walkMs, commitsInPanel: R.commitsInPanel };
    R.commitLog = []; R.ownersPanel = {}; R.ownersDlg = {}; R.ownersAll = {}; R.tagsPanel = {}; R.tagsDlg = {};
    R.setterCalls = 0; R.setterLog = []; R.setterSites = {}; R.rootCommits = 0; R.postCommit = 0; R.unmounts = 0;
    S.startedAt = performance.now();
    S.armed = true;
  };
  S.windowEnd = () => {
    S.armed = false;
    S.endedAt = performance.now();
    const R = S.react;
    const frames = S.frames.slice();
    const iv = []; for (let i = 1; i < frames.length; i++) iv.push(Math.round((frames[i] - frames[i - 1]) * 100) / 100);
    const sorted = iv.slice().sort((a, b) => a - b);
    const q = (p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : null);
    const content = S.panel && document.contains(S.panel) ? S.panel : null;
    const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n || 18).reduce((acc, [k, v]) => (acc[k] = v, acc), {});
    return {
      startedAt: S.startedAt, endedAt: S.endedAt, durationMs: S.endedAt - S.startedAt,
      frames: frames.length,
      frameGap: { n: iv.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: sorted.length ? sorted[sorted.length - 1] : null, over50: iv.filter((x) => x > 50).length, over100: iv.filter((x) => x > 100).length, sumMs: Math.round(iv.reduce((a, b) => a + b, 0)) },
      longtasks: { n: S.longtasks.length, max: Math.round(S.longtasks.reduce((m, x) => Math.max(m, x.duration), 0) * 10) / 10, sum: Math.round(S.longtasks.reduce((s, x) => s + x.duration, 0) * 10) / 10, list: S.longtasks.slice(0, 200).map((x) => ({ start: Math.round(x.start), duration: Math.round(x.duration) })) },
      ws: { byType: { ...S.ws.byType }, byEnv: { ...S.ws.byEnv }, sub: Object.entries(S.ws.sub).sort((a,b)=>b[1]-a[1]).slice(0,20).reduce((o,[k,v])=>(o[k]=v,o),{}), bytes: S.ws.bytes, delivered: S.ws.delivered, dropped: S.ws.dropped, muted: S.ws.muted.slice(), sockets: S.ws.sockets.length, sample: S.wsModels.slice(0, 12) },
      http: { total: S.http.total, byMethod: { ...S.http.byMethod }, log: S.http.log.slice(0, 500) },
      xhr: { total: S.xhr.total, log: S.xhr.log.slice(0, 200) },
      timers: JSON.parse(JSON.stringify(S.timers)),
      mutations: { text: S.textMutations, child: S.childMutations },
      react: {
        hookInstalled: R.hookInstalled, hookPreexisting: R.hookPreexisting, inject: R.inject, renderers: R.renderers.slice(),
        commitsInWindow: R.commitsTotal - R.base.commitsTotal,
        commitsInPanelInWindow: R.commitsInPanel - R.base.commitsInPanel,
        fibersPanelInWindow: R.fibersPanelTotal - R.base.fibersPanelTotal,
        fibersDlgInWindow: R.fibersDlgTotal - R.base.fibersDlgTotal,
        fibersAllInWindow: R.fibersAllTotal - R.base.fibersAllTotal,
        walkMsInWindow: Math.round((R.walkMs - R.base.walkMs) * 10) / 10,
        walkVisits: R.walkVisits,
        setterCallsInWindow: R.setterCalls, setterSites: top(R.setterSites, 20),
        commitLog: R.commitLog.slice(0, 400),
        ownersPanel: top(R.ownersPanel, 20), ownersDlg: top(R.ownersDlg, 20), ownersAll: top(R.ownersAll, 24),
        tagsPanel: top(R.tagsPanel, 20), tagsDlg: top(R.tagsDlg, 20),
        panelSetSize: R.panelSetSize, dlgSetSize: R.dlgSetSize, rootCommits: R.rootCommits, postCommit: R.postCommit, unmounts: R.unmounts,
        profilerFailures: R.profilerFailures,
      },
      dom: { panelNodes: content ? content.getElementsByTagName('*').length : null, dlgNodes: document.querySelector('[role="dialog"]') ? document.querySelector('[role="dialog"]').getElementsByTagName('*').length : null, totalNodes: document.getElementsByTagName('*').length, panelPresent: !!content },
      errors: S.errors.slice(0, 40),
      panelTextLen: content ? (content.textContent || '').length : null,
      panelTextHead: content ? (content.textContent || '').replace(/\s+/g, ' ').slice(0, 200) : null,
      panelRows: content ? {
        rowCard: content.querySelectorAll('[class*="rowCard"]').length,
        rowHead: content.querySelectorAll('[class*="rowHead"]').length,
        modelEntry: content.querySelectorAll('[class*="modelEntry"]').length,
        modelRow: content.querySelectorAll('[class*="modelRow"]').length,
        input: content.querySelectorAll('input').length,
        button: content.querySelectorAll('button').length, li: content.querySelectorAll('li').length, svg: content.querySelectorAll('svg').length,
      } : null,
      panelChain: S.panelChain || null,
    };
  };
})();
