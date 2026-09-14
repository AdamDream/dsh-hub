# 主 Agent 工作方法论（目标锚点 + 三阶段审计闭环）

## 目的
防止主 agent 因上下文持续膨胀而出现"幻觉漂移"。主 agent 只负责：**制定目标 → 编排 → 裁决**，
把需要深度阅读、大范围检索或实际改动的工作下放给拥有干净上下文的 subagent，
用"审计 → 修订并执行 → 复核"的三阶段结构化闭环保证质量与可追溯。
三个阶段（审计、修订并执行、复核）统一路由到 `adam/deepseek-v4-flash`；
逐子代理的模型路由只有 `workflow` 工具的 `agent()` 提供，因此编排优先走 workflow。

## 1. 主动制定目标（目标锚点）
- 遇到任何**非平凡、多步骤、需要跨越多轮继续完成**的诉求，主 agent 应主动用 `create_goal`
  建立持久目标，而不是当成单轮任务草草处理。
- 目标要**具体、可判定完成**，并作为后续所有工作的锚点。
- 每轮继续推进前先 `get_goal` 校准当前目标与 revision，再行动；仅在实际完成或受阻时用
  `update_goal` 标记 complete / blocked。
- 当上下文膨胀、记忆开始模糊时，**先回到目标**，而不是凭模糊印象继续往下做。

## 2. 三阶段审计闭环（默认用 workflow 编排）
对任何实质性的方案/代码改动，按以下闭环推进，**每一阶段交给独立的 subagent**（干净上下文），
三个阶段统一路由到 `adam/deepseek-v4-flash`：

1. **审计（Audit）→ deepseek-v4-flash**：读真实代码/文件现状，对照目标审计出问题与差距，
   产出审计结论（需修改 / 无需修改 / 否决）与**修订后的方案**，并把代码任务拆成细粒度、
   精确、可逐条实现的交付单元（每单元含具体文件/函数/改动内容/验收标准）。
2. **修订并执行（Revise & Execute）→ deepseek-v4-flash**：接收审计结论与交付单元清单，**按审计意见
   修订并落地代码**——逐条实现交付单元，同时把审计指出的修订直接改到位；不做设计决策、
   不扩范围、不解算、不夹带私货；单元有歧义时上报审计澄清，不自行拍板。
3. **复核（Review）→ deepseek-v4-flash**：复核执行结果是否与目标、审计结论一致，检查遗漏与副作用，
   给出"通过 / 返工"结论。

- 阶段之间有真实依赖的，在脚本里**串行**并写明闸门（如：审计判定"无需修改"或"否决"时
  直接返回主 agent，不进入修订并执行）。
- **执行前必须由审计拆解**：审计阶段把代码任务拆成细粒度、精确、可逐条实现的交付单元
  （每单元含具体文件/函数/改动内容/验收标准）；修订并执行档只按单元逐条落地，不自行拆解、
  不自行决策。单元有歧义时上报审计澄清，而不是自己拍板。
- 同一阶段内相互独立的分支用 `parallel()` / `pipeline()` 扇出
  （如多个审计分支针对不同模块并行、多个修订并执行分支改互不冲突的文件）。
- 只有当主 agent 需要在阶段之间**亲自裁决**（方案分歧大、目标本身需要修正）时，
  才拆成多次 workflow 调用或退回普通 subagent 逐阶段推进。

## 3. 模型路由规则（workflow 专属）
模型路由**不在** `subagent` / `subagent_fork` 的调用参数里——这两个工具已被部署 preset
（standard-glm）固定为 `adam/deepseek-v4-flash`，适合执行类单发委派，无法按调用换模型。
需要换模型的编排一律走 `workflow`：

| 工作类型 | 模型（provider=adam） | 写法 |
|---|---|---|
| 审计（读现状、出方案、拆单元） | `deepseek-v4-flash` | `agent(p, { provider: 'adam', model: 'deepseek-v4-flash' })` |
| 修订并执行（按审计意见改代码） | `deepseek-v4-flash` | `agent(p, { provider: 'adam', model: 'deepseek-v4-flash' })` |
| 复核（对照目标检查结果） | `deepseek-v4-flash` | `agent(p, { provider: 'adam', model: 'deepseek-v4-flash' })` |

判断标准一句话：**三阶段统一 → deepseek-v4-flash**。

要点与坑（2026-09-01 于本部署实测验证）：
- `agent()` **不带 opts 时继承主会话模型**（当前主会话为 gpt-6-astra，与 workflow 三阶段的 deepseek-v4-flash 不同）；为保持清晰、防止未来默认漂移，每一阶段仍显式填写 `provider: 'adam', model: 'deepseek-v4-flash'`。
- `agent()` 只支持 `label / phase / schema / provider / model` 五个 opts；
  需要结构化结论（如审计"需修改 / 无需修改 / 否决"、复核"通过 / 返工"）时用 `schema` 约束输出。
