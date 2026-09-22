# Static SVG / per-item geometry analysis — DSH Web GUI settings open + home view

Scope: every reachable code path from **settings panel open** and the **home view** that emits
SVG geometry or table rows proportional to data volume (potential large-N / super-linear first-open cost).

Read-only analysis. No product file was modified. All paths absolute.

**Headline:** exactly **one** client bundle in the whole deployment emits raw SVG geometry
(`<rect>/<circle>/<path>`) — `@local/dsh-usage/lib/client.js` (verified by exhaustive, symlink-aware
sweep of **all 52** client bundles in `profiles/node_modules`). It is also the only bundle containing
an inline `jsx("svg")`. Every other per-item graphic is a primitives icon component, each of which is
itself one inline `<svg>`.
**No code path on this deployment is super-linear.** Everything is linear-or-bounded; the risk is
large-N constants, not asymptotic blowup.

---

## Findings

| path:line | construct | data source | worst-case N on THIS deployment | element count | complexity |
|---|---|---|---|---|---|
| `@local/dsh-usage/lib/client.js:692` | `const rects = grid.cells.map((c) => {` — emits `<g>` (:694) + `<title>` (:695) + `<rect>` (:696) = **3 SVG nodes per cell** | `rpc.call(CHANNEL,"heatmap",{year})` (:912) → host `queryHeatmap` (db.js:579) → `usage_daily` GROUP BY day | **33** distinct days (2026-08-10…2026-09-21) → grid **49** cells | **147 SVG nodes** + ≤12 month `<text>` (:700) = **159** | **Linear in days-with-data; bounded per year.** Full-year worst case: 371 cells → 1113 nodes (+12) = **1125**. Not super-linear. |
| `@local/dsh-usage/lib/client.js:325` | `for (let index = 0; index < weeks * 7; index += 1)` inside `heatmapGrid` (:289), **called in the render body at :676 with no `useMemo`** | same as above | 49 cells | recomputes O(cells) **on every render**, incl. every tooltip `setTip` mousemove (:684/:724) | **O(cells) per mousemove** — re-derivation, not asymptotic |
| `@local/dsh-usage/lib/client.js:610` | `rects.map((r, i) => react.createElement("rect", {` — **bar mode**: one `<rect>` per bucket | `timeseries` (`granularity:"hour"`, :920) / daily range | **24** buckets (default `trendGrain="hour"`, :816); day-range 7/30/90 | 24 `<rect>` + ≤4 tick `<text>` (:621) | **Linear, hard-capped at 2200** via `fillBuckets` cap (:211, loops :228/:236) |
| `@local/dsh-usage/lib/client.js:632,633,638` | **area mode** (default, `chartMode` init `"area"` :811): 2–3 `<path>` total | same | — | **3 paths**, bounded | **Constant** |
| `@local/dsh-usage/lib/client.js:745` | `const body = rows.map((row, index) =>` + `<td>` per column (:750) | `byModel`/`byProject`/`byDay` (:1034/:1049/:1064) small; **`sessions` `limit: 200`** (:950; host clamp ≤500, db.js:805) | 2570 distinct `session_id` in `usage_events` → **clamped to 200 rows** | ~200 `<tr>` × 7 `<td>` ≈ **1400 cells** | **Linear, bounded at 200** |
| `@deepseek-ai/dsh-client-ui-settings-plugin-inventory/lib/client.js:150` | `children: filteredEntries.map((entry) => {` — per entry: `<li>` (:156) + status-dot `<span>` (:176) + **`IconChevronDownOutline16/14` inline `<svg>` (:188)** | host `PluginInventoryGateway.list()` (`dsh-host-plugin-inventory/lib/index.js:102`) = **all non-group Loader entries** | **149** distinct loader entry ids (base 78 + web-app 57 + user patch 14; no `group:` rows anywhere) | **149 `<li>` rows + 149 inline `<svg>` chevrons** + ~450 spans ≈ **750 nodes** | **Linear in plugin count; bounded by deployment tree** (not data-driven) |
| `@deepseek-ai/dsh-client-ui-settings-plugins/lib/client.js:446` | `children: rows.map((row, index) => {` — one `<button>` per plugins tab (no SVG) | `useTabs` registry | ~10 tab rows | ~10 buttons | **Linear, tiny** |
| `@deepseek-ai/dsh-client-ui-settings-plugin-inventory/lib/client.js:117` | `IconSearchOutline16` — one static search icon | — | 1 | 1 SVG | **Constant** |
| `@deepseek-ai/dsh-client-ui-workspace/lib/client.js:1404` | `(… group.sessions : group.sessions.slice(0, COLLAPSED_SESSION_LIMIT)).map((node) => {` — collapsed tree, `COLLAPSED_SESSION_LIMIT = 5` (:1039) | on-disk store `/home/CNS2026495165/.dsh/sessions/` | **960** session files / **19** groups → collapsed Σ min(5,n) = **62 rows** | 62 rows × (1 ellipsis `<svg>` :780 + state dots :746) ≈ **124+ SVG** | **Linear; collapsed path bounded at 5×groups** |
| `@deepseek-ai/dsh-client-ui-workspace/lib/client.js:1538` | `rows.map((node) => {` — **flat list**, no slice (`flatList` class :1532) | same | **960** rows (largest group 397) | 960 rows ≈ **1920+ SVG nodes** | **Linear, effectively unbounded by session history** |
| `/home/CNS2026495165/.dsh/profiles/node_modules/@deepseek-ai/dsh-chunked-list/lib/client.js` | **PATH DOES NOT EXIST** | — | — | — | **Absent from this deployment** — package missing from `profiles/node_modules` (present only in archived `profiles-archive/web2-20260915-105429`), absent from `__DSH_BOOT__`, absent from all three bundle patch files. **No chunked-list render path is reachable.** |

