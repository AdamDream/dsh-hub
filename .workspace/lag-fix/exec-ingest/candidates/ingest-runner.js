//#region lib/ingest-runner.js
/**
 * Host-side lifecycle + single-flight for the dsh-usage ingest worker
 * (dsh-perf-fix Ingest-v1, audit U-IG1.2).
 *
 * Responsibilities
 *   - own the worker thread (lazy spawn, rebuild after a crash, terminate on
 *     dispose) so the host never leaks a thread across plugin reloads;
 *   - SINGLE-FLIGHT: concurrent `run()` callers share ONE promise, therefore
 *     ONE fold. Without this, `client.js` polling `/usage/refresh` while a
 *     manual refresh is in flight would stack whole passes (each re-reading
 *     ~871 session files);
 *   - STALL WATCHDOG instead of a total-duration timeout: a cold ingest takes
 *     36.1 s TODAY and grows with the corpus, so a wall-clock cap would kill
 *     healthy passes. A pass only counts as dead when no `progress` message
 *     arrived for `stallMs` (default 120 s). On stall the worker is terminated
 *     and DROPPED (rebuilt on the next `run()`); the stalled pass is NOT
 *     retried — two concurrent folds on one database is worse than a stale one.
 *     `hardTimeoutMs` (default 15 min) exists only as a last-resort safety net
 *     against a watchdog that can never fire.
 *   - HOST-SIDE CACHE CLEANUP: `worker`-thread module state does not cross
 *     threads, so the worker's own `invalidateMaxDailyDayCache()` cannot clear
 *     the host's `MAX(day)` gate cache (measured). `run()` therefore calls the
 *     host's copy on EVERY settle path — success, failure, stall, timeout,
 *     dispose. See `invalidate` below.
 *
 * Result contract — `run()` never rejects:
 *   { ok:true,  dsh:{scanned,newEvents,failedFiles}, cc:{...}, wallMs }
 *   { ok:false, reason:'stalled'|'timeout'|'worker-error'|'worker-exit'|'disposed'|'internal', message? }
 *
 * @module dsh-usage/ingest-runner
 */

import { Worker } from "node:worker_threads";
import { invalidateMaxDailyDayCache } from "./db.js";

/** No `progress` for this long ⇒ the pass is considered dead (audit U-IG1.2). */
const DEFAULT_STALL_MS = 120_000;
/** Last-resort net only; NOT the primary liveness signal (see module doc). */
const DEFAULT_HARD_TIMEOUT_MS = 900_000;
/** Watchdog sampling period. */
const DEFAULT_WATCHDOG_TICK_MS = 5_000;

const NOOP_LOG = { warn: () => {}, info: () => {} };

/**
 * @param {object} options
 * @param {string} options.dbPath - absolute DB path, resolved by the HOST. The
 *   worker never resolves it itself (see lib/ingest-worker.js constraint 1).
 * @param {{warn?:Function,info?:Function}} [options.log]
 * @param {URL|string} [options.workerUrl] - worker entry (test seam).
 * @param {string} [options.dshRoot] - dsh source root (default: module default).
 * @param {string} [options.ccRoot] - cc source root (default: module default).
 * @param {number} [options.stallMs]
 * @param {number} [options.hardTimeoutMs]
 * @param {number} [options.watchdogTickMs]
 * @param {(info:{phase:"dsh"|"cc",scanned:number,newEvents:number})=>void} [options.onProgress]
 * @param {()=>void} [options.invalidate] - host cache-cleanup seam (defaults to
 *   the real `invalidateMaxDailyDayCache`; injectable so a test can count calls).
 * @returns {{run:()=>Promise<object>, dispose:()=>Promise<void>, stats:()=>(object)}}
 */
