# exec-countfix 报告 — U-W18B（`runningSubagentCount` 客户端契约修复）+ U-W18B2（注释行号失效）

- 线：`.workspace/lag-fix/exec-countfix/`（**本目录独占**）
- 日期：2026-09-22 19:0x–19:3x（宿主 **PID 2988915**，GUI `http://127.0.0.1:3080`）
- 依据：`program/w18-projection/audit.md` §五（「B 节」）+ `program/w18-projection/scripts/bench-zod.mjs` + `program/w18-projection/tools/proj-observe.mjs`
- 上游已确证前提（**本档未重新论证**）：丢弃点 = `dsh-client-connection/lib/client.js:5383-5394` 的 `sessionSummarySchema`（`object({...})`，无 `.passthrough()`）；
  payload 里超声明 shape 的未知键**恰好只有** `runningSubagentCount`；宿主写 **99/99** 顶层行，解析后 **0/99**（示例值 36 → `undefined`）。
- **deployed 全程只读**：开工/收工两次核指纹一致（见 §0）。本档所有写入只落在本目录（`mirror-*/` `candidates/` `raw/` `preimage/`）。
- **脚本调用未传 `sandbox_permissions`**（本会话审批已关闭，属越权即被拒）。

---

## 零、一句话结论（自裁决：**PASS（U-W18B / U-W18B2） + REWORK-REQUEST（审计契约不完备，见 §2）**）

> **① U-W18B 落地正确、必要、无副作用**：在**真实的 bundle 字节 + 真实内联 zod（4.4.3）**上实测，同一 505 KB payload 解析后该字段 **0/99 → 99/99**，数值与宿主逐行一致；
> 其余声明键**逐键逐行等值**（0 处差异）、行数不变（299）、未知键**仍被剥离**（canary 未泄漏、`catchall` 为空 ⇒ **仍非 passthrough**）。代价：同窗 A/B **+2.4%…+7.6%（p50，绝对 +0.05…+0.15 ms / 次 505 KB 解析）**，远低于审计实测否决的 `.passthrough()`（+12%）。
>
> **② ⚠️ 但审计的验收判据 ②「UI 侧 `:171/286` 的 `typeof === "number"` 分支可被命中」在只落 U-W18B 时【不成立】——这是本档的独立复核结论。**
> `dsh-client-runtime/lib/client.js` 的 **`projectList()` 有一张显式 byId 字段白名单（`:9324-9338`）**，它**不含**该字段；`:9384` 的 `stableById` 复用谓词同样不含。
> ⇒ 字段在 L1 存活后，**在 L3 被第二次丢掉**：`list.byId[id].runningSubagentCount` 仍是 `undefined`，UI 仍走弱兜底。实测 L1 99/99 → **L3 0/99** → **L4 0/99**。
> 补齐（本档 `U-W18B-EXT`，**默认不选中**，须协调者/审计裁决）后：L1/L2/L3/L4 **全 99/99**，且功能性抽样（截断展开）从 **低报 37→0** 变成 **37→37 恒准**。
>
> **③ U-W18B2 落地正确**：把失效的 `:7984` 行号引用改成**符号名**（`projectionStore()` 内的 `subscribeAny` 订阅者）以抗偏移；剥离纯注释行后前后**逐字节相同**（sha256_16 `c2293e0c387d57d7`，314202 B），`/* w07-throttle v1 */` **×4 不变**。

---

## 一、纪律与口径（诚实声明）

| 项 | 值 |
|---|---|
| 目标文件指纹（开工 19:0x / 收工 19:3x） | `dsh-client-connection/lib/client.js` = **`f729a994183ae736`**（与 `w07` 一致 ✓）<br>`dsh-client-runtime/lib/client.js` = **`4a2c298dd82613c7`** |
| 指纹不符时的行为 | **硬闸门 STOP + 零写入**（否定测试 NEG-2 实测） |
| 并发条件 | 本档运行期 `loadavg` **6.7–11.1**（11 条审计线 + 1 条执行线在飞）⇒ **绝对 ms 不作基线**，只用**同窗比值/同进程配对** |
| 浏览器 | 只开**自己的** headless Chromium 页面；**未**重启/未 pkill 用户浏览器；**未**点击 Sessions 树行内按钮（只点组级展开控件，且实测发现「收起」会误点侧边栏开关已修掉） |
| 探针锁 | 用 `.workspace/lag-fix/lib/probe-lock.mjs`。实测被 `exec-logdrift`（**ALIVE**）持有时**正确拒绝抢占、未回收**；改用 `tools/with-lock-wait.sh` 等待空闲后才跑（等待期间不空转回收） |
| 未做 | 未 strace/gdb；未改任何产品文件；未重启宿主；未用 `sandbox_permissions` |

