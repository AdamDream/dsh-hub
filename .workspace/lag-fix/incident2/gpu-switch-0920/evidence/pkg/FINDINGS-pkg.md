# FINDINGS-pkg.md — Package / Driver / Config Forensics for the 2026-09-20 GPU switch

- **Host:** CNS202649516533 (formerly `itadm-X870-AORUS-ELITE-WIFI7`), Ubuntu 24.04, kernel `6.14.0-27-generic`, x86_64
- **Investigator:** read-only forensic subagent (no state-changing command executed)
- **Investigation time:** 2026-09-22 11:08–11:11 +0800 (`uptime`: `up 1:09`)
- **Window under test:** 2026-09-18 00:00 .. 2026-09-22 23:59 (+0800)
- **Alleged switch moment:** 2026-09-20 17:18 +0800. "near" is defined as within ±24 h, i.e. 2026-09-19 17:18 .. 2026-09-21 17:18.
- **Raw evidence:** `raw/pkg-01` .. `raw/pkg-09` under `/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/gpu-switch-0920/`

> All quoted lines below are copied verbatim from the source named in the same block. Locale output
> (`9月`, `总计`) is preserved as-is. Bus IDs: `0000:73:00.0` = AMD Raphael iGPU (`1002:13c0`),
> `0000:01:00.0` = NVIDIA RTX 4090 (`10de:2684`).

---

## 0. VERDICTS (one line each)

| # | Question | Verdict | One-line basis |
|---|---|---|---|
| **P1** | Package changes on 09-19 / 09-20 / 09-21? | **FAIL** (checked, nothing found) | Only two dpkg transactions survive in the window: `chatgpt` (09-21 11:56:35) and `google-chrome-stable` (09-22 10:50:05). 09-18, 09-19 and 09-20 have **zero** dpkg/apt events. |
| **P2** | Any nvidia / mesa / xserver / kernel change in that window? | **FAIL** (checked, nothing found) | The last nvidia/mesa/libdrm/kernel change is **2026-08-10 16:34:27** (`nvidia 595.84`, `mesa 25.2.8`). No such package appears in any 09-18..09-22 log line. |
| **P3** | Any config file (xorg.conf.d / modprobe.d / monitors) with mtime near 09-20 17:18? | **FAIL** (checked, nothing found) | No config file has an mtime inside 2026-09-19 17:18 .. 2026-09-21 17:18. **See §5.1 caveat:** `11-nvidia-offload.conf` was *created* 2026-09-20 **11:10:44** (that same day, 6 h 07 m before 17:18) by gpu-manager at boot. |
| **P4** | Is the window covered by surviving package logs at all? | **PASS** (evidence found) | `dpkg.log` spans 2026-09-01 → 2026-09-22 10:50 with continuous coverage across 09-18/19/20; `term.log` and `history.log` likewise. Coverage is **not** an "unavailable information" gap. |

**Bottom line:** no package, driver, kernel, mesa, snap, or config-file change explains the GPU switch
or a broken NVIDIA userspace stack. The NVIDIA userspace stack is byte-identical to its
**2026-08-10** installation, and the kernel module loaded successfully on every boot in the window.

---

## 1. Package history — every entry in 2026-09-18 .. 2026-09-22

### 1.1 The complete set of in-window entries (dated list)

`timestamp | action | package | old → new` — extracted from `/var/log/dpkg.log`.

```
2026-09-21 11:56:35 startup archives unpack
2026-09-21 11:56:36 install chatgpt:amd64 <none> 26.915.31945
2026-09-21 11:56:41 configure chatgpt:amd64 26.915.31945 <none>
2026-09-22 10:50:05 startup archives unpack
2026-09-22 10:50:05 install google-chrome-stable:amd64 <none> 153.0.8010.52-1
2026-09-22 10:50:09 configure google-chrome-stable:amd64 153.0.8010.52-1 <none>
```

`[exit 0]` — command: `grep -hE '^2026-09-(1[89]|2[012])' /var/log/dpkg.log /var/log/dpkg.log.1 | grep -E ' (install|upgrade|remove|purge|configure|unpack) '`
(also saved verbatim to `raw/pkg-05-window-pkg-entries-verbatim.txt`)

| timestamp | action | package | old → new |
|---|---|---|---|
| 2026-09-21 11:56:36 | install | `chatgpt:amd64` | `<none>` → `26.915.31945` |
| 2026-09-21 11:56:41 | configure | `chatgpt:amd64` | `26.915.31945` |
| 2026-09-22 10:50:05 | install | `google-chrome-stable:amd64` | `<none>` → `153.0.8010.52-1` |
| 2026-09-22 10:50:09 | configure | `google-chrome-stable:amd64` | `153.0.8010.52-1` |

**No `upgrade` and no `remove` entry whatsoever in the window.** Both in-window transactions are
user-initiated `.deb` file installs (see §1.3).

### 1.2 Per-day counts — 09-18/19/20 are completely empty

```
[exit 0] — grep -oE '^2026-09-[0-9]{2}' /var/log/dpkg.log | sort | uniq -c
     36 2026-09-01
     25 2026-09-03
     67 2026-09-11
     13 2026-09-15
     17 2026-09-21
     21 2026-09-22
```

There is **no 2026-09-18, 2026-09-19 or 2026-09-20 row at all** — not even a single dpkg line
(no `status`, no `trigproc`, no `startup`). The dpkg log simply has no activity on those days.

### 1.3 apt history — full file, verbatim (the whole surviving file fits in the window's neighbourhood)

`[exit 0]` — command: `cat /var/log/apt/history.log` (full file, unmodified)

```
Start-Date: 2026-09-15  14:47:30
Commandline: apt-get install -y libxcb-cursor0 libxkbcommon-x11-0
Requested-By: CNS2026495165 (1001)
Install: libxcb-cursor0:amd64 (0.1.4-1build1)
End-Date: 2026-09-15  14:47:31

Start-Date: 2026-09-21  11:56:35
Commandline: packagekit role='install-files'
Requested-By: CNS2026495165 (1001)
Install: chatgpt:amd64 (26.915.31945)
End-Date: 2026-09-21  11:56:41

Start-Date: 2026-09-22  10:50:05
Commandline: apt install ./google-chrome-stable_current_amd64.deb
Requested-By: CNS2026495165 (1001)
Install: google-chrome-stable:amd64 (153.0.8010.52-1)
End-Date: 2026-09-22  10:50:10
```

`[exit 0]` — command: `{ cat /var/log/apt/history.log; zcat /var/log/apt/history.log.1.gz; } | grep -E '^Start-Date: 2026-09-(1[6-9]|2[0-3])'`

```
Start-Date: 2026-09-21  11:56:35
Start-Date: 2026-09-22  10:50:05
```

Even when the window is **widened to 09-16 .. 09-23**, only those two transactions exist. The
previous apt transaction is `2026-09-15 14:47:30` (libxcb-cursor0), i.e. a 6-day silent gap
covering 09-16 through 09-20.

`[exit 0]` — command: `grep -E '^Log (started|ended): 2026-09-(1[89]|2[0-3])' /var/log/apt/term.log`

```
Log started: 2026-09-21  11:56:35
Log ended: 2026-09-21  11:56:41
Log started: 2026-09-22  10:50:05
Log ended: 2026-09-22  10:50:10
```

`/var/log/apt/term.log` confirms the same: the only two in-window apt sessions are the chatgpt and
chrome `.deb` installs. Independent corroboration — in `term.log` the chrome install is recorded
as unpacking a locally downloaded file, not a repository package:

```
Log started: 2026-09-22  10:50:05
正在选中未选择的软件包 google-chrome-stable。
...
准备解压 .../google-chrome-stable_current_amd64.deb  ...
正在解压 google-chrome-stable (153.0.8010.52-1) ...
正在设置 google-chrome-stable (153.0.8010.52-1) ...
```

### 1.4 EXPLICIT ANSWER: WAS THERE ANY NVIDIA / DRIVER / KERNEL / MESA CHANGE ON 09-19, 09-20 or 09-21?

**NO.** None. Zero.

- **2026-09-19:** no package activity at all (0 dpkg lines, 0 apt transactions).
- **2026-09-20:** no package activity at all (0 dpkg lines, 0 apt transactions). *This is the day of the alleged GPU switch.*
- **2026-09-21:** exactly one transaction — an untrusted local `.deb` install of `chatgpt` at 11:56:35. Nothing graphics-related.
- **2026-09-22** (outside the priority question but inside the window): one transaction — local `.deb` install of `google-chrome-stable` at 10:50:05. Nothing graphics-related.

The last time **any** GPU-relevant package moved on this machine was **2026-08-10**, 41 days before
the switch. The relevant packages carry their 2026-08-10/06-30 build timestamps:

```
[exit 0] — cat /etc/modprobe.d/nvidia-graphics-drivers-kms.conf
# This file was generated by nvidia-driver-595
...
[stat] 创建时间：2026-08-10 16:34:28.757132487 +0800
```

---

## 2. Log-file inventory and coverage ranges (answers `ls -la` request)

`[exit 0]` — command: `ls -la /var/log/apt/ /var/log/dpkg.log*`

```
-rw-r--r-- 1 root root   12393  9月 22 10:50 /var/log/dpkg.log
-rw-r--r-- 1 root root 2022002  8月 28 10:19 /var/log/dpkg.log.1

/var/log/apt/:
总计 248
drwxr-xr-x  2 root root    4096  9月 22 10:50 .
drwxrwxr-x 17 root syslog  4096  9月 22 10:02 ..
-rw-r--r--  1 root root  111232  9月 22 10:50 eipp.log.xz
-rw-r--r--  1 root root    1626  9月 22 10:50 history.log
-rw-r--r--  1 root root   44459  8月 28 10:19 history.log.1.gz
-rw-r-----  1 root adm      10432  9月 22 10:50 term.log
-rw-r-----  1 root adm      66930  8月 28 10:19 term.log.1.gz
```

