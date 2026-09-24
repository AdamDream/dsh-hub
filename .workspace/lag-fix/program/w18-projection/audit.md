# w18-projection 审计：投影注册/失效/重算机制与成本 · zod 契约真实开销 · `runningSubagentCount` 被丢弃 · 键路由统一建议 · 前三候选

- 日期：2026-09-22（18:1x–18:4x，**宿主重启后**）
- 线：`program/w18-projection`（本目录独占；**全程只读，未改任何产品文件**）
- 宿主：**旧 `PID 301709`**（已退出）→ **新 `PID 2988915`**（`npm exec @deepseek-ai/dsh web` → `sh -c dsh web` → `node …/bin/dsh web`，**18:11:49 起**），GUI `http://127.0.0.1:3080`
- 纪律：**未重启、未发任何信号、未 strace/gdb、未改产品文件、未使用 `sandbox_permissions`**；未使用探针锁（本线**全程无浏览器**：只用 Node 直连 mux + 离线基准，故无须取锁，也不存在锁事故面）
- 交付：本文件 + `raw/` 原始 JSON + `scripts/` 可重跑基准
- 上游必读：`program/w07-streaming/audit.md`（订阅者清单/键直方图）、`program/w02-host-rpc/audit.md`（宿主侧成本）、`exec-audit/BATCH-PLAN.md` §五（测量协议）
- 现状前提（已落地在线，必须作为基线）：`dsh-client-runtime/lib/client.js` 内 **`/* w07-throttle v1 */` ×4 的「投影键可达性闸门 + rAF 合并」（U-PROJ1）已经部署**

## live 代码根（本报告所有 file:line 均指此树）

`/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`

zod 版本 = **4.6.2**（`dsh/node_modules/zod`，`require.resolve` 实测）；Node **v22.23.2**。

---

## 零、一句话结论

> **① 投影机制本身是健康的、键级闸门也是对的——但「按可达性过滤」这个杠杆比 w07 报告估的 84.7% 小得多：实测只能滤掉 `16% / 13% / 29% / 29%`（四窗）。**
> 原因是**帧量被两个「有真实表层读者、因此必须放行」的键吃掉了**：`subagentTiming`（33–66%）与 `sessionStats`（16–33%）。
> **② w07 那个「zod = JSON.parse 的 5.8×」的头条数字被证伪**：真实客户端两段 zod 链只有 **0.295 ms（0.367× JSON.parse）**；
> 5.02 ms 里 **≈79% 不是 zod**，是 w07 自己测量装置里的 `JSON.parse`/`JSON.stringify`/`structuredClone`/`Response.json()` 往返。
> **③ `runningSubagentCount` 的丢弃点已精确定位**：`dsh-client-connection/lib/client.js:5383-5394` 的 `sessionSummarySchema` 是 `z.object({...})`（**无 `.passthrough()`**）⇒ **99/99 行全被静默剥掉**，而 UI 的兜底路径只是**直接子代**，语义比宿主窄。
> **④ 键路由（w07 M1）与「投影注册表方案」不冲突，但两者都建立在同一个错误前提上**：以为客户端需要一张键表。真正的统一建议见 §四。
> **⑤ 在这一层的可省浪费 ≈ 0.6–0.8% 单核**（客户端列表重建实测 0.101 ms/次 × ≤60 次/s）；**zod 面没有任何值得做的优化**。

---

## 一、口径与证据分级

| 等级 | 含义 | 本报告用法 |
|---|---|---|
| **A 精确事实** | 计数/字节/比例/键集，不依赖负载 | 帧直方图、键集、行数、zod 语义（哪些键被丢）、file:line |
| **B 同窗比值/同进程配对** | 同一进程同一窗口内两件事之比 | `zod ÷ JSON.parse`、`whitelist ÷ total`、`keys/arrival` |
| **C 解析上界** | 用真实数据在 Node 侧复现的同构计算 | 列表重建 0.101 ms/次（**不是浏览器内实测**，见 §六） |
| **D 不可用** | 绝对 ms / ms/s / fps 基线 | 本机 load 6.2–11.1 且并发 1 个外来浏览器 ⇒ 一律标注条件，不作基线 |

**并发条件（诚实声明）**：`loadavg` 采样 **11.10 / 7.02 / 6.16**（探针启动时刻，`raw/_observe-live.log` 同期）；
cmdline 口径抽查（含 `--remote-debugging-pipe` 且不含 `--type=`，排除自身）= **1 个外来浏览器主进程**。
⇒ 本报告**不使用**绝对 ms 作结论；所有性能结论为**比值、占比、为零类**或**解析上界**。

---

## 二、范围①：投影注册 / 失效 / 重算的**完整机制与成本**

### 2.1 谁注册了什么——运行时有注册表（但不是键表）

**必须先纠正一个用词**：w07 报告写「投影键**无运行时注册表**」。这句话对**类型层**成立、对**服务层**不准确：

| 层 | 事实 | file:line |
|---|---|---|
| **类型层（无键表）** | `interface SessionProjectionMap {}` 是**空接口**，全靠各包 `declare module` **声明合并**；运行时**完全擦除** | `dsh-session-projection/lib/types/types.d.ts:16-24` |
| **服务层（有运行时注册表）** | `SessionProjectionRegistry.registrations = new Map()`，按 `key` 存 `{def, cells: WeakMap, refs}`；`refs` 是**引用计数**（同一 tool 包在 N 个 preset 里挂载 ⇒ register N 次，最后一个卸载才删键） | `dsh-session-projection/lib/index.js:39`、`:51-86` |
| **驱动订阅** | 构造函数里一次性 `ctx.on("session/event", (session, event) => this.drive(session, event))` | `dsh-session-projection/lib/index.js:47-49` |
| **唯一闸门** | `if (changed && registration.def.wire !== void 0 && this.listeners.size > 0)` ⇒ 才 `viewSchema.parse(view(next))` + 通知 | **`dsh-session-projection/lib/index.js:294`**（`drive()` 内） |
| **发帧** | `onChanged → broadcast({type:"session/projection", sessionId, key, value, seq})`，**单一键无关通道、无 `subscribed` 守卫**（对照 `session/event` 的守卫 `:3660`） | `dsh-host-apiproxy/lib/index.js:1849-1858` |

**⚠️ 关键结构性事实（本线新发现，w02/w07 均未点出）**：
`drive()`（`:283-300`）对**每一个注册单元**、**在每一个已提交事件上**无条件调用 `def.apply(cell.state, event)`：

```js
// dsh-session-projection/lib/index.js:284-299
drive(session, event) {
  for (const registration of this.registrations.values()) {
    let cell = registration.cells.get(session);
    if (cell === void 0) { cell = this.buildCell(registration.def, session.events.slice(0, event.seq)); registration.cells.set(session, cell); }
    const next = registration.def.apply(cell.state, event);          // ← 无事件类型过滤；逐事件 × 逐单元
    const changed = !Object.is(next, cell.state);
    cell.state = next;
    cell.observedSeq = event.seq;
    if (changed && registration.def.wire !== void 0 && this.listeners.size > 0) { ... }   // ← :294 唯一闸门
  }
}
```

- **`apply` 没有 `advance` 谓词可跳过**：单元表恰为 `key/stateSchema/init/apply/wire/stateVersion`（`…/types/index.d.ts:33-84`），
  **契约上是「不感兴趣必须返回同一引用」**（`.d.ts:52-58` 注释明写）⇒ 跳过责任在**每个 apply 自己**，框架不帮忙。
