/*
 * incident2/regression — 面4（主题 rAF 延后）专用页内只读 stub / 器械
 *
 * 与 tools/stubs.js 的差异（全部为「面4」必需的器械改进，产品文件零改动）：
 *   1. rAF 包装里对**调用点**做栈分类：把「器械自己的 rAF 心跳」与「生产代码
 *      scheduleThemeColorRefresh 排的 rAF」分开计数 —— 这直接回答「tcRafScheduled 大
 *      不能证明生产代码调用过 rAF」这个器械陷阱。
 *   2. theme-sync 分支改为**带重入保护的同步 rAF**：只有当 rAF 是在「非 rAF 回调内」
 *      被排程时才同步执行（= 回到帧内同步写回）；在 rAF 回调内部排的 rAF 仍走真 rAF，
 *      避免把器械心跳/任何自续 rAF 循环变成无限递归。原始 tools/stubs.js 的无条件同步
 *      rAF 会把 firstopen-ab.mjs 自己的心跳 tick 变成无限递归 → RangeError（见 repro 证据）。
 *   3. 计数器保留 tools/stubs.js 的**同名项**（tcRafScheduled / tcSyncInvoked /
 *      tcMetaContentWrites(InClick) / tcComputedReads(InRaf/InClick) / tcRefreshRan /
 *      tcMetaWritesInRaf / tpApplySeen(InClick) / tpBodyWrites(InClick) / tpTokenReadbacks /
 *      usageRequestsSeen…），便于与共享器械窗口逐项对照；新增项一律以 raf 前缀命名。
 *
 * 纪律：只读观测；不改产品文件；不改变页面行为（theme-sync 分支除外，其目的就是回到旧行为）。
 */
