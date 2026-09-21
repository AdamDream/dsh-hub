# 设置页卡顿问题：大规模交叉对抗式综合裁决

- 审计日期：2026-09-21
- 目标：解释“局部指标变好但用户仍感到设置页卡顿”，不把单次漂亮窗口当作通过。
- 纪律：8 条独立审计线并行；只读审计；未修改产品源码、部署件、配置、数据库或宿主进程；活体线未点击保存/应用/删除/模型切换。
- 参与报告：
  - `settings-jank-audit-client-render.md`
  - `settings-jank-audit-host-loop.md`
  - `settings-jank-audit-usage-plugin.md`
  - `settings-jank-audit-runtime-hotspots.md`
  - `settings-jank-audit-measurement-redteam.md`
  - `settings-jank-audit-live-repro.md`
  - `settings-jank-audit-architecture-crosscheck.md`
  - `settings-jank-audit-adversarial.md`（F6 后半段曾发生输出截断；已采纳其已落盘的 F1–F6 证据，未把未落盘部分当作事实）

## 一、总裁决

### 裁决 A：设置页自身不是单独的持续卡顿源

安静态反事实中，设置打开/模型页多数窗口没有持续 DOM mutation，模型页曾出现约 9ms/12s script 且无 >50ms 帧；设置接口 `settings.describe`、插件 inventory、LLM RPC 均为毫秒级。活体复现中设置打开两次、插件两次和 5s 停留窗口多数稳定，但首页首轮出现 116.6ms max，模型/子代理阶段出现 50–99.9ms 尖峰。

因此不能把“点击设置后必然自循环”作为根因；更准确的是：**设置页是外部事件流的放大器/观察窗口，而非唯一点火源**。

### 裁决 B：首要残余客户端机制是 session/event → projection → list.set → 下游渲染链

证据链在客户端、runtime、宿主和红队报告中一致：

```
session/event 或 session/projection 高频流
→ notifier / buildListSnapshot()
→ projectList() 构造 ids/byId 与派生 catalog/jobs
→ list.set / store 通知
→ sidebar、workspace selectors、SettingsRoot、SlotOutlet 重算
→ 活跃流下长任务、recalc/layout、长帧
```

P1 把 entryCache 清理从 O(N²) 降为 O(N)，N=2361 时局部清理约 5.225ms→0.0838ms；P2 在内容等价时复用引用；C2 只覆盖第三方辅助映射约 4.9% 的重建成本。这些收益真实，但均不消除：

- 每次真实 projection/jobs/status/event 内容变化仍会触发 snapshot/projectList；
- SettingsRoot/SettingsPanel 没有组件级 memo 边界；
- SlotOutlet/outlet dispatch 没有通用 memo 隔离；
- workspace 派生和 descendants index 仍遍历列表；
- C2 的 body subtree MutationObserver 和过宽 sessions/workspaces 订阅仍会在高事件率下做同步辅助工作。

**结论**：此前“P1/P2/C2 已生效”不能推出“设置页不卡”。最可能的用户可感根因是**高频会话 churn 叠加下游渲染放大**。

### 裁决 C：usage 同步 SQLite 是独立的严重冻结机制，但当前 live heatmap 旧主因已被压下

历史证据强烈支持进入设置→插件后旧 `/usage/heatmap` 同步 SQLite 查询造成约 285–309ms，host probe 曾见 297–476ms 级冻结；usage 45s ingest 在大日志集上仍可能造成约 478–846ms、历史更大集约 924–980ms 的主线程阻塞。

> ⚠️ **2026-09-21 更正（口径收窄）**：478–846ms / 924–980ms 来自 `measure-ingest2.mjs` —— 它在**独立进程**里导入**真实 deployed** `ingest-dsh.js`，遍历最大 3 个日志做**强制同步 read+parse**。因此它是 **deployed parser 路径的基准**，**不是当前宿主 45s ingest tick 的实测**（无可回溯的当时 hash）。旧报告 `settings-jank-audit-host-loop.md:28` 已作限定，本文件此前的写法过宽，现更正。真实机制事实（读源码）：DSH dirty 全文件同步 read+zstd+逐行 parse；CC 全读但只按 `last_offset` 解析后缀（**不是**全量 parse）；SQLite 全同步 `DatabaseSync`。worker 化方案与前置验证见 `.workspace/lag-fix/ingest-gate/audit.md`（仅设计，未实现）。

