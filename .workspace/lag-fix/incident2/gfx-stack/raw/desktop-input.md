# Desktop compositor & input stack — bottleneck audit (incident 2 / gfx-stack)

Scope: (1) is the GNOME/X11 compositor on the AMD iGPU the bottleneck for smooth animation?
(2) is the high-report-rate-mouse hypothesis supported?
Host: Ubuntu 24.04.3, kernel 6.14.0-27-generic, X11 session (`DISPLAY=:1`, `XDG_CURRENT_DESKTOP=ubuntu:GNOME`),
session launched via gdm-x-session → gnome-session (Terminator-hosted). Audit window: 2026-09-22 10:30–10:36 CST, uptime ~28–34 min.
All commands read-only. Raw outputs: `desktop-*.txt`, `input-*.txt` in this directory.

---

## VERDICT 1 — Is the GNOME/X11 compositor on the AMD iGPU *measurably* the bottleneck?

### **INCONCLUSIVE — leaning YES (likely significant aggravating factor; not proven as the root cause)**

**What is proven (measured configuration defect, app-independent):**

The compositor is forced to render **1.78× more pixels per frame than the panel can physically display**,
and then to full-screen **bilinearly resample** them, on the weakest GPU in the machine:

| Quantity | Value | Source |
|---|---|---|
| Composited X screen / framebuffer | **5120 × 2880** = 14.75 Mpx | `xrandr`, `xwininfo -root`, `_NET_DESKTOP_GEOMETRY`, Xorg log |
| Actual HDMI output mode | **3840 × 2160 @ 60.00 Hz** = 8.29 Mpx | `xrandr --current`, Mutter D-Bus `is-current` |
| Over-render factor | **5120·2880 / 3840·2160 = 1.78×** | computed |
| CRTC transform on HDMI-A-2 | **1.333328, 1.333328, filter: bilinear** | `xrandr --current --verbose` |
| Fractional scaling | **`x11-randr-fractional-scaling` ENABLED**, `'x11-fractional-scaling': <true>`, logical scale **1.5** | gnome-shell log, `gsettings`, Mutter D-Bus |
| GPU actually compositing | **AMD Raphael iGPU** (1002:13c0, gfx_v10_0, 2 CU RDNA2, 2048 MB VRAM carve-out, DDR5) | Xorg log, `xrandr --listproviders`, kernel log |

Every frame therefore costs: composite a 14.75 Mpx stack of large blended layers → bilinear-downsample the whole
thing to 8.29 Mpx → scan out at 60 Hz. That is ~885 Mpx/s of compositing plus ~500 Mpx/s of `bilinear`
resampling that the machine does **not need**. On a 2-CU iGPU sharing DDR5 bandwidth this is exactly the kind
of app-independent degradation the user reports (stutter while *hovering*, ripples, tray-expand), because every
app's animation is composited by this same stage.

**Why it is nonetheless INCONCLUSIVE rather than YES:**

1. **No frame-drop / latency evidence exists at all.** Zero occurrences of `Missed`, `latency`, `dropped`,
   `jank` in `journalctl --user -b`; zero `Page flip`/`flip_done` timeouts, zero `GPU reset`/hung-task/
   `blocked for more than` in the kernel log; Xorg log shows `KMS Pageflipping: enabled` and
   `Present extension enabled` with **0** flip or timeout errors.
2. **The CPU-side "smoking gun" is explicitly ABSENT.** gnome-shell and Xorg are *not* saturated:
   - gnome-shell (pid 4139): **6.2 % CPU** (pidstat 5×1 s: 7, 6, 6, 6, 6); `top -bn2` 2nd sample **5.0 %**.
     Per-thread: only the **main thread** runs (~6–7 %); every other thread 0 %.
   - Xorg (pid 3884): **7.0 % CPU** (pidstat: 8, 5, 8, 7, 7); `top -bn2` 2nd sample **3.0 %**.
   Nothing is near 100 %; this is *not* a thread-bound compositor at 5K.
