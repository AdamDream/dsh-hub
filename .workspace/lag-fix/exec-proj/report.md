# U-PROJ1 报告：projection 驱动的列表重建「键可达性闸门」+ rAF 合并（同批落地）

- 档：**修订执行复核一体**（修订执行复核一体档）· 线：`w07-exec-proj` · 日期：2026-09-22
- 独占写入面：`.workspace/lag-fix/exec-proj/`（**未改任何产品文件**）
- 宿主：PID **301709**（**未重启、未 pkill 用户浏览器**）
- 依据契约：`program/w07-streaming/audit.md`（442 行）+ `raw/subscribers.md`（536 行）
- 上游结论一律**当作前提使用**，不重新论证；本报告只报**落地 + 实测 + 对前提的两处修正**。

---

## 0. 交付物清单

| 文件 | 内容 |
|---|---|
| `candidate/dsh-client-runtime__client.js` | **候选件**：`sha256[0:16] = 4a2c298dd82613c7`，402 389 B / 10 713 行（pre-image 398 569 B / 10 667 行） |
| `scripts/apply-ProjGate-v1.mjs` | 补丁脚本（dry-run 默认 / `--apply` / `--candidate` / `--rollback` / `--verify`） |
| `out/ProjGate-v1.357f1703722464ee.diff` | 4 个 hunk 的精确 diff（含 pre-image 行号） |
| `scripts/projgate-init.js` | 页内仪器（rAF 墙钟+播种 / LoAF / LongTask / 心跳 / 库键直方图 / DOM 见证 / setTimeout 阳性对照） |
| `scripts/probe-commit-ratio.mjs` | A/B 探针（**路由拦截**装候选，不写 deployed；窗口内心跳 + 浏览器 pid 存活判据） |
| `scripts/run-acceptance.sh` | 验收驱动（相邻配对 d1 c1 d2 c2 d3 c3） |
| `scripts/analyze-reps.mjs` → `out/acceptance.md` | 原始 JSON → 验收表（**失败窗一并列出，不丢**） |
| `out/verify-whitelist.md` | 二级 subagent 的**独立对抗式复核**（643 行，逐条 file:line） |
| `raw/probe-*.json` | 全部原始窗 JSON（含 invalid 窗与 abort） |

---

## 1. 逐单元落地（U-PROJ1）

补丁标记：`/* w07-throttle v1 */` ×4。**全部锚点唯一命中**（脚本强制，任一不唯一则一个文件都不写）。

| # | 锚点（pre-image 行） | 改动 | 语义 |
|---|---|---|---|
| **E1** | `:5732` `var ProjectionValueStore = class {` | 前置常量 `LIST_REACHABLE_PROJECTION_KEYS = new Set(["title","sessionStats","subagentTiming","tokenUsage"])` + 逐键读者证据注释 | 白名单**显式常量**（审计候选 1 风险①要求：不做自动推导） |
| **E2** | `:5823-5827` `changed(key)` | 非白名单键：只做 `channels.get(key)?.notifier.markDirty()` 后 `return`；白名单键：原三句**原序原样**执行 | 闸门的**唯一正确位置**（见 §3 证明） |
| **E3** | `:8302-8305` `session/projection` 分支 | `this.notifier.markDirty()` → `if (LIST_REACHABLE_PROJECTION_KEYS.has(frame.key)) this.notifier.markFrameDirty();` | rAF 合批 + 闸门 |
| **E4** | `:7984-7986` `subscribeAny` 监听器 | `markDirty()` → `markFrameDirty()` | rAF 合批（与 E3 幂等：`markFrameDirty` 已排程即早退） |

**最小性已机械证明**（`--verify`）：把 4 处插入**逆序还原**后与 deployed pre-image **逐字节相同** ⇒ 候选件与 deployed 的差异**只有**这 4 处登记插入。

```
$ node scripts/apply-ProjGate-v1.mjs --verify --target candidate/dsh-client-runtime__client.js
verify: pre-image sha16=357f1703722464ee
verify: target    sha16=4a2c298dd82613c7
OK   replacement E1..E4 present exactly once
OK   MINIMALITY: reverse-applying the four edits reproduces the pre-image byte-for-byte
whitelist members = ["title","sessionStats","subagentTiming","tokenUsage"] (n=4)
verify: verdict = PASS
```

---

## 2. 白名单逐键读者对照（**审计强制要求：`subagentTiming` 不得被过滤**）

读者证据**全部由我自己在 deployed bundle 上 grep 得到**，并由二级 subagent 独立复核（`out/verify-whitelist.md`，结论 `WHITELIST: HOLDS`，穷举式阴性检索清单见其 §1–§3）。

### 2.1 白名单 = 粗面（list bag）可达键集，**4 个键**

| 键 | 读者 | 精确 file:line | 路径 |
|---|---|---|---|
| `title` | 列表行标题 | `dsh-client-runtime/lib/client.js:8556` `projectionStore?.get("title")` → `:8560` → `:9280 displayTitleOf(...)` | **直读 store（不经 bag）**，粗面 |
| `subagentTiming` | 子代理目录行耗时 | `dsh-client-ui-subagent/lib/client.js:90` `summary.projectionValues?.subagentTiming` | **粗面（bag）** |
| `sessionStats` | 子代理目录行解码速率 | `dsh-client-ui-subagent/lib/client.js:79` `summary?.projectionValues?.sessionStats` | **粗面（bag）** |
| `tokenUsage` | 子代理目录行 token 总量 | `dsh-client-ui-subagent/lib/client.js:269` `tokenTotal(summary?.projectionValues?.tokenUsage)` | **粗面（bag）** |

**证明 `subagentTiming` 有真读者**：全部署 `grep -rn "subagentTiming" <root>/*/lib/client.js` → **恰好 1 条**：`dsh-client-ui-subagent/lib/client.js:90`。⇒ **不得过滤，已保留**（`--verify` 显式断言 `whitelist retains subagentTiming`）。

### 2.2 被闸门过滤的键（**逐键都给了"为什么安全"**）

