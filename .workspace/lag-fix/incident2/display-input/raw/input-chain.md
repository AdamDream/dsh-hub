# 输入链路取证报告 — incident2 / display-input

采集时间：2026-09-22 10:32–10:39 (+08:00) · 会话：X11 (DISPLAY=:1)，uid=1001，**全程只读，无任何 set/kill/grab**
证据目录：`/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/display-input/raw/`

---

## 0. 小结（3–5 行）

1. **这是真机，不是虚拟机**：`systemd-detect-virt=none`，`/proc/cpuinfo` 无 `hypervisor` 标志，DMI 为 Gigabyte X870 AORUS ELITE WIFI7 + AMD Ryzen 9 9950X。**不存在 QEMU/VMware/VirtualBox 虚拟指针**，事件来自真实 USB HID。
2. **确实存在高回报率指针设备**：Logitech **G502 HERO Gaming Mouse**(046d:c08b) 挂在 xHCI `0000:74:00.0`，中断 IN 端点 `bInterval=0x01` ⇒ **1000Hz 上限**；另有 VGN V87(258a:027b) 与 VGN DragonFly F1 SE(3554:fb50) 两个 2.4G 接收器，`bInterval` 同为 `0x01`。三设备均为 **USB 全速 12Mbps**（1ms 帧 ⇒ 物理上限 1000Hz）。
3. **但没有任何"输入事件洪流"**：G502 静置时其控制器中断率约 **1–3 次/2.2s**（≈0），鼠标移动时升到 **≈367–433 次/s**；X 层实测指针位置变化率仅 **186–374 Hz**。即事件是"按需产生"，不是持续 1000Hz 灌入。
4. **指针加速未被异常开启**：三只指针设备 `Accel Profile Enabled = 1, 0`（adaptive 开、flat 关）、`Accel Speed = 0.000000`；`natural scrolling=0`、`Send Events=0,0`（未禁用）。**无被用户改过的加速参数**。
5. **倾向：输入链路不是本次卡顿的根因。** 唯一实质的输入侧观察是 G502 的 1000Hz 轮询在移动时给单核制造 ~0.4k IRQ/s（可忽略），而更值得注意的**旁证**是：与本任务无关的 USB WiFi 网卡（MediaTek 0e8d:7961，控制器 `0000:73:00.4`）实测 **≈2473 IRQ/s 全部压在单个 CPU 核(cpu25)**。

---

## 1. 设备清单 — [PASS]

命令与原文：`input-01-devices.txt`(`xinput list`、`xinput list --long`)、`input-02-devinput.txt`(`ls -l /dev/input/by-id/ by-path/`)

X 输入设备（pointer 类，全部挂 `Virtual core pointer`）：

| X id | 设备名 | 备注 |
|---|---|---|
| 18 | Logitech G502 HERO Gaming Mouse | event11 / mouse1 |
| 19 | Logitech G502 HERO Gaming Mouse Keyboard | event12（多功能键） |
| 13 | SINOWEALTH VGN V87 V2 2.4G Dongle Mouse | event9 / mouse0 |
| 11 | SINOWEALTH VGN V87 V2 2.4G Dongle Consumer Control | event6 |
| 15 | VGN VGN DragonFly F1 SE Mouse | event14 / mouse2 |
| 16 | VGN VGN DragonFly F1 SE Consumer Control | event16 |
| 4 | Virtual core XTEST pointer | 合成指针 |
| 2 | Virtual core pointer (master) | — |

`/dev/input/by-id/` 中真实物理设备仅 3 组 USB 前缀：`usb-Logitech_G502_HERO_Gaming_Mouse_209036A04742-*`、
`usb-SINOWEALTH_VGN_V87_V2_2.4G_Dongle-*`、`usb-VGN_VGN_DragonFly_F1_SE-*`。
**全部为真实品牌外设，无任何虚拟化指针命名。**

---

## 2. 每设备属性 — [PASS]

命令：对 `xinput list` 全部 22 个 id 执行 `xinput list-props <id>`，原文见 `input-06-listprops.txt`。

重点属性（三只 pointer 设备）：

