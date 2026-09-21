# 设置页卡顿：客户端 React/DOM/render 只读审计

- 审计对象：`http://127.0.0.1:3080`，工作区 `/home/CNS2026495165/dsh`
- 纪律：只读；未修改源码、配置、live bundle，未点击保存/应用/删除/模型切换，未重启宿主。
- 依据：`.workspace/settings-lag/DIAGNOSIS.md`、`.workspace/settings-lag/audit-client.md`、现有探针 JSON/截图、`.workspace/lag-fix/reports/audit-cross-client.md`、live bundle 静态行号复核。
- live 字节复核（本次只读 hash）：runtime `a0fb4bb225d3aa09f6864321090b3c670495df59`；ui-workspace `5596cec54007779b007cb3cd874a0ae75604acc6`；workspace-enhancement `7df7a655ee660eb29dd8ee87d4b20fa3f06a16faee80c52baf612d6e7ffef90d`。与 cross-client 报告的 HTTP/live/交付副本三方一致结论相符。

## 1. 裁决摘要

### 真实根因候选（按证据强度）

1. **首要根因：会话列表投影/快照 churn（强证据）**。活跃会话事件流驱动 `session/projection` → manager notifier → `buildListSnapshot()`；在 2361 条规模下，CPU profile 第一热点是 `buildListSnapshot`（9.2% 非 idle），基线实测约 121 ms/s script、设置停留约 190 ms/s，p99 约 116.7 ms，>50 ms 帧 40。`projectList()` 在补丁前会重建 `ids/byId` 并无条件 `list.set`，使订阅者看到新引用并重渲染整棵相关 UI。
2. **直接放大器：设置根/面板没有 memo 边界（强代码证据，中等运行证据）**。`dsh-client-ui-settings-general/lib/client.js:188-190,213-219` 的 `SettingsRoot` 订阅 sessions，且直接创建普通 `SettingsPanel`；全文件无 `memo`。renderer 的 `SlotOutlet`/`renderOutletContent`（`dsh-client-ui-renderer/lib/client.js:741-759`）同样无 memo。因而当 sessions snapshot 真正变化时，设置子树有结构性机会跟随重渲染；但本次已有观测均为安静态，未直接计数“活跃帧→面板 React commit”。它不是独立点火源。
3. **次级放大器：模型编辑器全量 map、无虚拟化（强代码/微基准证据）**。`dsh-client-ui-settings-models/lib/client.js:896-991` 对每个模型实例化完整行（2 input、2 button、svg）；现有 `render-cost.json` 的 66 模型默认折叠 20 元素/0.1186 ms，编辑态 523 元素/1.7407 ms；历史扫描 N=300 为约 6.13 ms。只有打开 provider 编辑器时才显著，不能单独解释默认设置页卡顿。
4. **插件 tab 访问后的渐进放大（中等证据）**。`dsh-client-ui-settings-plugins/lib/client.js:489-498` 对 `visitedIds` 保留所有访问过的 panel，仅 `hidden`，不会卸载。会增加 DOM/订阅存量，但首次打开设置或单一默认 tab 不能解释持续严重卡顿。
5. **跨设置推送 reload（中等代码证据，未在本轮活体触发）**。历史 `audit-client.md` F4 指出 settings/document-updated 等事件会在已加载后调用 `controller.load()`；未观测到足够推送频率，不能定性为当前主要根因。
6. **宿主 usage SQLite 同步查询（不是客户端根因，但是真实症状的独立叠加机制）**。进入设置→插件后，`DIAGNOSIS.md` 记录 `/usage/*` 多数 300–500 ms、宿主事件循环最大 476.5 ms；客户端审计不能把这段冻结归因给 React。它与 M2 独立叠加，是“打开设置后严重卡顿”中最可能的长冻结来源。

### 已排除项

- 设置页自有定时器/raf/observer/localStorage 循环：五个设置 bundle 全检索为 0 命中；仅 open 期间 document keydown 监听。
- 设置页接口本身慢：`settings.describe` 约 2.8 ms，plugin inventory 约 3.8 ms，LLM provider/model 约 1–2 ms。
- 安静态“打开设置立即产生持续 DOM churn”：`ab-open-vs-closed.json` 记录设置关闭 script 326 ms/12s、通用打开 264 ms/12s、模型打开 9 ms/12s；四段 `panel_mutations` 全为 0，模型页 >50 ms 帧为 0。
- infinite render loop / 不稳定 uSES snapshot：store snapshot 引用稳定，活体面板变更为 0。
- 默认设置页“一次渲染上千模型/节点”：截图与探针显示默认三 provider 行、编辑器折叠，面板约 120–168 节点。
- sessions/skills/profiles 体积、启动时 `session_projcache.json` 解析、常规服务端 API：已有诊断分别以路径不读、一次性启动成本、毫秒级接口测量排除。

