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
	// 2026-09-20 (audit §5 A2): the recompute used to filter with
	// `strftime('%Y-%m-%d', ts/1000,'unixepoch','localtime') IN (...)`, which
	// cannot use an index → `SCAN usage_events` on every ingest pass (150ms for
	// 3 affected days, 282ms for 31). Replaced by the equivalent 2) `ts`
	// half-open range [startMs, endMs) driven by `idx_events_ts`
	// (`SCAN` → `SEARCH ... USING INDEX idx_events_ts`), 150ms → 22ms, with
	// byte-identical output (verified: identical=true). The SELECT/GROUP BY day
	// expression is unchanged — it is the bucket key over the already-filtered
	// rows, not a filter.
	const lo = days.reduce((acc, day) => Math.min(acc, localDayMs(day)), Number.POSITIVE_INFINITY);
	const hiExclusive = days.reduce((acc, day) => Math.max(acc, localDayMs(day)), Number.NEGATIVE_INFINITY) + 86_400_000;
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
WHERE ts >= ? AND ts < ?
GROUP BY day, data_source, COALESCE(model, '(unknown)'), COALESCE(project, '(unknown)')`).run(lo, hiExclusive);
		db.exec("COMMIT");
	} catch (error) {
		db.exec("ROLLBACK");
		throw error;
	}
	// The just-recomputed days may include the newest one → refresh the
	// `MAX(day)` staleness gate that guards the usage_daily read route.
	invalidateMaxDailyDayCache();
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
/** 2026-09-18: hour-precision bucket key (`YYYY-MM-DD HH`), same local-time basis. */
const HOUR_SQL = "strftime('%Y-%m-%d %H', ts / 1000, 'unixepoch', 'localtime')";

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
 * `timeseries` — per-bucket four-token totals (trend chart).
 * 2026-09-18: `filters.granularity` selects the bucket width — `"day"`
 * (default, unchanged) or `"hour"` (`YYYY-MM-DD HH`, local time). The bucket
 * key keeps the wire field name `day` in both modes so the render layer,
 * tooltips and tables need no contract change.
 * @param {import("node:sqlite").DatabaseSync} db
 * @param {{granularity?: "day"|"hour"}} filters
 * @returns {Array<{day: string, requests: number, input_tokens: number,
 *   output_tokens: number, cache_read_tokens: number, cache_write_tokens: number}>}
 */
export function queryTimeseries(db, filters = {}) {
	const { clause, values } = eventWhere(filters);
	const bucketSql = filters.granularity === "hour" ? HOUR_SQL : DAY_SQL;
	return db
		.prepare(`
SELECT ${bucketSql} AS day,
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

/** Local-day helpers for the `usage_daily` route (2026-09-20, audit §4.5/A1).
 * Built on `getFullYear`/`getMonth`/`getDate` — never on fixed 86400000
 * arithmetic, which is what made the card's rolling window misaligned. */
