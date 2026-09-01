# dsh-taste 方案审计报告（拆分切片汇总）

> 审计方式：原重型审计员中断 salvage + 两个并行轻量切片（事实核查 / 边界风险）+ 主代理亲做完整性切片 + salvage 尾批增量（激活链路/安装链路/worker 线程三项实证）
> 主代理先行验证锚点（已采信为前提）：atomic-write 导出、workspace 无 git-root、childSessionMeta 三重判定、fork/spawn 共用 meta、serial 根级分发（learner 事件可达根监听器）、README 认证 turn-stopping

## 切片一：事实核查（子代理 205e3eaa）—— 5/5 ✓

| # | 核查项 | 结论 | 证据 |
|---|---|---|---|
| 1 | turn-stopping 触发条件：abort/error、pre-step reject 均不触发 | ✓ | dsh-agent-loop:564-568（dispatch 仅在 step 完成后的循环内）；reject :538-541 置 blocked 后 return false 直落 finally；abort catch :575-580 throw、error catch :581-589 throwError 均绕过 |
| 2 | turn-stopping payload 无 reason（completed 与 max-tokens 同 payload） | ✓ | dsh-tool-cordis:3870 签名 {agent, turn, signal}；agent-loop:565-568 只传 {turn, signal} |
| 3 | ctx.agents.create({sessionId,meta,agentOptions,signal,setup}) + withInitiator(agent,fn) | ✓ | dsh-agent:545-556 + 官方调用点 in-process-driver:178-186 实证；withInitiator 在 dsh-agent:490，"重建 initiator 边界"语义成立 |
| 4 | invocation.rawInput / invocation.agent 存在，按首词分子命令可行 | ✓ | dsh-command-feedback:61/65/79 + dsh-commands:101 |
| 5 | dsh-llm 导出 createUserMessage；dsh-settings 导出 installSettingsSection/settingsNamespace | ✓ | dsh-llm:176/1658；dsh-settings:618/87/638 |
| 6 | interpolate {{}} 崩溃入口不存在：唯一 section 调用喂静态 LEARNER_PROMPT，动态 taste 快照走 pre-step createUserMessage | ✓ | 方案 §3/§4 结构核验 |

**两条注释级建议**：① agent-loop:571 微窗口——turn-stopping 已触发后才 abort 的轮，事件已发（模型输出完整，采集影响极小）；② 方案 §1 对 vision-adam 的佐证引用应注明"来自 ~/.dsh/profiles/node_modules/ 的用户安装副本"（核查员在 web profile node_modules 未找到属目录混淆，主代理已在 ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam 亲核过该包及其三件套 import）

## 切片二：边界与风险（子代理 b1991bb1）—— 1 高 / 3 中 / 2 低

| # | 边界 | 风险 | 修订建议 |
|---|---|---|---|
| 1 | 监听器异常安全：§3 无 handler 整体 try/catch 要求——serial handler 抛错会打断用户 turn 收尾、整轮置 error | **高** | serial handler 整体 try/catch（log-and-return），切片/Job 构造/入队全包；§3 列硬性约束 + "畸形事件"单测 |
| 2 | learner 递归：in-flight Set 时机未钉死；meta.origin 落 session header 持久有效，重放/late 事件仍可判 | 低 | 钉死时序："create 前入 Set，finally（dispose 后）移除"；以 meta.origin 为主判据，Set 作冗余 |
| 3 | 事件风暴与失败处理：无界队列 + learner 失败无重试/退避/熔断——provider 故障时每轮烧一次注定失败的 ≤120s 调用且静默 | **中** | 队列长度上限 + 积压合并（保留最新）；连续 3 次失败熔断冷却 10 分钟；状态在 /taste status 可见 |
| 4 | 多 session 并发写：锁只护单次读/写，"读→LLM 决策→写"窗口裸奔（较 pi-taste 严格更好，RMW 同类） | 中 | write/edit 改锁内"读当前→合并增量→写"；或 write 附内容哈希乐观校验，不匹配重读重试一次 |
| 5 | shutdown drain：30s race < 120s learner timeout；signal 未接插件 unload——插件卸载后 learner 继续后台跑（dispose 语义本身安全，无孤儿锁/半写） | 中 | create 显式传插件 ctx signal（unload 即确定性取消）；finally dispose；race 落败分支 catch |
| 6 | abort 轮次遗漏（§10.1 自报准确）：补扫可行性高——事件日志可重放、turn/end 带 reason、abort 轮从不进 collector（纯增量无重复） | 低-中 | 补扫提前到 P1：只扫 reason.kind=aborted 且内容非空的轮，watermark 持久化 |

