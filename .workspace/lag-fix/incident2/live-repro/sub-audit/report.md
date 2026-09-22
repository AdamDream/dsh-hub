# Independent audit — "first 设置 click" measurement (incident2 / live-repro)

Auditor: independent sub-audit agent. **Read-only.** No browser launched, no lock acquired, no product
file modified, nothing written outside `sub-audit/`. The producer's analyzer (`scripts/analyze.mjs`)
was read only to learn the data schema and was **never executed or trusted**; every number below was
re-derived from the raw JSON by my own code, `sub-audit/audit.py` (results in `sub-audit/audit_raw.json`),
and `sub-audit/findings.json` is generated from that by `sub-audit/mk_findings.py`.

## 0. What I audited (exact artifacts, frozen in `sub-audit/frozen/`, manifest `sub-audit/frozen-manifest.txt`)

| artifact | sha1 | bytes | mtime (local) |
|---|---|---|---|
| `raw/headless-run1.json` | `60f2d68b0614dbd8bfef219f917500efe8e28d3c` | 79172 | 2026-09-22 10:23:57 |
| `raw/headless-run2.json` | `60840f0e493dc51a36b1d7577e835d6b3a7437d4` | 88029 | 2026-09-22 10:29:51 |
| `raw/control-instrument-headless.json` | `559240b80bea51fefb5542abc18b74770cc4ecb1` | 9076 | 10:22:28 |
| `raw/control-instrument-headed.json` | `77c4b48ba60ff79f9699bf2600240da9f73f5ead` | 4613 | 10:22:54 |
| `raw/headed-run1.json` | `47ee2317a45f29afd2e8b2a96e8bff3aa2500ab9` | 20292 | 10:37:41 (**ERROR, 0 windows**) |
| `raw/headed-run2.json` | `fe5139939a70f4f732cb34efbae006c7dc1d6acb` | 8025 | 10:38:12 (**ERROR, 0 windows**) |
| `raw/analysis-summary.json` / `raw/analysis-headless-run{1,2}.json` | see manifest | — | 10:33:32 |

**Tags with measurable data: `headless-run1`, `headless-run2` only** (both frozen above; their `raw.frames`,
`marks`, `evts`, `longtasks`, `lof`, `metricsDelta`, censuses and `markerProof` are what I audited).
`headed-run1/2` appeared late in the audit (10:37:41 / 10:38:12) and contain **no data at all**:
`windows = []`, `marks = {}`, `gateOutcome = "ERROR"`, both failing

> `browserType.launch: Target page, context or browser has been closed`
> (`chrome_crashpad_handler: --database is required`, then `recvmsg: 连接被对方重置 (104)`)

i.e. the same failure as the headed positive control. `headed-run1` waited **466.6 s / 132 attempts** for the
shared lock before that, `headed-run2` **28.3 s / 10 attempts**; both released it (`lockReleased: true`).
**So there is no headed measurement anywhere in this dataset, and it is now proven that this environment
cannot produce one** — the headless-vs-headed comparison the driver planned does not exist (see F and I).

Method for frames: `raw.frames` is `[t, dt]`; I attribute a frame to a window by its **end** time `t`, so an
interval `[t-dt, t]` inside the window is fully attributable. Slices: `pre = [t_pre, t_click)`,
`post = [t_click, t_post]`. Percentiles are nearest-rank (`ceil(p/100·n)-1`); I also computed linear-interpolation
p99 as a convention cross-check (differences ≤ 1 ms everywhere, shown in `audit_raw.json`).

## 1. Verdicts

| # | Check | Verdict |
|---|---|---|
| A | Window slicing correctness | **PASS** (2 sub-findings: "pre window" is 24–37 ms not a baseline; 16.1 s/window unmeasured) |
| B | click → dialog-visible timings | **PASS** (independently corroborated; 1 ordering anomaly) |
| C | Freeze vs sustained frame drops | **PASS** for the classification; **long-task absence is INCONCLUSIVE-by-instrument** |
| D | Idle baseline | **PASS** |
| E | Self-perturbation risk | **PASS** ("not obviously perturbing") / **INCONCLUSIVE** ("cannot rule out a false-smooth reading") |
| F | Positive control | **FAIL — instruments' stall detection is NOT VALIDATED** |
| G | Gate / census integrity | **FAIL** — per-window exclusivity not established; `EXCLUSIVE` label unsupported |
| H | Marker proof | **PASS**, with two flagged weaknesses (`some()` check; wallpaper `lastTokens: 0`) |
| I | Adversarial review | **COMPLETE** — several limits are fatal to external validity |

### Headline answers to the measurement question

