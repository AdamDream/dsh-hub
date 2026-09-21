# R4 活体验证审计（实效 + 回归）

- 审计目录：`.workspace/lag-fix/research-v2/r4-live-verify/`（本档独占目录）
- 审计时间：2026-09-21 14:37–14:57 CST
- 审计对象：usage R4 守卫（client 热面 + host 冷面），宿主 PID **1390375**，启动 **14:37:03**
- 纪律：**只读**。未重启宿主、未改任何 lib/配置、未点任何写状态按钮、未调用 `/usage/refresh`
- 逐条结论见下表；**"能加载"与"行为已验证"严格分列**

> **审计期间的环境变动（非本档所为，必须与结论一起读）**：14:56:46，**另一个并行工作流**改动了 `dsh-usage/lib/ingest-cc.js`（`git status` 显示 `M`，diff 内容是关于 CC `last_offset` off-by-one 的修复，注释指向 `.workspace/lag-fix/research-v2/cc-cursor/`）。**不是本档写入**，也与 R4 无关。影响评估：本档全部结论都不依赖该文件——源树比对用的是 **14:39 时刻**的 `client.js`/`index.js`（sha256 已落盘在 `raw/environment.txt`），运行时证据全部来自 **deployed**（`ingest-cc.js` 的 deployed 件未被改动，mtime 仍为 09-18）。但因源树在审计期间被动过，**任何后续引用"source"的结论都应先核对此时间戳**。

---

## 0. 结论速览

| # | 项目 | 结论 | 依据 |
|---|---|---|---|
| 1a | 宿主 PID/启动时间 | **PASS** | `ps`：1390375，2026-09-21 14:37:03 |
| 1b | client bundle 下发字节 sha1 == 磁盘 sha1 | **PASS**（逐字节） | 均为 `4536b91ed2825ba462fe458dc0a490d9d8719599` |
| 1c | 宿主注入 rev 与磁盘件一致 | **PASS** | HTML 内 `dsh-usage/client.js?rev=4536b91ed282` = 磁盘 sha1 前 12 位 |
| 1d | deployed 两文件含 `dsh-perf-fix R4 v1` 标记 | **PASS** | client.js ×1、index.js ×2 |
| 1e | 15 处替换点契约（补丁后形态唯一命中、旧形态 0 残留） | **PASS** 15/15 | 独立只读复核脚本 `verify-anchors.mjs` |
| 1f | deployed 保住超集功能（hourly / trend gear / settingsScope / peakRing） | **PASS** 8/8 | 令牌计数 + 活体渲染证据（见 §3） |
| 1g | deployed 语法与"引入标识符有本文件内声明" | **PASS** | `node --check` ×2；8/8 标识符有本地声明 |
| 2a | 客户端守卫端到端（旧响应不得覆盖新筛选） | **PASS** | `--label verify`：终值 222222、旧哨兵从未出现、0 error |
| 2b | 普通挂载（无注入）卡片指标渲染 | **PASS** | 7/7 指标有真实值；2 个面板 + 6 个选择器；errorBox=null |
| 2c | 筛选切换（range/dataSource/卡片 tab） | **PASS** | 6 次选择器切换各触发 9 个请求、0 error、请求数随范围单调 |
| 2d | 卸载→重挂载后卡片仍活（自复核缺陷#1 回归） | **PASS（派生）** | tab 往返 2 次后仍渲染 7 指标并继续提交写入 |
| 2e | "卸载后飞行中响应回写"定向哨兵 | **INCONCLUSIVE** | 未做定向注入（见 §7.2） |
| 3a | 8 个只读 RPC 逐个调用 ok 与 wall time | **PASS** | 31 轮 × 10 调用 = **310/310 ok=true** |
| 3b | 跨 ≥1 个自然 45s ingest tick 观测 p95/max | **INCONCLUSIVE（未能达成）** | 观测窗内**根本没有发生 tick** → 见 3c |
| 3c | 周期 ingest tick 是否在跑 | **FAIL（观测事实）** | `lastIngest` 冻结 ≥19 分钟；DB 零写入 |
| 3d | 长停顿是否存在 | **PASS（记录事实）** | 2 轮出现 10–22.6s 级停顿，**与 ingest 无关**（无 tick 可对齐） |
| 4a | session.list 回归哨兵 | **PASS** | 297 条稳定、104 顶层、36/36 次调用 ok |
| 4b | `runningSubagentCount` 覆盖与自洽 | **PASS** | 97/97 非 subagent 行带字段、subagent 行不带、Σ=11=running subagent 数 |
| 4c | 设置页 8 标签切换 | **PASS** | 8/8 点击成功、逐页 0 error、无空白页 |
| 4d | 子代理抽屉可展开 | **PASS** | `aria-expanded false→true`，树 1→15 行（14 子代理，2 运行中）；**Esc 可收起** |
| 5 | 插件卸载路径（dispose）活体验证 | **无法验证** | 只读下无法触发；仅 code/harness 证据（我独立复跑 13/13） |
| 6 | 浏览器独占锁 | **PASS（重跑窗口全程持锁）** | 15:01:20–15:03:16 持锁 116s、无抢占；**早期窗口未持锁，已在 §0.1 披露** |

**一句话**：R4 的**部署与契约**已逐处核实为真，**客户端半的实效已端到端验证**；**宿主半只验证到"能加载 + 只读面全绿 + 代码路径在 harness 通过"，其"卸载保护"在活体上无法触发故未生效验证**；另外发现一个**与 R4 无关但重要的活体异常**：45s 周期 ingest 自上电起从未成功跑过第二轮。

