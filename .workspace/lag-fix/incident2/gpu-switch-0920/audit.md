# audit.md — “2026-09-20 17:18 前后到底发生了什么”取证报告

- 主机：`CNS202649516533`（原名 `itadm-X870-AORUS-ELITE-WIFI7`，Gigabyte X870 AORUS ELITE WIFI7 / AM5 / Ryzen 9 9950X）
- 取证时间：2026-09-22 11:08 ~ 11:35 CST
- 内核：`6.14.0-27-generic`（#27~24.04.1-Ubuntu）；会话：**X11 + GNOME Shell 46.2（mutter 46.2）**
- 纪律声明：**全程只读**。未修改任何配置、未重启、未触碰 X、未 pkill、未执行任何 apt/snap/systemctl/xrandr/dconf 写操作。所有工具调用均未传 `sandbox_permissions`。
- 产出目录：`/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/gpu-switch-0920/`

---

## 0. 结论速览（Bottom line）

| 问题 | 结论 |
|---|---|
| 09-20 17:18 附近有没有 OS 层事件？ | **没有。** journal 该时刻前后 ±10 min 只有 CRON/sysstat；X 服务器日志从 09-20 14:11:19 到 09-21 19:04:30 **一行都没有**。 |
| 那 17:18 是什么？ | **是 Firefox 遥测 `main` ping 的 `creationDate`**（UTC `09:18:43.486Z` = CST 17:18:43），`reason=environment-change`。**是“上报时刻”，不是“硬件变更时刻”。** |
| GPU 实际什么时候换的？ | **在 2026-09-18 17:42:05 → 2026-09-20 11:10:42 的关机空档里**；更精确地说，**在 09-20 11:10:42 那次开机时已经完成了**（固件 boot-VGA 标志从中 4090 翻到核显）。 |
| 换的是什么？ | 显示器 + X 主屏 GPU：`NVIDIA(0)`（RTX 4090，显示器接在 4090 的 DFP-0）→ `AMDGPU(0)`（Raphael 核显，显示器接主板 HDMI）。 |
| 4090 掉卡/挂了没？ | **没有任何 `Xid` / `GPU has fallen off the bus` / reset / NVRM 报错**；`nvidia-persistenced` 从 09-20 11:10:44 一直连续运行到 09-21 19:04:30。 |
| 4090 现在还能用吗？ | **内核侧与 X 侧都健康**（见 §5）：驱动已绑定、`/proc/driver/nvidia/gpus/.../information` 能读出真实 GPU 信息、`/dev/nvidia*` 齐全、`power_state=D0`、`nvidia-persistenced` 在跑。**唯一异常是 `nvidia-smi`/NVML 用户态初始化失败，原因未复现、INCONCLUSIVE。** |
| 能否切回 4090？ | **能，但软件层不是瓶颈——真正的开关是“显示器线插到 4090 + UEFI 初始显示输出指向 PCIe”。** 方案见 §8.③（只给方案，未执行）。 |

**一句话**：17:18 不是事件时刻，而是**遥测“发现”时刻**；物理切换发生在 09-18→09-20 的关机窗口内，09-20 11:10:42 开机后系统就已全程跑在核显上了——比 17:18 早 **6 小时 08 分**。

---

## 1. 方法与证据链概览

本次取证的关键突破是找到了一条**独立的、来自 journald 的 Xorg 日志通道**：本机 `/var/log/Xorg.*.log*` **根本不存在**，X 日志写在 `~/.local/share/xorg/`（用户会话）与 `/var/lib/gdm3/.local/share/xorg/`（登录界面，权限拒绝），但 **gdm 的 X 会话包装进程 `/usr/libexec/gdm-x-session[PID]` 会把整份 X 日志转发进 journald**，因此可以用 `journalctl` 完整回溯历史 X 会话（含已被轮转删除的 boot −2）。

证据链（四层，互相独立且一致）：

1. **journald**：内核 + systemd + `gdm-x-session` 转发的 Xorg 日志（覆盖 boot −2 / −1 / 0）。
2. **文件系统 inode 时间戳**：`~/.local/share/xorg/Xorg.1.log.old`（跨越 17:18 的那份）、`11-nvidia-offload.conf` 的 btime、`monitors.xml` 的 mtime。
3. **sysfs / procfs 当前状态**：`/sys/class/drm/*`、`/proc/driver/nvidia/*`、`/sys/module/*`。
4. **Firefox 遥测 ping 本体**（决定 17:18 性质的关键）：`.main.jsonlz4` 原文件解码。

---

## 2. 任务①：系统日志回溯（`journalctl --since "2026-09-20 16:00" --until "2026-09-20 19:00"`）

### 2.1 Journal 保留期：**足够，可完整回溯**

```
$ journalctl --disk-usage
Archived and active journals take up 1.0G in the file system.
$ journalctl --list-boots
IDX BOOT ID                          FIRST ENTRY                 LAST ENTRY
 -2 d59100c8c10a40378f251a9cebb15267 Sat 2026-09-12 14:54:44 CST Fri 2026-09-18 17:42:05 CST
 -1 dbe2fd5614244921b1dac5a2246c633b Sun 2026-09-20 11:10:42 CST Mon 2026-09-21 19:04:34 CST
  0 993b7879fa064c6e97c9d3df3d19a157 Tue 2026-09-22 10:01:55 CST Tue 2026-09-22 11:08:33 CST
```
最早可用时间 **2026-08-11 01:02:43 CST** → **09-20 完全可回溯，不存在 journal 被轮转的问题**。

> 原始片段：`raw/journal-0920-1600-1900.full.txt`（7736 行，`short-iso-precise`，16:00:02.611797 → 18:59:59.370932）

### 2.2 该 3 小时窗口的完整内核消息：**只有 26 行，且全部与 GPU 无关**

```
$ grep -n ' kernel:' raw/journal-0920-1600-1900.full.txt
934 :2026-09-20T16:42:19.193847+08:00 ... kernel: workqueue: pm_runtime_work hogged CPU for >10000us 67 times, consider switching to WQ_UNBOUND
2514:2026-09-20T17:39:54.910737+08:00 ... kernel: usb 1-4: USB disconnect, device number 7
2515:2026-09-20T17:39:54.911022+08:00 ... kernel: xr_serial ttyUSB0: xr_serial converter now disconnected from ttyUSB0
2518:2026-09-20T17:39:56.744735+08:00 ... kernel: usb 1-4: new full-speed USB device number 9 using xhci_hcd
2707:2026-09-20T17:45:07.313735+08:00 ... kernel: usb 1-4: USB disconnect, device number 9
2711:2026-09-20T17:45:09.907727+08:00 ... kernel: usb 1-4: new full-speed USB device number 10 using xhci_hcd
4453+ : apparmor DENIED/AUDIT 行（18:07 / 18:28 / 18:39，与 GPU 无关）
```

- **无** `Xid`、**无** `GPU has fallen off the bus`、**无** `NVRM`、**无** `drm` 连接器状态变更、**无** `nvidia`/`amdgpu` 驱动加载或卸载、**无** GPU reset/hang。
- 窗口内**没有重启**：boot −1 从 09-20 11:10:42 一直延续到 09-21 19:04:34。

### 2.3 17:18 前后 ±10 分钟：**逐行全文，除 wpa_supplicant/tracker 外只有 CRON**

```
$ journalctl -b -1 --no-pager -o short-iso-precise --since "2026-09-20 17:15:00" --until "2026-09-20 17:25:00" \
  | grep -vE 'wpa_supplicant|tracker-miner|rtkit-daemon'
2026-09-20T17:15:01.174017+08:00 CNS202649516533 CRON[706568]: pam_unix(cron:session): session opened for user root(uid=0) by root(uid=0)
2026-09-20T17:15:01.174313+08:00 CNS202649516533 CRON[706569]: (root) CMD (command -v debian-sa1 > /dev/null && debian-sa1 1 1)
2026-09-20T17:15:01.175939+08:00 CNS202649516533 CRON[706568]: pam_unix(cron:session): session closed for user root
2026-09-20T17:17:01.177900+08:00 CNS202649516533 CRON[707282]: pam_unix(cron:session): session opened for user root(uid=0) by root(uid=0)
2026-09-20T17:17:01.178172+08:00 CNS202649516533 CRON[707283]: (root) CMD (cd / && run-parts --report /etc/cron.hourly)
2026-09-20T17:17:01.179489+08:00 CNS202649516533 CRON[707282]: pam_unix(cron:session): session closed for user root
2026-09-20T17:20:20.935829+08:00 CNS202649516533 systemd[1]: Starting sysstat-collect.service - system activity accounting tool...
2026-09-20T17:20:20.938815+08:00 CNS202649516533 systemd[1]: sysstat-collect.service: Deactivated successfully.
2026-09-20T17:20:20.938931+08:00 CNS202649516533 systemd[1]: Finished sysstat-collect.service - system activity accounting tool.
```
（**17:17:01 的 `run-parts /etc/cron.hourly` 与 17:18 相差 59 秒，属每小时固定 cron，与 GPU 无关。**）

