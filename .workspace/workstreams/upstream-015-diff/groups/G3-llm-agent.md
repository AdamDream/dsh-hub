# G3-llm-agent 分组调研结论（ARCH 0.1.5-rc.2 vs GLOB 0.1.1-rc.2 部署树）

> diff 方向：combined/libjs = `diff -u -r ARCH GLOB`，即 **`-` = 0.1.5（ARCH），`+` = 0.1.1（GLOB）**。
> 行号证据：`dsh-llm.combined.diff` 等产物位于 `upstream-015-diff/pkgs/`；`comb:L123` = combined diff 行 123；`libjs:L456` = libjs diff 行 456；`ARCH:lib/types/x.d.ts:L7` = 归档树文件行。
> 本地补丁交集：G3 十个包均不在本地补丁清单内（agent-loop/client-ui-subagent/host-apiproxy/subagent/web-search-deepseek 才是本地补丁包），但 dsh-llm 是被补丁包 dsh-agent-loop 的直接消费方，任何破坏性改名都会打爆已打补丁的 agent-loop。

---

## 1. dsh-llm（核心）

### (a) 增量分类
- **api（破坏）**：`ToolCallId` 重命名取代 `CallId`（comb:2763-2774；types.d.ts 的 ToolCallBlock/ToolResultBlock/StreamChunk 全部改用 ToolCallId，comb:5030-5041、5157）；`OFFLOADED_IMAGE_TEXT` 常量删除（改为 `offloadedImageText(ref, access)` 函数，comb:2960-2989）；`offloadRequestImages` 删除（拆出 `offloadedImagePrefixCount` + `placeholder` 回调，comb:3057-3072）；`deepFreeze`/`assertNever` 从本包导出迁到 dsh-util-values（comb:2700-2701 导出面）。
- **api（新增，与 agent-loop 新流式模型连带）**：`LlmAttemptId` 品牌（comb:2782-2789，agent-loop attempt 身份）；`SystemMessage` + `createSystemMessage`（comb:4878-4888，system-role 消息专门化，配合 systemPromptUpdate='in-history'）；`SystemPromptUpdate` 类型 + `LlmResolvedModelInfo.systemPromptUpdate` + 适配器声明（comb:5134-5150）；`assistant-stream` 子路径模块（`AssistantStreamAccumulator`/`expandAssistantStream`/`assembleAssistantStream`/`isTokenDelta`/`isVisibleChunk` 等 14 个导出，comb:1089-1528、2700）；`FileBlock` + `contentHasFile`/`fileHandleText`/`projectFilesToText` + `LlmRuntime.fileRequestText`（文件附件进模型，comb:5014-5051、2997-3022、3453）；`RequestImageOffloadPolicy.placeholder` + `offloadedImageText` + `resolveImageAttachmentAccess`（归一化图片访问桥，comb:3033-3058、2937-2958）。
- **api（新增，可独立看）**：`TokenUsage.totalTokens?` 可选字段（comb:5056-5063）；`LlmConfigurableProvider.error?` 诊断字段（comb:5103-5104）；`LlmImageRequestPricing`/`LlmImageRequestPrice` + `LlmAdapter.imageRequestPricing` + `LlmRuntime.imageRequestPricing`（comb:5068-5095、3386、3446，token-meter 连带）；`LlmModelDiscoveryOperation`（signal 挂到 request，comb:5113-5117）；`registerModelDiscovery` 增 signal 参数（comb:3408-3409）。
- **架构（不借）**：`LlmRuntime extends TypertRemoteService` + `@Remote` 装饰器 + `remoteDiscoverModels` + `./typert`/`./remote` 子路径（typert.host/remote-client.js，comb:2702-2705、3395）；依赖新增 zod/dsh-util-values/dsh-util-crypto/dsh-typert-protocol（package.json comb:5226-5253）。
- **noise**：README 三件套、i18n 校验头（comb:1-493）。

### (b) 值得借的候选
- `TokenUsage.totalTokens?` + deepseek `mapUsage` 精确 total（纯增量，可选字段，无破坏）→ 见候选 C-G3-06。
- 其余（assistant-stream、file blocks、image pricing、SystemPromptUpdate、typert）均与 0.1.5 agent-loop/attachment 新 API 连带，**不独立借**。

### (c) 稳定性 bugfix
- 本包核心错误面（`error.js`/`adapter-failure.js`/`api-key.js`/`retry-policy.js`/`attribution.js`）**两版本逐字节相同**（不在 diff 文件清单内）——错误分类/重试策略解析无增量、无 bugfix。

