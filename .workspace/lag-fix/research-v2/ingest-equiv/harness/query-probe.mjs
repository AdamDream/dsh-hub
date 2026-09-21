// Reads every RPC-equivalent query through a SEPARATE connection while the
// ingesting connection is parked in the "events COMMIT → daily rebuild" gap,
// plus a latency probe for reader-vs-writer contention.
import { DatabaseSync } from "node:sqlite";
import {
	querySummary, queryTimeseries, queryHeatmap, queryByModel,
	queryByProject, queryByDay, querySessions,
} from "./deployed-queries.mjs";

export function probeQueries(dbPath) {
	const c = new DatabaseSync(dbPath);
	const t = (fn) => {
		const t0 = process.hrtime.bigint();
		try {
			const value = fn();
			return { ms: Number(process.hrtime.bigint() - t0) / 1e6, value };
		} catch (e) {
			return { ms: Number(process.hrtime.bigint() - t0) / 1e6, error: `${e.code ?? e.name}: ${e.message}` };
		}
	};
	try {
		// 2026 is the year the fixture's dsh events land in; 2025-08-24 is the day
		// the `time` fields actually map to (see audit.md fixture notes).
		const out = {
			summary_all: t(() => querySummary(c, {})),
			heatmap_2025: t(() => queryHeatmap(c, { year: 2025 })),
			heatmap_2026: t(() => queryHeatmap(c, { year: 2026 })),
			byDay_all: t(() => queryByDay(c, {})),
			byModel_all: t(() => queryByModel(c, {})),
			byProject_all: t(() => queryByProject(c, {})),
			timeseries_day: t(() => queryTimeseries(c, { granularity: "day" })),
			timeseries_hour: t(() => queryTimeseries(c, { granularity: "hour" })),
			sessions_all: t(() => querySessions(c, {})),
			raw_count: t(() => c.prepare("SELECT COUNT(*) AS c FROM usage_events").get()),
			daily_maxday: t(() => c.prepare("SELECT MAX(day) AS d FROM usage_daily").get()),
			daily_rows: t(() => c.prepare("SELECT COUNT(*) AS c FROM usage_daily").get()),
		};
		return out;
	} finally {
		c.close();
	}
}

/** Probe, then run the REAL deployed daily rebuild for every day present in
 * `usage_events`, then probe again — one process, one connection, two states. */
let sqliteDailyChoice = null;
export async function probeBeforeAndAfterRebuild(dbPath) {
	const { rebuildDailyForDays } = await import("./deployed-queries.mjs");
	const c = new DatabaseSync(dbPath);
	const days = c.prepare("SELECT DISTINCT strftime('%Y-%m-%d', ts/1000, 'unixepoch', 'localtime') AS d FROM usage_events ORDER BY d").all().map((r) => r.d);
	const pathUsed = () => {
		const lines = [];
		c.exec("DROP TABLE IF EXISTS temp.__trace_ignore");
		// EXPLAIN QUERY PLAN of the heatmap's two candidate segments
		lines.push({
			dailySegment: c.prepare("EXPLAIN QUERY PLAN SELECT day, SUM(input_tokens+output_tokens+cache_read_tokens+cache_write_tokens) AS total FROM usage_daily WHERE day >= ? AND day <= ? GROUP BY day").all("2025-01-01", "2025-12-31").map((r) => r.detail),
		});
		sqliteDailyChoice = c.prepare("SELECT MAX(day) AS d FROM usage_daily").get().d;
		lines.push({ maxDailyDay: sqliteDailyChoice });
		return lines;
	};
	const before = probeQueries(dbPath);
	const planBefore = pathUsed();
	rebuildDailyForDays(c, days);
	const after = probeQueries(dbPath);
	const planAfter = pathUsed();
	c.close();
	return { daysRebuilt: days, before, after, planBefore, planAfter };
}

if (process.argv[2] === "--run") {
	process.stdout.write(JSON.stringify(probeQueries(process.argv[3])));
}
if (process.argv[2] === "--rebuild-and-run") {
	process.stdout.write(JSON.stringify(await probeBeforeAndAfterRebuild(process.argv[3])));
}
