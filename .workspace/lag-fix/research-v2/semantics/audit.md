# 语义缺陷裁决 —— 【A】P2 stale-row 与 【B】B1「最近 200」/ running 计数降级

- 日期：2026-09-21
- 工作区：`/home/CNS2026495165/dsh`，独占目录 `.workspace/lag-fix/research-v2/semantics/`
- 约束：**纯离线**。未重启宿主、未修改任何产品文件、未读写真实会话日志/DB、未写 `~/.dsh`。所有被测代码均为**只读**抽取。
- 交付物（全部可重跑、全部已通过自证）：
  - `harness-a-p2-stale-row.cjs` —— A 线 harness（18/18 断言 PASS）
  - `crosscheck-b1-cold-sort.cjs` —— B① 独立 harness
  - `crosscheck-b1-running-count.cjs` —— B② 独立 harness
  - `results/p2-stale-row.json`、`results/b1-cold-sort-crosscheck.json`、`results/b1-running-count-crosscheck.json`（原始 JSON）
  - `_not-delivered/` —— 一个更宽的 B 线 harness 在作者修复途中被中断、语法不完整，**已隔离且不作为证据**（见其中 README）
  - 本文件 `audit.md`

## 0. 证据级别定义（全文严格区分）

| 级别 | 含义 |
|---|---|
| **实跑复现（executed）** | 真函数 / 真数据形状在 harness 内实际执行得到的观测值；JSON 中标注 `"evidence": "executed"`。 |
| **代码推断（code-inference）** | 未执行、仅由源码行锚点推出的结论；列出 `文件:行` 与原文片段。JSON 中标注 `"evidence": "code-inference"`。 |

**抽取方法学（禁止手抄）**：被测函数一律以**字节切片**（`src.slice(a,b)`）从 live 产物抽出后编译执行，并自证：
1. 目标文件 `sha256` 与 harness 内 pin 值逐字相等（不等即 `exit 1`，不做"重算后继续"）；
2. 每个语义锚点（含可疑行本身）必须在**被抽出的函数体内部**出现；
3. 运行期 `Proto[method].toString()` 与切片在 V8 方法源码规范化后逐字节相等（证明"跑的就是抽出来的那段"）；
4. **变异对照**（A 线 harness 专属）：把锚点改错名后抽取必须抛错退出（证明守卫非空转）；B 线两个 harness 的自证为第 1-3 条（其中第 3 条以"运行期源码仍携带被抽取函数体"的断言形式给出）。
A 线 18/18 断言 PASS；B 线 3 个 harness 全部 `exit 0` 且输出 JSON 可复现（同一命令两次运行 sha256 相同）；裁决汇总见 §3。

---

## 1. 【A】P2 stale-row（address-chain synthetic child 残留）

### 1.1 被测对象与抽取自证（executed）

| 项 | 值 |
|---|---|
| live 产物 | `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js` |
| sha256 | `d71a8ca524307aa35b74c5504ce396458cd6cdd38bd2759be8e16bd1b783d69b`（10661 行） |
| 是否被 Web 实际加载 | `dsh-client-runtime/package.json` → `exports["./client"].default = "./lib/client.js"`，`dsh.client.platform = "web"`（已核对，非推断） |
| 抽取片段 | `projectList` @行 9272（字节 340272-346451）、`eligible` @9267、`pruneScopes` @9374、`displayTitleOf` @8833、`workspaceTitleOf` @8826、`sameIdList` @8843、`sameJobViewList` @8850、`sameSubagentCatalogs` @8863、`sameSubagentCatalogEntries` @8878、`indexSubagentDescendants` @10355 |

自证结果（`results/p2-stale-row.json` → `extractionProof`）：pin hash 相等 **PASS**；8 个语义锚点全部命中抽出函数体内部 **PASS**；运行期源码与切片一致（`projectList` 差 3 字节 = 声明行缩进 + 尾换行，V8 规范化所致）**PASS**；变异对照抛错退出 **PASS**。

harness 侧替身只有：快照 store、`SessionManager.getListSnapshot()/navigationAddress()`、`selection`。其契约锚定真实源码行（`client.js:5416/5423-5425/8266-8270/7906-7915`），并在 JSON 的 `storeContractEvidence` 中逐条记录 —— 这部分是**代码推断**。

