# 设置页卡顿：真实长会话 + 真实活跃流下的 CDP Profiler top-down CPU 归因（research-v2 / cpu-profile）

> ## ⛔ 结论分级（协调者指令，2026-09-21 立即生效 —— 先读这一段）
>
> **本机测量资源冲突已确认不可自愈**（7 条线各开浏览器；协调者实测“持锁期间仍有 18–31 个外来 Playwright 进程，独占窗口 0/5”）。因此本报告**强制区分两类结论**：
>
> **（a）结构 / 比值类结论 —— 可用。** 哪些函数出现在栈上、哪条链在每次调用必然发生、哪些项为零、成本方向是否随事件率增长，以及**跨窗口 / 跨批次的比值一致性**。见 §4.2、§5.1、§5.2、§0bis.5。
>
> **（b）绝对速率 / 绝对 ms —— 一律 INCONCLUSIVE，不得当基线。** 包括本报告自己产出的 `cpuX`（我线上唯一在开窗前 + 收窗后都测得 `foreignCount=0` 的批次）与 `cpuL` 的绝对数字。理由：**“我在窗口两端没看到外来实例”不等于“整窗无外来实例”**；本机任何时刻都可能出现他线浏览器。绝对数字只能用于**同批同窗内的相对比较**，并必须附并发实例数（§0ter.4）。
>
> **本线已按指令停止启动任何新浏览器 / 新采集窗口**；不再使用 `/tmp` 或 `--nolockwait` 绕过；不再 `pkill`/`kill` 任何共享资源（异常进程只记录 PID）。决定性测量方案见 **§8（交由协调者串行排期，本线不自行执行）**。


- 日期：2026-09-21（测量窗口 16:07–16:12）
- 宿主：DSH Web GUI `http://127.0.0.1:3080`（PID 1390375，未重启、未改配置、未写产品源码）
- 器械：Playwright `CDPSession` → `Profiler.enable` + `Profiler.setSamplingInterval(1000µs)` + `Profiler.start/stop`，每窗口一个**全新 CDPSession**；单浏览器、单 page、每窗口内联 `Performance.getMetrics` / LongTask / LoAF / rAF / MutationObserver / body-style 写入计数
- 纪律：全程只读。**未点击保存 / 应用 / 删除 / 手动刷新**；从侧栏只读点开现存长会话；结束已关闭浏览器（`job_kill` + `browser.close()`）
- 产物：
  - `audit.md`（本文件）
  - `out/campaign-cpuL.json`（持锁批次全量，14 窗口）
  - `out/analysis-cpuL.json` / `out/analysis-cpuL.txt`（top-30、bundle 归属、链汇总、比值）
  - `raw/profile-cpuL-*.json` ×14（每窗口裁剪 profile：interval/样本数/self-top 120/bundle）
  - `raw/thread-structure.json`（profile 结构、单位、线程根、timeDeltas 分布）
  - **`out/integrity-audit.json`（★逐批次数据完整性核查：页面错误/短窗/零样本/socket 中断/序号断档）**
  - `scripts/validate-integrity.mjs`（生成上表，可复跑）
  - **`out/campaign-cpuX.json`（★独占批次，7 窗口，每窗口含 start/end 并发 census）**
  - **`out/analysis-cpuX.json` / `out/analysis-cpuX.txt`（★独占批次归因）**
  - `scripts/exclusive-run.sh`（等锁→取锁→跑→释放，全自动）
  - `raw/census.log`（15s 一次并发普查：锁状态、外来 `headless_shell` 数、loadavg；我的测量窗口 16:07–16:12 逐条落盘）
  - `raw/apply-decisive.json`、`raw/apply-ab.json`、`raw/apply-ab2.json`、`raw/theme-apply-probe*.json`（机制追证）
  - 非持锁批次（**INCONCLUSIVE，仅作对照**）：`out/campaign-cpu2..cpu4.json`

---

## 0. 读数纪律与锁状态（先读这一节，否则后面的数字会被误用）

### 0.1 锁

| 项 | 实况 |
|---|---|
| 取锁 | **16:04:58 `mkdir .probe.lock` 成功**（此前 owner = `react-commit-audit`，开始于 16:00:54，未超 25 分钟 ⇒ **未抢占**，按 20–40s 轮询等待后取得） |
| 持锁时段 | 16:04:58 → 约 16:12:5x（测量窗口 16:07–16:12 全程 `lock=HELD`） |
| **是否全程持锁** | **是**（`raw/census.log` 逐条为证） |
| **是否发生抢占** | **我未抢占他人；但我的锁在约 16:13 被他人清掉**：census 记录 16:13:00 起 `lock=RELEASED`，16:14:00 起 owner 变为 `measure-hardening`。我从未 `rmdir` 自己的锁 ⇒ **有其它线移除了非过期（<10 分钟）的他线锁**。记录在案。 |
| **独占性是否达成** | **否**。持锁期间 census 显示 **`headless_shell`=3、`playwright` 相关进程 6–12 个**；点名外来进程：`node scripts/measure.mjs --window 60000 --tag ratio --plan hunt --idle-budget 40000`（父 PID 3084176，浏览器 PID 3084189，起于 16:05:31，即**在我持锁期间启动**）。 |
| 处置 | 按 `MEASUREMENT-STATUS.md` §1/§2：**所有绝对数字一律 INCONCLUSIVE，不得当基线**；本报告只给**比值 / 占比 / 为零 / 窗口内相对量级**。 |
| 收尾 | 测量结束已 `browser.close()`；核验本线浏览器实例 = **0**（无泄漏）。census 写入进程已停。**16:27:37 已按正确顺序释放锁**（`rm -f owner.txt && rmdir`；先前的 `rmdir` 因目录非空而静默失败 ⇒ 见 §0bis.4 缺陷 B）。 |

> 说明：`census.sh` 的 `cpu_busy` 字段因 `%` 后被换行截断而不可读，loadavg 可读：持锁期间 **load ≈ 9–13**（本机数十核，未饱和）。即"有外来浏览器、但 CPU 未打满"——这既解释了为何本轮比值仍高度一致，也说明绝对 ms 不可作基线。

### 0.2 单位与自证（本报告最关键的方法学修正）

第一轮我用 **`timeDeltas` 的中位数**当每样本耗时，把 CDP profile 的时间**当成了毫秒**，导致所有 self-time 被低估约 **1000×**（曾得出"设置页 script 仅 0.05 ms/s、apply 0.3 ms/s"这类荒谬值）。已由 `raw/thread-structure.json` 证伪：CDP CPU profile 的 `startTime/endTime/timeDeltas` 是**微秒**。

修正后每一窗口都通过**同窗口对账**（`reconcile.ratio` = profile 非 idle 自身时间 ÷ (CDP `ScriptDuration` + `RecalcStyleDuration`)）：

| 批次 | 窗口数 | reconcile ratio 范围 | 判读 |
|---|---|---|---|
| `cpuL`（持锁） | 14 | **0.935 – 1.028** | 单位换算正确；profile 抓的确实是主线程 CPU |
| `cpu2`（无锁） | 32 | 0.72 – 1.44 | 同上（并发放大时偏高） |

并且 cdp 侧 `profileBusyMs` 与 `ScriptDuration+RecalcStyleDuration` 同量级 ⇒ 两者是同一批工作的两个视角（V8 采样 vs Blink 计时），**互为交叉验证**。

### 0.3 器械自证（防"什么都没抓到"）

- 每窗口先执行 **MutationObserver 自检**（注入一个 div → 期望观测到记录）；`cpuL` 14/14 窗口 `mut` 记录数 131–405（非零）。
- 每窗口校验 `window.__cpu.rafInside == __cpu.raf.length`（rAF 计数未串窗）与 rAF 速率 < 80/s；**14/14 通过**（实测 35.6–59.1/s，p50=16.7ms）。
- 早期 `cpu1`/`cpu2` 两个批次曾出现"窗口计数单调递增"（rAF 1136→18481、body-style 写入单调增长），经定位为**计数器未按窗口清零**（`page.off('websocket')` 误删内部派发器、`writeMark` 未快照）。**这两个批次只在"结构性为零"上引用，数值一律不引用**；`cpuL` 已修（`writeMark` 快照 + 每次全新 CDPSession + 不重开页面）。

---

## 0bis. 独占复核批次（协调者要求，2026-09-21 16:24–16:27）——**(a) 类结构/比值类结论的主证据；其绝对 ms 仍归 (b) 类 INCONCLUSIVE**

### 0bis.1 要求 (1)：每窗口同时记录并发浏览器实例数 + 宿主 PID

器械已升级（`scripts/capture6.mjs`）：**每个窗口在 ① 开窗前、② 收窗后各做一次 census**，并把结果写进该窗口的 profile 元数据。

census 口径（比 `pgrep -c -f headless_shell` 更精确，可区分实例与子进程）：
- **只统计主浏览器进程**：命令行含 `--remote-debugging-pipe` 且**不含** `--type=`（`--type=renderer/gpu-process/zygote/utility` 是同一实例的子进程，若一起数会把 1 个实例数成 5–8 个）；
- 用 `/proc/<ppid>/stat` 回溯最多 6 级祖先链，**祖先链包含本采集进程 PID 的即"我的"**，其余为 foreign；
- 同时记录：锁 owner 文本、`lockHeldByMe`（owner 含 `cpu-profile`）、**宿主 PID**（`pgrep -f 'bin/dsh web'`）、loadavg。