---

## IntersectionObserver gate verification (ANSWER: the gate is REAL but POLL-ONLY)

The heatmap is **not** gated by visibility. The gate exists, is wired correctly, and is consumed
in exactly one place — the poll timer.

**Gate creation** — `@local/dsh-usage/lib/client.js`
- `:788` `const attachCardRef = react.useCallback((node) => {` — ref callback, runs on card mount
- `:799` `const observer = new IntersectionObserver(`
- `:805` `{ threshold: 0 },`
- `:807` `observer.observe(node);`
- `:800-804` callback → `setPollVisibleRef.current(Boolean(entry.isIntersecting))`
- Attached to the card root: `:1124` `react.createElement("div", { className: "du_root", ref: attachCardRef }, …)`

**Gate consumption** — exactly one site:
- `:983` `if (!pollVisible || (typeof document !== "undefined" && document.hidden)) return;`
  — inside the `setInterval` effect `:976-992`, i.e. it only prevents the **60 s re-poll**.

**Why it does not bound first-open cost:**
1. `:971-975` `react.useEffect(() => { void loadAll(); void loadSessions(); void loadStatus(); }, […])`
   — the initial load is **unconditional**, by explicit design: comment `:981-982`
   *"Only the timer is gated; the initial load and the manual refresh stay unconditional."*
2. `:1185` `react.createElement(HeatmapChart, { days: heatmap, … })` — **rendered unconditionally**.
   Not wrapped in any `pollVisible ? … : …`.
3. `:1182` `react.createElement(TrendChart, …)` and `:1188` `tabBody` — likewise unconditional.
4. `pollVisible` is referenced at only two line numbers in the entire file: **`:983`** and **`:992`**
   (verified by grep). It never reaches the render path.

**Conclusion:** the prior fix stops background polling for an off-screen card, but an off-screen (or
never-viewed) usage card still performs its full first render — 147 heatmap SVG nodes, the trend
chart, and the tables — the moment it is mounted.

---

## The mount amplifier (why all of the above happen together)

`@deepseek-ai/dsh-client-ui-settings-plugins/lib/client.js:403`

```js
children: namespaces.map((ns) => (0, react_jsx_runtime.jsx)(react.Fragment, { children: renderSlot("settings.plugin.item", {}, { entryKey: ns }) }, ns))
```

`ConfigurablePluginsTab` renders the `settings.plugin.item` slot for **every** settings namespace at
once — no lazy mount, no per-card visibility gate, no virtualization. The usage card registers itself
into exactly that slot (`@local/dsh-usage/lib/client.js:1232`, `key: "dsh-usage"` at `:1234`).

Consequence: **opening the settings panel mounts every plugin card simultaneously**, and the usage
card's mount effect (`:971-975`) immediately fires **7 host RPCs** — `summary`, `timeseries` (day),
`heatmap`, `byModel`, `byProject`, `byDay`, `timeseries` (hourly) (`:910-921`) — plus full SVG build.

By contrast, the sibling panel at `:489` *does* bound itself:
`rows.filter((row) => row.id === active || visitedIds.has(row.id))` — only the active + already-visited
tabs render. `ConfigurablePluginsTab` has no equivalent guard.

---

## What to measure next

Ordered by expected yield. Every step is read-only.

1. **Per-card mount cost on settings open (highest yield).**
   Record a DevTools Performance trace of one settings open and read, per plugin card, its
   self-time and DOM-node delta. Confirm whether `ConfigurablePluginsTab`'s all-namespace fan-out
   (`settings-plugins/lib/client.js:403`) dominates, then test the one-line hypothesis: gate it with the
   same `active || visited` filter used at `:489`. If mount count drops from ~all-namespaces to 1,
   this is the fix.