* **Is there ANY single main-thread task ≥100 ms in a click window? NO** — neither run. Largest frame
  interval anywhere in either file is **33.4 ms** (`headless-run1`, at `t_click1 + 2595.3 ms`, i.e. *not*
  the click); there is **no frame ≥50 ms anywhere in either run** (1267 and 1272 frames).
* **Sustained frame drops (≥3 frames of 30–80 ms)? NO.** Per click window, frames in [30,80) ms are
  `2/0/0` (run1) and `0/0/1` (run2); frames ≥33.4 ms are `1/0/0` and `0/0/1`.
* **What the click actually costs: 1–2 dropped frames.** Every click produces a *frame-split* hiccup:
  the last late frame boundary lands 37.7–51.9 ms after the click (see C).
* First-open dialog timing: DOM **16.8 / 16.4 ms**, rAF-visible **19.7 / 19.8 ms**, double-rAF paint
  51.9 / 27.6 ms after the click (run1 / run2).
* **But the null result is not yet trustworthy as "the user has no freeze"** — see F, G and I.

### Independent cross-reproduction of the producer's analyzer

I compared my from-scratch numbers against the analyzer's current (10:33:32) output, field by field,
programmatically: **90 compared field-values, 0 disagreements** — the 9 `clickDialogs` deltas (dom/vis/paint
× 3 windows × 2 runs), the 6 click windows' post-frame stats (`n, p50, p90, p99, max, #≥33.4, #≥50, #≥80,
#≥100`), the idle span and idle frame stats (`n, p50, p90, p99, max, #≥33.4, #≥50, #≥100`) for both runs,
plus its two `verdict.firstOpen*` values. **On the current raw files, the producer's per-window numbers
reproduce exactly.** What does *not* reproduce is the interpretable part:

* its `preWindow` block classifies a 24–37 ms slice of 2–3 frames as if it were a pre-click baseline (A-1);
* its `verdict.firstOpenShape` differs between runs — `MINOR` (run1) vs `SMOOTH` (run2) — on a 2-vs-0 count of
  frames ≥30 ms, i.e. it is reporting noise as a difference (C);
* the run1 `MINOR` grade is driven by a 33.4 ms frame sitting 2595.3 ms after the click, not by the click;
* `markerProof.ok` is an existential (`some`) check, not a fix-marker check (H).

## A. Window slicing correctness — PASS

All 6 click windows in both runs: every mark present, `t_arm ≤ t_pre ≤ t_click ≤ t_dialogpw ≤ t_post`,
`t_post > t_click`, events monotone and exactly `pointerdown, mousedown, click` (all `isSettings: true`),
`problems[]` empty for all 6. Frames outside the arm/post envelope: **0 before `t_arm`, 0 after `t_post`**
in all 6. The per-window `raw.marks` snapshot equals the global `marks` object everywhere (0 mismatches).

The driver intended `--post=3000`: measured `t_post − t_click` = **3012.0–3028.3 ms** (i.e. 3000 ms + 12–28 ms
of CDP/evaluate round trips); the driver's own wall figure `wallPostMs` = 3036–3063 ms. No window is short.
For `i==1` `raw.frames` starts at `t_arm` (idle start) and for `i>1` at `t_arm<i>` (arms after the close
sequence) — verified: run1 click1 first frame 6077.8 vs `t_arm` 6077.7; run1 click2 first frame 31327.0 vs
`t_arm2` 31310.7 and 180 settle frames present.

Sub-findings (not failures, but they change how the analyzer output should be read):

1. **The "pre window" is not a baseline.** `t_click − t_pre` is only **24.1–36.7 ms**, because `t_pre` is
   marked immediately before `btn.click()` and Playwright spends that time on actionability checks before
   dispatching. `analyze.mjs` records this slice (n=2–3 frames) as `preWindow.frameStats/classify`
   (e.g. run1 click1: n=2, p50 16.6, "SMOOTH") — statistically vacuous as a pre-click baseline. The usable
   baseline is the 3 s settle (`i>1`) or the idle window (`i=1`); I computed those in D.
2. **4 × ~16.1 s per run is measured by nothing.** Between `t_post<i>` and `t_arm<i+1>` each window's frame
   array is already read and the next one not yet reset: gaps of **16.168 / 16.137 s** (run1) and
   **16.155 / 16.144 s** (run2). Nothing observes the page there. That constant is arithmetically consistent
   with the drawer-close toggle click at `first-settings-probe.mjs:493` hitting its 15 s `timeout`
   (the error is swallowed by `.catch(() => {})`) plus the 400 + 600 ms waits and two `locator.count()`
   calls — i.e. the automation, not the app, spent 15 s failing to click 设置 to close the drawer and then
   closed it with Escape (`closedBeforeClick2/3: true` in both runs). This is a strong inference, not a
   logged fact: the driver never records the close-click outcome.
