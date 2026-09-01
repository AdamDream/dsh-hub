# dsh-taste 实现方案 v2：DSH 原生本地偏好学习插件

> v2 = v1 + 审计修订 R0-R9 全部落地（审计见 `dsh-taste-proposal-audit.md`）。
> R9 为实现准备期主代理新实证的注入通道变更（证据：dsh-agent-loop RuntimeContextProjection + dsh-system-prompt interpolate）。
> 本文档是执行者的唯一契约；实现严格照此，不得擅自扩大范围。

## 0. 实现环境（已就绪并冒烟验证）

- 插件目录：`/home/CNS2026495165/dsh/dsh-taste/`（lib/ + test/ 已建）
- pi-taste 参考源码：`/home/CNS2026495165/dsh/pi-taste-analysis/vendor/pi-taste/`（storage.ts/learner.ts/importer.ts/types.ts 为移植母本）
- node_modules 符号链接：`/home/CNS2026495165/dsh/node_modules` → `~/.dsh/profiles/web/node_modules`（Node v22.23.2）
- 冒烟已验证可导入：`dsh-atomic-write`(writeFileAtomic,withFileLock)、`dsh-llm`(createUserMessage)、`dsh-tools`(defineTool)、`dsh-home-paths`(dshHomePath)、`schemastery`(z 默认导出)、`dsh-subagent`(finalAssistantOutput)
- DSH 包源码（只读参照）：`/home/CNS2026495165/.dsh/profiles/web/node_modules/@deepseek-ai/`

## 1. 源码实证结论（事实基础，全部已核对）

| 机制 | 结论 | 出处 |
|---|---|---|
| turn-stopping 触发 | turnEnds 已置且 inbox.nextStep 为空时 serial；abort/error/pre-step reject 均不触发。**微窗口**：:571 在 dispatch 后还有一次 throwIfAborted——已触发后才 abort 的轮事件已发（模型输出完整，采集影响极小） | dsh-agent-loop:564-568、538-541、575-589、571 |
| turn-stopping payload | `{agent, turn, signal}`，无 reason（completed 与 max-tokens 同 payload） | dsh-tool-cordis:3870 |
| serial 语义 | 监听器阻塞轮次收尾；**监听器抛错会把用户 turn 置 error**（R1 由此） | dsh-agent-loop:565 |
| **运行时上下文通道（R9 核心）** | `systemPrompt.context({name,order,text\|fn})` 贡献经 `renderContextSections` 求值 → loop 的 `RuntimeContextProjection.project()` **仅在内容变化时**追加一条 user 消息（form:"snapshot"）；compaction 替换掉旧快照后自动重注入；**追加语义 KV-cache 友好**（官方 README 明示）。text 为函数时收到 `{agent, scope:agent, signal}`——**可按 agent 门控**（返回 "" 则该贡献被过滤，不注入） | dsh-system-prompt:99/196-210/271-278；dsh-agent-loop:20-84、496-507；dsh-agent:384-390 |
| **interpolate 硬约束** | context 文本过 `interpolate()`：`{{未注册变量}}` → **throw**（打断整个 turn）；`{{model}}`/`{{cwd}}` 等**已注册变量** → 静默替换（文本损坏）；`{{` 后无 `}}` → 原样通过。**任何进入 context 的动态文本必须先 sanitize `{{`**（R9） | dsh-system-prompt:105-127 |
| surface 替换 | surfaceOp="append" 累积；替换用 `{op:"replace",start,end}`+sourceEventSeqs（compaction 即此机制清理旧快照） | dsh-session:262-330；dsh-compaction-basic:607 |
| subagent 判定 | header.origin==="subagent" / header.parentSession / delegationDepth 三重任一命中 | dsh-subagent:530-540、486-489；fork/spawn 共用 childSessionMeta |
| Learner 载体 | `ctx.agents.create({sessionId,meta,agentOptions,signal,setup})` + `agents.withInitiator(parent,fn)` 包裹（重建 initiator 边界）；setup(childCtx) 内注册子作用域工具与 section；followup + whenIdle + dispose；`finalAssistantOutput` 可从 dsh-subagent 直接导入 | dsh-agent:545-556、490；in-process-driver:178-186 |
| 原子写/锁 | `writeFileAtomic(filename,content,{mode,dirMode})` + `withFileLock(filename,op,{waitMs})`；无孤儿锁自动恢复（失败路径 finally 释放） | dsh-atomic-write:30-116 |
| 命令 | `ctx.commands.register({name,description,input:{hint},recordInput,handler})`；invocation 有 .rawInput/.agent；返回 {kind:"success"|"error",text}，渲染进对话流**永不进模型历史** | dsh-command-feedback:61-86 |
| 激活语义（R0） | **必须显式声明 inject**——不声明而用 ctx.commands → 抛错、插件加载失败；声明后服务缺失 → boot fail loud（"pending (waiting for services)"），不静默半激活 | cordis:672-697、1316-1342；dsh-app-boot:1107-1136 |
| worker 线程（已证伪） | workflow/code-runtime worker 都不跑 cordis 插件集；派生代理带 parentSession 已被三重判定防住 | dsh-workflow-worker-thread/worker.cjs:404-418；dsh-code-runtime-worker-thread:737-750 |
| 安装链路 | `- insert:[{id:'taste',name:'…'}]` 成立；本地相对/裸名路径锚定 profile 目录 | dsh-app-boot:57-106 |

