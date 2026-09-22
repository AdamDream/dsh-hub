# FINDINGS-xorg.md — X / display-GPU history reconstruction around 2026-09-20 17:18

Investigator: read-only forensic subagent. Host `CNS202649516533` (formerly `itadm-X870-AORUS-ELITE-WIFI7`),
user `CNS2026495165`, Ubuntu 24.04, kernel 6.14.0-27-generic, GNOME Shell 46 on X11/Xorg.
Investigation time: 2026-09-22 ~11:08–11:15 CST.
No state-changing command was run (no xrandr/xdotool/dconf write/gsettings/systemctl/reboot). Read-only queries only.

---

## 0. HEADLINE RESULT (read this first)

**The Xorg log that spans 2026-09-20 17:18 exists and is:**

| field | value |
|---|---|
| **path** | `/home/CNS2026495165/.local/share/xorg/Xorg.1.log.old` |
| **size** | 100145 bytes, 1323 lines |
| **mtime** | **2026-09-21 19:04:30.953833220 +0800** |
| ctime | 2026-09-22 10:02:17.473167204 +0800 (when the *next* session's log rotation renamed it) |
| crtime (birth) | **2026-09-20 11:12:48.964735790 +0800** |
| first internal timestamp | `[   130.097]` = **2026-09-20 11:12:48** (absolute, from the log's own header) |
| last internal timestamp | `[114833.352]` = **2026-09-21 19:04:30** (file mtime; boot ended 19:04:33) |
| ends with | `(II) Server terminated successfully (0). Closing log file.` → **clean shutdown, no crash** |

**It was started under the AMD/Raphael iGPU and torn down under the AMD/Raphael iGPU. There is no GPU
binding change anywhere inside it.** The NVIDIA RTX 4090 was present in this same X server but bound as a
**display-less PRIME secondary (`NVIDIA(G0)`, all 7 connectors disconnected)** at both the beginning
(11:12:48) and the end (19:04:30) of the log. The only display output that ever existed is
`AMDGPU(0): Output HDMI-A-2 connected … using initial mode 3840x2160 +0+0`.

The first *usable* X session log for the machine (`Xorg.1.log`) is the **current** session
(2026-09-22 10:02:17 onward) and its GPU binding section is **byte-for-byte the same** binding pattern as
`Xorg.1.log.old` (AMDGPU(0) primary on HDMI-A-2 + NVIDIA(G0) empty). So the X binding has been
"AMD primary + NVIDIA render" for every Xorg log that survives on this machine.

---

## 1. X server log inventory (all of them, with stat + internal coverage)

### 1a. Command

```
ls -la --time-style=full-iso /var/log/Xorg* 2>&1
ls -la --time-style=full-iso /var/log/gdm3/ 2>&1
ls -la --time-style=full-iso /var/log/lightdm/ 2>&1
ls -la --time-style=full-iso /home/CNS2026495165/.local/share/xorg/
stat /home/CNS2026495165/.local/share/xorg/Xorg.1.log /home/CNS2026495165/.local/share/xorg/Xorg.1.log.old
find / -xdev \( -name 'Xorg*.log*' -o -name 'xorg*.log*' \) 2>/dev/null
```

### 1b. Table

| path | size | mtime | first internal timestamp | last internal timestamp |
|---|---|---|---|---|
| `/var/log/Xorg.*.log`, `/var/log/Xorg.*.log.old`, `.gz` | — | — | **DOES NOT EXIST** | `ls: 无法访问 '/var/log/Xorg*': 没有那个文件或目录` |
| `/var/log/gdm3/` | — | dir mtime 2026-08-11 01:02:56 | **PERMISSION DENIED** | `ls: 无法打开目录 '/var/log/gdm3/': 权限不够` (mode `drwx--x--x root gdm`) |
| `/var/log/lightdm/` | — | — | **DOES NOT EXIST** | `ls: 无法访问 '/var/log/lightdm/': 没有那个文件或目录` |
| `/home/CNS2026495165/.local/share/xorg/Xorg.1.log` (current) | 291556 | **2026-09-22 10:37:38.547583798** | `[29.306]` = **2026-09-22 10:02:17** | open (last data `[2151.480]`, file still being appended) |
| `/home/CNS2026495165/.local/share/xorg/Xorg.1.log.old` | 100145 | **2026-09-21 19:04:30.953833220** | `[130.097]` = **2026-09-20 11:12:48** | `[114833.352]` = **2026-09-21 19:04:30** |

Whole-filesystem search for any other Xorg log (readable paths):

```
/home/CNS2026495165/.local/share/xorg/Xorg.1.log
/home/CNS2026495165/.local/share/xorg/Xorg.1.log.old
```
(nothing else — no `/var/log/Xorg.*` family exists on this machine, and no rotated `.gz` variant of the
user logs exists; the user's log directory contains exactly these two files.)

### 1c. Additional X-server log that exists but is NOT readable (important for the earlier boot)

The *login-screen* X server writes to `/var/lib/gdm3/.local/share/xorg/Xorg.0.log`. Its existence and
content are visible only indirectly through the journal (the `gdm-x-session` process prints the whole log
to stderr). Directory listing is denied:

```
$ ls -la --time-style=full-iso /var/lib/gdm3/.local/share/xorg/
ls: 无法访问 '/var/lib/gdm3/.local/share/xorg/': 权限不够
```

Journal lines proving that file exists (verbatim, `journalctl -b -1 -o short-iso`):

```
2026-09-20T11:10:45+08:00 CNS202649516533 /usr/libexec/gdm-x-session[2432]: (--) Log file renamed from "/var/lib/gdm3/.local/share/xorg/Xorg.pid-2432.log" to "/var/lib/gdm3/.local/share/xorg/Xorg.0.log"
2026-09-20T11:10:45+08:00 CNS202649516533 /usr/libexec/gdm-x-session[2432]: (==) Log file: "/var/lib/gdm3/.local/share/xorg/Xorg.0.log", Time: Sun Sep 20 11:10:45 2026
2026-09-22T10:02:00+08:00 CNS202649516533 /usr/libexec/gdm-x-session[2661]: (--) Log file renamed from "/var/lib/gdm3/.local/share/xorg/Xorg.pid-2661.log" to "/var/lib/gdm3/.local/share/xorg/Xorg.0.log"
2026-09-22T10:02:00+08:00 CNS202649516533 /usr/libexec/gdm-x-session[2661]: (==) Log file: "/var/lib/gdm3/.local/share/xorg/Xorg.0.log", Time: Tue Sep 22 10:02:00 2026
```

Absolute-time mapping of the two user X servers (internal `[uptime]` → wall clock, anchored on the log's
own `(==) Log file: … Time:` header and the journal's `gdm-x-session` PID):

```
2026-09-20T11:12:48+08:00 CNS202649516533 /usr/libexec/gdm-x-session[3931]: (--) Log file renamed from "/home/CNS2026495165/.local/share/xorg/Xorg.pid-3931.log" to "/home/CNS2026495165/.local/share/xorg/Xorg.1.log"
2026-09-20T11:12:48+08:00 CNS202649516533 /usr/libexec/gdm-x-session[3931]: X.Org X Server 1.21.1.11
2026-09-20T11:12:48+08:00 CNS202649516533 /usr/libexec/gdm-x-session[3931]: (==) Log file: "/home/CNS2026495165/.local/share/xorg/Xorg.1.log", Time: Sun Sep 20 11:12:48 2026
2026-09-22T10:02:17+08:00 CNS202649516533 /usr/libexec/gdm-x-session[3884]: (--) Log file renamed from "/home/CNS2026495165/.local/share/xorg/Xorg.pid-3884.log" to "/home/CNS2026495165/.local/share/xorg/Xorg.1.log"
2026-09-22T10:02:17+08:00 CNS202649516533 /usr/libexec/gdm-x-session[3884]: X.Org X Server 1.21.1.11
2026-09-22T10:02:17+08:00 CNS202649516533 /usr/libexec/gdm-x-session[3884]: (==) Log file: "/home/CNS2026495165/.local/share/xorg/Xorg.1.log", Time: Tue Sep 22 10:02:17 2026
```

---

## 2. The one log that spans 2026-09-20 17:18 — verbatim extraction

**File: `/home/CNS2026495165/.local/share/xorg/Xorg.1.log.old`**
(raw filtered dump: `raw/xorg-10-Xorg.1.log.old-filtered.txt`; key excerpts: `raw/xorg-05-key-excerpts.txt`)

### 2a. Version banner and start timestamp

```
1:[   130.097] _XSERVTransSocketUNIXCreateListener: ...SocketCreateListener() failed
2:[   130.097] _XSERVTransMakeAllCOTSServerListeners: server already running
3:[   130.097] (--) Log file renamed from "/home/CNS2026495165/.local/share/xorg/Xorg.pid-3931.log" to "/home/CNS2026495165/.local/share/xorg/Xorg.1.log"
4:[   130.097] 
5:X.Org X Server 1.21.1.11
6:X Protocol Version 11, Revision 0
7:[   130.097] Current Operating System: Linux CNS202649516533 6.14.0-27-generic #27~24.04.1-Ubuntu SMP PREEMPT_DYNAMIC Tue Jul 22 17:38:49 UTC 2 x86_64
8:[   130.097] Kernel command line: BOOT_IMAGE=/boot/vmlinuz-6.14.0-27-generic root=UUID=38c1adbf-c111-44ca-bb6b-7c041bea3a19 ro quiet splash vt.handoff=7
9:[   130.097] xorg-server 2:21.1.12-1ubuntu1.4 (For technical support please see http://www.ubuntu.com/support) 
10:[   130.097] Current version of pixman: 0.42.2
17:[   130.097] (==) Log file: "/home/CNS2026495165/.local/share/xorg/Xorg.1.log", Time: Sun Sep 20 11:12:48 2026
18:[   130.098] (==) Using config directory: "/etc/X11/xorg.conf.d"
19:[   130.098] (==) Using system config directory "/usr/share/X11/xorg.conf.d"
20:[   130.098] (==) ServerLayout "layout"
21:[   130.098] (==) No screen section available. Using defaults.
```

### 2b. GPU / device / PCI / driver-binding lines (the answer to "which GPU is X bound to")

```
52:[   130.098] (++) using VT number 2
54:[   130.098] (II) systemd-logind: took control of session /org/freedesktop/login1/session/_32
57:[   130.100] (II) xfree86: Adding drm device (/dev/dri/card1)
58:[   130.100] (II) Platform probe for /sys/devices/pci0000:00/0000:00:01.1/0000:01:00.0/drm/card1
59:[   130.100] (II) systemd-logind: got fd for /dev/dri/card1 226:1 fd 15 paused 0
60:[   130.100] (II) xfree86: Adding drm device (/dev/dri/card2)
61:[   130.100] (II) Platform probe for /sys/devices/pci0000:00/0000:00:08.1/0000:73:00.0/drm/card2
62:[   130.100] (II) systemd-logind: got fd for /dev/dri/card2 226:2 fd 16 paused 0
63:[   130.101] (**) OutputClass "nvidia" ModulePath extended to "/usr/lib/x86_64-linux-gnu/nvidia/xorg,/usr/lib/xorg/modules"
64:[   130.102] (--) PCI: (1@0:0:0) 10de:2684:10de:16f3 rev 161, Mem @ 0xdd000000/16777216, 0xf000000000/34359738368, 0xf800000000/33554432, I/O @ 0x0000f000/128, BIOS @ 0x????????/524288
65:[   130.102] (--) PCI:*(115@0:0:0) 1002:13c0:1458:d000 rev 193, Mem @ 0xf810000000/268435456, 0xde200000/2097152, 0xde700000/524288, I/O @ 0x0000e000/256
78:[   130.103] (II) Applying OutputClass "AMDgpu" to /dev/dri/card2
79:[   130.103] 	loading driver: amdgpu
80:[   130.103] (II) Applying OutputClass "nvidia" to /dev/dri/card1
81:[   130.103] 	loading driver: nvidia
82:[   130.566] (==) Matched amdgpu as autoconfigured driver 0
84:[   130.566] (==) Matched nvidia as autoconfigured driver 2
86:[   130.566] (==) Matched modesetting as autoconfigured driver 4
108:[   130.797] (II) LoadModule: "nvidia"
109:[   130.797] (II) Loading /usr/lib/x86_64-linux-gnu/nvidia/xorg/nvidia_drv.so
110:[   130.798] (II) Module nvidia: vendor="NVIDIA Corporation"
262:[   130.799] (II) NVIDIA dlloader X Driver  595.84  Wed Jun 10 20:51:08 UTC 2026
263:[   130.799] (II) NVIDIA Unified Driver for all Supported NVIDIA GPUs
287:[   130.801] (WW) Falling back to old probe method for modesetting
288:[   130.801] (EE) open /dev/dri/card0: No such file or directory
296:[   130.801] (EE) open /dev/fb0: Permission denied
307:[   130.802] (WW) VGA arbiter: cannot open kernel arbiter, no multi-card support
313:[   130.802] (II) Applying OutputClass "AMDgpu" options to /dev/dri/card2
316:[   130.802] (--) AMDGPU(0): Chipset: "AMD Ryzen 9 9950X 16-Core Processor" (ChipID = 0x13c0)
329:[   130.828] (II) AMDGPU(0): glamor X acceleration enabled on AMD Ryzen 9 9950X 16-Core Processor (radeonsi, raphael_mendocino, LLVM 20.1.2, DRM 3.61, 6.14.0-27-generic)
```

NVIDIA is loaded **as a second, display-less X screen** (`NVIDIA(G0)`), not as the primary output provider:

```
446:[   130.831] (==) NVIDIA(G0): Depth 24, (==) framebuffer bpp 32
449:[   130.831] (==) NVIDIA(G0): Using gamma correction (1.0, 1.0, 1.0)
452:[   130.831] (**) NVIDIA(G0): Option "AllowEmptyInitialConfiguration"
453:[   130.831] (**) NVIDIA(G0): Enabling 2D acceleration
461:[   130.836] (II) NVIDIA: The X server supports PRIME Render Offload.
462:[   130.840] (--) NVIDIA(0): Valid display device(s) on GPU-0 at PCI:1:0:0
463:[   130.840] (--) NVIDIA(0):     DFP-0
464:[   130.840] (--) NVIDIA(0):     DFP-1
465:[   130.840] (--) NVIDIA(0):     DFP-2
466:[   130.840] (--) NVIDIA(0):     DFP-3
467:[   130.840] (--) NVIDIA(0):     DFP-4
468:[   130.840] (--) NVIDIA(0):     DFP-5
469:[   130.840] (--) NVIDIA(0):     DFP-6
470:[   130.850] (II) NVIDIA(G0): NVIDIA GPU NVIDIA GeForce RTX 4090 (AD102-A) at PCI:1:0:0
471:[   130.850] (II) NVIDIA(G0):     (GPU-0)
472:[   130.850] (--) NVIDIA(G0): Memory: 25153536 kBytes
473:[   130.850] (--) NVIDIA(G0): VideoBIOS: 95.02.3c.00.02
474:[   130.850] (II) NVIDIA(G0): Detected PCI Express Link width: 16X
475:[   130.850] (--) NVIDIA(GPU-0): DFP-0: disconnected
479:[   130.850] (--) NVIDIA(GPU-0): DFP-1: disconnected
483:[   130.851] (--) NVIDIA(GPU-0): DFP-2: disconnected
487:[   130.851] (--) NVIDIA(GPU-0): DFP-3: disconnected
491:[   130.851] (--) NVIDIA(GPU-0): DFP-4: disconnected
495:[   130.851] (--) NVIDIA(GPU-0): DFP-5: disconnected
499:[   130.852] (--) NVIDIA(GPU-0): DFP-6: disconnected
503:[   130.856] (II) NVIDIA(G0): Validated MetaModes:
504:[   130.856] (II) NVIDIA(G0):     "NULL"
505:[   130.856] (II) NVIDIA(G0): Virtual screen size determined to be 640 x 480
506:[   130.856] (WW) NVIDIA(G0): Unable to get display device for DPI computation.
507:[   130.856] (==) NVIDIA(G0): DPI set to (75, 75); computed from built-in default
547:[   130.884] (II) NVIDIA(G0): Setting mode "NULL"
556:[   130.904] (II) NVIDIA(G0): [DRI2]   VDPAU driver: nvidia
586:[   130.908] (II) AIGLX: Loaded and initialized radeonsi
587:[   130.908] (II) GLX: Initialized DRI2 GL provider for screen 0
594:[   130.909] (II) AMDGPU(0): Setting screen physical size to 1016 x 571
1320:[114833.311] (II) NVIDIA(GPU-0): Deleting GPU-0
```

`(EE) open /dev/fb0: Permission denied` is **not** a GPU-binding failure — `/dev/fb0` is currently
`crw-rw---- root video` and the X server runs as uid 1001, so it has no permission to the framebuffer
device; harmless for a non-root X session. The `(EE) open /dev/dri/card0: No such file or directory`
is the modesetting driver probing a non-existent card0 (only card1/card2 exist).

### 2c. Full connector / output enumeration (the "physical display" answer)

```
335:[   130.828] (II) AMDGPU(0): Output HDMI-A-1 has no monitor section
336:[   130.829] (II) AMDGPU(0): Output HDMI-A-2 has no monitor section
337:[   130.829] (II) AMDGPU(0): Output DisplayPort-3 has no monitor section
338:[   130.829] (II) AMDGPU(0): Output DisplayPort-4 has no monitor section
339:[   130.830] (II) AMDGPU(0): EDID for output HDMI-A-1
340:[   130.831] (II) AMDGPU(0): EDID for output HDMI-A-2
341:[   130.831] (II) AMDGPU(0): Manufacturer: GSM  Model: 5cbb  Serial#: 631582
342:[   130.831] (II) AMDGPU(0): Year: 2026  Week: 6
343:[   130.831] (II) AMDGPU(0): EDID Version: 1.3
344:[   130.831] (II) AMDGPU(0): Digital Display Input
345:[   130.831] (II) AMDGPU(0): Max Image Size [cm]: horiz.: 60  vert.: 34
366:[   130.831] (II) AMDGPU(0): Monitor name: LG ULTRAFINE
367:[   130.831] (II) AMDGPU(0): Serial No: 606NTUWJK582
398:[   130.831] (--) AMDGPU(0): HDMI max TMDS frequency 300000KHz
399:[   130.831] (II) AMDGPU(0): Printing probed modes for output HDMI-A-2
400:[   130.831] (II) AMDGPU(0): Modeline "3840x2160"x60.0  594.00  3840 4016 4104 4400  2160 2168 2178 2250 +hsync +vsync (135.0 kHz eP)
403:[   130.831] (II) AMDGPU(0): Modeline "3840x2160"x30.0  297.00  3840 4016 4104 4400  2160 2168 2178 2250 +hsync +vsync (67.5 kHz e)
432:[   130.831] (II) AMDGPU(0): EDID for output DisplayPort-3
433:[   130.831] (II) AMDGPU(0): EDID for output DisplayPort-4
434:[   130.831] (II) AMDGPU(0): Output HDMI-A-1 disconnected
435:[   130.831] (II) AMDGPU(0): Output HDMI-A-2 connected
436:[   130.831] (II) AMDGPU(0): Output DisplayPort-3 disconnected
437:[   130.831] (II) AMDGPU(0): Output DisplayPort-4 disconnected
438:[   130.831] (II) AMDGPU(0): Using exact sizes for initial modes
439:[   130.831] (II) AMDGPU(0): Output HDMI-A-2 using initial mode 3840x2160 +0+0
520:[   130.857] (II) AMDGPU(0): [DRI2] Setup complete
521:[   130.857] (II) AMDGPU(0): [DRI2]   DRI driver: radeonsi
522:[   130.857] (II) AMDGPU(0): [DRI2]   VDPAU driver: radeonsi
523:[   130.857] (II) AMDGPU(0): Front buffer pitch: 15360 bytes
526:[   130.857] (==) AMDGPU(0): DRI3 enabled
528:[   130.857] (II) AMDGPU(0): Direct rendering enabled
529:[   130.861] (II) AMDGPU(0): Use GLAMOR acceleration.
530:[   130.861] (II) AMDGPU(0): Acceleration enabled
533:[   130.861] (II) AMDGPU(0): Set up textured video (glamor)
534:[   130.861] (WW) AMDGPU(0): Option "HotplugDriver" is not used
```

There is **no `Transform`, `Panning`, `Tearing`, `PRIME` sink/source assignment, or `GBM` line** for the
AMD screen in this log; the only PRIME line is `461:[   130.836] (II) NVIDIA: The X server supports PRIME Render Offload.`
There is **no `Virtual screen` line for the AMD screen other than `505:` (NVIDIA `640 x 480`)** — the AMD
screen is 3840x2160 through the HDMI-A-2 mode. There is **no "RandR"/"Reconfigured"/"Adding output"/
"Removing output" line anywhere in the file** (grep found zero matches).

### 2d. All WARNING / ERROR lines in the file (complete list, 14 lines)

```
31:[   130.098] (WW) The directory "/usr/share/fonts/X11/cyrillic" does not exist.
33:[   130.098] (WW) The directory "/usr/share/fonts/X11/100dpi/" does not exist.
35:[   130.098] (WW) The directory "/usr/share/fonts/X11/75dpi/" does not exist.
37:[   130.098] (WW) The directory "/usr/share/fonts/X11/100dpi" does not exist.
39:[   130.098] (WW) The directory "/usr/share/fonts/X11/75dpi" does not exist.
287:[   130.801] (WW) Falling back to old probe method for modesetting
288:[   130.801] (EE) open /dev/dri/card0: No such file or directory
289:[   130.801] (WW) Falling back to old probe method for fbdev
296:[   130.801] (EE) open /dev/fb0: Permission denied
307:[   130.802] (WW) VGA arbiter: cannot open kernel arbiter, no multi-card support
506:[   130.856] (WW) NVIDIA(G0): Unable to get display device for DPI computation.
534:[   130.861] (WW) AMDGPU(0): Option "HotplugDriver" is not used
535:[   130.861] (WW) NVIDIA: Failed to bind sideband socket to
536:[   130.861] (WW) NVIDIA:     '/var/run/nvidia-xdriver-ed35db4a' Permission denied
1231:[ 10841.617] (WW) Option "xkb_variant" requires a string value
1232:[ 10841.617] (WW) Option "xkb_options" requires a string value
1321:[114833.351] (WW) xf86CloseConsole: KDSETMODE failed: Input/output error
1322:[114833.351] (WW) xf86CloseConsole: VT_GETMODE failed: Input/output error
```

All of these are startup-probe noise (font paths, card0/fb0 probing, NVIDIA sideband socket in /var/run,
xkb options from a libinput virtual subdevice) — **none of them is an X server restart or a GPU switch, and
none is timestamped anywhere near 17:18.**

Corresponding NVIDIA complaints as captured by the journal for the same session (verbatim,
`journalctl -b -1 -o short-iso`):

```
2026-09-20T11:12:49+08:00 CNS202649516533 /usr/libexec/gdm-x-session[3931]: (WW) NVIDIA: Failed to bind sideband socket to
2026-09-20T11:12:49+08:00 CNS202649516533 /usr/libexec/gdm-x-session[3931]: (WW) NVIDIA:     '/var/run/nvidia-xdriver-ed35db4a' Permission denied
2026-09-20T11:12:49+08:00 CNS202649516533 /usr/libexec/gdm-x-session[3931]: (II) NVIDIA(G0): [DRI2]   VDPAU driver: nvidia
2026-09-20T11:12:50+08:00 CNS202649516533 systemd[3776]: Started app-gnome-nvidia\x2dsettings\x2dautostart-4395.scope - Application launched by gnome-session-binary.
```
and, from the **login-screen** X server (PID 2432, the file we cannot read), the NVIDIA display config
failure caused by the fact that the *gdm* session is not the foreground one:

```
2026-09-20T11:12:51+08:00 CNS202649516533 /usr/libexec/gdm-x-session[2432]: (WW) NVIDIA(G0): Failed to set the display configuration
2026-09-20T11:12:51+08:00 CNS202649516533 /usr/libexec/gdm-x-session[2432]: (WW) NVIDIA(G0):  - Setting a mode on head 0 failed: Insufficient permissions
2026-09-20T11:12:51+08:00 CNS202649516533 /usr/libexec/gdm-x-session[2432]: (WW) NVIDIA(G0):  - Setting a mode on head 1 failed: Insufficient permissions
2026-09-20T11:12:51+08:00 CNS202649516533 /usr/libexec/gdm-x-session[2432]: (WW) NVIDIA(G0):  - Setting a mode on head 2 failed: Insufficient permissions
2026-09-20T11:12:51+08:00 CNS202649516533 /usr/libexec/gdm-x-session[2432]: (WW) NVIDIA(G0):  - Setting a mode on head 3 failed: Insufficient permissions
```

### 2e. End of log — clean shutdown, not a crash

```
1289:[114833.230] (II) systemd-logind: not releasing fd for 13:94, still in use
1293:[114833.230] (II) systemd-logind: not releasing fd for 13:70, still in use
1295:[114833.232] (II) systemd-logind: not releasing fd for 13:88, still in use
1320:[114833.311] (II) NVIDIA(GPU-0): Deleting GPU-0
1321:[114833.351] (WW) xf86CloseConsole: KDSETMODE failed: Input/output error
1322:[114833.351] (WW) xf86CloseConsole: VT_GETMODE failed: Input/output error
1323:[114833.352] (II) Server terminated successfully (0). Closing log file.
```

No `signal`, no `Segmentation fault`, no `Fatal server error`, no `caught signal`, no `OsAbort`,
no `dix_main` trace anywhere in the file. **The session ended because the machine was shut down**
(boot -1 ended 2026-09-21 19:04:34; `last -F -x` → `shutdown system down … Mon Sep 21 19:04:33 2026`).

### 2f. Activity distribution inside the log — proof nothing display-related happened at 17:18

```
$ grep -oE '^\[ *[0-9]+\.' Xorg.1.log.old | grep -oE '[0-9]+\.' | sort -n | uniq -c | tail -5
    661 130.      <- 130 s  = 11:12:48  (server startup)
    403 131.      <- 131 s  = 11:12:49  (startup)
     55 10841.    <- 10841 s = 14:13:5x (Logitech G502 USB mouse hot-add)
     69 114833.   <- 114833 s = 19:04:30 (shutdown teardown)
```

There is **no log line at all** between `[   131.686]` and `[ 10841.576]`, and **none** between
`[ 10841.726]` and `[114833.230]`. In particular **there is no entry at ≈`[22300]` (= 17:18)**.
The intermediate `[ 10841.617] (WW) Option "xkb_variant" requires a string value` burst is the
Logitech G502 HERO Gaming Mouse being plugged in (`/sys/devices/pci0000:00/0000:00:08.3/0000:74:00.0/usb9/…`).
No output, no CRTC, no EDID, no modeset event after startup.

---

## 3. GPU binding: before vs after 17:18, and diff vs the newer log

### 3a. At session start (11:12:48, i.e. "before 17:18")

* PCI "boot VGA" / primary device: `(--) PCI:*(115@0:0:0) 1002:13c0:1458:d000` → **AMD Raphael iGPU**
* Active X screen for display: `AMDGPU(0)` (ChipID 0x13c0) using `radeonsi` glamor,
  driving `Output HDMI-A-2 connected … using initial mode 3840x2160 +0+0` (GSM / LG ULTRAFINE, serial 606NTUWJK582)
* NVIDIA RTX 4090 (`10de:2684`, `PCI:1:0:0`) loaded as `NVIDIA(G0)` with `AllowEmptyInitialConfiguration`,
  `MetaModes: "NULL"`, `Virtual screen size … 640 x 480`, and **DFP-0 … DFP-6 all `disconnected`**

### 3b. At session end (19:04:30, i.e. "after 17:18")

The same log's teardown shows only `1320:[114833.311] (II) NVIDIA(GPU-0): Deleting GPU-0` — the NVIDIA
screen is destroyed last, exactly as it was created. **There is no second `Output … connected`, no
`Applying OutputClass` re-run, no module reload, no re-probe of the AMD or NVIDIA device in the whole file.**

### 3c. Diff with the newer log (current session)

**File: `/home/CNS2026495165/.local/share/xorg/Xorg.1.log`** (started `(==) Log file: … Time: Tue Sep 22 10:02:17 2026`)

```
64:[    29.311] (--) PCI: (1@0:0:0) 10de:2684:10de:16f3 rev 161, Mem @ 0xdd000000/16777216, 0xf000000000/34359738368, 0xf800000000/33554432, I/O @ 0x0000f000/128, BIOS @ 0x????????/524288
65:[    29.311] (--) PCI:*(115@0:0:0) 1002:13c0:1458:d000 rev 193, Mem @ 0xf810000000/268435456, 0xde200000/2097152, 0xde700000/524288, I/O @ 0x0000e000/256
78:[    29.312] (II) Applying OutputClass "AMDgpu" to /dev/dri/card2
80:[    29.312] (II) Applying OutputClass "nvidia" to /dev/dri/card1
316:[    30.011] (--) AMDGPU(0): Chipset: "AMD Ryzen 9 9950X 16-Core Processor" (ChipID = 0x13c0)
434:[    30.041] (II) AMDGPU(0): Output HDMI-A-1 disconnected
435:[    30.041] (II) AMDGPU(0): Output HDMI-A-2 connected
436:[    30.041] (II) AMDGPU(0): Output DisplayPort-3 disconnected
437:[    30.041] (II) AMDGPU(0): Output DisplayPort-4 disconnected
439:[    30.041] (II) AMDGPU(0): Output HDMI-A-2 using initial mode 3840x2160 +0+0
462:[    30.050] (--) NVIDIA(0): Valid display device(s) on GPU-0 at PCI:1:0:0
470:[    30.060] (II) NVIDIA(G0): NVIDIA GPU NVIDIA GeForce RTX 4090 (AD102-A) at PCI:1:0:0
505:[    30.067] (II) NVIDIA(G0): Virtual screen size determined to be 640 x 480
594:[    30.123] (II) AMDGPU(0): Setting screen physical size to 1016 x 571
```

**DIFF: NONE in GPU binding or connector assignment.** Both logs are identical on all of:
primary `PCI:*` = AMD 1002:13c0; NVIDIA 10de:2684 as non-primary `NVIDIA(G0)` with 640x480 NULL
MetaMode; AMD `Output HDMI-A-2 connected` at 3840x2160 with the other three AMD outputs disconnected;
`Setting screen physical size to 1016 x 571`. The only differences are wall-clock/uptime numbers
(`[130.x]` vs `[29.x]`) and the driver-dependency line numbers.

**Current live state (cross-check, read-only sysfs):** the monitor is now on `card2-HDMI-A-3`
(`status=connected enabled=enabled`); `card2-HDMI-A-2` is now `disconnected`. So the *kernel-side
connector naming/assignment changed between 09-20 and 09-22* (amdgpudrmfb output labels differ), but the
X-server *binding* (AMD primary, NVIDIA render-only, LG ULTRAFINE 3840x2160) did not.

---

## 4. Was the X server restarted on 2026-09-20? (journal + wtmp + lastlog)

### 4a. Commands

```
journalctl -b -1 --no-pager -o short-iso --since "2026-09-20 11:00" --until "2026-09-21 00:00" > raw/xorg-20-journal-boot-1-0920-1100-2400.txt
grep -nE 'Xorg|gdm|gnome-session|systemd-logind|session opened|session closed|New session|Removed session|seat0|drm|modeset' raw/xorg-20-journal-boot-1-0920-1100-2400.txt
last -F -x | head -60
lastlog
journalctl --list-boots --no-pager
```

### 4b. Every Xorg / gdm / session line for 09-20 (verbatim; full dump in `raw/xorg-21-journal-session-signals.txt`)

Boot identity:

```
2026-09-20T11:10:42+08:00 CNS202649516533 kernel: ACPI: bus type drm_connector registered
2026-09-20T11:10:42+08:00 CNS202649516533 kernel: nvidia-modeset: Loading NVIDIA UNIX Open Kernel Mode Setting Driver for x86_64  595.84  Release Build  (dvs-builder@U22-I3-AM25-26-2)  Wed Jun 10 20:53:33 UTC 2026
2026-09-20T11:10:42+08:00 CNS202649516533 kernel: [drm] [nvidia-drm] [GPU ID 0x00000100] Loading driver
2026-09-20T11:10:43+08:00 CNS202649516533 kernel: [drm] amdgpu kernel modesetting enabled.
2026-09-20T11:10:43+08:00 CNS202649516533 kernel: [drm] Initialized nvidia-drm 0.0.0 for 0000:01:00.0 on minor 1
2026-09-20T11:10:43+08:00 CNS202649516533 kernel: nvidia 0000:01:00.0: [drm] Cannot find any crtc or sizes
2026-09-20T11:10:44+08:00 CNS202649516533 kernel: [drm] Initialized amdgpu 3.61.0 for 0000:73:00.0 on minor 2
2026-09-20T11:10:44+08:00 CNS202649516533 kernel: fbcon: amdgpudrmfb (fb0) is primary device
2026-09-20T11:10:44+08:00 CNS202649516533 kernel: amdgpu 0000:73:00.0: [drm] fb0: amdgpudrmfb frame buffer device
2026-09-20T11:10:44+08:00 CNS202649516533 kernel: amdgpu 0000:73:00.0: [drm] REG_WAIT timeout 1us * 100000 tries - optc31_disable_crtc line:145
```

Session / seat creation (only once, at boot):

```
2026-09-20T11:10:44+08:00 CNS202649516533 systemd-logind[1543]: New seat seat0.
2026-09-20T11:10:45+08:00 CNS202649516533 systemd[1]: Starting gdm.service - GNOME Display Manager...
2026-09-20T11:10:45+08:00 CNS202649516533 systemd[1]: Started gdm.service - GNOME Display Manager.
2026-09-20T11:10:45+08:00 CNS202649516533 gdm-launch-environment][2384]: pam_unix(gdm-launch-environment:session): session opened for user gdm(uid=120) by (uid=0)
2026-09-20T11:10:45+08:00 CNS202649516533 systemd-logind[1543]: New session c1 of user gdm.
2026-09-20T11:10:45+08:00 CNS202649516533 systemd[1]: Started session-c1.scope - Session c1 of User gdm.
```

…then the login-screen X server (PID 2432, 11:10:45), then the user X server (PID 3931, 11:12:48),
then the user systemd instance (PID 3776) and gnome-shell (PID 2812 → then 4195).

**Search for any Xorg / gdm-x-session line after 11:13: the ONLY matches are input-device hotplug lines
inside the running X server** (e.g. the Logitech mouse at 14:11:19); there is **no new Xorg process, no
`(==) Log file: … Time:` header, no gdm `session opened` after 11:10:45, and no `Removed session` at all**
in the 11:00–24:00 window. Verbatim sample of the only post-11:13 Xorg activity:

```
2026-09-20T14:11:19+08:00 CNS202649516533 /usr/libexec/gdm-x-session[3931]: (II) config/udev: Adding input device Logitech G502 HERO Gaming Mouse (/dev/input/mouse2)
2026-09-20T14:11:19+08:00 CNS202649516533 /usr/libexec/gdm-x-session[3931]: (II) No input driver specified, ignoring this device.
2026-09-20T14:11:19+08:00 CNS202649516533 /usr/libexec/gdm-x-session[3931]: (II) config/udev: Adding input device Logitech G502 HERO Gaming Mouse Keyboard (/dev/input/event30)
```

The 17:33 event (the "only session signal" in the brief) verbatim:

```
2026-09-20T17:33:07+08:00 CNS202649516533 dbus-daemon[1505]: [system] Activating via systemd: service name='net.reactivated.Fprint' unit='fprintd.service' requested by ':1.136' (uid=1001 pid=419…
2026-09-20T17:33:07+08:00 CNS202649516533 systemd[1]: Started fprintd.service - Fingerprint Authentication Daemon.
2026-09-20T17:33:20+08:00 CNS202649516533 gdm-password][713452]: gkr-pam: unlocked login keyring
2026-09-20T17:33:20+08:00 CNS202649516533 gnome-shell[4195]: Launching DING process
2026-09-20T17:33:20+08:00 CNS202649516533 NetworkManager[1581]: <info>  [1789896800.4199] agent-manager: agent[9491d0bf9ccec28f,:1.136/org.gnome.Shell.NetworkAgent/1001]: agent registered
2026-09-20T17:33:20+08:00 CNS202649516533 gnome-shell[4195]: DING: Detected async api for thumbnails
2026-09-20T17:33:20+08:00 CNS202649516533 ubuntu-appindicators@ubuntu.com[4195]: Using Brute-force mode for StatusNotifierItem org.kde.StatusNotifierItem-21458-1
```

`gnome-shell` PID is **4195** both before and here (the earlier PID 2812 was the *login-screen* shell);
the `gkr-pam: unlocked login keyring` line is an **unlock**, and the DING relaunch is an extension
restart inside the same shell process. The `Can't update stage views actor … needs an allocation` storm
occurs **7650 times** across the whole session including at 11:12:51 startup — it is not unique to 17:33:

```
5588:2026-09-20T11:12:51+08:00 CNS202649516533 gnome-shell[4195]: Can't update stage views actor panelBox [StBoxLayout] is on because it needs an allocation.
5589:2026-09-20T11:12:51+08:00 CNS202649516533 gnome-shell[4195]: Can't update stage views actor panel [Gjs_ui_panel_Panel] is on because it needs an allocation.
```

### 4c. wtmp / btmp / lastlog

```
$ last -F -x | head -60
CNS20264 :1           :1               Tue Sep 22 10:02:18 2026   still logged in
CNS20264 seat0        login screen     Tue Sep 22 10:02:17 2026   still logged in
runlevel (to lvl 5)   6.14.0-27-generi Tue Sep 22 10:02:05 2026   still running
reboot   system boot  6.14.0-27-generi Tue Sep 22 10:01:55 2026   still running
shutdown system down  6.14.0-27-generi Mon Sep 21 19:04:33 2026 - Tue Sep 22 10:01:55 2026  (14:57)
CNS20264 :1           :1               Sun Sep 20 11:12:49 2026 - down                     (1+07:51)
CNS20264 seat0        login screen     Sun Sep 20 11:12:48 2026 - down                     (1+07:51)
runlevel (to lvl 5)   6.14.0-27-generi Sun Sep 20 11:10:51 2026 - Mon Sep 21 19:04:33 2026 (1+07:53)
reboot   system boot  6.14.0-27-generi Sun Sep 20 11:10:42 2026 - Mon Sep 21 19:04:33 2026 (1+07:53)
shutdown system down  6.14.0-27-generi Fri Sep 18 17:42:05 2026 - Sun Sep 20 11:10:42 2026 (1+17:28)
CNS20264 :1           :1               Sat Sep 12 14:55:06 2026 - down                     (6+02:46)
```

**There is exactly ONE `:1` and ONE `seat0` record for the whole 09-20 → 09-21 span: started
Sun Sep 20 11:12:49 / 11:12:48 and never closed until `down` (the 09-21 19:04:33 shutdown).**
A second X session would have produced a second `:1` entry — there is none.

```
$ last -F -x -f /var/log/btmp
last: 打不开 /var/log/btmp: 权限不够        (permission denied — btmp is root:utmp 0660)

$ lastlog
用户名 … (all accounts: **从未登录过** / never logged in; root: **从未登录过**)
```

`lastlog` is empty/zero-byte (`-rw-rw-r-- root utmp 0 2025-08-06 … lastlog`) and reports every account as
never logged in — so it carries **no** unlock/login information for 09-19…09-21. Unlock history is only in
the journal (`gkr-pam: unlocked login keyring`).

### 4d. Boot framing (why the earlier "NVIDIA-bound" era has no surviving Xorg log)

```
$ journalctl --list-boots --no-pager | tail -6
 -3 20e0dfcb80f449da8634f410fa7e3569 Wed 2026-08-12 10:58:37 CST Sat 2026-09-12 14:53:53 CST
 -2 d59100c8c10a40378f251a9cebb15267 Sat 2026-09-12 14:54:44 CST Fri 2026-09-18 17:42:05 CST
 -1 dbe2fd5614244921b1dac5a2246c633b Sun 2026-09-20 11:10:42 CST Mon 2026-09-21 19:04:34 CST
  0 993b7879fa064c6e97c9d3df3d19a157 Tue 2026-09-22 10:01:55 CST Tue 2026-09-22 11:09:45 CST
```

The machine was **powered off 2026-09-18 17:42:05 → 2026-09-20 11:10:42** (boot -1 begins 09-20 11:10:42).
Any X server that was driving the display over the NVIDIA GPU before that power-off belongs to boot -2
(09-12 → 09-18) and its user-session log was overwritten by boot -1's session on 09-20 11:12:48
(Xorg rotation keeps only `Xorg.1.log` + `Xorg.1.log.old`). **That is the file that rotated away.**

---

## 5. Monitor configuration history (monitors.xml / dconf)

### 5a. stat + content

```
$ stat /home/CNS2026495165/.config/monitors.xml
  文件：/home/CNS2026495165/.config/monitors.xml
  大小：553       	块：8          IO 块大小：4096   普通文件
设备：259,2	Inode: 30278588 	硬链接：1
权限：(0664/-rw-rw-r--)  Uid: ( 1001/CNS2026495165)   Gid: ( 1001/CNS2026495165)
访问时间：2026-09-22 10:02:19.064167291 +0800      <- atime: read at login of the current session
修改时间：2026-08-10 17:09:02.328522854 +0800      <- mtime
变更时间：2026-08-10 17:09:02.328522854 +0800      <- ctime
创建时间：2026-08-10 17:09:02.318527313 +0800
```

Full content (the file is small; printed verbatim):

```xml
<monitors version="2">
  <configuration>
    <logicalmonitor>
      <x>0</x>
      <y>0</y>
      <scale>1.5</scale>
      <primary>yes</primary>
      <monitor>
        <monitorspec>
          <connector>HDMI-0</connector>
          <vendor>GSM</vendor>
          <product>LG ULTRAFINE</product>
          <serial>606NTUWJK582</serial>
        </monitorspec>
        <mode>
          <width>3840</width>
          <height>2160</height>
          <rate>60.000</rate>
        </mode>
      </monitor>
    </logicalmonitor>
  </configuration>
</monitors>
```

### 5b. Backups / other monitor files

```
$ find /home/CNS2026495165/.config -maxdepth 2 -iname '*monitor*'
/home/CNS2026495165/.config/monitors.xml    mtime=2026-08-10 17:09:02.328522854  ctime=2026-08-10 17:09:02.328522854  size=553

$ find /home/CNS2026495165 -maxdepth 4 -name 'monitors.xml*'
(same single file)
```
**No `monitors.xml~`, no `.backup`, no `.config/monitors.xml.*`, no second copy anywhere under `$HOME`.**

### 5c. Required answers

**(a) Which connectors + modes does it configure?** Exactly one connector, `<connector>HDMI-0</connector>`,
one logical monitor at `x=0 y=0 scale=1.5 primary=yes`, mode `3840x2160 @ 60.000`, matched by monitor
identity `vendor=GSM product=LG ULTRAFINE serial=606NTUWJK582`.

**(b) Does it mention an NVIDIA or AMD connector name?** **NVIDIA.** `HDMI-0` is the **NVIDIA X driver's**
connector naming convention (`HDMI-0`, `DP-0`…); the AMD `amdgpu` DDX names its outputs `HDMI-A-1`,
`HDMI-A-2`, `DisplayPort-3`, `DisplayPort-4`. So `monitors.xml` still records the layout from when the
LG ULTRAFINE was physically attached to the **RTX 4090's HDMI port**. Note the monitor identity matches the
EDID that Xorg now reads on the AMD connector (GSM / `LG ULTRAFINE` / serial `606NTUWJK582`) — it is the
same physical monitor, now seen on `AMDGPU(0): Output HDMI-A-2`.

**(c) Is its mtime within ±24 h of 2026-09-20 17:18?** **No.** mtime = **2026-08-10 17:09:02.328 +0800**,
i.e. **~41 days (≈991 h) earlier**. Distance to 09-20 17:18: **+41 d 0 h 9 min**.

**(d) Is its mtime consistent with the 17:33:20 unlock / stage-relayout?** **No, and it is informative that
it isn't.** GNOME `gnome-settings-daemon`'s `xrandr` plugin only rewrites `monitors.xml` when the reported
RandR monitor topology/mode actually *changes*; the 17:33 unlock was a shell/keyring event with no display
reconfiguration, and the monitor's identity (LG ULTRAFINE, 3840x2160@60) and layout (`scale=1.5`, primary,
origin 0,0) were unchanged all day. So the stale `HDMI-0` string is simply never refreshed by an unlock.
**A `monitors.xml` write at 17:18 or 17:33:20 would have been direct evidence of a display-topology change
being detected by GNOME — and no such write exists.**

### 5d. dconf (read-only inspection)

```
$ ls -la --time-style=full-iso /home/CNS2026495165/.config/dconf/
总计 20
drwx------  2 CNS2026495165 CNS2026495165  4096 2026-09-22 10:03:46.629058478 +0800 .
drwx------ 37 CNS2026495165 CNS2026495165  4096 2026-09-22 10:50:35.821893593 +0800 ..
-rw-rw-r--  1 CNS2026495165 CNS2026495165 10935 2026-09-22 10:03:46.627273853 +0800 user

$ strings /home/CNS2026495165/.config/dconf/user | grep -inE 'monitor|scale|connector|HDMI|DP-|nvidia|card[0-9]|gpu|display'
(no output — zero matches)
$ strings /home/CNS2026495165/.config/dconf/user | wc -l
270
```

**No monitor/scale/connector/GPU keys exist in the dconf user database at all** (the classic
`org/gnome/desktop/interface/scaling-factor` or per-monitor keys are absent). The dconf `user` file mtime
(2026-09-22 10:03:46) falls in the *current* session's login window, not 09-20. `gsettings`/`dconf` write
commands were deliberately **not** run.

---

## 6. Physical / connector-switch evidence

### 6a. Journal (boot -1) greps for HD/GPU/hotplug keywords

Command: `grep -nE 'HDMI|hotplug|connector|card1|card2|nvidia|simpledrm|efifb|fb0' raw/xorg-20-journal-boot-1-0920-1100-2400.txt`

**All 139 `nvidia`/`amdgpu`/`[drm]` journal lines in the whole 09-20 11:00 → 09-21 00:00 window fall in
the 11:10–11:12 range:**

```
$ grep -E 'nvidia|amdgpu|NVRM|\[drm\]' raw/xorg-20-journal-boot-1-0920-1100-2400.txt | grep -oE '2026-09-20T[0-9]{2}' | sort | uniq -c
    139 2026-09-20T11
```

i.e. **not a single DRM/NVIDIA/amdgpu kernel message after 11:12 on 09-20** — no modeset, no hotplug,
no link retrain, no `Cannot find any crtc or sizes` re-check, no connector status change.

Boot-time connector/topology lines (verbatim, the only ones in the window):

```
2026-09-20T11:10:42+08:00 CNS202649516533 kernel: [drm] Initialized simpledrm 1.0.0 for simple-framebuffer.0 on minor 0
2026-09-20T11:10:42+08:00 CNS202649516533 kernel: simple-framebuffer simple-framebuffer.0: [drm] fb0: simpledrmdrmfb frame buffer device
2026-09-20T11:10:44+08:00 CNS202649516533 kernel: [drm] Seamless boot condition check passed
2026-09-20T11:10:44+08:00 CNS202649516533 kernel: [drm] Display Core v3.2.316 initialized on DCN 3.1.5
2026-09-20T11:10:44+08:00 CNS202649516533 kernel: [drm] DP-HDMI FRL PCON supported
2026-09-20T11:10:44+08:00 CNS202649516533 kernel: [drm] Initialized amdgpu 3.61.0 for 0000:73:00.0 on minor 2
2026-09-20T11:10:44+08:00 CNS202649516533 kernel: fbcon: amdgpudrmfb (fb0) is primary device
2026-09-20T11:10:44+08:00 CNS202649516533 kernel: amdgpu 0000:73:00.0: [drm] fb0: amdgpudrmfb frame buffer device
```

The only `hotplug`-bearing lines after 11:12 are **snapd udev events, not display events**:

```
2026-09-20T14:46:51+08:00 CNS202649516533 snapd[1527]: hotplug.go:206: hotplug device add event ignored, enable experimental.hotplug
2026-09-20T15:31:00+08:00 CNS202649516533 snapd[1527]: hotplug.go:206: hotplug device add event ignored, enable experimental.hotplug
2026-09-20T17:39:57+08:00 CNS202649516533 snapd[1527]: hotplug.go:206: hotplug device add event ignored, enable experimental.hotplug
2026-09-20T17:45:10+08:00 CNS202649516533 snapd[1527]: hotplug.go:206: hotplug device add event ignored, enable experimental.hotplug
```

(These line up with USB peripheral activity — and with sudo sessions by uid 1001 at 17:39:40 and
17:44:52 — **not** with any DRM connector event.)

### 6b. Xorg-side connector evidence

* In `Xorg.1.log.old`: `Output HDMI-A-2 connected` appears **exactly once** (line 435), at startup.
  There is no later `Output … connected/disconnected` line, no `RandR`/`Reconfigured`/`Adding output` /
  `Removing output` line (grep → zero matches), and no output/CRTC event after startup (see §2f).
* All NVIDIA `DFP-0`…`DFP-6` are `disconnected` at every enumeration (130.850, 131.029, 131.038, 131.345,
  131.686) — the RTX 4090 had **no** attached display during the whole 09-20 → 09-21 session.

### 6c. Current sysfs mapping (read-only)

```
$ for d in /sys/class/drm/*/; do n=$(basename $d); [ -f "$d/status" ] && printf "%-22s status=%-14s enabled=%-12s dpms=%s\n" "$n" "$(cat $d/status)" "$(cat $d/enabled)" "$(cat $d/dpms)"; done
card1-DP-1             status=disconnected   enabled=disabled     dpms=On
card1-DP-2             status=disconnected   enabled=disabled     dpms=On
card1-DP-3             status=disconnected   enabled=disabled     dpms=On
card1-HDMI-A-1         status=disconnected   enabled=disabled     dpms=On
card2-DP-4             status=disconnected   enabled=disabled     dpms=Off
card2-DP-5             status=disconnected   enabled=disabled     dpms=Off
card2-HDMI-A-2         status=disconnected   enabled=disabled     dpms=Off
card2-HDMI-A-3         status=connected      enabled=enabled      dpms=On
card2-Writeback-1      status=unknown        enabled=disabled     dpms=On

$ for c in /sys/class/drm/card*/device/driver; do echo "$c -> $(basename $(readlink -f $c))"; done
/sys/class/drm/card1/device/driver -> nvidia
/sys/class/drm/card2/device/driver -> amdgpu

$ ls -l /sys/class/drm/
card1        -> ../../devices/pci0000:00/0000:00:01.1/0000:01:00.0/drm/card1     (RTX 4090, nvidia)
card2        -> ../../devices/pci0000:00/0000:00:08.1/0000:73:00.0/drm/card2     (Raphael iGPU, amdgpu)
renderD128   -> …/0000:01:00.0/drm/renderD128   (nvidia)
renderD129   -> …/0000:73:00.0/drm/renderD129   (amdgpu)
```

So today: **card1 = NVIDIA RTX 4090 (no connector attached, `renderD128` only),
card2 = AMD Raphael iGPU (`renderD129` + the single active output `card2-HDMI-A-3`).**
`/dev/fb0` (=`/sys/class/graphics/fb0` → `…/0000:73:00.0/graphics/fb0`) is the **amdgpu** framebuffer;
it is `crw-rw---- root video`, which is exactly why the user X server logs `(EE) open /dev/fb0: Permission denied`.

Current NVIDIA state (consistent with the brief): `$ nvidia-smi -L` → `Failed to initialize NVML: Unknown Error`.
No `NVRM`/Xid error is in boot 0's kernel log beyond the module-signature taint line
`nvidia: module verification failed: signature and/or required key missing - tainting kernel`.

`gpu-manager` agrees the machine's boot VGA is the iGPU (09-22 boot, i.e. current state, not 09-20):

```
$ cat /var/log/gpu-manager.log
Is nvidia loaded? yes
Is nvidia unloaded? no
Is amdgpu loaded? yes
Vendor/Device Id: 1002:13c0
BusID "PCI:115@0:0:0"
Is boot vga? yes
Vendor/Device Id: 10de:2684
BusID "PCI:1@0:0:0"
Is boot vga? no
Found "/dev/dri/card2", driven by "amdgpu"
output 0:
	card2-HDMI-A-3
Number of connected outputs for /dev/dri/card2: 1
```

---

## 7. VERDICTS

### X1 — Was there an Xorg / X-session restart on 2026-09-20? → **FAIL (checked and absent)**

No X server was started, stopped or restarted on 2026-09-20 after the 11:12:48 user login.

Evidence:
* The user X server ran continuously: `/home/CNS2026495165/.local/share/xorg/Xorg.1.log.old`,
  line 17 `(==) Log file: "…/Xorg.1.log", Time: Sun Sep 20 11:12:48 2026` … line 1323
  `[114833.352] (II) Server terminated successfully (0). Closing log file.` (= 2026-09-21 19:04:30).
* Only two `gdm-x-session` PIDs in boot -1: 2432 (login screen, 11:10:45, log `/var/lib/gdm3/…/Xorg.0.log`)
  and 3931 (user session, 11:12:48). No third one anywhere up to 09-21 00:00.
* `journalctl -b -1 … --since "2026-09-20 11:00" --until "2026-09-21 00:00"`: exactly one
  `New session c1 of user gdm` (11:10:45) and **no `Removed session`, no second `session opened` for the
  user, no `seat0` re-creation, no gdm restarts**.
* `last -F -x`: exactly one `:1` record — `Sun Sep 20 11:12:49 2026 - down` — spanning until the
  09-21 19:04:33 shutdown. A restart would have created a second `:1` line.
* The 17:33:20 event was an unlock, not a restart: `gnome-shell[4195]` is the same PID used at 11:12:xx,
  `gdm-password][713452]: gkr-pam: unlocked login keyring`, DING relaunched inside that shell.

### X2 — Which GPU was the X server bound to before vs after 17:18, and did it change? → **PASS for "identical before and after"; the "change" itself is FAIL**

* Before 17:18 (session start 11:12:48): primary/probed-VGA device = **AMD Raphael iGPU**
  (`(--) PCI:*(115@0:0:0) 1002:13c0:1458:d000`, `AMDGPU(0): Chipset "AMD Ryzen 9 9950X…" (ChipID = 0x13c0)`,
  `AMDGPU(0): Output HDMI-A-2 connected … using initial mode 3840x2160 +0+0`), with the RTX 4090 bound as
  display-less `NVIDIA(G0)` (`MetaModes "NULL"`, `Virtual screen size … 640 x 480`, DFP-0…DFP-6 all
  `disconnected`).
* After 17:18 (session end 19:04:30): **exactly the same** — the last GPU-related action in the log is
  `1320:[114833.311] (II) NVIDIA(GPU-0): Deleting GPU-0`, part of normal teardown. **No line in the whole
  file records a rebinding, a second `Output … connected`, a driver reload, or an X restart.**
* Diff vs the newer log (`/home/CNS2026495165/.local/share/xorg/Xorg.1.log`, 2026-09-22 10:02:17):
  **no difference in GPU binding or connector assignment** — AMD primary + `NVIDIA(G0)` 640x480 NULL +
  `Output HDMI-A-2 connected` 3840x2160 in both.
* ⇒ **The X server did not change the GPU it was driving at any point covered by a surviving Xorg log.**
  The 17:18 Firefox "active GPU changed 4090 → Raphael" record therefore has **no X-server correlate**:
  it is not an Xorg binding change. (The X server was already on the Raphael iGPU.) Whatever Firefox
  observed at 17:18 was a client-side/renderer-level event (e.g. app process restart or render-device
  selection), not an X server GPU switch.
* Caveat for the *other* direction: a "NVIDIA → AMD" X switch **can be excluded for 09-20** (the display
  was on AMD from 11:12:48 onward, and Xorg logs nothing before that day's user session because the
  previous session's log rotated away). An earlier NVIDIA-bound era certainly existed — `monitors.xml`
  still names the NVIDIA-style connector `HDMI-0` (mtime 2026-08-10 17:09) — but its date cannot be
  established from Xorg logs on this machine (see UNAVAILABLE #2).

### X3 — Does an Xorg log actually span 2026-09-20 17:18? What is its path + mtime? → **PASS**

**`/home/CNS2026495165/.local/share/xorg/Xorg.1.log.old`**, size 100145 B, 1323 lines,
**mtime 2026-09-21 19:04:30.953833220 +0800**, ctime 2026-09-22 10:02:17.473167204 +0800,
birth 2026-09-20 11:12:48.964735790 +0800; internal coverage `[130.097]` (2026-09-20 11:12:48) →
`[114833.352]` (2026-09-21 19:04:30). It therefore **started ~6 h before and ended ~26 h after
2026-09-20 17:18**. It ended cleanly (`Server terminated successfully (0). Closing log file.`), concurrent
with the machine shutdown (`last` → `shutdown system down … Mon Sep 21 19:04:33 2026`).

Note: `/var/log/Xorg.*.log*` **does not exist on this machine**; the user session's Xorg log lives under
`~/.local/share/xorg/` and only two generations are kept (`Xorg.1.log`, `Xorg.1.log.old`).

### X4 — Does monitors.xml mtime fall near 17:18 or near 17:33:20? → **FAIL (neither)**

`/home/CNS2026495165/.config/monitors.xml` mtime = **2026-08-10 17:09:02.328522854 +0800**
(ctime identical; birth 2026-08-10 17:09:02.318527313). That is **~41 days (≈991 h) before 09-20 17:18**
and ~41 days before 17:33:20 — nowhere near either. It configures a single logical monitor on connector
**`HDMI-0`** (NVIDIA-style naming — the AMD X driver would report `HDMI-A-2`), 3840x2160@60, scale 1.5,
primary, for `GSM / LG ULTRAFINE / serial 606NTUWJK582`. **No backup or other `*monitors*` file exists**
under `~/.config/` (checked `monitors.xml~`, `monitors.xml.*`, `*backup*`, whole-home `find`).
Consistency with the unlock: the absence of a write is *consistent* with the unlock being a pure
keyring/shell event (GNOME only rewrites `monitors.xml` on an actual monitor-topology change, which did
not happen). **There is no monitors.xml evidence of any display-topology change around 09-20 17:18 or
17:33:20.** dconf holds **no** monitor/scale/connector keys at all (`strings …/dconf/user` → 0 matches).

### X5 — Is there any connector hotplug / monitor-topology change recorded? → **FAIL for 09-20 after boot; PASS for "the display was on the AMD HDMI output the whole time"**

* Journal, boot -1, 09-20 11:00 → 09-21 00:00: **all 139 `nvidia`/`amdgpu`/`[drm]` lines are in the
  11:10–11:12 boot window** (`uniq -c` → `139 2026-09-20T11`). **Zero DRM/NVIDIA/amdgpu kernel messages
  after 11:12 on 09-20.** No `Cannot find any crtc or sizes` re-probe, no link-train, no modeset, no
  connector-status change message.
* The only later `hotplug` strings are snapd udev noise at 14:46:51, 15:31:00, 17:39:57, 17:45:10
  (`snapd[1527]: hotplug.go:206: hotplug device add event ignored`) — USB, not DRM.
* Xorg side: `AMDGPU(0): Output HDMI-A-2 connected` occurs **once**, at startup; no `RandR`,
  `Reconfigured`, `Adding output`, `Removing output`, or CRTC/EDID re-enumeration ever occurs; the log has
  **no entries at all between `[ 10841.726]` (14:13) and `[114833.230]` (19:04)** — so nothing display-related
  happened at 17:18.
* All seven NVIDIA output devices (`DFP-0`…`DFP-6`) were `disconnected` at every probe, meaning the
  09-20 session never had a display on the RTX 4090.
* ⇒ **No physical/connector switch is recorded on 2026-09-20 at all.** The switch to the motherboard HDMI
  had already happened *before* the 09-20 11:12:48 X session began (the log's very first output
  enumeration shows `HDMI-A-2 connected` and all NVIDIA outputs disconnected). The only demonstrable
  topology *difference* the investigation found is **between 09-20 and 09-22**: today's connected output is
  `card2-HDMI-A-3` (sysfs), while on 09-20 Xorg reported `AMDGPU(0): Output HDMI-A-2 connected` — an
  amdgpu/kernel output-label or port-assignment difference across the 09-22 boot, not an event inside
  09-20 17:18.

---

## 8. UNAVAILABLE INFORMATION (and why)

1. **`/var/log/Xorg.*.log`, `/var/log/Xorg.*.log.old`, any rotated `.gz`** — **do not exist on this
   machine.** `ls -la /var/log/Xorg*` → `ls: 无法访问 '/var/log/Xorg*': 没有那个文件或目录`. A whole-
   filesystem search (`find / -xdev \( -name 'Xorg*.log*' -o -name 'xorg*.log*' \)`) returned only the two
   files under `/home/CNS2026495165/.local/share/xorg/`. (Not a permission issue — the path is absent.)
2. **The user-session Xorg log for the era when the monitor was driven by the RTX 4090 (boot -2,
   2026-09-12 → 2026-09-18)** — **rotated away and unrecoverable.** Rotation keeps only
   `Xorg.1.log` + `Xorg.1.log.old` in `~/.local/share/xorg/`; `Xorg.1.log.old` was overwritten at
   2026-09-20 11:12:48. No `.gz`/`.old.1`/backup variant exists. Consequence: the *date* on which the
   physical connector moved from the RTX 4090 to the motherboard HDMI output cannot be established from
   Xorg logs; it can only be bracketed as "before 2026-09-20 11:12:48" (given that day's log starts already
   on `HDMI-A-2`, and the machine was powered off during the 09-18 17:42 → 09-20 11:10 interval).
3. **`/var/lib/gdm3/.local/share/xorg/Xorg.0.log` (and `.old`) — permission denied.**
   `ls: 无法访问 '/var/lib/gdm3/.local/share/xorg/': 权限不够` (dir mode `drwx--x--x root gdm`), and
   `/var/log/gdm3/` → `ls: 无法打开目录 '/var/log/gdm3/': 权限不够`. No `sudo` available
   (`sudo -n true` → not permitted; approval prompts disabled). Consequence: the **login-screen** X
   server's own log file could not be read directly; its content was reconstructed only from the
   `gdm-x-session[2432]` journal lines, which cover 11:10:45 and 11:12:51 but are not exhaustive
   (journald rate-limiting/truncation of very chatty services cannot be excluded).
4. **`/var/log/auth.log` for 09-20 / `/var/log/btmp` — permission denied.** `auth.log` and `auth.log.1`
   are `-rw-r----- root:syslog`; reading them as uid 1001 was refused, and `last -F -x -f /var/log/btmp`
   → `打不开 /var/log/btmp: 权限不够`. Consequence: PAM-level detail (GDM authentication, unlock events as
   recorded by `auth.log`) could not be read from disk; only the journal's `gkr-pam: unlocked login keyring`
   line was available. `journalctl -b -1` requires membership of `systemd-journal`/`adm`; it *did* work
   here, so journal access is fine.
5. **`lastlog` carries no data for 09-19…09-21.** `/var/log/lastlog` is 0 bytes
   (`-rw-rw-r-- root utmp 0 2025-08-06 00:48:12`); every account prints `**从未登录过**` (never logged in).
   So unlock/login history had to come from wtmp (`last -F -x`) and the journal only.
6. **No `/var/log/lightdm/`** (`没有那个文件或目录`) — GDM3 is the display manager
   (`/etc/X11/default-display-manager` present; `gdm.service` started per journal).
7. **Current NVIDIA failure cause not determinable from logs.** `nvidia-smi -L` → `Failed to initialize
   NVML: Unknown Error`; boot 0's kernel log contains only
   `nvidia: module verification failed: signature and/or required key missing - tainting kernel` — no
   `NVRM`, Xid, or GPU-fallen-off message. Diagnosing this needs privileged reads not available here
   (`/proc/driver/nvidia/*` as root, `dmesg -w` live, module reload) — and would be state-changing.
8. **Live X server query (`xdpyinfo`/`xrandr -q`/`xvinfo`) deliberately NOT run** — the mandate is strictly
   read-only and forbids "any X-touching command". All present-state conclusions come from sysfs,
   `/proc`-free file reads, and the journal. Consequently `Xorg.1.log`'s live state (which connector the
   *current* X server bound at 10:02:17 today) was read from the log rather than queried live: it shows
   `AMDGPU(0): Output HDMI-A-2 connected`, which disagrees with today's sysfs `card2-HDMI-A-3`.
   **That HDMI-A-2 (Xorg, 09-20 and 09-22) vs HDMI-A-3 (sysfs, 09-22) discrepancy is unexplained by
   available evidence** — plausible explanations (amdgpu output-index ordering vs kernel connector label,
   or a different port physically used this boot) could not be discriminated without X-side or root-side
   data. It does **not** affect the GPU-binding conclusions (AMD vs NVIDIA), only the port letter.
9. **Peer-report overlap note (informational):** another investigator's raw files for the same incident
   already existed in `raw/` (`journal-0920-1600-1900.full.txt`, `boot-1-gpu-all.txt`,
   `pkg-03-journal-0920-1718.txt`, …). They were **not read** to avoid inheriting unverified conclusions;
   my `xorg-*.txt` files are independent. Cross-checking `boot-1-gpu-all.txt` is left to the aggregator.

---

## 9. EVIDENCE FILES PRODUCED

Raw excerpts (`…/gpu-switch-0920/raw/`):
* `xorg-01-stats.txt` — `ls`/`stat` of all Xorg log locations (incl. the denied `/var/log/gdm3/`).
* `xorg-05-key-excerpts.txt` — verbatim, line-numbered excerpts of the decisive sections of both logs
  (header, PCI/output classes, connector enumeration, NVIDIA(G0) section, teardown).
* `xorg-10-Xorg.1.log.old-filtered.txt` — 648-line filtered dump of `Xorg.1.log.old`
  (GPU/connector/EE/WW/mode lines).
* `xorg-20-journal-boot-1-0920-1100-2400.txt` — full journal for boot -1 over 2026-09-20 11:00 → 09-21 00:00
  (31006 lines, 4.6 MB).
* `xorg-21-journal-session-signals.txt` — filtered Xorg/gdm/session/seat signals from that window.
* `xorg-30-sessions-and-monitors.txt` — `last -F -x`, `lastlog`, `last reboot/shutdown`,
  `stat`+content of `monitors.xml`, dconf listing and `strings` grep.

Findings: this file — `…/gpu-switch-0920/evidence/xorg/FINDINGS-xorg.md`.

---

## 10. EXACT COMMANDS RUN (complete list)

```bash
# --- setup (workspace output dirs only) ---
mkdir -p /home/CNS2026495165/dsh/.workspace/lag-fix/incident2/gpu-switch-0920/evidence/xorg \
         /home/CNS2026495165/dsh/.workspace/lag-fix/incident2/gpu-switch-0920/raw

# --- 1. X server log inventory ---
ls -la --time-style=full-iso /var/log/Xorg*
ls -la --time-style=full-iso /var/log/gdm3/
ls -la --time-style=full-iso /var/log/lightdm/
ls -la --time-style=full-iso /home/CNS2026495165/.local/share/xorg/
stat /home/CNS2026495165/.local/share/xorg/Xorg.1.log /home/CNS2026495165/.local/share/xorg/Xorg.1.log.old
ls -la --time-style=full-iso /var/log/
ls -la --time-style=full-iso /var/lib/gdm3/.local/share/xorg/
find / -xdev \( -name 'Xorg*.log*' -o -name 'xorg*.log*' \) 2>/dev/null

# --- 2/3. internal coverage + extraction from the spanning log ---
head -5  /home/CNS2026495165/.local/share/xorg/Xorg.1.log.old
head -25 /home/CNS2026495165/.local/share/xorg/Xorg.1.log.old
tail -25 /home/CNS2026495165/.local/share/xorg/Xorg.1.log.old
head -20 /home/CNS2026495165/.local/share/xorg/Xorg.1.log
wc -l    /home/CNS2026495165/.local/share/xorg/Xorg.1.log.old
grep -nE '^\[ *[0-9]+\.[0-9]+\]' Xorg.1.log.old | head -3 ; … | tail -3
grep -nE 'X.Org X Server|Log file|Current Operating System|Kernel command line|xorg-server|X Protocol|Build Date|Build ID|ServerLayout|PCI:|PCI:\(|PCI:\*|OutputClass|NVIDIA|nvidia|amdgpu|AMDGPU|modesetting|Loading.*_drv\.so|Adding drm device|Platform probe|got fd for|\(EE\)|\(WW\)|\(!!\)|WARNING|ERROR|Server terminated|signal|Segmentation|Fatal|caught|dix_main|OsAbort|Output |connected|disconnected|CRTC|EDID|HDMI|DP-|Modeline|Virtual screen|RandR|Initializing output|using initial mode|Setting screen physical size|Transform|Panning|Tearing|PRIME|DRI|GBM|glamor|AIGLX|modeset|No devices detected|Screen .* added|screen\(s\)|Depth|Framebuffer|fb0|fbdev|EFI|simpledrm' Xorg.1.log.old
grep -nE 'NVIDIA\(|NVIDIA:|screen\(s\)|Screen 1|Screen 0|No devices detected|NVIDIA\(0\)|NVIDIA\(GPU-0\)|AllowEmptyInitialConfiguration|ConnectedMonitor|no display|Setting screen physical size|Virtual screen' Xorg.1.log.old
grep -nE 'AMDGPU\(0\): Output .*(connected|disconnected)|AMDGPU\(0\): Output .* using initial mode|AMDGPU\(0\): Output .* has no monitor|Virtual screen size|CRTC' Xorg.1.log.old
grep -nE '\(EE\)|\(WW\)|\(!!\)' Xorg.1.log.old
grep -nE 'connected|Output [A-Z]' Xorg.1.log.old
grep -nE 'RandR|Reconfigured|screen changed|Adding output|Removing output|RRScreen|new output|Screen .* changed' Xorg.1.log.old
awk 'NR>=427 && NR<=445 {printf "%d:%s\n", NR, $0}' Xorg.1.log.old          # output enumeration + initial mode
awk 'NR>=503 && NR<=560 {printf "%d:%s\n", NR, $0}' Xorg.1.log.old          # NVIDIA(G0) virtual screen
awk 'NR>=1300 && NR<=1323 {printf "%d:%s\n", NR, $0}' Xorg.1.log.old        # teardown / clean exit
grep -oE '^\[ *[0-9]+\.' Xorg.1.log.old | grep -oE '[0-9]+\.' | sort -n | uniq -c | tail -5
awk '/^\[ *[0-9]+\./ {t=$1; gsub(/[\[\.]/,"",t)} /config\/udev: Adding input device/ {if (t+0>20000) print NR": "$0}' Xorg.1.log.old
grep -nE 'PCI:|PCI:\(|OutputClass|NVIDIA dlloader|AMDGPU: Driver|Chipset|glamor X accel|Output .*(connected|disconnected)|using initial mode|Virtual screen size|Adding drm device|Platform probe|Setting screen physical size|Validated|Server terminated|\(EE\)' /home/CNS2026495165/.local/share/xorg/Xorg.1.log   # newer log diff

# --- 4. journal / login history ---
journalctl --list-boots --no-pager
journalctl -b -1 --no-pager -o short-iso | grep -iE 'xorg|gdm|gnome-session|systemd-logind|New session|Removed session|seat0'
journalctl -b -1 --no-pager -o short-iso --since "2026-09-20 11:00" --until "2026-09-21 00:00" > raw/xorg-20-journal-boot-1-0920-1100-2400.txt
grep -nE 'Xorg|gdm|gnome-session|systemd-logind|session opened|session closed|New session|Removed session|seat0|drm|modeset' raw/xorg-20-journal-boot-1-0920-1100-2400.txt
grep -E '2026-09-20T17:3[0-9]' raw/xorg-20-journal-boot-1-0920-1100-2400.txt | grep -v 'CRON\['
grep -nE 'gdm-x-session' raw/xorg-20-journal-boot-1-0920-1100-2400.txt
journalctl -b -1 --no-pager -o short-iso | grep -E 'gdm-x-session\[(3884|3931)\].*(Log file|Time:|X.Org X Server)'
journalctl -b 0  --no-pager -o short-iso | grep -E 'gdm-x-session.*(Time:|X.Org X Server|Log file)'
journalctl --no-pager -o short-iso | grep -iE 'xorg' | head -40
last -F -x | head -60
last -F -x reboot shutdown | head -20
last -F -x -f /var/log/btmp
lastlog
ls -la --time-style=full-iso /var/log/auth.log.1
grep -nE '^\S+ 11:1[0-2]' /var/log/auth.log.1

# --- 5. monitors.xml / dconf (read-only) ---
ls -la --time-style=full-iso /home/CNS2026495165/.config/ | grep -i monitor
find /home/CNS2026495165/.config -maxdepth 2 -iname '*monitor*' -exec stat --format='%n | %s | mtime=%y | ctime=%z' {} \;
find /home/CNS2026495165 -maxdepth 4 -name 'monitors.xml*' -exec stat --format='%n mtime=%y ctime=%z size=%s' {} \;
stat /home/CNS2026495165/.config/monitors.xml
cat /home/CNS2026495165/.config/monitors.xml
cat -A /home/CNS2026495165/.config/monitors.xml
ls -la --time-style=full-iso /home/CNS2026495165/.config/dconf/
strings /home/CNS2026495165/.config/dconf/user | grep -inE 'monitor|scale|connector|HDMI|DP-|nvidia|card[0-9]|gpu|display'
strings /home/CNS2026495165/.config/dconf/user | wc -l

# --- 6. physical / connector evidence ---
grep -nE 'HDMI|hotplug|connector|card1|card2|nvidia|simpledrm|efifb|fb0' raw/xorg-20-journal-boot-1-0920-1100-2400.txt
grep -E 'HDMI|hotplug|connector|card1|card2|nvidia|amdgpu|simpledrm|efifb|fb0' raw/xorg-20-journal-boot-1-0920-1100-2400.txt | grep -E '2026-09-20T(1[2-9]|2[0-3]):'
grep -E 'nvidia|amdgpu|NVRM|\[drm\]' raw/xorg-20-journal-boot-1-0920-1100-2400.txt | grep -oE '2026-09-20T[0-9]{2}' | sort | uniq -c
for d in /sys/class/drm/*/; do n=$(basename $d); [ -f "$d/status" ] && printf "%-22s status=%-14s enabled=%-12s dpms=%s\n" "$n" "$(cat $d/status)" "$(cat $d/enabled)" "$(cat $d/dpms)"; done
for c in /sys/class/drm/card*/device/driver; do echo "$c -> $(basename $(readlink -f $c))"; done
ls -l /sys/class/drm/ ; ls -la /dev/dri/
ls -la /dev/fb0 ; ls -l /sys/class/graphics/
cat /var/log/gpu-manager.log ; cat /var/log/gpu-manager-switch.log
head -3 /var/log/dmesg ; tail -3 /var/log/dmesg ; tail -3 /var/log/dmesg.0
ls -la /etc/X11/ ; ls -la /etc/X11/xorg.conf.d/ ; cat /etc/X11/xorg.conf.d/99-TWatermarkExt.conf
journalctl -b 0 -k --no-pager -o short-iso | grep -iE 'nvidia|NVRM' | grep -iE 'fail|error|xid|unable|unknown'
nvidia-smi -L
sudo -n true
java…  (none)
```

No file outside `/home/CNS2026495165/dsh/…/gpu-switch-0920/` was created or modified; nothing was
restarted, killed, rebooted, or reconfigured.