- ⇒ 宿主主线程上「单元应用」次数 = `Σ_events |registrations|`。**这是一个可算的量，见 §2.4**。

### 2.2 实测注册清单（12 个注册点 / 14 个键）

| 键 | 注册点 file:line | stateVersion | `wire` | 本机四窗是否发帧 |
|---|---|---|---|---|
| `sessionStats` | `dsh-session-stats/lib/index.js:193` | 1 | ✔ `:157-158` | **是**（16.6%–32.8%） |
| `tokenUsage` | `dsh-token-meter/lib/index.js:476` | 1 | ✔ `:320-321` | 是（1.6%–5.5%） |
| `contextPressure` | `dsh-token-meter/lib/index.js:477` | 4 | ✔ `:385-386` | 是（7.9%–14.7%） |
| `contextBreakdown` | `dsh-token-meter/lib/index.js:478` | 2 | ✔ `:201-202` | 是（7.5%–14.5%） |
| `todos` | `dsh-tool-todo/lib/index.js:81` | 2 | ✔ `:90-91` | 是（0.1%–0.5%） |
| `title` | `dsh-session-title/lib/index.js:179` | 1 | ✔ `:184-185` | 是（0.1%） |
| `subagentModelSelectionPolicy` | `dsh-tool-subagent/lib/index.js:407` | 1 | ✔ | **否（0 帧）** |
| `sessionListMetadata` | `dsh-host-apiproxy/lib/index.js:1860` | 1 | ✔ `:1868-1869` | 是（0.003%–0.3%） |
| `imageLimits` | `dsh-host-apiproxy/lib/index.js:1876` | 1 | ✔ `:1881-1882` | **否（0 帧——`apply` 恒返回入参，宿主侧永不改引用）** |
| `subagentTiming` | `dsh-subagent/lib/index.js:2531` | 2 | ✔ `:2149-2150` | **是（32.8%–65.6%，最热）** |
| `subagent`（identity） | `dsh-subagent/lib/index.js:2532` | 2 | ✔ `:2208-2209` | **否（0 帧）** |
| `permissions` | `dsh-permission-presets/lib/index.js:153` | 1 | ✔ `:158-159` | 是（0.1%） |
| `goal` | `dsh-goal/lib/index.js:523` | 4 | ✔ `:528-529` | **否（0 帧）** |
| `llmRetry` | `dsh-llm-retry/lib/index.js:94` | 1 | 见注 | **否（0 帧）** |
| `plan` | `dsh-plan-mode/lib/index.js:161` | 2 | ✔ `:196-197` | **否（0 帧）** |

> 注：`llmRetry` 在 `dsh-llm-retry/lib/index.js:94-96` 只读到 `key`/`stateVersion`，`wire` 的取值未在本行范围内核实（同文件未 grep 到 `wire:`）⇒ 标 **未定**，不影响本报告任何结论。

**两处与 w07 的差异必须记录**：
1. w07 直方图列了 `sessionListMetadata` **22 帧**并称其「唯一读者在宿主 `apiproxy:1294/1336`」；本线四窗 **1–5 帧**，且 w02 §4 已给同一结论。
2. **w07 的直方图漏了 `permissions`（本线实测 3 帧）**，且 w07 报 `imageLimits/subagent/goal/plan` 为 0 —— 与本节一致。

### 2.3 失效与重算：闸门是「按引用」，不是「按值」

`drive()` 的 `changed` 判据是 **`!Object.is(next, cell.state)`**（`:290`）——
⇒ **引用闸门**：单元返回新对象才继续；返回入参引用则零下游工作（这正是 `imageLimits` 永不发帧的原因）。
⇒ 闸门之后还有一层 `wire !== void 0 && listeners.size > 0`（`:294`），
故**没有 wire（宿主专用单元）或没有监听者时不发帧**，但 **`apply` 已经跑过了**（`next` 已算出、`cell.state` 已被更新）。

**失效面（客户端）**——四条路径，全部经 `ProjectionValueStore`：

| 路径 | 位置 | seq 守卫 |
|---|---|---|
| 推帧 `apply(key,value,seq)` | `dsh-client-runtime/lib/client.js:5806-5816` | `if (row !== void 0 && seq <= row.seq) return;`（`:5809`，**低 seq 不覆盖**） |
| 基线播种 `seed(baseline)` | `:5818-5834` | 同上，且基线**缺键 ⇒ 清行**（`asOfSeq` 之后有更新的帧则不覆盖） |
| 代际截断 `truncate(lastSeq)` | `:5836-5848` | 丢弃 `seq > lastSeq` 的行（重启后宿主持久基线不认） |
| 粗通道置脏 `changed(key)` | `:5858-5867` | **U-PROJ1 已加键闸门**，见 §四 |

**实测 seq 单调性（A 级，四窗）**：`seqRegressions = 0`、`seqEqual = 0`（`raw/proj-observe*.json`）
⇒ 「低 seq 不覆盖」的守卫在**本机四窗内从未被触发**，但也未观测到乱序，属**零类证据**（守卫是正确的防御，不是当前热点）。

### 2.4 重算成本：宿主侧是 `Σ_events × 14`，客户端侧是「每帧一次全表重建」

**宿主侧（B 级，可算量）**，取 `raw/proj-observe-live.json`（120 s，宿主 2988915）：

| 量 | 值 |
|---|---|
| `session/event` | **5 925 / 120 s = 49.4 /s**（其中 `assistant/chunk` 占 **80.6%**） |
| 注册单元数 | **14** |
| ⇒ **单元应用（`apply` 调用）** | **49.4 × 14 = 692 /s**（≈ 2.4 M / 小时） |
| ⇒ 每帧发出的**宿主侧** `viewSchema.parse` | 34.0 /s（`session/projection` 33.98 /s） |

**注意「chunk 不是投影的驱动者」这一结论的边界**：`assistant/chunk` **不是 surface event**
（`SURFACE_EVENT_TYPES = {user/message, assistant/message, tool/result}`，`dsh-session/lib/index.js:219-222`），
**但它仍然是 `session/event`**，因此**仍然驱动全部 14 个单元**——
`.dsh:266-267` 的「非 surface 事件不产生**消息**」只说 surface 层，不代表不驱动投影。
⇒ 80.6% 的驱动量来自 chunk，而 chunk **基本不改变任何投影状态**（各 apply 都返回入参引用），
**这是本层最大的「零结果工作」**。

**客户端侧（C 级解析上界）**，`scripts/bench-rebuild.mjs`（真实 299 行样本，`raw/w18-rebuild-bound.json`）：

| 阶段 | p50 |
|---|---|
| S1 `buildListSnapshot` 的 299 行 spread + title/bag 注入 | **0.0498 ms** |
| S3 `flattenLineage` 等价（Map + 展开） | **0.0122 ms** |
| S6 `entryCache` 14 字段比较（299 行） | **0.039 ms** |
| ⇒ **一次粗重建合计** | **≈0.101 ms** |
| ⇒ U-PROJ1 的 rAF 合并把重建数从「投影帧数」降到「≤刷新率」⇒ **≤60 × 0.101 = 6.1 ms/s** | **≈0.61% 单核** |