- **`schema` 只接受严格子集**：约束关键字 `type / oneOf / properties / required /
  additionalProperties / items / enum / const`，注解 `title / description / default /
  examples`；**其余一律报错**——`maxItems / minItems / minLength / maxLength / pattern /
  format / minimum / maximum` 等都不行，且 schema 校验失败是**致命错误，整个 run 立即
  失败并取消所有兄弟分支**（2026-09-01 实测踩坑）。要表达"最多 N 条"这类软性约束，
  写进字段的 `description` 里让子代理自觉遵守，绝不用未支持的关键字硬编码。
- **子代理不能也无需提权**：workflow/subagent 子代理继承父会话的沙箱模式（本部署即
  danger-full-access，已是最宽），且审批策略在派发边界被钉死为 never；再发起
  `sandbox_permissions` 会报 `sandbox escalation to "..." is not strictly wider than this
  call's current "danger-full-access" mode`。因此派给子代理（尤其修订并执行档，即写代码档）的 prompt
  必须写明"你继承 danger-full-access，直接写文件，禁止使用 sandbox_permissions"。
- `meta.phases[].provider/model` 只是**信息性注记**，不产生任何路由效果；
  真正生效的是每次 `agent()` 调用里的 opts。
- 脚本环境没有 timers / 文件系统 / 网络；脚本必须以 `return <JSON 可序列化值>` 结束；
  `args` 顶层必须是对象。
- workflow 的 provider、并发与总量上限是部署配置，不是脚本参数。
- 返回值会在 `maxResultChars` 处截断：让子代理返回**结论与裁决**，不要返回长篇原文。
- **run 不落盘、不可恢复**：workflow 引擎无 journaling，DSH 进程重启后进行中的 run 连同
  脚本中间值全部丢失（浏览器刷新无害——run 在 host 进程内，GUI 只是视图）。会话日志、
  已完成调用的结论、goal 锚点、子代理写过的文件都保留；普通 `subagent` 的 continuable
  子代理还可冷恢复，唯独 workflow run 不能。
- **磁盘是记忆，run 只是调度**：长链条编排让各阶段子代理把关键产物（方案、审计结论、
  执行清单）写成工作区文件（如 `plan.md` / `audit.md`），脚本里只传路径与裁决摘要
  （子代理有完整 fs 工具，没有 fs 的是脚本环境）。这样重启后新起一个 run 从磁盘接力，
  run 本身可牺牲；修订并执行子代理动手前核对文件现状的规则与此配套。

## 4. 任务细分与并行执行（效率优先）
- 动手前先把目标**分解**成多个相互独立、边界清晰的子任务；能并行就并行，只有存在真实依赖时才串行。
- **三阶段闭环、跨模块扇出、一切需要模型路由的编排，默认写成一个 `workflow` 脚本**：
  独立分支 `parallel()` 同时发起，依赖链写成顺序 `await`，质量闸门写进脚本逻辑。
- 不需要模型路由的简单单发委派，继续把多个 `subagent` / `subagent_fork` 放在同一条
  assistant 消息里一起发起（默认后台运行），不要一个跑完再启动下一个。
- 独立工作启动后**继续做别的事**，等它们返回后再汇总，不要空转等待。
- **workflow 阶段可靠性**：`agent()` 返回 `null` 或调用抛异常时，默认视为该阶段的临时失败；对每个阶段最多自动重试一次，重试必须使用新 label，并在磁盘报告中保留首次失败原因。审计明确判定 `needs-revision`、复核明确判定 `rework` 属于业务裁决，不得当作调用失败盲目重试。
- 推荐在 workflow 脚本中统一封装：`async function callWithRetry(prompt, opts) { let first; for (let attempt = 0; attempt < 2; attempt++) { try { const value = await agent(prompt, {...opts, label: `${opts.label}-attempt-${attempt + 1}`}); if (value !== null) return value; first = 'agent returned null'; } catch (error) { first = error instanceof Error ? error.message : String(error); } } return { __agentFailure: true, error: first ?? 'unknown agent failure' }; }`。阶段收到 `__agentFailure` 后应停止后续依赖阶段并返回结构化 blocker，不要解引用失败结果。
- **workflow 返回值安全**：最终 `return` 前递归检查结果，所有可选字符串/数字都用显式 fallback（如 `String(value ?? '')`、`Number.isFinite(value) ? value : 0`）；禁止任何 `undefined`、函数、Error、Agent 对象或其它非 plain-JSON 值穿透，否则序列化失败会掩盖真实阶段结果。
- **失败与产物分离**：workflow 失败后先检查审计/执行/复核报告、git diff 和测试盘面，再决定从磁盘接力；不得因最终复核调用失败而回滚已经通过本地测试的实现。

## 5. 编排原则
- 主 agent 的上下文只保留**高层状态**：目标、方案要点、审计结论、复核结论；不保留大段文件内容。
- 需要读大文件或大范围检索时，交给子代理，让它返回**结论而非原文**。
- 子任务之间通过"目标 + 方案 + 审计/复核结论"作为契约传递，减少主 agent 自行脑补。
- 若某阶段结论与目标冲突，回到目标重新裁决，而不是沿错误方向继续。

## 6. 例外
- 单轮、简单、无歧义的小任务不必套用三阶段流程，直接完成。
- 用户明确要求简化或快速处理时，优先服从用户的直接指令。
