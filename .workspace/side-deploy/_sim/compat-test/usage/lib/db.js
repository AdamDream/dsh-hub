//#region lib/db.js
/**
 * SQLite storage for dsh-usage (AUDIT U05). Zero-dependency: `node:sqlite`
 * (Node 22+), schema v1 in the B2/B7-corrected shape (`dedup_key` +
 * `is_subagent`), host-convention file creation (`mkdir 0o700`,
 * placeholder `open('wx', 0o600)`, `PRAGMA journal_mode=WAL`,
 * `application_id` + `user_version` migration) — mirroring
 * `dsh-session-query-sqlite` (A6 evidence).
 * @module dsh-usage/db
 */

import { mkdirSync, openSync, closeSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dshHomePath } from "@deepseek-ai/dsh-home-paths";

/** `PRAGMA application_id` guard — 'DSUG' (dsh-usage), distinct from the host's 1146308689. */
export const DSH_USAGE_APPLICATION_ID = 0x44535547;
/** Current schema version (bumped on migration). */
export const DSH_USAGE_SCHEMA_VERSION = 1;

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Resolve the usage database path with the AUDIT A6 fallback chain:
 *   1. `dshHomePath('storages','usage','usage.db')` — primary, host-owned dir
 *   2. `dshHomePath('usage','usage.db')` — first fallback
 *   3. `<package>/data/usage.db` — second fallback (writable alongside the plugin)
 *   4. any absolute paths supplied in `fallbackDirs` are tried before the
 *      package `data/` dir (caller-controlled extras)
 * Each candidate is accepted only when its parent directory is mkdir-able
 * (probe only — the actual DB file is created by `openUsageDb`).
 * @param {string[]} [fallbackDirs] - extra absolute directory candidates.
 * @returns {{path: string, source: string}} the first writable path and its
 *   origin marker (`home-storages` | `home-usage` | `fallback:<dir>` | `data`).
 */
export function resolveDbPath(fallbackDirs = []) {
	const candidates = [
		{ dir: join(dshHomePath("storages"), "usage"), source: "home-storages" },
		{ dir: dshHomePath("usage"), source: "home-usage" },
	];
	for (const dir of fallbackDirs) {
		candidates.push({ dir, source: `fallback:${dir}` });
	}
	candidates.push({ dir: join(PACKAGE_ROOT, "data"), source: "data" });
	for (const { dir, source } of candidates) {
		try {
			mkdirSync(dir, { recursive: true, mode: 0o700 });
			return { path: join(dir, "usage.db"), source };
		} catch {
			// EROFS / EACCES — try the next candidate.
		}
	}
	// Unreachable in practice: the package `data/` dir is inside the install
	// tree. Guard anyway.
	throw new Error("dsh-usage: no writable directory for usage.db");
}

/**
 * Open (or create) the usage database. File creation follows the host
 * convention: mkdir 0o700, placeholder `open(path, 'wx', 0o600)`, then
 * `DatabaseSync`; `PRAGMA journal_mode=WAL`; `application_id` guard; schema
 * migration via `user_version`.
 * @param {string} path - resolved DB path.
 * @returns {import("node:sqlite").DatabaseSync}
 */
export async function openUsageDb(path) {
	const { DatabaseSync } = await import("node:sqlite");
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	if (!existsSync(path)) {
		closeSync(openSync(path, "wx", 0o600));
	}
	const db = new DatabaseSync(path);
	db.exec("PRAGMA journal_mode = WAL");
	const { application_id: applicationId } = db.prepare("PRAGMA application_id").get();
	if (applicationId !== DSH_USAGE_APPLICATION_ID) {
		db.exec(`PRAGMA application_id = ${DSH_USAGE_APPLICATION_ID}`);
	}
	// Schema migration entry (REVIEW P4): `user_version` is the migration
	// ledger (mirroring dsh-session-query-sqlite's convention). v1 is the only
	// shipped schema, so NO migration steps are needed yet — `ensureSchema`
	// (idempotent CREATE IF NOT EXISTS) is the v0→v1 bootstrap and stamps
	// `user_version = 1`. When a future schema (v2+) ships, migrate stepwise
	// HERE (read `user_version`, run per-version ALTERs, bump the version)
	// before falling through to `ensureSchema`; never silently re-stamp a
	// NEWER database as v1 — refuse to open it (downgrade guard below).
	const { user_version: userVersion } = db.prepare("PRAGMA user_version").get();
	if (Number(userVersion) > DSH_USAGE_SCHEMA_VERSION) {
		db.close();
		throw new Error(
			`dsh-usage: database schema v${userVersion} is newer than this plugin supports (v${DSH_USAGE_SCHEMA_VERSION}) — upgrade the plugin`,
		);
	}
	ensureSchema(db);
	return db;
}

