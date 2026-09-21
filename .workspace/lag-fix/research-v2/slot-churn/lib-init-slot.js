/*
 * slot-churn/lib-init-slot.js — INDEPENDENT re-implementation of the React-commit
 * instrumentation for the "parent-driven path" causal question.
 *
 * Independent from research-v2/react-commit/lib-init.js (not a copy): different
 * state model, different signals, and the added slot-version observation channel
 * (host.getVersion polling + per-commit version snapshot). Installed with
 * page.addInitScript({path}) so it runs at document-start, before react-dom is
 * evaluated: react-dom 18.3.1 adopts __REACT_DEVTOOLS_GLOBAL_HOOK__ only at
 * module-evaluation time.
 *
 * Answers recorded here:
 *   1. premise self-proof: inject count, onCommitFiberRoot count, react version,
 *      build flavour (dev/prod), package name
 *   2. per commit: the whole SettingsPanel ancestor chain, each fiber's
 *      PerformedWork flag + memoizedProps/memoizedState identity vs alternate
 *   3. per commit: the slot version values seen by the outlet chain
 *      (host.getVersion(key)) + monotonic generation counters derived from them
 *   4. per commit: prop-object identity vs first observation (new-object detection)
 *   5. per commit: whether the settings panel DOM actually changed (text hash)
 *   6. independent 25 ms polling of every slot version => version transition log
 *      with timestamps, so a bump can be attributed to a wall-clock instant even
 *      when no commit is in flight
 *   7. microtask schedule/invoke counters (slot registry notifications flush in a
 *      microtask; a markDirty always schedules one)
 */
