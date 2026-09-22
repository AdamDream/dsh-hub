# incident2 摘要：用户可感卡顿（DSH 设置页 + Codex 悬停/跟手动效）

- 触发：用户 2026-09-22 报告"**没做重活，只是打开网页界面点设置就卡**"，并补充"**在 Codex 界面（悬停展开托盘 + 跟随鼠标波纹动效）同样卡**，故怀疑不一定是 DSH 本身的问题"
- 宿主：PID 10806（09-22 10:06 启动；机器 10:01 刚重启）
- 已生效修复：ui-layout `82cca1a6178a`、wallpaper `826d9217a8fc`、runtime `5559de4ce28c`、usage `4536b91ed282`

## 一、系统级争用：**不存在**（PASS）

- **CPU PSI `full total = 0 µs`**（整个 34 分钟启动期）⇒ 从未出现"所有可运行任务一起等 CPU"
- 7 种独立口径一致：整机 **89–93% 空闲**，累计利用率 **5.19%**
- 无 cgroup 限流（全树 `nr_throttled 0`）、无降频（32 核 `performance`、实测 5.20–5.66 GHz、Tctl 64°C）、无内存/IO 压力（PSI memory `total=4µs`、swap 零使用、`vmstat b=0`）
- 启动期无 AER/NMI/MCE/OOM/hung task
- **三类占比**：DSH 宿主 **46.1%**（1515 CPU-s）＞ 用户进程 44.5% ＞ 第三方代理 OCular 5.4% ＞ 系统守护 3.7% ＞ **我的子代理进程 0.3%**
- 残留不确定性：宿主的 CPU 是否由"子代理工作"驱动，**从进程外部无法切分**（需宿主侧 profiler）

## 二、图形/显示环境：**不具备稳定 60fps 的前置条件**（FAIL）

| # | 事实 | 证据 |
|---|---|---|
| **G1** | **合成器渲染 5120×2880 再双线性缩到 3840×2160 ⇒ 每帧 1.78× 过绘 + 全屏重采样**，且跑在**仅 2 个 CU** 的 AMD Raphael 核显上 | `xdpyinfo` 5120x2880/144dpi；`xrandr` mode `3840x2160 60.00*+`；`Transform: 1.333328 … filter: bilinear`；Xorg 日志 `Allocate new frame buffer 5120x2880`；内核 `active_cu_number 2` |
| **G2** | 面板**原生即 4K@60**（EDID `3840x2160 +preferred`），**5K 是分数缩放造出来的**；**RTX 4090 一个显示口都没接**（`card1-*` 全 disconnected） | EDID + `xrandr` + `ls /sys/class/drm` |
| **G3** | **企业 DLP 的 X 扩展 `twatermarkext` 已装入运行中的 Xorg 并注册**；配套 `/usr/local/.OCular/` + 树外内核模块 `LSDEfs` 已加载 + 服务 `startLSDEfsSvr` active（357 tasks/385MB） | `/etc/X11/xorg.conf.d/99-TWatermarkExt.conf`；Xorg 日志 `Loading … libtwatermarkext.so`；`xdpyinfo` 扩展表 |
| **G4** | **系统强制 a11y**：`/etc/environment` 导出 `ACCESSIBILITY_ENABLED=1`/`GNOME_ACCESSIBILITY=1`；`/etc/environment.d/90atk-adaptor.conf` 强制 `GTK_MODULES=…gail:atk-bridge`；**5 个进程带 `--force-renderer-accessibility`**；而用户自身 a11y 偏好全 false | 配置文件 + 进程命令行 |
| G5 | Mutter 舞台视图分配失败 **441,883 条**（覆盖 `[MetaWindowActorX11]`，每个 X11 客户端）；**因果未证** | journalctl |
| G6 | 驱动真告警：`REG_WAIT timeout … optc31_disable_crtc`、`Unknown EDID CEA parser results ×6`（链路报 300MHz TMDS 却跑 594MHz 模式） | journalctl |
| G7 | `gpu_busy_percent` **自相矛盾不可信**（`busy=0` 配 `sclk=2200*`、`busy=100` 配 `sclk=600*`）⇒ **不得据此宣称 GPU 饱和** | /sys |
| G8 | `pm_runtime_work hogged CPU >10000us` 复现（4→11 次）；mt76/amdgpu kworker 反复 D 态（D≤5） | journalctl |

**为什么它能同时解释两处症状**：G1/G2/G3/G4 都作用在**所有 X11 客户端共享的渲染路径**上 ⇒ DSH（Firefox）与 Codex（Electron 26.9）**都会**受影响。

## 三、被推翻的既有假设（勿重开）

| 假设 | 结论 | 证据 |
|---|---|---|
| snap Firefox 沙箱/GPU 受限是主因 | **排除** | 图形设备 `renderD128/D129/card1/card2` 对该用户全部 `rw-`；图形 plug 全 connected；自报 `AdapterDriverVendor: mesa/radeonsi`、`GpuSandboxLevel: 0` |
| 高回报率鼠标导致跟手动效掉帧 | **NOT SUPPORTED** | 三只鼠标均 USB **Full Speed 12Mbps**（≤1000Hz），屏仅 60Hz |
| `chrome trap int3` 是异常 | **推翻** | 26 条全在审计开始后、全部为 **Playwright 自带 chromium/headless_shell**、同一偏移、同期有 gdb 会话、`segfault=0` ⇒ 我方工具链产物 |
| "订阅即回调"导致打开就卡 | **否证** | zustand `fireImmediately` **全库 0 处调用** |
| 打开设置触发 forced reflow | **否证** | 2 秒窗口内 1 次布局读取、**0 次写后读** |

