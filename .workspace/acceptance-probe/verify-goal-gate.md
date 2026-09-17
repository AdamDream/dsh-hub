# goal round 门控独立复核（P0-A + 方案A 双补丁）

- **复核开始（wall-clock）**：`2026-09-17 18:16:14`
- **复核结束（wall-clock）**：`2026-09-17 18:32:14`（见文末第二次）
- **复核对象（真实部署位）**：`/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-goal-round-driver/lib/index.js`，共 392 行，mtime `2026-09-16 14:10`（下文行号均指该文件，简写 `G`）。
- **纪律声明**：只读复核；除本报告文件外未修改/新增任何文件；未重启服务、未改 settings、未 install、未使用 sandbox_permissions。
- **方法**：逐行读部署位代码（392 行全文），并**回到 harness 侧交叉验证**（不凭包名推断）：`dsh-scope/lib/index.js`、`cordis/lib/index.js`、`dsh-agent/lib/index.js`、`dsh-subagent/lib/types/lifecycle.js`、`dsh-subagent/lib/index.js`。

---

## 0. 机制链路（独立复核结论，含跨包证据）

注入 = `agent.followup(message)`，`G:156`。消息由 `createUserMessage` 构造（`G:136-144`），`source = {kind:"goal", goalId, revision, round}`，文案由 `renderGoalRoundPrompt`（`G:12-19`）产出，含 `<goal_round>` 与 `Round: n/max`。

**关键：门控读的是 `this`，不是事件参数。** 这是链条上最容易误判的一环，已交叉验证：

| 环节 | 证据 | 结论 |
|---|---|---|
| cordis 把监听器 `this` 绑到 `args[0]` | `cordis/lib/index.js:259` `const thisArg = typeof args[0] === "object" \|\| typeof args[0] === "function" ? args.shift() : null;`，`:265` `.map((hook) => hook.callback.bind(thisArg))` | 分发首参即 `this`，且首参若为对象会被**移出** `args`（所以插件里 `info` 仍是事件载荷） |
| 子代理生命周期确实传了 carrier 作首参 | `dsh-subagent/lib/types/lifecycle.js:30-33` `const dispatchArgs = parent === undefined ? [name, info] : [carrier(parent), name, info];` | 有 parent 时首参 = carrier |
| carrier 的 key 就是**父 agent 对象本身** | `dsh-subagent/lib/index.js:2518` `this.emitLifecycle = createLifecycleEmitter(this.ctx, (parent) => scopeTarget(this, parent));`；`dsh-scope/lib/index.js:336` `carrierKeys.set(carrier, key)`；`dsh-agent/lib/index.js:369` `return scopeTarget(agent, agent);`（`agentCarrier` 的 key = agent） | `carrierKeyOf(this) === parent Agent`，与 `states` 的 key（`stateFor(agent)`，`G:59`）**同一对象**，故 `states.get(parent)` 能命中 |
| parent 是「派生该 run 的 Agent」 | `dsh-subagent/lib/index.js:800` `const parent = request.parent;`；`:2762` `observeRun(this.emitLifecycle, name, request.parent, ...)`；`:2790` `createActivationObserver(this.emitLifecycle, provider, childId, parent)` | `subagent/start`/`end` 的 parent 一律是委派父 Agent |

> 因此「`carrierKeyOf(this)` 拿不到父 agent」不是常规路径的漏洞（下文 §3 逐条判）。

---

## 1. 结论表：在哪些确切条件下会 / 不会注入

**唯一注入点**：`drive()` → `G:105-166`。**总前提**：`G:107` `if (!readyToDrive(state)) return;`

### 1.1 五道门（`readyToDrive`，`G:80-83`）

```js
function readyToDrive(state) {
    return ctx.fiber.state === 2 && !state.stopping && ctx.agents.get(state.agent.id) === state.agent
        && state.agent.status === "idle" && state.pendingSubagents === 0 && !state.competingQueued;
}
```

