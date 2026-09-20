# 上游借码验证报告：0.1.5 源码借取模式独立交叉验证

- 日期：2026-09-15
- 性质：只读独立调研（不改代码、未读任何既有审计报告；所有结论直接取证自两棵树源码）
- 对比基线：
  - 0.1.5 归档树：`~/.dsh/profiles-archive/web2-20260915-105429/node_modules/@deepseek-ai/`（`dsh` = 0.1.5-rc.2，全部子包 0.1.5-rc.2）
  - 0.1.1 全局树：`/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/`（`dsh` = 0.1.1-rc.2，子包位于其 `node_modules/@deepseek-ai/`）
  - 素净 0.1.1 参照：`.workspace/baseline-011/x/`（0.1.1-rc.2 tgz 解包，用于界定既有补丁面）
- 既有补丁面（素净 vs 全局实测 diff，5 包）：
  - `dsh-agent-loop/lib/index.js`：②b 非流式（`isSubagent` 跳过 `assistant/chunk` 持久化）
  - `dsh-host-apiproxy/lib/index.js`：mux/FrameQueue/应答帧守卫 + `sessions/prompt-image-transform`
  - `dsh-subagent`：P0 materialize（`materializeContinuableChild`）
  - `dsh-client-ui-subagent`、`dsh-web-search-deepseek`：各 1 文件
  - 重放脚本：`.workspace/deploy-lag/replay-lag-fix.sh`（sha256 锚点 + dry-run + rollback）

---

## 1. 候选 1 独立核查：槽位多消费者（directoryFlow single→list/keyed/chain 或新增槽）

### 1.1 结论：**不成立（证据否定）**

0.1.5 **没有**把 directoryFlow 改为支持多消费者：
- 两个 directoryFlow 洞在 0.1.1 **已经存在**且结构完全一致；
- 0.1.5 中它们仍是 `kind: 'single'`、`scope: 'root'`，owner 契约逐字相同；
- 0.1.5 全树**没有新增**任何 directoryFlow 相关槽位；
- 槽位 kinds 的渲染语义（single/keyed/chain/list）在两版渲染器中逐行相同——"多消费者能力"在 0.1.5 并未出现。

### 1.2 证据（file:line）

| 事实 | 0.1.1（全局树） | 0.1.5（归档树） |
|---|---|---|
| 洞 1 `conversation.hero.workspace.directoryFlow` = single/root | `dsh-client-ui-workspace/lib/types/client/contract/slots.d.ts:49-54` | 同文件 `:51-56`（逐字相同） |
| 洞 2 `sidebar.workspaces.directoryFlow` = single/root | 同文件 `:55-60` | 同文件 `:57-62`（逐字相同） |
| `DirectoryFlowSlotName`（两洞并集，无新增） | 同文件 `:63` | 同文件 `:65` |
| owner 契约 `DirectoryFlowOwnerProps`（open/busy/onPicked/onCancel/onError） | 同文件 `:36-47` | 同文件 `:37-48`（逐字相同） |
| 注册逻辑：两洞各由 WorkspaceBrowser/WorkspacePicker 声明 single 子洞 | `dsh-client-ui-workspace/lib/client.js:2380-2455`（`kind: "single"` 两处） | 同包 `lib/client.js:2744-2810`（`kind: "single"` 两处） |
| 渲染语义 single=仅第一注册/keyed=按 key/chain=首匹配/list=全部 | `dsh-client-ui-renderer/lib/client.js:794-806` | 同包 `lib/client.js:821-836`（逻辑逐行相同） |
| 槽位 kinds 能力在两版均存在（非 0.1.5 新增） | renderer `lib/client.js` 含 single/keyed/chain 分支 | 同上 |
| 全树 0.1.5 目录流相关槽位总数 | — | `grep -rn "directoryFlow"` 仅命中 workspace 包两洞 + picker 占用方（`dsh-client-ui-directory-picker-browse/native`） |

### 1.3 附注：0.1.5 与"多消费者"真正相关的唯一变化（与 directoryFlow 无关）

- layout 包把中央列 `conversation`（0.1.1 中 `kind:'single'`）改为 `main`（0.1.5 中 `kind:'keyed'`），用于"侧栏条目 id 选主面板"——`dsh-client-ui-layout/lib/types/client/index.d.ts`（0.1.5 `:49-53`，0.1.1 无 `main`）。
- 0.1.5 渲染器把槽注册/订阅暴露为 `ctx.slots: SlotRegistry` 服务 + `slots/changed` 事件（`dsh-client-ui-renderer/lib/types/client/index.d.ts` 0.1.5），属 API 面改造，与 directoryFlow 消费者数量无关。
- `@deepseek-ai/dsh-client-ui-slots` 在两棵树 node_modules **都不是物理包**（编译期内联模块；部署侧 `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-slots` 是指向已清理 npx 缓存的**断链**）。因此不存在"0.1.5 的 dsh-client-ui-slots 包"可借。

