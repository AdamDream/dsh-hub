/* Diagnostic: does the Object.defineProperty interception of the uSES shim fire? */
(() => {
  const LOG = { hits: [], allDefine: 0, first100: [] };
  window.__DBG__ = LOG;
  const orig = Object.defineProperty;
  Object.defineProperty = function (t, p, d) {
    try {
      LOG.allDefine++;
      if (LOG.first100.length < 100) LOG.first100.push({ t: typeof t, p: String(p), v: typeof (d && d.value) });
      if (String(p).includes('useSyncExternalStore') || String(p).includes('WithSelector')) {
        LOG.hits.push({
          when: Math.round(performance.now()),
          targetType: t === null ? 'null' : typeof t,
          targetCtor: t && t.constructor && t.constructor.name,
          keys: t && typeof t === 'object' ? Object.keys(t).slice(0, 12) : null,
          prop: String(p),
          valueType: typeof (d && d.value),
          valueName: d && typeof d.value === 'function' ? (d.value.name || 'anonymous') : null,
          hasUseSyncExternalStore: !!(t && t.useSyncExternalStore),
        });
      }
    } catch { }
    return orig.apply(Object, [t, p, d]);
  };
  // also watch the react-dom internals surface
  setTimeout(() => {
    try {
      const h = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
      LOG.renderers = h && h.renderers ? [...h.renderers.keys()] : null;
      LOG.internalsKeys = h && h.renderers ? [...h.renderers.values()].map((v) => Object.keys(v).slice(0, 30)) : null;
    } catch (e) { LOG.err = String(e); }
  }, 9000);
})();
