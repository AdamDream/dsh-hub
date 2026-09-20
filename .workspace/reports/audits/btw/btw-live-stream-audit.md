# btw 侧聊面板实时观察子代理输出 — 机制可行性审计报告

> 任务：只读调研（不改任何代码），评估「btw 侧聊面板实时观察子代理输出」的两种机制（方案 A 回合级即时显示 + 活动指示器 / 方案 B btw 专用 live 流）在真实代码上的可行性与成本，供用户裁决。
> 审计日期：2026-09-12。路由：adam/deepseek-v4-flash。
> 代码基线：live 全局树 `~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`（下称 `$AL`）+ btw 工作区 `/home/CNS2026495165/dsh/dsh-btw/`。行号均以审计当日读取为准。
> 结论：**方案 A 可行、零官方包改动，粒度与 ②b 之后的「subagent 会话界面」完全一致；方案 B 可行（推荐 B1 内存缓冲 + 轮询增强），需在已打 ②b 补丁的 dsh-agent-loop 上叠加一个 ~3 行补丁，不落盘、不进 mux、不影响 lag 修复。** 详见 §7 推荐与 §5/§6 成本对比。

---

## 1. 现状事实链（全部来自真实代码）

### 1.1 btw 子代理身份：②b 补丁对 btw 生效，chunk 被抑制

- ②b 补丁位于 `$AL/dsh-agent-loop/lib/index.js`：
  - L612：`const isSubagent = (this.options.subagentDepth ?? 0) > 0 || (this.session.header?.delegationDepth ?? 0) > 0;`
  - L620-628：`for await (const chunk of stream) { … if (!isSubagent) chunkSeqs.push(this.session.append("assistant/chunk", { turn, step, chunk }).seq); assembler.push(chunk); }` —— 仅 `assistant/chunk` 的落盘被门控，`assembler.push(chunk)` 在门控之外照常执行（组装/usage 不受影响）。
- btw 子代理**确实是 subagent**（depth ≥ 1）：
  - `dsh-btw/src/host/side-chat-service.ts` L512-522：`parent.ctx.agents.create({ sessionId: childId, seed, meta: hiddenSideChatMeta(parent, childDepth, seed.length), agentOptions: resolveChildAgentOptions(parent, {…}, childDepth), … })`。
  - `$AL/dsh-subagent/lib/index.js` L486-491 `resolveChildDepth(parent)` = `delegationDepthOf(parent)+1`（主会话为 0 → child=1）；L501-512 `resolveChildAgentOptions` 写入 `subagentDepth: childDepth`；L530-541 `childSessionMeta` 写入 `delegationDepth: childDepth`。
  - 因此 btw 子代理 `options.subagentDepth ≥ 1` 且 header `delegationDepth ≥ 1` → `isSubagent === true` → **其会话不落任何 `assistant/chunk` 事件**。
  - 注：`.workspace/lag-audit-mechanism.md` L98 曾写「主会话/btw（depth=0）仍流式」——与当前代码不符（btw 子代理 depth=1），该文档此句作废；**②b 部署后 btw 面板确实失去逐 token 文本**，与用户描述一致。

### 1.2 chunk 的产生与去向（agent-loop step()）

- `step()`：`$AL/dsh-agent-loop/lib/index.js` L606-689。
  - L618：`const stream = preparedCall?.stream(request) ?? this.loopCtx.llm.stream(request);`
  - L620-628：唯一 chunk 消费点。去向仅两个：① `assembler.push(chunk)`（L627，内存组装，回合内即逝）；② 非 subagent 时 `session.append("assistant/chunk", …)`（L622-626，落盘 + observer 分发）。
  - **不存在其它分发点**：chunk 不进任何 waterfall、不进 agent 事件总线、不进 observer 回调。subagent 的 chunk 被 `if (!isSubagent)` 完全丢弃（stream 解析本身仍在主线程进行——②a「wire 非流式」未实施）。
- 回合级事件（subagent 照常落盘）：`turn/start` L523、`step/start` L548、`user/message` L554、`tool/call` L293（`appendToolCall`）、`tool/result` L308（`appendToolResult`）、`step/end` L558、`assistant/message` L674-682（每完成一次 stream 写 1 条，`sourceEventSeqs: chunkSeqs`）、`turn/end` L592、`request/header` L734-739、`request/context` L750。
- 打断/出错路径：L630-651 catch 分支——aborted 时若 `assembler.interruptedBlocks()` 非空则写 1 条 `assistant/message { interrupted: true }`（L633-648）；随后 throw（L650）。