---

## 0.1 跨线测量纪律：浏览器独占锁（**如实披露，含"未持锁窗口"**）

锁路径：`.workspace/lag-fix/research-v2/.probe.lock`（**原子 `mkdir`**）。脚本：`acquire-probe-lock.sh`（获取，含重试与严格抢占闸门）、`release-probe-lock.sh`（释放）。

### 持锁记录

| 项 | 值 |
|---|---|
| 获取结果 | **attempt 1 成功，等待 0s**（获取时锁为空） |
| owner.txt | `agent=r4-live-verify(subagent)` / `pid=1838632` / `started_at=2026-09-21 15:01:20 CST` / `host=CNS202649516533` / `attempts=1` / `preempted=none` |
| **抢占** | **未发生**（`preempted=none`；无人被抢占，也未抢占他人） |
| 持锁窗口 | **15:01:20 → 15:03:16（1 分 56 秒）** |
| 持锁期间的浏览器工作 | `clean-rerun.mjs` 全程在锁内（含卡片挂载、6 次筛选切换、趋势面板元素级截图、子代理抽屉展开/收起） |
| 释放 | 正常释放，`post-release: lock free ✓`（无残留目录） |
| **浏览器窗口是否全程持锁** | **本次重跑窗口：是（100% 持锁）。但本档早期的浏览器窗口：否 —— 见下"未持锁窗口"披露。** |

**释放时踩到的坑（已写进脚本头注）**：纪律要求把 `owner.txt` 写进锁目录，因此纯 `rmdir` 会以「目录非空」失败（第一次释放即失败）。正确顺序是先 `rm owner.txt` 再 `rmdir`；`release-probe-lock.sh` 已固化该顺序，且**只删自己的那一个文件**——若目录里出现他线的文件则拒删并列出，交人工判断。同时它支持 `AGENT` 参数校验，不是自己的锁就拒绝释放。

### ⚠️ 未持锁窗口披露（本档自身违反纪律的部分）

锁纪律是在本档**已经跑完全部探针之后**才下达的。因此本档**早期浏览器窗口未持锁**：

| 探测 | 大致时刻 | 是否持锁 |
|---|---|---|
| `explore-gui.mjs` | ~14:41 | **否** |
| `regression-probe.mjs`（8 标签 + 卡片 + 筛选） | ~14:49–14:52 | **否** |
| `drawer-probe{1..5}.mjs`（子代理抽屉定位） | ~14:53–14:56 | **否** |
| `client-stale-probe.mjs --label verify` | ~14:48 | **否** |
| `clean-rerun.mjs`（复跑 + 补缺口） | 15:01–15:03 | **是** |

现场取证：15:00:49 观察到**同时存在 4 个他线 playwright 实例**（`raw/browsers-before-lock.txt`），持锁窗口内又观察到 3 个（`raw/browsers-during-lock.txt`），其中 `pid=1839344` 的 etimes=65s 说明它**在我持锁期间（15:01:59）才启动** —— 即**锁并未被所有线遵守**。

因此必须区分"结论"与"计时"：

- **不受并发影响的结论（早期未持锁窗口 + 持锁复跑一致 ⇒ 可信）**：0 console/page/requestfailed error；7/7 指标与数值；趋势面板已绘制（持锁窗口的 SVG 结构 + 元素级截图）；8 标签切换成功；子代理抽屉 `aria-expanded`/treeitem 计数与 running 行；每次选择器切换恰好 9 个 usage 请求；请求数随窗口单调。
- **受并发污染、只能当噪声看的数据**：各标签点击耗时（2252–4605ms）、host-probe 的 wall time 绝对值（§4.1/§4.2）、`session.list` 的 p50/p95/max。
- **两次窗口（未持锁 14:49–14:52 与持锁 15:01–15:03）在全部确定性判据上逐项一致** —— 这本身就是"并发未改变这些结论"的复现证据：卡片 7 指标数值完全相同（25439/123.41m/23.69m/4.50b/0/97%/458）、6 次切换的请求数与新错误数完全相同、TOTAL errors 均为 0。

**纪律教训（建议后续线照做）**：① 锁要在**第一条浏览器探针之前**就取，而不是事后；② 释放必须先删 `owner.txt` 再 `rmdir`；③ 锁只能排他"守纪律的线"，本机存在不查锁的浏览器使用者，所以**持锁 ≠ 真独占**，关键结论仍应靠确定性判据（哨兵值、错误计数、DOM 谓词）而不是计时数字。

---

## 1. 生效证据（逐条落数据）

### 1.1 宿主进程

```
PID 1390375  node /home/CNS2026495165/.npm-global/bin/dsh web
STARTED 2026-09-21 14:37:03 CST
```
重启编排日志 `~/.dsh/backups/dsh-restart.log` 可见：`SIGTERM -> PID 1209782` → 进程已退出（2s）→ 启动 → `✅ boot OK（2s）HTTP 200 冒烟通过`，与 `ps` 的 14:37:03 一致。**冷面（index.js）确由本 PID 加载**。

### 1.2 client bundle：下发字节 == 磁盘字节

| 项 | 值 |
|---|---|
| 磁盘 `~/.dsh/profiles/node_modules/@local/dsh-usage/lib/client.js` sha1 | `4536b91ed2825ba462fe458dc0a490d9d8719599` |
| 磁盘同文件 sha256 | `cdbd87b6d97e393342c1f9460cd3d2a53c6952f29c01bb3c9fe4bfd21f81b78e` |
| HTTP `GET /plugins/@local/dsh-usage/client.js?rev=4536b91ed282` → sha1 | `4536b91ed2825ba462fe458dc0a490d9d8719599` |
| HTTP 响应字节数 | 72804 = 磁盘文件大小 |
| HTML 注入 rev | `rev=4536b91ed282` |
| 与 `candidate/client.js`（补丁产物）比对 | sha256 相同 |

