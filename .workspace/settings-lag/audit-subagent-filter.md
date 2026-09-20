# 服务端 `session.list` 过滤 subagent 会话是否会破坏界面功能

**调研对象**：DSH Web GUI（http://127.0.0.1:3080，宿主 PID 20806，`node .../dsh web`，全程未触碰）
**性质**：只读调研。未修改任何文件、未重启宿主、未做压测、未发 HTTP 探针。
**载体**：`~/.dsh/profiles/node_modules/@deepseek-ai/*`（部署实跑包）+ 已捕获的真实 payload `session_list.json`（3,886,050 B）
**日期**：2026-09-20

---

## 0. 一句话结论

> **不安全（无条件过滤会破坏 4 处界面功能）。**
> **有条件安全**：只需补一个**服务端聚合字段**（顶层会话的 running-subagent 计数），"完全过滤 subagent"即可成立；
> 或者退一步用"**顶层会话全发 + 最近 N 条 subagent**"。
> 仅靠 `session.list` 过滤，会同时打掉：① 侧边栏「N 个子代理运行中」状态点；② 子代理面板的作者计数（跨层）；
> ③ 面包屑的血缘链；④ workflow-run 面板的成员跳转。
> 而子代理**抽屉/列表本身**（`subagents.list`）**完全不受影响**——它走独立 RPC。

---

## 1. 权威数据（本次实测，不是推算）

### 1.1 payload 组成（解析已捕获的真实响应 `session_list.json`）

| 口径 | 条数 | 字节 | 平均/行 |
|---|---|---|---|
| **全部 items** | **2,361** | **3,885,937**（外层信封 3,886,050） | 1,646 |
| `origin === "subagent"` | **2,277** | **3,733,032**（占 96.1%） | 1,639 |
| 顶层会话 | **84** | **150,543** | 1,792 |
| 含 `projections` 的行 | 2,359 / 2,361 | projections 合计 **3,214,435** | 1,363 |

- 行字段并集只有 9 个：`agentPreset, blank, cwd, origin, parentSessionId, projections, running, sessionId, updatedAt`
- `projections.values` 有 **13 个键**：`contextBreakdown, contextPressure, goal, imageLimits, permissions, plan, sessionListMetadata, sessionStats, subagent, subagentTiming, title, todos, tokenUsage`
- **结论：payload 的体积几乎全是 `projections`，不是行数本身。** 每行 1.6 KB 中 1.36 KB 是 projections。

> 交叉验证：`~/.dsh/storages/session_projcache.json`（8.74 MB，2,372 条缓存）× 12 个已注册 unit，每会话缓存约 1.57 KB
> → 与"投影是体积主因"完全吻合（`sessionListMetadata` 这一 unit 自身只有 69 B/行，在 `dsh-host-apiproxy/lib/types/api-proxy.js:989-997` 注册）。

### 1.2 血缘有效性普查（只读扫描 2,374 个会话目录的 zstd 头行，脚本 `census-subagent.mjs`）

| 指标 | 值 |
|---|---|
| 扫描会话目录 | **2,374**（头行解析成功 2,374，无跳过） |
| 顶层会话 | **84** |
| subagent 会话 | **2,290** |
| subagent 且**缺** `parentSession` 字段 | **26** |
| subagent 且父会话**不在磁盘**（真孤儿） | **1** |
| 父为 subagent（嵌套） | **311** |
| 父为顶层会话 | **1,952** |

在**实际下发的列表**（2,361 行）里复核：

| 指标 | 值 |
|---|---|
| subagent 行 | 2,277 |
| 其中 `parentSessionId === undefined` | **25** |
| 其中父**不在列表内**（孤儿） | **1** |
| 父在列表内 | 2,251（父为 subagent 310 / 父为顶层 1,941） |
| 血缘链深度直方图 | `depth 0: 25`、`1: 1942`、`2: 209`、`3: 93`、`4: 8` |