3. **GPU utilisation is bursty, not saturated, and the metric itself looks unreliable.** 15 × 1 s samples of
   `card2/device/gpu_busy_percent`: `0, 74, 69, 0, 0, 94, 0, 0, 100, 61, 0, 99, 0, 0, 99`
   → **mean 39.7 %, only 4/15 ≥ 90 %**. An earlier 20 × 0.25 s run read mostly ~99–100 %. The same metric
   flipping 100→0→0→20→99 between consecutive 1 s windows over a *static* desktop is not behaviour a real
   GPU load can produce; `pp_dpm_sclk` also alternates 600 MHz ↔ 2200 MHz. **Conclusion: I cannot use
   `gpu_busy_percent` on this Raphael APU as trustworthy steady-state proof of saturation.**
4. **The iGPU is shared.** The same 2-CU GPU also serves Firefox/WebRender (a single Firefox window is
   **3344 × 2862** X pixels) and the corporate DLP agent (below). Any saturation burst cannot be attributed
   to the compositor alone.

**Net:** the compositor is *configured* to waste ~78 % of its per-frame fill budget plus a full-screen
resampling pass — a real, cheaply-fixable, machine-level defect that is the strongest concrete finding in this
scope — but I could not demonstrate dropped frames or isolate the compositor's share of GPU time, so
"measurably **the** bottleneck" is not established. Treat it as a **probable YES / must-fix aggravator**, not a proven root cause.

---

## VERDICT 2 — Input-rate (high-polling-rate mouse + high-refresh display) hypothesis

### **NOT SUPPORTED**

- Three pointing devices are attached, all **1000 Hz**, all capped there by USB Full Speed:
  | Device | VID:PID | Interface endpoint | USB speed | Poll rate |
  |---|---|---|---|---|
  | Logitech G502 HERO Gaming Mouse | 046d:c08b | `9-1.3:1.0/ep_81` `bInterval=1` | 12 Mbit/s (Full Speed) | ~1000 Hz |
  | VGN DragonFly F1 SE (Mouse) | 3554:fb50 | `1-3:1.1/ep_82` `bInterval=1` | 12 Mbit/s (Full Speed) | ~1000 Hz |
  | SINOWEALTH VGN V87 V2 2.4G Dongle (Mouse) | 258a:027b | `1-2:1.1/ep_82` `bInterval=1` | 12 Mbit/s (Full Speed) | ~1000 Hz |
  `usbhid` `mousepoll=0` → the device-reported interval is honoured. At Full Speed, `bInterval=1` = 1 ms = 1000 Hz.
- **1000 Hz is the baseline class, not the problematic one.** The known libinput/X11 "high-polling-rate mouse"
  issue class concerns 2000/4000/8000 Hz devices (USB High Speed, `bInterval` in microframes).
- **The display is only 60 Hz**, and 60 Hz is its maximum (all ten 3840×2160 modes top out at 60.00). The
  "high-polling-rate mouse + **high-refresh** display" issue class cannot apply — there is no high-refresh output.
- **Input handling costs are trivial:** Xorg totals 5–8 % of one core *including all input processing*;
  gnome-shell's main thread 6–7 %. No input-thread saturation.
- **No pathological pointer configuration:** libinput driver, adaptive accel profile, `Accel Speed = 0.000000`,
  no `Device Accel`/resolution overrides, identity Coordinate Transformation Matrix. Nothing that would explain
  "mouse-following" artefacts. (No DPI/report-rate property is exposed by X at all.)
- *Caveat (see undetermined list):* the live event/report rate could not be counted (no root for
  `libinput debug-events`/`evtest`), and 3 pointers + 2 keyboards are attached, so this verdict rests on the
  polling-interval descriptors, the 60 Hz ceiling, and the low Xorg/Shell CPU — not on a measured event rate.

---

## EVIDENCE TABLE