当前 live 配对探针 heatmap 约 2.14–12.1ms、host probe 最大约 23.09ms（样本仅两对），说明旧 heatmap 路径不再足以解释当前所有卡顿；但不能把两对测量当成完整 after 验收。usage 仍是“进入插件/后台 ingest 时整段冻结”的独立叠加机制，必须与客户端 churn 分层测量。

### 裁决 D：历史“设置页门槛通过”不成立

红队交叉确认：

- 基线与 after 的 N 同时从约 2361/2386 变到约 734，且 session/event 与 server-request 帧口径混用；
- 旧探针曾恒返回 680B、`items:null`，表头 N 并非探针实测；
- 页面未完成装载的 settings-open-failed 窗口曾进入材料；
- 历史 after 同批存在 script 45/16/27/62/84ms/s，settings p99 83/100/66.7ms 的反例；
- 20s、n=1、挑选窗口、无预注册排除规则，不能证明稳定属性。

因此正式状态是：**方向性改善成立；稳定通过未成立；因果归因未成立**。

## 二、反方发现的额外风险（当前不擅自修）

1. **P2 synthetic address-chain stale row**：`projectList()` 在 ids 不变时从旧 `previousProjection.byId` 回拷当前 manager items 缺失的 synthetic child；currentAddress 变化不必然清除旧 child。必须用离线 harness 复现，不能直接认定已影响用户。
2. **usage 请求无取消/代次保护**：筛选快速变化时旧 Promise.all 可能晚回写，覆盖新筛选结果。当前是代码证明的风险，未做乱序 stub，不宣称已现场发生。
3. **C2 订阅/扫描过宽**：body subtree MutationObserver 对任意 childList 变化安排扫描；sessions/workspaces 任一快照变化都会触发辅助索引。C2 只缓存数组映射，不解除订阅或缩小扫描范围。
4. **B1 最近 N 的状态语义降级**：running subagent 排名超过 200 时，保留窗口外运行子代理会被聚合漏计。当前 payload 3 个 running 均在窗口内，不能作为未来态等价证明。
5. **visited tabs hidden 保留**：已访问 settings tab 只隐藏不卸载，长期会累积 DOM/订阅；现有 0 usage 请求不能证明组件已卸载或 timer 已清理。
6. **usage bootstrap 卸载竞态**：host `queueMicrotask` 中 await DB open/ingest 后才安装 timer disposer，若卸载发生在 await 期间，缺少 disposed/generation guard 可能在卸载后继续安装 timer；需隔离 stub 验证。

## 三、证据强度与排除项

| 命题 | 裁决 | 强度 |
|---|---|---|
| P1 局部 O(N²) 清理改善 | 已证实 | 强 |
| P2/C2 引用/辅助映射局部改善 | 已证实 | 中强 |
| session churn 是主客户端候选 | 强候选，未完成同负载因果实验 | 强方向、未因果闭环 |
| SettingsRoot 无 memo 是活跃流放大器 | 源码确定，活跃 commit 未直接计数 | 强代码、中等运行 |
| 旧 heatmap 同步 SQLite 冻结 | 历史端到端与源码三角证据 | 强历史；当前 after 仅两对 |
| 当前设置页稳定通过 | 否 | 已证伪/未成立 |
| settings.describe/pluginInventory/LLM 为主因 | 当前证据不支持 | 已基本排除 |
| 设置自有持续 timer/RAF 循环 | 当前证据不支持 | 已基本排除 |

## 四、执行前必须补的最小实验（不改 live）

### E1：活跃流 React commit 计数（优先级 P0）

固定浏览器、viewport、同一已展开 provider；分别 settings closed / 通用 / 模型 / 插件；同一时间记录 session/projection payload 类型与速率、CDP Script/Task/Recalc/Layout、LongTask、rAF 原始间隔、click-to-next-paint、panel/body/sidebar Mutation，以及 SettingsRoot/SettingsPanel/ProviderEditor/ModelListEditor commit 次数。安静态 mutation=0 不能否证 React render。

