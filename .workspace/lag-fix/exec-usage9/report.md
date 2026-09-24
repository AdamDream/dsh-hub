# exec-usage9 · 修订执行复核一体档：U-USG-C2（sessions 懒加载）+ U-USG-C1（模块级 generation-keyed 记忆 + 内联单飞）

- 日期：2026-09-22（工作时段 15:05–16:0x 本地，UTC+8）
- 独占目录：`.workspace/lag-fix/exec-usage9/`
- 宿主：PID 301709（**未重启**）；GUI `http://127.0.0.1:3080`
- 契约：`.workspace/lag-fix/program/w05-usage-ingest/audit.md`（§2.4 候选 C2/C1）+ `sub-a-rpc-resend.md`
- **纪律自证**：未修改任何产品文件；**未写 `~/.dsh/**`**（deployed 写入留给协调者）；未重启 / 未 pkill；未传 `sandbox_permissions`；
  唯一的"写"= 本目录下的候选件、补丁器、探针、原始 JSON；**未调用过 `/usage/refresh`**（页内探针也只做只读导航，**没有点过「手动刷新」**）。
- 自裁决：**PASS**（三档行为验证 19/19 + 20/20 + 20/20、静态 27/27；见 §4/§6）

---

## 0. 结论先行

| 项 | 结果 |
|---|---|
| **候选件** | `candidate/client.js` — sha256 `8f53e475d6252903…`、**81 123 B**、**rev（sha1[:12]）= `7b7e47569500`**（改动前 `4536b91ed282` / 72 804 B） |
| **补丁器** | `apply-Usage9-v1.mjs`（dry-run 默认 / `--apply` / `--rollback` / `--verify`；11 个锚点**全部唯一命中**；`node --check` 双向；幂等；自动 pre-image） |
| **落地** | **一条命令**（由协调者执行）：`node .workspace/lag-fix/exec-usage9/apply-Usage9-v1.mjs --apply` ⇒ 改 `~/.dsh/profiles/node_modules/@local/dsh-usage/lib/client.js`，**热面**（改文件 + 刷新页面即生效，rev 变 ⇒ URL 变） |
| **回滚** | `--rollback`（按 pre-image 还原，已实测 `cmp` **逐字节相同**）或把 `USAGE_MEMO` 置 `false`（1 个布尔，**已实测**执行后回到改动前行为） |
| **收益（可复现）** | 首挂载 **9→8 req**、**61 556→6 635 B（−89.2%）**；切回 **9→1 req / 288 B（−99.5%）**；切回 6 次 **54→6 req**；轮询 **7→1 req / tick**；默认 tab 下刷新不再白付 54 921 B |
| **新鲜度** | 判据是**服务端代际标记**（不是 TTL）；**可证明等价**（§5），且**刻意不依赖** `index.js:263` 的缺陷——刷新路径上 `lastIngest` 冻结时依然换代（§5.2，harness S6 实跑） |
| **残余风险** | 1 条窄前置条件的残余（cc value-only upsert 且计数巧合，当前部署不可达）+ 首挂载多一次 status RTT（§7） |

---

## 1. 交付单元与落地位置

### 1.1 U-USG-C2（首选）：`sessions` 懒加载

- `sessions` 在整张卡片里**只有一个消费点**（`rows: sessionRows`，会话明细 tab 表体；静态复核：`sessionRows` 的代码级引用仅 1 处），而默认 tab 是 `byModel`。
- 改动：挂载 effect 不再取 `sessions`；新增一个 `tab === "sessions"` 的 effect 在**首次激活该 tab 时**才取（载荷变化时 `loadSessions` 身份变化 ⇒ 照常新取）。
- 附带（审计给的缓解项）：新增 `sessionsLoading` 状态，首开该 tab 时表体显示「加载中…」而不是短暂显示假空态「暂无会话数据」。
- 手动刷新：默认 tab 下**不再**白付 54 921 B；在会话 tab 下仍会重取（切到该 tab 时也会按同代际重取，保证屏幕上永远是新数据）。

