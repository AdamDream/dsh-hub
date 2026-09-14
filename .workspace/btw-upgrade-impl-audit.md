# btw 插件升级 v2 — 实现前审计报告（修订后方案 + 细粒度交付单元清单）

> 审计阶段子代理（adam/deepseek-v4-flash），只读 + 落盘，未改任何代码。
> 依据：方案契约 v2（.workspace/btw-upgrade-plan.md，裁决 R1-1..R1-10 / 沿用 R0-3/4/5，本报告不违背、不开新裁决）、现状审计（.workspace/btw-upgrade-audit.md）、四份实测证据（opencode-deepseek-v4-flash-probe / vision-flash-test / vision-exp-probe / glm53-flash-image-smoke）、dsh-btw 源码、vision-adam 部署副本、官方包 lib（web 与 web2 两份均核实）。
> 审计时间：2026-09-12。所有结论带 `文件:行号` 证据；不确定项标「未确认」。

---

## 0. 结论总览

| 核实点 | 结论 |
|---|---|
| 1 主会话图片 hook 点 | **宿主面存在可挂拦截点（`agent/pre-step` waterfall 可变换任意 agent 的消息），但主会话浏览器图片提示在 `dsh-host-apiproxy sessions.prompt` 的模型门禁处被先行拒绝（:2749-2760），消息到不了 pre-step** → U-G = btw 内实现变换 handler + **官方包最小 patch**（放行门禁并把图片交给插件变换） |
| 2 vision-adam 配置化 | 现 Config 7 字段（:57-65）；key 解析链 :86-99；请求构造 :123-164；**导出可复用 analyze 函数可行**（运行时 node 解析实测可从部署位 `@local/dsh-btw/lib` resolve 到 `@deepseek-ai/dsh-vision-adam`，同 profile 根）→ U-H 新 lib 设计见 §3 |
| 3 btw 图片链路 | sendSideChatRequestSchema 加图片 parts（对齐 PromptContentPart）；转录图片引用经**新 remote `sideChat/readImage`** 回读（`sessions.readAttachment` 要求图片在会话事件里，btw 子会话只收文本 → 该路由不可用，证据见 §4.3）；R1-9 模板定稿见 §4.4 |
| 4 R2/R3 接线 | 数据源/跳转 API 全部现成（subagent listChildren/listDescendants、sessionQuery.listSessions、SessionSummary title/cwd、ISessions.open/openSubagent、controller.handleSessionChange）→ U-J/K 清单见 §5 |
| 5 存量 typecheck 2 错 | 已实测：`side-chat-service.ts:309:29` / `:799:33` TS18048；修法 = `entry.modelSelection?.current?.model`（仅类型收窄，无运行时语义变化） |
| 6 测试策略 | 见 §6（最小集：图片 send / 包装模板 / 分析失败 / listTree / listProject / 跳转状态；纯逻辑为主，组件用 happy-dom） |
| 7 构建验证 | pnpm 不可用，用 `node_modules/.bin` 直接二进制（oxlint / 3×tsc / vitest run / tsdown / smoke / publint），命令见 §7 |

**总体裁决：需修改（btw 内实现为主 + 1 处官方包最小 patch + vision-adam 部署副本替换）。** 官方包 patch 仅限 `dsh-host-apiproxy` 的 `sessions.prompt` 门禁放行；分析逻辑全部在 btw 插件内与 vision-adam 新 lib 内，不进入官方包。

---

## 1. 核实点 1：主会话「图片→vision-adam 转文本」的 hook 点

### 1.1 完整链路（实测代码）

```
浏览器 session.prompt(content[parts], mode)
  → dsh-host-apiproxy lib/index.js:2733 sessions.prompt handler
      :2749 hasImage = content.some(part => part.type === 'image')
      :2750-2782 admit()：
        :2753-2760 【模型门禁】hasImage 时 resolveModelInfo(current.provider, current.model)
          → inputModalities 不含 'image' → err(attachment-error / MODEL_DOES_NOT_SUPPORT_IMAGES)
        :2761-2764 createUserMessage({content: await durablePromptContent(ctx, content), source})   // 图片→持久 ref
        :2765-2766 agent.steer/followup(message)
      :2781 hasImage ? serializeImageAdmission(agent, admit) : admit()
  → dsh-agent-loop lib/index.js:396-403 followup/send → :393 inbox.splice(target, Infinity, 0, [message])
  → turn()（:521-547）→ preStep()（:492-511）：
        :496 claimed = inbox.claim(...)
        :501-505 decision = await dispatch.waterfall("agent/pre-step", {messages: claimed, turn, step, signal}, 默认 {kind:'enter', messages: claimed + context})
        :545-547 for (message of decision.messages) session.append("user/message", message)   // 决策消息=进会话+进模型的最后关口
  → step()（:547-616）→ buildRequest()（:709-765）waterfall("agent/request") → llm.stream(...)
```

### 1.2 宿主面可挂点（插件可达性验证）

- **`agent/pre-step` waterfall**（agent-loop :501-505）：handler 形如 `(payload, next)`，`decision.messages` 可整体替换，**进会话日志与进模型的都是替换后的消息**（:545-547 → :547 buildRequest 用 `session.deriveMessages()`）。对**任意 agent**（主会话含）都派发：`agentEvents(loopCtx, this)`（agent-loop :356）经 `ctx.waterfall(carrier, name, …)`（dsh-agent :361-363），carrier 过滤规则（dsh-scope lib/index.js:327-340 scopeTarget）**无 tag 的全局监听（app 级 ctx.on）对所有 agent 放行**；注册方式与 `installModelSelection` 注册 `agent/request` 完全同构（dsh-agent :272-306，btw 侧已在 side-chat-service.ts:516-532 使用同款 API）。
- **`agent/inbox/inserted` / `agent/inbox/claimed`**（agent-loop :360-369）：仅事件通知，无变换能力。
- **`session.prompt` API 层**：dsh-api-gateway lib/index.js 的 `invoke()`（:110-146）是直调，无插件中间件；`sessions.prompt` 实现内部无扩展点。
- **`session/title` 等会话事件**：发生在 append 之后，太晚。

### 1.3 决定性结论（A or B）

