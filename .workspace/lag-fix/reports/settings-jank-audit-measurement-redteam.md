# 设置页卡顿测量红队审查

- 审查对象：历史诊断、前后验收报告、交叉审计及 `measure-after-C1.mjs` 探针
- 审查性质：只读；未修改源码、配置或既有证据，未重启宿主
- 核心问题：为什么出现“指标通过”，但用户仍然卡顿？
- 总裁决：**历史材料可以支持“存在性能改善/存在会话列表与 usage 两类候选机制”，但不能支持“修复后设置页稳定通过门槛”或“改善可单独归因于 C1/P1/P2”。最主要原因是实验条件、负载类型、N、页面装载、窗口分母和报告选择同时漂移。**

## 1. 结论总表

| 命题 | 裁决 | 红队理由 |
|---|---|---|
| 原始基线数值本身真实存在 | **PASS** | `measure3.json` 与 `DIAGNOSIS.md` 的 script/task/style、p99、>50ms 帧逐字段一致；`measure5.json` 的 73 帧/s 也可回溯。 |
| 基线与“after”在同一工况下可直接比较 | **FAIL** | 基线 N≈2361、主要为 `session/event`；after 记录只有 `server-request`，且 N 既未被旧探针测出又从 2361 降至约734。 |
| C1/P1/P2 的方向有收益 | **INCONCLUSIVE（方向性支持）** | 微基准 2361 条 5.225→0.0838 ms/次支持 P1；但端到端 after 的 N、WS 类型、会话活跃度不匹配，不能定量归因。 |
| “空闲 script <60 ms/s”是稳定属性 | **FAIL** | after 同批有 45.0、16.4、27.5、62.8、84.3 ms/s；至少 62.8/84.3 超标。27.5 是单个有利窗口。 |
| “设置页 p99<50ms”是稳定属性 | **FAIL** | `measure-after-C1-v2` settings-open=100、dwell=83.4；独立复测 settings-open=66.7；仅 N734-active 单窗口为49.9。 |
| “>50ms 帧下降>50%”已被证实 | **INCONCLUSIVE** | 算术成立（22→4），但对照跨 N、活跃度和帧类型；同规模 C1-v2 idle 为9，只能说该次下降方向较好。 |
| 打开设置自身是卡顿热源 | **FAIL（作为独立热源）** | 安静态 A/B 面板脚本下降、面板 DOM mutation=0；设置更像会话 churn 的放大器。 |
| 设置无 memo/模型列表是乘数 | **INCONCLUSIVE** | 代码路径和离线 render-cost 支持潜在乘数，但活跃流条件下未直接计数面板 commit/mutation。 |
| 会话列表 churn 是客户端候选根因 | **INCONCLUSIVE（强候选，未完全证伪/确证）** | 代码、CPU profile、O(N²) 微基准相互吻合；但未在同 N、同事件流下做开关式因果实验。 |
| usage 同步 SQLite 是宿主冻结根因 | **PASS（针对插件访问后冻结机制）** | 访问插件后 host probe 出现297.5/476.5ms停顿，usage 查询300–500ms；未访问插件150s无>100ms停顿。修复后的运行时效果仍待重启实测。 |
| 所有历史数字均可追溯、口径一致 | **FAIL** | 2,396 被误当补丁前基线；items/信封字节混淆；734、1,225,755、647 等缺原始出处；RUNBOOK 与 BEFORE-AFTER 的 heatmap 数字冲突。 |
| 历史报告没有选择性呈现 | **FAIL** | 报告主张选了 N734 的27.5/49.9/4，却没有同批 N2396 的89.8/81.4/100和独立84.3/66.7反例；`measure-after-C1.json` 的 settings-open-failed 也被跳过。 |

## 2. 关键证据与失败模式

### 2.1 负载不是同一种负载：`WS 帧/s` 不能单独作为可比证书

基线 `measure5.json` 20 秒共1456帧、73/s，关键词分类为 `session/event` 1309（约65/s）、`session/projection` 139、tool 127、subagent 44 等。该流正是会话列表 churn 的候选驱动。

