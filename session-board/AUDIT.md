# 会话状态板 · 独立审计报告

> 审计者：独立 subagent（与方案提出者无共享上下文，仅以源码为据）
> 源码根：`/home/CNS2026495165/.dsh/profiles/web/node_modules/@deepseek-ai/`
> 审计对象：`PROPOSAL.md`；对照依据：`ADJUDICATION-NOTES.md`（含末尾「待核对项」）
> 全部行号均已在本轮亲自打开源码复核；未复核者明示。

---

## 1. 审计结论：需修订（revise）

一句话理由：**核心机制（turn/end 发布、Channel B 注入、withFileLock 存储、git-common-dir 分组、stateOf 机械提取）在源码中全部属实且可落地，但存在 3 个需修订的中等缺陷（注入预算未计入框架前缀、inject 降级语义错误、Channel B 与「每轮注入」契约措辞需对齐），另有多处轻微精度问题；无阻断级缺陷。**

---

## 2. 事实核验表（方案论断 → 源码证据 → 结论）

| # | 方案论断 | 源码证据（包 + 文件 + 行号） | 结论 |
|---|---|---|---|
| 1 | 轮末 `turn/end` 恰好一次、带 `turn` 号与 `reason` | `dsh-agent-loop/lib/index.js:590-598`（`finally` 内 `append("turn/end",{turn,reason})`）；`reason.kind` 五种：blocked(539)/completed(544)/aborted(577)/error(583)/max-tokens(682)；`turn()` 每轮一次（`turn=phase.turn+1`，521） | **属实** |
| 2 | `agent/status` running→idle（弃用候选） | `dsh-agent-loop/lib/index.js:380-389`（`get status()` 380-382、`setPhase` 384-389 仅变化时 emit） | **属实** |
| 3 | `agent/pre-step` waterfall、payload 含 `{agent,messages,signal}` | `dsh-agent-loop/lib/index.js:501-508`；注入范式 `dsh-session-reference/lib/index.js:359-366`（`{prepend:true}`、返回 `{kind:"enter",messages}`） | **属实** |
| 4 | `user/message` append 入口（两种注入都进持久历史） | `dsh-agent-loop/lib/index.js:554`；`acceptContext` 经 inbox `685`；无易失通道 | **属实** |
| 5 | `RuntimeContextProjection`：内容不变不注入、变化追加、compaction 重置 | `dsh-agent-loop/lib/index.js:26-83`；去重 `66`（`retained?.text === snapshot` 短路）；compaction `54`（`isReplacementSurfaceEvent` 命中旧 seq → `retained=null`） | **属实**（见缺陷 L7：是 `===` 非 `Object.is`） |
| 6 | 快照 source 自动 `kind:"plugin"`（防递归免费满足） | `dsh-agent-loop/lib/index.js:72-80`（`plugin:"@deepseek-ai/dsh-system-prompt",form:"snapshot"`）；`dsh-session-reference/lib/index.js:42-47`（仅 `kind==="user"` 入 @ 会话快照） | **属实** |
| 7 | `ctx.systemPrompt.context()` 注册、text 同步求值 | `dsh-system-prompt/lib/index.js:196-199`（`context()`）、`276-279`（`typeof entry.text==="function"?entry.text(context):entry.text`，同步非 await）；`assembleContextFor` 注入 `{agent}`：`dsh-agent/lib/types/dispatch.js:92-94` | **属实** |
| 8 | 快照框架前缀 + 空段过滤 | `dsh-system-prompt/lib/index.js:84-88`（`Current runtime context. This snapshot supersedes…`）、`98-102`（`.filter(text.length>0)`） | **属实** |
| 9 | `stateOf(session,key)` 同步读、缺 key 返 undefined | `dsh-session-projection/lib/index.js:109-113`；`README.md:13,30` | **属实** |
| 10 | `withFileLock`/`writeFileAtomic`（锁+原子替换+mode） | `dsh-atomic-write/lib/index.js:30-46`（writeFileAtomic）、`92-115`（withFileLock）；`README.md:18-31,45-47`（多进程 RMW、不 fsync、孤儿锁靠人工） | **属实** |
| 11 | session header 字段：cwd 绝对路径、parentSession、origin 仅 "subagent" | `dsh-session/lib/types/index.js:41-47`（cwd）、`48-50`（parentSession）、`55-57`（origin）；`session.header` 恒存在 `dsh-session/lib/index.js:1323,1390` | **属实** |
| 12 | `session/event` 签名 `(session, event)`，事件在回调前已入 log | `dsh-session/lib/index.js:1444-1476`（`callbackArgs=[this,event]`，log.push 于 1474 早于回调 1476） | **属实** |
| 13 | `tool/call` 形状 `{turn,step,callId,name,arguments}` | `dsh-agent-loop/lib/index.js:292-300` | **属实** |
| 14 | `assistant/message` 形状 `{turn,step,message,usage}` | `dsh-agent-loop/lib/index.js:673-681` | **属实** |
| 15 | goal 投影 schema/注册 | `dsh-goal/lib/index.js:342-362`（schema）、`522-534`（key "goal" 注册） | **属实**（见缺陷 L1：实际形状嵌套 `{goal:{objective,phase},roundsStarted}`） |
| 16 | todos 投影 schema/注册 | `dsh-tool-todo/lib/index.js:63-71`（content/status）、`80-95`（key "todos"） | **属实** |
| 17 | subagent 排除依据（parentSession+origin 均写） | `dsh-subagent/lib/index.js:530-540`（`childSessionMeta`：536 parentSession、537 origin）、`1715-1717`（listChildren 过滤） | **属实** |
| 18 | agent 事件订阅签名（`agent` 被注入 payload） | `dsh-agent/lib/types/dispatch.js:31-74`（`fused` 注入 agent）；用法 `dsh-goal-round-driver/lib/index.js:216,255,281` | **属实** |
| 19 | `ctx.agents` 仅本进程 live（get/list/roots） | `dsh-agent/lib/index.js:688-690`（get）、`706-708`（list）、`715-717`（roots） | **属实** |
| 20 | `defineTool` 及 execute/agent 可选 | `dsh-tools/lib/index.js:836-879`（`execute(args,exec)`、`isConcurrencySafe`、`output.render/schema`）；`exec.agent` 可选 `README.md:44` | **属实** |
| 21 | `installSettingsSection`/`settingsNamespace` | `dsh-settings/lib/index.js:618-636`（install）、`87-90`（settingsNamespace） | **属实** |
| 22 | 不可信框架文案先例 | `dsh-session-reference/lib/index.js:306-315`（`PROMPT_PREFIX` untrusted） | **属实** |
| 23 | repeat-tool-reminder `kind:"plugin"` 且 label load-bearing | `dsh-repeat-tool-reminder/lib/index.js:181-188` | **属实** |
| 24 | 挂载先例（vision-adam + patch.yml + install-plugins.sh） | `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam/package.json`（peerDeps cordis/dsh-tools/dsh-settings/…）；`~/.dsh/profiles/web/cordis.patch.yml`（vision-adam insert 条目）；`~/.dsh/install-plugins.sh`（FB=profiles/node_modules，不被 npx 抹掉） | **属实** |
| 25 | `ctx.inject(["systemPrompt","sessionProjections"])` 二者缺席时「goal/todos 置 null」优雅降级 | `cordis/lib/index.js:1098,1316-1328`（`_refresh` 对**全部** inject 名逐一校验，任一缺 → `epoch=INACTIVE`，回调不执行） | **有误**（见缺陷 M2：all-or-nothing，非「仅 goal/todos 置 null」） |
| 26 | 3 字节/token 换算 = 任意脚本 ≤500 token 硬保证 | 无源码可证（tokenizer 依模型而异）；方案自认 §12.4 为近似 | **未验证/近似**（见缺陷 M1） |

