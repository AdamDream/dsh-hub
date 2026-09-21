# C2 审计：row-badges「过宽订阅 / 全树扫描」定量化与最小收窄

- **范围**：`.workspace/lag-fix/research-v2/c2-scan/`（本代理独占，只读产品源码）
- **被测对象**：部署态 `dsh-workspace-enhancement/lib/client.js`（由 3080 真实 GUI 加载执行）
- **纪律**：单浏览器（三个脚本各自 launch→close，互不并发）；**未传 `sandbox_permissions`**；未点任何写状态按钮（只点「设置 / 关闭 / 设置页导航标签」）；未改产品文件、未重启、未改配置
- **日期**：2026-09-21

---

## 0. 结论摘要（先给数字）

| 指标 | 实测值 |
|---|---|
| 一次扫描（wall，端到端） | **中位 0.2 ms**（p90 0.3 / p99 0.5 / 全程最大 13.5 ms 一次）；campaign-1 均值 0.370 ms（279 次） |
| 扫描频率 | **0.95–3.29 次/s**（静默窗 0.95–1.35；操作相位 1.25–3.29；中位 ≈2.0）；硬上限 3.33/s，由 `SCAN_MIN_GAP_MS=300` 决定 |
| 扫描侧成本 | **0.20–0.55 ms/s**；理论天花板 **≤1.4 ms/s** |
| 一次 feed 通知的 `rebuildRemote` 成本 | **≈71 µs**（feed 侧自时间合计 385.2 ms / 5438 次调用） |
| feed 通知频率 | **0–59.2 次/s（中位 ≈28；静默 60 s 窗口 28.1 次/s）→ 未受任何节流** |
| rebuild 侧成本（含两个投影与 `routeIdOf`） | **≈2.03 ms/s**（≈94% 的层内自时间；采样下界） |
| **层总成本** | **≈2.58 ms/s（下界估计）～ 4.4 ms/s（上界估计）= 单核 0.26%–0.44%** |
| 可移除比例 | **825 / 825 次 feed 通知中，badge 相关投影（id 集合 / displayTitle / cwd）零变化 = 100% 可移除** |
| 设置面板 DOM 变化 | 在 23.9 s 内产生 74 次设置区 childList 变更，**扫描次数没有跟随变化**（见 C2-9） |

**一句话**：真正值得修的不是「全树扫描」，而是 **`onChange` 对 sessionsFeed 的无条件、无节流 rebuild**；它占了这一层 ~94% 的成本、随活跃流线性增长、且实测 100% 是纯浪费。全树扫描（1 次/扫描、3–4 µs）与观察器过滤条件（设置面板不排除）在**绝对量上可忽略**，改它们买不到东西。

**对父目标（设置页卡顿）的旁证**：同一 189.6 s 测量窗内，row-badges **全层**只花掉 409.7 ms 采样自时间（≈2.6 ms/s ≈ 单核 0.26%）。作为量级对照，同一 bundle 内的设置页组件 `SshWorkspaceFlow`（行 2787）**单独一个组件**就有 61.6 ms 采样自时间；而设置面板打开/切标签的 1.5 s 相位里，页面整体采样自时间由 `apply` / `(anon)` / React commit 桶主导（单相位数百 ms）。→ **本层（0.26% 单核）在绝对量上不足以解释设置页卡顿**；设置页自有成本的精确归因属 `cpu-profile` 线的职责，本审计不越界下结论。

---

## 1. 事实基线核验（细化，不推翻）

部署包与 3080 实际下发字节**完全一致**，故行号可互换：

```
sha256 7df7a655ee660eb29dd8ee87d4b20fa3f06a16faee80c52baf612d6e7ffef90d
  = ~/.dsh/profiles/node_modules/dsh-workspace-enhancement/lib/client.js
  = http://127.0.0.1:3080/plugins/dsh-workspace-enhancement/client.js?rev=b295bb00e32b
5453 行
```