2. **Host event-loop cost of the 7 parallel RPCs.** The usage card's `loadAll` fans out 7 requests on
   mount. The `heatmap` path has a documented 289 ms → 0.05 ms history (`db.js:548-574`), and
   `sessions` (`limit: 200`) still joins over **118,869** `usage_events` rows with **2,570** distinct
   sessions. Time each endpoint individually, host-side; the client SVG is cheap (~159 nodes) but the
   *host* work behind it may not be.

3. **Confirm the IO gate's true scope under instrumentation.** Log `pollVisible` transitions vs.
   `loadAll` invocations on first open. Expectation from static reading: `loadAll` fires once
   regardless of visibility, then the timer is suppressed while off-screen (`:983`). Verify, then
   decide whether a *render* gate (not just a poll gate) is warranted at `:1182/:1185/:1188`.

4. **Quantify the flat session list.** `client.js:1538` renders all **960** rows (~1920+ SVG) with no
   slice, while `:1404` caps at 5/group (**62** rows). Determine which path the home view actually
   takes; if the flat list is live, that is the single largest node count in the UI and the strongest
   candidate for virtualization.

5. **Heatmap re-render on hover.** Instrument render counts for `HeatmapChart` while moving the mouse:
   `heatmapGrid` is called in the render body (`:676`) with no `useMemo`, so each `setTip` mousemove
   re-runs the sort + 49-cell build + 147-element reconcile. Cheap today at N=33 days, but it scales
   linearly with days-with-data and re-fires on every pointer move. A `useMemo` keyed on
   `[props.days, levels]` would remove it.

6. **Re-derive plugin count if the deployment tree changes.** The **149** figure is derived from the
   three composed patch layers (`dsh-base` 78 inserts + `dsh-web-app` 57 inserts + `profiles/web/cordis.patch.yml`
   14 inserts = 149 distinct ids, zero `group:` rows). Confirm against the live UI via the
   `data-plugin-count` attribute rendered at `plugin-inventory/lib/client.js:136` — that attribute
   reports `filteredEntries.length` directly.

---

## Measurement provenance

- **Usage heatmap N** — read from a **copy** of `/home/CNS2026495165/.dsh/storages/usage/usage.db`
  (`cp` → `sqlite3` module, `mode=ro`; the live DB was never opened for write). Copy kept at
  `./usage-ro.db` in this directory. `usage_daily`: 326 rows, `day` range 2026-08-10…2026-09-21,
  **33 distinct days**. `usage_events`: **118,869** rows; **2,570** distinct `session_id`.
- **Grid geometry** — reproduced the exact `heatmapGrid` arithmetic (`client.js:296-360`) in Python:
  JS `getDay()` Sunday=0, `start` snapped back to week boundary, `weeks = ceil(daysTotal/7)`,
  `cells = weeks*7`. 33 days → firstDow=1, start=2026-08-09, daysTotal=44, **weeks=7, cells=49**.
- **Plugin count** — parsed the three composed `cordis.patch.yml` layers for `insert:` entries with a
  `name:` and took the union of ids: 78 + 57 + 14 = **149**, zero collisions, zero `group:` rows.
- **Session count** — `os.walk` over `/home/CNS2026495165/.dsh/sessions/`: **960** files across **19**
  group directories; collapsed row count Σ min(5, per-group) = **62**.
- **Boot payload** — `curl -s http://127.0.0.1:3080/` → parsed `globalThis["__DSH_BOOT__"]`:
  **50 client plugin entries** (11 `immediately:true`, 39 lazy). Node 1:1 with `"id":"` occurrences.
- **SVG emitter sweep** — enumerated **all 52** client bundles via shell globs
  (`*/lib/client.js`, `*/*/lib/client.js`), then grepped each for
  `createElement("rect"|"circle"|"path")` / `jsx("rect"|"circle"|"path")` and for
  `jsx("svg")`/`createElement("svg")`. **Only** `@local/dsh-usage/lib/client.js` matched both
  (2 `svg` emission sites), i.e. it is the sole raw-SVG geometry generator.
  *Method note:* a `find`-based sweep under-reports here (9 vs 52 bundles) because pnpm installs
  packages as **symlinks** and `find` does not descend into them without `-L`; globs follow them.
  The glob figure (52) is consistent with the 50 `__DSH_BOOT__` entries.
- **Icon confirmation** — `IconChevronDownOutline14` → `jsx("svg", {…})` at
  `…/dsh-client-ui-primitives/lib/index.js:285` (resolved under
  `@local/dsh-pptmaster/node_modules/`).

### Two counts that look alarming but are benign
- `usage_daily` has **326 rows for a 44-day span** (~7 rows/day) — that is the raw
  `(day, data_source, model, project)` grain. `queryHeatmap` `GROUP BY day` collapses it before the
  client sees it; the heatmap receives **33** rows, not 326.
- `usage_events` (**118,869** rows) never reaches the client as rows — it is aggregate input only.