## 2. 代码链与行号证据

### 2.1 运行时热点

- `dsh-client-runtime/lib/client.js:8553-8575`：`buildListSnapshot()` 对所有 summaries 合并、展开 lineage，并以 `entryCache` 复用行对象。
- 当前 live `:8576-8581` 已是 P1：一次构建 `liveIds = new Set()` 再清理 stale entry，消除了原 `items.some(...)` 的 O(N²)。这只降低**单次重建成本**，不改变“是否重建/是否 notify/是否把快照交给订阅者”的频率。
- 当前 live `:9322-9370` 已是 P2：比较上一次 projection，复用 ids/byId/子代理 catalog/jobs 等引用，必要时让 `nextProjection = previousProjection`，随后 `this.list.set(nextProjection)`。这覆盖了“内容不变时新引用风暴”的主要路径，但仍会在真实内容变化时 set；也没有把 sidebar/SettingsPanel 做组件级 memo。
- 当前 live `:8572` 的 entry freshness 比较含 `runningSubagentCount`；这是 B1/C1 兼容字段，不是新的 render 防护。
- `dsh-client-ui-workspace/lib/client.js:161-209,222-232` 每次 derive 都遍历 `list.ids`/`list.byId`，并调用 `indexSubagentDescendants`；`:171`、`:286` 已消费服务端字段并回落 descendants running count。它保证徽标语义，但本身仍是列表投影的消费热点。

### 2.2 第三方插件热点

- `dsh-workspace-enhancement/lib/client.js:4109-4127`：`remoteSessionIndex` 现在用 `new Set(ids)` 去重，覆盖 C2 的内层 O(k²)；这减少每次事件的辅助开销，不改变主列表投影的重建频率。
- `:5418-5436`：`sessions()` 现在按 `sessionsFeed.getSnapshot()` 身份 memo，快照不变时复用数组；这覆盖了 C2 的全量 2361 行对象重建。
- 结论：P1/P2/C2 **确实 live 生效**，但它们是热点成本削减/引用稳定化，不能证明设置面板已与 sessions 订阅解耦。

### 2.3 设置 React/DOM/render

- `dsh-client-ui-settings-general/lib/client.js:188-190`：`useSections`、`useOnboardingSteps`、`useSessions` 在 `SettingsRoot` 中订阅；sessions 选择器只返回 onboarding 布尔值，但 snapshot 更新仍可能触发 selector 重新计算。
- `:213-219`：`open && jsx(SettingsPanel, ...)`，未使用 `React.memo`；因此父组件 render 时重新创建 SettingsPanel element。
- renderer `dsh-client-ui-renderer/lib/client.js:741-749`：`SlotOutlet` 每次订阅 version 后直接执行 `renderOutletContent`；`:752-759` 的 `guarded`/outlet dispatch 没有通用 memo 边界。
- `dsh-client-ui-settings-models/lib/client.js:896-991`：模型行全量 map；闭合 advanced 区域不会阻止基础模型行元素生成。
- `dsh-client-ui-settings-plugins/lib/client.js:489-498`：visited tabs 保持挂载，仅 hidden。

## 3. P1/P2/C1/C2 是否真正覆盖热点

| 改动 | 已覆盖 | 未覆盖/边界 | 裁决 |
|---|---|---|---|
| P1 entryCache 清理 Set | `:8576-8581`，O(N²)→O(N) | 不减少 `buildListSnapshot` 调用次数、flattenLineage、全列表消费或 React commits | **真实有效但非根因终结** |
| P2 projection/list.set 稳定化 | `:9322-9370` 复用不变 ids/byId/投影引用；live hash 与 cross-client 对拍确认 | 内容真的变时仍 set；设置根仍无 memo；未直接量化每次 session event 的 React commit | **覆盖引用风暴主路径，不能裁决 UI 解耦** |
| C1/B1 runningSubagentCount | runtime freshness + ui-workspace `:171/:286` 字段优先、descendants 回落 | 不减少 projection/derive；服务端字段本轮仍 0/88 顶层，实际主要验证回落分支 | **功能/字段补丁，不是 render 根因修复** |
| C2 workspace-enhancement | `:4124` Set 去重、`:5418-5436` snapshot identity memo | 只省插件辅助转换，不阻止 runtime list 更新或 SettingsRoot render | **有效小项，不是根因修复** |

cross-client 活体复测支持“收益方向成立但不可把点值当因果证明”：重负载 160.3 帧/s 下 script 62.8 ms/s（基线报告 121.4 ms/s），>50 ms 帧 10（基线 22）；但本轮负载与历史不等，recalc style 反而 +124%，所以不能宣称精确的 -77% 稳态收益。功能冒烟 8/8 settings tabs、sidebar、session、subagent surfaces 均正常；唯一确认的 UI 回归是 usage 下拉重复 `60s`，与 React jank 无关。

