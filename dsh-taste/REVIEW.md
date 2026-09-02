# dsh-taste 独立终审报告（新一轮终审）

> 结论：**PASS（无 blocker）**。测试 106/106 绿，导入冒烟正确，R0-R9 必修项全部通过，递归防护完整有效。
> 审阅者：独立终审子代理（不信任任何转述，全部亲跑亲读实现源码与 DSH 母本源码）。

---

## 0. 亲跑验证（第一步）

| 项 | 命令/方式 | 结果 |
|---|---|---|
| 测试套件 | `cd dsh-taste && node --test "test/*.test.js"` | **106/106 pass / 0 fail / 0 skip**（suites 22） |
| 导入冒烟 | `node -e "import('.../lib/index.js').then(m => console.log(m.inject.join(',')))"` | 输出 `agents,commands,systemPrompt`，导入链路（含全部跨模块 import）无异常 |

---

## 1. R0-R9 逐项结论（第二步）

### R0 — inject 精确声明 ✅ PASS
- `lib/index.js:46`：`const inject = ["agents", "commands", "systemPrompt"];`
- 与契约完全一致；冒烟输出 `m.inject.join(',')` 为 `agents,commands,systemPrompt`。
- 索引单元测试 `test/index.test.js:153-163` 用 `assert.deepEqual(inject, [...])` 钉死。

### R1 — turn-stopping 整体 try/catch + 畸形事件单测 ✅ PASS
- `lib/index.js:471-497`：handler **整体**（含 `payload ?? {}` 解构）包在 try/catch，任何 throw 只 `logWarn` 后返回，绝不毒化用户 turn。
- 畸形事件单测真实存在：`test/index.test.js:302-328` 遍历 12 种畸形 payload（undefined/null/{}/{agent:null}/events 非数组/含 null、7、非对象块等）并 `assert.doesNotThrow`，另用 throwing getter 验证 catch 路径落到 `warnings`。
- collector 层同样不抛：`test/collector.test.js:85-106`。

### R2 — 队列 cap=3 丢最旧 / 3 连败熔断 10min / status 可见 ✅ PASS
- `lib/queue.js:15` `DEFAULT_CAP=3`；`:18` `DEFAULT_FAIL_LIMIT=3`；`:21` `DEFAULT_COOLDOWN_MS=10*60_000`。
- 丢最旧保最新：`queue.js:108-111` `push` 后 `while (pending.length > limit) pending.shift()`。
- 熔断：`queue.js:84-87` 失败计数 +1、`>=budget` 时 `cooldownUntil = Date.now()+cooldown`；冷却中 `push` 直接丢（`:104-107`）。
- status 可见：`commands.js:58-75` `showStatus` 输出 `queue:`（pending/failCount）与 `breaker:`（冷却剩余分钟）。
- 单测：`test/queue.test.js:43-96`（丢最旧、三连败熔断、冷却期丢弃、过期恢复）。

### R3 — create 传 signal / finally dispose / drain 落败 catch ✅ PASS
- signal：`index.js:450` 传 `signal: teardown.signal` → `learner.js:144-152` 与 timeout 融合成 `runSignal` → `learner.js:160` `agents.create({ signal: runSignal, ... })`。
  - `teardown` 是插件自身 `AbortController`（`index.js:349`），经 `ctx.effect(() => () => teardown.abort(...))`（`:521`）在 unload 时确定性取消，语义等价于"插件 ctx signal"。
- dispose：`learner.js:175-181` `finally { await handle?.dispose?.() }` 且 dispose 失败自身被 catch（`:178-180`）。
- drain 落败 catch：`index.js:515-517` `queue.drain().catch(logWarn)`；`queue.js:120-138` `drain()` 自身永不 reject（timeout 落败分支也 resolve）。
- shutdown 顺序正确：effect 反序执行 → 先 `teardown.abort`（取消 in-flight learner）再 `drain`（`index.js:510-521` 注释 + 测试 `index.test.js:127-136` 反序 dispose 镜像）。
- 单测：`test/learner.test.js:126-141`（signal 透传/融合）、`:144-170`（dispose 成功/失败/无 handle）。