### (d) 破坏性 API（勿借）
- `CallId` → `ToolCallId` 改名：**0.1.1 部署树里 dsh-agent-loop（已打本地补丁）、dsh-llm-deepseek、dsh-llm-pi-ai 全部用 `CallId`**（deepseek libjs:6、pi-ai libjs:7）；改名即全链路 break。
- `OFFLOADED_IMAGE_TEXT` 常量删除；`offloadRequestImages` 删除；`deepFreeze`/`assertNever` 移包——消费方需同步改造。
- `LlmRuntime` 基类 TypertRemoteService 化：0.1.1 无 dsh-typert-protocol，无法跟随。

### (e) 裁决：**部分借**（只借 `totalTokens` 一个可选字段，其余全部不借；assistant-stream 系列**不可独立借**——它消费 `snapshotJsonValue`/`deepFreeze`（dsh-util-values）、dsh-brand `brandString`，且唯一消费者是 0.1.5 agent-loop 的 AssistantStreamAttempt 持久化沉降，脱离 agent-loop 无调用方、纯死代码）。

---

## 2. dsh-llm-retry

### (a) 分类：perf（+ 依赖面变化）
- **重试策略本身（退避/指数/可重试码分类）零增量**：退避常量、`retryPolicyKey`、`cancellableDelay`、normal/always 逻辑、`providerRetryAfterMs` 处理全部两版相同（comb:342-405 只动计数查询一行）；`dsh-llm` 的 `retry-policy.js`（ResolvedRetryPolicy/resolveRetryPolicy：5 次、500ms→10s、10% jitter、EMPTY_RESPONSE/RATE_LIMIT/SERVER/TIMEOUT/TRANSPORT）两版逐字节相同。
- 0.1.5 唯一实质改动：重试计数从「直接扫 `agent.session.events.findLast`」（0.1.1，comb:397）改为「`ctx.sessionProjections` 的 `llmRetry` 投影 state」（0.1.5，comb:368-387、395-396、504-520），inject 从 `["agents"]` → `["agents","sessionProjections"]`；invariant 从 `session.events` → `session.snapshotEvents()`（comb:406-430）。
- 代价：0.1.1 的 dsh-session-projection 有 `register/stateOf`（0.1.1 session-projection index.d.ts:127、167），但 `snapshotEvents()` 不存在（0.1.1 dsh-session 只有 `get events()`，index.d.ts:174），invariant 需改一行。

### (b) 候选：C-G3-07（P3，中价值）。O(n) 事件扫描 → O(1) 投影，附带 `llm/retry-started` 边界事件语义（0.1.5 在开始前追加 started 事件、取消不写）。行为差异：0.1.1 的 findLast 只匹配同 turn/step/provider/policyKey，0.1.5 投影按 step/start 与 turn/end 清空——语义等价、实现路径不同。

### (c) bugfix：无（核心重试逻辑两版相同）。

### (d) 破坏性：`inject` 增依赖 sessionProjections（0.1.1 部署已有该包，非破坏）；`zod` 依赖移除（0.1.1 无 zod 依赖，方向相反）。

### (e) 裁决：**不借**（价值仅 O(1) 查询，投影 API 版本有小适配成本，重试行为无任何改善）。

---

## 3. dsh-llm-deepseek

### (a) 分类
- **api（新增，token-meter 连带）**：`deepSeekImageTokens`（官方 v4 视觉 token 计算器逐字移植，libjs:74-207）+ `deepSeekImageRequestPricing`（request-pricing，libjs:208-292）+ `LlmAdapter.imageRequestPricing` 实现（libjs:442-446）+ `resolveRequestImagePolicy`（libjs:415-434）+ 新常量（DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET 等，libjs:361-380）。借它必须连 dsh-llm 的 `LlmImageRequestPricing` 接口 + token-meter 消费端一起，三件套连带。
- **api（新增）**：`totalTokens` 精确 total（mapUsage，libjs:304-316，配 dsh-llm TokenUsage.totalTokens）；`prepareExtensions`/`deepseekLlmApiExtensions` 请求扩展钩子（REQUEST_EXTENSION 错误码，libjs:496-511、520-524）；`systemPromptUpdate: "in-history"` 于 deepseek-flash 默认模型（libjs:537-558，agent-loop 连带）；REASONING_EFFORTS 描述文案（libjs:380-412，GUI 用）。
- **stability**：`acceptIdentity`（libjs:328-330 + 调用点 347-360）——tool-call delta 的 id/name 只接受非空字符串，延续 delta 里空的/`null` id（部分 OpenAI 兼容网关会填 null）不再覆盖已确立身份。0.1.1 是 `if (call.id !== void 0) block.callId = call.id`（null 会写穿 → closeBlock 得空 id）。
- **api（配置破坏）**：catalog 模型 schema 从 `imageDetail: "auto"|"low"` 改为 `imagePixelBudget: number|"low"`（0.1.5 直接拒绝 imageDetail，libjs:560-578）——0.1.1 已配置 catalog 若含 imageDetail 需迁移。