### 1.2 场景与观测（全部 executed）

| 场景 | 构造 | 观测 | 结论 |
|---|---|---|---|
| **S1（待裁决缺陷）** | 轮1：`items=[p]`、`current='child'`、`currentAddress={p→child}`、catalog 含 child(activity=running)；轮2：`items` 仍只有 `p`（ids 不变）、`currentAddress` 变空、catalog 空 | 轮2 `ids=["p"]` 而 `byId` 键 = `["p","child"]`；残留行 `{id:"child",displayTitle:"Child",parentId:"p",origin:"subagent",running:true,blank:false,updatedAt:0}` | **残留 = 真** |
| S1 附加 | 同一轮真函数 `indexSubagentDescendants(byId)` | `.get("p") = {count:1,runningCount:1}`（ids=[p] 时本应无后代） | 残留被真实消费方计入 |
| S1 附加 | 同轮抽出的真 `eligible(id)` | `eligible("child")=false`、`eligible("p")=true` | 投影发布了 scope 已被剪掉的行（投影/scope 不一致） |
| **S2 对照（不得误删）** | `currentAddress` 仍指向 child、catalog 仍在且 label 改为 `ChildRenamed` | 行保留且 `displayTitle='ChildRenamed'`（取到新值，非冻结旧值） | 未误删/未陈旧 |
| **S3 对照（不得误删）** | `currentAddress` 仍指向 child、但 catalog 本轮缺席（`navigationAddress(p)=undefined`） | 行保留（`displayTitle='Child'`） | 这正是 carry-forward 存在的理由，不得整体删除 |
| **S4 地址改指** | 轮1 地址=`child1`；轮2 地址=`child2`、catalog 含 child2 | `byId` 键 = `["p","child2","child1"]` —— **被放弃的 child1 同样残留** | 缺陷不止"地址清空"，改指也泄漏 |
| **S5 缺陷边界** | 轮2 多出一个顶层会话 q（ids 变化） | `byId=["p","q"]`，残留自动消失 | 残留**不是永久泄漏**；只要 ids 一变即清除；ids 长期不变（安静的顶层会话）时残留可长期存在 |

### 1.3 根因：**两条独立的泄漏通道**（executed 定位）

harness 的候选补丁实验把根因从"一条"钉成"两条"，两者都在 P2 优化段内：

- **通道 c1 —— 无差别回拷**（`client.js:9327`，`/* dsh-perf-fix P2 v1 */` 段内）：
  ```js
  for (const id of Object.keys(previousProjection.byId)) if (byId[id] === void 0) byId[id] = previousProjection.byId[id];
  ```
  只要 `sameIdList(previousProjection.ids, ids)` 为真，就把上一轮 byId 中"当前缺失"的所有键**不论是否需要**拷回，直接进入本轮 `liveKeys`。
- **通道 c2 —— byId 整体身份复用未校验键集**（`client.js:9340`）：
  ```js
  const nextById = previousProjection !== void 0 && reusedEntries === liveKeys.length ? previousProjection.byId : stableById;
  ```
  `reusedEntries === liveKeys.length` 只说明"本轮每个 live 键都复用了旧条目对象"，**并不说明旧 byId 没有多余的键**；此时整包返回旧 byId，把多余键一起重新发布。

**实验证据（同一 harness，四种候选补丁对拍）**：

| 候选 | 改动 | S1 残留 | S2/S3/S4 对照 | 裁决 |
|---|---|---|---|---|
| P-A | 仅把 c1 改成"只回拷当前地址链需要的 id" | 仍残留（`byId=["p","child"]`） | 全部保持 | **PARTIAL** |
| P-B | 仅给 c2 加键集闸门 | 仍残留 | **S4 也坏**（`["p","child2","child1"]`） | **REGRESSION** |
| **P-AC** | **c1 链域化 + c2 键集闸门** | **消失（`byId=["p"]`）** | **全部保持** | **FULL FIX（已实跑验证）** |
| P-D | 直接删除 c1 + c2 闸门 | 消失 | **S3 回归**（地址保留/catalog 缺席时行被删） | **REGRESSION** |

> 注：P-A 的失败正是"发现 c2 存在"的实验手段 —— 单看代码容易误判为"只有回拷一行有错"。

