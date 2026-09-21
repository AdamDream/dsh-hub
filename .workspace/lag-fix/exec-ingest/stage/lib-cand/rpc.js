//#region lib/rpc.js
/**
 * Host RPC channel for the dsh-usage GUI (AUDIT U08; REVIEW P0 fix).
 *
 * 0.1.5 real API (verified against the installed `dsh-taste` 0.1.0 bridge.js
 * and `@deepseek-ai/dsh-client-connection` 0.1.5-rc.2 source, not guessed):
 *   const dispose = ctx.connection.register(ctx, "/usage", handle)
 * `register(owner, channel, handler)` internally runs
 * `owner.effect(() => owner.webServer.register(route))`, so the plugin ctx
 * MUST inject BOTH `connection` and `webServer` (the route binds to the
 * owner's ctx). The 0.1.1 `ctx.connection.rpc.handle('/usage', handler,
 * {authority})` API is structurally gone in 0.1.5: its route owner is the
 * connection service's own ctx, which has no `webServer` injected — taste's
 * comment: "0.1.1 `ctx.connection.rpc.handle` … structurally gone in 0.1.5".
 * The former loopback-authority intent is preserved by `requestRejection`
 * (Host/Origin fence + browser-session cookie) applied to every request.
 *
 * Handler shape (dsh-client-connection `rpcFetchHandler`): the handler's
 * return value is wrapped verbatim into the wire envelope, so it must be
 * `(endpoint, payload, signal) => ({ ok, value } | { ok: false, error })`.
 * The handler never throws into the HTTP layer (taste pattern): every
 * endpoint failure returns `{ ok: false, error: { code, message } }`.
 *
 * Endpoints (AUDIT C.4): `summary / timeseries / heatmap / byModel /
 * byProject / byDay / sessions / status / refresh`, all backed by the U05
 * aggregate queries in lib/db.js.
 * @module dsh-usage/rpc
 */

import {
	querySummary,
	queryTimeseries,
	queryHeatmap,
	queryByModel,
	queryByProject,
	queryByDay,
	querySessions,
} from "./db.js";

/** Registered endpoints (AUDIT C.4). */
const ENDPOINTS = new Set([
	"summary",
	"timeseries",
	"heatmap",
	"byModel",
	"byProject",
	"byDay",
	"sessions",
	"status",
	"refresh",
]);

/** `timeseries` granularity whitelist — day (default) or hour buckets. */
const GRANULARITIES = new Set(["day", "hour"]);

/** `dataSources` whitelist (single value or array items). */
const DATA_SOURCES = new Set(["dsh", "cc", "all"]);

/** `sessions.limit` bound (mirrors querySessions' internal clamp). */
const SESSIONS_LIMIT_MAX = 500;

/** Endpoint-level validation failure carrying a stable wire error code. */
class UsageRpcError extends Error {
	constructor(code, message) {
		super(message);
		this.code = code;
	}
}

/** Flatten any thrown value into one message line. */
function describeError(error) {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Parse a `from`/`to` filter: ms number or ISO-8601 string → ms number;
 * absent/empty → undefined.
 * @param {unknown} value
 * @param {string} name - filter name for the error message.
 * @returns {number|undefined}
 */
function parseTime(value, name) {
	if (value === undefined || value === null || value === "") return undefined;
	if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			throw new UsageRpcError("invalid-params", `usage: ${name} must be a finite ms timestamp`);
		}
		return value;
	}
	if (typeof value === "string") {
		const ms = Date.parse(value);
		if (!Number.isFinite(ms)) {
			throw new UsageRpcError("invalid-params", `usage: ${name} must be an ISO date or ms timestamp`);
		}
		return ms;
	}
	throw new UsageRpcError("invalid-params", `usage: ${name} must be a ms timestamp or ISO date string`);
}

/**
 * Validate the `dataSources` filter: `'dsh' | 'cc' | 'all'` or an array of
 * `'dsh' | 'cc'`. Returns the value unchanged (db.dataSourceClause already
 * understands all four shapes).
 * @param {unknown} value
 * @returns {unknown}
 */
function parseDataSources(value) {
	if (value === undefined || value === null) return undefined;
	const list = Array.isArray(value) ? value : [value];
	for (const item of list) {
		if (typeof item !== "string" || !DATA_SOURCES.has(item)) {
			throw new UsageRpcError(
				"invalid-params",
				`usage: dataSources must be 'dsh' | 'cc' | 'all' or an array of 'dsh'/'cc'`,
			);
		}
	}
	return value;
}

/**
 * Validate + normalize one endpoint payload into query filters
 * (`{from?, to?, dataSources?, model?, project?, year?, limit?}`).
 * Any violation throws {@link UsageRpcError} (→ `{ok:false,error}` wire).
 * @param {string} endpoint
 * @param {object} payload
 * @returns {object} filters accepted by the db.js query functions.
 */
function normalizeFilters(endpoint, payload) {
	const from = parseTime(payload.from, "from");
	const to = parseTime(payload.to, "to");
	if (from !== undefined && to !== undefined && from > to) {
		throw new UsageRpcError("invalid-params", "usage: from must be <= to");
	}
	const filters = { from, to, dataSources: parseDataSources(payload.dataSources) };
	if (typeof payload.model === "string" && payload.model.length > 0) filters.model = payload.model;
	if (typeof payload.project === "string" && payload.project.length > 0) filters.project = payload.project;
	if (endpoint === "timeseries") {
		const granularity = payload.granularity === undefined ? "day" : payload.granularity;
		if (typeof granularity !== "string" || !GRANULARITIES.has(granularity)) {
			throw new UsageRpcError("invalid-params", `usage: granularity must be one of [${[...GRANULARITIES].join(",")}]`);
		}
		// 2026-09-18: the validation above used to be dead weight — the accepted
		// value never reached the query layer, so `timeseries` was day-only in
		// practice no matter what the client asked for.
		filters.granularity = granularity;
	}
	if (endpoint === "heatmap") {
		if (payload.year !== undefined && !Number.isInteger(payload.year)) {
			throw new UsageRpcError("invalid-params", "usage: year must be an integer");
		}
		filters.year = payload.year;
	}
	if (endpoint === "sessions") {
		if (payload.limit !== undefined) {
			if (!Number.isInteger(payload.limit) || payload.limit < 1 || payload.limit > SESSIONS_LIMIT_MAX) {
				throw new UsageRpcError("invalid-params", `usage: limit must be an integer in 1..${SESSIONS_LIMIT_MAX}`);
			}
			filters.limit = payload.limit;
		}
	}
	return filters;
}

