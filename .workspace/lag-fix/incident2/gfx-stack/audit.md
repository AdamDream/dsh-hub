# gfx-stack audit — 图形栈 / snap Firefox / 合成器与输入 只读盘点

- **审计范围**：`/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/gfx-stack/`（独占）
- **方法**：**只读**系统检查。未重启/未 pkill/未改任何产品文件、未跑浏览器压测、未装包、**未使用 `sandbox_permissions`**。
- **原始输出**：同目录 `raw/`（`main-agent-core-raw.txt` + `firefox-*.txt` / `crossapp-*.txt`（35 个）+ `desktop-*.txt` / `input-*.txt`（37 个））
- **子报告**：`raw/firefox-crossapp.md`（snap Firefox + 跨应用证据）、`raw/desktop-input.md`（合成器 + 输入）
- **时间线**：boot 10:01:47 → Xorg 10:02:16 → Firefox 10:05:38 → dsh web 10:06:16 → 本轮审计 10:09 → 审计结束 ~10:40。**整个观测窗口都被并发审计负载污染**（见 §6）。
- 会话：Ubuntu 24.04.3 LTS / kernel 6.14.0-27-generic / Ryzen 9 9950X (16C/32T) / 60GiB / `XDG_SESSION_TYPE=x11` `DISPLAY=:1` / GNOME Shell **46.0**。

---

## 0. 总结论

> ## 判定：**FAIL** —— 本机**不具备**"稳定 60fps"的**前置条件**
>
> 不是说"已经测到掉帧"（没有帧时序 trace，见 §6 局限），而是：**这台机器已证明存在多处"每一帧都要多付代价"的配置缺陷，且渲染路径上有一个非原厂组件**，它们**对全部 X11 应用一视同仁**——这正好解释了"不只 DSH，Codex 界面同样卡"。
>
> 最关键三条（均为实测）：
> 1. **合成器渲染 5120×2880 再双线性缩到 3840×2160 输出** ⇒ 每帧多算 **1.78×** 像素 + 一次全屏重采样，而承载它的是**全机最弱的 GPU（AMD Raphael 核显，仅 2 个 CU）**；**RTX 4090 一张屏都没接**。
> 2. **企业 DLP 的 X Server 扩展 `twatermarkext` 已加载并注册进正在运行的 Xorg**（`xdpyinfo` 列出该扩展），即一个**厂商模块坐在每个应用像素的必经之路上**。
> 3. **`/etc/environment` 强制开启无障碍（a11y）**：`ACCESSIBILITY_ENABLED=1`、`GNOME_ACCESSIBILITY=1`、`GTK_MODULES=…:gail:atk-bridge`，导致 5 个进程带 `--force-renderer-accessibility` 运行——这是**已知的跨应用减速类**，Firefox/DSH 与 Electron/Codex 同样中招。

各分项判定见 §1–§5；证据表见 §7；最值得下一步验证的 3 条环境假设见 §8。

---

## 1. 图形栈盘点 —— 有无硬件加速 / 是否软渲染 / 驱动告警

### 判定

| 子问题 | 判定 | 一句话依据 |
|---|---|---|
| 本机是否有可用硬件加速 | **PASS** | Xorg 主屏 = `AMDGPU(0)`，`glamor X acceleration enabled on … (radeonsi, raphael_mendocino, LLVM 20.1.2, DRM 3.61)`，`DRI3 enabled`，`Acceleration enabled`，`AIGLX: Loaded and initialized radeonsi` |
| 是否在软渲染 | **PASS（否，未软渲染）** | X 服务器走 radeonsi/glamor；Firefox 自报 `mesa/radeonsi`（§2）。系统虽装了 `kms_swrast`/`llvmpipe`（`libdril_dri.so`），但**未被使用** |
| 有无 GPU 驱动告警 | **FAIL** | 显示管线报错 `REG_WAIT timeout … optc31_disable_crtc`；内核**无法解析显示器 EDID 的 CEA 扩展块**（6 次）；`workqueue … hogged CPU` 4 次 |
| 能否直接查询 renderer（glxinfo/vulkaninfo） | **INCONCLUSIVE（工具缺失）** | 两个命令**均未安装**，未安装（未装包）；renderer 结论由 Xorg 日志 + Firefox 自身崩溃元数据交叉得出 |

### 硬件拓扑（决定性）

```
01:00.0 VGA [10de:2684] NVIDIA AD102 GeForce RTX 4090   driver: nvidia      → /dev/dri/card1, renderD128
73:00.0 VGA [1002:13c0] AMD Raphael (iGPU)              driver: amdgpu      → /dev/dri/card2, renderD129
```
- **接显示器的只有 AMD 核显**：`card2-HDMI-A-3 = connected`（`enabled`），其余全部 `disconnected`/`disabled`，**`card1-*` 四个口全 disconnected**。
- 内核日志直接给出核显规格：`amdgpu 0000:73:00.0: amdgpu: SE 1, SH per SE 1, CU per SH 2, active_cu_number 2` ⇒ **仅 2 个 CU 的 RDNA2 核显**。
- `xrandr --listproviders`：Provider 0 = AMD `Source Output, Sink Offload`；Provider 1 = `NVIDIA-G0` `Sink Output`（**0 个已连接显示器**）。Xorg 日志：`NVIDIA(G0): Virtual screen size determined to be 640 x 480`、`nvidia-drm: Cannot find any crtc or sizes`。
- ⇒ **一块空闲的 RTX 4090 与一块 2-CU 核显，显示器接在核显上。** 合成器（Mutter）只能在核显上跑。

### 驱动告警（原文）

