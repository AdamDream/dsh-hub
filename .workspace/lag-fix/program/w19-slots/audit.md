# w19-slots 审计：槽渲染管线（`SlotOutlet` / `SlotErrorBoundary` / `RootEntry`）

- 线：`program/w19-slots/`（独占）
- 审计日期：2026-09-22（本地 CST +08:00；探针运行 18:36–18:51）
- 宿主：`http://127.0.0.1:3080`，**pid 2988915**（`node /home/CNS2026495165/.npm-global/bin/dsh web`；其外层 `npm exec` 包装进程为 2988897，本轮**未重启、未 pkill、未改任何产品文件或用户 profile**）
- 授权：**只读审计**（不改产品文件）+ **最多 2 个二级 subagent**（已用满 2 个：M1 重叠档 `raw/w07-m1-overlap.md`、跨线检索档 `raw/crossline-sweep.md`）
- 范围：① 三个组件的**渲染触发条件**逐条拆解 + "一次通知穿透整条槽链"的机制；② memo 边界的可行性与陷阱 + **可判定的稳定化方案**；③ `layout:159` 恒等选择器的真实后果；④ 与 `w07` 的 **M1（投影键闸门）**是否重叠；⑤ 前三优化候选（收益/风险/验收/回滚/热冷面）
- 必读遵守：`program/w01-client-render/audit.md` §7 归因（13e：三组件 ≈29%，parent-driven 79.2% / root-props-changed 17.6%）、`exec-audit/BATCH-PLAN.md` §五（测量协议 20 条）、`lib/probe-lock.mjs`（新锁）
- 原始产物：
  - `raw/w19-all-*.json`（3 批、全量窗口 + 逐 commit 归属）｜`raw/w19-analysis.json`（**本线判据的机器可读汇总**）
  - `raw/w19-dump-layout-*.json`、`raw/w19-dump-switch-*.json`、`raw/w19-pos-120-*.json`、`raw/w19-none-*.json`、`raw/w19-run.log`
  - `raw/w07-m1-overlap.md`（二级档 A）、`raw/crossline-sweep.md`（二级档 B）
  - `tools/probe-w19.mjs`、`tools/analyze-w19.mjs`、`tools/w19-init.js`（= w01 器械 + **一处只读 accessor**，见 §1.3）

---

## 0. 判据口径与纪律（先声明，再报告）

| 项 | 本轮取值 |
|---|---|
| 主判据 | **CDP `RunTask`**（trace 类别**含** `disabled-by-default-devtools.timeline`）+ **LoAF `duration`** |
| 页内判据 | **wall-clock rAF 间隔**（回调入口 `performance.now()`，**不用 `ts` 参数**）+ **窗口播种**（arm 后 ≥2 帧才注入） |
| 阳性对照 | **页内 `setTimeout`** 注入 120 ms 忙循环（**禁用** CDP `Runtime.evaluate` 注入作对照） |
| 阴性对照 | 同长度 `none` 窗；**新增**：同窗内等长静默段（pre）与事件段（post）互为对照 |
| **本线新增的主判据** | **事件锚定的逐 commit 组件归属**：每次事件后，把该 commit 渲染过的**具名 fiber 清单**取出来（`PerformedWork` 位 = `flags & 1`，即 w01/各线同口径的 "rendered"），再按"是否含 `AppFrame`"判定它是不是布局 store 写导致的 commit。**这是计数/归属类判据，不受后台事件流计数波动污染**（本环境后台流非平稳，见 §3.4，故**不使用**分段计数差值作立柱） |
| 并发口径 | cmdline 含 `--remote-debugging-pipe` **且不含** `--type=`，**排除自身**；每窗起止各一次 |
| 锁 | 只用 `lib/probe-lock.mjs` |
| 引擎/DPR | `HeadlessChrome/131.0.6778.33`（UA 读回）；页内 `devicePixelRatio = 1`，canvas backing/CSS = **100/100 px** 自证；**未使用** `--force-device-scale-factor`。**headless ⇒ 无 GPU 合成**，绝对 ms 只对主线程 JS/布局成立 |
| 绝对值 | 本批 **17/17 窗口 `foreign=0/0` 且 `lockMine=true`（独占）**，`0 pageerror` ⇒ 绝对 ms 在本批**可用**，但**只用于旁证**，立柱一律是计数/比值（见 §3.5） |
| 禁止 | 后台标签页帧统计；把 `visibilityState==='visible'` 当"帧在产出"的证据；`>50ms` 帧计数当灵敏度判据；挑选最佳窗口；把 `[data-slot]` 的**面积**当判据（运行时 `display:contents` ⇒ 面积恒 0，会假失败） |

---

## 1. 现状前提（必须先钉死，否则行号与结论全错）

### 1.1 本轮三次落盘（都是槽渲染的观测面）

| # | 落盘件 | 对本线的影响 | 证据 |
|---|---|---|---|
| 1 | `dsh-client-runtime` **投影键闸门 + rAF 合并** | 减少**通知次数**（w07 M1，见 §6） | `/* w07-throttle v1 */` @ `runtime:5732/5850/8024/8344`；sha16 `4a2c298dd82613c7`，mtime 18:08:53 |
| 2 | a11y 焦点/inert 层 | 给覆盖层加 `inert`/`aria-hidden`（本线探针的 `inertCount` 随之变化） | `layout:566+`，标记 `dsh-exec-a11y:U-A11Y1:v1` |
| 3 | **HMR 时序修复** | **`SlotErrorBoundary` 新增 `TRANSIENT_*` 有界延迟重挂**（自驱动状态通道变宽） | `renderer:566-614`（`state.attempt` / `retryTimer`，`:567-568`/`:588-601`） |
| 4 | **K1 keep-alive 落地**（w01 §6.2 的推荐首选） | **`settings.section` 的 outlet 数从 1 变成 N**（N = 访问过的栏目数）⇒ 槽链每 commit 的扇出被放大 N 倍（本线核心发现，见 §3.5） | `settings-general:196-206`：`rows.filter((row) => row.id === active \|\| visitedIds.has(row.id)).map((row) => …)` + `renderSlot("settings.section", { close: onClose, visible: selected }, { only: row.id })` |

### 1.2 字节口径（本线所有 `file:line` 就是浏览器执行的字节）

```
renderer   sha256-12 = 7468f0c67407    (served == $L 磁盘 == $P 副本)
```
`$L = ~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`
`$P = ~/.dsh/profiles/node_modules/@deepseek-ai/`

**⚠️ 行号口径警告（本轮若干文档的行号已过期）**：`settings-general` mtime 16:39（K1 落盘）、`renderer` mtime 18:30（HMR 修复）。因此既有文档里的
`settings-general:164`（旧：单条 `renderSlot(..., {only: active})`）、`renderer:711/518/743/748` 等**均已漂移**。本报告一律用**当前 bundle** 行号：

| 组件/函数 | **当前行号** | 旧文档行号（已失效） |
|---|---|---|
| `SlotErrorBoundary`（class） | `renderer:566-614` | `:518-541` |
| `renderEntry` | `renderer:706-720` | — |
| `RootEntry` | `renderer:789-794` | `:711` |
| `SlotOutlet` | `renderer:819-828` | `:736-748` |
| `renderOutletContent`（`guarded` 闭包） | `renderer:830-911`（`guarded` 在 `:839-849`） | `:752-833` |
| `boundRenderSlot`（**绑定**缓存，非 element 缓存） | `renderer:281-301` | — |
| `bindSnapshotSelector`（**转发 `eq`**） | `renderer:154-159` | 同 |
| `useLocaleRevision` / `localeSubscription`（WeakMap 缓存） | `renderer:484-487` / `:469-479` | 同 |
| `standardKit`（**每次新建 `kit` 对象**） | `renderer:658-682` | — |
| `SettingsPanel` / `SettingsRoot` | `settings-general:106` / `:217` | `:96` / `:176` |
| keep-alive 容器 + `{close, visible}` | `settings-general:196-206` | `:164` |
| `rows` 记忆键快照（version+locale 为键） | `settings-general:531-560`（`rowsVersion/rowsRevision` @ `:531-532`，快照工厂 `:536-551`，`getVersion("settings.section")` @ `:539`，`subscribe` @ `:545-551`） | `:496-509` |
| `AppFrame` / `useStore((s) => s)` | `layout:158` / `:159` | 同 |
| 布局 store 与 actions | `layout:277-305` | 同 |

