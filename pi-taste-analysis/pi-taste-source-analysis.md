# pi-taste 源码架构与实现分析报告

## 1. 项目概览与代码规模
pi-taste（v0.5.6，MIT）是为 Pi coding agent 打造的本地偏好学习扩展，学习管线 1:1 复刻 Command Code 的 Taste 工作流（去云同步）。零运行时依赖（peerDeps 仅 pi 三件套且 optional），以 TS 源码直发（`exports: "./index.ts"`，`package.json` 的 `pi.extensions` 字段供 Pi 包发现），要求 Node ≥22.19。

| 文件 | 行数 | 职责 |
|---|---|---|
| `index.ts` | 816 | 扩展入口：事件挂载、命令、注入、队列编排 |
| `storage.ts` | 521 | 存储层：taste.md 解析/渲染、原子写、文件锁、分类重组、路径校验、脱敏、Command Code 只读兼容 |
| `learner.ts` | 303 | Learner 代理：system prompt、3 个工具、agent 循环、模型解析 |
| `activity.ts` | 173 | 对话区活动卡片（pi-tui Box/Text 渲染） |
| `footer.ts` | 149 | footer 状态栏（token/上下文用量 + Taste:on·N!） |
| `importer.ts` | 78 | `/taste import` markdown 导入（限长/去重/拒密钥） |
| `types.ts` | 92 | 类型定义（v3 schema） |
| 测试 | ~1030 | 5 个 node:test 文件（33 例）+ 1 个凭证门控 e2e runner |

质量保障：`npm run check` = tsc --noEmit + 强制覆盖率门槛（90% 行/75% 分支/85% 函数，实测 91.48/77.64/89.41）；CI 在 ubuntu+windows × Node 22/24 矩阵跑 check + pack:check；e2e（`test/e2e/run-real-provider.mjs`）用真实 provider 跑两个隔离 session，验证 session1 学到的标记偏好影响 session2 行为。

## 2. 架构图（数据流）
```
Pi 主进程（TUI/RPC）
└─ tasteExtension(pi)  [index.ts:310]
   ├─ input 事件 ──────────────► 暂存 PendingFeedbackJob{userText, 前20条可见消息}（assistantText 留空）
   ├─ before_agent_start ──────► 注入 <taste> 快照（project+global+commandcode，≤16k）[index.ts:498-504]
   ├─ agent_start/message_update/message_end ─► 收集本轮 assistant 可见文本
   ├─ agent_settled / session_shutdown ─► 补齐 assistantText → 入队 [index.ts:396-410,489-496]
   ├─ 单并发 Promise 队列（后台运行，与下一轮并行）[index.ts:381-394]
   │   └─ runLearner [learner.ts:201-280]：≤20 轮 agent 循环
   │       ├─ ctx.modelRegistry.complete（inherit/custom 模型，AbortSignal 超时）
   │       ├─ 工具 read/write/edit_taste_file → runTasteTool（路径白名单）[learner.ts:143-182]
   │       └─ reorganizeIfNeeded（>5 条 → {category}/taste.md）[storage.ts:405-423]
   ├─ pi.appendEntry("taste-activity") → 活动卡片 [activity.ts:112-172]
   └─ ctx.ui.setFooter → Taste:on·N! [footer.ts:37-148]
存储：~/.pi/agent/taste/{config.json, taste.md, .lock}（PI_TASTE_DIR 可重定向）
      <git-root>/.pi/taste/{taste.md, .lock, .gitignore}
只读兼容：~/.commandcode/taste/** 与 <root>/.commandcode/taste/** [storage.ts:452-491]
```

## 3. 核心机制逐项分析
**扩展 API 挂载**（`index.ts`）：单入口函数 `tasteExtension(pi)`。事件监听：`session_start`（装 footer/重置状态）、`input`（暂存反馈，跳过 `source==="extension"`）、`before_agent_start`（返回 `{systemPrompt}` 注入 `<taste>` 段）、`agent_settled`/`session_shutdown`（触发学习，后者 `await queue` 保证退出前跑完）、`message_*`（拼接流式 assistant 文本）、`model_select`/`thinking_level_select`（刷 footer）。命令用 `pi.registerCommand("taste")`，子命令 status/list/paths/remember/import/move/forget/on/off/model/retry（retry 在 v3 是空操作，因直写模型无需重试）。

**Learner 设计**（`learner.ts`）：system prompt（17-28 行）核心约束：只学 NEW 消息中"持久、可泛化"的偏好；之前分析窗口仅用于解析引用；不重复记录、无新证据不改置信度；无持久偏好时"不调工具、回复 no changes"。上下文由 `buildLeanerInput`（95-137 行）拼装：Session summary（参数保留但当前未接线）+ taste 文件树 + 之前分析窗口（≤20 条，`isLearnableMessage` 过滤 meta/automated/summary/toolResult/非 user 来源，`stripReasoning` 去 thinking）+ NEW 消息；NEW 为空时回退 InteractionContext 兜底（0.5.2 修的 bug）。工具是标准 JSON Schema（30-65 行），`runTasteTool` 校验路径：`resolveTastePath` 拒绝绝对路径/`..`/盘符，写/编辑再过 `isValidTasteFilePath`（只允许 `taste.md` 或 `{category}/taste.md`，category 段拒 Windows 保留名、≤64 字符）。模型自主多轮循环（≤20 轮），每轮执行 toolCall 并回填 toolResult。

