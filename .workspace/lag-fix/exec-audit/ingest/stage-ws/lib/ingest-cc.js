//#region lib/ingest-cc.js
/**
 * Claude Code transcription ingestion (AUDIT U07). Source:
 * `~/.claude/projects/…/*.jsonl` (main thread + `subagents/agent-*.jsonl`).
 * Dedup rides the B2-corrected `dedup_key` = `message.id ?? uuid` under
 * `UNIQUE(data_source, session_id, dedup_key)` — cc records have no
 * turn/step (both NULL), so the old `(turn, step)` key could never dedupe
 * (SQLite NULL ≠ NULL).
 *
 * Bucket correction (B3/B7): cc's `input_tokens` INCLUDES cache (read +
 * creation), so the uncached input is `max(0, input_tokens − cache_read −
 * cache_creation)`; `cache_creation_input_tokens` maps to cache_write.
 * Project attribution uses the record's authoritative `cwd`; the encoded
 * project-directory name (`-home-…-`, `-`→`_`) is only the fallback.
 * @module dsh-usage/ingest-cc
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { insertEvent, rebuildDailyForDays, upsertSyncState, getSyncState } from "./db.js";

/** cc projects root default. */
export const DEFAULT_CC_ROOT = () => resolve(homedir(), ".claude", "projects");

/**
 * Recursively enumerate cc transcription files.
 * @param {string} [root] - projects root (default `~/.claude/projects`).
 * @returns {Array<{file: string, mtime: number, size: number, isSubagent: boolean}>}
 */
export function enumerateCcFiles(root = DEFAULT_CC_ROOT()) {
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
			if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
			let stats;
			try {
				stats = statSync(path);
			} catch {
				continue;
			}
			out.push({
				file: path,
				mtime: Math.floor(stats.mtimeMs),
				size: stats.size,
				isSubagent: path.includes(`${sep}subagents${sep}`) || path.includes("/subagents/"),
			});
		}
	};
	walk(root);
	return out;
}

/**
 * Reverse-decode an encoded cc project-directory name: `-home-CNS…-Proj` →
 * `/home/CNS…/Proj` (`-`→`_` after the leading `-home-`); anything else
 * yields `(unknown)`.
 * @param {string} dirName
 * @returns {string}
 */
export function decodeCcProjectDir(dirName) {
	if (typeof dirName !== "string" || !dirName.startsWith("-home-")) return "(unknown)";
	try {
		return `/home/${dirName.slice("-home-".length).replace(/-/g, "_")}`;
	} catch {
		return "(unknown)";
	}
}

/**
 * Parse one cc record into a usage event (or null).
 * @param {object} o - parsed JSON line.
 * @param {{filename: string, isSubagent: boolean}} ctx
 * @returns {object|null} event in insertEvent shape, or null when the record
 *   carries no usage.
 */
