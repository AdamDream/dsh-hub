# btw 插件升级前现状审计报告（R1 图片 / R2 跳转 / R3 全局化 + 补充审计 E1–E3）

> 审计性质：只读 + 落盘报告，未改任何代码。全部结论基于真实文件/运行态证据（文件:行号），不确定项一律标注「未确认」。
> 审计时间：2026-09-12。审计对象：工作区 `dsh-btw` 插件源码、`~/.dsh` 部署态、`~/.dsh/profiles/{web,web2}/node_modules` 官方包、运行中的 GUI（http://127.0.0.1:3080）。

---

## 0. 结论总览

| 需求 | 现状判定 | 一句话结论 |
|---|---|---|
| R1 侧聊粘贴图片 | **核心链路 DSH 已具备，btw 协议缺图片槽位** | DSH 的 content parts（ImageBlock）全链路可用（dsh-llm 类型 + 两个 adapter 的 image_url/base64 序列化 + 主壳已实现粘贴导入）；btw 的 `sideChat/send` 协议与转录目前仅 text；**且当前三个 btw 模型在 provider adam 下均声明 text-only 输入**（settings.yaml 未声明 `input`），需要声明 `input:[text,image]` 才能让图片真正进模型 |
| R2 主会话↔子代理侧聊跳转 | **数据源与跳转机制已存在，缺"统一入口"UI** | 会话树枚举：host 侧 `SubagentRuntime.listChildren/listDescendants` + `subagent/catalog` 事件；client 侧 `sessions.list.subagentsByParent` + `openSubagent()`；侧聊索引 `~/.dsh/btw/index.json` 按 parentSessionId 键控（子代理可作 parent）。现有唯一切换机制是"切会话自动恢复该 parent 的 parked 侧聊"（controller.handleSessionChange），无树级列表 UI |
| R3 项目级跨会话总览 | **元数据基本可得，缺 projectId 字段** | session header 无 projectId/title；但有 `cwd`（dsh-session types:69）+ 按 cwd 分目录的持久化（`~/.dsh/sessions/--<cwd>--`）+ `session/title` 事件 + `sessionQuery.listSessions` 全量枚举。项目身份须由 cwd 推导（现有先例 `workspaceTitleOf(cwd)`） |
| 模型路由 | **已落地，默认 deepseek-v4-flash** | `BTW_MODELS=['deepseek-v4-flash','glm-5.3','deepseek-v4-pro']`，provider 恒 adam，`DEFAULT_BTW_MODEL='deepseek-v4-flash'`（side-chat-service.ts:63-66；remote.ts:13）；切换 = `installModelSelection`（dsh-agent:133-177）；持久化 = request/header 事件；UI = SideChatSurface.tsx:286-299 `<select>`（"Model/下一轮生效"） |
| E1 主壳粘贴图片 | **主壳已原生支持（0.1.1-rc.2 运行中）** | 运行中的主输入框（ui-conversation InputBar）已有 onPaste 图片摄取 + `conversation.input.attachments` 附件轨 + `session.prompt(contentParts)` 发送；`dsh-client-ui-attachment` 在运行 boot graph 中 |
| E2 主壳构建 | **本机无 apps/web 源码、无 dev watcher** | `~/.dsh/profiles/web` 是安装产物（无 apps/packages/vite.config）；GUI 是 npm 包 `@deepseek-ai/dsh-web-frontend` 的预构建 dist；`__DSH_BOOT__` 由 dsh-client-modules 组装、webserver 渲染注入；ps/端口确认无 dev:web watcher → 改动一律"重建插件→拷 lib→重启→刷浏览器" |

---

## 1. 结构总览：host 服务 + client 状态机核心状态流

### 1.1 协议与 remote 面（7 个 typert 方法）

- 协议 schema：`src/shared/remote.ts`（start/read/send/answer/cancel/close/setModel，`btwModelSchema` 在 :13，`sendSideChatRequestSchema = {chatToken, requestId, text}` 在 :93-97——**text-only**）。
- 描述符：`src/remote-descriptors.ts:34-42` 7 条 directDescriptor（PACKAGE=`@local/dsh-btw` :12）。
- host 声明：`src/typert.host.ts:11-21` members 7 项；client 侧 namespace：`src/client/remote.ts:9-30`。
- 部署位 `lib/typert.host.js` 实测 7 invocations（smoke-build.mjs:16-20 断言 7）。

### 1.2 host 侧 `SideChatService`（src/host/side-chat-service.ts）

- **open/start 链路**：`start()`（:337-431）→ 查 `this.ctx.agents.get(parentId)` 失败回 `parent-not-found`（:346-350）→ 按 chatToken 查 `byToken` / `tokenByParent` 去重（:355-364）→ 无活体则走 fork 或 resume：
  - fork：`completedTurnSeed(parent)`（:371-380，:78-90 切到最后一个 `turn/end`）+ `ctx.agents.create({sessionId: randomUUID(), seed, meta: hiddenSideChatMeta, agentOptions: resolveChildAgentOptions(parent, {provider:'adam', model: request.model ?? DEFAULT}, childDepth), setup})`（:381-397）。`hiddenSideChatMeta`（:88-96）**刻意剥掉 `parentSession`**，让 btw 子会话既不在会话目录也不在子代理目录出现。
  - resume：`BtwRegistry.get(parentId)` → `ctx.agents.resume({resumeSessionId: childId, agentOptions, setup})`（:438-493），失败降级新建（:487-492）。
  - `composeChild`（:496-509）：persona（SIDE_CHAT_PERSONA :50-56）+ `applyChildComposition({sandboxMode:'read-only', approvalPolicy:'never', toolFilter:{allow: visibleReadTools}})` + `tools.guard(isSideChatToolAllowed)`；`visibleReadTools = READ_ONLY_TOOL_CANDIDATES ∩ 父会话已注册工具`（:84-86，可查 host-opening.spec / execute-btw.md U9 的 10 项 ∩ 实证）。
  - `installBtwModelSelection`（:516-532）：getter = picked → `childAgent.session.requestHeader()?.config` → 默认 `deepseek-v4-flash`；setter = picked；随后 `installModelSelection(childCtx, selection)`。
  - 注入开场通知（injectOpeningNotices :631-640）、消化队列消息（deliverQueued :642-648）、进行中 digest 注入（:88-90/`buildProgressDigest`）。
