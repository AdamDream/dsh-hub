# G1-streaming-session 增量调研笔记（ARCH 0.1.5 vs GLOB 0.1.1）

调研方式：diff 产物在 `/home/CNS2026495165/dsh/.workspace/upstream-015-diff/pkgs/<pkg>.{combined,libjs,upstream,upstream-libjs}.diff`。
**方向说明**：`combined.diff` = diff(ARCH, GLOB)，即 `-` 行 = 0.1.5(ARCH)、`+` 行 = 0.1.1(GLOB)；`upstream*.diff`（仅本地有补丁的包）= diff(BASE, ARCH)，`-` = 0.1.1 基线、`+` = 0.1.5。已用 GLOB/ARCH 实文件双向核验（如 `SESSION_FORMAT_VERSION`：GLOB=0、ARCH=3；`packChunkRuns` 在 GLOB、ARCH 已删）。
**关键事实**：GLOB 0.1.1 已自带 write-behind 批量协调器（dsh-session-persistence 1396 行，含 SessionWriteBehind/SessionPreparations/coordinator）；0.1.5 把它拆进 jsonl 后端（persistence 包只剩 267 行错误+契约）。两分支在会话存储上分道扬镳（0.1.1: v0 格式+assistant/chunk+chunk-rows 存储压缩；0.1.5: v3 格式+assistant/attempt+seq-ranges+handle 模型+迁移链）。

---

## (a) 每包增量分类

| 包 | 分类 | 说明 |
|---|---|---|
| dsh-agent-loop | api（流式模型重写） | 0.1.5 彻底重写 step()/inbox/持久化接入；含 reasoningEffort、dispose 健壮性等小增量 |
| dsh-session | api（B4 存储重构） | 格式 v0→v3、事件词汇、surface 形状全变；少量独立校验增量 |
| dsh-session-persistence | api（坐标器拆出） | GLOB 已含 write-behind/preparations；0.1.5 拆进后端；仅 SessionPersistenceNotFoundError 可借 |
| dsh-session-persistence-jsonl | perf/stability（后端重写） | 0.1.5 新增跨进程写租约、zstd worker 校验、格式迁移链——依赖新格式，不借 |
| dsh-session-projection | api（简化/松弛） | 0.1.5 增 keys 过滤与 hydrate，但删了 0.1.1 已有的视图去重/严格 seq 校验；净增量小 |
| dsh-session-projection-cache | perf/stability | 0.1.5：per-record 域布局+backup-and-skip、冷读阶梯(readFrom tail)、身份强化、putSoft |
| dsh-session-query | api（B4 适配） | readColdSessionLog vs GLOB inspect；等价 |
| dsh-session-query-sqlite | api（B4 适配） | isSeeded→seedLength 绑定替换 |
| dsh-session-stats | noise/api | ttft/decode 计算从 assistant/attempt 流改为 assistant/chunk 事件时间，行为等价 |
| dsh-session-reference | api/gui | 配置与路由机制随新模型（system-prompt/assemble、readTitleSnapshots） |
| dsh-session-log-export | api | 导出格式整体重写（session-format 包+zip+flush） |
| dsh-session-checkpoint-policy | noise | 仅 package.json/README |
| dsh-output-retention | noise | 仅 package.json/README |

---

## (b) 值得借到 0.1.1 的候选

### C1. projcache 冷读阶梯（coldSnapshot 用 persistence.readFrom 尾读，免整日志加载）
- 价值：冷开会话不再全量读日志——cached 行 + `readFrom(id, restoreFloor(cached))` 尾读 → restore 折 → 回写（失败仅告警）。身份不符或日志缩水（崩溃截断）时自动降级为 seq 0 全读。
- 证据：ARCH `dsh-session-projection-cache/lib/index.js` coldSnapshot（combined.diff 313-340 行，ARCH 侧 `-`）；`putSoft`（combined.diff 365-372）；`restoreFloor` 在 ARCH/GLOB `dsh-session-projection` 都有（GLOB 也有）。GLOB `dsh-session-persistence` **已有** `readFrom(id, fromSeq, signal)`（GLOB index.js:931-935）。
- 最小 patch 面：`dsh-session-projection-cache/lib/index.js` 的 coldSnapshot + putSoft（~60-80 行）；`dsh-session-projection/lib/types/index.js` 的 restore 无需改（GLOB 已支持 baseSeq+events 窗口）。调用方（registry 冷读处）从"传全量 events"改为"传 id"。
- 与本地补丁冲突：无（projcache 不在补丁清单；不触碰 agent-loop/apiproxy/subagent）。
- 成本：中（<200 行）。风险：低-中（需确认 GLOB readFrom 返回 {events, meta} 形状与 identity 校验可用）。
- **P1**

