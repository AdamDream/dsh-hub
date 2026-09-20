# 审计报告：0.1.5「goal 持续/阻塞式发送响应到会话框（round 循环发送响应）」修复应用缺口

- 日期：2026-09-16
- 角色：审计阶段子代理（只读，机制级取证）
- 任务：审计「0.1.5 的 goal 持续/阻塞式发送响应到会话框（round 循环发送响应）的修复」是否已应用到本部署
- 素材：
  - ARCH（0.1.5-rc.2）：`~/.dsh/profiles-archive/web2-20260915-105429/node_modules/@deepseek-ai/`
  - GLOB（live，0.1.1-rc.2 + 已应用补丁）：`~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`
  - 借鉴批次：`.workspace/deploy-015/patches/`、`upstream-015-diff.md`、`borrow-015-exec.md`、`borrow-015-groupA/B/C-exec.md`、`upstream-015-diff/groups/G5/G6`
- 约束：全程只读（含归档树），未使用 sandbox_permissions

---

## 0. 结论摘要（TL;DR）

用户所指的修复确实存在于 0.1.5 的 **dsh-goal-round-driver**，且**两处都未应用**：

1. **P0-A `goal/changed` 宿主 pause → 中止运行中 round**（0.1.5 `dsh-goal-round-driver/lib/index.js:234-238`）：
   宿主（用户）暂停 goal 时立即 `agent.cancel({kind:"user"},{keepInbox:true})` 中止正在运行的 round 轮次，**阻止本轮响应继续写入会话框**。
   —— 本部署未应用（live 仍是 0.1.1 形态：`goal/changed` 只置 needsCheckpoint + requestDrive）。
   —— **结论：可移植（P0）**。既有 G6 审计判定"0.1.1 无 currentInitiator/keepInbox → 不可借"**为事实错误**：两个 API 在 0.1.1 均存在（见 §4.1）。

2. **P0-B 每轮 `startsRequestSeries: true`**（0.1.5 同文件 `:339-342`）：
   被接纳的 goal round 开启**独立 request series**，Chat 在 goal 消息前渲染自包含的 request header（会话框帧写入语义）。
   —— 本部署未应用。
   —— **结论：驱动侧 3 行可写，但在 0.1.1 为惰性 no-op**（消费方 machinery——agent-loop 的 `step(decision)`/`requestSurfaceGeneration`/`systemPrompt.project(startsSeries)`/`request/header startsSeries`、client 的 request-prompt 渲染——0.1.1 全部缺失）；完整移植 = B10 架构级（勿借）。**不建议单独借驱动侧行**。

其余目标域增量（dsh-goal 投影 v6 + activation-changed、dsh-tool-goal turnBoundary、dsh-command-goal attachments 改名、agent-loop/session 流式重写）均为架构级勿借项（B1/B10），与用户所指无关。

**另发现 1 个独立可移植的小修复**：`dsh-tool-goal` 新增 `GOAL_TOOL_RESUME_PAUSED` 守卫（模型不得 resume 暂停中的 goal，须用户 resume，`dsh-tool-goal/lib/index.js:351-352`）——0.1.1 可借（P1，~4 行）。

---

## 1. 0.1.5 目标域改动全景（0.1.5 vs 0.1.1，逐包）