### 1.2 U-USG-C1：模块级 generation-keyed 记忆 + 内联单飞

- 记忆块插在 `const CHANNEL = "/usage";` **之后、`function UsageCard` 之前**（模块级 = 唯一能跨「切栏目 / 关窗重开」存活的位置；已静态断言：块 508-594 行 < UsageCard 841 行）。
- 8 个查询调用点（7 路 `loadAll` + `sessions`）改走 `memoCall`；**`status` 与 `refresh` 恒为真实请求**（静态断言各 1 处）。
- 时序（关键）：**先探测 `status` 代际 → 再发查询**。挂载 effect / 轮询 tick / 手动刷新三处都遵守；不遵守就无法证明新鲜度（§5.3 的 D2）。
- 单飞内联在 `memoCall` 里（key = `endpoint|JSON(payload)`），命中时返回同一个 value 引用（React setState 见同引用 ⇒ 无谓 re-render 也一起消掉）。

---

## 2. 补丁器（`apply-Usage9-v1.mjs`）

- **默认 dry-run**（不写一个字节），打印锚点命中表 + 前/后哈希 + 新 bundle URL。
- 11 条编辑（E1 模块块 / E2 挂载 effect / E3 会话 tab effect / E4 轮询 tick / E5 7 路查询 / E6 `loadStatusRef` / E7 `loadSessions` / E8 `loadStatus` 代际 / E9 `sessionsLoading` / E10 空态文案 / E11 手动刷新）；
  **每条都要求锚点恰好命中一次**（整行或 trim 相等 + 邻接断言），任一失败 ⇒ 抛 `PatchError` ⇒ **一个文件都不写**（dry-run 实测过多次中止路径）。
- 写入前落 pre-image（原字节 + sha256/md5/sha1_12 到 `backup/`），写入前后各跑 `node --check`；**幂等**（已含 marker ⇒ `ALREADY-PATCHED` 退出 0）。
- 独立于本档的**字节级回滚验证**：对工作区副本 `--apply` → `--rollback` → `cmp` 与 pre-image **逐字节相同** ⇒ 再 `--apply`（记录在 §4.1）。
- deployed 写入**未执行**（超出本档可写范围）；本档只对工作区副本用过 `--apply`。