### 1.3 器械自证与一处**已声明的**器械修改

`tools/w19-init.js` 与 `w01-client-render/tools/w01-init.js` **逐字节相同**（sha256-12 `9f1a2243d385`），仅**追加**一个只读 accessor：

```js
W.commitsIn = (a, b) => W.commits.filter(c => c.t >= a && c.t <= b).map(c => ({ t, pw, total, mounts, self, parent,
  rootPropsChanged, names: Object.keys(c.names).sort(), namesId, namesTotalCount }));
```
**为什么必须加**：w01 器械的点击采集器有 `if (!ev.isTrusted) return`，而本线的布局写事件只能用**程序化 `el.click()`** 驱动 —— 因为设置弹窗的遮罩铺满视口，**可信鼠标点击落在遮罩上只会关闭弹窗**，无法触达侧栏折叠按钮。accessor 只**读**已采集的 per-commit 记录，不新增测量、不改时序。
（器械自证：`inject=1`、`onCommitFiberRoot` 每窗非空、`loafOk=true`、`ltOk=true`、`pageErrors=[]`。）

---

## 2. ① 三个组件的渲染触发条件（逐条拆出）

### 2.1 `SlotOutlet`（`renderer:819-828`）——**两个自驱动订阅 + 一个父驱动**

```js
function SlotOutlet({ slotKey, ownerProps, opts }) {          // :819
  const host = useHost();                                      // :820  useContext（不产生订阅）
  react.useSyncExternalStore((fn) => host.subscribe(slotKey, fn),   // :821 ← ① 槽版本通道
                             () => host.getVersion(slotKey));
  useLocaleRevision(host.locale);                              // :822 ← ② locale revision 通道
  return jsx("div", { "data-slot": slotKey, style: ANCHOR_STYLE,
    children: renderOutletContent(host, slotKey, ownerProps, opts, useSessionMaybeProvideInfo()) });  // :823-827
}
```

| # | 触发条件 | file:line | 谁让它变 |
|---|---|---|---|
| **T1** | **槽版本 bump**（`host.getVersion(slotKey)` 变化） | `:821`；版本由槽核心 `markDirty(key, rec)` 的 **`rec.version += 1` 单点自增**，其 5 个调用点全是**注册/注销/塌缩/崩溃退休**，**与投影无关**（**部署件**：种子模块内联于壳 bundle `/assets/index-ClqxG24t.js:56`（`markDirty(n,i){i.version+=1`，served 200）；**可读源码等价**：`@deepseek-ai/dsh-client-ui-slots/lib/index.js:399-411`） | 插件注册表变动、HMR 重注册、条目崩溃退休 |
| **T2** | **locale revision 变化** | `:822` → `:484-487`；订阅对由 `localeSubscriptionCache`（WeakMap，`:469-479`）缓存 ⇒ **身份稳定**，不会逐渲染重订 | 语言切换 |
| **T3** | **父渲染**（元素被 owner 重建） | 由 owner 调 `renderSlot(key, ownerProps, opts)` 产生；绑定函数 `boundRenderSlot` 按 entry 用 WeakMap 缓存（`:281-301`），但**每次调用都新铸一个 `<SlotOutlet>` element**，其 `ownerProps`/`opts` 是 owner **当场新建的对象字面量** | 任何 owner 的渲染 |
| **T4（⚠️ 副作用）** | `:821` 的 `subscribe` 与 `getSnapshot` 是**内联箭头**，每次渲染都是**新身份** ⇒ uSES 在每次渲染都**退订+重订**一次（渲染器注释自陈此点）。**不改变渲染次数**（重订后读到的 version 未变 ⇒ 不强制重渲染），是一项**独立开销**，列为本线候选 ③（§7.3） | `:821` | 自身每次渲染 |

### 2.2 `SlotErrorBoundary`（`renderer:566-614`，class）——**只有父驱动 + 崩溃状态**

| # | 触发条件 | file:line | 说明 |
|---|---|---|---|
| **T5** | **父渲染**（props `{slotKey, onEntryError, children}`） | `:566`；`onEntryError` 由 `guarded()` 内的**新箭头**每渲染给出（`:839-841`），`children` 由父**每渲染新建** ⇒ **浅比较永不失配不了**（见 §4 陷阱 T-2） | 无自订阅 |
| **T6** | `state.failed` / `state.attempt` / `retryTimer` | `:567-568`、`:588-594`（`TRANSIENT_*` 有界延迟重挂，**本轮新落盘**）、`:597-601` | 仅崩溃 + 瞬时服务缺失路径 |

### 2.3 `RootEntry`（`renderer:789-794`）——**纯父驱动，零订阅**

```js
function RootEntry({ entry, ownerProps, slotKey, slotInjected, hookContext, hasHookContext }) {   // :789
  const host = useHost();                                  // :790 useContext
  const Comp = entry.component;
  const { kit, standard, actions } = standardKit(host, entry, "root", void 0);                    // :792
  return renderEntry(slotKey, Comp, kit, standard, cachedRootInject(entry, actions), slotInjected, ownerProps, hookContext, hasHookContext);  // :793
}
```
- `standardKit`（`:658-682`）只**读缓存**（`standardPropsCache`/`observableHook` WeakMap/`host.storeOf`）+ **新建 `kit` 对象**；它**不订阅**任何 store。`kit` 也不是 `RootEntry` 的 prop —— 它在 `renderEntry`（`:706-720`）里被 **spread 进注册组件 `Comp` 的 props**。
- ⇒ **`RootEntry` 的渲染当且仅当其父（`SlotErrorBoundary`）渲染**；它自身没有任何能独立点火的东西。这正是 w01 §3.4.5 归因里 `RootEntry` **parent-driven** 的结构原因（跨线档 B 复核：类型二自驱动 `RootEntry` = 0）。

### 2.4 ★「为什么一次通知会穿透整条槽链」—— 四条结构原因（缺一不可）

1. **链上零 memo 边界**：`renderer` 内 `react\.memo` 命中 = **0**（w01 F5；本轮复核 0）。父渲染 ⇒ 子渲染，**无条件**。
2. **所有信息（包括"什么都没变"）都以"新对象身份"交付**：本 roster 的**每一个** `renderSlot` 调用点都传**当场新建的对象字面量**（见 §2.5 全表）。因此即使**加上** memo 边界，中间链路（`SlotOutlet`/`SlotErrorBoundary`）也**永远无法 bail out** —— 这是 §4 的核心。
3. **两个自驱动"座"位于条目体之上**：`SlotOutlet` 的 T1/T2 与 boundary 的 T6 都在**业务组件之上**，一旦点火，其下方全部重渲染；而 `RootEntry` 及其下方**没有任何独立的信息通道**（信息全在 props 里）。
4. **K1 之后扇出 ×N**：`settings.section` 现在一次渲染创建 **N 个** outlet（N = `visitedIds` 大小，本轮 = 8）⇒ 穿透一次 = **N 个栏目体 + 其深层子树**。

### 2.5 全 roster 的 `renderSlot` 调用点：**12/12 传新对象**（②的爆炸半径清单）

