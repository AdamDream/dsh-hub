#!/usr/bin/env node
/**
 * incident2/regression — 汇总分析器
 *
 * 读 raw/firstopen-*.json（单窗口器械 firstopen-ab.mjs 与批量器械 firstopen-batch.mjs 的产物格式一致），
 * 按 condition 分组，给出：stub 自证、路径可达性、成本指标中位数、相对 base 的降幅/升幅、判定。
 *
 * 判定规则（先证伪器械，再谈差异）：
 *   · 任何窗口 gate != EXCLUSIVE / exclusiveThroughout=false  ⇒ 该窗口 INCONCLUSIVE（仍计入但标注）
 *   · stub.effective !== true                                  ⇒ 该条件 INCONCLUSIVE（stub 未自证）
 *   · 条件 A 相对 base 的中位差 < 10% 且区间重叠                 ⇒ FAIL（该靶点在这条路径上无可测贡献）
 *   · 中位差 >= 10% 且区间不重叠                                 ⇒ PASS（有可测贡献，方向按符号解释）
 */
import fs from "node:fs";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname).replace(/\/tools$/, "");
const RAW = path.join(HERE, "raw");
const files = fs.readdirSync(RAW).filter((f) => /^firstopen-.*\.json$/.test(f)).map((f) => path.join(RAW, f));
const MED = (v) => { if (!v.length) return null; const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 1000) / 1000; };
const RANGE = (v) => (v.length ? [Math.min(...v), Math.max(...v)] : [null, null]);
const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);
const pick = (o, p) => { let c = o; for (const k of p) { if (c == null) return null; c = c[k]; } return num(c); };

const METRICS = [
  ["msToVisible", ["overlay", "msToVisible"], "点设置→面板可见 (ms)"],
  ["clickWallMs", ["nav", "clickWallMs"], "点击调用墙钟 (ms)"],
  ["clickScriptMsPerS", ["phaseClick", "ScriptMsPerS"], "点击相位脚本 ms/s"],
  ["clickRecalcMsPerS", ["phaseClick", "RecalcMsPerS"], "点击相位样式重算 ms/s"],
  ["clickTaskMsPerS", ["phaseClick", "TaskMsPerS"], "点击相位任务占用 ms/s"],
  ["taskBusyPct", ["taskBusyPct"], "点击窗口主线程占用 %"],
  ["rafP99", ["rafClick", "p99"], "rAF 间隔 p99 (ms)"],
  ["rafOver50", ["rafClick", "over50"], "rAF >50ms 帧数"],
  ["ltMax", ["longtasks", "maxMs"], "最长长任务 (ms)"],
  ["ltN", ["longtasks", "n"], "长任务数"],
  ["mountScriptMs", ["phaseMount", "ScriptDuration"], "首挂载脚本 (ms)"],
  ["mountRecalcMs", ["phaseMount", "RecalcStyleDuration"], "首挂载样式重算 (ms)"],
  ["mountRecalcCount", ["phaseMount", "RecalcStyleCount"], "首挂载重算次数"],
];

const groups = new Map();
const skipped = [];
for (const f of files) {
  let d;
  try { d = JSON.parse(fs.readFileSync(f, "utf8")); } catch { continue; }
  if (!d.cond || !d.nav) continue;                    // 聚合文件 / 分析文件
  if (/smoke|probe|p2ac-base|p2ac-old/.test(path.basename(f)) && !/_b3/.test(f)) {
    // 早期 smoke 与 subagent 的 p2ac 窗口单独归组，避免混入口径
  }
  const g = groups.get(d.cond) || [];
  g.push({ file: path.basename(f), ...d });
  groups.set(d.cond, g);
}

const summary = { generatedAt: new Date().toISOString(), metrics: METRICS.map((m) => m[2]), conditions: {}, verdicts: {}, notes: [] };

function condStats(cond) {
  const ws = groups.get(cond) || [];
  const accepted = ws.filter((w) => w.concurrency && w.concurrency.gateOutcome === "EXCLUSIVE");
  const out = { windows: ws.length, accepted: accepted.length, labels: ws.map((w) => w.label), stubEffective: ws.filter((w) => w.stub && w.stub.effective === true).length, metrics: {} };
  for (const [key, p] of METRICS) {
    const all = ws.map((w) => pick(w, p)).filter((x) => x !== null);
    const acc = accepted.map((w) => pick(w, p)).filter((x) => x !== null);
    out.metrics[key] = { allMedian: MED(all), allRange: RANGE(all), acceptedMedian: MED(acc), acceptedRange: RANGE(acc), n: all.length };
  }
  // 路径可达性并集（任一窗口观测到即算可达）
  const pr = {};
  for (const w of ws) {
    const r = (w.stub && w.stub.pathReachableClick) || null;
    if (!r) continue;
    for (const k of Object.keys(r)) pr[k] = (pr[k] || 0) + (r[k] === true ? 1 : 0);
  }
  out.pathReachableClickAnyWindow = pr;
  // route 改写命中
  out.routeHits = ws.map((w) => (w.stub && w.stub.routeHits) || null).filter(Boolean);
  // HTTP 观测：把所有窗口的端点并入，取 max 的最大值
  const ep = {};
  for (const w of ws) {
    for (const [k, v] of Object.entries(w.http || {})) {
      const e = ep[k] || (ep[k] = { n: 0, maxMs: 0, worst: null, perWindowMax: [] });
      e.n += v.n || 0; e.perWindowMax.push(v.max || 0);
      if ((v.max || 0) > e.maxMs) { e.maxMs = v.max || 0; e.worst = v.worstDetail || v.detail || null; }
    }
  }
  out.httpEndpoints = ep;
  return out;
}