### (b) 候选：C-G3-01（acceptIdentity，P2，小<50 行）；C-G3-06（totalTokens，P3，小）。
### (c) bugfix：acceptIdentity（见上，libjs:328-330）。
### (d) 破坏性：imageDetail→imagePixelBudget 配置改名（勿借，0.1.1 用户配置面不兼容）；systemPromptUpdate 字段新增（agent-loop 连带）。
### (e) 裁决：**部分借**（acceptIdentity + totalTokens 独立可借；image pricing 三件套与 token-meter/attachment 连带，暂不借）。

---

## 4. dsh-llm-pi-ai

### (a) 分类
- **api（新增，GUI/连带）**：延迟目录校验（`PiAiCatalogError`/`modelErrors`/`catalogError`、`resolveProfiles(providers,"deferred")`、`assertServiceable(config,previous)` 只校验变更 profile，libjs:174-255、372-459）配 dsh-llm `LlmConfigurableProvider.error?` 修复面；`discoverModels` 支持 Anthropic Messages 原生 listing + `models` map + 存储 profile headers（libjs:833-996，GUI discovery）；`splitSystemPrompt`（leading system 消息折进原生 systemPrompt 槽，libjs:500-515，anthropic 协议正确性）；`toPiReplayState` 增 requestedModel/responseModel/providerThinkingLevel（libjs:15-38、48-59）；`toStreamChunks` 增 callerSignal/requestedModel（libjs:687-730）；`jsonImage`（libjs:784-815）；新 pi-ai compat 字段门（supportsFinishReason/chatTemplateArgs/supportsThinkingTokenBudget/vllmPriority/supportsMaxOutputTokens 等 + baseten provider，libjs:289-330）——随 pi-ai 依赖升级。
- **stability**：`assertValidHeaders`（libjs:354-370，配置写入时校验 Fetch 头合法性，避免运行期 fetch 才炸）；`mapStopReason` 补 `pending`/`deferred` 终止态 → 非重试 `PI_AI_ERROR`（libjs:654-673）；`mapUsage` totalTokens（libjs:638-645）；0.1.5 `registerModelDiscovery` 从「request+signal」改回「request 内嵌 signal」（libjs:1093-1097，与 dsh-llm 0.1.5 的 discover(request,signal) 签名配套——注意两包方向一致）。
- **noise**：README、compat 门注释。

### (b) 候选：C-G3-02（jsonImage，P2）、C-G3-03（assertValidHeaders，P3）、C-G3-04（mapStopReason pending/deferred，P3）。
### (c) bugfix：jsonImage（Copilot 类 grant 带 `enterpriseUrl: undefined` 显式未定义成员时，严格凭据库拒绝存储——0.1.5 用 JSON image 预渲染解决，libjs:784-815）；mapStopReason pending/deferred（流以 pending/deferred 结束不再被当作无错误处理，libjs:654-673）。
### (d) 破坏性：0.1.5 移除 `resolveImageAccess` 配置（libjs:1062-1066）与 `chatTemplateArgs` 等字段——0.1.1 无这些字段，方向相反，无实际破坏；目录校验从「严格拒绝」改「延迟保留诊断」属行为增强。
### (e) 裁决：**部分借**（3 个小 bugfix 独立可借；延迟目录校验+discovery+replay 扩展为 GUI/连带功能，不借）。

---

## 5. dsh-token-meter

