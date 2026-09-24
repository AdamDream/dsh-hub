# w23-nav · 会话/工作区导航的完整交互成本审计（切换会话 / 搜索 / 折叠展开 / 切换工作区 / 「In one list」无虚拟化）

- 线：`program/w23-nav`（独占目录 `.workspace/lag-fix/program/w23-nav/`）
- 日期：2026-09-22（本地 CST +08:00）；本线**两次被中断**（系统级集体中断 + 18:11 冷面重启）后从磁盘接力，宿主已是**新 pid 2988915**（旧 301709 已退出）
- 审计对象：**deployed 运行态**（非源码仓）
  - 客户端包根：`/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`
  - GUI：`http://127.0.0.1:3080` 宿主 PID **2988915**（全程**未重启、未 pkill、未改任何产品文件**）
- 授权：只读审计 + 最多 2 个二级 subagent（实际成功 1 个静态档：`static/nav-anchors.md`）
- 遵守：`BATCH-PLAN §五`（20 条测量协议）、`lib/probe-lock.mjs`（新版，含 D3/D4 修正）
- 交付：本文件 + `raw/`（原始 JSON）+ `tools/`（可复跑探针）+ `static/nav-anchors.md`（file:line 锚点表）

---

## 0. 口径、仪器与并发（先声明，再报告）

### 0.1 证据基线：served 字节 == 磁盘字节（PASS，本线自证）

| 包 | served sha256-12 | disk sha256-12 | 磁盘 mtime |
|---|---|---|---|
| `dsh-client-ui-workspace` | `edb434298224` | `edb434298224` | 2026-09-22 18:08:53 |
| `dsh-client-runtime` | `4a2c298dd826` | `4a2c298dd826` | 2026-09-22 18:08:53 |
| `dsh-client-ui-sidebar` | `719693c401e7` | `719693c401e7` | 2026-09-12 14:56:17 |
| `dsh-client-ui-layout` | `13373bc6ebe4` | `13373bc6ebe4` | 2026-09-22 18:08:52 |

⇒ **本文所有 `file:line` 引用就是浏览器实际执行的字节**（热面口径）。workspace 包已含两条落地补丁：
`/*<<dsh-lag-fix B1/C1*/`（服务端过滤配套）与 `/*<<dsh-exec-a11y:U-A11Y2:v1*/`（tree 键盘可达，见 §4.4）。

### 0.2 仪器（本线自建，`tools/probe-nav.mjs` + `tools/w23-init.js`）

| 通道 | 实现 | 自证 |
|---|---|---|
| **主判据** | CDP `RunTask`，trace 类别 `devtools.timeline,blink.user_timing,disabled-by-default-devtools.timeline` | 阳性对照 **120.28 / 120.33 ms**（两轮），见 §0.3 |
| **线程口径** | `RunTask` 只取 **`thread_name === "CrRendererMain"`** 那一条 (pid,tid)：全线程 RunTask 会把 GPU/utility/browser 线程算进来（实测同一窗口：全线程 **7 383** 条 / sum 443.8 ms vs 渲染主线程 **1 884** 条 / sum 349.76 ms） | `runTask.thread` 逐窗落盘 |
| **次判据** | 页内 `PerformanceObserver('long-animation-frame')` | 阳性对照 loafMax **121 ms** |
| **页内判据** | **wall-clock rAF 间隔**（回调入口 `performance.now()`，**不用 `ts` 参数**），`document-start` 起跑（**窗口播种**） | rafN>0 逐轮自证；阳性对照 rafMax **121.1/121.5 ms** |
| **阳性对照** | **页内 `setTimeout` 忙循环 120 ms**（**禁止** CDP `Runtime.evaluate` 注入） | `pos-120` 窗：runTaskMax 120.28/120.33、loafMax 121、rafMax 121.5/121.1、`raf>50` 计数 1 |
| **阴性对照** | 同长度空载窗 `neg-none` | rep1 runTaskMax 87.14（含一次启动噪声）/ rep2 6.12 |
| **窗口内周期心跳** | 页内 500 ms `setInterval` 计数 + rAF 计数，逐窗取 `maxGapMs` | 所有窗 `hbMaxGap` 500.1–506.4 ms（正常）；**唯一例外**：`switch` rep1 = 939.8 ms，`idle-conv` = 766.2 ms（见 §0.4） |
| **浏览器 pid 存活** | 本探针浏览器以**唯一标记** `--dsh-probe-w23-nav=<rand>` 启动 ⇒ 从 `/proc/*/cmdline` 精确定位自己的主进程，**每窗前后各查一次存活** | 所有 19 个窗口 `ownAlive=true/true` |
| 并发普查 | cmdline 含 `--remote-debugging-pipe` 且不含 `--type=`，**排除自身树**（按 cmdline 标记，不用 `readlink(exe)`） | 所有 19 窗 `foreign=0/0` |
| 锁 | `lib/probe-lock.mjs`：浏览器启动**前**取锁、关闭**后**释放 | 每窗 `lockMine=true`；本次首轮取锁时**按规则回收了一个确证死亡的锁**（`w25-conversation` pid 3017383，`liveness=DEAD`，ageMs 163503） |

**仪器陷阱自曝（本线踩到并修好，后来者别再踩）**：
1. `page.evaluate(fn, a, b)` **只允许一个参数** ⇒ 多参会抛 `Too many arguments…`，被 `try/catch` 吞成 `SLICE_ERR`（本线由此白跑一轮）。
2. `Tracing.dataCollected` 是**异步**到达的 ⇒ **在 `Tracing.end` 之前**用 `markTs()` 查 step 的 `s-/e-` 标记恒为 `null`（本线第一轮 step 级 RunTask 全丢）。必须**等 `tracingComplete` 之后再映射**。
3. 锁的持有变量必须**真的赋值**（`lock = result.lock = await takeLock()`），否则 `lock.ok` 恒 undefined ⇒ 每窗误判 `NO_LOCK`。
4. 页内探针不得用 `#root.textContent.length` 作启动谓词（hero 态仅 143 字符），用 `button` 计数（沿用 w12 教训）。

### 0.3 并发条件（绝对 ms 必须连同本节读）

- 采集期**全程持锁**、`foreign=0/0`、本浏览器全程存活；**但宿主同时在服务一条正在流式输出的会话**（本审计自己的父会话），实测**入站 WS 帧速率 3–271 帧/s**（逐窗 `ws.inN` 落在报告各表里）。
- 机器负载：`/proc/loadavg` 采集期 **5.6–8.1**；`session.list` 冷发实测 **5.387 s**、热发 **0.314 / 0.221 s**（见 §2.4）。
- ⇒ **绝对 ms 一律标注"并发条件：持锁 + foreign=0 + 宿主在服务的活体流式会话 + loadavg 5.6–8.1"**；跨轮不可比的项本文一律改判为**比值/为零/计数**。
- **两轮复现（rep1 / rep2）同操作同窗对照**已落盘（附录 A）。**同窗噪声可达 2.3×**（例：`search/focus-type` 94.87 vs 218.36 ms；同一 step 的 `commits` 18 vs 50）——**凡是两轮差 >1.5× 的绝对数一律标 INCONCLUSIVE，只用其方向与计数**；标为**可复现**的项两轮差 ≤1.2×。

### 0.4 心跳异常两处（如实记录，不当作产品缺陷）

| 窗 | hbMaxGap | 解读 |
|---|---|---|
| `switch` rep1 | **939.8 ms** | 与同窗 `rafMax=324.9 ms` + `runTaskMax=317.45 ms` + `loafMax=319 ms` 同现 ⇒ 是**主线程被一个 ~320 ms 长任务顶住后、紧跟一段 >900 ms 的静默**（浏览器未死：`ownAlive=true`，且下一窗立即恢复 500 ms 节奏） |
| `idle-conv` rep2 | **766.2 ms** | 与 `rafMax=239 ms` / `runTaskMax=237 ms` / `loafMax=241 ms` 同现，同上 |

