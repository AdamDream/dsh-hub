#!/usr/bin/env node
/**
 * incident2/regression — 「全新页面 → 点设置」首开路径 A/B（页内只读 stub）
 *
 * 纪律
 *   · 单浏览器、单 context、单 page（全新 context ⇒ 全新页面，无 storage 继承）
 *   · 只点「设置」（收尾点「关闭」）；不点保存/应用/删除；不刷新、不改产品文件
 *   · 每个窗口要求 foreignCount==0 && 本线持有 research-v2/.probe.lock
 *
 * 条件（--cond）
 *   base           对照：无 stub（只读计数）
 *   tp-off         面1：关掉主题内容签名跳过 ⇒ 强制每次重放
 *   p2ac-old       面2：恢复旧的无差别回拷（route 在传输中改写 client.js，磁盘零改动）
 *   usage-nofetch  面3：usage 卡片首挂载 9 路请求全部不发出
 *   theme-sync     面4：theme-color meta 写回改回同步
 *
 * 三段口径（与 stub 自证绑定）
 *   phaseMount = 导航 → settle（首挂载期；计数给出「本应发生次数」基线）
 *   phaseClick = 点设置 → dwell 结束（被测路径；rAF/长任务/样式重算都在这里）
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const HERE = path.dirname(new URL(import.meta.url).pathname).replace(/\/tools$/, "");
const RAW = path.join(HERE, "raw");
const LOCK = "/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/.probe.lock";
const URL_SITE = "http://127.0.0.1:3080";
const LAUNCH = "/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs";

const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf("--" + n); return i >= 0 ? argv[i + 1] : d; };
const has = (n) => argv.includes("--" + n);
const COND = argOf("cond", "base");
const LABEL = argOf("label", COND);
const SETTLE_MS = Number(argOf("settle", 6000));
const DWELL_MS = Number(argOf("dwell", 6000));
const GATE_MAX_MS = Number(argOf("gatemax", 180000));
const HEADFUL = has("headful");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);
const stat = (a) => {
  if (!a.length) return { n: 0 };
  const s = [...a].sort((x, y) => x - y);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: r3(s[0]), p50: r3(q(0.5)), p90: r3(q(0.9)), p99: r3(q(0.99)), max: r3(s[s.length - 1]),
    mean: r3(s.reduce((x, y) => x + y, 0) / s.length), over50: s.filter((x) => x > 50).length, over100: s.filter((x) => x > 100).length };
};

// ---- gate / lock -----------------------------------------------------------
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
function acquireLock() {
  try { fs.mkdirSync(LOCK, { recursive: true });
    fs.writeFileSync(path.join(LOCK, "owner.txt"), ["agent: incident2-regression (first-open A/B)", `line: cond=${COND}`, `pid: ${process.pid}`,
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
// ---- end gate --------------------------------------------------------------

const STUB_SRC = fs.readFileSync(path.join(HERE, "tools", "stubs.js"), "utf8");

// 面2：route 在传输中改写 client.js（磁盘零改动）
const P2AC_RT = "/plugins/@deepseek-ai/dsh-client-runtime/client.js";
const ANCHORS = [
  { id: "carry", from: "for (const id of Object.keys(previousProjection.byId)) if (byId[id] === void 0 && chainRowIds.has(id)) byId[id] = previousProjection.byId[id];",
    to: "for (const id of Object.keys(previousProjection.byId)) if (byId[id] === void 0) byId[id] = previousProjection.byId[id];" },
  { id: "keygate", from: "reusableByIdKeys.length === liveKeys.length && reusableByIdKeys.every((id) => Object.prototype.hasOwnProperty.call(byId, id))",
    to: "reusableByIdKeys.every((id) => Object.prototype.hasOwnProperty.call(byId, id))" },
];
const routeHits = { carry: 0, keygate: 0, bytes: 0, bad: [] };

const { chromium } = await import(LAUNCH);
const lockOk = acquireLock();
const gate = await waitExclusive(GATE_MAX_MS);
const censusStart = censusNow();
console.log(`[gate] ${gate.outcome} waited=${gate.waitedMs}ms lock=${lockOk} foreign=${censusStart.foreignCount} cond=${COND}`);

const browser = await chromium.launch({ headless: !HEADFUL, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const context = await browser.newContext();
const page = await context.newPage();
const pageErrors = []; const consoleErrors = [];
page.on("pageerror", (e) => pageErrors.push(String((e && e.message) || e).slice(0, 300)));
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300)); });
const wsFrames = [];
page.on("websocket", (ws) => ws.on("framereceived", (f) => { try { wsFrames.push([Date.now(), JSON.parse(f.payload).type]); } catch { } }));

if (COND === "p2ac-old") {
  await page.route("**" + P2AC_RT + "*", async (route) => {
    const resp = await route.fetch();
    let body = await resp.text();
    routeHits.bytes = body.length;
    for (const a of ANCHORS) {
      const n = body.split(a.from).length - 1;
      if (n === 1) { body = body.replace(a.from, a.to); routeHits[a.id] += 1; }
      else routeHits.bad.push(`${a.id}:hits=${n}`);
    }
    await route.fulfill({ response: resp, body, headers: { ...resp.headers(), "content-type": "text/javascript; charset=utf-8" } });
  });
}

await page.addInitScript({ content: `window.__REG__={cond:${JSON.stringify(COND)},t0:Date.now()};\n` + STUB_SRC });

const nav = { at: Date.now() };
await page.goto(URL_SITE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
nav.domcontentloaded = Date.now();

const cdp = await context.newCDPSession(page);
await cdp.send("Performance.enable");
const readMetrics = async () => (await cdp.send("Performance.getMetrics")).metrics;
let cdpM = await readMetrics();
const cdpMountBefore = Object.fromEntries(cdpM.map((m) => [m.name, m.value]));

await page.waitForSelector('button:has-text("设置")', { timeout: 45000 }).catch(() => { });
await sleep(SETTLE_MS);
const settleDone = Date.now();
cdpM = await readMetrics();
const cdpMountAfter = Object.fromEntries(cdpM.map((m) => [m.name, m.value]));
const mountProof = await page.evaluate(() => (window.__REG__.probe ? window.__REG__.probe.snapshot() : { probe: "MISSING" }));

// 进入被测相位：arm 面1 强制重放 + 开始 rAF/长任务采样
await page.evaluate(() => {
  const R = window.__REG__; R.clickPhase = true;
  if (R.cond !== "tpoff-armed") R.armTpReadback = true;
  // 决定性口径⑤：用户可感的成本 = 点设置 → 设置面板可见/可交互 的墙钟延迟。
  // 只读观察（MutationObserver + rAF 轮询），不为任何分支改变行为。
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
  try {
    R.mo = new MutationObserver(() => { R.overlayProbe(); });
    R.mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
  } catch (e) { }
  R.overlayPoller = setInterval(() => R.overlayProbe(), 16);
  R.marks = { clickAt: performance.now() };
  R.raf = []; R.lt = [];
  let last = performance.now();
  const tick = (ts) => { R.raf.push(ts - last); last = ts; R.rafId = requestAnimationFrame(tick); };
  R.rafId = requestAnimationFrame(tick);
  R.ltObs = new PerformanceObserver((l) => { for (const e of l.getEntries()) R.lt.push({ start: e.startTime, d: e.duration }); });
  try { R.ltObs.observe({ entryTypes: ["longtask"] }); } catch { }
});

const clickAt = Date.now();
let clicked = false; let clickBox = null;
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
} catch (e) { pageErrors.push("click: " + String(e.message).slice(0, 200)); }
const clickDone = Date.now();
await sleep(DWELL_MS);
const dwellDone = Date.now();

const post = await page.evaluate(() => {
  const R = window.__REG__;
  R.clickPhase = false;
  if (R.rafId) cancelAnimationFrame(R.rafId);
  try { R.ltObs && R.ltObs.disconnect(); } catch { }
  try { R.mo && R.mo.disconnect(); } catch { }
  try { clearInterval(R.overlayPoller); } catch { }
  const ov = R.overlayProbe();
  return { raf: R.raf, lt: R.lt, overlay: R.overlay, overlayNow: ov, clickDispatchAt: R.clickDispatchAt,
    probe: R.probe ? R.probe.snapshot() : { probe: "MISSING" } };
});
cdpM = await readMetrics();
const cdpClickAfter = Object.fromEntries(cdpM.map((m) => [m.name, m.value]));
await cdp.detach();

// 纪律收尾：只点「关闭」
let closed = false;
try { const c = page.locator('button:has-text("关闭")').first(); if (await c.count()) { await c.click({ timeout: 3000 }); closed = true; } } catch { }
await browser.close();
const released = releaseLock();
const censusEnd = censusNow();

const wallS = Math.max(0.001, (dwellDone - settleDone) / 1000);
const del = (after, before, k) => r3((after[k] || 0) - (before[k] || 0));
const rec = {
  cond: COND, label: LABEL, ts: new Date().toISOString(),
  nav: { domcontentloadedMs: nav.domcontentloaded - nav.at, settleMs: SETTLE_MS, clicked, closed, clickWallMs: clickDone - clickAt, dwellMs: DWELL_MS, wallS: r3(wallS) },
  stub: { spec: COND, mechanism: post.probe.mechanism, effective: post.probe.effectiveStrict, mountEffective: mountProof.effectiveStrict,
    pathReachableClick: post.probe.pathReachable, pathReachableMount: mountProof.pathReachable,
    mountProof, clickProof: post.probe, routeHits: COND === "p2ac-old" ? routeHits : null },
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
  http: post.probe.http || null,
  httpInClick: post.probe.httpInClick || null,
  longtasks: { n: (post.lt || []).length, totalMs: r3((post.lt || []).reduce((a, x) => a + x.d, 0)), maxMs: (post.lt || []).length ? r3(Math.max(...post.lt.map((x) => x.d))) : null },
  ws: { total: wsFrames.length, byType: wsFrames.reduce((a, [, ty]) => { a[ty] = (a[ty] || 0) + 1; return a; }, {}) },
  pageErrors: [...new Set(pageErrors)].slice(0, 6), consoleErrors: [...new Set(consoleErrors)].slice(0, 6),
  concurrency: { gateOutcome: gate.outcome, gateWaitedMs: gate.waitedMs, foreignSeenDuringGate: [...new Set(gate.foreignSeen)], censusStart, censusEnd,
    exclusiveThroughout: gate.outcome === "EXCLUSIVE" && censusStart.foreignCount === 0 && censusEnd.foreignCount === 0 },
  lock: { heldAtStart: lockOk, released },
};
fs.mkdirSync(RAW, { recursive: true });
fs.writeFileSync(path.join(RAW, `firstopen-${LABEL}.json`), JSON.stringify(rec, null, 2) + "\n");
const pc = rec.phaseClick;
const C = post.probe.counters || {};
console.log(`[win ] ${LABEL.padEnd(18)} gate=${gate.outcome} clicked=${rec.nav.clicked} msToVisible=${rec.overlay.msToVisible} clickWall=${rec.nav.clickWallMs}ms busy%=${rec.taskBusyPct} raf/s=${r3(rec.rafClick.n / wallS)} rafP99=${rec.rafClick.p99} lt=${rec.longtasks.n} ltMax=${rec.longtasks.maxMs} scriptMs/s=${pc.ScriptMsPerS} recalcMs/s=${pc.RecalcMsPerS} taskMs/s=${pc.TaskMsPerS}`);
const PR = post.probe.pathReachable || {};
console.log(`       stubEff(click)=${rec.stub.effective} stubEff(mount)=${rec.stub.mountEffective} reach: applyInClick=${PR.themeApplyRanInClick} refreshRan=${PR.themeRefreshRan} metaWritesClick=${PR.metaContentWritesInClick} computedClick=${PR.computedReadsInClick} usageClick=${PR.usageSeenInClick}`);
const HC = post.probe.httpInClick || {};
const slow = Object.entries(HC).sort((a, b) => (b[1].p99 || 0) - (a[1].p99 || 0)).slice(0, 4);
if (slow.length) console.log(`       httpInClick slowest: ` + slow.map(([k, v]) => `${k} n=${v.n} p50=${v.p50} p99=${v.p99} max=${v.max}`).join(" | "));
console.log(`       counters: mountWrites=${C.tpBodyWrites} clickReadbacks=${C.tpTokenReadbacks} forcedReplay=${C.tpForcedReplay} usageSeen=${C.usageRequestsSeen} usageBlocked=${C.usageRequestsBlocked} rafSched=${C.tcRafScheduled} rafSync=${C.tcSyncInvoked} computedReads=${C.tcComputedReads} routeHits=${JSON.stringify(routeHits)}`);
if (rec.pageErrors.length) console.log(`       pageErrors: ${JSON.stringify(rec.pageErrors)}`);
console.log(`wrote raw/firstopen-${LABEL}.json`);
process.exit(gate.outcome === "EXCLUSIVE" ? 0 : 3);