### 1.3 是否已存在「不持久化的 chunk 分发挂点」——否，但存在同型挂点可仿

- **不存在**：step() 的 chunk 循环没有任何非持久化分发（§1.2）。
- **但存在同型挂点**：agent 事件总线 `agentEvents(loopCtx, this)`（L356，`$AL/dsh-agent/lib/types/dispatch.js` L31-74）——一个**不落盘、作用域化（agent 载体）、零深拷贝**的分发通道，现用于：
  - `agent/inbox/inserted|discarded|claimed`（agent-loop L357-370）
  - `agent/status`（L384-389，仅状态翻转时 emit）
  - `agent/error`（L470）
  - `agent/session-start`（L1189，`emitAgentEvent`）
  - waterfall/serial 扩展点：`agent/pre-step`（L501）、`agent/request`（L709）、`agent/request-error`（L654）、`agent/turn-stopping`（L565）
- dispatch.emit 语义（`$AL/dsh-agent/lib/types/dispatch.js` L44-62）：`ctx.events.dispatch("emit", [carrier, name, fused(payload)])`，per-listener try/catch 隔离，**payload 引用传递、无深拷贝**。任意插件 ctx（含 btw host）用 `ctx.on("agent/<name>", …)` 即可订阅（btw 已用同型方式监听 `agent/disposed`，side-chat-service.ts L440-444；host-apiproxy 亦用 `ctx.on("agent/status")`，`$AL/dsh-host-apiproxy/lib/index.js` L3655）。
- **结论：方案 B 的挂点 = 在 step() chunk 循环内新增一条 `this.dispatch.emit("agent/stream-chunk", { turn, step, chunk })`（建议 `if (isSubagent)` 门控，见 §6.2）。这是唯一能拿到 subagent 逐 token 数据的点。**

### 1.4 btw host 现有观察机制（side-chat-service.ts / btw-registry.ts）

- btw host 是 TypertRemoteService（`$AL/dsh-typert-protocol`，side-chat-service.ts L428 `extends TypertRemoteService`），命名空间 `sideChat`，**无任何服务端→客户端事件（typert.host.ts `events: []`）**；客户端**纯轮询**：
  - `read()`（L787-794）→ `transcript(entry)`（L346-426）：读 `handle.agent.session.events.slice(seedLength)`（L347）——**直接拉会话事件数组**。
  - `transcript()` 的 partial/reasoning 依赖 `assistant/chunk` 事件（L368-377 累加 text-delta/reasoning-delta；L387-394 过滤已 finalize 的 turn:step）——**②b 之后子代理无 chunk 事件 → partial/reasoning 恒为空串**。
  - `running` = `handle.agent.status === 'running'`（L412-413）+ queued；`runningTool` = 事件里最后一条 `tool/call`（L385、L420）。**「进行中」指示已存在**，粒度 = 轮询周期。
  - `revision` = `events.at(-1)?.seq`（L416）供客户端增量。
- 客户端 `controller.ts`：
  - `poll()` L679-740：`remote.read()`，`delay = running ? 220 : 700`（L718）——回合进行中每 ~220ms 拉一次快照。**「回合末 assistant/message 立即渲染」在 ≤220ms 内已经发生**（运行态 220ms / 空闲态 700ms）。
  - 列表/跳转依赖 `sessions.list.subscribe`（L97）与 tree/project 缓存（L359-394），host 侧 `listTree/listProject`（side-chat-service.ts L980-1024）读 `subagents.listDescendants` / `sessionQuery.listSessions` 并 JOIN 持久索引。
- `btw-registry.ts`：`~/.dsh/btw/index.json` 原子写索引（parentSessionId → childSessionId + title/cwd/lastPreview），与实时流无关，仅列表/恢复用（全文 182 行）。
- **btw host 今天能拿到什么**：子代理会话全部回合级事件（含 turn/step/tool/assistant-message）+ `agent.status` + 最后工具名。**拿不到任何 chunk/逐 token 数据**（chunk 只存在于 step() 循环内）。

### 1.5 dsh-session append/observer 机制（$AL/dsh-session/lib/index.js）

