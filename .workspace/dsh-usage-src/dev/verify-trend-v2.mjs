// 2026-09-18 hourly-trend redesign — self-check.
//
// Two families of checks, both against the REAL sources:
//   1. INLINE PARITY — every geometry helper must behave identically in
//      lib/charts.js (source of truth, ESM) and in the hand-inlined copy inside
//      lib/client.js (the "charts.js 内联" convention). Both sides are loaded by
//      extracting the function source and evaluating it, so this catches drift
//      rather than style differences.
//   2. GEOMETRY INVARIANTS — the properties the redesign actually promises:
//      monotone cubic never overshoots its samples, hour buckets are filled to a
//      dense run, the 3-hour roll-up sums (and marks partial groups), tick
//      spacing cannot collide, and labels reflect the bucket granularity.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadChartsModule } from "./charts-loader.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const chartsSrc = readFileSync(join(root, "lib", "charts.js"), "utf8");
const clientSrc = readFileSync(join(root, "lib", "client.js"), "utf8");
const charts = loadChartsModule(chartsSrc);
const inline = loadChartsModule(clientSrc);

let failures = 0;
let checks = 0;
const ok = (label, pass, detail = "") => {
	checks += 1;
	if (!pass) failures += 1;
	console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
};
const same = (label, a, b) => {
	const ja = JSON.stringify(a);
	const jb = JSON.stringify(b);
	ok(label, ja === jb, ja === jb ? "" : `charts=${ja.slice(0, 160)} inline=${jb.slice(0, 160)}`);
};

// --- 1. inline parity ------------------------------------------------------
const seriesBattery = [
	[],
	[{ day: "2026-09-17", value: 0 }],
	[{ day: "2026-09-17", value: 5 }],
	[{ day: "2026-09-11", value: 10 }, { day: "2026-09-12", value: 0 }, { day: "2026-09-13", value: 900 }],
	Array.from({ length: 57 }, (_, i) => ({ day: `2026-09-${String(11 + Math.floor(i / 24)).padStart(2, "0")} ${String(i % 24).padStart(2, "0")}`, value: (i * 37) % 5000 })),
];
for (const [i, series] of seriesBattery.entries()) {
	for (const w of [560, 320]) {
		same(`scaleArea #${i} w=${w}`, charts.scaleArea(series, w, 150), inline.scaleArea(series, w, 150));
		same(`scaleBars #${i} w=${w}`, charts.scaleBars(series, w, 150), inline.scaleBars(series, w, 150));
		const ca = charts.scaleArea(series, w, 150);
		const ia = inline.scaleArea(series, w, 150);
		same(`smoothAreaPath #${i} w=${w}`, charts.smoothAreaPath(ca.points, w, 150), inline.smoothAreaPath(ia.points, w, 150));
		same(`areaPath #${i} w=${w}`, charts.areaPath(ca.points, w, 150), inline.areaPath(ia.points, w, 150));
	}
}
for (const [low, high, t] of [["#f5c451", "#f08a3c", 0], ["#f5c451", "#f08a3c", 0.5], ["#f5c451", "#f08a3c", 1], ["bad", "#f08a3c", 0.5], ["#f5c451", "#f08a3c", -3]]) {
	same(`mixHex ${low}/${high}/${t}`, charts.mixHex(low, high, t), inline.mixHex(low, high, t));
}
for (const key of ["2026-09-17", "2026-09-17 19", "2026-09-17 00", "short", ""]) {
	same(`bucketLabel ${JSON.stringify(key)}`, charts.bucketLabel(key), inline.bucketLabel(key));
}
const hourRows = [
	{ day: "2026-09-17 10", requests: 1, input_tokens: 10, output_tokens: 1, cache_read_tokens: 100, cache_write_tokens: 0 },
	{ day: "2026-09-17 12", requests: 2, input_tokens: 20, output_tokens: 2, cache_read_tokens: 200, cache_write_tokens: 0 },
];
const from = new Date(2026, 8, 17, 10, 0, 0).getTime();
const to = new Date(2026, 8, 17, 14, 30, 0).getTime();
same("fillBuckets hour", charts.fillBuckets(hourRows, { granularity: "hour", from, to }), inline.fillBuckets(hourRows, { granularity: "hour", from, to }));
same("fillBuckets day", charts.fillBuckets(hourRows, { granularity: "day", from, to }), inline.fillBuckets(hourRows, { granularity: "day", from, to }));
const dense = charts.fillBuckets(hourRows, { granularity: "hour", from, to });
same("rollupBuckets 3", charts.rollupBuckets(dense, 3), inline.rollupBuckets(dense, 3));
same("rollupBuckets 1", charts.rollupBuckets(dense, 1), inline.rollupBuckets(dense, 1));