> **这个量与 w07「≈19 000 行访问/s、≈64 次 `list.set`/s」不冲突但含义完全不同**：
> 19 000 行访问/s 是**每帧一次全表**的代价，而经过 U-PROJ1 的 rAF 合并后，
> **全表重建次数不再随投影帧率增长**（投影帧 33.98/s，但重建 ≤ min(可达帧率, 刷新率)）。
> ⇒ w07 §3「84.7% 帧没有表层读者却每次都跑完整表重建 ⇒ ≈19 000 行访问/s」这句话，
> 在 **U-PROJ1 已上线的今天已不再成立**（重建被帧批处理吸收）。

### 2.5 ① 的裁决

1. **注册/失效/重算机制已完整确证**，含 12 个注册点、14 个键、唯一闸门 `:294`、四条客户端失效路径与 seq 守卫。**PASS**
2. **「无运行时注册表」应改述为「无运行时*键*表（类型层空接口 + 声明合并），但服务层有 `registrations` Map（键 + 引用计数）」**。**PASS（含纠正）**
3. **最大的结构性浪费 = 逐事件 × 14 单元的 `apply` 全量驱动，其中 80.6% 的驱动量来自不改变任何状态的 chunk**（692 次 apply/s）。**PASS**
4. **客户端列表重建成本 ≈0.101 ms/次、≤6.1 ms/s（0.61% 单核）**，且在 U-PROJ1 之后已与投影帧率脱钩 ⇒ **这一层没有杠杆**。**PASS**

---

## 三、范围②：zod 契约的**真实**开销——**「5.8×」被证伪**

### 3.1 先看 w07 的原始数据自证：5.02 ms 里大部分不是 zod

`raw/w07s-bigresponse-bench.json`（w07 自己的产物）已经把答案写在盘上了，只是没被读出来：

| 阶段 | p50 | 含义（按 w07 脚本 `tools/bench-bigresponse.mjs` 注释） |
|---|---|---|
| A `JSON.parse` | **0.867 ms** | 基准 |
| B 信封 zod（预解析对象） | 0.867 ms | ——即 **A 与 B 都是 `JSON.parse + parse` 的复合量**，两者相等（比值 = 1.000） |
| **C `C_webapiclient_call`** | **5.020 ms** | **整个 `client.sessions.list()` 方法调用**（含 stub 传输往返） |
| **C_HARNESS** | **1.691 ms** | **w07 自证的「装置开销」对照**：`JSON.parse(text); o.rpcId='x'; JSON.stringify(o)` |
| **C_JSON_ONLY** | **1.687 ms** | **不含任何 schema parse** 的 `Response.json()` 口径 |
| C ÷ A | **5.789** | w07 报告引用的「5.8×」 |
| **C_harness_overhead ÷ C** | **0.337** | w07 自己标注「装置开销占 33.7%」 |

⇒ **5.020 − 1.687 = 3.333 ms（66.4%）与 schema 无关**；w07 自己的两个对照都指向同一结论，但报告 §4 仍把 C 写成「整响应 zod」。

### 3.2 本线独立复算：真实 zod 链 = 0.295 ms（**÷JSON.parse = 0.367**）

`scripts/bench-zod2.mjs` + `bench-zod.mjs`（**同一进程、真实 505 088 B / 299 行样本、80–100 reps、20 次预热**），
schema 按部署原样重建（`dsh-client-connection/lib/client.js:5383-5399`、`:5495-5498`；zod 4.6.2）：

| 阶段 | p50 | ÷ A |
|---|---|---|
| A `JSON.parse(text)` | **0.8059 ms** | 1.000 |
| B **外层** `serverResponseSchema.parse(parsed)`（`result.value` = `z.unknown()`，rpc.schema.js:90-94） | **0.0007 ms** | **0.0009** |
| C **内层** `sessionListValueSchema.parse(parsed.result.value)` | **0.2949 ms** | **0.366** |
| **D 真实 `callUnary` 链**（`JSON.parse` → 外层 → 内层，`client.js:6356-6364`） | **1.1378 ms** | **1.412** |
| E `JSON.stringify(envelope)` | 0.8389 ms | 1.041 |
| F `structuredClone(parsed)` | **1.5925 ms** | **1.976** |
| G `JSON.parse(JSON.stringify(parsed))` | 1.6989 ms | 2.108 |

**`raw/w18-zod-decomp.json` 交叉验证**：`B_inner_schema_full`（仅内层 schema）p50 **0.2963 ms**、
`A_json_parse` **0.839 ms** ⇒ **B ÷ A = 0.353**（与 3.2 的 0.366 **同向一致**，2/2）。

### 3.3 差异归因（**这是本范围最重要的交付**）

| 候选原因 | 裁决 | 证据 |
|---|---|---|
| 不同 schema（客户端 vs 宿主） | **主因之一** | w02 量的是 `UNARY_VALUE_SCHEMAS['session.list']`（内层，0.76 ms）；w07 量的是**整个 WebApiClient 方法**（外层+内层+传输+装置） |
| **测量装置本身的开销** | **主因（≈66%）** | w07 自证：`C − C_JSON_ONLY = 3.333 ms`；`C_HARNESS ÷ C = 0.337`；本线独立复算 `structuredClone = 1.98×A`、`stringify+parse = 2.11×A` |
| 把 `JSON.parse` 计入 zod | **主因之一** | w07 的 A 与 B 都是「parse + schema.parse」复合量（比值恰 1.000）⇒ 「zod ÷ JSON.parse」的分母/分子口径不纯 |
| 不同 zod 版本 / 冷 JIT / rep 数 | 否 | 同树同版本 4.6.2；两档均 60 rep 且**都有预热**（w02 `raw/codec-*.json` 亦为 60 rep） |
| `safeParse` vs `parse` | 否（未见证据） | 两档都调 `.parse` |

> **裁决**：**w07 §4 的「整响应 zod p50 5.02 ms（C÷A=5.8×）」应撤回并改写为**
> **「真实客户端两段 zod 链 p50 ≈0.295 ms（0.367× JSON.parse）；5.02 ms 的读数 ≈66% 来自测量装置（自证 1.691 ms 对照），不是产品代码。」**
> **w07 C4 的「逐帧解码 zod÷JSON.parse = 0.314（<1）」与本节 0.367 同向** ⇒ 该报告的两处 zod 结论**互相矛盾**，`<1` 那处才是对的。

### 3.4 `projections` 载荷**根本没有被深层校验**（关键误解）

```
// dsh-client-connection/lib/client.js:5491-5498
/** Projection baseline passthrough: `values` stays a wide record — each value
 *  was already parsed by its provider's own schema on the host side, and
 *  deep-validating here would import every domain's schema into the carrier. */
const sessionProjectionsBlockSchema = object({ asOfSeq: number().int().min(-1), values: record(string(), unknown()) });
```

⇒ 每行 13 个投影键的值走 `z.record(z.string(), z.unknown())`，**零深校验**。
实测：`H_proj_block_only`（单行 projections 块）p50 **0.0009 ms**、`I_values_unknown_record` **0.0093 ms**。
⇒ **w02 §1.2 表中「投影快照（13 个 wire 单元 × 299 行，逐值 `viewSchema.parse`）≲1 ms」是宿主侧**的读数，
与客户端这一层无关；**客户端从未对投影值做二次校验**。

### 3.5 可优化面与最小改法（**结论：没有值得做的**）

