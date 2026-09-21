# 执行前审计：P2 address-chain stale row（P-AC 落地锚点 / 语义 / 回归 / 共存 / 验收 / 回滚）

- **审计类型**：只读执行前审计（pre-execution audit）。**未改任何产品文件、未重启、未 pkill、未发信号、未传 `sandbox_permissions`。**
- **审计对象**：`/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js`
- **独占命名空间**：`.workspace/lag-fix/exec-audit/p2/`（本次唯一写入面）
- **上游语义审计**：`.workspace/lag-fix/research-v2/semantics/audit.md` + `harness-a-p2-stale-row.cjs` + `results/p2-stale-row.json`
- **纪律**：每条结论标 **PASS / FAIL / INCONCLUSIVE**，并区分 **实跑**（本次亲自执行）与 **推断**（读码/读报告得出）。

---

## 0. 结论摘要

| # | 交付项 | 结论 | 证据等级 |
|---|---|---|---|
| A | 精确锚点清单（两处，各恰好命中 1 次） | ✅ **PASS** | 实跑（`grep -cF` = 1/1）+ 原文逐字节读取 |
| B | 改动语义完整表述（可实现的链域条件） | ✅ **PASS** | 实跑（新增对拍 `verify-p2-ac-keyset-gate.cjs`：**39 PASS / 0 FAIL**） |
| C | 回归闸门（S1 消失 / S2 保留并刷新 / S3 保留 / S5 自愈） | ✅ **PASS** | 实跑 baseline **18/18** + 自定义对拍 **39/39**（含 S4 修正、S-IDENT 引用稳定、S-CUTOVER 割接） |
| D | 与 C1/B1 的共存与回滚次序 | ✅ **PASS** | 实跑（inode/manifest/脚本守卫逐条核对） |
| E | 生效面（热面，刷新即生效） | ✅ **PASS** | 实跑（脚本文档 + 插件 GET 语义，代码事实） |
| E2 | 活体 stale row 只读判据 | ⚠️ **INCONCLUSIVE（部分）** | **无纯只读活体判据**；须离线 harness 或受控浏览器观测 |
| F | 回滚点（独立 pre-image + 回滚命令） | ✅ **PASS** | 设计交付（未落地，故无实跑） |

**总体裁决：可执行（GO）**，落地必须遵守 §4 的三条铁律、§6 的回滚次序，以及 §2.2.1 的作用域/顺序机器判据。

**本次审计的关键增量（超出既有语义审计的部分）**：
1. **独立复核**了 P-AC 两处锚点与四态候选对拍的结论（baseline 复跑 18/18）；
2. **把 P-AC 的基数式闸门增强为成员性闸门**并用**新增对拍脚本**证明其仍为 FULL FIX（§7.4）；
3. **实测** P2 引用稳定性未被削弱（S-IDENT：`published2 === published1`），补上了既有 harness 缺的那条断言（§7.3）；
4. **实测**割接行为（S-CUTOVER）：补丁后首轮即清掉旧代码写入的残留键（§7.4 第 4 条）；
5. **揪出并固化三处真实陷阱**（T1 声明作用域 / T2 锚点位置 / T3 整行删除），已写成机器断言（§2.2.1、§7.4）。
其中 E2 明确降级为 **INCONCLUSIVE**：本次不提供"活体上确认 stale row 已消失"的只读判据；该缺陷**仅在离线 harness 上可判定**（理由见 §5.3）。

---

## 1. 目标文件与证据链复核（实跑）

### 1.1 sha256 核对

```
$ sha256sum .../dsh-client-runtime/lib/client.js
d71a8ca524307aa35b74c5504ce396458cd6cdd38bd2759be8e16bd1b783d69b
```

| 来源 | 记录值 | 一致？ |
|---|---|---|
| 本次实跑 | `d71a8ca524307aa3…` | — |
| `research-v2/semantics/harness-a-p2-stale-row.cjs:33` `EXPECTED_SHA256` | 同 | ✅ |
| `research-v2/semantics/audit.md:37` | 同（10661 行） | ✅ |
| `reports/audit-cross-patches.md:44`（独立交叉审计） | 同（397957 B / 10661 行） | ✅ |
| `backup/B1/client/20260920-153948/MANIFEST` `post_…client.js` | 同 | ✅ |

**判定：PASS（实跑）。** 目标未被改动，既有报告与本次审计面对**同一份字节**。

### 1.2 版本谱系（实跑，`reports/audit-cross-patches.md` §1.3 的推论本次独立复核）

```
C1 baseline  aba836a0  --(C1 --only P1,P2)-->  867207a9  == B1/client 备份的 pre-image(15:39:48)
867207a9     --(B1/C1 变换, rt 单行)-------->  a0fb4bb2  == 当前 live (d71a8ca5)
```

实测佐证：
- `backup/C1/20260920-153800/client-runtime.client.js` sha256 `13a5fe0e…`，**不含** `listProjection` / `Carry the previous projection` / `dsh-perf-fix P1 v1` / `P2 v1`（`grep -c` 全 0）。
- `backup/B1/client/20260920-153948/dsh-client-runtime/lib/client.js` sha256 `458c0898…`，**已含** `listProjection`×2、`Carry the previous projection`×1。
- **该 pre-image 与 live 的 `diff` 只有 1 个 hunk**：`:8572` 行尾追加 `&& prev.runningSubagentCount === entry.runningSubagentCount`。即 **B1 对 runtime bundle 的全部改动 = 这一行**。