(() => {
  const R = window.__REG__ || (window.__REG__ = {});
  const MODE = R.cond; // "base" | "theme-sync"
  R.stubLog = [];
  const log = (k, v) => { R.stubLog.push([Date.now(), k, v]); };

  const counters = {
    // —— 与 tools/stubs.js 同名的面4/面1 计数（跨器械可比） ——
    tpSignatureChecks: 0, tpSkipTake: 0, tpForcedReplay: 0, tpTokenReadbacks: 0,
    tpBodyWrites: 0, tpBodyWritesInClick: 0, tpApplySeen: 0, tpApplySeenInClick: 0,
    tcRafScheduled: 0, tcRafScheduledInClick: 0, tcSyncInvoked: 0,
    tcRefreshRan: 0, tcComputedReads: 0, tcComputedReadsInRaf: 0, tcComputedReadsInClick: 0,
    tcMetaInserted: 0, tcMetaContentWrites: 0, tcMetaContentWritesInClick: 0, tcMetaWritesInRaf: 0,
    usageRequestsSeen: 0, usageRequestsSeenInClick: 0, usageRequestsBlocked: 0, usageByMethod: {},
    p2acOldCarryHits: 0, p2acKeyGateActive: 0,
    fetchSeen: 0, xhrSeen: 0, wsFramesSeen: 0,
    // —— 面4 新增：rAF 调用点分类（回答「器械心跳 vs 生产调用」） ——
    rafCallsTotal: 0, rafCallsInClick: 0,
    rafByHeartbeat: 0, rafByHeartbeatInClick: 0,
    rafByProdThemeDefer: 0, rafByProdThemeDeferInClick: 0,
    rafByOther: 0, rafByOtherInClick: 0,
    rafStackSamplesTaken: 0,
    rafProdStackSamples: [], rafOtherSamples: {},
    // —— 面4 新增：同步化分支的执行证据（仅 theme-sync 模式非零） ——
    rafSyncExecuted: 0, rafSyncExecutedProd: 0, rafSyncExecutedProdInClick: 0,
    rafSyncFallback: 0, rafSyncFallbackInsideCallback: 0, rafSyncFallbackFromProd: 0,
    // —— 面4 新增：同步化是否真的把「meta 写回」搬回了帧内 ——
    tcMetaWritesInSyncRafCallback: 0, tcComputedReadsInSyncRafCallback: 0,
  };
  R.counters = counters;
  R.__rafHandle = 5000;
  R.rafCallbackDepth = 0;

  // ---------------------------------------------------------- 面1 只读计数（两模式都装）
  const proto = CSSStyleDeclaration.prototype;
  const realSet = proto.setProperty;
  proto.setProperty = function (n, v, p) {
    if (this === document.body.style) { counters.tpBodyWrites += 1; if (R.clickPhase === true) counters.tpBodyWritesInClick += 1; }
    return realSet.call(this, n, v, p);
  };
  const realGet = proto.getPropertyValue;
  proto.getPropertyValue = function (n) {
    if (this === document.body.style) counters.tpTokenReadbacks += 1;
    return realGet.call(this, n);
  };

  // ---------------------------------------------------------- 强制重算观测（两模式都装）
  const realGCS = window.getComputedStyle.bind(window);
  window.getComputedStyle = function (el, ps) {
    if (el === document.body) {
      counters.tcComputedReads += 1;
      try {
        const st = String((new Error()).stack || "");
        if (/refreshThemeColor/.test(st)) counters.tcRefreshRan += 1;
        if (/\bThemePresenter\b/.test(st) || /(^|\s)at\s+apply\s*\(/.test(st)) {
          counters.tpApplySeen += 1; if (R.clickPhase === true) counters.tpApplySeenInClick += 1;
        }
        if (R.rafCallbackDepth > 0) {
          counters.tcComputedReadsInRaf += 1;
          if (R.rafSyncDepth > 0) counters.tcComputedReadsInSyncRafCallback += 1;
        }
        if (R.clickPhase === true) counters.tcComputedReadsInClick += 1;
      } catch (e) { }
    }
    return realGCS(el, ps);
  };

  // ---------------------------------------------------------- theme-color meta content 写回
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
                if (R.rafSyncDepth > 0) counters.tcMetaWritesInSyncRafCallback += 1;
                return desc.set.call(this, v);
              }
            });
          }
        }
      } catch (e) { }
      return r;
    };
  } catch (e) { }

  // ---------------------------------------------------------- rAF：调用点分类 + 可选同步化
  const realRAF = (window.__REALRAF || window.requestAnimationFrame).bind(window);
  const SYNC = (MODE === "theme-sync" || MODE === "theme-sync-faithful");
  /*
   * theme-sync-faithful：同步执行后**返回 falsy handle（0）**。
   * 原因：生产代码用 rAF 的返回值当「在飞」标志（`themeColorFrame = request(...)`，回调里再置 0）。
   * 若同步执行后返回一个真 handle，回调早已把 flag 置 0，但赋值发生在回调之后 ⇒ flag 被写成非 0 且
   * 永远不会被重置 ⇒ 后续 scheduleThemeColorRefresh 全部早退（"同步臂只刷新 1 次"这一伪影）。
   * 返回 0 让该标志始终读作「未排程」，从而忠实复现「每次 apply 都帧内同步写回」的旧行为。
   * 仅对生产主题调度这么做，其它调用者仍拿到真 handle（避免影响别的 rAF 使用者）。
   */
  const FAITHFUL = (MODE === "theme-sync-faithful");
  const PROD_RE = /scheduleThemeColorRefresh/;

  function topFrames(stack, n) {
    return String(stack || "").split("\n").slice(1, 1 + n)
      .map((s) => s.trim().replace(/^at\s+/, "").replace(/\s*\(.*$/, "")).join(" <- ");
  }

  window.requestAnimationFrame = function (cb) {
    counters.rafCallsTotal += 1;
    counters.tcRafScheduled += 1;
    if (R.clickPhase === true) { counters.rafCallsInClick += 1; counters.tcRafScheduledInClick += 1; }

    const fromHeartbeat = (R.__hbScheduling === true);
    // 心跳是器械自己的；其余调用必须靠栈来判定是不是生产代码的 scheduleThemeColorRefresh。
    let stack = "";
    if (!fromHeartbeat || counters.rafStackSamplesTaken < 12) {
      counters.rafStackSamplesTaken += 1;
      try { stack = String((new Error()).stack || ""); } catch (e) { }
    }
    let kind;
    if (fromHeartbeat) kind = "heartbeat";
    else if (PROD_RE.test(stack)) kind = "prodThemeDefer";
    else kind = "other";

    if (kind === "heartbeat") { counters.rafByHeartbeat += 1; if (R.clickPhase === true) counters.rafByHeartbeatInClick += 1; }
    else if (kind === "prodThemeDefer") {
      counters.rafByProdThemeDefer += 1;
      if (R.clickPhase === true) counters.rafByProdThemeDeferInClick += 1;
      if (counters.rafProdStackSamples.length < 4) counters.rafProdStackSamples.push(topFrames(stack, 4));
    } else {
      counters.rafByOther += 1; if (R.clickPhase === true) counters.rafByOtherInClick += 1;
      const sig = topFrames(stack, 3) || "(no stack)";
      counters.rafOtherSamples[sig] = (counters.rafOtherSamples[sig] || 0) + 1;
    }

    const wrapReal = (fn) => function (ts) {
      R.rafCallbackDepth += 1;
      try { return fn(ts); } finally { R.rafCallbackDepth -= 1; }
    };
    const runSync = (fn) => {
      counters.rafSyncExecuted += 1;
      if (kind === "prodThemeDefer") {
        counters.rafSyncExecutedProd += 1;
        if (R.clickPhase === true) counters.rafSyncExecutedProdInClick += 1;
      }
      if (kind === "prodThemeDefer") counters.tcSyncInvoked += 1;
      R.rafCallbackDepth += 1; R.rafSyncDepth = (R.rafSyncDepth || 0) + 1;
      try { return fn(performance.now()); } finally {
        R.rafCallbackDepth -= 1;
        R.rafSyncDepth = Math.max(0, (R.rafSyncDepth || 0) - 1);
      }
    };

    if (SYNC && !fromHeartbeat && R.rafCallbackDepth === 0) {
      // 生产代码在「帧回调之外」排的 rAF → 同步执行 = 帧内同步写回（旧行为）。
      runSync(cb);
      if (FAITHFUL && kind === "prodThemeDefer") return 0;   // 见 FAITHFUL 注释：避免 flag 伪影
      return ++R.__rafHandle;
    }
    if (SYNC) {
      counters.rafSyncFallback += 1;
      if (kind === "prodThemeDefer") counters.rafSyncFallbackFromProd += 1;
      if (R.rafCallbackDepth > 0) counters.rafSyncFallbackInsideCallback += 1;
    }
    return realRAF(wrapReal(cb));
  };

  // ---------------------------------------------------------- 自证（与「路径可达性」分开）
  R.probe = {
    snapshot() {
      const sp = {};
      if (SYNC) {
        sp.mechanism = (FAITHFUL ? "[faithful] " : "") + "reentrancy-guarded synchronous requestAnimationFrame (theme-color 写回回到帧内)" + (FAITHFUL ? "；生产主题调度返回 falsy handle 以消除在飞标志伪影" : "");
        sp.expected = "rafSyncExecutedProd>0（生产 scheduleThemeColorRefresh 排的 rAF 被同步执行）";
        sp.effective = counters.rafCallsTotal > 0 && counters.rafSyncExecuted > 0;
        sp.effectiveStrict = counters.rafSyncExecutedProd > 0;
      } else {
        sp.mechanism = "control: read-only counters + rAF 调用点栈分类";
        sp.expected = "counters 变化即证明观测生效";
        sp.effective = counters.tpBodyWrites > 0 || counters.tcComputedReads > 0;
        sp.effectiveStrict = counters.tpBodyWrites > 0 || counters.tcComputedReads > 0;
      }
      sp.cond = MODE;
      sp.counters = JSON.parse(JSON.stringify(counters));
      sp.pathReachable = {
        themeApplyRan: counters.tpApplySeen > 0,
        themeApplyRanInClick: counters.tpApplySeenInClick > 0,
        themeRefreshRan: counters.tcRefreshRan > 0,
        themeDeferScheduledByProd: counters.rafByProdThemeDefer > 0,
        themeDeferScheduledByProdInClick: counters.rafByProdThemeDeferInClick > 0,
        metaContentWrites: counters.tcMetaContentWrites,
        metaContentWritesInClick: counters.tcMetaContentWritesInClick,
        bodyWrites: counters.tpBodyWrites,
        bodyWritesInClick: counters.tpBodyWritesInClick,
        computedReadsInClick: counters.tcComputedReadsInClick,
        usageSeen: counters.usageRequestsSeen,
        usageSeenInClick: counters.usageRequestsSeenInClick,
      };
      sp.stubLog = R.stubLog.slice(0, 20);
      return sp;
    }
  };
  log("installed", MODE);
})();