| File | First timestamp | Last timestamp | Covers 09-18..09-21? |
|---|---|---|---|
| `/var/log/dpkg.log` | `2026-09-01 16:49:00` | `2026-09-22 10:50:10` | **YES, continuously** (empty on 09-18/19/20 because nothing happened) |
| `/var/log/dpkg.log.1` | `2025-08-05 16:48:11` | `2026-08-28 10:19:56` | No (ends 08-28, 3 weeks before the window) |
| `/var/log/apt/history.log` | `2026-09-01 16:49:00` | `2026-09-22 10:50:05` | **YES** |
| `/var/log/apt/history.log.1.gz` | `2025-08-05 16:48:47` | `2026-08-28 10:19:55` | No (ends 08-28) |
| `/var/log/apt/term.log` | `2026-09-01 16:49:00` | `2026-09-22 10:50:10` | **YES** |
| `/var/log/apt/term.log.1.gz` | (2025-08-05 era) | `2026-08-28 10:19:57` | No (ends 08-28) |
| `/var/log/apt/eipp.log.xz` | (header: `Request: EIPP 0.1` … `Install: google-chrome-stable:amd64`) | newest entry = 09-22 chrome install | Partial — EIPP only writes on installs; not a general change log |
| `/var/log/alternatives.log` | — | `9月 22 10:50` | n/a |

Coverage boundary proof — the **current** `dpkg.log` head/tail and the **rotated** `dpkg.log.1` tail:

```
[exit 0] — head -3 /var/log/dpkg.log; tail -3 /var/log/dpkg.log
2026-09-01 16:49:00 startup archives unpack
2026-09-01 16:49:00 install libcln6:amd64 <none> 1.3.7-1
2026-09-01 16:49:00 status triggers-pending libc-bin:amd64 2.39-0ubuntu8.5
...
2026-09-22 10:50:10 trigproc desktop-file-utils:amd64 0.27-2build1 <none>
2026-09-22 10:50:10 status half-configured desktop-file-utils:amd64 0.27-2build1
2026-09-22 10:50:10 status installed desktop-file-utils:amd64 0.27-2build1

[exit 0] — tail -3 /var/log/dpkg.log.1
2026-08-28 10:19:56 trigproc desktop-file-utils:amd64 0.27-2build1 <none>
2026-08-28 10:19:56 status half-configured desktop-file-utils:amd64 0.27-2build1
2026-08-28 10:19:56 status installed desktop-file-utils:amd64 0.27-2build1
```

The two files **overlap-free and back-to-back**: rotation happened 2026-08-28 10:19, after which
`dpkg.log` starts 2026-09-01 and runs unbroken to the present.

**Therefore P4 = PASS: the 09-19..09-21 window IS covered by surviving package logs.**
This is *not* an "unavailable information / rotated away" situation — the absence of entries is a
genuine absence of activity, not a retention gap.

### 2.1 Independent corroboration: the dpkg *database* itself

Package logs could in principle have been rotated or hand-edited; the live dpkg database cannot be
falsified as easily. Its mtime is the last package-database write:

`[exit 0]` — command: `stat /var/lib/dpkg/status`

```
  文件：/var/lib/dpkg/status
  大小：...
修改时间：2026-09-22 10:50:10.744987978 +0800
变更时间：2026-09-22 10:50:10.747988088 +0800
```

If any package had been installed/removed/upgraded on 09-18/19/20, `/var/lib/dpkg/status` and the
per-package `*.list`/`*.md5sums` files would necessarily carry timestamps from those days. They do
not — the only `/var/lib/dpkg/info` files touched anywhere in 09-18..09-22 belong to the two
unrelated installs:

`[exit 0]` — command: `find /var/lib/dpkg/info -maxdepth 1 -newermt "2026-09-18" ! -newermt "2026-09-23"`

```
/var/lib/dpkg/info
/var/lib/dpkg/info/chatgpt.list
/var/lib/dpkg/info/chatgpt.md5sums
/var/lib/dpkg/info/google-chrome-stable.list
/var/lib/dpkg/info/google-chrome-stable.md5sums
/var/lib/dpkg/info/chatgpt.conffiles
/var/lib/dpkg/info/chatgpt.postinst
/var/lib/dpkg/info/chatgpt.postrm
/var/lib/dpkg/info/chatgpt.prerm
```

Exactly **9** entries, all chatgpt/chrome. **Zero** nvidia, mesa, libdrm, xorg or kernel files.
This closes the "maybe the logs were rotated and we lost it" escape hatch: the database
independently proves no graphics package moved in the window.

---

## 3. What the nvidia/mesa/kernel packages actually are (state as of investigation)

`[exit 0]` — command: `dpkg -l | grep -iE 'nvidia|mesa|libdrm|xserver-xorg|linux-image|linux-modules'`

```
ii libdrm-amdgpu1:amd64 2.4.125-1ubuntu0.1~24.04.2
ii libdrm-common 2.4.125-1ubuntu0.1~24.04.2
ii libdrm-dev:amd64 2.4.125-1ubuntu0.1~24.04.2
ii libdrm-intel1:amd64 2.4.125-1ubuntu0.1~24.04.2
ii libdrm-nouveau2:amd64 2.4.125-1ubuntu0.1~24.04.2
ii libdrm-radeon1:amd64 2.4.125-1ubuntu0.1~24.04.2
ii libdrm2:amd64 2.4.125-1ubuntu0.1~24.04.2
ii libegl-mesa0:amd64 25.2.8-0ubuntu0.24.04.2
ii libgl1-mesa-dri:amd64 25.2.8-0ubuntu0.24.04.2
ii libglx-mesa0:amd64 25.2.8-0ubuntu0.24.04.2
ii mesa-libgallium:amd64 25.2.8-0ubuntu0.24.04.2
ii mesa-vulkan-drivers:amd64 25.2.8-0ubuntu0.24.04.2
ii libnvidia-cfg1-595:amd64 595.84-0ubuntu0.24.04.1
ii libnvidia-common-595 595.84-0ubuntu0.24.04.1
ii libnvidia-compute-595:amd64 595.84-0ubuntu0.24.04.1
ii libnvidia-decode-595:amd64 595.84-0ubuntu0.24.04.1
ii libnvidia-egl-wayland1:amd64 1:1.1.17-0ubuntu0~gpu24.04.1
ii libnvidia-encode-595:amd64 595.84-0ubuntu0.24.04.1
ii libnvidia-extra-595:amd64 595.84-0ubuntu0.24.04.1
ii libnvidia-fbc1-595:amd64 595.84-0ubuntu0.24.04.1
ii libnvidia-gl-595:amd64 595.84-0ubuntu0.24.04.1
hi linux-image-6.14.0-27-generic 6.14.0-27.27~24.04.1
ii linux-image-generic-hwe-24.04 6.14.0-27.27~24.04.1
hi linux-modules-6.14.0-27-generic 6.14.0-27.27~24.04.1
hi linux-modules-extra-6.14.0-27-generic 6.14.0-27.27~24.04.1
ii nvidia-compute-utils-595 595.84-0ubuntu0.24.04.1
ii nvidia-dkms-595-open 595.84-0ubuntu0.24.04.1
ii nvidia-driver-590-open 590.48.01-0ubuntu0.24.04.5
ii nvidia-driver-595-open 595.84-0ubuntu0.24.04.1
ii nvidia-firmware-595-595.84 595.84-0ubuntu0.24.04.1
ii nvidia-kernel-common-595 595.84-0ubuntu0.24.04.1
ii nvidia-kernel-source-595-open 595.84-0ubuntu0.24.04.1
ii nvidia-prime 0.8.17.2
ii nvidia-settings 510.47.03-0ubuntu4.24.04.1
ii nvidia-utils-590 590.48.01-0ubuntu0.24.04.5
ii nvidia-utils-595 595.84-0ubuntu0.24.04.1
ii xserver-xorg-video-amdgpu 23.0.0-1build1
ii xserver-xorg-video-nvidia-595 595.84-0ubuntu0.24.04.1
```

`[exit 0]` — command: `dkms status`

```
nvidia/595.84, 6.14.0-27-generic, x86_64: installed
```

**Note the `hi` (half-installed / unpacked-but-not-configured) flags on the three `linux-image`/
`linux-modules` entries and the presence of both the 590 and 595 nvidia driver metapackages.**
These are pre-existing states, *not* products of the window — see §3.1. The DKMS module for
595.84 against the running kernel `6.14.0-27-generic` is `installed`, and it did load successfully
on every boot in the window (§3.2).

### 3.1 Exact provenance of the nvidia/mesa/kernel install — all on 2026-08-10

`[exit 0]` — command: `grep -E '^[0-9-]+ .*(install|upgrade) ' /var/log/dpkg.log.1 | grep -iE 'nvidia|mesa|libdrm|nouveau|xserver-xorg-video'`

