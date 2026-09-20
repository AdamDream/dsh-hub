# 执行报告：0.1.5 goal P0-A 修复移植（宿主 pause → 中止运行中 round）

- 日期：2026-09-16
- 角色：修订执行复核一体阶段子代理（路由 adam/deepseek-v4-flash）
- 任务：将 0.1.5 的 goal P0-A 修复（`dsh-goal-round-driver`：宿主 pause 时中止运行中 round）移植到本部署 0.1.1，同档自复核
- 素材：`.workspace/goal-round-gap-audit.md`（审计结论）、0.1.5 归档 `~/.dsh/profiles-archive/web2-20260915-105429/node_modules/@deepseek-ai/dsh-goal-round-driver/lib/index.js:234-238`、live 0.1.1 `~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-goal-round-driver/lib/index.js:234-238`
- 约束遵守：只写 `.workspace/deploy-015/dsh-goal-round-driver/` 与本报告；未改 `~/.dsh`（live 树 sha256 不变，见 §5）；未使用 sandbox_permissions

---

## 0. 结论摘要（TL;DR）

- **移植完成**：P0-A 已按 0.1.5 语义逐字移植到 0.1.1 `dsh-goal-round-driver`，改动 2 行（goal/changed 加 `change` 参数 + 1 行 pause→cancel 守卫）。
- **0.1.5→0.1.1 签名适配：无需适配**——审计 §4.1 指出的三个依赖 API 在 0.1.1 全部存在且签名一致（本次已逐行实测复核，见 §3），`goal/changed` 载荷含 `change.operation`（dsh-goal `commit` 发射 `{ change: notification }`，`notification.operation = change.operation`）。因此移植行与 0.1.5 源行**逐字相同**（diff 证明，见 §5）。
- **产出物**：
  - unified diff（patch -p1 于包目录）：`.workspace/deploy-015/dsh-goal-round-driver/P0A.pause-abort-round.patch`
  - 应用后完整副本：`.workspace/deploy-015/dsh-goal-round-driver/`（与既有 attempt-attribution 副本同目录共存，`lib/index.js` 已含两个补丁，其余文件与 live 逐一相同）
  - 锚点：`agent.cancel({ kind: "user" }, { keepInbox: true })` 于 `lib/index.js:237`；`currentInitiator` 于 `:237`
  - 与 :222 attempt-attribution 补丁**零重叠**（hunk 行号不交：P0-A `@@ -231,9 +231,10 @@` vs attempt-attribution `@@ -219,7 +219,7 @@`，grep 确认）
- **验证**：node --check 通过；patch 在干净 live 副本上 dry-run/实打均通过且重派生后与交付副本 sha256 一致；mock 行为验证 7 项断言全 PASS（宿主 pause+运行中 → cancel 恰一次、keepInbox=true、idle/resume/自轮 pause 不误伤、重复事件不重复 cancel）。
- **部署要点**：宿主 lib 改动需**重启 dsh 进程生效**，可并入下次重启批次（与 peer 会话 P0-a 批次同理）。部署由主代理执行：将 `lib/index.js` 复制到全局包路径，或将补丁放入 `.workspace/deploy-015/patches/` 后 patch -p1 应用。

---

## 1. 移植内容（P0-A）

### 1.1 机制（0.1.5 语义）

`goal/changed` 处理器中：任何 goal 变更先置 `needsCheckpoint = true`；当且仅当 **变更操作是 `pause`** 且 **agent 正在运行**（`agent.status === "running"`）且 **发起者不是 agent 自己**（`ctx.agents.currentInitiator() !== agent`，即宿主/外部发起）时，立即 `agent.cancel({ kind: "user" }, { keepInbox: true })` 中止在飞轮次。

语义（0.1.5 README 原文）：*"a host-initiated pause also aborts the turn already running, while a model-initiated pause inside its own turn finishes normally"*。

### 1.2 改动前后

**before（live 0.1.1 `:234-238`）**：

```js
ctx.on("goal/changed", ({ agent }) => {
    const state = stateFor(agent);
    state.needsCheckpoint = true;
    requestDrive(state);
});
```

**after（交付副本 `:234-239`，与 0.1.5 `:234-238` 逐字相同）**：

```js
ctx.on("goal/changed", ({ agent, change }) => {
    const state = stateFor(agent);
    state.needsCheckpoint = true;
    if (change.operation === "pause" && agent.status === "running" && ctx.agents.currentInitiator() !== agent) agent.cancel({ kind: "user" }, { keepInbox: true });
    requestDrive(state);
});
```

### 1.3 最小移植面