// --- 2. geometry invariants ------------------------------------------------
const winFrom = new Date(2026, 8, 11, 10).getTime();
const winTo = new Date(2026, 8, 18, 10).getTime();
const fullWindow = charts.fillBuckets([], { granularity: "hour", from: winFrom, to: winTo });
ok("fillBuckets 空输入也生成连续窗口（7 天 + 1 小时 = 169）", fullWindow.length === 169, `实际 ${fullWindow.length}`);
ok("fillBuckets 零行形状完整", fullWindow.every((r) => typeof r.day === "string" && r.requests === 0 && r.input_tokens === 0 && r.cache_write_tokens === 0));
// Sparse feed: every third hour carries usage → the fill must restore the run.
const sparseRows = fullWindow
	.filter((_, i) => i % 3 === 0)
	.map((r, i) => ({ ...r, requests: i, input_tokens: i * 100, output_tokens: i * 10, cache_read_tokens: i * 1000 }));
const dense169 = charts.fillBuckets(sparseRows, { granularity: "hour", from: winFrom, to: winTo });
ok("fillBuckets 稀疏输入 → 仍补齐 169 个连续小时", dense169.length === 169, `实际 ${dense169.length}`);
ok("fillBuckets 空桶补 0", dense169.filter((r) => r.input_tokens === 0).length > 0);
const rolled = charts.rollupBuckets(dense169, 3);
ok("rollupBuckets 3 小时 → 57 桶", rolled.length === 57, `实际 ${rolled.length}`);
ok("rollupBuckets 末桶标记部分（hours 字段）", rolled[rolled.length - 1].hours === 1, `末桶 hours=${rolled[rolled.length - 1].hours}`);
const sumBefore = dense169.reduce((a, r) => a + r.input_tokens, 0);
const sumAfter = rolled.reduce((a, r) => a + r.input_tokens, 0);
ok("rollupBuckets 求和守恒（input_tokens）", sumBefore === sumAfter, `${sumBefore} vs ${sumAfter}`);

const spiky = Array.from({ length: 57 }, (_, i) => ({ day: `h${i}`, value: i % 7 === 0 ? 4000 : (i % 3 === 0 ? 120 : 0) }));
const scaled = charts.scaleArea(spiky, 560, 150);
const geom = charts.smoothAreaPath(scaled.points, 560, 150);
let worst = 0;
let prev = scaled.points[0];
for (const cmd of geom.line.match(/[MC][^MC]+/g)) {
	if (cmd[0] === "M") continue;
	const n = cmd.slice(1).trim().split(/[ ,]+/).map(Number);
	const y0 = prev.y;
	const y1 = n[5];
	for (let s = 1; s <= 48; s += 1) {
		const t = s / 48;
		const mt = 1 - t;
		const y = mt ** 3 * y0 + 3 * mt ** 2 * t * n[1] + 3 * mt * t ** 2 * n[3] + t ** 3 * y1;
		worst = Math.max(worst, Math.max(0, Math.min(y0, y1) - y), Math.max(0, y - Math.max(y0, y1)));
	}
	prev = { x: n[4], y: n[5] };
}
ok("smoothAreaPath 无过冲（≤0.01px）", worst < 0.01, `最大过冲 ${worst.toFixed(4)}px`);
ok("smoothAreaPath 段数 = 点数-1", (geom.line.match(/C/g) || []).length === spiky.length - 1);
ok("smoothAreaPath 面积路径闭合到基线", geom.area.endsWith("L0,150 Z") || /L[\d.]+,150 L[\d.]+,150 Z$/.test(geom.area), geom.area.slice(-40));
ok("smoothAreaPath 点数<3 时退化为直线", charts.smoothAreaPath([{ x: 0, y: 10 }, { x: 5, y: 20 }], 10, 150).line === "M0,10 L5,20");

const wide = charts.scaleArea(Array.from({ length: 169 }, (_, i) => ({ day: `h${i}`, value: i })), 560, 150);
const xs = wide.ticks.map((t) => t.x);
const gaps = xs.slice(1).map((x, i) => x - xs[i]);
ok("刻度不拥挤（最小间距 ≥ 60% 步长）", Math.min(...gaps) >= 14, `最小间距 ${Math.min(...gaps)}`);
ok("刻度带 index 字段（渲染层据此定位）", wide.ticks.every((t) => Number.isInteger(t.index)));
ok("刻度末位可落在边缘（供 anchor 判定）", xs[xs.length - 1] <= 560);

console.log(`\n${checks - failures}/${checks} 通过${failures ? `，${failures} 失败` : ""}`);
process.exit(failures ? 1 : 0);
