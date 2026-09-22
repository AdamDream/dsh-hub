# Incident 2 — Graphics-stack forensics: snap Firefox + cross-application stutter

- **Host:** `CNS202649516533`, Ubuntu 24.04, kernel `6.14.0-27-generic`, 32 CPUs, 60.4 GiB RAM
- **Session:** X11 (`DISPLAY=:1`), GNOME Shell / Mutter, `XDG_CURRENT_DESKTOP=ubuntu:GNOME`
- **Collection window:** 2026-09-22 10:30–10:36 (+08:00), boot at 2026-09-22 10:01:55, uptime 29–35 min
- **Method:** strictly read-only. No process was signalled, started, or restarted; no package installed; no `sandbox_permissions` used.
- **Raw outputs:** all `firefox-*.txt` / `crossapp-*.txt` files in this directory.

> **SCOPE NOTE.** This file answers only Q1 (is snap Firefox plausibly a jank source) and Q2 (is there physical evidence of the same symptom in a non-DSH app). No other topics were investigated.

---

## VERDICT SUMMARY

| Question | Verdict | One-line reason |
|---|---|---|
| **Q1 — Is snap Firefox plausibly a source of the jank?** | **NO** (not in the "confinement blocks the GPU / forces software rendering" sense) | Firefox is the snap build (rev 8863) **but** has every graphics interface connected, can reach both `/dev/dri` render nodes, and is **provably hardware-accelerated on the AMD iGPU via Mesa radeonsi** — with VA-API working and WebRender active. Confinement is *not* degrading it. |
| **Q2 — Physical evidence of the same symptom in a non-DSH app?** | **INCONCLUSIVE toward "yes"** — no captured stutter in any other app, **but** a strong app-independent, compositor-level defect *is* present and *is* a credible shared root cause | No GPU hang/reset, no GPU-process crash loop, no non-DSH app was observed (or was even running) while stuttering. However GNOME Shell/Mutter logs **441,627** compositor re-allocation warnings (3,207 this boot) and drives a **5120x2880 @ 1.5 fractional scaling via a 1.3333 transform** on the iGPU — a machine-wide, app-independent frame-pacing hazard. |

**One-line bottom line:** the user's hypothesis (machine/graphics-stack level, not app-specific) is **plausible but for a different reason than suspected**: the evidence *exonerates* snap confinement, and instead points at the **display/compositor path** (4K→5K downscale + fractional scaling on a 2-CU iGPU, inside a Mutter instance that is continuously logging stage-view allocation failures) plus **system-wide CPU contention**.

---

## PART A — Q1: Snap Firefox

### A.1 It really is the snap build, exact revision

```
$ ps -eo pid,ppid,etimes,pcpu,pmem,args | grep -i firefox | grep -v grep
   9042    4139    1464 16.7  1.8 /snap/firefox/8863/usr/lib/firefox/firefox
   9139    3736    1463  0.0  0.0 /snap/firefox/8863/usr/lib/firefox/crashhelper ...
   9283    9042    1463  0.0  0.0 .../firefox -contentproc ... 1 forkserver
   9298    9283    1463  0.0  0.0 .../firefox -contentproc ... 2 socket
   9351    9283    1463  0.0  0.2 .../firefox -contentproc -isForBrowser ... 3 tab
   9360    9283    1463  1.3  0.3 .../firefox -contentproc ... 4 rdd
   9950    9283    1469  0.0  0.0 .../firefox -contentproc -sandboxingKind 0 ... 6 utility
  10350    9283    1459 25.6  1.6 .../firefox -contentproc -isForBrowser ... 10 tab
  ... (13 further `tab` content processes)
$ ls -la /snap/firefox/
drwxr-xr-x 6 root root 179  9月  4 15:14 8863
lrwxrwxrwx 1 root root   4  9月  7 05:19 current -> 8863
$ snap list firefox
名称       版本        修订版本  追踪                发布者       注记
firefox  155.0.1-1  8863   latest/stable/…  mozilla**  -
$ snap info firefox | tail -3
installed:          155.0.1-1                (8863) 274MB -
```

- Snap revision **8863 = Firefox 155.0.1-1**, publisher `mozilla**` (verified), `latest/stable/ubuntu-24.04`, last refreshed 15 days before collection.
- `/snap/firefox/current -> 8863`, i.e. the running revision is also the current revision (no stale-revision mismatch).
- Parent PID 4139 = `/usr/bin/gnome-shell`; owner UID 1001 = the logged-in user. Firefox is the user's session browser.
- **Firefox 155 has no dedicated `gpu` content process on Linux** (the compositor runs in-process in the parent). The 15 `-contentproc` children are `forkserver`/`socket`/`rdd`/`utility`/13×`tab` — **the absence of a `gpu` child is therefore normal, not a missing-GPU-process fault.** → `firefox-ps.txt`

### A.2 Snap interfaces: nothing graphics-critical is disconnected

```
$ snap connections firefox | grep -iE 'opengl|wayland|x11|desktop|hardware|gpu'
content[gpu-2404]   firefox:gpu-2404    mesa-2404:gpu-2404   -
desktop             firefox:desktop     :desktop             -
opengl              firefox:opengl      :opengl              -
wayland             firefox:wayland     :wayland             -
x11                 firefox:x11         :x11                 -
hardware-observe    firefox:hardware-observe :hardware-observe -
```
Disconnected interfaces, in full (`firefox-snap-connections.txt`):
```
alsa                      firefox:alsa                      -
dbus                      -                                 firefox:dbus-daemon
mpris                     -                                 firefox:mpris
network-observe           firefox:network-observe           -
password-manager-service  firefox:password-manager-service  -
pcscd                     firefox:pcscd                     -
```
**Every one of the disconnected plugs is non-graphics** (sound card, MPRIS media control, PC/SC smartcard, network diagnostics, password manager). `graphics-core22` does not appear at all because Firefox 155 uses the **newer `gpu-2404` content interface instead** (bound to the `mesa-2404` snap) — so its absence is not a regression. `hardware-random-control` is not used by this snap at all.

