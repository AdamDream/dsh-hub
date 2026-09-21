// Test-only fault-injecting worker shim for the runner's lifecycle acceptance
// (audit U-IG1.2 验收 ②③): crash-once (worker exit → rebuild on the next run),
// stall-once / stall-always (no `progress` at all → the stall watchdog must
// terminate and rebuild, never retry).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parentPort } from "node:worker_threads";
import { pathToFileURL } from "node:url";

const COUNTER = process.env.INGEST_FAULT_COUNTER;
const MODE = process.env.INGEST_FAULT_MODE;
const REAL = process.env.INGEST_FAULT_REAL_WORKER;

/** Per worker INSTANCE index (1 = first spawned worker of this run). */
const instance = (() => {
	const previous = existsSync(COUNTER) ? Number(readFileSync(COUNTER, "utf8")) : 0;
	const next = previous + 1;
	writeFileSync(COUNTER, String(next));
	return next;
})();

const swallow = () => {
	parentPort.on("message", () => {
		/* never reply: the pass must look stalled to the host */
	});
};

if (MODE === "stall-always") {
	swallow();
} else if (MODE === "stall-once" && instance === 1) {
	swallow();
} else if (MODE === "crash-once" && instance === 1) {
	parentPort.on("message", (message) => {
		if (message && message.type === "start") process.exit(3);
	});
} else {
	await import(pathToFileURL(REAL).href);
}
