# /taste backfill 补学命令 — 设计审计报告

> 审计对象：`/home/CNS2026495165/dsh/pi-taste-analysis/backfill-design.md`
> 审计人结论：**needs-revision**（2 个 blocker + 7 个非 blocker issue）
> 基线：`cd /home/CNS2026495165/dsh/dsh-taste && node --test "test/*.test.js"` → **# pass 126 / # fail 0**（亲跑确认）

---

## 0. 基线

`node --test "test/*.test.js"` 实测 `# tests 126 / # pass 126 / # fail 0 / # suites 29`，与设计 §0 声称一致。设计自述的 126 绿起点成立。

---

## 1. 逐项验证结论

### 1.1 复用面真实性 —— **通过**

设计引用的每一个签名均与源码逐字核对，无一处虚构：

| 设计引用 | 源码实况 | 判定 |
|---|---|---|
| `runLearner({agents, parentAgent, input, config, resolveGlobalDir, resolveProjectDir, signal, sessionId})` | learner.js:113-122，`sessionId = randomUUID()` 默认 | ✅ |
| `buildLearnerInput({tasteTree, newMessages, priorWindow}={})` | learner.js:75 | ✅ |
| `collectTurnTexts(events, turn, {userMaxChars, assistantMaxChars, redactFn})` | collector.js:45-51 | ✅ |
| `isLearnableUserEvent` = `type==="user/message" && source.kind!=="plugin"` | collector.js:24-26 | ✅ |
| `listTasteFiles(scopeDir)` → `Promise<string[]>` | storage.js:202 | ✅ |
| `createJobQueue({cap, runJob, log})` 默认 cap=3 | queue.js:44 / queue.js:15 | ✅ |
| `clipText`（storage，无换行 marker）/ collector 内联 `clipText`（带 `\n` marker） | storage.js:267 / collector.js:116 | ✅（两处实现不同但语义一致，与既有用法一致） |
| `redactSensitive` | storage.js:252 | ✅ |

**宿主事实（均已到 `~/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-commands` 取证）**：
- `CommandInvocation = {commandId, agent, rawInput, attachments, signal}` — types/index.d.ts:16-33 ✅。
- 命令 log-only、无 turn 包裹：`execute()` 里 `appendLifecycle(session,"command/run",…)` + `"command/done"`（index.js:307/314/396），事件类型是 `command/run`/`command/done`，**不是** `user/message`/`assistant/message` → `collectTurnTexts` 天然读不到命令文本 ✅。
- `recordInput:false` → `command/run` 不带 `args`（index.js:310）✅。
- `invocation.agent.session.events` 即会话事件数组：commands.js:24 已用 `invocation.agent.session.header.cwd`，index.js:487 用 `agent.session.events`，二者同源 ✅。

设计 §附 的行号索引绝大部分精确，仅个别 ±1~2 行（collector.js "102-123(clipText)" 实为 108-123、queue.js "53-54(cap/failLimit)" 实为 15/18 常量），**不影响决策**。

### 1.2 抉择论证（排队列 vs 内联）—— **有结构性坑（见 blocker #1）**

选"共享队列 + waterfall 背压"的方向正确（单并发/熔断/in-flight 全继承、避免双 learner 并发、命令立即返回）。但 **waterfall 的 cap=3 论证有一个未被识别的洞**：

- 设计断言（§2/§5.1）："一次只 push 1 块 → pending 恒 ≤1 个 backfill 块 → **cap 永不触顶**"、"backfill 期间新轮 turn-stopping 照常 push，**学习不中断**"。
- 实际：`queue.push()` 的 cap=3 是对**整个队列**（backfill + turn-stopping 共用）计数的（queue.js:108-110 `while (pending.length > limit) pending.shift()`）。当 backfill 块 k 正在执行（占 `running`，不在 pending），用户同时继续对话，turn-stopping 可把 pending 推到 3。块 k settle 后驱动 `queue.push(块 k+1)`，此刻 pending 满 3 → `shift()` **驱逐最旧的一条 turn-stopping job**，静默丢真实学习。
- 时序上这是确定的：`executeJob` 里 `job.onSettled()` 在 `await runTasteJob()` resolve 后、`finally` 之前同步触发（设计 §5.2 的 executeJob 改写），resolve 驱动 `settlePromise` 使瀑布续体作为微任务先于队列 `running=false; schedule()`（queue.js:91-93 的 `.then`）执行——推块 k+1 时 `running` 仍为 true、pending 仍满，驱逐必然发生。
- 结论：waterfall 只消除了"backfill 自身把 backfill 挤掉"，**没有消除"backfill 挤掉常规学习"**。这正是任务质询的"backfill 排队会不会饿死常规学习？"——会，且设计未论证、未测试。

