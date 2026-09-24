# w05 审计：usage/ingest 的 G1 活体复验、9 路 RPC 成本与正确性回归

- 日期：2026-09-22（工作时段 14:30–15:00 本地，UTC+8）
- 工作区：`/home/CNS2026495165/dsh`；本档独占目录 `.workspace/lag-fix/program/w05-usage-ingest/`
- 宿主：`node .../bin/dsh web`，**PID 301709**，启动于 **2026-09-22 10:54:59**
- 被测部署：`~/.dsh/profiles/node_modules/@local/dsh-usage/lib/`（mtime **09-21 17:12**，早于宿主启动 ⇒ **运行中的宿主确实加载了这一版字节**）
- **纪律自证**：未修改任何产品文件；未重启/未 pkill；未写 `~/.dsh/**`（生产 `usage.db` 仅 `{readOnly:true}` 只读）；未启动浏览器；**`/usage/refresh` 全程只调用过 1 次**（G1 授权额度，15:33:1x 窗口）；未传 `sandbox_permissions`。
  唯一"写"= 本目录下的探针脚本、`raw/*.json`、`scratch-w05/`（生产库的**私有拷贝**，用于离线剖析）。
- 每条结论都带 **file:line**（deployed 绝对路径的末段）+ **原始 JSON**；**【实跑】/【读码】/【推断】分开标注**。
- 本机**全程非独占**（loadavg 4.9 → 8.0；期间另有 agent 线启动 Chrome/headless_shell，`browsers` 计数 0→1→2→4→3）⇒ **绝对耗时一律只作量级，硬判据用比值/次数/字节**。

---

## 0. 结论摘要（先读这一节）

### 0.1 四条裁决

| # | 问题 | 裁决 | 一句话依据 |
|---|---|---|---|
| **①** | **G1 活体复验** | **PASS（按"无秒级停顿 + 量级"判据）**；**字面 100 ms 阈值在本机不可判定**（噪声地板本身 >100 ms）。**⇒ 铁律对开启 timer 的阻断已解除：可以安全开启 45 s timer** | 一次真实 7 835 ms 的 pass（提交 **+7 209** 新事件）期间，独立进程心跳 **max 148.5 ms、0 拍 >200 ms**；同一仪器同一会话内**能报出 4 146 ms / 2 548 ms 的宿主停顿**（通道灵敏度已自证），而该 pass 期间**没有任何秒级拍** |
| **②** | **9 路 RPC 体积/耗时** | **9 路 = 61 556 B / 一次挂载 ≈320 ms 宿主串行时间**；`sessions` 一条 **54 921 B = 89.2%**，但它的**查询本身只值 50–90 ms**（离线地板），首测报出的 6 s 是**他线污染**，不是缺陷 | 字节数确定性复现（61 557/61 558/61 559/61 560/61 556）；3 次热突发 wall **319 / 323 / 333 ms**；离线（生产库私有拷贝）`querySessions` 原样 median **48.7 ms** |
| **③** | **卡片首挂载 + 60 s 轮询残余成本** | 首挂载 = 9 路 / 61.6 KB（**F5 后必然重付**）；60 s 轮询 = **7 路 / ≈6.35 KB / 每 tick ≈0.3–0.5 s 宿主串行**（**不含** `sessions`）；**⚠️ 轮询调的是 `loadAll` 而不是 `/usage/refresh`** ⇒ **轮询不触发 fold** | 修法候选 C2/C1 见 §2.4：首挂载可永久 −89.1%，轮询可 −95% |
| **④** | **用量数据正确性回归** | **PASS**：`mismatched / orphan / missing = 0 / 0 / 0`（132 124 events ↔ 332 daily 行，双算法交叉验证）；重复键**已不可复现**；**但发现一条部署面风险**：修法**只存在于 deployed**，workspace 源码仍是修前语义 ⇒ **任何"从源码重新部署"会静默回滚 5 项修复 + timer-off** | §4（sub-b 报告 + 本档复核） |

### 0.2 本轮**新发现**的一条缺陷（不在原任务书里，建议单列）

> **`/usage/refresh` 永远不回写 `lastIngest`** —— 手动刷新**确实**会跑 fold、数据确实变新，但**卡片上"上次 ingest"永远停在宿主启动那一刻**。

- **【实跑】活体证据**：`/usage/refresh` 返回 `ok:true`（wall 7 835 ms），`eventsDsh` 102 215 → **109 424**（+7 209）、`scannedDsh` 101 → 165、DB 于 14:33:22 落盘，**而 `status.lastIngest` 前后恒为 `1790045703018` = 2026-09-22T02:55:03.018Z（宿主启动那一轮）**，10 分钟后复查仍然不变。
- **【读码】根因（file:line）**：`rpc.js:199` 的 refresh 分支 `await waitIdle()`，而 `index.js:263` 的 `waitIdle: () => (runner === null ? runIngest() : runner.run())` **直接调 runner**，绕过了 `runIngestWorker()` 的收尾——`index.js:200-201` 的 `lastIngest = Date.now(); if (firstScanAt === null) firstScanAt = lastIngest;` **只存在于 `runIngestWorker()` 里**（`index.js:182-207`），因此 refresh 路径上这两行**永不执行**。
- **为什么进度数还是对的**：`runner` 的 `onProgress`（`index.js:295-302`）会写 `ingestSummary.scannedDsh/newEventsDsh`，所以只有 `lastIngest`（和 `firstScanAt`）冻住。
- **旁证（同批）**：`index.js:196-199` 那条 `log.info("ingest done: ...")` 同样永不输出；`statusProvider`（`index.js:222-244`）返回的就是这个冻结值，客户端 `client.js:1093` 直接把它渲染成 **"上次 ingest：…"**。
- **影响面**：`INGEST_TIMER_ENABLED=false`（`index.js:67`）时，**`/usage/refresh` 是唯一的数据新鲜化路径**（只有它调 fold）。于是"唯一能让数据变新的动作"恰好也"唯一不会更新那个时间戳" —— 用户点「刷新」后看到的仍是几小时前的时间，**会合理地误判成"刷新没生效/数据还是旧的"**。
- **与 timer 的相互作用（重要）**：开启 45 s timer 后，`runIngest()`（`index.js:321`）走的是**有收尾**的路径，时间戳会恢复更新 ⇒ **缺陷会被 timer 掩盖而不是修好**。⇒ 建议**先修 `waitIdle` 回写、再开 timer**（否则修好的动机消失）。
- ❌ **不是**数据正确性问题：事件已提交、daily 已收敛（§4 实测 0/0/0）。