```
amdgpu 0000:73:00.0: [drm] REG_WAIT timeout 1us * 100000 tries - optc31_disable_crtc line:145   # 10:01:58 boot
[drm] Unknown EDID CEA parser results                                                          # ×6: 10:30:15(×2),10:30:36,10:32:15,10:34:02,10:34:19
workqueue: pm_runtime_work hogged CPU for >10000us {4,5,7} times, consider switching to WQ_UNBOUND  # 10:12:23,10:17:24,10:27:26,10:31:03
```
- `optc31_disable_crtc` = 显示控制器（OPTC）关 CRTC 时寄存器超时 ⇒ **显示引擎硬件未及时响应**（仅 boot 一次）。
- `Unknown EDID CEA parser results` = 内核**读不懂显示器的 CEA 扩展块**，且在每次连接器 re-probe 时复现（审计期间 6 次）。配合 `HDMI max TMDS frequency 300000KHz` 而实际模式需 **594MHz** 像素时钟 ⇒ **显示链路能力被报成 300MHz 上限，却跑着 594MHz 的 4K60 模式**（靠 FRL/DSC 之类）；链路协商可疑。
- `pm_runtime_work hogged` **不是 GPU**：amdgpu 明确 `Runtime PM not available`（子代理 A 核实），更可能是 `mt76` Wi-Fi worker。
- **无 GPU hang / 无 ring timeout / 无 GPU reset**（全内核日志零命中）⇒ 排除"GPU 卡死"。
- 非默认模块参数：`dcfeaturemask=2`、`ppfeaturemask=0xfff7bfff`；**不在 cmdline、不在 `/etc/modprobe.d/`** ⇒ 来源不明（INCONCLUSIVE）。

---

## 2. snap Firefox 专项 —— 是否是卡顿来源

### 判定：**NO**（snap Firefox **不是**卡顿来源；snap 封装本身被排除）

| 子问题 | 判定 | 依据 |
|---|---|---|
| 是否 snap 包 | **是（确认）** | `/snap/firefox/8863/usr/lib/firefox/firefox`；`snap/current -> 8863`；FF 155.0.1-1，mozilla 发布者；父进程 9042 在 gnome-shell 下 |
| GPU/沙箱限制是否存在 | **无限制** | `getfacl /dev/dri/renderD128` → `user:CNS2026495165:rw-`，对 **`renderD128`/`renderD129`/`card1`/`card2` 全部**成立；图形相关接口全 connected（`opengl`/`x11`/`wayland`/`desktop`/`hardware-observe`/`content[gpu-2404]`→`mesa-2404` rev1839）。6 个 disconnected 的 plug **全是非图形**（alsa/dbus/mpris/network-observe/password-manager/pcscd）。`graphics-core22` 缺席仅因 FF155 改用更新的 `gpu-2404` |
| 是否"软渲染/无 GPU 进程" | **否，硬件加速中** | Firefox **自身崩溃元数据**：`"AdapterVendorID":"0x1002","AdapterDeviceID":"0x13c0","AdapterDriverVendor":"mesa/radeonsi","AdapterDriverVersion":"25.2.8.0","GpuSandboxLevel":"0"` ⇒ WebRender 跑在 AMD 核显上；日志 `radeonsi_drv_video.so … va_openDriver() returns 0` ⇒ 沙箱内 VA-API 硬解可用 |
| 用户 prefs 异常 | **无** | `gfx.*` 用户 prefs **零条**（stock 默认）；两次崩溃是 OOM/IPC，非图形 |
| 读 `/proc/<pid>/environ` 取 `MOZ_*`/`LIBGL_*` | **INCONCLUSIVE（沙箱实测阻断）** | `/proc/9042/{environ,exe,cwd,root,fd,maps}` 对**文件属主本人也是 EACCES**（`ptrace_scope=1` + 非 dumpable），已改用 `meta/snap.yaml`、可读的 `gpu-2404-provider-wrapper` 与 snap mount namespace 替代取证 |

**结论**：Firefox 用的 GPU 路径与其它应用一致（同一块核显、同一 Mesa），**没有任何"Firefox 特有"的渲染劣势可以解释跨应用同症状**；它至多是这条共同路径上的又一个受害者。**把锅扣在 snap Firefox 上没有证据支持。**

---

## 3. 桌面合成器与输入

### 3.1 合成器 —— **FAIL（配置缺陷已证实）/ INCONCLUSIVE（"饱和"未证实）**

**已证实的配置缺陷：合成器每帧多做 1.78× 像素 + 一次全屏重采样**

```
xdpyinfo                : dimensions: 5120x2880 pixels (903x508 millimeters)   resolution: 144x144 dots per inch
xrandr --current        : Screen 0: minimum 320 x 200, current 5120 x 2880, maximum 16384 x 16384
                          HDMI-A-2 connected primary 5120x2880+0+0 … 600mm x 340mm
                          |__ 3840x2160  60.00*+        ← 该输出的实际模式
xrandr --verbose        : Transform: 1.333328 / 1.333328 / 1.000000     filter: bilinear
                          _MUTTER_PRESENTATION_OUTPUT: 0                  ← Mutter 拥有此变换
Xorg 日志                : (II) AMDGPU(0): Allocate new frame buffer 5120x2880
gsettings               : org.gnome.mutter experimental-features = ['x11-randr-fractional-scaling']
```
- 5120×2880 = 14.75 Mpx；3840×2160 = 8.29 Mpx ⇒ **多合成 1.78× 的像素**，再每帧做一次全屏双线性降采样（读 14.75 Mpx / 写 8.29 Mpx）。全部落在 **2 CU** 的核显上。
- 面板原生/首选模式是 **3840×2160@60.00**（EDID，10 条 modeline，`+preferred`）⇒ **5K 不是面板分辨率，5120×2880 是分数缩放造出来的合成帧缓冲**（子代理 B 独立得出同一结论）。
- **未解的不一致（INCONCLUSIVE）**：Mutter 报 `preferred_scale 1.5`、`~/.config/monitors.xml` 也写 `<scale>1.5</scale>`，但 X 侧实际比例是 **4/3**（若真按 1.5 应是 5760×3240）。且 `monitors.xml`（mtime **8月10日**，早于本次事件）记录的是连接器 **`HDMI-0`**（NVIDIA 命名风格），而实际连接器 X 名叫 `HDMI-A-2`、KMS 叫 `card2-HDMI-A-3` ⇒ **monitors.xml 与现行配置不匹配（部分匹配）**。
  - 该 4/3 变换的**来源无法定证**：(a) 用户/Mutter 分数缩放、(b) 陈旧 monitors.xml 派生的部分配置、或 (c) 并发审计探针调用 `xrandr` 的残留。**倾向 (a)/(b)**：`_MUTTER_PRESENTATION_OUTPUT` 表明 Mutter 拥有该变换，且 `x11-randr-fractional-scaling` 在用户 dconf 中、monitors.xml 早在 8/10 就已是分数缩放配置。