**门禁位置 = `dsh-host-apiproxy lib/index.js:2749-2760`**。对当前部署，pi-ai 将 adam 模型解析为 `input: ['text']`（settings.yaml:74-94 无 `input` 声明；dsh-llm-pi-ai lib/index.js:651 `declaredInput(entry.input) ?? base?.input ?? [...request.defaultInput]`，:906 `DEFAULT_INPUT = ["text"]`，:1668-1687 `inputModalities: [...model.input]`）→ **含图 prompt 在 :2755 被直接拒绝，消息根本不会进 inbox/pre-step**。因此：

- **A（纯 btw 插件面，零 patch）不成立**：pre-step hook 存在但见不到浏览器图片消息（被门禁拦截）。
- **B（最小官方包 patch）必要**：patch `dsh-host-apiproxy` 的 `sessions.prompt.admit()`，把「门禁直拒」改为「先问插件变换，变换后无图片才放行」。patch 目标与改法见 §3.1 / U-G-2。
- 变换逻辑（vision-adam 分析 + R1-9 包装）**全部在 btw 插件内**（U-G-1），官方包不含任何分析代码。

> 附：`subagents.prompt` 路径在 `dsh-subagent` 有同型门禁（web2 lib/index.js:1948-1956 `assertImageCapable`）。R1-3 范围是主会话；子代理会话直发图片**不在本次范围**（见 §9 未确认 8）。btw 侧聊走 `agent.followup` 直连（side-chat-service.ts:712），绕开两个门禁，无此问题。

---

## 2. 核实点 2：vision-adam 插件配置化改造规格

### 2.1 当前 Config 与 settings 注册（只读 lib/index.js 全文 248 行）

- **Config（z.object，:57-65）7 字段**：`apiKey`(secret)、`apiKeyEnv`(credential-ref, default `ADAM_API_KEY`)、`baseURL`(default `https://llmapi.roboscience.xyz/v1` :24)、`model`(default `gemini-3.6-flash` :26)、`maxTokens`(1024 :30)、`maxBytes`(20MiB)、`maxVideoBytes`(50MiB)。
- **settings 注册**：`:68` `settingsNamespace("vision-adam")`；`:188-193` `installSettingsSection(ctx, VISION_ADAM_SETTINGS_NAMESPACE, Config, {...}, {setSource, onChange})` → 热加载（README + settings.yaml:135-137 现值为 `{model: glm-5.3-flash, maxTokens: 100000}`）。
- **API key 与认证（:86-99 resolveApiKey + :124-129 请求头）**：优先字面 `apiKey`；否则 `ctx.get("credentials")` resolve `credentialRef(config.apiKeyEnv)`（= `~/.dsh/.credentials.yaml` refs）；再退 launch env；缺失抛错（:98）。请求头仅 `authorization: Bearer <key>` + `content-type` + `user-agent`（:124-129）——**没有 x-api-key / x-opencode-session**。
- **图片请求构造与响应处理**：`:123` `fetch(`${options.baseURL}/chat/completions`)`；`:131` `model: options.model`；`:139` 图片 → `{type:"image_url", image_url:{url:"data:<mediaType>;base64,<base64>"}}`（IMAGE_TYPES :39-45）；`:145-155` 非 2xx 抛错；`:161-164` `content` 为空 → **回退返回 `reasoning_content`**；`:169-180` `ctx.fs.readBytes`（maxBytes/maxVideoBytes）；`:241` base64 编码。`analyze_image` 工具实现 :229-245，返回 `{text}`。
- **导出（:248）**：`Config, VISION_ADAM_SETTINGS_NAMESPACE, apply, inject, name` —— **目前无可复用 analyze 函数**。

### 2.2 配置化扩展的最小字段集（U-H，R1-5 落地）

| 字段 | 现值/类型 | 新值（默认） | 说明 |
|---|---|---|---|
| `model` | string, default gemini-3.6-flash | **`deepseek-v4.1-flash`**（opencode 网关实测可看图，probe §二/三） | R1-4 |
| `baseURL` | default adam v1 | **`https://opencode.ai/zen/go/v1`** | opencode 三头认证网关 |
| `apiKeyEnv` | default `ADAM_API_KEY` | **`OPENCODE_GO_API_KEY`**（.credentials.yaml 实测存在，probe §一） | |
| `apiKey` | secret（字面覆盖） | 保留 | 兼容 |
| `maxTokens` | 1024 | **2000**（probe 实测 max_tokens ≥ 2000） | 保留覆盖能力（settings.yaml 现 100000 继续生效） |
| `xApiKey`（新） | — | `z.boolean().default(true)` | 发送 `x-api-key: <同 key>` 头（opencode 三头之一） |
| `sessionHeader`（新） | — | `z.boolean().default(true)` | 每请求发送 `x-opencode-session: <crypto.randomUUID()>`（三头之一，probe §一） |
| `maxBytes` / `maxVideoBytes` | 保留 | 保留 | 兼容 |

- **认证头（新请求头集合）**：`authorization: Bearer <key>` + `x-api-key: <key>` + `x-opencode-session: <随机 UUID>` + `content-type` + `user-agent`（probe §一实测三头缺一不可；对 adam 网关这些附加头无害，旧配置若仍走 adam 可不配新字段或显式关闭）。`x-opencode-session` 每次请求生成（`crypto.randomUUID()`）。
- **向后兼容**：旧 `vision-adam` 段 `{model, maxTokens}` 继续有效（显式值优先）；未设 `baseURL/apiKeyEnv` 走新默认 opencode（部署步骤会同步更新 settings.yaml:135-137 到 `model: deepseek-v4.1-flash / baseURL: https://opencode.ai/zen/go/v1 / apiKeyEnv: OPENCODE_GO_API_KEY`，R1-5）。`reasoning_content` 回退（:161-164）保留。
- **可复用导出**：新增 `export async function analyzeImageBytes(opts, apiKey, mediaType, base64, question, signal): Promise<string>`（现 adamAnalyze 改造）、`export function resolveOptions(config)`、`export async function resolveApiKey(opts, ctx, signal)`（保留凭据链）、`export { Config, VISION_ADAM_SETTINGS_NAMESPACE, IMAGE_TYPES, DEFAULT_* }`；`apply/inject/name` 不变。

### 2.3 从 btw 导入的可行性（e 项）