| 调用点 | 传的 ownerProps | 是否含**新闭包** |
|---|---|---|
| `layout:228-231` | `{ collapsed: sidebarCollapsed, width: cols.sidebar }` | 否（纯标量） |
| `layout:233` | `{}`（conversation） | 否 |
| `layout:233` | `{}`（details） | 否 |
| `layout:237` | `{}`（shell.overlay） | 否 |
| `sidebar:225-227` | `{ wide, expandSidebar: () => { if (collapsed) toggleSidebar(); } }` | ★ **是**（新箭头） |
| `sidebar:236` | `{ wide }`（sidebar.settings → `SettingsRoot`） | 否 |
| `settings-general:159` | `{}`（settings.header） | 否 |
| `settings-general:182` | `{}`（settings.action） | 否 |
| `settings-general:190` | `{}`（settings.close） | 否 |
| `settings-general:204` | `{ close: onClose, visible: selected }` × **N 行** | 否（但 N 行各自新建） |
| `settings-general:253` | `{ wide }`（settings.trigger） | 否 |
| `settings-general:262-266` | `{ stepId, complete: () => {...}, openSection }` | ★ **是**（新箭头） |
| `settings-general:340` | `{}`（settings.general.item） | 否 |

> 另有 `renderSlot("root", {})` 的 ctx 级入口（`runtime:154-159`），以及各 profile 插件的调用点（未穷举；本线只穷举了主干 5 个包 + `settings-general`）。

---

## 3. ① 的 live 证据（独占窗、事件锚定、逐 commit）

### 3.1 通道自证（**PASS，3 批独立、阳性 6/6 + 阴性内对照**）

| 批次 | 阳性对照（页内 `setTimeout` 120 ms） | 阴性 `none` |
|---|---|---|
| 10:36 | 注入 **120/120 ms**；`RunTask max` **120.26 / 120.26**；LoAF **n=1**；rAF max **121.1 / 121.6** | RunTask max 356.45 / 11.99；LoAF n 1/0；rAF 356.9 / 23.0 |
| 10:45 | 注入 **120/120**；RunTask max **120.26 / 120.34**；LoAF n=1/1；rAF **121.7 / 121.9** | — |
| 10:49 | 注入 **120/120**；RunTask max **120.27 / 120.20**；LoAF n=1/1；rAF **122.2 / 122.3** | RunTask max 6.08 / 8.91；LoAF n 0/0；rAF 17.3 / 25.1 |

⇒ **阳性对照 6/6 三通道同时报出 120 ms**（RunTask/LoAF/rAF 三通道一致），阴性对照 4/4 窗 LoAF=0。**⚠️ 如实记录一处异常**：10:36 批的一次 `none` 窗 `RunTask max = 356.45 ms`（该窗 census 仍 `foreign=0/0`）—— 该窗的"空闲"不干净，故本线**不把 `none` 当零基线**用，只用它证明阴性与阳性可分。

### 3.2 事件锚定的主实验（本线核心）

**设计**：设置弹窗打开 → 依次访问全部 8 个栏目（`warm-visit row=0..7`，使 `visitedIds` = 8）→ 回到第 0 栏 → 每事件 = 1.5 s 静默段 + **一次**程序化点击 + 1.5 s 事件段；两段各取 slice() 与 `commitsIn()`。

**归属判据**：布局 store 的 React 消费者**唯一**（见 §5.1）⇒ **该 commit 的具名 fiber 清单里含 `AppFrame`，当且仅当它是一次布局 store 写**。

| 量 | 布局写（`dump-layout`，10:49 批） | 栏目切换（`dump-switch`，10:49 批） |
|---|---|---|
| 事件数 / 锚定成功 | **4/4** | 4/4（无锚定语义，切换不写布局 store） |
| **静默段（pre）含 `AppFrame` 的 commit** | **0**（4 段共 46 commit） | **0**（4 段共 10 commit） |
| **事件段（post）含 `AppFrame` 的 commit** | **4**（= 4 次点击各恰好 1 个） | **0** |
| 锚定 commit 渲染的**具名 fiber 数** | **116 / 117 / 116 / 117** | 91–110（p50 99） |
| 锚定 commit 的 `pw`（rendered 总数） | **422 / 423 / 422 / 423** | 268–396 |
| 其中 **parent-driven / self / mounts / rootProps** | **420/313 · self=1 · mounts=1/109 · rootProps=0** | 231–378 · self=2–5 |
| 该 commit 渲染到的**栏目体数** | **8/8** | 8/8 |

**⇒ 因果链（实测，不是我方推断）**：**一次** 侧栏折叠点击 → **一次**布局 store 写 → **恰好一个** commit 含 `AppFrame` → 该 commit 里 `self = 1`、`parent = 420`、`rootProps = 0` ⇒ **一个自驱动座带动 420 个父驱动渲染**，具名 fiber 116 个，**从 `AppFrame` 一路贯穿 `SidebarRoot` → `SettingsRoot` → `SettingsPanel` → 8 个 `settings.section` outlet → 8 个栏目体 → 深层内容（`UsageCard`/`UsageTable`/`HeatmapChart`/`PluginCard`/`SshWorkspaceFlow`/`MachineBrowser`/`TastePanel` …）**。

**锚定 commit 的实测样本**（`raw/w19-all-2026-09-22T10-49-25-445Z.json`，逐名清单已落盘，116 项）：链上组件 `AppFrame, SidebarRoot, SessionTree, SessionNodeItem, SettingsRoot, SettingsPanel, SlotOutlet, SlotErrorBoundary, RootEntry, StrictSessionEntry` 全在；8 个栏目体 `GeneralSection / ModelsSection+Loaded / ConfigurablePluginsTab / AgentPresetSection / RemoteWorkspaceSettingsPage / DistributedControlSettingsPage / VisionAdamSection / SubagentModelSection` 全在。

### 3.3 第二条穿透路径：**链内自点火**（对 w01 未决项 T7 的新证据）

把 10:49 批 **121 个 commit 的逐 commit 清单**汇总（`raw/w19-analysis.json`）：

| 观测量 | 实测 |
|---|---|
| `SlotOutlet` / `SlotErrorBoundary` / `RootEntry` 的出现率 | **121/121 = 100%**（每一个 commit 都在渲染整条槽链） |
| 每 commit 渲染到的**栏目体数** | 7 个：66 commits；8 个：54；6 个：1 ⇒ **中位 7/8**（而其中 **7 个是 `hidden` 的**，只有 1 个可见） |
| 归因合计 | `self = 401` vs `parent = 34124` ⇒ **parent-driven 98.8%** |
| 静默段：含 `SettingsPanel` 的 commit | `dump-layout` **15/46**；`dump-switch` **7/10** |
| 静默段：含 `SettingsRoot` 的 commit | 同上 **15/46**（与 `SettingsPanel` 严格同步） |
| 静默段：含 `AppFrame` 的 commit | **0/46** |
| 静默段：**含 `SlotOutlet`/`boundary`/`RootEntry` 的 commit** | **46/46** |

**⇒ 结论**：在 **31/46** 个静默 commit 里，**栏目体连同一整条 outlet 链都在渲染，而 `SettingsPanel` 与 `SettingsRoot` 都没有执行工作**。既然栏目体只能挂在 `settings.section` 的 outlet 之下，就只能是 **`SlotOutlet("settings.section")` 自己点火**（其 T1 槽版本或 T2 locale 通道），然后沿**没有 memo 边界**的链向下放大 —— 这就是穿透的第二条路径（P2）。
**⇒ 对 w01 未决项 T7 的贡献（有限结论）**：**点火座可以落在 outlet 层，而不必是 `SettingsRoot` 自渲染**；本线**未**判定具体是 T1 还是 T2（需要按实例插桩），见 §9。同时给出**当前构建**的 `SettingsRoot` 渲染率 = **54/121 = 0.446 渲染/commit**（旧档 `slot-churn` 的 1.000 出自**旧构建**，跨线档 B 已标"不可外推"）。

### 3.4 为什么不用"Q/W 分段计数差值"作立柱（**方法学要点**）