| 属性 | id=18 G502 | id=13 VGN V87 Mouse | id=15 DragonFly F1 SE |
|---|---|---|---|
| `Device Enabled` | 1 | 1 | 1 |
| `Device Node` | /dev/input/event11 | /dev/input/event9 | /dev/input/event14 |
| `libinput Send Events Modes Available` | 1, 0 | 1, 0 | 1, 0 |
| `libinput Send Events Mode Enabled` | **0, 0**（未被禁用） | 0, 0 | 0, 0 |
| `libinput Natural Scrolling Enabled` | 0 | 0 | 0 |
| `libinput Accel Speed` | **0.000000** | 0.000000 | 0.000000 |
| `libinput Accel Profiles Available` | 1, 1, 1 | 1, 1, 1 | 1, 1, 1 |
| `libinput Accel Profile Enabled` | **1, 0**（adaptive） | 1, 0 | 1, 0 |
| `libinput Accel Profile Enabled Default` | **1, 0, 0**（默认 flat！） | 1, 0, 0 | 1, 0, 0 |
| `libinput High Resolution Wheel Scroll Enabled` | 1 | 1 | 1 |
| `libinput Scrolling Pixel Distance` | 15 | 15 | 15 |

**判定：指针加速处于"adaptive + speed 0"**。注意 `Accel Profile Enabled Default=1,0,0` 说明默认是 flat，
运行时被置为 adaptive —— 但 `Accel Speed=0.0`，两者都不构成"加速被异常拉高"的证据；
**G502 的 DPI 由鼠标固件/板载配置决定，X 层无 DPI 属性可读**（`grep -i "dpi\|poll"` 无命中，见 `input-27-misc.txt`），
未安装 ratbagctl/piper/solaar ⇒ **无法从软件侧确认鼠标 DPI 与"是否被设成 1000Hz/8000Hz"**。

---

## 3. USB HID 报告率（bInterval）— [PASS]

命令/原文：`input-04-binterval.txt`（遍历 `/sys/bus/usb/devices/*/` 的接口与端点）、`input-03-usb-devices.txt`

```
### Logitech G502 HERO (046d:c08b)  9-1.3  speed=12 (USB 全速)  via hub 9-1
  iface 9-1.3:1.0  class=03 sub=01 proto=02 driver=usbhid
     ep_81: type=Interrupt dir=in interval=1ms bInterval=01 wMaxPacketSize=0008
  iface 9-1.3:1.1  class=03 sub=00 proto=00 driver=usbhid
     ep_82: type=Interrupt dir=in interval=1ms bInterval=01 wMaxPacketSize=0014

### SINOWEALTH VGN V87 V2 2.4G Dongle (258a:027b)  1-2  speed=12
  iface 1-2:1.0   ep_81 bInterval=01 (1ms)   wMaxPacketSize=0008
  iface 1-2:1.1   ep_82 bInterval=01 (1ms)   wMaxPacketSize=0019

### VGN DragonFly F1 SE (3554:fb50)  1-3  speed=12
  iface 1-3:1.0   ep_81 bInterval=01 (1ms)   wMaxPacketSize=0008
  iface 1-3:1.1   ep_82 bInterval=01 (1ms)   wMaxPacketSize=0011
```

- 三个设备**所有中断 IN 端点 `bInterval = 0x01`**；且 `speed = 12`（USB 2.0 **全速**）。
- 全速 USB 的帧长固定 1ms，**bInterval=1 已是物理上限 ⇒ 1000Hz**。`usbhid.mousepoll=0`（`input-12-hwdb.txt`）
  表示未做内核轮询覆盖；**hwdb(`/usr/lib/udev/hwdb.d/`, `/etc/udev/hwdb.d/`) 中 046d:c08b / 258a:027b / 3554:fb50 均无任何条目**
  ⇒ **`bInterval=1ms` 就是该设备真实的报告周期，无覆盖**。
- **高回报率设备存在：是**（G502 HERO，1000Hz 上限）。

USB 拓扑与控制器归属（`input-10-usb-topology.txt`、`input-24-irq-map.txt`）：