| 基线断言 | 核验 | 部署行号 |
|---|---|---|
| 观察 `document.body` subtree childList | **成立**：注入式 `MutationObserver` 计数抓到全页仅 2 个观察器，其一为 `body {childList:true,subtree:true}` | 4450–4454 |
| `isOwnBadgeMutation` 只排除自身 badge | **成立**：`element.closest('[data-dsw-badge]') !== null` | 4191–4195 |
| 有 pendingScan 合并 + 300 ms 最小间隔 | **成立**：`SCAN_DELAY_MS=120`、`SCAN_MIN_GAP_MS=300` | 4062–4063、4403–4411 |
| subscribe 同时订阅 workspacesFeed 与 sessionsFeed | **成立** | 5437–5438（`un1`/`un2`），`ctx.effect` 5445 |
| 「rebuildRemote ≈4364–4395」 | **需细化**：4364–4411 是 `scan()`；`rebuildRemote` 在 **4220–4223**，`onChange` 在 **4413–4416** | — |

**部署态数据规模（决定一切绝对量）**：12 个 workspace、**2 个 session**、14 个 treeitem（12 个分组行 + 2 个会话子行）、DOM 605 元素（设置面板打开 776 / 插件标签 1025）。
`~/.dsh/remote-workspaces/nodes.json` = `{"nodes":[]}` → `remoteWorkspaceIndex`/`remoteSessionIndex` **均为空 Map** → 全程 `[data-dsw-badge] = 0`、`marked.size = 0`。

> 这一点决定了报告口径：**观察器→扫描→rebuild 这条链路存在且被实测；badge 注入/撤回链路在本部署中不存在**（见 §7）。

---

## 2. 任务 1｜静态成本项逐行（PASS）

### 2.1 每次 feed 通知（未节流） — `onChange` 4413–4416 → `rebuildRemote` 4220–4223

```
4413  const onChange = () => { rebuildRemote(); scheduleScan(); }   // 无 payload、无比较、无条件
4220  const rebuildRemote = () => {
4221    remoteByTitle = remoteWorkspaceIndex(sources.workspaces());
4222    remoteSessionTitles = remoteSessionIndex(sources.sessions());
4223  };
```

| 成本项 | 行 | 每次通知的分配 / 工作量 | 本部署实测（12 ws / 2 sess） |
|---|---|---|---|
| `sources.workspaces()` | 5414–5417 | **每次调用都新建 1 数组 + N 个对象**（无 memo） | 12 对象 + 1 数组 |
| `remoteWorkspaceIndex` | 4078–4097 | `new Set()` + `new Map()`；每行 1 次 `routeIdOf`；远程行 `byTitle.set(title, [...prev, connId])` **每行 1 次数组展开**；末尾 `ids.filter(indexOf)` 去重（O(k²)） | 1 Set + 1 Map + 12 次 `routeIdOf` |
| `sources.sessions()` | 5426–5435 | 按 **快照身份** memo；身份变化时 `Object.values(byId)` + `.map()` → 1 数组 + N 对象 | 1 `Object.values` 数组 + 1 数组 + 2 对象 |
| `remoteSessionIndex` | 4109–4128 | 与 workspace index 同构（Set + Map + 每行 `routeIdOf` + 展开 + 去重） | 1 Set + 1 Map + ≤2 次 `routeIdOf` |
| `scheduleScan` | 4403–4411 | `Date.now()`；`pendingScan !== null` 时立即返回 | ≈0（合并生效） |
| **合计/通知** | | **≈6 个容器 + ≈14 个对象分配**，`routeIdOf` 正则 ≤14 次/通知 | **≈71 µs CPU（实测量级）** |

> **关键结构事实**：`scheduleScan` 被节流（≤3.33 次/s），但 **`rebuildRemote` 在它之前、对每次通知同步执行，完全没有节流**。这是本层唯一的「随负载线性增长」项。在 ~29 次/s 通知下即 29 × 71 µs ≈ **2.0 ms/s**，且与 DOM 是否变化完全无关。

### 2.2 每次扫描 — `scan` 4364–4411

