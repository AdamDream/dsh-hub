# /taste backfill 补学命令 — 可执行设计文档

> 目标：为 dsh-taste 增加 `/taste backfill [n]` 子命令，把当前会话此前 n 轮（默认全部）历史文本补学进 taste.md，
> 补齐"历史轮已说过但未学到的偏好永不补学"的缺口。本设计只加 backfill 子命令与支撑模块，不动现有 8 命令行为、不动学习钩子契约、不做跨会话回溯。

基线（审计员亲跑）：`cd /home/CNS2026495165/dsh/dsh-taste && node --test "test/*.test.js"` → **# pass 126 / # fail 0**。

关键宿主事实（本设计据以决策，均已读源码取证）：

- 命令 invocation 形状：`CommandInvocation = { commandId, agent, rawInput, attachments, signal }`，`invocation.agent` 即 `Agent`
  （`@deepseek-ai/dsh-commands/lib/types/index.d.ts:16-33`）。`invocation.agent.session.events` 是会话事件数组，
  现有命令已用 `invocation?.agent?.session?.header?.cwd`（`lib/commands.js:24`）。
- 斜杠命令是 **log-only、不包 turn** 的：`command/run` 在 handler 之前追加、`command/done` 在之后追加，二者"direct log-only appends —
  no turn wraps them"（`@deepseek-ai/dsh-commands/lib/index.js:300-372`，types.d.ts:69-103）。
  **命令不会产生 `user/message` / `assistant/message` 事件**，因此 `collectTurnTexts` 天然读不到命令文本。
- `recordInput: false` 使 `command/run` 不带 `args`（`lib/index.js:310`、commands.js:262），命令原文不进会话日志。
- 事件形状（collector 已约定）：`turn/start{data.turn}`、`turn/end{data.turn}`、`user/message{data.source.kind, data.content}`、
  `assistant/message{data.message.content | data.content}`（`lib/collector.js:24-26,54-96`、`test/collector.test.js:7-30`）。

---

## 1. 数据流终稿

```
invocation.agent.session.events
  │  (commands.js backfill handler 读取；命令为 log-only，不含当前命令文本)
  ▼
deps.enqueueBackfill({ agent, events, n })          // index.js 注入，见 §2/§5
  │
  ├─ 有效块预算 = min(32_000, observer.maxInputChars ?? 32_000)  // 驱动热读 config 注入（审计 issue #4，§5.2）
  ├─ buildBackfillBlocks(events, { n, redactFn, blockMaxChars: 有效预算 })   // 新模块 lib/backfill.js，纯函数
  │     ├─ splitHistoricalTurns(events)             // 轮切片（方向相反：历史全部轮）
  │     ├─ 每轮 collectTurnTexts(slice, turn, {8k/12k, redactFn})   // 复用 collector
  │     ├─ isCommandTurn(userText) 过滤              // 防误学：空轮/命令轮剔除（§4）
  │     └─ 分块：≤ blockMaxTurns 轮 或 ≤ blockMaxChars 字符（先到为准）
  │          每块 = { newMessages(多轮合并), priorWindow(最近≤20条) }
  │
  ▼
后台 waterfall 驱动（index.js，fire-and-forget，命令立即返回）
  逐块 queue.push({ agent, newMessages, priorWindow, cwd, kind:"backfill", onSettled })
  │  （与 turn-stopping 共用同一单并发队列 + 熔断 + in-flight Set，§5）
  ▼
executeJob(job) → runTasteJob(job, sessionId)       // 复用现有管线（index.js:426-470）
  │  新：job.newMessages 直接作为 NEW 段；job.onSettled(err?) 在 finally 触发
  ▼
buildLearnerInput({ tasteTree, newMessages, priorWindow })   // 复用 learner.js:75
  │  新：runTasteJob 每块热读 listTasteFiles → 第 k 块 tasteTree 反映前 k-1 块写入（§9）
  ▼
runLearner({ agents, parentAgent, input, config, ... , sessionId })  // learner.js:113，全继承
  ▼
learner 子代理（agents.create）经 write/edit_taste_file 写 taste.md
```

### 新函数签名（lib/backfill.js，纯函数、零副作用、可直接单测）

```js
// 参数解析
export function parseBackfillArg(argument) : { ok:true, n:number } | { ok:false, reason:string }

// 轮切片：历史全部"已完成"轮（有 turn/end 的轮），按数组序；含 turn 号与有界切片
export function splitHistoricalTurns(events) : Array<{ turn:number, events:Array }>

// 分块：给定事件数组，产出串行补学的块序列（每块 NEW 多轮合并 + priorWindow 最近≤20）
export function buildBackfillBlocks(events, {
  n = Infinity,                 // 此前 n 轮（默认全部）；slice(-n) 取最近 n 轮
  redactFn = redactSensitive,   // 复用 storage
  blockMaxChars = 32_000,       // 块字符预算（§3/§9 与 observer.maxInputChars 的交互）
  blockMaxTurns = 4,            // 块轮数上限（与字符预算"先到为准"）
}) : Array<{ newMessages:Array, priorWindow:Array }>
```

