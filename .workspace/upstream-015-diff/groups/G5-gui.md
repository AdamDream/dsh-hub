# G5-gui 分组调研笔记（0.1.5-rc.2 ARCH vs 0.1.1-rc.2 GLOB，只读）

产物说明：combined.diff = `diff -u ARCH GLOB`（`-`=0.1.5，`+`=0.1.1）；upstream*.diff = `diff -u BASE ARCH`（`-`=0.1.1 npm 基线，`+`=0.1.5）。
本组无本地补丁的包：workspace/conversation/trajectory/client-modules/client-locale/renderer/layout/web-app/goal/jobs/workflow-run；有本地补丁：client-ui-subagent（tok/s 补丁，upstream 对照可用）。

---

## 核心结论（重点问题 1：槽位/目录流是否多消费者化）

**结论：结构未变，主 agent 判断正确（证实）。** 槽位核心机制（renderSlot/slots.inject/slots.register/flowSource/useDirectoryFlow/occupied 语义/注入顺序）在两版逐字一致，仅"类型来源重构 + 一个 hook 改名"：

- 消费方证据（dsh-client-ui-workspace.combined.diff）：
  - `useDirectoryFlow((occupied) => occupied)` 两版相同（combined.diff:1325，该行是两版共有上下文行）。
  - `flowSource("sidebar.workspaces.directoryFlow")` / `flowSource("conversation.hero.workspace.directoryFlow")` 两版相同（combined.diff:1471、1476）。
  - `ctx.slots.inject("sidebar.workspaces", () => ctx.slots.register({...}))` 两版相同（combined.diff:1541）。
  - slots.d.ts 两侧都从 `@deepseek-ai/dsh-client-ui-slots` import 相同 Props* 类型；孔位仍是 `single` kind、owner 会话 `open/busy/onPicked/onCancel/onError`、每次菜单渲染读占用（两侧 README 同文，0.1.5 README 明确"an empty hole means the composition has no picking affordance"）。
  - 结构差异仅两处：① 类型来源 0.1.5 改为 `dsh-api-session-controller/dsh-api-workspace-controller/dsh-api-remotes/dsh-session/types`，0.1.1 统一 `dsh-client-runtime/client`（combined.diff:1572-1578）；② `useHostDescription`→`useHostInfo` 改名（`hostDescription: HostDescriptionSource`→`hostInfo: HostObservable<RemoteHostFacts>`，combined.diff:1584-1595；client.js:1317-1320）。
- 0.1.5 真正"新增"的槽位消费面在 **dsh-client-ui-layout**（usePanelInfo/selectPanel/beginNavigation/MainPanel entryKey，见下）与 conversation composer chain 接管——属新增槽位/用法，不改变槽位核心。

---

## (a) 每包增量分类 + (e) 每包裁决

