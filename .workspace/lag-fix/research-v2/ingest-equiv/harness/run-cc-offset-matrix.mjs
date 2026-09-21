#!/usr/bin/env node
/**
 * CC incremental-path matrix. `foldCcSource`'s resume branch is
 *   offset = (state.last_offset > 0 && size >= state.last_offset) ? state.last_offset : 0
 * so a seed whose `last_offset` is EXACTLY the current file size is the only way
 * to actually take the suffix path on the first fold. Three seeds are compared
 * baseline-vs-worker, plus a no-seed control:
 *
 *   A exact      last_offset = len(L1)        (mtime matches)  → suffix path
 *   B past-eof   last_offset = len(L1) + 1    (mtime matches)  → size >= cursor is FALSE → full rescan
 *   C shrink     last_offset = 10_000_000     (mtime matches)  → full rescan
 *   D control    no sync_state                                 → full read
 *
 * Usage: TZ=UTC node harness/run-cc-offset-matrix.mjs [--label L]
 */
import { Worker } from "node:worker_threads";
import { mkdirSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDeployed } from "./deployed-lib.mjs";

const { foldCcSource } = await loadDeployed("ingest-cc.js");
const { openUsageDb, upsertSyncState } = await loadDeployed("db.js");

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "out");
const argv = process.argv.slice(2);
const LABEL = (() => { const i = argv.indexOf("--label"); return i >= 0 ? argv[i + 1] : "cc-offset"; })();

const BASE = Math.floor(Date.UTC(2026, 8, 20, 12, 0, 0) / 1000);
const L = (n) => JSON.stringify({
	type: "assistant", sessionId: "off1", timestamp: `2026-09-20T10:0${n}:00.000Z`, cwd: "/p", uuid: `a${n}`,
	message: { id: `m-${n}`, model: "claude-sonnet-4", usage: { input_tokens: 10 * n, output_tokens: n, cache_read_input_tokens: 1, cache_creation_input_tokens: 2 } },
});
const B = (s) => Buffer.byteLength(s, "utf8");

const LINES = [L(1), L(2), L(3), L(4)];
const FULL = LINES.join("\n") + "\n";
const FILE_SIZE = B(FULL);
const SEEDS = [
	{ id: "A-exact-cursor", cursor: B(LINES[0] + "\n"), mtimeMatches: true, expect: "suffix path: only lines 2..4 parsed" },
	{ id: "B-cursor-past-eof", cursor: B(LINES[0] + "\n") + 1, mtimeMatches: true, expect: "size >= cursor FALSE → full rescan from 0" },
	{ id: "C-absurd-cursor", cursor: 10_000_000, mtimeMatches: true, expect: "size >= cursor FALSE → full rescan from 0" },
	{ id: "D-no-state", cursor: null, mtimeMatches: false, expect: "no sync_state → full read from 0" },
];

function build(dir) {
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(join(dir, "cc", "-home-CNS2026495165-dsh"), { recursive: true });
	const file = join(dir, "cc", "-home-CNS2026495165-dsh", "off1.jsonl");
	writeFileSync(file, FULL);
	utimesSync(file, BASE, BASE);
	return { ccRoot: join(dir, "cc"), file };
}

async function runBaseline(seed) {
	const dir = join(HERE, "..", "fixture", "_ccoffset", `${LABEL}-base-${seed.id}`);
	const { ccRoot } = build(dir);
	const dbPath = join(dir, "usage.db");
	const db = await openUsageDb(dbPath);
	if (seed.cursor !== null) {
		upsertSyncState(db, { source: `cc:${join(ccRoot, "-home-CNS2026495165-dsh", "off1.jsonl")}`, mtime: BASE, size: FILE_SIZE, last_offset: seed.cursor });
	}
	const result = foldCcSource(db, ccRoot, { onProgress: () => {} });
	const state = dump(db);
	db.close();
	return { result, state };
}

