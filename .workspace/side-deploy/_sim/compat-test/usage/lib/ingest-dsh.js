//#region lib/ingest-dsh.js
/**
 * dsh session-log ingestion (AUDIT U06). Source: `~/.dsh/sessions/…/session.jsonl.zstd`
 * (multi-frame zstd, see lib/zstd.js). Folding is idempotent: every pass
 * re-parses CHANGED files (mtime/size gate), regenerates the full event set
 * with last-seen `request/header` attribution (B4), and relies on
 * `INSERT OR IGNORE` over `(data_source, session_id, dedup_key)` as the
 * 去重兜底 (B5) — unchanged files are skipped, so only genuinely new events
 * enter the DB. Byte cursor (`last_offset`, sync_state) is still tracked per
 * the audit's schema; `size < last_offset` (file rewritten) forces a full
 * rescan.
 * @module dsh-usage/ingest-dsh
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { dshHomePath } from "@deepseek-ai/dsh-home-paths";
import { decodeZstdBuffer, splitJsonLines } from "./zstd.js";
import { insertEvent, rebuildDailyForDays, upsertSyncState, getSyncState } from "./db.js";

/** Records that carry usage but are NOT requests (AUDIT B6) — excluded outright. */
const EXCLUDED_TYPES = new Set([
	"compaction/summary",
	"session/title-llm-request",
	"web/deepseek-search-llm-request",
]);

/**
 * Recursively enumerate dsh session artifacts.
 * @param {string} [root] - sessions root (default `dshHomePath('sessions')`).
 * @returns {Array<{file: string, mtime: number, size: number}>}
 */
export function enumerateDshSessions(root = dshHomePath("sessions")) {
	const out = [];
	const walk = (dir) => {
		let entries;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (entry.isSymbolicLink()) continue;
			const path = join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(path);
				continue;
			}
			if (!entry.isFile()) continue;
			if (entry.name !== "session.jsonl.zstd") continue;
			let stats;
			try {
				stats = statSync(path);
			} catch {
				continue;
			}
			out.push({ file: path, mtime: Math.floor(stats.mtimeMs), size: stats.size });
		}
	};
	walk(root);
	return out;
}

/**
 * Parse one session artifact buffer into session metadata + usage events.
 *
 * Event extraction (B5): `assistant/chunk` with `chunk.type==='usage'` is the
 * primary carrier; `assistant/message` with `data.usage` is the fallback —
 * the event set is the UNION of (turn,step) keys, chunk wins on collision.
 * `compaction/summary` / `session/title-llm-request` /
 * `web/deepseek-search-llm-request` are excluded (B6). provider/model come
 * from the nearest preceding `request/header` (`data.header.config`) by seq
 * order (B4). Buckets map (B7): input=inputTokens, output=outputTokens,
 * cache_read=cacheReadTokens, cache_write=0 (dsh has no cache-write field).
 * @param {Buffer} buf - full session artifact bytes.
 * @returns {{sessionMeta: {id?: string, createdAt?: number, cwd?: string}|null,
 *   events: Array<{turn: number, step: number, ts: number,
 *     input_tokens: number, output_tokens: number, cache_read_tokens: number,
 *     cache_write_tokens: number, provider: string|null, model: string|null}>,
 *   parseErrors: number, completeBytes: number, tornStart?: number}}
 */
export function parseDshSession(buf) {
	const { text, completeBytes, tornStart } = decodeZstdBuffer(buf);
	const lines = splitJsonLines(text);
	let sessionMeta = null;
	let parseErrors = 0;
	let currentHeader = null;
	/** Map keyed `turn:step` → event; chunk priority, message fallback (B5 union). */
	const byKey = new Map();
	for (const line of lines) {
		let record;
		try {
			record = JSON.parse(line);
		} catch {
			parseErrors += 1;
			continue;
		}
		if (!record || typeof record !== "object" || typeof record.type !== "string") continue;
		if (record.type === "session") {
			sessionMeta = {
				id: typeof record.id === "string" ? record.id : undefined,
				createdAt: typeof record.createdAt === "number" ? record.createdAt : undefined,
				cwd: typeof record.cwd === "string" ? record.cwd : undefined,
			};
			continue;
		}
		if (record.type === "request/header") {
			const config = record.data?.header?.config;
			if (config && typeof config === "object") {
				currentHeader = {
					provider: typeof config.provider === "string" ? config.provider : null,
					model: typeof config.model === "string" ? config.model : null,
				};
			}
			continue;
		}
		if (EXCLUDED_TYPES.has(record.type)) continue;
		const turn = record.data?.turn;
		const step = record.data?.step;
		if (typeof turn !== "number" || typeof step !== "number") continue;
		let usage = null;
		let isChunk = false;
		if (record.type === "assistant/chunk" && record.data?.chunk?.type === "usage" && record.data.chunk.usage) {
			usage = record.data.chunk.usage;
			isChunk = true;
		} else if (record.type === "assistant/message" && record.data?.usage) {
			usage = record.data.usage;
		}
		if (!usage || typeof usage !== "object") continue;
		const key = `${turn}:${step}`;
		if (isChunk || !byKey.has(key)) {
			byKey.set(key, {
				turn,
				step,
				ts: typeof record.time === "number" ? record.time : undefined,
				input_tokens: Number(usage.inputTokens ?? 0),
				output_tokens: Number(usage.outputTokens ?? 0),
				cache_read_tokens: Number(usage.cacheReadTokens ?? 0),
				cache_write_tokens: 0, // dsh has no cache-write field (B7)
				provider: currentHeader?.provider ?? null,
				model: currentHeader?.model ?? null,
			});
		}
	}
	return {
		sessionMeta,
		events: [...byKey.values()],
		parseErrors,
		completeBytes,
		tornStart,
	};
}