- **read/poll 链路**：`read()`（:546-598）→ `transcript(child, seedLength)`（:246-316）流式折叠 child session 事件（user/assistant 消息、`assistant/partial`、`reasoning/partial`、runningTool、pendingQuestion），**contentText(:110-112) 只取 `type==='text'` 块 → 图片块在转录里会丢**；每读一次 `registry.touch(parentId)`（:592）。
- **send**：`send()`（:684-720）→ 校验 open/文本 → `child.handle.agent.followup(createUserMessage({content:[{type:'text',text}]}))`（:707）→ 乐观 requestId 记账（pendingByRequest）。
- **answer**：`answer()`（:723-737）→ `entry.pendingQuestion.resolve({...})` → 回投 child。
- **setModel**：`setModel()`（:777-788）→ `entry.modelSelection.current = {provider:'adam', model}`（sanitizeBtwModel 校验 :68-72）→ accepted；下一轮生效。
- **close**：`close()`（:752-774）→ `handle.dispose()` + 注销 entry，**保留磁盘索引与子会话日志**（持久化语义）。
- **取消/清理**：`cancel()`（:741-750）；`disposeAll()`（:821-833）。

### 1.3 client 侧 `SideChatController`（src/client/controller.ts）

- 状态：`SideChatClientState`（:8-24：epoch/phase/parentSessionId/childSessionId/chatToken/seedLength/revision/messages/partial/reasoning/running/runningTool/pendingQuestion/model/error）。phase ∈ closed|starting|open|error（:5）。
- **chatToken**：client 在 `open()` 时 `crypto.randomUUID()` 生成（:123），随 start 请求发给 host；host 以 `byToken`/`tokenByParent` 双 Map 索引（side-chat-service.ts:321-322）；client 侧 `optimisticByToken`、`openingByToken`（:74-76）以 token 记账。**作用 = 端到端会话句柄，也是乐观发送/恢复的 key**。
- **open**：`open(parentSessionId)`（:118-183）→ `sessions.binding(parentSessionId)` 校验 → `remote.start({parentSessionId, chatToken})` → confirmRestore/park 逻辑。
- **轮询**：`poll()`（:540-601）循环 `remote.read({chatToken})` 按 revision 增量刷新，running 时定时续 poll，`stopPolling`（:646-650）。
- **send**：`send(text)`（:185-209）→ 乐观消息 + `remote.send({chatToken, requestId, text})`，失败回滚 draft。
- **多 parent 机制**：`parkedByParent`/`openingByParent`/`restoringByParent`（:72-75）按 parentSessionId 键控；`handleSessionChange()`（:421-429）——**切换当前会话时把当前侧聊 park、并把新会话的 parked 侧聊恢复**（这是现有唯一的"多侧聊间切换"机制，隐式、无 UI）。`dispose`（:431-459 附近）。
- **同一 parent 只允许一条侧聊**：host 端 `tokenByParent` 单值映射（side-chat-service.ts:321-322、:806-810 `adoptToken`：重复 start 时新 token 接管/去重旧 token 对应 entry）；client 端 `parkedByParent`/`openingByParent` 同键覆盖。结论：**是，一个 parent 同时只有一条侧聊**（多开需要重构为 per-parent 多 entry 或列表）。

### 1.4 UI 装配

- 入口按钮：`SideChatButton.tsx:19-40` 注册在 `conversation.session.header.actions`（client/index.ts:37-46），`presentation.toggle(parentSessionId)`。
- 面板：`SideChatDrawer.tsx:20-84`（shell.overlay，client/index.ts:48-74）+ `SideChatSurface.tsx`（内容/文本域 :376 textarea、发送 :226-240、模型 select :286-299、提问卡 QuestionCard :38-151、结束确认 Modal :410-448）。
- 呈现层：`presentation.tsx`（better-sidebar 适配 :148-208，drawer 兜底；`show/toggle/minimize/end` :109-146）；`view-store.ts`（per-parent 可见性/draft/呈现模式 :17-75）。
- 快捷键 ⌘⇧.（client/index.ts:76-85）。

---

## 2. R1 图片链路现状

### 2a. DSH agent.followup()/inject 是否支持多模态用户消息 —— **支持（content parts 是一等公民）**

- **内容块词汇**：`@deepseek-ai/dsh-llm/lib/types/types.d.ts:54-58` 定义 `ImageBlock {type:'image', attachment: ImageAttachmentRef}`（"valid in user or assistant content… only user messages may carry images"）；:66-70 `FileBlock`；:91-102 `ContentBlockMap`（text/reasoning/image/file/tool-call/tool-result）。
- **agent 收消息**：`@deepseek-ai/dsh-agent-loop/lib/index.js:783-797`：`send(message,target,wakeup)` → `followup(input)=send(input,'next-turn',true)`、`steer=next-step`、`inject=next-step`；消息经 inbox 进下一轮 request。
- **图片进子代理的现成先例（最直接证据）**：`@deepseek-ai/dsh-subagent/lib/index.js:1921-1946` `submitMaterialized`：`if (contentHasImage(content)) await this.assertImageCapable(...)` 后 `createAgentMessage(parent, content)`/`createUserMessage({content, source})` 提交 —— 即"带图 prompt 投喂子代理"是官方支持路径；:1948-1957 `assertImageCapable` 用 `llm.resolveModelInfo(provider, model).inputModalities.includes('image')` 门控（失败抛 `MODEL_DOES_NOT_SUPPORT_IMAGES`，:111 有对应 remote 错误映射）。
- **wire 序列化（ImageBlock→base64/image_url）**：
  - `@deepseek-ai/dsh-llm-deepseek/lib/index.js:69-70`：`{type:'image_url', image_url:{url:'data:${mediaType};base64,...'}}`；:1617-1620 模型不支持图时抛 `UNSUPPORTED_CONTENT`。
  - `@deepseek-ai/dsh-llm-pi-ai/lib/index.js:1149-1160`：user image 块 → `{type:'image', data: base64, mimeType}`（数据经 `attachments.readImageRequest` :1186 从持久附件库取）；:1844-1845 `containsImage && !model.input.includes('image')` → `UNSUPPORTED_CONTENT`。
  - 文本降级：dsh-llm `lib/types/content.d.ts:104`（text-only 模型把图片历史投影成确定性文本）；dsh-tool-fs 的 read_image gate 亦基于此。