3. `pageNowAtRead` == `marks['t_post'+i']` in all 6 windows; `wallPreMs` (0–1 ms) is the `page.evaluate`
   round trip only and must not be read as the pre-window length.

## B. click → dialog-visible timings — PASS

| tag | window | t_pre→click | click→t_post | dom | vis | paint | pwVis | dialogVisibleOk | rect | nodes |
|---|---|---|---|---|---|---|---|---|---|---|
| headless-run1 | click1 | 28.9 | 3026.2 | 16.8 | 19.7 | 51.9 | 3 | true | 800×800 | 697 |
| headless-run1 | click2 | 34.3 | 3019.2 | 10.3 | 13.7 | 38.7 | 5 | true | 800×800 | 697 |
| headless-run1 | click3 | 24.1 | 3012.0 | 5.7 | 14.2 | 43.4 | 2 | true | 800×800 | 697 |
| headless-run2 | click1 | 35.7 | 3028.3 | 16.4 | 19.8 | 27.6 | 4 | true | 800×800 | 697 |
| headless-run2 | click2 | 27.2 | 3017.3 | 9.2 | 15.0 | 37.8 | 4 | true | 800×800 | 697 |
| headless-run2 | click3 | 36.7 | 3021.4 | 11.4 | 14.2 | 44.5 | 2 | true | 800×800 | 697 |

First open (click1) vs re-opens: **19.7 / 13.7 / 14.2 ms** (run1) and **19.8 / 15.0 / 14.2 ms** (run2) —
first-open is ~1.3–1.5× the re-open visible latency, i.e. a few ms, not a different regime.

Independent re-derivation of the recorded fields (the raw JSON persists only the *deltas*
`dialogFirstDom/Visible/DoubleRaf`, not their absolute page times, so this is the only possible check):

* `t_click + clickToDialogDomMs` lands within **0.0–0.2 ms** of a `MutationObserver` `childList` record in
  **all 6** windows (e.g. run1 click1: claim 12132.600 vs mutation 12132.5; run2 click3: 59180.700 vs 59180.6).
* `t_click + clickToDialogPaintedMs` lands within **0.0–0.1 ms** of an actual rAF callback in `raw.frames`
  in **all 6** windows (e.g. run1 click1 frame 12167.6, `dt` 32.3; run2 click1 frame 14784.4, `dt` 7.9).
* `dom ≤ vis ≤ paint` and `dialogVisibleOk=true` with an 800×800 painted rect in all 6.
* Internally consistent, one anomaly: in `headless-run1` click3, `t_dialogpw − t_click = 10.4 ms` is
  **smaller** than `clickToDialogVisibleMs = 14.2 ms`, i.e. Playwright's `waitForSelector` returned before
  the in-page rAF visibility mark. So `playwrightDialogVisibleMs` is a cross-check on a *different* interval
  (it starts counting after `btn.click()` returns) and is **not** an upper bound on the in-page mark.

Interpretation limits that matter for reporting: `clickToDialogPaintedMs` is a **double-rAF** timestamp, so
its floor is ~2 frame intervals (~33 ms); 27.6–51.9 ms is frame-phase alignment, not 27–52 ms of latency.

## C. Freeze vs sustained frame drops — PASS (classification), INCONCLUSIVE (long-task absence)

Click-window frame-interval distribution, re-derived (post slice `[t_click, t_post]`):

| tag | win | t_pre→click | click→t_post | post n | p50 | p90 | p99 | max | ≥33.4 | ≥50 | ≥80 | ≥100 | dom | vis | paint | Task ms | Script ms | RecalcN | LayoutN | LT | LoF |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| headless-run1 | click1 | 28.9 | 3026.2 | 179 | 16.7 | 16.8 | 32.3 | 33.4 | 1 | 0 | 0 | 0 | 16.8 | 19.7 | 51.9 | 102.096 | 36.309 | 9 | 4 | 0 | 0 |
| headless-run1 | click2 | 34.3 | 3019.2 | 181 | 16.7 | 16.8 | 19.3 | 25 | 0 | 0 | 0 | 0 | 10.3 | 13.7 | 38.7 | 87.668 | 33.231 | 9 | 3 | 0 | 0 |
| headless-run1 | click3 | 24.1 | 3012.0 | 180 | 16.7 | 16.8 | 19.8 | 29.1 | 0 | 0 | 0 | 0 | 5.7 | 14.2 | 43.4 | 57.211 | 30.032 | 8 | 3 | 0 | 0 |
| headless-run2 | click1 | 35.7 | 3028.3 | 182 | 16.7 | 16.8 | 24.4 | 25.5 | 0 | 0 | 0 | 0 | 16.4 | 19.8 | 27.6 | 81.156 | 18.964 | 8 | 3 | 0 | 0 |
| headless-run2 | click2 | 27.2 | 3017.3 | 181 | 16.7 | 16.8 | 19.4 | 22.7 | 0 | 0 | 0 | 0 | 9.2 | 15.0 | 37.8 | 78.847 | 46.143 | 9 | 3 | 0 | 0 |
| headless-run2 | click3 | 36.7 | 3021.4 | 181 | 16.7 | 16.8 | 17.6 | 30.5 | 0 | 0 | 0 | 0 | 11.4 | 14.2 | 44.5 | 81.877 | 32.182 | 9 | 3 | 0 | 0 |