⇒ 结论：**浏览器进程在两轮 19 个窗口中从未被杀**（每次前后 `/proc` 存活核对 + 心跳连续性双通道确认）；心跳缺口是**主线程长任务的产物**，不是"窗口中途浏览器被第三方杀死"。

---

## 1. ⚠️ 前置校正：任务书给的起点数字**已过期**（必须先纠正再读结论）

任务书起点："侧栏 DOM 上限 **99 行**"、"**99 顶层 + 1110 子代理**"。**实测当前部署**：

| 项 | 实测值 | 来源 |
|---|---|---|
| `session.list` 条目 | **301 条 = 101 顶层 + 200 子代理** | 本线直接 HTTP 调 `/api/session.list`（`raw/session-list-{1,2,3}.json`，503 KB） |
| 子代理条目 | **200**（**不是 1110**）= 服务端 `SUBAGENT_LIST_MAX` 上限截断 | `dsh-host-apiproxy/lib/index.js:1231`（静态档 F12） |
| 顶层里 **已归档** | **77 / 101** | `~/.dsh/storages/workspace.json` → `global.archivedSessionIds`（77 项） |
| 顶层里 **blank** | **8** | payload `blank:true` 计数 |
| 归属工作区的 sessionIds | **62**（11 个工作区） | `workspace.json` → `tables.workspaces` |
| **⇒ 侧栏实际渲染行数** | **16**（= 101 − 77 归档 − 8 blank；16 条全部归属工作区，**0 条未分组**） | 上表逐项交集计算 + **实测 DOM `.YDXeBa_sessionRow` = 16**（两轮探针一致） |
| 未分组（stray）桶 | **0 条** ⇒ 11 个 `groupSection` 全是真工作区 | 实测 + 静态 `WS:161-162` |

⇒ **"99 行 / 1110 子代理"不再是当前活体**。本报告的所有实测都在 **N=16 可见行** 下取得，并把"若回到 99/1110 会怎样"**只作为结构推断（不含外推数字）**标注。子代理**数据仍在** payload 里（仅以 `runningSubagentCount` 徽标呈现：实测 3/101 行 >0，合计 37 个运行中子代理），**不渲染为行**（`sessionVisible` 第一判据，见 §4.1）。

---

## 2. ① 会话/工作区导航的完整交互成本（逐项 file:line + 实测）

### 2.0 导航面 = 谁在渲染（一处关键纠偏）

| 面 | 实现包 | 说明 |
|---|---|---|
| 侧栏容器/品牌/新建会话/折叠 | `dsh-client-ui-sidebar/lib/client.js`（321 行） | 只有 `sidebar.workspaces` **插槽洞**，无列表实现 |
| **会话列表 + 搜索 + 视图模式 + 分组行** | **`dsh-client-ui-workspace/lib/client.js`（2758 行）** | 本线主对象 |
| 会话/工作区行 | 同文件 `SessionNodeItem` `WS:693`、`ProjectRowItem` `WS:454` | 行是 `<div role="treeitem">`（`WS:720-724`/`WS:470-473`） |

### 2.1 切换会话（点击行 → 打开会话）

**静态链路（file:line，[VERIFIED-BY-READ]）**
1. 行 `onClick: () => onOpen(node.id)`：`WS:722-724`（分组树内 `WS:1406-1413`；flat 列表内 `WS:1540-1548`）
2. `open` 注入：`WS:2391-2393`（`ctx.sessions.open(sessionId)`）
3. `ctx.sessions.open(id)` → `SessionRuntime.open` → `manager.select(id)`：`RT:9068-9070` → `RT:7902-7914`
   ⇒ **`select()` 自身是纯客户端同步操作：不发 RPC、不刷新 `session.list`、不落盘**（静态档 G2）
4. 但**切换的宿主成本发生在"挂载新会话"上**，不在 `select()` 里 —— 见下面 🔴 实测

**🔴 实测（本线两处独立证据）：一次会话切换 = 一个 6–7 条 RPC 的宿主扇出，其中 `session.history` 单页 13.26 MB / 57 682 事件**

**证据 A（页内 `fetch` 探针，`tools/probe-pop.mjs`，`raw/w23-pop-*.json → switchTrace`）**：展开组后连续点两行（先点目标行、再点回原行），`fetch` 计数 **21 → 28 → 34**，即**每次点击新增 6–7 条 HTTP RPC**：

| 点击 #1 新增（t≈25 423–25 439 ms） | 点击 #2 新增（t≈26 928–26 945 ms） |
|---|---|
| `POST /api/subagent.list` | `POST /api/subagent.list` |
| **`POST /api/session.history`** | **`POST /api/session.history`** |
| `POST /api/commands/list` | `POST /api/commands/list` |
| `POST /api/dynamicCordisRunner/inventory` | `POST /api/dynamicCordisRunner/inventory` |
| `POST /api/skill.list` | `POST /api/skill.list` |
| `POST /api/agentPreset.list` | `POST /api/session.models` |
| `POST /api/session.models` | — |

⇒ **其中 5 条与会话内容无关**（`commands/list`、`skill.list`、`agentPreset.list`、`session.models`、`dynamicCordisRunner/inventory`）**却被每次切换重取**。

**证据 B（本线直接 HTTP 复放同批 RPC，只读，`raw/rpc-*.json`）**：

| RPC | 响应体 | 宿主耗时（2 次） |
|---|---|---|
| **`session.history`**（带一个真实 sessionId） | **13 265 086 B（13.26 MB）/ `events = 57 682` / `hasMore = **true**`**（⇒ 这还只是**第一页**） | **0.177 s / 0.815 s** |
| `agentPreset.list` | 1 189 B | 0.344 / 0.893 s |
| `skill.list` | 289 B | 0.333 / 0.040 s |
| `commands/list` | 181 B | 0.320 / 0.065 s |
| `session.models` | 293 B | 0.087 / 0.055 s |
| `subagent.list` | 298 B | 0.002 / 0.064 s |

⇒ 这解释了 §2.1 后面那条"点击后 ~0.32 s 长帧"：**点开一个大会话 = 下载 ≥13 MB / 5.8 万条事件 + 客户端解析/入 store/渲染**。宿主侧（0.18–0.82 s）不是瓶颈，**客户端侧才是**。

**渲染侧实测（两轮，renderer-main RunTask，同窗 A-B-A-B，窗内同时有宿主流式帧）**

| step | rep1 rtSum / rtMax | rep2 rtSum / rtMax | commits rep1/rep2 | rep1 窗 `ws.inN` | rep2 窗 `ws.inN` |
|---|---|---|---|---|---|
| `open-target`（跨工作区点行） | 109.95 / 27.85 ms | 49.86 / 21.41 ms | 9 / 5 | 1690 | 24 |
| `restore-original`（点回原会话） | 63.63 / 16.89 | 32.76 / 13.04 | 7 / 3 | ″ | ″ |
| `open-target-again` | 90.58 / 12.72 | 31.38 / 8.81 | 3 / 3 | ″ | ″ |
| `restore-final` | 58.23 / 15.13 | 48.39 / 8.45 | 3 / 3 | ″ | ″ |
| `dwell-after-restore`（**不点击**，仅静置 2.5–3 s） | **729.11 / 317.45** | 74.36 / 0.84 | 13 / 0 | ″ | ″ |