**可行（实测）**。部署位 `~/.dsh/profiles/node_modules/@local/dsh-btw/lib/` 与 `@deepseek-ai/dsh-vision-adam` 同属 `~/.dsh/profiles/node_modules/`（vision-adam 为真实目录，非符号链接），Node 标准向上解析即可命中；本审计实测：

```
node -e require.resolve('@deepseek-ai/dsh-vision-adam', {paths:['…/profiles/node_modules/@local/dsh-btw/lib']})
→ …/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js   ✓
（同 paths 下 @deepseek-ai/dsh-settings、dsh-credentials 也解析成功 → 模块顶层依赖齐备）
```

- 构建侧：`@deepseek-ai/dsh-vision-adam` 需加入 tsdown.config.ts `deps.neverBundle`（node entry，:70-74），类型走本地 ambient 声明 `src/shared/vision-adam.d.ts`（`declare module '@deepseek-ai/dsh-vision-adam'`，因 dsh-btw/node_modules 无该包，devDeps 也无法安装——pnpm 本环境不可用）。运行时 import 在部署位生效。
- 若 tsdown 对 neverBundle 新条目出现解析/类型问题（未确认），退路：`createRequire` 动态 require + 同 ambient 类型（二选一，执行阶段定，优先静态 import）。
- btw 内复用入口：`import { analyzeImageBytes, resolveOptions, resolveApiKey } from '@deepseek-ai/dsh-vision-adam'`；配置单一源 = `ctx.get('settings')?.get('vision-adam')`（SettingsProvider.get，dsh-settings lib/index.js:388-391，vision-adam 插件已注册该命名空间；未注册/无 settings → btw 用默认值兜底）。

---

## 3. 修订后的方案（对照 v2 契约）

保持 v2 全部裁决不变（R1-1..R1-10、R0-3/4/5），仅对**实现形态**作以下修订（均由 §1-2 证据驱动）：

1. **U-G 形态修订（契约 §A.3「宿主侧消息管线 hook」）**：确认 btw 插件面 pre-step 可变换消息，但主会话图片被 host-apiproxy 门禁先行拒绝 → 增加 **1 处官方包最小 patch**（`dsh-host-apiproxy lib/index.js:2749-2782`），放行语义 = 问插件变换、变换后无图片才跳过门禁；分析逻辑在 btw 内。原契约「若 btw 插件面无 hook 点 → patch」判定为**部分成立**（hook 面有但被门禁短路，仍需 patch 放行）。
2. **转录图片回读修订（契约 §A.2「attachmentId 读取路由」）**：`sessions.readAttachment` 要求图片在会话事件日志中（host-apiproxy `sessions.attachment` 用 `referencedImage(state.events, …)` 校验，:2801-2831），而 btw 子会话**只进文本**（R1-2）→ 图片 ref 不在子会话事件 → 该路由不可用。改由**新增 remote `sideChat/readImage`**（host 用 `ctx.attachments.readImage(ref)` 直接回读，dsh-attachment lib/index.d.ts:57）。
3. **列表数据修订（契约 §D）**：索引 v2 增加 `parentTitle?/parentCwd?/lastPreview?`（在 start/send/read 的 touch 时机顺带更新，避免冷会话逐条 load events 取标题/预览）；`listTree/listProject` 查询时再与 live 会话事件做新鲜度 join。
4. **其余契约设计（A 协议、B 配置、C 复用、D 列表 UI、E 索引、F 部署）全部保留**。

### 3.1 官方包 patch 规格（唯一 patch）

- **目标文件**：`~/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js`（package.json `main` 指向它；profiles 根符号链接 farm 亦解析到此文件，§8 未确认 1）。
- **目标函数**：`sessions.prompt` 的 `admit()`（:2750-2782）。
- **改法（最小）**：在 `if (hasImage) {…}` 门禁前插入一次插件变换瀑布：
  ```js
  let effective = content;
  if (hasImage) {
    const transformed = await ctx.waterfall("session/prompt-image-transform", { agent, content }, () => void 0);
    if (transformed !== void 0) effective = transformed;
  }
  const nowHasImage = effective.some((part) => part.type === "image");
  // 原门禁仅对 nowHasImage 生效；createUserMessage/durablePromptContent/followup 改用 effective
  ```
  （`ctx.waterfall` 为 cordis 混入的通用方法——cordis lib/index.js:317-331 实现、:1345 已有 `this.context.waterfall(this, "internal/config", …)` 用法，dsh-agent 亦以同机制调度 `agent/request`（dsh-agent :287-306）；apiproxy 的 ctx 为普通 cordis 上下文，方法必然存在。无插件监听时 fallback 返回 undefined → 行为与现状完全一致。）
- **产物**：`.workspace/deploy/patches/dsh-host-apiproxy.sessions-prompt-transform.patch`（diff）+ 应用后完整文件副本；应用前备份原文件到 `~/.dsh/backups/`。官方包 patch 先例：`~/dsh-upgrade-backup/patched-official-files.tgz`（审计 §0）。
- **验收**：无 btw 监听时含图提示行为 = 现状（文本模型拒绝 / 图片模型放行）；btw 监听后含图提示 → 变换为纯文本 → 任何模型放行；变换抛错 → 原 catch（:2767-2776）→ `agent-busy` + details.reason 报错、不发送。

---

## 4. 核实点 3：btw 图片链路细节

### 4.1 send 协议图片 parts（契约 §A.1）

对齐主壳 `PromptContentPart`（dsh-host-apiproxy lib/types/api/sessions.d.ts:86-90：`{type:'text',text} | {type:'image', mediaType: ImageMediaType, data: string, name?}`）：

```ts
// src/shared/remote.ts（U-A）
export const sideChatImagePartSchema = z.object({
  type: z.literal('image'),
  mediaType: z.enum(['image/png','image/jpeg','image/webp','image/gif']),   // 对齐 dsh-attachment ImageMediaType
  data: z.string().min(1),                                                  // canonical base64（host 用 admitEncodedImages 校验）
  name: z.string().optional(),
}).strict()
export const sendSideChatRequestSchema = z.object({
  chatToken: z.string().uuid(),
  requestId: z.string().uuid(),
  text: z.string(),                                                          // 保留必填（R1-9「用户原文」；空文本+仅图片 = 允许）
  images: z.array(sideChatImagePartSchema).optional(),
}).strict()
```