| 成本项 | 行 | 范围与次数 | 本部署实测 |
|---|---|---|---|
| 剪枝 `marked` 中失连行 | 4367–4370 | O(M)，M = 已标记行数 | M=0 → 0 |
| `withdrawStale()` | 4337–4363 | **每个已标记行**：1 次 `rowStatusOf` + **1 次 `row.closest('[role="tree"]')`** + **1 次整树 `tree.querySelectorAll('[role="treeitem"][aria-expanded]')`**（=O(M×T)）+ 1 次 `rowTitleOf` + 分组子行的 `Array.from(section.children).find` | **M=0 → 全 0**（本部署不存在） |
| `document.querySelectorAll('[role="tree"]')` | 4372 | **1 次/扫描，整文档子树** | **3.15–4.0 µs**（605 元素） |
| `tree.querySelectorAll('[role="treeitem"][aria-expanded]')` | 4374 | 1 次/扫描/树 | **2.85–3.2 µs**；`elQSA` 计数 = **恰好 1.0/扫描** |
| 分组分支逐行 `rowTitleOf` | 4376–4388 | 每分组行 1 次；`rowTitleOf`(4168) = 1×`querySelectorAll('span')` + 每 span ×(`querySelector('svg')`+`closest('[data-dsw-badge]')`+`textContent.trim()`) | **12 行/扫描**（`elQSA['span']` 实测 **恰好 12/扫描**）；每行 6 个 span → ≈228 次 DOM 操作 |
| 扁平分支 | 4389–4394 | `remoteSessionTitles.size > 0` 才进入 | **`elQSA['[role="treeitem"]'] = 0.00/扫描` → 分支休眠** |
| `markRow`/`buildBadge`/`appendChild` | 4341–4354 | 命中才注入 | **0 次**（无远程条目） |
| `document` 查询总数 | | | **`docQSA['[role="tree"]']` = 恰好 1.00/扫描**（55/55、279/279 两轮一致） |

**扫描成本归因**（probe3，55 次扫描 / 60 s，与真实 12 行全量复现体对照）：

| 量 | 值 |
|---|---|
| 真实扫描 wall：中位 | **0.2 ms**（p25 0.2 / p75 0.3 / p90 0.3 / p99 0.5 / max 0.5，**>1 ms 的 0 次**） |
| 复现体（全 12 行）tight-loop | 26 µs |
| 复现体（全 12 行）按 300 ms 节拍 | **中位 0.2 ms**（与真实扫描一致） |
| 其中整文档 `[role="tree"]` 查询占比 | ≈**2%** |

→ 扫描成本**不在整文档查询**；热点是 12 行标题提取（cold-path 下每行 ≈15 µs，而 tight-loop 单行仅 0.75 µs）。tight-loop 与按节拍相差 ~8× 属 JIT/缓存效应，已用两种节拍交叉验证。

---

## 3. 任务 2｜动态测量方法与条件（PASS）

**真实浏览器**：Playwright（chromium 1148，headless）+ CDP。
**只读打桩**（未改产品文件）：`MutationObserver` 子类计数、`Document/Element.prototype.querySelectorAll` 计数、`setTimeout` 包裹测扫描 wall、`Array.prototype.map` 结果形状判别、`PerformanceObserver(longtask)`；CDP `Profiler`（100 µs 采样）+ `Profiler.startPreciseCoverage(callCount)` 取**部署态函数精确调用次数**。

**扫描计数器的唯一性已证**：遍历 profile 内全部 upstream bundle + 本 bundle，`querySelectorAll("[role=\"tree\"]")` **只有本插件一处**（`dsh-client-ui-subagent` 用的是 `[role="treeitem"]:not(...)`，不同选择器），且 `docQSA` 计数与 CDP 精确调用数逐相位吻合 → 计数器即扫描次数，无混入。

**三组条件**（campaign-1：3 次重复 × 31 相位，共 189.6 s）：

| 条件 | 刺激 | 产生方式 |
|---|---|---|
| (a) 设置面板 DOM 变化 | 打开设置 → 依次切 5 个标签 → 关闭 | 驱动脚本真实点击（非写状态按钮） |
| (b) 仅 session running/updatedAt 变化 | 活跃流（操作者真实产生 agent 活动）| 哨兵文件同步的 30 s 窗口；另有静默对照 |
| (c) title/cwd 变化 | 见 §5（判据：与 (b) **同代码路径**，代价按构造相同） | — |
| 对照 | 完全静默 20 s 窗口 ×3（单条 `sleep` 前台调用覆盖全程） | 哨兵文件同步 |

**同一窗口内基线数据**（campaign-1，按条件聚合）：DOM 侧栏树变更数（`sidebarTree`）= **0**（所有 31 个相位、所有条件）；设置区变更数 A1=5 / A2=74 / 其余 0。

---

## 4. 任务 3｜判据：什么真的触发扫描、每次多少 ms、活跃流下 ms/s

### 4.1 谁会触发（按贡献排序，均有实测支撑）