### (a) 分类：全部为架构连带（api 面不改）
- 0.1.5 测量链路改吃 `assembleAssistantStream`（紧凑 attempt 记录回放，libjs:1-110）+ 路由图片定价 `priceSurface(…, pricing, fileText)`（`_routeImagePricing` 走 `LlmAdapter.imageRequestPricing` + `_fileRequestText`，libjs:37-97）+ 系统提示改从 surface 节点定价（`estimateSystemMessage`，estimate.js libjs:43-65，因 0.1.5 系统提示进入会话 surface）+ 投影注册改可选子注入（libjs:37-42）+ SessionLogOffset/SessionSeq。
- `tokenUsage` 投影：0.1.5 stateVersion 2，事件源改为 `assistant/attempt`（`lastAssistantStreamChunk(stream,'usage')`）+ `llm/retry-started` 清槽（usage-projection.js libjs:56-120）；0.1.1 吃 `assistant/chunk`+`assistant/message`。**投影 VALUE 形状（totals 四桶 uncachedInputTokens/outputTokens/cacheReadTokens/cacheWriteTokens + last）两版相同**。
- 本地 tok/s 补丁（client-ui-subagent/lib/client.js）读取的是 `summary?.projectionValues?.tokenUsage` 四桶 + sessionStats 解码率（client.js:84-85、269-278），**依赖的是投影值形状，不依赖 token-meter 内部实现**；0.1.5 投影形状不变 → **借/不借 token-meter 都不影响本地补丁**（且 0.1.5 的 assistant/attempt 事件在 0.1.1 不存在，本来也借不动）。

### (b) 候选：无（全部连带）。
### (c) bugfix：无独立 bugfix（改动均为测量精度增强，且依赖 0.1.5 dsh-llm 的 pricing/assistant-stream）。
### (d) 破坏性：`inject: ['sessionProjections']` 静态依赖 → 可选子注入（0.1.5 反而更宽松）；无 0.1.1 破坏面。
### (e) 裁决：**不借**。

---

## 6. dsh-agent

### (a) 分类
- **api（新增，agent-loop 连带）**：`AssistantStreamFrame`（start/chunk/end，带 `attemptId: LlmAttemptId`/revision/index/time/outcome committed|abandoned）+ `agent/assistant-stream` 事件（ARCH runtime-types.d.ts:107-~130、367-377）——**transient frames 机制本质**：一次模型 attempt = 进程内即时帧流（start→chunk*→end）供 UI 实时流式；每个 chunk 快照一次同时喂 ①紧凑持久化（AssistantStreamAccumulator → `assistant/attempt` 沉降，seq 在 end.outcome.committed 里）②BlockAssembler ③帧发布；retry 时新 attemptId、revision 单调、替换重启为 1（消费端在 agent-loop 0.1.5 `AssistantStreamAttempt`，见 ARCH agent-loop types/assistant-stream.d.ts，emit `agent/assistant-stream`）。**0.1.1 没有该机制**（0.1.1 直接发 assistant/chunk 事件）。
- `Inbox`：0.1.1 的**具体类**（lib/types/inbox.js，comb:844-845 "Only in GLOB"；libjs:155-329 完整实现：durable `agent/inbox/spliced` 投影）在 0.1.5 **移出 dsh-agent**（改由 dsh-agent-loop 拥有，ARCH agent-loop lib/types/inbox.d.ts 存在），dsh-agent 只留接口 + `inbox`/`turnBoundary` session 投影类型（InboxState/InboxWireState/TurnBoundaryProjection，ARCH types.d.ts comb:1513-1597）。
- **api（新增，独立）**：模型切换持久 notice（`installModelSelection` 增 `agent/pre-step` 监听，provider/model 变化时向下一请求追加 user-role notice，libjs:383-394；依赖 `agent/pre-step` 事件 + `agent.session.requestHeader()?.config`——0.1.1 dsh-session 有 requestHeader，index.d.ts:546，可独立借）。
- **api（变更）**：`ctx.accessor('agent')` DX + `register()` 以 `this.ctx.agent` 为运行时 owner（0.1.1，libjs:450-455）；0.1.5 改回显式 `parentAgent` 选项 + `AgentSetup(agentCtx, agent)`（comb index.d.ts:34-52）；session 元数据 `isSeeded/inheritedEventCount` ↔ `seedLength`（comb index.d.ts:64-83）；typert `agent` lookup/context 映射（comb index.d.ts:12-30）。
- **foldConsumedWork：两版本逐字节相同**（consumed-work.d.ts/js 不在 diff 清单）——无变化，与"折叠消耗工作"语义无关。
- **noise**：README。

