# GC 观测 + `(program)`/内建占比 + 五桶归因闭环（incident2 / gc-residual）

- 日期：2026-09-22（测量窗口见 §5；宿主 PID 10806，启动于 10:06:16 CST，未重启/未 pkill/未改产品）
- 目标：把"主题 `apply` 已归零后仍有 65–100 ms/s 主线程成本无归因"这块空白，用 **GC 观测 + `(program)`/内建占比 + 五桶同窗相对占比** 做结构闭环，并给出可操作的下一步定位实验
- 交付：本文件 + `out/summary-*.{json,txt}` + `out/prior-buckets.json` + `out/prior-structure.json` + `out/crosscheck-peer-raw.json` + `raw/`（campaign / 每窗口 profile / revision 证据）+ `verify/method-audit.md`（独立器械审计）
- 结论分级：**结构/占比类结论可用；绝对 ms / ms/s 一律标注并发条件**（`/proc/<pid>` 精确普查，禁用会自匹配的 `pgrep -f`）

---

## 0. 读数纪律与并发条件

| 项 | 实况 |
|---|---|
| 锁路径 | `.workspace/lag-fix/research-v2/.probe.lock`（跨线共用；原子 `mkdir` 取锁） |
| 取锁实现 | 本线 `tools/probe-lock.sh`：`mkdir` 成功即持锁；已存在则 **20–40 s 退避轮询**；**仅在 owner 年龄 > 25 min 且 owner pid 已不存在时**才允许抢占（并记账到 `raw/preempted-owner-*.txt`） |
| 释放顺序 | `rm -f owner.txt` → `rmdir`（`rmdir` 对非空目录静默失败：若失败则**回写** `owner.txt`，绝不留下"无主可抢占"的锁目录） |
| owner pid | 写 **`run-locked.sh` 长驻 shell 的 PID**（`owner_pid=`），而非取锁脚本自身的短命 PID —— 否则他线"仅按 pid 缺失"抢占的实现会偷走活锁（见 §4 缺陷 E4） |
| 浏览器预算 | **2 次启动**（smoke 校验档 + full 正式档）/ **4 次页面加载**，**全部在同一次持锁内**完成；这是对初始"1 启动/3 加载"估计的**已声明偏离**（`owner.txt` 已改写记录） |
| 并发普查口径 | 浏览器"实例" = 命令行含 `--remote-debugging-pipe` 且不含 `--type=` 的**主浏览器进程**（避免把 1 个实例的子进程数成 5–8 个）；用 `/proc/<ppid>/stat` 回溯 ≤6 级祖先链区分 mine/foreign；**禁用 `pgrep -f`**（会自匹配调用者自身命令行） |
| 宿主 PID 识别 | 扫描 `/proc/*/cmdline` 精确匹配 `bin/dsh web`（同样不用 `pgrep -f`） |
| 开窗前硬闸门 | `capture-gc.mjs` 在任何浏览器启动前等待最长 120 s，要求 `lockHeldByLine && foreignCount===0`；**锁不属于本线则直接拒绝启动**（exit 6）；超时但锁仍属本线时降级为 CONTENDED 并把每个窗口标 `exclusiveThroughout=false` |
| 逐窗口普查 | 每个窗口开窗前、收窗后各记一次 census（`censusW0`/`censusW1`），`exclusiveThroughout` 写入该窗口记录 |
| 只读纪律 | 全程只读；**只点"设置"入口**，点击前对候选元素标签做 `/保存|应用|删除|重置|清空|移除/` 守卫（命中即跳过并记账）；未点保存/应用/删除，未刷新、未改配置、未动产品源码 |

> 并发现实（必须随数字一起读）：本机同时有多条 incident2 线在跑浏览器。我的锁等待日志（`logs/gcrun-*.lock.log`）逐条记录了 owner 更替；**持锁 ≠ 独占**在本机已被他线实测（持锁期间曾同时存在 18–31 个外来进程）。因此：
> **绝对 ms/ms/s 只能同批同窗内相对比较，且必须附并发条件；本报告的主体结论一律用"占比/结构/比值"。**

---

## 1. 器械与五桶定义（每桶的测量方法）

