# Firefox 155.0.1 Glean gfx.\* / a11y.\* metric semantics, units, buckets and time dimension

Read-only research. Profile: `~/snap/firefox/common/.mozilla/firefox/g05ps3km.default` (Firefox 155.0.1, snap, release channel).
No files outside `.workspace/lag-fix/incident2/firefox-telemetry/subagent-units/` were written. Firefox was not started; nothing in the profile was modified.

**Sources actually reachable from this machine (primary Mozilla sources):**
- `https://raw.githubusercontent.com/mozilla/gecko-dev/master/gfx/metrics.yaml` — Firefox's Glean `gfx.*` metric definitions (this is the authoritative file; it is NOT in `toolkit/components/telemetry/metrics.yaml` despite the namespace).
- `https://raw.githubusercontent.com/mozilla/gecko-dev/master/accessible/metrics.yaml` — `a11y.*`.
- `https://raw.githubusercontent.com/mozilla/gecko-dev/master/toolkit/components/telemetry/Histograms.json` — legacy Telemetry definitions (the `telemetry_mirror` targets).
- `https://raw.githubusercontent.com/mozilla/glean/main/docs/user/reference/metrics/timing_distribution.md` and `.../custom_distribution.md` — Glean SDK metric-type specs.
- `https://raw.githubusercontent.com/mozilla/glean/main/glean-core/src/histogram/{mod,functional,exponential,linear}.rs` — bucketing implementations.
- Local evidence: `data.safe.snapshot.bin` (byte-identical copy of the live store, `md5 591b08842411cab396046b63439eb994`, 442462 bytes), `legacy-gfx-perping.json`, `legacy-gfx-timeline.csv`.

`searchfox.org` returned HTTP 301 and `hg.mozilla.org` HTTP 302 to this client (no working HTML search); all definitions below were fetched as raw files from mozilla/gecko-dev and mozilla/glean, which ARE `searchfox`/`hg.mozilla.org` mirrors of the same revisions. `web_search` was unavailable (backend rejected the request: "An active OpenCode Go subscription is required"), so no search-engine corroboration is included.

---

## 1. Unit table

Legend for "bucket semantics": `TD` = Glean `timing_distribution`; `CD` = Glean `custom_distribution`; the exact definition is in section 2.