### 1.3 分块正确性 —— **通过**

- **轮边界语义与 collector 一致**：`splitHistoricalTurns` 按 `turn/start` 下标切成 `[startIdx, nextStartIdx)` 有界段，再逐段喂 `collectTurnTexts(slice, turn, opts)`；collector 内部 `turnSlice` 从段尾回找首个 `turn/start` 得 `slice.slice(1)`，恰好拿到本轮消息，不吞下一轮（下一 `turn/start` 已被排除在段外）。✅ 追踪无误。
- **只保留已完成轮**：切片内含 `turn/end` 才保留，尾开轮（无 turn/end）剔除，正确避免与 turn-stopping 钩子重复学习。✅
- **clip 预算数学**：每轮 `user ≤8k` / `assistant ≤12k`（collector.js finishText 先 redact 后 clip，与 index.js:76-77 的 8k/12k 一致）；块预算 `blockMaxChars=32_000`、`blockMaxTurns=4` 先到为准；单轮不可拆（"当前块已非空"条件保证超预算轮独占一块）。✅ 自洽。
- **priorWindow 语义不漂移**：块 k 的 priorWindow = 块首轮 `turn/start` 之前的最后 ≤20 条可见消息，每条 ≤4000 字符，与 index.js:309-331 `collectPriorWindow` 语义逐字对齐（backfill.js 局部复刻）。首块为空。✅
- 附注：**默认有效块预算其实是 16k 而非 32k**（见 issue #4），但这属 §9 已自认的预算冲突，非分块算法错误。

### 1.4 防误学规则 —— **基本成立，一处误剔边角（issue #5）**

- 四道防线（命令 log-only / 命令轮 userText 空 / prompt "not one-off task details" / `command/done` 非 assistant 消息）各自独立、已宿主取证，闭环成立。✅
- `isCommandTurn` 规则 1（空 userText）与规则 2（`/^\s*\/taste(?:\s|$)/i`）可执行、可单测。✅
- **误剔边角**：规则 2 用 `userText` 的**首行**前缀判断（`userText` 是 join 后的整段），若用户正常消息第一行恰以 `/taste ` 开头（如讨论该命令用法），整轮连同后续真实偏好一起被剔。设计 §4.2 规则 3 已意识到"不能全剔"，但正则粒度仍可能误伤多行消息中夹带的真实偏好。属低频但真实，任务点名"会不会误剔真实偏好表达"，需修订（见 issue #5）。

### 1.5 重复学习防护 —— **可靠**

三重保证成立：(1) 块串行 + `runTasteJob` 每块热读 `listTasteFiles`+`renderTasteTree` → 块 k 读到前 k-1 块已写盘（块 k-1 的 learner 在 `whenIdle()` 返回、`runLearner` 返回、`onSettled` 触发后才放行块 k，写入已 flush，无 fs 时序洞）；(2) prompt "Do NOT re-record"；(3) `write_taste_file` read-merge-write 保既有条目（learner-tools.js:57-68,88-117）。✅
- 澄清一处措辞（非洞）：`renderTasteTree` 只渲染**文件路径 + 条目计数**（index.js:269-291 `renderScopeTree` 的 suffix 是 `.length` 计数），不含偏好**语句**本体。语句级判重实际靠 learner 用 `read_taste_file` 读文件 + write-merge + prompt，这是既有 turn-stopping 同款机制、被 backfill 原样继承，**可靠**，但设计 §9 第 (1) 条"tasteTree 反映写入"应表述为"反映文件集与计数"，以免读者误以为 tree 内已含语句。

### 1.6 防递归 / 防重入 —— **防递归成立，防重入缺失（blocker #2）**

- 防递归：backfill 块走 `executeJob`，`sessionId` 在 `agents.create` 前入 `inFlightLearners`（设计 §5.2 executeJob 改写与 index.js:462-470 一致）；learner 子会话 origin="subagent"+parentSession → `isSubagent` 挡住其 turn-stopping，`inFlightLearners.has` 挡住注入。✅ 已由 index.test.js:344-389 的 gate 手法钉死该时序，backfill 块继承。✅
- **防重入：设计通篇未回答"用户在 backfill 执行中再敲 `/taste backfill` 会怎样"**。现状推演：命令 fire-and-forget 起第二个 `startBackfill` 瀑布 → 两个驱动各推 1 块 → 队列里同时有 2 个 backfill 块（违反 §2 "pending 恒 ≤1 backfill 块"）+ 成本翻倍 + `backfillProgress`（单例 `{active,total,done}`）被两个驱动互相覆盖 → 进度显示错乱，并进一步加剧 blocker #1 的驱逐。§5.3 的 `backfillProgress.active` 字段存在却从未用于命令入口的门禁。**必须补充幂等/拒绝/排队语义**。