journal 完整性检查：全窗口最大行间间隔 315 s（18:45:05→18:50:20），**不存在被 rate-limit 掐断的静默段**；boot −1 全程只有 5 处 `Suppressed/missed messages` 标记。

### 2.4 唯一的会话级信号在 17:33:20，且不是 X 重启

```
2026-09-20T17:33:07.527924+08:00 ... dbus-daemon[1505]: Activating ... 'net.reactivated.Fprint' ... requested by ':1.136' (uid=1001 pid=4195 comm="/usr/bin/gnome-shell")
2026-09-20T17:33:20.209657+08:00 ... gdm-password][713452]: gkr-pam: unlocked login keyring
2026-09-20T17:33:20.419390+08:00 ... gnome-shell[4195]: Launching DING process
2026-09-20T17:33:20.678794+08:00 ... gnome-shell[4195]: Can't update stage views actor ... needs an allocation.   ← 出现 1694 次
```
- `gnome-shell[4195]` **PID 自 09-20 11:12:50 起一直未变**，直到 boot −1 结束 → **不是 shell 重启**，是**指纹解锁 + 解锁后 stage 重新布局 + DING 桌面图标扩展重启**。
- `DING: DBus interface for Switcheroo control (net.hadess.SwitcherooControl) is now available.` → 混合显卡环境下的 switcheroo 接口正常。

### 2.5 X 服务器自身日志：**跨越 17:18 的那一行都没有**

经 journald 转发的 Xorg 输出，按 PID 分段：

```
$ grep -oE 'gdm-x-session\[[0-9]+\]' raw/boot-1-xsession-nvidia.txt | sort | uniq -c
   1419 gdm-x-session[2432]     ← 登录界面 greeter，11:10:45 起，11:12:51 正常退出
   1321 gdm-x-session[3931]     ← 用户会话 Xorg（PID 3931），11:12:48 起
     69 gdm-x-session[75042]    ← 14:11 的 xkbcomp 子进程
     ... (其余为 xkbcomp 一次性子进程)
$ grep -E 'Server terminated' raw/boot-1-xsession-nvidia.txt
2026-09-20T11:12:51 ... gdm-x-session[2432]: (II) NVIDIA(GPU-0): Deleting GPU-0
2026-09-20T11:12:51 ... gdm-x-session[2432]: (II) Server terminated successfully (0). Closing log file.
2026-09-21T19:04:30 ... gdm-x-session[3931]: (II) NVIDIA(GPU-0): Deleting GPU-0
2026-09-21T19:04:30 ... gdm-x-session[3931]: (II) Server terminated successfully (0). Closing log file.
```
→ **整个 09-20 只有一个用户 X 服务器（PID 3931），从 11:12:48 一直活到 09-21 19:04:30（关机），中途没有重启。**

---

## 3. 任务②：包管理与驱动变更（09-19 ~ 09-21）

由独立取证分支完成，结论：**包层完全无罪**。详见 `evidence/pkg/FINDINGS-pkg.md`（1087 行）。

| 项 | 结论 | 证据 |
|---|---|---|
| 09-18/19/20 有无 dpkg 事务？ | **FAIL（无）** | `grep -oE '^2026-09-[0-9]{2}' /var/log/dpkg.log \| sort \| uniq -c` → 只有 `17 2026-09-21`、`21 2026-09-22`，**09-18/19/20 一行都没有** |
| nvidia/mesa/xserver/内核 在该窗口有无变更？ | **FAIL（无）** | `/var/log/dpkg.log.1`：`2026-08-10 16:34:31 install nvidia-driver-595-open:amd64 <none> 595.84-0ubuntu0.24.04.1` — **距今 41 天**；mesa `25.0.7→25.2.8`、libdrm `2.4.122→2.4.125`、内核 `6.14.0-27` 全部同为 **08-10 16:34** 的事务 |
| 窗口内仅有的 2 个事务 | 无关 | `chatgpt`（09-21 11:56:36）、`google-chrome-stable`（09-22 10:50:05），都是本地 `.deb` 安装 |
| 日志覆盖是否完整？ | **PASS** | `dpkg.log` 覆盖 `2026-09-01 16:49:00 → 2026-09-22 10:50:10`，无轮转空洞；`/var/lib/dpkg/status` mtime `09-22 10:50:10` 独立佐证 |
| unattended-upgrades | 结构性关闭 | `APT::Periodic::Unattended-Upgrade "0"` |
| snap | 无相关变更 | `snap changes` 仅 `firmware-updater`（09-22 10:07）；`mesa-2404_1839.snap` mtime `8月13日` |
| `journalctl -u unattended-upgrades` 09-19~09-21 | 空 | 无条目 |

**DKMS/版本对齐（当前）**：`dkms status` → `nvidia/595.84, 6.14.0-27-generic, x86_64: installed`；`/proc/driver/nvidia/version` → `595.84`；`modinfo nvidia` → `version: 595.84`（`/lib/modules/6.14.0-27-generic/updates/dkms/nvidia.ko.zst`）。**内核模块与用户态同为 595.84，无版本错配。**

> ⚠️ 一处需要标注但不构成窗口内事件的细节：`/usr/share/X11/xorg.conf.d/11-nvidia-offload.conf` 的 **btime = 2026-09-20 11:10:44.708**，而它的 mtime 是 `2026-09-22 10:02:20`（每次开机被 gpu-manager 重写，inode 保留故 btime 不变）。**目录项首次创建于 09-20 11:10:44**，即“换 GPU 的那次开机”——这是独立的第三重佐证（见 §4.3）。

---

## 4. 任务③：配置与状态变更

### 4.1 `~/.local/share/xorg/` 历史文件与 mtime——**找到跨越 17:18 的那份**

```
$ ls -la --time-style=full-iso /home/CNS2026495165/.local/share/xorg/
-rw-r--r-- 1 CNS2026495165 291556 2026-09-22 10:37:38.547583798 +0800 Xorg.1.log
-rw-r--r-- 1 CNS2026495165 100145 2026-09-21 19:04:30.953833220 +0800 Xorg.1.log.old
```

**★ 跨越 09-20 17:18 的那份 = `Xorg.1.log.old`**
- 内部时间 `[130.097]` = **2026-09-20 11:12:48** → `[114833.352]` = **2026-09-21 19:04:30**（约 31.9 h）
- 结束于 `(II) Server terminated successfully (0). Closing log file.` → **正常关机，非崩溃**
- 换算：17:18:00 ≈ uptime `[22034]`

**它在 17:18 处的内容：空的。** 整份日志的时间戳分布：

```
$ grep -oE '^\[ *[0-9]+\.[0-9]+\]' Xorg.1.log.old | awk '{b=int($1/1000)*1000; c[b]++} END{...}'
       0-     999  1064 行     ← 启动段（GPU/连接器初始化全部在此）
   10000-   10999    55 行     ← 14:11:19 鼠标重新插拔
  114000-  114999    69 行     ← 09-21 19:04:30 关机
$ awk -F'[][]' '{t=$2+0; if (t>600) print}' Xorg.1.log.old | head -40   # 全部 124 行都是 14:11 的鼠标
```
→ **`[10841.726]`（14:13）到 `[114833.230]`（09-21 19:04）之间，X 服务器没有输出任何一行。17:18 附近：零事件。**

### 4.2 该日志的 GPU / 连接器初始化段（原文，含行号）

