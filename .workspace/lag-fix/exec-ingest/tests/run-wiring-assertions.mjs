#!/usr/bin/env node
/**
 * Wiring assertions — the parts of U-IG1.4 / U-IG1.6 / U-IG2 that a database
 * comparison cannot see.
 *
 * Static
 *   W1  `INGEST_TIMER_ENABLED` exists and is `false` (B2 is NOT enabled)
 *   W2  the throwing `typeof ctx.setInterval` probe is gone, and the timer is
 *       installed through `ctx.inject(["timer"], cb)`
 *   W3  the only `waitIdle` references in rpc.js are the destructuring and the
 *       refresh branch — i.e. NO data endpoint and no `status` got a barrier
 *   W4  index.js creates the runner only AFTER `dbPath` is assigned, and disposes
 *       it in the lifecycle effect
 *
 * Dynamic (a fake cordis ctx captures the registered handler)
 *   W5  `/usage/refresh` calls `waitIdle` and does NOT call `ingest` when
 *       `waitIdle` is supplied (and still calls `ingest` when it is not)
 *   W6  TEN concurrent `/usage/refresh` requests through the REAL rpc handler +
 *       the REAL `waitIdle` wiring produce exactly ONE fold (worker-side `start`
 *       count from the tap shim) — the literal G2 acceptance
 *   W7  `status` during a slow in-flight fold returns immediately and never
 *       waits (no barrier, no lost progress visibility)
 *   W8  a data endpoint during a slow in-flight fold also returns immediately
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { EQUIV_FIXTURE_MODULE, LIB_CAND, SCRATCH, assertionTable, freshDir, makeRunner, seedDatabase, writeJson } from "./lib/harness.mjs";

const argv = process.argv.slice(2);
const LIB = resolve(argv.includes("--lib") ? argv[argv.indexOf("--lib") + 1] : LIB_CAND);
const TAP_WORKER = join(process.cwd(), "tests", "workers", "tap-worker.mjs");
const REAL_WORKER = join(LIB, "ingest-worker.js");
const { writeFixtures, seedSyncState } = await import(EQUIV_FIXTURE_MODULE);

const read = (file) => readFileSync(join(LIB, file), "utf8");
const indexSource = read("index.js");
const rpcSource = read("rpc.js");

const rows = [];

// ------------------------------------------------------------------- static
rows.push({
	id: "W1:timer-switch-defaults-OFF",
	ok: /const INGEST_TIMER_ENABLED = false;/.test(indexSource) && /if \(INGEST_TIMER_ENABLED\) \{/.test(indexSource),
	detail: /const INGEST_TIMER_ENABLED = (\w+);/.exec(indexSource)?.[1] ?? "constant missing",
});
rows.push({
	id: "W2:throwing-probe-removed-and-inject-used",
	ok: !indexSource.includes("typeof ctx.setInterval") && indexSource.includes('ctx.inject(["timer"], (timerCtx) => {'),
	detail: `typeof-probe present=${indexSource.includes("typeof ctx.setInterval")}; ctx.inject(["timer"]) present=${indexSource.includes('ctx.inject(["timer"], (timerCtx) => {')}`,
});
{
	// Intent check, not a grep count: `waitIdle` must appear ONLY in the refresh
	// branch — nothing at or after the `status` branch (which is where the data
	// endpoints live) may reference it, i.e. no barrier was added anywhere.
	const statusIndex = rpcSource.indexOf('if (endpoint === "status")');
	const waitIdleIndices = [...rpcSource.matchAll(/waitIdle/g)].map((match) => match.index);
	const afterStatus = waitIdleIndices.filter((index) => index > statusIndex && statusIndex > 0).length;
	const refreshBranchOk = /if \(typeof waitIdle === "function"\) await waitIdle\(\);\n\t\t\t\telse if \(typeof ingest === "function"\) await ingest\(\);/.test(rpcSource);
	const inRefreshOnly = waitIdleIndices.length > 0 && waitIdleIndices.every((index) => index < statusIndex);
	rows.push({
		id: "W3:rpc-waitIdle-only-on-refresh",
		ok: inRefreshOnly && afterStatus === 0 && refreshBranchOk,
		detail: `${waitIdleIndices.length} mention(s) of waitIdle in rpc.js, all BEFORE the status branch=${inRefreshOnly}, AFTER the status branch (barrier leak)=${afterStatus}, refresh awaits waitIdle first=${refreshBranchOk}`,
	});
}
{
	const runnerIndex = indexSource.indexOf("runner = createIngestRunner(");
	const dbPathIndex = indexSource.indexOf("dbPath = resolved.path;");
	rows.push({
		id: "W4:runner-created-after-dbPath-and-disposed",
		ok: runnerIndex > dbPathIndex && dbPathIndex > 0 && /void runner\?\.dispose\(\);/.test(indexSource) && /let runner = null;/.test(indexSource),
		detail: `createIngestRunner@${runnerIndex} > dbPath=@${dbPathIndex}; dispose=${/void runner\?\.dispose\(\);/ .test(indexSource)}`,
	});
}

// ------------------------------------------------------------------ dynamic
const root = freshDir(join(SCRATCH, "wiring"));
const fixture = writeFixtures(join(root, "fx"));
const dbPath = join(root, "usage.db");
const seedDb = await seedDatabase(LIB, dbPath, (db) => seedSyncState(db, fixture));
seedDb.close();

const tapLog = join(root, "tap.log");
writeFileSync(tapLog, "");
process.env.INGEST_TAP_LOG = tapLog;
process.env.INGEST_TAP_REAL_WORKER = REAL_WORKER;

const runner = await makeRunner(LIB, { dbPath, dshRoot: fixture.dshRoot, ccRoot: fixture.ccRoot, workerUrl: TAP_WORKER, stallMs: 60_000 });

/** Fake cordis ctx that captures the `/usage` handler and counts effect binds. */
function captureHandler() {
	const captured = { handler: null, channel: null, options: null, effects: 0 };
	const ctx = {
		connection: {
			rpc: {
				handle: (channel, handler, options) => {
					captured.channel = channel;
					captured.handler = handler;
					captured.options = options;
					return () => {};
				},
			},
			register: () => {
				throw new Error("wiring test: the SOURCE-side register posture must not be used on the deployed file");
			},
		},
		effect: () => {
			captured.effects += 1;
			return () => {};
		},
	};
	return { ctx, captured };
}