### 模块边界

- **lib/backfill.js（新）**：`parseBackfillArg` / `splitHistoricalTurns` / `buildBackfillBlocks` + 局部小助手
  （`isCommandTurn`、`joinVisibleText`、`collectPriorWindow`）。只 import 已有纯模块：
  `collectTurnTexts, isLearnableUserEvent`（collector.js）、`clipText, redactSensitive`（storage.js）、
  `buildLearnerInput`（learner.js，仅测试引用形状时可不用）。**不 import index.js**（避免拉进 schemastery/home-paths 等重依赖）。
- **lib/index.js（增量）**：注入 `enqueueBackfill` dep + 后台 waterfall 驱动 + `runTasteJob` 支持 `job.newMessages` +
  `executeJob` 支持 `job.onSettled(err?)` + `backfillProgress` 状态。所有 queue/熔断/in-flight/config 能力原地复用。
- **lib/commands.js（增量）**：新增 `backfill` 子命令 + dispatch case + USAGE + `/taste status` 显示 backfill 进度。
- **collector.js / storage.js / learner.js / queue.js 均不动**（改动清单不含它们）。

---

## 2. 命令接口

### 语法与解析

`/taste backfill [n]`：动词 `backfill`，`argument = rawInput` 去掉首词后 trim（沿用 commands.js:225-227 的
`words[0]` 分词）。`parseBackfillArg(argument)`：

| 输入 | 结果 |
|---|---|
| 空（`/taste backfill`） | `{ ok:true, n: Infinity }` → 全部历史轮 |
| `/^\d+$/` 正整数 | `{ ok:true, n: parseInt }` → 最近 n 轮 |
| `0` | `{ ok:false, reason:"n must be at least 1" }` |
| 负数（如 `-1`，不匹配 `/^\d+$/`） | `{ ok:false, reason:"n must be a positive integer" }` |
| 非数字（`abc`、`1.5`） | `{ ok:false, reason:"n must be a positive integer" }` |

`n` 语义：**"此前 n 轮" = 最近 n 个已完成历史轮**（`splitHistoricalTurns(events).slice(-n)`，chronological 序）。
`n > 实际轮数` 时等价于全部。歧义点记入 §9 风险表。

### 返回文案

- 成功：`已排入 ${blocks} 块（${turns} 轮），learner 后台串行补学；结果见 /taste list 或 taste.md。`
- 空历史 / 无 learnable 轮：`backfill: 没有可补学的历史轮。`（kind:error）
- 熔断冷却中：`backfill: learner 熔断冷却中，请稍后再试。`（kind:error，命令前置检查 `queue.stats().cooldownUntil > Date.now()`）
- 学习关闭：`backfill: 学习已关闭（/taste on 开启）。`（kind:error，前置检查 `currentConfig().learningEnabled`）
- 参数非法：`Usage: /taste backfill [n]. ${reason}`（kind:error）

命令**立即返回**（不 await 后台驱动）；"已排入 N 块"的 N 是块数，与"n 轮"是两个量，文案里都写清。

### 抉择：排入队列 vs 命令内联 —— 选"排入共享队列"

**结论：backfill 块作为 job 排入现有共享队列（`createJobQueue`，cap 3，index.js:472），不用命令内联执行，不新建第二队列。**

论证：

1. **单并发**（`queue.js:6-7` "jobs run one at a time on a promise chain"）：backfill 与 turn-stopping 天然串行，任意时刻至多一个 learner，
   成本封顶（§9）、taste.md 写盘无并发竞态（learner-tools 的 withTasteLock 仍是最后防线，learner-tools.js:97,145）。
2. **熔断继承**：块失败会 re-throw 进 `executeJob` → 队列 `schedule()` 计数 → 3 连败 arm cooldown → 后续 `push` 返回 false（queue.js:84-90,103-107）。
   backfill 直接继承这套"3 连败中止剩余块"语义（§6），无需自建限流。
3. **in-flight 继承**：backfill 块走 `executeJob`，其 learner `sessionId` 自动进 `inFlightLearners` Set（index.js:462-470），
   满足"backfill learner 的 sessionId 也要进 Set"（§5）。
4. **反证内联**：若命令内联 `await runLearner`，则 (a) 绕过 queue 失去共享熔断与单并发，需在 backfill.js 自建限流/熔断（重复造轮子）；
   (b) 与 turn-stopping 队列并发 → 两个 learner 同时跑 → 双倍成本 + taste.md 锁争用；(c) 命令 handler 必须 await 整个补学，
   违反"命令立即返回"。故内联被否。

**cap=3 的冲突与解法**：共享队列 cap 3（index.js:472），若一次性 push N 块会"丢最旧"（queue.js:108-110），丢块不可接受。
解法：backfill 用 **waterfall 背压**——一次只 push 1 块，等该块 `onSettled` 后再推下一块（§5）。