**Top-2**：#1（唯一直接破坏用户可见行为的回归，必修）；#3（inherit 模式绑同一 provider，故障时无限静默重复失败，一个计数器即可消除）。

## 切片三：完整性与可实施性（主代理亲评）

### C15 需求覆盖：基本完整，一处缺口
- 学习管线/注入时序/存储/安全/配置/测试/分阶段计划全覆盖（§3-§10）
- **缺口：命令族遗漏 `/taste remember`**——pi-taste 的手动记录命令（显式用户动作、零 LLM 成本、重要逃生舱）。提案 hint 列表 "<status|on|off|list|forget|paths|import|model>" 与 M0 交付清单均无 remember（也无 move，可接受简化）。修订：M0 命令清单补 remember，实现走锁+原子写直插 taste.md（importer 同路径，+~15 行）

### C16 工作量估计：现实，微调
- storage.js ~480（移植 521 行）✓；learner.js ~190（省掉自建模型循环）✓
- index.js ~170 行要承载 钩子+队列+守卫+**8 个子命令** 偏紧；修订：命令处理拆出 commands.js ~100 行（总量不变，M0 行数 ~1150）
- M0 2-3 天（不含 90/75/85 覆盖率门槛的测试；含测试 4-5 天）

### C17 DSH 惯例：无遗漏
- vision-adam 证明第三方本地插件只需 lib/index.js + package.json；invariant.js/README.i18n.yaml 为官方包惯例非必需
- 安装链路（install-plugins.sh 拷贝 → cordis.patch.yml insert → 重启）与用户既有先例一致

## 切片四：salvage 增量（原审计员尾批，三项实证 ✓）

1. **B14 激活语义（升级为必修）**：声明 inject → 服务未就绪时插件完全不激活（epoch=INACTIVE，cordis/lib/index.js:1316-1342），就绪后才 apply；服务永不出现 → 永不激活且 boot 兜底审计 fail loud（dsh-app-boot:1107-1136，报 "pending (waiting for services: …)"）；**不声明 inject 直接用 ctx.commands → 抛错**（cordis:672-697 "cannot get property \"commands\" without inject"）→ 插件加载失败。方案未明文枚举 inject 数组——必须显式声明 `inject = ["agents", "commands"]`（P1 加 settings 后补 "settings"）
2. **patch 安装链 ✓**：`- insert:[{id:'taste',name:'…'}]` 顶层追加写法成立（dsh-app-boot:57-106）；加载顺序 bundle→profile→home→--patch；本地相对/裸名路径均支持（锚定 profile 目录）。§9 测试策略论断属实，无需修订
3. **worker 线程担忧证伪（§10.2 降级）**：两个 worker 线程都不跑 cordis 插件集——workflow worker 的 agent() 经 MessagePort RPC 回传宿主、由宿主 subagents.start 启动（dsh-workflow-worker-thread/worker.cjs:404-418,633-659；宿主引擎 static inject=["subagents"] :845）；code-runtime worker 只收代码+绑定清单（dsh-code-runtime-worker-thread:737-750）。workflow 派生的子代理仍跑在宿主、带 parentSession，已被 isSubagent 防住——§10.2 从"开放风险"降级为"已证伪"，e2e 验证降为一次性确认