export function createIngestRunner(options = {}) {
	const {
		dbPath,
		log = NOOP_LOG,
		workerUrl = new URL("./ingest-worker.js", import.meta.url),
		dshRoot,
		ccRoot,
		stallMs = DEFAULT_STALL_MS,
		hardTimeoutMs = DEFAULT_HARD_TIMEOUT_MS,
		watchdogTickMs = DEFAULT_WATCHDOG_TICK_MS,
		onProgress,
		invalidate = invalidateMaxDailyDayCache,
	} = options ?? {};

	/** Current worker instance (null = must be spawned on the next run). */
	let worker = null;
	/** Monotonic request id; a message is only accepted when it matches. */
	let nextId = 1;
	/** The single in-flight promise (single-flight). */
	let inFlight = null;
	/** Bookkeeping for the request currently being served. */
	let pending = null;
	/** Set by dispose(): no new pass may start afterwards. */
	let disposed = false;

	const counters = { runs: 0, ok: 0, failed: 0, stalls: 0, timeouts: 0, workerSpawns: 0, invalidations: 0 };

	/** Host-side cache cleanup — must run on every settle path. */
	function invalidateHostCache() {
		counters.invalidations += 1;
		try {
			invalidate();
		} catch (error) {
			log.warn(`ingest runner: cache invalidation failed: ${describe(error)}`);
		}
	}

	function describe(error) {
		return error instanceof Error ? error.message : String(error);
	}

	/** Drop every timer of the pending request (idempotent). */
	function clearPendingTimers(entry) {
		if (entry === null) return;
		if (entry.watchdog !== null) clearTimeout(entry.watchdog);
		if (entry.hardTimer !== null) clearTimeout(entry.hardTimer);
		entry.watchdog = null;
		entry.hardTimer = null;
	}

	/**
	 * Settle the pending request exactly once (`entry.settled` is set before the
	 * resolver runs, so a late `exit`/`error` from a worker we already abandoned
	 * — stall/timeout/dispose — cannot settle the same request twice).
	 */
	function settle(entry, result) {
		if (entry === null || entry.settled) return;
		entry.settled = true;
		clearPendingTimers(entry);
		if (pending === entry) pending = null;
		if (result.ok) counters.ok += 1;
		else counters.failed += 1;
		entry.resolve(result);
	}

	/** Tear down a worker instance without touching the pending bookkeeping. */
	function dropWorker(target) {
		if (target !== null && target === worker) worker = null;
		try {
			void target?.terminate();
		} catch {
			// best effort
		}
	}

	function ensureWorker() {
		if (worker !== null) return worker;
		const spawned = new Worker(workerUrl, { type: "module" });
		counters.workerSpawns += 1;
		spawned.on("message", (message) => onMessage(spawned, message));
		spawned.on("error", (error) => {
			if (pending !== null && pending.worker === spawned) {
				settle(pending, { ok: false, reason: "worker-error", message: describe(error) });
			}
			dropWorker(spawned);
		});
		spawned.on("exit", (code) => {
			if (pending !== null && pending.worker === spawned) {
				settle(pending, { ok: false, reason: "worker-exit", message: `worker exited with code ${code}` });
			}
			dropWorker(spawned);
		});
		worker = spawned;
		return spawned;
	}

	function onMessage(source, message) {
		if (!message || typeof message !== "object") return;
		const entry = pending;
		// Stale-worker guard: only the request we are waiting for is accepted.
		if (entry === null || entry.worker !== source || message.id !== entry.id) return;
		if (message.type === "progress") {
			entry.lastProgressAt = Date.now();
			try {
				onProgress?.({ phase: message.phase, scanned: Number(message.scanned ?? 0), newEvents: Number(message.newEvents ?? 0) });
			} catch (error) {
				log.warn(`ingest runner: onProgress threw: ${describe(error)}`);
			}
			return;
		}
		if (message.type === "done") {
			settle(
				entry,
				{
					ok: true,
					dsh: message.dsh ?? { scanned: 0, newEvents: 0, failedFiles: [] },
					cc: message.cc ?? { scanned: 0, newEvents: 0, failedFiles: [] },
					wallMs: Number(message.wallMs ?? 0),
				},
			);
			return;
		}
		if (message.type === "failed") {
			settle(entry, { ok: false, reason: "worker-error", message: message.message ?? "worker reported failure" });
		}
	}

	/**
	 * Stall watchdog: fires only when no `progress` arrived for `stallMs`.
	 * The stalled worker is terminated and dropped (rebuilt by the next run);
	 * the pass is NOT retried.
	 */
	function armWatchdog(entry) {
		entry.watchdog = setTimeout(() => {
			if (entry.settled) return;
			if (Date.now() - entry.lastProgressAt < stallMs) {
				armWatchdog(entry);
				return;
			}
			counters.stalls += 1;
			log.warn(`ingest runner: no progress for ${stallMs}ms — terminating the worker (no retry)`);
			dropWorker(entry.worker);
			settle(entry, { ok: false, reason: "stalled", message: `no progress for ${stallMs}ms` });
		}, Math.max(1, Math.min(watchdogTickMs, stallMs)));
		entry.watchdog.unref?.();
	}

	function send(entry, target) {
		try {
			target.postMessage({
				type: "start",
				id: entry.id,
				dbPath,
				dshRoot,
				ccRoot,
			});
		} catch (error) {
			settle(entry, { ok: false, reason: "worker-error", message: describe(error) });
		}
	}

	async function start() {
		try {
			if (disposed) return { ok: false, reason: "disposed" };
			if (typeof dbPath !== "string" || dbPath.length === 0) {
				return { ok: false, reason: "internal", message: "ingest runner: no dbPath" };
			}
			const target = ensureWorker();
			const id = nextId++;
			counters.runs += 1;
			const entry = {
				id,
				worker: target,
				resolve: null,
				settled: false,
				lastProgressAt: Date.now(),
				watchdog: null,
				hardTimer: null,
			};
			const result = await new Promise((resolve) => {
				entry.resolve = resolve;
				pending = entry;
				armWatchdog(entry);
				entry.hardTimer = setTimeout(() => {
					if (entry.settled) return;
					counters.timeouts += 1;
					log.warn(`ingest runner: hard timeout after ${hardTimeoutMs}ms — terminating the worker (no retry)`);
					dropWorker(entry.worker);
					settle(entry, { ok: false, reason: "timeout", message: `hard timeout after ${hardTimeoutMs}ms` });
				}, hardTimeoutMs);
				entry.hardTimer.unref?.();
				send(entry, target);
			});
			return result;
		} catch (error) {
			return { ok: false, reason: "internal", message: describe(error) };
		} finally {
			/* Host-side cleanup point (audit U-IG1.3): the worker's own
			   invalidate cannot cross threads, so the host must do it here — and
			   `finally` is what makes the FAILURE paths covered too. */
			invalidateHostCache();
		}
	}

	/** Single-flight: every concurrent caller receives the SAME promise. */
	function run() {
		if (inFlight !== null) return inFlight;
		const promise = start().finally(() => {
			if (inFlight === promise) inFlight = null;
		});
		inFlight = promise;
		return promise;
	}

	/** Terminate the worker and settle any in-flight request. Never hangs. */
	async function dispose() {
		disposed = true;
		const entry = pending;
		const target = worker;
		worker = null;
		if (entry !== null) {
			settle(entry, { ok: false, reason: "disposed", message: "ingest runner disposed" });
		}
		if (target !== null) {
			try {
				await target.terminate();
			} catch {
				// best effort
			}
		}
		// Let an already-settled `run()` finish its `finally` before returning.
		try {
			await inFlight;
		} catch {
			// run() never rejects; defensive only
		}
	}

	/** Introspection for tests/acceptance gates (G2/G4). */
	function stats() {
		return {
			...counters,
			workerAlive: worker !== null,
			workerThreadId: worker === null ? -1 : worker.threadId,
			pendingId: pending === null ? null : pending.id,
			inFlight: inFlight !== null,
			disposed,
			stallMs,
			hardTimeoutMs,
		};
	}

	return { run, dispose, stats };
}
//#endregion
