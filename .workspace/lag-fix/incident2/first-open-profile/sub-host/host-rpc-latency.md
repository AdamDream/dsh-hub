# Host-side first-open profile — DSH Web settings (live host, PID 10806)

Probe of the **host half** of the "first click on 设置 feels laggy" cost, against the live
host at `http://127.0.0.1:3080` (PID 10806, `node /home/CNS2026495165/.npm-global/bin/dsh web`).
The host process was never signalled; **only read RPCs** were issued
(`*.describe` / `*.list` / `*.providers` / `models`); no product file was written and no
save/apply/delete call was made. Browser-side cost is explicitly out of scope here.

Raw data: `host-rpc-latency.json` (per-rep arrays), `raw-reps-*.jsonl`, `raw-heartbeat*.jsonl`.
Scripts: `measure_rpc.py`, `measure_keepalive.mjs`, `measure_burst.mjs`,
`measure_concurrent.mjs`, `measure_ambient.mjs`, `measure_heartbeat.mjs`, `aggregate.py`.

## 0. Load context (required `uptime` / `nproc` before and after)

| | value |
|---|---|
| `nproc` | **32** |
| `uptime` BEFORE (10:11:20) | `up 9 min, 1 user, load average: 3.08, 2.42, 1.32` |
| `uptime` AFTER (10:20:38) | `up 18 min, 1 user, load average: 5.84, 5.66, 3.48` |
| `/proc/loadavg` | before `3.08 2.42 1.32 2/2397` → after `5.84 5.66 3.48 2/3075` |
| host PID 10806 alive | yes (before and after) |
| host-side timers | `@local/dsh-usage` ingest timer is **OFF**: `const INGEST_TIMER_ENABLED = false;` — `/home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-usage/lib/index.js:67` |

Load average is *not* host event-loop headroom: DSH is one Node process — see §6.

## 1. Mount discovery (this is where two of the three suggested packages lead nowhere)

* `/settings/...` **does not exist** on this deployment. `GET /settings` → `404`,
  `POST /settings` → `405` (the 405 comes from the static/SPA fallback route, which is
  GET-only — it is *not* an RPC mount). There is no settings-controller HTTP mount to probe.
* The two packages named in the task are **broken symlinks** in the live profile and are
  absent from the installed bundle, so they contribute nothing on this host:
  * `/home/CNS2026495165/.dsh/profiles/node_modules/@deepseek-ai/dsh-api-settings-controller` → symlink to
    `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-api-settings-controller` (**does not exist**)
  * `/home/CNS2026495165/.dsh/profiles/node_modules/@deepseek-ai/dsh-api-workspace-controller` → same shape (**does not exist**)
  * Only stale copies exist under `~/.dsh/profiles-archive/web2-20260915-105429/node_modules/@deepseek-ai/…`; they are **not** what answers on the live port (see the byte-identity check below).
* The **real** settings surface is the API proxy's unary route table, `POST /api/<method>`:
  `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/types/fetch/handler.js:22` (`UNARY_ROUTES`) with
  `settings.describe`, `settings.openDocument`, `settings.update|replace|mutate`,
  `credentials.describe|set|unset`, `llm.providers|models|discoverModels`, …
* The generic (Typert Remote) surface is `POST /api/<namespace>/<method>` — endpoint =
  `` `${namespace}/${method}` `` (`dsh-api-gateway/lib/types/index.js:348-350`), transport
  `POST ${channel}/${endpoint}` with `payload = { args }`
  (`dsh-client-connection/lib/client.js:10352-10364`). `/api/pluginInventory.list` → `404`;
  the working spelling is **`/api/pluginInventory/list`** with body `{"payload":{"args":{}}}`.
* Verified that the line references below are the live code: every **host** package I cite is
  **byte-identical** between the bundle copy and the profile copy
  (`cmp` clean for `dsh-host-apiproxy`, `dsh-settings`, `dsh-settings-file`, `dsh-llm`,
  `dsh-llm-pi-ai`, `dsh-llm-deepseek`, `dsh-host-plugin-inventory`). Client-side citations are
  read from the profile's installed client bundles (`@deepseek-ai/dsh-client-*`).