| 候选改法 | 实测/上界收益 | 裁决 |
|---|---|---|
| **schema 复用/预编译** | **已被做掉**：`sessionListValueSchema`、`sessionSummarySchema`、`UNARY_VALUE_SCHEMAS` 全部是**模块作用域常量**（`client.js:5383/5396/6214`），**每次调用零重建**；唯一 `lazy()` 是 `projections` 的自引用延迟绑定（`zod.lazy` 内部有缓存），不在热路径 | **无需修改** |
| **行 schema 加 `.passthrough()`**（顺带修 `runningSubagentCount`） | **逆向收益**：`G_inner_schema_passthrough` p50 **0.333 ms** > `B` 0.296 ms ⇒ **改后会慢 0.037 ms**（+12%）。原因：保留未知键要做额外拷贝。**但它换来 §四之外的字段修复** | **仅作为 §五③ 的附带决议**，不作为性能项 |
| **按需/惰性校验**（只校验渲染到的行） | 上界 = **0.295 ms 全部省掉**；代价是把「坏行在解析期拒绝」变成「渲染期才炸」，**契约弱化** | **否** |
| **`z.record(unknown)` → 跳过 projections 块** | 该块已 **0.0009 ms** | **否（已为零）** |
| **去掉内层 schema** | 上界 0.295 ms ≈ 客户端解析链的 **26%**、**≤0.30 ms/s（0.003% 单核）** | **否** |

> **② 的裁决**：**w07 的「大响应 schema 校验才是 zod 值得优化的面」被证伪**。
> 正确结论：**zod 在本产品里已经不是一个成本项**（两段链 0.295 ms / 505 KB，占客户端解析链 26%，占主线程 ≈0）。
> **可优化面 ≈ 0；最小改法 = 不改。** 任何以「zod 5.8×」为依据的批次都不应批准。

---

## 四、范围④：键路由过滤（w07 M1）与「注册表方案」是否冲突——**统一建议**

### 4.1 现状：闸门**已经上线**，且实现是**对的**

`dsh-client-runtime/lib/client.js` 四处 `/* w07-throttle v1 */`（U-PROJ1）：

| 位置 | 实现 |
|---|---|
| `:5732-5757` | `LIST_REACHABLE_PROJECTION_KEYS = new Set(["title","sessionStats","subagentTiming","tokenUsage"])` + **27 行逐键证据注释**（含每个键的读者 file:line 与「为何不在集合内」） |
| `:5850-5866` | `changed(key)`：非白名单键 **只** `channels.get(key)?.notifier.markDirty()` 后 `return`（**不**清 `valuesCache`、**不**置脏 `anyNotifier`） |
| `:8023-8026` | `store.subscribeAny(() => { /* w07-throttle v1 */ … this.notifier.markFrameDirty(); })`（原 `markDirty`） |
| `:8344-8350` | 推帧分支：`apply(...)` 之后 **`if (LIST_REACHABLE_PROJECTION_KEYS.has(frame.key)) this.notifier.markFrameDirty();`** |

**本线独立复核（A 级）——白名单是完整的**：

- **粗 `values()` 袋子的全部读者**（全部署 grep，`:5788` 定义）：**只有一处**——`buildListSnapshot():8603`。
  该袋子被喂给 `merged` → `entryCache` 比较（`:8618`）→ `items` → `projectList` → `list.set`（**`:9421`**）。
- 其余读者**全部走 per-key face**（`rows.get(key)`，`:5782`/`:5874`），**不受闸门影响**。
- **`subscribeAny` 全局只有一个调用点**（`:8023`，`projectionStore()` 内）⇒ 闸门「不置脏 `anyNotifier`」的影响面**恰好一处**。
- **袋子键的实际消费者**：`dsh-client-ui-subagent/lib/client.js:79`（`sessionStats`）、`:90`（`subagentTiming`）、`:269`（`tokenUsage`），
  加 `runtime:8602` 的 `get("title")` ⇒ **恰好等于白名单**。
- **不在白名单的键确无袋子读者**（`contextPressure`/`contextBreakdown` → `ui-conversation:3099/3100`；`todos` → `:6654`；`permissions` → `:3615` + 命令式 `faceOf().getSnapshot()`；`plan`/`goal`/`imageLimits` → face 或命令式；`sessionListMetadata` 客户端零读者）——**与实测 grep 一致**。
- **`valuesCache` 陈旧性风险已封闭**：非白名单键改值后 `valuesCache` 不清，但该缓存**只有** `:8603` 一个读者，
  且该读者只取白名单键 ⇒ **无陈旧读取面**。✅

**⚠️ 但注释里有一处描述不准确（不影响正确性）**：`:5786-5789` 的 `valuesCache` 是**浅**缓存，
zod 在 `:5383` 的 `object()` 里**每个响应都会重建 `projections` 与 `projections.values` 容器**
（实测：`values` 对象引用 **298/298 全部是新对象**，而叶子 `values.sessionStats` 引用 **298/298 保留**）。
⇒ 缓存失效仍然是**必要的**；同理 w07 报的 `nestedValueIdentityPreserved: true` **只对叶子成立**，对两层容器不成立。

**🔴 新发现（低危但必修）：U-PROJ1 的补丁注释引用了两个**已经失效**的行号。**
补丁在 `:5854` 与 `:8347` 两处写「the coarse any-key channel, whose ONLY listener (`:7984`) marks the manager list notifier」，
但**当前 `:7984` 的内容是 `session.handleBlank(summary.blank);`**——真正的 `subscribeAny` 注册在 **`:8023`**（**偏移 39 行**）。
`anyNotifier` 的**唯一**监听者确实只有一个（`:8023`，本线全局 grep 确认），所以**逻辑判断没错**，
但注释给的锚点会误导后续读者去查一个无关的行。⇒ **建议随 U-PROJ1 的后续批次把 `:7984` 改写成 `:8023`（或删掉行号只写函数名）。**

### 4.2 冲突判定：**不冲突**，但两者共同踩了同一个错误前提

- **不冲突**：`registrations` 注册表是**宿主侧**的（`dsh-session-projection`），
  `LIST_REACHABLE_PROJECTION_KEYS` 是**客户端侧**的常量集合。二者是**生产端**与**消费端**，维度不同、无重叠。
- **共同错误前提**：w07 M1 的立论是「**表层**只读 `title`，其余键无表层读者 ⇒ 可按键过滤」，
  但**实测统计被算错了**——`subagentTiming` 与 `sessionStats` **确实有表层读者**（已进白名单），
  而它们在帧量里占 **33–66%** 与 **16–33%**。w07 §6 候选 1 的收益段写
  「84.7% 帧（`contextPressure` 830 + `contextBreakdown` 825 + **`sessionStats` 1823** + `sessionListMetadata` 22 = 3 500/5 736）」——
  **这一行把 `sessionStats` 算进了「可滤」，却在同一段的白名单里要求保留它**（「必须保留 `subagentTiming`」）。两者不能同时成立。

### 4.3 **统一建议**

