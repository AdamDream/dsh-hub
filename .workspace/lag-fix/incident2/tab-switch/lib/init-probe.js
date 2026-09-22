/* lib/init-probe.js — document-start 注入器械（tab-switch 线）
 *
 * 能力：
 *  1) RPC 捕获：包装 window.fetch（DSH 的 RPC = fetch POST /api/<method>；事件流 = fetch SSE /api/events.*）
 *  2) LongTask：PerformanceObserver('longtask')  ← 阳性对照通道
 *  3) LoAF：PerformanceObserver('longaframe')   ← 支持性探测（不支持则如实记录 unsupported）
 *  4) 帧序列：rAF 链，记录每帧间隔（用于 p50/p95/p99/max 与 >50ms 计数）
 *  5) DOM churn：MutationObserver(document, subtree) 计 added/removed/attributes
 *  6) 强制布局嫌疑：document 原型上的 rect/offsetHeight/clientHeight/scrollHeight/getComputedStyle 读取计数
 *  7) 快照：DOM 节点数 / SVG 数 / style 标签数 / scrollTop
 *  8) 阳性对照注入：__TS.block(ms) 同步阻塞
 *
 * 只读性质：本器械不改页面 DOM、不发网络请求、不写产品文件。
 */
(() => {
  if (globalThis.__TS__) return;
  const S = {
    armed: false,
    armWall: 0,
    frames: [],        // 帧间隔
    frameTs: [],       // 帧时间戳（performance.now）
    longtasks: [],
    loaf: [],
    loafSupported: null,
    rpc: [],
    churn: { added: 0, removed: 0, attributes: 0, characterData: 0, records: 0 },
    layoutReads: {},
    errors: [],
    blockRuns: [],
    markers: [],
  };
  globalThis.__TS__ = S;

  const now = () => performance.now();

  /* ---------- 1) fetch 包装 ---------- */
  const origFetch = globalThis.fetch;
  if (typeof origFetch === 'function') {
    globalThis.fetch = function (input, init) {
      let url = '';
      try { url = typeof input === 'string' ? input : (input && input.url) || String(input); } catch {}
      const method = (init && init.method) || (typeof input === 'object' && input && input.method) || 'GET';
      const t0 = now();
      const isStream = /\/api\/events\./.test(url);
      const rec = { url, path: url.replace(/^https?:\/\/[^/]+/, '').split('?')[0], method, t0, stream: isStream, state: 'pending' };
      S.rpc.push(rec);
      let p;
      try { p = origFetch.apply(this, arguments); } catch (e) { rec.state = 'throw'; throw e; }
      return p.then((res) => {
        rec.t1 = now(); rec.ms = +(rec.t1 - rec.t0).toFixed(2); rec.status = res.status;
        if (!isStream) rec.state = 'done';
        return res;
      }, (err) => { rec.t1 = now(); rec.ms = +(rec.t1 - rec.t0).toFixed(2); rec.state = 'error:' + String(err).slice(0, 80); throw err; });
    };
  }

  /* ---------- 2) LongTask ---------- */
  try {
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        S.longtasks.push({ t: +e.startTime.toFixed(2), dur: +e.duration.toFixed(2), name: e.name,
          attr: (e.attribution || []).map((a) => ({ type: a.name, containerType: a.containerType, containerSrc: a.containerSrc })) });
      }
    });
    po.observe({ type: 'longtask', buffered: true });
  } catch (e) { S.errors.push('longtask OBSERVER FAILED: ' + String(e)); }

  /* ---------- 3) LoAF ---------- */
  try {
    const po2 = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        S.loaf.push({ t: +e.startTime.toFixed(2), dur: +e.duration.toFixed(2), blocking: e.blockingDuration != null ? +e.blockingDuration.toFixed(2) : null,
          styleAndLayout: e.styleAndLayoutStart != null ? +(e.startTime + e.duration - e.styleAndLayoutStart).toFixed(2) : null,
          scripts: (e.scripts || []).length });
      }
    });
    po2.observe({ type: 'long-animation-frame', buffered: true });
    S.loafSupported = true;
  } catch (e) { S.loafSupported = false; S.loafError = String(e).slice(0, 160); }
  try {
    // 兼容旧命名探测
    if (S.loafSupported !== true) {
      const po3 = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) S.loaf.push({ t: +e.startTime.toFixed(2), dur: +e.duration.toFixed(2), legacy: true });
      });
      po3.observe({ type: 'longaframe', buffered: true });
      S.loafSupported = 'longaframe-legacy';
    }
  } catch (e) { S.loafLegacyError = String(e).slice(0, 120); }

  /* ---------- 4) 帧序列 ---------- */
  function loop() {
    const t = now();
    if (S.armed) {
      const prev = S.frameTs.length ? S.frameTs[S.frameTs.length - 1] : null;
      if (prev != null) S.frames.push(+(t - prev).toFixed(3));
      S.frameTs.push(+t.toFixed(3));
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  /* ---------- 5) DOM churn ---------- */
  try {
    const mo = new MutationObserver((recs) => {
      if (!S.armed) return;
      S.churn.records += recs.length;
      for (const r of recs) {
        if (r.type === 'childList') { S.churn.added += r.addedNodes.length; S.churn.removed += r.removedNodes.length; }
        else if (r.type === 'attributes') S.churn.attributes++;
        else if (r.type === 'characterData') S.churn.characterData++;
      }
    });
    mo.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  } catch (e) { S.errors.push('mutation OBSERVER FAILED: ' + String(e)); }

  /* ---------- 6) 强制布局嫌疑计数（读取面） ---------- */
  const bump = (k) => { if (S.armed) S.layoutReads[k] = (S.layoutReads[k] || 0) + 1; };
  const proto = Element.prototype;
  for (const [k, name] of [['rect', 'getBoundingClientRect'], ['rects', 'getClientRects']]) {
    const o = proto[name];
    if (o) proto[name] = function () { bump(k); return o.apply(this, arguments); };
  }
  for (const name of ['offsetHeight', 'offsetWidth', 'clientHeight', 'clientWidth', 'scrollHeight', 'scrollWidth', 'offsetTop', 'offsetLeft']) {
    const d = Object.getOwnPropertyDescriptor(HTMLElement.prototype, name);
    if (d && d.get) Object.defineProperty(HTMLElement.prototype, name, { get() { bump('geo.' + name); return d.get.call(this); }, configurable: true });
  }
  const oGCS = globalThis.getComputedStyle;
  if (oGCS) globalThis.getComputedStyle = function () { bump('gcs'); return oGCS.apply(this, arguments); };

  /* ---------- 7) 快照 ---------- */
  S.snapshot = () => {
    let svg = 0, nodes = 0, imgs = 0, canvases = 0, fixedLayers = 0;
    try {
      nodes = document.querySelectorAll('*').length;
      svg = document.querySelectorAll('svg').length;
      imgs = document.querySelectorAll('img').length;
      canvases = document.querySelectorAll('canvas').length;
      const dlg = document.querySelector('[role="dialog"]');
      if (dlg) {
        fixedLayers = Array.from(dlg.querySelectorAll('*')).filter((el) => {
          const cs = getComputedStyle(el);
          return cs.position === 'fixed' || cs.position === 'sticky';
        }).length;
      }
    } catch (e) { S.errors.push('snapshot: ' + String(e)); }
    return {
      nodes, svg, imgs, canvases, fixedLayers,
      styleTags: document.querySelectorAll('style').length,
      rpcCount: S.rpc.length,
      longtaskCount: S.longtasks.length,
      frames: S.frames.length,
      churn: { ...S.churn },
      layoutReads: { ...S.layoutReads },
      loafCount: S.loaf.length,
      at: now(),
    };
  };

  S.arm = () => { S.armed = true; S.armWall = Date.now(); S.frames = []; S.frameTs = []; S.longtasks = []; S.loaf = []; S.rpc = [];
    S.churn = { added: 0, removed: 0, attributes: 0, characterData: 0, records: 0 }; S.layoutReads = {}; S.markers = [];
    return { at: now(), wall: Date.now() }; };
  S.disarm = () => { S.armed = false; return S.snapshot(); };
  S.mark = (label) => { S.markers.push({ label, t: +now().toFixed(2), wall: Date.now() }); return now(); };

  S.framesummary = () => {
    const f = S.frames.slice().sort((a, b) => a - b);
    if (!f.length) return { n: 0 };
    const q = (p) => f[Math.min(f.length - 1, Math.floor(p * f.length))];
    return {
      n: f.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: f[f.length - 1],
      over50: S.frames.filter((x) => x > 50).length,
      over33: S.frames.filter((x) => x > 33.4).length,
      over100: S.frames.filter((x) => x > 100).length,
      sumMs: +S.frames.reduce((a, b) => a + b, 0).toFixed(1),
    };
  };

  /* ---------- 8) 阳性对照：同步阻塞 ---------- */
  S.block = (ms) => {
    const t0 = performance.now();
    // 纯忙等：主线程被占满 ⇒ Chromium 必然产出 longtask 条目（阈值 50ms）
    // 注意：不可用 Atomics.wait（会让主线程进 futex，可能不产生 longtask）；页面无 COI 也没有 SharedArrayBuffer
    let x = 0;
    while (performance.now() - t0 < ms) { x = (x + 1) % 1000000; }
    const dur = performance.now() - t0;
    S.blockRuns.push({ requested: ms, actual: +dur.toFixed(2), at: +t0.toFixed(2), spin: x, kind: 'devtools-task' });
    return +dur.toFixed(2);
  };

  /** 以「真实页面任务」注入阻塞（setTimeout 回调里忙等）。
   *  与 S.block 的区别：DevTools 下发的 Runtime.evaluate 任务**不会**产出 longtask 条目，
   *  而页面自身任务会 —— 这是本环境实测的器械边界，故阳性对照必须两种都做。 */
  S.spinTask = (ms) => new Promise((res) => {
    setTimeout(() => {
      const t0 = performance.now();
      let x = 0;
      while (performance.now() - t0 < ms) { x = (x + 1) % 1000000; }
      const dur = performance.now() - t0;
      S.blockRuns.push({ requested: ms, actual: +dur.toFixed(2), at: +t0.toFixed(2), spin: x, kind: 'page-task' });
      res(+dur.toFixed(2));
    }, 0);
  });

  /** 一次性「点击即阻塞」挂钩：把 120ms 忙等挂在一次真实点击（page.mouse.click）的处理路径上。
   *  这是与本次测验**完全同路径**的阳性对照（点击 → 页内处理 → 长任务）。 */
  S.installClickSpin = (ms) => {
    const h = () => {
      document.removeEventListener('click', h, true);
      const t0 = performance.now();
      let x = 0;
      while (performance.now() - t0 < ms) { x = (x + 1) % 1000000; }
      S.blockRuns.push({ requested: ms, actual: +(performance.now() - t0).toFixed(2), at: +t0.toFixed(2), spin: x, kind: 'click-driven' });
    };
    document.addEventListener('click', h, true);
    return true;
  };

  S.ready = true;
})();