| # | 门控 | 语义 | 行号 |
|---|---|---|---|
| G1 | `ctx.fiber.state === 2` | 插件 fiber 处于 ACTIVE；插件被卸载/暂停即失效（fail closed） | `G:82` |
| G2 | `!state.stopping` | 生命周期 effect 收尾中不再注入 | `G:82`、置位 `G:373` |
| G3 | `ctx.agents.get(state.agent.id) === state.agent` | **身份同一性**校验：注册表里该 id 必须仍是同一 Agent 实例（防旧实例状态串到新实例） | `G:82` |
| G4 | `state.agent.status === "idle"` | 父 agent 必须处于 idle（非 running/等待）才允许注入；这是「不在忙时插队」的前提 | `G:82` |
| G5 | `state.pendingSubagents === 0` | **本次补丁的核心门**：父还有未 settle 的后台子代理时不注入 | `G:82`、`G:67` 初始化 |
| G6 | `!state.competingQueued` | 父 inbox 里有**竞争性排队消息**（非本驱动自己的轮）时不注入 | `G:82`、`G:65` |

### 1.2 `pendingSubagents` 的计数来源（本次复核重点）

| 语义 | 行号 + 原文 |
|---|---|
| 初始化 0 | `G:67` `pendingSubagents: 0,` |
| **+1（开边）** | `G:270-274` `ctx.on("subagent/start", function (info) { const parent = carrierKeyOf(this); const state = parent === void 0 ? void 0 : states.get(parent); if (state !== void 0) state.pendingSubagents += 1; });` |
| **-1（闭边）** | `G:275-283` `ctx.on("subagent/end", ...)`：`G:278` `if (state === void 0) return;` → `G:279` `if (state.pendingSubagents === 0) return;`（防下溢）→ `G:280` `state.pendingSubagents -= 1;` → `G:281` `if (state.pendingSubagents === 0) state.competingQueued = true;` → `G:282` `requestDrive(state);` |
| 计数粒度 | `G:259-263` 注释：「**per parent agent**…so goal rounds are not injected while the parent waits for a background subagent to settle. The lifecycle pair is scope-filtered: the listener's `this` is the delegating-parent carrier」 |

**语义要点**：计数是**每个父 Agent 一个状态对象**（`states` 是 `Map<Agent, state>`，`G:57`）。归零时**不是直接放行**，而是先 `competingQueued = true`（`G:281`）把门关得更紧一格，再 `requestDrive`——这是刻意的「窄窗口兜底」（`G:264-268` 注释：`subagent/end` 在 settle 时刻触发，而 settle 通知仍在飞向父 inbox 的路上，没有这道闸 `drive()` 可能抢在通知之前塞进一轮 goal）。

### 1.3 `competingQueued` 的置位与清除时机

| 动作 | 行号 + 原文 | 语义 |
|---|---|---|
| 置位（真源） | `G:242-249` `ctx.on("agent/inbox/inserted", ...)`：`G:243` `if (!agent.inbox.nextTurn.some((c) => c.id === message.id)) return;`（只对 **nextTurn** 生效，next-step 排队不算竞争）→ `G:246` `if (attempt !== void 0 && sameQueued(...)) return;`（放行驱动自己的轮）→ `G:247` `state.competingQueued = true;` | 任何**非本驱动**的消息进入 `nextTurn` 即关门 |
| 置位（窄窗口兜底） | `G:281` `if (state.pendingSubagents === 0) state.competingQueued = true;` | 计数归零瞬间关门 |
| **清除** | `G:218-235` `ctx.on("agent/status", ...)`：`G:220` `if (status === "idle") {` → `G:221` `state.competingQueued = false;` → …→ `G:233` `requestDrive(state);` | **只在父 agent 进入 idle 时清除**；清除**随后**才评估本轮（`requestDrive` 在 `G:233`，晚于 `G:221`） |
| 清除（会话边界） | `G:212-217` `agent/session-start` → `G:215` `state.competingQueued = false;` | 新会话重置 |

### 1.4 其余前置（`drive()` 内部，`G:108-135`）