⇒ **下发字节与磁盘补丁件逐字节同一**，rev 与磁盘 sha1 前缀同步。原始件：`raw/served-client.js`、`raw/home.html`、`raw/bundle.headers`、`raw/environment.txt`。

### 1.3 标记与语法

- `dsh-perf-fix R4 v1`：client.js 命中 **1** 处（C1 guard 块），index.js 命中 **2** 处（H1 状态块、H4 disposer）。
- `node --check` 两文件均 **OK**。
- 补丁引入的 8 个标识符（`aliveRef` / `allGenerationRef` / `sessionsGenerationRef` / `statusGenerationRef` / `disposed` / `activationGeneration` / `isActive` / `bootstrapGeneration`）**全部**在本文件内有 `let/const` 声明 → 排除 B1 式 `ctx is not defined` 同类运行时 ReferenceError。
- pre-image 备份真实性核对：`backup/R4-deployed-20260921063032./` 的 sha256 = `eeb5dcf2…`(client) / `49f648c4…`(index)，**与交接文档记录的 rollback 目标逐字节一致**。

---

## 2. 契约与超集：逐处替换点对比（source ↔ deployed）

方法：不跑 `apply-R4-deployed.mjs` —— 它的 dry-run 也会**写** `r4-delivery/candidate/{client,index}.js`（脚本 280–282 行），越出本档只读边界。改为独立脚本 `verify-anchors.mjs`：对每处替换点校验「补丁后形态恰好命中 1 次」+「补丁前旧形态 0 残留」，并记录 source 对应实现。原始件 `raw/anchors.json`。

**结果：15/15 处 post 形态唯一命中；0 处旧形态残留。**

> ⚠️ **对既有报告的更正**：`settings-jank-revise-exec.md` §2 写"14 处锚点"，但其自身枚举是「client 10 处（C1–C10）+ index 5 处（H1–H4 + H3a）」= **15**。真实规则数 15（我在脚本里逐条对过）。这是文档算术笔误，不影响落地正确性。

### 2.1 client.js 契约逐处

| 锚点 | 内容 | source 对应 | 判定 |
|---|---|---|---|
| C1 | refs + lifecycle effect（setup 置 alive、cleanup 置 false 并递增三个代次） | 同形（注释为英文 `// R4:`，**无** R4 banner） | 契约一致 |
| C2 | loadAll 头部代次 + 写入门控 | 同形，**但依赖数组不同**：deployed 多 `trendDay` | deployed 超集保住 |
| C3 | `if (current() && calls.slice(0, 6).every(...))` | source 为 `calls.every(...)` | **见 §2.2 关键差异** |
| C4 | `} else if (current()) {` + `calls.slice(0, 6).find` | source 为 `calls.find(...)` | 同上 |
| C5 | catch + finally 门控 | 逐字同形 | 契约一致 |
| C6 | loadSessions 头部 | 逐字同形 | 契约一致 |
| C7 | 写入分支门控 | 逐字同形 | 契约一致 |
| C8 | catch 门控（依赖数组未变） | 逐字同形 | 契约一致 |
| C9 | loadStatus 头部 | 逐字同形 | 契约一致 |
| C10 | `if (current() && result && result.ok) setStatus(...)` | 逐字同形 | 契约一致 |

### 2.2 关键结构差异 —— deployed 的 `slice(0, 6)` 不是"更严"，是**超集保命点**

deployed 的 `loadAll` 有 **7** 个 `rpc.call`；source 只有 **6** 个。第 7 个是 hourly timeseries：

```js
// Deliberately OUTSIDE the all-or-nothing gate below: a host predating the hourly
// whitelist rejects this with invalid-params, and that must degrade to the daily
// trend instead of blanking the whole card.
rpc.call(CHANNEL, "timeseries", { granularity: "hour", ... }).catch(() => null),
```
```js
if (current() && calls.slice(0, 6).every((r) => r && r.ok)) { ... setTimeseriesHour(calls[6] && calls[6].ok ? ... : []); }
```

⇒ 若当初按 source 整文件覆盖（或用 `calls.every(...)`），第 7 个调用在旧宿主上为 `null` → 闸门恒 false → **整卡报错空白**。R4 补丁只加了 `current() &&` 前缀、**没有**照抄 source 的 `calls.every` —— 这正是"最小同构打补丁"相对"整文件覆盖"的实质收益，验证为**保住了**。

### 2.3 超集功能令牌：deployed 8/8 存在，source 多数为 0

| 功能 | deployed 命中 | source 命中 |
|---|---|---|
| hourly 粒度 `granularity === "hour"` | 2 | **0** |
| hourly 3 小时 roll-up（`rollupBuckets`/`hoursPerBucket`） | 6 | **0** |
| hourly anchorHour / 04:00 使用日 | 5 | **0** |
| trend gear（`24h gear`/`Gear`） | 3 | **0** |
| trend 令牌 `--du-trend-line/fill` | 9 | **0** |
| settingsScope 接线 | 16 | **0** |
| peakRing | 9 | **0** |
| heatmap peak（`peakDay`） | 5 | **0** |

