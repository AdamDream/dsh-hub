#!/usr/bin/env node
// 读入 peer 的宿主 drift 原始 jsonl，给出「宿主事件循环延迟」随时间的分桶分布，
// 并与本线各窗口的闸门等待时间对齐，用于判定「未覆盖成本项 = 宿主侧拥堵」。
import fs from "node:fs";
const SRC = process.argv[2] || "/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/host-click/raw/host-drift-ambient.jsonl";
const rows = fs.readFileSync(SRC, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const q = (v, p) => { const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const t0 = Math.min(...rows.map((r) => r.t0));
const buck = new Map();
for (const r of rows) {
  const m = Math.floor((r.t0 - t0) / 60000);
  if (!buck.has(m)) buck.set(m, []);
  buck.get(m).push(r.ms);
}
const buckets = [...buck.entries()].sort((a, b) => a[0] - b[0]).map(([m, v]) => ({
  minute: m, n: v.length, p50: +q(v, 0.5).toFixed(1), p90: +q(v, 0.9).toFixed(1), p99: +q(v, 0.99).toFixed(1), max: +Math.max(...v).toFixed(1),
}));
const all = rows.map((r) => r.ms);
const out = {
  source: SRC, generatedAt: new Date().toISOString(), samples: rows.length, windowMinutes: buckets.length,
  overall: { p50: +q(all, 0.5).toFixed(1), p90: +q(all, 0.9).toFixed(1), p99: +q(all, 0.99).toFixed(1), max: +Math.max(...all).toFixed(1) },
  byEndpoint: {},
  buckets,
  note: "ms = 一次 HTTP 往返（端点返回 239B/287B，可忽略传输与载荷）⇒ 即宿主事件循环延迟的代理量",
};
for (const ep of new Set(rows.map((r) => r.endpoint))) {
  const v = rows.filter((r) => r.endpoint === ep).map((r) => r.ms);
  out.byEndpoint[ep] = { n: v.length, p50: +q(v, 0.5).toFixed(1), p90: +q(v, 0.9).toFixed(1), p99: +q(v, 0.99).toFixed(1), max: +Math.max(...v).toFixed(1) };
}
fs.mkdirSync(new URL("../raw/", import.meta.url).pathname, { recursive: true });
fs.writeFileSync(new URL("../raw/host-degrade.json", import.meta.url).pathname, JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify({ overall: out.overall, byEndpoint: out.byEndpoint, windowMinutes: out.windowMinutes }, null, 2));
console.log("\nminute  n    p50    p90     p99      max");
for (const b of buckets) console.log(`${String(b.minute).padStart(5)} ${String(b.n).padStart(4)} ${String(b.p50).padStart(6)} ${String(b.p90).padStart(6)} ${String(b.p99).padStart(7)} ${String(b.max).padStart(8)}`);