> **审计修订（blocker #1）**：waterfall 只消除了"backfill 自身把 backfill 挤掉"，**未消除"backfill 挤掉常规学习"**。
> 块 k 执行期间用户继续对话，turn-stopping 可把 pending 推到 cap 3；块 k settle 后若盲推块 k+1，`push` 内
> `while (pending.length > limit) pending.shift()` 会驱逐最旧的一条**常规 turn-stopping job**，静默丢真实学习。
> **修正**：推下一块前必须等队列**完全空闲**（`queue.stats().running === false && queue.stats().pending === 0`），
> 用 `queue.drain()` 等待、返回后再同步复查、非空闲则重试，检查与 push 在同一同步 tick 内、中间不 await（§5.2）。
> 由此 **撤销"cap 永不触顶"的绝对断言**，改为"backfill 仅在队列空闲时前进、主动为常规学习让路"。
> 进度可见性仍由 `backfillProgress` 状态补足（§4/§5），不依赖队列 pending 计数。

---

## 3. 分块算法

全部实现在 `buildBackfillBlocks`（纯函数）。

### 3.1 轮切片（方向相反）

`splitHistoricalTurns(events)`：

1. 收集所有 `events[i].type === "turn/start"` 且 `Number.isFinite(data.turn)` 的下标（数组序，不信任 turn 号排序）。
2. 每个 turn 的切片 = `events[startIdx, nextStartIdx)`（到下一 turn/start 或数组尾，exclusive）。
3. **只保留"已完成"轮**：切片内含 `turn/end` 事件（`slice.some(e => e.type === "turn/end")`）。无 turn/end 的尾段是"当前开轮"，
   剔除——它属于正在进行的 turn，其文本已由 turn-stopping 钩子负责（index.js:477-503），补学它会造成重复学习。
4. 返回 `[{ turn, events: slice }, ...]`（chronological）。

> 与 collector 的区别：collector 的 `turnSlice(events, turn)` 从 turn/start 切到**数组尾**（collector.js:54-61，服务于"本轮还在开"），
> backfill 反向——把历史按 turn/start 边界切成**有界段**，再逐段喂回 `collectTurnTexts(slice, turn, opts)`（其内部 turnSlice 在子数组
> 首元素找到该 turn/start，切 [1:] 恰好得到本轮消息）。切片复用 collector，只新增边界切分。

### 3.2 单轮 clip（复用）

每轮 `collectTurnTexts(slice, turn, { userMaxChars: 8_000, assistantMaxChars: 12_000, redactFn: redactSensitive })`
（collector.js:45-51）。collector 内部先 join 文本块、再 `redactFn`、最后 `clipText`（head 35% + `[...clipped...]` + tail，
collector.js:102-123）。与 turn-stopping 钩子完全一致（index.js:487-491，`TURN_USER_MAX_CHARS=8_000`/`TURN_ASSISTANT_MAX_CHARS=12_000`，index.js:76-77）。

### 3.3 块组装（≤ N 轮 或 ≤ 有效块预算字符，先到为准）

对过滤后的轮（每轮 `{ userText, assistantText }`）按序累积：

- 轮转消息：`newMessages` 追加 `{role:"user",content:[{type:"text",text:userText}]}`（若有）与
  `{role:"assistant",content:[{type:"text",text:assistantText}]}`（若有）。
- 字符计量：`userText.length + assistantText.length`（实际内容，不含 JSON 包裹开销）。
- 触发新块：`当前块已非空` 且（`chars + 本轮 > blockMaxChars` **或** `轮数 ≥ blockMaxTurns`）。
- 常量：`blockMaxChars`（需求标称 32_000，**实际由驱动按 `min(32_000, observer.maxInputChars ?? 32_000)` 注入**，审计 issue #4）、
  `blockMaxTurns = 4`。每轮 ≤20k（8k+12k），故字符预算通常先到（约 1~2 轮/块）；默认 `maxInputChars=16k` 时有效预算实为 16k。

### 3.4 priorWindow（最近 ≤20 条，防重复语义不变）

每块 `priorWindow` = **该块首轮 `turn/start` 之前**的最后 ≤20 条可见 user/assistant 消息，每条
`clipText(redactSensitive(text), 4_000)`。实现为 backfill.js 局部 `collectPriorWindow(events, firstTurn)`，逐字对齐
index.js:309-331（`PRIOR_WINDOW_LIMIT=20`、`PRIOR_ENTRY_MAX_CHARS=4_000`，index.js:80-81）。

> **审计 issue #6（双副本漂移风险）**：`collectPriorWindow` / `joinVisibleText` 复刻自 index.js:309-331，会形成双副本。
> **对策**：两函数体首行加注释 `// 与 lib/index.js:309-331 逐字对齐，改一处需同步另一处` 指回源行号；若后续允许微改
> collector，可将二者提取为 collector.js 导出并复用（届时同步更新 §8 改动清单，把 collector.js 从"不动"移入增量）。