## 三bis、**两个独立元凶**（14 条线收敛结论，2026-09-22 上午）

### 元凶 ①（DSH 侧，**我方 B1 回归**）：宿主 `session.list` 算法级慢

- 代码事实（本人复核）：`dsh-host-apiproxy/lib/index.js:2237` 的比较器直接调 `sessionListMetadata(events)`
  （`for (const event of events) …` **整条事件流折叠、无 memo**）⇒ 每次排序折 **O(N log N)×2** 遍全事件流
- 实测：**本人 6 次 0.31 / 1.11 / 1.15 / 1.56 / 2.45 / 2.52 s**；他线点击相位 p50 **8.71 s** / max 10.26 s；`subagent.list` p50 3.55 s
- 对照：同窗 `settings.describe` 中位 **12 ms**（相差 **321×**），归属明确
- 后果：`session.list` 落地瞬间触发 **38 次连发 commit × 每次重建 600 fiber**（整树重渲染）
- **已修并写入 deployed**：`.workspace/lag-fix/hotfix-b1perf/apply-B1-perf-hotfix.mjs`
  （先算一次 recency 再排序；语义不变；两文件各命中 1 次贵比较器并已消除；语法/标识符校验通过；
  pre-image `backup/B1perf-20260922-025156/`）—— **待重启生效**
- 附带发现（未修，非我方引入）：`dsh-storage-json/lib/index.js:220` 每写一条记录就重写整个 **9.86 MB** pretty-print projcache（≈29 次/3s ≈ +0.5 核常驻）

### 元凶 ②（环境侧）：DPR=2 超采样 + mutter 缺陷，对**所有**应用一视同仁

- **DPR=2.0 + 5120×2880 超采样**：`monitors.xml` 写 scale 1.5，但 X11 上 mutter 按 `ceil(1.5)=2` 渲染
  ⇒ 逻辑 2560×1440、**帧缓冲 5120×2880（14.75 Mpx）** → `Transform 1.333328` + bilinear → CRTC 3840×2160（8.29 Mpx）
  ⇒ 每帧**多渲染 1.78× 像素**并整帧重采样；应用侧因 DPR=2 光栅面积 ×4
  三路互证：mutter `legacy-ui-scaling-factor = 2`、`Xft.dpi=192`、`Xcursor.size=48`、`_NET_WORKAREA 4988×2816`
- **受控面积实验**（同一份"跟随鼠标 ripple"，仅改视口）：
  `1280×720` → **60.01 fps / 丢帧 0 / p95 16.75 ms**；`5120×2880` → **44.25 fps / 丢帧 14（26.4%）/ p95 30.3 ms**；
  两者单帧 JS 都只有 **0.1–0.2 ms** ⇒ **卡在呈现侧，不在 JS/事件侧**
- **mutter stage-view 分配失败 3,479 条/本次开机**（`/var/log/syslog` 累计 28,193），主体 `MetaWindowActorX11`/`MetaSurfaceActorX11`，
  **并含 `[ShellTrayIcon]`、`panelBox`、`Gjs_ui_panel_Panel`** —— **`ShellTrayIcon` 正是用户描述的"托盘"那个 actor**；应用无关
- 合成跑在**2 CU 的 AMD Raphael 核显**上；**RTX 4090 仅作 Sink Offload 且 `nvidia-smi` 报 NVML 错**

### 元凶 ③（第三方，**非 DSH**）：Codex 桌面应用的动效实现

- 从 `app.asar` 字节级证实用户描述：`proximityEnterDistance:40 / proximityExitDistance:56` 的悬停托盘（浮动 mascot 窗口），
  波纹是 **rAF 逐帧改写 SVG 径向渐变 `rippleStops` 的 offset**
- 成本律（受控）：`ms/帧 ≈ 1.44 ms/Mpx × (canvas surface + 动画填充面积)` —— **成本跟 backing surface，不跟肉眼可见效果大小**：
  只覆盖屏幕 **0.053%** 的波纹仍要 **19.4 ms/帧**（挂在 14.746 Mpx 整窗 canvas 上）；同为可见像素，
  波纹尺寸 canvas **2.2 ms**、DOM `transform` **0.1 ms**（**214–252× 便宜**）

### 「点设置」这一下本身**不是**瓶颈（四条线独立收敛）

| 观测 | 值 |
|---|---|
| click→面板可见 | **13.2–19.8 ms**（5 次极稳定；复开 13.7–15.0 ms） |
| 客户端长任务 | **0**（窗口内 0 帧 ≥50 ms；Chrome trace 里最长任务 25.7 ms） |
| 形态 | 每次点击 = 一个 22.7–32.3 ms 长帧 + 一个 2.1–10.3 ms 短帧 ≈ **恰丢 1 帧（一个 vsync）** |
| 点击触发的 RPC | **仅 `agentPreset.list`**（面板读客户端 `SettingsDescribeMirror` 快照，**不重发 `settings.describe`**） |
| 宿主心跳（点击 RPC 飞行期间） | p50 **2.7–44.9 ms** ⇒ **该 RPC 不是长同步阻塞** |
| 宿主停顿与点击的关系 | 5 次中 4 次在点击后 500 ms 内有 ≥100 ms 停顿，但**点击窗÷点击前窗 p95 比值仅 0.66–1.38，与"是否点击"无稳定关系**；且有点击前 1451 ms 的 953 ms 停顿 ⇒ **不点也会卡** |