### 1.1 仪表

| 仪表 | 取数 | 用途 |
|---|---|---|
| `PerformanceObserver({entryTypes:['gc']})` | 页面时钟 `startTime`/`duration`/`detail{kind,count}`，**document 起始即注册**（addInitScript） | GC 次数与时长（主 isolate、主线程视角） |
| `Runtime.getHeapUsage` | 每 250 ms 轮询 `usedSize`/`totalSize` | 堆增长、毛分配速率、GC 掉档次数与幅度、线性斜率 |
| CDP `Profiler.start/stop` | 采样间隔请求 500 µs，**每窗口一条全新 page 级 CDPSession** | self-time top 表：`(program)` / `(garbage collector)` / `(idle)` / **有名字但 url 为空的内建** / 有 url 的 JS |
| CDP `Tracing`（browser 级 session） | categories = `devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing,v8,disabled-by-default-v8.gc` | Blink 重算/布局/绘制/合成 span 的**非重叠并集**、V8 GC span、主线程存活时间 |
| `Performance.getMetrics` | 窗口起止**紧邻**采样求差 | 权威 `TaskDuration`（主线程 busy 分母）、`ScriptDuration`、`RecalcStyleDuration`、`LayoutDuration`；计数项单独求差不乘 1000 |
| `HeapProfiler.startSampling` | 采样间隔 16 KiB，`includeObjectsCollectedByMajorGC/MinorGC` | **分配热点**（按调用帧/按 bundle 的字节数）——GC 桶的可操作线索 |

### 1.2 窗口

| 窗口 | 定义 | 说明 |
|---|---|---|
| `cold` | **导航发生在窗口内**（`goto` 由窗口的 preAction 执行），窗口 = 导航 + 8 s | 修正了"goto 完成后再开窗"的旧缺陷（旧法测的是 DCL 之后的稳态，不是首开） |
| `click` | `[click − 2 s, click + 2 s]`，锚点 = 点击前**页面内** `performance.mark` 的 `performance.now()`；右边界按 mark 硬对齐（不随点击自身耗时漂移） | `"点设置"` 路径 |
| `steady` | 设置面板打开并静置 8 s 后的 10 s 静默窗 | 稳态对照 |
| `L2.steady` | 同 steady，但**关闭 tracing** | 器械开销对照（S11） |

### 1.3 五桶（分母 = CDP `TaskDuration`，主线程 busy）

| 桶 | 定义 | 主要仪表 | 已知重叠 |
|---|---|---|---|
| **B1 已归因 JS** | `ScriptDuration` | CDP（Blink 自己的 JS 执行计时器） | 与 B2 可能非空交集：**由 JS 强制的同步重算/布局**会同时落在两把尺上（他线实测 `apply` 的 profile 自时间是 `ScriptDuration` 的 2.5–3.8×，正因 Blink 强制重算被记进该 JS 帧） |
| **B2 Blink 重算与布局** | `RecalcStyleDuration + LayoutDuration` | CDP | 同上；另 `LayoutDuration` 内部可能含惰性重算（C9，本报告标 INCONCLUSIVE） |
| **B3 GC** | `PerformanceObserver('gc')` 总时长（**主证据**）；交叉核对 = trace `MajorGC|MinorGC` **顶层 span 并集**、profile `(garbage collector)` 类 | 三个独立视角 | 若 GC 由 JS 内分配触发，B3 ⊆ B1 |
| **B4 合成与绘制** | trace 主线程 span **非重叠并集**，报 **区间**：`lo` = 严格绘制/提交名集（Paint/PaintSetup/Commit/CompositeLayers/Layerize/RasterTask/GPUTask/PaintImage…）；`hi` = 再加同层级的 Blink 生命周期兄弟 span（PrePaint/UpdateLayerTree/UpdateLayer/HitTest…） | CDP Tracing | 与 B1/B2 理论上互斥（不同生命周期阶段），但未实证 |
| **B5 program/未归类** | `TaskDuration − (B1+B2+B3+B4)`；同时给 `robust` 变体 `Task − max(B1,B2) − B3 − B4` | 由差值定义 | **是上界**：B1∩B2 等重叠会使 B5 被低估甚至为负；本报告对负值显式标 `UNDER` 而不裁剪 |

