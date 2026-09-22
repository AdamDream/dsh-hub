/**
 * In-page instrumentation installed via addInitScript, i.e. before any page script.
 * It is purely observational: it wraps fetch/WebSocket additively and never mutates
 * application state. All timestamps are `performance.now()` (page clock).
 *
 * Channels and why each exists:
 *  - longtask              : task-level blocking >= 50 ms (threshold is fixed by the spec)
 *  - long-animation-frame  : per-frame JS vs style/layout split + blockingDuration
 *  - event                 : interaction latency (processingStart..processingEnd), threshold 16 ms
 *  - rAF sequence          : frame-by-frame cadence
 *  - fetch wrapper         : RPC method name taken from the REQUEST BODY (`method` field),
 *                            never from the HTTP verb
 *  - input capture marks   : trusted pointerdown/click anchor in the page clock
 */
export const INIT_HOOKS = String.raw`
(() => {
  if (window.__PP__) return;
  const P = window.__PP__ = {
    tOrigin: performance.timeOrigin,
    support: {},
    longTasks: [], loaf: [], events: [], frames: [], rpc: [], marks: [],
    ws: { opened: 0, frames: 0, bytesIn: 0 },
    anchor: null
  };
  const now = () => performance.now();

  // --- Long Tasks: task-level blocking >= 50ms ---
  try {
    const o = new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        P.longTasks.push({
          start: e.startTime, dur: e.duration, name: e.name,
          attribution: (e.attribution || []).map((a) => ({
            containerType: a.containerType, containerName: a.containerName,
            containerId: a.containerId, containerSrc: a.containerSrc
          }))
        });
      }
    });
    o.observe({ type: 'longtask', buffered: true });
    P.support.longtask = true;
  } catch (e) { P.support.longtask = false; P.support.longtaskError = String((e && e.message) || e); }

  // --- Long Animation Frames: JS vs style/layout attribution ---
  try {
    const o = new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        P.loaf.push({
          start: e.startTime, dur: e.duration, blocking: e.blockingDuration,
          renderStart: e.renderStart, styleAndLayoutStart: e.styleAndLayoutStart,
          firstUIEventTimestamp: e.firstUIEventTimestamp,
          scripts: (e.scripts || []).map((s) => ({
            start: s.startTime, dur: s.duration, invoker: s.invoker, invokerType: s.invokerType,
            sourceURL: s.sourceURL, sourceFunctionName: s.sourceFunctionName,
            forcedStyleAndLayoutDuration: s.forcedStyleAndLayoutDuration,
            pauseDuration: s.pauseDuration
          })),
          url: e.url
        });
      }
    });
    o.observe({ type: 'long-animation-frame', buffered: true });
    P.support.loaf = true;
  } catch (e) { P.support.loaf = false; P.support.loafError = String((e && e.message) || e); }

  // --- Event Timing: interaction latency ---
  try {
    const o = new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        P.events.push({
          name: e.name, start: e.startTime, dur: e.duration,
          processingStart: e.processingStart, processingEnd: e.processingEnd,
          interactionId: e.interactionId
        });
      }
    });
    o.observe({ type: 'event', buffered: true, durationThreshold: 16 });
    P.support.event = true;
  } catch (e) { P.support.event = false; P.support.eventError = String((e && e.message) || e); }

  // --- frame cadence ---
  let framesStopped = false;
  const tick = (t) => {
    if (framesStopped) return;
    if (P.frames.length < 30000) P.frames.push(t);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  P.stopFrames = () => { framesStopped = true; };

  // --- RPC capture: method name from the request BODY ---
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const tStart = now();
    let url = '';
    try { url = (typeof input === 'string') ? input : (input && input.url) || String(input); } catch (e) {}
    let bodyText = null;
    try {
      if (init && init.body != null) {
        bodyText = (typeof init.body === 'string')
          ? init.body
          : '[non-string body:' + Object.prototype.toString.call(init.body) + ']';
      }
    } catch (e) {}
    const rec = {
      i: P.rpc.length, tStart, url,
      httpMethod: (init && init.method) || 'GET',
      bodyMethod: null, bodyType: null, bodyRpcId: null,
      bodyText: bodyText ? bodyText.slice(0, 300) : null,
      tEnd: null, tBodyRead: null, status: null, respBytes: null, respChars: null, err: null
    };
    if (bodyText) {
      try {
        const j = JSON.parse(bodyText);
        rec.bodyMethod = j.method !== undefined ? j.method : null;
        rec.bodyType = j.type !== undefined ? j.type : null;
        rec.bodyRpcId = j.rpcId !== undefined ? j.rpcId : null;
      } catch (e) { rec.bodyParseError = String((e && e.message) || e); }
    }
    P.rpc.push(rec);
    const p = origFetch.call(window, input, init);
    return Promise.resolve(p).then(
      (res) => {
        rec.tEnd = now();
        rec.status = res.status;
        try {
          const cl = res.headers.get('content-length');
          if (cl != null) rec.respBytes = Number(cl);
        } catch (e) {}
        try {
          res.clone().text().then(
            (t) => { rec.tBodyRead = now(); rec.respChars = t.length; if (rec.respBytes == null) rec.respBytes = t.length; },
            () => {}
          );
        } catch (e) {}
        return res;
      },
      (e) => { rec.tEnd = now(); rec.err = String((e && e.message) || e); throw e; }
    );
  };

  // --- WebSocket downlink context (not the unary RPC carrier) ---
  try {
    const OW = window.WebSocket;
    const Wrapped = function (...a) {
      const s = new OW(...a);
      P.ws.opened++;
      s.addEventListener('message', (ev) => {
        P.ws.frames++;
        if (typeof ev.data === 'string') P.ws.bytesIn += ev.data.length;
      });
      return s;
    };
    Wrapped.prototype = OW.prototype;
    Wrapped.CONNECTING = OW.CONNECTING; Wrapped.OPEN = OW.OPEN;
    Wrapped.CLOSING = OW.CLOSING; Wrapped.CLOSED = OW.CLOSED;
    window.WebSocket = Wrapped;
  } catch (e) {}

  // --- trusted input anchor ---
  const desc = (el) => {
    if (!el || !el.tagName) return null;
    return {
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute && el.getAttribute('role'),
      aria: el.getAttribute && el.getAttribute('aria-label'),
      id: el.id || null,
      text: ((el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40)) || null
    };
  };
  for (const ev of ['pointerdown', 'mousedown', 'pointerup', 'click', 'keydown']) {
    document.addEventListener(ev, (e) => {
      const t = now();
      if (P.marks.length > 600) return;
      P.marks.push({ name: 'evt:' + ev, t, target: desc(e.target), trusted: e.isTrusted === true });
      // First trusted pointerdown after arm() defines the page-clock click anchor.
      if (ev === 'pointerdown' && e.isTrusted === true && P.anchor && P.anchor.tClick == null) {
        P.anchor.tClick = t;
      }
    }, true);
  }

  // --- control surface ---
  P.arm = (label) => {
    P.anchor = { label, tClick: null, tArm: now() };
    P.marks.length = 0;
    return P.anchor.tArm;
  };
  P.watch = (spec, timeoutMs) => new Promise((resolve) => {
    const out = {};
    const pending = new Set(Object.keys(spec));
    const deadline = now() + (timeoutMs || 30000);
    const hit = (name) => {
      const sel = spec[name];
      let el = null;
      try { el = document.querySelector(sel); } catch (e) { return false; }
      if (!el) return false;
      let count = 0;
      try { count = document.querySelectorAll(sel).length; } catch (e) {}
      out[name] = { selector: sel, t: now(), count };
      return true;
    };
    const sweep = () => { for (const n of [...pending]) if (hit(n)) pending.delete(n); };
    const finish = () => {
      for (const n of pending) out[n] = { selector: spec[n], t: null, count: 0, missed: true };
      requestAnimationFrame(() => requestAnimationFrame((t) => {
        out.__tAfter2Raf = t;
        out.__resolveT = now();
        resolve(out);
      }));
    };
    sweep();
    if (pending.size === 0) return finish();
    const mo = new MutationObserver(() => { sweep(); if (pending.size === 0) { clearInterval(iv); mo.disconnect(); finish(); } });
    mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    const iv = setInterval(() => {
      sweep();
      if (pending.size === 0) { clearInterval(iv); mo.disconnect(); finish(); }
      else if (now() > deadline) { clearInterval(iv); mo.disconnect(); finish(); }
    }, 15);
  });
  P.block = (ms) => { const t0 = now(); let n = 0; while (now() - t0 < ms) { n += Math.sqrt(n + 1); } return { requested: ms, actual: now() - t0 }; };

  // --- positive controls for the blocking channels ---------------------------------
  // A busy loop invoked straight from Runtime.evaluate runs in a DevTools-initiated
  // task, which the Long Tasks API does not attribute to the page. These variants
  // schedule the same loop from page code so the channel can be validated properly.
  P.controlTimer = (ms) => new Promise((resolve) => {
    setTimeout(() => { const t0 = now(); let n = 0; while (now() - t0 < ms) { n += Math.sqrt(n + 1); }
      resolve({ via: 'setTimeout-task', requested: ms, actual: now() - t0 }); }, 0);
  });
  P.controlRaf = (ms) => new Promise((resolve) => {
    requestAnimationFrame(() => { const t0 = now(); let n = 0; while (now() - t0 < ms) { n += Math.sqrt(n + 1); }
      resolve({ via: 'rAF-callback', requested: ms, actual: now() - t0 }); });
  });
  P.controlEval = (ms) => ({ via: 'Runtime.evaluate', ...P.block(ms) });

  /**
   * Milestone watch that resolves as soon as the PRIMARY selector appears, while
   * continuing to fill P.lastWatch with the remaining milestones for a later dump.
   * Resolving on the primary hit is what keeps the CDP metric window tight.
   */
  P.watchPrimary = (spec, primary, timeoutMs) => new Promise((resolve) => {
    const out = P.lastWatch = { __startedT: now(), __primary: primary };
    const pending = new Set(Object.keys(spec));
    const deadline = now() + (timeoutMs || 15000);
    const hit = (name) => {
      let el = null;
      try { el = document.querySelector(spec[name]); } catch (e) { return false; }
      if (!el) return false;
      let count = 0;
      try { count = document.querySelectorAll(spec[name]).length; } catch (e) {}
      out[name] = { selector: spec[name], t: now(), count };
      return true;
    };
    const sweep = () => { for (const n of [...pending]) if (hit(n)) pending.delete(n); };
    let settled = false;
    const settle = (why) => {
      if (settled) return;
      settled = true;
      clearInterval(iv); mo.disconnect();
      resolve({ why, primary, primaryHit: out[primary] || null, tResolve: now(), partial: { ...out } });
    };
    sweep();
    if (out[primary]) return settle('primary-already-present');
    const mo = new MutationObserver(() => { sweep(); if (out[primary]) settle('primary-mutation'); else if (pending.size === 0) settle('all-hit'); });
    mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    const iv = setInterval(() => {
      sweep();
      if (out[primary]) settle('primary-poll');
      else if (pending.size === 0) settle('all-hit');
      else if (now() > deadline) settle('timeout');
    }, 5);
  });
  /** Wait (page clock) until tClick + w, then report the actual page time reached. */
  P.waitToClickPlus = async (w) => {
    const a = P.anchor;
    if (!a || a.tClick == null) return { err: 'no-tClick' };
    const target = a.tClick + w;
    const cur = now();
    if (target > cur) await new Promise((r) => setTimeout(r, target - cur));
    return { t: now(), tClick: a.tClick, target };
  };
  /** Run the primary-watch for the remaining milestones for a bounded extra time. */
  P.finishWatch = (spec, timeoutMs) => P.watchPrimary(spec, '__none__', timeoutMs);
  P.counts = () => {
    const pc = document.querySelector('[data-plugin-count]');
    return {
      allElements: document.getElementsByTagName('*').length,
      svg: document.getElementsByTagName('svg').length,
      buttons: document.getElementsByTagName('button').length,
      li: document.querySelectorAll('li').length,
      pluginEntries: document.querySelectorAll('[data-plugin-entry]').length,
      pluginCountAttr: pc ? pc.getAttribute('data-plugin-count') : null,
      styleSheetCount: document.styleSheets.length,
      elementsWithOwnStyleSheet: document.styleSheets.length
    };
  };
})();
`;

/** Read CDP Performance metrics into a plain object; only fields actually present. */
export async function readMetrics(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics');
  const o = {};
  for (const m of metrics) o[m.name] = m.value;
  return o;
}

/** Cumulative counters whose delta over a window is meaningful. */
export const CUMULATIVE = [
  'LayoutCount', 'RecalcStyleCount', 'LayoutDuration', 'RecalcStyleDuration',
  'ScriptDuration', 'TaskDuration', 'Timestamp',
];

/** Instantaneous gauges: a delta is a change in level, not a sum. */
export const GAUGES = [
  'Documents', 'Frames', 'JSEventListeners', 'Nodes', 'JSHeapUsedSize', 'JSHeapTotalSize',
];

export function metricDelta(a, b) {
  const out = { cumulative: {}, gauges: {}, absent: [] };
  for (const k of CUMULATIVE) {
    if (k in a && k in b) out.cumulative[k] = b[k] - a[k];
    else if (!(k in a) || !(k in b)) out.absent.push(k);
  }
  for (const k of GAUGES) {
    if (k in a && k in b) out.gauges[k] = b[k] - a[k];
    else out.absent.push(k);
  }
  out.keysPresent = Object.keys(b).sort();
  return out;
}