**四个补丁的靶点在点击相位全部不执行**（主题 `apply`/rAF 延后/usage 9 路/P2AC 回拷均为 0 次）；
**"补丁引入新成本"不成立**（每条件落在 base 噪声区间）。⇒ 它们与该路径**不相交**（不是错，是没打到）。

### headed 测量在本环境**不可能**（诚实边界）

4 次尝试 + 4 组配方全部在 **97–109 ms 内崩溃**（`chrome_crashpad_handler: --database is required` + `recvmsg: 连接被对方重置`）；
已排除 X 问题（`:1` 是真 X.Org，`xclock` 可起窗列出）；`xvfb-run` 不存在 ⇒ **headless/headed 差异 = INCONCLUSIVE（样本缺失）**，
**不得**写成"两者相同"。另：面积对照批的 Chromium 被加了 `--force-device-scale-factor=1` ⇒ 其 `devicePixelRatio=1` 是**人为产物**，不可作证据。



- 点击设置：`onClick: () => setOpen(true)`（纯局部 state）→ 挂载 `SettingsPanel` → 只渲染激活 section → `GeneralSection` 挂 6 行；**页内仅发 1 条 RPC（`agentPreset.list`），无 `settings.describe`**（面板读客户端镜像快照）
- 一条线测到 2 秒窗口 **3 个长任务 = 233ms、首帧 166.6ms**（重开减半）；另一条的**真实 Chrome trace** 里点击窗口 2102ms 内**最长任务仅 25.7ms** ⇒ 两者张力**待裁决**（疑为"首次加载期 vs 稳态点击期"的差别）
- 值得跟进的 DSH 侧线索：`AgentPresetRow` 每次打开都发 RPC 且宿主侧无缓存门；`WallpaperRow` 以"行挂载"当页面信号触发全局重铺 + 渲染 2.33MB 预览图；workspace-enhancement 全文档 MutationObserver 被 176 个新节点触发

## 三ter、**浏览器判别（用户实测 11:0x）——把问题切成两半**

| 环境 | 用户实测 | 推论 |
|---|---|---|
| **Firefox**（Gecko） | **全局都卡**（"啥也不行"） | **环境/Gecko 侧**：环境强开 a11y（`/etc/environment` 导出 `ACCESSIBILITY_ENABLED=1` + `GTK_MODULES=…atk-bridge`；Chrome 内容渲染不走 GTK 故不受影响）／软件 WebRender／分数缩放+DPR2 重光栅 —— 三条线在查 |
| **Chrome**（Blink） | **整体流畅**，**仅两处卡**：① 通用设置/插件/设置栏目**之间切换与滚动**有小卡顿；② **点击插件页**卡。其余功能页流畅 | 这两处是**真实、可在可用浏览器里复现的 DSH 侧成本** —— 三条线在查 |

**方法学后果**：用户该观察**证伪"共享合成器对全部 X11 客户端一视同仁"**（Chrome 同为 X11 客户端、同样拿 5120×2880 画布，却流畅）⇒ 环境结论降级为"**放大器**"，**主因按浏览器分叉**。

**与既有证据对齐**：早先独立一条线报过「**唯一"贵"的是插件页常数大（客户端 ≤115 ms）、插件清单渲染 149 个 SVG**」⇒ ≥115ms 已超长任务阈值，与用户主观感受一致；**插件页成为首个同时有用户复现背书与机器证据的 DSH 靶点**。


## 五、待用户执行的决定性动作（按性价比）

| # | 动作 | 判定价值 |
|---|---|---|
| **H1** | **抬头看屏幕有没有淡色重复水印**（DLP 是否真在每帧绘制） | 0 成本，直接坐实/排除 G3 |
| **H2** | **缩放改回 100%（原生 3840×2160@60）** + 清理陈旧 `~/.config/monitors.xml` + **显示器线从主板 HDMI 改插到 RTX 4090** | **最高杠杆**：同时消除 G1/G2 的 1.78× 过绘与 2-CU 瓶颈 |
| **H3** | Firefox `accessibility.force_disabled=1` 复测；再与 IT 讨论 `/etc/environment` 的 A/B | 验证 G4 对 Chromium/Electron 的影响 |
| **H4** | 换浏览器（Chromium/Chrome）开同一页面点设置 | 现降级为**对照**（因 snap Firefox 已排除）；若两者同卡 ⇒ 指向 G1–G4 共享路径 |
| **H5** | **重开 Codex 客户端**（审计时它未运行）后复测悬停/跟手动效 | 唯一能活体复现"跨应用同症状"的方式 |

## 六、测量纪律（本轮新增，必须遵守）