| 包 | 分类 | 裁决 | 一句话 |
|---|---|---|---|
| dsh-client-ui-workspace | gui + api(类型来源重构,不破坏运行语义) | 部分借 | 槽位机制未变；0.1.5 新增 Schedule 闹钟、搜索 reveal、导航竞态保护等 GUI 能力，但 Schedule 依赖 0.1.5 新子系统；可借的仅独立 UI 逻辑（reveal/collapsedSessionRows） |
| dsh-client-ui-conversation | api(重写,破坏) | 不借 | 0.1.5 为配合新流式帧(assistant/attempt、live-chunk、settlement)对装配层整体重写，chat 渲染拆到新包 dsh-client-ui-chat；导出面 137增/149删，绝大多数增量绑定 0.1.5 host 协议 |
| dsh-client-ui-trajectory | gui(增量少) + noise | 部分借 | 两版功能等值（timing overview/TTFT/虚拟行/尾部跟随均有）；差异主要是数据层适配新协议 + import 来源；唯一可借是 zh 字典英文值修复 |
| dsh-client-modules | perf(架构) | 不借 | 0.1.5 改 combo URL/内存响应/增量扫描；0.1.1 按包磁盘直读。是性能架构升级，需联动 web shell 启动图，不构成 bugfix；MissingClientBundleError 两版都有，非 0.1.5 增量 |
| dsh-client-locale | gui(能力) | 部分借 | 0.1.5 新增外部语言包注册(addLanguage/BCP47/fallback 链)+一批新字典串(copy.*/json.*/markdown.*/number.*)；独立可借 |
| dsh-client-ui-renderer | api(重写) | 不借 | 0.1.5 重写 bindings/slots-changed 不变量；0.1.1 为 session-provider 双 Context 模型，绑定 ui-slots 版本，不可独立借 |
| dsh-client-ui-layout | api(破坏)+gui | 不借 | 0.1.5 新增 usePanelInfo/selectPanel/beginNavigation/DocumentTitle/rightbar 模型；0.1.1 为 details 纯函数列解。面板导航 API 是 0.1.5 跨包依赖，借 DocumentTitle 需先搬面板基础设施，不值 |
| dsh-web-app | gui | 不借 | 0.1.5 打印带进程 token 的 authenticatedUrl + ANNOUNCED_ROOTS 去重，依赖 0.1.5 connection.authenticatedUrl（0.1.1 connection 无此 API），不可独立借 |
| dsh-client-ui-goal | api(小改) | 不借 | 0.1.5 GoalDock 加 useGoalActivation 激活覆盖层（依赖 0.1.5 hook）；GoalCommandInputView 0.1.1 已有 |
| dsh-client-ui-subagent | gui | 不借 | 0.1.5 上游 tok/s 速率显示与本地补丁#2 同功能（已本地实现，无新增可借）；其余为 locale 化 formatTokens 与 CSS token 噪音 |
| dsh-client-ui-jobs | noise | 不借 | 仅 CSS 主题 token 差异（--dsw-shadow-lv3→--dsw-elevation-prominent 等） |
| dsh-client-ui-workflow-run | noise | 不借 | 仅 import 来源(conversationEvents↔uiConversation)与 CSS font-delta 响应式尺寸，均为 0.1.5 协议/主题绑定 |

---

## (b) 值得借到 0.1.1 的候选清单

1. **C-G5-1（stability，P1）trajectory zh 字典英文值修复**
   - 价值：部署版中文界面轨迹工具栏出现英文（toolbar.duration 等 9 个 key 为 English 值），0.1.5 已全部改为中文；一行修复一个可见 i18n 缺陷。
   - 最小 patch 面：GLOB `dsh-client-ui-trajectory/lib/client.js` zh dict（~lib 行 50-63），对照 ARCH 同 dict 的 9 个值。
   - 与本地补丁冲突：无（trajectory 无本地补丁）。成本：小（<20 行）。
2. **C-G5-2（gui，P2）workspace 搜索结果 reveal（scrollIntoView + 自动展开分组）**
   - 价值：0.1.5 点搜索结果后清除查询并滚动到目标行、展开折叠分组（onReveal/acknowledgeSessionReveal + revealGroup effect）；0.1.1 只打开不滚动。
   - 最小 patch 面：ARCH workspace combined.diff:1004-1017(collapsedSessionRows 相关)、1061-1079(reveal effect)、1357-1368(openSearchResult)、1411-1419(onReveal 接线)；落点在 GLOB workspace lib/client.js 的 SessionTree/FlatList/SearchResults/SessionNodeItem。
   - 冲突：无。成本：中（<200 行，涉及 4 个组件 props 接线）。
3. **C-G5-3（gui，P2）workspace collapsedSessionRows（空白新会话不计入 5 行折叠上限）**
   - 价值：0.1.5 折叠窗口把 provisional New Session 行排除在 COLLAPSED_SESSION_LIMIT 外；0.1.1 直接 slice(0,5) 会把空白行占掉一个名额。
   - patch 面：ARCH combined.diff:1004-1017 + 1144/1231-1241；落点 GLOB workspace lib/client.js 渲染处（约 25 行）。
   - 冲突：无。成本：小（<30 行）。
