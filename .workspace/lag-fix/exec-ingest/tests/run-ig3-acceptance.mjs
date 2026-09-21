#!/usr/bin/env node
/**
 * U-IG3 acceptance (audit §3.6 A1–A5) — the `rebuildDailyForDays` duplicate-key
 * defect and its fix, measured for real.
 *
 * Scenario (the audit's `probe-r6` shape): `usage_events` carries rows on a
 * NON-CONTIGUOUS set of local days — 08-19, 08-20, 08-21, 08-22, 08-24, 08-25 —
 * while the caller asks for only 4 of them (08-19, 08-20, 08-24, 08-25; that is
 * exactly what a fold pass reports after touching those files). `usage_daily`
 * already holds rows for every one of those days.
 *
 *   deployed  : DELETE covers 4 days, the INSERT's GROUP BY produces 6 →
 *               `UNIQUE constraint failed: usage_daily.day, data_source,
 *               model, project` and the whole rebuild is abandoned.
 *   修法 A    : DELETE covers the full span [min,max] → no conflict.
 *   A4        : instrumented variant proves produced ⊆ deleted.
 *   A2        : `usage_daily` ↔ `usage_events` convergence, computed with a JS
 *               aggregation (NOT SQL GROUP BY — see BATCH-PLAN §3bis.4).
 *   A3        : the 7 data endpoints return the SAME values with and without the
 *               daily rebuild for the same frozen event set.
 *
 * `--real-root` additionally folds the REAL `~/.dsh/sessions` cold and
 * classifies `failedFiles`, i.e. the audit's A1 at production scale.
 */

import { cpSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { LIB_CAND, LIB_ORIG, SCRATCH, assertionTable, freshDir, injectIg3Probe, loadLib, readIg3Probe, variantLib, writeJson } from "./lib/harness.mjs";

const argv = process.argv.slice(2);
const value = (name, fallback) => {
	const withEquals = argv.find((item) => item.startsWith(`${name}=`));
	if (withEquals !== undefined) return withEquals.slice(name.length + 1);
	const index = argv.indexOf(name);
	return index >= 0 && index + 1 < argv.length ? argv[index + 1] : fallback;
};
const LIB = resolve(value("--lib", LIB_CAND));
const REAL_ROOT = value("--real-root", "");
const TZ = process.env.TZ ?? "(system)";

const lib = await loadLib(LIB);
const root = freshDir(join(SCRATCH, "ig3"));

// ------------------------------------------------------------------ utilities
const localDayOf = (ms) => {
	const d = new Date(ms);
	const p = (n) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const noonOf = (day) => {
	const [y, m, d] = day.split("-").map(Number);
	return new Date(y, m - 1, d, 12, 0, 0, 0).getTime();
};
const DAYS = ["2026-08-19", "2026-08-20", "2026-08-21", "2026-08-22", "2026-08-24", "2026-08-25"];
const REQUESTED = ["2026-08-19", "2026-08-20", "2026-08-24", "2026-08-25"]; // non-contiguous on purpose
const GAP_DAYS = DAYS.filter((day) => !REQUESTED.includes(day)); // 08-21, 08-22

/** Build the scenario database: events on all 6 days + stale daily rows. */
async function buildScenario(dbPath, useLib = lib, { seedStale = true } = {}) {
	const db = await useLib.db.openUsageDb(dbPath);
	let n = 0;
	for (const day of DAYS) {
		for (const [model, project, extra] of [
			["m-1", "/p/one", 10],
			["m-2", "/p/two", 20],
		]) {
			n += 1;
			useLib.db.insertEvent(db, {
				data_source: "dsh",
				session_id: `sess-${n}`,
				dedup_key: `t1:s${n}`,
				ts: noonOf(day),
				model,
				project,
				turn: 1,
				step: n,
				input_tokens: extra,
				output_tokens: extra * 2,
				cache_read_tokens: 1,
				cache_write_tokens: 2,
			});
		}
	}
	if (!seedStale) return db;
	// Stale daily rows for EVERY day in the span — the "written by an earlier
	// pass / another file" precondition that turns the gap days into conflicts.
	const insert = db.prepare(
		"INSERT INTO usage_daily (day, data_source, model, project, requests, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens) VALUES (?,?,?,?,?,?,?,?,?)",
	);
	for (const day of DAYS) {
		for (const [model, project] of [
			["m-1", "/p/one"],
			["m-2", "/p/two"],
		]) {
			insert.run(day, "dsh", model, project, 999, 999, 999, 999, 999);
		}
	}
	return db;
}

/** Recompute `usage_daily` from scratch (the reference "full" result). */
function fullRecompute(db) {
	db.exec("DELETE FROM usage_daily");
	db.prepare(
		`INSERT INTO usage_daily (day, data_source, model, project, requests, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens)
		 SELECT strftime('%Y-%m-%d', ts / 1000, 'unixepoch', 'localtime') AS day, data_source,
		        COALESCE(model, '(unknown)'), COALESCE(project, '(unknown)'),
		        COUNT(*), SUM(input_tokens), SUM(output_tokens), SUM(cache_read_tokens), SUM(cache_write_tokens)
		 FROM usage_events
		 GROUP BY day, data_source, COALESCE(model, '(unknown)'), COALESCE(project, '(unknown)')`,
	).run();
}

/** A2 — JS aggregation (never SQL GROUP BY) for the daily↔events convergence. */
function convergence(db) {
	const events = db
		.prepare("SELECT ts, data_source, model, project, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens FROM usage_events")
		.all();
	const expected = new Map();
	const keyOf = (day, source, model, project) => `${day}\u0000${source}\u0000${model}\u0000${project}`;
	for (const row of events) {
		const key = keyOf(localDayOf(row.ts), row.data_source, row.model === null ? "(unknown)" : row.model, row.project === null ? "(unknown)" : row.project);
		const bucket = expected.get(key) ?? { requests: 0, input: 0, output: 0, read: 0, write: 0 };
		bucket.requests += 1;
		bucket.input += row.input_tokens;
		bucket.output += row.output_tokens;
		bucket.read += row.cache_read_tokens;
		bucket.write += row.cache_write_tokens;
		expected.set(key, bucket);
	}
	const actual = new Map();
	for (const row of db.prepare("SELECT day, data_source, model, project, requests, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens FROM usage_daily").all()) {
		actual.set(keyOf(row.day, row.data_source, row.model, row.project), {
			requests: row.requests,
			input: row.input_tokens,
			output: row.output_tokens,
			read: row.cache_read_tokens,
			write: row.cache_write_tokens,
		});
	}
	const mismatched = [];
	for (const [key, want] of expected) {
		const got = actual.get(key);
		if (got === undefined || JSON.stringify(got) !== JSON.stringify(want)) mismatched.push({ key: key.replace(/\u0000/g, "|"), want, got: got ?? null });
	}
	const orphan = [...actual.keys()].filter((key) => !expected.has(key)).map((key) => key.replace(/\u0000/g, "|"));
	return { expectedKeys: expected.size, actualKeys: actual.size, mismatched, orphan };
}

const endpointsOf = (db) => ({
	summary: lib.db.querySummary(db, {}),
	timeseriesDay: lib.db.queryTimeseries(db, { granularity: "day" }),
	timeseriesHour: lib.db.queryTimeseries(db, { granularity: "hour" }),
	heatmap: lib.db.queryHeatmap(db, {}),
	byModel: lib.db.queryByModel(db, {}),
	byProject: lib.db.queryByProject(db, {}),
	byDay: lib.db.queryByDay(db, {}),
	sessions: lib.db.querySessions(db, {}),
});

// ===========================================================================
const rows = [];
const evidence = { tz: TZ, lib: LIB };

// ------------------------------------------------- A1 / A2 / A5 on the fix
{
	const dbPath = join(root, "fix.db");
	const db = await buildScenario(dbPath);
	let error = null;
	try {
		lib.db.rebuildDailyForDays(db, REQUESTED);
	} catch (thrown) {
		error = thrown instanceof Error ? thrown.message : String(thrown);
	}
	evidence.fixRun = { error, dailyAfter: db.prepare("SELECT day, model, requests FROM usage_daily ORDER BY day, model").all() };
	rows.push({ id: "A1a:non-contiguous-rebuild-does-not-throw", ok: error === null, detail: error === null ? "no UNIQUE failure" : `THREW: ${error}` });

	// A2 convergence (JS aggregation)
	const conv = convergence(db);
	evidence.convergence = conv;
	rows.push({
		id: "A2a:daily-converges-to-events(JS aggregation)",
		ok: conv.mismatched.length === 0 && conv.orphan.length === 0 && conv.expectedKeys === conv.actualKeys && conv.expectedKeys > 0,
		detail: `keys expected=${conv.expectedKeys} actual=${conv.actualKeys} mismatched=${conv.mismatched.length} orphan=${conv.orphan.length}${conv.mismatched.length ? ` first=${JSON.stringify(conv.mismatched[0])}` : ""}`,
	});

	// no stale row may survive (the gap days must have been recomputed)
	const stale = db.prepare("SELECT COUNT(*) AS n FROM usage_daily WHERE requests = 999").get().n;
	rows.push({ id: "A2b:no-stale-row-survives", ok: Number(stale) === 0, detail: `${stale} row(s) still carry the pre-seeded 999 marker` });

	// equals a full recompute. NOTE: the reference is computed through the SAME
	// connection (not a file copy) — the database is in WAL mode, so copying just
	// `<db>` yields a database with no tables; a checkpoint would be needed.
	const fixRows = JSON.stringify(db.prepare("SELECT * FROM usage_daily ORDER BY day, model, project").all());
	fullRecompute(db);
	const refRows = JSON.stringify(db.prepare("SELECT * FROM usage_daily ORDER BY day, model, project").all());
	rows.push({ id: "A2c:equals-full-recompute", ok: fixRows === refRows, detail: fixRows === refRows ? "row-for-row identical to a full recompute" : `DIFFERS from full recompute\nfix=${fixRows.slice(0, 300)}\nref=${refRows.slice(0, 300)}` });

	// A5 idempotence — three consecutive rebuilds
	const snapshots = [];
	let repeatError = null;
	for (let i = 0; i < 3; i += 1) {
		try {
			lib.db.rebuildDailyForDays(db, REQUESTED);
		} catch (thrown) {
			repeatError = repeatError ?? (thrown instanceof Error ? thrown.message : String(thrown));
		}
		snapshots.push(JSON.stringify(db.prepare("SELECT * FROM usage_daily ORDER BY day, model, project").all()));
	}
	rows.push({ id: "A5:three-consecutive-rebuilds-stable", ok: repeatError === null && new Set(snapshots).size === 1, detail: repeatError ?? `3 runs, ${new Set(snapshots).size} distinct result(s)` });
	db.close();
}

// ---------------------------------------------------------------- A4 (subset)
{
	const probeLib = variantLib("ig3probe", (file, source) => injectIg3Probe(file, source));
	const probeDb = await loadLib(probeLib);
	const dbPath = join(root, "probe.db");
	const db2 = await buildScenario(dbPath, probeDb);
	probeDb.db.rebuildDailyForDays(db2, REQUESTED);
	probeDb.db.rebuildDailyForDays(db2, REQUESTED);
	const probes = readIg3Probe(db2);
	const deleted = new Set(probes.at(-1)?.deleted ?? []);
	const produced = probes.at(-1)?.produced ?? [];
	const violations = produced.filter((day) => !deleted.has(day));
	evidence.a4 = { calls: probes.length, deleted: [...deleted], produced, violations };
	db2.close();
	rows.push({
		id: "A4:produced-day-set-is-a-subset-of-the-DELETE-set",
		ok: probes.length > 0 && violations.length === 0,
		detail: `${probes.length} instrumented rebuild(s); DELETE set=${JSON.stringify([...deleted])}; GROUP BY produced=${JSON.stringify(produced)}; produced∖deleted=${JSON.stringify(violations)}`,
	});
}

// -------------------------------------------------------------------- A3
{
	/* The audit's A3: freeze ONE event set, then compare the 7 data endpoints
	   between "no daily aggregation at all" (the pre-rebuild state, whose
	   `MAX(day)` gate is null so every window takes the exact raw-events route)
	   and "daily aggregation rebuilt from those very events" (which routes the
	   aggregated segment through `usage_daily`). Both routes must agree — that is
	   the whole reason the COMMIT→rebuild window is invisible to users. */
	const dbPath = join(root, "endpoints.db");
	const db = await buildScenario(dbPath, lib, { seedStale: false });
	const beforePath = join(root, "endpoints-before.db");
	// WAL mode: checkpoint first, otherwise the copy has the schema but no rows.
	db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
	cpSync(dbPath, beforePath);
	let after;
	let endpointError = null;
	try {
		after = endpointsOf(db);
	} catch (thrown) {
		endpointError = thrown instanceof Error ? thrown.message : String(thrown);
	}
	// rebuild from the same events, then re-read through a fresh connection
	lib.db.rebuildDailyForDays(db, DAYS);
	db.close();
	const beforeDb = new DatabaseSync(beforePath, { readOnly: true });
	const afterDb = new DatabaseSync(dbPath, { readOnly: true });
	let before = null;
	let afterRebuilt = null;
	try {
		before = endpointsOf(beforeDb);
		afterRebuilt = endpointsOf(afterDb);
	} catch (thrown) {
		endpointError = endpointError ?? (thrown instanceof Error ? thrown.message : String(thrown));
	}
	const summary = beforeDb.prepare("SELECT COUNT(*) AS n FROM usage_events").get().n;
	const dailyRows = afterDb.prepare("SELECT COUNT(*) AS n FROM usage_daily").get().n;
	beforeDb.close();
	afterDb.close();
	const comparable = endpointError === null;
	const equal = comparable ? JSON.stringify(before) === JSON.stringify(afterRebuilt) : false;
	const differing = comparable ? Object.keys(before).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(afterRebuilt[key])) : [];
	evidence.endpoints = { endpointError, events: summary, dailyRows: Number(dailyRows), equal, differing, summaryValues: before?.summary ?? null };
	rows.push({
		id: "A3:endpoints-same-with-and-without-the-daily-rebuild",
		ok: comparable && equal && Number(summary) > 0,
		detail:
			endpointError !== null
				? `endpoint query FAILED in this sandbox: ${endpointError}`
				: `${Object.keys(before).length} endpoints, events=${summary}, daily rows after rebuild=${dailyRows}; byte-identical=${equal}${differing.length ? `; differing=${JSON.stringify(differing)}` : ""}`,
	});
}

// ------------------------------------------------- A1 at real production scale
if (REAL_ROOT !== "") {
	const dbPath = join(root, "real-cold.db");
	const db = await lib.db.openUsageDb(dbPath);
	const started = Date.now();
	const dsh = lib.ingestDsh.foldDshSource(db, REAL_ROOT, {});
	const cc = lib.ingestCc.foldCcSource(db, homedir() + "/.claude/projects", {});
	const wallMs = Date.now() - started;
	db.close();
	const classify = (list) => {
		const out = { total: list.length, unique: 0, open: 0, other: 0, samples: [] };
		for (const entry of list) {
			if (/UNIQUE constraint failed: usage_daily/.test(entry.error)) out.unique += 1;
			else if (/unable to open database file/.test(entry.error)) out.open += 1;
			else out.other += 1;
			if (out.samples.length < 3) out.samples.push(entry.error);
		}
		return out;
	};
	const dshFailed = classify(dsh.failedFiles);
	evidence.realCold = { wallMs, dshScanned: dsh.scanned, dshNew: dsh.newEvents, dshFailed, ccScanned: cc.scanned, ccNew: cc.newEvents, ccFailed: classify(cc.failedFiles) };
	rows.push({
		id: "A1b:real-sessions-root-UNIQUE-failures==0",
		ok: dshFailed.unique === 0,
		detail: `real fold: scanned=${dsh.scanned} new=${dsh.newEvents} failed=${dshFailed.total} (UNIQUE=${dshFailed.unique}, open=${dshFailed.open}, other=${dshFailed.other}) in ${wallMs}ms`,
	});
}

const table = assertionTable(rows);
const record = { suite: "U-IG3-acceptance-A1-A5", tz: TZ, lib: LIB, realRoot: REAL_ROOT || null, rows, evidence, pass: table.failed === 0 };
writeJson(`ig3-acceptance-${TZ.replace(/\//g, "-")}${REAL_ROOT ? "-real" : ""}.json`, record);
process.stdout.write(`\n### U-IG3 acceptance — TZ=${TZ} lib=${LIB.split("/").slice(-2).join("/")}${REAL_ROOT ? ` realRoot=${REAL_ROOT}` : ""}\n${table.text}\nRESULT: ${record.pass ? "PASS" : "FAIL"}\n`);
process.exit(record.pass ? 0 : 1);