Which RPCs the client actually fires on a first settings open (client evidence, for
attribution only — not re-measured here):

| surface | call | evidence |
|---|---|---|
| settings shell (mirror) | `api.settings.describe({})` | `dsh-client-ui-settings/lib/client.js:1293` |
| 模型 tab | `api.llm.providers({})` **in parallel with** `describeFace.ensure()` (= another `settings.describe` if not mirrored) | `dsh-client-ui-settings-models/lib/client.js:548` |
| 模型 tab (only if provider rows expose credential refs) | `api.credentials.describe({refs})` | `dsh-client-ui-settings-models/lib/client.js:578` |
| 插件 tab (**lazy**, only when that tab renders) | `ctx.remote.pluginInventory.list()` | `dsh-client-ui-settings-plugin-inventory/lib/client.js:279-283` |

## 2. Measured wall time per endpoint

`curl` mode: one `curl` process per rep (fresh TCP connection), 55 reps each (run1 = 15,
run2 = 40), one unmeasured warm-up call before each set.
Keep-alive mode (`node:http`, single reused socket, 25 reps) isolates server handler time from
curl process + connect cost. Connect overhead is negligible either way
(median `time_connect` = 0.08–0.14 ms).

| endpoint (mount, wire method) | HTTP | bytes | keep-alive ms p25 / **median** / max | curl ms min / **median** / max | reps |
|---|---|---|---|---|---|
| `settings.describe` (`/api/settings.describe`) | 200 | **43,534** | 1.67 / **1.96** / 89.72 | 1.81 / **9.26** / 113.28 | 55 + 25 |
| `pluginInventory/list` (`/api/pluginInventory/list`, `{"args":{}}`) | 200 | **21,720** | 0.81 / **0.92** / 14.82 | 0.91 / **3.74** / 192.88 | 55 + 25 |
| `llm.providers` (`/api/llm.providers`) | 200 | **6,119** | 0.50 / **0.70** / 30.67 | 0.54 / **4.55** / 122.57 | 55 + 25 |
| `llm.models` (`/api/llm.models`) | 200 | **6,405** | 1.38 / **1.55** / 26.03 | 1.41 / **10.83** / 134.27 | 55 + 25 |
| `credentials.describe` (`/api/credentials.describe`, 3 refs) | 200 | **298** | 0.54 / **0.95** / 41.29 | 0.68 / **27.43** / 268.66 | 55 + 25 |

All 200s, all `rc=0`, zero 4xx/5xx across 400 measured calls. Byte counts differ by ±1 only
because the echoed `rpcId` grows from `x1` to `x40`.

Response **shapes** (top-level keys + counts only, full bodies not stored):

| endpoint | top-level `result.value` keys | item counts | per-item keys |
|---|---|---|---|
| `settings.describe` | `writable, hasDocument, namespaces` | **namespaces = 20** | `ns, schema, value, base, user, applies, secrets, revision` |
| `pluginInventory/list` | `entries` | **entries = 177** | `entryId, moduleName, enabled, fiberPhase` |
| `llm.providers` | `providers` | **providers = 39** (3 active) | `provider, displayName, settingsNs, settingsPath, active` |
| `llm.models` | `groups, failures` | **groups = 3** (deepseek-official 3, opencode-go 16, adam 50), failures = 0, **69 models** | `id, name, models` |
| `credentials.describe` | `credentials` | **credentials = 3** (`DEEPSEEK_API_KEY`, `ADAM_API_KEY`, `OPENCODE_GO_API_KEY`) | `configured, source, writable` |

## 3. Cached or recomputed every call? (source evidence)