### C2. dsh-session 事件校验增量（validateSessionEventData 的 tool/result 部分）
- 价值：append/采纳时早失败——tool/result 带 error 时强制 `message.content[0].isError === true`（0.1.1 采纳路径只查 message 形状，不查矛盾元数据）。
- 证据：ARCH `dsh-session/lib/types/surface.js` validateSessionEventData（combined.diff 889-919 行 ARCH 侧；GLOB 无此函数）。
- 注意：ARCH 版同时含两条与 0.1.1 冲突的规则，**不要借**：`request/header` 必须省略 `header.system`（0.1.1 的 canonicalHeader/请求仍携带 system，见 GLOB request-header.js）与 `assistant/message` 禁 sourceEventSeqs（0.1.1 的 assistant/message 依赖 sourceEventSeqs 引 chunk，②b 子代理路径用空数组也被 0.1.1 的 assertProvenance 放行——GLOB surface.js 已允许空 sourceEventSeqs 的 assistant/message）。
- 最小 patch 面：`dsh-session/lib/types/surface.js` 增加 isRecord+tool/result 校验，在 append/adoptSessionEvent 挂上（<40 行）。
- 与本地补丁冲突：无。
- 成本：小。风险：低。
- **P2**

### C3. SessionPersistenceNotFoundError + agent-loop restore 精确判错
- 价值：`restoreOrCreateConfigured` 用 `error instanceof SessionPersistenceNotFoundError` 取代 `(await persistence.list()).some(...)`——精确区分"未找到"与真实错误，消除 list() 竞态/误吞。
- 证据：ARCH agent-loop（upstream-libjs.diff 966-970；ARCH index.js:1593-1596）；ARCH dsh-session-persistence errors 区（combined.diff 26-42 行 ARCH 侧，GLOB 无此类）。
- 最小 patch 面：dsh-session-persistence 添加 ~8 行错误类 + 让 prepare/open 在未找到时抛它；agent-loop restoreOrCreateConfigured 改 1 处判定。
- 与本地补丁冲突：无。
- 成本：小。风险：低。价值也低（0.1.1 单进程部署，list() 竞态窗口极小）——**P2/P3**

### C4. agent-loop reasoningEffort 选项
- 价值：AgentOptions 增加 `reasoningEffort`，优先于持久化 header 的旧值（0.1.5 在 prepareRequest 里 `this.options.reasoningEffort ?? persistedReasoningEffort`）。
- 证据：ARCH agent-loop（upstream-libjs.diff 754-756、918；ARCH index.js:1001-1003、Config schema）。
- 最小 patch 面：GLOB agent-loop lib/index.js buildRequest 的 reasoningEffort 解析行（GLOB:702）+ Config schema 加字段（~10 行）。GLOB 的 header 已支持 reasoningEffort（dsh-session request-header 两侧都有 adapterDefaults.reasoningEffort）。
- 与本地补丁冲突：无。
- 成本：小。风险：低。**P2**

### C5. agent-loop dispose 失败聚合 + 未处理拒绝防护
- 价值：dispose 收集 detach/close/scope.dispose 的所有失败并 AggregateError 抛出，不再在 finally 链里吞错；setup 失败路径 `dispose().catch(()=>{})` 防 unhandled rejection。
- 证据：ARCH agent-loop（upstream-libjs.diff 989-1022、1072、1110、1209；ARCH index.js:1647-1680 等）。
- 最小 patch 面：GLOB agent-loop prepare() 的 dispose 闭包（~25 行重排）。注意 ARCH 的 generator-effect 结构（machineReady 在 effect 内 resolve）与 GLOB 同步构造不同，只移植"失败收集"语义，不移植结构。
- 与本地补丁冲突：无（避开 isSubagent 两行）。
- 成本：小-中。风险：低。**P2/P3**