4. **C-G5-4（gui，P2）client-locale 外部语言包支持（addLanguage/BCP47/fallback 链）**
   - 价值：0.1.5 允许插件注册第 3 语言（README 示例 ja），0.1.1 仅 zh/en 封闭集；拓宽 i18n 能力，包内自洽。
   - patch 面：ARCH client-locale lib/client.js（LOCALE_ID_PATTERN 校验、BUILT_IN_LOCALE_METADATA、addLanguage、查找链 ns→fallback→common→en）+ locales.d.ts；落点 GLOB client-locale。
   - 冲突：无。成本：中（<150 行）。注意 0.1.1 的 schema 用 `settingsNamespace()` 助手、0.1.5 不用——移植时保留 0.1.1 写法。
5. **C-G5-5（gui，P3）client-locale 新字典串（copy.*/json.*/markdown.*/number.*）**
   - 价值：配套 0.1.5 的 JSON 查看/复制按钮等组件；0.1.1 若无对应消费组件则价值低（可先不借）。
   - patch 面：ARCH client-locale lib/types/client/locales.d.ts + client.js zh/en dict（约 15 键×2）。
   - 冲突：无。成本：小。
6. **C-G5-6（stability，P3）web-app ANNOUNCED_ROOTS 去重 + 就绪后仅 announce 一次**
   - 价值：连接重置时避免重复打印 `dsh web:` URL 行；0.1.1 每次 loader settle 后无条件 announce。
   - patch 面：ARCH web-app combined.diff（ANNOUNCED_ROOTS WeakSet + announceReady 逻辑，约 20 行）；落点 GLOB dsh-web-app lib/index.js。
   - 冲突：无；注意 0.1.5 的 authenticatedUrl 部分依赖 0.1.5 connection，**只借去重逻辑、不借 token URL**。成本：小。

不借理由明确但值得记录的 0.1.5 GUI 能力（依赖缺失）：
- workspace ActiveScheduleIndicator/Schedule 闹钟：依赖 0.1.5 新增 dsh-schedule 运行时 + SessionSummary.projectionValues.schedule（0.1.1 无此包/字段）→ 不借。
- conversation Lexical composer/文件上传队列（maxConcurrentFileUploads/Worker 传输）/attempt 结算：绑定 dsh-client-file-upload + 新流式帧 → 不借。
- layout DocumentTitle（浏览器标签跟随会话标题）：绑定 usePanelInfo/selectPanel 面板 API（0.1.1 layout 无）→ 不借。

---

## (c) 明显的稳定性 bugfix 清单

- **trajectory zh 字典英文值**（GLOB `dsh-client-ui-trajectory/lib/client.js` zh dict，lib 行 50-63：toolbar.duration/useActualDuration/useEqualWidth/turns/expandTurns/collapseTurns/calls/expandCalls/collapseCalls = English；同 dict 其他 key 为中文）：0.1.5 修复为中文（ARCH 同位置）。为何是 bug：同一 namespace 字典中 zh 值混入英文，中文界面工具栏显英文。
- **web-app 重复 announce**（ARCH `dsh-web-app/lib/index.js` ANNOUNCED_ROOTS WeakSet + `if (config.printUrl || handoffBrowser)` 提升到 apply 顶层）：0.1.5 修复连接重置/多次 ready 时重复打印 URL 与重复拉起浏览器（0.1.1 每次 loader settle 后无条件 announceReady）。为何是 bugfix：幂等性守卫。
- **conversation 图片发送竞态**（ARCH conversation service.ts `nextPaint` + `settleSubmittedAttachments` observed 分支；0.1.1 为简化 imageSendInFlight 布尔）：0.1.5 用 per-flight AbortController + 失败 restoreAttachments + 观察退休后把预览 URL 交给 durable 缓存，0.1.1 失败后不恢复附件。倾向为健壮性增强而非纯 bugfix，且绑定新协议，勿独立借。
- **renderer slots/changed 不变量**（ARCH renderer bindings.js install：`slots/changed` 在 version 0 时 fail-loud）：0.1.5 新增的装配期诊断，0.1.1 为 noop。属 dev-time 检查，非生产 bugfix。