**重要定性**：source 与 deployed 是**两个漂移的拷贝**（client.js 35294B vs 72804B）。所以"source 与 deployed 契约一致"**只能**在 R4 守卫语义层面成立；**deployed 是功能超集，source 中没有这些功能**。整文件覆盖会静默丢掉上表全部功能——既有报告对此的判断正确，本次以令牌计数独立复核确认。

---

## 3. 行为验证（客户端）

### 3.1 旧响应覆盖守卫（端到端，实测）

命令与结果（原始件 `raw/client-stale-verify.json`）：

```
node .workspace/lag-fix/r4-delivery/client-stale-probe.mjs --label verify
[verify] summary 请求数=2  批次哨兵=[111111,222222]
[verify] 时间线=[{"tMs":4,"value":null},{"tMs":606,"value":"222222"}]
[verify] 终值=222222  见到A=false 见到B=true
[verify] 裁决=PASS  errors=0
```

- 批次 A（挂载时近 7 天）延迟 6s 交付哨兵 `111111`；批次 B（切近 30 天）立即交付 `222222`。
- 终值 `222222`，**A 的哨兵从未出现在时间线上** → 旧响应被代次门控丢弃。与打补丁前的 `FAIL_STALE_OVERWRITE`（终值 111111，A 在 4878ms 覆盖 B）形成反证对照。
- 载荷确认两次请求确实是不同窗口：`from=1789401600000`(7d) → `from=1787414400000`(30d)。

> **写入披露（唯一一次越界写）**：该探针把结果硬编码写到 `r4-delivery/client-stale-verify.json`（原目录内原无此文件，新建、未覆盖任何既有文件）。已复制到 `raw/`。除此之外本档未写任何非自有路径。

### 3.2 普通挂载（**无任何注入**）

`regression-probe.mjs`，原始件 `raw/regression.json` + 8 张 `raw/tab-*.png`。

- 卡片挂载成功，**7/7 指标有真实值**：请求数 25439 / 输入(未缓存) 123.41m / 输出 23.69m / 缓存读 4.50b / 缓存写 0 / 命中率 97% / 覆盖会话 458。
- `errorBox = null`；`errorsAtMount = 0`；卡片 DOM 节点 298；SVG 2 个。
- 面板渲染：**趋势（逐小时 09-21 04:00–09-22 04:00）**、热力图（按日总量）—— `hourly + 04:00 使用日` 超集功能**在浏览器里活着**。
- 6 个选择器全部渲染：数据来源(all/dsh/cc)、范围(7/30/90/自选)、轮询(不轮询/5s/30s/60s)、**粒度(24h 逐小时 / 按日)**、趋势指标(总 tokens/…)、图形(面积图/柱状图) → trend gear 亦活着。
- 卡片脚注含 `上次 ingest：2026-09-21 · 来源事件：dsh 89394 / cc 22700`（注意：只到**日期**，UI 上看不出 §4.3 的陈旧）。

### 3.3 筛选切换（6 次选择器切换 + 4 次卡片 tab，全部 0 error）

| 切换 | 新 usage 请求 | 页面错误 | 卡片请求数 |
|---|---|---|---|
| range → 30 | 9 | 0 | 84922 |
| range → 90 | 9 | 0 | 112094 |
| range → 7 | 9 | 0 | 25439 |
| dataSource → dsh | 9 | 0 | 25439 |
| dataSource → cc | 9 | 0 | 0 |
| dataSource → all | 9 | 0 | 25439 |
| 卡片 tab 按模型/按项目/按日 | — | 0 | 各 6 行 |
| 卡片 tab 会话明细 | — | 0 | 200 行 |

- 每次选择器切换（range 3 次 + dataSource 3 次）都重发全部 8 个方法（summary/timeseries/heatmap/byModel/byProject/byDay/sessions/status，其中 timeseries 日/时各一次 = 9 请求），**没有出现少发/漏发**；4 次卡片 tab 切换是纯前端切换、不发请求。
- 请求数随窗口单调：7d 25439 < 30d 84922 < 90d 112094（口径自洽）。
- **全程 console/page error = 0**（含 pageerror、console.error、requestfailed 三类）。
- `dataSource=cc` 得 0 请求数 → **仅记录**，不归因（cc 源 7 天窗口内该指标为 0 属可能）。

### 3.4 视觉交叉核对与趋势曲线像素确认（含持锁重跑）

对 `raw/tab-3.png` 做独立读图，确认（仅凭像素，不看我的 DOM 数据）：

- 卡片标题 **「Token 用量 · dsh-usage」**、副标题「dsh + Claude Code 双源统计（不计费）」。
- 7 个指标与**完全相同**的数值：请求数 25439 / 输入(未缓存) 123.41m / 输出 23.69m / 缓存读 4.50b / 缓存写 0 / 命中率 97% / 覆盖会话 458。
- 筛选控件：全部来源 / 近 7 天 / 60s 刷新 / 手动刷新按钮。
- 趋势面板标题 **「趋势（逐小时 09-21 04:00–09-22 04:00）」** 与控件 **24h 逐小时 / 总 tokens / 面积图** → hourly 与 trend gear 两条超集功能**在真实渲染里可见**。
- **无任何错误框**。

**原口径边界已于 15:02 闭合（持锁重跑）**：`clean-rerun.mjs` 把趋势面板滚入视野后做**元素级截图** `raw/clean-trend-panel.png`，并读该面板的 SVG 内部结构：

```
title="趋势（逐小时 09-21 04:00–09-22 04:00）" height=222px
svg=1  pathCount=3  areaPathFillNonEmpty=2（d 长度 >40 的路径）  textNodes=12
controls: hour(24h 逐小时/按日) · total(总 tokens/…) · area(面积图/柱状图)
```