**Q5 结论：subagent 会话的父引用有效率 2,251/2,277 = 98.9%；孤儿仅 1 条（0.04%）。**
过滤会丢掉的"引用有效性"几乎为零——唯一例外是那 **25 条根本没有父指针的 subagent**，它们
`indexSubagentDescendants`（`dsh-client-runtime/lib/client.js:10267-10269` 的
`while (current?.origin === "subagent" && current.parentId !== void 0 ...)`）本来就会跳过，
**今天就没有任何 UI 显示它们**。

---

## 2. Q1：谁消费 `session.list` 里的 subagent 行？（逐一定位）

### 2.1 数据源判定表（关键：区分 `session.list` 与 `subagents.list`）

| 结构 | 数据来源 | 证据 |
|---|---|---|
| `byId` / `ids`（会话列表快照） | **`session.list`** | 宿主 `api-proxy.js:1659`；客户端 `client.js:8081` `this.api.sessions.list({})`；`refreshList()` 建立 `this.summaries` |
| `flattenLineage(summaries, …)` | **`session.list`**（入参即 merged summaries） | `client.js:5603`（定义）、`:8570`（调用，入参 `merged`） |
| `indexSubagentDescendants(summaries)` | **`session.list`**（入参 `useSessions(s=>s.byId)`） | `client.js:10267`；消费方见 2.2 |
| **`subagentsByParent` / `catalogs`** | **独立 RPC `subagents.list`** ❗ | `client.js:8010` `await this.api.subagents.list({ parentSessionId })`；`refreshSubagents()` `:7997` |
| `jobsBySession` | **宿主流帧 `host/jobs`**，**与 `session.list` 无关** | `client.js:8308-8315`、`:8587` |
| **面包屑/血缘导航用的"地址"** | **`catalogs`（即 `subagents.list`）+ 本地 `addresses`**，**不读 `summaries`** | `navigationAddress()` `client.js:7906-7920`；`select()` `:7863` |
| 打开子代理会话 | **`sessions.openSubagent(address)` → `manager.selectSubagent()`**，走 catalog 校验 | `dsh-client-ui-subagent/lib/client.js:831`；`client.js:7877-7891` |
| 轨迹（trajectory）转录 | **`sessions.history` / `subagents.history` RPC**，**完全不用 `useSessions`** | `client.js:7731-7736`；`dsh-client-ui-trajectory/lib/client.js` 全文件 `useSessions` 命中 **0** |

### 2.2 `session.list` subagent 行的**真实**消费方（共 5 处，全部经 `byId`）

| # | 消费方 | 位置 | 具体用途 |
|---|---|---|---|
| C1 | 侧边栏「N 个子代理运行中」 | `dsh-client-ui-workspace/lib/client.js:194` 与 `:222` `indexSubagentDescendants(list.byId)` → `:171` `runningSubagentCount: descendants.get(s.id)?.runningCount` → `:561-564` 状态点标签 | 顶层会话行右侧的运行状态 |
| C2 | 子代理面板「作者计数」 | `dsh-client-ui-subagent/lib/client.js:397` 读 `byId` → `:415` `indexSubagentDescendants(summaries).get(rootSessionId)` → `:416-420` `descendantCount` / `runningCount` | 计数徽标 + "加载中"占位 |
| C3 | 面包屑父子链 | `dsh-client-ui-conversation/lib/client.js:7290-7306` `deriveAncestry()` 读 `list.byId[cursor]`、`summary.parentId`、`summary.origin` | 会话标题上方的祖先链 |
| C4 | 面包屑「同级切换器」 | `dsh-client-ui-subagent/lib/client.js:664-667` `byId[lineageSessionId]?.origin === "subagent" ? .parentId : undefined` | 决定渲染 switcher 还是纯 count |
| C5 | workflow-run 成员跳转 | `dsh-client-ui-workflow-run/lib/client.js:171-179` `navigableMembers()` 读 `sessions.byId[member.childId]` + `sessions.ids` | 成员行是否可点击跳转；`:252-253` `openSession(member.childId)` → `ctx.sessions.open(id)` → `manager.select()` `client.js:7863-7865` |

**另外两处读取 `byId` 但与 subagent 关系薄弱的**：