- `Session.append()`（L1444-1484）：每 append 做一次 `snapshotJsonValue(data)` 深拷贝/校验（L1450）→ `deepFreeze` 事件对象（L1457-1463）→ surface 校验（L1464）→ log.push（L1474）→ 经 store 挂载的 publication hook 分发 `session/event`（L1469-1476，`entry.emitCtx` + `entry.carrier`，参数 `[session, event]`）→ 逐 listener 隔离调用（`invokeContainedSessionObservers` L1287-1296）。
- **可附加不落盘观察者吗——可以**：观察者就是 `ctx.on("session/event", …)`（firehose，全局树有 ~20 个监听方，见下），与持久化插件完全解耦（持久化是消费方之一，缓冲异步写）。**深拷贝成本 = 每 append 固定 1 次（durability 契约），与观察者数量无关；观察者共享同一冻结事件对象，无 per-observer 拷贝、无去重问题**（去重是消费者自己的事——如 host-apiproxy mux 的 `subscribed` 集合过滤，`$AL/dsh-host-apiproxy/lib/index.js` L3581）。
- **但对本任务无效**：subagent 的 chunk 根本到不了 append（§1.2），session/event 观察者无 chunk 可见。
- firehose 主要消费方（`grep -rl '"session/event"' $AL/*/lib`）：host-apiproxy（mux）、dsh-client-connection、dsh-client-runtime、agent-instructions、agent-presets、compaction、goal、plan-mode、file-reference、telemetry 等——每 append 的 observer 扇出不小，这正是 ②b 给 subagent 省掉的成本（见 §6.3）。

### 1.6 推送通道现状（mux / typert 转发）

- **mux**（SSE 帧流，`$AL/dsh-host-apiproxy/lib/index.js` L3546-3730）：
  - `FrameQueue` L1095-1150，`MAX_QUEUED_FRAMES = 4096`，溢出丢最旧普通帧、应答帧（approval/question）永不丢（u4/u5 加固，lag 修复产物）。
  - 每连接初始订阅所有会话（L3551 `for (const session of ctx.sessions.list()) subscribeSession(...)`，`subscribeSession` L1174-1181 发 `session/subscribed` 帧）。
  - `ctx.on("session/event")` → `if (!subscribed.has(session.id)) return`（L3580-3600）→ 按会话过滤后推 `session/event` 帧（含 `view`）。**②b 之后子代理会话无 chunk 事件 → mux 无子代理 chunk 帧**（lag 修复的核心收益之一）。
  - `ctx.on("agent/status")`（L3655-3661）→ 推 `host/session-status` 帧（**无会话过滤，推给所有连接**）；`agent/error`（L3662-3668）→ `host/agent-error`。
- **typert 转发**：`$AL/dsh-api-remotes/lib/index.js` L18-30 `API_REMOTE_FORWARDED_EVENTS` 白名单（注释：「Forwarding one more event is an entry here and nothing else」）；apiproxy L3714-3719 对每个白名单名 `ctx.on(name, …)` 推 `host/remote-event` 帧；客户端 `$AL/dsh-client-runtime/lib/client.js` L10518 `if (frame.type === "host/remote-event") ctx.remote.$dispatch(frame.event, frame.args)` → btw 等客户端插件可用 `ctx.remote.$on("…", …)` 订阅（现有用法：`$on("commands/change")`、`$on("settings/document-updated")`、`$on("agent-preset/selected")`）。**加一个新推送事件 = 白名单加 1 条（改 dsh-api-remotes 官方包）+ host 侧 ctx.emit + client 侧 $on。**
- **结论**：btw 面板至今无任何推送通道；「实时」= 轮询（220ms 运行态）。

---

## 2. 方案 A：回合级即时显示 + 活动指示器

### 2.1 可行性：**高，且大半已存在**

- 已存在（无需任何改动）：
  - `running` / `runningTool`：transcript() L412-420 → 客户端 `running` 状态 → 面板活动指示（controller.ts L722-732 已消费）。
  - 回合末 assistant/message 渲染：轮询 ≤220ms（运行态）自动落地。
