// Quantify: after a WORKER closes its write connection, how soon can the host's
// own connection read the file? The deployed db.js sets NO busy_timeout, so a
// collision surfaces as `database is locked` rather than a short wait.
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROUNDS = Number(process.argv[2] ?? 40);
let failDefault = 0, failTimeout = 0, maxWaitDefault = 0, maxWaitTimeout = 0;

const dir = mkdtempSync(join(tmpdir(), "close-race-"));
for (let i = 0; i < ROUNDS; i += 1) {
	const dbPath = join(dir, `r${i}.db`);
	const w = new Worker(new URL("./close-race-worker.mjs", import.meta.url), { workerData: { dbPath, rows: 400 } });
	await new Promise((r) => w.once("message", r)); // worker posted AFTER db.close()

	// (a) exactly what the product's host connection does: plain DatabaseSync, no busy_timeout
	{
		const c = new DatabaseSync(dbPath);
		const t0 = Date.now();
		try { c.prepare("SELECT COUNT(*) AS c FROM usage_events").get(); }
		catch { failDefault += 1; maxWaitDefault = Math.max(maxWaitDefault, Date.now() - t0); }
		c.close();
	}
	// (b) same but with a busy_timeout
	{
		const c = new DatabaseSync(dbPath);
		c.exec("PRAGMA busy_timeout = 5000");
		const t0 = Date.now();
		try { c.prepare("SELECT COUNT(*) AS c FROM usage_events").get(); }
		catch { failTimeout += 1; }
		maxWaitTimeout = Math.max(maxWaitTimeout, Date.now() - t0);
		c.close();
	}
	rmSync(dbPath, { force: true }); rmSync(`${dbPath}-wal`, { force: true }); rmSync(`${dbPath}-shm`, { force: true });
}
rmSync(dir, { recursive: true, force: true });
console.log(JSON.stringify({
	rounds: ROUNDS,
	noBusyTimeout: { failures: failDefault, maxWaitMs: maxWaitDefault },
	withBusyTimeout5000: { failures: failTimeout, maxWaitMs: maxWaitTimeout },
	verdict: failDefault > 0
		? "the deployed posture (no busy_timeout) DOES fail a host read that races the worker's close"
		: "no failure observed in this many rounds (race is rare, but the exposure is real: busy_timeout defaults to 0)",
}, null, 2));