| 键 | 窄面读者（face，`useProjection`/`faceOf`） | 粗面读者 | 过滤依据 |
|---|---|---|---|
| `contextPressure` | `dsh-client-ui-conversation/lib/client.js:3099` | **无** | bag 零读者 |
| `contextBreakdown` | `dsh-client-ui-conversation/lib/client.js:3100` | **无** | bag 零读者 |
| `todos` | `dsh-client-ui-conversation/lib/client.js:6654` | **无** | bag 零读者 |
| `permissions` | `dsh-client-ui-conversation/lib/client.js:3615`；命令式 `dsh-client-ui-permission-presets/lib/client.js:379` `faceOf("permissions").getSnapshot()` | **无** | face 的 `getSnapshot` **直读 `rows`**（`:5835`），不经 bag ⇒ 命令式读也不受影响 |
| `plan` | `dsh-client-ui-conversation/lib/client.js:3569`、`dsh-client-ui-plan/lib/client.js:34` | **无** | bag 零读者 |
| `goal` | `dsh-client-ui-conversation/lib/client.js:3570`、`dsh-client-ui-goal/lib/client.js:242`；命令式 `ui-goal:395` | **无** | 同上 |
| `imageLimits` | `dsh-client-ui-conversation/lib/client.js:3587` | **无** | bag 零读者 |
| **`sessionListMetadata`** | **无** | **无** | **全部署 `grep -rn sessionListMetadata <root>/*/lib/client.js` = 0 命中**（真读者在宿主 `apiproxy:1294/1336`）⇒ 客户端零读者，**应被过滤，已过滤** |
| `subagent` | **无** | **无** | 零读者（且实测 0 帧） |

> 二级 subagent 的独立穷举另证实：**不存在动态/计算式 bag 读取**（`projectionValues[`、`...projectionValues`、`Object.keys/values/entries(...projectionValues)` 全为 0 命中），所有 `useProjection(`/`faceOf(` 的键**均为字面量**。

---

## 3. 语义等价对照表（闸门前 → 闸门后，逐键「是否仍被投递」）

**结论：对每一个"有读者"的键，投递语义与**窄面**时机完全不变；只有**粗面（列表 bag）**路径有 ≤1 帧的有界延迟。**

| 键 | 闸门前：窄面（face 微任务） | 闸门前：粗面（list 重建） | 闸门后：窄面 | 闸门后：粗面 | 语义差 |
|---|---|---|---|---|---|
| `title` | —（无窄面读者） | 每次变化 → 触发重建 | — | ✅ **仍触发** | 粗面 **≤1 帧（≤16.7 ms）延迟**（rAF），审计候选 1 已预登记 |
| `subagentTiming` | — | 每次变化 → 触发重建 | — | ✅ **仍触发**（白名单） | 粗面 ≤1 帧延迟 |
| `sessionStats` | `ui-conversation:2975`（微任务） | 触发重建 + bag 更新 | ✅ **完全不变（微任务）** | ✅ 仍触发 | 窄面**零变化**；粗面 ≤1 帧 |
| `tokenUsage` | `ui-conversation:2974`（微任务） | 触发重建 + bag 更新 | ✅ **完全不变** | ✅ 仍触发 | 同 `sessionStats` |
| `contextPressure` | `ui-conversation:3099`（微任务） | 触发重建（**bag 内无读者**） | ✅ **完全不变** | ⛔ 不再触发；bag 内该键值**滞后至下次因其它原因重建** | **零读者 ⇒ 不可观测** |
| `contextBreakdown` | `ui-conversation:3100` | 触发重建 | ✅ 不变 | ⛔ 同上 | 不可观测 |
| `todos` | `ui-conversation:6654` | 触发重建 | ✅ 不变 | ⛔ | 不可观测 |
| `permissions` | `ui-conversation:3615` + 命令式 `ui-permission-presets:379` | 触发重建 | ✅ 不变（命令式读 `rows`，不经 bag） | ⛔ | 不可观测 |
| `plan` | `ui-conversation:3569`、`ui-plan:34` | 触发重建 | ✅ 不变 | ⛔ | 不可观测 |
| `goal` | `ui-conversation:3570`、`ui-goal:242`、命令式 `ui-goal:395` | 触发重建 | ✅ 不变 | ⛔ | 不可观测 |
| `imageLimits` | `ui-conversation:3587` | 触发重建 | ✅ 不变 | ⛔ | 不可观测 |
| `sessionListMetadata` | 无 | 触发重建 | — | ⛔ | **零读者，无差异** |
| `subagent` | 无 | 触发重建 | — | ⛔ | **零读者，无差异** |

**机制层面的等价性证明（两条，缺一不可）**：

1. **窄面路径与闸门正交**：`channel(key)`（`:5828-5842`）产出的 face 是
   `getSnapshot: () => this.rows.get(key)?.value`（**:5835**）——**直读 `rows`**，既不读 `valuesCache`，也不经 `anyNotifier`。
   而 `changed()` 的**第一句 face 置脏在两分支都无条件保留** ⇒ 闸门对一切 `useProjection(key)` / `faceOf(key)` 消费者**零影响**（值、时机、引用稳定性全不变）。
2. **rAF 不会丢更新**（二级 subagent 已逐行追踪，`SAFE`）：`markFrameDirty` 先 arm rAF（`:5669-5674`），若同 task 内随后 `markDirty()`，`schedule("microtask")` 使 `scheduleGeneration` 前进，microtask `publish` 通过代际闸门并 `flush()`（**用最新状态 rebuild**），先前 rAF 的 `publish` 因代际不匹配**无害退出**；反向（已 arm rAF 再 `markFrameDirty`）在 `:5672` 正确 no-op；唯一两个 `scheduleGeneration` 写入者（`schedule`/`invalidateSchedule`）都不会留下孤儿排程；`listeners.size === 0` 早退**保留 `dirty`**，由 `getListSnapshot` → `ensureFresh()`（`:5689-5693`）在读路径补齐。⇒ **最坏是 1 帧延迟，不是丢更新。**

**⚠️ 必须披露的、有界的一处行为变化（我不同意为"零语义变化"）**：