同为窗内交替 Q/W 的 `ab-layout` / `ab-switch` / `neg-active` 三窗全部 `valid=true`，但**静默段自身就有 1–29 个 commit**（10:49 批 16 个 1.5 s 事件区间的 commit 数 = `[29,3,2,15,3,14,12,12,2,7,4,2,1,1,3,11]`，**极差 29×**；同批两个等长 `none` 窗 = **48 与 106** commits，**2.2×**）⇒ **后台事件流非平稳**，分段计数差值会被突发污染。因此本线把立柱换成 **§3.2 的逐 commit 归属**（"含 `AppFrame` 的 commit" 在静默段 **0/46**、事件段 **4/4**，判别力清晰且不受计数波动影响）。**"点击已活动项"的阴性内对照**在本环境**未能复现** w01 的 `mounts=0/commits=0`（`neg-active` 三次点击的 post 段仍有 10/25/26 commits）—— 原因是后台事件流独立产生 commit，**不是**反证 w01 的结论（w01 那次是在其自己的窗内测得）。本线如实标注为 **INCONCLUSIVE（本环境不能复现该内对照）**。

### 3.5 帧级代价（**不得据此宣称消除可感卡顿**）

- 全部 16 个事件区间（pre+post）：**LoAF = 0（16/16）**；`RunTask max ≤ 29.23 ms`；`rAF max ≤ 45.8 ms` ⇒ **无一越过 50 ms**。
- 阳性对照同批报出 120 ms ⇒ 通道灵敏，**不是"没测到"**，而是**这些 commit 本身没到 50 ms**（headless、无 GPU 合成）。
- **⇒ 本线的收益口径严格限定为"消除冗余渲染工作量（fiber 数 / 渲染次数）"，不是帧率、不是 CPU 自时间、更不是"消除可感卡顿"**。这与 w01 §6.2 (K1) 的实测反证、`BATCH-PLAN` §三.6 的纪律一致。

---

## 4. ② memo 边界的可行性与陷阱 + **可判定的稳定化方案**

### 4.1 判定：**单独加 memo = 零收益（w01 已判，本线复核成立）**

w01 §6.2 (K2) 已指出：`RootEntry` 的 props 含**每次渲染新建**的 `ownerProps` ⇒ 默认浅比较必然失配。本线把这句话**升级为可判定事实**：§2.5 的全表显示主干的 **12/12** 个 `renderSlot` 调用点都传**当场新建的对象字面量**（其中 2 处还含**新闭包**）⇒ 只要不先稳定身份，memo 的 bail-out 概率 = 0。**这是"零收益"的充分理由，不需要再测。**

### 4.2 陷阱清单（**T-2/T-3/T-4/T-5 为 w01 未列出的新增项**）

| 陷阱 | 内容 | 依据 |
|---|---|---|
| **T-1 目标选错** | `RootEntry` 是正确目标（`:789`，函数组件，props 少、无 `children`）；**但真正需要 memo 的是"条目体之前的最后一跳"**，不是 `SlotOutlet`（它必须保留自己的 uSES 订阅） | §2.3 |
| **T-2 `children` 击穿 memo（新增）** | **给 `SlotErrorBoundary` 加 memo 永远不会生效**：它的 props 含 `children`（父每渲染新建的 element）与 `onEntryError`（`guarded()` 里的新箭头，`:839-841`），浅比较必失配。**要 memo 的是它的 child（`RootEntry`），不是它自己** | `renderer:566/839-841` |
| **T-3 可 memo 的正确性前提（新增，且是好消息）** | **不必**为 `RootEntry` 稳定 `opts`：`opts` 不是 `RootEntry` 的 prop（`:789` 的 props 只有 6 项）。需要稳定的只有 **`ownerProps`**（以及 `entry`/`slotInjected`/`slotKey`/`hookContext`，后四者已由框架缓存：`entry` 是注册记录、`slotInjected` 由 `cachedSlotInject` 按 slot 缓存、`hookContext` 此处为 `undefined`） | `renderer:789/830-911` |
| **T-4 逐行 `useMemo` 是 hook 非法的（新增，K1 直接踩中）** | K1 落地后 per-row ownerProps 必须**按行**稳定，但 `rows.filter(...).map(...)` 的**行数随 `visitedIds` 变化** ⇒ **在 map 回调里调 `useMemo` 是 hook 规则违规**（hook 数量会变）。必须**把行抽成子组件**（`SettingsSectionRow`）或改用**模块级内容键缓存** | `settings-general:196-206` |
| **T-5 不要 memo 业务组件（新增）** | `standardKit` **每次新建 `kit` 对象**（`:660` `const kit = { ...standard }`），`renderEntry` 把它 spread 进 `Comp` 的 props（`:706-720`）⇒ **`Comp` 的 props 每次都是新对象，memo(`Comp`) 永不生效**。唯一可行的边界是 `RootEntry` | `renderer:660/706-720` |
| **T-6 不能吞掉的更新** | 槽版本（T1）与 locale（T2）由 **`SlotOutlet` 自己**消费，位于 memo 边界**之上** ⇒ memo **不可能**吞掉它们；业务组件自己的 store 订阅（如 `Loaded`/`ConfigurablePluginsTab` 的恒等选择器）在 bail-out 之下**仍会自行触发**，memo 只是不因父渲染而重渲染，**不是阻止**其自身更新。**唯一需要不变量的是 `ownerProps` 内容** | §2.1/§2.2；`renderer:154-159` 的 `eq` 转发 |
| **T-7 前车之鉴** | **不得改 `SlotOutlet` 的 uSES 订阅语义**（`exec-hmr §7.2` 已否决：会影响所有槽/插件更新时序且不闭合窗口）。本线候选 ③ 只做**闭包身份缓存**（语义不变），且**必须与该否决一并由协调者裁决** | 跨线档 B：T8 |

### 4.3 ★ 可判定的稳定化方案（`U-SLOTMEMO`，三段，每段都有机械判据）

**不变式（I1，唯一需要人工判定的一条）**：
> 对每个 `renderSlot` 调用点，`ownerProps` 的**对象身份必须是其内容的纯函数**：
> **(a) 内容不变 ⇒ 身份不变**（否则 memo 失效）；**(b) 内容变 ⇒ 身份变**（否则吞更新）。
> 等价的可判定形式：`useMemo(deps)` 的 **deps 列表恰是**从该对象读出的值的集合。

**S1 —— 稳定每一个 `ownerProps`（按 §2.5 全表逐点）**
- **S1a（常量对象）**：`renderSlot(key, {})` 的 6 处 ⇒ 提升为模块级冻结常量（**同文件已有先例**：`renderer:818` 的 `ANCHOR_STYLE`、`settings-general:100` 的 `SECTION_HIDDEN_STYLE`）。
  **判据（可机械核验）**：改动后 `grep -c 'renderSlot("[a-z.]*", {})'` = **0**。
- **S1b（变量对象）**：`{ collapsed, width }` / `{ wide }` / `{ close, visible }` ⇒ `useMemo`，**deps 恰为对象里的值**。
  - `settings-general:204`：deps = `[onClose, selected]`（`onClose` 是 `useCallback([])`，`:222-225` **已稳定**；`selected` 每切换翻一次）⇒ **N−1 行的身份在所有不切换的 commit 上稳定**。
  **判据**：每个 `useMemo` 的 deps 个数 == 对象字面量的键数（逐点目视 + 一条 lint 可核）。
- **S1c（闭包）**：`sidebar:225-227` 的 `expandSidebar`、`settings-general:262-266` 的 `complete` ⇒ 改 `useCallback`，或走**框架自带的稳定通道** `inject`（`cachedSlotInject` 按 slot 缓存，`:376-385`）。
  **判据**：`grep -n 'renderSlot(' -A3` 的 ownerProps 里不再出现 `=>`。

**S2 —— 把 K1 的行抽成组件（解 T-4）**
新增 `SettingsSectionRow({ row, active, onClose })`，内部 `const owner = useMemo(() => ({ close: onClose, visible: row.id === active }), [onClose, row.id === active])`，外层 `.map((row) => <SettingsSectionRow key={row.id} ... />)`。
**判据**：`renderSlot("settings.section"` 在源码中**只出现 1 次**；`div[data-keepalive-section]` 数仍 = N（行为不变）。