---

## 3. 待核对项清单逐条结果

| 待核对项 | 结果 | 说明 |
|---|---|---|
| 注入用 plugin source（V4） | ✅ | Channel B 自动 `kind:"plugin"`（`dsh-agent-loop:72-80`）；Channel A 降级显式 `createUserMessage({source:{kind:"plugin",…}})`。 |
| 注入按 turn 幂等（V5） | ✅（语义等价，机制不同） | Channel B 用**内容去重**（`66` 行短路）替代 per-turn 幂等，更强；per-turn 幂等仅存在于 Channel A 降级分支（`injectedTurn` map）。需在方案明示此差异（见 M3）。 |
| 发布挂点 agent/status 或等价物（V1） | ✅ | 选 `turn/end`（等价且更优：带 turn 号、finally 覆盖全部终局）。 |
| 预算含结构开销且按字节硬截断（V9） | ⚠️ 部分 | 板内模板开销计入 1500B，但 Channel B 框架前缀（~87 ASCII 字节）**未计入**（见 M1）；字节硬截断规则齐全（§7.2/7.3）。 |
| 分组键 worktree 归一（V7） | ✅ | `git rev-parse --git-common-dir` + `realpath`，非 git 回退 `realpath(cwd)`。 |
| 排除 subagent 会话（V10） | ✅ | `origin==="subagent" || parentSession!=null`，发布侧（源头）排除。 |
| 存储 withFileLock/writeFileAtomic（V6） | ✅ | 锁内 read-modify-write + 原子 rename，读侧无锁容忍旧完整内容。 |
| 零修改官方包 + patch.yml 挂载（V8） | ✅ | 新包 + `cordis.patch.yml` 追加 insert 条目；vision-adam 同款先例。 |