/**
 * Register the `/usage` RPC channel on the plugin context (0.1.5 posture).
 * @param {object} ctx - plugin context; `ctx.connection.register` must exist
 *   (`connection` is in the plugin's inject list) and `ctx.webServer` must be
 *   injected (`webServer` is in the plugin's inject list — the route owner).
 * @param {{db: import("node:sqlite").DatabaseSync|(() => import("node:sqlite").DatabaseSync|null),
 *   ingest?: () => Promise<void>, statusProvider: () => object}} deps - seams
 *   injected by lib/index.js. `db` may be a zero-arg getter (the DB opens in
 *   an async microtask after `apply` returns); when it yields null the
 *   handlers answer `{ok:false, error:{code:'db-unavailable'}}`. `ingest` is
 *   the shared ingest pass (`refresh` calls it, then returns status).
 *   `statusProvider` produces the `status` value (`{dbPath, dbSource,
 *   lastIngest, eventsDsh, eventsCc, scannedDsh, scannedCc, failedDsh,
 *   failedCc}` — client statusLine consumes `lastIngest/eventsDsh/eventsCc`).
 */
export function registerUsageRpc(ctx, deps) {
	const { ingest, statusProvider, waitIdle } = deps;
	const getDb = typeof deps.db === "function" ? deps.db : () => deps.db;

	const handle = async (endpoint, payload, _signal) => {
		if (typeof endpoint !== "string" || !ENDPOINTS.has(endpoint)) {
			return { ok: false, error: { code: "unknown-endpoint", message: `usage: unknown endpoint "${endpoint}"`, details: {} } };
		}
		try {
			if (endpoint === "refresh") {
				/* dsh-perf-fix Ingest-v1 (U-IG1.4): join the SINGLE in-flight ingest pass
				   instead of stacking a second fold (client.js polls `/usage/refresh` on a
				   timer and does no in-flight de-duplication of its own). `waitIdle` is
				   supplied by lib/index.js and means "join the running pass, else start
				   one"; when absent the previous `ingest()` path is kept verbatim.
				   NO data endpoint gets a barrier — see the audit: the COMMIT→rebuild
				   window is unobservable on all 9 endpoints, while a barrier would hand
				   the entire fold duration to query latency and destroy `status` progress
				   visibility (which is deliberate). */
				if (typeof waitIdle === "function") await waitIdle();
				else if (typeof ingest === "function") await ingest();
				return { ok: true, value: statusProvider() };
			}
			if (endpoint === "status") {
				return { ok: true, value: statusProvider() };
			}
			const db = getDb();
			if (db === null || db === undefined) {
				return { ok: false, error: { code: "db-unavailable", message: "usage: database not ready (first ingest pending)", details: {} } };
			}
			const filters = normalizeFilters(endpoint, payload ?? {});
			if (endpoint === "summary") return { ok: true, value: querySummary(db, filters) };
			if (endpoint === "timeseries") return { ok: true, value: queryTimeseries(db, filters) };
			if (endpoint === "heatmap") return { ok: true, value: queryHeatmap(db, { year: filters.year, dataSources: filters.dataSources }) };
			if (endpoint === "byModel") return { ok: true, value: queryByModel(db, filters) };
			if (endpoint === "byProject") return { ok: true, value: queryByProject(db, filters) };
			if (endpoint === "byDay") return { ok: true, value: queryByDay(db, filters) };
			if (endpoint === "sessions") return { ok: true, value: querySessions(db, filters) };
			return { ok: false, error: { code: "unknown-endpoint", message: `usage: unhandled endpoint "${endpoint}"`, details: {} } };
		} catch (error) {
			// instanceof, not error.code: fs errors carry their own `.code`.
			if (error instanceof UsageRpcError) {
				return { ok: false, error: { code: error.code, message: error.message, details: {} } };
			}
			return { ok: false, error: { code: "internal", message: describeError(error), details: {} } };
		}
	};

	// web profile（0.1.1-rc.2）register 姿势：`connection.register` 在此版本为
	// 私有 4 参方法（options 无默认值），0.1.5 姿势 `register(ctx, channel, handle)`
	// 会因 options 缺省抛 TypeError，导致插件 apply 同步失败、usage 不加载；
	// 改用 0.1.1 公开姿势 `ctx.connection.rpc.handle(channel, handler, options)`
	// （dsh-taste bridge.js 同款先例）。两条路径最终都汇入 rpcFetchHandler，
	// handler 信封 (endpoint, payload, signal) => ({ok,value}|{ok:false,error})
	// 形状不变，其余代码零改动。
	const dispose = ctx.connection.rpc.handle("/usage", handle, { authority: "loopback" });
	// The second bind is idempotent for teardown and keeps channel disposal
	// explicit and test-assertable (taste bridge.js ISSUE-5 pattern).
	ctx.effect(() => dispose, "dsh-usage.rpc.channel");
}
//#endregion