2 行（`:234` 加 `change` 解构参数 + `:237` 加一行 if 守卫），与审计 §3.1「最小移植面 2 行」一致。不触碰 pre-step/attempt 保留逻辑、不涉及 startsRequestSeries（P0-B 属 B10 勿借，未移植）。

---

## 2. 0.1.5→0.1.1 签名适配记录

**结论：零适配，逐字移植。** 审计 §4.1 的三个依赖 API 已在本档逐一实测复核（live 树直接读取），签名与 0.1.5 一致：

| 依赖符号 | 0.1.1 位置（实测） | 签名 | 适配 |
|---|---|---|---|
| `agent.status` getter | `dsh-agent-loop/lib/index.js:381-384` | `get status() { return this.phase.kind === "idle" \|\| this.phase.kind === "maintenance" ? "idle" : "running"; }` | 无（语义同 0.1.5） |
| `agent.cancel(cause, options)` 支持 keepInbox | `dsh-agent-loop/lib/index.js:406-412` | `cancel(cause, options = {}) { if (!options.keepInbox) { this.inbox.clear(); ... } if (this.phase.kind !== "idle") this.phase.abort.abort(cause); }` | 无（keepInbox 位置/语义同 0.1.5） |
| `ctx.agents.currentInitiator()` | `dsh-agent/lib/index.js:503-506` | `currentInitiator() { this.assertInitiatorsReadable(); return this.initiators.getStore(); }` | 无 |
| `goal/changed` 载荷含 `change.operation` | `dsh-goal/lib/index.js:791-796` | `const notification = { operation: change.operation, ref: {...ref}, ... }; agentEvents(...).emit("goal/changed", { change: notification });` | 无（事件载荷即 `{ agent, change }` 结构） |

> 说明：0.1.1 `ctx.on` 事件处理器统一为 `(payload) =>` 单参形式（与 0.1.5 相同），`goal/changed` 载荷 `{ agent, change }` 结构一致，故 `({ agent, change })` 解构直接可用。

---

## 3. 依赖 API 复核证据（本档实测，非转引审计）

以下均在本档直接读取 live 0.1.1 源文件核实：

1. **status getter**：`~/.npm-global/.../@deepseek-ai/dsh-agent-loop/lib/index.js:381-383` —— `get status()` 存在，返回 `"idle"` / `"running"`，与 0.1.5 判断语义一致（0.1.1 多了 maintenance 分支，不影响本补丁：maintenance 视作 idle，pause 时不误 cancel）。
2. **cancel + keepInbox**：同文件 `:406-412` —— `cancel(cause, options = {})`，`!options.keepInbox` 时才清空 inbox；相位非 idle 时 `abort.abort(cause)`。与 0.1.5 用法 `cancel({kind:"user"}, {keepInbox:true})` 完全匹配：**keepInbox=true ⇒ 不清 inbox，goal 已排队输入不丢**。
3. **currentInitiator**：`~/.npm-global/.../@deepseek-ai/dsh-agent/lib/index.js:503-506` —— `currentInitiator()` 存在，返回当前 initiator 存储（agent 或 undefined）。宿主 pause 时 drive 之外无 initiator 边界（或为宿主），`!== agent` 成立；模型自轮内 pause 时 initiator 为 agent 自己，`!== agent` 不成立 ⇒ 不 cancel。
4. **goal/changed 载荷**：`~/.npm-global/.../@deepseek-ai/dsh-goal/lib/index.js:778-796` —— `commit()` 构造 `{ operation: change.operation, ref, goal? }` 并以 `{ change: notification }` 发射 `goal/changed`。

---

## 4. 产出物

### 4.1 unified diff（patch -p1 于包目录）

路径：`.workspace/deploy-015/dsh-goal-round-driver/P0A.pause-abort-round.patch`（sha256 `1026e1e1...`）

```diff
--- a/lib/index.js
+++ b/lib/index.js
@@ -231,9 +231,10 @@
 				requestDrive(state);
 			}
 		});
-		ctx.on("goal/changed", ({ agent }) => {
+		ctx.on("goal/changed", ({ agent, change }) => {
 			const state = stateFor(agent);
 			state.needsCheckpoint = true;
+			if (change.operation === "pause" && agent.status === "running" && ctx.agents.currentInitiator() !== agent) agent.cancel({ kind: "user" }, { keepInbox: true });
 			requestDrive(state);
 		});
 		ctx.on("agent/inbox/inserted", ({ agent, message }) => {
```

- `patch -p1` 兼容（路径 `a/lib/index.js`/`b/lib/index.js`，于包目录内执行）。
- 已在**干净 live 副本**上验证：dry-run OK、实打 OK、实打后与交付副本 `diff` 为空（重派生一致，见 §5）。