**关键方法学声明**：五桶**不是严格分割**（B1∩B2、B3⊆B1 均可能非空）。因此本报告同时给出：
1. 桶占比 + `sum`（解释率）与 `OVER/UNDER` 标记；
2. `robust` 残差（避开 B1/B2 重叠）；
3. **profile 类占比**（另一台独立仪表，分母 = profile 非 idle 自时间）作为交叉视角。

哪一桶最大，须**在两种口径下一致**才对外表述。

---

## 2. 先验基线（PRE-FIX，`apply` 归零之前）

来源：他线 `research-v2/cpu-profile` 的 186 个已归档 CPU profile 窗口 + 对应 analysis JSON，由本线用**自己的分类器与单位守卫**重算：`scripts/prior-buckets.mjs`、`scripts/prior-structure.mjs` → `out/prior-buckets.json`、`out/prior-structure.json`。

> 单位守卫（必要）：早期批次 `cpu2` 把 `Performance.getMetrics` 的**秒**当 ms 存（窗口 12 s 存成 `taskMs=2.113`）。本线用**不变量**判据修正：profile 非 idle 时间必然是 `TaskDuration` 的子集，故若 raw 自时间总量（ms）超过存值 5 倍以上，则按秒解释（×1000）。

| 批次 | n | Task ms/s | B1 JS% | B2 重算+布局% | B3 GC% | B5 program+其他 C++% | `apply` 占 Task% | profile 类占比 program/gc/native/js |
|---|---|---|---|---|---|---|---|---|
| **PRE-FIX 全部** | 186 | — | 18.8 | 53.4 | 1.6 | 26.1 | 22.4 | 23.5 / 1.5 / 0.6 / 74.4 |
| `cpuL`（受污染批） | 14 | 385.9 | 18.6 | 60.6 | 1.5 | 19.2 | 58.5 | 20.9 / 1.7 / 0.5 / 76.9 |
| `cpuX`（独占批） | 7 | 161.8 | 21.3 | 53.6 | 1.7 | 23.3 | 52.7 | 17.0 / 2.3 / 0.6 / 80.0 |

（`prior-structure.json` 的 186 窗口重算：`(program)` 23.5% / GC 1.5% / 有名字无 url 0.6% / JS 74.4%，`apply` 占非 idle 平均 52.6%。）

**先验基线的结构性结论（与他线报告一致，非本线新claim）**：
1. `apply` 归零前，**B2（重算+布局）是第一大桶，占主线程 busy 的 53–61%**；这正是他线报告的 `RecalcStyle÷Task 0.235–0.249`。
2. 即使在那时，**GC 也只占 busy 的 1.5–1.7%**、`(program)` 占非 idle 的 17–24% ⇒ 他线所称"65–100 ms/s 无归因残留"里，**GC 从来不是主体**。
3. 该残留的原始定义（`exec-theme/report.md` §9 / §6.3）：`apply` 占 busy 的 0.50–0.80 ⇒ 归零后仍有 **20–50% 非 idle 工作残留**；按 `cpuL` 的 home-idle（busy 130.0 / apply 65.4 ms/s）估 65 ms/s、按 long-idle（450.8 / 348.9）估 100 ms/s。**该 65–100 ms/s 出自受污染 `cpuL` 批**（他线自证膨胀 3.2–8.3× Task），故只能当"残留占比 20–50%"来用，不能当绝对基线。

---

## 3. 独立交叉核对（他线原始产物，本线自行重算）

`scripts/crosscheck-peer-raw.mjs` → `out/crosscheck-peer-raw.json`。**这些数字不是本线测量**，而是本线用同一套聚合代码重算他线在同机同版本（post-fix，宿主 10:06 重启后）抓到的原始 trace/profile，用作**仪表无关的结构性佐证**。

### 3.1 他线两条 settings trace（各约 10 s，两次独立采集）