1. **sessions 快照变化 → `onChange` → `rebuildRemote` + `scheduleScan`**：唯一的主导者。
   证据：静默窗口 60.3 s 内 **`rebuildRemote` 1694 次（28.1/s）而 DOM 变更 0 次**；三个 20 s 静默窗口分别 426 / 664 / 604 次 rebuild、变更均 0。
   `subscribe` 无 payload → `onChange` 不做任何字段判断 → **running/updatedAt/pendingInteraction/projectionValues 任一变化都全额重建**。这与 runtime 侧 `projectList` 的 `reusable` 判据（含 running/updatedAt）以及 zustand `setState` 的 `Object.is` 去重（相同投影对象不通知）叠加，意味着：**通知次数 = 这些字段的真实变化次数，而它们对 badge 全部无关**。
2. **设置面板 DOM 变化 → 观察器 → `scheduleScan`**：**存在但不可测出增量**（C2-9）。
3. **侧栏树自身的 DOM 变化**：本部署 **0 次**（不存在），故「动态侧栏行」路径未被触发。

### 4.2 每次扫描多少 ms

- 中位 **0.2 ms**、均值 0.37 ms（campaign-1 279 次），p99 0.5 ms；全程仅 1 次 13.5 ms 离群（未产生 >1 ms 的扫描在 probe3 的 55 次中为 0 次）。
- 组成：整文档 `[role="tree"]` 查询 ≈3–4 µs（~2%）＋ 整树分组查询 ≈3 µs ＋ 12 行 `rowTitleOf`（≈228 次 DOM 操作）为主体。

### 4.3 活跃流下的 ms/s

| 条件 | 扫描 | 扫描侧 ms/s | rebuild | rebuild 侧 ms/s | 层合计 |
|---|---|---|---|---|---|
| 静默对照（3×20 s） | 0.95–1.35/s | 0.08–0.54 | 21.2–33.1/s | ≈1.1–3.2 | ≈1.2–3.4 |
| 活跃流（3×30 s） | 1.10–1.40/s | 0.24–0.54 | 24.9–36.6/s | ≈1.4–2.2 | ≈1.5–2.5 |
| 设置面板操作（15 相位） | 1.25–3.29/s（均值 2.14） | 0.27–1.26 | 0–59.2/s | 0–2.5 | 0.1–2.8 |

**全量口径（189.6 s）**：扫描侧 **0.545 ms/s**（`setTimeout` 精确 wall，103.3 ms / 279 次） + feed 侧 **≈2.03 ms/s**（`rebuildRemote`+两索引+两投影+`routeIdOf`+`onChange` = 385.2 ms，样本数×100 µs 估计器） = **≈2.58 ms/s**；delta-sum 上界（把 idle 间隔计入）为 **≈4.4 ms/s**。→ 取 **≈2.6 ms/s = 单核 0.26%**，上界 0.44%。
**注意**：活跃流与静默对照**没有可辨差异** —— 因为 ambient 通知（同 GUI 其他会话的流）在两种窗口里都是 21–33 次/s，本代理自身活动只贡献 ~0–4 次/s 的边际。

### 4.4 哪部分值得修 / 哪部分收益可忽略

| 部分 | 量级 | 判决 |
|---|---|---|
| **未节流的 `onChange`→`rebuildRemote`** | **≈2.0 ms/s，占层内自时间 ≈94%，随通知率线性、无上限；且实测 100% 是无效重建** | **值得修（唯一）** |
| 扫描侧整条链路 | 0.20–0.55 ms/s，硬天花板 1.4 ms/s | 收益可忽略（不值得动） |
| 整文档 `querySelectorAll('[role="tree"]')` | 3–4 µs/次 ≈ 0.005–0.01 ms/s | **收益可忽略**，改它等于白改 |
| 观察器不排除设置面板 DOM | 增量扫描 ≈0（C2-9） | **收益可忽略**（且改它有漏标风险，见 §6.4） |
| `withdrawStale` 的 O(M×T) / badge 注入 | 本部署 M=0 → **0** | **不存在**，无法活体评级（成本模型见 §6.5） |

---

## 5. 条件 (c) title/cwd 的诚实口径