| metric | unit | verdict | type (Glean) | bucket semantics | source URL(s) |
|---|---|---|---|---|---|
| `gfx.checkerboard.severity` | **unitless / opaque** (explicitly "This doesn't have units"); larger = worse | **CONFIRMED** | `custom_distribution`, `range_max: 1073741824`, `bucket_count: 50`, `histogram_type: exponential` | CD: natural-log exponential bucket limits from `range_min` (default 0 → an extra underflow bucket at 0) to `range_max`, 50 buckets. Legacy mirror `CHECKERBOARD_SEVERITY`: `exponential`, `n_buckets 50`, `high 1073741824`. **Not** a 0–N severity level; it is a bucket minimum value. | gfx/metrics.yaml L799-823; Histograms.json `CHECKERBOARD_SEVERITY` |
| `gfx.checkerboard.duration` | **milliseconds** | **CONFIRMED** | `timing_distribution`, `time_unit: millisecond` | TD: functional bucketing, **8 buckets per power of 2**, index `⌊8·log₂(x)⌋`, x in **nanoseconds**; stored/sent in ns. Legacy mirror `CHECKERBOARD_DURATION`: `exponential`, 50 buckets, `high 100000` (ms). | gfx/metrics.yaml L725-746; Histograms.json `CHECKERBOARD_DURATION` |
| `gfx.checkerboard.potential_duration` | **milliseconds** | **CONFIRMED** | `timing_distribution`, `time_unit: millisecond` | as above; legacy `CHECKERBOARD_POTENTIAL_DURATION` `exponential` 50 buckets `high 1000000` | gfx/metrics.yaml L772-797; Histograms.json |
| `gfx.checkerboard.peak_pixel_count` | **CSS pixels** | **CONFIRMED** | `custom_distribution`, `range_max: 66355200`, `bucket_count: 50`, `exponential`, `unit: Pixels` | CD natural-log exponential 50 buckets, 0.66 GB… no: 6.6e7 px (a 4k display at max APZ zoom). Legacy mirror `CHECKERBOARD_PEAK` `exponential` 50 `high 66355200`. | gfx/metrics.yaml L748-770; Histograms.json `CHECKERBOARD_PEAK` |
| `gfx.composite_time` | **milliseconds** | **CONFIRMED** | `timing_distribution`, `time_unit: millisecond` | TD 8-per-power-of-2 ns buckets. Legacy mirror `COMPOSITE_TIME` `exponential` 50 `high 1000` ("Composite times in milliseconds"). | gfx/metrics.yaml L331-354; Histograms.json `COMPOSITE_TIME` |
| `gfx.composite_frame_roundtrip_time` | **milliseconds** | **CONFIRMED** | `timing_distribution`, `time_unit: millisecond` | TD as above. Legacy mirror `COMPOSITE_FRAME_ROUNDTRIP_TIME` `exponential` 50 `high 1000`. | gfx/metrics.yaml L465-481; Histograms.json |
| `gfx.scroll_present_latency` | **milliseconds** | **CONFIRMED** | `timing_distribution`, `time_unit: millisecond` | TD as above. Legacy mirror `SCROLL_PRESENT_LATENCY` `exponential` **100** buckets, `low 1`, `high 20000` ms. | gfx/metrics.yaml L356-373; Histograms.json |
| `gfx.content.frame_time.from_vsync` | **percent of a vsync interval** (not ms) | **CONFIRMED** | `custom_distribution`, `range_min: 8`, `range_max: 792`, `bucket_count: 100`, `histogram_type: linear`, `unit: Percentage of vsync interval` | CD **linear** 100 buckets from 8 to 792 (= 8..792 % of one vsync). Legacy mirror `CONTENT_FRAME_TIME_VSYNC` `linear` 100 `low 8` `high 792`. | gfx/metrics.yaml L929-950; Histograms.json |
| `gfx.content.frame_time.from_paint` | **percent of a vsync interval** | **CONFIRMED** | `custom_distribution`, `range_max: 5000`, `bucket_count: 50`, `exponential`, `unit: Percentage of vsync interval` | CD natural-log exponential 50 buckets, 0..5000 (% of vsync). Legacy mirror `CONTENT_FRAME_TIME` `exponential` 50 `high 5000`. | gfx/metrics.yaml L906-927; Histograms.json |
| `gfx.content.frame_time.with_svg` | **percent of a vsync interval** | **CONFIRMED** | `custom_distribution`, `range_max: 5000`, `bucket_count: 50`, `exponential` | same as `from_paint`; mirror `CONTENT_FRAME_TIME_WITH_SVG` | gfx/metrics.yaml L952-973 |
| `gfx.content.frame_time.without_resource_upload` | **percent of a vsync interval** | **CONFIRMED** | `custom_distribution`, `range_max: 5000`, `bucket_count: 50`, `exponential` | same; mirror `CONTENT_FRAME_TIME_WITHOUT_RESOURCE_UPLOAD` | gfx/metrics.yaml L975-995 |
| `gfx.content.paint_time` | **milliseconds** | **CONFIRMED** | `timing_distribution`, `time_unit: millisecond` | TD ns 8-per-power-of-2. Mirror `CONTENT_PAINT_TIME` `exponential` 50 `high 1000` ms. | gfx/metrics.yaml L1045-1065; Histograms.json |
| `gfx.content.full_paint_time` | **milliseconds** | **CONFIRMED** | `timing_distribution`, `time_unit: millisecond` | TD as above. Mirror `CONTENT_FULL_PAINT_TIME` `exponential` 50 `high 1000` ms. | gfx/metrics.yaml L1067-1087; Histograms.json |
| `gfx.skipped_composites` | **count of occurrences** (unitless integer; 1 unit = one skipped composite) | **CONFIRMED** | **`counter`** — *not* a distribution. In this store it is the one metric of your list with subtag `0x01` and a plain integer body, not a bucket array. | No buckets. Legacy scalar mirror `GFX_SKIPPED_COMPOSITES`. | gfx/metrics.yaml L375-390 |
| `a11y.tree_update_timing` | **milliseconds** | **CONFIRMED** | `timing_distribution`, `time_unit: millisecond` | TD ns 8-per-power-of-2. Mirror `A11Y_TREE_UPDATE_TIMING_MS` `exponential` 50 `high 60000` ms. | accessible/metrics.yaml L179-194; Histograms.json |