**"GPU 饱和"未能证实（重要修正）**：`gpu_busy_percent` **不可信** —— 子代理 B 的 15 次采样出现 `busy=0` 而 `sclk=2200MHz *`、以及 `busy=100` 而 `sclk=600MHz *` 的自相矛盾配对（采样序列 `0,74,69,0,0,94,0,0,100,61,0,99,0,0,99`，均值 39.7%），主代理的采样同样在 `100/0` 间跳。⇒ **不得据该指标宣称 GPU 饱和**；本条如实记为 INCONCLUSIVE。

**CPU 侧未饱和（排除 CPU 饥饿）**：gnome-shell **6.2–10.5%**（单核占比，pidstat 7,6,6,6,6）、Xorg **4–7%**（`/proc/<pid>/stat` 差值法，另一次 16s 窗口约 24%）；`/proc/pressure/cpu` 全 `avg10=0.00`、`full 0.00` ⇒ **无任务因等 CPU 而停顿**。`/proc/pressure/io` `avg300=0.08`、`memory` 全 0 ⇒ 亦非 I/O/内存压力。CPU governor = `performance`、5.67GHz、`amd-pstate-epp`、`k10temp 86.25°C`（未到 95°C 节流线）。

**Mutter 舞台视图分配失败（新发现，量级巨大）**
```
journalctl --user | grep -c "needs an allocation"   → 441883   (本次 boot: 3463)
9月22 10:02:19 gnome-shell[4139]: Can't update stage views actor panelBox [StBoxLayout] is on because it needs an allocation.
9月22 10:35:27 gnome-shell[4139]: Can't update stage views actor unnamed [MetaWindowActorX11] is on because it needs an allocation.
每分钟计数: 10:09=232 10:10=306 10:13=208 10:20=378 10:33=212 10:35=120 …  (自 10:02:19 起持续未间断)
```
- 涉及 `[StBoxLayout]` / `[Gjs_ui_panel_Panel]` / `[StBin]` / `[ShellTrayIcon]` / `[MetaWindowGroup]` / **`[MetaSurfaceActorX11]` / `[MetaWindowActorX11]`（= 每一个 X11 客户端窗口）** ⇒ **应用无关（app-agnostic）**，且形态与"跨应用同症状"吻合。
- **但它是症状还是病因未定**：无帧时序 trace，无法证明它导致掉帧。⇒ **INCONCLUSIVE**（子代理 A 同样只主张"机制存在"，未主张因果）。

其它：无屏幕录制/远程桌面/额外合成组件（`obs/kazam/vokoscreen/gnome-remote/vino/x11vnc/teamviewer/anydesk` 零命中）；**无 blur 类 shell 扩展**（仅 `ding@rastersoft.com`/`tiling-assistant`/`ubuntu-appindicators`/`ubuntu-dock` 四项 Ubuntu 默认，`gnome-extensions list` 全量确认）。`xlsclients` 21 个客户端，未见异常叠加层。

**已排除的一条疑点**：root 窗口 74 个子窗口中有一个**满屏 5120×2880 窗口** `0x200000a "@!0,0;BDHF"`（`_NET_WM_WINDOW_TYPE_DESKTOP`，`_NET_WM_PID=4856`）。经核对该名字的 `@!` 与 `BDHF` 字面量**都出自 DING 扩展自身源码**（`ding@rastersoft.com/emulateX11WindowType.js`、`app/desktopGrid.js:166`）⇒ **是 DING 正常的桌面窗口，不是 DLP 叠加层**。它确实为每帧多叠一层满屏 5120×2880 图层，但属 Ubuntu 标准行为。（`0x600007 "mutter guard window"` 5120×2880 亦为 Mutter 正常 guard window。）

### 3.2 输入 —— **NOT SUPPORTED**（高回报率+高 DPI 假设不成立）

| 设备 | VID:PID | 速度 | bInterval | 实际上限 |
|---|---|---|---|---|
| Logitech G502 HERO Gaming Mouse | `046d:c08b` | 12 Mbps (Full Speed) | `01` (Interrupt) | ≤1000 Hz |
| VGN DragonFly F1 SE Mouse | `3554:fb50` | 12 Mbps | `01` | ≤1000 Hz |
| SINOWEALTH VGN V87 V2 2.4G Dongle Mouse | `258a:027b` | 12 Mbps | `01` | ≤1000 Hz |

- **三只鼠标同时启用**（id 13/15/18），全部 **USB Full Speed ⇒ bInterval=1 = 1ms = 1000Hz**（若是 High Speed 才会是 8000Hz——已用 `/sys/bus/usb/devices/*/speed` 逐台确认是 12Mbps，故为 1000Hz 而非 8000Hz）。`usbhid mousepoll=0`（默认）。
- 显示器只有 **60Hz**；已知的"高回报率鼠标 + 高刷新 + 高 DPI 导致 hover/跟手动效掉帧"模式需要 **2000–8000Hz + 高刷**。⇒ **本假设 NOT SUPPORTED**。
- 无加速度/指针病态：libinput `Accel Profiles Available 1,1,1`、`Accel Profile Enabled 1,0`（flat）、`Accel Speed 0.000000`；Xorg 仅报 `Step value 0 was provided, libinput Fallback acceleration function is used`（libinput 常规回退）。`Accel Custom Fallback Step 0.000000`、`<no items>`。
- 未测活体事件率（`/dev/input/event*` 需 `input` 组，用户不在该组；不抓取输入设备以免干扰在用机器）。⇒ 该子项 INCONCLUSIVE，但**结论已由设备上限闭环**。

---

## 4. 同类第三方证据 —— 跨应用同症状的物证

### 4.1 Codex 客户端：**存在但当时未运行** ⇒ 活体无法复现（INCONCLUSIVE）