### 1.4 裁决

- **【A】P2 stale-row：缺陷成立（CONFIRMED，实跑复现）** —— 不是读代码猜测：`ids` 不变 + `currentAddress` 清空时，synthetic child 行确实残留在新发布的 `byId` 中（S1），且被真实消费方 `indexSubagentDescendants(byId)` 计入（`{count:1,runningCount:1}`），同时 `eligible(child)=false`（无 scope 背书）。
- 缺陷边界（同样实跑）：**仅当 `ids` 列表跨轮不变时**成立；`ids` 一变即自愈（S5）。因此表现为"安静的顶层会话上残留可长期存在"，而非必然永久。
- 影响面（**代码推断**，行锚点见 `results/p2-stale-row.json` → `codeInferenceNotes`）：行枚举走 `list.ids`，所以残留行**不会**作为顶层行渲染；但所有后代聚合走 `list.byId` ——
  - `dsh-client-ui-workspace/lib/client.js:194/224/253` `indexSubagentDescendants(list.byId)`，`:171/:286` `typeof s.runningSubagentCount === "number" ? s.runningSubagentCount : (descendants.get(s.id)?.runningCount ?? 0)`（宿主字段缺席时用 byId 结果兜底 → 角标虚高）；
  - `dsh-client-ui-subagent/lib/client.js:397` `useSessions(state => state.byId)`、`:415` `indexSubagentDescendants(summaries)`、`:176-177` catalog loading 行按 `parentId` 从 byId 枚举；
  - `client.js:9366` 选区守卫 `byId[current] !== void 0` —— 残留行可让一个已失效的选区长存。
- 真实性（**代码推断**）：`client.js:8593` `currentAddress: current === void 0 ? void 0 : this.addresses.get(current)`，而 `select(sessionId)`（`:7863-7870`）只设 `selected`；子代理地址一旦由 `selectSubagent`（`:7881`）写入 `addresses` 就**保留**在 manager 中。因此"用户从 synthetic child 点回父会话"这一步天然产生 S1 的 `currentAddress` 清空 + `ids` 不变组合。

### 1.5 最小修复设计（已实跑验证 = P-AC，两处 edit，均在 `SessionRuntime.projectList` 内）

**edit 1 —— c1 链域化（替换 `client.js:9326-9327`）**：只回拷"当前地址链仍然需要"的 synthetic row：

```js
if (copiedPrevious) {
  /* Carry the previous projection's synthetic rows forward only while the live address chain names them. */
  const chainNeeded = new Set();
  {
    const seenChain = new Set();
    let chainAddress = current === void 0 ? void 0 : currentAddress;
    while (chainAddress !== void 0 && !seenChain.has(chainAddress.childSessionId)) {
      seenChain.add(chainAddress.childSessionId);
      chainNeeded.add(chainAddress.childSessionId);
      chainAddress = this.manager.navigationAddress(chainAddress.parentSessionId);
    }
  }
  for (const id of Object.keys(previousProjection.byId)) if (byId[id] === void 0 && chainNeeded.has(id)) byId[id] = previousProjection.byId[id];
}
```

**edit 2 —— c2 键集闸门（`client.js:9340`）**：整包复用旧 byId 前，必须证明旧 byId **没有**多余键：

```js
const nextById = previousProjection !== void 0 && reusedEntries === liveKeys.length
  && Object.keys(previousProjection.byId).length === liveKeys.length ? previousProjection.byId : stableById;
```

**代价**：edit 1 多走一次地址链（链长 = 委托深度，实际 ≤ 3~4，且 `navigationAddress` 是 Map 查询）；edit 2 是 O(1) 的键数比较。**两者都不削弱 P2 的引用稳定性**：在"content 未变"的常态下 `liveKeys` 与旧 byId 键集相等，闸门照样放行、对象身份照样复用（unchangedProjection 短路路径不受影响）；只有"旧 byId 多出键"的异常态才退化为逐条目重建。
**回归风险**：S3（地址保留但 catalog 缺席）依赖 edit 1 的链域回拷，已在 harness 中作为对照断言（PASS）；若把 edit 1 简化成"整段删除"，S3 立刻回归（P-D 实测）。
**建议落点**：`client.js` 属产品产物文件（bundle），修复应改源仓库对应 TS 源（`SessionRuntime.projectList`）后重建，不要直接改 `lib/client.js`。