## 2. 插件架构

包名 **`@deepseek-ai/dsh-taste`**（cordis 名 `taste`），host 半纯 JS ESM。v1 无 UI。

**`inject = ["agents", "commands", "systemPrompt"]`**（R0 必修——不声明而访问 ctx.commands/ctx.systemPrompt 均抛错、插件加载失败；P1 接 settings 时补 "settings"）。

```
dsh-taste/
├─ package.json          ~25 行   name/exports:"./lib/index.js"/peerDeps
├─ lib/
│  ├─ index.js           ~150 行  四件套：context() 注入注册、turn-stopping 学习钩子、
│  │                              队列+熔断、守卫、shutdown drain；组装依赖
│  ├─ storage.js         ~480 行  移植 pi-taste storage.ts；getAgentDir()→dshHomePath("taste")
│  ├─ config.js          ~70 行   config.json v3：mergeConfig 白名单 + boundedNumber 钳位
│  ├─ collector.js       ~90 行   轮次可见文本采集器（纯函数，不 import cordis）
│  ├─ learner.js         ~190 行  Learner 输入构建 + agents.create 驱动 ≤20 轮循环
│  ├─ learner-tools.js   ~120 行  read/write/edit_taste_file（defineTool）+ 路径白名单
│  └─ commands.js        ~110 行  /taste 命令族（8 子命令，含 remember）
└─ test/                 ~900 行  node:test（§9）
```

依赖：`dsh-llm`→createUserMessage；`dsh-agent`→服务 agents；`dsh-atomic-write`；`dsh-home-paths`；`dsh-tools`→defineTool；`dsh-subagent`→finalAssistantOutput；`schemastery`→z。v1 不用 dsh-settings（P1 再接）。

## 3. 时序设计（v2 重写：注入通道换 context()，R1/R2/R3/R5/R9 落地）