### 1.7 成本上界 —— **公式成立但最坏场景被低估（issue #3）**

- 公式：块数 ≈ `ceil(total_chars / min(32_000, observer.maxInputChars))`（默认 16k），单轮不可拆为下限；每块 = 1 次 `runLearner`（1 个 learner 子代理）= 1~`observer.maxTurns`(=20) 次模型调用；串行 + 熔断把并发封顶为 1。✅
- **问题**：§9 把"最坏（19 轮顶满）→ ~19 块 → ~19~57 次调用"里的"57"当成了上界。真实上界是 `块数 × maxTurns = 19 × 20 = 380` 次调用（同一段首句自己写了"上限 observer.maxTurns=20"却未乘进去）。"~19~57"是 1~3 次模型调用的**典型区间**，不是最坏。成本上界被少算约一个数量级，需修订核算口径。

### 1.8 测试清单充分性 —— **挡不住两个 blocker（见 blocker #1/#2）**

§7 纯函数单测（parseBackfillArg / splitHistoricalTurns / buildBackfillBlocks 的空历史、多轮合并、命令轮剔除、clip、分块边界、n 语义、priorWindow≤20）覆盖面良好，能钉死分块与防误学规则。

**缺口**：
1. 无"backfill 执行中 + turn-stopping 并发灌满 cap=3 → 下一 backfill 块驱逐常规 job"的用例 → 挡不住 blocker #1。
2. 无"二次 `/taste backfill`（重入）"用例 → 挡不住 blocker #2。
3. 无"有效块预算 = min(32k, maxInputChars)"的用例（§9 风险的 min() 逻辑未被任何测试触及）。
4. §7.1 的 `buildBackfillBlocks` 测试只验证 priorWindow ≤20/≤4000，未验证"块 k 的 priorWindow 恰为前 k-1 块的尾 20 条"这一跨块判重语义。

### 1.9 范围纪律 —— **通过（一处措辞微瑕）**

- 只新增 lib/backfill.js + commands.js/index.js 增量 + test/backfill.test.js；collector/storage/learner/learner-tools/queue/config/bridge 全不动；8 命令行为不动；学习钩子契约不动；不做跨会话。✅
- `executeJob` 加 `onSettled`、`runTasteJob` 加 `job.newMessages ??` 均为向后兼容（turn-stopping job 不设 onSettled/newMessages → 走原路径）。✅
- `/taste status` 追加一行 backfill 进度、USAGE 增 `backfill` 属任务第 4 条明确要求，不视为越界。✅
- 微瑕：§4.2 用"命令轮"措辞，与 §0"命令不产生 turn"表述自相矛盾（实际无"命令轮"存在，`isCommandTurn` 是纯防御）。叙述性，无功能影响。

---

## 2. Issues 汇总