### ⚠️ 一处口径修正（供审计回填）
审计的 `scripts/bench-zod.mjs` 用 `req('zod')` 取的是 **`dsh/node_modules/zod` = 4.6.2**；
但**浏览器客户端 bundle 里内联的是 `zod@4.4.3`**（`dsh-client-connection/lib/client.js:703` 的 `//#region ../../../node_modules/.pnpm/zod@4.4.3/...`）。
本档因此**不依赖任何手写 schema 复现**：`tools/real-bundle.mjs` 用桩 `window.__ModuleLoader__.load` + 桩 `require` 把**出厂字节**跑进 Node vm，
只在 `return module.exports;` 前注入**一行** `exports.__w18probe = {...}`，从而拿到**真 schema 对象 + 真内联 zod**（§3.1）。

---

## 二、⚠️ 审计契约不完备（本档最重要的独立发现）

### 2.1 字段的完整链路有 **5 层**，审计只点了第 1 层

| 层 | 位置 | 行为 | U-W18B 后 |
|---|---|---|---|
| **L0** 宿主写入 | `dsh-host-apiproxy/lib/index.js`：`annotateRunningSubagentCounts()`（`:1244`）→ `item.runningSubagentCount = count`（`:1271`），唯一调用点 `:2321`；`if (item.origin === "subagent") continue` ⇒ **只写顶层行** | 99/99 顶层行 | 99/99 |
| **L1** 客户端 wire schema | `dsh-client-connection/lib/client.js:5383-5394` `sessionSummarySchema`（无 `.passthrough()`） | **丢弃 99→0** | **✅ 99/99（已修）** |
| **L2** 清单条目展开 | `dsh-client-runtime/lib/client.js:5603` `flattenLineage()` → `out.push({ ...s, ... })`（**spread，会带字段**） | 0（因 L1 已丢） | 99/99 |
| **L3** 投影快照 | `dsh-client-runtime/lib/client.js:9318` `projectList()`：`byId[entry.sessionId] = { ... 显式字段白名单 ... }`（`:9324-9338`） | **丢弃 0** | **❌ 仍 0** |
| **L4** UI 消费 | `dsh-client-ui-workspace/lib/client.js:171` / `:286`：`typeof s.runningSubagentCount === "number" ? … : (descendants.get(id)?.runningCount ?? 0)`，`s = list.byId[id]` | 弱兜底 | **❌ 仍走弱兜底** |

`L3` 的白名单实测**只有** `id / displayTitle / running / completed? / blank / updatedAt / pendingInteraction? / projectionValues? / title? / cwd? / parentId? / origin? / agentPreset?`
（`raw/chain-B.json` 的 `l3_storeSnapshot.byIdKeysOfSampleEntry` = `["id","displayTitle","running","blank","updatedAt","cwd","agentPreset"]`；`chain-C.json` 才多了 `runningSubagentCount`）。

### 2.2 还差第二个子改动：`stableById` 复用谓词

`projectList()` 在 `:9384` 用一张**逐字段相等**的谓词决定能否复用上一帧的对象：
`stableById[id] = reusable ? previousEntry : entry`。
该谓词**同样不含** `runningSubagentCount` ⇒ 即使补了白名单，**计数变化也会被 `previousEntry` 复用吞掉**（旧值继续显示）。
⇒ 要真正"值跟得上"，必须**同时**改 `:9324-9338`（白名单）与 `:9384`（复用谓词）。

### 2.3 实测证据（同一 payload、同一进程、只换字节）

`tools/probe-chain.mjs`：真 schema → 真 `flattenLineage` → 真 `SessionRuntime.prototype.projectList()` → `dsh-client-ui-workspace` 的 **`:171/286` 谓词原文**（从真 bundle 抽取并**断言形状未变**）。

| 配置 | L0 宿主 payload | L1 真 schema | L2 flattenLineage | **L3 projectList.byId** | **L4 UI 强分支命中（顶层）** | 其余声明键差异 | canary 泄漏 | isPassthrough |
|---|---|---|---|---|---|---|---|---|
| **PRE**（现状） | 99/99 | **0/99** | 0 | 0 | **0/99** | **0** | false | false |
| **B（仅 U-W18B）** | 99/99 | **99/99** | 99 | **0** | **0/99** | **0** | false | false |
| **C（U-W18B + EXT）** | 99/99 | **99/99** | 99 | **99** | **99/99** | **0** | false | false |