- 安装形态：`/usr/lib/chatgpt`（deb，Electron **v26.915.31945**，`UserDataDirectoryName=Codex`）。
- **审计时未运行**：最后活动 **2026-09-21 19:04**，`SingletonLock` 指向的 PID 已死 ⇒ **无法对它做活体插桩/复现**。
- **它不强制软渲染**：355MB `app.asar` 中唯一 `disable-gpu` 命中是一次**读取**：`hardwareAccelerationEnabled:!l.app.commandLine.hasSwitch('disable-gpu')`；`Local State` 记录 `"hardware_acceleration_mode_previous": True`。⇒ **不能把 Codex 的卡归因于它自己关了 GPU**。
- `Crash Reports/{attachments,completed,new,pending}` **全空**、无 `chrome_debug.log` ⇒ 无 GPU 进程历史（**"无记录"≠"无故障"**）。

### 4.2 `chrome trap int3` 证据被推翻（重要纠错）

- 共 **26** 条，时间 **10:11:41 → 10:31:54**，**全部晚于** dsh web 启动（10:06:16）与审计开始（10:09）。
- 全部来自 **Playwright 自带的 chromium / `chromium_headless_shell-1148`**，**不是桌面 Chrome**；且所有条目共享**同一偏移** `in chrome[56c322c,…]`（单一确定性 int3 点）。
- 同期有一个 **`gdb -q -batch -ex run –-args …/chrome`** 会话在跑（10:13:54 起，存活 ~1022s，覆盖 10:17/10:22 的 trap 时刻）。`segfault` 计数 **0**。
- ⇒ **这些 int3 是本轮审计自身工具链（Playwright + gdb）的产物，不是系统故障证据。**

### 4.3 ★ 跨应用同症状的**机器级机制**（两条独立候选，均实测"能力已证、激活程度未定"）

**(A) 企业 DLP 的 X Server 扩展 `twatermarkext` 已加载进正在运行的 Xorg**

```
/etc/X11/xorg.conf.d/99-TWatermarkExt.conf :
    Section "Module"
        Load "twatermarkext"
    EndSection
Xorg.1.log (用户 X :1，PID 3884) / journalctl gdm-x-session[3884] 10:02:17 :
    (II) LoadModule: "twatermarkext"
    (II) Loading /usr/lib/xorg/modules/extensions/libtwatermarkext.so
    (II) Module twatermarkext: vendor="My Vendor"
xdpyinfo → number of extensions: 31 … 最后一项:  twatermarkext        ← 已注册、客户端可见
libtwatermarkext.so strings :
    X.Org Server Extension / WatermarkExtension.c / AddExtension
    WatermarkExtInit [-----] Initializing MyExtension module
    WatermarkExtInit [=====] Extension %s successfully initialized
```
⇒ **一个厂商（"My Vendor"）自制的 X Server 扩展跑在 Xorg 进程内，位于"每个 X11 应用像素的必经之路"上**；并且**同时加载进 GDM greeter 的 X（PID 2661）与用户的 X（PID 3884）**（10:02:00 与 10:02:17），9/20 的会话同样如此。

配套常驻的 DLP/终端管控套件（`/usr/local/.OCular/`，root 777）：
- `libscreen.so` (9.2MB)、`libTWaterMark.so` (8.6MB)、`libXdgSnapshot.so`、`LWMHelper`、`LVncX11` / `LVncWayland` / `LVnctransfer`（VNC 远控）、`ContentMatch.so`、`FilezillaLogProcessor`、Windows 侧 `SetWindowsHookEx*.dll` / `WindowIM*`。
- 水印模板与策略：`/etc/.OCular/WaterMark/mswatermarktemplate.dat`（**mtime 9月21 17:52**）、`/etc/.OCular/watermark_guid.xml`（`WaterMarkTemplate` 为**非零 GUID**）、`policy.xml`、`Policy/`、`config.xml`。
- **加载了树外内核模块 `LSDEfs`**（`lsmod`: 7143424 bytes, refcount 1；`/etc/systemd/system/startLSDEfsSvr.service` → `Description=LMonitor`）。
- 服务实况：`startLSDEfsSvr.service` **active since 2026-09-22 10:01:58**，**Tasks: 357**，Memory 385.6M（peak 1.1G），CPU 22.368s。
- 会话级自启动：`/etc/xdg/autostart/LAgentUser.desktop`、`LSDHelper.desktop`；进程 `LAgentUser` **3.3→5.0% CPU**、`LSDHelper` **3.3% CPU**、`LMonitorFileOP` 0.3%。`LAgentUser` 链接 `libX11`+`libXext`，**不出现在 `xlsclients`** ⇒ 与"无窗口的截屏客户端"相容（能力已证）。
- 环境被企业管理：`/etc/environment` 带 `##TEC_BEGIN##`/`##TEC_END##` 供版标记。

**边界（必须诚实）**：**"水印此刻确实在画"未获证明**——DLP 自身日志（`/var/log/TecAgentLog/`）中 grep `watermark` 零命中，X 窗口树中**也没有找到 DLP 的叠加层窗口**（这恰恰与"X Server 内部扩展、不产生窗口"相容，见 §3.1 已排除的 DING 窗口）。⇒ **能力/存在性 PASS，激活程度 INCONCLUSIVE**。但它的形态正是"机器级、应用无关的每帧成本"。

**(B) 系统级强制开启无障碍（a11y）——已知的跨应用减速类**

```
/etc/environment :
    PATH=…
    ##TEC_BEGIN##
    export ACCESSIBILITY_ENABLED=1
    export GNOME_ACCESSIBILITY=1
    ##TEC_END##
/etc/environment.d/90atk-adaptor.conf : GTK_MODULES=${GTK_MODULES:+$GTK_MODULES:}gail:atk-bridge
/etc/environment.d/90qt-a11y.conf     : QT_ACCESSIBILITY=1
/etc/xdg/autostart/orca-autostart.desktop
```
- 后果：`at-spi-bus-launcher`(4054)、a11y 专用 `dbus-daemon`(4063)、`at-spi2-registryd`(4183)、`gsd-a11y-settings`(4262) 全部常驻；`busctl --user` 可见 `org.a11y.Bus`。
- **5 个在跑进程带 `--force-renderer-accessibility`**（如 `/usr/bin/bytedance-feishu-stable --force-renderer-accessibility`、`/opt/bytedance/feishu/feishu …`），另 2 个带 `--disable-renderer-accessibility`。
- 关键：用户自己的 a11y 偏好**全是 false**（`screen-reader-enabled=false`、`always-show-universal-access-status=false`、`a11y.keyboard enable=false`、`dwell-click-enabled=false`）⇒ **a11y 栈是被环境变量强开的，不是用户选择的**。`GTK_MODULES=…:gail:atk-bridge` 把 ATK 桥强制注入**每一个 GTK 应用**（GTK 版 Firefox、Electron 应用等都在内）。
- ⇒ **命中面 = 全部 GTK/Electron/Chromium 应用，与"跨应用同症状"完全吻合**；GTK a11y 桥 + Chromium/Electron 强制 accessibility + Firefox a11y 均为有记录的减速类。**激活已证（at-spi 在跑、flag 在进程上），量级未测 ⇒ INCONCLUSIVE。**