| 指标 | trace #1 | trace #2 | 一致性 |
|---|---|---|---|
| 主线程 `RunTask` 并集（busy 代理） | 631.3 ms | 667.6 ms | — |
| 重算+布局（UpdateLayoutTree+Layout 并集） | 11.03% | 10.90% | ±0.13 pp |
| 绘制/提交 lo（Paint/Commit/Layerize/PaintImage） | 1.82% | 1.83% | ±0.01 pp |
| 绘制/提交 hi（+PrePaint/UpdateLayer/HitTest） | 2.55% | 2.54% | ±0.01 pp |
| GC（`MajorGC|MinorGC` 顶层并集） | 3.13% | 3.18% | ±0.05 pp |
| 主线程名次（占 RunTask 并集） | RunMicrotasks 41.7%、FunctionCall 32.4%、TimerFire 18.8%、Layout 7.1%、UpdateLayoutTree 3.9%、MinorGC 2.1% | RunMicrotasks 40.1%、FunctionCall 31.9%、TimerFire 15.8%、Layout 7.0%、UpdateLayoutTree 3.9%、MinorGC 2.2% | 高度一致 |

### 3.2 他线 post-fix 首开 CPU profile（"干净"档，未装入探针钩子）

| 文件 | span | 非 idle | program% | gc% | native% | js% |
|---|---|---|---|---|---|---|
| `cpuprofile-first-open.json` | 736 ms | 295.8 ms | 65.5 | 1.0 | 7.5 | 26.0 |
| `cpuprofile-second-open.json` | 631 ms | 200.9 ms | 54.3 | 5.5 | 6.0 | 34.2 |
| `cpuprofile2-clean-first-open.json` | 1060 ms | 347.2 ms | 59.0 | 1.5 | 4.7 | 34.8 |
| `cpuprofile2-clean-reopen.json` | 782 ms | 93.0 ms | 55.5 | 0.8 | 12.2 | 31.5 |

（他线 `probe4-*` 系列多数窗口 `program` 80–98% 且非 idle 仅 ~200 ms：那是**探针自身钩子**把主线程时间吃掉的窗口，本线不引用其类占比，仅记录该排除理由。）

**交叉核对给出的结构预期（待 §5 验证）**：
- 首开窗口里 **`(program)` 占非 idle 的 54–65%**（远高于 pre-fix 批次的 17–24%），**GC 仅 0.8–5.5%**；
- 设置态 trace 里 **绘制+合成 ≈ 1.8–2.5%**、**重算+布局 ≈ 11%**、**GC ≈ 3.1%**；
- 因而 post-fix 的最大桶不可能是 GC，也不可能是绘制/合成。

---

## 4. 器械审计（独立子代理，静态审计，未启浏览器）

产物：`verify/method-audit.md`（46 项逐条裁决：PASS 8 / PASS-with-caveat 2 / NEEDS-FIX 27 / FAIL 7 / INCONCLUSIVE 3）。本线在花费锁窗口**之前**按严重度修复了其中的阻断项：

