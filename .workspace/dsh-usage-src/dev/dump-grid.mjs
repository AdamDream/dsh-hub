// 2026-09-12 heatmap redesign — preview data dump.
// Replicates the `heatmap` RPC path: queryHeatmap(db, {year, dataSources})
// from lib/db.js — with dataSources='all' (the client default) the predicate
// is exactly `DAY_SQL BETWEEN <year>-01-01 AND <year>-12-31` (eventWhere's
// data_source clause is empty), summing input+output+cache_read+cache_write
// per day. The grid is then computed by the REAL heatmapGrid from
// lib/charts.js and dumped to dev/grid.json for the PIL preview renderer.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { chartsModuleFrom } from "./charts-loader.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = "/home/CNS2026495165/.dsh/storages/usage/usage.db";
const year = 2026;

// node:sqlite read-only open — no writes touch ~/.dsh (WAL needs the -wal /
// -shm siblings readable, which they are).
const db = new DatabaseSync(dbPath, { readOnly: true });
const daySql = "strftime('%Y-%m-%d', ts / 1000, 'unixepoch', 'localtime')";
const rows = db
	.prepare(
		`SELECT ${daySql} AS day,
       SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens) AS total
FROM usage_events
WHERE ${daySql} BETWEEN ? AND ?
GROUP BY day ORDER BY day`)
	.all(`${year}-01-01`, `${year}-12-31`)
	.map((row) => ({ day: String(row.day), total: Number(row.total) }));
db.close();

const charts = chartsModuleFrom(root);
const grid = charts.heatmapGrid(rows, 11, {}); // client default: cell=11, gap=3, startWeekday=0
const peak = grid.peak; // == maxTotal (>= 1 when data present)
const peakDay = rows.reduce((a, b) => (b.total > a.total ? b : a), rows[0] ?? { day: "-", total: 0 });

const summary = {
	dbPath,
	year,
	querySql: `SELECT ${daySql} AS day, SUM(input_tokens+output_tokens+cache_read_tokens+cache_write_tokens) AS total FROM usage_events WHERE ${daySql} BETWEEN '${year}-01-01' AND '${year}-12-31' GROUP BY day ORDER BY day`,
	dayCount: rows.length,
	firstDay: rows[0] ? rows[0].day : null,
	lastDay: rows.length ? rows[rows.length - 1].day : null,
	peakTotal: peak,
	peakDay: peakDay.day,
	weeks: grid.weeks,
	gridWidth: grid.width,
	gridHeight: 16 + 7 * (11 + 3) - 3,
	months: grid.months,
	peakDay: grid.peakDay,
	levelBuckets: grid.cells.reduce((acc, c) => ((acc[c.level] = (acc[c.level] || 0) + 1), acc), {}),
	emptyCells: grid.cells.filter((c) => c.level === 0).length,
};
writeFileSync(join(root, "dev", "grid.json"), JSON.stringify({ summary, days: rows, cells: grid.cells, months: grid.months, peak: grid.peak, peakDay: grid.peakDay }, null, 2));
console.log(JSON.stringify(summary, null, 2));
console.log("grid.json written");