### 4.2 转录图片引用与读取路由

- `sideChatTranscriptMessageSchema`（remote.ts:44-47）增加 `images: z.array(z.object({ attachmentId: z.string(), mediaType: z.enum([...]), name: z.string().optional() }).strict()).optional()`（U-B）。
- **读取路由**：客户端拿到 attachmentId 后调新 remote **`sideChat/readImage`** `{chatToken, attachmentId}` → `{ok:true, value:{mediaType, data(base64)}}`（U-B）；host 侧 `ctx.attachments.readImage(ref)`（dsh-attachment lib/index.d.ts:57，返回 `{ref, data: Uint8Array}`）→ base64。客户端渲染 `<img src="data:…">` 缩略图 + 点击放大（U-L），按 attachmentId 做本地缓存。
- **保存时机**：host `send()` 收到图片 → `admitEncodedImages(ctx.attachments, images)`（dsh-attachment lib/index.js:94，校验 canonical base64/数量/字节/类型并返回 refs）→ refs 记录在 entry（`imageRefsByMessageId: Map<messageId, refs>`，U-E）→ 分析用 `readImage(ref)` 取字节；refs 不进子会话事件（不进模型上下文）。

### 4.3 为什么不能用 `sessions.readAttachment`

host-apiproxy `sessions.attachment`（:2801-2831）→ `referencedImage(state.events, attachmentId)`（:920-939）要求 ref 出现在**该会话的事件日志**（user/message 或 assistant 内容、tool-result 嵌套、inbox spliced）。btw 子会话 followup 的只有文本（R1-2）→ ref 不在事件 → `ATTACHMENT_NOT_REFERENCED`。主会话经 patch 后的变换路径同样把图片在 append 前换成文本 → 主会话日志也没有图片 ref（与验收 6.4.a「消息变成描述文本」一致，主壳粘贴图在发送后不再显示原图，仅显示包装文本——属预期行为）。

### 4.4 R1-9 模板最终措辞（U-I，逐图分段）

```
用户附带了 N 张图片，以下为各图片的描述（vision-adam 生成）：

[图片 1] <第 1 张描述>

[图片 2] <第 2 张描述>

用户原文：
<原 text 去首尾空白>
```
- N=0 不发模板（无图片走原路径）；`用户原文` 为空（纯图片消息）时该段省略，模板尾部不再留空行。
- 模板以**单条 user 文本块**拼进消息（主会话经变换返回 `[{type:'text',text:模板}]`；btw 侧聊构建 `content:[{type:'text',text:模板}]`）。

---

## 5. 细粒度交付单元清单（执行阶段逐条落地）

> 约定：`dsh-btw` 工作区 = `/home/CNS2026495165/dsh/dsh-btw`。每单元含：文件、位置、改动、验收标准、依赖。单元间依赖为硬序（D 列）。

### U-A 协议：send 请求图片 parts
- 文件/位置：`src/shared/remote.ts` — `sendSideChatRequestSchema`（现 :93-97，text-only）。
- 改动：新增 `sideChatImagePartSchema` 与 `sideChatImagePart` 类型；`sendSideChatRequestSchema` 增加 `images: z.array(sideChatImagePartSchema).optional()`；`SendSideChatRequest` 类型同步。
- 验收：zod round-trip 测试：合法 payload 解析通过；`type:'image'` 缺 mediaType/data 拒绝；未知键 strict 拒绝；无 images 的旧 payload 仍通过（向后兼容）。
- 依赖：无。

### U-B 协议：转录图片引用 + readImage + listTree/listProject schema
- 文件/位置：`src/shared/remote.ts` — `sideChatTranscriptMessageSchema`（:44-47）、新增 schema。
- 改动：
  1. `sideChatTranscriptMessageSchema` 增加 `images?: {attachmentId, mediaType, name?}[]`（`SideChatTranscriptMessage` 同步）。
  2. 新增 `readSideChatImageRequestSchema {chatToken: uuid, attachmentId: string}` / `readSideChatImageResultSchema`（discriminatedUnion ok：`{ok:true,value:{mediaType,data(base64)}}` / `{ok:false,error}`）。
  3. 新增 `listSideChatTreeRequestSchema {parentSessionId}` / `listSideChatProjectRequestSchema {parentSessionId}`；结果 schema：`{ok:true, value:{entries:[{parentSessionId, childSessionId, title?, cwd?, lastActiveAt, preview?, running?}]}}`（listProject 另带 `cwd`），错误分支复用 `sideChatErrorSchema`。
- 验收：remote-contract.spec 扩展覆盖新 schema 的合法/非法 round-trip；类型与部署后 wire 一致。
- 依赖：U-A（枚举复用）。

### U-C 协议接线：descriptor 7→9 + typert members + client namespace + smoke
- 文件/位置：`src/remote-descriptors.ts`（:34-42）、`src/typert.host.ts`（:11-21）、`src/client/remote.ts`（:9-30）、`scripts/smoke-build.mjs`（:16-20）。
- 改动：`sideChatRemoteDescriptors` 追加 `listTree`/`listProject` 两条 directDescriptor（sourceLocation line 指向新 host 方法行）；`typert.host.ts` members 追加 2 项（签名与 summary 文案：「Enumerate side conversations under one session tree.」/「Enumerate side conversations grouped by the parent session's working directory.」）；`client/remote.ts` 接口与 TypertRemoteMap 各 +2；smoke-build 断言 7→9（`typert.TYPERT.invocations.length`、`remote.TYPERT_REMOTE.descriptors.length`）。
- 验收：`node_modules/.bin/tsc`（3 config）+ `vitest run`（package-contract.spec 更新为 9 项断言）+ `node scripts/smoke-build.mjs` 全绿；`lib/typert.host.js` 实测 9 invocations。
- 依赖：U-A/U-B。