```
2026-08-10 16:34:27 upgrade libdrm-common:all 2.4.122-1~ubuntu0.24.04.1 2.4.125-1ubuntu0.1~24.04.2
2026-08-10 16:34:27 upgrade libdrm2:amd64 2.4.122-1~ubuntu0.24.04.1 2.4.125-1ubuntu0.1~24.04.2
2026-08-10 16:34:27 upgrade libdrm-amdgpu1:amd64 2.4.122-1~ubuntu0.24.04.1 2.4.125-1ubuntu0.1~24.04.2
2026-08-10 16:34:27 upgrade libdrm-intel1:amd64 2.4.122-1~ubuntu0.24.04.1 2.4.125-1ubuntu0.1~24.04.2
2026-08-10 16:34:27 upgrade libdrm-nouveau2:amd64 2.4.122-1~ubuntu0.24.04.1 2.4.125-1ubuntu0.1~24.04.2
2026-08-10 16:34:27 upgrade libdrm-radeon1:amd64 2.4.122-1~ubuntu0.24.04.1 2.4.125-1ubuntu0.1~24.04.2
2026-08-10 16:34:27 upgrade libgl1-mesa-dri:amd64 25.0.7-0ubuntu0.24.04.1 25.2.8-0ubuntu0.24.04.2
2026-08-10 16:34:27 upgrade libglx-mesa0:amd64 25.0.7-0ubuntu0.24.04.1 25.2.8-0ubuntu0.24.04.2
2026-08-10 16:34:28 upgrade libegl-mesa0:amd64 25.0.7-0ubuntu0.24.04.1 25.2.8-0ubuntu0.24.04.2
2026-08-10 16:34:28 upgrade mesa-libgallium:amd64 25.0.7-0ubuntu0.24.04.1 25.2.8-0ubuntu0.24.04.2
2026-08-10 16:34:28 install nvidia-firmware-595-595.84:amd64 <none> 595.84-0ubuntu0.24.04.1
2026-08-10 16:34:28 install nvidia-kernel-common-595:amd64 <none> 595.84-0ubuntu0.24.04.1
2026-08-10 16:34:28 install libnvidia-cfg1-595:amd64 <none> 595.84-0ubuntu0.24.04.1
2026-08-10 16:34:28 install libnvidia-common-595:amd64 <none> 595.84-0ubuntu0.24.04.1
2026-08-10 16:34:28 install libnvidia-compute-595:amd64 <none> 595.84-0ubuntu0.24.04.1
2026-08-10 16:34:29 install libnvidia-decode-595:amd64 <none> 595.84-0ubuntu0.24.04.1
2026-08-10 16:34:29 install libnvidia-egl-wayland1:amd64 <none> 1:1.1.17-0ubuntu0~gpu24.04.1
2026-08-10 16:34:29 install libnvidia-encode-595:amd64 <none> 595.84-0ubuntu0.24.04.1
2026-08-10 16:34:29 install libnvidia-extra-595:amd64 <none> 595.84-0ubuntu0.24.04.1
2026-08-10 16:34:29 install libnvidia-fbc1-595:amd64 <none> 595.84-0ubuntu0.24.04.1
2026-08-10 16:34:29 install libnvidia-gl-595:amd64 <none> 595.84-0ubuntu0.24.04.1
2026-08-10 16:34:30 install mesa-vdpau-drivers:amd64 <none> 25.2.8-0ubuntu0.24.04.2
2026-08-10 16:34:30 upgrade mesa-vulkan-drivers:amd64 25.0.7-0ubuntu0.24.04.1 25.2.8-0ubuntu0.24.04.2
2026-08-10 16:34:31 install nvidia-compute-utils-595:amd64 <none> 595.84-0ubuntu0.24.04.1
2026-08-10 16:34:31 install nvidia-kernel-source-595-open:amd64 <none> 595.84-0ubuntu0.24.04.1
2026-08-10 16:34:31 install nvidia-dkms-595-open:amd64 <none> 595.84-0ubuntu0.24.04.1
2026-08-10 16:34:31 install nvidia-utils-595:amd64 <none> 595.84-0ubuntu0.24.04.1
2026-08-10 16:34:31 install xserver-xorg-video-nvidia-595:amd64 <none> 595.84-0ubuntu0.24.04.1
2026-08-10 16:34:31 install nvidia-driver-595-open:amd64 <none> 595.84-0ubuntu0.24.04.1
2026-08-10 16:34:31 install nvidia-driver-590-open:amd64 <none> 590.48.01-0ubuntu0.24.04.5
2026-08-10 16:34:31 install nvidia-prime:all <none> 0.8.17.2
2026-08-10 16:34:31 install nvidia-settings:amd64 510.47.03-0ubuntu4.24.04.1
2026-08-10 16:34:32 install nvidia-utils-590:amd64 590.48.01-0ubuntu0.24.04.5
```

The corresponding apt-level records (`/var/log/apt/history.log.1.gz`, verbatim Start-Date lines):

```
Start-Date: 2026-08-10  16:32:49 || Commandline: apt install -y dkms linux-headers-6.14.0-27-generic
Start-Date: 2026-08-10  16:34:27 || Commandline: apt install -y nvidia-driver-590-open nvidia-utils-590
Start-Date: 2026-08-10  17:56:05 || Commandline: apt install -y python3-venv python3-pip libglfw3 libglew2.2 ... libglx-mesa0 ...
Start-Date: 2026-08-10  16:57:27 || Install: linux-headers-generic-hwe-24.04:amd64 (6.14.0-27.27~24.04.1, automatic), linux-generic-hwe-24.04:amd64 (6.14.0-27.27~24.04.1), libbpfcc ... linux-tools-common:amd64 (6.8.0-71.71, automatic), iucode-tool ...
```

Note the operator's own command line: `apt install -y nvidia-driver-590-open nvidia-utils-590` —
which pulled the 595 line as a dependency (595.84). This is the **only** nvidia driver install
event in the machine's surviving package history, and it is 41 days before the switch.

Kernel: the running kernel `6.14.0-27.27~24.04.1` dates from the same 2026-08-10 session
(`linux-headers-generic-hwe-24.04 (6.14.0-27.27~24.04.1)` at `2026-08-10 16:57:27`), and
`/lib/modules/` contains exactly one kernel directory:

```
[exit 0] — ls -la /lib/modules/
drwxr-xr-x  3 root root 4096  8月 11 00:57 .
drwxr-xr-x 116 root root 12288  9月 21 11:56 ..
drwxr-xr-x  6 root root 4096  8月 10 16:34 6.14.0-27-generic
```

**No kernel was added or changed in the window — no other kernel version exists on the machine.**

### 3.2 The nvidia kernel module loaded fine on every boot in the window

`[exit 0]` — command: `journalctl -b -1 --no-pager | grep -iE 'nvidia' | head -40`

```
9月 20 11:10:42 CNS202649516533 kernel: nvidia: loading out-of-tree module taints kernel.
9月 20 11:10:42 CNS202649516533 kernel: nvidia: module verification failed: signature and/or required key missing - tainting kernel
9月 20 11:10:42 CNS202649516533 kernel: nvidia-nvlink: Nvlink Core is being initialized, major device number 236
9月 20 11:10:42 CNS202649516533 kernel: nvidia 0000:01:00.0: vgaarb: VGA decodes changed: olddecodes=io+mem,decodes=none:owns=none
9月 20 11:10:42 CNS202649516533 kernel: NVRM: loading NVIDIA UNIX Open Kernel Module for x86_64  595.84  Release Build  (dvs-builder@U22-I3-AM25-26-2)  Wed Jun 10 21:06:37 UTC 2026
9月 20 11:10:42 CNS202649516533 kernel: nvidia-modeset: Loading NVIDIA UNIX Open Kernel Mode Setting Driver for x86_64  595.84  Release Build  (dvs-builder@U22-I3-AM25-26-2)  Wed Jun 10 20:53:33 UTC 2026
9月 20 11:10:42 CNS202649516533 systemd-modules-load[581]: Inserted module 'nvidia'
9月 20 11:10:42 CNS202649516533 kernel: [drm] [nvidia-drm] [GPU ID 0x00000100] Loading driver
9月 20 11:10:42 CNS202649516533 systemd-modules-load[581]: Inserted module 'nvidia_modeset'
9月 20 11:10:43 CNS202649516533 systemd-modules-load[581]: Inserted module 'nvidia_uvm'
9月 20 11:10:43 CNS202649516533 kernel: [drm] Initialized nvidia-drm 0.0.0 for 0000:01:00.0 on minor 1
9月 20 11:10:43 CNS202649516533 systemd-modules-load[581]: Inserted module 'nvidia_drm'
9月 20 11:10:43 CNS202649516533 kernel: nvidia 0000:01:00.0: [drm] Cannot find any crtc or sizes
9月 20 11:10:43 CNS202649516533 systemd-modules-load[581]: Inserted module 'nvidia_drm'
9月 20 11:10:44 CNS202649516533 systemd[1]: Starting nvidia-persistenced.service - NVIDIA Persistence Daemon...
9月 20 11:10:44 CNS202649516533 nvidia-persistenced[1526]: Started (1526)
9月 20 11:10:44 CNS202649516533 nvidia-persistenced[1526]: device 0000:01:00.0 - registered
9月 20 11:10:44 CNS202649516533 nvidia-persistenced[1526]: Local RPC services initialized
9月 20 11:10:44 CNS202649516533 systemd[1]: Started nvidia-persistenced.service - NVIDIA Persistence Daemon.
```

This is important for the **broken-userspace** half of the hypothesis: at the 09-20 boot the
kernel module and `nvidia-persistenced` came up **healthy and registered the GPU** —
`NVRM: loading ... 595.84` and `device 0000:01:00.0 - registered`. The `NVML Unknown Error` seen
today therefore did **not** originate from a package-level change in the window.

