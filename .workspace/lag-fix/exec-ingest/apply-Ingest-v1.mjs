#!/usr/bin/env node
/**
 * apply-Ingest-v1.mjs — anchor-minimal patch for the dsh-perf-fix Ingest-v1 batch
 * (audit `exec-audit/ingest/audit.md` §2/§3, BATCH-PLAN §3bis).
 *
 * WHY ANCHORS AND NOT FILE COPIES
 * The deployed tree is NOT the workspace source tree: `db.js` differs by 21
 * lines (hour-bucket timeseries), `index.js` by 66 (settings/P0-b + R4 v1) and
 * `rpc.js` registers the route through a COMPLETELY different API
 * (`ctx.connection.rpc.handle("/usage", handle, {authority})` — the deployed
 * 0.1.1-rc.2 posture — versus `ctx.connection.register(ctx, "/usage", handle)`
 * in the source mirror). Copying a workspace file over a deployed one would
 * break `/usage` outright. Every change below is therefore a single anchored
 * textual edit, and the tool is FAIL-CLOSED: if an anchor does not match
 * exactly once, nothing is written.
 *
 * Usage
 *   node apply-Ingest-v1.mjs                       # dry-run against DEPLOYED
 *   node apply-Ingest-v1.mjs --root <lib dir>      # dry-run against another tree
 *   node apply-Ingest-v1.mjs --apply               # write (pre-image + checks)
 *
 * Safety properties (enforced here, not by convention)
 *   1. dry-run is the default; `--apply` is required to touch the filesystem.
 *   2. every anchor must match exactly once, and EVERY file is validated before
 *      the first write — a single mismatch aborts the whole run with exit 1.
 *   3. an unchanged pre-image is copied to `pre-image/` before any write (a
 *      second run never overwrites the first, original pre-image).
 *   4. after validation every patched/new file is syntax-checked (`node --check`
 *      on the file plus an authoritative ESM parse of a `.mjs` copy) and the
 *      introduced identifiers are validated: declared in the same file, and
 *      every imported name actually exported by the file it comes from.
 *   5. new files are created only when absent; a pre-existing DIFFERENT file is
 *      a conflict and aborts unless `--replace-new` is passed.
 *   6. idempotent: a file already carrying the `dsh-perf-fix Ingest-v1` marker
 *      is recognised and skipped.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CANDIDATES = join(HERE, "candidates");
const DEFAULT_ROOT = join(homedir(), ".dsh", "profiles", "node_modules", "@local", "dsh-usage", "lib");
const MARKER = "dsh-perf-fix Ingest-v1";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, fallback) => {
	const index = argv.indexOf(name);
	return index >= 0 && index + 1 < argv.length ? argv[index + 1] : fallback;
};
const APPLY = flag("--apply");
const REPLACE_NEW = flag("--replace-new");
const ROOT = resolve(value("--root", DEFAULT_ROOT));
const PRE_IMAGE_DIR = resolve(value("--pre-image", join(HERE, "pre-image")));

/* ------------------------------------------------------------------ db.js */

/** D2 anchor: the range computation. */
const DB_RANGE_FIND =
	"\tconst lo = days.reduce((acc, day) => Math.min(acc, localDayMs(day)), Number.POSITIVE_INFINITY);\n" +
	"\tconst hiExclusive = days.reduce((acc, day) => Math.max(acc, localDayMs(day)), Number.NEGATIVE_INFINITY) + 86_400_000;\n";

const DB_RANGE_REPLACE =
	"\t/* dsh-perf-fix Ingest-v1 (U-IG3, 修法 A — 区间对齐). The INSERT below scans the\n" +
	"\t   WHOLE half-open span [lo, hiExclusive), so its GROUP BY can produce a row for\n" +
	"\t   EVERY local day in that span — including GAP days that `days` never listed.\n" +
	"\t   Deleting only `days` therefore left gap-day rows in the table, and the bare\n" +
	"\t   INSERT then failed with `UNIQUE constraint failed: usage_daily.day,\n" +
	"\t   data_source, usage_daily.model, usage_daily.project` (11/11 empty-DB\n" +
	"\t   reproductions match this shape exactly: produced = deleted ∪ gap days, and\n" +
	"\t   every leftover row is byte-equal to the freshly produced one).\n" +
	"\t   Deleting the full span is the correct semantic, not a side effect: a gap\n" +
	"\t   day's raw events may have been rewritten by this very pass, so it is supposed\n" +
	"\t   to be recomputed.\n" +
	"\t   The upper bound is anchored on the local CALENDAR (next local midnight), not on\n" +
	"\t   `+ 86_400_000`: on a DST spring-forward day the naive form lands one hour\n" +
	"\t   INSIDE the following local day (`2026-03-08` in America/New_York →\n" +
	"\t   `2026-03-09T01:00`), so both the INSERT and this DELETE would cover a PARTIAL\n" +
	"\t   extra day and could write a truncated aggregate over it. Byte-identical to the\n" +
	"\t   old expression outside DST boundaries (verified). */\n" +
	"\tconst lo = days.reduce((acc, day) => Math.min(acc, localDayMs(day)), Number.POSITIVE_INFINITY);\n" +
	"\tconst lastDay = days.reduce((acc, day) => (localDayMs(day) > localDayMs(acc) ? day : acc), days[0]);\n" +
	"\tconst hiExclusive = (() => {\n" +
	"\t\tconst [year, month, date] = String(lastDay).split(\"-\").map(Number);\n" +
	"\t\treturn new Date(year, month - 1, date + 1).getTime();\n" +
	"\t})();\n" +
	"\t/** Local days covered by [lo, hiExclusive) — the DELETE set must equal it. */\n" +
	"\tconst spanDays = [];\n" +
	"\tfor (let cursor = lo; cursor < hiExclusive; ) {\n" +
	"\t\tconst cursorDay = localDayOf(cursor);\n" +
	"\t\tspanDays.push(cursorDay);\n" +
	"\t\tconst [year, month, date] = cursorDay.split(\"-\").map(Number);\n" +
	"\t\tcursor = new Date(year, month - 1, date + 1).getTime();\n" +
	"\t}\n";