| 包 | 改动（0.1.5 行号） | 差异本质 | 是否「goal 发送/阻塞/帧写入」相关 |
|---|---|---|---|
| **dsh-goal-round-driver** | `lib/index.js:222`（attempt 归属守卫） | 已应用（1 行补丁） | 否（归因守卫） |
| **dsh-goal-round-driver** | `lib/index.js:234-238`（goal/changed 加 `change` 参数 + pause→cancel） | **宿主 pause 中止运行中 round** | **是（P0-A，阻塞行为）** |
| **dsh-goal-round-driver** | `lib/index.js:339-342`（pre-step decision 返回 `startsRequestSeries: true`） | **每轮开启独立 request series → Chat 自包含 header** | **是（P0-B，会话框帧写入）** |
| **dsh-goal-round-driver** | `lib/invariant.js:59,67`（`session.events`→`snapshotEvents()`） | 0.1.5 会话模型 API | 否（B10 勿借） |
| **dsh-goal** | `lib/index.js` 全量：goalProjectionStateSchema v6（seenGoalIds/failure）、strict fold、`session/event` 监听 activation、`goal/activation-changed` 事件、SessionSeq | sessionProjections 化（0.1.1 seam 可选 → 0.1.5 强制） | 否（B1 勿借，架构） |
| **dsh-tool-goal** | `lib/index.js`：openTurn→openTurnEvents（turnBoundary 投影）、**`:351-352` GOAL_TOOL_RESUME_PAUSED 守卫**、getSectionOrder | 大部分 B1 勿借；**resume 守卫独立可借（P1）** | 守卫=goal 权限增量 |
| **dsh-command-goal** | `lib/index.js:89-99,176`（images→attachments 改名） | 破坏性 schema 改名 | 否（勿借，G6 已定） |
| **dsh-agent** | `lib/index.js`：Inbox 类移出至 agent-loop、register() owner 语义、initiator 注释 | 结构迁移 | 否 |
| **dsh-agent-loop** | `lib/index.js` 全量（1322→1936 行）：assistant/chunk→assistant/attempt+AssistantStreamAttempt、`step(decision)` 消费 `decision.startsRequestSeries`（`:1018`）、`systemPrompt.project(startsSeries)`（`:1019-1023`）、`buildRequest(startsRequestSeries)`→`request/header startsSeries`（`:1166-1191`）、requestSurfaceGeneration | 流式/attempt 架构重写（②b 方向相反） | P0-B 的**消费方 machinery**（B10 勿借） |
| **dsh-session** | `lib/index.js` 全量：seq-ranges、eventAt/SessionSeq/snapshotEvents、assistant/attempt 事件词汇（known-event-types `:27`） | 会话模型重写 | 否（B10 勿借） |

**结论**：0.1.5 与「goal 发送响应/阻塞/会话框帧写入/round 循环」直接相关的改动**只有 dsh-goal-round-driver 的两个 hunk**（P0-A/P0-B）；round 计数、轮询语义两版一致（`applyGoalEvent` 对 `user/message` 的 round 校验逐字相同，见 `dsh-goal/lib/index.js:265-278`）。

---

## 2. 本部署已应用面（deploy-015）

| 项 | 状态 | 证据 |
|---|---|---|
| dsh-goal-round-driver attempt-attribution（1 行） | ✅ 已应用 | live `:222` 含 `attempt.goalId === goal.id && attempt.revision === goal.revision`；`known-sha256-015.txt` 含 `dsh-goal-round-driver/lib/index.js` 锚点 |
| 其余 11 个借码补丁 | ✅ 已应用 | live 树抽查（tool-web notice×3 等） |
| **P0-A pause→cancel** | ❌ **未应用** | live `:234-238` 仍为 0.1.1 形态：`ctx.on("goal/changed", ({ agent }) => { state.needsCheckpoint = true; requestDrive(state); })`，无 `change` 参数、无 cancel |
| **P0-B startsRequestSeries** | ❌ **未应用** | live `:335-342` 仍为 `return decision;`，无 `startsRequestSeries` |
| dsh-tool-goal resume 守卫 | ❌ 未应用 | live `:342-346` 无 `GOAL_TOOL_RESUME_PAUSED` 检查 |
| groupA/B/C 批次 | — | 无 goal 域条目（三份 exec 报告 grep 'goal' 为空） |

---

## 3. 未应用项机制与影响

### 3.1 P0-A：宿主 pause 中止运行中 round（阻塞行为修复）

**0.1.5 机制**（`dsh-goal-round-driver/lib/index.js:234-238`）：

```js
ctx.on("goal/changed", ({ agent, change }) => {
    const state = stateFor(agent);
    state.needsCheckpoint = true;
    if (change.operation === "pause" && agent.status === "running" && ctx.agents.currentInitiator() !== agent)
        agent.cancel({ kind: "user" }, { keepInbox: true });
    requestDrive(state);
});
```

语义（0.1.5 README 原文）：*"a host-initiated pause also aborts the turn already running, while a model-initiated pause inside its own turn finishes normally"*——宿主 pause 立即中止在飞轮次（keepInbox 保留已排队输入），模型自轮内 pause 正常结束。