> 对**非白名单键**，其值在**已发布列表行的 `projectionValues` bag 内**不再随该键自身变化而刷新，而是滞后到"下一次因任何其它原因发生的重建"。这是闸门的**设计本意**（审计候选 1 步骤 2："不是不建快照，是使 `projectionValues` 保持引用稳定"），但它在**契约层**改变了公开类型的含义：
> `dsh-client-runtime/lib/types/client/sessions/lineage.d.ts:7-8`/`:24-25`、`service.d.ts:59-60` 把 `projectionValues` 声明为 *"Current host-computed projection values"*——闸门后这句话对 8 个非白名单键**不再恒真**。
> **今天无任何部署读者**（本节逐键已证 + 独立复核 `WHITELIST: HOLDS`，无部署反例），所以**无用户可观测差异**；但**后续任何新的 bag 读者都会静默读到滞后值**。
> **建议跟进（不在本单元范围，未自行扩范围）**：① 收窄该公开类型（排除非白名单键）或把 bag 从列表行类型移除；② 加开发期不变量断言 `bag readers ⊆ 白名单`。二级 subagent 的 `NEW FINDINGS #3` 是同一条独立结论。

---

## 4. 既有补丁标记核对（**要求：全部原样保留**）

### 4.1 标记计数（改动前后）

| 标记 | deployed（pre-image） | candidate | 判定 |
|---|---|---|---|
| `/* p2ac-fix */` | **4** | **4** | ✅ 原样保留 |
| `/* dsh-perf-fix` | **3** | **3** | ✅ 原样保留 |
| `dsh-lag-fix` | **0** | **0** | ⚠️ **见 4.3** |
| `/* w07-throttle v1 */` | 0 | **4** | ✅ 本批新增 |

脚本内建断言：**任一既有标记计数发生变化即 ABORT，一个文件都不写**（`R6`），实测 `OK preserved marker ...: before=4 after=4` / `before=3 after=3`。

### 4.2 行号核对（既有标记全部按 +46 整体平移，内容逐字不变）

| 标记行 | deployed | candidate | 平移 |
|---|---|---|---|
| `/* p2ac-fix */` #1 | 9294 | 9340 | +46 |
| `/* p2ac-fix */` #2 | 9301 | 9347 | +46 |
| `/* p2ac-fix */` #3 | 9328 | 9374 | +46 |
| `/* p2ac-fix */` #4 | 9342 | 9388 | +46 |
| `/* dsh-perf-fix P1 v1 */` | 8576 | 8622 | +46 |
| `/* dsh-perf-fix P2 v1 */` | 8842 | 8888 | +46 |
| `/* dsh-perf-fix P2 v1 */` | 9324 | 9370 | +46 |

+46 = E1 +27 / E2 +12 / E4 +1 / E3 +6 之和，**7 个既有标记行全部恰好 +46** ⇒ 除登记插入外无任何位移，与 §1 的字节级最小性证明一致。

本批 4 处新标记位置：E1 `:5732`、E2 `:5850`、E4 `:8024`、E3 `:8344`。

### 4.3 ⚠️ 契约与实况不符（如实上报，未自行"修好"叙述）

任务书写的是"既有两个补丁标记：`/* p2ac-fix */` ×4 与 **`dsh-lag-fix B1`（`:8572` 一行）**"。**实况**：

- 文件内 **不存在** 任何 `dsh-lag-fix` 字样（`grep -c` = **0**，全部署根目录内 12 处 `dsh-lag-fix` 均属**其它波次**的宿主/侧栏文件，不在本文件）。
- `:8572` 附近真实存在的既有标记是 **`/* dsh-perf-fix P1 v1 */`，位于 `:8576`**（`entryCache` 清理块 `:8576-8581`），即 `:8572` 的 `entryCache` 恒等比较行**之后**那条。
- 该文件真实共有 **两个既有补丁族**：`p2ac-fix`(×4) 与 `dsh-perf-fix`(×3)。任务书的族名（`dsh-lag-fix B1`）有误，行号（`:8572`）指向的是 `dsh-perf-fix P1 v1` 邻接行。

⇒ **处置**：两族**全部原样保留**（计数与行号已核，见 4.1/4.2），并把这一不符写进报告；**未**据此改动任何设计。deployed 文件 sha256 与审计指纹 `357f1703722464ee` **完全一致**，故"审计读的就是这一份、且当时就没有 `dsh-lag-fix`"。

---

## 5. 补丁脚本（`apply-ProjGate-v1.mjs`）

| 契约要求 | 实现 | 实测 |
|---|---|---|
| dry-run 默认 | 无 `--apply`/`--candidate` 即只读 | ✅ 默认打印 `DRY-RUN: nothing written` |
| `--apply` 才写 | `R1` | ✅ |
| **锚点唯一命中才写，否则一个文件都不写** | `R2`：4 锚点必须各命中恰好 1 次 | ✅ 实测 4/4 `occurrences=1`；构造不唯一时 `ABORT (exit 2)` |
| 自动 pre-image | `R3`：内容寻址 `client.js.<sha16>.<ts>.bak`，写前落盘并回读校验 | ✅ `pre-image saved: client.js.357f1703722464ee.1790061252517.bak` |
| `node --check` | `R7`：**dry-run 也校验将被写入的确切字节**；`--apply` 后校验落盘文件，失败**立即回滚** | ✅ `OK node --check (patched content)` / `(pre-image baseline)` |
| 幂等 | `R4`：4 标记 + 常量 + E2/E3/E4 锚点已消费 ⇒ `ALREADY_APPLIED` 且不写 | ✅ 二次 `--apply` → `exit 0`，`ALREADY_APPLIED` |
| `--rollback` | `R5`：取最新 pre-image 还原并复核 | ✅ 回滚后 sha16 回到 `357f1703722464ee` |
| 既有标记保留 | `R6` | ✅ 见 §4.1 |
| **deployed 写入由协调者执行** | 本档只用 `--candidate`（+ 沙盒副本上验过 `--apply/--rollback`）；**deployed 未被写过**（sha256 全程 `357f1703722464ee`） | ✅ |