> **统一口径：把「键是否需要路由」定义为「该键是否被*当前挂载的*表层读者消费」，且这张表必须由*注册端*声明，而不是由*消费端*靠 grep 推导。**
>
> 具体三步（**全部热面、可独立回滚**）：
> 1. **保留 U-PROJ1 现状**（客户端白名单 + rAF 合并 + per-key face 不变量）。它是**正确且低风险**的，
>    且 `changed()` 的两个分支都无条件走上面子行（`:5861`/`:5864`），**每个 `useProjection(key)`/`faceOf(key)` 消费者的投递时机完全不变**。
> 2. **把白名单从「客户端常量」升级为「由宿主投影注册表随帧携带的能力位」**：
>    单位定义里新增可选 `surfaceConsumers?: readonly string[]`（或更弱的 `listSurface?: boolean`），
>    宿主在 `onChanged → broadcast` 时把该位下发；客户端据此决定是否置脏粗通道。
>    **收益**：白名单不再依赖对别包 `lib/*.js` 的 grep（今天它靠 27 行注释里的 file:line 硬编码；
>    任何插件新增 `projectionValues?.[k]` 读者都会**静默失效**，且**没有任何测试会红**）。
>    **成本**：协议加一个可选字段 ⇒ **冷面**（宿主+客户端同步升），需版本兼容分支。
> 3. **除非 §4.4 的条件满足，否则不要再扩大过滤面**——因为可滤空间只有 **13%–29%**，而每扩大一格都要重新论证「该键确无袋子读者」。

### 4.4 修正后的收益上界（**必须替换 w07 的 1.19 → 0.18 预期**）

| 窗 | 宿主 | `whitelist ÷ total` | **被滤掉** |
|---|---|---|---|
| W1 15:19（90 s） | 301709 | 1 464 / 1 744 | **16.1%** |
| W2 18:32（90 s） | 301709 | 1 480 / 2 096 | **29.4%** |
| W3 18:39（120 s） | **2988915** | 2 426 / 3 398 | **28.6%** |
| （W0 w07 90 s） | 301709 | 5 736 − 3 500（含 `sessionStats` **误算**） | w07 报 84.7% ⇒ **不可用** |

combined `commits ÷ 投影帧`：`1.190` → **`≈1.190 × 0.714 ≈ 0.85`**（最好情形 `×0.71 ≈ 0.85`；四窗比值 **0.706–0.839**）
⇒ **`1.19 → ≈0.85`，不是 `0.18`**。**w07 预注册阈值①（≤0.30）在「按可达性过滤」这一条腿上不可能达标**（差 2.8×）。
达标需要别的杠杆，见 §六。

---

## 五、范围③：`runningSubagentCount` 被客户端丢弃——完整因果与最小修复

### 5.1 生产者链（宿主侧）

| 环节 | file:line | 事实 |
|---|---|---|
| 聚合函数 | `dsh-host-apiproxy/lib/index.js:1234-1275`（`/* dsh-lag-fix B1 */` 注释 `:1234`，函数 `annotateRunningSubagentCounts(ctx, items)` `:1244`） | 沿「不间断 subagent 血缘链」BFS 统计 running 后代 |
| 写入 | `:1271` `item.runningSubagentCount = count;`（`:1272` 前有 `if (item.origin === "subagent") continue;` ⇒ **只写顶层行**） | —— |
| 调用点 | **`:2321` `return annotateRunningSubagentCounts(ctx, retained);`**（唯一调用点） | 在 `session.list` 的保留行集合上执行 |
| 线上证据 | 真实 505 KB 响应（`raw/session-list-499k.json`）：**99/99 顶层行带该字段**，示例值 **36** | A 级 |

### 5.2 丢弃点（客户端侧，**精确 file:line**）

```
// dsh-client-connection/lib/client.js:5383-5394   (在 :5396 sessionListValueSchema = object({items: array(sessionSummarySchema)}) 之上)
/** SessionSummary row of session.list (`projections` reuses the history block's shape and schema). */
const sessionSummarySchema = object({
  sessionId: sessionIdSchema, updatedAt: number(), running: boolean(), blank: boolean(),
  parentSessionId: sessionIdSchema.optional(), origin: literal("subagent").optional(),
  cwd: string().optional(), agentPreset: string().optional(),
  projections: lazy(() => sessionProjectionsBlockSchema).optional()
});                      // ← 没有 .passthrough() / .catchall() ⇒ zod 默认剥离未知键
```

**可运行证明**（`raw/w18-zod-decomp.json` 的 `schemaSemantics`，由 `scripts/bench-zod.mjs` 生成）：

```
rows total            : 299
rows WITH the field   : 99      (全部 top-level 行；子代理行本来就没有)
rows AFTER zod parse  : 0       <-- 静默丢弃
payload 里超出声明行 shape 的未知键 : ["runningSubagentCount"]   ← 恰好只有这一个
```

⇒ **`dsh-client-connection/lib/client.js:5383-5394` 的 `sessionSummarySchema` 是唯一丢弃点**，
`bench-zod.mjs` 量化：**`rowDroppedUnknownKeys = ["runningSubagentCount"]`，99 → 0**。

**旁证**：该字段**根本没写进客户端的 wire 契约**——它不在 `sessionSummarySchema` 里，
只存在于宿主的**运行时代码**（`:1271`）与 `lib/types/api-proxy.js:385-422`。
⇒ 「宿主发了、客户端 schema 不认识」这件事**在类型层就没有一致性保证**。

### 5.3 下游后果（**w07 的说法需要修正两处**）

1. **w07 说「`entryCache`（`runtime:8572`）仍在比较该字段，恒为 `undefined` ⇒ 比较恒真、无功能影响」**：
   - 行号已漂移到 **`:8618`**（U-PROJ1 之后）；
   - **「比较恒真」这一半正确**：`prev.runningSubagentCount === entry.runningSubagentCount` 两侧同为 `undefined` ⇒ 该子句恒真，**不产生额外失配**；
   - **结论正确**：它**不**导致新的 `list.set`。
2. **真正的后果不在 runtime，而在 UI**（w07 未提）：`dsh-client-ui-workspace/lib/client.js` 有**四个**消费点：
   ```
   :171  runningSubagentCount: typeof s.runningSubagentCount === "number" ? s.runningSubagentCount : (descendants.get(s.id)?.runningCount ?? 0),   /* dsh-lag-fix B1/C1 */
   :286  runningSubagentCount: typeof summary.runningSubagentCount === "number" ? summary.runningSubagentCount : (descendants.get(summary.id)?.runningCount ?? 0),
   :561  const subagents = node.runningSubagentCount === 0 ? void 0 : { ... }
   :563  label: t(node.runningSubagentCount === 1 ? "status.subagentsRunning.one" : "status.subagentsRunning.other", { n: node.runningSubagentCount })
   ```
   ⇒ **因为宿主字段恒被剥掉，`:171`/`:286` 的 `typeof === "number"` 恒假**，永远走兜底
   `descendants.get(id)?.runningCount ?? 0`。
   **兜底与宿主的语义差**：宿主 BFS 沿**不间断 subagent 血缘链**计数（可跨多层），
   兜底只读**已加载目录里的直接子代**的 running 数 ⇒ **对深层/未展开的子代理树会低报，对未加载目录直接报 0**。
   ⇒ SDK/UI 里那个「N 个子代理运行中」的徽标**长期走的是弱口径**。这是**功能性缺陷，不只是"字段丢失"**。

### 5.4 最小修复（三个选项 + 裁决）

