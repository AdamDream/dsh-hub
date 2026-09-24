# W06 子代理线审计报告：大规模派发的真实瓶颈 / 子代理会话存储与展示成本 / 派发路径同步阻塞 / 二级子代理与模型热载

- 日期：2026-09-22（午后）
- 工作区：`/home/CNS2026495165/dsh`；独占写入目录 `.workspace/lag-fix/program/w06-subagent/`
- 宿主：**PID 301709**（`node /home/CNS2026495165/.npm-global/bin/dsh web`，127.0.0.1:3080，已运行 3 h 57 m）
- **纪律声明（可复核）**：全程**只读**——未重启宿主、未 `pkill`、未改任何产品文件、未写 `~/.dsh`；工具调用**未传** `sandbox_permissions`。唯一的"写"是向宿主发**只读 RPC**（`session.list` / `subagent.list` / `host.describe`）与在本目录落盘产物。
- 授权二级子代理：**2 个**（分支 A = 存储/展示面；分支 B = 派发路径机制面），均已使用。
- 证据级别标注：**【实跑】**= 真文件字节 / 真实 RPC / 真实 CPU jiffies 观测；**【离线实跑】**= 用**真实实现**在无宿主负载下执行；**【只读推断】**= 仅由源码 file:line 推出。

---

## 0. 结论先行（每条带 file:line 或实测数字）

| # | 结论 | 级别 |
|---|---|---|
| **1** | **真实瓶颈是宿主那一个 JS 主线程，不是 CPU 核、不是模型并发、不是 SSE。** 本机 32 核、loadavg 4.9–7.7，但宿主 `tid==pid`（301709）主线程实测 **84.4 %**（20 s 窗）/ **95.1 %**（10 s 窗）忙；libuv 4 线程各 ~4 %。**"多少条并发开始互相拖慢"的拐点无法在 N≥1 定位——因为无本轮负载的基线窗主线程已 63.8–100.8 %（10 窗里 8 个 ≥88 %）⇒ 机器已经在拐点之后**（§2.3bis）。当时的现场条件就是 10–40 条区间（`runningSubagentCount` 合计 **16–34**）。饱和的两个签名：**吞吐不随 N 增长**（32–99/s，无单调性）+ **平凡请求 p50 从 29.5 ms 涨到 716.6 ms（N=32，24.3×）**。 | 【实跑】 |
| **2** | **主线程被"未被缓存的全量 corpus 扫描"吃掉**：`persistence.list()` 对 **1209** 条会话逐个做 per-session IO，**每次调用重付、无 memo**。它被 `session.list`（`dsh-host-apiproxy/lib/index.js:2255`）与 `subagent.list`（`dsh-subagent/lib/index.js:1874`）**各自**触发。 | 【实跑】+【只读推断】 |
| **3** | **该扫描的成本不是 IO 受限，而是"事件循环往返"受限**：离线无负载跑**真实实现**只需 **218.7 / 225.6 / 281.7 ms**（1209 条，≈0.18 ms/条）；分支 A 独立复刻并**数出真实 syscall = 6065 次异步 fs 跳**（3627 open + 1209 read + 1209 stat + 20 readdir），空载 **119.56 ms** ⇒ **空载 ≈0.02 ms/跳**。同一算法在饱和宿主上 `subagent.list` = **167.3 s ÷ 6065 = 27.6 ms/跳** ⇒ **逐跳队列延迟膨胀 ≈1400×，而跳数一个没减**。**等式：`list` 类 RPC 墙钟 = 6065 × 逐跳队列延迟。** | 【离线实跑】×2 +【实跑】 |
| **4** | `SUBAGENT_LIST_MAX = 200`（`dsh-host-apiproxy/lib/index.js:1231-1233`）**只截断"行"，不截断"扫描"**：实测 `session.list` 返回 **299 行 = 99 顶层 + 恰好 200 subagent**（截掉 910 条），但同一次调用**仍然读遍全部 1209 条 header**。⇒ 子代理会话从 782 涨到 **1110** 时，**每次 `session.list`/`subagent.list` 的成本都随之线性上涨，与截断无关**。 | 【实跑】 |
| **5** | **B1 的活体断言成立**：99/99 顶层行**全部**带 `runningSubagentCount`，合计 30–34（与非零 `Recv-Q` 的 3 条连接同时观测到宿主"发不过来"）。 | 【实跑】 |
| **6** | **settings 段热载是"真的"**，但**任务书假设被否定**：注册方是**树外本地插件** `@local/dsh-subagent-model`（`~/.dsh/profiles/node_modules/@local/dsh-subagent-model/lib/index.js:26,46`），由 `~/.dsh/profiles/web/cordis.patch.yml` 挂载；**只读 `@deepseek-ai/*` 包树会得到假阴性**。实测：09-20 14:15:19 前为 `v4.1-flash`，14:21:17 起 100 % 走 `v4-pro`，此后**零回退**。 | 【实跑】（分支 B） |
| **7** | **但存在真实静默失效面**：`settings.get()` 对未注册命名空间**返回 `undefined` 而不抛**（`dsh-settings/lib/index.js:388-390`）+ 消费方**静默回落 preset**（`dsh-tool-subagent/lib/index.js:124-127`）⇒ 一旦该本地插件未挂载，`dsh-subagent:` 段**完全失效且零告警**。 | 【实跑】+【只读推断】（分支 B） |
| **8** | **派发路径上没有任何全局并发闸门**。唯一硬闸门是"每 parent 每步 ≤10 个工具调用在飞"（`dsh-agent-loop/lib/index.js:231` 是闸门，默认 10 见 `:922`/`:988`；只管单步扇出）；`jobs` 闸门（默认 10，超限**直接 throw 不排队**）被本部署的 `backgroundMode: continuable` 落点**绕过**；出站 HTTP **无 socket 池上限**。⇒ 同时派发 40 条时**全部同时开跑**。 | 【只读推断】（分支 B） |
| **9** | **"派发即审批"边界不存在**：子代理审批策略在委派时**硬编码 `never`**（`dsh-subagent/lib/types/child-agent.js:180,194`），沙箱模式**继承父会话 override**（`dsh-subagent/lib/types/child-agent.js:179`）。`never` 下 `sandbox_permissions` **自动拒绝、不挂起** ⇒ 不构成派发路径上的阻塞点。 | 【只读推断】+【实跑旁证 25/25】（分支 B） |
| **10** | `maxDepth` 默认 **3** = 最大深度（顶层 depth 0，`childDepth > maxDepth` 才抛，`dsh-subagent/lib/types/child-agent.js:32-40`）；子代理**有** `subagent` 工具；二级子代理 `parentSession` **指向直接父**（中间层）。实跑 depth 分布 `{0:207, 1:592, 2:277, 3:29}`，**无 depth≥4**，血缘链 869/869 零违例 ⇒ `annotateRunningSubagentCounts` 的 BFS 跨层计数**正确**。 | 【实跑】（分支 B） |
| **11** | ⚠️ **修正既有报告（两处客户端热点都已修掉，引用已过时）**：① `dsh-client-runtime/lib/client.js:8576` 的 entryCache O(N²) 清理已被 `/* dsh-perf-fix P1 v1 */` 改成 Set-based O(N)（`:8576-8581`）；② `projectList()` 已移到 **`:9272-9361`**（既有报告写 `:9217-9283`）并带 `/* dsh-perf-fix P2 v1 */` 复用（`:9324-9332` / `:9335-9345` / `:9357`）⇒ **"`projectList` 每次造新 `ids`/`byId`"已不成立**。 | 【只读推断】（P2 行号由分支 A 提供） |
| **11b** | **侧栏根本不渲染子代理** ⇒ "200 条子代理行的 DOM 成本"这个问题**不成立**：`dsh-client-ui-workspace/lib/client.js:100-102` 的 `sessionVisible()` 首条判据就是 `session.origin !== "subagent"` ⇒ **侧栏 DOM 上限 = 99 条顶层行**。另：任务书所指的 `dsh-client-ui-sidebar`（321 行）**只是外壳**，真正的列表在 `dsh-client-ui-workspace/lib/client.js`（2465 行）。 | 【只读推断】（分支 A） |
| **11c** | **折叠有、分页/虚拟化无**：侧栏 per-group 折叠 `COLLAPSED_SESSION_LIMIT = 5`（`dsh-client-ui-workspace/lib/client.js:1039`；渲染 `:1404`；"展开剩下 n 条" `:1452-1460`），**但 flat「In one list」模式 `:222-233` 全量派生 + 全量 `map(sessionNode)`，无上限无虚拟化**。子代理目录**只按分支折叠**、同级列表全量（`dsh-client-ui-subagent/lib/client.js:226`），实测最坏父节点 **124 条直属子代理**。 | 【只读推断】+【实跑】（分支 A） |
| **12** | ⚠️ **观测者效应（本次测量自身的重要边界）**：测量期间有 **24 条**到 `:3080` 的 established 连接，**3–7 条出现非零 `Recv-Q`（402–417 B）** ⇒ 宿主**来不及消费入站请求**。同期在跑的本campaign 探针包括 `tools/probe-w01.mjs`、`probe-b.mjs`、`tools/look-arms.mjs`、`probes/run-btw-campaign.mjs`、`scripts/boot-causal.mjs`、`tools/bench-shiftbacklog-v2.mjs`。**因此 84–95 % 的主线程占用里含本 campaign 自己的探针流量**；这不推翻结论 1/2/3（它们是机制与量级，且方向对用户真实场景同样成立——GUI 每次连上就调 `session.list`），但**不得把 84–95 % 当成"用户日常基线"**。 | 【实跑】 |