**协调者落地命令**（deployed 写入）：

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-proj
node scripts/apply-ProjGate-v1.mjs                       # 1) dry-run 复核锚点/标记/diff
node scripts/apply-ProjGate-v1.mjs --apply               # 2) 写入 + 自动 pre-image + node --check
node scripts/apply-ProjGate-v1.mjs --verify --target <deployed 路径>   # 3) 最小性自证
node scripts/apply-ProjGate-v1.mjs --rollback            # 需要时单命令回滚（热面，刷新即生效）
```

> ⚠️ **二级 subagent 的重要运维发现**（`out/verify-whitelist.md` `NEW FINDINGS #1`）：部署树内**另有两份同名但未打补丁的 `dsh-client-runtime/lib/client.js` 副本**（`~/.dsh/profiles/node_modules/dsh-workspace-enhancement/...` 与 `~/.dsh/profiles/node_modules/@local/dsh-pptmaster/...`，10573 行 / `13a5fe0ee8cddda2`），**当前不被服务**。⇒ 必须**按"确切路径 + sha256 + 行数"定位**（脚本正是如此，默认 target 已钉死并校验），任何"按文件名搜索"的补丁工具会改到死副本并报成功。

---

## 6. 验收实跑（同器械 / 同窗 / ≥3 rep / **相邻配对**）

装法：**路由拦截** `**/plugins/@deepseek-ai/dsh-client-runtime/client.js*`，两个臂都由探针 `fulfill` `application/javascript`：
- `deployed` 臂 = 从磁盘读的 pre-image 字节（已实测：宿主实际服务的字节与该文件 **逐字节相同**，`357f1703722464ee`）；
- `candidate` 臂 = §1 候选件字节（`4a2c298dd82613c7`）。
每一窗都记录**实际服务字节的 sha256**（`served.sha16`），故"跑的是哪份代码"是**证据**而非推断。
**deployed 文件全程未被修改。**

窗结构：`P1`(未追踪 15 s) → `P2`(追踪 10 s，含阳性对照) → `P3`(未追踪 15 s)；
**主判据只用 P1+P3（未追踪）**，P2 仅作 RunTask/LoAF 相对 KPI，**绝不混入主判据**。

### 6.1 A/B 机制自证（先证明"跑的是哪份代码"）

| 检验 | 结果 |
|---|---|
| 路由拦截是否真的到达页面 | **`SELFTEST_PASS`** — 独立自检臂（deployed 字节 + 一行无害 `window.__ARM_PROOF__` 赋值）在页内读回 `proof = "route-interception-reached-the-page"`，`__PG__`/`__RC__` 均注入成功 |
| 每窗实际服务字节的 sha256 | deployed 臂 **`357f1703722464ee`**；candidate 臂 **`4a2c298dd82613c7`**（写入 `served.sha16`，非推断） |
| 宿主实际服务字节 == 磁盘 pre-image | **逐字节相同**（见 §6 装法说明） |
| deployed 文件是否被改 | **否**，全程 sha256 `357f1703722464ee` |

### 6.2 全部窗口（**含 invalid，一个不丢**）

| # | 臂 | tag | commits | proj 帧 | **commits÷proj** | whole÷commit | commits/s | proj/s | 判定 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `candidate` | c1 | 254 | 741 | **0.343** | 214.3 | 9.8 | 28.5 | CONTENDED（比值可用）|
| 2 | `candidate` | c2 | 220 | 1182 | **0.186** | 207.8 | 7.9 | 42.2 | CONTENDED |
| 3 | `candidate` | c3 | 28 | 1020 | 0.028 | 158.3 | 0.9 | 31.9 | **INVALID（链底座缺失）** |
| 4 | `candidate` | c4 | — | — | — | — | — | — | **无窗**（锁被占用 ×4 耗尽）|
| 5 | `candidate` | c5 | — | — | — | — | — | — | **无窗**（4 s 内投影帧 24 < 30，无活流量）|
| 6 | `deployed` | d1 | 929 | 776 | **1.197** | 222.5 | 35.7 | 29.9 | CONTENDED |
| 7 | `deployed` | d2 | 654 | 548 | **1.193** | 223.0 | 21.1 | 17.7 | CONTENDED |
| 8 | `deployed` | d3 | 3 | 883 | 0.003 | 156.3 | 0.1 | 31.5 | **INVALID（链底座缺失）** |
| 9 | `deployed` | d4 | — | — | — | — | — | — | **无窗**（链底座缺失 ×1 → 锁被占用 ×3）|
| 10 | `deployed` | d5 | — | — | — | — | — | — | **无窗**（锁被占用 ×3 → 链底座缺失 ×1）|

> **deployed 基线自洽性**：两个有效 deployed 窗得 **1.1972 / 1.1934**，与审计 13 窗基线 **1.190（1.157–1.250）** 同档 ⇒ 本器械**复现了审计基线**，A/B 可比。

### 6.3 相邻配对结果（**主判据**）

| 配对 | deployed `commits÷proj` | candidate `commits÷proj` | 降幅 | deployed commits/s | candidate commits/s | 降幅 | whole÷commit d→c | RunTask ms/s d→c |
|---|---|---|---|---|---|---|---|---|
| **1**（d1 / c1） | **1.197** | **0.343** | **−71.4%** | 35.7 | 9.8 | **−72.7%** | 222.5 → 214.3 | 119.2 → **61.3** |
| **2**（d2 / c2） | **1.193** | **0.186** | **−84.4%** | 21.1 | 7.9 | **−62.7%** | 223.0 → 207.8 | 129.2 → 118.9 |
| ~~3（d3 / c3）~~ | 0.003 | 0.028 | — | — | — | — | — | **EXCLUDED**（链底座缺失）|
| **合并（有效窗）** | **1.196** | **0.246** | **−79.4%** | **28.4** | **8.8** | **−69.0%** | 222.8 → 211.1 | 124.2 → 90.1 |

**主判据判定：`commits ÷ projection帧` 1.19 → 0.246（合并有效窗），达到预注册阈值 ≤ 0.30。** ✅
**必须同时给出的边界**：**单 rep 层面 2 个有效配对中只有 1 个达标**（c2 = 0.186 达标；c1 = 0.343 **未达**）。

### 6.4 为什么 c1 未达 0.30：分母随负载变化，而分子被动画帧率封顶

`commits ÷ projection帧` 的**分子（列表重建驱动的 commit）被 rAF 封顶在 ≈帧率（60/s）**，而**分母（projection 帧数）随宿主活跃度线性增长** ⇒ 该比值**天然随负载下降**。实测：

| 窗 | proj/s | commits/s | ratio |
|---|---|---|---|
| c1 | 28.5 | 9.8 | 0.343 |
| c2 | **42.2** | 7.9 | **0.186** |

