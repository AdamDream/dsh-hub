//#region lib/ingest-worker.js
/**
 * dsh-usage ingest worker (dsh-perf-fix Ingest-v1, audit U-IG1.1).
 *
 * WHY THIS FILE EXISTS
 * `foldDshSource` / `foldCcSource` are fully synchronous (every fs read, every
 * zstd frame decode, every `JSON.parse`, every SQLite call). Run from the host
 * fiber (lib/index.js `runIngest`) they occupy the host event loop for the whole
 * pass — measured 2.682 s incremental / 36.1 s cold — which is what freezes the
 * GUI. This worker runs the SAME two fold functions on its own thread, so the
 * host event loop only ever sees short message deliveries.
 *
 * NOTHING ABOUT THE FOLD CHANGES HERE: same modules, same call order, same
 * arguments as `lib/index.js` used to use. The worker is a transport, not a
 * reimplementation. That is why the equivalence suite
 * (tests/equiv/run-worker-equiv.mjs) is expected to be byte-identical.
 *
 * HARD CONSTRAINTS (each one is enforced by a test or a static check)
 *   1. The database path is ALWAYS supplied by the host in the `start` message.
 *      The worker must NEVER resolve the path itself: the host's resolver
 *      creates directories and touches the real user home, which is exactly
 *      what a worker must not do as a side effect of an ingest pass.
 *   2. The worker must NOT create the schema: the host opened + migrated the
 *      database before the first `start` (`openUsageDb` + `ensureSchema`).
 *      `openUsageDb` is reused only because it carries the connection pragmas
 *      (WAL + busy_timeout + temp_store); it is idempotent.
 *   3. ONE connection per worker lifetime, reused across passes (see
 *      `openOnce`). Opening per pass would re-pay the WAL/pragma cost and
 *      widen the window where two connections exist.
 *   4. Only JSON-serializable values cross `postMessage`. No `DatabaseSync`
 *      handle, no statement, no Buffer (`DatabaseSync` cannot be cloned at all
 *      — measured `DataCloneError`), and `failedFiles[].file` is stringified
 *      because the DSH fold records URL-ish values.
 *
 * Protocol (all values plain JSON):
 *   in : { type:'start', id:<int>, dbPath:<abs string>, dshRoot?:<abs>, ccRoot?:<abs> }
 *   out: { type:'progress', id, phase:'dsh'|'cc', scanned, newEvents }
 *        { type:'done', id, dsh:{scanned,newEvents,failedFiles}, cc:{...}, wallMs }
 *        { type:'failed', id, message, stack? }
 * @module dsh-usage/ingest-worker
 */

import { parentPort } from "node:worker_threads";
import { openUsageDb } from "./db.js";
import { foldDshSource } from "./ingest-dsh.js";
import { foldCcSource } from "./ingest-cc.js";

/** Minimum spacing between two `progress` messages of one phase. */
const PROGRESS_MIN_INTERVAL_MS = 200;
/** …or every N newly inserted events, whichever comes first. */
const PROGRESS_EVENT_STEP = 100;

/** Worker-lifetime connection (constraint 3). */
let connection = null;
/** Path the current `connection` was opened with. */
let connectionPath = null;
/** Set while a `start` is being served — a second concurrent `start` is refused. */
let busy = false;

/** Human-readable, never-throwing description of an arbitrary value. */
function toText(value) {
	if (typeof value === "string") return value;
	try {
		return String(value);
	} catch {
		return "(unprintable)";
	}
}

/** Strip a fold result down to the JSON-safe wire shape (constraint 4). */
function packResult(result) {
	const failed = Array.isArray(result?.failedFiles) ? result.failedFiles : [];
	return {
		scanned: Number(result?.scanned ?? 0),
		newEvents: Number(result?.newEvents ?? 0),
		failedFiles: failed.map((entry) => ({
			file: toText(entry?.file ?? ""),
			error: toText(entry?.error ?? ""),
		})),
	};
}

function post(message) {
	try {
		parentPort?.postMessage(message);
	} catch (error) {
		// A closed port during teardown is expected; never throw into the fold.
		void error;
	}
}

/**
 * Open (or reuse) this worker's own connection to the host-supplied path.
 * @param {string} path - absolute DB path from the host (constraint 1).
 */
async function openOnce(path) {
	if (connection !== null && connectionPath === path) return connection;
	if (connection !== null) {
		try {
			connection.close();
		} catch {
			// best effort
		}
		connection = null;
		connectionPath = null;
	}
	const opened = await openUsageDb(path);
	connection = opened;
	connectionPath = path;
	return opened;
}

/**
 * Per-phase progress emitter with the audit's throttle (>=200 ms apart, or
 * every 100 new events). The phase boundary emits immediately so a
 * restart-sensitive watchdog sees the phase flip.
 */
function makeProgressEmitter(id, phase) {
	let lastAt = 0;
	let lastEvents = 0;
	return ({ scanned, newEvents }) => {
		const now = Date.now();
		if (now - lastAt >= PROGRESS_MIN_INTERVAL_MS || newEvents - lastEvents >= PROGRESS_EVENT_STEP) {
			lastAt = now;
			lastEvents = newEvents;
			post({ type: "progress", id, phase, scanned, newEvents });
		}
	};
}

/** Serve one `start`: both folds, in the exact order lib/index.js used. */
async function handleStart(message) {
	const id = message.id;
	const startedAt = Date.now();
	const path = message.dbPath;
	if (typeof path !== "string" || path.length === 0) {
		post({ type: "failed", id, message: "ingest worker: start without a dbPath (the host must supply it)" });
		return;
	}
	const db = await openOnce(path);
	// Phase boundary: an immediate progress resets the host's stall watchdog.
	post({ type: "progress", id, phase: "dsh", scanned: 0, newEvents: 0 });
	const dshResult = foldDshSource(db, message.dshRoot ?? undefined, {
		onProgress: makeProgressEmitter(id, "dsh"),
	});
	post({ type: "progress", id, phase: "cc", scanned: 0, newEvents: 0 });
	const ccResult = foldCcSource(db, message.ccRoot ?? undefined, {
		onProgress: makeProgressEmitter(id, "cc"),
	});
	post({
		type: "done",
		id,
		dsh: packResult(dshResult),
		cc: packResult(ccResult),
		wallMs: Date.now() - startedAt,
	});
}

parentPort?.on("message", (message) => {
	if (!message || typeof message !== "object" || message.type !== "start") return;
	const id = message.id;
	if (busy) {
		// The host runner is single-flight; reaching this means a bug there.
		post({ type: "failed", id, message: "ingest worker: refused a start while a pass is already running" });
		return;
	}
	busy = true;
	void handleStart(message)
		.catch((error) => {
			post({
				type: "failed",
				id,
				message: error instanceof Error ? error.message : toText(error),
				stack: error instanceof Error ? error.stack : undefined,
			});
		})
		.finally(() => {
			busy = false;
		});
});
//#endregion