const DB_EDITS = [
	{
		id: "D1-openUsageDb-pragmas",
		what: "U-IG1.5 busy_timeout=5000 + 加固 PRAGMA temp_store=2 (after journal_mode=WAL)",
		find: '\tdb.exec("PRAGMA journal_mode = WAL");\n',
		replace:
			'\tdb.exec("PRAGMA journal_mode = WAL");\n' +
			"\t/* dsh-perf-fix Ingest-v1 (U-IG1.5): a SECOND connection (the ingest worker)\n" +
			"\t   now writes to this same file, so a host-side writer can collide with it.\n" +
			"\t   The shipped default is `busy_timeout = 0` (measured `{timeout: 0}`), which\n" +
			"\t   turned every collision into an immediate `ERR_SQLITE_ERROR: database is\n" +
			"\t   locked`; 5s converts that class of intermittent hard failures into a short\n" +
			"\t   wait (measured: immediate failure -> 1530ms wait -> success). */\n" +
			'\tdb.exec("PRAGMA busy_timeout = 5000");\n' +
			"\t/* dsh-perf-fix Ingest-v1 — HARDENING, explicitly NOT an U-IG3 fix: any\n" +
			"\t   aggregate that needs the SQLite temp store can fail with `unable to open\n" +
			"\t   database file` when the temp file cannot be created (multi-column GROUP BY\n" +
			"\t   40/40 failed in the audit's sandbox, single-column 10/10 succeeded, and\n" +
			"\t   `PRAGMA temp_store = 2` fixed it immediately). `usage_daily`'s rebuild is\n" +
			"\t   exactly such an aggregate, and the 3 unexplained OPEN failures in the\n" +
			"\t   empty-DB reproduction have that signature. Memory cost is negligible at\n" +
			"\t   this corpus size (115k events, ~300 groups). */\n" +
			'\tdb.exec("PRAGMA temp_store = 2");\n',
	},
	{
		id: "D2-rebuildDaily-range-and-span",
		what: "U-IG3 修法 A: DST-anchored range + the exact set of local days the INSERT covers (`spanDays`)",
		find: DB_RANGE_FIND,
		replace: DB_RANGE_REPLACE,
	},
	{
		id: "D3-placeholders-moved-to-span",
		what: "U-IG3 修法 A: the old top-of-function `placeholders` (built from `days`) is removed — it would both shadow the span set and trip a TDZ error, because `spanDays` is computed further down",
		find: '\tconst placeholders = days.map(() => "?").join(", ");\n',
		replace: "",
	},
	{
		id: "D3b-delete-uses-span",
		what: "U-IG3 修法 A: declare `placeholders` from `spanDays` right at the DELETE and bind `spanDays`",
		find: "\t\tdb.prepare(`DELETE FROM usage_daily WHERE day IN (${placeholders})`).run(...days);\n",
		replace:
			"\t\t/* dsh-perf-fix Ingest-v1 (U-IG3 修法 A): bind the SPAN set, not the caller's\n" +
			"\t\t   `days` set — the two differ exactly by the gap days whose stale rows used to\n" +
			"\t\t   collide with the freshly produced ones. */\n" +
			'\t\tconst placeholders = spanDays.map(() => "?").join(", ");\n' +
			"\t\tdb.prepare(`DELETE FROM usage_daily WHERE day IN (${placeholders})`).run(...spanDays);\n",
	},
	{
		id: "D4-insert-upsert",
		what: "U-IG3 修法 B: INSERT … ON CONFLICT DO UPDATE (belt & braces over 修法 A)",
		find: "GROUP BY day, data_source, COALESCE(model, '(unknown)'), COALESCE(project, '(unknown)')`).run(lo, hiExclusive);\n",
		replace:
			"GROUP BY day, data_source, COALESCE(model, '(unknown)'), COALESCE(project, '(unknown)')\n" +
			"/* dsh-perf-fix Ingest-v1 (U-IG3 修法 B): 修法 A alone removes today's root cause; this\n" +
			"   ON CONFLICT keeps any future span/set mismatch from turning the whole daily rebuild\n" +
			"   into a hard failure (today one such failure drops EVERY day of that file). The values\n" +
			"   are full replacements, matching insertEvent's existing UPSERT posture. */\n" +
			"ON CONFLICT(day, data_source, model, project) DO UPDATE SET\n" +
			"  requests = excluded.requests,\n" +
			"  input_tokens = excluded.input_tokens,\n" +
			"  output_tokens = excluded.output_tokens,\n" +
			"  cache_read_tokens = excluded.cache_read_tokens,\n" +
			"  cache_write_tokens = excluded.cache_write_tokens`).run(lo, hiExclusive);\n",
	},
	{
		id: "D5-export-invalidate",
		what: "U-IG1.3: export `invalidateMaxDailyDayCache` so the HOST can clear its MAX(day) gate cache",
		find: "function invalidateMaxDailyDayCache() {\n",
		replace: "export function invalidateMaxDailyDayCache() {\n",
	},
];