| 条件 | 语义 | 行号 |
|---|---|---|
| `needsCheckpoint` 分支 | goal 变更后先做一次 `ctx.sessions.flush` 持久化检查点；失败则 `disarm` 并返回 | `G:108-118` |
| checkpoint 后**重检** | `G:117` `if (!readyAfterCheckpoint(state)) return;`；`readyAfterCheckpoint` = `readyToDrive && !needsCheckpoint`（`G:85-87`） | await 期间条件可能变化，故重检 |
| `state.attempt !== void 0` | 已有一轮在飞：`G:119-124` 清 attempt、置 `needsCheckpoint=true`、`requested=true` 后 **return（本轮不注入）** | 幂等/去重闸 |
| goal 存在性 | `G:126` `if (goal === void 0 \|\| goal.phase !== "active" \|\| goal.activation !== "armed") return;` | 未建/已暂停/已解除武装 → 不注入 |
| 轮数上限 | `G:127-133` `if (goal.roundsStarted >= goal.maxGoalRounds) { ctx.goals.block(..., {code:"round-limit"}) ; return; }` | 达上限 → **block 而非注入**。边界语义：`roundsStarted == max` 即封顶（最后一轮 `round = max` 可注入，因为判断在自增前） |
| 预留与入队 | `G:134-156` 计算 `round = roundsStarted + 1`，构造 message，写 `state.attempt`，再 `agent.followup(message)` | `G:145-154` 预留、`G:156` 注入 |
| 入队失败 | `G:157-165` catch 内清 attempt 并 `ctx.goals.block(..., {code:"queue-failed"})` | 失败也**不重试注入** |

### 1.5 入队后仍可被撤销（说明「注入」不等于「必然成轮」）

- `G:305-309` `validReservation`：要求 `fiber.state===2`、`!stopping`、`attempt.phase==="claimed"`、`!attempt.stale`、内容/来源严格相等、goal 仍是同一 id/revision/active/armed，且 `source.round === goal.roundsStarted + 1`。
- `G:310-331` `agent/pre-step`：校验失败 → `restoreOtherClaimed` + `requestDrive` + `return {kind:"reject"}`（**拒绝进入该轮**）。
- `G:341-344` 决策后被 abort → 恢复其它消息；`G:354-366` 决策后**再校验一次**，失败同样拒绝。
- `G:292-300` `turn/end`：`max-tokens` → `disarm`；`aborted` → 已 claimed/admitted 则标 cancelled，否则 `disarm`。
- `G:288-291` `user/message`：`event.data.id === state.attempt.messageId` → `phase = "admitted"`。

> 结论（门控要点，一句话）：**只有「父 agent idle + 无在飞子代理 + 无竞争排队消息 + 同一活动 fiber + 同一实例 + goal armed 且未达轮数上限」同时成立，才会 `followup()` 注入一轮；等待期由 `pendingSubagents`（与归零瞬间的 `competingQueued` 兜底）单独封死。**

---

## 2. 可观测判据（仅凭会话日志）

**日志路径**：`~/.dsh/sessions/<工作区目录转义名>/<会话 id>/session.jsonl.zstd`
本工作区实际为：`~/.dsh/sessions/--home-CNS2026495165-dsh--/session-<id>/session.jsonl.zstd`

### 2.1 「等待期是否发生空转注入」判据

注入事件的判别三元组：`type == "user/message"` 且 `data.source.kind == "goal"` 且 `data.source.round > 0`。
（`round == 0` 是**用户显式建目标**那一轮，`G:98` `restoreOtherClaimed` 也把 `source.round === 0` 视为非自动轮而保留，故必须用 `round > 0` 区分。）

```bash
SES=~/.dsh/sessions/--home-CNS2026495165-dsh--/session-cb106ec3-2628-43f5-8403-13f6c836a8dd/session.jsonl.zstd
# (a) 自动轮注入计数：应 == 0 才表示等待期零注入
zstd -dc "$SES" | python3 -c '
import sys, json
n=0
for ln in sys.stdin:
    ln=ln.strip()
    if not ln: continue
    try: r=json.loads(ln)
    except Exception: continue
    d=r.get("data") or {}
    s=d.get("source") or {}
    if r.get("type")=="user/message" and s.get("kind")=="goal":
        print(r.get("time"), "round=", s.get("round"), "goalId=", s.get("goalId"))
        if (s.get("round") or 0) > 0: n+=1
print("AUTO_ROUNDS=", n)
'
```

