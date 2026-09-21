// Does a host-side reader survive a Worker that holds a write transaction open?
// The deployed db.js sets NO busy timeout (PRAGMA busy_timeout defaults to 0 and
// `new DatabaseSync()` is created without one), so this is a real exposure.
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const holdMs = Number(process.argv[2] ?? 1500);
const dir = mkdtempSync(join(tmpdir(), "lock-"));
const dbPath = join(dir, "t.db");

for (const [label, configure] of [
	["default (no busy_timeout — what the product does today)", (d) => {}],
	["with PRAGMA busy_timeout = 5000", (d) => d.exec("PRAGMA busy_timeout = 5000")],
]) {
	const db = new DatabaseSync(dbPath);
	db.exec("PRAGMA journal_mode = WAL");
	db.exec("CREATE TABLE IF NOT EXISTS t(a INTEGER)");
	db.exec("DELETE FROM t");
	configure(db);
	const w = new Worker(new URL("./lock-holder.mjs", import.meta.url), { workerData: { path: dbPath, holdMs } });
	await new Promise((r) => w.once("message", r));
	const t0 = Date.now();
	let sel, begin;
	try { sel = { ok: true, c: db.prepare("SELECT COUNT(*) c FROM t").get().c }; }
	catch (e) { sel = { ok: false, code: e.code, msg: e.message }; }
	const t1 = Date.now();
	try { db.exec("BEGIN IMMEDIATE"); db.exec("COMMIT"); begin = { ok: true }; }
	catch (e) { begin = { ok: false, code: e.code, msg: e.message }; }
	const t2 = Date.now();
	await new Promise((r) => w.once("exit", r));
	db.close();
	console.log(`${label}\n   SELECT      : ${JSON.stringify(sel)} waited=${t1 - t0}ms\n   BEGIN IMMEDIATE: ${JSON.stringify(begin)} waited=${t2 - t1}ms`);
}