**存储设计**（`storage.ts`）：单文件格式 `- statement. Confidence: 0.9`，解析容忍无英文句号（中文友好，0.5.5）。`atomicWrite`：0o700 目录 + 0o600 临时文件 + rename。跨进程锁：`open(wx)` 独占创建 `.lock`，30s 过期清死锁，100×50ms 重试；`mutatePreferencesMultiple` 按锁路径排序防死锁。双作用域：global=`~/.pi/agent/taste/`，project=`<最近 .git 根>/.pi/taste/`，项目目录自动生成全拒 `.gitignore`（防私有状态入库）。分类重组：只认一级 `# ` 标题段（0.5.4 修复：无标题根 bullets 永不当地归类），>5 条 → `categorySlug`（NFKC/小写/安全字符/哈希兜底）迁至 `{slug}/taste.md`，根文件留 `See [slug/taste.md](slug/taste.md)`。

**安全设计**：`redactSensitive` 三组正则（sk/ghp/github_pat/xox token、Bearer、api_key/password/secret=值）；`clipText` 保头 35% + 尾部、中间省略；用户 8k/assistant 12k/注入 16k/导入 256KB·100 条·500 字符。进程级保护（`index.ts:324-328`）：`PI_SUBAGENT_CHILD=1`（pi-subagents 子进程）或 `--no-session` 时禁学习但仍可被注入；`PI_TASTE_ALLOW_NO_SESSION=1` 仅供测试且绕不过 subagent 保护。活动卡片是 display-only transcript entry，绝不进模型上下文。

**时序设计**：`input`（轮 N+1 开始）只暂存不执行 → `before_agent_start` 先取注入快照（含此前所有学习）→ `agent_settled`（轮 N+1 结束）才补齐 assistantText 并入队。因此本轮学到的偏好最早影响下一轮注入；Learner 在 promise 链上串行、与前台下一轮并行，不阻塞也不被取消。0.5.2 曾因在 input 时就读 assistant 文本而学到"上一轮"。

**配置管理**：`~/.pi/agent/taste/config.json` v3：`learningEnabled` 总开关（同时管学习+注入，无独立注入开关）；`observer.modelMode: inherit|custom` + 有序 `models` 回退列表 + reasoning(maxOutputTokens/timeoutMs/maxInputChars)；`injection.maxChars`。`mergeConfig` 白名单合并 + `boundedNumber` 钳位。`resolveTasteModel`：inherit 跟随主模型；custom 按序找有 auth 的，找不到**不静默回退**而是报错。

**Command Code 兼容层**：`loadCommandCodeTaste` 只读扫描 `~/.commandcode/taste/` 与 `<root>/.commandcode/taste/` 的根/一级目录 taste.md，解析后按 `normalizePreferenceKey` 与 Pi 自有偏好去重，注入时追加，绝不写回。

## 4. 设计亮点与权衡
- **无状态机**：v1-v2 曾有 approved/pending/rejected 状态与审计证据，v3 砍掉——模型写入即注入。换取零审批摩擦与 Command Code 格式互通；代价是低置信度条目也会注入，靠"写 taste.md 很便宜、可手改/forget"兜底。
- **单文件 taste.md 而非数据库**：人类可读可手编可备份，格式即协议（Command Code 兼容的前提）；代价是并发写需要锁+原子写兜底。
- **Learner 用工具而非结构化输出**：write/edit/read 三工具让模型能先读后改、精准增量编辑，天然支持跨轮 amend 而非每次全量重写；代价是要自建 20 轮循环与路径校验。
- **编排即 promise 链**：`queue = queue.then(...)` 单并发 + shutdown await，十几行实现后台队列语义。
- 已知弱点：`runTasteTool` 直接 `writeFile` 不文件锁——锁只护手动命令路径，跨进程两个 Learner 并发写同一 taste.md 理论可竞态；`read_taste_file` 只要求在 taste 目录内，比写策略宽松；`collectObserverUsage` 是返回 undefined 的遗留桩。

## 5. 移植要点
**Pi 专属耦合（需重写适配层）**：`ExtensionAPI` 事件名与 handler 签名（input/before_agent_start/agent_settled/message_end 等）；`ExtensionContext` 的 sessionManager/modelRegistry/ui 面；`ctx.modelRegistry.complete`（需换成目标框架的模型调用）；pi-tui 组件与 `pi.appendEntry/registerEntryRenderer`（activity/footer）；`getAgentDir()`、`PI_SUBAGENT_CHILD`、`package.json` 的 `pi.extensions`；消息形状假设（content parts 的 text/thinking/toolCall/toolResult、meta 标记）。

**通用可复用（近乎零改动）**：`storage.ts` 全部（解析/渲染/原子写/锁/重组/slug/路径校验/redact/clip/normalize）；`learner.ts` 的 system prompt、工具定义、`runTasteTool`、学习循环（把 `ctx.modelRegistry.complete` 抽成参数即可）；`importer.ts`；types.ts。

**移植核心抽象只有三件事**：①"轮次可见文本"采集器（对齐 isLearnableMessage 的语义过滤）；②"轮次结束 + 轮次开始"两个时序钩子；③一个带工具调用能力的模型完成函数。其余皆为框架无关的纯逻辑。