async function runWorker(seed) {
	const dir = join(HERE, "..", "fixture", "_ccoffset", `${LABEL}-cand-${seed.id}`);
	const { ccRoot } = build(dir);
	const dbPath = join(dir, "usage.db");
	const seedDb = await openUsageDb(dbPath);
	if (seed.cursor !== null) {
		upsertSyncState(seedDb, { source: `cc:${join(ccRoot, "-home-CNS2026495165-dsh", "off1.jsonl")}`, mtime: BASE, size: FILE_SIZE, last_offset: seed.cursor });
	}
	seedDb.close();
	const w = new Worker(new URL("./worker-cc-offset.mjs", import.meta.url), { workerData: { dbPath, ccRoot } });
	const out = await new Promise((res, rej) => { w.on("message", res); w.on("error", rej); });
	if (out.error) throw new Error(out.error);
	return { result: out.result, state: out.state };
}

function dump(db) {
	return {
		events: db.prepare("SELECT data_source, session_id, dedup_key, ts, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens FROM usage_events ORDER BY dedup_key").all(),
		daily: db.prepare("SELECT day, data_source, requests, input_tokens FROM usage_daily ORDER BY day, data_source").all(),
		// source path differs by root → compare only the numeric cursor fields
		sync: db.prepare("SELECT mtime, size, fingerprint, last_offset, last_seq FROM sync_state ORDER BY source").all(),
	};
}

const rootOf = (mode, id) => join(HERE, "..", "fixture", "_ccoffset", `${LABEL}-${mode}-${id}`);
/** The `error.file` field embeds the fixture root (which differs per mode), so
 * normalize it before comparing; everything else must match byte-for-byte. */
const normResult = (r, root) => ({
	scanned: r.scanned,
	newEvents: r.newEvents,
	failedFiles: r.failedFiles.map((f) => ({ file: f.file.split(root).join("<ROOT>"), error: f.error })),
});
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const rows = [];
for (const seed of SEEDS) {
	const a = await runBaseline(seed);
	const b = await runWorker(seed);
	a.result = normResult(a.result, rootOf("base", seed.id));
	b.result = normResult(b.result, rootOf("cand", seed.id));
	rows.push({
		seed: seed.id, cursor: seed.cursor, expect: seed.expect,
		resultEqual: eq(a.result, b.result), eventsEqual: eq(a.state.events, b.state.events),
		dailyEqual: eq(a.state.daily, b.state.daily), syncEqual: eq(a.state.sync, b.state.sync),
		equal: eq(a.result, b.result) && eq(a.state.events, b.state.events) && eq(a.state.daily, b.state.daily) && eq(a.state.sync, b.state.sync),
		baseline: a, candidate: b,
	});
}

const report = { label: LABEL, tz: process.env.TZ ?? "(unset)", fileSize: FILE_SIZE, firstLineBytes: B(LINES[0] + "\n"), rows,
	overall: rows.every((r) => r.equal) };
mkdirSync(OUT, { recursive: true });
const outPath = join(OUT, `cc-offset-${LABEL}.json`);
writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log(`\n===== CC OFFSET-RESUME MATRIX (${LABEL}, TZ=${report.tz}) =====`);
console.log(`file=${FILE_SIZE}B  firstLine=${report.firstLineBytes}B  (cursor "exact" = ${report.firstLineBytes})`);
for (const r of rows) {
	console.log(`\n-- ${r.seed} (cursor=${r.cursor}) --`);
	console.log(`   equal=${r.equal} (result=${r.resultEqual} events=${r.eventsEqual} daily=${r.dailyEqual} sync=${r.syncEqual})`);
	console.log(`   return : scanned=${r.baseline.result.scanned} newEvents=${r.baseline.result.newEvents} failed=${r.baseline.result.failedFiles.length}${r.baseline.result.failedFiles.length ? " " + r.baseline.result.failedFiles.map((f) => f.error).join("|") : ""}`);
	console.log(`   events : ${r.baseline.state.events.map((e) => e.dedup_key).join(",") || "(none)"}`);
	console.log(`   cursor : last_offset=${JSON.stringify(r.baseline.state.sync[0]?.last_offset)} (file=${FILE_SIZE})`);
}
console.log(`\nOVERALL: ${report.overall ? "PASS — identical in all 4 seed scenarios" : "FAIL"}`);
const lost = rows.filter((r) => r.baseline.state.events.length < 4).map((r) => r.seed);
console.log(`scenarios where fewer than 4 events landed: ${lost.length ? lost.join(", ") : "(none)"}`);
console.log(`raw JSON: ${outPath}`);