### 4.4 其它在跑/已装应用清单（供交叉参照）

`bytedance-feishu-stable`（`/opt/bytedance/feishu/feishu`）、WeChat/`WeChatAppEx`、`org.gnome.Nautilus`、`terminator`、`cc-switch`、`WebKitWebProcess`、`update-manager`(6.8% CPU)、`update-notifier`。审计自身的 Playwright `headless_shell` 使用 `--use-angle=swiftshader-webgl`（**软件渲染，不占核显**），故其负载不会污染 GPU 读数、但会占 CPU。
`/etc/ld.so.preload` **不存在** ⇒ 无全局库注入；`LAgentUser.sh` / `LSDHelper` 仅由 session autostart 拉起。

---

## 5. 逐条 PASS / FAIL / INCONCLUSIVE 汇总

| # | 检查项 | 判定 | 关键依据 |
|---|---|---|---|
| 1.1 | 有可用硬件加速 | **PASS** | `glamor X acceleration enabled … (radeonsi, raphael_mendocino, LLVM 20.1.2, DRM 3.61)`；`DRI3 enabled`；`Acceleration enabled` |
| 1.2 | 是否软渲染 | **PASS（否）** | X 走 radeonsi/glamor；Firefox 走 `mesa/radeonsi`；swrast 已装未用 |
| 1.3 | GPU 驱动告警 | **FAIL** | `REG_WAIT timeout … optc31_disable_crtc`；`Unknown EDID CEA parser results` ×6；`pm_runtime_work hogged` ×4（非 GPU） |
| 1.4 | GPU hang / ring reset | **PASS（无）** | 全内核日志零命中；`segfault` 0 |
| 1.5 | 直接 renderer 查询 | **INCONCLUSIVE** | `glxinfo`/`vulkaninfo` 未安装（未装包） |
| 1.6 | 非默认 amdgpu 参数来源 | **INCONCLUSIVE** | `dcfeaturemask=2`、`ppfeaturemask=0xfff7bfff` 不在 cmdline / modprobe.d |
| 2.1 | Firefox 是 snap 包 | **PASS（是）** | `/snap/firefox/8863/…`，`current → 8863`，FF 155.0.1-1 |
| 2.2 | snap 造成 GPU/沙箱限制 | **PASS（无限制）** | `getfacl` 对 4 个 drm 节点均 `user:CNS2026495165:rw-`；图形 plug 全 connected；6 个断开的都是非图形 |
| 2.3 | Firefox 软渲染 / 无 GPU 进程 | **PASS（否，硬加速）** | 自报 `radeonsi` + `GpuSandboxLevel:0`；`va_openDriver() returns 0`；`gfx.*` prefs 零条 |
| 2.4 | **snap Firefox 是否可能为卡顿来源** | **NO（排除）** | 与其它应用共用同一核显/Mesa，无 Firefox 特有劣势 |
| 2.5 | 读 Firefox live env/fd | **INCONCLUSIVE** | `/proc/9042/{environ,exe,maps,fd}` 对属主本人 EACCES |
| 3.1 | 合成器每帧像素开销 | **FAIL** | 合成 5120×2880 再双线性降采样到 3840×2160 = **1.78× 过绘 + 全屏重采样**，落在 2 CU 核显 |
| 3.2 | 合成器 CPU 饱和 | **PASS（未饱和）** | gnome-shell 6.2–10.5%、Xorg 4–7%（单核占比）；PSI cpu `avg10=0.00` |
| 3.3 | GPU 饱和 | **INCONCLUSIVE** | `gpu_busy_percent` 自相矛盾（`busy=0` 配 `sclk=2200*`；`busy=100` 配 `sclk=600*`），**指标不可信** |
| 3.4 | 缩放配置一致性 | **INCONCLUSIVE** | Mutter `preferred_scale 1.5` + monitors.xml 1.5 vs X 侧实际 4/3；monitors.xml 连接器 `HDMI-0` 与现行 `HDMI-A-2`/`card2-HDMI-A-3` 不匹配；4/3 变换来源未定 |
| 3.5 | Mutter 舞台视图分配失败 | **FAIL（缺陷存在）/ 因果 INCONCLUSIVE** | 441,883 条（本 boot 3,463，8–378/min），覆盖 `MetaWindowActorX11` 等**每个 X11 客户端** |
| 3.6 | 输入"高回报率+高 DPI"假设 | **NOT SUPPORTED** | 三只鼠标全 Full Speed 12Mbps ⇒ bInterval=1 ⇒ **≤1000Hz**；屏仅 60Hz（该故障类需 2000–8000Hz + 高刷） |
| 3.7 | 活体鼠标事件率 | **INCONCLUSIVE** | 需 `input` 组；为不干扰在用机器未抓取输入设备 |
| 3.8 | 屏幕录制/远控/额外合成组件 | **PASS（无）** | obs/kazam/vokoscreen/gnome-remote/vino/x11vnc/teamviewer/anydesk 零命中 |
| 3.9 | blur 类 shell 扩展 | **PASS（无）** | 仅 4 个 Ubuntu 默认扩展 |
| 4.1 | Codex 客户端存在性/配置 | **PASS** | `/usr/lib/chatgpt`，Electron 26.915.31945；不强制软渲染（`disable-gpu` 仅被读取） |
| 4.2 | 跨应用同症状活体复现 | **INCONCLUSIVE** | Codex 审计时未运行（最后活动 9/21 19:04），Crash Reports 全空，无 `chrome_debug.log` |
| 4.3 | `chrome trap int3` 作为故障证据 | **REFUTED** | 26 条全在审计开始后，全来自 Playwright chromium/headless_shell，同一偏移，同期有 gdb 会话 |
| 4.4 | DLP `twatermarkext` 装入 Xorg | **FAIL（已装入并注册）** | `99-TWatermarkExt.conf` + Xorg 日志 `Loading libtwatermarkext.so` + `xdpyinfo` 列出 `twatermarkext` |
| 4.5 | DLP 水印此刻是否真在绘制 | **INCONCLUSIVE** | DLP 日志无 watermark 命中；X 窗口树无叠加层（与"X 内部扩展无窗口"相容） |
| 4.6 | 系统强制 a11y | **FAIL（已强制开启）** | `/etc/environment` `ACCESSIBILITY_ENABLED=1`+`GNOME_ACCESSIBILITY=1`；`GTK_MODULES=…atk-bridge`；at-spi 常驻；5 进程带 `--force-renderer-accessibility` |
| 4.7 | 全局库注入（`ld.so.preload`） | **PASS（无）** | 文件不存在 |
| **5** | **环境是否具备稳定 60fps 的条件** | **FAIL** | 见 §0：多处"每帧多付代价"的已证配置缺陷 + 渲染路径上的非原厂 X 扩展；**但端到端帧时序证据缺失**（§6） |
| 6 | 第三方网络佐证（web search） | **INCONCLUSIVE（不可用）** | 本会话 web_search 返回 `An active OpenCode Go subscription is required to use Go models.` |

