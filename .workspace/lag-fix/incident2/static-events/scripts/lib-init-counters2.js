/**
 * lib-init-counters2.js — document-start 只读打桩（第 2 代，聚焦 forced reflow + 长帧归因）。
 *
 * 相对第 1 代（lib-init-counters.js）的增量：
 *  1) Long Animation Frame（LoAF）观测：把长帧拆成 duration / blockingDuration /
 *     renderStart / styleAndLayoutStart / firstUIEventTimestamp，并保留 attribution 的
 *     script 来源 —— 用于回答「106ms 长任务里多少是 JS、多少是 style+layout」；
 *  2) 样式表规则数/count 快照（证明打开设置是否新增 CSS 规则 → 重算范围）；
 *  3) forced reflow 判定放宽到 gap<50ms，并按 API 记录前 60 个带栈样本；
 *  4) 精细 rAF 帧间隔序列（点击后 40 帧）+ 每帧内是否发生 DOM mutation。
 * 仍然只读：不改产品行为、不改写返回值。
 */
(() => {
  const origRaf = globalThis.requestAnimationFrame.bind(globalThis);
  const now = () => performance.now();
  const S = {
    epoch: now(), armed: false, armAt: 0,
    c: Object.create(null), loops: [], loaf: [], frameGaps: [], reflow: [],
    styleSnapshots: [], armedReads: [],
  };
  globalThis.__DSH_STRESS2__ = S;
  const bump = (k, n) => { S.c[k] = (S.c[k] || 0) + (n === undefined ? 1 : n); };

  /* ---------- 1. LoAF：长帧归因 ---------- */
  try {
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        bump('loaf.count');
        if (S.loaf.length >= 200) continue;
        S.loaf.push({
          start: Math.round(e.startTime * 10) / 10,
          duration: Math.round(e.duration * 10) / 10,
          blockingDuration: e.blockingDuration === undefined ? null : Math.round(e.blockingDuration * 10) / 10,
          renderStart: e.renderStart === undefined ? null : Math.round(e.renderStart * 10) / 10,
          styleAndLayoutStart: e.styleAndLayoutStart === undefined ? null : Math.round(e.styleAndLayoutStart * 10) / 10,
          firstUIEventTimestamp: e.firstUIEventTimestamp === undefined ? null : Math.round(e.firstUIEventTimestamp * 10) / 10,
          scripts: (e.scripts || []).slice(0, 12).map((s) => ({
            name: s.name, entryType: s.entryType, startTime: Math.round(s.startTime * 10) / 10,
            duration: Math.round(s.duration * 10) / 10,
            invoker: s.invoker ? String(s.invoker).slice(0, 60) : null,
            invokerType: s.invokerType || null,
            sourceURL: s.sourceURL ? String(s.sourceURL).slice(0, 160) : null,
            sourceFunctionName: s.sourceFunctionName || null,
            forcedStyleAndLayoutDuration: s.forcedStyleAndLayoutDuration === undefined ? null : Math.round(s.forcedStyleAndLayoutDuration * 10) / 10,
            pauseDuration: s.pauseDuration === undefined ? null : Math.round(s.pauseDuration * 10) / 10,
          })),
          // 派生结论：style+layout 时间 = duration - (renderStart - start) 的余量
          derived: {
            scriptAndTaskBeforeRender: e.renderStart === undefined ? null : Math.round((e.renderStart - e.startTime) * 10) / 10,
            renderPhase: (e.renderStart === undefined || e.duration === undefined) ? null : Math.round((e.startTime + e.duration - e.renderStart) * 10) / 10,
          },
        });
      }
    });
    po.observe({ type: 'long-animation-frame', buffered: true });
    S.loafReady = true;
  } catch (e) { S.loafReady = false; S.loafError = String(e).slice(0, 200); }

  /* ---------- 2. 样式表规则数快照 ---------- */
  S.cssCensus = () => {
    let rules = 0, sheets = 0, inaccessible = 0;
    for (const ss of Array.from(document.styleSheets)) {
      sheets += 1;
      try { rules += (ss.cssRules || []).length; } catch (e) { inaccessible += 1; }
    }
    return { sheets, rules, inaccessible, styleTags: document.querySelectorAll('style').length, nodes: document.querySelectorAll('*').length };
  };

  /* ---------- 3. forced reflow：写→读严格相邻（gap<50ms） ---------- */
  let lastWriteAt = -1e9;
  try {
    const cssProto = CSSStyleDeclaration.prototype;
    for (const prop of ['cssText', 'height', 'width', 'top', 'left', 'visibility']) {
      const d = Object.getOwnPropertyDescriptor(cssProto, prop);
      if (!d || !d.set) continue;
      Object.defineProperty(cssProto, prop, {
        configurable: true, enumerable: d.enumerable, get: d.get,
        set(v) { lastWriteAt = now(); bump('style.set.' + prop); return d.set.call(this, v); },
      });
    }
    const sp = cssProto.setProperty;
    cssProto.setProperty = function (...a) { lastWriteAt = now(); bump('style.setProperty'); return Reflect.apply(sp, this, a); };
    const cl = Element.prototype.classList;
    void cl;
    const addOrig = DOMTokenList.prototype.add;
    DOMTokenList.prototype.add = function (...a) { lastWriteAt = now(); bump('classList.add'); return Reflect.apply(addOrig, this, a); };
    const remOrig = DOMTokenList.prototype.remove;
    DOMTokenList.prototype.remove = function (...a) { lastWriteAt = now(); bump('classList.remove'); return Reflect.apply(remOrig, this, a); };
    // 属性写入（class/style 属性由 React 直接 setAttribute 时）
    const sa = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, val) {
      if (name === 'style' || name === 'class') { lastWriteAt = now(); bump('attr.set.' + name); }
      return Reflect.apply(sa, this, arguments);
    };
  } catch (e) { S.stylePatchError = String(e).slice(0, 300); }

  const READS = [
    ['getBoundingClientRect', Element.prototype, 'rect'],
    ['offsetHeight', HTMLElement.prototype, 'offsetHeight'],
    ['offsetWidth', HTMLElement.prototype, 'offsetWidth'],
    ['clientHeight', Element.prototype, 'clientHeight'],
    ['clientWidth', Element.prototype, 'clientWidth'],
    ['scrollHeight', Element.prototype, 'scrollHeight'],
    ['scrollWidth', Element.prototype, 'scrollWidth'],
    ['scrollTop', Element.prototype, 'scrollTop'],
  ];
  const READ_GAP_MS = 50;
  const origGCS = globalThis.getComputedStyle;
  const noteRead = (label) => {
    bump('layout.read.' + label);
    if (!S.armed) return;
    const gap = now() - lastWriteAt;
    if (gap < READ_GAP_MS) {
      bump('reflow.' + label);
      if (S.reflow.length < 200) {
        S.reflow.push({ api: label, gapMs: Math.round(gap * 100) / 100, at: Math.round((now() - S.armAt) * 10) / 10, stack: String(new Error().stack || '').split('\n').slice(2, 7).map((s) => s.trim().replace(/^at /, '')).join(' <- ').slice(0, 500) });
      }
    }
    if (S.armedReads.length < 300) {
      S.armedReads.push({ api: label, at: Math.round((now() - S.armAt) * 10) / 10, gapMs: Math.round(gap * 100) / 100, stack: String(new Error().stack || '').split('\n').slice(2, 6).map((s) => s.trim().replace(/^at /, '')).join(' <- ').slice(0, 400) });
    }
  };
  for (const [name, proto, label] of READS) {
    const d = Object.getOwnPropertyDescriptor(proto, name);
    if (!d || !d.get) { S.readPatchMiss = (S.readPatchMiss || []).concat(name); continue; }
    Object.defineProperty(proto, name, { configurable: true, enumerable: d.enumerable, get() { noteRead(label); return d.get.call(this); }, set: d.set });
  }
  globalThis.getComputedStyle = function (...a) { noteRead('gcs'); return Reflect.apply(origGCS, this, a); };

  /* ---------- 4. rAF 精细序列：帧间隔 + 帧内是否有 mutation ---------- */
  let mutCounter = 0;
  try {
    const mo = new MutationObserver((recs) => { mutCounter += recs.length; bump('mut.total', recs.length); });
    mo.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    S.moReady = true;
  } catch (e) { S.moReady = false; }

  let lastFrame = 0;
  const tick = (ts) => {
    if (S.armed) {
      const gap = lastFrame === 0 ? null : Math.round((ts - lastFrame) * 10) / 10;
      if (S.frameGaps.length < 120) S.frameGaps.push({ ts: Math.round(ts * 10) / 10, gapMs: gap, mutsInPrevFrame: mutCounter });
      mutCounter = 0;
    }
    lastFrame = ts;
    origRaf(tick);
  };
  origRaf(tick);

  S.arm = () => { S.armed = true; S.armAt = now(); lastFrame = 0; return S.armAt; };
  S.snapshot = () => ({
    c: JSON.parse(JSON.stringify(S.c)),
    loaf: S.loaf, frameGaps: S.frameGaps, reflow: S.reflow,
    armedReads: S.armedReads, css: S.cssCensus(),
    loafReady: S.loafReady, moReady: S.moReady, readPatchMiss: S.readPatchMiss || null,
    stylePatchError: S.stylePatchError || null,
  });
})();