---

## 2. 【B】B1 —— 「最近 200」与 running 计数降级

### 2.0 被测对象与抽取自证（executed）

| 项 | 值 |
|---|---|
| live 宿主产物 | `.../dsh-host-apiproxy/lib/index.js`，sha256 `1b9915f505996912c6f49b12b0c3f4a8261a74f26422f68f5d22cab2bc078a62`（5651 行；`package.json.main` 指向它，是运行时加载的那个） |
| 同源旧构建 | `lib/types/api-proxy.js`，sha256 `f5c34a439043b9d5771286a76c8b16210951c25d7d5873b168bcc947720eac0d`（含同一语义，见 §2.3） |
| 持久化实现 | `.../dsh-session-persistence-jsonl/lib/index.js`，sha256 `8b6ebc4509a3e969ab3ad6e0dfb553ae4861e5b101831afed23e593d148d97f3` |
| 回放规格 | `.workspace/lag-fix/patches/B1-transform.cjs`，sha256 `0f3a66767874841b936aa80c5236962001ed4a89cf43e6b39b222e6505ace1a8` |
| 抽取片段（字节切片） | `annotateRunningSubagentCounts` @host:1243（1008B）、收口截断块 @host:2287-2292（444B）、`SUBAGENT_LIST_MAX` @host:1231、attached keep-set @host:2234、冷候选块 @host:2246-2250（231B）、`fromHeaderLine` @persistence:55、`isHeaderLine` @persistence:70、`sessionListUpdatedAt` @host |

harness：`crosscheck-b1-cold-sort.cjs`、`crosscheck-b1-running-count.cjs`（两者均自证：sha256 pin、锚点唯一、切片字节一致、运行期源码一致）。
输出：`results/b1-cold-sort-crosscheck.json`、`results/b1-running-count-crosscheck.json`。

### 2.1 ① 冷路径排序键 —— **裁决：FAIL（排序键不成立，缺陷成立）**

**实跑复现（executed）**：

1. 用真 `fromHeaderLine`（persistence:55）处理真实形状 header 行 → 产出 meta 键集合 = `[version, id, createdAt, cwd, parentSession, origin, delegationDepth, agentPreset]` → **无 `updatedAt`**。与实测 header 字段集一致：实测集合里的 `type` 是原始首行字段，`isHeaderLine`（persistence:70）只把它当类型守卫、`fromHeaderLine` 不复制它；`seedLength` 仅在存在时才带出。这同时证明 `persistence.list()` 返回的就是会话 header。
2. 从 live 字节中抽出比较器 `(a, b) => b.updatedAt - a.updatedAt`（host:2249 内），对两条真实形状 meta 求值 → **NaN**。
3. **实际退化行为**：`Array.prototype.sort` 的比较器返回 NaN 时按规范当作 `+0` → 排序**等价于不排序（稳定序）** → `.slice(0, SUBAGENT_LIST_MAX)` 的入选集合 = `persistence.list()` 的**枚举顺序**前 200 条。而 `list()` 的枚举顺序来自 `readdir({withFileTypes:true})`，**未排序**（代码推断锚点：persistence `listProjectDirs` :1377-1387、`listSessionDirs` :1389-1396）→ 顺序随文件系统布局变化，与"最近"无关。
4. **反事实（201 条真实形状冷 meta，`createdAt` 递增 1…201）**：

| 枚举顺序 | 丢弃的 id | 按 createdAt 看 |
|---|---|---|
| createdAt 升序 | `cold-201` | **丢弃最新的一条** → 保留的 200 条是**最旧**的，与"最近 200"意图相反 |
| createdAt 逆序 | `cold-001` | 丢弃最旧的一条（偶然符合意图） |
| 固定步长 7 置换 | `cold-195` | 与"最近"无关 |

三种枚举顺序得到**三个不同的入选集合** → 名额分配取决于目录枚举顺序（executed）。