| # | Claim | Command | Observed output (trimmed) | Confidence |
|---|---|---|---|---|
| 1 | Compositor identity | `gnome-shell --version`; `journalctl --user -b \| grep -i "compositing manager"` | `GNOME Shell 46.0`; `Running GNOME Shell (using mutter 46.2) as a X11 window and compositing manager` | High |
| 2 | Composited framebuffer is 5120×2880 | `xrandr --current` | `Screen 0: minimum 320 x 200, current 5120 x 2880, maximum 16384 x 16384` | High |
| 3 | Framebuffer size (independent) | `xprop -root _NET_DESKTOP_GEOMETRY`; `xwininfo -root` | `_NET_DESKTOP_GEOMETRY(CARDINAL) = 5120, 2880`; `Width: 5120  Height: 2880  Depth: 24` | High |
| 4 | Framebuffer allocated on the AMD GPU | Xorg log line | `(II) AMDGPU(0): Allocate new frame buffer 5120x2880` | High |
| 5 | Actual output mode = 3840×2160 @ 60 | `xrandr --current` | `HDMI-A-2 connected primary 5120x2880+0+0 … 3840x2160 60.00*+ 50.00 …` | High |
| 6 | Mode confirmed by compositor | `gdbus … DisplayConfig.GetCurrentState` | `'3840x2160@60.000' 3840 2160 60.0 1.5 [… ] {'is-current': <true>, 'is-preferred': <true>}` | High |
| 7 | **Panel is 4K, not 5K** (premise correction) | `cat /sys/class/drm/card2-HDMI-A-3/modes` | 35 modes, largest = `3840x2160` (×10); `is-preferred` on 3840×2160 | High |
| 8 | Full-screen bilinear scaling transform active | `xrandr --current --verbose` | `Transform: 1.333328 0.000000 … 0.000000 1.333328 …` / `filter: bilinear` | High |
| 9 | Fractional scaling enabled | `gsettings get org.gnome.mutter experimental-features`; journal | `['x11-randr-fractional-scaling']`; `Enabling experimental feature 'x11-randr-fractional-scaling'` | High |
| 10 | Fractional scaling enabled (Mutter view) | `gdbus … GetCurrentState` | logical monitor `[(0, 0, 1.5, uint32 0, true, [('HDMI-A-2','GSM','LG ULTRAFINE','606NTUWJK582')], @a{sv} {})]`; props `{'renderer': <'xrandr'>, 'x11-fractional-scaling': <true>, 'legacy-ui-scaling-factor': <2>, 'max-screen-size': <(16384,16384)>}` | High |
| 11 | User scale settings | `gsettings get org.gnome.desktop.interface scaling-factor / text-scaling-factor` | `uint32 0` / `1.0` | High |
| 12 | Saved monitor config | `cat ~/.config/monitors.xml` | `<scale>1.5</scale>`, connector `HDMI-0`, `3840×2160 @ 60.000`, product `LG ULTRAFINE` | High |
| 13 | gnome-shell CPU **not** saturated | `pidstat -p 4139,3884 -u 1 5` | `gnome-shell … 7.00 / 6.00 / 6.00 / 6.00 / 6.00` (mean `6.20`); `Xorg … 8/5/8/7/7` (mean `7.00`) | High |
| 14 | No shell thread saturation | `pidstat -p 4139 -t -u 1 3` | main thread `4139 … 7.00 / 7.00 / 6.00`; `gmain`, `gdbus`, 8×`JS Helper`, `gnome-shel:gl0` all `0.00` | High |
| 15 | No frame-drop/latency diagnostics | `journalctl --user -b \| grep -ic …` | `Missed 0`, `latency 0`, `dropped 0`, `jank 0` | High (absence) |
| 16 | No flip/reset/stall at kernel or Xorg level | `journalctl -k -b \| grep -ic …`; `grep -ic` Xorg log | `Page flip 0`, `flip_done 0`, `GPU reset 0`, `hung task 0`, `blocked for more than 0`; Xorg: `KMS Pageflipping: enabled`, `Present extension enabled`, `(EE)` count 3 (all benign) | High (absence) |
| 17 | workqueue CPU hogging (real, growing) | `journalctl -k -b \| grep -i hogged` | `10:12:23 … pm_runtime_work hogged CPU for >10000us 4 times`; `10:17:24 … 5 times`; `10:27:26 … 7 times`; `10:31:03 … 11 times` | High |
| 18 | iGPU utilisation bursty, not pinned | `cat card2/device/gpu_busy_percent` ×15 @1 s | `0,74,69,0,0,94,0,0,100,61,0,99,0,0,99` → **mean 39.7 %**, 4/15 ≥90 % | Low (metric suspect) |
| 19 | iGPU clock range / boosting | `cat card2/device/pp_dpm_sclk` | `0: 600Mhz / 1: 700Mhz / 2: 2200Mhz *` — alternates 600 ↔ 2200 MHz | Medium |
| 20 | **Live connector is card2-HDMI-A-3, not A-2** (premise correction) | `cat /sys/class/drm/*/status` + `/enabled` | `card2-HDMI-A-2 … disconnected`; `card2-HDMI-A-3 … connected` / `enabled`; all 4 `card1-*` disconnected | High |
| 21 | GPUs identified | `cat card{1,2}/device/{vendor,device,driver}` | `card1: 0x10de 0x2684 → /sys/bus/pci/drivers/nvidia` (RTX 4090, pci 01:00.0); `card2: 0x1002 0x13c0 → amdgpu` (Raphael iGPU, pci 73:00.0) | High |
| 22 | AMD is display source, NVIDIA is offload sink only | `xrandr --listproviders` | `Provider 0: … cap: 0x9, Source Output, Sink Offload …AMD Ryzen 9 9950X…`; `Provider 1: … cap: 0x2, Sink Output … NVIDIA-G0` | High |
| 23 | `nvidia` OutputClass also bound (implication) | Xorg.1.log | `(II) Applying OutputClass "AMDgpu" to /dev/dri/card2`; `(II) Applying OutputClass "nvidia" to /dev/dri/card1`; `(**) Option "AllowNVIDIAGpuScreens"`; `(**) NVIDIA(G0): Option "AllowEmptyInitialConfiguration"`; kernel: `nvidia-drm … Cannot find any crtc or sizes` | High |
| 24 | 3 mice, all 1000 Hz max | `xinput list`; `cat …/ep_*/bInterval`; `lsusb -v -d 3554:fb50` | `bInterval=01 type=Interrupt` on all 3 pointer interfaces; `bInterval 1`; `usbhid mousepoll=0` | High |
| 25 | No pointer-accel pathology | `xinput list-props 13/15/18` | `libinput Accel Profile Enabled: 1, 0`; `libinput Accel Speed: 0.000000`; no `Device Accel*` properties (libinput driver) | High |
| 26 | No screen recorder / remote-desktop client | `ps -eo pid,pcpu,args \| grep -iE "obs\|kazam\|vokoscreen\|vino\|x11vnc\|teamviewer\|anydesk\|…"` | none matched; only `gnome-remote-desktop-daemon --system` at `0.0` % (idle system service) | High |
| 27 | No user extensions enabled | `gsettings get org.gnome.shell enabled-extensions` | `@as []` (Ubuntu system extensions still active — DING runs) | High |
| 28 | Many large windows being blended | `xwininfo -root -children` | Firefox `3344x2862`, Feishu `2818x2208`, WeChat `2334x1798`, Nautilus ×2 (`2478x1910`), Terminator `1684x1420`, DING desktop window `5120x2880` depth 32 | High |
| 29 | Load avg high while CPU 90 % idle | `top -bn2 -d1`; `ps -eo stat` | `load average: 6.31 … %Cpu(s): 5.8 us, 2.7 sy, 91.1 id, 0.0 wa`; only **2** D-state tasks (`kworker`, `.Ocular`) | High |
| 30 | **Corporate DLP/monitoring suite running** (see below) | `systemctl status startLSDEfsSvr`; `lsmod`; `ldd` | 357-task cgroup, `Main PID: 1584 (LMonitor)`, children incl. `LAgent`, `LSGTransmit`, **`LVnctransfer`**, `LMonitorFileOP`; `LSDEfs 7143424 1` loaded | High |
| 31 | DLP agent can capture X11 screen | `ldd /usr/local/.OCular/LAgentUser` | `libXext.so.6`, `libX11.so.6` linked; sibling libs `libscreen.so`, `libXdgSnapshot.so`, `libTWaterMark.so`, `LVncX11`; `LWMHelper` links `libX11` | Medium (capability, not activity) |
| 32 | DLP agent consumes CPU in bursts | 20 × 1 s jiffies delta on pid 4535/4376 | `LAgentUser`: `0,0,1,1,17,0,1,12,1,19,2,…` (peaks 17–26 % of a core); `LSDHelper`: steady 3–5 % | High |
| 33 | Repeated display re-probe | `journalctl -k -b \| grep -c "Unknown EDID CEA"` | `6`, at 10:30:15 ×2, 10:30:36, 10:32:15, 10:34:02, 10:34:19 | Medium (likely audit-induced) |
| 34 | NVIDIA side unhealthy/opaque | `nvidia-smi` | `Failed to initialize NVML: Unknown Error`; kernel `nvidia: loading out-of-tree module taints kernel` (595.84) | High |