/**
 * Idempotent schema bootstrap (three STRICT tables + indexes, AUDIT U05).
 * @param {import("node:sqlite").DatabaseSync} db
 */
export function ensureSchema(db) {
	db.exec(`
CREATE TABLE IF NOT EXISTS usage_events (
  id INTEGER PRIMARY KEY,
  data_source TEXT NOT NULL,
  session_id TEXT NOT NULL,
  dedup_key TEXT NOT NULL,
  ts INTEGER NOT NULL,
  model TEXT,
  provider TEXT,
  project TEXT,
  turn INTEGER,
  step INTEGER,
  is_subagent INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  UNIQUE(data_source, session_id, dedup_key)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_events_ts ON usage_events(ts);
CREATE INDEX IF NOT EXISTS idx_events_model ON usage_events(model);
CREATE INDEX IF NOT EXISTS idx_events_project ON usage_events(project);
CREATE TABLE IF NOT EXISTS usage_daily (
  day TEXT NOT NULL,
  data_source TEXT NOT NULL,
  model TEXT,
  project TEXT,
  requests INTEGER NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL,
  cache_write_tokens INTEGER NOT NULL,
  PRIMARY KEY(day, data_source, model, project)
) STRICT;
CREATE TABLE IF NOT EXISTS sync_state (
  source TEXT PRIMARY KEY,
  mtime INTEGER,
  size INTEGER,
  fingerprint TEXT,
  last_seq INTEGER,
  last_offset INTEGER
) STRICT;
`);
	db.exec(`PRAGMA user_version = ${DSH_USAGE_SCHEMA_VERSION}`);
}

/** Event row shape accepted by {@link insertEvent}. @typedef {object} UsageEvent */
/**
 * Insert one usage event, deduped by `(data_source, session_id, dedup_key)`
 * (AUDIT B2/B5), with the REVIEW P1 conflict policy — **latest observation
 * wins**: a colliding key is overwritten with the incoming row whenever
 * `excluded.ts >= usage_events.ts` (a stale/partial earlier record never
 * clobbers the freshest one; a tie keeps the last-observed values). This
 * replaces the original "first writer wins" (`INSERT OR IGNORE`) because cc
 * transcriptions re-record the SAME API call (same `message.id`) once per
 * streaming update, ~1s apart, with partial usage first and the final values
 * last — first-wins froze the partial row and systematically under-counted
 * cc output/cache-read buckets (REVIEW P1: output −61.0%, cache-read −20.4%).
 * The dsh source is unaffected (chunk/message duplicates carry identical
 * values and ts, so the conflict update is a no-op value-wise).
 *
 * Note on the return value: `node:sqlite`'s `changes` reports 1 for BOTH the
 * insert path and the DO UPDATE path of an UPSERT (verified empirically), so
 * newness is decided by a pre-check SELECT — the returned boolean is true only
 * when a genuinely new row was inserted (feeds the ingest `newEvents` counter
 * and the affected-days set; a conflict-update is not a new event and does not
 * change the dedup semantics).
 * @param {import("node:sqlite").DatabaseSync} db
 * @param {UsageEvent} ev
 * @returns {boolean} whether a new row was inserted.
 */