```
435:[   130.831] (II) AMDGPU(0): Output HDMI-A-2 connected
439:[   130.831] (II) AMDGPU(0): Output HDMI-A-2 using initial mode 3840x2160 +0+0
505:[   130.856] (II) NVIDIA(G0): Virtual screen size determined to be 640 x 480
594:[   130.909] (II) AMDGPU(0): Setting screen physical size to 1016 x 571
 64:[   130.102] (--) PCI: (1@0:0:0) 10de:2684:10de:16f3 rev 161, Mem @ 0xdd000000/16777216, 0xf000000000/34359738368, ...
 65:[   130.102] (--) PCI:*(115@0:0:0) 1002:13c0:1458:d000 rev 193, Mem @ 0xf810000000/268435456, 0xde200000/2097152, ...
438:[        ] (--) AMDGPU(0): Chipset: "AMD Ryzen 9 9950X 16-Core Processor" (ChipID = 0x13c0)
    （AMDGPU(0) 连接器全表：[130.8xx] Output HDMI-A-1 disconnected / HDMI-A-2 connected /
      DisplayPort-3 disconnected / DisplayPort-4 disconnected）
    （NVIDIA(GPU-0) 连接器全表：DFP-0…DFP-6 **全部 disconnected**，91 行，0 行 connected）
    （NVIDIA(G0): Virtual screen size 640 x 480 = 该 GPU 无可用显示输出，MetaMode 为 NULL）
```

**注意 `*` 号（`(--) PCI:` 行）：`PCI:*(115@0:0:0) 1002:13c0` = 固件指定的 boot-VGA 设备是核显；4090（`1@0:0:0 10de:2684`）没有 `*`。**

### 4.3 `xorg.conf` / `xorg.conf.d` 与 mtime——**17:18 附近无任何改动**

```
（/etc/X11/xorg.conf 不存在）
/etc/X11/xorg.conf.d/
  -rwxr-xr-x 50      2026-05-09 18:09:15  99-TWatermarkExt.conf    ← Section "Module" Load "twatermarkext"
/usr/share/X11/xorg.conf.d/
  -rw-r--r-- 126  2024-04-09 00:23:24  10-amdgpu.conf            ← OutputClass AMDgpu / MatchDriver "amdgpu"
  -rw-r--r-- 206  2026-06-30 01:27:59  10-nvidia.conf            ← OutputClass nvidia / MatchDriver "nvidia-drm" / AllowEmptyInitialConfiguration
  -rw-r--r-- 1350 2025-06-11 02:21:45  10-quirks.conf
  -rw-r--r--  92  2024-04-09 00:23:28  10-radeon.conf
  -rw-r--r-- 149  2026-09-22 10:02:20  11-nvidia-offload.conf    ← 目录 mtime = 2026-09-20 11:10:44.708 / 该文件 btime = 2026-09-20 11:10:44.708
  -rw-r--r-- 1429 2025-03-24 11:43:48  40-libinput.conf
  -rw-r--r-- 3458 2024-04-09 00:22:51  70-wacom.conf
```
`11-nvidia-offload.conf` 内容（gpu-manager 自动生成）：
```
# DO NOT EDIT. AUTOMATICALLY GENERATED BY gpu-manager
Section "ServerLayout"
    Identifier "layout"
    Option "AllowNVIDIAGPUScreens"
EndSection
```
**该文件在 09-20 11:10:44 首次被创建**（目录 mtime 与 btime 同时刻）——即“显示器已不在 4090 上”的那次开机；此前 boot −2 不存在（那时 Xorg 用 `NVIDIA(0)` 作主屏，无需 offload ServerLayout）。

### 4.4 `monitors.xml`——**mtime 与 17:18 及 17:33:20 都无关（早 41 天）**

```
/home/CNS2026495165/.config/monitors.xml   mtime = ctime = 2026-08-10 17:09:02.328
  内容：1 个 logical monitor；<connector>HDMI-0</connector>（NVIDIA X 驱动命名）
        显示器 GSM / LG ULTRAFINE / 606NTUWJK582；3840x2160@60；scale 1.5；primary
  无 monitors.xml~ / 备份 / .config/monitors.xml.*（全 home find 均无）
  dconf user（10935 B）内 0 个 monitor/scale/connector/GPU 键
```
→ **GNOME 保存的显示器配置至今仍指向 NVIDIA 驱动的连接器名 `HDMI-0`**，且从未在 09-20 被改写 → **GNOME 侧没有观测到拓扑变化**（也说明该拓扑变化不是由桌面会话内的 RandR 操作产生的）。

### 4.5 gpu-manager 自己的裁决日志（`/var/log/gpu-manager.log`，当前 boot）

```
Vendor/Device Id: 1002:13c0
BusID "PCI:115@0:0:0"
Is boot vga? yes                 ← 核显 = 固件 boot VGA
Vendor/Device Id: 10de:2684
BusID "PCI:1@0:0:0"
Is boot vga? no                  ← 4090 不是
...
Found "/dev/dri/card2", driven by "amdgpu"
output 0:
	card2-HDMI-A-3
Number of connected outputs for /dev/dri/card2: 1
...
Does it require offloading? no
How many cards? 2
Has the system changed? No
AMD IGP detected
NVIDIA hybrid system
Creating /usr/share/X11/xorg.conf.d/11-nvidia-offload.conf
Setting power control to "auto" in /sys/bus/pci/devices/0000:01:00.0/power/control
```
`/var/lib/ubuntu-drivers-common/last_gfx_boot`（当前 boot 快照，mtime 09-22 10:02:20）：
```
1002:13c0;0000:73:00:0;1     ← boot vga = 1（是）
10de:2684;0000:01:00:0;0     ← boot vga = 0（否）
```
→ **gpu-manager 明确判定：核显 = boot VGA，4090 = 非 boot VGA，且 4090 的“已连接输出数 = 0”。**

---

## 5. 任务④：内核与设备状态（**4090 是否仍可用**）

### 5.1 当前绑定与电源状态

```
$ ls -d /sys/class/drm/*
card1-DP-1   disconnected disabled      card2-DP-4        disconnected disabled
card1-DP-2   disconnected disabled      card2-DP-5        disconnected disabled
card1-DP-3   disconnected disabled      card2-HDMI-A-2    disconnected disabled
card1-HDMI-A-1 disconnected disabled    card2-HDMI-A-3    connected    enabled     ← 唯一连接
                                        card2-Writeback-1 unknown      disabled

card1 → /sys/devices/pci0000:00/0000:00:01.1/0000:01:00.0   driver=nvidia   vendor/device=0x10de/0x2684  boot_vga=0  power_state=D0  enable=1
card2 → /sys/devices/pci0000:00/0000:00:08.1/0000:73:00.0   driver=amdgpu   vendor/device=0x1002/0x13c0  boot_vga=1  power_state=D0  enable=1
```
**4090：驱动已绑定（`nvidia`）、`power_state=D0`（上电）、`enable=1`、所有 4 个显示口 disconnected。**

### 5.2 内核模块与用户态

```
$ lsmod | grep -E 'nvidia|amdgpu|nouveau'
nvidia_uvm   2052096  0        nvidia_drm  139264  4       nvidia_modeset 1744896  3
nvidia      14807040  41  nvidia_uvm,nvidia_modeset         amdgpu 19714048  56
（无 nouveau）

$ cat /proc/driver/nvidia/version
NVRM version: NVIDIA UNIX Open Kernel Module for x86_64  595.84  Release Build  (dvs-builder@...)  Wed Jun 10 21:06:37 UTC 2026
$ ls /proc/driver/nvidia/gpus/
0000:01:00.0
$ cat /proc/driver/nvidia/gpus/0000:01:00.0/information
Model:           NVIDIA GeForce RTX 4090
IRQ:             129
GPU UUID:        GPU-139270b1-9df0-abe4-1c0c-ff2d2bf0037c
Video BIOS:      95.02.3c.00.02
Bus Type:        PCIe
DMA Size:        47 bits
DMA Mask:        0x7fffffffffff
Bus Location:    0000:01:00.0
Device Minor:    0
GPU Firmware:    595.84
GPU Excluded:    No
$ ls -la /dev/nvidia*
crw-rw-rw- 1 root root 195,   0  /dev/nvidia0
crw-rw-rw- 1 root root 195, 255  /dev/nvidiactl
crw-rw-rw- 1 root root 195, 254  /dev/nvidia-modeset
crw-rw-rw- 1 root root 508,   0  /dev/nvidia-uvm
crw-rw-rw- 1 root root 508,   1  /dev/nvidia-uvm-tools
$ ps -eo pid,lstart,cmd | grep nvidia
1572  二 9月 22 10:01:57  /usr/bin/nvidia-persistenced --user nvidia-persistenced --no-persistence-mode --verbose
```
**★ 决定性**：`/proc/driver/nvidia/gpus/0000:01:00.0/information` **能读出真实 GPU 数据**（GPU UUID / VBIOS / IRQ / DMA mask）——这需要内核模块（RM）与 GPU 实际通信成功 → **4090 没有掉卡，且内核态驱动链路健康。**