- **代码事实**：`onChange`(4413) **不接收任何 payload**，无条件执行 `rebuildRemote()`（重建两个索引）+ `scheduleScan()`。因此 **title/cwd 变化与 running/updatedAt 变化的单次代价按构造完全相同**；二者差别只在**频率**。
- **测到的**：63.5 s（campaign-2）内 825 次到达 badge 投影的通知中，**id 集合变化 0 次、title/cwd 变化 0 次、纯顺序变化 0 次、仅无关字段变化 825 次**。→ 观测窗内 (c) 的**频率为 0**。
- **结论口径**：(c) 的**单次代价 = (b) 的单次代价（PASS，按构造成立）**；(c) 的**实测频率 = 未测到**（窗口内未发生，非「不存在」——自动标题/改名是真实会发生的路径，只是本窗口没有）。
- 判定**不作**「(c) 不需要修」的结论：正因为代价相同，收窄必须覆盖 title/cwd/id 三个字段（见 §6.2）。

---

## 6. 任务 4｜最小收窄设计（三选一：只改订阅字段）

### 6.1 三选项的证据裁决

| 选项 | 证据 | 裁决 |
|---|---|---|
| 只改过滤条件（观察器排除设置面板） | 设置区 74 次变更未带来扫描增量（C2-9/C2-10：变更 0/2/18 三组扫描率均值 2.01/2.36/2.17 次/s，无单调关系；最高扫描率相位仅 2 次设置区变更） | **不采纳**：收益≈0，且排除式过滤有漏动态行的风险 |
| **只改订阅字段（onChange 加投影门闸）** | 825/825 通知 badge 相关投影零变化；rebuild 占 94% 成本且无节流 | **采纳** |
| 只改扫描范围 | 整文档查询仅占一次扫描 ~2%，扫描侧天花板 1.4 ms/s | **不采纳**：收益≈0 |

### 6.2 设计（最小、可逆、不动观察器/不动扫描范围/不动订阅接线）

在 `onChange`（4413–4416）前加一道**投影签名门闸**，签名**由投影本身派生**（不是手写字段列表，避免未来字段漂移）：

- 签名覆盖：`sources.workspaces()` 的 `{title,path}` 集合 + `sources.sessions()` 的 `{title,cwd}` 集合（两者正是 `remoteWorkspaceIndex`/`remoteSessionIndex` 唯一读取的字段，见 4078–4097 / 4109–4128）。
- `onChange`：算签名 → 与上次相同则 **直接 return**（不 `rebuildRemote`、不 `scheduleScan`）；不同则 old path 原样执行。
- **首次调用必须强制重建**（`onChange()` 在 686/4448 安装时调用一次，签名初值为 `undefined` → 天然不等）。
- 保留一切现有语义：`withdrawStale`「先清后标」、观察器自诱过滤、`SCAN_MIN_GAP_MS` 节流、双 feed 订阅接线**均不改**。
- 建议同时把 `sources.workspaces()`（5414）按快照身份 memo（与 sessions 同构）——但这是次要项，签名门闸已覆盖绝大部分收益。

**预期收益**：≈2.0 ms/s → ≈0（实测 100% 通知可省）；层总成本 2.6 ms/s → ≈0.6 ms/s（仅剩扫描侧）；并消除唯一的负载线性项与 ≈580 对象/s 的分配（GC 效应未测到，见 §7）。

**预期代价**：每次通知多一次签名计算（14 行字符串拼接 + 比较）。参照实测投影量级（workspaces 0.167 µs、sessions 0.7 µs tight-loop）与 cold-path 8× 因子，约 **2–6 µs/通知 = 所省 71 µs 的 3–8%**。

### 6.3 验收标准（可执行）

1. `npm run check:static && npm run typecheck && npm run test:agent` 全绿；badge 相关单测零修改即通过。
2. 活体（lab 50599）：sessions feed 通知 ≥10 次/s 的 60 s 窗口内，**`rebuildRemote` 精确调用数从 ~29/s 降到 ≈0/s**，且 `[data-dsw-badge]` 数、`marked` 行数、**扫描次数/秒变化 ≤10%**。
3. 漏标哨兵（lab，注册 1 个远程节点）：**workspace title 改名** 与 **session cwd 变化** 后 ≤420 ms（120+300）内 badge 重新落位。
4. 撤标哨兵：出现同标题本地 workspace（`path` 变化）后 ≤420 ms 内旧 badge 被撤回。
5. 首次安装：`onChange()` 安装首调用仍产生一次重建+扫描（不得被子闸吞掉）。

### 6.4 回归风险（必须写在 PR 里）

