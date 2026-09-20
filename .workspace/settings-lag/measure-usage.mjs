import { DatabaseSync } from "node:sqlite";
const path = process.env.HOME + "/.dsh/storages/usage/usage.db";
const db = new DatabaseSync(path, { readOnly: true });
const time = (label, fn) => {
  const t0 = performance.now();
  let out;
  try { out = fn(); } catch (e) { out = "ERR " + e.message; }
  const ms = performance.now() - t0;
  let size = "";
  if (Array.isArray(out)) size = ` rows=${out.length} bytes=${JSON.stringify(out).length}`;
  else if (out && typeof out === "object") size = ` bytes=${JSON.stringify(out).length}`;
  console.log(`${label.padEnd(30)} ${ms.toFixed(1).padStart(9)} ms ${size}`);
  return out;
};
const q = (sql, ...v) => db.prepare(sql).all(...v);
const plan = (label, sql, ...v) => {
  console.log(`\n--- PLAN ${label} ---`);
  for (const r of q("EXPLAIN QUERY PLAN " + sql, ...v)) console.log("   ", r.detail);
};
const DAY = "strftime('%Y-%m-%d', ts / 1000, 'unixepoch', 'localtime')";
const HOUR = "strftime('%Y-%m-%d %H', ts / 1000, 'unixepoch', 'localtime')";

console.log("=== dsh-usage RPC queries, real DB (read-only), 104,907 events ===");
const summarySql = `SELECT COUNT(*) AS requests, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens, SUM(cache_read_tokens) AS cache_read_tokens, SUM(cache_write_tokens) AS cache_write_tokens, COUNT(DISTINCT session_id) AS sessions FROM usage_events `;
time("summary (no filter)", () => q(summarySql));
const tsSql = `SELECT ${DAY} AS day, COUNT(*) AS requests, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens FROM usage_events GROUP BY day ORDER BY day`;
time("timeseries day (no filter)", () => q(tsSql));
const hmSql = `SELECT ${DAY} AS day, COUNT(*) AS requests, SUM(input_tokens+output_tokens) AS tokens FROM usage_events WHERE ${DAY} BETWEEN ? AND ? GROUP BY day ORDER BY day`;
time("heatmap (DAY_SQL BETWEEN)", () => q(hmSql, "2020-01-01", "2030-01-01"));
const bmSql = `SELECT COALESCE(model,'(unknown)') AS model, COUNT(*) AS requests, SUM(input_tokens) AS input_tokens FROM usage_events GROUP BY COALESCE(model,'(unknown)') ORDER BY requests DESC`;
time("byModel", () => q(bmSql));
const bpSql = `SELECT COALESCE(project,'(unknown)') AS project, COUNT(*) AS requests FROM usage_events GROUP BY COALESCE(project,'(unknown)') ORDER BY requests DESC`;
time("byProject", () => q(bpSql));
const bdSql = `SELECT ${DAY} AS day, COUNT(*) AS requests FROM usage_events GROUP BY day ORDER BY day`;
time("byDay", () => q(bdSql));
const sessSql = `
WITH latest AS (
  SELECT session_id, data_source, model, project, ts,
         ROW_NUMBER() OVER (PARTITION BY session_id, data_source ORDER BY ts DESC, id DESC) AS rn
  FROM usage_events
)
SELECT l.session_id, l.data_source, l.ts, l.model, l.project,
       COUNT(*) AS requests,
       SUM(e.input_tokens) AS input_tokens, SUM(e.output_tokens) AS output_tokens,
       SUM(e.cache_read_tokens) AS cache_read_tokens, SUM(e.cache_write_tokens) AS cache_write_tokens
FROM latest l
JOIN usage_events e ON e.session_id = l.session_id AND e.data_source = l.data_source
WHERE l.rn = 1
GROUP BY l.session_id, l.data_source
ORDER BY l.ts DESC
LIMIT ?`;
time("sessions (limit 100)", () => q(sessSql, 100));
time("sessions (limit 500)", () => q(sessSql, 500));

console.log("\n=== sargability check: filtered variants ===");
time("summary ts>= (sargable)", () => q(summarySql + "WHERE ts >= ?", 1757000000000));
time("summary DAY>= (non-sargable)", () => q(summarySql + `WHERE ${DAY} >= ?`, "2025-09-01"));
plan("summary ts>= (sargable)", summarySql + "WHERE ts >= ?", 1757000000000);
plan("summary DAY>= (non-sargable)", summarySql + `WHERE ${DAY} >= ?`, "2025-09-01");
plan("heatmap DAY BETWEEN", hmSql, "2020-01-01", "2030-01-01");
plan("byModel GROUP BY", bmSql);
plan("sessions window+selfjoin", sessSql, 100);
db.close();