语义：块按 chrono 串行，块 k 的 priorWindow 恰是已补学的 1..k-1 块的尾 20 条 → learner 看到"这些已被早前 pass 挖掘过"，
配合 prompt 的 "Do NOT re-record ... do NOT ... unless the NEW messages contain fresh evidence"（learner.js:32）实现跨块判重。
首块 priorWindow 为空（turn 1 之前无历史）。`buildLearnerInput` 内部再 `slice(-20)` 兜底（learner.js:77），双保险。

---

## 4. 防误学加固

### 4.1 先确认：现有 prompt 已含任务性过滤

`LEARNER_PROMPT`（learner.js:30-41）明确：
- 学习对象限于 "coding style, tooling, workflow, and communication preferences — **not one-off task details**"（learner.js:30）；
- "Only record **clear, repeated, or explicitly-stated** preferences"（learner.js:41）。

"用户让助手执行 backfill"是**一次性任务请求**，不是编码风格/工具链/工作流/沟通偏好，落在 "not one-off task details" 的排除范围。
**结论：prompt 层已能过滤"执行 backfill"这类元请求，无需改 LEARNER_PROMPT（改它会波及正常学习，违背范围纪律）。**

### 4.2 加固：input 构造层的确定性过滤（`isCommandTurn`）

关键事实：斜杠命令不产生 user/message（§0），所以历史上"用户敲过 `/taste backfill`"这类命令调用（log-only、无对应 turn；
`isCommandTurn` 是为防"粘贴/未识别成命令"的纯防御，此处"命令轮"仅为防御性措辞）在 `collectTurnTexts` 下
`userText` 为空 → 天然被跳过（`if (!userText) return;` 语义，同 index.js:492）。这是第一道免费防线。

`isCommandTurn(userText)` 精确规则（backfill.js）：

```js
function isCommandTurn(userText) {
  const t = (userText ?? "").trim();
  if (t.length === 0) return true;             // 空轮（纯命令轮 / 全 plugin snapshot 轮）→ 剔除
  // 审计 issue #5：仅当整段为"单条 /taste 命令形态"（trim 后无换行、无第二行）才剔除；
  // 首行以 /taste 开头但含多行正文的，是正常消息在讨论命令用法，保留并交 prompt 过滤。
  return /^\/taste(?:\s|$)/i.test(t) && !/[\r\n]/.test(t);
}
```

**精确规则（供测试钉死）**：
1. `userText` 空 → 剔除该轮（不进入 NEW）。
2. `userText` trim 后**为单行**且以 `/taste` + 空白/行尾 开头 → 剔除该轮（防御"粘贴/未识别成命令"的 `/taste backfill` 文本）。
   **审计 issue #5 收窄**：仅当整段无换行（单条命令形态）时剔除；首行以 `/taste ` 开头但含第二行的多行消息，是正常讨论
   命令用法，**保留**，交 prompt 过滤，避免误剔同轮夹带的真实偏好。
3. **其余情况保留**——尤其是"请你添加补学命令"这类**自然语言**需求表达：它不含字面 `/taste` 前缀，**不全剔**，
   由 prompt 的 "not one-off task details" 在 LLM 层过滤；同轮共存的真实偏好（如"我喜欢 tab 缩进"）得以保留。

> 为什么"不能全剔"也正确：把"含 backfill 讨论的整轮"全剔，会连带丢弃同轮的编码偏好；而 `/taste` 字面前缀是确定性、
> 无副作用的信号，只剔命令轮、不误伤自然语言需求，正符合需求"给出精确规则"。

### 4.3 为何不会把"backfill 行为"学成偏好（闭环）

- 当前命令文本：log-only，不进 events 的 user/assistant 消息（§0）。
- 历史命令轮：无 user/message → userText 空 → 剔除（4.2 规则 1）。
- 历史自然语言"请你执行 backfill"：保留但被 prompt 的 "not one-off task details" 过滤（4.1）。
- `command/done` 的"已排入 N 块"是命令结果，非 assistant/message（§0），不进 learner 输入。

四道防线各自独立、可单测（§7）。

---

## 5. 并发与时序

### 5.1 与 turn-stopping 共存：共用队列（串行），不互斥

- backfill 块与 turn-stopping job **共用同一个 `queue`**（单并发 promise 链，queue.js:6-7,75-95）。二者任意时刻至多一个 learner 在跑。
- **不互斥**：backfill 期间新轮 turn-stopping 照常 `queue.push`（index.js:493），在 backfill 块之间排队执行，学习不中断。
- **防驱逐（审计 blocker #1）**：共享 cap 3 计数覆盖 backfill + turn-stopping 全部 pending；若块 k 执行期间 turn-stopping 灌满
  pending 3，settle 后盲推块 k+1 会 `shift()` 驱逐最旧常规 job。故驱动**只在队列完全空闲时推下一块**（§5.2 修正后的 waterfall），
  backfill 主动让路、不挤占常规学习。