- **漏标/撤标（主要风险）**：签名必须覆盖索引的**全部**输入字段。若未来索引改用新字段而签名未同步 → 索引静默陈旧 → **漏标**。缓解：签名**由投影数组派生**（新字段自动进入签名）+ 一条单测断言「签名对 path/cwd/title 的任一变化都变化」。
- **顺序敏感**：若签名顺序敏感，feed 重排序会造成多余重建（**仅浪费，不影响正确性**，可接受）。
- **不能做的激进改法**（会漏动态侧栏行或撤标）：把观察器根从 `document.body` 缩到侧栏元素、把过滤改成白名单「target 必须在 `[role="tree"]` 内」、或干脆退订 `sessionsFeed`。三者都会在侧栏被创建/重建、或扁平模式出现远程会话时**漏掉动态行**——本审计明确不建议。
- **首次调用**：门闸若把安装首调用也吞掉，会丢掉初始标注（§6.3-5）。
- **内存**：签名字符串需按需重建，勿长期持有 feed 行数组引用（避免拖住旧快照）。

### 6.5 休眠路径的成本模型（**成本模型，非活体测量**）

在本部署（M=0）`withdrawStale` 贡献恒为 0，故其上界用**实测原语单价**建模（live DOM、605 元素、12 分组行、6 span/行）：

| 原语 | 实测单价 |
|---|---|
| `document.querySelectorAll('[role="tree"]')` | 3.15–4.0 µs |
| `tree.querySelectorAll('[role="treeitem"][aria-expanded]')` | 2.85–3.2 µs |
| `row.closest('[role="tree"]')` | 0.10 µs |
| `row.querySelectorAll('span')` | 0.15–0.30 µs |
| `rowTitleOf(row)`（tight-loop） | 0.75–1.2 µs |

→ `withdrawStale` ≈ **M × (0.1 + 2.85 + ~1 µs) ≈ M × 4 µs**。（M = 已标记行数；若 14 行全标记 ≈56 µs/扫描，即在中位 0.2 ms 扫描上 +28%。**这是推算，不是实测**——本部署没有远程节点，无法活体验证。）

---

## 7. 「未测到」与「不存在」的区分（硬性清单）

### 不存在（有正面证据，非测量失败）
1. **badge 注入 / 撤回链路的任何活体成本**：`nodes.json` → `{"nodes":[]}`，`remoteWorkspaceIndex`/`remoteSessionIndex` 恒空；全程 `[data-dsw-badge]=0`、`marked.size=0`；`elQSA['[role="treeitem"]']=0.00/扫描`（扁平分支未进入）。→ `withdrawStale` 的 O(M×T)、`markRow`/`buildBadge`/`appendChild`、扁平分支查询在**本部署中恒不执行**。
2. **侧栏树自身的 DOM 变更**：全部 31 个相位、四种条件，`records.sidebarTree = 0`。
3. **自诱扫描循环**：`badgeAdds`/`badgeRemoves` 全程为 0（无 badge 可诱）。

### 未测到（能力/窗口限制，不得当作 0 或「无害」）
1. **title/cwd 变化的实测频率**：观测窗内 0 次（自动标题/改名未发生）→ 单次代价按构造成立，但**频率未测到**。
2. **GC / 分配压力**：`PerformanceObserver('gc')` 在本 Chrome 下**未触发**（`gc=0`）→ 通知路径 ≈580 对象/s 的 GC 代价**未测到**。
3. **`withdrawStale` 的上界**：活体不可能测量（M=0），仅有 §6.5 的推算成本模型。
4. **campaign-1 的逐通知字段分类无效**：按源形状判别的计数器把侧栏自身投影（形状 `blank+completed+id+running+…+updatedAt`）一并计入（该相位 rebuilds=74 而 sessEm=102）。**campaign-2 改用结果形状判别并做了形状普查修正**（全页只有两种 session 源投影，只有 `cwd+title` 一种属于本层，对应部署行 5431）→ 825/825 的分类结论来自修正后的仪器。
5. **`routeIdOf` 正则的原生耗时**：采样器把它记为 74.0 ms 自时间（740 样本），但正则引擎内部时间归属不确定 → 该 74 ms 是**归属不确定**的量，未据此下结论。
6. **设置面板打开的稳态**：A1/A2 每相位仅 1.5 s，样本量小（打开相位仅 3 个）→ 「设置面板打开时扫描变慢」只有方向性提示（0.755 vs 0.385 ms/s），**未达到统计置信**。