## 总评：**需修订（轻微）——事实基础全部核验通过，架构选型正确，修订项均为工程防护级**

事实核查 5/5 ✓：方案引用的全部 DSH API/事件/导出与源码一致，interpolate 崩溃入口确认不存在。边界审计识别 1 高 / 3 中 / 2 低：无一推翻架构决策，全部是可局部收敛的工程防护。

### 修订指令清单（按优先级）
| # | 级别 | 位置 | 指令 |
|---|---|---|---|
| R0 | **必修-高** | §2 | 插件显式声明 `inject = ["agents", "commands"]`（P1 接 settings 后补 "settings"）——不声明则 ctx.commands 访问直接抛错、插件加载失败（cordis:672-697），声明后服务缺失也会 boot fail loud 而非静默半激活 |
| R1 | **必修-高** | §3 | serial handler **整体** try/catch（log-and-return），切片/Job 构造/入队全部包入；补"畸形事件"单测——这是唯一会直接毒化用户 turn 的回归 |
| R2 | 必修-中 | §3/§10 | 队列长度上限（建议 3）+ 积压合并（保留最新切片）；连续 3 次失败熔断冷却 10 分钟；失败计数在 /taste status 可见 |
| R3 | 必修-中 | §4 | learner create 显式传插件 ctx signal（unload → prepare() 融合 callerSignal → 确定性取消 in-flight）；finally 中 dispose；shutdown race 落败分支也 catch |
| R4 | 建议-中 | §4 | write/edit 工具改锁内"读当前→合并增量→写"，或 write 附内容哈希乐观校验 + 重读重试一次（关闭跨 LLM 的 RMW 窗口，无需持锁跨调用） |
| R5 | 建议-低 | §3 | 钉死 in-flight Set 时序："create 前入 Set，dispose 后 finally 移除"；以 meta.origin 为主判据（持久、无窗口），Set 为冗余 |
| R6 | 建议-低 | §9/§10 | abort 轮补扫从 P2 提前到 P1：watermark 持久化 + 只扫 reason.kind=aborted 且内容非空的轮（abort 轮从不进 collector，纯增量无重复） |
| R7 | 建议-低 | §7 | M0 命令清单补 `/taste remember`（手动记录，零 LLM 成本，走 importer 同路径，+~15 行） |
| R8 | 注释 | §1/§10 | ① agent-loop:571 微窗口（turn-stopping 已发后 abort，采集影响极小）注明；② vision-adam 佐证引用注明来自 `~/.dsh/profiles/node_modules/` 用户安装副本（web profile node_modules 无此包）；③ §10.2 worker 线程担忧改写为"已证伪"（worker 不跑插件集，派生代理带 parentSession 已被防住），e2e 验证降为一次性确认 |
| R9 | **必修-高**（主代理实现准备期新发现，方案 v2 已落地） | §3 | **注入通道从 pre-step append 改为 `systemPrompt.context()`**：① pre-step append 每次注入累积在 surface（time-context 模式固有行为），taste 快照逐轮膨胀；② context() 通道由 RuntimeContextProjection 管理——内容变化才追加、稳定零重复、compaction 清旧后自动重注入、追加语义 KV-cache 友好；③ text fn 收到 {agent} 可按 agent 门控；④ **代价**：context 文本过 interpolate()——`{{未注册变量}}` throw 打断 turn、`{{model}}` 等已注册变量静默替换损坏文本 → **必须 sanitize：replaceAll("{{", "{ {")**，配专项单测。证据：dsh-system-prompt:99-127/196-210、dsh-agent-loop:20-84/496-507、dsh-agent:384-390 |

### 结论
R0-R9 已全部落入方案 v2（`dsh-taste-proposal.md`）。R4 已升级为必修（锁内 RMW）并落地 §4。方案可进入执行阶段，无需二次审计（无架构级未决项）。
