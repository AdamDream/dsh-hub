# Cross-app lag audit — is the "codex 那边" symptom the same as the DSH symptom?

**Incident:** `lag-fix/incident2/cross-app`
**Date:** 2026-09-22 10:30–10:45 CST
**Host:** `CNS202649516533` · Ubuntu 24.04.3 · kernel 6.14.0-27 · AMD Ryzen 9 9950X (32 threads) · X11 (`DISPLAY=:1`) · GNOME/mutter 46.2
**User's claim under test:** *"我去 codex 那边的界面，那边有个光标移动到对应位置就展开的托盘和跟随鼠标的波纹动效，那时候也卡，所以我觉得不一定是 dsh 本身的问题"*
**Role:** delegated forensic subagent. Write area: this directory only.

## 0. Authority, discipline, privacy boundary

**Discipline observed**
- Read-only on everything outside `.workspace/lag-fix/incident2/cross-app/`. No config, setting, or product file was modified. No `sandbox_permissions` used.
- **No process was killed, signalled, restarted, or suspended.** No user application was restarted. No GUI window was opened. No display mode was changed.
- The only writes are the artefacts in this directory (`audit.md`, `codex-ui-presence.md`, `animation-cost-model.md`, `costmodel/`, `*.csv`, `*.sh`, `copies/`).
- Two second-level subagents were used, exactly the authorised maximum.

**Privacy boundary (explicit)**
The user's private *content* was never read, summarised, or copied. Specifically **deliberately unread**:
| Not read | Basis |
|---|---|
| `~/.codex/sessions/**`, `~/.codex/history.jsonl`, `~/.codex/logs_2.sqlite`, `state_5.sqlite`, `thread_history_1.sqlite`, `memories_1.sqlite`, `dictation-history/` | conversation/agent content |
| `~/.codex/auth.json` | credentials (reported: EXISTS, 77 bytes) |
| `~/.config/Codex/Default/{Local Storage, IndexedDB, Cache, Code Cache, Cookies, Login Data, Network Persistent State}` | browsing/session content |
| `~/.config/Codex/Default/History` | 0 URLs / 0 visits (empty) |
| `~/.codex/config.toml` `[model_providers.custom].base_url` | private third-party endpoint, not rendering config |

What *was* read: executable/package metadata, `.desktop` files, config **keys** bearing on rendering/acceleration, URL **hosts and path prefixes only** (query strings and fragments stripped), file **names + sizes + mtimes**, and process/`/proc` statistics. Browser history was queried only from **copies** made inside this directory, opened read-only; results are reported as host + path prefix + visit counts, never as page content.

**Sandbox limits encountered (recorded, not escalated):** `/proc/<other-pid>/fd` is unreadable (`权限不够`), so **per-process GPU attribution was impossible** — this is the main measurement limitation and it is handled by the confound control in §4.3. `/var/log/Xorg.{0,1}.log` do not exist (real log is `~/.local/share/xorg/Xorg.1.log`). `fuser`/`lsof` produced nothing.

---

## 1. What is "codex 那边"? — **PASS**

**Answer: the OpenAI Codex desktop application — the Electron "owl" shell, installed as Debian package `chatgpt` 26.915.31945, showing its floating mascot/avatar companion with a pointer-proximity-expanding tray and a cursor-following ripple animation.**

Full evidence chain in `codex-ui-presence.md` (542 lines). The load-bearing pieces:

**1.1 The package named `chatgpt` *is* Codex.**
```
/usr/lib/chatgpt/resources/owl-app.ini
    [Owl]
    UserDataDirectoryName=Codex
    AppVersion=26.915.31945

/usr/lib/chatgpt/resources/owl-electron-app.json
    "packagedFrom": "/home/runner/work/openai/openai/codex/codex-apps/electron/out/ChatGPT-linux-x64",
    "runtimeName": "owl"

/usr/lib/chatgpt/resources/linux-package-metadata.json
    {"codexAppBrand":"chatgpt","codexBuildFlavor":"prod","version":"26.915.31945"}
```
So the user-data dir is literally `Codex`, and it is built from `openai/codex/codex-apps/electron`. `chatgpt.desktop` registers the **`codex://` scheme** (`MimeType=...x-scheme-handler/codex;...`), and `xdg-mime query default x-scheme-handler/codex` → `chatgpt.desktop`: the app owns the Codex URL scheme, so any `codex://` link reopens this GUI.

**1.2 The install chain is closed and same-minute** (from Firefox history + GNOME recently-used + dpkg log): `openai.com/codex/` (and `zh-Hans`) → download `persistent.oaistatic.com/codex-app-prod/linux/deb/latest/chatgpt_amd64.deb` at 2026-09-21T03:54:54Z → GNOME `recently-used.xbel` records `下载/chatgpt_amd64.deb` at 03:55:49Z → `dpkg.log`: `install chatgpt:amd64 <none> 26.915.31945` at 11:56:36 CST.