- **in-flight 判重**：backfill 块走 `executeJob`，其 `sessionId` 在 `agents.create` 前入 `inFlightLearners`、dispose 后移除
  （index.js:462-470）。配合 `isSubagent` 守卫（learner 子会话 origin "subagent" + parentSession，index.js:103-110），
  backfill 的 learner 自身的 turn-stopping 被挡住（不会被它自己再触发学习），注入也被挡（inFlightLearners.has，index.js:412）。

### 5.2 waterfall 背压（解决 cap=3）

后台驱动（index.js 内 `startBackfill`，fire-and-forget）：

```
// 有效块预算（审计 issue #4）：buildBackfillBlocks 按 min(32k, maxInputChars) 切块，避免整块
// 被 runLearner 静默裁到 maxInputChars。在 enqueueBackfill 读热配置时计算并传入，此处仅示意。
// 注：单轮 top 到 20k（8k+12k）时，即便块预算 32k，该轮整体仍会被 runLearner 裁到 16k（既有行为）。
for (block of blocks):
  if teardown.signal.aborted: stop
  if queue.stats().cooldownUntil > Date.now(): stop        // 熔断冷却即停
  // 防驱逐（审计 blocker #1）：等队列完全空闲再推，避免 push 时 pending 满 cap=3 触发 shift()
  // 驱逐常规 turn-stopping job。drain() 等待 running=false 且 pending=0；超时仍 busy 则循环重试，
  // 绝不盲推。检查与 push 同一同步 tick、中间不 await。
  while (queue.stats().running || queue.stats().pending > 0):
    if teardown.signal.aborted: stop
    await queue.drain()
  accepted = queue.push({ agent, newMessages:block.newMessages, priorWindow:block.priorWindow,
                          cwd: agent.session.header?.cwd, kind:"backfill", onSettled: settle })
  if !accepted: stop                                        // push false = 熔断冷却，中止剩余
  await settlePromise                                        // 等本块 learner 彻底 settle（成功或失败）
  backfillProgress.done += 1
```

`executeJob` 增加 `onSettled`（index.js 内，3 行）：

```js
const executeJob = async (job) => {
  const sessionId = randomUUID();
  inFlightLearners.add(sessionId);
  try {
    await runTasteJob(job, sessionId);
    job.onSettled?.();                // 成功
  } catch (error) {
    job.onSettled?.(error);           // 失败：传给驱动做确定性 3 连败计数
    throw error;                      // 仍抛给队列 schedule() 喂共享熔断
  } finally {
    inFlightLearners.delete(sessionId);
  }
};
```

`runTasteJob` 增加对预构建 NEW 的支持（index.js:437-440 处，3 行）：

```js
const newMessages = job.newMessages ?? [
  job.userText ? { role:"user", content:[{type:"text",text:job.userText}] } : null,
  job.assistantText ? { role:"assistant", content:[{type:"text",text:job.assistantText}] } : null,
].filter(Boolean);
```

其余（热读 config → `listTasteFiles` → `renderTasteTree` → `buildLearnerInput` → `runLearner`）原样复用。

### 5.3 进度可见

- 命令返回 `已排入 ${blocks} 块`。
- index.js 维护 `backfillProgress = { active, total, done }`；`/taste status`（commands.js:57-75）追加一行
  `backfill: ${done}/${total} blocks`（active 时）。deps 增注入 `backfillProgress: () => backfillProgress`。
- `backfillProgress.active` 同时是**重入门禁**（审计 blocker #2）：命令入口 `if (backfillProgress.active) → 返回"已在运行中"`，
  阻止运行中再敲 `/taste backfill` 起第二瀑布（§6）。
- 队列 `pending` 只反映"当前 1 个 backfill 块 + 至多 3 个常规 job"，不承担 backfill 总进度；总进度由 `backfillProgress` 表达。

---

## 6. 错误与中断

- **单块失败不中止**：块 k 失败 → `onSettled(error)` → 驱动 `consecutiveFailures++` → push 下一块继续（继承队列"失败不熔断，连败才熔断"）。
- **3 连败中止剩余块**：驱动本地计数 `consecutiveFailures` 与队列 `failCount`（queue.js:84-90）同为 3 连败阈值。
  本地计数由 `onSettled(error)` 确定性驱动，规避"队列 cooldown 在微任务里晚于驱动 push 下一块"的 off-by-one；
  队列侧 `failCount` 照常递增并在 3 连败时 arm cooldown（10min），保护 turn-stopping。
