/*
 * React commit instrumentation for the DSH Web GUI (read-only, in-page).
 *
 * Installed with page.addInitScript({ path }) so that it runs at document-start,
 * BEFORE /assets/index-*.js evaluates react-dom. react-dom 18.3.1 only adopts the
 * hook at module-evaluation time:
 *
 *   if (typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ < "u") {
 *     var ki = __REACT_DEVTOOLS_GLOBAL_HOOK__;
 *     if (!ki.isDisabled && ki.supportsFiber) try { xr = ki.inject(s5), Tt = ki } catch {}
 *   }
 *
 * It records:
 *   - hook adoption proof (inject / onCommitFiberRoot call counters)
 *   - per-second commit buckets, per target fiber, with TWO independent render signals
 *       pw = (fiber.flags & 1) === 1          // PerformedWork, what React DevTools' didFiberRender uses
 *       id = memoizedProps/memoizedState identity differs from alternate  // hooks-level "did run"
 *   - rendered-component count inside the SettingsPanel fiber subtree
 *   - WebSocket frames bucketed by PAYLOAD type (frame payload.type), not envelope type
 *   - DOM evidence that the settings panel is actually mounted (panel node count)
 */
(() => {
  'use strict';
  if (window.__RC__ && window.__RC__.version >= 1) return;

  const t0 = performance.now();
  const now = () => performance.now() - t0;

  const RC = {
    version: 1,
    t0_epoch_ms: Date.now(),
    injected: [],
    hookPreexisting: false,
    hookCalls: { inject: 0, onCommitFiberRoot: 0, onPostCommitFiberRoot: 0, onCommitFiberUnmount: 0 },
    errors: [],
    seconds: Object.create(null),
    commitLog: [],
    commitLogCap: 4000,
    wsSockets: [],
    wsFramesRaw: [],
    wsFramesRawCap: 400,
    wsParseFail: 0,
    panelOpenEvents: [],
    targetResolutionErrors: [],
    targetSets: Object.create(null),
    targetNames: Object.create(null),
    ancNames: Object.create(null),
    marks: [],
    debug: false,
    debugLog: [],
  };
  window.__RC__ = RC;

  // ---------------------------------------------------------------- fiber utils
  const COMPONENT_TAGS = new Set([0, 1, 11, 14, 15]); // Function, Class, ForwardRef, Memo, SimpleMemo

  function fiberKey(node) {
    if (!node) return null;
    for (const k in node) {
      if (k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')) return k;
    }
    return null;
  }
  function getFiber(node) {
    const k = fiberKey(node);
    return k ? node[k] : null;
  }
  function topOf(f) {
    let x = f;
    let guard = 0;
    while (x && x.return && guard++ < 400) x = x.return;
    return x;
  }
  function isCurrentIn(f, root) {
    if (!f) return false;
    try { return topOf(f) === root.current; } catch { return false; }
  }
  function nameOf(f) {
    if (!f) return null;
    const t = f.type;
    if (t == null) return 'host:' + String(f.elementType);
    if (typeof t === 'string') return 'host:' + t;
    return t.displayName || t.name || (t.render && (t.render.displayName || t.render.name)) || 'anon';
  }
  function signalPw(f) { try { return ((f.flags | 0) & 1) === 1; } catch { return false; } }
  function signalId(f) {
    try {
      const a = f.alternate;
      if (a === null || a === undefined) return true; // mount => user code ran
      return f.memoizedProps !== a.memoizedProps || f.memoizedState !== a.memoizedState;
    } catch { return false; }
  }

  function bucket() {
    const s = Math.floor(now() / 1000);
    let b = RC.seconds[s];
    if (b === undefined) {
      b = RC.seconds[s] = {
        c: 0,                      // commits observed by the hook (any root)
        cId: Object.create(null),  // commits per renderer id
        tgt: Object.create(null),  // targetName -> {pw, id, any}
        sub: 0,                    // rendered component fibers inside SettingsPanel subtree (PerformedWork)
        subId: 0,                  // same, by hooks-identity signal
        subTotal: 0,               // component fibers inside the panel subtree
        subMax: 0,
        subNames: Object.create(null), // component name -> rendered count inside panel subtree
        chain: Object.create(null),    // ancestor index above SettingsPanel -> rendered count (id signal)
        altNull: 0,                    // commits where the resolved panel fiber had no alternate (fresh mount / wrong-buffer pick)
        domReplaced: 0,                // commits where the settings dialog DOM node object changed (remount)
        setGrew: 0,                    // commits where the panel target set gained a new fiber
        wholePw: 0,                // rendered component fibers in the ENTIRE tree
        wholeId: 0,
        wholeTotal: 0,
        ws: Object.create(null),   // payload.type -> frame count
        wsEnv: Object.create(null),// envelope type -> frame count (cross-check only)
        panelNodes: 0,
        panel: 0,
        res: 0,                    // target resolution attempts in this second
      };
    }
    return b;
  }
  function bump(map, key, n) { map[key] = (map[key] || 0) + (n === undefined ? 1 : n); }

  // ---------------------------------------------------------------- targets
  function resolveTargets(reason) {
    let panelDom = null;
    try { panelDom = document.querySelector('div[role="dialog"][aria-modal="true"]'); } catch (e) { }
    if (panelDom === null) { RC.panel = 0; return null; }
    RC.panelDomRef = RC.panelDomRef === undefined ? panelDom : RC.panelDomRef;
    const hostFiber = getFiber(panelDom);
    if (!hostFiber) { RC.errors.push({ t: now(), where: 'resolveTargets', msg: 'no fiber key on panel dom' }); return null; }

    const chain = [];
    let f = hostFiber;
    let guard = 0;
    while (f && guard++ < 200) { chain.push(f); f = f.return; }
    const fns = chain.filter((x) => COMPONENT_TAGS.has(x.tag));
    const panelFiber = fns[0] || null;
    const rootFiber = fns[1] || null;

    const out = {};
    if (panelFiber) {
      out.panel = panelFiber;
      RC.targetNames.panel = nameOf(panelFiber);
    }
    if (rootFiber) {
      out.root = rootFiber;
      RC.targetNames.root = nameOf(rootFiber);
    }
    // merge into per-key fiber sets (React double-buffers, but be safe)
    for (const k of Object.keys(out)) {
      let set = RC.targetSets[k];
      if (!set) set = RC.targetSets[k] = [];
      for (const cand of [out[k], out[k].alternate]) {
        if (cand && !set.includes(cand)) set.push(cand);
      }
      if (set.length > 8) RC.targetSets[k] = set.slice(-8);
    }
    RC.panelChainNames = chain.slice(0, 10).map((x) => nameOf(x));
    return out;
  }

  function currentTarget(key, root) {
    const set = RC.targetSets[key];
    if (!set) return null;
    for (const f of set) if (isCurrentIn(f, root)) return f;
    return null;
  }

  /**
   * Walk a fiber subtree and report selectivity: how many component fibers exist,
   * how many rendered (PerformedWork) and how many rendered by hooks identity, plus
   * a name->count attribution map for the rendered ones.
   */
  function scanSubtree(f, names) {
    const res = { total: 0, pw: 0, id: 0 };
    if (!f) return res;
    const stack = [f.child];
    let guard = 0;
    while (stack.length > 0 && guard < 12000) {
      const x = stack.pop();
      if (!x) continue;
      guard++;
      if (COMPONENT_TAGS.has(x.tag)) {
        res.total++;
        const up = signalPw(x);
        if (up) {
          res.pw++;
          if (names) bump(names, nameOf(x));
        }
        if (signalId(x)) res.id++;
      }
      if (x.sibling) stack.push(x.sibling);
      if (x.child) stack.push(x.child);
    }
    return res;
  }

  // ---------------------------------------------------------------- commit hook
  function onCommit(kind, rendererID, root, didError) {
    try {
      const b = bucket();
      b.c++;
      bump(b.cId, String(rendererID));
      const panelDomCount = document.querySelectorAll('div[role="dialog"][aria-modal="true"]').length;
      b.panelNodes = panelDomCount;
      b.panel = panelDomCount > 0 ? 1 : 0;

      let summary = null;
      if (panelDomCount > 0) {
        b.res++;
        resolveTargets(kind);
        const panelDomEl = document.querySelector('div[role="dialog"][aria-modal="true"]');
        const p = currentTarget('panel', root);
        const r = currentTarget('root', root);
        summary = {};
        for (const [key, fib] of [['panel', p], ['root', r]]) {
          if (!fib) { summary[key] = { present: false }; continue; }
          const pw = signalPw(fib);
          const id = signalId(fib);
          let tb = b.tgt[key];
          if (!tb) tb = b.tgt[key] = { pw: 0, id: 0, any: 0 };
          if (pw) tb.pw++;
          if (id) tb.id++;
          if (pw || id) tb.any++;
          summary[key] = { present: true, pw, id, name: RC.targetNames[key], tag: fib.tag, lanes: fib.lanes, childLanes: fib.childLanes };
        }
        let scPw = null, scTotal = null;
        if (p) {
          // ancestor chain above SettingsPanel: index 0 = SettingsRoot, 1 = its parent, ...
          // tells us whether the panel's own re-render is parent-driven or self-driven.
          // remount / buffer sanity detectors
          try {
            if (p.alternate === null || p.alternate === undefined) b.altNull++;
            if (RC.panelDomRef === undefined) RC.panelDomRef = panelDomEl;
            else if (RC.panelDomRef !== panelDomEl) { b.domReplaced++; RC.panelDomRef = panelDomEl; }
            const sz = (RC.targetSets.panel || []).length;
            if (RC.lastPanelSetSize !== undefined && sz > RC.lastPanelSetSize) b.setGrew++;
            RC.lastPanelSetSize = sz;
          } catch (e) { }

          let anc = p.return;
          let idx = 0;
          while (anc && idx < 12) {
            if (RC.ancNames[idx] === undefined) RC.ancNames[idx] = nameOf(anc);
            b.chain[idx] = (b.chain[idx] || 0) + (signalId(anc) ? 1 : 0);
            anc = anc.return;
            idx++;
          }
          const sc = scanSubtree(p, b.subNames);
          scPw = sc.pw; scTotal = sc.total;
          b.sub += sc.pw;
          b.subId += sc.id;
          b.subTotal = sc.total;
          if (sc.pw > b.subMax) b.subMax = sc.pw;
          if (summary) { summary.sub = sc.pw; summary.subTotal = sc.total; }
        }
        if (RC.debug && RC.debugLog.length < 3000) {
          try {
            RC.debugLog.push({
              t: Math.round(now() * 100) / 100,
              panelDomCount,
              p: p ? { name: nameOf(p), tag: p.tag, pw: signalPw(p), id: signalId(p), isCur: isCurrentIn(p, root), altName: p.alternate ? nameOf(p.alternate) : null, pHasAlt: !!p.alternate } : null,
              r: r ? { name: nameOf(r), tag: r.tag, pw: signalPw(r), id: signalId(r) } : null,
              setSizes: Object.fromEntries(Object.entries(RC.targetSets).map(([k, v]) => [k, v.length])),
              setNames: Object.fromEntries(Object.entries(RC.targetSets).map(([k, v]) => [k, v.map(nameOf)])),
              sub: scPw, subTotal: scTotal, wholeLast: b.wholeLast,
              altNull: p ? (p.alternate === null || p.alternate === undefined) : null,
              setNameCount: (RC.targetSets.panel || []).length,
            });
          } catch (e) { }
        }
        // whole-tree selectivity control (bounded walk)
        try {
          const whole = scanSubtree(root.current, null);
          b.wholePw += whole.pw;
          b.wholeId += whole.id;
          b.wholeTotal = Math.max(b.wholeTotal || 0, whole.total);
          b.wholeLast = whole.pw;
        } catch (e) { }
      }
      // whole-tree control also runs while settings is closed
      if (panelDomCount === 0) {
        try {
          const whole = scanSubtree(root.current, null);
          b.wholePw += whole.pw;
          b.wholeId += whole.id;
          b.wholeTotal = Math.max(b.wholeTotal || 0, whole.total);
          b.wholeLast = whole.pw;
        } catch (e) { }
      }

      if (RC.commitLog.length < RC.commitLogCap) {
        RC.commitLog.push({ t: Math.round(now() * 100) / 100, kind, id: rendererID, didError: !!didError, panel: panelDomCount, whole: b.wholePw, s: summary });
      }
    } catch (e) {
      if (RC.errors.length < 50) RC.errors.push({ t: now(), where: 'onCommit', msg: String(e && e.message || e) });
    }
  }

  // ---------------------------------------------------------------- devtools hook
  function makeHook() {
    let seq = 0;
    const rootsByRenderer = new Map();
    const hook = {
      renderers: new Map(),
      supportsFiber: true,
      isDisabled: false,
      inject(internals) {
        RC.hookCalls.inject++;
        const id = ++seq;
        try { hook.renderers.set(id, internals); } catch (e) { }
        RC.injected.push({
          t: Math.round(now() * 100) / 100,
          id,
          version: internals && internals.version,
          rendererPackageName: internals && internals.rendererPackageName,
          bundleType: internals && internals.bundleType,
          hasScheduleRoot: !!(internals && internals.scheduleRoot),
        });
        return id;
      },
      onCommitFiberRoot(rendererID, root, _priority, didError) {
        RC.hookCalls.onCommitFiberRoot++;
        try {
          let s = rootsByRenderer.get(rendererID);
          if (!s) { s = new Set(); rootsByRenderer.set(rendererID, s); }
          s.add(root);
        } catch (e) { }
        onCommit('root', rendererID, root, didError);
      },
      onPostCommitFiberRoot(rendererID, root) {
        RC.hookCalls.onPostCommitFiberRoot++;
        try {
          const b = bucket();
          bump(b.wsEnv, '__postCommit');
        } catch (e) { }
      },
      onCommitFiberUnmount() { RC.hookCalls.onCommitFiberUnmount++; },
      checkDCE() { },
      getFiberRoots(rendererID) { return rootsByRenderer.get(rendererID) || new Set(); },
      // harmless stubs for anything else DevTools-ish code may poke
      on() { }, off() { }, sub() { }, emit() { }, once() { },
      settings: {},
      nativeStyleEditorSupported: false,
    };
    return hook;
  }

  try {
    if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
      RC.hookPreexisting = true;
      const existing = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
      const prevRoot = existing.onCommitFiberRoot;
      existing.supportsFiber = true;
      existing.isDisabled = false;
      existing.onCommitFiberRoot = function (rendererID, root, p, didError) {
        RC.hookCalls.onCommitFiberRoot++;
        onCommit('root', rendererID, root, didError);
        if (typeof prevRoot === 'function') { try { prevRoot.call(existing, rendererID, root, p, didError); } catch (e) { } }
      };
      const prevInject = existing.inject;
      existing.inject = function (internals) {
        RC.hookCalls.inject++;
        RC.injected.push({ t: now(), id: 'wrapped', version: internals && internals.version });
        if (typeof prevInject === 'function') return prevInject.call(existing, internals);
        return 1;
      };
    } else {
      Object.defineProperty(window, '__REACT_DEVTOOLS_GLOBAL_HOOK__', {
        value: makeHook(), writable: false, configurable: true, enumerable: false,
      });
    }
  } catch (e) {
    RC.errors.push({ t: now(), where: 'installHook', msg: String(e && e.message || e) });
  }

  // ---------------------------------------------------------------- websocket tap
  try {
    const OrigWS = window.WebSocket;
    function classify(data) {
      // returns {env, payload} — payload type is the frame kind we actually care about
      if (typeof data !== 'string') return { env: 'binary', payload: 'binary' };
      let o = null;
      try { o = JSON.parse(data); } catch (e) { RC.wsParseFail++; return { env: 'unparsed', payload: 'unparsed' }; }
      const env = (o && typeof o.type === 'string') ? o.type : 'no-envelope-type';
      let payload = 'no-payload-type';
      if (o && o.payload && typeof o.payload.type === 'string') payload = o.payload.type;
      else if (o && o.result) payload = 'server-response:' + (o.result.ok ? 'ok' : 'err');
      else if (o && o.method) payload = 'client-request:' + o.method;
      return { env, payload };
    }
    function tap(sock, url) {
      const rec = { url: String(url), frames: 0, bytes: 0, openedAt: Math.round(now() * 100) / 100, closed: false };
      RC.wsSockets.push(rec);
      sock.addEventListener('message', (ev) => {
        try {
          const data = ev.data;
          rec.frames++;
          rec.bytes += typeof data === 'string' ? data.length : 0;
          const { env, payload } = classify(data);
          const b = bucket();
          bump(b.ws, payload);
          bump(b.wsEnv, env);
          if (RC.wsFramesRaw.length < RC.wsFramesRawCap) {
            RC.wsFramesRaw.push({ t: Math.round(now() * 100) / 100, url: rec.url, env, payload, len: typeof data === 'string' ? data.length : 0, head: typeof data === 'string' ? data.slice(0, 160) : '' });
          }
        } catch (e) { }
      });
      sock.addEventListener('close', () => { rec.closed = true; });
      return sock;
    }
    const Wrapped = function WebSocket(url, protocols) {
      const sock = protocols === undefined ? new OrigWS(url) : new OrigWS(url, protocols);
      return tap(sock, url);
    };
    Wrapped.prototype = OrigWS.prototype;
    for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) Wrapped[k] = OrigWS[k];
    Wrapped.__rcWrapped = true;
    window.WebSocket = Wrapped;
  } catch (e) {
    RC.errors.push({ t: now(), where: 'installWS', msg: String(e && e.message || e) });
  }

  // ---------------------------------------------------------------- in-page API
  Object.assign(RC, {
    mark(label) {
      RC.marks.push({ label, t: Math.round(now() * 100) / 100, epoch: Date.now() });
      return { t: now(), label };
    },
    probe() {
      let panelDom = null;
      try { panelDom = document.querySelector('div[role="dialog"][aria-modal="true"]'); } catch (e) { }
      let trigger = null;
      try { trigger = document.querySelector('button[aria-haspopup="dialog"]'); } catch (e) { }
      const hostFiber = panelDom ? getFiber(panelDom) : null;
      const chain = [];
      let f = hostFiber;
      let g = 0;
      while (f && g++ < 60) { chain.push({ tag: f.tag, name: nameOf(f), pw: signalPw(f) }); f = f.return; }
      return {
        now: Math.round(now() * 100) / 100,
        hookPresent: typeof window.__REACT_DEVTOOLS_GLOBAL_HOOK__ !== 'undefined',
        hookPreexisting: RC.hookPreexisting,
        injected: RC.injected.slice(),
        hookCalls: Object.assign({}, RC.hookCalls),
        panelNodes: document.querySelectorAll('div[role="dialog"][aria-modal="true"]').length,
        triggerNodes: document.querySelectorAll('button[aria-haspopup="dialog"]').length,
        panelFiberFound: !!hostFiber,
        panelChain: chain,
        targetNames: Object.assign({}, RC.targetNames),
        targetSetSizes: Object.fromEntries(Object.entries(RC.targetSets).map(([k, v]) => [k, v.length])),
        wsSockets: RC.wsSockets.map((s) => ({ url: s.url, frames: s.frames, bytes: s.bytes, closed: s.closed })),
        domNodes: document.getElementsByTagName('*').length,
        url: location.href,
        errors: RC.errors.slice(0, 10),
      };
    },
    secondKeys() { return Object.keys(RC.seconds).map(Number).sort((a, b) => a - b); },
    dumpSeconds() { return RC.seconds; },
    dumpCommitLog() { return RC.commitLog; },
    dumpWsRaw() { return RC.wsFramesRaw; },
    dumpDebug() { return RC.debugLog; },
    setDebug(v) { RC.debug = !!v; },
    resetSeconds() { RC.seconds = Object.create(null); },
    resetDebug() { RC.debugLog = []; },
  });
})();