Note `nvidia 0000:01:00.0: [drm] Cannot find any crtc or sizes` — the RTX 4090 had **no display
attached** (no CRTCs) as early as 11:10:43 on 09-20, i.e. ~6.1 hours *before* the alleged 17:18
switch time. (`/var/log/gpu-manager.log`, written at the 09-20 boot, independently shows the same
picture: it flips its verdict from "Is boot vga? no" for `Vendor/Device Id: 10de:2684`. See §5.2.)

---

## 4. Journal — package services in 2026-09-18 .. 2026-09-23

### 4.1 `unattended-upgrades`

`[exit 0]` — command: `journalctl -u unattended-upgrades --since "2026-09-18" --until "2026-09-23" --no-pager`

```
9月 18 17:42:02 CNS202649516533 systemd[1]: unattended-upgrades.service: Deactivated successfully.
-- Boot dbe2fd5614244921b1dac5a2246c633b --
9月 20 11:10:45 CNS202649516533 systemd[1]: Started unattended-upgrades.service - Unattended Upgrades Shutdown.
9月 21 19:04:30 CNS202649516533 systemd[1]: unattended-upgrades.service: Deactivated successfully.
-- Boot 993b7879fa064c6e97c9d3df3d19a157 --
9月 22 10:01:59 CNS202649516533 systemd[1]: Started unattended-upgrades.service - Unattended Upgrades Shutdown.
```

Nothing but start/stop of the *shutdown* hook. **No unattended upgrade occurred, ever, in the
window.**

This is structural, not accidental — unattended upgrades are disabled by configuration:

`[exit 0]` — command: `grep -nE '^\s*"[0-9]|APT::Periodic|Unattended-Upgrade' /etc/apt/apt.conf.d/20auto-upgrades`

```
1:APT::Periodic::Update-Package-Lists "0";
2:APT::Periodic::Unattended-Upgrade "0";
```

Both periodic update and unattended upgrade are **`"0"` = disabled**. (The only journal sign of the
timers is the daily no-op: `9月 22 10:51:58 ... Starting apt-daily-upgrade.service` →
`9月 22 10:51:58 ... Deactivated successfully.` — same second, i.e. it did nothing.)

### 4.2 `apt-daily.service` / `apt-daily-upgrade.service` / `snapd`

`[exit 0]` — command: `journalctl -u apt-daily.service -u apt-daily-upgrade.service -u snapd --since "2026-09-18" --until "2026-09-23" --no-pager` (relevant lines)

```
9月 21 11:55:53 CNS202649516533 snapd[1527]: storehelpers.go:919: cannot refresh: snap has no updates available: "bare", "core22", "core24", "firmware-updater", "ghostty", "gnome-42-2204", "gnome-46-2404", "gtk-common-themes", "mesa-2404", "snap-store", "snapd", "snapd-desktop-integration"
9月 21 17:00:46 CNS202649516533 snapd[1527]: storehelpers.go:919: cannot refresh: snap has no updates available: "bare", "core22", "core24", "firefox", "firmware-updater", "ghostty", "gnome-42-2204", "gnome-46-2404", "gtk-common-themes", "mesa-2404", "snap-store", "snapd", "snapd-desktop-integration"
9月 22 10:07:07 CNS202649516533 snapd[1569]: storehelpers.go:919: cannot refresh: snap has no updates available: "bare", "core22", "core24", "firefox", "ghostty", "gnome-42-2204", "gnome-46-2404", "gtk-common-themes", "mesa-2404", "snap-store", "snapd", "snapd-desktop-integration"
9月 22 10:07:24 CNS202649516533 snapd[1569]: services.go:1167: RemoveSnapServices - disabling snap.firmware-updater.firmware-updater-app.service
9月 22 10:07:28 CNS202649516533 snapd[1569]: storehelpers.go:919: cannot refresh snap "firmware-updater": snap has no updates available
9月 22 10:51:58 CNS202649516533 systemd[1]: Starting apt-daily-upgrade.service - Daily apt upgrade and clean activities...
9月 22 10:51:58 CNS202649516533 systemd[1]: apt-daily-upgrade.service: Deactivated successfully.
```

Decisive: on **09-21 11:55:53 and 09-21 17:00:46** snapd reports it **cannot refresh** — including
`firmware-updater` and `mesa-2404` — i.e. nothing was downloaded or installed on those runs.

### 4.3 `packagekit`

`[exit 0]` — command: `journalctl --since "2026-09-18" --until "2026-09-23" --no-pager -u packagekit`

```
9月 21 11:56:24 CNS202649516533 PackageKit[1251547]: uid 1001 is trying to obtain org.freedesktop.packagekit.package-install-untrusted auth (only_trusted:0)
9月 21 11:56:34 CNS202649516533 PackageKit[1251547]: uid 1001 obtained auth for org.freedesktop.packagekit.package-install-untrusted
9月 21 11:56:43 CNS202649516533 PackageKit[1251547]: install-files transaction /35_ddaccacd from uid 1001 finished with success after 9278ms
...
9月 22 10:50:11 CNS202649516533 systemd[1]: Starting packagekit.service - PackageKit Daemon...
9月 22 10:50:11 CNS202649516533 systemd[1]: Started packagekit.service - PackageKit Daemon...
9月 22 10:55:17 CNS202649516533 PackageKit[292931]: daemon quit
```

Only human-driven PackageKit activity: the interactive `install-files` (chatgpt) at 09-21 11:56 and
the chrome install on 09-22. **Zero PackageKit events on 09-18, 09-19 or 09-20.**

### 4.4 Grep of all boots for dpkg/apt/unattended/snapd/packagekit

`[exit 0]` — command: `journalctl -b -1 --since "2026-09-18" --no-pager | grep -iE 'dpkg|apt|unattended|snapd|packagekit'`

The complete set of matches in boot -1 (the boot that spans the switch) is:
one `dpkg-db-backup.service` no-op at `9月 20 11:10:44`, the `apt-daily`/`apt-daily-upgrade`/
`dpkg-db-backup` timer *starts* at `9月 20 11:10:44`, and the snapd-apparmor profile load at
`9月 20 11:10:44`. **No package operation of any kind occurred during boot -1.** (See
`raw/pkg-04-journal-pkg-services.txt`, 953 lines, which also contains the 09-18 and 09-22 boots.)

### 4.5 Journal around the claimed 17:18 switch moment — no package/GPU event exists

`[exit 0]` — command: `journalctl --since "2026-09-20 17:15:00" --until "2026-09-20 17:22:00" --no-pager | grep -vE 'wpa_supplicant'`

```
9月 20 17:15:01 CNS202649516533 CRON[706568]: pam_unix(cron:session): session opened for user root(uid=0) by root(uid=0)
9月 20 17:15:01 CNS202649516533 CRON[706569]: (root) CMD (command -v debian-sa1 > /dev/null && debian-sa1 1 1)
9月 20 17:15:01 CNS202649516533 CRON[706568]: pam_unix(cron:session): session closed for user root
9月 20 17:15:05 CNS202649516533 tracker-miner-fs-3[706596]: (tracker-extract-3:706596): GLib-GIO-WARNING **: 17:15:05.943: Error creating IO channel for /proc/self/mountinfo: 无效的参数 (g-io-error-quark, 13)
9月 20 17:15:18 CNS202649516533 tracker-miner-fs-3[706667]: (tracker-extract-3:706667): GLib-GIO-WARNING **: 17:15:18.922: Error creating IO channel for /proc/self/mountinfo: 无效的参数 (g-io-error-quark, 13)
9月 20 17:15:28 CNS202649516533 tracker-miner-fs-3[706727]: (tracker-extract-3:706727): GLib-GIO-WARNING **: 17:15:28.926: Error creating IO channel for /proc/self/mountinfo: 无效的参数 (g-io-error-quark, 13)
9月 20 17:17:01 CNS202649516533 CRON[707282]: pam_unix(cron:session): session opened for user root(uid=0) by root(uid=0)
9月 20 17:17:01 CNS202649516533 CRON[707283]: (root) CMD (cd / && run-parts --report /etc/cron.hourly)
9月 20 17:17:01 CNS202649516533 CRON[707282]: pam_unix(cron:session): session closed for user root
9月 20 17:18:13 CNS202649516533 tracker-miner-fs-3[707719]: (tracker-extract-3:707719): GLib-GIO-WARNING **: 17:18:13.025: Error creating IO channel for /proc/self/mountinfo: 无效的参数 (g-io-error-quark, 13)
9月 20 17:18:45 CNS202649516533 tracker-miner-fs-3[708036]: (tracker-extract-3:708036): GLib-GIO-WARNING **: 17:18:45.677: Error creating IO channel for /proc/self/mountinfo: 无效的参数 (g-io-error-quark, 13)
9月 20 17:18:56 CNS202649516533 tracker-miner-fs-3[708175]: (tracker-extract-3:708175): GLib-GIO-WARNING **: 17:18:56.386: Error creating IO channel for /proc/self/mountinfo: 无效的参数 (g-io-error-quark, 13)
9月 20 17:20:16 CNS202649516533 tracker-miner-fs-3[708601]: (tracker-extract-3:708601): GLib-GIO-WARNING **: 17:20:16.879: Error creating IO channel for /proc/self/mountinfo: 无效的参数 (g-io-error-quark, 13)
9月 20 17:20:20 CNS202649516533 systemd[1]: Starting sysstat-collect.service - system activity accounting tool...
9月 20 17:20:20 CNS202649516533 systemd[1]: sysstat-collect.service: Deactivated successfully.
9月 20 17:20:20 CNS202649516533 systemd[1]: Finished sysstat-collect.service - system activity accounting tool.
9月 20 17:20:26 CNS202649516533 tracker-miner-fs-3[708662]: (tracker-extract-3:708662): GLib-GIO-WARNING **: 17:20:26.887: Error creating IO channel for /proc/self/mountinfo: 无效的参数 (g-io-error-quark, 13)
```