### 5.3 「4090 只是没接显示器」还是「用户态栈已损坏」——分项裁判

| 检查项 | 结果 | 判定 |
|---|---|---|
| PCI 设备存在 + 驱动绑定 | `0000:01:00.0` → `driver=nvidia`，`enable=1` | **PASS**（硬件在） |
| 电源/链路 | `power_state=D0`、`power/runtime_status=active`、`current_link_width=16` | **PASS** |
| 内核模块与 GPU 通信 | `/proc/driver/nvidia/gpus/*/information` 返回真实数据 | **PASS**（链路健康） |
| 设备节点 | `/dev/nvidia{0,ctl,-modeset,-uvm,-uvm-tools}` 齐全 | **PASS** |
| 内核模块版本 vs 用户态版本 | 内核 595.84 / `libnvidia-ml.so.595.84` / `nvidia-utils-595` 拥有 `/usr/bin/nvidia-smi` | **PASS（无错配）** |
| X 驱动可用性 | Xorg 已成功加载 `nvidia_drv.so` 并把 4090 作为 `NVIDIA(GPU-0)` GPU screen 初始化（生成过 MetaMode/640x480） | **PASS** |
| 显示输出 | DFP-0…DFP-6 全 disconnected（boots −1/−2/0 一致） | **只是没接显示器** |
| 是否有掉卡/复位/报错史 | boot −2/−1/0 中**无 Xid、无 NVRM error、无 reset、无 fallen off bus** | **FAIL（不存在）** |
| `nvidia-smi` / NVML | 报告 `Failed to initialize NVML: Unknown Error`（**本次未复现，故意不执行以免扰动态**） | **INCONCLUSIVE** |
| PCIe 链路速率 | `current_link_speed: 2.5 GT/s`（Gen1）@ width 16 | **观察项**：NVIDIA 空闲降频常见；boot −2 X 日志为 `Detected PCI Express Link width: 16X`。**建议在负载下复核，但本身不是损坏证据** |

**裁判：证据支持「4090 仍可用，只是没接显示器」；「用户态栈已损坏」不成立（内核态+GLX/DDX 均正常）。唯一未决的是 NVML/nvidia-smi 的失败，其根因需按 §8.③ 第 2 步的只读诊断序列定位。**

---

## 6. 关键新增证据：Firefox 遥测 ping 本体（决定 17:18 的性质）

### 6.1 文件位置与格式

```
/home/CNS2026495165/snap/firefox/common/.mozilla/firefox/g05ps3km.default/datareporting/archived/2026-09/*.main.jsonlz4
格式：mozLz40\0 + u32 原始长度 + LZ4 block（Firefox legacy Telemetry “main” ping 归档）
```
用自写 mozLz4 解码器（`raw/firefox-glean-gfx-timeline.txt` 为解码输出）得到 `environment.system.gfx.adapters[]`。

### 6.2 ★ 跨切换点的两份 ping（逐字原文）

**切换前最后一份（09-18）：**
```
file            : 1789724255661.50b4f9f9-...main.jsonlz4
creationDate(UTC): 2026-09-18T09:37:35.661Z   reason: aborted-session     (CST 2026-09-18 17:37:35)
gfx.features    : {"compositor":"webrender","hwCompositing":{"status":"available"},"gpuProcess":{"status":"unused"},
                   "webrender":{"status":"available"},
                   "wrCompositor":{"status":"blocklisted:FEATURE_FAILURE_WEBRENDER_COMPOSITOR_DISABLED"},
                   "openglCompositing":{"status":"available"}}
  adapters[0]: desc='NVIDIA GeForce RTX 4090/PCIe/SSE2' vendor=0x10de device=0x2684 driverVendor='nvidia/unknown' driverVersion='595.84.0.0'
  adapters[1]: desc=None                                vendor=0x1002 device=0x13c0 driverVendor=None             driverVersion=None
```

**切换后第一份（= 报告中的 17:18）：**
```
file            : 1789895923486.699f8b1a-...main.jsonlz4
creationDate(UTC): 2026-09-20T09:18:43.486Z   reason: environment-change  (CST 2026-09-20 17:18:43)
gfx.features    : （与上一份逐字节相同：compositor=webrender / gpuProcess=unused / wrCompositor=blocklisted）
  adapters[0]: desc='AMD Ryzen 9 9950X 16-Core Processor (radeonsi, raphael_mendocino, LLVM 20.1.2, DRM 3.61, 6.14.0-27-generic)'
               vendor=0x1002 device=0x13c0 driverVendor='mesa/radeonsi' driverVersion='25.2.8.0'
  adapters[1]: desc=None     vendor=0x10de device=0x2684 driverVendor=None driverVersion=None
```

### 6.3 由这份证据得到的四个硬结论

1. **`creationDate` 是 UTC**：`2026-09-20T09:18:43.486Z` = **CST 17:18:43**，与报告中的“17:18”精确吻合（文件名 ms 时间戳 `1789895923486` 同样解出 17:18:43）。**所以“17:18”= ping 的创建/上报时刻。**
2. **`adapters[]` 的“顺序”翻转了**，而不仅是首位内容变了：切换前 `[NVIDIA, AMD]`，切换后 `[AMD, NVIDIA]`；同时 ping 顶层 `gfx.vendorID/deviceID/driverVendor/driverVersion` 始终等于 `adapters[0]`（我逐条核对全部 9 月 main ping 成立）→ **`adapters[0]` = Firefox 认定的“活动 GPU”，它确实变了值。**
3. **这个翻转与 X 服务器“主屏 GPU”翻转完全同构**：boot −2 是 `NVIDIA(0)` 主屏 + `AMDGPU(G0)` 次屏 → Firefox 列 `[NVIDIA, AMD]`；boot −1/0 是 `AMDGPU(0)` 主屏 + `NVIDIA(GPU-0)` 次屏 → Firefox 列 `[AMD, NVIDIA]`。**机制解释：Firefox 在 X11 上按 X 服务器的 GPU/屏幕顺序枚举适配器，主屏排第一。**
4. **遥测本身有一段盲区，正好覆盖物理切换**：09-18 17:37:35 CST（`aborted-session`）之后，**下一份 main ping 就是 09-20 17:18:43**——中间 2 天 0 小时无任何 main ping。而机器是 09-18 17:42:05 关机、09-20 11:10:42 才开机。**因此“切换发生在 17:18”这一印象，是遥测盲区造成的归因假象。**

### 6.4 为什么不是 11:18（Firefox 当天首次启动）？——诚实标注

Firefox 在 boot −1 的首次启动是 **09-20 11:18:12**（`systemd[3776]: Started snap.firefox.firefox-19d95ada-...scope`，`firefox[9013]`），比 17:18:43 早 **6 h 00 m 31 s**；但 11:18 并没有发出 environment-change ping。

- 这表明 `reason=environment-change` 的 ping 是**由周期性的环境比对触发**，其时间戳是“**发现/上报**”时刻，**可以滞后于底层变更数小时**。
- **佐证该结论的独立证据**：9 月还有两份 `environment-change` ping——**09-12 18:28:51 CST** 与 **09-16 08:31:08 CST**——而这两次前后 `adapters[0]` **始终是 NVIDIA `0x10de/0x2684`（未变）**。→ **`environment-change` 这个 reason 与 GPU 无关，任何环境差异都会触发它；它的时间戳不能当作硬件事件时间。**
- **为什么恰好是 17:18:43**：本次取证**无法从 OS 层确定**（journal/X 日志在该时刻均为空）。候选：(a) Firefox 的环境周期比对首次在此时刻命中；(b) 触发因素是**非 GPU** 的环境差异，GPU 字段只是被一并刷新为当前值。两者都无法用 OS 日志区分 → **INCONCLUSIVE**（但无论哪一种，`adapters[0]=AMD` 的值都已经被 11:10 的开机解释）。