原始 JSON：`raw/chain-pre.json` / `raw/chain-B.json` / `raw/chain-C.json`。

### 2.4 功能性差异（用户可见的到底是什么）

兜底 `indexSubagentDescendants(byId).runningCount` 是**已加载后代**口径（沿 `parentId` 链上溯，**不只直接子代**——审计 §5.3 说"仅已加载的直接子代"这一点需要修正为"**已加载的（任意深度）后代**"）；
宿主口径是**live 会话表**上的 running 后代，**行被截断也照算**（宿主注释 `:1237-1239` 自己写明了这一点）。

⇒ 二者差异出现在**子代理行未下发/被截断**时。`probe-chain.mjs` 的截断扫描（按 `updatedAt` 从旧到新丢弃子代理行）实测：

| 丢弃子代理行 | PRE 低报行数 | PRE 报 0 行数 | PRE 缺口 | B 低报/缺口 | **C 低报/缺口** |
|---|---|---|---|---|---|
| 0 / 25 / 50 | 0 | 0 | 0 | 0 / 0 | **0 / 0** |
| 100 | 1 | 1 | 1 | 1 / 1 | **0 / 0** |
| 200（子代理行全不加载） | **2** | **2** | **37**（37 → **0**） | 2 / 37 | **0 / 0（37 → 37）** |

⇒ **不落 EXT 时，"未加载的子代理树"依旧报 0/低报** —— 这正是审计 §5.3 描述的功能性缺陷，**U-W18B 单独落地并不能消掉它**。

### 2.5 live 页面的旁证

`raw/browser-A-noshadow.json`：真实 `POST /api/session.list` 响应 **101/101 顶层行带字段**，宿主正值 `[2, 8, 13]`；
但页面上**唯一渲染出来的**会话行徽标只有 **2**（该行恰好"已加载后代数 == 宿主值"）。⇒ 与 §2.4 一致，但**不能**据此断言其余行错——它们根本没渲染（见 §3.6 的局限）。

### 2.6 本档动作

- **不自行拍板**：`U-W18B-EXT` 在补丁脚本里**标记 `defaultOff`，默认不选中**，只有显式 `--unit U-W18B-EXT` 才会落。
- 若审计/协调者认可，一条命令即可落地（`DEPLOY.md` §3）。
- 若否决，U-W18B 仍是**必要**且**无副作用**的一步，只是**不足以**触达验收判据 ②；此判据应改写为"L1 丢弃点关闭 + 字段随 `flattenLineage` 抵达 manager 条目"，或明确接受"UI 侧仍走弱口径"。

---

## 三、U-W18B（唯一主单元，热面）交付

### 3.1 交付物

| 文件 | 内容 | sha256_16 |
|---|---|---|
| `apply-CountFix-v1.mjs` | 补丁脚本（dry-run 默认 / `--apply` / 唯一锚点 / pre-image / `node --check` / 幂等 / 每单元独立 `--rollback` / 工作区护栏） | — |
| `candidates/dsh-client-connection.client.U-W18B.js` | **候选件（已补丁字节）** | `3e2b048565b16e5e` |
| `raw/diff-U-W18B.patch` | 统一 diff（19 行，单点插入） | — |
| `tools/real-bundle.mjs` | 真 bundle 装载器（桩 `__ModuleLoader__` + 桩 `require`，仅注入 1 行 probe export） | — |
| `tools/probe-chain.mjs` | L0→L4 全链路探针（含截断扫描、逐键哨兵、canary、非 passthrough） | — |
| `tools/probe-field-semantics.mjs` | 声明字段的语义/约束/缺省/非 passthrough 断言 | — |
| `tools/bench-schema-ab.mjs` | **同窗** A/B 基准（同进程装载 pre/post 真 schema，交替测） | — |
| `tools/run-all-evidence.sh` | 一键重跑全部证据（12 步，全程只读 deployed） | — |
| `tools/run-negative-tests.sh` | 4 条否定测试 | — |
| `tools/accept-browser.mjs` | 渲染级验收（含 `--shadow` **影子部署**） | — |
| `tools/with-lock-wait.sh` | 等探针锁空闲（**绝不回收未确证死亡的锁**） | — |
| `raw/*.json` | 全部原始证据 | — |

### 3.2 改动内容（唯一一处插入）

```diff
@@ -5390,7 +5390,15 @@
 			agentPreset: string().optional(),
-			projections: lazy(() => sessionProjectionsBlockSchema).optional()
+			projections: lazy(() => sessionProjectionsBlockSchema).optional(),
+			/* dsh-lag-fix W18B */ /* Host-written, TOP-LEVEL rows only: … */
+			runningSubagentCount: number().int().nonnegative().optional()
 		});
```