1. **并发普查禁用会自匹配的 `pgrep -f`**；按 `/proc/<pid>/exe` 精确统计（安静时前者报 2、实际 0）
2. **`monitorEventLoopDelay` 会丢弃 `reset()` 后第一个样本**（3s 阻塞报 10ms）⇒ 阻塞测量禁止在阻塞前 reset
3. 探针**必须接管 `SIGINT/SIGTERM/SIGHUP`**（Node 默认不触发 `exit` ⇒ 孤儿浏览器 + 死锁锁）
4. 锁释放必须 `rm owner.txt && rmdir`（目录非空时 `rmdir` 静默失败）
5. **禁止 `pkill`/`kill` 共享资源**；发现异常只记 PID
6. **禁止在调查中调用会变更显示状态的命令**（`xrandr` 查询已实测触发 EDID 重探测；`gsettings monitor` 曾空转占 1 核 1 分钟）
7. 绝对性能数字一律标注并发条件；结论用**运行内 pre 窗对照**
8. ⚠️ **引擎口径陷阱**：**Gecko 会静默接受 `longtask`/`long-animation-frame` 观察器却永不投递**（阳性对照：三次 200ms 阻塞下 Blink 报 2/3 条、**Gecko 报 0/0**）⇒ **"Firefox 无长任务"是 API 缺失，不是不卡**；任何 LongTask 判据必须先做阳性对照
9. ⚠️ **DPR 必须页内读回自证**（Blink 用 CDP `Emulation.setDeviceMetricsOverride`；早期某批的 `--force-device-scale-factor=1` 是人为产物）
10. **Gecko 可运行配方**：直接 exec snap 载荷 + WebDriver BiDi；**`HOME` 必须可写**、私有 profile + `--no-remote --new-instance`；headless Gecko 走 **SWGL 软件 WebRender**（绝对 ms 不可外推，同引擎相对比较有效）
11. **历史 Xorg 日志通道**：`/var/log/Xorg.*.log*` 不存在，但 **gdm 把整份 X 日志转发进 journald** ⇒ `journalctl -b -N` 可完整恢复已轮转删除的旧 boot 图形日志

## 七、★ 环境时间轴（已用遥测本体证伪"17:18 切换"）

**纠正**：此前各线引用的 `2026-09-20 17:18` **不是切换时刻，而是 Firefox 遥测 ping 的创建时刻**（`creationDate 2026-09-20T09:18:43.486Z` = CST 17:18:43，`reason=environment-change`）。

**物理切换实际生效于 `2026-09-20 11:10:42` 开机时刻**（落在 09-18 17:42:05 → 09-20 11:10:42 的关机空档内），比 17:18 早 **6h08m**。

四层证据同时翻转（boot −2 → boot −1）：

| 维度 | boot −2（4090 时代） | boot −1 / boot 0 |
|---|---|---|
| 固件 boot-VGA | `(--) PCI:*(1@0:0:0) 10de:2684` | `(--) PCI:*(115@0:0:0) 1002:13c0` |
| X 主屏 | `(II) NVIDIA(0): RTX 4090 (AD102-A) at PCI:1:0:0` | `(--) AMDGPU(0): Chipset "AMD Ryzen 9 9950X…"` |
| 已连接显示器 | `NVIDIA(GPU-0): LG ULTRAFINE (DFP-0): connected` | `AMDGPU(0): Output HDMI-A-2 connected … 3840x2160`；**DFP-0..6 全 disconnected** |
| 内核 crtc 报错对象 | amdgpu `Cannot find any crtc or sizes` | nvidia `Cannot find any crtc or sizes` |

第三重佐证：`/usr/share/X11/xorg.conf.d/11-nvidia-offload.conf` 的 **btime = 2026-09-20 11:10:44.708**（此前不存在）。

**同时被排除/澄清**：
- **包层无罪**：09-18/19/20 `dpkg.log` 一行都没有；驱动/内核/mesa 最近变更是 **08-10**（41 天前）；`monitors.xml` mtime 早 41 天且至今仍写 NVIDIA 的 `HDMI-0` ⇒ GNOME 侧从未观测到拓扑变化
- **4090 是"没接显示器"而非"坏了"**：驱动绑定、`power_state=D0`、`/proc/driver/nvidia/gpus/…/information` 可读、`/dev/nvidia*` 齐全、`nvidia-persistenced` 连续存活；三个 boot **全量无 `Xid`/`NVRM`/reset/掉卡**。唯一未决 = `nvidia-smi`/NVML（版本错配已排除；**刻意未运行**以守只读纪律）
- **跨越 17:18 的 X 日志那一段是空白**（`Xorg.1.log.old`：14:13 → 次日 19:04 零输出），journal 同时段逐行只有 CRON/sysstat ⇒ **17:18 附近确实没有事件**
- **切回 4090 不是软件开关**：主从由「固件 boot-VGA 标志 + 显示器实际接在哪个 GPU」决定；方案（S0–S6，含回滚）已写入 `gpu-switch-0920/audit.md §8.③`，**未执行任何一步**
- **因果未下结论**：只有时间对齐（物理切换 09-20 11:10 → 症状 09-22）与容量机制（合成器从 4090/24GB 迁到 **2 CU 核显**/2GB UMA carve-out，负载不变，叠加 `Transform 1.333328` 缩放 + HDMI TMDS 300MHz）；**日志中无任何失败型事件** ⇒ 机制只能落在"算力容量"而非"故障"

## 八、★ 协调者三处判读**被源码级证据撤回**（2026-09-22，firefox-gfx 线以本构建 revision 源码 `5fdfd009…` 定案）

> 我此前按 `about:support` 决策日志的三行 blocklist 推断"Gecko GPU 路径存在有代价的降级"。该推断**逐条被推翻**，以下三条**撤回**，不得再引用。