---

## 7. 时间轴重建（把症状与原因对齐）

| 时间（CST） | 事件 | 证据强度 | 来源 |
|---|---|---|---|
| 08-10 16:34 | nvidia 595.84 / mesa 25.2.8 / 内核 6.14.0-27 安装（最后一次 GPU 相关包变更） | 强 | `/var/log/dpkg.log.1` |
| 09-12 14:54:45 | boot −2 开机 | 强 | journal boot −2 |
| 09-12 14:54:50 | **`(--) PCI:*(1@0:0:0) 10de:2684`** = 固件 boot-VGA = **RTX 4090** | 强 | boot −2 Xorg |
| 09-12 14:54:51 | **`(II) NVIDIA(0): NVIDIA GPU ... RTX 4090 (AD102-A) at PCI:1:0:0`** = X 主屏 = 4090；`Detected PCI Express Link width: 16X` | 强 | boot −2 Xorg |
| 09-12 14:54:51 | **`(--) NVIDIA(GPU-0): LG Electronics LG ULTRAFINE (DFP-0): connected`** = 显示器接在 **4090 的 DFP-0** | 强 | boot −2 Xorg |
| 09-12 14:54:46 | `amdgpu 0000:73:00.0: [drm] Cannot find any crtc or sizes` = **核显当时无显示输出** | 强 | boot −2 kernel |
| ≤09-18 17:37:35 | 遥测 `adapters[0]` 一直 = NVIDIA `0x10de/0x2684` / `nvidia/unknown` 595.84 | 强 | 全部 9 月 main ping |
| **09-18 17:42:05** | **boot −2 最后一条日志（关机）** | 强 | `journalctl --list-boots` |
| **09-18 17:42:05 → 09-20 11:10:42** | **★ 物理/固件切换窗口（无日志、无遥测；机器断电约 1 天 17 小时）** | 强（由两侧边界反证） | 两侧边界 |
| **09-20 11:10:42** | **boot −1 开机** | 强 | journal boot −1 |
| 09-20 11:10:43 | `nvidia 0000:01:00.0: [drm] Cannot find any crtc or sizes` = **4090 此时已无显示输出** | 强 | boot −1 kernel |
| 09-20 11:10:44 | `nvidia-persistenced[1526]: device 0000:01:00.0 - registered`（**全程连续运行到 09-21 19:04:30**） | 强 | journal |
| 09-20 11:10:44.708 | `/usr/share/X11/xorg.conf.d/11-nvidia-offload.conf` **首次创建**（`AllowNVIDIAGPUScreens`） | 强 | inode btime + 目录 mtime |
| 09-20 11:10:45→11:12:51 | 登录界面 greeter X 会话（`gdm-x-session[2432]`），正常退出 | 强 | journal |
| 09-20 11:12:48 | **用户 X 会话启动（Xorg PID 3931，日志 = `Xorg.1.log.old`）** | 强 | inode btime + 日志 |
| 09-20 11:12:48 | **`(--) PCI:*(115@0:0:0) 1002:13c0`** = 固件 boot-VGA 已 = **核显** | 强 | Xorg.1.log.old |
| 09-20 11:12:48 | **`(--) AMDGPU(0): Chipset: "AMD Ryzen 9 9950X..."`** = X 主屏 = **核显** | 强 | Xorg.1.log.old |
| 09-20 11:12:48 | **`(II) AMDGPU(0): Output HDMI-A-2 connected` + `using initial mode 3840x2160 +0+0`** + EDID `GSM 5cbb / Serial# 631582` = 显示器已在**主板 HDMI** | 强 | Xorg.1.log.old |
| 09-20 11:12:48 | **`(--) NVIDIA(GPU-0): DFP-0…DFP-6: disconnected`（91 行，0 行 connected）** = 4090 全暗 | 强 | Xorg.1.log.old / journal |
| 09-20 11:18:12 | Firefox 当天首次启动（`firefox[9013]`）——**未发出 environment-change ping** | 强 | journal |
| **09-20 17:18:43** | **★ Firefox 遥测 main ping：`reason=environment-change`，`adapters[0]` = AMD `0x1002/0x13c0` `mesa/radeonsi 25.2.8.0`**（= 报告中的“17:18 切换”） | 强 | `1789895923486.*.main.jsonlz4` |
| 09-20 17:33:20 | 指纹解锁 + DING 重启 + stage 重布局（`gnome-shell[4195]` **PID 未变**，非 X 重启） | 强 | journal |
| 09-20 18:02 | apport/whoopsie 自动上报（另有 11:51 nautilus、15:09 python3.12 段错误，**与 GPU 无关**） | 中 | `/var/log/apport.log.2.gz` |
| 09-21 19:04:30 | boot −1 关机；`Xorg.1.log.old` 以 `Server terminated successfully (0)` 收尾，`Xorg.1.log.old` mtime 定格 | 强 | inode mtime |
| 09-22 10:01:55 | boot 0 开机；X 绑定与 09-20 **完全一致**（`PCI:*1002:13c0` / `AMDGPU(0)` / `HDMI-A-2 connected` / DFP 全 disconnected） | 强 | `Xorg.1.log` |
| 09-22 10:12:25 | 遥测再发 `environment-change`（boot 0 后） | 强 | ping 归档 |
| 09-22 | 用户报告“点设置/动效卡”（09-22） | — | 用户口述 |

**结论性对齐：**“活动 GPU 切换”的**实际生效时刻 = 2026-09-20 11:10:42（开机时即已成立）**；遥测**上报时刻 = 17:18:43**（滞后 6 h 08 m）；用户症状报告在 **09-22**（更晚）。**三者顺序：物理切换 → 遥测上报 → 症状报告。**

---

## 8. 裁决

### ① 09-20 17:18 附近最可能发生的事件是什么？

**判定：17:18 附近没有发生任何事件。** 该时刻最可能发生的是「**Firefox 完成一次周期性环境比对，把早已变化的 GPU 适配器顺序上报出去**」。

证据（均为强证据）：

1. **OS 层零事件**：journal 17:15–17:25 除 CRON/sysstat 外无任何条目（§2.3）；X 服务器日志在 `[10841.726]`(14:13) → `[114833.230]`(09-21 19:04) 之间**零输出**（§4.1）。
2. **时点归属**：ping 的 `creationDate = 2026-09-20T09:18:43.486Z` = CST 17:18:43，**它就是“17:18”这个数字的来源**（§6.3-1）。
3. **真正的变更在别处且已被证明**：boot −2 与 boot −1 的 boot-VGA / X 主屏 / 已连接连接器 / 内核 crtc 报错**四项同时翻转**，翻转点被夹在 09-18 17:42:05 与 09-20 11:10:42 之间（§7）。
4. **`environment-change` 不是 GPU 事件的同义词**：09-12 18:28 与 09-16 08:31 两份同 reason 的 ping，GPU 字段前后都是 NVIDIA（§6.4）。

**候选清单与证据强度**（按可能性排序）：

| # | 候选 | 证据强度 | 说明 |
|---|---|---|---|
| A | 17:18:43 = Firefox 周期环境比对命中，上报的 GPU 值反映**当天 11:10 开机后的既有事实** | **强** | 由 §6.3 + §2.3/§4.1 共同支持；唯一弱点是无法解释“为何恰好 17:18:43” |
| B | 17:18:43 由**非 GPU** 的环境差异触发，GPU 字段被一并刷新 | **中** | §6.4 已证明该 reason 与 GPU 无关；无法与 A 区分 |
| C | 17:18 发生了显示器/驱动层变更 | **被否证（极弱）** | 与 §2.3、§4.1、§4.4（monitors.xml 未改写）、§4.5（gpu-manager 判定沿袭）全部矛盾 |
| D | 17:18 发生 GPU 掉卡/hang/reset | **被否证** | boot −1 全程无 Xid/NVRM/reset/fallen off；`nvidia-persistenced` 连续在线 |

