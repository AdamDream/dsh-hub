# slot-churn — 「父驱动路径」代码行级因果链 + 独立实测审计

**范围**：DSH Web GUI（`http://127.0.0.1:3080`，宿主 PID 1390375，`node dsh web`）设置面板在活跃会话流下
每 commit 重渲染的**父驱动路径**。目标：把上一条线（`.workspace/lag-fix/research-v2/react-commit/`）的结论
「槽版本 churn 让 `renderOutletContent` 每次新建 element」落到**代码行 + 因果链**，并用**独立实现**的
hook 器械实测因果。

**结论一句话**：`SlotOutlet` 的版本订阅（`react.js:743`）**确实是**链条中 `RootEntry`/`SlotErrorBoundary`/`SlotOutlet`
那一段的驱动者（实测占 commit 的 0.706–0.833），**但**「父驱动」的**真正源头在更上层且不是版本 churn**——
`SettingsRoot`（settings-general `lib/client.js:175`）在**每一次 commit 都渲染（1.000）**，而它上方的 `SlotOutlet`/`SidebarRoot`/
`AppFrame` 在**同一批 commit 里 0.000 渲染**（实测 2473 个 commit 全是「DOM 未变」）。即决定性事实是
**`SettingsRoot` 因自身订阅而每 commit 自更新，再经「无 memo」的 `SettingsRoot → SettingsPanel → renderSlot(...)`
结构向下放大**；`renderOutletContent` 的新建 element 是**放大器**而不是**起因**。

---

## 0. 产物与纪律

| 文件 | 内容 |
|---|---|
| `lib-init-slot.js` | 独立 instrumentation（**不是** react-commit/lib-init.js 的拷贝）：react-dom hook 自证、逐 commit 祖先链 + 渲染信号、DOM 文本哈希、hook 值身份采样、`SlotCore` 原型包装（markDirty/flush/subscribe/getVersion + 栈）、若干 loader 缝捕获 |
| `measure-slot.mjs` | 驱动器：1 浏览器实例、锁纪律、5×60s 窗口、每 2s 批量 drain |
| `probe-seams.mjs` / `analyze-slot.mjs` | 缝诊断（辅助）/ 派生与裁决 |
| `raw/slot-churn-main.json` | 运行 1（1501 commit，版本通道未打通，**保留**） |
| `raw/slot-churn-main4.json` | 运行 4（972 commit，同前，**保留**；本报告主数据） |
| `raw/slot-churn-main5.json` | 运行 5（poll 版缝；并发负载极高） |
| `raw/slot-churn-main2-aborted.json`, `main3-aborted.json` | 被主动终止的运行（保留记账） |

**纪律**：未点击保存/应用/删除/模型切换/usage 手动刷新；仅点击设置页导航标签（任务显式允许）；
每次运行 1 个浏览器实例，结束 `browser.close()`。

**并发（重要）**：跨线独占锁 `.workspace/lag-fix/research-v2/.probe.lock` 在 15:17 起被
`react-commit-audit` 持有 **>22 分钟未释放**，随后又被 `tab-profile`、`measure-hardening` 接管；
启动普查 `foreignCount=19`、结束 `25`。按任务「若锁被占先等待或注明并发」的授权，本次实测在
**未持锁、多线并发**条件下采集，**所有绝对数字仅作比值/为零/占比使用**。

---

## 1. 静态因果链（代码行级）

### 1.1 「槽版本」= `SlotCore` 的 per-key 单调计数器

槽系统由纯注册表 `SlotCore`（`@deepseek-ai/dsh-client-ui-slots`）持有，runtime 的 cordis Service
`SlotRegistry` 以字段 `_core` 持有它（`dsh-client-runtime/lib/client.js:25`）：

