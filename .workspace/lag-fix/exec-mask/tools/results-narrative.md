@@TOP@@

## VERDICT (read this first)

**V1 (instrument live): PASS.** 36/36 in-page `window.__block(120)` positive controls reported
`frameMax` 99.9–150 ms (typical 99.9–100.1 ms; 116.6–116.7 ms for the in-panel variant). In the very
same 36 phase windows the `LongTask` PerformanceObserver reported **0** long tasks and the LoAF entries
were 0 — i.e. this run independently reproduces the audit's warning that the LongTask channel is blind
to CDP/in-page injected blocking while the rAF frame channel is live. All modal-phase LongTask totals
are also 0 (normal/patch/normal2) while LoAF counts are 1241/0/301 ⇒ **"0 long tasks" is never used as
evidence of smoothness anywhere in this report.**

**V2 (baseline reproduced): PASS.** At 2560x1440@2 the `normal` arm shows **23–30 of 30 modal-open
phases with ≥1 frame >50 ms** in all three invocations (961 / 96 / 99 frames >50 ms in total;
`frameMax` 116.8 / 99.9 / 83.4 ms; LoAF 1043 / 97 / 101). Per-phase >50 ms counts run 1–51, bracketing
the audit's 6.5–20 band. `IDLE_BASE` and `CLOSE` are 0 frames / `frameMax` 16.8 ms in every arm except
the ambient residual disclosed in §6b(8). The effect therefore reproduced on this run and the patch's
"0" is falsifiable and confirmed by same-rep pairing, not by a missing baseline.