- 语义与审计 §5.4 选项 (a) **逐字一致**：`number().int().nonnegative().optional()`（`.optional()` 是必需的——宿主 `:1257` 对 `origin === "subagent"` 的行 `continue`，子代理行本就没有该键）。
- 附带审计 §5.4「**附加证据需求**」要求的**契约来源注释**：写明写入者（`annotateRunningSubagentCounts`）、"仅顶层行"、以及"**必须保持声明**，否则无 `.passthrough()` 会被静默剥掉"。
  - 注释里**刻意只写符号名、不写行号**（与 U-W18B2 的治理一致，避免随偏移失效）。
- 新增 8 行注释 + 1 行声明；`projections:` 行补一个尾逗号（原为最后一个属性）。

### 3.3 补丁脚本契约（逐条实测）

| 契约 | 实测证据 |
|---|---|
| **dry-run 默认** | `node apply-CountFix-v1.mjs` → `writes=0`、`mode=dry-run`（`raw/step1-dryrun.json`）；deployed 指纹未变 |
| **锚点唯一命中，否则零写入** | 锚点 `preHits=1`；**NEG-3** 把锚点复制成两份 ⇒ `anchor must hit EXACTLY once, got 2` + `plan phase FAILED ⇒ NOTHING was written`（`raw/neg-3-anchor.json`，`writes=0`） |
| **全或无** | 两单元**先全部规划、后统一写盘**；任一 plan 失败即整批不写（NEG-2/NEG-3 实测 2 个单元一起被挡） |
| **指纹硬闸门** | **NEG-2** 模拟他线改动 ⇒ `fingerprint mismatch: … expected one of f729a994183ae736 ⇒ STOP`（`raw/neg-2-fingerprint.json`，`writes=0`） |
| **自动 pre-image** | `preimage/<unit><tag>/client.js.pre` + `manifest.<unit><tag>.json`（前后 sha、锚点偏移、mode、census） |
| **`node --check`** | plan 阶段对**规划后的字节**做语法闸门（写临时文件 → `node --check` → 删除），PASS 才允许写 |
| **幂等** | 第二次 `--apply` ⇒ `already-applied`、`writes=0`、`ok=true`（`raw/step3-idempotent.json`）；幂等态改用 **manifest 记录的 post sha** 作指纹判据 |
| **每单元独立回滚** | `--rollback --unit U-W18B` 只还原那一个文件（实测：conn 回到 `f729a994183ae736`，runtime 保持 `1ac5d41659bd180e`）；无条件 `--rollback` 会回滚**一切有 manifest 的单元**（含显式 apply 过的 EXT，避免隐藏状态） |
| **回滚拒绝猜** | **NEG-4** 先把文件篡改成第三种状态 ⇒ `current file is neither pre nor post image ⇒ refusing`（`raw/neg-4-rollback-thirdstate.json`，`writes=0`） |
| **工作区护栏（写）** | **NEG-1** `--apply` 到 deployed 未带 `--allow-outside-workspace` ⇒ 拒绝，`writes=0`，deployed 指纹未变（`raw/neg-1-outside-guard.json`） |
| **工作区护栏（回滚）** | **NEG-5** 造一份 `target` 指向 deployed 的 manifest，`--rollback` 未带 `--allow-outside-workspace` ⇒ 拒绝，`writes=0`，deployed 指纹未变（`raw/neg-5-rollback-outside-guard.json`） |
| **彩排模式** | `--seed --root mirror-b` 先把 deployed **复制**进 mirror 再改 mirror（`raw/step2-applyB.json`，`seed[].sha256_16` 与 deployed 一致） |

### 3.4 实测①：同一 payload 的字段前后对照（真 schema、真 zod）

`tools/probe-chain.mjs`（真 `sessionListValueSchema.parse({items})`）：

| | 宿主写 | 解析后保留 | 值是否与宿主逐行一致 |
|---|---|---|---|
| **修复前**（deployed `f729a994183ae736`） | **99/99** | **0/99** | — |
| **修复后**（candidate `3e2b048565b16e5e`） | **99/99** | **99/99** | ✔ `L1_valuesIdenticalToHost = true` |

- payload 的未知键普查（真数据）：**恰好只有** `runningSubagentCount`（`payloadCensus.unknownKeysInPayload = ["runningSubagentCount"]`），与审计一致。
- 行数不变：**299**（97→ 本 payload 为 99 顶层 + 200 subagent）。
- 审计自带 `scripts/bench-zod.mjs` 复跑亦复现基线：`droppedByFullSchema = ["runningSubagentCount"]`、`extraUnknownKeys = ["runningSubagentCount"]`（`raw/w18-bench-zod-replay.json`）。