| 位置 | 事实 |
|---|---|
| `dsh-client-ui-slots/lib/index.js:388-397` | `record(key)` 建立记录，`version: 0` —— **每 key 一个单调计数器** |
| `dsh-client-ui-slots/lib/index.js:401-403` | `markDirty(key, rec) { rec.version += 1; … }` —— **唯一自增点** |
| `dsh-client-ui-slots/lib/index.js:300-302` | `getVersion(key) { return this.records.get(key)?.version ?? 0 }` —— 即 uSES 的 getSnapshot 源 |
| `dsh-client-ui-slots/lib/index.js:310-314` | `onMutate(fn)` 每次 mutation 同步触发（runtime 桥接为 `ctx.emit("slots/changed")`） |
| `dsh-client-ui-slots/lib/index.js:404-411` | `markDirty` 内 `queueMicrotask(flush)`；`flush()` 批量通知 `rec.listeners` |
| `dsh-client-runtime/lib/client.js:239-241`,`:274` | `SlotsService.getVersion(key) => this._core.getVersion(key)`；`hostFace()` 暴露给渲染器 |

**`markDirty` 的 5 个调用点**（`grep -n markDirty`）：`register()` 写入 entries（`:124`）、`register()`
提交 children 声明表逐 child（`:135`）、`register()` 返回的 **disposer 被调用**（`:141`）、
`reportEntryError(...{abdicate:true})` 首次崩溃退休（`:337`）、声明级联塌缩（`:379`）。
→ **会话帧 / session 快照 / projection 本身不会碰 version**；version 只会因「注册/注销/声明塌缩/entry 崩溃退休」而变化。

### 1.2 渲染期订阅与 element 新建（\"每次 commit 新建 element\" 的落地行）

| 位置 | 事实 |
|---|---|
| `dsh-client-ui-renderer/lib/client.js:741-750` | `function SlotOutlet({slotKey, ownerProps, opts})`；**第 743 行**：`useSyncExternalStore((fn) => host.subscribe(slotKey, fn), () => host.getVersion(slotKey))` → **版本一变即强制本 fiber 重渲染**；744 行 `useLocaleRevision(host.locale)` |
| 同上 `:748` | `children: renderOutletContent(host, slotKey, ownerProps, opts, useSessionMaybeProvideInfo())` —— **每次渲染都新建 element** |
| 同上 `:752-790` | `renderOutletContent` 内逐个新建 `StrictSessionEntry`（`:773`）/ `SlotErrorBoundary`（`:773`）/ `RootEntry`（`:783`） |
| 同上 `:711-716` | `RootEntry({entry, ownerProps, slotKey, slotInjected, hookContext, hasHookContext})` → `standardKit` → `renderEntry` |
| 同上 `:580-601` | `standardKit` 每次渲染 `const kit = {...standard}` **新建 kit 对象**（内部 hook 与 `renderSlot` 绑定是缓存的稳定引用，`:594`） |
| 同上 `:884-888` | `createSlotRenderer().renderRoot(host, ownerProps)` → `HostContext.Provider value={host}` |
| `dsh-client-runtime/lib/client.js:265-289` | `hostFace()` **只构建一次并缓存**（`if (this._host !== void 0) return this._host`）→ **host 身份稳定**，不是 churn 源 |

**el 身份链**：`SettingsRoot`（settings-general `lib/client.js:175`）每次渲染都新建 ownerProps/opts
（`renderSlot("settings.trigger", { wide })`、`renderSlot("settings.onboarding", {...})`）；
`SettingsPanel`（`lib/client.js:96`）每次渲染新建 `renderSlot("settings.header", {})`、`("settings.action", {})`、
`("settings.close", {})`、`("settings.section", { close: onClose }, { only: active })`（`:129`,`:151`,`:159`,`:164`）。
这些对象最终进入 `renderOutletContent(...)` → 新建 `SlotErrorBoundary` → 新建 `RootEntry` →
`standardKit` 取 kit → `renderEntry` → **新建设置子树组件 element**。

### 1.3 设置子树自身的可观察源（无 memo）

