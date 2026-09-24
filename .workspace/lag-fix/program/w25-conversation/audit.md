# w25-conversation 审计：**对话渲染**的真实成本（长会话 / 每次按键 / markdown·高亮 / 流式与滚动交互）

- 线：`program/w25-conversation`（独占目录 `.workspace/lag-fix/program/w25-conversation/`）
- 日期：2026-09-22 · 宿主：**PID 2988915**（`node …/bin/dsh web`，19:57 冷面重启后的新宿主；旧 301709 已退出）
- GUI：`http://127.0.0.1:3080` · **全程未重启宿主、未 pkill、未改任何产品文件、未改用户 profile**
- 交付：本文件 + `raw/*.json`（原始）+ `raw/static-A-markdown-list.md`（390 行）+ `raw/static-B-scroll-input.md`（559 行）+ `tools/`（可重跑）
- 上游必读：`program/w07-streaming/audit.md`（**逐 token 整树重渲染已证伪**）、`program/w12-input-ux/audit.md`（整体选择器订阅**机制**，缺数字）、`exec-audit/BATCH-PLAN.md §五`（测量协议）

---

## 0. 口径、证据分级与**窗口有效性**（先声明，后结论）

### 0.1 证据分级（与 w07 同口径）

| 等级 | 含义 | 本报告用法 |
|---|---|---|
| **A 精确事实** | 计数/字节/代码路径（file:line），不依赖机器负载 | DOM 节点数、事件数、`RunTask` 条数、代码行号、`mutations` 计数 |
| **B 同窗比值** | **同一窗口内**两件事之比，负载约掉 | 本报告全部性能结论（LONG÷SHORT、composer÷sidebar、布局/样式比） |
| **C 跨窗外推** | 由 B 的比值 × A 的规模推出 | **仅作方向与量级，一律标"外推"** |
| **D 不可用** | 绝对 ms / ms/s / fps 基线 | 本机全程**不独占**（见 §0.3），绝对数一律 **INCONCLUSIVE** |

**本报告的性能结论只用 比值 / 同窗对照 / 剂量响应**；绝对毫秒数只作背景，不作判据（BATCH-PLAN §五）。

### 0.2 与上游两条线的接续关系（不重复劳动）

| 上游结论 | 本线如何接续 |
|---|---|
| `w07`：`assistant/chunk` 走 rAF 发布（`ui-conversation:7818-7826` → `runtime:7711` `markFrameDirty`），5 074 chunk → 11.7 flush/s，合并 **8.54×**；**"逐 token 整树重渲染"被证伪** | **不再往该方向找**。本线只测 **帧级/键级** 成本 |
| `w07` 候选 1 已**落地**（`/* w07-throttle v1 */`×4：`runtime:5732` 白名单、`:5850` 键可达性闸门、`:8024`、`:8344`）⇒ 投影驱动整树重建由 `commits÷projection 1.196 → 0.246` | 本线测量的是**落地后**的部署态；因此"投影驱动列表重建"这一 w07 成本面**已不再是对话渲染的主成本** |
| `w12`：`ConversationRoot:7159` / `ConversationSession:7403` / `InputBar:3561` 用 `useInput((s)=>s)` 整体订阅 ⇒ **每次按键重渲染整个对话区容器**（**只钉机制、无数字**）；且其 `probe-latency{,2,3}` 的 arm **全部作废**（composer `readOnly`） | 本线**取到了数字**（§2）：composer 本窗可编辑，且用**三种同窗对照**钉住量级 |

### 0.3 窗口有效性（BATCH-PLAN §五.1/2/13/17/19 逐条）

| 判据 | `probe-conv3` | `probe-conv4` |
|---|---|---|
| 探针锁（`lib/probe-lock.mjs`，`reclaimIfDead`） | **ACQUIRED**（等待 80 068 ms，另一线持有） | **ACQUIRED**（等待 1 ms） |
| 开窗前并发普查（cmdline 口径：含 `--remote-debugging` 且不含 `--type=`） | **foreign = 0** | **foreign = 0** |
| 收窗并发普查 | **foreign = 1** ⚠️ | **foreign = 1** ⚠️ |
| 窗口内周期心跳（45 s） | 4 次，**失败 0** | 4 次，**失败 0** |
| 浏览器主进程 pid 存活（起/收） | 356565 → **ALIVE** | 503823 → **ALIVE** |
| React DevTools hook 采纳自证 | `inject=1`，`onCommitFiberRoot=52`，`errors=[]` | `inject=1`，`commits=57`，`errors=[]` |
| **RunTask 阳性对照**（页内 `setTimeout` 注入 **200 ms** 忙循环） | `RunTask n=550  sum=218.2 ms  **max=200.162 ms**` | `n=1225  sum=224.0 ms  **max=200.121 ms**` |
| 阳性对照（页内注入 120 ms，LoAF + LongTask） | `LoAF d=130.0`（block 70）、`longtask=120` | `LoAF d=132.0`、`longtask=120` |
| 阴性对照（静置 1.2 s） | `longtask n=0` | `longtask n=0` |
| DPR 自证（§五.10） | `devicePixelRatio=1` | `devicePixelRatio=1` |
| 引擎/能力自证 | `HeadlessChrome/131.0.6778.33`，`hw=32`，`vis=visible`，`supported` 含 `long-animation-frame`/`longtask` | 同左 |
| 播种（§五.19：注入前 ≥1 帧起帧并保留块前那一帧） | ✅ 每臂 `arm(false)→350 ms（≈20 帧）→arm(true)→220 ms 保留→再打字/滚动` | 同左 |

> **⚠️ 必须与结论同读的两条污染声明**
> 1. **收窗时 foreign=1**：另一条审计线的浏览器在我**窗口中途**出现并存活到收窗（w07 §0 的"中途死亡/中途出现"型环境事实）。⇒ 本窗**不是独占窗**；所有**绝对**耗时含外来负载，**只有同窗比值可用**（本报告正是这么用的）。
> 2. **`RunTask` 全窗求和含背景**：这些窗里**本会话自身与 30+ 个并发子代理会话都在流式**（`session/projection` 帧持续到达）。所以 `TaskDuration`/`RunTask sum` 的**绝对值**是"打字 + 全机背景"的混合；而 LONG/SHORT 与 composer/sidebar 两类对照**都在同一背景内**，比值把背景约掉。
> 3. **`>50 ms` 帧计数只作相对 KPI**（§五.19⑤）；本报告不把它当灵敏度判据——灵敏度由**阳性对照 max=200.16 ms** 证明。

### 0.4 仪器（三件，全部可重跑）

| 仪器 | 实现 | 采到的量 |
|---|---|---|
| `tools/probe-conv.mjs` | 首版（剂量梯经侧栏搜索，搜索索引覆盖不足 ⇒ 未采到有效臂） | 通道自证（见 `raw/probe-conv.json`） |
| `tools/probe-conv2.mjs` | 加 `research-v2/react-commit/lib-init.js`（document-start DevTools hook 桩）；搜索式剂量梯**失败**（6 锚点仅 1 命中） | `raw/probe-conv2.json` |
| `tools/probe-conv3.mjs` | 树内枚举 + 斐波那契散布剂量梯；LONG 会话**运行中**（混杂对照） | `raw/probe-conv3.json` |
| **`tools/probe-conv4.mjs`（主）** | 遍历侧栏全部 **13 个 `role=treeitem` 顶层项**（含 2 个被同选择器误收的会话行）**收集到 17 个会话行**，跨组散布打开；**LONG/SHORT 均为 idle**（行文本不含"运行中"且对话区无 `role=status`） | **`raw/probe-conv4.json`** |
| `tools/analyze.mjs` | 比值/剂量律计算 | `raw/probe-conv-analysis.json` |

---

## 1. ① 长会话的渲染成本

### 1.1 **无虚拟化**（静态确证；运行时同向）