**S3 —— 唯一一行边界**
`const MemoRootEntry = react.memo(RootEntry);`，在 `guarded()`（`renderer:861` 的 `RootEntry` 元素）与 `RootOutlet`（`:928-950`，其 `RootEntry` 元素在 `:945`）两处替换。**默认浅比较即可**（不必自定义比较器 ⇒ 绕开 w01 指出的"比较器漏字段会吞更新"风险）。
**判据**：`grep -c 'react\.memo' renderer/lib/client.js` 从 **0 → 1**（注意：必须用 `react\.memo` 模式，朴素 `memo(` 是假阴性 —— w01 §3.3 计数陷阱）。

**S4（可选，独立测）**：把 `SlotOutlet:821` 的两个内联箭头改为按 `(host, slotKey)` 缓存的稳定闭包（语义不变，仅去重订）。**必须单独一批、单独判据，且需协调者对照 `exec-hmr §7.2` 的否决范围裁决。**

### 4.4 验收标准（**判据口径已按 §6.3 的"串味"风险修正**）

| # | 判据 | 形式 | 期望 |
|---|---|---|---|
| **A1** | **绝对渲染量**（主判据）：设置打开、`visitedIds` = 8 时，**每事件的 `RootEntry`（entry-body）渲染次数** —— 同一页、同一事件类型（布局写）的**前后同窗对照** | 绝对计数 / 事件 | 由 **8 栏目/事件 → 目标 ≤1**（布局写不改变任何栏目的 `visible`，理想为 0） |
| **A2** | **不吞更新**（阴性/阳性成对，必须做）：① 栏目切换后目标栏目文本/`aria-selected` 变化；② locale 切换后设置页文本 100% 刷新；③ 槽版本 bump（HMR 重注册或崩溃退休）后内容刷新 | 逐项布尔 | 3/3 必须为真 |
| **A3** | **不坏哨兵**：`rafP50 ≈ 16.7 ms`（同窗）；`pageerror = 0`；`div[data-slot="settings.section"]` 数 = N；可见 panel 数 = 1；`aria-current="true"` 数 = 1 | 逐项 | 全部不变 |
| **A4** | **反向判据（防"memo 生效但空白"）**：锚定 commit 的具名 fiber 数应显著下降，而**同一 commit 的 `parent` 计数同比例下降**（说明是传播被切，而不是整棵子树被卸掉） | 比值 | parent/pw 同时下降、`SlotOutlet` 仍在清单里 |
| **A5** | **辅助诊断（不作主判据）**：`渲染÷commit` 与 `commit/s` **必须成对**报出 | 比值 | 见 §6.3 |

**回滚**：S1（逐调用点，各自独立）／S2（还原为内联 `renderSlot`）／S3（删 memo 包裹一行）三级独立回滚，全部**热面**。
**收益改写口径**：收益一律写成 **"每事件渲染次数 / 每次 commit 的条目体渲染数"**，**不写帧率、不写 CPU 自时间**（§3.5 的实测反证：本环境的这些 commit 本就不越 50 ms）。

---

## 5. ③ `layout:159` `useStore((s) => s)` 恒等选择器的真实后果

### 5.1 何时写布局 store（**写入者全表**）

| 写入 | 调用点（file:line） | 触发场景 |
|---|---|---|
| `setSidebar` / `setDetails` | `layout:279-286`；调用者 `DragHandle` 的 `onSidebarDrag`/`onDetailsDrag`（`layout:214-221`），**已按帧合并**（`layout:141-146` 的 `requestAnimationFrame`） | 拖动分栏手柄（pointermove） |
| `toggleSidebar` | `layout:288-293`；调用者 `sidebar:188-190`（`aria-label` = `toggle.collapse`/`toggle.open`，字典 `:250`：`收起侧边栏`）与 `sidebar:225-227`（`expandSidebar`） | 点侧栏折叠按钮 / 在收起态点工作区 |
| `setNarrow` | `layout:294-298`（**值相同即早退 ⇒ 不通知**）；调用者 `AppFrame` 的 effect（`layout:191-193`，`narrow = viewport < SIDEBAR_AUTO_COLLAPSE`） | 视口宽度跨越断点 |
| `openDetails` | `layout:299-301`（`details===0` 才写）；经 `LayoutController` 面板面（`layout:322-334`） | 外部插件请求打开详情栏 |
| `closeDetails` | `layout:302-304`（**无条件写 `d.details = 0`**，即便已是 0 ⇒ 仍会通知）；调用者 `AppFrame` 的 layout effect（`layout:165-171`，会话切换时）+ `LayoutController` | 切换会话（选中态变化） |

### 5.2 会重渲染什么

**消费者唯一**：`layout` 插件把 store 座位挂在 `root` 注册上（`layout:540` `store: createLayoutStore`），而 store 的 `useStore` 只作为 **`AppFrame` 的 props** 下发（`layout:158-159`）。全 roster **没有第二个 React 消费者**（外部写入面只有 `ctx.layout.toggleSidebar()`，`sidebar:284`）。
`AppFrame` 读取的字段（`:194-196`）：`panels.narrow`、`panels.narrowExpanded`、`panels.sidebar`、`panels.details` —— **四个字段全读**。

⇒ 任一"改变了被读字段"的写 ⇒ `AppFrame` 重渲染 ⇒ **4 次 `renderSlot`（`layout:228/233/233/237`）各新建 ownerProps** ⇒ 整条槽链按 §2.4 穿透（§3.2 已实测：一次写 = 116 具名 fiber、8 栏目体、420 parent-driven）。**这是本 roster 单点扇出最大的一行。**

### 5.3 可否收窄：**不能 —— 不是"不建议"，是"无可收窄"**

- `eq` 位是存在的：`bindSnapshotSelector`（`renderer:154-159`）把 `eq` **原样转发**给 `useSyncExternalStoreWithSelector`，且 `observableHook` 按 source 缓存钩子 ⇒ **任何 `useStore(sel, eq)` 调用点都可以传自定义相等函数**。所以"技术上能收窄"成立。
- **但收益 ≈ 0**：布局 store 只有 4 个字段（`layout:278-283` 的 `init`），`AppFrame` **全读**，而每个 action **恰好写其中一个** ⇒ 任何 `shallow` 比较都会判定"变了"，`AppFrame` 照样重渲染。**恒等选择器在这里不是缺陷**。
- **缺陷在下游**：`AppFrame` 重渲染本身是**必要**的（网格列宽、`collapsed` 都要更新）；问题是它顺手把 `conversation`/`details`/`shell.overlay` 三个**与本次写无关**的槽（ownerProps 是 `{}`）与 `sidebar.settings`（`{wide}`）也一起重渲染了。
- **⇒ 正确修法是 §4.3 的 S1a/S1b + S3，不是收窄选择器。**（如强行收窄，只能收 `{sidebar, details}` 而放弃 `narrow/narrowExpanded`，会漏掉收起态切换 ⇒ 属**错误修法**，明确否决。）

**PASS/FAIL**：`LY:159` 的**结构结论**（任一写 ⇒ 整棵三栏 shell 重渲染）**PASS（代码级 + 本线 live 锚定）**；**"收窄选择器"作为修法 FAIL（收益≈0）**。

---

## 6. ④ 与 `w07` 的 M1（投影键闸门）**是否重叠**

（本节结论由二级 A 档独立得出，`raw/w07-m1-overlap.md`，337 行；本线复核其关键 file:line 与磁盘状态。）

### 6.1 M1 的落地形态（**已落地，别再"按住"**）

- 白名单 `LIST_REACHABLE_PROJECTION_KEYS = {title, sessionStats, subagentTiming, tokenUsage}`（`runtime:5756`）。
- `ProjectionValueStore.changed(key)`（`runtime:5858-5867`）：非白名单键**早退**（不再失效整个 `valuesCache`，也不标记 `anyNotifier`），**窄面 per-key 通道两分支都无条件保留**。
- 帧路径：`SessionManager.handleMuxEnvelope`（`runtime:8334`）同步 `apply` → 白名单键 `markFrameDirty`（`:8350`，store 侧 `:8025`，幂等 ⇒ 一帧一次 flush）；另两处 `/* w07-throttle v1 */` 为 **rAF 合并**（`:8024/:8344`）。
- **落地机械证明**：部署件 sha16 `4a2c298dd82613c7`，与候选件 `diff -q` IDENTICAL；diff 的反向还原 == pre-image（sha16 `357f1703722464ee`）逐字节相同。

