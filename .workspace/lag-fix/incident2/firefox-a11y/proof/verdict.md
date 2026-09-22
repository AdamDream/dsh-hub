# a11y cost verdict (2026-09-22T03:57:40.086Z)

## Gecko — snap Firefox 155.0.1, separate instance, throwaway profile (the user's Firefox untouched)

### batch `ffhd-headed` — mode=headed reps=3 rows=15000 mut/frame=1000 thrMs=3000
| condition | n | a11ySvc REGISTERED | busOn | domNodes | build ms | mutate ms | animate ms | frame p95 ms | thr/s | reflow/s | wall ms | cpu s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| env-default | 3 | 3 | 3 | 45009 | 42 | 30 | 3765 | 54 | 148267 | 41581 | 11665 | 15.78 |
| pref-force-disabled | 3 | 0 | 0 | 45009 | 39 | 25 | 2021 | 18 | 682400 | 67577 | 12765 | 11.11 |
| env-cleared | 3 | 3 | 3 | 45009 | 39 | 30 | 4129 | 62 | 137288 | 38508 | 12154 | 16.38 |

- self-proof instrument: **chrome-scope readback of @mozilla.org/accessibilityService;1**
- a11y service REGISTERED per condition: {"env-default":"3/3","pref-force-disabled":"0/3","env-cleared":"3/3"}
- AT-SPI bus membership per condition: {"env-default":"3/3","pref-force-disabled":"0/3","env-cleared":"3/3"}
- accessibility.force_disabled read back: {"env-default":[0,0,0],"pref-force-disabled":[1,1,null],"env-cleared":[0,0,0]}
- env the browser process actually saw: {"env-default":{"ACCESSIBILITY_ENABLED":"1","GNOME_ACCESSIBILITY":"1","GTK_MODULES":"gail:atk-bridge"},"pref-force-disabled":{"ACCESSIBILITY_ENABLED":"1","GNOME_ACCESSIBILITY":"1","GTK_MODULES":"gail:atk-bridge"},"env-cleared":{"ACCESSIBILITY_ENABLED":"","GNOME_ACCESSIBILITY":"1","GTK_MODULES":""}}
- can discriminate: **true** — The accessibility engine state differed between conditions, so any timing ratio compares two genuinely different states.

**cost factor (a11y ON / a11y OFF)**, >1 = accessibility cost time:
```
{
 "costFactor_build": 1.077,
 "costFactor_mutate": 1.2,
 "costFactor_animate": 1.863,
 "costFactor_frameP50": 1.471,
 "costFactor_frameP95": 3,
 "costFactor_over50": null,
 "costFactor_wallMs": 0.914,
 "costFactor_cpuS": 1.42,
 "costFactor_thrPerSec": 4.603,
 "costFactor_reflowPerSec": 1.625,
 "ratio_domNodes": 1
}
```
cost factor (env-default / env-cleared):
```
{
 "costFactor_build": 1.077,
 "costFactor_mutate": 1,
 "costFactor_animate": 0.912,
 "costFactor_frameP50": 0.962,
 "costFactor_frameP95": 0.871,
 "costFactor_over50": 0.667,
 "costFactor_wallMs": 0.96,
 "costFactor_cpuS": 0.963,
 "costFactor_thrPerSec": 0.926,
 "costFactor_reflowPerSec": 0.926,
 "ratio_domNodes": 1
}
```
- loadavg per run: ["7.26 6.52 6.00 10/3667 530858","6.39 6.38 5.97 4/3526 531977","6.31 6.34 5.97 10/3540 533136","6.32 6.34 5.99 3/3445 534072","5.99 6.25 5.97 3/3475 535419","6.11 6.23 5.97 5/3457 536085","6.35 6.25 5.99 5/3442 537072","6.00 6.17 5.98 3/3282 538633","5.78 6.07 5.95 5/3469 539679"]
- concurrent FOREIGN probe browsers per run: [5,1,1,1,1,1,1,1,1]
- lock held throughout batch: false

### batch `ffhead-headed` — mode=headed reps=3 rows=30000 mut/frame=20000 thrMs=3000
| condition | n | a11ySvc REGISTERED | busOn | domNodes | build ms | mutate ms | animate ms | frame p95 ms | thr/s | reflow/s | wall ms | cpu s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| env-default | 1 | 1 | 1 | null | null | null | null | null | null | null | 180344 | 0 |

