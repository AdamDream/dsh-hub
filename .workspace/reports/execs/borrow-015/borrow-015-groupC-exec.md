# borrow-015 组 C（session/agent-loop）修订执行复核一体档 — 执行报告

- 档位：修订执行复核一体（subagent，adam/deepseek-v4-flash）
- 日期：2026-09-15
- 依据：`.workspace/upstream-015-diff.md` §6.2/§6.4（S6/S7/S8/S9 + P3 高价值子集）；G1/G3/G4 组深挖 notes
- 素材（ARCH 0.1.5）：`~/.dsh/profiles-archive/web2-20260915-105429/node_modules/@deepseek-ai/`
- 目标（GLOB 0.1.1）：`~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`
- 范围裁决：用户裁决 P1/P2 全采纳 + P3 高价值子集（本组为 session/agent-loop 组）；**未改动** `dsh-llm-deepseek` / `dsh-llm-pi-ai`（image-tokens 档在跑）；**未改动** `replay-lag-fix.sh`（主代理统一集成）

## 0. 交付物总览

| 项 | 目标包 | diff 文件（`.workspace/deploy-015/patches/`） | deploy-015 完整副本 | 说明 |
|---|---|---|---|---|
| S6 | dsh-session | `dsh-session.tool-result-isError.patch` | `.workspace/deploy-015/dsh-session/` | tool/result error⇒isError 校验（仅借 tool/result 段，勿借 header/assistant） |
| S7 | dsh-session-projection | `dsh-session-projection.restore-contiguity.patch` | `.workspace/deploy-015/dsh-session-projection/` | restore 缺失-seq fail-loud |
| S8 | dsh-agent-loop | `dsh-agent-loop.reasoningEffort.patch` | `.workspace/deploy-015/dsh-agent-loop/` | AgentOptions.reasoningEffort 优先（避 ②b isSubagent 区） |
| S9 | dsh-client-connection | `dsh-client-connection.ws-downlink-heartbeat-serial.patch` | `.workspace/deploy-015/dsh-client-connection/` | WS downlink 心跳 + 写串行化（仅 index.js） |
| P3-C3 | dsh-session-persistence | `dsh-session-persistence.not-found-error.patch` | `.workspace/deploy-015/dsh-session-persistence/` | SessionPersistenceNotFoundError |
| P3-C3（联动） | dsh-agent-loop | 并入 `dsh-agent-loop.reasoningEffort.patch` | 同上 | restoreOrCreateConfigured instanceof 判错（与 S8 同包同 diff） |
| P3-G3C07 | dsh-llm-retry | `dsh-llm-retry.projection.patch` | `.workspace/deploy-015/dsh-llm-retry/` | 重试计数投影化（O(n)→O(1)） |
| P3-G3C05 | dsh-agent | `dsh-agent.model-switch-notice.patch` | `.workspace/deploy-015/dsh-agent/` | 模型切换持久 notice |

**约束核对**：
- ✅ 全部产物只在 `.workspace/deploy-015/` 与报告文件；未改 `~/.dsh`、未改 GLOB 部署树（deploy 由主代理执行）
- ✅ 未用 sandbox_permissions
- ✅ 每项 unified diff 均经 `patch -p1 --dry-run` 于干净副本验证，并做"完整应用→与 deploy-015 副本逐字节比对"双重验证
- ✅ 每个改动 JS 文件均过 `node --check`

---

## 1. S6 — dsh-session tool/result 错误一致性校验（P2）

- **目标包**：`dsh-session`（GLOB main 入口 `lib/index.js` 为 bundle；`lib/types/*.js` 为源模块，均随包发布）
- **移植内容**（来自 ARCH `lib/types/surface.js` `validateSessionEventData`，**仅取 tool/result 段**）：
  - 新增 `isRecord` + `validateSessionEventData`：`tool/result` 带 `error` 时强制 `message.content[0].isError === true`，否则早失败抛错
  - **未借同函数另两条**（G1-C2 明确）：`request/header` 必须省略 `header.system`（0.1.1 canonicalHeader/请求仍携带 system）、`assistant/message` 禁 `sourceEventSeqs`（0.1.1 ②b 子代理路径依赖空数组放行）