### 6.2 判定：**不重叠，互补**（因果链一行）

> 投影帧 → `changed()`【**M1 在此截断非白名单键**】→ manager notifier → `projectList()`/`list.set()` → `useSessions` 消费者；
> 而槽链走的是**另一条通道**：`SlotOutlet` 只订阅**槽版本**（槽核心 `markDirty`（`index-ClqxG24t.js:56`；源码等价 `dsh-client-ui-slots/lib/index.js:399-411`） 单点自增，5 个调用点全是注册/注销/塌缩/崩溃退休）**+ locale** ⇒ **M1 不改变三个组件中任何一个的渲染触发条件**。

- **M1 减少的是"触发次数（通知/commit）"，memo 减少的是"每次触发的传播代价" ⇒ 二者是乘法关系，不是替代关系。**
- **实测支持**：§3.3 显示建 `SlotOutlet`/`boundary`/`RootEntry` 在 **121/121** 个 commit 上渲染（包括与投影无关的那些），且 **98.8% 是 parent-driven** ⇒ 触发源被 M1 砍掉后，**每次触发仍要付满额传播代价**。
- **K1 放大了 memo 的边际价值**：section outlet 数 1 → N（本轮 N=8）⇒ 每次触发的传播代价 ×8。

### 6.3 ⚠️ 判据"串味"风险（**必须按本线裁决执行**）

M1 已把**分母**（commit 数）显著砍小。若 memo 批用 **`渲染÷commit`** 验收（**这正是 w01 K2 写的验收口径**："0.706–0.833 → ≤0.05"），则：
- 若 memo 只减少"每次 commit 的渲染数"而 commit 数同时被 M1 砍掉，比值会**双重受益**，归因会把 M1 的贡献记到 memo 头上；
- 反之若某相位 commit 数骤降而渲染数不变，比值会**虚高**（伪劣化）。

**⇒ 裁决（本线）**：
1. memo 批的**主判据只用绝对量**：**每事件的 `RootEntry` 渲染次数** / **每次 commit 的条目体渲染数**（A1/A4）。
2. `渲染÷commit` **只作辅助诊断**，且**必须与 `commit/s` 成对报出**；任何只报比值的验收数字**一律退回**。
3. 归因用 A（基线）/B（仅 M1）/C（仅 memo）/D（两者）四臂；**交互项（差中差）≤ 噪声**才算"无重叠"的充分证据（2×2 设计由 A 档给出，本线采纳）。

### 6.4 合并建议

| 项 | 建议 |
|---|---|
| **M1** | **保持现状、不要重做、不要扩键集**。A 档复算：闸门自身贡献实测 ≈ **0**（671/671 桶含白名单键、(bucket,session) 对 **0/1119 GATED-ONLY**），**收益几乎全由 rAF 合批承担**（合并倍数独立复算 **8.45×/6.68×**）。"扩到更多键"**先不要做**。 |
| **槽链 memo 批** | **独立成批、立即排期**：它是**唯一还没有任何线认领**的一项（renderer 内 `react.memo` 命中 = 0），且被 K1 放大。 |
| **不合并成同一批** | 两者必须落在**不同文件**、用**不同补丁标记**、**独立回滚**（M1 有 `--rollback`，pre-image 已在盘；memo 批按 S1/S2/S3 三级）。 |
| **顺序** | memo 批（含 S1/S2/S3）→ 可选 S4。M1 不回滚。 |
| **索引不一致（转协调者）** | `program/FINDINGS-INDEX.md:173` 仍把 `U-PROJ1` 记为"按住未落"，而磁盘 18:08:53 已落地（A 档发现）。 |

---

## 7. ⑤ 前三优化候选（含收益/风险/验收/回滚/热冷面）

> 每个候选的收益一律写成 **"每事件渲染次数"的绝对计数** 或 **为零判据**（§6.3）；**不得**写成帧率/可感卡顿（§3.5）。

### 候选 ① `U-SLOTMEMO`：`react.memo(RootEntry)` + 稳定 `ownerProps` + K1 行组件化｜**热面** ★**首选**

- **形状**：§4.3 的 **S1（a/b/c）+ S2 + S3**，必须**同时**落地（只做 S3 = 零收益，§4.1）。
- **收益**：设置打开、N=8 时，**布局写事件的条目体渲染数 8 → 目标 ≤1**；**普通 commit 的条目体渲染数 7–8 → 目标 ≤1**（基线实测：中位 7/8 栏目体/commit，其中 7 个 `hidden`）。**不承诺帧率收益**（§3.5：本环境这些 commit 本就不越 50 ms）。
- **风险（按严重度）**：① **吞更新**（缓解：I1 不变式 + A2 三通道阳性回归；S3 用**默认浅比较**避免自定义比较器漏字段）；② **S1b/S2 的 deps 写漏**（缓解：deps 个数 == 键数的目视/lint 判据）；③ 与 `exec-hmr` 的 HMR 延迟重挂交互（`SlotErrorBoundary` 的 `attempt/retryTimer` 是**自身状态**，位于 memo **之上**，不受影响 —— A2③ 强制回归 HMR 重注册路径）。
- **验收**：A1（绝对渲染数，前后同窗）+ A2（3/3 不吞更新）+ A3（哨兵）+ A4（parent/pw 同比例下降）。**判据不得用 `渲染÷commit` 单独验收**（§6.3）。
- **回滚**：三级独立（S1 逐点 / S2 还原内联 / S3 删一行），**全热面**。
- **热面/冷面**：**热面**（全在 client bundle 内，刷新即生效；以 `served sha256-12 == 磁盘` 核对）。

### 候选 ② `U-EMPTYPROPS`：把 6 处 `renderSlot(key, {})` 的常量 ownerProps 提升为模块常量（§4.3 S1a）｜**热面**（**候选 ① 的前置**）

- **收益（必须如实写）**：**单独落地收益 ≈ 0** —— 没有 memo 边界时，`SlotOutlet` 照样因父渲染而重渲染，身份稳定不改变渲染次数。它**只在 ① 落地后**才把 `conversation`/`details`/`shell.overlay`/`settings.header`/`settings.action`/`settings.close` 这 6 个无关槽的传播切断。**⇒ 定位是"①的前置条件"，不是独立收益项。**
- **风险**：**极低**（模块级冻结常量；`renderer:818` 的 `ANCHOR_STYLE`、`settings-general:100` 的 `SECTION_HIDDEN_STYLE` 已是同写法先例）。唯一注意：常量必须**冻结**（`Object.freeze`）以免被下游改写。
- **验收**：`grep -c 'renderSlot("[a-z.]*", {})'` = 0；A3 哨兵不变；且**必须与 ① 同批做 A/B**，否则无法分离贡献。
- **回滚**：逐点还原字面量（热面）。
- **热面/冷面**：**热面**。

### 候选 ③ `U-OUTLETSUB`：把 `SlotOutlet:821` 的内联 `subscribe`/`getSnapshot` 改为按 `(host, slotKey)` 缓存的稳定闭包｜**热面**（**需协调者裁决**）

