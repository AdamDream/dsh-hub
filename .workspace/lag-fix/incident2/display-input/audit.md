# 输入/显示链路取证审计 — incident2 / display-input

- 工作线独占目录：`/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/display-input/`
- 原始输出：`raw/display-chain-raw.txt`（本线显示链路，258 行）、`raw/input-*.txt`（输入链路，次级 subagent）、`page/raw/*.json`（页内成本模型，次级 subagent）
- 纪律遵守声明：**全程只读观测**。未执行任何 `xrandr` 写操作、`gsettings set`、`dconf write`、`pkill`/`kill`、服务重启；未修改任何显示或输入设置；未传 `sandbox_permissions`。浏览器仅在独立实例 + `.lock` 锁协议下由次级 subagent 启动（见 `page/`）。
- **限制**：`web_search` 工具在本会话不可用（上游订阅报错），因此"已知问题文献对照"一项**未做**，结论全部基于本机实测。

---

## 0. 结论速览（逐条判定）

| # | 审计项 | 判定 |
|---|---|---|
| 1 | 会话类型（Wayland/X11） | **PASS（事实明确）**：**X11**，非 Wayland |
| 2 | 显示器型号与**实际刷新率** | **PASS**：LG ULTRAFINE（GSM，27" 4K 面板），**实际 3840x2160@60.00Hz** |
| 3 | 是否被限制到 60Hz/30Hz | **FAIL（存在限制，且 60Hz 是硬上限）**：EDID 垂直刷新范围 40–60Hz，无 >60Hz 模式可选 |
| 4 | 缩放因子 / DPR / 分辨率 | **FAIL（关键）**：GNOME scale **1.5** → **逻辑 2560x1440 @ DPR 2.0**，渲染面 **5120x2880**，再重采样到 3840x2160 |
| 5 | GPU 是否在驱动合成 | **PASS（但这正是问题）**：合成由 **AMD Raphael 核显**驱动（glamor/radeonsi），**RTX 4090 未参与显示** |
| 6 | 输入设备与回报率 | **FAIL（存在高回报率设备）**：**Logitech G502 HERO** 等 3 个指针设备均 `bInterval=1ms`（**1000Hz 能力**），内核 `usbhid mousepoll=0` 不节流 |
| 7 | 是否存在输入事件洪流 | **PARTIAL（移动时高、静置无）**：移动时 **~200–370 事件/s**（XI2 322/s、G502 xHCI IRQ 367/s、XQueryPointer 206/s **三路互证**，是 125Hz 办公鼠标上限的 1.6–2.9 倍）；**静置时 1–3 IRQ/s ≈ 0**，事件率与手部位移严格成比例 |
| 8 | 跟手动画成本模型（页内） | **PASS —— 开销可忽略**：**1.2–18.3 ms / 1000 事件**（最坏"每事件重排"）；@1000 事件/s 仅占 **1.4% CPU / 0.23 ms 单帧预算**；**4000 事件/s + 每事件强制布局下仍 0 丢帧**（见 §3） |
| 9 | **输入/显示链路是否是卡顿来源** | **FAIL（是）—— 但归因必须修正**：**输入事件率已被数据否定为主因**（§3）；**显示/合成链路的"像素预算"被放大到 1.78 倍才是主因**（§1.4 + §3.3 面积定律），叠加 **mutter 合成器级缺陷**（§4.1 第 5b 项）。**不是 DSH 独有**（§4.2） |

**一句话**：这台机器把"跟手动画"的成本结构本身推高了 —— **GNOME 分数缩放 1.5 让 mutter 以 DPR 2.0 渲染 5120x2880（14.75 Mpx），再双线性重采样到 3840x2160@60；这块 5K 合成全部落在 AMD Raphael 核显上（RTX 4090 闲置不驱动显示）**，同时 mutter 还在持续报 stage-view 分配失败。**决定性对照**：同一份跟随鼠标的动效，720p 下 **60fps/0 丢帧**，5120x2880 下 **44fps/26.4% 丢帧**，而两者单帧 JS 工作量都只有 **0.1–0.2 ms** ⇒ **瓶颈在像素呈现/合成侧，不在事件处理侧**。用户确实在用 **1000Hz 回报率鼠标（实测 322 事件/s）**，但被否定为主因。

---

## 1. 显示链路

### 1.1 会话类型 —— PASS（X11）
```
XDG_SESSION_TYPE=x11   DISPLAY=:1   WAYLAND_DISPLAY=(空)
XDG_CURRENT_DESKTOP=ubuntu:GNOME   GDMSESSION=ubuntu
loginctl: Type=x11 Active=yes Remote=no
Xorg: /usr/lib/xorg/Xorg vt2 -displayfd 3 -auth /run/user/1001/gdm/Xauthority
```
⇒ 不是 Wayland，**不存在**"Wayland 合成器 vs X11"的切换差异；也没有 XWayland 间接层。整条链路是 `Xorg (amdgpu DDX, glamor) + gnome-shell/mutter 合成器`。
（原始：`raw/display-chain-raw.txt` §1）

> 备注：`~/.config/monitors.xml` 里记录的是 **`<connector>HDMI-0</connector>`**（NVIDIA 命名习惯），而当前实际输出是 AMD 的 **`HDMI-A-2`**，且 Xorg 日志显示 `Output HDMI-A-2 using initial mode`。GNOME 靠 monitorspec（vendor/product/serial）匹配，因此这条配置仍然生效 —— 但**说明该配置是在显示器曾挂在 NVIDIA 卡上时生成的**，如今整条显示链路已经落到核显上（见 §1.5）。

### 1.2 显示器型号 —— LG ULTRAFINE（27" 4K）
```
xrandr: HDMI-A-2 connected primary 5120x2880+0+0  600mm x 340mm
Xorg:  AMDGPU(0): Monitor name: LG ULTRAFINE
Xorg:  EDID vendor "GSM", prod id 23739
EDID 描述符: Name="LG ULTRAFINE"  Serial="606NTUWJK582"  （GSM = LG Electronics）
```
物理尺寸 600x340mm ⇒ 对角约 27"、16:9。EDID 首选（native）时序实测为
```
Modeline "3840x2160"x60.0  594.00  3840 4016 4104 4400  2160 2168 2178 2250 +hsync +vsync (135.0 kHz eP)
```
⇒ 594.00 MHz / (4400×2250) = **59.99… ≈ 60.00Hz**，且这是 **eP（preferred/native）** 时序，即面板的原生模式就是 **3840x2160@60**，不是 5K。**"5120x2880"是 GNOME 造出来的渲染面，不是面板分辨率**（见 §1.4）。

### 1.3 实际刷新率与被限制情况 —— FAIL（硬上限 60Hz）
```
xrandr --current:  HDMI-A-2 ... 3840x2160  60.00*+  50.00  59.94  30.00  25.00  24.00  29.97  23.98
                                          ^^^ 当前生效模式
```
- **当前生效：3840x2160 @ 60.00Hz**（`*` = current，`+` = preferred）。
- 4K 档位里**没有任何 >60Hz 的模式**；EDID 的 monitor-range-limits 描述符（`0xFD`）解码为 **垂直 40–60Hz、水平 30–155kHz** ⇒ **面板本身就不支持 60Hz 以上**。
- Xorg: `HDMI max TMDS frequency 300000KHz` ⇒ HDMI 链路带宽已到顶，5K@60 在物理上也不可能（这也解释了为什么没有 5120x2880 模式可选）。
- `vrr_capable: 0` ⇒ **无 VRR/FreeSync**，`TearFree: auto`。
⇒ 判定：**不是"被误设成 30Hz"**（30Hz 模式存在于列表但未启用），而是**天花板就是 60Hz，且当前确实跑在 60.00Hz**。60Hz ⇒ 帧预算 16.67ms。

