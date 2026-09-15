# G2-subagent 调研笔记（0.1.5-rc.2 vs 0.1.1-rc.2，借源码不升级）

路径：
- ARCH = ~/.dsh/profiles-archive/web2-20260915-105429/node_modules/@deepseek-ai/<pkg>（0.1.5）
- GLOB = ~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/<pkg>（0.1.1 部署，含本地补丁）
- BASE = /home/CNS2026495165/dsh/.workspace/baseline-011/x/<pkg>（纯净 0.1.1）
- DIFF = /home/CNS2026495165/dsh/.workspace/upstream-015-diff/pkgs/<pkg>.{combined,libjs,upstream,upstream-libjs}.diff
- 本组本地补丁清单：仅 dsh-subagent 的 P0 materializeContinuableChild（lib/index.js bundle + lib/types/index.d.ts），其余 6 包 GLOB==BASE 无本地补丁。

重要事实（先读）：
1. GLOB dsh-subagent/lib/index.js 是带 `//#region lib/types/xxx.js` 标记的完整 bundle（入口 main=lib/index.js），并同时分发独立的 lib/types/*.js（仅 deep-import 用）。本地 materialize 补丁只改了 bundle 内 continuation 区（GLOB index.js:1199）+ runtime 包装（index.js:2524）+ d.ts（types/index.d.ts:151）；独立文件 lib/types/continuation.js 未同步。→ 任何借 0.1.5 的 continuation 改动需同时落到 bundle 区域与独立文件两处。
2. 0.1.5 的许多改动骑在 0.1.1 缺失的兄弟 API 上：GLOB dsh-session 无 snapshotEvents/isOwnSeq/SessionLogOffset（有 .events/.seq/requestHeader）；GLOB dsh-llm 无 joinAssistantStreamText（有 contentHasImage/resolveModelInfo/inputModalities/ReasoningEffortId/boundContextSummary）；GLOB dsh-system-prompt 无 getSectionOrder/getContextOrder；GLOB dsh-session-persistence 无 stat；GLOB 缺 dsh-chunked-list/dsh-util-values/dsh-util-time 三个包。→ 这些增量不可独立移植。
3. 0.1.5 删除了 dsh-tool-subagent-report 包；GLOB==BASE 逐字节一致（diff -rq 无输出）→ report 包是 0.1.1 原生、非本地新增（任务描述"GLOB 独有"应修正为"仅 GLOB 存在，0.1.5 已删"）。
4. 0.1.5 agent-loop 原生不写 assistant/chunk 事件（grep 无命中），把 stream 嵌入 assistant/message 与 assistant/attempt 事件 → "非流式落盘"是 agent-loop 层的原生架构（G1 范围）；subagent 层无任何 streaming/落盘逻辑（两版本 grep streaming 均无命中），只有 fold 消费方式配套变化（assistant-output.js）。

---

## dsh-subagent（核心包；upstream-libjs.diff：index.js +1839/-1283，continuation.js +327/-1023，types/index.js +460/-304）

### (a) 分类：api（主导是破坏性 API 重写）+ stability（可借的 bugfix）+ gui（新增 catalog/control/typert 表面）

### 重点问题 1 增量清单（证据行号 = ARCH 文件）
- 创建/解析（child-agent.js）：
  - 新增 `parentAgentOptionsForDelegation(parent)`（ARCH lib/types/child-agent.js:50-73）：读 `parent.session.requestHeader()?.config`，请求期选择的 provider/model/reasoningEffort 优先，创建期 options 作为回退并保留输出 token 上限（maxTokens）。
  - `resolveChildAgentOptions`（ARCH lib/types/child-agent.js:75-92）：继承父 reasoningEffort；`if ((resolved.provider !== parentProvider || resolved.model !== parentModel) && requested?.reasoningEffort === void 0) delete resolved.reasoningEffort`（改路由不带 effort 时清除父路由绑定的 effort，让新模型解析自身默认）。
  - `childSessionMeta(parent, childDepth, isSeeded)`（ARCH child-agent.js 约 95-110）：签名从 `lineageSeedLength: number` 改为 `isSeeded: boolean`，meta 不再写 seedLength 改写 isSeeded（0.1.1 用 seedLength>0 数值门限，0.1.5 可区分"显式空 seed 前缀"）。
- 非流式/流式：subagent 层无流式逻辑（两版本 grep streaming 无命中）；`AssistantOutputFold.push` 改为消费 `event.data.stream`（joinAssistantStreamText）+ assistant/attempt（ARCH lib/types/assistant-output.js:24-37），不再消费 assistant/chunk text-delta；epoch 观察者用 `child.session.seq` / `snapshotEvents(boundary)`（ARCH lib/types/lifecycle.js:91-107）。依赖 0.1.5 dsh-llm joinAssistantStreamText（GLOB 无）→ 不可独立移植。
- 上下文上限（tok/s、token 计量）：subagent 层完全没有（grep tokenMeter/tokensPerSecond/maxContext 无命中）；仅 maxTokens 通过 agentOptions 继承传递（parentAgentOptionsForDelegation 注释：创建期 options 保留输出 token 上限）。tok/s 计量在 agent-loop/llm（G1）。
- 结果读取：`finalAssistantOutput` 两版本都有；fold 规则变化同上；run-settlement 变化见 bugfix。
- continuable 子代理大重构（continuation.d.ts +67/-398；ARCH lib/types/continuation.js:101-454 + continuation-activation.js）：
  - manager 拆出 `ContinuableActivationRegistry`（activation 图/锁/ownership/drain 全部下沉）+ `SubagentInbox`（agent + closingPromise + steer/followup 双投递，ARCH lib/index.js bundle 内 inbox 区）。
  - 消息面：`followup(parent, childId, content, {source})` → `sendMessage(sender, targetId, content, {signal})` 双向（子→直系父 或 父→子，冷恢复兜底；ARCH continuation.js:193-235）；新增 `queuePrompt`（queue 投递）/ `steerPrompt`（steer 投递）；source 改为 `agent-message`（ARCH continuation-messages.js agentMessageSource/createAgentMessage）。
  - reportFrom/子代上报机制删除：改为 `withContinuableReturnGuidance` 在初始 prompt 追加"用 send_message 向父回传结果"的模型指令（ARCH continuation-messages.js withContinuableReturnGuidance；仅当子代 send_message 工具被 markAdjacentAgentSendMessageTool 标记时拼接，ARCH continuation.js:172-176）。settlement 通知（subagent-settled notice）保留：finishDisposal→notifySettlement→createSettlementMessage（ARCH continuation-activation.js:569-651）。
  - 新增 `assertImageCapable`（ARCH continuation.js:263,396,424-434）：投递前查 llm.resolveModelInfo inputModalities，文本模型收图抛 MODEL_DOES_NOT_SUPPORT_IMAGES。
  - 新增 `requireSessionQuery`：coldResume 与 list-children 从 sessionPersistence 迁移到 sessionQuery.listSessions（ARCH continuation.js:446-454；list-children.js:144-175，错误码变 SUBAGENT_CONTROL_QUERY_UNAVAILABLE）。
  - startContinuable 变化（ARCH continuation.js:101-190）：descriptor 在首个 await 前快照（110-121 注释"invalid descriptor JSON rejects the call before a child exists"）；重复检查用 persistence.stat（0.1.1 用 listSnapshots）；`holdOwnership` 建立期预注册父 owned 集合（0.1.1 只在 submit 时 acquire）；childId 用 brandString（0.1.1 SessionId(randomUUID())）。
  - interrupt/drain/drainDescendants/drainChildren 语义保留（简化注释），interrupt 仍先验 caller 精确身份再查 target（ARCH continuation-activation.js interrupt 区）。
- subagentDepth/delegationDepth：resolveChildDepth 无 delta（两版本同）；delegationDepth 仍冷恢复持久化值；isSeeded 语义变化影响 fork 种子谱系判定（list-children.js "unseeded lifecycle / exact inherited cut"）。

### 重点问题 2：materializeContinuableChild 原生等价物 → **无**
- ARCH grep materializeContinuableChild 零命中；0.1.5 的 `materialize` 是 ContinuableActivationRegistry 私有方法（ARCH continuation-activation.js:306 materialize / 315 materializeTracked），无"parked 激活"公开 API（grep parked 仅注释提及中断的 parked FIFO）。
- 本地补丁（GLOB index.js:1199 materializeContinuableChild：冷恢复+parked 激活，宿主可在不投递消息下稳定挂接侧会话）仍是 **0.1.1 独有必需项**。若未来整包采用 0.1.5 架构，需以 activations.materialize + coldResume 为底重新实现该公开方法（新架构下 materialize 输入更简，移植成本不增不减）。

### 重点问题 3：②b 非流式落盘 → agent-loop 层原生，非 subagent 层
- 0.1.5 agent-loop 不写 assistant/chunk（grep 无命中），assistant/message 与 assistant/attempt 内嵌 stream；subagent 层仅 fold/观察者配套。GLOB 本地 isSubagent 补丁（agent-loop）在 0.1.5 无原生等价（0.1.5 agent-loop 无 isSubagent 概念）→ 归 G1 裁决。

### 重点问题 6 bugfix（ARCH 行号）
1. run-settlement.js:30-37：`aborted` 带 diagnostic → `{status:'failed', detail}`（原一律 killed，掩盖 provider 诊断性中止）。
2. out-of-process.js:38-42,165-170：`normalizeSubagentDiagnostic` 使 provider 返回的 diagnostic 同样过字节上限（原只限本地构造）。
3. child-agent.js:75-92：路由变更不带 effort 时清除继承 effort（防 effort 泄漏到新模型）。
4. child-agent.js:50-73：父级继承改以最新请求头 config 为准（原只读创建期 options，忽略请求期选择）。
5. continuation.js:110-121：descriptor 快照提到首个 await 前（非法 JSON 早失败）。
6. child-agent.js childSessionMeta isSeeded：显式空 seed 可区分（fork 谱系正确性）。
7. projection.js:92-99：seq → SessionSeq 品牌化 + MAX_SAFE_INTEGER 上限（校验加固）。
8. continuation.js:424-434 assertImageCapable：文本模型拒图（MODEL_DOES_NOT_SUPPORT_IMAGES）。

### (d) 破坏性 API/接口变更（勿借）
- SubagentRuntime：followup()→sendMessage()（参数/语义变）；reportFrom()、registerContinuableSetup() 删除；基类 Service→TypertRemoteService（index.d.ts diff）。
- send_message 工具：subagent_id→agent_id、语义改 steer-nearest-step、标记 adjacent-agent（tool-subagent-control，见下）。
- childSessionMeta 签名 (lineageSeedLength:number)→(isSeeded:boolean)（d.ts diff），meta 字段 seedLength→isSeeded（需 dsh-session 支持，GLOB 无）。
- SUBAGENT_DESCRIPTOR_VERSION 2→3 + agentReasoningEffort 字段（descriptor.d.ts:44,73,104）；旧 v2 descriptor 在新 runtime fold 返回 undefined。
- SubagentCapabilities 新增 agentOptions 能力（types.d.ts:123）；0.1.1 provider 未声明该旗标，0.1.5 runtime 会拒绝带 agentOptions 的请求。
- list-children：sessionPersistence.list → sessionQuery.listSessions（错误码 SUBAGENT_CONTROL_QUERY_UNAVAILABLE）。
- 依赖面：新增 dsh-chunked-list/dsh-util-values/dsh-util-time（GLOB 无此三包）+ dsh-session-query/dsh-system-prompt/dsh-typert-protocol/dsh-attachment（GLOB 有）。
- session API 演进：events.slice/events.length → snapshotEvents/seq/SessionLogOffset/SessionSeq/isOwnSeq（GLOB dsh-session 缺 snapshotEvents/isOwnSeq/SessionLogOffset）→ 0.1.5 lifecycle/epoch 代码不可独立移植。

### (e) 裁决：部分借
借（小、无冲突、不依赖缺失兄弟 API）：G2-1 effort 清除+父级派生、G2-2 aborted 诊断分类、G2-3 diagnostic 字节上限、G2-4 快照前置、G2-7 assertImageCapable（P2）。不借：continuation manager 整体重写（骑 session/llm/system-prompt/query API）、catalog/control/typert（gui 基建，依赖 session-projection + chunked-list + typert）、descriptor v3、isSeeded meta。materializeContinuableChild 本地补丁保留（0.1.5 无等价物）。

---

## dsh-tool-subagent（combined.diff：lib/index.js +146/-509；无本地补丁，GLOB==BASE）

### (a) 分类：api（新增模型选择特性 + 工具描述改写）
### 主要增量（ARCH 侧有、GLOB 0.1.1 无）
- 模型选择特性（ARCH lib/index.js:1-170 区域 + 368-660）：`modelSelectionSettings` 配置、工具参数 provider/model/reasoning_effort（仅启用时暴露）、`list_subagent_models` 发现工具、subagentModelSelectionPolicy 投影（subagent/model-selection-policy 事件）、preflightChildLlmRoute（llm.resolveCallConfig）、agentRouteDefaults、per-session scoped 组合（dsh-scope scopeChainOf/scopeOf）、`apply(ctx, config, session)` 三参（0.1.1 为 apply(ctx, config) 两参）。Config.agentOptions 新增 reasoningEffort 字段。
- 0.1.1 面（GLOB lib/index.js:130-296）：工具 schema 仅 description/prompt/run_in_background；SUBAGENT_SECTION_ORDER=116.5 硬编码（ARCH 侧无此常量）。
- 支撑：ARCH fork/spawn provider 新增 `capabilities.agentOptions: true`（ARCH fork lib/index.js:38、spawn lib/index.js:24）；driver 已无条件经 resolveChildAgentOptions 合并 agentOptions。
- 破坏面：0.1.5 对配置了 agentOptions 的现有部署要求 provider 声明 agentOptions 能力，否则报错（0.1.1 provider 不声明 → 若整包升会拒绝现有配置，需连同 provider 旗标一起借）。工具 description 措辞有变化（0.1.5 提到 send_message steer 语义）。

### (e) 裁决：部分借（P2 特性级）
模型选择特性本体可借（依赖 GLOB 已有：dsh-scope/llm.resolveCallConfig/sessionProjections），成本中（200-350 行），但需配套借 provider 能力旗标（G2-5）；是新增能力非修复，优先级 P2。破坏性描述改写勿借。

---

## dsh-tool-subagent-control（combined.diff：lib/index.js +20/-14；GLOB==BASE）

### (a) 分类：api（破坏性重设计，无 bugfix）
### 增量（ARCH 0.1.5 vs GLOB 0.1.1）
- send_message：参数 `subagent_id` → `agent_id`；语义 "waits until its current turn finishes" → "steers its nearest step; starts a turn when idle"；`ctx.subagents.followup(...)`（coordinator source）→ `ctx.subagents.sendMessage(...)` + markAdjacentAgentSendMessageTool（internal.js Symbol 标记，配合 startContinuable 的返回引导拼接）；brandString（ARCH）vs SessionId（GLOB）。
- interrupt_agent：仅描述措辞微调；brandString vs SessionId。
- list-agents 描述：0.1.5 "steers a running child at its nearest step boundary or starts a turn for an idle or ready child"；0.1.1 "starts a new turn on the same conversation"。
- 注：本部署系统提示中的 send_message 描述与 GLOB 0.1.1 逐字一致（当前模型面契约 = 0.1.1 语义）。

### (e) 裁决：不借
0.1.5 是对模型面契约的破坏性重设计（参数名+投递语义），无任何 bugfix；借入将破坏现有模型行为语料与本地控制流。keep 0.1.1。

---

## dsh-tool-subagent-report（无 combined.diff；GLOB vs BASE 逐字节一致）

### (a) 分类：noise（无增量）
### 事实
- 0.1.5 删除该包；GLOB==BASE（diff -rq 无输出）→ 0.1.1 原生包，**非本地新增**。
- 功能：`report` 工具薄封装 `ctx.subagents.reportFrom()`（子代→父上报通道 + tool:report prompt 段）；0.1.5 删除了 reportFrom 机制，等价物改为 withContinuableReturnGuidance + send_message（见 dsh-subagent）。

### (e) 裁决：不借（无上游可借；0.1.5 是删除+重构，非可移植增量）
0.1.1 保持现状（reportFrom 通道仍在 GLOB dsh-subagent 中）。若将来采纳 0.1.5 消息模型则整个包退役。

---

## dsh-subagent-fork-in-process / dsh-subagent-spawn-in-process（combined.diff 各 +3/-5、+3/-4）

### (a) 分类：api（仅能力旗标 + sibling API 演进）
### 增量
- ARCH 新增 `capabilities.agentOptions: true`（fork lib/index.js:38、spawn lib/index.js:24）——配套 tool-subagent 模型选择（G2-5/G2-6）。
- completedTurnPrefix：`parent.session.snapshotEvents()`（ARCH）vs `parent.session.events`（GLOB）——dsh-session API 演进，GLOB 无 snapshotEvents，不可独立移植。
- 生命周期/错误处理/清理无实质增量。

### (e) 裁决：部分借（仅 1 行能力旗标，P2、依赖 G2-6）

---

## dsh-subagent-in-process-driver（combined.diff：lib/index.js +12/-15，types/*.d.ts 各 ±2-3）

### (a) 分类：noise（纯 sibling API 编排变更，无独立价值）
### 增量
- brandString→SessionId、SessionLogOffset→number、setup(childCtx,child)→setup(childCtx)+childCtx.agent.session、agents.create 去 parentAgentAgent/inheritedEventCount、readResult 用 snapshotEvents、structured 段 order 用 getSectionOrder("STRUCTURED_OUTPUT")（ARCH）vs 硬编码 190（GLOB，GLOB dsh-system-prompt 无注册表 → 不可移植）。
- "PTC mode"→"Code Mode" 注释更名。driver 的 structured_output 机制、capture/guard、settleRun 逻辑两版本相同。

### (e) 裁决：不借（增量全部骑在 0.1.1 缺失的 session/system-prompt API 上；无独立 bugfix）

---

## (b) 值得借到 0.1.1 的候选汇总

| id | 价值 | patch 面（ARCH 文件:行） | 与本地补丁冲突 | 成本 |
|---|---|---|---|---|
| G2-1 | 修路由变更时父 effort 泄漏 + 父级继承改以请求头为准 | dsh-subagent/lib/types/child-agent.js:50-92（parentAgentOptionsForDelegation + resolveChildAgentOptions） | 无（materialize 补丁在 index.js bundle+d.ts） | 小 <50 行 |
| G2-2 | provider 诊断性中止不再误报 killed | dsh-subagent/lib/types/run-settlement.js:30-37 | 无 | 小 <10 行 |
| G2-3 | provider 返回 diagnostic 也过字节上限 | dsh-subagent/lib/types/out-of-process.js:38-42,165-170 | 无 | 小 <15 行 |
| G2-4 | startContinuable 非法 descriptor 早失败 | dsh-subagent/lib/types/continuation.js:110-121 | 无（需同步 bundle 与独立文件两处） | 小 <10 行 |
| G2-5 | provider agentOptions 能力旗标（G2-6 前置） | fork lib/index.js:38、spawn lib/index.js:24 | 无 | 小 2 行 |
| G2-6 | 子代理 LLM 路由/effort 显式选择 + list_subagent_models | dsh-tool-subagent/lib/index.js:1-170,368-660 | 无（tool-subagent 无本地补丁） | 中 200-350 行 |
| G2-7 | 文本模型拒图（MODEL_DOES_NOT_SUPPORT_IMAGES） | dsh-subagent/lib/types/continuation.js:263,396,424-434 | 无 | 小 <20 行 |

风险注记：G2-1 需先验证 GLOB requestHeader().config 是否携带 provider/model/reasoningEffort（0.1.1 请求配置结构）；G2-2 行为变化（带 diagnostic 的 aborted 从 killed 变 failed，确认无下游依赖 killed）；G2-6 需一并借 G2-5 旗标，且模型面新增可选参数（对现有模型提示词无害）。

## (c) 稳定性 bugfix 清单（文件:行 + 修了什么）
见 dsh-subagent 小节 8 条（run-settlement.js:30-37、out-of-process.js:38-42/165-170、child-agent.js:75-92、child-agent.js:50-73、continuation.js:110-121、childSessionMeta isSeeded、projection.js:92-99、assertImageCapable continuation.js:424-434）。

## (e) 每包一句话裁决
- dsh-subagent：部分借（只借 5 个自包含小 bugfix；manager 重写/catalog/typert/descriptor v3 不借；materializeContinuableChild 本地补丁保留）。
- dsh-tool-subagent：部分借（模型选择特性 P2 可借，需配套 provider 旗标；破坏性描述改写勿借）。
- dsh-tool-subagent-control：不借（send_message 参数与语义是破坏性重设计，无 bugfix）。
- dsh-tool-subagent-report：不借（0.1.1 原生、0.1.5 删除，无上游增量；GLOB==BASE 证实非本地新增）。
- dsh-subagent-fork-in-process：部分借（仅 agentOptions 能力旗标 1 行，P2 依赖项）。
- dsh-subagent-in-process-driver：不借（增量全部骑在缺失兄弟 API 上）。
- dsh-subagent-spawn-in-process：部分借（同 fork，能力旗标 1 行，P2 依赖项）。