| endpoint | verdict | evidence |
|---|---|---|
| `settings.describe` | **RECOMPUTED every call** (no host-side memo of the describe result) | handler rebuilds the whole view per request: `dsh-host-apiproxy/lib/index.js:3476-3483`; the registry maps **all** registrations per call and calls `registration.schema.toJSON()` (`dsh-settings/lib/index.js:364`), `structuredClone(base)` (`:360`), `structuredClone(user)` (`:361`) and a recursive `redactSecrets(...)` walk over value/base/user (`:373-378`). No cache object exists in that path. |
| `settings.describe` — what is *not* recomputed | resolved per-namespace values are **precomputed at registration** and deep-frozen | `resolved: deepFreeze(this.resolve(schema, options?.base, this.section(ns), options?.validate))` — `dsh-settings/lib/index.js:319`. So no schema parse/validation per call; the per-call cost is JSON-schema serialization + clones + redaction. |
| `settings.describe` — mtime/rev cache? | **yes, but only for the settings *document*, and only watcher-driven; it is NOT a cache of the RPC result** | `dsh-settings-file/lib/index.js:79-83` ("Raw text of the last successfully parsed or persisted document", self-write suppression) and `:244-259` `reconcileFromDisk()` returns early when `text === this.text`. `describe()` never reads the file — it reads the in-memory registry — so **an unchanged `settings.yaml` mtime saves nothing on the RPC path**. `revision` (`dsh-settings/lib/index.js:511-520`) is a write counter echoed to the client; the client-side mirror keys its own re-render on it, the host does not memo on it. |
| `pluginInventory/list` | **RECOMPUTED every call — and the source says so on purpose** | "Read the Loader directly on every call. Cordis's internal plugin/status events already maintain Entry.fiber and Fiber.state, so a second cache would only add another lifecycle truth to keep synchronized." — `dsh-host-plugin-inventory/lib/index.js:96-99`; loop over `this.ctx.loader.entries()` at `:102-110`. Cost is an O(entries) projection, no I/O. |
| `llm.providers` | **RECOMPUTED every call, trivially cheap** | `dsh-host-apiproxy/lib/index.js:3570-3593` calls `ctx.llm.listProviders()` + `ctx.llm.listConfigurableProviders()`, each of which rebuilds a detached array per call (`dsh-llm/lib/index.js:1240-1243`, `:1299-1305`). No TTL/memo. |
| `llm.models` | **RECOMPUTED every call at catalog level; one layer below is memoized** | `dsh-host-apiproxy/lib/index.js:3595-3596` → `buildModelCatalog` (`:1010-1052`): for every provider it calls `listModels` **and** `resolveModelInfo` per model (69 models here), rebuilding arrays. Adapter level: deepseek adapter re-maps settings options per call (`dsh-llm-deepseek/lib/index.js:1484-1486`), while **pi-ai memoizes its snapshot by config identity** — `if (this.snapshot?.profiles === profiles) return this.snapshot` (`dsh-llm-pi-ai/lib/index.js:1627-1637`). So the catalog response is never served from a cache; only the underlying pi-ai model resolution is. |
| `credentials.describe` | **RECOMPUTED every call** | `Promise.all(request.payload.refs.map(...))` → one `credentials.describe(ref)` lookup per ref, no memo — `dsh-host-apiproxy/lib/index.js:3525-3537`. |

## 4. Is the first call more expensive than subsequent ones?

**No host-side first-call penalty was observed, and none is possible from the code**: there is
no describe/list/result cache to fill in §3 — every call does the full work.

* First measured rep (fresh curl process **and** fresh TCP socket) vs later reps: `settings.describe` run1 rep1 = 3.55 ms vs run1 median 16.11 ms (rep1 *faster* than median); in run2 the first-5 vs last-5 medians were 8.53 vs 51.17 ms (later reps slower — i.e. time-ordered ambient drift, not warm-up). Across endpoints the ordering effect is inconsistent in both directions → no warm-up signature.
* Keep-alive phase: the one fresh-socket request per endpoint was 89.72 / 1.30 / 0.83 / 1.44 / 0.64 ms for the five endpoints — only `settings.describe` was slow there, and that same endpoint shows 89 ms spikes on reused sockets too (§6), so it is a stall, not a cold-connection cost.
* What *cannot* be measured here and is therefore **INCONCLUSIVE**: "the very first call after a fresh host process". The host has been up 18 minutes and must stay alive, so no cold-process sample exists. Because every call is recomputed (§3), any such difference would have to come from Node/JIT warm-up or lazily-initialised plugin state, not from an application cache.
* An idle-gap test (sleep, then one call) was not run as a discriminator: ambient stall variance (§6) is one to two orders of magnitude larger than any plausible idle/warm-up effect, so it could not have produced a conclusive answer.