**无法定论部分（显式声明）**：**“为什么 Firefox 选在 17:18:43 上报”无法从 OS 层证据确定**——需要 Firefox 自身的 environment diff（`environment.previous`）才能区分 A 与 B。这属于遥测内部的调度逻辑，本报告的 OS 侧证据无法覆盖。

### ② 该切换是否是“用户症状出现”的合理解释？（只给时间对齐与机制，不下主观结论）

**时间对齐（客观事实）**：

- 物理切换生效：**09-20 11:10:42**
- 遥测上报：**09-20 17:18:43**
- 用户报告症状：**09-22**
- → **症状出现在切换之后（晚 1~2 天），顺序符合“改变在前、症状在后”。**

**机制（客观事实层面，全部可核验）**：

1. **渲染承担者变了**：桌面合成器（GNOME Shell 46.2 / mutter 46.2，X11）现在跑在 **Raphael 核显**上——`(--) AMDGPU(0): Chipset: "AMD Ryzen 9 9950X 16-Core Processor (ChipID = 0x13c0)"`，`glamor X acceleration enabled ... (radeonsi, raphael_mendocino, LLVM 20.1.2, DRM 3.61)`。此前（boot −2）跑在 `NVIDIA(0)` RTX 4090（`AD102-A`）上。
2. **可用显存量级不同**：核显 `[drm] amdgpu: 2048M of VRAM memory ready`（核显 carve-out 2 GB，`VRAM: 2048M`，`GART: 1024M`，`30942M of GTT`）vs 4090 `Memory: 25153536 kBytes`（约 24 GB）。§5 已证明 4090 现在仍可用但**未承担任何渲染**。
3. **像素负载相同但执行单元骤减**：显示仍是 3840×2160@60；而 `xrandr` 报 `Transform 1.333328`（把 5120×2880 后备面缩到 4K），且该 HDMI 为 TMDS 上限 300 MHz（`(--) AMDGPU(0): HDMI max TMDS frequency 300000KHz`）。缩放/合成/合成器重绘全部由 2-CU 核显承担。
4. **4090 侧的算力仍在但被“闲置”**：`11-nvidia-offload.conf` 只提供 `AllowNVIDIAGPUScreens`，即 4090 仅作 GPU screen（Sink Offload）；`nvidia-smi`/NVML 当前初始化失败，说明**即便想做 offload 卸载，用户态入口目前也是不通的**。
5. **重要负面证据（排除“驱动故障型”解释）**：boot −1/0 全程**无** Xid、**无** NVRM error、**无** GPU reset/hang、**无** `GPU has fallen off the bus`、**无** 驱动加载/卸载、**无** X 重启、**无** RandR 热插拔。→ 症状的机制**不是“GPU 出错/驱动崩溃/掉卡”**，而只可能是**“能效/算力容量下降”**这一类；日志里没有任何失败型事件可以支撑“故障”叙事。

**必须标注的边界**：以上仅说明「切换」构成了**时间上在后、机制上可解释**的上游条件（顶替的 GPU 算力低于原 GPU）。本报告**不判定**它是否就是症状的**原因**——那需要症状侧（合成器帧率/延迟）的量化数据，不属于本次取证范围。同时，**09-18 17:42 → 09-20 11:10 的关机空档内，“切换为何发生”（用户主动改线改 BIOS / 4090 输出故障后的规避动作）无法从本机日志区分** → 该点 **INCONCLUSIVE**。

### ③ 是否可以把显示切回 4090？（**只给方案，绝不执行**）

**核心判断：本机的 GPU 主从关系不是由某个软件配置项决定的，而是由「固件 boot-VGA 标志 + 显示器实际接在哪个 GPU 上」共同决定的**（`/var/lib/ubuntu-drivers-common/last_gfx_boot` → `1002:13c0;...;1` / `10de:2684;...;0`；gpu-manager `Is boot vga? yes/no`）。因此**纯软件层面没有“一键切回 4090”的开关**；真正的前置是**把显示器接回 4090**（和/或把 UEFI「初始显示输出」改为 PCIe/PEG）。

#### 前置健康检查（全部只读，按顺序做完再动手）

| # | 检查 | 判定标准 | 现状 |
|---|---|---|---|
| 1 | PCI 设备与驱动绑定：`lspci -nnk -s 01:00.0` | 出现 `Kernel driver in use: nvidia` | **已 PASS**（`/sys/.../0000:01:00.0/driver → nvidia`） |
| 2 | 内核能否与 GPU 通信：`cat /proc/driver/nvidia/gpus/0000:01:00.0/information` | 能读出 Model/UUID/VBIOS | **已 PASS**（见 §5.2） |
| 3 | 掉卡/复位史：`journalctl -b -1 -b -2 -b 0 \| grep -iE 'Xid\|fallen off\|NVRM\|reset'` | 无输出 | **已 PASS（无）** |
| 4 | 电源与链路：`cat /sys/bus/pci/devices/0000:01:00.0/power_state`、`current_link_width` | `D0` / `x16` | **已 PASS**；`current_link_speed=2.5 GT/s` 属空闲降频观察项，**建议在负载下复核** |
| 5 | **NVML 失败根因定位（必做，未完成）** | 见下方 5a–5e | **INCONCLUSIVE（本次故意未复现）** |
| 6 | `nvidia-drm.modeset` 是否 = 1 | `cat /sys/module/nvidia_drm/parameters/modeset` → `Y` | **UNAVAILABLE**（uid 1001 读该参数被拒；需 root） |
| 7 | 物理：4090 的哪个口可用、线材能力 | 接上后 `/sys/class/drm/card1-*/status` 变 `connected` | **待做**（当前 `card1-HDMI-A-1` / `card1-DP-1..3` 全 disconnected） |
| 8 | `monitors.xml` 是否会带来模式冲突 | 仍写着 NVIDIA 命名 `HDMI-0`（§4.4） | **待评估**：切回后 GNOME 会按它恢复 3840×2160@60/scale 1.5；若显示器/线材不支持该模式可能黑屏 |

**第 5 步（NVML）建议的只读诊断序列（不要动手改）**：
- 5a `dpkg -S /usr/bin/nvidia-smi` → 已确认属 `nvidia-utils-595`（595.84），**排除版本错配**；
- 5b 注意**同机并存 `nvidia-utils-590` 与 `nvidia-utils-595`、`nvidia-driver-590-open` 与 `-595-open`**（§5.2）——属潜在污染源，建议核对 `nvidia-smi`/`libnvidia-ml.so.1`/`libGLX_nvidia.so.0` 的实际解析路径是否全部指向 595.84；
- 5c `ls -l /dev/nvidia*` 与模块 `refcount` 对照，排查是否有残留 IPC/节点不一致；
- 5d 以 root 读取 `/proc/driver/nvidia/params`（尤其 `EnableGpuFirmware`、`PreserveVideoMemoryAllocations`）与 `/proc/driver/nvidia/warnings/*`；
- 5e 最后才考虑运行一次 `nvidia-smi`（**这是只读查询，但会初始化 GPU，可能触发 Xid 日志，故本次未做**）并同时抓 `journalctl -f`。

#### 切换方案（分步 + 每步回滚）

