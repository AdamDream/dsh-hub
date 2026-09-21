#!/usr/bin/env node
/**
 * Counterfactual controls — every headline assertion must FAIL when the fix is
 * removed, otherwise it is not measuring anything.
 *
 *   CF-A  `db.js` WITHOUT the U-IG3 fix (the deployed file + only the export the
 *         runner needs): the non-contiguous rebuild MUST throw
 *         `UNIQUE constraint failed: usage_daily...` (the audit's 11/11 defect).
 *   CF-B  `db.js` with 修法 B only (INSERT … ON CONFLICT, no interval
 *         alignment): the rebuild no longer throws, but the A4 invariant
 *         "produced ⊆ deleted" MUST be violated — i.e. the upsert hides the
 *         defect instead of fixing it.
 *   CF-C  `ingest-runner.js` with single-flight disabled: 10 concurrent `run()`
 *         calls MUST produce more than one worker-side `start`.
 *   CF-D  the candidate PASSES all three of the same assertions (so the
 *         counterfactuals are not just "everything fails").
 *
 * Each row's `ok` means "the counterfactual behaved as predicted". A row failing
 * means an assertion has no teeth and the corresponding claim is unsupported.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join, resolve } from "node:path";
import { EQUIV_FIXTURE_MODULE, LIB_CAND, LIB_ORIG, SCRATCH, assertionTable, freshDir, injectIg3Probe, loadLib, makeRunner, readIg3Probe, seedDatabase, variantLib, writeJson } from "./lib/harness.mjs";

const argv = process.argv.slice(2);
const value = (name, fallback) => {
	const withEquals = argv.find((item) => item.startsWith(`${name}=`));
	if (withEquals !== undefined) return withEquals.slice(name.length + 1);
	const index = argv.indexOf(name);
	return index >= 0 && index + 1 < argv.length ? argv[index + 1] : fallback;
};
const LIB = resolve(value("--lib", LIB_CAND));
const TAP_WORKER = join(process.cwd(), "tests", "workers", "tap-worker.mjs");

const { writeFixtures, seedSyncState } = await import(EQUIV_FIXTURE_MODULE);
const root = freshDir(join(SCRATCH, "counterfactual"));

const DAYS = ["2026-08-19", "2026-08-20", "2026-08-21", "2026-08-22", "2026-08-24", "2026-08-25"];
const REQUESTED = ["2026-08-19", "2026-08-20", "2026-08-24", "2026-08-25"];
const noonOf = (day) => {
	const [y, m, d] = day.split("-").map(Number);
	return new Date(y, m - 1, d, 12, 0, 0, 0).getTime();
};

/**
 * Run the non-contiguous rebuild scenario against one lib.
 * @returns {{threw: string|null, a4Violation: boolean, deleted: string[]|null, produced: string[]|null}}
 */
async function scenario(useLib, dbPath) {
	const db = await useLib.db.openUsageDb(dbPath);
	let n = 0;
	for (const day of DAYS) {
		for (const [model, project] of [
			["m-1", "/p/one"],
			["m-2", "/p/two"],
		]) {
			n += 1;
			useLib.db.insertEvent(db, {
				data_source: "dsh",
				session_id: `s${n}`,
				dedup_key: `t1:s${n}`,
				ts: noonOf(day),
				model,
				project,
				turn: 1,
				step: n,
				input_tokens: 10,
				output_tokens: 20,
				cache_read_tokens: 1,
				cache_write_tokens: 2,
			});
		}
	}
	const insert = db.prepare(
		"INSERT INTO usage_daily (day, data_source, model, project, requests, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens) VALUES (?,?,?,?,?,?,?,?,?)",
	);
	for (const day of DAYS) {
		insert.run(day, "dsh", "m-1", "/p/one", 999, 999, 999, 999, 999);
		insert.run(day, "dsh", "m-2", "/p/two", 999, 999, 999, 999, 999);
	}
	let threw = null;
	try {
		useLib.db.rebuildDailyForDays(db, REQUESTED);
	} catch (error) {
		threw = error instanceof Error ? error.message : String(error);
	}
	const probes = readIg3Probe(db);
	const violations = [];
	for (const probe of probes) {
		const deleted = new Set(probe.deleted);
		for (const day of probe.produced) if (!deleted.has(day)) violations.push(day);
	}
	const staleSurvivors = db.prepare("SELECT DISTINCT day FROM usage_daily WHERE requests = 999 ORDER BY day").all().map((row) => row.day);
	db.close();
	return {
		threw,
		probeCalls: probes.length,
		lastProbe: probes.at(-1) ?? null,
		a4Violations: violations,
		a4Violation: violations.length > 0,
		staleSurvivors,
	};
}

