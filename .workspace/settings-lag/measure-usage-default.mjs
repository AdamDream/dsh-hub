import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.env.HOME + "/.dsh/storages/usage/usage.db", { readOnly: true });
db.exec("PRAGMA temp_store = MEMORY");
const q = (s, ...v) => db.prepare(s).all(...v);
const DAY = "strftime('%Y-%m-%d', ts / 1000, 'unixepoch', 'localtime')";
const HOUR = "strftime('%Y-%m-%d %H', ts / 1000, 'unixepoch', 'localtime')";
// client defaults: rangeDays=7, dataSource='all', heatmap={year, dataSources}
const to = Date.now(), from = to - 7 * 86400_000;
const trendFrom = to - 86400_000;
const calls = [
  ["summary", () => q(`SELECT COUNT(*) AS requests, SUM(input_tokens), SUM(output_tokens), SUM(cache_read_tokens), SUM(cache_write_tokens), COUNT(DISTINCT session_id) AS sessions FROM usage_events WHERE ts >= ? AND ts <= ?`, from, to)],
  ["timeseries(day)", () => q(`SELECT ${DAY} AS day, COUNT(*) FROM usage_events WHERE ts >= ? AND ts <= ? GROUP BY day ORDER BY day`, from, to)],
  ["heatmap(year=whole table)", () => q(`SELECT ${DAY} AS day, SUM(input_tokens+output_tokens+cache_read_tokens+cache_write_tokens) AS total FROM usage_events WHERE ${DAY} BETWEEN ? AND ? GROUP BY day ORDER BY day`, "2026-01-01", "2026-12-31")],
  ["byModel", () => q(`SELECT COALESCE(model,'(unknown)') AS m, COUNT(*) FROM usage_events WHERE ts >= ? AND ts <= ? GROUP BY 1 ORDER BY 2 DESC`, from, to)],
  ["byProject", () => q(`SELECT COALESCE(project,'(unknown)') AS p, COUNT(*) FROM usage_events WHERE ts >= ? AND ts <= ? GROUP BY 1 ORDER BY 2 DESC`, from, to)],
  ["byDay", () => q(`SELECT ${DAY} AS day, COUNT(*) FROM usage_events WHERE ts >= ? AND ts <= ? GROUP BY day ORDER BY day`, from, to)],
  ["timeseries(hour)", () => q(`SELECT ${HOUR} AS day, COUNT(*) FROM usage_events WHERE ts >= ? AND ts <= ? GROUP BY day ORDER BY day`, trendFrom, to)],
];
let sum = 0;
console.log("=== ONE loadAll() CYCLE, client defaults (7-day window) ===");
for (const [name, fn] of calls) {
  const a = performance.now(); const r = fn(); const ms = performance.now() - a; sum += ms;
  console.log(`  ${name.padEnd(30)} ${ms.toFixed(1).padStart(7)} ms   rows=${Array.isArray(r) ? r.length : 1}`);
}
console.log(`  ${"TOTAL (blocking main thread)".padEnd(30)} ${sum.toFixed(1).padStart(7)} ms`);
console.log("\nEvery 30 s while the Settings -> Plugins -> configurable tab is open.");
db.close();