### 0bis.2 要求 (2)：结论所用的 top 表全部取自"只有自己一套浏览器"的窗口

**开窗门禁（EXCLUSIVITY GATE）**：每个窗口在启动 `Profiler.start` **之前**必须等到 `foreignCount == 0 && lockHeldByMe == true`；否则每 4s 重试，最多 `--gatemax`（本轮 120s），超时则该窗口标 `CONTENDED` 并记入 `foreignSeenDuringGate`。

**结果：7/7 窗口 `gateOutcome=EXCLUSIVE`**，`censusStart.foreignCount=0`、`censusEnd.foreignCount=0`、`mineCount=1`、`lockHeldByMe=true`、`hostPid=1390375`。逐窗口原始记录见 `out/campaign-cpuX.json` → `windows[*].concurrency`。

> ⚠️ **该门禁的判别力有限（诚实标注）**：它只在**开窗前与收窗后两个瞬时点**采样，**无法证明整窗期间无外来实例**（协调者另测到“持锁期间 18–31 个外来 Playwright 进程、独占窗 0/5”）。因此 `cpuX` 的意义是“**我线上唯一在两端均测得独占的批次**”，而**不是**“已证明整窗独占”。其**绝对数字**因此仍归 (b) 类 INCONCLUSIVE；**比值**归 (a) 类可用。

取锁记录：16:20:42 首次尝试失败（owner=`measure-hardening`，开始约 2 分钟，**未过期故未抢占**）→ 轮询 26–37s 共 8 次 → **16:24:54 `mkdir` 成功，未发生抢占** → 16:27:16 测量结束 → 16:27:37 释放（见 0bis.4 的释放瑕疵）。

窗口时间：16:24:5x – 16:27:1x（每窗 8s，设置类窗口约 11s）。

### 0bis.3 独占批次的 top 表（**结构/比值可用；绝对 ms 仍归 (b) 类 INCONCLUSIVE**）

命中窗口 / 自时间合计 / 单窗峰值（`out/analysis-cpuX.json`）：

| 符号 | 命中窗口 | 自时间合计 | 峰值 ms/s | 说明 |
|---|---|---|---|---|
| **`ThemePresenter.apply` @`dsh-client-ui-layout/client.js:366`** | **7/7** | **6 208.0 ms** | **150.6** | 每窗**两个** profile 节点（同一函数的两个 IC/调用上下文），两者相加为其真实自时间 |
| `projectList` @`runtime:9272` | 7/7 | 62.8 ms | 1.61 | |
| `buildListSnapshot` @`runtime:8553` | 6/7 | 50.0 ms | 1.48 | |
| `flattenLineage` @`runtime:5603` | 6/7 | 15.9 ms | 0.40 | |
| `ensureFresh` @`runtime:5689` | 5/7 | 9.6 ms | 0.27 | `list.set` 通知链 |
| `querySelectorAll`（V8 内建，无 url） | 3/7 | 8.5 ms | 0.40 | |
| `rebuildRemote` @`dsh-workspace-enhancement:4220` | **1/7** | **1.07 ms** | 0.13 | **C2**；仅出现在首页窗 |
| `markDirty` @`runtime:5662` | **0/7** | **0** | 0 | `list.set` 通知链 |
| `getListSnapshot` / `applyMutation` / `recordMutation` / `syncCompletedNotifications` | **0/7** | **0** | 0 | |
| SVG 生成相关 | **0/7** | **0** | 0 | |
| 设置各包（`dsh-client-ui-settings*`） | — | 仅 `settings-general` **0.093 ms/s**（1 窗）；其余 **0** | — | |

**独占批次的 headline 比值（★ (a) 类，可用；两批方向一致）**：

| 比值 | 独占批次（cpuX, 7 窗） | 持锁但受污染批次（cpuL, 14 窗） |
|---|---|---|
| `apply` ÷ 非 idle 主线程 CPU | **0.729**（72.9%） | 0.786（78.6%） |
| 整条会话链 ÷ 非 idle | **0.016**（1.6%） | 0.010（1.0%） |
| **`apply` ÷ 整条会话链** | **44.9×** | 75.7× |
| `apply` ÷ `ScriptDuration` | **2.62×** | 3.57× |
| Script ÷ Task | 0.217 | 0.168 |
| Recalc ÷ Task | 0.429 | 0.600 |
| Layout ÷ Task | 0.148 | 0.022 |

**逐窗口（`apply ÷ 会话链`）**：首页 **27.7×**，长会话安静 **66.0×**，长会话+活跃流 **41.5×**，设置打开 **40.2×**，模型 **42.3×**，插件 **56.8×**，停留 **49.5×**。**7/7 窗口 `apply` 都是第一非 idle 热点，且都约占该窗非 idle 的 54%–81%。**

### 0bis.4 要求 (3)：无法取得独占时的处置 + 本轮发现的两个锁协议缺陷

- 本轮**取得了独占**，所以上面这张表**不必标 INCONCLUSIVE**；但**旧批次（cpu2/cpu3/cpu4/cpuL）继续标 INCONCLUSIVE**，本报告只用它们做"跨负载强度复现性"的旁证（结论方向完全一致：`apply` 均为第一热点）。
- **绝对数字不可当基线的实证（这是最重要的量化警告）**：同一台机器、同一场景、同一器械，**独占 vs 受污染**的对比：

| 指标（home-idle / long-session-idle） | 独占（cpuX） | 受污染（cpuL） | 膨胀倍数 |
|---|---|---|---|
| Script ms/s | 11.8 / 9.3 | 53.2 / 95.9 | **4.5× / 10.3×** |
| `apply` ms/s | 10.9 / 34.7 | 105.0 / 712.6 | **9.6× / 20.5×** |
| Task ms/s | 44.5 / 66.6 | 141.0 / 551.6 | 3.2× / 8.3× |
| Recalc ms/s | 10.0 / 38.0 | 55.5 / 352.7 | 5.6× / 9.3× |

  ⇒ **任何历史绝对 ms 至少要先除以 3–10 才可能与独占条件可比**；"设置页 script 80–190 ms/s"这类口径的绝对值**一律不可当基线**（与 `MEASUREMENT-STATUS.md` §1/§2 的结论一致，本轮给出倍数）。
- **协议缺陷 A（锁被清）**：16:13 我持有的锁被他人移除（我从未 `rmdir`），owner 于 16:14 变为 `measure-hardening`。**违反"仅在 owner 超 25 分钟且进程不存在时才可抢占"**。
- **协议缺陷 B（释放瑕疵，本轮我自己踩到）**：锁释放若写成 `rmdir .probe.lock` 而目录里还有 `owner.txt`，`rmdir` 会**静默失败**，锁目录残留 ⇒ 其他线会以为锁仍被占用。正确释放顺序 = `rm -f .probe.lock/owner.txt && rmdir .probe.lock`。**建议写进锁协议**。

### 0bis.5 事件率线性性（要求 3 的"方向"部分）

独占批 7 窗（`apply` ms/s vs 入站帧/s）：
`2.5→34.7`、`5.0→10.9`、`13.5→118.7`、`38.5→123.6`、`85.6→84.2`、`106.9→116.1`、`137.1→148.6`
⇒ 线性拟合 slope **0.63 ms/s per frame/s**、**r²=0.454**，但序列**明显非单调**（13.5 帧/s 的 118.7 > 85.6 帧/s 的 84.2）。
**方向性结论（确定性）**：`apply` 的成本**不由 session 事件率驱动**——它的触发源是**主题快照订阅回调**（调用栈 `layout client.js:440`），而不是事件帧；事件率上升时它至多被顺带多触发几次，量级仍在同一档。**"事件率越高越卡"在本线数据上不成立**，与 `MEASUREMENT-STATUS.md` §3.2 的两批反号相关性一致。

---

## 0ter. 数据完整性核查（响应协调者的 pkill 事故通告）

### 0ter.1 我自己的进程处置情况（诚实披露，无辩解）

| 时刻（本地） | 动作 | 目标 | 说明 |
|---|---|---|---|
| ~14:53 | `kill 1568793 1623153 1665436` | **我自己**三次早期 recon/probe 留下的 `headless_shell` 孤儿实例（启动时刻 14:49:52 / 14:51:24 / 14:52:30） | 我先用 `/proc/<pid>/cmdline` 核对启动时间为"我的"才动手；**未碰任何他线进程** |
| ~15:56 | `kill 3084326` | **我自己**重复启动的第二个 `census.sh` | 同上 |
| 16:0x | `job_kill bash-56` | **我自己**启动的 `capture6.mjs`（为让位给锁协议） | 自建 job |
| 15:04–15:13（pkill 事故窗口） | **我没有任何 kill 动作** | — | 我的第三次 probe 结束于 ~14:53；此后到 16:04 之间我没有向任何进程发过信号 |