---

## 8. 逐条 PASS / FAIL / INCONCLUSIVE

| # | 条目 | 判定 | 依据 |
|---|---|---|---|
| C2-1 | 静态：`rebuildRemote`/两个索引的逐行成本与分配项 | **PASS** | §2.1，行号经字节一致性校验 |
| C2-2 | 静态：`scan`/`scheduleScan` 的可疑范围与次数（整文档 QSA=1/扫描） | **PASS** | §2.2；实测 `docQSA['[role="tree"]']`=1.00/扫描（279+55 次） |
| C2-3 | 静态：明确「rebuild 未节流、scan 已节流」的非对称 | **PASS** | 4413 vs 4403–4411 + 实测 28.7 rebuild/s vs 1.47 scan/s |
| C2-4 | 动态：扫描次数可被精确计数且归因唯一 | **PASS** | 选择器唯一性 + CDP 精确调用数 + `scanDur.n == scans`（31/31 相位，容差 0） |
| C2-5 | 动态：条件 (a) 设置面板 DOM 变化的扫描/自时间 | **PASS** | §4.3 表；74 次设置区变更下扫描侧 0.27–1.26 ms/s |
| C2-6 | 动态：条件 (b) 仅 running/updatedAt 变化的扫描/自时间 | **PASS** | 静默窗 0 DOM 变更下 1694 次 rebuild；扫描 1.19–1.35/s |
| C2-7 | 动态：条件 (c) title/cwd 变化的实测频率 | **INCONCLUSIVE** | 窗口内 0 次；单次代价按构造成立（§5） |
| C2-8 | 动态：≥3 次重复 | **PASS** | (a)(b)(c)/静默 各 3 次重复（campaign-1） |
| C2-9 | 判据：设置面板 DOM 变化**是否**增加了扫描次数 | **FAIL（原定性假设被证伪）** | 见下方专项说明；设置区变更数 0/2/18 三组的扫描率均值 2.01 / 2.36 / 2.17 次/s，无单调关系 |
| C2-10 | 判据：扫描频率与设置区变更数的相关性 | **FAIL（无相关）** | 全实验最高扫描率相位 `r1-A2-tab2-模型` = **3.287 次/s，设置区变更仅 2 次**；设置区变更最多（18 次）的 tab3 三相位为 1.92–2.62 次/s，而 0 变更的 A0_preopen 为 2.31–2.44 次/s |
| C2-11 | 判据：每次扫描 ms | **PASS** | 中位 0.2 ms / 均值 0.37 ms / p99 0.5 ms（§4.2） |
| C2-12 | 判据：活跃流下 ms/s（分层与合计） | **PASS** | 扫描侧 0.545 ms/s、rebuild 侧 ~1.18–2.0 ms/s、合计 ≈2.6 ms/s（0.26% 单核） |
| C2-13 | 判据：识别「值得修」的是未节流 rebuild | **PASS** | 94% 成本 + 100% 可移除（825/825） |
| C2-14 | 判据：整文档扫描 / 观察器过滤「收益可忽略」 | **PASS** | 3–4 µs/次 ≈ 0.01 ms/s；C2-9/C2-10 |
| C2-15 | 方案：三选一的证据裁决 | **PASS** | §6.1 采纳「只改订阅字段」 |
| C2-16 | 方案：验收标准 | **PASS** | §6.3（5 条） |
| C2-17 | 方案：回归风险（漏标/撤标）与禁止的激进改法 | **PASS** | §6.4 |
| C2-18 | 休眠路径（withdrawStale/注入）的活体成本 | **INCONCLUSIVE（不存在，不可测）** | M=0；仅 §6.5 成本模型 |
| C2-19 | GC / 分配压力 | **INCONCLUSIVE（未测到）** | `PerformanceObserver('gc')` 未触发 |
| C2-20 | 本层是否为设置页卡顿主因 | **PASS（否定，仅量级裁决）** | 本层全层 409.7 ms 采样自时间 / 189.6 s ≈ 单核 0.26%；同 bundle 单一个设置页组件 `SshWorkspaceFlow` 61.6 ms，且设置相位页面自时间由 React commit 桶主导（单相位数百 ms）。**设置页自有成本的精确归因不在本次范围**（cpu-profile 线） |

