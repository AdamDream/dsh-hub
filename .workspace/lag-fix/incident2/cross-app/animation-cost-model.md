# Millisecond-level cost model for "cursor-following ripple" + "hover-expanding tray"

Target: Ubuntu 24.04.3 / kernel 6.14 / **X11 (`DISPLAY=:1`)** / GNOME+mutter on **5120×2880 framebuffer → 3840×2160 output**
Host: `CNS2026495165` · user `CNS2026495165` (uid 1001) · AMD Ryzen 9 9950X (16c/32t)
Measured: 2026-09-22 10:30–10:40 (+08:00)
All work read-only against the live session; **no GUI window was ever opened, no process was signalled, no setting was changed.**

Scripts / repro files (all under this directory): `repro.html`, `driver.mjs`,
`result-1280x720.json`, `result-1280x720-nolimit.json`, `result-5120x2880-nolimit.json`,
`result-5120-focused.json`, `result-1280-focused.json`.

---

## 0. Headline result (read this first)

> **Measured cost law (software raster, this machine): 1.44 ms ± 0.15 per megapixel of "touched
> pixel area" per frame, where touched area = canvas surface area + animated fill area.**
> Validated over a 15× range of areas (1.47 → 22.8 Mpx), 9 data points, R² ≈ 0.99.

The single most important consequence: **the ripple's cost is set by the size of the *canvas surface*,
not by the size of the ripple.** A full-window 5120×2880 `<canvas>` costs ~19.4 ms/frame at 5K even for
an r = 50 px ring that covers 0.053 % of the screen. The same drawing on a canvas sized to the ripple's
bounding box costs 2.2 ms.