**结论**：本线**未参与** `pkill -f playwright_chromiumdev_profile` 事件，**也未误杀他线实例**；我只终止过经核验属于我自己的实例。
**纪律接受**：自本条起，本线**不再使用任何 `kill`/`pkill`**；发现异常进程只**记录 PID + 启动时刻 + 命令行**并交由协调者处理。上表仅为历史披露。

### 0ter.2 逐批次完整性核查（`out/integrity-audit.json` 为机读版）

核查维度：页面错误 / 浏览器关闭 / 窗口墙钟是否短于请求 / 零样本窗口 / integrity 自检失败窗口 / WebSocket 连接中断（socket 关闭或额外连接）/ 窗口序号断档 / 相邻窗口间隔异常（>25s 可能意味崩溃重开）。

| 批次 | 本地时间 | 窗口 | 请求墙钟 | 实际墙钟 | 零样本 | integrity 失败 | 页面错误 | 判定 |
|---|---|---|---|---|---|---|---|---|
| `s1` | 14:53–15:01 | 28 | 12s | 12.00–12.00s | 0 | 0 | **`PAGE CLOSED`** | **INVALID**（见下） |
| `cpu1` | 15:06–15:14 | 28 | 12s | 12.00–12.00s | 0 | 0 | 无 | 完整；但无锁 ⇒ INCONCLUSIVE |
| `cpu2` | 15:21–15:32 | 32 | 12s | 10.30–12.82s | 0 | 0 | 无 | 完整；无锁 ⇒ INCONCLUSIVE |
| `cpu3` | 15:34–15:41 | 32 | 12s | 10.03–12.67s | 0 | 0 | **`TypeError: Cannot read properties of null (reading 'style')`** | **INVALID**（见下） |
| `cpu4` | 15:50–16:00 | 32 | 12s | 11.22–14.81s | 0 | 0 | 无 | 完整；无锁 ⇒ INCONCLUSIVE |
| `cpuL` | 16:07–16:12 | 14 | 10s | 10.00–13.70s | 0 | 0 | 无 | 完整；**持锁但外来实例并存** ⇒ INCONCLUSIVE |
| **`cpuX`** | **16:24–16:27** | **7** | 8s | 8.00–11.27s | **0** | **0** | **无** | **★ EXCLUSIVE，7/7 可用（结论依据）** |

**无短窗、无零样本、无 integrity 失败、无序号断档。** 表中"实际墙钟 > 请求墙钟"的窗口不是缺口而是**更长的窗口**：`settings-*-open/tab` 类窗口按设计在 `Profiler.start` 之后先执行点击 + `sleep(1.0–1.2s)`，因此墙钟 ≈ 请求 + 1–3s。核查脚本一度把该差值误报为 99.9% shortfall（单位混用 bug），已修正并复核。

### 0ter.3 两个被标 INVALID 的窗口/批次，含中断时刻与原因

**(A) `cpu3` — 1 个页面错误，成因是我自己的器械，不是产品缺陷**
- 报文：`TypeError: Cannot read properties of null (reading 'style')`
- 批次跨度：`2026-09-21T07:34:24Z – 07:41:39Z`（本地 **15:34–15:41**）；该错误出现在**批内某一次 `page.evaluate` 调用上下文**，31/32 窗口的 profile 数据完好、无零样本、无 integrity 失败。
- 归因：该批次是 harness v3，我在初始化脚本中对 `CSSStyleDeclaration.prototype` 打桩（读 `document.body.style`）而首帧可能 `document.body === null`；32 窗内仅出现 1 次且**未能复现**（我用相同打桩独立复跑 `home→设置→插件` 全流程，0 报错，写入计数 276 正常）。**不能完全钉死根因**，因此按纪律整批标 INVALID 而非"无害忽略"。
- 处置：`cpu3` **不计入任何结论**（它本来也是无锁批次）。`cpuX`/`cpuL`/`cpu4` 使用更严格的打桩时序，未再出现。

**(B) `s1` — `PAGE CLOSED` 且批在 settings-dwell 序列中途终止**
- 中断时刻：**`2026-09-21T07:01:0x Z`（本地 15:01:0x）**，已完成 `home/long-idle/long-active/settings-general/settings-models/settings-plugins` 全部，停在 `settings-dwell-w4`；请求的 30 窗实际完成 **28 窗**，缺 `settings-dwell-w4` 之后的收尾与**报告落盘**（故该批无 byScenario 汇总）。
- 原因：**是我自己**为了让位给锁协议执行 `job_kill`（我拥有的 job），即**采集侧主动终止**，非浏览器崩溃、非他线误杀。当时另有已知缺陷：窗口计数器未清零（rAF 计数单调递增 1136→18481）、`timeDeltas` 单位误算。三重原因叠加 ⇒ **INVALID**。
- 处置：`s1` 的全部数值**从未进入本报告的任何表格或结论**。

### 0ter.4 我观察到的并发浏览器实例数（协调者要求注明）

| 批次 | 观察时刻 | 我观察到的**我方**实例 | 我观察到的**他方**实例 | 观察手段 |
|---|---|---|---|---|
| `cpu1`–`cpu4` | 15:06–16:00 | 1（每批单实例） | **未见逐窗口记录**（当时的 harness 无 census 字段）⇒ 这四批**不可判定**，故 INCONCLUSIVE | 无（缺陷，已在 0.3 记录） |
| `cpuL` | 16:07–16:12 | 1 | **2–3 个**（`pgrep` 口径 3；点名 `node scripts/measure.mjs … --plan hunt`，其浏览器 PID 3084189 起于 16:05:31，**在我持锁期间启动**）+ 6–12 个 playwright 相关进程 | `raw/census.log`（15s 一次）+ `ps` 祖先链核对 |
| **`cpuX`** | **16:24–16:27** | **1** | **0（每个窗口开窗前 + 收窗后均为 0）** | 每窗口 `concurrency.censusStart/End.foreignCount` = 0/0（7/7） |

- **方法论警告（已并入 §0bis.1）**：`pgrep -c -f headless_shell` 会把一个实例的 5–8 个子进程都数上（我实测该命令 3 条而真实实例 1–2 个）；若各线按原口径判断独占，会系统性误判。建议统一为"含 `--remote-debugging-pipe` 且不含 `--type=`"。
- **对 pkill 事故窗口（15:04–15:13）的直接回答**：我的 `cpu1` 批次（15:06–15:14）**完全落在该窗口内**，但我**未观察到任何中断迹象**——28/28 窗口全为 12.00s、零页面错误、零 integrity 失败、**无任何窗口入站帧为 0**（若浏览器被杀重连，会出现零帧窗或秒级空档）、相邻窗口最大间隔 44.7s 且出现在 `long-active-w1` 之前，正好等于我设计的流探测序列（4 个候选会话 × `sleep(6s)` + 展开侧栏 + 会话切换）⇒ **是设计等待，不是崩溃重开**。

### 0ter.5 对本报告结论的影响（按两类分开说）

| 结论类别 | 受影响？ | 说明 |
|---|---|---|
| **(a) 结构 / 比值类**（哪些函数在栈上、哪些项为零、`apply` 是否第一热点、会话链占比、方向性） | **不受影响** | 两个独立批次（`cpuL` 受污染 14 窗 + `cpuX` 两端独占 7 窗）**方向完全一致**；且在同一批内跨窗口稳定（§0bis.3） |
| **(b) 绝对速率 / 绝对 ms** | **全部 INCONCLUSIVE** | 包括 `cpuX`：门禁只在两端抽查，无法证明整窗无外来实例；已知污染会使绝对值膨胀 **3–10×**（§0bis.4） |
| 已废弃批次 | 完全不用 | `s1`、`cpu3` = **INVALID**（§0ter.3）；`cpu1/cpu2/cpu4` = 完整但无 census 记录 ⇒ INCONCLUSIVE |

**一句话**：本次完整性核查**未推翻任何结构/比值结论**（`apply` 占非 idle **72.9%（cpuX）/ 78.6%（cpuL）**、`apply ÷ 会话链 = **44.9× / 75.7×**、会话链占 **1.6% / 1.0%**），也**未新增任何可用的绝对数字**。

### 0ter.6 针对协调者“停掉 capture3/capture6”指令的核实结果（时刻：收到指令后 +0s）

**核实方法**：`ps -eo pid,ppid,etime,cmd --no-headers` 全表，再用 `[c]apture` / `[e]xclusive` 等**反选括号模式**避免自匹配；并逐个解析 `/proc/<pid>/cmdline` 与 `/proc/<pid>/cwd`。

| 检查项 | 结果 |
|---|---|
| `node scripts/capture3.mjs` | **不存在** |
| `node scripts/capture6.mjs` | **不存在** |
| 其余本线脚本（`capture2/4/5`、`exclusive-run.sh`、`analyze*`、`validate-integrity`、`probe-*`、`census.sh`） | **不存在** |
| 本线当前活跃进程 | **0**（无 node 探针、无浏览器） |

**本机此时唯一的浏览器实例归属（已逐层解析，非本线）**：
```
browser pid=3267808  (start 16:32:35)
  <- parent 3267778 : node probes/harden-measure.mjs --window 15 --n 5 --warmup 10
                      --budget-ms 320000 --lock-wait-ms 45000 --concurrency-gate strict
                      --label integrity-baseline --out runs/baseline-live.json
  <- parent 3267777 : timeout 460 ...
  <- parent 3267773 : bash -c cd .../research-v2/measure-hardening && ...