而 `measure-after-C1.mjs` 的 WebSocket 统计只取 JSON 顶层 `data.type`。after 四份 JSON 的 `ws_by_type` 均为 `{"server-request": ...}`，不是基线的 payload/事件类型。故“after 135/s 比基线73/s更重”只能说明**统计到的信封数更多**，不能说明 `session/event` 负载更多，更不能把两类分母/分子当同一个处理事件率。

**FAIL：按 WS 总速率判断活跃度可比。** 受控测量必须在同一 socket、同一消息分类（至少 session/event、session/projection、tool、subagent）上计数，并记录每类字节与时间。

### 2.2 N 是主变量，却与代码修复同时变化

原始诊断 N=2361（另有补丁前抓取2386）；after 主行 N734来自缩容推断/外部抓取。机制本身被报告定义为 O(N²)，而微基准在 N=2361 旧5.225ms/次、新0.0838ms/次。因此“121.4→27.5 ms/s、>50ms 22→4”的主比较同时改变了：

1. 代码（P1/P2/B1/C2）；
2. 会话规模（约2361→734，约−69%）；
3. 事件流的种类和强度；
4. 页面/探针状态。

这不能区分代码收益、数据缩容收益与负载偶然性。

**FAIL：主对比能证明修复收益。** 同 N 的 C1-v2 idle（约2396）45.0ms/s、p99=33.3、>50ms=9 是较干净但仍不完美的证据；它也没有被用作唯一正式验收依据。

### 2.3 会话 N 在旧探针中根本没有测到

历史 after JSON 的 `session_list` 为 `bytes:680, items:null`。这是裸 `fetch('/api/session.list', body:'{}')` 缺 RPC envelope 得到的 bad-request 响应；探针没有把 `items:null` 判为错误，所以表头 N=734/2396不是该探针测量结果。修订后的脚本已补 envelope、拆分 `envelope_bytes/items_bytes`，但历史结果没有因此自动获得 N 证据。

**FAIL：历史表的 N 条件可追溯。** 新探针应在每个窗口/同一页面记录成功的 session.list 快照，且 `items===null` 必须使运行 FAIL，而不是静默继续。

### 2.4 页面装载状态存在整档失效，且没有质量门禁

`measure-after-C1.json` 的 settings-open 实际是 `settings-open-failed`，`dom_nodes_total=108、panel=0`；后续正常页面约584/755、面板168。该运行如果被当作正常 three-phase 结果，会把“设置页指标”测成没有设置页的指标。探针只等待固定5秒，没有检查 runtime ready、session.list 成功、设置触发器可见、dialog/panel 节点存在、页面是否发生热替换。

**FAIL：所有历史窗口均为有效页面装载。** 任何 phase 都应有 precondition：页面 ready、DOM 基线在允许范围、设置打开后 panel>0；否则该窗口标记 invalid，不得参与门槛统计。

### 2.5 窗口分母历史上曾错误，修复后仍需验证

旧脚本每窗将 `wsTotal` 清零，却使用装置安装时刻 `started` 作分母，后续窗口系统性低估：N734-active 的 dwell 记录仅1.7/s（110帧/约65秒）就是典型。当前代码已在每个窗口设置 `windowStart`，这是代码层 **PASS**；但历史结果混用旧分母和新分母，不能放在一个表里比较。

此外 rAF、CDP delta、WS 都在相对不同的时点开始/结束；应记录每个计数器的实际 `t_start/t_end`，并在同一窗口内取共同有效区间。否则“窗口20秒”只是 sleep 时长，不一定是每个分子的20秒。

**PASS（代码修复），FAIL（历史可比性）。** 必须重跑所有正式 before/after，不能修旧 JSON 的数字。

### 2.6 选择性报告与统计不足正是“指标通过但仍卡”的直接解释

正式门槛实际上依赖单个挑选窗口：N734-active idle 27.5、settings-open 29.6/49.9/7；同批 N2396 settings-open=89.8/p99=100/dropped帧25，dwell=81.4/p99=83.4；独立复测 idle=84.3、settings-open=70.2/p99=66.7、dwell=93.4/p99=83.3。均值、置信区间、失败率、窗口排除规则均未预先定义。

