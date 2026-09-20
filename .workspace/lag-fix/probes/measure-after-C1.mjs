/**
 * probes/measure-after-C1.mjs — 单元 C1 改后复测探针（只读；与 DIAGNOSIS.md §1.2 同方法）
 *
 * 采集项（与基线口径一致，便于直接对照）：
 *   - rAF 帧间隔：p50 / p99 / >50ms 帧数
 *   - CDP Performance.getMetrics：ScriptDuration / TaskDuration / RecalcStyleDuration
 *   - /api/session.list 返回条数与字节数（规模 N）
 *   - WebSocket 帧速率与帧类型分布（session/event / session/projection …）
 *   - 常驻 DOM 节点数、侧栏节点数（用于对照 audit-client.md 的 481 节点观察）
 *
 * 纪律：只读。只加载首页、可选点开设置面板、采集指标，不改任何数据/配置，
 *       不重启宿主，不写工作区外的文件。
 *
 * 用法：
 *   node measure-after-C1.mjs                     # 默认 3 个 20s 窗口：空闲 / 打开设置 / 停留
 *   node measure-after-C1.mjs --window 20 --out ../reports/measure-after.json
 *   node measure-after-C1.mjs --baseline ../reports/measure-before-C1.json   # 生成对照表
 *
 * 依赖：playwright（本目录 node_modules 符号链接指向 /home/CNS2026495165/playwright_scratch/node_modules）
 * 环境变量：DSH_URL（默认 http://127.0.0.1:3080）
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
};
const URL_ = process.env.DSH_URL || "http://127.0.0.1:3080";
const WINDOW_SEC = Number(argOf("--window", "20"));
const OUT = argOf("--out", "");
const BEFORE = argOf("--baseline", "");

/** 在页面里安装采集器（rAF 帧间隔 + WS 帧计数 + MutationObserver）。 */
const INSTALL = () => {
  window.__c1 = { frames: [], ws: {}, wsTotal: 0, panelMutations: 0, started: performance.now(), windowStart: performance.now() };
  let last = performance.now();
  const tick = (t) => {
    window.__c1.frames.push(t - last);
    last = t;
    window.__c1.raf = requestAnimationFrame(tick);
  };
  window.__c1.raf = requestAnimationFrame(tick);
  const OrigWS = window.WebSocket;
  window.WebSocket = function (...args) {
    const ws = new OrigWS(...args);
    ws.addEventListener("message", (ev) => {
      window.__c1.wsTotal += 1;
      let type = "?";
      try {
        const data = typeof ev.data === "string" ? JSON.parse(ev.data) : null;
        type = data?.type ?? "binary";
      } catch {
        type = "unparsed";
      }
      window.__c1.ws[type] = (window.__c1.ws[type] || 0) + 1;
    });
    return ws;
  };
  window.WebSocket.prototype = OrigWS.prototype;
};