### 4.2 应用后完整副本

路径：`.workspace/deploy-015/dsh-goal-round-driver/`（既有 attempt-attribution 副本目录，本次更新 `lib/index.js` 为「attempt-attribution + P0-A」双补丁状态，未覆盖 attempt-attribution 行；其余文件与 live 逐一 `diff -rq` 相同）

- 目录内文件：`lib/index.js`（已改）、`lib/invariant.js`、`lib/types/{index,invariant,prompt}.d.ts`、`LICENSE`、`package.json`、`README.md`、`README.zh.md`、`README.i18n.yaml`、新增 `P0A.pause-abort-round.patch`
- `lib/index.js` sha256：`ce17b05008cabf70de00fd1f5f7040b42d39671648fd64b21674a137ecb6d69a`
- 类型文件与 invariant 与 live 完全一致（P0-A 不改导出/类型面，无需动 .d.ts）

### 4.3 锚点（grep 确认）

```
237:  if (change.operation === "pause" && agent.status === "running" && ctx.agents.currentInitiator() !== agent) agent.cancel({ kind: "user" }, { keepInbox: true });
```

- `keepInbox` 出现 1 次（`:237`）；`cancel({ kind: "user" }` 出现 1 次（`:237`）；`currentInitiator` 出现 1 次（`:237`）。文件内另有既有 `:352` `state.agent.cancel({ kind: "parent" })`（teardown 既有逻辑，未触碰）。

### 4.4 与 :222 attempt-attribution 补丁零重叠（grep 确认）

- attempt-attribution 补丁 hunk：`@@ -219,7 +219,7 @@`（改 `:222` 行）
- P0-A 补丁 hunk：`@@ -231,9 +231,10 @@`（改 `:234-237` 行）
- 两 hunk 行号区间不交（219-225 vs 231-240），语义域不同（attempt 归属守卫 vs pause 中止在飞轮），零冲突。
- attempt-attribution 锚点行在交付副本中保持原样：
  `:222 if (attempt !== void 0 && (attempt.phase === "queued" || attempt.phase === "claimed" || attempt.cancelled) && ... && attempt.goalId === goal.id && attempt.revision === goal.revision)`（grep 命中，未改）。

---

## 5. 验证结果

### 5.1 语法与补丁可应用性

| 项 | 结果 |
|---|---|
| `node --check lib/index.js`（交付副本） | ✅ 通过 |
| `patch -p1 --dry-run`（干净 live 副本） | ✅ DRY_RUN_OK |
| `patch -p1` 实打（干净 live 副本） | ✅ APPLY_OK，`diff` 与交付副本为空（RE-DERIVED_IDENTICAL） |
| live 树未被改动 | ✅ live `lib/index.js` sha256 `0fe69e0f...` 全程不变（对比前后一致，本档未写 ~/.dsh 任何文件） |

### 5.2 语义等价（0.1.5 vs 移植后）

- `diff <(sed -n '234,239p' 0.1.5) <(sed -n '234,239p' 交付副本)` → **HANDLER_BLOCKS_IDENTICAL**（handler 块逐字相同）。
- 全文件 diff（0.1.5 vs 交付副本）仅剩 `:339-342` startsRequestSeries 差异（P0-B，B10 勿借，不在本任务范围）。

### 5.3 行为验证（mock harness，7 项断言全 PASS）

无现成 goal-round-driver 测试（live 与 0.1.5 归档包均无 test 文件；package.json 无 test script）。按任务要求给最小行为验证：加载**真实移植后模块**（复制到临时目录 + stub `@deepseek-ai/dsh-llm` 的 `createUserMessage`），mock ctx（`fiber.state=2`、`agents.get/list/withoutInitiator/currentInitiator`、`goals.*`、`sessions.flush`、`logger.warn`、`on/effect`）与 mock agent（`status`、`cancel` 记录、`inbox`、`whenIdle`），驱动 `apply(ctx)` 后发射 `goal/changed`：

| # | 场景 | 期望 | 结果 |
|---|---|---|---|
| T1 | 宿主 pause + agent running（initiator=其他） | `cancel({kind:"user"},{keepInbox:true})` 恰 1 次 | ✅ PASS |
| T1b | 同上 | cause.kind === "user" | ✅ PASS |
| T1c | 同上 | options.keepInbox === true（inbox 保留） | ✅ PASS |
| T2 | 宿主 pause + agent idle | 不 cancel | ✅ PASS |
| T3 | resume（非 pause）+ running | 不 cancel | ✅ PASS |
| T4 | 自轮 pause（currentInitiator()===agent）+ running | 不 cancel（模型自轮内 pause 正常结束） | ✅ PASS |
| T5 | 连续 pause→resume 事件 | 不抛异常、不重复 cancel（恰 1 次） | ✅ PASS |