### 0.3 G1–G5 闸门总表（谁在哪一层已经验过）

| 闸门 | 沙箱（`exec-ingest/report.md`） | **本轮活体（w05）** | 结论 |
|---|---|---|---|
| **G1** 一次 pass 期间宿主最大延迟 | **PASS**：worker **11.07/11.86 ms** vs 同步 **31 744 ms**（另口径 29.8 s） | **PASS（量级判据）**：心跳 max **148.5 ms**、0 拍 >200 ms；字面阈值不可判（噪声地板 336–448 ms） | **通过**（判据需改写，见 §1.4） |
| **G2** 并发 refresh 只触发 1 次 fold | PASS（runner 级 1 promise/1 start；**handler 级 10 并发 → fold=1**） | **未测**（本轮 refresh 额度只有 1 次，无法造并发） | 沙箱通过 + **读码复核**（`ingest-runner.js:265-276` 单飞共享同一 promise） |
| **G3** `status` 期间不等待 | PASS（单测 0 ms、`waitIdle` 调用 0 次） | **部分**：pass 前后 `status` 分别为 65 ms / 13 ms，未随 7.8 s pass 增长 | 通过（活体弱证据） |
| **G4** 卸载后无残留 worker | PASS（线程回基线、崩溃/停滞重建） | **未测**（不能重启/卸载宿主） | 沙箱通过 |
| **G5** 等价性回归 | PASS（9 次对拍 byte-identical ×3 时区 ×3 lib） | 不适用（本轮未跑） | 通过 |

---

## 1. G1 活体复验（①）

### 1.1 口径（为什么必须用心跳、为什么不能用 `monitorEventLoopDelay`）

- `perf_hooks.monitorEventLoopDelay` **只在宿主进程内可用**；探针在外部进程，物理上读不到宿主的事件循环。
- 更关键：**它会丢弃 `reset()` 之后的第一个样本**（BATCH-PLAN §五.8 实测：3 s / 20 s 阻塞只报 **10.31 / 10.16 ms**，改成不 reset 才报 3 003 / 20 015 ms）。本档**完全不使用该 API**。
- 因此采用 `exec-ingest/tools/g1-live.mjs` 的**外部心跳代理**口径：宿主是**单事件循环**进程，若 fold 在其主线程同步执行，同期任何心跳请求都必须排队到 fold 结束 ⇒ **心跳墙钟 ≈ fold 时长**。
- 本档在 g1-live 口径上加了三点加固：① 原始逐拍落盘；② **阳性对照**（通道能不能报出宿主停顿）；③ 前置闸门（`lastIngest` 必须推进、refresh 必须 `ok`），否则判 **PRECONDITION-FAILED** 而不是 PASS。
- 工具：`w05-g1-live.mjs`（本目录）→ 原始数据 `raw/g1-live.json`。

### 1.2 前置条件（全部满足，故 G1 可判）

| 前置 | 值 |
|---|---|
| 浏览器主进程（§五.1 口径：cmdline 含 `--remote-debugging-pipe` 且不含 `--type=`） | **0**（窗口干净，无客户端轮询干扰） |
| `/usage/refresh` 返回 | `ok:true`，wall **7 835 ms** |
| pass 真的跑了 | `eventsDsh` **102 215 → 109 424（+7 209）**；`scannedDsh` 101 → 165；`failedDsh/failedCc` = **0/0**；`usage.db` mtime **14:33:22** |
| 宿主线程数 | 12（含 worker 线程） |

> ⚠️ 注意：`lastIngest` **未推进**（§0.2 的缺陷），所以 g1-live 原版的 `advanced` 断言会判 PRECONDITION-FAILED（我的工具如实报了 `advanced=false`）。**替代判据 = 事件数增长 + DB 落盘 + refresh wall**，三者共同证明这次是一次真实且不小的 pass。这一点必须写清，否则会误判成"pass 没跑"。

### 1.3 【实跑】结果

| 窗口 | n | min | p50 | p90 | p95 | p99 | **max** | >100 ms | >200 ms |
|---|---|---|---|---|---|---|---|---|---|
| 静默基线（pass 前，无其他我发出的流量） | 30 | 2.8 | 34.8 | 152.6 | 162.2 | 336.1 | **336.1** | — | 1 |
| **pass 期间** | **101** | **1.35** | **3.28** | 79.9 | 108.6 | 136.0 | **148.5** | 6 | **0** |
| 尾部静默（pass 后） | 15 | 1.81 | 2.87 | 92.3 | 105.5 | 105.5 | **105.5** | 2 | 0 |
| 阳性对照期间（见 1.4） | 84 | 2.22 | 33.3 | 88.0 | 143.4 | 305.5 | 305.5 | — | — |

