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
	// Key ORDER is not semantics: compare a canonical (sorted-key) rendering so a
	// cosmetic reordering cannot masquerade as drift, while any value or shape
	// difference still fails.
	const canon = (value) => JSON.stringify(value, (key, item) => (
		item && typeof item === "object" && !Array.isArray(item)
			? Object.fromEntries(Object.keys(item).sort().map((k) => [k, item[k]]))
			: item
	));
	const ja = canon(a);
	const jb = canon(b);
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
		// 2026-09-18b: the tick overrides must behave identically on both sides too.
		same(`scaleArea #${i} w=${w} tickEvery=1`, charts.scaleArea(series, w, 150, { tickEvery: 1, tickFormatter: charts.hourTickLabel }), inline.scaleArea(series, w, 150, { tickEvery: 1, tickFormatter: inline.hourTickLabel }));
		same(`scaleBars #${i} w=${w} tickEvery=1`, charts.scaleBars(series, w, 150, { tickEvery: 1, tickFormatter: charts.hourTickLabel }), inline.scaleBars(series, w, 150, { tickEvery: 1, tickFormatter: inline.hourTickLabel }));
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

// --- 2026-09-18 regression: an empty input must stay EMPTY -------------------
// The first revision synthesised a dense zero window from an empty input. That
// looked harmless and even got its own assertion here — but it fabricated
// "0 tokens" for every point of the trend chart (57 zero buckets with hour
// labels) whenever the host refused the `hour` granularity, and it defeated the
// caller's "no data → fall back to daily" test because a filled array is never
// empty. This case now guards the opposite direction.
const emptyFill = charts.fillBuckets([], { granularity: "hour", from: winFrom, to: winTo });
ok("fillBuckets 空输入 → 空返回（不合成零窗口）", emptyFill.length === 0, `实际 ${emptyFill.length}`);
const emptyDayFill = charts.fillBuckets([], { granularity: "day", from: winFrom, to: winTo });
ok("fillBuckets 空输入（day）→ 空返回", emptyDayFill.length === 0, `实际 ${emptyDayFill.length}`);

// Expected window built independently of the implementation under test.
const denseKeys = [];
{
	let cursor = new Date(winFrom);
	cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), cursor.getHours());
	while (cursor.getTime() <= winTo) {
		denseKeys.push(
			`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")} `
			+ String(cursor.getHours()).padStart(2, "0"),
		);
		cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), cursor.getHours() + 1);
	}
}
ok("测试自建窗口 = 169 小时（7 天 + 1 小时）", denseKeys.length === 169, `实际 ${denseKeys.length}`);

// Wrong key shape (day keys answered for an `hour` request) must not be turned
// into a wall of fabricated zeros — keep the caller's rows.
const dayKeyed = [{ day: "2026-09-17", requests: 3, input_tokens: 30, output_tokens: 3, cache_read_tokens: 300, cache_write_tokens: 0 }];
const wrongShape = charts.fillBuckets(dayKeyed, { granularity: "hour", from: winFrom, to: winTo });
ok(
	"fillBuckets 键形不匹配（day 键 × hour 粒度）→ 原样返回真实行",
	wrongShape.length === 1 && wrongShape[0].input_tokens === 30,
	`实际 length=${wrongShape.length} input=${wrongShape[0] && wrongShape[0].input_tokens}`,
);

// Sparse feed: every third hour carries usage → the fill must restore the run.
const sparseRows = denseKeys
	.filter((_, i) => i % 3 === 0)
	.map((day, i) => ({ day, requests: i, input_tokens: i * 100, output_tokens: i * 10, cache_read_tokens: i * 1000, cache_write_tokens: 0 }));
const dense169 = charts.fillBuckets(sparseRows, { granularity: "hour", from: winFrom, to: winTo });
ok("fillBuckets 稀疏输入（键形匹配）→ 补齐 169 个连续小时", dense169.length === 169, `实际 ${dense169.length}`);
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

// --- 3. 2026-09-18b: the 24h intraday gear --------------------------------
// Window: 04:00 → next 04:00 local, and a reference instant exactly ON the
// boundary belongs to the window that STARTS there (that is what makes the
// date picker pick that date's own window).
const at = (y, m, d, hh, mm = 0) => new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
const w1 = charts.usageDayWindow(at(2026, 9, 18, 11, 57));
ok("usageDayWindow(11:57) → 今日 04:00 起", new Date(w1.from).getHours() === 4 && new Date(w1.from).getDate() === 18, JSON.stringify(w1));
ok("usageDayWindow 窗口长度 = 24h", w1.to - w1.from === 24 * 3600000, `${(w1.to - w1.from) / 3600000}h`);
const w2 = charts.usageDayWindow(at(2026, 9, 18, 2, 30));
ok("usageDayWindow(02:30) → 归属前一天 04:00 窗口", new Date(w2.from).getDate() === 17 && new Date(w2.from).getHours() === 4, JSON.stringify(w2));
const w3 = charts.usageDayWindow(at(2026, 9, 18, 4, 0));
ok("边界瞬间 04:00 归属于「从此开始」的窗口（日期选择器依赖）", w3.from === at(2026, 9, 18, 4, 0), JSON.stringify(w3));
same("usageDayWindow 内联一致性", charts.usageDayWindow(at(2026, 9, 18, 11, 57)), inline.usageDayWindow(at(2026, 9, 18, 11, 57)));