- **形状**：与 `localeSubscriptionCache`（`renderer:469-479`）**完全同构**的一对 WeakMap 缓存；**订阅语义、订阅时机、快照读取全部不变**，只去掉"每次渲染新身份 ⇒ 退订+重订"。
- **收益**：**不是渲染次数收益**，而是每次 outlet 渲染少一对 `unsubscribe/subscribe`。基线可定量：**每 commit 的 outlet 渲染数 × 1 对**（本线实测每 commit 至少 1 个 outlet、K1 后设置段 N 个 ⇒ 普通 commit 约 8+ 对/commit，按 §3.3 的 121/121 出现率 × N）。**必须用"每 commit 的退订/重订对数"这一计数验收（需新增插桩），不得用帧数。**
- **风险**：**中**：① 它**触碰了 `SlotOutlet` 的 uSES 调用面**，而 `exec-hmr §7.2` 已否决"改 `SlotOutlet` uSES 订阅语义"（影响所有槽/插件更新时序）—— 本候选**不改语义**，但**是否落在否决范围内必须由协调者裁决**；② 若缓存 key 用错（漏 `slotKey`）会造成跨槽串订 ⇒ 验收必须含"多槽并存时各槽只收到自己的版本通知"。
- **验收**：B1（计数）退订/重订对数/commit → **0**；B2（不坏）槽版本传播三通道回归（注册/注销、崩溃退休、HMR 重注册）；B3 哨兵。
- **回滚**：还原内联箭头（单点，热面）。
- **热面/冷面**：**热面**，但**必须单独一批、不与 ① 同批**（否则归因不清）。

### 明确**不做**（避免重复劳动）

- **收窄 `layout:159` 选择器**（§5.3：无可收窄，收益≈0，且收窄会漏 `narrow*`）。
- **给 `SlotErrorBoundary` 加 memo**（§4.2 T-2：`children` 击穿，永不生效）。
- **memo 业务组件 `Comp`**（§4.2 T-5：`kit` 每次新建，props 恒变，永不生效）。
- **改 `SlotOutlet` 的 uSES 订阅语义**（`exec-hmr §7.2` 已否决）。
- **扩展 M1 的投影键白名单**（A 档：闸门自身贡献实测 ≈0）。
- **`settings-models` 行级 memo / 虚拟化**（既有裁决已否决）。

---

## 8. 逐条 PASS / FAIL / INCONCLUSIVE 总表

| # | 结论 | 判据 | 依据 |
|---|---|---|---|
| 1 | `SlotOutlet` 有三个触发条件：槽版本(T1)、locale revision(T2)、父渲染(T3) | **PASS（代码级）** | §2.1；`renderer:819-828`、槽核心 `markDirty`（`index-ClqxG24t.js:56`；源码等价 `dsh-client-ui-slots/lib/index.js:399-411`） |
| 2 | `SlotOutlet:821` 的 `subscribe`/`getSnapshot` 是内联箭头 ⇒ **每次渲染重订** | **PASS（代码级）** | §2.1/§7.3；`renderer:821` |
| 3 | `SlotErrorBoundary` 的触发条件 = 父渲染 + 崩溃/瞬时重挂状态（**无订阅**） | **PASS（代码级）** | §2.2；`renderer:566-614` |
| 4 | **`RootEntry` 纯父驱动、零自订阅** | **PASS（代码级 + 归因复核）** | §2.3；`renderer:789-794`；跨线档 B（类型二 `RootEntry`=0） |
| 5 | 主干 **12/12** 个 `renderSlot` 调用点都传**当场新建的对象字面量**（其中 2 处含新闭包） | **PASS（代码级全表）** | §2.5 |
| 6 | **"一次通知穿透整条槽链"机制成立**：链上零 memo + 信息全以新身份交付 + 两个自驱动座在条目体之上 + K1 后扇出 ×N | **PASS（机制 + 结构 + 本线 live 三重一致）** | §2.4；§3.2/§3.3 |
| 7 | **实测**：一次侧栏折叠点击 → 恰好 **1 个**含 `AppFrame` 的 commit → 该 commit **`self=1 / parent=420 / rootProps=0`**、**116–117 具名 fiber**、**8/8 栏目体** | **PASS（4/4 事件复现）** | §3.2；`raw/w19-all-2026-09-22T10-49-25-445Z.json` |
| 8 | **同窗阴性内对照**：静默段含 `AppFrame` 的 commit = **0/46**（布局写判据 **4/4 vs 0/46**） | **PASS（判别力清晰）** | §3.2 |
| 9 | **第二条穿透路径（链内自点火）**：静默段 **46/46** commit 渲染 outlet 链，其中 **31/46** 在 `SettingsRoot`/`SettingsPanel` **未执行工作**的情况下仍渲染 7–8 个栏目体 | **PASS（结构 + 计数）** | §3.3 |
| 10 | 该自点火座的**具体身份**（T1 槽版本 vs T2 locale 修订） | **INCONCLUSIVE**（需按实例插桩；`names` 只有名字没有实例身份） | §3.3；§9 |
| 11 | **K1 落地使 section outlet 数 1 → N**（本轮 N=8；DOM 节点 85/37/345/4/49/16/25/69 = **639**，其中 7 个 `hidden`） | **PASS（DOM + 计数）** | §1.1；`raw/w19-analysis.json` 的 `notes.afterWarmup` |
| 12 | **每 commit 的条目体渲染数 = 7–8（中位 7/8），而 8 个里 7 个 `hidden`** ⇒ 绝大多数条目体渲染是**不可见面板** | **PASS（计数）** | §3.3 |
| 13 | 归因：`self=401` vs `parent=34124` ⇒ **parent-driven 98.8%**（121 commits） | **PASS（计数）** | §3.3 |
| 14 | **通道自证**：阳性对照 6/6 窗三通道同时报出 120 ms；阴性 4/4 窗 LoAF=0 | **PASS** | §3.1 |
| 15 | **本批 17/17 窗口独占**（`foreign=0/0`、`lockMine=true`）、`pageerror=0` | **PASS（如实记录）** | §0/§3.2；`raw/w19-run.log`（17 行 `foreign=0/0 lock=true`） |
| 16 | **帧级**：16/16 事件区间 **LoAF=0**、`RunTask max ≤29.23 ms`、`rAF max ≤45.8 ms` ⇒ **不得宣称消除可感卡顿** | **PASS（阴性，据此限定收益口径）** | §3.5 |
| 17 | **单独加 memo = 零收益**（12/12 调用点传新对象 ⇒ 浅比较必失配） | **PASS（代码级充分理由）** | §4.1 |
| 18 | **给 `SlotErrorBoundary` 加 memo 永不生效**（`children` + `onEntryError` 每渲染新建） | **PASS（代码级）** | §4.2 T-2；`renderer:566/839-841` |
| 19 | **给业务组件 `Comp` 加 memo 永不生效**（`kit` 每次新建并被 spread 进 props） | **PASS（代码级）** | §4.2 T-5；`renderer:660/706-720` |
| 20 | **memo 安全性**：槽版本/locale 由 `SlotOutlet` 自己消费（在边界之上）、业务组件自身订阅在 bail-out 下仍生效 ⇒ memo **不可能**吞掉这两类更新；**唯一需要不变式的是 `ownerProps` 内容** | **PASS（代码级）** | §4.2 T-6；`renderer:154-159` |
| 21 | **可判定的稳定化方案**（S1a/S1b/S1c/S2/S3，每段带机械判据 + 不变式 I1） | **给出（未落地，本轮只读）** | §4.3 |
| 22 | **K1 使逐行 `useMemo` 成为 hook 违规**（行数随 `visitedIds` 变化）⇒ 必须先抽行组件 | **PASS（代码级）** | §4.2 T-4；`settings-general:196-206` |
| 23 | `layout:159` 恒等选择器：**任一布局写 ⇒ 整棵三栏 shell + 槽链重渲染** | **PASS（代码级 + live 锚定）** | §5.2；§3.2 |
| 24 | 布局 store 的 **React 消费者唯一**（`AppFrame`），且**四个字段全读** ⇒ **"收窄选择器"收益≈0** | **PASS（代码级 + 检索）** | §5.3；跨线档 B（T4） |
| 25 | 布局写入的触发场景（drag/toggle/`setNarrow`/`openDetails`/`closeDetails`）逐条带 file:line | **PASS（静态）** | §5.1 |
| 26 | **与 M1 不重叠、互补**：M1 减少触发次数、memo 减少每次触发的传播代价；M1 **不改变**三组件任何触发条件 | **PASS（代码级 + 磁盘机械验证）** | §6；`raw/w07-m1-overlap.md` |
| 27 | M1 **已落地**（sha16 `4a2c298dd82613c7`，diff 反向还原 == pre-image） | **PASS（机械证明）** | §6.1；A 档 §1 |
| 28 | M1 自身的闸门贡献 ≈ **0**（收益几乎全由 rAF 合批承担） | **PASS（A 档复算：0/1119 GATED-ONLY；合并 8.45×/6.68×）** | §6.4 |
| 29 | **判据串味风险**：post-M1 不得单独用 `渲染÷commit` 验收 memo | **裁决（本线）** | §6.3 |
| 30 | 前 3 优化候选（收益/风险/验收/回滚/热冷面）与"明确不做"清单 | **给出（未落地）** | §7 |
| 31 | **"点击已活动导航项 = mounts 0 / commits 0"的阴性内对照** | **INCONCLUSIVE（本环境不能复现：后台事件流独立产生 commit）** | §3.4 |
| 32 | 本线器械与 w01 器械逐字节相同（sha256-12 `9f1a2243d385`）+ 一处只读 accessor | **PASS（已声明）** | §1.3 |

