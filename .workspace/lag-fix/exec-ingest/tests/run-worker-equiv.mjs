#!/usr/bin/env node
/**
 * E1 — Ingest-v1 equivalence: WORKER path vs the original SYNCHRONOUS fold path.
 *
 * Method (mirrors `research-v2/ingest-equiv/harness/run.mjs`, and reuses its
 * synthetic fixture verbatim):
 *   - baseline  : host-thread fold through the lib under test (`foldDshSource` →
 *                 `foldCcSource`, then an idempotent second pass, then a pass
 *                 over the empty "clean" root).
 *   - candidate : the SAME call sequence, executed inside `ingest-worker.js` via
 *                 `ingest-runner.js` (the worker opens its OWN connection to the
 *                 very same db path — `DatabaseSync` cannot cross threads).
 *   - 9 comparison faces: the six returned result objects + `usage_events` +
 *                 `usage_daily` + `sync_state` (including `last_offset`).
 *   - the final state is always read through a brand-new read-only connection.
 *   - both fixture roots are independent and normalized to `<ROOT>`, so the
 *     comparison cannot be satisfied by shared state.
 *
 * Run through `tests/run-equiv-suite.sh` (it loops the 3 timezones and both libs).
 */

import { appendFileSync, utimesSync } from "node:fs";
import { join, resolve } from "node:path";
import {
	EQUIV_FIXTURE_MODULE,
	LIB_CAND,
	LIB_ORIG,
	SCRATCH,
	assertionTable,
	diffFaces,
	freshDir,
	loadLib,
	makeRunner,
	readSnapshot,
	rootNormalizer,
	runSyncPass,
	seedDatabase,
	writeJson,
} from "./lib/harness.mjs";

const argv = process.argv.slice(2);
const value = (name, fallback) => {
	const withEquals = argv.find((item) => item.startsWith(`${name}=`));
	if (withEquals !== undefined) return withEquals.slice(name.length + 1);
	const index = argv.indexOf(name);
	return index >= 0 && index + 1 < argv.length ? argv[index + 1] : fallback;
};
const LIB = resolve(value("--lib", LIB_CAND));
const LABEL = value("--label", "run");
/* The deployed `ingest-cc.js` carries the known CC cursor off-by-one (audit
   C3/C4): after a pass it stores `last_offset = size + 1`, so the next pass
   restarts one byte past the previous end and LOSES the appended record.
   U-CC1 (a different writer, applied in the same restart batch) fixes it; this
   flag lets the suite assert the append stage really lands with that fix and
   documents the pre-fix behaviour instead of failing on it. */
const EXPECT_APPEND_NEW_EVENTS = Number(value("--expect-append-new-events", "0"));
const TZ = process.env.TZ ?? "(system)";

const { writeFixtures, seedSyncState, FIXED_MTIME } = await import(EQUIV_FIXTURE_MODULE);

/* Identical bytes appended to BOTH fixture roots before the 3rd pass — this is
   what puts the CC byte cursor / `last_offset` progression under test (the
   audit's "append" stage). The mtime is re-pinned so the mtime/size gate sees
   exactly the same input on both sides. */
const APPEND_LINE = `${JSON.stringify({
	type: "assistant",
	sessionId: "ccsess1",
	timestamp: "2026-09-18T10:10:00.000Z",
	cwd: "/home/CNS2026495165/dsh",
	uuid: "u-appended",
	message: { id: "msg-appended", model: "claude-sonnet-4", usage: { input_tokens: 21, output_tokens: 22, cache_read_input_tokens: 3 } },
})}\n`;
const APPEND_MTIME = FIXED_MTIME + 60;

const root = freshDir(join(SCRATCH, `equiv-${LABEL}`));
const lib = await loadLib(LIB);

// ------------------------------------------------------------ baseline (sync)
const syncRoot = join(root, "sync");
const fxSync = writeFixtures(syncRoot);
const syncDbPath = join(syncRoot, "usage.db");
let syncDb = await seedDatabase(LIB, syncDbPath, (db) => seedSyncState(db, fxSync));
const syncFirst = runSyncPass(lib, syncDb, fxSync.dshRoot, fxSync.ccRoot);
const syncSecond = runSyncPass(lib, syncDb, fxSync.dshRoot, fxSync.ccRoot);
appendFileSync(fxSync.ccMain, APPEND_LINE);
utimesSync(fxSync.ccMain, APPEND_MTIME, APPEND_MTIME);
const syncAppend = runSyncPass(lib, syncDb, fxSync.dshRoot, fxSync.ccRoot);
const syncClean = runSyncPass(lib, syncDb, fxSync.cleanRoot, fxSync.cleanRoot);
syncDb.close(); // final state must be read through a NEW connection
syncDb = null;

// ---------------------------------------------------------- candidate (worker)
const workerRoot = join(root, "worker");
const fxWorker = writeFixtures(workerRoot);
const workerDbPath = join(workerRoot, "usage.db");
const seedDb = await seedDatabase(LIB, workerDbPath, (db) => seedSyncState(db, fxWorker));
seedDb.close(); // the worker must open its OWN connection

const runnerMain = await makeRunner(LIB, { dbPath: workerDbPath, dshRoot: fxWorker.dshRoot, ccRoot: fxWorker.ccRoot });
const workerFirst = await runnerMain.run();
const workerSecond = await runnerMain.run();
appendFileSync(fxWorker.ccMain, APPEND_LINE);
utimesSync(fxWorker.ccMain, APPEND_MTIME, APPEND_MTIME);
const workerAppend = await runnerMain.run();
const mainStats = runnerMain.stats();
await runnerMain.dispose();