---

### 0.1 任务书五问 → 结论索引

| 任务书要求 | 覆盖位置 | 一句话结论 |
|---|---|---|
| ① 宿主 CPU | §2.1 / §2.2 / §2.3bis | 主线程 **84.4–95.1 %**（基线窗 63.8–100.8 %）；32 核不是瓶颈，**一个 JS 线程是** |
| ① 会话创建/持久化 | §4.2 + §4.1 S8 | 每次 append = 5 跳 + **1 次 fsync**，200 ms 批量窗口；创建走 temp+fsync+rename+目录 fsync |
| ① 模型调用并发 | §2.4 | 出站 `fetch` **无池**（`dsh-llm-pi-ai/lib/index.js:2107`）⇒ 无池化排队；**不是**当前瓶颈，但是 100 并发的缺口 |
| ① SSE 推送 | §3.4 + §3.5(A4) | 三条通道**都不推全量列表**；`session/event` 按订阅过滤，但 `session/projection`（`:1849-1857`）**无过滤**；实测裸 GET 得 426（浏览器走 WebSocket） |
| ① GUI 侧列表更新 | §2.4 + §3.5 | `refreshList()` 只在 `handleConnected`（`client.js:8448`）触发且 single-flight；成员变更走单行 `mergeSummary` 增量 ⇒ **不是**风暴源 |
| ① **实测拐点（同窗对照）** | **§2.3bis** | **无法在 N≥1 定位拐点——基线窗主线程已 63.8–100.8 %，机器已在拐点之后**；饱和签名 = 吞吐不随 N 增长 + 平凡请求 p50 涨 24×（29.5→716.6 ms @N=32） |
| ② 782（今 1102→1110）条子代理的存储/展示成本 | §3.1–§3.5 | **200 上限只挡"行"不挡"扫描"**；服务端每次调用仍走 **6065 跳**；910 行（82 %）不上线；无全量列表推送；**侧栏根本不渲染子代理**（上限 99 行） |
| ② 是否有分页/折叠 | §3.4 + 结论 11c | 服务端有（200 上限）；客户端：侧栏**有 per-group 折叠（=5）但 flat 模式无虚拟化**，子代理目录**只按分支折叠、同级全量**（最坏父节点 124 条）；客户端 list = 299 行、snapshot O(N)（P1/P2 已修） |
| ③ 派发路径同步阻塞点（含 `subagent.list` 无 memo） | §4.1 S1–S11 | `subagent.list` **确证无 memo 全量重扫**（`dsh-subagent/lib/index.js:1830→1863→1874`）；主阻塞 = S1/S2/S3 |
| ④ settings 段热载是否真生效 | §5.1 | **是真生效**（4 重证据）；但**注册方在树外** ⇒ 只读产品包会误判；存在静默失效面 |
| ④ 派发边界审批 | §5.2 | **不存在派发即审批**；`never` 硬编码、沙箱继承父 override；`sandbox_permissions` 自动拒绝**不挂起** |
| ④ 二级子代理 | §5.3 | `maxDepth=3`（顶层 depth 0）；子代理**有** `subagent` 工具；二级 `parentSession` 指向**直接父**；实测无 depth≥4、血缘 869/869 |
| ⑤ 前三优化候选 + 100 并发前置条件 | §6 / §6.1 | C1（扫描 memo + 并发化，主判据 = **跳数**）> C2（把上限扩到扫描 + single-flight）> C3（全局闸门 + 投影广播过滤 + HTTP 池）；前置 P1–P8 |

---

## 1. 测量协议与口径（本轮遵守情况）

对照 `exec-audit/BATCH-PLAN.md` §五：

| 条目 | 本轮做法 |
|---|---|
| §五.1 并发按"主浏览器进程"计数 | 本轮**不涉及浏览器**（未启动任何浏览器，避免与并行 peer 抢用）；并发口径改为**宿主侧**：`/proc/301709/task/*/stat` 逐线程 CPU + `runningSubagentCount` 合计 |
| §五.2 每窗口起止采并发快照 | **做不到严格版**：单次 `session.list` 实测 0.3–9.4 s（饱和时更久），无法每档采两次。改为**整轮起止各一次**并在本报告显式标注（见 §6 未测清单） |
| §五.8 ELD `reset()` 陷阱 | **未使用** `monitorEventLoopDelay`（无法从外部注入宿主）。改用 `/proc` 逐线程 jiffies 差分 + 独立 RPC 探针延迟，规避该陷阱 |
| §五.17/18 存活判据、并发普查失明 | 本轮不取任何锁、不做浏览器并发普查 ⇒ 不受影响 |
| §五.19/20 帧口径 | 本轮不涉及帧 |

**同窗对照做法**：每档负载前先采一段**无本轮负载**的基线窗（主线程 CPU %），负载窗用 200 ms 间隔独立采样器统计主线程/其他线程 CPU %；CPU 归因一律给"进程总 CPU 窗值"（含其他线 ⇒ **上界归因**），并同时给"主线程 CPU %"作对照。

---

## 2. ① 大规模派发（10–40 条并发）的真实瓶颈

### 2.1 现场条件（并发快照）

| 项 | 值 | 来源 |
|---|---|---|
| `nproc` / loadavg | **32 核** / 4.91 → 7.69（1 min） | `/proc/loadavg` |
| 宿主线程数 / RSS | 12 threads / 3,479,420 kB | `/proc/301709/status` |
| **主线程（tid==pid）CPU** | **84.4 %**（20 s 无外部负载窗）→ **95.1 %**（10 s 窗，负载期） | `/proc/301709/task/*/stat` 差分 |
| libuv 线程池（tid 301711–301714） | 各 **3.6–4.0 %** | 同上 |
| 其他线程（301716–301719） | 各 **1.4–1.8 %** | 同上 |
| **running 子代理数** | **30 → 34**（整轮起止） | `session.list` 顶层行 `runningSubagentCount` 求和 |
| `session.list` 行数 | 299 = **99 顶层 + 200 subagent**（上限命中） | 同上 |
| 到 `:3080` 的 established 连接 | **24**，其中 3–7 条 `Recv-Q` **402–417 B**（宿主积压） | `ss -tn state established` |

> **判读**：`nproc=32` 而 loadavg < 8 ⇒ **CPU 核完全不是瓶颈**；宿主只有一个 JS 主线程，它已经 84–95 %。**这就是"拐点"的物理含义**：在 ~30 条 running 子代理下，主线程已无余量。

### 2.2 单位成本（实跑，同一时间窗、同一现场条件）

| 操作 | wall | 窗内宿主 CPU（全线程，上界归因） | 字节 | 备注 |
|---|---|---|---|---|
| `host.describe`（平凡 handler） | **1062.9 ms** | 1000.0 ms | 246 | 平凡请求也要 1 s ⇒ **排队延迟主导**，非自身计算 |
| `session.list` | **299.2 ms**（最好） | 320.0 ms | 503,903 | 唯一一次"较空"的窗 |
| `session.list` | **4631 ms** | 4130 ms | 503,909 | |
| `session.list` | **6087.1 ms** | 5460 ms | 503,228 | |
| `session.list`（首次 curl） | **9371.9 ms** | — | 501,094 | |
| `subagent.list`（parent 有 33 个子会话） | **16,243.5 ms** | 17,350 ms | 14,275 | 极端 |
| `subagent.list`（同上） | **46,393.8 ms** | 49,440 ms | 14,275 | 极端 |

原始 JSON：`raw/w06-rpc-sessionlist-3.json`、`raw/w06-rpc-measure.mjs`。

**分支 A 在同一时段（14:49–14:56，与我的扫描 14:52–14:56 交叠）独立测得的最坏值**（原始：`raw/A2-live-rpc.json`）：

| 操作 | wall | 字节 | 结果 |
|---|---|---|---|
| `session.list` #1 | **300,704 ms（300.7 s）** | 0 | **未返回**（status 0，连接未给出响应） |
| `session.list` | **194,594 ms（194.6 s）** | 504,267 | 200 OK |
| `subagent.list`（parent 有 88 个子会话） | **167,255 ms（167.3 s）** | 14,436 | 200 OK |
| `subagent.list`（parent 有 124 个子会话） | **11,213 ms** | 19,529 | 200 OK |
| **`host.describe`（在 167 s 的 `subagent.list` 飞行途中发出）** | **78 ms** | 250 | 200 OK ✓ |

> ⚠️ **A 的调用与我的扫描在 14:52–14:56 交叠 ⇒ 两者互相污染**（这是本报告 §8.3 观测者效应的具体形态）。但也正因如此，它给出了一条**最生动的实测**：**在 N=2–3 个并发全量扫描消费者下，同一个 `session.list` 从空载 0.22 s 涨到 167–195 s，并出现一次 >300 s 不返回。**
>
> 🔑 **同时这条 78 ms 是关键反证**：重扫描**并不霸占**主线程（它 await 让出）—— 平凡 1 跳请求在 167 s 的扫描飞行途中仍能 78 ms 返回。⇒ **慢的不是"主线程被这次扫描堵住"，而是"这次扫描需要 6000 次串行往返，而每次往返都要排在一个 ~20–30 ms 的队里"**（见 §2.3）。

> `host.describe` 的真实自耗时是 ~0.02 ms（无负载实测），却在同一时间窗里花掉 1.06 s ⇒ **该窗内主线程被别人占着**，这正是"并发互相拖慢"的直接证据形态：**每条请求的延迟 ≈ 自己的主线程需求 ÷ 可用份额**。

### 2.3 离线基线：同一个扫描在无负载下有多快