c2 的投影帧率比 c1 高 **48%**，ratio 反而低 **46%**（分子几乎不变）⇒ c1 的 0.343 是**低流量窗**的产物，不是候选件在该窗变差。**负载归一化判据是 commits/s**：35.7→9.8 与 21.1→7.9（合并 28.4→8.8，−69%）。

按审计自己的分解 `1.19 = 1.00(L) + 0.19(N)`（L = 列表重建驱动；N = 其它驱动，本单元**不动**）：

| 配对 | 实测 ratio（d） | 实测 ratio（c） | 地板 N | **列表驱动 L（c）** | **L 降幅** |
|---|---|---|---|---|---|
| 1 | 1.197 | 0.343 | 0.197 | **0.146** | **−85.4%** |
| 2 | 1.193 | 0.186 | 0.193 | −0.007（≈0，低于该分解分辨率）| **≈−100%** |

⇒ **本单元要打的量（列表重建驱动的 commit/帧）从 ~1.00 降到 ≤0.15（≥85% 降幅）**；残留的 ~0.19/帧来自非 projection 驱动，属**本单元范围外**。这正是 c1 差 0.043 的全部来源。

### 6.5 副判据

| 判据 | 结果 | 证据 |
|---|---|---|
| **是否达标（主）** | **合并达标**：1.196 → **0.246 ≤ 0.30**；单 rep 2 中 1 达标 | §6.3 |
| `subagentTiming` 驱动的**子代理耗时行仍在刷新** | **机制层 PASS，UI 层 INCONCLUSIVE** | §6.5.1 |
| 无功能回归 | **PASS（本档可及范围内）** | 6 窗全无 `pageerror`/console error；`__RC__.errors` 全空；`hookInjected=1` 且 `onCommitFiberRoot` 单调增长；会话列表/侧栏/流式渲染在（`treeitemRows=13`、`domNodes 584/585`、rAF p50=16.7 ms）；`dpr=1`、`ua=HeadlessChrome/131`。**设置页未做交互回归** ⇒ 该项**未测**，见 §8.7 |
| `wholeFiber÷commit` **不上升**（阈值④） | **PASS** | 222.5→214.3、223.0→207.8（两配对均下降）|
| `commits ÷ chunk帧` **不上升**（阈值②） | **N/A（本窗无 chunk）** | 两窗 `assistant/chunk` 帧数 **= 0**（本机此刻无 LLM 流式）⇒ **本批不可测** |
| `client-runtime` 同窗占比不上升（阈值⑤） | **INCONCLUSIVE（无 CPU profile）** | 本档未做 CPU 采样；仅有 RunTask ms/s（124.2→90.1，同向下降，属相对 KPI）|
| `list.set` 次数/s 降 ≥70%（阈值③） | **不成立（≈0%）** | §7.2 桶级/会话级实测 |
| 哨兵⑥ `rafP50 = 16.7 ms` | **PASS** | 6 窗全为 16.7 ms；rAF n≈2800 |
| 哨兵⑥ `session.list` 行齐全 / `/usage` 9 路 | **INCONCLUSIVE（本档未测）** | 需产品交互，超出本批探针范围 |

#### 6.5.1 `subagentTiming` 白名单专项（**显式检查，不是"看起来没问题"**）

| 层次 | 检查 | 结果 |
|---|---|---|
| **静态（决定性）** | 实际服务字节的常量为 `new Set(["title","sessionStats","subagentTiming","tokenUsage"])` | ✅ `--verify` 显式断言 `whitelist retains subagentTiming`；candidate 臂服务 sha `4a2c298dd82613c7` |
| **读者（决定性）** | `subagentTiming` 的客户端真读者 | ✅ 全部署恰好 1 处：`dsh-client-ui-subagent/lib/client.js:90`；独立复核 `WHITELIST: HOLDS` |
| **代码路径（决定性）** | 白名单内的键在 `changed()` 走**原三句原序**（不进入提前 return 分支） | ✅ 最小性证明 + `--verify` ⇒ `subagentTiming` 必然走粗面投递 |
| **在窗耦合（经验）** | 含 `subagentTiming` 帧的秒里是否仍产生 commit | ✅ 全部 6 窗 **100% 耦合**（d1 34/34、c1 38/38、d2 35/37…，见 `out/acceptance.md §5`）⇒ 候选臂的粗面重建**仍在发生**，bag 仍在被重新发布 |
| **UI 层 DOM 见证** | `… tok · … tok/s`（直读 bag，`ui-subagent:269/272`）的不同取值数 | ⚠️ **INCONCLUSIVE**：6 窗观测数均为 **0**（`tokS_distinct=0`）⇒ 该窗形态下**没有任何 ui-subagent 目录行渲染出 token 度量**；两条臂**对称**缺测（不引入偏向，但**也不构成证据**）|

> ⚠️ **重要发现：任务书暗示的那种检查（看子代理耗时行的文本有没有在变）是空洞的**。
> `activityDuration`（`ui-subagent:88-95`）在 `activity === "running"` 时取 **`end = now`（本地时钟）**（`:93`），
> 所以**耗时数字会自己走**，bag 完全冻结也一样"看起来在刷新" ⇒ 拿它当闸门误伤的判据会**假通过**。
> 本档因此改用上表前三行（静态 + 读者 + 代码路径）作**决定性**判据，并以"在窗耦合"作经验佐证；仍缺的
> 是**真正 UI 端到端**的一格（需展开某父会话的子代理目录行），**本批未取到**，如实标 INCONCLUSIVE。

### 6.6 阳性/阴性对照（BATCH-PLAN §五.19 强制）

| 窗 | 页内 `setTimeout` 阳性对照 | RunTask 报出 | LoAF 报出 | `none` 阴性对照 |
|---|---|---|---|---|
| d1 | 150 ms 忙循环 → 实际 150.0 ms | ✅ **max = 150.4 ms** | ✅ max 154 ms | LoAF Δ0 / LT Δ0（1 s 空跨度）|
| d2 | 150 ms → 150.1 ms | ✅ max = 150.5 ms | ✅ max 163 ms | Δ0 / Δ0 |
| c1 | 150 ms → 150.0 ms | ✅ max = 150.4 ms | ✅ max 158 ms | Δ0 / Δ0 |
| c2 | 150 ms → 150.0 ms | ✅ max = 150.2 ms | ✅ max 492 ms | Δ0 / Δ0 |

