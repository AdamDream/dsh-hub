// 2026-09-18 hourly trend redesign — preview data dump.
//
// Everything below exercises the REAL implementation, not a re-implementation:
//   * the host query is lib/db.js `queryTimeseries` (now granularity-aware)
//     against the real ~/.dsh/storages/usage/usage.db (read-only),
//   * the client pipeline is lib/charts.js `fillBuckets` (hour / day zero-fill),
//     `scaleArea` + `smoothAreaPath` (new monotone-cubic curve) and
//     `scaleBars` + `barRects` + `mixHex` (yellow→orange ramp),
//   * labels come from `bucketLabel` (the fix for the hour-key degradation).
//
// Output: dev/trend-v2.json — geometry + the colour variants the PIL renderer
// paints side by side, so the visual review compares real curves, not sketches.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { queryTimeseries } from "../lib/db.js";
import { chartsModuleFrom } from "./charts-loader.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = "/home/CNS2026495165/.dsh/storages/usage/usage.db";
const W = 560;
const H = 150;
const days = 7;
const now = Date.now();
const from = now - days * 86400000;

const db = new DatabaseSync(dbPath, { readOnly: true });
// dataSources 'all' = client default; the granularity branch is what changed.
const dayRows = queryTimeseries(db, { from, to: now, dataSources: "all", granularity: "day" });
const hourRows = queryTimeseries(db, { from, to: now, dataSources: "all", granularity: "hour" });
const defaultRows = queryTimeseries(db, { from, to: now, dataSources: "all" });
db.close();

const charts = chartsModuleFrom(root);
const dayFilled = charts.fillBuckets(dayRows, { granularity: "day", from, to: now });
const hourFilled = charts.fillBuckets(hourRows, { granularity: "hour", from, to: now });

const total = (r) => r.input_tokens + r.output_tokens + r.cache_read_tokens + r.cache_write_tokens;
const asSeries = (rows) => rows.map((r) => ({ day: r.day, value: total(r) }));

const hourSeries = asSeries(hourFilled);
const daySeries = asSeries(dayFilled);

// 2026-09-18: optional 6-hour roll-up — with 7 days of hourly buckets, ~2/3 of
// the hours carry no usage at all, so the "smooth curve" is really a run of
// isolated spikes separated by flat zero stretches. Summing 6 consecutive hours
// (pure client-side, no host change) yields 28 points and a visibly flowing
// curve while keeping the daily rhythm. Rendered as a candidate, not shipped
// until the user picks it.
const hourRollup = [];
for (let i = 0; i < hourSeries.length; i += 6) {
	const chunk = hourSeries.slice(i, i + 6);
	const last = chunk[chunk.length - 1];
	hourRollup.push({ day: last.day, value: chunk.reduce((a, b) => a + b.value, 0), hours: chunk.length });
}
const rollupOf = (hours) => {
	const out = [];
	for (let i = 0; i < hourSeries.length; i += hours) {
		const chunk = hourSeries.slice(i, i + hours);
		const last = chunk[chunk.length - 1];
		out.push({ day: last.day, value: chunk.reduce((a, b) => a + b.value, 0), hours: chunk.length });
	}
	return out;
};
const hourRollup3 = rollupOf(3);

// --- area (hourly, smooth) + the PREVIOUS straight-line path for comparison ---
const areaScaled = charts.scaleArea(hourSeries, W, H);
const smooth = charts.smoothAreaPath(areaScaled.points, W, H);
const straight = charts.areaPath(areaScaled.points, W, H);
const rollupScaled = charts.scaleArea(hourRollup, W, H);
const rollupGeom = charts.smoothAreaPath(rollupScaled.points, W, H);
const rollup3Scaled = charts.scaleArea(hourRollup3, W, H);
const rollup3Geom = charts.smoothAreaPath(rollup3Scaled.points, W, H);

// --- 2026-09-18b: the shipped 24h gear (04:00 → 04:00, one bucket per hour) ---
const db2 = new DatabaseSync(dbPath, { readOnly: true });
// Two windows are dumped: the live one (04:00 → now, curve stops at the current
// hour) and a complete past one, so the review shows both the "today so far"
// and the full-day shapes. Labels use tickEvery=1 + hourTickLabel exactly like
// the client asks for.
const dayRowsWindow = (from, to) => charts.fillBuckets(
	queryTimeseries(db2, { from, to, dataSources: "all", granularity: "hour" }),
	{ granularity: "hour", from, to },
);
const nowMs = Date.now();
const liveWin = charts.usageDayWindow(nowMs);
const pastWin = charts.usageDayWindow(liveWin.from - 1);
const view24 = (win, fillTo, partial) => {
	const rows = dayRowsWindow(win.from, fillTo);
	const series = rows.map((r) => ({ day: r.day, value: total(r) }));
	const scaled = charts.scaleArea(series, W, H, { tickEvery: 1, tickFormatter: charts.hourTickLabel });
	const geom = charts.smoothAreaPath(scaled.points, W, H, { tail: partial });
	const barScaled = charts.scaleBars(series, W, H, { tickEvery: 1, tickFormatter: charts.hourTickLabel });
	const barRectList = charts.barRects(barScaled.rects, W, H);
	const barMax = Math.max(1, ...series.map((s) => s.value));
	return {
		window: { from: win.from, to: win.to, fillTo },
		partial,
		buckets: rows.length,
		nonEmpty: rows.filter((r) => total(r) > 0).length,
		peak: series.reduce((a, b) => (b.value > a.value ? b : a), series[0] ?? { day: "-", value: 0 }),
		points: scaled.points,
		ticks: scaled.ticks,
		smoothLine: geom.line,
		smoothArea: geom.area,
		tailLine: geom.tailLine,
		bars: barRectList.map((r, i) => ({ ...r, fill: charts.mixHex("#f5c451", "#f08a3c", r.value / barMax), partialBar: partial && i === barRectList.length - 1 })),
	};
};
const hour24Live = view24(liveWin, Math.min(liveWin.to - 1, nowMs), true);
const hour24Past = view24(pastWin, pastWin.to - 1, false);
db2.close();