- **结论**：DSH 的 agent 链路原生支持带图用户消息；**唯一的门是模型路由的 `inputModalities`**（见 §5/§2d）。

### 2b. btw 子代理只读白名单中 read_image / view_image 的语义

- 白名单：`src/shared/tool-policy.ts:20-25`（`READ_ONLY_TOOL_CANDIDATES` 含 `read`、`read_image`、`view_image`…）；:27-31 执行守卫集另加 `run_code`、`btw_ask_user`。
- **read_image 语义 = "读文件 + 喂图给模型"二合一**（web profile 运行版 `@deepseek-ai/dsh-tool-fs/lib/index.js`）：
  - 注册：:1005-1083（`attachments` 服务挂载时注册，:1216 注释"plus `read_image` while `attachments` is mounted"）。
  - 产出：:987-995 把结果渲染为 text envelope + `ImageBlock(attachment)` → **作为图片块进入模型上下文**（这正是"喂图"通道）。
  - 门控：:934-942 `assertImageCapableRoute` —— 解析当前路由（requestHeader config → agent options）后要求模型显式声明 `image` 输入，否则报"model does not declare image input; switch to an image-capable model"。
  - 因此 **read_image 在 btw 里可用与否 = btw 当前模型是否声明 image 输入**（§5 现状：否）。
- **view_image 语义：未确认（本机未注册）**：全量检索两个 profile 的 `node_modules`（含 dsh-tool-*、dsh-agent-*、dsh-taste、dsh-vision-adam）**零命中 `view_image`**；它只在 btw 白名单字面量里，运行时被 `visibleReadTools`（side-chat-service.ts:84-86）∩ 滤除。上游语义（可能为查看器/展示类工具）无从本地确认，标注「未确认」。运行期佐证：本会话（运行于同一部署）工具列表含 `read_image`/`analyze_image`，无 `view_image`。
- **运行时实证**：`@deepseek-ai/dsh-tool-fs`（web profile，运行树）为含 read_image 的版本；shared profile 同包不含（版本差异），但运行解析根为 web profile（execute-btw.md V1）。

### 2c. 本地把图片数据传模型的现成先例 —— **三处**

1. **vision-adam 工具**（`@deepseek-ai/dsh-vision-adam/lib/index.js`）：:116-142 `adamAnalyze` 直连 adam 网关 `https://llmapi.roboscience.xyz/v1/chat/completions`（:24），图片以 `{type:'image_url', image_url:{url:'data:${mediaType};base64,${base64}'}}`（:139）发送；:240-243 工具主体 read bytes→base64→调用；返回纯文本（:244），**不经过 harness 的 image 门控**（README 自述"side-step the host's does-not-accept-image-input guard"，:16-20）。该工具不在 btw 白名单中。
2. **dsh-llm-deepseek adapter**（:69-70）：harness 请求路径内的 data URL base64 image_url（见 2a）。
3. **dsh-llm-pi-ai adapter**（:1149-1160）：{type:'image', data: base64, mimeType}（见 2a）。
4. **主壳前端**（详见 E1）：`dsh-client-ui-conversation/lib/client.js:118-137` `sendSession` → `serializeImages`（:284-292）产出 `{type:'image', mediaType, data: base64, name?}` + text 块 → `session.prompt(content, mode)`；wire 类型 `PromptContentPart`（`@deepseek-ai/dsh-host-apiproxy/lib/types/api/sessions.d.ts:86-90`，"the host promotes image bytes to durable references"）。

### 2d. 三条可行路径评估（R1）

| 路径 | DSH 是否支持 | 证据 | 前置条件 | 推荐 |
|---|---|---|---|---|
| A. 直接多模态消息（client 粘贴→base64→`sideChat/send` 加 parts→host `followup(createUserMessage({content:[text,image]}))`） | **支持** | 2a 全链（ImageBlock 类型、followup/inject、adapter base64 序列化、subagent 带图 prompt 先例、主壳 sendSession 同款 wire） | ① `~/.dsh/settings.yaml` 给目标 btw 模型加 `input: [text, image]`（pi-ai schema :973 允许，当前缺失）；② adam 网关对该模型真实支持图（外部依赖，未确认）；③ btw send/read 协议加 parts 字段 + 转录支持图片显示 | ⭐ **推荐**（与主壳同构、官方通路） |
| B. 存文件 + read_image 工具 | 工具链**支持**，但宿主需先把粘贴字节落盘 | read_image 注册/门控/ImageBlock 产出（2b）；host 有 `attachments.saveImage`（`dsh-attachment/lib/index.js:206-210,322`）与 `ctx.fs` 写能力 | 同 A 的 ①（read_image 同样过 `assertImageCapableRoute` 门控）；需要 host 决定落盘位置（如 `<cwd>/.dsh-btw-tmp/`，写盘动作在插件侧而非子代理，不违反只读）；转录显示同 A | 备选（多一次落盘+工具调用，且子代理"模型主动 read_image"不可控） |
| C. 复用 vision-adam（`analyze_image` 工具） | 工具存在且绕过门控 | vision-adam :116-142（直连网关、纯文本返回、任何模型可用） | 需把 `analyze_image` 加入 btw 白名单（tool-policy.ts:20-25 现在没有）；文件同样需在 child fs 可读处；**副作用**：图片只以文本摘要进 btw 模型上下文，模型看不到原图 | 备选（适合模型无图能力的兜底；与"图片随消息发送给模型"的需求语义不完全一致） |

