# pi-taste 深度阅读与 DSH 拓展评估 · 综合报告

> 目标：1) pi-taste 架构与功能实现分析；2) DSH 拓展同类能力评估
> 本文档是执行摘要与裁决记录；四份支撑文档：
> - `pi-taste-source-analysis.md` —— pi-taste 源码深读（子代理 A）
> - `dsh-architecture-analysis.md` —— DSH 架构分析（子代理 B）
> - `dsh-taste-proposal.md` —— dsh-taste 插件实现方案（提案子代理）
> - `dsh-taste-proposal-audit.md` —— 方案独立审计（审计子代理）

## 一、pi-taste 项目分析（摘要）

**pi-taste（v0.5.6，MIT，~2100 行 TS）是为 Pi coding agent 打造的本地偏好学习扩展**，1:1 复刻 Command Code 的 Taste 工作流（去云同步）。核心管线：

```
用户轮结束 → 后台 Learner（带工具的模型代理）→ 语义判断持久偏好
  → read/write/edit_taste_file 三工具写 taste.md → >5 条自动分类重组
  → 未来轮次注入 <taste> 快照（≤16k）
```

**设计三支柱**：①无状态机（模型写入即注入，零审批摩擦）；②单文件 taste.md（人类可读、格式即协议、Command Code 互通）；③Learner 用工具而非结构化输出（先读后改、精准增量编辑）。

**移植三要素**（框架无关抽象）：①轮次可见文本采集器；②轮次开始/结束两个时序钩子；③带工具调用的模型完成函数。其余（storage/脱敏/锁/重组/导入，~700 行）为近乎零改动可复用的纯逻辑。

详见 `pi-taste-source-analysis.md`。

## 二、DSH 架构现状（摘要）

DSH = **cordis 微内核 + ~200 个 `@deepseek-ai/dsh-*` 插件包**组合式架构（host 进程 + 浏览器双半插件；Session = append-only 事件日志 = 唯一事实源）。**taste 所需全部能力（轮末钩子、prompt 注入、受限工具、斜杠命令、UI 卡片、用户级存储）都已有第一等扩展点，可零内核改动实现**。

### 集成点对照（两轮独立验证 + 提案实证）
| pi-taste 需求 | DSH 集成点 | 证据 |
|---|---|---|
| agent_settled | `agent/turn-stopping` serial 钩子（payload {agent,turn}，abort/error 天然不触发）或 session/event turn/end | dsh-agent-loop:564-568 |
| before_agent_start 注入 | `agent/pre-step` waterfall 追加 user message（time-context 模板）或 systemPrompt.section | dsh-time-context:363-394 |
| Learner 模型循环 | `ctx.agents.create()` 一次性受限 Agent（复用全套工具循环，setup 注册 3 工具） | dsh-subagent-in-process-driver:160-226 |
| 子代理保护 | header.origin==="subagent" / parentSession / delegationDepth 三重判定 | dsh-subagent:530-540 |
| /taste 命令 | ctx.commands.register | dsh-command-feedback:76-86 |
| 活动卡片 | session.append("taste/activity") + conversationEvents.register + slots.inject | dsh-tool-workflow:39-52 |
| 原子写/锁 | dsh-atomic-write：writeFileAtomic + withFileLock | 已亲核导出 |
| 存储 | dshHomePath("taste") + <git-root>/.dsh/taste/ 双作用域 | dsh-home-paths |

### 关键陷阱（主代理独立发现，提案已规避）
- **⚠️ interpolate 硬约束**：systemPrompt.section 文本含 `{{xxx}}` 时 `interpolate()` 直接 throw（dsh-system-prompt:105-127）——taste.md 是模型生成自由文本，走 section 注入路径必须转义 `{{`；提案采用 pre-step user-message 注入路径天然规避
- 命令输出永不进模型历史；toolFilter 非安全边界；每轮变化注入破坏 KV cache（需 mtime 缓存）
- 零代码注入备选的边界：`instructionFileCandidates` 只覆盖项目路径；全局文件名硬编码 "AGENTS.md"

## 三、DSH 拓展评估（提案综合）

**结论：完全可行，且 DSH 的架构契合度超预期**——`dsh-llm` 底层用的就是 Pi 同源的 `@earendil-works/pi-ai` 抽象；in-process subagent 机制天然就是 Learner 载体；`dsh-agent-instructions` 是现成的静态偏好注入先例。

