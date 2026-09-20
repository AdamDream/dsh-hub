import { writeFileSync } from "node:fs";
const BASE = "http://127.0.0.1:3080";
let seq = 0;
async function rpc(path, method, payload) {
  const body = { type: "client-request", rpcId: `cap-${++seq}`, method, payload };
  const r = await fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  return j.result;
}
const now = Date.now();
const out = { at: new Date().toISOString(), note: "宿主进程未重启时的 /usage/* 原始应答（改前基线）", calls: {} };
out.calls["heatmap(year=2026)"] = await rpc("/usage/heatmap", "heatmap", { year: 2026, dataSources: "all" });
out.calls["heatmap(year=2025)"] = await rpc("/usage/heatmap", "heatmap", { year: 2025, dataSources: "all" });
out.calls["heatmap(year=2026,ds=dsh)"] = await rpc("/usage/heatmap", "heatmap", { year: 2026, dataSources: "dsh" });
out.calls["heatmap(year=2026,ds=cc)"] = await rpc("/usage/heatmap", "heatmap", { year: 2026, dataSources: "cc" });
out.calls["summary(30d)"] = await rpc("/usage/summary", "summary", { from: now - 30 * 86400000, to: now, dataSources: "all" });
out.calls["byDay(30d)"] = await rpc("/usage/byDay", "byDay", { from: now - 30 * 86400000, to: now, dataSources: "all" });
out.calls["byModel(30d)"] = await rpc("/usage/byModel", "byModel", { from: now - 30 * 86400000, to: now, dataSources: "all" });
out.calls["byProject(30d)"] = await rpc("/usage/byProject", "byProject", { from: now - 30 * 86400000, to: now, dataSources: "all" });
out.calls["timeseries(day,30d)"] = await rpc("/usage/timeseries", "timeseries", { granularity: "day", from: now - 30 * 86400000, to: now, dataSources: "all" });
out.calls["timeseries(hour,24h)"] = await rpc("/usage/timeseries", "timeseries", { granularity: "hour", from: now - 86400000, to: now, dataSources: "all" });
out.calls["status"] = await rpc("/usage/status", "status", {});
writeFileSync("reports/live-endpoints-before.json", JSON.stringify(out, null, 2) + "\n", "utf8");
for (const [k, v] of Object.entries(out.calls)) {
  console.log(`${k.padEnd(28)} ok=${v?.ok} rows=${Array.isArray(v?.value) ? v.value.length : typeof v?.value}`);
}
console.log("已写出 reports/live-endpoints-before.json");
