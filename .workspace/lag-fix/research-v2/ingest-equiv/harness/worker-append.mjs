// Worker half of the append/offset-resume scenario. Uses the REAL deployed
// `openUsageDb` + `foldCcSource`, and performs the file appends itself so the
// sequence is identical to the baseline's.
import { parentPort, workerData } from "node:worker_threads";
import { appendFileSync, utimesSync } from "node:fs";
import { loadDeployed } from "./deployed-lib.mjs";

const { foldCcSource } = await loadDeployed("ingest-cc.js");
const { openUsageDb } = await loadDeployed("db.js");

const { dbPath, ccRoot, file, script } = workerData;
const db = await openUsageDb(dbPath);
const phases = [];
const snap = () => ({
	events: db.prepare("SELECT data_source, session_id, dedup_key, ts, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens FROM usage_events ORDER BY dedup_key").all(),
	daily: db.prepare("SELECT day, data_source, requests, input_tokens, output_tokens FROM usage_daily ORDER BY day, data_source").all(),
	sync: db.prepare("SELECT mtime, size, fingerprint, last_offset, last_seq FROM sync_state ORDER BY source").all(),
});

for (const step of script) {
	if (step.op === "append") {
		appendFileSync(file, step.data);
		utimesSync(file, step.mtime, step.mtime);
		continue;
	}
	const result = foldCcSource(db, ccRoot, { onProgress: () => {} });
	phases.push({ phase: step.phase, size: step.size, result, state: snap() });
}
db.close();
parentPort.postMessage({ phases });
