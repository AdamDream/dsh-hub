# audit.md — 同一页面 / 同一动效：Gecko vs Blink 受控对照（incident2 / gecko-vs-blink）

- 工作区：`/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/gecko-vs-blink/`
- 宿主 PID 301709（`node dsh web`）**未被重启、未被 pkill**；用户自己的 Firefox（pid 9042）与 Google Chrome 全程未被触碰
- 全部测量：**单浏览器串行**，共享锁 `research-v2/.probe.lock`（见 §7 纪律与锁）
- 原始数据：`raw/`（phase1）、`raw/p3/`（含逐事件成本与预算越界采样）、`raw/p4/`（Gecko 细粒度时钟复核）、`raw/loadcurve-*.json`、`raw/timeres-*.json`、`raw/calibration-*.json`
- 汇总：`raw/summary-p1.json`、`raw/summary-p3.json`、`raw/summary-p4.json`、`raw/loadcurve-summary.json`
- 有效样本：**65 个 run**（Blink 30 / Gecko 35），全部带页内 `devicePixelRatio` 回读自证（**65/65 命中**，见 §4）

---

## 1. 逐条结论（PASS / FAIL / INCONCLUSIVE）

| # | 任务要求 | 判定 | 依据 |
|---|---|---|---|
| 1 | 先解决"能不能跑 Gecko" | **PASS** | 无 `firefox-*` 于 `~/.cache/ms-playwright`，改用 snap 可执行文件 + **WebDriver BiDi** 成功驱动；配方见 §2 |
| 2 | 同页同动效 Blink/Gecko 各 ≥3 次，记录帧间隔分位、>50ms、LongTask/LoAF、CDP 分项、JS 自时间、DOM 节点数 | **PASS（含 1 项部分）** | 帧间隔/JS 自时间/DOM 节点数/逐事件成本全部拿到；**LongTask/LoAF 在 Gecko 不存在**（§3，如实标注）；CDP 分项仅 Blink 有，缺失字段显式列出不编造 |
| 3 | DPR=1 与 =2 各 ≥2 次，给出实际开关并自证生效 | **PASS** | Blink：Playwright `deviceScaleFactor`（实为 CDP `Emulation.setDeviceMetricsOverride`，**真实 cmdline 无 `--force-device-scale-factor`**）；Gecko：`user.js` → `layout.css.devPixelsPerPx`；全部页内回读自证（§4） |
| 4① | Gecko 是否显著慢于 Blink（倍数与区间） | **PASS（分维度回答）** | 帧间隔：**否**（恒为 1.022，与负载无关）；canvas 动效主线程成本：**是，7.9×**；逐事件处理：**Gecko 反而更快 0.75×**（§5） |
| 4② | 是否与 DPR/面积**超线性**相关 | **FAIL（超线性不成立）** | Gecko canvas 成本随面积 4× 上升 **≈3.0–4.0×（中位数 3.5×，次线性到近似线性）**；Blink **1.03×（无感）**（§5.3） |
| 4③ | 结论适用边界 | **PASS（已明确界定）** | headless 无绘制/合成；Blink `Paint`/`CompositeLayers`/`Layout`/`RecalcStyle` 全部缺失，Gecko 走 SWGL 软件渲染；只能作方向性证据（§6） |

---

## 2. 引擎可得性：Gecko 怎么跑起来的（PASS）

**为什么 Playwright 的 firefox 不可用**：`~/.cache/ms-playwright/` 下只有 `chromium-1148/`、`chromium_headless_shell-1148/`、`ffmpeg-1010/`，**没有 `firefox-*`**。Playwright 的 firefox 驱动要求其自带的 juggler 补丁构建，`playwright.firefox.launch({executablePath})` 无法驱动 stock/snap Firefox。且 **Firefox 155 已移除 CDP**（`/json/version` 返回 404），只剩 WebDriver BiDi。

**实际可用配方**（`scripts/lib/ff.mjs`，已固化）：