用**真实实现**（`Object.create(JsonlSessionPersistence.prototype)` + 真 `listArtifacts()`）在无宿主负载下跑 `~/.dsh/sessions`（只读）：

| rep | wall | 返回 artifacts |
|---|---|---|
| 0（含首次 `checkRootEncoding` 全量遍） | **281.7 ms** | 1209 |
| 1 | **218.7 ms** | 1209 |
| 2 | **225.6 ms** | 1209 |

⇒ 单次全量 header 扫描 ≈ **0.22 s / 1209 条 = 0.18 ms/条**（页缓存热）。

**同一操作在饱和宿主上 16.2–46.4 s ⇒ 膨胀 74–210×。**
原始 JSON：`raw/w06-offline-persistence-list.json`；脚本 `raw/w06-offline-persistence-list.mjs`。

> 🔑 **框架性对照（分支 A 提出，本报告采纳）**：`incident2/VERDICT.md:37` 记 B1 落地后 `session.list` 中位为 **0.166 s**；而本轮离线实测那趟全量走查本身是 **0.12–0.23 s**。
> ⇒ **B1 之后剩下的成本已经基本就是"这趟走查本身"** —— B1-perf 消除的是 O(N log N × events) 的比较器折叠（`:2241-2243`），而**走查一步都没动**。这直接决定候选的排序：**C1 是唯一能继续下压中位数的动作，C2/C3 都是防爆而非降中位。**

**膨胀机制（file:line 逐条）**：
`listArtifacts`（`dsh-session-persistence-jsonl/lib/index.js:1063-1093`）在**嵌套 for 循环里逐条 `await`**：

```
:1068  for (const dir of await this.listSessionDirs(project, signal)) {
:1070      const oppositeExists = await this.exists(opposite);      // await #1
:1073      const pathExists = await this.exists(path);              // await #2
:1078      const first = await this.readFirstZstdLine(path, signal) // await #3..n（open/read…/close）
:1083      await this.assertStoredIdentity(path, meta, void 0, signal);
```
- `readFirstZstdLine`（`:1279-1300`）自己还有 `open` → 循环 `read(8192)` → `decompressZstdFrame` → `close`（`:1300` 附近）。
- 1209 条 × ≈5 次 await ≈ **6000+ 次串行主线程往返**；**没有任何批处理/并发**（对比：`subagent.list` 的**冷身份解析**有 `COLD_READ_CONCURRENCY = 4`，`dsh-subagent/lib/index.js:1812`，但**枚举阶段没有**）。
- 全部会话都是 **zstd**（`session.jsonl.zstd`，1207 个 .zstd + 3 个 v3.jsonl.zstd），所以每条都要走 `readFirstZstdLine`（解压首帧），不是便宜的 `readFirstLine`。
- 主线程越忙，这 6000 次往返每次等待越久 ⇒ **成本 ∝ 1/(1−主线程占用)** ⇒ 正反馈。这就是"多少条并发开始互相拖慢"的**机制级答案**。

#### 2.3.1 逐跳成本被精确量化（本轮最强的机制证据）

分支 A 用**独立复刻**（`raw/A1-list-cost.json`）**数出了真实 syscall 条数**，把"约 6000 跳"从估算升级为计数：

| 项 | 值 |
|---|---|
| artifacts | **1209** |
| `open`（异步） | **3627** |
| `read` | **1209** |
| `stat` | **1209** |
| `readdir` | **20**（1 × root + 19 × project） |
| **异步 fs 跳数合计** | **6065** |
| 纯 readdir 地板 | 1.38 ms |
| A 的复刻实现耗时 | **中位 119.56 ms**（max 122.37） |
| **我的真实 class 耗时**（`raw/w06-offline-persistence-list.json`） | **中位 225.6 ms**（218.7 / 225.6 / 281.7） |

⇒ **空载逐跳成本 = 119.56 ms ÷ 6065 = 0.0197 ms/跳**（A 的复刻）；真实 class ≈ 0.036 ms/跳。**两者一致到同一数量级**（两套独立实现互证，A 的复刻更"瘦"，少几处 await）。

**同一算法在饱和宿主上的逐跳成本**：
`subagent.list` 实测 167,255 ms ÷ 6065 跳 = **27.6 ms/跳**。
⇒ **逐跳队列延迟从 0.02 ms 膨胀到 27.6 ms ≈ 1400×**，而**跳数一个没少**。

这条把 §2.5 的定性说法变成了等式：

> **`list` 类 RPC 的墙钟 = 6065 × 逐跳队列延迟。**
> 空载：6065 × 0.02 ms = **0.12–0.22 s**。
> 饱和（本 campaign 现场，主线程 ~100 %）：6065 × 27.6 ms = **167 s**。
> ⇒ **唯一的杠杆是"减少串行跳数"（批处理/并发/memo），不是"让 IO 更快"** —— IO 已经够快，排队才是全部。

### 2.3bis 受控并发扫描（实跑，同窗对照）——**结论：本环境下量不出"拐点"，因为已经过拐点**

两轮受控扫描，负载单元 = `host.describe`（**平凡 handler，无负载实测自耗时 ~0.02 ms**），每档前先采 1.2 s **无本轮负载**基线窗，负载窗内用 200 ms 采样器记逐线程 CPU。原始 JSON：`raw/w06-sweep-cheap.json`、`raw/w06-sweep-knee.json`；脚本 `raw/w06-concurrency-sweep.mjs`。

**扫描 A（levels 1,8,16,32,40；probe gap 40 ms）**

| N | **基线窗主线程 CPU %**（无本轮负载） | 负载窗主线程 % | 负载 RPC p50 (ms) | p50 相对 N=1 | max (ms) | **吞吐 (完成/s)** | 探针 n | 探针 p95 (ms) |
|---|---|---|---|---|---|---|---|---|
| 1 | **100.8** | —（窗太短） | 29.5 | 1.00× | 29.5 | 32.3 | 1 | 7.2 |
| 8 | **99.7** | — | 102.1 | **3.46×** | 144.8 | 53.3 | 3 | 49.9 |
| 16 | **98.9** | 87.5 | 186.5 | **6.32×** | 411.1 | 38.5 | 5 | 133.1 |
| 32 | **99.8** | 84.9 | 716.6 | **24.29×** | 970.0 | 32.7 | 9 | 394.5 |
| 40 | 87.7 | 87.5 | 287.2 | 9.74× | 393.3 | 99.5 | 6 | 113.3 |

**扫描 B（levels 1,2,4,8,16；probe gap 0 ms，意在加密探针采样）**

| N | 基线窗主线程 % | 负载窗主线程 % | 负载 RPC p50 (ms) | max (ms) | 吞吐 (完成/s) | 探针 n | 探针 p95 (ms) |
|---|---|---|---|---|---|---|---|
| 1 | 63.8 | 98.0 | **735.3** | 735.3 | 1.4 | 1 | 702.1 |
| 2 | 93.7 | — | **33.1** | 33.1 | 57.1 | 1 | 18.3 |
| 4 | 88.8 | 100.5 | 291.3 | 329.7 | 12.0 | 3 | 183.3 |
| 8 | 92.7 | 100.0 | 242.1 | 345.6 | 23.0 | 5 | 86.9 |
| 16 | 98.7 | 95.0 | 179.6 | 252.0 | 62.5 | 4 | 37.4 |

**判读（必须连同噪声一起读）**

1. **两轮都"已经在拐点之后"**：**无本轮负载**的基线窗里，宿主主线程就已经 **63.8 – 100.8 %**（10 个基线窗里 8 个 ≥ 88 %）。⇒ **本环境没有任何窗口存在空余主线程**，因此**不存在可测量的"从哪天开始互相拖慢"的拐点** —— 拐点在 N=1 以下。
2. **吞吐完全不随 N 增长**：扫描 A 的完成率 32.3 / 53.3 / 38.5 / 32.7 / 99.5（无单调性，`Spearman` 都谈不上）；扫描 B 为 1.4 / 57.1 / 12.0 / 23.0 / 62.5。⇒ 加并发**只加延迟不加吞吐**，这是饱和的教科书特征。
3. **延迟随 N 显著上升**：扫描 A 的 p50 从 29.5 ms（N=1）涨到 **716.6 ms（N=32）= 24.3×**；最大 970 ms。
4. ⚠️ **噪声极大，且噪声源是外部而非 N**：扫描 A 的 N=1 是 **29.5 ms**，扫描 B 的 N=1 是 **735.3 ms** —— **同一 N、相邻两轮差 25×**；扫描 B 的 N=1(735 ms) > N=2(33 ms)、N=16(180 ms)。⇒ **本环境的方差主要来自并行 peer 线**，不是被测自变量。因此**本报告不把这两轮当作干净剂量-响应曲线**，只作为"已饱和"的证据。
5. **预注册阈值无法判定**：扫描前注册的 T2（负载 p50 ≥ 2× N=1）在 N≥8 全部**满足**，但 T1/T3 因噪声与探针样本量（n=1–9）不足**判为 INCONCLUSIVE**，按纪律**不得**当通过。
6. **同期顺带测到的最坏值（含分支 A 的独立测量）**：扫描 A 结束时采 `session.list`（并发条件快照，cap 30 s）→ **wall 25,885 ms / 窗内宿主 CPU 37,080 ms**（当时 `runningSubagentSum = 16`）；扫描 B 的起始快照**撞满 30 s cap 被 abort**。分支 A 在同一时段（14:49–14:56，与我的扫描 14:52–14:56 **交叠**）测得 `session.list` = **194.6 s** 与 **300.7 s 不返回**，`subagent.list`(88 子会话) = **167.3 s**。⇒ 在线宿主上单次 `session.list` 的实测域是 **299 ms … 9.4 s … 25.9 s … 194.6 s … 300.7 s（不返回）**，与离线 0.22 s 相比 **最大膨胀 >1300×**。
   ⚠️ **A 与我在 14:52–14:56 互相污染**（§8.4 观测者效应的具体形态）；但也正因如此得到一条最生动的实测：**N=2–3 个并发全量扫描消费者下，同一调用从 0.22 s 涨到 167–195 s。**