---

## Supporting finding outside the strict question but inside "compositor-hostile" scope

`/usr/local/.OCular/` is a **Chinese enterprise DLP / endpoint-monitoring suite** (vendor tagged `TEC` —
`TecSign-Root.crt`, `libTecCurl.so`, `10-udisks-tec.pkla`, `##TEC_BEGIN##` block in `/etc/environment`;
`LSD`/`OCular` naming) with an **out-of-tree kernel module loaded**:

- `LSDEfs` — 7 143 424 bytes, refcount 1, built for **this exact kernel** (`LSDEfs_6.14.0-27-generic_x86_64.ko`) = transparent file-encryption (EFS) driver.
- Active service `startLSDEfsSvr.service` ("LMonitor"), uptime = whole session, **357 tasks**, RSS 385.4 MB (peak 1.1 GB),
  CPU 20.65 s / 34 min. Child processes include `LMonitor`, `LAgent`, `LSDConfig`, `LSGTransmit`, `LNacConfig`,
  `LMonitorFileOP`, **`LVnctransfer`** (VNC transport), `Lrdlv3 … TKSFrame.so`, `FilezillaLogProcessor`.
- User-session side: `LAgentUser` (4.8 %) and `LSDHelper` (3.3 %) autostarted; root `.Ocular` pid 2085 sits in **D state**.
- Screen-monitoring capability is evident from shipped libraries: **`libscreen.so` (9.2 MB)**, **`libXdgSnapshot.so`**,
  **`libTWaterMark.so` (8.6 MB)**, `watermarkeffect_extension/`, **`LWMHelper`**, **`LVncX11`/`LVncWayland`/`LVnctransfer`**,
  `ContentMatch.so` (34 MB), `LSensitive`, plus `LGetXServerInfo`.