```bash
# 1) 沙箱是 workspace-write，$HOME 不可写 —— Firefox 会直接报
#    "Could not find profile folder." 而退出，所以必须换一个可写的 HOME
HOME=/tmp/gvb-ffhome \
/snap/firefox/8863/usr/lib/firefox/firefox \
  --headless --no-remote --new-instance \
  --profile /tmp/gvb-profiles/<tag> \
  --remote-debugging-port=18864 \
  --width=1280 --height=800 about:blank
# stderr 出现： WebDriver BiDi listening on ws://127.0.0.1:18864
# BiDi 端点 = ws://127.0.0.1:18864/session
```

- 客户端：`scripts/lib/bidi.mjs`（自研最小 BiDi 客户端，Node 22 原生 `WebSocket`，零依赖）；已验证 `session.new` / `browsingContext.create|navigate|setViewport` / `script.evaluate|callPreloadScript(addPreloadScript)` 全部可用
- 两个必要前提（本节的全部难点）：**(a) `HOME` 必须可写**（DSH 沙箱只放行 workspace 与 /tmp，故 `HOME=/tmp/...`）；**(b) 必须 `--no-remote --new-instance` + 私有 `/tmp` profile**，否则会对用户正在运行的 Firefox 实例开标签页
- 不使用 `snap run firefox`（snap 的 home 接口会屏蔽 `.workspace` 这类点目录），直接 exec snap 载荷

**可比性加成**：`/proc/9042/cmdline` = `/snap/firefox/8863/usr/lib/firefox/firefox` —— **用户正在跑的 Firefox 与本实验驱动的 Gecko 是同一个二进制/同一版本（155.0.1）**。

---

## 3. LongTask / LoAF：Gecko **没有**这两个 API（对其它线程的关键提醒）

用同页、同代码、同三次 200 ms 同步阻塞做阳性对照（`raw/calibration-*.json`）：

| 引擎 | `observe()` 是否抛错 | LongTask 条数 | LoAF 条数 |
|---|---|---|---|
| Blink（HeadlessChrome/131） | 否 | **2**（dur 200, 200） | **3**（dur 200, 200, 200） |
| Gecko（Firefox 155.0.1） | **否（静默接受）** | **0** | **0** |

→ **在 Firefox 里 `new PerformanceObserver(...).observe({entryTypes:['longtask']})` 与 `{type:'long-animation-frame'}` 都会被接受但永不产出条目。** 任何"Firefox 长任务 0 / 无长动画帧"的读数，含义是**该 API 不存在**，不是"没有卡顿"。本报告中 Gecko 的 LongTask/LoAF 一律标为 **API absent (0 entries, positive control failed)**。

---

## 4. DPR 开关与自证（避免上一批的人为产物）

| 引擎 | 实际开关 | 自证方式 | 结果 |
|---|---|---|---|
| Blink | Playwright `launchPersistentContext({deviceScaleFactor})` —— **底层是 CDP `Emulation.setDeviceMetricsOverride`**；`/proc/<pid>/cmdline` 实测**不含** `--force-device-scale-factor`（dpr1/dpr2 都不含） | 页内读回 `window.devicePixelRatio` + canvas backing store | dpr=1 → `1280×800`；dpr=2 → `devicePixelRatio=2`，canvas `2560×1600`（**面积 ×4**） |
| Gecko | profile `user.js`：`user_pref("layout.css.devPixelsPerPx", "<dpr>")`（另有 BiDi `browsingContext.setViewport.devicePixelRatio` 作独立第二开关，已验证可切换） | 页内读回 `window.devicePixelRatio` + canvas backing store | dpr=1 → `1280×800`；dpr=2 → `devicePixelRatio=2`，canvas `2560×1600` |

**65/65 个 run 页内回读值 == 请求值**（`raw/summary-p*.json` → `dprProof`）。上一批把 DPR 钉死在 1（`--force-device-scale-factor=1`）的做法在本实验中**不存在**。