| 事实 | 证据 |
|---|---|
| 消息列表是**直出 map**，无窗口化/无 `content-visibility`/无离屏裁剪 | `ui-conversation:5851` `order.map((nodeKey) => (0, react_jsx_runtime.jsx)(ChatNodeSeat, {…}, nodeKey))`；全库 `virtual`/`overscan`/`IntersectionObserver`/`content-visibility` 在 conversation bundle **命中 0** |
| 每个 seat 是 `react.memo` 且**窄订阅自己的节点** | `ui-conversation:5480` `const ChatNodeSeat = (0, react.memo)(function ChatNodeSeat({…})`；`:5481` `const node = useSession((snapshot) => snapshot.chat.nodes.get(nodeKey));` |
| 视图容器订阅**整张 order 表**（结构性变更才换引用） | `ui-conversation:5622` `const order = useSession((s) => s.chat.order);` |

⇒ **无虚拟化的判定为 PASS（事实确证）**：会话里有 N 个业务节点，DOM 里就有 N 个 seat 行，且**永不回收**（滚动不卸载离屏行）。

### 1.2 DOM 剂量律（`raw/probe-conv4.json` → `doseLaw`）——**A 级 + B 级**

六个可达会话（全部 idle）：

| 样本 | 会话行 `flowRows` | 对话区节点 `convNodes` | 全文档节点 `docNodes` | 对话区占比 | 节点/行 | px/行 | `scrollHeight` |
|---|---|---|---|---|---|---|---|
| idx0「广工华立简历包装审查」 | 92 | 1 884 | 2 482 | **75.9%** | 20.5 | 106 | 9 775 |
| **idx1「检查工作区相关内容」（LONG）** | **98** | **2 233** | 2 831 | **78.9%** | 22.8 | 149 | **14 618** |
| idx5「检查工作区内的相关内容」 | 27 | 586 | 1 238 | 47.3% | 21.7 | 117 | 3 148 |
| **idx7「查询综测与体测班级排名」（SHORT）** | **20** | **391** | 1 043 | **37.5%** | 19.6 | 103 | 2 066 |
| idx10「/grill-me # 下一个会话交接提示」 | 102 | 1 795 | 2 521 | 71.2% | 17.6 | 95 | 9 646 |
| idx13「工程项目深度阅读与架构审计」 | 60 | 985 | 1 722 | 57.2% | 16.4 | 71 | 4 270 |

- **剂量律（B 级）**：`convNodes ≈ 16.4–22.8 节点/行`（内容相关；含工具卡的行更密）。
  ⇒ **对话区节点数随消息数近似线性增长，且对话区占全文档 37–79%**（会话越长占比越高；非对话区 chrome 恒为 **598–737 节点**）。
- **C 级外推（明确标注，不得当测量值）**：本机最大的会话（`session-6a7367fe`，**866 steps / 107 turns**）按 20 节点/行估 ≈ **1.7–2 万节点**；但**该会话在 UI 上不可达**（见 §1.4），**未实测**。

### 1.3 滚动成本（`raw/probe-conv4.json` → `scroll_LONG_r1` / `scroll_SHORT_r1`）——**B 级同窗比值**

臂动作：`[data-conversation-scroll]` 上 **24 步** `scrollTop` 扫过整段（LONG：29 px↔23 538 px；SHORT：76↔902 px），每步间隔 1 帧。

| 量 | LONG（98 行） | SHORT（20 行） | **比值** |
|---|---|---|---|
| `scrollHeight` | 24 462 px | 1 826 px | **13.4×** |
| **剂量：会话行** | 98 | 20 | **4.9×** |
| `TaskDuration` | 0.1969 s | 0.1275 s | **1.54×** |
| `ScriptDuration` | 0.0655 s | 0.0389 s | **1.68×** |
| `LayoutDuration` | 0.00097 s | 0.00061 s | 1.60× |
| `RecalcStyleDuration` | 0.0205 s | 0.0172 s | **1.19×** |
| **`LayoutCount`** | **1** | **1** | **1.00×** |
| `RecalcStyleCount` | 94 | 95 | 0.99× |
| React commits（含背景） | 20 | 14 | 1.43× |
| `RunTask max` | 11.405 ms | 11.228 ms | **1.02×** |
| 帧间隔 p50 / p99 / **>50 ms 帧** | 16.7 / 21.9 / **0** | 16.7 / 20.1 / **0** | — |
| LongTask / LoAF 条数 | **0 / 0** | **0 / 0** | — |

**判定（B 级，idle 对照）**：
- **滚动成本随消息数增长是次线性的**：剂量 **4.9×**（行）/ **13.4×**（滚动行程）⇒ `TaskDuration` 仅 **1.54×**、`ScriptDuration` **1.68×**、`RecalcStyleDuration` **1.19×**。
- **不存在"滚动引发重排风暴"**：24 次 scroll 只产生 **1 次 `Layout`**（`LayoutCount=1`，两臂相同）。⇒ 机制上，滚动是**合成器/绘制**侧动作（`RasterTask`/`Paint` 出现在 LONG 的 trace top，见 §1.5），**不是每步一次 reflow**。
- **无长任务、无掉帧**：两臂 `longtask=0`、`loafFrames=0`、`>50 ms 帧=0`、`raf p50=16.7 ms`。**通道灵敏度已由阳性对照 max=200.12 ms 证明**，故"0"是有效阴性。
- ⚠️ **混杂对照（v3）**：另一窗 LONG 会话当时**正在运行**（"2 个子代理运行中"），同一滚动臂给出 **2.61×（Task）/ 3.30×（Script）**。两窗并列说明：**v3 的放大里含"会话自身在流式"的背景**；**v4 的 idle 对照（1.5–1.7×）才是滚动的净剂量响应**。这正是"同窗对照 + 剂量变量"要求的控制方式。

### 1.4 🔴 **可达性限制（必须随 ① 的结论一起读）**

- 侧栏每个工作区分组**只渲染最近 4 行左右**（`raw/probe-conv3.json`：`dsh` 展开后 `sessionRow = 4`）；遍历侧栏全部 13 个 `role=treeitem` 顶层项**共收集到 17 个会话行**（探针按行文本回找分组容器）。
- 磁盘上 `dsh` 工作区有 **769 个未归档会话**（`session_projcache.json` 统计），其中 `session-6a7367fe` **866 steps**、**22 MB**；`Dexterous_Hand_23Dof` 有 573 个会话目录（最大 9.8 MB）。
- 侧栏搜索框**不能覆盖旧会话**：6 个锚点查询中 5 个返回 `no-results`（`子代理模型模式设置疑问` / `Adam 网关` / `对工作区内的 btw` / `dsh-session-board 做静态` / `dsh-session-board 复核`），唯一命中的是**按正文片段**命中的另一会话。
⇒ **本线能实测的最大会话是 102 行 / 14.6 k px**。**"真正长会话（数百行 / 数万节点）"的滚动与打字成本 = INCONCLUSIVE（工具不可达）**，只有按 §1.2/§2.4 剂量律做的 **C 级外推**。
**需要什么才能定**：一条能按 sessionId 打开任意会话的入口（如 URL 路由、或 `session.list` 驱动的"全部会话"视图），或写权限去改侧栏分页。

### 1.5 归因（trace top，LONG 滚动窗）

`RunTask 1681 (370.5 ms)` → `RasterTask 376 (134.9 ms)` → `v8.callFunction 450 (113.2 ms)` → `FunctionCall 450 (77.8 ms)` → `FireAnimationFrame 107 (41.7 ms)` → `Paint 20 (28.5 ms)` → `Layerize 67 (27.4 ms)` → `EventDispatch 73 (27.2 ms)`。
⇒ 滚动窗的主成本是**光栅化/绘制 + JS 回调**，`Layout` 不进场。SHORT 臂同序但 `RasterTask` **未进 top-8**（无重内容可栅格化）。

---

## 2. ② 「每次按键重渲染整个对话区容器」的**量级**

### 2.1 机制（两档独立确证，file:line）