- **判定 PASS（机制）**：点击会话 → `sessionId` 变更 → 对话区渲染；点击→settle ≈ **0.70–0.73 s**（两轮几乎相同，含我固定的 400–500 ms `settleMs` 与 DOM 稳定判定，**不是产品延迟**）；产品侧即时渲染成本 = 3–9 commits / 32–110 ms 渲染主线程时间。
- **判定 FAIL（宿主扇出，新发现）**：每次切换会话（含"切回原会话"）都发 **6–7 条 HTTP RPC**，其中 **`session.history` 单页 13.26 MB / 57 682 事件且 `hasMore=true`**，另 5 条**与会话内容无关**仍被重取（§2.1 证据 A/B）。这是导航路径上**最大的单项成本**（数量级上远超侧栏渲染的 1.4% 份额）。
- **判定 FAIL（"后到代价"）**：rep1 的 `dwell`（**点击结束后 2.5–3 s 内的纯静置段**）出现 **rtMax 317.45 ms / rafMax 324.9 ms / loafMax 319 ms**，`raf>50` 三帧；同窗 `hbMaxGap` 939.8 ms。与 `session.history` 的 13 MB 载荷/解析吻合（异步到达 ⇒ 长帧晚于点击）。rep2 该窗未复现（该窗 `ws.inN=24`，即"恰好没有流式活动"）⇒ **单次观测，标 INCONCLUSIVE（n=1）**；但 317/324/319 **三通道同时命中**说明不是仪器伪影。

### 2.2 折叠 / 展开（组行 toggle、溢出按钮）

**静态（[VERIFIED-BY-READ]）**
- 组行 toggle：`WS:1381-1387`（`onToggle: group.expanded ? 收起 : 展开`）；`aria-expanded` 由 `WS:472` 输出
- **状态是本地视图 store**（`groupExpansion`，`WS:24-45` 的 `createWorkspaceViewStore()`，`persist:"dsh.workspace.view.v5"` → **localStorage**，非宿主）：静态档 E2/E3
- **会话行展开是另一个开关** `expandedSessionGroups`（`WS:1204`），溢出按钮 `WS:1452-1459`，阈值 `COLLAPSED_SESSION_LIMIT = 5`（`WS:1039`）
- **重要语义**：组**未展开时 `sessions: []`（`WS:208`）——一行都不渲染**；展开时全量 map。所以"折叠/展开"在行数上是 **0 ↔ 组内全部** 的跳变，**这才是本产品真正生效的行数杠杆**（`COLLAPSED_SESSION_LIMIT` 只作用于"已展开且 >5 条"时的溢出按钮路径，`WS:1404`）
- 当前会话所在组会被自动展开：`WS:1210-1216`（若 `groupExpansion` 无该键则 set true）

**实测（同一窗内 A-B-A-B，N=16 行）**

| step | rep1 rtSum/rtMax | rep2 rtSum/rtMax | commits | `SessionNodeItem` 渲染次数 | 窗内 `AssistantNodeView` |
|---|---|---|---|---|---|
| `expand-g0` | 51.71 / 5.73 | 82.68 / 22.9 | 2 / 12 | 16–144 | 40–480 |
| `collapse-g0` | 45.58 / 6.7 | 33.15 / 5.23 | 2 / 1 | 16–32 | 40 |
| `expand-g0-again` | 47.99 / 7.81 | 56.55 / 4.59 | 2 / 14 | 16–160 | 40–560 |
| `overflow-button` | 18.23 / 2.15 | 21.66 / 2.48 | **0 / 0** | 0 | — |

- **判定 PASS**：折叠/展开的单次成本 **rtMax 2.2–22.9 ms**、`rafMax≤36.1 ms`（同窗内 0 帧 >50 ms）；`raf p50 = 16.7 ms`、`p95 = 16.8–17.0 ms`（两轮 19 窗全部如此）⇒ **没有可感知掉帧**；持久化副作用 = **`workspace.json` 9 窗 0 写入**。
  ⚠️ **口径边界（本线自纠的同一类错误不再犯）**："折叠/展开不发宿主 RPC"**只有静态证据**（视图状态在 localStorage 视图 store，`WS:24-45`）——因为本线的 `fetch` 探针只在 `tools/probe-pop.mjs` 里开启，主探针两轮**未在 fetch 层验证折叠路径** ⇒ 该点标 **PASS（静态）**，不需按 §7 第 1d 条的方式推翻，但也**不得**引用 `ws.outN` 作证据（WS 上看不到 HTTP RPC）。
- **判定 FAIL（跨面级联，结构确证）**：一次折叠/展开 commit 里，**真正重渲染的大头不是侧栏行，而是对话区**——`AssistantNodeView`/`AssistantMarkdown` 的 PerformedWork 计数与 commits 成**固定倍数**（rep1 `expand-g0`：80+80 / 2 commits = **40+40 每次 commit**）；侧栏行 `SessionNodeItem` 只有 16/commit。见 §4.3 的零点击对照（这一倍数在**完全不操作**时同样成立 ⇒ 是流式驱动、被侧栏动作放大的既有级联）。

### 2.3 切换工作区（**两种实现，分别判定**）

| 路径 | 机制（file:line） | 实测/裁定 |
|---|---|---|
| **(a) 打开别的组的会话 = 事实上切工作区** | 无独立"选中工作区"动作：`containsCurrent` 由 `workspaces.find(w => w.sessionIds.includes(list.current))` 反推（`WS:195`）⇒ 点开另一组的会话即切换当前工作区 | **已实测**（§2.1 `open-target`：`switchPrep.crossGroup=true`，从 `MCU` 组跳到另一组）：**不触发任何宿主写入**（`workspace.json` 9 窗 0 写入），但**同样承担 §2.1 的 6–7 条 RPC + 13 MB `session.history`** ⇒ **判定 FAIL（成本侧同 §2.1）/ PASS（无持久化副作用）** |
| **(b) 显式选择器** `selectWorkspace(workspaceId)` | `conversation WS:10008-10026`：`await workspaces.connectWorkspace(workspaceId)` → `sessions.open(nextId)`（**`open` 未 await**）；`connectWorkspace` 复用该工作区的 blank 会话，否则 **`sessions.create({workspaceId})`**（`RT:9996-10012`）；宿主 `session.create` → `workspace.attachSession(sessionId)`（`HOST:2664`）⇒ **会写 `workspace.json`** | ⚠️ **未执行**（会**新建会话并改写用户的 `workspace.json`**，越只读边界）。仅静态确证 + §3 的写盘机制 |

### 2.4 会话列表数据源本身的成本（所有导航动作的地基）

| 项 | 实测 | 说明 |
|---|---|---|
| `POST /api/session.list`（冷，本线直调） | **5.387 s** / 502 971 B / 301 条 | 冷发（宿主刚起或缓存冷） |
| 同上（热，2 次） | **0.314 s / 0.221 s** | 与协调者给的 0.36–0.51 s 同量级 |
| GUI 内观测到的入站 `session.list` 帧 | 502 971 B（B1 服务端过滤后） | `raw/session-*.json` |

⇒ **PASS（对照 B1 裁决）**：`session.list` 不再是 32–35 s 的卡顿源；但它仍是**侧栏任何刷新路径的共同地基**（`RT:8070` 单飞全量刷新）。带宽口径：503 KB/次，逐条 `runningSubagentCount` 已投影（101/101 条带该字段）。

---

## 3. ② 会话搜索的实现（前端过滤 / 宿主 / 在 99+1110 下的表现）

### 3.1 实现（静态确证，[VERIFIED-BY-READ]）

**双通道混合**（不是"纯前端过滤"，也不是"纯宿主查询"）：
1. **本地通道**：`deriveSearchResults`（`WS:246-290`）遍历 `list.ids`，按 `sessionTitle` + 工作区 label 做 **`toLowerCase().includes(q)` 子串过滤**（`WS:260-263`），再 `sort(byRecency)`（`WS:265`）
2. **宿主通道**：`searchSessions` wrapper（`WS:2376-2380`）→ `ctx.sessions.search` → RPC `session.search`；**250 ms 防抖**（`SEARCH_DEBOUNCE_MS`，`WS:1035` + `WS:1752-1790`），查询上限 500 code units（`WS:1037`/`WS:1041-1050`），结果上限 **20**（`RT:8959` / `HOST:446-452`）
3. 合并顺序：本地命中在前、宿主 content 命中在后，去重后 `slice(0, limit)`，`hasMore` = `content.hasMore || ordered.length > limit`（`WS:266-293`）
4. 宿主处理器：`HOST:2518-2611`，SQLite **FTS5** 全文检索（`dsh-session-query-sqlite/lib/index.js:535-550/801-830`），`eventFilters` 限 `user/message`+`assistant/message`、`surface:"current"`，**每次调用都先重跑一遍"可见会话基线" `listVisibleSessionSummaries`（`HOST:2531`）**，provider 调用上限 100（`HOST:880/2546`），命中与 `visibleIds` 求交（`HOST:2536,2580`）
5. 输入每敲一键 ⇒ `WorkspaceBrowser` 受控 state 变化 ⇒ **整棵列表子树换成 `SearchResults`**（`WS:2023-2032`），`SearchResults` 自身又是**整体订阅** `useSessions((s) => s)`（`WS:1589`）