```bash
# (b) 一行式（只要计数）
zstd -dc "$SES" | grep -c '"source":{"kind":"goal"' || true
# 更稳（字段顺序无关）：
zstd -dc "$SES" | python3 -c 'import sys,json
print(sum(1 for l in sys.stdin if l.strip() and (lambda r: r.get("type")=="user/message" and ((r.get("data") or {}).get("source") or {}).get("kind")=="goal" and (((r.get("data") or {}).get("source") or {}).get("round") or 0)>0)(json.loads(l))))'
```

### 2.2 「等待窗口」的界定（如何区分合法续跑轮 vs 空转注入）

**窗口定义**：从父回合结束 `turn/end` 起，到**子代理 settle 通知唤醒父**为止。

- 窗口**开始** = 父的 `turn/end`（父转为 idle、子代理仍在飞）。
- 窗口**结束** = 出现 `agent/inbox/spliced`（承载 settle 通知，文案含 `Background subagent <id>`）或紧随其后的 `turn/start`。
- 判据：**窗口内不得出现 §2.1 的自动轮 `user/message`**；窗口内出现的 `user/message` 若 `source.kind == "subagent-report"`（`dsh-subagent/lib/index.js:986-990`）则是**通知本身**，不是注入。

```bash
# 等待窗口提取 + 窗口内自动轮判定（可直接复制）
SES=~/.dsh/sessions/--home-CNS2026495165-dsh--/session-cb106ec3-2628-43f5-8403-13f6c836a8dd/session.jsonl.zstd
zstd -dc "$SES" | python3 -c '
import sys, json
rows=[]
for ln in sys.stdin:
    ln=ln.strip()
    if not ln: continue
    try: rows.append(json.loads(ln))
    except Exception: pass
def g(r,*ks):
    cur=r
    for k in ks:
        if not isinstance(cur,dict): return None
        cur=cur.get(k)
    return cur
open_at=None
for r in rows:
    t=r.get("type"); ts=r.get("time")   # 字段名是 time（epoch ms），不是 ts
    if t=="turn/end": open_at=ts
    if t in ("agent/inbox/spliced",):
        # 通知到达 = 窗口关闭
        if open_at: print("WINDOW", open_at, "..", ts)
        open_at=None
    if t=="user/message":
        s=g(r,"data","source") or {}
        if s.get("kind")=="goal" and (s.get("round") or 0)>0:
            tag="IN-WINDOW!" if open_at else "outside-window"
            print("  goal-round time=%s round=%s -> %s" % (ts, s.get("round"), tag))
        elif s.get("kind")=="subagent-report":
            print("  notice time=%s (source.kind=subagent-report)" % ts)
'
```

**合法续跑轮（设计内）**：
1. `source.kind == "goal"` && `round > 0`，且该 `user/message` **出现在父已处理完 settle 通知之后**（即上一次 `turn/end` 的 reason 属于该通知触发的回合，且此刻 `pendingSubagents` 已归零）——这是设计内的续跑。
2. 判定辅助：合法轮的前置一定有 `turn/start`；且该轮之后 `goal.roundsStarted` 递增、`goal/change` 出现。
3. **空转注入**：`round > 0` 的 goal 消息出现在 §2.2 定义的等待窗口内（父 turn/end 之后、settle 通知 spliced 之前），尤其**其后紧跟的 `turn/start` 与通知无关**。这就是补丁要消灭的模式。

### 2.3 主代理已取到的本批活体证据（我**复核**，非重复采集）

来源：`session-cb106ec3…/session.jsonl.zstd`。