---

## 5. 受控对照结果

测量条件：同一 `minimal.html`（`file://`，零外部依赖），同一 instrument（main world 预注入，两引擎字节一致），同一合成指针路径（同一 tick 数、同一坐标公式、同一事件顺序），视口 `1280×800`，每 run 8 s，dpr 同上表。单元释义见 §8。

### 5.1 帧间隔 —— 两引擎**无差异**（决定性）

| cell | dpr | Blink p50 / p95 / max | Gecko p50 / p95 / max | Gecko/Blink p50 | >50ms |
|---|---|---|---|---|---|
| combined（DOM transform, n=64, hover+ripple 交替） | 1 | 16.70 / 16.8 / 16.8 | 17.06 / 17.08 / 17.10 | 1.022 | 0 / 0 |
| combined | 2 | 16.70 / 16.8 / 16.8 | 17.06 / 17.08 / 17.10 | 1.022 | 0 / 0 |
| dom-lefttop（n=64 逐帧改 left/top → 强制 Layout） | 1 | 16.70 / 16.8 / 16.8 | 17.06 / 17.08 / 17.10 | 1.022 | 0 / 0 |
| hover-tray（canvas n=64, 粒子 8, 悬停 churn） | 1 | 16.70 / 16.7 / 16.8 | 17.06 / 17.08 / 17.10 | 1.022 | 0 / 0 |
| hover-tray | 2 | 16.70 / 16.7 / 16.8 | 17.06 / 17.08 / 17.10 | 1.022 | 0 / 0 |
| hover-blur（canvas + backdrop-filter） | 1 | 16.70 / 16.7 / 16.8 | 17.06 / 17.08 / 17.08 | 1.022 | 0 / 0 |
| DSH 首页（`http://127.0.0.1:3080/`，idle+指针扫掠，只读不点击） | 1 | 16.70 / 16.8 / 16.8 | 17.06 / 17.08 / 17.10 | 1.022 | 0 / 0 |

- 每 8 s 两引擎都交付 ≈480 帧（60 fps），**65 个 run 无一帧间隔 >50 ms**
- **Gecko/Blink = 1.022 是一个常数**：在全部 cell、两个 DPR、全部 rep 上完全一致（17.06 vs 16.70 ms）。即 Gecko headless 的 rAF 周期本身慢 2.2%（≈58.6 Hz vs 59.9 Hz），**与负载无关**，不能解读为"Gecko 渲染更慢"
- 孤例：>20 ms 的帧间隔在 65 run 中仅 3 次 —— Blink 1/30（DSH 首页 idle，33.3 ms），**Gecko 2/35 且全部落在 DPR=2**（combined 33.16、hover-tray 33.2；Gecko DPR2 共 9 run，DPR1 共 26 run 为 0）。这是**弱提示**（样本小，Fisher 约为边缘显著），不支持强结论

### 5.2 逐帧主线程 JS 自时间（rAF 回调内）—— canvas 路径 Gecko 显著更高

> **必须先看时钟粒度**（§5.5）：Gecko 默认把内容进程 `performance.now()` 夹到 **1 ms**，Blink 是 **0.1 ms**。因此凡是绝对值落在粒度附近的比较都是量化产物。下表同时给默认时钟与 Gecko 细粒度时钟复核值。

