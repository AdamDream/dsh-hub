// Focused stress: the host reads the DB through its own connection while a
// WORKER holds its connection parked in `Atomics.wait()` (exactly what an
// "inFlight barrier" would do: the host waits on ingest). The deployed db.js
// creates its connections with NO busy_timeout (default 0), so any collision
// surfaces immediately as `database is locked` instead of a short wait.
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROUNDS = Number(process.argv[2] ?? 30);
// The worker is parked in Atomics.wait for the whole measurement in every round;
// this parameter only controls how long we deliberately leave it parked AFTER
// measuring, to see whether the collision is transient or persistent.
const HOLDS = [0, 200, 1000];
const out = [];

for (const holdMs of HOLDS) {
	const res = { holdMs, rounds: ROUNDS, plainFailures: 0, busyTimeoutFailures: 0, maxPlainWaitMs: 0, maxBusyWaitMs: 0 };
	for (let i = 0; i < ROUNDS; i += 1) {
		const dir = mkdtempSync(join(tmpdir(), "barrier-lock-"));
		const dbPath = join(dir, "t.db");
		const sab = new SharedArrayBuffer(8);
		const w = new Worker(new URL("./barrier-holder.mjs", import.meta.url), { workerData: { dbPath, sab } });
		await new Promise((r) => w.once("message", r)); // worker is now parked in Atomics.wait

		{
			const c = new DatabaseSync(dbPath); // plain: what the product does
			const t0 = Date.now();
			try { c.prepare("SELECT COUNT(*) AS c FROM usage_events").get(); }
			catch { res.plainFailures += 1; }
			res.maxPlainWaitMs = Math.max(res.maxPlainWaitMs, Date.now() - t0);
			c.close();
		}
		{
			const c = new DatabaseSync(dbPath);
			c.exec("PRAGMA busy_timeout = 5000");
			const t0 = Date.now();
			try { c.prepare("SELECT COUNT(*) AS c FROM usage_events").get(); }
			catch { res.busyTimeoutFailures += 1; }
			res.maxBusyWaitMs = Math.max(res.maxBusyWaitMs, Date.now() - t0);
			c.close();
		}
		await new Promise((r) => setTimeout(r, holdMs));
		Atomics.store(new Int32Array(sab), 0, 1);
		Atomics.notify(new Int32Array(sab), 0);
		await new Promise((r) => w.once("exit", r));
		rmSync(dir, { recursive: true, force: true });
	}
	out.push(res);
}
console.log(JSON.stringify({ note: "plain = new DatabaseSync() with no busy_timeout (the deployed posture)", results: out,
	verdict: out.some((r) => r.plainFailures > 0)
		? "the deployed posture fails host reads while a worker connection is parked → an inFlight barrier makes this the common case"
		: "no failure observed at these hold lengths (exposure still real: busy_timeout defaults to 0)" }, null, 2));