### 1.4 缩放因子 / DPR / 分辨率 —— FAIL（关键项，这是本审计最重的环境发现）
**GNOME 侧配置**（`~/.config/monitors.xml`，权威）：
```xml
<scale>1.5</scale>
<monitor><mode><width>3840</width><height>2160</height><rate>60.000</rate></mode></monitor>
```
**X 侧实况**：
```
xdpyinfo:  dimensions: 5120x2880 pixels (903x508 millimeters), resolution: 144x144 dots per inch
xrandr:    HDMI-A-2 connected primary 5120x2880+0+0
           Transform: 1.333328 0.000000 0.000000 / 0.000000 1.333328 0.000000   filter: bilinear
xrdb:      Xft.dpi: 192            Xcursor.size: 48
xprop:     _NET_DESKTOP_GEOMETRY = 5120, 2880
           _NET_WORKAREA         = 132, 64, 4988, 2816
Xorg:      AMDGPU(0): Allocate new frame buffer 5120x2880
gnome-shell actor: 0x200000a "gjs" 5120x2880+0+0
实验特性:  org.gnome.mutter experimental-features = ['x11-randr-fractional-scaling']
```

**自洽推导（三路独立互证，结论一致）**：

| 推导路径 | 计算 | 结果 |
|---|---|---|
| 逻辑尺寸（应为整数） | `CRTC mode / scale = 3840/1.5 × 2160/1.5` | **2560×1440**（整数 ✔；若 DPR=1.5 则 5120/1.5=3413.33 非整数 ✘） |
| 应用 DPR | `Xft.dpi / 96 = 192/96` | **2.0** |
| 工作区反推 | `_NET_WORKAREA 4988x2816 ÷ 2 = 2494x1408`；+ 左侧 66（Ubuntu Dock）+ 顶栏 32 = **2560x1440** | **DPR = 2.0** ✔ |
| 光标尺寸 | `cursor-size 24 × DPR 2 = 48 = Xcursor.size` | **DPR = 2.0** ✔ |

⇒ **逻辑分辨率 2560×1440，应用侧 devicePixelRatio = 2.0**（`Xft.dpi=192` 是 GNOME 给 X11 工具链的权威信号）。

**渲染管线（关键）**：
```
  逻辑桌面 2560x1440  (CSS px, GNOME scale=1.5)
        │  mutter 以整数 scale 2.0 渲染 = ceil(1.5)
        ▼
  合成帧缓冲 5120x2880  = 14.75 Mpx   ← X screen / 所有窗口的光栅面
        │  xrandr Transform scale 1.3333 + bilinear  (= 2.0/1.5)
        ▼
  CRTC 输出 3840x2160@60 = 8.29 Mpx   ← 真正送进 HDMI 的像素
        │
        ▼
  面板 3840x2160@60（原生 = 输出，无面板端缩放）
```

**量化后果（这是"跟手"卡顿的直接成本来源）**：
- 合成渲染面 **14.75 Mpx**，而真正传输的只有 **8.29 Mpx** ⇒ **同一块受损区域要多光栅化 1.78 倍（+78%）的像素**，并在呈现前多经一次 **5120x2880→3840x2160 的双线性重采样**。（限定：mutter 有 damage tracking，合成不会每帧重画整屏，因此该 1.78× 倍数作用于**每个被重绘的受损区域**；一旦动画覆盖面很大——例如全窗口的托盘展开/波纹——受损区域就接近整屏，此时 1.78× 便是整屏级开销。）
- 60Hz 下：**884.7 Mpx/s 渲染 + 497.7 Mpx/s 传输**（对比：若 scale 取整数，渲染=传输，可直接省掉 1.78 倍填充率与整个重采样 pass）。
- 应用侧因为 DPR=2.0，**所有 CSS 像素按 4 倍面积光栅化**。实测客户端是 **Firefox（snap）**，出问题的 DSH GUI 窗口为
  `0x4c00017 "… — DeepSeek Harness — Mozilla Firefox" 3344x2862+1528+34` ⇒ 在 DPR 2.0 下 CSS 视口约 **1672×1431**，但**每次全窗重绘要光栅化 9.57 Mpx**（≈1080p 一帧的 4.6 倍）。
- 结论：**"光标移到某处就展开的托盘"和"跟随鼠标的波纹"这两类"大面积重绘 + 每帧变形"的动画，恰好是这条管线最贵的负载形态**（面积 × DPR² × 60Hz，外加合成重采样）。

> 重要限定（不夸大）：`Transform` 的重采样究竟由**显示控制器硬件缩放器**完成还是由 **GPU 一遍 render pass** 完成，本次只读查询**无法判定**（需要 GPU trace / dc 调试接口，均需 root）。因此我把"重采样成本"列为**未量化的额外项**；而"渲染面 14.75 Mpx、DPR 2.0、60Hz"这三项是**确定的、可复算的**，已经足以构成 1.78 倍的确定填充率放大。

### 1.5 GPU 是否在驱动合成 —— PASS（由核显驱动，这是放大器）
```
lspci: 01:00.0 NVIDIA AD102 [RTX 4090]   |   73:00.0 AMD [1002:13c0] (Raphael 核显)
/sys/class/drm: card1 -> nvidia (0000:01:00.0, boot_vga=0)
                card2 -> amdgpu (0000:73:00.0, boot_vga=1)   ← 启动/主 GPU
连接器: card2-HDMI-A-3 = connected（amdgpu 侧）  ← 显示器挂在核显上
xrandr --listproviders:
  Provider 0: AMD Ryzen 9 9950X ... @ pci:0000:73:00.0  cap: Source Output, Sink Offload  crtcs:4 outputs:4
  Provider 1: NVIDIA-G0                                  cap: Sink Output                 crtcs:4 outputs:7
Xorg log: AMDGPU(0): glamor X acceleration enabled on AMD Ryzen 9 9950X 16-Core Processor
                          (radeonsi, raphael_mendocino, LLVM 20.1.2, DRM 3.61, 6.14.0-27-generic)
          AMDGPU(0): glamor detected, initialising EGL layer.
          AMDGPU(0): [DRI2] DRI driver: radeonsi
          Output HDMI-A-2 using initial mode 3840x2160 +0+0
          NVIDIA(G0): Virtual screen size determined to be 640 x 480   ← NVIDIA 屏是空的
```
- **GNOME Shell 46.0 / libmutter-14-0 46.2**，`org.gnome.mutter experimental-features = ['x11-randr-fractional-scaling']`（**已开启**，正是产生 §1.4 分数缩放管线的开关）。
- 合成器 = gnome-shell（Clutter/mutter，`_NET_SUPPORTING_WM_CHECK` = 0x600001 存在）。
- **GL 走硬件**：DDX 是 amdgpu + glamor + radeonsi（非 llvmpipe/swrast）。⚠️ 我试图用 `/proc/<gnome-shell>/maps` 直接确认 gnome-shell 链接的是 radeonsi 而非 llvmpipe，但**读取被拒（`/proc/PID/maps: 权限不够`，本会话沙箱/ptrace 限制）** ⇒ 这一条以 DDX 侧的 radeonsi glamor + EGL 层为准，**未 100% 排除** gnome-shell 内部回退软渲染的可能（不过 `gpu_busy_percent` 有 62–96% 的活跃度，与软件渲染不符）。
- **RTX 4090 空闲且不驱动显示**：`nvidia-smi` 报 `Failed to initialize NVML: Unknown Error`，`/sys/.../0000:01:00.0/power_state = D0`（已上电），Xorg 里 NVIDIA 只作为 **Sink Offload** 提供者、其虚拟屏是 640x480。⇒ **价值最高的那块 GPU 完全没有参与这条卡顿路径。**
- iGPU 电源/频率状态（只读）：`power_dpm_force_performance_level=auto`、`power_dpm_state=performance`、`sclk ∈ {600,700,2200}MHz`、`mclk ∈ {1000,2400}MHz`，`amdgpu` 模块参数无异常强制项（`ppfeaturemask=0xfff7bfff`、`freesync_video=0`、`deep_color=0`）。
  ⚠️ 采样中曾出现 **`busy=77~96%` 而 `sclk` 仍在最低档 600MHz** 的瞬时组合，但**该 5 秒窗口内本机有 5 条并行工作线在跑 headless 浏览器/Node（`node` 88.9%、多个 `headless_shell` 60%+）**，因此**这份 GPU/CPU 占用是"污染样本"，不能作为静置基线**。未发现任何"人为把 GPU 锁在低频"的配置（`force_performance_level=auto`）。