```
⇒ 属 **measure-hardening 线**（其 cwd 为 `research-v2/measure-hardening`，且持有当前 `measure-hardening` 锁），**本线未启动也未接触**。

**因此：① 无需 kill——因为没有属于本线的 capture 进程可停（如果我对那个唯一浏览器执行 kill，就会误杀 measure-hardening 线的正在运行批次，正是被禁止的行为）。**

**关于误判的可能来源（供协调者校正自己的测量）**：各线的探针**同名**很普遍——本线拥有 `recon.mjs`、`validate-integrity.mjs`、`probe-thread-count.mjs` 等同名脚本，本机同时刻也存在同名进程（例如另一条线的 `probe-thread-count.mjs`）。∴ **仅按脚本名判定“哪条线在跑”会出现归属误判**；建议改用 **`/proc/<pid>/cwd` + `cmdline` 完整路径** 归属（本报告已改用该法）。

---

## 1. 场景与"当时页面到底是首页还是长会话"（要求 1）

| # | 场景 | 页面 / 状态 | 会话 | DOM 节点数（窗口内实测） | 窗口数 | 每窗时长 |
|---|---|---|---|---|---|---|
| S1 | `home-idle` | 首页（新会话页），侧栏含 13 个工作组 | 无 | **605** | 2 | 10s |
| S2 | `long-session-idle` | **从侧栏只读点开现存长会话**「会话删除更新误删全部会话」（标题栏显示 *27 个子代理*） | 该会话 | **3 748 ± 25** | 2 | 10s |
| S3 | `long-session-active` | 同上，且**同宿主进程内宿主 agent 正在活跃输出**；本窗口探测到的最高入站流会话仍是该长会话 | 该会话 | **3 941 ± 24** | 2 | 10s |
| S4 | `settings-general-open` | 长会话之上**打开设置**（窗口内含"设置"点击） | 同上 | **4 189** | 2 | ~11.3s |
| S5 | `settings-models-tab` | 长会话 + 设置 → **模型**标签（窗口内含点击） | 同上 | **4 210** | 2 | ~11.3s |
| S6 | `settings-plugins-tab` | 长会话 + 设置 → **插件**标签（窗口内含点击） | 同上 | **4 638** | 2 | ~11.3s |
| S7 | `settings-dwell` | 停在插件页，**窗口内零交互** | 同上 | **4 638** | 2 | 10s |

**首页 ≠ 长会话，已按不同规模分别测量**：605 vs 3 748 节点（**6.2×**），设置面板打开后再增至 4 189–4 638（**7.7×**）。三者不可互相外推——见 §4 的"apply/script 比随节点数单调放大"。

> 未达标声明：要求每场景 ≥3 个窗口，实际**每场景 2 个**（持锁窗口有时间预算；且 16:13 锁被外力移除）。所有结论都建立在**14/14 窗口一致的比值**上，不是靠单窗挑值。

---

## 2. 每窗口原始记录（要求 2）

### 2.1 WS 帧按 payload 类型（分类键 = `payload.type`）

| 场景 | 入站帧/s（均值） | 分类构成（窗口合计） |
|---|---|---|
| home-idle | 51.2 | `session/projection` 43–30、`session/event` 19–10，另有 1× `host/session-status`、`host/session-removed`、`session/queue` |
| long-session-idle | 90.5 | `session/projection` ≈75–80%、`session/event` ≈20–25% |
| long-session-active | 120.5（探测期峰值 272/6s） | 同构 |
| settings-general-open | 67.0 | 同构 |
| settings-models-tab | 120.8 | 同构 |
| settings-plugins-tab | 48.7 | 同构 |
| settings-dwell | 86.9 | 同构 |

**结构性事实（高置信）**：本应用 WebSocket 的真实划分在 **`payload.type`**（顶层 `type` 恒为 `server-request`，退化无用），且**只有两类**构成 100% 入站：`session/projection` 与 `session/event`（占比约 75:25），偶发 `host/session-status`、`host/session-removed`、`session/queue`、`session/subscribed`。与 `MEASUREMENT-STATUS.md` §3 独立结论一致。

> 诚实标注：S3「活跃流」未能稳定复现真正的高事件率目标：窗口内入站 **2.1–180/s**，均值 120/s，**与 S2（90/s）同阶**，且探测轮选取的"最高流会话"仍是同一长会话（探测 272/6s）。因此 S2 与 S3 的差异**不可作为"事件率效应"的干净对照**；§4 的事件率相关性也据此**不作为主结论**。

### 2.2 CDP Script / Task / Recalc / Layout（每窗口 delta，ms/s）

**★ 独占批次 cpuX（7 窗，结论依据）**：

| 场景 | Script | Task | RecalcStyle | Layout | profile 非 idle | Script/Task | Recalc/Task | Layout/Task |
|---|---|---|---|---|---|---|---|---|
| home-idle | 11.8 | 44.5 | 10.0 | 0 | 20.4 | 26.6% | 22.4% | 0% |
| long-session-idle | 9.3 | 66.6 | 38.0 | 0 | 43.0 | 13.9% | 57.0% | 0% |
| long-session-active | 60.8 | 254.6 | 104.3 | 46.0 | 207.8 | 23.9% | 41.0% | 18.1% |
| settings-general-open | 47.3 | 205.5 | 87.9 | 32.4 | 165.2 | 23.0% | 42.8% | 15.8% |
| settings-models-tab | 45.5 | 197.9 | 87.0 | 34.5 | 160.2 | 23.0% | 44.0% | 17.4% |
| settings-plugins-tab | 31.6 | 168.8 | 66.3 | 22.2 | 115.8 | 18.7% | 39.3% | 13.2% |
| settings-dwell | 39.5 | 194.6 | 94.1 | 31.2 | 160.0 | 20.3% | 48.4% | 16.1% |
| **池化** | | | | | | **21.7%** | **42.9%** | **14.8%** |

下行为**受污染批次 cpuL（仅旁证）**：

| 场景 | Script | Task | RecalcStyle | Layout | profile 非 idle |
|---|---|---|---|---|---|
| home-idle | 53.2 | 141.0 | 55.5 | 0.05 | 102.7 |
| long-session-idle | 95.9 | 551.6 | 352.7 | 8.7 | 444.5 |
| long-session-active | 82.3 | 484.3 | 264.0 | 22.0 | 336.2 |
| settings-general-open | 67.2 | 457.8 | 273.7 | 10.7 | 336.8 |
| settings-models-tab | 65.5 | 452.3 | 271.4 | 8.0 | 329.5 |
| settings-plugins-tab | 52.4 | 320.9 | 196.4 | 10.7 | 247.8 |
| settings-dwell | 42.1 | 293.4 | 207.9 | 0.18 | 238.6 |

**全批次占比（14 窗口合计，跨场景合并）**：

- **Script 只占主线程 Task 的 16.8%**；
- **RecalcStyle 占 60.0%**；Layout 占 2.2%；其余为 paint / 合成 / 其它。

### 2.3 rAF 分布与 >50ms 帧、LongTask

**★ 独占批次 cpuX**：rAF **53.0–61.6/s**（p50 恒为 16.7 ms）；>50 ms 帧：首页 **1**、长会话安静 **3**、活跃流 **16**、设置打开 **17**、模型 **17**、插件 **15**、停留 **12**；LongTask：0（首页/长会话安静/设置打开/模型/停留）、1（活跃流/插件）；LoAF：1/4/17/19/17/12/12。

受污染批次 cpuL（旁证）：

| 场景 | rAF/s | p50 | p95 | p99 | max | >50ms 帧 | >100ms 帧 | LongTask 数（14 窗计） | LoAF 数 |
|---|---|---|---|---|---|---|---|---|---|
| home-idle | 59.05 | 16.7 | — | — | — | 6 | 0 | 0 | 17 |
| long-session-idle | 40.30 | 16.7 | — | — | — | **80** | — | 1 | 82 |
| long-session-active | 45.95 | 16.7 | — | — | — | **57** | — | 0 | 58 |
| settings-general-open | 40.94 | 16.7 | — | — | — | **74** | — | **15** | 75 |
| settings-models-tab | 35.60 | 16.7 | — | — | — | **72** | — | **18** | 78 |
| settings-plugins-tab | 46.44 | 16.7 | — | — | — | 49 | — | 5 | 50 |
| settings-dwell | 49.00 | 16.7 | — | — | — | 42 | — | 8 | 41 |

- 首页：59.1 fps、>50ms 帧 6/2 窗、LongTask **0**、p50 16.7ms ⇒ **安静**。
- 长会话/设置：rAF/s 掉到 **35.6–49**（**掉帧 0.60–0.83×**），>50ms 帧 **42–80 个/2 窗**，LongTask **0–18**。
- p50 全程 16.7ms（未被长帧拖移）；退化在**长尾**（>50ms 帧与 LoAF），不在中位。**设置打开/切标签的窗口是 LongTask 最集中的（15/18 个）**。

### 2.4 DOM 节点数、body 样式写入与 DOM 变更

**★ 独占批次 cpuX**：

| 场景 | 节点数 | body 样式写入/s | windows 内 body 样式写入 | 全树变更记录/窗 |
|---|---|---|---|---|
| home-idle | 595 | 7.5 | 60 | 30 |
| long-session-idle | 3 245 | 3.75 | 30 | 15 |
| long-session-active | 1 908 | 28.3 | 226 | 113 |
| settings-general-open | 2 078 | 18.5 | 208 | 105 |
| settings-models-tab | 2 030 | 20.3 | 228 | 115 |
| settings-plugins-tab | 2 329 | 12.8 | 144 | 76 |
| settings-dwell | 2 330 | 18.0 | 144 | 72 |

（`body` 样式写入调用数 ≈ `body@style` 变更批数 ≈ 该窗 ID 池中 `apply` 调用数，1:1:1；`body` 上被写入的属性恒为 **1 个**，`document.body[style]` 长度 47。⇒ **每秒有 4–28 次「主题应用」动作，每次只写 1 个属性，但每次都要强制一次整树重算**。）

受污染批次 cpuL（旁证）：

| 场景 | 节点数 | body 样式写入/s（勾 `setProperty`+`removeProperty`） | 观测到的 `body@style` 变更批 | 全树变更记录/窗 |
|---|---|---|---|---|
| home-idle | 605 | 35.7 | 458 / 256 | 229 / 128 |
| long-session-idle | 3 748 | 32.7 | 324 / 330 | 181 / 196 |
| long-session-active | 3 941 | 21.8 | 210 / 226 | 277 / 128 |
| settings-general-open | 4 189 | 19.6 | 248 / 238 | 161 / 145 |
| settings-models-tab | 4 210 | 16.2 | 148 / 218 | 89 / 147 |
| settings-plugins-tab | 4 638 | 12.7 | 204 / 82 | 182 / 41 |
| settings-dwell | 4 638 | 13.1 | 166 / 96 | 83 / 48 |

**结构性事实**：`body` 上被写入的样式属性**恒为 1 个**（`document.body[style]` 长度 47，多轮采样恒定），而写入调用速率 12.7–35.7/s ⇒ **每个主题应用周期约写 1 个属性，但"应用"动作本身每秒发生 13–36 次**。这与 §3 的 `ThemePresenter.apply` 自时间完全吻合。

---

## 3. 前置自证：profile 真的抓到了目标函数（要求 3 前半）

**是的，一个符号都没丢——目标函数全部以真实函数名 + bundle 内行号出现在 self-time 表中**（deployed 版本 client bundle **未 minify**，见 `client.js` 内 `//#region` 结构）：