**推荐方案**（详见 `dsh-taste-proposal.md`）：`@deepseek-ai/dsh-taste` 插件，host 半 7 文件 ~1350 行：
- **时序**：pre-step 注入 <taste> 快照（先快照后学习）→ turn-stopping 采集入队（不阻塞收尾）→ 单并发 promise 链后台跑 Learner
- **Learner**：ctx.agents.create 一次性受限 Agent（setup 注册 read/write/edit_taste_file 三工具，路径白名单校验），模型 inherit 父 agent 路由，MVP 零配置
- **存储**：storage.ts 近乎零改动移植（唯一耦合 getAgentDir→dshHomePath）；dsh-atomic-write 修复 pi-taste 已知的"工具直写不持锁"竞态
- **安全**：脱敏三正则 + 限长 + 子代理三重判定 + learner 递归双保险（in-flight set + meta origin）
- **配置**：config.json（learningEnabled/injection/observer.modelMode）+ settings 集成

**对 pi-taste 的两处主动改进**：①工具写路径持锁（修竞态）；②read_taste_file 白名单收紧（修宽松读）。

## 四、实现路径建议（规模从小到大）

| 路径 | 内容 | 量级 | 适用 |
|---|---|---|---|
| **1. 零代码注入**（今天可用） | cordis.patch.yml 覆写 agent-instructions 行：`instructionFileCandidates` 加 taste.md；全局偏好写 ~/.dsh/AGENTS.md。学习侧人工维护 | 半小时 | 先尝鲜注入效果 |
| **2. 包级插件**（推荐） | dsh-taste 双半插件（M0 ~1100 行 → P1 +250 → P2 UI +200），cordis.patch.yml 一行 insert，全部走公开扩展点，升级 DSH 不受影响 | M0 约 2-3 天 | 正式落地 |
| **3. 深度内核集成**（上游向） | SessionEventMap 注册 taste/* 事件、projection、官方 bundle 内置 | 跟随内核版本 | 贡献上游 |

**M0 MVP 交付物**：storage.js + config.js + collector.js + index.js + learner.js/learner-tools.js + /taste status|on|off|list|forget|paths 命令；测试沿 pi-taste 门槛（node:test + 覆盖率 90/75/85 + 凭据门控 e2e）。

## 五、审计结论：**需修订（轻微）——可进入执行**

四阶段闭环（提出→审计→执行→复核）中的"提出+审计"已完成。审计方式：原重型审计拆分为三个轻量切片并行（事实核查 / 边界风险 / 完整性），主代理另做 10+ 项独立锚点验证交叉。

**事实核查 5/5 ✓**（方案引用的全部 DSH API 与源码一致；interpolate {{}} 崩溃入口确认不存在——动态 taste 文本走 pre-step 消息注入而非 systemPrompt section）。

**边界审计 1 高 / 3 中 / 2 低**，最危险 Top-2：
1. **[高] serial handler 无整体 try/catch**——一个意外事件形状就会把用户 turn 毒化为 error（必修）
2. **[中] learner 失败无熔断**——inherit 模式绑定主 provider，故障期每轮烧一次注定失败的 ≤120s 调用且静默（必修）

**完整性**：唯一缺口是命令族漏了 `/taste remember`（手动记录逃生舱）；工作量估计现实（M0 ~1100 行 / 2-3 天）；DSH 惯例无遗漏（第三方插件只需 lib/index.js + package.json）。

**裁定**：架构选型（turn-stopping 钩子 + ctx.agents.create 受限 Agent + pre-step 注入 + atomic-write 存储）全部成立；修订项均为工程防护级（**R0-R3 必修**：inject 声明 + serial try/catch + 熔断 + 卸载信号，合计 ~60 行 + 1 行声明；R4-R7 可 P1 落实），不推翻任何架构决策。审计另**证伪**了方案 §10.2 的 worker 线程担忧（worker 不跑 cordis 插件集，派生代理带 parentSession 已被三重判定防住）、**证实**了安装链路写法。**执行前落实 R0-R3 即可，无需二次审计。**

详见 `dsh-taste-proposal-audit.md`（含 8 条修订指令清单）。