| 选项 | 改动形状 | 收益 | 风险 / 面 |
|---|---|---|---|
| **(a) 在 `sessionSummarySchema` 声明该字段** | `:5393` 后加一行 `runningSubagentCount: number().int().nonnegative().optional(),` | 字段到位，UI 走强口径 | **最低**。类型层与宿主一致；**热面（刷新即生效）**；单行回滚。**推荐** |
| (b) 加 `.passthrough()` | `:5394` 的 `})` → `}).passthrough()` | 字段到位 | **中**：放行该 schema 的**一切**未来未知键 ⇒ 契约悄悄变宽，且实测**慢 +0.037 ms**（§3.5）。**不推荐单独使用**（若与 (a) 合并则 (a) 已足够） |
| (c) 两端删字段（承认它是死字段） | 删宿主 `:1271` 与 `:2321` 调用 | 省掉一次 BFS | **不建议**：§5.3 已证明 UI **确实需要**它，只是走的弱口径 ⇒ 删了会让弱口径变成永久口径 |
| (d) 改 `entryCache` 字段表 | 从 `:8618` 删 `runningSubagentCount` 子句 | 无功能变化（恒真子句） | **收益为零**，仅清理噪音 |

> **③ 的裁决**：**根因 = 客户端 wire schema 未声明该字段（`:5383-5394`），与宿主发送无关。**
> **最小修复 = (a) 一行**，热面、可单行回滚。
> **验收判据（可观测）**：
> ① 修复后 `session.list` 响应经客户端 schema 解析后 **99/99 顶层行保留 `runningSubagentCount`**（重跑 `scripts/bench-zod.mjs`，`droppedByFullSchema` 应为**空数组**）；
> ② UI 侧 `dsh-client-ui-workspace/lib/client.js:171/286` 的 `typeof === "number"` 分支**可被命中**（探针在 `Object.is` 前打点或直接断言该字段非 `undefined`）；
> ③ **哨兵**：`items[]` 其余字段逐行等值、`sessionList` 行数不变 299（97 顶层 + 202 subagent）、`/usage` 九路不受影响。
> **附加证据需求**：`runningSubagentCount` 应**补进 `sessionSummarySchema` 的注释与契约来源**，否则下次任何 schema 重构会再次静默丢掉它。

---

## 六、范围⑤：前三优化候选

> **预注册阈值（先立后测）**：① `commits ÷ 投影帧` 由 1.190 降到 **≤0.30**；
> ② `commits ÷ chunk 帧` **不上升**（≤现状 ×1.05）；③ `list.set` 次数/s **降 ≥70%**；
> ④ 整树 `wholeFiber÷commit` **不上升**；⑤ `client-runtime` 同窗占比**不上升**；
> ⑥ 哨兵：`rafP50` 保持 16.7 ms 档、`session.list` 299 行齐全、`/usage` 九路仍出数、**子代理行耗时列仍刷新**。
> **并发口径**：本机 `loadavg 6.2–11.1`、外来浏览器 1 ⇒ 绝对值不可用，**所有验收必须同窗 before/after 各 ≥2 窗**。

### 候选 1（**本线首选**）：按「事件的**可影响性**」给 `apply` 驱动加**单元级事件类型过滤**（宿主侧）

- **问题锚点（实测）**：`dsh-session-projection/lib/index.js:284-299` 的 `drive()` 逐事件 × 全部 14 单元调用 `apply`；
  实测 **49.4 event/s × 14 = 692 apply/s**，其中 **80.6% 的驱动量是 `assistant/chunk`**，而
  `assistant/chunk` **不是 surface event**（`dsh-session/lib/index.js:219-222`）⇒ 对绝大多数单元恒为「返回入参」的空转。
- **最小实现（两步，可分别开关，独立标记 `/* w18-advance v1 */`）**：
  1. `ProjectionDefinition` 新增**可选** `advance?: (event: SessionEvent) => boolean`；
     `drive()` 在 `:290` 前插入 `if (registration.def.advance !== void 0 && !registration.def.advance(event)) continue;`
     **未声明 `advance` 的单元行为逐字节不变**（向后兼容）。
  2. 只给**最热的 3 个单元**声明：`subagentTiming`（对 `turn/start|turn/end|subagent/descriptor` 之外**仅在 active 时**才需要）、
     `sessionStats`、`contextPressure`/`contextBreakdown`（按各自 apply 里真实读到的 `event.type` 推导，**逐单元从代码事实抄，不猜**）。
- **收益**：上界 = 砍掉 **80.6% 的 apply 调用**（692/s → **≈134/s**）。
  ⚠️ **但注意**：单次空转 `apply` 极便宜（一次比较 + 返回引用），**本线未测得它的绝对成本**（§七 INCONCLUSIVE）
  ⇒ **收益量级只能声明为「消除 2.4 M 次/小时的零结果调用与随之而来的 `cell.observedSeq` 写」，不是「省 X% 主线程」。**
- **风险**：**中**。`advance` 与 `apply` 是**两份必须同步的真相**；漏一个事件类型 = **该键永久静默不更新**（无测试会红）。
  ⇒ 必须配**等价性断言**：同一份真实事件流，走「有 advance」与「无 advance」两条 `drive()`，逐 `(session,key,seq,value)` 全等。
- **验收**：① 上述等价性断言 **PASS**（用离线事件流，可 100% 覆盖）；② 宿主侧 `apply` 调用计数（打点）下降 ≥70%；
  ③ 哨兵：`subagentTiming`/`sessionStats`/`contextPressure`/`contextBreakdown` 的**帧数与 seq 单调性不变**（mux 观测器四窗对照）。
- **回滚**：`advance` 是可选字段 ⇒ **删掉 3 个单元的声明即完全回退**，`drive()` 的那一行可保留。**冷面**（宿主，需重启）。
- **热冷面**：**冷**。

### 候选 2（**本线次选，且是唯一能触及阈值①的杠杆**）：把「键路由」的**粒度从「键」下沉到「键 × 会话」**

- **问题锚点**：U-PROJ1 生效后，粗重建成本已与投影帧率脱钩（≤60 次/s），但**每一次粗重建都重算全部 299 行**
  （`runtime:8600-8635` 的 `this.summaries.map(...)`），**而一次 `list.set` 只为「确实变了的那几行」服务**。
- **最小实现**：`changed(key)` 命中白名单时，除置脏外**记录 `sessionId`**；
  `buildListSnapshot()` 改为**增量**：只对「被标记的 sessionId」重算 entry，
  其余 entry 直接从 `entryCache` 复用（`entryCache` 已经存在，`:7841-7843`）。
  等价性由「未标记的 entry 其输入未变」保证（`summaries` 未变 + 该 session 的白名单键未变）。
- **收益**：把 O(299 行)/次 降到 O(变更行数)/次。**解析上界**：0.101 ms → 约 **0.001–0.01 ms**（按每次 1–5 行变更估）。
  ⚠️ **但仍不改变 `commits ÷ 投影帧`**（`list.set` 次数由「有可达键变更的帧数」决定，不由行数决定）
  ⇒ **阈值① 仍然达不到 ≤0.30**。它是「降单次成本」，不是「降提交次数」。
- **风险**：**中高**。增量快照极易产生**陈旧行**（例如 `summaries` 在 `refreshList` 后整体替换、`prevRunning`/`completedNotifications` 影响 `flattenLineage` 的 `running`/`completed` 派生列——这些**不在** `projectionValues` 里）。
  ⇒ 必须先把「entry 的输入集合」穷举出来（至少 `summaries`、`addresses`、`catalogs`、`jobsBySession`、`pendingInteractions`、`completedNotifications`、`prevRunning`）。