### C6. projcache 身份强化（seedLength 生命周期绑定）
- 价值：缓存记录身份从"createdAt+cwd"强化为含 fork 血统（0.1.5 用 isSeeded+inheritedEventCount；0.1.1 等价字段是 header.seedLength），防"删后重建同 id / 换持久化根"串用旧缓存。
- 证据：ARCH projection-cache identityOf/identityMatches（combined.diff 380-412 ARCH 侧）；GLOB 版只有 createdAt+cwd（GLOB index.js identityOf）。
- 最小 patch 面：projection-cache identityOf/identityMatches + checkpointIdentity schema（~15 行，用 seedLength 而非 isSeeded/inheritedEventCount）。
- 成本：小。风险：低（老缓存记录无 seedLength 字段需按 undefined 兼容）。**P2**

### 明确不借（评估过）
- 0.1.5 流式模型整体（见 (d) 与重点问题 1）：跨 6+ 包、>1000 行，与 U-4/U-5 冲突。
- jsonl 跨进程写租约/worker 校验/迁移链：依赖 v3 格式与 koffi 原生依赖。
- projcache per-record 域布局 + backup-and-skip：GLOB `dsh-storage-domain` 无 per-record/invalidRecords 能力（GLOB 仅 1 处 layout 字样，ARCH 有 backup-and-skip×4/invalidRecords×5/per-record×2），需先升级 storage-domain，面大。
- session-reference/log-export 新 API：依赖新模型。

---

## (c) 明显稳定性 bugfix 清单

1. **agent-loop restore 判错精确化** — ARCH agent-loop（upstream-libjs.diff:966-970）：`(await persistence.list()).some(id)` → `error instanceof SessionPersistenceNotFoundError`。修：list() 竞态（刚创建未列出的会话被误判为不存在而吞掉真实错误）。GLOB 仍是旧写法（GLOB agent-loop restoreOrCreateConfigured）。
2. **agent-loop dispose 吞错** — ARCH（upstream-libjs.diff:989-1022）：原 finally 嵌套把 detach/unfollow/close 的错误吞掉；改为收集 failures 聚合抛出。GLOB 保留旧嵌套。
3. **agent-loop 未处理拒绝** — ARCH（upstream-libjs.diff:1072,1110,1209）：catch 路径 `dispose()` → `dispose().catch(() => {})`，避免 dispose 失败变成 unhandled rejection 覆盖原始错误。
4. **dsh-session tool/result 错误一致性校验** — ARCH surface.js validateSessionEventData（combined.diff:907-919 ARCH 侧）：tool/result 带 error 必须 content[0].isError===true，否则 append/采纳抛错（早失败）。GLOB 无此校验。
5. **dsh-session request/header 空字段规范化校验** — ARCH 同函数（combined.diff:895-906）：空 tools/adapterDefaults/system 必须省略。（0.1.1 相关部分与自身模型冲突，只借 tool/result 部分，见 C2。）
6. **dsh-session-projection 缺失 seq 检测（GLOB 已具备，非增量）**：GLOB restore/advanceCell 有"cannot restore across missing seq"严格校验（GLOB types/index.js），ARCH 反而松弛了——无需借。
7. **持久化加载的 interruptedTurnClosers（GLOB 已具备，非增量）**：GLOB dsh-session-persistence:995 已在 prepare 加载时补 closers、:1055 拒绝 live open turn——0.1.5 只是把该逻辑挪进 agent-loop resume（open/read/append 路径）。GLOB 无需借。

---

## (d) 0.1.5 破坏性 API/接口变更（勿借项，说明破坏面）