/** Local `YYYY-MM-DD` for a ms timestamp (matches db.js DAY_SQL semantics). */
function localDay(ts) {
	const date = new Date(ts);
	const mm = String(date.getMonth() + 1).padStart(2, "0");
	const dd = String(date.getDate()).padStart(2, "0");
	return `${date.getFullYear()}-${mm}-${dd}`;
}

/**
 * Fold the whole dsh source into the database (idempotent, incremental).
 * @param {import("node:sqlite").DatabaseSync} db
 * @param {string} [root] - sessions root.
 * @param {{onProgress?: (info: {file: string, scanned: number, newEvents: number}) => void}} [options]
 * @returns {{scanned: number, newEvents: number, failedFiles: Array<{file: string, error: string}>}}
 */
export function foldDshSource(db, root, { onProgress } = {}) {
	const files = enumerateDshSessions(root);
	let scanned = 0;
	let newEvents = 0;
	const failedFiles = [];
	for (const { file, mtime, size } of files) {
		const source = `dsh:${file}`;
		const state = getSyncState(db, source);
		if (state && state.mtime === mtime && state.size === size) {
			continue; // unchanged since last pass — skip
		}
		let buf;
		try {
			buf = readFileSync(file);
		} catch (error) {
			failedFiles.push({ file, error: describeError(error) });
			continue;
		}
		// File rewritten (shrunk below the previous cursor) → the whole file is
		// re-parsed anyway; see the header-attribution note in the module doc.
		// (The `size < last_offset` rule from U06 is honored via the mtime/size
		// gate + full reparse: a rewritten file fails the mtime/size equality
		// check and is re-scanned from scratch, INSERT OR IGNORE keeps it safe.)
		let parsed;
		try {
			parsed = parseDshSession(buf);
		} catch (error) {
			// Corrupt structure: record fingerprint, retry next round (U04).
			upsertSyncState(db, { source, mtime, size, fingerprint: `${mtime}:${size}` });
			failedFiles.push({ file, error: describeError(error) });
			continue;
		}
		if (parsed.parseErrors > 0) {
			failedFiles.push({ file, error: `${parsed.parseErrors} unparsable JSON lines` });
		}
		const sessionId = parsed.sessionMeta?.id ?? file;
		const project = parsed.sessionMeta?.cwd ?? null;
		const affectedDays = new Set();
		let fileInserted = 0;
		db.exec("BEGIN");
		try {
			for (const ev of parsed.events) {
				if (!Number.isFinite(ev.ts)) continue;
				const inserted = insertEvent(db, {
					data_source: "dsh",
					session_id: sessionId,
					dedup_key: `t${ev.turn}:s${ev.step}`,
					ts: ev.ts,
					model: ev.model,
					provider: ev.provider,
					project,
					turn: ev.turn,
					step: ev.step,
					is_subagent: false,
					input_tokens: ev.input_tokens,
					output_tokens: ev.output_tokens,
					cache_read_tokens: ev.cache_read_tokens,
					cache_write_tokens: ev.cache_write_tokens,
				});
				if (inserted) {
					fileInserted += 1;
				}
				// REVIEW P1: a conflict-UPDATE also changes usage_events, so its
				// day must be rebuilt for usage_daily to stay convergent (dsh
				// updates are value-identical, so this is a no-op rebuild).
				affectedDays.add(localDay(ev.ts));
			}
			db.exec("COMMIT");
		} catch (error) {
			db.exec("ROLLBACK");
			upsertSyncState(db, { source, mtime, size, fingerprint: `${mtime}:${size}` });
			failedFiles.push({ file, error: describeError(error) });
			continue;
		}
		// Incremental daily aggregation: only affected days are recomputed.
		try {
			rebuildDailyForDays(db, [...affectedDays]);
		} catch (error) {
			failedFiles.push({ file, error: `daily rebuild: ${describeError(error)}` });
		}
		// Advance the byte cursor to the last structurally complete frame —
		// never to raw file size (a torn tail must be re-read next pass).
		upsertSyncState(db, {
			source,
			mtime,
			size,
			fingerprint: parsed.tornStart !== undefined ? `torn:${parsed.tornStart}` : null,
			last_offset: parsed.completeBytes,
			last_seq: parsed.events.length > 0 ? parsed.events[parsed.events.length - 1].ts : null,
		});
		scanned += 1;
		newEvents += fileInserted;
		onProgress?.({ file, scanned, newEvents });
	}
	return { scanned, newEvents, failedFiles };
}

function describeError(error) {
	return error instanceof Error ? error.message : String(error);
}
//#endregion
