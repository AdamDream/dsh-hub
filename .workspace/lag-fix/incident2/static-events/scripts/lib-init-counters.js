/**
 * lib-init-counters.js — document-start 只读计数器打桩（无产品改动、无保存/应用/删除）。
 *
 * 目的：量化「点击设置」后 2s 窗口内的成本源，并自证打桩生效。
 * 只做**读取与计数**：不改任何产品行为，不拦截/改写返回值。
 * 所有包裹都透传原返回值；唯一"人为"动作是自证阶段（selftest）主动制造流量。
 *
 * 纪律：本文件由 scripts/open-probe.mjs 通过 addInitScript 注入；ARM 之前只累计不判断。
 */
(() => {
  const origRaf = globalThis.requestAnimationFrame.bind(globalThis);
  const origCaf = globalThis.cancelAnimationFrame.bind(globalThis);
  const origSetTimeout = globalThis.setTimeout.bind(globalThis);
  const origSetInterval = globalThis.setInterval.bind(globalThis);
  const origClearTimeout = globalThis.clearTimeout.bind(globalThis);
  const origClearInterval = globalThis.clearInterval.bind(globalThis);
  const origAddEventListener = EventTarget.prototype.addEventListener;
  const origRemoveEventListener = EventTarget.prototype.removeEventListener;
  const origCreateElement = Document.prototype.createElement;
  const origAppendChild = Node.prototype.appendChild;
  const origInsertBefore = Node.prototype.insertBefore;
  const origGCS = globalThis.getComputedStyle;
  const origRect = Element.prototype.getBoundingClientRect;
  const origFetch = globalThis.fetch;
  const OrigWS = globalThis.WebSocket;
  const OrigMO = globalThis.MutationObserver;
  const OrigRO = globalThis.ResizeObserver;
  const OrigIO = globalThis.IntersectionObserver;
  const origWarn = console.warn;
  const origError = console.error;

  const now = () => performance.now();
  const S = {
    epoch: now(),
    armed: false,
    armAt: 0,
    /** 计数器：单调累计；分析时做 arm 前后差分。 */
    c: Object.create(null),
    /** 单调时间序列（受 ring 上限保护）。 */
    ev: [],
    /** 窗口内定时器/订阅/观察器的**登记名册**（arm 后新建的）。 */
    roster: { listeners: [], timers: [], intervals: [], observers: [], sockets: [], fetches: [], styleTags: [] },
    console: [],
    longtasks: [],
    /** React 内部错误边界/告警（同步更新风暴的判据）。 */
    selfTest: null,
    limits: { ev: 40000 },
  };
  globalThis.__DSH_STRESS__ = S;

  const bump = (k, n) => { S.c[k] = (S.c[k] || 0) + (n === undefined ? 1 : n); };
  const push = (k, extra) => {
    if (S.ev.length >= S.limits.ev) return;
    S.ev.push(Object.assign({ t: Math.round((now() - S.epoch) * 10) / 10, k }, extra || {}));
  };
  const tagOf = (el) => {
    if (!el || typeof el !== 'object') return null;
    const tn = el.tagName || el.nodeName;
    return tn ? String(tn).toLowerCase() : null;
  };

  /* ---- 1. requestAnimationFrame：帧率 + rAF 链（自调度 = rAF 循环判据） ---- */
  let rafInFlight = 0;
  let rafSelfChain = 0;
  /** 只记"回调执行期间又发起 rAF"的深度；用普通数组，**不用 WeakMap**
   * （实测坑：宿主环境里 rAF 的返回 id 可能是不可作为 WeakMap 键的值 →
   *  `Invalid value used as weak map key`，会直接打死自证阶段）。 */
  const rafStack = [];
  globalThis.requestAnimationFrame = function (cb) {
    bump('raf.request');
    if (typeof cb !== 'function') return origRaf(cb);
    const myDepth = rafStack.length > 0 ? rafStack[rafStack.length - 1] + 1 : 0;
    const id = origRaf(function (ts) {
      rafInFlight -= 1;
      bump('raf.callback');
      push('raf', { ts: Math.round(ts * 10) / 10 });
      if (myDepth > 0) { rafSelfChain += 1; bump('raf.selfChain'); }
      rafStack.push(myDepth);
      try { return cb(ts); } finally { rafStack.pop(); }
    });
    rafInFlight += 1;
    return id;
  };
  globalThis.cancelAnimationFrame = function (id) { bump('raf.cancel'); return origCaf(id); };
  S.meta = () => ({ rafInFlight, rafSelfChain });

  /* ---- 2. 定时器：窗口内新建的 setTimeout/setInterval（副作用普查） ---- */
  globalThis.setTimeout = function (fn, ms, ...rest) {
    bump('timer.setTimeout');
    if (S.armed && fn) {
      const stack = String(new Error().stack || '').split('\n').slice(2, 5).join(' | ').slice(0, 400);
      if (S.roster.timers.length < 400) S.roster.timers.push({ ms: ms === undefined ? 0 : ms, at: now() - S.armAt, stack });
    }
    return origSetTimeout(fn, ms, ...rest);
  };
  globalThis.setInterval = function (fn, ms, ...rest) {
    bump('timer.setInterval');
    if (S.armed && fn) {
      const stack = String(new Error().stack || '').split('\n').slice(2, 5).join(' | ').slice(0, 400);
      if (S.roster.intervals.length < 100) S.roster.intervals.push({ ms: ms === undefined ? 0 : ms, at: now() - S.armAt, stack });
    }
    return origSetInterval(fn, ms, ...rest);
  };
  globalThis.clearTimeout = function (id) { bump('timer.clearTimeout'); return origClearTimeout(id); };
  globalThis.clearInterval = function (id) { bump('timer.clearInterval'); return origClearInterval(id); };

  /* ---- 3. addEventListener：订阅/监听器建立计数（点击后新增 = 副作用普查） ---- */
  const describeTarget = (t) => {
    if (t === document) return 'document';
    if (t === globalThis) return 'window';
    return tagOf(t) || (t && t.constructor ? t.constructor.name : 'unknown');
  };
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    bump('listener.add');
    if (S.armed && S.roster.listeners.length < 600) {
      const stack = String(new Error().stack || '').split('\n').slice(2, 6).join(' | ').slice(0, 500);
      S.roster.listeners.push({ type, target: describeTarget(this), at: Math.round(now() - S.armAt), stack });
    }
    return origAddEventListener.call(this, type, listener, options);
  };
  EventTarget.prototype.removeEventListener = function (type, listener, options) {
    bump('listener.remove');
    return origRemoveEventListener.call(this, type, listener, options);
  };

  /* ---- 4. 观察器 ---- */
  const wrapObserver = (Orig, name) => {
    if (!Orig) return Orig;
    return class extends Orig {
      constructor(cb) {
        super(cb);
        bump('observer.' + name);
        if (S.armed && S.roster.observers.length < 100) {
          const stack = String(new Error().stack || '').split('\n').slice(2, 6).join(' | ').slice(0, 500);
          S.roster.observers.push({ kind: name, at: Math.round(now() - S.armAt), stack });
        }
      }
      observe(target, opts) {
        bump('observer.' + name + '.observe');
        if (S.armed) {
          const stack = String(new Error().stack || '').split('\n').slice(2, 5).join(' | ').slice(0, 300);
          push('observe', { kind: name, target: describeTarget(target), stack });
        }
        return super.observe(target, opts);
      }
      disconnect() { bump('observer.' + name + '.disconnect'); return super.disconnect(); }
    };
  };
  globalThis.MutationObserver = wrapObserver(OrigMO, 'mutation');
  globalThis.ResizeObserver = wrapObserver(OrigRO, 'resize');
  globalThis.IntersectionObserver = wrapObserver(OrigIO, 'intersection');

  /* ---- 5. DOM 变更：MutationObserver 常驻（证明打桩探测到真实变更） ---- */
  try {
    const mo = new OrigMO((records) => {
      for (const r of records) {
        bump('mut.total');
        bump('mut.' + r.type);
        if (r.type === 'childList') {
          bump('mut.addedNodes', r.addedNodes.length);
          bump('mut.removedNodes', r.removedNodes.length);
        }
        if (r.type === 'attributes') {
          const nm = r.attributeName || '?';
          bump('mut.attr.' + nm);
          if (nm === 'style' || nm === 'class') bump('mut.attrLayout.' + nm);
        }
      }
      S.lastMutationAt = now();
    });
    mo.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    S.mutationObserverReady = true;
  } catch (e) { S.mutationObserverReady = false; S.moError = String(e); }

  /* ---- 6. 样式注入 / 样式写入 ---- */
  Document.prototype.createElement = function (tag, ...rest) {
    const el = origCreateElement.call(this, tag, ...rest);
    const tn = String(tag).toLowerCase();
    if (tn === 'style' || tn === 'link') {
      bump('style.create.' + tn);
      if (S.armed && S.roster.styleTags.length < 60) {
        const stack = String(new Error().stack || '').split('\n').slice(2, 6).join(' | ').slice(0, 500);
        S.roster.styleTags.push({ tag: tn, at: Math.round(now() - S.armAt), stack });
      }
      push('styleCreate', { tag: tn });
    }
    return el;
  };
  Node.prototype.appendChild = function (child) {
    if (child && (child.tagName === 'STYLE' || child.tagName === 'LINK')) bump('style.append.' + String(child.tagName).toLowerCase());
    return origAppendChild.call(this, child);
  };
  Node.prototype.insertBefore = function (child, ref) {
    if (child && (child.tagName === 'STYLE' || child.tagName === 'LINK')) bump('style.insertBefore.' + String(child.tagName).toLowerCase());
    return origInsertBefore.call(this, child, ref);
  };

  /* ---- 7. forced reflow：布局读取 API 计数 + 是【写后读】的判据 ---- */
  const lastStyleWriteAt = { v: -1e9 };
  S.lastStyleWriteAt = lastStyleWriteAt;
  try {
    const cssProto = CSSStyleDeclaration.prototype;
    for (const m of ['setProperty', 'removeProperty']) {
      const orig = cssProto[m];
      if (typeof orig !== 'function') continue;
      cssProto[m] = function (...a) {
        bump('style.' + m);
        if (S.armed) { lastStyleWriteAt.v = now(); bump('styleWrite.armed'); }
        return Reflect.apply(orig, this, a);
      };
    }
    for (const prop of ['cssText', 'height', 'width', 'top', 'left', 'transform', 'visibility']) {
      const d = Object.getOwnPropertyDescriptor(cssProto, prop);
      if (!d || !d.set) continue;
      Object.defineProperty(cssProto, prop, {
        configurable: true,
        enumerable: d.enumerable,
        get: d.get,
        set(v) {
          bump('style.set.' + prop);
          if (S.armed) { lastStyleWriteAt.v = now(); bump('styleWrite.armed'); }
          return d.set.call(this, v);
        },
      });
    }
  } catch (e) { S.stylePatchError = String(e); }

  const READS = [
    ['getBoundingClientRect', Element.prototype, 'rect'],
    ['offsetHeight', HTMLElement.prototype, 'offsetHeight'],
    ['offsetWidth', HTMLElement.prototype, 'offsetWidth'],
    ['offsetTop', HTMLElement.prototype, 'offsetTop'],
    ['offsetLeft', HTMLElement.prototype, 'offsetLeft'],
    ['clientHeight', Element.prototype, 'clientHeight'],
    ['clientWidth', Element.prototype, 'clientWidth'],
    ['scrollHeight', Element.prototype, 'scrollHeight'],
    ['scrollWidth', Element.prototype, 'scrollWidth'],
    ['scrollTop', Element.prototype, 'scrollTop'],
  ];
  for (const [name, proto, label] of READS) {
    const d = Object.getOwnPropertyDescriptor(proto, name);
    if (!d) { S.readPatchMiss = (S.readPatchMiss || []).concat(name); continue; }
    if (d.get) {
      Object.defineProperty(proto, name, {
        configurable: true, enumerable: d.enumerable,
        get() {
          bump('layout.read.' + label);
          if (S.armed) {
            const gap = now() - lastStyleWriteAt.v;
            if (gap >= 0 && gap < 8) { bump('layout.readAfterWrite.' + label); push('reflow', { api: label, gapMs: Math.round(gap * 100) / 100 }); }
          }
          return d.get.call(this);
        },
        set: d.set,
      });
    }
  }
  // getBoundingClientRect 走方法包裹（保留 this）
  Element.prototype.getBoundingClientRect = function (...a) {
    bump('layout.read.rect');
    if (S.armed) {
      const gap = now() - lastStyleWriteAt.v;
      if (gap >= 0 && gap < 8) { bump('layout.readAfterWrite.rect'); push('reflow', { api: 'rect', gapMs: Math.round(gap * 100) / 100 }); }
    }
    return Reflect.apply(origRect, this, a);
  };
  globalThis.getComputedStyle = function (...a) {
    bump('layout.read.gcs');
    if (S.armed) {
      const gap = now() - lastStyleWriteAt.v;
      if (gap >= 0 && gap < 8) { bump('layout.readAfterWrite.gcs'); push('reflow', { api: 'gcs', gapMs: Math.round(gap * 100) / 100 }); }
    }
    return Reflect.apply(origGCS, this, a);
  };

  /* ---- 8. 网络：WS 消息（会话流）+ fetch/XHR ---- */
  if (OrigWS) {
    const W = function (...a) {
      const ws = new OrigWS(...a);
      bump('ws.open');
      if (S.armed && S.roster.sockets.length < 20) S.roster.sockets.push({ url: String(a[0]).slice(0, 200), at: Math.round(now() - S.armAt) });
      try {
        ws.addEventListener('message', (ev) => {
          bump('ws.message');
          try {
            const d = typeof ev.data === 'string' ? ev.data.slice(0, 400) : '';
            const m = /"type"\s*:\s*"([^"]+)"/.exec(d);
            if (m) bump('ws.message.' + m[1]);
          } catch (e) { /* ignore */ }
        });
      } catch (e) { /* ignore */ }
      return ws;
    };
    W.prototype = OrigWS.prototype;
    for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) W[k] = OrigWS[k];
    globalThis.WebSocket = W;
  }
  if (origFetch) {
    globalThis.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      bump('fetch.call');
      if (S.armed && S.roster.fetches.length < 60) S.roster.fetches.push({ url: String(url).slice(0, 240), at: Math.round(now() - S.armAt) });
      return origFetch(input, init);
    };
  }

  /* ---- 9. 同步更新风暴 / 告警捕获（React 的 "update during render" 会走 console.error） ---- */
  console.warn = function (...a) { bump('console.warn'); if (S.console.length < 100) S.console.push({ lvl: 'warn', m: String(a[0]).slice(0, 400), at: Math.round(now() - S.epoch) }); return Reflect.apply(origWarn, console, a); };
  console.error = function (...a) { bump('console.error'); if (S.console.length < 100) S.console.push({ lvl: 'error', m: String(a[0]).slice(0, 400), at: Math.round(now() - S.epoch) }); return Reflect.apply(origError, console, a); };

  /* ---- 10. long task（>50ms）---- */
  try {
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        bump('longtask');
        S.longtasks.push({ start: Math.round(e.startTime * 10) / 10, dur: Math.round(e.duration * 10) / 10 });
      }
    });
    po.observe({ entryTypes: ['longtask'] });
    S.longtaskObserverReady = true;
  } catch (e) { S.longtaskObserverReady = false; }

  /* ---- 11. 自证：主动制造流量，证明每个计数器真的会动 ---- */
  S.selfTest = () => {
    const before = JSON.parse(JSON.stringify(S.c));
    const box = document.createElement('div');
    box.style.height = '3px';
    document.documentElement.appendChild(box);
    let fired = 0;
    const done = new Promise((res) => {
      let n = 0;
      const step = () => { fired += 1; if (n++ < 3) globalThis.requestAnimationFrame(step); else res(); };
      globalThis.requestAnimationFrame(step);
    });
    for (let i = 0; i < 200; i += 1) { box.style.height = (i % 5 + 1) + 'px'; void box.offsetHeight; void box.getBoundingClientRect(); }
    void globalThis.getComputedStyle(box).height;
    const st = origCreateElement.call(document, 'style');
    st.id = '__selftest_style__';
    document.head.appendChild(st);
    const to = origSetTimeout(() => {}, 1);
    origClearTimeout(to);
    const iv = origSetInterval(() => {}, 100000);
    origClearInterval(iv);
    const probe = document.createElement('span');
    const onX = () => {};
    probe.addEventListener('x', onX);
    probe.removeEventListener('x', onX);
    const moT = new OrigMO(() => {});
    moT.observe(box, { attributes: true });
    moT.disconnect();
    return done.then(() => {
      box.remove();
      st.remove();
      const after = JSON.parse(JSON.stringify(S.c));
      const delta = {};
      for (const k of Object.keys(after)) { const d = after[k] - (before[k] || 0); if (d !== 0) delta[k] = d; }
      return { fired, deltaKeys: Object.keys(delta).sort(), delta, mutationObserverReady: S.mutationObserverReady, longtaskObserverReady: S.longtaskObserverReady, readPatchMiss: S.readPatchMiss || null };
    });
  };

  /* ---- 12. 采样：DOM 节点数时间序列（结构增长） ---- */
  S.samples = [];
  origSetInterval(() => {
    try {
      S.samples.push({ t: Math.round((now() - S.epoch) * 10) / 10, nodes: document.querySelectorAll('*').length, styles: document.querySelectorAll('style').length });
    } catch (e) { /* ignore */ }
  }, 100);

  S.arm = () => { S.armed = true; S.armAt = now(); bump('ARM'); return S.armAt; };
  S.snapshot = () => ({
    at: now() - S.epoch,
    c: JSON.parse(JSON.stringify(S.c)),
    roster: S.roster,
    console: S.console,
    longtasks: S.longtasks,
    samples: S.samples,
    ev: S.ev,
    meta: S.meta(),
    mutationObserverReady: S.mutationObserverReady,
    longtaskObserverReady: S.longtaskObserverReady,
  });
})();