function localDayOf(ms) {
	const d = new Date(ms);
	const p = (n) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
/** `YYYY-MM-DD` → local-midnight epoch ms (`new Date(y, m-1, d)` handles DST). */
function localDayMs(day) {
	const [y, m, d] = String(day).split("-").map(Number);
	return new Date(y, m - 1, d).getTime();
}
/** Whether `ms` sits exactly on a local midnight (the day-alignment gate). */
function isLocalDayStart(ms) {
	const d = new Date(ms);
	return d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0 && d.getMilliseconds() === 0;
}
/** Whether `ms` is the last millisecond of a local day (the inclusive `to`).
 * Anchor on the local-calendar next midnight instead of comparing `ms + 1`:
 * `1798732800000 + 1` is `.001` past midnight, not midnight, because the epoch
 * is a float — the naive form silently rejected every day-aligned `to`. */
function isLocalDayEnd(ms) {
	const d = new Date(ms);
	const nextMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
	return ms === nextMidnight - 1;
}
/** `MAX(day)` of the pre-aggregation table — null when it is empty. */
function queryMaxDailyDay(db) {
	const row = db.prepare("SELECT MAX(day) AS day FROM usage_daily").get();
	return row && typeof row.day === "string" && row.day.length > 0 ? row.day : null;
}
/**
 * `usage_daily` staleness gate (audit §4.5(2)): the pre-aggregation table is
 * only trusted for local days it has actually aggregated — i.e. `day <= MAX(day)`.
 * The margin is INGEST_INTERVAL_MS (45s, mirrors lib/index.js) so a
 * just-landed day is not raced; by the same token any ingest failure keeps the
 * affected days on the raw-events path instead of serving stale numbers.
 * `rebuildDailyForDays` invalidates the cache right after each ingest pass.
 */
const MAX_DAILY_DAY_TTL_MS = 45_000;
let maxDailyDayCache = { at: 0, value: null };
function maxDailyDayMs(db) {
	const now = Date.now();
	if (maxDailyDayCache.value !== null && now - maxDailyDayCache.at < MAX_DAILY_DAY_TTL_MS) {
		return maxDailyDayCache.value;
	}
	const day = queryMaxDailyDay(db);
	const value = day === null ? null : localDayMs(day);
	maxDailyDayCache = { at: now, value };
	return value;
}
/** Invalidate the `MAX(day)` cache (called after each `usage_daily` rewrite). */
export function invalidateMaxDailyDayCache() {
	maxDailyDayCache = { at: 0, value: null };
}
/** Row-shape adapter shared by both routes (identical column alias). */
const asDayTotals = (rows) => rows.map((row) => ({ day: row.day, total: Number(row.total) }));

/**
 * `heatmap` — per-day grand-total grid for one year (GitHub-style).
 *
 * 2026-09-20 (audit §5 A1+A2): the day bucket used to be filtered with
 * `strftime('%Y-%m-%d', ts/1000, 'unixepoch', 'localtime') BETWEEN ? AND ?`,
 * i.e. a per-row `strftime` over the whole table (`SCAN usage_events`) — 289ms
 * of synchronous SQLite work inside the host event loop per poll cycle.
 * Two changes, both read-only (no index is created, `usage.db` is never written):
 *   1. `usage_daily` fast path — the pre-aggregation table is a row-for-row
 *      mirror of `usage_events` (audit §4.2) and its PK starts with `day`, so a
 *      year of data costs ~0.05ms instead of 289ms.
 *   2. sargable fallback — the raw-events path now filters on a `ts` half-open
 *      range driven by `idx_events_ts` (`SCAN` → `SEARCH`), 289ms → ~162ms.
 *
 * Correctness gates (audit §4.5), both enforced HERE, host-side, so a client
 * that still sends a rolling window can never get a wrong number:
 *   (1) day-aligned window — `usage_daily` is day-granular, so an unaligned
 *       window rounded onto days would silently over-count (+1.29% at 30 days,
 *       up to +9.85% on a busy boundary day). Not aligned → raw events only.
 *   (2) `day <= MAX(day)` — days the ingest has not aggregated yet (typically
 *       today, and any day after an ingest failure) must come from raw events,
 *       never from a stale `usage_daily` row.
 * Because the year grid always extends past the last aggregated day, gate (2)
 * is applied as a WINDOW SPLIT rather than an all-or-nothing fallback: the part
 * of the window that is already aggregated is served by `usage_daily`, the
 * remainder by the sargable events query, and the two disjoint segments are
 * merged by day. Result: identical rows to the events-only query (verified
 * T3/T4/T5/T6), ~0.05ms instead of 289ms whenever the tail is empty.
 * @param {import("node:sqlite").DatabaseSync} db
 * @param {{year?: number, from?: number, to?: number, dataSources?: unknown}} filters
 * @returns {Array<{day: string, total: number}>}
 */
export function queryHeatmap(db, filters = {}) {
	const year = Number.isFinite(filters.year) ? filters.year : new Date().getFullYear();
	// Window: explicit from/to when the caller supplies them (rpc normalizeFilters
	// already validated them), else the whole requested local year
	// [1/1 00:00, next 1/1 00:00) — the shape the card actually requests.
	const hasFrom = Number.isFinite(filters.from);
	const hasTo = Number.isFinite(filters.to);
	// `from`/`to` are INCLUSIVE milliseconds (rpc + the old string `BETWEEN
	// '${year}-01-01' AND '${year}-12-31'` both are), so the internal half-open
	// upper edge is toExclusive = to + 1 — do NOT conflate the two: treating the
	// exclusive edge as the last millisecond silently drops the final day.
	const startMs = hasFrom ? filters.from : new Date(year, 0, 1).getTime();
	const toInclusive = hasTo ? filters.to : new Date(year + 1, 0, 1).getTime() - 1;
	const lo = Math.min(startMs, toInclusive);
	const hi = Math.max(startMs, toInclusive); // 请求上界（含）
	const toExclusive = hi + 1; // 内部半开上界
	// Gate (1): both edges must sit on local day boundaries (start of a day /
	// end of a day) for day-granular aggregation to be exact.
	const aligned = isLocalDayStart(lo) && isLocalDayEnd(hi);
	const maxDayMs = maxDailyDayMs(db);
	// 前置护栏（前瞻性，2026-09-20 复核加入）：`usage_daily` 的维度只有
	// (day, data_source, model, project) —— **没有 `is_subagent`、也没有 `provider`**。
	// 当前没有任何查询按这两列过滤（全插件 grep 只有建表/INSERT/迁移路径用到），
	// 但一旦将来有查询按它们过滤而仍走 daily，就会**静默把全量当成过滤结果**：
	// 实测 `is_subagent=1` 有 10,154 行（含 10 天）、`provider` 有 5 个取值
	// （adam/claude/opencode-go/deepseek-official/opencode），按 is_subagent 过滤时
	// daily 会多给 10,154 行（-9.7% 到 -100% 量级的静默错误）。
	// 因此这里做**按能力判断**：只要调用方带了 daily 表达不了的过滤维度，就整体回落
	// 到精确的 sargable events 路线。回退路径始终可用（`idx_events_ts` 已存在）。
	const DAILY_UNSUPPORTED_FILTERS = ["is_subagent", "provider"];
	const hasDailyUnsupportedFilter = DAILY_UNSUPPORTED_FILTERS.some((k) => filters[k] !== undefined && filters[k] !== null);
	// Gate (2): only days the ingest has already aggregated (`day <= MAX(day)`)
	// may come from `usage_daily`. The year grid always extends past that day, so
	// the aggregated SEGMENT is [lo, min(hi, MAX(day))] — `null maxDay` or an
	// empty intersection means no aggregated day at all → pure events path.
	// Segments are disjoint and merged by day below, so no day is counted twice.
	// Everything below is in EXCLUSIVE upper bounds: `dailyEndExclusive` is the
	// first instant after the last aggregated day. (Deriving an inclusive "end
	// of MAX(day)" as `dayStart + 86_400_000 - 1` loses 1ms to float precision
	// and left `tailFrom === toExclusive`, which still issued an empty-range
	// probe: ~10ms, because `idx_events_ts` is ~432 pages against a page cache
	// far smaller than the 35MB database.)
	const maxDayNextExclusive = maxDayMs === null ? Number.NEGATIVE_INFINITY : localDayMs(localDayOf(maxDayMs)) + 86_400_000;
	const dailyEndExclusive = Math.min(toExclusive, maxDayNextExclusive);
	const useDaily = aligned && maxDayMs !== null && lo < dailyEndExclusive && !hasDailyUnsupportedFilter;
	// Raw-events segment start: the whole window when there is no aggregated
	// segment, else the first instant after it. On the year-grid fast path a
	// window that ends at the last aggregated day yields tailFrom === toExclusive,
	// so the raw-events query is never issued (see the note above on the empty
	// probe cost).
	// 维度护栏命中（或窗口不日对齐 / 无已聚合日）时 useDaily=false → tailFrom=lo，
	// 即整个窗口都走精确的 sargable events 路线。
	const tailFrom = useDaily ? Math.min(dailyEndExclusive, toExclusive) : lo;
	const rows = [];
	if (useDaily) {
		// Days of the aggregated segment: localDayOf(lo) .. min(localDayOf(segmentEnd), maxDay).
		const dayFrom = localDayOf(lo);
		const dayTo = localDayOf(dailyEndExclusive - 1); // inclusive last aggregated day
		const parts = ["day >= ?", "day <= ?"];
		const values = [dayFrom, dayTo];
		const ds = dataSourceClause(filters.dataSources);
		if (ds.clause) {
			parts.push(ds.clause);
			values.push(...ds.values);
		}
		rows.push(...asDayTotals(db
			.prepare(`
SELECT day,
       SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens) AS total
FROM usage_daily
WHERE ${parts.join(" AND ")}
GROUP BY day ORDER BY day`)
			.all(...values)));
	}
	// Raw-events segment covers [tailFrom, toExclusive): skipped entirely on a
	// fully aggregated window (tailFrom === toExclusive), the whole window when it
	// is not day aligned, and the unaggregated remainder otherwise. Both segments
	// are REQUIRED whenever tailFrom < toExclusive — returning only the daily rows
	// here silently dropped that remainder (caught by the T6 harness on
	// 2026-09-20, see reports/unit-A.md).
	// Cheap existence precondition for the tail: `idx_events_ts` answers
	// `COUNT(*)` over an empty range in ~0.01ms, while running the grouped
	// `strftime` shape over that same empty range costs ~10ms because the
	// `data_source IN (...)` residual forces a walk of the UNIQUE index across
	// all ~105k rows (audit §3.6). The year grid always has a tail segment, so
	// this guard is what keeps the fast path at ~0.1ms.
	const tailHasRows = tailFrom < toExclusive
		&& Number(db.prepare("SELECT COUNT(*) AS c FROM usage_events WHERE ts >= ? AND ts < ?").get(tailFrom, toExclusive).c) > 0;
	if (tailHasRows) {
		const { clause, values } = eventWhere({ ...filters, from: undefined, to: undefined });
		// `eventWhere` already returns its fragment with the leading "WHERE ";
		// strip it once so the combined predicate below stays valid (REVIEW P0
		// found the previous `WHERE ${where}` here double-prefixed → syntax error;
		// the endpoint was never exercised before the RPC channel existed).
		// The day predicate is a `ts` half-open range (audit §3.1/§3.2), NOT a
		// per-row `strftime`: the grouping key stays DAY_SQL over the already-
		// filtered rows, so the output rows are identical to the old query.
		const condition = [clause ? clause.replace(/^WHERE\s+/i, "") : "", "ts >= ? AND ts < ?"]
			.filter((part) => part.length > 0)
			.join(" AND ");
		const where = condition.length > 0 ? `WHERE ${condition}` : "";
		rows.push(...asDayTotals(db
			.prepare(`
SELECT ${DAY_SQL} AS day,
       SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens) AS total
FROM usage_events
${where}
GROUP BY day ORDER BY day`)
			.all(...values, tailFrom, toExclusive)));
	}
	// Disjoint segments → a plain day-keyed merge is exact; sort keeps the
	// ascending-day contract the heatmap renderer expects.
	if (useDaily && tailHasRows) {
		const merged = new Map();
		for (const row of rows) merged.set(row.day, (merged.get(row.day) ?? 0) + row.total);
		return [...merged.entries()].map(([day, total]) => ({ day, total })).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
	}
	return rows;
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