### 1.4 对"借 0.1.5 实现槽位多消费者"的裁决

- 最小 patch 面：**空**。0.1.5 没有提供"洞支持多消费者"的现成答案，借它无货可借。
- 若部署确需目录选择流多消费者（如同时多个 picking 交互），0.1.5 不构成参考实现；正确方向是自研：改洞 kind（single→list/keyed/chain）或新增槽，并同步处理 owner/占用方契约与 `useDirectoryFlow` 占用提示（现为 `ctx.slots.entries(hole).length > 0` 布尔化，多消费者需改为计数/键集合）。
- 可作为"自研参考"的 0.1.5 素材仅是 `main` keyed 面板与 `SlotRegistry` 服务模式（架构级，非小补丁）。

---

## 2. 候选 2 独立核查：流式/性能增量（agent-loop / session-persistence / host-apiproxy）

### 2.1 dsh-host-apiproxy：**0.1.5 中该包被删除，无"增量"可借**

- 0.1.1 全局树存在 `dsh-host-apiproxy`；0.1.5 归档树**不存在**（`comm` 对比：仅 0.1.1 有）。
- 其功能在 0.1.5 由以下替代/重写（全部为 0.1.5 新增或重写包）：
  - `dsh-api-gateway`（新）：Typert RPC 网关，`ctx.typertGateway`/`ctx.remote`；共享 `/api/remote.mux` WebSocket（多逻辑流复用一 socket、独立取消）；WS 心跳 Ping/Pong（`websocketHeartbeatIntervalMs` 默认 2s）；重连走 capped jittered exponential backoff；`RemoteJournalStream`（分页、重连追平、gap repair）——`dsh-api-gateway/README.md`。
  - `dsh-client-connection`（重写）：backoff 可配置化（schema）、**network-state 感知**（离线挂起 backoff、网络恢复重启）——`lib/client.js:880-955`（`networkAvailable`、`isRetryInterrupted`、`retryDelay` 打断）。
  - `dsh-api-remotes`（新，0.1.5）/ `dsh-http-proxy`（新，LLM 代理策略）等。
- **与既有补丁的关系**：既有 apiproxy 补丁（mux/FrameQueue/图片变换）正是从这一代架构反向移植的产物。0.1.5 的"同源增量"（heartbeat、journal stream、共享 mux WS）都绑死在 Gateway/Connection/Remotes 的新状态机与新依赖图上，**不是可独立摘取的小 patch**。
- 非增量项：jittered backoff 公式两版**逐字相同**（`cap/2 + Math.random()*(cap/2)`；0.1.1 `client-connection/lib/client.js:61-63` vs 0.1.5 `:907-909`）。
- 图片变换：0.1.1 补丁为 `sessions/prompt-image-transform` waterfall（`dsh-host-apiproxy/lib/index.js:2771`）；0.1.5 树中**不存在**该瀑布（0.1.5 走 dsh-vision-adam 工具化识图）——无同功能上游实现可借。

### 2.2 dsh-agent-loop：增量是"数据模型级"重写，非性能补丁

- 新增模块（0.1.5）：`lib/types/inbox.d.ts`（耐久 Inbox 投影：next-turn/next-step、splice 语义、wire schema）与 `lib/types/assistant-stream.d.ts`（`AssistantStreamAttempt`：单次 attempt 的紧凑流累积 + revision 帧 + replayState + interruptedBlocks）。
- 会话事件词汇变化（关键风险）：
  - 0.1.1：`assistant/chunk`（逐 chunk 持久化）+ `assistant/message`（`dsh-session/lib/types/types.d.ts:264,279`）；`SurfaceEventType = user/message | assistant/message | tool/result`。
  - 0.1.5：写入路径**移除 assistant/chunk**，新增 `assistant/attempt`（紧凑 stream + replay state）（`types.d.ts:323`）；`SurfaceEventType` 增加 `system/message`（`:413`）；`assistant/chunk` 仅存在于格式迁移链 `dsh-session-format-v0-to-v1` / `v1-to-v2`。
  - 0.1.5 步循环：`live.push(chunk)`（内存累积）→ 提交 `assistant/attempt` 或 `assistant/message`（`dsh-agent-loop/lib/index.js:1031-1116`）。
