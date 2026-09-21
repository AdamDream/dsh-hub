# B1 执行前审计（只读）—— 精确锚点 / 产品语义决策 / 回放规格同步 / 验收标准 / 回滚点

- 日期：2026-09-21
- 工作区：`/home/CNS2026495165/dsh`，独占目录 `.workspace/lag-fix/exec-audit/b1/`
- 上游输入：语义审计线 `.workspace/lag-fix/research-v2/semantics/audit.md`（B① 排序键不成立、B② running 漏计 + 两条丢弃通道）
- **纪律声明（本轮全程遵守，可复核）**：
  - **只读**：未修改任何产品文件；未重启宿主；未 `pkill`；未联网；未写 `~/.dsh`。所有写入仅落在本审计独占目录。
  - 工具调用**未传** `sandbox_permissions`（本会话审批已禁用，权限不可自内拓宽）。
  - 全文逐条标注 **PASS / FAIL / INCONCLUSIVE**，并区分 **实跑（executed）** 与 **推断（inference）**。
  - 证据级别：**executed** = 真文件字节 / 真函数切片 / 真比较器在真形状数据上实际执行得到的观测；**inference** = 仅由源码行锚点推出、未执行。

---

## 0. 本轮新增的两条关键事实（先给结论，后给证据）

语义审计线证明了两条缺陷成立。本轮执行前审计在**不动产品**的前提下又钉死了两个会直接改变修法选择的事实：

| 编号 | 事实 | 级别 | 影响 |
|---|---|---|---|
| **E1** | `lib/types/api-proxy.js` **是死产物**：`package.json` 的 `main`/`exports["."]` 都指向 `lib/index.js`；`lib/index.js` 无任何相对 import；全仓无任何文件 import 它。**运行时只有 `lib/index.js` 被加载**。 | executed | 决定「两处是否都要改」：**必须都改，但 api-proxy.js 只为一一致性/防误导，不改不影响行为** |
| **E2** | **`B1-transform.cjs` 是当前部署状态的精确回放**：`applyServerFilter(pre_image)` 对两个文件都产出**与 live 逐字节相同**的结果（sha256 相同、0 字节差），`verifyServerFilter` 0 失败。 | executed | 把「回放规格同步」变成可判定命题：修订后必须**恢复**该不变量 |

E2 的实测输出：

```
index.js            replay==live: true | sha 1b9915f505996912… | 字节差 0 | verifyServerFilter failures: 0
types/api-proxy.js  replay==live: true | sha f5c34a439043b9d5… | 字节差 0 | verifyServerFilter failures: 0
```

> 这条不变量同时解释了 2026-09-20 的生产事故为何能溜过去：规格与产物**逐字节一致**，所以「规格对、产物就必然对」——错的是规格本身（`annotateRunningSubagentCounts(items)` 少一个形参），
> 而 `node --check` 只验语法，**查不出未声明标识符**。（实跑复现见 §3.3 M1）

---

## 1. 交付 1 —— 逐处精确锚点清单

### 1.1 目标文件与排版差异（executed）

| 项 | `lib/index.js`（宿主实际加载） | `lib/types/api-proxy.js`（死产物） |
|---|---|---|
| 角色 | `package.json.main` + `exports["."]` → **运行时唯一加载者**（E1，executed） | 无任何 subpath / import 指向它（E1，executed） |
| 字节 / 行 | 216,807 B / 5,651 行 | 175,408 B / 3,428 行 |
| sha256（本轮基线 pin） | `1b9915f505996912c6f49b12b0c3f4a8261a74f26422f68f5d22cab2bc078a62` | `f5c34a439043b9d5771286a76c8b16210951c25d7d5873b168bcc947720eac0d` |
| 排版 | **TAB 缩进**（4,417 行行首为 TAB）、**双引号**（1,818 vs 81）、`void 0`（265 vs `undefined` 7） | **4 空格缩进**（TAB 行首 0 行）、**单引号**（916 vs 102）、`undefined`（251 vs `void 0` 6） |
| 行尾 | LF，无 CRLF | LF，无 CRLF |

**排版混排警告（executed）**：`index.js` 里有 **9 行行首为空格**，全部来自 B1 自身插入的代码（`SUBAGENT_LIST_MAX` 的 2 空格续行 + jsdoc 的 ` *` 行）：

```
1232:  ? Math.max(0, Math.trunc(globalThis.__DSH_SUBAGENT_LIST_MAX))
1233:  : 200;
1236..1242:  * …（jsdoc 行，行首 1 空格）
```

冷路径那 4 行则是「TAB + 2 空格」混合续行（`\t\t\t··.filter(…)`）。**结论：任何手写缩进的锚点都不可信**——本审计的 v1 探针就因此在 `api-proxy.js` 上把 `B2b-keep-slice` 判成 0 命中，v2 改为「由被读文件派生行首空白」后才正确（见 §8 教训清单）。

### 1.2 B① 锚点（冷路径排序键）

| 锚点 | 文件 | 位置 | 当前字节形态（行首空白以 `\t` 显式书写） | 命中数 |
|---|---|---|---|---|
| **A-①** | index.js | L2247-2250 | `\t\t\tconst coldSubagentCandidates = coldSource\n\t\t\t··.filter((meta) => meta.origin === "subagent")\n\t\t\t··.sort((a, b) => b.updatedAt - a.updatedAt)\n\t\t\t··.slice(0, SUBAGENT_LIST_MAX);` | **1** ✅ |
| **A-①** | api-proxy.js | L1476-1479 | `············const coldSubagentCandidates = coldSource\n··············.filter((meta) => meta.origin === 'subagent')\n··············.sort((a, b) => b.updatedAt - a.updatedAt)\n··············.slice(0, SUBAGENT_LIST_MAX);` | **1** ✅ |
| **A-①c** | 两文件 | L2244-2245 / L1473-1474 | `…// 冷会话同源分流：顶层 id 一条不少；subagent 只保留「最近 SUBAGENT_LIST_MAX 条」作为候选，` + 次行 `// 其余在下面的 filter 中直接剔除…` | **1 / 1** ✅ |
| **C-①** | 两文件 | L2287 / L1524 | `items.sort((a, b) => b.updatedAt - a.updatedAt);`（收口，**本轮不改**） | **1 / 1** ✅ |

> ### ⚠️ 锚点撞车（必须先知道的坑，executed）
> **裸比较器 `(a, b) => b.updatedAt - a.updatedAt` 在同一文件内出现 2 次**：
> 冷候选（L2249 / L1478）与收口排序（L2287 / L1524）**字面完全相同**。
> 因此 `B1-transform.cjs` 用单行 `.sort(...)` 作锚点会命中 2 次——**必须用带 `coldSource` 上下文的整条四行语句**（A-①，实测恰好 1 次）。
> 这条同时是**验收断言**的判据：修订后 `b.updatedAt - a.updatedAt` 全文件**恰好剩 1 次**（收口那处）。

