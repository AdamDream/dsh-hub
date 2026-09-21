# probe/ — instrumented db.js copy (evidence artifact)

`probe/lib/db.js` is a copy of the DEPLOYED `lib/db.js` used only to observe the
module-level `MAX(day)` cache. Two deviations, both verified by diff:

1. `import { dshHomePath } from "@deepseek-ai/dsh-home-paths";` → a stub constant.
   Needed only because the copy lives outside the plugin install tree; the copy's
   `resolveDbPath()` is never called.
2. `maxDailyDayMs()` / `invalidateMaxDailyDayCache()` gained
   `globalThis.__cacheStats` hit/miss/invalidate counters. Control flow and all
   returned values are unchanged.

Fidelity check (only the import line differs):

    diff <(sed -e 's/const dshHomePath = .*/STUB/' -e '/__cacheStats/d' \
             ~/.dsh/profiles/node_modules/@local/dsh-usage/lib/db.js) \
         <(sed -e 's/const dshHomePath = .*/STUB/' -e '/__cacheStats/d' probe/lib/db.js)

`host.mjs` runs the host-thread half, `worker.mjs` the worker half.
Driver: `harness/probe-cache-scope.mjs`. The deployed file is never modified.