- `dsh-client-ui-agent-preset/lib/client.js:192` `byId[sessionId]?.agentPreset`（预设徽标）——运行时为"当前链"合成条目时**带 `agentPreset`**（`client.js:9258-9266`），故仅当当前会话恰好是 subagent 时有极小退化。
- `dsh-client-ui-workflow-run` 之外无其它读 subagent 行的插件（全量 grep：`@deepseek-ai/*/lib/client.js` + `dsh-workspace-enhancement/lib/client.js`，命中 `origin === "subagent"` 的仅 5 个文件）。

### 2.3 第三方插件

`dsh-workspace-enhancement/lib/client.js`：
- `:5402` `ctx.get("sessions")?.list` → `:5418-5423` `Object.values(state.byId).map(...)` → `:4109` `remoteSessionIndex()`
- 用途：把 **cwd 带 `dsw-routes/<connId>/` 占位根**的会话按 title 映射到远程连接，给侧边栏行打"远程"徽标（`:4053 routeIdOf`）。
- **判定：无影响（净收益）**。subagent 行全部是本地 cwd，只会进入 `localTitles` 集合（`:4112-4118`）；过滤后 `localTitles` 缩小，
  "本地标题压制远程徽标"的判定只会更宽松或不变。同时顺带消掉 `DIAGNOSIS.md:132` 记录的
  `Object.values(byId)` 每次 **2,361 个对象全量重建** 与 `ids.filter((id,i)=>ids.indexOf(id)===i)` 的 O(k²)。

---

## 3. Q2：如果服务端过滤掉全部 `origin === "subagent"`，逐项判定

> 前提：过滤后 `byId` 里**只会剩下 84 条顶层行**（`mergeOrderedBaseline` `client.js:5567-5571` 会把 baseline 里不存在的旧行全部剔除，
> 所以连"陈旧 subagent 行残留"这条退路都没有——过滤是干净且一致的）。
> 但**当前会话链**例外：`projectList()` `client.js:9245-9266` 会为当前链上的 subagent **合成**条目
> （`{id, displayTitle, parentId, origin:"subagent", running, blank, updatedAt:0}`，**不含 `cwd`/`agentPreset`**）。