**替换后形态（A-①，仅换中间一行）**

```js
// index.js（TAB）
			.sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt) || (a.id < b.id ? -1 : 1))
// types/api-proxy.js（空格）
              .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt) || (a.id < b.id ? -1 : 1))
```

**同时必须改的注释（A-①c）**：现注释声称「最近 SUBAGENT_LIST_MAX 条」，而实际键是枚举序——**代码在说谎**。改为：

```js
			// 冷会话同源分流：顶层 id 一条不少；subagent 只保留「createdAt 最近 SUBAGENT_LIST_MAX 条」作为候选，
			// 冷 header 没有 updatedAt：比较器显式回落 createdAt（并以 id 升序 tiebreak），避免 NaN 让排序退化为目录枚举序；
			// 其余在下面的 filter 中直接剔除，避免为它们做投影与冷读（本次削峰的主路径）。
```

### 1.3 B② 锚点（running 计数）

| 锚点 | 文件 | 位置 | 当前字节形态 | 命中数 |
|---|---|---|---|---|
| **A-②** | index.js | L1244-1253 | 见下方「当前形态」块（TAB：1/2 TAB 缩进） | **1** ✅ |
| **A-②** | api-proxy.js | L395-404 | 同结构（4/8 空格缩进，`'running'` 单引号） | **1** ✅ |
| **A-②doc1** | 两文件 | L1237 / L388 | `…但由宿主在**截断之后**的行上计算，` | **1 / 1** ✅ |
| **A-②doc2** | 两文件 | L1240 / L391 | `…@param items - listVisibleSessionSummaries 产出的行（已排序、已截断）。` | **1 / 1** ✅ |
| **A-②doc3** | 两文件 | L1239 / L390 | `…成本：只遍历本次已产出的行 + live agent 表，无新增投影/读盘。` | **1 / 1** ✅ |
| **A-②call** | 两文件 | L2292 / L1529 | `return annotateRunningSubagentCounts(ctx, retained);`（本轮**不改**） | **1 / 1** ✅ |
| **A-②sig** | 两文件 | L1243 / L394 | `function annotateRunningSubagentCounts(ctx, items) {`（本轮**不改**） | **1 / 1** ✅ |

**A-② 当前形态（index.js，`<T>` = TAB）**

```
1244: <T>const childrenOf = new Map();
1245: <T>for (const item of items) {
1246: <T><T>const parentId = item.parentSessionId;      ← 缺陷源：边由**已截断行**构建
1247: <T><T>if (parentId === void 0) continue;
1248: <T><T>const bucket = childrenOf.get(parentId);
1249: <T><T>if (bucket === void 0) childrenOf.set(parentId, [item.sessionId]);
1250: <T><T>else bucket.push(item.sessionId);
1251: <T>}
1252: <T>const liveStatus = new Map();
1253: <T>for (const session of ctx.sessions.list()) liveStatus.set(session.id, ctx.agents.get(session.id)?.status === "running");
```

**A-② 替换后形态（index.js）**

```
	const liveSessions = ctx.sessions.list();
	const childrenOf = new Map();
	const liveStatus = new Map();
	for (const session of liveSessions) {
		liveStatus.set(session.id, ctx.agents.get(session.id)?.status === "running");
		const parentId = session.header.parentSession;
		if (parentId === void 0) continue;
		const bucket = childrenOf.get(parentId);
		if (bucket === void 0) childrenOf.set(parentId, [session.id]);
		else bucket.push(session.id);
	}
```

（api-proxy.js 同结构、4/8 空格缩进、`'running'` 单引号；`void 0` 沿用 B1 已插入代码的既有写法，见 §3.2 说明。）

**A-②doc 替换后形态**（原文「在截断之后的行上计算」在修订后**不再成立**，必须同步，否则是第二处代码说谎）：

```
 * 语义与客户端 indexSubagentDescendants(byId) 一致：血缘边与 running 状态**同源于 live 会话表**
 * （ctx.sessions.list() 的一趟遍历），因此行是否被截断都不影响计数（消费方 C1）。
 * 边界：中间层 subagent 行未下发时仍沿 live 血缘计入 —— 客户端 byId 兜底值可能更小，消费方必须优先采用本字段。
 * 成本：一次 live 会话表遍历（与 running 状态合并同一趟），无新增投影/读盘。
 * @param items - listVisibleSessionSummaries 产出的行（已排序、已截断）；仅用于**确定标注哪些顶层行**，不再参与建边。
```

### 1.4 两处是否都要改？+ 排版差异的结论

| 问题 | 结论 | 依据 |
|---|---|---|
| `lib/index.js` 要不要改 | **必须改**（唯一运行时加载者） | E1 executed（`package.json` main/exports + 无相对 import + 无任何 import 者） |
| `lib/types/api-proxy.js` 要不要改 | **要改，但性质是「一致性/防误导」**：它不可达，不改不会造成行为分叉；但留着旧逻辑会让后续审计 grep 出矛盾结论（本轮审计本身就被它干扰过一次） | E1 executed |
| 排版差异 | 同一变换必须**按源文件实测风格生成**：index.js 走 TAB + 双引号 + `void 0`；api-proxy.js 走 4 空格 + 单引号（`undef` 沿用 `void 0`）。现成的 `B1-transform.cjs: styleOf()/indenter()/dedent()` 已实现该换算 | executed：`applyServerFilter(pre)` 对两文件均逐字节复现 live |

**锚点唯一性总表（executed）**：本审计锚点探针共 **40 个锚点（20 组 × 2 排版）全部按期望命中，0 失败**（`anchor-probe.cjs`，`results-anchor-probe-v2.json`）。其中 `B1a-comparator-bare` 期望 2（撞车证据）、`MARK-RUNNING-COUNT` 期望 2（定义处 + 返回体），其余期望 1。

---

## 2. 交付 2 —— 产品语义决策

### 2.1 B① 决策：**选策略②B1（`?? createdAt` + id tiebreak），不选策略①A2（补 mtime 型 updatedAt）**

#### 决策依据（全部 executed，逐条可复核）

