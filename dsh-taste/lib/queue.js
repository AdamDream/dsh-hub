//#region lib/queue.js
/**
 * Bounded single-concurrency job queue with a failure breaker (audit R2) and a
 * bounded, never-rejecting drain (audit R3).
 *
 * Jobs run one at a time on a promise chain (`chain = chain.then(runJob)`),
 * so a learner turn never overlaps another. Run failures are counted; the
 * breaker arms a cooldown after `failLimit` consecutive failures and pushes
 * are dropped while cooling. `stats()` exposes the breaker state for
 * `/taste status`.
 * @module lib/queue
 */

/** Queued-job ceiling; the oldest job is dropped once it is exceeded (R2). */
const DEFAULT_CAP = 3;

/** Consecutive failures that arm the breaker (R2). */
const DEFAULT_FAIL_LIMIT = 3;

/** How long the breaker stays open once armed (R2). */
const DEFAULT_COOLDOWN_MS = 10 * 60_000;

/** Longest `drain()` waits for the queue to empty before giving up (R3). */
const DRAIN_TIMEOUT_MS = 30_000;

/** Flatten any thrown value into one message line. */
function describeError(error) {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Create one taste job queue.
 * @param {object} [options] - queue tuning.
 * @param {number} [options.cap=3] - queued-job ceiling; the oldest job is
 *   dropped to keep the newest (R2).
 * @param {(job: unknown) => Promise<void>} options.runJob - one job's work;
 *   rejections feed the breaker and are logged, never propagated.
 * @param {(message: string) => void} [options.log] - diagnostic sink.
 * @param {number} [options.failLimit=3] - consecutive failures arming the breaker.
 * @param {number} [options.cooldownMs=600000] - breaker cooldown length.
 * @param {number} [options.drainTimeoutMs=30000] - `drain()` patience (R3).
 * @returns {{push(job: unknown): boolean, drain(): Promise<void>, stats(): {pending: number, failCount: number, cooldownUntil: number, running: boolean}}} the queue.
 */
export function createJobQueue({
	cap = DEFAULT_CAP,
	runJob,
	log,
	failLimit = DEFAULT_FAIL_LIMIT,
	cooldownMs = DEFAULT_COOLDOWN_MS,
	drainTimeoutMs = DRAIN_TIMEOUT_MS,
} = {}) {
	if (typeof runJob !== "function") throw new TypeError("createJobQueue: runJob must be a function");
	const limit = Math.max(1, Math.floor(Number(cap)) || DEFAULT_CAP);
	const budget = Math.max(0, Number(failLimit) || DEFAULT_FAIL_LIMIT);
	const cooldown = Math.max(0, Number(cooldownMs) || DEFAULT_COOLDOWN_MS);
	const drainBudget = Math.max(0, Number(drainTimeoutMs) || DRAIN_TIMEOUT_MS);
	const warn = (message) => {
		try {
			if (typeof log === "function") log(message);
		} catch {
			// A throwing sink must never break queue bookkeeping.
		}
	};
	/** Jobs accepted but not yet started, oldest first. */
	const pending = [];
	/** Tail of the single-concurrency execution chain; every link catches. */
	let chain = Promise.resolve();
	let running = false;
	let failCount = 0;
	let cooldownUntil = 0;

	const cooling = () => cooldownUntil > Date.now();

	/** Start the next queued job unless one is already on the chain. */
	function schedule() {
		if (running || pending.length === 0) return;
		const job = pending.shift();
		running = true;
		chain = chain
			.then(async () => {
				try {
					await runJob(job);
					failCount = 0;
				} catch (error) {
					failCount += 1;
					if (failCount >= budget) cooldownUntil = Date.now() + cooldown;
					warn(`taste queue: job failed (${failCount}/${budget}): ${describeError(error)}`);
				}
			})
			.catch((error) => warn(`taste queue: job bookkeeping failed: ${describeError(error)}`))
			.then(() => {
				running = false;
				schedule();
			});
	}

	/**
	 * Enqueue one job, dropping the oldest when the queue is at capacity (R2)
	 * and dropping the job entirely while the breaker is cooling.
	 * @param {unknown} job - payload handed to `runJob`.
	 * @returns {boolean} whether the job was accepted.
	 */
	function push(job) {
		if (cooling()) {
			warn("taste queue: breaker cooling down; job dropped");
			return false;
		}
		pending.push(job);
		while (pending.length > limit) pending.shift();
		schedule();
		return true;
	}

	/**
	 * Wait until the queue is empty and no job is running, for at most
	 * `drainTimeoutMs`. The timeout losing the race — like every other
	 * failure — resolves instead of rejecting (R3).
	 * @returns {Promise<void>} resolves when drained or when the budget expires.
	 */
	async function drain() {
		const deadline = Date.now() + drainBudget;
		try {
			while ((running || pending.length > 0) && Date.now() < deadline) {
				const current = chain;
				let timer;
				const timeout = new Promise((resolve) => {
					timer = setTimeout(resolve, Math.max(0, deadline - Date.now()));
				});
				try {
					await Promise.race([current, timeout]);
				} finally {
					clearTimeout(timer);
				}
			}
		} catch {
			// Drain reports by returning; it never rejects (R3).
		}
	}

	/**
	 * Snapshot of the queue and breaker state for `/taste status`.
	 * @returns {{pending: number, failCount: number, cooldownUntil: number, running: boolean}} state.
	 */
	function stats() {
		return { pending: pending.length, failCount, cooldownUntil, running };
	}

	return { push, drain, stats };
}
//#endregion