| cell | dpr | Blink 均值 (ms/帧) | Gecko 默认时钟 | Gecko 细粒度时钟 | 比值（细粒度校正后） | 判定 |
|---|---|---|---|---|---|---|
| combined | 1 | 0.0112 | 0.0218 | 0.0242 / 0.0267 | ≈2.3× | **INCONCLUSIVE**（两侧都贴在各自时钟底噪；Blink 均值仅 ≈0.11 个 0.1 ms 刻度/帧） |
| dom-lefttop | 1 | 0.0098 | 0.0198 | —（未复核） | ≈2.0× | **INCONCLUSIVE**（同上） |
| hover-tray（canvas） | 1 | **0.1969** | 1.92 | **1.540 / 1.552** | **≈7.9×** | **PASS（稳健）**：两侧都远离各自时钟粒度（Blink ≈2000 个 0.1 ms 刻度、Gecko ≈740 个 1 ms 刻度/8 s） |
| hover-tray（canvas） | 2 | **0.2028** | 5.31 | **4.67 / 6.16** | **≈24–31×** | **PASS（稳健）**，rep 间方差较大故给区间 |
| hover-blur（canvas+blur） | 1 | 0.1775 | 1.607 | —（未复核） | ≈9.1×（按 canvas 单元的 −20% 校正估 ≈7.5×） | PASS |

- **canvas 2D 动画是这个对照里唯一稳健的引擎差异**：Blink 把 canvas 2D 记录进显示列表、光栅化在别的线程，主线程只花 ≈0.2 ms/帧；Gecko（headless 走 SWGL 软件渲染）主线程要花 ≈1.5–1.9 ms/帧
- DOM/transform 路径两引擎都极便宜（<0.03 ms/帧），落在时钟底噪里，**不能据此说谁更快**

### 5.3 DPR / 面积的作用（问题②）

| 引擎 | cell | rafJs dpr1 → dpr2 | 倍数 | canvas 面积 | 帧间隔 p50 | 帧间隔 max |
|---|---|---|---|---|---|---|
| Blink | hover-tray | 0.1969 → 0.2028 | **1.03×** | ×4 | 16.70 → 16.70 | 16.8 → 16.8 |
| Gecko | hover-tray | 1.546 → 5.417（细粒度**中位数**；单 rep 3.0–4.0×）<br>1.92 → 5.31（默认时钟，3.42×） | **≈3.5×** | ×4 | 17.06 → 17.06 | 17.10 → **33.2（1 次）** |

- **面积 4× ⇒ Gecko 成本 ≈3.0–4.0×（中位数 3.5×）**：随面积**上升但次线性到近似线性**（≈面积^0.8–1.0），**"超线性"假设不成立**
- Blink 在同一开关下**几乎零敏感**（1.03×）——注意这是"主线程 JS 时间"这一维度的零敏感，**不等于 Blink 没有光栅成本**，而是它的光栅不在主线程也不在 headless 里（§6）
- Gecko 在 DPR=2 出现帧间隔 33.2 ms（掉一帧）的 2 次记录，DPR=1 为 0 次 —— 方向一致但样本小

### 5.4 逐事件处理成本（"跟手"路径）—— Gecko **不慢**

合成指针 tick 内包含：`elementFromPoint`（命中测试，可能强制 style/layout flush）+ `mouseout`/`mouseover`/`mousemove` 派发 + 页面处理函数（该 cell 下会生成波纹 DOM/粒子、切换托盘 class）：

| cell | dpr | Blink 均值 / max | Gecko 细粒度 均值 / max | Gecko/Blink |
|---|---|---|---|---|
| hover-tray | 1 | **0.1694 / 0.80 ms**（471 tick） | **0.1278 / 0.52 ms**（466 tick） | **0.75×（Gecko 更快）** |

→ 在"每次鼠标事件的处理开销"上 **Gecko 比 Blink 快约 25%**，根本不支持"Firefox 跟手更卡"的机制假设（至少在这一维度）。若其它线程在 Gecko 上看到 tick 比值 >1，那是 1 ms 默认时钟造成的量化假象。

### 5.5 时钟粒度校准（决定上面哪些比较可信）

| 引擎 / 配置 | 最小非零 `performance.now()` 读数差 | 0.35 ms 忙等实测（min / median） |
|---|---|---|
| Blink | **0.1 ms** | 0.4 / 0.4 ms |
| Gecko 默认 | **观测不到任何非零差**（`distinctReadDeltas: []`） | **1.0 / 1.0 ms** |
| Gecko `privacy.reduceTimerPrecision=false` | **0.02 ms** | 0.36 / 0.36 ms |