> **为什么没有做"40 条真派发"的曲线**：授权上限是 2 个二级子代理，且派发真代理会写 `~/.dsh/sessions`（越出只读授权）。见 §8.1。

### 2.4 已排除的候选项（不是瓶颈）

| 候选 | 判据 |
|---|---|
| **CPU 核 / 内存** | 32 核、loadavg < 8、RSS 3.5 GB ⇒ 排除 |
| **模型调用并发**（provider 限流/连接池） | 出站 HTTP **无 `keepAlive`/`maxSockets` 上限**（分支 B：`dsh-llm-pi-ai/lib/index.js:2107` 直接用全局 `fetch`）⇒ 不存在"池太小"的排队；**反而是缺池**（见候选 C3） |
| **SSE 推送** | `session/event` 帧**按订阅**过滤（`dsh-host-apiproxy/lib/index.js:3662` `if (!subscribed.has(session.id)) return`），且连接时只对 `ctx.sessions.list()`（**live/attached**，实测 34）订阅（`dsh-host-apiproxy/lib/index.js:3631`）⇒ 持久会话从 782 涨到 1110 **不增加**订阅数。**但** `broadcast()` 对 `session/projection` **无订阅过滤**（`:1844` 定义，`:1849-1857` 直接遍历 `muxQueues`）⇒ 见候选 C3 |
| **GUI 侧列表刷新风暴** | `refreshList()` 只在连接世代建立时调（`dsh-client-runtime/lib/client.js:8448` `handleConnected`），且 **single-flight**（`:8071-8072`）；成员变更走 `applyMutation` 增量（`:8246-8251`）⇒ **不是**每事件重拉全量 ⇒ 排除 |
| **客户端 list snapshot O(N²) / projectList 新引用风暴** | 两处**都已被补丁修掉**：P1 改 Set-based O(N)（`dsh-client-runtime/lib/client.js:8576-8581`）；P2 让 `projectList()`（`:9272-9361`）按 identity/逐字段复用 ⇒ 既有报告的 O(N²) 与新引用风暴主张**均已过期**（结论 11） |

### 2.5 ① 的结论

> **在 10–40 条并发派发区间，真正决定"互相拖慢"的不是有 40 个模型请求在飞，而是每次列表/枚举类 RPC 都要在唯一的主线程上跑 6000+ 次串行往返；子代理越多 ⇒ 主线程越满 ⇒ 这些往返越贵 ⇒ 再次抬高主线程占用。**
>
> **实测拐点：无法在 N≥1 定位——因为无本轮负载的基线窗里主线程已 63.8–100.8 %（10 窗 8 个 ≥88 %），机器**已经**骑在拐点上（§2.3bis）。可判定的是饱和的两个签名：吞吐不随 N 增长（32–99/s 无单调性），而平凡请求 p50 从 29.5 ms 涨到 716.6 ms（N=32，24.3×）。把上限提到 100 条在当前实现下只会把主线程钉在 100 %，任何列表刷新都会变成数十秒级（实测已见 25.9 s 与 >30 s 超时）。**
>
> **同一环境下 `session.list` 的实测域：**299 ms（最好，主线程较空）/ 4.6–9.4 s（常见）/ 25.9 s / 167–195 s（分支 A，与我方扫描交叠时）/ 300.7 s 不返回**——对照离线同一实现 0.22 s ⇒ **最大膨胀 >1300×**。关键是这条**不靠 CPU 霸占**：重扫描 await 让出主线程，所以在 167 s 的 `subagent.list` 飞行途中，平凡 `host.describe` 仍能 **78 ms** 返回（`raw/A2-live-rpc.json`）。**慢的唯一原因是 6065 次串行往返排在每条 20–30 ms 的队列里。**

---

## 3. ② 子代理会话的存储与展示成本

### 3.1 存储面（实跑）

| 项 | 值 |
|---|---|
| `~/.dsh/sessions` 总量 | **622 MB**，19 个项目目录 |
| 会话日志文件 | **1207 个 `session.jsonl.zstd`** + 3 个 `session.v3.jsonl.zstd` + 3 个 `session.lock` |
| `persistence.list()` 返回 artifacts | **1209** |
| 其中 `origin = subagent` | **1110** |
| 其中顶层 | **99** |
| 单文件大小 | 见 `raw/w06-offline-persistence-list.json` 的 `shape.logBytesQuantiles` |
| 编码 | **全部 zstd**（`DEFAULT_COMPRESSION = "zstd"`，`dsh-session-persistence-jsonl/lib/index.js:733`）⇒ 每条 header 都要解压首帧才能读到 |
| 会话数占比 / 字节占比 | 子代理占**会话数 91.8 %**（1102/1201）但只占**字节 48.6 %**（296 MB / 612 MB）；顶层 99 条占 316 MB（分支 A） |
| **增长速率** | 既有报告 `reports/settings-jank-audit-host-loop.md:26` 记 **2026-09-21 live 会话文件数 786** ⇒ **786（09-21）→ 1209（09-22）= 一天 +54 %**（分支 A 定位出处）⇒ **任何按会话数线性外推的基线都会迅速失效** |
| 另一个成本放大器 | `~/.dsh/storages/session_projcache.json` = **10,648,178 B**，**整文件重写 + 无防抖**（见 §4.1 S12） |

> 任务书给的"782 条子代理会话"已增长到 **1110 条**；顶层 **99 条**与任务书**完全吻合**（可作快照完整性交叉校验，分支 B 独立复核到同一数字）。

### 3.2 `session.list` 的真实形状（实跑）

```
rows = 299          → 99 顶层 + 200 subagent（SUBAGENT_LIST_MAX=200 精确命中）
bytes = 501,094 / 503,228 / 503,903   （≈ 0.5 MB 响应体）
lo = 99/99 顶层行携带 runningSubagentCount   ← A6 活体断言成立
sum(runningSubagentCount) = 30 → 34
```
**截断效果**：910 条 subagent 会话**不在下发列表里**。
**截断代价**：**0** —— 见下条。

### 3.3 关键结论：**200 上限只挡"行"，不挡"扫描"**

`listVisibleSessionSummaries`（`dsh-host-apiproxy/lib/index.js:2224-2302`）的执行顺序：

| 行 | 动作 | 是否受 200 上限约束 |
|---|---|---|
| `:2235-2247` | 从 `ctx.sessions.list()` 取 **attached** 会话（实测 34），算在内存里做 recency + 截断 | 是 |
| **`:2255`** | **`const coldSource = await persistence.list(signal)`** —— **读遍 1209 条 header** | **否** ❌ |
| `:2256-2259` | 冷 subagent 排序 + `slice(0, 200)` | 是 |
| `:2262-2268` | `cold` 过滤 | 是 |
| `:2270-2294` | 分批 `summarizeCold`（`COLD_SUMMARY_BATCH_SIZE`）—— 对 **99 顶层 + 200 subagent = 265 条** | 是 |

⇒ **B1 的截断省掉的是 265→(910 条) 的 cold 投影，但 `persistence.list()` 的全量 header 扫描一次也没省**。
⇒ 因此"**782（今 1110）条子代理会话对 `session.list` 的影响**"是：**每次调用线性 +0.18 ms × 会话总数**，**且这条成本随主线程占用放大 50–200×**（§2.3），**与 200 上限无关**。

`subagent.list` 侧完全同构且**同样无 memo**：
- `SubagentRuntime.listChildren`（`dsh-subagent/lib/index.js:2683-2685`）→ `listChildren`（`:1830-1832`）→ **`prepareListing`（`:1863-1900`）**：
  - `:1874` `persistedHeaders = await persistence.list(signal)` —— **全量枚举**
  - `:1875-1880` `corpus`＝持久化 header ∪ `sessions.list()`（**全表合并**，纯内存但 O(总数)）
  - `:1881-1883` 再线性 `filter(parentSession === X && origin === 'subagent')`
  - **无跨调用缓存**（每次调用重建 corpus）
- 冷身份解析阶段有并发上限 `COLD_READ_CONCURRENCY = 4`（`:24`，用法在 `:1900+` 的 `resolveCandidateRows`）。

**⇒ ③ 的 `subagent.list` 无 memo 全量重扫，机制与 file:line 已确证**（对应 D3 的"p95 4.6→43.9 ms、峰值 789 ms"；本轮在**更重的现场条件**下实测 **16.2 s / 46.4 s**，即 D3 那个数量级是**轻载**下的乐观值）。

### 3.4 展示面：分页 / 折叠 / SSE