### 3.5 实测②：无副作用

**(a) 其余字段逐键逐行等值** —— 对全部 299 行 × 全部 9 个声明键做**深比较**（含 `projections.values` 这种内嵌对象/数组）：
`l1_sentinel.otherDeclaredKeyMismatches = **0**`，`declaredKeyDiffs = {}`（pre/B/C 三配置均为 0）。

**(b) 不引入未知键透传** —— 三条独立证据：
1. 真 schema 的 `_zod.def.catchall` 为空：`schemaIsPassthrough = **false**`（pre 与 post **都是** false）。
2. 注入 canary 键 `__w18b_passthrough_canary__` 后解析：**未泄漏**（`unknownKeyCanary.leaked = false`）。
3. post 行 shape 与 pre 的差集**恰好只有** `runningSubagentCount`（`bench-schema-ab` 的 `preRowShapeKeys` / `postRowShapeKeys`）。

**(c) 声明字段的语义与约束（真 post schema，`raw/field-semantics.json`）**

| 输入 | 结果 |
|---|---|
| 宿主真值（整数 36） | ✅ 保留 `36` |
| 缺省（子代理行） | ✅ 通过（`optin/optout = "optional"`） |
| `0` | ✅ 保留 `0` |
| `-1` | ❌ `too_small`（约束生效） |
| `1.5` | ❌ `invalid_type` |
| `"3"` / `null` | ❌ `invalid_type` |

> **残余风险（诚实标注）**：约束是**严格**的 ⇒ 若宿主将来写入非整数/负数/`null`，`session.list` 解析会**抛错**而不是静默丢字段。
> 已核宿主生产者：`count` 只由 `if (liveStatus.get(childId) === true) count += 1;`（`:1267`）产生 ⇒ 恒为**非负整数**，从不写 `null`。风险判定：**低**，但值得在审计里记一笔。

**(d) 性能同窗 A/B（同进程装载 pre/post 真 schema，交替测量，200 次/轮 × 3 轮）**

| 轮 | pre p50 (ms) | post p50 (ms) | **post÷pre (p50)** | Δ p50 (ms) | loadavg |
|---|---|---|---|---|---|
| 最终轮 1 | 2.0426 | 2.1534 | **1.0542** | +0.1108 | 7.68 |
| 最终轮 2 | 2.0503 | 2.1389 | **1.0432** | +0.0886 | 7.68 |
| 最终轮 3 | 2.0007 | 2.1024 | **1.0508** | +0.1017 | 7.68 |
| 早期 3 轮（同法） | 1.98–2.06 | 2.13–2.17 | 1.0615 / 1.0761 / 1.0526 | +0.108…+0.151 | 7.7–8.1 |

（`raw/bench-schema-ab-*.json` 保留的是**最终一致性轮**的逐轮原始数值；上表「早期 3 轮」为同法早期实测，其文件在最终重跑时被同法覆盖，逐轮 p50 已摘录于上一行。）

⇒ **+2.4%…+7.6%（p50 比值，跨 6 轮实测区间 1.024–1.076），绝对 +0.05…+0.15 ms / 次 505 KB `session.list` 解析**。
（**并发条件下不主张绝对 ms 作基线**；只主张同窗比值。）对照审计实测否决的 `.passthrough()` **+12%**（0.296→0.333 ms）⇒ 本方案更便宜，与审计裁决方向一致。
该解析发生在 **`session.list` RPC 响应到达时**（不是每帧），故绝对量级 ~0.1 ms/次。

### 3.6 实测③：渲染级 / 功能级验收（纪律 3）

`tools/accept-browser.mjs`（headless Chromium，探针锁，只开自己的页面）。**`--shadow <urlRegex>=<file>` 做「影子部署」**：用 `page.route()` 把插件请求换成**补丁后的字节**，让**真实 app** 以补丁版客户端启动——**不改磁盘、不触 HMR**。

| 运行 | 影子 | pageerror | console error | 插件失败界面 | app 渲染 | 影子命中 | 页面可见徽标 | 宿主正值 |
|---|---|---|---|---|---|---|---|---|
| `browser-baseline.json` | 无 | **0** | **0** | **无** | ✔ | — | `[2]` | `[2,9,15]` |
| `browser-A-noshadow.json` | 无 | **0** | **0** | **无** | ✔ | — | `[2]` | `[2,8,13]` |
| `browser-B-shadowW18B.json` | **仅 `dsh-client-connection`（= U-W18B）** | **0** | **0** | **无** | ✔ | ✔（`client.js?rev=23a7e79f44f6`） | `[2]` | `[2,8,12]` |
| `browser-shadowC.json` | `connection` + `runtime`（U-W18B+EXT） | **0** | **0** | **无** | ✔ | ✔（两个 URL 都命中） | （该轮侧边栏被误收起，见下） | `[2,9,16]` |