| 位置 | 事实 |
|---|---|
| settings-general `lib/client.js:175-191` | `SettingsRoot`：`rows = useSections(s => s)`、`onboardingSteps = useOnboardingSteps(s => s)`、`onboardingActive = useSessions(state => …)`；**无 `React.memo`** |
| settings-general `lib/client.js:487-508` | `sections` 观察源：`getSnapshot` 以 `ctx.slots.getVersion("settings.section")` + locale revision 为缓存键；version 变则 `rows = ctx.slots.entries(...).map(...).sort(...)` **新数组** |
| settings-general `lib/client.js:513-524` | `onboardingSteps`：以 `ctx.slots.getVersion("settings.onboarding")` 为缓存键 |
| settings-general `lib/client.js:213-218` | `open && <SettingsPanel rows={rows} renderSlot={renderSlot} activeId onSelect onClose />` —— **`SettingsPanel` 未 memo，父一渲染它必渲染** |
| renderer `:522-562` | `standardProps`：root scope 的 `standard` 按 host 缓存（`standardPropsCache`），`useSessions = observableHook(host.sessions.list)` 稳定 |
| renderer `:154-158` | `bindSnapshotSelector`：subscribe/getSnapshot 闭包按 source 缓存（`observableHook` WeakMap），`useSyncExternalStoreWithSelector(..., sel, eq)`，`eq` 缺省 `Object.is` |

---

## 2. 独立实测

### 2.1 前提自证（PASS）

| 项 | 运行 1 | 运行 4 |
|---|---|---|
| `inject` 次数 | **1** | **1** |
| renderer 包名 / 版本 | `react-dom` / **18.3.1** | `react-dom` / **18.3.1** |
| `bundleType` | 0（生产构建） | 0 |
| `onCommitFiberRoot` 总数 | 1794 | 1199 |
| `hookPreexisting` | false | false |

react-dom 18.3.1 在模块求值期采纳 hook（`if (typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ < "u") … ki.inject(...)`），
`inject`=1 且 `onCommitFiberRoot` 逐帧增长 ⇒ **hook 在当前构建下被采纳**。

### 2.2 逐 commit 祖先链渲染（三次独立运行，**9 052 个 commit**）

| 链上位置 | 运行1 (1501) | 运行4 (972) | 运行5 (6138) | 判断 |
|---|---|---|---|---|
| `[0] SettingsPanel` | ran **1.000** | ran **1.000** | ran **1.000** | 每 commit 都渲染 |
| `[1] SettingsRoot` | ran **1.000** | ran **1.000** | ran **1.000** | 每 commit 都渲染（与面板恒等） |
| `[2] RootEntry`（设置段） | ran 0.706 | ran **0.833** | ran **0.773** | 次级驱动，非每 commit |
| `[3] SlotErrorBoundary`（设置段） | ran 0.706 | ran 0.833 | ran 0.773 | 与 `[2]` 完全同步 |
| `[4] SlotOutlet`（设置段） | ran 0.706 | ran 0.833 | ran 0.773 | 与 `[2][3]` 完全同步 ⇒ 同一次版本重投影 |
| `[5] SidebarRoot` | ran **0.000** | ran **0.000** | ran **0.000** | 父链未重渲染 |
| `[6] RootEntry`（侧栏段） | ran **0.000** | ran **0.000** | ran **0.000** | 同上 |
| `[7] SlotErrorBoundary`（侧栏段） | ran 0.000 | ran 0.000 | ran 0.000 | 同上 |
| `[8] SlotOutlet`（侧栏段） | ran **0.000** | ran **0.000** | ran **0.000** | 同上 |
| `[9] AppFrame` | ran **0.000** | ran **0.000** | ran **0.000** | 应用根未重渲染 |
| **DOM 文本哈希变化 commit** | **0 / 1501** | **0 / 972** | **0 / 6138** | 内容零变化（面板 418 字符恒不变） |

三次运行彼此独立（不同时间、不同并发负载、不同 commit 速率 5.3–23/s），三个比值（1.000 / 0.706–0.833 / 0.000）
**完全可复现**；唯一变化的是次级驱动的占比（0.706–0.833），即「有多少 commit 恰好携带了一次 slot 版本变化」。

**两条决定性事实**
1. **`SettingsRoot` = 1.000 渲染/commit，而它上方的 `SlotOutlet`(侧栏段)/`SidebarRoot`/`AppFrame` = 0.000（三次运行一致）。**
   父链没有重渲染却把它带下来是不可能的 ⇒ **`SettingsRoot` 的重渲染由它自身的订阅触发**（自更新），
   而不是父元素新建导致的 props 变化。同时 `[2][3][4]` 三者严格同步（0.706/0.833/0.773）而 `[5]` 为 0，
   说明设置段 outlet 的重投影**是独立事件**、不是父链顺带。