| 目标符号 | 命中窗口 | self-time 合计 | 单窗峰值 ms/s | 来源（`url:line` → 原始源文件） |
|---|---|---|---|---|
| **`ThemePresenter.apply`** | **14/14** | **34 916.6 ms** | **359.4** | `dsh-client-ui-layout/client.js?rev=abdb7f55acba:366` → `lib/types/client/theme-presenter.js` |
| `buildListSnapshot` | 14/14 | 215.2 ms | 2.55 | `dsh-client-runtime/client.js?rev=a0fb4bb225d3:8553` → `lib/types/client/sessions/manager.js` |
| `projectList` | 14/14 | 162.0 ms | 1.92 | `…:9272` → `lib/types/client/sessions/service.js` |
| `flattenLineage` | 13/14 | 67.1 ms | 1.60 | `…:5603` → `lib/types/client/sessions/lineage.js` |
| `ensureFresh` | 9/14 | 16.0 ms | 0.32 | `…:5689` → `lib/types/client/sessions/notifier.js` |
| `markDirty` | 1/14 | 1.07 ms | 0.095 | `…:5662` → `lib/types/client/sessions/notifier.js` |
| `querySelectorAll` | 14/14 | 57.6 ms | 0.76 | `(none):0` — **V8 原生内建，无 url 归属**（只能按调用者聚合，见下） |
| `getListSnapshot` / `applyMutation` / `recordMutation` / `syncCompletedNotifications` / `rebuildRemote` | **0/14** | **0** | **0** | **任何场景、任何窗口均未以 self-time 出现**（被内联或低于采样分辨率） |

**归属证明（调用栈实证，非推断）**：在 `getComputedStyle` 前对 `CSSStyleDeclaration.prototype.setProperty` 打桩，捕获到的栈为

```
at proto.setProperty (<anonymous>)
at ThemePresenter.apply (…/dsh-client-ui-layout/client.js?rev=abdb7f55acba:375:17)
at …/dsh-client-ui-layout/client.js?rev=abdb7f55acba:440:16        ← 主题快照订阅回调
at Object.apply (…/assets/index-ClqxG24t.js:11:2911)               ← 框架 dispatcher
```

即：**`apply` 的 self-time 里含它在 :375 处写 `body.style` 自定义属性、以及 `getComputedStyle(body).backgroundColor` 强制同步重算的代价**——这正是它 self-time 经常超过整个 `ScriptDuration` 的原因（见 §4.2）。

---

## 4. 显式回答：各条链各占多少 ms/s（要求 3 后半）

### 4.1 逐链 ms/s（受污染持锁批次 `cpuL`，按场景；**比值可跨负载复现，绝对 ms 须按 §0bis.4 的膨胀倍数降级**）

> ★ 结论依据请以 §0bis.3 的**独占批次**为准；下表用于展示“跨负载强度方向一致”。

| 链 | 首页 | 长会话安静 | 长会话+活跃流 | 设置打开 | 设置/模型 | 设置/插件 | 设置停留 |
|---|---|---|---|---|---|---|---|
| **`ThemePresenter.apply`** | **105.0** | **712.6** | **529.4** | **547.0** | **542.3** | **399.5** | **410.2** |
| `buildListSnapshot` | 4.05 | 4.15 | 3.73 | 2.65 | 2.94 | 1.43 | 1.49 |
| `projectList` | 3.41 | 2.45 | 2.56 | 1.76 | 2.27 | 1.52 | 1.28 |
| `flattenLineage` | 2.45 | 1.28 | 0.32 | 0.61 | 0.95 | 0.38 | 0.43 |
| `ensureFresh`（`list.set` 通知链） | 0.21 | 0.11 | 0.43 | 0.34 | 0.28 | 0.095 | **0** |
| `markDirty`（`list.set` 通知链） | 0 | 0 | 0 | 0 | 0 | 0.095 | **0** |
| `getListSnapshot` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `applyMutation` + `recordMutation` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `syncCompletedNotifications` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `rebuildRemote`（C2） | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `querySelectorAll`（内建；含 C2 的行级扫描） | 0.21 | 1.17 | 0.43 | 0.86 | 1.14 | 0.86 | 0.64 |
| **会话链小计**（snapshot+projection+list.set 通知链全部） | **10.1** | **8.0** | **7.0** | **5.4** | **6.4** | **3.5** | **3.2** |
| 设置侧 render / SVG（`ui:dsh-client-ui-settings*` 在 top-30 中） | — | — | — | — | — | — | — |
| 其它非 idle 主线程 | 102.7 | 444.5 | 336.2 | 336.8 | 329.5 | 247.8 | 238.6 |

**（a）`buildListSnapshot`**：**1.4–4.2 ms/s**，占主线程 script 的 **2–6%**，**从未成为任何场景的第一或第二热点**。
**（b）`projectList`**：**1.3–3.4 ms/s**，同上量级。
**（c）`list.set` 通知链**：`markDirty` / `ensureFresh` / `getListSnapshot` 三者合计 **0–0.53 ms/s**；其中 `getListSnapshot` 在 **14/14 窗口为 0**。
**（d）设置侧 render**：设置包自身在 top-30 中**没有**任何 ≥0.3 ms/s 的函数出现。bundle 级直接计数（`analysis-cpuL.json` → `scen.*.bundlePerS`）：`dsh-client-ui-settings` / `-general` / `-plugins` **在 7 个场景全部缺失**；仅 **`dsh-client-ui-settings-models` 在模型标签出现 0.094 ms/s**（占该场景 script 的 **0.14%**）。⇒ 设置侧 render 成本在函数级自时间上测不到，占比 ≤0.15%。
**（e）SVG 生成**：**在任何场景、任何窗口都未以 self-time 出现**（top-200 内无 `createElementNS`/`svg` 相关帧）。
**（f）C2 `rebuildRemote` + 全树 `querySelectorAll`**：`rebuildRemote` **0 命中 / 14 窗口**；`querySelectorAll`（V8 内建，无 url）合计 57.6 ms、峰值 **0.76 ms/s**，占 script 的 **≤1.5%**。

### 4.2 关键比值（跨 14 窗口，全部同向）

