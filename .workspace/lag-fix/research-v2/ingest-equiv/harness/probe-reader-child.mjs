// Exact shape of the failing suite case: the host runs its RPC in a CHILD
// PROCESS while a WORKER connection is alive on the same DB file.
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUNDS = Number(process.argv[2] ?? 25);
let plainFail = 0, busyFail = 0, sample = null;

for (let i = 0; i < ROUNDS; i += 1) {
	const dir = mkdtempSync(join(tmpdir(), "reader-child-"));
	const dbPath = join(dir, "t.db");
	const seed = new DatabaseSync(dbPath);
	seed.exec("PRAGMA journal_mode = WAL");
	seed.exec("CREATE TABLE usage_events (id INTEGER PRIMARY KEY, ts INTEGER, data_source TEXT) STRICT");
	seed.exec("BEGIN");
	const ins = seed.prepare("INSERT INTO usage_events (ts, data_source) VALUES (?, 'dsh')");
	for (let k = 0; k < 500; k += 1) ins.run(1756000000000 + k);
	seed.exec("COMMIT");
	seed.close();

	const w = new Worker(new URL("./holder2.mjs", import.meta.url), { workerData: { path: dbPath, holdMs: 400 } });
	await new Promise((r) => w.once("message", r)); // worker holds a write txn
	for (const [label, flag] of [["plain", "0"], ["busy", "5000"]]) {
		try {
			const out = execFileSync(process.execPath, [join(HERE, "reader-child.mjs"), dbPath, flag], { encoding: "utf8", timeout: 15000 });
			if (!out.includes("OK")) { if (label === "plain") plainFail += 1; else busyFail += 1; sample ??= out.trim(); }
		} catch (e) {
			if (label === "plain") plainFail += 1; else busyFail += 1;
			sample ??= String(e.stdout || e.message).slice(0, 300);
		}
	}
	await new Promise((r) => w.once("exit", r));
	rmSync(dir, { recursive: true, force: true });
}
console.log(JSON.stringify({ rounds: ROUNDS, plainFailures: plainFail, busyTimeoutFailures: busyFail, sampleError: sample }, null, 2));