- **挂载点**（与 ARCH 对齐 3 处）：
  - `adoptSessionEvent`（GLOB bundle:1182 / source:96）
  - seed 校验 `assertSessionEventEnvelope` 信封检查后（GLOB bundle:1235 / source:166）
  - `Session.append` 在 `surfaceManager.validateNext` 之前（GLOB bundle:1490 / source:512）
- **bundle/source 双份**：GLOB `lib/index.js`（bundle，运行入口）与 `lib/types/surface.js`+`lib/types/index.js`（源模块）都加了；`lib/types/surface.d.ts` 加声明
- **适配点**：bundle 内已有 chunk-rows 区域的 `isRecord`（仅 `typeof object && !null`），与 surface 版（另要求 `!Array.isArray`）语义不同——bundle 内 surface 段改名为 `isPayloadRecord` 避冲突；源模块文件各自独立无冲突，保留 `isRecord` 名
- **验证**：
  - `node --check` 3 文件通过
  - 功能：`adoptSessionEvent` 对 `{error, message.content[0].isError!==true}` 抛 "error requires message content[0].isError === true"；error+isError 通过；非 tool/result 事件透传
  - patch dry-run + 完整应用比对通过
- **锚点**：bundle `lib/index.js` 追加于 `deriveEventMessage` 后（原 :287 后）；挂载点见上行行号
- **备份/回滚**：diff 4 文件（bundle + 2 源 + 1 d.ts），`patch -R` 一键回退；无配置/数据面影响

## 2. S7 — dsh-session-projection restore contiguity 校验（P2）

- **目标包**：`dsh-session-projection`（bundle `lib/index.js` + 源 `lib/types/index.js`）
- **问题**：GLOB restore 用 `for (const event of events) if (event.seq > from) apply`，日志空洞静默跳过 → 投影状态错且不报错
- **移植**：ARCH restore（:318-326）同款缺失-seq 校验：
  ```js
  const startIndex = from - baseSeq + 1;
  for (let index = startIndex; index < events.length; index++) {
      const event = events[index];
      const expectedSeq = baseSeq + index;
      if (event === undefined || event.seq !== expectedSeq)
          throw new Error(`session projection "..." cannot restore across missing seq ...`);
      state = def.apply(state, event);
  }
  ```
- **兼容性确认**（G1-C7 风险项）：GLOB 唯一 restore 调用方 `dsh-session-projection-cache/lib/index.js:191-194` 用 `try/catch` 包 restore，抛错即降级全读 seq0（coldSnapshot 的既有 catch），行为兼容
- **验证**：
  - 功能：缺失 seq 1 时抛 "cannot restore across missing seq 1"；连续日志正常折叠（val=3）；确认原 GLOB 对 `[{seq:0},{seq:2}]` 静默不抛（行为差异成立）
  - `node --check` bundle/source 通过；patch 验证通过
- **锚点**：`restore(checkpoint, events, baseSeq)` 内 `const from = usable ? row.seq : baseSeq - 1;` 之后
- **备份/回滚**：2 文件 diff，`patch -R` 回退；restore 抛错仅触发 projcache 降级路径，无副作用

## 3. S8 — agent-loop AgentOptions.reasoningEffort（P2）

- **目标包**：`dsh-agent-loop`（`lib/index.js` 为唯一运行文件，无独立源模块）
- **移植**（ARCH :1135-1136 + Config schema :1497）：
  - `buildRequest`：原单行持久化 header 来源 → 拆两行，`const reasoningEffort = this.options.reasoningEffort ?? persistedReasoningEffort;`（options 级覆盖持久化 header 旧值）
  - Config schema：agents 数组项加 `reasoningEffort: z.string().min(1)`