复现（本档全部实测过）：

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-usage9
node apply-Usage9-v1.mjs                                  # dry-run（默认目标 = deployed）
node apply-Usage9-v1.mjs --target candidate/client.js --apply     # 工作区副本（本档自验用）
node apply-Usage9-v1.mjs --target candidate/client.js --rollback  # 还原
node verify-static.mjs                                            # 27 项静态 + 记忆块单测
node harness/usage9-harness.mjs --bundle scratch/client.pre.js --json raw/harness-pre.json
node harness/usage9-harness.mjs --bundle candidate/client.js --json raw/harness-candidate.json
node harness/usage9-harness.mjs --bundle candidate/client.js --flip-off --json raw/harness-rollback.json
node probe/usage9-probe.mjs --phase before        # 页内探针（改动前；已跑）
node probe/usage9-probe.mjs --phase after         # 协调者落地后跑（同一把尺子）
```

---

## 3. 改动清单（与审计单元的逐条对应）

| # | 位置（deployed file:line，改动后行号） | 改动 | 对应单元 |
|---|---|---|---|
| E1 | `:508-594`（`CHANNEL` 之后） | 模块级 `USAGE_MEMO/USAGE_LAZY_SESSIONS`、`usageMemo`、`usageInflight`、`usageGen`、`usageGenOf`、`usageNoteGeneration`、`usageForgetGeneration`、`memoCall` | C1 插入点（组件外） |
| E2 | `:1069-1089`（原 `:971-975`） | 挂载/载荷变化 effect：`!USAGE_MEMO` ⇒ 逐字回滚分支；否则 `await loadStatus()` → `loadAll()` →（仅当 `USAGE_LAZY_SESSIONS=false`）`loadSessions()` | C1 时序 + C2 |
| E3 | `:1090-1098`（新增） | `tab === "sessions"` 时才 `loadSessions()` | C2 |
| E4 | `:1108-1124`（原 `:986-990`） | 轮询 tick：`!USAGE_MEMO` ⇒ 旧行为；否则先 `loadStatusRef.current()`（真实探测）再 `loadAll()` | C1（轮询 −95%） |
| E5 | `:995-1005` ×7 行 | `rpc.call` → `memoCall(rpc, …)`（含 hour 那条 `.catch(() => null)` 语义保留） | C1 |
| E6 | `:919-921`（新增） | `loadStatusRef` | C1 轮询接线 |
| E7 | `:1035/1036/1045-1047` | `sessions` 改 `memoCall`；`setSessionsLoading(true)` / `finally` 复位 | C2 + 空态缓解 |
| E8 | `:1055-1067` | `status` 成功后 `usageNoteGeneration(value)`（组件守卫之外）；失败 ⇒ `usageForgetGeneration()` | C1 判据源 |
| E9 | `:915` | `const [sessionsLoading, setSessionsLoading] = useState(false)` | C2 |
| E10 | `:1231-1234` | `emptyText` 感知 loading | C2 空态文案 |
| E11 | `:1130-1150` | 手动刷新：`usageMemo.clear()` → `loadStatus()` → `loadAll()` →（会话 tab 可见才）`loadSessions()` | C1 反缓存吞刷新 |

未改：`sessionRows` 的消费点、任何其它视图、任何其它文件（**没有碰 `dsh-client-ui-primitives` / `dist/assets/*`**，即任务书 §硬性纪律 5 的例外未触发）。

---

## 4. 实测结果

### 4.1 静态 + 记忆块单测（`verify-static.mjs` → `raw/verify-static.json`）

**27/27 PASS**，要点：

- A1 pre-image == 审计已确证基线（`sha1[:12]=4536b91ed282` / 72 804 B）；A2 candidate 与补丁器落盘 post 记录**逐字节一致**（rev `7b7e47569500`）；A3 `node --check` 通过。
- A4 记忆块在组件外；A5 `memoCall` 恰 8 处；A6/A7 `status`/`refresh` 仍各 1 处真实调用；A8 `rpc.call(CHANNEL,"sessions")` 在 candidate 中 **0 处**；A9 `sessionRows` 代码级消费仍 **1 处**；A10 回滚开关 5 处短路齐全；A11 回滚分支调用序列与改动前同序；A12 无新增依赖；A13 无未预期删行。
- B0 从 candidate **逐字抽出**记忆块（63 行 / 2 506 B / sha256 `2ba8730c41698182…`）在 Node 里跑单测：B1–B5 代际标记性质（缺陷独立 / timer 不抖 / 活动才纳入 lastIngest / null 语义）、B6 fail-closed（代际未知不入库不命中）、B7 命中且同引用、B8 换代作废、**B9 在飞期间换代 ⇒ 不得带错标签入库**、B10 单飞、B11 载荷隔离、B12 失败响应不入库、B13 `USAGE_MEMO=false` 退化为裸 `rpc.call`。
- 诚实标注：本轮先写了 3 条**断言自身的 bug**（`sessionRows` 把注释算成消费点、漏算 `usageMemoPut` 的短路、把缩进纳入"逐字"比较），修正后才是 27/27；三条都不是补丁的问题（详情见 `raw/verify-static.json` 的现有断言文本）。

### 4.2 行为验证（`harness/usage9-harness.mjs`）：**仪器自证 + 前后对照**

harness 在 vm 沙箱里求值**真实 bundle 文本**，用自己的 require 提供迷你 hooks 运行时（函数组件按组件树帧持有 hook 槽），调 `exports.apply(ctx)` 捕获**真组件**，用 stub rpc 计数（按审计逐端点字节表折算字节）。**第一档跑的是改动前字节**——它必须复现审计已确证的前提，否则仪器不可信：

| 场景 | 改动前（pre，19/19 PASS） | 改动后（candidate，20/20 PASS） |
|---|---|---|
| 首挂载（默认 tab） | **9 req / 61 556 B**（9 端点逐一吻合） | **8 req / 6 635 B**（无 `sessions`） |
| 切走再切回 ×1 | **9 req** | **1 req = `/usage/status` / 288 B** |
| 连续切回 ×6 | **54 req** | **6 req** |
| 60s 轮询一拍 | **7 req**（纯查询） | **1 req = status** |
| 点「会话明细」tab | 0 req（挂载时已取） | **+1 `sessions`**，且**两行会话数据真的出现在渲染树里**（非空态） |
| 换代（`lastIngest` **冻结** + `eventsDsh/scannedDsh` 推进 = `index.js:263` 形态） | 7 req（无探测） | **8 req**（1 status + 7 查询 ⇒ 必须重取） |
| 空 pass 连拍（timer 开了但无文件变化） | 7 req/拍 | 第二拍 **1 req**（**不作废**；第一拍 8 = 从"有活动"代际切到"无活动"代际的一次性收敛） |
| 手动刷新（默认 tab / 会话 tab） | 9 / 9 req（含 sessions、无 status） | **9 / 10 req**（含 status、默认 tab **不含** sessions ⇒ 不白付 54 921 B） |
| status 探测失败后重挂载 ×2 | 9 / 9 req | **8 / 8 req**（fail-closed：不得靠旧代际命中） |
| 重叠挂载（未结算就重挂） | **18 req** | **9 req**（同 key 共享同一条 promise） |
| 切 `dataSource` | 9 req | 8 req（payload 不同 ⇒ 不得命中） |

**回滚档**（candidate + 两开关文本置 `false`，`--flip-off` 记录在 JSON 里）：**20/20 PASS，且数字回到改动前**（9 / 61 556 / 54 / 7 / 18）⇒ "1 个布尔回滚"是**执行验证过的事实**，不是声明。

### 4.3 页内活体探针（`probe/usage9-probe.mjs` → `raw/usage9-probe-before.json`）

同一把尺子的**改动前行**（deployed 仍是改动前字节，`rev=4536b91ed282` 由探针自己记录 ⇒ 证明量的是哪份字节）：

| 项 | 实测 |
|---|---|
| 首挂载（点 设置→插件） | **9 req**，`encodedBodySize` **61 769 B**，逐端点 = summary 1 / timeseries 2（day+hour）/ heatmap 1 / byModel 1 / byProject 1 / byDay 1 / **sessions 1** / status 1（与审计 61 556 B 的差 = 窗口内数据增长） |
| 切走再切回 ×6（轮询已置「不轮询」） | **每轮 9 req，合计 54**；6 轮的 `cardAbsentBeforeSwitchback` **全为 true** ⇒ **"切走是真卸载"首次拿到活体证据**（审计 §5.3(4) 当时只有静态推导） |
| 轮询窗口（档位设 5s，观察 12.5 s） | 11 req（≈1.6 个 tick × 7 路）；⚠️ 窗口边界会切掉半个 tick，**每 tick = 7 路**这个口径以审计的直测为准 |
| 点「会话明细」tab | **+0 req**（改动前挂载时已取） |
| 页内心跳 / 帧（相对 KPI） | beat p50 0.1 ms / p95 0.2 ms / **max 102.8 ms**，>50 ms 拍 3；`>50ms` 帧 4 —— 通道是活的（阳性对照），但**本机非独占，绝对值不作判据** |
| 浏览器存活 | 窗口全程 `pidAlive=true` 且页面可 evaluate（另一条线两次遇到窗口中途被第三方杀掉，本档已按纪律每步检查） |
| 探针锁 | **UNLOCKED-BY-AUTHORIZATION**（持有者 `exec-*`，等待 15 s 未让出；协调者已授权"未持锁可并发但必须标注"），已写进 JSON 的 `lock` 字段 |

> ⚠️ 探针的前两次运行**失败**（一次 `userDataDir` API 不适用、一次 boot 未完成就点设置导致 0 计数），第三次起改成"就绪驱动 + 卡片存在性断言 + 每轮校验 `cardAbsent`"才拿到上表。失败的原始记录未保留（被覆盖），**这一条已如实计入 §9**。

---

## 5. 新鲜度语义：为什么可证明等价（本档最重要的论证）

### 5.1 判据（不是 TTL）

```
gen = dbPath | eventsDsh | eventsCc | scannedDsh | scannedCc | failedDsh | failedCc | (activity>0 ? lastIngest : "")
命中条件：entry.gen === 当前 gen 且 gen !== null
activity = scannedDsh + scannedCc + failedDsh + failedCc
```

- `usage_daily` 完全由 `usage_events` 派生（`db.js:286-311` 的 span DELETE + `INSERT…SELECT`）；
- `usage_events` 的**唯一写入者**是 fold 里的 `insertEvent`，且只对「mtime+size 变了、没被 `continue` 跳过」的文件执行——`ingest-dsh.js:259` / `ingest-cc.js:225` 的 `scanned += 1` 正排在跳过判断之后；
- ⇒ **数据变** ⇒ 要么有新行（`eventsDsh/eventsCc` 变）要么有重读（`scanned*` 变） ⇒ **代际必变** ⇒ 记忆整体作废。
- 反向：**没有文件被重读的 pass 不可能写入** ⇒ 该 pass 无论推进多少次 `lastIngest` 都不该作废记忆（这正是 `activity>0` 条件的作用）。

### 5.2 与 `index.js:263`（`lastIngest` 永不回写）的关系——**既不依赖也不掩盖**（两个方向都给了证据）

- **不依赖**：判据里 `lastIngest` 只在 `activity>0` 时参与，而缺陷影响的正是"刷新路径上 `lastIngest` 冻结"。审计自己的原始数据就是证据：`raw/g1-live.json` 里一次真实 refresh（wall 7 835 ms）让 `eventsDsh 102 215 → 109 424`、`scannedDsh 101 → 165`，而 `lastIngest` 恒为 `1790045703018`。若照审计原稿只用 `lastIngest` 当判据，**这次数据变化会被漏判**；本实现因为还看计数，照样换代。harness 的 S6 场景就是把这个形态喂进去：**8 req（1 status + 7 查询）⇒ 换代并重取**。
- **不掩盖**：改动只在**客户端 bundle**里，没有触碰 `lastIngest` 的写入路径，也没有改「上次 ingest」这一行的渲染 ⇒ 缺陷在界面上**照旧可见**（刷新后时间戳仍冻在宿主启动那一刻），审计 §0.2 建议的修法（先修 `waitIdle` 回写、再开 timer）不受影响。
- **额外影响（正面）**：因为代际包含事件计数，**另一个标签页/客户端触发的 refresh 也能被本标签页在下一个探测周期（≤1 个 tick）发现** ⇒ 改动其实**部分补偿**了该缺陷带来的客户端陈旧，而不是利用它。

### 5.3 三处刻意偏离审计原稿（都是"收紧"，并各给出理由与实测）

| # | 审计原稿 | 本档实现 | 理由 |
|---|---|---|---|
| **D1** | 代际 = `status.lastIngest` | 代际 = 服务端计数元组（+ 仅在 `activity>0` 时纳入 `lastIngest`） | ① `lastIngest` 在刷新路径上被 `index.js:263` 冻住 ⇒ 单独用它会漏判真实数据变化；② 45s timer 打开后每次 pass 都推进 `lastIngest`（即使无文件变化）⇒ 单独用它会让记忆每 45s 作废、**轮询反而从 7 变 8 req（比现状更贵）**。两条都有实测：S6（缺陷形态必须换代）/ S7（空 pass 不得换代） |
| **D2** | 挂载 effect 里"同步先发起 `loadStatus()`，再发起 `loadAll()`"（并发、落库时读当前 gen） | **`await loadStatus()` 之后才发查询**（严格串行） | 原稿在"落库时读当前 gen"上有一个**可永久陈旧化的竞态**：若 fold 恰好落在"发查询"与"查询执行"之间、且探测随后返回换代后的 gen，那么 prefold 数据会被贴上 postfold 代际标签，之后**再也不会有探测发现它**（代际已稳定）⇒ 永久陈旧。严格串行保证"入库的响应，其请求一定发在探测之后"⇒ 可证明等价。代价 = 首挂载多一次 status RTT（隔离态 12–66 ms）；换来切回/轮询整轮归零 |
| **D3** | 换代后"再触发一次 `loadAll()`" | 不需要 | 三处调用点都遵守 D2 的时序 ⇒ 换代在"发查询之前"已完成，补跑路径不可达（少一处复杂状态机） |

另外两处**审计明确列为可选**、本档做了的小改动：会话 tab 的 `sessionsLoading`（审计 §C2"加 loading 标志可解"）、手动刷新在会话 tab 不可见时跳过 `sessions`（审计 §C2"可选第二处"）。
`rpc.js:191-193` 的陈旧注释（"client.js polls `/usage/refresh` on a timer"）**本档未改**：它是宿主半（冷面，需重启），不在本批范围。

---

## 6. 验收（协调者落地后照抄）

```bash
# 1) 落地（热面，不重启宿主）
node /home/CNS2026495165/dsh/.workspace/lag-fix/exec-usage9/apply-Usage9-v1.mjs --apply
#    → 期望打印 rev 4536b91ed282 → 7b7e47569500，pre-image 落在 backup/
# 2) 静态复核（27/27 PASS）
node /home/CNS2026495165/dsh/.workspace/lag-fix/exec-usage9/verify-static.mjs
# 3) 页内活体验收（同一把尺子；探针自己记录 rev，用来证明跑的是新字节）
node /home/CNS2026495165/dsh/.workspace/lag-fix/exec-usage9/probe/usage9-probe.mjs --phase after
```

**逐条断言**（数字来自本档 pre 档实测与 harness candidate 档实测）：

| 验收项 | 改动前（已实测） | 落地后期望 |
|---|---|---|
| 首挂载 `/usage/*` 请求数 | 9 | **8** |
| 首挂载响应体字节 | 61 769 B（审计 61 556） | **≈6 6xx B**（sessions 54 921 摘除） |
| 首挂载是否含 `sessions` | 含 | **不含** |
| 切走再切回 ×6 累计 | 54 | **6**（每轮 1 且是 `/usage/status`） |
| 点「会话明细」tab | +0（挂载时已取） | **+1 `/usage/sessions`**，且**表体真的出数据**（不出现假空态） |
| 手动刷新 | 9 req（含 sessions） | **≥8 且全为真请求**（默认 tab 下 9 = refresh+status+7 路，不含 sessions） |
| 轮询（档位 5s 观察 12.5 s） | 11 req（≈7/tick） | **≈2 req（≈1/tick）** |
| 探针 `rev` | `4536b91ed282` | **`7b7e47569500`** |

> 若某一项不符：**先看探针 JSON 的 `rev`**——rev 还是旧的说明页面吃到了旧 bundle（强制刷新 / 换 tab 重开）；rev 是新的而计数不符，才是真问题。

---

## 7. 诚实清单：本档**没有**做到 / 不能保证的

1. **deployed 未写入**（超出本档可写范围）⇒ §6 的"落地后期望"列是**harness 与探针口径下的预期**，不是已完成的活体实测；活体 after 行必须由协调者跑 `--phase after` 补齐。
2. **harness 的 rpc 是 stub**（无真实宿主查询）⇒ 它证明的是**客户端请求计数/端点/时序**，不证明服务端查询耗时或真实响应字节；字节数按审计实测表折算。
3. **残余陈旧窗口（窄，但真实）**：若某次 fold 只做"value-only upsert"（cc 的 last-wins 覆盖同一条事件、没有新行）、由**本卡片之外**的方触发（timer 或其他客户端）、且该 pass 的 `scanned` 计数恰好等于上一次 pass 的值、同时 `lastIngest` 又被 `index.js:263` 冻住——这四件事同时成立时，本代际判据无法发现，会陈旧到 F5 或手动刷新。**当前部署不可达**：cc 文件 mtime 最大 09-07（sub-b §4.5）⇒ 没有 cc 值变更可发生；且唯一会触发 fold 的本卡片刷新路径自己会清记忆。
4. **探测的残余成本**：每次挂载 / 每个 tick 有 1 次真实 `status`（288 B；宿主侧 2×`COUNT(*)`，审计实测隔离态 12–66 ms）。这是 C1 的"保费"，不是零成本。
5. **首挂载多一次 RTT**：因为 D2 的严格时序，数据首屏比改动前晚一个 status 往返（隔离态 12–66 ms，负载下曾见 231 ms）。切回场景反而是 5–20× 更快（1 次探测 vs 9 路突发）。
6. **活动→空闲 pass 过渡**会多一次重取（harness S7 第一拍 = 8）：从"有活动代际"切到"无活动代际"时标记形状变化导致一次作废。稳态（连续空 pass）不抖动（S7 第二拍 = 1）。
7. **未做**：未开 timer、未改宿主任何文件、未修 `index.js:263`、未动 `rpc.js:191-193` 的陈旧注释、未验证"从源码重新部署会回滚"（审计 §4.4 的部署面风险依旧存在——本档只改 deployed，**建议协调者把 deployed 反写回 workspace 源**）。
8. **本机全程非独占**（loadavg 高、另有线路在跑 GUI A/B 与浏览器）：所有绝对耗时只作量级，硬判据只认**请求计数 / 端点名 / 字节数 / 结果 sha256**。
9. 探针前两次运行的失败记录**未落盘**（被覆盖），只在上文与本节以文字留痕；第三次起改为"就绪驱动 + 每轮 `cardAbsent` 校验"。

---

## 8. 交付物清单

| 文件 | 内容 |
|---|---|
| `apply-Usage9-v1.mjs` | 补丁器（dry-run/--apply/--rollback/--verify；11 锚点唯一命中；pre-image；node --check；幂等） |
| `candidate/client.js` | 候选件（81 123 B，rev `7b7e47569500`，sha256 `8f53e475d6252903…`） |
| `scratch/client.pre.js` | 改动前字节副本（= deployed 现字节，rev `4536b91ed282`） |
| `backup/` | pre-image + post 记录（JSON，含 sha256/md5/sha1_12） |
| `verify-static.mjs` + `raw/verify-static.json` | 27 项静态/单测（含 63 行记忆块的逐字抽取单测） |
| `harness/usage9-harness.mjs` + `harness/HARNESS.md` | 行为验证（真实组件代码 + stub rpc） |
| `raw/harness-pre.json` / `harness-candidate.json` / `harness-rollback.json` | 三档原始结果（19/19、20/20、20/20） |
| `probe/usage9-probe.mjs` + `probe/PROBE.md` | 页内活体探针（`--phase before|after`，同一把尺子） |
| `raw/usage9-probe-before.json`（+ `…-run3-preserved.json`） | 改动前活体行（9 req/61 769 B；切回 6×9=54；rev 4536b91ed282） |
| `report.md` | 本文件 |
