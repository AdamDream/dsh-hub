/*
 * root-subscriptions / instrumented init script (document-start).
 *
 * Independent implementation (does NOT reuse or modify react-commit/lib-init.js).
 *
 * Goal: attribute every SettingsRoot self-render to a concrete cause, at code-line
 * resolution, for the two whole-object selectors in
 * packages/client/ui-settings-general/src/client/SettingsRoot.tsx:
 *     const rows = useSections((s) => s);
 *     const onboardingSteps = useOnboardingSteps((s) => s);
 *
 * Instrumentation surfaces (all read-only; no product file is touched):
 *
 *  1. React DevTools hook adoption: count inject / onCommitFiberRoot, record
 *     renderer id + react version (premise self-proof).
 *  2. Object.entries patch: the renderer's bindInjectHooks / cachedSlotInject
 *     iterate `Object.entries(face.hooks)` to turn each hook source into a
 *     `use<Name>` SnapshotSelectorHook. We hand back a wrapped source for the
 *     `sections` and `onboardingSteps` keys, so we observe the real
 *     getSnapshot()/subscribe() the component actually uses.
 *  3. uSES(withSelector) module patch: wrap the `useSyncExternalStoreWithSelector`
 *     property on the CommonJS exports object, so that the (subscribe, getSnapshot,
 *     getServerSnapshot, selector, isEqual) tuple uSES receives is intercepted.
 *     For our two stores we record, per render: raw snapshot identity, selector
 *     output identity, and whether the raw snapshot notified since the last render.
 *  4. slots service patch: wrap SlotRegistry.getVersion on the instance to record
 *     version counters per slot key (settings.section / settings.onboarding / ...),
 *     and patch EventEmitter.prototype.emit to record every `slots/changed` event.
 *  5. locale store patch: wrap locale.getSnapshot to record { revision, locale }.
 *  6. Commit recorder: find SettingsRoot in the committed tree, record its hook-0
 *     value (the panel `open` useState) and the ancestor chain's render signals.
 */
