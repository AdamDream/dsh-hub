# Gecko availability + static fingerprint — sub-playwright report

Date: 2026-09-22 ~11:00 (+08:00). Read-only forensics. **No browser was launched by this subagent.**
The user's live Firefox (PID 9042, `/snap/firefox/8863/usr/lib/firefox/firefox`) was verified still
running and was not touched.

---

## (a) Inventory — is an independent Gecko available?

**Result: NO Playwright Firefox exists. One independent Gecko IS reachable by a different mechanism
(the snap's own RemoteAgent).**

### Playwright browser cache — exhaustive

```
$ ls -la ~/.cache/ms-playwright/
chromium-1148
chromium_headless_shell-1148
ffmpeg-1010
.links
```

- `ls -d ~/.cache/ms-playwright/firefox-*` → `没有那个文件或目录` (no such file or directory)
- `find / -maxdepth 4 -type d -name 'firefox-1*'` → (empty)
- `find / -name 'libxul.so'` → only `/snap/firefox/8863/usr/lib/firefox/libxul.so` and `/snap/firefox/6565/usr/lib/firefox/libxul.so`
- `/root/.cache/ms-playwright` → `权限不够` (permission denied)
- `/ms-playwright` → `没有那个文件或目录` (does not exist)
- `PLAYWRIGHT_BROWSERS_PATH` → empty/unset; no `PLAYWRIGHT_*`/`PUPPETEER_*` env vars at all
- `~/.cache/puppeteer` → does not exist
- `.links` content: `/home/CNS2026495165/.npm/_npx/f0a362733743bae2/node_modules/playwright-core`

### Playwright package — IS available (but with no Firefox build)

| Location | Version | Notes |
|---|---|---|
| `/home/CNS2026495165/playwright_scratch/node_modules/playwright` | 1.49.1 | full `playwright` package; usable |
| `/home/CNS2026495165/.npm/_npx/f0a362733743bae2/node_modules/playwright` + `playwright-core` | 1.49.1 | npx cache, also usable |

- `node -e "require('playwright')"` from `/home/CNS2026495165/dsh` → **FAILS**: `Error: Cannot find module 'playwright'` (`MODULE_NOT_FOUND`, requireStack `/home/CNS2026495165/dsh/[eval]`)
- `/home/CNS2026495165/dsh/node_modules` exists but contains **no** playwright/puppeteer
- `npm root -g` → `/home/CNS2026495165/.npm-global/lib/node_modules`; **no** playwright/puppeteer there
- `python3 -c "import playwright"` → `ModuleNotFoundError: No module named 'playwright'`

### The decisive check — Playwright's own answer

```
$ cd /home/CNS2026495165/playwright_scratch && node -e "...pw.firefox.executablePath()..."
playwright version: 1.49.1
firefox.executablePath(): /home/CNS2026495165/.cache/ms-playwright/firefox-1466/firefox/firefox
exists: false
chromium.executablePath(): /home/CNS2026495165/.cache/ms-playwright/chromium-1148/chrome-linux/chrome exists: true
```

**No Playwright Firefox ⇒ STEP 2's gate is false ⇒ the browser part was stopped and STEP 3 done only.**

### Other Gecko sources present on the host

- `/usr/bin/firefox` is a POSIX shell script wrapper that execs the snap (`/snap/bin/firefox`)
- `snap list firefox` → `firefox 155.0.1-1 8863 latest/stable/... mozilla**`
- `/snap/firefox/` holds revisions `6565` and `8863`, `current -> 8863`
- the snap ships **`geckodriver`** (5,956,968 bytes) and a RemoteAgent (demonstrated by a peer, see (d))
- no flatpak, no `/usr/lib/firefox`, no `/opt/firefox`

---

## (b) Headless probe — NOT RUN (honest nulls, no fabricated values)

Every measurement the task requested (`browser.version()`, UA, hardwareConcurrency,
devicePixelRatio, screen.width/height, the three `matchMedia` results, WebGL1/2 context creation,
`gl.getParameter(VERSION/RENDERER/VENDOR/SHADING_LANGUAGE_VERSION)`,
`WEBGL_debug_renderer_info` UNMASKED strings, exact `getContextAttributes()`, Canvas2D availability,
`about:support`, `about:gpu`) is recorded as **`null` in `gecko-headless-probe.json` with the explicit
marker `NOT_RUN`**. Null here means *never attempted*, not *unsupported* or *false*.

`about-support-headless.txt` was **deliberately NOT created**, so its absence cannot be mistaken for a
blank capture. There is no observed reason like "about:support is blank under automation" to report,
because no automation ran.

---

## (c) Static Gecko fingerprint (STEP 3)

### Build identity — `/snap/firefox/8863/usr/lib/firefox/application.ini`

```
[App]
Vendor=Mozilla
Name=Firefox
RemotingName=firefox
Version=155.0.1
BuildID=20260904061719
SourceRepository=https://hg.mozilla.org/releases/mozilla-release
SourceStamp=5fdfd0092780e85643e2cddc0e1b590c8b9ef860
ID={ec8030f7-c20a-464f-9b0e-13a3a9e97384}

[Gecko]
MinVersion=155.0.1
MaxVersion=155.0.1
```

**Yes — there is a `[Gecko]` section, `MaxVersion=155.0.1`.** `platform.ini`: `BuildID=20260904071051`,
`Milestone=155.0.1`. (Playwright Firefox: **no `application.ini` exists** — no build, so no version to report.)

### `libxul.so` and shipped libraries

- `/snap/firefox/8863/usr/lib/firefox/libxul.so` — **183,575,264 bytes**, mtime 2026-09-04 15:14:07 +0800
- `libmozgtk.so` → **PRESENT** (4,384 bytes)
- `libmozwayland.so` → **PRESENT** (13,328 bytes)
- `libGL.so` / `libGL.so.1` / `libEGL.so` / `libEGL.so.1` → **ABSENT** from the firefox dir (as expected for a snap; no libGL/libEGL shipped at all)
- `libc.so.6` (glibc) → **ABSENT** — not bundled; comes from base `core24`
- `libpango-1.0.so.0`, `libfontconfig.so.1`, `libgtk-3.so.0`, `libglib-2.0.so.0` → **ABSENT** — **no bundled pango/fontconfig**
- Only bundled font: `fonts/TwemojiMozilla.ttf` (1,474,284 bytes)
- `dependentlibs.list`: libnspr4, libplc4, libplds4, libmozsandbox, libgkcodecs, liblgpllibs, libnssutil3, libnss3, libsmime3, libmozsqlite3, libssl3, libmozgtk, libmozwayland, libxul

**Mesa comes from a content snap, not from the firefox snap.** `/proc/9042/mounts` shows
`/dev/loop14 /snap/firefox/8863/gpu-2404 squashfs ro` where loop14 = `/snap/mesa-2404/1839`:

- `/snap/mesa-2404/1839/meta/snap.yaml` → `version: 25.2.8-snap288`, "Mesa libraries for core24 snaps"
- `libgallium-25.2.8-0ubuntu0.24.04.2.so` (43,420,304 bytes), `libGL.so.1`, `libEGL.so.1`, `libgbm.so.1`, `libEGL_mesa.so.0`, `libGLX_mesa.so.0`
- drivers: `radeonsi_dri.so -> libdril_dri.so`, `swrast_dri.so -> libdril_dri.so`, `kms_swrast_dri.so`, `zink_dri.so`, … (`libdril_dri.so` 117,064 bytes)
- `drirc.d/00-mesa-defaults.conf` has `<application name="mutter" executable="mutter">` → `adaptive_sync=false`, `v3d_nonmsaa_texture_size_limit=true`; and `<application name="Firefox" executable="firefox">` appears twice (one block `adaptive_sync=false`, one block `no_fp16=true`)

### Requested literal strings in `libxul.so` (occurrence counts)

| Literal | Occurrences |
|---|---|
| `WRWorker#` | **1 (PRESENT)** |
| `WRWorkerLP#` | **0 (ABSENT)** |
| `WRRenderBackend` | **1 (PRESENT)** |
| `WRSceneBuilder` | **2 (PRESENT)** |
| `WrGlyphRasterizer` | **1 (PRESENT)** |
| `RenderCompositorSWGL` | **6 (PRESENT)** |
| `SoftwareVsyncThread` | **1 (PRESENT)** |
| `SWGL` | **75** (20 as a standalone word; the rest are substrings of e.g. `RenderCompositorSWGL`, `RenderCompositorOGLSWGL`) |
| `MOZ_WEBRENDER` | **1 (PRESENT)** |
| `MOZ_X11_EGL` | **1 (PRESENT)** |
| `gfx.webrender.software` | **4 (PRESENT)** |
| `FEATURE_FAILURE_WEBRENDER_COMPOSITOR_DISABLED` | **1 (PRESENT)** |
| `X11_EGL` | **6 (PRESENT)** |

`WRWorkerLP#` being ABSENT while `WRWorker#` is present means this build names its WebRender worker
threads `WRWorker#…` only — it has no low-priority (`LP`) worker pool, so **no `WRWorkerLP#` thread
name can ever appear in this build's thread dumps.**

### Compositor backends actually compiled in (distinct)

```
7 RenderCompositorEGL
6 RenderCompositorSWGL
4 RenderCompositorOGLSWGL
4 RenderCompositorOGL
4 RenderCompositorNative
4 RenderCompositorLayerNative
1 RenderCompositorSetting
```

Also present: `GtkCompositorWidget`, `GtkCompositorWidgetInitData`, `CompositorBridgeParent`,
`CompositorVsyncDispatcher`, `wrCompositor`, `RenderThread` (x17), `CompositorThread` (x3),
`RenderBackend` (x2), `SoftwareVsyncThread` (x1).

### `FEATURE_FAILURE_*` vocabulary — 123 distinct literals

This build can only ever emit these. Useful for decoding the user's about:support Decision Log.
Full list in `libxul-extended-fingerprint.txt`. Directly relevant subset:

```
FEATURE_FAILURE_WEBRENDER_COMPOSITOR_DISABLED   <- the one the user's live session actually reports
FEATURE_FAILURE_WR_DISABLED
FEATURE_FAILURE_WEBRENDER_NEED_HWCOMP
FEATURE_FAILURE_WEBRENDER_OLD_MESA / _OLD_MESA_R600 / _OLD_MESA_OTHER
FEATURE_FAILURE_WEBRENDER_NO_LINUX_ATI
FEATURE_FAILURE_WEBRENDER_EXCESSIVE_RESETS
FEATURE_FAILURE_WEBRENDER_PARTIAL_PRESENT_BUG_1677892
FEATURE_FAILURE_WEBRENDER_BUG_1635186 / _1673939
FEATURE_FAILURE_X11_EGL_NO_LINUX_ATI
FEATURE_FAILURE_EGL / _EGL_CREATE / _EGL_INIT / _EGL_X11 / _EGL_NO_CONFIG / _EGL_LOAD_3 / _EGL_SYM
FEATURE_FAILURE_NO_DMABUF / _NO_DRM_DEVICE / _NO_LIBGBM / _CANT_RESOLVE_ADAPTER
FEATURE_FAILURE_SOFTWARE_GL / _BLOCKLIST_PREF / _BROKEN_DRIVER
FEATURE_FAILURE_NO_HARDWARE_STRETCHING_B
FEATURE_FAILURE_COMP_PREF / _COMP_ENV / _COMP_HEADLESSMODE / _COMP_SAFEMODE
FEATURE_FAILURE_DISABLED_BY_FALLBACK_SOFTWARE_WEBRENDER
FEATURE_FAILURE_DISABLED_BY_GPU_PROCESS_INSTABILITY
```

---

## (d) What could NOT be obtained, and why

1. **Playwright-driven headless Firefox measurements (all of (b))** — no Playwright Firefox build
   exists; `firefox.executablePath()` points at a non-existent directory. Gate condition false.
2. **`about:support` / `about:gpu` dumps from a *Playwright* Gecko** — same reason; never attempted.
3. **Installing a Playwright Firefox** (`npx playwright install firefox`, ~90 MB into
   `~/.cache/ms-playwright/firefox-1466`) — **not attempted**: it writes outside my only permitted
   output directory (a system change), and I was constrained to read-only outside
   `sub-playwright/`. **This is the single command that would unlock the entire STEP 2 probe.**
4. **Launching the snap Firefox headless** — **not attempted**: my constraints explicitly forbid
   `snap run firefox` and launching the user's Firefox. Note this route **does work** on this host
   (see below), it was simply out of scope for me.
5. **`/root/.cache/ms-playwright`** — `权限不够` (permission denied). `/proc/9042/exe` likewise
   `权限不够`, and `grep` over `/proc/9042/maps` returned nothing, so the live process's mapped
   `libGL`/`libEGL`/`libxul` cannot be confirmed directly — only via `/proc/9042/mounts` and
   `/proc/9042/cmdline`, which ARE readable.
6. **No `about:support` capture exists anywhere in `incident2/`** (`find … -iname '*support*'` → empty),
   so I could not cross-read the user's Graphics section from a peer artifact either.

### The route that DOES work (found in a peer artifact, not executed by me)

`incident2/gecko-vs-blink/` proves an independent headless Gecko is launchable via the snap's own
RemoteAgent/WebDriver BiDi. Verbatim from `logs/ff-smoke.log`:

```
[307734] Sandbox: CanCreateUserNamespace() unshare(CLONE_NEWPID): EPERM
*** You are running in headless mode.
WebDriver BiDi listening on ws://127.0.0.1:18831
1790045971683	RemoteAgent	INFO	Perform WebSocket upgrade for incoming connection from 127.0.0.1:37704
Crash Annotation GraphicsCriticalError: |[0][GFX1-]: RenderCompositorSWGL failed mapping default framebuffer, no dt (t=0.553111) [GFX1-]: RenderCompositorSWGL failed mapping default framebuffer, no dt
```

Peer protocol gate: `research-v2/.probe.lock` — **observed FREE at 11:00** (dir exists, empty). Peer
owner note `gecko-vs-blink/logs/preempted-owner-284598.txt` states "single browser at a time; releases
with `rm owner.txt && rmdir`; hard cap 30min". **No BiDi listener on 18831 or 9222 is currently alive**,
so no stray headless Gecko is running now.

---

## (e) Limitation statement — what a headless Gecko can and cannot prove

**It cannot stand in for the user's rendering path.** The peer's own headless run selected
`RenderCompositorSWGL` and failed to map a backbuffer (`GFX1 … no dt`), i.e. the **pure-software
WebRender compositor**. The user's live session reports `Headless: false`, `GPUActive: true` on
`radeonsi, raphael_mendocino`, `openglCompositing: available`, a 5120x2880 buffer at
`contentsScaleFactor: 2`, and `wrCompositor: blocklisted:FEATURE_FAILURE_WEBRENDER_COMPOSITOR_DISABLED`.

Headless Gecko has: no X11 display, no mutter, no fractional-scale downscale of a 5120x2880 buffer,
no radeonsi EGL compositor, no GTK a11y (`gtk-high-contrast`) styling pressure. It therefore
**cannot** reproduce, confirm, or refute any hypothesis about bilinear-downscale cost, EGL/radeonsi
compositing, mutter interaction, or a11y-induced restyling.

**What it CAN establish** (and what the static fingerprint establishes outright):

- which code paths / compositor backends this exact build contains (done here, no browser needed);
- which thread-pool and vsync thread names this build can produce (`WRWorker#` yes, `WRWorkerLP#` no);
- the complete set of 123 `FEATURE_FAILURE_*` codes available to decode a Decision Log;
- that the software path is functional-but-degraded, and that Gecko's own auto-fallback to SWGL is
  the expected behaviour in a headless/X11-less environment.

**Bottom line for the orchestrator:** a headless Gecko probe would have produced **build-level and
software-path** facts only — the same class of facts already obtained statically and for free in (c).
The user's actual X11/EGL/fractional-scaling path must be characterised from the live process and its
telemetry, which is exactly what `firefox-gfx/raw/newest-main-ping-gfx.json` and the peer's
`gfx-stack/` artifacts already provide. Spending an authorised browser launch on a Playwright Firefox
install would buy little beyond what (c) already proves.

---

## Artifacts written (all under `sub-playwright/`)

| Path | Contents |
|---|---|
| `inventory-playwright-firefox.txt` | raw commands + verbatim output proving no Playwright Firefox |
| `static-snap-firefox-libs.txt` | application.ini/platform.ini/dependentlibs.list, libxul size, presence matrix, mesa search |
| `libxul-literals.txt` | the 13 requested literals with occurrence counts, plus SW-standalone and WR* dumps |
| `libxul-extended-fingerprint.txt` | compositor backends, vsync/render thread names, all 123 `FEATURE_FAILURE_*` |
| `gecko-headless-probe.json` | STEP 2 status `NOT_RUN`, all requested fields explicitly `null` + evidence |
| `cross-validation-notes.md` | live telemetry vs static fingerprint cross-check |
| `REPORT.md` | this report |

Deliberately **not** created: `about-support-headless.txt` (no Gecko ran; absence is intentional and
documented in the JSON).