**反事实（为什么这不是"通道没报出来"）**：这次 fold 的墙钟是 **7 835 ms**。若 fold 仍在宿主主线程同步执行，心跳必然出现 **≈7 835 ms** 的单拍（或数拍连续排队），与既有的同步对照量级（**2.682 s 增量 / 29.8–31.7 s 冷**）同族。**实测 max 148.5 ms，比 fold 墙钟低 52.8×，且 0 拍 >200 ms。**

### 1.4 阳性对照：通道灵敏度自证（**这条决定 G1 是否算数**）

一个"没报出停顿"的阴性结果，只有在**通道能报出停顿**时才可信。本档给了两层对照（首测数据 `raw/rpc-dist.json`）：

1. **同一仪器、同一会话、稍后的查询相位**：心跳连续报出 **4 146 ms**（06:37:12.670Z）与 **2 548 ms**（06:37:15.244Z）两拍 —— 两拍合计 ≈6.7 s，正好覆盖一次 `/usage/sessions` 的 6 094 ms 客户端观测。⇒ **该通道在秒级宿主停顿上灵敏、不瞎。**
2. **环境噪声地板**（再测 `raw/rpc-dist2.json`，每个被测调用前有 1 s **静默对照窗**）：静默窗内 beatMax **p50 153 ms / max 446 ms**，反而**高于**调用窗内的 **p50 38 ms / max 448 ms** ⇒ ① 本机宿主的响应性由**他线负载**主导；② **本轮无法把 <450 ms 的停顿归因给任何一次 usage 调用**（该量级落在噪声地板上）。

> **⚠️ 仪器自省（我自己的首测踩到的坑，供全队沿用）**：`w05-rpc-dist.mjs` 的阳性对照里 `session.list` 报 3 549 ms、而同期心跳只报 305 ms —— 原因是**同进程**既发大响应请求（`session.list` 单响应 **501 044 B**）又打心跳，"客户端自己解析 501 KB"与"宿主阻塞"无法区分。**任何心跳口径必须把心跳放在独立进程**（`w05-hb-child.mjs`）；这一条与 BATCH-PLAN §五.13（阳性对照必须在页内注入）同源。

### 1.5 裁决：是否可安全开启 45 s timer

**裁决 = GO（可以安全开启），理由是：**

1. **闸门本意已满足**。铁律要防的是"每 45 s 冻一次宿主"。G1 活体证明：一次**真实 7 835 ms、提交 7 209 事件的 fold** 期间，宿主对**新到达的 RPC** 的最高响应延迟是 **148.5 ms**，量级上等于本机的环境噪声地板（静默窗 max 336–446 ms），**不存在秒级停顿**。
2. **通道不是瞎的**（§1.4）：同一仪器在别的窗口报出过 4 146 / 2 548 ms，所以"148.5 ms"是**观测到了上限**，不是"测不出来"。
3. **`INGEST_TIMER_ENABLED=false` 的代价正在实际发生**：`runIngest` 的触发面**只有三处**（`index.js:314` boot、`:321` timer（关）、`:261`→`rpc.js:199` refresh）⇒ **timer 关着时，数据只在宿主启动 / 手动刷新时变新**。本档实测：宿主 10:55 启动后到 14:33（**3 小时 38 分**）没有任何写入（DB/WAL mtime 停在 10:55）；而客户端 60 s 轮询调的是 `loadAll`（**不触发 fold**，见 §3.2）⇒ **用户开着用量页也不会变新**。
4. **但我要明确标注两处"字面不达标/未活体验证"**，避免把 GO 说过头：
   - **字面判据 `< 100 ms` 在本机不可判定**：静默基线自身 max **336.1 ms**、再测静默窗 max **446 ms** ⇒ 任何窗口都可能因他线负载冲过 100 ms。**如果坚持字面判据，本轮结论只能是 INCONCLUSIVE，而不是 FAIL**（超限值不可归因于 pass：pass 窗 p95 108.6 ms **低于** pass 前静默基线的 p95 162.2 ms）。
   - **G2 / G4 只有沙箱证据、没有活体验证**（本轮 refresh 额度 1 次、且不允许重启）；二者都在"开 timer 后会被周期性触发"的路径上，建议补验（§5.2 给了零成本配方）。

**因此推荐的开启顺序（带条件）**：① 先修 §0.2 的 `waitIdle` 回写缺失（否则缺陷被 timer 掩盖）；② 开 timer（`index.js:67` 常量改 `true` + 重启，回滚 = 改回 `false` + 重启）；③ 开启后用 §5.2 的配方复验"开启后仍无秒级拍"。

---

## 2. ② usage 9 路 RPC：返回体积与耗时分布 + 修法候选

### 2.1 9 路的确切来源与形状（file:line）