| 功能 | 判定 | 具体表现 | 依据 |
|---|---|---|---|
| **子代理抽屉 / 目录列表（CatalogDropdown 主树）** | **无影响** | 完全由 `subagents.list` 驱动；`:414-419` 的 `presentedCatalog` 只是"要不要显示 loading 占位"的辅助 | `client.js:8010`；`dsh-subagent/lib/index.js:1830 listChildren()` 直接从 `ctx.sessions` + persistence 枚举**这个父的直接子**，不读 `session.list` |
| **打开/切换子代理会话（转录）** | **无影响** | `openChild(address)` → `openSubagent` → `selectSubagent` 只校验 catalog，`:7865` 的 `summaries.some(...)` 门槛根本不参与 | `dsh-client-ui-subagent:831`、`client.js:7877-7891` |
| **轨迹面板 / 转录内容 / token 统计** | **无影响** | `sessions.history`（`client.js:7731-7736`）/ `subagents.history`；trajectory 插件 0 处 `useSessions` | 同上表 |
| **侧边栏会话列表本体（哪些行显示）** | **无影响** | `sessionVisible()` 首判据就是 `origin !== "subagent"`，本来就不渲染 | `dsh-client-ui-workspace/lib/client.js:101` |
| **C1 侧边栏「N 个子代理运行中」状态点** | **破坏** | 顶层会话行的状态点永久消失（`runningSubagentCount` 恒为 0 → `:561` `subagents === undefined`）。用户失去"哪个会话正在跑子代理"的唯一信号。**注意该信号本身很稀疏**：2,277 条 subagent 行里 `running===true` 的只有 **4 条**，所以丢的是"少数活跃进程的可见性"，静默无报错 | `ui-workspace:194/222 → :171 → :561-564`；`indexSubagentDescendants`（`client.js:10267`）的输入被掏空 |
| **C2 子代理面板「作者计数」** | **降级** | `descendantCount = max(healthy.length, descendants.count)`：直接子仍由 catalog 撑住（正确），但**孙代及以上消失**；`runningCount` 归零 → "运行中"文案错 | `ui-subagent:415-420` |
| **C3 面包屑祖先链** | **降级** | `deriveAncestry()` 在 `byId[cursor] === undefined` 处 `break`（`:7299`）。当前会话链有合成条目，所以**当前这条链仍能画出来**（且 `subagent: true` 标记仍正确）；但**离开当前链的祖先名字**拿不到，链会在缺口处截断 | `ui-conversation:7290-7306` |
| **C4 面包屑同级切换器** | **降级** | `byId[lineageSessionId]?.origin` 对**非当前**的 subagent 会话恒为 `undefined` → 永远走 `variant:"count"` 分支，**同级切换下拉消失**，只剩计数 | `ui-subagent:664-681` |
| **C5 workflow-run 成员跳转** | **破坏（可绕过）** | `navigableMembers()` 的 `summary?.origin === "subagent"` 永假 → 成员行 `aria-disabled=true`、`tabIndex=-1`、无 onClick（`:243-253`）。因为该面板内联渲染在父会话的对话流里（`ui-workflow-run:633-637` 挂在 `conversation.chat.node` 槽，宿主在 `ui-conversation:5511`），父 catalog 此时**是**已加载的，理论上 `navigationAddress()`（`client.js:7906`）能兜底——但 `navigableMembers` 根本没调它，所以**仍然丢** | `ui-workflow-run:171-179, 243-253, 637-639` |
| **`sessions.search` 搜索结果** | **降级（语义 + 成本双变更）** | 服务端 `listVisibleSessionSummaries()` 也是 search 的可见性白名单（`api-proxy.js:1678`），过滤后 2,277 条 subagent 转录**不再可被内容搜索命中**。因为侧边栏本来不显示它们，这更像"修正"而非破坏。但**成本会上升**：`while (authorized.length <= 20)` 循环（`:1690`）把 provider 的全局排名结果按可见性逐条过滤，以前靠 subagent 命中就能凑满 20 条；过滤后必须**多翻页**才能凑满 20 条可见结果 → 每次搜索的 provider 调用次数上升。硬上限 `SESSION_SEARCH_PROVIDER_CALL_LIMIT = 100`（`:43`）仍很宽裕，但在"极端稀疏命中"的查询上有触发 `session search provider exceeded the …-call work budget` 的风险面 | `api-proxy.js:1659`（list）与 `:1678`（search）同源；`:1690, 1744, 1766-1772`；常量 `:43`、`types/api/session-search.js:2 SESSION_SEARCH_RESULT_LIMIT = 20` |
| **第三方远程徽标插件** | **无影响** | 见 2.3 | `dsh-workspace-enhancement:4109, 5418` |
| **`jobsBySession`** | **无影响** | 走宿主流帧，与 `session.list` 无关 | `client.js:8308-8315, 8587` |

**一句话**：`session.list` 的 subagent 行只支撑**"计数/血缘/跳转"这三类装饰性但有价值的信号**，不支撑任何**内容读取**路径。

---

## 4. Q3：独立子代理 RPC 兜底能力

`subagents.list` **确实存在且够用**：

- **服务端**：`dsh-host-apiproxy/lib/types/api-proxy.js:2256-2285`
  返回 `{ entries, parentAvailable }`；`entries` 来自 `ctx.subagents.listChildren(parentSessionId, signal)`，
  每条 child 追加实时 `activity: 'running' | 'inactive'`（`ctx.agents.get(entry.id)?.status`），
  `parentAvailable` = 该父的 agent 是否在线。另有 `kind:'diagnostic'` 条目解释不可用原因。
- **实现**：`dsh-subagent/lib/index.js:1830 listChildren()` —— 从 **`ctx.sessions`（live）+ `sessionPersistence.list()`（cold）的
  live-preferred 合并语料**里筛 `header.parentSession === parentSessionId && header.origin === "subagent"`，
  每条经 `subagent` 投影 unit 解析。**完全不依赖 `session.list`**。
  → 这正是"会话列表过滤不影响子代理 UI"的结构性保证。