export function parseCcLine(o, { filename, isSubagent } = {}) {
	if (!o || typeof o !== "object" || o.type !== "assistant") return null;
	const message = o.message;
	if (!message || typeof message !== "object" || !message.usage) return null;
	const usage = message.usage;
	const inputTokens = Number(usage.input_tokens ?? 0);
	const cacheRead = Number(usage.cache_read_input_tokens ?? 0);
	const cacheCreation = Number(usage.cache_creation_input_tokens ?? 0);
	const ts = Date.parse(o.timestamp);
	if (!Number.isFinite(ts)) return null;
	const filenameUuid = filename.replace(/\.jsonl$/i, "");
	const sessionId = typeof o.sessionId === "string" ? o.sessionId : typeof o.session_id === "string" ? o.session_id : isSubagent ? null : filenameUuid;
	if (sessionId === null) return null;
	const dedupKey = typeof message.id === "string" && message.id.length > 0 ? message.id : typeof o.uuid === "string" ? o.uuid : null;
	if (dedupKey === null) return null;
	const project =
		typeof o.cwd === "string" && o.cwd.length > 0 ? o.cwd : decodeCcProjectDir(basename(dirname(filename)));
	return {
		data_source: "cc",
		session_id: sessionId,
		dedup_key: dedupKey,
		ts,
		model: typeof message.model === "string" ? message.model : null,
		provider: "claude",
		project,
		turn: null,
		step: null,
		is_subagent: Boolean(isSubagent),
		input_tokens: Math.max(0, inputTokens - cacheRead - cacheCreation), // B3
		output_tokens: Number(usage.output_tokens ?? 0),
		cache_read_tokens: cacheRead,
		cache_write_tokens: cacheCreation, // B7: cache_creation → cache_write
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
 * Fold the whole cc source into the database (idempotent, incremental).
 * Byte cursor (`last_offset`) points at the end of the last COMPLETE line
 * (a torn final line without trailing `\n` is re-read next pass).
 * @param {import("node:sqlite").DatabaseSync} db
 * @param {string} [root] - projects root.
 * @param {{onProgress?: (info: {file: string, scanned: number, newEvents: number}) => void}} [options]
 * @returns {{scanned: number, newEvents: number, failedFiles: Array<{file: string, error: string}>}}
 */
export function foldCcSource(db, root, { onProgress } = {}) {
	const files = enumerateCcFiles(root);
	let scanned = 0;
	let newEvents = 0;
	const failedFiles = [];
	for (const { file, mtime, size, isSubagent } of files) {
		const source = `cc:${file}`;
		const state = getSyncState(db, source);
		if (state && state.mtime === mtime && state.size === size) {
			continue; // unchanged — skip
		}
		let buf;
		try {
			buf = readFileSync(file);
		} catch (error) {
			failedFiles.push({ file, error: describeError(error) });
			continue;
		}
		// Byte cursor: resume after the last complete line; a rewritten file
		// (size < cursor) falls back to a full rescan.
		let offset = 0;
		if (state && Number(state.last_offset) > 0) {
			const cursor = Number(state.last_offset);
			// 旧缺陷遗留游标：曾把 `size+1` 写进 last_offset（见下方 consumedBytes 修正）。
			// 对这类越界游标夹回 state.size —— 既不再跳过新内容首字节，也让当时被跳过的
			// 记录在下一轮被重新读入（自愈，不需要手工清 sync_state）。
			const legacyOverrun = Number(state.size) + 1 === cursor;
			const usable = legacyOverrun ? Number(state.size) : cursor;
			offset = size >= usable ? usable : 0;
		}
		const chunk = buf.subarray(offset);
		const text = chunk.toString("utf8");
		const rawLines = text.split("\n");
		const endsWithNewline = text.endsWith("\n");
		const completeLines = endsWithNewline ? rawLines : rawLines.slice(0, -1);
		// 已消费字节数 = 完整行的字节长度（含其换行）。⚠️ 文件以 `\n` 结尾时，
		// `completeLines.join("\n") + "\n"` 会比 text **多算 1 字节**（join 已带回该换行），
		// 于是 last_offset 被写成 size+1 → 下一轮 subarray(size+1) 跳过新内容首字节，
		// 追加批次的第一条记录被静默丢弃（实测复现，见
		// .workspace/lag-fix/research-v2/cc-cursor/repro-cc-cursor.mjs）。
		const consumedBytes = endsWithNewline
			? Buffer.byteLength(text)
			: Buffer.byteLength(completeLines.join("\n") + "\n");
		let badLines = 0;
		let fileInserted = 0;
		const affectedDays = new Set();
		db.exec("BEGIN");
		try {
			for (const line of completeLines) {
				const trimmed = line.trim();
				if (trimmed.length === 0) continue;
				let parsed;
				try {
					parsed = JSON.parse(trimmed);
				} catch {
					badLines += 1;
					continue;
				}
				const event = parseCcLine(parsed, { filename: basename(file), isSubagent });
				if (event === null) continue;
				const inserted = insertEvent(db, event);
				if (inserted) {
					fileInserted += 1;
				}
				// REVIEW P1: with "latest observation wins", a conflict-UPDATE
				// (streaming re-record overwriting an existing key with final
				// values) ALSO changes usage_events — its day must be rebuilt
				// for usage_daily to stay convergent (not just new inserts).
				affectedDays.add(localDay(event.ts));
			}
			db.exec("COMMIT");
		} catch (error) {
			db.exec("ROLLBACK");
			upsertSyncState(db, { source, mtime, size, fingerprint: `${mtime}:${size}` });
			failedFiles.push({ file, error: describeError(error) });
			continue;
		}
		if (badLines > 0) {
			failedFiles.push({ file, error: `${badLines} unparsable JSON lines` });
		}
		try {
			rebuildDailyForDays(db, [...affectedDays]);
		} catch (error) {
			failedFiles.push({ file, error: `daily rebuild: ${describeError(error)}` });
		}
		upsertSyncState(db, { source, mtime, size, last_offset: offset + consumedBytes, fingerprint: null });
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