### Type summary
- **`timing_distribution` (7):** `checkerboard.duration`, `checkerboard.potential_duration`, `composite_time`, `composite_frame_roundtrip_time`, `scroll_present_latency`, `content.paint_time`, `content.full_paint_time`, `a11y.tree_update_timing` (8, counting a11y).
- **`custom_distribution` (5):** `checkerboard.severity`, `checkerboard.peak_pixel_count`, `content.frame_time.from_paint`, `content.frame_time.with_svg`, `content.frame_time.without_resource_upload`, `content.frame_time.from_vsync` (6).
- **`counter` (1):** `gfx.skipped_composites`.
- **Not present in this store as separate records** (but related): `gfx.content.frame_time.reason` is a `labeled_counter` with labels `on_time, no_vsync, missed_composite, slow_composite, missed_composite_mid, missed_composite_long, missed_composite_low, no_vsync_no_id` — it counts *why* `from_paint` recorded a slow (>200 ms) sample, and appears in the store as `metrics#gfx.content.frame_time.reason/<label>`.

## 2. Bucket semantics, exactly as Mozilla defines them

- **`timing_distribution`** (Glean SDK spec): "recorded in a histogram where the buckets have an exponential distribution, specifically with **8 buckets for every power of 2**. That is, the function from a value x to a bucket index is `⌊8·log₂(x)⌋`." Timings are "**always stored and sent in the payload as nanoseconds**"; `time_unit` only sets the recorded min/max range (`millisecond` → `1 ms ≤ x ≤ ~19 years`). Source: `docs/user/reference/metrics/timing_distribution.md`, and the implementation in `glean-core/src/histogram/functional.rs` (`exponent = log_base^(1/buckets_per_magnitude)`, `bucket_min = exponent^index`, `index = ⌊log_exponent(sample+1)⌋`; instantiated as `functional(2.0, 8.0)`).
- **`custom_distribution`**: `range_min` (min of first bucket, default 0), `range_max` (min of **last** bucket), `bucket_count`, and `histogram_type`:
  - `linear` — evenly spaced.
  - `exponential` — from `glean-core/src/histogram/exponential.rs`, bucket limits are computed by walking the natural log from `min` to `max` in `bucket_count` steps, and **there is always an added underflow bucket for values `< min`** (specifically `ranges.push(0)` first). The final bucket is the overflow bucket: "the final bucket, regardless of width, represents the overflow bucket to hold any values beyond the maximum". So `bucket_count` counts the top bucket, and the stored underflow bucket at 0 makes the on-disk entry count one larger.
  - `unit` for `custom_distribution` is **documentation-only**: "does not affect data collection".
- **`counter`**: a single monotonically increasing integer; no buckets.

## 3. User-facing meaning (from the definitions' own descriptions)