1. **会话日志格式 v0 → v3**（dsh-session types.js；GLOB `SESSION_FORMAT_VERSION=0`、ARCH `=3`）+ 迁移链包（dsh-session-format/-v2-to-v3 等）。0.1.5 拒读 v0 日志（sessionFormatVersionRefusal）。借 = 必须迁移存量日志，破坏面最大。
2. **事件词汇**：`assistant/chunk` 删除 → `assistant/attempt`（settlement 事件，payload 内嵌紧凑 stream）；新增 `system/message`、`agent/inbox/spliced`、`todo/write` 等；`tool/ptc-dispatch*` ↔ `tool/code-dispatch*` 改名；KNOWN_SESSION_EVENT_TYPES 相应增删。0.1.1 的 chunk 事件在 0.1.5 仅由格式迁移包读取。
3. **存储行编码**：`packChunkRuns`/`ChunkRow`（0.1.1 的 assistant/chunk 存储压缩，GLOB chunk-rows.js）→ `encodeSeqRanges`/`decodeSeqRanges`/EncodedSeq（ARCH seq-ranges.js）。机制随事件模型变化。
4. **surface 元数据形状**：`surfaceOp.replace` 的 `{startSeq,endSeq}` → `{start,end}`（ARCH surface.js isReplaceOp）。任何写 replace 的调用方（compaction、system-prompt 替换）全要改。
5. **Session API**：`.events` getter → `snapshotEvents(fromSeq, toSeqExclusive)` + `eventAt(seq)`；`ownEvents/isOwnSeq/inheritedEventCount` 删除/改由 header 表达；`Session.create/fromRestore/prepare` 签名变化（isSeeded → seedLength、eventState → seedSource:'persistence'、init(header, inheritedEventCount) → init()）。
6. **持久化契约**：`persistence.prepare(id)` → `open(id,"write")` + `handle.read/append/close`（写句柄模型）；GLOB 的 coordinator（SessionPreparations/SessionWriteBehind）在 0.1.5 从共享包拆入各后端；agent-loop 亲自持有句柄（createStoredSession/appendUnstoredSuffix）。
7. **流式事件通道**：`assistant/chunk`（GLOB 中同时是持久化+直播载体，host-apiproxy/client-connection/client-ui-conversation/token-meter/subagent 都消费）→ 进程内 `agent/assistant-stream` 帧（dsh-api-session-controller/dsh-headless 等消费）。
8. **inbox**：dsh-agent 的内存 `Inbox` → dsh-agent-loop 内 durable `ReactLoopInbox` + `agent/inbox/spliced` 投影。
9. **settings 接线**：`installSettingsSection(ctx, ...)` → `settingsCtx.settings.installSection(...)`（dsh-settings API 变化）。
10. **projcache 域**：域版本 3→7、whole-medium → per-record、身份字段（formatVersion/isSeeded/inheritedEventCount）。

---

## 重点问题回答

### Q1. 0.1.5 agent-loop 流式模型：增量本质 / ②b 天然实现? / 最小 patch 面 / 与 isSubagent 冲突
- **本质**（ARCH dsh-agent-loop/lib/index.js）：持久化与直播**解耦**。0.1.1 中逐 token `assistant/chunk` append 身兼两职（持久化 + 直播载体）；0.1.5 中 chunk 只走进程内帧（`AssistantStreamAttempt.push` → `dispatch.emit("agent/assistant-stream", {frame})`，ARCH:1032），**每 attempt 只落 1 个持久事件**：`assistant/message`（成功/中断有内容，payload 带 `stream`，ARCH:1050,1108）或 `assistant/attempt`（中断无内容/错误后，仅 stream+usage，ARCH:1065,1070,1083）。`AssistantStreamAttempt` 类在 ARCH:358-475（d.ts: lib/types/assistant-stream.d.ts），依赖 dsh-llm 新增 `AssistantStreamAccumulator`（ARCH dsh-llm/lib/types/assistant-stream.js:31；**GLOB dsh-llm 无此文件**）。inbox 改为 durable 投影：`inboxProjectionDefinition`(ARCH:26)+`ReactLoopInbox`(ARCH:45-237)，`session.append("agent/inbox/spliced", splice)`(ARCH:206)。另有 turnBoundary 投影(ARCH:1300)、system/message 节点+SystemPromptProjection(ARCH:262-320)、request/header reason:"series"。
- **对 ②b 目标**：**天然实现且全局化**。新模型对主会话和子代理一律 attempt 级落盘，②b 想消除的"子代理逐 token 写放大"在 0.1.5 对全体消失。代价：主会话也失去逐 chunk 持久化（0.1.1 中孤儿 chunk 本就不进 deriveMessages/UI 回放，损失量级相近）；直播改走新帧通道。
- **最小 patch 面**：
  - 只借思想（推荐）：②b（GLOB:612,622）已是该思想的子代理侧实现；主会话侧若要推广为"单事件落盘"，**必须同时迁移直播通道**（见下），否则 host-apiproxy 的 assistant/chunk 定帧转发、client-ui-conversation 的逐 token 渲染、token-meter、subagent assistant-output 全部失去数据源。
  - 借完整模型：必须连带 (a) dsh-llm 新增 AssistantStreamAccumulator/assistant-stream.d.ts；(b) dsh-session 新类型与事件词汇（assistant/attempt、agent/inbox/spliced、system/message、snapshotEvents、surface start/end、v3 格式）；(c) 直播帧通道迁移（agent/assistant-stream 事件 + host-apiproxy 转发 + client-connection + client-ui-conversation + token-meter + subagent）。跨 6+ 包、>1000 行，且 (c) 与本地 **U-4/U-5 apiproxy 补丁直接冲突**（该补丁按 assistant/chunk 帧做 mux 过滤/有界队列）。
  - 结论：借完整模型 = 大工程，与"借源码不升级"目标相悖；收益大头已被 ②b（子代理）+ GLOB JSONL packChunkRuns（主会话存储压缩 ~56×）覆盖。