| 事实 | 实测 | 对 A2 的杀伤 |
|---|---|---|
| `persistence.list()` 返回的就是 `parseHeaderMeta → fromHeaderLine` 的结果，键集 = `[version, id, createdAt, cwd?, parentSession?, seedLength?, origin?, delegationDepth, agentPreset?]` —— **无 `updatedAt`** | 键集由**源码静态派生**（非手抄）；`list()` 体 = `(await this.listArtifacts(signal)).map((a) => a.header)`，无 stat/mtime 字段 | 确认 B① 成立 |
| `listSnapshots()` **确实**有 per-session `stat(path,{bigint:true})` | `await stat(artifact.path, { bigint: true })` → `{ header, revision: fileRevision(identity) }` | ✅ 用户提示的这条事实成立 |
| **但 `revision` 是「不透明令牌」，不是数字时间戳** | 类型 `SessionPersistenceRevision = Branded<'SessionPersistenceRevision'>`（`revision.d.ts` 明写 "Opaque revision identity"，"backend-owned opaque revision representation"）；运行期值 = `[dev,ino,size,mtimeNs,ctimeNs].join(":")` | ❌ 宿主**无法**从 `listSnapshots()` 合法取到数字 mtime |
| 只有 JSONL 一个持久化后端被安装 | `node_modules/@deepseek-ai/` 下仅 `dsh-session-persistence` + `dsh-session-persistence-jsonl` | 「今天能解析」≠ 契约允许 |
| `SessionHeader` **没有**任何 recency 字段 | 类型定义逐字段核对（`version/id/createdAt/cwd/parentSession/seedLength/origin/delegationDepth/agentPreset`） | 给 meta 补 `updatedAt` = **改跨包类型契约** |

#### 结论

**A2（补 mtime 型 updatedAt）不是「host 侧小改」，而是跨包改动**，必须落到 **`dsh-session-persistence-jsonl` 的 `list()`/`listArtifacts()`**（在已有 `exists()`/`stat` 路径上附带 `mtimeMs`）**并触碰 `dsh-session` 的 `SessionHeader` 类型契约**：

- 多出**第二个产品包**与**第三个回滚点**；
- 用户明确要求「B1 修复必须与 dsh-usage ingest 修复分开批次」，A2 会把 B1 批次从「2 个文件」扩到「2+2 个文件 + 跨包类型」，批次边界与回滚隔离度都被破坏；
- A2 的语义收益**只作用于冷历史 subagent 行**（cold ⟹ 非 running ⟹ 只是历史条目），而 B1 批次要治的是「静默 NaN → 名额由目录枚举序分配」这一**真缺陷**；
- A2 还**新增每次 `session.list` 的 O(n) stat**——正是 B1 要削峰的那条路径（虽然 stat 远廉于 `readFirstLine`，但方向相悖，且 `list()` 契约不含该字段）。

**选 B1 策略的代价（必须写进代码注释与接口文档，不得再让注释说谎）**：

1. 「最近」被窄化为「最近创建」：**老创建但近期被续跑的冷 subagent 会被排到后面**，可能被挤出 200 名额。
2. **同 ms 创建的边界 tie**：大量并行 subagent 可能 `createdAt` 相同（且冷会话 `updatedAt = createdAt`）。加 id 升序 tiebreak 后**确定性**成立，但「谁入选」在这类等价元素间是任意的——可解释、非随机。
3. `(a.id < b.id ? -1 : 1)` 在 `a.id === b.id` 时返回 1：**不影响正确性**，因为 `listArtifacts()` 对重复 id 直接抛错（`duplicate JSONL session id "…" appears in multiple project directories`），`list()` 的 id 必然唯一（executed 源码锚点）。

#### B① 修订实测效果（executed，`fix-replay.cjs` §B①）

用**真 `fromHeaderLine` 源码静态派生的键集**造 201 条真实形状冷 meta（`createdAt = 1…201`），用**真比较器**做 `filter→sort→slice(0,200)`：

| 观测 | 修订前 | 修订后 |
|---|---|---|
| 裸比较器返回值 | `b.updatedAt - a.updatedAt` = **NaN** | 有限数 |
| 三种枚举序（升序 / 逆序 / 步长 7 置换）得到的入选集合**种类数** | **3**（各不相同） | **1**（完全相同） |
| 升序枚举下被丢弃者 | **`cold-201`（最新的一条）** | `cold-001`（最旧） |
| 入选集合恒等 | 随枚举序变化 | == 「`createdAt` 降序 + id 升序」前 200，**与枚举序无关** |
| tie 场景（同 `createdAt`） | NaN → 稳定序（= 输入序，等价任意） | id 升序确定性顺序 |

---

### 2.2 B② 决策：**选策略①A2（`childrenOf` 改由 `ctx.sessions.list()` 构建），本批次不叠加 keep-set 豁免**

#### 为什么 A2 是唯一同时关闭两条通道的最小改法

两条丢弃通道的**共同本质**是「行先被砍掉，边随之消失」：

- 通道 1 —— **收口截断**（L2287-2291）：`childrenOf` 由 `items` 构建，而 `items` 已被 `slice(SUBAGENT_LIST_MAX)` 砍过；
- 通道 2 —— **attached keep-set**（L2238）：`attachedSubagents.slice(0, SUBAGENT_LIST_MAX)` **无 running 豁免**，行**从未进入 `items`**（改为「提前调用 annotate」也救不了）。

A2 让**边与状态同源**：`running ⟹ live ⟹ 在 ctx.sessions.list() 中`，因此**两条通道同时关闭**，且：

- **零新增 I/O**：`ctx.sessions.list()` 本来就在该函数里被调用过一次（liveStatus 那趟）；A2 把两件事**合并进同一趟遍历**，总遍历次数不变。
- **不只是修 bug，还消灭了一整类失败模式**：原实现「边来自 `items`、状态来自 live 表」是**两个来源**，二者不一致就会漏计；A2 后两者同源，**「状态知道它 running、边却不知道」在构造上不可能发生**。
- **零新增参数**：事故后签名已是 `(ctx, items)`，无需再改签名（这正是 2026-09-20 事故暴露的那个位置）。

#### 为什么本批次不叠加 keep-set running 豁免

| 维度 | 仅 A2（推荐） | A2 + keep-set 豁免（不推荐本轮做） |
|---|---|---|
| **下发上界** | **不变**：subagent 行 ≤ `SUBAGENT_LIST_MAX`（200） | 变为 **200 + 同时运行的 subagent 数**（有界但随并发波动） |
| session.list payload | 不变（≤ 顶层 + 200） | 在 fan-out 尖峰下可能接近「不截断」，正是 B1 要削的峰 |
| 计数正确性 | **已完全正确**（两条通道都关） | 不额外提升正确性 |
| 需要改的地方 | 1 处（函数体内部） | 另加 2 处（keep-set + 收口 overflow），并需引入 `runningIds` 集合 |
| 失败风险 | 低（纯内部逻辑，无接口变化） | 触碰「下发上界」这一消费者（C1）依赖的契约 |

**「下发的上界」结论一句话**：A2 **不改变**上界（仍是 `SUBAGENT_LIST_MAX` 条 subagent 行）；只有叠加 keep-set 豁免才会把它变成 `SUBAGENT_LIST_MAX + running 数`。
**若产品要求「running 的 subagent 行必须出现在侧边栏列表里」**，那是**另一个独立产品决策**（策略 B），必须显式拍板、显式接受上界变化，**不得搭车塞进本轮**。