⇒ **`RunTask` 通道（trace 类别含 `disabled-by-default-devtools.timeline`）与 LoAF 通道均已被阳性对照证明可用**（注入 150 ms → 观测 150.4 ms）。若通道失灵，这里会是 0。

---

## 7. ⚠️ 对审计前提的两处修正（重要，直接影响判据方向）

> 这两条不是"执行档自行拆解"，而是**执行中发现的、与审计契约冲突的实测事实**。按纪律**如实上报**，不自行拍板改判据。

### 7.1 修正一：**"纯 rAF 化单独不够（≤1.07×）"不成立 —— 实测合并 **8.55× / 6.63×**

审计 C9/候选 1 的推导是"`session/projection` 帧率已 ≈ 帧率（63.7/s vs 60/s）⇒ 纯 rAF 化收益 ≤1.07×"。
该推导基于**平均帧率**，忽略了投影帧**成簇到达**。用审计自己的原始抓包复算（`raw/mux-live-90s.json` / `mux-live-120s.json`；由审计 `tools/mux-observe.mjs` 以 Node 直连 `ws://…/api/events.mux` 被动采集，不开浏览器、不持锁）：

| 量 | 90 s 窗 | 120 s 窗 |
|---|---|---|
| projection 帧 | 5 736 | 6 101 |
| **被占用的 16.667 ms 桶** | **671** | **920** |
| **rAF 合并倍数 = 帧 ÷ 桶** | **8.55×** | **6.63×** |
| 桶内帧数 p50 / max | 7 / 48 | 6 / 43 |
| 落在"响亮桶"（≥5 帧）的帧占比 | 5 428/5 736 = **94.6%** | 5 454/6 101 = **89.4%** |
| 相邻两投影帧间隔 = 0 ms 的比例 | **4 052/5 735 = 70.7%** | — |

成簇的**机制来源已由审计自己确证**：一条 `assistant/message` 在**同一次同步 `drive`** 里改动 5 个键 ⇒ 5 条投影帧（`subscribers.md §4.4`，实测 256/257）。
⇒ **主判据的达成主要由 rAF 承担**，预测 `commits÷projection` ≈ **0.117（90 s 窗）/ 0.151（120 s 窗）**。

### 7.2 修正二：**"84.7% 的帧无表层读者 ⇒ 1.19 → ≈0.18"不成立；闸门对重建次数贡献 ≈ 0**

- 该 84.7% 把 `subagentTiming`/`sessionStats`/`tokenUsage` 也算成"无表层读者"，但**它们有真读者**（`ui-subagent:79/90/269`），而任务书**强制**保留 `subagentTiming`。审计自身 `subscribers.md §4.5` 给出的正确集合是 `contextPressure + contextBreakdown + permissions + todos + imageLimits + subagent`+`sessionListMetadata` = **1 680/5 736 = 29.3%**，与上表 29.4% 吻合。
- **更关键**：按**桶**（= 重建次数）统计，含任一投影帧的 671 个桶中，**671 个（100%）都含至少一个白名单键帧**；按**（桶 × 会话）对**统计，闸门唯一能省的那类对（该会话在该桶内**只**有非白名单键变化）实测为 **0 对 / 1 119 对（0.00%）**，120 s 窗同样 **0 / 1 127（0.00%）**。
  ⇒ **一旦 rAF 合批，闸门对 `buildListSnapshot` 次数、`list.set` 次数、以及每行 entry 的引用 churn 三项的减少量全部是 0%**（因为 `subagentTiming` 在几乎每个事件上都变：454/457 `tool/call`、291/295 `step/start`、282/286 `step/end`、227/229 `tool/result`…，它把每个桶/每个会话都"点亮"了）。
  复算脚本：`scripts/analyze-mux-buckets.mjs`（读审计自己的原始抓包，无新测量）。
- **⇒ 本窗内主判据的全部收益由 rAF 承担，闸门是"0 收益但是 0 成本且必要的前置"**。闸门的真实价值只有两条，且**都不是当前窗内可测量的收益**：
  1. `valuesCache` 不再被零读者键无效化 —— 只有当某键**单独**在某会话某桶内变化、且该会话该桶无任何白名单键时才兑现，**实测该情形出现 0 次**；
  2. **为 `subagentTiming` 热点被单独修好后预留的杠杆**（审计 M2：让 `dsh-subagent/lib/index.js:2140-2148` 的 fallback 变成值感知，或声明该键非列表相关）——**闸门在那一刻才会释放主要收益**；本单元**不扩范围**去改宿主该文件。

> **给协调者的判据建议**：主判据 `commits÷projection ≤ 0.30` 仍**可达**，但**必须归因给 rAF 合批**（预测 0.117 / 0.151）。**不要**把达标说成"键闸门过滤了 84.7% 的帧"——实测闸门在本负载下对重建次数/`list.set`/行级 churn 的贡献是 **0**。
> 阈值 ③（`list.set` 次数/s 降 ≥70%）**在本单元范围内不成立**（预期降幅 ≈0%），应改挂到"闸门 + M2（`subagentTiming` 值感知）"或候选 2/3 批次。

---

## 8. 失败 / invalid / 边界（诚实清单）