### 3.2 🔴 实测硬发现：本部署的**内容搜索被永久禁用**，但每次搜索仍照付宿主基线扫描

本线直接对宿主发同一 RPC（只读，3 组查询 × 2 次）：

```
POST /api/session.search {"query":"session"|"lag"|"布"}
→ {"ok":false,"error":{"code":"internal",
   "message":"session search failed: SessionQueryError: session search is disabled:
              this deployment configures the session-query index with openAt \"never\""}}
```

- 抛出点：`dsh-session-query-sqlite/lib/index.js:587-593`（`if (this.config.openAt !== "never") return; throw … SESSION_QUERY_SEARCH_DISABLED`）
- **6/6 次调用全部失败**（262 B 错误响应），即**宿主 content 搜索在本部署结构上不可能返回任何结果**
- **但耗时（TTFB≈total，262 B 响应体）**：

| 查询 | rep1 | rep2 |
|---|---|---|
| `session` | 1.605 s | 1.929 s |
| `lag` | **31.684 s** | 0.384 s |
| `布` | 0.471 s | 0.503 s |

⇒ **每次搜索都白烧一次"全量可见会话基线扫描"**（`HOST:2531` → `HOST:2233-2290`，冷路径按 16 条一批走持久层），**中位 ~1.0 s，最坏 31.7 s**，然后返回一个"功能被关闭"的错误。GUI 侧对应实测：敲入 `session`（7 键）后搜索面板状态 = **"正在搜索会话历史…"**（`search.pending`，`WS:1622-1626`）、结果行 **0**；再敲 1 键仍为 pending。错误态最终显示 "内容搜索暂不可用，仅显示名称匹配。"（`search.unavailable`，`WS:1627-1631`）。

- **判定 FAIL（高）**：
  1. 宿主内容搜索**在本部署恒失败**（配置 `openAt:"never"`），却仍被客户端按"可用"调用；
  2. **每次（防抖后的）搜索都先付一次全量基线扫描**，本线实测最坏 **31.68 s**、中位 ~1.0 s，全部为**纯浪费**；
  3. 期间 UI 停在"正在搜索会话历史…"，**用户等的是一个永远不会返回内容命中的 spinner**。
- **判定 PASS（部分）**：① **降级是被明示的**（`searchWarning` 文案），不是静默；② 本地标题/工作区子串过滤**在 pending 期间照常渲染**（`WS:1611-1621` 的 `results.items` **不在** pending 分支内 ⇒ 本地命中不会被 spinner 挡住；本线 query=`session` 得到 0 行是**真的 0 匹配**，因为活体会话标题是中文）；
  ③ 客户端 `AbortController` 在 query 变化时中止（`WS:1786-1789`）——**但宿主基线扫描是否随 abort 立刻停止，本线未验证 ⇒ INCONCLUSIVE**。

### 3.3 搜索的交互成本实测（N=16 行，两轮）

| step | rep1 rtSum/rtMax | rep2 rtSum/rtMax | commits | `SearchResults` pw | 窗内 `AssistantNodeView` |
|---|---|---|---|---|---|
| `focus-type`（键 7 字符） | 94.87 / 8.95 | 218.36 / 32.4 | 18 / 50 | 18 / 50 | 720 / 2000 |
| `type-more`（+1 字符） | 42.19 / 2.59 | 90.97 / 3.6 | 2 / 26 | 0 / 26 | 80 / 1040 |
| `clear`（清空） | 99.04 / 8.82 | 146.48 / 10.46 | 4 / 20 | 0 / 0 | 160 / 800 |

- **判定 FAIL（成本随流式放大）**：两轮同 step 差 **2.3×**（94.87 vs 218.36）⇒ 绝对值 INCONCLUSIVE；但**方向一致**：每键入 1 字符触发 ≥1 次 commit，且**每次 commit 仍带上整份对话区（`AssistantNodeView` ~40/commit）** ⇒ 搜索打字不是"只重渲染侧栏"。
- `rafMax` 8.95–40.3 ms、`raf>50 = 0`（两轮搜索窗）⇒ **未观测到打字掉帧**。

### 3.4 在"99 顶层 + 1110 子代理"下的表现（口径说明）

- 该规模**当前不存在**（§1：101 顶层 / 200 子代理，其中侧栏只渲染 16 行）。
- **结构推断（不外推数字）**：本地通道是 `list.ids` 的**全量线性扫描 + 排序**（`WS:226-231`），剂量因子是 **payload 条目数 301**（含 200 条永不渲染的子代理）；宿主通道剂量因子是**可见会话基线**（101），且**每次搜索重算**。两者都**与"侧栏渲染行数 16"无关** ⇒ 即使行数回落到 16，搜索路径仍按 301/101 计费。
- **判定 INCONCLUSIVE（规模外推）**：本线**不做 ms 外推**；可判定的是"搜索成本的自变量不是行数而是 payload 条目数"。

---

## 4. ③ 工作区切换的持久状态成本

### 4.1 写盘机制（静态确证）

| 环节 | file:line | 事实 |
|---|---|---|
| 客户端持久化 store | `WS:24-45`（`createWorkspaceViewStore`，`persist:"dsh.workspace.view.v5"`） | 视图状态（`groupBy`/`orderBy`/`groupExpansion`/排序账户）写 **localStorage**，**不写宿主** |
| 写实现 | `RT:5429-5446` | 整值 `JSON.stringify(state)` → `localStorage.setItem` |
| 宿主域 | `dsh-workspace/lib/index.js:224-235,313` | `defineDomain({name:"workspace", tables:{workspaces}})` ⇒ 单元 `workspace.json` |
| 后端写粒度 | `dsh-storage-json/lib/index.js:118-125,217-224` | **整文档重写、无防抖**，每次记录写串行等待耐久性 |
| 原子性 | `dsh-storage-json/lib/index.js:22-42` + `dsh-atomic-write/lib/index.js:58-69` | 随机后缀兄弟文件 + `rename()` + 目录 fsync |
| 文档规模 | `stat ~/.dsh/storages/workspace.json` | **11 382 B**（11 工作区 / 62 sessionIds / 77 归档 id） |

### 4.2 🔴 实测：**导航全程零写盘**（9 个窗口 × 100 ms 轮询 stat）

| 窗口 | workspace.json 写入数 | `session_projcache.json` 写入数 |
|---|---|---|
| `neg-none`（启动后静置） | **0** | 31 |
| `pos-120` | **0** | 4 |
| `idle`（8 s 无操作） | **0** | 2 |
| `switch`（4 次跨工作区切换会话） | **0** | **0** |
| `idle-conv`（会话已打开，8 s 无操作） | **0** | 37 |
| `collapse`（4 次折叠/展开） | **0** | 1 |
| `viewmode`（4 次视图模式互切） | **0** | 15 |
| `dose`（6 次模式/展开切换） | **0** | 4 |
| `search`（打字 + 清空） | **0** | 19 |

