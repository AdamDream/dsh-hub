/**
 * harden-measure.mjs — 性能测量框架「硬化版」探针（只读）
 *
 * 目标：把已知缺陷修成**可复算、不可自欺**的工具。相对 probes/measure-after-C1.mjs 的硬化点：
 *
 *  H1 DSH RPC 信封：session.list 必须用 {type:'client-request',rpcId,method,payload} 信封；
 *     校验响应为 {type:'server-response',rpcId 回显,result.ok===true,result.value.items 为数组}。
 *     任一不满足 → **硬失败**（run 级 FATAL 或 window 级 invalid），绝不静默继续。
 *  H2 窗口内分母：ws/rAF/mutation/CDP 每个计数器各自记录真实 t_start/t_end（统一映射到页面
 *     performance.now() 时钟），额外计算共同有效区间 common_interval，并给出双口径速率。
 *  H3 payload 类型分类：WS 帧是 ServerRequest 全形 {type,rpcId,method,payload}，顶层 type 恒为
 *     'server-request'（退化）。分类必须走 payload.type（并记录 session/event 的深层 event.type），
 *     且必须是**划分**（sum(byType) === total），否则 window invalid。
 *     另：历史基线用的是「子串关键词命中」分类（非划分、可重复计数），本探针不复刻该口径，
 *     而是产出规范划分；跨口径比较一律禁止（见 docs/PROTOCOL.md）。
 *  H4 装载门禁：run 级 ready 门禁 + window 级 phase 门禁（idle 要求无 dialog；settings-* 要求
 *     dialog 存在且 panel 节点 > 0）。门禁失败 → window invalid（显式落盘），不参与统计。
 *  H5 invalid 显式落盘：所有窗口（含 invalid）都进 windows[]，并另列 invalid_runs[]；
 *     汇总只用 valid 窗口，且报告 invalid 比例；valid 窗口数 < n_min → 场景 INCONCLUSIVE。
 *     绝不「只挑最佳窗口」：不输出 best-window 字段，只输出分布。
 *  H6 统计：每场景 n>=3（默认 5），输出每个窗口级指标的中位数/IQR/p95/p99 + 超门槛比例；
 *     尾部延迟额外给出跨窗口**池化**分布（池化 p95/p99 才有足够尾样本）。
 *  H7 只读证明：记录全部非 GET 请求并按动词分类，任一 mutation-like 端点被访问即记 violation。
 *  H8 宿主身份：记录 host pid / starttime / boot_id，用于跨 run 的区组配对与「宿主是否重启」判定。
 *  H9 有界超时：全局 watchdog，超时也要落盘已采数据。
 *
 * 退出码语义（**重要**）：
 *   0 = 测量框架自检通过（门禁全绿），**不代表性能达标**；
 *   2 = 测量完成但存在 invalid 窗口 / 场景 INCONCLUSIVE / 有指标超门槛；
 *   1 = 框架级 FATAL（RPC 门禁失败、页面从未 ready、watchdog 超时）。
 *   → 任何情况下都不得把「退出码 0」当作性能通过。性能结论只看 artifact 里的 verdict 块。
 *
 * 只读纪律：仅点击「设置」入口与 Esc；不点保存/应用/删除，不刷新，不改配置，不重启宿主。
 *
 * 用法：
 *   node harden-measure.mjs --out ../runs/baseline.json [--window 12] [--n 5] [--warmup 10]
 *   node harden-measure.mjs --label before --out ../runs/before.json
 */
import { createRequire } from "node:module";
import { writeFileSync, mkdirSync, readFileSync, rmdirSync, rmSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

// ---------------------------------------------------------------- 预注册常量
/** 预注册终点门槛。来源：历史验收文档口径（沿用），但其「用户体验充分性」未被验证——见 PROTOCOL.md §6。 */
const THRESHOLDS = {
  script_ms_per_s: 60, // 历史「空闲 script < 60 ms/s」
  frame_p99_ms: 50, // 历史「设置页 p99 < 50ms」
  frames_over_50ms_ratio: 0.02, // 本探针预注册：>50ms 帧占比 <= 2%
  long_task_total_ms_per_s: 100 // 本探针预注册：长任务总时长 <= 100ms/s
};
const MIN_VALID_WINDOWS = 3; // 场景判定的最小有效窗口数（n>=3）
const MIN_DOM_NODES = 300; // 装载门禁：历史失败页 108 节点，健康页 585~791
const MIN_RAF_FRAMES = 20; // 低于此视为被节流/后台化
const ENVELOPE_KEYS = ["type", "rpcId", "method", "payload"];

// ---------------------------------------------------------------- CLI
const argv = process.argv.slice(2);
const argOf = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d;
};
const URL_ = process.env.DSH_URL || "http://127.0.0.1:3080";
const WINDOW_SEC = Number(argOf("--window", "12"));
const N_PER_SCENARIO = Math.max(3, Number(argOf("--n", "5")));
const WARMUP_SEC = Number(argOf("--warmup", "10"));
const LABEL = argOf("--label", "baseline");
/** 并发门禁模式：strict=断言"并发实例数==自身实例数"，不满足即该窗口 invalid；record=只记录；off=不采样。 */
const CONCURRENCY_GATE = (() => {
  const i = argv.indexOf("--concurrency-gate");
  const v = i >= 0 && argv[i + 1] ? argv[i + 1] : "strict";
  return ["strict", "record", "off"].includes(v) ? v : "strict";
})();
const BROWSER_PGREP = "headless_shell --disable-field-trial-config";

/** 打开后一并观察 characterData（默认关；打开＝仪表化扰动轮，必须在报告里标注）。 */
const MUTATION_CHARDATA = argv.includes("--mutation-chardata");
const OUT = argOf("--out", resolve(process.cwd(), "runs/harden-baseline.json"));
const GLOBAL_BUDGET_MS = Number(argOf("--budget-ms", "420000"));

const r3 = (x) => (typeof x === "number" && Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null);

/**
 * 有界超时：任何可能永久挂起的等待都必须有上限，超时 → 抛错 → 由恢复路径记为
 * invalid / recovery event，而不是让整个 run 被全局 watchdog 杀掉（那会丢掉最后一个窗口）。
 */