#### 语义边界变化（必须写进注释，已进 §1.3 的 A-②doc）

A2 后仍沿 **live 血缘**统计：若中间层 subagent 未下发（被截断），其下 running 后代**仍计入**顶层行；而客户端 `indexSubagentDescendants(byId)` 的兜底值可能更小。
→ **消费方必须优先采用宿主字段**。这一点已实测成立（executed，live 客户端产物）：

```
~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js
  :171  runningSubagentCount: typeof s.runningSubagentCount === "number" ? s.runningSubagentCount : (descendants.get(s.id)?.runningCount ?? 0)   /* dsh-lag-fix B1/C1 */
  :286  同上（另一处投影）
  :561  const subagents = node.runningSubagentCount === 0 ? void 0 : { … t(node.runningSubagentCount === 1 ? "status.subagentsRunning.one" : …) }
```

→ **状态点渲染直接吃宿主字段**；因此 **A2 单独就能修掉用户可见症状**（即使 running 行被截断也不影响角标）。**无需重建客户端产物**——本轮 B1 修复的产物面仍是 2 个宿主文件。

#### B② 修订实测（executed，`fix-replay.cjs` §B②，真函数字节切片对拍）

| 场景 | 修订前 | 修订后 | 判据 |
|---|---|---|---|
| **反事实：201 条 subagent、第 201 条 running、该行被截断** | **0** | **1** | 未截断时两版都 = 1（真值 1，排除「状态查询失败」解释）→ **PASS** |
| 两级链 `p → a(running) → c-201(running)`，`c-201` 被截断 | 1 | **2** | 真值 2 → **PASS** |
| 零回归：无截断常规场景（p1=2, p2=1，subagent 行不写字段） | `p1:2,p2:1,a:-,b:-,c:-,d:-` | **完全相同** | **PASS** |
| 冷行（不在 live 表）不得被计数 | 0 | **0** | 不得凭空计数 → **PASS** |
| 血缘环 `a↔b` | —— | 终止，`p = 0`（无入边） | seen 守卫有效 → **PASS** |

---

## 3. 交付 3 —— 回放规格同步

### 3.1 结论：**更新 `B1-transform.cjs` 并从 pre-image 重放**，不采用「在 live 上打增量补丁」

因为 §0-E2 已证明 `applyServerFilter(pre_image)` 与部署状态**逐字节相同**，所以正确姿势是：

> **更新生成器模板 → 对 pre-image 重放 → 产物必须等于记录在案的「修订后」sha256。**

好处：单一写入者、不新增锚点逻辑、回滚点不变（仍是同一个 pre-image）、并且**恢复**「规格 == 产物」不变量。
不采用增量补丁的理由：增量补丁会让「规格」与「产物」重新分叉（规格描述的是 pre→final，而补丁描述的是 live→final），下一次审计又会踩同一个坑。

为此本审计**已写出并预先验证**候选规格：`B1-transform.v2-candidate.cjs`（由 `mk-v2.cjs` 从现行 `patches/B1-transform.cjs` 生成，**未改动 `patches/` 下任何文件**）。

### 3.2 `B1-transform.cjs` 需要的对应改动（逐处）

| # | 位置 | 现状 | 改为 | 验证 |
|---|---|---|---|---|
| T1 | `snippets()` → `aggBody` 数组（`function annotateRunningSubagentCounts(ctx, items) {` 之后的 11 行） | `const childrenOf` 由 `items` 建边 + `const liveStatus` 单独一趟 | `${u}const liveSessions = ctx.sessions.list();` / `childrenOf` / `liveStatus` 三声明 + **单趟** `for (const session of liveSessions)` 内同时填 `liveStatus` 与按 `session.header.parentSession` 建边（`childrenOf.set(parentId, [session.id])`） | 重放产物 == 期望 sha ✅ |
| T2 | `snippets()` → `aggBody` 的 jsdoc 行（3 行） | 「由宿主在**截断之后**的行上计算」/「不再依赖被截断的 subagent 行」/「成本：只遍历本次已产出的行」 | 同 §1.3 A-②doc 新文本（含**语义边界**与**消费方优先级**两句） | ✅ |
| T3 | `snippets()` → `coldStmtLines()` 的 2 行注释 | 「最近 `SUBAGENT_LIST_MAX` 条」 | 3 行新注释（实际键 = `createdAt` 降序 + id tiebreak，并说明为何必须显式回落） | ✅ |
| T4 | `snippets()` → `coldStmtLines()` 的比较器行 | `.sort((a, b) => b.updatedAt - a.updatedAt)` | `.sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt) \|\| (a.id < b.id ? -1 : 1))` | ✅ |
| T5 | `applyServerFilter()` 锚点区 | 已有 `signatureOld` / `returnTail` / `itemsOld` / `coldAwaitLine` / `coreRe` / 冷 filter 正则 / `coldBlockEnd` 前置校验 | **无需新增锚点**（T1/T3/T4 都是被生成文本的一部分，不是替换目标）；但**必须补**对 `coldSubagentIds` 声明顺序与 TDZ 的现有前置校验（已在 v1 中处理，无回归） | ✅ |
| T6 | 落盘风格 | `undefOf()` 取「`void 0` 与 `undefined` 谁多」 | **保持不变**：B1 生成代码一律用 `void 0`（与既有插入块一致）。api-proxy.js 是「源码排版 + `void 0`」的既有混排，本轮**不**顺手改风格（避免把语义修订与格式化混成一批，破坏回滚可读性） | ✅ |
| T7 | 幂等守卫 | 命中 `MARK_*` 即拒绝二次套用 | 保持不变（重放目标始终是 pre-image，不会命中） | ✅ |

**T1-T4 的权威期望值（executed）**：

```
v2 规格重放 [index.js]            sha256 96ad39b7c37e1e0ab7ef07d991ee86f103c649b0ff595317ca32b6990a2c3310   217,279 B
v2 规格重放 [types/api-proxy.js]  sha256 f4752c39623f863f9e5c9e455d1226d933bc1950e7b8c12b92cce87658165734   175,895 B
```

（相对 live：index.js +472 B；api-proxy.js +487 B。相对 pre-image：index.js +4,272 B；api-proxy.js +4,624 B。）

### 3.3 `verifyServerFilter` 要新增的防复发断言（含**反向对照自证**）