20秒窗口、n=1/phase 无法估计重尾卡顿率。p99 在约1100帧上只有约11个尾部样本，差一个长任务就可能改变阈值；“49.9<50”仅余0.1ms，远低于测量抖动。没有报告中位数、IQR、p95/p99的跨重复分布、超过门槛的比例，也没有盲法/预注册窗口选择。

**FAIL：三项门槛已统计学成立。** 正确表述只能是“某窗口观测通过”。

### 2.7 主线程 usage 机制与客户端 churn 需要分层，不应被一个“script ms/s”混为一谈

诊断证据对 usage 访问后的 host event-loop 停顿很强：未进插件150秒 max7.9ms、>100ms=0；进插件45秒出现476.5/297.5ms停顿。usage 查询多数300–500ms，且同步 `DatabaseSync` 全表扫描。这可解释用户感受到的偶发整段冻结，即使客户端 script 指标“通过”。

反之，客户端 script/rAF 指标不能捕捉宿主事件循环同步阻塞的全部体验，尤其是冻结发生在窗口外、或被设置页打开时序错过时。验收应同时报告：host RPC latency/停顿、浏览器 long task/rAF、WS event backlog、用户交互响应（click-to-paint）。

**PASS：usage 访问后存在独立宿主冻结证据。** **INCONCLUSIVE：补丁重启后的 host 侧修复是否已生效**，因为相关 after 运行时证据尚未完成。

## 3. 对现有探针的逐项红队裁决

| 探针/字段 | 裁决 | 需要的硬化 |
|---|---|---|
| `script_ms_per_s`（CDP delta/窗口秒） | **PASS（量纲）/INCONCLUSIVE（体验代表性）** | 同源计算正确；增加窗口实际起止、主线程 busy ratio、long-task分布。 |
| rAF p99、`frames_over_50ms` | **INCONCLUSIVE** | 仅一个20s窗口不足；预热、后台/前台、页面可见性、刷新率必须固定，报告每次原始帧数组摘要。 |
| `ws_rate_per_s` | **FAIL（历史旧结果）/PASS（现代码分母）** | 现分母已窗口化；仍须统一 payload 分类、两条 socket、连接建立时点。 |
| `ws_by_type` | **FAIL（跨版本口径）** | 基线按关键词/嵌套 payload，after按顶层 envelope type；必须写统一 classifier。 |
| `session_list` | **FAIL（旧结果）/PASS（现代码设计）** | 旧结果全无N；现代码 envelope正确但应对 null/错误硬失败，并把N快照绑定到窗口。 |
| `dom_nodes_panel` | **PASS（页面存在性指标）/INCONCLUSIVE（重渲染证据）** | DOM节点数不是 React commit 计数；需 panel MutationObserver、commit计数或 performance mark。 |
| `baseline_reference` | **FAIL（被当作自动可比）** | 脚本内嵌基线只供提示，不保证同 N/同负载；`compare()` 未曾产出正式对照。 |
| settings-open phase | **FAIL（无质量门禁）** | 必须等待并断言 dialog/panel；失败 phase 应 abort/deem invalid。 |
| 宿主 host latency | **PASS（诊断期证据）/INCONCLUSIVE（after）** | 重启后重复 usage closed/open 配对，记录每次 usage endpoint 与 host probe 时序。 |

## 4. 能真正证伪根因的受控重复实验

### 4.1 实验设计原则

采用随机化、分层、配对的 2×2×2 因子设计；每个 cell 至少 8 个独立重复（建议12），每次重复先新开浏览器页面并固定预热，窗口≥60秒（前10秒预热不计），每个阶段保存原始事件时间戳，不允许只保存汇总。所有 before/after 在同一个宿主实例、同一个浏览器版本、同一显示刷新率下完成；若必须跨重启，按区组(block)配对并将重启作为区组因子。

因子：

- **代码**：pristine baseline vs P1/P2/C1 patched；如不能切换 live，使用两台隔离 profile/容器或同一快照回滚，不能以不同日期代替。
- **N**：高 N≈2361 与低 N≈734；N 必须由正确 RPC 在每个 run 实测，且 session payload hash/字节留档。
- **设置状态**：关闭、打开通用、打开模型并明确是否展开 adam；插件 usage 单独分层 closed/open（进入插件会触发另一机制）。
- **活动负载**：受控 replay generator 产生固定 `session/event`、`session/projection`、tool、subagent 各类速率；另设真正静默 cell。不能以“当前会话自然活跃”代替负载控制。