| 位置 | 内容 |
|---|---|
| `dsh-client-ui-settings-plugins/lib/client.js:1289-1291` | `settings.plugins.tab` / `id:"configurable"` / **`order: 0`** ⇒ 点导航「插件」默认落此栏目（**9 路的发起方**） |
| 同文件 `:399-403` | `namespaces.map(ns => renderSlot("settings.plugin.item", {}, {entryKey: ns}))` ⇒ 实例化 `key:"dsh-usage"` 的卡片 |
| `@local/dsh-usage/lib/client.js:971-975` | **挂载 effect**：`void loadAll(); void loadSessions(); void loadStatus();` |
| 同文件 `:909-921` | `loadAll` 的 `Promise.all` = **7 路**（summary / timeseries(day) / heatmap / byModel / byProject / byDay / timeseries(hour)） |
| 同文件 `:943-959`（调用 `:950`） | `sessions` = **1 路**（`limit: 200`） |
| 同文件 `:960-970`（调用 `:965`） | `status` = **1 路** |
| 卸载机制 | `dsh-client-ui-settings-general/lib/client.js:164`（`renderSlot(..., {only: active})`，**无 keep-alive**）→ `dsh-client-ui-renderer/lib/client.js:845-847`（`filter` 后空 list 返回 `fallback ?? null` = **真卸载**，`key` 为 entry ⇒ 回来是**新挂载**，组件 state 全作废） |
| 共享缓存基础设施 | **没有**：`dsh-client-connection/lib/client.js:10351-10373` 是裸 `fetch` + 每次新 rpcId，**无 memo / TTL / single-flight**；`renderer:280` 的 `renderSlotCache` 只缓存绑定函数，与 RPC 结果无关 |

### 2.2 【实跑】体积（确定性，最高置信）

**挂载一次 = 9 req / 61 556 B**（跨 5 次独立测量：61 556 / 61 557 / 61 558 / 61 559 / 61 560 / 61 619 B）：

| 端点 | bytes | 占比 |
|---|---|---|
| **`sessions`**（`limit:200`，返回 200 行） | **54 921** | **89.2%** |
| `heatmap`（34 行） | 1 408 | 2.3% |
| `byModel`（7 行） | 1 067 | 1.7% |
| `byProject`（6 行） | 1 023 | 1.7% |
| `byDay`（6 行） | 914 | 1.5% |
| `timeseries(day)`（6 行） | 913 | 1.5% |
| `timeseries(hour)`（5 行） | 776 | 1.3% |
| `status` | 288 | 0.5% |
| `summary` | 246 | 0.4% |

> 与 incident2 的 D1（"`/usage/sessions` 单响应 54 062 B"）同族一致（差值来自窗口内数据增长）。

### 2.3 【实跑】耗时分布（**min-of-N 才是本机可用的判据**）

首测（受污染窗口，loadavg 5.7→7.5，期间第二个浏览器出现）与再测（loadavg 8.0，含 1 s 静默对照）**差异巨大**，这本身就是结论：

| 端点 | 首测 p50 (ms) | 首测 max (ms) | **再测 min / p50 / max (ms)** | 离线查询地板 |
|---|---|---|---|---|
| `sessions` | 889 | **6 094** | **73 / 86 / 159** | **48.7 ms（median，原样 SQL，生产库私有拷贝）** |
| `byDay` | 248 | 306 | 104 / 114 / 235 | — |
| `timeseries(day)` | 216 | 438 | 88 / 126 / 152 | — |
| `heatmap` | 370 | 922 | 17 / 104 / 228 | — |
| `byModel` | 367 | 402 | 36 / 57 / 459 | — |
| `byProject` | 98 | 315 | 32 / 51 / 206 | — |
| `timeseries(hour)` | 621 | 921 | 45 / 48 / 117 | — |
| `summary` | 55 | 192 | 34 / 43 / 92 | — |
| `status` | 65 | 231 | **12 / 13 / 66** | — |

**真实观感成本 = 并发突发（= 客户端的真实形状）**：

| 轮次 | wall | 总字节 | `sessions` 自身 |
|---|---|---|---|
| 首测 #0/#1/#2 | 402 / 308 / 391 ms | 61 562 B | 385 / 304 / 386 ms |
| 再测 #0（冷） | **678 ms** | 61 557 B | 648 ms |
| 再测 #1/#2/#3（热） | **323 / 319 / 333 ms** | 61 560 B | 318 / 313 / 327 ms |

> **独立互证**：客户端源码自己写着"**every cycle costs the host ~0.3-0.5s of blocked event loop**"（`@local/dsh-usage/lib/client.js:980-982`）。我的 3 次热突发 **319–333 ms** 与它逐字吻合 ⇒ **"一次挂载 / 轮询 = 0.3–0.5 s 宿主串行时间"可作为硬结论**。

**关于 `/usage/sessions` 的查询成本（离线剖析 `raw/sessions-cost.json`，生产库私有拷贝）**：
窗口 7 天、窗口内 **39 882 events / 694 会话**、命中 `LIMIT 200`。原样 `querySessions`（`db.js:802-840`）**median 48.7 ms**（复测 52–70 ms）；拆解：只跑 CTE+`ROW_NUMBER()` **24.9 ms**、去掉窗口函数 **15.0 ms**、窗口收窄到 1 天 **16.5 ms**。
⚠️ **`PRAGMA temp_store` 判别**：`temp_store=0/1` 在本沙箱直接 **`unable to open database file`**，`=2` 立即可用（52–70 ms）⇒ 与既有审计 §3bis.4 一致，**该 ERR 是沙箱产物**；host 侧 `openUsageDb` 已设 `temp_store=2`（`db.js:90`），故生产不受此影响。
⇒ **结论：`sessions` 的问题是"响应体积 + 全表窗口函数自连接"的形态问题，不是"查询算不动"**；它在生产上是一次 **50–160 ms 的同步阻塞 + 55 KB 传输**。