---

## 6. 混淆因素与局限（必须随结论一起读）

**A. 并发审计负载污染（最严重）**
- 观测窗口内始终有大量并发探针：6 个 Playwright `headless_shell`、`matrix.mjs`、`theme-open-ab.mjs`、`first-settings-probe.mjs`、`host-click-probe.mjs`、`raf-face-runner.mjs`、`host-drift.mjs`、`firstopen-batch.mjs` 等；`node dsh web` 85%、Firefox `Isolated Web Co` 26%+8.7%。
- 聚合 CPU ≈ **99%（约 3.1 核 / 32 核）**；`loadavg 6.05 5.68 4.66`；**线程 3,023–3,047**；`k10temp 86.25°C`。
- **但 PSI `cpu avg10=0.00`**（无 CPU 停顿）⇒ 审计负载**不足以**造成 CPU 饥饿型卡顿；它主要污染 (i) 任何 GPU 读数、(ii) Firefox 自身 CPU。
- 同行已提出正确的分离实验：**停掉全部探针 → 用户在 DSH 与自己的 Codex 上各试 10 秒 → 再放回负载重复一次**。这是唯一能把"审计负载造成的卡"与"应用自身的卡"分开的实验，建议优先采纳。

**B. 审计自身触发的显示链路扰动**
- Xorg 日志显示 `t=1952.589–1952.631s`（≈**10:34:48**）发生一次**完整 EDID/modeline 重探测**（75 次 `HDMI max TMDS frequency` 事件中的最后一簇），与 `Unknown EDID CEA parser results`（10:30:15/10:30:36/10:32:15/10:34:02/10:34:19）在时间上相关。
- 探针广泛调用 `xrandr`（含一次 18KB 的 `xrandr --verbose` 全量 dump）⇒ **re-probe 是可被审计自身触发的**，可能伴随瞬时模式重设/闪烁，**会污染"此刻是否卡"的观测**。

**C. 权限/工具局限（已如实标注，未越权）**
- 无 root：`/sys/kernel/debug/dri/*/amdgpu_pm_info` **EPERM** ⇒ 无法隔离"合成器 GPU 时间"。
- `/proc/<pid>/{environ,exe,cwd,root,fd,maps,fdinfo}` 对**属主本人也 EACCES**（`ptrace_scope=1` + 非 dumpable）⇒ 无法读 snap 环境、无法用 DRM `fdinfo` 做"逐进程 GPU 归因"、无法确认 DLP 是否被 dlopen 进合成器/浏览器。**这是本次最大的取证缺口**：`drm-engine-gfx` 归因法完全不可用。
- `glxinfo` / `vulkaninfo` 未安装；`dconf` 写入被拒（仅读成功，未改任何配置）。
- 未截图（不抓取用户私有屏幕内容；且 DLP 的 SafeDesk/截屏策略可能拦截或告警）。
- 全程未发信号、未 `systemctl` 动词、未 `snap refresh`、未启 GUI、未装包、未使用 `sandbox_permissions`。

---

## 7. 证据表（claim | command | observed | confidence）