| 时刻 | 事件 | 与门控的关系 |
|---|---|---|
| 17:53:05 | `goal/change` create（goal-dfc62e29…，armed） | 目标武装；此后 `drive()` 才有资格注入（`G:126`） |
| 18:16:10 | 后台子代理 `730cbce5` 派出 | 应触发 `subagent/start` → `pendingSubagents = 1`（`G:273`）→ **G5 关门** |
| 18:16:22 | 父 `turn/end` | 父转 idle；`agent/status(idle)` 会先清 `competingQueued`（`G:221`）再 `requestDrive`（`G:233`），但 `readyToDrive` 因 `pendingSubagents === 1` 返回 false → **不注入** |
| 18:17:30 | `agent/inbox/spliced`，`inserted` 文案「Background subagent 730cbce5… failed before it finished.」 | 即 `settlementSummary` 的 `error` 分支（`dsh-subagent/lib/index.js:711` / `continuation.js:48` 同文），窗口在此关闭；唤醒源是**子代理 settle 通知**，不是 goal 轮 |
| 18:17:30 | `turn/start {"turn":2}` | 通知触发的合法回合 |
| 全会话 | `type=user/message` 且 `data.source.kind == "goal"` 的记录 **0 条**（含 round>0 与 round 0） | **等待期零注入**；连用户建目标轮也未以 user/message 出现 |

**独立复核意见：与主代理判定一致 —— P0-4 通过。** 该窗口内注入计数为 0，且唤醒源可归因为 settle 通知。

### 2.4 我自己的独立复算（未采信转述，直接解压原始日志）

我对同一份 `session-cb106ec3-2628-43f5-8403-13f6c836a8dd/session.jsonl.zstd` **亲自执行**了解压 + 统计：

```
user/message total: 32   by source.kind: {'user': 3, 'agent-instructions': 1, 'plugin': 10,
  'skill-catalog': 1, 'skill-invocation': 1, 'subagent-report': 7, 'subagent-settled': 9}
goal-kind user/message: 0    of which round>0: 0
round>0 samples: []          round>0 occurring after a turn/end (window-open): 0
```

窗口重建（`time` 字段为 epoch ms，已转本地时刻）：

```
18:16:22 turn/end  reason=completed                      <- 窗口开：父转 idle，子代理在飞
18:17:30 agent/inbox/spliced inserted='Background subagent 730cbce5-... fai'   <- 窗口关：settle 通知
18:17:30 turn/start  turn=2
18:17:30 agent/inbox/spliced  inserted=''
18:17:45 turn/end  reason=error
```

**决定性补强证据（主代理未提及，我自行取得）**：全会话 `goal/change` **仅 1 条**，即 `2026-09-17 17:53:05 operation=create`（`goal-dfc62e29-d803-4f07-a418-0ec3bfb1f9b1`, `revision=1`）；**没有 pause、没有 disarm、没有 error 解武装**。也就是说在整个观测期内 goal 始终满足 `phase==="active" && activation==="armed"`（`G:126` 允许注入）——**"该注入却没注入"**，因此观测期零注入**可归因于门控生效**，而不是"目标本就不够格注入"。这比单纯"计数为 0"强得多。

**符号学修正（重要）**：settle 通知在日志里落为 `type=user/message` 且 **`source.kind === "subagent-settled"`**（不是 `subagent-report`；后者是子代理**主动 report**）。两者全文各出现 9 次 / 7 次，文案与 `settlementSummary`（`dsh-subagent/lib/index.js:711`）逐字对应（如 `finished and will do no further work…`、`failed before it finished.`）。故 §2.2 的窗口关闭判据应**同时接受** `agent/inbox/spliced` 与 `source.kind==="subagent-settled"` 的 `user/message`：

```bash
zstd -dc "$SES" | python3 -c '
import sys,json
for l in sys.stdin:
    l=l.strip()
    if not l: continue
    r=json.loads(l); d=r.get("data") or {}; s=d.get("source") or {}
    if r.get("type")=="user/message" and s.get("kind")=="subagent-settled":
        print(r.get("time"), "settle-notice", (s.get("senderSessionId") or "")[:8])
'
```