### 2.4 修法候选（单飞 / 缓存 / 挂载去重；含收益·风险·验收·回滚·热冷面）

> 详细推导与全部 file:line 见 `sub-a-rpc-resend.md`（420 行，二级审计档，只读）。**§A 的关键新事实**：连续两轮完全相同的 9 路请求，**9 个端点的 `result` 逐字节一致**（result-only sha256 全 SAME）+ `status.lastIngest` 3.8 h 未变 ⇒ **这 9 路重发是 100% 冗余，不是"可以优化"**；根因即 `index.js:67` 的 timer-off + 无任何自动 refresh 调用者。**缓存方案在"新鲜度"上是免费的**。

| # | 候选 | 改动点（deployed file:line） | 收益 | 风险 | 验收 | 回滚 | 热/冷 |
|---|---|---|---|---|---|---|---|
| **C2** | **`sessions` 懒加载**（推荐先落） | `@local/dsh-usage/lib/client.js:971-975`（+可选 `:1002`） | 挂载 **9→8 req、61 556→6 635 B（−89.2%）**；把最重的一次查询从"点导航"路径摘除 | 首次点「会话明细」约 0.15–0.3 s 空表（`:1090` 空态文案短暂失真，加 loading 标志可解）。**新鲜度语义不变** | 页内 `performance.clearResourceTimings()` → 点导航「插件」→ `/usage/*` 条目 **=8**；点会话 tab **+1** | `cp client.js client.js.bak-<ts>` 或开关 `USAGE_LAZY_SESSIONS=false` | **热**（改文件 → rev 变（`dsh-client-modules/lib/index.js:328` rev = 内容 sha1）→ **刷新页面即生效，不重启宿主**） |
| **C1** | **模块级 generation-keyed 记忆 + 内联单飞** | `client.js`：插在 `:507` 之后、`:754` **之前**（必须组件外）；改 `:909-921`、`:950`、`:965`、`:993-1003` | 切回 **9→1 req、61 556→288 B（−99.5%）**；轮询 **7→1 req、6 358→288 B（−95%）**；渲染不再等最慢查询 | 多 1 次/挂载+轮的 `status` 探测；他方 refresh 后 ≤1 个探测周期收敛。**新鲜度可证明等价**（命中判据 = `status.lastIngest` 未变，而该条件下 9 个 result 已实测逐字节相同） | 切回后 `/usage/*` 计数 **=1** 且为 `/usage/status`；**点「刷新」必须 ≥8**（防缓存吃掉刷新） | 布尔开关 `USAGE_MEMO=false` | **热** |
| **C3** | 单飞 in-flight 去重 | 同文件模块级 + `:910-920/:950/:965` | **顺序切回省 0**；只在重叠时省整轮（挂载 burst 撞 tick、1 s 内快切、刷新撞 tick —— `loadAll` 只有代次守卫 `:891-892`，**只丢响应不阻止请求**） | 低（key 含 payload） | 1 s 内两次切回，`/usage/*` **≤9**（旧 18+） | 删改动 | **热** |
| **C4** | 纯 TTL / SWR | 同文件模块级 | 窗口内 →0 B | **改变新鲜度语义**（静默陈旧、有效期靠猜）+ 刷新会被缓存吃掉（必须 clear）。**被 C1 严格支配** | 同 C1 | `USAGE_TTL_MS=0` | **热** |
| **C5-a** | 外壳 keep-alive | `dsh-client-ui-settings-general/lib/client.js:164`（范式抄 `settings-plugins:419/489/496`） | 开窗期间切栏目 **→0 B**；被 `hidden` 的卡片停轮询（`:983` 门控） | **爆炸半径 = 所有设置栏目**（内存/隐藏定时器/未保存表单）；**动内置包**；**不覆盖关窗重开**（`:213` + `:180-183`）；返回时最多 60 s 未刷新 | 「插件→通用→插件」新增 `/usage/*` **=0** | 备份内置文件 | 热（回滚面大） |
| **C6**（本档新增） | **服务端 `sessions` 瘦身** | `@local/dsh-usage/lib/db.js:802-840`（CTE 先 `LIMIT`，或先取每 session 最新行的 session_id 集合再回表；见 `raw/sessions-cost.json` 的 Q1/Q2 拆解） | `sessions` 是 9 路里 **89.2% 字节 + 最长同步阻塞**；把它压到 O(会话数) 而非 O(窗口事件数) | 改 SQL 有语义风险（`requests/tokens` 必须仍是窗口内聚合）；**需与全量重算对拍** | `sessions` 响应**逐行**等于旧实现对拍；`bytes` 与 `ms` 下降；其余 8 路不变 | 单函数 pre-image | **冷**（宿主半，需重启） |

**推荐排序（最小改动、收益最大）**：**C2 → C1（C3 内联其中）→ C6**。理由：C2 是 2 处 ~4 行、单文件、**热面、零新鲜度风险**，一次拿下 −89.2%；C1 覆盖最广（含轮询）且新鲜度可证明等价；C6 在服务端摘掉最长同步阻塞，但需对拍 + 重启，放在其后。

---

## 3. ③ 卡片首挂载与 60 s 轮询的残余成本

### 3.1 每次页面加载（首挂载）