- **判定 PASS**：**切换会话 / 折叠展开 / 视图模式 / 搜索 全部不写 `workspace.json`**（9 窗 0 写入）；视图状态只落 localStorage。⇒ "导航触发整文档重写（11 KB×每次点击）"的假设**被证伪**。
- **判定 PASS（否定归因，重要）**：`session_projcache.json`（**11.5 MB**，整文档原子重写）确实在被高频改写（最密时 **~65–130 ms 一次**，8 s 内 37 次 ≈ **4.6 次/s ≈ 53 MB/s 写放大**），但**与导航动作无关**：`switch` 窗（4 次点击）是 **0 次**，而 `idle-conv`（零点击）是 **37 次** ⇒ 触发源是**会话事件/投影活动**，不是侧栏导航。⚠️ 这属于 w03-persistence / exec 线的范围，本线只做**归因否定**与**数值上报**（不认领修法）。
- **边界（必读）**：路径 **(b) 显式 `selectWorkspace`** 会走 `session.create` → `attachSession` → **整文档重写 `workspace.json`**（§2.3）；该路径**本线未执行**（会新建会话、改写用户 profile）⇒ 其**运行时成本标 UNKNOWN/未测**，仅有静态确证。

### 4.3 是否触发全量重渲染（零点击对照，②③④ 共同的地基）

同一次运行内、**同一浏览器**、两个"零点击"窗口对照（差异只有"对话区是否已挂载"）：

| 窗 | 时长 | commits | `pwSum`（PerformedWork fiber 次数） | `AssistantNodeView` | `AssistantMarkdown` | rtSum | rtMax | rafMax | `raf>50` | 窗内 `ws.inN` |
|---|---|---|---|---|---|---|---|---|---|---|
| `idle`（hero，无对话区） | 8.03 s | 72 | 15 144 | **0** | **0** | 357.94 ms | 6.95 ms | 21.2 ms | 0 | 515 |
| `idle-conv`（会话已打开，**零点击**） | 8.03 s | 91 | **104 071** | **2 533** | **2 533** | **1 119.19 ms** | **237 ms** | **239 ms** | **3** | 410 |

- **判定 FAIL（本线最重的实测发现）**：**只要打开过一个会话，什么都不做**，渲染主线程就持续消耗 **139 ms/s**（1 119 ms / 8.03 s），并周期性出现 **237–241 ms 的长帧**（`RunTask` / LoAF / wall-clock rAF **三通道同时命中**）。
- **结构归因（计数级，非时间级）**：`idle-conv` 的 `AssistantNodeView: 2 533` 次 PerformedWork ÷ 91 commits = **27.8 次/commit**，而该窗 `AssistantNodeView` 的**总数也是 28.4/commit** ⇒ **每一个 commit 都把全文（≈28 个 assistant 节点）重渲染一遍**（`react.memo` 边界未挡住该路径）。侧栏行 `SessionNodeItem` 是 **16/commit**（= 全部 16 行），占每次 commit 的 **~1.4%**（16/1144）。
- **对"切换工作区是否触发全量重渲染"的回答**：**是，但不是切换工作区特有的**——`ConversationRoot`/`ConversationSession` 以整体选择器订阅（w12 §4.4：`conversation:7159`/`7403`/`7158`/`7161`/`7162`），任何侧栏本地 state（折叠、视图模式、搜索、会话选中）产生的 commit 都会连带重渲染对话区；反过来"打开会话"本身把这份持续成本**永久挂上**。
- **口径纪律**：以上是**计数与"为零"判据**（`pwSum`、fixed-multiple、rtSum 比值 3.1×）；**所有绝对 ms 已标注并发条件**（同 run、`foreign=0`、持锁、宿主流式活跃）。

---

## 5. ④ 「In one list」无虚拟化的真实成本与虚拟化收益

### 5.1 结构（静态确证，[VERIFIED-BY-READ]）

| 事实 | file:line |
|---|---|
| `deriveFlat`：遍历 `list.ids` → `sessionVisible` 过滤 → `rows.sort(byRecency)` → `map(sessionNode)`；**无窗口化** | `WS:222-233` |
| 每次 derive 都重算 `indexSubagentDescendants(list.byId)`——它 `Object.values(summaries)` 遍历**全部**会话（含子代理）并沿父链上溯 | `WS:224` → `RT:10406-10427` |
| `FlatList` 订阅**整个** sessions store：`useSessions((s) => s)` | `WS:1471` |
| `FlatList` 三个 memo（`deriveFlat` / `sessionIds` / `reconciledSessionOrder`）+ 一个 order-sync effect | `WS:1472-1508` |
| 渲染 `rows.map(<SessionNodeItem>)`——**全量行，无虚拟化** | `WS:1536-1540` |
| **`SessionNodeItem` 没有 `react.memo`**（全文件 `memo(` 命中 0） | `WS:693`（声明）/ `WS:1406`,`WS:1540`（使用） |
| `reconciledSessionOrder` O(N)、`nextSessionOrderAccount` O(N log N)，在每次 store 通知 + 每次 memo 重算时跑 | `WS:1078-1096`, `WS:1103-1123`, 调用点 `WS:1238,1260,1267,1481,1500` |
| 全仓（本包）**无任何窗口化/虚拟化**：无 `react-window`/`virtual`/`IntersectionObserver`/`content-visibility` | 静态档 §TASK2 |

### 5.2 实测：**行数杠杆 0 ↔ 16 在同窗内没有可测出的差别**

`dose` 窗在同一窗口内做 **collapsed(0 行) → expanded(16 行) → collapsed → flat(16 行) → expanded → flat** 的 A-B-A-B-A-B（`dose` 窗 totals 两轮**几乎逐位相同**：rep1 863.98 ms vs rep2 865.25 ms，差 **0.15%** ⇒ 这是本线**最稳的一类测量**）：

| step | 渲染行数 | rep1 rtSum/commits → **每 commit** | rep2 rtSum/commits → **每 commit** | rep1 `a11ySync` 单次 | rep2 `a11ySync` 单次 |
|---|---|---|---|---|---|
| `grouped-collapsed-A` | 0（+11 组行） | 212.11 / 20 → 10.6 ms | 117.57 / 23 → 5.1 ms | 0.2/0.1/0.1 ms | — |
| `grouped-expanded-A` | **16** | 154.85 / 10 → 15.5 ms | 140.27 / 18 → 7.8 ms | 0.2/0.2/0.2 | — |
| `grouped-collapsed-B` | 0 | 106.8 / 7 → 15.3 ms | 74.04 / 7 → 10.6 ms | 0.3/0.1/0.1 | — |
| `flat-A`（FlatList） | **16** | 88.32 / 6 → 14.7 ms | 136.11 / 20 → 6.8 ms | 0.1/0.1/0.2 | — |
| `grouped-expanded-B`（SessionTree） | **16** | 121.1 / 7 → 17.3 ms | 201.06 / 29 → 6.9 ms | 0.3/0.2/0 | — |
| `flat-B`（FlatList） | **16** | 82.39 / 6 → 13.7 ms | 88.38 / 12 → 7.4 ms | 0.1/0/0.1 | — |

- **判定 INCONCLUSIVE（"无虚拟化的绝对成本"在本活体规模下不可测出）**：**每 commit 成本在 5.1–17.3 ms 区间内与行数 0/16 无单调关系**，且 rep 间同 step 差最大 2.3× > 行数效应 ⇒ 行数效应**落在噪声下**。
- **判定 PASS（虚拟化收益的量级上界）**：侧栏自身的可归因份额是**计数级**的：`SessionNodeItem` **16 次/commit** 对 `pwSum` **~1144 次/commit**（`idle-conv` 实测）⇒ **约 1.4%**；另测得部署中**唯一**的"每次 DOM 变动按行数线性扫"的实现（a11y tree 的 `sync()`，§5.3）在 **16 行**下只需 **0.1–0.3 ms**（两轮 4 次采样）。⇒ **即使把 16 行全部虚拟化，可回收的渲染主线程时间在本次仪器分辨下 <1 ms/次动作**（不是外推，是实测上界的直接读数）。
- **规模条件（明确不外推）**：只有在可见行数回到 ~99+ 时，`deriveFlat` 的 O(N log N) + 无 memo 的全行 map 才可能从"噪声"变成"可测"；**本线不做该外推**，只给出**结构风险 + 现有实测点**。