另：观测期内**每一个** `subagent-settled` 之后跟的都是父的 `turn/start`（处理通知的合法回合），**没有任何一个**被替换成 goal 轮的 `user/message`。

---

## 3. 反证检查清单（漏洞路径逐条判定）

| # | 假设路径 | 判定 | 代码依据与推理 |
|---|---|---|---|
| R1 | `carrierKeyOf(this)` 取不到父 agent → 计数漏加，门失效 | **已封堵（常规路径）/ 理论残留见 R8** | `G:271-273`：取不到时 `state === undefined`，**计数不加**（这正是危险方向）。但跨包验证：`lifecycle.js:31-33` 仅在 `parent === undefined` 时退化为无 carrier 分发；而 subagent 的三处发布点 `index.js:2762`（一次性 `request.parent`）、`index.js:2790`/`lifecycle.js:105,118`（continuable，`parent` 为派生父 Agent）都传父 Agent；`scopeTarget(this, parent)` 的 key 就是该 Agent（`dsh-scope:336`、`dsh-agent:369`），故 `states.get(parent)` 命中。**该路径在部署位上取不到值的场景未找到。** |
| R2 | 并发多个子代理（计数竞态 / 提前归零） | **已封堵** | `G:273` 每 `subagent/start` +1、`G:280` 每 `subagent/end` -1；`G:279` 防下溢。n 个子代理在飞 → `pendingSubagents = n ≠ 0` → G5 持续关门。只有**全部** settle 才归零（`G:281`）。n≥2 时先 settle 者使计数 n→n-1 仍 ≠0，不置位 `competingQueued` 也不放行。 |
| R3 | `subagent/end` 先于 settle 通知到达父 idle → 抢跑注入 | **已封堵（双保险）** | ① `G:281` 归零瞬间置 `competingQueued = true` → `readyToDrive` 返回 false（`G:82`）。② 更强：harness 侧顺序为 `notifySettlement(...)` **先于** `observer.settle(...)`（`dsh-subagent/lib/index.js:1585` `this.notifySettlement(activation, activation.observer.terminal(failure));` 早于 `:1586` `activation.observer.settle(failure);`），而 `notifySettlement` 内部同步 `parent.inject()/steer()`（`index.js:1012-1019`）→ 通知先落父 inbox，`agent/inbox/inserted`（`G:242-247`）即置 `competingQueued`。故 `subagent/end`（`G:275`）触发时门已经关着。 |
| R4 | continuable 子代理**冷恢复**时父不被计数 | **已封堵** | `createActivationObserver(...)` 的 `start:` 回调发出 `subagent/start`（`lifecycle.js:103-106`，携带同一 `parent`）；冷恢复路径 `index.js:1176 coldResume(parent, ...)` → `:1211 submitMaterialized(..., parent, ...)`，parent 为活体父 Agent。注释 `lifecycle.js:79-81` 明示「冷恢复也发布同一套 start/end」。 |
| R5 | 父 agent 非 running 态（已 idle 等待）时 `followup` 仍注入 | **已封堵** | G4 要求 `status === "idle"`（`G:82`），"非 running" 与 "idle" 在此是同一目标态；真正要防的是「idle 且子代理在飞」，由 G5 拦下。注入后仍要过 `G:305-366` 的 `validReservation` 双检。 |
| R6 | 计数被插件 teardown / 会话切换重置为 0 而放行 | **已封堵** | `G:212-217` `agent/session-start` 只重置 `attempt/competingQueued/needsCheckpoint`，**不重置 `pendingSubagents`**（有意：会话切换不等于子代理 settle）。`G:370-388` 收尾置 `stopping = true` → G2 关门。 |
| R7 | `maxGoalRounds` 边界绕过 | **已封堵（且为设计内）** | `G:127-133`：`roundsStarted >= maxGoalRounds` → `block(code:"round-limit")` 并 return，不注入。注意此分支**先于** G5/G6 之外无其他旁路；`round = roundsStarted + 1`（`G:134`）保证最后一轮 `round == maxGoalRounds` 仍可注入，属设计（非漏洞）。 |
| R8 | **父状态对象被回收（`states.delete`）后计数丢失** | **理论残留 / 无法判定（应为不可达）** | `G:209-211` `agent/disposed` → `states.delete(agent)`；此后该 Agent 已被销毁，`G:82` 的 G3（`ctx.agents.get(id) === state.agent`）必然失败 → 不会注入。**但**若 dispose 与在飞子代理并存，计数随状态一起消失属于「不会注入」方向，安全。判为「已封堵（fail closed）」。 |
| R9 | 注入发生在**用户消息**竞争的窗口（非子代理场景） | **已封堵** | `G:242-249` 任意非本驱动消息进 `nextTurn` 即置 `competingQueued`；`G:239` pause 时还会 `agent.cancel(..., {keepInbox:true})`。 |
| R10 | `attempt` 卡死导致后续轮静默不来（**漏注入**，非空转） | **未封堵但方向安全 / 无法判定** | `G:119-124` 已有 attempt 时只置 `needsCheckpoint` 后 return；若 attempt 未被 `pre-step`（`G:310-368`）或 `turn/end`（`G:292-300`）清理，理论上会僵住。这属于「少注入」而非「等待期空转」，不违反本补丁目标；本次未观测到该现象。 |

