/*
 * Shared instrument — injected into the MAIN world BEFORE any page script runs,
 * byte-identically on Blink and Gecko:
 *   Blink : context.addInitScript({ content: <this file> })
 *   Gecko : script.addPreloadScript(<this file as a function declaration>)
 *
 * It only touches standard web-platform surfaces. Everything it records is
 * engine-neutral; the per-engine metrics that do NOT exist in one engine
 * (CDP Performance.getMetrics, LongTask, LoAF) are reported honestly as
 * unsupported rather than fabricated.
 *
 * window.__MC:
 *   frames[]      rAF timestamps (performance.now, ms) — cadence source
 *   longtasks[]   {start,dur,name}          (LongTask API; Blink only in practice)
 *   loafs[]       {start,dur,blocking,scripts} (LoAF; Blink only in practice)
 *   support{}     {longtask,loaf,longtaskErr,loafErr,hasPO}
 *   rafN/rafTotal/rafMax   JS self-time inside rAF callbacks (ms)
 *   reset()
 */
(() => {
  if (window.__MC) return;
  const MC = (window.__MC = {
    frames: [], longtasks: [], loafs: [], support: {},
    rafN: 0, rafTotal: 0, rafMax: 0, installedAt: performance.now(),
    /* per-callback samples + frame-budget exceedance counters: the frame budget
     * at 60 Hz is 16.7 ms, so a callback that itself costs >16.7 ms cannot make
     * the deadline no matter what the compositor does. This is the headless-legal
     * frame-drop proxy — it needs no paint/composite to be meaningful. */
    rafSamples: [], rafOver167: 0, rafOver8: 0, rafOver33: 0,
  });

  // 1) orthogonal rAF cadence sampler (uses the ORIGINAL rAF, installed first)
  const origRAF = window.requestAnimationFrame.bind(window);
  const cadence = (ts) => { MC.frames.push(ts); origRAF(cadence); };
  origRAF(cadence);

  // 2) JS self-time inside every rAF callback (including the page's own loop)
  window.requestAnimationFrame = function (cb) {
    if (typeof cb !== 'function') return origRAF(cb);
    return origRAF(function (ts) {
      const t0 = performance.now();
      try { return cb(ts); }
      finally {
        const d = performance.now() - t0;
        MC.rafN++; MC.rafTotal += d;
        if (d > MC.rafMax) MC.rafMax = d;
        if (d > 16.7) MC.rafOver167++;
        if (d > 33.3) MC.rafOver33++;
        if (d > 8) MC.rafOver8++;
        if (MC.rafSamples.length < 4000) MC.rafSamples.push(+d.toFixed(4));
      }
    });
  };

  MC.support.hasPO = (typeof PerformanceObserver !== 'undefined');

  // 3) LongTask
  MC.support.longtask = false;
  if (MC.support.hasPO) {
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) MC.longtasks.push({ start: e.startTime, dur: e.duration, name: e.name });
      }).observe({ entryTypes: ['longtask'] });
      MC.support.longtask = true;
    } catch (e) { MC.support.longtaskErr = String((e && e.message) || e); }
  }

  // 4) Long Animation Frames
  MC.support.loaf = false;
  if (MC.support.hasPO) {
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) {
          MC.loafs.push({
            start: e.startTime, dur: e.duration,
            blocking: e.blockingDuration == null ? null : e.blockingDuration,
            renderStart: e.renderStart == null ? null : e.renderStart,
            styleAndLayoutStart: e.styleAndLayoutStart == null ? null : e.styleAndLayoutStart,
            scripts: (e.scripts || []).map((s) => ({
              name: s.name, dur: s.duration, invoker: s.invoker || null,
              forced: s.forcedStyleAndLayoutDuration == null ? null : s.forcedStyleAndLayoutDuration,
            })),
          });
        }
      }).observe({ type: 'long-animation-frame', buffered: true });
      MC.support.loaf = true;
    } catch (e) { MC.support.loafErr = String((e && e.message) || e); }
  }

  MC.reset = () => {
    MC.frames.length = 0; MC.longtasks.length = 0; MC.loafs.length = 0;
    MC.rafN = 0; MC.rafTotal = 0; MC.rafMax = 0;
    MC.rafSamples.length = 0; MC.rafOver167 = 0; MC.rafOver33 = 0; MC.rafOver8 = 0;
    MC.t0 = performance.now();
    return MC.t0;
  };
})();
