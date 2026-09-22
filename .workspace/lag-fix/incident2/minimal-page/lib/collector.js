/*
 * Shared, target-agnostic frame collector — injected with addInitScript() BEFORE
 * any page script runs, so the minimal page and the DSH page are sampled by
 * byte-identical code. It touches nothing inside the host page: it only reads
 * standard web-platform signals (rAF timestamps, PerformanceObserver longtask,
 * PerformanceObserver long-animation-frame). No DSH module, hook, or internal
 * object is read or referenced.
 *
 * window.__MC API:
 *   frames[]     rAF timestamps (performance.now(), ms)
 *   longtasks[]  {start, dur, name}
 *   loafs[]      {start, dur, blocking, scripts[]}
 *   reset()      clears all buffers and returns performance.now()
 *   mark(name)   records a named timestamp for phase alignment
 *   marks        {name: [t,...]}
 */
(() => {
  if (window.__MC) return;
  const MC = (window.__MC = {
    frames: [], longtasks: [], loafs: [], marks: {}, installedAt: performance.now(),
  });

  const rafLoop = (ts) => { MC.frames.push(ts); requestAnimationFrame(rafLoop); };
  requestAnimationFrame(rafLoop);

  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) MC.longtasks.push({ start: e.startTime, dur: e.duration, name: e.name });
    }).observe({ entryTypes: ['longtask'] });
  } catch (e) { MC.longtaskUnsupported = String(e && e.message || e); }

  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        MC.loafs.push({
          start: e.startTime,
          dur: e.duration,
          blocking: e.blockingDuration == null ? null : e.blockingDuration,
          renderStart: e.renderStart == null ? null : e.renderStart,
          styleAndLayoutStart: e.styleAndLayoutStart == null ? null : e.styleAndLayoutStart,
          firstUIEventTimestamp: e.firstUIEventTimestamp == null ? null : e.firstUIEventTimestamp,
          scripts: (e.scripts || []).map((s) => ({
            name: s.name, dur: s.duration, invoker: s.invoker || null, source: s.sourceFunctionName || null,
            forced: s.forcedStyleAndLayoutDuration == null ? null : s.forcedStyleAndLayoutDuration,
            pause: s.pauseDuration == null ? null : s.pauseDuration,
          })),
        });
      }
    }).observe({ type: 'long-animation-frame', buffered: true });
  } catch (e) { MC.loafUnsupported = String(e && e.message || e); }

  MC.reset = () => {
    MC.frames.length = 0; MC.longtasks.length = 0; MC.loafs.length = 0;
    MC.t0 = performance.now();
    return MC.t0;
  };
  MC.mark = (name) => {
    (MC.marks[name] = MC.marks[name] || []).push(performance.now());
    return MC.marks[name][MC.marks[name].length - 1];
  };
})();