// --- bars (daily, unchanged granularity) ---
const barsScaled = charts.scaleBars(daySeries, W, H);
const barRects = charts.barRects(barsScaled.rects, W, H);
const barMax = Math.max(1, ...daySeries.map((s) => s.value));

// Colour candidates — LIGHT theme first (the user's current theme).
const areaVariants = [
	{ id: "A", label: "浅蓝 #60a5fa 描边 + 深蓝 #1e3a8a 35% 幅底", line: "#60a5fa", fill: "#1e3a8a", alpha: 0.35 },
	{ id: "B", label: "浅蓝 #60a5fa 描边 + 深蓝 #1e3a8a 45% 幅底", line: "#60a5fa", fill: "#1e3a8a", alpha: 0.45 },
	{ id: "C", label: "更浅 #93c5fd 描边 + 深蓝 #2563eb 30% 幅底", line: "#93c5fd", fill: "#2563eb", alpha: 0.3 },
	{ id: "D", label: "浅蓝 #60a5fa 描边 + 深蓝 #1e3a8a 60% 幅底（最“深”档）", line: "#60a5fa", fill: "#1e3a8a", alpha: 0.6 },
	{ id: "E", label: "亮蓝 #7cc4ff 描边 + 藏青 #172554 45% 幅底", line: "#7cc4ff", fill: "#172554", alpha: 0.45 },
];
const barVariants = [
	{ id: "P1", label: "黄 #eab308 → 橙 #ea580c", low: "#eab308", high: "#ea580c" },
	{ id: "P2", label: "暖黄 #f5c451 → 暖橙 #f08a3c", low: "#f5c451", high: "#f08a3c" },
	{ id: "P3", label: "鲜艳 #ffd54a → #ff7a18", low: "#ffd54a", high: "#ff7a18" },
];
const bars = barVariants.map((v) => ({
	...v,
	rects: barRects.map((r) => ({ ...r, fill: charts.mixHex(v.low, v.high, r.value / barMax) })),
}));

const peakHour = hourSeries.reduce((a, b) => (b.value > a.value ? b : a), hourSeries[0]);
const peakDay = daySeries.reduce((a, b) => (b.value > a.value ? b : a), daySeries[0]);

const summary = {
	dbPath,
	windowDays: days,
	from: new Date(from).toISOString(),
	to: new Date(now).toISOString(),
	dayBucketsFromHost: dayRows.length,
	hourBucketsFromHost: hourRows.length,
	defaultGranularityBuckets: defaultRows.length,
	dayBucketsFilled: dayFilled.length,
	hourBucketsFilled: hourFilled.length,
	hourEmptyBuckets: hourFilled.filter((r) => total(r) === 0).length,
	peakHour: { bucket: peakHour.day, label: charts.bucketLabel(peakHour.day), value: peakHour.value, formatted: charts.formatTokens(peakHour.value) },
	peakDay: { bucket: peakDay.day, label: charts.bucketLabel(peakDay.day), value: peakDay.value, formatted: charts.formatTokens(peakDay.value) },
	areaTickLabels: areaScaled.ticks.map((t) => t.label),
	rollupBuckets: hourRollup.length,
	rollupTickLabels: rollupScaled.ticks.map((t) => t.label),
	barTickLabels: barsScaled.ticks.map((t) => t.label),
	smoothPathSegments: (smooth.line.match(/C/g) || []).length,
};

writeFileSync(
	join(root, "dev", "trend-v2.json"),
	JSON.stringify(
		{
			summary,
			areaVariants,
			barVariants: bars.map((b) => ({ id: b.id, label: b.label, low: b.low, high: b.high, rects: b.rects })),
			area: {
				points: areaScaled.points,
				ticks: areaScaled.ticks,
				smoothLine: smooth.line,
				smoothArea: smooth.area,
				straightLine: straight.line,
				straightArea: straight.area,
				w: W,
				h: H,
			},
			bars: { rects: barRects, ticks: barsScaled.ticks, w: W, h: H },
			rollup: {
				hoursPerBucket: 6,
				count: hourRollup.length,
				points: rollupScaled.points,
				ticks: rollupScaled.ticks,
				smoothLine: rollupGeom.line,
				smoothArea: rollupGeom.area,
			},
			rollup3: {
				hoursPerBucket: 3,
				count: hourRollup3.length,
				points: rollup3Scaled.points,
				ticks: rollup3Scaled.ticks,
				smoothLine: rollup3Geom.line,
				smoothArea: rollup3Geom.area,
			},
			hour24: {
				live: hour24Live,
				past: hour24Past,
			},
			hourSeries: hourSeries.map((s) => ({ ...s, label: charts.bucketLabel(s.day), formatted: charts.formatTokens(s.value) })),
			daySeries: daySeries.map((s) => ({ ...s, label: charts.bucketLabel(s.day), formatted: charts.formatTokens(s.value) })),
		},
		null,
		2,
	),
);
console.log(JSON.stringify(summary, null, 2));