| # | claim | command | observed（截断原文） | conf |
|---|---|---|---|---|
| E1 | 显示器接在核显，4090 空转 | `lspci -nnk \| grep -A3 -i vga`; `/sys/class/drm/*/status` | `01:00.0 … AD102 [GeForce RTX 4090] … Kernel driver in use: nvidia`；`73:00.0 … Device [1002:13c0] … amdgpu`；`card1-*` 全 disconnected；`card2-HDMI-A-3 = connected` | 高 |
| E2 | 显示 GPU 只有 2 个 CU | `journalctl -k \| grep active_cu_number` | `SE 1, SH per SE 1, CU per SH 2, active_cu_number 2` | 高 |
| E3 | 合成器渲染 5120×2880 后降采样到 4K | `xdpyinfo`; `xrandr --current --verbose` | `dimensions: 5120x2880 pixels (903x508 millimeters) resolution: 144x144`；`Screen 0: … current 5120 x 2880`；mode `3840x2160 60.00*+`；`Transform: 1.333328 … filter: bilinear`；`_MUTTER_PRESENTATION_OUTPUT: 0` | 高 |
| E4 | 面板原生即 4K@60（5K 是合成的） | EDID modeline 列表 / `desktop-panel-modes.txt` | `Modeline "3840x2160"x60.0 594.00 … (135.0 kHz eP)` 且 `+preferred`；`card2-HDMI-A-3` modes 首 10 条均 `3840x2160` | 高 |
| E5 | 分数缩放开关在用户 dconf 中 | `gsettings get org.gnome.mutter experimental-features` | `['x11-randr-fractional-scaling']` | 高 |
| E6 | monitors.xml 与现行配置不匹配 | `cat ~/.config/monitors.xml`; `ls -la` | `<connector>HDMI-0</connector> … <scale>1.5</scale> … <rate>60.000</rate>`；mtime `8月 10 17:09`（早于事件） | 高 |
| E7 | 硬件加速确实启用 | `grep glamor Xorg.1.log` | `(II) AMDGPU(0): glamor X acceleration enabled on …(radeonsi, raphael_mendocino, LLVM 20.1.2, DRM 3.61…`；`DRI3 enabled`；`Acceleration enabled` | 高 |
| E8 | 显示管线驱动告警 | `journalctl -k \| grep REG_WAIT` | `amdgpu 0000:73:00.0: [drm] REG_WAIT timeout 1us * 100000 tries - optc31_disable_crtc line:145`（boot 10:01:58） | 高 |
| E9 | 内核读不懂显示器 EDID CEA | `journalctl -k \| grep -i "Unknown EDID"` | `[drm] Unknown EDID CEA parser results` ×6（10:30:15→10:34:19） | 高 |
| E10 | HDMI 链路能力与所用模式矛盾 | `grep "max TMDS" Xorg.1.log` | `(--) AMDGPU(0): HDMI max TMDS frequency 300000KHz` vs 模式 `594.000MHz`；`Supported color encodings: RGB 4:4:4 YCrCb 4:4:4` | 中 |
| E11 | 无 GPU hang/reset | `journalctl -k \| grep -iE "ring .*timeout\|GPU reset"` | 无命中；`segfault` 0 | 高 |
| E12 | `gpu_busy_percent` 不可信 | `cat /sys/class/drm/card2/device/gpu_busy_percent` + `pp_dpm_sclk` 配对采样 | `busy=0 sclk=2200Mhz *`、`busy=100 sclk=600Mhz *`；序列 `0,74,69,0,0,94,0,0,100,61,0,99,0,0,99` | 高 |
| E13 | CPU 未饱和 / 无 CPU 停顿 | `cat /proc/pressure/cpu`; pidstat | `some avg10=0.00 avg60=0.00 avg300=0.00`；gnome-shell 7,6,6,6,6；Xorg 8,5,8,7,7 | 高 |
| E14 | Mutter 舞台视图分配失败 44 万次 | `journalctl --user \| grep -c "needs an allocation"` | `441883`；本 boot `3463`；`Can't update stage views actor unnamed [MetaWindowActorX11] is on because it needs an allocation.` | 高 |
| E15 | 三只鼠标 ≤1000Hz、屏 60Hz | `/sys/bus/usb/devices/*/speed` + `bInterval`; `xinput list` | `speed = 12 Mbps`（三台）→ `ep_81: bInterval=01 → 1000Hz`；G502 `046d:c08b`、VGN F1 SE `3554:fb50`、VGN V87 dongle `258a:027b` | 高 |
| E16 | snap Firefox 硬加速、无沙箱阻塞 | Firefox 崩溃元数据; `getfacl /dev/dri/*`; `snap connections firefox` | `"AdapterDriverVendor":"mesa/radeonsi","AdapterDriverVersion":"25.2.8.0","GpuSandboxLevel":"0"`；`user:CNS2026495165:rw-` 对 4 个 drm 节点；图形 plug 全 connected | 高 |
| E17 | Firefox `gfx.*` prefs 全默认 | `grep gfx ~/snap/firefox/…/prefs.js` | 零条 `gfx.*` | 高 |
| E18 | `chrome trap int3` 是审计产物 | `journalctl -k \| grep "trap int3"` + `ps` | 26 条全在 10:11:41–10:31:54（审计开始后），全为 Playwright chromium/headless_shell，同一偏移 `in chrome[56c322c,…]`；同期有 `gdb -q -batch -ex run … chrome` | 高 |
| E19 | Codex 客户端存在但未运行 | `ps`; `/usr/lib/chatgpt`; `Local State`; Crash Reports | Electron 26.915.31945；最后活动 2026-09-21 19:04，SingletonLock 已死；`"hardware_acceleration_mode_previous": True`；Crash Reports 全空 | 高 |
| E20 | DLP X 扩展装入 Xorg 并已注册 | `cat /etc/X11/xorg.conf.d/99-TWatermarkExt.conf`; `grep twatermarkext Xorg.1.log`; `xdpyinfo` | `Load "twatermarkext"`；`Loading /usr/lib/xorg/modules/extensions/libtwatermarkext.so`；`Module twatermarkext: vendor="My Vendor"`；`xdpyinfo` 31 个扩展末尾 `twatermarkext` | 高 |
| E21 | DLP 套件常驻 + 树外内核模块 | `ls -la /usr/local/.OCular/`; `lsmod`; `systemctl status startLSDEfsSvr` | `libscreen.so`/`libTWaterMark.so`/`libXdgSnapshot.so`/`LVncX11`/`LWMHelper`；`LSDEfs 7143424 1`；`Active: active (running) since … 10:01:58`，`Tasks: 357`，`Memory: 385.6M` | 高 |
| E22 | 水印模板已下发（激活未证） | `ls /etc/.OCular/WaterMark/`; `cat watermark_guid.xml` | `mswatermarktemplate.dat`（mtime 9月21 17:52）；`WaterMarkTemplate="…1A3E98D9A6AB7A4DBE7DC8BDCE645E2B…"`（非零 GUID）；DLP 日志 grep `watermark` 零命中 | 中 |
| E23 | 系统强制 a11y | `cat /etc/environment`; `/etc/environment.d/*`; `ps` | `##TEC_BEGIN## export ACCESSIBILITY_ENABLED=1 export GNOME_ACCESSIBILITY=1 ##TEC_END##`；`GTK_MODULES=…:gail:atk-bridge`；`QT_ACCESSIBILITY=1`；`at-spi-bus-launcher`/`at-spi2-registryd` 常驻；5 进程 `--force-renderer-accessibility` | 高 |
| E24 | 用户 a11y 偏好却是关的 | `gsettings get org.gnome.desktop.a11y.*` | `screen-reader-enabled=false`；`always-show-universal-access-status=false`；`a11y.keyboard enable=false`；`dwell-click-enabled=false` | 高 |
| E25 | 满屏 5120×2880 窗口来自 DING 本身 | `xprop -id 0x200000a`; `grep -rn "@!\|BDHF" ding…/` | `_NET_WM_PID=4856`，`WM_NAME="@!0,0;BDHF"`，`_NET_WM_WINDOW_TYPE_DESKTOP`；`emulateX11WindowType.js:28/40/41/130` 含 `@!`，`app/desktopGrid.js:166` 含 `BDHF` | 高 |
| E26 | 审计负载规模 | `ps`; `cat /proc/loadavg`; `ps -eLf \| wc -l` | 6× `headless_shell`、10+ 个探针 `.mjs`；聚合 ≈99%（≈3.1/32 核）；`loadavg 6.05 5.68 4.66`；3023 线程；`k10temp 86.25°C` | 高 |
| E27 | 审计自身触发 EDID 重探测 | `grep "max TMDS" Xorg.1.log` | 75 次事件，最后一簇在 `t=1952.589–1952.631s`（≈10:34:48） | 中 |