**判定：PASS（实跑）。** 由此确认：**§3 的两处锚点由 C1 引入**（对应 `evidence/unit-C1-only-P1-P2.diff` 的 `@@ -8573,7 +8573,12 @@` 与 projectList hunk），B1 只在 `:8572` 叠加一行。

> ⚠️ **纠正一处易误读的事实**：`backup/R4-20260921-115821/deployed/client.js`（sha256 `eeb5dcf2…`，71490 B）**不是**本 bundle 的 pre-image —— 它是宿主侧另一个 71 KB 的 `client.js`（不含任何 P1/P2/B1 标记）。P-AC 的 pre-image 必须取自 §6.1，不得取 R4。

---

## 2. 精确锚点清单

### 2.1 该 bundle 的排版风格（实跑测得）

| 维度 | 事实 | 实测 |
|---|---|---|
| 缩进 | **Tab**，`projectList` 方法体在 **4 个 Tab**（方法声明 3 Tab） | `sed -n '9272p' \| cat -A` → `^I^I^IprojectList() {` |
| 引号 | 代码以**双引号**为主（`"child"`、`"subagent"`、`"number"`），模板串用反引号 | 全文 `"`×2474 vs `'`×147 |
| `undefined` | 判空**一律 `void 0`**（`undefined` 仅 29 次出现在字符串/类型文案里） | 全文 `void 0`×362 |
| 块注释 | 补丁标记用 `/* dsh-perf-fix P2 v1 */` 同行前缀风格 | `:9322`、`:8842` |
| 末尾 | 单行 `const`，无分号省略，`if (...) stmt;` 单行无花括号 | `:9327`、`:9340` |

**新补丁必须遵守**：4 Tab 缩进、`void 0`、块注释内**不得出现 `*/`**（本审计用 `* /` 规避）。

### 2.2 锚点 A —— 链域回拷（`:9326-9328` 的替换）

**当前字节形态（实跑 `cat -A`，`^I` = Tab）**：

```
^I^I^I^Iif (copiedPrevious) {$
^I^I^I^I^I/* Carry the previous projection's extra rows (address-chain children) forward before diffing. */$
^I^I^I^I^Ifor (const id of Object.keys(previousProjection.byId)) if (byId[id] === void 0) byId[id] = previousProjection.byId[id];$
^I^I^I^I}$
```

（**注意**：两行都是 **5 Tab** —— 它们位于 `if (copiedPrevious) {` 之内；该 `if` 的 **4 Tab** 开头来自 `:9325`。）

可移植锚点（不含缩进，用于 `grep -cF` 与 JSON 捕获组；**文件中恰好 1 次**，实跑验证）：

```
for (const id of Object.keys(previousProjection.byId)) if (byId[id] === void 0) byId[id] = previousProjection.byId[id];
```

**替换后形态 —— 三处插入点（A1 / A2 / A3）**

| 插入点 | 位置（当前字节） | 动作 | 期望命中 |
|---|---|---|---|
| **A1** | `:9294` 的 `if (current !== void 0 && currentAddress !== void 0) {`（**4 Tab**）**之前**、`:9293` 的 `}` 之后 | 插入 1 行声明（**4 Tab**） | 锚点 1 次 |
| **A2** | `:9299` 的 `seen.add(childId);`（**6 Tab**）之后 | 紧随其后插入 1 行登记（**6 Tab**） | 锚点 1 次 |
| **A3** | `:9327` 的原回拷行（**5 Tab**，已在 `if (copiedPrevious) {` 之内） | 用 2 行替换（**5 Tab**） | 锚点 1 次 |

> **⚠️ A1 必须落在「方法体顶层作用域」（4 Tab），不能落在 `if (current !== …) {` 之内（5 Tab）。**
> 理由（**本次对拍实测发现的真实作用域约束**）：`chainRowIds` 的**读取方**是 A3 的链域回拷，它位于
> `if (copiedPrevious) { … }` 块（方法体顶层、**不在** `if (current !== …)` 块内）。若把声明放进
> `if (current !== …) {` 块，声明就被块作用域限制，A3 处会抛 `ReferenceError: chainRowIds is not defined`
> （首轮 `projectList()` 即失败）——**这正是"锚点看着对、作用域却错"的典型陷阱**，本审计的自定义
> harness 因此把该情形列为失败项。故 A1 的锚点是 `if (current !== void 0 && currentAddress !== void 0) {`
> **这一行本身**，插入动作是"在它**上方**插入声明行"。

> **注**：A3 同时**删除其上方那行旧散文注释**（`/* Carry the previous projection's extra rows (address-chain children) forward before diffing. */`，`:9326`，5 Tab）—— 该注释描述的是已被替换掉的"无差别回拷"语义，留着会误导后续读者。落地时连同该行一起删除，**不需要**为它单列锚点（它与 A3 相邻，可用组合锚点定位）。

**A1 的插入文本**（4 Tab）：

```text
const chainRowIds = new Set(); /* p2ac-fix */
```

**A2 的插入文本**（6 Tab）：

```text
chainRowIds.add(childId); /* p2ac-fix */
```

**A3 的替换文本**（5 Tab，2 行）：

```text
/* p2ac-fix */ /* address-chain scoped carry-forward: only ids a visited chain step genuinely needs. */
for (const id of Object.keys(previousProjection.byId)) if (byId[id] === void 0 && chainRowIds.has(id)) byId[id] = previousProjection.byId[id];
```

