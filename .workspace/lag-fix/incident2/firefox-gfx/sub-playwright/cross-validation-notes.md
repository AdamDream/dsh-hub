# Cross-validation: static Gecko fingerprint vs. the user's LIVE Gecko telemetry

Purpose: verify that the literal strings I extracted from `libxul.so` describe the SAME Gecko build
that the user is actually running, and check whether a headless Gecko could have substituted for it.

All content below is quoted from files already on disk (read-only). No browser was launched by this
subagent.

---

## 1. The user's live rendering path, as reported by Gecko itself

Source: `/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/firefox-gfx/raw/newest-main-ping-gfx.json`
(Glean `main` ping, reason `environment-change`, creationDate `2026-09-22T02:12:25.834Z`, captured by a peer agent).

```
"ContentBackend": "Skia",
"Headless": false,
"TargetFrameRate": 60,
"textScaleFactor": 1,
```

GPU adapter (verbatim):

```
"description": "AMD Ryzen 9 9950X 16-Core Processor (radeonsi, raphael_mendocino, LLVM 20.1.2, DRM 3.61, 6.14.0-27-generic)",
"vendorID": "0x1002",
"deviceID": "0x13c0",
"driverVendor": "mesa/radeonsi",
"driverVersion": "25.2.8.0",
"GPUActive": true
```

Monitor (verbatim) — this is the fractional-scaling framebuffer:

```
"screenWidth": 5120,
"screenHeight": 2880,
"defaultCSSScaleFactor": 2,
"contentsScaleFactor": 2
```

gfx features (verbatim):

```
"compositor": "webrender",
"hwCompositing":      { "status": "available" },
"gpuProcess":         { "status": "unused" },
"webrender":          { "status": "available" },
"wrCompositor":       { "status": "blocklisted:FEATURE_FAILURE_WEBRENDER_COMPOSITOR_DISABLED" },
"openglCompositing":  { "status": "available" }
```

`gfx_userPrefs`: `"widget.content.gtk-high-contrast.enabled": true`

## 2. What the static fingerprint confirms

| Live telemetry value | Independent static corroboration |
|---|---|
| `driverVersion` `25.2.8.0`, `driverVendor` `mesa/radeonsi` | `/snap/mesa-2404/1839/meta/snap.yaml` → `version: 25.2.8-snap288`; `libgallium-25.2.8-0ubuntu0.24.04.2.so`; `dri/radeonsi_dri.so -> libdril_dri.so` |
| `wrCompositor: blocklisted:FEATURE_FAILURE_WEBRENDER_COMPOSITOR_DISABLED` | the literal `FEATURE_FAILURE_WEBRENDER_COMPOSITOR_DISABLED` is PRESENT in `/snap/firefox/8863/usr/lib/firefox/libxul.so` (1 occurrence) |
| `Headless: false` | the running process is `/snap/firefox/8863/usr/lib/firefox/firefox` (PID 9042) with a full headed content-process tree |
| `ContentBackend: Skia` | build contains WebRender/Skia content path; `SWGL` present (75 occurrences, 20 word-bounded) |
| `compositor: webrender` | `RenderCompositorEGL` x7, `RenderCompositorNative` x4, `RenderCompositorOGL` x4 compiled in |

**Conclusion:** the strings I read from the snap's `libxul.so` describe exactly the build the user is
running (Firefox 155.0.1, snap revision 8863, BuildID 20260904061719). The `FEATURE_FAILURE_*`
vocabulary I extracted is therefore authoritative for decoding the user's about:support Decision Log.

## 3. Why the headless Gecko evidence is NOT a substitute for the user's path

The peer's headless run emitted, verbatim
(`incident2/gecko-vs-blink/logs/ff-smoke.log`):

```
Crash Annotation GraphicsCriticalError: |[0][GFX1-]: RenderCompositorSWGL failed mapping default framebuffer, no dt (t=0.553111) [GFX1-]: RenderCompositorSWGL failed mapping default framebuffer, no dt
```

So headless Gecko on this host selects `RenderCompositorSWGL` — the pure-software WebRender
compositor. The user's live session instead reports `Headless: false`, a hardware adapter
(`GPUActive: true`, radeonsi/raphael_mendocino), a 5120x2880 buffer downscaled by mutter, and
`openglCompositing: available`. These are different pipelines:

- headless: no X11, no mutter, no EGL-on-radeonsi compositor, no fractional-scale downscale, no
  `gtk-high-contrast`/a11y styling pressure; software SWGL rasterization.
- live: X11 + mutter fractional scaling + radeonsi EGL + the `wrCompositor` blocklist state above.

A headless Gecko probe can therefore characterise the **build** and the **software** path, but it
cannot reproduce or falsify anything about the user's X11/EGL/fractional-scaling rendering path.