**C2-9 专项说明（本审计最重要的证伪）**：基线事实「观察器不排除设置面板 DOM 变化」在**代码层面成立**，但把它当作可优化项**不成立**。逐相位数据（campaign-1，设置区 childList 变更数 → 扫描次数/秒）：

| 设置区变更数 | 相位 | 扫描率 |
|---|---|---|
| 0 | A0_preopen ×3、A2-tab1 ×3、A3_close ×3 | 1.25–2.61（均值 2.01） |
| 2 | A1_open ×3、A2-tab2/4/5 各 ×3 | 2.05–3.29（均值 2.36） |
| 4 | A2-tab4 ×1 | 1.96 |
| **18** | **A2-tab3-插件 ×3** | **1.92–2.62（均值 2.17）** |

- **全实验最高扫描率相位（3.287 次/s）只伴随 2 次设置区变更**；变更最多的相位（18 次）反而不高于 0 变更的 pre-open 相位。
- **上界论证（比"没测出差异"更强）**：A2 的 15 个相位共 23.9 s、74 次设置区变更、51 次扫描。以 0 变更相位的 feed-only 反事实率（2.01 次/s）推算，同期"本应"发生 ≈48 次扫描 —— 实测 51 次，差值落在噪声内；即便退一步假设**每一次设置区变更都独自分派一次扫描**，其代价上界也只有 74 × 0.3 ms / 23.9 s = **0.93 ms/s**，而观测显示这个上界远未被接近。→ **设置面板 DOM 变化的扫描贡献 ≈ 0（可检测范围内）。**

原因是 feed 通知（28 次/s）持续调用 `scheduleScan`，`pendingScan` 合并 + 300 ms 最小间隔把管线**长期置于合并态**，设置面板的零星变更被完全吸收。→ **「过宽订阅」掩盖了「全树观察」的贡献**；修观察器过滤条件买不到任何东西。

---

## 9. 方法完整性与局限

- **只读性**：全部打桩为计数/包裹，未修改任何产品代码或产品状态；未点写状态按钮；未重启；未改配置。
- **单浏览器**：`probe-recon` / `probe-install` / `probe-settings` / `campaign` / `campaign2` / `probe3` 六个脚本各自 launch 一次并在 `finally` 中 close，全程无并发浏览器。
- **仪器自身开销**：`querySelectorAll` 包裹实测 **+0.267 µs/次**（3.2 vs 2.933 µs）；`MutationObserver` 回调计数在扫描度量窗之外（观察器回调和扫描的 `setTimeout` 分属不同任务），**不污染扫描 wall 测量**；样本数估计器与 delta-sum 上界并列报告，避免把 idle 间隔计入。
- **采样精度**：CDP Profiler 100 µs；对有 5438 次调用的 rebuild 侧足够，对每次 <1 ms 的扫描（279 次）偏粗 → 扫描侧改用 `setTimeout` 包裹的**精确 wall 测量**（`scanDur.n == scans` 已校验），并用 probe3 的复现体对照。
- **外推边界**：绝对量强依赖本部署规模（12 ws / 2 session / 605 元素）。rebuild 侧随会话数与通知率线性；扫描侧中 `rowTitleOf` 随分组行数线性、`withdrawStale` 随已标记行数线性（后者本部署为 0）。
- **本轮**测量期间 GUI 处于「2 个会话 + 外部 ambient 流」状态；ambient 通知率（21–33/s）高于本代理自身活动的边际贡献，故 (b) 的绝对频率应视为**该 GUI 当时的下界**。

---

## 10. 产物

| 文件 | 内容 |
|---|---|
| `audit.md` | 本报告 |
| `campaign.json` | campaign-1 原始：31 相位 × 精确调用数 / 采样自时间 / 扫描 wall / 逐区域变更 / QSA 计数 / 校准 |
| `campaign2.json` | campaign-2 原始：825 次通知的字段级分类 + 结果形状普查 + 原语单价 |
| `probe3.json` | 扫描时长分布（55 次）+ 复现体对照 + longtask |
| `campaign.mjs` `campaign2.mjs` `probe3.mjs` `probe-*.mjs` | 可复跑脚本（只读；各自单浏览器并在结束时关闭） |
| `served-client.js` | 3080 实际下发的 bundle（sha256 与部署包一致，供行号对照） |
| `recon.png` `settings-open.png` | 现场截图 |
