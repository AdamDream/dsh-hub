# w27-scale150 — 三条"保留 150%"的路：把事实做出来

- 线：`.workspace/lag-fix/program/w27-scale150/`（本线独占）
- 日期：2026-09-22（本地 +08:00），测量时段 07:45–08:2x
- 引擎：**Mozilla Firefox 155.0.1**（snap `/snap/firefox/8863`）
- 口径：**有头 Gecko（真实合成路径）**，用户真实显示配置（X 屏 5120×2880 @ DPR2）
- 原始数据：`out/routeA-*.json`（Route A 主矩阵）、`out/support.json`（13 个开关的生效态）、`out/analysis-*.json`（配对分析）、`out/diag-*.json`（器械自证/机制判别）

---

## 0. 一句话裁决

> **① 在"不改缩放、不换会话、不动硬件"这三条约束下，本线确实找到了一个纯软件、可当场实测的开关：`gfx.webrender.software = true`（软件 WebRender / SWGL）。** 在用户 150% 配置（5120×2880 背衬 = 14.746 Mpx @ DPR2）下，同一极简页同一负载，帧 p50 从 **26.90 → 17.02 ms**（≈37 → 59 Hz），`>33 ms` 帧从 **39 → 1**。**它保持 150% 视觉尺寸不变。**
> **② 但这个开关有真实代价，本线把它一起量化了**：Firefox 树 CPU **13.9% → 118.1%**（单核百分比，×8.5）、Xorg **3.9% → 39.6%**（×10）、mutter **7.2% → 17.9%**。⇒ 它把 GPU 上的瓶颈搬到了 CPU 上；在 32 核桌面上可行，在笔记本/省电场景是**明确的坏交易**。
> **③ 任务书原本预期 `gfx.webrender.software=true` 是"应显著变慢"的对照。本线实测它显著变快。** 这既证明了器械有区分力（差异巨大且 3/3 同向），也**推翻了"DPR2 代价 = CPU 或算力不足"的假说**——真正的瓶颈是**硬件（GL/EGL）合成/光栅路径在 DPR2 下的等待**，而不是算力。
> **④ 任务书点名的另外 11 个开关（`max-partial-present-rects` 2/4/8、`allow-partial-present-buffer-age`、`gfx.webrender.compositor`、`gfx.canvas.accelerated`、`gfx.content.azure.backends`、`layers.acceleration.*`、`gfx.webrender.enable-multithreading`、`gfx.x11-egl.force-enabled`）**全部经实测判为无效**（详见 §5）；其中 **compositor 一项的"X11 上原生合成器不可达"得到独立复核确认**（§4.4）。
> **⑤ 路线 B（接 4090）与路线 C（Wayland）本线均未执行**，只交付可行性/前置/判据：B 判 **INCONCLUSIVE（机制未被现有数据区分）**，C 见 §8。

---

## 1. 纪律与边界

| 项 | 做法 | 证据 |
|---|---|---|
| 只读 | **未改任何系统设置、未改任何产品文件、未改用户 profile**；`user.js` 只写在本线自己的 `/tmp/w27-profiles/*` | 见 §13 写入清单 |
| 不碰用户浏览器 | 用户 Firefox **PID 547226**、Chrome **PID 494362** 全程存活（起止各复核一次） | `out/routeA-*.json` 的 census 字段 |
| 不重启 | 宿主 **PID 301709** 全程存活；**未执行任何 `pkill`/`kill`** | 同上 |
| 锁 | 用 `.workspace/lag-fix/lib/probe-lock.mjs`；**只释放自己持有的锁**；**从未回收他线的锁** | 首次试跑遇到 `exec-keepalive`(PID 969079, ALIVE) 持锁 ⇒ **本线只等待，未回收**；正式矩阵 `lock.held=true` |
| 自建 profile | `HOME=/tmp/w27-ffhome`，profile 在 `/tmp/w27-profiles/<tag>`，一律 `--no-remote --new-instance` | `scripts/lib/ff-headed.mjs` |
| 未点危险 UI | **未触碰 DSH GUI 的 Sessions 树行内按钮**（NEVER-CLICK 清单）；本线**完全未驱动 DSH GUI** | 本线只加载本地 `file://` 探针页 |

### 1.1 两处必须显式声明的仪器/环境问题（本线自曝）