### 1.6 系统级可改善项（**只报告，不动手**）

| 方案 | 预期收益 | 改动风险 | 回滚方式 |
|---|---|---|---|
| **A. 把显示器缩放从 150% 改为 100%** | 逻辑 3840x2160、DPR 1.0 ⇒ 渲染面 = 输出面，**消灭 1.78 倍填充放大与 5120x2880→4K 重采样**；应用光栅面积降到 1/4。这是收益最大、最对症的一项（直接命中"跟手动画"成本） | UI 明显变小、字变小（27" 4K 下 100% 对很多人偏小）；改变全局观感，可能影响用户既有排版/截图流程；`monitors.xml` 已有 150% 记录，贸然改会让用户"看着不对" | Settings→Displays 改回 150%；或 `dconf`/文件级回滚：备份 `~/.config/monitors.xml` 后还原（当前内容已完整存于 `raw/display-chain-raw.txt` §7），注销重登即生效 |
| **B. 改为 200%** | 逻辑 1920x1080、DPR 2.0 ⇒ 渲染面 = 1920x1080×2 = 3840x2160 = 输出面，**同样消灭重采样与超采样**，且文字更大更清晰 | 逻辑空间只剩 1920x1080，可容纳内容大幅减少（对本任务的多窗口工作流可能不可接受） | 同 A |
| **C. 关闭 `x11-randr-fractional-scaling`** | 强制 GNOME 只能选整数缩放 ⇒ 等价落到 A(100%) 或 B(200%)，从根上消除 5120x2880 渲染面与 Transform | 与 A/B 同因；此外该特性也可能是用户刻意开的 | `gsettings set org.gnome.mutter experimental-features "['x11-randr-fractional-scaling']"`（**原值已存证**）恢复；注销重登 |
| **D. 把显示器接到 RTX 4090 并让 NVIDIA 驱动输出** | 用 24GB 独显承担 5K 超采样合成，核显压力转移 | **风险最高**：需要改 BIOS/插线/可能重配 Xorg，且当前 `nvidia-smi`/NVML 已报错、NVIDIA 在 Xorg 里只当 Sink Offload ⇒ **该 4090 当前状态不明**，贸然切换可能起不来图形界面 | 需保留"核显+HDMI 现接线材"原样以便切回；本审计**不建议**在没有 4090 健康检查前尝试 |
| **E. 从 60Hz 提到更高刷新率** | 无 —— 面板 EDID 上限即 60Hz，HDMI TMDS 已达 300MHz 上限 | **不可行** | 不适用 |
| **F. 降低浏览器侧的"跟手动画"重绘面积**（并非系统设置，但同属环境侧杠杆） | 让托盘展开/波纹只重绘脏区、限制动效覆盖面积、或在该机器上使用更轻的动效 | 属产品/实现取舍 | 可逆（改回样式即可） |
| **G. 交换鼠标为低回报率档位** | 把 G502 从 1000Hz 降到 500/125Hz（Logitech G HUB / onboard profile），可把每事件开销线性降低 | 属输入设置改动；手感变化；**本审计未执行** | G HUB/板载配置切回原档 |
| **H. `file`/内核侧 `usbhid.mousepoll`** | 当前为 `0`（不节流 = 尊重设备 1ms）。若设为 `4`(250Hz)/`8`(125Hz) 可全局降事件率 | **需改内核参数或 modprobe 配置 + 重载/重启**，属"改变输入设置"，**越界且影响面大** | 移除 `/etc/modprobe.d` 条目并重载模块 |

---

## 2. 输入链路

证据：`raw/input-01..20-*.txt`（次级 subagent）+ `raw/xi2-raw-sample.txt`（本线独立复测）
采集方式：全部**被动只读**。`xinput list-props` 为查询；XI2 采样用 `timeout 4 xinput test-xi2 --root`（**对 root 窗口做 XI2 raw 事件选择，不 grab 设备、不影响其他客户端**，由 `timeout` 强制 4 秒结束，exit=124 为预期）；未做任何 `xinput set-prop`。

### 2.1 设备清单（`xinput list` / `/proc/bus/input/devices`）
**3 个物理指针设备**挂在 `Virtual core pointer (id=2)` 下：

| 设备 | VID:PID | XInput id | /dev/input | USB 位置 |
|---|---|---|---|---|
| **Logitech G502 HERO Gaming Mouse** | `046d:c08b` | **18** | event9（Mouse） | `9-1.3`（usb9，hub 后） |
| VGN DragonFly F1 SE Mouse | `3554:fb50` | 15 | — | `1-3` |
| SINOWEALTH VGN V87 V2 2.4G Dongle Mouse | `258a:027b` | 13 | event9（mouse0） | `1-2`（2.4G 无线接收器） |

⇒ **这是一套"游戏外设"配置**（G502 HERO + VGN 双游戏鼠标 + VGN 87 键无线机械键盘），不是办公鼠标。

### 2.2 回报率 / bInterval —— **FAIL（存在高回报率设备）**
USB 中断 IN 端点的 `bInterval` 是回报率的权威来源（单位 = 1ms 帧）：

```
=== 9-1.3  Logitech / G502 HERO Gaming Mouse  vid=046d pid=c08b speed=12 ===
  [iface 9-1.3:1.0/] class=03 sub=01 proto=02 driver=usbhid
     ep_81: type=Interrupt dir=in interval=1ms bInterval=01 wMaxPacketSize=0008
  [iface 9-1.3:1.1/] class=03 sub=00 proto=00 driver=usbhid
     ep_82: type=Interrupt dir=in interval=1ms bInterval=01 wMaxPacketSize=0014
=== 1-3  VGN / VGN DragonFly F1 SE  vid=3554 pid=fb50 ===
     ep_81: interval=1ms bInterval=01 ...   ep_82: interval=1ms bInterval=01
=== 1-2  SINOWEALTH / VGN V87 V2 2.4G Dongle  vid=258a pid=027b ===
     ep_81: interval=1ms bInterval=01 ...   ep_82: interval=1ms bInterval=01
```
`bInterval=01` = **1ms = 1000Hz 回报率能力**，三个指针设备**全部**是 1ms 端点。

**内核侧不节流**：
```
/sys/module/usbhid/parameters/mousepoll = 0     ← 0 = 尊重设备 bInterval，不做 125Hz 降频
/sys/module/usbhid/parameters/kbpoll    = 0
quirks = (null),(null),(null),(null)
```
⇒ **内核没有把 1000Hz 设备降频**，全速事件流直达 X server。udev hwdb 中**没有**这三只鼠标的 `MOUSE_DPI`/polling 覆盖（`raw/input-12-hwdb.txt`）。

### 2.3 指针加速 / 属性（`xinput list-props`）
```
libinput Accel Speed (337): 0.000000                （默认，未人为加/减速）
libinput Accel Profiles Available (339): 1, 1, 1
libinput Accel Profile Enabled (340): 1, 0          → adaptive（自适应）加速，即 libinput 默认
libinput Send Events Mode Enabled (309): 0, 0       （未被禁用/未启用 disable-while-typing 之外的模式）
libinput Natural Scrolling Enabled (323): 0
Device Enabled (195): 1
```
⇒ 指针加速处于 **libinput 默认（adaptive 开启、Accel Speed 0）**，**无异常配置**。加速只改变"位移→位移"的映射，**不改变事件率**，因此**不是**卡顿来源（但会影响"跟手"手感的主观评价）。

