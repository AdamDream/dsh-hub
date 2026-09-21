// Shared helpers for the Ingest-v1 acceptance suite.
//
// PURELY OFFLINE: every artefact is written under
// `.workspace/lag-fix/exec-ingest/scratch/`. The real `~/.dsh/sessions` and
// `~/.claude/projects` roots are only touched when a test explicitly asks for
// them (G1 only), then always read-only. The real `usage.db` is never opened.

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

export const HERE = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
export const SCRATCH = join(HERE, "scratch");
export const OUT = join(HERE, "out");
export const STAGE = join(HERE, "stage");
export const LIB_ORIG = join(STAGE, "lib-orig");
export const LIB_CAND = join(STAGE, "lib-cand");
export const EQUIV_FIXTURE_MODULE = join(
	HERE,
	"..",
	"research-v2",
	"ingest-equiv",
	"harness",
	"fixture.mjs",
);

export const silentLog = { info: () => {}, warn: () => {} };

export function freshDir(dir) {
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
	return dir;
}

export function writeJson(name, value) {
	mkdirSync(OUT, { recursive: true });
	const path = join(OUT, name);
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
	return path;
}

/** Import one lib directory (a copy of the plugin's `lib/`) by absolute path. */
export async function loadLib(libDir) {
	const load = (file) => import(pathToFileURL(join(libDir, file)).href);
	return {
		dir: libDir,
		db: await load("db.js"),
		ingestDsh: await load("ingest-dsh.js"),
		ingestCc: await load("ingest-cc.js"),
		// optional: the untouched deployed copy has no ingest-runner.js yet
		runner: await load("ingest-runner.js").catch(() => null),
	};
}

/** A runner bound to one lib directory (its worker resolves from the same dir). */
export async function makeRunner(libDir, options) {
	const { createIngestRunner } = await import(pathToFileURL(join(libDir, "ingest-runner.js")).href);
	return createIngestRunner({ log: silentLog, ...options });
}

/** Open a lib's own connection (schema ensured) and seed the fixture state. */
export async function seedDatabase(libDir, dbPath, seed) {
	mkdirSync(dirname(dbPath), { recursive: true });
	const lib = await loadLib(libDir);
	const db = await lib.db.openUsageDb(dbPath);
	if (typeof seed === "function") seed(db);
	return db;
}

/** Read the final state through a BRAND NEW read-only connection. */
export function readSnapshot(dbPath, normalize = (value) => value) {
	const db = new DatabaseSync(dbPath, { readOnly: true });
	try {
		const events = db
			.prepare(
				`SELECT data_source, session_id, dedup_key, ts, model, provider, project, turn, step, is_subagent,
				        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens
				 FROM usage_events
				 ORDER BY data_source, session_id, dedup_key`,
			)
			.all();
		const daily = db
			.prepare(
				`SELECT day, data_source, model, project, requests, input_tokens, output_tokens,
				        cache_read_tokens, cache_write_tokens
				 FROM usage_daily
				 ORDER BY day, data_source, model, project`,
			)
			.all();
		const sync = db.prepare("SELECT source, mtime, size, fingerprint, last_seq, last_offset FROM sync_state ORDER BY source").all();
		return {
			usage_events: JSON.parse(JSON.stringify(normalize(events))),
			usage_daily: JSON.parse(JSON.stringify(normalize(daily))),
			sync_state: JSON.parse(JSON.stringify(normalize(sync))),
			counts: { events: events.length, daily: daily.length, sync: sync.length },
		};
	} finally {
		db.close();
	}
}

/** Run one synchronous (host-thread) pass, exactly as lib/index.js used to. */
export function runSyncPass(lib, db, dshRoot, ccRoot) {
	const dsh = lib.ingestDsh.foldDshSource(db, dshRoot, {});
	const cc = lib.ingestCc.foldCcSource(db, ccRoot, {});
	return { dsh, cc };
}