⇒ **曲线本体确实已绘制**（1 个 SVG、3 条 path、其中 2 条是带非平凡 `d` 的面积/折线路径、12 个轴/刻度文本节点），不再是"仅 DOM 推断"。完整卡片另存 `raw/clean-usage-card.png`。
（早期 `tab-3.png` 看不到曲线的原因也清楚了：绘图区在可视区之下，不是"空白"。）

### 3.5 卸载→重挂载仍活（派生的回归证据）

8 标签探针的顺序是 通用设置→模型→**插件**→Agent 预设→远程工作区→分布式控制→vision-adam→子代理模型：卡片在第 3 个标签挂载，随后被后 5 个标签**卸载**；§3.2 再点回「插件」时**重新挂载**并渲染出 7 个指标、随后 6 次选择器切换照常提交。

⇒ 自复核报告 §1.1 抓到的第一个缺陷（"只在 cleanup 置 false、setup 不恢复 → remount 后卡片永久判死"）**在 deployed 包里不存在**。这是"setup 重新置 alive"这条修复的活体反证。

---

## 4. 行为验证（宿主）

### 4.1 8 个只读 RPC 逐个调用（31 轮 × 10 = 310 次，全 ok）

原始件 `raw/host-probe.json`。观测窗 06:41:04Z–06:43:31Z（本地 14:41:04–14:43:31），interval 3s，单次 20s 有界超时。

| 方法 | ok | min | p50 | p95 | max |
|---|---|---|---|---|---|
| status | 31/31 | 5.3 | 7.8 | 118.6 | **11062.1** |
| summary | 31/31 | 14.9 | 17.9 | 54.3 | **8191.1** |
| timeseries(day) | 31/31 | 52.5 | 56.8 | 114.5 | 129.7 |
| timeseries(hour) | 31/31 | 23.2 | 40.1 | 128.1 | 377.2 |
| heatmap | 31/31 | 1.8 | 6.4 | 139.8 | 317.2 |
| byModel | 31/31 | 16.8 | 20.1 | 67.5 | 139.9 |
| byProject | 31/31 | 18.5 | 24.1 | 99.7 | 106.1 |
| byDay | 31/31 | 52.2 | 64.8 | 139.2 | 262.3 |
| sessions | 31/31 | 43 | 68.8 | 266.1 | 952.3 |
| session.list（哨兵） | 31/31 | 167.6 | 438.8 | 2120 | 9795.3 |

- 冷启动（round 1）无异常：status 26.9ms、summary 18.7ms、heatmap 2.8ms、sessions 72.3ms。
- 载荷形状全部正确（`status` 返回含 dbPath/lastIngest/eventsDsh…；`summary` 返回 requests/input_tokens/… ；`sessions` 返回 200 行）。

### 4.2 长停顿：确实存在，且**与 ingest 无关**

| 轮次（UTC） | 该轮 10 个调用合计 | 最大项 |
|---|---|---|
| 06:42:14 | **22558 ms** | status 11062ms、summary 8191ms、session.list 2120ms |
| 06:41:59 | **11896 ms** | session.list 9795ms、sessions 952ms |
| 06:43:02 | 1942 ms | session.list 1247ms |
| 06:43:22 | 1540 ms | session.list 1040ms |

**关键**：这两轮巨停顿发生时，宿主 `lastIngest` 恒定在 06:37:06 —— **窗口内没有任何 ingest tick 可供对齐**（既有审计要求"把 >100ms 尖峰与 lastIngest 时间对齐"）。所以这些停顿**不能归因于 ingest**；按本档纪律也**不进一步归因**（可能与审计自身负载、projection cache、GC 等有关，本次未测）。

> 自观测污染声明：审计者本人的 agent 会话就跑在**被审计的同一个宿主 PID** 里；`session.list` 返回 472–481KB/次，主机也在实时产生事件。上述绝对值含本档自身负载，**不是干净基线**。

### 4.3 ⚠️ 发现：45s 周期 ingest 自上电起从未成功跑第二轮（**与 R4 无关**）

这是本轮最重要的活体发现，**记录事实、不归因**：

**观测事实**
1. `status.lastIngest = 1789972626541` → 本地 **14:37:06**，即宿主启动（14:37:03）后 **3.5 秒**——**bootstrap 首扫成功完成**（证明 R4 修改过的 bootstrap 路径在活体上跑通：DB 打开、schema、发布 `db`、首扫、写 `lastIngest`）。
2. 随后 **150s 连续 31 次采样 + 后续抽查到 14:48:21**，`lastIngest` **始终是同一个值**，累计陈旧 **675s（11+ 分钟）≈ 15 个 45s 周期**。
3. usage DB 三个文件（`usage.db` / `-wal` / `-shm`）mtime **全部停在 14:37:05–06**，此后 19 分钟零写入；而审计者本人这 19 分钟一直在产生新事件（`scannedDsh=61`、会话数 297 且在增长），若 tick 在跑必然发现新事件并更新 sync_state。
4. `eventsDsh=89394` / `eventsCc=22700` / `scannedDsh=61` / `scannedCc=0` 同样全程不变。
5. 交叉核对：**`lastIngest` 冻结不是 R4 引入的**——pre-R4 基线 `reports/live-endpoints-before.json`（2026-09-20T07:26:19Z 探测）记录的 `lastIngest` 为 2026-09-20T03:47:24Z，**当时就已陈旧 13134s（3 小时 39 分）**。
6. 补充手段（CPU/IO 突发）**不可用**：`host-cpu-sampler.mjs` 采到宿主稳态 CPU ≈ 413ms/s（约 41% 单核，含本档自身负载），p50=740ms/2s、p95=1690ms、max=1830ms —— 噪声远大于一次 fold 的既有基准（478–846ms），**无法用突发法分辨 45s 周期**；`/proc/<pid>/io` 读不到（rchar/read_bytes 全 0）→ IO 维度证据缺失。