/* --------------------------------------------------------------- index.js */

const INDEX_EDITS = [
	{
		id: "I1-import-runner",
		what: "U-IG1.6: import the ingest runner",
		find: 'import { registerUsageRpc } from "./rpc.js";\n',
		replace: 'import { registerUsageRpc } from "./rpc.js";\nimport { createIngestRunner } from "./ingest-runner.js";\n',
	},
	{
		id: "I2-switch-constants",
		what: "U-IG1.6/U-IG2: INGEST_VIA_WORKER (rollback switch) + INGEST_TIMER_ENABLED (DEFAULT OFF, gated on G1–G5)",
		find: "/** Ingest cadence: 30–60s window → 45s, constant (AUDIT U09 step 3). */\nconst INGEST_INTERVAL_MS = 45_000;\n",
		replace:
			"/** Ingest cadence: 30–60s window → 45s, constant (AUDIT U09 step 3). */\n" +
			"const INGEST_INTERVAL_MS = 45_000;\n" +
			"\n" +
			"/**\n" +
			" * dsh-perf-fix Ingest-v1 (audit U-IG1): run the fold on the ingest WORKER.\n" +
			" * `false` restores the pre-Ingest-v1 behaviour (synchronous fold ON the host\n" +
			" * event loop) without touching any other file — the rollback point the audit\n" +
			" * asks to keep until the worker path has proven itself in production.\n" +
			" */\n" +
			"const INGEST_VIA_WORKER = true;\n" +
			"\n" +
			"/**\n" +
			" * dsh-perf-fix Ingest-v1 / U-IG2: is the 45s periodic ingest timer installed?\n" +
			" *\n" +
			" * **DEFAULT OFF, ON PURPOSE — DO NOT FLIP IT WITHOUT THE G1–G5 GATES.**\n" +
			" * The 45s loop is only safe once one ingest pass no longer blocks the host event\n" +
			" * loop (gate G1: `perf_hooks.monitorEventLoopDelay` max < 100 ms across a full\n" +
			" * pass; the pre-fix synchronous pass measures 2.682 s incremental and 36.1 s\n" +
			" * cold). Enabling it earlier trades \"stale data\" for \"a 2.7 s freeze every\n" +
			" * 45 s\".\n" +
			" *\n" +
			" * How to enable: flip this to `true` and restart — no other edit is needed. The\n" +
			" * installation below declares the dependency with `ctx.inject([\"timer\"], cb)`\n" +
			" * and never reads `ctx.setInterval` speculatively: that probe is what broke the\n" +
			" * timer in the first place (`ctx.setInterval` is a timer-service mixin accessor,\n" +
			" * so reading it without the injection throws `cannot get property \"timer\"\n" +
			" * without inject`; because `A ? B : C` evaluates `A` first, the `ctx.effect`\n" +
			" * fallback branch was unreachable and the bootstrap ended as one swallowed warn\n" +
			" * line).\n" +
			" */\n" +
			"const INGEST_TIMER_ENABLED = false;\n",
	},
	{
		id: "I3-runner-variable",
		what: "U-IG1.6: the runner reference",
		find: "\tlet disposeTimer = null;\n",
		replace:
			"\tlet disposeTimer = null;\n" +
			"\t/* dsh-perf-fix Ingest-v1 (U-IG1.6): the worker-backed ingest runner. Created\n" +
			"\t   only AFTER `dbPath` is known — the worker opens its own connection to that\n" +
			"\t   exact path and never resolves the path itself. */\n" +
			"\tlet runner = null;\n",
	},
	{
		id: "I4-runIngest-split",
		what: "U-IG1.6: the old synchronous body becomes `runIngestSync` (rollback), the worker path becomes `runIngestWorker`, and `runIngest` dispatches between them",
		find:
			"\t/** Run one ingest pass over both sources (best-effort, warn-only). */\n" +
			"\tconst runIngest = async () => {\n" +
			"\t\t// dispose 之后不得再启动新 ingest（timer 已清，但飞行中的手动 refresh\n" +
			"\t\t// 或已排队 tick 仍可能落到这里）。\n" +
			"\t\tif (disposed || db === null) return;\n" +
			"\t\ttry {\n",
		replace:
			"\t/** Pre-Ingest-v1 path: fold both sources synchronously ON the host thread.\n" +
			"\t *  Kept as the rollback point (`INGEST_VIA_WORKER = false`). */\n" +
			"\tconst runIngestSync = async () => {\n" +
			"\t\ttry {\n",
	},
	{
		id: "I5-runIngest-dispatch",
		what: "U-IG1.6: `runIngest` keeps the dispose/db guard and the await semantics for the first scan, the 45s tick and `/usage/refresh`",
		find:
			"\t\t} catch (error) {\n" +
			"\t\t\tlog.warn(`ingest failed: ${error instanceof Error ? error.message : String(error)}`);\n" +
			"\t\t}\n" +
			"\t};\n" +
			"\n" +
			"\t/** `status` endpoint value (REVIEW P0): reads the mutable state at call\n",
		replace:
			"\t\t} catch (error) {\n" +
			"\t\t\tlog.warn(`ingest failed: ${error instanceof Error ? error.message : String(error)}`);\n" +
			"\t\t}\n" +
			"\t};\n" +
			"\n" +
			"\t/** Worker path (dsh-perf-fix Ingest-v1, U-IG1): the host thread only sees\n" +
			"\t *  short message deliveries while the fold runs on its own thread. */\n" +
			"\tconst runIngestWorker = async () => {\n" +
			"\t\tlet result;\n" +
			"\t\ttry {\n" +
			"\t\t\tresult = await runner.run();\n" +
			"\t\t} catch (error) {\n" +
			"\t\t\tlog.warn(`ingest failed: ${error instanceof Error ? error.message : String(error)}`);\n" +
			"\t\t\treturn;\n" +
			"\t\t}\n" +
			"\t\tif (!result.ok) {\n" +
			"\t\t\tlog.warn(`ingest failed (${result.reason}): ${result.message ?? \"no detail\"}`);\n" +
			"\t\t\treturn;\n" +
			"\t\t}\n" +
			"\t\t/* The worker's LAST progress message may have been throttled away, so the\n" +
			"\t\t   authoritative counters come from the settled result (the same values the\n" +
			"\t\t   synchronous path published). */\n" +
			"\t\tingestSummary.scannedDsh = result.dsh.scanned;\n" +
			"\t\tingestSummary.newEventsDsh = result.dsh.newEvents;\n" +
			"\t\tingestSummary.failedDsh = result.dsh.failedFiles.length;\n" +
			"\t\tingestSummary.scannedCc = result.cc.scanned;\n" +
			"\t\tingestSummary.newEventsCc = result.cc.newEvents;\n" +
			"\t\tingestSummary.failedCc = result.cc.failedFiles.length;\n" +
			"\t\tlastIngest = Date.now();\n" +
			"\t\tif (firstScanAt === null) firstScanAt = lastIngest;\n" +
			"\t\tlog.info(\n" +
			"\t\t\t`ingest done: dsh scanned=${result.dsh.scanned} new=${result.dsh.newEvents} failed=${result.dsh.failedFiles.length}; ` +\n" +
			"\t\t\t\t`cc scanned=${result.cc.scanned} new=${result.cc.newEvents} failed=${result.cc.failedFiles.length}`,\n" +
			"\t\t);\n" +
			"\t};\n" +
			"\n" +
			"\t/** Run one ingest pass over both sources (best-effort, warn-only). */\n" +
			"\tconst runIngest = async () => {\n" +
			"\t\t// dispose 之后不得再启动新 ingest（timer 已清，但飞行中的手动 refresh\n" +
			"\t\t// 或已排队 tick 仍可能落到这里）。\n" +
			"\t\tif (disposed || db === null) return;\n" +
			"\t\tif (INGEST_VIA_WORKER && runner !== null) {\n" +
			"\t\t\tawait runIngestWorker();\n" +
			"\t\t\treturn;\n" +
			"\t\t}\n" +
			"\t\tawait runIngestSync();\n" +
			"\t};\n" +
			"\n" +
			"\t/** `status` endpoint value (REVIEW P0): reads the mutable state at call\n",
	},
	{
		id: "I6-register-rpc",
		what: "U-IG1.4: pass the refresh de-duplication seam (join-or-start single-flight); no data endpoint gets a barrier",
		find: "\tregisterUsageRpc(ctx, { db: () => db, ingest: runIngest, statusProvider });\n",
		replace:
			"\t/* dsh-perf-fix Ingest-v1 (U-IG1.4): `waitIdle` is the refresh de-duplication\n" +
			"\t   seam — it JOINS the in-flight pass when there is one and starts one\n" +
			"\t   otherwise, which is exactly the single-flight `runner.run()`. (The audit\n" +
			"\t   sketch wrote `runner.inFlight ?? Promise.resolve()`; that form makes a\n" +
			"\t   manual `/usage/refresh` a NO-OP whenever no pass is running — and with the\n" +
			"\t   45s timer switched off that is the only working way to refresh. The\n" +
			"\t   behaviour-preserving form is used instead; see report.md §deviations.)\n" +
			"\t   NO data endpoint gets a barrier: that would hand the whole fold duration to\n" +
			"\t   query latency and destroy `status` progress visibility. */\n" +
			"\tregisterUsageRpc(ctx, {\n" +
			"\t\tdb: () => db,\n" +
			"\t\tingest: runIngest,\n" +
			"\t\tstatusProvider,\n" +
			"\t\twaitIdle: () => (runner === null ? runIngest() : runner.run()),\n" +
			"\t});\n",
	},
	{
		id: "I7-create-runner",
		what: "U-IG1.6: create the runner once the DB path is known; worker progress feeds `ingestSummary`",
		find:
			"\t\t\t\tdb = openedDb;\n" +
			"\t\t\t\topenedDb = null;\n" +
			"\t\t\t\tdbPath = resolved.path;\n" +
			"\t\t\t\tdbSource = resolved.source;\n" +
			"\t\t\t\tlog.info(`db ready at ${resolved.path} (${resolved.source})`);\n",
		replace:
			"\t\t\t\tdb = openedDb;\n" +
			"\t\t\t\topenedDb = null;\n" +
			"\t\t\t\tdbPath = resolved.path;\n" +
			"\t\t\t\tdbSource = resolved.source;\n" +
			"\t\t\t\tif (INGEST_VIA_WORKER) {\n" +
			"\t\t\t\t\t/* dsh-perf-fix Ingest-v1 (U-IG1.6): the worker opens its OWN\n" +
			"\t\t\t\t\t   connection to this exact path, so the runner is created only\n" +
			"\t\t\t\t\t   here — after the path is resolved and the schema ensured. */\n" +
			"\t\t\t\t\trunner = createIngestRunner({\n" +
			"\t\t\t\t\t\tdbPath: resolved.path,\n" +
			"\t\t\t\t\t\tlog,\n" +
			"\t\t\t\t\t\tonProgress: ({ phase, scanned, newEvents }) => {\n" +
			"\t\t\t\t\t\t\tif (phase === \"dsh\") {\n" +
			"\t\t\t\t\t\t\t\tingestSummary.scannedDsh = scanned;\n" +
			"\t\t\t\t\t\t\t\tingestSummary.newEventsDsh = newEvents;\n" +
			"\t\t\t\t\t\t\t} else {\n" +
			"\t\t\t\t\t\t\t\tingestSummary.scannedCc = scanned;\n" +
			"\t\t\t\t\t\t\t\tingestSummary.newEventsCc = newEvents;\n" +
			"\t\t\t\t\t\t\t}\n" +
			"\t\t\t\t\t\t},\n" +
			"\t\t\t\t\t});\n" +
			"\t\t\t\t}\n" +
			"\t\t\t\tlog.info(`db ready at ${resolved.path} (${resolved.source})`);\n",
	},
	{
		id: "I8-timer-block",
		what: "U-IG2 fix shape + switch: install through `ctx.inject([\"timer\"], cb)`, never through a throwing `typeof ctx.setInterval` probe",
		find:
			"\t\t\tdisposeTimer =\n" +
			"\t\t\t\ttypeof ctx.setInterval === \"function\"\n" +
			"\t\t\t\t\t? ctx.setInterval(runIngest, INGEST_INTERVAL_MS)\n" +
			"\t\t\t\t\t: ctx.effect(() => {\n" +
			"\t\t\t\t\t\t\tconst timer = setInterval(() => void runIngest(), INGEST_INTERVAL_MS);\n" +
			"\t\t\t\t\t\t\treturn () => clearInterval(timer);\n" +
			"\t\t\t\t\t\t}, \"dsh-usage: ingest interval\");\n" +
			"\t\t\tif (!isActive(bootstrapGeneration)) {\n" +
			"\t\t\t\ttry { disposeTimer?.(); } catch { /* best effort */ }\n" +
			"\t\t\t\tdisposeTimer = null;\n" +
			"\t\t\t}\n",
		replace:
			"\t\t\t/* dsh-perf-fix Ingest-v1 (U-IG2 fix shape, audit §1.5) — armed only when\n" +
			"\t\t\t   INGEST_TIMER_ENABLED says so (default OFF; see the constant). */\n" +
			"\t\t\tif (INGEST_TIMER_ENABLED) {\n" +
			"\t\t\t\tctx.inject([\"timer\"], (timerCtx) => {\n" +
			"\t\t\t\t\tif (!isActive(bootstrapGeneration)) return;\n" +
			"\t\t\t\t\tdisposeTimer = timerCtx.setInterval(() => void runIngest(), INGEST_INTERVAL_MS);\n" +
			"\t\t\t\t\tctx.effect(\n" +
			"\t\t\t\t\t\t() => () => {\n" +
			"\t\t\t\t\t\t\ttry {\n" +
			"\t\t\t\t\t\t\t\tdisposeTimer?.();\n" +
			"\t\t\t\t\t\t\t} catch {\n" +
			"\t\t\t\t\t\t\t\t// best effort\n" +
			"\t\t\t\t\t\t\t}\n" +
			"\t\t\t\t\t\t\tdisposeTimer = null;\n" +
			"\t\t\t\t\t\t},\n" +
			"\t\t\t\t\t\t\"dsh-usage: ingest interval\",\n" +
			"\t\t\t\t\t);\n" +
			"\t\t\t\t});\n" +
			"\t\t\t}\n",
	},
	{
		id: "I9-dispose-runner",
		what: "U-IG1.6 / gate G4: terminate the worker on plugin unload so a reload cannot leak a thread",
		find:
			"\t\t\tdisposed = true;\n" +
			"\t\t\tactivationGeneration += 1;\n" +
			"\t\t\ttry {\n" +
			"\t\t\t\tdisposeTimer?.();\n" +
			"\t\t\t} catch {\n" +
			"\t\t\t\t// best effort\n" +
			"\t\t\t}\n",
		replace:
			"\t\t\tdisposed = true;\n" +
			"\t\t\tactivationGeneration += 1;\n" +
			"\t\t\ttry {\n" +
			"\t\t\t\tdisposeTimer?.();\n" +
			"\t\t\t} catch {\n" +
			"\t\t\t\t// best effort\n" +
			"\t\t\t}\n" +
			"\t\t\tdisposeTimer = null;\n" +
			"\t\t\t/* dsh-perf-fix Ingest-v1 (U-IG1.6 / gate G4): terminate the ingest\n" +
			"\t\t\t   worker. Fire-and-forget — an effect teardown must not be async. */\n" +
			"\t\t\ttry {\n" +
			"\t\t\t\tvoid runner?.dispose();\n" +
			"\t\t\t} catch {\n" +
			"\t\t\t\t// best effort\n" +
			"\t\t\t}\n" +
			"\t\t\trunner = null;\n",
	},
];