**关键事实（必须先改）**：当前三个 btw 模型（deepseek-v4-flash / glm-5.3 / deepseek-v4-pro，provider adam）经 pi-ai adapter 解析后 `inputModalities = ['text']`——`dsh-llm-pi-ai/lib/index.js:906 DEFAULT_INPUT=['text']`、:682 输入解析（entry.input ?? 内置目录 ?? route defaultInput）、:279-282 MODALITIES={text,image}；`~/.dsh/settings.yaml` 的 `llm-pi-ai.providers.adam.models` 各模型**未声明 `input`**，而 pi-ai 内置目录（@earendil-works/pi-ai）**无 adam 路由**（全量 grep 零命中）→ 落到 `["text"]`。因此 read_image 门控（2b）与 adapter 门控（2a）现在都会拒绝图片；**不加 `input:[text,image]` 声明，任何路径的图片都进不了模型**（vision-adam 除外）。

---

## 3. R2 多侧聊 / 跳转现状

### 3a. 子代理能否打开自己的 btw —— **能（代码路径完整，未做运行验证）**

- host 侧 `start()` 只要求 `this.ctx.agents.get(parentId)` 存活（side-chat-service.ts:346-350），不区分 parent 类型；子代理是 live agent 即可。
- UI 侧：`SideChatButton` 注册在 `conversation.session.header.actions`（client/index.ts:37-46），该槽在会话头部渲染（`dsh-client-ui-conversation/lib/client.js:15072` 附近 headerActions），会话视图含子代理会话（面包屑 `summary.subagent` 与 `open(summary.id)` :15040-15048）——**子代理会话的 header 同样渲染该槽**（高置信，未运行点击验证）。
- controller 不区分 parent 类型：全部按 sessionId 字符串键控（parkedByParent/openingByParent :72-75；`hasConversation` :110-112）。
- 佐证：`~/.dsh/btw/index.json` 现有 4 条记录，其中键 `"parent-3"`（非 `session-<uuid>` 格式）——注册表不校验 key 格式，任意 parent 字符串可作键（该条来源未确认，可能是历史手动/测试产物，建议核查）。
- 注意：btw 子会话经 `hiddenSideChatMeta` 隐藏（side-chat-service.ts:88-96），**子代理自己的 btw 孩子同样不进任何目录**，只活在 `~/.dsh/btw/index.json`。

### 3b. btw-registry 键控 —— **确认按 parentSessionId 键控**

`src/host/btw-registry.ts:21-25` `BtwIndexEntry{childSessionId, createdAt, lastActiveAt}`；:27-30 文件 `{version:1, entries: Record<parentSessionId, entry>}`；:84-86 `get(parentSessionId)`；:89-107 `set`；:110-123 `touch`；:126-134 `remove`；:142-153 原子写（temp+rename）。主会话与子代理各自独立 key（子代理的 key = 子代理 session id）。

### 3c. 客户端如何枚举"当前会话树下的全部侧聊" —— **数据源齐全**

host 侧可用 API（证据）：
- `SubagentRuntime.listChildren(ctx, parentSessionId, signal)`：`@deepseek-ai/dsh-subagent/lib/index.js:2071-2074` —— 枚举 `header.parentSession===parent && header.origin==='subagent'` 的直接子代（活体优先合并持久化）。
- `listDescendants(ctx, rootSessionId, signal)`：:2088-2102 —— 全子树 pre-order（带 parentId/depth）。
- `prepareListing`：:2104-2138 —— 依赖 `sessionProjections` + `sessions` + `sessionQuery`；`query.listSessions(signal)`（`dsh-session-query/lib/index.js:94,1064`）给出全部 session record（含 header）。
- **`subagent/catalog` 事件**：`dsh-subagent/lib/index.js:1504-1520` `establishCatalogChild(parent, child, descriptor)` → `parent.append('subagent/catalog', {childId, childCreatedAt, mode, label})`；投影 `subagentCatalog`（:1486-1502）折叠成直子行。**持久、跨重启**。注意：btw 子会话不走此通道（被隐藏），侧聊枚举须以 `BtwRegistry.load()`（btw-registry.ts:75-81，读全量索引）为主、会话树为辅。
- remote 面：`subagent.list`（dsh-subagent:40-52 schema、:3003-3022 `remoteExportList` → `catalogView` :74-83，浏览器可调）。

client 侧（证据）：
- `ISessions`（`@deepseek-ai/dsh-client-runtime/lib/types/client/contract/sessions.d.ts:20-127`）：`openSubagent(address)` :40、`subagentAddress(id)` :46、`refreshSubagents(parentSessionId)` :58、`search(query)` :76。
- `SessionListState.subagentsByParent: Record<SessionId, SubagentCatalogSnapshot>`（service.d.ts:76）、`currentAddress` :84 —— **client 已经持有每 parent 的子代理目录**。
- `SessionSummary`（service.d.ts:30-52）：title/displayTitle/cwd/parentId/origin/running。

### 3d. 现有切换/多开机制 —— **仅隐式 park/restore，无列表 UI**

- controller `handleSessionChange`（controller.ts:421-429）：切换当前会话 → 当前侧聊 parkVisible、新会话恢复 restoreExisting —— 这是唯一"多侧聊间跳转"，且完全跟随会话切换，无显式入口。
- 无任何"当前树全部侧聊"列表/选择器；better-sidebar 的 tab 为 `single:true`（presentation.tsx:185），同一时刻只开一个 tab。
- 多开：目前一个 parent 一条侧聊（§1.3）；R2 如需"同屏多开"，需在 controller 引入 per-parent 实例列表 + 新 UI。

### R2 建议落地