结论：
- **判据满足**：`pageerror === 0`、console error `0`、**插件失败界面不出现**、app 正常渲染；**`.subagent` 相关界面正常**——Sessions 树里渲染出 `2 个子代理运行中` 的徽标，且该值**等于该行宿主值 2**。
- **补丁不破坏 app**：影子部署（即真的把补丁字节喂给浏览器）下所有渲染级判据仍全绿。
- ⚠️ **诚实标注的局限**：
  1. 侧边栏默认**只渲染"当前会话所在组"的行**（`dsh-client-ui-workspace/lib/client.js:1212` 自动展开当前组；其余组按 `COLLAPSED_SESSION_LIMIT = 5` 折叠，且**未出现** `sessionOverflowButton`）⇒ DOM 里只有 **2 行**会话，宿主正值 `13/8` 的两行**根本未渲染**，故**徽标级 A/B 无法在本档判定**；本档**不据此宣称"DOM 里出现了低报"**。
  2. 一轮运行中 `--expand-groups` 的"展开"正则误命中 `收起侧边栏`（含"收起"）把树藏了，已修为**排除**侧边栏/收起/行内动作按钮并重新跑（`browser-A-noshadow.json` / `browser-B-shadowW18B.json` 为修正后的结果）。
  3. `[data-slot]` 运行时 `display:contents` ⇒ **可见面积恒 0**，探针里已显式注明**不得**据此判失败；本轮未把它当判据。
- **降级说明**：本档**无权重启/强刷用户页面**⇒ 浏览器验证据影子部署 + 现状基线，**不做**"真部署后页面"的断言；`DEPLOY.md` §4 给出协调者落地后应重跑的同一条命令。

---

## 四、U-W18B2（顺手，同批，低风险）交付

### 4.1 问题与做法

`U-PROJ1` 的补丁注释在 `dsh-client-runtime/lib/client.js` **两处**引用了 `:7984`，而真正的 `subscribeAny` 订阅者在 **`:8023`**（偏移 **39** 行，与任务描述一致）：

| 站点 | 行 | 原文 | 改后 |
|---|---|---|---|
| 1 | `:5854` | `whose ONLY listener (:7984) marks the manager list notifier.` | `whose ONLY listener (the \`subscribeAny\` subscriber installed inside \`projectionStore()\`, beside the per-session store mint) marks the manager list notifier.` |
| 2 | `:8347` | `Idempotent with the :7984 subscribeAny path` | `Idempotent with the \`projectionStore()\` subscribeAny path` |

**采纳"符号名"而非"正确行号"**，理由（审计允许并请说明）：
- 行号是**易腐引用**——这份文件已经历 `U-PROJ1` 等改动，同注释里 `:8572`（entryCache）与 `:5689-5693`（`Notifier.ensureFresh`）**已经漂移**（审计实测 `:8572` → 现已 `:8618`）；本单元自己还会让后续行号整体 **+1**。
- 符号名（`projectionStore()` / `subscribeAny`）**在同文件内稳定可 grep**（实测 `subscribeAny` 2 处：定义 `:5798`、唯一监听者 `:8023`），一次修正长期有效。
- 副作用面更小：改注释文本的字符数不影响任何逻辑。

### 4.2 逐字节断言（硬要求）

从真源码里**剥离纯注释行**（`trim()` 后以 `*` / `/*` / `//` / `*/` 开头）后比较：

```
logicBytesBefore       : 314202
logicBytesAfter        : 314202
byteIdentical          : true
sha256_16 before/after : c2293e0c387d57d7 / c2293e0c387d57d7
/* w07-throttle v1 */  : 4 → 4
其它标记               : /* dsh-perf-fix P1 v1 */ 1→1、/* p2ac-fix */ 4→4、return module.exports; 1→1
censusBefore == censusAfter : true
```

⇒ **逻辑代码零改动，只允许注释行变化**；且 `node --check` 通过；行数只增不减（注释行 1→2）。

### 4.3 交付物

| 文件 | sha256_16 |
|---|---|
| `candidates/dsh-client-runtime.client.U-W18B2.js` | `1ac5d41659bd180e` |
| `raw/diff-U-W18B2.patch` | 2 处 hunk，共 21 行 diff |
| `raw/step1-dryrun.json` / `raw/step2-applyB.json` | 上面的断言逐条落盘 |