| 设备 | 路径 | xHCI 控制器 | 驱动 IRQ | IRQ 绑定核 |
|---|---|---|---|---|
| G502 HERO | usb9 → 9-1(hub 4p) → 9-1.3 | `0000:74:00.0` | 81 | **仅 cpu26** |
| VGN V87 Dongle | usb1 → 1-2 | `0000:0d:00.0` | 47 | **仅 cpu22** |
| VGN DragonFly F1 SE | usb1 → 1-3 | `0000:0d:00.0` | 47 | **仅 cpu22** |
| MediaTek WiFi(非输入) | usb7/8 → 8-2.3 | `0000:73:00.4` | 73 | **仅 cpu25** |
| amdgpu 显示 | — | `0000:73:00.0` | 134 | **仅 cpu5** |

注意：G502 走 `74:00.0`（**与显示用的 amdgpu 73:00.0 是不同 PCI 设备**），VGN 双设备与键盘共走 `0d:00.0`。

---

## 4. 内核识别到的设备名 — [PASS]（**明确排除虚拟化指针**）

命令/原文：`input-05-proc-input-devices.txt`、`input-28-notes.txt`

真实 HID 设备（`Bus=0003` = USB）：

- `Logitech G502 HERO Gaming Mouse` — `Uniq=209036A04742`，`Phys=usb-0000:74:00.0-1.3/input0`，`Handlers=mouse1 event11`
- `Logitech G502 HERO Gaming Mouse Keyboard` — 同 Uniq，`Handlers=sysrq kbd event12`
- `SINOWEALTH VGN V87 V2 2.4G Dongle Mouse` — `Phys=usb-0000:0d:00.0-2/input1`，`Handlers=mouse0 event9`
- `VGN VGN DragonFly F1 SE Mouse` — `Phys=usb-0000:0d:00.0-3/input1`，`Handlers=mouse2 event14`
- 其余为 `Power Button`、`Video Bus`、各 HDA 音频节点。

**全部 `N: Name=` 列表中没有任何 `QEMU*` / `VirtualBox*` / `VMware*` / `Xen*` / `Virtual*` 指针或键盘。**
⇒ **不是虚拟化指针；事件来自宿主物理 USB 设备**（与本机是真机一致）。

---

## 5. 事件率实测 — [PARTIAL / INCONCLUSIVE]

### 5.1 `xinput test-xi2` — 放弃执行（会 grab）

`xinput test-xi2 <device>` 内部走 `XIGrabDevice` 主动独占抓取。按任务纪律（不得 grab 输入设备）
**未执行**，记录于 `input-28-notes.txt`。

### 5.2 自建 XRecord 只读探针 — 已构建，但本会话交付 0 事件（已证非"鼠标静置"）

- 源码 `input-rate-probe.c` / `xrecord-validate.c`，二进制 `input-rate-probe.bin` / `ptrmotion.bin`。
  XRecord 是**被动 tap**，不 grab、不消费事件，无权限要求。
- 因本机**未安装 `X11/extensions/record.h`**（只有 libXtst.so.6），struct 布局自行声明；
  我用**原始内存 dump 反推并用服务器不变量校验**，确定布局为
  `id@0, category@8, server_time@12, client_seq@16, server_seq@24, data_len@32, data@40`（48B）。
  证据：`input-15-xrecord-validate.txt`、`input-16-rawdump.txt`、`input-19-rawdump2.txt`。
  首个事件恒为 `category=4 (XRecordStartOfData), data_len=0` ✓ → **上下文确实建立成功**。
- **但之后只收到 StartOfData，0 个输入事件**。这是有对照的，不是鼠标静置造成的假象：
  - `input-20-concurrent.txt`：同 8 秒窗口内 `ptrmotion` 测到 **231 次位置变化**，XRecord 仍为 **0**。
  - `input-21-clientspec.txt`：CurrentClients / AllClients 两种 client spec 各跑 6 秒，
    期间指针分别变化 **1772 / 1661** 次，XRecord 均为 **1**（仅 StartOfData）。
- 结论：**本环境下 XRecord 对非特权客户端不投递核心输入事件**（可能与 GNOME Shell 的 XI2 路径、
  或该 Xorg 构建的 record 行为有关，我未做进一步越权排查）。
  ⇒ **"X 层事件率"这一项标记 INCONCLUSIVE（未测到），不伪造数字。**