→ Gecko 默认时钟把 0.35 ms 的循环报成 1 ms（**高估 2.9×**）。**这就是为什么 §5.2 里 DOM 单元（0.008 vs 0.021 ms）的 2.6× 比值不能采信**，也是为什么必须做细粒度复核。细粒度复核同时证明 canvas 单元的量级差异（≈8×）是真实的。

### 5.6 负载曲线：两引擎帧交付**完全一致**（推翻我自己的一个中间结论）

同页 + 同动效运行，同时注入**相同代码**的 rAF 锁主线程忙等 L ms/帧（L = 0…28），两趟平均：

| L (ms/帧) | Blink 帧数 | Gecko 帧数 | Gecko/Blink | p50 Blink | p50 Gecko | p95 Blink | p95 Gecko |
|---|---|---|---|---|---|---|---|
| 0 | 180.5 | 180 | 0.997 | 16.7 | 17.06 | 16.7 | 17.08 |
| 6 | 180 | 180 | 1.000 | 16.7 | 17.06 | 16.75 | 17.08 |
| 10 | 180.5 | 180.5 | 1.000 | 16.7 | 17.06 | 16.75 | 17.08 |
| 14 | 180 | 178.5 | 0.992 | 16.7 | 17.06 | 16.7 | 17.08 |
| 18 | 153.5 | 146 | 0.951 | 16.7 | 17.06 | 33.3 | 33.63 |
| 22 | 127 | 126 | 0.992 | 16.7 | 17.07 | 33.4 | 34.13 |
| 28 | 103 | 99.5 | 0.966 | 33.3 | 33.13 | 33.4 | 34.13 |

- 帧交付崩溃阈值**两引擎一致**（L≥18 起 p95 翻倍），各档帧数比值 0.95–1.00，各档 rafJs 均值相差 <0.1%
- ⚠️ **自我纠错记录**：早期 `calibrate.mjs` 的"卡顿控制组"用 `setInterval(16ms)` + 35 ms 忙等，曾给出 Blink p50 33.3 ms vs Gecko **66.2 ms** 的 2× 差距。改用 **rAF 锁**负载后差距消失（上表）。该 2× 是**定时器调度语义差异**（Gecko 的 setInterval 在长阻塞后的补偿行为不同）造成的**仪器产物**，不是帧交付差异。此条按纪律主动记录，避免被后续线程误用。

---

## 6. 裁决（问题①②③）

### ① 同页同动效下，Gecko 是否显著慢于 Blink？——**"慢"只在特定维度成立**

| 维度 | 结论 | 倍数与区间 |
|---|---|---|
| 帧交付（帧间隔 p50/p95/p99/max、掉帧、崩溃阈值） | **无差异** | p50 比值恒为 **1.022**（= headless 的常数节拍差，非负载效应）；65 run 无 >50 ms 帧；负载曲线各档 0.95–1.00 |
| canvas 2D 动画的逐帧主线程成本 | **Gecko 显著更慢** | DPR1 **≈7.9×**（1.54 vs 0.197 ms/帧）；DPR2 **≈24–31×**（4.67–6.16 vs 0.20） |
| DOM/transform 动画的逐帧主线程成本 | **不可判定** | 名义 ≈2.0–2.3×，但两侧都贴在各自时钟粒度（0.1 / 1 ms）上 → INCONCLUSIVE |
| 每次鼠标事件处理成本（跟手路径） | **Gecko 反而更快** | **0.75×**（0.128 vs 0.169 ms） |
| DSH 首页 idle + 指针扫掠 | **无差异** | p50 比值 1.022；该页 idle 时不使用 rAF，故 rafJs 不可比 |

**一句话**：在本 harness 能测到的范围内，Gecko 的唯一劣势是**用 canvas 2D 画动效时主线程成本高一个数量级**；帧交付、负载鲁棒性、逐事件处理都不支持"Gecko 更卡"。