| 问题 | 结论 | 依据 |
|---|---|---|
| **侧栏会渲染这 200 条子代理吗** | **不会——侧栏根本不渲染子代理**：`sessionVisible()` 首条判据 = `session.origin !== "subagent"` ⇒ **侧栏 DOM 上限 = 99 条顶层行** ⇒ 「200 条子代理行的 DOM 成本」**不是问题** | `dsh-client-ui-workspace/lib/client.js:100-102`（分组 `:147-163`、flat 派生 `:222-233` 都经它） |
| 侧栏**有分页/折叠吗** | **折叠有、分页无**：per-group 折叠 `COLLAPSED_SESSION_LIMIT = 5`（`:1039`；渲染 `:1404`；"展开剩下 n 条" `:1452-1460`）；**flat「In one list」全量派生，无上限无虚拟化（`:222-233`）** | 同上 |
| 子代理目录**有分页/折叠吗** | **只按分支折叠**（`expanded` Set，`dsh-client-ui-subagent/lib/client.js:257/316/320-326`）；**同级列表全量 `catalog.entries.map`（`:226`）**。实测最坏父节点 **124 条直属子代理**；132 个父节点承载 1073 条 | 同上 + `raw/A1-store-shape.json` |
| **最廉价的接入点** | ① 侧栏 flat：`:232` `rows.map(sessionNode)` 前插一层窗口化（该函数已是纯函数，是 flat 渲染的**唯一事实源**）；② 子代理目录：`:226` `catalog.entries.map` 改为先切片 + "显示更多"，状态可与既有 `expanded` Set（`:402`）同源 | 分支 A |
| ⚠️ **收益定位（避免误投）** | **会话列表不是本机最大的渲染面**：`incident2/VERDICT.md:36` 记设置页「插件列表」子标签为 **1820 节点 / 192 SVG**（最大渲染面）。侧栏 ≤99 行**不可能**超过该量级 ⇒ **客户端虚拟化的收益主体在设置页 D2，不在会话列表**。会话列表侧的优化应瞄准**服务端走查（C1）**，不是 DOM | 分支 A |
| 被截掉的 910 条还会不会推给客户端 | `session/event` 帧**按订阅过滤**，订阅集 = 连接时 `ctx.sessions.list()`（live，实测 34）⇒ **不推** | `dsh-host-apiproxy/lib/index.js:3631`、`:3662` |
| `session/projection` 帧呢 | **无订阅过滤**，`broadcast()` 遍历全部 `muxQueues` 直推（唯一逐条例外） | `index.js:1844-1847, 1849-1857` |
| 客户端还会不会为被截会话做事 | **不会**：list 只含 299 行；snapshot O(N)（P1）；`flattenLineage` 只在 299 行上跑 ⇒ 服务端横切后客户端**没有**为 910 条做任何按行工作 | `dsh-client-runtime/lib/client.js:8556-8594` |
| **单行载荷构成** | **85–90 % 是 `projections` 块**：顶层行 mean **1780.4 B**、子代理行 mean **1638.0 B**，信封仅 **411 B**；行长 p50 1552 / p90 2361 / max 5212 B；单个 `projections.values`（sessionStats+goal+tokenUsage+contextPressure+contextBreakdown+permissions+imageLimits+todos+plan）≈ **1.4 KB** | `raw/A2-live-rpc.json`（分支 A） |

### 3.5 分支 A 的存储/展示面证据（本报告已独立复核其关键数字）

| 项 | 分支 A 实测（原始：`raw/A*.json`） | 与我方的一致/互补 |
|---|---|---|
| 单文件事件行数（= 事件数 + 1 header 行） | 抽样 **320 / 1209** 个 artifact（覆盖 61.5 % 字节）：顶层 99 条 p50 **6265**、p90 28,589、p99/max **90,507**；subagent 抽样 221 条 p50 **236**、p90 685、max 8235 | 新事实：**顶层单会话可达 9 万事件** ⇒ 任何"折全事件流"的 O(events) 操作（如 B1 之前的比较器）在该会话上是灾难 |
| subagent 事件总量 | 抽样 1-in-5 外推 **≈ 464,155 条 / 1102 条 subagent** | 新事实：可作为 SSE/投影负载规模的输入 |
| zstd 容器结构 | **concatenation of many independently decodable frames**，单会话 **2 … 77,464** 帧；`zstdDecompressSync` 整文件只解出**首帧**（plainBytes/fileBytes ≈ 0.08） | 解释了为何 `readFirstZstdLine`（`index.js:1279-1313`）+ 私有多帧解码器（`:336-483`）存在；也说明只读 header 帧**本身是便宜的设计**——问题在**串行调用次数**，不在解码 |
| 平均压缩比 | 2.81 | — |
| `raise SUBAGENT_LIST_MAX` 外推（`raw/A2-subagent-list-max-extrapolation.json`） | 行均值：顶层 **1780.4 B**、subagent **1638 B**；`MAX=1110` ⇒ 1209 行 / **1,994,851 B（1.99 MB）** = 当前 504 KB 的 **3.96×** | 重要定性结论：**提高上限不改变服务端 `persistence.list()` 的 6065 跳**（它在 `:2255` 的截断之前就跑了），只改变**网络字节 + 客户端 `JSON.parse` + `flattenLineage` + `projectList` 行数** |
| 截断账（`raw/A1-B1-truncation-accounting.json`） | 服务端 1209 目录遍历**每次调用都重付**（`:2255` 在截断前）；被 B1 挡住的只有**wire 行 / 冷身份读 / 冷投影**；910 行（82 %）永不上线；**但 `:2241-2243` 的 attached-subagent recency 排序仍在切片前折叠每个 attached subagent** | **与我方 §3.3 独立同结论** |
| SSE 三通道（`raw/A4-sse-channels.json`） | ① **mux**：`GET /api/events.mux`（浏览器实为 **WebSocket** `/api/events.mux`，`dsh-client-connection/lib/client.js:10253-10273`）⇒ 这解释了我裸 GET 收到 **426 Upgrade Required** 的原因；开流时对**每个 live 会话**推 1 条 `session/subscribed`（`:3631`），之后**每事件 1 条**（`:3660-3680`，按 `subscribed` 过滤 `:3661`）；② **host**：`session/created` → 1 条 `host/session-added` 单行增量（`:3721-3728`），无全量；③ **broadcast**：`session/projection` 等瞬态帧，`:1844-1847` **无订阅过滤**，扇出 = mux 连接数 | **确认：没有任何通道推全量列表** ⇒ 全量只由客户端主动 POST `/api/session.list` 拉取（与我的 §2.4 GUI 刷新排除一致） |
| 客户端刷新触发 | `refreshList()` 仅由 `handleConnected`（`dsh-client-runtime/lib/client.js:8448`）与 `:9074` 触发；`host/session-added` 走 `mergeSummary` 单行增量（`:8362-8376`）；仅当 parent 被选中/catalog 打开才 `scheduleCatalogRefresh`（`:8375`）且有 `catalogDebounce`（`:8456-8464`） | **与我方 §2.4 独立同结论** |

---

## 4. ③ 派发路径上的同步阻塞点

### 4.1 清单（按"每次派发/每次列表刷新都要付"排序）

| # | 阻塞点 | file:line | 同步/异步 | 成本 |
|---|---|---|---|---|
| **S1** | `persistence.list()` 全量串行 header 扫描（zstd 首帧解压 ×1209） | `dsh-session-persistence-jsonl/lib/index.js:1063-1093`（`listArtifacts`）、`:1253-1300`（`readFirstLine/readFirstZstdLine`）、`:1037-1039`（`list`）、`:1345-1375`（`assertStoredIdentity`/`sameFile`） | async 但**串行**（~6000 次 await） | **0.22 s 冷/空载；16–46 s 饱和** |
| **S2** | `session.list` 无 memo 调 S1 | `dsh-host-apiproxy/lib/index.js:2255` | async | 同上 |
| **S3** | `subagent.list` 无 memo 调 S1 + 全表 corpus 合并 | `dsh-subagent/lib/index.js:1830-1832` → `:1863-1900`（`:1874` 是 S1 调用） | async | 同上 |
| **S4** | `annotateRunningSubagentCounts` 每行 BFS（每次 `session.list` 一趟 `ctx.sessions.list()` + 每顶层行 BFS） | `dsh-host-apiproxy/lib/index.js:1244-1276`（`:1245` 为 live 表遍历） | 纯内存，O(live + 行×子树) | 小（但每次必付） |
| **S5** | B1-perf 已消除的比较器折叠 | `index.js:2241-2243`（`attachedRecency` 预计算） | — | **已修**（原 O(N log N × events)，注释记 0.3–2.5 s） |
| **S6** | 每次派发 `llm.resolveCallConfig` 预检（仅当有显式路由或 settings 提供路由时） | `dsh-tool-subagent/lib/index.js:531,537-542` → `:147-158` | async，需 provider 查找 | 小～中 |
| **S7** | 每次派发读 `settings.get("dsh-subagent")` | `dsh-tool-subagent/lib/index.js:530` → `:119-136`（`:123`） | **同步内存**，try/catch 包裹 | 可忽略 |
| **S8** | 子代理会话创建：IO 边界在 `agents.create` | 分支 B：`dsh-subagent-in-process-driver/lib/index.js:160-187`（`:179` 为 IO 边界） | 其余步骤纯内存 | 小 |
| **S9** | 每事件 SSE 帧构造：`viewFor` + `tool/call` 帧 `JSON.parse(arguments)` | `index.js:3662-3682`（`:3664-3672` 是 parse） | 同步 JSON.parse | 每 `tool/call` 一次 |
| **S10** | `session/projection` 变更**无过滤广播** | `index.js:1844-1847, 1849-1857` | 同步遍历消费者 | O(消费者) × 每次投影变更 |
| **S11** | 派发边界审批**不阻塞**（`never` 硬编码） | `dsh-subagent/lib/types/child-agent.js:180,194` | — | 0（排除为阻塞点） |
| **S12** | **宿主侧投影缓存整文件重写且无防抖**：`~/.dsh/storages/session_projcache.json` = **10,648,178 B**；每个写原语**整体重新发布文件**（tmp-write + fsync + rename + **目录 fsync**），per-domain 串行写链**无合并/防抖**。审计期间现场存在正在改写的 temp（9,961,472 B） | `dsh-storage-json/lib/index.js:118-123`、`:26-38`；`dsh-storage-domain/lib/index.js:85-86, :108-213` | 异步但**整体重写** | **10.6 MB × `JSON.stringify` + 写盘 + 多次 fsync**；对 100 并发是明确放大器（**未单独测**） |