(() => {
  if (window.__SR__ && window.__SR__.version >= 1) return;

  const CAP = 20000;
  const now = () => performance.now();

  const SR = {
    version: 1,
    boot: { t: now(), url: location.href },
    hookCalls: { inject: 0, onCommitFiberRoot: 0, onPostCommitFiberRoot: 0, onCommitFiberUnmount: 0 },
    injected: [],
    rendererIds: [],
    // store observation
    storeNames: [],
    notify: [],           // {t, store, n}
    snapshot: [],         // per getSnapshot call
    subscribeRefs: {},    // store -> [refs]
    // selector-hook observation (one record per useSelector invocation)
    selCalls: [],
    // slot / locale observation
    slotVersionReads: [],
    slotChanges: [],
    localeSnapshots: [],
    // commits
    commits: [],          // {i, t, panel, target:{...}, chain:[...]}
    marks: [],
    shimTrapLog: [],
    errors: [],
    flags: {},
    counts: { commits: 0, targetRenderId: 0, targetRenderPw: 0, targetMounted: 0 },
    manual: {},
  };
  window.__SR__ = SR;

  const push = (arr, v) => { if (arr.length < CAP) arr.push(v); else arr[arr.length - 1] = v; };
  const rt = (t) => Math.round(t * 100) / 100;
  const safe = (fn, label) => { try { return fn(); } catch (e) { push(SR.errors, { t: now(), label, msg: String(e && e.message || e) }); return undefined; } };

  // ------------------------------------------------------------------ 1. hook
  const rootsByRenderer = new Map();
  let firstRendererId = null;

  function nameOf(f) {
    try {
      const t = f.type || f.elementType;
      if (typeof t === 'string') return 'host:' + t;
      if (typeof t === 'function') return t.displayName || t.name || 'anon';
      if (t && typeof t === 'object') return t.displayName || t.render?.name || 'obj';
      return String(t);
    } catch { return '?'; }
  }
  function hname(f) {
    try {
      const t = f.type || f.elementType;
      if (typeof t === 'string') return 'host:' + t;
      return null; // component only
    } catch { return null; }
  }
  const comp = (f) => { const n = hname(f); return n === null; };

  function signalPw(f) { try { return ((f.flags | 0) & 1) === 1; } catch { return false; } }
  /**
   * React DevTools' didFiberRender: a fiber "ran" when it has an alternate and
   * either props or hooks-state identity differs from it. uSES-driven renders and
   * parent-driven renders both allocate a fresh memoizedState hook chain.
   */
  function signalId(f) {
    try {
      const a = f.alternate;
      if (a === null || a === undefined) return true;
      return f.memoizedProps !== a.memoizedProps || f.memoizedState !== a.memoizedState;
    } catch { return false; }
  }
  function isCurrentIn(f, root) {
    try { let c = root.current; if (c === f) return true; if (f.alternate === c) return false; return null; } catch { return null; }
  }

  // SettingsRoot hook chain (from the live bundle, live-dsh-client-ui-settings-general.js:175-201):
  //   0 useState(open) 1 useState(activeId) 2 useState(completedOnboarding)
  //   3 useCallback(close) 4 useCallback(openSection)
  //   5 useSections((s)=>s) 6 useOnboardingSteps((s)=>s) 7 useSessions(sel)
  //   8 useEffect(deps) 9 useCallback(completeOnboardingStep)
  const SR_HOOK_COUNT = 10;
  const SEL_HOOKS = { 5: 'sections', 6: 'onboardingSteps', 7: 'sessions' };
  const RENDER_HOOKS = { 2: 'completedOnboarding' };

  function hookAt(f, i) {
    try {
      let h = f.memoizedState;
      for (let k = 0; k < i && h; k++) h = h.next;
      return h;
    } catch { return null; }
  }

  /**
   * Read the uSES selector hook chain of a committed SettingsRoot fiber straight
   * from the fiber (no module patching needed):
   *   hook5.memoizedState = rows (useSections((s) => s) output)
   *   hook6.memoizedState = onboardingSteps
   *   hook7.memoizedState = the sessions boolean
   * and compare each against the alternate fiber, which holds the value from the
   * previous committed render of this same fiber. That is exactly the identity
   * comparison React's didFiberRender / uSES bailout is based on.
   */
  function readSelHooks(f) {
    const out = {};
    const a = f.alternate;
    for (const k of Object.keys(SEL_HOOKS)) {
      const i = Number(k);
      const h = hookAt(f, i);
      const ha = a ? hookAt(a, i) : null;
      const cur = h ? h.memoizedState : '__none__';
      const alt = ha ? ha.memoizedState : '__none__';
      const altPresent = !!ha;
      out[SEL_HOOKS[k]] = {
        kind: cur === null ? 'null' : Array.isArray(cur) ? 'array' : typeof cur,
        len: Array.isArray(cur) ? cur.length : null,
        val: typeof cur === 'boolean' ? cur : (typeof cur === 'number' || typeof cur === 'string' ? cur : undefined),
        altPresent,
        changedVsAlt: altPresent ? cur !== alt : null,
        altKind: alt === null ? 'null' : Array.isArray(alt) ? 'array' : typeof alt,
        altLen: Array.isArray(alt) ? alt.length : null,
      };
    }
    for (const k of Object.keys(RENDER_HOOKS)) {
      const i = Number(k);
      const h = hookAt(f, i);
      const cur = h ? h.memoizedState : '__none__';
      out[RENDER_HOOKS[k]] = { kind: Array.isArray(cur) ? 'set' : typeof cur, size: cur && cur.size !== undefined ? cur.size : null };
    }
    return out;
  }

  function rowSig(f) {
    const h = hookAt(f, 5);
    const v = h ? h.memoizedState : null;
    if (!Array.isArray(v)) return null;
    return v.map((r) => `${r.id}:${r.order}:${r.label}`).join('|');
  }
  function hookCount(f) { try { let n = 0, h = f.memoizedState; while (h && n < 64) { n++; h = h.next; } return n; } catch { return -1; } }

  function findSettingsRoot(node, depth, out) {
    if (!node || depth > 200) return out;
    if (comp(node) && nameOf(node) === 'SettingsRoot') out.push(node);
    let c = node.child;
    while (c) { findSettingsRoot(c, depth + 1, out); c = c.sibling; }
    return out;
  }

  function chainOf(f) {
    const out = [];
    let n = f;
    let i = 0;
    while (n && i < 14) {
      out.push({
        i,
        name: nameOf(n),
        comp: comp(n),
        pw: signalPw(n),
        id: signalId(n),
        hasAlt: !!n.alternate,
        hooks: comp(n) ? hookCount(n) : null,
      });
      n = n.return;
      i++;
    }
    return out;
  }

  function panelCount() { try { return document.querySelectorAll('div[role="dialog"][aria-modal="true"]').length; } catch { return -1; } }

  const notifiedSince = {}; // store -> commit index of last notify

  function onCommit(kind, rendererID, root, didError) {
    try {
      SR.counts.commits++;
      const i = SR.counts.commits;
      const t = now();
      let s = rootsByRenderer.get(rendererID);
      if (!s) { s = new Set(); rootsByRenderer.set(rendererID, s); }
      s.add(root);
      if (firstRendererId === null) firstRendererId = rendererID;

      const found = findSettingsRoot(root.current, 0, []);
      const rec = {
        i, t: rt(t), kind, renderer: rendererID, didError: !!didError,
        panel: panelCount(),
        nTargets: found.length,
        target: null,
        chain: null,
      };
      if (found.length) {
        let f = found[0];
        // settingsSubtree is the deepest SettingsRoot in the tree; take the one with the most hooks
        for (const c of found) if (hookCount(c) > hookCount(f)) f = c;
        const h0 = hookAt(f, 0);
        rec.target = {
          pw: signalPw(f),
          id: signalId(f),
          isCur: isCurrentIn(f, root),
          hookCount: hookCount(f),
          hook0: h0 ? h0.memoizedState : null,
          mountIdx: h0 && h0.memoizedState === false ? 'closed' : 'open',
          sel: readSelHooks(f),
          rowSig: rowSig(f),
        };
        if (rec.target.id) SR.counts.targetRenderId++;
        if (rec.target.pw) SR.counts.targetRenderPw++;
        SR.counts.targetMounted++;
        rec.chain = chainOf(f);
        rec.notifiedSince = JSON.parse(JSON.stringify(notifiedSince));
      }
      push(SR.commits, rec);

      // expose per-render selector effects that happened during this commit's render phase
      if (SR._pendingSel && SR._pendingSel.length) {
        const pend = SR._pendingSel;
        SR._pendingSel = [];
        // a render burst yields one entry per useSelector invocation for each of the
        // two stores; keep them all, tagged with the commit they surfaced in.
        for (const p of pend) { p.commit = i; p.flushed = true; }
        for (const p of pend) push(SR.selCalls, p);
      }
    } catch (e) { push(SR.errors, { t: now(), label: 'onCommit', msg: String(e && e.message || e) }); }
  }

  function installHook() {
    const existing = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    if (existing) {
      SR.flags.hookPreexisting = true;
      const prevRoot = existing.onCommitFiberRoot;
      const prevPost = existing.onPostCommitFiberRoot;
      const prevUn = existing.onCommitFiberUnmount;
      const prevInject = existing.inject;
      existing.onCommitFiberRoot = function (id, root, p, didError) { SR.hookCalls.onCommitFiberRoot++; onCommit('root', id, root, didError); if (typeof prevRoot === 'function') { try { prevRoot.call(existing, id, root, p, didError); } catch { } } };
      existing.onPostCommitFiberRoot = function (id, root, p) { SR.hookCalls.onPostCommitFiberRoot++; if (typeof prevPost === 'function') { try { prevPost.call(existing, id, root, p); } catch { } } };
      existing.onCommitFiberUnmount = function (id, f) { SR.hookCalls.onCommitFiberUnmount++; if (typeof prevUn === 'function') { try { prevUn.call(existing, id, f); } catch { } } };
      existing.inject = function (internals) {
        SR.hookCalls.inject++;
        SR.injected.push({ t: rt(now()), id: 'wrapped', version: internals && internals.version, pkg: internals && internals.rendererPackageName, bundleType: internals && internals.bundleType, hasScheduleRoot: !!(internals && internals.scheduleRefresh) });
        if (internals) { try { SR.injected[SR.injected.length - 1].reconcilerVersion = internals.reconcilerVersion; } catch { } }
        if (typeof prevInject === 'function') { try { return prevInject.call(existing, internals); } catch (e) { push(SR.errors, { t: now(), label: 'inject', msg: String(e && e.message || e) }); } }
        return 0;
      };
      return;
    }
    let uid = 0;
    const hook = {
      supportsFiber: true,
      renderers: new Map(),
      inject(internals) {
        const id = ++uid;
        SR.hookCalls.inject++;
        SR.injected.push({ t: rt(now()), id, version: internals && internals.version, pkg: internals && internals.rendererPackageName, bundleType: internals && internals.bundleType, reconcilerVersion: internals && internals.reconcilerVersion, hasScheduleRoot: !!(internals && internals.scheduleRefresh) });
        hook.renderers.set(id, internals);
        return id;
      },
      onCommitFiberRoot(rendererID, root, _p, didError) { SR.hookCalls.onCommitFiberRoot++; onCommit('root', rendererID, root, didError); },
      onPostCommitFiberRoot(rendererID) { SR.hookCalls.onPostCommitFiberRoot++; void rendererID; },
      onCommitFiberUnmount(rendererID) { SR.hookCalls.onCommitFiberUnmount++; void rendererID; },
      getFiberRoots(rendererID) { return rootsByRenderer.get(rendererID) || new Set(); },
      checkDCE() { },
      setStrictMode() { },
    };
    Object.defineProperty(window, '__REACT_DEVTOOLS_GLOBAL_HOOK__', { value: hook, writable: true, configurable: true });
  }
  try { installHook(); } catch (e) { push(SR.errors, { t: now(), label: 'installHook', msg: String(e) }); }

  // ------------------------------------------------- 2. store source wrapping
  const TARGET_KEYS = { sections: true, onboardingSteps: true };
  const origEntries = Object.entries;
  const wrapCache = new WeakMap(); // source -> wrapped source

  function wrapSource(name, source) {
    if (!source || typeof source.getSnapshot !== 'function' || typeof source.subscribe !== 'function') return source;
    const hit = wrapCache.get(source);
    if (hit) return hit;
    const st = { name, notifyN: 0, snapN: 0, lastSnap: undefined, lastSnapT: 0, snapChanges: 0 };
    SR.storeNames.push(name);
    SR.subscribeRefs[name] = [];
    const wrapped = {
      __sr: true,
      __name: name,
      getSnapshot: function () {
        const v = source.getSnapshot();
        st.snapN++;
        const changed = st.snapN > 1 && v !== st.lastSnap;
        if (changed) st.snapChanges++;
        st.lastSnap = v;
        st.lastSnapT = now();
        push(SR.snapshot, {
          t: rt(now()), store: name, n: st.snapN, changed,
          kind: Array.isArray(v) ? 'array' : (v === null ? 'null' : typeof v),
          len: Array.isArray(v) ? v.length : null,
          commit: SR.counts.commits,
          src: SR.counts.commits === 0 ? String(new Error().stack || '').split('\n').slice(1, 8) : null,
        });
        return v;
      },
      subscribe: function (fn) {
        const off = source.subscribe(function () {
          st.notifyN++;
          notifiedSince[name] = SR.counts.commits;
          push(SR.notify, { t: rt(now()), store: name, n: st.notifyN, commit: SR.counts.commits });
          return fn();
        });
        try { SR.subscribeRefs[name].push({ t: rt(now()), fn: 'ok', stack: String(new Error().stack || '').split('\n').slice(1, 6) }); } catch { }
        return off;
      },
    };
    Object.defineProperty(wrapped, '__srSource', { value: source, enumerable: false });
    wrapCache.set(source, wrapped);
    return wrapped;
  }

  Object.entries = function (o) {
    const e = origEntries(o);
    try {
      if (o && !o.__sr && (Object.prototype.hasOwnProperty.call(o, 'sections') || Object.prototype.hasOwnProperty.call(o, 'onboardingSteps'))) {
        let touched = false;
        for (let k = 0; k < e.length; k++) {
          const [key, val] = e[k];
          if (TARGET_KEYS[key] && val && typeof val.getSnapshot === 'function' && !val.__sr) {
            e[k] = [key, wrapSource(key, val)];
            touched = true;
          }
        }
        if (touched && !SR.flags.wrappedStores) {
          SR.flags.wrappedStores = true;
          SR.flags.wrappedAt = rt(now());
        }
      }
    } catch (err) { push(SR.errors, { t: now(), label: 'entries', msg: String(err && err.message || err) }); }
    return e;
  };

  // ------------------------------------------- 3. uSES-with-selector interception
  const selPatchSeen = new WeakSet();
  function patchExportsObject(exportsObj) {
    if (!exportsObj || selPatchSeen.has(exportsObj)) return false;
    const d = Object.getOwnPropertyDescriptor(exportsObj, 'useSyncExternalStoreWithSelector');
    if (!d) return false;
    selPatchSeen.add(exportsObj);
    const orig = exportsObj.useSyncExternalStoreWithSelector;
    Object.defineProperty(exportsObj, 'useSyncExternalStoreWithSelector', {
      configurable: true,
      enumerable: d.enumerable,
      writable: true,
      value: function (subscribe, getSnapshot, getServerSnapshot, selector, isEqual) {
        let tag = null;
        try {
          tag = getSnapshot && getSnapshot.__sr ? getSnapshot.__name : (subscribe && subscribe.__sr ? subscribe.__name : null);
        } catch { }
        if (tag && TARGET_KEYS[tag]) {
          let rawPrev; let selPrev; let rawChanged = null; let selChanged = null;
          const wrappedSelector = function (s) {
            const out = selector(s);
            if (rawPrev === undefined) { rawPrev = s; selPrev = out; rawChanged = null; selChanged = null; }
            else { rawChanged = s !== rawPrev; selChanged = out !== selPrev; rawPrev = s; selPrev = out; }
            return out;
          };
          const start = now();
          const v = orig(subscribe, getSnapshot, getServerSnapshot, wrappedSelector, isEqual);
          const rec = {
            t: rt(start),
            store: tag,
            isEqualArg: isEqual === undefined ? 'undefined(Object.is)' : 'provided',
            rawChanged, selChanged,
            outKind: Array.isArray(v) ? 'array' : (v === null ? 'null' : typeof v),
            outLen: Array.isArray(v) ? v.length : null,
            commit: null,
          };
          if (!SR._pendingSel) SR._pendingSel = [];
          SR._pendingSel.push(rec);
          SR.flags.selPatched = true;
          SR.flags.selPatchedAt = SR.flags.selPatchedAt || rt(start);
          return v;
        }
        return orig(subscribe, getSnapshot, getServerSnapshot, selector, isEqual);
      },
    });
    return true;
  }

  /*
   * The shim exports it by PLAIN ASSIGNMENT inside `__commonJSMin`:
   *   var require_with_selector_production_min = __commonJSMin(((exports) => {
   *     ...
   *     exports.useSyncExternalStoreWithSelector = function (a, b, e, l, g) {...}
   *   }));
   * (live bundle: live-dsh-client-ui-renderer.js:86,92). So Object.defineProperty
   * interception is not enough. We install a set trap on Object.prototype for the
   * single boot window: every plain-object assignment of that property name is
   * captured regardless of which bundled copy performs it. The trap is removed as
   * soon as an install lands (or after the boot window), so it cannot affect the
   * measured windows.
   */
  const origDefineProperty = Object.defineProperty;
  Object.defineProperty = function (target, prop, desc) {
    const r = origDefineProperty(target, prop, desc);
    try {
      if (prop === 'useSyncExternalStoreWithSelector' && desc && typeof desc.value === 'function' && target && typeof target === 'object') {
        patchExportsObject(target);
      }
    } catch { }
    return r;
  };

  let origProtoDesc;
  let trapOn = false;
  function trapOff(reason) {
    if (!trapOn) return;
    trapOn = false;
    try {
      if (origProtoDesc === undefined) delete Object.prototype.useSyncExternalStoreWithSelector;
      else origDefineProperty(Object.prototype, 'useSyncExternalStoreWithSelector', origProtoDesc);
    } catch { }
    SR.flags.shimTrapActive = false;
    SR.flags.shimTrapOffReason = reason;
    SR.flags.shimTrapOffAt = rt(now());
  }
  function installShimTrap() {
    if (trapOn) return;
    try {
      origProtoDesc = Object.getOwnPropertyDescriptor(Object.prototype, 'useSyncExternalStoreWithSelector');
      trapOn = true;
      Object.defineProperty(Object.prototype, 'useSyncExternalStoreWithSelector', {
        configurable: true,
        enumerable: false,
        get() { return undefined; },
        set(v) {
          let landed = false;
          try {
            SR.flags.shimTrapFires = (SR.flags.shimTrapFires || 0) + 1;
            push(SR.shimTrapLog, {
              t: rt(now()), valueType: typeof v,
              thisType: this === null ? 'null' : this === undefined ? 'undefined' : typeof this,
              ctor: (this && this.constructor && this.constructor.name) || null,
              ownKeys: (this && typeof this === 'object' && this !== null) ? Object.keys(this).slice(0, 10) : null,
              sealed: (this && typeof this === 'object') ? Object.isSealed(this) : null,
              frozen: (this && typeof this === 'object') ? Object.isFrozen(this) : null,
              ext: (this && typeof this === 'object') ? Object.isExtensible(this) : null,
            });
            if (typeof v === 'function' && this && typeof this === 'object') {
              SR.flags.shimTrapFired = true;
              SR.flags.shimTrapFiredAt = SR.flags.shimTrapFiredAt || rt(now());
              try {
                origDefineProperty(this, 'useSyncExternalStoreWithSelector', { value: v, writable: true, enumerable: true, configurable: true });
              } catch (e) {
                push(SR.errors, { t: now(), label: 'shimTrap.define', msg: String(e && e.message || e) });
                return;
              }
              landed = patchExportsObject(this);
              SR.shimTrapLog[SR.shimTrapLog.length - 1].landed = landed;
            }
          } catch (e) { push(SR.errors, { t: now(), label: 'shimTrap', msg: String(e && e.message || e) }); }
          if (landed) setTimeout(() => trapOff('installed'), 1500);
        },
      });
      SR.flags.shimTrapActive = true;
      SR.flags.shimTrapAt = rt(now());
      setTimeout(() => { if (trapOn) trapOff('boot-window-expired'); }, 45000);
    } catch (e) { push(SR.errors, { t: now(), label: 'installShimTrap', msg: String(e && e.message || e) }); }
  }
  installShimTrap();

  // Fallback: if some bundler copy defines it via Object.defineProperty on a fresh
  // namespace object, patchExportsObject above already caught it.
  SR.tryPatchExports = function (obj) { return patchExportsObject(obj); };

  // --------------------------------------------------- 4. slots + locale patch
  const origEmit = (window.EventEmitter && window.EventEmitter.prototype && window.EventEmitter.prototype.emit) || null;
  if (origEmit) {
    window.EventEmitter.prototype.emit = function (ev, ...rest) {
      try {
        if (ev === 'slots/changed') {
          push(SR.slotChanges, { t: rt(now()), key: rest[0], commit: SR.counts.commits });
        }
      } catch { }
      return origEmit.apply(this, [ev, ...rest]);
    };
    SR.flags.emitPatched = true;
  }

  const versionPatched = new WeakSet();
  function patchGetVersion(obj) {
    if (!obj || versionPatched.has(obj)) return false;
    const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(obj) || {}, 'getVersion');
    if (!d || typeof d.value !== 'function') return false;
    versionPatched.add(obj);
    const orig = d.value;
    Object.defineProperty(obj, 'getVersion', {
      configurable: true,
      writable: true,
      value: function (key) {
        const v = orig.call(this, key);
        push(SR.slotVersionReads, { t: rt(now()), key, version: v, commit: SR.counts.commits });
        return v;
      },
    });
    SR.flags.getVersionPatched = true;
    return true;
  }

  const localePatched = new WeakSet();
  function patchLocale(obj) {
    if (!obj || localePatched.has(obj)) return false;
    if (typeof obj.getSnapshot !== 'function' || typeof obj.getRevision !== 'function') return false;
    localePatched.add(obj);
    const orig = obj.getSnapshot.bind(obj);
    Object.defineProperty(obj, 'getSnapshot', {
      configurable: true,
      writable: true,
      value: function () {
        const v = orig();
        push(SR.localeSnapshots, { t: rt(now()), revision: v && v.revision, locale: v && v.locale, commit: SR.counts.commits });
        return v;
      },
    });
    SR.flags.localePatched = true;
    return true;
  }

  // Generic discovery: wrap Object.defineProperty usage of the slots/locale faces
  // is not available, so poll the cordis service objects through the fiber props.
  // The slots service instance is reachable as the `host` of every slot renderer;
  // instead of digging we accept the emit-level evidence for slot churn and use the
  // wrapped getSnapshot() for the memoized version values (sections/onboarding).
  SR.probe = () => ({
    hookPresent: typeof window.__REACT_DEVTOOLS_GLOBAL_HOOK__ !== 'undefined',
    hookIsWrapped: !!(window.__REACT_DEVTOOLS_GLOBAL_HOOK__ && window.__REACT_DEVTOOLS_GLOBAL_HOOK__.__srWrapped),
    hookCalls: Object.assign({}, SR.hookCalls),
    injected: SR.injected.slice(),
    flags: Object.assign({}, SR.flags),
    counts: Object.assign({}, SR.counts),
    storeNames: SR.storeNames.slice(),
    ua: navigator.userAgent,
    bootRev: (window.__DSH_BOOT__ && window.__DSH_BOOT__.rev) || null,
    entryCount: (window.__DSH_BOOT__ && window.__DSH_BOOT__.entries && window.__DSH_BOOT__.entries.length) || null,
    errors: SR.errors.slice(0, 20),
  });

  SR.mark = (label) => { push(SR.marks, { t: rt(now()), label, commit: SR.counts.commits }); };
  SR.commitIndex = () => SR.counts.commits;
  SR.tail = (n) => ({
    commits: SR.commits.slice(-n),
    notify: SR.notify.slice(-n),
    snapshot: SR.snapshot.slice(-n),
    selCalls: SR.selCalls.slice(-n),
    slotChanges: SR.slotChanges.slice(-n),
    localeSnapshots: SR.localeSnapshots.slice(-n),
  });
  SR.range = ({ fromCommit, toCommit }) => {
    const f = (x) => x.commit === null || x.commit === undefined || (x.commit > fromCommit && x.commit <= toCommit);
    return {
      commits: SR.commits.filter((c) => c.i > fromCommit && c.i <= toCommit),
      notify: SR.notify.filter(f),
      snapshot: SR.snapshot.filter(f),
      selCalls: SR.selCalls.filter(f),
      slotChanges: SR.slotChanges.filter(f),
      localeSnapshots: SR.localeSnapshots.filter(f),
    };
  };
  SR.dump = () => ({
    probe: SR.probe(),
    commits: SR.commits,
    notify: SR.notify,
    snapshot: SR.snapshot,
    selCalls: SR.selCalls,
    slotVersionReads: SR.slotVersionReads,
    slotChanges: SR.slotChanges,
    localeSnapshots: SR.localeSnapshots,
    marks: SR.marks,
    shimTrapLog: SR.shimTrapLog,
    errors: SR.errors,
    subscribeRefs: SR.subscribeRefs,
    hookCalls: SR.hookCalls,
  });
})();