- **与本地 isSubagent 补丁冲突**：0.1.5 **没有 isSubagent 概念**（grep 仅 GLOB 命中 GLOB:612,622）。移植完整模型则 ②b 两行自动删除（被超集取代）；不移植则 ②b 原样保留，无冲突。部分借（C4/C5）与 ②b 不重叠。

### Q2. dsh-session B4 中可独立借的小增量
只有一条半：(C2) `validateSessionEventData` 的 **tool/result 错误一致性**校验（不依赖新模型；request/header 与 assistant/message 两条规则与 0.1.1 冲突不借）；(半条) `snapshotEvents/eventAt` 作为 `.events` 之外的附加 API（纯增量、低价值）。其余"事件校验/seq 处理/并发修复"GLOB 已具备：append 重入守卫（GLOB index.js:2651 区域）、-0 拒绝（GLOB envelope 校验）、surface 严格 contiguity/缺失 seq 检测（GLOB projection 与 session 两侧都比 ARCH 严）。

### Q3. persistence/-jsonl 纯性能/稳定性增量
GLOB 0.1.1 **已自带** write-behind 批量（SessionWriteBehind，maxDelayMs 200、失败重排队+automaticPaused、flush barrier）、preparation 共享 LRU（capacity 5）、加载时 interruptedTurnClosers 修复（:995）、live open turn 拒绝（:1055）、损坏/格式错误分类。0.1.5 相对增量：(C3) SessionPersistenceNotFoundError（可独立借）；jsonl 的 SessionWriteLease 跨进程锁（koffi/flock）、zstd worker 校验（MAX_CONCURRENT_VERIFIERS=2）、按版本+压缩后缀的分代文件名、迁移链——全部绑定 v3 格式/handle 模型，**不借**。

### Q4. projcache 0.1.5 增量与 patch 面
键：per-record 域布局（写一份会话文档，不再重写整个 session_projcache.json）——需 dsh-storage-domain 支持（GLOB 无 per-record/invalidRecords），面大不借；失效：身份从 createdAt+cwd 强化为含血统（0.1.1 用 seedLength 等价移植，C6）；并发/读路径：冷读阶梯 coldSnapshot（C1，GLOB readFrom 已具备，**可借**）+ putSoft + keys 过滤（低价值）+ cachedPredecessorTitle（依赖新模型）。

### Q5. bugfix 清单
见 (c)。

---

## (e) 每包一句话裁决

- **dsh-agent-loop**：部分借 —— 借 reasoningEffort(C4)、dispose 失败聚合(C5)、restore 精确判错(C3 前置)；流式模型整体不借（与 ②b/U-4/U-5 冲突且需跨包直播迁移）。
- **dsh-session**：不借（B4 破坏面全包）—— 仅 (C2) tool/result 校验小片可借。
- **dsh-session-persistence**：部分借 —— 仅 SessionPersistenceNotFoundError(C3)；write-behind/preparations GLOB 已有。
- **dsh-session-persistence-jsonl**：不借 —— 增量全绑定 v3 格式/原生锁/worker 校验。
- **dsh-session-projection**：不借 —— 0.1.5 净简化/松弛，GLOB 现有校验更严；keys 过滤低价值。
- **dsh-session-projection-cache**：部分借 —— 冷读阶梯(C1, P1)、身份强化(C6, P2)；per-record 布局需 storage-domain 升级，另议。
- **dsh-session-query**：不借 —— B4 适配，行为等价。
- **dsh-session-query-sqlite**：不借 —— B4 适配，行为等价。
- **dsh-session-stats**：不借 —— 事件映射替换，行为等价。
- **dsh-session-reference**：不借 —— 配置/路由机制绑定新模型。
- **dsh-session-log-export**：不借 —— 导出格式整体重写，依赖 session-format 包。
- **dsh-session-checkpoint-policy**：不借 —— 纯版本/README 噪音。
- **dsh-output-retention**：不借 —— 纯版本/README 噪音。