(`Task`/`Script` are CDP `TaskDuration`/`ScriptDuration` deltas for the window; `RecalcN`/`LayoutN` are
`RecalcStyleCount`/`LayoutCount`. `LT`/`LoF` = lengths of `raw.longtasks`/`raw.lof`.)

**Classification: not FREEZE, not SUSTAINED — "MINOR/split hiccup" in every window.** Frames in [30,80) ms:
run1 `2/0/0`, run2 `0/0/1` (frames ≥33.4 ms: `1/0/0` / `0/0/1`); sustained would need ≥3. The single 33.4 ms frame in run1 click1 sits at
`t_click + 2595.3 ms` — 2.6 s after the click — and is therefore *not* click-related; `analyze.mjs` counts it
and grades run1 click1 "MINOR" partly because of it. The click-attributable late frames are:

| window | click-attributable frames `[ms after click, dt]` | last late boundary |
|---|---|---|
| run1 click1 | `[19.5, 24.3]`, `[51.8, 32.3]` | **+51.8 ms** |
| run1 click2 | `[38.7, 25.0]` | +38.7 ms |
| run1 click3 | `[43.3, 29.1]` | +43.3 ms |
| run2 click1 | `[19.6, 25.5]`, `[51.9, 24.4]` | **+51.9 ms** |
| run2 click2 | `[37.7, 22.7]` | +37.7 ms |
| run2 click3 | `[44.5, 30.5]` | +44.5 ms |

**A single ≥100 ms main-thread task is excluded by two independent signals**, not one:

1. The rAF series is complete (Σdt ≈ window span within 0.1 %, n ≈ span/16.67), and a task that blocks the
   renderer main thread for ≥100 ms necessarily delays the next rAF callback by ≥100 ms. Max observed: 33.4 ms.
2. CDP `TaskDuration` over the whole 3.03 s window is only **57.2–102.1 ms total**, so a single ≥100 ms task
   would have to consume nearly the entire window's task budget — contradicted by the frame distribution.

**Frame splitting is a real false-negative for threshold-based analyzers.** Every click shows a late frame
followed immediately by a short one: run2 click1 = 25.5 ms then **7.9 ms**; run1 click2 = 25.0 then **8.2**;
run1 click3 = 29.1 then **4.1**; run2 click3 = 30.5 then **2.1**; run1 click1 = 24.3/32.3 then **10.0**.
Chromium emits a catch-up BeginFrame, so a genuine ~33 ms hiccup can produce **zero** intervals in
[30, 80) ms. `analyze.mjs`'s `sustained = frames30to80 >= 3` is therefore fragile; aggregate measures
(`TaskDuration`, sums of consecutive intervals, double-rAF paint) are robust. In this dataset the fragility is
visible: the two runs get *different* first-open verdicts (`MINOR` vs `SMOOTH`) purely because `frames30to80`
was 2 vs 0 — noise, not a difference.

**INSTRUMENT CAVEAT.** `raw.longtasks` and `raw.lof` are **empty in every window of both runs, and in both
idle windows** (`installErrors` empty, `errors` empty). No long-task entry and no long-animation-frame entry
has *ever* been observed by this instrumentation. Since the only positive controls are ERROR (F), "no ≥50 ms
long task was recorded" is **unverified absence**, not evidence of absence. The freeze exclusion above stands
on the rAF + CDP channels only, which is why I state it as PASS with this caveat rather than as a validated
instrument reading.

## D. Idle baseline — PASS, the page is quiet at rest

| tag | idle span | n | p50 | p99 | max | rAF/s | Task ms/s | Script ms/s | RecalcStyleCount | LayoutCount | Σdt vs span |
|---|---|---|---|---|---|---|---|---|---|---|---|
| headless-run1 | 6009.2 ms | 361 | 16.7 | 17.0 | 17.2 | 60.0 | **15.03** | 4.74 | **0** | **0** | 6016.6 |
| headless-run2 | 6009.1 ms | 361 | 16.7 | 16.8 | 17.0 | 60.0 | **12.38** | 3.06 | **0** | **0** | 6016.5 |