| 步 | 动作 | 前置 | 风险 | **回滚方式** |
|---|---|---|---|---|
| **S0** | **先备份**：`cp -a ~/.config/monitors.xml ~/.config/monitors.xml.bak-0922`；记录当前状态 `ls /sys/class/drm/*/status`、`journalctl -b -0` 尾部 | 无 | 无 | 删除新备份文件即可 |
| **S1** | **物理：把显示器线从主板 HDMI 改插到 4090 的输出口** | 关机（或确认不影响） | 低；若线材为 HDMI 而目标是 DP，需要转接 | **把线插回主板 HDMI**（这就是当前状态） |
| **S2** | （可选、若需 4090 作 boot-VGA）**进 UEFI 把「Initial Display Output / 初始显示输出」从 IGD/Auto 改为 PCIe/PEG** | 重启进 BIOS | 中：设错会黑屏（此时靠核显口仍可能出画面） | **进 BIOS 改回 Auto/IGD**；或断电后清 CMOS |
| **S3** | **开机后只读验证**：`cat /sys/class/drm/card1-*/status` 应出现 `connected`；journal 中 Xorg 应变为 `(--) PCI:*(1@0:0:0) 10de:2684` 且 `(II) NVIDIA(0): NVIDIA GPU ... RTX 4090` | S1/S2 完成 | 低 | 回到 S1 回滚 |
| **S4** | **若 X 仍以核显为主屏**：gpu-manager 会自动重判并可能改写/删除 `11-nvidia-offload.conf`（它标注 `DO NOT EDIT. AUTOMATICALLY GENERATED`）；**不要手改该文件**，让它自行跟随拓扑 | S3 已显示 4090 有连接输出 | 中 | **删除该文件 → 下次开机 gpu-manager 重新生成**（§4.3 已观察到它每开机重写） |
| **S5** | **若需要 4090 仅作渲染卸载（而非主屏）**：走 offload 路线（`AllowNVIDIAGPUScreens` 已就位），但**先解决 §8.③-5 的 NVML 失败**，否则用户态入口不通 | 第 5 步 PASS | 中 | 移除 `monitors.xml` 中引用 NVIDIA 连接器的配置（挪走文件 → GNOME 重新生成） |
| **S6** | **回归验证**：重跑 Firefox，确认遥测 `adapters[0]` 变回 `0x10de/0x2684`；`card1-*` 有 connected | S3/S4 | 低 | 反向执行上述回滚 |

**总体风险提示**：
- **最大风险是“切到 4090 却没有任何输出”**——当前 4090 的 `DFP-0..6` 全 disconnected，且 `nvidia-smi` 用户态不通。因此**必须先物理接线（S1），再谈任何软件/BIOS 变更**；顺序颠倒会造成无法显示。
- `monitors.xml` 至今引用 NVIDIA 连接器名 `HDMI-0`（§4.4）。切回后 GNOME 会按它恢复 `3840×2160@60 / scale 1.5`；若线材能力不足（当前 HDMI 链路 TMDS 上限 300 MHz）可能落在失败模式 → 事先备份（S0）即可一键回滚。
- 同机并存 **590 与 595 两代 NVIDIA 用户态包**，属既有潜在隐患，建议在切回前先按 5a–5b 理清。
- 以上均为**方案**，本次**未执行任何一步**。

---

## 9. PASS / FAIL / INCONCLUSIVE 总表

| 编号 | 检查项 | 判定 | 依据 |
|---|---|---|---|
| 1.1 | journal 是否可回溯到 09-20？ | **PASS** | 最早 2026-08-11 01:02:43；boot −1 覆盖 09-20 11:10:42→09-21 19:04:34 |
| 1.2 | 16:00–19:00 窗口是否有 NVIDIA/amdgpu 驱动加载或报错？ | **FAIL（无）** | 窗口内核消息仅 26 行，全部与 GPU 无关 |
| 1.3 | 是否有 DRM 连接器状态变化？ | **FAIL（无）** | 139 条 DRM/NVIDIA 消息全部落在 11:10–11:12，此后为零 |
| 1.4 | 是否有 Xorg 重启？ | **FAIL（无）** | 用户 X 服务器 PID 3931 自 11:12:48 活到 09-21 19:04:30；`last -F -x` 仅 1 条 `:1` |
| 1.5 | 是否有 `nvidia-persistenced`/`nvidia-smi` 失败记录？ | **部分 PASS**：`nvidia-persistenced` 全程健康（09-20 11:10:44 注册，09-21 19:04:30 退出）；**`nvidia-smi` 失败在 journal 中无任何记录** | 见 §5.2 |
| 1.6 | 是否有 GPU 掉卡 / hang / reset（`Xid`、`GPU has fallen off the bus`、`NVRM`）？ | **FAIL（无）** | boot −2/−1/0 全量 grep 无命中 |
| 1.7 | 17:18 附近是否有**任何**事件？ | **FAIL（无）** | 17:15–17:25 逐行全文仅 CRON/sysstat |
| 2.1 | 09-19~09-21 有包管理变更？ | **FAIL（无）** | dpkg.log 该日无任何行；覆盖完整 |
| 2.2 | 窗口内 nvidia/mesa/xserver/内核 变更？ | **FAIL（无）** | 最近一次为 08-10 16:34，距今 41 天 |
| 2.3 | `snap changes` 同段有相关变更？ | **FAIL（无）** | 仅 firmware-updater（09-22 10:07） |
| 2.4 | `journalctl -u unattended-upgrades` 09-19~09-21 | **FAIL（无条目）** | 且策略层已关闭 |
| 3.1 | `monitors.xml` mtime 是否落在 17:18 附近？ | **FAIL** | mtime = ctime = 2026-08-10 17:09:02（早 41 天） |
| 3.2 | `/etc/X11/xorg.conf*` / `xorg.conf.d/*` mtime 是否临近 17:18？ | **FAIL** | 最近 `99-TWatermarkExt.conf` = 2026-05-09；`xorg.conf` 不存在 |
| 3.3 | `xorg.conf.d` 中 nvidia/amdgpu 分配文件是否有 09-20 变更？ | **PASS（有，但在 11:10:44，非 17:18）** | `11-nvidia-offload.conf` btime = 2026-09-20 11:10:44.708 |
| 3.4 | 是否找到跨越 09-20 17:18 的 Xorg 日志并读取？ | **PASS** | `~/.local/share/xorg/Xorg.1.log.old`，mtime 2026-09-21 19:04:30 |
| 3.5 | 该日志在 17:18 有 GPU/连接器初始化或变更段？ | **FAIL（该处为空）** | `[10841.726]`→`[114833.230]` 之间零输出 |
| 4.1 | 4090 与核显的 `power_state`/`boot_vga`/驱动绑定 | **PASS** | 4090: nvidia / D0 / boot_vga=0；核显: amdgpu / D0 / boot_vga=1 |
| 4.2 | `lsmod` nvidia/nouveau/amdgpu | **PASS** | nvidia/nvidia_drm/nvidia_modeset/nvidia_uvm + amdgpu 均在；无 nouveau |
| 4.3 | `/proc/driver/nvidia/version` 与 `.../gpus/*/information` | **PASS** | 595.84；RTX 4090 / GPU UUID / VBIOS 均可读 |
| 4.4 | 「4090 仍可用只是没接显示器」vs「用户态栈已损坏」 | **PASS（前者成立）** | 见 §5.3；唯一例外：NVML |
| 4.5 | `nvidia-smi`/NVML 失败根因 | **INCONCLUSIVE** | 本次刻意未运行（只读纪律）；journal 无记录；已排除版本错配 |
| 4.6 | `nvidia_drm.modeset` 取值 | **INCONCLUSIVE / UNAVAILABLE** | sysfs 参数对 uid 1001 返回「权限不够」 |
| 4.7 | 是否有 PCIe 链路层错误（AER） | **UNAVAILABLE** | `dmesg` 受限（无输出）；journal 无对应条目 |
| 5.1 | 「17:18」是否等于遥测 ping 的创建时刻？ | **PASS** | `2026-09-20T09:18:43.486Z` = CST 17:18:43 |
| 5.2 | 遥测中活动 GPU 值是否真的变了？ | **PASS** | `adapters[0]` NVIDIA→AMD，且顶层 gfx 字段随 `adapters[0]` 变化 |
| 5.3 | 该翻转是否与 X 主屏翻转同构？ | **PASS** | boot −2 `NVIDIA(0)` ↔ 09-20 起 `AMDGPU(0)` |
| 5.4 | 物理切换发生在何时？ | **PASS（已定界）** | 09-18 17:42:05 → 09-20 11:10:42 之间；11:10:42 开机后即已成立 |
| 5.5 | 「为何恰好在 17:18:43 上报」 | **INCONCLUSIVE** | 需 Firefox `environment.previous` 才能区分候选 A/B |
| 5.6 | 切换的**动机/起因**（主动改线 vs 4090 输出故障规避） | **INCONCLUSIVE** | 关机空档无日志；但两侧证据显示 4090 至 09-18 17:42 一直健康 |

---

## 10. 明确**不可得**的信息（UNAVAILABLE）