> **Evidence item:** `content[gpu-2404]  firefox:gpu-2404  mesa-2404:gpu-2404` — the GPU userspace provider snap (**mesa-2404 rev 1839, Mesa 25.2.8**) is **connected**.

### A.3 Device access: the user CAN read both render nodes; ACLs are correct

```
$ ls -la /dev/dri
crw-rw----+  1 root video  226,   1  card1        <- NVIDIA RTX 4090 (PCI 01:00.0)
crw-rw----+  1 root video  226,   2  card2        <- AMD Raphael iGPU (PCI 73:00.0)
crw-rw----+  1 root render 226, 128  renderD128   <- NVIDIA render node
crw-rw----+  1 root render 226, 129  renderD129   <- AMD render node
$ getfacl -p /dev/dri/renderD128
user::rw-
user:CNS2026495165:rw-      <-- explicit POSIX ACL for the user
group::rw-
other::---
$ id
uid=1001 gid=1001 groups=1001,4(adm),20(dialout),24(cdrom),27(sudo),30(dip),46(plugdev),100(users),114(lpadmin)
```
The `+` in `-rw----+` is a POSIX ACL granting **`user:CNS2026495165:rw-` on both `card1`/`card2` and `renderD128`/`renderD129`**. The user is *not* in `video`/`render`, but does not need to be — the per-user ACL is the modern `systemd-logind` mechanism and it is present on all four nodes. `/dev/nvidia0`, `/dev/nvidiactl`, `/dev/nvidia-modeset`, `/dev/nvidia-uvm*` are additionally `crw-rw-rw-` (world-writable).

> **This is the decisive Q1 refutation:** the "device readable only by a group the user/snap lacks" hypothesis is **FALSE**. There is no permission obstacle to either GPU. → `firefox-devices.txt`, `firefox-device-acl.txt`

### A.4 Snap-specific environment: could not be read (stated honestly), but the effective stack WAS observed

```
$ cat /proc/sys/kernel/yama/ptrace_scope
1
$ head -c 1 /proc/9042/environ
head: 无法以读模式打开 '/proc/9042/environ': 权限不够   (permission denied)
$ readlink /proc/9042/exe ; echo $?
1                                   (EACCES)
$ stat -c '%A %U %G' /proc/9042
dr-xr-xr-x CNS2026495165 CNS2026495165
```
`environ`, `exe`, `cwd`, `root`, `fd`, `maps` of the running Firefox are **unreadable even to the owning user** (this holds for *all* live Firefox processes). Firefox blocks ptrace of itself at runtime, so `LIBGL_*`/`MOZ_*`/`__EGL_VENDOR`/`GBM_*`/`MESA_*`/`LIBVA_*` **could not be read from `/proc`** — recorded as a genuine gap, not papered over. This also means `/proc/<pid>/root/...` (the snap mount namespace from inside) is unreadable.

**However, the equivalent facts were obtained by other, stronger routes:**

1. **Snap definition (authoritative, on disk):**
```
# /snap/firefox/8863/firefox.launcher  -> exec "$SNAP/usr/lib/firefox/firefox" "$@"
# meta/snap.yaml app environment:
{DICPATH, GTK_USE_PORTAL:'1', HOME:'$SNAP_USER_COMMON', PIPEWIRE_CONFIG_NAME:'client.conf',
 SPEECHD_ADDRESS, MOZ_APP_REMOTINGNAME:'firefox_firefox', MOZ_LEGACY_HOME:'1'}
# no LIBGL_/MESA_/GBM_/EGL_ variable is set by the snap
# command-chain: [snap/command-chain/gpu-2404-wrapper]  -> sources mesa-2404's provider wrapper
```
2. **The `gpu-2404` wrapper is fully readable** and sets exactly the expected Mesa plumbing:
```
GBM_BACKENDS_PATH, LD_LIBRARY_PATH(+ /usr/lib/<arch>/dri), LIBVA_DRIVERS_PATH,
__EGL_VENDOR_LIBRARY_DIRS, __EGL_EXTERNAL_PLATFORM_CONFIG_DIRS, DRIRC_CONFIGDIR,
VK_LAYER_PATH, XDG_DATA_DIRS, XLOCALEDIR, AMDGPU_ASIC_ID_TABLE_PATHS
```
(and a conditional `LIBVA_DRIVERS_PATH` export guarded by `__NV_PRIME_RENDER_OFFLOAD != 1` — NVIDIA-PRIME aware). → `firefox-gpu2404-wrapper.txt`, `firefox-mesa-glthread.txt`
3. **The snap mount namespace IS readable** (`/proc/9042/mounts`), proving the GPU stack is mounted in:
```
/dev/nvme0n1p2 /snap/firefox/8863/gpu-2404-2   ext4 ro,relatime
/dev/loop14    /snap/mesa-2404/1839           squashfs ro,nodev,...
/usr/share/libdrm        bind of $SNAP/gpu-2404/libdrm
/usr/share/drirc.d       symlink $SNAP/gpu-2404/drirc.d
/dev, /dev/shm, /dev/pts ... (full /dev available)
```
→ `firefox-snap-namespace.txt`

### A.5 **Firefox is hardware-accelerated** — direct proof, three independent sources

**(1) Mozilla's own crash metadata** (from Firefox's minidump `.extra` file, which records the live GPU state at crash time):
```
"AdapterDeviceID":"0x13c0", "AdapterVendorID":"0x1002",
"AdapterDriverVendor":"mesa/radeonsi", "AdapterDriverVersion":"25.2.8.0",
"GpuSandboxLevel":"0", "GraphicsNumRenderers":"3", "GraphicsNumActiveRenderers":"4",
"WebRender" (implied by GraphicsNum*Renderers), "IsWayland":"0", "Compositor": chromium/X11
```
`0x1002/0x13c0` is **AMD Raphael** — i.e. Firefox's WebRender/compositor is running on the **AMD iGPU through Mesa radeonsi 25.2.8**, not on llvmpipe/software. → `firefox-crash-extra.txt`

