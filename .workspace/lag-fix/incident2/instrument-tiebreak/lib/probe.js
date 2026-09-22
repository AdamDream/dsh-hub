/*
 * lib/probe.js — the four-channel in-page probe, installed with addInitScript()
 * so it exists BEFORE any page script runs (same install order as line A's
 * tools/inpage-probe.js).
 *
 * Channels:
 *   ① rAF sampler: records the FULL timestamp series, not just intervals.
 *        - `ts`     = the rAF timestamp ARGUMENT (the frame time the browser
 *                     hands to the callback — possibly a vsync/catch-up time)
 *        - `now`    = performance.now() sampled at callback ENTRY (wall clock)
 *        - `nowEnd` = performance.now() sampled at callback EXIT
 *      Recording both is deliberate: the A-vs-B conflict could be explained by one
 *      line measuring the argument and the other measuring wall clock.
 *   ② PerformanceObserver longtask
 *   ③ PerformanceObserver long-animation-frame
 *   ④ (trace is collected on the CDP side, not here)
 *
 * Injection sites are wrapped by `injectAt(site, ms)` so the block's own
 * performance.now() window is recorded in-page and can be compared with the rAF
 * samples on the SAME clock, independently of CDP trace timestamp alignment.
 */
(() => {
  if (window.__IT__) return;
  const P = (window.__IT__ = {
    t0: performance.now(),
    ua: navigator.userAgent,
    raf: [],
    lt: [],
    loaf: [],
    marks: [],
    vis: [{ t: performance.now(), state: document.visibilityState, hidden: document.hidden }],
    blocks: [],
    errors: [],
    ltErr: null,
    loafErr: null,
    onFrame: null,
    RAF_CAP: 40000,
  });

  // ---------------------------------------------------------------- ① rAF
  let seq = 0;
  function tick(ts) {
    const a = performance.now();
    if (P.raf.length < P.RAF_CAP) {
      P.raf.push({ seq: seq++, ts: ts, now: a, nowEnd: null });
    } else {
      seq++;
    }
    try { if (P.onFrame) P.onFrame(); } catch (e) { /* page hook must not break the sampler */ }
    const i = P.raf.length - 1;
    if (i >= 0) P.raf[i].nowEnd = performance.now();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ----------------------------------------------------------- ② longtask
  try {
    new PerformanceObserver((list) => {
      for (const en of list.getEntries()) {
        const attr = (en.attribution || []).map((a) => ({
          name: a.name, containerType: a.containerType, containerSrc: a.containerSrc,
          containerId: a.containerId, containerName: a.containerName,
        }));
        P.lt.push({ start: en.startTime, dur: en.duration, name: en.name, attr, gotAt: performance.now() });
      }
    }).observe({ type: 'longtask', buffered: true });
  } catch (e) { P.ltErr = String(e && e.message || e); }

  // -------------------------------------------------------------- ③ LoAF
  try {
    new PerformanceObserver((list) => {
      for (const en of list.getEntries()) {
        P.loaf.push({
          start: en.startTime, dur: en.duration, blocking: en.blockingDuration,
          renderStart: en.renderStart, styleAndLayoutStart: en.styleAndLayoutStart,
          firstUIEvent: en.firstUIEventTimestamp,
          scripts: (en.scripts || []).map((s) => ({
            name: s.name, dur: s.duration, invoker: s.invoker, invokerType: s.invokerType,
            src: s.sourceFunctionName, srcURL: s.sourceURL, srcCharPos: s.sourceCharPosition,
            forced: s.forcedStyleAndLayoutDuration,
            styleAndLayout: s.styleAndLayoutStart != null ? (s.startTime + s.duration - s.styleAndLayoutStart) : null,
          })),
          gotAt: performance.now(),
        });
      }
    }).observe({ type: 'long-animation-frame', buffered: true });
  } catch (e) { P.loafErr = String(e && e.message || e); }

  // ------------------------------------------------------------- visibility
  document.addEventListener('visibilitychange', () => {
    P.vis.push({ t: performance.now(), state: document.visibilityState, hidden: document.hidden });
  }, true);

  // ----------------------------------------------------------- marks / block
  P.mark = function (name) {
    P.marks.push({ name, t: performance.now() });
    try { performance.mark(name); } catch (e) { }
    try { console.timeStamp(name); } catch (e) { }
  };

  P.busy = function (ms) {
    const s = performance.now();
    let x = 0;
    while (performance.now() - s < ms) { x += Math.sqrt(x + 1.0001); }
    return performance.now() - s;
  };

  /**
   * The single blocking primitive used by EVERY injection site.  It records the
   * block window on the page clock and emits trace/user-timing marks around it so
   * the CDP trace can be sliced exactly.
   */
  P.injectAt = function (site, ms) {
    const rec = { site, reqMs: ms, t0: null, start: null, end: null, actual: null, site_t: null };
    rec.t0 = performance.now();
    rec.site_t = rec.t0;
    try {
      P.mark('BLK_S_' + site);
      const s = performance.now();
      rec.start = s;
      const x = P.busy(ms);
      rec.end = performance.now();
      rec.actual = x;
    } catch (e) {
      rec.error = String(e && e.message || e);
    }
    P.mark('BLK_E_' + site);
    rec.after = performance.now();
    P.blocks.push(rec);
    return rec;
  };

  P.clickInject = function (ms) { return P.injectAt('click', ms); };

  // A single-shot rAF injection site: the block runs INSIDE an rAF callback.
  P.injectInRaf = function (ms) {
    return new Promise((resolve) => {
      requestAnimationFrame(() => { resolve(P.injectAt('raf', ms)); });
    });
  };

  // A setTimeout injection site: the block runs inside a timer callback.
  P.injectInTimeout = function (ms) {
    return new Promise((resolve) => {
      setTimeout(() => { resolve(P.injectAt('timeout', ms)); }, 0);
    });
  };

  window.__IT_READY__ = true;
})();