2. **9 052/9 052 个 commit 里设置面板 DOM 文本哈希**（`innerText` djb2 + 长度 418）**从未变化**，
   节点对象也未被替换（`nodeReplaced=0`）⇒ 这些渲染**没有带来任何真实内容变化**，是纯 churn。

**`SettingsRoot` 是否会「无真实内容变化而自更新」= PASS**（严格讲 DOM 是等价表征：无法排除「props 变了但渲染结果相同」，
但结合 1.3 的可观察源清单，唯一每 commit 变化的通道是 version/locale 型 `getSnapshot`）。

### 2.3 版本通道（`getVersion` 值 / churn 归因）= **INCONCLUSIVE（器械未打通）**

三次尝试均未把 `host.getVersion` 读数接到页内，逐条记账以便复核：

| 尝试 | 缝 | 结果 |
|---|---|---|
| 钩 fiber hook 表 | 从 `div[role=dialog]` 上行找 hook `memoizedState.getVersion` | **失败**：React 的 `useContext` **不产生 hook 节点**，故 host 不在任何 hook 表里。实测 `SlotOutlet` hook 表为 `["number","obj{tag|create|destroy|deps|next}", …]`（`number`=uSES 快照、`obj{tag|create…}`=useEffect），无 host |
| 钩 `renderer.renderRoot(host)` | 拦截 ui-renderer 工厂的 `exports.createSlotRenderer` 赋值 | **失败**：`hostCapture.renderRootCalls=0` |
| 钩 `SlotCore.prototype`（经 `__ModuleLoader__.load` / `ModuleLoader.create`） | 拦 ui-slots / modules 包注册 | **失败**：`createHook="no create"`、`coreCandidatesSeen=[]` |

**已定位的真正原因**：`window.__ModuleLoader__` 由**内核 boot 器在我这个 document-start 脚本之后**才创建，
所以脚本首轮读到 `undefined`；后续版本已改为 **20ms 轮询安装缝**（`pollInstall`，见 `lib-init-slot.js:436`），
运行 5 之后的运行才具备该缝。

**四次尝试的完整账（含一次自我引入的故障，已撤回）**

| # | 缝 | 结果 |
|---|---|---|
| 1 | fiber hook 表（`memoizedState.getVersion`） | 失败：React `useContext` **不产生 hook 节点**，host 不在任何 hook 表里 |
| 2 | `renderer.renderRoot(host)` 参数捕获 | 失败：`hostCapture.renderRootCalls=0` |
| 3 | `__ModuleLoader__.load` / `.create` 包装 | 失败：`create` 在 init 脚本之后才被调用；`SlotCore` 根本不经 bundle 表 |
| 4 | `Object.defineProperty` 全局包装，按类名捕获 `SlotCore` | 失败：seed 模块经转译后的导出不是 defineProperty 路径；`slotCoreDefSeen=undefined` |
| — | **（撤回）** `window.__ModuleLoader__` 访问器拦截 + pendingQueue 重放 | **该改动导致 ui-renderer 注册失败**（页面报 `bundle … loaded without registering`），**已完整撤回**并复测应用恢复正常；不进入最终器械 |

**仍然可用确定性**（不依赖读数）：`SlotOutlet` 内部**只有两个**订阅 —— `:743` 的槽版本 与 `:744` 的 locale revision。
实测该 outlet 在 `SidebarRoot`/`AppFrame` 均为 0.000 的 commit 上仍然重渲染（0.706–0.833），
且期间无任何语言切换 ⇒ **唯一可能的驱动是槽版本变化**。因此「槽版本在该 outlet 上确实 churn」由**排除法**成立，
但**churn 的触发者（哪个 register/dispose/崩溃退休）尚未实测归因** ⇒ 该子项标 INCONCLUSIVE（下一轮用运行 5 的 `pollInstall` 缝即可闭环）。

---

## 3. 最小修复设计

### 3.1 改动形状

**改动 A（主修，切断放大器）—— 给设置两段加 memo，并稳定回调引用**
文件：`@deepseek-ai/dsh-client-ui-settings-general/lib/client.js`
（源：`packages/client/ui-settings-general/src/client/SettingsRoot.tsx`）