### R4 — write 锁内读-改-写合并 / edit 锁内替换 ✅ PASS
- write：`learner-tools.js:88-122` `executeWrite` 在 `withTasteLock` 内 `readFile → parseTasteFile → mergeTasteEntries → writeFileAtomicTaste`，不盲覆盖（`mergeTasteEntries` 按 `normalizePreferenceKey` 保留 content 未陈述的既有条目）。
- edit：`learner-tools.js:128-168` `executeEdit` 在锁内 read→唯一匹配替换→原子写，命中 0/多次均拒绝并返回 error。
- 锁不横跨 LLM：锁只包文件读写周期（`storage.js:241-243` waitMs 10s）。
- 单测：`test/learner-tools.test.js:117-132`（合并保留并发新增）、`:160-173`（并发写全保留）、`:183-262`（edit 唯一匹配/0 次/多次/缺文件）。

### R5 — 递归防护时序 + 判据 ✅ PASS（判据为有据偏差，见 issue #2）
- 时序：`index.js:456-464` `executeJob` 在 `runTasteJob`（内含 create）**之前** `inFlightLearners.add(sessionId)`，`finally` 中（runLearner 内部已 dispose）**之后** `delete`。单测 `index.test.js:331-377` 用 gate 实测 create 时点 set 已入、dispose 后已清。
- 判据：pi-taste 的 `meta.origin:"taste-learner"` 在 DSH **不可表达**——`dsh-session/lib/index.js:1126` 实测 `record.origin !== void 0 && !== "subagent" → throw`。实现改用 origin `"subagent"` + `parentSession`（`isSubagent` 判据 1&2，`index.js:99-104`）+ in-flight Set 作冗余。learner 本身带 origin "subagent" + parentSession（`learner.js:158`），故 isSubagent 恒命中，递归被双保险阻断。测试 `index.test.js:238-247` 明确 codify 此偏差。
- 结论：递归防护**存在且有效**，非"缺失"；时序严格满足"create 前入 / dispose 后清"。

### R6 — abort 轮补扫（P1，非 M0 必修）✅ 不适用
- 属 P1 交付物（proposal §9），M0 不做。`collector.js` 无 abort 补扫属预期，非夹带/非缺失。

### R7 — 8 子命令齐全 / remember 零 LLM ✅ PASS
- `commands.js:221-230` switch 分发表明 8 个动词：status/on/off/list/remember/forget/paths/model，hint（`:255`）与 proposal §7 完全一致。
- `remember`（`commands.js:106-131`）走锁+原子写直插，**零 LLM**（不触 `ctx.agents`/learner），置信度 1.0。
- 单测覆盖全部子命令分支逻辑（commands 经 index 组装，`test/index.test.js` 校验 hint 与 register；storage 层覆盖读写）。

### R8 — 注释类修订 ✅ PASS（不影响运行）
- R8 属"注释/文档"类（agent-loop 微窗口、vision-adam 出处、worker 线程证伪），不产生可判定运行约束。实现注释中已记录 R5 偏差理由与 worker 证伪语境（`index.js:382-390`、`learner.js:95-99`）。

### R9 — context 注入 + sanitize + 专项单测 + 三守卫顺序 ✅ PASS
- 注入通道：`index.js:417` `ctx.systemPrompt.context({ name:"taste", order:40, text: injectTasteContext })`，**非 pre-step**。已实测 `dsh-system-prompt/lib/index.js:196-199`（context 注册）、`:278`（text 函数以 `context` 调用，含 agent）、`:98-129`（interpolate）。
- sanitize：`index.js:107-109` `sanitizePromptText` 用 `String(text).replaceAll("{{", "{ {")`，在 `:411` 注入前施加。
- 专项单测：`test/index.test.js:166-201` 含 `{{model}}`/`{{unknown}}`/`{{like this}}` 混合，断言 `assert.doesNotMatch(injected, /\{\{/)`，并**用真实 `renderContextSections` 证明** sanitize 后 verbatim 渲染、raw 形式 `{{unknown}}` throw、`{{model}}` 被静默替换。
- 三守卫顺序（`index.js:397-416`）：① 缺失 agent → ""；② `learningEnabled/injection.enabled` 关闭 → ""；③ `isSubagent && !includeSubagents` → ""；④ `inFlightLearners.has(id)`（learner）→ ""。顺序为 **关闭 → subagent → learner**，与契约一致（`:204-260` 单测钉死顺序语义）。
- interpolate 语义实测吻合：`{{unknown}}` throw（`dsh-system-prompt:121`）、`{{model}}` 替换（`:125`）、`{{` 无 `}}` 原样通过（`:112-115`）。