const runnerClean = await makeRunner(LIB, { dbPath: workerDbPath, dshRoot: fxWorker.cleanRoot, ccRoot: fxWorker.cleanRoot });
const workerClean = await runnerClean.run();
await runnerClean.dispose();

const normalize = rootNormalizer(syncRoot, workerRoot);
const snapshotSync = readSnapshot(syncDbPath, normalize);
const snapshotWorker = readSnapshot(workerDbPath, normalize);

const workerTurns = (result) => ({
	dsh: { scanned: result.dsh.scanned, newEvents: result.dsh.newEvents, failedFiles: result.dsh.failedFiles },
	cc: { scanned: result.cc.scanned, newEvents: result.cc.newEvents, failedFiles: result.cc.failedFiles },
});

const faces = {
	return_dshFirst: [syncFirst.dsh, workerTurns(workerFirst).dsh],
	return_ccFirst: [syncFirst.cc, workerTurns(workerFirst).cc],
	return_dshSecond: [syncSecond.dsh, workerTurns(workerSecond).dsh],
	return_ccSecond: [syncSecond.cc, workerTurns(workerSecond).cc],
	return_dshAppend: [syncAppend.dsh, workerTurns(workerAppend).dsh],
	return_ccAppend: [syncAppend.cc, workerTurns(workerAppend).cc],
	return_dshClean: [syncClean.dsh, workerTurns(workerClean).dsh],
	return_ccClean: [syncClean.cc, workerTurns(workerClean).cc],
	db_usage_events: [snapshotSync.usage_events, snapshotWorker.usage_events],
	db_usage_daily: [snapshotSync.usage_daily, snapshotWorker.usage_daily],
	db_sync_state: [snapshotSync.sync_state, snapshotWorker.sync_state],
};

const rows = [];
const diffs = {};
for (const [name, [left, right]] of Object.entries(faces)) {
	const normalizedLeft = JSON.parse(JSON.stringify(normalize(left)));
	const normalizedRight = JSON.parse(JSON.stringify(normalize(right)));
	const found = diffFaces(normalizedLeft, normalizedRight, name);
	diffs[name] = found;
	rows.push({ id: `face:${name}`, ok: found.length === 0, detail: found.length === 0 ? "byte-identical" : `${found.length} difference(s): ${JSON.stringify(found[0]).slice(0, 400)}` });
}

const allOk = rows.every((row) => row.ok);
rows.push({ id: "worker:results-ok", ok: workerFirst.ok && workerSecond.ok && workerAppend.ok && workerClean.ok, detail: JSON.stringify({ first: workerFirst.ok, second: workerSecond.ok, append: workerAppend.ok, clean: workerClean.ok }) });
rows.push({ id: "worker:persistent-worker-reused", ok: workerSecond.ok && workerAppend.ok && mainStats.runs === 3 && mainStats.workerSpawns === 1, detail: `runs=${mainStats.runs} workerSpawns=${mainStats.workerSpawns} (one persistent worker reused across passes)` });
rows.push({ id: "append:exercised", ok: syncAppend.cc.scanned === 1 && syncAppend.cc.newEvents === EXPECT_APPEND_NEW_EVENTS,
	detail: `cc append pass scanned=${syncAppend.cc.scanned} newEvents=${syncAppend.cc.newEvents} failed=${syncAppend.cc.failedFiles.length} (expected newEvents=${EXPECT_APPEND_NEW_EVENTS}; the pre-fix ingest-cc.js cursor off-by-one loses the appended record — both paths lose it IDENTICALLY, which is what the faces above prove)` });
rows.push({ id: "fixture:non-vacuous", ok: snapshotSync.counts.events > 0 && snapshotSync.counts.sync > 0, detail: `events=${snapshotSync.counts.events} daily=${snapshotSync.counts.daily} sync=${snapshotSync.counts.sync}` });

const table = assertionTable(rows);
const record = {
	suite: "E1-worker-vs-sync-equivalence",
	expectAppendNewEvents: EXPECT_APPEND_NEW_EVENTS,
	tz: TZ,
	lib: LIB,
	label: LABEL,
	libIsCandidate: LIB === LIB_CAND,
	libIsOriginal: LIB === LIB_ORIG,
	pass: table.failed === 0 && allOk,
	counts: { sync: snapshotSync.counts, worker: snapshotWorker.counts },
	results: {
		syncFirst,
		syncSecond,
		syncAppend,
		syncClean,
		workerFirst,
		workerSecond,
		workerAppend,
		workerClean,
		stats: mainStats,
	},
	diffs,
	rows,
};
writeJson(`equiv-${LABEL}-${TZ.replace(/\//g, "-")}.json`, record);

process.stdout.write(`\n### E1 equivalence — TZ=${TZ} lib=${LIB.split("/").slice(-2).join("/")} (${LABEL})\n`);
process.stdout.write(`${table.text}\n`);
process.stdout.write(
	`counts: sync events=${snapshotSync.counts.events} daily=${snapshotSync.counts.daily} sync=${snapshotSync.counts.sync} | worker events=${snapshotWorker.counts.events} daily=${snapshotWorker.counts.daily} sync=${snapshotWorker.counts.sync}\n`,
);
process.stdout.write(`RESULT: ${record.pass ? "PASS" : "FAIL"}\n`);
process.exit(record.pass ? 0 : 1);