- **②b 约束（重点核对）**：
  - isSubagent 两行在 GLOB :612（`const isSubagent = ...`）与 :622（`if (!isSubagent) chunkSeqs.push(...)`），**未触碰**
  - 生成的 `dsh-agent-loop.reasoningEffort.patch` 全文 **grep isSubagent = 0 命中**；diff 仅 2 个 hunk（:702 解析行 + :992 Config schema），行号区间与 ②b 区（:605-630）无交集
  - 复核：应用后 `sed -n '612p;622p'` 与 GLOB 原文件逐字节一致
- **验证**：`node --check` 通过；patch dry-run + 应用比对通过
- **锚点**：`buildRequest` 内 `persistedHeader?.config` 解析处（原 GLOB:702）；`static Config` agents schema
- **备份/回滚**：1 文件 2 hunk，`patch -R` 回退；不涉及 ②b

## 4. S9 — client-connection WS downlink 心跳 + 写串行化（P2）

- **目标包**：`dsh-client-connection`（**仅 `lib/index.js`**；`lib/client.js` 是组 A（S2 ConnectionController 恢复）在跑文件，本组未碰——已比对 deploy-015 副本 `lib/client.js` 与 GLOB 逐字节一致）
- **移植**（参考 ARCH api-gateway :251-267 心跳 / :346-365 写串行化）：
  - 心跳：`MAX_MISSED_HEARTBEATS = 2` + `DEFAULT_WEBSOCKET_HEARTBEAT_INTERVAL_MS = 2e3`；`WebSocketDownlinks` 增 `missedHeartbeats`（WeakMap）与 `heartbeatTimer`；`upgrade()` 时注册 pong 监听（重置计数）+ `startHeartbeat()`（unref 定时器，missed≥2 时 setImmediate 后 terminate 半死 socket）；`close()` 先 clearInterval
  - 写串行化：模块级 `downlinkWrites`（WeakMap<socket, promise 链>），`send(socket, frame)` 改为 `(writes.then(...))` 链式入队 + 失败吞掉接续，防帧交错/提供背压；JSON.stringify 失败早 reject
  - **transport 保持 0.1.1 双 SSE 流**（events.mux + events.host 泵 apiproxy SSE 流不变；0.1.5 mux 协议不借）
- **验证**：`node --check` 通过；patch dry-run 通过；patch 全文仅 1 文件（lib/index.js）
- **锚点**：`//#region lib/types/websocket-downlink.js` 段（原 :334-466）：send 函数 + `WebSocketDownlinks` 类（upgrade/close/pump）
- **备份/回滚**：1 文件，`patch -R` 回退；新增定时器 unref、不影响协议/认证

## 5. P3-C3 — SessionPersistenceNotFoundError + agent-loop restore 判错

- **目标包**：`dsh-session-persistence`（bundle `lib/index.js` + `lib/types/coordinator.d.ts` + `lib/types/index.d.ts`）与 `dsh-agent-loop`（联动 1 处）
- **移植**：
  - dsh-session-persistence：新增 `SessionPersistenceNotFoundError`（sessionId 字段 + name），导出；三处"session not found"抛错点（readFromCore loadStoredFrom 分支、readStoredPrefix、prepareCore）改抛新类型；`loadLiveSnapshot` 的 `events.length===0`（live 空会话语义，非"未找到"）保持原样
  - dsh-agent-loop `restoreOrCreateConfigured`：`(await persistence.list()).some(header => header.id===sessionId)` → `!(error instanceof SessionPersistenceNotFoundError)`，消除 list() 竞态/误吞
- **验证**：`new SessionPersistenceNotFoundError('abc')` → name/sessionId/message 正确、instanceof Error；3 个抛错点 grep 确认；`node --check` 通过；patch 验证通过
- **锚点**：persistence bundle 错误类区（原 :470 后）、:957/:985/:998 抛错点；agent-loop `restoreOrCreateConfigured` catch 块
- **备份/回滚**：persistence 3 文件 + agent-loop 1 处，`patch -R` 回退

## 6. P3-G3C07 — dsh-llm-retry 投影化