- 另有 `listDescendants(ctx, rootSessionId)`（`:1858`，按 root 前序遍历全部后代，带 `parentId`/`depth`），
  目前**没有暴露成 RPC**，但已经实现好了。

**两者数据是否重复？** 部分重复，且**子代理专用的那份更强**：
`session.list` 提供的是"扁平摘要行"（无 direct-parent 校验、无 mode、无 label、无 diagnostic、无 activity 语义）；
`subagents.list` 提供的是**分类过的 catalog 条目**（含 `mode`、`label`、`activity`、`kind`、可解释的 diagnostic）。
UI 侧的权威结构 `catalogs`/`subagentsByParent` **本来就取自后者**。

> **重要缺口**：`subagents.list` 是**按父粒度**的，没有"全局统计全部会话的 running 子代理数"这种聚合。
> 这就是 C1 无法用它等价替代的原因（要替 84 个顶层会话各发一次 RPC 才能算出徽标——不可接受）。

---

## 5. Q4：血缘与导航

| 环节 | 是否需要在 `session.list` 中存在 | 证据 |
|---|---|---|
| 点开某条 subagent 的转录 | **不需要** | `openSubagent(address)` → `manager.selectSubagent()` 只用 `catalogs`（`client.js:7877-7891`）；history 走独立 RPC（`:7731-7736`） |
| 父链解析（面包屑）| **部分需要**：运行时**为当前链合成 `byId` 条目**（`client.js:9245-9266`），血缘走 `navigationAddress()` → catalogs 优先（`:7906`）。因此**当前链**完整；**跨链/历史链**会截断 | `ui-conversation:7290-7306`；`client.js:7906, 9245-9266` |
| 会话能不能被"选中" | **不需要**：`select()` 的门槛是 `summaries.some(...) || address !== undefined`（`:7865`），catalog 地址即通行证 | `client.js:7863-7865` |
| 侧边栏能否选中 | 需要 `ids`（`:7865` 或 `:9220` 的 `ids.push`）。**过滤后顶层会话仍在 `ids` 里**，不受影响 | `client.js:9220, 9276` |
| trajectory 面板 | **不需要**（0 处 `useSessions`） | `dsh-client-ui-trajectory/lib/client.js` |

---

## 6. Q6：三方案对比（改动点 / 是否需客户端改动 / 风险）

### 方案 A：服务端完全过滤 `origin === 'subagent'`
| | |
|---|---|
| **改动点** | `dsh-host-apiproxy/lib/types/api-proxy.js:1406-1460` `listVisibleSessionSummaries()`，**两处**：<br>① **`:1416`** `const items = ctx.sessions.list().map(summarizeAttached);` —— 内存（已 attach）分支目前**无任何 origin 过滤**，需改为先过滤再 map；<br>② **`:1422`** `.filter(meta => !attached.has(meta.id) && meta.cwd !== undefined);` —— 冷会话分支追加 `&& meta.origin !== 'subagent'`。<br>**合计 ~2 行、无新字段、无 schema 变更** |
| **客户端改动** | **必须**（否则破坏 C1/C2/C4/C5）。最小配套：新增宿主聚合字段后在 `projectList()` `client.js:9220` 落到 `byId`，并改 4 处消费方（`ui-workspace:171` / `ui-subagent:416` / `ui-subagent:665` / `ui-workflow-run:175`） |
| **收益** | 3,885,937 B → **150,638 B（−96.1%）**；2,361 行 → **84 行**；`flattenLineage`（`client.js:5603`）每次重建对象 2,361 → 84，`mergeOrderedBaseline`/`entryCache` 的 O(N²) 同步塌缩 |
| **风险** | 中：① 需新增聚合字段与 4 处消费方改造；② `sessions.search` 语义 + provider 翻页成本变更（见 §3 末行）；③ 若聚合字段没做，**侧边栏运行状态点静默消失**（最容易被漏掉的一条） |