| # | 事实 | 证据 |
|---|---|---|
| M1 | `InputBar` / `ConversationRoot` / `ConversationSession` 三处均用**整体选择器**订阅 input store | `ui-conversation:3561`、**`:7159`**、**`:7403`**：`const inputState = useInput((s) => s);` |
| M2 | `ConversationRoot` **另外**整体订阅 session / workspaces / composerBlock | `:7158` `const session = useSession((s) => s);`（+ `:7161`、`:7162`） |
| M3 | **每次 `setDraft` 必然换新对象** ⇒ `(s)=>s` 的 `Object.is` 比较**必然失败** ⇒ 不是"只在 store 整体变时触发"，而是**每键必触发** | 静态 B 档：`compose()` 用对象展开造新对象 **`ui-conversation:1447-1452`** → `set(api.setState(devFreeze(next), true))` **`runtime:5424`** → `if (!Object.is(nextState, state))` **`runtime:4747`** |
| M4 | 第二条每键通道：`ConversationSession` 另订阅 `useStore((s) => s.draft)`（返回字符串，每键必变） | **`ui-conversation:7406`**（静态 B 档实测行号） |
| M5 | 链路：`ConversationRoot → ConversationSession → ChatView`（**无 memo**，`ui-conversation:5621`）`→ order.map(ChatNodeSeat)`（`:5851`） | `ui-conversation:5621`、`:5851` |
| M6 | **兜底有效**：`ChatNodeSeat` 的 11 个 props **引用全稳**（`t` 经 `localeSeat` 缓存 `renderer:432-449`、`useSession` 经 `hookCache` `renderer:613-647`、`renderSlot` per-entry WeakMap `renderer:277-300`、inject 面 per-entry 缓存 `renderer:404-415`）⇒ **N 个 seat 全部 bail out，0 次子树渲染** | 静态 B 档 §B3/B4 |
| M7 | `ConversationRoot` 渲染体内**每次都跑** 2× `workspaces.items.find(w => w.sessionIds.includes(id))`（**无 useMemo**） | `ui-conversation:7178-7179` |

⇒ **静态机制判定：PASS（已确证）**——w12 的机制成立，且**根因不是 `(s)=>s` 的写法本身，而是 `compose()`+`replace=true` 让 snapshot 引用必变**（所以"只把选择器改精细"无效，静态 B 档已证）。

### 2.2 **量级（本线新增，B 级同窗比值）**——`raw/probe-conv4.json`

臂：聚焦 composer，`keyboard.type` **24 键**（间隔 48 ms）；LONG/SHORT **同窗交错**，两会话**均 idle**。

| 臂 | 会话行 | 对话区节点 | `TaskDuration` | `ScriptDuration` | `LayoutDuration` | `RecalcStyleDuration` | `LayoutCount` | `RecalcStyleCount` | **键→input p50 / max** | 对话区 `mutations` | `RunTask max` | 帧 p50/p99/>50ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **typing_LONG_r1** | 98 | 2 233 | 0.4495 | 0.1010 | **0.0554** | **0.1222** | 49 | 211 | **1.5 / 3.0 ms** | **0** | 20.71 | 16.6/31.1/**0** |
| typing_SHORT_r1 | 20 | 391 | 0.2824 | 0.0875 | 0.0175 | 0.0456 | 49 | 201 | 0.7 / 1.6 ms | **0** | 9.35 | 16.6/20.6/**0** |
| **typing_LONG_r2** | 98 | 2 233 | 0.4310 | 0.1234 | **0.0402** | **0.1042** | 49 | 208 | **1.3 / 2.8 ms** | **0** | 9.84 | 16.7/24.4/**0** |
| typing_SHORT_r2 | 20 | 391 | 0.2737 | 0.0985 | 0.0169 | 0.0449 | 50 | 202 | 0.7 / 1.5 ms | **0** | 6.77 | 16.6/20.3/**0** |
| **typing_LONG_r3** | 98 | 2 233 | 0.6268 | 0.1601 | **0.0604** | **0.1345** | 49 | 218 | **1.9 / 3.0 ms** | **0** | 12.61 | 16.7/27.3/**0** |
| **typing_SEARCH_ctrl**（**同会话 98 行**，打侧栏搜索框） | 98 | 2 237 | 0.2835 | 0.1024 | **0.0103** | **0.0110** | 28 | 77 | **0.6 ms** | 2（侧栏） | 6.84 | 16.7/18.5/**0** |

**三组同窗比值（`raw/probe-conv-analysis.json`）：**

| 对照 | 剂量 | `TaskDuration` | `ScriptDuration` | **`LayoutDuration`** | **`RecalcStyleDuration`** | `LayoutCount` | **键→input p50** |
|---|---|---|---|---|---|---|---|
| **r1 LONG÷SHORT（均 idle）** | 行 **4.9×** / 节点 **5.71×** | **1.59×** | 1.15× | **3.16×** | **2.68×** | 49/49 | **2.14×** |
| **r2 LONG÷SHORT（均 idle）** | 同上 | **1.57×** | 1.25× | **2.37×** | **2.32×** | 49/50 | **1.86×** |
| **r3 LONG÷SHORT（均 idle）** | 同上 | **2.29×** | 1.62× | **3.57×** | **2.99×** | 49/50 | **2.71×** |
| **composer÷侧栏搜索（同一会话 98 行，剂量 1×）** | 1× | **1.59×** | **0.99×** | **5.36×** | **11.15×** | 49/28 | **2.50×** |
| *（混杂对照 v3：LONG 运行中）* | 行 3.23× | 1.69× | 1.78× | 2.68× | 2.23× | 49/49 | 2.13× |

### 2.3 从数字能得出的**结论**（逐条给判据）

1. **量级是"每键 1–2 ms 级"，不是"卡顿级"**：24 键窗口内 `TaskDuration` LONG 中位 **0.449 s** / 24 键 ≈ **18.7 ms/键（含全机背景）**；而**每键用户可感延迟（keydown→input）p50 = 1.3–1.9 ms，max ≤ 3.0 ms**，SHORT 为 **0.7 ms**。**无任何一臂出现 >50 ms 帧、无 LongTask、无 LoAF**。
2. **"重渲染整个对话区"确实发生，但代价落在「样式重算 + 布局」而非 JS**：
   - `ScriptDuration` 只涨 **1.15–1.25×**（剂量 **4.9×** 行）⇒ **JS 侧几乎不随消息数增长**（与 M6 的"N 个 seat 全部 bail out"一致）；
   - **`LayoutDuration` 2.37–3.57×、`RecalcStyleDuration` 2.32–2.99×**，而 **`LayoutCount` 恒为 49、`RecalcStyleCount` 恒定（201–218）**。
   ⇒ **判据（B 级，最干净）**：**布局/样式重算的"次数"与消息数无关，但"每次的成本"随对话区规模放大 2.4–3.6×**。这是本项最有分量的量化结论。
3. **隔离会话容器本身（同会话、同键序、同窗）**：把同样的 24 键打进**侧栏搜索框**（不在对话区子树内），相对 composer：
   - `ScriptDuration` **0.99×**（JS 一样多）——**说明差异不在 React 协调计算量**；
   - `LayoutDuration` **5.36×**、`RecalcStyleDuration` **11.15×**、`RecalcStyleCount` 211 vs 77、`LayoutCount` 49 vs 28；
   - 键→input **2.50×**（1.5 ms vs 0.6 ms）。
   ⇒ **"每次按键重渲染整个对话区容器"的净成本 ≈ +0.9 ms/键输入延迟、+0.04 s 布局、+0.11 s 样式重算（24 键窗口）**。
4. **对话区 DOM **突变 = 0**（`mutations=0`，6 个 composer 臂全部为 0；侧栏对照为 2）**：
   ⇒ 每键引发的对话区重渲染**不写任何 DOM**（memo 全部 bail out）。**成本是"重算/重排"而非"改 DOM"**。⚠️ 边界：v4 的 `MutationObserver` 未订阅 `attributes`（v1 订阅了），所以"0"**仅覆盖 childList/characterData**；属性写入未被排除。
5. **归因（trace top，LONG 打字窗）**：`RunTask 3062 (492.8 ms)` → `EventDispatch 222 (535.7 ms)` → `v8.callFunction 1482 (266.6 ms)` → `FunctionCall 1482 (207.1 ms)` → **`UpdateLayoutTree 196 (126.9 ms)`** → `FireAnimationFrame 185 (109.5 ms)` → **`Layout 49 (57.5 ms)`**。
   与 SHORT 对照：`UpdateLayoutTree` **196 次 / 126.9 ms** vs **176 次 / 53.0 ms**（次数 1.11×，**时长 2.39×**）；`Layout` **49 次 / 57.5 ms** vs **49 次 / 21.3 ms**（**次数 1.00×，时长 2.70×**）。
   ⇒ 与 §2.3-2 完全同向：**次数不变、单次变贵**。
6. **背景不是主因（自查）**：三个 LONG 臂的 React commits 为 80/58/36，SHORT 为 58/46，侧栏对照 81 — **commits 与剂量无单调关系**（背景流式主导）。⇒ 本项结论**不建立在 commit 计数上**，只建立在 `LayoutDuration`/`RecalcStyleDuration`/键→input 的同窗比值 + **恒定的事件计数**上。

### 2.4 剂量响应与**外推边界**（明确标注）

- 观测剂量区间：**20 → 102 会话行**（**4.9–5.7×**）。
- 净剂量响应（同窗比值）：`LayoutDuration` **2.4–3.6×**、`RecalcStyleDuration` **2.3–3.0×**、`TaskDuration` **1.6–2.3×**、键→input **1.9–2.7×**、`ScriptDuration` **1.15–1.62×**。
- **次线性**：剂量 4.9× ⇒ 最贵的分量也只涨 3.6×，且 `RecalcStyleCount` 不变 ⇒ **存在明显的固定开销**（每键的 React 协调 + 一次样式/布局趟次），叠加一个随节点数的比例项。
- **C 级外推（不得当测量值）**：若比例项线性外推到 **~900 行**（本机最大会话量级），`LayoutDuration`/`RecalcStyleDuration` 可能落在 **10–20×** 现代的 98 行水平；按 2.2 的绝对值（LONG 每 24 键 ≈ 0.05 s 布局 + 0.12 s 样式）外推约为 **0.3–0.6 s / 24 键 ≈ 12–25 ms/键** 的**渲染侧**开销 —— **这已进入可感区间（>16.7 ms/键即掉帧）**。**该外推未经实测，判 INCONCLUSIVE**，需要 §1.4 的入口才能定。

### 2.5 ② 的裁决

| 命题 | 判定 | 判据 |
|---|---|---|
| 每次按键**确实**重渲染整个对话区容器（机制） | **PASS（已确证）** | §2.1 M1–M7；两档独立静态确证 |
| 该重渲染的**量级**：JS 几乎不涨，**样式/布局按节点数放大** | **PASS（B 级同窗比值）** | §2.3-2/3；`ScriptDuration 1.15×` vs `RecalcStyle 2.7–3.0×`，`LayoutCount` 恒定 |
| 该重渲染**不产生 DOM 突变** | **PASS（childList/characterData）**；attributes 未覆盖 ⇒ **部分 INCONCLUSIVE** | `mutations=0` ×6 臂 |
| 是否造成可感卡顿（当前 20–102 行） | **FAIL（命题不成立）** | 键→input p50 ≤1.9 ms、max 3.0 ms；`>50 ms 帧=0`；LongTask=0 |
| 是否在**数百行**会话上仍不卡 | **INCONCLUSIVE（工具不可达）** | §1.4；需 sessionId 直开入口 |
| `(s)=>s` 改精细选择器是否足够 | **FAIL（不足）** | 静态 B 档：`compose()`+`replace=true` 使 snapshot 引用必变（`ui-conversation:1447-1452` / `runtime:5424` / `runtime:4747`） |

---

## 3. ③ markdown / 代码块 / 语法高亮的成本与缓存

> ⚠️ **前置事实（会决定你去哪找代码）**：运行时的 markdown/高亮实现**不在任何 `node_modules` 包里**——
> `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-primitives` 是**悬空符号链接**（指向已删除的 `~/.npm/_npx/…`）。
> 真正生效的是 **`dsh-web-frontend/dist/assets/index-ClqxG24t.js`（409 KB，minify）** + `vendor-D22_Mp1f.js`（728 KB）。
> 因此**按 `@deepseek-ai/*` 包遍历会在这条线上拿到假阴性**。（静态 A 档 §0 已确证；本档 §3.2 的 shiki 证据由我独立复核。）

### 3.1 流式 markdown **是真增量**（PASS）——任务书担心的"每 chunk 全量重解析"**基本被证伪**

`MarkdownText`（`index-ClqxG24t.js:81 c61`，`R.memo`）：

```js
const C = R.useMemo(() => l /* streaming */
  ? ((d.current===null || h.current!==u) && (d.current=new Vd(u), h.current=u), d.current.render(i))
  : (d.current=null, Id(i,u,c)),
  [i,l,u,c]);