## 4. 证据链、反事实与证据强度

### 证据链

`session/event`/`session/projection` 高速流（历史约 65/73 帧/s，另一轮 160–206 帧/s）
→ notifier / `buildListSnapshot`
→ `projectList` 生成 `ids/byId` 与 `list.set`
→ sidebar/`useSessions` 订阅者更新
→ SettingsRoot 无 memo、SlotOutlet 无 memo，活跃模型编辑器全量 map
→ script/task/recalc style 和长帧增加。

另一条独立链：

访问设置→插件
→ usage card 首次挂载且访问过 tab 不卸载
→ 30/60s 轮询 `loadAll`
→ 同步 SQLite 非 sargable 聚合查询
→ 宿主主线程 0.30–0.48s 冻结。

### 反事实

1. **完全安静、设置仍打开**：面板 mutation=0、模型页 script=9 ms/12s、0 个 >50 ms 帧；若设置自身是根因，这个反事实不应成立。因此设置逻辑不是独立点火源。
2. **有活跃流、设置关闭**：历史仍有 2428 ms script/20s、22 个 >50 ms 帧；因此 M2 在设置之外已经存在。
3. **P1/P2/C2 后仍有长帧**：本轮仍有 10–14 个 >50 ms 帧（且负载不同），说明补丁削减成本而非消灭事件流/所有渲染工作。
4. **不进入插件 tab**：150s 宿主延迟基线无 >100 ms 停顿；进入后出现 476.5/297.5 ms 停顿。因此 severe freeze 的 usage 机制具有强条件性，不能被客户端 React 证据替代。

### 证据强度

- M1 usage 同步 SQLite：**强**（运行时宿主延迟 + 端点耗时 + 源码查询路径三角证据）。
- M2 session churn：**强**（CPU profile、规模/WS 速率、微基准、代码链、区域热点在 sidebar/body）。
- “SettingsRoot 无 memo 是放大器”：**强代码证据，中等因果证据**；缺活跃流条件下的面板级 React commit 计数。
- 模型全量 map：**强代码/微基准证据，中等实际影响证据**；默认页不展开时影响很小。
- settings/document-updated reload、visited tabs 的长期劣化：**中等/弱到中等**，当前缺触发频率与长期窗口量化。

## 5. 仍缺什么（不得用推测补齐）

1. 在**活跃会话流**中，面板根节点 MutationObserver 计数不足以证明 React render；需要 React DevTools Profiler 或受控、只读的 commit instrumentation，记录 `SettingsRoot/SettingsPanel/ProviderEditor/ModelListEditor` 每秒 commit 与 session/projection 帧时间线。
2. 在同一 N、同一 WS 事件负载、宿主重启后的成对实验：baseline、P1 only、P1+P2、P1+P2+C2；报告 script/task/style、commit、长帧，避免把负载差异误当补丁收益。
3. 对 P2 的“same projection 是否真的返回同一快照”做非侵入读观测（或测试 harness），并验证前向携带 `:9326-9328` 不会让已离开地址链的子代理长期留在 `byId`；cross-client 报告将其列为窄窗口未证实陈旧风险。
4. 展开真实 provider 编辑器后确认实际模型行数（schema inheritedModels 可能不同于 settings.yaml 声明），再测 commit × 行数，而不是只引用声明数。
5. 进入插件 tab 后，在不点击手动刷新且宿主重启后的受控窗口，分离 usage 轮询冻结与 client render；同时核验重复 `60s` 选项的低危 UI 回归。

## 6. 只读复核记录与可复现入口

### 6.1 live 文件与证据路径

本报告引用的 live 文件为：

- `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js`
  - `buildListSnapshot`: `8553-8594`
  - P1 cleanup: `8576-8581`
  - `projectList`: `9271-9371`
  - P2 projection reuse / `list.set`: `9322-9370`
- `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js`
  - grouped derivation and descendants index: `191-209`
  - flat derivation: `222-232`
  - B1/C1 running count consumption: `165-175`, `279-290`
- `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/client.js`
  - sessions subscription and SettingsPanel construction: `175-224`, specifically `188-190`, `213-219`
- `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-models/lib/client.js`
  - full model row map: `896-991`
- `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-renderer/lib/client.js`
  - SlotOutlet and outlet dispatch: `741-759`
- `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-plugins/lib/client.js`
  - visited panels retained with `hidden`: `489-498`
- `/home/CNS2026495165/.dsh/profiles/node_modules/dsh-workspace-enhancement/lib/client.js`
  - `remoteSessionIndex` Set deduplication: `4109-4127`
  - snapshot-identity memoized `sessions()`: `5418-5436`