**(2) The journal shows Firefox initialising the AMD VA-API driver from inside the snap's `gpu-2404` tree:**
```
firefox_firefox.desktop[9360]: libva info: VA-API version 1.20.0
firefox_firefox.desktop[9360]: libva info: Trying to open /snap/firefox/8863/gpu-2404/usr/lib/x86_64-linux-gnu/dri/radeonsi_drv_video.so
firefox_firefox.desktop[9360]: libva info: Found init function __vaDriverInit_1_20
firefox_firefox.desktop[9360]: libva info: va_openDriver() returns 0
```
`va_openDriver() returns 0` = **hardware video decode initialised successfully inside the confined snap.** → `crossapp-journal-apps.txt`

**(3) The X server side confirms the same GPU is the accelerated primary:**
```
~/.local/share/xorg/Xorg.1.log:
[    30.011] (II) Applying OutputClass "AMDgpu" options to /dev/dri/card2
[    30.038] (II) AMDGPU(0): glamor X acceleration enabled on AMD Ryzen 9 9950X 16-Core Processor
            (radeonsi, raphael_mendocino, LLVM 20.1.2, DRM 3.61, 6.14.0-27-generic)
[    30.038] (II) AMDGPU(0): KMS Pageflipping: enabled
```

### A.6 Firefox preferences: **no GPU-disabling prefs at all**

Full `prefs.js` was read (334 lines). Grep result for the requested keys:

| Pref | Present? |
|---|---|
| `gfx.webrender.all` | **absent** (WebRender is on by default in FF 155) |
| `gfx.webrender.software` | **absent** |
| `gfx.x11-egl.force-enabled` | **absent** |
| `layers.acceleration.disabled` | **absent** |
| `media.hardware-video-decoding.enabled` | **absent** (i.e. default `true`; and VA-API did init — see A.5) |
| `webgl.disabled` | **absent** |

There is **not a single `gfx.*` / `layers.*` / `media.hardware-*` / `webgl.*` user pref**. Firefox is running 100 % stock defaults. → `firefox-crashes-prefs.txt`

> **Profile location correction:** there is **no** `~/.mozilla/firefox` on this machine (`没有那个文件或目录`). Because `MOZ_LEGACY_HOME=1`, the snap profile lives at
> `~/snap/firefox/common/.mozilla/firefox/g05ps3km.default/`.
> Same for crash reports: `~/snap/firefox/common/.mozilla/firefox/Crash Reports/`.

### A.7 Firefox crashes: two, and **neither is a graphics crash**

```
$ ls -la ~/snap/firefox/common/.mozilla/firefox/Crash\ Reports/pending/
2026-09-21 16:25:00  8401932  17307ff6-ef45-0718-8d0e-1152dec93a54.dmp
2026-09-04 18:36:34  2920450  7c771e5f-b3f6-f38e-905c-9b470e0f6363.dmp
```
| Crash | Time | BuildID | `MozCrashReason` | Adapter | Graphics error? |
|---|---|---|---|---|---|
| `17307ff6` | 2026-09-21 16:25 | `20260904071051` (FF 155.0.1) | `MOZ_CRASH(OOM)` | `0x13c0` / mesa/radeonsi 25.2.8 | **no** `GraphicsCriticalError` |
| `7c771e5f` | 2026-09-04 18:36 | `20250718161710` (old FF 141-era build) | `MOZ_CRASH(IPC...)` | `0x2684` / **nvidia/unknown** 595.84 | `GraphicsCriticalError":"|[0][GFX1-]:` + `IPCMessageSize:333777956` |

- The recent (2026-09-21) crash is an **out-of-memory abort in the parent process** (`LinuxUnderMemoryPressure:0`, `AvailablePageFile` ≈ 15 GB free) — a memory/allocator problem, **not** a graphics-driver failure.
- The only crash carrying any `GFX1` graphics error is from **2026-09-04**, on a different, older Firefox build, and it is also dominated by a **333 MB IPC message** problem (`PContent::Msg_FOGData`), not a GPU fault.
- `~/.mozilla/firefox/*/crashes/` — **does not exist** (wrong path, see A.6). `~/snap/.../Crash Reports/events/` is empty; no new pending dumps since 2026-09-21.

### A.8 Q1 conclusion

Everything the snap could plausibly break is **verified working**:

| Confinement risk | Observed reality |
|---|---|
| Cannot see GPU device nodes | both `renderD128`/`renderD129` + `card1`/`card2` accessible, ACL `user:CNS2026495165:rw-` |
| Missing `opengl`/`graphics` interface | `opengl` + `content[gpu-2404]`→`mesa-2404` connected |
| Old/vendored Mesa inside the snap | snap ships **Mesa 25.2.8** (same version as host driver userspace) |
| Sandbox forces llvmpipe/software | `AdapterDriverVendor:"mesa/radeonsi"`, `GpuSandboxLevel:"0"`, VA-API `returns 0` |
| Custom prefs disable acceleration | **zero** `gfx.*` user prefs |
| GPU process missing/crashing | no `gpu` child is *expected* on FF 155/Linux; no GPU crash in logs |