1. **端口被占导致一整个窗口静默丢失**：首次试跑的 `ctl` 臂启动失败，日志为 `could not start server on port 10501: NS_ERROR_SOCKET_ADDRESS_IN_USE`。原因：**10501 被一个与本线无关的进程占用**（`ss` 显示 `LISTEN 127.0.0.1:10501` 但无属主可读）。⇒ 已改为**每次启动前向内核申请一个确认空闲的临时端口**（`scripts/arms.mjs` 的 `pickFreePort()`）。**该缺陷若不修，会表现为"某一臂缺数据"而不是报错**，属高危仪器缺陷。
2. **WebDriver BiDi 拒绝导航到特权页**：`browsingContext.navigate` 到 `about:support` 直接报 `unsupported operation: Navigation to "about:support" is not allowed in this context`；即便绕过导航，`script.evaluate` 也报 `System access is required. Start Firefox with "-remote-allow-system-access" to enable it`。⇒ 本线改用 **`-remote-allow-system-access` + 把 `about:support` 设为启动页**，才拿到"开关是否真的生效"的读数（§4.4）。**这是本线能给出"生效/不生效"判定的唯一通道**，w14 线没有这条通道。

---

## 2. 前提（引用 w14，不重新论证）

来自 `.workspace/lag-fix/program/w14-residual-env/audit.md`：

- 用户配置：**X11 会话（`DISPLAY=:1`）**、mutter 分数缩放、`monitors.xml <scale>1.5</scale>`、mode 3840×2160@60、**X 屏 = 5120×2880**、应用 **DPR=2**（`Xft.dpi:192`）。
- **DPR2 下**，零 DSH 代码的极简页"整屏整幅重绘"帧 p50 = **23.40 / 25.34 / 22.74 ms ⇒ 42.4 Hz、掉帧 27.2%**（3/3 rep）；同页同负载在 1440×900@DPR1 下 = **60.0 Hz、0 掉帧**。
- **放大器是 DPR2 这条路径，不是面积、不是 mutter 降采样**：同 14.746 Mpx 背衬、同 mutter 5120×2880→3840×2160 降采样下，**DPR1 = 17.06 ms（≈空白页，"免费"）vs DPR2 = 22.47 ms ⇒ Δ = +5.41 ms/帧**。
- 掉帧窗内 CPU 无一方饱和（ff 10–12%、mutter 4.5–7%、Xorg 2.6–5.5%，单核%）。
- RTX 4090 未接显示器（`card1-*` 全 disconnected、`nvidia-smi` NVML 报错）。

本线独立复核到的当前环境（只读）：

| 项 | 值 | 来源 |
|---|---|---|
| X 屏 | **5120×2880** | `xdpyinfo` |
| `monitors.xml` | `<scale>1.5</scale>` | `~/.config/monitors.xml` |
| `Xft.dpi` | **192** | `xrdb -query` |
| 面板 mode | 3840×2160@60（`HDMI-A-2 connected primary 5120x2880+0+0`） | `xrandr` |
| loadavg | 起 **9.27**，矩阵结束另记 | `/proc/loadavg` |

---

## 3. 路线 A 方法（器械与判据）

### 3.1 器械

- **有头 Gecko**：`/snap/firefox/8863/usr/lib/firefox/firefox --no-remote --new-instance --profile /tmp/w27-profiles/<tag> --remote-debugging-port=<free> --width=2560 --height=1440 <url>`，`HOME=/tmp/w27-ffhome`，`DISPLAY=:1`。
- 驱动：**WebDriver BiDi**（`ws://127.0.0.1:<port>/session`，Node 22 原生 WebSocket）。
- **每个 (开关, rep) 一个独立进程 + 独立 profile**（`gfx.*` 是启动期读取，不可热改）。
- 负载：`probes/minimal.html?mode=paint`（"每帧整屏重绘"，**不含任何 DSH 代码**），用 `window.__W14LOAD` 门控动画。
- 几何：**CSS 2560×1440 @ DPR2 ⇒ 背衬 5120×2880 = 14.746 Mpx**（每窗页内读回 `devicePixelRatio / innerWidth / innerHeight / backingW / backingH` 自证）。

### 3.2 判据（照 BATCH-PLAN §五.19⑤ / §五.9 / §五.13）

- **主判据 = 页内 wall-clock rAF 间隔 + 窗口播种**：时间戳取 rAF **回调入口**的 `performance.now()`；每窗开记录 → 播种 6 帧（**保留块前那一帧**）→ 打 `loadStart` → 页内 `setTimeout` 保持窗口 → 打 `loadEnd` → 保留 4 帧尾部。
- **Gecko 无 LongTask / LoAF 通道**（§五.9）⇒ 一律不用作证据。
- **Firefox 155 无 CDP**（已移除）⇒ 主判据的另一半 **CDP `RunTask` 在本引擎不可用**，本线显式改用 §五.19⑤ 指定的页内替代判据。**这是引擎级边界，不是本线省略步骤。**
- **每窗自带页内阳性对照**：3 × 120 ms 页内 `setTimeout` 忙等（**绝不用远程 evaluate 注入**，§五.13），判据 = rAF 间隔 >100 ms 计数。
- 时钟自证：`privacy.reduceTimerPrecision=false`（**所有臂，含 ctl**，这是测量卫生不是性能开关），页内读回 `performance.now()` 粒度 **0.02 ms**。
- 读数：**load 窗内 rAF 间隔的 p50、effHz、`>33 ms` 帧数、max**。