**判定**
- 「周期 ingest 在跑」：**FAIL（观测事实）**。
- 「机制是 timer 未触发，还是每次 tick 的 fold 抛错」：**INCONCLUSIVE**。插件 logger 不落 stdout/文件（`dsh-restart.log` 自 14:37 起零新增，连 `db ready` / `ingest done` 都没有），无日志可读；cordis `ctx.setInterval` 内部状态只读不可观测。
- 「是否 R4 引入」：**否**（有 pre-R4 同类基线）。同时**也不构成 R4 host 半已生效的证据**——恰恰相反，它意味着"45s 定时器在活体上按周期工作"这件事**没有被观察到**。
- **对既有报告的影响**：`settings-jank-audit-host-loop.md:96` 要求的"至少覆盖两个 45s ingest tick 并把尖峰与 lastIngest 对齐"**在本宿主上无法完成**，因为 tick 不存在。任何"重启后 ingest tick 正常"的说法目前**没有证据**。

---

## 5. 回归哨兵

### 5.1 session.list（`raw/session-list.json`、`raw/host-probe.json`）

- 5 轮独立（session-sentinel）+ host-probe 31 轮 = **36/36 次调用 ok=true、HTTP 200**，字节数 480990。
- 条目数 **297 稳定**（5 轮全等），顶层 **104 稳定**，其中非 subagent 行 **97**、subagent 行 **200**。
- wall time：min 167.6 / p50 438.8 / p95 2120 / max 9795.3 ms（**慢**，但与 B1 事故的"500/空列表"无关：结构完整、条目稳定）。
- `origin` 只有 `subagent`（+ 非 subagent 行为 undefined）；running 行 13（其中 subagent 11、非 subagent 2）。

### 5.2 `runningSubagentCount` 覆盖与自洽（B1 字段）

- 字段**恰好**出现在 97 个非 subagent 行上（= 全部非 subagent 行），**没有任何 subagent 行带该字段** —— 与宿主源码 `annotateRunningSubagentCounts`（`if (item.origin === "subagent") continue;`）契约**逐条吻合**。
- 97/97 均为 `number` 类型；Σ`runningSubagentCount` = **11** = 全表 running 的 subagent 行数（11）→ **自洽**。
- 单个值可 > 直接子行数（`session-d565c2bf` 值 9、直接子行 8），因为语义是"沿**不间断 subagent 血缘链**统计 running **后代**"，不是"直接子行数"。
  > 更正我自己的中间结论：我第一版哨兵用"值 == 直接子行数"当不变量，得 `aggregateConsistent=false`；读了宿主源码后确认该不变量**无效**，已改判 PASS。

### 5.3 设置页 8 标签（`raw/regression.json`、`raw/tab-*.png`）

8 个标签 = 通用设置 / 模型 / 插件 / Agent 预设 / 远程工作区 / 分布式控制 · dsh-ssh-gui / vision-adam 识图设置 / 子代理模型。

| 标签 | 点击 | 新错误 | 内容文本量 | 控件数 | 含用量卡片 |
|---|---|---|---|---|---|
| 通用设置 | ok | 0 | 314 | 18 | – |
| 模型 | ok | 0 | 81 | 9 | – |
| 插件 | ok | 0 | 2105 | 19 | ✅ |
| Agent 预设 | ok | 0 | 499 | 19 | – |
| 远程工作区 | ok | 0 | 233 | 16 | – |
| 分布式控制 · dsh-ssh-gui | ok | 0 | 340 | 5 | – |
| vision-adam 识图设置 | ok | 0 | 583 | 8 | – |
| 子代理模型 | ok | 0 | 1329 | 6 | – |

**8/8 切换成功、逐页 0 error、无空白页（最小 textLen 81 且带 9 个控件）。**

### 5.4 子代理抽屉（`raw/drawer5.json` + `raw/clean-rerun.json` + 4 张截图）

前三次尝试失败已如实记录（首屏侧栏停在工作区「EAGET」、chip 是 `visualHidden` 无障碍文本、侧栏选择器不匹配）；最终定位到触发器 `button.ZKlsPq_trigger`：

| 状态 | `aria-expanded` | `role=tree` 行数 | 内容 |
|---|---|---|---|
| 初始 | **false** | 1 | 仅父会话行 |
| 点击 1 次 | **true** | **15** | 父会话 + **14 个子代理行**，其中 **2 条"正在运行"** |
| 再点 1 次 | true | 15 | **不收起**（见下） |
| 按 Esc | **false** | **1** | **收起成功** |

**收起行为已定性（不再是 INCONCLUSIVE）**：15:02 持锁重跑时逐级试了三种手势 —— 第二次点触发器**不收起**（`aria-expanded` 仍为 true）、**Esc 能收起**（`aria-expanded → false`、treeitem → 1）。所以先前那次"再点不收起"**不是探针手势问题，是真实 UI 行为**：该抽屉关闭靠 Esc/外部失焦，而不是触发器二次点击。这一条从 INCONCLUSIVE 改判为**已定性**。
（行数 14→15、子代理 13→14 的差异是因为审计期间该会话又新增了 1 个子代理，不是渲染不稳定；两次 `runningRows` 均为 2。）

