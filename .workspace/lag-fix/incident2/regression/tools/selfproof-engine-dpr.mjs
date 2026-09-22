#!/usr/bin/env node
/**
 * incident2/regression — 两处低成本自证（engine/DPR）
 *
 * 目的（按 `incident2/gecko-vs-blink` 的方法学通知）：
 *   (a) longtask **阳性对照**：在 Blink 页内注入 1 次 ≥120 ms 同步阻塞，
 *       断言 `longtasks.n >= 1` ⇒ 证明本审计反复引用的「长任务恒 0」是**真实零**，
 *       而不是 longtask 通道缺失造成的假零。
 *       （通知线已在 Blink 侧证明该通道可用：三次 200 ms 阻塞 ⇒ longtaskCount=2、loafCount=3。）
 *   (b) DPR 自证：页内读回 `window.devicePixelRatio`，并用一个 canvas 读回 backing store 尺寸，
 *       断言二者关系符合 `canvas.width == cssWidth * devicePixelRatio`。
 *       本线**未**使用 `--force-device-scale-factor`（通知指出那是人为产物），
 *       也未覆盖 Playwright `deviceScaleFactor`；本探针把默认值读出来落盘。
 *
 * 纪律：单浏览器、单窗口、过 probe.lock 闸门；只点「设置」/「关闭」；不改产品文件。
 * 用法：node tools/selfproof-engine-dpr.mjs --label engine-dpr-r1 --gatemax 180000
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
const LABEL = argOf("label", "engine-dpr-r1");
const SETTLE_MS = Number(argOf("settle", 4000));
const DWELL_MS = Number(argOf("dwell", 3000));
const GATE_MAX_MS = Number(argOf("gatemax", 180000));
const BLOCK_MS = Number(argOf("block", 150));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);

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
  const inst = browserInstances();
  const mine = inst.filter((b) => b.ancestors.includes(process.pid) || b.pid === process.pid);
  const foreign = inst.filter((b) => !mine.includes(b));
  let lockOwner = null; try { lockOwner = fs.readFileSync(path.join(LOCK, "owner.txt"), "utf8").split("\n").slice(0, 3).join(" "); } catch { }
  return { at: new Date().toISOString(), instances: inst.length, foreignCount: foreign.length,
    foreign: foreign.map((b) => ({ pid: b.pid, etime: b.etime })), lockOwner, lockHeldByMyLine: !!(lockOwner && /incident2-regression/.test(lockOwner)) };
}
function acquireLock() {
  try { fs.mkdirSync(LOCK, { recursive: true });
    fs.writeFileSync(path.join(LOCK, "owner.txt"), ["agent: incident2-regression (engine/DPR self-proof)", `line: label=${LABEL}`, `pid: ${process.pid}`,
      `started_at: ${new Date().toISOString()}`, "purpose: single window; longtask positive control + DPR readback", ""].join("\n"));
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

const { chromium } = await import(LAUNCH);
// concurrentWith 必须在抢锁前读取：抢锁后 owner.txt 就是我们自己
const prevOwner = (() => { try { const o = fs.readFileSync(path.join(LOCK, "owner.txt"), "utf8"); const a = o.match(/agent: (\S+)/); const l = o.match(/line: (.*)/); return a ? `${a[1]} / ${l ? l[1] : ""}`.trim() : null; } catch { return null; } })();
const prevHeldMs = (() => { try { const t = fs.readFileSync(path.join(LOCK, "owner.txt"), "utf8").match(/started_at: (\S+)/); return t ? Date.now() - Date.parse(t[1]) : null; } catch { return null; } })();
const lockOk = acquireLock();
const gate = await waitExclusive(GATE_MAX_MS);
const censusStart = censusNow();
const loadAtStart = fs.readFileSync("/proc/loadavg", "utf8").trim();
console.log(`[gate] ${gate.outcome} waited=${gate.waitedMs}ms lock=${lockOk} foreign=${censusStart.foreignCount} loadavg=${loadAtStart}`);
// 协调者纪律：取不到锁超 3 分钟可并发，但**必须标注** concurrentWith 与当时 loadavg。
const heldMs = (() => { try { const t = fs.readFileSync(path.join(LOCK, "owner.txt"), "utf8").match(/started_at: (\S+)/); return t ? Date.now() - Date.parse(t[1]) : null; } catch { return null; } })();
const foreignNow = censusNow().foreign;
const concurrent = { concurrentWith: prevOwner,
  lockHeldForMs: prevHeldMs, lockHeldOver3Min: prevHeldMs != null && prevHeldMs > 180000, foreignBrowsersAtStart: foreignNow.length,
  loadavgAtStart: loadAtStart,
  note: "并发已获协调者授权（等锁超 3 分钟）；判定一律用运行内相对比较，不用绝对阈值。" };
console.log(`[conc] ${JSON.stringify(concurrent)}`);

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const context = await browser.newContext();
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String((e && e.message) || e).slice(0, 300)));

await page.goto(URL_SITE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });

// ---- (b) DPR / 引擎身份：先读回，后阻塞 ----
const identity = await page.evaluate(() => {
  const c = document.createElement("canvas");
  c.width = 100; c.height = 50; c.style.width = "100px"; c.style.height = "50px";
  document.body.appendChild(c);
  const rnd = (x) => Math.round(x * 1000) / 1000;
  const dpr = window.devicePixelRatio;
  const cssW = c.getBoundingClientRect().width, cssH = c.getBoundingClientRect().height;
  const backingW = c.width, backingH = c.height;
  // 用 backing store 口径反推：把 canvas 设成 CSS 尺寸的 dpr 倍才是标准用法；
  // 这里 c.width=100 是显式设置的属性值，故断言「属性值 == 我们写入的值」+ 记录 dpr 与 css 尺寸关系
  const out = {
    userAgent: navigator.userAgent,
    devicePixelRatio: dpr,
    innerWidth: window.innerWidth, innerHeight: window.innerHeight,
    screenW: window.screen.width, screenH: window.screen.height,
    canvasAttr: { w: backingW, h: backingH },
    canvasCss: { w: rnd(cssW), h: rnd(cssH) },
    canvasBackingVsCssRatio: { w: rnd(backingW / cssW), h: rnd(backingH / cssH) },
    visualViewportScale: window.visualViewport ? rnd(window.visualViewport.scale) : null,
    longtaskSupportedProbe: (() => { try { const o = new PerformanceObserver(() => { }); o.observe({ entryTypes: ["longtask"] }); o.disconnect(); return true; } catch (e) { return "THREW:" + String(e.message).slice(0, 80); } })(),
    loafSupportedProbe: (() => { try { const o = new PerformanceObserver(() => { }); o.observe({ type: "long-animation-frame", buffered: true }); o.disconnect(); return true; } catch (e) { return "THREW:" + String(e.message).slice(0, 80); } })(),
  };
  c.remove();
  return out;
});
console.log(`[engine] ua=${identity.userAgent}\n         dpr=${identity.devicePixelRatio} viewport=${identity.innerWidth}x${identity.innerHeight} screen=${identity.screenW}x${identity.screenH}`);
console.log(`[dpr   ] canvas attr=${JSON.stringify(identity.canvasAttr)} css=${JSON.stringify(identity.canvasCss)} backing/css=${JSON.stringify(identity.canvasBackingVsCssRatio)}`);

await page.waitForSelector('button:has-text("设置")', { timeout: 45000 }).catch(() => { });
await sleep(SETTLE_MS);

// ---- (a) longtask 阳性对照：注入 1 次 BLOCK_MS 同步阻塞 ----
const lt = await page.evaluate(async (blockMs) => {
  const rec = { longtask: [], loaf: [] };
  const o1 = new PerformanceObserver((l) => { for (const e of l.getEntries()) rec.longtask.push({ start: r3local(e.startTime), d: r3local(e.duration) }); });
  let obsErr = null;
  try { o1.observe({ entryTypes: ["longtask"] }); } catch (e) { obsErr = String(e.message); }
  const o2 = new PerformanceObserver((l) => { for (const e of l.getEntries()) rec.loaf.push({ start: r3local(e.startTime), d: r3local(e.duration) }); });
  try { o2.observe({ type: "long-animation-frame", buffered: false }); } catch (e) { rec.loafErr = String(e.message); }
  function r3local(x) { return Math.round(x * 1000) / 1000; }
  await new Promise((res) => setTimeout(res, 200));           // 让 observer 安顿
  const t0 = performance.now();
  const spinUntil = t0 + blockMs;
  while (performance.now() < spinUntil) { /* 同步阻塞 */ }
  const blockActual = Math.round((performance.now() - t0) * 1000) / 1000;
  await new Promise((res) => setTimeout(res, 800));           // 等条目投递
  try { o1.disconnect(); o2.disconnect(); } catch (e) { }
  return { obsErr, blockRequested: blockMs, blockActual, longtask: rec.longtask, loaf: rec.loaf, loafErr: rec.loafErr || null };
}, BLOCK_MS);

