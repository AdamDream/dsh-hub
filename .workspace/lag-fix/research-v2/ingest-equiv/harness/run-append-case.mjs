#!/usr/bin/env node
/**
 * Real APPEND scenario (not a seeded stale cursor): fold once to establish the
 * byte cursor, append a new line to the very same file, fold again, and compare
 * baseline vs worker.
 *
 * This is the only way to genuinely exercise `foldCcSource`'s
 * `offset = size >= last_offset ? last_offset : 0` resume branch, because the
 * mtime/size gate only lets a fold proceed when the file actually changed.
 *
 * Usage: TZ=UTC node harness/run-append-case.mjs [--label L]
 */
import { Worker } from "node:worker_threads";
import { mkdirSync, rmSync, writeFileSync, appendFileSync, utimesSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDeployed } from "./deployed-lib.mjs";

const { foldCcSource } = await loadDeployed("ingest-cc.js");
const { openUsageDb } = await loadDeployed("db.js");

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "out");
const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const LABEL = argOf("--label", "append-case");
const BASE = Date.UTC(2026, 8, 20, 12, 0, 0) / 1000;
const at = (s) => BASE + s;

const L1 = JSON.stringify({ type: "assistant", sessionId: "app1", timestamp: "2026-09-20T10:00:00.000Z", cwd: "/p",
	uuid: "a1", message: { id: "m-1", model: "claude-sonnet-4", usage: { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 2, cache_creation_input_tokens: 3 } } });
const L2 = JSON.stringify({ type: "assistant", sessionId: "app1", timestamp: "2026-09-20T10:01:00.000Z", cwd: "/p",
	uuid: "a2", message: { id: "m-2", model: "claude-sonnet-4", usage: { input_tokens: 20, output_tokens: 2 } } });
const L3 = JSON.stringify({ type: "assistant", sessionId: "app1", timestamp: "2026-09-20T10:02:00.000Z", cwd: "/p",
	uuid: "a3", message: { id: "m-3", model: "claude-sonnet-4", usage: { input_tokens: 30, output_tokens: 3 } } });
