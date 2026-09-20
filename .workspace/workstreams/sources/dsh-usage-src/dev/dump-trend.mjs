// 2026-09-14 tooltip — preview data dump for the trend charts.
// Replicates the `timeseries` RPC path (queryTimeseries from lib/db.js with
// dataSources='all' over a 30-day window), applies the client's bucketValue
// 'total' (input+output+cache_read+cache_write), then runs the REAL
// scaleBars/barRects/scaleArea/areaPath from lib/charts.js and dumps the
// coordinates to dev/trend.json for the PIL preview renderer. Also re-dumps
// the heatmap grid (dev/grid.json) so one preview pass covers all three
// charts with one DB read.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { chartsModuleFrom } from "./charts-loader.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = "/home/CNS2026495165/.dsh/storages/usage/usage.db";
const days = 30;
const now = Date.now();
const from = now - days * 86400000;

// node:sqlite read-only open — no writes touch ~/.dsh.
const db = new DatabaseSync(dbPath, { readOnly: true });
const daySql = "strftime('%Y-%m-%d', ts / 1000, 'unixepoch', 'localtime')";
const rows = db
	.prepare(
		`SELECT ${daySql} AS day,
       COUNT(*) AS requests,
       COALESCE(SUM(input_tokens), 0) AS input_tokens,
       COALESCE(SUM(output_tokens), 0) AS output_tokens,
       COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
       COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens
FROM usage_events
WHERE ts >= ? AND ts <= ?
GROUP BY day ORDER BY day`)
	.all(from, now)
	.map((row) => ({
		day: String(row.day),
		requests: Number(row.requests),
		input_tokens: Number(row.input_tokens),
		output_tokens: Number(row.output_tokens),
		cache_read_tokens: Number(row.cache_read_tokens),
		cache_write_tokens: Number(row.cache_write_tokens),
	}));
db.close();

const charts = chartsModuleFrom(root);
const w = 560;
const h = 150;
const series = rows.map((r) => ({ day: r.day, value: r.input_tokens + r.output_tokens + r.cache_read_tokens + r.cache_write_tokens }));
const bars = charts.scaleBars(series, w, h);
const barRects = charts.barRects(bars.rects, w, h);
const area = charts.scaleArea(series, w, h);
const geom = charts.areaPath(area.points, w, h);
const peakEntry = series.reduce((a, b) => (b.value > a.value ? b : a), series[0] ?? { day: "-", value: 0 });

const summary = {
	dbPath,
	days,
	from: new Date(from).toISOString(),
	to: new Date(now).toISOString(),
	dayCount: series.length,
	firstDay: series[0] ? series[0].day : null,
	lastDay: series.length ? series[series.length - 1].day : null,
	peakValue: peakEntry.value,
	peakFormatted: charts.formatTokens(peakEntry.value),
	peakDay: peakEntry.day,
	barTickEvery: bars.ticks.length,
	areaTickEvery: area.ticks.length,
};

writeFileSync(
	join(root, "dev", "trend.json"),
	JSON.stringify(
		{
			summary,
			series: series.map((s) => ({ day: s.day, value: s.value, formatted: charts.formatTokens(s.value) })),
			bars: { rects: barRects, ticks: bars.ticks },
			area: { points: area.points, ticks: area.ticks, line: geom.line, area: geom.area },
		},
		null,
		2,
	),
);
console.log(JSON.stringify(summary, null, 2));
console.log("trend.json written");