- 等价项（非增量）：并行工具调度核心（有界滚动池、later-call 重分类、取消提交 in-order）两版逻辑相同（0.1.1 `:154-283` vs 0.1.5 `:549-678` 对应）。
- 正确性小改进（局部但依赖新词汇）：`toolsChanged`（schema 变更探测）、`requestSurfaceGeneration`、`prepareRequest` 拆分（`lib/types/agent.d.ts` 0.1.5）——均围绕 0.1.5 的 assistant/attempt/requestHeader 语义，借入 0.1.1 需改写。
- **与 ②b 补丁的关系**：②b 的决策是"子代理非流式（不落 chunk）"；0.1.5 的官方解是"全量流式 + 紧凑流落库"。两者方向不同——借 0.1.5 流式架构等于推翻既有补丁决策，并要求存量会话数据模型迁移。

### 2.3 dsh-session-persistence：重写为瘦契约 + 格式迁移链

- 0.1.1：1396 行 `lib/index.js`，内部 coordinator/preparations/write-behind（`lib/types/coordinator.d.ts`、`preparations.d.ts`、`write-behind.d.ts`）。
- 0.1.5：267 行 `lib/index.js` + 新 `storage-contract.ts`（`assertContiguous` / `materializeAppendBatch` / `validateStoredEvents`：单遍校验、未知事件 fail-closed、`ignorable` 信封跳过）+ `errors.ts`（9 类持久化错误）+ `SessionPersistenceRevision`；依赖**新增** `dsh-session-format-*`（v0→v1→v2→v3 迁移链，0.1.1 无此层）。
- 非增量项：原子写/fsync/temp+rename 两版都有（0.1.1 jsonl `:1096-1150`；0.1.5 jsonl `:128-131,444`）。0.1.5 新增服务级 `flushAll` + `session/flush` 事件（`:378-417`），属稳定性小增量但挂在会话生命周期事件上。
- 注意：0.1.1 的 `SessionEvent.ignorable` 信封**已存在**（`dsh-session/lib/types/types.d.ts:443`），故 storage-contract 的"fail-closed 校验"思想在 0.1.1 有移植基础（自研适配，非直接拷贝）。

### 2.4 候选 2 结论：**无"区别于既有补丁"的可独立借取小增量**

0.1.5 的流式/性能/稳定性增量全部是架构级/数据模型级变更（Typert 传输重写、事件词汇变更、格式迁移链）。唯一值得单独评估的小项：WS 心跳 Ping/Pong 与 Connection 离线挂起重试——但二者分别挂在 0.1.5 独有的 Gateway WS 与 Connection 新状态机上，借取成本≈重写对应 0.1.1 组件，且收益与既有 FrameQueue/mux 补丁高度重叠。

---

## 3. 迁移模式（借源码不升级）风险独立评估

### 3.1 风险清单

1. **peer/API 契约**：0.1.5 包 peer 全部升到 `^0.1.5-rc.2` 且新增 peer（例：`dsh-agent-loop` 新增 `dsh-session-projection`；`dsh-client-ui-workspace` peer 收缩为仅 cordis，但运行时改依赖 `dsh-api-session-controller` / `dsh-api-workspace-controller` / `dsh-api-remotes` / 虚拟 `dsh-client-ui-slots`）。单包借入会与 0.1.1 同级 peer 混装，出现隐式双版本/契约漂移。
2. **依赖树**：0.1.5 新增约 50 个包（`dsh-api-*`、`dsh-session-format-*`、`dsh-sdk-*`、`dsh-hooks-*`、`dsh-http-proxy`、`dsh-deque`、`dsh-util-*` 等）并删除 3 个（`dsh-client-runtime`、`dsh-host-apiproxy`、`dsh-tool-subagent-report`）；依赖是包级图，不是文件级——借一个包的编译产物必然牵出其 peer 面。
3. **与现有补丁/replay 脚本交互**：`deploy-lag/replay-lag-fix.sh` 以 **sha256 字节锚点**校验 5 个补丁包并支持 rollback；任何借取若落在这些包（agent-loop、apiproxy 等），锚点即失效，replay/回滚失去可信度；且 ②b 与 0.1.5 流式方向相反，同文件冲突。
4. **测试回归**：两棵树均为**编译产物**（无 TS 源码、无测试套件可跑）；借取只能黑盒冒烟，回归面是整条 请求→网关→agent-loop→会话持久化→UI 渲染 链路，无白盒闸门。
5. **会话数据格式**：0.1.5 引入 format 版本迁移链（v0→v1→v2→v3）；其读取/校验侧代码对 0.1.1 存量 JSONL 日志的词汇（assistant/chunk 等）依赖迁移模块，0.1.1 无此层——借读取侧会读不了老日志。
6. **后续官方升级更难**：借得越多，0.1.1 基线离上游越远；0.1.6+ 升级时 0.1.1 fork 与上游 diff 将无法合入（现有补丁面小且自包含，尚可逐补丁重放；架构级借取后此路径关闭）。