const L4 = JSON.stringify({ type: "assistant", sessionId: "app1", timestamp: "2026-09-20T10:03:00.000Z", cwd: "/p",
	uuid: "a4", message: { id: "m-1", model: "claude-sonnet-4", usage: { input_tokens: 11, output_tokens: 99, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } });

const bytesOf = (lines) => Buffer.byteLength(lines.join("\n") + "\n");

/** Run the 3-phase append scenario (initial fold → append → re-fold) once. */
async function runOnce(mode) {
	const dir = join(HERE, "..", "fixture", "_append", `${LABEL}-${mode}`);
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
	const ccRoot = join(dir, "cc");
	mkdirSync(join(ccRoot, "-home-CNS2026495165-dsh"), { recursive: true });
	const file = join(ccRoot, "-home-CNS2026495165-dsh", "app1.jsonl");
	const dbPath = join(dir, "usage.db");

	writeFileSync(file, [L1, L2].join("\n") + "\n");
	utimesSync(file, at(0), at(0));
	const size0 = bytesOf([L1, L2]);

	const phases = [];
	const foldOn = (db) => foldCcSource(db, ccRoot, { onProgress: () => {} });
	const snap = (db) => ({
		events: db.prepare("SELECT data_source, session_id, dedup_key, ts, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens FROM usage_events ORDER BY dedup_key").all(),
		daily: db.prepare("SELECT day, data_source, requests, input_tokens, output_tokens FROM usage_daily ORDER BY day, data_source").all(),
		sync: db.prepare("SELECT mtime, size, fingerprint, last_offset, last_seq FROM sync_state ORDER BY source").all(),
	});

	if (mode === "baseline") {
		const db = await openUsageDb(dbPath);
		const r1 = foldOn(db);
		phases.push({ phase: "initial", size: size0, result: r1, state: snap(db) });

		// APPEND one new line, then a second append that REPLACES an existing key
		// (m-1 re-recorded with a LATER ts -> conflict UPDATE path).
		appendFileSync(file, L3 + "\n");
		utimesSync(file, at(30), at(30));
		const r2 = foldOn(db);
		phases.push({ phase: "append-new", size: bytesOf([L1, L2, L3]), result: r2, state: snap(db) });

		appendFileSync(file, L4 + "\n");
		utimesSync(file, at(60), at(60));
		const r3 = foldOn(db);
		phases.push({ phase: "append-conflict-update", size: bytesOf([L1, L2, L3, L4]), result: r3, state: snap(db) });

		// no-op pass: nothing changed -> mtime/size gate must skip
		const r4 = foldOn(db);
		phases.push({ phase: "unchanged-noop", size: bytesOf([L1, L2, L3, L4]), result: r4, state: snap(db) });
		db.close();
	} else {
		const script = [
			{ op: "fold", phase: "initial", size: size0 },
			{ op: "append", data: L3 + "\n", mtime: at(30) },
			{ op: "fold", phase: "append-new", size: bytesOf([L1, L2, L3]) },
			{ op: "append", data: L4 + "\n", mtime: at(60) },
			{ op: "fold", phase: "append-conflict-update", size: bytesOf([L1, L2, L3, L4]) },
			{ op: "fold", phase: "unchanged-noop", size: bytesOf([L1, L2, L3, L4]) },
		];
		const w = new Worker(new URL("./worker-append.mjs", import.meta.url), { workerData: { dbPath, ccRoot, file, script } });
		const out = await new Promise((res, rej) => { w.on("message", res); w.on("error", rej); });
		if (out.error) throw new Error(out.error);
		phases.push(...out.phases);
	}

	return { mode, dir, phases, expectedCursor: { size0, afterAppend1: bytesOf([L1, L2, L3]), afterAppend2: bytesOf([L1, L2, L3, L4]) } };
}

const baseline = await runOnce("baseline");
const candidate = await runOnce("candidate");
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** `failedFiles[].file` embeds the per-mode fixture root → normalize before comparing. */
const normResult = (r, root) => ({
	scanned: r.scanned,
	newEvents: r.newEvents,
	failedFiles: r.failedFiles.map((f) => ({ file: f.file.split(root).join("<ROOT>"), error: f.error })),
});
for (const ph of baseline.phases) ph.result = normResult(ph.result, baseline.dir);
for (const ph of candidate.phases) ph.result = normResult(ph.result, candidate.dir);

const rows = [];
for (let i = 0; i < baseline.phases.length; i += 1) {
	const a = baseline.phases[i], b = candidate.phases[i];
	rows.push({
		phase: a.phase,
		resultEqual: eq(a.result, b.result),
		eventsEqual: eq(a.state.events, b.state.events),
		dailyEqual: eq(a.state.daily, b.state.daily),
		syncEqual: eq(a.state.sync, b.state.sync),
		baselineResult: a.result, candidateResult: b.result,
		baselineSync: a.state.sync, candidateSync: b.state.sync,
		baselineEvents: a.state.events, candidateEvents: b.state.events,
		expectedSize: a.size ?? null,
	});
}

const report = { label: LABEL, tz: process.env.TZ ?? "(unset)", timestamp: new Date().toISOString(), baseline, candidate, rows,
	overall: rows.every((r) => r.resultEqual && r.eventsEqual && r.dailyEqual && r.syncEqual) };
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, `append-${LABEL}.json`), JSON.stringify(report, null, 2));

console.log(`\n===== APPEND / OFFSET-RESUME (${LABEL}, TZ=${report.tz}) =====`);
console.log(`expected byte geometry: size0=${baseline.expectedCursor.size0} afterAppend1=${baseline.expectedCursor.afterAppend1} afterAppend2=${baseline.expectedCursor.afterAppend2}`);
for (const r of rows) {
	console.log(`\n-- ${r.phase} -- resultEqual=${r.resultEqual} eventsEqual=${r.eventsEqual} dailyEqual=${r.dailyEqual} syncEqual=${r.syncEqual}`);
	console.log(`   fileSize=${r.expectedSize}  return: scanned=${r.baselineResult.scanned} newEvents=${r.baselineResult.newEvents} failed=${r.baselineResult.failedFiles.length}${r.baselineResult.failedFiles.length ? " " + r.baselineResult.failedFiles.map((f) => f.error).join("|") : ""}`);
	console.log(`   sync   : ${JSON.stringify(r.baselineSync)}`);
	console.log(`   events : ${r.baselineEvents.map((e) => `${e.dedup_key}(ts=${e.ts},in=${e.input_tokens},out=${e.output_tokens},cr=${e.cache_read_tokens},cw=${e.cache_write_tokens})`).join(" ")}`);
}
console.log(`\nOVERALL: ${report.overall ? "PASS — identical across all 4 phases" : "FAIL"}`);
console.log(`raw JSON: ${join(OUT, `append-${LABEL}.json`)}`);