const rows = [];
const evidence = {};

// ------------------------------------------------------- CF-A: no U-IG3 fix
{
	const libDir = variantLib("noig3", (file, source) => injectIg3Probe(file, source), LIB_ORIG);
	const useLib = await loadLib(libDir);
	const result = await scenario(useLib, join(root, "noig3.db"));
	evidence.cfA = result;
	rows.push({
		id: "CF-A:without-the-fix-the-rebuild-throws-UNIQUE",
		ok: /UNIQUE constraint failed: usage_daily/.test(result.threw ?? ""),
		detail: `threw=${JSON.stringify(result.threw)} (the exact production error text)`,
	});
}

// ------------------------------------------------- CF-B: upsert only (fix B)
{
	const libDir = variantLib("fixBonly", (file, source) => {
		if (file !== "db.js") return source;
		const anchor = "`).run(lo, hiExclusive);";
		if (!source.includes(anchor)) throw new Error("CF-B anchor missing");
		const upsert =
			"`)\nON CONFLICT(day, data_source, model, project) DO UPDATE SET\n" +
			"  requests = excluded.requests,\n  input_tokens = excluded.input_tokens,\n" +
			"  output_tokens = excluded.output_tokens,\n  cache_read_tokens = excluded.cache_read_tokens,\n" +
			"  cache_write_tokens = excluded.cache_write_tokens`.run(lo, hiExclusive);";
		const withUpsert = source.replace(anchor, upsert);
		// …and be explicit: no interval alignment in this variant
		if (withUpsert.includes("spanDays")) throw new Error("CF-B must not carry fix A");
		return injectIg3Probe(file, withUpsert);
	}, LIB_ORIG);
	const useLib = await loadLib(libDir);
	const result = await scenario(useLib, join(root, "fixBonly.db"));
	evidence.cfB = result;
	rows.push({
		id: "CF-B:upsert-alone-hides-the-defect-instead-of-fixing-it",
		ok: result.threw === null && result.a4Violation === true,
		detail: `threw=${JSON.stringify(result.threw)}; instrumented rebuilds=${result.probeCalls}; A4 violations (produced days the DELETE never covered)=${JSON.stringify(result.a4Violations)}; deleted=${JSON.stringify(result.lastProbe?.deleted)} produced=${JSON.stringify(result.lastProbe?.produced)} — the upsert REPLACED the stale rows instead of deleting them, i.e. it hid the defect`,
	});
}