| # | 新断言 | 捕获什么 | 自证（reverse control） |
|---|---|---|---|
| V1 | `const liveSessions = ctx.sessions.list();` == 1 | 血缘边未改为 live 同源（或改了两处） | — |
| V2 | `const parentId = session.header.parentSession;` == 1 **且** `const parentId = item.parentSessionId;` == **0** | **B② 缺陷原形回归** | **M4** ✅ 被拒（2 项失败） |
| V3 | `(b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt)` == 1 且 `(a.id < b.id ? -1 : 1)` == 1 | **B① 修复被抹掉** | **M3** ✅ 被拒（3 项失败） |
| V4 | `b.updatedAt - a.updatedAt` == **恰好 1**（只允许收口那处） | 冷候选退回裸比较器 / 误改收口排序 | **M3** ✅（期望 1 实得 2） |
| V5 | **「引入标识符必须在本文件内有声明」**：切出聚合函数体 → 扫自由标识符根（跳过 `.` 后的属性名、关键字、字面量、本块声明）→ 必须 ⊆ (形参 ∪ 本块声明 ∪ 内建全局白名单) | **`ctx is not defined` 这一类未声明标识符**（`node --check` 查不出） | **M1** ✅ 被拒（9 项失败，含 `ctx`）；**M2** ✅（形参改名也拒） |
| V6 | 聚合函数**首形参必须是 `ctx`** | 事故直接判据 | **M2** ✅ |
| V7 | **调用点实参数 == 形参数**，且首实参为 `ctx` | 「函数体用 ctx、调用点没传」（事故的另一半） | **M5** ✅（3 项失败） |

**自证结果（executed）**：`verify-v2-selfcheck.cjs` → 正向 2/2、反向 M1…M5 全被拒、控制项 W1（中性注释编辑不误报）通过、对照项 C1（**现行已部署 v1 状态被判 6 项失败**，证明 verifier 对本轮修订确有区分力）。
**9/9 PASS，`exit 0`。**

> ### 🔴 必须同步的附带产物（executed，否则重启后必然误报）
> `probes/verify-b1-ctx-binding.mjs` 的夹具 `fakeCtx` 目前是
> `sessions: { list: () => rows.map((r) => ({ id: r.sessionId })) }` —— **没有 `header`**。
> A2 后函数体读 `session.header.parentSession` ⇒ **TypeError: Cannot read properties of undefined (reading 'parentSession')** ⇒ 该哨兵相 A 判 FAIL。
> **实测**：现行夹具对 v2 产物 → `[verdict] FAIL`；把夹具改成携带 `header`（含 `parentSession`）后 → **PASS**，且 **相 B 反向对照（旧签名必须抛 ReferenceError）仍然有效**（未削弱证伪能力）。
> 拟改夹具已落盘为 `verify-b1-ctx-binding.A2-proposed.mjs`（单行改动，见该文件 L64），并已双向验证：**对 v2 产物 PASS / 对现行部署也 PASS**（向前兼容）。
> **执行单元必须在同一批内更新该哨兵夹具**，否则「重启后复测」会出现假失败。

---

## 4. 交付 4 —— 验收标准

### 4.1 重启前（离线，本轮已全部跑通，executed）

| 命令 | 期望 | 本轮实测 |
|---|---|---|
| `node exec-audit/b1/anchor-probe.cjs` | 40 锚点全部按期望命中 | **0 失败** ✅ |
| `node exec-audit/b1/fix-replay.cjs` | 40 项校验（含 201 反事实、零回归、v2 规格 sha 自证） | **0 失败，verdict PASS** ✅ |
| `node exec-audit/b1/fix-replay.cjs --post --dir ./dryrun-tree` | 42 项（`--post` 验收口径） | **0 失败，verdict PASS** ✅ |
| `node exec-audit/b1/verify-v2-selfcheck.cjs` | 9 项（含 5 个反向对照 + 1 控制 + 1 对照） | **9/9 PASS** ✅ |

### 4.2 重启后（活体）—— 命令与断言

```bash
# 0) 生效性：产物 sha 必须等于规格重放期望值，且规格必须能复现它
sha256sum ~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js
#   期望 96ad39b7c37e1e0ab7ef07d991ee86f103c649b0ff595317ca32b6990a2c3310
sha256sum ~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/types/api-proxy.js
#   期望 f4752c39623f863f9e5c9e455d1226d933bc1950e7b8c12b92cce87658165734
bash .workspace/lag-fix/probes/verify-post-restart.sh        # 内嵌 session-list-shape + 哨兵
node .workspace/lag-fix/probes/verify-b1-ctx-binding.mjs     # 夹具更新后必须 PASS（相A + 相B）
node .workspace/lag-fix/exec-audit/b1/fix-replay.cjs --post  # --post：对**已部署**文件跑 42 项验收
```

| # | 验收项 | 断言 | 依据/失败含义 |
|---|---|---|---|
| **A0** | `session.list` 仍 200 | `HTTP 200` 且 `result.ok !== false` | 若 500 且 message 含 `ctx is not defined` → **事故复发**（V5/V6/V7 未生效） |
| **A1** | 无 500 / 无 handler failure 日志 | 宿主日志无 `ReferenceError` | executed 口径沿用 2026-09-20 事故判据 |
| **A2** | **顶层行齐全** | 与基线 `.workspace/settings-lag/session_list.json` 的 **84 个顶层 id 逐个相等**（一个不缺）；多出者 `updatedAt > 基线最新顶层 updatedAt` | 已有 `session-list-shape.mjs` A3a/A3b 覆盖；**基线是 B1 之前的全量捕获（2361 行 = 84 顶层 + 2277 subagent），是天然的 unfiltered oracle** |
| **A3** | 条目/字节上界 | `items ≤ 顶层数 + 200`；信封 ≤ 500 KB | 已有 A1/A2 覆盖；**A2 修订不改变该上界**（见 §2.2） |
| **A4** | **`runningSubagentCount` 覆盖** | 所有顶层行都有 `typeof === "number"`；且 `Σ runningSubagentCount ≥` 任一其它面（客户端 catalog / byId 兜底）给出的 running 数 | 已有 A6 覆盖字段存在性；**新增**「≥」这一条，因为 A2 后宿主值应当**不小于**客户端兜底值（§2.2 语义边界） |
| **A5** | **反事实：201 个 subagent 且第 201 个 running 必须通过** | 见 §4.3 | **本轮已离线实跑通过**（0 → 1） |
| **A6** | **冷路径入选集合变为可解释顺序** | 见 §4.4 | 需 `--explain-cold` 独立 oracle |
| **A7** | 零回归 | `session-list-shape.mjs` 全项 PASS；subagent 行 ≤ 200；行字段并集不减少 | 已有 |

### 4.3 A5 反事实的定义与实现形态（**必须通过**）

> **反事实**：`p` 有 **201** 个 subagent，其中**第 201 条（`updatedAt`/`createdAt` 最小、最旧）正在 running**，且该行因 `SUBAGENT_LIST_MAX=200` 被截断。
> **判据**：`p.runningSubagentCount === 1`。**真值 1** 由「未截断的同一 items 调同一函数 = 1」独立确立。

**实现形态（两种，都要有）**：