const { registerUsageRpc } = await import(pathToFileURL(join(LIB, "rpc.js")).href);
const statusProvider = () => ({ lastIngest: 1, eventsDsh: 2, eventsCc: 3 });
const waitIdleCalls = { n: 0 };
const ingestCalls = { n: 0 };

// --- W5a: refresh prefers waitIdle -----------------------------------------
{
	const { ctx, captured } = captureHandler();
	registerUsageRpc(ctx, {
		db: () => null,
		ingest: async () => {
			ingestCalls.n += 1;
		},
		statusProvider,
		waitIdle: async () => {
			waitIdleCalls.n += 1;
		},
	});
	const reply = await captured.handler("refresh", {}, null);
	rows.push({
		id: "W5a:refresh-awaits-waitIdle-and-not-ingest",
		ok: reply.ok === true && waitIdleCalls.n === 1 && ingestCalls.n === 0,
		detail: `reply.ok=${reply.ok} waitIdle=${waitIdleCalls.n} ingest=${ingestCalls.n} channel=${captured.channel} authority=${JSON.stringify(captured.options)}`,
	});
}
// --- W5b: without waitIdle the old ingest path still runs ------------------
{
	const { ctx, captured } = captureHandler();
	const before = ingestCalls.n;
	registerUsageRpc(ctx, {
		db: () => null,
		ingest: async () => {
			ingestCalls.n += 1;
		},
		statusProvider,
	});
	const reply = await captured.handler("refresh", {}, null);
	rows.push({ id: "W5b:refresh-falls-back-to-ingest-without-waitIdle", ok: reply.ok === true && ingestCalls.n === before + 1, detail: `ingest calls +${ingestCalls.n - before}` });
}

// --- W6: TEN concurrent /usage/refresh through the real handler ------------
{
	const { ctx, captured } = captureHandler();
	registerUsageRpc(ctx, {
		db: () => null,
		ingest: () => runner.run(),
		// exactly the wiring lib/index.js installs
		waitIdle: () => runner.run(),
		statusProvider,
	});
	const replies = await Promise.all(Array.from({ length: 10 }, () => captured.handler("refresh", {}, null)));
	const starts = readFileSync(tapLog, "utf8").split("\n").filter((line) => line.startsWith("start ")).length;
	const stats = runner.stats();
	rows.push({
		id: "W6:ten-concurrent-refresh-trigger-ONE-fold",
		ok: replies.length === 10 && replies.every((reply) => reply.ok === true) && starts === 1 && stats.runs === 1,
		detail: `10 responses all ok=${replies.every((reply) => reply.ok === true)}; worker-side starts=${starts}; runner runs=${stats.runs}`,
	});
}

// --- W7/W8: no barrier on status / data endpoints --------------------------
{
	const { ctx, captured } = captureHandler();
	let waitIdleCallsHere = 0;
	registerUsageRpc(ctx, {
		db: () => null,
		ingest: () => new Promise(() => {}),
		waitIdle: () => {
			waitIdleCallsHere += 1;
			return new Promise(() => {});
		},
		statusProvider,
	});
	const startedAt = Date.now();
	const statusReply = await captured.handler("status", {}, null);
	const statusMs = Date.now() - startedAt;
	const summaryReply = await captured.handler("summary", {}, null);
	const summaryMs = Date.now() - startedAt - statusMs;
	rows.push({ id: "W7:status-never-waits", ok: statusReply.ok === true && statusMs < 50 && waitIdleCallsHere === 0, detail: `status responded in ${statusMs}ms, waitIdle calls=${waitIdleCallsHere}` });
	rows.push({
		id: "W8:data-endpoint-not-behind-a-barrier",
		ok: summaryReply.ok === false && summaryReply.error.code === "db-unavailable" && summaryMs < 50 && waitIdleCallsHere === 0,
		detail: `summary answered ${JSON.stringify(summaryReply.error ?? summaryReply.value)} in ${summaryMs}ms with waitIdle calls=${waitIdleCallsHere}`,
	});
}

await runner.dispose();

const table = assertionTable(rows);
const record = { suite: "wiring-assertions", lib: LIB, rows, pass: table.failed === 0 };
writeJson("wiring-assertions.json", record);
process.stdout.write(`\n### Wiring assertions — lib=${LIB.split("/").slice(-2).join("/")}\n${table.text}\nRESULT: ${record.pass ? "PASS" : "FAIL"}\n`);
process.exit(record.pass ? 0 : 1);