- 数据：新增 host remote（如 `sideChat/listTree(parentSessionId)`）= `BtwRegistry.load()`（拿到树内各 session 的侧聊 entry）∪ `listChildren/listDescendants`（拿到会话树）+ sessionQuery 标题（displayTitle）。或直接复用 client 已有 `subagentsByParent` + btw 索引。
- 跳转：`sessions.open(subagentId)` / `openSubagent(address)`（sessions.d.ts:35,40）切当前会话 → `handleSessionChange` 自动恢复该 parent 的 parked 侧聊（零协议改动即可实现"主↔子代理侧聊互跳"）。
- UI 落点：① SideChatButton 弹出小菜单（"本会话树的侧聊：主会话 / 子代理A / 子代理B"）；② better-sidebar tab 改为按 parent 多开（去 single）。推荐先做 ①（改动最小）。

---

## 4. R3 全局化数据模型

### 4.1 现状：`~/.dsh/btw/index.json`（真实文件已读）

```json
{ "version": 1, "entries": {
  "parent-3":  { "childSessionId": "...", "createdAt": ..., "lastActiveAt": ... },
  "session-60ce6488-...": { ... }, "session-927f1114-...": { ... }, "session-61ee47df-...": { ... } } }
```
仅 parentSessionId→{childSessionId, createdAt, lastActiveAt}。无标题、无 cwd、无模型。

### 4.2 "项目"元数据可得性 —— **无 projectId 字段，但有 cwd + 按 cwd 分目录 + workspace 注册表**

- `SessionHeader`（`@deepseek-ai/dsh-session/lib/types/types.d.ts:58-95`）：`id/createdAt/cwd?(:69)/parentSession?(:71)/isSeeded/origin?('subagent' :81)/delegationDepth?(:87)/agentPreset?(:94)` —— **没有 projectId、没有 title**。
- 会话按 cwd 分目录持久化：`~/.dsh/sessions/--home-CNS2026495165-dsh--/<sessionId>/session.jsonl.zstd`（实测 13 个 workspace 目录）——"属于哪个项目"= 该目录（cwd 的转义名）。
- workspace 注册表：`~/.dsh/storages/workspace.json`（`workspaceIds` + `archivedSessionIds`）；`@deepseek-ai/dsh-workspace/lib/index.js:114-123` 以 `header.cwd`（realpath 规范化）绑定会话到 workspace —— **cwd 即项目身份**，官方先例 `workspaceTitleOf(cwd)`（dsh-client-runtime service.d.ts:126-127，取 cwd 末段作标题）。
- 标题：`session/title` 事件（`dsh-session/lib/index.js:111-112` 事件词汇表，写在会话日志里，非 header）；`dsh-session-title` 服务（LLM/首 prompt 生成 + 用户改名）；client 侧 `SessionSummary.displayTitle`（service.d.ts:33-35，durable title → 项目 basename → session id）。
- 全量枚举：`sessionQuery.listSessions(signal)`（dsh-session-query:94,1064）返回所有会话 record（含 header），可把 btw 索引与"cwd/标题/父链"做 join。

### 4.3 R3 落地建议

- 索引扩展（btw-registry.ts 文件格式 v2，向后兼容 v1）：每条 entry 增加 `parentTitle?`、`parentCwd?`、`model?`、`lastQuestion?`（或仅在查询时 join sessionQuery，避免冗余写）。**推荐查询时 join**（会话标题/cwd 以 session 日志为准，写冗余会过期）。
- "项目级总览"数据源 = `sessionQuery.listSessions`（cwd 分组）+ `BtwRegistry.load()`（侧聊存在性）+ `subagent/catalog`（树形）——三者均在现有包内，无需新依赖。

---

## 5. 模型路由真实落地状态（确认项）

| 项 | 现状（真实代码） | 证据 |
|---|---|---|
| 默认模型 | **`deepseek-v4-flash`**（provider 恒 `adam`） | `src/host/side-chat-service.ts:63-66` `BTW_MODELS=['deepseek-v4-flash','glm-5.3','deepseek-v4-pro']` / `DEFAULT_BTW_MODEL='deepseek-v4-flash'`；`src/shared/remote.ts:13` 同 |
| 可选项 | 三选一：deepseek-v4-flash / glm-5.3 / deepseek-v4-pro | 同上 + `sanitizeBtwModel`（side-chat-service.ts:68-72） |
| 切换机制 | `installBtwModelSelection`（getter=picked→requestHeader config→默认；setter=picked）→ `installModelSelection(childCtx, selection)`（side-chat-service.ts:516-532）；核心 `installModelSelection` = dsh-agent/lib/index.js:133-177（system-prompt/assemble + agent/request 覆盖 provider/model + agent/pre-step 追加切换提示），导出 :669 | 上述行号 |
| 持久化 | request/header 事件随会话日志持久（dsh-agent-loop/lib/index.js:1166-1187 buildRequest → `session.append('request/header',{header,reason})`）；resume 后 getter 读回 | 同上 |
| UI 位置 | SideChatSurface 头部 `headerActions` 内 `<select value={state.model}>` 三 option + 提示"Takes effect on the next turn/下一轮生效" | `src/client/SideChatSurface.tsx:286-299`（组件 :9 import `BtwModel`）；文案 `src/client/locales.ts:13,40,64`（drawer.model / drawer.modelNextTurn）；controller `setModel()` controller.ts:258-272；remote `sideChat/setModel` client/remote.ts:16,27 |
| 部署一致性 | 工作区与部署副本 lib 一致（9-11 构建）；smoke 断言 7 方法含 setModel | scripts/smoke-build.mjs:16-20；tests/package-contract.spec.ts:7-9 |
| 与既往报告的差异 | audit-btw-model.md 曾定默认 glm-5.3-flash，**当前代码已改为 deepseek-v4-flash**（settings.yaml `agent-default-model: provider adam, model deepseek-v4-flash` 同向） | 本报告亲读源码 |

---

## 6. 构建 / 安装 / 验证

