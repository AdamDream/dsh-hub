import { loadDeployed } from "./deployed-lib.mjs";
export const {
	querySummary, queryTimeseries, queryHeatmap, queryByModel,
	queryByProject, queryByDay, querySessions, insertEvent,
	rebuildDailyForDays, upsertSyncState, getSyncState, openUsageDb, ensureSchema,
} = await loadDeployed("db.js");
