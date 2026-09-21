#!/usr/bin/env node
/**
 * Design probes (offline):
 *   D2 — "rebuild daily inside the events transaction" as a barrier-free
 *        alternative: does it reach the same final state?
 *   D3 — can the host read while the worker's write transaction is OPEN?
 *
 * Usage: TZ=UTC node harness/run-design-probes.mjs [--label L] [--hold-ms N]
 */
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";
import { mkdirSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { writeFixtures, seedSyncState } from "./fixture.mjs";
import { loadDeployed } from "./deployed-lib.mjs";
import { probeQueries } from "./query-probe.mjs";

const DEPLOYED_LIB = join(homedir(), ".dsh", "profiles", "node_modules", "@local", "dsh-usage", "lib");
const { openUsageDb } = await loadDeployed("db.js");
const { rebuildDailyForDays } = await loadDeployed("db.js");

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "out");
const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const LABEL = argOf("--label", "design-probes");
const HOLD_MS = Number(argOf("--hold-ms", "0"));
const ROOT = join(HERE, "..", "fixture", "_design", LABEL);
const snapDir = join(ROOT, "snaps");

rmSync(ROOT, { recursive: true, force: true });
mkdirSync(snapDir, { recursive: true });
const root = join(ROOT, "root");
const dbPath = join(ROOT, "cand.db");
const f = writeFixtures(root);
const seedDb = await openUsageDb(dbPath);
seedSyncState(seedDb, f);
seedDb.close();

const snapshots = [];
const readEvents = (p) => {
	const c = new DatabaseSync(p);
	const events = c.prepare("SELECT data_source, session_id, dedup_key, ts, model, provider, project, turn, step, is_subagent, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens FROM usage_events ORDER BY data_source, session_id, dedup_key").all();
	const daily = c.prepare("SELECT * FROM usage_daily ORDER BY day, data_source, model, project").all();
	const sync = c.prepare("SELECT * FROM sync_state ORDER BY source").all();
	c.close();
	return { events, daily, sync };
};
const norm = (v) => JSON.parse(JSON.stringify(v).split(root).join("<ROOT>"));

let txnOpenObservation = null;
const w = new Worker(new URL("./worker-snapshots.mjs", import.meta.url), {
	workerData: { dbPath, dshRoot: f.dshRoot, ccRoot: f.ccRoot, cleanRoot: f.cleanRoot, snapDir, holdFirstCommitMs: HOLD_MS },
});
const result = await new Promise((resolve, reject) => {
	w.on("message", (m) => {
		if (m.stage === "txn-open-before-commit") {
			// Host reads while the worker's write txn is NOT yet committed.
			const c = new DatabaseSync(dbPath);
			const t0 = process.hrtime.bigint();
			try {
				const n = c.prepare("SELECT COUNT(*) AS c FROM usage_events").get().c;
				txnOpenObservation = { sawEvents: n, waitedMs: Number(process.hrtime.bigint() - t0) / 1e6, error: null };
			} catch (e) {
				txnOpenObservation = { sawEvents: null, waitedMs: Number(process.hrtime.bigint() - t0) / 1e6, error: `${e.code ?? e.name}: ${e.message}` };
			} finally { c.close(); }
		} else if (m.stage === "commit-snapshot") {
			snapshots.push({ index: m.index, snap: m.snap, state: norm(readEvents(m.snap)) });
		} else if (m.stage === "done") {
			resolve(m.result);
		}
	});
	w.on("error", reject);
	w.on("exit", (code) => { if (code !== 0) reject(new Error(`worker exit ${code}`)); });
});

const finalState = norm(readEvents(dbPath));

// ------------------------------------------------------------------ D2
// Counterfactual: on the FIRST commit snapshot (events present, daily not yet
// rebuilt), run the real `rebuildDailyForDays` for every day present, then diff
// the whole DB against the real final state.
const first = snapshots.find((s) => s.index === 1);
let d2 = null;
if (first) {
	const work = `${first.snap}.d2`;
	rmSync(work, { force: true }); rmSync(`${work}-wal`, { force: true }); rmSync(`${work}-shm`, { force: true });
	const bytes = (await import("node:fs")).copyFileSync(first.snap, work);
	const c = new DatabaseSync(work);
	c.exec("PRAGMA journal_mode = WAL");
	const days = c.prepare("SELECT DISTINCT strftime('%Y-%m-%d', ts/1000, 'unixepoch', 'localtime') AS d FROM usage_events").all().map((r) => r.d);
	rebuildDailyForDays(c, days);
	c.close();
	const after = norm(readEvents(work));
	const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
	d2 = {
		daysRebuilt: days,
		dailyEqual: eq(after.daily, finalState.daily),
		eventsEqual: eq(after.events, finalState.events),
		syncEqual: eq(after.sync, finalState.sync),
		dailyAfterRebuild: after.daily,
		dailyFinal: finalState.daily,
		dailyDiff: eq(after.daily, finalState.daily) ? null : { after: after.daily, final: finalState.daily },
	};
}

// ------------------------------------------------------------------ report
const report = {
	label: LABEL, tz: process.env.TZ ?? "(unset)", holdMs: HOLD_MS, timestamp: new Date().toISOString(),
	foldResult: result,
	commitSnapshots: snapshots.map((s) => ({
		index: s.index,
		eventRows: s.state.events.length,
		dailyRows: s.state.daily.length,
		eventsMinusDailyRequests: s.state.events.length - s.state.daily.reduce((a, r) => a + r.requests, 0),
	})),
	finalState,
	d2_dailyInsideTransaction: d2,
	d3_readDuringOpenTransaction: txnOpenObservation,
};
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, `design-${LABEL}.json`), JSON.stringify(report, null, 2));

console.log(`\n===== DESIGN PROBES (${LABEL}, TZ=${report.tz}) =====`);
console.log(`fold returns: ${JSON.stringify(Object.fromEntries(Object.entries(result).map(([k, v]) => [k, `scanned=${v.scanned},new=${v.newEvents},failed=${v.failedFiles.length}`])))}`);
console.log(`\nper-COMMIT snapshots (events vs aggregated daily rows):`);
for (const s of report.commitSnapshots) console.log(`  commit#${s.index}: events=${s.eventRows} dailyRows=${s.dailyRows} events-dailyRequests=${s.eventsMinusDailyRequests}`);
console.log(`\nD2 daily-inside-transaction counterfactual: ${JSON.stringify(d2 && { daysRebuilt: d2.daysRebuilt, eventsEqual: d2.eventsEqual, dailyEqual: d2.dailyEqual, syncEqual: d2.syncEqual })}`);
if (d2 && d2.dailyDiff) console.log(`   DIFF daily after=${JSON.stringify(d2.dailyDiff.after)} final=${JSON.stringify(d2.dailyDiff.final)}`);
console.log(`\nD3 read while worker txn OPEN: ${JSON.stringify(txnOpenObservation)}`);
console.log(`\nraw JSON: ${join(OUT, `design-${LABEL}.json`)}`);