- **验收**：① **快照等价**：增量版与全量版 `items` 逐字段全等（同一 299 行样本 + 随机 1..50 帧变更序列，≥1 000 组合）；
  ② ②③⑤ 阈值不劣化；③ 哨兵同候选 1。
- **回滚**：`buildListSnapshot` 单函数回滚（保留旧的 `entryCache` cleanup 块）。**热面（刷新即生效）**。

### 候选 3（**低风险收尾，非收益项**）：把 U-PROJ1 的白名单从「客户端 grep 常量」改为**宿主能力位**

- **问题锚点**：`:5732-5757` 的白名单是**对另外 6 个包的 `lib/*.js` 做 grep 得出的硬编码**。
  **任何插件新增 `summary.projectionValues?.[k]` 读者，都会静默落在闸门外，且没有任何测试会红。**
- **最小实现**：`ProjectionDefinition` 增可选 `listSurface?: boolean`；宿主 `onChanged → broadcast` 时下发该位；
  客户端 `LIST_REACHABLE_PROJECTION_KEYS` 改为「按帧携带的位」判定（保留常量作**无位时的缺省**，兼容旧宿主）。
- **收益**：**不是性能收益，是正确性防退化**。当前 4 个键已对齐，故**收益 = 0**；防的是未来。
- **风险**：**低**（缺省回退常量 ⇒ 行为不变）。**冷面**（宿主+客户端同步升）。
- **验收**：① 位下发后，客户端判定结果与现常量**逐键一致**（4/4）；② 人为给一个非白名单键打上该位后，
  该键**能**触发粗重建（证伪「位被忽略」）；③ 旧宿主（无该字段）下行为与现状一致。

### 明确**不做**（并给理由）

- **不做 zod 相关的任何优化**：真实成本 **0.295 ms / 505 KB**（§3.2、§3.5），可优化面 ≈0。**以「zod 5.8×」为依据的批次不应批准。**
- **不扩大 U-PROJ1 的过滤面**：可滤空间实测只有 **13%–29%**（§4.4），且每扩一键都要重新证明「确无袋子读者」。
- **不改 `subagentTiming` 的 `through` 语义**（虽然它占 33–66% 帧）：`dsh-client-ui-subagent/lib/client.js:94-97` 的
  `activityDuration()` **确实**在 `activity !== "running"` 时读 `timing.active.through`
  ⇒ 删掉 `through` 更新会**冻结**该行耗时显示。**收益诱人但语义风险不可接受**，除非先证明 UI 的 `activity`
  与宿主 `active` 区间**同生命周期**（本线未证，见 §七 INCONCLUSIVE）。

---

## 七、逐条 PASS / FAIL / INCONCLUSIVE

| # | 命题 | 判定 | 依据 |
|---|---|---|---|
| **①-A** | 投影注册机制（谁注册了什么）完整确证：12 注册点 / 14 键 / `refs` 引用计数 | **PASS** | §2.2 逐点 file:line；`:39`/`:51-86` |
| **①-B** | 「无运行时注册表」的精确化：**类型层无键表**（空接口 + 声明合并），**服务层有 `registrations` Map** | **PASS（含纠正）** | `types.d.ts:16-24` vs `index.js:39` |
| **①-C** | 失效/重算闸门是**引用闸门** `!Object.is(next, cell.state)`，唯一闸门在 `:294`；无 `advance` 谓词 | **PASS** | `index.js:283-300`；`.d.ts:52-58` |
| **①-D** | 重算成本：宿主 `Σ_events × 14 = 692 apply/s`，其中 **80.6% 来自不改变状态的 chunk** | **PASS** | `raw/proj-observe-live.json`（5 925 ev / 120 s） |
| **①-E** | 客户端列表重建 ≈**0.101 ms/次**、U-PROJ1 后 ≤**6.1 ms/s（0.61% 单核）** | **PASS（C 级解析上界）** | `raw/w18-rebuild-bound.json`；**非浏览器内实测** |
| **①-F** | 单次空转 `apply` 的**绝对成本** | **INCONCLUSIVE** | 需宿主内打点或独立微基准；本线未构造，**不编数** |
| **①-G** | seq 单调性守卫（低 seq 不覆盖 / truncate） | **PASS（零类）** | 四窗 `seqRegressions=0`、`seqEqual=0` |
| **②-A** | w07「整响应 zod p50 5.02 ms、C÷A=5.8×」 | **FAIL（撤回）** | §3.1–3.3：**≈66% 是测量装置**（w07 自证 `C_HARNESS` 1.691 ms、`C_JSON_ONLY` 1.687 ms） |
| **②-B** | 真实客户端两段 zod 链 ÷ JSON.parse | **PASS**：**0.295 ms / 0.367×** | `raw/w18-zod-chain.json`、`raw/w18-zod-decomp.json`（2/2 同向） |
| **②-C** | 客户端**深层校验** `projections.values`（13 键 × 299 行） | **FAIL（命题被证伪）**：`record(string(), unknown())`，实测 **0.0009 ms/行** | `client.js:5491-5498`；`H_proj_block_only` |
| **②-D** | zod 的可优化面 | **PASS（结论为「无」）**：schema 已模块级复用、无每次重建；`.passthrough()` 反而 **+12%** | §3.5 |
| **②-E** | 5.02 vs 0.76 ms 的分歧 | **PASS（已归因）**：外层+内层+装置三者口径不同；**同树同 zod 4.6.2** | §3.3 |
| **③-A** | 宿主生产链（BFS 于 `:1244`，写入 `:1271`，调用 `:2321`，只写顶层行） | **PASS** | 99/99 顶层行带字段，示例值 36 |
| **③-B** | 丢弃点 = `dsh-client-connection/lib/client.js:5383-5394` 的 `sessionSummarySchema`（`object()` 无 passthrough） | **PASS** | **99 → 0**，`droppedUnknownKeys = ["runningSubagentCount"]`，payload 里未知键**恰好只有这一个** |
| **③-C** | w07「`entryCache` 比较恒真 ⇒ 无功能影响」 | **PASS（行号需更新为 `:8618`）** | `:8618` 恒真子句**不**产生额外失配 |
| **③-D** | 「无功能影响」的完整版：UI **确有** 4 个消费点且**长期走弱兜底口径**（仅直接子代 ⇒ 深层低报/未加载报 0） | **PASS（新发现）** | `dsh-client-ui-workspace/lib/client.js:171/286/561/563` |
| **③-E** | 丢弃是否**同时**扰动「每次提交近整树」那条路径 | **FAIL（不扰动）** | 恒真子句不新增失配；真正的失配源是 `valuesCache` 失效（§4.1） |
| **④-A** | 键路由（U-PROJ1）与宿主注册表**不冲突**（生产端 vs 消费端） | **PASS** | §4.2 |
| **④-B** | U-PROJ1 的白名单**完整**（粗袋子仅 `:8603` 一个读者，其键 = 白名单 4 键） | **PASS** | 全部署 grep；`valuesCache` 陈旧面已封闭 |
| **④-C** | U-PROJ1 **实际**过滤比例 | **PASS（实测）**：**16.1% / 29.4% / 28.6%**（三窗），**不是 84.7%** | §4.4；`raw/proj-observe*.json` |
| **④-D** | w07 候选 1 的收益预期「`1.19 → 0.18`」 | **FAIL（高估 2.8×）**：实测上界 **`1.19 → ≈0.85`** | §4.4 |
| **④-E** | w07 预注册阈值①（`≤0.30`）可由「按可达性过滤」单独达标 | **FAIL** | 同上；需候选 2 之外的杠杆 |
| **⑤-A** | 候选 1（单元级事件类型过滤 / `advance`）的**收益** | **INCONCLUSIVE（量级）** | 调用数降幅可测（−80.6%），**单次空转成本未测**（见 ①-F） |
| **⑤-B** | 候选 2（键 × 会话 粒度增量重建）能否触及阈值① | **FAIL（不能）** | 它降单次成本，不降提交次数 |
| **⑤-C** | 候选 3（白名单升为宿主能力位）的收益 | **PASS＝0（防退化项）** | 现有 4 键已对齐 |
| **⑤-D** | 「不做 zod 优化」的裁决 | **PASS** | §3.5 |