### 3.2 独立裁决：值得借 / 坚决不借

**坚决不借（0.1.5 中的这些候选）：**
- 传输层整套：`dsh-api-gateway` / `remote.mux` WS / 重写版 `dsh-client-connection` / `dsh-http-proxy` —— 架构级，需 sdk/typert 层，且与既有 mux/FrameQueue 补丁功能重叠。
- `dsh-agent-loop` 的 `inbox.ts`（耐久 Inbox）与 `assistant-stream.ts`（attempt 紧凑流）—— 依赖事件词汇与数据模型变更，直接冲突 ②b 决策。
- `dsh-session-format-*` 迁移链与重写版 `dsh-session-persistence` —— 需格式层 + 存量数据迁移。
- `dsh-client-ui-workspace` / `dsh-client-ui-layout` / renderer 的 0.1.5 重构（`ctx.slots` SlotRegistry、keyed main 面板、hostInfo 钩子）—— 依赖整个 0.1.5 客户端运行时（`dsh-client-runtime` 已删）。
- `dsh-client-ui-slots` —— 不存在可借的物理包。

**值得借（小、自包含、不破契约、可独立验证——均为"思想/局部"而非整包）：**
- WS 心跳 Ping/Pong（若存在空闲中介断连实测痛点）：自研移植到 0.1.1 现有 `dsh-client-connection` 的 websocket-downlink pump，改动局部，可冒烟验证。
- Connection 离线挂起重试语义（`networkAvailable`）：中等成本，需适配 0.1.1 状态机，**可选**。
- storage-contract 的"单遍校验 + 未知事件 fail-closed"思想：0.1.1 已有 `ignorable` 信封，可在 0.1.1 持久层做点状加固（自研适配，不拷贝）。
- agent-loop 的 `toolsChanged` / `requestSurfaceGeneration` 正确性改进：小面，但位于 ②b 同区，需 careful merge + 适配 0.1.1 事件词汇。

**模式总裁决**：借源码不升级这一迁移模式，对"同代小补丁"成立（既有 5 包补丁面小而自包含、可 replay/回滚，是成功案例）；但对本次两个候选**不成立**——候选 1 的最小 patch 面为空（0.1.5 无货），候选 2 的"增量"均为架构级/数据模型级变更，借取成本≈重写依赖图并推翻既有补丁决策。**维持 0.1.1 基线 + 既有补丁 + replay 脚本；槽位多消费者需求走自研（改洞 kind 或新增槽），0.1.5 无现成答案可借。**

---

## 4. 附录：关键证据索引

- 槽位契约：`dsh-client-ui-workspace/lib/types/client/contract/slots.d.ts`（0.1.1 `:49-63`；0.1.5 `:51-65`）
- 注册逻辑：`dsh-client-ui-workspace/lib/client.js`（0.1.1 `:2380-2455`；0.1.5 `:2744-2810`）
- 槽 kinds 渲染：`dsh-client-ui-renderer/lib/client.js`（0.1.1 `:794-806`；0.1.5 `:821-836`）
- layout 槽位：`dsh-client-ui-layout/lib/types/client/index.d.ts`（0.1.5 新增 `main` keyed `:49-53`）
- 0.1.5 网关：`dsh-api-gateway/README.md`（mux WS、heartbeat、journal stream）；`dsh-client-connection/lib/client.js:880-955`（network-state 重试）；backoff 两版 `:61-63` vs `:907-909`
- agent-loop 新模块：`dsh-agent-loop/lib/types/inbox.d.ts`、`assistant-stream.d.ts`；步循环 `lib/index.js:1031-1116`
- 事件词汇：`dsh-session/lib/types/types.d.ts`（0.1.1 `:264,279,367`；0.1.5 `:309,323,413`）
- 持久化：`dsh-session-persistence/lib/types/storage-contract.d.ts`（0.1.5）；jsonl 原子写两版 `:1096-1150` / `:128-131`
- 既有补丁面：`.workspace/baseline-011/x/` vs 全局树 diff（agent-loop ②b、host-apiproxy mux/FrameQueue/图片变换、subagent materialize 等）；重放 `.workspace/deploy-lag/replay-lag-fix.sh`