| 我此前的说法 | 事实（带 file:line） | 结论 |
|---|---|---|
| "`WEBRENDER_COMPOSITOR` 被黑名单禁用 ⇒ 走降级的呈现路径（非原生合成），**是有代价的**" | 原生合成器分支只存在于 `#ifdef XP_WIN` / `MOZ_WAYLAND` / `XP_DARWIN`（`gfx/webrender_bindings/RenderCompositor.cpp:203–274`），**X11 本就落到 `RenderCompositorEGL::Create`**；且 `gfx/thebes/gfxPlatformGtk.cpp:293–296` 对 `!IsWaylandDisplay()` **显式 `ForceDisable`**。**强开也无效**：`ForceDisable→SetFailed` 写 **runtime 槽**，而 `GetValue()` 优先级 **runtime > user ForceEnabled**（`gfx/config/gfxFeature.cpp:18–36`）⇒ `gfx.webrender.compositor.force-enabled=true` **净效果为零** | **撤回**。X11 上是**空降级**，无性能代价、不可修 |
| "`DMABUF_SURFACE_EXPORT: blocked` ⇒ **每帧失去零拷贝**（多一次或多次拷贝）" | 本构建官方描述即 **`"WebGL DMABuf surface export"`**（`gfx/config/gfxFeature.h`），唯一副作用是一个布尔 gfxVar（`gfx/thebes/gfxPlatform.cpp:3296–3317`）。**通用路径未受损**：`DMABUF` 用户实测 `available`、`widget.dmabuf.enabled` 默认 true；合成器把 WR 输出**直接画进窗口 EGLSurface**（`RenderCompositorEGL.cpp:38–62`），**无"帧缓冲→CPU→再上传"拷贝** | **撤回**。真实代价**仅限 WebGL**（+ WebGPU 互操作）；对 DOM/CSS/SVG/2D canvas **无每帧成本** |
| "`MESA_THREADING: failed` ⇒ **驱动调用压主线程**" | 是 Mozilla 对 **bug 1670545** 的**故意 workaround**（`gfxPlatformGtk.cpp:349–357` 逐字注释 "Enabling glthread crashes on X11/EGL"），**不是驱动故障**；且 WebRender 的 GL 上下文由 **RenderThread** 持有（`RenderCompositorEGL::Create` 用 `RenderThread::Get()->SingletonGL()`）⇒ GL 提交发生在合成/渲染线程，**主线程未被压**。**无可用用户开关**（第 350 行 `X11_EGL && IsX11Display()` 会无条件改回 `Failed`） | **撤回**。贡献 **INCONCLUSIVE** |

**顺带闭合的两处（该线自我更正）**：
- `WEBRENDER_PARTIAL: available` + `gfx.webrender.max-partial-present-rects` 在 GTK 下默认 **1** + buffer age 默认 **true** ⇒ **X11 下 partial present 其实是开着的**；该线上一轮"无原生合成器 ⇒ 每帧全幅"的推断**作废**
- `gfx.webrender.enable-low-priority-pool` 默认 **true** ⇒ `WRWorkerLP#0..7` 是**蓄意默认特性，与软件光栅无关**；`render-backend-thread-count` 默认 **2** 与活体实测的 2 条 `WRRenderBackend#` 吻合 ⇒ **独立验证了 `/proc` 线程名读取可靠**

**Chrome 侧为何不受影响（本机实测 + 机制）**：
- `~/.config/google-chrome/Local State` → **`hardware_acceleration_mode_previous = true`**；`GPUCache/` 与 `DawnWebGPUCache/` 在 10:50–11:15 **活跃写入** ⇒ **Chrome 侧无任何降级记录，反有正向证据**
- 机制：三条降级都是 **Gecko 自己的 `gfxConfig` 特性**，Chromium 用 Viz/Ozone + **自己的** `gpu_driver_bug_list.json`，两套黑名单彼此独立；最干净的一条是 **`mesa_glthread=false` 由 Gecko 用 `PR_SetEnv` 设为进程级变量，只作用于 Gecko 自己的进程树**
- **诚实边界**：`chrome://gpu` 不可得（有头 Chrome 被 SIGTRAP 杀）⇒ "Chrome 侧是否也有自己的黑名单命中" **未观测（INCONCLUSIVE）**；上述均为**机制层**
- 另需防过度解读：Firefox 的 `内容分析（DLP）: 已启用 false` **只说明 Firefox 自身的 DLP 集成未开**，与 Xorg 侧 `twatermarkext`（若真在每帧画水印）**不是互斥证据**

**更新后的 Firefox 侧假设排序**：① **强制 a11y**（唯一"Chrome 天然免疫"的不对称项，待验）＞ ② **环境放大器**（DPR2 + 5120×2880 + 2 CU，受控已验证）＞ ③ ~~降级的 Gecko GPU 路径~~ **大幅下调**（三条里两条无效/无害，只剩 WebGL 专用的 DMABUF 一条）＞ ④ 软件 WebRender / snap 缺 GPU / DLP 作用 Firefox —— **均已否证**

**唯一新的高性价比单点取证**：**Codex 那个整窗 canvas 是 WebGL 还是 2D** —— 决定 `DMABUF_SURFACE_EXPORT: blocked` 有无实际成本；是 WebGL ⇒ 与症状直接相关；是 2D ⇒ 火力全部回到 a11y 与环境放大器。

## 九、★ 该单点取证已结案（canvas-kind，2026-09-22）

**裁决**：**Codex 托盘/波纹 = DOM/CSS/SVG；不是 WebGL、不是 WebGPU、也不是 2D canvas。DSH 侧同样零 WebGL/WebGPU。**