---

## 9. 未决 / 边界（诚实清单）

1. **自点火座的身份未钉死**（#10）：静默 commit 里的 `SlotOutlet("settings.section")` 自渲染，可能是 T1（槽版本）或 T2（locale），本线的 `names` 只给名字不给实例身份。**需要按 `fiber.elementType + key` 分实例插桩**才能判定；在此之前，**不得把 locale revision 当作既定点火源**（`MEASUREMENT-STATUS §6.0.bis.2` 的禁令继续有效，跨线档 B 也把它列为未裁决冲突 C3）。
2. **静默段并不安静**：本宿主有活跃会话事件流（`wsIn` 波动、一次 `none` 窗出现 356 ms 任务）⇒ 静默段的 commit 是"非布局写"的混合来源（投影/会话/其他 store），本线只把它们当作**阴性对照**，**不把它们当作空闲基线**。
3. **`mounts` 通道不稳健**：跨线档 B 引 `exec-keepalive` 的自陈（该线认为本环境 `mounts` 地板 1404–1674 > 信号）；本线的 `mounts` 读数在 1–135 之间、**同一事件的两次锚定 commit 出现 1 与 109 的巨大差异**（`dump-layout` 的折叠 vs 展开）⇒ **本线不把 `mounts` 用作任何判据**，只在原始 JSON 里保留。
4. **未做 K1 前后的直接 A/B**：K1 已在 16:39 落盘（本线只读，不能回退）⇒ "1 → N"的 **N 倍放大**是**结构性论证**（改动前 `only: active` 只挂 1 个 panel）+ 当前构建的**绝对计数**（每 commit 7–8 个栏目体），**不是同窗 A/B**。要做同窗 A/B 需要一次受控的 `visitedIds` 自变量（保留 1 个 vs 8 个），**本线未做**（跨线档 B 将其列为冲突 C5 的裁决实验）。
5. **`headless` 保真度**：无 GPU 合成 ⇒ "无长帧"只对**主线程 JS/布局**成立，不代表有头 4K 呈现路径。
6. **`SlotOutlet` 挂载实例数**从未实测（跨线档 B 的缺位 ④）：本线用 `div[data-keepalive-section]` = 8 与"每 commit 7–8 个栏目体"逼近，但**没有**直接的 outlet 实例计数。
7. **候选 ③ 与既有否决的边界**需协调者裁决（`exec-hmr §7.2`）。
8. **本线未覆盖 profile 侧插件的全部 `renderSlot` 调用点**（§2.5 只穷举主干 + `settings-general`）；`shell.overlay` 的 list 槽条目（跨线档 B 指出 `shell.overlay` 可能有 profile 插件条目）未逐条枚举。
9. **§3.2 的 `rootProps=0`** 是"无渲染祖先且 props 变"的计数为 0（分类器语义，`w19-init.js:216-231`），**不等于**"没有 props 变化"。

---

## 10. 复核与复现方法（供独立核对）

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/program/w19-slots

# 1) 行号锚点复核（当前 bundle；期望 sha256-12 = 7468f0c67407）
L=~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai
curl -s http://127.0.0.1:3080/plugins/@deepseek-ai/dsh-client-ui-renderer/client.js | sha256sum | cut -c1-12
sha256sum $L/dsh-client-ui-renderer/lib/client.js | cut -c1-12
sed -n '819,828p'  $L/dsh-client-ui-renderer/lib/client.js   # SlotOutlet：两个内联箭头 + useLocaleRevision
sed -n '566,614p'  $L/dsh-client-ui-renderer/lib/client.js   # SlotErrorBoundary（含 TRANSIENT_* 重挂）
sed -n '789,794p'  $L/dsh-client-ui-renderer/lib/client.js   # RootEntry：props 6 项、零订阅
sed -n '281,301p'  $L/dsh-client-ui-renderer/lib/client.js   # boundRenderSlot：缓存"绑定"而非 element
sed -n '658,682p'  $L/dsh-client-ui-renderer/lib/client.js   # standardKit：每次新建 kit
sed -n '154,159p'  $L/dsh-client-ui-renderer/lib/client.js   # bindSnapshotSelector：eq 被原样转发
sed -n '196,206p'  $L/dsh-client-ui-settings-general/lib/client.js  # K1：visitedIds + only=row.id + visible
sed -n '158,159p'  $L/dsh-client-ui-layout/lib/client.js     # useStore((s) => s)
sed -n '277,305p'  $L/dsh-client-ui-layout/lib/client.js     # 布局 store 与 5 个 action

# 2) 12/12 调用点传新对象（§2.5 全表）
grep -n 'renderSlot("' $L/dsh-client-ui-layout/lib/client.js $L/dsh-client-ui-sidebar/lib/client.js \
  $L/dsh-client-ui-settings-general/lib/client.js

# 3) memo 计数（必须用 react\.memo 模式；朴素 memo( 是假阴性）
grep -c 'react\.memo' $L/dsh-client-ui-renderer/lib/client.js        # 期望 0（落地 S3 后应为 1）

# 4) M1 落地锚点
grep -n 'w07-throttle v1' $L/dsh-client-runtime/lib/client.js         # 期望 :5732/5850/8024/8344
sed -n '5756p;5858,5867p' $L/dsh-client-runtime/lib/client.js

# 5) live 复跑（必须持锁；本机常有兄弟线占用，锁会被 BUSY 拒）
node tools/probe-w19.mjs --scenarios pos-120,none,dump-layout,dump-switch --window 12 --lock-wait-ms 480000
node tools/analyze-w19.mjs          # → raw/w19-analysis.json（本报告引用的判据表）
```

**关键结论一键复核**（在 `raw/w19-analysis.json` 里）：

```bash
node -e 'const a=require("./raw/w19-analysis.json");
for(const b of a.batches){const w=b.windows["dump-layout"];if(!w)continue;
console.log(b.stamp,"anchored",w.anchoredEvents+"/"+w.eventsN,
 "AppFrameCommits pre="+w.preAppFrameCommitsTotal,"post="+w.postAppFrameCommitsTotal,
 "anchorNamesN="+JSON.stringify(w.anchorNamesN),"sections="+JSON.stringify(w.anchorSections),
 "split="+JSON.stringify(w.anchorParentShare));}'
# 期望（10:49 批）：anchored 4/4  AppFrameCommits pre=0 post=4  anchorNamesN p50=116  sections=[8,8,8,8]
#                    split: self=1, parent=420/313, mounts=1/109, rootProps=0
```

**二级档产物**：`raw/w07-m1-overlap.md`（337 行，M1 × 槽链的 5 问逐条 + 2×2 四臂实验设计）、`raw/crossline-sweep.md`（194 行，T1–T9 跨线状态表 + 6 条冲突与裁决实验 + 18 项"可直接引用不重测"清单）。