## 关键证据行号索引

- ARCH agent-loop：AssistantStreamAttempt 类 lib/index.js:358-475（d.ts lib/types/assistant-stream.d.ts）；step() :1008；agent/assistant-stream 帧 :1032；settle assistant/message :1050,1108；settle assistant/attempt :1065,1070,1083；inboxProjectionDefinition :26；ReactLoopInbox :45-237；agent/inbox/spliced append :206；turnBoundaryProjectionDefinition :1300；restore 判错 :1593-1596；dispose 失败聚合 :1647-1680；reasoningEffort :1001-1003。
- GLOB agent-loop：isSubagent :612；`if (!isSubagent) chunkSeqs.push(append assistant/chunk)` :622（②b 补丁）。
- ARCH dsh-llm：AssistantStreamAccumulator lib/types/assistant-stream.js:31,116（GLOB dsh-llm 无）。
- ARCH/GLOB dsh-session：SESSION_FORMAT_VERSION ARCH=3/GLOB=0（types.js）；validateSessionEventData ARCH surface.js（combined.diff:889-919 ARCH 侧）；chunk-rows.js(packChunkRuns)=GLOB、seq-ranges.js(encode/decodeSeqRanges)=ARCH（types/index.js export 行）；`assistant/attempt`/`agent/inbox/spliced` 在 ARCH known-event-types.js:23,27；assistant/chunk 在 GLOB。
- GLOB dsh-session-persistence：SessionWriteBehind/preparations/coordinator（index.js:16-495 区域）；readFrom :931-935；interruptedTurnClosers :995；live open turn 拒绝 :1055。
- ARCH projection-cache：coldSnapshot（combined.diff:313-340）、putSoft(:365-372)、identityOf/identityMatches(:380-412)、per-record v7 域（:97-110）。
- GLOB 直播载体（assistant/chunk 消费者）：host-apiproxy lib/index.js+types/api-proxy.js、client-connection、client-ui-conversation、token-meter、subagent assistant-output、client-ui-trajectory。

---

## 审计复核修正（2026-09-15 复核档，直接读 GLOB/ARCH 实文件，不再依赖 diff 行归属记忆）