决定性证据：
- 宠物/托盘 **31 个成员中，含 GL/WebGPU 构造者 = 0**（`getContext`/`webgl`/`createElement('canvas')` 全为 0）
- **"整窗 canvas"来源被证否**：唯一候选 `data-avatar-overlay-backing-canvas`（`avatar-overlay-native-page-84a63926578f.js:1`）是 **framer-motion `div` 上的 data 属性名**——**属性名叫 canvas，元素是 div**
- 波纹两套实现均无 canvas：SVG 版改 `[o,s,c]=n.rippleStops; o.setAttribute('offset',…)`（`<radialGradient>` stop）；Valdi 版 `valdi-press-ripple` + `setAttributeNumber('scaleX'/'scaleY')`（DOM）；托盘跟随 = **CSS sprite** `steps(48,end)`
- 全库 `getContext` 400 处中 `'2d'`=253、`webgl/webgl2`=**9**（mapbox/app-initial/粒子/PhotoSphere 等，**均非宠物 UI**）、`'webgpu'`=**0**；`navigator.gpu`/`requestAdapter` = 0
- DSH 侧：已部署 `@deepseek-ai/**` + 全部 `dsh-client-ui-*` 命中 **0**；`dsh-web-frontend/dist/assets/*.js` 连 `"canvas"` 字面量都没有；壁纸 = `backgroundImage` + 静态 PNG

**⇒ 结案**：`DMABUF_SURFACE_EXPORT: blocked` 对用户抱怨的那两个 UI **无每帧成本**；该战线关闭，**火力回到「强制 a11y」与「环境放大器」**。

## 十、★ 我的第四处误归因被纠正（跨栈）

我此前把"Firefox `about:support` 的 gfx 降级"列为**Codex 也卡**的候选解释之一。**这在架构上不可能**：
- Codex = **Electron/Chromium**（`owl` 运行时，`packagedFrom …/ChatGPT-linux-x64`，主进程 `main-*.js` 内 `webgl` 命中 **0**，只用 Chromium 自身 API 读 `app.getGPUFeatureStatus()`）
- Firefox 的 `gfxVar` 与 `mesa_glthread=false`（`PR_SetEnv` 进程级）**只作用于 Gecko 自己的进程树**；Codex 走它自己的 Chromium GPU 进程

**⇒ 撤回"Firefox gfx 结论可用于解释 Codex"**；Codex 侧若需 gfx 证据，唯一正确通道是 **Chromium 的 GPU 状态**。任何"同一 gfx 机制横跨两个应用"的表述都属**跨栈误归因**。

**方法论副产物**：该线**主动弃用了 BFS 可达性分析**（`nodes visited: 4000` 达上限，"可达 ≠ 被使用"），改用**精确成员集合**（可判定、可否证）——这条纪律值得复用。

## 十一、★ 用户侧渲染表现的**客观量化**（Firefox Glean 分布型指标，2026-09-22 11:07 快照）

该线破解了 Glean 自有存储的**分布型桶结构**（`entry := [u64 bin_label][u64 count]`，两者都在 u64 的**高 32 位**，须 `>>32`；五重独立校验 **27/27 PASS**，其中 `frame_time.from_vsync` 分布总数 109441 **精确等于** 8 个 reason 计数器之和），单位取自 **Mozilla 官方 `gfx-metrics.yaml`**（15 项 CONFIRMED）。

| 指标 | 用户侧实测 |
|---|---|
| **`scroll_present_latency`**（滚动呈现延迟） | 1287 样本；**中位 ≈30.8 ms**（≈2 个 vsync）；众数 25.2%；**≥36.6 ms 占 4.74%**、≥65 ms 0.78%、≥174 ms 0.62%（**最坏 ≈225.7 ms**） |
| **`checkerboard`（破图）** | **确实发生 50 次**；`duration` 众数 16.78 ms（=1 vsync，38%），**42% ≥33.55 ms**，**最坏 ≈414 ms**；`severity` 54% ≥1303；`peak_pixel_count` 最坏 ≈**80 万 CSS px** |
| `composite_time` | 173,703 样本；中位 ≈**0.96 ms**、p95 ≈1.92 ms（右尾至 ≈123 ms，仅 13 样本） |
| `composite_frame_roundtrip_time` | 174,804 样本；**99.97% 同一桶**（≈0.96 ms） |
| `frame_time.from_vsync` | 109,441 样本；**96.74% 落在 90–115% vsync** |
| 标量复核 | `on_time **98.26%**`、`slow_composite **0.60%**`（与另一线独立解出的 98.20%/0.61% 一致，差异由读取时刻不同解释） |

**裁决**：① **用户侧确有客观可量化的渲染劣化**（破图 50 次 + 滚动呈现延迟中位 ≈31 ms）——**PASS**；
② 其**分布形态把责任指向下游呈现/环境放大器**（mutter 5120×2880→4K 双线性 + 2 CU 核显），**与"Gecko 合成器掉帧为主因"不相容**（`composite_time` 中位仅 0.96 ms、`on_time` 98.26%）；
③ **结构性限制**：store 是**聚合态**（`session#start_time = 2026-09-22T10:05:40`、`seq=18`，`pending_pings/` 与 `events/` 为空）⇒ **全部计数 100% 产生于 GPU 切换之后，无法做前后对比**，**不得**用它支持或反驳"切换后才变差"；
④ 该通道**最大盲区 = 下游呈现耗时**（mutter 合成、5120→4K 降采样），**取不到**。