### 2.4 事件率实测 —— 关键数字
本线独立复测（`raw/xi2-raw-sample.txt`；4.00s 窗口，`exit=124` 为 `timeout` 预期）：
```
total lines: 28757
--- event type histogram ---
   1289 RawMotion      ← 来自 slave device 18 (G502 HERO)
   1289 Motion         ← master pointer id=2 收到
--- device list referenced in sample ---
   1289 device: 18     1289 device: 2
```
⇒ **1,289 个核心 Motion（+1289 RawMotion 配对）在 4.00 秒内 = 约 322 个 mousemove 事件/秒**，
   即 **每 3.1ms 一个 mousemove**，全部来自 **Logitech G502 HERO（id=18）**。
   对比参照：普通 125Hz 办公鼠标的**理论上限**就是 125 事件/秒 ⇒ **实测事件率是办公鼠标上限的 ~2.6 倍**，而这只是**中等速度移动**（设备能力上限 1000/s，快甩时可到 ~1000/s）。

**旁证（IRQ 层，`raw/input-09-irq-delta.txt`、`raw/input-11-irq-analysis.txt`）**：
```
IRQ 81  0000:74:00.0 xhci_hcd  (+867 / 2s = 433.5 IRQ/s)   ← usb9/usb10，G502 所在控制器
IRQ 73  0000:73:00.4 xhci_hcd  (+6496 / 2s = 3248 IRQ/s)   ← usb7/usb8，挂 mt7921u USB 无线网卡
IRQ 47  0000:0d:00.0 xhci_hcd  (0 / 2s)                     ← usb1，VGN 两个设备（静置）
IRQ 134 amdgpu                 (+1454 / 2s = 727 IRQ/s)     ← 显示/GPU 中断
```
- G502 所属控制器实测 **~433 IRQ/s**，与 XI2 侧的 ~322 Motion/s **同量级互相印证**（IRQ 含每次报告，Motion 含 X 侧合并/过滤，故 IRQ ≥ Motion 合理）。
- ⚠️ **注意区分**：**3248 IRQ/s 属于 USB 无线网卡（mt7921u）所在的另一个控制器**，**不是鼠标**，不能算作"鼠标事件洪流"。但它是一项真实的**系统级中断负载**（见 §2.7）。
- amdgpu 显示中断 **727/s**（60Hz 下 vblank 本身只需 60/s）⇒ 合成/翻页活动密集（含并行工作线的负载污染，见 §1.5 警告）。

**结论（事件洪流）**：**鼠标确实在产生高密度事件流（实测 ~322/s，能力 1000/s，内核未节流）** —— 用户的"高回报率鼠标"假设**成立**。
但**"事件洪流本身是否造成卡顿"必须由 §3 的成本模型回答**，因为事件多 ≠ 卡顿（见 §3/§4：每千次事件的开销只有毫秒级）。

### 2.5 未测到 / 存疑项（诚实标注）
- **XRecord 路径的逐事件率测量失败**：次级 subagent 自写的 XRecord 客户端出现结构体布局错误（`raw/input-15-xrecord-validate.txt`："NEITHER - inconclusive layout is correct"），在指针**确实在动**的情况下（`raw/input-18-ptrmotion.txt`：`position_changes=1870 / poll_samples=4648`，`pointer_moved=YES`）仍返回 `motion_events=0`（`raw/input-17-rate-sample1.txt`、`raw/input-20-concurrent.txt`）。⇒ **该路径作废**，事件率以本线 XI2 复测（§2.4）为准。
- **`libinput debug-events` 未取得**：需要 root/`/dev/input/event*` 读权限，本会话无提权（且纪律禁止提权），故未做。事件率改由 XI2 + IRQ 两条独立路径佐证。
- `/proc/<pid>/maps`、`/proc/<pid>/environ` 对**其他进程**读取被拒（`权限不够`）⇒ 无法从内核侧直接确认 gnome-shell/Firefox 链接的 GL 实现与缩放环境变量。
- 事件率受**用户实际手部动作**影响：322/s 是采样窗口内的真实值，非设备上限；**不能**据此推断"用户一直按 1000Hz 甩鼠标"。

---

### 2.6 输入链路次级 subagent 报告要点与**交叉核对**

完整报告：`raw/input-chain.md`。其四项判定与 §2.1–2.6 一致，另补充了以下**本线采纳**的事实：

- **G502 的 HID 节点 = `/dev/input/event11`，`Uniq=209036A04742`**；G502 与两只 VGN 分别挂在**不同** xHCI 控制器上（G502 → `74:00.0`，VGN → `0d:00.0`）。
- **速度档位**：三设备 `speed=12`（USB **全速** 12Mbps）⇒ 1ms 帧周期，**物理上限即 1000Hz**，与 `bInterval=0x01` 自洽。
- **udev/hwdb 覆盖排查**：`/usr/lib/udev/hwdb.d` 与 `/etc/udev/hwdb.d` 对三组 VID:PID **零条目** ⇒ 1ms 就是设备真实报告周期。
- **加速属性的细读**：`Accel Profile Enabled = 1,0`（adaptive），但其 `Default = 1,0,0`（默认本为 flat）⇒ 运行态与默认不同；不过 `Accel Speed = 0.000000`，**不构成"加速被拉高"**。本线认可该结论并据此把"指针加速"判为**非来源**。
- **DPI 不可读**：未装 ratbagctl/piper/solaar，X 层无 DPI 属性 ⇒ 鼠标 DPI、以及"是否被设成 1000Hz 档"**无法从软件侧读取**（诚实标注为未测项）。
- **`libinput debug-events` / 直接读 `/dev/input/event*`：无权限**（uid 1001 不在 `input` 组，`event11/9/14` 实测不可读），按纪律**未提权**。
- 其"**IRQ 全部单核绑定**（47→cpu22、73→cpu25、81→cpu26、134→cpu5）"与"**USB WiFi（`0e8d:7961`，mt7921u）控制器 73:00.4 实测 ~2473 IRQ/s 且 100% 压在 cpu25**"两点，本线独立复核**一致**（见 `raw/input-22/24-*.txt`）。
- 其"amdgpu IRQ ≈ 654.7–727/s ≈ 60Hz × 11–12"的表述与本线 727/s 实测一致（但按 §1.5/§5.2，该值含并行工作线负载污染，**不宜当作静置基线**）。

**本线对其中两处结论的纠正/升级（以本线三重互证为准）**：

1. **【纠正】"逻辑桌面 = 3840×2160×1.5 = 5120×2880" —— 该推导有误。**
   实际是 **逻辑（CSS）= 2560×1440**、**帧缓冲 = 逻辑 × 2 = 5120×2880**，即 **DPR = 2.0**（不是 1.5）。依据（§1.4 三条独立互证 + 姊妹线的 mutter D-Bus 权威状态）：
   - `legacy-ui-scaling-factor = 2`（mutter 自己的 DisplayConfig 状态，见 `gfx-stack` 独立取证）；
   - `Xft.dpi = 192 = 96 × 2`（若 DPR=1.5 则应为 144）；
   - `Xcursor.size = 48 = 24 × 2`（若 1.5 则应为 36）；
   - `_NET_WORKAREA 4988×2816 ÷ 2 = 2494×1408`，加 Ubuntu Dock 66 + 顶栏 32 = **2560×1440**（整数；若按 1.5 除则得 3413.3×1920，**非整数**，GNOME 不会产生）。
   - 机理：mutter 对分数缩放采用 **`ceil(scale)` = 2 渲染**，再把 5120×2880 重采样到 3840×2160 的 CRTC —— 这正是 `Transform 1.333328 = 2/1.5` 的由来。
   - **这个区别很重要**：它决定了"应用按 DPR 2.0 光栅化（4 倍 CSS 像素）"这一关键量化结论，A 线的 1.5 版本会低估应用侧光栅成本。