export function insertEvent(db, ev) {
	const exists =
		db
			.prepare(
				"SELECT 1 AS one FROM usage_events WHERE data_source = ? AND session_id = ? AND dedup_key = ?",
			)
			.get(ev.data_source, ev.session_id, ev.dedup_key) !== undefined;
	db
		.prepare(`
INSERT INTO usage_events
  (data_source, session_id, dedup_key, ts, model, provider, project, turn, step, is_subagent,
   input_tokens, output_tokens, cache_read_tokens, cache_write_tokens)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(data_source, session_id, dedup_key) DO UPDATE SET
  ts = excluded.ts,
  model = excluded.model,
  provider = excluded.provider,
  project = excluded.project,
  input_tokens = excluded.input_tokens,
  output_tokens = excluded.output_tokens,
  cache_read_tokens = excluded.cache_read_tokens,
  cache_write_tokens = excluded.cache_write_tokens
WHERE excluded.ts >= usage_events.ts`)
		.run(
			ev.data_source,
			ev.session_id,
			ev.dedup_key,
			ev.ts,
			ev.model ?? null,
			ev.provider ?? null,
			ev.project ?? null,
			ev.turn ?? null,
			ev.step ?? null,
			ev.is_subagent ? 1 : 0,
			ev.input_tokens,
			ev.output_tokens,
			ev.cache_read_tokens,
			ev.cache_write_tokens,
		);
	return !exists;
}

/**
 * Recompute `usage_daily` for the given local dates from `usage_events`
 * (incremental fold aggregation — only affected days are touched).
 * @param {import("node:sqlite").DatabaseSync} db
 * @param {string[]} days - local `YYYY-MM-DD` dates.
 */
export function rebuildDailyForDays(db, days) {
	if (days.length === 0) return;
	const placeholders = days.map(() => "?").join(", ");
	db.exec("BEGIN");
	try {
		db.prepare(`DELETE FROM usage_daily WHERE day IN (${placeholders})`).run(...days);
		db.prepare(`
INSERT INTO usage_daily (day, data_source, model, project, requests,
  input_tokens, output_tokens, cache_read_tokens, cache_write_tokens)
SELECT strftime('%Y-%m-%d', ts / 1000, 'unixepoch', 'localtime') AS day,
       data_source,
       COALESCE(model, '(unknown)'),
       COALESCE(project, '(unknown)'),
       COUNT(*) AS requests,
       SUM(input_tokens) AS input_tokens,
       SUM(output_tokens) AS output_tokens,
       SUM(cache_read_tokens) AS cache_read_tokens,
       SUM(cache_write_tokens) AS cache_write_tokens
FROM usage_events
WHERE strftime('%Y-%m-%d', ts / 1000, 'unixepoch', 'localtime') IN (${placeholders})
GROUP BY day, data_source, COALESCE(model, '(unknown)'), COALESCE(project, '(unknown)')`).run(...days);
		db.exec("COMMIT");
	} catch (error) {
		db.exec("ROLLBACK");
		throw error;
	}
}

/**
 * Recompute one day's `usage_daily` rows (thin wrapper of the multi-day form).
 * @param {import("node:sqlite").DatabaseSync} db
 * @param {string} day - local `YYYY-MM-DD`.
 */
export function insertDaily(db, day) {
	rebuildDailyForDays(db, [day]);
}

/**
 * Upsert one `sync_state` row (byte-cursor incremental position per source).
 * @param {import("node:sqlite").DatabaseSync} db
 * @param {{source: string, mtime?: number, size?: number, fingerprint?: string,
 *   last_seq?: number, last_offset?: number}} row
 */
export function upsertSyncState(db, row) {
	db.prepare(`
INSERT OR REPLACE INTO sync_state (source, mtime, size, fingerprint, last_seq, last_offset)
VALUES (?, ?, ?, ?, ?, ?)`).run(
		row.source,
		row.mtime ?? null,
		row.size ?? null,
		row.fingerprint ?? null,
		row.last_seq ?? null,
		row.last_offset ?? null,
	);
}

/**
 * Read one `sync_state` row.
 * @param {import("node:sqlite").DatabaseSync} db
 * @param {string} source
 * @returns {object|undefined}
 */