### 4.2 会话创建/持久化的单位成本（机制 + 常量；**未单独实测**）

| 环节 | file:line | 关键事实 |
|---|---|---|
| 批量写盘 | `dsh-session-persistence-jsonl/lib/index.js:1200-1226`（`appendLines`） | **每个批次：`open(path,"a")` → `handle.stat()` → `writeFile` → `handle.sync()`（fsync）→ `close()`** = **5 次 await + 1 次 fsync** |
| 批量窗口 | `dsh-session-persistence/lib/index.js:436` `DEFAULT_WRITE_BATCH_MAX_DELAY_MS = 200` | 事件最多攒 **200 ms** 再落盘 ⇒ 每个活跃会话 ≈ **每 200 ms 一次「5 跳 + fsync」** |
| 首建（materialize） | `dsh-session-persistence-jsonl/lib/index.js:1096-1102`（`materializePosix`） | temp-write + **fsync** + rename + **目录 fsync** ⇒ 单次创建比普通 append 更贵（多次 sync） |
| 容器打包 | `:732` `DEFAULT_PACK_CHUNKS = true` | ⇒ **多帧拼接容器**（分支 A 实测单会话 2…77,464 帧），这也是为什么"只读 header 帧"是便宜设计 |
| prepared 缓存 | `dsh-session-persistence/lib/index.js:434` `DEFAULT_PREPARED_SESSION_CACHE_SIZE = 5` | 准备态会话缓存只有 **5** 个 ⇒ 并发活跃子代理远超 5 时会反复 prepare/落盘 |
| 冷投影批 | `dsh-host-apiproxy/lib/index.js:882` `COLD_SUMMARY_BATCH_SIZE = 16` | `session.list` 的冷投影每批 16 |
| 创建 IO 边界 | （分支 B）`dsh-subagent-in-process-driver/lib/index.js:160-187`，`:179` = `agents.create` | 会话对象/header/事件之外的创建步骤为纯内存 |

> **推断（INCONCLUSIVE，未实测）**：N 条并发子代理 ⇒ 每 200 ms 有 **N ×（5 次 await + 1 次 fsync）**。N=30 时 ≈150 跳 + 30 fsync / 200 ms；**N=100 时 ≈500 跳 + 100 fsync / 200 ms**。fsync 在同一块设备上会互相排队，且每次都是主线程上的一次等待 ⇒ **这是"100 条并发"的第 5 个前置条件**（见 §6.1 P8）。**本轮没有测 fsync 饱和曲线**（需真派发 100 条，超出授权）。

### 4.3 `Recv-Q` 直接证据

三次采样均观察到 `Recv-Q > 0`（402–417 B，3 条连接；早一次 557–928 B，7 条连接）⇒ **宿主入站请求已积压**，即"宿主来不及处理"从**队列层面**被直接观测到（不只是延迟数字）。

---

## 5. ④ 二级子代理与模型热载（机制核对）

### 5.1 settings 段热载：**真的生效**（任务书假设被否定）

| 环节 | 证据 | 级别 |
|---|---|---|
| 消费点 | `dsh-tool-subagent/lib/index.js:123` `settings.get("dsh-subagent")`；覆盖逻辑 `:119-136`；调用点 `:530`；注释 `:106-114` 声称"每次派发读一次" | 【只读推断】 |
| **注册点（关键：树外）** | `~/.dsh/profiles/node_modules/@local/dsh-subagent-model/lib/index.js:26` `settingsNamespace("dsh-subagent")`；`:46` `installSettingsSection(...)` | 【实跑】 |
| 挂载 | `~/.dsh/profiles/web/cordis.patch.yml` 末尾 `- insert: - id: dsh-subagent-model / name: '@local/dsh-subagent-model'` | 【实跑】 |
| 为什么只读产品包会误判 | 全 `@deepseek-ai/*` 树 grep `dsh-subagent` **仅 3 处命中，全在消费方**（`:108` 注释、`:123` 读、`:527` 注释） | 【实跑】 |
| settings 值 | `~/.dsh/settings.yaml:220-221` = `dsh-subagent: {model: deepseek-v4-pro}` | 【实跑】 |
| **行为切点** | `v4.1-flash` 最后一条 **09-20 14:15:19** → `v4-pro` 第一条 **09-20 14:21:17**，此后 **0 次回退**；09-22 全部 260 条 = v4-pro | 【实跑】 |
| 排除"preset 恰好等于 v4-pro" | preset 静态写死 `adam/deepseek-v4.1-flash`（`.dsh/.agent-presets/standard-glm/agent.cordis.yml:193-195`），mtime **09-17 16:49**，切点前后未变 | 【实跑】 |
| 排除"父代理逐调用传参" | 14/14 条 v4-pro 子会话，其父日志里的 `subagent` 工具调用 `data.arguments` **无 `provider`/`model`**（`explicit=0`）；且 `agentRouteDefaults` 全树无定义（`:426` 是唯一引用） | 【实跑】 |

**⇒ 结论：④ 的"settings 段热载是否真的生效"= 是，且已用 1105 条子会话的模型字段 + preset 静态值 + 排除父传参三重证据钉死。**

**唯一真实缺口（建议修）**：`dsh-settings/lib/index.js:388-390` 对未注册命名空间**返回 `undefined` 不抛**；`dsh-tool-subagent/lib/index.js:124-127` 静默回落 ⇒ 该本地插件一旦未挂载，**`dsh-subagent:` 段静默失效、宿主与日志零告警**。建议在 `effectiveConfiguredAgentOptions` 加**一次性 warn**（冷面，`dsh-tool-subagent` 是产品包 ⇒ 需重启）。

### 5.2 派发边界审批

| 问题 | 结论 | 依据 |
|---|---|---|
| 有"派发即审批"边界吗 | **没有**（`dsh-tool-subagent/lib/index.js` 全文 `authoriz|permission|approval` 零命中） | 【只读推断】 |
| 审批策略怎么定 | **委派时硬编码 `never`**，写为会话事件（`source:'delegation'`） | `dsh-subagent/lib/types/child-agent.js:176-195` |
| 沙箱模式 | **继承父会话 override**；父无 override 则不写任何事件、子退回宿主 defaultMode | `dsh-subagent/lib/types/child-agent.js:179`；`dsh-sandbox-policy/lib/index.js:141,151` |
| `never` 下 `sandbox_permissions` 会挂起吗 | **不会**，自动拒绝（`NEVER_SENTENCE` 与本会话运行时上下文逐字一致；`dsh-user-approval/lib/index.js:38` 是 `NEVER_SENTENCE`、`:99` 按 `approval` 策略选用它） | 【只读推断】+【实跑 25/25】 |

### 5.3 二级子代理

| 问题 | 结论 | 依据 |
|---|---|---|
| `maxDepth` 语义 | 默认 **3** = **最大深度**；顶层 depth 0，`childDepth = 父+1`，`> maxDepth` 才抛 | `dsh-tool-subagent/lib/index.js:301`；`dsh-subagent/lib/types/child-agent.js:32-40` |
| 子代理有 `subagent` 工具吗 | **有**（preset `toolFilter` 出现 0 次 = 未限制） | 【实跑】 |
| 二级子代理的 `parentSession` 指向 | **直接父（中间层）**，非顶层 | 【实跑】 |
| 实测 depth 分布 | `{0:207, 1:592, 2:277, 3:29}`，**无 depth≥4** | 【实跑】 |
| 血缘链一致性 | **869/869 一致、0 违例** | 【实跑】 |
| 对 `runningSubagentCount` 的影响 | `annotateRunningSubagentCounts` 是 BFS 逐层遍历 `childrenOf`（`dsh-host-apiproxy/lib/index.js:1256-1276`），**跨多层计数正确**，前提正是 parent 指向直接父 | 【只读推断】+【实跑】 |

---

## 6. ⑤ 前三优化候选（含"允许 100 条并发"的前置条件）

> 每条给：收益 / 风险 / 验收 / 回滚 / 热面或冷面。**收益数字一律用本轮实测同窗对照**，不外推绝对值。

### 候选 C1（第一优先）：给全量 corpus 扫描加**带世代失效的 memo**，并把 `listArtifacts` 的 per-session IO **并发化**

- **靶点**：`dsh-session-persistence-jsonl/lib/index.js:1063-1093`（串行 `await` 循环）。
- **收益（实测同窗对照，用本轮已量化的等式换算）**：
  - **靶点量级**：`墙钟 = 6065 跳 × 逐跳队列延迟`（空载 0.02 ms/跳 ⇒ 0.12–0.22 s；饱和 27.6 ms/跳 ⇒ 167 s）。
  - 命中缓存 ⇒ **跳数 → 0**，`session.list` / `subagent.list` 与 1209 条规模**解耦**（热路径目标 ≤10 ms 量级；离线 0.22 s 是**冷**值）。
  - 冷路径有界并发 ⇒ **跳数 ÷ 并发度**（取 4 ⇒ 6065 → ~1520 跳）⇒ 空载 0.22 s → 预计 0.06–0.08 s；**更关键的是饱和下不再随主线程占用等比爆炸**（因为串行依赖链短了 4×）。
  - **验收必须用"跳数/比值"，不要用跨窗绝对 ms**（本环境方差 25×，见 §2.3bis）。