1. **锁与窗口有效性**：本档全程遵守 `.workspace/lag-fix/lib/probe-lock.mjs` 纪律，**从未回收任何未确证死亡的锁**。本档期间该锁被 `w14-residual-env`（`ALIVE`）反复持有（先后 PID 860747、921464），我的探针以 `--wait-lock` 等待，等不到即 `ABORT exit 3` 并**不污染机器**；deployed 文件全程 sha256 = `357f1703722464ee`。
2. **窗口中途死亡判据（审计 §0/H2 缺口）已补齐**：探针内置 ① 页内 2 s 心跳（含 `hbN` 计数与 `lastEpoch`）；② Node 侧每 2 s 轮询该心跳（带 5 s 超时）；③ **本次浏览器主进程 pid 存活**（`probe-lock.state()`，规则同锁：读不到一律假定存活）；④ 跨窗外来浏览器普查。任一触发即判 `INVALID`（连续 ≥2 次轮询失败 / 心跳停滞 / 浏览器 pid 死亡 / 未跑到窗口末尾），并**始终落盘部分 JSON**；污染但未死的窗判 `CONTENDED`（比值可用、绝对值不可用）。
3. **`list.set` 次数/s（阈值 ③）不可由客户端仪器直接观测** ⇒ 本报告**不伪造该格**，改用其直接后果 `commits÷projection` + §7.2 的桶级/会话级上界分析。这是本档的**明确 INCONCLUSIVE 边界**。
4. **阳性对照必须页内注入**（BATCH-PLAN §五.19）：本档一律用**页内 `setTimeout` 忙循环**（`projgate-init.js` 的 `injectBlock`），**不用 CDP `Runtime.evaluate`**（已知 LongTask 盲区）。阴性对照 = 同一 1 s 无注入跨度的 LoAF/LongTask 增量。
5. **"子代理耗时行仍在刷新"的显式检查不能只看 DOM 文本**（我实测发现的坑，见 §6 的 `domWitness` 说明）：`activityDuration`（`ui-subagent:88-95`）在 `activity === "running"` 时用**本地 `now`** 作 `end`（`:93`），所以**耗时标签会因本地时钟自行走字**，即使 bag 完全冻结也"看起来在刷新" ⇒ 拿它当判据是**空洞的**。本档改用两道**有效**判据：(a) 键粒度 tap：`subagentTiming` 帧与 commit 的**同秒耦合**在候选臂是否仍成立；(b) **bag 新鲜度 DOM 见证**：`… tok · … tok/s` 直读 `summary.projectionValues`（`ui-subagent:269/272`，**无本地插值**），其**不同取值数 > 1** 才证明列表 bag 仍在被重新发布。
6. **二级 subagent 一次异常终止**（`661e92f1`：系统中断，非业务失败）。其产物 `out/verify-whitelist.md`（643 行）**在终止前已完整落盘**，四个裁决块齐全（`WHITELIST: HOLDS` / `SEMANTIC EQUIVALENCE: BROKEN(latent)` / `ANCHOR UNIQUENESS: OK` / `rAF SAFETY: SAFE`），**无需重派**（按纪律：优先恢复同档而非重派；此次产物完整，故直接采用）。
7. **`imageLimits`/`subagent`/`goal`/`plan` 实测 0 帧**（与审计一致）：本档窗内同样为 0，`plan`/`goal` 在部分会话基线上缺键 ⇒ 这两个键的闸门效果**无实测覆盖**，仅由读者分析保证。

8. **🔴 新发现的窗口有效性缺陷（本档独立发现并已内建闸门）："链底座缺失"窗**
   d3 与 c3 两窗**通过了**心跳/浏览器 pid/流量三道门禁（心跳正常、浏览器存活、4 s 内 152/183 投影帧），
   却在**deployed 臂**只产出 **3 个 commit / 883 投影帧（ratio 0.0034）**——比候选臂还低两个数量级，属**仪器/环境失效而非结果**。
   **根因**：该链的**因变量没有底座**。`buildListSnapshot` 是对 `this.summaries` 做 `.map()`；当客户端的会话列表**未装载/为空**时，
   每个投影帧照样到达、照样 `apply`，但没有任何行可重建 ⇒ **0 commit**。可观测指纹：`domNodes` **526 vs 584/585**、`[role="treeitem"]` **11 vs 13**。
   ⇒ 已在探针中加入第四道门禁（`INVALID_CHAIN_SUBSTRATE`）：`treeitemRows ≥ 12 && domNodes ≥ 570 && onCommitFiberRoot > 0`，不满足即**弃窗重试**（d4、d5 因此各被拦下 1 次）。
   **这条判据此前不在任何清单里**（审计 §0/H2 只提"浏览器中途被杀"），建议并入全队窗口门禁。
   ⇒ **d3 / c3 已从一切配对与聚合中排除**（若误纳，会让 deployed 合并比值虚降到 0.719，得出**虚假的更大改进**）。
9. **⚠️ ≥3 rep 的要求本档只达成 2 个有效配对（如实上报）**
   计划 3 配对（d1c1 / d2c2 / d3c3）+ 追加 2 配对（d4c4 / d5c5），实际：
   - 有效配对 **2 个**（d1/c1、d2/c2，均为相邻配对、同器械、同窗形）；
   - 1 个配对**退化**（d3/c3 链底座缺失，见上）；
   - 2 个配对**无窗**：`w14-residual-env` 线在 07:23–07:57 持续持有探针锁（`ALIVE`），
     我的 4 次尝试（每次等 90 s）多数落在锁被占用上；c5 另因**无活流量**（4 s 内 24 帧 < 30）被流量门禁拦下。
   ⇒ **未达 ≥3**。**未回收任何锁**（遵守"绝不回收未确证死亡的锁"），**未污染机器**，全部 11 个窗（含 abort）的 JSON 均已落盘。
   ⇒ 结论强度按 n=2 陈述；合并判据达标、单 rep 判据 2 中 1 达标，**请协调者按此强度采信**，或在锁空档自行补跑（`scripts/run-acceptance.sh`，驱动已内建 `d4/c4/d5/c5` 的重试规则，可改 tag 直接补第 3 位）。
10. **阈值②（`commits÷chunk帧` 不上升）与哨兵⑥（`/usage` 9 路、`session.list` 行齐全）本批未覆盖**：本机此刻**无 LLM 流式**（6 窗 `assistant/chunk` 帧数均为 0），且本批探针不做产品交互 ⇒ 这两格**未测**，不得视为通过。
11. **`>50 ms` 帧计数只作相对 KPI**：本批 RunTask/LoAF 的 `>50 ms` 计数在每窗都至少含**那一条被注入的 150 ms 阳性对照**（正是它证明通道可用），因此**不能**用它当"卡顿"的灵敏度判据（BATCH-PLAN §五.19 明确禁止）。
---

## 9. 同档自复核