未发现其他明显稳定性 bugfix；本组 diff 主体是"协议适配 + 拆包重构 + 主题噪音"。

---

## (d) 0.1.5 破坏性 API / 接口变更（勿借项，说明破坏面）

1. **conversation 装配/流式协议重写（破坏面最大）**：0.1.5 删除 conversation-nodes/*（assistant/command/compaction/fallback/message/retry/tool/turn-* 渲染定义）与 chat/*，改为 conversation/（assembler + definition/event/view registry）+ input/editor（Lexical 编辑器）+ contract/{snapshot,records,request-inspection,system-prompt,input,composer-blocks,conversation}。导出面 137增/149删（index.d.ts 全文重写）。消费流由 `assistant/chunk`+`assistant/message`（0.1.1，GLOB conversation lib/client.js:7639/7742/7795/7810/7823 与 9143-9170）改为 `assistant/attempt`+`assistant/live-chunk`+`assistant/message(surfaceOp/sourceEventSeqs)`+`settleAssistant`（0.1.5 api-session-controller lib/client.js:1386/1447/1475/1496；conversation lib/client.js:1596/2534）。任何基于 0.1.1 conversation 导出面的消费方（如 trajectory、workflow-run、goal 的 Definition 注册接口）都会被 0.1.5 语义破坏。
2. **dsh-client-runtime 拆包**：0.1.5 拆为 dsh-client-store（defineStore/createSnapshotStore/EngineStoreHandle/shallowEqual）+ dsh-api-session-controller/dsh-api-workspace-controller/dsh-api-remotes/dsh-client-connection + dsh-client-ui-chat/ui-session/ui-sidebar（新包）。0.1.1 部署全部位于 dsh-client-runtime/client 单包；直接照抄 0.1.5 import 即破坏。
3. **ui-layout 面板 API**：0.1.5 新增 usePanelInfo/selectPanel/beginNavigation/MainPanel(entryKey)/DocumentTitle，右侧栏模型由 details（0.1.1，0=closed 永不 unmount、无滞后纯函数列解）改为 rightbar track（RIGHTBAR_MAX_RATIO .7/.45）；0.1.1 消费方（workspace 等）不具这些 API。
4. **renderer 内部模型**：0.1.5 bindings.js（root/scope 双绑定 + slots/changed 不变量）vs 0.1.1 session-provider.js（RootBinding/ScopeBinding 双 Context + SlotAssemblyError）；绑定 ui-slots 版本。
5. **client-modules 服务模型**：0.1.5 内存 combo 响应（Indexed Source Map v3、3KiB 分区、immutable、nonce revision、增量 dirty 扫描）vs 0.1.1 每包磁盘直读 /plugins/<pkg>/client.js（no-cache）；启动图格式（window.__ModuleLoader__ vs __DSH_BOOT__）联动 web shell，勿借。
6. **错误码前缀**：conversation updateQueue 检查 `session/steer-unavailable`（0.1.5）vs `steer-unavailable`（0.1.1）——协议版本差异，勿混用。

---

## 各包证据细节（文件:行）

### dsh-client-ui-workspace（151KB diff，libjs 1251 行）
- 槽位机制未变：combined.diff:1325（useDirectoryFlow occupied）、1471/1476（flowSource×2）、1541（slots.inject/register）。
- 类型来源重构：slots.d.ts combined.diff:1572-1578；stores.d.ts 1691-1692（dsh-client-store↔client-runtime）；index.d.ts 1615-1633（apply(ctx: ClientContext)）。
- hook 改名：combined.diff:1584-1595（hostInfo↔hostDescription）、1317-1320（useHostInfo↔useHostDescription）。
- 0.1.5 新增（`-` 侧）：UiWorkspaceService + watchNavigation/clearArchivedCurrent（525-470 区段）、indexSubagentDescendants/abbreviateHomePath 内联（521-548、488-519）、ActiveScheduleIndicator+hasActiveSchedule（598-606、815-825、902）、onReveal 滚动（873-887、1061-1079、1357-1368）、useSessionPendingInteraction/usePanelInfo（1025-1031、1248-1257）、collapsedSessionRows（1004-1017、1144、1230-1241）、probeDimensions/nextPaint/base64ImageOf（2797-2834 区段）。
- 0.1.1 独有（`+` 侧）：invariant.js/WorkspaceBrowser.d.ts（1542-1543）、UNGROUPED_LABEL 硬编码（559、571-573）、relativeTime 内联（726-755，0.1.5 改用 primitives）。

### dsh-client-ui-conversation（1.2MB diff，libjs 24198 行，本组最大）
- 导出面重写：index.d.ts diff（见上）；0.1.1 导出 conversation-nodes/chat-nodes/input-contract 面，0.1.5 导出 assembly/registries/contract/{snapshot,records,request-inspection,...}。
- 0.1.1 assistant/chunk 消费：GLOB lib/client.js:7639（updateChunk 入口）、7742、7795（isAppendSurfaceEvent）、7810、7823、9143-9170（fallbackState/trajectory 侧）。
- 0.1.5 新协议消费：api-session-controller lib/client.js:1386/1447（live-chunk）、1475（settlement）、1496（attemptForSettlement）、920-929（settleAssistant）；conversation lib/client.js:1596（live-chunk）、2534（settle-assistant）。
- 0.1.5 新增文件树：conversation/（assembler,definition/event/view-registry,location-index）、input/editor/（Lexical）、contract/{snapshot,records,request-inspection,system-prompt,input,composer-blocks,conversation}、context-occupancy、view-selection、skeleton/ConversationPanel；0.1.1 独有：chat/、conversation-nodes/、queue/store、reference/、input/contract、skeleton/{ApprovalPanel,DetailsPanel}（两侧文件树对照）。
- service 差异：0.1.5 文件上传队列（fileUploads/fileUploadQueue/maxConcurrentFileUploads/serializeDraftAttachments 带 receipt）vs 0.1.1 图片 URL 缓存（imageUrls/resolveImage/releaseSessionImages/serializeDraftImages）。
- updateQueue 错误码：0.1.5 `session/steer-unavailable` vs 0.1.1 `steer-unavailable`（3142-3145 区段）。

### dsh-client-ui-trajectory（356KB diff，libjs 4100 行）
- 两版功能等值（README 对照：timing overview/TTFT/虚拟行/尾部跟随/Definition 装配均同述）。
- zh 字典 bug：GLOB lib/client.js:50-63（9 个 toolbar.* 英文值）；ARCH 同位置中文。
- 数据层差异：0.1.1 读 `useSession(snapshot.views.get("trajectory"))` + 本地 history 窗口（GLOB，combined.diff:3842-3860 区段 `+`），0.1.5 读 useTrajectory 快照；0.1.1 sourceImage/safeImageSource（URL 白名单安全校验，combined.diff:3668-3719 `+`），0.1.5 改用 durable attachmentId。
- 0.1.1 独有文件：copy-codes.d.ts、duration-store.d.ts、trajectory-event-projection.d.ts、invariant.js。

### dsh-client-modules（89KB diff，libjs 932 行）
- serveBundle：0.1.5 内存 responses/previousBatchResponses + combo URL + IMMUTABLE_CACHE（libjs.diff:714-762 `-`）；0.1.1 每请求 readFile /plugins/<pkg>/client.js(+.map) + no-cache（`+`）。
- MissingClientBundleError 两版都有（GLOB index.js:91-108/410-417；ARCH index.js:93-110/748-762）→ 非 0.1.5 增量。
- dsh-client-store 为 0.1.5 实体包（非虚拟模块）：ARCH 包列表含 dsh-client-store；0.1.1 相应原语在 dsh-client-runtime/client（defineStore/createSnapshotStore/shallowEqual，workspace/stores 等 diff 可见）。

### dsh-client-locale（68KB diff，libjs 532 行）
- 0.1.5：LOCALE_ID_PATTERN（BCP47）替代封闭 LOCALE_IDS union（libjs.diff:42-55）；BUILT_IN_LOCALE_METADATA（zh fallback en）；addLanguage 外部语言包 + fallback 链（README）；新增 copy.*/json.*/markdown.footnotes/markdown.truncatedCharacters/number.{thousand,million} 字典串（libjs.diff:139-154）。
- 0.1.1：settingsNamespace() 助手（0.1.5 不用）、封闭语言集合校验。