- `LAgentUser` links `libX11` + `libXext` (needed for `XGetImage`/`XShmGetImage`) but does **not** appear in `xlsclients`
  — expected, since a pure screen-capture client creates no windows.

**Implication:** a DLP agent capable of full-screen watermarking and screen capture is resident on a machine whose
root window is **5120×2880** (59 MB per 32-bpp capture, ~4× the cost of a 2560×1440 grab) — a **prime suspect for
periodic, cross-application stalls of exactly the kind described**, and an unmeasured concurrent load on the same
2-CU iGPU as the compositor. **However, I did NOT prove an active capture loop** (see undetermined list).

---

## Premise corrections (important for the main investigation)

1. **The panel is 3840×2160 @ 60 Hz, not a 5K panel.** Its EDID preferred mode is 3840×2160 and its largest
   mode is 3840×2160. The "5120×2880" in the environment description is **not** the display resolution — it is the
   **compositing framebuffer**, inflated by GNOME's X11 fractional-scaling feature.
2. **The live connector is `card2-HDMI-A-3`, not `card2-HDMI-A-2`.** `card2-HDMI-A-2` is *disconnected*; only
   `card2-HDMI-A-3` is `connected` + `enabled`. The X-facing name `HDMI-A-2` (from `xf86-video-amdgpu`, which
   renumbers per type) is what appears in `xrandr`/Mutter — the mismatch is a naming offset, not a different port.
3. The premise "GNOME Shell composites on the AMD iGPU, not the RTX 4090" is **correct and confirmed** (provider 0
   AMD = Source Output; NVIDIA provider = Sink Output only; `nvidia-drm: Cannot find any crtc or sizes`).

## Unresolved / flagged