- **目标包**：`dsh-llm-retry`（bundle `lib/index.js` + 源 `lib/types/index.js` + `lib/types/index.d.ts`）
- **背景标注**：G3-C07 审计原判"不借（价值仅 O(1) 查询，重试行为无改善）"；**用户 P3 高价值子集裁决采纳**，本档执行移植并保留此标注
- **移植**（ARCH :22/:65-67/:82-107/:162）：
  - `inject`：`["agents"]` → `["agents","sessionProjections"]`
  - 新增 `retryStateKey(provider, policyKey)` + `llmRetryStateSchema`（zod record）
  - `apply()` 内 `ctx.sessionProjections.register({key:'llmRetry', stateVersion:1, ...})`：`step/start`/`turn/end` 清空，`llm/retry` 写当前 retry/retryId，同值幂等（返回同引用）
  - `recover()`：`agent.session.events.findLast(...)` O(n) 扫描 → `ctx.sessionProjections.stateOf(agent.session,'llmRetry')[retryStateKey(...)]` O(1) 读取
  - `lib/types/index.d.ts`：增 `declare module '@deepseek-ai/dsh-session-projection/types'` 的 `SessionProjectionStateMap.llmRetry` 增强（与 ARCH 同款；GLOB 该接口为 merge-extensible）
- **依赖标注**：新增 `import { z as zod } from 'zod'`；GLOB 部署树 zod 已 hoisted（dsh root node_modules/zod@4.6.2，dsh-session-projection 依赖 zod ^4.4.3），**无需改 package.json/装依赖**（本组未动任何 package.json，与其它组惯例一致）
- **行为差异标注**（G3-C07 已述）：0.1.1 findLast 匹配同 turn/step/provider/policyKey；0.1.5 投影按 provider+policyKey 键、step/start 与 turn/end 清空——语义等价、实现路径不同
- **验证**：投影注册/幂等/清空/stateSchema parse 功能测试通过；模块加载（inject=[agents, sessionProjections]）通过；`node --check` 通过；patch 验证通过
- **锚点**：`apply(ctx, config, internals)` 开头 register；`recover()` policyKey 解析处
- **备份/回滚**：3 文件，`patch -R` 回退

## 7. P3-G3C05 — dsh-agent 模型切换持久 notice

- **目标包**：`dsh-agent`（bundle `lib/index.js` + 源 `lib/types/model-selection.js` + `lib/types/model-selection.d.ts`）
- **移植**（ARCH libjs:383-394 报告位置 = `installModelSelection` 增 `agent/pre-step` 监听）：
  - 新增 `sameRoute` / `routeLabel` / `modelSwitchNotice`（createUserMessage + boundContextSummary，均 GLOB dsh-llm 已有导出）
  - `installModelSelection` 增 `disposeNotice`：`agent/pre-step`（prepend）内，决策非 reject 且非空跳过场景下，比较 `selection.assembled` 与 `agent.session.requestHeader()?.config`，provider/model 变化则向下一请求追加 user-role notice；effort-only 变化不加
  - disposer 三合一（disposeAssembly/disposeRequest/disposeNotice）
  - 依赖项确认：GLOB agent-loop `preStep` 已发 `agent/pre-step` waterfall（:501），payload 含 agent/messages/turn/step/signal；`agent.session.requestHeader()` GLOB dsh-session 已有
- **验证**：mock ctx 功能测试——pre-step prepend 注册、模型切换追加 notice（文本 "[model changed: ...]"）、同 route 不追加；`node --check` 通过；patch 验证通过
- **锚点**：`installModelSelection` 的 `disposeRequest` 之后新增 `disposeNotice`；`//#region lib/types/model-selection.js` 段头
- **备份/回滚**：3 文件，`patch -R` 回退；notice 为追加 user 消息，失败前不持久化（header 落库前重复追加语义与 ARCH 一致）

---

## 8. 自复核（同档）

### 8.1 逐项自裁决：**通过**