- **熔断冷却期**：命令前置检查直接拒绝；运行中块遇到 cooldown → `push` 返回 false → 驱动停止剩余块并 `logWarn`。
- **teardown**：`teardown.signal.aborted` 时驱动停止；`runTasteJob` 首行已 `if (teardown.signal.aborted) return;`（index.js:427）。
- **重入（审计 blocker #2）**：backfill 运行中（`backfillProgress.active === true`）再敲 `/taste backfill` → 命令立即返回
  `backfill: 已在运行中（${done}/${total} 块），请稍候。`（kind:error），不排队、不起第二瀑布、不覆盖进度单例。`active`
  在驱动启动时置 true、结束时（正常跑完 / 3 连败中止 / 熔断 / teardown）置 false。
- **结果事后看**：命令返回时 learner 还在后台跑；结果落 taste.md，经 `/taste list` 或 taste.md 查看（bridge.js 的 getTree/getStatus 不变）。

---

## 7. 测试设计（test/backfill.test.js 新文件）

风格沿用 `node:test` + `describe/it` + `assert/strict` + 假服务注入（见 test/learner.test.js:6-45、test/index.test.js:72-163）。

### 7.1 纯函数单测（backfill.js，无 IO）

- `parseBackfillArg`：空→n=Infinity；"5"→5；"0"→reject；"-1"→reject（非数字）；"abc"/"1.5"→reject。
- `splitHistoricalTurns`：
  - 多轮（turn/start…turn/end 两轮）→ 按序返回 2 段，每段 events 有界（不含下一 turn/start）。
  - 尾开轮（末段无 turn/end）→ 剔除（只返回已完成轮）。
  - 畸形（null/undefined/非数组/无 turn/start）→ `[]`，不抛。
  - turn 号非有限/缺失 → 跳过该 turn/start。
- `buildBackfillBlocks`：
  - **空历史** → `[]`（对应命令返回"没有可补学的历史轮"）。
  - **多轮合并**：2 小轮 → 1 块，NEW 段含 4 条消息（u,a,u,a）且顺序正确；priorWindow 为空（首块）。
  - **命令轮剔除（含 issue #5 收窄）**：一轮 userText 为单行 `/taste backfill 3` → 该轮不进 NEW；
    一轮 userText 为多行 `/taste backfill 说明\n我喜欢 tab 缩进`（首行 `/taste ` 但含第二行）→ **保留**整轮；
    一轮 userText="请你添加补学命令" → 保留。
  - **有效块预算 min()（issue #4）**：传入 `blockMaxChars=16_000`（模拟 maxInputChars=16k）→ 每块 ≤16k；
    传入 32_000 且无 maxInputChars → 每块 ≤32k；构造单轮 20k 文本 → 不拆、独占一块（单轮不可拆），
    并断言该轮最终仍会被 runLearner 裁到 maxInputChars（既有行为，集成层验证）。
  - **clip 触发**：构造超长轮（user >8k、assistant >12k）→ 断言每轮文本 ≤8k/12k 且含 `[...clipped...]`；redactFn 先于 clip（token 变 [REDACTED]）。
  - **分块边界**：`blockMaxChars` 小值（如 100）→ 每块 ≤ 预算；`blockMaxTurns` 触发分块；"先到为准"（字符先到或轮数先到）。
  - **n 语义**：n=1 → 只取最近 1 轮；n 超过轮数 → 全部；n=Infinity → 全部。
  - **priorWindow 最近 ≤20（含跨块判重，审计 §1.8 缺口④）**：构造 >20 条历史 → 每块 priorWindow ≤20 且为块首轮之前的尾 20 条；
    多块场景断言块 k 的 priorWindow 恰为已学 1..k-1 块的尾 20 条（供跨块判重）；每条 ≤4000 字符。

### 7.2 集成单测（fake ctx/queue/agents，仿 index.test.js setup）

- **runLearner 调用次数与 input 形状**：fake agents 记录 `create`/`followup`，fake queue（或真实 createJobQueue + fake executeJob）。
  - 3 块 → `create` 恰 3 次（串行）；每次 `followup` 内容含 "NEW messages to analyze" 且含该块轮文本；
    `meta.parentSession` = 主会话 id、`meta.origin="subagent"`。
  - 每块 `sessionId` 唯一且曾入 in-flight Set（仿 index.test.js:344-389 的 gate 手法）。
- **防误学端到端**：历史含 1 个纯命令轮 + 1 个自然语言轮 → followup 不含命令轮文本、含自然语言轮文本。
- **3 连败中止**：fake executeJob 前 3 块 reject → 断言第 4 块未被 push、`backfillProgress.active=false`、队列 `failCount≥3`。
- **防驱逐（blocker #1）**：backfill 块 k 执行期间（gate 挂起）连续注入 turn-stopping job 把 pending 灌到 cap 3，
  放行块 k 后断言驱动**不盲推**块 k+1（`queue.stats().pending>0 || running` 时推入被延迟），常规 job 依次执行、
  无一被 `shift()` 驱逐；队列完全空闲后块 k+1 才被 push。
- **重入（blocker #2）**：`backfillProgress.active=true` 期间再调 backfill 命令 → 返回"已在运行中（done/total）"、
  不起第二瀑布（fake executeJob 调用次数不翻倍）、`backfillProgress.total` 不被覆盖。