- **风险**：**失效正确性**是全部风险所在——新增会话/新会话 header 必须在**一次刷新内**可见，否则侧栏"看不到新会话"。必须用"目录世代戳（root + 各 project 目录 mtime）+ 显式 `invalidate()`（在 `materialize`/`create` 里调）"双保险；**只按时间 TTL 失效会造成不可重现的丢会话**。
- **验收**：① 新增一个会话后，`session.list` **下一次调用**即包含它（**反例对照**：纯 TTL 版本会出现 ≤TTL 的不可见窗 —— 必须先跑出这个反例再上守卫）；② **同窗对照** `session.list` p50/p95（判据用**比值**，不用跨窗绝对值）；③ 删除/归档会话后列表不再包含它（防陈旧）；④ `B1-transform` 回放规格仍逐字节复现（该批的既有不变量）；⑤ **跳数断言**：加一个计数器（或直接复用 A 的 `raw/A1-list-cost.json` 复刻脚本），断言**单次 `session.list` 触发的异步 fs 跳数从 6065 降到 ≤（1209 + 少量）**（冷）或 **0**（热）；这是唯一一个**不受环境噪声影响**的判据，建议作为主判据。
- **回滚**：单一常量/开关（如 `PERSISTENCE_LIST_MEMO=0`）切回全量扫描；或恢复 pre-image。
- **面**：**冷面**（`dsh-session-persistence-jsonl` 是产品包 ⇒ 需重启宿主）。**注意**：它与"U-IG/主题批"共享同一次重启窗口更划算。

### 候选 C2（第二优先）：把 200 上限从"行"扩展到"**扫描**"，并给 `subagent.list` **加跨调用 memo / single-flight**

- **靶点**：`dsh-host-apiproxy/lib/index.js:2255`（先全量扫再截断）；`dsh-subagent/lib/index.js:1863-1900`（`prepareListing` 每次重建 corpus）。
- **收益**：直接削掉**与"不可见会话数"成正比**的那部分成本（当前 1110 − 200 = **910 条**是纯浪费）。同时 `subagent.list` 加 single-flight 可防"多个 UI 消费者同时打开目录"时的重复全量扫（`subagent.list` 现在**没有任何 single-flight/memo**）。
- **风险**：① 冷 header **没有 `updatedAt`**（B1 已用 `?? createdAt` 兜底），若要"先按最近 N 过滤再扫描"必须**先低成本拿到排序键**（`statSync` mtime 或 projection cache 行）——`statSync` 是**同步** API，在饱和主线程上是新风险；建议用 projection-cache/`listSnapshots` 的**异步** `stat`。② 过滤过早可能让"刚被恢复的旧会话"漏出列表。
- **验收**：① 断言"产出 artifacts 数 ≤ 上限 + 顶层数"（**反事实对照**：把上限调到 0/1 时调用成本应显著下降，证明过滤真的生效）；② 顶层一条不少（B1 既有断言）；③ 与 C1 组合后同窗对照 p95。
- **回滚**：上限/开关常量；pre-image。
- **面**：**冷面**（宿主两处）。

### 候选 C3（第三优先）：给派发路径加**显式全局并发闸门** + SSE 投影广播**加订阅/合帧**

- **靶点**：① 无全局闸门（`dsh-agent-loop/lib/index.js:231` 只管每 parent 每步 10；`dsh-jobs-local/lib/index.js:102,127,137` 的 10 被 `continuable` 落点绕过）；② `dsh-host-apiproxy/lib/index.js:1844-1847,1849-1857` 的**无过滤 `broadcast`**；③ 出站 HTTP 无 socket 池（`dsh-llm-pi-ai/lib/index.js:2107`）。
- **收益**：防止"把上限提到 100"后主线程被一次打满（当前 30 条已经 84–95 %）；把排队变成**可见、有界**而不是随机延迟。SSE 侧：`session/projection` 帧加订阅过滤或按 tick 合帧，减少 O(消费者 × 变更) 的同步 `JSON.stringify`。
- **风险**：**语义变化**——闸门会引入"派发排队"，需要产品裁决（排队可见性、超时、取消）；`maxConcurrentJobsPerOwner` "超限直接 throw 不排队"的现有语义若变成排队，会改变错误面。SSE 过滤若照抄 `session/event` 的订阅集，要确认客户端确实订阅了所有它需要的会话（当前订阅集 = 连接时 live 会话 ⇒ **连接后新建的会话靠 `session/created` 补订阅**，`dsh-host-apiproxy/lib/index.js:3681`，这条路径必须保留）。
- **验收**：① N=100 并发时主线程 <90 %（用 `/proc` 逐线程，本轮已建立口径）；② 每个子代理首 token 延迟 p95 有界（相对 N=10 的比值判据）；③ SSE 帧数与字节数在同窗对照下下降且**功能不回退**（新会话仍出现、工具结果仍流式）。
- **回滚**：闸门上限设回"无上限"；SSE 过滤开关。
- **面**：**混合**——闸门若加在 `dsh-agent-loop` / `dsh-jobs-local` = **冷面**；SSE 过滤若只在 `dsh-host-apiproxy` = **冷面**；客户端订阅逻辑（`dsh-client-runtime`）= **热面（刷新）**。

### 6.1 "允许 100 条并发"的**前置条件**（按必要性排序）

| # | 前置条件 | 为什么必要（实测依据） |
|---|---|---|
| **P1** | **先落 C1/C2** | 当前 ~16–34 条 running 时，单次 `subagent.list` 已 **11–167 s**、`session.list` 已 **0.3–194.6 s**（并发交叠时 **300.7 s 不返回**）；100 条并发下 GUI 每次列表刷新都会变成分钟级 ⇒ **不修扫描就上 100 = 必然的自锁** |
| **P2** | 主线程预算：把 **per-subagent 主线程成本降约 3×** | 30 条 ⇒ 主线程 **84.4–95.1 %**；线性外推 100 条 ⇒ 远超 100 %（即使每子代理成本不变，也需先降到 30 % 以下才有余量给列表/SSE/工具结果） |
| **P3** | 显式并发闸门 + 排队可见性（C3-①） | 现在**没有任何全局闸门**，40 条即全部同时开跑；100 条会以不可控方式打满主线程 |
| **P4** | SSE 侧：投影广播加订阅过滤或合帧（C3-②） | `broadcast()` 目前对**每个** `session/projection` 变更直推**所有** mux 消费者；100 条并发下变更率线性上升 |
| **P5** | 出站 HTTP 连接池 + 退避重试 | `dsh-llm-pi-ai:2107` 用全局 `fetch`、无 `maxSockets`/`keepAlive` 配置 ⇒ 100 路模型调用无池化，连接建立/端口耗尽风险自担 |
| **P6** | 重新裁决 `maxParallelToolCalls`（10/步）与 `maxConcurrentJobsPerOwner`（10，超限 throw）的语义 | 前者限制父代理**单步扇出**（100 条要分 10 步），后者被 `continuable` 绕过 ⇒ "允许 100 条并发"的**闸门语义需要产品定义**，不能只改数字 |
| **P7** | 磁盘/存储侧：1207 个 zstd 日志 + 910 条不在列表里的会话 | 只读成本与总数线性相关（P1）；另需独立裁决"**归档/清理**"策略（本轮只读，未做） |
| **P8** | 落盘侧：`writeBatchMaxDelayMs=200` + 每批 1 次 fsync（§4.2）⇒ 100 条并发约 **100 fsync / 200 ms** | fsync 在同设备互相排队、且每次都是加载主线程上的一次等待；`preparedSessionCacheSize = 5` 也远小于 100。**本轮未测**（需真派发），标 **INCONCLUSIVE** |
| **P9** | 投影缓存落盘侧：`session_projcache.json` **10.6 MB 整文件重写、无防抖**（S12） | 每个写原语 = `JSON.stringify(10.6 MB)` + tmp-write + fsync + rename + 目录 fsync；100 条并发会放大其触发频率。**本轮未测** |
| **P10** | GUI 侧：flat 列表与子代理目录都缺分页/虚拟化（结论 11c） | 侧栏虽只渲 99 条顶层行，但**子代理目录同级列表全量渲染**（实测已有 124 条父节点）⇒ 需要先做窗口化 |

---

## 7. 附：分支报告摘要

### 7.1 分支 B（`subagent-B-report.md`，398 行）—— 已完整交付

- settings 热载：**真**（含 4 重证据链，见 §5.1）；唯一缺口 = 未注册命名空间静默回落且零告警。
- `listChildren` 无 memo 全量重扫：**已确证**（`dsh-subagent/lib/index.js:1863-1900`），成本线性于磁盘总会话数。
- 无全局派发信号量；G1 = `maxParallelToolCalls` 默认 10（`dsh-agent-loop/lib/index.js:231`）；G2 = `maxConcurrentJobsPerOwner` 默认 10（`dsh-jobs-local/lib/index.js:102,127,137`）**被 continuable 绕过**；出站 HTTP 无池（`dsh-llm-pi-ai/lib/index.js:2107`）。
- SSE = 增量推帧（`dsh-host-apiproxy/lib/index.js:3662-3682`），每 `tool/call` 帧 `JSON.parse(arguments)`。
- ⚠️ **分支 B 对 `dsh-subagent/lib/types/list-children.js` 的行号是"region 相对偏移"**（该模块以 `//#region lib/types/list-children.js` 内联在 `dsh-subagent/lib/index.js` 里，region 起始 ≈ 绝对 1788）。本报告引用的该模块行号**已全部换算成绝对行号并逐条复核**：`COLD_READ_CONCURRENCY`=**1812**、`listChildren`=**1830**、`prepareListing`=**1863**、`persistence.list` 调用=**1874**、`prepareListing` 结束=**1900**。
- 审批 `never` 硬编码（`dsh-subagent/lib/types/child-agent.js:180,194`）、沙箱继承（`dsh-subagent/lib/types/child-agent.js:179`）、**不挂起**（25/25 实证）。
- `maxDepth=3` 语义、子代理有 `subagent` 工具、二级 `parentSession` 指向直接父、depth 分布与血缘链 869/869。
- ⚠️ 分支 B 指出：**`~/.dsh/AGENTS.md` 的路由表已过时**（文档称 subagent 统一 `adam/deepseek-v4.1-flash`，实际自 09-20 起为 `adam/deepseek-v4-pro`）。**建议主 agent 裁决**：更新文档 **或** 清空 settings 段，二者取一。