- **`1.5` vs `1.3333` discrepancy (unresolved).** Mutter reports logical monitor scale **1.5**, but the X screen is
  `mode × 4/3` (5120×2880) with a `1.333328` transform — i.e. the X-side ratio is **4/3**, not 1.5 (which would give
  5760×3240). Both prove fractional scaling is active and the framebuffer exceeds the output mode; I could not
  reconcile the exact factor. Concrete lead: `~/.config/monitors.xml` stores connector **`HDMI-0`** while the live
  connector is **`HDMI-A-2`**, so the saved per-monitor config may be matched/applied only partially.
- **`TearFree: auto` is unresolved.** `xrandr --verbose` reports the property as `auto`, and I could not read the
  driver's resolved value. If it resolves to *on*, amdgpu adds a further full-screen 5120×2880 copy per frame —
  another amplifier of the same defect.
- **Connector re-probe events** (`Unknown EDID CEA parser results` ×6; NVIDIA DFP-0..6 re-enumeration at
  `[1839.196]` in Xorg.1.log) coincide with this and sibling audits' `xrandr`/provider queries, so I cannot claim a
  spontaneous hotplug/reprobe loop.

## Could NOT determine (and why)

| Item | Why |
|---|---|
| Actual frame times / dropped frames | No frame-timing counters exposed read-only; Mutter logs no jank (`Missed 0`). Would need `MUTTER_DEBUG_…` env + restart, or a new capture session — both out of scope / state-changing. |
| Compositor's own share of GPU time | amdgpu exposes no per-client GPU accounting; `/sys/kernel/debug/dri/*/amdgpu_pm_info` is **root-only** (`权限不够`). `gpu_busy_percent` is a single device-wide number and appears unreliable here. |
| True mouse report/event rate | Requires root (`libinput debug-events`, `evtest`) or vendor tooling; X exposes no report-rate property; `bInterval` only bounds it (≤1000 Hz). No package installation permitted. |
| Whether the DLP agent is actively screen-capturing | No root: cannot audit its syscalls (`strace`), sockets, or X traffic. It creates no window, so `xlsclients` cannot show it. **Capability confirmed, activity NOT proven.** |
| gnome-shell's GPU/GLX provider and env | `/proc/4139/environ` and `fd/` are denied (`权限不够`, ptrace scope). Indirect evidence (`xrandr --listproviders` capability flags, Xorg `AMDGPU(0)` primary, `Cannot find any crtc or sizes`) makes AMD rendering near-certain but not directly observed. |
| Which process drove the 0/100 GPU bursts | No per-process GPU accounting available without root. |
| What the periodic `pm_runtime_work` >10 ms hog actually blocks | The kernel message names no device; amdgpu, xhci, nvme, and the 4090 all use runtime PM. Not attributable from the log alone. |

## Raw evidence files

`desktop-pidstat.txt`, `desktop-pidstat-threads.txt`, `desktop-top-sample.txt`, `desktop-xrandr.txt`,
`desktop-gsettings.txt`, `desktop-monitors-config.txt`, `desktop-panel-modes.txt`, `desktop-drm-reconcile.txt`,
`desktop-mutter-displayconfig.txt`, `desktop-mutter-displayconfig-full.txt`, `desktop-journal-user.txt`,
`desktop-journal-system.txt`, `desktop-kernel-stalls.txt`, `desktop-xorglog.txt`, `desktop-xorglog-glx.txt`,
`desktop-shell-env.txt`, `desktop-amdgpu-busy.txt`, `desktop-amdgpu-busy2.txt`, `desktop-correlation.txt`,
`desktop-gpu-metric-extra.txt`, `desktop-modules-nvidia.txt`, `desktop-extras-dstate.txt`,
`desktop-wm-extensions.txt`, `desktop-windows.txt`, `desktop-overlay-window.txt`, `desktop-ocular.txt`,
`desktop-ocular-config.txt`, `desktop-ocular-identity.txt`, `desktop-ocular-libs.txt`, `desktop-ocular-procs.txt`,
`desktop-injection-check.txt`, `desktop-screencast-check.txt`,
`input-xinput-list.txt`, `input-xinput-props.txt`, `input-lsusb.txt`, `input-polling.txt`, `input-polling2.txt`.
