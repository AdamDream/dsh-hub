# btw 侧聊面板 vs subagent 会话界面 — UI 差距审计（只读调研）

调研日期：2026-09-12。路由：adam/deepseek-v4-flash。
范围：btw 面板渲染管线（dsh-btw/src/client/*）对照官方 GUI 会话渲染管线（全局安装 `~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/` 下 `dsh-client-ui-conversation` / `dsh-client-ui-tool` / `dsh-client-ui-subagent` / `dsh-client-runtime` / `dsh-client-modules` / `dsh-client-ui-primitives` / `dsh-client-ui-slots`；btw 仓库内 `dsh-btw/node_modules/@deepseek-ai/` 下的对应包为同一源码的同构副本）。
约束遵守：全部基于真实代码；不确定处标注「未确认」；未改动任何代码。

---

## ① btw 当前呈现（逐项，文件:行号）

路径前缀 `BTW=~/dsh/dsh-btw/src/client`（未标注的为 `BTW/SideChatSurface.tsx`）。

### 1.1 面板载体（两种呈现模式，同一 Surface）
- `presentation.tsx:42-90` `BetterSidebarSideChat`：以 tab 形式寄生官方 Better Sidebar（`dsh-better-sidebar` 的 `registerTab`），Surface 渲染进 tab 组件位；`presentation.tsx:148-208` 注册 tab 描述符（badge：error→`!`，running→`…`，:200-206）。
- `SideChatDrawer.tsx:56-90`：自绘浮动抽屉（`side-chat.module.css` `.placementRoot/.drawer`），内含 `SideChatJumpList` + `SideChatSurface`；两种模式共用同一个 `SideChatSurface`（`view-store.ts:9` `SideChatPresentationMode = 'drawer' | 'better-sidebar'`）。
- 挂载方式：`client/index.ts:37-74` — btw 已作为**官方 slot 注册者**：`conversation.session.header.actions`（SideChatButton）与 `shell.overlay`（SideChatDrawer），带 `locale: NS` 与 `inject` face。

### 1.2 会话头部（自绘，非官方 SessionHeader）
- `:343-389` header：标题 + "READ ONLY" 徽标（`locales.ts:25`）+ 模型下拉（`deepseek-v4-flash / glm-5.3 / deepseek-v4-pro`，:355-368）+ 结束/最小化按钮。
- `:391-395` 父会话（主任务）状态条：一个 6px 圆点（`running` 时变绿 #b7e85b + 光晕），`side-chat.module.css:183-185`。

### 1.3 transcript 消息渲染（自绘简化版）
- 数据源：控制器轮询 host RPC `readSideChat`，flat 模型 `SideChatTranscriptMessage = { id, role:'user'|'assistant', text, images? }`（`shared/remote.ts:70-73`）+ `partial` / `reasoning` 字符串（:122-124）。
- 渲染循环 `:415-443`：
  - 用户消息 `:416-420`：`<p>{message.text}</p>` 纯文本（`white-space: pre-wrap`，`side-chat.module.css:221`），右侧气泡（`.userMessage` :219：圆角 12/12/3/12 + 半透明底）。
  - 助手消息 `:418-420`：`<MarkdownText text={message.text} />`（来自官方 primitives），左侧细绿左边框（`.assistantMessage` :220-221）。
  - 角色标签 `:417`：`.messageMeta`（`side-chat.module.css:222`，10px 代码字体灰字，"You / Side assistant"）。
- 思考（reasoning）`:444-449`：**纯文本 `<p>{reasoning}</p>`**，无折叠、无 "Think" 样式。
- 流式 partial `:450-455`：`<MarkdownText text={partial} streaming />` — 与官方同一渲染器、同一 `streaming` 渐进 GFM 语义（primitives `index.js:5609-5632` StreamingRenderer）；但**无运行横幅、无秒表、无打字机光标**（官方也无光标，见 ②）。
- 图片块 `:421-441`：消息内 `images[]` 缩略图（84×84，`side-chat.module.css:378-382`）+ 点击打开 `Modal` lightbox（:530-543）；fetch 缓存于 `imageCache`（:191-228）。
- 空态/错误态 `:398-414`；问答卡（ask-back）`:54-167`（自绘，非官方 ApprovalPanel 风格）。
- 无工具调用块、无 token/耗时元数据、无 agent 名/模型徽标、无引用标签、无 turn 边界、无重试链/命令行/compaction 标记。

### 1.4 composer（自绘）
- `:462-528`：textarea + 发送/停止按钮（`IconSendOutline16`/`IconStopFill16`）、粘贴图片附件轨（:465-483，`view-store.ts:1-7`）、错误条、Shift+Enter 提示。
- 与官方 InputBar（命令菜单/模型位/附件槽/权限条/上下文表）完全不同源。

### 1.5 跳转列表（btw 特有，官方无对应物）
- `SideChatJumpList.tsx:96-166`：可折叠两 tab（本会话树 / 项目全部），条目含标题/相对时间/running 标记/预览截断；数据来自 host `listTree`/`listProject`（`host/side-chat-service.ts:980-1031`）。

### 1.6 host 侧聚合（决定 btw 只能拿到什么）
- `host/side-chat-service.ts:346-420` `transcript()`：只消费 `user/message`、`assistant/chunk`、`assistant/message`、`tool/call`；**`tool/result` 与参数/结果全部丢弃**（:215-218 注释明示 "tool/result events…never read"），`tool/call` 仅取 name 作 `runningTool`（:385）；reasoning 只聚合未终结 step 的 `reasoning-delta` 纯文本。
- 侧聊子会话是真实 host agent session，但**不进正常会话目录**（`host/btw-registry.ts:7-13`："child stays out of both the normal session directory and the subagent directory"），因此客户端 `ctx.sessions` 里没有它的 binding，无 `ConversationSnapshot`。

---

## ② subagent 会话界面（官方 GUI）逐组件（文件:行号）

路径前缀 `D=~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai`。subagent 会话本身是一个普通 DSH 会话（`origin:'subagent'`，`runtime/types/client/sessions/service.d.ts:44`），其 transcript 走**与主会话完全相同的会话渲染管线**；"子代理输出"即该会话日志里的 assistant/tool/命令节点。

### 2.1 会话数据模型（官方 vs btw 的根本差异）
- `runtime/types/client/sessions/conversation.d.ts:371-421` `ConversationSnapshot`：`chat`（ChatSnapshot :359-365：`order`/`nodes`/`locations`/`timeline`）、`nodes`、`turnTimings`、`partial`、`runningCalls`、`queue`、`subagent`（:396-399）、`composerPhase`、`blank` 等。
- `AssistantBlock`（:30-47）：`text | reasoning | image | tool-call | other`；`AssistantMessageNode`（:79-102）：`blocks`/`usage`/`provenance`（provider+model :24-27）/`requestConfig`/`timing`（TTFT :70-77）/`interrupted`。
- `ToolCallBlock = RunningToolCall | ToolResultNode`（:280；:266-278/:165-191）：递归 `subCalls`、`callView`/`resultView` 渲染意图、`isError`。
- 节点种类：`ChatNodeDataMap`（`conversation/types/client/contract/chat-nodes.d.ts:3-53`）：`assistant-step`、`tool-call`、`command`、`manual-compaction`、`compaction`、`model-retry`、`turn-error`、`turn-max-tokens`、`turn-tail`、`unknown` + `user/steering/context`（`chat/MessageItem.d.ts:9-27`）。

### 2.2 渲染组件链
- `ChatView`（`conversation/lib/client.js:5621`）：按 `chat.order` 逐节点渲染，每个节点经 `ChatNodeSeat`。
- `ChatNodeSeat`（:5480-5521）：按 `node.kind` 作 `renderSlot("conversation.chat.node", {…, node}, { entryKey: node.kind, hookContext: nodeKey })` 键式分发；未注册 kind 落 `JsonBlock` fallback（:5514-5518）。
- 注册表 `registerChatNodeRenderers`（:9760-9835）：`user/steering→UserMessageNodeView`、`context→ContextMessageNodeView`、`assistant-step→AssistantNodeView`、`command→CommandNodeView`（子 slot `conversation.chat.commandview`）、`tool-call→ToolCallTree`（ui-tool 注册）、`turn-tail→TurnTailNodeView`、retry/error/max-tokens/compaction/unknown 各一。
- 消息气泡：
  - 用户/steering：`UserStyleBubble`（:5332-5362，右侧气泡 + 时间 + copy），`UserMessageNodeView`（:5384-5399）。
  - 助手：`AssistantNodeView`（:9526-9553）→ `AssistantMarkdown`（:9461-9522）：text 块 → `MarkdownText`（含 `streaming` 渐进解析、`fileMentions`）；reasoning 块 → `ReasoningRow`；image 块 → `renderMessageImages`（官方 attachment 画廊）；tool-call 块**跳过**（:9503，由独立 tool 节点呈现）；`interrupted` 追加「已停止」标记（:9516-9519）。
  - `ReasoningRow`（:9389-9440）：**"Think" DisclosureRow 折叠**（icon + 首行摘要 + 展开全文，streaming 时跟随末行），这是官方 reasoning 呈现，btw 无。
- 流式/运行指示：
  - `TurnStatus`（:5591-5616）：运行中 turn 顶部 "Deep diving..." 渐变 shimmer 横幅 + ≥15s 后秒表（`ChatView.module.css .turnStatus` 动画，:5452）。
  - MarkdownText `streaming`：增量 GFM 渲染器（primitives `index.js:5609-5632`），无可见光标；官方与 btw 同款。
- 工具调用块（**官方核心差距点**）：
  - `ToolCallTree`（`ui-tool/lib/client.js:961` 起；`ToolCall`/`ToolCallBranch` :893-961）：递归子调用（缩进 + 左边线 `.subCalls`）。
  - `ToolRow`（:689-839）：DisclosureRow 行 = 图标 + 函数名 + 折叠摘要；展开显示 `IN`/`OUT` 段（args/result，:790-818）；`data-state` = running/stopped/error/ok（:184），running 行有 sweep 动画（CSS :627）。
  - `GenericToolCard`（:840-869）+ 各 toolview 模型（`read/diff/search/terminal/web` 卡，`tool/types/client/tool/toolviews/*.d.ts`）；按 wire tool 名键式分派 `tool.call.toolview`。
  - 工具细节面板 `conversation.details.tool`（`contract/slots.d.ts:187-191`）。
- 元数据：
  - 每条已定稿助手消息的 turn 尾 `TurnTailNodeView`（:9715-9753）：`runMs`（turn 起止 :9730）+ `MessageIconActions`（:5038-5139）渲染 **时间 / ran-for / TTFT / tokens/s** + copy + branch。
  - 会话级统计条 `StatsLine`（:2972-3033）：turn/step 数、LLM/工具耗时、平均 TTFT、tokens/s、**input/output token 数**、缓存命中率（数据来自 `tokenUsage`/`sessionStats` projection，`chat/StatsLine.d.ts:33-53` 格式化函数）。
- 状态徽标：
  - 运行态：会话侧栏行 + ChatView `TurnStatus` + header；子代理目录徽标：`SubagentHeaderLineage`（`ui-subagent/lib/types/client/SubagentHeaderLineage.d.ts:17`）经 `CatalogDropdown`（`ui-subagent/lib/client.js:394+`）显示**后代计数 + running 计数**（`indexSubagentDescendants`，`runtime/types/client/sessions/subagent-lineage.d.ts`）。
  - agent 名/模型：会话标题/面包屑（`ConversationSessionHeader` :7321-7391，subagent 会话 crumb 带 `crumbSubagent` 样式 :7342）；模型选择器在 composer `conversation.input.model` 位（:4097）；每条消息的 `provenance`（provider/model）字段存在但**未在 transcript 中直接展示**。
  - `delegationDepth`：**未确认** — 全量检索官方 client 包未发现该字段/徽标（只有列表缩进的 `lineage.depth`，`runtime/types/client/sessions/lineage.d.ts:31`）。
- 骨架/会话体：`ConversationRoot`（:7154）、`ConversationSession`（:7398-7426，view 环 + 草稿镜像）、`DetailsPanel`、`ApprovalPanel`（:6031-6117）、InputBar、QueueDock、TodoPanel 等。

### 2.3 结论性差异
官方 = 节点化（事件→定义→节点→键式渲染器）+ 工具卡 + Think 折叠 + turn 尾指标 + 统计条 + 运行横幅；btw = flat 文本气泡 + 图片缩略 + 无工具/无指标/无折叠。两者**不是同款渲染**；btw 是自绘简化版，仅共用 `MarkdownText` 等 primitives 原语。

---

## ③ 差距清单（btw 缺什么 → 官方有）

| # | 差距项 | 官方参照 | btw 现状 |
|---|---|---|---|
| 1 | 工具调用块（函数名/参数 IN/结果 OUT/折叠/运行态/子调用树） | ui-tool ToolCallTree/ToolRow | 完全缺失（host 已丢弃 tool/result 数据） |
| 2 | 思考（reasoning）折叠呈现 | ReasoningRow "Think" DisclosureRow | 纯文本段落，无折叠无图标 |
| 3 | 运行指示 | TurnStatus 渐变横幅 + 秒表；assistant 节点 streaming 语义 | 仅无样式 partial 文本块；无秒表 |
| 4 | 消息元数据（时间/耗时/TTFT/tokens·s⁻¹） | MessageIconActions + TurnTailNodeView | 无 |
| 5 | 会话级 token/耗时统计条 | StatsLine（projection 驱动） | 无 |
| 6 | 状态徽标（agent 名/模型/运行态/后代数） | 面包屑 + crumbSubagent + SubagentHeaderLineage 目录 | 仅头部主任务绿点 + 模型下拉 |
| 7 | 用户气泡细节（时间/copy/引用标签） | UserStyleBubble + MessageIconActions + referenceLabels | 纯文本无动作行 |
| 8 | turn 边界/重试链/命令行/compaction 标记/上下文注入行 | Retry/Command/Compaction/Context 节点 | 无（flat 列表） |
| 9 | 未知块/其他块 fallback | JsonBlock fallback（ChatNodeSeat :5514-5518） | 无 |
| 10 | 断点续读/分页（hasMore/loadOlder/滚动锚点） | ChatView 滚动记忆 + 分页 | 无 |
| 11 | 附件/图片官方画廊 | `conversation.message.images` 槽（attachment 插件） | 自绘缩略图 + lightbox（功能可用，风格不同） |
| 12 | delegationDepth 徽标 | 官方当前**不存在**（未确认） | —（对齐目标不应包含） |

---

## ④ 跨插件复用可行性（能否 import 官方渲染组件 — 机制证据）

### 4.1 模块解析边界：运行时可以 require 官方包，但取不到组件
- 浏览器端统一走 `window.__ModuleLoader__`（lazy-CJS 模块表）：`ClientModuleSystem.makeRequire`（`dsh-client-modules/lib/client.js:251-261`）同步 require 只命中 seed（react 等）/已物化记录/已注册 factory，未命中**直接抛错**；异步拉取仅经 `import()`/`arriveGraphRow`（:262-271，:210-221 按 manifest 行的 `external` 依赖先到先得）。
- btw 的构建已把全部 `@deepseek-ai/*` client 依赖**外置**（`dsh-btw/tsdown.config.ts` `CLIENT_EXTERNALS`），产物 `lib/client.js` 运行时 `require("@deepseek-ai/dsh-client-ui-primitives")` 等 — 说明插件包 require 官方包**路径可行**（btw 已在用）。
- **但官方渲染组件不在包导出面**：`dsh-client-ui-conversation` 的 client 入口只导出 `apply` / `inject` / `ConversationController`（`types/client/index.d.ts:13-18`；bundle 尾部 exports），`ChatView/AssistantNodeView/…` 全部闭包内私有，**直接 import 官方渲染组件不可行**（primitives 是唯一公开导组件的官方包，btw 已在复用）。

### 4.2 真正的组件共享机制 = slot 注册表（可读、可渲染需自组 props）
- `SlotRegistry`（`runtime/types/client/slots.d.ts`）：`register(name, comp)`、`entries(key)`、`entriesOfSlot(key)`、`subscribe(key)`、`spec(key)`；`ctx.slots.renderSlot` 仅允许 'root'（:renderSlot 注释）。
- `SlotCore.entries(key)` 返回 `StoredEntry { component, options:{key,id,…}, select, inject, children, locale }`（`ui-slots/types/index.d.ts:437-458`）— **组件引用可读**：`ctx.slots.entries('conversation.chat.node')` 可枚举到 `assistant-step`/`tool-call` 等已注册渲染器（注册见 conversation bundle :9760-9835）。
- 手工渲染门槛（机制证据）：
  1. 组件期望 `PropsRuntime` = owner share（`ChatNodeOwnerProps`：selectedCallId/cwd/openFile/inspectCall/forkAt/renderMessageImages/fileMentions，`contract/slots.d.ts:469-480`）+ keyProps（`{node: ChatNode<Kind>}`）+ **session 标准套件**（`useSession` 绑定 `ConversationSnapshot`、`sessionId`、`useProjection`、`useSessions`）；
  2. 需要绑定 slot 级 inject face：`conversation.chat.node` 的 `CHAT_NODE_INJECT` 把 `hooks.turnData` 绑成 `useTurnData`（conversation bundle :9869-9874，`(standard, nodeKey) => useTurnData(key)`）；
  3. 需要 locale 席位 `t`（注册时 `locale: NS`）。
  - 即：喂给官方节点渲染器的是**整个 ConversationSnapshot**（nodes/chat/locations/timeline…），而 btw 侧聊会话在客户端**没有**这个快照（不在 `ctx.sessions` 列表，见 ①1.6；host 也只吐 flat 摘要）。**数据面不满足**，仅拿到组件也无米下锅。

### 4.3 既有先例
- 复用官方组件的自建插件先例：**只有 btw 自己**（primitives：MarkdownText/Button/Modal/Icon…）；`dsh-usage`（自绘 SVG、零官方组件依赖）、`dsh-wallpaper-local`（仅 require `dsh-client-runtime/client` 服务，自绘样式）均不复用官方 UI 组件。
- btw 已是官方 slot 的注册者（`client/index.ts:37-74`），说明「第三方插件进 slot 体系、拿标准 props」是**已验证通道**；但「拿注册组件出来用」无先例。

### 4.4 结论
- **不能直接 import 官方会话渲染组件**（导出面只有 apply/inject/Controller）；**能**通过 `ctx.slots.entries()` 读到组件引用，但因缺 ConversationSnapshot 数据面，驱动它们需要把侧聊会话接回标准会话管线（主机把侧聊 child 注册为正常/子代理会话），属于架构改动而非样式改动。
- **能低成本复用**：官方 primitives 全套（MarkdownText/CodeBlock/JsonBlock/JsonTree/StateDot/DisclosureRow/TerminalBlock/ReadBlock/DiffBlock/SearchBlock/WebBlock/MessageText/Modal/Button/Tooltip/图标）+ `--dsw-*`/`--ds-*` 设计 token + slot 注册/locale 机制 + 官方 style-tag 注入惯例（`data-plugin-css`）。这些正是官方消息/工具渲染的积木（如 ToolRow 就是 DisclosureRow+各 Block 拼装）。

---

## ⑤ 最小实现面建议（近似实现的组件结构/样式对齐点）

目标：btw 面板呈现向官方会话界面看齐。分三层：

### A 层（零架构改动，纯呈现补齐 — 推荐先做）
在现有 `SideChatSurface.tsx` transcript 内自绘近似组件，全部用官方 primitives 与 token：
1. **reasoning 折叠**：仿 `ReasoningRow`（conversation bundle :9389-9440）→ `DisclosureRow` + `IconThinkOutline14` + "Think" 标题 + 首行摘要/展开（`side-chat.module.css` 新增 `.thinkRow`，对齐官方行高/间距）。
2. **运行指示**：运行中在 transcript 顶部渲染官方风格运行条（仿 `TurnStatus`：`--dsw-static-deepseek-*` 渐变文字 + 秒表，CSS 动画可在 btw css 内复刻）；partial 块沿用 `MarkdownText streaming`（已有）。
3. **消息元数据行**：仿 `MessageIconActions` 的时间/耗时（btw host 目前无 turn/step 时间 → 需在 host `transcript()` 补 `user/message`/`assistant/message` 时间戳字段，主机改动小）；copy 按钮用 `writeClipboard`。
4. **用户气泡**：加时间 + copy（`MessageText` 纯文本渲染）。

### B 层（工具调用块 — 需 host 数据配合）
1. host `side-chat-service.ts transcript()` 增采 `tool/call`（name/argsRaw/时间）+ `tool/result`（content/isError/时间/subCalls），扩展 wire 类型 `SideChatTranscriptMessage`（`shared/remote.ts:70-73`）新增 `tools?: ToolDigest[]`；**不建议搬全量 `ToolCallBlock`**，只搬扁平摘要（name/args IN/result OUT/status）。
2. 客户端自绘 `ToolRow` 近似件：`DisclosureRow`（官方）行 = 图标（`VARIANT_ICONS` 逻辑可简化）+ 函数名 + 折叠摘要 + 展开 `IN/OUT`（对齐官方 `.ioCard/.ioSection/.ioLabel/.ioText` 结构，`ui-tool/lib/client.js:790-818`）；运行态加 sweep 动画（`data-state` 约定 + `--dsw-*` 变量）。子调用可用缩进 + 左边线（仿 `.subCalls`）。
3. 复杂结果卡（read/diff/terminal/search/web）不做，全部落 generic IN/OUT — 官方本也有 generic 兜底（`GenericToolCard`）。

### C 层（彻底对齐 — 架构选项，非样式任务）
把侧聊子会话改走标准会话管线（主机注册为 `origin:'subagent'` 的正常子会话 → 客户端出现在会话列表 → 直接复用 `ChatView` 全链路）。代价：侧聊会像子代理一样暴露在侧栏/目录（违背 btw "只读隔离、不进目录"设计，`host/btw-registry.ts:7-13`）。**不推荐**，除非产品上接受该变化。

### 样式对齐点汇总
- 字体/间距/圆角/色彩一律走 `--dsw-alias-*` / `--dsw-static-deepseek-*` / `--ds-font-*`（现有 `side-chat.module.css` 已大量使用，方向正确）；
- 折叠行结构统一用 `DisclosureRow`（官方 ReasoningRow/GenericCommandCard/ToolRow 共用件）；
- 状态表达用 `StateDot`（官方 turn-error/retry/command 的 leading）；
- 代码/JSON 用 `CodeBlock`/`JsonBlock`/`JsonTree`；
- CSS 注入沿用 style-tag + `data-plugin-css` 惯例（tsdown `inlineCssPlugin` 已实现）。

---

## 附：关键证据文件索引
- btw 管线：`dsh-btw/src/client/SideChatSurface.tsx`、`presentation.tsx`、`view-store.ts`、`SideChatDrawer.tsx`、`SideChatJumpList.tsx`、`side-chat.module.css`、`locales.ts`、`index.ts`、`shared/remote.ts`、`host/side-chat-service.ts`、`host/btw-registry.ts`、`tsdown.config.ts`。
- 官方管线（全局 `node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`）：`dsh-client-ui-conversation/lib/client.js`（10251 行，行号见正文）、`…/lib/types/client/**`、`dsh-client-ui-tool/lib/client.js`、`dsh-client-ui-subagent/lib/client.js`、`dsh-client-runtime/lib/types/client/**`、`dsh-client-modules/lib/client.js`、`dsh-client-ui-primitives/lib/index.js`、`dsh-client-ui-slots/lib/types/index.d.ts`。