- 展开出的 2 条 running 子代理与宿主 `runningSubagentCount=2`、触发器 `aria-label="2 个子代理，正在运行"` **一致** → 这是 B1 聚合字段在客户端 UI 的**端到端消费证据**（此前只有宿主侧字段，没有 UI 侧验证）。
- 视觉交叉核对（独立读 `raw/drawer5-1.png`）：确认抽屉是**浮层 popover**（宽约 340–350px、挂在「N个子代理 ⌄」药丸下方，覆盖在消息流之上），逐行有绿点 + 标题 + 状态行 + 右侧 token 指标；截图中可见 **11 行**（抽屉可滚动，**2 条"正在运行"的行在可见折线之下**）。DOM 读数是 15 个 treeitem = 父行 + 14 子行，两者不矛盾（差异是滚动可见区）。
- 全程 **0 error**。
- 触发器文本 "N 个子代理" 来自 `dsh-client-ui-subagent` 自己的 catalog（与宿主 `runningSubagentCount` 是**两个独立数字**，不要混用）。

---

## 6. 宿主半的"生效"边界（必须与客户端半分开读）

| 层次 | 证据 | 结论 |
|---|---|---|
| 能加载 | 重启后 `/usage/status` 等 10 个只读面 **310/310 ok**；无 ReferenceError 迹象；bootstrap 首扫在 14:37:06 成功 | ✅ 已证实 |
| 代码路径行为 | 我**独立复跑** host-harness：用**真实 deployed index.js** 作被测件 → **13/13 PASS**；用 pre-image 作反证 → **7/13 FAIL**（证伪能力成立） | ✅ 已证实 |
| 活体实效（卸载保护） | **未验证**：只读条件下无法让宿主真正卸载/重激活该插件（见 §7） | ⚠️ **未生效验证** |

harness 复跑细节（原始件 `harness/result-candidate.json`、`harness/result-pre.json`，我复制运行以保证不写原目录）：
被替换的只有 4 个边界依赖（db / ingest-dsh / ingest-cc / rpc）桩；被测件是部署件本体（sha256 `743469a5…`，与 `candidate/index.js` 逐字节相同）。关键用例：正常路径"恰好一个存活 45s timer"PASS；"卸载于 open 期间"pre-image 4 项全挂而 deployed 4 项全过。

> ⚠️ **不要因为 `/usage/status` 返回 ok 就宣称生命周期守卫已生效**。`ok:true` 只证明插件加载成功、RPC 通；dispose 守卫的触发条件是"宿主卸载/重激活插件"，本轮**没有也不允许**制造该条件。

---

## 7. 明确"验证不到的东西"

1. **插件卸载路径（R4 host 半的核心场景）无法活体验证。** 触发条件是宿主 dispose/重激活该插件 fiber（改配置、卸载重装、重启宿主）。只读纪律下不可做，本轮未做。**只能引用 code + harness**：我独立复跑 deployed 13/13、pre-image 7/13。同理"卸载于 open/首扫 await 期间""ensureSchema 抛错""dispose 后 ingest 不再执行"四个场景在活体上**全部未触发**。
2. **"卸载后飞行中响应回写"的客户端定向哨兵未做。** `--label verify` 覆盖的是"旧响应覆盖新筛选"（含 6s 延迟的旧批次），不是"组件已卸载后 in-flight 响应 setState"。§3.5 的 tab 往返只证明了"重挂载后卡片仍活"（派生证据），**没有**注入"卸载后才送达"的响应。
3. **45s tick 内的 host p95/max 无法测量**——观测窗内没有 tick（§4.3）。任务要求的"跨至少一个自然 45s ingest tick"**未达成**，替代产物是"这个窗口内根本没有 tick"这一事实本身。
4. **ingest tick 失效的机制未定性**（timer 未触发 vs fold 每次抛错）：插件日志不落盘、`ctx.setInterval` 内部不可观测、`/proc/<pid>/io` 不可读。**只记录现象与 pre-R4 基线，不归因。**
5. **长停顿（10–22.6s）的成因未归因**：无法与 ingest 对齐（无 tick），且本档自身就跑在被审计宿主里，观测含自负载。
6. **设置页卡顿主成本项**：本轮完全未测（不属于 R4 范围）。本轮 8 标签探针只记了点击耗时与错误数，**不是**帧率/CPU profile 证据，不能用于任何"设置页卡顿"结论。
7. **R7/R6/R5/P2/R1/R3** 未测、未动（R4 范围外）。
8. **未测 `/usage/refresh`**（会写 DB，违反只读），因此"手动 refresh 路径在 dispose 后的行为"仅有 harness 用例 5 的代码级证据。
9. **`dsh.usage` 设置命名空间的读写未测**（P0-b 行为开关）——避免改配置。
10. **"浏览器窗口全程持锁"这一条只对重跑窗口成立。** 本档早期四个浏览器窗口未持锁（§0.1 已披露），且持锁期间仍有他线浏览器在跑（锁并未被所有线遵守）→ **受并发影响的计时数字（标签耗时、host wall time 绝对值、session.list p50/p95/max）不能当作干净基线**；确定性判据（哨兵值、错误计数、DOM 谓词）两次窗口一致，仍是可信的。
11. **已闭合的两项（原列为缺口）**：趋势曲线像素级确认（`raw/clean-trend-panel.png` + SVG 结构，§3.4）与子代理抽屉收起行为（Esc 可收起、二次点击不收起，§5.4）。