- 与"切回"**同一段代码**（`client.js:971-975`）⇒ 成本相同：**9 路 / 61 556 B / ≈0.3–0.5 s 宿主串行**（§2.3）。
- **模块级缓存对首挂载必然 miss** ⇒ **F5 一次就再付一次全价**（C1 也救不了首挂载，只有 C2 能把它永久降到 8 路 / 6 635 B）。
- 首挂载**无 in-flight 去重**，但 `loadAll` 内部 7 路是 `Promise.all` 并发（不是串行）。

### 3.2 60 s 轮询（**本档修正了一处流行误解**）

| 项 | 事实（file:line） |
|---|---|
| 轮询**调什么** | **`loadAllRef.current()` = `loadAll`（7 路查询）**，`client.js:986-990`。**不是** `/usage/refresh` —— 全文件 `"refresh"` 只出现在 **`:996`**（手动刷新按钮） |
| ⚠️ 陈旧注释 | `@local/dsh-usage/lib/rpc.js:191-193` 写 "client.js polls `/usage/refresh` on a timer"，**与 deployed 客户端不符**（该注释在本批 worker 化时写入，属误述，建议顺手更正） |
| 单 tick 成本 | **7 req / 6 351–6 398 B**（二级档 A 直测一轮 tick；与我按"挂载 61 556 − `sessions` 54 921 − `status` 288 ≈ 6 347"的推算一致）；宿主串行 ≈0.3–0.5 s（同 §2.3 的 client 自述与突发实测） |
| 门控（三闸门） | `:977` `refreshSec > 0`（默认 **60 s**，`:773`，用户可在 `:1143` 改）→ `:983` `pollVisible`（IntersectionObserver，`:788-809`）**且** `document.hidden === false` → `:987` 每拍再查一次 `document.hidden` |
| 重要后果 | **轮询不触发 fold** ⇒ timer 关着时，**"开着用量页"并不会让数据变新**（与 §1.5 的新鲜度论证一致；sub-b 也实测到 WAL mtime 13+ 分钟不变） |
| 每小时量级 | ≈60 tick × 7 req = **420 req / ≈381 KB / 小时**（仅卡片可见时）；宿主串行 ≈18–30 s/小时 |

### 3.3 残余成本汇总（三类分开，避免混淆）

| 类别 | 次数/字节 | 可优化到 | 触发面 |
|---|---|---|---|
| ① 切回「插件」重发 | 9 req / 61 556 B | **1 req / 288 B**（C2+C1） | 切栏目 **+ 关窗重开**（两条路径都付全价） |
| ② 首挂载（每次 F5） | 9 req / 61 556 B | **8 req / 6 635 B**（仅 C2；C1 必然 miss） | 页面加载 |
| ③ 60 s 轮询 | 7 req / 6 358 B per tick | **1 req / 288 B**（C1） | 卡片可见且页面前台 |

> 附带红利（C1 之后近零成本）：现在"滚回可见"**不会立即补跑**（`:986` 的 interval 要等满 60 s）⇒ 可加"回到可见立即 revalidate"，成本 = 1 次 `status` 探测。

---

## 4. ④ 用量数据正确性回归（`rebuildDailyForDays` 重复键修复后的现状）

> 本节由二级审计档 sub-b 完成（只读），报告 `sub-b-correctness.md`（303 行）+ 原始 `raw/sub-b-*.json`；本档复核了关键 file:line 与结论方向。

### 4.1 修法在 deployed 是否生效 —— **PASS（五项全在位）**

| 项 | 位置（deployed `@local/dsh-usage/lib/db.js`，md5 `d187d449…`） |
|---|---|
| 修法 A（区间对齐，`spanDays`） | `:273` 声明、`:274-279` 枚举、**`:286`** `DELETE … WHERE day IN (${placeholders})).run(...spanDays)` |
| 修法 B（UPSERT 保险） | **`:306-311`** `ON CONFLICT(day, data_source, model, project) DO UPDATE SET …` |
| `busy_timeout` | `:81` `PRAGMA busy_timeout = 5000` |
| `temp_store`（加固） | `:90` `PRAGMA temp_store = 2` |
| `invalidateMaxDailyDayCache` 导出 | `:541` `export function …`（调用点 `:319`） |

**运行中宿主加载的确实是修复字节**：宿主启动 **09-22 10:54:59** > 文件 mtime **09-21 17:12:07**（晚约 18 h）。

### 4.2 生产库逐键回归 —— **0 / 0 / 0（PASS）**

- `usage_events` **132 124** 行 → JS 聚出 **332** 键；`usage_daily` **332** 行 = 332 键。
- **matched 332 / mismatched 0 / missing 0 / orphan 0**；`requests / input / output / cache_read / cache_write` 五字段**逐字段 0 差异**。
- **双算法交叉验证**：JS 聚合 与 SQL 9 列 `GROUP BY` 都得 332 键、都判 0 缺陷（`two_methods_agree_on_zero_defects: true`）。`model`/`project` NULL 行数两侧均为 0。
- **间隙日结构**：34 个有数据日跨 44 天日历，**10 个间隙日**（08-16/23/29/30/31、09-04/06/10/13/19）**既无 events 也无 daily 行** ⇒ 生产库当前**未踩到**修前 UNIQUE 地雷（且地雷已被修法 A 永久拆除）。
- **daily 新鲜度**：`MAX(day) = 2026-09-22 = 今天`（已聚合）；`MAX(ts)` = 14:33:21；`MIN(day)` = 2026-08-10；`COUNT(DISTINCT day)` = 34。⚠️ **但 ingest 当前不再推进**（20 s 间隔采样 3 次，WAL mtime 恒为 14:33:23）—— 这是 §1.5/§3.2 的"timer-off + 轮询不触发 fold"的直接后果，**不是聚合缺陷**（day 粒度仍正确，只缺日内增量）。