### 7.2 分支 A（`subagent-A-report.md`，54.8 KB / 10 条结论 + 62 条 file:line 索引）—— 已完整交付

分支 A 独立复刻并**交叉验证**了本报告 §3 的关键数字；同时给出 4 条**本主档未覆盖**的新事实，均已并入上文：

1. **侧栏不渲染子代理**（`dsh-client-ui-workspace/lib/client.js:100-102`）⇒ 侧栏 DOM 上限 = 99 行；`dsh-client-ui-sidebar` 只是外壳（结论 11b）。
2. **折叠/分页的真实分布**：侧栏 per-group 折叠 = 5（`:1039`/`:1404`/`:1452-1460`），flat 模式全量无虚拟化（`:222-233`）；子代理目录只按分支折叠、同级全量（`dsh-client-ui-subagent/lib/client.js:226`），实测最坏父节点 **124 条**（结论 11c + §3.4）。
3. **`session_projcache.json` = 10.6 MB 整文件重写且无防抖**（`dsh-storage-json/lib/index.js:118-123`、`:26-38`；`dsh-storage-domain/lib/index.js:85-86,108-213`）⇒ 新增阻塞点 **S12**。
4. **"782/786" 的出处与增长速率**：`reports/settings-jank-audit-host-loop.md:26`（09-21）记 786 ⇒ **一天 +54 %**。
5. **两处客户端热点均已修掉**（P1 + P2），既有引用过期（结论 11）。

⚠️ 分支 A 自己标注的边界：其长延迟被**我的并发扫描污染**（14:54:36 起跑），故 167–195 s 是**上界不是干净基线**；其 `list()` 复刻是**独立实现**而非产品类（产品类由我跑，见 §2.3）。

---

## 8. 未测 / 边界（诚实清单）

1. **没有做 40 条真实子代理派发**（**最大空白**）。授权上限是 **2 个二级子代理**，且"派发 40 条真代理"会写 `~/.dsh/sessions`（超出只读授权）并污染用户会话库。因此 §2 的"拐点"结论由**现场并发条件（16–34 条 running，由并行 peer 线产生）+ 单位成本 + 主线程占用 + 受控并发扫描**四者共同支撑，**不是我自己造的 40 条派发曲线**。⇒ 若主 agent 需要一个真正的 N=10/20/40 派发剂量-响应曲线，**必须由有写权限的档来做**，且需先清理/隔离会话库。
2. **受控并发扫描的两轮都落在"已饱和"区间，未得到干净剂量-响应曲线**（§2.3bis 判读 4/5）：无本轮负载的基线窗主线程已 63.8–100.8 %；同 N 相邻两轮差 **25×**（29.5 vs 735.3 ms）。预注册阈值 **T1/T3 判 INCONCLUSIVE，T2 虽满足但不足以立论**。
3. **并发快照每档起止各一次做不到**（§五.2 的严格版）：单次 `session.list` 实测 0.3–25.9 s、且有一次撞满 30 s cap 被 abort，只在**整轮起止**各采一次（其中起始那次失败）。
4. **观测者效应**：主线程 84–95 %（及基线窗的 ~100 %）**含本 campaign 自己的探针流量**（24 条连接、7 条曾积压、同期 6 个 peer 探针脚本在跑）⇒ 该数字**不是用户日常基线**（结论 12）；但方向对用户真实场景同样成立——GUI 每次连上就调 `session.list`（`dsh-client-runtime/lib/client.js:8448`）。
5. **未定位"谁在占用主线程"的精确分解**（只读 + 不重启 ⇒ 无法注入 profiler）。已用"排除法 + 机制分析"给出最可能来源（S1/SSE/ingest），**没有 GC/`(program)`/React commit 级别的归因**。
6. **CPU 归因是上界**：`/proc` 窗内 CPU 含宿主为**所有**并行线做的事（实测多次出现"窗内进程 CPU ≈ 全核 1.0"），故本报告**优先用主线程 CPU % 与比值**，不用绝对归因。
7. **未测 GUI 侧 DOM 成本（但已可判定"不是会话列表的问题"）**：为避免与并行 peer 抢浏览器，本轮**未启动任何浏览器** ⇒ 无 DOM 计数。不过分支 A 已用源码判定**侧栏不渲染子代理**（上限 99 行，结论 11b），且 `incident2/VERDICT.md:36` 的 1820 节点/192 SVG 是**设置页插件列表** ⇒ **虚拟化的收益主体不在会话列表**，会话列表侧应瞄准服务端走查（C1）。**"99 行侧栏的实际 DOM/布局成本"仍未测。**
8. **未验证"归档/清理"可行性**：本轮只读，未评估删除/归档历史会话的收益与风险。
9. **782 → 1110 的增长未归因**：期间本 campaign 自身在大量派发子代理，**很可能主要是本 campaign 造成的**——应提醒主 agent：**campaign 规模本身在推高存储成本**（而该成本按 §3.3 会线性抬高每一次 `session.list`）。
10. **分支 B 的两处推断其一已被本轮解决**：`persistence.list()` 是否走 `readdirSync` ⇒ **否**，`listArtifacts` 用异步 `readdir`（`dsh-session-persistence-jsonl/lib/index.js:1377-1401`），所以问题不在"同步 IO"，而在**串行 await 的往返次数**。另一处（`never` 自动拒绝的具体分支行）仍未定位。

---

## 9. 复现

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/program/w06-subagent
# 单次 RPC 计费（延迟 + 宿主 CPU jiffies）
node raw/w06-rpc-measure.mjs raw/out.json 3 session.list 1500
# 离线真实实现：全量 header 扫描（零宿主负载，只读）
node raw/w06-offline-persistence-list.mjs raw/out-offline.json 3
# 并发扫描（带每档硬上限）
node raw/w06-concurrency-sweep.mjs raw/sweep.json session.list '{}' 1,2,4 20000 90000
# 主线程逐线程 CPU（HZ=100）
python3 - <<'EOF'
import os,time
pid=301709
def snap():
    d={}
    for t in os.listdir(f'/proc/{pid}/task'):
        try:
            s=open(f'/proc/{pid}/task/{t}/stat').read(); r=s[s.rindex(')')+2:].split()
            d[t]=int(r[11])+int(r[12])
        except: pass
    return d
a=snap(); t0=time.time(); time.sleep(10); b=snap(); dt=time.time()-t0
main=sum(b[t]-a[t] for t in b if t in a and t==str(pid)); oth=sum(b[t]-a[t] for t in b if t in a and t!=str(pid))
print(f"main {main*10/dt/10:.1f}%  other {oth*10/dt/10:.1f}%")
EOF
```

**产物清单（本目录）**

| 文件 | 内容 |
|---|---|
| `audit.md` | 本报告（主档交付） |
| `subagent-B-report.md` | 分支 B：settings 热载 / 同步阻塞 / 审批边界 / 二级子代理（398 行） |
| `subagent-A-report.md` | 分支 A：存储与展示成本（见该文件） |
| `raw/w06-offline-persistence-list.mjs` + `.json` | **真实类** `listArtifacts()` 离线跑（1209 条 / 218.7-281.7 ms） |
| `raw/w06-rpc-measure.mjs` + `raw/w06-rpc-sessionlist-3.json` | 单次 RPC 计费（延迟 + 宿主 CPU jiffies） |
| `raw/w06-concurrency-sweep.mjs` | 受控并发扫描器（带每档硬上限/基线窗/逐线程 CPU 采样） |
| `raw/w06-sweep-cheap.json`、`raw/w06-sweep-knee.json` | 两轮并发扫描原始数据 |
| `raw/A1-store-shape.json` | 目录/文件/字节形状（分支 A） |
| `raw/A1-list-cost.json` | **独立复刻 + 真实 syscall 计数（6065 跳）**（分支 A） |
| `raw/A1-B1-truncation-accounting.json` | 截断账：哪些成本被 B1 挡住、哪些每次重付（分支 A） |
| `raw/A1-event-row-counts.json` | 采样 320/1209 artifact 的事件行数分布（分支 A） |
| `raw/A2-live-rpc.json` | 分支 A 的 live RPC 实测（**194.6 s / 300.7 s / 167.3 s / 78 ms**） |
| `raw/A2-subagent-list-max-extrapolation.json` | 提高 `SUBAGENT_LIST_MAX` 的字节/行外推（分支 A） |
| `raw/A4-sse-channels.json` | 三条推送通道的机制核对（分支 A） |
| `raw/A-source-index.json` | 分支 A 的 62 条 file:line 证据索引 |
| `raw/B-*.json` | 分支 B 原始证据（模型切点表 / depth 链 / 并发闸门 / 热载） |

> 早期两轮 `raw/sweep-*.log` 是 0 字节失败尝试（脚本卡在无上限的初始并发快照上，见 §8.3），已删除；其数据由 `raw/w06-sweep-*.json` 取代。