### 5.3 可行替代：指针位移真值 + xHCI 中断增量（已交叉验证）

`ptrmotion.bin` 用 `XQueryPointer` 轮询（**纯查询，不 grab**）测指针位置变化率；同时采样
`/proc/interrupts` 中 G502 所属控制器 `74:00.0` 的增量。5 次 2.2 秒试验（`input-26-g502-rate.txt`）：

| 试验 | G502 控制器中断增量(≈2.2s) | 换算 | 指针位置变化次数 | 移动距离(px) |
|---|---|---|---|---|
| 1 | 3 | ≈1.4 /s | 0 | 0 |
| 2 | **809** | **≈368 /s** | **557** | 3002 |
| 3 | 7 | ≈3 /s | 2 | 2 |
| 4 | 3 | ≈1.4 /s | 0 | 0 |
| 5 | 4 | ≈1.8 /s | 0 | 0 |

**相关性极强：鼠标移动 → 中断率约 368/s；鼠标不动 → 约 0–3/s。**
另 10 秒窗口（`input-22-irq-10s.txt`、`input-23-ptrmotion-10s.txt`，期间指针变化 2062 次）：
G502 控制器 **2195 次/10s = 219.5 IRQ/s**；2 秒窗口（`input-09/11`）曾录得 **433.5 IRQ/s**。

⇒ **G502 的实际 HID 报告率随活动在 ~0 → ~370–433 /s 之间浮动，静置时归零。**
注意这里测到的是 **xHCI 中断（=USB 报告事务）与 X 可见位移事件**，**低于** 1000Hz 的端点上限，
原因可能是 X/合成器把连续运动合并（coalescing）后只暴露部分事件，**也可能**鼠标自身被设成较低回报率；
**两者我无法用现有权限区分**（见第 8 节）。

### 5.4 CPU 只读快照 — [PASS]

`input-08-cpu-snapshot.txt`、`input-25-load.txt`：

```
load average: 5.36, 5.88, 5.11     (nproc = 32 逻辑核 / 16 物理核)
PID     PSR  %CPU %MEM COMMAND
10806    19  90.3  6.9 node
145541   17  83.1  0.2 headless_shell
151865   14  40.0  0.0 bash
10350    24  26.6  1.2 Isolated Web Co
9042     11  18.3  1.9 firefox
4139     13   9.7  0.6 gnome-shell
10133     5   8.2  0.5 Isolated Web Co
6458     15   5.2  0.3 update-manager
4535      8   5.0  0.1 LAgentUser
3884     12   3.5  0.4 Xorg
```

- **Xorg 仅 3.5% CPU、gnome-shell 9.7% CPU、合成线程(cs0) 0.2%** ⇒ 输入/合成链路自身不吃 CPU。
- 消耗主要来自与本任务无关的用户态进程（node、headless_shell、firefox/Web 内容进程、update-manager）。
- ⚠️ **限制**：`ps -eo %CPU` 是**进程生命期平均值**而非瞬时值，因此"node 90%"不等于当前占用 90% 核；
  不过它足以说明**存在与输入无关的系统级 CPU 抢占**。load average 5.36 主要来自这些用户态进程，
  **不是** xHCI/amdgpu 中断（合计约 3.3k IRQ/s，即使按最坏 1 中断 5µs 估算也只有 ~1.7% 单核）。

---

## 6. 虚拟化判断 — [PASS]（**明确排除**）

`input-07-virt.txt`：

```
systemd-detect-virt        -> none                (rc=1)
systemd-detect-virt --vm   -> none                (rc=1)
/proc/cpuinfo hypervisor   -> 无 hypervisor 标志  (裸金属)
DMI product_name           -> X870 AORUS ELITE WIFI7
DMI sys_vendor             -> Gigabyte Technology Co., Ltd.
DMI board_name             -> X870 AORUS ELITE WIFI7
DMI bios_version           -> F3
CPU                        -> AMD Ryzen 9 9950X 16-Core Processor
nproc                      -> 32
```

⇒ **不是虚拟机。刷新率 / DPR / 输入整条链路都是物理链路，"虚拟显示链路"这一根因假设不成立、可排除。**