export function getSyncState(db, source) {
	return db.prepare("SELECT * FROM sync_state WHERE source = ?").get(source);
}

/**
 * Normalize the `dataSources` filter to a SQL `data_source IN (...)` fragment
 * with bound values. Accepts 'dsh' | 'cc' | 'all' | array of the two.
 * @param {unknown} dataSources
 * @returns {{clause: string, values: string[]}}
 */
export function dataSourceClause(dataSources) {
	const sources =
		dataSources === undefined || dataSources === "all"
			? ["dsh", "cc"]
			: Array.isArray(dataSources)
				? dataSources
				: [dataSources];
	const valid = sources.filter((s) => s === "dsh" || s === "cc");
	if (valid.length === 0) return { clause: "", values: [] };
	return { clause: "data_source IN (" + valid.map(() => "?").join(", ") + ")", values: valid };
}

/** ms→seconds / null-safe number helpers for `strftime('...','unixepoch','localtime')`. */
const DAY_SQL = "strftime('%Y-%m-%d', ts / 1000, 'unixepoch', 'localtime')";

/**
 * Build the shared event WHERE fragment from filters. When `prefix` is given
 * (e.g. `e.`), every column reference is prefixed — required for queries that
 * join `usage_events` with itself or with a CTE over the same table.
 * @param {{from?: number, to?: number, dataSources?: unknown, model?: string, project?: string}} filters
 * @param {string} [prefix] - optional column prefix (`e.`, `l.`, …).
 * @returns {{clause: string, values: Array<number|string>}}
 */
export function eventWhere(filters = {}, prefix = "") {
	const parts = [];
	const values = [];
	if (Number.isFinite(filters.from)) {
		parts.push(`${prefix}ts >= ?`);
		values.push(filters.from);
	}
	if (Number.isFinite(filters.to)) {
		parts.push(`${prefix}ts <= ?`);
		values.push(filters.to);
	}
	const ds = dataSourceClause(filters.dataSources);
	if (ds.clause) {
		parts.push(`${prefix}data_source IN (` + ds.values.map(() => "?").join(", ") + ")");
		values.push(...ds.values);
	}
	if (typeof filters.model === "string" && filters.model.length > 0) {
		parts.push(`${prefix}model = ?`);
		values.push(filters.model);
	}
	if (typeof filters.project === "string" && filters.project.length > 0) {
		parts.push(`${prefix}project = ?`);
		values.push(filters.project);
	}
	return { clause: parts.length > 0 ? `WHERE ${parts.join(" AND ")}` : "", values };
}

/**
 * `summary` — request count, four token buckets, cache hit rate, covered
 * sessions over the filter window.
 * @param {import("node:sqlite").DatabaseSync} db
 * @param {object} filters
 * @returns {{requests: number, input_tokens: number, output_tokens: number,
 *   cache_read_tokens: number, cache_write_tokens: number, hit_rate: number,
 *   sessions: number}}
 */
export function querySummary(db, filters = {}) {
	const { clause, values } = eventWhere(filters);
	const row = db
		.prepare(`
SELECT COUNT(*) AS requests,
       COALESCE(SUM(input_tokens), 0) AS input_tokens,
       COALESCE(SUM(output_tokens), 0) AS output_tokens,
       COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
       COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
       COUNT(DISTINCT session_id) AS sessions
FROM usage_events ${clause}`)
		.get(...values);
	const input = Number(row.input_tokens);
	const cacheRead = Number(row.cache_read_tokens);
	const hitRate = input + cacheRead > 0 ? cacheRead / (input + cacheRead) : 0;
	return {
		requests: Number(row.requests),
		input_tokens: input,
		output_tokens: Number(row.output_tokens),
		cache_read_tokens: cacheRead,
		cache_write_tokens: Number(row.cache_write_tokens),
		hit_rate: hitRate,
		sessions: Number(row.sessions),
	};
}

/**
 * `timeseries` — per-day four buckets (trend chart).
 * @param {import("node:sqlite").DatabaseSync} db
 * @param {object} filters
 * @returns {Array<{day: string, requests: number, input_tokens: number,
 *   output_tokens: number, cache_read_tokens: number, cache_write_tokens: number}>}
 */