**影响（代码推断 + 实跑退化行为）**：被排除的冷 subagent 在 host:2253-2259 的 filter 里（host:2256 `if (!coldSubagentIds.has(meta.id)) return false;`）**直接剔除**，连冷读/投影都不做 → 这些会话**整行消失**（不是排序错位）。收口阶段（host:2287）虽用真实存在的 summary `updatedAt` 排序，但候选阶段已经丢掉了它们，**无法补救**。`coldSubagentSeen <= SUBAGENT_LIST_MAX`（host:2258）与 `.slice` 对同一集合重复施加同一上限，冗余但无害。

**两种策略下的最小修订与代价**

- **策略 A「状态完整优先」**
  - A1（最省）：排序键换成真实存在、语义最近的字段 —— `.sort((a, b) => b.createdAt - a.createdAt)`（可加 `|| a.id < b.id ? -1 : 1` 做确定性 tiebreak）。代价：内存内 O(n log n)，**零新增 I/O**；缺点：老创建但近期被续跑/继续对话的会话排序偏后，仍可能被排除（"最近"被窄化为"最近创建"）。
  - A2（真·最近，推荐）：给 meta 补一个真实 recency 字段。`list()` 只读 header 首行；最小增量是 `updatedAt = stat.mtimeMs`——同一模块的 `listSnapshots()`（persistence:1041-1056）已经对每个会话做过 `stat(path,{bigint:true})` 并把 `fileRevision(identity)` 作为 `revision` 返回，而 `fileRevision`（persistence:747-753）**已包含 `identity.mtimeNs`** → 实现这条路径的成本是 **O(n) 次 stat、零日志解析**（同一模块已有一条现成的 stat 实现可直接复用，见 `listSnapshots`）。语义：append-only 日志下 mtime = 最后一次写入时间，是 `lastPromptAt` 的高相关代理（压缩重写会刷新 mtime，属可接受偏差，应在注释中写明）。
  - A3（精确但昂贵）：冷读日志尾部取 `sessionListMetadata.lastPromptAt` —— 与被砍掉的冷读同量级，违背 B1 削峰的初衷，**不建议**。
- **策略 B「下发削峰优先」**
  - B1（最小、且修掉"静默 NaN"）：`.sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt) || (a.id < b.id ? -1 : 1))` —— 不新增 I/O，把"NaN → 静默退化为枚举序"变成**确定性、可解释**的 createdAt 排序；代价同 A1（可能漏掉"老创建、新活动"的会话）。
  - B2：接受"最近 = 最近创建"并把该契约写进注释/接口文档；或干脆**删掉排序**（明确声明候选集合为目录枚举序），避免用不存在的字段冒充 recency —— 代价是多一个"为什么这 200 条"的语义空洞，但杜绝了"看起来按时间排、实则随机"的误导。

> 共同结论：**当前实现既不是"最近 200"，也不是"稳定可解释的 200"，而是"枚举序 200"**。若必须按削峰优先零改动 I/O，至少应选择 B1。

### 2.2 ② 顶层 runningSubagentCount —— **裁决：FAIL（漏计成立，缺陷成立）**

**实跑复现（executed）**（真 `annotateRunningSubagentCounts` + 真收口截断块，同一次运行做三组对拍）：

| 场景 | 构造 | 顶层 `p.runningSubagentCount` |
|---|---|---|
| **201 场景（待裁决）** | 顶层 `p` + 200 条非 running subagent（updatedAt 较大）+ **第 201 条 running 且 updatedAt 最小（最旧）** | 收口后 = **0**；**对未截断的同一 items 调同一个真函数 = 1**（真值 1） |
| 对照 | 同上但 running 的那条**最新** | 收口后 = **1**（正确） |
| 两级链 | `p → a(running, 保留) → c201_running(running, 被截断)` | 收口后 = **1**，真值应为 **2** |

- **根因（executed 证明）**：`annotateRunningSubagentCounts` 的 `childrenOf` 由**已截断的行**构建（host:1244-1251），而 live 状态来自**全量** `ctx.sessions.list()`（host:1252-1253）→ **"状态知道它 running，但边被截断掉了"**。因果反事实（未截断=1）排除了"状态查询失败"这一解释。
- **第二条丢弃通道（额外发现，executed）**：attached keep-set（host:2234-2239，关键行 **host:2238**）`for (const session of attachedSubagents.slice(0, SUBAGENT_LIST_MAX)) keep.add(session.id);` **没有 running 豁免**。实跑：3 条 attached subagent + `SUBAGENT_LIST_MAX=2`，其中**最旧的一条正在 running** → keep = `["top","new_a","new_b"]`，它被剔除；`items` 只剩 3 行，真 `annotate` 得 `p.runningSubagentCount = 0`，而该 id 在 `ctx.sessions.list()` 中仍是 running。**该通道无法靠调整 annotate 时机修复**（行从未进入 `items`）。