1. **`/var/log/Xorg.*.log*` 完全不存在**（全盘 `find / -xdev -name 'Xorg*.log*'` 仅命中 `~/.local/share/xorg/` 两个文件）。X 日志只存在于用户目录与 gdm 私有目录。
2. **`/var/lib/gdm3/.local/share/xorg/`（登录界面 Xorg 日志）与 `/var/log/gdm3/` 权限拒绝**（`drwx--x--x root gdm`；本会话无 sudo）→ 仅能通过 journald 中 `gdm-x-session[2432]` 的转发内容间接取得。
3. **boot −2 的用户 Xorg 日志已被轮转覆盖**（`~/.local/share/xorg/` 只保留 `Xorg.1.log` 与 `Xorg.1.log.old`）→ **“显示器线何时从 4090 移到主板”的精确时刻无法直接读取**，只能用 09-18 17:42:05 / 09-20 11:10:42 两侧边界夹逼。
4. **`/var/log/auth.log`、`/var/log/btmp`、`/var/log/lastlog` 不可读或无内容**（auth.log 属 `syslog:adm` 且本会话非 adm 组成员对应用例；btmp 权限拒绝；lastlog 0 字节）→ 无法从登录审计侧补充 09-20 的会话细节。
5. **`dmesg` 输出为空**（受 `kernel.dmesg_restrict` 限制）→ PCIe AER / 底层错误只能依赖 journal 中已转发部分（结果：无）。
6. **`/sys/module/nvidia_drm/parameters/{modeset,fbdev}` 权限不够** → 无法确认 `nvidia-drm.modeset=1`（切回 4090 作 KMS 主屏的前置之一）。
7. **`/etc/nvidia/` 与 `/var/log/nvidia-installer.log` 不存在**（驱动由 apt/DKMS 安装，从未跑过 NVIDIA 官方安装器）→ 无安装器日志可查。
8. **09-18 17:42:05 → 09-20 11:10:42 的关机空档无任何日志、无遥测**（journal 与遥测双盲区）→ 「切换为何发生」与「是否在此期间动过 BIOS/线材」**不可回溯**。
9. **`journalctl -u unattended-upgrades` 在 09-19~09-21 无任何条目**（配合 `APT::Periodic::Unattended-Upgrade "0"` 判定为结构性关闭，而非日志丢失）。
10. **Firefox `environment.previous`（上一次环境快照）未读取** → 无法判定 17:18:43 那次 environment-change 的**触发差异项**究竟是不是 GPU 本身（候选 A vs B 无法区分）。
11. **未运行 `nvidia-smi`**（只读纪律下刻意避免初始化 GPU 以避免扰动/Xid）→ **NVML 失败的根因未复现、未定位**。
12. **未运行 `xrandr` / `xdpyinfo`**（禁触 X）→ 「X 侧 `HDMI-A-2`」与「sysfs `card2-HDMI-A-3`」的命名差异**未解释**（不影响 AMD-vs-NVIDIA 结论）。
13. **症状侧的量化数据（合成器帧率/延迟）不在本次范围** → 本报告**不对“切换是否导致症状”下因果结论**。

---

## 11. 复现命令与原始片段索引

### 11.1 原始片段（均在 `raw/`）

| 文件 | 内容 |
|---|---|
| `journal-0920-1600-1900.full.txt` | **09-20 16:00–19:00 全量 journal**（7736 行，short-iso-precise） |
| `boot-1-xsession-nvidia.txt` | boot −1 中 `gdm-x-session`/NVIDIA/amdgpu/drm 全部行（3099 行）= Xorg 日志经 journald 的转发 |
| `boot-2-gpu.txt` | boot −2（09-12→09-18）的 Xorg GPU 绑定与连接器状态（2233 行） |
| `firefox-glean-gfx-timeline.txt` | 9 月全部 `main.jsonlz4` ping 的 creationDate/reason/adapters 解码结果（219 行） |
| `pkg-01..09-*.txt` | apt/dpkg/snap/gpu-manager/xorg.conf.d/GRUB 原始摘录（由包变更分支产出） |
| `xorg-01..30-*.txt` | Xorg 日志与 wtmp/session 原始摘录（由 X 会话分支产出） |
| `evidence/pkg/FINDINGS-pkg.md` | 包/驱动/config 变更完整报告（1087 行） |
| `evidence/xorg/FINDINGS-xorg.md` | X 会话与显示器配置完整报告（965 行） |

### 11.2 关键复现命令

```bash
# ① journal 窗口 + GPU 相关
journalctl --no-pager -o short-iso-precise --since "2026-09-20 16:00:00" --until "2026-09-20 19:00:00"
journalctl -b -1 --no-pager -o short-iso --since "2026-09-20 16:00" --until "2026-09-21 00:00"
journalctl -b -2 --no-pager -o short-iso | grep -E '\(--\) PCI:\*|NVIDIA\(0\): NVIDIA GPU|DFP-0.*connected'

# ② X 日志经 journald 转发（本机 /var/log/Xorg*.log 不存在）
journalctl -b -1 --no-pager -o short-iso | grep -E 'gdm-x-session|NVIDIA\(GPU|AMDGPU\(0\): Output'

# ③ 跨越 17:18 的 X 日志本体（注意它在该处为空）
grep -nE '^\[ *[0-9]+\.[0-9]+\]' ~/.local/share/xorg/Xorg.1.log.old | \
  awk -F'[][]' '{t=$2+0; if (t>600) print}' | head
stat ~/.local/share/xorg/Xorg.1.log.old

# ④ 当前设备/驱动状态
for c in /sys/class/drm/card*; do echo "$c $(cat $c/status 2>/dev/null) $(cat $c/enabled 2>/dev/null)"; done
cat /proc/driver/nvidia/version /proc/driver/nvidia/gpus/0000:01:00.0/information
lsmod | grep -E 'nvidia|amdgpu|nouveau'
cat /var/lib/ubuntu-drivers-common/last_gfx_boot

# ⑤ 文件时间戳（切换定界的第三重证据）
stat /usr/share/X11/xorg.conf.d/11-nvidia-offload.conf     # btime = 2026-09-20 11:10:44
stat /home/CNS2026495165/.config/monitors.xml              # mtime = 2026-08-10 17:09:02
ls -la --time-style=full-iso /usr/share/X11/xorg.conf.d/

# ⑥ Firefox 遥测 ping（mozLz4 解码；解码器见 §11.3）
ls -la --time-style=full-iso \
  ~/snap/firefox/common/.mozilla/firefox/g05ps3km.default/datareporting/archived/2026-09/*.main.jsonlz4
```

### 11.3 mozLz4 解码要点

`archived/2026-09/<ms>.<uuid>.main.jsonlz4` 是 **Firefox legacy Telemetry 的 main ping** 归档：
`mozLz40\0` 魔数 + little-endian u32 原始长度 + **LZ4 block**（非 frame）压缩体。
解压后 JSON 结构：`{type,id,creationDate,version,application,payload{info{reason,...},...},clientId,profileGroupId,environment{system{gfx{adapters[],features{},...}}}}`。
**`creationDate` 为 UTC（`Z`）**；`environment.system.gfx.adapters[0]` = Firefox 认定的活动 GPU，顶层 `gfx.vendorID/deviceID/driverVendor/driverVersion` 与 `adapters[0]` 一致。

---

## 附：本次取证用到的两个二级 subagent

| 分支 | 负责范围 | 报告 | 产出 |
|---|---|---|---|
| 包/驱动/config 变更 | apt/dpkg/term.log、unattended-upgrades、snap、xorg.conf.d/monitors/GRUB mtime | 4 项判定：P1/P2/P3 FAIL、P4 PASS | `evidence/pkg/FINDINGS-pkg.md` + `raw/pkg-*.txt` |
| X 会话与显示器配置 | 全盘 Xorg 日志枚举、会话/wtmp 历史、monitors.xml/dconf、连接器热插拔 | X1 FAIL「无重启」、X2「绑定未变」、X3 PASS、X4 FAIL、X5 FAIL | `evidence/xorg/FINDINGS-xorg.md` + `raw/xorg-*.txt` |

两分支均为只读；关键结论（09-20 11:10 后 X 已在核显、无 17:18 事件、包层无罪、monitors.xml 早 41 天）与主 agent 独立取证**一致且相互独立**。