---

## 4. 缺陷清单

### 严重（阻断实现 / 违背契约）
无。

### 中等（需修订）
- **M1 注入预算未计入 Channel B 框架前缀；token 换算为近似**（§7.1/7.2，对应 V9「预算含结构开销」）。
  - 现状：`maxBoardBytes=1500` 只约束板本体；实际注入快照 = 框架前缀（`Current runtime context. This snapshot supersedes earlier runtime-context snapshots.` ≈ 87 ASCII 字节 ≈ ~22 tokens，`dsh-system-prompt/lib/index.js:87`）+ 板。最坏 CJK 板(500 tokens)+前缀(~22) ≈ **522 tokens**，轻微突破「硬上限 500」。
  - 且「1500B=500token」依赖 3 字节/token 近似，非对任意 tokenizer 的硬保证（方案 §12.4 已自认）。
- **M2 `ctx.inject(["systemPrompt","sessionProjections"])` 降级语义错误**（§9.2 末尾说明、§3.3）。
  - 现状：cordis inject 为 **all-or-nothing**（`cordis/lib/index.js:1098` + `1316-1328` 全量校验，任一缺 → 回调整体不执行）。故 headless 无 `sessionProjections` 时，**不是**「goal/todos 置 null、板照注入」，而是**整段不执行 → 板也不注入**。
  - 虽不影响主目标场景（web profile 两者俱在），但方案所述降级机制与事实不符。
- **M3 Channel B 与契约「每轮自动注入」的语义对齐**（§3.2/7.4，对应契约第 2/3 条）。
  - 现状：Channel B 是「**内容变化才追加快照 + retained 常驻**」，非「每轮 append 新板」。功能上板每轮在上下文中可见、预算更优，但**字面不满足「每轮注入」**；且板每变化一次即 append 一条 `user/message`，「supersedes」仅为文本语义、旧快照不清除（`dsh-agent-loop:66-82` 只 append 无 replace），板高频变化时快照线性累积、靠 compaction 收敛（与笔记 V3 一致）。
  - 需在方案明确：把契约「每轮注入」解释为「板每轮在上下文中可见（retained 快照）」而非「每轮新增消息」；并注明「每轮预算 = 单快照预算，非累计预算」。

### 轻微（建议）
- **L1** §4.1「goal schema 依据 …(goal.objective/phase/roundsStarted)」表述不精确：实际 `stateOf("goal")` 形状为 `{goal:{objective,phase,…},roundsStarted,…}`（`dsh-goal/lib/index.js:342-362`），提取须读 `state.goal.objective/state.goal.phase/state.roundsStarted`，再扁平化为 PeerStatus.goal。
- **L2** §3.3 `recentFiles` 白名单把 `glob/grep` 的 `pattern`（glob 模式/正则，非文件路径）当路径采集，语义错误；建议只采 `file_path`/`path`，或对 glob/grep 单独取 `path` 目录字段。
- **L3** 发布 `turn` 字段跨重启可能回退：`phase.turn` 是进程内状态（resume 后从 1 重计），文件里旧 `turn=5` 会被新进程 `turn=1` 覆盖；方案已以 `lastActivityAt` 为活跃主信号，应注明 `turn` 仅信息性、不可作全局单调序。
- **L4** §6.4 镜像初始化「`ctx.agents.list()` 中每个 live **顶层**会话」表述不一致：`list()` 返回全部（含 subagent），应改用 `roots()`（`dsh-agent/lib/index.js:715-717`）。
- **L5** §9.1 peerDependencies 列出未实际 import 的 `dsh-session`、`dsh-session-projection`（实现经 `ctx.sessionProjections`/事件对象访问，不 import 二者）；可移除或仅保留实际 import 的 `dsh-atomic-write`/`dsh-tools`/`dsh-settings`。
- **L6** §3.3 `recentFiles` map 对 subagent 会话同样累积（`session/event` 全量订阅 + `tool/call` 跟踪未按 isSubagent 早退），形成内存残留；建议跟踪前先 `if (isSubagent(session)) return`。
- **L7** §7.4 表称「框架级 `Object.is` 文本比对（…:66）」：66 行实为字符串 `===`（`Object.is` 出现在 projection 的 `dsh-session-projection/lib/index.js:288`），表述有误。