- 缺口与补法（全部在 btw 包内，零官方包改动）：
  1. **「输出中/思考中」细分**：host 侧 `transcript()` 增加 `agent.phase`（agent-loop L372-389：`{kind, turn, step}`）与最近事件推断——`step/start` 后无 `tool/call` = LLM 流式「输出中」；`tool/call` 后无 `tool/result` = 「工具执行/思考中」；已有事件数据足够（`tool/call` 事件 L293 落盘）。
  2. **进行中信号的其它可用源**（若想从轮询改事件驱动，均不需官方包补丁）：`ctx.on("agent/status", …)`（仅翻转时发）、`ctx.on("session/event", …)` firehose 按 childSessionId 过滤（每 append 实时到达，含 step/start、tool/call、assistant/message）。
  3. **「立即渲染」收紧**：客户端运行态轮询 220ms → ~100-120ms（controller.ts L718 一处），或 host 订阅 `session/event` 后在 turn/end 时点触发客户端刷新（需新增 typert 事件 → 归入方案 B2 通道，非本方案）。
- 语义对齐说明：②b 之后**「subagent 会话界面」本身已是回合级 + 活动指示（无逐 token 文本）**——subagent UI 展示 running/inactive 状态 + tok/s 指标（`$AL/dsh-client-ui-subagent/lib/client.js` L263-279），无 partial 流。因此方案 A 达到的粒度 == 当前 subagent 会话界面的粒度，「近似」成立。

### 2.2 改动面估计

| 处 | 文件 | 内容 | 量级 |
|---|---|---|---|
| btw host | `src/host/side-chat-service.ts` `transcript()` | 增加 step/turn/phase/输出中-or-思考中 字段 | ~10-20 行 |
| btw client | `src/client/controller.ts` / `presentation.tsx` | 状态字段接线 + UI 文案（含 i18n） | ~30-80 行 |
| btw client（可选） | `controller.ts` L718 | 运行态轮询 220→~110ms | ~2 行 |
| 部署 | 工作区构建 → 替换 `~/.dsh/profiles/node_modules/@local/dsh-btw/lib/` | host 重启 + 浏览器刷新（client rev 变化） | 按既有 btw 部署流程（btw-v2-runbook.md） |

### 2.3 成本与风险

- 成本：低。无官方包补丁、无 lag 影响（不产生新帧、不落盘）、轮询 220ms 已是现状。
- 风险：极小。唯一注意——轮询收紧到 ~110ms 会加倍 sideChat/read RPC 频率（每回合 K 次 read，K≈时长/110ms；当前 220ms）。read 成本 = 切片 events + 组装 messages（transcript L346-426），子代理回合事件量小（无 chunk），可忽略；但仍建议仅在 running 时收紧。
- 局限：**无逐 token 文本**（chunk 不存在，本方案不创造 chunk）。

---

## 3. 方案 B：btw 专用 live 流

### 3.1 核心挂点（必须改 agent-loop）

- `$AL/dsh-agent-loop/lib/index.js` step() L620-628 chunk 循环内，`assembler.push(chunk)`（L627）之后新增（建议形式）：

```js
if (isSubagent) this.dispatch.emit("agent/stream-chunk", { turn, step, chunk });
```

- 语义：复用现成 agent 事件总线（`agentEvents`，dispatch.js L44-62）——**不落盘、不深拷贝、不进 session log、不进 mux**；payload 即 ②b 本来要 append 的那个 `chunk`（与 `assistant/chunk` 事件 data 同构：`{ type: 'text-delta'|'reasoning-delta'|…, text }`，btw transcript L368-377 已按此 shape 消费）。
- 为什么用 emit 而非 waterfall：waterfall 是插件贡献/裁决通道（构建 Promise 链，每 chunk 一链，重）；emit 是 fire-and-forget 通知，per-listener try/catch，与 `agent/status` 同机制。
- **与 ②b 的关系**：②b 原样保留（`if (!isSubagent) …append("assistant/chunk")` 不动），本补丁是**新增的旁路通知**；lag 修复验收（子代理会话 0 chunk 事件、1 assistant/message、主会话打字机照常）**全部继续成立**——会话层与 mux 层看不到任何新事件。
- **对主会话打字机的影响**：建议 `if (isSubagent)` 门控 → 主会话路径与今天字节级一致（只多一次已算好的布尔判断）。若不加门控，主会话每 chunk 多一次空分发（fused spread + registry 查找），虽有界但没必要。

### 3.2 btw host 侧（订阅 + 内存缓冲 + transcript 合并）