- **scripts**（`dsh-btw/package.json`）：`build`=tsdown；`typecheck`=tsc ×3（tsconfig / client / tests）；`lint`=oxlint；`test`=vitest run（当前 132 passed / 2 skipped，见 execution-btw-model.md）；`smoke`=node scripts/smoke-build.mjs（断言 7 invocations/descriptors、包名 @local/dsh-btw、setModel 存在）；`check`=lint+typecheck+test+build+smoke+publint。
- **tsdown 三入口**（`tsdown.config.ts:66-88`）：entry `{index:'src/index.ts', 'typert.host':'src/typert.host.ts', 'typert.remote-client':'src/client/remote.ts'}`（ESM node 产物）+ 第二段 `{client:'src/client/index.ts'}`（CJS browser ModuleLoader bundle，banner `window.__ModuleLoader__.load({id:'@local/dsh-btw',...})` :84，CLIENT_EXTERNALS :12-22，CSS 内联插件 :24-64）。
- **部署目标**：`~/.dsh/profiles/node_modules/@local/dsh-btw/`（**@local 命名，真实目录拷贝，非 @deepseek-ai、非符号链接**；execute-btw.md U10 实测；audit-local-customizations.md §1.3.3 sha1 一致）。`~/.dsh/install-plugins.sh` 只管 vision-adam → `@deepseek-ai/dsh-vision-adam`，与 btw 无关。profile 补丁 `~/.dsh/profiles/web/cordis.patch.yml`：`- insert: {id: btw, name: '@local/dsh-btw'}`。
- **运行态证明**：`curl http://127.0.0.1:3080/` 返回的 index.html 内 `globalThis["__DSH_BOOT__"]` 包含 `{"id":"@local/dsh-btw","url":"/plugins/@local/dsh-btw/client.js?rev=049df2a5c3e3",...}` —— **当前 GUI 正在加载部署位 btw client**。
- **安装/重启命令**：
  ```bash
  cd /home/CNS2026495165/dsh/dsh-btw && pnpm run build && node scripts/smoke-build.mjs
  rm -rf ~/.dsh/profiles/node_modules/@local/dsh-btw/lib && cp -r lib ~/.dsh/profiles/node_modules/@local/dsh-btw/
  # 重启 DSH（安装脚本/历史 runbook 用 npx @deepseek-ai/dsh web；当前 3080 端口进程名在沙箱 ps 不可见，端口确在监听）
  ```
- **验证步骤**：刷新 http://127.0.0.1:3080 → `__DSH_BOOT__` 中 @local/dsh-btw 的 rev 更新 → 打开会话 header btw 按钮 → 开侧聊默认 deepseek-v4-flash → 切模型下一轮生效 → 关/重开 resume（`~/.dsh/btw/index.json` lastActiveAt 更新）→ 子代理会话 header 也能开 btw → 重启 DSH 后按 parent 恢复。

---

## 7. 补充审计 E1–E3：主壳主输入框与构建流程

### E1. 主壳源码与输入框现状

**源码位置判定（如实报告）**：`~/.dsh/profiles/web` **不是源码 checkout**——无 `apps/`、无 `packages/`、无任何 vite 配置（`ls` 实测只有 node_modules + cordis.yml/cordis.patch.yml/package.json/pnpm-workspace.yaml（`packages: [.]`））。在 `~/.dsh` 全范围搜索 `apps/web`、`pnpm-workspace.yaml`、`vite.config.*`、`deepseek-harness` 目录均**未找到源码**；`/tmp/dsh-upgrade-audit`（既往审计解包处）已被清理。**本机没有 deepseek-harness monorepo 源码**；GUI 主壳以**预构建 dist** 形式存在于 npm 包 `@deepseek-ai/dsh-web-frontend/dist/`（web profile 版本 0.1.1-rc.2：`assets/index-ClqxG24t.js` 392K + vendor 728K；web2 profile 版本 0.1.5-rc.2：`index-BKQ_L1z6.js`）。以下分析基于该 dist 对应的同版本客户端包源码（`dsh-client-ui-conversation/lib/client.js` 等，包内为可读 CJS/ESM）。

**主输入框（运行版 0.1.1-rc.2，即当前 GUI）**：
- 组件：`InputBar`（`@deepseek-ai/dsh-client-ui-conversation/lib/client.js:3560`），即 `conversation.composer.bar` 槽默认实现（:3511 注释），经 `renderSlotChain('conversation.composer', …)`（:7259）挂进 composerSeat（:7252-7258）。
- 元素：**textarea**（:4031 `<textarea>`；Safari 布局修复 :3432-3444）。
- **粘贴图片已原生支持**：
  - `onPaste`（:3824-3836）：`e.clipboardData.items` 过滤 `kind==='file'` → `intakeImages(files)`；纯文本走 `keyboard.pasteBegin`。
  - `intakeImages`（:3837-3855）：按 `imageLimits`（来自 `useProjection('imageLimits')` :3587）校验 mediaTypes/maxImagesPerMessage/maxImageBytes/maxMessageImageBytes → `addImages(files)`。
  - 草稿轨：`createDraftImages`（:140-155，浏览器 File→预览 objectURL）、`draftImages(ids)`（:161-166）、`releaseDraftImages`；附件轨渲染槽 `conversation.input.attachments`（:4006-4016，传 `{attachments, canAcceptDrop, onAddImages: intakeImages, onRemoveImage, dropLimits}`），默认实现 `AttachmentRail` 在 `@deepseek-ai/dsh-client-ui-attachment/lib/client.js:77-184`，该包注册槽位（:766-767）且**在运行 boot graph 中**（见下）。
  - 拖放：canAcceptDrop/drop 处理（:3860 附近 + :4012-4014 dropLimits）。