1. **离线可复现（权威、已通过）** —— `fix-replay.cjs` §B② 夹具 A：真函数字节切片 + 真 ctx 夹具，**不重启、不建真实会话**。
   重启后以 `--post` 重跑，即可在**已部署产物**上复验同一条反事实（42 项含此项）。
2. **活体（可选，不建议常态化）** —— 真起 201 个 subagent 会写入真实会话并压垮 GUI，**不建议**。
   若必须活体验证，退而求其次的可判定替代：
   - 观察窗口内，`Σ runningSubagentCount` **不得小于**「窗口内任一时刻 `ctx.agents` 中 status=running 的 subagent 数」——通过并行 fan-out 触发 `>200` 同时存在的时刻；
   - 或临时以 `globalThis.__DSH_SUBAGENT_LIST_MAX`（**代码已支持的覆盖点**，`SUBAGENT_LIST_MAX` 读取该全局，executed）把上限压到 **2**，用 3 个子代理复现同一几何：这是**成本最低的活体反事实**，且不需要 201 个会话。
     代价：需再重启一次让全局生效 → 应作为**独立的可选步骤**，不与主验收捆绑。

### 4.4 A6「冷路径入选集合 = 可解释顺序」的断言脚本形状

现状（修订前）的入选集合**无法被任何「最近」语义解释**：它是 `readdir` 目录枚举序的前 200（三序对拍得到三个不同集合，executed）。
修订后应当**等于**「`updatedAt ?? createdAt` 降序、id 升序」的前 200。要判定该等式，必须拿到**未下发行**的 `createdAt` ⇒ 需要一个独立 oracle。

**Oracle（只读、廉价，executed 事实支撑）**：

- 会话根：`~/.dsh/sessions/<projectKey>/<encodedSessionId>/session.jsonl[.zstd]`（executed：目录布局 + `projectKey` 编码见 persistence `projectDir`/`encodeSegment`）；
- 读一条 = **最多一个 8 KB chunk**，且只解压**第一个 zstd 帧**（该帧按设计恰好只含 header 行）：`readFirstZstdLine()` → `scanZstdFrames(content,1)` + `decompressZstdFrame(first)` + `assertZstdHeaderFrame()`（**均已在 live 源码中逐行核对**）；
- 只需 `id` / `createdAt` / `origin` / `parentSession` 四个字段，**不解析任何对话内容**。

**断言形状（伪代码）**：

```js
// probes/verify-b1-fix2-cold-order.mjs --explain-cold
const resp = await post('/api/session.list');            // 1 次只读请求
const rows = resp.result.value.items;
const attachedTop = rows.filter(r => r.origin !== 'subagent');
const retained    = new Set(rows.filter(r => r.origin === 'subagent').map(r => r.sessionId));

// 1) 顶层一条不少
assert(attachedTop.length >= baselineTopIds.length
    && [...baselineTopIds].every(id => attachedTop.some(r => r.sessionId === id)));

// 2) oracle：枚举全部会话的 header（只读首帧）
const all = await scanHeaders('~/.dsh/sessions');        // [{id, createdAt, origin}]
const coldSubs = all.filter(h => h.origin === 'subagent' && !attachedIds.has(h.id));

// 3) 期望集合 = 冷候选与「内存中 attached subagent 行」合并后，按键降序取前 MAX
const key = (h) => [h.updatedAt ?? h.createdAt, h.id];
const expected = [...coldSubs, ...attachedSubRows]
  .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt)
                || (a.id < b.id ? -1 : 1))
  .slice(0, 200).map(r => r.id);

// 4) 可解释性：入选集合必须**恰好**等于期望集合
assert(setEq(retained, new Set(expected)),
       `retained=${retained.size} expected=${expected.length}`);

// 5) 边界单调性（弱化兜底断言，不依赖响应内顺序）：
//    入选集合里**最旧**的 createdAt 不得小于**落选者**里最新的 createdAt
//    （同 ms 边界 tie 时允许相等；用 id 升序消歧后再判）
const retainedOldest = Math.min(...[...retained].map(id => lookup(id).createdAt));
const droppedNewest  = Math.max(...dropped.map(h => h.createdAt));
assert(retainedOldest >= droppedNewest);

// 6) 确定性：连续 2 次调用入选集合完全相同（修订前该断言恒真，不能单独作为判据！）
assert(setEq(retained, await secondCallRetained()));
```

> **注意判据强度排序**：`(6)` 确定性**在修订前也恒真**（同进程内 readdir 顺序稳定），**不能单独作判据**；只有 `(4)` 集合等式才是**真判据**。若 oracle 不可用（例如不允许读 `~/.dsh/sessions`），则 A6 降级为 **INCONCLUSIVE**，**不得**用 `(6)` 冒充通过。

### 4.5 验收标准与本轮实跑的对应表

| 验收项 | 本轮（重启前）状态 | 重启后所需动作 |
|---|---|---|
| A5 反事实 | **PASS（离线实跑，0→1）** | `fix-replay.cjs --post` 复验 |
| A6 冷路径可解释 | **PASS（离线实跑：3 种入选 → 1 种；丢弃项由 `cold-201` 变 `cold-001`）** | `--explain-cold` 活体集合等式（oracle 可用则 PASS，否则 INCONCLUSIVE） |
| A0/A1/A2/A3/A4/A7 | 未测（需重启） | `verify-post-restart.sh` + `session-list-shape.mjs` |

---

## 5. 交付 5 —— 回滚点

### 5.1 pre-image（B1 的唯一权威回滚点，executed）

| 文件 | pre-image 路径 | sha256 | 字节 | mtime |
|---|---|---|---|---|
| `lib/index.js` | `.workspace/lag-fix/backup/B1/server/20260920-154039/lib/index.js` | `142aac84e462173aeb6acc3e36d97b5c6aae2a31a087b91f99cffeff48378374` | 213,007 | 2026-09-20 15:40:40 |
| `lib/types/api-proxy.js` | `.workspace/lag-fix/backup/B1/server/20260920-154039/lib/types/api-proxy.js` | `7f56fb805fe4d8afbdbd9dee0c3e641acaf2d9c9831de0b7ea018e92b9343036` | 171,271 | 2026-09-20 15:40:40 |

**为什么「整文件还原」= 精确回滚 B1，不会连带 C1/runtime（executed）**：

1. `pre-image` 内**不含任何补丁标记**（`grep -c 'dsh-lag-fix\|dsh-perf-fix\|dsh-usage\|P2 v1'` = **0**）；
2. `live` 内的补丁标记**只有 B1 一种**（`new Set(...)` = `["dsh-lag-fix B1"]`）；
3. `diff(pre, live)` 只有 **4 个 hunk**，全部属于 B1；
4. C1 的标记 `/* dsh-lag-fix B1/C1 */` 位于**客户端**产物 `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js`（L171/L286），**不在**这两个宿主文件里。