### U-D host：send() 图片链路（核心）
- 文件/位置：`src/host/side-chat-service.ts` — `send()`（:684-720）、`LiveSideChat`（:215-230）、`PendingSideChatMessage`（:232-237）、`static inject`（:319）、`errorText`（:98）。
- 改动：
  1. inject 增加 `'attachments'`、`'settings'`、`'subagents'`、`'sessionQuery'`（后三者 U-J 用，本单元先加声明）。
  2. `LiveSideChat` 增加 `imageRefsByMessageId: Map<string, readonly ImageAttachmentRef[]>`（`ImageAttachmentRef` 类型从 `@deepseek-ai/dsh-attachment` import type）。
  3. `send()`：`const text = request.text.trim()` 空校验改为「text 空 **且** images 空/缺」才拒绝；images 非空时先 `admitEncodedImages(ctx.attachments, request.images)`（AttachmentError → `invalid-input` + 原 message 报错，不发送、不 touch）；对每 ref `ctx.attachments.readImage(ref)` 取字节 → base64 → 调 U-I 的 `analyzeImages()`（vision-adam）→ 逐图描述；失败 → `{ok:false, error:{code:'internal', message:'vision-adam 分析失败: …'}}`，**不 followup、不 touch**（R1-8：报错不发送可重试，requestId 不记 sentRequests，重试即重发）；成功后构建 R1-9 文本消息 `createUserMessage({content:[{type:'text',text:模板}]})`（模型只收文本，R1-2），`imageRefsByMessageId.set(messageId, refs)`，再走现有 sentRequests/幂等/pendingByRequest/followup 逻辑（:703-713 顺序）。
  4. `PendingSideChatMessage` 增加 `images?: readonly ImageAttachmentRef[]`（供 U-F 转录乐观输出）。
- 验收：host-opening/host-lease 风格测试——mock attachments（saveImages 返回 refs、readImage 返回字节）+ mock vision 模块：含图 send → followup 收到纯文本模板消息、refs 入 map；分析抛错 → 返回 error、followup 未调用；空 text + 无 images → invalid-input；幂等 requestId 复用不变。
- 依赖：U-A/U-B（schema）、U-I（analyzeImages）。

### U-E host：transcript 图片输出
- 文件/位置：`src/host/side-chat-service.ts` — `transcript()`（:246-316）。
- 改动：user 消息条目按 `event.data.id` 从 `entry.imageRefsByMessageId` 取 refs → `images: refs.map(r => ({attachmentId: String(r.attachmentId), mediaType: r.mediaType, ...r.name===undefined?{}:{name:r.name}}))`（只对真实 host 消息；pending 乐观消息如有 refs 同样输出）；`SideChatTranscriptMessage` 类型随 U-B 同步。
- 验收：transcript 测试——含图发送后 read 返回消息带 images 数组；无图消息不带 images 键（exactOptionalPropertyTypes 下不要输出 undefined 键）。
- 依赖：U-B、U-D。

### U-F host：readSideChatImage 方法
- 文件/位置：`src/host/side-chat-service.ts` — 新增 `@Remote` 风格方法（与 read/send 同文件，descriptor sourceLocation line 更新）。
- 改动：`readSideChatImage(request)`：查 entry（not-open 语义同 read :676-682）→ `entry.imageRefsByMessageId` 中查找含该 attachmentId 的 ref（找不到 → `invalid-input`）→ `ctx.attachments.readImage(ref)` → base64 → `{ok:true,value:{mediaType,data}}`。
- 验收：测试——有效 chatToken+attachmentId 返回 base64；未知 attachmentId → error；未 open → not-open。
- 依赖：U-B、U-D。

### U-G-1 btw 内实现：主会话图片变换 handler
- 文件/位置：`src/index.ts`（`apply()`，:6-8）或 `src/host/prompt-transform.ts`（新建，推荐：独立模块便于测试）+ `src/host/side-chat-service.ts` 不动。
- 改动：在 app ctx 注册 `ctx.on('session/prompt-image-transform', async ({agent, content}, next) => {...})`（waterfall 语义 `(payload, next)`，与 dsh-agent installModelSelection 的 agent/request handler 同构）：`const resolved = await next()`；若 `resolved` 非 undefined 用之（其他插件已变换）；对 `resolved ?? content` 中 `type:'image'` 的 parts 逐张调 U-I `analyzeImages`（base64 直接可用，无需落库）；全部成功 → 返回 `[{type:'text',text:R1-9模板}]`；任一失败 → throw（错误信息含 vision-adam 原因，apiproxy catch 报 agent-busy + details.reason）。**只处理 image part；text part 并入模板「用户原文」。** 注册生命周期用 `ctx.effect`（随插件卸载）。
- 验收：纯逻辑测试——mock analyzeImages：输入 2 图 1 文 → 返回模板文本；失败 → 抛错且 next 未被推进；无 handler 时（patch 侧）行为不变由 U-G-2 测试覆盖（host-apiproxy patch 用单独脚本验证，见下）。
- 依赖：U-I、patch（U-G-2）。

### U-G-2 官方包 patch：dsh-host-apiproxy 门禁放行
- 文件/位置：产物 `.workspace/deploy/patches/dsh-host-apiproxy.sessions-prompt-transform.patch` + 应用后的完整文件副本（只读应用目标：`~/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js:2749-2782`；应用前备份 `~/.dsh/backups/dsh-host-apiproxy.lib.index.js.<ts>.bak`）。
- 改动：`admit()` 内 hasImage 分支前置一次 `ctx.waterfall("session/prompt-image-transform", {agent, content}, () => void 0)`；非 undefined 则用变换结果作为有效 content；门禁/durablePromptContent/followup 全部改用有效 content（§3.1 精确改法）。行为等价性：无监听时 fallback undefined → 原逻辑（拒绝或放行）。
- 验收（执行阶段落地后）：
  1. patch 前备份存在、diff 可逆；
  2. 无 btw 场景回归：含图 + 文本模型 → 仍 `MODEL_DOES_NOT_SUPPORT_IMAGES`；含图 + 图片模型 → 放行（可构造 stub adapter 实测或人工验收）；
  3. btw 场景：主会话含图 prompt → 消息变纯文本进模型（验收 6.4.a）；
  4. 变换抛错 → prompt 返回 `agent-busy`、消息未进会话（验收 6.4.c 主会话侧）。
- 依赖：U-G-1、U-I。