复核到的 live hashes：runtime `a0fb4bb225d3aa09f6864321090b3c670495df59`，ui-workspace `5596cec54007779b007cb3cd874a0ae75604acc6`，workspace-enhancement `7df7a655ee660eb29dd8ee87d4b20fa3f06a16faee80c52baf612d6e7ffef90d`。这些哈希与 `audit-cross-client.md` 中的 HTTP GET、磁盘和交付副本对拍结果一致；本次没有通过补丁脚本 apply/rollback，也没有触碰 live 文件。

### 6.2 现有探针的判读限制

- `.workspace/settings-lag/ab-open-vs-closed.json` 是安静态反事实，适合排除“设置自身持续循环”，不适合证明活跃流中的 SettingsPanel commit 频率。
- `.workspace/lag-fix/reports/audit-cross-client-measure.json` 的 20 秒窗口有 160.3 帧/s `server-request` 信封，不能和历史按 payload 分类的 73 帧/s 直接作同口径因果比较；其 `session_list.items=null`（680 字节探针结果）也不应用来断言会话规模，规模证据应取 `session-list-shape`。
- `audit-cross-client.md` 的收益方向（script、长帧下降）可信度高于收益点值；因为本轮事件负载与历史基线不同，不能把 62.8 ms/s 或历史 27.5 ms/s 当作补丁的稳定因果估计。
- DOM MutationObserver 只观察提交后的 DOM 变化；React render/commit 若复用 DOM 或仅重算 props，可能没有 mutation。因此“panel mutations=0”只能排除 DOM churn，不能单独排除 render CPU。

### 6.3 最小未决实验协议（只读、不修改 live）

1. **活跃流 React commit 计数**：固定浏览器、固定同一已展开 provider、固定 10 秒窗口；同时采集 WebSocket payload 类型/速率、Performance long task、rAF 长帧，并通过 React DevTools Profiler（或预先存在的只读 profiling harness）记录 `SettingsRoot`、`SettingsPanel`、provider editor/model list 的 render/commit 次数。比较设置关闭、通用打开、模型打开三态。判据：若 SettingsPanel commit 与 session/projection 同阶且关闭时消失，则确认放大器；若 commit 不变而 sidebar CPU 变化，则根因只在列表消费侧。
2. **同负载补丁阶梯实验**：宿主重启后固定会话数量 N、固定事件产生器与时间窗，分别测 pristine、P1、P1+P2、P1+P2+C2；每组至少 3 个窗口。记录 `buildListSnapshot` CPU、`projectList`/`list.set` 次数、React commits、script/task/recalc-style、p95/p99 与 >50ms 帧。不能用不同 WS 负载的单窗口数字替代。
3. **P2 stale-row 检验**：在纯测试 harness 中构造“上一投影含 address-chain child、下一投影 ids 不变但 byId 不再含 child”的输入，检查 `9326-9328` 的 forward carry 是否让 child 永存，并比较 descendants running count。该实验不需要写 live，也不应在真实会话上制造状态。
4. **usage 与 client render 解耦**：宿主重启后，先只打开设置通用页，记录宿主延迟；再进入插件页但不点手动刷新，分别捕获首次 load 与 30/60 秒轮询窗口。把 `/usage/*` 响应时间、`/api/host.describe` 延迟、浏览器长帧和 WS 负载对齐。若宿主延迟出现 300–500 ms 尖峰而浏览器侧无对应 React commit，则归 M1；若无 usage 请求但 sidebar/render 仍高，则归 M2。
5. **长期 tab retention**：依次访问 8 个 settings tabs，记录每次的 panel DOM 节点、订阅回调和 script/style；若节点/成本单调增加，确认 visitedIds 是长期劣化项，但仍不能把它提升为首次打开的主因。

以上实验均以“只观测、不点击写状态按钮、不改源码/配置、不重启以外的宿主控制”为约束；若需要注入 profiling hook，应使用隔离测试 harness 或 DevTools，不应改写生产 bundle。

## 最终裁决

**“设置页自身是根因”不成立。** 真实客户端根因候选是 session list projection/list.set churn；设置页的无 memo 是活跃流下的被动放大器，模型全量 map 是其条件乘数。P1/P2/C1/B1/C2 已真实落地且覆盖了 O(N²)、重复 projection 引用及第三方辅助重建，但没有覆盖 React 组件边界，也没有消除真实内容变化时的 list 更新，因此不能宣称已经覆盖全部热点。若用户所说“严重卡顿”包含 0.3–0.5 秒整页冻结，则首要直接来源仍是访问插件后 usage 的同步 SQLite 主线程查询；M1 与 M2 是两条叠加机制，必须分开验证与处置。