- **消息构造与发送**：`sendSession(session, text, imageIds, mode, signal)`（:118-137）→ `serializeImages`（:284-292）产出 `{type:'image', mediaType, data: base64, name?}` + `{type:'text', text}` → `session.prompt(content, mode, signal)`；wire 类型 `PromptContentPart`（`dsh-host-apiproxy/lib/types/api/sessions.d.ts:86-90`，注释 "the host promotes image bytes to durable references"）；`SessionFace.prompt(content: PromptContentPart[], mode:'queue'|'steer', signal?)`（`dsh-client-runtime/lib/types/client/contract/session.d.ts:37`）。纯文本发送 = `prompt([{type:'text',text}],'queue')`（:110-116）。
- **附件/上传先例**：主壳走"浏览器 File→base64 content part→host 提升为持久附件"（上述）；host 侧 `attachments.saveImage`（dsh-attachment/lib/index.js:206-210、导出 :322）；另有 raw-byte 上传路由 `/api/session/uploadFileBinary`（dsh-client-file-upload/lib/index.js:73）。
- **运行态实证**：`curl http://127.0.0.1:3080/` 的 `__DSH_BOOT__` 含 `{"id":"@deepseek-ai/dsh-client-ui-attachment","inject":["@deepseek-ai/dsh-client-ui-conversation"]}` —— 附件轨组件在运行 GUI 中已激活。web2（0.1.5-rc.2）同样有剪贴板图片摄取（`dsh-client-ui-conversation/lib/client.js:15260-15264`）。

**结论 E1**：主会话主输入框"粘贴导入图片→附件区→随消息发送"**已是现成能力**（0.1.1-rc.2 与 0.1.5-rc.2 均支持）；缺的只是 **btw 侧**（SideChatSurface textarea :376 纯文本、viewStore draft 为 string、`sideChat/send` 协议 text-only remote.ts:93-97、host send 只造 text block side-chat-service.ts:707）。

### E2. 主壳构建流程

- **构建命令**：本机无源码 → 无本地构建命令可用。官方为 monorepo `github.com/deepseek-ai/deepseek-harness` 的 `apps/web`（Vite entry，见 harness 自身系统提示词 dsh-web-app/lib/index.js:98："The apps/web Vite entry builds the shell but is not a standalone application because only dsh web injects window.__DSH_BOOT__"，以及 "client-plugin changes reload without a refresh only while `pnpm run dev:web` is also running from this same checkout"）。**该 checkout 本机不存在**。
- **产物路径**：npm 包 `@deepseek-ai/dsh-web-frontend/dist/`（index.html + assets/），由 `dsh-web-app`（bundle 的 glue 插件，`@deepseek-ai/dsh-web-app/lib/index.js:19-24` 注释）解析 dist 并挂 `frontend-static` fallback（dsh-host-frontend-static/lib/index.js:77-91，`distIndex` 由 bundle `!!js` 表达式指定 :12-14）。
- **`window.__DSH_BOOT__` 注入机制（端到端证据）**：`dsh-client-modules` 监听 `webserver/index-inject` 并 push `bootInjections(composed)`（dsh-client-modules/lib/index.js:300-311，`graph()` :306）→ `WebServer.renderIndex(html)` 执行 `renderIndexInjections(html, collectIndexInjections())`（dsh-host-webserver/lib/index.js:308-309；:59-76 按 head/body 插入）→ frontend-static 对 dist index 调 `ctx.webServer.renderIndex(...)`（dsh-host-frontend-static:80）→ 浏览器得到含 `<script>globalThis["__DSH_BOOT__"]=...</script>` 的 index.html（**curl 实测命中**）。即：**boot graph 由当前加载的插件树实时组装**——改 cordis.patch.yml（增删插件）重启后即反映在 __DSH_BOOT__；client bundle 内容变化经 `rev` 哈希体现。
- **dev watcher 是否在跑**：**没有**。`ps aux` 无 vite/tsdown/dev:web 相关进程；无 5173/5174 监听；boot graph 中的 `dsh-client-hmr` 仅是浏览器侧接收器（且 cordis.patch.yml 里 hmr 被 `disabled: true`，见 web-app bundle patch `- id: hmr, disabled: true`）。
- **重启验证步骤**：`npx @deepseek-ai/dsh web`（或 `npm exec dsh web`，从 `~/.dsh/profiles/web` 起）→ 等 3080 就绪 → 浏览器强刷 → 查 `__DSH_BOOT__` 里 `@local/dsh-btw` 的 rev 已变 → 逐项验收（§6 验证步骤）。

### E3. 改动面评估

**主输入框侧**：**零改动**——粘贴图片→附件轨→随消息发送在运行版已完整实现（E1 证据）。若用户观察到主输入框"不支持粘贴"，应先在运行 GUI 实测（可能是当前模型无图能力导致发送被拒——主壳图片摄取本身在 client 侧完成，拒收发生在 host 模型门控/`UNSUPPORTED_CONTENT`，见 2a/2d）。

**btw 侧（真正缺口）**，最小改动清单：
1. `src/shared/remote.ts`：`sendSideChatRequestSchema` 加 `parts?: z.array(z.discriminatedUnion(['text','image']))`（或 `images?: {mediaType, data(base64), name?}[]`），对齐主壳 `PromptContentPart`（dsh-host-apiproxy sessions.d.ts:86-90）；`sideChatTranscriptMessageSchema`（remote.ts:44-47）加可选 image 引用（attachmentId/mediaType）供转录显示。
2. `src/host/side-chat-service.ts` `send()`（:684-720）：接受 parts，把 image part 提升为持久附件（复用 `attachments.saveImage`，dsh-attachment:206-210；或直接构造 ImageBlock 引用），`followup(createUserMessage({content: blocks}))`；`transcript`（:110-112）支持 image 块渲染。
3. `src/client/SideChatSurface.tsx`：textarea（:376）加 `onPaste`（复刻主壳 :3824-3855 逻辑）+ 迷你附件轨（缩略图/删除）；`view-store.ts` draft 加 `images?: {id, mediaType, data, previewUrl}[]`。
4. `src/client/controller.ts` `send()`（:185-209）：带 images 走新协议。
5. 模型能力：`~/.dsh/settings.yaml` 给 btw 可用模型加 `input: [text, image]`（当前缺失，2d 证据）。
6. 可选：把 `analyze_image`（vision-adam）加进 tool-policy.ts:20-25 白名单做兜底（路径 C）。