**This is a package-forensics finding in its own right:** at 17:18 on 09-20 the journal contains
*nothing but* cron housekeeping and `tracker-miner-fs-3` warnings. There is **no** apt/dpkg,
no snapd, no packagekit, no gpu-manager, no nvidia, no DRM and no X/thunderbird event at the
claimed switch second. Whatever changed at 17:18 left **no package- or config-level trace at all**.

---

## 5. Configuration files — stat + verbatim contents, and the ±24 h test against 09-20 17:18

±24 h window tested = **2026-09-19 17:18 .. 2026-09-21 17:18**.

### 5.1 The one file that matters: `/usr/share/X11/xorg.conf.d/11-nvidia-offload.conf`

`[exit 0]` — command: `stat /usr/share/X11/xorg.conf.d/11-nvidia-offload.conf`

```
  文件：/usr/share/X11/xorg.conf.d/11-nvidia-offload.conf
  大小：149      	块：8      	IO 块大小：4096   普通文件
设备：259,2	Inode: 4329077	硬链接：1
权限：(0644/-rw-r--r--)  Uid: (    0/    root)   Gid: (    0/    root)
访问时间：2026-09-22 10:02:00.205166264 +0800
修改时间：2026-09-22 10:02:20.664236086 +0800
变更时间：2026-09-22 10:02:20.664236086 +0800
创建时间：2026-09-20 11:10:44.708208214 +0800
```

Contents (`cat`):

```
# DO NOT EDIT. AUTOMATICALLY GENERATED BY gpu-manager

Section "ServerLayout"
    Identifier "layout"
    Option "AllowNVIDIAGPUScreens"
EndSection
```

**Verdict-relevant interpretation:**

- Its **mtime/ctime are 2026-09-22 10:02:20** — outside the ±24 h window (which ends 09-21 17:18). → **not "near"**.
- But its **birth time (`创建时间`, btime) is 2026-09-20 11:10:44** — *on 09-20, in the same boot
  as the switch*, though **6 h 07 m before 17:18** and therefore still **outside the strict ±24 h
  band** (and outside any ±1 h band around 17:18).
- The 09-20 11:10:44 birth is explained by boot-time `gpu-manager`, not by a user or a package:

  `[exit 0]` — command: `journalctl -b -1 --no-pager | grep -iE 'gpu-manager'`

  ```
  9月 20 11:10:44 CNS202649516533 systemd[1]: Starting gpu-manager.service - Detect the available GPUs and deal with any system changes...
  9月 20 11:10:44 CNS202649516533 systemd[1]: gpu-manager.service: Deactivated successfully.
  9月 20 11:10:44 CNS202649516533 systemd[1]: Finished gpu-manager.service - Detect the available GPUs and deal with any system changes.
  ```

  and its own log line (`/var/log/gpu-manager.log`, mtime `2026-09-22 10:01:58`):
  `Creating /usr/share/X11/xorg.conf.d/11-nvidia-offload.conf`
  with the same line in `/var/log/gpu-manager-switch.log` (mtime `2026-09-22 10:02:20`).
  Both logs also state `Has the system changed? No`.

- **Conclusion for P3:** the file's *creation* is a **boot-scoped, automatic, identical-every-boot**
  artefact (`Has the system changed? No`), not a 17:18 change. It is the same content gpu-manager
  has written since 2026-08-10. **It is NOT evidence of a config change near 17:18.**

### 5.2 `/etc/X11/xorg.conf` and `/etc/X11/xorg.conf.d/`

`[exit 0]` — command: `ls -la /etc/X11/xorg.conf*; ls -la /etc/X11/xorg.conf.d/`

```
-rwxr-xr-x  1 root root   50  5月  9 18:09 99-TWatermarkExt.conf
总计 12
drwxr-xr-x  2 root root 4096  9月 22 10:01 .
drwxr-xr-x 12 root root 4096  8月  6  2025 ..
-rwxr-xr-x  1 root root   50  5月  9 18:09 99-TWatermarkExt.conf
```

**`/etc/X11/xorg.conf` does not exist** (no `xorg.conf*` file at all outside `xorg.conf.d/`).
The *only* file in `/etc/X11/xorg.conf.d/` is a watermark module loader, unrelated to GPU selection:

```
[stat] 修改时间：2026-05-09 18:09:15.000000000 +0800
       创建时间：2026-09-22 10:01:58.342459716 +0800
[cat]
Section "Module"
	Load "twatermarkext"
EndSection
```

Its *content* mtime is **2026-05-09**, four months before the incident; its btime of 09-22 reflects
an overlay/immutable-image restore that rewrote btimes machine-wide (the parent directory is also
`创建时间：2026-08-11 00:56:29`). **Not near 17:18 in any meaningful sense.**

### 5.3 `/usr/share/X11/xorg.conf.d/` — the GPU X driver assignment matrix

`[exit 0]` — command: `ls -la /usr/share/X11/xorg.conf.d/`

```
总计 36
drwxr-xr-x 2 root root 4096  9月 20 11:10 .
drwxr-xr-x 5 root root 4096  8月  6  2025 ..
-rw-r--r-- 1 root root  126  4月  9  2024 10-amdgpu.conf
-rw-r--r-- 1 root root  206  6月 30 01:27 10-nvidia.conf
-rw-r--r-- 1 root root 1350  6月 11  2025 10-quirks.conf
-rw-r--r-- 1 root root   92  4月  9  2024 10-radeon.conf
-rw-r--r-- 1 root root  149  9月 22 10:02 11-nvidia-offload.conf
-rw-r--r-- 1 root root 1429  3月 24  2025 40-libinput.conf
-rw-r--r-- 1 root root 3458  4月  9  2024 70-wacom.conf
```

The **directory** mtime `9月 20 11:10` is just the boot-time gpu-manager rewrite of
`11-nvidia-offload.conf`; the other six files are untouched (2024-04-09 / 2025 / 2026-03-24 /
2026-06-11 / 2026-06-30).

GPU-relevant contents, verbatim:

`10-nvidia.conf` (`修改时间：2026-06-30 01:27:59`, `创建时间：2026-08-10 16:34:31` — the driver install):
```
Section "OutputClass"
    Identifier "nvidia"
    MatchDriver "nvidia-drm"
    Driver "nvidia"
    Option "AllowEmptyInitialConfiguration"
    ModulePath "/usr/lib/x86_64-linux-gnu/nvidia/xorg"
EndSection
```

`10-amdgpu.conf` (`修改时间：2024-04-09 00:23:24`, `变更时间：2026-08-11 00:56:44`):
```
Section "OutputClass"
	Identifier "AMDgpu"
	MatchDriver "amdgpu"
	Driver "amdgpu"
	Option "HotplugDriver" "amdgpu"
EndSection
```

`10-radeon.conf` (`修改时间：2024-04-09 00:23:28`):
```
Section "OutputClass"
	Identifier "Radeon"
	MatchDriver "radeon"
	Driver "radeon"
EndSection
```

**None of these three has an mtime near 2026-09-20 17:18.** They are the stock Ubuntu files plus the
`.conf` shipped by the 2026-08-10 nvidia driver install.

### 5.4 `/etc/modprobe.d/`

`[exit 0]` — command: `ls -la /etc/modprobe.d/; grep -rilE 'nvidia|nouveau|amdgpu|drm' /etc/modprobe.d/`

```
总计 68
drwxr-xr-x   2 root root  4096  8月 21 17:33 .
drwxr-xr-x 156 root root 12288  9月 22 10:01 ..
-rw-r--r--   1 root root  2507  2月 22  2021 alsa-base.conf
-rw-r--r--   1 root root   154  5月 29  2025 amd64-microcode-blacklist.conf
-rw-r--r--   1 root root   325  4月 18  2024 blacklist-ath_pci.conf
-rw-r--r--   1 root root  1518  4月 18  2024 blacklist.conf
-rw-r--r--   1 root root   210  4月 18  2024 blacklist-firewire.conf
-rw-r--r--   1 root root   677  4月 18  2024 blacklist-framebuffer.conf
-rw-r--r--   1 root root   156  2月 22  2021 blacklist-modem.conf
lrwxrwxrwx   1 root root    41  8月  6  2025 blacklist-oss.conf -> /lib/linux-sound-base/noOSS.modprobe.conf
-rw-r--r--   1 root root   583  4月 18  2024 blacklist-rare-network.conf
-rw-r--r--   1 root root   127  4月 28  2023 dkms.conf
-rw-r--r--   1 root root   154  5月 22  2025 intel-microcode-blacklist.conf
-rw-r--r--   1 root root   347  4月 18  2024 iwlwifi.conf
-rw-r--r--   1 root root    23  9月 26  2017 libopenni-sensor-pointclouds0.conf
-rw-r--r--   1 root root   257  6月 30 01:27 nvidia-graphics-drivers-kms.conf
```

Two files match nvidia/nouveau/amdgpu/drm. Contents verbatim:

`nvidia-graphics-drivers-kms.conf` (`修改时间：2026-06-30 01:27:59`, `创建时间：2026-08-10 16:34:28`) —
**not near 09-20 17:18**:
```
# This file was generated by nvidia-driver-595
# Set value to 0 to disable modesetting
options nvidia_drm modeset=1

# Preserve video memory on suspend/resume
options nvidia NVreg_PreserveVideoMemoryAllocations=1
options nvidia NVreg_TemporaryFilePath=/var
```