function withTimeout(promise, ms, label) {
  let timer = null;
  return Promise.race([
    Promise.resolve(promise).finally(() => {
      if (timer) clearTimeout(timer);
    }),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timeout:${label}:${ms}ms`)), ms);
    })
  ]);
}
/** 各操作的预注册超时上限（ms）。 */
const T = {
  reset: 15000,
  windowWait: (s) => s * 1000 + 20000,
  snapshot: 30000,
  cdp: 20000,
  rpc: 30000,
  countInRange: 20000,
  evaluate: 15000,
  click: 8000,
  panelWait: 12000,
  close: 20000,
  goto: 60000,
  ready: 40000
};

// ---------------------------------------------------------------- 页面内采集器
function INSTALL(opts) {
  const CHARDATA = !!(opts && opts.chardata);
  const MH = {
    raf: [],
    rafDone: false,
    clickMark: null,
    clickToPaint: [],
    wsFrames: [],
    sockets: [],
    mut: [],
    longTasks: [],
    envelopeViolations: [],
    rawSamples: [],
    pendingClear: false
  };
  window.__MH = MH;

  // rAF 帧时间戳（绝对 performance.now()）
  let lastRaf = performance.now();
  const tick = (t) => {
    MH.raf.push(t);
    if (MH.clickMark !== null) {
      MH.clickToPaint.push({ click_ms: r3px(MH.clickMark), paint_ms: r3px(t), delta_ms: r3px(t - MH.clickMark) });
      MH.clickMark = null;
    }
    lastRaf = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  function r3px(x) {
    return Math.round(x * 1000) / 1000;
  }
  MH.markClick = () => {
    MH.clickMark = performance.now();
  };

  // Long Task
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) MH.longTasks.push({ start: r3px(e.startTime), duration: r3px(e.duration) });
    }).observe({ entryTypes: ["longtask"] });
  } catch {
    /* 不支持则留空 */
  }

  // 结构性 mutation。**默认只观察 childList + subtree，不观察 characterData**：
  // 本应用（DSH Web GUI）的流式渲染是**原地改文本节点**，实测 childList-only 每窗口仅 6~8 次，
  // 基本测不到 re-render；而观察 characterData 会给被测对象叠加可观主线程开销（污染测量）。
  // 因此：默认口径 = 结构 churn（不是 re-render 代理，**不得**当作 commit 计数）；
  // 需要量化 characterData churn 时用 --mutation-chardata 显式打开，且该轮必须标注为「仪表化扰动轮」。
  // 施工记录与实测证据见 docs/UNVERIFIED.md B9 / audit.md §5。
  try {
    MH.mutDebug = { bodyAtInit: !!document.body, readyAtInit: document.readyState, started: false, err: null, cb_calls: 0 };
    const mo = new MutationObserver((records) => {
      MH.mutDebug.cb_calls += 1;
      const t = r3px(performance.now());
      for (const rec of records) {
        let inPanel = false;
        try {
          inPanel = !!(rec.target && rec.target.closest && rec.target.closest('[role="dialog"]'));
        } catch {
          inPanel = false;
        }
        MH.mut.push({ t, target: rec.target?.nodeName ?? "?", panel: inPanel });
        if (MH.mut.length >= 400000) {
          MH.mutOverflow = (MH.mutOverflow || 0) + 1;
          return;
        }
      }
    });
    const start = () => {
      try {
        mo.observe(document.body, { childList: true, subtree: true, characterData: CHARDATA, attributes: false });
        MH.mutDebug.started = true;
        MH.mutDebug.bodyAtStart = !!document.body;
        MH.mutDebug.characterData = CHARDATA;
      } catch (e) {
        MH.mutDebug.err = "observe:" + String(e);
      }
    };
    if (document.body) start();
    else document.addEventListener("DOMContentLoaded", start);
  } catch (e) {
    MH.mutDebug = { err: "setup:" + String(e) };
  }

  // WebSocket：按 payload.type 规范分类（划分），并校验 ServerRequest 信封
  const OrigWS = window.WebSocket;
  window.WebSocket = function (...args) {
    const ws = new OrigWS(...args);
    const idx =
      MH.sockets.push({
        url: String(args[0]),
        frames: 0,
        bytes: 0,
        id: MH.sockets.length,
        opened_at: r3px(performance.now()),
        closed_at: null,
        close_events: 0,
        error_events: 0
      }) - 1;
    // 连接完整性：close/error 是"连接中断"的直接证据（同 URL 出现第二个实例 = 重连）
    ws.addEventListener("close", () => {
      const s = MH.sockets[idx];
      s.close_events += 1;
      s.closed_at = r3px(performance.now());
    });
    ws.addEventListener("error", () => {
      MH.sockets[idx].error_events += 1;
    });
    ws.addEventListener("message", (ev) => {
      const t = r3px(performance.now());
      const isStr = typeof ev.data === "string";
      const bytes = isStr ? ev.data.length : 0;
      const rec = { idx, t, bytes, topType: null, kind: null, method: null, envelopeOk: false, sessionId: null, eventKind: null };
      if (!isStr) {
        rec.topType = "<binary>";
        rec.kind = "binary";
      } else {
        try {
          const d = JSON.parse(ev.data);
          const keys = Object.keys(d);
          rec.topType = d?.type ?? null;
          rec.method = typeof d?.method === "string" ? d.method : null;
          const keySetOk =
            keys.length === ENVELOPE_KEYS_LOCAL.length && ENVELOPE_KEYS_LOCAL.every((k) => keys.includes(k));
          rec.keyOrder = keys.join(",");
          rec.envelopeOk =
            d?.type === "server-request" &&
            typeof d?.rpcId === "string" &&
            typeof d?.method === "string" &&
            d?.payload !== undefined &&
            keySetOk;
          const pl = d?.payload;
          rec.kind = pl && typeof pl === "object" && typeof pl.type === "string" ? pl.type : rec.topType ?? "unknown";
          rec.sessionId = pl && typeof pl === "object" ? pl.sessionId ?? null : null;
          if (rec.kind === "session/event") rec.eventKind = pl?.event?.type ?? null;
          else rec.eventKind = rec.kind;
          if (!rec.envelopeOk) {
            MH.envelopeViolations.push({ t, topType: rec.topType, keys: keys.join(","), method: rec.method });
          }
          if (MH.rawSamples.length < 5) MH.rawSamples.push(ev.data.slice(0, 400));
        } catch {
          rec.topType = "<unparsed>";
          rec.kind = "unparsed";
          MH.envelopeViolations.push({ t, topType: "unparsed", keys: null });
        }
      }
      MH.sockets[idx].frames += 1;
      MH.sockets[idx].bytes += bytes;
      MH.wsFrames.push(rec);
    });
    return ws;
  };
  window.WebSocket.prototype = OrigWS.prototype;
  const ENVELOPE_KEYS_LOCAL = ["type", "rpcId", "method", "payload"];
}

// ---------------------------------------------------------------- 页面侧快照
function SNAPSHOT() {
  const MH = window.__MH;
  const t = performance.now();
  const frames = MH.wsFrames;
  const raf = MH.raf;
  const mut = MH.mut;
  const spans = (arr) => (arr.length ? { start: arr[0], end: arr[arr.length - 1] } : { start: null, end: null });

  // 划分校验 + 按 kind 聚合
  const byKind = {};
  const bytesByKind = {};
  const secBucket = {};
  const socketAgg = {};
  for (const f of frames) {
    byKind[f.kind] = (byKind[f.kind] || 0) + 1;
    bytesByKind[f.kind] = (bytesByKind[f.kind] || 0) + f.bytes;
    const s = Math.floor(f.t / 1000);
    secBucket[f.kind] = secBucket[f.kind] || {};
    secBucket[f.kind][s] = (secBucket[f.kind][s] || 0) + 1;
    const su = MH.sockets[f.idx]?.url ?? "?";
    socketAgg[su] = socketAgg[su] || { frames: 0, byKind: {} };
    socketAgg[su].frames += 1;
    socketAgg[su].byKind[f.kind] = (socketAgg[su].byKind[f.kind] || 0) + 1;
  }
  const rafIntervals = [];
  for (let i = 1; i < raf.length; i++) rafIntervals.push(Math.round((raf[i] - raf[i - 1]) * 1000) / 1000);

  const dlg = document.querySelector('[role="dialog"]');
  const panelNodes = document.querySelectorAll('[role="dialog"] *').length;
  const activeTab = dlg ? (dlg.querySelector('[role="tab"][aria-selected="true"]')?.innerText || "").trim().slice(0, 40) : null;
  const tabLabels = dlg
    ? [...dlg.querySelectorAll('[role="tab"],button')]
        .map((b) => (b.innerText || b.getAttribute("aria-label") || "").trim())
        .filter(Boolean)
        .slice(0, 25)
    : [];

  return {
    t_snapshot: Math.round(t * 1000) / 1000,
    page: {
      href: location.href,
      visibility: document.visibilityState,
      has_focus: document.hasFocus(),
      dialog_count: document.querySelectorAll('[role="dialog"]').length,
      panel_nodes: panelNodes,
      active_tab: activeTab,
      tab_labels: tabLabels,
      dom_nodes_total: document.querySelectorAll("*").length,
      app_root_children: (document.getElementById("root") || document.body)?.children?.length ?? 0
    },
    ws: {
      total: frames.length,
      partition_sum: Object.values(byKind).reduce((a, b) => a + b, 0),
      by_kind: byKind,
      bytes_by_kind: bytesByKind,
      per_second_by_kind: secBucket,
      per_socket: socketAgg,
      socket_instances: MH.sockets.map((s) => ({
        id: s.id,
        url: s.url,
        opened_at: s.opened_at,
        closed_at: s.closed_at,
        close_events: s.close_events,
        error_events: s.error_events,
        frames_total: s.frames
      })),
      /** 同一 URL 出现 >1 个 socket 实例 = 期间发生过重连（连接中断的直接证据） */
      reconnects: (() => {
        const byUrl = {};
        for (const s of MH.sockets) byUrl[s.url] = (byUrl[s.url] || 0) + 1;
        return Object.entries(byUrl)
          .filter(([, n]) => n > 1)
          .map(([url, n]) => ({ url, instances: n }));
      })(),
      span: spans(frames.map((f) => f.t)),
      envelope_violations: MH.envelopeViolations.length,
      envelope_violation_sample: MH.envelopeViolations.slice(0, 5),
      raw_envelope_samples: MH.rawSamples.slice(0, 2),
      session_event_kinds: (() => {
        const m = {};
        for (const f of frames) if (f.kind === "session/event") m[f.eventKind ?? "?"] = (m[f.eventKind ?? "?"] || 0) + 1;
        return m;
      })(),
      distinct_sessions: new Set(frames.map((f) => f.sessionId).filter(Boolean)).size
    },
    raf: { count: raf.length, span: spans(raf), intervals: rafIntervals },
    mutation: {
      count: mut.length,
      panel_count: mut.filter((m) => m.panel).length,
      overflow: MH.mutOverflow || 0,
      span: spans(mut.map((m) => m.t)),
      debug: MH.mutDebug || null,
      scope: "document.body childList+subtree（不含 characterData）"
    },
    long_tasks: MH.longTasks.slice(),
    click_to_paint: MH.clickToPaint.slice()
  };
}

/** 精确统计落在共同区间内的各计数器计数（避免整秒桶近似）。 */
function COUNT_IN_RANGE(range) {
  const MH = window.__MH;
  const inR = (t) => t >= range.t_start_ms && t <= range.t_end_ms;
  const ws = {};
  for (const f of MH.wsFrames) if (inR(f.t)) ws[f.kind] = (ws[f.kind] || 0) + 1;
  const rafT = MH.raf.filter(inR);
  const ivs = [];
  for (let i = 1; i < rafT.length; i++) ivs.push(Math.round((rafT[i] - rafT[i - 1]) * 1000) / 1000);
  return {
    ws_by_kind: ws,
    ws_total: Object.values(ws).reduce((a, b) => a + b, 0),
    raf_count: rafT.length,
    raf_intervals_ms: ivs,
    mut_count: MH.mut.filter((m) => inR(m.t)).length,
    mut_panel_count: MH.mut.filter((m) => inR(m.t) && m.panel).length,
    long_task_count: MH.longTasks.filter((x) => x.start >= range.t_start_ms && x.start <= range.t_end_ms).length
  };
}

function RESET() {  const MH = window.__MH;
  MH.raf = [];
  MH.wsFrames = [];
  MH.mut = [];
  MH.mutOverflow = 0;
  MH.longTasks = [];
  MH.clickToPaint = [];
  MH.envelopeViolations = [];
  MH.sockets.forEach((s) => {
    s.frames = 0;
    s.bytes = 0;
  });
  return performance.now();
}

// ---------------------------------------------------------------- 统计工具
function quantile(sorted, p) {
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}
function describe(vals) {
  const v = vals.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return { n: 0 };
  return {
    n: v.length,
    min: r3(v[0]),
    q1: r3(quantile(v, 0.25)),
    median: r3(quantile(v, 0.5)),
    q3: r3(quantile(v, 0.75)),
    iqr: r3(quantile(v, 0.75) - quantile(v, 0.25)),
    p95: r3(quantile(v, 0.95)),
    p99: r3(quantile(v, 0.99)),
    max: r3(v[v.length - 1]),
    mean: r3(v.reduce((a, b) => a + b, 0) / v.length)
  };
}
function thresholdEval(vals, limit) {
  const v = vals.filter((x) => typeof x === "number" && Number.isFinite(x));
  if (!v.length) return { limit, total: 0, over: null, ratio: null, status: "INCONCLUSIVE" };
  const over = v.filter((x) => x > limit).length;
  const ratio = over / v.length;
  return {
    limit,
    total: v.length,
    over,
    ratio: r3(ratio),
    status: over === 0 ? "PASS" : ratio > 0.5 ? "FAIL" : "MIXED"
  };
}
function ratePerSec(count, spanMs) {
  if (!Number.isFinite(spanMs) || spanMs <= 0) return null;
  return r3(count / (spanMs / 1000));
}
function intersection(spans) {
  const valid = spans.filter((s) => s && Number.isFinite(s[0]) && Number.isFinite(s[1]) && s[1] > s[0]);
  if (!valid.length) return null;
  const start = Math.max(...valid.map((s) => s[0]));
  const end = Math.min(...valid.map((s) => s[1]));
  return end > start ? { t_start_ms: r3(start), t_end_ms: r3(end), span_ms: r3(end - start) } : null;
}

// ---------------------------------------------------------------- DSH RPC（正确信封 + 硬校验）
async function rpcSessionList(page) {
  return await withTimeout(page.evaluate(async () => {
    const rpcId = crypto.randomUUID();
    const body = JSON.stringify({ type: "client-request", rpcId, method: "session.list", payload: {} });
    let res, text;
    try {
      res = await fetch("/api/session.list", { method: "POST", headers: { "content-type": "application/json" }, body });
      text = await res.text();
    } catch (error) {
      return { ok: false, reason: "fetch-failed", error: String(error).slice(0, 160) };
    }
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, reason: "response-not-json", status: res.status, bytes: text.length, head: text.slice(0, 160) };
    }
    const checks = {
      type_is_server_response: json?.type === "server-response",
      rpcId_echoed: json?.rpcId === rpcId,
      result_ok_true: json?.result?.ok === true,
      items_is_array: Array.isArray(json?.result?.value?.items)
    };
    const items = checks.items_is_array ? json.result.value.items : null;
    const failure = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
    const out = {
      ok: failure.length === 0,
      status: res.status,
      envelope_bytes: text.length,
      checks,
      failure_reasons: failure,
      counter: "dsh-rpc-session.list"
    };
    if (!out.ok) {
      out.error = json?.result?.error ?? null;
      out.note = "DSH RPC 契约不满足 —— 按硬化要求必须 FAIL，不得静默继续";
      return out;
    }
    out.items = items.length;
    out.items_bytes = JSON.stringify(items).length;
    out.top_level = items.filter((x) => x && x.origin !== "subagent").length;
    out.subagent = items.filter((x) => x && x.origin === "subagent").length;
    out.running = items.filter((x) => x && x.running === true).length;
    return out;
  }), T.rpc, "rpc-session.list");
}

// ---------------------------------------------------------------- 装载门禁
async function readyGate(page) {
  const evidence = {};
  // 1) DOM 规模
  try {
    await page.waitForFunction((min) => document.querySelectorAll("*").length >= min, MIN_DOM_NODES, { timeout: T.ready });
    evidence.dom_nodes_ok = true;
  } catch {
    evidence.dom_nodes_ok = false;
  }
  evidence.dom_nodes = await page.evaluate(() => document.querySelectorAll("*").length);
  evidence.app_root_children = await page.evaluate(() => (document.getElementById("root") || document.body)?.children?.length ?? 0);
  // 2) WS 通道建立
  evidence.ws_sockets = await page.evaluate(() => (window.__MH?.sockets ?? []).map((s) => ({ url: s.url, frames: s.frames })));
  evidence.ws_open = evidence.ws_sockets.length > 0;
  // 3) RPC 硬门禁
  const rpc = await rpcSessionList(page);
  evidence.rpc = rpc;
  // 4) 页面错误
  evidence.page_errors = globalThis.__pageErrors.slice(0, 5);
  const failures = [];
  if (!evidence.dom_nodes_ok || evidence.dom_nodes < MIN_DOM_NODES) failures.push("dom-nodes-below-min");
  if (evidence.app_root_children < 1) failures.push("app-root-empty");
  if (!evidence.ws_open) failures.push("no-websocket");
  if (!rpc.ok) failures.push("session-list-rpc-contract-violated");
  return { ok: failures.length === 0, failures, evidence };
}

// ---------------------------------------------------------------- 打开设置面板
async function openSettings(page) {
  const result = { clicked: false, selector: null, errors: [] };
  // 只点「设置」入口：优先 exact text 的 button
  const strategies = [
    { name: 'getByRole(button,name=设置,exact)', run: async () => page.getByRole("button", { name: "设置", exact: true }).first() },
    { name: 'button:has-text(/^设置$/)', run: async () => page.locator("button", { hasText: /^设置$/ }).first() },
    { name: 'button:has-text("设置")', run: async () => page.locator('button:has-text("设置")').first() },
    { name: '[aria-label*="设置"]', run: async () => page.locator('[aria-label*="设置"]').first() },
    { name: '[title*="设置"]', run: async () => page.locator('[title*="设置"]').first() }
  ];
  for (const s of strategies) {
    try {
      const loc = await s.run();
      if ((await loc.count()) === 0) {
        result.errors.push(`${s.name}: count=0`);
        continue;
      }
      // 记录 click-to-paint：点击前在页面打标
      await page.evaluate(() => window.__MH?.markClick?.());
      await loc.click({ timeout: 5000 });
      result.clicked = true;
      result.selector = s.name;
      break;
    } catch (e) {
      result.errors.push(`${s.name}: ${String(e?.message || e).slice(0, 120)}`);
    }
  }
  if (!result.clicked) return { ...result, ok: false, reason: "settings-entry-not-clickable" };
  // 面板确认门禁
  try {
    await page.waitForFunction(() => document.querySelectorAll('[role="dialog"] *').length > 0, undefined, { timeout: 8000 });
    result.panel_confirmed = true;
  } catch {
    result.panel_confirmed = false;
  }
  result.panel_nodes = await page.evaluate(() => document.querySelectorAll('[role="dialog"] *').length);
  result.dom_nodes = await page.evaluate(() => document.querySelectorAll("*").length);
  // click→next-paint：**必须在此处取**（下一个窗口的 RESET 会清空 clickToPaint）
  try {
    result.click_to_paint = await page.evaluate(() => (window.__MH?.clickToPaint ?? []).slice());
  } catch {
    result.click_to_paint = [];
  }
  return { ...result, ok: result.panel_confirmed && result.panel_nodes > 0 };
}

// ---------------------------------------------------------------- 采一个窗口
async function sampleWindow({ page, cdp, phase, index, counted, ownInstances = 1 }) {
  const w = { phase, index, counted, valid: null, invalid_reasons: [], host_pid: HOST_PID };
  const concStart = concurrencyProbe(ownInstances);
  // 时钟对齐：node 与页面 performance.now() 同时取样
  const nodeBefore = Date.now();
  const t0 = await withTimeout(page.evaluate(RESET), T.reset, `reset:${phase}[${index}]`);
  const nodeAfter = Date.now();
  const offsetPageMinusNode = t0 - (nodeBefore + nodeAfter) / 2;
  w.clock = { offset_page_minus_node_ms: r3(offsetPageMinusNode), offset_uncertainty_ms: r3((nodeAfter - nodeBefore) / 2) };

  const cdpBefore = await withTimeout(cdp.send("Performance.getMetrics"), T.cdp, "cdp-before");
  const nodeCdpStart = Date.now();
  const g = (m, n) => m.metrics.find((x) => x.name === n)?.value ?? 0;

  await withTimeout(page.waitForTimeout(WINDOW_SEC * 1000), T.windowWait(WINDOW_SEC), `window-wait:${phase}[${index}]`);

  const concEnd = concurrencyProbe(ownInstances);
  const snap = await withTimeout(page.evaluate(SNAPSHOT), T.snapshot, `snapshot:${phase}[${index}]`);
  const nodeCdpEnd = Date.now();
  const cdpAfter = await withTimeout(cdp.send("Performance.getMetrics"), T.cdp, "cdp-after");

  const cdpSpanMs = nodeCdpEnd - nodeCdpStart;
  const cdpStartPage = nodeCdpStart + offsetPageMinusNode;
  const cdpEndPage = nodeCdpEnd + offsetPageMinusNode;

  // ---- 各计数器真实 t_start/t_end
  const rafIvs = snap.raf.intervals;
  const rafSpan = snap.raf.span.start !== null ? [snap.raf.span.start, snap.raf.span.end] : null;
  const wsSpan = snap.ws.span.start !== null ? [snap.ws.span.start, snap.ws.span.end] : null;
  const mutSpan = snap.mutation.span.start !== null ? [snap.mutation.span.start, snap.mutation.span.end] : null;
  const cdpSpanPage = [r3(cdpStartPage), r3(cdpEndPage)];

  const common = intersection([rafSpan, wsSpan, mutSpan, cdpSpanPage]);

  const counters = {
    raf: {
      clock: "page.performance.now",
      t_start_ms: rafSpan ? r3(rafSpan[0]) : null,
      t_end_ms: rafSpan ? r3(rafSpan[1]) : null,
      span_ms: rafSpan ? r3(rafSpan[1] - rafSpan[0]) : null,
      count: snap.raf.count,
      rate_per_s: rafSpan ? ratePerSec(snap.raf.count, rafSpan[1] - rafSpan[0]) : null
    },
    ws_all: {
      clock: "page.performance.now",
      t_start_ms: wsSpan ? r3(wsSpan[0]) : null,
      t_end_ms: wsSpan ? r3(wsSpan[1]) : null,
      span_ms: wsSpan ? r3(wsSpan[1] - wsSpan[0]) : null,
      count: snap.ws.total,
      rate_per_s: wsSpan ? ratePerSec(snap.ws.total, wsSpan[1] - wsSpan[0]) : null
    },
    mutation: {
      clock: "page.performance.now",
      t_start_ms: mutSpan ? r3(mutSpan[0]) : null,
      t_end_ms: mutSpan ? r3(mutSpan[1]) : null,
      span_ms: mutSpan ? r3(mutSpan[1] - mutSpan[0]) : null,
      count: snap.mutation.count,
      rate_per_s: mutSpan ? ratePerSec(snap.mutation.count, mutSpan[1] - mutSpan[0]) : null
    },
    cdp: {
      clock: "page.performance.now (node Date.now 映射)",
      t_start_ms: r3(cdpStartPage),
      t_end_ms: r3(cdpEndPage),
      span_ms: r3(cdpSpanMs)
    }
  };
  for (const k of Object.keys(snap.ws.by_kind)) {
    const c = snap.ws.by_kind[k];
    counters[`ws_kind:${k}`] = {
      clock: "page.performance.now",
      t_start_ms: wsSpan ? r3(wsSpan[0]) : null,
      t_end_ms: wsSpan ? r3(wsSpan[1]) : null,
      span_ms: wsSpan ? r3(wsSpan[1] - wsSpan[0]) : null,
      count: c,
      rate_per_s: wsSpan ? ratePerSec(c, wsSpan[1] - wsSpan[0]) : null
    };
  }

  // ---- 主要指标（窗口级）
  const ltTotal = snap.long_tasks.reduce((a, b) => a + b.duration, 0);
  const scriptMs = (g(cdpAfter, "ScriptDuration") - g(cdpBefore, "ScriptDuration")) * 1000;
  const taskMs = (g(cdpAfter, "TaskDuration") - g(cdpBefore, "TaskDuration")) * 1000;
  const styleMs = (g(cdpAfter, "RecalcStyleDuration") - g(cdpBefore, "RecalcStyleDuration")) * 1000;
  const layoutMs = (g(cdpAfter, "LayoutDuration") - g(cdpBefore, "LayoutDuration")) * 1000;
  const cdpSec = cdpSpanMs / 1000;

  const sortedIvs = rafIvs.slice().sort((a, b) => a - b);
  const over50 = rafIvs.filter((x) => x > 50);

  const metrics = {
    script_ms: r3(scriptMs),
    task_ms: r3(taskMs),
    recalc_style_ms: r3(styleMs),
    layout_ms: r3(layoutMs),
    script_ms_per_s: r3(scriptMs / cdpSec),
    task_ms_per_s: r3(taskMs / cdpSec),
    frame_count: rafIvs.length,
    frame_p50_ms: r3(quantile(sortedIvs, 0.5)),
    frame_p95_ms: r3(quantile(sortedIvs, 0.95)),
    frame_p99_ms: r3(quantile(sortedIvs, 0.99)),
    frame_max_ms: rafIvs.length ? r3(Math.max(...rafIvs)) : null,
    frames_over_50ms: over50.length,
    frames_over_50ms_ratio: rafIvs.length ? r3(over50.length / rafIvs.length) : null,
    long_task_count: snap.long_tasks.length,
    long_task_total_ms: r3(ltTotal),
    long_task_total_ms_per_s: r3(ltTotal / cdpSec),
    long_task_max_ms: snap.long_tasks.length ? r3(Math.max(...snap.long_tasks.map((x) => x.duration))) : null,
    ws_total: snap.ws.total,
    ws_rate_per_s: wsSpan ? ratePerSec(snap.ws.total, wsSpan[1] - wsSpan[0]) : null,
    ws_session_event: snap.ws.by_kind["session/event"] ?? 0,
    ws_session_event_rate_per_s: wsSpan ? ratePerSec(snap.ws.by_kind["session/event"] ?? 0, wsSpan[1] - wsSpan[0]) : null,
    ws_session_projection: snap.ws.by_kind["session/projection"] ?? 0,
    ws_bytes_total: Object.values(snap.ws.bytes_by_kind).reduce((a, b) => a + b, 0),
    mutation_count: snap.mutation.count,
    mutation_panel_count: snap.mutation.panel_count,
    mutation_overflow: snap.mutation.overflow
  };

  // ---- 门禁
  const p = snap.page;
  const reasons = [];
  if (p.dom_nodes_total < MIN_DOM_NODES) reasons.push(`dom-nodes-below-min(${p.dom_nodes_total}<${MIN_DOM_NODES})`);
  if (p.app_root_children < 1) reasons.push("app-root-empty");
  if (p.visibility !== "visible") reasons.push(`page-not-visible(${p.visibility})`);
  if (snap.raf.count < MIN_RAF_FRAMES) reasons.push(`raf-frames-too-few(${snap.raf.count}<${MIN_RAF_FRAMES})`);
  if (snap.ws.envelope_violations > 0) reasons.push(`ws-envelope-violations(${snap.ws.envelope_violations})`);
  if (snap.ws.total > 0 && snap.ws.partition_sum !== snap.ws.total) {
    reasons.push(`ws-partition-not-total(sum=${snap.ws.partition_sum}!=total=${snap.ws.total})`);
  }
  if (phase === "idle" && p.dialog_count !== 0) reasons.push(`idle-phase-has-dialog(${p.dialog_count})`);
  if ((phase === "settings-open" || phase === "settings-dwell") && (p.dialog_count < 1 || p.panel_nodes < 1)) {
    reasons.push(`settings-panel-absent(dialog=${p.dialog_count},panel=${p.panel_nodes})`);
  }
  if (!common) reasons.push("no-common-measurement-interval");
  // ---- 连接完整性门禁：窗口内发生过重连 / 收到过 close-error ⇒ 该窗口数据不可信
  if ((snap.ws.reconnects || []).length > 0) {
    reasons.push(`ws-reconnect(${snap.ws.reconnects.map((r) => r.url.replace(/^.*\//, "") + "x" + r.instances).join(",")})`);
  }
  const sockEvents = (snap.ws.socket_instances || []).reduce((a, s) => a + (s.close_events || 0) + (s.error_events || 0), 0);
  if (sockEvents > 0) reasons.push(`ws-socket-close-or-error(${sockEvents})`);

  // ---- 并发门禁：断言并发实例数 == 自身实例数
  if (CONCURRENCY_GATE === "strict") {
    const fs_ = concStart.foreign_instances;
    const fe = concEnd.foreign_instances;
    if (fs_ !== 0 || fe !== 0) {
      reasons.push(`concurrent-foreign-browsers(start=${fs_},end=${fe},own=${ownInstances})`);
    }
  }

  w.valid = reasons.length === 0;
  w.invalid_reasons = reasons;
  w.metrics = metrics;
  w.counters = counters;
  let commonDetail = null;
  if (common) {
    const inR = await withTimeout(page.evaluate(COUNT_IN_RANGE, common), T.countInRange, "count-in-range");
    commonDetail = {
      ...common,
      ws_total: inR.ws_total,
      ws_by_kind: inR.ws_by_kind,
      ws_rate_per_s: ratePerSec(inR.ws_total, common.span_ms),
      ws_session_event_rate_per_s: ratePerSec(inR.ws_by_kind["session/event"] ?? 0, common.span_ms),
      raf_count: inR.raf_count,
      raf_fps: ratePerSec(inR.raf_count, common.span_ms),
      raf_p99_ms: r3(quantile(inR.raf_intervals_ms.slice().sort((a, b) => a - b), 0.99)),
      mut_count: inR.mut_count,      mut_rate_per_s: ratePerSec(inR.mut_count, common.span_ms),
      mut_panel_count: inR.mut_panel_count,
      long_task_count: inR.long_task_count,
      note: "各计数器真实区间的交集；CDP 由 node 时钟映射，含 offset_uncertainty_ms 误差，故 CDP delta 不在此区间内重切"
    };
  }
  w.common_interval = commonDetail;
  w.page_state = p;
  w.mutation_debug = snap.mutation.debug ?? null;
  w.concurrency = {
    mode: CONCURRENCY_GATE,
    host_pid: HOST_PID,
    own_instances: ownInstances,
    at_window_start: concStart,
    at_window_end: concEnd,
    foreign_instances_max: [concStart.foreign_instances, concEnd.foreign_instances].filter((x) => x !== null).length
      ? Math.max(...[concStart.foreign_instances, concEnd.foreign_instances].filter((x) => x !== null))
      : null,
    gate_passed: concStart.gate_passed === true && concEnd.gate_passed === true
  };
  w.ws_detail = {
    by_kind: snap.ws.by_kind,
    bytes_by_kind: snap.ws.bytes_by_kind,
    per_second_by_kind: snap.ws.per_second_by_kind,
    per_socket: snap.ws.per_socket,
    // 连接完整性字段必须**显式透传**（SNAPSHOT 里有 ≠ artifact 里有；漏了就等于没采）
    socket_instances: snap.ws.socket_instances,
    reconnects: snap.ws.reconnects,
    session_event_kinds: snap.ws.session_event_kinds,
    distinct_sessions: snap.ws.distinct_sessions,
    envelope_violation_sample: snap.ws.envelope_violation_sample,
    raw_envelope_samples: snap.ws.raw_envelope_samples
  };
  w.raf_intervals_ms = rafIvs;
  w.long_tasks = snap.long_tasks;
  w.click_to_paint = snap.click_to_paint;
  w.activity_class = snap.ws.total === 0 ? "silent" : "streaming";
  return w;
}

// ---------------------------------------------------------------- 场景汇总
function summarizeScenario(windows, nMin) {
  const valid = windows.filter((w) => w.valid);
  const invalid = windows.filter((w) => !w.valid);
  const pick = (k) => valid.map((w) => w.metrics[k]);
  const pooled = valid.flatMap((w) => w.raf_intervals_ms || []);
  const summary = {
    windows_total: windows.length,
    windows_valid: valid.length,
    windows_invalid: invalid.length,
    invalid_fraction: windows.length ? r3(invalid.length / windows.length) : null,
    activity_class: [...new Set(valid.map((w) => w.activity_class))],
    // 窗口级指标分布（n = valid 窗口数）
    per_window: {
      script_ms_per_s: describe(pick("script_ms_per_s")),
      task_ms_per_s: describe(pick("task_ms_per_s")),
      frame_p50_ms: describe(pick("frame_p50_ms")),
      frame_p99_ms: describe(pick("frame_p99_ms")),
      frames_over_50ms_ratio: describe(pick("frames_over_50ms_ratio")),
      frames_over_50ms: describe(pick("frames_over_50ms")),
      long_task_total_ms_per_s: describe(pick("long_task_total_ms_per_s")),
      ws_rate_per_s: describe(pick("ws_rate_per_s")),
      ws_session_event_rate_per_s: describe(pick("ws_session_event_rate_per_s")),
      ws_session_projection: describe(pick("ws_session_projection")),
      n_items: describe(pick("n_items"))
    },
    // 尾部延迟：跨窗口池化（尾样本数才够）
    pooled_frames: describe(pooled),
    thresholds: {
      script_ms_per_s: thresholdEval(pick("script_ms_per_s"), THRESHOLDS.script_ms_per_s),
      frame_p99_ms: thresholdEval(pick("frame_p99_ms"), THRESHOLDS.frame_p99_ms),
      frames_over_50ms_ratio: thresholdEval(pick("frames_over_50ms_ratio"), THRESHOLDS.frames_over_50ms_ratio),
      long_task_total_ms_per_s: thresholdEval(pick("long_task_total_ms_per_s"), THRESHOLDS.long_task_total_ms_per_s)
    }
  };
  // N 漂移：同场景内各窗口的 items 快照是否稳定（不稳定则「同 N」不成立）
  const nVals = valid.map((w) => w.metrics?.n_items).filter((v) => typeof v === "number");
  summary.n_items_drift =
    nVals.length === 0
      ? { n: 0, note: "无有效 N 快照" }
      : {
          n: nVals.length,
          values: nVals,
          min: Math.min(...nVals),
          max: Math.max(...nVals),
          spread: Math.max(...nVals) - Math.min(...nVals),
          relative_spread: r3((Math.max(...nVals) - Math.min(...nVals)) / Math.max(Math.min(...nVals), 1))
        };
  if (summary.n_items_drift.n) {
    summary.n_items_drift.same_n_ok = summary.n_items_drift.relative_spread <= 0.02;
    summary.n_items_drift.rule = "同 N 判定：relative_spread <= 2%（docs/PROTOCOL.md §2.2）";
  }
  // ---- 并发普查汇总：**用全部计数窗口**（不是只用 valid）——
  // 否则"strict 门禁把整轮都判 invalid"时，恰恰会丢掉证明"为什么 invalid"的并发证据。
  const allCounted = windows.filter((w) => w.counted);
  const concs = allCounted.map((w) => w.concurrency).filter(Boolean);
  const foreignVals = allCounted
    .map((w) => w.concurrency?.foreign_instances_max)
    .filter((v) => typeof v === "number");
  summary.concurrency = {
    gate_mode: CONCURRENCY_GATE,
    host_pid: allCounted[0]?.host_pid ?? null,
    counter: concs[0]?.at_window_start?.counter ?? null,
    unit: concs[0]?.at_window_start?.unit ?? null,
    windows_sampled: foreignVals.length,
    windows_with_foreign: foreignVals.filter((v) => v > 0).length,
    windows_exclusive: foreignVals.filter((v) => v === 0).length,
    foreign_instances: describe(foreignVals),
    exclusive_fraction: foreignVals.length ? r3(foreignVals.filter((v) => v === 0).length / foreignVals.length) : null,
    note: "统计口径 = 该场景**全部**计数窗口（含被并发门禁判 invalid 的），以便在整轮 invalid 时仍能证明原因。foreign_instances = 该窗口观测到的外来主浏览器进程数（total - own）。"
  };

  const nOk = valid.length >= nMin;  const statuses = Object.values(summary.thresholds).map((t) => t.status);
  let verdict;
  if (!nOk) verdict = "INCONCLUSIVE(insufficient-valid-windows)";
  else if (statuses.every((s) => s === "PASS")) verdict = "PASS(all-pre-registered-thresholds,n>=n_min)";
  else if (statuses.some((s) => s === "FAIL")) verdict = "FAIL(at-least-one-threshold-over-in-majority)";
  else verdict = "MIXED(some-windows-over-threshold)";
  summary.verdict = verdict;
  summary.verdict_note = "该 verdict 只描述「所测工况下的窗口分布」，不等于系统级性能结论；不得跨 N/跨事件率外推。";
  return summary;
}

// ---------------------------------------------------------------- 只读证明
function classifyRequests(requests) {
  // 只读口径：GET/HEAD 天然只读；POST /api/<rpc> 按「破坏性动词优先、其次只读词元」分类。
  const DESTRUCTIVE = /(delete|remove|destroy|purge|archive|drop|apply|\.set$|^set\.|\.write|write\.|rename|update|save)/i;
  const READ_TOKEN = /(list|get|read|describe|query|status|inventory|inspect|manifest|nodes|board|projections|summary|diagnose|probe|presets)/i;
  const SUSPICIOUS = /(create|move|send|interrupt|cancel|abort|resume|fork|steer|compact|sync)/i;
  const observed = [];
  const violations = [];
  const suspicious = [];
  const unclassified = [];
  const reads = [];
  for (const r of requests) {
    const entry = { method: r.method, url: r.url, rpc: r.rpc ?? null };
    observed.push(entry);
    if (r.method === "GET" || r.method === "HEAD" || r.method === "OPTIONS") continue;
    const rpc = r.rpc || "";
    if (r.url.includes("session.list")) continue; // 本探针自身的只读 RPC
    if (rpc && DESTRUCTIVE.test(rpc)) violations.push({ ...entry, why: "destructive-verb" });
    else if (rpc && READ_TOKEN.test(rpc)) reads.push(entry);
    else if (rpc && SUSPICIOUS.test(rpc)) suspicious.push({ ...entry, why: "suspicious-verb" });
    else unclassified.push({ ...entry, why: "unclassified-non-get" });
  }
  return {
    total_requests: observed.length,
    total_non_get: observed.filter((o) => !["GET", "HEAD", "OPTIONS"].includes(o.method)).length,
    reads_during_run: reads,
    violations,
    suspicious,
    unclassified,
    verdict:
      violations.length === 0 && suspicious.length === 0
        ? unclassified.length === 0
          ? "READ-ONLY-CONFIRMED"
          : "READ-ONLY-CONFIRMED(unclassified 请求需人工过目)"
        : violations.length === 0
          ? "READ-ONLY(但有 suspicious 请求，需人工确认)"
          : "MUTATION-DETECTED",
    sample: observed.slice(0, 30)
  };
}

// ---------------------------------------------------------------- 代码指纹
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

/** 客户端 bundle 指纹：before/after 必须一致才可做「同代码」配对。 */
async function bundleFingerprint() {
  const out = { boot_html_sha256: null, assets: [] };
  try {
    const res = await fetch(URL_, { redirect: "follow" });
    const html = await res.text();
    out.boot_html_status = res.status;
    out.boot_html_bytes = html.length;
    out.boot_html_sha256 = sha256(html);
    const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
      .map((m) => m[1])
      .filter((u) => /\.js(\?|$)/.test(u) && !/^https?:/.test(u));
    for (const ref of refs.slice(0, 40)) {
      try {
        const r = await fetch(new URL(ref, URL_).toString());
        const body = await r.text();
        out.assets.push({ ref, status: r.status, bytes: body.length, sha256: sha256(body) });
      } catch (e) {
        out.assets.push({ ref, error: String(e).slice(0, 100) });
      }
    }
    out.combined_sha256 = sha256(out.assets.map((a) => `${a.ref}:${a.sha256}`).join("|"));
  } catch (e) {
    out.error = String(e).slice(0, 160);
  }
  out.note = "boot HTML + 全部被引用 client .js 的 sha256；?rev= 查询参数本身也是指纹的一部分";
  return out;
}

// ---------------------------------------------------------------- 跨线浏览器独占锁
/**
 * 本机同时有多条线要用浏览器探针，并发跑会互相污染。纪律：
 *   启动任何浏览器**之前**用 mkdir 原子取得 .probe.lock；已存在则每 20–40s 重试，最长 30 min；
 *   锁内写 owner.txt（agent 名 / 持有进程 pid / 开始时间）；跑完 rmdir 释放。
 *   抢占**仅当**：锁存在 且 owner 开始时间 >25 min 且 owner 进程已不存在 —— 并在 artifact 记录。
 *   非浏览器工作不需要锁。
 * 未持锁的批次一律标 INCONCLUSIVE（artifact `framework.lock.acquired=false`）。
 */
const LOCK_DIR = process.env.PROBE_LOCK_DIR || "/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/.probe.lock";
const LOCK_WAIT_MS = Number(argOf("--lock-wait-ms", "1800000")); // 默认最长等 30 min
const LOCK_STALE_MS = 25 * 60 * 1000; // 25 min
const LOCK_DISABLED = argv.includes("--no-lock");
const LOCK_EVENTS = [];
let LOCK_HELD = false;

const nowIso = () => new Date().toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lockOwnerPath = () => join(LOCK_DIR, "owner.txt");

function readLockOwner() {
  try {
    const text = readFileSync(lockOwnerPath(), "utf8");
    // 各线的 owner.txt 字段命名不完全一致（`pid:` / `owner_pid:`），两种都认；
    // 但**不**认 `host_pid:`（那是被监控的 GUI 宿主，不是锁持有者）。
    const pid = Number((text.match(/^\s*(?:owner_)?pid\s*[:=]\s*(\d+)/mi) || [])[1]);
    const epoch = Number((text.match(/^started_epoch:\s*(\d+)/m) || [])[1]);
    return {
      text,
      pid: Number.isFinite(pid) ? pid : null,
      started_epoch: Number.isFinite(epoch) ? epoch : null,
      agent: (text.match(/^agent:\s*(.+)$/m) || [])[1] ?? null
    };
  } catch {
    return null;
  }
}
function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e && e.code === "EPERM"; // 存在但无权限 → 视为存活
  }
}
function writeOwner() {
  writeFileSync(
    lockOwnerPath(),
    [
      `agent: measure-hardening (DSH session ${process.env.DSH_SESSION_ID || "unknown"})`,
      `line: performance-measurement-framework-hardening`,
      `pid: ${process.pid}`,
      `cwd: ${process.cwd()}`,
      `host_pid: 1390375 (node dsh web; monitored, never restarted)`,
      `started_at: ${nowIso()}`,
      `started_epoch: ${Math.floor(Date.now() / 1000)}`,
      `expected_release: within ~6 min`,
      `purpose: read-only baseline windows (idle / settings-open / settings-dwell) under exclusive lock`
    ].join("\n") + "\n",
    "utf8"
  );
}
function releaseLock(reason) {
  if (!LOCK_HELD) return;
  LOCK_HELD = false;
  try {
    rmSync(lockOwnerPath(), { force: true });
  } catch {
    /* ignore */
  }
  try {
    rmdirSync(LOCK_DIR);
    LOCK_EVENTS.push({ at: nowIso(), event: "released", reason });
  } catch (e) {
    LOCK_EVENTS.push({ at: nowIso(), event: "release-failed", reason, error: String(e).slice(0, 120) });
  }
}
async function acquireLock() {
  if (LOCK_DISABLED) {
    LOCK_EVENTS.push({ at: nowIso(), event: "lock-disabled-by-flag" });
    return { acquired: false, mode: "disabled", note: "本轮显式 --no-lock：按纪律必须标 INCONCLUSIVE" };
  }
  const t0 = Date.now();
  let attempt = 0;
  while (true) {
    attempt += 1;
    try {
      mkdirSync(LOCK_DIR); // 原子
      writeOwner();
      LOCK_HELD = true;
      LOCK_EVENTS.push({ at: nowIso(), event: "acquired", attempt, waited_ms: Date.now() - t0, mode: "mkdir-atomic" });
      return { acquired: true, mode: "mkdir-atomic", attempt, waited_ms: Date.now() - t0 };
    } catch (e) {
      if (e.code !== "EEXIST") {
        LOCK_EVENTS.push({ at: nowIso(), event: "acquire-error", code: e.code, error: String(e).slice(0, 120) });
        throw e;
      }
    }
    const owner = readLockOwner();
    const ageMs = owner && owner.started_epoch ? Date.now() - owner.started_epoch * 1000 : null;
    // owner.txt 里没有 pid 字段时，存活状态是**未知**；未知一律**不抢占**（安全默认）。
    // 规则要求"owner 进程已不存在"，这必须是被证实的死亡，而不是"查不到"。
    const alive = owner && owner.pid ? pidAlive(owner.pid) : null;
    // 抢占：锁存在 且 owner 开始 >25min 且 owner 进程**已确认**不存在
    if (ageMs !== null && ageMs > LOCK_STALE_MS && alive === false) {
      LOCK_EVENTS.push({
        at: nowIso(),
        event: "preempting-stale-lock",
        rule: "lock exists && owner age >25min && owner pid not alive",
        owner_agent: owner.agent,
        owner_pid: owner.pid,
        owner_age_min: r3(ageMs / 60000)
      });
      try {
        rmSync(lockOwnerPath(), { force: true });
        rmdirSync(LOCK_DIR);
      } catch {
        /* 下一轮重试 */
      }
      continue;
    }
    const waited = Date.now() - t0;
    if (waited > LOCK_WAIT_MS) {
      LOCK_EVENTS.push({
        at: nowIso(),
        event: "lock-timeout",
        waited_ms: waited,
        owner_agent: owner && owner.agent,
        owner_pid: owner && owner.pid,
        owner_age_min: ageMs === null ? null : r3(ageMs / 60000),
        owner_pid_alive: alive,
        preempt_blocked_reason:
          alive === null ? "owner.txt 缺 pid 字段 → 存活未知 → 按安全默认不抢占" : ageMs === null ? "owner.txt 缺 started_epoch → 年龄未知 → 不抢占" : null
      });
      return {
        acquired: false,
        mode: "timeout",
        waited_ms: waited,
        owner: owner ? { agent: owner.agent, pid: owner.pid, started_epoch: owner.started_epoch } : null,
        owner_age_min: ageMs === null ? null : r3(ageMs / 60000),
        owner_pid_alive: alive
      };
    }
    const backoff = 20000 + Math.floor(Math.random() * 20001); // 20–40 s
    const step = Math.min(backoff, Math.max(LOCK_WAIT_MS - waited, 1000));
    LOCK_EVENTS.push({
      at: nowIso(),
      event: "waiting-for-lock",
      attempt,
      sleep_ms: step,
      owner_agent: owner && owner.agent,
      owner_pid: owner && owner.pid,
      owner_age_min: ageMs === null ? null : r3(ageMs / 60000),
      owner_pid_alive: alive
    });
    await sleep(step);
  }
}
process.on("exit", () => releaseLock("process-exit"));

/** 本进程当前打开着的浏览器会话（信号兜底时用来关掉它们，避免**孤儿浏览器**污染他线）。 */
const ACTIVE_SESSIONS = new Set();
let SHUTTING_DOWN = false;

/**
 * 信号兜底：SIGTERM/SIGINT/SIGHUP **不会**触发 'exit' 事件，只靠 'exit' 兜底会同时
 * ①泄漏锁（实测事故：他线持锁进程被 SIGTERM 后死亡，锁留在盘上直到 25 min 后才可能被抢占）
 * ②留下孤儿浏览器（他线文档记录过一次泄漏存活 24 分钟，会持续污染所有线）。
 * 因此这里：**先关浏览器 → 再释放锁 → 落盘已采数据 → 退出**，并设硬上限防挂死。
 */
async function gracefulShutdown(sig) {
  if (SHUTTING_DOWN) return;
  SHUTTING_DOWN = true;
  console.error(`[harden-measure] 收到 ${sig}：先关浏览器、再释放锁、并落盘已采数据`);
  for (const s of [...ACTIVE_SESSIONS]) {
    try {
      await Promise.race([s.browser.close(), sleep(4000)]);
    } catch {
      /* ignore */
    }
    ACTIVE_SESSIONS.delete(s);
  }
  releaseLock(`signal-${sig}`);
  if (ARTIFACT) {
    ARTIFACT.framework.signalled = sig;
    ARTIFACT.framework.lock = { ...(ARTIFACT.framework.lock || {}), events: LOCK_EVENTS };
  }
  finalizeAndExit(1, `signal-${sig}`);
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    const hard = setTimeout(() => process.exit(1), 9000);
    hard.unref?.();
    gracefulShutdown(sig).catch(() => process.exit(1));
  });
}

// ---------------------------------------------------------------- 每窗口并发实例普查
/**
 * 采集**该时刻**系统上的主浏览器实例数。ownInstances = 本探针自己开的浏览器数
 * （每个浏览器代 1 个）⇒ foreign = total - own。这就是"并发门禁"的输入。
 * 计数单位显式写明：`headless_shell --disable-field-trial-config` 只匹配主浏览器进程，
 * **不含** renderer/gpu/zygote 子进程；与他线按"chromium 全家族"计数不可混用。
 */
function concurrencyProbe(ownInstances) {
  if (CONCURRENCY_GATE === "off") return { gate: "off", sampled: false };
  const sh = (c) => {
    try {
      return execSync(c, { encoding: "utf8", timeout: 4000 }).trim();
    } catch {
      return null;
    }
  };
  const totalRaw = sh(`pgrep -fc "${BROWSER_PGREP}"`);
  const total = totalRaw === null ? null : Number(totalRaw);
  const pids = (sh(`pgrep -f "${BROWSER_PGREP}"`) || "").split(/\s+/).filter(Boolean);
  const foreign = total === null ? null : Math.max(total - ownInstances, 0);
  return {
    gate: CONCURRENCY_GATE,
    sampled: true,
    counter: `pgrep -fc "${BROWSER_PGREP}"`,
    unit: "主浏览器进程（不含 renderer/gpu/zygote 子进程）",
    total_browser_instances: total,
    own_instances: ownInstances,
    foreign_instances: foreign,
    foreign_pids_sample: pids.slice(0, 12),
    gate_passed: foreign === 0,
    at: nowIso()
  };
}

// ---------------------------------------------------------------- 环境负载（并发租户）
/** 记录测量当时机器上还有多少别的浏览器实例 / 负载——并发租户会直接污染测量。 */
function environmentSnapshot() {
  const sh = (c) => {
    try {
      return execSync(c, { encoding: "utf8", timeout: 4000 }).trim();
    } catch {
      return null;
    }
  };
  return {
    at: new Date().toISOString(),
    loadavg: sh("cat /proc/loadavg"),
    cpu_count: sh("nproc"),
    concurrent_browser_processes: sh('pgrep -fc "headless_shell --disable-field-trial-config"'),
    mem_used_mb: sh("free -m | awk '/Mem|内存/ {print $3}'"),
    note: "concurrent_browser_processes 含本探针自己；>1 说明有并发租户，测量窗口可能被外来负载污染"
  };
}

// ---------------------------------------------------------------- 宿主身份
let HOST_PID = null;
function hostIdentity() {
  const id = { boot_id: null, pid: null, starttime_ticks: null, cmdline: null };
  const sh = (c) => {
    try {
      return execSync(c, { encoding: "utf8", timeout: 4000 }).trim();
    } catch {
      return null;
    }
  };
  id.boot_id = sh("cat /proc/sys/kernel/random/boot_id");
  const pid = sh('pgrep -f "node .*dsh web" | head -1');
  id.pid = pid || null;
  HOST_PID = id.pid;
  if (pid) {
    const stat = sh(`cat /proc/${pid}/stat`);
    if (stat) {
      const after = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      id.starttime_ticks = after[19] ?? null; // field 22 overall
    }
    id.cmdline = sh(`tr '\\0' ' ' < /proc/${pid}/cmdline`);
  }
  return id;
}

// ---------------------------------------------------------------- main
let FINALIZED = false;
let ARTIFACT = null;
function finalizeAndExit(code, reason) {
  if (FINALIZED) return;
  FINALIZED = true;
  if (ARTIFACT) {
    ARTIFACT.framework.exit_code = code;
    ARTIFACT.framework.exit_code_meaning =
      "0=仅框架自检通过(不等于性能通过) / 2=存在 invalid 窗口或场景 INCONCLUSIVE 或指标超门槛 / 1=框架级 FATAL";
    ARTIFACT.framework.terminated_reason = reason;
    try {
      mkdirSync(dirname(OUT), { recursive: true });
      writeFileSync(OUT, JSON.stringify(ARTIFACT, null, 2));
      console.error(`[harden-measure] artifact → ${OUT}`);
    } catch (e) {
      console.error("[harden-measure] 落盘失败:", e?.message || e);
    }
  }
  process.exit(code);
}

async function main() {
  const tStarted = Date.now();
  globalThis.__pageErrors = [];
  ARTIFACT = {
    probe: "harden-measure",
    schema_version: 2,
    label: LABEL,
    generated_at: new Date().toISOString(),
    target: {
      url: URL_,
      node: process.version,
      playwright: (() => {
        try {
          return require("playwright/package.json").version;
        } catch {
          return null;
        }
      })(),
      host: hostIdentity(),
      viewport: "1440x900",
      headless: true,
      window_sec: WINDOW_SEC,
      n_per_scenario: N_PER_SCENARIO,
      warmup_sec: WARMUP_SEC
    },
    pre_registered: {
      thresholds: THRESHOLDS,
      min_valid_windows: MIN_VALID_WINDOWS,
      min_dom_nodes: MIN_DOM_NODES,
      min_raf_frames: MIN_RAF_FRAMES,
      envelope_contract: "{type:'server-request',rpcId,method,payload} ; payload.type 为分类键",
      ws_classification: "payload.type 规范划分（sum==total）；不复刻历史基线的子串关键词口径",
      mutation_scope: MUTATION_CHARDATA
        ? "document.body childList+subtree+characterData —— 仪表化扰动轮，不得与其他轮混入同一统计"
        : "document.body childList+subtree（默认）—— 本应用流式渲染为原地改文本节点，实测该口径每窗口仅 6~8 次，**不是 re-render 代理**",
      click_to_paint: "打开设置入口时记录 click→下一帧；样本量小，仅作参考，不构成 primary 终点",
      concurrency_gate: {
        mode: CONCURRENCY_GATE,
        rule: "采集前/后各断言一次『系统上的主浏览器实例数 - 自身实例数 == 0』；strict 模式下不为 0 即该窗口 invalid",
        counter: `pgrep -fc "${BROWSER_PGREP}"`,
        unit: "主浏览器进程（不含 renderer/gpu/zygote 子进程）",
        modes: { strict: "断言并把不满足的窗口标 invalid", record: "只记录不判 invalid", off: "不采样" },
        rationale: "锁是约定而非强制；必须用系统级读数自证独占，而不是假定持锁即独占"
      },
      scenarios: ["idle", "settings-open", "settings-dwell"],
      note: "门槛与场景在本探针内预注册，测量前固定；不得事后调整。",
      exclusive_lock: {
        dir: LOCK_DIR,
        acquire: "mkdir（原子）—— 必须在启动任何浏览器之前",
        retry: "每 20–40s，最长 30 min（--lock-wait-ms）",
        owner_file: "owner.txt（agent / pid / started_at / started_epoch）",
        release: "rmdir（浏览器全部关闭之后）",
        preempt: "仅当 锁存在 且 owner 开始 >25min 且 owner 进程已不存在；抢占写入 framework.lock.events",
        unlocked_batch: "未持锁批次的结论一律标 INCONCLUSIVE"
      }
    },
    framework: { self_check: {}, gates: {}, exit_code: null, exit_code_meaning: null, terminated_reason: null },
    scale_snapshot: null,
    windows: [],
    scenarios: {},
    invalid_runs: [],
    mutation_guard: null,
    limitations: [
      "无法人为制造可控流式负载：本探针只能观测自然发生的 session/event 流，无法固定事件率，因此跨 run 的「同事件率」配对只能事后筛选、不能事前保证。",
      "CDP 指标采用 node Date.now 与页面 performance.now 映射，含 offset_uncertainty_ms 级误差；CDP delta 不能在 common_interval 内重切（只有 rAF/WS/mutation 可精确重切）。",
      "N（session.list items）是快照量：本探针在每个窗口**结束后**（计时区间之外）采一次快照，窗口期间 N 仍可能变化。",
      "rAF 帧间隔在 headless 下由 CPU 合成器驱动，与有头/真实显示器刷新率不完全一致。",
      "mutation 默认只统计 document.body 的 childList+subtree（节点增删）。实测本应用流式渲染为原地改文本节点，该口径每窗口仅 6~8 次 ⇒ **mutation_count 不是 re-render / React commit 代理，禁止用作渲染成本证据**；要量化文本 churn 需 --mutation-chardata（扰动轮）。",
      "窗口级 p99 在 15s 窗口下只有约 9 个尾样本，不具备判定力；判定尾部请用 pooled_frames。",
      "跨线并发是主要污染源：必须持 .probe.lock 独占；未持锁批次的结论一律 INCONCLUSIVE（framework.lock.acquired 为 false 即为未持锁）。"
    ]
  };

  ARTIFACT.environment = { at_start: environmentSnapshot(), at_end: null };

  ARTIFACT.provenance = {
    probe_path: "probes/harden-measure.mjs",
    probe_sha256: sha256(readFileSync(new URL(import.meta.url), "utf8")),
    bundle: await bundleFingerprint(),
    note: "probe_sha256 + bundle.combined_sha256 是「同代码」配对的必要条件；二者任一变化即禁止直接配对比较"
  };

  // ---- 跨线独占锁：必须在**启动任何浏览器之前**取得（锁等待不计入 watchdog 预算）
  const lockResult = await acquireLock();
  ARTIFACT.framework.lock = { ...lockResult, events: LOCK_EVENTS, lock_dir: LOCK_DIR };
  if (!lockResult.acquired) {
    ARTIFACT.framework.self_check = { ok: false, failures: ["probe-lock-not-acquired"] };
    ARTIFACT.framework.verdict_override = "INCONCLUSIVE(no-exclusive-lock)";
    finalizeAndExit(1, lockResult.mode === "timeout" ? "lock-timeout" : "lock-disabled");
    return;
  }
  console.error(`[harden-measure] 已取得独占锁（等待 ${lockResult.waited_ms} ms，第 ${lockResult.attempt} 次尝试）`);

  const watchdog = setTimeout(() => {
    console.error(`[harden-measure] watchdog ${GLOBAL_BUDGET_MS}ms 触发`);
    if (ARTIFACT) ARTIFACT.framework.watchdog_fired = true;
    finalizeAndExit(1, "watchdog-timeout");
  }, GLOBAL_BUDGET_MS);

  // ---- 会话（浏览器实例）管理：串行独占；崩溃时**有界**重建并如实记录，绝不静默重试
  const LAUNCH_ARGS = [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding"
  ];
  const requests = [];
  const recoveryEvents = [];
  const sessions = [];
  let sessionGen = 0;

  async function newSession() {
    sessionGen += 1;
    const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const s = { gen: sessionGen, browser, ctx, page, alive: true, terminate_reason: null };
    ACTIVE_SESSIONS.add(s);
    sessions.push({ gen: s.gen, launched_at: new Date().toISOString() });
    browser.on("disconnected", () => {
      s.alive = false;
      s.terminate_reason = s.terminate_reason ?? "browser-disconnected";
      globalThis.__pageErrors.push(`session#${s.gen}:browser-disconnected`);
    });
    page.on("crash", () => {
      s.alive = false;
      s.terminate_reason = "page-crash";
      globalThis.__pageErrors.push(`session#${s.gen}:page-crash`);
    });
    page.on("close", () => {
      s.terminate_reason = s.terminate_reason ?? "page-closed";
    });
    page.on("request", (r) => {
      let rpc = null;
      try {
        const pd = r.postData();
        if (pd && pd.startsWith("{")) rpc = JSON.parse(pd)?.method ?? null;
      } catch {
        /* ignore */
      }
      requests.push({ gen: s.gen, method: r.method(), url: r.url().replace(URL_, ""), rpc });
    });
    page.on("pageerror", (e) => globalThis.__pageErrors.push(`session#${s.gen}:${String(e).slice(0, 200)}`));
    await page.addInitScript(INSTALL, { chardata: MUTATION_CHARDATA });
    await page.goto(URL_, { waitUntil: "domcontentloaded", timeout: T.goto });
    await withTimeout(page.waitForTimeout(WARMUP_SEC * 1000), WARMUP_SEC * 1000 + 20000, "session-warmup");
    s.cdp = await withTimeout(ctx.newCDPSession(page), T.cdp, "new-cdp-session");
    await withTimeout(s.cdp.send("Performance.enable"), T.cdp, "performance-enable");
    s.gate = await withTimeout(readyGate(page), T.ready + 30000, "ready-gate");
    return s;
  }

  async function closeSession(s) {
    if (!s) return;
    ACTIVE_SESSIONS.delete(s);
    s.alive = false;
    try {
      await withTimeout(s.browser.close(), T.close, "browser-close");
    } catch {
      /* 已经死了或关闭超时；不阻塞后续窗口 */
    }
  }

  const sRef = { s: null };
  sRef.s = await newSession();
  ARTIFACT.framework.gates.ready = sRef.s.gate;
  ARTIFACT.scale_snapshot = sRef.s.gate.evidence.rpc;
  if (!sRef.s.gate.ok) {
    ARTIFACT.framework.self_check = { ok: false, failures: sRef.s.gate.failures };
    ARTIFACT.framework.recovery_events = recoveryEvents;
    await closeSession(sRef.s);
    clearTimeout(watchdog);
    releaseLock("ready-gate-failed");
    ARTIFACT.framework.lock = { ...lockResult, events: LOCK_EVENTS, lock_dir: LOCK_DIR };
    finalizeAndExit(1, "ready-gate-failed:" + sRef.s.gate.failures.join(","));
    return;
  }

  const all = [];
  const push = (w) => {
    all.push(w);
    ARTIFACT.windows = all;
    if (!w.valid) {
      ARTIFACT.invalid_runs.push({
        phase: w.phase,
        index: w.index,
        reasons: w.invalid_reasons,
        metrics: w.metrics,
        page_state: w.page_state,
        page_generation: w.page_generation ?? null
      });
    }
  };

  /** 采一个窗口；若会话已死则重建（最多 3 次），全过程记入 recovery_events。 */
  async function sampleRecovering(phase, index, counted) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (!sRef.s || !sRef.s.alive) {
        recoveryEvents.push({ phase, index, attempt, at: new Date().toISOString(), reason: sRef.s?.terminate_reason ?? "session-dead", action: "relaunch" });
        await closeSession(sRef.s);
        try {
          const ns = await newSession();
          if (!ns.gate.ok) {
            recoveryEvents.push({ phase, index, attempt, reason: "relaunch-ready-gate-failed:" + ns.gate.failures.join(",") });
            sRef.s = ns;
            continue;
          }
          if (phase.startsWith("settings")) {
            const o = await openSettings(ns.page);
            ns.settings_reopened = o;
            if (!o.ok) recoveryEvents.push({ phase, index, attempt, reason: "settings-reopen-failed", detail: o });
          }
          sRef.s = ns;
        } catch (e) {
          recoveryEvents.push({ phase, index, attempt, reason: "relaunch-failed:" + String(e?.message || e).slice(0, 160) });
          continue;
        }
      }
      try {
        const w = await sampleWindow({ page: sRef.s.page, cdp: sRef.s.cdp, phase, index, counted, ownInstances: 1 });
        w.page_generation = sRef.s.gen;
        w.window_sec = WINDOW_SEC;
        // 窗口结束**之后**（计时区间外）采一次 N 快照；契约不满足即该窗口 invalid
        try {
          w.session_list = await rpcSessionList(sRef.s.page);
        } catch (e) {
          w.session_list = { ok: false, reason: "rpc-threw:" + String(e?.message || e).slice(0, 120) };
        }
        if (!w.session_list.ok) {
          w.valid = false;
          w.invalid_reasons = [...(w.invalid_reasons || []), "session-list-rpc-contract-violated"];
          w.metrics.n_items = null;
        } else {
          w.metrics.n_items = w.session_list.items;
          w.metrics.n_items_bytes = w.session_list.items_bytes;
        }
        return w;
      } catch (e) {
        const reason = String(e?.message || e).slice(0, 200);
        recoveryEvents.push({ phase, index, attempt, at: new Date().toISOString(), reason, generation: sRef.s.gen });
        sRef.s.alive = false;
        sRef.s.terminate_reason = sRef.s.terminate_reason ?? reason;
      }
    }
    return {
      phase,
      index,
      counted,
      valid: false,
      invalid_reasons: ["measurement-aborted-after-3-attempts"],
      metrics: {},
      counters: {},
      common_interval: null,
      page_state: {},
      ws_detail: { by_kind: {} },
      raf_intervals_ms: [],
      long_tasks: [],
      click_to_paint: [],
      activity_class: "unknown",
      page_generation: sRef.s?.gen ?? null,
      host_pid: HOST_PID,
      concurrency: null,
      session_list: { ok: false, reason: "window-aborted" }
    };
  }

  // 预热窗口（计数但不参与统计）
  push(await sampleRecovering("warmup", 0, false));

  // S1 idle
  for (let i = 0; i < N_PER_SCENARIO; i++) push(await sampleRecovering("idle", i, true));

  // 打开设置（只点入口）；若会话已死则重建后重试一次
  let openRes = await openSettings(sRef.s.page).catch((e) => ({ ok: false, reason: "open-threw:" + String(e?.message || e).slice(0, 120) }));
  if (!openRes.ok && !sRef.s.alive) {
    recoveryEvents.push({ phase: "settings-open", index: -1, attempt: 1, at: new Date().toISOString(), reason: "session-dead-before-settings-open", action: "relaunch" });
    await closeSession(sRef.s);
    try {
      const ns = await newSession();
      sRef.s = ns;
      if (ns.gate.ok) {
        openRes = await openSettings(ns.page).catch((e) => ({ ok: false, reason: "open-threw:" + String(e?.message || e).slice(0, 120) }));
      }
    } catch (e) {
      recoveryEvents.push({ phase: "settings-open", index: -1, attempt: 1, reason: "relaunch-failed:" + String(e?.message || e).slice(0, 160) });
    }
  }
  ARTIFACT.settings_open = openRes;
  if (openRes.ok) {
    for (let i = 0; i < N_PER_SCENARIO; i++) push(await sampleRecovering("settings-open", i, true));
    for (let i = 0; i < N_PER_SCENARIO; i++) push(await sampleRecovering("settings-dwell", i, true));
    try {
      await sRef.s.page.keyboard.press("Escape"); // 关闭面板（非刷新、非保存）
      await sRef.s.page.waitForTimeout(800);
    } catch {
      /* 关闭失败不影响只读采集 */
    }
  } else {
    ARTIFACT.framework.gates.settings_open = { ok: false, detail: openRes };
  }

  // 场景汇总
  for (const phase of ["idle", "settings-open", "settings-dwell"]) {
    const ws = all.filter((w) => w.phase === phase && w.counted);
    if (!ws.length) {
      ARTIFACT.scenarios[phase] = { windows_total: 0, verdict: "INCONCLUSIVE(scenario-not-reached)" };
      continue;
    }
    ARTIFACT.scenarios[phase] = summarizeScenario(ws, MIN_VALID_WINDOWS);
  }

  ARTIFACT.environment.at_end = environmentSnapshot();

  // ---- 强制免责声明（协调者要求，逐字）
  const allForeign = ARTIFACT.windows
    .map((w) => w.concurrency?.foreign_instances_max)
    .filter((v) => typeof v === "number");
  ARTIFACT.baseline_status = {
    status: "CONCURRENT-LOAD",
    usable_as_baseline: false,
    statement:
      "本次基线是在并发负载下采集（同一时刻机器上存在其他线/其他进程的浏览器实例，每窗口并发实例数见 windows[*].concurrency）。" +
      "因此**绝对值（ms、ms/s、fps、p95/p99、超门槛比例）不可当基线**，不得用于任何门槛判定或前后对比的百分比归因；" +
      "**只有协议（口径、门禁、复算方式）与相对指标（比值、为零、占比、同窗内配对差值）可用**。",
    concurrency_gate_mode: CONCURRENCY_GATE,
    host_pid: HOST_PID,
    windows_sampled: allForeign.length,
    windows_with_foreign: allForeign.filter((v) => v > 0).length,
    windows_exclusive: allForeign.filter((v) => v === 0).length,
    max_foreign_instances: allForeign.length ? Math.max(...allForeign) : null,
    counters: {
      browser_instances: `pgrep -fc "${BROWSER_PGREP}"`,
      unit: "主浏览器进程（不含 renderer/gpu/zygote 子进程）",
      caveat: "与他线按 chromium 全家族计数的数字**不可混用或互相印证**"
    }
  };
  ARTIFACT.mutation_guard = classifyRequests(requests);
  ARTIFACT.framework.recovery_events = recoveryEvents;
  ARTIFACT.framework.sessions = sessions;
  ARTIFACT.framework.browser_generations = sessionGen;
  ARTIFACT.framework.self_check = {
    ok: ARTIFACT.invalid_runs.length === 0 && ARTIFACT.mutation_guard.violations.length === 0 && recoveryEvents.length === 0,
    invalid_windows: ARTIFACT.invalid_runs.length,
    mutation_violations: ARTIFACT.mutation_guard.violations.length,
    recovery_events: recoveryEvents.length,
    browser_generations: sessionGen,
    duration_ms: Date.now() - tStarted
  };

  await closeSession(sRef.s);
  clearTimeout(watchdog);
  ARTIFACT.framework.watchdog_fired = false;

  // ---- 释放独占锁（浏览器已全部关闭）
  releaseLock("run-completed");
  ARTIFACT.framework.lock = { ...lockResult, released_at: nowIso(), events: LOCK_EVENTS, lock_dir: LOCK_DIR };
  console.error("[harden-measure] 已释放独占锁");

  const inconclusive = Object.values(ARTIFACT.scenarios).some((s) => String(s.verdict || "").startsWith("INCONCLUSIVE"));
  const anyOver = Object.values(ARTIFACT.scenarios).some((s) => Object.values(s.thresholds || {}).some((t) => t.status !== "PASS"));
  const code = ARTIFACT.framework.self_check.ok && !inconclusive && !anyOver ? 0 : 2;
  finalizeAndExit(code, "completed");
}

main().catch((e) => {
  console.error("[harden-measure] FATAL:", e?.stack || e?.message || e);
  finalizeAndExit(1, "exception:" + String(e?.message || e).slice(0, 200));
});