/* ----------------------------------------------------------------- rpc.js */

const RPC_EDITS = [
	{
		id: "R1-deps-waitIdle",
		what: "U-IG1.4: accept the optional `waitIdle` seam",
		find: "\tconst { ingest, statusProvider } = deps;\n",
		replace: "\tconst { ingest, statusProvider, waitIdle } = deps;\n",
	},
	{
		id: "R2-refresh-dedupe",
		what: "U-IG1.4: refresh joins the in-flight pass instead of stacking a second fold (status + the 7 data endpoints are untouched)",
		find:
			'\t\t\tif (endpoint === "refresh") {\n' +
			'\t\t\t\tif (typeof ingest === "function") await ingest();\n' +
			"\t\t\t\treturn { ok: true, value: statusProvider() };\n" +
			"\t\t\t}\n",
		replace:
			'\t\t\tif (endpoint === "refresh") {\n' +
			"\t\t\t\t/* dsh-perf-fix Ingest-v1 (U-IG1.4): join the SINGLE in-flight ingest pass\n" +
			"\t\t\t\t   instead of stacking a second fold (client.js polls `/usage/refresh` on a\n" +
			"\t\t\t\t   timer and does no in-flight de-duplication of its own). `waitIdle` is\n" +
			"\t\t\t\t   supplied by lib/index.js and means \"join the running pass, else start\n" +
			"\t\t\t\t   one\"; when absent the previous `ingest()` path is kept verbatim.\n" +
			"\t\t\t\t   NO data endpoint gets a barrier — see the audit: the COMMIT→rebuild\n" +
			"\t\t\t\t   window is unobservable on all 9 endpoints, while a barrier would hand\n" +
			"\t\t\t\t   the entire fold duration to query latency and destroy `status` progress\n" +
			"\t\t\t\t   visibility (which is deliberate). */\n" +
			'\t\t\t\tif (typeof waitIdle === "function") await waitIdle();\n' +
			'\t\t\t\telse if (typeof ingest === "function") await ingest();\n' +
			"\t\t\t\treturn { ok: true, value: statusProvider() };\n" +
			"\t\t\t}\n",
	},
];