| # | severity | file | problem | fix（修订指令） |
|---|---|---|---|---|
| 1 | **blocker** | lib/index.js（startBackfill 驱动） | cap=3 驱逐：backfill 块 k 执行期间 turn-stopping 灌满 pending，settle 后推块 k+1 时 `shift()` 驱逐最旧常规 job，静默丢学习，与 §5.1"学习不中断"矛盾 | 推下一块前等队列**完全空闲**（`queue.stats().running===false && queue.stats().pending===0` 再 push，同步检查+push 同一 tick 无竞态）；或把 backfill 块经独立小队列串到共享队列；并在 §2 撤销"cap 永不触顶"的绝对断言 |
| 2 | **blocker** | lib/commands.js + lib/index.js | 防重入缺失：backfill 进行中再敲 `/taste backfill` → 双瀑布、成本翻倍、`backfillProgress` 单例被覆盖、加剧驱逐 | 命令入口用 `backfillProgress.active`（或 per-session in-flight 标志）做幂等门禁：运行中返回"backfill 已在运行中（done/total）"或拒绝；定义并测试重入语义 |
| 3 | medium | backfill-design.md §9 | 最坏成本被低估：~57 次调用实为典型值，真实上界 `块数 × maxTurns`（19×20=380） | 修订 §9 核算口径：区分"典型 1~3 模型调用"与"上界 maxTurns=20"，写出 `blocks × maxTurns` 最坏公式 |
| 4 | medium | backfill-design.md §1/§3/§9 + lib/index.js | 默认有效块预算 16k 而非需求 32k（`min(32k, maxInputChars=16k)`），且 §1/§5 伪代码未标出 min() 落点；单轮顶满 20k 仍被 runLearner 静默裁到 16k | 在 §1 数据流/§5.2 伪代码显式写出"有效预算 = min(32k, observer.maxInputChars)"的注入点与默认值；注明单轮>16k 时仍会被 runLearner 裁剪（既有行为），补对应测试 |
| 5 | low-medium | lib/backfill.js（isCommandTurn） | 规则 2 按首行 `/taste` 前缀剔整轮，可能误剔首行以 `/taste ` 开头的正常多行消息中的真实偏好 | 收窄：仅当 `userText` 整段为单条 `/taste …` 命令形态（trim 后无换行/无第二行）时剔除；多行消息保留，交 prompt 过滤 |
| 6 | low | lib/backfill.js | `collectPriorWindow` 复刻 index.js:309-331，双副本漂移风险（collector.js 因范围纪律不动） | 至少加注释指向 index.js 源行号；或评估将 `collectPriorWindow`/`joinVisibleText` 提取为 collector.js 导出的最小改动（需同步更新 §8 改动清单） |
| 7 | low | backfill-design.md §9/§3.3 | "典型 19 轮 → 2~4 块"与 blockMaxTurns=4 的 `ceil(19/4)=5` 不符（默认 16k 下小轮按轮数先到） | 统一估算口径：典型小轮按 blockMaxTurns=4 → ~5 块；2~4 块仅在大量空/命令轮被过滤后成立，注明前提 |

---

## 3. blocker 判定

- **复用签名不实**：无（全部逐字一致）→ 不构成 blocker。
- **抉择有结构性坑**：**构成** —— cap=3 驱逐常规学习（issue #1）。
- **分块/防重复有洞**：无（分块与跨块判重均可靠）→ 不构成 blocker。
- **测试挡不住核心风险**：**构成** —— §7 无用例能捕获 issue #1 与重入（issue #2）。

**最终裁决：needs-revision。blocker 数 = 2。** 修订 issue #1/#2 并补对应测试后，其余 5 项为建议性修订，不阻断实现。

---

# 复验结论（第二轮，对象 = 修订后 backfill-design.md）

> 复验人：审计员（同会话，deepseek-v4-pro 路由）。
> 基线复跑：`cd /home/CNS2026495165/dsh/dsh-taste && node --test "test/*.test.js"` → **# pass 126 / # fail 0**，与设计 §0 声称一致。

## 1. 逐条复查（2 blocker + 5 非 blocker 修订是否到位）

| issue | 修订落点 | 复验判定 |
|---|---|---|
| **#1（blocker）cap=3 驱逐** | §2/§5.1/§5.2/§9/§7.2 | **已修复**。`queue.stats()` 确返回 `{pending, failCount, cooldownUntil, running}`（queue.js:144-146），`queue.drain()` 确存在且等到 `running=false && pending===0`（queue.js:120-138，30s 预算、超时返回后由驱动 while 循环重进，连续忙时正确循环等待）。"检查与 push 同一同步 tick、中间不 await"成立：`stats()` 与 `push()` 皆同步、二者间无 `await`，单线程无微任务可插入 → push 时 pending=0，永不触发 cap=3 的 `shift()` 驱逐（queue.js:108-110）。撤销"cap 永不触顶"绝对断言、改为"仅队列空闲时前进"的表述与代码路径一致。✅ |
| **#2（blocker）重入缺失** | §5.3/§6/§9/§7.2 | **已修复**。`backfillProgress.active` 幂等门禁语义明确（运行中返回"已在运行中（done/total）"、不启第二瀑布、不覆盖单例），§7.2 补重入用例。✅ |
| **#3 最坏成本低估** | §9 | **已修复**。口径改为"典型 1~3 次/块、上界 = 块数 × maxTurns=20 → 19×20=380"，与 learner.js:153-154（整输入 clip 到 maxInputChars）、config.js:32（maxTurns=20）一致。✅ |
| **#4 默认有效预算 16k** | §1/§3.3/§5.2/§9/§7.1 | **已修复**。注入点显式写为 `min(32_000, observer.maxInputChars ?? 32_000)`；config.js:30 确认 `observer.maxInputChars` 默认 16_000、bounds 上限 100_000；"单轮>16k 仍被 runLearner 裁到 16k"与 learner.js:153-154 一致。✅ |
| **#5 isCommandTurn 首行误剔** | §4.2/§7.1 | **已修复**。规则 2 收窄为 `整段无换行（单条命令形态）才剔除`，正则 `return /^\/taste(?:\s|$)/i.test(t) && !/[\r\n]/.test(t)` 精确（多行消息 `![\r\n]` 失败 → 保留）。✅ |
| **#6 collectPriorWindow 双副本漂移** | §3.4 | **已修复**。注释指回 index.js:309-331 源行号 + 提取 collector 导出的评估路径。✅ |
| **#7 块数估算口径** | §9 | **已修复**。统一为"典型小轮按 blockMaxTurns=4 → ~5 块（ceil(19/4)）"，注明"2~4 块仅在大量空/命令轮被过滤后成立"。✅ |