- self-proof instrument: **chrome-scope readback of @mozilla.org/accessibilityService;1**
- a11y service REGISTERED per condition: {"env-default":"1/1"}
- AT-SPI bus membership per condition: {"env-default":"1/1"}
- accessibility.force_disabled read back: {"env-default":[0]}
- env the browser process actually saw: {"env-default":{"ACCESSIBILITY_ENABLED":"1","GNOME_ACCESSIBILITY":"1","GTK_MODULES":"gail:atk-bridge"}}
- can discriminate: **false** — Accessibility ON in every condition -> conditions did not differ; timing differences are noise.

### batch `ffm-headless` — mode=headless reps=3 rows=6000 mut/frame=120 thrMs=undefined
| condition | n | a11ySvc REGISTERED | busOn | domNodes | build ms | mutate ms | animate ms | frame p95 ms | thr/s | reflow/s | wall ms | cpu s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| env-default | 3 | 3 | 0 | 18009 | 13 | 5 | 2979 | 18 | 1098619.5 | 207933 | 13190 | 8.51 |
| pref-force-disabled | 3 | 0 | 0 | 18009 | 13 | 5 | 2985 | 18 | 1090066.5 | 207532 | 13222 | 8.52 |
| env-cleared | 3 | 3 | 0 | 18009 | 13 | 4 | 2986 | 18 | 1092933 | 214595 | 13235 | 8.66 |

- self-proof instrument: **chrome-scope readback of @mozilla.org/accessibilityService;1**
- a11y service REGISTERED per condition: {"env-default":"3/3","pref-force-disabled":"0/3","env-cleared":"3/3"}
- AT-SPI bus membership per condition: {"env-default":"0/3","pref-force-disabled":"0/3","env-cleared":"0/3"}
- accessibility.force_disabled read back: {"env-default":[null,null,null],"pref-force-disabled":[null,null,null],"env-cleared":[null,null,null]}
- env the browser process actually saw: {"env-default":{"ACCESSIBILITY_ENABLED":"1","GNOME_ACCESSIBILITY":"1","GTK_MODULES":"gail:atk-bridge"},"pref-force-disabled":{"ACCESSIBILITY_ENABLED":"1","GNOME_ACCESSIBILITY":"1","GTK_MODULES":"gail:atk-bridge"},"env-cleared":{"ACCESSIBILITY_ENABLED":"","GNOME_ACCESSIBILITY":"1","GTK_MODULES":""}}
- can discriminate: **true** — The accessibility engine state differed between conditions, so any timing ratio compares two genuinely different states.

**cost factor (a11y ON / a11y OFF)**, >1 = accessibility cost time:
```
{
 "costFactor_build": 1,
 "costFactor_mutate": 1,
 "costFactor_animate": 0.998,
 "costFactor_frameP50": 1,
 "costFactor_frameP95": 1,
 "costFactor_over50": null,
 "costFactor_wallMs": 0.998,
 "costFactor_cpuS": 0.999,
 "costFactor_thrPerSec": 0.992,
 "costFactor_reflowPerSec": 0.998,
 "ratio_domNodes": 1
}
```
cost factor (env-default / env-cleared):
```
{
 "costFactor_build": 1,
 "costFactor_mutate": 1.25,
 "costFactor_animate": 0.998,
 "costFactor_frameP50": 1,
 "costFactor_frameP95": 1,
 "costFactor_over50": null,
 "costFactor_wallMs": 0.997,
 "costFactor_cpuS": 0.983,
 "costFactor_thrPerSec": 0.995,
 "costFactor_reflowPerSec": 1.032,
 "ratio_domNodes": 1
}
```
- loadavg per run: ["4.63 4.96 4.56 2/4306 387030","4.30 4.86 4.54 14/4160 388724","4.44 4.85 4.55 3/4238 390007","4.41 4.81 4.55 1/4318 391575","4.31 4.75 4.54 2/4745 394226","4.51 4.74 4.54 3/4496 395626","5.39 4.91 4.61 5/4596 397366","5.24 4.92 4.62 6/4596 398975","4.57 4.81 4.60 2/4347 400735"]
- concurrent FOREIGN probe browsers per run: [2,7,2,7,13,12,7,8,12]
- lock held throughout batch: false

## Blink — Google Chrome 153.0.8010.52 (system binary, same major as the user's), identical page/workload