/** New files: `candidates/<name>` → `<root>/<name>`. */
const NEW_FILES = ["ingest-worker.js", "ingest-runner.js"];

/** Identifiers the patch introduces — each MUST be declared in that same file. */
const REQUIRED_DECLARATIONS = {
	"db.js": [
		"export function invalidateMaxDailyDayCache",
		"const spanDays = []",
		'const placeholders = spanDays.map(() => "?").join(", ");',
		'PRAGMA busy_timeout = 5000',
		"PRAGMA temp_store = 2",
		"ON CONFLICT(day, data_source, model, project) DO UPDATE SET",
	],
	"index.js": [
		'import { createIngestRunner } from "./ingest-runner.js";',
		"const INGEST_VIA_WORKER = true;",
		"const INGEST_TIMER_ENABLED = false;",
		"let runner = null;",
		"const runIngestSync = async () =>",
		"const runIngestWorker = async () =>",
		"waitIdle: () => (runner === null ? runIngest() : runner.run()),",
		'ctx.inject(["timer"], (timerCtx) => {',
		"void runner?.dispose();",
	],
	"rpc.js": ['const { ingest, statusProvider, waitIdle } = deps;', 'if (typeof waitIdle === "function") await waitIdle();'],
	"ingest-worker.js": [
		'import { openUsageDb } from "./db.js";',
		'import { foldDshSource } from "./ingest-dsh.js";',
		'import { foldCcSource } from "./ingest-cc.js";',
	],
	"ingest-runner.js": [
		'import { Worker } from "node:worker_threads";',
		'import { invalidateMaxDailyDayCache } from "./db.js";',
		"export function createIngestRunner(options = {})",
	],
};