2. **【升级】"X 层事件率 INCONCLUSIVE" → 本线已实测为确定值 322 /s。**
   A 因担心 `xinput test-xi2` 会 `XIGrabDevice` 独占抓取而主动放弃；本线采用 **`test-xi2 --root`** 形式并已**验证其是"在 root 窗口上选择事件"、非 grab**：
   - `man xinput` 原文："*If --root is given, events are selected on the root window only.*"
   - `nm -D /usr/bin/xinput` 仅导入 `XISelectEvents`，**无任何 `*Grab*` 动态符号**。
   - 采样以 `timeout 4` 硬性限时，进程随即退出，无残留客户端。
   ⇒ **A 线的保守判断可以理解，但其"会 grab"的前提不适用于 `--root` 形式**；本线据此把"X 层可见 mousemove 事件率"从 INCONCLUSIVE **升级为确定值（322/s）**。

**仍然无法判定的一项（与 A 线一致，保留为未决）**：
**G502 在硬件层究竟是 1000Hz 还是被设成 125/500Hz 档** —— 三条验证路径（`event*` 读权限、`libinput debug-events`、XRecord）在本会话权限下全部受阻。实测只能给出"**X 层可见事件率 322/s（移动时）**"这一**应用真正看得到的量**；对卡顿归因而言，这个量已经足够（见 §3/§4），故不影响结论。

### 2.7 三条独立方法的事件率三角验证（本审计的关键数字）

| 方法 | 观测量 | 活跃移动时 | 静置时 | 证据 |
|---|---|---|---|---|
| **XI2 核心事件**（本线） | `Motion` 事件 | **322 /s** (1289/4.00s) | — | `raw/xi2-raw-sample.txt` |
| **G502 控制器 xHCI IRQ**（次级 subagent，逐 trial 与指针位移对照） | IRQ/s | **367 /s**（trial2，同期 `pointer_changes=557`, `dist_px=3002`） | **1–3 /s**（trial1/3/4，`pointer_changes=0~2`） | `raw/input-26-g502-rate.txt` |
| **XQueryPointer 位置变化** | changes/s | **206 /s** (2062/10s) | 0 | `raw/input-23-ptrmotion-10s.txt` |
| （10s IRQ 窗口） | IRQ/s | 220 /s | — | `raw/input-22-irq-10s.txt` |

**三条独立路径一致落在 ~200–370 事件/秒 区间**（移动时），且 **`input-26` 的逐 trial 对照证明：指针不动时事件流≈0（1–3 IRQ/s），事件率与手部位移严格成比例** —— 即**不存在"静置也在刷事件"的持续洪流**；但**一旦移动，事件率就是办公鼠标(125Hz)上限的 1.6–2.9 倍**，设备能力上限 1000/s。

**IRQ 亲和性**（`raw/input-24-irq-map.txt`）：鼠标控制器 IRQ 81 固定落在 **CPU 26**，amdgpu IRQ 134→CPU 5，mt7921u 所在 IRQ 73→CPU 25，VGN 设备 IRQ 47→CPU 22。⇒ 鼠标事件**全部挤在单一 CPU 上**，且本机 load average ≈5.4、`node` 90% / `headless_shell` 83%（并行工作线）⇒ 存在**单核争抢导致投递抖动的理论风险**；本次**未测到**该抖动的实际幅度（属未决项）。

---

## 3. 跟手动画成本模型（页内实测）

证据：`page/index.html` + `page/run.mjs` + `page/raw/*.json`（次级 subagent）；本线另引用 `cross-app/costmodel/`（姊妹工作线，独立复现，见 §3.3）。

### 3.1 方法
- 自包含页面，元素监听 `mousemove`；用**页内合成事件** `el.dispatchEvent(new MouseEvent('mousemove',…))` 以精确间隔注入，同时用 `performance.now()` 计算「分派 + 处理」总忙时间 ÷ 事件数 ⇒ **µs/事件、ms/1000 事件**；`rAF` 记录帧间隔序列 ⇒ p50/p95/p99/max 与丢帧率；`PerformanceObserver(longtask)`。
- 五种实现：`null-handler`（基线，只计数）、`perEvent-raf`（**推荐写法**：事件只存坐标，rAF 里一次性写 `transform`）、`perEvent-noRaf`（每事件同步写 `transform`）、`layout-thrash`（每事件写 `left/top` **并读 `offsetWidth`** 强制同步布局 = "每事件重排"）、`canvas-2d`（每事件清屏重绘）。
- 两种节奏：`mc`（1 事件/ms 精确节流，可控制速率）、`burst`（连续爆发）。
- 受测盒 `boxMode`：`small`（本次全部样本）。
- ⚠️ **方法学限定（必须承认）**：页内 `dispatchEvent` **绕过浏览器真实输入管线**（无 IPC、无 coalescing），因此这些数字测的是**每个事件的应用侧处理成本**，不是浏览器投递成本。浏览器投递成本通常为事件量级的 µs 级，量级上不会改变结论。

### 3.2 实测结果 —— **每 1000 次事件的开销**

`boxMode=small`，`pace=mc`，`intervalMs=1`（≈1000 事件/秒），**每配置 3000 事件 × 3 轮重复，取中位数**（headless）：

| 实现 | **ms / 1000 事件（中位数 n=3）** | 3 轮范围 | 相对基线 | 每事件 µs | 强制布局读 | 帧 p50 | 帧 p95 | >16.7ms 帧占比 | 丢帧 | 有效 fps |
|---|---|---|---|---|---|---|---|---|---|---|
| `null-handler`（基线） | **1.87** | 1.73–2.06 | 1.0× | 1.9 | 0 | 16.66 | 16.67 | **0.000** | 0 | 60.0 |
| **`perEvent-raf`（推荐写法）** | **1.86** | 1.79–1.90 | **1.0×** | 1.9 | 0 | 16.67 | 16.67 | **0.000** | 0 | 60.0 |
| `perEvent-noRaf`（每事件直写 style） | **3.35** | 3.23–3.56 | 1.8× | 3.4 | 0 | 16.67 | 16.67 | **0.000** | 0 | 60.0 |
| `canvas-2d`（每事件清屏重绘） | **7.00** | 6.63–7.89 | 3.7× | 7.0 | 0 | 16.67 | 16.67 | **0.000** | 0 | 60.0 |
| **`layout-thrash`（每事件重排，最坏）** | **13.77** | 12.84–16.58 | **7.4×** | 13.8 | **3000/3000** | 16.67 | 16.67 | **0.000** | **0** | **60.0** |

（`pace=burst` 连续爆发、3000 事件 × 3 轮中位数：`null` 1.31、**`perEvent-raf` 1.22**、`perEvent-noRaf` 1.60、`layout-thrash` 7.28、`canvas-2d` 3.35 ms/1000 事件 —— 同一量级，结论不变。）

**最坏情况的关键读数**：**`layout-thrash`（每事件写 `left/top` + 读 `offsetWidth` 强制同步布局）在 1000 事件/秒下，帧间隔 p50/p95 = 16.67/16.67 ms、`>16.7ms` 帧占比 0.000、丢帧 0、有效 60.0 fps** ⇒ **"每事件重排"在本机没有造成任何可观测的掉帧。**

**事件率扫描**（每样本 2000 事件，`pace=mc`，`ms/1000 事件`）：

| 间隔 | 事件率 | `null` | **`perEvent-raf`** | `layout-thrash` | `canvas-2d` |
|---|---|---|---|---|---|
| 0.25 ms | 4000 /s | 1.64 | **1.17** | 9.65 | — |
| 0.5 ms | 2000 /s | 1.68 | **1.35** | 10.94 | — |
| 1 ms | 1000 /s | 1.92 | **1.86** | 12.32 | 6.52 |
| 2 ms | 500 /s | 2.64 | **3.18** | 18.28 | 12.61 |