| 编号 | 缺陷（审计原文要点） | 处置 |
|---|---|---|
| S1/E1 | `run-locked.sh` 把取锁放进管道，`$?` 变成 `tee` 的，**"拒绝启动浏览器"的守卫永远不会触发** | **已修**：取锁 rc 直接捕获 + 持锁复核（exit 3/4） |
| S2/E2 | `capture-gc.mjs` 只**记录** lock/foreign census，无任何断言 | **已修**：开窗前硬闸门（最长等 120 s；锁非本线即拒绝启动）+ 逐窗口 census 与 `exclusiveThroughout` |
| S3/E4 | 锁的 `pid=$$` 是短命脚本自身 PID，取锁后数毫秒即"死亡"，而他线有**仅按 pid 缺失抢占**的实现 | **已修**：改记长驻 `run-locked.sh` 的 PID（`owner_pid=`），并兼容 `key=value`/`key: value`/单行三种 owner.txt 格式 |
| S4/C3/C4 | `CATS` 缺 `disabled-by-default-devtools.timeline` —— 而 `RunTask` 正在该 category ⇒ 主线程识别失败 ⇒ **所有主线程 span 被丢弃、绘制桶恒为 0 并被当成"测得的零"** | **已修**：补 category；trace 解析失败时 B4 记为 `null` 并打 `B4-UNMEASURED`，不再折算成 0 |
| S5/B5 | `getMetrics` 的 `m1` 读在 trace 下载/`JSON.parse`/`Profiler.stop` **之后**，而分母 `wallS` 不含这段（单条 trace ~27 MB）⇒ 分子分母不是同一区间 | **已修**：`m1` 与页面侧 drain 都在窗口结束瞬间完成，之后才停 profiler/下载 trace；速率分母改用两次 metric 采样之间的真实间隔 |
| S8/B4 | `goto` 在开窗前完成 ⇒ 旧"首开窗"其实不含导航 | **已修**：导航移入 cold 窗口 |
| S9/B3 | 点击窗口右边界随点击自身耗时漂移（`click−2s..click+2s+latency`） | **已修**：页面内 `performance.mark` 锚点 + 按 mark 硬对齐右边界 |
| S7/C6 | `gcMainDurMs` 把 `V8.GC_*` 子相位一起**求和**，实测膨胀 4.3× | **已修**：主证据改为**顶层并集**，膨胀值单独字段并明确标注禁用 |
| S6/C7/C8 | B5 为负（重叠导致）没有标记；trace 失败的行把绘制悄悄折进 B5；均值把 `null` 当 0 | **已修**：`UNDER/OVER` + `robust` 残差 + `B4` 区间 + `B4-UNMEASURED` 标记 |
| S10/A3 | 计数型指标（RecalcStyleCount/LayoutCount）被乘了 1000 | **已修**：计数与时长分开求差 |

**审计指出、本线未完全消除的残留风险**（如实记录）：
- **R1 器械开销未定量**：tracing（本机实测 ~27 MB/10 s）、每 250 ms 一次的 `Runtime.getHeapUsage`（由渲染主线程的 DevTools agent 服务）、以及 500 µs（比默认 1 ms 更密）采样都会扰动被测主线程。已加 **L2.steady 关 tracing 对照窗**，但 heap 轮询与采样密度没有对照（唯一对照档位受锁窗口预算限制）。
- **R2 B1∩B2、B3⊆B1 无法排除**：Blink 强制重算/布局既计入 `ScriptDuration` 又计入 `RecalcStyleDuration` 的机制已有他线证据支持（`apply` 自时间 = 2.5–3.8× ScriptDuration）。故 B5 只能是**上界**，`robust` 变体是缓解而非消除。
- **R3 `(garbage collector)` 类占比是量化下限**：他线实测该节点存在但仅 44–72 个采样/单节点（0.7–1.3%），且只覆盖主 isolate；不可与 B3 当作同一量级比较。
- **R4 headless 与本机真实浏览器可能不同**：本线在 headless Chromium-131 下测量，合成/绘制路径可能与用户的有头浏览器不同（他线另有 headed-vs-headless 对照线在跑）。因此 B4 只能在"headless 同条件"下解释。
- **R5 场景差异**：本线场景是**全新页面 → 打开设置**（会话短、无长历史）；他线 65–100 ms/s 出自 home-idle / long-session / settings-dwell 场景。两者**不可逐值对比**，只可比结构。

---

## 5. 本次测量结果

（见下方 §5.x —— 由 `out/summary-*.txt` 生成，含原始 JSON）

## 6. 逐条 PASS / FAIL / INCONCLUSIVE

（见下方）

## 7. 局限与不得声称

1. **不得**把本报告任何绝对 ms/ms/s 当作基线：全程有他线并发浏览器，`exclusiveThroughout` 逐窗口记账，凡 `false` 的窗口只用于结构/占比。
2. **不得**声称"五桶是严格分割"：它们是**互补但有已知重叠**的分解；B5 是上界。
3. **不得**用 profile 的 `(garbage collector)` 类占比替代 B3（量化下限 + 仅主 isolate）。
4. **不得**把 B4（绘制/合成）当作与 B1/B2 完全互斥的独立成本。
5. **不得**把 headless 数字直接外推到用户的有头浏览器。
6. **不得**把本报告的场景（全新页面→设置）与他线长会话场景的 65–100 ms/s 逐值对比。