### 5.3 相关落地补丁（不属本线，但直接改变本项成本结构）

部署里的 `dsh-exec-a11y:U-A11Y2:v1`（`WS:2460-2751`）给 `role="tree"` 加了 roving tabindex，并挂了一个 **`MutationObserver(document.body, {childList, subtree, attributes:[aria-expanded,aria-selected]})`**；其回调 `syncTabs()/visibleItems()` 会 `querySelectorAll('[role=treeitem]')` + **逐行 `getBoundingClientRect()`（强制布局）**，另有 `hasTree()` 对被加入节点做子树 `querySelector`。**这是本产品里唯一"每行一次强制布局"的路径**。
- 实测（探针内直接调用其公开钩子 `window.__dshA11yTreeKeyboard.sync()`，**标注为"仪器化的合成调用"**）：**0.1–0.3 ms @ 16 行**（两轮共 8 次采样）⇒ 当前规模下可忽略；**但它与行数是线性关系，是与"无虚拟化"叠加的第二个 O(N) 项**，虚拟化方案必须一并考虑。

---

## 6. ⑤ 优化候选（前三项建议立项；第 4 项经实测**不建议现在立项**，含收益/风险/验收/回滚/热冷面）

### 优化 1 ★ 断开"对话区 ← 侧栏/流式 commit"的级联（本线最高收益、有实测立柱）

- **改哪里**：`dsh-client-ui-conversation/lib/client.js`——把 `ConversationRoot:7158-7162`（`useSession/useInput/useWorkspaces/composerBlock` **整体订阅**）与 `ConversationSession:7403`（`useInput((s)=>s)`）收窄为字段选择器；并给消息行加**真正生效的 memo**（w01 记录 `AssistantNodeView:9526` 等处有 `react.memo`，但本线实测 **2 533/2 533 = 100% 的 `AssistantNodeView` 每次 commit 都带 PerformedWork** ⇒ memo 的比较函数/父级 props 恒等性有问题）。
- **收益（实测立柱）**：零点击窗口 `idle-conv` **1 119 ms / 8.03 s（139 ms/s）+ rtMax 237 ms + 3 帧 >50 ms** vs 无对话区 `idle` **358 ms / 8.03 s（44.6 ms/s）+ rtMax 6.95 ms + 0 帧 >50 ms**（同 run 对照，3.1× / 34×）；并且**每次导航动作**都按 commit 数乘上固定的 40+40 fiber。
- **风险**：中。收窄订阅可能漏掉真实更新（须逐字段核对）；memo 比较函数写错会造成"不更新"的静默 bug。
- **验收**：① 同窗 A-B：`idle-conv` 的 `pwSum/commit` 从 **1 144** 降到 ≤ 300；② `AssistantNodeView` 的 `pw/总数` 从 **100%** 降到 ≤10%（判据：同一窗内 `watchPw/watchTotal`）；③ rtSum/8 s 从 ~1 119 ms 降到 ≤400 ms；④ 发送一条消息后消息文本**确实**更新（反事实哨兵）；⑤ `raf p50 = 16.7 ms` 不劣化。
- **回滚**：单文件、锚点式补丁；落地前备份 `lib/client.js` 原件（`.workspace/lag-fix/backup/`），回滚 = 还原 + 核对 `served sha1-12 == 磁盘 sha1-12`。
- **生效面**：**热面**（`GET` 读盘 + `no-cache`，刷新即生效；`?rev=` 仅缓存破坏串）。

### 优化 2 ★ 会话搜索：**不要在功能被禁用时仍按可用调用**（最小改动、立省宿主）

- **改哪里**：① 宿主 `dsh-host-apiproxy/lib/index.js:2518-2611`——**把 `SESSION_QUERY_SEARCH_DISABLED` 的检查提到 `listVisibleSessionSummaries(signal)`（`HOST:2531`）之前**（现在先扫全量基线、再抛"已禁用"）；② 客户端 `WS:1752-1790`——首次收到 `SESSION_QUERY_SEARCH_DISABLED` 后**进入 sticky 降级**（不再发 `session.search`，只跑本地过滤），并在 UI 明说"仅名称匹配"。
- **收益（实测）**：每次（防抖后的）搜索可省一次**全量可见会话基线扫描**——本线 6 次直调实测 **0.384 / 0.471 / 0.503 / 1.605 / 1.929 / 31.684 s**（中位 ~1.0 s，最坏 **31.7 s**），而该调用在本部署**永远不可能返回内容命中**（`dsh-session-query-sqlite/lib/index.js:587-593`，`openAt:"never"`）。
- **风险**：低（一次前置检查顺序调整 + 一个降级状态位）。反风险：若将来 `openAt` 改为可用，sticky 降级**必须有出口**（每次新开搜索重置，或按响应 `ok:true` 自动解除）。
- **验收**：① 在 `openAt:"never"` 下搜索任意词：**宿主侧不出现基线扫描**（判据：`session.search` 返回时间 < 50 ms，或直接返回禁用错误码）；② 本地标题匹配仍正常渲染（query=`dsh` ⇒ 命中 "dsh" 工作区的会话行数 >0）；③ UI 显示降级文案而非无限 pending；④ 反事实：把 `openAt` 临时置 `startup` 时 `session.search` 能返回 hits（此条需冷面/配置改动，可留作待办）。
- **回滚**：单文件两处改动，锚点式；回滚 = 还原 + 复核 `served sha1-12`。
- **生效面**：宿主侧 = **冷面**（需重启）；客户端侧 = **热面**（刷新即生效）。⇒ **建议拆两步：客户端 sticky 降级先热面落地（立刻消除 spinner 与浪费），宿主前置检查攒入下次冷面批。**

### 优化 3 ★ 会话切换的宿主扇出去重 + `session.history` 分页/懒加载（**导航路径上最大的单项成本**）

- **改哪里**：① 会话挂载时的 RPC 扇出——`commands/list`、`skill.list`、`agentPreset.list`、`session.models`、`dynamicCordisRunner/inventory` 这 5 条**与会话内容无关**，却在**每次切换**重取（实测 §2.1 证据 A：每次点击 +6~7 条）⇒ 按"首次获取 + 按需失效"缓存（宿主侧或客户端连接层均可）；② `session.history` 的**单页 13.26 MB / 57 682 事件且 `hasMore=true`**（§2.1 证据 B）⇒ 首屏只取最近 N 条事件 + 向上分页（协议里 `hasMore` 字段已存在，客户端已有分页语义可复用）。
- **收益（实测立柱）**：每次切换会话可省 **5 条 RPC**（0.002–0.893 s/条，实测 2 次/条）与**一次 ≥13.26 MB 的载荷**；该载荷与 rep1 观测到的 **317 ms 长帧**、以及"打开会话后 139 ms/s 的持续成本"（§4.3）同源。
- **风险**：中。历史分页要处理"跳到旧位置后新事件插入"的顺序问题；缓存失效必须挂在正确的事件上（否则会出现"命令列表/技能列表不更新"的静默陈旧 bug）。
- **验收**：① 一次会话切换的 `fetch` 计数增量从 **6–7 降到 ≤2**（判据：`tools/probe-pop.mjs` 的 `switchTrace.reqsDuringSwitch`，本线已有该探针）；② 首屏 `session.history` 响应体从 **13.26 MB** 降到 ≤1 MB 且首屏可见消息数不变（反事实哨兵：消息文本逐条比对）；③ `dwell` 段 rtMax 从 **317 ms** 降到 ≤100 ms（同窗 `RunTask` + LoAF 双通道）；④ 切换后 1 s 内 `llm.providers`/`commands` 等列表**内容确实**刷新（防止陈旧）。
- **回滚**：若改宿主，属**冷面**；若只改客户端连接层的缓存窗口，属**热面**。保留原文件 + 备份目录。
- **生效面**：客户端缓存部分 = **热面**；宿主分页部分 = **冷面（需重启）**。

