#!/usr/bin/env node
// ============================================================================
// compare-live-endpoints.mjs — 重启后 /usage/* 应答与改前基线逐行比对（只读）
// ============================================================================
// 用途：宿主重启（A1/A2 生效）后，证明**所有查询输出逐行不变**，只有耗时变了。
//   node probes/compare-live-endpoints.mjs [--before reports/live-endpoints-before.json] [--port 3080]
// 退出码：0 = 全部一致；1 = 存在不一致（需人工核）。
// ============================================================================
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
const BEFORE = resolve(argOf("--before", "reports/live-endpoints-before.json"));
const PORT = Number(argOf("--port", "3080"));
const BASE = `http://127.0.0.1:${PORT}`;
let seq = 0;
async function rpc(path, method, payload) {
	const body = { type: "client-request", rpcId: `cmp-${++seq}`, method, payload };
	const r = await fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
	return (await r.json()).result;
}
const now = Date.now();
const before = JSON.parse(readFileSync(BEFORE, "utf8"));
const calls = {
	"heatmap(year=2026)": () => rpc("/usage/heatmap", "heatmap", { year: 2026, dataSources: "all" }),
	"heatmap(year=2025)": () => rpc("/usage/heatmap", "heatmap", { year: 2025, dataSources: "all" }),
	"heatmap(year=2026,ds=dsh)": () => rpc("/usage/heatmap", "heatmap", { year: 2026, dataSources: "dsh" }),
	"heatmap(year=2026,ds=cc)": () => rpc("/usage/heatmap", "heatmap", { year: 2026, dataSources: "cc" }),
	"summary(30d)": () => rpc("/usage/summary", "summary", { from: now - 30 * 86400000, to: now, dataSources: "all" }),
	"byDay(30d)": () => rpc("/usage/byDay", "byDay", { from: now - 30 * 86400000, to: now, dataSources: "all" }),
	"byModel(30d)": () => rpc("/usage/byModel", "byModel", { from: now - 30 * 86400000, to: now, dataSources: "all" }),
	"byProject(30d)": () => rpc("/usage/byProject", "byProject", { from: now - 30 * 86400000, to: now, dataSources: "all" }),
	"timeseries(day,30d)": () => rpc("/usage/timeseries", "timeseries", { granularity: "day", from: now - 30 * 86400000, to: now, dataSources: "all" }),
};
let fails = 0;
for (const [key, fn] of Object.entries(calls)) {
	const prev = before.calls[key];
	if (!prev) { console.log(`[SKIP] ${key}：基线缺失`); continue; }
	const cur = await fn();
	const same = JSON.stringify(cur?.value ?? null) === JSON.stringify(prev?.value ?? null);
	if (!same) fails += 1;
	console.log(`[${same ? "PASS" : "FAIL"}] ${key.padEnd(28)} 逐行一致=${same}`);
	if (!same) {
		const a = JSON.stringify(prev?.value) ?? "null";
		const b = JSON.stringify(cur?.value) ?? "null";
		console.log(`        改前=${a.slice(0, 200)}`);
		console.log(`        改后=${b.slice(0, 200)}`);
	}
}
console.log(`[summary] ${fails === 0 ? "全部一致（只有耗时变了）" : `${fails} 项不一致`}`);
// 附：单发耗时（用于报告）
for (const [key, fn] of Object.entries(calls)) {
	const t0 = performance.now();
	await fn();
	console.log(`[timing] ${key.padEnd(28)} ${(performance.now() - t0).toFixed(1)}ms`);
}
process.exit(fails === 0 ? 0 : 1);