> 说明：mock 的 `agent.status` 用普通属性模拟 live getter（"running"/"idle"），`cancel` 记录调用参数，`currentInitiator` 可配置，验证的就是真实移植代码的控制流，不是复制逻辑。T4 对应 0.1.5 README 的 "model-initiated pause inside its own turn finishes normally"。

---

## 6. 自复核（同档）

### 6.1 对照审计结论逐条核验

| 审计要求 | 核验结果 |
|---|---|
| P0-A 语义 = 0.1.5（宿主 pause 中止在飞轮） | ✅ handler 块与 0.1.5 逐字相同（diff 证明），T1 行为成立 |
| keepInbox 保留 inbox（不丢 goal 状态） | ✅ 调用参数 `{keepInbox:true}`（T1c）；0.1.1 cancel 实现 `!options.keepInbox` 才清 inbox（§3.2 实测） |
| 仅宿主 pause 触发（不误伤正常 round） | ✅ 三重守卫 `operation==="pause" && status==="running" && currentInitiator()!==agent`：非 pause（T3）、idle（T2）、自轮 pause（T4）均不 cancel |
| 与既有补丁零冲突 | ✅ hunk 行号不交（§4.4），attempt-attribution `:222` 锚点原样保留 |
| 最小移植面 | ✅ 仅 2 行，无扩散（P0-B startsRequestSeries 未动，类型/invariant 未动） |
| 不扩范围 | ✅ 未做任何设计决策：未改 README 措辞、未动 package.json 版本、未动其他包 |

### 6.2 部署要点（供主代理）

- 生效方式：宿主 lib 改动需**重启 dsh 进程**（`dsh-goal-round-driver` 为宿主插件 lib），可并入下次重启批次（与 peer 会话 P0-a 补丁同理）。
- 部署动作（主代理执行）：将 `.workspace/deploy-015/dsh-goal-round-driver/lib/index.js` 覆盖至 `~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-goal-round-driver/lib/index.js`（建议先备份、sha256 校验），或将 `P0A.pause-abort-round.patch` 移入 `.workspace/deploy-015/patches/` 后于包目录 `patch -p1`。
- 回滚：替换回 live 原文件（sha256 `0fe69e0f...`）或 `patch -R` 该补丁即可；两补丁独立可逆。

### 6.3 问题清单 / 残余风险

1. **[已核实，非问题]** 0.1.1 `status` getter 含 `maintenance` 相位归为 idle——宿主 pause 恰逢 maintenance 时不 cancel（仅 drive 循环外），与 0.1.5 判断略有差异但方向安全（不多 cancel，仅少 cancel 一个非常规窗口）。
2. **[低风险，0.1.5 同源]** `currentInitiator()` 在 host 发起 pause 时若位于某个异步链内返回的是链上 agent 而非 undefined——该场景与 0.1.5 行为一致（同一表达式），无本地差异。
3. **[观察项]** `:352` 既有 teardown `cancel({kind:"parent"})` 与新增 `:237` `cancel({kind:"user"})` 原因不同、路径不同（teardown 卸载 vs pause），互不干扰。
4. **[非本任务]** P0-B（startsRequestSeries）与 P1（GOAL_TOOL_RESUME_PAUSED 守卫）按审计结论未移植，需主代理另行裁决批次。

### 6.4 自裁决

**通过**：移植逐字对齐 0.1.5 语义、全部验证命令真实执行通过、锚点与零重叠有 grep/diff 证据、live 树未被触碰、未使用 sandbox_permissions。无需要返工项。

---

## 7. 证据行号索引

- 0.1.5 参照实现：`~/.dsh/profiles-archive/web2-20260915-105429/node_modules/@deepseek-ai/dsh-goal-round-driver/lib/index.js:234-238`
- 0.1.1 live 目标：`~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-goal-round-driver/lib/index.js:234-238`
- 交付副本：`.workspace/deploy-015/dsh-goal-round-driver/lib/index.js:234-239`（锚点 `:237`）
- 依赖 API：`dsh-agent-loop/lib/index.js:381-384,406-412`；`dsh-agent/lib/index.js:503-506`；`dsh-goal/lib/index.js:778-796`
- 既有补丁：`.workspace/deploy-015/patches/dsh-goal-round-driver.attempt-attribution.patch`（hunk `@@ -219,7 +219,7 @@`）
- 审计：`.workspace/goal-round-gap-audit.md`（§3.1 P0-A 机制、§4.1 事实修正）