### 优化 4 ○ 侧栏列表的规模硬化（**当前无收益，须挂条件，不建议现在立项**）

- **改哪里**：`WS:222-233`（`deriveFlat`）、`WS:1471`（整体订阅）、`WS:1536-1540`（全量 map）、`WS:693`（`SessionNodeItem` 无 memo）、`WS:224`（每次重算 `indexSubagentDescendants`）。
- **收益**：**当前实测 <1 ms/动作，不构成收益**（§5.2：行数 0↔16 的每-commit 成本无单调关系；a11y `sync()` 16 行仅 0.1–0.3 ms）。⇒ **本项不应作为"性能优化"立项**，只应作为**规模安全阀**（例如在 payload 条目数 > N 时启用窗口化 + 收窄订阅 + 重算缓存）。
- **风险**：中高（虚拟化会牵动拖拽排序 `WS:1509-1527`、hover-card、a11y roving 光标 `WS:2549-2571`）。
- **验收**：① 若立项，必须先造出剂量（当前 16 行**造不出**）；判据用同窗 A-B-A + `RunTask`（renderer main）比值，且**必须超过同窗噪声**（本线实测同 step 两轮噪声可达 2.3×）；② `pwSum/commit` 的 `SessionNodeItem` 份额从 1.4% 降到与视口行数成比例；③ 拖拽排序/键盘导航回归（`U-A11Y2` 的 `sync()` 仍能收敛）。
- **回滚**：单包热面；保留原 `lib/client.js` + `served sha1-12` 核对。
- **生效面**：**热面**。

---

## 7. 逐条判定汇总（PASS / FAIL / INCONCLUSIVE）

| # | 结论 | 判定 | 证据 |
|---|---|---|---|
| 1 | 会话切换的 `open→manager.select` **自身**是纯客户端（不发 RPC、不刷 `session.list`、不落盘） | **PASS** | 静态 `WS:2391`, `RT:9068-9070`, `RT:7902-7914` + `workspace.json` 9 窗 0 写入 |
| 1b | 但**挂载新会话**会发 **6–7 条 HTTP RPC/次**，其中 5 条与会话内容无关 | **FAIL** | 页内 fetch 探针：计数 21→28→34；`raw/w23-pop-*.json → switchTrace` |
| 1c | `session.history` **单页 13.26 MB / 57 682 事件 / `hasMore=true`** | **FAIL** | `raw/rpc-session.history-{1,2}.json`（13 265 086 B，0.177/0.815 s） |
| 1d | 本线 WS 探针**看不到 HTTP RPC**（RPC 走 `POST /api/<method>`）——第一版报告据 `ws.outN=0` 下的"无 RPC"结论**已被本行推翻** | **本线自纠（已改）** | `dsh-client-connection/lib/client.js:6332-6367`（`postJson('/api/${method}')`）+ fetch 探针 |
| 2 | "点开会话"之后有一次约 **0.32 s** 主线程长帧（异步投影装载） | **INCONCLUSIVE（n=1）** | rep1 `dwell` rtMax 317.45 / loafMax 319 / rafMax 324.9（三通道）；rep2 同窗未复现（该窗 `ws.inN=24`） |
| 3 | 折叠/展开成本低（rtMax 2.2–22.9 ms、`raf>50 = 0`）且**不写宿主存储**；"不发宿主 RPC"为**静态**判定（未做 fetch 级验证） | **PASS（含上述口径边界）** | 静态 `WS:24-45`, `WS:1381-1387`, `WS:472`；实测 §2.2（`workspace.json` 0 写入） |
| 4 | 组折叠时**一行都不渲染**（`expanded ? map : []`），`COLLAPSED_SESSION_LIMIT=5` 只作用于"已展开且 >5"的溢出路径 | **PASS** | `WS:208`, `WS:1039`, `WS:1404`, `WS:1452-1459` |
| 5 | 侧栏**不渲染任何子代理行**；`origin!=="subagent"` 是唯一判据；但**子代理数据仍随 payload 下发**（200 条 / 上限截断）并在派生时被全量遍历 | **PASS（事实）** | `WS:100-102`（5 处调用）、`HOST:1231`、payload 301 条 = 101+200 |
| 6 | 任务书起点"**DOM 上限 99 行**"⇒ **当前活体 16 行**（101 顶层 − 77 归档 − 8 blank；子代理 200 非 1110） | **FAIL（前提已过期）** | §1 逐项交集 + DOM `.YDXeBa_sessionRow=16`（两轮） |
| 7 | 搜索 = **混合**：前端子串过滤 + 宿主 FTS5 全文检索（250 ms 防抖、上限 20） | **PASS（实现判定）** | `WS:246-290`, `WS:2376-2395`, `HOST:2518-2611`, `RT:8959` |
| 8 | 宿主内容搜索在**本部署恒失败**（`openAt:"never"`），但**每次搜索仍先付一次全量可见会话基线扫描** | **FAIL（高）** | 6/6 直调返回 `SESSION_QUERY_SEARCH_DISABLED`（`dsh-session-query-sqlite:587-593`）；耗时 0.384–**31.684 s**；`HOST:2531` 顺序问题 |
| 9 | 搜索降级**被 UI 明示**（"内容搜索暂不可用，仅显示名称匹配。"），且本地命中不被 pending 挡住 | **PASS** | `WS:1604-1631`, `WS:1611-1621`；实测 `status="正在搜索会话历史…"` 且 0 命中（真 0 匹配） |
| 10 | abort 后宿主基线扫描是否立刻停止 | **INCONCLUSIVE** | 客户端有 `AbortController`（`WS:1786-1789`），宿主侧未验证 |
| 11 | 搜索打字的渲染成本**随流式活动波动 2.3×**，且每 commit 连带整份对话区 | **FAIL（方向一致，绝对值 INCONCLUSIVE）** | rep1 94.87 vs rep2 218.36 ms；`AssistantNodeView` 720 vs 2000 |
| 12 | 导航（切换/折叠/视图/搜索）**全程不写 `workspace.json`**（9 窗 0 写入） | **PASS** | 100 ms stat 轮询，`raw/w23-*.json → fileWatch` |
| 13 | 显式 `selectWorkspace` 路径**会**改写 `workspace.json`（整文档原子重写、无防抖） | **PASS（静态）**；**运行时成本未测（越只读边界）** | `WS:10008-10026`, `RT:9996-10012`, `HOST:2664`, `dsh-storage-json:118-125,217-225` |
| 14 | `session_projcache.json`（11.5 MB）被高频整文档重写（~4.6 次/s），但**归因不是导航** | **PASS（否定归因）** | `switch` 窗点击 4 次 = **0 写**；`idle-conv` 零点击 = **37 写** |
| 15 | "打开会话后零操作"仍有 **139 ms/s** 渲染主线程 + **237 ms** 长帧（3.1× / 34× 于无对话区） | **FAIL（最重）** | §4.3 同 run 零点击对照；`RunTask`+LoAF+rAF 三通道 |
| 16 | 每个 commit 重渲染**全部** ≈28 个 `AssistantNodeView`（memo 未挡住） | **PASS（计数确证）** | `watchPw 2533 / watchTotal 2583`、`2533/91 commits = 27.8 ≈ 每 commit 全量` |
| 17 | flat「In one list」**无虚拟化**（全量 derive + 全量 map + 行无 memo + 整体订阅） | **PASS（结构）** | `WS:222-233`, `WS:1471`, `WS:1536-1540`, `WS:693` |
| 18 | **行数杠杆 0↔16 对每-commit 成本无可测影响**（虚拟化当前收益 <1 ms/动作） | **INCONCLUSIVE（收益）** / **PASS（结构风险仍在）** | §5.2：`dose` 窗两轮 totals 863.98 vs 865.25 ms（0.15%）；每 commit 5.1–17.3 ms 与行数无单调关系；a11y `sync()` 0.1–0.3 ms @16 行 |
| 19 | 部署中 a11y 补丁引入了**唯一按行强制布局**的 O(N) 路径（MutationObserver → `sync()`） | **PASS（事实）**；@16 行可忽略（0.1–0.3 ms） | `WS:2460-2751`（尤其 `2549-2571`、`2732-2737`）；探针内合成调用计时 |
| 20 | 绝对 ms 的可复现性（同 step 两轮） | **PASS（计数/为零/比值）**；**FAIL（绝对 ms）**：噪声可达 2.3× | 附录 A |
| 21 | 仪器：三通道阳性对照 + 阴性对照全部自证 | **PASS** | §0.2（120.28/120.33 runTask、121 loaf、121.1/121.5 rAF） |
| 22 | 窗口内浏览器存活（两轮 19 窗） | **PASS**（`ownAlive=true/true` ×19 + 心跳 500 ms） | §0.4 两处缺口为长任务产物，非进程死亡 |
| 23 | 并发门禁（持锁 + foreign=0） | **PASS**（两轮全部窗口 `foreign=0/0`、`lockMine=true`） | §0.2/§0.3；绝对 ms 仍按 §0.3 标条件 |