### dsh-client-ui-renderer（72KB diff，libjs 1133 行）
- 0.1.5：bindings.js（RootBinding/ScopeBinding + 绑定可观察源到 selector Hook）、install 含 slots/changed version-0 fail-loud 不变量（libjs.diff:38-106 `-`）；0.1.1：session-provider.js 双 Context + SlotAssemblyError、install noop（`+`）。`@@ -932,463 +916,18 @@` 为渲染核心整体换装。

### dsh-client-ui-layout（85KB diff，libjs 681 行）
- 0.1.5：rightbar track（RIGHTBAR_MAX_RATIO .7 / DEFAULT .45）、DocumentTitle（usePanelInfo 驱动浏览器标签）、MainPanel entryKey、usePanelInfo/selectPanel/beginNavigation（ARCH lib/client.js:55-56/114-115/204/354/412）；0.1.1：details 列模型（clamp 300-520、中心最小 640、0=closed 不 unmount）、纯函数列解无滞后（GLOB `+` 侧）。0.1.1 layout 无面板 API（grep usePanelInfo/beginNavigation/selectPanel 为空）。

### dsh-web-app（1009 行 diff，libjs 134 行）
- 0.1.5：launchedThroughSsh 从 dsh-launch-environment import；resolveDistIndex 经 package.json dirname；ANNOUNCED_ROOTS 去重；authenticatedUrl（connection）打印进程 token URL；WEB_SURFACE 具名顺序。0.1.1：launchedThroughSsh 内联、require.resolve(dist/index.html)、无 token 普通 URL、-98 硬编码顺序、无条件 announceReady。0.1.1 connection 无 authenticatedUrl（grep 无匹配）→ token URL 不可借。