- `side-chat-service.ts` 构造器或 `start()` 中 `ctx.on("agent/stream-chunk", ({ agent, turn, step, chunk }) => { if (String(agent.id) === String(entry.childSessionId)) … })`（同 `agent/disposed` L440-444 的订阅方式）。
- `LiveSideChat` 增加 `livePartial: Map<"turn:step", { text: string; reasoning: string }>`（内存，不落盘）：
  - text-delta → 追加 text；reasoning-delta → 追加 reasoning。
  - 该 turn:step 的 `assistant/message` 落地（含 interrupted L633-648 路径）或 `turn/end` → 删除对应/全部 key。
  - 关闭/销毁（`forget`/`disposeAll` L1102-1123）时随 entry 释放。
- `transcript()` L346-426 合并：partial/reasoning = 现有 chunk 累加 ∪ livePartial 中未 finalize 的 turn:step（与现有 finalized 集合逻辑一致，L378-394 复用 key 规则）。
- 传输（两种子方案，见 §4）：
  - **B1：纯内存 + 现状轮询**——客户端零改动（或运行态轮询微调），live 粒度 ≈ 220ms（近实时，非逐 token）。
  - **B2：真推送**——btw host 将聚合文本以新 host 事件 `ctx.emit("side-chat/stream", { chatToken, partial, reasoning, turn, step })` 发出，dsh-api-remotes 白名单加 1 条，btw client `ctx.remote.$on("side-chat/stream", …)` 渲染。**建议聚合后推（每 ~100-200ms 推一次完整快照而非逐 chunk 增量）**：帧数从 K 降到 K/10~K/20，且快照自愈（FrameQueue 丢帧不影响最终文本，最终 assistant/message 兜底全量）。

### 3.3 成本对比：每 chunk 一次 observer 分发 vs 会话 append + 持久化

| 维度 | ②b 后现状（subagent，chunk 丢弃） | 方案 B（新增 emit） | 对比：主会话 append 路径（②b 前 subagent 同款成本） |
|---|---|---|---|
| 深拷贝/JSON 校验 | 0 | 0（引用传递） | `snapshotJsonValue` 1 次 + `deepFreeze`（dsh-session L1450/1457） |
| surface 校验 | 0 | 0 | `surfaceManager.validateNext`（L1464） |
| log push / eventsSnapshot 失效 | 0 | 0 | 1 次（L1474-1475） |
| observer 扇出 | 0 | 仅匹配该 agent 载体的订阅者（btw 1 个；firehose 的 ~20 个监听方全部不触发，因为事件名不同） | `session/event` firehose 全量扇出（apiproxy mux + 持久化 + telemetry + …，见 §1.5） |
| 持久化 I/O | 0 | 0 | 200ms 批 zstd+fsync 写链 |
| mux 帧 | 0 | 0（emit 不进 session/event） | 每 chunk 每订阅浏览器 1 帧（u4 后按会话过滤） |
| 新增主线程成本 | — | 1 次 cordis emit（fused spread + 注册表查找 + 1 个 listener 调用，同步、无 I/O） | — |

- **量级**：方案 B 每 chunk 成本 ≈ ②b 已省掉的 append 路径的 **~1-3%**（仅一次同步事件分发，无拷贝/无落盘/无持久化/无帧）。且 stream 的 SSE 解析成本本来就存在（②a 未实施），emit 不新增解析。
- **对 lag 的影响**：会话层与 mux 层零新增事件 → lag 修复（②b + u4 订阅过滤 + FrameQueue 有界化）全部保持生效；唯一的推送面 = btw 面板单订阅者（B1 甚至零新帧）。多开 N 个子代理时：N × K × 1 次同步 emit（无监听者时的分发开销亦 ~0，因事件名无订阅者即返回空列表——见 dispatch.js L50 过滤）。**B2 推送需注意帧率**：不加聚合时 K 帧/轮经 FrameQueue（4096 上限，溢出丢最旧——文本流可容忍，但需快照式帧保证不花屏，见 §3.2）。

### 3.4 改动面（B1 / B2）

| 处 | 文件 | B1 | B2 |
|---|---|---|---|
| 官方包 dsh-agent-loop | `$AL/dsh-agent-loop/lib/index.js` L627 后 | +3 行（emit，isSubagent 门控） | 同左 |
| 官方包 dsh-api-remotes | `$AL/dsh-api-remotes/lib/index.js` L18-30 白名单 | — | +1 行 |
| btw host | `src/host/side-chat-service.ts` | 订阅 + 缓冲 + transcript 合并（~40-60 行） | 同左 + `ctx.emit` 聚合推送（~15-25 行） |
| btw client | `src/client/controller.ts` + 面板组件 | （可选）轮询微调 ~2 行 | `$on` 订阅 + 渲染（~30-60 行） |
| 补丁管理 | `.workspace/deploy-lag/replay-lag-fix.sh` | 扩展：agent-loop 补丁 #2 的备份/应用/锚点/回滚（脚本锚点现为 `isSubagent×2`，新补丁不得破坏） | 同左 + api-remotes 补丁 |
| 生效方式 | — | agent-loop 补丁 + btw host 需**重启 DSH**；btw client 刷新浏览器 | 同左 |