| 复核项 | 结论 | 依据 |
|---|---|---|
| 契约 U-PROJ1：闸门 + rAF **同批** | **PASS** | 单文件 4 处，一个候选件，一次 `--apply` |
| 白名单必须保留 `subagentTiming` | **PASS** | 白名单含之；`--verify` 显式断言；独立复核 `HOLDS` |
| 逐键读者 file:line 清单 | **PASS** | §2 全表（13 键），含 `sessionListMetadata` 客户端零读者 |
| 语义等价对照表 | **PASS（含 1 处已披露的有界偏差）** | §3；偏差 = 非白名单键在 bag 内滞后；**无部署读者**（两档独立确认） |
| 既有标记原样保留（计数 + 行号） | **PASS** | §4；4 / 3 计数不变，7 行全部恰好 +46，脚本 `R6` 硬断言 |
| 锚点唯一命中 | **PASS** | 4/4 `occurrences=1`；不唯一即 `exit 2` 且不写 |
| 脚本 5 项要求（dry-run/`--apply`/唯一命中/pre-image/`node --check`/幂等/`--rollback`） | **PASS** | §5 表，均实测（沙盒副本上验过 `--apply`+`--rollback`，deployed 未写） |
| 最小性（只改登记位置） | **PASS** | `--verify` 逆向还原 = 逐字节相同 |
| 窗口有效性判据（心跳 + 浏览器 pid） | **PASS** | §8.2，已内建于每次运行 |
| 判据只用 RunTask(含 `disabled-by-default-devtools.timeline`) / LoAF + 播种墙钟 rAF | **PASS** | §6；主判据为**计数比值**（与审计 13 窗同口径），KPI 另列 |
| 阳性对照页内 `setTimeout` | **PASS** | §8.4 |
| `>50 ms` 帧计数只作相对 KPI | **PASS** | §6 明确标注 || 验收：≥3 rep / 相邻配对 / 同器械同窗 | **PARTIAL** | **2 个有效配对**（d1/c1、d2/c2）；1 配对退化（链底座）、2 配对无窗（锁竞争/无流量）——原因与全部 invalid 窗见 §8.8/§8.9 |
| 验收：主判据 `commits÷projection` 1.19 → ≤0.30 | **PASS（合并）/ MIXED（单 rep）** | 合并有效窗 **1.196 → 0.246**；单 rep c2=0.186 达标、c1=0.343 未达；分解见 §6.4 |
| 验收：`subagentTiming` 行仍在刷新（显式检查） | **PASS（机制层）/ INCONCLUSIVE（UI 层）** | §6.5.1；并**证伪了任务书暗示的那种文本检查是空洞的** |
| 验收：阳性对照页内 `setTimeout` | **PASS** | 注入 150 ms → RunTask 观测 150.4 ms（§6.6）|
| 验收：无功能回归 | **PASS（可及范围内）/ 设置页未测** | §6.5；本批探针不点击产品控件 |
| 验收：窗口有效性（心跳 + 浏览器 pid + **链底座**） | **PASS（新增第 4 道门禁）** | §8.2 + §8.8，d3/c3 的教训已内建为 `INVALID_CHAIN_SUBSTRATE` |
| **deployed 未被本档写入** | **PASS** | sha256 全程 `357f1703722464ee`；写入命令交协调者（§5）|

**自裁决：PASS（带明确的强度边界，非无条件 PASS）**

- 单元按契约逐条落地并通过全部机械自证（锚点唯一、最小性、标记保留、脚本 7 项要求）；
- 主判据在**合并有效窗**上达标（1.196 → 0.246 ≤ 0.30），但**单 rep 2 中 1 达标**、**≥3 rep 只达成 2 个有效配对** ⇒ 强度按 n=2 陈述；
- **两处审计前提被实测修正**（§7.1 rAF 合并 8.55× 而非 ≤1.07×；§7.2 闸门对重建次数贡献 0 而非 84.7% 收益）——这两条是**业务裁决项**，需协调者确认判据归因与阈值③的归属；
- **一处已披露的有界语义偏差**（非白名单键在 bag 内滞后，部署零读者，见 §3）与**一处未取到的 UI 端到端证据**（§6.5.1 DOM 见证）如实标 INCONCLUSIVE。

⇒ 需要协调者裁决的只有两项：**①判据归因（rAF 而非闸门）与阈值③是否改挂批次；②是否需要在锁空档补第 3 个有效配对**。二者属业务裁决，不是本档的实现缺陷。

---

## 10. 对协调者的行动项

1. **落地**：按 §5 的命令写入 deployed（热面，刷新即生效），随后跑 `--verify`。
2. **复验**：用 `scripts/run-acceptance.sh`（相邻配对）在**你自己**的窗口里复验 §6；注意先取锁。
3. **判据归因修正**：主判据 `commits÷projection ≤ 0.30` 若达标，**归因给 rAF**；阈值 ③（`list.set` 降 ≥70%）请**改挂**到"闸门 + M2（`subagentTiming` 值感知）"或候选 2/3 批次（见 §7.2）。
4. **跟进项（未扩范围，仅登记）**：① `subagentTiming` 热点（`dsh-subagent/lib/index.js:2140-2148`）值感知化 —— 这是让闸门释放主要收益的唯一途径；② `projectionValues` 公开类型收窄或加开发期不变量（§3 末尾）；③ `session/subscribed`→`truncate` 与 seed 路径对 Manager 的无条件 `markDirty`（`runtime:8316`/`7628`/`8120`）仍在闸门之外 —— 启动/列表刷新路径保留全量重建（二级 subagent `NEW FINDINGS #2`）。
5. **运维警告**：部署树内存在 2 份**同名未打补丁**的 `dsh-client-runtime` 副本，补丁必须按**确切路径 + sha256** 定位（§5 末）。
6. **补第 3 个有效配对（若需要 n≥3）**：`bash scripts/run-acceptance.sh` 已内建"链底座缺失/锁被占用"重试；把 `run` 行的 tag 改成 `d6/c6` 即可在锁空档补跑，产物落在 `raw/probe-*-d6.json` / `-c6.json`，再跑 `node scripts/analyze-reps.mjs` 即自动并入表格。
7. **全队窗口门禁建议并入第 4 道判据**（§8.8）：`INVALID_CHAIN_SUBSTRATE` —— 心跳与 pid 都正常、流量也正常，但**会话列表为空**时该链 0 产出；指纹 = `domNodes < 570` / `[role="treeitem"] < 12`。凡以"列表重建"为被测对象的线都应加这道门禁。