### batch `blinkh-summary.json` — reps=3 rows=30000 thrMs=3000
| condition | n | domNodes | build ms | mutate ms | animate ms | frame p95 ms | thr/s | reflow/s | TaskDuration s | LayoutDuration s |
|---|---|---|---|---|---|---|---|---|---|---|
| env-default-nofag | 3 | 90009 | 51.9 | 24.8 | 9535.4 | 103.4 | 1090964 | 42529 | 15.925835 | 5.003203 |
| force-renderer | 3 | 90009 | 64.8 | 32.9 | 22437.3 | 1338.5 | 591901 | 34217 | 28.905303 | 5.07589 |
| env-cleared-nofag | 3 | 90009 | 51.8 | 23.1 | 9820.7 | 111 | 1018932 | 42637 | 16.231499 | 5.059775 |

- chrome://accessibility readback available: true
- ratios:
```
{
 "basis": "median of medians per condition; >1 = the compared condition was SLOWER",
 "forceRendererAccessibility_over_envDefault": {
  "costFactor_thrPerSec": 1.843,
  "costFactor_reflowPerSec": 1.243,
  "costFactor_build": 1.249,
  "costFactor_mutate": 1.327,
  "costFactor_animate": 2.353,
  "costFactor_frameP95": 12.945,
  "costFactor_taskDuration": 1.815,
  "costFactor_layoutDuration": 1.015,
  "costFactor_recalcStyle": 1.161,
  "costFactor_workloadWall": 1.816
 },
 "envCleared_over_envDefault": {
  "costFactor_thrPerSec": 1.071,
  "costFactor_reflowPerSec": 0.997,
  "costFactor_build": 0.998,
  "costFactor_mutate": 0.931,
  "costFactor_animate": 1.03,
  "costFactor_frameP95": 1.074,
  "costFactor_taskDuration": 1.019,
  "costFactor_layoutDuration": 1.011,
  "costFactor_recalcStyle": 1.015,
  "costFactor_workloadWall": 1.019
 },
 "loadavgPerRun": [
  "8.93 6.71 5.41 8/3252 478758",
  "8.44 6.79 5.48 6/3259 479860",
  "7.68 6.72 5.49 4/3192 487774",
  "7.31 6.69 5.50 3/3153 488739",
  "7.62 6.83 5.59 3/3336 490103",
  "9.71 7.36 5.79 8/2844 491641",
  "8.67 7.24 5.78 2/2932 492745",
  "7.22 7.05 5.77 2/2932 493290",
  "8.41 7.34 5.89 6/2959 493980"
 ],
 "lockHeldThroughoutBatch": false
}
```

### batch `blinksmoke-summary.json` — reps=1 rows=3000 thrMs=1000
| condition | n | domNodes | build ms | mutate ms | animate ms | frame p95 ms | thr/s | reflow/s | TaskDuration s | LayoutDuration s |
|---|---|---|---|---|---|---|---|---|---|---|
| env-default-nofag | 1 | 9009 | 6.3 | 2.3 | 476.4 | 16.9 | 1276072 | 150864 | 2.221579 | 0.765726 |
| force-renderer | 1 | 9009 | 6.2 | 1.9 | 572.8 | 31.3 | 930600 | 125137 | 2.452323 | 0.70495 |
| env-cleared-nofag | 1 | 9009 | 7 | 1.9 | 487.5 | 16.8 | 1323200 | 146127 | 2.252716 | 0.771609 |

- chrome://accessibility readback available: true
- ratios:
```
{
 "basis": "median of medians per condition; >1 = the compared condition was SLOWER",
 "forceRendererAccessibility_over_envDefault": {
  "costFactor_thrPerSec": 1.371,
  "costFactor_reflowPerSec": 1.206,
  "costFactor_build": 0.984,
  "costFactor_mutate": 0.826,
  "costFactor_animate": 1.202,
  "costFactor_frameP95": 1.852,
  "costFactor_taskDuration": 1.104,
  "costFactor_layoutDuration": 0.921,
  "costFactor_recalcStyle": 0.927,
  "costFactor_workloadWall": 1.036
 },
 "envCleared_over_envDefault": {
  "costFactor_thrPerSec": 0.964,
  "costFactor_reflowPerSec": 1.032,
  "costFactor_build": 1.111,
  "costFactor_mutate": 0.826,
  "costFactor_animate": 1.023,
  "costFactor_frameP95": 0.994,
  "costFactor_taskDuration": 1.014,
  "costFactor_layoutDuration": 1.008,
  "costFactor_recalcStyle": 1.011,
  "costFactor_workloadWall": 1.003
 },
 "loadavgPerRun": [
  "7.08 5.37 4.82 2/3355 445524",
  "6.75 5.34 4.81 9/3365 446907",
  "6.93 5.40 4.83 3/3360 449057"
 ],
 "lockHeldThroughoutBatch": false
}
```