### U-H vision-adam 新 lib（部署副本替换产物）
- 文件/位置：新源码 `.workspace/deploy/vision-adam/lib/index.js`（替换 `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js`，源已丢失 → 以部署副本为基线改造；先备份）。
- 完整设计（§2.2 规格落地）：
  1. Config 新增 `xApiKey: z.boolean().default(true)`、`sessionHeader: z.boolean().default(true)`；`apiKeyEnv` default → `OPENCODE_GO_API_KEY`；`baseURL` default → `https://opencode.ai/zen/go/v1`；`model` default → `deepseek-v4.1-flash`；`maxTokens` default → 2000。
  2. `resolveOptions`/`adamAnalyze`（现 :71-83/:123-164）改造：请求头 = `authorization: Bearer` +（xApiKey && `x-api-key`）+（sessionHeader && `x-opencode-session: crypto.randomUUID()`）+ content-type + user-agent；图片格式、`reasoning_content` 回退（:161-164）、maxBytes/maxVideoBytes、错误语义全部保留。
  3. 新增导出：`analyzeImageBytes(opts, apiKey, mediaType, base64, question, signal): Promise<string>`（现 adamAnalyze 的纯函数化：接收 base64 而非文件路径）、`resolveOptions(config)`、`resolveApiKey(opts, ctx, signal)`；`Config/VISION_ADAM_SETTINGS_NAMESPACE/apply/inject/name` 保持导出；`analyze_image` 工具实现改为复用上述函数（行为不变）。
  4. `node:` 内置 imports（`node:path` extname）与 `@deepseek-ai/*` imports 不变（部署位可解析）。
- 验收：
  1. `node --check`（或直接加载）通过；
  2. 用真实 v4f-test.png + 新默认（opencode/deepseek-v4.1-flash/OPENCODE_GO_API_KEY）本地跑 `analyzeImageBytes` → 返回包含「V4F-73/绿底/红方块」的描述（probe §二 ground truth）；不设 OPENCODE_GO_API_KEY 时凭 .credentials.yaml refs 解析成功（三头认证请求 200）；
  3. 旧 settings 形态（只配 model/maxTokens）不报错（默认值生效）；
  4. 部署后 GUI 内 vision-adam analyze_image 工具仍可用（验收 6.4.f）。
- 依赖：无（独立产物，供 U-I 运行时导入）。

### U-I btw 内 vision 分析模块
- 文件/位置：新建 `src/host/vision.ts` + `src/shared/vision-adam.d.ts`（ambient）+ `tsdown.config.ts`（:70-74 neverBundle 追加 `'@deepseek-ai/dsh-vision-adam'`）。
- 改动：
  1. `vision.ts`：`export interface VisionOptions { model?, baseURL?, apiKeyEnv?, apiKey?, maxTokens?, xApiKey?, sessionHeader? }`；`export function wrapImageDescriptions(descriptions: readonly string[], originalText: string): string`（R1-9 模板，纯函数）；`export async function analyzeImages(ctx, images: readonly {mediaType, data}[], signal?): Promise<string[]>`：读 `ctx.get('settings')?.get('vision-adam')`（无 → 默认值 `{model:'deepseek-v4.1-flash', baseURL:'https://opencode.ai/zen/go/v1', apiKeyEnv:'OPENCODE_GO_API_KEY', maxTokens:2000}`）→ `resolveOptions(config)` → `resolveApiKey(opts, ctx, signal)`（失败 → throw 明确「vision-adam 凭据不可用」）→ 逐图 `analyzeImageBytes`（mediaType 取 image part，question 传默认「请用中文简洁描述这张图片的内容、主体颜色与图中文字。」）。
  2. ambient d.ts：`declare module '@deepseek-ai/dsh-vision-adam' { export function resolveOptions(c: unknown): unknown; export async function resolveApiKey(o: unknown, ctx: unknown, s?: AbortSignal): Promise<string>; export async function analyzeImageBytes(o: unknown, key: string, mediaType: string, base64: string, q?: string, s?: AbortSignal): Promise<string>; }`（精确签名以 U-H 定稿为准）。
  3. tsdown neverBundle 追加（保留外部 import；运行时部署位解析已在 §2.3 实测可行）。
- 验收：`wrapImageDescriptions` 单测覆盖 R1-9 措辞（1 图/2 图/空原文三种）；`analyzeImages` 在 mock vision-adam 下：设置读值→参数透传→逐图返回；凭据/网络失败 → 错误信息可读（供 U-D/U-G-1 报错透传）。
- 依赖：U-H（运行时）。

### U-J host：listTree / listProject
- 文件/位置：`src/host/side-chat-service.ts`（新方法，descriptor sourceLocation 对齐）+ `src/host/btw-registry.ts`（索引 v2）。
- 改动：
  1. `btw-registry.ts`：`BtwIndexEntry` 增加 `parentTitle?`、`parentCwd?`、`lastPreview?`（:21-25）；`parseIndex`（:44-63）容忍缺失（v1 兼容）；`set()`（:89-107）/`touch()`（:110-123）签名扩展可选参数并写入；`EMPTY_INDEX` version 保持 1（加字段即可，无需 bump，向后兼容）。
  2. `side-chat-service.ts`：start()（:337+）与 read()/send() touch 时顺带更新 `parentTitle`（parent live events 最后一条 `session/title`（dsh-session 事件表 :1081）的 data.title，缺则 `header.cwd` basename）、`parentCwd`（parent.session.header.cwd）、`lastPreview`（child live events 最后一条 user/assistant 文本，`contentText` :110 复用）。
  3. 新方法 `listTree(request)`：`{ok:true, value:{entries}}`——根 = 自身；树成员 = `await ctx.get('subagents')?.listDescendants(parentSessionId, signal)`（web2 dsh-subagent lib/index.js:2088，返回含 parentId/depth 的行）+ 自身；条目 join `BtwRegistry.load()`（childSessionId/lastActiveAt）与 live 会话（`ctx.get('sessions').get(id)`：title/cwd/running/preview 新鲜值优先，cold 用索引值）。
  4. 新方法 `listProject(request)`：`cwd` = parent header.cwd（无 → 空列表）；`ctx.get('sessionQuery')?.listSessions(signal)`（dsh-session-query lib/index.js:802）→ 过滤 `realpath(header.cwd) === realpath(rootCwd)` 的会话 id 集合 → 与注册表 join（同 listTree 条目渲染）。