复核方法：对全部争议点直接 grep/sed GLOB 与 ARCH 的 lib/*.js 实文件，以文件内容为准。

### 1. C1（projcache 冷读阶梯）——方向读反，**剔除**
- **GLOB (0.1.1) 已有完整冷读阶梯**：`async coldSnapshot(id, signal)`（GLOB dsh-session-projection-cache/lib/index.js:177-196），内部 `persistence.readFrom(id, floor, signal)` 尾读（:187）+ 身份不符/缩水日志降级 seq0 全读（:192-195）+ `putSoft` 写回（:196）；:87 注释即 "cold-read ladder"；`putSoft` 方法也在 GLOB（:261）。
- **ARCH (0.1.5) 是同步单行版**：`coldSnapshot(meta, inheritedEventCount, events)`（ARCH :282），接收外部传入完整 events，cache 服务自身不再读持久化——0.1.5 把冷读职责移给调用方（registry/session-query 走 open-handle 读）。
- 结论：我此前把 combined.diff 的 `+`（GLOB）行当成了 ARCH 增量——**读反**。冷读阶梯是 0.1.1 已有能力，无借项；0.1.5 的薄化反向不可借。**C1 剔除**；同时更正：putSoft 亦为 GLOB 已有（:261），非 ARCH 增量。
- 连带更正：flushSoft 强制触发点——**ARCH 有三个**（session/created + turn/end + detach），**GLOB 只有两个**（turn/end + detach；无 create 触发）。我原笔记写反（非借项，仅更正事实）。

### 2. C6（projcache 身份强化）——措辞修正 + 降级 P3
- ARCH projcache 身份字段 = `formatVersion / isSeeded / inheritedEventCount` + createdAt + cwd（ARCH identityOf :361-366），isSeeded/inheritedEventCount 是 **0.1.5 dsh-session header 概念**。
- GLOB projcache identityOf = `{createdAt, cwd}`（GLOB :275-279）——弱身份。
- **seedLength 是 GLOB dsh-session header 的血统字段，不是 projcache 自有字段**（复核确认 GLOB projcache checkpointIdentity/identityOf 无 seedLength）。
- 修正后的 C6：把 ARCH "身份绑定血统" 的思想移植到 GLOB，GLOB-adapted 写法是取 **GLOB session header.seedLength** 加入 GLOB projcache identityOf + checkpointIdentity schema（~15 行）。价值边际：createdAt 已区分绝大多数"删后重建同 id"场景；仅防"同 createdAt+cwd 但血统不同（fork 子 vs 新建）"串用缓存。**降级 P3**（可选加固，非主借项）。

### 3. 连带发现：dsh-session-projection 方向亦全部读反 → 新增 C7
- 实文件证据：GLOB `dsh-session-projection/lib/types/index.js` 无 advanceCell/materializeCells（grep=0），restore 宽松折叠 `for (const event of events) if (event.seq > from) apply`（GLOB :256-259 区域）；ARCH 有 materializeCells(:384)、advanceCell(:408，缺失 seq 抛错 :414)、**restore 严格 contiguity 校验**（ARCH :318-326：`expectedSeq = SessionSeq(baseSeq + index)`，`event.seq !== expectedSeq` 即 throw "cannot restore across missing seq"）。
- 我原笔记"0.1.5 净简化/松弛、GLOB 校验更严"**完全颠倒**：真实是 0.1.5 更严、GLOB 宽松（空洞日志在 GLOB restore 中静默跳过 → 投影状态错误且不报错）。
- **新增 C7（P2）**：把 ARCH restore 的 contiguity/缺失-seq 校验借到 GLOB restore（~12 行）。价值：持久化日志空洞/损坏时 fail-loud 而非静默错投；GLOB projcache coldSnapshot 的 catch（GLOB :192-195）已把 restore 抛错视为降级信号（全读 seq0），行为兼容。风险：需确认 GLOB 其余 restore 调用方（session-query 冷读、log-export）同样容错。不借 ARCH 的 materializeCells/advanceCell 整体（绑定 ARCH Session API eventAt/SessionSeq 品牌）。
- 包裁决修正：dsh-session-projection **不借 → 部分借（仅 C7）**。

### 4. 其余候选方向复核（通过，无需修正）
- C2（dsh-session validateSessionEventData）：GLOB surface.js/index.js 命中=0，ARCH surface.js=1/index.js=4 → **ARCH 有、GLOB 无**，方向正确，保持 P2（仅借 tool/result 部分）。
- C3（SessionPersistenceNotFoundError）：ARCH 有、GLOB 无，保持 P2。
- C4（agent-loop reasoningEffort）：GLOB :702 仅 persistedConfig 来源、Config schema 无该字段（GLOB grep 仅 :330/:702/:706，均 header 相关）→ GLOB 缺 `options.reasoningEffort ??` 优先能力，方向正确，保持 P2。
- C5（dispose 失败聚合）：来自 upstream(BASE→ARCH) diff，方向独立验证（BASE 有 assistant/chunk、ARCH 有 AssistantStreamAttempt；GLOB=BASE+②b），保持 P3。

### 修正后候选清单（按优先级）
| id | 内容 | patch 面 | 裁决 |
|---|---|---|---|
| C7（新） | dsh-session-projection restore 严格 contiguity/缺失 seq 校验（fail-loud 防静默错投） | dsh-session-projection/lib/types/index.js restore（GLOB :256-259 段加 ARCH :318-326 同款 ~12 行） | P2 借 |
| C2 | dsh-session tool/result 错误一致性校验 | dsh-session/lib/types/surface.js（~30 行） | P2 借 |
| C4 | agent-loop AgentOptions.reasoningEffort 优先 | dsh-agent-loop lib/index.js :702 附近 + Config schema（~10 行） | P2 借 |
| C3 | SessionPersistenceNotFoundError + restore 判错精确化 | dsh-session-persistence（~10 行）+ dsh-agent-loop 1 处 | P2 借 |
| C5 | agent-loop dispose 失败聚合 + .catch 防护 | dsh-agent-loop prepare() dispose 闭包（~25 行） | P3 借 |
| C6（改） | projcache 身份血统绑定（GLOB-adapted 用 header.seedLength） | dsh-session-projection-cache identityOf/identityMatches + checkpointIdentity（~15 行） | P3 可选 |
| C1（剔） | ~~projcache 冷读阶梯~~——GLOB 已有，0.1.5 反向薄化 | — | 剔除 |