---

## 7. 自定义 xrandr 启动脚本 / 缩放来源 — [PASS]

`input-14-config.txt`、`input-27-misc.txt`：

- `grep -rl "xrandr" ~/.config/autostart/ /etc/xdg/autostart/ ~/.profile ~/.bashrc ~/.xprofile /etc/X11/xorg.conf.d/`
  ⇒ **无任何命中**。**没有自定义 xrandr 启动脚本**，因此 5120x2880 不是脚本 `--scale` 造出来的。
- `/etc/X11/xorg.conf.d/` **只有 `99-TWatermarkExt.conf`**（内容仅 `Section "Module" Load "twatermarkext"`，
  与显示/输入无关；注意有一个非标准 `twatermarkext` 扩展，见 §5.2 的 X 扩展列表）。
- `~/.config/monitors.xml` 给出**缩放真正的来源**：
  ```xml
  <logicalmonitor><scale>1.5</scale>
    <monitor><connector>HDMI-0</connector><vendor>GSM</vendor>
      <product>LG ULTRAFINE</product><serial>606NTUWJK582</serial></monitorspec>
    <mode><width>3840</width><height>2160</height><rate>60.000</rate></mode>
  ```
  ⇒ GNOME 以 **1.5 倍分数缩放**把逻辑桌面设为 3840×2160×1.5 = **5120×2880 framebuffer**，
  再由 xrandr Transform(1.333328 = 1.5×0.8889, bilinear) 压回 **CRTC mode 3840×2160@60Hz**。
  **这正是"screen=5120x2880 而 CRTC=3840x2160"的成因**，属于 GNOME 分数缩放 + 实验特性
  `['x11-randr-fractional-scaling']`（`gsettings get` 只读确认）的正常结果，**非异常配置**。
- 该 1.5→1.333 的重采样发生在**显示输出**侧，**不介入输入事件路径**（输入只需坐标换算）。

---

## 8. 四项明确判定

### 判定 1：高回报率设备存在？ — **是（存在），但未构成洪流**
Logitech **G502 HERO**(046d:c08b) 中断 IN 端点 **`bInterval=0x01` ⇒ 1000Hz 上限**（`input-04-binterval.txt`）；
另两只 VGN 接收器同为 `bInterval=0x01`。三者均 USB 全速 12Mbps。hwdb 无覆盖、`usbhid.mousepoll=0`。

### 判定 2：虚拟化指针？ — **否（明确排除）**
`systemd-detect-virt=none`、无 `hypervisor` 标志、DMI=Gigabyte X870 AORUS ELITE WIFI7、
`/proc/bus/input/devices` 无任何 QEMU/VirtualBox/VMware 设备。**事件来自物理 USB HID。**

### 判定 3：指针加速？ — **未异常开启**
三只 pointer 设备 `Accel Profile Enabled=1,0`（adaptive）、**`Accel Speed=0.000000`**、`Natural Scrolling=0`、
`Send Events Mode Enabled=0,0`（未被禁用）。**无用户改过的加速/禁用参数。**
（注意 `Accel Profile Enabled Default=1,0,0` 即默认 flat，运行时为 adaptive，但 speed 为 0。）

### 判定 4：输入事件洪流？ — **否（无洪流）**
G502 静置时控制器 **1–3 中断/2.2s ≈ 0**，移动时 **368–433 /s**；X 层位移变化率 **186–374 Hz**。
事件"按需产生"并随静止归零。Xorg 3.5% / gnome-shell 9.7% / 合成线程 0.2% CPU，输入链路未表现为 CPU 负担。
**副作用观察（非输入设备）**：USB WiFi 网卡控制器 `73:00.4` 实测 **≈2473 IRQ/s 且 100% 压在单核 cpu25**，
量级是 G502 的 6–11 倍，属"与本任务无关但可能制造单核争抢"的旁证。

---

## 9. 我最不确定的一项及原因

**最不确定：G502 在"移动中"的真实 HID 报告率到底是 1000Hz 还是更低，以及 X 侧是否对运动做了合并。**

