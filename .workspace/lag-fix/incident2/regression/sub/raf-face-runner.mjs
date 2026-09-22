#!/usr/bin/env node
/**
 * incident2/regression — 面4（主题 rAF 延后）实测器械
 *
 * 为什么不是直接用 tools/firstopen-ab.mjs --cond theme-sync：
 *   共享器械的 theme-sync stub（tools/stubs.js 第 106–115 行）把 window.requestAnimationFrame
 *   无条件替换为「同步执行并返回 handle」。而 firstopen-ab.mjs 自己在 arm 相位用 rAF 装了一个
 *   自续心跳（第 180–183 行：tick 内部再 requestAnimationFrame(tick)）。两者相撞 = 无限递归 →
 *   RangeError 从 page.evaluate 抛出 → 该窗口在**写 JSON 之前**就崩掉（浏览器也不会 close）。
 *   本器械的 --mode repro 会用**未修改的** tools/stubs.js 复现这一点作为证据。
 *
 * 本器械的做法（产品文件零改动、只读观测；唯一行为变量 = 受控的 rAF 同步化）：
 *   · 页内 stub = sub/raf-face-pagestub.js：rAF 包装对**调用点**做栈分类（器械心跳 vs 生产
 *     scheduleThemeColorRefresh vs 其它），并把 theme-sync 分支改为**带重入保护的同步 rAF**。
 *   · 指标口径（phaseMount / phaseClick / rafClick / overlay / longtasks / taskBusyPct / ws）与
 *     tools/firstopen-ab.mjs 逐行同构，便于与共享器械窗口交叉对照。
 *
 * 用法
 *   node sub/raf-face-runner.mjs --mode base|theme-sync|repro --label <label> \
 *        [--settle 6000] [--dwell 6000] [--gatemax 180000]
 *   node sub/raf-face-runner.mjs --campaign raf-face      # 内建序列（见 PLAN）
 * 输出 raw/firstopen-<label>.json；退出码 0=EXCLUSIVE，3=CONTENDED/INCONCLUSIVE，1=异常。
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const HERE = path.dirname(new URL(import.meta.url).pathname).replace(/\/sub$/, "");
const RAW = path.join(HERE, "raw");
const LOCK = "/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/.probe.lock";
const URL_SITE = "http://127.0.0.1:3080";
const LAUNCH = "/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs";
const PAGE_STUB = fs.readFileSync(path.join(HERE, "sub", "raf-face-pagestub.js"), "utf8");
const SHARED_STUB = fs.readFileSync(path.join(HERE, "tools", "stubs.js"), "utf8");

const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf("--" + n); return i >= 0 ? argv[i + 1] : d; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);
const log = (...a) => console.log(new Date().toISOString().replace("T", " ").slice(0, 19), ...a);

const PLAN = [
  { mode: "repro", label: "raf-repro-sharedstub-theme-sync", settle: 1500, dwell: 0, click: false },
  { mode: "base", label: "raf-base-r1", settle: 6000, dwell: 6000, click: true },
  { mode: "theme-sync", label: "raf-theme-sync-r1", settle: 6000, dwell: 6000, click: true },
  { mode: "theme-sync", label: "raf-theme-sync-r2", settle: 6000, dwell: 6000, click: true },
  { mode: "base", label: "raf-base-r2", settle: 6000, dwell: 6000, click: true },
  { mode: "base", label: "raf-base-r3", settle: 6000, dwell: 6000, click: true },
  { mode: "theme-sync", label: "raf-theme-sync-r3", settle: 6000, dwell: 6000, click: true },
];

const stat = (a) => {
  if (!a.length) return { n: 0 };
  const s = [...a].sort((x, y) => x - y);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: r3(s[0]), p50: r3(q(0.5)), p90: r3(q(0.9)), p99: r3(q(0.99)), max: r3(s[s.length - 1]),
    mean: r3(s.reduce((x, y) => x + y, 0) / s.length), over50: s.filter((x) => x > 50).length, over100: s.filter((x) => x > 100).length };
};

// ---- gate / lock（与 tools/firstopen-ab.mjs 同协议） -------------------------
function browserInstances() {
  const out = []; let lines = [];
  try { lines = execSync("ps -eo pid,ppid,etime,cmd --no-headers", { maxBuffer: 32 * 1024 * 1024 }).toString().split("\n"); } catch { return out; }
  for (const l of lines) {
    if (!/--remote-debugging-pipe|--remote-debugging-port/.test(l) || /--type=/.test(l)) continue;
    const m = l.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/); if (!m) continue;
    const pid = Number(m[1]); let ppid = Number(m[2]); const chain = [];
    for (let i = 0; i < 8 && ppid > 1; i++) { chain.push(ppid); try { const st = fs.readFileSync(`/proc/${ppid}/stat`, "utf8"); ppid = Number(st.slice(st.lastIndexOf(")") + 2).split(" ")[1]); } catch { break; } }
    out.push({ pid, ppid: Number(m[2]), etime: m[3], ancestors: chain });
  }
  return out;
}
function censusNow() {
  const instances = browserInstances();
  const mine = instances.filter((b) => b.ancestors.includes(process.pid) || b.pid === process.pid);
  const foreign = instances.filter((b) => !mine.includes(b));
  let lockOwner = null; try { lockOwner = fs.readFileSync(path.join(LOCK, "owner.txt"), "utf8").split("\n").slice(0, 3).join(" "); } catch { }
  return { at: new Date().toISOString(), instances: instances.length, mineCount: mine.length, foreignCount: foreign.length,
    foreign: foreign.map((b) => ({ pid: b.pid, etime: b.etime })), lockOwner, lockHeldByMyLine: !!(lockOwner && /incident2-regression/.test(lockOwner)) };
}
function acquireLock(label) {
  try { fs.mkdirSync(LOCK, { recursive: true });
    fs.writeFileSync(path.join(LOCK, "owner.txt"), ["agent: incident2-regression (raf-face theme-sync A/B)", `line: label=${label}`, `pid: ${process.pid}`,
      `started_at: ${new Date().toISOString()}`, "purpose: each window requires foreignCount==0 && this lock held by this line", ""].join("\n"));
    return true; } catch { return false; }
}
function releaseLock() { try { if (fs.existsSync(LOCK) && /incident2-regression/.test(fs.readFileSync(path.join(LOCK, "owner.txt"), "utf8"))) { fs.rmSync(path.join(LOCK, "owner.txt")); fs.rmdirSync(LOCK); return true; } } catch { } return false; }
async function waitExclusive(maxMs) {
  const t0 = Date.now(); const foreignSeen = [];
  while (Date.now() - t0 < maxMs) {
    const c = censusNow();
    if (c.foreignCount === 0 && c.lockHeldByMyLine) return { outcome: "EXCLUSIVE", waitedMs: Date.now() - t0, foreignSeen };
    foreignSeen.push(...c.foreign.map((f) => `${f.pid}@${f.etime}`));
    await sleep(1000);
  }
  return { outcome: "CONTENDED", waitedMs: Date.now() - t0, foreignSeen };
}
// ---- end gate ---------------------------------------------------------------

const INSTRUMENT = {
  name: "raf-face-runner",
  page_stub: "sub/raf-face-pagestub.js",
  why_not_shared_harness: "tools/stubs.js 的 theme-sync 无条件同步 rAF 与 firstopen-ab.mjs 自带 rAF 心跳互相递归 → RangeError，共享器械无法产出 theme-sync 窗口（见 repro 证据）",
  vs_shared: [
    "rAF 包装按调用点栈分类，把器械心跳与生产调度分开计数",
    "theme-sync 分支加重入保护（rAF 回调内排的 rAF 走真 rAF），避免无限递归",
    "指标口径（phaseMount/phaseClick/rafClick/overlay/longtasks/taskBusyPct）与 firstopen-ab.mjs 同构",
    "共享计数同名项保留：tcRafScheduled/tcSyncInvoked/tcMetaContentWrites(InClick)/tcComputedReads(InRaf/InClick)/tcRefreshRan/tpApplySeen(InClick)…",
  ],
};

function writeRec(label, rec) {
  fs.mkdirSync(RAW, { recursive: true });
  fs.writeFileSync(path.join(RAW, `firstopen-${label}.json`), JSON.stringify(rec, null, 2) + "\n");
}

async function reproCheck(browser) {
  // firstopen-ab.mjs 第 179–183 行的 arm 片段（原样复刻；只有 rAF 实现因页面不同而不同）
  const ARM_SRC = `(() => {
    const R = window.__REG__ || (window.__REG__ = {});
    const src = R.source;
    try {
      R.marks = { clickAt: performance.now() };
      R.raf = []; R.lt = [];
      let last = performance.now();
      const tick = (ts) => { R.raf.push(ts - last); last = ts; R.rafId = requestAnimationFrame(tick); };
      R.rafId = requestAnimationFrame(tick);
      return { ok: true, source: src, rafSamples: R.raf.length, rafId: R.rafId, typeofRaf: typeof requestAnimationFrame };
    } catch (e) {
      return { ok: false, source: src, err: e && e.name, msg: String(e && e.message).slice(0, 200), recursionDepth: (R.raf || []).length };
    }
  })()`;

  // ① 对照页：不注入任何 stub ⇒ 真 rAF，arm 片段应当成功
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await pageA.addInitScript({ content: `window.__REG__ = { source: "real-rAF (no stub)" };\n` });
  await pageA.goto(URL_SITE + "/", { waitUntil: "domcontentloaded", timeout: 90000 });
  await pageA.waitForSelector('button:has-text("设置")', { timeout: 45000 }).catch(() => { });
  await sleep(1200);
  const control = await pageA.evaluate(ARM_SRC);
  await ctxA.close();

  // ② 处理页：注入**未修改的** tools/stubs.js（cond=theme-sync）⇒ arm 片段应当崩
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  const pageErrors = [];
  pageB.on("pageerror", (e) => pageErrors.push(String((e && e.message) || e).slice(0, 200)));
  await pageB.addInitScript({ content: `window.__REG__ = { cond: "theme-sync", t0: Date.now(), source: "shared tools/stubs.js cond=theme-sync" };\nwindow.__REALRAF = window.requestAnimationFrame;\n` });
  await pageB.addInitScript({ content: SHARED_STUB });
  await pageB.goto(URL_SITE + "/", { waitUntil: "domcontentloaded", timeout: 90000 });
  await pageB.waitForSelector('button:has-text("设置")', { timeout: 45000 }).catch(() => { });
  await sleep(1200);
  const before = await pageB.evaluate(() => JSON.parse(JSON.stringify(window.__REG__.probe.snapshot().counters)));
  const stubbed = await pageB.evaluate(ARM_SRC);
  const after = await pageB.evaluate(() => JSON.parse(JSON.stringify(window.__REG__.probe.snapshot().counters)));
  const sharedMechanism = await pageB.evaluate(() => window.__REG__.probe.snapshot().mechanism);
  const sharedEffective = await pageB.evaluate(() => window.__REG__.probe.snapshot().effectiveStrict);
  const delta = {};
  for (const k of Object.keys(after)) if (typeof after[k] === "number" && typeof before[k] === "number" && after[k] !== before[k]) delta[k] = after[k] - before[k];
  await ctxB.close();

  const reproduced = (control.ok === true && stubbed.ok === false);
  return {
    armControl_真rAF: control, armStubbed_共享同步rAF: stubbed, counterDeltaFromArm: delta, pageErrorsB: pageErrors,
    sharedStubMechanism: sharedMechanism, sharedStubEffectiveStrict: sharedEffective,
    reproduced,
    interpretation: reproduced
      ? "同一 arm 片段：真 rAF 下成功、共享 stub(theme-sync) 下抛 " + stubbed.err + "（递归深度 " + stubbed.recursionDepth + "）⇒ 共享器械会在 arm 相位崩掉，窗口在写 JSON 之前终止（浏览器亦不会 close）"
      : "未复现，需人工复核",
  };
}

async function runRepro(spec, gate) {
  const { chromium } = await import(LAUNCH);
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const r = await reproCheck(browser);
  await browser.close();
  const rec = {
    cond: "repro-sharedstub-theme-sync", label: spec.label, ts: new Date().toISOString(),
    instrument: INSTRUMENT, purpose: "复现「共享器械 tools/firstopen-ab.mjs --cond theme-sync 无法写出窗口」这一器械缺陷",
    nav: { settleMs: spec.settle, clicked: false, closed: false, wallS: null },
    stub: {
      spec: "repro", mechanism: r.sharedStubMechanism, effective: r.sharedStubEffectiveStrict,
      pathReachableClick: null, pathReachableMount: null,
      note: "本窗口不做点击：同一 arm 片段在两张页上跑（A=无 stub/真 rAF，B=未修改的共享 stub theme-sync）",
    },
    repro: r,
    phaseMount: null, phaseClick: null, rafClick: null, overlay: null, taskBusyPct: null,
    longtasks: null, ws: null, pageErrors: [], consoleErrors: [],
    concurrency: { gateOutcome: gate.outcome, gateWaitedMs: gate.waitedMs, foreignSeenDuringGate: [...new Set(gate.foreignSeen)], censusStart: null, censusEnd: null, exclusiveThroughout: false },
    lock: { heldAtStart: true, released: true },
  };
  writeRec(spec.label, rec);
  log(`[repro] control=${JSON.stringify(r.armControl_真rAF)}`);
  log(`[repro] stubbed=${JSON.stringify(r.armStubbed_共享同步rAF)}`);
  log(`[repro] reproduced=${r.reproduced}`);
  log(`wrote raw/firstopen-${spec.label}.json`);
}

async function runWindow(spec, gate) {
  const { chromium } = await import(LAUNCH);
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors = []; const consoleErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String((e && e.message) || e).slice(0, 300)));
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300)); });
  const wsFrames = [];
  page.on("websocket", (ws) => ws.on("framereceived", (f) => { try { wsFrames.push([Date.now(), JSON.parse(f.payload).type]); } catch { } }));

  await page.addInitScript({ content: `window.__REG__={cond:${JSON.stringify(spec.mode)},t0:Date.now()};\nwindow.__REALRAF=window.requestAnimationFrame;\n` + PAGE_STUB });

  const nav = { at: Date.now() };
  let gotoError = null;
  try { await page.goto(URL_SITE + "/", { waitUntil: "domcontentloaded", timeout: 90000 }); }
  catch (e) { gotoError = String(e.message).slice(0, 200); }
  nav.domcontentloaded = Date.now();

  const cdp = await context.newCDPSession(page).catch(() => null);
  let readMetrics = async () => [];
  if (cdp) { await cdp.send("Performance.enable").catch(() => { }); readMetrics = async () => (await cdp.send("Performance.getMetrics")).metrics; }
  let cdpM = await readMetrics();
  const cdpMountBefore = Object.fromEntries(cdpM.map((m) => [m.name, m.value]));

  await page.waitForSelector('button:has-text("设置")', { timeout: 45000 }).catch(() => { });
  await sleep(spec.settle);
  const settleDone = Date.now();
  cdpM = await readMetrics();
  const cdpMountAfter = Object.fromEntries(cdpM.map((m) => [m.name, m.value]));
  const mountProof = await page.evaluate(() => (window.__REG__.probe ? window.__REG__.probe.snapshot() : { probe: "MISSING" }));

  await page.evaluate(() => {
    const R = window.__REG__; R.clickPhase = true;
    R.overlay = { observerInstalledAt: performance.now(), events: [], firstVisibleAt: null };
    const SEL = '[role="dialog"],[class*=drawer],[class*=overlay],[class*=settings]';
    const snapshot = () => {
      const els = document.querySelectorAll(SEL);
      let best = null;
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (r.width > 320 && r.height > 240 && el.textContent && el.textContent.trim().length > 40) {
          const t = performance.now();
          if (best === null || r.width * r.height > best.area) best = { area: r.width * r.height, w: Math.round(r.width), h: Math.round(r.height), t };
        }
      }
      return best;
    };
    R.overlayProbe = () => {
      const b = snapshot();
      if (b && R.overlay.firstVisibleAt === null) { R.overlay.firstVisibleAt = b.t; R.overlay.firstBox = b; }
      return b;
    };
    try { R.mo = new MutationObserver(() => { R.overlayProbe(); }); R.mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true }); } catch (e) { }
    R.overlayPoller = setInterval(() => R.overlayProbe(), 16);
    R.marks = { clickAt: performance.now() };
    R.raf = []; R.lt = [];
    let last = performance.now();
    const tick = (ts) => {
      R.raf.push(ts - last); last = ts;
      R.__hbScheduling = true;
      try { R.rafId = requestAnimationFrame(tick); } finally { R.__hbScheduling = false; }
    };
    R.__hbScheduling = true;
    try { R.rafId = requestAnimationFrame(tick); } finally { R.__hbScheduling = false; }
    R.ltObs = new PerformanceObserver((l) => { for (const e of l.getEntries()) R.lt.push({ start: e.startTime, d: e.duration }); });
    try { R.ltObs.observe({ entryTypes: ["longtask"] }); } catch { }
  });

  const clickAt = Date.now();
  let clicked = false; let clickBox = null; let clickError = null;
  try {
    const l = page.locator('button:has-text("设置")').first();
    if (await l.count()) {
      await l.scrollIntoViewIfNeeded().catch(() => { });
      const box = await l.boundingBox();
      if (box) {
        clickBox = { x: r3(box.x), y: r3(box.y), w: r3(box.width), h: r3(box.height) };
        await page.evaluate(() => { window.__REG__.clickDispatchAt = performance.now(); });
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        clicked = true;
      }
    }
  } catch (e) { clickError = String(e.message).slice(0, 200); pageErrors.push("click: " + clickError); }
  const clickDone = Date.now();
  await sleep(spec.dwell);
  const dwellDone = Date.now();

  const post = await page.evaluate(() => {
    const R = window.__REG__;
    R.clickPhase = false;
    if (R.rafId) cancelAnimationFrame(R.rafId);
    try { R.ltObs && R.ltObs.disconnect(); } catch { }
    try { R.mo && R.mo.disconnect(); } catch { }
    try { clearInterval(R.overlayPoller); } catch { }
    const ov = R.overlayProbe();
    return { raf: R.raf, lt: R.lt, overlay: R.overlay, overlayNow: ov, clickDispatchAt: R.clickDispatchAt, probe: R.probe ? R.probe.snapshot() : { probe: "MISSING" } };
  });
  cdpM = await readMetrics();
  const cdpClickAfter = Object.fromEntries(cdpM.map((m) => [m.name, m.value]));
  if (cdp) await cdp.detach().catch(() => { });

  let closed = false;
  try { const c = page.locator('button:has-text("关闭")').first(); if (await c.count()) { await c.click({ timeout: 3000 }); closed = true; } } catch { }
  // 可选：在被测窗口**测量完毕之后**，用同一浏览器再做一次 repro 检查（不污染已完成的测量）
  let reproRes = null;
  if (spec.withRepro) {
    try { reproRes = await reproCheck(browser); } catch (e) { reproRes = { error: String(e && e.message).slice(0, 300) }; }
  }
  await browser.close();
  const censusEnd = censusNow();

  const wallS = Math.max(0.001, (dwellDone - settleDone) / 1000);
  const del = (after, before, k) => r3((after[k] || 0) - (before[k] || 0));
  const C = post.probe.counters || {};
  const CM = (mountProof && mountProof.counters) || {};
  const dc = (k) => (C[k] || 0) - (CM[k] || 0);
  const rec = {
    cond: spec.mode, label: spec.label, ts: new Date().toISOString(),
    instrument: INSTRUMENT,
    reproSameBrowser: reproRes ? "after-measurement" : null,
    repro: reproRes,
    nav: { domcontentloadedMs: nav.domcontentloaded - nav.at, settleMs: spec.settle, clicked, closed, clickError, gotoError, clickWallMs: clickDone - clickAt, dwellMs: spec.dwell, wallS: r3(wallS) },
    stub: {
      spec: spec.mode, mechanism: post.probe.mechanism, effective: post.probe.effectiveStrict, mountEffective: mountProof.effectiveStrict,
      pathReachableClick: post.probe.pathReachable, pathReachableMount: mountProof.pathReachable,
      mountProof, clickProof: post.probe, routeHits: null,
      // —— 面4 决定性口径：调用点分类（区分器械心跳 vs 生产调用）——
      rafClassification: {
        callsTotal: C.rafCallsTotal, callsInClick: C.rafCallsInClick,
        byHeartbeat: C.rafByHeartbeat, byHeartbeatInClick: C.rafByHeartbeatInClick,
        byProdThemeDefer: C.rafByProdThemeDefer, byProdThemeDeferInClick: C.rafByProdThemeDeferInClick,
        byOther: C.rafByOther, byOtherInClick: C.rafByOtherInClick,
        mountPhase: { byHeartbeat: CM.rafByHeartbeat, byProdThemeDefer: CM.rafByProdThemeDefer, byOther: CM.rafByOther, callsTotal: CM.rafCallsTotal },
        clickPhaseDelta: { byHeartbeat: dc("rafByHeartbeat"), byProdThemeDefer: dc("rafByProdThemeDefer"), byOther: dc("rafByOther"), callsTotal: dc("rafCallsTotal") },
        prodStackSamples: C.rafProdStackSamples || [],
        otherSamplesTop: Object.fromEntries(Object.entries(C.rafOtherSamples || {}).sort((a, b) => b[1] - a[1]).slice(0, 5)),
        stackSamplesTaken: C.rafStackSamplesTaken,
      },
      syncEvidence: {
        mode: spec.mode, syncExecuted: C.rafSyncExecuted, syncExecutedProd: C.rafSyncExecutedProd,
        syncExecutedProdInClick: C.rafSyncExecutedProdInClick, syncFallback: C.rafSyncFallback,
        syncFallbackInsideCallback: C.rafSyncFallbackInsideCallback, syncFallbackFromProd: C.rafSyncFallbackFromProd,
        metaWritesInSyncRafCallback: C.tcMetaWritesInSyncRafCallback, computedReadsInSyncRafCallback: C.tcComputedReadsInSyncRafCallback,
        metaWritesInRaf: C.tcMetaWritesInRaf, computedReadsInRaf: C.tcComputedReadsInRaf,
      },
    },
    phaseMount: { ScriptDuration: del(cdpMountAfter, cdpMountBefore, "ScriptDuration"), RecalcStyleDuration: del(cdpMountAfter, cdpMountBefore, "RecalcStyleDuration"),
      TaskDuration: del(cdpMountAfter, cdpMountBefore, "TaskDuration"), RecalcStyleCount: del(cdpMountAfter, cdpMountBefore, "RecalcStyleCount") },
    phaseClick: { ScriptDuration: del(cdpClickAfter, cdpMountAfter, "ScriptDuration"), RecalcStyleDuration: del(cdpClickAfter, cdpMountAfter, "RecalcStyleDuration"),
      LayoutDuration: del(cdpClickAfter, cdpMountAfter, "LayoutDuration"), TaskDuration: del(cdpClickAfter, cdpMountAfter, "TaskDuration"),
      RecalcStyleCount: del(cdpClickAfter, cdpMountAfter, "RecalcStyleCount"),
      ScriptMsPerS: r3(del(cdpClickAfter, cdpMountAfter, "ScriptDuration") / wallS), RecalcMsPerS: r3(del(cdpClickAfter, cdpMountAfter, "RecalcStyleDuration") / wallS),
      TaskMsPerS: r3(del(cdpClickAfter, cdpMountAfter, "TaskDuration") / wallS) },
    rafClick: stat((post.raf || []).filter((x) => x > 0)),
    overlay: { firstVisibleAt: post.overlay ? r3(post.overlay.firstVisibleAt) : null,
      clickDispatchAt: r3(post.clickDispatchAt),
      msToVisible: post.overlay && post.overlay.firstVisibleAt != null && post.clickDispatchAt != null ? r3(post.overlay.firstVisibleAt - post.clickDispatchAt) : null,
      firstBox: post.overlay ? post.overlay.firstBox : null, nowBox: post.overlayNow, clickBox },
    taskBusyPct: r3(100 * del(cdpClickAfter, cdpMountAfter, "TaskDuration") / wallS),
    longtasks: { n: (post.lt || []).length, totalMs: r3((post.lt || []).reduce((a, x) => a + x.d, 0)), maxMs: (post.lt || []).length ? r3(Math.max(...post.lt.map((x) => x.d))) : null },
    ws: { total: wsFrames.length, byType: wsFrames.reduce((a, [, ty]) => { a[ty] = (a[ty] || 0) + 1; return a; }, {}) },
    pageErrors: [...new Set(pageErrors)].slice(0, 6), consoleErrors: [...new Set(consoleErrors)].slice(0, 6),
    concurrency: { gateOutcome: gate.outcome, gateWaitedMs: gate.waitedMs, foreignSeenDuringGate: [...new Set(gate.foreignSeen)], censusStart: gate.censusStart, censusEnd,
      exclusiveThroughout: gate.outcome === "EXCLUSIVE" && gate.censusStart.foreignCount === 0 && censusEnd.foreignCount === 0 },
    lock: { heldAtStart: gate.lockOk, released: false },
  };
  writeRec(spec.label, rec);
  const pc = rec.phaseClick;
  log(`[win ] ${spec.label.padEnd(24)} gate=${gate.outcome} clicked=${rec.nav.clicked} msToVisible=${rec.overlay.msToVisible} clickWall=${rec.nav.clickWallMs}ms busy%=${rec.taskBusyPct} raf/s=${r3(rec.rafClick.n / wallS)} rafP99=${rec.rafClick.p99} lt=${rec.longtasks.n} ltMax=${rec.longtasks.maxMs} scriptMs/s=${pc.ScriptMsPerS} recalcMs/s=${pc.RecalcMsPerS} taskMs/s=${pc.TaskMsPerS}`);
  const PR = post.probe.pathReachable || {};
  const RC = rec.stub.rafClassification;
  log(`       stubEff(click)=${rec.stub.effective} reach: applyInClick=${PR.themeApplyRanInClick} refreshRan=${PR.themeRefreshRan} metaWritesClick=${PR.metaContentWritesInClick} computedClick=${PR.computedReadsInClick}`);
  log(`       rAF: total=${RC.callsTotal}(clickDelta=${RC.clickPhaseDelta.callsTotal}) heartbeat=${RC.byHeartbeat} PROD-defer=${RC.byProdThemeDefer}(click=${RC.byProdThemeDeferInClick}) other=${RC.byOther} | sync: execProd=${rec.stub.syncEvidence.syncExecutedProd} fb=${rec.stub.syncEvidence.syncFallbackInsideCallback}`);
  if (rec.pageErrors.length) log(`       pageErrors: ${JSON.stringify(rec.pageErrors)}`);
  log(`wrote raw/firstopen-${spec.label}.json`);
  return rec;
}

async function one(spec, gateMax) {
  const lockOk = acquireLock(spec.label);
  const gate = await waitExclusive(gateMax);
  gate.lockOk = lockOk;
  gate.censusStart = censusNow();
  log(`[gate] ${gate.outcome} waited=${gate.waitedMs}ms lock=${lockOk} foreign=${gate.censusStart.foreignCount} mode=${spec.mode} label=${spec.label}`);
  let rec = null;
  if (gate.outcome !== "EXCLUSIVE") {
    // 纪律：CONTENDED 时**不再启动浏览器**（不给同机其它线再加一个浏览器），仍写出 JSON 并标 INCONCLUSIVE。
    rec = { cond: spec.mode, label: spec.label, ts: new Date().toISOString(), instrument: INSTRUMENT,
      verdictHint: "INCONCLUSIVE(contended)", reason: "gate 未取得独占：foreignCount>0 或锁未由本线持有；本窗口未启动浏览器",
      nav: { clicked: false, closed: false, settleMs: spec.settle, dwellMs: spec.dwell, wallS: null },
      stub: null, phaseMount: null, phaseClick: null, rafClick: null, overlay: null, taskBusyPct: null, longtasks: null, ws: null,
      pageErrors: [], consoleErrors: [],
      concurrency: { gateOutcome: gate.outcome, gateWaitedMs: gate.waitedMs, foreignSeenDuringGate: [...new Set(gate.foreignSeen)], censusStart: gate.censusStart, censusEnd: null, exclusiveThroughout: false },
      lock: { heldAtStart: lockOk, released: false } };
    writeRec(spec.label, rec);
    releaseLock();
    log(`wrote raw/firstopen-${spec.label}.json (CONTENDED → INCONCLUSIVE)`);
    return { rec, exit: 3 };
  }
  try {
    if (spec.mode === "repro") await runRepro(spec, gate);
    else rec = await runWindow(spec, gate);
  } catch (e) {
    log(`[err ] ${spec.label}: ${String(e && e.message).slice(0, 400)}`);
    rec = { cond: spec.mode, label: spec.label, ts: new Date().toISOString(), instrument: INSTRUMENT,
      verdictHint: "INCONCLUSIVE(harness-error)", error: String(e && e.stack || e).slice(0, 800),
      nav: { clicked: false, closed: false }, stub: null, phaseMount: null, phaseClick: null, rafClick: null, overlay: null,
      taskBusyPct: null, longtasks: null, ws: null, pageErrors: [], consoleErrors: [],
      concurrency: { gateOutcome: gate.outcome, gateWaitedMs: gate.waitedMs, censusStart: gate.censusStart, censusEnd: null, exclusiveThroughout: false },
      lock: { heldAtStart: lockOk, released: false } };
    writeRec(spec.label, rec);
  }
  const released = releaseLock();
  if (rec && rec.lock) rec.lock.released = released;
  if (rec && fs.existsSync(path.join(RAW, `firstopen-${spec.label}.json`)) && rec.lock) writeRec(spec.label, rec);
  return { rec, exit: 0 };
}

// ---- main -------------------------------------------------------------------
const mode = argOf("mode", null);
const campaign = argOf("campaign", null);
const gateMax = Number(argOf("gatemax", 180000));

if (campaign) {
  log(`campaign=${campaign} plan=${PLAN.length} windows gatemax=${gateMax}`);
  const results = [];
  for (const spec of PLAN) {
    const r = await one(spec, gateMax);
    results.push({ label: spec.label, mode: spec.mode, exit: r.exit, verdictHint: r.rec && r.rec.verdictHint,
      msToVisible: r.rec && r.rec.overlay ? r.rec.overlay.msToVisible : null });
    await sleep(1500);
  }
  log("campaign done: " + JSON.stringify(results));
  fs.writeFileSync(path.join(HERE, "logs", "raf-face-plan-result.json"), JSON.stringify(results, null, 2) + "\n");
  process.exit(0);
}

const spec = { mode: mode || "base", label: argOf("label", "raf-" + (mode || "base")), settle: Number(argOf("settle", 6000)), dwell: Number(argOf("dwell", 6000)), withRepro: argv.includes("--with-repro") };
const r = await one(spec, gateMax);
process.exit(r.exit);