**能力共享判断**：btw 与主壳共享的是**宿主协议与主机管道**（PromptContentPart 形态、attachments、followup ImageBlock、adapter base64）——这些在 DSH 包里，天然共享，btw 无需自带；**不共享**的是 UI 附件轨组件：主壳轨道在 `dsh-client-ui-attachment`（依赖 `dsh-client-ui-conversation` 的 `conversation.input.attachments` 槽与 useProjection 注入位），btw 的 client bundle 外部依赖表（tsdown.config.ts:12-22 CLIENT_EXTERNALS）没有它、且该包依赖 conversation 槽位体系——**建议 btw 自建迷你轨**（自身 CSS 即可，side-chat.module.css 已有体系），只对齐 wire 协议，不引 ui-attachment 组件。

---

## 8. 结论摘要（返回给主代理）

- **(a) 关键文件+行号**：见各节；核心：`side-chat-service.ts:63-66/337-431/516-532/684-737/777-788`、`controller.ts:72-76/118-209/421-429`、`tool-policy.ts:20-31`、`shared/remote.ts:13/44-47/93-97`、`btw-registry.ts:21-30/75-153`、`SideChatSurface.tsx:286-299/376`、`presentation.tsx:109-146/185`、`tsdown.config.ts:66-88`、`scripts/smoke-build.mjs:16-20`。
- **(b) R1 三条路径**：A 直接多模态消息（推荐；全链官方支持，证据 2a；前置=settings.yaml 声明 `input:[text,image]`）；B 落盘+read_image（可行；read_image=读文件+喂图二合一、过同一模型门控，dsh-tool-fs:934-942/987-995）；C 复用 vision-adam analyze_image（绕过门控、任何模型可用、图片仅文本摘要进上下文；需加白名单）。当前三个 btw 模型 inputModalities 均为 `['text']`（pi-ai:906/682 + settings.yaml 未声明），**不加声明则 A/B 均被拒**。
- **(c) R2 数据源与 UI**：树枚举 host 侧 `listChildren/listDescendants`+`subagent/catalog` 事件（dsh-subagent:2071-2102/1504-1520），client 侧 `subagentsByParent`+`openSubagent`（sessions.d.ts:40/76）；跳转= `sessions.open/openSubagent` + 现有 `handleSessionChange` parked 恢复即可实现互跳；UI 建议 SideChatButton 加树级弹出菜单（最小改动）。
- **(d) R3 元数据**：projectId **不可得**（header 无该字段）；但 cwd（dsh-session types:69）+ 按 cwd 分目录持久化 + `sessionQuery.listSessions` + `session/title` 事件 + `workspaceTitleOf(cwd)` 足以支撑"项目级"（项目=cwd/workspace）；索引格式需 v2 扩展或查询时 join（推荐 join）。
- **(e) 模型路由**：已落地且运行中——默认 `deepseek-v4-flash`、三选项 deepseek-v4-flash/glm-5.3/deepseek-v4-pro（provider adam）、UI 在侧聊头部 `<select>`（"Model / 下一轮生效"）、随对话持久化（request/header）。注意 audit-btw-model.md 的 glm-5.3-flash 默认已被当前代码改为 deepseek-v4-flash。
- **(f) 构建安装验证**：`pnpm run build && node scripts/smoke-build.mjs` → `cp -r lib/ ~/.dsh/profiles/node_modules/@local/dsh-btw/` → 重启 `npx @deepseek-ai/dsh web` → 刷新 3080，查 `__DSH_BOOT__` rev。
- **(E) 主壳补充**：E1 主输入框粘贴图片**已原生支持**（ui-conversation InputBar onPaste:3824、intakeImages:3837、附件轨槽 :4006、sendSession content parts :118-137；ui-attachment 在运行 boot graph）；E2 本机**无 apps/web 源码、无 dev watcher**，GUI 为 dsh-web-frontend 预构建 dist，`__DSH_BOOT__` 由 client-modules+webserver 运行时注入；E3 主壳零改动，缺口全在 btw 侧（协议+转录+textarea+viewStore+模型声明 5 项），UI 附件轨建议 btw 自建、协议对齐主壳 PromptContentPart。

---

## 9. 未确认清单（如实标注）

1. adam 网关（llmapi.roboscience.xyz）对 deepseek-v4-flash / glm-5.3 / deepseek-v4-pro 是否真实接受图片输入 —— 外部服务，**未确认**（即使声明 `input:[text,image]` 也需实测）。
2. 子代理会话 header 上 btw 按钮的运行态渲染 —— 代码路径完整（槽位渲染 + 无 parent 类型区分），**未运行点击验证**（沙箱无法操作 GUI）。
3. `~/.dsh/btw/index.json` 中键 `"parent-3"` 的来源（非 `session-<uuid>` 格式）——**未确认**（可能为历史测试/手动产物；注册表不校验 key 格式）。
4. view_image 工具的上游语义 —— 本机两 profile 均未注册/未定义，**未确认**。
5. 当前 3080 进程的 ps 名称 —— 沙箱 ps 受限（端口确认在监听，进程行不可见）；重启命令沿用历史 runbook（npx @deepseek-ai/dsh web）。
6. web2 profile（0.1.5-rc.2）是否已作为运行目标切换 —— 当前运行实例仍是 web profile（__DSH_BOOT__ rev 与部署位一致）；web2 仅存在未启用（**未确认其 cordis.patch.yml 是否含 btw 条目**，如需切换运行需另查）。
7. dsh-taste 的 standard-glm preset 内容细节 —— 侧聊子代经 `applyChildComposition` 继承父 preset 工具面，preset 内部清单未逐项读（不影响本审计结论）。