**两种策略下的最小修订与代价**

- **策略 A「状态完整优先」**
  - A1（最小、语义保持）**只修收口通道**：把 annotate 提到收口之前（host:2287 之前插 `annotateRunningSubagentCounts(ctx, items);`，删掉 :2292 的调用）。代价：`childrenOf` 建在未截断的 items 上（这些行**本就在内存里**，零新增 I/O），被丢弃行上多写的字段无人消费。**实测局限**：attached keep-set 通道仍然漏计（见上表第二通道）。
  - A2（完整，推荐）：**让"边"不再依赖已下发行** —— `childrenOf` 改由 `ctx.sessions.list()` 构建（`session.header.parentSession` → `session.id`），即该函数**已经遍历过一遍**的那个集合（liveStatus 那一趟）。代价：仍是 O(live) 一次遍历、**零新增 I/O**；收益：**同时关闭两条丢弃通道**（running ⟹ live ⟹ 在 `ctx.sessions.list()` 中）。语义边界变化需要在注释/契约里写明：若中间层 subagent 未下发，A2 仍沿 live 血缘统计到 running 后代（"不间断链"在宿主侧字面成立），此时客户端 `indexSubagentDescendants(byId)` 兜底值可能更小 —— 因此消费方必须**优先采用宿主字段**（客户端 dsh-client-ui-workspace:171/:286 已是该优先级，属代码推断）。
  - A3：A1 + attached keep-set running 豁免（等于 A1 + 策略 B 的 keep-set 改动）。
- **策略 B「下发削峰优先」**：保持"先砍行、再算"的现状，改为**不许砍 running 行**。
  - 修改点 1（attached keep-set，host:2238）：先算一次 live running 集合 `runningIds`，配额只对**非 running** 行计数：`if (kept < MAX || runningIds.has(session.id)) keep.add(session.id);`
  - 修改点 2（收口，host:2290）：`const overflow = subagentItems.slice(SUBAGENT_LIST_MAX).filter((drop) => !runningIds.has(drop.sessionId));`
  - 冷候选截断（host:2247-2250）**无需** running 豁免：running ⟹ live ⟹ attached（`liveStatus` 只在 `ctx.sessions.list()` 上判 running，属代码推断），冷候选里不可能有 running 行。
  - 代价：下发上界由"恰好 200 条 subagent"变成"200 + 同时运行的 subagent 数"（有界但随并发波动；实测并发通常为个位数到数十），并多一次 O(live) 状态遍历（可与 annotate 内那趟合并复用同一个 Map）。收益：payload 仍很小，且计数正确性不再依赖"被砍的行恰好不重要"这一巧合。

> 推荐组合：**A2**（宿主侧边来自 live 表，零额外 I/O、同时关闭两条通道）；若产品坚持"侧边栏子代理列表也要能看到 running 行"，再叠加策略 B 的 keep-set 豁免。

### 2.3 第 3 问：live 产物与回放规格的交叉核对

| 检查 | 结果 |
|---|---|
| 回放规格生成的排序语句是否在 live 文件中字节存在 | **PASS**（`    .sort((a, b) => b.updatedAt - a.updatedAt)` 实在于 host:2249；B1 三个标记注释 `/* dsh-lag-fix B1: subagent 会话下发上限 */` @1230、`/* dsh-lag-fix B1: 聚合字段 runningSubagentCount */` @1234、`/* dsh-lag-fix B1/C1 */` @1283 均在） |
| 同源旧构建是否同语义 | **PASS（同语义）**：`lib/types/api-proxy.js` @394 `annotateRunningSubagentCounts`、@1476-1480 冷候选、@1529 调用点与 `lib/index.js` 一致（代码推断，逐行比对相关片段） |
| 修复落点提示 | 两处构建都含该逻辑，修复应改源仓库 TS 后重建两个产物，避免只改一份导致行为分叉（代码推断） |