（每千次事件成本随事件率升高而**轻微下降**——批处理/缓存变热效应；即使最慢实现也只在 9.6–18.3 ms/1000 区间。）

### 3.3 **决定性对照**：面积/DPR 才是主导项（独立复现）

同一份"跟随鼠标的 ripple"动效，**只改视口尺寸**，注入同样的事件：

**A. 次级 subagent 的 control（本线，`page/raw/`）**：`boxMode=small` 时，**即使 4000 事件/秒 + 每事件强制布局**，帧间隔 p50/p95 仍为 **16.66/16.67 ms，`>16.7ms` 帧占比 0.000，丢帧 0，有效 60.0 fps**。
⇒ **"每事件重排 + 高事件率"本身在本机不足以造成任何丢帧。**

**B. 姊妹工作线 `cross-app/costmodel/`（独立实现、独立 harness，本线只读引用）**：

| 视口 | 动画 | 帧 p50 | 帧 p95 | 丢帧 | 丢帧率 | 有效 fps | `work_p95`（JS 工作量） |
|---|---|---|---|---|---|---|---|
| **1280x720**（0.92 Mpx） | ripple-r50 | **16.7 ms** | 16.75 | **0** | **0 %** | **60.01** | 0.1 ms |
| **1280x720** | ripple-r100 | 16.7 ms | 16.7 | 0 | 0 % | 60.01 | ~0 |
| **5120x2880**（14.75 Mpx） | ripple-r50 | **19.4 ms** | **28.36** | **7** | **12.1 %** | **48.99** | 0.11 ms |
| **5120x2880** | ripple-r400 | **21.4 ms** | **30.32** | **14** | **26.4 %** | **44.25** | 0.2 ms |
| **5120x2880** | ripple-r800 | 25.2 ms | — | — | — | 更低 | ~0 |

> **逐行标志说明（避免误读）**：`1280x720` 两行为**受 vsync 限制**的运行（`result-1280x720.json`），因此 60.01 fps 是"跑满刷新率"的表现；`5120x2880` 两行为**用 `--disable-frame-rate-limit --disable-gpu-vsync` 解除帧率限制**的运行（`result-5120x2880-nolimit.json` / `result-5120-focused.json`）。⇒ 这一对比对结论**更有利而非更不利**：5120x2880 **在解除 60Hz 限制、被允许跑多快就跑多快的情况下，反而只跑到 44–49 fps**，说明它已被**像素填充能力**卡住，而不是被刷新率上限卡住。
>
> ⚠️ **两个必须声明的 harness 事实（由本线从 `page/raw/SUMMARY-headless.json` 的 `meta`/`gl` 字段中查出）**：
> 1. **光栅路径是软件光栅**：`unmaskedRenderer = "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)"` ⇒ headless 运行走 **SwiftShader 软件光栅**，**没有**用到核显/GPU 合成。故"面积定律"是一次**受控实验**（同一 harness、同一光栅器，只改视口面积 ⇒ 唯一变量是**光栅面积**），其**因果方向可靠**；但其**绝对帧率是软件光栅的数字，不能外推到用户真实环境**（真实环境是核显 GPU 合成 5K 帧缓冲 + 重采样，机理不同、量级不同）。用户的客户端是 **snap Firefox**，与测试用的 Chromium 也不同。
> 2. **该批次浏览器被显式强制 DPR=1**：`launchArgs` 含 `--force-device-scale-factor=1` ⇒ `SUMMARY-headless.json` 里的 `facts.devicePixelRatio = 1`、`screenWidth = 1280`、`res2dppx = false` **是这条 flag 的产物，不是环境事实**，**不得**用来支持或否定本审计 §1.4 的 DPR 结论。另外 `page.goto('chrome://gpu')` 报 `net::ERR_FAILED` ⇒ **chrome://gpu / GL_RENDERER 未取到**。
> ⇒ **"浏览器侧 DPR 确认"这一项本审计未能取得**（见 §5.2 第 8 条）；§1.4 的 DPR=2.0 依据是 **X 服务端/mutter 侧的三条独立互证**，其中 mutter 自己的 `legacy-ui-scaling-factor = 2` 本就是**喂给 X11 客户端的权威值**，强度不亚于浏览器自报。

**这张表是本审计最有力的单一证据**：
1. **同一份代码、同样的动效、同样的注入方式**，只因光栅面积从 0.92 Mpx 变成 14.75 Mpx（**16 倍**），就从 **60 fps / 0 丢帧** 掉到 **44 fps / 26.4% 丢帧**。
2. 两个视口下 **`work_p95` 都只有 0.1–0.2 ms**（JS 每帧工作量几乎为零）⇒ **卡顿完全不在 JS/事件处理侧，而在"像素呈现/合成"侧**。
3. 14.75 Mpx 正是 §1.4 实测的**本机合成帧缓冲尺寸（5120x2880）**；用户实际的 DSH 窗口是 **3344x2862 = 9.57 Mpx**，落在"0.92 Mpx 流畅"与"14.75 Mpx 卡顿"之间靠后段 ⇒ **必然处于掉帧区间**。

### 3.4 事件合并（coalescing）的效果 —— **实测：把写入次数钉在刷新率上**

`perEvent-raf` 变体（事件只存坐标、rAF 里写一次）的实测（headless，中位数）：

| 事件率 | 每帧事件数（中位） | **每个 rAF 写入服务的事件数** | **rAF 写入次数/秒** | 合并倍数 | ms/1000 事件 | 帧 p50 | 帧 p95 | 丢帧 |
|---|---|---|---|---|---|---|---|---|
| 4000 /s | 43.8 | **64.5** | **62.0** | **64.5×** | 1.32 | 16.67 | 16.67 | 0 |
| 2000 /s | 26.3 | **32.8** | **61.0** | **32.8×** | 1.76 | 16.67 | 16.67 | 0 |
| **1000 /s（= 1000Hz 鼠标）** | **15.3** | **16.6** | **60.3** | **16.6×** | 1.86 | 16.67 | 16.67 | 0 |
| 500 /s | 7.8 | **8.3** | **60.3** | **8.3×** | 2.55 | 16.67 | 16.67 | 0 |
| 爆发 3000 事件（无节流） | — | **3000** | 274 | **3000×** | **1.22** | — | — | — |

**结论（回答"合并后的差异"）**：
1. **推荐写法把 `style` 写入 / 布局失效次数从"事件率"钳制到"刷新率"**：1000Hz 输入下 **1000 次/s → 60.3 次/s（削减 16.6 倍）**；4000Hz 下削减 **64.5 倍**。这与 60Hz 刷新率严格吻合（`rafWriteCount ≈ frames`）。
2. 未做合并的三种实现（`perEvent-noRaf` / `layout-thrash` / `canvas-2d`）**`rafWriteCount = 0`**，即**每个事件都触发一次写/失效**（1000–4000 次/s）。
3. **但合并不是本机掉帧与否的分水岭**：§3.2/§3.3 显示，即使在**不合并**且**每事件强制布局**的情况下（小面积、4000 事件/s），帧间隔仍是 16.67ms、**0 丢帧**。⇒ **合并是"降低风险余量"的优化，而不是当前卡顿的直接解药**；真正的分水岭是**重绘面积 × DPR²**（§3.3）。

### 3.5 每千次事件开销的**外推**（把两个维度乘起来）
以实测事件率 ~322 /s 与 ~1000 /s 分别折算（`ms/1000 事件 × 事件率 / 1000`，取 §3.2 中位数）：