### 方案 B：服务端分页/上限（顶层全覆盖 + subagent 最近 N 条）
| | |
|---|---|
| **改动点** | 同 A 的同一函数：先按 `origin` 分流，顶层全发，subagent 按 `updatedAt` 降序取 N（如 200），并可用 `settings` 暴露 N（参考 `:824` `coldBlankProbeMaxBytes` 的既有旋钮写法） |
| **客户端改动** | **零**（行数变少不需要改客户端；schema 不变） |
| **收益** | 84 + 200 行 ≈ 284 行、约 **150,638 + 200×1,639 ≈ 478 KB（−87.7%）** |
| **风险** | **最低**：保留最近 200 条 subagent 行 → C1/C2/C4 对**活跃**会话仍然工作（用户实际关心的正是活跃的）；C5 对近期 workflow 成员仍可跳转。代价是"很老的 subagent 的计数/血缘/跳转"不显示——而这批本来也早已不活跃 |
| **注意** | 不要对**顶层会话**设上限（那会真正破坏侧边栏完整性）。必须"顶层优先、subagent 补齐" |

### 方案 C：顶层全发 + subagent 按需拉取
| | |
|---|---|
| **改动点** | ① `listVisibleSessionSummaries()` 过滤（同 A）；② **新增 RPC**（如 `sessions.listSubagents({ parentSessionId, limit })`）或复用/暴露已有的 `listDescendants`（`dsh-subagent/lib/index.js:1858`）；③ `client.js:8078 refreshList()` 增加按需合并 |
| **客户端改动** | **必须**：新增 store 字段 + 至少 2 处消费方改造（C1 需"按需展开的父集合"驱动，而不是全量） |
| **收益** | 最优（150 KB 上限 + 只在展开时拉取） |
| **风险** | **最高**：新增 RPC 面 + 客户端缓存/失效/竞态（谁在什么时候知道该拉哪个父）；C1 的通达性从"被动全量"变成"主动枚举"，需要定义"哪些父需要计数"——这是一个新的产品问题。**建议作为 A/B 之后的演进，不作为首刀** |

---

## 7. Q7：明确判定 + 推荐最小改动 + 验收

### 判定

> **不安全（无条件过滤）；有条件安全（补聚合字段后）；推荐 B 作为第一刀。**

- **不安全**的理由是 4 处真实功能依赖：C1（破坏）、C2（降级）、C4（降级）、C5（破坏/可绕过）。
- **有条件安全**的理由是这 4 处**全部可修**，且不涉及内容读取路径；子代理抽屉/转录/轨迹与第三方插件**天然免疫**。
- 数据侧的机遇极大：**过滤掉 96.1% 的行，却只减少 3.9% 的字节**（顶层 84 行自身就有 150,543 B，平均 1,792 B/行，比 subagent 行的 1,639 B/行还大）。
  也就是说，"减行数"的收益主要是 **CPU / 内存 / churn**（正是 `DIAGNOSIS.md` 的 M2），**不是带宽**。
  真正削带宽需要在 `projections` 上做裁剪（占 3,214,435 B / 82.7%），那是另一条独立的优化线。

### 推荐落地顺序

**第 1 步（首刀，零客户端改动）— 方案 B**：
在 `api-proxy.js:1406-1460` 把 subagent 行按"最近 N 条"截断（建议 N=200，可用 settings 调），顶层会话 84 条全量发。

**第 2 步（可选加强）— 方案 A + 聚合字段**：
在 `sessionListFields()`（`api-proxy.js:381-391`）或 `summarize()`（`:394-403`）里为**顶层会话**追加
`runningSubagentCount`（宿主侧从 live `ctx.agents` 状态直接算，成本 ~2,290 次 map 查表，远低于现有 2,290 次投影快照）。
消费方改 4 处：`ui-workspace:171`、`ui-subagent:416`、`ui-subagent:665`、`ui-workflow-run:175`。
此时可以安全地把 N 降到 0（完全过滤）。