```
注入（不再用 pre-step 监听器）：
  systemPrompt.context({name:"taste", order:40, text: injectText})
  injectText({agent})：
    1) 守卫：learning/injection 关闭 → ""
    2) 守卫：isSubagent(agent) 且 !injection.includeSubagents → ""
    3) 守卫：agent.session.header.origin === "taste-learner" → ""（learner 输入自带 taste 树，避免重复）
    4) 读 taste 快照（project+global+commandcode 合并去重，mtime 缓存，≤injection.maxChars 截断）
    5) sanitize：text.replaceAll("{{", "{ {")   ← R9 必修，防 interpolate 崩溃/静默替换
    6) 返回 `<taste>\n${快照}\n</taste>`
  → loop 的 RuntimeContextProjection 自动差异追加；内容稳定零重复注入；
    learner 写入后下一 step 追加新快照；compaction 清旧后自动重注入

学习：
  ctx.on("agent/turn-stopping", handler)   ← 整体 try/catch（R1 必修：log-and-return，
                                              任何畸形事件只 warn 绝不抛出）
    handler 内（同步、纯内存、<1ms 量级）：
    1) 守卫：isSubagent(agent) → return；header.origin==="taste-learner" → return
    2) collector 按 turn 边界切片本轮 user/assistant 可见文本（脱敏+限长）
    3) 空/守卫失败 → return；否则构造 Job 入队（队列上限 3，满则丢最旧保最新——R2）

后台单并发：queue = queue.then(runJob).catch(log)
  runJob：
    1) 熔断检查：连续失败 ≥3 → 冷却 10 分钟内直接跳过（R2；计数与冷却到期时间在 /taste status 可见）
    2) in-flight Set 在 create **之前**加入（R5）
    3) agents.withInitiator(parentAgent, () => agents.create({
         sessionId: 随机, meta:{origin:"taste-learner", parentSession:父id},
         agentOptions: inherit ? 父 provider/model : config 指定,
         signal: 插件 ctx 的 signal,        ← R3 必修：unload → 确定性取消 in-flight
         setup: 注册 3 工具 + learner prompt section }))
    4) followup(learnerInput) → await whenIdle() → 读结果
    5) finally：await handle.dispose().catch(log)；in-flight Set 移除（R5：dispose 后）
  失败 → 失败计数+1（成功清零）；超过熔断阈值进入冷却

shutdown（ctx.effect teardown 或 fiber dispose）：
  await Promise.race([queue, timeout(30s)]).catch(log)   ← 落败分支也 catch（R3）
  （signal 已联动：unload 时 ctx signal 触发 → learner 的 LLM 调用确定性取消）
```

## 4. 学习管线

**Learner = `ctx.agents.create` 一次性受限 Agent**（复用 dsh-agent-loop 全套工具循环）。模型路由 `inherit`（默认）继承触发轮 agent 的 provider/model；`custom` 由 config 指定（P1）。

**工具写路径（R4 必修：锁内读-改-写，关闭跨 LLM 的 RMW 窗口）**：
- `write_taste_file(scope, path, content)`：`withFileLock(目标文件, () => { 当前 = read(); 新 = 以 content 为目标全量但**合并**当前中 content 缺失的既有类别段 → writeFileAtomic })`——不允许基于陈旧快照盲覆盖整文件；若 content 与当前不兼容（格式校验失败）返回错误让模型重读重试
- `edit_taste_file(scope, path, old_text, new_text)`：锁内读→字符串替换→原子写（天然 RMW 安全）
- `read_taste_file(scope, path)`：白名单与写同级（收紧 pi-taste 宽松读）
- 路径白名单整体移植 pi-taste：只允许 `taste.md` 与 `{category}/taste.md`，拒 `..`/绝对路径/盘符/保留名
- 锁只护文件读写周期（waitMs 10000），绝不横跨 LLM 调用

## 5. 存储设计

- 双作用域：全局 `dshHomePath("taste")`（含 config.json、taste.md、{category}/taste.md）；项目 `<git-root>/.dsh/taste/`（git-root 由 session cwd 逐级向上找 `.git`，移植 pi-taste；dsh-workspace 无此能力已核实）。项目目录自动写 `.gitignore`（`*`）
- 格式：`- statement. Confidence: 0.9`（中文句号容忍），Command Code 兼容（只读扫描 `~/.commandcode/taste/**` 与 `<root>/.commandcode/taste/**` 并入注入去重，绝不写回）
- >5 条分类重组照搬（只认一级 `# ` 标题段）
- 全部写路径 writeFileAtomic（0600+rename）；写者持 `<file>.lock`；孤儿锁由 /taste paths 提示人工清理（README 注明）

## 6. 安全设计