/** Imported name must be EXPORTED by the file it comes from. */
const IMPORT_CHECKS = [
	{ from: "index.js", specifier: "./ingest-runner.js", names: ["createIngestRunner"] },
	{ from: "ingest-runner.js", specifier: "./db.js", names: ["invalidateMaxDailyDayCache"] },
	{ from: "ingest-worker.js", specifier: "./db.js", names: ["openUsageDb"] },
	{ from: "ingest-worker.js", specifier: "./ingest-dsh.js", names: ["foldDshSource"] },
	{ from: "ingest-worker.js", specifier: "./ingest-cc.js", names: ["foldCcSource"] },
];

/** Must NOT appear in the worker: the host's path resolver would mkdir + touch home. */
const FORBIDDEN = { "ingest-worker.js": ["resolveDbPath"] };

/* ------------------------------------------------------------------ helpers */

let failed = false;
const log = (line) => process.stdout.write(`${line}\n`);

const occurrences = (haystack, needle) => haystack.split(needle).length - 1;
const sha = (text) => createHash("sha256").update(text).digest("hex").slice(0, 16);

function exportedNames(source) {
	const names = new Set();
	for (const match of source.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) names.add(match[1]);
	for (const match of source.matchAll(/^export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) names.add(match[1]);
	for (const match of source.matchAll(/^export\s*\{([^}]*)\}/gm)) {
		for (const part of match[1].split(",")) {
			const name = part.trim().split(/\s+as\s+/).pop()?.trim();
			if (name) names.add(name);
		}
	}
	return names;
}