- 验收：host 测试——mock subagents.listDescendants/sessionQuery.listSessions/sessions.get：树内/树外、同 cwd/异 cwd 分组正确；索引 v1 旧文件读取不抛错；touch 更新 lastPreview/parentTitle 后 listTree 返回新值。
- 依赖：U-A/B/C（schema）、inject 声明（U-D 步骤 1）。

### U-K client：listTree/listProject 获取 + 跳转
- 文件/位置：`src/client/controller.ts`（新增方法 + 状态）、`src/client/remote.ts`（U-C 已含类型）。
- 改动：
  1. `SideChatController` 新增 `listTree(): Promise<…>` / `listProject(): Promise<…>`（调 remote，返回 `SideChatCommandResult` 或直接结构化结果）+ 内存缓存 `treeByParent`/`projectByParent`（订阅 `sessions.list` 变化时失效，重取）。
  2. 新增 `jumpTo(parentSessionId): Promise<void>`——**跨会话跳转调用序列（定稿）**：
     a. `this.sessions.open(parentSessionId as SessionId)`（ISessions.open，client-runtime sessions.d.ts:51）——触发 `sessions.list` 订阅 → `handleSessionChange()`（controller.ts:421-429）：先 parkVisible（若当前可见侧聊属于其他 parent），再因 phase 变 closed → `restoreExisting(target)` 恢复目标 parent 的 parked 侧聊；
     b. 若 target 是 catalog 子代理且不在 byId（兜底）：`this.sessions.openSubagent(address)`（:55，address = `subagentsByParent` 对应条目的 `{parentSessionId, childSessionId, mode}`）；
     c. `await this.open(parentSessionId)`（controller.ts:114-120，幂等：已可见则早退；否则 restoreExisting 或 fresh start）；
     d. `viewStore.show(parentSessionId, …)` + presentation 对齐（沿用现有 show 逻辑）。
  3. `hasConversation` 兼容树条目（非当前会话也能识别）。
- 验收：controller.spec 扩展——mock ISessions（含 open/openSubagent/subagentsByParent）与 remote：jumpTo 使 list 变化 → 旧侧聊 parked、目标侧聊恢复或新开；openSubagent 兜底路径；重复 jumpTo 幂等。
- 依赖：U-C、U-J。

### U-L client UI：跳转列表 + 附件轨 + 消息图片渲染
- 文件/位置：`src/client/SideChatDrawer.tsx`（结构）、新建 `src/client/SideChatJumpList.tsx`、`src/client/SideChatSurface.tsx`（:38-450 composer 区/消息区）、`src/client/view-store.ts`（附件状态）、`src/client/side-chat.module.css`、`src/client/locales.ts`（zh/en 键）。
- 改动：
  1. `SideChatViewState` 增加 `attachments: readonly {mediaType, data(base64), name?}[]` 与 `jumpOpen: boolean`（:3-15；EMPTY_VIEW :10-15 兼容）；方法 `addAttachment/setAttachments`。
  2. Surface composer：textarea `onPaste`（`clipboardData.files` → `FileReader.readAsDataURL` → addAttachment）+ 附件轨渲染（缩略图 + 移除按钮 + 计数）；发送时 `controller.send(text, attachments)`（controller.send 签名扩展：图片并行走 U-D 协议）→ 成功后清空附件轨。
  3. 消息区：`message.images` 渲染缩略图（`<img src="data:…">`，字节经 U-F readImage 获取，Map<attachmentId,dataURL> 缓存）+ 点击放大（复用现 Modal 或简版 lightbox）。
  4. JumpList：抽屉内「当前会话树」「项目全部」两个 tab（可折叠，R0-3/R0-4）——数据来自 U-K 的 listTree/listProject；条目 = 标识（title/displayTitle）+ 最后活跃时间（lastActiveAt）+ 最后消息预览（preview 截断，R0-5）；点击 → `controller.jumpTo(parentSessionId)`；当前项高亮。
- 验收：`side-chat-surface.spec.tsx`（happy-dom）——粘贴事件注入 File 后附件轨出现、移除生效、发送携带 images、消息含图渲染；view-store.spec——附件状态更新/清除；JumpList 渲染与点击回调（mock listTree 数据）。
- 依赖：U-B/E/F/K。

### U-M 存量 typecheck 修复
- 文件/位置：`src/host/side-chat-service.ts:309:29` 与 `:799:33`。
- 改动：`entry.modelSelection?.current.model` → `entry.modelSelection?.current?.model`（TS18048 收窄；`sanitizeBtwModel(string|undefined)` 语义不变，未 picked 时与现状一致回默认模型）。
- 验收：`node_modules/.bin/tsc -p tsconfig.json --noEmit` 零错；现有 host 测试全绿（无行为变化）。
- 依赖：无（先行）。

### U-N 测试扩展（最小集）
- 文件/位置：`tests/` 新/改：`remote-contract.spec.ts`（新 schema）、`host-image.spec.ts`（新：U-D/E/F）、`host-list.spec.ts`（新：U-J）、`vision-template.spec.ts`（新：wrapImageDescriptions）、`controller.spec.ts`（jumpTo）、`side-chat-surface.spec.tsx`（附件轨/图片渲染，happy-dom）、`package-contract.spec.ts`（7→9）。
- 改动：见 §6 清单逐项。
- 验收：`vitest run` 全绿。
- 依赖：各对应单元。

### U-O 构建验证与部署步骤（文档产物）
- 文件/位置：`.workspace/deploy/README-v2.md`（部署 runbook）或并入现有部署脚本目录。
- 改动：§7 命令序列 + §8 部署步骤（含 patch 应用、vision-adam 替换、settings.yaml 更新、重启、验收 6.4.a-f）。
- 验收：按 runbook 走完 6.4.a-f 全部通过（人工/GUI，沙箱无法代验）。
- 依赖：U-A..U-N + U-G-2 + U-H 产物。

---

## 6. 测试策略（核实点 6）