- **命令返回即时**：backfill handler resolve 时 `backfillProgress.total>0` 且 learner 尚未完成（gate 未放行）。

---

## 8. 改动清单（逐文件 + 行数预估）

| 文件 | 改动 | 预估行数 |
|---|---|---|
| `lib/backfill.js`（新） | `parseBackfillArg` / `splitHistoricalTurns` / `buildBackfillBlocks` / `isCommandTurn` / `joinVisibleText` / `collectPriorWindow` + 常量 + jsdoc | ~200 |
| `lib/commands.js`（增量） | import `parseBackfillArg`；`backfill` handler；dispatch case；USAGE 增 `backfill`；`showStatus` 增 backfill 行；deps 文档 | ~35 |
| `lib/index.js`（增量） | import backfill.js；`enqueueBackfill`+`startBackfill` 驱动；`runTasteJob` 支持 `job.newMessages`；`executeJob` 支持 `job.onSettled(err?)`；`backfillProgress` 状态 + `deferred` 助手；deps 注入 `enqueueBackfill`/`backfillProgress` | ~85 |
| `test/backfill.test.js`（新） | §7 两节 | ~240 |

**不动**：collector.js、storage.js、learner.js、learner-tools.js、queue.js、config.js、bridge.js、所有现有 8 命令行为、学习钩子契约、现有 6 个测试文件。

---

## 9. 风险表

| 风险 | 评估与对策 |
|---|---|
| **成本** | 每次块 = 1 次 `runLearner`（learner 子代理）。模型调用：**典型 1~3 次/块**（答 "no changes" 1 次，或 read+write+reply 约 3 次）；**上界 = 块数 × `observer.maxTurns`（=20，config.js:32）**——"~19~57 次"只是典型区间，**真实上界为 19×20=380 次**（审计 issue #3）。本会话 19 轮：典型小轮（~1-2k）按 `blockMaxTurns=4` 先到 → **~5 块**（ceil(19/4)）；"2~4 块"仅在大量空/命令轮被过滤后才成立（审计 issue #7）。最坏（每轮顶满 20k，380k 字符）→ ~19 块。模型由 `observer.modelMode` 决定（inherit 默认=主模型；custom=observer.provider/model，如 v4-pro，learner.js:139-149）。串行 + 熔断已把并发封顶为 1；backfill 仅在队列空闲时前进（§5.2），成本不与常规学习叠加。 |
| **重复学习（跨块判重）** | 三重保证：(1) 块串行，`runTasteJob` 每块热读 `listTasteFiles`+`renderTasteTree`（index.js:433-445）→ 第 k 块 tasteTree 反映前 k-1 块写入；(2) prompt "Do NOT re-record a preference that already exists"（learner.js:32）；(3) learner-tools `write_taste_file` read-merge-write 保留磁盘既有条目（learner-tools.js:57-68,88-117）。 |
| **输入预算冲突** | `runLearner` 对**整条输入** clip 到 `observer.maxInputChars`（默认 16_000，learner.js:153-154、config.js:30），而块预算标称 32_000。**设计对策**：驱动热读配置，把有效块预算设为 `min(32_000, observer.maxInputChars)`（不可用时回落 32_000），注入 `buildBackfillBlocks({ blockMaxChars })`，避免整块被静默裁掉（审计 issue #4 已把注入点显式标入 §1/§5.2）。**注**：单轮文本 top 到 20k（8k+12k）时，即便块预算 32k，该轮整体仍会被 runLearner 裁到 16k——这是既有 maxInputChars 行为，backfill 不绕过、不扩大（§7.1 补测试）。若想用满 32k，须自行把 `observer.maxInputChars` 调到 ≥32k（bounds 上限 100_000，config.js:17）。 |
| **大会话内存** | `session.events` 已在内存（实时会话），`splitHistoricalTurns` 的 `slice()` 产生临时拷贝，块构建后即释放；块内文本已 clip。19 轮规模可忽略；超大会话（数百轮）才需考虑流式/分页，当前不做。 |
| **n 语义歧义** | "此前 n 轮"=**最近 n 个已完成轮**（`slice(-n)`，chrono 序）。可能被误解为"最早 n 轮"。以文案 "已排入 N 块（n 轮）" 显式回显 + 文档 + 单测钉死。 |
| **waterfall 微任务时序** | 见 §6：驱动用 `onSettled(error)` 的本地 3 连败计数做确定性中止，不依赖队列 cooldown 的微任务落定时刻，消除 off-by-one。 |
| **backfill 挤占常规学习（驱逐）** | 已修正（审计 blocker #1）：驱动仅在队列完全空闲（`running=false && pending=0`，经 `queue.drain()` + 同步复查）时推下一块，push 时 pending 为 0，永不触发 cap=3 的 `shift()` 驱逐常规 job。代价：对话密集时 backfill 主动让路、进度放缓（可接受）。 |
| **backfill 重入** | 已修正（审计 blocker #2）：命令入口以 `backfillProgress.active` 幂等门禁，运行中再敲 `/taste backfill` 直接返回"已在运行中（done/total）"，不启第二瀑布、不覆盖进度单例、不加剧驱逐（§6 定义语义、§7.2 补测试）。 |
| **backfill 期间学习被 on/off 切换** | `runTasteJob` 每块热读 config（index.js:429-430），中途 `off` → 该块静默跳过（返回不抛）。驱动仍 `done+=1` 计数，属无害偏差，记入注释。 |