```

- 流式分支用 **`Vd`（增量渲染器）**：`Vd.render(n)` 首行 `if(n===this.lastText) return this.lastRendered;`，然后用 `this.parser.update(n)` 取 `{frozen, tail, generation}`，**把已闭合块的 React 元素缓存在 `frozenElements`**，只重建 **tail**。
- 非流式分支用 `Id`（全量解析），由 `useMemo([text, streaming, codeLabels, fileMentions])` 缓存。
⇒ **"已闭合块"的解析与元素构造各只做一次** —— 这是**已做对的缓存**。
- **残余成本**：`ad=2` 的 tail 内含**正在增长的那个块** ⇒ 该块 **每 chunk 全量重解析 O(L) + 重建 React 元素**（含每 chunk 3× 新建 `Map`、`[...frozenElements]` 拷贝）⇒ 单条长消息 **O(L²)**（静态 A 档 §A1-3/A1-6，`index:78 c5` / `:69 c2557`）。
- `fileMentions`/`codeLabels` 参与 `useMemo` deps：**若父层传入新数组/新对象，全量解析会重跑**（静态 A 档 §B2 报告 `ChatNodeSeat` 的 props 引用稳，但 `MarkdownText` 的 `fileMentions` 直接来自 `AssistantMarkdown` 的 `mentions` —— 该链路**未能在运行时确证引用稳定**）⇒ **INCONCLUSIVE**。
- **用户消息不走 markdown**：`UserMessageNodeView`（`ui-conversation:5384`）走 `projectUserText` 纯文本扫描（`ui-conversation:5332-5364`）⇒ 用户气泡**无 markdown 解析成本**。

### 3.2 语法高亮 = **Shiki，同步主线程，无按内容缓存**（我独立复核过以下各条）

| 事实 | 证据（minify 偏移，`index-ClqxG24t.js`） |
|---|---|
| 引擎 = Shiki core-sync + **`oniguruma-to-es`（纯 JS 正则）**，**非 WASM / 非 Worker**；`lazyCompileLength: Infinity` 把正则编译全部前置 | `:61 c3622` `Zf=d5({forgiving:!0,regexConstructor:n=>g5(n,{lazyCompileLength:Number.POSITIVE_INFINITY})})` |
| **启动即预热**：页面起来后 `setTimeout(…,0)` 在主线程建 highlighter 并把 **3 段样本**过一遍 tokenize | `:61 c4395` `(au=(uu=setTimeout(()=>{hr()},0)).unref)==null||au.call(uu)`；`Wf()` 内 `for(const i of Uf) n.codeToTokens(…,{tokenizeTimeLimit:0})`；`Uf=[{lang:"typescript",…},{lang:"shellscript",…},{lang:"json",…}]` |
| **随主包内置仅 3 种语言**（typescript / shellscript / json），其余 **23 种按语言动态 `import()`** | `const Ff=[v5,y5,w5]`；`Bf=new Map([["python",()=>He(()=>import("./langs/python-B6aJPvgy.js"),…)],…])`；`dist/assets/langs/*.js` **23 个 chunk**（实测目录） |
| 语言未就绪时 **返回 `undefined` ⇒ 回落纯文本 `<pre><code>`**，就绪后由 `useSyncExternalStore(Qu,Vi,Vi)` 触发重渲染再高亮 | `Qf(n,i){const l=i===void 0?void 0:Uu.get(i.toLowerCase()); if(l===void 0||!qu(l))return; return hr().codeToHtml(n,{lang:l,theme:"css-variables"})}` |
| **无全局/按（内容+语言）缓存**：唯一缓存是组件内 `useMemo(()=>Qf(d,i),[d,i,useSyncExternalStore(Qu,Vi,Vi)])` ⇒ 同段代码出现在两条消息里 = **tokenize 两次**；块被重挂载 = **冷启动** | `function Yu({code:n,lang:i,…}){const d=…;const h=R.useMemo(()=>Qf(d,i),[d,i,R.useSyncExternalStore(Qu,Vi,Vi)])…}`（`:69 c8147`，我逐字复核过） |
| **markdown 代码块没有行号、没有折叠**，整块经 `dangerouslySetInnerHTML` 一次插入 ⇒ **DOM 行数无上限** | `M = h===void 0 ? <pre className={plain}><code>{d}</code></pre> : <div dangerouslySetInnerHTML={{__html:h}} />`；`Yu` 仅产出 `infostring` + 复制按钮；**`Yu` 本身未 memo**（memo 边界在其父 `MarkdownText`） |
| **对照：工具输出 `ReadBlock`（`Jf`）反而有行号 + 折叠**，折叠态**只渲染 ≤16 行**，但 **tokenize 仍对全文执行** | `Jf({…, maxLines: c=16})`；`const C=R.useMemo(()=>qf(h,u),[h,u,…])`（`h` = **全文** join）；`S=i.length-c; T=S>0&&!m; … z(T?ie.slice(0,V):ie)`（V=8、W=8） |
| **流式期间半成品 fence 不触发高亮**（任务书假设被**证伪**） | `Md(n,i,l){… f.jsx(Yu,{code:`${n.value}\n`, **lang: l.streaming ? void 0 : c**, …}, i)}`（`:73 c1169`，我逐字复核） |
| **代价转移到"流结束"**：`streaming` 翻 false ⇒ 该消息内**每个代码块重新 tokenize**；叠加 key 空间由"字节偏移"变"下标"导致**重挂载** ⇒ 组件内 `useMemo` 冷启动 | `Md` 同上；静态 A 档 §A2 末两行（`[推断-高置信]`） |
| 公式（KaTeX）**完全无缓存**，且**流式期间不渲染**（`!l.streaming && c==="math"`） | 静态 A 档 §A1-8；`Md` 同一行 |

### 3.3 **实测：在可达会话里，代码块对 DOM 规模的贡献 ≈ 0**（A 级计数）

`raw/probe-conv4.json` 六个剂量样本的代码块专项计数：

| 样本 | 会话行 | 对话区节点 | `.md-code-block` | 块内 token `<span>` | `[data-read]`（工具输出块） | `<pre>` | `pre` 内 `span` | 代码总行数 |
|---|---|---|---|---|---|---|---|---|
| idx0 | 92 | 1 884 | 1 | **25** | **0** | 1 | 25 | 2 |
| idx1（LONG） | 98 | 2 233 | 2 | **0** | **0** | 2 | 0 | 11 |
| idx5 | 27 | 586 | 2 | 11 | 0 | 2 | 11 | 4 |
| idx7（SHORT） | 20 | 391 | **0** | 0 | 0 | 0 | 0 | 0 |
| idx10 | 102 | 1 795 | **0** | 0 | 0 | 0 | 0 | 0 |
| idx13 | 60 | 985 | **0** | 0 | 0 | 0 | 0 | 0 |

⇒ **高亮产出的 token span 最多 25 个（占对话区节点 ≤1.3%），多数会话为 0；工具输出块 0 个**。
⇒ **在样本会话里，§3.2 的理论成本几乎未被触发**（这些是中文审计会话，代码很少；且 `Qf` 在语言未就绪/语言缺失时回落纯文本）。
**判定：③ 的"理论成本"PASS（静态机制确证、含两处缓存缺口）；"实际代价"在**本样本**上**可忽略**；对**代码密集的长会话（如 866 步、22 MB 的那个）** ⇒ **INCONCLUSIVE（工具不可达 + 样本无重代码）**。**

### 3.4 ③ 的裁决

| 命题 | 判定 | 判据 |
|---|---|---|
| 流式 markdown = 逐 chunk 全量重解析 | **部分 FAIL（已证伪大半）** | 已闭合块缓存复用（`Vd.frozenElements`），只有 tail 每 chunk 重解析（§3.1） |
| 流式期间半成品 fence 每 chunk 触发全量高亮 | **FAIL（假设被证伪）** | `Md` 流式时 `lang: void 0`（`:73 c1169`，逐字复核） |
| 高亮有按（内容+语言）的缓存 | **FAIL** | 仅组件内 `useMemo`；无 Map/LRU/WeakMap；重复内容多次 tokenize；重挂载即冷 |
| 高亮异步/非阻塞 | **FAIL** | 同步主线程 `codeToHtml`/`codeToTokens`；`new Worker(` 命中 0；启动即预热 |
| markdown 代码块 DOM 无上限 | **FAIL** | 整块 `dangerouslySetInnerHTML`，无行号/折叠（`Yu`） |
| markdown 路径有 debounce/throttle/rIC | **FAIL** | 全无；唯一合并点是上游 rAF（`ui-conversation:7818-7826`） |
| 高亮在**可达样本会话**中的实测 DOM 占比 | **PASS（可忽略，≤1.3%）** | §3.3 |
| 代码密集长会话的高亮代价 | **INCONCLUSIVE** | 工具不可达（§1.4） |

---

## 4. ④ 流式期间 UI 更新 vs 用户滚动/选择

### 4.1 跟滚决策（**静态确定性结论**，file:line 已实测校正）

`ChatView` 的跟滚逻辑（`dsh-client-ui-conversation/lib/client.js`）：

```js
5685: const followSig = `${openState}:${firstSeq}:${lastKey}:${order.length}:${running ? 1 : 0}:${lastSteeringId ?? ""}`;
5686: const toBottom = (el) => { anchorRef.current = null; el.scrollTop = el.scrollHeight;
                              observedTopRef.current = el.scrollTop; atBottomRef.current = true;
                              setAtBottom(true); chatScroll.save(null); };
5741: if (appendedUser || appendedSteering || tipMoved && atBottomRef.current) toBottom(el);
5776: el.addEventListener("scroll", onScroll, { passive: true });
5782: followRef.current = () => { const local = listRef.current;
        if (local !== null && atBottomRef.current) { … el.scrollTop = el.scrollHeight; … } };
```

**关键推论链（静态 B 档已逐条给证）**：
1. **单条助手消息流式增长期间，`followSig` 恒定不变**：节点 key 稳定（`ui-conversation:7590` `key: context.key`）、text-delta **就地追加**（`:7650`）、`order` 引用被刻意保留（`:8279`）⇒ `order.length`/`lastKey` 不变 ⇒ **`tipMoved` 恒为 false** ⇒ **`5741` 的 `toBottom` 分支在流式期间根本不参与**。
2. 流式跟滚真正由 **`ResizeObserver → followRef`**（`:5789-5800`）承担，而它有 **`atBottomRef.current` 守卫**（`:5784`）。
3. ⇒ **「用户已手动上滚 ⇒ 下一个 chunk 不会把视图强行拉回底部」= 确定性 PASS。** 源码里还有**显式注释**表明这是**已修过的缺陷**：`:5675-5679` *"Flow tip signature — follow-scroll only when this moves, **never on a scroll-driven at-bottom chrome re-render (which would snap inertial scrolls the rest of the way to the floor)**."*
4. **程序滚动被回写成"用户滚动"**：靠 `observedTopRef`（写后立即对齐，`:5686-5693`）避免抖动 —— 机制成立；**副作用**：一次程序回底会走 `toBottom` 两次（`:5741` → 自己触发的 scroll 事件再进 `:5752-5755`），**幂等无害**。

**两个例外（都是 FAIL 级，但严重度低）**：
- **🔴 25 px 容差**：`isAtBottom = movedByReader ? floor - el.scrollTop <= 25 : atBottomRef.current;`（`:5751`；同阈值另一处 `:5708`）⇒ **用户向上滚动 ≤25 px 时仍被判为"在底部"，会被拽回**。这是**真实的体验级缺陷**，且**未被任何注释声明为有意**。
- **⚠️ 同帧竞态**：`atBottomRef` 只在 scroll 事件到达后才置 false，而内容增长触发的 `ResizeObserver` 回调**可能先到** ⇒ 存在"刚上滚、还没收到 scroll 事件、RO 先到 ⇒ 回底一次"的窗口。**静态无法定论 ⇒ INCONCLUSIVE（需活体流式会话实测：静态 B 档 §D-1 已给可执行探针设计）**。

### 4.2 **用户文本选择**：产品**没有任何选区保持机制**

- 全库 grep：`getSelection` / `anchorNode` **0 命中**；唯一的 `document.createRange()`（`ui-conversation:3646`）属于 **composer 输入框的 caret 镜像**（`data-input-mirror`），与对话列表无关。
- ⇒ **判定：FAIL（机制缺失，事实确证）**。精确表述：**"流式期间 DOM 更新破坏用户选区"这一后果未被任何机制防护**；**实际破坏面 INCONCLUSIVE**（未实测；静态 B 档 §D-3 给了探针设计：在 ①流式中消息 ②上一条已完结消息 ③代码块 内分别拖选并采样 `getSelection().toString().length`）。

### 4.3 流式期间的 UI 更新频率上限（对 ④ 的量化前提）

- text/reasoning delta 的 publication 显式声明 **`"animation-frame"`**（`ui-conversation:7818-7826`）→ `markFrameDirty`（`runtime:7711`、`:5669`；已排队即 return）⇒ **session snapshot 每帧最多重建+通知 1 次 ⇒ 整链重渲染 ≤60 次/秒（而非每 chunk）**。
- 与 w07 实测一致（5 074 chunk → 11.7 flush/s）。

### 4.4 其它流式交互（静态 PASS）

| 项 | 结论 | 证据 |
|---|---|---|
| 流式期间**输入不禁用** | PASS | `disabled` 判据不含 `running`（`ui-conversation:3583`）；`readOnly: machineBusy \|\| workspaceTrigger`（`:4036`）只在裁决/提交中只读 |
| 无 `scroll-behavior: smooth` | PASS | conversation bundle 命中 0（shell CSS 只有 `overscroll-behavior`）⇒ 程序滚动是瞬时跳变，不会"平滑动画打断用户" |
| 弹层在对话子树内、会随流式重渲染 | PASS（功能）/ 每帧开销待测 | `renderSlot("conversation.input.overlay", {})` **`:7240`** → `MenuView`（`input-trigger:760`，**未 memo**）；但数据走独立 uSES、`onDismiss` 稳定 ⇒ **功能不被打断** |

### 4.5 ④ 的裁决

| 命题 | 判定 | 判据 |
|---|---|---|
| "自动滚动打断用户"（流式中被拽回底部） | **PASS（无此问题）** | `:5741` 的 `tipMoved` 分支在单消息流式中恒不参与；真正跟滚的 `:5784` 有 `atBottomRef` 守卫；`:5675-5679` 注释证明这是已修缺陷 |
| 上滚 ≤25 px 仍被拽回 | **FAIL（体验级）** | `:5751` / `:5708` 的 25 px 容差 |
| 同帧 RO/scroll 竞态导致偶发回底 | **INCONCLUSIVE** | 需活体流式会话；探针设计见静态 B 档 §D-1 |
| 流式 DOM 更新破坏用户选区 | **FAIL（无机制）/ 后果 INCONCLUSIVE** | `getSelection`/`anchorNode` 全库 0 命中 |
| 流式更新频率受帧率限制 | **PASS** | `ui-conversation:7818-7826` → `runtime:7711/5669` |

---

## 5. ⑤ 前三优化候选（收益 / 风险 / 验收 / 回滚 / 热冷面）

> **预注册阈值（先立后测，禁止事后挑窗）**：
> ① `RecalcStyleDuration` 与 `LayoutDuration` 的 **composer÷sidebar 比值**由 **11.15× / 5.36×** 降到 **≤3×**；
> ② `LayoutDuration` 的 **LONG÷SHORT 比值**由 **2.4–3.6×** 降到 **≤1.5×**（剂量 4.9× 行）；
> ③ 键→input **p50** LONG 由 **1.3–1.9 ms** 降到 **≤1.0 ms**；
> ④ `ScriptDuration` **不上升**（≤现状 ×1.05）；⑤ 对话区 `mutations` **仍为 0**（不得为省渲染而少更新）；
> ⑥ 帧间隔哨兵：`raf p50 = 16.7 ms`、`>50 ms 帧 = 0`、LongTask = 0；
> ⑦ 哨兵：`session.list` 200 且顶层行齐全、`/usage` 9 路仍出数、消息列表条数与 `flowRows` 与改前一致。
> **验收必须同窗对照（before/after 各 ≥2 窗，保留全部 invalid 窗），单窗不得裁决。**

### 候选 1（**首选，最低风险**）：掐断"按键 → 对话根"的**第二条通道**，并稳住 `ConversationRoot` 的选择器引用
- **锚点（全部已核实）**：
  - `ui-conversation:7406` `ConversationSession` 的 `useStore((s) => s.draft)`（**返回字符串，每键必变**）
  - `ui-conversation:7158` `const session = useSession((s) => s);`（**整对象**）
  - `ui-conversation:1447-1452` `compose()` 对象展开 / `runtime:5424` `setState(devFreeze(next), true)` / `runtime:4747` `Object.is` 比较
  - `ui-conversation:7178-7179` 渲染体内的 2× `workspaces.items.find(...)`
- **最小实现（三步，可分别开关，独立标记 `/* w25-input-scope v1 */`）**：
  1. **把 `draft` 的消费点下沉**：`ConversationSession:7406` 的 `useStore((s)=>s.draft)` 改为**只读它真正需要的派生量**（例如 `s.draft !== ""` 的布尔，或把 draft 相关 UI 移入 `InputBar` 子树）。**这是唯一能真正断开"每键 → 对话区容器"的一步**（静态 B 档已证 M3：仅改 `(s)=>s` 的写法**无效**）。
  2. **`ConversationRoot:7158` 改窄选择器 + `useMemo`**：`useSession((s)=>s)` → 只取它实际读的字段；`:7178-7179` 的两次 `find` 包进 `useMemo([workspaces, sessionId])`。
  3. **`ChatView`（`:5621`）加 `React.memo`**：它无 memo，父层任何重渲染都会连带重跑 `order.map`（见 §2.3-2 的 O(N) 元素分配）。
- **收益（B 级预期）**：命中 §2.3-3 的**全部**差距面 —— 目标是预注册阈值 ①②③。若 `draft` 通道被彻底切断，对话区容器在打字期间**应完全不再重渲染**，`LayoutDuration`/`RecalcStyleDuration` 的 composer÷sidebar 比值应向 **1×** 收敛。
- **风险**：① 第 1 步需要确认 `draft` 在 `ConversationSession` 层只用于**可见性/高度**判定，否则会丢功能（**必须逐行读该组件的 `draft` 用途**）；② 窄选择器若漏字段 ⇒ 某处不更新（验收 ⑦ 的 `flowRows`/文案哨兵必须覆盖）；③ `ChatView` 加 memo 需保证其 props（`renderSlot`/`useSession`/`t` 等）引用稳定 —— 静态 A 档已证这些**引用稳**（`renderer:277-300/432-449/613-647`），故风险低。
- **回滚**：三处独立、单文件（`dsh-client-ui-conversation/lib/client.js`）→ pre-image 单文件回滚；独立标记便于定点撤销。
- **生效面**：**热面（刷新即生效）**。

### 候选 2：把 25 px 的"贴底容差"与 `scrollPosition` 的全量兜底路径收紧（滚动侧）
- **锚点**：`ui-conversation:5751`（`floor - el.scrollTop <= 25`）、`:5708`（另一处 25）、`:5559-5563`（`pagingAnchor` 兜底 `[...list.querySelectorAll("[data-chat-anchor-key]")]` + 每行 `getBoundingClientRect()`）、`:5534` `flowTop`（2 次 rect）、`:5529` `anchorElement`（全量扫）。
- **最小实现**：① 容差由**常量 25 px** 改为**与行高/滚动速度相关的判据**（或至少在收到 `wheel`/`keydown`(PageUp/Down/Arrow) 后**立即**置 `atBottomRef=false`，不等 scroll 事件）；② `pagingAnchor` 的兜底全表扫描改为**只在 `elementsFromPoint` 不可用时才走**，并加**行数上限/二分定位**（`data-chat-anchor-key` 行本身有稳定 key，可二分）。
- **收益（B 级预期）**：修掉 §4.1 的 25 px FAIL 与 §4.1 的竞态窗口；滚动侧 `ScriptDuration` 的兜底路径（LONG 滚动窗 `v8.callFunction 113 ms`）在**非底部**拖拽时应下降（本窗是程序滚动、恰好每次都命中 `atBottom` 分支，**未采到兜底路径的成本** ⇒ 收益**未量化**）。
- **风险**：**低**（纯局部判据）。风险点：容差收紧会让"差几像素到底"的用户不再自动跟滚 —— 需要 product 裁决"多大算到底"。
- **生效面**：**热面**。
- **验收**：① 流式中上滚 **≤25 px** 后不再被拽回（当前 FAIL）；② 上滚 >25 px 行为不变（回归）；③ 滚动窗 `>50 ms 帧 = 0` 保持；④ `LayoutCount` 不上升。

### 候选 3：给 `ReadBlock`/markdown 代码块补**共享缓存 + 渲染上限**（③ 的收尾，收益范围窄）
- **锚点**：`Yu`（`index-ClqxG24t.js:69 c8147`，markdown 代码块，**无行号/无折叠/无上限**）、`Jf`（同文件，`ReadBlock`，有 16 行上限但**对全文 tokenize**）、`Qf`（`:61 c4455`）、`qf`（`:61 c4600`）、语言加载 `qu`（`:61 c4188`）。
- **最小实现**：① 给 `Qf`/`qf` 加**模块级 `Map` 缓存**，键 = `${lang}\u0000${code 的短哈希}`（**内容哈希，不是 NaN 风险的全串**），并设 LRU 上限（例如 200 条）；② `Yu` 加**与 `ReadBlock` 同形的折叠**（默认渲染 ≤16 行），使 DOM 与 tokenize 都受限；③ **流结束的那次爆发**改为**`requestIdleCallback`/分帧**执行（`Yu` 现在在流结束一次性 tokenize 该消息全部代码块）。
- **收益（A 级已测边界）**：**在可达样本会话里收益 ≈ 0**（§3.3：token span ≤25、多数 0）⇒ **本线实测不支持"高优先"**。它是**针对代码密集长会话的保险**，收益**未被实测**（工具不可达）。
- **风险**：① 加缓存需保证**语言就绪后缓存失效**（否则永久纯文本）—— 现有 `useSyncExternalStore(Qu,Vi,Vi)` 机制要保留；② 改 `Yu` 的 DOM 结构会影响**代码复制按钮**（它读 `querySelector("pre").textContent`，折叠后**只会复制可见行** ⇒ **这是真风险，必须一并改**）。
- **回滚**：单文件（primitives 打进 `index-*.js`）⇒ **需重建 web 产物且刷新**。
- **生效面**：**热面但跨包**（须动源码仓 + 重建 `dsh-web-frontend/dist`）。

### 明确**不做**（并给理由）
- **不做**"逐 token 节流/合批"：已被 w07 **证伪**（`assistant/chunk` 已走 rAF，合并 8.54×）。
- **不做**给对话区加**虚拟化**（本项 ① 的最大结构性缺口）：**本线无收益证据**——20–102 行区间内**滚动与打字都不产生长任务、不掉帧**（§1.3/§2.3），且虚拟化会与**原生态滚动锚定/`atBottom` 语义/`chatScroll` 位置持久化**强耦合（`:5686-5800`），风险远大于可证收益。**先修候选 1，再用 §1.4 的入口对数百行会话复测**；只有那时"虚拟化"才值得评估。
- **不做** `ThemePresenter.apply` 相关（`w07` 实测它是同窗第一成本项 8.5–15%）—— 属另一批，本线范围外。
- **不做**改动 `session/projection` 链路：`/* w07-throttle v1 */` 已落地（`commits÷projection 1.196 → 0.246`），本线在其之后测量。

---

## 6. 逐条 PASS / FAIL / INCONCLUSIVE

| # | 项 | 判定 | 依据 |
|---|---|---|---|
| **① -1** | 消息列表**无虚拟化**（DOM 随消息数线性、离屏不回收） | **PASS（事实确证）** | `ui-conversation:5851`；`virtual`/`overscan`/`IntersectionObserver` 命中 0 |
| **① -2** | DOM 剂量律：`convNodes ≈ 16.4–22.8 节点/行`，对话区占全文档 **37–79%** | **PASS（A 级计数）** | §1.2（6 样本） |
| **① -3** | 滚动成本随消息数**次线性**增长（4.9× 剂量 ⇒ Task 1.54×、Script 1.68×、Recalc 1.19×） | **PASS（B 级同窗比值）** | `raw/probe-conv4.json` `scroll_*` |
| **① -4** | 滚动**不引发重排风暴**（24 步扫描 → `LayoutCount = 1`） | **PASS（A 级计数）** | 同上 |
| **① -5** | 滚动/打字期间**无长任务、无掉帧**（98 行 / 24 k px 窗） | **PASS（阴性有效：阳性对照 max=200.12 ms）** | §1.3、§2.2 |
| **① -6** | **数百行会话**（本机最大 866 steps）的滚动/打字成本 | **INCONCLUSIVE（工具不可达）** | §1.4；侧栏只暴露每组 ~4 行，搜索覆盖不到旧会话 |
| **② -1** | 每次按键**重渲染整个对话区容器**（机制） | **PASS（已确证）** | §2.1 M1–M7（`ui-conversation:3561/7158/7159/7403/7406`、`1447-1452`、`runtime:5424/4747`） |
| **② -2** | 该重渲染的**量级**：JS 几乎不随规模增长，**样式/布局按节点数放大** | **PASS（B 级）** | `Script 1.15–1.25×` vs `RecalcStyle 2.32–2.68×`、`Layout 2.37–3.16×`（剂量 4.9×）；`LayoutCount` 恒 49 |
| **② -3** | 隔离会话容器：composer÷侧栏搜索（**同会话 98 行**） | **PASS（B 级）** | `RecalcStyle 11.15×`、`Layout 5.36×`、键→input **2.50×**、`Script 0.99×` |
| **② -4** | 每键对话区 **DOM 突变 = 0** | **PASS（限 childList/characterData）**；attributes 未观测 ⇒ **部分 INCONCLUSIVE** | 6 臂 `mutations=0`（侧栏对照 = 2） |
| **② -5** | 当前规模下是否**可感卡顿** | **FAIL（命题不成立）** | 键→input p50 ≤1.9 ms / max 3.0 ms；`>50 ms 帧 = 0`；LongTask = 0 |
| **② -6** | "只把 `(s)=>s` 改精细选择器"是否足够 | **FAIL（不足）** | `compose()`+`replace=true` ⇒ snapshot 引用必变（`ui-conversation:1447-1452` / `runtime:5424` / `runtime:4747`） |
| **② -7** | **数百行**会话上是否仍不卡 | **INCONCLUSIVE** | §2.4 外推 + §1.4 |
| **③ -1** | 流式 markdown 是否**每 chunk 全量重解析** | **部分 FAIL（大半被证伪）** | `Vd` 增量渲染器缓存 `frozenElements`，只 tail 重解析（`index:81 c61` / `:69 c2557`） |
| **③ -2** | 流式半成品 fence 每 chunk 触发全量高亮 | **FAIL（假设被证伪）** | `lang: l.streaming ? void 0 : c`（`index:73 c1169`，逐字复核） |
| **③ -3** | 高亮有按（内容+语言）缓存 | **FAIL** | 仅组件内 `useMemo`；无 Map/LRU/WeakMap（`index:69 c8147`） |
| **③ -4** | 高亮同步主线程 / 无 Worker / 启动预热 | **FAIL（事实确证）** | `Zf=d5({regexConstructor:…lazyCompileLength:Infinity})`；`setTimeout(()=>{hr()},0)`；`new Worker(` 命中 0 |
| **③ -5** | markdown 代码块 DOM 无上限（无行号/无折叠） | **FAIL** | `Yu` 整块 `dangerouslySetInnerHTML`；对照 `ReadBlock` 有 16 行上限 |
| **③ -6** | markdown 路径有 debounce/throttle/rIC | **FAIL** | 全无；唯一合并点是上游 rAF（`ui-conversation:7818-7826`） |
| **③ -7** | 高亮在**可达样本**中的实测 DOM 占比 | **PASS（可忽略）** | token span ≤25（≤1.3% 节点），多数会话为 0（§3.3） |
| **③ -8** | 代码密集长会话的高亮代价 | **INCONCLUSIVE** | 样本无重代码 + 工具不可达 |
| **④ -1** | 流式中用户已上滚 ⇒ **不被拽回底部** | **PASS（确定性）** | `:5741` 的 `tipMoved` 在单消息流式中恒 false；`:5784` 有 `atBottomRef` 守卫；`:5675-5679` 注释证明为已修缺陷 |
| **④ -2** | 上滚 **≤25 px** 仍被拽回 | **FAIL（体验级）** | `:5751`、`:5708` |
| **④ -3** | RO/scroll 同帧竞态导致偶发回底 | **INCONCLUSIVE** | 需活体流式会话（探针设计：静态 B 档 §D-1） |
| **④ -4** | 流式 DOM 更新破坏用户选区 | **FAIL（无机制）**；后果 **INCONCLUSIVE** | `getSelection`/`anchorNode` 全库 0 命中 |
| **④ -5** | 流式更新频率受帧率限制（≤60/s） | **PASS** | `ui-conversation:7818-7826` → `runtime:7711/5669`；w07 实测 11.7 flush/s |
| **④ -6** | 无 `scroll-behavior: smooth`、流式不禁用输入 | **PASS** | `ui-conversation:3583`/`:4036`；bundle `smooth` 命中 0 |
| **⑤** | 候选是否达标 | **未执行**（本审计只给候选与预注册阈值） | §5 |

---

## 7. 证据清单（全部可重跑）

| 文件 | 内容 |
|---|---|
| `raw/probe-conv4.json` | **主数据**：13 个树顶层项 / **17 个会话行**的剂量梯；8 臂（打字 ×5、滚动 ×2、侧栏对照 ×1）；trace top；心跳；普查；hook 自证 |
| `raw/probe-conv3.json` | 第二窗（LONG **运行中**，作混杂对照）；同 8 臂 |
| `raw/probe-conv2.json` | hook 桩接入 + 搜索式剂量梯**失败**记录（留档，证明"侧栏搜索覆盖不到旧会话"） |
| `raw/probe-conv.json` | 首版通道自证（`RunTask max=200.29 ms`、LoAF 120、阳性/阴性） |
| `raw/probe-conv-analysis.json` | 由 `tools/analyze.mjs` 生成的全部**同窗比值**与剂量律 |
| `raw/probe-conv{2,3,4}.log.txt` / `out/probe-conv*.run.txt` | 探针逐行日志 |
| `raw/static-A-markdown-list.md`（390 行） | 静态档 A：markdown / 代码块 / 高亮 / 列表 / 滚动的逐条 `file:line` + 原文片段（含 primitives 悬空软链的前置发现） |
| `raw/static-B-scroll-input.md`（559 行） | 静态档 B：跟滚决策链 / `atBottomRef` 语义 / 选区 / 每键重渲染链 / memo 边界逐项判定 |
| `tools/probe-conv{,2,3,4}.mjs`、`tools/analyze.mjs` | 全部探针与分析器 |
| `lib/probe-lock.mjs`（共享） | 锁（存活判据 = `/proc/<pid>` + `stat` + `cmdline`，**任何读取失败一律假定存活**） |

### 复跑方式（约 6–8 分钟/窗）

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/program/w25-conversation
node tools/probe-conv4.mjs > out/probe-conv4.run.txt 2>&1     # 主探针（自带锁/普查/心跳/阳性对照）
node tools/analyze.mjs                                        # 生成 raw/probe-conv-analysis.json
```

> 探针自带：`SIGINT/SIGTERM/SIGHUP` 与 `uncaughtException` 收尾（关浏览器 + 释放锁，**绝不留孤儿**）、
> 每阶段落盘（中途被杀也有部分 JSON）、45 s 心跳、开窗前/收窗后各一次 cmdline 普查。

### 复跑时**必须避开**的三个坑（本线踩过，已修）

1. **`browser.process()` 不存在**（Playwright 的 `Browser` 不暴露进程）⇒ 用**普查差集**定浏览器 pid（首版探针因此崩在启动后 0.1 s）。
2. **`Tracing` 的事件载荷是对象不是 JSON 字符串** ⇒ `cdp.on('Tracing.dataCollected', p => EV.push(...(p.value||[])))`；并**必须**带类别 `disabled-by-default-devtools.timeline`（否则 `RunTask` 条数 = 0）。
3. **侧栏分组只渲染最近几行**（本机每工作区 ~4 行）⇒ 剂量梯必须**遍历全部分组**收集行，不能只展开 `dsh`；且**搜索框覆盖不到旧会话**。

---

## 8. 局限与未决（诚实清单）

1. **无独占窗**：三窗收窗普查均见 `foreign=1`（他线浏览器在窗口中途出现）。⇒ **绝对耗时全部不可用**；本报告只用同窗比值 + 恒定事件计数（`LayoutCount`/`RecalcStyleCount`）作判据。
2. **背景负载无法归零**：本会话自身 + 30 余个并发子代理会话持续产生 `session/projection`/`session/event` 帧 ⇒ `TaskDuration`/`RunTask sum` 的绝对值是混合量；**LONG÷SHORT 与 composer÷sidebar 两类比值都建立在同一背景上**。
3. **剂量上界只有 102 行**：真正长会话（数百行 / 上万节点）**在 UI 上不可达**。⇒ ① 的"长会话"部分与 ② 的外推部分、③ 的代码密集部分，均标 **INCONCLUSIVE** 并给 C 级外推。**需要**：按 sessionId 直开会话的入口（URL 路由或"全部会话"视图）。
4. **`MutationObserver` 未订阅 `attributes`**（v4）⇒ "对话区突变 = 0" 只覆盖 childList/characterData；**属性写入未排除**。
5. **`RecalcStyle`/`Layout` 放大的**精确失效源**未定位**：已确证"次数不变、单次变贵"，但**究竟是哪条样式失效（`:has()` 选择器？CSS 变量？textarea 镜像 caret 逻辑 `ui-conversation:3643-3670`？）** 未做**逐帧失效追踪**（需 `CSS.invalidations` trace 或 `PerformanceObserver` + `chrome://tracing` 的 style-invalidator）。⇒ **INCONCLUSIVE**。
6. **`MarkdownText` 的 `fileMentions` 引用稳定性**未运行时确证 ⇒ "全量 markdown 解析是否被无关重渲染触发"为 **INCONCLUSIVE**。
7. **静态档的行号口径**：任务书给的行号与部署 bundle 有 **+8…+47 的不固定偏移**（静态 B 档实测校正）。本报告一律用**实测行号 + 原文片段**；`§2.1` 的 M1–M7 已由我在部署文件上**逐条 grep 复核**（`3561/7158/7159/7403/7406/5481/5622/5685/5686/5741/5776/5782/5851`）。
8. **未覆盖**：`dsh-client-ui-trajectory`（7 370 行，另有 3 处 markdown 渲染 + **独立 scroll 监听 `:1252`**）、各工具卡的逐元素量级（`dsh-client-ui-tool`）、`dsh-client-ui-workflow-run`（也向 `target:"chat"` 注册节点）。**这些都可能改变 ① 的"节点/行"剂量律**。
9. **仪器口径声明（避开一个已知陷阱）**：本机 `[data-slot="…"]` 运行时多为 `display:contents`（**可见面积恒为 0`**）。本线**没有**用 `[data-slot]` 元素的**可见面积**做任何判据：`[data-slot="conversation.session"]` 仅作**DOM 子树作用域选择器**（`getElementsByTagName("*")` 计数、`MutationObserver` 作用域），`display:contents` 不影响这两者；对话区是否"真的在渲染"由**`[data-chat-flow-key]` 行数 > 0** 这一**结构性**判据自证（每臂都记录 `flowRows`）。