| 实现 | @322 事件/s | 占 1 秒 CPU | @1000 事件/s | 占 1 秒 CPU | 占一帧(16.67ms)预算 |
|---|---|---|---|---|---|
| `perEvent-raf`（推荐） | 0.6 ms/s | **0.06 %** | 1.9 ms/s | **0.19 %** | ~0.03 ms/帧 |
| `perEvent-noRaf` | 1.1 ms/s | 0.11 % | 3.4 ms/s | 0.34 % | ~0.06 ms/帧 |
| `canvas-2d` | 2.3 ms/s | 0.23 % | 7.0 ms/s | 0.70 % | ~0.12 ms/帧 |
| **`layout-thrash`（最坏）** | 4.4 ms/s | **0.44 %** | 13.8 ms/s | **1.38 %** | ~0.23 ms/帧 |

⇒ **即使是最坏的"每事件重排"实现 + 1000 事件/秒，事件处理也只吃掉约 1.4% 的 CPU、约 0.23 ms 的单帧预算（<1.4% 的帧预算）。**
⇒ **"每千次事件的开销"是毫秒级、完全可忽略的量级；它无法解释用户看到的大幅卡顿。**

---

## 4. 判定与结论

### 4.1 逐条判定（对应用户问题）

| 审计项 | 判定 | 依据 |
|---|---|---|
| 1. 会话类型 | **PASS** | X11（`XDG_SESSION_TYPE=x11`, `DISPLAY=:1`，无 Wayland/XWayland 层） |
| 2. 显示器型号 + 实际刷新率 | **PASS** | LG ULTRAFINE（GSM）27" 4K；**实际 3840x2160 @ 60.00Hz**（EDID eP 首选时序 594.00MHz） |
| 3. 是否被限制到 60/30Hz | **FAIL（存在硬上限）** | EDID vrefresh 范围 **40–60Hz**，4K 档位无 >60Hz 模式，`vrr_capable=0`，HDMI TMDS 已达上限 ⇒ **60Hz 是天花板**，非误设 |
| 4. 缩放/DPR/分辨率 | **FAIL（关键环境缺陷）** | GNOME **scale 1.5** ⇒ 逻辑 **2560x1440**、**DPR 2.0**（`legacy-ui-scaling-factor=2`、`Xft.dpi=192`、`_NET_WORKAREA/2` 三路互证）；渲染面 **5120x2880 (14.75 Mpx)** → transform 1.3333 + bilinear → **3840x2160 (8.29 Mpx)** ⇒ **每个受损区域多渲染 1.78 倍像素 + 多一次重采样**；应用侧因 DPR=2 光栅面积 ×4 |
| 5. GPU 是否在驱动合成 | **PASS，但正因如此成为瓶颈** | 合成由 **AMD Raphael 核显**（radeonsi/glamor + mutter GL）承担；**RTX 4090 完全未参与显示**（仅 Sink Offload，`nvidia-smi` 报错），`gnome-shell` 9.7% CPU + Xorg 3.5% |
| 5b. 合成器级缺陷 | **FAIL（机器级、与应用无关）** | gnome-shell 本次开机 **3,479 条** `Can't update stage views actor … needs an allocation`（34 分钟内，峰值 ~6/s；`/var/log/syslog` 累计 28,193）；actor 主体 `MetaWindowActorX11` 1735 + `MetaSurfaceActorX11` 1735，**并出现 `ShellTrayIcon`、`panelBox[StBoxLayout]`、`Gjs_ui_panel_Panel`** |
| 6. 高回报率鼠标存在？ | **PASS（确实存在）** | G502 HERO / VGN DragonFly F1 SE / VGN V87 dongle 三者 **bInterval=1ms（1000Hz）**；`usbhid mousepoll=0` 不节流 |
| 7. 输入事件洪流？ | **PARTIAL（移动时高、静置无）** | 移动时 **~200–370 事件/s**（XI2 / IRQ / XQueryPointer 三路互证）；静置时 **1–3 IRQ/s ≈ 0** ⇒ **无持续洪流**，事件率与手部动作严格成比例 |
| 8. 每千次事件开销 | **PASS（可忽略）** | **1.2–18.3 ms/1000 事件**（最坏"每事件重排"）；@1000 事件/s 仅占 **1.4% CPU / 0.23 ms 单帧** |
| 9. 跟手动画的真实瓶颈 | **已定位：像素呈现侧**（受控实验，软件光栅，见 §3.3 脚注） | 同代码同事件量：720p **60fps/0 丢帧** vs 5120x2880 **44fps/26.4% 丢帧**，而两者 `work_p95 ≈ 0.1–0.2ms` |
| 10. **输入/显示链路是否是卡顿来源** | **FAIL = 是，且是主要放大器** | 见 §4.2 |

### 4.2 「输入/显示链路是否是卡顿的来源」—— **FAIL：是（环境侧确证为主因之一）**

**用户假设的检验结果（"高回报率鼠标 + 动画每事件重排 ⇒ 环境+实现叠加"）：**

| 分句 | 判定 | 数据 |
|---|---|---|
| "用户在用高回报率鼠标" | ✅ **支持** | 三只设备 **1ms bInterval / 1000Hz**；实测移动时 **~322 事件/s**，是 125Hz 办公鼠标上限的 ~2.6 倍；内核 `mousepoll=0` 未节流 |
| "（它）产生了事件洪流" | ⚠️ **部分支持** | **移动时**确实是办公鼠标 1.6–2.9 倍的事件密度；但**静置时≈0**，不是持续洪流 |
| "动画每事件重排" | ✅ **作为事实存在可能，但不是主因** | 最坏实现（每事件写 `left/top` + 强制布局）也只 **13.8 ms/1000 事件** = 1000Hz 下 **1.4% CPU**；且该实现下 **4000 事件/s 仍 0 丢帧** |
| "这是环境+实现叠加，而非 DSH 独有" | ✅ **支持，但归因需要修正** | **环境主导**由三条证据共同支撑：**①确定性像素放大**——DPR 2.0 让应用光栅面积 ×4，且 mutter 侧同一受损区域多渲染 1.78 倍并额外重采样（§1.4，**由系统事实直接推导，最硬**）；**②合成器缺陷机器级且与应用无关**——3,479 条 stage-view 分配失败，涉及任意 X11 窗口 actor（§4.1 第 5b 项，**实测量，最硬**）；**③面积定律**——同代码同事件量，仅面积 16 倍之差就从 60fps/0 丢帧掉到 44fps/26.4% 丢帧，而两处单帧 JS 工作量都只有 0.1–0.2 ms（§3.3，**受控因果实验，但为软件光栅，作方向性证据**） |

**修正后的因果链（本审计结论）**：
```
用户感知卡顿
├── 主导：显示/合成链路的"像素预算"被人为放大
│     ├─ GNOME 分数缩放 1.5 ⇒ DPR 2.0 ⇒ 渲染面 5120x2880（14.75 Mpx，比实际输出多 1.78×）
│     ├─ 该 5K 合成由【2 CU 级 AMD 核显】承担（RTX 4090 闲置、不驱动显示）
│     ├─ 每帧额外一次 5120x2880→3840x2160 双线性重采样
│     ├─ 输出被锁死 60Hz（EDID 40–60Hz 上限）
│     └─ 面积实测律：0.92 Mpx→60fps/0 丢帧 ；14.75 Mpx→44fps/26.4% 丢帧
├── 叠加：mutter 合成器级缺陷（stage views allocation failed ×3,479/34min）
│     └─ 与应用无关 ⇒ 任何窗口动画（含托盘展开）都会受影响
└── 非主因（已用数据否定）：输入事件率 × 每事件重排
      └─ 每千次事件 1.2–18.3 ms；1000Hz 最坏实现仅 1.4% CPU；4000 事件/s 下 0 丢帧
```

**因此**：用户的直觉方向（"是机器/环境层面，不是纯 JS"）**正确**；但其设想的**机制（事件洪流 × 每事件重排）被数据否定为主要原因**。真正机制是 **"渲染面积 × DPR² × 弱核显 × 60Hz 上限 + 合成器缺陷"**。这**不是 DSH 独有**的缺陷 —— 同一条流水线上**任何**大面积跟随动画（包括 GNOME 自己的 `ShellTrayIcon`/panelBox 动画竞态）都会受影响。