> 另注：`backup/B1/server/b1fix-20260920-183319/index.buggy.js`（`f568f8a9…`）**不是** pre-image，它是「B1 已打但 `ctx` 缺参」的中间故障态；`backup/B1/server/20260920-154039/*.patched.js` 与它同 hash。**回滚只认 `20260920-154039/lib/**`**。

### 5.2 回滚命令（只回 B1；执行时须先备当前态）

```bash
set -euo pipefail
cd /home/CNS2026495165/dsh
L="$HOME/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-apiproxy/lib"
B="$PWD/.workspace/lag-fix/backup/B1/server/20260920-154039/lib"
STAMP="$(date +%Y%m%d-%H%M%S)"

# 0) 先给“当前态”留命副本（回滚本身也可再回滚）
cp -p "$L/index.js"            "$L/index.js.keep-$STAMP"
cp -p "$L/types/api-proxy.js"  "$L/types/api-proxy.js.keep-$STAMP"

# 1) 只还原 B1 这两个文件（-p 保留 664 / LF）
cp -p "$B/index.js"            "$L/index.js"
cp -p "$B/types/api-proxy.js"  "$L/types/api-proxy.js"

# 2) 断言回滚到位
sha256sum "$L/index.js" "$L/types/api-proxy.js"
#   期望 142aac84e462173aeb6acc3e36d97b5c6aae2a31a087b91f99cffeff48378374
#        7f56fb805fe4d8afbdbd9dee0c3e641acaf2d9c9831de0b7ea018e92b9343036
test "$(grep -c 'dsh-lag-fix' "$L/index.js" || true)" = "0"          # 标记应为 0
test "$(grep -c 'runningSubagentCount' "$L/index.js" || true)" = "0" # 字段应消失

# 3) 重启宿主（服务器侧改动双向都需要重启；不重启则回滚不生效）
#    重启后冒烟：
#      curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:3080/api/session.list \
#        -H 'content-type: application/json' \
#        -d '{"type":"client-request","rpcId":"rollback-probe","method":"session.list","payload":{}}'
#    期望 200；且 result.value.items ≈ 2,361 行（未过滤全量）、信封 ≈ 3.9 MB、顶层行不再带 runningSubagentCount
```

**回滚的语义后果（应当被知晓，不是故障）**：`session.list` 回到**未过滤全量**（2361 行 / ~3.9 MB）→ 原来的列表卡顿回归；`runningSubagentCount` 消失 → 客户端**自动落到 byId 兜底**（`client.js:171/286` 的 `typeof … === "number"` 三元），状态点仍可用但会受 byId 截断影响（即 B② 缺陷回归）。

**批次纪律（用户裁决，照录）**：

- B1 修复**必须与 `dsh-usage` 的 ingest 修复分开批次**（两者文件集不重叠：B1 = 上述 2 个宿主文件 + 1 个规格 + 1 个哨兵夹具）；
- **B1 服务器侧改动需要重启**才生效；本批次的重启应当是**本批次内的最后一次动作**，且不得与 usage/ingest 批次的重启合并计数（否则「重启后复测」无法归因）。

---

## 6. 裁决总表（逐条 PASS / FAIL / INCONCLUSIVE）

| 编号 | 事项 | 结论 | 级别 |
|---|---|---|---|
| O-1 | `types/api-proxy.js` 是死产物（无 exports 可达、无 import 者） | **PASS** | executed |
| O-2 | `applyServerFilter(pre_image)` 逐字节复现两个 live 文件（规格 == 产物） | **PASS** | executed |
| A-1 | 40 个锚点（20 组 × 2 排版）全部按期望命中、每个替换锚点恰好 1 次 | **PASS** | executed |
| A-2 | 裸比较器在同文件内撞车 2 次 ⇒ 必须用带 `coldSource` 上下文的四行语句作锚点 | **PASS** | executed |
| A-3 | index.js TAB+双引号+`void 0` / api-proxy.js 4 空格+单引号，同一变换可对两排版正确落地 | **PASS** | executed |
| A-4 | index.js 存在 B1 自身造成的 9 行「空格起首」混排（锚点不可手写缩进） | **PASS** | executed |
| D-1 | B① 决策 = 策略②B1（`?? createdAt` + id tiebreak） | **PASS（推荐）** | executed 支撑 |
| D-2 | A2（mtime 型 `updatedAt`）在 host 侧**不可行**：`listSnapshots()` 的 mtime 被封装为**不透明** `revision`；补齐需改 `dsh-session-persistence-jsonl` + `SessionHeader` 契约 | **PASS（否决 A2 为本批次方案）** | executed(inference 部分标注) |
| D-3 | B① 修订后入选集合与枚举序无关（3 种 → 1 种），丢弃项由「最新」改为「最旧」 | **PASS** | executed |
| D-4 | B② 决策 = 策略①A2（`childrenOf` 由 `ctx.sessions.list()` 构建），**不叠加** keep-set 豁免 | **PASS（推荐）** | executed 支撑 |
| D-5 | A2 对**下发上界零影响**（仍 ≤ `SUBAGENT_LIST_MAX` 条 subagent 行）；仅叠加 keep-set 豁免才变成 `200 + running 数` | **PASS** | executed（代码路径）+ inference（并发分布） |
| D-6 | 消费方优先采用宿主字段（`client.js:171/286/561`）⇒ A2 单独即可修用户可见症状、**无需重建客户端** | **PASS** | executed(grep live 产物) |
| R-1 | v2 规格重放产物 sha 与记录期望值一致、`verifyServerFilter` 0 失败 | **PASS** | executed |
| R-2 | 新增防复发断言非空转：M1（缺 `ctx` 形参）/M2（形参改名）/M3（裸比较器回归）/M4（边退回 items）/M5（调用点少传参）**全部被拒** | **PASS** | executed |
| R-3 | 控制项：中性注释编辑不误报；对照项：现行 v1 状态被判 6 项失败 | **PASS** | executed |
| R-4 | 哨兵 `probes/verify-b1-ctx-binding.mjs` 夹具**必须同步**，否则重启后假 FAIL；拟改版已双向验证 PASS | **PASS（已发现并给出修法）** | executed |
| V-1 | 201 反事实（第 201 条 running 且被截断）：修订前 0 → 修订后 **1** | **PASS** | executed |
| V-2 | 两级链反事实：修订前 1 → 修订后 **2** | **PASS** | executed |
| V-3 | 零回归：无截断场景逐行计数修订前后完全一致；冷行不计；血缘环终止 | **PASS** | executed |
| V-4 | 重启后 `session.list` 200 + 顶层行齐全 + 字段覆盖 | **未测（INCONCLUSIVE，需重启；本审计不得重启）** | — |
| V-5 | 冷路径入选集合「活体集合等式」（需 `--explain-cold` oracle 读 `~/.dsh/sessions` 首帧） | **INCONCLUSIVE**（脚本形状已给；本轮按纪律未读真实会话日志） | — |
| V-6 | 真实并发分布（同时 running subagent 数）——仅影响「若选 keep-set 豁免」的上界估算，本方案不依赖它 | **INCONCLUSIVE** | — |
| V-7 | 活体 201-subagent 反事实 | **INCONCLUSIVE（不建议：需真建 201 会话）**；替代路径已给（`__DSH_SUBAGENT_LIST_MAX=2` 的 3 子代理几何） | — |