**第 3 步（演进，非必需）— 方案 C**：`subagents.list` 已够用，`listDescendants` 已实现，按需拉取可作为独立迭代。

### 验收标准（可量化，全部基于本次实测基线）

| # | 验收项 | 目标 |
|---|---|---|
| A1 | `session.list` 条目数 | 2,361 → **≤ 284**（方案 B）/ **= 84**（方案 A） |
| A2 | `session.list` 响应字节 | 3,885,937 → **≤ 500 KB**（方案 B）/ **≈ 150 KB ± 15%**（方案 A） |
| A3 | 顶层会话 84 条**一条不少** | 逐 ID 比对相等 |
| A4 | 侧边栏「N 个子代理运行中」 | 对一个正在跑子代理的会话仍出现该状态点（**这是过滤后最容易丢的一项，必须单独验**） |
| A5 | 子代理抽屉 | 展开任一顶层会话，直接子条目数量/标签/运行态与过滤前完全一致（走 `subagents.list`） |
| A6 | 打开子代理转录 | 能打开并渲染轨迹；token/usage 概览正常 |
| A7 | 面包屑 | 进入某个 subagent 会话后，祖先链至少与过滤前一致 |
| A8 | workflow-run 面板 | 运行中成员行仍可点击跳转 |
| A9 | 第三方远程徽标 | 远程工作区行的徽标数量不减少 |
| A10 | 回归对照 | 明确记录 `sessions.search` 是否按预期不再命中 subagent 转录（方案 A/B 都会如此；若这是不可接受的，则 N 不能降为 0） |

### 未证实项（需要什么观测才能定论）

1. **C5 的可见影响程度（条件性破坏，非绝对破坏）**：`navigableMembers()` 硬依赖 `byId[childId]` 且**不调用** `navigationAddress()`，因此在过滤后**必然**把成员行渲染成不可点击（`aria-disabled=true`、`tabIndex=-1`、无 onClick，`ui-workflow-run:243-253`）。
   但该面板内联渲染在**父会话**的对话流里（`ui-workflow-run:633-637` 挂 `conversation.chat.node`，宿主 `ui-conversation:5511`），
   此时父的 catalog **是**已加载的（`select()` 会 `refreshSubagents(sessionId)`，`client.js:7870`），
   所以 `navigationAddress()`（`:7906-7920`）本可兜底——**只是这条代码路径没被用**。
   故"是否真的打不开"取决于用户手上还有没有别的入口（例如先在子代理抽屉里展开该父）。**需要实机验证**：
   对一个多代理 workflow 跑一次，观察成员行是否真的失去点击。
2. **C2 的可见影响程度**：只测算到 `descendantCount`/`runningCount` 的取值变化（`ui-subagent:415-420`），未做实机前后截图对比。
3. **`runningSubagentCount` 聚合的服务端成本**：未实测（预期远低于现有"2,290 次投影快照"路径，但未计时）。
4. **过滤对 `session.list` 首字节时间的影响**：现有基线是 HTTP 旁证 **465 ms**（`audit-server.md:59`），过滤后未复测（本轮遵守"不发 HTTP 探针"）。
5. **C1 的一个已确证的死角**：`indexSubagentDescendants` 只统计 `origin === "subagent"` 的**直接/间接后代的 `running`**，
   而这次的 2,277 条 subagent 行里 `running === true` 的只有 **4 条**（实测）。
   所以 C1 徽标的价值集中在"这 4 个活跃进程"，过滤后这个信号会**完全且静默**消失——这是最容易被漏掉、也最该优先补的一项。

---

## 8. 附：本次未做的事（纪律申报）

- 未修改任何文件（`~/.dsh/profiles/...`、宿主、会话数据全未触碰）
- 未重启/干扰 PID 20806
- 未发任何 HTTP 探针（0 次，低于 ≤5 次上限）
- 未做压测；zstd 解压只读取每个会话文件的**首个头行**（`head -c 4000 | head -n 1`），未读取 1.2 GB 正文
- 新增文件仅 2 个，均在任务指定工作区：`census-subagent.mjs`、`census.json`，以及本报告