---

## 五、U-W18B-EXT（**非审计单元**，默认不选中，需裁决）

- 内容（`raw/diff-U-W18B-EXT.patch`，2 处）：
  1. `:9324-9338` `projectList()` 的 byId 白名单追加
     `...entry.runningSubagentCount !== void 0 ? { runningSubagentCount: entry.runningSubagentCount } : {},`
     （与相邻 `agentPreset`/`cwd`/`origin` 行**完全同构**的条件 spread；子代理行没有该键 ⇒ 不加 `undefined` 键）
  2. `:9384` `stableById` 复用谓词追加 ` && previousEntry.runningSubagentCount === entry.runningSubagentCount`
- 候选件：`candidates/dsh-client-runtime.client.U-W18B2+EXT.js`（sha256_16 `a822e97b39e2ae47`）
- 实测效果（§2.3/§2.4）：L3/L4 **0 → 99/99**；截断扫描 **低报/缺口 由 2 行/37 变 0/0**。
- 候选件已实测**不破坏 app**（影子部署 `browser-shadowC.json`：pageerror 0、无插件失败界面、app 渲染正常）。
- 需要裁决的两点：
  1. **是否采纳**（不采纳 ⇒ 验收判据 ② 需改写，见 §2.6）。
  2. 采纳后**行为变化是刻意的**：`runtime:8618` 的 entryCache 比较与本处 `stableById` 谓词都会在"运行中子代理数变化"时真正失配 ⇒ 产生一次 `list.set()` → React commit。
     频率**上界 = 子代理启停事件数**（不是帧率：实测同一会话计数在数分钟内 13→12→16 量级变化），**这正是徽标得以刷新的机制**；不采纳则徽标永远冻在弱口径。

---

## 六、副作用与风险清单（逐条判定）

| # | 项 | 判定 | 证据 |
|---|---|---|---|
| 1 | 解析后其它声明键变化 | **无**（0 处） | `chain-*` 的 `l1_sentinel.otherDeclaredKeyMismatches=0`，逐键深比较 |
| 2 | 未知键透传（passthrough 化） | **无** | `catchall` 空、canary 未泄漏、shape 差集仅 1 键 |
| 3 | 行数/其它 RPC 受影响 | **无** | 299 行不变；仅在 `sessionSummarySchema` 内加一个可选键 |
| 4 | 子代理行（无该键） | **无** | `.optional()`；真 payload 里 200 个子代理行全部照常解析 |
| 5 | 严格约束遇到脏值会抛错 | **低风险，已核宿主恒写非负整数** | §3.5(d) |
| 6 | 解析耗时 | **+2.4%…+7.6%（p50 同窗比值），绝对 +0.05…+0.15 ms/次** | §3.5(d) |
| 7 | `runtime:8618` entryCache 子句由"恒真"变为"真比较" | **刻意、必要、有界**（子代理启停事件频率） | §五 之 2 |
| 8 | UI 徽标行为 | **U-W18B 单独不改变**（L3 仍丢）；EXT 后可走强口径 | §2.3 |
| 9 | HMR | 写客户端插件会触发用户页面热刷新（该时序缺陷已修，见 `exec-hmr/report.md`），但按纪律**落地由协调者执行并要求用户强刷** | §0 纪律 |
| 10 | deployed 文件 | **全程未被本档写入**（开工/收工指纹一致） | `raw/run-all-evidence.log` §0/§12 |

---

## 七、同档自复核（PASS / REWORK）

| 判据 | 结论 | 依据 |
|---|---|---|
| 指纹开工核对 = `f729a994183ae736` | **PASS** | §0 / `raw/run-all-evidence.log` |
| U-W18B 改动 = 审计 §5.4 的一行（不多不少） | **PASS** | `raw/diff-U-W18B.patch` |
| 字段 `undefined → 真值`（同 payload 前后对照） | **PASS** | 99/99，值逐行一致（§3.4） |
| 无副作用（其它字段、非 passthrough、行数） | **PASS** | §3.5 |
| 脚本契约（dry-run / 唯一锚点 / pre-image / `node --check` / 幂等 / 独立回滚） | **PASS** | §3.3 + **5 条否定测试全部 `ok=false, writes=0`** |
| U-W18B2 逻辑零改动 + w07 标记计数不变 | **PASS** | §4.2（剥离注释后逐字节相同） |
| 渲染级判据（pageerror=0 / 无插件失败界面 / `.subagent` 界面正常） | **PASS** | §3.6（含影子部署） |
| **审计验收判据 ②「`:171/286` 强分支可被命中」** | **REWORK** | 仅落 U-W18B 时 **L3/L4 仍 0/99**（§2.3）；需补 `U-W18B-EXT` 或改写判据 |
| 交付完整性（report / 候选件 / 脚本 / DEPLOY / 原始 JSON） | **PASS** | 本文件 + `DEPLOY.md` + `candidates/` + `raw/` |