**未应用影响（本部署现状）**：用户 pause goal 时若恰逢 round 正在运行，`goal/changed` 不取消在飞轮次 → 该轮**继续跑完并持续把响应写入会话框**，直到 turn/end 后 idle 才被驱动器的 phase 检查拦住。这正是用户描述的「goal 持续阻塞式发送响应到会话框」。

**最小移植面**：`dsh-goal-round-driver/lib/index.js` 2 行改动（`:234` 加 `change` 参数、`:237` 加一行 if）。依赖符号在 0.1.1 全部存在（见 §4.1 验证矩阵）。

### 3.2 P0-B：每轮独立 request series（会话框帧写入修复）

**0.1.5 机制**：
- 驱动侧（`:339-342`）：pre-step 决策返回 `{ ...decision, startsRequestSeries: true }`。
- 消费侧（agent-loop `:1018-1030`）：`startsRequestSeries = firstAttempt && decision.startsRequestSeries === true` → `systemPrompt.project(renderedPrompt, { inHistory, startsSeries: ... })` + `buildRequest(..., startsRequestSeries, ...)` → `request/header` 追加 `reason: "series"` + `startsSeries: true`（`:1185-1189`）。
- 客户端（`dsh-client-ui-chat/lib/client.js:6172`）：`showsPrompt: ... || match.event.data.startsSeries === true ...` → 每轮渲染自包含 request header。

语义（0.1.5 README 原文）：*"An accepted round starts a distinct request series, so Chat renders its self-contained request header before the goal message."*

**未应用影响（本部署现状）**：0.1.1 agent-loop `step(decision.assembly)` 只取 `.assembly`，不读任何 decision 附加字段；无 `requestSurfaceGeneration`、无 `systemPrompt.project(startsSeries)`、`buildRequest` 只在 header 变化时追加 `request/header`（无 startsSeries 概念）；0.1.1 conversation client **完全没有 request-prompt 渲染**（grep `request/header|request-prompt` = 0）。因此**驱动侧单独加 `startsRequestSeries` 是惰性 no-op**（字段被丢弃），完整语义必须连同 agent-loop 流式 machinery + 客户端渲染一起移植 = B10 架构级，与本地 ②b（subagent 非流式）方向相反 → 勿借。

### 3.3 P1：GOAL_TOOL_RESUME_PAUSED（goal 权限增量，独立可借）

0.1.5 `dsh-tool-goal/lib/index.js:351-352`：

```js
const current = ctx.goals.get(execution.agent);
if (args.action === "resume" && current?.id === ref.id && current.revision === ref.revision && current.phase === "paused")
    throw new HarnessError("the model cannot resume a paused goal; the user must resume it", "GOAL_TOOL_RESUME_PAUSED");
```

0.1.1 对应分支（`dsh-tool-goal/lib/index.js:342-346`）无此检查，且 0.1.1 已有 `ctx.goals.get` + goal view `phase`（含 "paused"）。**可独立移植，~4 行，零新依赖**，不依赖 turnBoundary 投影（该投影属 B1 勿借部分，可只借守卫）。

---

## 4. 既有审计结论修正

### 4.1 G6「pause→cancel 依赖 0.1.1 缺失 API，不可独立借」——**事实错误**

`upstream-015-diff/groups/G6-platform.md:63,125,153` 判定 P0-A 不可借，理由为「依赖 0.1.1 缺失的 `ctx.agents.currentInitiator()` 与 `agent.cancel(…,{keepInbox:true})`」。**实测 0.1.1 三者全部存在**：

