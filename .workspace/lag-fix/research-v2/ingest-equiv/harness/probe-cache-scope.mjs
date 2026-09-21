/**
 * Cross-thread `MAX(day)` cache scope — the load-bearing question for "fold into
 * a Worker": can a worker's `invalidateMaxDailyDayCache()` clear the HOST
 * thread's cache?
 *
 * Method: a FIDELITY-VERIFIED instrumented copy of the deployed db.js
 * (`probe/lib/db.js`, byte-identical apart from (a) the single bare import
 * replaced by a stub and (b) hit/miss/invalidate counters — see probe/README).
 * A naive drop-table detector is NOT used: dropping `usage_daily` makes
 * `queryHeatmap`'s own daily segment fail, so it cannot distinguish a cold
 * cache from a broken table.
 *
 * This file re-runs the same three steps as probe/host.mjs but prints a
 * self-contained conclusion for the audit.
 */
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const raw = execFileSync(process.execPath, [join(HERE, "..", "probe", "host.mjs")], { encoding: "utf8" });
const cleaned = raw.split("\n").filter((l) => !/ExperimentalWarning|trace-warnings/.test(l)).join("\n");
const d = JSON.parse(cleaned);

const out = {
	question: "does a Worker-side invalidateMaxDailyDayCache() clear the host thread's MAX(day) cache?",
	hostCacheAfterHostRebuild: d.hostCacheAfterHostRebuild,
	hostCacheAfterWorkerRebuild: d.hostCacheAfterWorkerRebuild,
	workerOwnCache: d.workerCache,
	hostHeatmapStillCorrect: JSON.stringify(d.heat1) === JSON.stringify(d.heat2),
	verdict: null,
};
// After the host's own rebuild, the host cache holds exactly one MISS.
// If the worker's invalidate had reached this thread, the host would show a
// second MISS right after the worker ran (its cache would have been cleared).
const hostMisses = d.hostCacheAfterWorkerRebuild.miss;
out.verdict = hostMisses === 2
	? "PER-THREAD CONFIRMED: the worker's invalidate did NOT clear the host cache (host still served from its own warm entry); module state is per-thread"
	: hostMisses === 3
		? "CROSS-THREAD INVALIDATION OBSERVED: the worker's invalidate also cleared the host cache (unexpected)"
		: `inconclusive (host misses = ${hostMisses})`;
console.log(JSON.stringify(out, null, 2));