### (b) 候选：C-G3-05（模型切换 notice，P3，~30 行，独立）。
### (c) bugfix：无（register owner 变化是 API 演进不是 bugfix）。
### (d) 破坏性：`Inbox` 从 dsh-agent 主导出消失（0.1.5 主 index 不再 export Inbox，改 agent-loop 拥有；0.1.1 部署的消费方若 import Inbox 会断——0.1.1 自身不受影响，勿借 0.1.5 方向）；`AgentSetup` 签名、`parentAgent`、`seedLength` 元数据字段改名。
### (e) 裁决：**不借**（仅模型切换 notice 为可选小借；帧/投影/inbox 移动全为 0.1.5 agent-loop 架构连带）。

---

## 7. dsh-time-context

### (a) 分类：perf（重构等价）
- 0.1.5 用 `timeContext` session 投影（lastMessageTime/lastInjectionTime/lastTurnInjectionTime，stateVersion 2，inject 增 sessionProjections，comb:195-204、251-291）；0.1.1 用直接事件逆扫等价函数（`precedingMessageTime`/`precedingStepContextTime`/`latestInjectionTime`，都过滤 `source.plugin==="time-context"`，comb:214-241）。语义等价，仅 O(1) vs O(n)。
- 0.1.1 内联了 MessageId/deepFreeze/createUserMessage/退避 schema 副本（打包差异，非语义）。
### (b) 候选：无。
### (c) bugfix：无。
### (d) 破坏性：无（inject 增依赖，0.1.1 部署有 dsh-session-projection）。
### (e) 裁决：**不借**。

---

## 8. dsh-timeout

### (a) 分类：**noise**——lib/*.js 全部相同（libjs.diff 0 行），仅 package.json 版本号 + README 三件套差异。
### (e) 裁决：**不借**。

---

## 9. dsh-system-prompt

### (a) 分类：api（新增，多插件协调）+ noise
- 0.1.5：`SECTION_ORDERS`/`CONTEXT_ORDERS` 大表 + `getSectionOrder(name)`/`getContextOrder(name)`（跨 ~30 个提示区块/工具节的集中排序，含 WEB_SURFACE/HARNESS_SOURCE 等 0.1.5 生态区块）；`personaPrefix`/`personaSuffix` 配置拆两段。
- 0.1.1：`PERSONA_SECTION`/`PERSONA_ORDER`/`config.persona` 单段。
### (b) 候选：无（排序表依赖 0.1.5 各插件区块名，借了也只是常量）。
### (c) bugfix：无。
### (d) 破坏性：导出改名 `PERSONA_PREFIX_SECTION`/`PERSONA_SUFFIX_SECTION` → `PERSONA_SECTION`/`PERSONA_ORDER`；`config.personaPrefix/personaSuffix` → `config.persona`（0.1.1 部署配置若按 0.1.5 写会静默失效，方向相反勿借）。
### (e) 裁决：**不借**。

---

## 10. dsh-agent-presets

### (a) 分类：api（新增，GUI/typert 连带）
- 0.1.5：`TypertRemoteService` 化（typert.host/remote-client）+ `SHIPPED_PRESET_ROOT` 内置预设（presets/{cordis,minimal,ptc,standard}，0.1.1 无 presets 目录）+ composition-inventory（`AgentPresetComposition` 组合清单）+ display/specifier 模块（specifier 依赖 cordis-plugin-loader 的 isBuiltin/isJsExpr）+ `agentPresetProjectionDefinition` session 投影 + `copyComposition/deleteComposition` authoring + `includeShippedRoot` 配置。
- 0.1.1：简单 `Service` + `resolveSessionPreset`/`PresetMountError`/`UnknownPresetError`/`InvalidPresetIdError` 等。
### (b) 候选：无（内置预设是内容资产，需整套 authoring/discovery UI；typert 无 0.1.1 基座）。
### (c) bugfix：无。
### (d) 破坏性：0.1.1 导出面（InvalidPresetIdError/PresetExistsError/PresetNotWritableError/resolveSessionPreset/PresetMountError/UnknownPresetError）在 0.1.5 被替换/移除。
### (e) 裁决：**不借**。

---