| 依赖符号 | 0.1.1 位置 | 证据 |
|---|---|---|
| `agent.status` getter（"running"/"idle"） | `dsh-agent-loop/lib/index.js:381-384` | `get status() { return this.phase.kind === "idle" || ... ? "idle" : "running"; }` |
| `agent.cancel(cause, options)` 支持 `keepInbox` | `dsh-agent-loop/lib/index.js:406-412` | `cancel(cause, options = {}) { if (!options.keepInbox) { this.inbox.clear(); ... } if (this.phase.kind !== "idle") this.phase.abort.abort(cause); }` |
| `ctx.agents.currentInitiator()` | `dsh-agent/lib/index.js:503-506` | `currentInitiator() { this.assertInitiatorsReadable(); return this.initiators.getStore(); }` |
| `goal/changed` 载荷含 `change.operation` | `dsh-goal/lib/index.js:791-796` | `const notification = { operation: change.operation, ref: {...ref}, ...goal === void 0 ? {} : { goal } }; agentEvents(...).emit("goal/changed", { change: notification })` |

⇒ **P0-A 可从「不可借」修正为「P0 可借，最小面 2 行」**。语义逐字一致（cancel 的 keepInbox 分支与 0.1.5 用法完全匹配）。

### 4.2 P0-B 的不可借结论**成立**，但理由需修正

不是「缺 API」，而是**缺消费方 machinery**：0.1.1 agent-loop 的 `step()` 不消费 `decision.startsRequestSeries`（只收 `.assembly`），且 0.1.1 无 requestSurfaceGeneration / systemPrompt.project(startsSeries) / request/header startsSeries / client request-prompt 渲染（grep 为 0）。完整移植 = B10 架构级（流式重写，与 ②b 方向相反）。**维持勿借，附正确理由**。

---

## 5. 应用缺口清单（按严重度）

| 级别 | 项 | 包/位置 | 最小移植面 | 风险/冲突 |
|---|---|---|---|---|
| **P0** | 宿主 pause 中止运行中 round（阻塞行为修复） | `dsh-goal-round-driver/lib/index.js:234-238` | **2 行**（加 `change` 参数 + 1 行 if） | 低。与已应用 attempt-attribution（`:222`）不同行、不同语义，零冲突；依赖符号 0.1.1 全在（§4.1）；行为变化=用户 pause 立即停响应（预期修复） |
| **P0（完整）/ P2（驱动侧）** | 每轮 `startsRequestSeries: true`（会话框帧写入） | `dsh-goal-round-driver/lib/index.js:339-342` | 驱动侧 3 行（惰性 no-op）；**完整 = agent-loop machinery + 客户端渲染（B10 架构级，勿借）** | 高。不建议单独借驱动侧行（误导）；完整移植与 ②b 非流式方向相反、跨 3 包（agent-loop/session/client） |
| **P1** | `GOAL_TOOL_RESUME_PAUSED` 守卫（模型不得 resume 暂停 goal） | `dsh-tool-goal/lib/index.js:351-352` | ~4 行，零新依赖，不涉 turnBoundary 投影 | 低。0.1.1 `ctx.goals.get` + phase "paused" 齐备；属 goal 权限增量（非用户所指，但同域值得一并补） |
| P2（勿借） | dsh-goal 投影 v6 + activation-changed | dsh-goal 全量 | —（B1 架构） | 0.1.1 seam 可选 vs 0.1.5 强制，改变插件组合契约 |
| P2（勿借） | dsh-tool-goal turnBoundary 投影 | dsh-tool-goal 大部分 | —（B1 架构） | 同上 |
| P2（勿借） | dsh-command-goal images→attachments 改名 | dsh-command-goal | —（破坏性改名） | 0.1.1 侧按 images 键的代码/补丁失配 |
| P2（勿借） | agent-loop/session 流式重写（attempt 流、seq-ranges） | dsh-agent-loop、dsh-session | —（B10 架构） | 与本地 ②b 非流式补丁方向相反 |
| P2（勿借） | goal-round-driver invariant.js snapshotEvents | `dsh-goal-round-driver/lib/invariant.js:59,67` | —（依赖 0.1.5 session API） | 0.1.1 无 snapshotEvents |

---

## 6. 补充审计（2026-09-16 聚焦指令）：goal 触发 vs subagent 等待无互斥 —— 0.1.5 无专门修复

### 6.1 用户聚焦现象

> goal 激活时，每次根据目标派发完 subagent 等待结果期间，主会话停止，但 goal 机制仍会注入 goal 触发主会话，让其没意义地检查 subagent 进度——空转轮询 + 会话框刷屏。

