/*
 * Shared synthetic-pointer driver — injected byte-identically into both engines
 * and invoked with the SAME parameters, so the two engines are fed an identical
 * input sequence (same tick count, same coordinates, same event order).
 *
 * Why synthetic and not OS/CDP/BiDi input:
 *   - Chromium's CDP Input.dispatchMouseEvent and Gecko's BiDi input.performActions
 *     are different code paths with different batching, so a ranking measured
 *     through them would confound the compositor/input-stack difference with the
 *     instrumentation difference.
 *   - The minimal page listens on `mousemove` (window) plus `mouseover`/`mouseout`
 *     (delegated on #cards, using e.relatedTarget), i.e. plain DOM events. Dispatching
 *     the same DOM events from page JS exercises exactly the handlers the page has.
 *   A real-input cross-check is run separately (see campaign note) to confirm the
 *   ranking is not an artifact of synthetic dispatch.
 *
 * window.__DRV:
 *   start({mode, hertz, ms}) -> Promise resolved after ms, with tick stats
 *   stop()  pathAt(t)  stats()
 */
(() => {
  if (window.__DRV) return;
  const state = {
    ticks: 0, moves: 0, over: 0, out: 0, startedAt: 0, mode: null, last: null,
    reflowN: 0, reflowTotal: 0, reflowMax: 0, reflowEnabled: false,
    /* per-input-event handling cost: hit-test + engine event dispatch + page
     * handlers, measured around the whole synthetic pointer tick. This is the
     * headless-compatible proxy for "the animation stutters while the pointer
     * moves" — it needs no paint/composite to differ between engines. */
    tickN: 0, tickTotal: 0, tickMax: 0, tickSamples: [],
  };

  /* Forced style+layout cost probe.
   * Headless has no paint/composite, so the ONLY per-frame engine cost that is
   * actually exercised in both engines is JS + style/layout. Reading offsetHeight
   * right after the tick mutated the DOM forces Gecko/Blink to resolve style and
   * layout synchronously, and the elapsed time is the engine's own — the same
   * trigger, the same DOM, measured identically on both sides.
   * It is opt-in (--reflow=1) because forcing layout every tick is itself a
   * workload change; it is never mixed into the primary non-intrusive cells. */
  function forcedReflow() {
    const t0 = performance.now();
    const a = document.body.offsetHeight;
    const c = document.getElementById('cards');
    const b = c ? c.offsetHeight : 0;
    const d = document.documentElement.scrollHeight;
    const dt = performance.now() - t0;
    state.reflowN++; state.reflowTotal += dt;
    if (dt > state.reflowMax) state.reflowMax = dt;
    return { a, b, d };
  }

  const el = (x, y) => {
    try { return document.elementFromPoint(x, y); } catch { return null; }
  };

  function zoneRect() {
    const z = (window.MMP && window.MMP.zones) || null;
    const vw = window.innerWidth, vh = window.innerHeight;
    return {
      hover: (z && z.hover) || { x: 4, y: 4, w: vw - 8, h: vh * 0.4 },
      ripple: (z && z.ripple) || { x: 8, y: vh * 0.45, w: vw - 16, h: vh * 0.5 },
      vw, vh,
    };
  }

  const cards = () => Array.from(document.querySelectorAll('.card'));

  /* Deterministic path: same formulas on both engines, pure function of tick index. */
  function pathAt(tick, mode) {
    const z = zoneRect();
    const H = z.hover, R = z.ripple;
    let phase = mode;
    if (mode === 'both') phase = (Math.floor(tick / 15) % 2 === 0) ? 'ripple' : 'hover';
    if (phase === 'ripple') {
      const step = 7;
      const x = R.x + ((tick * step) % Math.max(1, Math.floor(R.w)));
      const y = R.y + R.h * 0.5 + Math.sin(tick * 0.15) * (R.h * 0.3);
      return { x: Math.round(x), y: Math.round(Math.min(z.vh - 1, Math.max(0, y))) };
    }
    const cs = cards();
    if (!cs.length) return { x: Math.round(H.x + H.w / 2), y: Math.round(H.y + H.h / 2) };
    const c = cs[tick % cs.length];
    const r = c.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + Math.min(r.height, 24) / 2) };
  }

  function fire(type, target, x, y, related) {
    const ev = new MouseEvent(type, {
      bubbles: true, cancelable: true, composed: true, view: window,
      clientX: x, clientY: y, screenX: x, screenY: y, button: 0, buttons: 0,
      relatedTarget: related || null,
    });
    (target || window).dispatchEvent(ev);
  }

  function tick(t) {
    const tStart = performance.now();
    const p = pathAt(t, state.mode);
    const target = el(p.x, p.y) || document.body;
    const prev = state.last;
    if (prev && prev.target !== target) {
      fire('mouseout', prev.target, prev.x, prev.y, target);
      fire('mouseover', target, p.x, p.y, prev.target);
      state.out++; state.over++;
    } else if (!prev) {
      fire('mouseover', target, p.x, p.y, null);
      state.over++;
    }
    fire('mousemove', target, p.x, p.y, null);
    state.last = { target, x: p.x, y: p.y };
    state.ticks++; state.moves++;
    if (state.reflowEnabled) forcedReflow();
    const tCost = performance.now() - tStart;
    state.tickN++; state.tickTotal += tCost;
    if (tCost > state.tickMax) state.tickMax = tCost;
    if (state.tickSamples.length < 4000) state.tickSamples.push(+tCost.toFixed(4));
  }

  let timer = null;
  window.__DRV = {
    pathAt,
    state,
    forcedReflow,
    stats: () => {
      const s = [...state.tickSamples].sort((a, b) => a - b);
      const q = (pp) => (s.length ? s[Math.min(s.length - 1, Math.round((s.length - 1) * pp))] : null);
      const out = {
        ...state,
        tickSamples: s.length > 400 ? s.slice(0, 400) : s,
        reflowMeanMs: state.reflowN ? +(state.reflowTotal / state.reflowN).toFixed(4) : null,
        reflowTotalMs: +state.reflowTotal.toFixed(2),
        reflowMaxMs: +state.reflowMax.toFixed(4),
        tickMeanMs: state.tickN ? +(state.tickTotal / state.tickN).toFixed(4) : null,
        tickMaxMs: +state.tickMax.toFixed(4),
        tickP50Ms: q(0.5), tickP95Ms: q(0.95),
      };
      out.last = out.last ? { x: out.last.x, y: out.last.y } : null;   // never leak a DOM node
      return out;
    },
    stop() { if (timer) { clearInterval(timer); timer = null; } },
    start({ mode = 'both', hertz = 60, ms = 10000, reflow = false } = {}) {
      state.mode = mode; state.ticks = 0; state.moves = 0; state.over = 0; state.out = 0; state.last = null;
      state.reflowEnabled = !!reflow;
      state.reflowN = 0; state.reflowTotal = 0; state.reflowMax = 0;
      state.tickN = 0; state.tickTotal = 0; state.tickMax = 0; state.tickSamples = [];
      state.startedAt = performance.now();
      const period = Math.max(1, Math.round(1000 / hertz));
      let t = 0;
      return new Promise((resolve) => {
        timer = setInterval(() => {
          tick(t++);
          if (performance.now() - state.startedAt >= ms) {
            window.__DRV.stop();
            resolve({ ...state, elapsedMs: +(performance.now() - state.startedAt).toFixed(1) });
          }
        }, period);
      });
    },
  };
})();