**该线同时更正了前一线容器格式的两处错误**：真实布局是 `[u64 keylen][key][u64 vallen][value]`、`value := [u8 TAG=0x09][u64 paylen][payload]`（`reclen==1+8+paylen` **不成立**）；类型判别符是 `payload[0]` 的 sub-tag；标量位于 `payload[4:8]`/`payload[4:12]`（**不是** `[5:9]`/`[5:13]`，该线早期错位导致 `primary_width` 读成 20，用已知值 5120 反推修正）。

### 十一bis、补充：单位升格 CONFIRMED + **"切换前后对比"双路径否定**（2026-09-22 午后）

- **单位 15/15 全部 CONFIRMED**：二级 subagent 取回 Mozilla 一手源码（**`gfx/metrics.yaml`**，注意 `gfx.*` 定义在此而**不在** `toolkit/.../metrics.yaml`）、`accessible/metrics.yaml`、`Histograms.json`、Glean SDK 规范。
  `checkerboard.duration`/`scroll_present_latency`/`composite_time`/`content.paint_time`/`content.full_paint_time` = **ms**；`checkerboard.severity` = **无单位（opaque）**；
  `checkerboard.peak_pixel_count` = **CSS pixels**；`content.frame_time.*` = **% of vsync interval**；`gfx.skipped_composites` = **纯计数 counter（非分布）**。
  `a11y.tree_update_timing` 由 UNCERTAIN **升为 CONFIRMED（ms）**。
- **★ 用官方规范反证位编码**：Glean 规范 timing_distribution 为 functional 分桶 `index = ⌊8·log₂(x)⌋`、值以**纳秒**存储 ⇒
  对全部 8 个 timing 指标的**每一个解码桶**做校验：**268/268 桶落在自己的桶内 → PASS**。
  这条**完全不依赖**该线的 `>>32` 假设——若有任何位错位，268 个桶不可能同时命中官方公式 ⇒ **解码正确性被独立反证**，`bin/1e6 = ms` 由 LIKELY 升为 **CONFIRMED**。
  另有 CD exponential 几何步长校验（相邻桶比值偏差仅 **0.78–1.48%**，残余归因于桶边界取整，不影响裁决）。
- **★★ "GPU 切换前后对比"双路径均否定 —— 应作为定论引用，不再派线去挖**：
  archived main ping 路径实测：归档 ping **确实**含 gfx mirror 直方图，**但最后一笔有数据的是 `2026-09-12 06:24:11`（NVIDIA，11 个 gfx 直方图）**；
  其后**全部 14 个 ping 的 gfx 直方图全为 0，包括 `2026-09-20 17:18:43` 那个切换 ping** ⇒ **mirror 在切换前 8 天就停了，切换后不存在任何 gfx 直方图数据**。
  **⇒ 两条路径（Glean store / archived ping）都无法给出前后对比，这是"无数据"而非"难"。**
- **口径澄清**：存储**只落盘非零桶**（官方 `bucket_count` 声明 50/100，实测 `nbuckets` 15/17/26/28/31/35/57/93）。
  ⇒ 报告与桶表里的 **"bins=N" = 有样本的桶数，不是官方总桶数**；**不影响任何 count/share 数字**。
- **最终自校验面板全 PASS**：records 2752；distribution 27；trailer 27/27；functional invariant 268/268；`from_vsync` 总数 109441 == 8 个 reason 之和；`primary_width 5120`；`target_frame_rate 60`；`on_time 107533 (98.26%)`；`skipped_composites 1182`。
- **裁决不变**。

## 十二、★★ a11y 机制**定案**（firefox-a11y 线，headed 与用户桌面同构，3 次/条件、轮次交错、自证 3/3）

### 12.1 环境确实强开 Firefox 无障碍 —— **PASS（三条独立证据）**
1. 用户 Firefox 父进程 **9042 是私有 AT-SPI 总线上的注册应用**，应用根对象**可查询**（`Name="Firefox"`、`role=application`、`ChildCount=2`）；总线注册**早于**任何应用级查询（10:56 首见 → 11:02 才发查询）
2. 用户自身偏好**全 false**（`toolkit-accessibility`、`screen-reader-enabled`），profile `prefs.js` **无任何 `accessibility.*`**、无 `user.js` ⇒ **环境强开**
3. 独立实例在 `env-default` 下从**浏览器进程内部**读回：`@mozilla.org/accessibilityService;1` = **REGISTERED 3/3**、AT-SPI 总线成员 3/3；`force_disabled=1` 下 **ABSENT / 0/3**

**两处对我此前说法的更正**：
- 起作用的是 **`GNOME_ACCESSIBILITY=1`**，**不是 `ACCESSIBILITY_ENABLED`**（`libxul.so` 含前者字面量、**完全不含**后者）
- **`GTK_MODULES=…gail:atk-bridge` 对 Firefox 无效**（libxul 不含 `GTK_MODULES`；Gecko 自己加载 `libatk-bridge-2.0.so.0`），对 Chrome 同样无效

### 12.2 量级（15000 行 / 45009 DOM 节点，headed，`DISPLAY=:1`）
| 条件 | a11y 引擎 | 上总线 | 帧时间 | 帧 p95 | 变更吞吐/s | 树 CPU |
|---|---|---|---|---|---|---|
| `env-default`（开） | 3/3 | **3/3** | 3765 ms（**31.4 ms/帧**） | **54 ms** | 148,267 | 15.78 s |
| `force_disabled=1`（关） | **0/3** | 0/3 | 2021 ms（**16.8 ms/帧**） | **18 ms** | 682,400 | 11.11 s |

