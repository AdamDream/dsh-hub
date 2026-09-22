# Host-side RPC cost audit — hypothesis H4

**Scope of this document:** the host half of H4 ("the expensive panels are expensive because of
the RPC they trigger and/or an uncached host-side rescan"). Everything below is either a measured
number or a `file:line` citation. Nothing was written outside
`.workspace/lag-fix/incident2/why-these-two/hostside/`; no process was signalled; the host
`node /home/CNS2026495165/.npm-global/bin/dsh web` (PID 301709, started 2026-09-22 10:54:59)
was only ever POSTed read-only RPCs and was still serving normally at the end of the audit.

## 0. Bottom line (H4 verdict)

**H4 is SUPPORTED but with a corrected attribution.**

* Only **two** of the mount-path RPCs are host-expensive (>100 ms median):
  **`subagent.list` 224.1 ms median / 1146.9 ms worst p95** and **`session.list`
  336.9 ms median / 996.6 ms worst p95**. Everything else on the mount paths is **≤ 7.3 ms**
  even in the worst run (median-of-medians ≤ 5.0 ms).
* Both expensive methods are **uncached per-call rescans**: both call
  `sessionPersistence.list()` unconditionally, which is a **full filesystem walk of
  `~/.dsh/sessions` (19 project dirs → 1049 session dirs → 1052 log files, 578 MB)**, with no
  memo of the resulting header table. `subagent.list` additionally folds every subagent's
  `sessionListMetadata` (`dsh-subagent/lib/index.js:1830-1833`, `1863-1899`).
* Contrary to the working assumption, **`pluginInventory/list` is NOT expensive and NOT a
  filesystem/module-graph rescan**: it is a synchronous walk of the Cordis loader's in-memory
  entry `store` (`dsh-host-plugin-inventory/lib/index.js:102-114`, `cordis-plugin-loader/lib/index.js:170-177`),
  measured at **1.0–1.5 ms median, 21719 bytes, 208–218 calls/s single-connection**. The
  "插件列表 tab is expensive" symptom is **not** explained by this RPC.
* The 通用设置 (General) section's mount burst as reported by the browser-side line is
  **host-cheap**: of its listed RPCs only `subagent.list` exceeds 100 ms. `settings.describe`
  (2.3 ms, 43.5 KB), `skill.list` (1.0 ms), `commands/list` (0.6 ms), `session.models` (0.7 ms),
  `llm.providers` (0.6 ms), `credentials.describe` (~7 ms), `session.history` (6.8 ms) and
  `dynamicCordisRunner/inventory` (0.9 ms) are all well under the threshold.
* `subagent.list` is **not section-scoped on the host or in the client**: its only client trigger
  is `refreshSubagents(parentSessionId)` (`dsh-client-runtime/lib/client.js:7994-8010`), fired from
  `handleConnected()` (line 8450-8451) and from the selected-session watcher (line 9235). It costs
  **175–616 ms every time the selected session changes**, and it happened to be captured inside the
  General-section trace. In that sense the General section's cost is less "its own RPCs" and more
  "the session-selection refresh that coincides with it".
* The known prior finding about the **O(N log N) comparator is already fixed** in the running host
  and my samples confirm the fix, not the bug (see §5.5).

---

## 1. Route enumeration: how a method name becomes an HTTP route

There are **two** dispatchers behind `POST /api/...`; the shape of the route depends on which one
owns the endpoint.

### 1.1 Unary methods — one dot-separated segment

`dsh-host-apiproxy/lib/types/fetch/handler.js:199-237` accepts `POST /api/<exact-key>` and then
`methodFor(path)` (`handler.js:77-79`) requires the path segment to be an **exact own key of the
`UNARY_ROUTES` table**, which is built at `handler.js:27-75`. The table is the authority; there is
no prefix routing. Hence **`POST /api/pluginInventory.list` → 404** (the key does not exist), and
the body's `method` must equal the path segment (`handler.js:231-233`).

Route template: `POST /api/<UNARY_ROUTES key>` with payload
`{"type":"client-request","rpcId":<string>,"method":"<same key>","payload":{...}}`.

### 1.2 Remote (`<namespace>/<method>`) methods — two segments

The api-gateway installs an RPC interceptor on the shared `/api` channel with a **second**
path segment (`dsh-api-gateway/lib/index.js:62`, matched by `claimsEndpoint` at `lib/types/index.js:70-79`:

```js
const segments = endpoint.split('/');
if (segments.length !== 2 || segments[0] === '' || segments[1] === '') return false;
```

The interceptor runs **before** the apiproxy fallback (`dsh-client-connection/lib/index.js:235-238`),
so `pluginInventory/list` is claimed by the gateway and never reaches `UNARY_ROUTES`.

`dsh-api-gateway/lib/types/index.js:142-148` is the exact payload constraint:

```js
if (!isObject(payload) || !isPlainObject(payload)
    || Reflect.ownKeys(payload).length !== 1
    || !Object.hasOwn(payload, 'args')
    || !isObject(payload.args) || !isPlainObject(payload.args)) {
    throw new Error('Remote payload must contain exactly one plain-object args field');
```

So the payload for a Remote endpoint is **`{"args":{<named params>}}`** — a plain **object**, not
an array. `{"args":[]}` produces the business error
`Remote payload must contain exactly one plain-object args field` **with HTTP 200**.

Route template: `POST /api/<namespace>/<method>` with payload
`{"type":"client-request","rpcId":<string>,"method":"<namespace>/<method>","payload":{"args":{...}}}`.

On an unknown two-segment path the gateway declines and the apiproxy answers 404 — which is why
the earlier `POST /api/pluginInventory.list` probe 404s while `/api/pluginInventory/list` succeeds.

### 1.3 Non-unary physical routes

* `GET  /api/events.mux`, `GET /api/events.host` — SSE, no envelope (`handler.js:180-185`).
* `GET|HEAD /api/session.export?sessionId=...` — host-only download (`handler.js:186-196`).
* `POST /api/respond` — client-response path, separate parse (`handler.js:220-224`).
* `GET /` — static SPA shell (fallback seat, `dsh-host-webserver/lib/index.js:270-277`).

### 1.4 Exact curl invocation per method (all verified working, HTTP 200)

```bash
# control
curl -s -o /dev/null -w '%{http_code} %{size_download} %{time_total}\n' http://127.0.0.1:3080/

# ---- unary (POST /api/<key>) ----
U='{"type":"client-request","rpcId":"r1","method":"METHOD","payload":PAYLOAD}'
curl -s -o /tmp/x.json -w '%{http_code} %{size_download} %{time_total}\n' \
  -X POST http://127.0.0.1:3080/api/METHOD -H 'content-type: application/json' -d "$U"

# ---- remote (POST /api/<ns>/<method>) ----
curl -s -o /tmp/x.json -w '%{http_code} %{size_download} %{time_total}\n' \
  -X POST http://127.0.0.1:3080/api/pluginInventory/list -H 'content-type: application/json' \
  -d '{"type":"client-request","rpcId":"r1","method":"pluginInventory/list","payload":{"args":{}}}'
```

| method | route | payload that works | verified |
|---|---|---|---|
| `host.describe` | `POST /api/host.describe` | `{}` | 200 ok |
| `session.list` | `POST /api/session.list` | `{}` | 200 ok |
| `session.history` | `POST /api/session.history` | `{"sessionId":"<attached id>"}` | 200 ok |
| `session.models` | `POST /api/session.models` | `{"sessionId":"<top-level attached id>"}` | 200 `agent-busy` for subagent-owned ids; **payload accepted** |
| `workspace.list` | `POST /api/workspace.list` | `{}` | 200 ok |
| `agentPreset.list` | `POST /api/agentPreset.list` | `{}` | 200 ok |
| `subagent.list` | `POST /api/subagent.list` | `{"parentSessionId":"<id>"}` | 200 ok |
| `skill.list` | `POST /api/skill.list` | `{"sessionId":"<id>"}` | 200 ok |
| `settings.describe` | `POST /api/settings.describe` | `{}` | 200 ok |
| `credentials.describe` | `POST /api/credentials.describe` | `{"refs":["llm-deepseek.apiKey"]}` | 200, business error `ok:false` (ref not configured) — **schema accepted, no secret read into the report** |
| `llm.providers` | `POST /api/llm.providers` | `{}` | 200 ok |
| `commands/list` | `POST /api/commands/list` | `{"args":{"sessionId":"<id>"}}` | endpoint reached, business error (needs a live top-level session) |
| `pluginInventory/list` | `POST /api/pluginInventory/list` | `{"args":{}}` | 200 ok, 177 entries |
| `dynamicCordisRunner/inventory` | `POST /api/dynamicCordisRunner/inventory` | `{"args":{}}` | 200 ok, `[]` |

**Read-only safety declaration.** The only methods invoked were the table above plus
`GET /`. I deliberately did **not** call `settings.update` / `settings.replace` / `settings.mutate`,
`credentials.set` / `credentials.unset`, `agentPreset.select|copy|remove|openDocument`,
`session.create|rename|fork|prompt|cancel|selectModel|attachment|updateQueue`,
`workspace.create|rename|delete|insertBefore|insertSessionBefore|archiveSession`,
`goal.*`, `subagent.prompt|interrupt|history`, `host.createDirectory|openPath|pickDirectory`,
`dynamicCordisRunner.invoke|runHostHalf|settleUserRun|stopFromPanel|reportRenderFailure|
reportClientGuardFailure|resolveInspectQuery|resolveRequestRun|getClientCode`. `commands/list` and
`dynamicCordisRunner/inventory` were judged read-only from their descriptors
(`dsh-commands/lib/typert.host.js:33-40` — `commands/list` takes one sessionId and returns a
command catalog; `dsh-cordis-host-runner/lib/typert.host.js:261-263` — `inventory()` is a pure
read, §5.2). **`credentials.describe` was called with a ref list only**; no credential value is
reproduced anywhere in this report.

### 1.5 Source-tree note (both paths are the same bytes)

`~/.dsh/profiles/node_modules/@deepseek-ai/<pkg>/lib/index.js` and
`~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/<pkg>/lib/index.js`
share **inode 31327410** (and md5 `76fe5ee08d88b662f789011274cc3a55` for apiproxy), i.e. the same
file. `dsh-host-apiproxy/lib/index.js` mtime is **2026-09-22 10:51**, four minutes *before* the host
started (10:54:59), so the running host includes the `dsh-lag-fix B1-perf v1` edit visible at
`index.js:2237-2243`. Citations use whichever path resolves; they are the same content.

---

## 2. Timing of each reachable RPC

Three runs, each method measured **≥15 times**; run 2 and run 3 are *interleaved and shuffled* so
that no method is systematically favoured by cold caches or by the concurrent browser line.
All timings are curl `%{time_total}` against `http://127.0.0.1:3080`, single connection at a time,
≤4 concurrent curls anywhere in the audit.

* run 1 — 15 sequential calls per method, methods in fixed order (`bench.json`)
* run 2 — 16 calls per method, shuffled round-robin (`interleave.json`, overwritten by run 3; values transcribed from its stdout)
* run 3 — 20 calls per method, shuffled round-robin (`interleave.json`)

**Aggregate = median of the three per-run medians.**

| method | median | worst p95 | bytes (median) | per-run medians (ms) | ÷ fast-median |
|---|---:|---:|---:|---|---:|
| `session.list` | **336.9 ms** | **996.6 ms** | 495 963 | 477.2 / 336.9 / 282.6 | **182x** |
| `subagent.list` | **224.1 ms** | **1146.9 ms** | 105 | 615.6 / 224.1 / 175.3 | **121x** |
| `host.describe` | 16.6 ms | 115.4 ms | 231 | 16.6 (run 1 only) | 9.0x |
| `GET /` (control) | 11.8 ms | 50.4 ms | 16 611 | 11.8 (run 1 only) | 6.4x |
| `credentials.describe` | 7.2 ms | 12.4 ms | 363 | 7.2 (run 1 only) | 3.9x |
| `session.history` | 6.8 ms | 60.0 ms | 592 488–678 106 | 10.7 / 6.8 / 6.5 | 3.7x |
| `agentPreset.list` | 5.0 ms | 21.7 ms | 1 182 | 13.3 / 5.0 / 2.2 | 2.7x |
| `workspace.list` | 2.7 ms | 9.9 ms | 8 792 | 5.2 / 2.7 / 0.8 | 1.5x |
| `settings.describe` | 2.3 ms | 22.7 ms | 43 533 | 7.3 / 2.3 / 2.0 | 1.2x |
| `pluginInventory/list` | 1.4 ms | 7.0 ms | 21 719 | 1.4 / 1.5 / 1.0 | 0.8x |
| `skill.list` | 1.0 ms | 8.1 ms | 1 593 | 3.1 / 0.7 / 1.0 | 0.5x |
| `dynamicCordisRunner/inventory` | 0.9 ms | 91.7 ms | 70 | 12.8 / 0.9 / 0.8 | 0.5x |
| `session.models` | 0.9 ms | 25.6 ms | 248 | 3.6 / 0.9 / 0.7 | 0.5x |
| `llm.providers` | 0.8 ms | 7.8 ms | 6 118 | 3.6 / 0.8 / 0.6 | 0.4x |
| `commands/list` | 0.7 ms | 7.5 ms | 231 | 0.7 / 1.2 / 0.6 | 0.4x |

**Fast-method median** (the 12 fast methods, excluding the two outliers and the control) =
**1.85 ms**; restricted to the mount-path methods only it is **1.60 ms**. `host.describe` was only
sampled in run 1 (16.6 ms median, 115.4 ms p95) and is **UNVERIFIED as to its steady-state cost** —
run 1 also contains the slowest samples overall for every method, so that number is dominated by
the ambient contention of the concurrent browser line and should not be read as a host property.

### 2.1 Stable-outlier test (≥5x the median of the others)

Threshold = 5 × 1.85 ms = 9.3 ms.

* **`session.list` — OUTLIER, 182x.** Confirmed in all three runs (477.2 / 336.9 / 282.6 ms).
* **`subagent.list` — OUTLIER, 121x.** Confirmed in all three runs (615.6 / 224.1 / 175.3 ms).
* Every other method is **below the threshold in every run** (worst per-run median was
  `dynamicCordisRunner/inventory` 12.8 ms in run 1, which fell to 0.8–0.9 ms in runs 2–3 and is
  therefore ambient noise, not a stable outlier).
* No method besides these two ever exceeded **~28 ms median**; individual p95 samples up to
  218 ms (`llm.providers`, run 2) exist but are single-sample contention spikes, not method cost.

---

## 3. Host event-loop blocking

Probe: while a burst of a target RPC is in flight, a separate thread repeatedly issues
`POST /api/workspace.list` (pure in-memory registry read, ~0.5–1.0 ms) and records its latency.
A pure-I/O target would leave the probe median unchanged; a target that runs long synchronous JS
withholds the event loop and inflates the probe *median* while also showing a *max* ≈ the
target's own service time. Files: `block.json` (run A), `block2.json` (run B), `block3.json` (run C).

| target | concurrency / duration | target throughput | probe p50 quiet → loaded | probe p95 quiet → loaded | probe max under load |
|---|---|---:|---|---|---:|
| **`session.list`** | 2-way, 4 s (C) | **4.0 calls/s** | 0.50 → **1.40 ms (2.8x)** | 4.60 → **43.90 ms (9.5x)** | **89.8 ms** (p99 63.3) |
| `session.list` | 4-way, burst (A) | 8 calls / 18.5 s | 0.6 → **5.1 ms (8.5x)** | — | **789.1 ms** |
| **`subagent.list`** | 4-way, 4 s (B) | **5.7 calls/s** | 0.70 → **0.90 ms (1.29x)** | 10.70 → **17.00 ms (1.59x)** | 112.8 ms (p99 68.8) |
| `subagent.list` | 4-way, burst (A) | 8 calls / 5.4 s | 0.8 → 1.1 ms (1.38x) | — | **314.9 ms** |
| **`pluginInventory/list`** | 2-way, 4 s (C) | **208 calls/s** | 0.50 → 1.20 ms (2.4x) | 4.70 → 7.70 ms (1.6x) | 59.9 ms |
| `pluginInventory/list` | 4-way, 4 s (B) | **218 calls/s** | 1.00 → 4.40 ms (4.4x) | 12.60 → 59.50 ms (4.7x) | 89.4 ms |
| `settings.describe` | 2-way, 4 s (C) | **184 calls/s** | 0.50 → 3.20 ms (6.4x) | 5.20 → 9.00 ms (1.7x) | 59.4 ms |

Reading of these numbers:

* **`session.list` is the only RPC that meaningfully withholds the host event loop.** At just
  **2-way** concurrency its own throughput collapses to 4 calls/s, probe p95 inflates 9.5x
  (4.60 → 43.90 ms) and a single probe request waited **789 ms** in the 4-way burst — i.e. the
  host served nothing else for up to ~0.8 s. The 496 KB response body is serialised on the main
  thread (`node:http` + `Response.json`), and the per-session projection/`structuredClone` work
  ahead of it is synchronous.
* **`subagent.list` does not block the loop; it is simply slow.** Probe median inflation is only
  1.29x, p95 1.59x, while the target itself runs at 5.7 calls/s. That is the signature of a call
  parked on **`await`ed filesystem I/O** (`persistence.list()`, §5.1) with bounded concurrency:
  the loop stays free, the RPC just takes 175–616 ms. It still stalls the *panel* for that long,
  and it is the sole caller-facing cost of the General-section mount burst.
* **`pluginInventory/list` does not block even at 218 calls/s** (4-way, 875 calls in 4 s), and
  `settings.describe` does not block at 184 calls/s. Their probe p50 "inflation" (4.4x, 6.4x) is
  **relative** inflation on a 1 ms baseline — the absolute deltas are 3.4 ms and 2.7 ms, i.e. the
  cost of the probe's own curl process spawn under CPU sharing, not host slowness. **Neither is a
  candidate for H4.**

---

## 4. Caching / memoisation verdict per method

| method | cached / memoised? | per-call work | citation |
|---|---|---|---|
| `pluginInventory/list` | **no cache — by design** | sync walk of the loader's in-memory entry `store` (177 entries) | `dsh-host-plugin-inventory/lib/index.js:96-114`; `cordis-plugin-loader/lib/index.js:170-177` |
| `dynamicCordisRunner/inventory` | **no cache** | `registry.all()` = `[...this.plugins.values()]` over an in-memory `Map`, plus shallow clones | `dsh-cordis-host-runner/lib/index.js:1939-1964`, `1015-1017`, `2581-2594` |
| `settings.describe` | **served from an in-memory snapshot; no per-call cache** | `[...registrations.values()].map(...)` + `structuredClone` + `schema.toJSON()` + `redactSecrets` per namespace (20 namespaces) | `dsh-host-apiproxy/lib/index.js:3482-3490`, `2430-2444`; `dsh-settings/lib/index.js:352-382` (`resolved` snapshots at `:319`, `:389`) |
| `subagent.list` | **NO CACHE — per-call full filesystem rescan** | `prepareListing` → `sessionPersistence.list()` then a corpus rebuild, every call | `dsh-host-apiproxy/lib/index.js:2978-2986`; `dsh-subagent/lib/index.js:1830-1833`, `1863-1899`; `dsh-session-persistence-jsonl/lib/index.js:1037-1039`, `1060-1087` |
| `session.list` | **NO CACHE — per-call full filesystem rescan + 496 KB body** | `listVisibleSessionSummaries` → `persistence.list()` + per-session projections | `dsh-host-apiproxy/lib/index.js:2224-2301` (esp. `:2255`), `:2492-2494` |
| `session.history` | no cache, but bounded/cheap | page slice of the attached event array | `dsh-host-apiproxy/lib/index.js:2654-2678` |
| `agentPreset.list` | resolves per call, cheap | `presets.list()` (5 presets) | `dsh-host-apiproxy/lib/index.js:3317-3337` |
| `host.describe` | per call, trivial | `defaults.defaultModelSelection()` + `ctx.agents.list().length` | `dsh-host-apiproxy/lib/index.js:4745-4760` |
| `llm.providers` / `session.models` | provider registry read; `session.models` rebuilds the catalog per call (`buildModelCatalog`, `Promise.all` over providers × models) | `dsh-host-apiproxy/lib/index.js:1010-1050`, `2679-2692` | measured ≤3.6 ms |
| `skill.list` / `commands/list` | per call, small | 1593 B / 231 B responses | measured ≤3.1 ms |

### 4.1 Does `pluginInventory/list` rescan the plugin filesystem / module graph? **NO.**

The entire "scan loop" is:

```js
// dsh-host-plugin-inventory/lib/index.js:102-114
list() {
    const entries = [];
    for (const entry of this.ctx.loader.entries()) {     // <-- in-memory generator
        if (entry.options.group) continue;
        entries.push({ entryId: pluginEntryId(entry.id), moduleName: entry.options.name,
                       enabled: !entry.disabled,
                       fiberPhase: entry.fiber === void 0 ? null : FIBER_PHASE[entry.fiber.state] });
    }
    return { entries };
}
```

and `loader.entries()` is a pure generator over an in-memory object tree:

```js
// cordis-plugin-loader/lib/index.js:170-177
*entries() {
    for (const entry of Object.values(this.store)) {
        yield entry;
        if (!entry.subtree) continue;
        yield* entry.subtree.entries();
    }
}
```

`this.store` is `Object.create(null)` (`cordis-plugin-loader/lib/index.js:157`), populated by the
loader, and `entry.fiber.state` is maintained by Cordis lifecycle events — so the doc comment at
`dsh-host-plugin-inventory/lib/index.js:96-101` is literally true: *"Read the Loader directly on
every call… a second cache would only add another lifecycle truth to keep synchronized."*
**There is no `readdir`, no `import()`, no module-graph walk, no disk hit.** Measured: 1.0–1.5 ms
median for 21 719 bytes (177 entries), 208–218 calls/s.

### 4.2 Is `dynamicCordisRunner/inventory` cached? **No — and it does not need to be.**

```js
// dsh-cordis-host-runner/lib/index.js:1939-1964
inventory() {
    return this.registry.all().map((plugin) => ({ pluginId: plugin.pluginId, ... }));
}
// dsh-cordis-host-runner/lib/index.js:1015-1017
all() { return [...this.plugins.values()]; }   // in-memory Map
```

`cloneAttempt` (`:2581-2594`) is a shallow object/array copy, not a deep clone of source. Measured
0.8–0.9 ms and a `[]` payload (no dynamic plugins were live), 70 bytes.

### 4.3 Is `settings.describe` served from a snapshot? **Yes — an in-memory registration snapshot.**

`apiproxy` calls `settings.describe({ redactSecrets: true })` (`dsh-host-apiproxy/lib/index.js:3482-3490`).
`SettingsProvider.describe` (`dsh-settings/lib/index.js:352-382`) maps the `registrations` Map
(`:255`) and reads `registration.resolved`, a value already resolved and `deepFreeze`d at
registration time (`:319`) or swapped on commit (`:546-548`). The user layer comes from
`this.section(ns)` against the in-memory `document` (`:257`), which the file backend refreshes via a
`chokidar` watcher (`dsh-settings-file/lib/index.js:179-196`), i.e. **no disk read on the RPC
path**. It is *not* a memo of the response: every call re-runs `structuredClone` +
`schema.toJSON()` + `redactSecrets` for 20 namespaces and re-serialises 43.5 KB — synchronous,
observed at 2.0–7.3 ms. Cheap, but strictly per call.

### 4.4 **The real rescan: `subagent.list` and `session.list` both walk the whole session store.**

```js
// dsh-subagent/lib/index.js:1863-1889  (prepareListing — runs on EVERY subagent.list)
const persistence = ctx.get("sessionPersistence");
if (persistence !== void 0) {
    persistedHeaders = await persistence.list(signal);      // <-- full FS walk, no memo
    ...
}
const corpus = new Map();
for (const header of persistedHeaders) corpus.set(header.id, { header, live: void 0 });
for (const session of sessions.list()) corpus.set(session.header.id, { header: session.header, live: session });
```

```js
// dsh-subagent/lib/index.js:1830-1833  (listChildren — the whole corpus is built, then filtered)
async function listChildren(ctx, parentSessionId, signal) {
    const listing = await prepareListing(ctx, signal);
    return (await resolveCandidateRows([...listing.corpus.values()]
        .filter((record) => record.header.parentSession === parentSessionId && record.header.origin === "subagent")
        .sort(compareCorpusRecords), listing, signal)).filter((row) => row !== void 0);
}
```

```js
// dsh-host-apiproxy/lib/index.js:2255  (listVisibleSessionSummaries — session.list)
const coldSource = (await persistence.list(signal));
```

and the walk itself:

```js
// dsh-session-persistence-jsonl/lib/index.js:1037-1039
async list(signal) { return (await this.listArtifacts(signal)).map((artifact) => artifact.header); }
// dsh-session-persistence-jsonl/lib/index.js:1060-1087 (listArtifacts)
for (const project of await this.listProjectDirs(signal)) {            // readdir root
    for (const dir of await this.listSessionDirs(project, signal)) {   // readdir per project
        const opposite = join(dir, `session${logSuffix(this.oppositeCompression())}`);
        const oppositeExists = await this.exists(opposite);            // open()+close() per dir
        const path = join(dir, `session${logSuffix(this.compression)}`);
        if (!(await this.exists(path))) continue;                       // open()+close() per dir
        const first = ... await this.readFirstLine(path, signal);      // open+read+close per dir
        const meta = parseHeaderMeta(first);
        await this.assertStoredIdentity(path, meta, void 0, signal);   // logPath compare / sameFile realpath
        artifacts.push(...);
```

`listProjectDirs` (`:1377-1387`) and `listSessionDirs` (`:1389-1397`) are plain `readdir` with
**no memo**; `exists` (`:1431`) is `open()+close()`. On this machine that is **19 project dirs,
1049 session dirs, 1052 log files, 578 MB** under `~/.dsh/sessions`. Measured cost per call:
**175–616 ms**. Only `ensureRootEncoding` is memoised (`:1398-1400`, `this.rootEncodingCheck ??=`).

This is the genuine "uncached host-side rescan" H4 was looking for — and it is **not** attached to
`pluginInventory/list` or to any of the named mount RPCs of the 通用设置 section; it is attached to
the two session/subagent catalog reads.

### 4.5 The prior comparator finding — verified, and already hot-fixed

Claimed: `dsh-host-apiproxy/lib/index.js` ~line 2237 called `sessionListMetadata(events)` inside a
sort comparator (O(N log N) full event-stream folds, no memo), making `session.list` algorithmic.
**Code state now** (`index.js:2237-2243`) — the comparator is gone:

```js
/* dsh-lag-fix B1-perf v1: 先算一次 recency 再排序。
   原写法在比较器里调 sessionListMetadata(events)（O(events) 全事件流折叠、无 memo），
   一次排序要折 O(N log N)×2 遍 ⇒ 实测 session.list 单次 0.3–2.5 s。
   预计算后每会话只折 1 遍，排序退化为纯标量比较… */
const attachedRecency = new Map();
for (const session of attachedSubagents) attachedRecency.set(session.id, sessionListUpdatedAt(session.header, sessionListMetadata(session.events)));
attachedSubagents.sort((a, b) => (attachedRecency.get(b.id) ?? 0) - (attachedRecency.get(a.id) ?? 0));
```

**My own ≥15-sample verification: `session.list` is still SLOW NOW — 282.6 / 336.9 / 477.2 ms
median over three runs, p95 up to 996.6 ms.** The 0.166 s median figure I was asked to check is
**NOT reproduced**: my best run is 282.6 ms (1.7x that figure), and that run is the *fastest* of
three. The hotfix removed the *algorithmic* multiplier (the same edit's comment claims 0.3–2.5 s
before it), but it did not make the call cheap, because the dominant cost is `persistence.list()`
(`:2255` → the 1049-directory walk) plus a 496 KB response, not the comparator. So: **hotfix
present and effective for the comparator; `session.list` nevertheless remains the single slowest
mount-adjacent RPC on the host.** Payload detail for context: 299 items = 99 top-level + exactly
200 subagents (`SUBAGENT_LIST_MAX = 200`, `index.js:1231-1233`), 495 963 bytes.

---

## 5. Section-by-section attribution (the H4 answer)

Host cost of the RPCs each section is reported to issue on mount, using the aggregate medians
(§2). "Fast" = the 1.60–1.85 ms fast-method baseline.

### 5.1 通用设置 (General) — reported burst

| RPC | host median | verdict |
|---|---:|---|
| `settings.describe` | 2.3 ms (43.5 KB, 20 namespaces) | cheap; snapshot-backed, per-call re-serialise |
| `subagent.list` | **224.1 ms** (p95 1146.9 ms) | **EXPENSIVE — uncached full FS rescan** |
| `session.history` | 6.8 ms (592–678 KB body) | cheap on the host; *client-side* parse/ingest of ~600 KB is out of this document's scope |
| `skill.list` | 1.0 ms | cheap |
| `commands/list` | 0.7 ms | cheap (business error in my probe because a live top-level session id was needed) |
| `session.models` | 0.9 ms | cheap; `agent-busy` for subagent-owned ids, so the browser's real cost may differ — **UNVERIFIED** for a top-level session |
| `llm.providers` | 0.8 ms | cheap |
| `credentials.describe` | 7.2 ms | cheap (single run only — **UNVERIFIED** steady state) |
| `dynamicCordisRunner/inventory` | 0.9 ms | cheap, in-memory, not cached (and does not need to be) |

**Exactly one of nine is host-expensive: `subagent.list`.** And it is not really a section RPC: the
client fires it from `refreshSubagents(parentSessionId)`
(`dsh-client-runtime/lib/client.js:7994-8010`), triggered by `handleConnected()`
(`:8450-8451`) and by the selected-session watcher (`:9235`) — i.e. **on every session-selection
change and every reconnect**, regardless of which settings section is open. Confirmed
parent-independent: with a **non-existent** parent id the call still costs 351.3 ms median /
1099.1 ms max, because `prepareListing` enumerates the whole store before filtering
(`dsh-subagent/lib/index.js:1863-1889`). That is the strongest single piece of evidence for H4 on
the General panel.

### 5.2 插件 (Plugins) → 插件列表 (Plugin list) tab — reported RPC

| RPC | host median | verdict |
|---|---:|---|
| `pluginInventory/list` | **1.4 ms** (21 719 B, 177 entries) | **NOT expensive, NOT a rescan** |

`pluginInventory/list` is **not** an H4 offender. It reads the loader's in-memory entry store
(§4.1), sustains 208–218 calls/s from a single connection, and does not move the probe median.
The tab fetches once on mount and memoises its own filtering
(`dsh-client-ui-settings-plugin-inventory/lib/client.js:69-84` — `useEffect` → `list()`,
`useMemo` filter over `snapshot.entries`); it issues **no further host RPC**. Whatever makes that
tab feel slow is **not** host RPC cost — it must be client-side render/paint of 177 rows, or the
environmental factors the parallel lines are chasing. **Verdict for this section: NOT-SUPPORTED,
with numbers.**

### 5.3 Sections reported as smooth

| section | its RPCs | host median | host-expensive? |
|---|---|---:|---|
| 模型 (models) | `llm.providers` (0.8 ms), `credentials.describe` (7.2 ms), `session.models` (0.9 ms) | ≤7.2 ms | no |
| Agent 预设 | `agentPreset.list` | 5.0 ms | no |
| 远程工作区 (remote workspace) | `workspace.list` | 2.7 ms | no |
| 分布式控制 dsh-ssh-gui | shares `settings.describe` (2.3 ms) + `settings.mutate` (not called, write path) | 2.3 ms read | no |
| vision-adam 识图设置 | shares `settings.describe` | 2.3 ms | no |
| 子代理模型 | `settings.describe` + `agentPreset.list` | 2.3–5.0 ms | no |

**So the "expensive vs smooth" split does NOT map onto the RPC sets — it maps onto whether
`subagent.list`/`session.list` happen to be in flight.** The smooth sections and the General
section have host-cost profiles of the same order (0.6–7 ms per RPC); General's only 224 ms item is
a session-selection-driven call that the smooth sections also trigger whenever the selected session
changes. Symmetrically, the Plugins tab is cheap on the host like the smooth sections yet is
reported as expensive.

### 5.4 What this implies for H4 (explicit verdict)

* **RPC-driven component: SUPPORTED for the General panel — via `subagent.list` only.**
  Measured 224.1 ms median (175.3 / 224.1 / 615.6 ms across runs), p95 up to 1146.9 ms, against a
  1.60 ms fast baseline = **121x** the median of the other mount RPCs.
* **Uncached host-side rescan: SUPPORTED, and it is the mechanism.** `subagent.list` and
  `session.list` both call `sessionPersistence.list()` per call with no memo
  (`dsh-subagent/lib/index.js:1872-1879`; `dsh-host-apiproxy/lib/index.js:2255`;
  `dsh-session-persistence-jsonl/lib/index.js:1037-1039`, `1060-1087`), walking 1049 session
  directories / 1052 log files / 578 MB every single time.
* **RPC-driven component: NOT-SUPPORTED for the 插件列表 tab.** `pluginInventory/list` = 1.4 ms,
  in-memory, no rescan, 208–218 calls/s. H4 does not explain that panel.
* **NOT-SUPPORTED for the remaining General-section mount RPCs** (`settings.describe`,
  `skill.list`, `commands/list`, `session.models`, `llm.providers`, `credentials.describe`,
  `session.history`, `dynamicCordisRunner/inventory`): all ≤7.3 ms median. Even the two large
  responses (`settings.describe` 43.5 KB / 2.3 ms; `session.history` 592–678 KB / 6.8 ms) are not
  host-expensive; their cost, if any, lands in the browser.
* **The 通用设置 vs 插件 asymmetry is therefore real but not where H4 predicted it:** General is
  expensive because a **session-selection-driven** `subagent.list` (and, separately, the always-on
  `session.list`) hits an uncached filesystem rescan, not because of the settings RPCs the section
  list names; Plugins is cheap on the host at 1.4 ms.

### 5.5 Blocking summary (for the two methods the task singled out)

| RPC | is it an uncached rescan? | does it block the host event loop? | headline cost |
|---|---|---|---|
| **`session.list`** (slowest measured) | **YES** — `persistence.list()` per call, 496 KB body | **YES** — 2-way burst: probe p50 0.50→1.40 ms (2.8x), p95 4.60→43.90 ms (**9.5x**), single probe wait **789 ms**; target itself throttles to **4 calls/s** | **336.9 ms median, 996.6 ms p95** |
| **`pluginInventory/list`** | NO — in-memory loader walk | NO — 208–218 calls/s, probe p95 4.70→7.70 ms with absolutely tiny deltas | **1.4 ms median, 21 719 B** |
| `subagent.list` (the General-panel offender) | **YES** — same rescan, plus per-subagent metadata fold | NO (I/O-parked) — probe p50 0.70→0.90 ms; it is slow, not blocking: 5.7 calls/s | **224.1 ms median, 1146.9 ms p95** |

---

## 6. UNVERIFIED items (with reasons)

1. **`session.models` on a real top-level session.** Every attached session id reachable
   read-only returned `agent-busy: session is owned by subagent routing`, so no successful
   `session.models` sample was obtained. `buildModelCatalog` (`index.js:1010-1050`) does
   `Promise.all` over providers × models with `resolveModelInfo` per model, so a real sample could
   be larger than the 0.9 ms measured on the error path. **UNVERIFIED.**
2. **`credentials.describe` steady state.** Sampled only in run 1 (7.2 ms median, 12.4 ms p95);
   the ref I passed is not configured, so the call short-circuits. **UNVERIFIED.**
3. **`host.describe` steady state.** Sampled only in run 1 (16.6 ms median, 115.4 ms p95), where
   every method was slower. Implementation is trivial (`index.js:4745-4760`), so I expect ≈1 ms,
   but I did not re-measure. **UNVERIFIED.**
4. **Whether any RPC performs a *module-graph* rescan.** I verified `pluginInventory/list` does not
   (it reads `Loader.store`), and that `dynamicCordisRunner/inventory` does not (in-memory
   `Map`). I did **not** audit every plugin-inventory-adjacent code path for a lazy `import()`
   sweep, because no measured number suggests one. **UNVERIFIED as a general negative.**
5. **Absolute host cost of `session.history`'s ~600 KB body.** I measured 6.8 ms wall and did not
   separate host serialise time from client transfer/parse. **UNVERIFIED split.**
6. **The run-1 numbers in general.** Run 1 (fixed order, 15 samples) was taken while the browser
   measurement line was active and produced the slowest sample for essentially every method
   (e.g. `dynamicCordisRunner/inventory` 12.8 ms vs 0.8 ms later). I treat runs 2–3 as the
   steady-state estimate and report run 1 as the contention upper bound.

## 7. Artifacts

* `hostside.md` (this file)
* `hostside.json` — machine-readable per-method timings, route templates, payload shapes,
  cache verdicts, blocking numbers, section attribution, verdicts
* Raw measurement inputs are reproducible with the commands in §1.4; the harness scripts and raw
  JSON lived under `/tmp/dshaudit/` during the audit (`bench.py`, `interleave.py`, `block.py`,
  `block2.py`, `block3.py`, `parenttest.py`, plus `bench.json` / `interleave.json` /
  `block*.json`). They are outside the workspace and therefore not part of the deliverable; every
  number they produced is transcribed above.