- **纯逻辑（node 环境，无 DOM）**：协议 schema（U-A/B/C → remote-contract、package-contract）；R1-9 模板（U-I → vision-template）；host send/transcript/readImage（U-D/E/F → host-image，mock `@deepseek-ai/dsh-subagent` 与 attachments 与 `@deepseek-ai/dsh-vision-adam`，沿用 host-opening.spec.ts 的 mock 模式：`vi.mock('@deepseek-ai/dsh-subagent')` + `DSH_HOME` 临时目录）；listTree/listProject（U-J → host-list，mock subagents/sessionQuery/sessions）；jumpTo（U-K → controller.spec，mock ISessions 与 remote，沿用现有 harness）；存量修复回归（现有 spec）。
- **happy-dom（组件）**：SideChatSurface 附件轨/粘贴/消息图片渲染、JumpList 渲染与点击（U-L → side-chat-surface.spec.tsx 与新建 jump-list.spec.tsx，`// @vitest-environment happy-dom` + `vi.mock('@deepseek-ai/dsh-client-ui-primitives')`，沿用现有模式）。
- **vision-adam 与 patch 的真实调用**不属 vitest：U-H 用部署后冒烟（node --check + 真实 API 一次调用）；U-G-2 用部署后人工/脚本验收（§3.1）。

---

## 7. 构建验证命令（核实点 7，pnpm 不可用 → node_modules/.bin 直连）

在 `/home/CNS2026495165/dsh/dsh-btw` 下按序执行（对应 `pnpm run check` 拆解）：

```bash
node_modules/.bin/oxlint src tests tsdown.config.ts vitest.config.ts                      # lint
node_modules/.bin/tsc -p tsconfig.json --noEmit                                            # host typecheck（存量 2 错修复后零错）
node_modules/.bin/tsc -p tsconfig.client.json --noEmit                                     # client typecheck
node_modules/.bin/tsc -p tsconfig.tests.json --noEmit                                      # tests typecheck
node_modules/.bin/vitest run                                                               # 全量测试
node_modules/.bin/tsdown                                                                    # 构建 lib/（node+client 两产物）
node scripts/smoke-build.mjs                                                                # smoke（7→9 断言）
node_modules/.bin/publint --level error                                                     # 发布检查
```

（八项二进制均已确认存在于 `dsh-btw/node_modules/.bin/`。vitest 环境：happy-dom 由测试文件注释选择，vitest.config.ts 无需改。）

---

## 8. 部署步骤（执行阶段收尾，用户重启）

1. 备份：`cp ~/.dsh/profiles/node_modules/@local/dsh-btw/lib -r ~/.dsh/backups/dsh-btw.lib.<ts>`；`cp ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js ~/.dsh/backups/vision-adam.index.js.<ts>.bak`；`cp ~/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js ~/.dsh/backups/dsh-host-apiproxy.index.js.<ts>.bak`。
2. 拷贝 btw：`cp -r lib ~/.dsh/profiles/node_modules/@local/dsh-btw/`（真实目录拷贝，审计 §0 部署位）。
3. 替换 vision-adam：`cp .workspace/deploy/vision-adam/lib/index.js ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js`。
4. 应用 patch：`cd ~/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-host-apiproxy && patch -p1 < ~/dsh/.workspace/deploy/patches/dsh-host-apiproxy.sessions-prompt-transform.patch`（或按 runbook 直接放置完整文件；先核对备份可逆）。
5. 更新 `~/.dsh/settings.yaml` vision-adam 段（:135-137）：`model: deepseek-v4.1-flash`、`baseURL: https://opencode.ai/zen/go/v1`、`apiKeyEnv: OPENCODE_GO_API_KEY`、`maxTokens: 2000`（保留可调）。
6. 重启：`npx @deepseek-ai/dsh web`（等 3080 就绪）→ 按验收 6.4.a-f 逐项（人工/GUI）。

---

## 9. 未确认清单（如实标注）

1. 运行进程实际加载的物理包副本：本沙箱无法观测宿主进程（bubblewrap PID 隔离，ps /proc 均不可见）。profiles 根 node_modules 为符号链接 farm（`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-agent-loop → web2` 0.1.5-rc.2；`dsh-host-apiproxy → web` 0.1.1-rc.2；`dsh-vision-adam` 为真实目录 0.2.0）。**本报告关键结论已对两版本双验证**：agent-loop 0.1.1 与 0.1.5 的 `agent/pre-step` waterfall 形状一致（diff 仅重构）；host-apiproxy 以 web 0.1.1 为基准（farm 指向 web）。patch 目标文件按 `~/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js` 定稿。
2. tsdown `neverBundle` 新增 `@deepseek-ai/dsh-vision-adam` 的构建行为未实测（执行阶段首次构建即验；退路 createRequire）。
3. `ctx.get('settings')?.get('vision-adam')` 在 btw host 侧运行时可读性未运行验证（依赖 vision-adam 插件注册与 settings provider 存在；代码路径完整，缺失时走默认值）。
4. 主会话变换失败时主壳对 `agent-busy`+`details.reason` 的展示细节未运行验证（沙箱无法操作 GUI）；建议执行后人工核验收 6.4.c。
5. `dsh-web-frontend` 对消息图片的渲染（若主会话日志出现图片 ref 的旧消息）未涉及——本次主会话路径变换后日志为纯文本，与验收一致。
6. `x-api-key`/`x-opencode-session` 对 adam 网关的兼容性未单独实测（probe 均基于 opencode 网关；adam 忽略未知头为通用网关行为，标注待部署验证；若部署仍走 adam 网关且报错，可设 `xApiKey: false, sessionHeader: false`）。
7. web2 profile（0.1.5-rc.2）作为运行目标的切换状态未确认（审计 §9.6 同）；本次按运行中 web profile 定稿。
8. **子代理会话直发图片（`subagents.prompt` → dsh-subagent:1948-1956 门禁）不在 R1-3 范围**，本次不做；如需覆盖为后续扩展（可在 U-G 同款事件上扩展 patch 面）。
9. `listTree`/`listProject` 对**冷会话（持久化）**的 preview 读取采用索引 v2 缓存值（不逐条 load 事件）；索引过期值接受度未运行验证（UI 显示「…」兜底）。

---

## 10. 依赖图速查

```
U-A → U-B → U-C →(smoke/contract) 
U-I → U-D → U-E → U-F
U-I → U-G-1 → U-G-2(patch 产物)
U-H（独立产物，供 U-I 运行时）
U-J → U-K → U-L
U-M（独立先行）
U-N 挂所有单元；U-O 收尾
```