Zero frames ≥33.4 ms in idle; Σdt ≈ span means no frame missing from the series; only **2 DOM mutations**
per 6 s idle (from run1 click1's `raw.mutations` filtered to the idle span); no console output, no page
errors. **0 style recalcs and 0 layouts in 6 s of idle in both runs** — no idle style/layout loop.

The 3 s immediately before each click (the settle for `i>1`; the tail of idle for `i=1`) is equally quiet —
all 6 baselines: n = 180, p50 16.7 ms, max 16.8–28.9 ms, **0 frames ≥33.4 ms**.

Limit: CDP metrics are not sampled at `t_arm<i>`, so the settle window has no `TaskDuration`/recalc counters;
only frame cadence supports "quiet before click" for `i>1`. Idle `JSHeapUsedSize` deltas (-3.6 MB run1,
+1.7 MB run2) and `Nodes` deltas (-18 / 0) are noise/GC, not evidence either way.

## E. Self-perturbation risk — PASS (not obviously perturbing) / INCONCLUSIVE (cannot rule out false-smooth)

* The probe's rAF loop pushes one array entry per frame, plus a `MutationObserver(document, childList+subtree)`,
  a second attributes observer, a `ResizeObserver`, and `console`/error wrappers, all installed before app code.
* **Evidence it is not perturbing:** idle cadence is a clean **60.0 rAF/s with p99 16.8–17.0 ms and max 17.0–17.2 ms**
  (tight quantization at 16.6/16.7/16.8), and *total* main-thread task time at idle including the probe itself
  is only **12.4–15.0 ms/s**, of which the app is a subset. Both observers installed without error and the
  MutationObserver caught both dialog insertions within 0.2 ms of the claimed DOM marks, i.e. the recorders
  demonstrably work.
* **The loop cannot hide a renderer-main-thread stall:** it re-arms every frame, so a blocking task must inflate
  the next interval; and the series is provably complete. Empirically it does register a real >16.7 ms hiccup.
* **False-smooth mechanism 1 (real).** `dt` is rAF→rAF in the *renderer main thread*. A stall in the browser /
  GPU / compositor process, in raster, or in a real display pipeline need not delay renderer rAF callbacks.
  Here there is no display at all (headless_shell, ANGLE/SwiftShader software GL), so **nothing in these files
  evidences user-visible presentation**. "Smooth rAF" ≠ "the user saw no freeze".
* **False-smooth mechanism 2 (real, inverted).** The permanently armed rAF loop forces continuous frame
  production, so the page is never in an idle/no-rendering-opportunity state a real user may hit. It can only
  *add* work, never remove a frame — but it changes the regime being measured.
* **False-negative mechanism 3 (observed).** Frame splitting (see C) defeats single-interval thresholds.
* **Unsettled:** there is no un-instrumented control run of the same page, so probe cost cannot be separated
  from app cost. *Additional capture:* re-run with only the LongTask + LoF observers (no rAF loop, no
  MutationObservers), or with CDP `Tracing`, and compare `TaskDuration`.

## F. Positive control — FAIL. Stall detection is NOT VALIDATED

| control | verdict | fatal | lock waited | frame channel | longtask | lof |
|---|---|---|---|---|---|---|
| `raw/control-instrument-headless.json` (10:22:28) | **ERROR** | `Too many arguments. If you need to pass more than 1 argument to the function wrap them in an object.` | 123117 ms | 180 frames / 3000.1 ms, p50 16.7, max 16.9 ms | 0 | 0 |
| `raw/control-instrument-headed.json` (10:22:54) | **ERROR** | `browserType.launch: Target page, context or browser has been closed` (crashpad `--database is required`, `recvmsg: 连接被对方重置`) | 22501 ms | — | — | — |

* The headless control died at `control-instrument.mjs:89`, where `page.evaluate(fn, {fnSrc, ms})` passes a
  second argument to a single-parameter function. **The 180 ms busy-loop was never injected**, so no
  deliberate stall was ever applied. The `{TaskDuration: 59.865, ScriptDuration: 22.501}` and the clean
  180-frame / 60.0 fps window it did capture are a *quiet baseline*, not a control.
* The headed control could not even launch a browser, and the two headed *runs* later failed the same way
  (`raw/headed-run1.json` 10:37:41, `raw/headed-run2.json` 10:38:12: `browserType.launch` →
  "Target page, context or browser has been closed", 0 windows, 0 marks). **Headed measurement is impossible
  in this environment**, which is why no `headed-run*` data exists — not merely "not yet run".
* **Consequence:** the instruments' ability to detect a ≥100 ms stall is **NOT YET VALIDATED**, and the
  empty `longtasks[]`/`lof[]` arrays are *unverified absence*. Any conclusion of the form "no freeze found"
  that rests on the long-task/LoF channel is **INCONCLUSIVE-by-instrument**. My C verdict is deliberately
  narrower: the rAF series + CDP `TaskDuration` independently exclude a ≥100 ms renderer-main-thread task on
  these two runs; the rAF channel has demonstrably responded to a ~33 ms hiccup but has never been shown
  responding to an injected ≥100 ms stall.
* *Additional capture to settle it:* fix the call to a single object argument (or
  `page.evaluate(fnSrc => eval(fnSrc)(ms), …)` form), re-run `control-instrument.mjs --mode=headless --stall=180`,
  and require `frameSpikeDetected && longtaskFired && lofFired && cdpTaskJumped && controlWasQuiet` all true.

## G. Gate / census integrity — FAIL (per-window exclusivity not established)

Census matrix (all 8 instants × 2 runs): `censusStart` and `censusBeforeLaunch` total = **0**;
every later instant **total = 1, mine = 1, foreign = 0**, `binaryKinds = {headless_shell: N}` with N = 5 at
launch and 6 later (1 main + helpers), `helperProcs` 4→5. So **at every sampled instant there was exactly one
browser main process system-wide and this line owned it** — no foreign browser main was ever sampled.

But exclusivity *during the measured windows* is not established:

* **No census sample falls inside a click window.** `censusAfterClickN` is taken *after* window N closes and
  `censusAtIdleEnd` before click1. In run2, `censusAfterClick1` (02:29:06.912) to `censusAfterClick2`
  (02:29:29.106) is a **22.2 s** stretch with no sample, and the 4 × 16.1 s inter-window gaps have none either.
* **This line did not hold the shared lock during the measurement windows.**
  `headless-run2`: acquired 02:28:48.853 after **288.4 s / 84 attempts** (all `HELD:65663`), but by
  `censusAtIdleEnd` (02:29:03.703) `owner.txt` already read
  `agent: incident2-regression (raf-face theme-sync A/B) …` with `lockHeldByThisLine: false`, and it stayed
  false through `censusEnd` (02:29:51.337). `headless-run1`: held throughout, then `censusAfterClick3`
  (02:23:57.247) and `censusEnd` show `agent: incident2-regression (first-open batch) | line: batch plan=base…`
  with `lockHeldByThisLine: false`. **A peer line overwrote the lock while this probe was still measuring.**
* **`gateOutcome: "EXCLUSIVE"` is unsupported.** `first-settings-probe.mjs:566` computes it from
  `censusEnd.foreignMainInstances===0 && censusEnd.mainInstancesMine===1 && lockHeld`, where `lockHeld` is
  the local flag captured at acquisition and never re-read. The observed mid-run lock loss is invisible to the
  verdict, and the verdict is emitted identically in both runs.
* **`lockReleased: false` is not a leaked lock.** `releaseLock()` returns false when `lockIsMine()` is false
  (lines 207-214, 576), i.e. because a *peer* had taken the lock over — corroborated by the peer owner strings
  in `censusEnd`. At audit time the lock directory existed with a fresh (10:33:25) `owner.txt`, so nothing was
  leaked by these runs. It does mean the takeover happened *before* this line released.
* The takeover mechanism is not determinable from the raw JSON (the peer writes a different `owner.txt`
  format; the recorded lock owner pid was alive when this line lost it). *Additional capture:* an append-only
  lock journal `(pid, ts, op=acquire|reclaim|release)` instead of a single mutable `owner.txt`, plus a census
  at `t_arm` and `t_click` inside each window (the `census()` helper already exists; just persist it in the
  window raw).

## H. Marker proof — PASS, with two flagged weaknesses

| package | URL rev | sha1_12 | sha1==rev | status | marker hits |
|---|---|---|---|---|---|
| `@deepseek-ai/dsh-client-ui-layout` | `82cca1a6178a` | `82cca1a6178a` | ✅ | 200 | `scheduleThemeColorRefresh` 3, `lastSignature` 4, `themeColorRefreshQueue` 4 |
| `@local/dsh-wallpaper` | `826d9217a8fc` | `826d9217a8fc` | ✅ | 200 | `shadedTokens` 3, `sameShadedTokens` 2, **`lastTokens` 0** |
| `@deepseek-ai/dsh-client-runtime` | `5559de4ce28c` | `5559de4ce28c` | ✅ | 200 | `p2ac-fix` 4 |
| `@local/dsh-usage` | `4536b91ed282` | `4536b91ed282` | ✅ | 200 | `dsh-perf-fix` 2 |

Identical in both runs. I re-derived the hash chain independently: the saved copies in `raw/`
(`served-*.js`) hash to exactly those revs and their byte sizes equal the `loadedResources.encodedBodySize`
for the same URLs — runtime `5559de4ce28c`/398569, ui-layout `82cca1a6178a`/24988, usage `4536b91ed282`/72804,
wallpaper `826d9217a8fc`/31803.

* **FLAG 1 — weak existential check.** `first-settings-probe.mjs:366` uses
  `Object.values(r.markers).some(n => n > 0)`, so `ok: true` means "at least one listed identifier occurs",
  **not** "the fix marker is present". `@local/dsh-wallpaper` proves the point: it reports `ok: true` with
  `lastTokens: 0`. Whether `lastTokens` is the fix marker is not recorded anywhere in the raw JSON.
* **FLAG 2 — coverage.** Markers exist for **4 of the 54** `client.js` resources the page loaded. Total script
  payload is **8,262,842 bytes**, of which `/plugins/@local/dsh-pptmaster/client.js` alone is **4,096,057 bytes
  (49.6 %)** and `dsh-btw` 335 KB — all executed with no revision proof. `loadedResources` carries URL revs for
  all 54 and could be pinned against served bytes; it is not.
* The check shows identifier *text* in the fetched bundle, not that the fixed code path ran.
  (`markerProof.bytes` = `text.length` in UTF-16 code units, smaller than `encodedBodySize` — expected, not an
  inconsistency.)

## I. Adversarial review — how these measurements could mislead

1. **Scale.** `page.treeitems = 11` and `page.nodesAtStable = 526` in **both** runs (identical), 697 nodes
   after the drawer opens (+171). The test page is ~1/10 the scale of a real session list. Nothing here bounds
   the first-click cost for a user with hundreds of sessions, a long conversation, or the 4 MB pptmaster and
   335 KB btw bundles active. **This is the single biggest gap between the measurement and the complaint.**
2. **Platform.** `headless_shell 131.0.6778.33`, SwiftShader **software** GL, no display, viewport 1440×900,
   `--disable-renderer-backgrounding --disable-backgrounding-occluded-windows --disable-background-timer-throttling`.
   The user's stall is in a real window on a real GPU; raster/compositor cost and behaviour differ, and a
   GPU/raster-side stall is invisible to the renderer rAF series (E).
3. **No headed data at all — proven, not pending.** `headed-run1` and `headed-run2` exist but are ERROR
   records with `windows = []` / `marks = {}`: `browserType.launch` fails with
   `Target page, context or browser has been closed` after `chrome_crashpad_handler: --database is required`
   and `recvmsg: 连接被对方重置` (identical to the headed control's failure) — so the environment cannot launch
   the headed browser and the planned headless-vs-headed comparison is impossible here, not merely unfinished.
   The visible-GUI question therefore has **zero** direct evidence in this dataset.
4. **The page-load phase is measured by nothing.** Click windows start only after
   `waitForSelector([role=treeitem])` + `waitForLoadState(load)` + 2000 ms; the first measured click is at page
   time **12115.8 ms** (run1) / **14756.9 ms** (run2). The **8.26 MB** script init — with the 4.10 MB pptmaster
   bundle taking **1601 ms (run1) / 3525 ms (run2)** — is entirely outside every window. A user who clicks
   设置 while the page is still initialising is in a phase this probe never measured, even though their wording
   ("just open the page and click") suggests exactly that.
5. **Runs are not comparable on anything but the click.** run2's page load was 2.1× slower
   (`navMs 2947 → 6125`) and essentially every `client.js` loaded 1.15×–8.8× slower (median ≈3×):
   pptmaster 1601→3525 ms (2.2×), usage 1142→3299 (2.89×), commands 298→1268 (4.26×), runtime 178→772 (4.34×),
   input-trigger 144→1267 (8.8×). The click-window frame stats, by contrast, agree to 0.1 ms (p50 16.7,
   p90 16.8 in all 6 windows) — so the click-cost finding is robust to that load, but any load-phase or
   absolute-latency run-to-run comparison is confounded.
6. **Host contention is documented but not measured.** The shared lock was held by peer measurement lines for
   effectively all of run2's windows (G), run2 waited 288.4 s / 84 attempts, run1 lost the lock mid-run, and
   the headed leg alone burned 466.6 s / 132 attempts waiting (`headed-run1`). At least three distinct peer
   identities appear in `owner.txt` during the campaign (`incident2-regression (first-open A/B)`,
   `incident2-regression (raf-face theme-sync A/B)`, `incident2-theme-open`). **No run in this dataset is known
   to have been made on an uncontended host**, and no raw file contains any host load metric (no loadavg, no
   CPU%, no PSI). Cross-line CPU/IO contention from peer node/analyzer processes — invisible to a
   browser-main `/proc` census — cannot be excluded. *Additional capture:* `/proc/loadavg` and
   `/proc/pressure/cpu` at `t_arm` and `t_post` of every window.
7. **The dataset was replaced mid-audit, and there are two generations.** `raw/headless-run2.json` changed
   under me: at ~10:30 it held a run with `startedAt 02:19:52.703Z`, `t_arm 6558.1`, `navMs 4448`,
   `lock.waitedMs 14352`, 79655 bytes; from 10:29:51 it holds `startedAt 02:24:00.412Z`, `t_arm 8712.1`,
   `navMs 6125`, `lock.waitedMs 288434`, 88029 bytes. `raw/headless-run1.json` likewise belongs to a later
   generation than the analysis JSON written at 10:18:46 — proven by timestamps and numbers:
   the 10:18 `analysis-headless-run1.json` reported dom/vis/paint `20.4/23.8/27.7`, `10.3/15.7/41.5`,
   `7.4/16.5/46.6` and idle `TaskDuration 178.027 ms`, whereas the current raw (10:23:57) yields
   `16.8/19.7/51.9`, `10.3/13.7/38.7`, `5.7/14.2/43.4` and idle `TaskDuration 90.18 ms`. The analyzer was
   re-run at 10:33:32 and then agreed with the current raw. **The older generation looked worse** (run1 click1
   was graded `SUSTAINED`, idle task time was 2× higher) and its raw files no longer exist; its run2 summary
   survives only as stray lines at the head of `logs/driver.log` (headless-run2: click1 dom/vis/paint
   `21.8/27.3/28.7`, click2 `8.1/14.2/39.6`, click3 `5.8/14.4/38.2`, idle `Task 86.949 ms`). Any report must
   state which generation it describes; a "2-run reproducibility" claim cannot span both.
8. **Two driver instances overlapped.** `logs/driver.log` was truncated at 10:20:16 by a new `drive.sh`, yet its
   first block is the *old* headless-run2 probe's stdout (produced 10:21:07), and `raw/headless-run2.json` was
   written twice. So at least two `drive.sh`/probe processes were alive in 10:20–10:22 and the driver's
   "one browser at a time" invariant was violated at least once; the headless control then waited 123.1 s for
   the lock. The *current* runs were produced by the later invocation, but the serialisation assumption behind
   "EXCLUSIVE" is empirically shaky.
9. **Coverage is narrow.** Per run: 3 × ~3.03 s click windows + 6 s idle measured; 4 × ~16.1 s of inter-window
   housekeeping unobserved; exactly **one** genuine first-ever open of the drawer per run (**n = 2** total).
   The verdict "first open is not worse than re-opens" rests on n=2 first-opens.
10. **What is in scope.** Only the 设置 drawer open/close path; the driver never touched 保存/应用/删除, so no
    persistence/save cost is covered, and the synthetic click path (Playwright input, `hasText:/^设置$/`) is not
    a human's pointer path.
11. **The classification itself is noise-sensitive.** Because of frame splitting (C), the run-to-run first-open
    verdict flips between `MINOR` and `SMOOTH` on a 2-vs-0 frame count. Report the physical quantity
    ("no frame exceeded 33.4 ms; a ~33 ms split hiccup accompanies each click") rather than the label.

## What would settle the user's question

1. **Validate the instrument** (fix `control-instrument.mjs:89`, re-run with `--stall=180`, require all five
   checks true). Until then, no "no freeze" statement is instrument-validated.
2. **Realistic page + a real browser.** A session list of the user's scale, a real GPU and a *visible* window.
   Headed Playwright cannot launch here (F, I-3), so use a real browser driven over CDP (the user's own
   Chrome/DSH window), ≥10 first-opens, and a CDP `Tracing` capture for the click window — tracing is the only
   channel in this setup that could attribute a stall in the browser/compositor/raster processes that the
   renderer rAF series cannot see.
3. **Host-load instrumentation:** `/proc/loadavg` + `/proc/pressure/cpu` at every window boundary, and a
   lock journal, so "exclusive" and "comparable" become checkable instead of asserted.
4. **Persist the absolute marks** (`t_dialogFirstDom`, `t_dialogFirstVisible`, `t_dialogDoubleRaf`,
   `t_lastClick`) in the window raw — the current JSON stores only deltas, which is why B can only be
   corroborated indirectly.
5. **Don't overwrite raw tags.** Write `headless-run2-attempt1.json`, keep both generations, and record the
   analyzer's input hash inside `analysis-*.json` so a stale analysis cannot be mistaken for a current one.

## Reproduce

```
python3 sub-audit/audit.py        # re-derives everything from raw/*.json -> sub-audit/audit_raw.json
python3 sub-audit/mk_findings.py  # -> sub-audit/findings.json (verdicts + numbers)
```
Frozen inputs (sha1 in `sub-audit/frozen-manifest.txt`): `sub-audit/frozen/*.json`.