> **缩进速查（本 bundle 实测）**：`projectList` 方法体顶层 = **4 Tab**；`if (current !== void 0 && currentAddress !== void 0) {` 内 = **5 Tab**；`while (address !== void 0 ...) {` 内 = **6 Tab**；`if (copiedPrevious) {` 内 = **5 Tab**。三个插入点分别落在 **4 / 6 / 5** Tab 层级 —— **插入文本必须逐字符带对应 Tab 前缀**，不得用空格。

### 2.2.1 三处作用域/顺序约束（落地后必须机器可判）

| 约束 | 判据 |
|---|---|
| 声明唯一 | 全文 `const chainRowIds = new Set();` 恰好 **1 次** |
| 声明先于使用 | `indexOf('chainRowIds.add(childId);')` **>** `indexOf('const chainRowIds = new Set();')` |
| 声明先于读取 | `indexOf('chainRowIds.has(id)')` **>** `indexOf('const chainRowIds = new Set();')` |
| 声明在方法体顶层 | 该行缩进 == `projectList` 顶层缩进（**4 Tab**），且**不**位于 `if (current !== …) {` 之后、其闭括号之前 |
| 旧语义已清除 | 全文 `for (const id of Object.keys(previousProjection.byId)) if (byId[id] === void 0) byId[id] = previousProjection.byId[id];`（无 `chainRowIds` 过滤）**0 次** |
| 旧注释已清除 | 全文 `Carry the previous projection's extra rows` **0 次** |

### 2.3 锚点 B —— 键集闸门（`:9340` 的替换）

**当前字节形态（实跑 `cat -A`）**：

```
^I^I^I^Iconst nextById = previousProjection !== void 0 && reusedEntries === liveKeys.length ? previousProjection.byId : stableById;$
```

可移植锚点（**文件中恰好 1 次**，实跑验证）：

```
const nextById = previousProjection !== void 0 && reusedEntries === liveKeys.length ? previousProjection.byId : stableById;
```

**替换后形态**：

```text
/* p2ac-fix */ /* key-set gate: reusing the whole previous byId object is only sound when its key set has no extra key. */
/* the previous key set is read AFTER the chain-scoped carry-forward, so it is compared against the same liveKeys. */
const reusableByIdKeys = previousProjection !== void 0 ? Object.keys(previousProjection.byId) : void 0;
const nextById = previousProjection !== void 0 && reusedEntries === liveKeys.length && reusableByIdKeys.length === liveKeys.length && reusableByIdKeys.every((id) => Object.prototype.hasOwnProperty.call(byId, id)) ? previousProjection.byId : stableById;
```

### 2.4 唯一性裁定（实跑，`grep -cF`）