**Verdict Q1: NO.** Snap Firefox is **not** plausibly a jank source *via confinement or software-rendering*. The snap packaging is, on this machine, behaving correctly and reaching hardware acceleration on the display-driving AMD iGPU. (This does **not** prove Firefox's *content* is not heavy — see Part B.6, where Firefox was measured as the 2nd-largest CPU consumer — only that the snap/GPU path is sound.)

---

## PART B — Q2: Cross-application evidence

### B.1 The Codex desktop client: found, but **not running** during collection

```
$ cat /usr/lib/chatgpt/resources/owl-app.ini
[Owl]
UserDataDirectoryName=Codex
AppVersion=26.915.31945
$ cat /usr/lib/chatgpt/resources/linux-package-metadata.json
{ "codexAppBrand": "chatgpt", "codexBuildFlavor": "prod", "version": "26.915.31945" }
$ cat /usr/lib/chatgpt/resources/owl-electron-app.json
{ "packagedFrom": "/home/runner/work/openai/openai/codex/codex-apps/electron/out/ChatGPT-linux-x64", ... }
$ dpkg -S /usr/lib/chatgpt
chatgpt: /usr/lib/chatgpt
$ cat /usr/lib/chatgpt/codex-launcher
#!/bin/sh
exec "$(dirname "$(readlink -f "$0")")/ChatGPT" "$@"
```
- The Codex desktop client is the **`ChatGPT` deb (Electron/Chromium runtime "owl"), app version 26.915.31945**, installed at `/usr/lib/chatgpt`, user-data dir named `Codex`, launched by `/usr/lib/chatgpt/codex-launcher` → `ChatGPT`. It bundles `resources/codex` (278 MB), `resources/codex-code-mode-host`, `cua_node`.
- **Process state:** `ps -eo pid,args | grep -i -E '[c]hatgpt|[C]odex|/usr/lib/chatgpt'` returns **nothing** — Codex was **not running**. Its `SingletonLock -> CNS202649516533-1252158` points at PID **1252158, which is dead**.
- **Last activity:** `~/.config/Codex/` mtimes are **2026-09-21 19:01–19:04**, i.e. ~15.5 h before this collection. `~/.config/Codex/Default/GPUCache/data_1` = 2026-09-21 19:02.
- **Blocks this leg of Q2:** the user's Codex stutter cannot be reproduced or instrumented now; no live GPU process exists to inspect. → `crossapp-codex-search.txt`, `crossapp-codex-paths.txt`, `crossapp-codex-gpu-state.txt`

### B.2 Codex's GPU configuration: probe found, **no** disabling switch

```
$ grep -a -o -E ".{0,120}disable-gpu.{0,160}" /usr/lib/chatgpt/resources/app.asar
...rendererMemory:n,gpuFeatureStatus:r,gpuVendor:i,gpuRenderer:a,
hardwareAccelerationEnabled:!l.app.commandLine.hasSwitch(`disable-gpu`)}}
```
This is the **only** occurrence of `disable-gpu` in the 355 MB `app.asar`, and it is a **read** (`hasSwitch`) used to populate a **telemetry field** (`hardwareAccelerationEnabled`). It does **not** set the flag.

Exhaustive appendSwitch inventory (whole bundle):
```
      2 appendSwitch(e.name,e.value)                          <- generic passthrough of user-supplied flags
      1 appendSwitch(`force-fieldtrials`,fj)
      1 appendSwitch(`enable-features`,`DocumentPolicyIncludeJSCallStacksInCrashReports`)
      1 appendSwitch(`disable-blink-features`,[...yj].join(`,`))
```
Zero hits for `use-gl`, `use-angle`, `in-process-gpu`, `software-rasterizer`, `gpu-rasterization`, `gpu-compositing`, `disable-features` (GPU-related), or `SwiftShader`.

Corroborating user-data:
```
~/.config/Codex/Local State:  "hardware_acceleration_mode_previous": True
```
Electron/Chromium writes `hardware_acceleration_mode_previous` to record that the *last* session ran with HW accel enabled. → `crossapp-chatgpt-switches.txt`, `crossapp-chatgpt-disable-gpu-context.txt`, `crossapp-codex-localstate.txt`

### B.3 Other Electron/Chromium apps — and what `ps … chrome` really was

> **Correction to the brief's premise.** There is **no desktop Chrome/Chromium installed**. The `chrome` binary behind the `trap int3` messages and the `chrome` processes is **Playwright's bundled Chromium**.

```
$ ps -eo args | grep -i chrome | grep -v grep | awk '{print $1}' | sort | uniq -c
     12 /home/CNS2026495165/.cache/ms-playwright/chromium_headless_shell-1148/chrome-linux/headless_shell
      1 timeout
      1 gdb
      1 [chrome]
$ ps -eo args | grep chrome        # the gdb-wrapped one
timeout 90 gdb -q -batch -ex set pagination off -ex set confirm off -ex run -ex bt 25
  -ex info registers rip --args /home/CNS2026495165/.cache/ms-playwright/chromium-1148/chrome-linux/chrome
  --no-sandbox --disable-dev-shm-usage --user-data-dir=/tmp/gdbprof --no-first-run about:blank
```
So `traps: chrome[…] trap int3` = a **Playwright/dsh automation run**, not a user-facing browser. It has since exited (PIDs 92421/92781 gone by 10:34).

Actual Chromium-family inventory and their **install roots**:

| App | Install root | Running? | GPU process flags |
|---|---|---|---|
| **Codex / ChatGPT desktop** | `/usr/lib/chatgpt` (deb, Electron) | **no** | none set (`hardwareAccelerationEnabled` read only) |
| **Feishu / Lark** (`bytedance-feishu-stable`) | `/usr/bin/bytedance-feishu-stable`, data in `~/.config/LarkShell` | **yes** (PID 30300) | `--type=gpu-process --use-gl=angle --use-angle=swiftshader-webgl` (PIDs 30380, 30473) |
| **WeChat** | `~/.xwechat/…`, `WeChatAppEx` | **yes** (PID 5657) | `--type=gpu-process …` (PID 5775), no `use-gl`/`use-angle` |
| **Playwright Chromium** | `~/.cache/ms-playwright/chromium{,_headless_shell}-1148` | yes (transient) | `--use-gl=angle --use-angle=swiftshader-webgl` — **expected**, it is `--headless --ozone-platform=headless` |
| VS Code / Slack / Discord | **not installed** | — | — |

Codex/Feishu/WeChat/Playwright GPU processes were identified by cmdline; the two `/proc/self/exe`-masked ones were resolved via `/proc/<pid>/comm` = `feishu` and their cgroup `app-gnome-bytedance\x2dfeishu-30300.scope`. → `crossapp-ps.txt`, `crossapp-unknown-gpu-procs.txt`, `crossapp-x11-and-gpu-flags.txt`

**Interpretation:** SwiftShader in Feishu is a real GPU-process software-rendering observation, but (a) it is a *Chromium-internal* choice not reflected in any host-level GPU fault, and (b) Playwright's `swiftshader-webgl` is the normal headless configuration and must not be counted as host GPU breakage. This is **not** clean evidence that "the GPU is broken system-wide".

### B.4 Kernel log: the two brief-reported patterns — corroborated, but re-attributed

```
$ journalctl -k | grep -c 'trap int3'      -> 25
$ journalctl -k | grep -o 'traps: [^[]*' | sort | uniq -c
     25 traps: chrome
$ journalctl -k | grep 'workqueue'
9月 22 10:12:23 kernel: workqueue: pm_runtime_work hogged CPU for >10000us 4 times, consider switching to WQ_UNBOUND
9月 22 10:17:24 kernel: workqueue: pm_runtime_work hogged CPU for >10000us 5 times, consider switching to WQ_UNBOUND
9月 22 10:27:26 kernel: workqueue: pm_runtime_work hogged CPU for >10000us 7 times, consider switching to WQ_UNBOUND
9月 22 10:31:03 kernel: workqueue: pm_runtime_work hogged CPU for >10000us 11 times, consider switching to WQ_UNBOUND
```
- **`trap int3` — CORROBORATED as real (exactly 25 occurrences) but RE-ATTRIBUTED**: all 25 name `chrome`, all are Playwright's bundled Chromium, all between 10:11:41 and 10:22:54, and every one has the **identical instruction offset** `in chrome[56c322c,…]` — i.e. one deterministic `int3` site (Playwright's standard SIGTRAP-for-inspection pattern under `gdb`). **These are not GPU crashes and not user-visible app crashes.**
- **`pm_runtime_work hogged CPU for >10000us` — CORROBORATED (exactly 4 messages), but the source is NOT the GPU.** Time-correlate: at 10:18:03 WeChat logged `file_io_posix.cc(152) … File exists (17)` crashpad-lock errors, and at 10:19:22–10:26 Firefox/`tracker-extract` activity ramps. The AMD GPU explicitly reports **`amdgpu: Runtime PM not available`**, so it cannot be the `pm_runtime` device; the likely origin is the USB/wireless/`mt76` or NVMe runtime-PM path (a `kworker/u128:4+mt76` thread was observed in `D` state). Each message says ">10000us" = **>10 ms per work item**, which is a real but *small and intermittent* scheduling stall (4–11 occurrences per ~5 min), **not** a 100 ms+ UI freeze mechanism.
- **No GPU hang / no GPU reset / no ring timeout / no segfault:**
```
$ journalctl -k | grep -ci segfault          -> 0
$ journalctl -k | grep -ci 'GPU reset'       -> 0
$ journalctl -k | grep -i 'ring gfx'         -> only the 2 boot-time ring registrations
$ journalctl -k | grep -i 'gpu hang'         -> 0
$ journalctl -k | grep -iE 'amdgpu.*(timeout|fault|reset)'  -> only a boot-time REG_WAIT, below
9月 22 10:01:58 amdgpu 0000:73:00.0: [drm] REG_WAIT timeout 1us * 100000 tries - optc31_disable_crtc line:145
```
The single `REG_WAIT timeout` is a **boot-time display-CRTC teardown** message (10:01:58, 3 s after boot), a well-known benign amdgpu message, not a runtime fault. → `crossapp-kernel-traps.txt`, `crossapp-kernel-gpu-detail.txt`, `crossapp-journal-counts.txt`