---

## 八、证据清单（全部可重跑）

| 文件 | 内容 | 复跑命令 |
|---|---|---|
| `raw/proj-observe.json` | W1 90 s 投影直方图（宿 **301709**，同日 15:19） | `node tools/proj-observe.mjs 90 raw/proj-observe.json` |
| `raw/proj-observe-post.json` | W2 90 s（**301709**，18:32） | `node tools/proj-observe.mjs 90 raw/proj-observe-post.json` |
| `raw/proj-observe-live.json` | **W3 120 s（宿主 2988915，18:39）** | `node tools/proj-observe.mjs 120 raw/proj-observe-live.json` |
| `scripts/bench-zod.mjs` → `raw/w18-zod-decomp.json` | 内层 schema 分解、行数标定、**`runningSubagentCount` 99→0 证明** | `node scripts/bench-zod.mjs raw/session-list-499k.json raw/w18-zod-decomp.json` |
| `scripts/bench-zod2.mjs` → `raw/w18-zod-chain.json` | **真实 `callUnary` 链**分解（外层 0.0007 / 内层 0.2949 / 全程 1.1378 ms）+ 装置开销对照（`structuredClone` 1.98×、`stringify+parse` 2.11×） | `node scripts/bench-zod2.mjs raw/session-list-499k.json raw/w18-zod-chain.json` |
| `scripts/bench-rebuild.mjs` → `raw/w18-rebuild-bound.json` | 客户端粗重建解析上界（0.101 ms/次 ⇒ ≤6.1 ms/s） | `node scripts/bench-rebuild.mjs raw/session-list-499k.json raw/w18-rebuild-bound.json` |
| `raw/session-list-499k.json` | 真实 505 088 B / 299 行样本（**来自 w07 `raw/`，sha256 `810d40da…9eb978`**） | 复制自 `program/w07-streaming/raw/` |
| `tools/proj-observe.mjs` | mux 观测器（**纯 Node 直连 WS，无浏览器、无锁、零写入本目录外**） | 见上 |

**bundle 指纹（结论绑定字节，sha256 前 16 hex，2026-09-22 18:4x 实测）**：

| bundle | sha256[0:16] | 备注 |
|---|---|---|
| `dsh-client-connection/lib/client.js` | **f729a994183ae736** | **与 w07 报告记录的哈希一致** ⇒ `session.list` 的两段 zod 链与 `sessionSummarySchema`（§三、§五）**字节未变**，本报告结论可直接对账 |
| `dsh-client-connection/lib/index.js` | c354a001460736e6 | 与 w07 一致 |
| `dsh-client-runtime/lib/client.js` | **4a2c298dd82613c7** | **已被 U-PROJ1 改动**（含 `w07-throttle` ×4）⇒ w07 记的 `357f1703722464ee` 已过期，**w07 报告中的 runtime 行号全部偏移**，本报告一律用**当前**行号 |
| `dsh-session-projection/lib/index.js` | 3d244c671a957591 | 305 行；`drive()` @ `:283-300` |
| `dsh-host-apiproxy/lib/index.js` | a6fe1ae90e8e14ad | 已含 `U-HR1..4`（`session.list` 修复）与 `dsh-lag-fix B1`（`runningSubagentCount`） |
| `dsh-client-ui-subagent/lib/client.js` | ac7cbb972b126c77 | 与 U-PROJ1 注释里记的哈希一致 |
| `dsh-client-ui-workspace/lib/client.js` | edb434298224f489 | `runningSubagentCount` 的 4 个 UI 消费点 |

---

## 九、未决 / 边界（诚实清单）

1. **单次空转 `apply` 的绝对成本未测**（①-F）。这直接决定候选 1 的收益量级。**要测必须在宿主内打点或起隔离宿主**——本线**未做**（范围外且会影响用户 GUI）。⇒ 候选 1 的收益**只以「调用数降幅 −80.6%」申报，不以「省 X% 单核」申报**。
2. **`subagentTiming` 的 `through` 更新可否省略未证**（§六「不做」项）。需要先在浏览器内证「UI 的 `activity` 与宿主 `active` 区间同生命周期」——**本线无浏览器窗口**，故未做。
3. **`apply` 驱动的规模跨窗差异极大**：`session/event` 从 1 425/90 s（W1，chunk 占 6.7%）到 11 772/90 s（W2，chunk 占 93.9%）。**驱动成本高度依赖「是否有活跃流式会话」**，任何单窗结论都不可外推。
4. **W1/W2 的 `host.pid` 字段写的是 301709 —— 这是探针的硬编码标签，不是读数**。W3 于 18:39 采集、服务端口与 W1/W2 同源，故宿主身份以「采集时刻」为准（W1/W2 早于 18:11:49 重启 ⇒ 必为 301709；W3 晚于 ⇒ 必为 2988915）。**已如实标注，未据该字段下任何结论。**
5. **`distinctSessionsTotal` 在 W3 为 `undefined`**（W1/W2 有值）：原因是 W3 用 `Object.keys(...).size` 的口径差异，属**探针字段瑕疵**，不影响任何结论（`distinctSessionsByKey` 三窗均正常）。
6. **W3 记录了 `permissions` 3 帧** ⇒ 「`permissions` 白名单外」这一判定在**该窗内被实际行使**；但 w07 W0 窗口**未列**该键 ⇒ 两次直方图的键集**不完全一致**，说明键集随挂载/活动变化，**白名单必须按「最坏情形（键集并集）」复核**（已做：本报告 §4.1 逐键覆盖了 W0∪W1∪W2∪W3 的全部键）。
7. **zod「跨引擎/跨机」不外推**：本报告全部 zod 数字来自 **Node v22.23.2 + zod 4.6.2 离线进程**；浏览器内 V8 与 JIT 状态不同 ⇒ **只支持「量级与比值」结论**，不支持把 0.295 ms 当浏览器内实测值。
8. **`llmRetry` 的 `wire` 是否存在未核实**（§2.2 注）。不影响任何结论（该键四窗 0 帧）。
9. **未取探针锁**（本线全程无浏览器）：按 BATCH-PLAN §五.2「开窗门禁」的**精神**，本线无窗口级独占需求，故取锁只会制造无谓的跨线阻塞。**如协调者要求，可对 mux 观测补齐锁协议。**