### 6.2 机制取证：当前（0.1.1 live）行为链

goal-round-driver 的注入触发条件（live `dsh-goal-round-driver/lib/index.js:79-81`，0.1.5 逐字一致）：

```js
function readyToDrive(state) {
    return ctx.fiber.state === 2 && !state.stopping && ctx.agents.get(state.agent.id) === state.agent && state.agent.status === "idle" && !state.competingQueued;
}
```

行为链：
1. 主 agent 派发后台 subagent（`dsh-tool-subagent` background/continuable，立即返回 subagentId）→ 主 agent turn 结束 → `agent.status === "idle"`。
2. goal 仍 active+armed → `agent/status idle` 触发 `requestDrive` → `drive()` 通过 `readyToDrive`（idle + 无 competing）→ `agent.followup(goalRoundPrompt)` 注入下一轮 goal round。
3. 主 agent 被唤醒跑一轮"检查 subagent 进度"（无新结果）→ 空转；turn 结束 → idle → 再次注入 → **轮询空转 + 会话框刷屏**，直到 subagent settle。

**抑制机制缺失点**：`competingQueued` 只在 `agent/inbox/inserted` 有 nextTurn 消息时置位（`:239-246`）——subagent 等待期间 parent 的 inbox 是空的（subagent 在独立会话运行，后台派发不占 parent inbox；settle 后才经 `notifySettlement` → `parent.followup/steer` 投 notice 进 parent inbox，但那已是完成后）。**等待期间无任何信号把 agent 从"可注入 goal"状态排除**。

### 6.3 0.1.5 是否有「等待 subagent 期间抑制 goal 触发/冷却/跳过轮次」修复：**没有**

逐项排查（0.1.5 vs 0.1.1）：
- **goal-round-driver**：两版 `readyToDrive`/`competingQueued`/`agent/inbox/inserted` 处理器逐字一致；0.1.5 全部 diff 仅 2 个 hunk（P0-A pause→cancel、P0-B startsRequestSeries），均与 subagent 等待无关。**无 subagent/pending 感知、无冷却、无跳过轮次逻辑**（grep 'subagent|pending' 在驱动器中为空）。
- **agent-loop**：0.1.5 全文 "subagent" 出现 0 次（0.1.1 为 2 次，均属本地 ②b isSubagent 补丁）；phase 状态机两版一致（idle/maintenance/running），无"等待子代理"态。
- **subagent 工具/continuation**：0.1.5 `dsh-tool-subagent` 后台/continuable 文案与 0.1.1 几乎逐字一致（"immediately returns a durable subagent id… When that run settles, the runtime sends the parent a notice"）；`dsh-subagent` continuation 重构（locks→activations、holdOwnership、descriptor 快照前置）是**子代理域内部管理**，不向 parent inbox 插入占位，也无 goal 联动。
- **事件联动**：0.1.5 全树 `subagent/end` 消费方仅 `dsh-hooks-claude-code`、`dsh-sdk-jsonrpc-server`（与 goal 无关）；无任何包把 `subagent/start|end` 关联到 goal 注入抑制。

**结论**：0.1.5 **没有**「等待 subagent 结果期间抑制 goal 触发」类修复；该现象在 0.1.5 机制上同样存在（触发条件逐字相同）。用户描述的 0.1.5 修复应仍指 §0 的 P0-A（宿主 pause 中止运行中 round，属"用户显式暂停"路径，非"等待子代理"路径）与 P0-B（帧写入），两者均未应用——但**即使应用 P0-A/P0-B，也不解决"等待 subagent 期间空转注入"**，因为该现象不在 pause/帧写入路径上。

### 6.4 机制根因与可选最小修复方案（本部署自研，无上游可借）

**根因**：goal 注入条件只检查 `agent.status === "idle" && !competingQueued`，与"该 agent 是否有未决后台 subagent"**无互斥**。subagent 派发后 parent 立即 idle 且 inbox 空 → 空转轮询成立。

**最小修复方案（自研，按面从小到大）**：