**验收**：若 SettingsPanel commit 与 session/projection 同阶且关闭后显著消失，确认 memo 边界为最小修复入口；若设置 commit 不变而 sidebar CPU 增加，先修 runtime/list 消费侧，不改设置页。

### E2：同 N、同 payload replay 的补丁阶梯

隔离 harness 或 profile 中比较 pristine、P1、P1+P2、P1+P2+C2；N 高/低各一组，固定 session/event、projection、tool、subagent 速率；每 cell 至少 3–5 个 60s 窗口，记录 buildListSnapshot/projectList/list.set 次数与耗时、React commit、click-to-next-paint p95、long task、rAF p95/p99、host probe。不要再用自然活跃流替代 replay。

### E3：usage/client 解耦

重启后正确 RPC 读端点：通用页 closed/open 配对，再进入插件页首次 load、60s 轮询窗口；同时记录 usage endpoint wall time、host.describe RTT/p95/max、浏览器 long task、session/event 流。若 host 300–500ms 尖峰而无对应 React commit，归 M1；无 usage 请求仍高则归 M2。

### E4：P2 stale-row 与 B1 N=200 反事实

离线 harness 构造 address-chain child 在旧 projection、下一轮 ids 不变但 currentAddress 消失，检查 child 是否被错误保留；构造 201 个 subagent 且第 201 个 running，检查顶层 running count 是否漏计。两者不能触碰真实会话。

### E5：usage 生命周期与旧响应竞态

隔离 stub 延迟 `openUsageDb`/首扫，apply 后立即 dispose，断言不安装 timer且 DB关闭；浏览器侧让旧筛选批次延迟、新批次先回，断言旧结果不得覆盖新结果。两者都不写真实 DB、不点刷新。

## 五、后续修订单元（仅方案，未执行）

- **R1 客户端隔离**：在 E1 证实时，将 SettingsRoot/SettingsPanel/renderer outlet 的 sessions 订阅收窄并增加 memo/selector 边界；验收为活跃 replay 下 SettingsPanel commit 与 closed 基线不再同阶，且功能冒烟 8/8 不回归。
- **R2 runtime 事件降噪**：在 E2 证实后，按字段/事件类型拆分 list snapshot，减少与设置无关的 projection/status 更新触发下游；保留真实内容更新语义。验收为相同 payload replay 下 list.set/commit/长任务 p95 下降，且列表状态一致。
- **R3 C2 订阅边界**：将 body 全树观察改为目标容器/行级观察，按 title/cwd 等真正影响 badge 的字段选择性订阅；先用 E2/E1 证明收益，避免盲修。
- **R4 usage 请求代次/卸载**：为 loadAll/loadSessions/loadStatus 加 generation/AbortSignal/mounted guard；为 host bootstrap 加 disposed/generation guard；不改变默认中转端点或业务数据口径。
- **R5 B1 语义修订**：修 cold header 不存在 `updatedAt` 的排序问题，并明确 N=200 对 running count 的降级语义；必须先决定“状态完整优先”还是“下发削峰优先”，不能继续称完全等价。
- **R6 测量框架硬化**：修 session.list RPC envelope/null hard-fail、统一 WS payload classifier、窗口起止分母、页面 ready/panel>0 门禁；正式结果保留所有 invalid runs，禁止挑选最佳窗口。

## 六、最终状态

本轮目标是审查而非修代码，故**没有执行 R1–R6**。当前结论不是“无解”，而是已把卡顿拆成两个需要分别闭环的机制：

1. 客户端：高频 session churn 驱动官方 runtime 全量投影与下游无 memo renderer；
2. 宿主/插件：usage 查询与 ingest 的同步 SQLite/大日志工作造成独立长冻结。

下一步应先做 E1–E3 的最小实验，再按两阶段流程进入“审计结论 → 修订执行复核一体”，不应直接把 R1/R2 任一项写进 live。