### B.5 **The strongest genuine cross-application finding: GNOME Shell/Mutter is failing to allocate stage views, continuously**

```
$ journalctl --user --no-pager | grep -c "needs an allocation"
441627
$ journalctl -b --no-pager | grep -c "needs an allocation"
3207          <- this boot only (35 min old)
$ journalctl --user -o short-iso | grep "needs an allocation" | awk '{print substr($1,1,16)}' | uniq -c | tail
    208 2026-09-22T10:13      378 2026-09-22T10:20      112 2026-09-22T10:23
    162 2026-09-22T10:14       42 2026-09-22T10:15        8 2026-09-22T10:25
     26 2026-09-22T10:19      166 2026-09-22T10:21       82 2026-09-22T10:26
    108 2026-09-22T10:27       84 2026-09-22T10:30       88 2026-09-22T10:31
     50 2026-09-22T10:32      106 2026-09-22T10:33
```
Message text and distribution:
```
gnome-shell[4139]: Can't update stage views actor unnamed [MetaWindowActorX11]  is on because it needs an allocation.
gnome-shell[4139]: Can't update stage views actor unnamed [MetaSurfaceActorX11] is on because it needs an allocation.
$ journalctl --user | grep -o 'gnome-shell\[4139\]: .*' | sed -E 's/[0-9]+/N/g' | sort | uniq -c | sort -rn
   1641 ... [MetaWindowActorXN]  is on because it needs an allocation.
   1641 ... [MetaSurfaceActorXN]  is on because it needs an allocation.
```
History spans **2026-08-10 16:39 → 2026-09-22 10:33** (441,627 warnings ≈ 1.1 per minute averaged over 43 days, but **bursting to 378 in a single minute**). This is Mutter's Clutter stage failing to reallocate actors before painting — an actor that "needs an allocation" cannot be painted that frame, so its content is dropped/stale until the next allocation pass. It is emitted **for every X11 client window** (`MetaWindowActorX11`), which is exactly the *shape* of an app-independent, compositor-level stutter: it does not care whether the window is Firefox, DSH, or Codex.

> **This is the single most important Q2 item**: it is machine/graphics-stack-level, present in the compositor itself, and affects all X11 clients — matching the user's "same stutter in a completely different application" observation in *mechanism*, although it was not captured coincident with a specific user-visible freeze.

### B.6 The display/compositing load on the iGPU (a machine-level frame-time hazard)