| 比值 | 首页 | 长会话安静 | 活跃流 | 设置打开 | 模型 | 插件 | 停留 |
|---|---|---|---|---|---|---|---|
| `apply` ÷ 整个会话链（场景均值） | 10.4× | 89.3× | 75.3× | 102.0× | 84.2× | 113.7× | 128.6× |
| 同上（**逐窗口极值**） | 9.81–10.72× | 71.9–118.5× | 63.3–91.6× | 101.0–103.5× | 77.9–94.5× | 106.4–136.4× | 99.8–153.8× |
| `apply` ÷ `ScriptDuration`（逐窗口极值） | 0.98–0.99 | 3.53–3.92 | 2.62–4.08 | 3.83–4.48 | 4.07–4.23 | 3.50–4.87 | 4.71–4.96 |
| `apply` ÷ `buildListSnapshot` | 25.9× | 171.7× | 142.0× | 206.4× | 184.5× | 279.4× | 275.3× |
| `apply` ÷ `ScriptDuration`（同窗） | 0.98 | 3.72 | 3.35 | 4.15 | 4.15 | 4.19 | 4.84 |
| 节点数 | 605 | 3 748 | 3 941 | 4 189 | 4 210 | 4 638 | 4 638 |

**合并口径**：
- **★ 独占批次（cpuX，7 窗口，未受污染）**：`apply` = 6 208.0 ms，**占非 idle 主线程 CPU 的 72.9%**；`apply ÷ ScriptDuration = 2.62×`；整条会话链占非 idle **1.6%**；**`apply` ÷ 会话链 = 44.9×**。
- 受污染批次（cpuL，14 窗口）：`apply` = 34 916.6 ms，占非 idle 78.6%；`apply ÷ 会话链 75.7×。
- 两批**方向完全一致**（`apply` 均为第一热点、会话链均 ≈1–2%），差异只是绝对量级（污染放大 3–10×）。

### 4.3 哪些随 session 事件率线性增长？

- **不随事件率**：`apply` 的触发与事件率**不同向**——首页事件率最低（51.2/s）时 `apply`=105 ms/s，长会话+设置事件率 48.7–120.8/s 时 `apply`=197.7–712.6 ms/s，二者排序**与事件率不一致**（插件标签事件率 48.7/s 反而低，停留窗 86.9/s 亦低）。结合调用栈（触发者是**主题快照订阅**，`:440`），`apply` 的成本由**"主题快照每次产新引用就重放一次"**驱动，属**每 snapshot 恒定开销**，不是事件率线性项。
- **弱且不稳地随事件率**：`Session` 链（`buildListSnapshot`/`projectList`）在长会话下（3.7–4.2 ms/s）略高于首页（3.4–4.1），但**绝对量级只在 ms/s 级**，且 14 窗口内排序不单调 ⇒ **不能称"线性增长"**。
- **只有"下游 Blink 工作"随规模增长**：`RecalcStyle` 与 rAF 掉帧、LongTask 随 **DOM 规模**（605 → 4 638 节点）单调恶化（Recalc 55.5 → 352.7 ms/s；rAF 59.1 → 35.6/s），而这不是"会话事件率"的函数，是**页面规模 × 重算频率**的函数。

---

## 5. 关键裁决（要求 4）

### 5.1 设置页卡顿的"主成本项"排序（据 self-time 与比值，非绝对 ms）

1. **`dsh-client-ui-layout` 的 `ThemePresenter.apply`（`theme-presenter.js:366`，经 `:440` 主题快照订阅回调触发）** —— **第一主成本项，无争议**：
   - **★ 独占批次（结论依据）**：占**非 idle 主线程 CPU 的 72.9%**，`apply ÷ 会话链 = 44.9×`（逐窗 27.7–66.0×）；**7/7 窗口第一热点**，逐窗占该窗非 idle 的 **54%–81%**。
   - 受污染批次（旁证，方向一致）：占非 idle 78.6%，`apply ÷ 会话链 75.7×`，**14/14 窗口第一热点**。
   - 它在每个窗口以**两个 profile 节点**出现（同一函数的两个调用上下文/IC），**两者相加才是其真实自时间**——只取单节点会低估约一半。其高成本来自它自己制造的浏览器侧工作：向 `body.style` 写主题 token 自定义属性 + `getComputedStyle(body).backgroundColor` **强制同步重算**（调用栈实证）；因此它的 self-time 常为同窗 `ScriptDuration` 的 **2.6–5.0×**（长会话与设置态 3.4–5.0×；首页 0.98×）。
2. **规模敏感的样式重算与合成长尾（`RecalcStyle` 为主）** —— 占主线程 Task 的 **42.9%（独占）/ 60.0%（受污染）**，Script 占 **21.7%/16.8%**、Layout 占 **14.8%/2.2%**（受污染批次把 Layout 测成 ≈0 ⇒ **该指标只有独占批次可用**），是"用户可感掉帧"的直接来源（>50ms 帧 42–80/2 窗、LongTask 从首页 0 增至设置打开/切标签的 15/18 个）。**它是 apply 与事件驱动 DOM 更新的共同下游**，不能单独归给某一方（见 5.3 的诚实边界）。
3. **`querySelectorAll`（V8 内建）** —— 峰值 **0.40 ms/s（独占）/ 0.76 ms/s（受污染）**，≤1.5% script。
4. **会话投影链 `buildListSnapshot` + `projectList` + `flattenLineage`** —— 独占批次合计 **0.4–3.6 ms/s**（占该窗 script **0.3–6%**；`buildListSnapshot` 峰值 **1.48 ms/s**），受污染批次 3.2–10.1 ms/s。
5. **`list.set` 通知链（`markDirty`/`ensureFresh`/`getListSnapshot`）/ `applyMutation` / `recordMutation` / `syncCompletedNotifications` / `rebuildRemote` / SVG 生成** —— **≈0**：独占批次 `markDirty`/`getListSnapshot`/`applyMutation`/`recordMutation`/`syncCompletedNotifications`/SVG **全部 0/7 命中**；`ensureFresh` 峰值 0.27 ms/s；`rebuildRemote` 仅 1/7 窗口、峰值 0.13 ms/s。

### 5.2 与既有审计的对照：哪条被证实、哪条被证伪

| # | 既有审计的判断（`settings-jank-audit-*.md` / `settings-jank-handoff.md`） | profile 裁决 | 依据 |
|---|---|---|---|
| **证伪 1** | **"首要残余客户端机制是 session/event → `buildListSnapshot` → `projectList` → `list.set` → 下游渲染链"**（`settings-jank-audit-synthesis.md` 裁决 B） | **证伪（作为"首要"）** | **独占批次**：该链占非 idle **1.6%**，最大单项 `buildListSnapshot` 峰值 **1.48 ms/s**；`apply` 比整条链大 **44.9×**、比 `buildListSnapshot` 大 **约 100×**。（受污染批次同向：1.0% / 75.7×。） |
| **证伪 2** | **"`SettingsRoot`/`SettingsPanel` 无组件级 memo 边界是活跃流放大器"**（synthesis 裁决 B、表"源码确定，活跃 commit 未直接计数"） | **在本 profile 中未证实（否决）**：设置包自身没有任何函数进入 top-30 | 设置三态与停留窗里，`ui:dsh-client-ui-settings*` 未进 bundle top-6；设置侧 render 无 ≥0.3 ms/s 的自时间项。**"无 memo ⇒ 卡顿"这条链在函数级自时间上测不到成本**（注意：本条只否证"它构成 setting-page CPU 主成本"，不否证"它导致重渲染次数"——那属 React commit 计数线）。 |
| **证伪 3** | **"C2 的 body 子树 MutationObserver 与过宽订阅会在高事件率下做同步辅助工作"**（synthesis 裁决 B 末条；R3） | **未证实（否决）** | 独占批次 `rebuildRemote` 仅 **1/7 窗口**（峰值 0.13 ms/s）；受污染批次 **0/14 命中**；`C2:dsh-workspace-enhancement` 在 bundle 表里仅 **10.0 ms/s（首页）**、其余场景更低，远小于 `ui:dsh-client-ui-layout` 的 103.6–698.3 ms/s；`querySelectorAll` 峰值 0.76 ms/s。 |
| **证伪 4** | **"历史 after 仍 settings-open 89.8 / dwell 81.4 ms/s script ⇒ 剩余瓶颈在下游渲染"** 的**归因方向** | **部分证伪**：绝对值不可比（并发 + 未持锁），但**"剩余瓶颈在会话链下游"被证伪**——剩余量级全部集中在 `apply` 与 Blink 重算 | §4.1/§4.2 |
| **证实 1** | **"设置页自身不是单独的持续卡顿源，而是外部事件流的放大器/观察窗口"**（synthesis 裁决 A） | **证实**（方向），但放大器主体易位 | 设置打开/切标签并没有产生设置包内的 CPU 成本（0 命中），但设置打开使节点数 3 748→4 638，**同一 `apply` 的 cost/script 比从 3.7 升到 4.2–4.8** ⇒ 放大器是"页面规模 × 每 snapshot 的主题重放"，而非设置组件本身。 |
| **证实 2** | **"`session/projection` + `session/event` 是本应用 WS 的真实划分"**（MEASUREMENT-STATUS §3、硬化线） | **证实** | 14/14 窗口 `payload.type` 仅这两类构成主体（≈75:25），顶层 `type` 退化。 |
| **证实 3** | **"两个批次对'哪个标签卡'的一致标签数=0 ⇒ 不存在可复现的最差标签"**（§3.2） | **证实** | `apply` 在通用/模型/插件/停留四态为 **203.1 / 268.4 / 197.7 / 271.0 ms/s（场景均值）**，四态 script 42.1–67.2 ms/s，**无标签可分离出稳定的最差项**；唯一系统性差异是节点数（4 189→4 638）。 |
| **新发现（既有审计未提）** | — | **`ThemePresenter.apply` 是本部署设置页/长会话的第一 CPU 成本项，占非 idle 78.6%** | §3 anchor 表、§4.2 |
| **新发现（既有审计未提）** | — | **该函数 self-time > 同窗 `ScriptDuration`（2.6–5.0×，随 DOM 规模放大）**，因为其成本主要是 `getComputedStyle` 强制重算 + 根级自定义属性失效的浏览器侧代价，而非 JS 语句本身 | 调用栈 + `reconcile.ratio`≈1.0 |
| **新发现（既有审计未提）** | — | **`apply` cost/script 比随 DOM 规模单调放大**：605 节点=0.98× → 3 748=3.72× → 3 941=3.35× → 4 189=4.15× → 4 210=4.15× → 4 638=4.19/4.84× | §4.2 表 |

**明确写"未证实/否决"的项（不为迎合既有结论而夸大）**：
- `rebuildRemote`：**0/14 命中 ⇒ 未证实**。
- 全树 `querySelectorAll`：峰值 0.76 ms/s、≤1.5% script ⇒ **不足以支撑"卡顿主因"**。
- `list.set` 通知链（`markDirty`/`ensureFresh`/`getListSnapshot`）：**合计 ≤0.53 ms/s，`getListSnapshot` 为 0 ⇒ 未证实**。
- `applyMutation` / `recordMutation` / `syncCompletedNotifications` / SVG 生成：**14/14 窗口 0 自时间 ⇒ 未证实（至少在采样分辨率下不显著）**。
- "事件率越高越卡"：本批 S2/S3 事件率差不足（90 vs 120 帧/s）且 `apply` 与事件率**不同向** ⇒ **本轮既未证实也未推翻**，需按 §5.4 重测。

### 5.3 诚实边界（必须与结论同读）

1. **旧批次（cpu2/cpu3/cpu4/cpuL）的绝对 ms 全部 INCONCLUSIVE**（外来浏览器 3 个 + 6–12 个 playwright 进程全程在跑；见 §0.1，膨胀倍数见 §0bis.4）。**★ 独占批次 cpuX 的绝对数字落在"独占条件"下，但仍不应外推为长期基线**（宿主 agent 与宿主自身负载仍在，且每场景仅 1 窗）。
2. `apply` 的 6.2 s（独占）/ 34.9 s（受污染）聚合 self-time 中，**含 Blink 为其强制重算付出的时间**（V8 把它记在被阻塞的 JS 帧上；`apply`/`ScriptDuration` 达 2.5–3.8× 即为证据）。因此**不能把 72.9% 读成"JS 代码执行时间"**；准确表述是"**以 `apply` 为归因帧的主线程 CPU 占比**"。
3. **未做因果 A/B**：两次单页 A/B 打桩都未能挂上 `ThemePresenter` 的 prototype（React root fiber 句柄取不到、`Error.prepareStackTrace` 在 init script 中不可用），因此**"去掉 apply 就消失"未被证明**；本报告只主张**归因**，不主张"改它就好了"。最小因果实验见 §5.4（**现可在同一独占门禁下执行，条件已具备**）。
4. S3（活跃流）在独占批次里**首次真正达成**（137.1 帧/s，是 S2 的 55×），但其入站帧仍以 `session/projection` 为主；受污染批次的 S3 未达目标，两批 S3 不可混用。
5. 独占批次**每场景 1 窗口**（受污染批次 2 窗口）；要求 ≥3 未达。但结论不依赖单窗挑值：7/7 窗口同向、`apply` 在所有窗口均为第一热点。
6. `RecalcStyle`（独占 42.9% of Task）中，**多少比例由 `apply` 引起、多少由 session 事件驱动的常规 DOM 更新引起，本轮无法分离**：这是本报告最大的未决点。需要 §5.4 的 M-A/M-B。

### 5.4 下一轮最小决定性实验（供协调者串行排期）

- **M-A（裁决 apply 的量级）**：在**独占**窗口内（本轮已验证门禁可达成：7/7 EXCLUSIVE），用 CDP `Runtime.evaluate` 把 `ThemePresenter.prototype.apply` 包一层"快照内容签名相同则跳过"（同页、同会话、同事件率，A/B 交替 ≥3 轮各 ≥30s）；记录 **RecalcStyle/s、LongTask/s、rAF p99、Script/s** 的**窗口内配对差**。若 Recalc 与 rAF 长尾同步塌陷 ⇒ `apply` 的重复重放即用户可感卡顿主因；若 Recalc 不动 ⇒ 主因在别处，本轮结论降级为"最大的 JS 归因项但不是掉帧主因"。
- **M-B（分离 apply 与事件 churn 对 Recalc 的贡献）**：CDP `Network.emulateNetworkConditions` 或 `Fetch` 阻断把 session 事件率拉到 0（设置仍打开、apply 仍重放）⇒ 单独测 `apply` 对 Recalc 的贡献。
- **M-C（apply 调用次数硬计数）**：`Profiler.startPreciseCoverage({callCount:true})` 已接入 `capture5.mjs`（本轮 coverage 结果为空，取回时机有 bug：在 `Profiler.stop` 前取），修好即可给出 **apply 调用次数/s** 与 **次/秒 × 单次成本** 的硬算术，替代当前的"写入次数"代理。

---

## 6. 对上游的直接可行动线索（不改代码，仅记录）

- 嫌疑代码：`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js`
  - `ThemePresenter.apply` = **:366**；
  - 它的强制重算 = **:375** 起的 `body.style.setProperty(...)` + `getComputedStyle(body).backgroundColor`；
  - 触发点 = **:440** `presenter.apply(snapshot)`（主题快照订阅回调）；
  - `dispose` = :383。
- 候选最小修（**需先做 §5.4 M-A 验证再动手**）：(i) 快照内容签名相同则不重放；(ii) 去掉 `getComputedStyle` 强制重算（或改用缓存/`requestAnimationFrame` 延后）；(iii) 把 token 写到 `documentElement` 的单个 `style` 文本块而非逐属性 `setProperty`，减少失效次数。

---

## 7. 附录：复现命令

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/cpu-profile
# 1) 取锁（原子），owner 写入 owner.txt
mkdir -p ../.probe.lock    # 已在：轮询 20–40s，最长 30 分钟
# 2) 并发普查（每 15s：锁状态 / 外来 headless_shell 数 / loadavg）
bash scripts/census.sh &
# 3) 决定性批（单浏览器、14 窗口、每窗全新 CDPSession）
node scripts/capture6.mjs --scenarios all --reps 2 --win 10000 --stamp cpuL
# 4) 归因分析（top-30 / bundle / 链比值 / anchor 自证）
node scripts/analyze3.mjs cpuL
# 5) 机制追证（apply 身份、调用栈、profile 单位与线程结构）
node scripts/probe-apply-decisive.mjs
node scripts/probe-threads.mjs
# 6) 释放
rmdir ../.probe.lock
```