// ------------------------------------------------------ CF-C: no single-flight
{
	const libDir = variantLib("nosingleflight", (file, source) => {
		if (file !== "ingest-runner.js") return source;
		const anchor = "\t\tif (inFlight !== null) return inFlight;\n";
		if (!source.includes(anchor)) throw new Error("CF-C anchor missing");
		return source.replace(anchor, "\t\tif (false && inFlight !== null) return inFlight; // counterfactual: single-flight disabled\n");
	});
	const fixture = writeFixtures(join(root, "cfc-fx"));
	const dbPath = join(root, "cfc.db");
	const seedDb = await seedDatabase(libDir, dbPath, (db) => seedSyncState(db, fixture));
	seedDb.close();
	const tapLog = join(root, "cfc-tap.log");
	writeFileSync(tapLog, "");
	process.env.INGEST_TAP_LOG = tapLog;
	process.env.INGEST_TAP_REAL_WORKER = join(libDir, "ingest-worker.js");
	const runner = await makeRunner(libDir, { dbPath, dshRoot: fixture.dshRoot, ccRoot: fixture.ccRoot, workerUrl: TAP_WORKER, stallMs: 5_000 });
	const wave = Array.from({ length: 10 }, () => runner.run());
	const deadline = new Promise((done) => setTimeout(() => done("deadline"), 8_000));
	const settled = await Promise.race([Promise.allSettled(wave), deadline]);
	const starts = readFileSync(tapLog, "utf8").split("\n").filter((line) => line.startsWith("start ")).length;
	await runner.dispose();
	const settledCount = Array.isArray(settled) ? settled.filter((entry) => entry.status === "fulfilled").length : 0;
	evidence.cfC = { starts, settledCount, deadlineHit: settled === "deadline", stats: runner.stats() };
	rows.push({
		id: "CF-C:without-single-flight-ten-callers-stack-multiple-folds",
		ok: starts > 1,
		detail: `worker-side starts=${starts} (expected >1), settled=${settledCount}/10${settled === "deadline" ? " with a deadline hit (the extra concurrent requests clobber the runner's single pending slot)" : ""}`,
	});
}

// ------------------------------------------- CF-D: the candidate passes all three
{
	const candidateProbeLib = variantLib("candidateprobe", (file, source) => injectIg3Probe(file, source));
	const useLib = await loadLib(candidateProbeLib);
	const result = await scenario(useLib, join(root, "candidate.db"));
	const fixture = writeFixtures(join(root, "cfd-fx"));
	const dbPath = join(root, "cfd.db");
	const seedDb = await seedDatabase(LIB, dbPath, (db) => seedSyncState(db, fixture));
	seedDb.close();
	const tapLog = join(root, "cfd-tap.log");
	writeFileSync(tapLog, "");
	process.env.INGEST_TAP_LOG = tapLog;
	process.env.INGEST_TAP_REAL_WORKER = join(LIB, "ingest-worker.js");
	const runner = await makeRunner(LIB, { dbPath, dshRoot: fixture.dshRoot, ccRoot: fixture.ccRoot, workerUrl: TAP_WORKER });
	const wave = Array.from({ length: 10 }, () => runner.run());
	const settled = await Promise.all(wave);
	const starts = readFileSync(tapLog, "utf8").split("\n").filter((line) => line.startsWith("start ")).length;
	const stats = runner.stats();
	await runner.dispose();
	evidence.cfD = { scenario: result, starts, stats };
	rows.push({
		id: "CF-D:the-candidate-passes-the-same-three-assertions",
		ok: result.threw === null && result.a4Violation === false && result.probeCalls > 0 && result.staleSurvivors.length === 0 && starts === 1 && settled.every((entry) => entry.ok === true),
		detail: `threw=${JSON.stringify(result.threw)}; A4 violations=${JSON.stringify(result.a4Violations)}; deleted=${JSON.stringify(result.lastProbe?.deleted)} produced=${JSON.stringify(result.lastProbe?.produced)}; staleSurvivors=${JSON.stringify(result.staleSurvivors)}; workerStarts=${starts}; allOk=${settled.every((entry) => entry.ok === true)}`,
	});
}

const table = assertionTable(rows);
const record = { suite: "counterfactual-controls", lib: LIB, rows, evidence, pass: table.failed === 0 };
writeJson("counterfactuals.json", record);
process.stdout.write(`\n### Counterfactual controls — candidate lib=${LIB.split("/").slice(-2).join("/")}\n${table.text}\nRESULT: ${record.pass ? "PASS" : "FAIL"}\n`);
process.exit(record.pass ? 0 : 1);