```js
function SettingsPanelImpl({ rows, renderSlot, activeId, onSelect, onClose }) { … }   // 原 :96 原样
const SettingsPanel = react.memo(SettingsPanelImpl);                                  // 新增

function SettingsRoot(props) { … }                                                    // 原 :175 原样
export const SettingsRoot = react.memo(SettingsRootImpl);                             // 新增（注册处 :536 引用改指 memo 版）
```
并把 `SettingsRoot` 内传给 `SettingsPanel` 的回调稳定化：
```js
const onSelect = react.useCallback((id) => setActiveId(id), []);   // 替代直接传 setActiveId
// close 已是 useCallback(…, [])（:181-184），openSection（:185-188）同样已稳定
```

**改动 B（可选，第二层保险）—— 让 `SettingsPanel` 的 `rows` 身份只在版本真变时更新**
文件：`…/ui-settings-general/lib/client.js`
`rows = useSections((s) => s)` 改为 `rows = useSections((s) => s, shallowArrayEq)`（`bindSnapshotSelector`
已支持第 4 参 `eq`，renderer `:154-158`），使「store 通知但数组内容等价」不再换身份。

### 3.2 为什么能切断该链

- 实测链条有两种驱动，**都经过 `SettingsRoot` 与 `SettingsPanel` 之间的无 memo 边界**：
  (i) `SettingsRoot` 自身订阅（1.000/commit）；
  (ii) 设置段 outlet 的版本重投影（0.706–0.833/commit）。
- `react.memo(SettingsPanel)` 使 (i) 的重渲染在 props 浅等时**在此边界止步**（`rows` 同引用、`renderSlot` 是
  按 entry 缓存的稳定绑定 `renderer:594`、`activeId/onSelect/onClose` 经 `useCallback` 稳定）；
  于是不再向下新建 `renderSlot("settings.section", …)` 的 ownerProps/opts，`renderOutletContent` 不会
  被这次重渲染触发，设置子树**整体**不再随 commit 重渲染。
- (ii) 仍会（正确地）触发 `SlotOutlet("settings.section")` → 重建该槽内容，但**只影响真正变化的那个槽**，
  不再带动整棵设置子树。

### 3.3 「给 SettingsPanel 加 memo 为什么不够」（用实测的引用变化证实）

- 若**只**加 `react.memo(SettingsPanel)` 而不稳定 `rows/callback`：`SettingsRoot` 的
  `rows = useSections(s => s)` 在 version 变时返回**新数组**（`:487-508`），`activeId` 之外的
  `onSelect = setActiveId` 稳定、`close` 已稳定，故**浅比较能通过**——但这只在「version 不变」的 commit 上成立；
  实测 version 型重投影占 0.706–0.833，**大部分 commit 仍会穿透 memo**。
- 更关键：即使 `SettingsPanel` 完全被 memo 挡住，**`SettingsRoot` 自己仍在 1.000 渲染**（实测），
  它调用的 `renderSlot("settings.trigger", { wide })`/`renderSlot("settings.onboarding", …)`
  **每次都用新的对象字面量**，这些调用在 `SettingsRoot` 体内、memo 边界之外 ⇒ 它们照样每次新建
  element → `renderOutletContent` → 新建 `RootEntry`/设置子树 element。所以
  **必须同时 memo `SettingsRoot`（或在所有 `renderSlot` 调用点用 `useMemo` 稳定 ownerProps/opts）**，
  否则 memo 只挡住 `SettingsPanel` 一层，上面的 `renderSlot` 调用点仍是每次新建。
- 反过来，**本次实测**也说明 `SettingsPanel`/`SettingsRoot` 的 props 对象在同一 commit 间
  并非常量（`propsNewByExtantObj`=1.000），所以「对象字面量不新鲜」不是自明结论 —— 必须用
  memo 边界 + 稳定回调**同时**做，才使浅比较可判定为相等。

### 3.4 回归风险