export function queryTimeseries(db, filters = {}) {
	const { clause, values } = eventWhere(filters);
	return db
		.prepare(`
SELECT ${DAY_SQL} AS day,
       COUNT(*) AS requests,
       COALESCE(SUM(input_tokens), 0) AS input_tokens,
       COALESCE(SUM(output_tokens), 0) AS output_tokens,
       COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
       COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens
FROM usage_events ${clause}
GROUP BY day ORDER BY day`)
		.all(...values)
		.map((row) => ({
			day: row.day,
			requests: Number(row.requests),
			input_tokens: Number(row.input_tokens),
			output_tokens: Number(row.output_tokens),
			cache_read_tokens: Number(row.cache_read_tokens),
			cache_write_tokens: Number(row.cache_write_tokens),
		}));
}

/**
 * `heatmap` — per-day grand-total grid for one year (GitHub-style).
 * @param {import("node:sqlite").DatabaseSync} db
 * @param {{year?: number, dataSources?: unknown}} filters
 * @returns {Array<{day: string, total: number}>}
 */
export function queryHeatmap(db, filters = {}) {
	const year = Number.isFinite(filters.year) ? filters.year : new Date().getFullYear();
	const start = `${year}-01-01`;
	const end = `${year}-12-31`;
	const { clause, values } = eventWhere({ ...filters, from: undefined, to: undefined });
	// `eventWhere` already returns its fragment with the leading "WHERE ";
	// strip it once so the combined predicate below stays valid (REVIEW P0
	// found the previous `WHERE ${where}` here double-prefixed → syntax error;
	// the endpoint was never exercised before the RPC channel existed).
	const condition = [clause ? clause.replace(/^WHERE\s+/i, "") : "", `${DAY_SQL} BETWEEN ? AND ?`]
		.filter((part) => part.length > 0)
		.join(" AND ");
	const where = condition.length > 0 ? `WHERE ${condition}` : "";
	return db
		.prepare(`
SELECT ${DAY_SQL} AS day,
       SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens) AS total
FROM usage_events
${where}
GROUP BY day ORDER BY day`)
		.all(...values, start, end)
		.map((row) => ({ day: row.day, total: Number(row.total) }));
}

/**
 * `byModel` — aggregation per model.
 * @param {import("node:sqlite").DatabaseSync} db
 * @param {object} filters
 * @returns {Array<{model: string, requests: number, input_tokens: number,
 *   output_tokens: number, cache_read_tokens: number, cache_write_tokens: number}>}
 */
export function queryByModel(db, filters = {}) {
	const { clause, values } = eventWhere(filters);
	return db
		.prepare(`
SELECT COALESCE(model, '(unknown)') AS model,
       COUNT(*) AS requests,
       COALESCE(SUM(input_tokens), 0) AS input_tokens,
       COALESCE(SUM(output_tokens), 0) AS output_tokens,
       COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
       COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens
FROM usage_events ${clause}
GROUP BY COALESCE(model, '(unknown)')
ORDER BY requests DESC`)
		.all(...values)
		.map((row) => ({
			model: row.model,
			requests: Number(row.requests),
			input_tokens: Number(row.input_tokens),
			output_tokens: Number(row.output_tokens),
			cache_read_tokens: Number(row.cache_read_tokens),
			cache_write_tokens: Number(row.cache_write_tokens),
		}));
}

/**
 * `byProject` — aggregation per project (session cwd / cc cwd).
 * @param {import("node:sqlite").DatabaseSync} db
 * @param {object} filters
 * @returns {Array<{project: string, requests: number, input_tokens: number,
 *   output_tokens: number, cache_read_tokens: number, cache_write_tokens: number}>}
 */