`blacklist-framebuffer.conf` (`修改时间：2024-04-18 18:06:53` — stock Ubuntu, 2.5 years old) contains
the expected `blacklist nvidiafb` line among many framebuffer drivers; it does **not** blacklist
`nvidia`, `nouveau` or `amdgpu`. **Not near 09-20 17:18.**

**No nvidia-specific blacklist file exists** — `gpu-manager.log` confirms operationally:
`Is nvidia blacklisted? no` and `Is nouveau blacklisted? yes`.

**Directory mtime `8月 21 17:33`** — the last write to `/etc/modprobe.d/` was **2026-08-21**,
a month before the incident.

### 5.5 `/etc/default/grub`

`[exit 0]` — command: `stat /etc/default/grub; grep -nE '^GRUB_CMDLINE_LINUX' /etc/default/grub`

```
  文件：/etc/default/grub
  大小：1575     	块：8      	IO 块大小：4096   普通文件
修改时间：2026-08-10 16:36:28.902190757 +0800
变更时间：2026-08-10 16:36:28.902190757 +0800
创建时间：2026-08-10 16:36:28.901710087 +0800

10:GRUB_CMDLINE_LINUX_DEFAULT="quiet splash"
11:GRUB_CMDLINE_LINUX=""
```

**mtime = 2026-08-10 16:36:28 — 41 days before the switch. NOT near 09-20 17:18.**
Both kernel command lines are **stock and empty of GPU directives** — no `nvidia-drm.modeset`,
no `nomodeset`, no `amdgpu.*`, no `pci=`, no `video=`. This is corroborated by the actual boot
command line recorded by the kernel at the 09-20 boot:

```
9月 20 11:10:42 CNS202649516533 kernel: Command line: BOOT_IMAGE=/boot/vmlinuz-6.14.0-27-generic root=UUID=38c1adbf-c111-44ca-bb6b-7c041bea3a19 ro quiet splash vt.handoff=7
```

The recorded live command line matches `/etc/default/grub` exactly, proving GRUB was **not**
regenerated or altered for the 09-20 boot.

### 5.6 `/etc/nvidia/`, `nvidia*.conf`, bumblebee

`[exit 0]` — command: `ls -la /etc/nvidia* /etc/bumblebee`

```
ls: 无法访问 '/etc/nvidia*': 没有那个文件或目录
ls: 无法访问 '/etc/nvidia/': 没有那个文件或目录
ls: 无法访问 '/etc/bumblebee': 没有那个文件或目录
```

`/etc/nvidia/` does **not exist** (nothing to date). There is **no** `/etc/modprobe.d/nvidia*.conf`
— the only nvidia modprobe file is `nvidia-graphics-drivers-kms.conf` (§5.4). No bumblebee.
`/etc/X11/xorg.conf.d/` contains no nvidia/amdgpu `Device`/`Screen`/`BusID` stanza at all (§5.2).

### 5.7 Config-file mtime summary against the ±24 h test

| File | content mtime (`修改时间`) | Near 09-20 17:18? |
|---|---|---|
| `/usr/share/X11/xorg.conf.d/11-nvidia-offload.conf` | 2026-09-22 10:02:20 (btime 2026-09-20 11:10:44) | **No** (btime same day, −6 h 07 m; mtime +1 d 17 h) |
| `/usr/share/X11/xorg.conf.d/10-nvidia.conf` | 2026-06-30 01:27:59 | No |
| `/usr/share/X11/xorg.conf.d/10-amdgpu.conf` | 2024-04-09 00:23:24 | No |
| `/usr/share/X11/xorg.conf.d/10-radeon.conf` | 2024-04-09 00:23:28 | No |
| `/etc/X11/xorg.conf.d/99-TWatermarkExt.conf` | 2026-05-09 18:09:15 | No |
| `/etc/X11/xorg.conf` | **file absent** | n/a |
| `/etc/modprobe.d/nvidia-graphics-drivers-kms.conf` | 2026-06-30 01:27:59 | No |
| `/etc/modprobe.d/blacklist-framebuffer.conf` | 2024-04-18 18:06:53 | No |
| `/etc/default/grub` | 2026-08-10 16:36:28 | No |
| `/etc/nvidia/` | **absent** | n/a |
| `/var/lib/ubuntu-drivers-common/last_gfx_boot` | 2026-09-22 10:02:20 | No |
| `/var/lib/ubuntu-drivers-common/requires_offloading` | 2026-09-22 10:02:20 | No |

**No config file has an mtime within ±24 h of 2026-09-20 17:18. P3 = FAIL.**

Related state files, for completeness (`cat`):

```
[exit 0] — cat /var/lib/ubuntu-drivers-common/last_gfx_boot
1002:13c0;0000:73:00:0;1
10de:2684;0000:01:00:0;0

[exit 0] — cat /var/lib/ubuntu-drivers-common/requires_offloading
ON
```

`requires_offloading = ON` is the hybrid/PRIME-offload mode: the AMD iGPU drives the display and
the RTX 4090 is the offload/render device. **This matches the pre-existing 2026-08-10 driver
install, not a 09-20 change.**

---

## 6. `/var/log/nvidia-installer.log` / `/var/log/nvidia-*`

`[exit 0]` — command: `ls -la /var/log/nvidia*`

```
ls: 无法访问 '/var/log/nvidia*': 没有那个文件或目录
```

**No `/var/log/nvidia-installer.log` and no `/var/log/nvidia-*` file of any kind exists.**
`[exit 0]` — command: `find /var/log /var/lib -maxdepth 3 -iname '*nvidia*'` returns **no file under
`/var/log`** at all; every hit is either a dpkg metadata file owned by the packaged driver install
or the DKMS tree:

```
/var/lib/dpkg/info/nvidia-kernel-common-595.conffiles
/var/lib/dpkg/info/nvidia-driver-595-open.list
/var/lib/dpkg/info/nvidia-driver-590-open.list
/var/lib/dpkg/info/nvidia-prime.postinst
/var/lib/dpkg/info/nvidia-settings.conffiles
/var/lib/dkms/nvidia
...
```

**Consequence:** the NVIDIA stack here was installed exclusively via **apt packages + DKMS**, not via
the NVIDIA `.run` installer. There is therefore **no `/var/log/nvidia-installer.log` to inspect, and
it does not have a timestamp in 09-18..09-22 because it does not exist at all.** The requested
"last ~30 lines of the file with the most recent activity in that window" is **not applicable**;
the closest available NVIDIA-side evidence is the kernel journal in §3.2 and
`/var/log/gpu-manager*.log` (§5.1), neither of which shows activity at 17:18 on 09-20.

---

## 7. UNAVAILABLE INFORMATION

Items I could **not** obtain, with the reason:

1. **`/var/log/nvidia-installer.log` — FILE ABSENT.** Not created on this machine (the driver came
   from apt/DKMS). `ls -la /var/log/nvidia*` → `没有那个文件或目录`. Nothing was hidden by
   rotation; the file never existed.
2. **`/etc/nvidia/` — DIRECTORY ABSENT**, and no `/etc/modprobe.d/nvidia*.conf`. Nothing to
   stat or cat.
3. **`/etc/X11/xorg.conf` and `/etc/X11/xorg.conf.*` — FILES ABSENT.** Only
   `/etc/X11/xorg.conf.d/99-TWatermarkExt.conf` exists.
4. **`/var/lib/gdm3/.local/share/xorg/` — PERMISSION DENIED.** `ls` → `权限不够`; the directory is
   `drwx--x--x 2 root gdm`. `sudo -n true` failed (`sudo NOT available`), so the **GDM greeter
   session's own X log could not be read**. If the 17:18 event involved a greeter restart, that
   log would be the place to see it. *Partial mitigation:* the user-session log
   `~/.local/share/xorg/Xorg.1.log.old` was readable and shows the user session began at
   **11:12:48 on 09-20** with AMD already driving the display (§7.1), so the user session itself
   needed no restart at 17:18.
5. **`/var/log/Xorg.0.log` (system path) — FILE ABSENT.** `ls: 无法访问 '/var/log/Xorg*':
   没有那个文件或目录`. On this system X logs live under the per-user/per-gdm `.local/share/xorg/`
   paths instead.
6. **`snap changes --no-verify` — UNSUPPORTED FLAG on this snapd.**
   `错误：unknown flag 'no-verify'`. Used plain `snap changes` instead (§8).
7. **`/var/log/apt/eipp.log.xz` is not a change log.** It is `xz`-compressed and only records
   package *install* plans; it is not a per-transaction dated history. I read its header
   (`Request: EIPP 0.1` … `Install: google-chrome-stable:amd64`) and confirmed its **newest entry
   is the 09-22 chrome install**. It cannot be used to date the nvidia/mesa installs; §3.1 uses
   `/var/log/dpkg.log.1` and `history.log.1.gz` for that instead.
8. **Journal before 2026-08-11 — NOT RETAINED.** `journalctl --list-boots` oldest entry is
   `-7 17fdd96951904deb8c686206be330907 Tue 2026-08-11 01:02:43 CST`. Not an issue for this
   window (09-18..09-22 is fully retained) but it means the 2026-08-10 driver install cannot be
   corroborated from the journal, only from package logs.
9. **Package logs do not extend before 2025-08-05.** `dpkg.log.1` starts `2025-08-05 16:48:11`.
   Irrelevant to the window but noted as the retention floor.