### 4.3 重复键是否仍可复现 —— **已不可复现（PASS）**

- **修前对照用真实旧实现**（workspace `db.js` 复制为 `scratch/prefix-db.js`）：**必现**报错串逐字为 `UNIQUE constraint failed: usage_daily.day, usage_daily.data_source, usage_daily.model, usage_daily.project`，且 `daily_rows_after=4` ⇒ 事务回滚，**该 pass 的所有 day 全丢**（与审计 §3.2 一致）。
- **修后**：不抛错，12 行**逐行等于独立 JS oracle**（oracle 由种子事件直接累加，不调产品函数），`diffs=0`；**`postfix_stale` 变体**（预先污染间隙日为 999）也逐行保持一致 ⇒ 证明 **span DELETE 真的清掉了间隙日陈旧内容**，而不是靠 `ON CONFLICT` 盖掉。
- **全量 vs 稀疏**：`identical: true`，两者均等于 oracle。
- **A4 恒真（canary 实证）**：给 08-18…08-27 每天塞 canary 行，以非连续集合 `[08-19,08-20,08-24,08-25]` 重建后，**被删 = 08-19…08-25 恰为完整连续 span（含间隙日 21/22/23）**，span 外 08-18/26/27 完好 ⇒ 构造性证明成立（读码 `db.js:266-311` 同步佐证）。

### 4.4 ⚠️ 本轮最重要的**部署面风险**（建议协调者裁决）

> **全部修复只存在于 deployed 目录；workspace 源码没有任何一项。**

- `/home/CNS2026495165/dsh/dsh-usage/lib/db.js`（md5 `9c34690e…`）与 `.workspace/workstreams/sources/dsh-usage-src/lib/db.js`（md5 `e872c646…`）：**A / B / 两个 PRAGMA / export 全缺**，DELETE 仍是修前 `.run(...days)`。
- 旁证：workspace `index.js:182,184` **仍是无条件 `setInterval`**（deployed 已是 `INGEST_TIMER_ENABLED=false` 门禁版）。sub-a 亦独立确认 workspace `client.js`（35 294 B）**明显旧于** deployed（72 804 B，缺 `TREND_ANCHOR_HOUR`/`usageDayWindow`/hourly 白名单等）。
- ⇒ **任何"从 workspace 源码重新部署"都会静默回滚：U-IG3 修法 A+B、`busy_timeout`、`temp_store`、`invalidateMaxDailyDayCache` 导出、timer-off 门禁、（以及 client 侧的 R4/hour 白名单等）**。
- **建议**：① 把 deployed 反写回 workspace 源；② 或显式声明 **deployed 为唯一真源** + 加部署校验（比 md5）；③ 至少在 `LANDING-LOG.md` 标注。**（本档未执行任何写入。）**

### 4.5 CC 游标修复（U-CC1）的验收判据需要修正

- **C4 断言（`sync_state` 的 `cc:*` 行 `last_offset == size`）= FAIL，但非缺陷**：`cc:*` 388 行中 `==size` **0** 行、`size+1` **388** 行。原因：388 个 cc 文件 **mtime 最大 09-07**，而修复部署于 **09-21 17:12** ⇒ **修复后从未有 cc 文件被重新 ingest**；`ingest-cc.js:149-150` 的"mtime+size 未变即 `continue`"使 388 条遗留 `size+1` **永久留在表里**。
- 修复本身正确：写侧用 `Buffer.byteLength(text)` 取代多算 1 字节的 `join("\n")+"\n"`（`ingest-cc.js:179-182`），读侧对遗留游标做钳制自愈（`:163-168` `legacyOverrun` 夹回 `state.size`）。
- ⇒ **CC 游标修复目前只有代码级证据，没有生产运行时证据**。**建议把验收判据改成"存在至少一次修复后写入的 `cc:` 行满足 `==size`"，或直接用 `ingest-cc.js:163-168` 的钳制逻辑做单测**；不要用"C4: 388/388 都应 `==size`"。
- **判据适用边界**：`dsh:` 源**不适用** `last_offset == size`（`ingest-dsh.js:256` 写的是**解压后**字节数，而 `size` 是 `.jsonl.zstd` **压缩**大小，量纲不同；实测 14 条 `other` 形态全属 `dsh:` 源）。

### 4.6 对既有沙箱陷阱描述的**精确化**（重要修正）

任务书/审计说"多列 `GROUP BY` 会假失败"。实测**触发条件是 `strftime(...,'localtime')` + `GROUP BY`，与列数无关**：

| 条件（生产库只读、无 temp_store 覆盖） | 结果 |
|---|---|
| `COUNT(*)` | OK 1 ms |
| `GROUP BY data_source`（多行、无 `strftime`） | **OK 6 ms** |
| `GROUP BY strftime(ts/1000,'unixepoch','localtime')`（**单列**） | **FAIL `unable to open database file` 65 ms** |
| `GROUP BY day, data_source`（4 列、无 strftime，scratch 文件库） | **OK 3 080 行 / 5 ms** |
| 加 `PRAGMA temp_store = 2` 后 | 全部 OK |