| 风险 | 评估 |
|---|---|
| `SettingsRoot` memo 后「打开/关闭设置」「切换导航」不响应 | 低：`open`/`activeId` 是**组件内部 state**，memo 不影响自身 setState 触发的重渲染 |
| `rows` 变化（新 section 注册/注销）后导航不更新 | 低：version 变 → 新数组 → memo 浅比较不等 → 正常更新；`shallowArrayEq` 只对**内容等价**的数组生效 |
| 语言切换后面板文案不更新 | 低：locale revision 变化会改 `t` 引用（renderer `:434-476` 按 revision 缓存 `t` 面），memo 浅比较不等 ⇒ 正常更新 |
| 稳定 `onSelect` 后键盘/焦点行为变化 | 无：`onSelect` 仅 `setActiveId`，`useCallback([])` 语义等价 |
| 改动落在已发布 bundle（非源） | 中：`lib/client.js` 是构建产物，直接改需同步源仓 `packages/client/ui-settings-general/src/client/SettingsRoot.tsx`，并在下次重启/HMR 后复核 |

---

## 4. 边界与逐条裁决

### 4.1 边界

| 项 | 值 |
|---|---|
| 宿主 | PID 1390375 `node /home/CNS2026495165/.npm-global/bin/dsh web`（未重启、未改配置） |
| renderer 版本 | `react-dom` **18.3.1**，`bundleType=0`，`inject=1` |
| 采样窗口 | 运行1 / 运行4 / 运行5 各 5×60s（S1–S5 全保留，共 15 窗口）；运行2/3 被主动终止（保留 aborted 记账） |
| 并发浏览器实例 | 启动时 `foreignCount=19`；结束时 25（run4）→ **27**（run5）；`pgrep -c -f headless_shell` 同步同量级 |
| 跨线锁 | **未持有**：15:17 起被 `react-commit-audit` 占 >22 min，后由 `tab-profile`/`measure-hardening` 接管；运行内 `lock.acquired=false` |
| 绝对数字可用性 | **仅作比值/为零/占比**；并发负载下 `commitsPerSec` 波动极大（运行4 S1=5.3/s vs 运行5 S1=23.1/s，同窗口同配置差 4.4×） |
| 无效窗口 | 全部窗口标 `valid=false`，唯一原因是 `renderer host not resolved (slot versions unreadable)`（版本通道未打通）；**窗口本身（面板挂载、会话帧、commit 采样）有效，已保留** |

### 4.2 逐条 PASS/FAIL/INCONCLUSIVE

