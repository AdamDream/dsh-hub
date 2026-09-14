#!/usr/bin/env node
//#region smoke.mjs
/**
 * dsh-usage 独立冒烟脚本（执行档交付要求）。
 *
 * 对真实会话日志跑通 ingest 并输出聚合数字：
 *   - dsh 源：从 `~/.dsh/sessions/…/session.jsonl.zstd` 自动选取一个含 usage
 *     事件的会话（或 `--dsh FILE` 指定）；
 *   - cc 源：从 `~/.claude/projects/…/*.jsonl` 自动选取一个含 usage 事件的
 *     转录（或 `--cc FILE` 指定）；
 *   - 落库到临时 SQLite（默认 `data/smoke-<ts>.db`，可 `--db PATH` 覆盖），
 *     跑 zstd 多帧解码 → parse → INSERT OR IGNORE → 聚合查询，打印数字。
 *
 * 用法：
 *   node smoke.mjs
 *   node smoke.mjs --dsh ~/.dsh/sessions/…/session.jsonl.zstd --cc ~/.claude/projects/…/x.jsonl
 *   node smoke.mjs --db /tmp/smoke.db
 */
import { readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { enumerateDshSessions, parseDshSession } from "./lib/ingest-dsh.js";
import { enumerateCcFiles, parseCcLine } from "./lib/ingest-cc.js";
import { openUsageDb, ensureSchema, insertEvent, rebuildDailyForDays, querySummary, queryTimeseries, queryByModel, queryByProject, querySessions } from "./lib/db.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)));

function parseArgs(argv) {
	const args = { dsh: null, cc: null, db: null };
	for (let i = 0; i < argv.length; i += 1) {
		if (argv[i] === "--dsh") args.dsh = argv[i + 1];
		else if (argv[i] === "--cc") args.cc = argv[i + 1];
		else if (argv[i] === "--db") args.db = argv[i + 1];
	}
	return args;
}

function localDay(ts) {
	const d = new Date(ts);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 选一个含 usage 事件的 dsh 会话文件。 */
function pickDshFile() {
	for (const { file } of enumerateDshSessions()) {
		try {
			const { events, parseErrors } = parseDshSession(readFileSync(file));
			if (events.length > 0) return { file, events, parseErrors };
		} catch {
			// skip corrupt/empty files
		}
	}
	throw new Error("no dsh session file with usage events found under ~/.dsh/sessions");
}

/** 选一个含 usage 事件的 cc 转录文件。 */
function pickCcFile() {
	for (const { file, isSubagent } of enumerateCcFiles()) {
		let events = 0;
		try {
			for (const line of readFileSync(file, "utf8").split("\n")) {
				const trimmed = line.trim();
				if (!trimmed) continue;
				let o;
				try {
					o = JSON.parse(trimmed);
				} catch {
					continue;
				}
				if (parseCcLine(o, { filename: file.split("/").pop(), isSubagent })) events += 1;
			}
		} catch {
			continue;
		}
		if (events > 0) return { file, events };
	}
	throw new Error("no cc transcription file with usage events found under ~/.claude/projects");
}

const args = parseArgs(process.argv.slice(2));
const dbPath = args.db ?? join(ROOT, "data", `smoke-${Date.now()}.db`);

console.log("== dsh-usage smoke ==");
console.log("db:", dbPath);

const db = await openUsageDb(dbPath);
ensureSchema(db);

// ---- dsh 源 ----
let dshFile, dshEvents, dshParseErrors;
if (args.dsh) {
	const parsed = parseDshSession(readFileSync(args.dsh));
	dshFile = args.dsh;
	dshEvents = parsed.events;
	dshParseErrors = parsed.parseErrors;
} else {
	const picked = pickDshFile();
	dshFile = picked.file;
	dshEvents = picked.events;
	dshParseErrors = picked.parseErrors;
}
let dshInserted = 0;
const days = new Set();
db.exec("BEGIN");
try {
	for (const ev of dshEvents) {
		if (!Number.isFinite(ev.ts)) continue;
		const ok = insertEvent(db, {
			data_source: "dsh",
			session_id: "smoke-dsh",
			dedup_key: `t${ev.turn}:s${ev.step}`,
			ts: ev.ts,
			model: ev.model,
			provider: ev.provider,
			project: "smoke",
			turn: ev.turn,
			step: ev.step,
			is_subagent: false,
			input_tokens: ev.input_tokens,
			output_tokens: ev.output_tokens,
			cache_read_tokens: ev.cache_read_tokens,
			cache_write_tokens: ev.cache_write_tokens,
		});
		if (ok) {
			dshInserted += 1;
			days.add(localDay(ev.ts));
		}
	}
	db.exec("COMMIT");
} catch (error) {
	db.exec("ROLLBACK");
	throw error;
}
console.log("dsh file:", dshFile);
console.log("dsh parsed events:", dshEvents.length, "parseErrors:", dshParseErrors, "inserted:", dshInserted);

// ---- cc 源 ----
let ccFile, ccEvents = 0;
if (args.cc) {
	ccFile = args.cc;
	for (const line of readFileSync(ccFile, "utf8").split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		let o;
		try {
			o = JSON.parse(trimmed);
		} catch {
			continue;
		}
		const event = parseCcLine(o, { filename: ccFile.split("/").pop(), isSubagent: ccFile.includes("/subagents/") });
		if (event) {
			const ok = insertEvent(db, event);
			if (ok) {
				ccEvents += 1;
				days.add(localDay(event.ts));
			}
		}
	}
} else {
	const picked = pickCcFile();
	ccFile = picked.file;
	for (const line of readFileSync(ccFile, "utf8").split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		let o;
		try {
			o = JSON.parse(trimmed);
		} catch {
			continue;
		}
		const event = parseCcLine(o, { filename: ccFile.split("/").pop(), isSubagent: ccFile.includes("/subagents/") });
		if (event) {
			const ok = insertEvent(db, event);
			if (ok) {
				ccEvents += 1;
				days.add(localDay(event.ts));
			}
		}
	}
}
console.log("cc file:", ccFile);
console.log("cc inserted:", ccEvents);

rebuildDailyForDays(db, [...days]);

// ---- 聚合数字 ----
const summary = querySummary(db, { dataSources: "all" });
const timeseries = queryTimeseries(db, { dataSources: "all" });
const byModel = queryByModel(db, { dataSources: "all" });
const byProject = queryByProject(db, { dataSources: "all" });
const sessions = querySessions(db, { dataSources: "all", limit: 10 });
console.log("== aggregates ==");
console.log("summary:", JSON.stringify(summary));
console.log("timeseries days:", timeseries.length, JSON.stringify(timeseries));
console.log("byModel top:", byModel.slice(0, 3).map((r) => `${r.model}:${r.requests}`).join(", "));
console.log("byProject top:", byProject.slice(0, 3).map((r) => `${r.project}:${r.requests}`).join(", "));
console.log("sessions:", sessions.length, "first:", sessions[0] ? `${sessions[0].session_id} req=${sessions[0].requests}` : "n/a");
console.log("daily rows:", db.prepare("SELECT COUNT(*) AS n FROM usage_daily").get().n);
console.log("events total:", db.prepare("SELECT COUNT(*) AS n FROM usage_events").get().n);
console.log("== smoke ok ==");

db.close();
if (!args.db) {
	try {
		rmSync(dbPath, { force: true });
		rmSync(`${dbPath}-wal`, { force: true });
		rmSync(`${dbPath}-shm`, { force: true });
	} catch {
		// best effort cleanup
	}
}
//#endregion