(() => {
  'use strict';
  if (window.__SC__ && window.__SC__.version >= 1) return;

  const t0 = performance.now();
  const now = () => performance.now() - t0;
  const IS = {
    version: 1,
    t0EpochMs: Date.now(),
    hookPreexisting: false,
    hookCalls: { inject: 0, onCommitFiberRoot: 0, onPostCommitFiberRoot: 0, onCommitFiberUnmount: 0 },
    injected: [],
    errors: [],
    commits: [],
    commitCap: 3000,
    commitCount: 0,
    versionPolls: [],
    versionPollCap: 4000,
    versionPollCount: 0,
    versionPollErrors: [],
    hostResolve: { attempts: 0, ok: false, how: null, err: null },
    slotKeys: [],
    micro: { scheduled: 0, invoked: 0, dropped: 0 },
    domSamples: [],
    targetNames: {},
    chainNames: [],
    marks: [],
    debug: false,
  };
  window.__SC__ = IS;

  // ------------------------------------------------------------- microtask channel
  // SlotCore.markDirty() bumps rec.version and always queueMicrotask(flush). Counting
  // the scheduling channel is an independent witness of registry mutation activity:
  // no markDirty => no scheduled flush.
  try {
    const orig = window.queueMicrotask;
    if (typeof orig === 'function') {
      window.queueMicrotask = function (cb) {
        IS.micro.scheduled++;
        if (typeof cb !== 'function') { IS.micro.dropped++; return orig.call(window, cb); }
        return orig.call(window, function () { IS.micro.invoked++; return cb.apply(this, arguments); });
      };
    }
  } catch (e) { IS.errors.push({ t: now(), where: 'queueMicrotask', msg: String(e && e.message || e) }); }

  // ------------------------------------------------------------- hook capture
  let hook = null;
  let commitDepth = 0;
  try {
    IS.hookPreexisting = !!window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  } catch (e) { }
  const registered = {
    version: 1,
    isDisabled: false,
    supportsFiber: true,
    inject(r) {
      IS.hookCalls.inject++;
      hook = r;
      try {
        IS.injected.push({ rendererPackageName: r && r.rendererPackageName, version: r && r.version, bundleType: r && r.bundleType });
      } catch (e) { }
      IS.registeredVersion = 1;
      return 1; // rendererId
    },
    onCommitFiberRoot(id, root, priority) {
      IS.hookCalls.onCommitFiberRoot++;
      IS.commitCount++;
      try { onCommit(root, priority); } catch (e) {
        if (IS.errors.length < 50) IS.errors.push({ t: now(), where: 'onCommit', msg: String(e && e.message || e) });
      }
    },
    onPostCommitFiberRoot() { IS.hookCalls.onPostCommitFiberRoot++; },
    onCommitFiberUnmount() { IS.hookCalls.onCommitFiberUnmount++; },
    checkDCE() { },
    supportsFiber: true,
  };
  try {
    if (!IS.hookPreexisting) window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = registered;
    else {
      // pre-existing hook: chain onto it so react-dom adopts ours too.
      const prev = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
      const prevInject = prev.inject && prev.inject.bind(prev);
      prev.inject = (r) => { registered.inject(r); return prevInject ? prevInject(r) : 1; };
      const prevCommit = prev.onCommitFiberRoot && prev.onCommitFiberRoot.bind(prev);
      prev.onCommitFiberRoot = (id, root, p) => { IS.hookCalls.onCommitFiberRoot++; IS.commitCount++; try { onCommit(root, p); } catch (e) { } return prevCommit ? prevCommit(id, root, p) : undefined; };
    }
  } catch (e) { IS.errors.push({ t: now(), where: 'hookInstall', msg: String(e && e.message || e) }); }

  // ------------------------------------------------------------- fiber utils
  const COMPONENT_TAGS = new Set([0, 1, 11, 14, 15]);
  function nameOf(f) {
    if (!f) return null;
    const t = f.type;
    if (t == null) return 'host:' + String(f.elementType);
    if (typeof t === 'string') return 'host:' + t;
    return t.displayName || t.name || (t.render && (t.render.displayName || t.render.name)) || 'anon';
  }
  function topOf(f) {
    let x = f, g = 0;
    while (x && x.return && g++ < 500) x = x.return;
    return x;
  }
  function isCurrentIn(f, root) {
    if (!f) return false;
    try { return topOf(f) === root.current; } catch (e) { return false; }
  }
  function performed(f) { try { return ((f.flags | 0) & 1) === 1; } catch (e) { return false; } }
  function ranHooks(f) {
    try {
      const a = f.alternate;
      if (a === null || a === undefined) return true; // mount
      return f.memoizedProps !== a.memoizedProps || f.memoizedState !== a.memoizedState;
    } catch (e) { return false; }
  }
  function fiberKeyOn(node) {
    if (!node) return null;
    for (const k in node) if (k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')) return k;
    return null;
  }
  function fiberOf(node) { const k = fiberKeyOn(node); return k ? node[k] : null; }

  // ------------------------------------------------------------- identity tracker
  const idSeq = new WeakMap();
  let idNext = 1;
  function oid(o) {
    if (o === null) return 'null';
    const t = typeof o;
    if (t === 'undefined') return 'undef';
    if (t === 'number' || t === 'string' || t === 'boolean') return t + ':' + String(o).slice(0, 40);
    if (t === 'function') return 'fn#' + idFor(o);
    if (t === 'object') return 'obj#' + idFor(o);
    return t;
  }
  function idFor(o) {
    let v = idSeq.get(o);
    if (v === undefined) { v = idNext++; idSeq.set(o, v); }
    return v;
  }
  /** per-name prop identity last seen in a previous commit (for new-object detection) */
  const lastProps = Object.create(null);
  const propNewCount = Object.create(null);
  const propTotal = Object.create(null);

  // ------------------------------------------------------------- target resolution
  // Panel anchor: div[role=dialog][aria-modal=true]; SettingsPanel is its nearest
  // component fiber. Chain = SettingsPanel + component ancestors. SlotOutlet is
  // located structurally (the nearest SlotOutlet ancestor of the settings-section
  // anchor inside the panel), and its first uSES hook slot yields the renderer host.
  const chainSet = [];
  let hostRef = null;
  let slotKeyUnderTest = null;

  function resolveTargets() {
    IS.hostResolve.attempts++;
    const panelDom = document.querySelector('div[role="dialog"][aria-modal="true"]');
    if (!panelDom) return null;
    const hf = fiberOf(panelDom);
    if (!hf) return null;
    const chain = [];
    let f = hf, g = 0;
    while (f && g++ < 300) { chain.push(f); f = f.return; }
    const comps = chain.filter((x) => COMPONENT_TAGS.has(x.tag));
    IS.targetNames.panel = comps[0] ? nameOf(comps[0]) : null;
    IS.targetNames.root = comps[1] ? nameOf(comps[1]) : null;
    IS.chainNames = chain.slice(0, 22).map(nameOf);
    if (comps.length && chainSet.length === 0) for (const c of comps.slice(0, 14)) chainSet.push(c);

    if (!hostRef) {
      // Structural resolution: walk every ancestor fiber of the panel DOM node and
      // take the first hook whose memoizedState exposes getVersion (the renderer
      // host). No assumption about data-slot attributes, hook order, or names.
      const diag = [];
      let x = hf, gg = 0, found = null;
      while (x && gg++ < 60) {
        const nm = nameOf(x);
        let h = x.memoizedState, hg = 0;
        while (h && hg++ < 40) {
          const st = h.memoizedState;
          if (st && typeof st === 'object' && typeof st.getVersion === 'function' && typeof st.subscribe === 'function') {
            found = { host: st, name: nm, hookIndex: hg, how: 'ancestor ' + nm + ' hook#' + hg + ' memoizedState' };
            break;
          }
          h = h.next;
        }
        if (found) break;
        if (COMPONENT_TAGS.has(x.tag) && diag.length < 20) {
          let h2 = x.memoizedState, k = 0, kinds = [];
          while (h2 && k++ < 12) {
            const st = h2.memoizedState;
            kinds.push(st === null ? 'null' : (typeof st === 'object' ? (Array.isArray(st) ? 'arr' : 'obj{' + Object.keys(st).slice(0, 6).join('|') + '}') : typeof st));
            h2 = h2.next;
          }
          diag.push({ fiber: nm, tag: x.tag, hooks: kinds });
        }
        x = x.return;
      }
      if (found) {
        hostRef = found.host;
        IS.hostResolve.ok = true;
        IS.hostResolve.how = found.how;
        IS.hostResolve.hostKeys = Object.keys(hostRef).slice(0, 40);
      } else {
        IS.hostResolve.err = 'no ancestor hook exposes getVersion; ancestor component hooks=' + JSON.stringify(diag);
      }
      IS.hostResolve.diag = diag;
    }
    return { chain, comps };
  }

  // ------------------------------------------------------------- DOM signal
  function panelTextHash(el) {
    try {
      const s = el.innerText || el.textContent || '';
      let h = 5381;
      for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
      return { len: s.length, hash: h };
    } catch (e) { return { len: -1, hash: 0 }; }
  }
  let lastDom = null;
  let domNodeRef = null;

  // ------------------------------------------------------------- version snapshot
  const SLOT_KEYS = ['root', 'sidebar', 'conversation', 'details', 'shell.overlay', 'settings.section', 'settings.trigger', 'settings.header', 'settings.action', 'settings.close', 'settings.onboarding', 'sidebar.settings', 'settings.general.item'];
  function versionSnapshot() {
    const out = Object.create(null);
    if (!hostRef) return out;
    for (const k of SLOT_KEYS) {
      try { const v = hostRef.getVersion(k); if (typeof v === 'number') out[k] = v; } catch (e) { }
    }
    return out;
  }
  let lastVersions = versionSnapshot();
  let versionGen = 0;
  const versionTransitions = [];
  function versionDelta() {
    const cur = versionSnapshot();
    const delta = Object.create(null);
    let any = false;
    for (const k in cur) {
      const prev = lastVersions[k];
      if (prev === undefined || cur[k] !== prev) { delta[k] = { from: prev === undefined ? null : prev, to: cur[k] }; any = true; }
    }
    if (any) versionGen++;
    lastVersions = cur;
    return { any, delta, gen: versionGen };
  }

  // ------------------------------------------------------------- independent poll
  let pollTimer = null;
  function startPolling() {
    if (pollTimer !== null) return;
    const tick = () => {
      try {
        if (!hostRef) resolveTargets();
        if (hostRef) {
          const cur = versionSnapshot();
          for (const k in cur) {
            if (lastVersions[k] !== cur[k]) {
              versionTransitions.push({ tMs: Math.round(now()), epochMs: Date.now(), key: k, from: lastVersions[k] === undefined ? null : lastVersions[k], to: cur[k], commitCount: IS.commitCount });
              if (versionTransitions.length > 500) versionTransitions.shift();
            }
          }
          lastVersions = cur;
          IS.versionPolls[IS.versionPollCount % IS.versionPollCap] = { t: Math.round(now()), v: Object.assign(Object.create(null), cur) };
          IS.versionPollCount++;
        }
      } catch (e) { if (IS.versionPollErrors.length < 20) IS.versionPollErrors.push({ t: now(), msg: String(e && e.message || e) }); }
      pollTimer = setTimeout(tick, 25);
    };
    pollTimer = setTimeout(tick, 25);
  }
  startPolling();

  // ------------------------------------------------------------- subtree scan
  function scanSubtree(rootFiber) {
    let total = 0, pw = 0, ran = 0;
    const names = Object.create(null);
    const stack = [rootFiber.child];
    let g = 0;
    while (stack.length && g++ < 20000) {
      const f = stack.pop();
      if (!f) continue;
      if (COMPONENT_TAGS.has(f.tag)) {
        total++;
        const p = performed(f);
        if (p) pw++;
        const r = ranHooks(f);
        if (r) ran++;
        if (p || r) {
          const n = nameOf(f) || 'anon';
          names[n] = (names[n] || 0) + 1;
        }
      }
      if (f.sibling) stack.push(f.sibling);
      if (f.child) stack.push(f.child);
    }
    return { total, pw, ran, names };
  }

  // ------------------------------------------------------------- commit handler
  function onCommit(root, priority) {
    const t = Math.round(now());
    const rec = {
      t,
      epochMs: Date.now(),
      commitIndex: IS.commitCount,
      priority: priority === undefined ? null : String(priority),
      chain: [],
      panelSubtree: null,
      dom: null,
      ver: null,
      micro: null,
    };
    const resolved = resolveTargets();
    if (resolved && chainSet.length) {
      const comps = resolved.comps;
      for (const f of comps.slice(0, 14)) {
        const n = nameOf(f) || 'anon';
        const props = f.memoizedProps;
        const propsId = props && typeof props === 'object' ? oid(props) : String(propsId0(props));
        const prev = lastProps[n];
        const isNew = prev !== undefined && prev !== propsId;
        lastProps[n] = propsId;
        propTotal[n] = (propTotal[n] || 0) + 1;
        if (isNew) propNewCount[n] = (propNewCount[n] || 0) + 1;
        rec.chain.push({
          name: n,
          pw: performed(f),
          ran: ranHooks(f),
          flags: (f.flags | 0),
          propsId,
          propsNew: isNew,
        });
      }
    }
    // panel subtree
    if (resolved && resolved.comps.length) {
      const panel = resolved.comps[0];
      rec.panelSubtree = scanSubtree(panel);
    }
    // dom
    try {
      const el = document.querySelector('div[role="dialog"][aria-modal="true"]');
      if (el) {
        const h = panelTextHash(el);
        const sameNode = el === domNodeRef;
        domNodeRef = el;
        rec.dom = { hash: h.hash, len: h.len, nodeReplaced: !sameNode, changed: lastDom === null ? false : (h.hash !== lastDom.hash) };
        lastDom = h;
      }
    } catch (e) { }
    // versions
    const vd = versionDelta();
    rec.ver = { any: vd.any, delta: vd.delta, gen: vd.gen };
    rec.micro = { scheduled: IS.micro.scheduled, invoked: IS.micro.invoked };
    // store
    if (IS.commits.length < IS.commitCap) IS.commits.push(rec);
    else { IS.commits.shift(); IS.commits.push(rec); }
    return rec;
  }
  function propsId0(p) {
    if (p === null) return 'null';
    if (p === undefined) return 'undef';
    const t = typeof p;
    return t === 'object' ? 'obj?' : t + ':' + String(p).slice(0, 30);
  }

  // ------------------------------------------------------------- hook identity channel
  // Tracks the observable VALUE identity each component's hooks hold (uSES renders the
  // holder only when the value identity changes) — independent of the PerformedWork flag.
  // Sampled on a timer, not per commit, so it also attributes churn to store notifications
  // that never produce a commit.
  const hookWatch = Object.create(null); // name -> { rendered, snapshotChange, lastValId, valCount }
  let hookSampleCount = 0;
  const hookSamples = [];
  function sampleHooks() {
    try {
      if (!chainSet.length) return;
      const row = { t: Math.round(now()), commitCount: IS.commitCount, comps: [] };
      for (const f of chainSet.slice(0, 10)) {
        const n = nameOf(f) || 'anon';
        let w = hookWatch[n];
        if (!w) w = hookWatch[n] = { rendered: 0, snapshotChange: 0, lastValId: null, valCount: 0 };
        const vals = [];
        let h = f.memoizedState, g = 0;
        while (h && g++ < 30) {
          const v = h.memoizedState;
          const isObj = v !== null && typeof v === 'object';
          vals.push(isObj ? oid(v) : (typeof v) + ':' + String(v).slice(0, 16));
          h = h.next;
        }
        w.valCount = vals.length;
        if (performed(f)) w.rendered++;
        const joined = vals.join(',');
        const changed = w.lastValId !== null && w.lastValId !== joined;
        if (changed) w.snapshotChange++;
        w.lastValId = joined;
        row.comps.push({ name: n, vals: vals.slice(0, 8), changed, ran: ranHooks(f) });
      }
      hookSamples.push(row);
      if (hookSamples.length > 4000) hookSamples.shift();
      hookSampleCount++;
    } catch (e) { if (IS.errors.length < 60) IS.errors.push({ t: now(), where: 'sampleHooks', msg: String(e && e.message || e) }); }
  }
  setInterval(sampleHooks, 100);

  // The kernel defines window.__ModuleLoader__ AFTER document-start scripts run, so
  // every loader seam must be installed by polling rather than by direct access.
  function pollInstall(fn) {
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      let ok = false;
      try { ok = fn(); } catch (e) { }
      if (ok || tries > 600) { clearInterval(t); if (!ok) IS.pollGiveUp = (IS.pollGiveUp || []).concat(fn.name); }
    }, 20);
    try { fn(); } catch (e) { }
  }

  // @deepseek-ai/dsh-client-ui-slots is NOT a bundle in the boot graph (50 entries, no
  // slots entry): it is a platform SEED module, so no loader registration seam ever sees
  // it. It is, however, a named class definition, so we catch it at definition time by
  // wrapping Object.defineProperty at document-start and claiming a class whose prototype
  // carries the slot-registry mutation primitive.
  (function interceptClassDefs() {
    try {
      const od = Object.defineProperty;
      Object.defineProperty = function (obj, key, desc) {
        try {
          const v = desc && desc.value;
          const nameOk = (key === 'SlotCore') || (typeof v === 'function' && v.name === 'SlotCore');
          if (nameOk && typeof v === 'function' && v.prototype && typeof v.prototype.markDirty === 'function' && !v.prototype.__scWrapped) {
            IS.slotCoreDefSeen = { key: String(key), atMs: Math.round(now()) };
            if (!coreHook.installed) { try { wrapProto(v.prototype, 'classDef:' + String(key)); } catch (e) { coreHook.err = String(e && e.message || e); } }
          }
        } catch (e) { }
        return od.apply(this, arguments);
      };
      IS.definePropertyHook = 'installed';
    } catch (e) { IS.definePropertyHook = String(e && e.message || e); }
  })();

  // ------------------------------------------------------------- host capture at the seam
  // React's useContext creates NO hook node, so the renderer host is not reachable from
  // any mounted fiber's hook list (measured: SlotOutlet hook#1 memoizedState is the uSES
  // store, not the host). The host IS the argument of the renderer's renderRoot, so we
  // capture it there: ui-renderer's factory body assigns exports.createSlotRenderer at
  // materialization time, which the module loader performs inside loadCache.set — i.e.
  // while our own __ModuleLoader__.load hook is still on the stack. Intercepting that
  // assignment is therefore deterministic, not a timing race.
  IS.hostCapture = { installed: false, how: null, renderRootCalls: 0, subscribeCalls: 0, getVersionCalls: 0, subscribeKeys: Object.create(null), getVersionKeys: Object.create(null) };
  function captureHost(h) {
    if (!h || hostRef) return;
    if (typeof h.getVersion !== 'function' || typeof h.subscribe !== 'function') return;
    hostRef = h;
    IS.hostResolve.ok = true;
    IS.hostResolve.how = 'renderRoot(host) seam -> captured host object';
    IS.hostResolve.hostKeys = Object.keys(h).slice(0, 40);
    try {
      const os = h.subscribe.bind(h), og = h.getVersion.bind(h);
      h.subscribe = function (key, fn) { try { IS.hostCapture.subscribeCalls++; IS.hostCapture.subscribeKeys[key] = (IS.hostCapture.subscribeKeys[key] || 0) + 1; } catch (e) { } return os(key, fn); };
      h.getVersion = function (key) { try { IS.hostCapture.getVersionCalls++; IS.hostCapture.getVersionKeys[key] = (IS.hostCapture.getVersionKeys[key] || 0) + 1; } catch (e) { } return og(key); };
      IS.hostCapture.installed = true;
      IS.hostCapture.how = 'wrapped host.subscribe/getVersion for call counting';
    } catch (e) { IS.hostCapture.err = String(e && e.message || e); }
  }
  // The module-system bundle's factory is invoked ONLY by __ModuleLoader__.create, and
  // that call happens inside the bundle's own evaluation. So create's argument is the
  // module-system instance: capturing it there needs no global and no timing assumption.
  let moduleSystem = null;
  function installCreateHook() {
    try {
      const ML = window.__ModuleLoader__;
      if (!ML) { IS.createHook = 'waiting for __ModuleLoader__'; return false; }
      if (typeof ML.create !== 'function') { IS.createHook = 'facade has no create (already live)'; IS.loaderAlreadyLive = Object.keys(ML); return true; }
      if (ML.__scCreateHooked) { IS.createHook = 'already'; return true; }
      ML.__scCreateHooked = true;
      const prevCreate = ML.create.bind(ML);
      ML.create = function () {
        for (let i = 0; i < arguments.length; i++) {
          const a = arguments[i];
          if (a && typeof a === 'object' && a.loadCache instanceof Map && a.factories instanceof Map) moduleSystem = a;
        }
        const r = prevCreate.apply(null, arguments);
        try { if (!moduleSystem) moduleSystem = r; } catch (e) { }
        IS.createHook = 'captured via create()';
        return r;
      };
      IS.createHook = 'installed';
      return true;
    } catch (e) { IS.createHook = String(e && e.message || e); return false; }
  }
  pollInstall(installCreateHook);
  function findSlotCoreClass() {
    if (typeof slotCoreClass === 'function') return slotCoreClass;
    try {
      const seen = [];
      const consider = (exportsObj, label) => {
        if (!exportsObj || typeof exportsObj !== 'object') return false;
        seen.push(label + ':' + Object.keys(exportsObj).slice(0, 6).join(','));
        const SC = exportsObj.SlotCore;
        if (typeof SC === 'function' && SC.prototype && typeof SC.prototype.markDirty === 'function') { slotCoreClass = SC; return true; }
        return false;
      };
      if (moduleSystem) {
        if (moduleSystem.loadCache instanceof Map) moduleSystem.loadCache.forEach((r, id) => { try { consider(r && r.exports, 'ms:' + id); } catch (e) { } });
        if (moduleSystem.factories instanceof Map) moduleSystem.factories.forEach((f, id) => { try { consider(f && f.exports, 'msf:' + id); } catch (e) { } });
        IS.moduleSystemSeen = (moduleSystem.loadCache ? moduleSystem.loadCache.size : -1) + '/' + (moduleSystem.factories ? moduleSystem.factories.size : -1);
      }
      IS.coreCandidatesSeen = seen.slice(0, 25);
    } catch (e) { IS.coreFindErr = String(e && e.message || e); }
    return slotCoreClass;
  }

  // Any bundle calling __ModuleLoader__.load({id: <slots>}) has its exports object
  // assigned RIGHT AFTER its factory returns — still inside the module loader's
  // materialization, so this setter fires deterministically. That is how we obtain the
  // real SlotCore class (declared, never instantiated — the registry instance stays the
  // runtime service's own).
  let slotCoreClass = null;
  function installSlotsLoaderHook() {
    try {
      const ML = window.__ModuleLoader__;
      if (!ML || typeof ML.load !== 'function') { IS.slotsLoaderHook = 'waiting for __ModuleLoader__'; return false; }
      if (ML.__scSlotsHooked) { IS.slotsLoaderHook = 'already'; return true; }
      ML.__scSlotsHooked = true;
      const prevLoad = ML.load;
      ML.load = function (reg) {
        try {
          if (reg && typeof reg.id === 'string' && reg.id.indexOf('client-ui-slots') >= 0 && typeof reg.factory === 'function') {
            const origFactory = reg.factory;
            reg = Object.assign({}, reg, {
              factory: (require) => {
                const inner = origFactory(require);
                try {
                  Object.defineProperty(inner, 'SlotCore', {
                    configurable: true,
                    set(v) { slotCoreClass = v; try { if (!coreHook.installed) installCoreHook(); } catch (e) { } },
                    get() { return slotCoreClass; },
                  });
                } catch (e) { coreHook.err = 'slots factory interception failed: ' + String(e && e.message || e); }
                return inner;
              },
            });
            IS.slotsBundleId = reg.id;
          }
        } catch (e) { }
        return prevLoad.call(ML, reg);
      };
      IS.slotsLoaderHook = 'installed';
      return true;
    } catch (e) { IS.slotsLoaderHook = String(e && e.message || e); return false; }
  }
  pollInstall(installSlotsLoaderHook);

  function installLoaderHook() {
    try {
      const ML = window.__ModuleLoader__;
      if (!ML || typeof ML.load !== 'function') { IS.hostCapture.hooked = 'waiting for __ModuleLoader__'; return false; }
      if (ML.__scRendererHooked) return true;
      ML.__scRendererHooked = true;
      const prevLoad = ML.load;
      ML.load = function (reg) {
        let out;
        try {
          if (reg && reg.id === '@deepseek-ai/dsh-client-ui-renderer' && typeof reg.factory === 'function') {
            const origFactory = reg.factory;
            reg = Object.assign({}, reg, {
              factory: (require) => {
                const box = {};
                const inner = origFactory(require);
                let wrapped = false;
                try {
                  Object.defineProperty(box, 'createSlotRenderer', {
                    configurable: true,
                    set(v) {
                      const fn = typeof v === 'function' ? function () {
                        const r = v.apply(this, arguments);
                        try {
                          if (r && typeof r.renderRoot === 'function') {
                            const origRR = r.renderRoot;
                            r.renderRoot = function (host, ownerProps) { IS.hostCapture.renderRootCalls++; captureHost(host); return origRR.call(this, host, ownerProps); };
                          }
                        } catch (e) { IS.hostCapture.wrapErr = String(e && e.message || e); }
                        return r;
                      } : v;
                      inner.createSlotRenderer = fn;
                      wrapped = true;
                    },
                    get() { return inner.createSlotRenderer; },
                  });
                } catch (e) { IS.hostCapture.err = 'factory interception failed: ' + String(e && e.message || e); }
                return inner;
              },
            });
            void wrapped;
          }
          out = prevLoad.call(ML, reg);
        } catch (e) { IS.errors.push({ t: now(), where: 'loaderHook', msg: String(e && e.message || e) }); throw e; }
        return out;
      };
      IS.hostCapture.hooked = 'ModuleLoader.load';
      return true;
    } catch (e) { IS.errors.push({ t: now(), where: 'installLoaderHook', msg: String(e && e.message || e) }); return false; }
  }
  pollInstall(installLoaderHook);

  // ------------------------------------------------------------- SlotCore direct hook
  // Wraps the slot registry's mutation primitive and its notify surfaces on the
  // PROTOTYPE (never instantiating, never replacing the class), so every mutation of
  // "the slot version" is attributed to a concrete call stack, and every uSES
  // notification is counted. Installed by discovering the ui-slots exports object
  // through the client module loader.
  const coreHook = {
    installed: false, how: null, err: null, hookedSeen: null,
    bumpCount: 0, notifyCount: 0, subCount: 0, getVersionCount: 0,
    perKey: Object.create(null), perStack: Object.create(null), perNotifyStack: Object.create(null),
    bumps: [], notifies: [], wrappedSites: [], perKeySub: null,
  };
  IS.coreHook = coreHook;
  const triedProtos = [];
  function frames(n) {
    try {
      const st = (new Error()).stack || '';
      return st.split('\n').slice(2, 2 + (n || 8)).map((x) => {
        const t = x.trim();
        const m = t.match(/(?:at\s+)([A-Za-z0-9_$.<>]+)/);
        return m ? m[1] : t.slice(0, 70);
      }).filter(Boolean);
    } catch (e) { return []; }
  }
  function wrapProto(proto, label) {
    if (!proto || proto.__scWrapped) return !!proto;
    const origMark = proto.markDirty;
    const origFlush = proto.flush;
    const origSub = proto.subscribe;
    const origGet = proto.getVersion;
    if (typeof origMark !== 'function') return false;
    proto.markDirty = function (key, rec) {
      try {
        const f = frames(9);
        const sig = f.slice(0, 6).join(' <- ');
        coreHook.bumpCount++;
        coreHook.perKey[key] = (coreHook.perKey[key] || 0) + 1;
        coreHook.perStack[sig] = (coreHook.perStack[sig] || 0) + 1;
        if (coreHook.bumps.length < 2000) coreHook.bumps.push({ t: Math.round(now()), commitCount: IS.commitCount, key, versionBefore: rec && rec.version, frames: f, stack: f.join(' | ').slice(0, 900) });
      } catch (e) { }
      return origMark.call(this, key, rec);
    };
    if (typeof origFlush === 'function') {
      proto.flush = function () {
        try {
          const recs = this.dirty ? [...this.dirty] : [];
          const keys = recs.map((r) => (r && r.spec ? 'decl' : 'rec') + ':' + (recs.indexOf(r)));
          const before = [];
          for (const r of recs) before.push({ listeners: r && r.listeners ? r.listeners.size : -1 });
          const notifyStack = frames(7);
          const sig = notifyStack.slice(0, 5).join(' <- ');
          coreHook.notifyCount += recs.length;
          coreHook.perNotifyStack[sig] = (coreHook.perNotifyStack[sig] || 0) + 1;
          if (coreHook.notifies.length < 1500) coreHook.notifies.push({ t: Math.round(now()), commitCount: IS.commitCount, recordsFlushed: recs.length, listenersPerRecord: before.map((b) => b.listeners), frames: notifyStack, stack: notifyStack.join(' | ').slice(0, 800) });
        } catch (e) { }
        return origFlush.apply(this, arguments);
      };
    }
    if (typeof origSub === 'function') {
      proto.subscribe = function (key, fn) {
        try { coreHook.subCount++; coreHook.perKeySub = coreHook.perKeySub || Object.create(null); coreHook.perKeySub[key] = (coreHook.perKeySub[key] || 0) + 1; } catch (e) { }
        return origSub.call(this, key, fn);
      };
    }
    if (typeof origGet === 'function') {
      proto.getVersion = function (key) {
        try { coreHook.getVersionCount++; } catch (e) { }
        return origGet.call(this, key);
      };
    }
    proto.__scWrapped = true;
    if (coreHook.wrappedSites.indexOf(label) < 0) coreHook.wrappedSites.push(label);
    coreHook.installed = true;
    coreHook.how = label;
    return true;
  }
  function installCoreHook() {
    if (coreHook.installed) return true;
    const SC = findSlotCoreClass();
    if (typeof SC === 'function' && SC.prototype && typeof SC.prototype.markDirty === 'function') {
      if (wrapProto(SC.prototype, 'resolved:SlotCore.prototype')) return true;
    }
    try {
      if (moduleSystem && moduleSystem.loadCache instanceof Map) {
        let core = null;
        moduleSystem.loadCache.forEach((r) => {
          if (core) return;
          const ex = r && r.exports;
          if (!ex || typeof ex !== 'object') return;
          for (const k in ex) {
            const v = ex[k];
            if (v && typeof v === 'object' && v.constructor && v.constructor.name === 'SlotRegistry' && v._core) core = v._core;
          }
        });
        if (core) return wrapProto(Object.getPrototypeOf(core), 'via SlotRegistry service instance');
      }
    } catch (e) { }
    const seen = [];
    let found = false;
    const consider = (exports, label) => {
      if (!exports || typeof exports !== 'object') return false;
      seen.push(label + ':' + Object.keys(exports).slice(0, 8).join(','));
      const SC = exports.SlotCore;
      if (typeof SC !== 'function' || !SC.prototype || typeof SC.prototype.markDirty !== 'function') return false;
      if (triedProtos.indexOf(SC.prototype) < 0) triedProtos.push(SC.prototype);
      return wrapProto(SC.prototype, label + '.SlotCore.prototype');
    };
    try {
      const ML = window.__ModuleLoader__;
      if (ML) {
        if (ML.loadCache && typeof ML.loadCache.forEach === 'function') ML.loadCache.forEach((rec, id) => { try { if (consider(rec && rec.exports, 'loadCache:' + id)) found = true; } catch (e) { } });
        if (ML.factories && typeof ML.factories.forEach === 'function') ML.factories.forEach((f, id) => { try { if (consider(f && f.exports, 'factory:' + id)) found = true; } catch (e) { } });
      }
      if (coreHook.hookedSeen === null) coreHook.hookedSeen = seen.slice(0, 40);
    } catch (e) { coreHook.err = String(e && e.message || e); }
    if (!coreHook.installed && !coreHook.err) coreHook.err = 'SlotCore not found via __ModuleLoader__ yet (' + seen.length + ' module candidates)';
    return coreHook.installed;
  }
  // retry until it lands (modules materialize during boot)
  let coreTries = 0;
  const coreTimer = setInterval(() => {
    coreTries++;
    if (installCoreHook() || coreTries > 60) clearInterval(coreTimer);
  }, 500);

  // ------------------------------------------------------------- public API
  IS.probe = () => ({
    version: IS.version,
    inject: IS.hookCalls.inject,
    onCommitFiberRoot: IS.hookCalls.onCommitFiberRoot,
    onPostCommitFiberRoot: IS.hookCalls.onPostCommitFiberRoot,
    hookPreexisting: IS.hookPreexisting,
    injected: IS.injected,
    rendererPackageName: IS.injected.map((x) => x.rendererPackageName),
    rendererVersion: IS.injected.map((x) => x.version),
    bundleType: IS.injected.map((x) => x.bundleType),
    commits: IS.commitCount,
    hostResolve: IS.hostResolve,
    micro: Object.assign({}, IS.micro),
    versionPollCount: IS.versionPollCount,
    versionTransitions: versionTransitions.length,
    definePropertyHook: IS.definePropertyHook, slotCoreDefSeen: IS.slotCoreDefSeen,
    createHook: IS.createHook, moduleSystemSeen: IS.moduleSystemSeen, coreCandidatesSeen: IS.coreCandidatesSeen, coreFindErr: IS.coreFindErr,
    slotsLoaderHook: IS.slotsLoaderHook, slotsBundleId: IS.slotsBundleId, slotCoreClassSeen: typeof slotCoreClass === 'function',
    hostCapture: { installed: IS.hostCapture.installed, how: IS.hostCapture.how, renderRootCalls: IS.hostCapture.renderRootCalls, subscribeCalls: IS.hostCapture.subscribeCalls, getVersionCalls: IS.hostCapture.getVersionCalls, err: IS.hostCapture.err, wrapErr: IS.hostCapture.wrapErr },
    coreHook: { installed: coreHook.installed, how: coreHook.how, err: coreHook.err, bumpCount: coreHook.bumpCount, perKey: coreHook.perKey, perStack: coreHook.perStack },
    errors: IS.errors.slice(0, 10),
  });
  IS.coreHookReport = () => ({
    installed: coreHook.installed, how: coreHook.how, err: coreHook.err, wrappedSites: coreHook.wrappedSites,
    bumpCount: coreHook.bumpCount, notifyCount: coreHook.notifyCount, subCount: coreHook.subCount, getVersionCount: coreHook.getVersionCount,
    perKey: Object.assign({}, coreHook.perKey), perKeySub: Object.assign({}, coreHook.perKeySub || {}),
    perStack: Object.assign({}, coreHook.perStack), perNotifyStack: Object.assign({}, coreHook.perNotifyStack),
    bumps: coreHook.bumps.slice(-60), notifies: coreHook.notifies.slice(-40), hookedSeen: coreHook.hookedSeen,
  });
  IS.snapshotChain = () => {
    const r = resolveTargets();
    if (!r) return null;
    return r.comps.slice(0, 14).map((f) => ({ name: nameOf(f), tag: f.tag, key: f.key, hasAlternate: !!f.alternate }));
  };
  IS.versions = () => versionSnapshot();
  IS.versionsNow = () => ({ gen: versionGen, cur: versionSnapshot(), transitions: versionTransitions.slice(-80) });
  IS.hookStats = () => Object.assign({}, hookWatch);
  IS.hookSamples = (sinceT) => {
    const lo = typeof sinceT === 'number' ? sinceT : 0;
    return { count: hookSampleCount, rows: hookSamples.filter((r) => r.t >= lo) };
  };
  IS.propStats = () => ({ total: Object.assign({}, propTotal), newProps: Object.assign({}, propNewCount) });
  IS.drain = (since) => {
    const lo = typeof since === 'number' ? since : 0;
    const out = IS.commits.filter((c) => c.t >= lo);
    return out;
  };
  IS.drainVersions = (sinceT, sinceN) => {
    const lo = typeof sinceT === 'number' ? sinceT : 0;
    const n0 = typeof sinceN === 'number' ? sinceN : 0;
    const trans = versionTransitions.filter((x) => x.tMs >= lo);
    const polls = [];
    for (let i = n0; i < IS.versionPollCount; i++) {
      const r = IS.versionPolls[i % IS.versionPollCap];
      if (r && r.t >= lo) polls.push(r);
    }
    return { transitions: trans, pollCount: IS.versionPollCount, polls: polls.length, lastPoll: IS.versionPolls[(IS.versionPollCount - 1 + IS.versionPollCap) % IS.versionPollCap] || null };
  };
  IS.reset = () => { IS.commits.length = 0; versionTransitions.length = 0; };
  IS.mark = (label) => { IS.marks.push({ t: Math.round(now()), epochMs: Date.now(), label, commitCount: IS.commitCount }); };
})();