| metric | what it means |
|---|---|
| `checkerboard.*` | Checkerboarding = painting has not kept up with async pan/zoom, so the compositor shows a checkerboard pattern (in practice the background colour) instead of page content. `severity` = an opaque "how bad was this episode" number (larger = worse); `duration` = how long one checkerboard event lasted; `potential_duration` = total time that could reasonably have checkerboarded (union of "was actually checkerboarding" and "APZC was actively transforming content in the compositor"); `peak_pixel_count` = peak number of CSS pixels that were checkerboarded during one event. |
| `composite_time` | Time taken to composite one frame (WebRender: from `WebRenderBridgeParent::CompositeToTarget()` until the render thread finished the frame in `RenderThread::HandleFrameOneDoc()`). |
| `composite_frame_roundtrip_time` | Time from vsync to finishing a composite, in ms. |
| `scroll_present_latency` | Time between receiving a scroll event on the event loop and compositing its result onto the screen. This is exactly "delay between scroll input and presented frame". |
| `content.frame_time.*` | Time from beginning a paint in the content process until that frame is presented in the compositor, expressed as a **percentage of a vsync interval** (so 100 = one full vsync; `from_vsync` measures from the vsync that started the paint). `with_svg` restricts to frames containing an SVG drawn by WebRender; `without_resource_upload` excludes WebRender resource-upload time. |
| `content.paint_time` | Time in the main-thread paint pipeline: WebRender → display list building + WR display list building; non-WR → DLB + layer building (+ rasterization if OMTP disabled). |
| `content.full_paint_time` | Paint pipeline until ready for composition: WR → `paint_time` + scene building; non-WR → `paint_time` + rasterization if OMTP enabled. |
| `gfx.skipped_composites` | Number of skipped composites, "happening when rendering is too slow to keep up with content". |
| `a11y.tree_update_timing` | Time taken to update the accessibility tree (ms). |
| `content.frame_time.reason/<label>` | Reason a `from_paint` sample was slow (>200 ms). |

## 4. Cumulative-since-store-creation vs per-session vs per-ping

Mozilla's wording is "**lifetime**", not "cumulative". For a Glean metric the lifetime is `ping` (default), `application`, or `user`.

- **`gfx.skipped_composites`: `counter` with default lifetime → `ping`.** It is a per-ping counter, not a lifetime total. Its only persistence comes from the legacy scalar mirror `GFX_SKIPPED_COMPOSITES`.
- All the `timing_distribution` / `custom_distribution` metrics above: **default lifetime → `ping`.** Only `gfx.feature.webrander`/`gfx.status.compositor`-style string metrics carry explicit `lifetime: application` / `lifetime: user` in `gfx/metrics.yaml`; none of the 15 metrics in your list do.
- Evidence in the store that this is not a store-lifetime total: the store's own start marker for the current Glean measurement window is `glean_internal_info#metrics#start = 2026-09-22T10:05:40.245706411+08:00`, whereas `glean_client_info#first_run_date = 2026-08-10T17:08:42.495881627+08:00`. Whatever the gfx buckets hold, they are bounded by that recent window and cannot be a since-first-run total.
- What *is* cumulative in the store are the Glean-internal bookkeeping scalars, e.g. `glean_internal_info#baseline#sequence`, `glean_internal_info#pageload#sequence`, `glean_internal_info#events#sequence`. These are `application`-lifetime.

**Practical consequence:** the numbers you decoded are only today's window. The store itself states the window's start (`glean_internal_info#metrics#start`, see section 5).

## 5. UNKNOWN / COULD NOT DETERMINE

Honest list — no unit is guessed anywhere.