## 5. How each endpoint scales with data size, and the observed size here

| endpoint | scaling factor | observed size on this deployment | derived per-unit cost |
|---|---|---|---|
| `settings.describe` | **linear in the number of registered settings namespaces × per-namespace payload** (schema + resolved value + base + user, each cloned and redacted per call) | **20 namespaces, 43,534 bytes**; per-namespace view bytes (sum = 48,213): `llm-pi-ai` 23,155 (schema 10,196 + value 8,396 + user 4,435) — **48 % of all namespace bytes** — then `llm-deepseek` 6,768, `dsh-ssh-gui` 2,741, `dsh-workerspace` 2,617, … `agent-presets` 335 | ≈ 2.4 KB/namespace and 1.96 ms/20 ns = **≈0.1 ms per namespace** while the loop is free. Every plugin that registers a fat schema (a pi-ai-sized namespace) adds ~1 KB+ of schema JSON and proportional per-call work. |
| `pluginInventory/list` | **linear in Cordis Loader entries** (one projection object per non-group entry) | **177 entries, 21,720 bytes** | ≈ 123 B and ≈ 0.9 ms/177 entries ≈ **0.005 ms per entry**. Grows with every installed plugin/module — this deployment has a large plugin set. |
| `llm.providers` | **linear in declared configurable providers + registered adapters** | **39 providers (3 active), 6,119 bytes** | ≈ 157 B/provider, ≈ 0.02 ms/provider (sub-ms total). |
| `llm.models` | **linear in providers × models per provider** (one `resolveModelInfo` per model) | **3 groups / 69 models, 6,405 bytes** | ≈ 93 B/model, ≈ 0.02 ms/model. The `adam` provider alone contributes 50 models. |
| `credentials.describe` | **linear in the number of refs in the request** (`refs`, schema max 64) | **3 refs, 298 bytes** | ≈ 100 B/ref, ≈ 0.3 ms/ref; a full 64-ref call would be ~6.4 KB and ~20 ms of otherwise-trivial work. |

## 6. The real finding: the host event loop, not the RPC payload

**Concurrency probe (width = 4 identical concurrent requests, 15 reps each; ms per request / burst wall / intra-burst spread):**

| endpoint fired 4× concurrently | median per request | median burst wall | median spread inside a burst |
|---|---|---|---|
| `settings.describe` | 28.20 | 29.13 | 4.89 |
| `llm.providers` | 34.56 | 34.98 | 0.29 |
| `credentials.describe` (3 refs) | 38.26 | 38.68 | 0.31 |
| `credentials.describe` (**0 refs — no-op control**) | **25.77** | **26.29** | **0.22** |
| `pluginInventory/list` | 7.55 | 8.24 | 1.17 |

**Mixed first-open burst** (the 4 settings RPCs fired concurrently, exactly as the browser does; 20 reps):
median wall **30.84 ms**, min 3.82, max 74.58. Per-endpoint medians are *indistinguishable*:
`settings.describe` 29.49, `pluginInventory.list` 30.50, `llm.providers` 29.48,
`credentials.describe` 29.74 — including the 298-byte no-op-ish call.

**Heartbeat probe** — the cheapest possible read RPC (`credentials.describe` with `refs: []`,
which returns `{credentials:{}}`) issued back-to-back on one socket for 20 s:

| window | samples | p50 | p90 | p99 | max | % > 20 ms |
|---|---|---|---|---|---|---|
| 10:18 (fast) | **5,027** in 20 s | **0.261 ms** | 8.51 | 53.14 | 641.50 | 5.7 % (183 stall episodes) |
| 10:19 (slow) | **138** in 20 s | **137.99 ms** | 254.49 | 513.51 | 517.79 | 98.6 % |