**成本因子**：帧时间 **1.86×**、帧 p95 **3.0×**、树 CPU 1.42×、单次 DOM 变更吞吐成本 **4.6×**。
绝对 ms 成立条件：loadavg 5.8–7.3、同批 1–5 个外来探针浏览器 ⇒ **只用相对倍数裁决**。

### 12.3 ★ 最关键边界（本线最有价值的方法学发现）
**同一页面逻辑在 headless 下成本 ≈ 1.00**（全部指标 0.99–1.01，18009 节点）；差别仅在于 headless **没有真实 AT-SPI 消费者**（`busOn 0/3`）。
⇒ **无障碍引擎被实例化本身几乎不花钱；花钱的是"树被真实消费"。**
⇒ 这既解释了为何**只有用户桌面**出现差异，也说明 **headless 不能用来裁决这个问题**。

### 12.4 Blink 交叉核对：**"Chrome 完全不受影响"= FAIL**
Google Chrome **153.0.8010.52**（与用户同大版本）、90009 节点、3 条件 × 3 次，用 `chrome://accessibility` 的 AXMode 复选框 + activeAT 自证：

| 条件 | AXMode | activeAT | 帧时间 | 帧 p95 |
|---|---|---|---|---|
| `env-default-nofag` | **全 false** | Uninitialized | 9535 ms | 103 ms |
| **`+ --force-renderer-accessibility`** | 全 true | GenericScreenReader | 22437 ms | **1338 ms** |
| `env-cleared-nofag` | 全 false | Uninitialized | 9821 ms | 111 ms |

⇒ **强开 a11y 对 Blink 代价更大**（帧 **2.35×**、p95 **12.9×**）；但**环境变量对 Chrome 的网页内容完全无效**（`env-cleared` 与 `env-default` 无差异、AXMode 均 false）。
**⇒ 这就是"同一环境 Chrome 顺 / Firefox 卡"的直接机制**：**两个引擎都很贵，差别在"谁被环境打开了"** —— `GNOME_ACCESSIBILITY` 打开 Firefox，却不打开 Chrome 的网页内容。

### 12.5 ★★ 两个改变排障结论的新发现
1. **两个浏览器启动器都被改过**（`dpkg -V` 可复现 md5 不符，**非推断**）：
   - `/usr/bin/firefox` 第 72 行 = **`GNOME_ACCESSIBILITY=1 exec /snap/bin/firefox "$@"`**
   - `/opt/google/chrome/google-chrome` 第 30 行 = **`… "$@" --force-renderer-accessibility`**
   ⇒ **⚠️ 我此前建议的 `env -u GNOME_ACCESSIBILITY firefox …` 会静默无效**（wrapper 会把它设回去）；要真正清掉必须**直接跑 `/snap/bin/firefox`**（或 snap 载荷路径）绕过 wrapper。
   ⇒ 改动归因 **INCONCLUSIVE**，但与 `/etc/environment` 的 `##TEC_BEGIN##` 块、`/usr/local/.OCular/…` 同族属**相关非证据** ⇒ **建议交 IT/安全复核**（既是安全事项，也会污染一切后续排障）。
   ⇒ 另：Chrome 的浏览器进程**同样在 AT-SPI 总线上**（`:1.59`、`ChildCount=3`），**其启动器被追加了 `--force-renderer-accessibility`** ⇒ **一旦走被改的启动器，Chrome 也要付 2.35×/12.9× 的代价**。**故需向用户确认"Chrome 顺"那次会话是否带该 flag。**
2. **"清环境变量"不是可用的关闭手段**（内核级实证）：`env-cleared` 下三变量在 spawn 时确实全删，但 **`/proc/<pid>/environ` 里 `GNOME_ACCESSIBILITY=1` 又出现了**（只补这一个），浏览器内 `Services.env` 一致，a11y 仍 REGISTERED 3/3、仍在总线上。全系统只有 `libxul.so` 含该字面量、载荷是真 ELF、且为直接 exec（绕过被改的 wrapper）⇒ **Gecko 自己把它设回进程环境**（存在=实证；方向=推断）。

### 12.6 唯一经实测有效且可回滚的开关
**`accessibility.force_disabled = 1`** —— **3/3 生效**（引擎 ABSENT、总线 3/3→0/3、`prefs.js` 读到 1）。**用户级、即时、无需 root、回滚 = 改回 `0`**（本机默认来自 `greprefs.js:220`）。
`about:support` 只有两行有效：**`Activated` = `Services.appinfo.accessibilityEnabled`**、**`Prevent Accessibility` = 该 pref 原始整数**（源码级确认）。

### 12.7 该线的纪律披露与对协调者的提醒
- **共享锁在本机实际失效**：锁被 3+ 条线争抢、其中一例被夺锁，同批内实测 **1–13 个外来探针浏览器并发**；重负载 headless 批次**等待 9 分钟 / 170 次轮询未获取**，故改按「自己单浏览器串行 + 实时进程表普查」并逐 run 记录锁状态与 loadavg（**文档化偏离**）。
  ⇒ **建议协调者收敛该锁，否则后续任何性能测量都不可信。**
- 该线**自我披露误用一次 `pkill`**（模式匹配到自己的 shell，把自己 shell 一并 SIGTERM；未波及用户进程），此后一律按 PID 校验。






