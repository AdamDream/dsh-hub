/*
 * incident2/regression — 页内只读 stub 模块
 *
 * 纪律：不改任何产品文件。本文件的内容通过 addInitScript 注入页面（页面内存生效），
 * P2AC 面例外：它需要改**包内闭包**里的实现，因此用 Playwright 的 route 在**传输中**改写
 * 响应字节（磁盘上的产品文件零改动），并把替换命中数写进 __REG__.selfProof 作为自证。
 *
 * 每个 stub 都必须自证生效：__REG__.probe.snapshot().selfProof 里给出「本应发生的次数」
 * 与「实际被拦下的次数」两个计数器，二者都 >0 才算生效（harness 会据此判 PASS/FAIL）。
 */
(() => {
  const R = window.__REG__ || (window.__REG__ = {});
  const COND = R.cond;
  R.stubLog = [];
  const log = (k, v) => { R.stubLog.push([Date.now(), k, v]); };

  const counters = {
    // 面1：主题内容签名跳过
    tpSignatureChecks: 0, tpSkipTake: 0, tpForcedReplay: 0, tpTokenReadbacks: 0, tpBodyWrites: 0,
    tpBodyWritesInClick: 0, tpApplySeen: 0, tpApplySeenInClick: 0,
    // 面4：theme-color meta 写回（延后 vs 同步）
    tcRafScheduled: 0, tcRafScheduledInClick: 0, tcSyncInvoked: 0,
    tcRefreshRan: 0, tcComputedReads: 0, tcComputedReadsInRaf: 0, tcComputedReadsInClick: 0,
    tcMetaInserted: 0, tcMetaContentWrites: 0, tcMetaContentWritesInClick: 0, tcMetaWritesInRaf: 0,
    // 面3：usage 卡片首挂载 9 路请求
    usageRequestsSeen: 0, usageRequestsSeenInClick: 0, usageRequestsBlocked: 0, usageByMethod: {},
    // 面2：P2AC（route 改写，计数由 harness 侧汇总）
    p2acOldCarryHits: 0, p2acKeyGateActive: 0,
    // 通用
    fetchSeen: 0, xhrSeen: 0, wsFramesSeen: 0,
    http: {},
    httpInClick: {},
  };
  R.counters = counters;
  R.__rafHandle = 5000;

  // ---------------------------------------------------------------- 面1：主题签名跳过
  // 修复版 apply() 的门是 `signature === lastSignature && this.landingIntact(scheme, body)`。
  // stub 令 landingIntact 恒为 false ⇒ 门不成立 ⇒ 每次 apply 都走完整重放（旧行为）。
  // 代价面 = body.style 写入 + 随后的强制重算，视觉终态完全一致（重放是幂等的）。
  if (COND === "tp-off") {
    const proto = CSSStyleDeclaration.prototype;
    const realGet = proto.getPropertyValue;
    proto.getPropertyValue = function (name) {
      // landingIntact 的唯一读回口径：只骗它一个调用点，其它读回保持真实
      try {
        if (R.armTpReadback === true && this === document.body.style) {
          counters.tpTokenReadbacks += 1;
          counters.tpForcedReplay += 1;
          return "";
        }
      } catch (e) { /* noop */ }
      return realGet.call(this, name);
    };
    const realSet = proto.setProperty;
    proto.setProperty = function (name, value, prio) {
      if (this === document.body.style) {
        counters.tpBodyWrites += 1;
        if (R.clickPhase === true) counters.tpBodyWritesInClick += 1;
      }
      return realSet.call(this, name, value, prio);
    };
  } else {
    // 对照组也计数（不改变行为）：用于给出「应当发生的次数」基线
    const proto = CSSStyleDeclaration.prototype;
    const realSet = proto.setProperty;
    proto.setProperty = function (name, value, prio) {
      if (this === document.body.style) {
        counters.tpBodyWrites += 1;
        if (R.clickPhase === true) counters.tpBodyWritesInClick += 1;
      }
      return realSet.call(this, name, value, prio);
    };
    const realGet = proto.getPropertyValue;
    proto.getPropertyValue = function (name) {
      if (this === document.body.style) counters.tpTokenReadbacks += 1;
      return realGet.call(this, name);
    };
  }

  // ---------------------------------------------------------------- 面4：theme-color 写回同步化
  // 修复版把 meta.content 的写回延后到下一个 rAF（scheduleThemeColorRefresh）。
  // stub 令 requestAnimationFrame 同步执行并返回可用 handle ⇒ 等于回到「帧内同步写回」。
  // （rAF 替换与计数在下方「决定性口径②」处统一安装，避免两处各装一次。）
  // 强制样式重算的观测：meta 写回必须读 computed body background
  const realGCS = window.getComputedStyle.bind(window);
  window.getComputedStyle = function (el, ps) {
    if (el === document.body) {
      counters.tcComputedReads += 1;
      // 决定性口径①：theme-color meta 的写回就是「读 computed body background 后写 content」。
      // 读侧栈里出现 refreshThemeColor 才证明修复路径真的执行了（而不是「路径根本没跑」）。
      try {
        const e = new Error();
        const st = String(e.stack || "");
        if (/refreshThemeColor/.test(st)) counters.tcRefreshRan += 1;
        if (/(^|\s)at\s+apply\s*\(/.test(st) || /\bThemePresenter\b/.test(st)) { counters.tpApplySeen += 1; if (R.clickPhase === true) counters.tpApplySeenInClick += 1; }
      } catch (err) { }
      // 决定性口径③：这些读是否发生在 rAF 回调内（用来验「本帧是否被点到过」）
      try {
        if (R.rafCallbackDepth > 0) counters.tcComputedReadsInRaf += 1;
        if (R.clickPhase === true) counters.tcComputedReadsInClick += 1;
      } catch (err) { }
    }
    return realGCS(el, ps);
  };

  // 决定性口径②：stub 的同步 rAF 分支是否真的被生产代码走到
  if (COND === "theme-sync") {
    const r = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = function (cb) {
      counters.tcRafScheduled += 1;
      if (R.clickPhase === true) counters.tcRafScheduledInClick += 1;
      counters.tcSyncInvoked += 1;
      R.rafCallbackDepth = (R.rafCallbackDepth || 0) + 1;
      try { cb(performance.now()); } finally { R.rafCallbackDepth -= 1; }
      return ++R.__rafHandle;
    };
  } else {
    const r = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = function (cb) {
      counters.tcRafScheduled += 1;
      if (R.clickPhase === true) counters.tcRafScheduledInClick += 1;
      return r(function (ts) {
        R.rafCallbackDepth = (R.rafCallbackDepth || 0) + 1;
        try { return cb(ts); } finally { R.rafCallbackDepth -= 1; }
      });
    };
  }

  // 决定性口径④：theme-color meta 节点的 content 写入次数（修复把这一写从帧内推到帧末）
  try {
    const origAppend = Element.prototype.append;
    Element.prototype.append = function () {
      const r = origAppend.apply(this, arguments);
      try {
        for (const n of arguments) if (n && n.tagName === "META" && n.getAttribute && n.getAttribute("name") === "theme-color") {
          counters.tcMetaInserted += 1;
          const desc = Object.getOwnPropertyDescriptor(HTMLMetaElement.prototype, "content");
          if (desc && desc.set && !n.__regPatched) {
            n.__regPatched = true;
            Object.defineProperty(n, "content", {
              configurable: true,
              get() { return desc.get.call(this); },
              set(v) {
                counters.tcMetaContentWrites += 1;
                if (R.clickPhase === true) counters.tcMetaContentWritesInClick += 1;
                if (R.rafCallbackDepth > 0) counters.tcMetaWritesInRaf += 1;
                return desc.set.call(this, v);
              }
            });
          }
        }
      } catch (e) { }
      return r;
    };
  } catch (e) { }

  // ---------------------------------------------------------------- 面3：usage 卡片首挂载 9 路请求
  // 修复前的首挂载会一次性发起 9 路 usage RPC（summary / timeseries×2 / heatmap /
  // byModel / byProject / byDay / sessions / status）。stub 只拦 usage 这一族方法，
  // 不碰 settings.probe 等设置页自身请求（否则会污染被测路径本身）。
  const USAGE_METHODS = new Set(["summary", "timeseries", "heatmap", "byModel", "byProject", "byDay", "sessions", "status", "refresh"]);
  function classify(body) {
    if (typeof body !== "string" || body.indexOf("usage") < 0) return null;
    try {
      const j = JSON.parse(body);
      const m = j && (j.method || (j.payload && j.payload.method));
      const ch = j && (j.channel || (j.payload && j.payload.channel));
      if (!m) return null;
      const isUsage = USAGE_METHODS.has(m) && (ch === undefined || ch === null || /usage/i.test(String(ch)) || /usage/i.test(body));
      return isUsage ? m : null;
    } catch (e) { return null; }
  }
  const blockUsage = (COND === "usage-nofetch");
  // 页面侧 HTTP 往返计时（只读观测）：把「宿主事件循环拥堵」在**同一次被测窗口内**量化，
  // 而不是引外部采样文件。端点按路径归并，记录 count/total/p99/max。
  function record(key, ms) {
    const add = (bag) => {
      const b = bag[key] || (bag[key] = { n: 0, total: 0, max: 0, samples: [] });
      b.n += 1; b.total += ms; if (ms > b.max) b.max = ms;
      if (b.samples.length < 400) b.samples.push(Math.round(ms * 100) / 100);
    };
    add(counters.http);
    if (R.clickPhase === true) add(counters.httpInClick);
  }

  const realFetch = window.fetch;
  if (typeof realFetch === "function") {
    window.fetch = function (input, init) {
      counters.fetchSeen += 1;
      const body = init && typeof init.body === "string" ? init.body : (typeof input === "string" ? null : null);
      const m = classify(body);
      if (m) {
        counters.usageRequestsSeen += 1;
        if (R.clickPhase === true) counters.usageRequestsSeenInClick += 1;
        counters.usageByMethod[m] = (counters.usageByMethod[m] || 0) + 1;
        if (blockUsage) {
          counters.usageRequestsBlocked += 1;
          return Promise.resolve(new Response(JSON.stringify({ ok: false, error: { message: "stub: usage-nofetch" } }), { status: 200, headers: { "content-type": "application/json" } }));
        }
      }
      const t = performance.now();
      const url = typeof input === "string" ? input : (input && input.url) || "";
      const pr = realFetch.apply(this, arguments);
      const key = url.split("?")[0].replace(/^https?:\/\/[^/]+/, "") || "/";
      return pr.then((r) => {
        record(key, performance.now() - t);
        return r;
      }, (e) => { record(key, performance.now() - t); throw e; });
    };
  }
  const RealXHR = window.XMLHttpRequest;
  if (RealXHR) {
    const realOpen = RealXHR.prototype.open;
    const realSend = RealXHR.prototype.send;
    RealXHR.prototype.open = function (method, url) { this.__regUrl = url; this.__regMethod = method; counters.xhrSeen += 1; return realOpen.apply(this, arguments); };
    RealXHR.prototype.send = function (body) {
      const m = classify(body);
      if (m) {
        counters.usageRequestsSeen += 1;
        if (R.clickPhase === true) counters.usageRequestsSeenInClick += 1;
        counters.usageByMethod[m] = (counters.usageByMethod[m] || 0) + 1;
        if (blockUsage) {
          counters.usageRequestsBlocked += 1;
          // 用真实的 200 空壳回应，避免插件走错误分支反复重试
          const self = this;
          setTimeout(() => {
            try {
              Object.defineProperty(self, "readyState", { value: 4, configurable: true });
              Object.defineProperty(self, "status", { value: 200, configurable: true });
              Object.defineProperty(self, "responseText", { value: JSON.stringify({ ok: false, error: { message: "stub: usage-nofetch" } }), configurable: true });
              Object.defineProperty(self, "response", { value: self.responseText, configurable: true });
              if (typeof self.onreadystatechange === "function") self.onreadystatechange();
              self.dispatchEvent(new Event("load"));
              self.dispatchEvent(new Event("loadend"));
            } catch (e) { }
          }, 0);
          return;
        }
      }
      const t = performance.now();
      const self = this;
      const key = String(self.__regUrl || "/").split("?")[0].replace(/^https?:\/\/[^/]+/, "");
      const done = () => { try { record(key, performance.now() - t); } catch (e) { } };
      try { self.addEventListener("loadend", done, { once: true }); } catch (e) { }
      return realSend.apply(this, arguments);
    };
  }
  // WebSocket 观测（只读）
  try {
    const RealWS = window.WebSocket;
    if (RealWS) {
      window.WebSocket = function (...a) {
        const ws = new RealWS(...a);
        ws.addEventListener("message", () => { counters.wsFramesSeen += 1; });
        return ws;
      };
      window.WebSocket.prototype = RealWS.prototype;
      Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
    }
  } catch (e) { }

  // ---------------------------------------------------------------- 自证口径
  R.probe = {
    snapshot() {
      const sp = {};
      if (COND === "tp-off") {
        sp.mechanism = "landingIntact forced false via body getPropertyValue readback";
        sp.expected = "readback>0 且 forcedReplay==readback";
        sp.tpTokenReadbacks = counters.tpTokenReadbacks;
        sp.tpForcedReplay = counters.tpForcedReplay;
        sp.effective = counters.tpTokenReadbacks > 0 && counters.tpForcedReplay === counters.tpTokenReadbacks;
      } else if (COND === "theme-sync") {
        sp.mechanism = "requestAnimationFrame invoked synchronously";
        sp.expected = "rafScheduled>0 且 syncInvoked==rafScheduled";
        sp.tcRafScheduled = counters.tcRafScheduled;
        sp.tcSyncInvoked = counters.tcSyncInvoked;
        sp.effective = counters.tcRafScheduled > 0 && counters.tcSyncInvoked === counters.tcRafScheduled;
      } else if (COND === "usage-nofetch") {
        sp.mechanism = "usage RPC family blocked at fetch/xhr";
        sp.expected = "seen>0 且 blocked==seen";
        sp.usageRequestsSeen = counters.usageRequestsSeen;
        sp.usageRequestsBlocked = counters.usageRequestsBlocked;
        sp.usageByMethod = { ...counters.usageByMethod };
        sp.effective = counters.usageRequestsSeen > 0 && counters.usageRequestsBlocked === counters.usageRequestsSeen;
      } else if (COND === "p2ac-old") {
        sp.mechanism = "in-flight route rewrite of client.js (disk untouched)";
        sp.expected = "由 harness 侧记录的两个替换命中数";
        sp.effective = null; // harness 侧填
      } else {
        sp.mechanism = "control: read-only counters only";
        sp.expected = "counters 变化即证明观测生效";
        sp.effective = counters.tpBodyWrites > 0 || counters.tcComputedReads > 0;
      }
      sp.counters = { ...counters };
      // 路径可达性（与「stub 是否生效」分开报告：stub 可能生效但路径根本没跑）
      sp.pathReachable = {
        themeApplyRan: counters.tpApplySeen > 0,
        themeApplyRanInClick: counters.tpApplySeenInClick > 0,
        themeRefreshRan: counters.tcRefreshRan > 0,
        metaContentWrites: counters.tcMetaContentWrites,
        metaContentWritesInClick: counters.tcMetaContentWritesInClick,
        bodyWrites: counters.tpBodyWrites,
        bodyWritesInClick: counters.tpBodyWritesInClick,
        computedReadsInClick: counters.tcComputedReadsInClick,
        usageSeen: counters.usageRequestsSeen,
        usageSeenInClick: counters.usageRequestsSeenInClick,
      };
      // 结论口径：stub 只有在「其机制本应被调用」且「确实被调用」时才有效
      sp.effectiveStrict = (function () {
        if (COND === "tp-off") return counters.tpTokenReadbacks > 0 && counters.tpForcedReplay === counters.tpTokenReadbacks;
        if (COND === "theme-sync") return counters.tcRafScheduled > 0 && counters.tcSyncInvoked === counters.tcRafScheduled;
        if (COND === "usage-nofetch") return counters.usageRequestsSeen > 0 && counters.usageRequestsBlocked === counters.usageRequestsSeen;
        if (COND === "p2ac-old") return null;
        return counters.tpBodyWrites > 0 || counters.tcComputedReads > 0;
      })();
      const summ = (bag) => {
        const out = {};
        for (const k of Object.keys(bag)) {
          const b = bag[k];
          const v = [...b.samples].sort((a, c) => a - c);
          out[k] = { n: b.n, totalMs: Math.round(b.total * 100) / 100,
            p50: v.length ? v[Math.floor(0.5 * v.length)] : null,
            p99: v.length ? v[Math.floor(0.99 * v.length)] : null, max: Math.round(b.max * 100) / 100 };
        }
        return out;
      };
      sp.http = summ(counters.http);
      sp.httpInClick = summ(counters.httpInClick);
      sp.stubLog = R.stubLog.slice(0, 20);
      return sp;
    }
  };
  log("installed", COND);
})();