1. **The bit-level framing of the distribution payloads inside `data.safe.bin` is NOT fully verified.** I proved the record/subtag structure (`[u64 keylen][key][u64 vallen][u8 tag=0x09][u64 paylen][payload]`, payload begins with a subtag) and I proved that `gfx.skipped_composites` is subtag `0x01` (plain counter) while every other metric in your list is `0x02`, `0x03` or `0x0b` (distribution). Beyond that, the `(bucket, count)` entries inside the `0x02/0x03/0x0b` bodies are emitted in a packed form that I could **not** resolve exactly: I found strong signals (e.g. `gfx.checkerboard.duration` body has a leading count field `14`, and one of its stored field values is exactly `1073741824 = 2³⁰`, i.e. a power-of-two nanosecond bucket boundary consistent with the functional `2^⌊i/8⌋` scale, and bodies whose lengths *and* trailing marker equal the declared `bucket_count` of 50 exactly for `checkerboard.severity`, `checkerboard.peak_pixel_count`, `frame_time.from_paint`, `frame_time.with_svg`, `frame_time.without_resource_upload`). But no single `(header, stride)` hypothesis reproduced **all** buckets of all metrics, so **which bucket each count belongs to is UNRESOLVED**. Bucket counts and units themselves are unaffected — they come from the metric definitions, not from my decoding.
   - The only local decoding artifact I stand behind is `gfx.skipped_composites` = a single integer, and the record lengths. See `bucket-verification.txt`, `distribution-decode.txt`, `verify-buckets.py`, `fit-layout.py`.
2. **The exact numeric value of `glean_internal_info#metrics#sequence` is UNCERTAIN.** Raw body at byte offset 2046+ is `00 00 00 2d 00 00 00` → reading the 4 little-endian bytes as a `u32` gives `0x2d000000 = 754974720`, while the existing decoder's `dec_counter` (which reads the *first* 4 bytes) gives `45`. I could not determine which interpretation is the metric's true value, so I do **not** claim "45 metrics pings since store creation" as fact.
3. **The exact send interval of the Glean `metrics` ping in Firefox 155 is NOT pinned down.** I could not retrieve the Firefox-side scheduler constant (`toolkit/components/glean/src/lib.rs` and friends) from this client. So the accumulation window can be bounded (`metrics#start` → **now**) but its exact length cannot be derived from a cited default. **UNCERTAIN.**
4. **`gfx.checkerboard.severity`: the mapping from the opaque severity number to anything physical is UNDEFINED by Mozilla** and remains unknown. It is comparable only with itself (bigger = worse). Do not convert it to ms or pixels.
5. **Whether `content.frame_time.*` percentages are relative to 60 Hz or to the actual current vsync interval is not stated in the definitions** (`range_max 5000` = up to 50× a vsync at 60 Hz). UNKNOWN; treat the unit as "percent of vsync interval" and no more.
6. **`a11y.tree_update_timing` was attributed via the `a11y.*` namespace file `accessible/metrics.yaml`; I did not find a separate "which accessibility tree operation" qualifier** — it is the aggregate accessibility-tree update time, with no sub-labels in this store.
7. **No per-window gfx counters workaround for the GPU-switch question exists** (see section 6) — the legacy gfx histograms simply stop being emitted in main pings 8 days before the switch.

## 6. GPU-switch / time-dimension question

### 6.1 Does the Glean store carry any timestamp or generation information?

**No — not per metric value.** Every timestamp in the store is a *bookkeeping* timestamp for a whole ping or session; there is no per-sample, per-bucket, or per-generation timestamp, and no "generation"/"ping sequence" attached to any gfx bucket.

The complete inventory of time/sequence-bearing records in `data.safe.snapshot.bin` (byte offsets are the record start, i.e. the `u64 keylen`):