/** 采一个窗口：返回该窗口内的指标增量。 */
async function sampleWindow(phase) {
  const page = globalThis.__page;
  await page.evaluate((p) => {
    window.__c1.phaseReset = { frames: [], ws: {}, wsTotal: 0, started: performance.now(), phase: p };
  }, phase);
  await page.evaluate(() => {
    window.__c1.frames = [];
    window.__c1.ws = {};
    window.__c1.wsTotal = 0;
    // 修复：分母必须以「本窗口起点」计（原先用装置安装时刻，分子每窗清零 → 越靠后的窗口速率被系统性低估）
    window.__c1.windowStart = performance.now();
  });
  const cdp = globalThis.__cdp;
  const readMetrics = async () => {
    const { metrics } = await cdp.send("Performance.getMetrics");
    return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
  };
  const metricsBefore = await readMetrics();
  await page.waitForTimeout(WINDOW_SEC * 1000);
  const after = await page.evaluate(() => {
    const c = window.__c1;
    const frames = c.frames.slice().sort((a, b) => a - b);
    const pct = (q) => (frames.length === 0 ? null : Number(frames[Math.min(frames.length - 1, Math.floor(frames.length * q))].toFixed(2)));
    return {
      frames: frames.length,
      frame_p50_ms: pct(0.5),
      frame_p99_ms: pct(0.99),
      frame_max_ms: frames.length ? Number(frames[frames.length - 1].toFixed(2)) : null,
      frames_over_50ms: c.frames.filter((x) => x > 50).length,
      ws_total: c.wsTotal,
      ws_rate_per_s: Number((c.wsTotal / Math.max((performance.now() - (c.windowStart ?? c.started)) / 1000, 0.001)).toFixed(1)),
      ws_by_type: c.ws,
      dom_nodes_total: document.querySelectorAll("*").length,
      dom_nodes_panel: document.querySelectorAll('[role="dialog"] *').length
    };
  });
  const mAfter = await readMetrics();
  const delta = (k) => Number((((mAfter[k] ?? 0) - (metricsBefore[k] ?? 0)) * 1000).toFixed(1));
  return {
    phase,
    window_sec: WINDOW_SEC,
    script_ms: delta("ScriptDuration"),
    task_ms: delta("TaskDuration"),
    recalc_style_ms: delta("RecalcStyleDuration"),
    layout_ms: delta("LayoutDuration"),
    script_ms_per_s: Number((delta("ScriptDuration") / WINDOW_SEC).toFixed(1)),
    ...after
  };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  globalThis.__page = page;
  await page.addInitScript(INSTALL);
  await page.goto(URL_, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(5000); // 让 runtime 装配 + 首次 session.list 拉取完成
  // CDP session 只建一次（每个窗口读一次 getMetrics 差值）
  globalThis.__cdp = await page.context().newCDPSession(page);
  await globalThis.__cdp.send("Performance.enable");

  // 规模：/api/session.list 的条数与字节数（走页面的 fetch，复用登录态）
  const scale = await page.evaluate(async () => {
    // 修复：必须使用 DSH RPC 信封，否则宿主返回 bad-request（原实现恒得 680 B / items:null，
    // 导致本探针从不真正测量 N——审计发现）。同时分列「信封字节」与「items 字节」，避免口径错标。
    const url = "/api/session.list";
    const body = JSON.stringify({
      type: "client-request",
      rpcId: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random())),
      method: "session.list",
      payload: {}
    });
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body });
      const text = await res.text();
      let items = null, ok = null, itemsBytes = null, topLevel = null, subagent = null;
      try {
        const json = JSON.parse(text);
        ok = json?.result?.ok ?? null;
        const list = json?.result?.value?.items ?? null;
        if (Array.isArray(list)) {
          items = list.length;
          itemsBytes = JSON.stringify(list).length;
          topLevel = list.filter((x) => x && x.origin !== "subagent").length;
          subagent = list.filter((x) => x && x.origin === "subagent").length;
        }
      } catch { /* 保持 null */ }
      return { url, status: res.status, ok, envelope_bytes: text.length, items_bytes: itemsBytes, items, top_level: topLevel, subagent };
    } catch (error) {
      return { url, status: null, ok: null, envelope_bytes: null, items_bytes: null, items: null, error: String(error).slice(0, 120) };
    }
  });

  const results = [];
  results.push(await sampleWindow("idle"));

  // 打开设置面板（只点击入口，不切标签）= 基线 A/B 的 B/C 窗口口径
  let opened = false;
  try {
    const trigger = page.locator('[aria-label*="设置"], [title*="设置"], button:has-text("设置")').first();
    await trigger.click({ timeout: 5000 });
    await page.waitForTimeout(1500);
    opened = true;
  } catch {
    opened = false;
  }
  results.push(await sampleWindow(opened ? "settings-open" : "settings-open-failed"));

  // 停留窗口（面板保持打开）
  results.push(await sampleWindow("settings-dwell"));

  if (opened) {
    try {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(1000);
    } catch {
      /* 关闭失败不影响只读采集 */
    }
  }

  await browser.close();

  const report = {
    probe: "measure-after-C1",
    url: URL_,
    window_sec: WINDOW_SEC,
    node: process.version,
    session_list: scale,
    windows: results,
    baseline_reference: {
      source: ".workspace/settings-lag/DIAGNOSIS.md §1.2（同一方法：rAF + CDP Performance + WS 帧率）",
      note: "基线的 M2 数字是在「会话活跃、WS 73 帧/s、N=2361」条件下测得；本探针只有在同等活跃条件下才可逐项对照",
      baseline: {
        idle_20s: { script_ms: 2428, task_ms: 3087, recalc_style_ms: 419, frame_p50_ms: 16.7, frame_p99_ms: 100.1, frames_over_50ms: 22 },
        settings_open_20s: { script_ms: 2550, task_ms: 3460, recalc_style_ms: 647, frame_p50_ms: 16.7, frame_p99_ms: 116.6, frames_over_50ms: 26 },
        settings_dwell_20s: { script_ms: 3795, task_ms: 4898, recalc_style_ms: 857, frame_p50_ms: 16.7, frame_p99_ms: 116.7, frames_over_50ms: 40 },
        ws_frames_per_s: 73,
        session_list: { items: 2361, bytes: 3763290 },
        micro: { buildListSnapshot_current_ms: 5.66, buildListSnapshot_fixed_ms: 0.09 }
      }
    }
  };

  if (BEFORE !== "" && existsSync(BEFORE)) {
    report.comparison_vs_before = compare(JSON.parse(readFileSync(BEFORE, "utf8")), report);
  }

  const text = JSON.stringify(report, null, 2);
  if (OUT !== "") {
    writeFileSync(OUT, text, "utf8");
    console.log(`已写入 ${OUT}`);
  }
  console.log(text);
}

/** 与一份 before 报告做逐窗口对照（两侧同 phase 才比）。 */
function compare(before, after) {
  const rows = [];
  const beforeWindows = before.windows ?? [];
  for (const a of after.windows) {
    const b = beforeWindows.find((w) => w.phase === a.phase);
    if (b === undefined) continue;
    rows.push({
      phase: a.phase,
      script_ms: { before: b.script_ms, after: a.script_ms, delta_pct: pctDelta(b.script_ms, a.script_ms) },
      task_ms: { before: b.task_ms, after: a.task_ms, delta_pct: pctDelta(b.task_ms, a.task_ms) },
      frames_over_50ms: { before: b.frames_over_50ms, after: a.frames_over_50ms },
      frame_p99_ms: { before: b.frame_p99_ms, after: a.frame_p99_ms },
      ws_rate_per_s: { before: b.ws_rate_per_s, after: a.ws_rate_per_s }
    });
  }
  return {
    note: "只有 ws_rate_per_s 接近（活跃度可比）时，script_ms 的差值才可解读为补丁收益；否则差异主要来自负载不同",
    rows
  };
}
function pctDelta(b, a) {
  if (!b || b === 0) return null;
  return Number((((a - b) / b) * 100).toFixed(1));
}

main().catch((error) => {
  console.error("[measure-after-C1] 失败：", error && error.message ? error.message : error);
  process.exit(1);
});