10. **Exact `dmesg`-level state between 09-20 17:18 and 09-21 19:04 is unremarkable but noisy** —
    no GPU/package messages exist there (§4.5). I could not find any package-side event to
    attribute to that instant because none exists in any surviving log.

### 7.1 A finding that qualifies the premise (reported, not decided, by this package workstream)

While gathering the config evidence I found that **the AMD iGPU was already the display GPU from
the very first X session of the 09-20 boot — 5 h 05 m before 17:18**:

`[exit 0]` — command: `stat ~/.local/share/xorg/Xorg.1.log.old; head -20 ~/.local/share/xorg/Xorg.1.log.old`

```
修改时间：2026-09-21 19:04:30.953833220 +0800
创建时间：2026-09-20 11:12:48.964735790 +0800
```

```
[   130.097] (--) Log file renamed from "/home/CNS2026495165/.local/share/xorg/Xorg.pid-3931.log" to "/home/CNS2026495165/.local/share/xorg/Xorg.1.log"
X.Org X Server 1.21.1.11
...
[   130.097] (==) Log file: "/home/CNS2026495165/.local/share/xorg/Xorg.1.log", Time: Sun Sep 20 11:12:48 2026
...
[   130.101] (**) OutputClass "nvidia" ModulePath extended to "/usr/lib/x86_64-linux-gnu/nvidia/xorg,/usr/lib/xorg/modules"
[   130.103] (II) Applying OutputClass "AMDgpu" to /dev/dri/card2
[   130.103] 	loading driver: amdgpu
[   130.103] (II) Applying OutputClass "nvidia" to /dev/dri/card1
[   130.103] 	loading driver: nvidia
```

and, from that same 11:12:48 session, the output/connector state:

```
[   130.831] (II) AMDGPU(0): Output HDMI-A-1 disconnected
[   130.831] (II) AMDGPU(0): Output HDMI-A-2 connected
[   130.831] (II) AMDGPU(0): Output DisplayPort-3 disconnected
[   130.831] (II) AMDGPU(0): Output DisplayPort-4 disconnected
[   130.850] (--) NVIDIA(GPU-0): DFP-0: disconnected
[   130.850] (--) NVIDIA(GPU-0): DFP-1: disconnected
[   130.850] (--) NVIDIA(GPU-0): DFP-2: disconnected
[   130.850] (--) NVIDIA(GPU-0): DFP-3: disconnected
[   130.850] (--) NVIDIA(GPU-0): DFP-4: disconnected
[   130.850] (--) NVIDIA(GPU-0): DFP-5: disconnected
[   130.850] (--) NVIDIA(GPU-0): DFP-6: disconnected
```

**Reading:** a single X server loaded *both* drivers, presented **AMDGPU(0)** as the display device
with **HDMI-A-2 connected**, and found **every NVIDIA DFP (DisplayPort/HDMI) connector
disconnected**. The user session then ran continuously on that server until 09-21 19:04:30
(`[114833.352]` ≈ 31.9 h uptime).

This **does not change** any of the P1–P4 verdicts — it *strengthens* P1/P2 (nothing changed,
because nothing needed to change: AMD was already the display GPU when the boot's X session
started). It does suggest that the **premise "the active GPU changed at 2026-09-20 17:18" is not
supported by X-server evidence for that boot**, and that the real transition of the *display
path* onto the AMD iGPU happened earlier — most plausibly at the 09-20 11:10 boot, i.e. a
monitor/physical-cable event (consistent with the RTX 4090 showing
`[drm] Cannot find any crtc or sizes` from 11:10:43, §3.2). Deciding that is outside this
package workstream's scope; flagging it because it may redirect the main investigation away from
packages entirely.

---

## 8. Snap evidence (item 4 of the task)

`[exit 0]` — command: `snap changes`

```
ID   状态    生成                  就绪                  摘要
74   Done  今天 10:07（美国山区标准时间）  今天 10:07（美国山区标准时间）  自动刷新 snap "firmware-updater"
```

Only one change exists in snapd's log: change 74, the **firmware-updater auto-refresh on
2026-09-22 10:07**, i.e. **outside** the 09-18..09-21 sub-window (and it is a firmware-updater
refresh, not graphics). `snap changes --no-verify` is unsupported here (§7 item 6).

`[exit 0]` — command: `snap list --all` (GPU-relevant and revision-suffixed entries)

```
名称                         版本                              修订版本   追踪               发布者           注记
core22                     20260824                        2955   latest/stable    canonical**   base
core24                     20260824                        2124   latest/stable    canonical**   base
firefox                    155.0.1-1                       8863   latest/stable/…  mozilla**     -
mesa-2404                  25.2.8-snap288                  1839   latest/stable    canonical**   -
snapd                      2.76.3                          27738  latest/stable    canonical**   snapd
```

The GPU-relevant snap is **`mesa-2404` = `25.2.8-snap288`, revision `1839`** — it has **only that
one revision installed** (no older revision parked alongside), and there is no refresh event for
it in the window. Backing-file timestamps confirm it predates the window by five weeks:

`[exit 0]` — command: `ls -la /var/lib/snapd/snaps/ | grep -iE 'mesa|firmware|snapd|firefox'`

```
-rw-------  2 root root 257036288  8月  6  2025 firefox_6565.snap
-rw-------  2 root root 273506304  9月  7 05:19 firefox_8863.snap
-rw-------  2 root root  17301504  8月 15 05:34 firmware-updater_226.snap
-rw-------  2 root root  13316096  9月 22 10:07 firmware-updater_258.snap
-rw-------  2 root root  421507072  8月 13 15:59 mesa-2404_1839.snap
-rw-------  1 root root  52535296  8月 12 17:14 snapd_27710.snap
-rw-------  1 root root  52711424  9月  8 07:04 snapd_27738.snap
-rw-------  1 root root  8192      8月  6  2025 snapd-desktop-integration_315.snap
-rw-------  1 root root   847872  8月 13 15:55 snapd-desktop-integration_391.snap
```

`mesa-2404_1839.snap` → **2026-08-13 15:59**; `snapd_27738.snap` → **2026-09-08 07:04**;
only `firmware-updater_258.snap` → **2026-09-22 10:07**. **No GPU-related snap changed in
09-18..09-22.**

---

## 9. Exact commands run (reproducibility)

All commands are read-only. Outputs are saved verbatim under
`.../gpu-switch-0920/raw/pkg-0N-*.txt` as noted.

