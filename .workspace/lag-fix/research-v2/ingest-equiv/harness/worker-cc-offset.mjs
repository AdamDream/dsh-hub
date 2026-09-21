import { parentPort, workerData } from "node:worker_threads";
import { loadDeployed } from "./deployed-lib.mjs";

const { foldCcSource } = await loadDeployed("ingest-cc.js");
const { openUsageDb } = await loadDeployed("db.js");

const db = await openUsageDb(workerData.dbPath);
const result = foldCcSource(db, workerData.ccRoot, { onProgress: () => {} });
const state = {
	events: db.prepare("SELECT data_source, session_id, dedup_key, ts, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens FROM usage_events ORDER BY dedup_key").all(),
	daily: db.prepare("SELECT day, data_source, requests, input_tokens FROM usage_daily ORDER BY day, data_source").all(),
	sync: db.prepare("SELECT mtime, size, fingerprint, last_offset, last_seq FROM sync_state ORDER BY source").all(),
};
db.close();
parentPort.postMessage({ result, state });