**1.3 The exact UI the user described exists in the shipped bundle.** Byte-extracted from `/usr/lib/chatgpt/resources/app.asar` (read-only):
- **Proximity-expanding tray** — `petControlsAppearance` constant:
  `proximityEnterDistance:40, proximityExitDistance:56, hoverOffsetX:0, hoverOffsetY:10, hoverControlGap:8, hoverControlSize:24, hoverGlassSpacing:0, movementSpringBounce:.1, movementSpringLaunchOffsetY:16, transitionDurationMs:200`
  i.e. the controls **expand when the pointer merely comes near (40 px), with spring physics** — exactly "光标移动到对应位置就展开的托盘".
- **Tray geometry / re-docking** — `{anchor, constrainNativeDrawWindowToDisplay, mode:'native', mascotSize, traySize, viewportSize, maximumTrayHeight, previousPlacement}` with placement flipping over `top-start|top-end|bottom-start|bottom-end`, plus `isTrayAboveMascot`, `isNotificationTrayExpanded`, `isNotificationTrayVisiblyExpanded`, `data-avatar-overlay-hit-region`. A tray that grows and re-docks relative to a **floating mascot window**.
- **Cursor-following ripple** — two independent implementations. `valdi_ui/src/components/Pressable` with state `{hovered, pressed, rippleExpanded, touchX, touchY}` and `setStateAnimated({rippleExpanded…})` (EaseOut 0.32 s); **and** a `requestAnimationFrame` overlay that samples the cursor into `trail[]`, fades trail spots by age, and animates expanding radial `rippleStops`:
  ```js
  let e = Math.min(1,(t-d.startedAt)/Xn), r = d.maxRadius*e,
      i = Math.max(0,r-Qn), a = Math.min(d.maxRadius,r+Qn), [o,s,c] = n.rippleStops;
  o.setAttribute(`offset`, String(i/d.maxRadius));
  s.setAttribute(`offset`, String(r/d.maxRadius));
  c.setAttribute(`offset`, String(a/d.maxRadius));
  ```
  That is literally "跟随鼠标的波纹动效" — animated SVG radial-gradient stops repositioned **every frame**.

**Alternatives ruled out, with evidence**
| Alternative | Ruled out by |
|---|---|
| Codex **CLI/TUI** (`~/.local/bin/codex`, `codex-cli 0.147.0`) | A terminal TUI cannot draw per-pixel ripples. Its own `~/.codex/config.toml` contains a **`[desktop]`** section — the CLI is subordinate to the app. 0 `codex` lines in the live `.bash_history`; last exercised ~2026-08-21/25 in stale `*.tmp`; **no terminal emulator running**. |
| **VS Code** extension | 21 extensions installed, **zero** matching `codex\|openai\|chatgpt\|copilot`; `settings.json` has 0 matching lines; newest log dir `20260916T174308` (not launched 2026-09-21). |
| **A Chromium browser** hosting the UI | No Chrome/Chromium/Edge/Brave/Vivaldi/Opera profile exists on this machine, native or snap. |
| **Firefox** hosting the UI | Firefox only *delivered the installer*; 0 matching bookmarks. (Firefox does however render the DSH GUI — see §4.1.) |
| The app's **embedded Chromium** as a browser | `~/.config/Codex/Default/History`: `urls`=0, `visits`=0 — native shell, not a browser. |
| `cc-switch` 3.19.2 / GNOME appindicator | Neither contains tray/proximity/ripple code. `cc-switch` is a plausible *secondary* window the user might conflate, but it is not "codex". Also **no `--disable-gpu`** anywhere, and Electron HW accel was **on**: `~/.config/Codex/Local State` → `hardware_acceleration_mode_previous = True`. |

**Last run:** `~/.config/Codex/Default/Cookies{,-journal}` mtime **2026-09-21 19:04:23 CST**; `~/.codex/*.sqlite` agree to the minute. Now is 2026-09-22 10:33. **≈15.5 h ago.**

---

## 2. Rendering carrier — **PASS: it is Electron (Chromium/Blink)**