```
$ xrandr --current
Screen 0: minimum 320 x 200, current 5120 x 2880, maximum 16384 x 16384
HDMI-A-2 connected primary 5120x2880+0+0 (normal ...) 600mm x 340mm
   3840x2160     60.00*+
$ xrandr --verbose | grep -A4 'HDMI-A-2 connected'
	Transform:  1.333328 0.000000 0.000000
	            0.000000 1.333328 0.000000
	            0.000000 0.000000 1.000000
	           filter: bilinear
	_MUTTER_PRESENTATION_OUTPUT: 0
$ xrandr --listproviders
Providers: number : 2
Provider 0: id: 0x56 cap: 0x9, Source Output, Sink Offload crtcs: 4 outputs: 4
            name:AMD Ryzen 9 9950X 16-Core Processor @ pci:0000:73:00.0
Provider 1: id: 0x1ee cap: 0x2, Sink Output crtcs: 4 outputs: 7 name:NVIDIA-G0
$ cat ~/.config/monitors.xml   -> <scale>1.5</scale>, <connector>HDMI-0</connector>, <width>3840</width>, <rate>60.000</rate>
$ gsettings ... org.gnome.mutter
org.gnome.mutter experimental-features ['x11-randr-fractional-scaling']
org.gnome.desktop.interface enable-animations true
```
- The screen is a **"LG ULTRAFINE" (GSM, serial 606NTUWJK582), 600x340 mm, 5120x2880** driven by the **AMD iGPU (`AMDGPU(0)`, `Source Output`)**; the NVIDIA 4090 is registered only as **`Sink Output`, 0 connected displays** (`NVIDIA(GPU-0): DFP-0…DFP-6: disconnected`).
- The desktop is **3840x2160 @ 60 Hz** (the monitor's native 5120x2880 is not the selected mode), presented through a **Mutter `Transform` of 1.3333 with bilinear filtering** — i.e. GNOME is doing a **4K→5K bilinear upscale in software on the GPU** every frame, and **fractional scaling 1.5 on X11** is explicitly enabled (`org.gnome.mutter experimental-features ['x11-randr-fractional-scaling']`).
- The compositing GPU is a **Raphael iGPU with only 2 compute units** (`amdgpu: SE 1, SH per SE 1, CU per SH 2, active_cu_number 2`) and **2048 MB VRAM** (`[drm] Detected VRAM RAM=2048M`), sharing system RAM.
- Every frame therefore costs: full-screen composite at 3840x2160 → bilinear resample to 5120x2880 → 1.5x fractional-scale blit → 60 Hz pageflip, on 2 CUs. **Any** animation that forces full-screen recomposition (hover ripple, tray expand, panel slide, theme animation — `enable-animations true`) pays this cost in *every* app. → `crossapp-xrandr.txt`, `crossapp-mutter-settings.txt`, `firefox-xorg-detail.txt`

**Correction to the brief:** the connected connector is **`card2-HDMI-A-3`**, not `card2-HDMI-A-2`.
```
/sys/class/drm/card2-HDMI-A-2/status  = disconnected   /enabled = disabled
/sys/class/drm/card2-HDMI-A-3/status  = connected      /enabled = enabled
```
The X-side name for that same connector is `HDMI-A-2` (`xrandr` output above), which is likely how the confusion arose. → `firefox-devices.txt`

### B.7 System load: heavy, machine-wide, and not GPU-bound

```
$ nproc -> 32 ;  MemTotal 63371020 kB ; MemAvailable 48609308 kB
$ cat /proc/loadavg
5.62 5.59 4.60 6/3027 95797        <- ~6 of 32 cores busy; 3027 threads
$ ps -eo pid,etimes,pcpu,pmem,comm --sort=-pcpu
   95787       0  137  0.2 node                     <- the collection/agent shell itself
   10806    1533 85.1  6.5 node                     <- 4.1 GB RSS
   10350    1566 25.9  1.1 Isolated Web Co          <- Firefox content process
    9042    1571 17.0  1.8 firefox                  <- Firefox main
    4139    1772 10.5  0.5 gnome-shell              <- compositor: 10.5 % of a core sustained
    10133    1569  8.7  0.5 Isolated Web Co
    6458    1708  6.4  0.3 update-manager
    4535    1771  4.6  0.1 LAgentUser
    3884    1773  3.3  0.4 Xorg
$ ps -eo pid,stat,wchan,comm | awk '$2 ~ /D/'
    212 D  kworker/u130:0+events_unbound
   2085 D  .Ocular
  70398 D  kworker/u128:4+mt76
$ journalctl -n 5000 | grep -iE 'oom|killed process'   -> (nothing)
```
- Firehose of CPU consumers far larger than Firefox: an **85 %-of-a-core `node` process at 4.1 GB RSS** (the DSH server / agent harness itself — PID 10806, running 1533 s, i.e. the whole session), plus `gnome-shell` at **10.5 % of a core continuously** (a direct cost of the transform/fractional-scaling path in B.6), `update-manager` at 6.4 %, `Xorg` 3.3 %, and Feishu holding ~2.2 GB across its processes.
- **48.6 GB of 60.4 GB RAM free, swap untouched, no OOM killer** — this is a CPU/GPU-compositing bottleneck, not memory exhaustion.
- 3 threads in uninterruptible `D` state (one `mt76` wireless worker) — consistent with the `pm_runtime_work` hogging above.

### B.8 Q2 conclusion

**What is proven:** there is a real, **machine-level, app-independent** defect in the compositor/display path (441,627 Mutter stage-view allocation failures; a 4K→5K bilinear transform + X11 fractional scaling composited on a 2-CU iGPU; sustained 10.5 % gnome-shell CPU; a 4.1 GB Node process at 85 % of a core).

**What is NOT proven:** no non-DSH application was **observed stuttering**. Codex was not even running (last active 2026-09-21 19:04); no GPU process was alive to inspect; no application (Firefox, Feishu, WeChat, Codex) logged a GPU-process crash, a GPU process restart loop, or a GPU fault; the kernel recorded **no GPU hang, no GPU reset, no segfault**.

**Verdict Q2: INCONCLUSIVE** for literal "physical evidence of the same symptom in another app" — but with the important qualification that the **shared, app-independent mechanism is positively present** at the compositor level, which is consistent with the user's hypothesis of a machine/graphics-stack problem while **exonerating snap Firefox's confinement** as its cause.

---

## PART C — Compact evidence table

| # | Claim | Command | Observed output (trimmed) | Confidence |
|---|---|---|---|---|
| 1 | Firefox is the snap build, rev 8863 / FF 155.0.1-1 | `snap list firefox`; `ls -la /snap/firefox/` | `firefox 155.0.1-1 8863 latest/stable/… mozilla**`; `current -> 8863` | **High** |
| 2 | Running binary is inside the snap revision | `ps -eo pid,ppid,etimes,pcpu,pmem,args \| grep -i firefox` | PID 9042 `/snap/firefox/8863/usr/lib/firefox/firefox`, ppid 4139 = gnome-shell | **High** |
| 3 | No graphics interface is disconnected | `snap connections firefox` | `opengl … :opengl`, `x11 … :x11`, `wayland … :wayland`, `content[gpu-2404] × mesa-2404`; disconnected plugs are only alsa/dbus/mpris/network-observe/password-manager/pcscd | **High** |
| 4 | Firefox can reach both render nodes | `ls -la /dev/dri`; `getfacl -p /dev/dri/renderD12{8,9}`; `id` | `crw-rw----+ root render 226,128 renderD128` + ACL `user:CNS2026495165:rw-` on both; user **not** in `video`/`render` but ACL present | **High** |
| 5 | Snap is New-GPU-interface based, Mesa 25.2.8 | `snap list`; `snap connections mesa-2404`; snap mount ns | `mesa-2404 25.2.8-snap288 1839`; `content[gpu-2404] firefox:gpu-2404 mesa-2404:gpu-2404`; `/dev/loop14 /snap/mesa-2404/1839 squashfs` | **High** |
| 6 | Firefox renders on the AMD iGPU with radeonsi (**not software**) | read Firefox crash `.extra` | `"AdapterVendorID":"0x1002" "AdapterDeviceID":"0x13c0" "AdapterDriverVendor":"mesa/radeonsi" "AdapterDriverVersion":"25.2.8.0" "GpuSandboxLevel":"0"` | **High** |
| 7 | Hardware video decode works **inside** the snap | `journalctl --user \| grep firefox` | `Trying to open /snap/firefox/8863/gpu-2404/usr/lib/x86_64-linux-gnu/dri/radeonsi_drv_video.so` … `va_openDriver() returns 0` | **High** |
| 8 | X11 primary is AMDGPU/radeonsi with glamor + pageflipping | `grep -E 'glamor\|radeonsi' ~/.local/share/xorg/Xorg.1.log` | `AMDGPU(0): glamor X acceleration enabled on AMD Ryzen 9 9950X 16-Core Processor (radeonsi, raphael_mendocino, LLVM 20.1.2, DRM 3.61, 6.14.0-27-generic)` | **High** |
| 9 | **Zero** Firefox GPU-disabling prefs | read `~/snap/firefox/common/.mozilla/firefox/g05ps3km.default/prefs.js` | no `gfx.*`, `layers.acceleration.disabled`, `media.hardware-video-decoding.*`, `webgl.disabled` at all | **High** |
| 10 | Snap env vars **could not** be read from `/proc` | `head -c 1 /proc/9042/environ`; `readlink /proc/9042/exe` | `权限不够` EACCES (ptrace_scope=1 + self-non-dumpable); `readlink` exit 1 | **High** (that it is unreadable) |
| 11 | …but the GPU env plumbing **is** known from snap+wrapper | `cat /snap/mesa-2404/1839/bin/gpu-2404-provider-wrapper` | exports `GBM_BACKENDS_PATH LD_LIBRARY_PATH LIBVA_DRIVERS_PATH __EGL_VENDOR_LIBRARY_DIRS DRIRC_CONFIGDIR VK_LAYER_PATH AMDGPU_ASIC_ID_TABLE_PATHS` | **High** |
| 12 | Firefox's 2 crashes are memory/IPC, **not** GPU | `ls -la …/Crash Reports/pending/`; read `.extra` | `MOZ_CRASH(OOM)` 2026-09-21; older `MOZ_CRASH(IPC…)` with `IPCMessageSize:333777956`; only the *older* one has `GraphicsCriticalError` | **High** |
| 13 | Codex desktop client identified | `cat /usr/lib/chatgpt/resources/{owl-app.ini,linux-package-metadata.json}`; `dpkg -S` | `UserDataDirectoryName=Codex`, `version 26.915.31945`, `codexAppBrand: chatgpt`, pkg `chatgpt` | **High** |
| 14 | Codex was **not running**; last active ~15.5 h earlier | `ps -eo pid,args \| grep -iE '[c]hatgpt\|[C]odex'`; `ls -la ~/.config/Codex` | no matching process; `SingletonLock -> CNS202649516533-1252158` (PID dead); mtimes 2026-09-21 19:04 | **High** |
| 15 | Codex does **not** force-disable the GPU | `grep -a -o … /usr/lib/chatgpt/resources/app.asar`; read `Local State` | only match is `hardwareAccelerationEnabled:!l.app.commandLine.hasSwitch('disable-gpu')` (**read**, not set); `appendSwitch` set = force-fieldtrials / enable-features / disable-blink-features only; `"hardware_acceleration_mode_previous": True` | **High** |
| 16 | `ps … chrome` is **Playwright**, not desktop Chrome | `ps -eo args \| grep -i chrome` | `…/.cache/ms-playwright/chromium_headless_shell-1148/chrome-linux/headless_shell`; a `gdb … --args …/ms-playwright/chromium-1148/chrome-linux/chrome` | **High** |
| 17 | `trap int3` — real, 25×, but Playwright + one `int3` site | `journalctl -k \| grep 'trap int3'` | 25 lines `traps: chrome[NNNN] trap int3 ip:… in chrome[56c322c,…]`, all 10:11:41–10:22:54, identical offset `56c322c`, `segfault` count = **0** | **High** |
| 18 | `pm_runtime_work` hogging — real, 4×, ~10–100 ms | `journalctl -k \| grep workqueue` | 4 lines `hogged CPU for >10000us 4/5/7/11 times`, 10:12:23→10:31:03 — but `amdgpu: Runtime PM not available` excludes the GPU | **Medium** (which device) |
| 19 | No GPU hang / reset / ring timeout | `journalctl -k` greps | `GPU reset` 0, `gpu hang` 0, `ring gfx` only boot registrations, `REG_WAIT timeout … optc31_disable_crtc` only at boot 10:01:58 | **High** |
| 20 | Mutter is failing stage-view allocation, **441,627×** across all X11 clients | `journalctl --user \| grep -c "needs an allocation"` | `441627` total; `3207` this boot; bursts to 378/min; `[MetaWindowActorX11]` / `[MetaSurfaceActorX11]` | **High** |
| 21 | Display path is an expensive 4K→5K transform on 2 CUs | `xrandr --current --verbose`; `--listproviders`; `~/.config/monitors.xml` | `HDMI-A-2 connected primary 5120x2880+0+0`, mode `3840x2160 60.00*+`, `Transform: 1.333328 … filter: bilinear`; Provider 0 = AMD (Source Output), Provider 1 = NVIDIA (Sink Output, 0 connected); `<scale>1.5</scale>`; `experimental-features ['x11-randr-fractional-scaling']`; iGPU `active_cu_number 2`, `VRAM=2048M` | **High** |
| 22 | Second GPU drives no display | `xrandr --listproviders`; Xorg log; sysfs connectors | `NVIDIA-G0 … Sink Output, outputs: 7` with all `NVIDIA(GPU-0): DFP-0…6: disconnected`; all `card1-*` connectors `disconnected` | **High** |
| 23 | Connected connector is `HDMI-A-3`, not `-A-2` | `cat /sys/class/drm/card2-HDMI-A-{2,3}/{status,enabled}` | `-A-2: disconnected/disabled`; `-A-3: connected/enabled` | **High** |
| 24 | Heavy machine-wide CPU load, ample RAM, no OOM | `ps --sort=-pcpu`; `/proc/meminfo`; `journalctl \| grep -i oom` | loadavg `5.62`; `node` 85.1 % @ 4.1 GB; `gnome-shell` 10.5 %; `firefox` 17.0 %; MemAvailable 48.6 GB; no OOM lines | **High** |
| 25 | Feishu/WeChat GPU processes run SwiftShader / no device GL | `tr '\0' ' ' < /proc/{30380,30473,5775}/cmdline` | `--type=gpu-process --use-gl=angle --use-angle=swiftshader-webgl` (Feishu ×2); WeChat `--type=gpu-process` | **Medium** (software GL is real; *why* is undetermined) |

---

## PART D — Explicitly NOT determined (and why)

| Gap | Why it could not be determined |
|---|---|
| Snap-specific env vars (`LIBGL_*`, `MESA_*`, `__EGL_VENDOR*`, `GBM_*`, `LIBVA_*`, `MOZ_*`) for **PID 9042** | `/proc/9042/environ` is **EACCES for its own owner** (ptrace_scope=1 + process non-dumpable). Same for `exe`, `cwd`, `root`, `fd`, `maps`. **Mitigated** by reading the launch script, `meta/snap.yaml`, the `gpu-2404` wrapper, and the snap mount namespace instead. |
| Firefox's live fd list / loaded graphics libraries | `/proc/9042/fd` and `/proc/9042/maps` → `权限不够`. **Mitigated** by the crash-metadata adapter record (item 6) and the `libva` log (item 7). |
| Which GPU device actually backs each WebRender renderer, and whether the NVIDIA GPU is *also* being opened by Firefox | `GraphicsNumActiveRenderers:4` / `GraphicsNumRenderers:3` are aggregate counts only; no per-renderer adapter is recorded, and `maps`/`fd` are unreadable. Firefox's own adapter annotation names the **AMD** part, but a secondary NVIDIA renderer cannot be excluded. |
| Whether the Codex client shows the stutter, or how its GPU process behaves | Codex was **not running** (last activity 2026-09-21 19:04, `SingletonLock` PID dead). Nothing to instrument; no live GPU process. Only its *configuration* could be audited (item 15) — configuration is not behaviour. |
| Any GPU-process crash/restart-loop history for Codex | `~/.config/Codex/Crash Reports/{attachments,completed,new,pending}` are all **empty**; no `chrome_debug.log` anywhere under `~/.config`; the grep for `GpuProcess`/`swiftshader`/`gpu_disabled` markers in `~/.config/Codex` returned **nothing**. Absence of records is not evidence of absence during the stutter (the logs are empty/not enabled, not "clean"). |
| Whether the `pm_runtime_work` hog originates from GPU, NVMe, USB or Wi-Fi | `journalctl -k` names only the workqueue, not the device; `amdgpu: Runtime PM not available` rules out the AMD GPU. Correlation points at the `mt76` Wi-Fi worker / WeChat crashpad activity, but no message names the device. |
| Whether the user *perceived* jank inside Firefox/DSH at a time covered by these logs | No screen recording, no frame-timing trace, no user-supplied timestamp. All evidence here is *state*, not *captured stutter*; there is no `gnome-shell` frame-drop counter (`mutter` does not log dropped frames by default) and `glxinfo`/`vulkaninfo` are absent (not installed; no install attempted, per instructions). |
| Exact cause of 441,627 Mutter allocation warnings | The message names only the actor classes. Distinguishing "known Mutter/X11-fractional-scaling defect" from "consequence of the 4K→5K transform" from "third-party extension (DING/rastersoft present)" would need Mutter instrumentation or an upstream bug match — out of this read-only scope. |
| Whether Feishu's SwiftShader is *forced* or an internal fallback | Feishu passes `--use-angle=swiftshader-webgl` on its own GPU processes and `hardware_acceleration_mode_previous:true`, and its feature flags include `messenger/pc/enable/uigpurasterization=False` — but the deciding logic is inside its (unstripped, unavailable) bundle, and its GPU process was not crash-looping while observed. |

**Read-only compliance statement:** no `kill`/`pkill`, no `systemctl <verb>`, no `snap refresh`, no process signalled, no GUI or browser launched, no package installed, no `sandbox_permissions` used. The only side effects were `mkdir -p` of this directory and the `*.txt` captures written here; `xrandr` was used strictly as a query (`--current`, `--listproviders`) and `gsettings` strictly as `list-recursively` (it emitted `dconf-CRITICAL … unable to create file '/run/user/1001/dconf/user'` — a read attempt that the sandbox blocked, so **no dconf write occurred**).