---

## 附：关键文件:行号索引（供审计核对）

- learner.js：30（prompt 任务过滤）/ 32（判重） / 41（"clear, repeated"） / 75-86（buildLearnerInput）/ 113-215（runLearner）/ 153-154（maxInputChars clip）/ 17+77（PRIOR_WINDOW_LIMIT=20）。
- commands.js：24（invocation.agent.session.header.cwd）/ 57-75（showStatus）/ 214（USAGE）/ 223-243（dispatch）/ 258-266（registerTasteCommands deps）/ 262（recordInput:false）。
- index.js：76-81（turn/prior 预算常量）/ 103-110（isSubagent）/ 309-331（collectPriorWindow）/ 397（inFlightLearners）/ 412（注入 in-flight 守卫）/ 426-459（runTasteJob）/ 462-470（executeJob）/ 472（createJobQueue cap 3）/ 477-503（turn-stopping 钩子）/ 505-514（deps 注入）。
- collector.js：24-26（isLearnableUserEvent）/ 45-51（collectTurnTexts）/ 54-61（turnSlice）/ 102-123（clipText）。
- storage.js：252-257（redactSensitive）/ 267-276（clipText）。
- queue.js：44-149（createJobQueue）/ 53-54（cap/failLimit 默认）/ 75-95（schedule 链）/ 84-90（连败计数+cooldown）/ 103-112（push 熔断丢 job）。
- learner-tools.js：57-68（mergeTasteEntries）/ 88-117（executeWrite read-merge-write）。
- config.js：17（bounds 上限）/ 30（observer.maxInputChars=16_000）。
- 宿主 dsh-commands：lib/types/index.d.ts:16-33（CommandInvocation）；lib/index.js:300-372（命令 log-only、recordInput）。

---

## 修订记录

> 依据 `/home/CNS2026495165/dsh/pi-taste-analysis/backfill-review.md`（裁决 needs-revision，2 blocker + 5 非 blocker）逐条修订。
> 只改被点名问题，不动其余内容；行号索引（§附）不变。

| 审计 issue | 修订内容 | 落点 |
|---|---|---|
| **#1（blocker）cap=3 驱逐常规学习** | 撤销"cap 永不触顶"绝对断言；§2/§5.1 新增驱逐机制说明；§5.2 waterfall 改为"推下一块前等队列完全空闲（`running=false && pending=0`，经 `queue.drain()` + 同步复查，检查与 push 同 tick）"；§9 新增风险行；§7.2 新增防驱逐用例 | §2 / §5.1 / §5.2 / §9 / §7.2 |
| **#2（blocker）重入缺失** | 命令入口以 `backfillProgress.active` 幂等门禁，运行中再敲返回"已在运行中（done/total）"；§6 定义语义、§5.3/§9 标注、§7.2 新增重入用例 | §5.3 / §6 / §9 / §7.2 |
| **#3 最坏成本低估** | §9 成本口径改为"典型 1~3 次/块、上界 = 块数 × maxTurns（19×20=380）" | §9 |
| **#4 默认有效预算 16k 非 32k** | §1/§3.3/§5.2 显式标注注入点 `min(32_000, observer.maxInputChars ?? 32_000)` 与默认值；§9 补"单轮>16k 仍被 runLearner 裁剪"；§7.1 补 min() 用例 | §1 / §3.3 / §5.2 / §9 / §7.1 |
| **#5 isCommandTurn 首行误剔** | 规则 2 收窄为"仅整段无换行（单条命令形态）才剔除，多行保留交 prompt"；§7.1 补多行用例 | §4.2 / §7.1 |
| **#6 collectPriorWindow 双副本漂移** | §3.4 增加注释指向 index.js:309-331 源行号 + 提取 collector 导出的评估路径 | §3.4 |
| **#7 块数估算口径不一** | §9 统一为"典型小轮按 blockMaxTurns=4 → ~5 块（ceil(19/4)）；2~4 块仅在大量空/命令轮被过滤后成立" | §9 |
| （§1.9 措辞微瑕）"命令轮"自相矛盾 | §4.2 加"无对应 turn、纯防御性措辞"澄清 | §4.2 |

修订后仍满足范围纪律：只加 backfill 子命令与支撑模块，不动现有 8 命令行为、不动学习钩子契约、不做跨会话回溯。