---

## 8. 最值得下一步验证的 3 条环境假设（按性价比排序）

### H1. DLP 的 `twatermarkext` X Server 扩展 / 驻留 DLP 代理在给每一帧加成本
**为何第一**：它是**唯一一个已被证实"装进了 Xorg 进程、坐在所有应用像素必经之路"**的非原厂组件，天然解释"跨应用同症状"；且形态上不可能被任何单应用侧的优化绕过。
**已证**：扩展已加载并注册（E20）；DLP 套件常驻 + 树外内核模块 + 357 任务（E21）；水印模板已下发（E22）。
**未证**：此刻是否真在绘制（E22 中 DLP 日志零命中；X 窗口树无叠加层——与"X 内部扩展不产生窗口"相容）。
**验证步骤**
1. **零成本首步（交给用户，不用任何工具）**：让用户**直接看屏幕**，确认是否存在**淡色重复水印**（企业水印通常是用户名/时间/主机名的半透明重复文字）。看得见 ⇒ H1 基本坐实。
2. 由具备 root 的人查 DLP 策略面：`/etc/.OCular/policy.xml`、`Policy/`、`Classinfo.xml`、`SDCfg_run.xml`，以及 `/var/log/TecAgentLog/Running/OCular_*.log` 中的水印启用记录。
3. **A/B（需 root + 重启 X，属变更操作，须用户/IT 授权，本审计未做）**：把 `/etc/X11/xorg.conf.d/99-TWatermarkExt.conf` 的 `Load "twatermarkext"` 注释掉并重启 X，在**相同**负载与同一交互脚本下对比帧时序。
4. 交叉确认扩展是否也为客户端可见/可查询：`xdpyinfo -ext twatermarkext`（只读）。

### H2. 5120×2880 合成帧缓冲 + 双线性降采样跑在 2-CU 核显上（每帧 1.78× 过绘）
**为何第二**：**唯一一个纯配置、用户可自行改、且量化效果最大（1.78× 像素 + 全屏重采样）**的缺陷；同时可顺带利用那块空转的 4090。
**已证**：5120×2880 合成 / 3840×2160 输出 / 双线性 / Mutter 拥有该变换（E3–E5）；核显仅 2 CU 且是唯一显示 GPU（E1–E2）。
**未证**：4/3 变换的来源（用户设置 vs 陈旧 monitors.xml vs 审计探针残留，§3.1）；以及它是否就是掉帧的主因（无帧时序 trace）。
**验证步骤**
1. 先把显示改成**原生 3840×2160 + scale 1.0**（或 clean 的 200%），**再**用同一交互脚本测帧时序；同时把 `~/.config/monitors.xml` 的陈旧 `HDMI-0` 条目清掉，消除"部分匹配"。
2. **物理实验（最高杠杆，用户可做）**：把显示器线从**主板 HDMI（核显）**改插到 **RTX 4090** 的 HDMI/DP 口，重启会话后复测。⇒ 合成器会改跑 4090，核显的 2 CU 瓶颈与"共享 DDR5 内存带宽"同时消失。
3. 若必须留在核显上：用 `DRI_PRIME=1` 把 Firefox 的渲染 offload 到 4090（合成器无法 offload，显示器接核显时 Mutter 只能在核显上合成）。

### H3. 系统级强制 a11y（`ACCESSIBILITY_ENABLED=1` / `GNOME_ACCESSIBILITY=1` / `GTK_MODULES=…atk-bridge`）在抬高每个应用的每帧成本
**为何第三**：**命中面最广且已被证明是"环境强制"而非用户选择**——ATK 桥注入每一个 GTK 应用、Chromium/Electron 被逼进 accessibility 模式，正好覆盖 Firefox/DSH 与 Codex 两端；属有记录的跨应用减速类。
**已证**：环境变量与 `GTK_MODULES` 强制注入、at-spi 常驻、5 进程 `--force-renderer-accessibility`（E23），而用户 a11y 偏好全为 false（E24）。
**未证**：量级（未测）。
**验证步骤**
1. Firefox 内把 `accessibility.force_disabled=1`，重启 Firefox，对比"点设置"的帧时序（应用内可测，不需要 root）。
2. 观察 Electron/Chromium 渲染进程上的 `--force-renderer-accessibility` 是否随环境变量消失（该 flag 与 `GNOME_ACCESSIBILITY` 的因果关系可由一次环境变量受控启动验证）。
3. **A/B（需 root + 重新登录，属变更操作，须授权）**：注释掉 `/etc/environment` 中 `##TEC_BEGIN##…##TEC_END##` 块（先与 IT 确认合规——这是企业管控项），重登后复测；期间保持审计探针**关闭**，否则无法归因。

---

## 9. 给主代理的可执行建议（一句话）

先把探针全停、用用户自己的 10 秒交互把"审计负载"与"应用固有卡"分离；同时**让用户抬头看一眼屏幕有没有水印**（H1 的零成本判据），并把显示器线从主板 HDMI 改插到 4090、把缩放从 1.3333 改回原生 1.0 各做一次复测（H2，纯配置、收益最大）。