| 方案 | 机制 | 最小移植面 | 风险 |
|---|---|---|---|
| **A（推荐）pending-subagent 抑制** | goal-round-driver 内维护 per-agent 未决 subagent 计数：`ctx.on("subagent/start"|"subagent/end")`（两事件 0.1.1 已存在且按 parent scope 分发，`dsh-subagent/lib/index.js:185-210` 载荷含 runId/provider/id/stopReason + parent 参数）；`readyToDrive` 追加 `pendingSubagents === 0` | 仅 `dsh-goal-round-driver/lib/index.js`：state 加计数 + 2 个监听器 + `readyToDrive` 1 条件（~10-15 行） | 中：需核对 subagent/end 的时机（settle 后 emit，与 notifySettlement 的 notice 投递竞态——end 后 notice 才进 parent inbox，存在"end 已到但 notice 未入 inbox"的窄窗口，可并用 competingQueued 兜底）；事件名/载荷 0.1.1 已确认存在，零新依赖 |
| B 派发占位 | subagent 派发时往 parent inbox 注入占位消息（source.kind=subagent-pending）→ competingQueued 天然置位抑制 | 改 dsh-tool-subagent/dsh-subagent 派发路径 | 高：侵入子代理域、与 settle notice 投递机制耦合、占位消息需清理，面比 A 大 |
| C 冷却 | goal round 注入后强制最小间隔（cooldown） | goal-round-driver 时间戳逻辑 | 低面但治标：冷却到期后仍空转一次，不解决"等待期间无意义注入"本质 |

**方案 A 落地要点（供修订执行复核档）**：
- 监听需按 parent 归因：`subagent/start`/`subagent/end` 的第三参 `parent`（scope-filtered）与 `agent` 对应；state 挂 `agent` 键。
- `subagent/end` 在 run settle 时 emit（`run.result.then`），而 settle notice 经 `notifySettlement` 稍后投递 → 窄窗口内 `pendingSubagents=0` 但 notice 未入 inbox：可用现有 `competingQueued`（notice 进 nextTurn 时置位）兜底，或在 `drive()` 前置检查 inbox。
- 也可退化为「轮次注入前检查 `agent.inbox` 空 + 无未决 subagent」双条件。
- 验收标准：派发后台 subagent 后主 agent idle 期间**不再注入 goal round**（会话框无新增 goal_round prompt）；subagent settle 且 notice 消费后恢复注入。

---

## 7. 证据行号索引

- P0-A 来源：ARCH `dsh-goal-round-driver/lib/index.js:234-238`；live 现状 `:234-239`（0.1.1 形态）
- P0-B 来源：ARCH `dsh-goal-round-driver/lib/index.js:339-342`；消费方 ARCH `dsh-agent-loop/lib/index.js:1018-1030,1166-1191`、`dsh-client-ui-chat/lib/client.js:6172`；live 现状 `:335-343`
- 0.1.5 语义出处：ARCH `dsh-goal-round-driver/README.md`（"a host-initiated pause also aborts…"、"An accepted round starts a distinct request series…"）
- API 验证：GLOB `dsh-agent-loop/lib/index.js:381-384,406-412`；GLOB `dsh-agent/lib/index.js:503-506`；GLOB `dsh-goal/lib/index.js:791-796`
- P1 来源：ARCH `dsh-tool-goal/lib/index.js:351-352`；GLOB 对应 `:342-346`
- 既有审计：`.workspace/upstream-015-diff/groups/G6-platform.md:63,125,153`（P0-A 误判处）
- 已应用面：`.workspace/deploy-015/patches/dsh-goal-round-driver.attempt-attribution.patch`（671B，1 行）；`known-sha256-015.txt`（含 dsh-goal-round-driver/lib/index.js）
- 补充取证（§6）：GLOB `dsh-goal-round-driver/lib/index.js:79-81,239-246`（readyToDrive/competingQueued）；ARCH 同文件同号（逐字一致）；GLOB `dsh-subagent/lib/index.js:185-210`（subagent/start|end emit，载荷+parent）；GLOB/ARCH `dsh-subagent/lib/types/continuation.js` notifySettlement（:1099-1155，settle notice 经 followup/steer 投 parent inbox）；0.1.5 全树 `subagent/end` 消费方仅 hooks-claude-code/sdk-jsonrpc-server