### 3.5 风险与既有约束

- **不破坏主会话打字机**：`if (isSubagent)` 门控保证主会话 chunk 路径与现状字节级一致（§3.1）。
- **不把 lag 修回去**：新事件不进 session log / 不进 mux / 不持久化；②b 验收（0 chunk 事件）不变。B2 推送面受 mux 连接数约束（host/remote-event 帧会发给所有连接、由客户端 `$dispatch` 按订阅丢弃——单浏览器部署下 = 单订阅者成本）。
- **②b 补丁共存**：dsh-agent-loop 已被 ②b 打过（2 hunk，`.workspace/lag-fix-exec.md` U-1），本补丁为同文件第 2 个补丁；`replay-lag-fix.sh` 的 isSubagent 锚点与备份机制必须同步扩展，否则重装再抹时新补丁丢失。
- **与 btw 官方 patch 的关系**：btw 现依赖的官方包补丁是 host-apiproxy 的 `session/prompt-image-transform`（L2766-2771，不同文件），互不影响；本方案新增 agent-loop 与（B2 时）api-remotes 两个补丁文件。
- **重启生效**：host 侧（agent-loop、btw host）全部改动需重启 DSH；client 侧刷新即可。
- **实现注意**：max-tokens 重试时同 turn:step 会写多条 assistant/message（step() 内 while 循环，L613-688），livePartial 的清理必须以「该 key 出现 assistant/message 即清」为准（与 transcript 现有 finalized 集合同语义），不能依赖单次消息。

---

## 4. 方案 B 传输子方案对比

| | B1：内存缓冲 + 轮询增强 | B2：真推送（typert 转发） |
|---|---|---|
| 官方包补丁 | agent-loop 1 个 | agent-loop + dsh-api-remotes 2 个 |
| btw client 改动 | 无（或轮询微调） | `$on` + 渲染 |
| live 粒度 | ≈220ms（可调 ~110ms） | 聚合推送 ~100-200ms / 逐 token |
| 新增 wire 流量 | 0 | K 帧（聚合后 ~K/10）经 FrameQueue |
| 丢帧自愈 | 天然（每次 read 全量快照） | 需快照式帧设计（否则丢帧花屏） |
| lag 风险 | 无 | 低（单订阅者 + 帧合并）；若逐 token 推需评估帧率 |
| 复杂度 | 低 | 中 |

---

## 5. 方案 A vs 方案 B 总对比

| 维度 | 方案 A | 方案 B1（推荐形态） | 方案 B2 |
|---|---|---|---|
| 可行性 | 高（大半已存在） | 高（挂点明确） | 高（通道已验证） |
| 挂点 | btw 包内（transcript/controller） | agent-loop L627 + btw host | 同左 + api-remotes 白名单 + client $on |
| 逐 token 文本 | 无 | ~220ms 近实时 | ~100-200ms / token 级 |
| 官方包补丁数 | 0 | 1（agent-loop，+3 行） | 2（+api-remotes 1 行） |
| 与 ②b/lag 的关系 | 无触碰 | 旁路通知，②b 语义不变 | 同左；推送面单订阅者 |
| 改动量 | host ~10-20 行 + client ~30-80 行 | + host ~40-60 行 | + client ~30-60 行 + 白名单 |
| 部署 | 替换 btw lib + 重启/刷新 | 补丁 + btw lib + 重启/刷新 | 同左 |
| 主要风险 | 无 | 低（补丁共存/锚点） | 中（帧率/自愈/多包补丁） |

---

## 6. 推荐