1. 脱敏 redactSensitive 三组正则（sk-/ghp/github_pat/xox、Bearer、api_key|password|secret=值），collector 切片与 importer 入口强制
2. 限长：user 8k / assistant 12k / 注入 16k / 导入 256KB·100 条·500 字符
3. 子代理三重判定不学习；learner 递归双保险（meta.origin 主判据 + in-flight Set 冗余，时序见 §3）
4. **注入 sanitize `{{`（R9）**——含此边界的单测：`{{model}}`、`{{unknown}}`、`{{`、`}}` 混合的偏好文本
5. 凭据不入 taste 配置；config.json 仅行为开关与模型路由字符串

## 7. 命令与 UI

v1 仅命令（R7：M0 含 remember）：`ctx.commands.register({name:"taste", input:{hint:"<status|on|off|list|remember|forget|paths|model>"}, recordInput:false, handler})`，按 invocation.rawInput 首词分发：
- `status`：开关/注入开关/队列深度/熔断状态（连续失败计数、冷却剩余）/偏好总数
- `on|off`：写 config.json learningEnabled
- `list [n]`：列偏好（编号+陈述+置信度）
- `remember <text>`：**手动记录**（R7——显式用户动作、零 LLM；锁+原子写直插，confidence 1.0）
- `forget <n|关键词>`：锁内移除该条
- `paths`：全局/项目 taste 路径 + 锁残留提示
- `model`：显示当前路由（inherit/custom）
- （P1：`import <file>`、`move`）

v2 活动卡片（P2，非 M0）：session.append("taste/activity") + client 半 slots——按原方案执行。

## 8. 配置

`~/.dsh/taste/config.json`（mergeConfig 白名单合并 + 钳位）：
```jsonc
{ "learningEnabled": true,
  "injection": { "enabled": true, "maxChars": 16000, "includeSubagents": false },
  "observer": { "modelMode": "inherit", "provider": "", "model": "",
                "maxInputChars": 16000, "timeoutMs": 120000, "maxTurns": 20 },
  "storage": { "categoriesEnabled": true } }
```

## 9. 实施计划

| 阶段 | 交付物 | 量级 |
|---|---|---|
| **M0（本次）** | storage.js + config.js + collector.js + learner-tools.js + learner.js + commands.js + index.js + 全套 node:test | ~1200 行 host + ~900 行测试 |
| **P1** | edit 工具细化、分类重组接通、importer、custom 模型、installSettingsSection、**abort 轮补扫**（R6：watermark 持久化 + 只扫 reason.kind=aborted 且内容非空） | +~250 行 |
| **P2** | client 半活动卡片 + taste/activity 事件 + 文档 | +~200 行 |

**测试策略**：storage/config/collector 纯函数（不 import cordis）；node:test；learner 以假 agents 服务桩测编排（不真调模型）；sanitize {{ 专项单测；"畸形事件不抛出"专项单测（R1）；e2e 手动脚本（凭据门控）：两隔离 session 验证 session1 学到的偏好出现在 session2 注入快照；集成冒烟=安装→cordis.patch.yml insert→重启→真实会话→检查 ~/.dsh/taste/taste.md。

## 10. 风险与开放问题（v2 修订）

1. turn-stopping 覆盖面：最后一条用户消息紧跟 abort 的轮永久错过——**P1 补扫**（R6，可行性已证：日志可重放、abort 轮从不进 collector、纯增量）
2. ~~worker 线程~~ **已证伪**（worker 不跑插件集，派生代理带 parentSession 已防住；e2e 一次性确认即可）
3. withInitiator 包裹：官方语义支持；若 create 实际不强制，保留无害
4. 跨进程并发学习：withFileLock + 锁内 RMW（R4）+ normalize 去重兜底——丢失更新窗口已关闭
5. custom 模型词表：实施时从 dsh-llm-* provider 注册名核对；M0 仅 inherit
6. learner session 可见性：若 UI 噪音，meta.origin 过滤（开放）
7. 注入累积：context 通道内容变化才追加；旧快照由 compaction 清理——学习频繁的极端会话可能短暂多版本共存（可接受，模型偏新）