---

## 7. 给执行单元的最小交付单元（细粒度、可逐条实现）

> 本审计已把每单元的**锚点、目标字节、期望 sha、验收命令**全部前置验证；执行档只按单元落地，不自行决策。
> **单一写入者**：2 个宿主文件 + 2 个规格/哨兵文件，均由同一执行档串行写入。

| 单元 | 文件 | 动作 | 验收 |
|---|---|---|---|
| **B1-1** | `patches/B1-transform.cjs` | 按 §3.2 **T1-T4** 更新 4 处模板（aggBody 建边 + jsdoc、coldStmtLines 注释 + 比较器）；**T6 风格保持 `void 0`** | `node --check`；`mk-v2.cjs` 生成的候选 == 手改结果 |
| **B1-2** | 同上 | 按 §3.3 **V1-V7** 替换 `verifyServerFilter` | `verify-v2-selfcheck.cjs` 9/9 PASS（含 5 反向对照） |
| **B1-3** | `backup/B1/…`（新 stamp） | 备份**当前** `lib/index.js` / `lib/types/api-proxy.js`（即 `1b9915f5…` / `f5c34a43…`）+ 写 MANIFEST（pre/post sha 成对记录） | MANIFEST 内 sha 与实测一致 |
| **B1-4** | 两个 live 宿主文件 | 用更新后的规格**对 pre-image（`142aac84…`/`7f56fb80…`）重放**并写回 | `sha256sum` == `96ad39b7…` / `f4752c39…`；`node --check` 通过 |
| **B1-5** | `probes/verify-b1-ctx-binding.mjs` | 按 `verify-b1-ctx-binding.A2-proposed.mjs` L64 更新夹具（补 `header.parentSession`），**不得削弱相 B** | 哨兵对**新产物** PASS，且相 B 仍抛 ReferenceError |
| **B1-6** | — | **重启一次**（本批次最后一次动作，不与 usage/ingest 批次合并） | 见 B1-7 |
| **B1-7** | — | 重启后验收：`verify-post-restart.sh` + `session-list-shape.mjs` + `verify-b1-ctx-binding.mjs` + `fix-replay.cjs --post` | A0-A7（§4.2）逐项；A5 反事实必须 PASS |
| **B1-8** | 交付物 | 更新 `research-v2/MEASUREMENT-STATUS.md` 的 B1 行，记录最终 sha、验收结论、A6 的真实判定（PASS 或 INCONCLUSIVE） | 文档与实测一致 |

**执行档需上报而非自行拍板的两点**：
1. `types/api-proxy.js` 是否**本轮一并改写**（本审计建议：改，理由见 §1.4；但它不可达，若批次纪律要求「最小触碰」也可只改 `index.js` 并在此文件留注记）；
2. A6 活体集合等式是否允许读 `~/.dsh/sessions` 的**首帧 header**（只读、不解对话内容）。**不允许则该验收项记 INCONCLUSIVE，不得用「确定性」冒充通过。**

---

## 8. 本审计自身踩到的坑（供后续 harness 复用，executed）

| # | 坑 | 现象 | 修法 |
|---|---|---|---|
| 1 | **手写缩进假设必错** | `/^\t/gm` 只吞行首**第一个** TAB，`\t\t` → `    \t`；导致 api-proxy 锚点 0 命中（探针 v1 的 3 项 BAD） | 锚点**由被读文件派生**（探针 v2 只给内容特征串，行首空白由文件给出）；换算用 `/^\t+/gm` + `(m) => '    '.repeat(m.length)` |
| 2 | **锚点撞车** | 裸比较器在同文件出现 2 次 | 锚点必须带足区分上下文（`coldSource` 四行语句） |
| 3 | **数括号被字符串里的 `{` 骗** | 生成器用行首逐行计 `{`/`}` 定位函数体，被 `'…(ctx, items) {'` 这类字符串字面量干扰 → 永远回不到深度 0 | 计数前先清空字符串字面量 |
| 4 | **模板字面量转义** | 生成器里写 `\\${u}` 使产物出现字面 `${u}`（插值未发生） | 生成器用普通字符串写 `${u}`（无插值语义），只用单次反斜杠处理 `\n` |
| 5 | **`node --check` 只能验语法** | `ctx is not defined` 属未声明标识符，语法完全合法 | 必须加「引入标识符本文件内存在声明」这类语义校验（§3.3 V5，已用 M1/M2 自证非空转） |
| 6 | **测试替身会替被测代码补上缺失绑定** | 历史事故：harness 用 `new Function('ctx', fnSrc)` 把 ctx 注入成包装形参 ⇒ 缺陷在测试里不可能显形 | 夹具必须走**真实签名**，并保留「反向对照必须失败」这一自证（哨兵相 B） |

---

## 9. 复现（全部离线、只读；产物只落本目录）

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-audit/b1

node anchor-probe.cjs                                   # 40 锚点命中计数 + 精确字节形态（pin 校验，不符 exit 1）
node fix-replay.cjs                                     # 40 项：修订可行性 + B①/B② 对拍 + v2 规格 sha 自证
node fix-replay.cjs --post --dir ./dryrun-tree          # 42 项：--post 验收口径（对已部署/干跑产物）
node verify-v2-selfcheck.cjs                            #  9 项：新增防复发断言的反向对照自证
node mk-v2.cjs                                          # 由 patches/B1-transform.cjs 生成本轮候选规格
node ../probes/verify-b1-ctx-binding.mjs --file ./dryrun-tree/index.js          # 现行夹具 → 预期 FAIL（须更新）
node verify-b1-ctx-binding.A2-proposed.mjs --file ./dryrun-tree/index.js        # 拟改夹具 → 预期 PASS
```

产物：`audit.md`（本文件）、`anchor-probe.cjs`、`fix-replay.cjs`、`mk-v2.cjs`、`B1-transform.v2-candidate.cjs`、
`verify-v2-selfcheck.cjs`、`verify-b1-ctx-binding.A2-proposed.mjs`、`dryrun-tree/`（v2 规格重放的干跑产物）、
`results-anchor-probe-v2.json`、`results-fix-replay-PRE.json`、`results-fix-replay-POST-dryrun.json`。
