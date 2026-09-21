#!/usr/bin/env node
/**
 * Equivalence对比 runner: "original fold on the host thread" vs "the same
 * unchanged fold inside a Worker".
 *
 * OFFLINE ONLY: every artifact lives under this research directory. The real
 * `~/.dsh/sessions`, `~/.claude/projects` and the real `usage.db` are never
 * touched; `resolveDbPath()` is never called.
 *
 * Usage:  TZ=UTC node harness/run.mjs [--gap-ms N] [--label NAME]
 */
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";
import { mkdirSync, rmSync, writeFileSync, readdirSync, utimesSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
const { foldDshSource } = await loadDeployed("ingest-dsh.js");
const { foldCcSource } = await loadDeployed("ingest-cc.js");
const { openUsageDb } = await loadDeployed("db.js");
import { writeFixtures, seedSyncState, FIXED_MTIME } from "./fixture.mjs";
import { DEPLOYED_LIB, loadDeployed } from "./deployed-lib.mjs";



const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "out");
const WORK = join(HERE, "..", "fixture", "_run");

const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
	const i = argv.indexOf(name);
	return i >= 0 ? argv[i + 1] : dflt;
};
const GAP_MS = Number(argOf("--gap-ms", "0"));
const USE_BARRIER = argv.includes("--barrier");
const LABEL = argOf("--label", `tmp-${process.env.TZ ?? "unset"}-${Date.now()}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run the full RPC-equivalent endpoint set in a FRESH child process, so the
 * module-level `MAX(day)` cache in db.js starts cold — exactly like the host
 * process would find it right after a worker's first COMMIT.
 */
function runRebuildProbe(dbPath) {
	return new Promise((resolve) => {
		execFile(process.execPath, [join(HERE, "query-probe.mjs"), "--rebuild-and-run", dbPath], { maxBuffer: 64 * 1024 * 1024 },
			(err, stdout) => {
				if (err) return resolve({ error: String(err.message).slice(0, 400) });
				try { resolve(JSON.parse(stdout)); } catch (e) { resolve({ parseError: String(e.message) }); }
			});
	});
}

function runQueryProbe(dbPath) {
	return new Promise((resolve) => {
		execFile(process.execPath, [join(HERE, "query-probe.mjs"), "--run", dbPath], { maxBuffer: 64 * 1024 * 1024 },
			(err, stdout) => {
				if (err) return resolve({ error: String(err.message).slice(0, 400) });
				try { resolve(JSON.parse(stdout)); } catch (e) { resolve({ parseError: String(e.message) }); }
			});
	});
}

/** Replace the fixture-root prefix with `<ROOT>` so baseline and candidate compare. */
function normalize(value, root) {
	if (typeof value === "string") return value.split(root).join("<ROOT>");
	if (Array.isArray(value)) return value.map((v) => normalize(v, root));
	if (value && typeof value === "object") {
		const o = {};
		for (const k of Object.keys(value).sort()) o[k] = normalize(value[k], root);
		return o;
	}
	return value;
}

/** Normalize a fold result (the error strings embed file paths). */
function normResult(r, root) {
	return {
		scanned: r.scanned,
		newEvents: r.newEvents,
		failedFiles: r.failedFiles.map((f) => normalize({ file: f.file, error: f.error }, root)),
	};
}

function dumpDb(db, root) {
	return {
		events: normalize(db.prepare("SELECT * FROM usage_events ORDER BY data_source, session_id, dedup_key, id").all(), root),
		daily: normalize(db.prepare("SELECT * FROM usage_daily ORDER BY day, data_source, model, project").all(), root),
		sync: normalize(
			db.prepare("SELECT * FROM sync_state ORDER BY source").all().map((row) => ({ ...row, source: row.source.split(root).join("<ROOT>") })),
			root,
		),
	};
}

/** Read the DB through a SECOND, independent connection (what an RPC would do). */
function readViaSeparateConnection(dbPath, root, attempt = 1) {
	let c;
	try {
		c = new DatabaseSync(dbPath);
		return dumpDb(c, root);
	} catch (e) {
		if (attempt <= 3) {
			console.error(`   [reader] attempt ${attempt} failed on ${dbPath}: ${e.code} errcode=${e.errcode} "${e.message}" — retrying in 250ms`);
			const dt = new Promise((r) => setTimeout(r, 250));
			return dt.then(() => readViaSeparateConnection(dbPath, root, attempt + 1));
		}
		throw e;
	} finally {
		try { c?.close(); } catch { /* best effort */ }
	}
}

/**
 * Build a fresh fixture root + DB, seed sync_state, then run `fold` either on
 * this thread or inside a worker. Returns a normalized snapshot.
 */
async function runMode({ mode, root, dbPath, gapMs = 0 }) {
	rmSync(root, { recursive: true, force: true });
	mkdirSync(root, { recursive: true });
	rmSync(dbPath, { force: true });
	rmSync(`${dbPath}-wal`, { force: true });
	rmSync(`${dbPath}-shm`, { force: true });
	const f = writeFixtures(root);

	// Seed through the deployed schema + deployed upsertSyncState.
	const seedDb = await openUsageDb(dbPath);
	seedSyncState(seedDb, f);
	seedDb.close();

	const roots = { dshRoot: f.dshRoot, ccRoot: f.ccRoot, cleanRoot: f.cleanRoot };
	const sab = new SharedArrayBuffer(8);
	let result;
	let gapObservation = null;
	let barrierTest = null;

	if (mode === "baseline") {
		const db = await openUsageDb(dbPath);
		const onProgress = () => {};
		result = {
			dshFirst: foldDshSource(db, f.dshRoot, { onProgress }),
			ccFirst: foldCcSource(db, f.ccRoot, { onProgress }),
			dshSecond: foldDshSource(db, f.dshRoot, { onProgress }),
			ccSecond: foldCcSource(db, f.ccRoot, { onProgress }),
			dshClean: foldDshSource(db, f.cleanRoot, { onProgress }),
			ccClean: foldCcSource(db, f.cleanRoot, { onProgress }),
		};
		db.close();
	} else {
		const frozenPath = join(root, "..", "frozen-pre-rebuild.db");
		const w = new Worker(new URL("./worker-run.mjs", import.meta.url), {
			workerData: { dbPath, ...roots, gapMs, frozenPath, barrier: USE_BARRIER, sab },
		});
		result = await new Promise((resolve, reject) => {
			w.on("message", async (m) => {
				if (m.stage === "events-commit") {
					// THE question: what can the host observe between COMMIT and rebuild?
					const obs = readViaSeparateConnection(dbPath, root);
					const t0 = process.hrtime.bigint();
					const probe = await runQueryProbe(dbPath);
					const probeWallMs = Number(process.hrtime.bigint() - t0) / 1e6;
					gapObservation = {
						commitIndex: m.index,
						workerDbStateAfterCommit: m.dbState,
						note: "host read taken between the worker's events COMMIT and its daily rebuild",
						hostProbeWallMs: probeWallMs,
						endpointsColdCache: probe,
						frozenPreRebuildProbe: frozenPath ? await runQueryProbe(frozenPath) : null,
						frozenPreRebuildPath: frozenPath,
						eventRows: obs.events.length,
						dailyRows: obs.daily.length,
						eventsMinusDaily: obs.events.length - obs.daily.reduce((a, r) => a + r.requests, 0),
						dailyRequestsSum: obs.daily.reduce((a, r) => a + r.requests, 0),
						daysInEvents: [...new Set(obs.events.map((e) => new Date(e.ts).toISOString().slice(0, 10)))].sort(),
					};
					if (USE_BARRIER) {
						// BARRIER DESIGN TEST: the worker now holds the events COMMIT
						// open (Atomics.wait) until we release it. Run the RPC set anyway
						// and measure whether the reader blocks, errors (SQLITE_BUSY), or
						// returns immediately on its own WAL snapshot.
						const tb = process.hrtime.bigint();
						const blocked = await runQueryProbe(dbPath);
						const blockedWallMs = Number(process.hrtime.bigint() - tb) / 1e6;
						barrierTest = {
							note: "host RPC run while the worker is parked immediately after events COMMIT (before the daily rebuild)",
							wallMs: blockedWallMs,
							anyError: Object.values(blocked).some((v) => v?.error),
							errors: Object.entries(blocked).filter(([, v]) => v?.error).map(([k, v]) => `${k}: ${v.error}`),
							rawCountSeen: blocked.raw_count?.value,
						};
						Atomics.store(new Int32Array(sab), 0, 1);
						Atomics.notify(new Int32Array(sab), 0);
					}
				} else if (m.stage === "done") {
					resolve(m.result);
				}
			});
			w.on("error", reject);
			w.on("exit", (code) => { if (code !== 0) reject(new Error(`worker exit ${code}`)); });
		});
	}

	// Authoritative final state read through a FRESH connection after the writer closed.
	const final = readViaSeparateConnection(dbPath, root);
	return {
		mode,
		root,
		dbPath,
		endpointsAfterRebuild: await runQueryProbe(dbPath),
		result: {
			dshFirst: normResult(result.dshFirst, root),
			ccFirst: normResult(result.ccFirst, root),
			dshSecond: normResult(result.dshSecond, root),
			ccSecond: normResult(result.ccSecond, root),
			dshClean: normResult(result.dshClean, root),
			ccClean: normResult(result.ccClean, root),
		},
		final,
		gapObservation,
		barrierTest,
	};
}

const runRoot = join(WORK, LABEL);
const baseline = await runMode({ mode: "baseline", root: join(runRoot, "base"), dbPath: join(runRoot, "base.db") });
const candidate = await runMode({ mode: "candidate", root: join(runRoot, "cand"), dbPath: join(runRoot, "cand.db"), gapMs: GAP_MS });

// ------------------------------------------------------------------ comparison
const SECTIONS = [
	["return.dshFirst", baseline.result.dshFirst, candidate.result.dshFirst],
	["return.ccFirst", baseline.result.ccFirst, candidate.result.ccFirst],
	["return.dshSecond", baseline.result.dshSecond, candidate.result.dshSecond],
	["return.ccSecond", baseline.result.ccSecond, candidate.result.ccSecond],
	["return.dshClean", baseline.result.dshClean, candidate.result.dshClean],
	["return.ccClean", baseline.result.ccClean, candidate.result.ccClean],
	["db.usage_events", baseline.final.events, candidate.final.events],
	["db.usage_daily", baseline.final.daily, candidate.final.daily],
	["db.sync_state", baseline.final.sync, candidate.final.sync],
];

const checks = SECTIONS.map(([name, a, b]) => {
	const sa = JSON.stringify(a);
	const sb = JSON.stringify(b);
	let firstDiff = null;
	if (sa !== sb) {
		const lim = Math.min(sa.length, sb.length);
		let i = 0;
		while (i < lim && sa[i] === sb[i]) i += 1;
		firstDiff = { at: i, baseline: sa.slice(Math.max(0, i - 120), i + 240), candidate: sb.slice(Math.max(0, i - 120), i + 240) };
	}
	return { name, equal: sa === sb, baselineLen: sa.length, candidateLen: sb.length, firstDiff };
});

// ------------------------------------------------------- cross-check invariants
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// idempotence: the second pass over an unchanged tree must be a no-op
const idempotent = eq(baseline.result.dshSecond, { scanned: 0, newEvents: 0, failedFiles: baseline.result.dshSecond.failedFiles })
	&& eq(baseline.result.ccSecond, { scanned: 0, newEvents: 0, failedFiles: baseline.result.ccSecond.failedFiles });
// cc rows are identical whichever (and however many) connections wrote them
const ccRows = baseline.final.events.filter((e) => e.data_source === "cc");

const report = {
	label: LABEL,
	tz: process.env.TZ ?? "(unset → system)",
	gapMs: GAP_MS,
	timestamp: new Date().toISOString(),
	equivalence: { overall: checks.every((c) => c.equal), checks },
	baseline,
	candidate,
	invariants: {
		secondPassIdempotent: idempotent,
		ccRowCount: ccRows.length,
		ccRows,
		baselineSyncState: baseline.final.sync,
	},
	gapObservation: candidate.gapObservation,
};

mkdirSync(OUT, { recursive: true });
const outPath = join(OUT, `compare-${LABEL}.json`);
writeFileSync(outPath, JSON.stringify(report, null, 2));

// ------------------------------------------------------------------- console
console.log(`\n=========== EQUIVALENCE (${LABEL}, TZ=${report.tz}, gapMs=${GAP_MS}) ===========`);
for (const c of checks) console.log(`${c.equal ? "PASS" : "FAIL"}  ${c.name}${c.equal ? "" : `  (bl=${c.baselineLen} cd=${c.candidateLen})`}`);
console.log(`OVERALL: ${report.equivalence.overall ? "PASS — byte-identical" : "FAIL — see out/*.json"}`);
console.log(`\nsecond-pass idempotent: ${idempotent}`);
console.log(`\n--- baseline return values ---`);
for (const [k, v] of Object.entries(baseline.result)) console.log(`  ${k}: scanned=${v.scanned} newEvents=${v.newEvents} failed=${v.failedFiles.length} ${v.failedFiles.map((x) => x.error).join(" | ")}`);
console.log(`\n--- baseline usage_events (${baseline.final.events.length}) ---`);
for (const e of baseline.final.events) console.log(`  ${e.data_source} ${e.session_id} ${e.dedup_key} ts=${e.ts} prov=${e.provider} model=${e.model} turn=${e.turn} step=${e.step} in=${e.input_tokens} out=${e.output_tokens} cr=${e.cache_read_tokens} cw=${e.cache_write_tokens} sub=${e.is_subagent}`);
console.log(`\n--- baseline usage_daily (${baseline.final.daily.length}) ---`);
for (const d of baseline.final.daily) console.log(`  ${d.day} ${d.data_source} ${d.model} ${d.project} req=${d.requests} in=${d.input_tokens} out=${d.output_tokens}`);
console.log(`\n--- baseline sync_state ---`);
for (const s of baseline.final.sync) console.log(`  ${s.source} mtime=${s.mtime} size=${s.size} fp=${s.fingerprint} last_seq=${s.last_seq} last_offset=${s.last_offset}`);
// ------------------- SAME-STATE comparison: frozen pre-rebuild vs post-rebuild
// The frozen copy holds exactly the events committed at the first events COMMIT
// (daily NOT yet rebuilt). Comparing it with the same DB after the rebuild
// isolates the COMMIT→rebuild window with the event set held constant, so any
// value difference is a genuine inconsistency rather than a mid-pass artifact.
let sameStateComparison = null;
const frozen = candidate.gapObservation?.frozenPreRebuildProbe;
if (frozen && !frozen.error) {
	const settledAll = await runRebuildProbe(candidate.gapObservation.frozenPreRebuildPath);
	const settled = settledAll.after;
	sameStateComparison = { frozen: candidate.gapObservation.frozenPreRebuildPath, daysRebuilt: settledAll.daysRebuilt, rows: [] };
	console.log(`\n=== SAME-EVENTS: frozen pre-rebuild copy vs the SAME copy after the real rebuildDailyForDays (frozen at commit #${candidate.gapObservation.commitIndex}) ===`);
	console.log(`  days rebuilt: ${JSON.stringify(settledAll.daysRebuilt)}`);
	console.log(`  MAX(day) before rebuild = ${JSON.stringify(settledAll.planBefore?.[1]?.maxDailyDay)}  → heatmap gate uses the DAILY segment only when non-null`);
	console.log(`  MAX(day) after  rebuild = ${JSON.stringify(settledAll.planAfter?.[1]?.maxDailyDay)}`);
	for (const k of Object.keys(frozen)) {
		if (k === "error") continue;
		const a = frozen[k], b = settled[k];
		const same = JSON.stringify(a?.value) === JSON.stringify(b?.value);
		sameStateComparison.rows.push({ endpoint: k, identical: same, preRebuildMs: a?.ms, postRebuildMs: b?.ms,
			preRebuildValue: a?.value, postRebuildValue: same ? undefined : b?.value });
		console.log(`  ${same ? "SAME" : "DIFF"}  ${k.padEnd(18)} pre=${a?.ms?.toFixed(3)}ms post=${b?.ms?.toFixed(3)}ms${same ? "" : `   pre=${JSON.stringify(a?.value).slice(0,120)} post=${JSON.stringify(b?.value).slice(0,120)}`}`);
	}
	const d = sameStateComparison.rows.filter((x) => !x.identical);
	console.log(`  => ${d.length === 0 ? "NO value difference: the COMMIT→rebuild window is not value-observable" : `${d.length} endpoint(s) return DIFFERENT values for the SAME events`}`);
	report.sameStateComparison = sameStateComparison;
	writeFileSync(outPath, JSON.stringify(report, null, 2));
}

// ------------------------------------------- gap-vs-after endpoint comparison
if (candidate.gapObservation?.endpointsColdCache && !candidate.gapObservation.endpointsColdCache.error) {
	const during = candidate.gapObservation.endpointsColdCache;
	const after = candidate.endpointsAfterRebuild;
	const rows = [];
	for (const k of Object.keys(after)) {
		if (k === "error") continue;
		const d = during[k], a = after[k];
		const same = JSON.stringify(d?.value) === JSON.stringify(a?.value);
		rows.push({ endpoint: k, identicalDuringGap: same, duringMs: d?.ms, afterMs: a?.ms, duringErr: d?.error, afterErr: a?.error,
			duringValue: same ? undefined : d?.value, afterValue: same ? undefined : a?.value });
	}
	console.log(`\n--- ENDPOINT RESULTS DURING GAP vs AFTER DAILY REBUILD ---`);
	for (const r of rows) {
		console.log(`  ${r.identicalDuringGap ? "SAME" : "DIFF"}  ${r.endpoint.padEnd(18)} gap=${r.duringMs?.toFixed(2)}ms after=${r.afterMs?.toFixed(2)}ms${r.duringErr ? " ERR=" + r.duringErr : ""}`);
	}
	const diffs = rows.filter((r) => !r.identicalDuringGap);
	console.log(`  => ${diffs.length === 0 ? "no observable result difference" : `${diffs.length} endpoint(s) DIFFER during the gap: ${diffs.map((d) => d.endpoint).join(", ")}`}`);
	report.gapEndpointComparison = rows;
	writeFileSync(outPath, JSON.stringify(report, null, 2));
}
if (candidate.barrierTest) {
	console.log(`\n=== BARRIER TEST: host RPC while the worker holds the post-COMMIT gap ===`);
	console.log(`  host probe wall time: ${candidate.barrierTest.wallMs.toFixed(1)}ms`);
	console.log(`  any SQLITE_BUSY/other error: ${candidate.barrierTest.anyError}${candidate.barrierTest.anyError ? " -> " + candidate.barrierTest.errors.join("; ") : ""}`);
	console.log(`  host saw raw_count: ${JSON.stringify(candidate.barrierTest.rawCountSeen)}`);
	console.log(`  report.barrierTest = ${JSON.stringify(candidate.barrierTest)}`);
}
if (candidate.gapObservation) {
	console.log(`\n--- GAP OBSERVATION (host read between COMMIT and daily rebuild) ---`);
	console.log(JSON.stringify(candidate.gapObservation, null, 2));
}
console.log(`\nraw JSON: ${outPath}`);