| 复核点 | 结果 |
|---|---|
| S8 与 ②b 同文件不同区 | ✅ diff 全文 0 个 isSubagent 命中；hunk 仅 :702/:992；应用后 :612/:622 与 GLOB 逐字节一致 |
| S9 只改 index.js 不碰 client.js | ✅ patch 仅 lib/index.js；deploy-015 副本 client.js 与 GLOB 逐字节一致（组 A 在跑文件未动） |
| P3 高价值子集 | ✅ 三项全做（SessionPersistenceNotFoundError / llm-retry 投影化 / agent 模型切换 notice）；**条件项不做并标注**：gzip（G4-WEB-1 需新依赖）、win32 条件项（atomic-write 按 P0 落地、验证以 win32 为条件）不在本组 |
| 不碰 llm-deepseek / llm-pi-ai | ✅ 本组 7 包无这两包（S23/S24/pi-ai 断言顺延排队） |
| 不改 replay-lag-fix.sh | ✅ 未触碰 |
| 不改 ~/.dsh | ✅ 只读 ARCH/GLOB，产物全部在 .workspace/deploy-015/ |
| 全部 patch 可 `patch -p1` 应用 | ✅ 7 patch 逐个 dry-run + 完整应用→与 deploy-015 副本逐字节比对，全部 IDENTICAL |
| 全部 node --check | ✅ 涉及 JS 文件全过 |

### 8.2 问题清单（上报，非阻塞）

1. **dsh-llm-retry 引入 zod 直接 import**：GLOB `dsh-llm-retry/package.json` 未声明 zod（ARCH 声明 ^4.4.3）。运行时经 hoisted zod（dsh root 4.6.2，dsh-session-projection 依赖 zod）可解析，**不需装依赖**；但若主代理要求声明完备，可在 package.json deps 加 `"zod": "^4.4.3"`（本组按"不动 package.json"惯例未加）。
2. **S6 bundle 内 `isPayloadRecord` 命名**：因 bundle 内 chunk-rows 已有同名 `isRecord`（语义不同），surface 段在 bundle 内用 `isPayloadRecord`，源模块仍用 ARCH 原 `isRecord`——两处命名不一致但各自文件内自洽；如需与 ARCH 逐字一致，可改为把 surface 段整体换名（不推荐，徒增 diff）。
3. **S7 行为面**：restore 现对空洞 fail-loud；确认 GLOB 全树唯一调用方 projcache 的 catch 降级路径已兼容（见 §2）；若未来新增 restore 调用方需同样容错。
4. **S9 心跳间隔为常量 2000ms**：ARCH 为 Config `websocketHeartbeatIntervalMs` 可配；本组按审计最小面（G4-WS-1 参考 ARCH 定时器）用模块常量，未加 Config 项——如要可配置化需另议。
5. **P3-C3 `loadLiveSnapshot` 的 `events.length===0` 抛错未改类型**：语义是"live 空会话"而非"持久化未找到"，保持原样；如主代理希望该路径也归 NotFound 需确认语义。
6. **审计与用户裁决差异已标注**：llm-retry 投影化（G3-C07 审计"不借"）与 agent 模型切换 notice（G3-C05 审计"可选小借"）均按用户 P3 高价值子集裁决执行。

### 8.3 集成要点（给主代理）

- 7 个 patch 文件：`.workspace/deploy-015/patches/`（`dsh-agent-loop.reasoningEffort.patch` 同时含 S8 + P3-C3 联动 1 处，应用一次即可）
- 完整应用后副本：`.workspace/deploy-015/<pkg>/`（7 包，lib 与 GLOB 原树逐字节比对过，仅改动目标文件）
- 部署方式：主代理对 GLOB 部署树 `patch -p1`（于各包目录）应用 7 patch，`node --check` 复验，重启后验收
- 依赖：llm-retry 需 zod 可解析（部署树已满足）；dsh-agent-loop 新增 import `@deepseek-ai/dsh-session-persistence`（同树已存在）
- 与其它组边界：S2（client.js，组 A）、S23/S24/pi-ai（image-tokens 档）未碰；llm-deepseek/llm-pi-ai 未碰