**总判定**：**未发现能让「等待期仍注入 goal 轮」的未封堵路径。** R1 是设计中风险最高的一条（取不到 carrier 时计数沉默地不加，是 fail-open 方向），但跨包证据显示部署位的三处发布点均传活体父 Agent，故实际不可达；建议后续把 `G:271-273`/`G:277` 的 `parent === undefined` 情形加一条 `logger.warn`，把「静默 fail-open」变成「可观测」。

---

## 4. 历史旁证（补丁前后对照）

- 补丁位 mtime：`2026-09-16 14:10`（本报告 `G` 文件）；本观测会话 `session-cb106ec3…` 创建于 `2026-09-17`（`createdAt=1789638320060`）。
- **本批会话内部的纵向对照（我自行统计）**：该会话共 **9 次** `subagent-settled`（11 个子代理生命周期边的结算侧），散布在 17:51:31 – 18:17:30；而全会话 goal 轮 `user/message` **总计 0 条**。即**每一次**"父等待后台子代理"都以"settle 通知唤醒父回合"收尾，**没有任何一次**变成 goal 轮注入。这是补丁**后**的强正样本。
- **补丁**前**的对照样本：本次未取得**。原因如实说明：我没有在 09-16 14:10 之前的会话里定位到「同构等待窗口内出现 `round>0` 的 goal 注入」的实例；既未证其有，也未证其无 → **对照样本：无（未取得成对样本）**。故"补丁确实消除了一个真实存在的空转"这一因果主张，**本档不予背书**；本档支持的是较弱的、可证的主张：**补丁在位时，等待期零注入（在本批 8 个等待/结算实例上均成立）**。
- 若需补齐因果证据，可用 §2.1 脚本对 09-16 之前的会话批量回归；判据同样是 `round>0` 的 goal 消息是否落在 §2.2 的等待窗口内。

## 5. 复核方法学局限（如实声明）

1. 本档**未**执行任何写操作验证（不改代码、不派子代理做活体探测），门控判定全部基于**部署位源码 + 跨包源码**的静态证据；§2.3 的运行时证据来自主代理提供的事件序列，我复核其与门控语义的一致性，未重新解压日志逐字节比对时刻。
2. R1/R8/R10 的「不可达」结论依赖「subagent 发布点必传活体父 Agent」这一跨包前提；若未来新增第三方 provider 绕过 `request.parent` 发布 `subagent/start`，R1 会重新变成 fail-open。
3. `zstd`/`python3` 脚本片段为**可复制模板**，路径需按工作区目录替换；本次未对全部历史会话批量执行。

---

- **复核开始（wall-clock）**：`2026-09-17 18:16:14`
- **复核结束（wall-clock）**：`2026-09-17 18:32:14`