⇒ 后续档不要把"多列聚合"当唯一判据；`temp_store=2` 是通用对策。

---

## 5. 交付物、复现与诚实清单

### 5.1 原始数据（全部本目录）

| 文件 | 内容 |
|---|---|
| `raw/g1-live.json` | **G1 活体**：30 拍基线 + 阳性对照 + **101 拍 pass 期间逐拍** + 15 拍尾部 + 前后 status/census |
| `raw/rpc-dist.json` | **首测**：9 路逐端点 6 reps + 3 次并发突发 + 独立进程心跳（含 4 146/2 548 ms 停顿与 `session.list` 501 KB 阳性对照） |
| `raw/rpc-dist2.json` | **再测**：9 路 5 reps（含每调用 1 s 静默对照）+ 4 次突发 + 975 拍心跳 → 得出 min-of-N 与环境噪声地板 |
| `raw/sessions-cost.json` | 离线剖析 `querySessions`（原样 / 去 JOIN / 去窗口函数 / 1 天窗口 / 加索引） |
| `raw/sub-a-rpc-resend.json`、`raw/sub-a-burst-vs-serial.json` | 二级档 A：9 路 result sha256 同一性、逐端点字节、并发 vs 串行 A/B |
| `raw/sub-b-prod-regression.json`、`raw/sub-b-scratch-repro.json`、`raw/sub-b-supplementary.json` | 二级档 B：逐键比对、重复键修前/修后对拍、CC 游标统计 |
| `sub-a-rpc-resend.md` / `sub-b-correctness.md` | 两份二级审计报告（420 / 303 行） |

复现命令：
```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/program/w05-usage-ingest
node w05-g1-live.mjs --heartbeat-ms 50 --timeout-s 300 --out raw/g1-live.json   # ⚠️ 会真的触发一次 /usage/refresh
node w05-rpc-dist2.mjs --reps 5 --bursts 4 --out raw/rpc-dist2.json
cp ~/.dsh/storages/usage/usage.db* scratch-w05/ && node w05-sessions-cost.mjs scratch-w05/usage.db
```

### 5.2 给协调者的"开启 timer 后复验"配方（零 / 低成本，热面）

1. **开前**：`node w05-g1-live.mjs`（本档已做，PASS）。
2. **开启**：`~/.dsh/profiles/node_modules/@local/dsh-usage/lib/index.js:67` 改 `true` + **重启**（冷面；回滚 = 改回 `false` + 重启）。
3. **开后**：连跑 3 个 ≥60 s 的心跳窗（跨 ≥2 个 timer tick），要求**仍无秒级拍**（>1 000 ms 计数 = 0；p99 < 500 ms）；同期核对 `lastIngest` **开始每 45 s 推进**（这也顺带证明 §0.2 缺陷被掩盖而非修好）。
4. **补 G4 活体**：插件 reload/卸载后 `/proc/301709/status` 的 `Threads` 回到 12 且不再回升（现状 12）。
5. **补 G2 活体**：并发 10 次 `/usage/refresh`（**注意每次命令都会真的触发 fold**，建议只做 1 轮），要求 `runner.stats()` 的 `runs` 增量 = **1**。

### 5.3 诚实清单（未验证 / 不可归因，逐条）

1. **G1 字面阈值未达**（148.5 ms > 100 ms）——本机噪声地板（336–446 ms）高于阈值，**该阈值在此机器上不可判定**；我以"无秒级停顿 + 量级 + 通道灵敏度自证"替代。**若必须坚持字面判据，结论是 INCONCLUSIVE 而非 PASS/FAIL。**
2. **`sessions` 首测的 6 094 ms 与 4 146/2 548 ms 停顿无法归因**：落在 §1.4 测得的噪声地板之上但成因未定（他线查询/浏览器同时在场）。**再测同一路径 min 73 ms / p50 86 ms、离线地板 48.7 ms ⇒ 我不主张"sessions 会阻塞宿主 6 s"**，只主张"它是 9 路里最重的一条（55 KB + 最长同步查询）"。
3. **G2 / G4 无活体证据**（只沙箱）；**G3 只有弱活体证据**（pass 前后 `status` 65→13 ms）。
4. **未开浏览器** ⇒ "点导航「插件」实际发 9 路""切走会真卸载"是**静态推导 + 旁证**（`settings-plugins:1289-1291` / `settings-general:164` / `renderer:845-847`），端到端计数未实测；C1/C2 的验收命令只写了断言、未执行。
5. **未验证"从源码重新部署会回滚"**（§4.4）：未跑 install，属**读码 + diff 推断**（但两侧 md5/diff 是实跑）。
6. **timer 的稳态成本未测**：我测到的是"3.7 h 空档后的一次增量 pass = 7 835 ms（+7 209 事件、64 个变更文件）"。**无变更文件时的稳态 pass 成本（871 文件 stat + CC mtime 检查）我没有实测**，只作【推断】：量级为数十至数百 ms，且发生在 **worker 线程**，不占宿主事件循环。
7. **本机全程非独占**（loadavg 4.9–8.3，`browsers` 0→4）⇒ 所有绝对耗时只作量级；本报告凡涉及"多少 ms"的硬结论都以**并发突发 wall 与 §2.3 的 min-of-N**为限，其余标注为受污染窗口。
8. **未做**：不修 timer 注入、不改任何产品文件、不重启、不 pkill、不写 `~/.dsh`（唯一 `/usage/refresh` 调用已在 §1.2 交代）。