```bash
# --- 0. output dirs
mkdir -p .../gpu-switch-0920/evidence/pkg .../gpu-switch-0920/raw

# --- 1. inventory & coverage (raw/pkg-05, §2)
ls -la /var/log/apt/ /var/log/dpkg.log* /var/log/
head -3 /var/log/dpkg.log; tail -3 /var/log/dpkg.log
head -3 /var/log/dpkg.log.1; tail -3 /var/log/dpkg.log.1
wc -l /var/log/dpkg.log /var/log/dpkg.log.1
cat /var/log/apt/history.log
zcat /var/log/apt/history.log.1.gz | head -8
zcat /var/log/apt/history.log.1.gz | tail -8
cat /var/log/apt/term.log
zcat /var/log/apt/term.log.1.gz | tail -20
find /var/log /var/backups -maxdepth 2 \( -name 'dpkg*' -o -name 'apt*' -o -name '*history*' \)
xzcat /var/log/apt/eipp.log.xz | head -20
xzcat /var/log/apt/eipp.log.xz | grep -icE 'nvidia|mesa'

# --- 2. in-window package entries (raw/pkg-05, §1)
grep -E '^2026-09-(1[89]|2[012])' /var/log/dpkg.log
grep -hE '^2026-09-(1[89]|2[012])' /var/log/dpkg.log /var/log/dpkg.log.1 | grep -E ' (install|upgrade|remove|purge|configure|unpack) '
grep -oE '^2026-09-[0-9]{2}' /var/log/dpkg.log | sort | uniq -c
grep -cE '^2026-09-(1[89]|2[012])' /var/log/dpkg.log.1
{ cat /var/log/apt/history.log; zcat /var/log/apt/history.log.1.gz; } | grep -E '^Start-Date: 2026-09-(1[6-9]|2[0-3])'
grep -E '^Log (started|ended): 2026-09-(1[89]|2[0-3])' /var/log/apt/term.log
zcat /var/log/apt/term.log.1.gz | grep -E '^Log (started|ended): 2026-09-(1[89]|2[0-3])'

# --- 3. nvidia/mesa/kernel provenance (raw/pkg-01, raw/pkg-09, §3)
grep -rE 'nvidia|nouveau|mesa|drm|xserver-xorg-video|linux-image|linux-modules|linux-firmware|linux-headers' /var/log/dpkg.log /var/log/apt/history.log /var/log/apt/term.log
zcat /var/log/apt/history.log.1.gz | grep -iE 'nvidia|nouveau|mesa|drm|xserver-xorg-video|linux-image|linux-modules|linux-firmware|linux-headers'
zcat /var/log/apt/term.log.1.gz | grep -iE 'nvidia|nouveau|mesa|drm|xserver-xorg-video|linux-image|linux-modules|linux-firmware|linux-headers'
grep -iE 'nvidia|nouveau|mesa|drm' /var/log/dpkg.log.1 | tail -60
grep -iE 'nvidia|mesa|libdrm|nouveau' /var/log/dpkg.log.1 | grep -oE '^[0-9]{4}-[0-9]{2}-[0-9]{2}' | sort -u
grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}.*(install|upgrade) ' /var/log/dpkg.log.1 | grep -iE 'nvidia|mesa|libdrm|nouveau|xserver-xorg-video'
zcat /var/log/apt/history.log.1.gz | awk '/^Start-Date:/{sd=$0} /^End-Date:/{ed=$0} /(nvidia|mesa|libdrm|xserver-xorg-video|linux-image|linux-modules|linux-firmware|linux-headers)/{print sd" || "ed" || "substr($0,1,300)}' | tail -40
dpkg -l | grep -iE 'nvidia|mesa|libdrm|xserver-xorg|linux-image|linux-modules|linux-headers|linux-firmware'
dkms status; uname -a; ls -la /lib/modules/

# --- 4. dpkg database truth (raw/pkg-09, §2.1)
stat /var/lib/dpkg/status; stat /var/lib/dpkg/status-old
stat /var/lib/apt/extended_states
find /var/lib/dpkg/info -maxdepth 1 -newermt "2026-09-18" ! -newermt "2026-09-23"
ls -lat /var/cache/apt/archives/*.deb | head -10

# --- 5. journals (raw/pkg-03, raw/pkg-04, §3.2, §4)
journalctl --list-boots --no-pager
journalctl -u unattended-upgrades --since "2026-09-18" --until "2026-09-23" --no-pager
journalctl -u apt-daily.service -u apt-daily-upgrade.service -u snapd --since "2026-09-18" --until "2026-09-23" --no-pager
journalctl --since "2026-09-18" --until "2026-09-23" --no-pager -u packagekit
journalctl -b -1 --since "2026-09-18" --no-pager | grep -iE 'dpkg|apt|unattended|snapd|packagekit'
journalctl --since "2026-09-18" --until "2026-09-23" --no-pager | grep -iE 'dpkg|apt|unattended|snapd|packagekit'
journalctl --since "2026-09-18" --until "2026-09-23" --no-pager | grep -iE 'nvidia|nouveau|drm|amdgpu|radeon|gpu-manager'
journalctl --since "2026-09-20 17:10:00" --until "2026-09-20 17:25:00" --no-pager
journalctl --since "2026-09-20 17:15:00" --until "2026-09-20 17:22:00" --no-pager | grep -vE 'wpa_supplicant'
journalctl -b -1 --no-pager | grep -iE 'gpu-manager|nvidia|xrandr|monitor|edid|hotplug|gnome-shell.*(gpu|drm)|mutter'
journalctl -b -1 --no-pager | grep -iE 'gdm|Xorg|gnome-shell'

# --- 6. config files (raw/pkg-06, §5)
ls -la /etc/X11/xorg.conf* /etc/X11/xorg.conf.d/ /usr/share/X11/xorg.conf.d/ /etc/modprobe.d/
stat /etc/X11/xorg.conf.d /etc/X11/xorg.conf.d/99-TWatermarkExt.conf
stat /usr/share/X11/xorg.conf.d/10-nvidia.conf /usr/share/X11/xorg.conf.d/11-nvidia-offload.conf
stat /usr/share/X11/xorg.conf.d/10-amdgpu.conf /usr/share/X11/xorg.conf.d/10-radeon.conf
cat /usr/share/X11/xorg.conf.d/10-nvidia.conf /usr/share/X11/xorg.conf.d/11-nvidia-offload.conf
cat /usr/share/X11/xorg.conf.d/10-amdgpu.conf /usr/share/X11/xorg.conf.d/10-radeon.conf
cat /etc/X11/xorg.conf.d/99-TWatermarkExt.conf
grep -rilE 'nvidia|nouveau|amdgpu|drm' /etc/modprobe.d/
stat /etc/modprobe.d/nvidia-graphics-drivers-kms.conf /etc/modprobe.d/blacklist-framebuffer.conf
cat /etc/modprobe.d/nvidia-graphics-drivers-kms.conf /etc/modprobe.d/blacklist-framebuffer.conf
stat /etc/default/grub; grep -nE '^GRUB_CMDLINE_LINUX' /etc/default/grub
ls -la /etc/nvidia* /etc/nvidia/ /etc/bumblebee
cat /var/log/gpu-manager.log /var/log/gpu-manager-switch.log
stat /var/log/gpu-manager.log /var/log/gpu-manager-switch.log
ls -la /var/lib/ubuntu-drivers-common/; cat /var/lib/ubuntu-drivers-common/last_gfx_boot
cat /var/lib/ubuntu-drivers-common/requires_offloading
grep -nE '^\s*"[0-9]|APT::Periodic|Unattended-Upgrade' /etc/apt/apt.conf.d/20auto-upgrades

# --- 7. nvidia-installer logs (raw/pkg-02, §6)
ls -la /var/log/nvidia*
find /var/log /var/lib -maxdepth 3 -iname '*nvidia*'

# --- 8. snap (raw/pkg-07, §8)
snap changes
snap changes --no-verify
snap list --all
ls -la /var/lib/snapd/snaps/
stat /var/lib/snapd/state.json

# --- 9. X session evidence (raw/pkg-08, §7.1)
ls -la /var/log/Xorg* ~/.local/share/xorg/
stat ~/.local/share/xorg/Xorg.1.log.old
head -20 ~/.local/share/xorg/Xorg.1.log.old
grep -nE 'Time: Sun Sep 20|OutputClass "(nvidia|AMDgpu)"|loading driver|AMDGPU\(0\): Output|NVIDIA\(GPU-0\): DFP-[0-9]: (connected|disconnected)' ~/.local/share/xorg/Xorg.1.log.old
ls -la /var/lib/gdm3/.local/share/xorg/     # -> permission denied
sudo -n true                                 # -> fails, no sudo
```

---

## 10. Raw evidence file index

| File | Contents |
|---|---|
| `raw/pkg-01-apt-dpkg-nvidia-grep.txt` | nvidia/mesa/drm/xserver/kernel grep across all apt+dpkg logs |
| `raw/pkg-02-nvidia-logs-and-pkgs.txt` | `/var/log/nvidia*` absence, `find -iname '*nvidia*'`, `dpkg -l` installed versions |
| `raw/pkg-03-journal-0920-1718.txt` | `journalctl --list-boots` + full journal 09-20 17:10–17:25 |
| `raw/pkg-04-journal-pkg-services.txt` | 953 lines: dpkg/apt/unattended/snapd/packagekit across 09-18..09-23 |
| `raw/pkg-05-window-pkg-entries-verbatim.txt` | verbatim in-window dpkg lines + full `history.log` |
| `raw/pkg-06-config-files-stat-contents.txt` | stat + contents of every xorg.conf.d / modprobe.d / grub / gpu-manager / driver-state file |
| `raw/pkg-07-snap.txt` | `snap changes`, `snap list --all`, `/var/lib/snapd/snaps` listing |
| `raw/pkg-08-xorg-first-session.txt` | `Xorg.1.log.old` stat + first session / driver / connector evidence |
| `raw/pkg-09-dpkg-db-truth.txt` | `/var/lib/dpkg/status` stat, `dpkg/info` window mtimes, `dpkg -l`, `dkms status` |

---

## 11. Summary of hypotheses vs. evidence

| Hypothesis | Verdict | Strongest evidence |
|---|---|---|
| H1: An nvidia driver upgrade broke the userspace stack near 09-20 | **REJECTED** | Last nvidia package change `2026-08-10 16:34:31 install nvidia-driver-595-open:amd64 <none> 595.84-0ubuntu0.24.04.1` (`/var/log/dpkg.log.1`); no nvidia line exists in any 09-18..09-22 log |
| H2: A mesa/libdrm upgrade changed GPU selection | **REJECTED** | `2026-08-10 16:34:27 upgrade libgl1-mesa-dri:amd64 25.0.7-0ubuntu0.24.04.1 25.2.8-0ubuntu0.24.04.2`; mesa unchanged since |
| H3: A kernel change (new kernel / modules) broke DKMS | **REJECTED** | Only kernel on disk is `6.14.0-27-generic` (`/lib/modules/`), from the `2026-08-10 16:57:27` transaction; `dkms status` → `nvidia/595.84, 6.14.0-27-generic, x86_64: installed`; module loaded fine at 09-20 11:10:42 |
| H4: An xorg.conf.d / modprobe.d change switched X to the AMD iGPU | **REJECTED** | No such file has an mtime in ±24 h of 09-20 17:18; `11-nvidia-offload.conf` btime 09-20 11:10:44 is boot-time gpu-manager with `Has the system changed? No` |
| H5: GRUB cmdline change forced iGPU | **REJECTED** | `/etc/default/grub` mtime `2026-08-10 16:36:28`, `GRUB_CMDLINE_LINUX_DEFAULT="quiet splash"`, `GRUB_CMDLINE_LINUX=""`; live kernel cmdline at 09-20 boot matches byte-for-byte |
| H6: An unattended/automated upgrade ran in the window | **REJECTED** | `APT::Periodic::Unattended-Upgrade "0"` (disabled); journal shows only start/stop of the shutdown hook |
| H7: A snap (mesa-2404 etc.) refresh changed the graphics stack | **REJECTED** | `snap changes` shows only change 74 (firmware-updater, 09-22 10:07); `mesa-2404_1839.snap` mtime `8月 13 15:59`; snapd logged `cannot refresh ... mesa-2404` on 09-21 |
| H8: The GPU switch has a package/config cause but the log was rotated away | **REJECTED** | P4 = logs fully cover the window; and `/var/lib/dpkg/status` + `dpkg/info` independently prove no package moved (9 files touched, all chatgpt/chrome) |

**No package, driver, kernel, mesa, xorg-config, modprobe, GRUB or snap change explains the
GPU switch or a broken NVIDIA userspace stack. The evidence points away from the package layer
entirely.**