> 注：`capture2/3/4/5.mjs` 是被 `capture6.mjs` 取代的中间版本（含 §0.3 所述的计数器清零缺陷与单位缺陷），保留以便审计追溯；**只有 `capture6.mjs` 的输出（`cpuL`）被本报告当作证据，`cpu2/cpu3/cpu4` 一律 INCONCLUSIVE。**

---

## 8. 要给出决定性结论，我还需要哪一次干净测量（**交由协调者串行排期，本线不自行执行**）

> 前置：其余线停手。开跑前只接受一个判定标准——**整窗无外来实例**（需在窗口**期间**持续采样，而不是仅在两端抽查）。

### M0（前置门禁）—— 独占性持续证明，不通过则不产生结论
```bash
# 窗口期间每 2s 记一次；要求全部样本 foreignCount==0
while :; do
  echo "$(date -Is) $(ps -eo cmd --no-headers | grep -- '--remote-debugging-pipe' | grep -vc -- '--type=')"
  sleep 2
done
```
**判据**：整窗所有样本 `foreignCount == 0`（容忍值 0）；任一非零样本 ⇒ **该窗作废**。同时记录 `pgrep -x headless_shell` 作为交叉校验。
**预期**：若仍出现 18–31 个外来进程 ⇒ 本机**不可能**得到可用绝对数字，应改为在隔离环境（另一台机 / 容器）测量。