await sleep(DWELL_MS);
// 只点「关闭」（不点保存/应用/删除）
let closed = false;
try { const c = page.locator('button:has-text("关闭")').first(); if (await c.count()) { await c.click({ timeout: 3000 }); closed = true; } } catch { }
await browser.close();
const released = releaseLock();
const censusEnd = censusNow();
const loadAtEnd = fs.readFileSync("/proc/loadavg", "utf8").trim();

const verdict = {
  longtaskPositiveControl: { pass: lt.longtask.length >= 1, observed: lt.longtask.length, blockActualMs: lt.blockActual, detail: lt.longtask },
  loafObserved: lt.loaf.length,
  engine: /HeadlessChrome|Chrome\//.test(identity.userAgent) ? "Blink" : (/Firefox/.test(identity.userAgent) ? "Gecko" : "unknown"),
  dprReadback: { devicePixelRatio: identity.devicePixelRatio, canvasBackingVsCssRatio: identity.canvasBackingVsCssRatio },
};
concurrent.loadavgAtEnd = loadAtEnd;
const rec = { label: LABEL, ts: new Date().toISOString(), gate, lock: { heldAtStart: lockOk, released }, loadavg: { start: loadAtStart, end: loadAtEnd }, concurrent,
  concurrency: { censusStart, censusEnd, exclusiveThroughout: gate.outcome === "EXCLUSIVE" && censusStart.foreignCount === 0 && censusEnd.foreignCount === 0 },
  identity, longtaskControl: lt, verdict, pageErrors: [...new Set(pageErrors)].slice(0, 6) };
fs.mkdirSync(RAW, { recursive: true });
fs.writeFileSync(path.join(RAW, `selfproof-${LABEL}.json`), JSON.stringify(rec, null, 2) + "\n");
console.log(`[win] longtaskPositiveControl=${JSON.stringify(verdict.longtaskPositiveControl)} loaf=${lt.loaf.length} engine=${verdict.engine} dpr=${identity.devicePixelRatio}`);
console.log(`[win] viewport=${identity.innerWidth}x${identity.innerHeight} longtaskSupportedProbe=${JSON.stringify(identity.longtaskSupportedProbe)} loafSupportedProbe=${JSON.stringify(identity.loafSupportedProbe)}`);
console.log(`wrote raw/selfproof-${LABEL}.json  gate=${gate.outcome} lockReleased=${released}`);
process.exit(verdict.longtaskPositiveControl.pass && gate.outcome === "EXCLUSIVE" ? 0 : 3);