### 4.3 系统级可改善项 —— **只报告，未动手**（详见 §1.6 表）
按"收益/风险"排序的**建议优先级**（**本审计一律不执行**）：
1. **显示器缩放 150% → 100%（或 200%）**：直接把渲染面从 5120x2880 拉回 3840x2160，**消灭 1.78 倍填充放大与整帧重采样**；风险=UI/字号变化；回滚=Settings→Displays 改回，或还原 `~/.config/monitors.xml`（原值已完整存证于 `raw/display-chain-raw.txt` §7）。
2. **关闭 `x11-randr-fractional-scaling`**：等价于强制整数缩放；回滚=`gsettings set org.gnome.mutter experimental-features "['x11-randr-fractional-scaling']"`（**原值已存证**）。
3. **把显示器改接 RTX 4090 并由 NVIDIA 输出**：收益大但**风险最高**（当前 NVML 报错、4090 状态不明），**不建议**在健康检查前尝试。
4. **鼠标侧降低回报率**（G502 板载/G HUB 降到 500/125Hz）或 `usbhid.mousepoll`：**本审计已用数据证明其收益可忽略（≤1.4% CPU）**，**不建议**为此改输入设置。
5. **提高刷新率**：**不可行**（EDID 上限 60Hz）。
6. **规避 mutter stage-view 缺陷**：属 GNOME/mutter 缺陷，需上游修复；可观察的缓解手段（如减少动画覆盖面、降低同时映射的 X11 窗口数）**未验证**，仅登记。

---

## 5. 方法论、限制与可复现性

### 5.1 纪律遵守
- **全程只读**：未执行任何 `xrandr` 写操作、`gsettings set`、`dconf write`、`xinput set-prop`、`pkill`/`kill`、服务重启、模块重载；**未改动任何显示或输入设置**。
- 未传 `sandbox_permissions`（会话审批已禁用，全部操作在既有沙箱内完成）。
- XI2 采样使用 `timeout 4 xinput test-xi2 --root`：属**被动事件选择**，**不 grab 设备**、不影响其他客户端，且被 `timeout` 强制终止。
- 浏览器仅由次级 subagent 以**独立实例 + 独立 `--user-data-dir`** 启动，并在 `.lock`（`mkdir` 抢占 + `owner.txt`）协议下运行；**未触碰并行线的 `incident2/minimal-page/`**。

### 5.2 已知限制（**不可用于反驳本结论的部分**）
1. **`web_search` 不可用**（上游订阅报错）⇒ **未做外部文献/已知 bug 对照**。
2. **负载污染**：取证期间本机并行运行 5 条工作线（`node`、多个 `headless_shell`、Firefox 内容进程、update-manager 等），`load average ≈ 5.4–6.0`（32 线程）。
   ⚠️ **方法学修正（由输入链路 subagent 指出，本线采纳）**：`ps %CPU` 是进程**生命期均值**，**不是瞬时占用**；因此本报告中引用的 `node 88–90%`、`headless_shell 60–83%` 只能作为"**存在重度并行负载**"的**定性**证据，**不能**当作"某一瞬间在抢占某核"的**定量**证据。
   ⇒ §1.5 的 iGPU `busy% 62–96%` 与 amdgpu IRQ 727/s **不能当作静置基线**；§3.3 的 5120x2880 丢帧率可能**偏悲观**（但 720p 对照组在同负载下仍 0 丢帧，故"面积定律"的**方向**不受影响）。
3. `/proc/<pid>/maps`、`/proc/<pid>/environ` 读取被拒 ⇒ 未能从内核侧直接验证 gnome-shell 的 GL 实现（以 DDX 日志的 radeonsi+glamor 与 `gnome-shell` 的 `gdrv0/gl0` 线程间接佐证）。
4. **Transform 重采样由谁执行未判定**（显示控制器硬件缩放器 or GPU render pass）；需 GPU trace/DC 调试接口（需 root）。故 §1.4 中"1.78 倍**填充率**放大"是确定的，而"重采样开销本身"**未量化**。
5. 次级 subagent 的 XRecord 客户端有结构体布局错误，其事件率数字**作废**；以 §2.7 三路互证为准。
6. 页内成本为**合成事件**注入，绕过真实输入管线与 coalescing（见 §3.1 限定）。
7. `.lock/owner.txt` 中 `pid`/`started_at` 因 heredoc 未展开而写成字面 `$$`/`$(date -Is)`（协议瑕疵，非安全问题）；已在本报告中标注。
8. **浏览器侧 DPR 未取得确认（重要缺口，已如实标注）**：页内成本批次的 Chromium 被加了 `--force-device-scale-factor=1`，其 `devicePixelRatio=1` 属人为产物；`chrome://gpu` 亦导航失败（`net::ERR_FAILED`）。⇒ 本审计**没有**浏览器自报的 DPR/GL_RENDERER。§1.4 的 **DPR = 2.0** 依据改为**服务端三条互证**（mutter `legacy-ui-scaling-factor=2`、`Xft.dpi=192`、`Xcursor.size=48`、`_NET_WORKAREA÷2` 得整数逻辑尺寸），其中 mutter 那一条是**权威输入**而非推断，故该结论强度充分；但"浏览器实际使用多少 DPR"仍属**未直接实测**。
9. **§3.3 面积对照为软件光栅（SwiftShader）**：headless 运行 `unmaskedRenderer` 明确为 `SwiftShader`，未使用核显。故该对照证明的是"**光栅成本随面积线性增长**"这一**受控因果**，**不能**作为"用户核显在 5K 下的真实帧率"的证据；用户真实链路（核显 GPU 合成 5K + 重采样 + snap Firefox）需要**独立的现场 trace** 才能定量。这条缺口是本审计向上一级提交时**最需要后续补齐**的一项。

### 5.3 原始输出清单
```
display-input/
├── audit.md                      ← 本文件
├── raw/
│   ├── display-chain-raw.txt     ← §1 全部显示链路原始查询（258 行）
│   ├── edid-decode.txt           ← §1.2/§1.3 EDID 离线解码（首选时序 594.00MHz/3840x2160@60.000、vrefresh 40–60Hz）
│   ├── compositor-stageview-warnings.txt ← §4.1 第 5b 项 mutter stage-view 分配失败统计（本开机 3,479 条 + 分类 + 逐分钟）
│   ├── xi2-raw-sample.txt        ← §2.4 本线 XI2 4s 采样原始输出（653 KB / 28,757 行）
│   ├── input-01..28-*.txt        ← §2 输入链路原始输出（含 bInterval/USB 拓扑/IRQ/xinput props）
│   ├── input-chain.md            ← 输入链路次级 subagent 完整报告
│   └── input-rate-probe.c, xrecord-validate.c, *.bin  ← 次级 subagent 探针源码（含作废的 XRecord 客户端）
└── page/
    ├── index.html, run.mjs       ← 可复跑的页内成本模型
    ├── raw/*.json (94 个) + raw/SUMMARY-headless.json ← 每轮原始数据与聚合（含 meta/gl/facts）
    └── PAGE-COST.md              ← 次级 subagent 的成本模型报告（**截至本报告落盘时尚未生成**；§3 的结论全部由本线直接读取其 `page/raw/*.json` 原始数据自行计算得出，不依赖该文件）
```
外部引用（**姊妹工作线产物，非本线生成**）：`incident2/cross-app/costmodel/result-*.json`（§3.3 的面积对照）、`incident2/gfx-stack/raw/desktop-mutter-displayconfig-full.txt`（mutter 权威显示配置，独立印证 `legacy-ui-scaling-factor=2` / `x11-fractional-scaling=true`）。