---

## 8. 原始产物索引与复跑

| 文件 | 内容 |
|---|---|
| `raw/w23-nav-2026-09-22T10-44-*.json`（rep1）、`raw/w23-nav-2026-09-22T10-56-*.json`（rep2） | 两轮主测原始 JSON：每窗 runTask（含 `thread`）/rAF 序列/LoAF/LongTask/心跳/提交与逐组件 fiber 计数/逐步 slice/RPC 表/DOM 采样/fileWatch |
| `raw/w23-tables.md`、`raw/w23-derived-*.json` | 由 `tools/analyze.mjs` 生成的派生表（window / step / RPC / 文件写 / payload 规模 / 剂量） |
| `raw/session-list-{1,2,3}.json` | **宿主 `session.list` 原始响应**（301 条 = 101 顶层 + 200 子代理；502 971 B；5.387 / 0.314 / 0.221 s） |
| `raw/session-search-*.json` | **宿主 `session.search` 原始响应**（6/6 为 `SESSION_QUERY_SEARCH_DISABLED`）+ 对应耗时 |
| `raw/w23-pop-*.json`、`out/pop.run.txt`、`out/pop2.run.txt` | 侧探针：RPC 传输口径（HTTP `POST /api/<method>`）+ 入站帧规模普查 + **切换会话的 `fetch` 扇出轨迹（21→28→34）** |
| `raw/rpc-*.json` | **本线直接复放的切换相关 RPC 原始响应**（`session.history` 13 265 086 B / 57 682 事件 / `hasMore=true`；`agentPreset.list` 1 189 B；`skill.list` 289 B；`commands/list` 181 B；`session.models` 293 B；`subagent.list` 298 B）+ 各自耗时 |
| `out/probe-nav.log.txt`、`out/full{1,2,3}.run.txt`、`out/smoke2.run.txt` | 三轮运行日志（含失败轮与仪器 bug 的现场，未删除） |
| `static/nav-anchors.md` | 二级静态档（40+ 行 file:line 锚点，含 host 搜索处理器、存储写路径、`open/select` 语义） |
| `tools/probe-nav.mjs`、`tools/w23-init.js`、`tools/analyze.mjs`、`tools/probe-pop.mjs` | 全部探针与仪器源码 |

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/program/w23-nav
node tools/probe-nav.mjs --quick            # 冒烟（~1.5 min，含阳性/阴性对照）
node tools/probe-nav.mjs                    # 全量两轮对照（~2.5 min/轮，需持锁）
node tools/analyze.mjs                      # 生成 raw/w23-tables.md
node tools/probe-pop.mjs                    # 会话规模普查（~20 s）
curl -s -X POST http://127.0.0.1:3080/api/session.list -H 'content-type: application/json' \
  -d '{"type":"client-request","rpcId":"x","method":"session.list","payload":{}}' -w '\n%{time_total} %{size_download}\n' -o /tmp/sl.json
```

---

## 附录 A · 两轮同操作对照（判定"可复现 / INCONCLUSIVE"的依据）

| 操作 | rep1 rtSum / rtMax | rep2 rtSum / rtMax | 比值(rtSum) | 复现判定 |
|---|---|---|---|---|
| `switch/open-target` | 109.95 / 27.85 | 49.86 / 21.41 | 2.20× | INCONCLUSIVE（绝对） |
| `switch/restore-original` | 63.63 / 16.89 | 32.76 / 13.04 | 1.94× | INCONCLUSIVE |
| `switch/open-target-again` | 90.58 / 12.72 | 31.38 / 8.81 | 2.89× | INCONCLUSIVE |
| `switch/restore-final` | 58.23 / 15.13 | 48.39 / 8.45 | 1.20× | **近似可复现** |
| `collapse/expand-g0` | 51.71 / 5.73 | 82.68 / 22.9 | 0.63× | INCONCLUSIVE |
| `collapse/collapse-g0` | 45.58 / 6.7 | 33.15 / 5.23 | 1.38× | 弱 |
| `collapse/overflow-button` | 18.23 / 2.15 | 21.66 / 2.48 | 0.84× | **可复现** |
| `viewmode/to-flat` | 146.48 / 14.35 | 129.1 / 11.27 | 1.13× | **可复现** |
| `viewmode/to-grouped` | 166.64 / 14.56 | 153.47 / 13.62 | 1.09× | **可复现** |
| `dose/flat-B` | 82.39 / 7.79 | 88.38 / 7.06 | 0.93× | **可复现** |
| `search/focus-type` | 94.87 / 8.95 | 218.36 / 32.4 | 0.43× | INCONCLUSIVE |
| **整窗** `dose` | **863.98 / 15.08** | **865.25 / 16.16** | **1.00×** | **强可复现** |
| 整窗 `viewmode` | 975.44 / 14.56 | 806.15 / 13.62 | 1.21× | 近似 |
| 整窗 `switch` | 1703.19 / 317.45 | 324.25 / 21.41 | 5.25× | INCONCLUSIVE（受流式强度支配：窗内 `ws.inN` 1690 vs 24） |
| `raf p50 / p95`（19 窗全部） | 16.7 / 16.8–17.0 ms | 16.7 / 16.8–17.4 ms | 1.00× | **强可复现（"没坏"哨兵）** |

## 附录 B · 未决 / 边界（诚实清单）

1. **显式"切换工作区"（`selectWorkspace`）的运行时成本未测**：会新建/复用会话并改写 `workspace.json`，越过只读边界（§2.3 路径 b）。需要写权限档在隔离 profile 下补测。
2. **是否"侧栏某行不可达"**（协调者给的线索：某含图会话既不在列表也不在搜索结果）：本线**未复现**该具体会话的可达性判定——因为侧栏只渲染 16 行，可达集合 = 16 行 ∪ 搜索结果，而**内容搜索在本部署恒失败**（§3.2）⇒ 该缺口**存在机制**（未归档但未归属工作区且非 blank 的会话会成为 stray 桶；实测当前 stray=0），**但具体样本需专项核对**（判据：`session.list` 顶层 id 集合 − 归档 − 空白 − 工作区归属 = 空集；本线实测该差集 = 1 条，且该 1 条本身是 blank 会话，见 §1 计算）。
3. **`session_projcache.json` 高频整文档重写**的上游触发与修法不属本线（只做归因否定，§4.2）。
4. **a11y `sync()` 的合成调用**是仪器化测量（非产品自发），其"0.1–0.3 ms @16 行"只作**每行边际成本锚点**；产品自发的触发频率本文未量化（需要 MutationObserver 回调计数，属追加测量）。
5. rep2 的 `idle-conv` 为 **n=1** 观测；同 run 内与 `idle` 的 3.1×/34× 对照支持其结论，但**未做第二轮复现**（复现窗口已在 `tools/probe-nav.mjs` 内置，`--scenarios idle-conv,idle` 即可重跑）。