原因：可用的三条独立路径都受阻——
1. `xinput test-xi2` 会 grab，按纪律放弃；
2. `libinput debug-events` / 直接读 `/dev/input/event*` **无权限**（uid 1001 不在 `input` 组，
   `event11/9/14` 均 `NOT readable without root`，见 `input-13-tools.txt`），按纪律不提权；
3. 自建 XRecord 被动探针**在本环境只投递 StartOfData**，已用并发对照排除"鼠标静置"的解释，
   仍拿不到 X 层事件率。

因此我有的是**间接量**：USB 事务中断率（移动时 368–433/s）与 X 可见位移事件率（186–374/s）。
两者**低于**端点 `bInterval=1` 所允许的 1000Hz，但这既可能是
**X/mutter 运动合并（coalescing）**所致（那样鼠标其实仍在 1000Hz 上报），
也可能是**鼠标被设成 125/500Hz**。**用现有权限无法区分这两者**，需要
`libinput debug-events`（root/input 组）或用户主动移动鼠标时的高精度 evtest 采样才能定论。
另外 **G502 的 DPI 无法从软件侧读取**（无 X 属性、未装 ratbag/piper），
若 DPI 很高会放大"欠采样手感"，属未测项。

次级不确定：`ps` 的 %CPU 为生命期均值，"node 90%"不能当作当前瞬时抢占证据；load 5.36 的构成未逐进程量化。

---

## 10. 原始证据索引

| 文件 | 内容 |
|---|---|
| `input-01-devices.txt` | `xinput list` / `list --long` 全文 |
| `input-02-devinput.txt` | `/dev/input/by-id/` `by-path/` `ls -l` |
| `input-03-usb-devices.txt` | 全 USB 设备 vid/pid/manufacturer/product/speed |
| `input-04-binterval.txt` | **三设备接口与端点 bInterval（关键）** |
| `input-05-proc-input-devices.txt` | `/proc/bus/input/devices` 全文（Name/Phys/Uniq/Handlers） |
| `input-06-listprops.txt` | 22 个 X 设备的 `xinput list-props` 全文 |
| `input-07-virt.txt` | 虚拟化检测 + DMI + cpuinfo + nproc |
| `input-08-cpu-snapshot.txt` | ps top15 / uptime / interrupts 初快照 |
| `input-09-irq-delta.txt` `input-11-irq-analysis.txt` | 2 秒中断增量及其速率分析 |
| `input-10-usb-topology.txt` | `lsusb -t` + 控制器 PCI 归属 |
| `input-12-hwdb.txt` | hwdb/rules 无覆盖 + `usbhid` 参数 |
| `input-13-tools.txt` | 工具可用性、`/dev/input` 可读性（无权限证据） |
| `input-14-config.txt` | 无 xrandr 脚本、xorg.conf.d、monitors.xml 存在性 |
| `input-15…16,19` | XRecord 布局校验与原始内存 dump（布局取证） |
| `input-17` `input-20` `input-21` | XRecord 0 事件及**并发对照**（21 含 client spec 对比） |
| `input-18` `input-23` `input-26` | `XQueryPointer` 位移真值 + 与中断率的关联 5 次试验 |
| `input-22` `input-24` `input-25` | 10 秒中断窗口、IRQ→CPU 映射、负载归因 |
| `input-27-misc.txt` | 缩放设置只读、无 ratbag/piper、X 无 DPI 属性 |
| `input-28-notes.txt` | test-xi2 放弃说明 + 设备名清单（排除虚拟指针） |
| `input-rate-probe.c` / `.bin` | 自建 XRecord 被动事件率探针（源码+二进制） |
| `xrecord-validate.c` / `ptrmotion.bin` | 布局校验器 / 指针位移真值探针 |

> 纪律声明：本次取证**未执行任何写操作**——无 `xrandr` 改参、无 `gsettings set`（只用 `get`）、
> 未写 `/etc/X11`、未 `kill`/`pkill` 任何进程、未重启服务、未 grab 任何输入设备、未提权。
> 所有产物仅写入本代理独占目录 `raw/`。（该目录下 `display-chain-raw.txt`、`xi2-raw-sample.txt`
> 为**其他代理**的产物，本代理未触碰。）