| byte offset | key | decoded value |
|---|---|---|
| 604 | `glean_client_info#first_run_date` | `2026-08-10T17:08:42.495881627+08:00` |
| 780 | `glean_internal_info#addons#start` | `2026-09-22T11:18:42.795958828+08:00` |
| **958** | **`glean_internal_info#baseline#start`** | **`2026-09-22T11:23:07.335784911+08:00`** |
| 1566 | `glean_internal_info#events#start` | `2026-09-22T11:18:48.906798413+08:00` |
| 1742 | `glean_internal_info#health#start` | `2026-09-22T10:05:40.464847791+08:00` |
| **2115** | **`glean_internal_info#metrics#start`** | **`2026-09-22T10:05:40.245706411+08:00`** |
| 2224 | `glean_internal_info#mps.last_sent_build` | `20260904071051` |
| 2314 | `glean_internal_info#mps.last_sent_time` | `2026-09-22T10:05:40.241967293+08:00` |
| 2496 | `glean_internal_info#newtab#start` | `2026-09-22T11:03:50.431271302+08:00` |
| 2886 | `glean_internal_info#pageload#start` | `2026-09-22T10:05:40.259844796+08:00` |
| **3070** | **`glean_internal_info#session#id`** | `20dfbf3a-a4fa-4f4e-b08a-fdfd2b8043a6` |
| 3173 | `glean_internal_info#session#inactive_since` | `2026-09-22T10:10:09.126+08:00` |
| 3281 | `glean_internal_info#session#seq` | `0` (`0x06` int, 8-byte LE) |
| **3349** | **`glean_internal_info#session#start_time`** | **`2026-09-22T10:05:40.459+08:00`** |
| 3527 | `glean_internal_info#use-counters#start` | `2026-08-19T09:39:21.773115033+08:00` |
| 888 | `glean_internal_info#baseline#sequence` | `0x9d020000` raw |
| 2046 | `glean_internal_info#metrics#sequence` | `00 00 00 2d 00 00 00` (see UNKNOWN #2) |
| 2816 | `glean_internal_info#pageload#sequence` | raw `00 00 00 2b 00 00 00` |
| 1498 | `glean_internal_info#events#sequence` | raw `00 00 00 fa 00 00 00` |
| 1440 | `glean_internal_info#dirtybit` | `00 00 00 00` (clean — store flushed) |

There is **no** `glean_internal_info#<metric>#sequence` for any gfx metric, **no** per-record timestamp field inside any distribution body, and **no** `gfx` generation counter. `pending_pings/` is empty; `events/pageload` is the only event file.

**Therefore: the counts in `data.safe.bin` cannot be split into before/after any event from the store alone.** The only bound the store gives you is the window start:

> All Glean gfx sample counts currently in the store are from the window beginning
> `glean_internal_info#metrics#start = 2026-09-22 10:05:40 (+08:00)` — i.e. **entirely after** the GPU switch.

That is consistent with the store's own self-description: `metrics#gfx.adapter.primary.vendor_id = 0x1002`, `device_id = 0x13c0`, `driver_vendor = mesa/radeonsi` (AMD), and `glean_internal_info#session#start_time = 2026-09-22T10:05:40.459+08:00` is that same window.

### 6.2 Do the archived main pings carry per-window gfx counters? — YES, but they stop 8 days before the switch

I decoded all 64 archived `*.main.jsonlz4` files (magic `mozLz40\0` + u32 LE size + raw LZ4 block, via the provided `decode-pings.py` logic, copied to `decode-pings.py` here) and dumped `payload.histograms`, `payload.keyedHistograms`, `payload.processes.*.histograms` and `payload.processes.*.scalars`.

- The legacy histograms that **are** the `telemetry_mirror` targets of your Glean metrics are present: `CHECKERBOARD_DURATION`, `CHECKERBOARD_PEAK`, `CHECKERBOARD_POTENTIAL_DURATION`, `CHECKERBOARD_SEVERITY`, `COMPOSITE_TIME`, `COMPOSITE_FRAME_ROUNDTRIP_TIME`, `SCROLL_PRESENT_LATENCY`, `CONTENT_FRAME_TIME`, `CONTENT_FRAME_TIME_VSYNC`, `CONTENT_FRAME_TIME_WITH_SVG`, `CONTENT_PAINT_TIME`, `CONTENT_FULL_PAINT_TIME` (+ `A11Y_TREE_UPDATE_TIMING_MS`).
  **These are per-ping and therefore genuinely splittable** — but only while they were being emitted.
- **They stop, and never come back.** (There are also three isolated empty days on the NVIDIA side, 2026-08-29…08-31, showing the emission is intermittent; the important cutoff is the final one.)
  - **Last main ping carrying any gfx histogram: `1789194251681.b47f0c85-6428` at 2026-09-12 06:24:11 local time, reason `aborted-session`, GPU `0x10de:0x2684/nvidia` — 11 gfx histograms.**
  - **All 14 later main pings (2026-09-12 06:53:14 local → 2026-09-22 02:12:25 local) carry ZERO gfx histograms**, including the 2026-09-20 09:18:43 UTC = **17:18:43 +08:00** `environment-change` ping that records the switch to `0x1002:0x13c0/mesa/radeonsi`.
- So: **the NVIDIA→AMD switch at 2026-09-20 17:18:43 (+08:00) is not bracketed by any legacy gfx histogram data.** There are no "before" gfx counters in the last 8 days, and **no AMD-side legacy gfx histograms at all**. The archived-main-ping route cannot answer the GPU-switch question either.
- The only gfx material that *does* keep appearing in the AMD-era pings is the environment block (`environment.system.gfx.adapters[].GPUActive`) plus parent scalars `gfx.linux_window_protocol`, `gfx.os_compositor`, `gfx.supports_hdr` — no counters.

Reproducible evidence: `extract-legacy-gfx.py` → `legacy-gfx-perping.json` (per-ping, per-histogram) and `legacy-gfx-timeline.csv` (462 data rows).

### 6.3 Bottom line for the GPU-switch question

1. **From `data.safe.bin`: impossible.** No per-value timestamps, no generation records, no gfx `#sequence`. The store only tells you the whole gfx sample set is ≥ `2026-09-22T10:05:40+08:00`, i.e. post-switch.
2. **From the archived main pings: also impossible for this switch**, because the mirrored legacy gfx histograms stop being emitted after 2026-09-12 06:24 local — 8 days before the switch — and never reappear on the AMD side. A before/after comparison would need the two windows 2026-09-12…09-20 (AMD? no: NVIDIA, no data) and 2026-09-20… (AMD, no data), both of which are empty.
3. **What *would* work (not done here, out of scope / would require a config change):** a fresh Glean gfx measurement window on each side of the switch (e.g. force the `metrics` ping, or restart Firefox so a new window begins), or re-enabling the legacy mirroring. Those are writes/config changes and were out of scope for this read-only task.

## 7. Artifacts in this directory

| file | what it is |
|---|---|
| `units.md` | this report |
| `data.safe.snapshot.bin` | byte-identical read-only copy of `datareporting/glean/db/data.safe.bin`; md5 `591b08842411cab396046b63439eb994` |
| `snapshot-md5.txt` | md5 + size of the above |
| `gfx-metrics.yaml`, `a11y-metrics.yaml`, `metrics.yaml`, `glean-internal-metrics.yaml`, `tk-pings.yaml` | raw Mozilla definition files fetched from mozilla/gecko-dev master |
| `histograms.json` | legacy `Histograms.json` (the `telemetry_mirror` targets) |
| `glean-timing_distribution.md`, `glean-custom_distribution.md` | Glean SDK metric-type specs |
| `glean-core_src_histogram_{mod,functional,exponential,linear}.rs`, `glean-core_src_metrics_{custom_distribution,time_unit}.rs`, `glean-core_src_storage_mod.rs` | bucketing/storage implementation sources |
| `decode-pings.py` | copy of the existing mozLz4 decoder (read-only original at `../firefox-gfx/decode-pings.py`) |
| `extract-legacy-gfx.py` | read-only extractor for per-ping legacy gfx histograms |
| `legacy-gfx-perping.json`, `legacy-gfx-timeline.csv` | the extracted per-ping evidence |
| `parse-store.py`, `verify-buckets.py`, `fit-layout.py`, `decode-dist.py` | read-only store decoders used to establish record structure |
| `bucket-verification.txt`, `distribution-decode.txt` | their raw output |