### dsh-client-ui-goal（921 行 diff，libjs 420 行）
- 0.1.5 GoalDock 用 useGoalActivation（激活覆盖层，依赖 0.1.5 hook）；0.1.1 读 host 计算 projection。0.1.1 独有 GoalCommandInputView（/goal 输入气泡，CSS+组件，combined.diff:236-280 `+`）与 activation-source.d.ts——0.1.5 已移出（至 ui-chat）。

### dsh-client-ui-subagent（upstream-libjs 197 行）
- 0.1.5 上游增量 = tok/s 速率（formatTokensPerSecond/decodeTokensPerSecond，sessionStats 投影）+ locale 化 formatTokens(tokens.thousand/million/perSecond) + SubagentReadOnlyComposer 读 useProjection("sessionStats")——与本地补丁#2 同功能，本地已实现，无新增可借；indexSubagentDescendants 0.1.5 内联本地（0.1.1 BASE 从 client-runtime import）；0.1.5 删除了 switcher 初始 catalog 自动刷新 effect（行为变化）。

### dsh-client-ui-jobs（309 行 diff，libjs 11 行）
- 仅 CSS 主题 token（--dsw-shadow-lv3/border-l2/12px ↔ --dsw-elevation-prominent/border-0/20px）噪音。

### dsh-client-ui-workflow-run（423 行 diff，libjs 40 行）
- inject/注册入口 `conversationEvents`（0.1.1 runtime 服务）↔ `uiConversation`（0.1.5 registry）；CSS 仅 font-delta 响应式尺寸（依赖 0.1.5 主题变量）。

---

## 备注
- diff 方向：combined = ARCH→GLOB（读 `-` 得 0.1.5 增量）；upstream = BASE→ARCH（读 `+` 得 0.1.5 纯上游增量）。
- 本地补丁核对：subagent 的 tok/s 补丁 = 0.1.5 上游同款功能（无冲突、无需再借）；其余 5 个补丁包与本组无交集。
- 本组无任何需要 sandbox_permissions 的操作；仅此 notes 文件一次写入。