**总裁决：U-W18B / U-W18B2 落地 = PASS（可直接部署）；审计契约的验收判据 ② = REWORK（需协调者裁决是否并入 `U-W18B-EXT`）。**

---

## 八、证据清单（全部可重跑）

```
bash tools/run-all-evidence.sh     # 12 步：指纹→dry-run→彩排→幂等→EXT→候选件→diff→链路探针→语义→A/B→w18 复跑→注释断言→收工指纹
bash tools/run-negative-tests.sh   # 5 条否定测试（写护栏/指纹/锚点/第三方状态回滚/回滚护栏）
```

| 原始件 | 说明 |
|---|---|
| `raw/run-all-evidence.log` | 一键重跑的完整输出（含开工/收工指纹） |
| `raw/step1-dryrun.json` · `step2-applyB.json` · `step3-idempotent.json` · `step4-applyC.json` · `step4b-applyC-ext.json` | 补丁脚本各阶段报告 |
| `raw/neg-1-outside-guard.json` · `neg-2-fingerprint.json` · `neg-3-anchor.json` · `neg-4-rollback-thirdstate.json` · `neg-4a-setup.json` · `neg-5-rollback-outside-guard.json` | 否定测试（5 条） |
| `raw/chain-pre.json` · `chain-B.json` · `chain-C.json` | L0→L4 全链路探针（含逐键哨兵、canary、截断扫描） |
| `raw/field-semantics.json` | 声明字段语义/约束 |
| `raw/bench-schema-ab-1..3.json` | 同窗 A/B 基准 |
| `raw/w18-bench-zod-replay.json` | **审计自带** `bench-zod.mjs` 复跑（基线复现） |
| `raw/diff-U-W18B.patch` · `diff-U-W18B2.patch` · `diff-U-W18B-EXT.patch` | 统一 diff |
| `raw/browser-baseline.json` · `browser-A-noshadow.json` · `browser-B-shadowW18B.json` · `browser-shadowC.json` | 渲染级验收（4 次，含 2 次影子部署） |
| `raw/session-list-live.json` · `session-list-A.json` · `session-list-B.json` · `session-list-shadow.json` | 页面内抓到的**真实** `POST /api/session.list` 响应（505 KB 级） |
| `preimage/` | 各单元 pre-image + manifest（回滚依据） |
| `mirror-b/` · `mirror-c/` · `mirror-neg4/` | 彩排树（B=U-W18B+U-W18B2；C=B+EXT；neg4=回滚否定测试用；三者均在**工作区内**，与 deployed 隔离） |

---

## 九、未决 / 边界（诚实清单）

1. **验收判据 ② 的处置**未决（§2.6 / 七）——本档按纪律**不自行拍板**。
2. **徽标级 DOM A/B 未做成**：侧边栏只渲染当前组（§3.6 局限 1）⇒ 未能观测到"宿主 13/8 的行在修复前显示 0"。功能级证据由**截断扫描**（§2.4，37→0 vs 37→37）承担；这是**同构复现**该机制，而非页面实测。
3. **性能绝对值不可用**：`loadavg 6.7–11.1`、11 条审计线 + 1 条执行线在飞 ⇒ 只给同窗比值；若需绝对基线，请在安静窗重跑 `tools/bench-schema-ab.mjs`。
4. **宿主侧**：本档未改宿主（`annotateRunningSubagentCounts` 保持原样）；`SUBAGENT_LIST_MAX` 的具体取值未核（只用到"行会截断"这一事实，宿主注释 `:1237-1239` 已自述）。
5. **审计 §5.3 的口径修正**：客户端兜底 `indexSubagentDescendants` 统计的是**已加载的任意深度后代**（沿 `parentId` 上溯），不是"仅直接子代"；真正的差异是"**live 会话表 vs 已下发行**"（截断/未加载）。
6. **`zod` 版本口径**：审计 `bench-zod.mjs` 用 4.6.2，浏览器 bundle 内联 4.4.3（§1）。本档结论基于后者（真出厂字节）。
7. 本档**未**验证"部署后用户页面"的真实渲染（按纪律不由我落地）；`DEPLOY.md` §4 给出落地后必须重跑的命令与判据。