**V3 (patch actually served): PASS.** Every `patch` arm (n=6 invocations) logged the interception of
`GET @deepseek-ai/dsh-client-ui-settings-general/client.js?rev=f733efde3f2f` → 26593 bytes, sha256
`bd7edeae…`, and the bytes the PAGE itself re-fetched and hashed in-page were also `bd7edeae…`; the
live computed style of `div.VOzbGW_mask` read `backdrop-filter: none`. Every `normal`/`normal2` arm
(n=7) served the pre-image `9298ac5b…` and read `backdrop-filter: blur(2px)`. No arm was silently served
the wrong bundle. The strongest form of this proof is §8 (the injected CSS module's rule text).

**MAIN JUDGEMENT: the target is reached, and the jank returns when the patch is removed.**
At 2560x1440@2, same-rep arm-to-arm over 3 invocations (90 paired modal-open phase-instances):

| pairing | phases ≥1 >50 ms → **0** | phases still janky | totals >50 ms frames | max frameMax | p95 medians | LoAF totals |
|---|---|---|---|---|---|---|
| `normal` → `patch` | **76 of 76** baseline-janky instances → 0 | **0** | **1156 → 0** | **116.8 → 16.8 ms** | 16.8 → **16.7 ms** | 1241 → **0** |
| `patch` → `normal2` | — | 0 in patch | 0 → **295** | 16.8 → 99.9 ms | 16.7 → 16.8 | 0 → 301 |
| `normal` → `normal2` (null) | 7 (structurally clean phases) | 69 | 1156 → 295 | 116.8 → 99.9 ms | 16.8 → 16.8 | 1241 → 301 |

In the `patch` arm **every one of the 90 modal-open phase-instances** has `framesGt50 == 0` and
`frameMax == 16.8 ms` (exactly one vsync) — i.e. the target (`framesGt50 == 0`, `p95 ≤ 16.8 ms`) is
met, and 23 of 30 phase labels are janky in *every* one of the six unpatched arm-instances while none
is janky in any patched instance (23 labels × 3 = 69 phase-instances reverse cleanly).

**1440x900@2 REGRESSION VERDICT: no regression (guardrail passes, and frameMax is strictly better).**
Both arms show 0 frames >50 ms in all 3 invocations (the audit's own 1440x900 result, reproduced), but
`frameMax` is 33.5 / 33.4 / 50.0 ms in `normal` vs **16.8 / 16.8 / 16.8 ms** in `patch`, i.e. the patch
removes the 2–3-vsync stretches that 1440x900 does show without ever making anything worse.

**c2f GUARDRAIL (baseline 16.65 ms): no measurable degradation, with one honesty caveat.**
- 1440x900: `normal` 16.2 / 16.7 / 16.3 ms vs `patch` 16.8 / 16.4 / 16.6 ms (medians of 15 click phases
  per invocation) — patch sits within ±0.2 ms of its paired `normal`.
- 2560x1440: paired per-phase delta (`patch` − `normal`) medians are **−0.5 / +0.5 / 0.0 ms** per
  invocation (pooled: 24 positive / 19 negative / 2 zero of 45 pairs; sign test p ≈ 0.53) ⇒ no
  systematic shift. **But** the median-of-15 reads `normal` 15.9 / 16.0 / 16.0 ms, `normal2`
  16.3 / 16.5 / 16.8 ms, `patch` 17.0 / 17.8 / 17.6 ms: the patch arm's median-of-15 is 1.0–1.8 ms
  above the baseline 16.65 ms. Because the paired distribution is sign-balanced we do **not** attribute
  that to the patch (a 15-sample median is rank-fragile), but the statement "the patch arm's c2f median
  is at/below baseline at 2560x1440" is **NOT** supported by this data. Verdict: no evidence of
  degradation, no positive claim of improvement.

**BRIDGE (audit's own in-page A-B-A on this same instrument, 2560x1440, n=1): reproduces the audit.**
`FOCUS_NORMAL → FOCUS_ABLATED(mask backdropFilter:none) → FOCUS_NORMAL2`:
navPlugins 3→**0**→3 (83.4→**16.8**→83.3), tabList 2→**0**→2 (66.7→**16.8**→66.7),
scrollList 17→**0**→17 (83.4→**16.8**→83.4), navGeneral 1→**0**→1, scrollGeneral 2→**0**→2 — the same
5 of 7 steps the audit reported, with `open` (2/1/2) and `close` (0/0/0) flat exactly as the audit
found. So the real bundle swap and the audit's in-page style override are **indistinguishable on this
instrument**, and the candidate's mechanism is the mask's `backdrop-filter` and nothing else in the
deleted bytes.

**APPEARANCE: differences are confined to the dimmed margin outside the opaque panel.**
15 distinct screenshot pairs (all with matching nav label, active tab, scroll offsets and panel rect):

| pair set | viewport | mean Δ | median Δ | p99 | max Δ | >2/255 | >8/255 | >8/255 OUTSIDE panel | >8/255 INSIDE panel |
|---|---|---|---|---|---|---|---|---|---|
| `normal` vs `patch` (3 shots) | 2560x1440@2 | 1.14 | 0 | 8 | 161 | 12.9 % | 0.91 % | 134,276 px | 127 px |
| `normal` vs `patch` (3 shots) | 1440x900@2 | 1.70 | 0 | 34 | 161 | 12.2 % | 3.48 % | 180,103 px | 62 px |
| `normal` vs `normal2` (NULL, 3 shots) | 2560x1440@2 | 0.0001 | 0 | 0 | 7 | 0.0019 % | **0 %** | 0 px | 0 px |

Per-region mean per-pixel max-channel Δ at 2560x1440: panel **core 0.0008/255**, panel edge band
0.0565/255, **dimmed margin 1.3788/255** (99.9 %+ of the change lives outside the panel; the ~127 px
inside the panel that exceed 8/255 are its own antialiased rounded-corner/edge pixels — the null
control shows 0 such pixels, so they are attributable to the blur/no-blur difference at the panel
border). 8×8 grid: the grid cells covering the panel interior are exactly 0 % while the cells over the
dimmed margin reach 12–43 %. The mask's own `background` is unchanged (`rgba(0,0,0,0.24)`) in both
arms; only the blur is gone, so the dimming itself is preserved (proved again in §10(3)).
@@SEC6B@@

### 6b. Hand-written: failures, invalid runs and disclosures the summarizer cannot see

1. **First campaign attempt (12:18:27) was aborted by a bug in MY driver, not in the instrument.**
   `campaign.sh`'s `run_stage()` did `shift 3` on a 3-argument call, so the command itself was shifted
   away and `eval "$@"` evaluated the empty string: every stage reported `rc=0` while running nothing.
   This is why the "no measurements" case must be caught by content, not exit status — the new
   `preflight.mjs` gate did catch it (`PREFLIGHT FAIL: no perf-smoke-*.json found`) and stopped the
   campaign before any judged stage ran. No data from that attempt exists; no browser was launched
   (the runner acquires the lock before launching and the lock had in fact been acquired and was
   released normally).
2. **A stray runner process was started by a tooling mistake at 12:15:32 and killed after 60 s.** While
   sanity-checking the census fix I ran `import('./panel-compare.mjs')`, which executed the runner's
   `main()` at 1440x900 with default options. It never acquired the lock (a live sibling held it) and
   therefore **never launched a browser**; it was terminated by the 60 s command timeout. Verified
   afterwards that the sibling's `owner.txt` line and PID were unchanged, i.e. no lock was harmed.
3. **A live sibling line held the lock when this work started.** `pid 591877`
   (`node runners/matrix.mjs --engine chrome153 --mode all --run chrome153 --reps 5`, under
   `incident2/instrument-tiebreak`) owned the lock from 12:12:39, together with its Playwright Chrome
   and a sibling `realpage-a11y.mjs` Firefox run. The lock was **never forced**: it was polled, the
   owner was found alive, and the campaign started only after the sibling released it (lock gone at
   12:18:27). The campaign then held it once (wrapper pid 622478) and released it at 12:55:11; the
   short provenance run of §10 held it again (wrapper pid 663693) from 13:01:39 to 13:02:03. Total
   waiting ≈ 5.5 min, in bounded 3-minute attempts.
   *This is the one item that could have gone catastrophically wrong:* the inherited liveness check
   (`readlink('/proc/<pid>/exe')`) returns **EACCES** on this box for foreign processes, so it reports a
   LIVE owner as dead and the inherited `acquireLock()` then deletes that owner's lock. See
   `harness-notes.md` §5(b) — fixed here before any lock was touched.
4. **The screenshot filenames did not include the invocation stamp**, so the three `--reps 1`
   invocations of each run overwrote each other's PNGs. Consequence: 21 PNGs survive (not 51) and the
   pixel evidence is **3 distinct pairs per run**, not 9. `pixdiff.mjs` now suppresses the duplicate
   file-pair comparisons (`duplicates: 24` in `pixdiff-all.json`) and the table above lists only
   distinct pairs. The three surviving pairs are genuine, matched-state pairs; the "n=3 per shot" claim
   would have been false and is not made. Fixed in the runner for future runs.
5. **The instrument's composite channel is blind, as the audit warned.**
   `CompositeLayers` and `UpdateLayerTree` are **0 ms in all 270 modal phases** of this campaign, so no
   absolute compositor saving can be claimed. Secondary trace evidence is consistent with a
   compositor-side cost and NOT a main-thread one: main-thread `Paint` / `RasterTask` / `Layout` totals
   over the 90 modal phases are 216.96 / 300.63 / 467.92 ms in `normal`, 291.13 / 323.84 / 620.69 ms in
   `patch` and 231.9 / 307.83 / 250.53 ms in `normal2` — flat-to-higher, never a saving, while the
   frames go from 1156 late frames to 0. (`RunTask` is 0 in all arms: also a channel artifact.)
6. **One frame >50 ms exists in a `patch` arm — 1 of 210 patch phase-instances.**
   In the pre-flight (`smoke`, 1440x900) the `patch` arm's `SCROLL_tab_S3_插件::tab:插件配置` phase
   shows 1 frame >50 ms (`frameMax` 66.7 ms) vs 0 in its `normal` arm. Every patch phase-instance at
   2560x1440 (90) and in the guard run (90) is 0. Reported rather than smoothed away.
7. **`CLOSE` c2f artifact: 2146.9 ms in one `patch` arm** (`mask2k` 043447Z). Of 35 `CLOSE`
   phase-instances across the campaign, 34 report `clickToFirstChangeMs = null` (the observer's target
   is detached when the panel closes, so no mutation is normally seen) and this single instance saw one
   mutation 2.1 s later. It is an instrumented-phase artifact of `CLOSE`, not a patch effect; it enters
   the raw c2f max in the table in §4 and the c2f medians quoted in the verdict exclude `CLOSE`.
8. **First-arm cold-start inflation (rep-1 `normal` = 961 frames >50 ms vs 96 / 99 in reps 2–3).**
   The effect is real and reproducible in reps 2–3 (23/30 phases, ~97 frames) but the first arm of the
   first invocation is roughly 10x worse. The same invocation's `normal2` arm sits at the lower level,
   so this is arm-position/cold-start (browser boot, module compile, boot-residue RPCs), not a property
   of the `normal` condition. It does not change any conclusion — the pairing was `normal → patch →
   normal2` and the patch is clean in all three positions.
   Related and disclosed: `IDLE_BASE` (modal closed) is 0 frames / `frameMax` 16.8 ms in invocations 2
   and 3 of every arm, but shows **1 frame >50 ms (66.7 ms) in ALL THREE arms of invocation 1** — that
   residual is per-invocation ambient/boot noise hitting all three arms equally (LoAF entry counts
   2/1/1 in the same three windows), not an arm effect. The audit's "IDLE_BASE is always 0" therefore
   holds in 2 of 3 invocations here; the exception is disclosed rather than dropped.
9. **Arm order was not counterbalanced.** `patch` was always the middle arm. Evidence against an order
   confound: the two unpatched arms (positions 1 and 3) are janky at the same level in reps 2–3 while
   the patched arm (position 2) is clean; and the bridge run shows cleanliness only while the in-page
   override is active. But a systematic position effect cannot be fully excluded by this design.
10. **The audit's "quiet gate" was vacuous and is not used here.** Every audit log line reads
    `pre-census: total=0 own=0 foreign=0` and `quiet gate: quiet=true waited=2ms` because the census
    identified processes via the same EACCES-failing `readlink('/proc/<pid>/exe')`. After the fix the
    census sees, and this report discloses, **11–22 foreign browser processes at every rep start**
    (the real user Chrome pid 494362, the snap Firefox pid 547226, a sibling Playwright Chrome, a
    sibling marionette Firefox) with `/proc/loadavg` 2.82–4.29 during the judged runs — *lower* than
    the 6.6–9.8 the audit itself ran its clean A-B-A batches at.
11. **NOT VERIFIED / not attempted in this campaign:** no compositor-thread cost measurement (5);
    no area-manipulation re-run (the 2.03x–5.76x area law is accepted from the audit as given, not
    re-derived — though §8(1) re-measures the mask:panel area ratio at 5.76 at 2560x1440 incidentally);
    no headed/display-stack run; `LongTask`-based statements are refused by design.
12. **Lock-liveness policy tightened to "positive proof of death only" and re-verified at runtime**
    (`tools/lock-liveness-test.mjs` → `raw/harness/lock-liveness-test.json`). Reclaim now happens ONLY
    when `/proc/<pid>` is absent, or `/proc/<pid>/stat` shows state `Z`/`X`; **every** other outcome —
    including EACCES on anything under `/proc/<pid>` — resolves to ALIVE. The previous extra rule
    ("readable but empty cmdline ⇒ dead") was removed, because an empty cmdline is not proof of death.
    Measured on this machine in one pass: the shipped predicate says ALIVE for the user's Chrome
    (pid 494362, state S), the snap Firefox (547226, S), the dsh host (301709, S), gnome-shell (4139, S)
    and this test's own processes, and PROVABLY DEAD only for a gone pid (`proc-entry-absent`, the
    advisory's former lock holder 591877) and for a deliberate zombie (`stat-state-Z`). The inherited
    exe-based predicate called **4 live processes DEAD** in the same pass, every one of them with
    `readlink(/proc/<pid>/exe) = EACCES` — it was readable only for the harness command's own direct
    shell child, exactly as `raw/instrument-findings.json` reports. **Had `campaign.sh` acquired the
    lock before 12:15:32 it would have deleted the live sibling's `owner.txt` and `rmdir`'d their
    lock**; the fix is load-bearing and is not reverted anywhere (no liveness decision in
    `tools/*.mjs` uses `readlinkSync`; the only remaining use is a non-liveness identity hint in
    `census()`, where `ident = exe || cmdline` and cmdline is primary).
    Timeline reconciliation, since the advisory's premise was written at 12:16:55: the sibling
    (`incident2/instrument-tiebreak`, pids 591875/591877/591889) **did** hold the lock at 12:12:39–12:16
    and was reported `alive: true` by the fixed predicate; it released at **12:18:27**, at which point
    this campaign acquired the lock (12:19:02) and ran to completion (released 12:55:11), followed by
    the provenance run (13:01:39 → 13:02:03). The lock is free now and those sibling processes have
    exited, so the "do not force the lock" instruction was honoured by waiting, not by reclaiming.
13. **`summarize.mjs` initially clobbered the hand-written sections of this file** on re-run. The
    hand-written narrative (this section, the VERDICT block, §8, §9, §10) now lives in
    `tools/results-narrative.md` and is spliced in by `summarize.mjs` at three marker lines, so
    regenerating the generated tables can no longer lose it. Numbers in this report were not affected
    — only the narrative text had to be restored.
@@END@@

## 8. Provenance proof: the selector, the node, the scope and the injected rule

Run: `tools/blur-inventory.sh` → `tools/blur-inventory.mjs`, 2560x1440@2, one fresh context per arm,
**four settled states** (`open-general-scroll0` = 通用设置 at scroll 0, `nav-plugins-scroll0` = 插件 at
scroll 0, `tab-pluginslist`, `tab-pluginslist-scrolled`), arm-to-arm on the same state. Data:
`raw/harness/blur-inventory-{normal,patch,compare}.json`. (No in-page probe is installed by this tool
on purpose, so it is able to disagree with the probe.)

**(1) The entire document contains exactly ONE element with a non-none computed `backdrop-filter`** —
and it is the settings scrim:

| field | value (normal arm) |
|---|---|
| tagName / className | `DIV` / `VOzbGW_mask` |
| domPath | `1/2/0/0/0/0/0/3/1/0/1/0` |
| rect | x 0, y 0, w **2560**, h **1440** (full viewport) |
| area | **3,686,400 CSS px** = **14,745,600 device px** (dpr 2) |
| position / z-index | `absolute` / `auto` |
| parent (`overlayRoot`) | `div.VOzbGW_overlay`, 2 children: `div.VOzbGW_mask`, `div.VOzbGW_panel` |
| ancestor chain | `div.VOzbGW_mask` → `div.VOzbGW_overlay` → `div` → `div.hHd-Xa_settingsArea` |
| backdrop-filter / -webkit- | `blur(2px)` / `null` |
| containment | `inOverlayRoot` true, `inSettingsPanel` false (it is the panel's **sibling**, not its descendant) |
| maskArea ÷ panelArea | **5.76** (640,000 CSS px panel) — reproduces the audit's upper area bound at runtime |

In the `patch` arm the same element's computed `backdrop-filter` is `none` and the count of
non-none-backdrop-filter elements in the document is **0**. No other blurred element exists anywhere
(nav, panel, cards, wallpaper layer), so there is nothing else for the deleted declaration to affect.

**(2) The audit's carrier selector resolved to the right node — confirmed at runtime, in all 4 states,
in both arms:**
- `document.querySelector('div[class$="_mask"]')` → className **`VOzbGW_mask`**, domPath
  `1/2/0/0/0/0/0/3/1/0/1/0`;
- `document.querySelector('div.VOzbGW_mask')` → **the same node** (`sameNodeAsVozbGWMask: true`,
  exact-class node count 1);
- `document.querySelectorAll('div[class$="_mask"]').length` = **1** (a single match, no ambiguity);
- naming-scheme survey over the whole document: `PREFIX_name` matches 1 (`VOzbGW_mask`),
  shell `_name_hash` (`_mask_hash_NN`) matches **0**, other `*mask*` classes **0** — at these states the
  shell's modal primitives are not mounted, so the two schemes cannot collide here, and the one match
  that exists is the settings-mask node itself. (Static check agrees: the settings bundle's only
  `_mask`-suffixed class token is `VOzbGW_mask`.)

**(3) The fix is scoped to exactly that node and does not leak.** Per state, arm-to-arm:

| state | elements examined (n/p) | non-none backdrop-filter (n→p) | mask computed BF (n→p) | every OTHER element unchanged | changed non-mask elements | whole-document (path,bf,-webkit-bf) hash excluding the mask |
|---|---|---|---|---|---|---|
| open-general-scroll0 | 748 / 748 | 1 → **0** | `blur(2px)` → **`none`** | **true** | **0** | `482e0638` = `482e0638` |
| nav-plugins-scroll0 | 1003 / 1003 | 1 → **0** | `blur(2px)` → **`none`** | **true** | **0** | `e1392538` = `e1392538` |
| tab-pluginslist | 2402 / 2402 | 1 → **0** | `blur(2px)` → **`none`** | **true** | **0** | `4812eaac` = `4812eaac` |
| tab-pluginslist-scrolled | 2402 / 2402 | 1 → **0** | `blur(2px)` → **`none`** | **true** | **0** | `4812eaac` = `4812eaac` |

The hash is taken in document order over every element's `(domPath, backdropFilter,
webkitBackdropFilter)` **with the mask's own path excluded**: identical hashes mean no other element's
backdrop-filter changed anywhere in the document, not merely none of the elements I happened to list.
`-webkit-backdrop-filter` is `none`/`null` on every element including the mask in both arms, so the fix
cannot leak through a legacy alias. The CSS custom property is untouched too: `--dsw-mask-blur` still
resolves to `blur(2px)` in the patch arm — the patch removes the *use*, not the token. The mask's own
`background` is byte-identical in both arms (`rgba(0, 0, 0, 0.24) none repeat scroll …`), i.e. the
dimming is preserved and only the blur is gone (which is what the pixel evidence in §5 shows).

**(4) The injected CSS module is present, identified, and its `.VOzbGW_mask` rule text flips exactly as
the 37-byte deletion predicts** — the cleanest single proof that the REAL bundle swap took effect:

- selector `style[data-plugin-css="@deepseek-ai/dsh-client-ui-settings-general/SettingsRoot.module.css"]`
  → **found: true** in both arms, with `dataset = { plugin: "@deepseek-ai/dsh-client-ui-settings-general",
  pluginCss: "@deepseek-ai/dsh-client-ui-settings-general/SettingsRoot.module.css" }`;
- rule text in `normal`:
  `.VOzbGW_mask{background:var(--dsw-alias-bg-mask-1);backdrop-filter:var(--dsw-mask-blur);position:absolute;inset:0}`
  (contains a `backdrop-filter` declaration: **true**);
- rule text in `patch`:
  `.VOzbGW_mask{background:var(--dsw-alias-bg-mask-1);position:absolute;inset:0}`
  (contains a `backdrop-filter` declaration: **false**);
- both strings equal the expected strings **exactly** (`ruleMatchesExpectedPreimage: true`,
  `ruleMatchesExpectedPatched: true` in all four states), and the tag is created by the settings
  bundle itself (`tagId = "@deepseek-ai/dsh-client-ui-settings-general/SettingsRoot.module.css"` inside
  `candidate/client.js`) — so the running stylesheet is provably the one built from the served bytes.

Bundle identity in the same run: `normal` served `9298ac5b…` (`PREIMAGE-SERVED`), `patch` served
`bd7edeae…` (`PATCH-SERVED`, route intercepted once at page load + once by the post-measurement
in-page re-fetch).

## 9. Honesty boundary: what transfers to the user's screen and what does not

These are absolute frame counts from **headless Chrome on a machine with no display stack**. The
user's screen additionally has: fractional scaling resample (5120x2880 → 3840x2160) on a 2-CU AMD
Raphael iGPU, a mutter compositor, and an enterprise DLP watermark layer. None of that exists here.
**Therefore the absolute frame counts in this report are a LOWER BOUND on what the user sees, and only
two things transfer: (i) the direction of the effect, and (ii) the same-rep arm-to-arm pairing (which
is a within-machine, within-minute, A-B-A comparison).** No fps, no dropped-frame percentage and no
absolute latency number from this campaign should be quoted as the user's number.

Two further limits: the judgement rests on the rAF inter-frame interval channel (validated by V1) and
on LoAF entry counts; the LongTask channel is blind here (36/36 zero) and the compositor channel is
blind here (`CompositeLayers` = 0 in all 270 phases), so the *magnitude* of the compositor saving is
unmeasured and deliberately not estimated.

## 10. Exact commands

```
# campaign driver (one lock acquisition, sequential, single browser at a time)
bash /home/CNS2026495165/dsh/.workspace/lag-fix/exec-mask/tools/campaign.sh smoke main guard bridge

# which expands to, per invocation (phase names/measurement code are the audit's, verbatim):
node tools/panel-compare.mjs --sections nav --order A --quiet-wait-ms 0 \
  --run mask2k --vw 2560 --vh 1440 --dsf 2 --reps 1 --arms normal,patch,normal2 \
  --bundlePatch /home/CNS2026495165/dsh/.workspace/lag-fix/exec-mask/candidate/client.js --shots --shot-rep 1
  # (×3, same --run label; guard9 = --vw 1440 --vh 900 --arms normal,patch;
  #  bridge  = --vw 2560 --vh 1440 --arms normal --ablate aba)

# provenance run (§8), its own single lock acquisition
bash /home/CNS2026495165/dsh/.workspace/lag-fix/exec-mask/tools/blur-inventory.sh
  # = node tools/blur-inventory.mjs --bundlePatch .../candidate/client.js --arms normal,patch \
  #     --vw 2560 --vh 1440 --dsf 2 --run blurinv

# analysis
node tools/preflight.mjs --run smoke
node tools/pixdiff.mjs --raw raw/harness/perf-mask2k-A-chrome-headless-<stamp>.json ... --out raw/harness/pixdiff-all.json
node tools/summarize.mjs --pixdiff raw/harness/pixdiff-all.json --narrative tools/results-narrative.md \
  --out raw/harness/RESULTS.md --judge raw/harness/judgement.json
```

Non-negotiables observed: no foreign browser was signalled or killed (no `pkill`, no `kill`, no
`kill -0` on anything but this campaign's own children); the lock was acquired via
`fs.mkdirSync` + a one-line `pid: <pid>` owner.txt, polled with a `/proc` existence test, and released
only when the owner line was ours; `incident2/why-these-two/tools/` was read/copied only and never
written.