ok("hourTickLabel('2026-09-18 14') = '14'", charts.hourTickLabel("2026-09-18 14") === "14");
ok("hourTickLabel('2026-09-18 04') = '04'（保留前导零）", charts.hourTickLabel("2026-09-18 04") === "04");
ok("hourTickLabel 对日键退化为 bucketLabel", charts.hourTickLabel("2026-09-18") === "09-18");
same("hourTickLabel 内联一致性", charts.hourTickLabel("2026-09-18 23"), inline.hourTickLabel("2026-09-18 23"));

// A past window: 04:00 → 04:00 filled to `to - 1` = exactly 24 hourly buckets.
const past = { from: at(2026, 9, 16, 4), to: at(2026, 9, 17, 4) };
const pastKeys = [];
{
	let cursor = new Date(past.from);
	while (cursor.getTime() <= past.to - 1) {
		pastKeys.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")} ${String(cursor.getHours()).padStart(2, "0")}`);
		cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), cursor.getHours() + 1);
	}
}
ok("一个完整 04:00–04:00 窗口 = 24 个小时桶", pastKeys.length === 24, `实际 ${pastKeys.length}`);
ok("首/末桶 = 当天 04:00 / 次日 03:00", pastKeys[0].endsWith(" 04") && pastKeys[23].endsWith(" 03"), `${pastKeys[0]} … ${pastKeys[23]}`);
const pastSparse = pastKeys.filter((_, i) => i % 4 === 0).map((day, i) => ({ day, requests: i, input_tokens: i * 5, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 }));
const pastFilled = charts.fillBuckets(pastSparse, { granularity: "hour", from: past.from, to: past.to - 1 });
ok("稀疏输入 → 补齐 24 桶（24h 档位）", pastFilled.length === 24, `实际 ${pastFilled.length}`);
const hourScaled = charts.scaleArea(pastFilled.map((r) => ({ day: r.day, value: r.input_tokens })), 560, 150, { tickEvery: 1, tickFormatter: charts.hourTickLabel });
ok("24h 档位：每格一个刻度（24 个）", hourScaled.ticks.length === 24, `实际 ${hourScaled.ticks.length}`);
ok("24h 档位：刻度标签为双位小时且顺序正确", hourScaled.ticks[0].label === "04" && hourScaled.ticks[23].label === "03", `${hourScaled.ticks.map((t) => t.label).join(",")}`);
const hourGaps = hourScaled.ticks.slice(1).map((t, i) => t.x - hourScaled.ticks[i].x);
ok("24h 档位：刻度间距 ≈ 560/23 px（够放两位数字）", Math.abs(hourGaps[0] - 560 / 23) < 0.01, `${hourGaps[0].toFixed(2)}px`);

// --- 4. the "still running" tail ------------------------------------------
// The live window's last bucket is a partial sum; the render layer dashes that
// final segment instead of letting it read as usage collapsing to zero.
const tailGeom = charts.smoothAreaPath(hourScaled.points, 560, 150, { tail: true });
const headGeom = charts.smoothAreaPath(hourScaled.points, 560, 150);
ok("默认不返回 tail（tailLine 为空）", headGeom.tailLine === "" && headGeom.tailArea === "");
ok("tail:true 返回最后一段（= 整条曲线的末段）", tailGeom.tailLine.startsWith("M") && tailGeom.line.endsWith(tailGeom.tailLine.slice(tailGeom.tailLine.indexOf(" "))), `tail=${tailGeom.tailLine.slice(0, 40)}`);
ok("tailArea 闭合成楔形（回到基线再收回起点）", /L[\d.]+,150 L[\d.]+,150 Z$/.test(tailGeom.tailArea), tailGeom.tailArea.slice(-30));
same("smoothAreaPath tail 内联一致性", tailGeom, inline.smoothAreaPath(hourScaled.points, 560, 150, { tail: true }));
const twoPoint = charts.smoothAreaPath([{ x: 0, y: 10 }, { x: 5, y: 20 }], 10, 150, { tail: true });
ok("2 点序列也有 tail（直线段）", twoPoint.tailLine === "M0,10 L5,20", twoPoint.tailLine);

console.log(`\n${checks - failures}/${checks} 通过${failures ? `，${failures} 失败` : ""}`);
process.exit(failures ? 1 : 0);