### ② 若慢，是否与 DPR/面积**超线性**相关？——**超线性不成立，方向性成立**

- Gecko：面积 ×4 ⇒ 成本 **≈3.0–4.0×**（中位数 3.5×，**次线性到近似线性**，约面积^0.8–1.0）
- Blink：面积 ×4 ⇒ 成本 **1.03×**（该维度无感）
- 唯一与 DPR 相关的帧交付异常（33 ms 掉帧）**只在 Gecko@DPR2** 出现（2/9 run），DPR1 为 0/26 —— 方向一致、样本不足，仅作提示
- 因此：**"高 DPR 会放大 Gecko 的 canvas 动画成本"成立；"面积超线性放大"不成立**

### ③ 适用边界（必须随结论一起传播）

1. **headless 没有绘制与合成**：Blink 的 `Performance.getMetrics` 中 **`Paint`、`CompositeLayers`、`Layout`、`RecalcStyle` 四个字段在 headless 下不存在**（已显式核验，未编造）；Gecko 走 **SWGL 软件 WebRender**，日志明确记录 `[GFX1-]: RenderCompositorSWGL failed mapping default framebuffer, no dt`。→ **光栅化/合成/GPU 上传这一最可能产生真实卡顿的环节，本实验完全没测到。**
2. 由 1 推出：**本报告不能支持"就是它导致用户卡"的任何因果说法**。它能给的只有方向性证据：*同页同动效下，Gecko 在 canvas 动画上的主线程成本是 Blink 的约 8 倍（DPR2 约 24 倍），而帧节拍与负载鲁棒性没有差异*。headless 帧间隔相等 **不等于** 屏幕上不掉帧。
3. 与用户真实环境仍有差异：headless、全新 profile、无扩展、无用户 prefs、无 a11y 强制（注意用户侧 Chrome 实测带 `--force-renderer-accessibility`，其 Firefox 是否开 a11y 未测）、合成指针事件而非真实 X11 输入、且测的是最小复现页而非 Codex/DSH 设置页。
4. **与"共享合成器对全部 X11 应用一视同仁"这条旧推断的关系**：本实验不推翻"合成器共享"，但给出一个**引擎级不对称**（canvas 动效主线程成本 8×），因此"一视同仁"若被用来解释"引擎选择无关"是**不成立**的：至少 per-frame 主线程工作量在两引擎间差一个数量级。同时也要注意：用户观察是 Chrome 顺 / Firefox 卡，而本实验显示 Gecko 的**帧交付并不差**，所以若用户侧的卡是真实掉帧，机制大概率在**绘制/合成/a11y/环境放大器**，而不是本 harness 能覆盖的主线程路径。
5. 对后续线程的一条可执行线索：**若 DSH/Codex 的"跟手波纹"是 canvas 实现，那么"Gecko 8×主线程成本 × DPR 敏感"是一条可检验的高价值假设；若是 DOM transform，则本实验给不出差异（INCONCLUSIVE），应转向 a11y / 合成器 / 缩放重光栅那一级。** 另：`hover-blur`（`backdrop-filter`）单元 Gecko 亦为 9×，若目标页有毛玻璃托盘，同样适用。

---

## 7. 纪律与锁（可审计）