### 3.3 分辨下界（**任务书要求显式标注**）

| 口径 | 分辨下界 | 说明 |
|---|---|---|
| **单帧**（用 `>33 ms` 计数判断"有没有一次卡顿"） | **≈25 ms**（§五.19④：wall-clock 口径 ≈ 真值 +0…17 ms）；`>33 ms` 阈值**实际要到 ≈40–50 ms 才可靠触发** | ⇒ **`>33 ms` 计数是粗器械**，它看不见 33–40 ms 的帧 |
| **p50 聚合**（≈250 个间隔的中位数） | **由经验噪声底 F 决定**（本线实测 F 见 §4.3），远细于单帧 | ⇒ p50 能分辨的位移**比 `>33 ms` 计数小一个量级** |

**任务书要求的"≥2× 分辨下界"本线按两种读法都报**：
- **读法甲（本线主判据，较宽）**：|中位 Δ| ≥ **2F**（F = 该 rep 内全部 ctl 窗口 p50 的半极差中位数，**实测经验噪声底**）且 3/3 rep 同向；
- **读法乙（较严）**：|中位 Δ| ≥ **2 × 25 ms = 50 ms** 且 3/3 同向。
两读法的结果都写在 §5。

### 3.4 配对与对照

- **同 rep 相邻配对**：每个 rep 内，每个测试臂与该 rep 的 ctl 窗口**紧邻**运行；**奇 rep 为 `ctl→臂`，偶 rep 为 `臂→ctl`**（消除启动顺序/机器漂移伪装成开关效应）。
- **对照四件套**：
  1. `ctl` = **完全不加任何 gfx 覆写**（默认路径）；
  2. 每窗**页内阳性对照**（120 ms ×3）；
  3. **阴性对照** = `blank.html` 静态页（无动画）；
  4. **区分力对照** = `gfx.webrender.software=true`（任务书预期"应显著变慢"）。

### 3.5 判定规则（**事前预定**）

规则在矩阵启动前由本线预定，并在 **08:04（rep1 仅完成 4/11 对时）** 写入 `scripts/analyze.mjs` 头注释固化 ⇒ 对全部 3 rep 数据是**事前规则**：

```
d_rep = p50(臂) − p50(同 rep 相邻 ctl)
F     = median_over_reps( (max−min)/2 of 该 rep 全部 ctl 的 p50 )
有效   = |median(d)| ≥ 2F 且 3/3 rep 同向且为负
有害   =  median(d)  ≥ 2F 且 3/3 rep 同向且为正
无效   = 其余（含方向不一致）
```

---

## 4. 路线 A 结果

### 4.1 器械自证（每窗）

| 自证项 | 结果 | 判定 |
|---|---|---|
| DPR / 背衬读回 | 每窗 `dpr=2`、`inner=2560×1440`、`backing=5120×2880`、`mpx=14.746` | **PASS** |
| 时钟粒度 | `privacy.reduceTimerPrecision=false`；页内读回 **0.02 ms** | **PASS** |
| 阳性对照（页内 120 ms ×3） | **每窗 3/3 检出** | **PASS** |
| 阴性对照（`blank.html` 静态页） | p50 **17.04 ms**、`>33 ms` **0**（所有 rep 一致） | **PASS** |
| SWGL 回退行 | 有头批 `swglLines=[]`（**默认臂未走 SWGL**，见 §4.4） | **PASS** |
| 内容进程 GL | `Radeon HD 3200 Graphics, or similar`；`about:support` GPU #1 = AMD Raphael `0x1002/0x13c0`、`mesa/radeonsi 25.2.8.0`，**Active Yes**；GPU #2 = `0x10de/0x2684`（4090）**Active No** | **PASS** |
| 窗口协议 / 目标帧率 | `x11` / `Target Frame Rate = 60` | **PASS** |
| 机器独占 | **非独占**：loadavg 起 9.27；矩阵期间见多个 peer `headless_shell` 与用户自己的 Chrome/Firefox | **FAIL（环境限制）**，见 §12 |

> **`blank.html` 在 3 个 rep 的 p50 全部恰为 17.04 ms** ⇒ 本线器械与 w14 的阴性对照**逐位一致**，可跨线比较。