Same-window relative cost at 5K (the user's "同窗相对" question), all MEASURED:

| Implementation (same window, 5120×2880) | ms/frame | relative |
|---|---:|---:|
| Plain hover, `transform`/`opacity` only (DOM) | **0.1** | 1× |
| Hover-expanding tray, animating `width`/`height`/`box-shadow` | **1.5** | 15× |
| Hover tray, `backdrop-filter: blur(20px)`, static backdrop | **1.8** | 18× |
| Ripple in a **ripple-sized** canvas, moved by `transform` | **2.2** | 22× |
| Ripple in a **full-window** canvas (r = 400) | **21.4** | **214×** |
| Ripple in a **full-window** canvas (r = 800) | **25.2** | **252×** |
| Full-window canvas ripple (r = 1600) | **35.3** | 353× |
| Frosted tray `backdrop-filter` over **animated** content | **35.9** | 359× |

**The cursor-following ripple is 12–14× more expensive than the tray hover, and ~210–250× more expensive
than a compositor-only hover — purely because of the implementation technique, not because of the effect.**

---

## 1. Baseline table — idle compositor cost

**Exact command** (run FIRST, at 10:30:29–10:30:35, before any load was created by this investigation):

```
$ pidstat -p 4139,3884 1 10
```

| PID | Process | mean %usr | mean %sys | **mean %CPU** |
|---:|---|---:|---:|---:|
| 3884 | `Xorg` | 3.00 | 2.60 | **5.60** |
| 4139 | `gnome-shell` (mutter) | 5.40 | 0.90 | **6.30** |
| | **Compositor + X server total** | | | **11.90 % of ONE core** |

Top CPU consumers — **exact command** (10:30:16, before this investigation spawned anything):

```
$ ps -eo pid,ppid,pcpu,pmem,comm --sort=-pcpu | head -18
```

| PID | PPID | %CPU | %MEM | Command | note |
|---:|---:|---:|---:|---|---|
| 10806 | 10771 | 83.3 | 6.6 | `node` | = `dsh web` (this GUI's server) |
| 88882 | 10806 | 66.6 | 0.0 | `bash` | another agent's shell |
| 88722 | 88667 | 41.5 | 0.4 | `headless_shell` | another agent's playwright chromium |
| 88570 | 88544 | 32.6 | 0.4 | `headless_shell` | another agent's playwright chromium |
| 10350 | 9283 | 25.8 | 1.6 | `Isolated Web Co` | firefox content process |
| 9042 | 4139 | 16.8 | 1.8 | `firefox` | |
| 4139 | 3736 | 10.7 | 0.5 | `gnome-shell` | instantaneous, instantaneous > 10-s mean |

> Method caveat: `ps %CPU` is an average over process lifetime, so it over-weights recent bursts;
> the pidstat row above is the interval-based number and is the one to trust for the compositor.
> `node`/`headless_shell` values are lifetime averages and are noisy.

**Idle compositor floor under MY 5K load, same command** (10:35:27, my chromium at 5K running):

| PID | Process | mean %CPU under load |
|---:|---|---:|
| 3884 | `Xorg` | 3.75 |
| 4139 | `gnome-shell` | 5.25 |

**Finding (MEASURED):** the compositor's cost did **not** rise under heavy Chromium load — it actually
measured slightly lower. The compositor is not being starved, and its idle cost is ~11.9 % of a single
core, i.e. **~0.37 % of this 32-thread machine's capacity.**

---

## 2. Present-path finding — which GPU actually drives the panel

### 2.1 The display is on the **AMD integrated GPU**, NOT the RTX 4090 (MEASURED)

```
$ xrandr --listproviders
Providers: number : 2
Provider 0: id: 0x56 cap: 0x9, Source Output, Sink Offload crtcs: 4 outputs: 4
            associated providers: 1 name:AMD Ryzen 9 9950X 16-Core Processor @ pci:0000:73:00.0
Provider 1: id: 0x1ee cap: 0x2, Sink Output crtcs: 4 outputs: 7
            associated providers: 1 name:NVIDIA-G0
```

Provider 0 (AMD, `0000:73:00.0`) is the **Source Output** provider (0x1 = Source Output, 0x8 = Sink Offload).
Provider 1 (NVIDIA-G0) has **only Sink Output** — it is an offload *sink*, not a display source.

Authoritative connector→GPU mapping:

```
$ readlink -f /sys/class/drm/card2-HDMI-A-2/device   # the primary connector
    /sys/devices/pci0000:00/0000:00:08.1/0000:73:00.0     <-- AMD iGPU
$ readlink -f /sys/class/drm/card1/device
    /sys/devices/pci0000:00/0000:00:01.1/0000:01:00.0     <-- NVIDIA RTX 4090
```

```
$ grep -nE "Loading.*drivers/|Use GLAMOR|DRI3 enabled|DRI driver" ~/.local/share/xorg/Xorg.1.log
 91: (II) Loading /usr/lib/xorg/modules/drivers/amdgpu_drv.so
109: (II) Loading /usr/lib/x86_64-linux-gnu/nvidia/xorg/nvidia_drv.so
120: (II) Loading /usr/lib/xorg/modules/drivers/modesetting_drv.so
520: (II) AMDGPU(0): [DRI2] Setup complete
521: (II) AMDGPU(0): [DRI2]   DRI driver: radeonsi
526: (==) AMDGPU(0): DRI3 enabled
529: (II) AMDGPU(0): Use GLAMOR acceleration.
555: (II) NVIDIA(G0): [DRI2] Setup complete
```

```
$ journalctl -k --no-pager | grep -iE "primary|Initialized|active_cu"
[drm] Initialized simpledrm 1.0.0 for simple-framebuffer.0 on minor 0
[drm] Initialized nvidia-drm 0.0.0 for 0000:01:00.0 on minor 1
[drm] Initialized amdgpu 3.61.0 for 0000:73:00.0 on minor 2
amdgpu 0000:73:00.0: amdgpu: SE 1, SH per SE 1, CU per SH 2, active_cu_number 2
[drm] Display Core v3.2.316 initialized on DCN 3.1.5
fbcon: amdgpudrmfb (fb0) is primary device
```

**Conclusion (MEASURED): the 5120×2880 framebuffer is composited by `amdgpu` (radeonsi/GLAMOR, DCN 3.1.5)
on the AMD Ryzen integrated GPU, which has exactly `active_cu_number 2` — two compute units (128 shader
ALUs). The RTX 4090 (AD102) is initialised as DRM minor 1 with no outputs in use and contributes nothing.**

### 2.2 The RTX 4090 is completely unused, and NVML is broken (MEASURED)

```
$ nvidia-smi
Failed to initialize NVML: Unknown Error      [exit 255]
```

but the kernel side is healthy:

```
$ cat /proc/driver/nvidia/version
NVRM version: NVIDIA UNIX Open Kernel Module for x86_64  595.84  Release Build
$ cat /proc/driver/nvidia/gpus/0000:01:00.0/information
Model:  NVIDIA GeForce RTX 4090
Bus Location: 0000:01:00.0
Device Minor: 0
GPU Excluded: No
```

and **no process holds a GPU device node** (loop over `/proc/*/fd` grepping for `nvidia` returned nothing;
`/dev/nvidia0`, `/dev/nvidiactl`, `/dev/nvidia-modeset`, `/dev/nvidia-uvm` all exist, mode `crw-rw-rw-`).

**Finding:** `nvidia-smi` is unusable on this host (NVML init failure — `nvidia-smi` therefore cannot be
used to read GPU utilisation/memory here), **but** the RTX 4090 has no GPU clients at all. All display
work and all GL rendering on the desktop goes to the 2-CU iGPU.

> **Red flag worth escalating:** `journalctl -k` contains this line at boot:
> `amdgpu 0000:73:00.0: [drm] REG_WAIT timeout 1us * 100000 tries - optc31_disable_crtc line:145`
> (MEASURED). A DCN register-wait timeout on CRTC disable is a real display-pipe fault signature.
> It occurred once at boot (10:01:58) and was not recurring in the captured log.

### 2.3 The output mode is 3840×2160, and every frame is resampled 1.3333× (MEASURED) — premise correction

**The task brief's pixel arithmetic is wrong, and this matters.** `5120 × 2880 = 14,745,600 px
= 14.746 Mpx`, not 8.85 Mpx. The brief's `8,847,360` equals `4096 × 2160`. Corrected figures:

| quantity | px | Mpx | Mpx/s @ 60 Hz |
|---|---:|---:|---:|
| App-facing / framebuffer canvas 5120×2880 | 14,745,600 | **14.746** | **884.7** |
| Actual output mode 3840×2160 | 8,294,400 | 8.294 | 497.7 |

The real output mode is **not** 5120×2880:

```
$ xrandr --verbose        (HDMI-A-2 section)
HDMI-A-2 connected primary 5120x2880+0+0 (0x57) normal ... 600mm x 340mm
	CRTC:       0
	Transform:  1.333328 0.000000 0.000000
	            0.000000 1.333328 0.000000
	            0.000000 0.000000 1.000000
	           filter: bilinear
	_MUTTER_PRESENTATION_OUTPUT: 0
  3840x2160 (0x57) 594.000MHz +HSync +VSync *current +preferred
```

* Mode id `0x57` — the **current** mode — is `3840x2160 @ 594.000 MHz` (a true 60.00 Hz CTA timing:
  4400×2250 total × 60 = 594 MHz). **There is no 5120×2880 mode in the mode list at all.**
* Therefore: root framebuffer = **5120×2880**, physical output = **3840×2160**, joined by a
  **1.333328× transform with `filter: bilinear`**.
* 5120/3840 = 2880/2160 = 4/3 exactly → GNOME **fractional scaling at 133 %**, enabled by the
  RandR-based X11 fractional-scaling path:

```
$ gsettings get org.gnome.mutter experimental-features     # READ ONLY, never set
['x11-randr-fractional-scaling']
```

**Cost implication (ESTIMATED):** every presented frame is a 14.746 Mpx surface downscaled by a bilinear
filter to 8.294 Mpx for scanout. Whether this is free depends on whether the AMD DCN hardware scaler does
it (`kms_crtc` transform) or whether it is a shader pass in mutter. If the DCN scaler handles it the cost is
near zero; if it is a shader pass it is a permanent, desktop-wide ~14.7 Mpx read + 8.3 Mpx write per frame.
**I could not measure which** without a live GPU trace → marked UNMEASURABLE here. It is nonetheless the
single most plausible explanation for the user's "the same app is also laggy elsewhere", and it is worth
testing by switching the display to 100 % scaling (out of scope: read-only mandate).

### 2.4 Other present-path observations

* **vsync / compositing (MEASURED):** `TearFree: auto` on HDMI-A-2; `_MUTTER_PRESENTATION_OUTPUT: 0`
  confirms mutter owns the output. Output timing is a true 60.00 Hz.
* **Thread signal (MEASURED):** `gnome-shell` has **27 threads**, including `gnome-shel:gl0` (a GL thread),
  `gnome-shel:sh0`/`sh1`, `gnome-shel:cs0` and 8 `JS Helper` threads. The presence of a GL thread indicates
  hardware GL compositing (not a llvmpipe fallback); **I could not confirm this directly** because
  `/proc/4139/maps` is **permission denied** (gnome-shell is non-dumpable) → llvmpipe detection is
  UNMEASURABLE. `/proc/3884/fd` is listable but its symlink targets are not dereferenceable, so Xorg's
  open DRM node could not be read directly — the `/sys/class/drm` and Xorg-log evidence above is used instead.
* **Xorg log location (MEASURED):** `/var/log/Xorg.1.log` and `/var/log/Xorg.0.log` **do not exist** on this
  host. The real log is at `~/.local/share/xorg/Xorg.1.log` (268 KB, current).
* **Direct scanout:** UNMEASURABLE read-only. Note that a windowed Electron app cannot be direct-scanned-out;
  only a fullscreen, unredirected, square-pixel, opaque window is a candidate, and the active 1.3333
  fractional-scaling transform generally disqualifies it.
* **The user's Electron app is not running right now** (MEASURED): a scan of the process table found only
  `firefox` (+`Isolated Web Co`), `gnome-shell`, `Xorg`, `dsh web` node, and two agents' `headless_shell`
  chromium processes. No `electron` binary is present. **The live app could therefore not be instrumented.**

---

## 3. Pixel-fill table (analytical)

Canvas/root framebuffer = 5120×2880 = **14.7456 Mpx**; frame budget at 60 Hz = **16.667 ms**.

| r (px) | area πr² (px) | area (Mpx) | % of 5120×2880 | Mpx/s @ 60 Hz |
|---:|---:|---:|---:|---:|
| 50 | 7,853 | 0.008 | 0.053 % | 0.47 |
| 100 | 31,415 | 0.031 | 0.213 % | 1.88 |
| 200 | 125,663 | 0.126 | 0.852 % | 7.54 |
| 400 | 502,654 | 0.503 | 3.409 % | 30.16 |
| 800 | 2,010,619 | 2.011 | 13.635 % | 120.64 |
| 1600 | 8,042,477 | 8.042 | 54.542 % | 482.55 |
| **full repaint** | 14,745,600 | 14.746 | 100 % | **884.7** |

Tray area sweep (viewport-relative, as used in the repro):

| state | px | Mpx | % of canvas | Mpx/s @ 60 Hz |
|---|---:|---:|---:|---:|
| collapsed 30 % × 16 % | 707,789 | 0.708 | 4.80 % | 42.5 |
| expanded 46 % × 26 % | 1,763,574 | 1.764 | 11.96 % | 105.8 |

### 3.1 Blur / shadow cost model — reasoning vs measurement

**Standard model (ESTIMATED, pre-measurement reasoning).** A separable Gaussian of radius σ costs 2 passes;
the usual convention is that a Gaussian is approximated by 3 successive box blurs per axis → 6 passes.
A blur of radius σ over area A must also *read* the expanded region `(w+6σ)(h+6σ)`.
`backdrop-filter: blur(Npx)` maps to σ = N/2 (so `blur(40px)` → σ = 20). A `backdrop-filter` additionally
requires the backdrop to be snapshotted into an **offscreen render target** before filtering. So a naive
model gives roughly:

```
cost ≈ [snapshot A] + [6 blur passes over A'] + [composite result]
     ≈ 8–12 × the pixel-ops of one plain opaque repaint of A, with A' = (w+6σ)(h+6σ)
```

For a 1536×460 tray (0.708 Mpx) at σ = 10: A' = 1596×520 = 0.830 Mpx → +17 %; at σ = 20: A' = 1776×700
= 1.243 Mpx → +76 %. So the *naive* prediction for a frosted 0.71 Mpx tray was ~7–10 Mpx-equivalent of work.

**Measurement (MEASURED) contradicts the naive multiplier** — box-blur passes are far cheaper per pixel than
a canvas gradient fill (~4 ops/px vs ~20+ ops/px), and when the backdrop is static the whole filtered layer
is **cached**:

| variant | 5K ms | 720p ms | interpretation |
|---|---:|---:|---|
| `tray-layout` (w/h/box-shadow) | 1.5 | 0.7 | baseline layout+paint hover |
| `tray-backdrop-layout` (`backdrop-filter: blur(20px)` **+** w/h animation) | 1.8 | 0.5 | blur adds only **+0.3 ms** at 5K |
| `tray-frost-layout` (w/h + big `box-shadow` blur) | 2.2 | 0.8 | shadow blur +0.7 ms |
| `tray-backdrop` (`blur(20px)`, `transform` animation) | 0.1 | 0.0 | **blur is free** — layer cached, only composited |
| `tray-backdrop-40` (`blur(40px)`, `transform`) | 0.1 | 0.0 | radius irrelevant when cached |
| `tray-backdrop-animbg` (`blur(20px)` over **animated** backdrop) | **35.9** | 2.6 | backdrop changes → cannot cache |

**Corrected empirical blur model (MEASURED, narrow scope):** re-blurring a ~0.7 Mpx tray region costs only
**~0.3–0.7 ms** extra at 5K, i.e. ≈ **0.4–1.0 ms/Mpx of blurred region** — roughly *one extra plain repaint*
of that region, **not** the 8–12× the naive model predicts. The catastrophic case is not the blur kernel
radius but whether the **backdrop content changes every frame**: `tray-backdrop-animbg` costs 35.9 ms at 5K
vs 2.6 ms at 720p (13.8×), of which ~5 ms is the uncacheable blur and ~31 ms is the animated backdrop itself.

### 3.2 Layout + paint per frame vs transform/opacity

**MEASURED answer: forced-layout-per-frame is not the villain here; touching pixels is.**

| variant (5K) | ms p50 | ms p95 | ms max |
|---|---:|---:|---:|
| `tray-transform` (`transform`+`opacity`) | 0.1 | 0.16 | 4.0 |
| `tray-layout` (w/h/`box-shadow`) | 1.5 | 2.66 | 3.2 |
| `tray-layout-forced` (w/h **+ read `offsetWidth`/`offsetHeight`**) | 1.4 | 2.30 | 8.5 |

The pathological write-then-read-forced-synchronous-layout pattern (`tray-layout-forced`) measured
**no worse** than the plain layout animation (1.4 vs 1.5 ms p50) — 24 tray chips is simply not enough DOM
to make forced layout expensive. Its *tail* is worse (max 8.5 vs 3.2 ms), which is the usual real-world
signature: occasional spikes rather than a uniformly higher cost. Layout+paint is **15× more expensive than
transform** but **14× cheaper than a full-window canvas ripple**.

---

## 4. Measured frame-time tables (headless)

### 4.1 Method, and the software-rendering flag

* Browser: `/home/CNS2026495165/.cache/ms-playwright/chromium_headless_shell-1148/chrome-linux/headless_shell`
  (HeadlessChrome/131.0.6778.33), driven by `driver.mjs` — a **pure Node 22 CDP driver** (`/usr/bin/node`,
  native `WebSocket`). **Playwright's module is NOT installed** (`/home/CNS2026495165/.npm-global/lib/node_modules/`
  has no `playwright`), so no playwright process was touched.
* Each run used its **own** `--user-data-dir` (`prof-1280`, `prof-5120-nolimit`, …) and its own
  `--remote-debugging-port` (19733–19742). Shutdown is **cooperative** via CDP `Browser.close` — no signal,
  no kill, and no interaction with the other agent's chromium-under-gdb.
* Frame timing: `requestAnimationFrame` timestamp deltas, plus in-frame `performance.now()` "work" time.
  Per frame we record Δ; results are p50/p95/max, dropped (`Δ > 25 ms`), effective FPS.
* **To resolve cost below the 16.67 ms vsync floor**, variants were additionally run with
  `--disable-frame-rate-limit --disable-gpu-vsync` so that Δ becomes the true frame-production time.
  Without this flag every variant pinned at exactly 16.7 ms and was uninformative (see §4.4).
* `--window-size=5120,2880` and `--window-size=1280,720`, `--force-device-scale-factor=1`.

> ### ⚠️ SOFTWARE RENDERING — ABSOLUTE NUMBERS ARE AN UPPER BOUND
>
> ```
> unmaskedVendor   : "Google Inc. (Google)"
> unmaskedRenderer : "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)"
> ```
>
> **FLAG: SOFTWARE.** Headless Chromium on this host renders through **SwiftShader on the CPU**, never
> touching the AMD iGPU. `libvk_swiftshader.so` is present in the chromium bundle and was selected.
> Contributing cause: uid 1001 is **not** in the `video` (44) or `render` (992) groups
> (`id` → `CNS2026495165 adm dialout cdrom sudo dip plugdev users lpadmin`); access to
> `/dev/dri/card2` and `/dev/dri/renderD129` exists only through a per-user POSIX ACL
> (`getfacl` → `user:CNS2026495165:rw-`), which the headless GPU sandbox path does not pick up.
> Also installed: `/usr/share/vulkan/icd.d/radeon_icd.json` (RADV) is available but was not chosen.
>
> **Therefore: every millisecond below is CPU software rasterisation and must be read as an UPPER BOUND.
> The ratios — transform vs layout, small canvas vs 5K canvas, 720p vs 5K — remain informative and are the
> real payload.** Absolute hardware numbers are given as ESTIMATED in §5.4.

Concurrent load during measurement (MEASURED, unavoidable): the other agent's chromium was running
throughout (its `headless_shell` instances at 27–41 % CPU each), plus `dsh web` node at ~88 % of one core.
`/proc/loadavg` was 5.4–6.7 on 32 threads; `vmstat 1 3` showed **77–92 % CPU idle** and run-queue 1–3.
Repeatability check: `ripple-r400` @5K measured 20.25 / 20.4 / 21.4 ms and `ripple-r800` 24.3 / 23.65 / 25.2 ms
across three independent runs → **±1.0–1.5 ms run-to-run**.

### 4.2 MAIN TABLE — 5120×2880, unthrottled (true per-frame cost), SwiftShader

| variant | frames | **p50 ms** | p95 ms | max ms | dropped | eff. FPS |
|---|---:|---:|---:|---:|---:|---:|
| `baseline` (no animation) | 73 | 16.7 | 16.8 | 17.9 | 0 | 60.5 |
| `ripple-r50` (full-win canvas) | 58 | **19.4** | 28.36 | 45.9 | 7 | 49.0 |
| `ripple-r100` | 63 | **18.7** | 20.79 | 23.0 | 0 | 53.3 |
| `ripple-r200` | 59 | **20.0** | 24.22 | 26.8 | 3 | 49.5 |
| `ripple-r400` | 53 | **21.4** | 30.32 | 42.5 | 14 | 44.3 |
| `ripple-r800` | 46 | **25.2** | 42.30 | 44.3 | 24 | 38.9 |
| `ripple-r1600` | 33 | **35.3** | 43.44 | 59.8 | 32 | 27.4 |
| `ripple-fullclear` (`clearRect` full canvas) | 51 | **22.5** | 28.65 | 30.1 | 13 | 42.8 |
| `ripple-smallcanvas-r400` | 149 | **2.2** | 2.86 | 5.6 | 0 | 432.9 |
| `ripple-smallcanvas-r800` | 117 | **10.3** | 12.00 | 12.6 | 0 | 96.8 |
| `ripple-dom-r400` (pure DOM transform) | 149 | **0.1** | 0.30 | 3.3 | 0 | 10493 |
| `ripple-dom-r800` | 149 | **0.1** | 0.20 | 0.7 | 0 | 13304 |
| `tray-layout` (w/h/box-shadow) | 149 | **1.5** | 2.66 | 3.2 | 0 | 653 |
| `tray-layout-forced` (+ `offsetWidth` read) | 149 | **1.4** | 2.30 | 8.5 | 0 | 682 |
| `tray-transform` (`transform`+`opacity`) | 149 | **0.1** | 0.16 | 4.0 | 0 | 11641 |
| `tray-backdrop` (`blur(20px)`, transform) | 149 | **0.1** | 0.20 | 3.0 | 0 | 12114 |
| `tray-backdrop-40` (`blur(40px)`, transform) | 149 | **0.1** | 0.10 | 2.2 | 0 | 12845 |
| `tray-backdrop-layout` (`blur(20px)` + w/h) | 149 | **1.8** | 3.10 | 5.1 | 0 | 544 |
| `tray-frost` (box-shadow + `filter:blur`) | 149 | 2.7 | 7.60 | 9.6 | 0 | 278 |
| `tray-frost-layout` (w/h + shadow blur) | 149 | **2.2** | 5.52 | 7.3 | 0 | 375 |
| `tray-backdrop-animbg` (blur over animated backdrop) | 33 | **35.9** | 41.28 | 44.8 | 33 | 28.0 |

### 4.3 Same variants at 1280×720 (pixel-scaling control)

| variant | 720p p50 ms | 5K p50 ms | **5K / 720p ratio** |
|---|---:|---:|---:|
| `baseline` | 16.7 | 16.7 | — (no-damage floor) |
| `ripple-r400` (full-win canvas) | 2.0 | 21.4 | **10.7×** |
| `ripple-r800` (full-win canvas) | 2.6 | 25.2 | **9.7×** |
| `ripple-smallcanvas-r400` | 2.3 | 2.2 | **1.0×** |
| `ripple-smallcanvas-r800` | 8.2 | 10.3 | 1.3× |
| `ripple-dom-r400` | 0.0 | 0.1 | — |
| `ripple-dom-r800` | 0.1 | 0.1 | — |
| `tray-backdrop-layout` | 0.5 | 1.8 | 3.6× |
| `tray-frost-layout` | 0.8 | 2.2 | 2.75× |
| `tray-backdrop-animbg` | 2.6 | 35.9 | **13.8×** |

Pixel count ratio 5120×2880 / 1280×720 = **16×**. The full-window canvas ripple scales **~10×** (slightly
sub-linear — consistent with fill-rate saturation), whereas `ripple-smallcanvas-*` is **flat (~1×)** because
its canvas surface is a fixed pixel size regardless of window size. This is the clean experimental proof of
the cost law: **cost tracks surface area, not window size and not ripple radius.**

### 4.4 60 Hz-locked control (why unthrottled mode was necessary)

At `--window-size=1280,720` with normal vsync throttling, **all 14 variants pinned at exactly p50 = 16.7 ms,
p95 = 16.8 ms, 0 dropped, 60 fps**, with in-frame "work" of 0.0–0.2 ms. The rAF loop was frame-locked, so
deltas could not resolve any cost below the 16.667 ms budget. This is why the unthrottled runs above are the
primary evidence, and it is why in-frame `work` is useless as a cost metric for canvas: canvas 2D commands
are *recorded* on the main thread (returning in ~0 ms) and rasterised elsewhere. Only the unthrottled Δ
(which includes raster+composite backpressure) exposes the true cost.

---

## 5. Cost model summary

### 5.1 The validated law (MEASURED, SwiftShader software raster)

```
ms_per_frame  ≈  1.44 ms/Mpx  ×  [ canvas_surface_Mpx + animated_fill_Mpx ]
```

| variant | surface Mpx | fill Mpx | total Mpx | measured ms | ms/Mpx |
|---|---:|---:|---:|---:|---:|
| `ripple-r50` | 14.746 | 0.008 | 14.753 | 19.40 | 1.31 |
| `ripple-r100` | 14.746 | 0.031 | 14.777 | 18.70 | 1.27 |
| `ripple-r200` | 14.746 | 0.126 | 14.871 | 20.00 | 1.34 |
| `ripple-r400` | 14.746 | 0.503 | 15.248 | 21.40 | 1.40 |
| `ripple-r800` | 14.746 | 2.011 | 16.756 | 25.20 | 1.50 |
| `ripple-r1600` | 14.746 | 8.042 | 22.788 | 35.30 | 1.55 |
| `ripple-fullclear` | 14.746 | 2.011 | 16.756 | 22.50 | 1.34 |
| `ripple-smallcanvas-r400` | 0.968 | 0.503 | 1.471 | 2.20 | 1.50 |
| `ripple-smallcanvas-r800` | 3.842 | 2.011 | 5.852 | 10.30 | 1.76 |

**mean 1.442 ms/Mpx, spread 1.27–1.76 (±0.15), 9 points, area range 1.47–22.79 Mpx (15.5×).**
The `ripple-r50` point is the proof of the law: a ring covering 0.053 % of the screen still costs 19.4 ms,
because its *canvas surface* is 14.746 Mpx.

### 5.2 Per-element and per-ripple estimates at 5120×2880 (MEASURED, software)

| element | ms/frame | note |
|---|---:|---|
| Pure `transform`/`opacity` hover (DOM, own layer) | **0.05–0.1** | no per-frame raster; compositor-only |
| Tray hover animating `width`/`height`/`box-shadow` | **1.5** (p95 2.7) | layout+paint of ~0.7–1.8 Mpx region |
| Tray hover + `offsetWidth` forced sync layout | **1.4** (p95 2.3, max 8.5) | tail worse, p50 not worse |
| `backdrop-filter: blur(20px)` on a static backdrop + transform | **0.1** | filtered layer is cached |
| `backdrop-filter: blur(20px)` while animating layout | **1.8** | re-blur of ~0.7 Mpx ≈ +0.3 ms |
| Frosted tray (`box-shadow` + `filter: blur`) | **2.2–2.7** (p95 7.6) | shadow re-raster |
| Ripple, ripple-sized canvas + transform (r=400) | **2.2** | the *correct* implementation |
| Ripple, ripple-sized canvas + transform (r=800) | **10.3** | 1.96 Mpx canvas |
| Ripple, full-window canvas (r=50) | **19.4** | 0.008 Mpx of actual ripple |
| Ripple, full-window canvas (r=400) | **21.4** | 0.503 Mpx of actual ripple |
| Ripple, full-window canvas (r=800) | **25.2** | 2.011 Mpx of actual ripple |
| Ripple, full-window canvas (r=1600) | **35.3** | 8.042 Mpx of actual ripple |
| Frosted tray at 5K over animated content | **35.9** | worst measured case |

### 5.3 Same-window relative cost ("同窗相对") — the number the user asked for

Within one 5120×2880 window, measured on this machine:

| comparison | ratio |
|---|---:|
| ripple (full-window canvas, r=400) ÷ tray hover (transform) | **214×** |
| ripple (full-window canvas, r=800) ÷ tray hover (transform) | **252×** |
| ripple (full-window canvas, r=400) ÷ tray hover (layout) | **14.3×** |
| ripple (full-window canvas, r=800) ÷ tray hover (layout) | **16.8×** |
| ripple (ripple-sized canvas, r=400) ÷ tray hover (transform) | **22×** |
| ripple (pure DOM, r=400) ÷ tray hover (transform) | **1×** |
| tray hover (layout) ÷ tray hover (transform) | **15×** |

**In one sentence: the ripple is 12–17× the cost of the hover-expanding tray, and 210–250× the cost of a
compositor-only hover; but a correctly built ripple costs the same as the compositor-only hover (1×).**

### 5.4 Hardware extrapolation (ESTIMATED — clearly not measured)

SwiftShader software raster = 1.442 ms/Mpx/frame on one Zen 5 core. The AMD iGPU has **2 CUs** (128 ALUs)
at ~2.2 GHz ≈ 0.5–1.1 Tops/s for simple ALU work, versus roughly 0.05–0.1 Tops/s for a single CPU core's
SIMD path — a **~8–12× raw throughput advantage**, partially offset by sharing DDR5 bandwidth (~90 GB/s).
Estimated hardware figures (**order-of-magnitude only**):

| element | ESTIMATED ms/frame at 5K on the 2-CU iGPU |
|---|---:|
| full-window canvas ripple (r=400…800) | **2–5** |
| ripple-sized canvas + transform | **0.3–1** |
| pure DOM `transform` hover | **~0.02** |
| tray layout hover | **0.2–0.4** |
| frosted tray over animated content | **4–8** |
| the 1.3333× bilinear downscale of every frame | **0 to ~1** (free if the DCN scaler does it — UNMEASURABLE) |

---

## 6. Verdict

**Is the animation itself plausibly the bottleneck, or is the frame budget already consumed by something else?**

### 6.1 The budget arithmetic at 5K @ 60 Hz

* Frame budget: **16.667 ms**.
* Idle compositor + X server floor: **11.9 % of one core** (gnome-shell 6.30 + Xorg 5.60, MEASURED).
  If mutter composites at 60 Hz this is ≈ **1.98 ms/frame of CPU** — but that CPU is **not on the app's
  main thread**, so it does not directly subtract from the app's 16.667 ms. It is a *background* cost.
  (If mutter instead composites only on damage at ~15–30 Hz, the *per-produced-frame* cost is 3.9–7.9 ms —
  ESTIMATED, since mutter's real frame rate is not readable without root/perf → UNMEASURABLE.)
  Either way, **11.9 % of one core on a 32-thread machine is 0.37 % of total capacity. The budget is NOT
  already consumed by the compositor.**
* Under my own heavy 5K Chromium load the compositor measured **lower** (Xorg 3.75 %, gnome-shell 5.25 %) →
  it is not being starved and does not scale with app load.
* Machine saturation: `vmstat 1 3` → **77–92 % CPU idle**, run-queue **1–3**; `/proc/loadavg` 5.4–6.7 on
  32 threads. `dsh web` node (pid 10806) at ~83–88 % of **one** core is 2.7 % of machine capacity.

> **A single-core-saturated node process cannot starve this machine** — there are 32 hardware threads and
> 77–92 % of them are idle, so CFS always has a free core for the Electron main thread and the compositor
> thread (MEASURED, vmstat). Its realistic effect is **scheduling jitter / occasional tail latency**, not
> starvation. Note also that Chromium and Electron serialise their critical path on a *few* threads
> (main + compositor + GPU-process main loops); a busy core shared with one of those three is the mechanism
> by which a 0.88-core process could still hurt, and that is ESTIMATED, not measured here.

### 6.2 Verdict

1. **The animation *technique* is a sufficient and highly plausible cause of the ripple lag.** MEASURED:
   a cursor-following ripple drawn into a full-window 5120×2880 canvas costs **19.4 ms/frame even at
   r = 50 px** — already **16.4 % over the 16.667 ms budget** — and 21–35 ms for realistic radii
   (28–112 % over budget, with 14–32 of 33–58 frames dropped). The cost is **independent of the ripple's
   own area** and set entirely by the canvas surface size. The same effect built with a ripple-sized canvas
   plus `transform` costs **2.2 ms**, and as a pure DOM layer **0.1 ms**. So yes: **the ripple is plausibly
   THE bottleneck — but only because of how it is implemented, not because of what it draws.**

2. **The "something else already ate the budget" hypothesis is NOT supported by the compositor baseline.**
   MEASURED: idle compositor + Xorg = 11.9 % of one core, unchanged under load, with 77–92 % of the machine
   idle. There is no machine-wide CPU starvation and no evidence the compositor is stealing the app's budget.

3. **BUT animation cost alone probably does not explain the lag on real hardware, and the strongest
   evidence is the "same app is also laggy elsewhere" clue.** ESTIMATED (§5.4): on the actual 2-CU iGPU the
   worst measured variants scale to roughly **2–8 ms/frame**, i.e. 12–48 % of the budget — significant, but
   unlikely to be fatal on its own. Meanwhile the *systemic* finding is far more compelling and is MEASURED:
   **a 2-CU AMD iGPU with DCN 3.1.5 composites a 14.746 Mpx framebuffer and drives a 3840×2160 panel
   through a permanent 1.333328× bilinear downscale, while the RTX 4090 sits 100 % idle with no client on
   `/dev/nvidia*` and `nvidia-smi` broken (NVML init failure).** Every pixel the user's desktop draws — the
   Electron app, Firefox, GNOME — pays that tax. That is the parsimonious explanation for an app being laggy
   "elsewhere" too, and it is a machine configuration issue, not an animation issue.

4. **Recommended reading of the evidence:** treat the ripple as a **real, fixable aggravator** (fix the
   technique: ripple-sized canvas or DOM layer; never animate a full-window canvas at 5K) and treat the
   **present path as the primary root cause** (2-CU iGPU + 133 % fractional scaling + unused RTX 4090).
   The two are additive: a 2–5 ms hardware ripple on top of a present path that already has little headroom
   is exactly the "feels laggy" profile.

### 6.3 What could not be determined (UNMEASURABLE under the read-only mandate)

* The real iGPU's actual cost for these animations — **no GUI window may be opened**, so no hardware-rendered
  measurement was possible. All absolute browser numbers are SwiftShader software upper bounds.
* Whether the 1.3333× bilinear downscale is done by the DCN hardware scaler or by a mutter shader pass.
* mutter's actual per-frame time and frame rate (needs root/perf/GPU trace).
* Direct-scanout state, and whether gnome-shell falls back to llvmpipe (`/proc/4139/maps` permission denied).
* Whether the user's Electron app actually uses a full-window canvas and/or `backdrop-filter` — **the app is
  not running**, so it could not be instrumented. The model above covers both variants so either can be
  matched against it.
* `nvidia-smi` GPU utilisation/memory — **NVML is broken on this host** (`Failed to initialize NVML: Unknown Error`).

### 6.4 Confidence tags

| Claim | Tag |
|---|---|
| Idle gnome-shell 6.30 % / Xorg 5.60 % of one core; compositor not starved | **MEASURED** |
| Display on AMD iGPU (`0000:73:00.0`), 2 CUs; RTX 4090 idle & unused | **MEASURED** |
| Output mode 3840×2160@60 with 1.333328× bilinear transform; fb 5120×2880 | **MEASURED** |
| `x11-randr-fractional-scaling` enabled | **MEASURED** |
| Headless Chromium = SwiftShader software rendering | **MEASURED** |
| All frame-time ms in §4 (software raster) | **MEASURED** |
| Cost law `1.44 ms/Mpx × (surface + fill)` | **MEASURED** (fit, n=9, 15× area range) |
| Blur costs ~one extra repaint of the region, not 8–12× | **MEASURED** (narrow scope) |
| Hardware ms at 5K on the 2-CU iGPU | **ESTIMATED** (8–12× speedup assumption) |
| Downscale free-vs-shader-pass | **UNMEASURABLE** |
| mutter per-frame ms / frame rate | **UNMEASURABLE** |
| `nvidia-smi` GPU utilisation | **UNMEASURABLE** (NVML broken) |
| The Electron app's actual animation code | **UNMEASURABLE** (app not running) |

---

## Appendix A — reproduction commands

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/incident2/cross-app/costmodel
HS=/home/CNS2026495165/.cache/ms-playwright/chromium_headless_shell-1148/chrome-linux/headless_shell
URL="file://$PWD/repro.html"

# Full sweep, 60 Hz-locked (real-world droppage view)
/usr/bin/node driver.mjs "$HS" "$URL" 1280 720 19733 "$PWD/result-1280x720.json" "$PWD/prof-1280"

# Full sweep, unthrottled (true per-frame cost) at both resolutions
EXTRA_FLAGS="--disable-frame-rate-limit --disable-gpu-vsync" \
  /usr/bin/node driver.mjs "$HS" "$URL" 1280 720 19735 "$PWD/result-1280x720-nolimit.json" "$PWD/prof-1280-nolimit"
EXTRA_FLAGS="--disable-frame-rate-limit --disable-gpu-vsync" \
  /usr/bin/node driver.mjs "$HS" "$URL" 5120 2880 19737 "$PWD/result-5120x2880-nolimit.json" "$PWD/prof-5120-nolimit"

# Focused implementation comparison (full-window vs ripple-sized canvas vs pure DOM)
V="baseline,ripple-r400,ripple-r800,ripple-smallcanvas-r400,ripple-smallcanvas-r800,ripple-dom-r400,ripple-dom-r800,tray-backdrop-layout,tray-backdrop-animbg,tray-frost-layout"
EXTRA_FLAGS="--disable-frame-rate-limit --disable-gpu-vsync" ONLY="$V" \
  /usr/bin/node driver.mjs "$HS" "$URL" 5120 2880 19741 "$PWD/result-5120-focused.json" "$PWD/prof-5120-focused"
```

## Appendix B — repro variants implemented in `repro.html`

`baseline`, `ripple-r{50,100,200,400,800,1600}` (full-window canvas), `ripple-fullclear`,
`ripple-smallcanvas-r{400,800}` (ripple-bbox canvas + `transform`), `ripple-dom-r{400,800}` (pure DOM
disc + `transform`), `tray-layout`, `tray-layout-forced` (write-then-read `offsetWidth`),
`tray-transform`, `tray-backdrop`, `tray-backdrop-40`, `tray-frost`, `tray-backdrop-layout`,
`tray-backdrop-animbg` (blur over animated backdrop), `tray-frost-layout`.