| 锚点 | 锚点串 | 实测命中 | 结论 |
|---|---|---|---|
| **A1** | `if (current !== void 0 && currentAddress !== void 0) {` | `1`（`projectList` 内，**4 Tab**） | ✅ 唯一 |
| **A2 / B0** | `seen.add(childId);` | `1`（**全文件**唯一，6 Tab） | ✅ 唯一（**全文件级**，无需多行联合锚点） |
| **A3** | `for (const id of Object.keys(previousProjection.byId)) if (byId[id] === void 0) byId[id] = previousProjection.byId[id];` | `1` | ✅ 唯一 |
| **A3'**（被一并删除的旧注释） | `Carry the previous projection's extra rows` | `1`（紧邻 A3 上一行，同为 5 Tab） | ✅ |
| **B**（闸门行） | `const nextById = previousProjection !== void 0 && reusedEntries === liveKeys.length ? previousProjection.byId : stableById;` | `1` | ✅ 唯一 |
| 参考 | `reusedEntries === liveKeys.length` | `1` | ✅ |
| 参考 | `const liveKeys = Object.keys(byId);` | `1` | ✅ |

**判定：PASS（实跑，全部 7 项计数已实测）。** 以上计数由 `verify-p2-ac-keyset-gate.cjs` 固化为**机器断言**（锚点命中数 ≠ 1 即 `exit 1`），执行档落地前后各跑一次即可。

> **A1 与 A3 的锚点不同**：A1 锚 `if (current !== …) {`（4 Tab，用于**在其上方**插入声明），A3 锚回拷行本身（5 Tab，用于**整体替换**）。两者位置无关，不得混用。

---

## 3. 改动语义的完整表述

### 3.1 "只回拷当前地址链仍需要的 id"的精确条件

`previousProjection`（`:9323`）只在该投影对象**仍是 store 当前引用**时非空：

```
const previousProjection = this.listProjection !== void 0 && this.listProjection === this.list.getSnapshot() ? this.listProjection : void 0;
```

`currentAddress`（来自 `getListSnapshot()`，`:8593`）形如 `{ parentSessionId, childSessionId, mode }`，`current === void 0 ⇒ currentAddress === void 0`。

**可实现条件（建议落地形态）**：维护一个"本轮 walk 真正访问过的 synthetic child id"集合 `chainRowIds`，把**无差别回拷**收紧为**链域回拷**：

1. 在 `:9294` 的 `if (current !== void 0 && currentAddress !== void 0)` 内、walk 之前初始化 `const chainRowIds = new Set();`；
2. 在 walk 每一步 `seen.add(childId);` 之后立刻 `chainRowIds.add(childId);` —— **登记发生在 catalog 查找之前**，因此"地址在但 catalog 缺席"（S3）也会登记；
3. `:9327` 的拷贝条件由 `byId[id] === void 0` 收紧为 `byId[id] === void 0 && chainRowIds.has(id)`。

**等价判据（P-AC 原始形态）**：也可不引入 `chainRowIds`，而用"从 `currentAddress` 沿 `this.manager.navigationAddress(...)` 再走一遍、逐级 `Set.add(childSessionId)`"得到同一集合，再以 `chainNeeded.has(id)` 过滤。两者对 S1–S5 行为一致（§7 将两种形态一并实测）；本审计推荐 (1)(2)(3)，因为它**复用已存在的 walk**，不会因为 `navigationAddress` 的**副作用或非纯性**而与主 walk 产生分歧。

### 3.2 键集闸门的精确条件

`liveKeys`（`:9329`）是**当轮**合成完 `byId`（含链域回拷）后的键列表。`:9340` 原来只问"每个 live key 都复用了旧 entry 吗"（`reusedEntries === liveKeys.length`），**从未问**"`previousProjection.byId` 有没有多出来的键" —— 而一旦满足，代码把 `previousProjection.byId` **整体**当作本轮 byId 发布，多出来的键就此沿用。

**闸门条件（建议落地形态）**：在 `reusedEntries === liveKeys.length` 之外，追加

```
reusableByIdKeys.length === liveKeys.length && reusableByIdKeys.every((id) => Object.prototype.hasOwnProperty.call(byId, id))
```

即 **`previousProjection.byId` 的键集 ⊆ 本轮 `liveKeys`，且基数相等 ⇒ 键集相等**。

> **与已验证形态的关系**：语义审计对拍过的 **P-AC** 用的是**较弱**的基数式闸门 `Object.keys(previousProjection.byId).length === liveKeys.length`（见 §7.2 原始注记）。本审计增强为**成员性校验**，并用 §7 的自定义 harness **重新对拍**（实跑 PASS）。若执行档希望**零偏差复用已对拍文本**，§2.3 可直接降级为基数式 P-AC 原文 —— 两者在本 bundle 的现有不变量下等价（见 §3.3），基数式是已验证形态、成员式是更强形态。

### 3.3 为何不削弱 P2 的引用稳定性（未见内容变化时键集相等、身份照复用）

1. **复用条件更严，但触发路径不变**：增强后的闸门只在"键集相等"时放行；键集相等 ⇒ `stableById` 与 `previousProjection.byId` **键相同**，且由于 `reusedEntries === liveKeys.length`，**每个键对应的 entry 对象逐字段相等**（`:9336` 的 14 项判据全绿）⇒ `stableById[id] = previousEntry`，即 `stableById` 与 `previousProjection.byId` **逐键同对象**。此时"整体复用旧 byId"与"用 stableById"结果**引用级同一**，因此闸门**不会改变任何稳定态下的复用结果**。
2. **`unchangedProjection` 链不受影响**（`:9352`）：`previousProjection.byId === nextById` 在稳态仍成立 ⇒ `nextProjection === previousProjection` ⇒ `this.list.set(...)` 仍是**同一引用** ⇒ zustand selector 不触发重渲染。P2 的收益完整保留。
3. **唯一变化发生在"确有键集漂移"的那一轮**：此时本应重建（`stableById`），旧行为反而**错误地**把多余键一起发布出去。新行为退回重建 —— 这是**修复**而非削弱。
4. **首轮割接代价（必须知悉）**：补丁只能改**磁盘**文件。已运行的页面内存中 `listProjection.byId` 可能仍带陈旧行；刷新后**第一次** `projectList()` 时，键集不等 ⇒ 闸门拒绝整体复用 ⇒ 该轮重建一次（`stableById`），陈旧行被丢弃；此后回到稳定复用。即**代价 = 刷新后一个 round 的一次重建**（推断，基于 `:9323` 的引用守卫 + `:940` 闸门；非实跑活体）。
5. **P2 的判定面未扩大**：新代码不新增任何 `list.set` 调用、不改 `phase/current/currentAddress/subagentsByParent/jobsBySession` 的复用判据（`:9342`、`:9344`），只收紧 `nextById` 的取值。

**判定：PASS（推断 + §7 实跑对拍）。**

### 3.4 两类通道的相互依赖（为何两处必须同时改）

- 只改闸门（P-B）：陈旧键已由**无差别回拷**写入 `liveKeys`，`reusedEntries === liveKeys.length` 照样成立，闸门**照旧放行** → S1 不修（**REGRESSION**，对拍实测）。
- 只改回拷、删掉它（P-D）：S3 的"地址在 + catalog 缺席"行被丢掉 → **REGRESSION**（对拍实测）。
- 两处同时改（P-AC）：S1 消失、S2/S3/S4 保留 → **FULL FIX**（对拍实测，§7）。

**判定：PASS（实跑对拍）。**

---

## 4. 与 C1 / B1 的共存（新增独立标记 + 独立 pre-image + 回滚铁律）

### 4.1 共享事实（实跑）

| 事实 | 实测 |
|---|---|
| 同一份 live 文件被 **C1** 与 **B1/C1** 两个脚本先后改写 | `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-runtime` 是指向 `.npm-global/.../dsh-client-runtime` 的**符号链接** |
| 两路径**同一 inode** | `stat -c '%i'` → 均 `31355018`（397957 B） |
| C1 的 `--rollback` 还原的是 `aba836a0`（**baseline**），会**连带抹掉** B1 的 `:8572` 行与 P1/P2 全部 | `patches/client-runtime-perf.sh:99` `TARGET="${C1_TARGET:-$ROOT/dsh-client-runtime/lib/client.js}"` + `reports/audit-cross-patches.md` §1.3 物证链 + §3 表第 5 行（实测 `BYTE-EXACT` 回 baseline，标记 P1/P2 0/0，注明"**但连带**"） |
| B1/C1 的 `--rollback` 还原 runtime 到 `458c0898`（= C1 的 post 态） | `patches/workspace-ui-runsubagent-count.sh:182-184` 直接 `cp` 备份；MANIFEST `pre_…client.js=458c0898…` |
| 两脚本的回滚守卫均为 **fail-closed**（内容/归属校验） | C1：`META.unit==C1` + 备份自校验 + `pre_sha1==BASELINE_SHA1`；B1/C1：`MANIFEST unit==B1-client` + `sha256sum -c pre.sha256` + live 必属 `{pre,post}` |

### 4.2 本次改动的叠加方式（建议）

1. **新增独立标记**：`/* p2ac-fix */`（每处替换各 1 个，共 **3 处**：`:9299` 后登记行、`:9326` 注释+回拷、`:9340` 闸门）。**不得**复用 `/* dsh-perf-fix P2 v1 */`，也不得复用 `/* dsh-lag-fix B1/C1 */`（后者是 B1/C1 的幂等判据，复用会让 `workspace-ui-runsubagent-count.sh` 误判 `unit_state`）。
2. **新增独立 pre-image**：落地前 `cp` 当前 live（`d71a8ca5…`）到 `.workspace/lag-fix/backup/P2AC/<stamp>/client.js` + `sha256` + `META.txt`（记 `unit=P2AC-unit`、`pre_sha256=d71a8ca5…`、`target=<绝对路径>`）。**不复用** `backup/C1/`、`backup/B1/`、`backup/R4-*`。
3. **独立脚本/独立沙箱**：建议新增 `patches/p2ac-projectlist-chain-scope.sh`，自带 `--dry-run/--apply/--rollback`、锚点唯一性断言（§2.4）、幂等判据（命中 `/* p2ac-fix */` 即 SKIP）、回滚守卫（`META.unit==P2AC-unit` + `pre_sha256==本单元基线` + live 归属校验）。**不要**把本次改动塞进 `client-runtime-perf.sh`（该脚本 `--apply` 未加 `--only` 时已对 live 判 `unknown:missing=P4a…` 而 `exit 1`，塞进去会让幂等/回滚语义进一步纠缠）。

### 4.3 回滚铁律（次序不可换）

```
① P2AC 本单元回滚   (workspace 内独立脚本 --rollback 或 cp 回 pre-image)
        ↓  目标态：live 回到 d71a8ca5
② B1/C1 --rollback  (workspace-ui-runsubagent-count.sh --rollback)
        ↓  目标态：runtime 回到 458c0898、ui 回到 baac1913
③ C1 --rollback     (client-runtime-perf.sh --rollback)
        ↓  目标态：runtime 回到 baseline aba836a0
```

- **铁律 1**：**P2AC → B1/C1 → C1**，逆序或跳步都不行。§4.1 最后一行的 fail-closed 守卫会**保护**你：若跳过 ①，B1/C1 的 live 归属校验会因 sha256 不匹配 `{pre,post}` 而 `exit 1` **拒绝写入**（不误覆）；若跳过 ②，C1 的 `pre_sha1==BASELINE_SHA1` 校验同样拒绝。**但不得依赖守卫兜底** —— 守卫只保证"不误写"，不保证"次序正确"。
- **铁律 2**：**禁止**用 C1 `--rollback` 作为 P2AC 的回滚手段：它还原的是 `aba836a0` baseline，会连带抹掉 **B1 的 `:8572` 行** 与 **P1/P2 全部**（§4.1 已实测确认，报告原文："**C1 回滚会连带抹掉 B1/C1 的改动**（D1，已实测）"）。
- **铁律 3**：P2AC 回滚后，**必须**重新应用 B1/C1（若之前回滚过它），否则 runtime 会停留在 `867207a9`（C1 post、B1/C1 pre），此时 C1 的 `pre_sha1` 校验会拒绝进一步回滚，形成**悬挂态**。

---

## 5. 生效与验收

### 5.1 生效面：**client 热面 —— 刷新即生效，无需重启**（PASS，代码/脚本文档事实）

- `dsh-client-runtime/lib/client.js` 属**客户端热面**：宿主按 `/plugins/<id>/client.js` **每次 GET 从磁盘读**、`no-cache`，`?rev=` 只是 sha1-12 缓存破坏串；`dsh-client-hmr` 以 500 ms 轮询推 `rebuilt`（`patches/workspace-ui-runsubagent-count.sh:20-26` 原文）。
- 同一结论在 C1 侧同样成立（`patches/client-runtime-perf.sh:24` "还原后浏览器刷新即可"）。
- **本次改动不需要重启 DSH、不需要 pkill**（符合本次纪律）。

### 5.2 served rev/hash 核对方法

1. 本地磁盘侧：`sha1sum <target> | cut -c1-12` 得到 **改后 12 位 rev 期望值**（C1 脚本 §help 原文做法）。
2. 服务端侧：`curl -s http://127.0.0.1:3080/plugins/<id>/client.js | sha1sum | cut -c1-12`，或带缓存破坏串 `?rev=<12位>` 再取。
3. **判据**：两串**必须一致**（服务端每次 GET 从磁盘读、no-cache）。改后 sha256 亦应等于"pre-image + P2AC 变换"的复算值。

> ⚠️ 该核对只证明**分发面已换新字节**，**不证明**运行中的页面已执行新代码；页面执行新代码的充要动作是**刷新**。

### 5.3 活体判据：**无纯只读判据 → 仅离线 harness 可判**（INCONCLUSIVE，本审计明确降级）

**为什么没有只读活体判据（推断，但依据确凿）**：

- stale row 只存在于**浏览器页面内存**里的 `SessionRuntime.listProjection` / zustand store（`this.list.set(nextProjection)`，`:9370`）。它**不落盘、不出网络、不进日志**。
- 宿主侧只提供 `list` 投影的**服务端来源**（`getListSnapshot()`），而缺陷恰恰发生在**客户端把服务端快照投影成 store 的那一步**（`projectList`）。因此从宿主/磁盘侧**观测不到**这一残留行。
- 无头浏览器**只读**观测也**不成立**：要在活体上触发 S1，必须操作真实会话（选中 synthetic child → 点回父会话），这既是**写操作**（改选择态）又可能污染真实会话，违反本次只读纪律；且需要注入页面脚本读取内部 store，属**侵入式**。

**因之裁定**：

- **"活体上确认 stale row 不再出现" = INCONCLUSIVE（不可判定，无只读判据）**。
- **本缺陷的判定只能落在离线 harness 上**（`harness-a-p2-stale-row.cjs`，真函数字节切片 + 真数据形状，18/18 PASS）。这是**方法上可接受**的，因为该 harness 的 `projectList`/`eligible`/`pruneScopes` 与 `sameIdList`/`displayTitleOf`/`indexSubagentDescendants` 等**全部按字节切片自 live bundle 提取**，并以 `Proto[method].toString() === slice` 做运行时同一性自证，外加"变异对照必须失败"证明守门非空转。
- **落地后可做的次级（非判定性但有用）只读验收**：
  1. `grep -c '/\* p2ac-fix \*/' <target>` == `3`（标记落地）；
  2. `sha256sum <target>` == 预期复算值（无越界改写）；
  3. `node --check <target>` 通过（语法完整）；
  4. served rev == 磁盘 sha1-12（§5.2）；
  5. 刷新后浏览器 console 无异常、侧边栏无重复/幽灵行 —— **仅人眼定性观察，不作为 PASS 判据**。

**判定：E = PASS（热面事实）；E2 = INCONCLUSIVE（活体不可只读判定，须离线 harness）。**

---

## 6. 回滚点

### 6.1 独立 pre-image（落地前置动作，**执行档必须原样执行并记录输出**）

```bash
STAMP="$(date +%Y%m%d-%H%M%S)"
TARGET="/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js"
PRE_DIR="/home/CNS2026495165/dsh/.workspace/lag-fix/backup/P2AC/$STAMP"
mkdir -p "$PRE_DIR"
cp -p "$TARGET" "$PRE_DIR/client.js"
sha256sum "$PRE_DIR/client.js" > "$PRE_DIR/client.js.sha256"
{
  echo "unit=P2AC-unit"
  echo "stamp=$STAMP"
  echo "target=$TARGET"
  echo "pre_sha256=$(sha256sum "$TARGET" | cut -d' ' -f1)"   # 期望 d71a8ca5…
} > "$PRE_DIR/META.txt"
```

**前置断言（实跑于落地前）**：`sha256sum "$TARGET"` **必须**等于
`d71a8ca524307aa35b74c5504ce396458cd6cdd38bd2759be8e16bd1b783d69b`；
不等则**停止**（说明盘面已变，§2 锚点需重新推导）。

### 6.2 回滚命令

```bash
# 单条回滚（幂等、只覆盖本单元目标）
cp -p .workspace/lag-fix/backup/P2AC/<STAMP>/client.js \
      /home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js

# 回滚后必须自证（三条全绿才算回滚成功）
sha256sum <target>                              # == d71a8ca5…（== pre-image 记录）
grep -c '/\* p2ac-fix \*/' <target>             # == 0
node --check <target> && echo SYNTAX-OK
```

**回滚后生效**：刷新 `http://127.0.0.1:3080` 即回到改前行为（热面，无需重启）。

**若需继续回滚**：见 §4.3 铁律 —— **P2AC → B1/C1 → C1**，且**禁止**用 C1 回滚抹掉 B1/C1 与 P2AC 行。

---

## 7. 回归闸门：复用 `harness-a-p2-stale-row.cjs`

### 7.1 用法与期望（实跑）

```bash
node .workspace/lag-fix/research-v2/semantics/harness-a-p2-stale-row.cjs
```

**基线实跑（本次亲自执行）**：`18 PASS / 0 FAIL`，`exit=0`。
其中与 P2 直接相关的行：

```
PASS: S1: synthetic child row still residually present in published byId after the address is cleared -> byId keys = ["p","child"], ids = ["p"]
PASS: S2 control: kept row is refreshed from the live catalog, not frozen at the carried value -> displayTitle=ChildRenamed
PASS: S3 control: child row kept from the carried previous projection when the catalog is absent -> displayTitle=Child
PASS: S5 (bound): the residue is not permanent — any ids-list change clears it -> ids=["p","q"] byId=["p","q"]
PASS: candidate P-AC behaved as predicted -> FULL FIX (predicted FULL FIX) -> fixes S1=true, keeps S2/S3/S4=true; S1 byId after patch = ["p"]
```

**落地后的回归判据（闸门）**：

| 闸门 | 判据（落地后必须成立） | 现状基线 |
|---|---|---|
| **G-ANCHOR** | harness 仍能按锚点提取 `projectList` 且 `sha256` 匹配 —— ⚠️ **落地后 `EXPECTED_SHA256` 会失效**：须**显式**把 `harness-a-p2-stale-row.cjs:33` 的目标 sha 改成新值（或在 `harness-a-p2-stale-row.cjs` 旁**复制一份** `*-post-p2ac.cjs` 只改该常量，保留原 harness 作为"改前态"物证）。**不得静默删掉该断言** | pinned `d71a8ca5` |
| **G-S1** | S1 的 `byId keys` 不再含 `child`；残留行消失（`stale_row_present=false`） | 缺陷态（`["p","child"]`） |
| **G-S2** | 地址仍在 + catalog 在 + label 改名 ⇒ `child` 行**存在**且 `displayTitle === 'ChildRenamed'`（刷新，非冻结） | PASS |
| **G-S3** | 地址仍在 + catalog **缺席** ⇒ `child` 行**保留**（`displayTitle === 'Child'`） | PASS |
| **G-S4** | 地址改指 `child2` ⇒ 仅保留 `child2`，**不含** `child1` | 缺陷态（`["p","child2","child1"]`） |
| **G-S5** | `ids` 一变（`["p","q"]`）⇒ 残留 `child` 行消失（自愈） | PASS |
| **G-IDENT** | 稳态（内容未变）下 `projectList` 仍返回**同一投影引用**（`this.list.set` 收到 `=== previousProjection`）—— 防"修好了陈旧行、却把 P2 复用收益改没了" | 需新增断言（见 7.3） |

### 7.2 本次对“键集闸门”增强的独立对拍（实跑，新增）

为免把 §3.2 的**成员性闸门**当作未验证改动落地，本审计新增只读对拍脚本：

- 脚本：`.workspace/lag-fix/exec-audit/p2/verify-p2-ac-keyset-gate.cjs`
- 产物：`.workspace/lag-fix/exec-audit/p2/results/p2ac-keyset-gate.json`
- 方法：`projectList` 及其依赖函数**按字节自 live bundle 提取**（sha256 钉死 `d71a8ca5`）；两处补丁文本**从本 `audit.md` 的代码块解析**（消除复述漂移）；对 `{未改, 成员性闸门, 基数式 P-AC}` 三态跑 S1–S5（含 S4）。

**实跑结果**：见 §7.4（结果以脚本落盘的 JSON 为准）。

### 7.3 建议补一条「身份复用未削弱」断言

现有 harness 只判 S1–S5 的**行集合**，不判 **P2 的引用稳定性**。建议在 P2AC 落地时补断言：

- 场景：连续两轮 `getListSnapshot()` **内容完全不变**（含 catalog 与 address 均不变）；
- 断言：第 2 轮 `projectList()` 后，`runtime.__setCalls` 里最后一个对象 **`===`** 第 1 轮发布的对象（即 `unchangedProjection === true` 路径被走到）；
- 理由：这是 P2 存在的**唯一收益来源**，也是本次改动**最可能被误伤**的面（§3.3 已论证不会，但需机器判据守门）。

### 7.4 对拍结论（实跑，`39 PASS / 0 FAIL`，`exit=0`）

脚本：`.workspace/lag-fix/exec-audit/p2/verify-p2-ac-keyset-gate.cjs`
产物：`.workspace/lag-fix/exec-audit/p2/results/p2ac-keyset-gate.json`

**三态 × 六场景矩阵（实跑）**：

| 变体 | S1 地址清空 | S2 地址在+目录在+改名 | S3 地址在+目录缺席 | S4 地址改指 | S5 ids 变 | S-IDENT 引用同一 | S-CUTOVER 割接首轮 |
|---|---|---|---|---|---|---|---|
| **未改**（真函数） | `stale` ❌ | `ok` | `ok` | `stale` ❌ | `cleared` | `same-ref` | `stale` ❌ |
| **P-AC 成员性闸门**（本方案） | **`fixed`** ✅ | `ok` | `ok` | **`fixed`** ✅ | `cleared` | **`same-ref`** ✅ | **`fixed`** ✅ |
| **P-AC 基数式闸门**（语义审计已对拍形态） | **`fixed`** ✅ | `ok` | `ok` | **`fixed`** ✅ | `cleared` | **`same-ref`** ✅ | **`fixed`** ✅ |

`byId` 键实测：未改 S1 = `["p","child"]` → 两补丁 S1 = `["p"]`；未改 S4 = `["p","child2","child1"]` → 两补丁 S4 = `["p","child2"]`；两补丁 S3 均 `["p","child"]`（**保留**）。

**关键结论（全部实跑）**：

1. `unpatched_reproduces_defect = true` —— 未改真函数在 S1/S4/S-CUTOVER 上**复现陈旧行**（S1 残留行使 `indexSubagentDescendants(byId).get("p") = {count:1,runningCount:1}`，而 `eligible("child") = false`）。
2. `member_gate_is_full_fix = true`、`count_gate_is_full_fix = true` —— **两种闸门形态都是 FULL FIX**，S1 消失、S2 保留且刷新、S3 保留、S4 修正、S5 自愈。
3. `p2_identity_preserved = true` —— **S-IDENT 实测**：两轮内容完全不变时，第 2 轮的 `this.list.set(...)` 收到的对象 **`===`** 第 1 轮的对象（`published2 === published1` 为真）⇒ **P2 的引用稳定性未被削弱**（§3.3 的论证获得机器判据）。
4. `cutover_drops_preexisting_stale_row = true` —— **割接实测**：第 0 轮由**未改**代码跑出带 `child` 的 `listProjection`，第 1 轮换上补丁代码 ⇒ 两补丁形态都**在首轮即清掉**该陈旧行（`["p","child"] → ["p"]`）。这证明闸门确实承担了"回收旧代码已写入的残留键"的作用，**不是**只为新写入兜底。

**对拍过程中被机器判据揪出的三处真实陷阱（已回写进 §2.2 / §2.2.1，执行档必须注意）**：

| # | 陷阱 | 现象 | 结论 |
|---|---|---|---|
| T1 | **A1 声明若放进 `if (current !== …) {` 块（5 Tab）** | 首轮 `projectList()` 即抛 `ReferenceError: chainRowIds is not defined` | A1 **必须**落在方法体顶层（**4 Tab**），因为读取方 A3 不在该 `if` 块内 —— 块作用域约束 |
| T2 | **A1 若锚在 `const copiedPrevious` 行** | 声明被插到 walk **之后**，仍然 `chainRowIds is not defined` | A1 的锚点必须是 `if (current !== …) {` **这一行本身**（在它上方插入） |
| T3 | **旧散文注释行只替换文本、不删整行** | 留下孤立缩进（8 Tab）的行，`diff` 里出现畸形空白 | A3 必须连同该注释**整行**（含换行）一并删除 |

> T1/T2/T3 都是"文本锚点看着对、语义/作用域却错"的实例。**执行档落地后必须跑 §7.2 的对拍脚本**（它已把这三条固化为机器断言：声明唯一、声明先于使用/读取、gate 紧邻 `liveKeys` 之后）。

> **形态选择建议（本审计裁决）**：两种闸门都对拍为 FULL FIX。**成员性闸门**（`hasOwnProperty` 成员校验）是更强形态，能防"未来 `liveKeys` 计算方式被改动后基数相同、键不同"的隐性回归，代价是每轮多一次 `O(N)` 成员扫描（仅在该分支已通过 `reusedEntries === liveKeys.length` 时执行）。**基数式闸门**则是语义审计已对拍的原文形态，偏差为零。**若执行档追求"零偏差复用已对拍文本"，可降级为基数式；本审计推荐成员性**，理由是它在本 harness 下同样 PASS，且对未来的改动更耐。**

### 7.5 方法学提醒：两轮必须同一实例

对拍脚本最初把"第 2 轮"跑在**新建的 runtime 实例**上，结果 `this.listProjection` 在第二轮为 `undefined` ⇒ `previousProjection === void 0` ⇒ **P2 的复用分支根本没进入**，未改代码反而"看起来没有缺陷"（S1 假 PASS）。

**故一切 P2 相关回归（含 `harness-a-p2-stale-row.cjs` 的复用）都必须保证：同一场景的两轮跑在同一个 `SessionRuntime` 实例上**（或显式搬运 `listProjection`，如 §7.4 的 S-CUTOVER）。否则测的不是真代码路径。

---

## 8. 逐条纪律自检

| 纪律 | 状态 |
|---|---|
| 只读、未改产品文件 | ✅ 实跑：live 目标 sha256 审计首尾一致（`d71a8ca5…`） |
| 未重启、未 pkill、未发信号 | ✅ 未执行任何进程操作 |
| 工具调用未传 `sandbox_permissions` | ✅ 全程未传 |
| 独占 `.workspace/lag-fix/exec-audit/p2/` | ✅ 唯一写入面 |
| 逐条标 PASS/FAIL/INCONCLUSIVE，区分实跑/推断 | ✅ 见各节 |
| 唯一副作用披露 | 运行 `harness-a-p2-stale-row.cjs` 会**重写其自己的产物** `research-v2/semantics/results/p2-stale-row.json`（脚本设计行为，非产品文件、非本单元命名空间） |

---

## 9. 实跑记录（本审计亲自执行）

| # | 命令（要点） | 结果 |
|---|---|---|
| 1 | `sha256sum <target>` | `d71a8ca5…`（与 harness `EXPECTED_SHA256`、`semantics/audit.md`、`reports/audit-cross-patches.md`、`backup/B1/.../MANIFEST` 全一致） |
| 2 | `sed -n '9255,9384p' <target>` | 定位 `projectList`（`:9272`），两处锚点字节形态见 §2 |
| 3 | `sed -n '9326,9328p' <target> \| cat -A` | 4 Tab 缩进 + `void 0` 确认 |
| 4 | `grep -cF '<锚点A>'` / `grep -cF '<锚点B>'` | `1` / `1` |
| 5 | `diff backup/C1/.../client-runtime.client.js <target> \| wc -l` | `118`（C1 baseline 与本文件差异面） |
| 6 | `diff backup/B1/client/.../dsh-client-runtime/lib/client.js <target>` | **仅 1 hunk**（`:8572` 追加 `runningSubagentCount` 判据） |
| 7 | `grep -c` C1 pre-image 探针 | `listProjection`/`Carry the previous`/`dsh-perf-fix P1 v1`/`P2 v1` 全 `0` ⇒ 两锚点由 **C1** 引入 |
| 8 | `stat -c '%i'` 两路径 | 均 `31355018` ⇒ D1 根因（同一 inode）成立 |
| 9 | `node harness-a-p2-stale-row.cjs` | **18 PASS / 0 FAIL**，`exit=0` |
| 10 | `node verify-p2-ac-keyset-gate.cjs` | **39 PASS / 0 FAIL**，`exit=0`；三态×六场景矩阵见 §7.4 |
| 11 | 对拍中发现并修正的三处真实陷阱（T1 作用域 / T2 锚点位置 / T3 整行删除） | 已回写 §2.2、§2.2.1、§7.4 |
| 12 | `sha256sum <target>`（收尾复核） | `d71a8ca5…` **未变**（产品文件全程只读） |
