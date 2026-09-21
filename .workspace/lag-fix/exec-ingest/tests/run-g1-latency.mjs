#!/usr/bin/env node
/**
 * G1 (sandbox substitute) — does ONE FULL ingest pass block the host event loop?
 *
 * The audit's gate G1 is "during one complete ingest pass the host event loop's
 * maximum delay is < 100 ms" (`perf_hooks.monitorEventLoopDelay`), with the
 * pre-fix reference being the same pass executed synchronously (2.682 s
 * incremental / 36.1 s cold). This script measures BOTH in one process:
 *
 *   worker phase : `ingest-runner.js` + `ingest-worker.js` (the candidate)
 *   sync phase   : `foldDshSource` + `foldCcSource` on the host thread (today)
 *
 * Two independent instruments are used, because a single one can be argued
 * with:
 *   1. `monitorEventLoopDelay({resolution:10})` — `max` in ms.
 *   2. a 10 ms `setInterval` heartbeat recording its worst actual gap — a
 *      blocked event loop cannot run the interval, so the worst gap IS the
 *      worst blocking time.
 *
 * Default workload = the REAL `~/.dsh/sessions` (883 files) and
 * `~/.claude/projects` (388 files), READ-ONLY, folded into a scratch database.
 * Both phases fold the same roots, so the comparison is like-for-like.
 *
 * NOTE (audit §3.4 / BATCH-PLAN §3bis.4): this sandbox cannot always create
 * SQLite temp files, and `temp_store = 2` is part of the candidate `db.js`. The
 * phase-by-phase `failedFiles` counts are therefore reported so a
 * temp-store-related failure can never be mistaken for a latency result.
 */

import { monitorEventLoopDelay } from "node:perf_hooks";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { LIB_CAND, SCRATCH, assertionTable, freshDir, loadLib, makeRunner, writeJson } from "./lib/harness.mjs";

const argv = process.argv.slice(2);
const value = (name, fallback) => {
	const withEquals = argv.find((item) => item.startsWith(`${name}=`));
	if (withEquals !== undefined) return withEquals.slice(name.length + 1);
	const index = argv.indexOf(name);
	return index >= 0 && index + 1 < argv.length ? argv[index + 1] : fallback;
};

const LIB = resolve(value("--lib", LIB_CAND));
const DSH_ROOT = value("--dsh-root", join(homedir(), ".dsh", "sessions"));
const CC_ROOT = value("--cc-root", join(homedir(), ".claude", "projects"));
const ROUNDS = Number(value("--rounds", "2"));
const GATE_MS = Number(value("--gate-ms", "100"));

const lib = await loadLib(LIB);
const root = freshDir(join(SCRATCH, "g1"));

/** Instrument bundle: event-loop-delay histogram + heartbeat drift. */
function makeProbe() {
	const histogram = monitorEventLoopDelay({ resolution: 10 });
	let heartbeat = null;
	let last = 0;
	let worstGap = 0;
	return {
		/**
		 * Let the monitor settle before the measured phase starts — and do NOT
		 * `reset()` again once settled. Measured (tools/probe-eld-reset.mjs):
		 * `enable → settle → RESET → block` reports 10.31 ms for a 3000 ms block
		 * and 10.16 ms for a 20000 ms block, while `enable → settle → block`
		 * reports 3003 ms and 20015 ms. The first sample after a reset is
		 * discarded (calibration), so resetting immediately before a long
		 * synchronous block silently destroys exactly the measurement this gate
		 * is built on. The settle samples themselves are ~10 ms and cannot
		 * inflate `max` for the quiet (worker) phase.
		 */
		async start() {
			histogram.enable();
			histogram.reset();
			const settleStart = Date.now();
			while (Date.now() - settleStart < 120) await new Promise((done) => setTimeout(done, 10));
			last = Date.now();
			worstGap = 0;
			heartbeat = setInterval(() => {
				const now = Date.now();
				worstGap = Math.max(worstGap, now - last - 10);
				last = now;
			}, 10);
		},
		/**
		 * Drain BEFORE reading. Measured in this sandbox: without a drain the
		 * overdue monitor/heartbeat callbacks are cancelled by the very `stop()`
		 * that follows a synchronous block, and a 1500 ms busy loop reports
		 * `max = 10.13 ms` / `gap = 1 ms` — a false "no blocking" reading.
		 * Draining ~150 ms (the callback fires once, late, and records the real
		 * delay) makes the same loop report `max = 1511 ms` / `gap = 1501 ms`.
		 */
		async stop() {
			const drainStart = Date.now();
			while (Date.now() - drainStart < 150) await new Promise((done) => setTimeout(done, 10));
			histogram.disable();
			if (heartbeat !== null) clearInterval(heartbeat);
			heartbeat = null;
			return {
				monitorMaxMs: Number((histogram.max / 1e6).toFixed(2)),
				monitorMeanMs: Number((histogram.mean / 1e6).toFixed(2)),
				monitorP99Ms: Number((histogram.percentile(99) / 1e6).toFixed(2)),
				heartbeatWorstGapMs: worstGap,
			};
		},
	};
}

