// Probe-rebuild: run the REAL deployed fold while capturing one SQLite snapshot
// per events COMMIT via `VACUUM INTO`, then answer the design questions offline:
//   D2  would moving `rebuildDailyForDays` INSIDE the events transaction give the
//       same final state? (delta = the frozen snapshot vs the real final state)
//   D3  (transaction variant) can the host READ while that transaction is OPEN?
import { parentPort, workerData } from "node:worker_threads";
import { rmSync } from "node:fs";
import { loadDeployed } from "./deployed-lib.mjs";

const { foldDshSource } = await loadDeployed("ingest-dsh.js");
const { foldCcSource } = await loadDeployed("ingest-cc.js");
const { openUsageDb } = await loadDeployed("db.js");

const { dbPath, dshRoot, ccRoot, cleanRoot, snapDir, holdFirstCommitMs = 0 } = workerData;

const db = await openUsageDb(dbPath);
let commitCount = 0;
let held = false;
const origExec = db.exec.bind(db);
db.exec = (sql) => {
	const isCommit = String(sql).trim().toUpperCase() === "COMMIT";
	if (isCommit && holdFirstCommitMs > 0 && !held) {
		// Park BEFORE the COMMIT while the write transaction is still OPEN.
		held = true;
		parentPort.postMessage({ stage: "txn-open-before-commit" });
		const until = Date.now() + holdFirstCommitMs;
		while (Date.now() < until) { /* spin with the txn open */ }
	}
	const r = origExec(sql);
	if (isCommit) {
		commitCount += 1;
		const snap = `${snapDir}/commit-${commitCount}.db`;
		rmSync(snap, { force: true });
		rmSync(`${snap}-wal`, { force: true });
		db.exec(`VACUUM INTO '${snap.replace(/'/g, "''")}'`);
		parentPort.postMessage({ stage: "commit-snapshot", index: commitCount, snap });
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