### 4.2 逐开关实测表

<!-- TABLE_A -->

### 4.3 噪声底 F 与"有效"的阈值

<!-- NOISE_FLOOR -->

### 4.4 `about:support` 生效态复核（**本线独有通道**）

方法：`scripts/support.mjs` —— 用 `-remote-allow-system-access` + 以 `about:support` 为启动页，逐臂读回 `Compositing` / `WebRender` / **`Window Device Pixel Ratios`** / `Important Modified Preferences` / `GPU #1,#2`。原始件 `out/support.json`。

**全部 13 臂**均读到 `Window Device Pixel Ratios = 2`（DPR 自证）且 `GPU #1 = AMD Raphael (Active Yes)`、`GPU #2 = 0x10de:0x2684 (Active No)`。

| 臂 | `Compositing` 读回 | 该臂的 pref 是否被 Gecko 接受 |
|---|---|---|
| `ctl` | **WebRender** | —（无覆写） |
| `mppr2` | WebRender | `gfx.webrender.max-partial-present-rects=2` **ACCEPTED** |
| `mppr4` | WebRender | `...=4` **ACCEPTED** |
| `mppr8` | WebRender | `...=8` **ACCEPTED** |
| `pba_false` | WebRender | `gfx.webrender.allow-partial-present-buffer-age=false` **ACCEPTED** |
| `canvas_acc` | WebRender | `gfx.canvas.accelerated=true` + `.force-enabled=true` **ACCEPTED** |
| `az_skia` | WebRender | `gfx.content.azure.backends=skia` **ACCEPTED** |
| `az_cairo` | WebRender | `gfx.content.azure.backends=cairo` **ACCEPTED** |
| `layers_acc` | WebRender | `layers.acceleration.force-enabled=true` + `.disabled=false` **ACCEPTED** |
| `mt` | WebRender | `gfx.webrender.enable-multithreading=true` **ACCEPTED** |
| `x11egl_off` | WebRender | `gfx.x11-egl.force-enabled=false` **ACCEPTED** |
| `comp_force` | **WebRender**（**未变成原生合成器**） | `gfx.webrender.compositor.force-enabled=true` + `gfx.webrender.compositor=true` **ACCEPTED** |
| `sw` | **WebRender (Software)** | `gfx.webrender.software=true` **ACCEPTED** |

**两条独立结论**：
1. **`gfx.webrender.compositor.force-enabled=true` 净效果为零**——pref 被接受、但 `Compositing` 仍是 `WebRender`，**没有**变成原生 WebRender 合成器。这与 `incident2/firefox-gfx/decision-log-analysis.md` A3 的**源码级**结论一致（`gfx/thebes/gfxPlatformGtk.cpp:293–296` 对 `!IsWaylandDisplay()` 显式 `ForceDisable`；`ForceDisable→SetFailed` 写 **runtime 槽**，而 `GetValue()` 优先级 **runtime > user ForceEnabled**，`gfx/config/gfxFeature.cpp:18–36`）。⇒ **任务书点名的这一项可直接判"无效"，本线已独立复核，不必再耗轮次。**
2. **只有 `gfx.webrender.software` 真正改变了合成路径**（`WebRender` → `WebRender (Software)`）。其余 11 项在 `about:support` 层面**看不出任何路径变化**——与 §4.2 的计时结果一致。

---

## 5. 路线 A 裁决：有效 / 无效 / 有害

<!-- VERDICT_A -->

---

## 6. 意外发现：`gfx.webrender.software=true`（SWGL）**显著变快**

<!-- SWGL -->

---

## 7. 路线 B：把显示器接到 RTX 4090（**未执行，只出方案**）

完整交付：`.workspace/lag-fix/program/w27-scale150/routeB-4090.md`（348 行）+ `raw/routeB-01..16-*.txt`（16 组只读命令原始输出）。

<!-- ROUTE_B -->

---

## 8. 路线 C：改用 Wayland 会话（**未执行，只出方案**）

完整交付：`.workspace/lag-fix/program/w27-scale150/routeC-wayland.md` + `raw/routeC-*.txt`。

<!-- ROUTE_C -->

---

## 9. 三路裁决与排序

<!-- VERDICT_ALL -->

---

## 10. "不改缩放、不换会话、不动硬件"下**是否还有纯软件空间**

<!-- SOFTSPACE -->

---

## 11. 逐条 PASS / FAIL / INCONCLUSIVE

<!-- PASSFAIL -->

---

## 12. 显式写出"未能量化"的部分

<!-- NOTQUANT -->

---

## 13. 交付物索引

<!-- INDEX -->