function escapeRegExp(text) {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function syntaxCheck(fileName, path, source) {
	const checks = [];
	const direct = spawnSync(process.execPath, ["--check", path], { encoding: "utf8" });
	checks.push({ mode: "node --check <file>", ok: direct.status === 0, detail: (direct.stderr || "").trim().split("\n")[0] ?? "" });
	const tmpDir = mkdtempSync(join(HERE, "scratch", "check-"));
	try {
		const mjs = join(tmpDir, `${fileName.replace(/\.js$/, "")}.mjs`);
		writeFileSync(mjs, source);
		const esm = spawnSync(process.execPath, ["--check", mjs], { encoding: "utf8" });
		checks.push({ mode: "node --check <esm .mjs copy>", ok: esm.status === 0, detail: (esm.stderr || "").trim().split("\n")[0] ?? "" });
	} finally {
		rmSync(tmpDir, { recursive: true, force: true });
	}
	// The .mjs copy is the authoritative ESM parse; the direct check is
	// informational (a `.js` file outside a `type: module` package parses as CJS).
	return { checks, ok: checks[1].ok };
}

/* --------------------------------------------------------------------- main */

function main() {
	mkdirSync(join(HERE, "scratch"), { recursive: true });
	mkdirSync(join(HERE, "out"), { recursive: true });
	log(`${MARKER} — anchor patch`);
	log(`  mode    : ${APPLY ? "APPLY (writes)" : "DRY-RUN (validates only; pass --apply to write)"}`);
	log(`  root    : ${ROOT}`);
	log(`  pre-image: ${PRE_IMAGE_DIR}`);
	log("");

	if (!existsSync(ROOT) || !statSync(ROOT).isDirectory()) {
		log(`FATAL: root is not a directory: ${ROOT}`);
		process.exit(2);
	}

	const plan = [
		{ file: "db.js", edits: DB_EDITS },
		{ file: "index.js", edits: INDEX_EDITS },
		{ file: "rpc.js", edits: RPC_EDITS },
		...NEW_FILES.map((file) => ({ file, edits: [], newFile: true })),
	];

	// -------------------------------------------------------------- pass 1
	const records = [];
	for (const item of plan) {
		const target = join(ROOT, item.file);
		const record = { file: item.file, target, edits: [], status: "pending", before: null, after: null, newFile: item.newFile === true };

		if (item.newFile) {
			const source = readFileSync(join(CANDIDATES, item.file), "utf8");
			if (!existsSync(target)) {
				record.status = "create";
				record.after = source;
				record.edits.push({ id: "new-file", what: "create (was absent)", ok: true, detail: "absent" });
			} else {
				const current = readFileSync(target, "utf8");
				record.before = current;
				if (current === source) {
					record.status = "already-present-identical";
					record.after = current;
					record.edits.push({ id: "new-file", what: "create", ok: true, detail: "already present and identical" });
				} else if (REPLACE_NEW) {
					record.status = "replace";
					record.after = source;
					record.edits.push({ id: "new-file", what: "create", ok: true, detail: "--replace-new given" });
				} else {
					record.status = "conflict";
					failed = true;
					record.edits.push({ id: "new-file", what: "create", ok: false, detail: "exists with DIFFERENT content — refusing (pass --replace-new to override)" });
				}
			}
			records.push(record);
			continue;
		}

		if (!existsSync(target)) {
			record.status = "missing-target";
			failed = true;
			record.edits.push({ id: "file", what: "read", ok: false, detail: "target file does not exist" });
			records.push(record);
			continue;
		}
		const original = readFileSync(target, "utf8");
		record.before = original;
		record.beforeSha = sha(original);
		if (original.includes(MARKER)) {
			record.status = "already-patched";
			record.after = original;
			record.edits.push({ id: "patch", what: "idempotency", ok: true, detail: `already contains "${MARKER}"` });
			records.push(record);
			continue;
		}
		let text = original;
		for (const edit of item.edits) {
			const hits = occurrences(text, edit.find);
			const entry = { id: edit.id, what: edit.what, hits, ok: hits === 1, detail: "" };
			if (hits !== 1) {
				entry.detail = `anchor matched ${hits} time(s), expected exactly 1`;
				failed = true;
			} else {
				text = text.replace(edit.find, edit.replace);
				entry.detail = "anchor unique ✓";
			}
			record.edits.push(entry);
		}
		record.after = text;
		record.status = record.edits.every((edit) => edit.ok) ? "patch" : "anchor-failure";
		records.push(record);
	}

	// ------------------------------------------------- declaration/import checks
	const staged = new Map();
	for (const record of records) if (record.after !== null) staged.set(record.file, record.after);
	const readStaged = (file) => staged.get(file) ?? (existsSync(join(ROOT, file)) ? readFileSync(join(ROOT, file), "utf8") : null);

	for (const record of records) {
		for (const needle of REQUIRED_DECLARATIONS[record.file] ?? []) {
			const ok = (record.after ?? "").includes(needle);
			record.edits.push({ id: `decl:${needle.slice(0, 44)}`, what: "introduced identifier is declared in the same file", hits: ok ? 1 : 0, ok, detail: ok ? "present" : "MISSING" });
			if (!ok) failed = true;
		}
		for (const needle of FORBIDDEN[record.file] ?? []) {
			const count = occurrences(record.after ?? "", needle);
			const ok = count === 0;
			record.edits.push({ id: `forbid:${needle}`, what: "identifier must not appear in this file", hits: count, ok, detail: ok ? "absent" : `PRESENT ${count}×` });
			if (!ok) failed = true;
		}
	}

	for (const check of IMPORT_CHECKS) {
		const fromSource = readStaged(check.from);
		const specSource = readStaged(check.specifier.replace(/^\.\//, ""));
		const record = records.find((entry) => entry.file === check.from);
		for (const name of check.names) {
			const importRe = new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*"${escapeRegExp(check.specifier)}"`);
			const imported = fromSource !== null && importRe.test(fromSource);
			const exported = specSource !== null && exportedNames(specSource).has(name);
			const ok = imported && exported;
			record.edits.push({
				id: `import:${check.from}←${check.specifier}:${name}`,
				what: "imported name is exported by its source file",
				hits: ok ? 1 : 0,
				ok,
				detail: !imported ? "no such import" : exported ? "exported ✓" : `NOT EXPORTED by ${check.specifier}`,
			});
			if (!ok) failed = true;
		}
	}

	// ----------------------------------------------------------------- syntax
	for (const record of records) {
		if (record.after === null) continue;
		if (record.status === "already-patched" || record.status === "already-present-identical") {
			record.syntax = syntaxCheck(record.file, join(ROOT, record.file), record.after);
		} else {
			const tmp = join(HERE, "scratch", `syntax-${record.file}`);
			writeFileSync(tmp, record.after);
			record.syntax = syntaxCheck(record.file, tmp, record.after);
		}
		if (!record.syntax.ok) failed = true;
		if (["anchor-failure", "conflict", "missing-target"].includes(record.status)) failed = true;
	}

	// ----------------------------------------------------------------- report
	for (const record of records) {
		log(`── ${record.file}  [${record.status}]  sha(before)=${record.beforeSha ?? "—"} sha(after)=${record.after === null ? "—" : sha(record.after)}`);
		for (const edit of record.edits) log(`   ${edit.ok ? "[ok]  " : "[FAIL]"} ${edit.id} — ${edit.detail}`);
		for (const check of record.syntax?.checks ?? []) log(`   ${check.ok ? "[ok]  " : "[warn]"} ${check.mode}${check.detail ? ` — ${check.detail}` : ""}`);
		log("");
	}

	const summary = {
		mode: APPLY ? "apply" : "dry-run",
		root: ROOT,
		marker: MARKER,
		result: failed ? "FAILED" : APPLY ? "WROTE" : "VALIDATED",
		files: records.map((record) => ({
			file: record.file,
			status: record.status,
			shaBefore: record.beforeSha ?? null,
			shaAfter: record.after === null ? null : sha(record.after),
			edits: record.edits,
			syntax: record.syntax === undefined ? null : record.syntax,
		})),
	};
	writeFileSync(join(HERE, "out", `apply-Ingest-v1-${APPLY ? "apply" : "dryrun"}.json`), JSON.stringify(summary, null, 2));

	if (failed || !APPLY) {
		log(failed ? "RESULT: FAILED — no file written." : "RESULT: VALIDATED (dry-run). Re-run with --apply to write.");
		process.exit(failed ? 1 : 0);
	}

	// ------------------------------------------------------------------ write
	mkdirSync(PRE_IMAGE_DIR, { recursive: true });
	const written = [];
	for (const record of records) {
		if (record.status === "already-patched" || record.status === "already-present-identical") {
			written.push({ file: record.file, action: "skipped", reason: record.status });
			continue;
		}
		const preImage = join(PRE_IMAGE_DIR, record.file);
		if (record.before === null) {
			writeFileSync(join(PRE_IMAGE_DIR, `${record.file}.ABSENT`), "this file did not exist before the Ingest-v1 apply run\n");
		} else if (existsSync(preImage)) {
			// Never clobber the ORIGINAL pre-image of an earlier run.
			writeFileSync(join(PRE_IMAGE_DIR, `${record.file}.${Date.now()}.pre`), record.before);
		} else {
			copyFileSync(record.target, preImage);
		}
		writeFileSync(record.target, record.after);
		written.push({ file: record.file, action: record.status === "patch" ? "patched" : record.status, preImage: record.before === null ? `${record.file}.ABSENT` : record.file });
	}
	writeFileSync(join(PRE_IMAGE_DIR, "manifest.json"), JSON.stringify({ root: ROOT, marker: MARKER, written, summary }, null, 2));
	log("");
	for (const entry of written) log(`WROTE ${entry.file} (${entry.action}) pre-image=${entry.preImage}`);
	log(`pre-image dir: ${PRE_IMAGE_DIR}`);
}

main();