const rounds = [];
for (let round = 1; round <= ROUNDS; round += 1) {
	// ------------------------------------------------------------------ worker
	{
		const dbPath = join(root, `worker-r${round}.db`);
		const runner = await makeRunner(LIB, { dbPath, dshRoot: DSH_ROOT, ccRoot: CC_ROOT, stallMs: 600_000, hardTimeoutMs: 1_800_000 });
		const probe = makeProbe();
		const wallStart = Date.now();
		await probe.start();
		const result = await runner.run();
		const measured = await probe.stop();
		const wallMs = Date.now() - wallStart;
		const stats = runner.stats();
		await runner.dispose();
		rounds.push({
			round,
			phase: "worker",
			ok: result.ok,
			wallMs,
			...measured,
			fold: result.ok ? { dsh: result.dsh, cc: result.cc } : { reason: result.reason, message: result.message },
			stats,
		});
	}
	// -------------------------------------------------------------------- sync
	{
		const dbPath = join(root, `sync-r${round}.db`);
		const db = await lib.db.openUsageDb(dbPath);
		const probe = makeProbe();
		const wallStart = Date.now();
		await probe.start();
		let fold;
		try {
			const dsh = lib.ingestDsh.foldDshSource(db, DSH_ROOT, {});
			const cc = lib.ingestCc.foldCcSource(db, CC_ROOT, {});
			fold = { dsh, cc };
		} catch (error) {
			fold = { error: error instanceof Error ? error.message : String(error) };
		}
		const measured = await probe.stop();
		const wallMs = Date.now() - wallStart;
		db.close();
		rounds.push({ round, phase: "sync", ok: !("error" in fold), wallMs, ...measured, fold });
	}
	process.stdout.write(`round ${round} done\n`);
}

const workerRounds = rounds.filter((entry) => entry.phase === "worker");
const syncRounds = rounds.filter((entry) => entry.phase === "sync");
const workerWorst = Math.max(...workerRounds.map((entry) => entry.monitorMaxMs));
const syncWorst = Math.max(...syncRounds.map((entry) => entry.monitorMaxMs));
const workerWorstHeartbeat = Math.max(...workerRounds.map((entry) => entry.heartbeatWorstGapMs));
const syncWorstHeartbeat = Math.max(...syncRounds.map((entry) => entry.heartbeatWorstGapMs));
const workerWorked = workerRounds.every((entry) => entry.ok && (entry.fold.dsh?.scanned > 0 || entry.fold.cc?.scanned > 0));

const rows = [
	{
		id: "G1a:worker-pass-max-event-loop-delay<gate",
		ok: workerWorst < GATE_MS,
		detail: `worker max=${workerWorst}ms (gate <${GATE_MS}ms) over ${workerRounds.length} pass(es)`,
	},
	{
		id: "G1b:heartbeat-independent-confirmation",
		ok: workerWorstHeartbeat < GATE_MS,
		detail: `worker worst 10ms-heartbeat gap=${workerWorstHeartbeat}ms`,
	},
	{
		id: "G1c:sync-control-shows-the-defect",
		ok: syncWorst >= 200,
		detail: `same pass, synchronous: max=${syncWorst}ms / heartbeat gap=${syncWorstHeartbeat}ms (this is the pre-fix behaviour the gate exists to rule out)`,
	},
	{
		id: "G1d:worker-ratio",
		ok: syncWorst > 0 && workerWorst / syncWorst < 0.5,
		detail: `worker/sync max-delay ratio = ${(workerWorst / Math.max(syncWorst, 1e-9)).toFixed(4)}`,
	},
	{
		id: "G1e:worker-actually-did-the-work",
		ok: workerWorked,
		detail: JSON.stringify(workerRounds.map((entry) => (entry.ok ? { dshScanned: entry.fold.dsh?.scanned, ccScanned: entry.fold.cc?.scanned, dshEvents: entry.fold.dsh?.newEvents, ccEvents: entry.fold.cc?.newEvents, dshFailed: entry.fold.dsh?.failedFiles?.length, ccFailed: entry.fold.cc?.failedFiles?.length } : { reason: entry.reason }))),
	},
];

const table = assertionTable(rows);
const record = {
	suite: "G1-sandbox-substitute-event-loop-delay",
	lib: LIB,
	workload: { dshRoot: DSH_ROOT, ccRoot: CC_ROOT, dshRootExists: existsSync(DSH_ROOT), ccRootExists: existsSync(CC_ROOT), rounds: ROUNDS },
	gateMs: GATE_MS,
	summary: {
		workerWorstMonitorMaxMs: workerWorst,
		syncWorstMonitorMaxMs: syncWorst,
		workerWorstHeartbeatGapMs: workerWorstHeartbeat,
		syncWorstHeartbeatGapMs: syncWorstHeartbeat,
	},
	rounds,
	rows,
	pass: table.failed === 0,
};
writeJson("g1-latency.json", record);

process.stdout.write(`\n### G1 (sandbox substitute) — lib=${LIB.split("/").slice(-2).join("/")}\n`);
process.stdout.write(`workload: dsh=${DSH_ROOT} (${existsSync(DSH_ROOT) ? "present" : "MISSING"}), cc=${CC_ROOT} (${existsSync(CC_ROOT) ? "present" : "MISSING"})\n`);
for (const entry of rounds) {
	process.stdout.write(`round ${entry.round} ${entry.phase.padEnd(6)} wall=${String(entry.wallMs).padStart(6)}ms monitorMax=${String(entry.monitorMaxMs).padStart(9)}ms p99=${String(entry.monitorP99Ms).padStart(7)}ms heartbeatGap=${String(entry.heartbeatWorstGapMs).padStart(6)}ms\n`);
}
process.stdout.write(`${table.text}\nRESULT: ${record.pass ? "PASS" : "FAIL"}\n`);
process.exit(record.pass ? 0 : 1);