/** Deep, order-preserving, path-normalized equality. */
export function diffFaces(left, right, path = "", out = []) {
	if (left === right) return out;
	const bothObjects = left !== null && right !== null && typeof left === "object" && typeof right === "object";
	if (!bothObjects) {
		if (JSON.stringify(left) !== JSON.stringify(right)) out.push({ path, left, right });
		return out;
	}
	const keysLeft = Object.keys(left);
	const keysRight = Object.keys(right);
	for (const key of new Set([...keysLeft, ...keysRight])) {
		if (!keysLeft.includes(key) || !keysRight.includes(key)) {
			out.push({ path: `${path}.${key}`, left: left[key], right: right[key] });
			continue;
		}
		diffFaces(left[key], right[key], `${path}.${key}`, out);
	}
	return out;
}

/** Replace absolute fixture roots so two independent roots compare equal. */
export function rootNormalizer(...roots) {
	return (value) => {
		const text = JSON.stringify(value);
		let normalized = text;
		for (const root of roots) normalized = normalized.split(root).join("<ROOT>");
		return JSON.parse(normalized);
	};
}

/** Copy a lib directory into a scratch variant (for counterfactual runs). */
export function variantLib(name, transform, fromDir = LIB_CAND) {
	const dir = join(SCRATCH, `lib-${name}`);
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
	cpSync(fromDir, dir, { recursive: true });
	for (const file of ["db.js", "index.js", "ingest-runner.js", "ingest-worker.js"]) {
		const path = join(dir, file);
		if (!existsSync(path)) continue;
		const original = readFileSync(path, "utf8");
		const edited = transform(file, original);
		if (edited !== original) writeFileSync(path, edited);
	}
	return dir;
}

export function assertionTable(rows) {
	let failed = 0;
	const lines = [];
	for (const row of rows) {
		if (!row.ok) failed += 1;
		lines.push(`${row.ok ? "PASS" : "FAIL"}  ${row.id} — ${row.detail}`);
	}
	return { failed, text: lines.join("\n") };
}

/**
 * A4 instrumentation (variant copies only): record the DELETE day set and the
 * day set the INSERT's GROUP BY actually produces for the same ts range, so
 * "produced ⊆ deleted" can be asserted directly instead of inferred.
 */
export const IG3_PROBE_ANCHOR = '\t\tdb.exec("COMMIT");\n\t} catch (error) {\n\t\tdb.exec("ROLLBACK");\n\t\tthrow error;\n\t}\n';

export function injectIg3Probe(file, source) {
	if (file !== "db.js") return source;
	if (!source.includes(IG3_PROBE_ANCHOR)) throw new Error("ig3 probe anchor missing in db.js");
	const probe =
		"\t\t/* A4 instrumentation (test variant copy only). */\n" +
		"\t\ttry {\n" +
		'\t\t\tdb.exec("CREATE TABLE IF NOT EXISTS __ig3_probe (id INTEGER PRIMARY KEY AUTOINCREMENT, deleted TEXT NOT NULL, produced TEXT NOT NULL)");\n' +
		"\t\t\tconst producedProbe = db.prepare(\"SELECT DISTINCT strftime('%Y-%m-%d', ts / 1000, 'unixepoch', 'localtime') AS day FROM usage_events WHERE ts >= ? AND ts < ? ORDER BY day\").all(lo, hiExclusive).map((row) => row.day);\n" +
		'\t\t\tdb.prepare("INSERT INTO __ig3_probe (deleted, produced) VALUES (?, ?)").run(JSON.stringify(typeof spanDays === "undefined" ? days : spanDays), JSON.stringify(producedProbe));\n' +
		"\t\t} catch {\n" +
		"\t\t\t/* probe only */\n" +
		"\t\t}\n" +
		IG3_PROBE_ANCHOR;
	return source.replace(IG3_PROBE_ANCHOR, probe);
}

/** Read the A4 probe rows (empty when the variant never reached a COMMIT). */
export function readIg3Probe(db) {
	try {
		const rows = db.prepare("SELECT deleted, produced FROM __ig3_probe ORDER BY id").all();
		return rows.map((row) => ({ deleted: JSON.parse(row.deleted), produced: JSON.parse(row.produced) }));
	} catch {
		return [];
	}
}
