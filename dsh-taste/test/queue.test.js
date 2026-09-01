import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createJobQueue } from "../lib/queue.js";

/** One controllable promise. */
function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

/** Yield long enough for scheduled chain links to start. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("createJobQueue", () => {
	it("runs jobs one at a time in push order", async () => {
		const started = [];
		const gates = [deferred(), deferred()];
		let index = 0;
		const queue = createJobQueue({
			runJob: (job) => {
				started.push(job);
				return index < gates.length ? gates[index++].promise : Promise.resolve();
			},
		});
		queue.push("a");
		queue.push("b");
		await tick();
		assert.deepEqual(started, ["a"]);
		gates[0].resolve();
		await tick();
		assert.deepEqual(started, ["a", "b"]);
		gates[1].resolve();
		await queue.drain();
		assert.equal(queue.stats().running, false);
		assert.equal(queue.stats().pending, 0);
	});

	it("drops the oldest job when the queue reaches cap, keeping the newest (R2)", async () => {
		const ran = [];
		const gate = deferred();
		let first = true;
		const queue = createJobQueue({
			cap: 2,
			runJob: (job) => {
				ran.push(job);
				if (first) {
					first = false;
					return gate.promise; // hold the only worker so nothing else starts
				}
				return Promise.resolve();
			},
		});
		queue.push("hold"); // occupies the single concurrency slot
		await tick();
		queue.push("old");
		queue.push("kept");
		queue.push("newest"); // exceeds cap=2: "old" is evicted, the two newest are kept
		await tick();
		assert.equal(queue.stats().pending, 2);
		assert.deepEqual(ran, ["hold"]);
		gate.resolve();
		await queue.drain();
		assert.deepEqual(ran, ["hold", "kept", "newest"]); // "old" never ran
	});

	it("arms a cooldown after three consecutive failures and drops pushes while cooling (R2)", async () => {
		let calls = 0;
		const logs = [];
		const queue = createJobQueue({
			runJob: () => {
				calls += 1;
				return Promise.reject(new Error(`boom ${calls}`));
			},
			log: (message) => logs.push(message),
		});
		queue.push(1);
		queue.push(2);
		queue.push(3);
		await queue.drain();
		const stats = queue.stats();
		assert.equal(stats.failCount, 3);
		assert.ok(stats.cooldownUntil > Date.now());
		// While cooling, pushes are dropped outright.
		assert.equal(queue.push(4), false);
		assert.equal(queue.stats().pending, 0);
		await tick();
		assert.equal(calls, 3);
		assert.ok(logs.some((message) => message.includes("cooling down")));
		// Every failure also re-arms the cooldown while the breaker is open.
		assert.ok(stats.cooldownUntil <= Date.now() + 10 * 60_000 + 5_000);
	});

	it("resets the failure count on success before the breaker arms", async () => {
		let calls = 0;
		const queue = createJobQueue({
			runJob: () => {
				calls += 1;
				return calls <= 2 ? Promise.reject(new Error("transient")) : Promise.resolve();
			},
		});
		queue.push(1);
		queue.push(2);
		await queue.drain();
		assert.equal(queue.stats().failCount, 2);
		assert.equal(queue.stats().cooldownUntil, 0); // two failures do not arm the breaker
		queue.push(3);
		await queue.drain();
		assert.equal(queue.stats().failCount, 0);
		assert.equal(queue.stats().cooldownUntil, 0);
		// Jobs pushed while a cooldown is inactive run normally again.
		assert.equal(queue.push(4), true);
		await queue.drain();
		assert.equal(calls, 4);
	});

	it("accepts pushes again once the cooldown has expired", async () => {
		let calls = 0;
		const queue = createJobQueue({
			failLimit: 1,
			cooldownMs: 20,
			runJob: () => {
				calls += 1;
				return Promise.reject(new Error("always failing"));
			},
		});
		queue.push("trip");
		await queue.drain();
		assert.equal(queue.stats().failCount, 1);
		assert.ok(queue.stats().cooldownUntil > Date.now());
		assert.equal(queue.push("during"), false);
		await new Promise((resolve) => setTimeout(resolve, 40)); // cooldown expires
		assert.equal(queue.push("after"), true);
		await queue.drain();
		assert.equal(calls, 2);
	});

	it("drain() never rejects — including the timeout losing branch (R3)", async () => {
		const gate = deferred();
		const queue = createJobQueue({
			runJob: () => Promise.reject(new Error("failing job")),
		});
		// Failing jobs do not make drain reject.
		queue.push("fails");
		await queue.drain();
		// A hung job hits the drain budget and resolves anyway.
		const hung = createJobQueue({ runJob: () => gate.promise, drainTimeoutMs: 20 });
		hung.push("hangs");
		const start = Date.now();
		await hung.drain(); // must resolve, not reject, within ~20ms
		assert.ok(Date.now() - start < 5_000);
		// An empty queue drains immediately.
		const idle = createJobQueue({ runJob: () => Promise.resolve() });
		await idle.drain();
		gate.resolve();
	});

	it("reports stats with pending, failCount, cooldownUntil and running", async () => {
		const gate = deferred();
		const queue = createJobQueue({ runJob: () => gate.promise });
		assert.deepEqual(queue.stats(), { pending: 0, failCount: 0, cooldownUntil: 0, running: false });
		queue.push("one");
		queue.push("two");
		await tick();
		const stats = queue.stats();
		assert.equal(stats.pending, 1);
		assert.equal(stats.running, true);
		gate.resolve();
		await queue.drain();
		assert.deepEqual(queue.stats(), { pending: 0, failCount: 0, cooldownUntil: 0, running: false });
	});
});