for (const cond of groups.keys()) summary.conditions[cond] = condStats(cond);

const base = summary.conditions.base || null;
for (const cond of groups.keys()) {
  if (cond === "base") { summary.verdicts[cond] = { verdict: "REFERENCE", reason: ["对照组"] }; continue; }
  const c = summary.conditions[cond];
  const v = { verdict: null, reason: [], deltas: {} };
  if (!base) { v.verdict = "INCONCLUSIVE"; v.reason.push("无 base 组"); summary.verdicts[cond] = v; continue; }
  if (c.stubEffective === 0) v.reason.push(`stub 未自证生效（0/${c.windows} 窗口 effective=true）`);
  if (c.accepted < c.windows) v.reason.push(`有 ${c.windows - c.accepted} 个窗口非 EXCLUSIVE`);
  for (const [key, p, label] of METRICS) {
    const bm = base.metrics[key].acceptedMedian, cm = c.metrics[key].acceptedMedian;
    if (bm === null || cm === null || bm === 0) { v.deltas[key] = { base: bm, cond: cm, pct: null }; continue; }
    v.deltas[key] = { base: bm, cond: cm, pct: Math.round(((cm - bm) / bm) * 1000) / 10, label };
  }
  const key = "msToVisible";
  const d = v.deltas[key];
  const overlap = (() => {
    const a = base.metrics[key].acceptedRange, b = c.metrics[key].acceptedRange;
    if (!a[0] || !b[0]) return null;
    return !(a[1] < b[0] || b[1] < a[0]);
  })();
  if (c.stubEffective === 0) v.verdict = "INCONCLUSIVE";
  else if (d.pct === null) v.verdict = "INCONCLUSIVE";
  else if (Math.abs(d.pct) < 10 && overlap !== false) v.verdict = "FAIL";
  else v.verdict = "PASS";
  v.keyMetric = { name: key, ...d, rangeOverlap: overlap };
  summary.verdicts[cond] = v;
}

fs.writeFileSync(path.join(RAW, "analysis.json"), JSON.stringify(summary, null, 2) + "\n");

// ---- 控制台报告 -------------------------------------------------------------
const pad = (s, n) => String(s == null ? "-" : s).padEnd(n);
console.log(`conditions: ${[...groups.keys()].join(", ")}\n`);
console.log(pad("condition", 16) + pad("win", 5) + pad("acc", 5) + pad("stubEff", 9) + METRICS.map((m) => pad(m[0].slice(0, 12), 14)).join(""));
for (const cond of groups.keys()) {
  const c = summary.conditions[cond];
  console.log(pad(cond, 16) + pad(c.windows, 5) + pad(c.accepted, 5) + pad(`${c.stubEffective}/${c.windows}`, 9) +
    METRICS.map((m) => pad(c.metrics[m[0]].acceptedMedian, 14)).join(""));
}
console.log("\n--- 判定 ---");
for (const [cond, v] of Object.entries(summary.verdicts)) {
  console.log(`${pad(cond, 16)} ${pad(v.verdict, 14)} ${v.keyMetric ? `msToVisible base=${v.keyMetric.base} cond=${v.keyMetric.cond} Δ=${v.keyMetric.pct}% overlap=${v.keyMetric.rangeOverlap}` : ""} ${v.reason.join("; ")}`);
}
console.log("\n--- 路径可达性（点击相位，任一窗口为真计数）---");
for (const cond of groups.keys()) console.log(pad(cond, 16) + JSON.stringify(summary.conditions[cond].pathReachableClickAnyWindow));
console.log("\n--- HTTP 端点（跨窗口）---");
for (const cond of groups.keys()) {
  const e = summary.conditions[cond].httpEndpoints;
  const top = Object.entries(e).sort((a, b) => b[1].maxMs - a[1].maxMs).slice(0, 4);
  console.log(pad(cond, 16) + top.map(([k, v2]) => `${k} n=${v2.n} max=${Math.round(v2.maxMs)} worst=${JSON.stringify(v2.worst)}`).join(" | "));
}
console.log(`\nwrote raw/analysis.json`);