**§6 的 off-by-one 论证经独立复核确认为真且修复正确**：`executeJob` catch 内 `onSettled(error)`（驱动本地 `consecutiveFailures++`）在 `throw error` 之前**同步**执行，而队列 `schedule()` 的 `failCount++`/`cooldownUntil=…` 在 `throw` 经 promise 链的**后续微任务**才落定（queue.js:84-88）。故驱动若在 `await settlePromise` 后读 `queue.stats().failCount/cooldownUntil` 会晚一拍、可能多推一块；本地计数确定性中止是正确的修法。

## 2. 新问题扫描（本轮新增，均非 blocker）

1. **`backfillProgress` 是插件级单例，非 per-session**：与现有全局 `queue`/`inFlightLearners`（index.js:472/397）一致，故 backfill 实为**进程级 single-flight**——A 会话补学中，B 会话敲 `/taste backfill` 会被"已在运行中"拒绝，`/taste status` 对全进程显示同一进度。这与需求"只当前会话"（数据源单会话）不冲突，且对成本可控是合理的；但设计未显式点破"全局单例"这一语义，建议 §5.3/§6 加一句注记，避免实现者误以为 per-session。
2. **`enqueueBackfill` 的配置读取与"立即返回"**：块数须在命令返回前算出，而有效预算需 `observer.maxInputChars`。设计 §1/§5.2 说"驱动热读 config 注入"但未定同步（`currentConfig()` 缓存）还是异步（`await loadConfig()`）。二者皆可行（一次 config 读仍是"立即返回"），属实现细节，但应在实现时固定一处。
3. **重入门禁的异步竞态窗口**：`backfillProgress.active = true` 必须在 `enqueueBackfill` 内**首个 await 之前**同步置位，否则并发命令调用间存在微任务窗口使门禁失效。§6 已暗示"驱动启动时置 true"，建议实现注释明确"首行同步置 active、再 await"。
4. **§3.4 "首块 priorWindow 为空"仅对默认全量成立**：`n` 受限时首块起点非 turn 1，其 priorWindow 非空（为块首轮之前的 ≤20 条上下文）。§3.4 一般规则已正确（"块首轮 turn/start 之前"），只是"首块为空"的括注仅在 turn 1 起始时成立，属措辞精度，无功能影响。
5. **§9 点 (1) "tasteTree 反映写入"应读作"反映文件集与计数"**：`renderScopeTree` 的 suffix 是条目**计数**（index.js:276），不含语句本体；语句级判重实际靠 prompt + `read_taste_file` + `write_taste_file` read-merge-write（learner-tools.js:97-117）承接，属继承既有可靠机制。此点首轮 §1.5 已澄清，修订版 §9 措辞未同步，仍为非洞的表述精度问题。

## 3. 范围纪律复查

改动清单仍限定 lib/backfill.js（新）+ lib/commands.js / lib/index.js 增量 + test/backfill.test.js；collector/storage/learner/learner-tools/queue/config/bridge 不动；8 命令行为不动；学习钩子契约不动；不做跨会话回溯（数据源仍是 `invocation.agent.session.events` 单会话）。`executeJob` 加 `onSettled`、`runTasteJob` 加 `job.newMessages ??` 均向后兼容（turn-stopping job 不设二者 → 原路径，index.js:462-470/437-440 实读确认）。✅

## 4. 最终裁决

**approve。blocker 数 = 0。** 两个 blocker 与五个非 blocker 均已被正确、可执行地修订，且本轮独立复核了关键时序论证（cap=3 驱逐、off-by-one、防递归/in-flight）无新洞。第 2 节列出的 5 点为非阻断性实现注记，建议随实现顺带落到代码注释，不阻断开写。