### 4.2 流程与记录

1. 固定宿主、浏览器、CPU governor/容器配额、窗口大小、DPR、前台可见性；记录 commit/revision、bundle SHA、宿主 PID。
2. 启动页面后等待明确 ready 条件：runtime ready、首次合法 session.list、DOM节点范围、WS 两 socket open；失败即整次 run 无效。
3. 每个 run 先采60秒 baseline，随机决定 settings closed/open 顺序，避免总是“打开后更热”的时序混淆；打开后再等待 dialog/panel confirmed。
4. 同一窗口同步记录：CDP Script/Task/Recalc/Layout、rAF原始间隔、LongTask API、交互 click-to-next-paint、WS 每 socket/每 payload type 的消息数和字节、session N/bytes/hash、DOM/Mutation、host probe RTT/p95/max/停顿、usage endpoint耗时。
5. 每个阶段至少连续5个60秒窗口，窗口间固定冷却；保存所有窗口，不得只挑最好一个。若遇页面未装载、后台化、连接重连、热替换，标 invalid 并报告比例。
6. 预注册主要终点：`settings-open` click-to-paint p95、>50ms帧率、long task总时长、host停顿>100ms；script_ms/s仅为辅助终点。

### 4.3 证伪判据

- **证伪 M2（会话 churn）**：在代码相同、N高、设置相同、固定 session/event replay 下，降低 N 或将 event/projection 速率降至静默后，客户端卡顿不下降；或者 P1/P2 与 baseline 在同 N/同 replay 的主要终点无差异（预设效应量，例如 script busy ratio下降<20%、p95交互下降<20%）。
- **支持/反驳 P1/P2**：同一 N、同一 replay、同一页面状态、paired baseline/patched 的 buildListSnapshot次数与耗时、script busy ratio、rAF尾部均改善；若只在 N734改善而 N2361不改善，则归因不稳定。
- **证伪“设置页是源头”**：静默 replay 下 settings closed/open 的 click-to-paint、long task、rAF尾部无增加；若活跃 replay 下仅面板 commit/Mutation与模型页展开时显著增加，则结论改为“设置是条件放大器”。
- **证伪 M1（usage同步SQLite）**：在同一宿主、usage closed/open 随机配对中，打开插件不再导致 host probe停顿>100ms，且每个 usage endpoint p95<40ms；若仍有停顿而浏览器指标正常，M1修复未生效或另有宿主根因。
- **证伪“通过即不卡”验收规则**：用用户可感终点（click-to-next-paint p95、长任务>100ms比例、host freeze）作门槛；若 script<60但交互p95/host freeze失败，则原指标不是充分验收指标。

### 4.4 最低报告格式

每个 cell 报告 `n`、中位数、IQR、p95/p99、bootstrap 95% CI、超门槛比例和所有 invalid run；同时列出 N、每类 WS 速率、页面 ready 状态、usage 状态、bundle hash。不得把“某一窗口通过”写成“系统通过”；不得在代码、N、负载、页面状态同时变化时做因果百分比结论。

## 5. 最终红队结论

“指标通过但用户仍卡顿”不是矛盾，而是验收指标测到了一个**有利窗口中的浏览器脚本均值/尾部**，没有稳定测到用户路径中的两个独立问题：

1. 活跃会话列表 churn 的客户端重建/渲染尾部；
2. 访问 usage 后宿主同步 SQLite 的偶发数百毫秒事件循环冻结。

历史材料对这两个候选都给出了有价值的方向性证据，但由于负载类型、N、页面装载、窗口分母、选择性报告和 n=1 统计缺陷，不能声称根因已经通过受控因果实验，也不能声称三项客户端门槛已经通过。下一步应先按 §4 重建同 N、同 payload 类型、同页面 ready、同窗口分母的配对实验，再决定修复是否真正消除用户卡顿。
