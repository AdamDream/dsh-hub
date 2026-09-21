// Test-only worker shim: counts every `start` message the runner sends, then
// delegates to the REAL `ingest-worker.js` (both listen on the same parentPort,
// so the production protocol runs unchanged). Used by the G2 single-flight
// acceptance: "worker side received exactly ONE start".
import { appendFileSync } from "node:fs";
import { parentPort } from "node:worker_threads";

const LOG = process.env.INGEST_TAP_LOG;
const REAL = process.env.INGEST_TAP_REAL_WORKER;
const record = (line) => {
	try {
		appendFileSync(LOG, `${line}\n`);
	} catch {
		// best effort
	}
};

record(`worker-spawn pid=${process.pid} threadId=${String(parentPort?.threadId ?? "?")}`);
parentPort.on("message", (message) => {
	if (message && message.type === "start") record(`start id=${message.id}`);
});

await import(REAL);