---

## 2. 范围纪律 / 跨模块契约 / 命令 handler / storage 保真

### 范围纪律 ✅ PASS（无 P1/P2 夹带）
- 无 importer（`lib/` 无 importer.js；storage 的 `loadCommandCodeTaste` 是注入用的**只读** Command Code 扫描，非 P1 `import` 命令）。
- 无 move 子命令（commands.js switch 无 move）。
- custom 模型**未接线**：`config.js:80` 强制 `modelMode: DEFAULT_CONFIG.observer.modelMode`（恒 "inherit"），`learner.js:136` 始终用父 provider/model；`model` 子命令硬编码 "inherit"（`commands.js:202-205`），P1 才接。
- 无 UI 卡片 / `session.append("taste/activity")`（index.js 无任何 activity 事件/卡片注册）。

### 跨模块契约 ✅ PASS（import 与实际导出逐一核对一致）
- `index.js:8-20` 从 storage 导入 12 个函数，storage.js 全部 `export`（parseTasteFile/renderTasteFile/isValidTasteFilePath/resolveTastePath/readTasteFile/listTasteFiles/writeFileAtomicTaste/withTasteLock/redactSensitive/clipText/normalizePreferenceKey/projectRootFor/ensureProjectTasteDir/reorganizeIfNeeded/loadCommandCodeTaste/loadTasteSnapshot）。
- `learner.js:4-5` 从 storage 导 `clipText`、从 learner-tools 导 `createTasteTools`；`learner-tools.js:4-12` 从 storage 导 7 个（isValidTasteFilePath/normalizePreferenceKey/parseTasteFile/renderTasteFile/resolveTastePath/withTasteLock/writeFileAtomicTaste），全部存在。
- index → commands 依赖对象（`index.js:499-508`）传入的 `loadConfig/saveConfig/globalDir/projectDir/loadTasteSnapshot/storageFns/queue/logger` 与 `commands.js` 实际调用逐一匹配。
- 冒烟 `import('lib/index.js')` 成功 = 整条 import 图无断链。

### 命令 handler 任何路径不抛 ✅ PASS
- `commands.js:216-236` `handleInvocation` 整段 try/catch，失败统一 `{kind:"error", text}`；`handler` 返回 Promise 且永不 reject。各子 handler 内部亦各自 catch（remember/forget 的 read 均有 try/catch）。

### storage 移植保真 ✅ PASS（对照 vendor/pi-taste/storage.ts）
- **parse**：`storage.js:117-127` vs `storage.ts:179-195`——同正则结构，另加中文句号容忍（`(?<=[。．])` 前视，注释+`storage.test.js:127-134` 钉死），纯扩展不破坏原解析。
- **render**：`storage.js:135-142` vs `storage.ts:202-206`——`- statement Confidence: 0.9\n`、空列渲染 `""`、`toFixed(1)` 完全一致。
- **白名单**：`storage.js:151-155/81-84` vs `storage.ts:379-402`——`isSafeCategorySegment` 正则与保留名（con/prn/aux/nul/com[1-9]/lpt[1-9]）逐字一致；`resolveTastePath` 拒 `..`/绝对/盘符。
- **reorganize**：`storage.js:335-382` vs `storage.ts:405-446`——只认一级 `# ` 标题、`>5` 触发、`See [slug/taste.md](slug/taste.md)` 链接、无标题根条目不迁移，逻辑一致。
- **slugify**：`storage.js:94-106` vs `storage.ts:384-396`——NFKC/小写/非安全折叠/64 截断/`category-sha256-12` 兜底，逐字一致。
- **normalizePreferenceKey**：`storage.js:285-292` vs `storage.ts:497-504` 一致。

---

## 3. Issues 明细（全部非 blocker）