export function queryByProject(db, filters = {}) {
	const { clause, values } = eventWhere(filters);
	return db
		.prepare(`
SELECT COALESCE(project, '(unknown)') AS project,
       COUNT(*) AS requests,
       COALESCE(SUM(input_tokens), 0) AS input_tokens,
       COALESCE(SUM(output_tokens), 0) AS output_tokens,
       COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
       COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens
FROM usage_events ${clause}
GROUP BY COALESCE(project, '(unknown)')
ORDER BY requests DESC`)
		.all(...values)
		.map((row) => ({
			project: row.project,
			requests: Number(row.requests),
			input_tokens: Number(row.input_tokens),
			output_tokens: Number(row.output_tokens),
			cache_read_tokens: Number(row.cache_read_tokens),
			cache_write_tokens: Number(row.cache_write_tokens),
		}));
}

/**
 * `byDay` — per-day aggregation.
 * @param {import("node:sqlite").DatabaseSync} db
 * @param {object} filters
 * @returns {Array<{day: string, requests: number, input_tokens: number,
 *   output_tokens: number, cache_read_tokens: number, cache_write_tokens: number}>}
 */
export function queryByDay(db, filters = {}) {
	const { clause, values } = eventWhere(filters);
	return db
		.prepare(`
SELECT ${DAY_SQL} AS day,
       COUNT(*) AS requests,
       COALESCE(SUM(input_tokens), 0) AS input_tokens,
       COALESCE(SUM(output_tokens), 0) AS output_tokens,
       COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
       COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens
FROM usage_events ${clause}
GROUP BY day ORDER BY day`)
		.all(...values)
		.map((row) => ({
			day: row.day,
			requests: Number(row.requests),
			input_tokens: Number(row.input_tokens),
			output_tokens: Number(row.output_tokens),
			cache_read_tokens: Number(row.cache_read_tokens),
			cache_write_tokens: Number(row.cache_write_tokens),
		}));
}

/**
 * `sessions` — per-session drill-down list (latest event's model/project ride
 * along via a window function over the filtered events).
 * @param {import("node:sqlite").DatabaseSync} db
 * @param {{project?: string, model?: string, from?: number, to?: number,
 *   dataSources?: unknown, limit?: number}} filters
 * @returns {Array<{session_id: string, data_source: string, ts: number,
 *   requests: number, input_tokens: number, output_tokens: number,
 *   cache_read_tokens: number, cache_write_tokens: number, model: string|null,
 *   project: string|null}>}
 */
export function querySessions(db, filters = {}) {
	const { clause: cteClause, values: cteValues } = eventWhere(filters);
	const { clause: joinClause, values: joinValues } = eventWhere(filters, "e.");
	const limit = Number.isFinite(filters.limit) ? Math.max(1, Math.min(500, Math.floor(filters.limit))) : 100;
	const row = db
		.prepare(`
WITH latest AS (
  SELECT session_id, data_source, model, project, ts,
         ROW_NUMBER() OVER (PARTITION BY session_id, data_source ORDER BY ts DESC, id DESC) AS rn
  FROM usage_events
  ${cteClause}
)
SELECT l.session_id, l.data_source, l.ts, l.model, l.project,
       COUNT(*) AS requests,
       SUM(e.input_tokens) AS input_tokens,
       SUM(e.output_tokens) AS output_tokens,
       SUM(e.cache_read_tokens) AS cache_read_tokens,
       SUM(e.cache_write_tokens) AS cache_write_tokens
FROM latest l
JOIN usage_events e ON e.session_id = l.session_id AND e.data_source = l.data_source
${joinClause ? joinClause + " AND" : "WHERE"} l.rn = 1
GROUP BY l.session_id, l.data_source
ORDER BY l.ts DESC
LIMIT ?`);
	const result = row.all(...cteValues, ...joinValues, limit);
	return result
		.map((r) => ({
			session_id: r.session_id,
			data_source: r.data_source,
			ts: Number(r.ts),
			requests: Number(r.requests),
			input_tokens: Number(r.input_tokens),
			output_tokens: Number(r.output_tokens),
			cache_read_tokens: Number(r.cache_read_tokens),
			cache_write_tokens: Number(r.cache_write_tokens),
			model: r.model,
			project: r.project,
		}));
}
//#endregion