## (c) 稳定性 bugfix 清单（证据）
1. `dsh-llm-deepseek/lib/types/index.js`（libjs:328-330、347-360）：`acceptIdentity`——tool-call 延续 delta 的 `id`/`name` 为空串或 `null`（部分 OpenAI 兼容网关填充）时不再覆盖已确立身份；0.1.1 的 `if (call.id !== void 0)` 会让 null 写穿导致 tool-call-delta id 变空。
2. `dsh-llm-pi-ai/lib/index.js`（libjs:784-815）：`jsonImage`——grant 型凭据（如 Copilot `enterpriseUrl: undefined`）以 JSON image 预渲染，避免严格凭据存储校验器拒绝。
3. `dsh-llm-pi-ai/lib/index.js`（libjs:354-370）：`assertValidHeaders`——profile 请求头在配置写入期即用 `new Headers()` 校验，非法头从"运行期 fetch 才炸"提前到"写入期拒绝"。
4. `dsh-llm-pi-ai/lib/index.js`（libjs:654-673）：`mapStopReason` 补 `pending`/`deferred` 终止态 → 非重试 `PI_AI_ERROR`，不再落入未处理路径。
5. `dsh-llm-pi-ai/lib/index.js`（libjs:687-730）：`toStreamChunks` 增 callerSignal——调用方已取消时，带内终止错误统一映射为 `aborted` finish（取消语义正确性）。

## (d) 破坏性 API/接口变更（勿借）
- `dsh-llm`：`CallId`→`ToolCallId` 改名（0.1.1 全部消费方用 CallId，含本地补丁的 agent-loop，改名即 break）；`OFFLOADED_IMAGE_TEXT`/`offloadRequestImages` 删除；`deepFreeze`/`assertNever` 迁 dsh-util-values；`LlmRuntime` TypertRemoteService 化；`registerModelDiscovery` 签名；`discoverModels` 的 signal 参数位置。
- `dsh-llm-deepseek`：catalog `imageDetail` → `imagePixelBudget`（含 "low" 联合）；`resolveImageAccess`/`prepareExtensions` 配置面变化。
- `dsh-agent`：`Inbox` 主导出移除（移 dsh-agent-loop）；`AgentSetup` 签名、`parentAgent` 选项、`isSeeded/inheritedEventCount` ↔ `seedLength` 元数据。
- `dsh-system-prompt`：`PERSONA_PREFIX_SECTION/PERSONA_SUFFIX_SECTION` → `PERSONA_SECTION/PERSONA_ORDER`；`personaPrefix/personaSuffix` → `persona`。
- `dsh-agent-presets`：0.1.1 导出面整体替换（resolveSessionPreset 等 → composition/shipped-root 体系）。

## (e) 每包裁决汇总
| 包 | 分类 | 裁决 | 可借 |
|---|---|---|---|
| dsh-llm | api | 部分借 | TokenUsage.totalTokens 可选字段（P3）；其余不借 |
| dsh-llm-retry | perf | 不借 | 投影化重构 P3（低价值） |
| dsh-llm-deepseek | stability/api | 部分借 | acceptIdentity（P2）、totalTokens mapUsage（P3） |
| dsh-llm-pi-ai | stability/api | 部分借 | jsonImage（P2）、assertValidHeaders（P3）、mapStopReason pending/deferred（P3） |
| dsh-token-meter | perf | 不借 | 无（全连带） |
| dsh-agent | api | 不借 | 模型切换 notice（P3，可选） |
| dsh-time-context | perf | 不借 | 无 |
| dsh-timeout | noise | 不借 | 无 |
| dsh-system-prompt | api | 不借 | 无 |
| dsh-agent-presets | api | 不借 | 无 |

## 特别问题答复
- **assistant-stream 系列能否独立借**：不能。它依赖 dsh-util-values（snapshotJsonValue/deepFreeze）与 dsh-brand（brandString），且唯一消费者是 0.1.5 agent-loop 的 `AssistantStreamAttempt` 持久沉降（assistant/attempt 事件）；0.1.1 agent-loop 无 attempt 模型，借来无调用方，纯死代码 + 新依赖。
- **llm-retry 增量**：退避/指数/可重试码分类零增量（retry-policy.js 与核心逻辑两版逐字节相同）；唯一改动是计数查询改 session 投影（O(1)），低价值。
- **CallId→ToolCallId 影响**：破坏面 = 0.1.1 部署全部消费方（agent-loop 已本地补丁、deepseek/pi-ai 适配器）编译/运行期断链；勿借。
- **token-meter 与本地 tok/s 补丁**：补丁读 `projectionValues.tokenUsage` 四桶 + sessionStats 解码率（client.js:84-85、269-278），依赖投影**值形状**而非内部实现；0.1.5 投影值形状不变 → 借与不借 token-meter 均不影响本地补丁；且 0.1.5 吃 assistant/attempt 事件，0.1.1 无此事件，本也借不动。