| # | severity | file:line | problem | fix |
|---|---|---|---|---|
| 1 | minor | `lib/index.js:99-104` | `isSubagent` 第三判据只查 `agent.options.subagentDepth`，未查 `agent.session.header.delegationDepth`；DSH 权威 `delegationDepthOf` = `max(header.delegationDepth ?? 0, options.subagentDepth ?? 0)`（`dsh-subagent/lib/types/depth.js:18-26`）。冷恢复子代理 `options.subagentDepth` 被省略、仅存 `header.delegationDepth`（`descriptor.js`）。实践中判据 1&2（origin/parentSession）已覆盖全部真实子代理，故无实际功能缺口，属健壮性加固。 | 第三分支改为 `(agent?.options?.subagentDepth ?? agent?.session?.header?.delegationDepth ?? 0) > 0`，完全对齐 `delegationDepthOf`。 |
| 2 | note | `lib/index.js:382-390`、`lib/learner.js:95-99,158` | R5 "meta.origin 主判据" 偏差：pi-taste 的 `meta.origin:"taste-learner"` 在 DSH 不可表达（`dsh-session/lib/index.js:1126` 拒绝一切非 "subagent" origin，已实测）。实现改用 origin "subagent" + parentSession + in-flight Set。递归防护存在且有效，时序正确，非缺陷。 | 无需返工。建议在包 README 保留此偏差说明（当前仅代码注释与测试注释承载）。 |
| 3 | minor | `lib/learner-tools.js:105-109` | `write_taste_file` 对"当前文件存在但 0 条目"（如仅 `# Heading` 脚手架/散文）走 content 盲覆盖，会清掉标题与散文。R4 保护对象是"既有 learnings"，标题/散文不在范围，且 `learner-tools.test.js:149-158` 已钉死该行为，可接受。 | 若更保守：当前文件非空且含 `#`/非条目行时，改走 UNPARSABLE_HINT 或保留非条目行；否则维持现状。 |
| 4 | note | `lib/storage.js:26,267-276`、`lib/collector.js:11-15` | `clipText` 标记文案 `[...clipped...]` 与 pi-taste `[… N chars omitted …]`（`storage.ts:506-511`）不同；预算与"保头尾"语义一致，且不在 "parse/render/白名单/reorganize/slugify" 保真清单内，无功能影响。 | 可选：对齐标记文案以最大化移植保真；不必须。 |

---

## 4. 最终裁决

- 必修项 R0/R1/R2/R3/R4/R9 全部通过；R5 时序通过、判据为**有据可查的合理偏差**（非缺失）；R7/R8 通过；范围纪律、跨模块契约、命令 handler、storage 保真全部通过。
- 测试 106/106 绿；导入冒烟正确。
- **无 blocker，判 PASS。** 4 条 issues 均为 minor/note（健壮性加固与文档建议），不阻断返工。

## 5. 裁决后处置（主代理，2026-09-01）

- **Issue #1 已由主代理直接修复**：`isSubagent` 第三判据改为 `Math.max(options.subagentDepth, header.delegationDepth) > 0`，完全对齐 dsh-subagent `delegationDepthOf` 权威语义（复核建议的 `??` 链在 options=0/header=2 场景会漏判，故按 max 实现并加注释）。修复后 106/106 全绿 + 冒烟通过。
- Issue #2（R5 偏差说明）与 #4（clip 文案）已吸收进 README；Issue #3 维持现状（测试已钉死该行为）。

## 6. 运行期事故修复（主代理，2026-09-02）

首次真实学习触发的现场事故（learner 会话 `24a3c2f5`，10:03:14）：管线全链路正确触发，但 learner 轮次在模型调用前夭折——`prompt variable "{{cwd}}" has no value for this assembly (section "deployment:persona")`。根因与修复：

1. **meta 漏传 cwd**：`agents.create` 的 meta 未带 `cwd`/`agentPreset`（对照 dsh-subagent `childSessionMeta` 权威实现），learner 会话无 cwd → persona 段 `{{cwd}}` 插值 throw。修复：meta 按条件展开补齐两字段。
2. **静默失败**：errored turn 经 `whenIdle` 正常返回、无 assistant 输出，队列误记成功——熔断永不触发、每轮无感重试。修复：`whenIdle` 后扫描最后一个 `turn/end`，`reason.kind==="error"` 则 throw，让队列计数失败、熔断可见（`/taste status`）。
3. 回归测试 ×3（meta 传播 / 缺省省略 / errored turn 拒绝且 finally 仍 dispose）；126/126 全绿；装机副本已同步。