1. **首选落地「方案 A」**（回合级 + 活动指示器）：零官方包改动、风险最低、**粒度已与 ②b 之后真实存在的「subagent 会话界面」完全一致**（subagent UI 现在也是回合级 + running 指示 + tok/s，无逐 token 文本——`$AL/dsh-client-ui-subagent/lib/client.js` L263-279）。改动集中在 btw 包：transcript() 增补 step/turn/输出中-or-思考中 状态，客户端面板补文案，可选运行态轮询 220→~110ms。
2. **若用户要求看到文本「边生成边出」（超出 subagent 界面现有粒度）→ 上「方案 B1」**：agent-loop L627 后 3 行补丁（`if (isSubagent) this.dispatch.emit("agent/stream-chunk", …)`）+ btw host 内存缓冲合并进 transcript()。不落盘、不进 mux、不触碰 ②b，主会话打字机路径字节级不变；live 粒度 ≈220ms，无新 wire 流量。这是「成本最低、能把文本捞回来」的路径。
3. **B2（真推送）仅当「220ms 轮询不够、要 token 级/即时刷新」且愿意承担第 2 个官方包补丁（api-remotes 白名单）+ 帧合并与丢帧自愈设计时**再考虑；建议聚合快照推送而非逐 token 帧。

**给用户的裁决点**：粒度诉求（回合级 = 方案 A / 近实时文本 = 方案 B1 / token 级推送 = 方案 B2）与「是否接受再打 dsh-agent-loop 官方包补丁」这两个选择。

---

## 7. 未确认项（供后续核实）

1. `~/.dsh/profiles/web|web2` 的 node_modules farm 与全局树（npm-global）的挂载关系：lag runbook 声明全局树为「实际运行底座」，且全局树内 agent-loop/host-apiproxy 均含对应补丁 → 判定运行底座为全局树；但 profiles farm 的精确解析链未静态核实。
2. 客户端 `sessions` list 投影对 btw 隐藏子会话（origin 'subagent' 且无 parentSession）的过滤机制未逐行核实——影响「客户端直接消费 mux 中该子会话 session/event 帧」这一变体（判断为与 btw 隐藏设计冲突，不推荐，未确认）。
3. B2 逐 token 推送在长输出下的实际帧率与 FrameQueue 丢帧对面板观感的影响未实测（建议按聚合快照设计规避）。
4. agent/stream-chunk 事件名是否与未来官方事件冲突（当前官方无此名，未确认未来版本）。

---

## 附：关键文件:行号索引

- `$AL/dsh-agent-loop/lib/index.js`：preStep L492-514；turn L516-605；step L606-689（isSubagent L612；chunk 循环 L620-628；assistant/message L674-682）；buildRequest L694-763；inbox 事件 L357-370；agent/status L384-389；agent/error L470；agent/session-start L1189；prepare/enter/announce L1112-1203。
- `$AL/dsh-agent/lib/types/dispatch.js`：agentEvents/emit/serial/waterfall L31-74。
- `$AL/dsh-agent/lib/index.js`：AgentRegistry enter L601-627；agent/disposed L638-652；agent/created L668。
- `$AL/dsh-session/lib/index.js`：append L1444-1484；observer 分发 L1469-1476；store enter L1693-1702；sessions.list L1827-1829；session/created announce L1734-1760。
- `$AL/dsh-host-apiproxy/lib/index.js`：FrameQueue L1095-1150；subscribeSession L1174-1181；mux L3546-3730（session/event 订阅过滤 L3580-3600；agent/status L3655-3661；agent/error L3662-3668；白名单转发 L3714-3719）；btw 官方补丁 prompt-image-transform L2766-2771。
- `$AL/dsh-api-remotes/lib/index.js`：API_REMOTE_FORWARDED_EVENTS L18-30。
- `$AL/dsh-subagent/lib/index.js`：resolveChildDepth L486-491；resolveChildAgentOptions L501-512；childSessionMeta L530-541。
- `$AL/dsh-client-runtime/lib/client.js`：host/remote-event → $dispatch L10518。
- `$AL/dsh-client-ui-subagent/lib/client.js`：subagent UI 活动/running 指示 L263-279。
- `dsh-btw/src/host/side-chat-service.ts`：start/create L447-542；startResumed L549-605；transcript L346-426；read L787-794；agent/disposed L440-444；injectOpeningNotices L743-752。
- `dsh-btw/src/client/controller.ts`：poll L679-740（delay L718）。
- 部署：btw lib `~/.dsh/profiles/node_modules/@local/dsh-btw/lib/`（工作区构建）；补丁 replay 脚本 `.workspace/deploy-lag/replay-lag-fix.sh`；lag 补丁基线 `.workspace/lag-fix-exec.md`。