---

## 3. 裁决总表

| 编号 | 结论 | 状态 | 证据 |
|---|---|---|---|
| A-1 | P2 在 `ids` 不变 + `currentAddress` 清空时残留 address-chain synthetic child 行 | **PASS（缺陷成立，实跑复现）** | `results/p2-stale-row.json` S1 |
| A-2 | 残留行被真实消费方消费（`indexSubagentDescendants(byId)` = `{count:1,runningCount:1}`），且与 `eligible()` 剪枝不一致 | PASS（实跑复现） | 同上 |
| A-3 | 正常情形（地址仍在）不得误删/误陈旧 | PASS（未回归：S2/S3 对照） | 同上 |
| A-4 | 泄漏通道共 **2** 条（无差别回拷 + byId 整体身份复用未校验键集）；只有两条都修才成立 | PASS（P-A/P-B/P-AC/P-D 四候选对拍，P-AC = FULL FIX） | 同上 |
| A-5 | 残留边界：`ids` 一变即自愈，非永久泄漏 | PASS（S5） | 同上 |
| A-6 | 残留行对用户可见的具体渲染路径 | **代码推断**（行枚举走 `ids`，聚合走 `byId`） | `codeInferenceNotes` |
| B①-1 | 冷路径排序键 `updatedAt` 在真实 header 形状上不存在 | **FAIL（键不成立，缺陷成立）** | `results/b1-cold-sort-crosscheck.json` |
| B①-2 | 退化行为 = NaN 比较器 → 稳定排序 → 等价于 `list()` 枚举顺序 | **FAIL（已给实际退化行为，实跑）** | 同上 |
| B①-3 | 入选集合随枚举顺序变化，与"最近"无关 | **FAIL（实跑三序对拍）** | 同上 |
| B②-1 | 201 场景下顶层 `runningSubagentCount` 漏计（0，真值 1） | **FAIL（漏计成立，实跑复现）** | `results/b1-running-count-crosscheck.json` |
| B②-2 | 因果：丢失来自截断而非状态查询（未截断 = 1） | PASS（反事实实跑） | 同上 |
| B②-3 | 存在第二条丢弃通道：attached keep-set 无 running 豁免 | **FAIL（实跑复现）** | 同上 |
| B③ | live 与回放规格/同源旧构建一致 | PASS | §2.3 |

## 4. 局限与未决（INCONCLUSIVE / 未覆盖）

1. **未做真实活体端到端验证**：按约束未触碰真实会话/DB、未重启宿主，A/B 的结论均来自"真函数 + 真数据形状"的离线 harness。真实运行环境下 `currentAddress` 清空的具体用户路径（点击父会话行）、以及冷会话目录枚举顺序的真实分布，**未在活体上采样**（前者有 `client.js:8593/7863-7881` 的代码锚点支持，后者只有 readdir 未排序这一代码事实）。
2. **harness 替身的保真度**：客户端快照 store / SessionManager 是替身（契约锚定 `client.js:5416/5423-5425/8266-8270/7906-7915` 原文），未在真实 zustand store 上跑过；若真实 store 的 `set` 会对投影做深冻结或代理包装，P2 的 `===` 身份判断链路可能表现不同（**INCONCLUSIVE**，但 `devFreeze` 为生产态直通、`getState()` 返回同一引用这两点已由源码佐证）。
3. **B② 的"同时运行 subagent 数"真实分布**：策略 B 的上界收益依赖该分布，未采样真实值（**INCONCLUSIVE**，仅有界性可证）。
4. 未评估修复对既有回归哨兵/测试盘面的影响（不在本任务范围）。

## 5. 复现步骤（全部离线、只读）

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/semantics
node harness-a-p2-stale-row.cjs              # A 线：自证 + 5 场景 + 4 候选补丁对拍（18/18 PASS）
node crosscheck-b1-cold-sort.cjs             # B①：真 fromHeaderLine + 真比较器 + 三枚举序对拍
node crosscheck-b1-running-count.cjs         # B②：真 annotate + 真收口截断 + 两条丢弃通道
```
三个 harness 均对被测文件 sha256 做 pin 校验，文件一旦变化立即 `exit 1`（不做"重算后继续"），保证任何结论都能追溯到确切的产物版本。