Interleaved ambient probe (120 rounds, control = no-op `credentials.describe`):
control width 1 p50 **25.91** / p90 55.12 / max 132.53 ms; control width 4 p50 6.14 ms;
`settings.describe` width 4 p50 6.77 ms — **the heavy RPC and the no-op are statistically
indistinguishable**, and 103/120 of the *single* no-op calls exceeded 10 ms.

Interpretation (conservative): the settings RPCs' own host work is **sub-2 ms** (keep-alive p25
column in §2, and the 0.261 ms no-op p50). The tens-to-hundreds of milliseconds that a first
settings open actually pays are **host event-loop unavailability that hits every request equally,
regardless of endpoint or payload size** — the 298-byte no-op call is delayed by exactly as much
as the 43 KB `settings.describe` call. Whatever is occupying the loop is external to these RPCs
(observed: the loop answered 250 req/s in one window and 7 req/s twenty seconds later, while
`load average` on 32 CPUs moved only 3.1 → 5.8; the `dsh-usage` ingest timer is off).

Client-side attribution was ruled out as far as possible without touching the host: in the
separate-process **curl** runs the delay sits almost entirely in `time_starttransfer`
(TTFB), not in local process/connection setup — median TTFB 27.35 ms against median
`time_connect` 0.11 ms and `time_pretransfer` 0.15 ms for the no-op `credentials.describe`
(TTFB max 268.59 ms vs total max 268.66 ms). curl had already sent the bytes and was waiting for
the first response byte, so the wait is on the server side (or the server process being
descheduled), not in the measuring client.

Ambient probe raw: `raw-reps-ambient.jsonl`; heartbeat raw: `raw-heartbeat-run1.jsonl` (fast),
`raw-heartbeat.jsonl` (slow).

## 7. Verdict — most likely first-open host bottleneck

1. **Primary host bottleneck: event-loop stall, not any single RPC.** No settings RPC is
   intrinsically expensive (< 2 ms median with the loop free, 0.7–2.0 ms across all five), yet a
   first open can cost 30–75 ms (mixed-burst median 30.84 ms, max 74.58 ms) and individual calls
   were observed at 113–269 ms. The no-op control proves the delay is not attributable to the
   settings payload.
2. **Among the RPCs, `settings.describe` is the most expensive host-side call and the only one
   with a plausibly large and growing cost**: 43,534 bytes / 20 namespaces, recomputed on every
   call with `schema.toJSON()` + 2 × `structuredClone` + a recursive redaction walk per namespace,
   ≈0.1 ms per namespace while the loop is free, dominated (48 %) by the `llm-pi-ai` namespace.
   It is also the one call that runs on *every* settings open (the mirror's `ensure()`), whereas
   `pluginInventory/list` is lazy (plugins tab only) and `credentials.describe` needs refs.
3. **`pluginInventory/list` is the cheapest of the three requested endpoints** (0.92 ms / 21,720 B /
   177 entries) and is not on the critical path unless the 插件 tab renders; it scales with the
   number of installed plugins, so a much larger plugin set would grow it linearly, but at 177
   entries it is not a bottleneck.
4. Therefore: if the browser-side measurements show the lag is *not* explained by rendering, then
   the host contribution on this box is dominated by loop stalls; the only RPC-level lever worth
   optimising is `settings.describe` (memoize per `revision`, or stop re-serializing every
   namespace schema / cloning+redacting base+user on every call).

## 8. Explicitly INCONCLUSIVE

* **`dsh-api-settings-controller` and `dsh-api-workspace-controller` mounts: INCONCLUSIVE / not
  applicable.** Both packages are broken symlinks in the live profile and missing from the
  installed bundle; there is no `/settings` mount (POST → 405 from the SPA fallback, GET → 404).
  No endpoint under those packages could be probed because none is served. The live settings
  surface is the API-proxy `/api/<method>` route table instead (measured above).
* **Cold-process first call: INCONCLUSIVE.** Cannot be measured without restarting/stalling the
  host (forbidden); §4 explains why the available repeated-call data shows no warm-up effect.
* **Idle-gap effect: INCONCLUSIVE by construction** — ambient stall variance is 1–2 orders of
  magnitude larger than any plausible idle effect on this host.
* **Browser-side cost and rendering: out of scope** (owner: the other probe).