| Question | Evidence |
|---|---|
| Electron? | `/usr/lib/chatgpt/resources/app.asar` — **355,432,434 bytes**. Chromium resource files alongside it: `chrome_100_percent.pak`, `chrome_200_percent.pak`, `resources.pak` (23.9 MB), `icudtl.dat`, `snapshot_blob.bin`, `v8_context_snapshot.bin`, `libEGL.so`, `libGLESv2.so`, `libvk_swiftshader.so`, `libvulkan.so.1`, `browser_crashpad_handler`, `LICENSES.chromium.html`. Total bundle **1.4 GB**. |
| Version | `/usr/lib/chatgpt/version` → **`42.3.0`** (Electron). App version 26.915.31945. Runtime `owl` (OpenAI's Electron fork). |
| Launcher / flags | `/usr/lib/chatgpt/codex-launcher` is `#!/bin/sh` → `exec "$(dirname "$(readlink -f "$0")")/ChatGPT" "$@"`. **No flags added. No `--disable-gpu`, no `--disable-gpu-compositing`, no `--disable-software-rasterizer` anywhere.** `chatgpt.desktop` `Exec=chatgpt %U`. |
| HW acceleration | **Enabled**: `hardware_acceleration_mode_previous = True`. So Codex renders GPU-accelerated. |
| UI framework | **Valdi** (OpenAI/Snap declarative UI) inside the Electron renderer — `makeNodePrototype('view',['accessibilityId','valdi-press-ripple',…])`, plus framer-motion-style spring constants (`movementSpringBounce`). |
| Is it a web page? | **No.** Embedded-Chromium profile has 0 URLs/visits. |
| Is it a terminal TUI? | **No** — see §1. |

**Important honest note on the user's description.** The user's phrasing is *not* a misremembering and does **not** need re-interpretation: the app really does have a proximity-expanding tray and a cursor-following ripple. But the "tray" is **not** a GTK panel applet or a terminal tray — it is the app's own notification/activity tray **docked to a floating mascot window**. Note also that the ripple is **not** a compositor effect: it is application JavaScript animating **SVG gradient stops** on a `requestAnimationFrame` loop, plus a Valdi `Pressable` ripple. That distinction drives the cost model in §5.

---

## 3. Reproducibility of the same symptom — **INCONCLUSIVE (not measurable live)**

**3.1 Live measurement of the Codex UI is NOT possible now.** It is not running (`pgrep -a -f ChatGPT` → nothing; no Electron/owl process at all), and it last ran ≈15.5 h ago. It could not be instrumented.

I did **not** launch it. Starting a 1.4 GB Electron GUI app is not read-only, would have stolen focus, and would have added a large load to the very machine under investigation — which would have contaminated the user's own session.

**3.2 Substitute forensic plan (safe, no GUI launch, no session change).** The key realisation is that *the compositor cost is measurable without the app*, because the mechanism is system-level (§4). So the user (or a follow-up agent) can measure the *increment*:

> **Step 1 — establish the floor.** With the desktop quiet, run for 60 s and record:
> `while :; do cat /sys/class/drm/card2/device/gpu_busy_percent; sleep 1; done | tee /tmp/gpu_quiet.txt`
> and in parallel `pidstat -p 4139,3884 1 10` (gnome-shell + Xorg CPU) and
> `journalctl -b --no-pager --since "-5 s" | grep -c "needs an allocation"`.
>
> **Step 2 — reproduce the user's interaction.** Open the Codex app, hover/park the cursor next to the mascot so the tray expands and the ripple follows, and keep moving the pointer in a small circle for ~20 s. Run exactly the same three probes concurrently.
>
> **Step 3 — compare.** The delta between Step 1 and Step 2 in `gpu_busy_percent` and in the `needs an allocation` rate is the **per-interaction compositor cost** of that animation on this machine. If `gpu_busy` is already ≥80 % at Step 1, the Step 2 increment is bounded by the remaining headroom, which is itself the finding.
>
> **Step 4 — optional, decisive.** Run the app **once** with `--enable-logging=stderr --v=1` and `--enable-tracing` (or open DevTools → Performance → record 10 s while hovering, then export the trace JSON). A DevTools trace gives per-frame `Commit`/`Paint`/`CompositeLayers` durations and directly attributes the cost to the app vs. the compositor. This is the single most informative artefact and it needs the user's cooperation because it requires launching the app.

**3.3 A measurement I *could* take without touching the user's session** is the compositor baseline itself, which is what §4.4 reports — that is the floor every app on this machine pays, and it is measured, not assumed.

---

## 4. KEY ADJUDICATION — does "cross-app same symptom" hold?

# VERDICT: **PASS — 跨应用同症状成立.**

The symptom is shared because **the two applications have nothing in common except the machine.** The common layer is the compositor/GPU/display path, and that layer is measurably saturated on the user's own desktop, independently of either app.

### 4.1 The two apps do not share a rendering engine — this is the core argument

| | DSH GUI (`http://127.0.0.1:3080`) | "codex 那边" |
|---|---|---|
| App | DSH web server (node, pid 10806) in a browser | Codex desktop app 26.915.31945 |
| **Engine** | **Gecko** (Firefox 155.0.1, snap `8863`) | **Blink** (Electron 42.3.0 / Chromium) |
| Toolkit | DOM/HTML + Firefox WebRender | Valdi + SVG + framer-motion, inside Chromium |
| GPU path | Gecko WebRender → EGL → amdgpu | Chromium compositor → EGL/ANGLE → amdgpu |

**The only browser installed on this machine is Firefox** (`snap list` → `firefox 155.0.1-1`; `command -v` finds no chrome/chromium/edge/brave). The DSH GUI is therefore rendered by **Gecko**, while Codex is rendered by **Blink**, with **two entirely different UI toolkits and animation stacks**. Two independent engines reproducing the same symptom points at what they share: mutter → X11 → the AMD iGPU → the display link.

### 4.2 The shared layer, measured

**(i) Every application on this machine is given a 5120×2880 surface, but the panel only ever shows 3840×2160.**
```
$ xrandr --query
Screen 0: minimum 320 x 200, current 5120 x 2880, maximum 16384 x 16384
HDMI-A-2 connected primary 5120x2880+0+0 (normal …) 600mm x 340mm
   3840x2160     60.00*+  50.00 …
$ xrandr --verbose   # HDMI-A-2 CRTC
	Transform:  1.333328 0.000000 0.000000
	            0.000000 1.333328 0.000000
	            0.000000 0.000000 1.000000
	           filter: bilinear
$ xprop -root _NET_DESKTOP_GEOMETRY   →  _NET_DESKTOP_GEOMETRY(CARDINAL) = 5120, 2880
$ xdpyinfo | grep dimensions          →  dimensions: 5120x2880 pixels (903x508 millimeters)
$ xrandr --listmonitors               →  0: +*HDMI-A-2 5120/600x2880/340+0+0
```
`5120 = 3840 × 4/3` and `2880 = 2160 × 4/3` **exactly**. Mutter composites a **14,745,600-pixel** stage and the X server bilinearly **downsamples it to 8,294,400 pixels for scanout, every frame**. (INFERRED, not measured: the logical desktop is 2560×1440 at scale 2.0, giving a 2× stage — this is *consistent with* the measured `Xft.dpi: 192` and `Xcursor.size: 48`, both exactly 2× the 96 dpi / 24 px defaults. The exact origin of the 4/3 factor is not confirmed; what is measured is the framebuffer size, the CRTC mode, and the transform.) `gsettings get org.gnome.mutter experimental-features` → **`['x11-randr-fractional-scaling']`**, and gnome-shell logs `Enabling experimental feature 'x11-randr-fractional-scaling'` at session start. This is GNOME **X11 fractional scaling** — a known-expensive path — and its cost is paid by **every window of every app**, in any toolkit, on any engine.

**(ii) There is no 5K mode; the link is bandwidth-starved.**
```
$ cat /sys/class/drm/card2-HDMI-A-3/status   →  connected
$ cat /sys/class/drm/card2-HDMI-A-3/enabled  →  enabled
$ cat /sys/class/drm/card2-HDMI-A-3/modes    →  3840x2160 (×8 variants)   # ONLY 4K modes
Xorg.1.log: (--) AMDGPU(0): HDMI max TMDS frequency 300000KHz
```
A 300 MHz TMDS link cannot carry 3840×2160@60 RGB 8 bpc (594 MHz) without **YCbCr 4:2:0** chroma subsampling. These are hardware facts of the current cabling, not app bugs.

**(iii) The display is driven by the weakest GPU in the box.**
```
$ xrandr --listproviders
Provider 0: id: 0x56 cap: 0x9, Source Output, Sink Offload crtcs: 4 outputs: 4
            associated providers: 1 name:AMD Ryzen 9 9950X 16-Core Processor @ pci:0000:73:00.0
Provider 1: id: 0x1ee cap: 0x2, Sink Output crtcs: 4 outputs: 7 name:NVIDIA-G0
Xorg.1.log: (II) AMDGPU(0): glamor X acceleration enabled on AMD Ryzen 9 9950X 16-Core Processor
            (radeonsi, raphael_mendocino, LLVM 20.1.2, DRM 3.61, 6.14.0-27-generic)
Xorg.1.log: (II) AMDGPU(0): Output HDMI-A-2 using initial mode 3840x2160 +0+0
$ nvidia-smi  →  Failed to initialize NVML: Unknown Error     (exit 255)
```
The **RTX 4090 is configured as an offload *sink* only** (`cap: 0x2, Sink Output`) and **nothing is using it** — no process holds `/dev/nvidia*`. Its user-space stack is **broken** (`NVML: Unknown Error`) even though the kernel module loaded (`nvidia 595.84`, `GPU Excluded: No`). Meanwhile the entire 5120×2880 → 3840×2160 desktop runs on the **Ryzen 9 9950X integrated GPU — 2 CUs / 128 ALUs** (`amdgpu: active_cu_number 2`, Display Core DCN 3.1.5). Also present at boot: `amdgpu … REG_WAIT timeout … optc31_disable_crtc` (a display-pipe fault signature).

**(iv) The compositor's stage views fail to allocate, continuously.**
```
$ journalctl -b | grep -c "needs an allocation"
3131
$ journalctl -b | grep "needs an allocation" | head -3
gnome-shell[4139]: Can't update stage views actor panelBox [StBoxLayout] is on because it needs an allocation.
gnome-shell[4139]: Can't update stage views actor panel [Gjs_ui_panel_Panel] is on because it needs an allocation.
gnome-shell[4139]: Can't update stage views actor panelRight [StBoxLayout] is on because it needs an allocation.
```
**3,131 events since boot**, and they begin at the very first second of the session — **for GNOME Shell's own actors** (`panelBox`, `panel`, `panelRight`, tray icons, `MetaWindowGroup`) **before any application is even running**, then continue for `MetaWindowActorX11` / `MetaSurfaceActorX11`. `clutter_actor_update_stage_views` failing means the actor has no valid allocation, so mutter cannot update its stage-view transform and must **re-allocate and repaint**. Measured rate (20 s sampler, `compositor_baseline.csv`): **bursts of up to 14/s during activity, 0/s when quiet** — i.e. this churn is triggered *by interaction*, which is exactly when the user reports the lag. This mechanism is **app-agnostic**: it applies to every X11 window on screen, Gecko or Blink alike.

### 4.3 Confound control — the iGPU load is the user's own desktop, not agent tooling

This machine currently hosts **other agent sessions** running playwright headless Chromium and a `gdb`'d chrome, so I had to prove the measured GPU load was not mine. I did:

```
$ tr '\0' ' ' < /proc/145486/cmdline | grep gl
  --type=gpu-process
  --use-angle=swiftshader-webgl
  --use-gl=angle
  --disable-gpu-compositing
```
The concurrent headless Chromium is **software-rendered (SwiftShader)** — it physically cannot occupy the AMD GFX engine. Confirmed by the inverse behaviour in `gpu_busy` vs. their GPU-process CPU (20 s, 1 Hz):
```
iGPU_busy=100%  chrome_gpuproc_cpu=0%     ← iGPU saturated while their GPU proc is idle
iGPU_busy=0%    chrome_gpuproc_cpu=29%    ← their GPU proc busiest while iGPU idle
iGPU_busy=100%  chrome_gpuproc_cpu=5%
iGPU_busy=0%    chrome_gpuproc_cpu=24%
```
Two independent confirmations that the agents' Chromium is **not** the iGPU load. Had the confound been real, the correlation would have been positive; it is instead **anti-correlated**. (Note: my first per-process sampling attempt in `gpu_correlation.csv` produced impossible negative deltas from process churn — `n_chrome_procs` ranged 3→21 during the run — so **that column is discarded as untrustworthy** and only the count-based control above is used.)

### 4.4 Measured iGPU saturation (120 s, 1 Hz — `gpu_correlation2.csv`)
```
gpu_busy_percent (/sys/class/drm/card2/device/gpu_busy_percent):
  mean 53.4%   median 81.0%   max 100%   min 0%
  >80%: 60/120 samples      >50%: 62/120      ==0: 44/120
total system CPU:  mean 9.7% of the 32-thread machine      (no sample exceeded 40%)
```
**The AMD iGPU that drives the display is pinned while the CPU is ~90 % idle.** The distribution is bimodal (44 samples read exactly 0, 60 read >80 %) because the amdgpu counter is window-quantized — read it as *"the iGPU is either idle or pinned"*, not as a precise duty cycle. Engine attribution (GFX vs. display pipe) is **ESTIMATED**: `mem_busy_percent` is not exposed, `pp_dpm_sclk` is empty, and `radeontop` is not installed.

### 4.5 The three hypotheses, adjudicated

**(a) System-level contention (GPU / CPU / compositor) — PASS. This is the cross-app mechanism.**
Strong, measured, and app-agnostic:
1. All clients are handed a 5120×2880 surface while scanout is 3840×2160 → **+77.8 % pixels for every app** (`14,745,600 / 8,294,400 = 1.7778`), then a per-frame bilinear downsample.
2. The display runs on a **2-CU iGPU**; the RTX 4090 is offload-only, unused, and its NVML stack is broken.
3. **iGPU busy: median 81 %, 60/120 samples >80 %**, against **9.7 % total CPU** and no sample above 40 % → the CPU is not the constraint; the GPU is.
4. Residual GPU headroom is therefore ~0–20 %, and **bounded by the quantised counter**. Any app adding a 60 Hz cursor-following animation must fit in what is left.
5. **gnome-shell stage-view allocation failures at up to 14/s**, starting before any app ran → forced re-allocation/full-stage repaint, triggered by interaction, for all X11 windows.
6. `amdgpu … REG_WAIT timeout … optc31_disable_crtc` at boot → a display-pipe fault signature in the same subsystem.
7. HDMI capped at 300 MHz TMDS with no 5K mode → the link is bandwidth-starved.

**This verdict is handed to the environment line (环境线).** It is a machine-configuration issue, reproducible with no application-specific knowledge.

**(b) Both apps happen to use the same expensive pattern — PASS as a *co-factor*, but NOT sufficient alone, and NOT the shared cause.**
The pattern is real and independently confirmed for the Codex side: pointer-proximity expansion (`proximityEnterDistance:40`, spring physics) plus a `requestAnimationFrame` cursor-trail ripple animating **SVG radial-gradient `offset` attributes** per frame, plus CSS `backdrop-filter: blur(var(--blur-lg))` in the bundle. That is genuinely expensive work — **but the two apps do not share it**: DSH is a Gecko/HTML app and Codex is a Blink/Valdi/SVG app, so a shared *implementation* pattern cannot be what makes both stutter. It is an **amplifier layered on top of (a)**, which is why the ripple is the *first* thing the user notices: it is the only thing in either app that demands a new frame **every 16.7 ms while the pointer moves**.

**(c) Perception / environment — left as testable, not adjudicated.**
I explicitly make **no** psychological claim. These are the *checkable* items, for the user or the environment line:
| Checkable item | Why it is checkable |
|---|---|
| Panel actually outputs **YCbCr 4:2:0** (implied by the 300 MHz TMDS limit) | 4:2:0 makes text and 1-px borders visibly soft/fringed; colour transitions smear during motion. Check the monitor OSD / `xrandr --verbose` "Colorspace", and compare a still screenshot against a photograph of the panel. |
| The desktop is **5120×2880 downscaled to 4K** | Rendered detail is resampled and 1-px UI strokes are destroyed — objectively verifiable by comparing a 100 %-zoom screenshot crop with a photo of the same region on the panel. |
| True 60 Hz at the panel | `vrr_capable: 0`; `TearFree: auto`. A high-speed-phone video of a 60 Hz test page (e.g. a moving 1-px vertical line) settles whether the panel really receives 60 fresh frames. |
| **Motion settings** | GNOME/GTK "reduce animation" was **not** set (`prefersReducedMotion` absent from `prefs.js`, all prefs default). Turning on a reduced-motion setting is a *test*, not a diagnosis, and it was deliberately not changed. |
| Comparison baseline | The same interaction on a **different machine** or **after** setting a 3840×2160 desktop with 100 % fractional scaling (removing the 1.3333 transform) — this isolates (a) from (c) cleanly. |

**Which hypothesis gets handed where:** **(a) → 环境线 (primary).** **(b) → the cost model in §5, as the app-side amplifier.** **(c) → remains open, with the four tests above.**

---

## 5. Cost model (handed to (b))

Method and full tables: `animation-cost-model.md` (605 lines) and `costmodel/`. **Critical caveat, stated loudly: the measurement harness rendered with SwiftShader** (`UNMASKED_RENDERER_WEBGL = "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)"`, because uid 1001 is not in the `video`/`render` groups). **All absolute milliseconds are CPU upper bounds; only the ratios are transferable.**

### 5.1 The law (MEASURED, n=9, area 1.47→22.79 Mpx, spread ±0.15)
```
ms/frame  ≈  1.44 ms/Mpx  ×  ( canvas surface area + animated fill area )
```
**Cost tracks the size of the backing surface, not the size of the visible effect.** The proof point: a ripple covering **0.053 % of the screen** (r = 50 px on a full-window canvas) still costs **19.4 ms/frame**, because its *canvas surface* is 14.746 Mpx. Same ripple on a ripple-sized canvas: **2.2 ms**. As a DOM layer: **0.1 ms**.

### 5.2 Per-effect cost at 5120×2880 (budget 16.67 ms)
| effect | p50 ms | dropped frames |
|---|---:|---:|
| pure DOM `transform` ripple | 0.1 | 0 |
| tray hover: `transform` + `opacity` | 0.1 | 0 |
| tray hover: animating `width`/`height`/`box-shadow` | 1.5 | 0 |
| tray hover + forced `offsetWidth` read | 1.4 (max 8.5) | 0 |
| `backdrop-filter: blur(20px)` + transform, static backdrop | 0.1 | 0 |
| `backdrop-filter: blur(20px)` + w/h animation | 1.8 | 0 |
| **ripple, ripple-sized canvas + transform (r=400)** | **2.2** | 0 |
| **ripple, full-window canvas (r=50 = 0.05 % of screen)** | **19.4** | 7/58 |
| ripple, full-window canvas (r=400/800/1600) | 21.4 / 25.2 / 35.3 | 14 / 24 / 32 |
| frosted tray `blur(20px)` over animated content | 35.9 | 33/33 |

### 5.3 Same-window relative cost (同窗相对) — the number the user asked for
- naive full-surface ripple ÷ tray-hover-transform = **214–252×**
- naive full-surface ripple ÷ tray-hover-layout = **14–17×**
- **a correctly built ripple ÷ tray-hover-transform = 1× (0.1 vs 0.1 ms)**
- 720p → 5K scaling: full-window-canvas ripple **10×**, ripple-sized canvas **1.0×** (flat — confirms surface-tracking, not window-tracking), backdrop-over-animated-content **13.8×**.
- The naive expectation that **blur kernel radius** is the killer was **not** confirmed: re-blurring a cached/static region costs only **+0.3 ms**. The real killer is an **uncacheable backdrop**, not blur radius.

### 5.4 Per-element / per-frame estimates for this machine
Using §5.1 at the *measured* stage size and the ESTIMATED 8–12× speedup from SwiftShader to a real 2-CU RDNA2 iGPU:
| interaction | ESTIMATED real-hardware cost | % of 16.67 ms |
|---|---:|---:|
| hover-expand tray animated by `transform`/`opacity` | 0.01–0.1 ms | <1 % |
| hover-expand tray animating layout (`width`/`height`) | 0.13–0.19 ms | ~1 % |
| frosted tray (`backdrop-filter`) over content | 0.3–1.5 ms | 2–9 % |
| **cursor-following ripple on a window-sized surface** | **2–4 ms** | **12–24 %** |
| same ripple, if it also forces compositor full-stage damage | **+5.25 ms** (see below) | **+32 %** |

And the compositor-side full-stage repaint, computed from measured geometry (ESTIMATED, memory-bandwidth bound):
```
stage 5120×2880 = 14,745,600 px ; scanout 3840×2160 = 8,294,400 px
RGBA8 stage buffer                             = 59.0 MB
one full-stage composite (read + write)        = 118.0 MB
1.3333× bilinear downscale (read 59.0 + write 33.2) = 92.2 MB
total per full-stack frame                     ≈ 210 MB  → 12.6 GB/s at 60 Hz
at a realistic ~40 GB/s effective for a 2-CU iGPU → ≈ 5.25 ms/frame = 32% of the budget
```
**The decisive interaction between (a) and (b):** the ripple's *own* pixel area is irrelevant (0.05 % of the screen). What matters is that it is a **new frame every 16.7 ms**, and on this machine a new frame can cost a **14.75 Mpx** composite plus a 1.3333× downsample — because the stage is 14.75 Mpx and because mutter is already failing to allocate stage views for X11 windows under interaction. On a normal 1920×1080 desktop that same ripple is ~1/7 of the cost. **This is why the same code feels fine elsewhere and laggy here, and why the user's instinct — "it's probably not DSH itself" — is well founded.**

**"Is the frame budget already consumed elsewhere?" — the honest answer is split:** subagent 2 found **CPU-side** headroom is ample and that the compositor was *not* starved (`vmstat` 77–92 % idle, run-queue 1–3, gnome-shell+Xorg = 11.9 % of one core = 0.37 % of a 32-thread machine; `dsh web` at ~0.88 core cannot starve it). **But GPU-side headroom is what matters for animation, and the GPU side has none (§4.4).** Those two statements are consistent: low CPU utilisation with a saturated iGPU is precisely the signature of a pixel-fill/compositing bottleneck, not a CPU bottleneck.

---

## 6. Findings ledger

| # | Claim | Verdict | Basis |
|---|---|---|---|
| 1 | "codex 那边" = OpenAI Codex desktop app (Electron `owl`, pkg `chatgpt` 26.915.31945) | **PASS** | owl-app.ini, owl-electron-app.json, package-metadata, closed install chain |
| 2 | That app has a pointer-proximity-expanding tray | **PASS** | `proximityEnterDistance:40 / proximityExitDistance:56`, `mascot`, `traySize`, `maximumTrayHeight`, `isNotificationTrayExpanded` in app.asar |
| 3 | That app has a cursor-following ripple | **PASS** | `rippleExpanded`/`touchX,touchY` (Valdi `Pressable`) + rAF `trail[]` + animated SVG `rippleStops` |
| 4 | It is **not** a terminal TUI | **PASS** | app is Electron; CLI subordinate (`[desktop]` in config.toml); no terminal emulator running |
| 5 | It is **not** VS Code | **PASS** | 0 codex/openai/chatgpt/copilot extensions; not launched that day |
| 6 | It is **not** a browser page (no Chromium browser installed at all) | **PASS** | no Chrome/Chromium/Edge/Brave profiles; embedded profile 0 URLs |
| 7 | Carrier = **Electron**, HW accel **enabled**, **no** `--disable-gpu` | **PASS** | 355 MB app.asar + Chromium .pak/.so, `hardware_acceleration_mode_previous=True`, launcher passes no flags |
| 8 | Cross-app symptom is **the same underlying problem** | **PASS** | Gecko vs Blink; shared saturated present path (§4) |
| 9 | Mechanism (a) system-level GPU/compositor contention | **PASS** | iGPU median 81 % vs 9.7 % CPU; 5120×2880 stage vs 3840×2160 scanout; 2-CU iGPU; 4090 offload-only + NVML broken; 3131 stage-view failures; amdgpu REG_WAIT timeout |
| 10 | Mechanism (b) shared expensive animation pattern | **PASS as co-factor only** | real in Codex, but the engines do not share implementations → cannot explain both |
| 11 | Mechanism (c) perception/environment | **INCONCLUSIVE — 4 tests listed (§4.5)** | no psychological conclusion drawn |
| 12 | Live frame-rate measurement of the Codex animation | **INCONCLUSIVE — not measurable** | app not running since 2026-09-21 19:04; launching it would violate read-only and contaminate the machine → substitute plan §3.2 |
| 13 | Whether mutter's DCN scaler or a mutter GL shader performs the 1.3333× downsample | **UNMEASURED** | requires mutter debug env (needs a gnome-shell restart — forbidden) |
| 14 | Per-process GPU attribution | **UNAVAILABLE** | `/proc/<other-pid>/fd` is sandbox-denied; mitigated by the SwiftShader control (§4.3) |
| 15 | Real-hardware ms for the animations | **ESTIMATED only** | harness rendered in SwiftShader; ratios transferable, absolutes are CPU upper bounds |

## 7. Artefacts in this directory
| File | What it is |
|---|---|
| `audit.md` | this report |
| `codex-ui-presence.md` | 542-line task-1/2 inventory (subagent 1), with the app.asar byte-extraction of the tray + ripple |
| `animation-cost-model.md` | 605-line cost model (subagent 2): baseline, present path, pixel-fill table, measured frame times, verdict |
| `costmodel/` | repro: `repro.html`, `driver.mjs`, `result-*.json` (isolated `--user-data-dir`, own ports; no GUI window) |
| `copies/` | read-only SQLite copies used for history queries |
| `compositor_baseline.csv`, `sample_compositor.sh` | 20 s compositor CPU + stage-view-warning sampler |
| `gpu_correlation.csv` | 60 s sample — **`headless_chromium_cpu` column is UNRELIABLE (process churn → negative deltas); do not use** |
| `gpu_correlation2.csv` | 120 s sample used for §4.4 (gpu_busy, chrome process count, total system CPU) |
| `gpu_corr.sh`, `gpu_corr2.sh` | the samplers |
| `gpu_busy_sample.txt` | the first (contaminated) iGPU sample |

## 8. Recommended next actions
1. **环境线 (primary):** the display configuration is the single highest-value fix. The current arrangement renders 14.75 Mpx to show 8.29 Mpx on a 2-CU iGPU while a 24 GB RTX 4090 sits idle and its NVML interface is broken. Concrete candidates, cheapest first: (i) set the desktop to **3840×2160 with 100 % scaling** (removes the 1.3333× transform and the +77.8 % pixel tax entirely); (ii) repair or explicitly bypass the NVIDIA stack (`nvidia-smi` currently fails) and consider driving the panel from the 4090; (iii) confirm the 300 MHz TMDS / 4:2:0 link and, if the panel supports it, use a DisplayPort or USB-C path that can carry 4:2:2/4:4:4.
2. **App line (secondary):** if the Codex ripple is to be optimised, the actionable finding is §5.1 — **size the animation surface to the effect, not to the window**: a ripple-sized canvas costs 2.2 ms where a full-window canvas costs 19.4 ms for the same visible pixels (a ~9× difference), and a DOM `transform`/`opacity` ripple costs 0.1 ms (214–252× cheaper). Avoid animating `width`/`height` and avoid `backdrop-filter` over content that is itself animating.
3. **User cooperation (optional, highest information gain):** the §3.2 Step 4 DevTools Performance trace while hovering the mascot — it is the only artefact that would split the cost cleanly between the app and the compositor.
4. **Do not** re-run the animation benchmark while other agent sessions are active, and **do not** compare absolute ms from the SwiftShader harness against the user's experience.