- **单浏览器串行**：每个 `run-one.mjs` 进程自己 launch、测量、close，前后不重叠；`ps` 复核确认无我的残留实例（期间发现并**按显式 PID** 清掉了 2 个被工具 SIGTERM 打断而成为孤儿的、我自己 profile 前缀的 headless Firefox；用户 Firefox pid 9042 全程 `etime` 连续、未被触碰）
- **锁**：批量期间持有 `research-v2/.probe.lock`（`owner.txt` 含 `owner_pid`）。
  - phase1/phase2/phase3 正常取得并释放（`rm owner.txt && rmdir`）；接手期间遇到过 3 个**已死 owner** 的残留锁（`284598`、`310374`、以及一个只有裸 PID 的文件），已存档于 `logs/stale-owner-310374.txt`、`logs/preempted-owner-284598.txt`
  - phase4 启动时锁被 `incident2-why-these-two`（pid 408162，**存活**）持有：按协议**等待 3 分钟宽限期**后，**并发运行**，并且**没有覆盖对方 owner.txt**，而是自建 `research-v2/.probe.lock.gvb-concurrent`，在 `owner.txt` 中写明 `concurrentWith=…` 与 `loadavg_at_acquire`（≈3.06–5.36），结束即释放
  - 另：`research-v2` 下多个线程的 `owner.txt` 存在 **`pid=N` 与 `pid: N` 两种格式**。我的首个解析器只认 `pid=`，会把存活 owner 误判为死锁；已在 `scripts/phase4.sh` 修正为兼容 `owner_pid|agent_pid|pid|probe_pid` + `:`/`=` + 裸数字，**并且只删自己持有的锁目录**。建议其它线程统一格式。
- **只读原则**：DSH 首页只做 1 次 `goto` + 合成指针扫掠，**无任何点击**，未触碰保存/应用/删除
- **产物落盘**：所有结论可由 `raw/*.json` 重算；脚本可重跑（`scripts/`）

### 复现命令

```bash
cd .workspace/lag-fix/incident2/gecko-vs-blink
node scripts/run-one.mjs --engine=firefox  --dpr=2 --cell=hover-tray --rep=1 --ms=8000 --port=18890 --out=raw/p4/x.json --fineclock=1
node scripts/run-one.mjs --engine=chromium --dpr=2 --cell=hover-tray --rep=1 --ms=8000 --out=raw/p3/y.json
node scripts/timeres.mjs --engine=firefox --fineclock=1        # 时钟粒度校准
node scripts/loadcurve.mjs --engine=firefox --levels=0,6,10,14,18,22,28 --ms=3000 --passes=2
node scripts/summarize.mjs --dir=raw/p3 --out=raw/summary-p3.json
node scripts/summarize-loadcurve.mjs
```

---

## 8. 指标定义（避免误读）

| 指标 | 定义 | 采集方式 |
|---|---|---|
| 帧间隔 p50/p95/p99/max、>50 ms | instrument 自身 rAF 链的时间戳差 | 与页面自身 rAF 链**双路互证**（两路 p50 完全一致） |
| rafJs 均值/分位、>16.7 ms 计数 | 包裹 `requestAnimationFrame`，统计**每个回调内部**的 `performance.now()` 耗时（含页面 DOM 写入、**不含**回调返回后的 style/layout/paint） | 两引擎字节一致的 main-world 预注入 |
| rafJs 均值 (ms/帧) | 单位是"每帧每回调"，非总量 | 同上 |
| 逐事件 tick 成本 | 一次合成指针 tick = `elementFromPoint` + 3 类鼠标事件派发 + 页面处理函数的耗时（可能含强制 style/layout flush） | driver 内计时，样本落盘为 `tickSamples` |
| 强制 reflow 探针 | tick 后读 `body/cards/documentElement` 的几何，测 Gecko/Blink 自身的 style+layout 解析成本（opt-in，`--reflow=1`） | 仅 `dom-lefttop` 单元启用；本次未用于结论（默认时钟粒度不足） |
| LongTask / LoAF | 平台 API | **Gecko 无此 API**（§3） |
| CDP Performance.getMetrics | Blink 专有 | 存在的键已全量列出；缺失键显式声明 |

**未使用/不可用的量**：`Paint`、`CompositeLayers`、`Layout`、`RecalcStyle`（headless Blink 缺失）；Gecko 的 LongTask/LoAF、Gecko 的 CDP 指标（不存在）；Gecko 的 `about:support`（BiDi 内容侧读不到特权页）。以上一律以 null / absent 记录，**未编造任何数值**。
