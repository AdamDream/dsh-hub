// "Candidate" mode: run the UNCHANGED deployed fold inside a Worker thread.
//
// The deployed `db` handle is a `node:sqlite` `DatabaseSync`, which is NOT
// transferable across a worker boundary (probe-db-clone: DataCloneError).
// Therefore the worker imports the real deployed `openUsageDb` and opens its OWN
// connection to the SAME database file — that is the architecture under test.
import { parentPort, workerData } from "node:worker_threads";
import { join } from "node:path";
import { homedir } from "node:os";
import { rmSync } from "node:fs";
import { DEPLOYED_LIB, loadDeployed } from "./deployed-lib.mjs";

const { foldDshSource } = await loadDeployed("ingest-dsh.js");
const { foldCcSource } = await loadDeployed("ingest-cc.js");
const { openUsageDb } = await loadDeployed("db.js");

const { dbPath, dshRoot, ccRoot, cleanRoot, gapMs = 0, barrier = false, frozenPath = null } = workerData;

const db = await openUsageDb(dbPath);
const sharedSAB = workerData.sab ?? null;

// Test hooks around the "events COMMIT → daily rebuild" pair.
//
// In the DEPLOYED host path these are two adjacent synchronous statements: the
// host event loop never yields between them, so no RPC can observe the state in
// between. Once the fold lives in a Worker they become two separate
// transactions on a different connection, so the host CAN run RPC in between.
let commitCount = 0;
let holdFirst = gapMs > 0;   // time-boxed hold (measurement)
let barrierHold = barrier;   // hold until the parent releases (barrier design test)
const origExec = db.exec.bind(db);
db.exec = (sql) => {
	const r = origExec(sql);
	if (String(sql).trim().toUpperCase() !== "COMMIT") return r;
	commitCount += 1;
	// Freeze an exact copy of the DB state at the COMMIT boundary (BEFORE the
	// daily rebuild runs). This is the reference "events committed, daily not yet
	// rebuilt" state — the copy is a frozen pre-rebuild data set, so the
	// post-rebuild DB *with exactly the same events* must answer every endpoint
	// identically. Any value difference is a genuine COMMIT→rebuild inconsistency.
	if (frozenPath && commitCount === 1) {
		rmSync(frozenPath, { force: true });
		rmSync(`${frozenPath}-wal`, { force: true });
		rmSync(`${frozenPath}-shm`, { force: true });
		db.exec(`VACUUM INTO '${frozenPath.replace(/'/g, "''")}'`);
	}
	parentPort.postMessage({
		stage: "events-commit",
		index: commitCount,
		dbState: {
			events: db.prepare("SELECT COUNT(*) AS c FROM usage_events").get().c,
			eventsThatDay: db.prepare("SELECT COUNT(*) AS c FROM usage_events WHERE ts >= ? AND ts < ?")
				.get(Date.UTC(2025, 7, 24), Date.UTC(2025, 7, 25)).c,
		},
	});
	if (holdFirst) {
		holdFirst = false;
		const until = Date.now() + gapMs;
		while (Date.now() < until) { /* spin: the daily rebuild really has not started */ }
	} else if (barrierHold) {
		barrierHold = false; // hold ONLY the first events COMMIT until released
		const shared = new Int32Array(sharedSAB);
		Atomics.wait(shared, 0, 0); // released by the parent
	}
	return r;
};

const onProgress = () => {};
const dshFirst = foldDshSource(db, dshRoot, { onProgress });
const ccFirst = foldCcSource(db, ccRoot, { onProgress });
const dshSecond = foldDshSource(db, dshRoot, { onProgress });
const ccSecond = foldCcSource(db, ccRoot, { onProgress });
const dshClean = foldDshSource(db, cleanRoot, { onProgress });
const ccClean = foldCcSource(db, cleanRoot, { onProgress });

db.close();
parentPort.postMessage({ stage: "done", result: { dshFirst, ccFirst, dshSecond, ccSecond, dshClean, ccClean } });
parentPort.postMessage({ stage: "closed" });
