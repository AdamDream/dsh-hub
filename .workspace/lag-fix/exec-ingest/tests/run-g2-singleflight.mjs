#!/usr/bin/env node
/**
 * G2 — single-flight: concurrent `/usage/refresh` callers must share ONE fold.
 *
 * The audit's gate is "10 concurrent `/usage/refresh` trigger exactly ONE fold"
 * (worker side counts ONE `start`). `client.js` polls `/usage/refresh` on a
 * timer and does no in-flight de-duplication of its own, so without
 * single-flight every cluster of overlapping calls stacks a whole pass — each
 * one re-reading ~871 session files.
 *
 * What is asserted here
 *   1. 10 concurrent `runner.run()` calls return THE SAME promise object
 *      (identity, not just equal results) — the literal "single-flight" claim;
 *   2. all 10 settle with the same successful result;
 *   3. `stats().runs === 1` and `workerSpawns === 1` (one worker, one pass);
 *   4. an INDEPENDENT count taken on the worker side: a tap shim around the real
 *      `ingest-worker.js` logs every `start` message it receives — exactly 1;
 *   5. a second wave AFTER the first settles does start a new pass (the
 *      single-flight slot is released, it is not a permanent latch);
 *   6. a mixed wave (2 callers while a pass is already in flight) still yields
 *      one extra `start`, i.e. joins rather than stacks.
 *
 * The rpc.js path is covered separately by the wiring assertion
 * (`tests/run-wiring-assertions.mjs`): `/usage/refresh` awaits `waitIdle()`,
 * which lib/index.js binds to `runner.run()`.
 */

import { appendFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { EQUIV_FIXTURE_MODULE, LIB_CAND, SCRATCH, assertionTable, freshDir, makeRunner, seedDatabase, writeJson } from "./lib/harness.mjs";

const argv = process.argv.slice(2);
const LIB = resolve(argv.includes("--lib") ? argv[argv.indexOf("--lib") + 1] : LIB_CAND);
const TAP_WORKER = join(process.cwd(), "tests", "workers", "tap-worker.mjs");
const REAL_WORKER = join(LIB, "ingest-worker.js");

const { writeFixtures, seedSyncState } = await import(EQUIV_FIXTURE_MODULE);

const root = freshDir(join(SCRATCH, "g2"));
const fixture = writeFixtures(join(root, "fx"));
const dbPath = join(root, "usage.db");
const seedDb = await seedDatabase(LIB, dbPath, (db) => seedSyncState(db, fixture));
seedDb.close();

const tapLog = join(root, "tap.log");
writeFileSync(tapLog, "");
process.env.INGEST_TAP_LOG = tapLog;
process.env.INGEST_TAP_REAL_WORKER = REAL_WORKER;

const readTap = () => {
	try {
		return readFileSync(tapLog, "utf8").split("\n").filter(Boolean);
	} catch {
		return [];
	}
};
const countStarts = (lines) => lines.filter((line) => line.startsWith("start ")).length;

const runner = await makeRunner(LIB, {
	dbPath,
	dshRoot: fixture.dshRoot,
	ccRoot: fixture.ccRoot,
	workerUrl: TAP_WORKER,
	stallMs: 60_000,
});

// ---------------------------------------------------------------- wave 1 (10)
const wave1 = Array.from({ length: 10 }, () => runner.run());
const uniquePromises = new Set(wave1).size;
const settled1 = await Promise.all(wave1);
const statsAfterWave1 = runner.stats();
const linesAfterWave1 = readTap();

// ------------------------------------------------- wave 2 (2 join an in-flight)
const wave2a = runner.run();
const wave2b = runner.run();
const settled2 = await Promise.all([wave2a, wave2b]);
const statsAfterWave2 = runner.stats();
const linesAfterWave2 = readTap();

// --------------------------------------- wave 3 (after settle: a NEW pass runs)
const wave3 = await runner.run();
const statsAfterWave3 = runner.stats();
const linesAfterWave3 = readTap();

await runner.dispose();

const rows = [
	{
		id: "G2a:ten-concurrent-callers-share-one-promise",
		ok: uniquePromises === 1,
		detail: `10 concurrent run() calls produced ${uniquePromises} distinct promise object(s)`,
	},
	{
		id: "G2b:all-ten-settle-with-the-same-successful-result",
		ok: settled1.every((result) => result === settled1[0] && result.ok === true),
		detail: `${settled1.filter((result) => result === settled1[0]).length}/10 identical result object(s), ok=${settled1[0]?.ok}`,
	},
	{
		id: "G2c:runner-performed-ONE-pass",
		ok: statsAfterWave1.runs === 1 && statsAfterWave1.workerSpawns === 1,
		detail: `runs=${statsAfterWave1.runs} workerSpawns=${statsAfterWave1.workerSpawns}`,
	},
	{
		id: "G2d:worker-side-start-count-is-ONE",
		ok: countStarts(linesAfterWave1) === 1,
		detail: `tap log after wave 1: ${countStarts(linesAfterWave1)} start message(s), spawns=${linesAfterWave1.filter((line) => line.startsWith("worker-spawn")).length}`,
	},
	{
		id: "G2e:joiners-inside-an-in-flight-pass-stack-nothing",
		ok: wave2a === wave2b && statsAfterWave2.runs === 2 && countStarts(linesAfterWave2) === 2,
		detail: `two concurrent callers shared one promise=${wave2a === wave2b}; runs=${statsAfterWave2.runs}; starts=${countStarts(linesAfterWave2)}`,
	},
	{
		id: "G2f:slot-released-after-settle",
		ok: wave3.ok === true && statsAfterWave3.runs === 3 && countStarts(linesAfterWave3) === 3,
		detail: `sequential call after settle: ok=${wave3.ok} runs=${statsAfterWave3.runs} starts=${countStarts(linesAfterWave3)}`,
	},
];

const table = assertionTable(rows);
const record = {
	suite: "G2-single-flight",
	lib: LIB,
	tapLog: linesAfterWave3,
	stats: { afterWave1: statsAfterWave1, afterWave2: statsAfterWave2, afterWave3: statsAfterWave3 },
	results: { settled1, settled2, wave3 },
	rows,
	pass: table.failed === 0,
};
writeJson("g2-singleflight.json", record);

process.stdout.write(`\n### G2 single-flight — lib=${LIB.split("/").slice(-2).join("/")}\n`);
process.stdout.write(`tap log: ${JSON.stringify(linesAfterWave3)}\n${table.text}\nRESULT: ${record.pass ? "PASS" : "FAIL"}\n`);
rmSync(root, { recursive: true, force: true });
appendFileSync(join(process.cwd(), "out", "g2-keep-tap.log"), "");
process.exit(record.pass ? 0 : 1);