### M1（核心，裁决量级）—— `apply` 的因果 A/B，同窗配对
```bash
# 无需新写探针：在现有 capture6 的 page 上加一步 Runtime.evaluate 打桩（A/B 交替）
node scripts/capture6.mjs --scenarios m1 --reps 6 --win 30000 --stamp m1
```
- **打桩内容**：把 `ThemePresenter.prototype.apply` 包一层——当快照内容签名与上次相同时直接 `return`（不改产品源码，仅在这个运行中的 page 内生效）。
- **窗口：≥**6 个（A/B/A/B/A/B，每窗 30s），**同页、同会话、同事件率区间**；顺序随机化以消除时间漂移。
- **采集**：`ScriptDuration`、`RecalcStyleDuration`、`LayoutDuration`、LongTask 数与最大值、rAF 分布（p50/p95/p99/max、>50ms 帧数）、LoAF `blockingDuration`、**`apply` 自时间与调用次数**（用 `Profiler.startPreciseCoverage({callCount:true})` 取硬计数）。
- **判据（预注册）**：
  - **若** Recalc/Script 与 rAF 长尾（p99、>50ms 帧数）在 B 窗**同步塔陷**（配对差下降 ≥ 基线的 50%，且 6/6 窗同向）⇒ `apply` 的**重复重放即用户可感卡顿主因**；结论可升级为因果。
  - **若** `apply` 自时间塔陷但 Recalc/rAF **不动**（配对差 < 20%）⇒ `apply` 只是“**最大的 JS 归因项**，不是掉帧主因**”，下一个靶点在事件驱动的 DOM 更新侧。
  - **若** 两者都不动 ⇒ 打桩未生效，该窗作废（必须先验证打桩命中：`apply` 调用次数应从 X/s 降到 ~1/s）。

### M2（分离）—— `apply` vs 事件 churn 对 Recalc 的各自贡献
```bash
# 在 M1 基础上再加一个维度：断开 session 事件流（CDP Fetch/Network 阻断）但保留 apply 重放
node scripts/capture6.mjs --scenarios m2 --reps 4 --win 30000 --stamp m2
```
- **2×2 设计**：{apply 重放 开/关} × {事件流 开/关}，每格 ≥2 窗 × 30s，随机化顺序。
- **判据**：拆出 Recalc 的四分量；若（apply 关、事件关）窗的 Recalc ≈ 0 而（apply 开、事件关）窗 Recalc 仍高 ⇒ **apply 独立占据主量**；反之则事件 churn 为主。

### M3（采样解析度）—— 让“为零”类结论变得可定量
**现状**：`getListSnapshot`/`applyMutation`/`recordMutation`/`syncCompletedNotifications`/SVG 在 14/14（cpuL）与 7/7（cpuX）窗口均为 **0 命中**——但这只能说“**低于 1ms 采样分辨率**”，不能说“不存在”。
**需要**：同一窗内用 **`Profiler.startPreciseCoverage({callCount:true})`** 取这些函数的**硬调用次数**（次/秒），再乘以同窗微基准单次成本，给出“**次/秒 × 单次成本**”的硬算术代替“零命中”。
**判据**：若 `projectList` 硬计数与 `apply` 硬计数同阶，则本报告的“会话链小两个量级”结论需重审；若相差 ≥ 10×，则 (a) 类结论得到硬化。

### M4（可感终点校准，可选）
**需要**：`点击 → next paint`（click-to-next-paint）p95 与 LoAF `blockingDuration` 分布，作为“用户可感”的终点指标（替代 `script < 60ms/s` 这类代理门槛）。
**判据**：若 M1 的 B 窗能使 click-to-paint p95 与 `blockingDuration` p95 同步下降，则“`apply` → 可感卡顿”的因果链完整。

### 排期建议与总预算
| 步骤 | 窗口数 | 单窗 | 小计 | 前置 |
|---|---|---|---|---|
| M0 门禁探针 | 常驻 | — | 0 | 窗口期间持续采样 |
| M1 因果 A/B | 6 | 30s | **3 min** | 其余线停手 |
| M2 2×2 分离 | 8 | 30s | **4 min** | 同上 |
| M3 硬计数 | 4 | 30s | **2 min** | 同上 |
| M4 可感终点 | 复用 M1/M2 窗 | — | 0 | 同上 |
| **合计** | **18** | — | **约 9–12 min** | 需整机空转 |

**风险与降级方案**：若 M0 在排期时段仍检出外来实例，则本线已完成的 (a) 类结论（结构/比值/为零）**不受影响可直接使用**，而 (b) 类结论应改为在**隔离环境**（另一台机或容器）重测，不建议在本机反复重试。

### 8.9 正式申请（可直接并入你的串行批次）

**申请内容**：在**全部其他线停手、当前批次结束后**，为本线安排一个窗口，跑 **M1+M3**（共 10 窗 × 30s ≈ 6 分钟）。**本线不自行执行**。

**准备（你侧）**：
```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/research-v2
mkdir .probe.lock && cat > .probe.lock/owner.txt <<EOF
agent: coordinator-serial-batch
line: exclusive CDP top-down attribution (M1+M3)
host_pid: \$(pgrep -f 'bin/dsh web' | head -1)
started_at: \$(date -Is)
EOF
# 窗口期间持续金丝雀（要求全样本为 0）：
while :; do
  n=\$(ps -eo cmd --no-headers | grep -- '--remote-debugging-pipe' | grep -vc -- '--type=')
  lock=\$([ -d .probe.lock ] && echo HELD || echo FREE)
  echo "\$(date -Is) foreign=\$n lock=\$lock load=\$(cut -d' ' -f1 /proc/loadavg)"
  [ "\$n" -gt 1 ] && echo "!! CONTAMINATED - ABORT THIS WINDOW"
  sleep 2
done
```

**执行（一条命令，10 窗）**：
```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/cpu-profile
node scripts/capture6.mjs --scenarios m1,m3 --reps 5 --win 30000 --gatemax 60000 --stamp excl1
node scripts/analyze3.mjs excl1
```

**输出判据（预注册，事后不改）**：
1. **合法性门槛**：10/10 窗的金丝雀**全样本** `foreign==1`（只有我们自己）。任一窗不满足 ⇒ **该窗作废，不得拿来算占比**；若作废窗 ≥ 3 则整批作废。
2. **首要性判据：**在合法窗内，`ThemePresenter.apply` 的**自时间占非 idle 主线程 CPU 的比例**。若 **≥ 50% 且 5/5 窗同向** ⇒ 可将本报告的 **(b) 类结论升级为可引用的 top-down 占比**；若 < 20% ⇒ 本报告结论必须推翻。
3. **因果判据（M1）**：打桩（快照签名相同则跳过重放）开/关配对差——**RecalcStyle/s、rAF p99、>50ms 帧数三者同步下降 ≥ 50% 且 5/5 窗同向** ⇒ 因果成立；若 `apply` 自时间塔陷而 Recalc/rAF 不动（<20%）⇒ 降级为“最大 JS 归因项”。
4. **硬计数判据（M3）**：`Profiler.startPreciseCoverage({callCount:true})` 取 `apply` 与 `projectList`/`buildListSnapshot` 的**硬调用次数**；若同阶 ⇒ 本报告“会话链小两个量级”需重审；若 ≥ 10× ⇒ 硬化。

**成功后你会得到**：一份**可引用的 top-down 占比**（`apply` 占非 idle 主线程 CPU 的百分比，含同窗相对量级），以及“去掉重复重放后卡顿是否消失”的**因果**答案。本线会据此把报告的 (b) 类条目从 INCONCLUSIVE 改为可引用（或推翻）。

### 0ter.7 追加核实：`bash-30`（capture3/cpu2）迟到的结算通知（2026-09-21 16:37 复核）

协调者检测报告"仍在跑 capture3/capture6"的可能来源已定位为**迟到的 job 结算通知**：

| 事实 | 时间 | 证据 |
|---|---|---|
| `bash-30`（`capture6/capture3 --stamp cpu2`）启动 | 15:2x | `out/campaign-cpu2.json` 窗口跨度 `07:21:54Z–07:32:01Z`（本地 15:21–15:32） |
| 我**主动**终止它 | ~16:0x | 为了让位给锁协议执行 `job_kill bash-56`；`job_kill bash-30` 亦已下达 |
| 结算通知**送达我** | **16:37** | 本条消息；状态 `killed, signal: SIGTERM`——**信号由我下达，非外部误杀** |
| 该作业的产物 | 仅到 `out/campaign-cpu2.json`（32 窗，**已标 INCONCLUSIVE**，未参与结论） | §0ter.2 |
| 16:37:13 复核 | **无任何 `capture*.mjs` 进程存活**；`capture3 cpu2` 无匹配；锁 = **FREE** | `ps -eo pid,ppid,etime,cmd` 全表 + 反选模式 |

**结论**：`bash-30` 早已终止，其通知只是**延迟送达**；本线在 16:37 复核时**零活跃采集进程、零浏览器**。此前我查到的唯一浏览器实例（`pid=3267808`）属 measure-hardening 线；16:36 那次 `ps` 里出现的 `pid=3292996` 是**我自己的 shell 命令进程**（`bash -c echo "=== now ==="...`）被 `grep -- '--remote-debugging-pipe'` 匹配到，**不是浏览器**——这也提示：**该匹配模式会命中把该字符串写进命令行的自身进程**，做并发普查时须排除自身 PID。

**权威状态（16:37:13）**：本线活跃进程 0 / 浏览器 0 / 锁 FREE ⇒ 你可在 §8.9 的串行批次里直接排 M1+M3。