---

## 5. 修订后的方案（仅针对缺陷，不重抄全文）

### 改 §7.2（针对 M1）
- 将硬预算改为「**净板字节** + **预留框架前缀**」：
  - `maxBoardBytes = maxBoardTokens × 3 − PREFIX_RESERVE`，`PREFIX_RESERVE = 128`（字节，覆盖 `dsh-system-prompt/lib/index.js:87` 前缀与 `\n\n`）。
  - 或等价表述：`truncateBoard` 截断目标 = `maxBoardTokens×3 − 128`，使「前缀+板」总字节 ≤ `maxBoardTokens×3`。
- 将 §12.4 的「任意脚本上界」降格为「工程近似上界（3B/token 对 DeepSeek/GPT 系 CJK 保守）」，并写明：若需逐 token 硬保证，渲染后调用适配器 tokenizer（已列为开放项），否则按字节硬截断即视为满足契约的「换算策略 + 硬截断」。

### 改 §9.2 + §3.3（针对 M2）
- 拆分能力装配，不再用 all-or-nothing 组合 inject：
  - 注入侧：`ctx.inject(["systemPrompt"], (pctx) => { pctx.systemPrompt.context({…}) })`。
  - 状态提取侧：`const projections = ctx.get("sessionProjections");` 在 `captureStatus` 内判空：`projections?.stateOf(session,"goal") ?? null`、`projections?.stateOf(session,"todos") ?? null`；无该服务时 goal/todos 置 `null`，其余字段照常。
- 删除「二者缺席时优雅降级」的错误措辞，改为「板注入仅依赖 systemPrompt；goal/todos 依赖 sessionProjections，缺席时该两字段为 null」。

### 改 §3.2/§7.4（针对 M3）
- 在 §3.2 决策处补一句契约对齐声明：「『每轮自动注入』实现为 **retained 快照语义**：板在每轮上下文持续可见，仅内容变化时追加新快照（旧快照文本被『supersedes』前缀标记为过期，但物理上保留至 compaction）；默认模式**不**每轮新增消息，避免无界增长。」并说明 `injection="pre-step"`（Channel A）才是字面「每轮新增一条」的严格模式。
- 在 §7.2/§10 补注：「500 token 为**单快照**硬上限，非累计；板高频变化时快照线性累积，由 compaction 收敛，必要时可在后续版本评估提高 compaction 触发或引入 snapshot replace。」

### 改 §4.1/§3.3（针对 L1/L2/L3）
- §4.1 依据改为「`stateOf("goal")` 返回 `{goal:{objective,phase,…},roundsStarted}`，提取 `goal.goal.objective`、`goal.goal.phase`、`goal.roundsStarted`」。
- §3.3 `extractPath` 白名单：`{edit,write,read,read_image,analyze_image}` 取 `file_path`/`path`；`glob`/`grep` 仅取 `path`（目录）字段、**不取 `pattern`**。
- §4 PeerStatus.turn 注释标注「进程内单调、跨重启可能回退，仅信息性；活跃判定以 lastActivityAt 为准」。

### 改 §6.4/§9.1/§3.3/§7.4（针对 L4–L7）
- §6.4 `ctx.agents.list()` → `ctx.agents.roots()`（顶层）。
- §9.1 peerDependencies 删除 `dsh-session`、`dsh-session-projection`（未 import）。
- §3.3 `trackRecent` 首行加 `if (isSubagent(session)) return;`。
- §7.4 表「Object.is」改为「字符串 `===` 值比对」。

---

## 6. 验收标准修订

在 §11 追加/修订：

- **改 3（注入预算）**：实测注入快照 `Buffer.byteLength ≤ maxBoardTokens×3`（**含**框架前缀整段）；并在 headless（无 sessionProjections）下验证板不注入、不抛错、goal/todos 为 null（而非整段消失）。
- **新增 13（每轮可见性）**：连续两轮组内状态不变时，第二轮不新增快照但板仍在前缀中可见（检查 surface 事件序列中 `kind:"plugin"` 快照 seq 不增、且该快照仍在 surface）；板变化时新增一条快照。
- **新增 14（预算近似声明）**：文档/代码注释明确 3B/token 为近似、硬截断以字节为准。
- 其余 §11.1–11.12 保持，仅将第 3 条的 1500 固定值改为与 `maxBoardTokens×3`（含前缀预留）一致。

---

*（本报告仅核验与修订缺陷相关条目；未被点名的方案正文视为通过核验、维持原样。）*