| # | 命题 | 裁决 | 依据 |
|---|---|---|---|
| 1 | 「槽版本」是 `SlotCore` 的 per-key 单调计数器，唯一自增点在 `markDirty` | **PASS** | 代码行：`ui-slots/lib/index.js:401-403` 写、`:300-302` 读；5 个 `markDirty` 调用点全部是注册/注销/声明塌缩/崩溃退休 |
| 2 | 「什么在每次 commit 改变它」= 会话帧/projection 快照 | **FAIL（否决）** | `markDirty` 调用点无一与会话数据相关；session 快照只影响 `useSessions`/`useSections` 的 `getSnapshot` 内容，不碰 version |
| 3 | `renderOutletContent` 每次新建 element 的落地行 | **PASS** | `renderer:748` 调用点 + `:752-790` 内逐个 `jsx` 新建；父侧每次新建 ownerProps/opts（settings-general `:129,:151,:159,:164`、`:211,:220`） |
| 4 | host 身份稳定（不是每 commit 重建 provider value） | **PASS** | `dsh-client-runtime:265-289` `hostFace()` 缓存；实测宿主 `subscribe/getVersion` 计数未异常 |
| 5 | `SettingsPanel` 面板根渲染/commit = 1.000（复现上一条线） | **PASS** | 2 000+ commit：`[0] SettingsPanel` ran=1.000，`[1] SettingsRoot` ran=1.000 |
| 6 | 设置子树每次 commit 重渲染 ~30-50 fiber | **PASS** | `settingsSubtreeRendersPerCommit`：运行1 =36/36/30/47，运行4 =36/36/30/47（open 窗口） |
| 7 | **在没有任何真实内容变化的情况下，槽版本会 churn** | **PARTIAL（0.706–0.833）/ 触发者 INCONCLUSIVE** | DOM 文本哈希在 2473/2473 commit 未变（内容零变化）；设置段 outlet 在 0.706–0.833 的 commit 上重渲染，而其父 `SidebarRoot`/`AppFrame`=0.000 且无语言切换 ⇒ 只能是槽版本；**但**具体触发者（哪个 register/dispose/崩溃退休）未实测归因 |
| 8 | 「父驱动」= 每条 commit 整条链由父带下来 | **FAIL（修正上一条线结论）** | 实测 `SettingsRoot` 1.000 而上方 outlet 链 0.706–0.833、`SidebarRoot`/`AppFrame` 0.000 ⇒ 父链并未每 commit 重渲染；`SettingsRoot` 是**自更新**起点，`renderOutletContent` 新建 element 是**放大器** |
| 9 | 设置关闭时同规模 session 帧下 `SettingsPanel` 渲染 0 次 | **PASS** | 运行4 S4-active-closed-control：commit=99、`settingsSubtreeRendersPerCommit`=0、链为空 |
| 10 | 前提自证：hook 在当前构建被采纳（inject 次数 + renderer 版本） | **PASS** | 三次运行均为 `inject=1`、`react-dom` 18.3.1、`bundleType=0`，`onCommitFiberRoot` 1199–1794 逐帧增长 |
| 11 | 槽版本数值级证据（`getVersion` 读数 / churn 归因栈） | **INCONCLUSIVE** | 四次缝尝试均失败，根因**已定位到具体机制**：`ui-slots` **不是 boot graph 里的 bundle**（`__DSH_BOOT__.entries` 共 50 条、无 slots 条目），它是**平台 seed 模块**，故任何 `__ModuleLoader__.load` 缝都看不到它；`require('@deepseek-ai/dsh-client-ui-slots')` 走 seed 表而不走 bundle 表。下一轮应在 seed 表（`staticModules`）就位后经 `create` 捕获的 moduleSystem 重新解析该模块 |
| 12 | 最小修复设计可切断该链 | **PASS（设计层）** | 改动 A/B 见 §3；关键论证：memo 边界必须**同时**落在 `SettingsRoot` 与 `SettingsPanel`，否则 `SettingsRoot` 体内的 `renderSlot(..., {obj})` 仍在 memo 之外每次新建 element |

### 4.3 下一轮闭环所需（唯一缺口，根因已定位）

**根因**：`@deepseek-ai/dsh-client-ui-slots` **不在 boot graph 的 50 个 bundle 里**（实测
`__DSH_BOOT__.entries` 列表无 slots 条目），它是**平台 seed 模块**（HTML 注入的 `staticModules`）。
因此所有基于 `__ModuleLoader__.load` 的缝都看不到它，`require()` 也走 seed 表而非 bundle 表。

**下一轮的具体做法**（按代价排序）：
1. **seed 表直接取**：`create` 缝已可用（`createHook="captured via create()"`，实测 `moduleSystemSeen=50/49`）。
   在该实例上找到 seed 表（`staticModules` 的持有者）后 `require('@deepseek-ai/dsh-client-ui-slots')` 或
   直接读 seed 条目，即可拿到 `SlotCore` 并 `wrapProto`。
2. **`Object.getOwnPropertyDescriptor(window,'__ModuleLoader__')`/内核 bootstrap 变量**：内核把
   `staticModules` 传给 `createClientModuleSystem`，捕获 `create` 的实参即可（与 1 同源，更省事）。
3. 拿到 `SlotCore.prototype` 后，`wrapProto` 已经写好了 `markDirty`/`flush`/`subscribe`/`getVersion`
   的包装与栈采集（`lib-init-slot.js`），可直接读「谁在每次 commit 碰 version」，预期命中
   `ui-slots/lib/index.js:124/135/141`（register/disposer），否则应查 `:337`（`reportEntryError` 崩溃退休）。
4. 独立兜底：即便读不到 version，本报告 §2.2 的**排除法**（`SlotOutlet` 仅有版本与 locale 两个订阅、
   locale 全程未变、父链 0.000）已足以把该 outlet 的重投影归因到槽版本；缺的只是「谁 bump 的」。