---

## 8. 对既有文档的更正

| # | 原说法 | 更正 |
|---|---|---|
| 1 | `settings-jank-revise-exec.md` §2：「14 处锚点」 | 实为 **15** 处（其自身枚举 C1–C10 + H1–H4 + H3a）。算术笔误 |
| 2 | 交接文档：source 与 deployed「契约一致」 | 仅在 **R4 守卫语义**上一致；deployed 是**功能超集**，source 缺 hourly / trend gear / settingsScope / peakRing（§2.3 令牌计数） |
| 3 | 潜在误读：deployed 的 `calls.slice(0, 6)` 是"多余防御" | 它是**第 7 个 hourly 调用不入闸门**的必要条件；照抄 source 的 `calls.every(...)` 会让旧宿主上整卡空白（§2.2） |
| 4 | 既有报告隐含"宿主 45s tick 在跑" | 本宿主上 **tick 从未跑第二轮**（≥19 分钟），且 pre-R4 基线同样陈旧（§4.3） |
| 5 | `settings-jank-audit-host-loop.md:96` 的"对齐尖峰与 lastIngest" | 当前无法执行（无 tick）；该条应先改判为"tick 不存在"再谈对齐 |

---

## 9. 原始证据索引

| 文件 | 内容 |
|---|---|
| `raw/environment.txt` | PID/启动时间、两文件 sha256+sha1、下发件 sha1、注入 rev、pre-image sha256、DB mtime、标记数 |
| `raw/home.html`、`raw/served-client.js`、`raw/bundle.headers` | GUI HTML（含注入 rev）、下发 bundle 本体、响应头 |
| `raw/deployed-client.js`、`raw/deployed-index.js`、`raw/deployed-index-for-harness.js` | 部署件只读副本（供离线复核） |
| `raw/anchors.json` | 15 处替换点逐处判定 + source 契约对照 + 8 项超集令牌计数 |
| `raw/client-stale-verify.json` | 客户端守卫端到端判定（PASS） |
| `raw/host-probe.json`、`raw/host-probe.log` | 31 轮 × 10 只读调用 wall/ok + lastIngest 采样 + 会话条目采样 |
| `raw/host-cpu.json`、`raw/host-cpu.log` | 宿主 CPU 2s 采样（含"IO 不可读"这一限制） |
| `raw/session-list.json` | session.list 结构哨兵（条目/顶层/字段覆盖） |
| `raw/regression.json`、`raw/regression.log`、`raw/tab-1..8.png` | 8 标签切换 + 卡片普通挂载 + 6 次选择器切换 + 4 次卡片 tab；`tab-3.png` 另经独立视觉模型交叉核对（§3.4） |
| `raw/drawer.json` / `drawer2` / `drawer3` / `drawer4` / `drawer5.json` + `drawer5-*.png` | 子代理抽屉定位过程与展开判定（含 3 次失败的如实记录）；`drawer5-1.png` 另经独立视觉模型交叉核对 |
| `raw/clean-rerun.json`、`raw/clean-trend-panel.png`、`raw/clean-usage-card.png` | **持锁窗口（15:01–15:03）**复跑：卡片 7 指标复现、趋势面板 SVG 结构与元素级截图（曲线像素确认）、6 次切换复现、抽屉展开+Esc 收起 |
| `acquire-probe-lock.sh`、`release-probe-lock.sh` | 跨线浏览器独占锁的获取（原子 mkdir + 20–40s 退避 + 严格抢占闸门）与释放（先删 owner.txt 再 rmdir） |
| `raw/browsers-before-lock.txt`、`raw/browsers-during-lock.txt` | 持锁前/持锁期间他线 playwright 实例现场（证明"持锁 ≠ 真独占"） |
| `raw/explore-gui.json` | 设置页标签结构探查 |
| `harness/result-candidate.json`、`harness/result-pre.json` | 我独立复跑 deployed 13/13 与 pre-image 7/13 |
| 复跑脚本 | `verify-anchors.mjs`、`host-probe.mjs`、`host-cpu-sampler.mjs`、`session-sentinel.mjs`、`regression-probe.mjs`、`drawer-probe*.mjs`、`explore-gui.mjs`、`clean-rerun.mjs` |

## 10. 对外的建议措辞

- ✅ 可以说：**「R4 已部署并重启加载；client bundle 下发字节与磁盘/候选产物逐字节一致；客户端守卫经真实浏览器端到端验证通过（旧响应不再覆盖新筛选）；15 处补丁替换点逐处核实、超集功能完整；宿主只读面 310/310 全绿；宿主守卫代码路径在独立复跑的行为测试中 13/13（pre-image 7/13 反证）。」**
- ✅ 必须同时说：**「宿主半的卸载保护在活体上未触发、未验证；45s 周期 ingest 自上电起从未成功跑第二轮（≥22 分钟，且 pre-R4 基线同样陈旧），机制未定性——这是记录到的活体异常，不是 R4 引入，但也不能声称定时器在按周期工作。」**
- ✅ 跨线测量纪律需说明：**「浏览器复跑窗口（15:01:20–15:03:16，116s）全程持 `.probe.lock`、无抢占；但本档早期四个浏览器窗口在锁纪律下达前已跑完，未持锁；且持锁期间仍有他线浏览器在运行（锁未被所有线遵守）。受并发污染的计时数字不可当基线，确定性判据两次窗口一致。」**
- ❌ 不能说：**「R4 生命周期守卫已生效」「宿主 ingest tick 正常」「设置页卡顿已修复」。**
