# CAPTURE-NOTES.md — real DevTools-format settings-click trace

## Command run (re-runnable; idempotent overwrite; validates before writing)
```
cd /home/CNS2026495165/dsh/.workspace/lag-fix/incident2/user-capture/fixtures
node capture-fixture.mjs
```
No `NODE_PATH` needed — the script uses `createRequire('/home/CNS2026495165/playwright_scratch/')`.
Outputs: `real-settings-trace.json` (DELIVERABLE 1), `capture-fixture.mjs` (DELIVERABLE 3),
`_capture-meta.json` (run metadata/timeline). Only this script's own headless Chromium was closed
(`browser.close()`); DSH PID 10806 was never touched, restarted, or modified.
Versions: Playwright **1.49.1**, Chromium **131.0.6778.33** (`ms-playwright/chromium-1148`, headless,
`--no-sandbox`), node **v22.23.2**.

`/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/user-capture/fixtures/real-settings-trace.json`
**26,121,454 bytes** · **103,153 traceEvents** · md5 `1c6b7930eece5d09b2fdad6c9e5b9324` · valid JSON
`file` → "ASCII text"; first bytes `7b22 7472` = `{"tr`; GUI loaded with **no login/auth screen** (HTTP 200).

## Tracing categories (verbatim) + CDP params
```
devtools.timeline,disabled-by-default-devtools.timeline,devtools.timeline.frame,blink.user_timing,
disabled-by-default-v8.cpu_profiler,latencyInfo,v8.execute,disabled-by-default-devtools.screenshot
```
`transferMode=ReturnAsStream, streamFormat=json, streamCompression=none, options=sampling-frequency=10000`
**No CDP parameter was rejected** (`cdpRejections: []`). `disabled-by-default-v8.cpu_profiler` did **not** explode
the trace (26 MB) or crash it, so it was **kept**. `ReturnAsString` is **not a real transferMode** — Chrome accepts
it silently but treats it as `ReportEvents` (returns `{}`, no `stream`, no string). Working paths: `ReturnAsStream`
(handle arrives in the `Tracing.tracingComplete` **event**, since `Tracing.end` returns `{}`) and `ReportEvents`
(events arrive already-decoded via `Tracing.dataCollected`, needing no binary handling at all).

## grep -c '"name":"<X>"' real-settings-trace.json — from the successfully parsed file
RunTask 10479 · UpdateLayoutTree 60 · Layout 11 · Paint 100 · ProfileChunk 1091
USER_CLICK_SETTINGS_START 1 · USER_CLICK_SETTINGS_END 1
Also: EvaluateScript 57 · FunctionCall 989 · ParseHTML 6 · TimerFire 4 · EventDispatch 113 · CommitLoad 1 · navigationStart 2 · firstContentfulPaint 1 · firstMeaningfulPaint 0

## Performance marks — BOTH PRESENT as real events
`cat:"blink.user_timing"`, same pid/tid as the renderer main thread: START ts=1425625901 → END ts=1427723598 =
**click window 2097.7 ms**: 1517 durational events, 928 RunTask (longest 26.0 ms), 8 UpdateLayoutTree, 2 Layout,
2 Paint, 13,971 CPU samples, DOM chain `pointerdown→mousedown→pointerup→mouseup→click→focus→DOMActivate`.
⚠ Phase letter **not stable**: runs emitted both `ph:"I"` and `ph:"R"` — match by `name`, accept both; counts also drift run-to-run, so treat them as one sample, not a fixed contract.

## Settings selector that worked
`getByRole('button', { name: '设置', exact: true })` → 1 visible match: the sidebar trigger `<button class="VOzbGW_trigger">设置</button>` (accessible name "设置", no aria-label/title); first candidate tried.

## Fix applied: binary-safe read + validate-before-write gate
The reported mojibake traces to my **intermediate** run at 10:12–10:13: the script then wrote the file at line 229
**before** validating it at line 233, so a base64 mis-decode landed on disk and was only replaced once I fixed the
decoding at 10:13:46. Every run since produced a valid file, but that ordering hazard is now eliminated:
1. **Read without UTF-8 decoding:** `Buffer.from(r.data, r.base64Encoded ? 'base64' : 'latin1')` per chunk (Chromium
   reports `base64Encoded:false`; UTF-8 decoding turns invalid bytes into U+FFFD and destroys the payload). Chunks
   concatenate as Buffers, then gzip-sniff `1f 8b` → `zlib.gunzipSync`; the file is written as a **Buffer**.
2. **GATE A validates BEFORE writing** (head contains `traceEvents`, `JSON.parse` succeeds, non-empty) and **GATE B
   re-reads the artifact from disk**, re-parses it and recomputes the grep counts, failing loudly if any required event
   is missing — so a broken capture can no longer reach the artifact path. Gate proof: gzip→lossy-UTF-8 head is
   `1fefbfbd0800000000000003` (the reported `efbfbd` interleaving), which fails both checks; binary-safe read + gunzip recovers it.

## ⚠ Limitation: no `toptask` RunTask variant in this Chromium
Spec expects `RunTask` with `cat` containing `"toptask"` and
`args{task, data:{frame,url,functionName,lineNumber,columnNumber}}`. Here **all 10,479 RunTask events carry
`cat:"disabled-by-default-devtools.timeline"` and `args:{}` (empty)**; `toptask` occurs **0 times**.
Re-probed adding `toplevel,disabled-by-default-toplevel,renderer.scheduler,sequence_manager,blink,v8` — still 0.
**Equivalent attribution exists:** `FunctionCall` (989) carries
`args.data{functionName,url,lineNumber,columnNumber,frame,scriptId}`; `ProfileChunk` (1091, all
`cat:"disabled-by-default-v8.cpu_profiler"`) carries `cpuProfile.nodes` (361 chunks) as
`{id, callFrame:{...}}` plus `cpuProfile.samples` (1091 chunks, **80,471 samples**; ids resolve within the same
chunk): 5107 distinct nodes, 4876 on app URLs, 4212 named. Do not require `args.task` on `RunTask`.

## Wall-clock timeline
```
02:25:22.826 Tracing.start requested/accepted
02:25:22.830 goto start -> 02:25:26.627 done (domcontentloaded+load, HTTP 200, no auth screen)
02:25:26.690 hydration wait 6000 ms -> 02:25:32.691 done
02:25:32.693 performance.mark USER_CLICK_SETTINGS_START
02:25:32.788 click via getByRole(button, 设置, exact)
02:25:34.791 performance.mark USER_CLICK_SETTINGS_END (+2 s after click)
02:25:35.392 Tracing.end -> 02:25:36.087 stream read -> 02:25:36.340 written
02:25:36.468 verified from disk: JSON.parse OK, 103153 events, all gates passed
```
Total ≈ 33 s wall clock.
