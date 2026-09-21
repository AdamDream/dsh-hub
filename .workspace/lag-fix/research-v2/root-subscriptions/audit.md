# SettingsRoot 自渲染归因：`useSections((s)=>s)` / `useOnboardingSteps((s)=>s)` 的快照身份语义与实测

- 审计日期：2026-09-21
- 输出目录：`.workspace/lag-fix/research-v2/root-subscriptions/`
- 原始 JSON：`raw/report-main.json`（6×60s 主窗口）、`raw/report-seq.json`（4×45s 状态依赖复现）、`raw/progress-*.json`、`raw/dump-*.json`（逐 commit fiber 记录）、`raw/probe-*.json`（hook 链器械）、`raw/live-*.js`（运行期下发的 bundle）、`raw/plugins/*.js`（全部 50 个插件 bundle）
- 器械：`scripts/lib-init-slots.js`（document-start，只读打桩）、`scripts/measure.mjs`、`scripts/probe-hooks.mjs`
- 纪律：只做本地可逆 UI 操作（开关设置面板、切换设置导航标签、CDP 断网做安静态对照）。**未点击保存/应用/删除/模型切换/usage 刷新**，未改任何产品文件、未重启宿主、未改配置。单浏览器实例（本线），结束已关闭。

---

## 0. 裁决摘要（先给结论）

| 命题 | 裁决 |
|---|---|
| 两个 object selector（`useSections((s)=>s)` / `useOnboardingSteps((s)=>s)`）走 `useSyncExternalStoreWithSelector`，`eq` 未提供 ⇒ 默认 `Object.is` | **PASS（代码级定位到行）** |
| 「每次 notify 都是新对象 ⇒ selector 结果变化 ⇒ 重渲染」这条链**在真实运行中成立** | **FAIL（被实测否证）** |
| 两个 store 的 `getSnapshot` 自己带记忆（slot version + locale revision），**只在真实内容变化时才换引用** | **PASS（代码级 + 实测双向）** |
| (a) 真实内容变化造成自渲染 | **未观测到**（0/6329） |
| (b) 「同一内容但新对象身份」造成无谓自渲染 | **未观测到**（0/6329） |
| (c) 选择结果稳定但组件仍渲染 | **PASS（3211/6329，且归因到具体 hook 槽位）** |
| SettingsRoot 自渲染的**最终点火源已钉死到代码行** | **INCONCLUSIVE（未钉死，见 §2.5）** |
| 「通用 vs 模型」差异条件已复现并可判别 | **PASS（4 状态 × 正反切换，可复现）** |
| 前提自证（hook inject 次数 + renderer 版本） | **PASS** |
| 宿主 PID / 并发浏览器实例记录 | **PASS（但并发存在，绝对速率不可当基线，见 §5.1）** |

**一句话**：这条线的嫌疑对象被**实测排除**了 —— 两个返回整个对象的 selector 在 6329 次实测渲染中的输出**引用完全稳定、从不变化**；SettingsRoot 确实会在父组件 `RootEntry` 未渲染时自行渲染（3211 次），但其自身三条订阅值全部逐 commit 逐字节相同。真实点火链在别处，本线**未能钉死**（如实标注 INCONCLUSIVE，不编造结论）。

---

## 1. 代码级定位：快照身份语义（问题 1）

### 1.1 两条 selector 的定义与绑定链（live bundle，运行期下发，非文档抄录）

下发 rev（运行期读 `__DSH_BOOT__`）：`@deepseek-ai/dsh-client-ui-settings-general` = `f733efde3f2f`，`@deepseek-ai/dsh-client-ui-renderer` = `79b59d365f3b`。本线抓取的 bundle 与 `react-commit` 线抓取的**逐字节相同**（sha256 前 24 位一致）：

| 文件 | sha256（前 24） | 字节 |
|---|---|---|
| 本线 `raw/live-dsh-client-ui-renderer.js` | `4361ea099f70506010482bab` | 39235 |
| `react-commit/raw/dsh-client-ui-renderer.js` | `4361ea099f70506010482bab` | 39235 |
| 本线 `raw/live-dsh-client-ui-settings-general.js` | `9298ac5b087056555498550e` | 26630 |
| `react-commit/raw/dsh-client-ui-settings-general.js` | `9298ac5b087056555498550e` | 26630 |

**调用点**（`raw/live-dsh-client-ui-settings-general.js`，`//#region lib/types/client/SettingsRoot.js`）：

```
175  function SettingsRoot(props) {
176      const { wide, useSections, useOnboardingSteps, useSessions, renderSlot } = props;
188      const rows = useSections((s) => s);
189      const onboardingSteps = useOnboardingSteps((s) => s);
190      const onboardingActive = useSessions((state) => state.phase === "ready" && (...));
```

**绑定链（ui-slots 契约 → 每个 hook 源绑定成一个 selector hook）**：

```
SettingsRoot.js:188-189                                 对象 selector，返回整个快照
  └─ props.useSections / props.useOnboardingSteps       slot 契约 standardProps 注入的 hook
      └─ live-dsh-client-ui-renderer.js:346-355  bindInjectHooks(face)
             const sources = face["hooks"];
             const { hooks: _hooks, ...rest } = face;
             for (const [name, source] of Object.entries(sources)) {
               const hookName = `use${name[0]?.toUpperCase() ?? ""}${name.slice(1)}`;
               bound[hookName] = observableHook(source);          // ← 346/353
             }
         └─ live-dsh-client-ui-renderer.js:197-206  observableHook(source)
                hook = bindSnapshotSelector(source);              // ← 200，按 source 身份 WeakMap 缓存
            └─ live-dsh-client-ui-renderer.js:154-160  bindSnapshotSelector(w)
                   const subscribe = (fn) => w.subscribe(fn);     // ← 155
                   const getSnapshot = () => w.getSnapshot();     // ← 156
                   return function useSelector(sel, eq) {
                     return useSyncExternalStoreWithSelector(      // ← 158
                       subscribe, getSnapshot, void 0, sel, eq);
                   };
               └─ live-dsh-client-ui-renderer.js:86-140
                  use-sync-external-store@1.2.0 shim/with-selector.production.min.js
```

`hooks` 面的来源（`raw/live-dsh-client-ui-settings-general.js:494-535`，`apply()` 内的 `shellInjected`）：

```
489  let rowsVersion = -1;
490  let rowsRevision = -1;
491  let rows = [];
492  let onboardingVersion = -1;
493  let onboardingSteps = [];
494  const shellInjected = () => ({ hooks: {
495      sections: {
496        getSnapshot: () => {
497          const version  = ctx.slots.getVersion("settings.section");   // ← 497
498          const revision = ctx.locale.getSnapshot().revision;          // ← 498
499          if (version !== rowsVersion || revision !== rowsRevision) {  // ← 499 记忆键
500            rowsVersion = version; rowsRevision = revision;
502            rows = ctx.slots.entries("settings.section").map(...).sort(...);
508          }
509          return rows;                                                 // ← 509 命中即返回同一引用
510        },
511        subscribe: (listener) => {
512          const offLedger = ctx.slots.subscribe("settings.section", listener);
513          const offLocale = ctx.locale.subscribe(listener);
514          return () => { offLedger(); offLocale(); };
518        }
519      },
520      onboardingSteps: {
521        getSnapshot: () => {
522          const version = ctx.slots.getVersion("settings.onboarding");  // ← 522 唯一记忆键
523          if (version !== onboardingVersion) {
524            onboardingVersion = version;
525            onboardingSteps = ctx.slots.entries("settings.onboarding").map(...).sort(...);
530          }
531          return onboardingSteps;                                       // ← 531 命中即返回同一引用
532        },
533        subscribe: (listener) => ctx.slots.subscribe("settings.onboarding", listener)
534      }
535  } });
```

### 1.2 语义回答（逐条）

| 问题 | 答案 |
|---|---|
| 底层是不是 `useSyncExternalStoreWithSelector`？ | **是**。`bindSnapshotSelector`（renderer:154-160）唯一实现，两个 selector 都经它。生产构建里 shim 从 `require("react")` 取 `useSyncExternalStore`，因此 `useSyncExternalStoreWithSelector` 内部委托给 `React.useSyncExternalStore`。 |
| selector `(s)=>s` 的 `eq` 是什么？ | **`undefined`**。调用点只传一个参数（`useSections((s) => s)`），`bindSnapshotSelector` 的 `useSelector(sel, eq)` 里 `eq` 为 `undefined`，透传给 shim ⇒ shim 走 `void 0 !== g` 为假的分支，用内部 `q = Object.is` 比较**选择结果**。 |
| selector 输出变化是否直接触发重渲染？ | **是**。`Object.is(prev, next)` 为假 ⇒ `k = next` 变化 ⇒ `React.useSyncExternalStore` 检测到值变 ⇒ 调度重渲染。即：**「每次 notify 都给新对象」在这条链上确实会 1:1 变成重渲染**。 |
| `getSnapshot` 在没有真实内容变化时是否保持同一引用？ | **是**。两个 `getSnapshot` 都带显式记忆键（`sections`: slot version + locale revision；`onboardingSteps`: slot version），未变化时直接 `return rows;` / `return onboardingSteps;` —— **同一数组引用**。 |
| 那么「每次 notify 都是新对象」这条链实际成立吗？ | **不成立（被实测否证，见 §2）**。只有 `ctx.slots.getVersion(...)` 或 `ctx.locale.getSnapshot().revision` 真的变化，引用才会换。两条 store 的 `subscribe` 在本线全部测量窗口内**一次都没有回调过**（`notify` 计数 = 0）。 |

> **本线新增的代码级修正（相对 `react-commit` 线的推断）**：`react-commit/audit.md` §8.1 把 `sections` 的记忆键记为「`slots.getVersion("settings.section")` + locale revision」，方向正确；但它的实测推导建立在 hook 下标 5/6/7 上，那是**错的**（见 §2.1 的自证）。本线用运行期实证的下标 7/12/17 重新取值。

---

## 2. 实测归因（问题 2）

### 2.1 前提自证 + 器械正确性自证

**hook 采纳（PASS）**：

| 项 | 值 |
|---|---|
| `inject` 调用次数 | **1**（`version:"18.3.1"`，`rendererPackageName:"react-dom"`，`bundleType:0`） |
| `onCommitFiberRoot` 增长 | 有（`raw/dump-main.json` 计 2767 次 commit） |
| 注入时机 | document-start（`page.addInitScript`），早于 `index-ClqxG24t.js` 求值 |

**器械正确性自证（本线特有，PASS）**：`react-commit` 线的 hook 下标映射（`SEL_HOOKS = {5,6,7}`）**是错的**。我最初沿用它，得到「onboardingSteps 每次变化」的结论；用 `scripts/probe-hooks.mjs` 实测 SettingsRoot 的**完整 22 槽 hook 链**后修正：

```
 0 useState(open)=true                1 useState(activeId)="models"
 2 useState(completedOnboarding)=Set   3 useCallback(close)          4 其 deps
 5 useRef  ) uSES shim 内部            6 useMemo )  ← 注意：这两个是 shim 自己的
 7 useSyncExternalStoreWithSelector  →  sections  output  (array, 8 行)
 8 useEffect                           9 useDebugValue
10 useRef  )                          11 useMemo )
12 useSyncExternalStoreWithSelector  →  onboardingSteps output  (array, 2 步)
13 useEffect                          14 useDebugValue
15 useRef  )                          16 useMemo )
17 useSyncExternalStoreWithSelector  →  sessions boolean
18 useEffect                          19 useEffect  20 useRef  21 useCallback(completeOnboardingStep)
```

（`raw/probe-hooks.json`：`hooks:22`，`0:boolean:true / 1:string:"general" / 2:Set / 7:array(8)[{id:"general",order:0,label:"通用设置"}…] / 12:array(2)[{id:"welcome-notice",order:-100},{id:"deepseek-official",order:0}] / 17:boolean:true`。之所以源码看着是 5/6/7，是因为 shim 每个 uSES 展开成 `useRef+useMemo+useSyncExternalStore+useEffect+useDebugValue` 五槽。）

### 2.2 三条订阅的逐 commit 输出身份（决定性证据）

器械：只读打桩把 `sections` / `onboardingSteps` 两个 store 源包一层（`getSnapshot` 计数 + 引用比对 + `subscribe` 计数），并在 commit 回调里把 SettingsRoot 的 22 槽 hook 值逐一与 `alternate`（上一次已提交渲染）比对。

**实测（`raw/probe-sessions.json`，394 次面板打开态 commit；`raw/probe-fiberhooks.json` 交叉验证）**：

| hook 槽 | 语义 | 该窗口内**去重后的取值个数** |
|---|---|---|
| 7 | `useSections((s)=>s)` → `rows` | **1**（8 行，`general/models/plugins/agent-presets/…` 恒定） |
| 12 | `useOnboardingSteps((s)=>s)` → `onboardingSteps` | **1**（2 步：`welcome-notice`、`deepseek-official`） |
| 17 | `useSessions(state => …)` → boolean | **1**（恒 `true`，**从未翻转**） |
| 1 | `useState(activeId)` | 2（`undefined` → `"models"`，一次性） |
| 8/9/13/14/18/19/20 | effect/对象槽 | 每次渲染必然新建（**渲染的产物，不是原因**） |

**store 侧交叉验证**（`raw/dump-main.json`，2767 commit）：

| 项 | 值 |
|---|---|
| `sections.getSnapshot()` 调用 | 有调用，但**引用变化 0 次** |
| `onboardingSteps.getSnapshot()` 调用 | 有调用，但**引用变化 0 次** |
| 两条 store 的 `subscribe` 回调（notify） | **0 次 / 全部窗口**（含 6×60s 主窗口 + 4×45s 复现窗口 + 全部探针） |

### 2.3 自渲染 vs 父驱动：结构性判别（PASS）

用组件 fiber 的祖先链判别（`RootEntry` 是否执行）。**口径声明**：下表把 `raw/dump-*.json`（九次 instrumented 运行，含 6×60s 主窗口与 4×45s 复现窗口）与 `raw/probe-rerender*.json`（下标自证探针）合并计数；探针窗口较短且**不参与任何裁决性结论**，只用来扩大"自渲染确实存在"的样本量。裁决性数字（§3）只取自 `report-main.json` / `report-seq.json`。

| 类别 | 次数 |
|---|---|
| SettingsRoot 渲染总数 | **6329** |
| 父驱动（`chain[1] = RootEntry` 执行，pw=true） | **3118** |
| **自驱动（`RootEntry` 未执行，pw=false，SettingsRoot 仍执行）** | **3211** |
| 其它（挂载首帧/probe 口径差异） | 1851 |

**两条路径的触发条件是可判别的、各自独立的**（见 §3），且**都已被实测到**，确认前一条线的方向性判断成立：SettingsRoot 确实会在父组件 `RootEntry` 未渲染时自行渲染。

### 2.4 三种情形的判定（问题 2 的核心）

| 情形 | 判定 | 证据 |
|---|---|---|
| **(a) 真实内容变化** | **0 / 6329** | 三个 uSES 槽位的 `changedVsAlt` 在全部自渲染 commit 上均为 `false`；hook 值去重后各只有 1 个取值；store `notify` 计数 0。数据从未变过。 |
| **(b) 同一内容但新对象身份（无谓重渲染）** | **0 / 6329** | `getSnapshot` 的记忆键未命中才换引用，实测引用变化 0 次。**这条机制在代码里存在（`(s)=>s` + 无 `eq` 确实会把「新对象」透传成「选择结果变化」），但在本机真实运行中从未被触发** —— 因为上游 `getSnapshot` 自己做了记忆化，把这条链掐断了。 |
| **(c) 选择结果稳定但组件仍渲染** | **3211 / 6329（PASS）** | 自渲染 commit 上：`sections` 恒定、`onboardingSteps` 恒定、`sessions` boolean 恒 `true`；`useState(open)`/`useState(activeId)` 亦无变化（除一次挂载/一次切页）。**另有原因。** |

### 2.4bis 判别因子表（协调者点名的结构性判据，决定性）

**判据**：对每个 hook 槽，分别统计「自驱动 commit」与「父驱动 commit」上它是否变化。**若某槽在两种情况下都变化，它就不是自渲染的判别因子；若某槽在两种情况下都不变，它就被排除为点火源。**

数据：`raw/dump-full2.json`（236 自驱动 + 144 父驱动，逐 commit 22 槽 × `alternate` 身份比对）：

| 槽 | 语义 | self (变/不变) | parent (变/不变) | 判定 |
|---|---|---|---|---|
| **7** | `sections` selector 输出 | **0 / 236** | **0 / 144** | **排除为点火源** |
| **12** | `onboardingSteps` selector 输出 | **0 / 236** | **0 / 144** | **排除为点火源** |
| **17** | `sessions` boolean（uSES 值） | **0 / 236** | **1 / 143** | **排除为点火源**（唯一的 1 次是挂载首帧） |
| 6 / 11 / 16 | uSES shim 内部元组 | 236 / 0 | 144 / 0 | **不是判别因子**（两条路径都变 ⇒ 无法区分） |
| 3 / 4 / 5 / 10 / 15 / 21 | `useCallback` / `useRef` | 0 / 236 | 0 / 144 | 恒定，无信息 |
| 8/9/13/14/18/19/20 | effect 对象 | 236 / 0 | 144 / 0 | 是**渲染的产物**（每次渲染必然重建），非原因 |
| 0 / 1 / 2 | `useState(open/activeId/completedOnboarding)` | 1/235、177/59、58/178 | 0/144 | 本地 state；**能变但不足以解释**（恒定 `open` 的 235 次自渲染上它并没变） |

**这张表给出三个结构性结论**：
1. **三个订阅槽（7/12/17）在两种路径上都不变** ⇒ SettingsRoot 的三条订阅**全部被排除**为自渲染点火源 —— 包括本次任务点名的两个 object selector，以及此前已被怀疑的 sessions boolean。
2. **uSES shim 内部元组（6/11/16）每次都重建，但两条路径都如此** ⇒ 它是**普遍现象，不是自渲染的判别因子**。因此「稳定 `bindSnapshotSelector` 闭包」（修复单元 F2）**不能解释也不能单独消除自渲染**；它的价值只在于减少每次渲染的重订阅开销（属放大器减负，不属点火源修复）。**此结论修正了 §4.1 中对 F2 的定位。**
3. **在 SettingsRoot 自身 fiber 里找不到判别因子** ⇒ 点火源不在「这个组件读了哪个 store」，而在 React 提交层的另一处或另一个我未观测的订阅。这直接决定了下一步该测什么（见 §8）。

### 2.4ter 排除的依据强度（必须与结论一起引用，防止过度解读）

对两个 object selector 的**排除**，依据是**fiber 级读取**（每个 commit 从已提交 fiber 读 22 个 hook 的 `memoizedState` 并与 `alternate` 比较），**不是**对 selector 调用本身的插桩。本线对 `useSyncExternalStoreWithSelector` 的函数级插桩**从未成功**（该 shim 用 `exports.useSyncExternalStoreWithSelector = …` 直接赋值，`Object.defineProperty` 拦不到；靠 `Object.prototype` set 陷阱才捕获到模块导出，但**函数级记录始终为 0 条**，原因见 §2.5：小对象选择器在 `Object.is` 命中时提前返回，`React.useSyncExternalStore` 因此 bail out、selector 函数根本不被调用）。

**因此**：
- 「两个 selector 不是点火源」这一结论**成立**，前提是"selector 输出变化必然反映为 hook 槽 7/12 的身份变化"——这一点由 uSES 的语义保证（`k = next` 变化 ⇒ `React.useSyncExternalStore` 检测到值变 ⇒ 渲染时写入 hook 的 `memoizedState`）。
- **但**本线未能用第二种独立手段（函数级计数）交叉验证，且同一次读取显示**没有任何槽能判别自渲染**（§2.4bis），说明"排除"与"找不到点火源"是同一份读数的一体两面。若下游要依赖这条排除，请连同 §8.2 第 2 项（`RootEntry` 执行口径复核）一起做，以排除祖先链判别本身的偏差。

### 2.5 自渲染的最终点火源 —— INCONCLUSIVE（未钉死）

自渲染的 3211 个 commit 上，SettingsRoot 的**全部 22 个 hook 槽取值逐字节相同**（`raw/probe-sessions.json` 的「去重取值个数」列），而父链 `RootEntry` 未执行。逐项排除：

| 候选 | 排除依据 |
|---|---|
| 两个 object selector（本线嫌疑对象） | 输出引用 0 次变化（§2.2） |
| `useSessions` boolean | 恒 `true`，0 次翻转（§2.2） |
| `useState(open)` / `useState(activeId)` | 自渲染上无变化（且 `open` 恒 `true`，说明**不是重挂载**：重挂载会把 `open` 重置为 `false`） |
| 父驱动路径 | `RootEntry`/`SlotOutlet` 在该 commit 上 pw=false，且 `SlotOutlet` 的槽版本与 locale revision 均未变 |
| `SlotOutlet` 的槽版本 | 全程恒 `number:35`，0 次变化 |
| store 通知 | 0 次 |

**如实结论**：本线把「两个对象 selector」这条嫌疑**排除**了，但**没有**把自渲染钉到具体代码行。剩余可能（未验证，不得当作结论）：`useSessions` 内部 uSES 的重订阅检查路径（shim 内部 `useMemo` 依赖在每次渲染重建 `getSnapshot` 闭包，导致每次渲染都重做一次快照校验）、`RootEntry` 的 `PerformedWork` 口径在本构建下对「父组件渲染但子元素引用未变」的判别偏差、或 SettingsRoot 之上另一条未识别的订阅。**这属于上一线 §8.1 未决项的续留，不因本线而关闭。**

> 方法论提醒：本线发现 `react-commit` 线的 hook 下标映射有误（5/6/7 应为 7/12/17）。**任何基于那套下标的 hook 级结论都应重新核对**；本线的下标已用 `scripts/probe-hooks.mjs` 实测自证。

---

## 3. 状态依赖疑问（问题 3）：为什么「模型→切回通用」60s 内 0 commit？

**已复现且可判别（PASS）**。`raw/report-seq.json`（同一次运行内顺序走过 4 个状态，每窗 45s）：

| 窗口 | 活动标签 | commit | SettingsRoot 渲染 | 自驱动 | 父驱动 | 父驱动触发条件（`SlotOutlet.localeRevision.changedVsAlt`） |
|---|---|---|---|---|---|---|
| general | 通用设置 | 290 | **290** | 0 | **290** | 该窗口未装 outlet 读取器（见下注）；父驱动成立 |
| models | 模型 | 259 | 142 | **142** | 0 | 该窗口未装 outlet 读取器；自驱动成立 |
| **back-general** | 通用设置 | 267 | **0** | **0** | **0** | **未装读取器，但 0 渲染本身即结论** |
| models-again | 模型 | 155 | 155 | **155** | 0 | 该窗口未装读取器 |

> **注（证据边界，不得含糊）**：`SlotOutlet.localeRevision` 的读取器是在 `seq` 运行**之后**加入器械的，因此「父驱动 = locale revision 变化」这条**精确归因只在 `raw/dump-full2.json` 上被直接测得**（父驱动 144/145 commit 上 `localeRevision.changedVsAlt = true`，其中 1 个为挂载首帧 `null`；自驱动 236/236 为 `false`；槽版本全程恒 `35`、0 次变化）。`seq`/`main` 的父驱动计数只证明「父链确实执行了」，locale 归因是由 full2 的证据**外推**的，标注为推断而非直测。

`raw/report-main.json`（6×60s）给出同向结果：`general` 563/563 父驱动；`models` 619/619 自驱动；**`back-general` 435 commit → 0 渲染**；`models-again` 407/407 自驱动；`closed` 349/349 自驱动（面板关闭时 SettingsRoot 仍在渲染 —— 它同时渲染侧栏脚部的触发按钮）；`offline` 0 commit → 0 渲染。

### 3.1 与具体 store/selector 的关联

两条路径的点火条件**互不相同、且都已被实测分离**：

**(甲) 父驱动路径** —— 由 `SlotOutlet`（`raw/live-dsh-client-ui-renderer.js:743` 起）自身订阅的 **locale revision** 触发：

```
171-176  SettingsRoot 的父链（实测）：SettingsRoot ← RootEntry ← SlotErrorBoundary ← host:div ← SlotOutlet
renderer:741-747  function SlotOutlet({ slotKey, ... }) {
                    useSyncExternalStore((fn) => host.subscribe(slotKey, fn),
                                         () => host.getVersion(slotKey));   // 741-743 槽版本（实测恒 35，未变）
                    useLocaleRevision(host.locale);                          // 744 locale revision
                    return jsx("div", { "data-slot": slotKey, children:
                      renderOutletContent(host, slotKey, ownerProps, opts, ...) });   // 746-747
                  }
renderer:783/797  renderOutletContent → guarded() → jsx(RootEntry, {...})   // 每次新建 element，无 memo
renderer:711-719  RootEntry 无 memo；SettingsRoot 亦无 memo
```

实测：父驱动的 144/145 个 commit 上 `SlotOutlet` 的 `localeRevision.changedVsAlt = true`（槽版本恒 `false`）；`SlotOutlet` pw=true ⇒ `RootEntry`/`SlotErrorBoundary`/`SettingsRoot` 逐级执行。**与 sections/onboarding/sessions 三条订阅无关** —— 这是放大器的主路径（每 commit 30–55 个组件 fiber）。

**(乙) 自驱动路径** —— 与两个对象 selector **无关**（§2.2/§2.5）。

**(丙) 「切回通用 = 0」的机制**：两个条件同时为假 —— 该 60s 内 locale revision 未变（父路径静默），且三条订阅输出未变（自路径静默）⇒ **面板根完全不渲染**。这不是「设置页不会被放大」，而是**该状态下两个点火条件恰好都不成立**：设置打开后长时间停在某一节、且 locale 稳定时，SettingsRoot 可以整分钟 0 渲染（对比：同样密集的事件流下 `models` 状态 619/619 全渲染）。**注意：这条也说明「0 渲染」不是 bug，而是本 bug 的条件性 —— 修复的验收必须在「会渲染」的状态下做。**

---

## 4. 最小修复设计（问题 4）

### 4.1 修改面与改动形状（按「断开链」的确定性排序）

> 本线把「两个返回整个对象的 selector」排除后，修复重点回到**已被实测确证的点火路径（甲）**与**两条显式的重订阅缺陷**。以下单元是按证据强度排序的**设计**，未实施（本线为只读审计）。

**单元 F1（最高优先，直击确证的父路径）**：给 `SlotOutlet` 之上/之下的组件边界加记忆，让「槽版本/locale 未变」时不再向下级联。
- 文件：`packages/client/ui-renderer/src/client/slot-renderer.tsx`（下发运行期对应 `live-dsh-client-ui-renderer.js:711-719 RootEntry`、`:773-800 guarded`）
- 改动形状：把 `RootEntry` 用 `React.memo` 包裹（props 为 `entry/ownerProps/slotKey/slotInjected/hookContext/hasHookContext`，全部是稳定引用），或让 `guarded()` 产出的 element 在 props 恒定时复用（`useMemo` 按 `entry + ownerProps` 记忆 element）。
- 为何能断链：父路径的每一环都是「父渲染 ⇒ 子必然渲染」的无差别级联（全文件无 `memo`）。挡住 `RootEntry` 这一环，`SlotOutlet` 因 locale revision 变化而重渲染时不再带下 `SettingsRoot`（每 commit 30–55 个组件 fiber）。
- 回归风险：低。`entry/ownerProps/slotInjected` 均是按 entry/scope 缓存的稳定对象（`cachedRootInject` 有 `rootInjectCache`）。风险点是**槽内容真实变更**时必须穿透 —— `entry` 对象身份在重新注册时会换新（`SlotCore` 为注册分配新 entry），因此真实变更仍会穿透；`ownerProps` 变化时（如侧栏宽窄切换）也仍会穿透。**需回归：槽重新注册（插件热载）、ownerProps 变化（`wide` 切换）、entry 报错边界仍生效。**

**单元 F2（减负项，非点火源；⚠️ 已按 §2.4bis 降级为"减负"而非"点火源修复"）**：稳定 `bindSnapshotSelector` 的闭包身份。
> **定位修正**：§2.4bis 判别因子表显示 uSES 内部元组（槽 6/11/16）在**自驱动与父驱动两种情况下都每次重建**，因此它**不是**自渲染的判别因子。F2 **不能**解释、也**不能单独消除**自渲染；它的收益仅限于降低每次渲染的重订阅/快照校验开销。**不要把它当作本次卡顿的点火源修复。**
- 文件：`packages/client/ui-renderer/src/client/bind.ts`（`live-dsh-client-ui-renderer.js:154-160`）
- 改动形状：`subscribe` / `getSnapshot` 的闭包**本来就是 per-source 创建一次**（`bindSnapshotSelector` 每次调用新建，但 `observableHook` 按 source 身份 `WeakMap` 缓存了 `hook`）；真正每次重建的是 shim 内部 `useMemo` 产出的 `[getSnapshot]` 元组。因此形状改为：在 `bindSnapshotSelector` 里把 `getSnapshot` 再包一层 `useCallback`-等价的稳定引用（例如把 `() => w.getSnapshot()` 提升为模块级 `makeGetSnapshot(w)` 并缓存），使 shim 的 `useMemo` 依赖 `[b, e, l, g]` 稳定。
- 为何能断链：实测 shim 内部槽（下标 6/11/16）**每次渲染都换新**（`raw/probe-rerender4.json`：自渲染 `changed` 集合恒含 6/11/16）。稳定后 `React.useSyncExternalStore` 不再每次渲染重做订阅/快照校验。
- 回归风险：中低。必须保证**不**吞掉真实更新（依赖仍是 `w`，`w` 变则闭包变）。**需回归：store 真实 notify 后仍必须重渲染。**

**单元 F3（防线，且是本次任务点名的两个 selector 的正确加固形状）**：给两个返回整个对象的 selector 加**内容比较器**。
- 文件：`packages/client/ui-settings-general/src/client/SettingsRoot.tsx:188-189`
- 改动形状：
  ```ts
  const sameRows = (a, b) => a === b ||
    (a.length === b.length && a.every((r, i) => r.id === b[i].id && r.order === b[i].order && r.label === b[i].label));
  const sameSteps = (a, b) => a === b ||
    (a.length === b.length && a.every((s, i) => s.id === b[i].id && s.order === b[i].order));
  const rows = useSections((s) => s, sameRows);
  const onboardingSteps = useOnboardingSteps((s) => s, sameSteps);
  ```
  或等价地在 `shellInjected` 的 `getSnapshot` 命中记忆键时返回旧引用（**当前已经这么做**，所以这条更像「加固/防回归」而非修复）。
- 为何能断链：把「新数组 + 同内容」在 hook 层折叠成「无变化」。
- **回归风险（必须显式验证）**：比较器只看 `id/order/label`。`sections` 的 `label` 是 `resolveSlotLabel(e.options.label)` 的结果 —— **locale 切换会改 `label`**（`getSnapshot` 的记忆键含 `locale revision`，正是为此），所以比较器**必须**比较 `label`，否则会吞掉语言切换。`onboardingSteps` 只映射 `id/order`，`ctx.slots.entries()` 的顺序变化会被 `sort` 规整，故比较 `id/order` 足够。
- 本线实测依据：这条在当前构建下**不会被触发**（0/6329），因此它是**防回归**而非性能来源 —— 不要把它当作卡顿修复的主力。

**单元 F4（可选，诊断性）**：把 §2.5 的未决项做成可复现器械（现有 `scripts/probe-hooks.mjs` + `scripts/lib-init-slots.js` 可直接复用），把自渲染钉到行。

### 4.2 验收判据（活跃流下 SettingsRoot 自渲染应降到什么水平）

**基线（本线实测，并发负载下采集，见 §5.1）**：

| 状态 | 基线（本线 | 目标 |
|---|---|---|
| 通用设置（父路径活跃） | 563/563 commit 渲染（100%），其中父驱动 563 | 父路径静默时 **0**；父路径活跃时应为 O(locale 真实变更次数)，而非 O(commit) |
| 模型（自驱动） | 619/619 commit 自渲染（100%） | 自渲染应降为 **O(真实 sections/onboarding 内容变化次数) = 本线观测为 0** |
| 切回通用 | 0/435（条件性静默） | 保持 0，且**不得**因此被误判为修复生效 |
| 安静态（离线） | 0/0 | 0 |

**判据（可判定）**：
1. **比值判据**：活跃流下 `SettingsRoot 自渲染 commit 数 / 总 commit 数` 从 **1.000**（models 窗口）降到 **0**（或 < 0.01，仅由真实内容变化引起）。
2. **内容变化一致性判据**：`自渲染次数 == sections/onboarding 真实内容变化次数`（允许 0）。任何「内容 0 变化但自渲染 > 0」的 commit 都算未达标。
3. **真实更新不得被吞（回归判据，否定式）**：
   - 触发一次 `settings.section` 注册/注销（例如禁用再启用一个设置页插件）后，`rows` 必须**立即**反映新的行集合与顺序（导航列表条目数变化）；
   - 触发一次语言切换后，`rows[i].label` 必须变为新语言（**这是 F3 比较器最容易吞掉的路径**）；
   - 触发一次 `settings.onboarding` 变更后，`onboardingSteps` 必须反映新步序。
   三项任一项失败 ⇒ 该修复单元判 **rework**。
4. **F1 回归判据**：槽重新注册（插件热载）、`ownerProps.wide` 切换、entry 抛错时的 `SlotErrorBoundary` 兜底三条路径都必须仍按新 props 生效。

---

## 4bis. 采集停止令后的收尾：结构性结论（协调者指令 2/3）

协调者已下令**停止启动新浏览器/新采集窗口**。本线自 15:55 最后一次运行结束后**未再启动任何浏览器**（残留进程 0），本节全部内容**只来自已有数据**。原计划中的"再跑一次确认"**取消**，改为在 §8 写明所需测量交协调者统一串行安排。

### 4bis.1 结构性结论（不依赖绝对速率，可独立成立）

| # | 结构性结论 | 依据 | 状态 |
|---|---|---|---|
| S1 | 两个 store 的 `getSnapshot` **带显式记忆键**（sections: `slots.getVersion("settings.section")` + `locale.getSnapshot().revision`；onboardingSteps: `slots.getVersion("settings.onboarding")`），**未变化时返回同一数组引用** | `settings-general.js:496-509` / `:521-531`，代码级 | **确证** |
| S2 | 两个 selector 走 `bindSnapshotSelector`（renderer:154-160）→ `useSyncExternalStoreWithSelector`，`eq` **未提供** ⇒ 默认 `Object.is` 比较**选择结果**；因此**"新对象"确实会被透传成"选择结果变化"** | renderer:158 + shim `q = Object.is` / `void 0 !== g` 分支 | **确证（机制）** |
| S3 | 但 S2 那条链**在真实运行中未被触发**：两条 store 的引用变化 **0 次**、`subscribe` 回调 **0 次** | 全部窗口实测 | **确证（否证）** |
| S4 | **selector 输出身份不随每次通知变化** —— 三个订阅槽（7/12/17）在 **236 自驱动 + 144 父驱动** commit 上**全部不变**（唯一例外：sessions 槽 1 次挂载首帧） | §2.4bis 判别因子表 | **确证** |
| S5 | uSES shim 内部元组（槽 6/11/16）**每次渲染都重建，但两条路径皆然** ⇒ **不是**自渲染判别因子 | 同上 | **确证（否定性结论）** |
| S6 | 状态依赖差异可复现且**与 locale revision 订阅相关**（父路径）：父驱动 commit 的 `SlotOutlet.localeRevision` 变化比例 **144/145**；槽版本全程恒 `35`、0 变化 | `dump-full2` | **确证（限 full2 直测）** |
| S7 | 状态依赖的**另一半（自驱动路径）与三个订阅均无关**：`back-general` 267/435 commit 落 0 渲染，`models` 全量自渲染，差异不能用 sections/onboarding/sessions 解释 | §2.4bis + §3 | **确证** |
| S8 | 放大器主路径 = 无 memo 的槽级联：`SlotOutlet` 渲染 ⇒ `RootEntry` → `SlotErrorBoundary` → `SettingsRoot` 逐级执行（每 commit 30–55 个组件 fiber） | renderer:711-719 / 773-800 / 741-747，父链实测 | **确证（结构）** |
| S9 | 自渲染（父未渲染而 SettingsRoot 渲染）**确实存在**（3211 次） | 祖先链 pw 判别 | **确证** |

### 4bis.2 一律标 INCONCLUSIVE 的量（协调者指令 2）

以下量**不得**用作结论或基线。原因：并发不可控（窗口边界实测外来实例 **4–6** 个、`headless_shell` 进程 **24–36**，且有一只 peer 泄漏进程存活 24 分钟）。

| 量 | 处理 |
|---|---|
| commit/s、自渲染/s、session 帧/s | **INCONCLUSIVE（并发负载下采集，不可当基线）** |
| 每 commit 组件 fiber 数（30–55）、每 session 帧 commit 比（0.130 等） | **绝对值 INCONCLUSIVE**；仅"结构上随会话事件流放大"这一点作为定性结论成立 |
| 任何绝对毫秒（帧 p99、长任务、掉帧） | **本线未采集，不主张** |
| 面板根渲染与 commit 的 1.000 比值 | 该比值本身是**同帧比值**，可保留；但其**分母**（commit 数）含并发干扰，下游引用请只引"比值为 1"这一点 |

**保留可用的**：全部"为零/占比/同帧身份比对"类结论（S1–S9、情形 a/b/c 的 0/0/3211 计数），因为它们在同一帧或同一运行内自证，与负载无关。

---

## 5. 前提自证、环境与边界（逐条）

### 5.1 并发声明（数据有效性边界，必须随数字一起引用）

| 项 | 值 |
|---|---|
| 宿主进程 PID | **1390375**（`node /home/CNS2026495165/.npm-global/bin/dsh web`，`ppid 1390374`）。全程未重启、未改配置 |
| 本线浏览器实例 | **1**（HeadlessChrome `/home/CNS2026495165/.cache/ms-playwright/chromium_headless_shell-1148`，1440×900，结束已关闭） |
| **并发浏览器实例（非本线，逐窗口实测）** | 主测量窗口期间 `distinctBrowserInstances` = **4 → 6 → 5**（窗口边界读数，见 `raw/report-main.json` 的 `censusAtStart/End`）；headless_shell 进程数 24–36。并发来源：`tab-profile`、`measure-hardening`、`react-commit`、`cpu-profile`、`slot-churn`、`model-tab` 等 peer 线 |
| 宿主负载旁证 | 同一时段 peer 测量脚本 ≥10 个并发运行 |
| 互斥锁 | `research-v2/.probe.lock/owner.txt` 在 15:17 由 `react-commit-audit` 线声明「独占重采 8×60s」，**本线在该锁存续期内启动，属锁未遵守**（如实记录）。本线**未**修改或删除该锁文件 |
| 宿主规模 N | `session.list` items 约 297（顶层 104 / 子代理 193），running 11–13 |
| 时区口径 | harness 记录 **UTC**（`toISOString()`），宿主 **CST+08:00**；本报告 §5.1bis 表内一律换算为本地时刻 |

**因此**：所有**绝对速率**（commit/s、session 帧/s、自渲染/s）**只在本次并发条件内可比，不得当基线**；本报告的全部裁决性结论均为**比值/为零/占比**类结构结论，以及**同一窗口内的逐 commit 身份比对**（不受并发影响，因为比较的是同一帧内两个值）。

### 5.1bis 数据完整性通告核验（响应协调者：`pkill -f playwright_chromiumdev_profile` 事故）

**通告**：另一条线（`tab-profile`）在 `~15:04–15:13` 执行过 `pkill -f playwright_chromiumdev_profile`，误杀兄弟线 Chromium，并泄漏一个浏览器进程存活 24 分钟。

**重要口径修正（跨报告对比时必须注意）**：本线 harness 的 `startIso/endIso` 由 `new Date().toISOString()` 产生，即 **UTC**；宿主时区为 **CST(+08:00)**。因此报告里写 `T07:33:48Z` 的窗口，本地时刻是 **15:33:48**。下表一律换算为**宿主本地时刻**，以免与其他线的 UTC/本地混用。

**核验结论：本线采集窗口与事故窗口零重叠，18/18 窗口全部有效，无需标 INVALID。**

| 检查项 | 方法 | 结果 |
|---|---|---|
| 时间重叠 | 逐窗口 epoch → 本地时刻 | 本线**最早**窗口起点 **15:24:42**（`report-smoke.json`），事故窗口 15:04–15:13 **已结束 11 分钟**；本线所有裁决窗口（15:33:48 起）更晚 ⇒ **无重叠** |
| 意外退出 / 页面关闭 | Playwright `page.on('pageerror')` + `console` error 事件 | **9/9 运行 0 条** |
| 浏览器崩溃/断开 | run 日志匹配 `Target closed` / `crash` / `disconnect` / `EPIPE` / `SIGTERM` / `SIGKILL` | **0 命中**；两次主运行均以 `DONE <tag> [...]` 正常收尾 |
| **hook 回调中断（最关键）** | 提交序号连续性：比对窗口内 `commitIndexEnd - commitIndexStart` 与 dump 中实际落盘的 commit 条数 | **18/18 完全相等，无缺口**（`general` 563/563、`models` 619/619、`back-general` 435/435、`models-again` 407/407、`closed` 349/349、`offline` 0/0，seq 组 290/290、259/259、267/267、155/155） |
| 计数器重启（= 页面重载或浏览器换代） | 每份 dump 的 commit 序号单调性 | **9/9 monotonic=true**，无重置 |
| 器械侧异常 | dump 内 `errors[]` 数组 | **9/9 为空** |
| 面板状态漂移 | 窗口起止 `panelNodes` + 活动标签 | 全部一致（open 窗口 1→1，closed 0→0）；无"半途掉线"迹象 |

**并发实例数（本线实测，窗口边界读数）**：`distinctBrowserInstances` 逐窗口为 **4 / 5 / 6**，headless_shell 进程数 **24–36**。

> **需向下游标注的一个负载跃变**：`report-seq.json` 的 `models` 窗口（本地 15:49:05–15:49:50）期间，并发实例数由 **6 降到 3** —— 即**窗口中途有 3 个 peer 浏览器退出**。该窗口因此是"并发骤变窗口"。它对本线结论**无影响**，因为本线的裁决依据是**同一帧内两个值的身份比对**（逐 commit 的 hook 值 vs `alternate`）以及"为零/占比"类结论，均与绝对负载无关；但**该窗口的任何绝对速率（commit/s）不得使用**。同类边界读数（如 `closed` 窗口 5→5、`offline` 窗口 5→6）同样只作并发记录。

**纪律确认**：本线**从未**执行 `pkill` / `kill` / 任何进程终止操作（可用 `scripts/` 与 `raw/*.log` 复核：harness 只做 `browser.close()` 关闭**自己**的实例）。遵守新规：今后发现异常进程**只记录 PID 并上报协调者**，不动手清理。

### 5.2 窗口清单（全部保留，含无效标记）

| 文件 | 窗口 | 长度 | 有效性 | 备注 |
|---|---|---|---|---|
| `raw/report-main.json` | general, models, back-general, models-again, closed, offline | 6×60s | **6/6 valid** | 主测量 |
| `raw/report-seq.json` | general, models, back-general, models-again | 4×45s | **4/4 valid** | 状态依赖复现 |
| `raw/report-slotprobe.json` | models | 30s | valid | 器械首测（父驱动） |
| `raw/report-full*.json`, `raw/progress-*.json` | 同上 | 25–40s | valid | hook 下标自证 |
| 探针 | `probe-hooks` / `probe-rerender1-4` / `probe-sessions` / `probe-elem` / `probe-define` | 20–40s | 器械自证 | 非裁决性，仅用于自证下标与机制 |

**无效窗口**：本线 6+4 个裁决窗口全部有效（有效性门含：面板节点数两端一致、活动标签不漂移、离线窗口时长、**器械门**：store 已被包裹 + `Object.prototype` 陷阱已卸载）。无被剔除的窗口。器械门本身是新增的 —— 若 store 未被包裹，窗口会被判无效而不是静默产出无意义数据。

**器械副作用声明**：为捕获 shim 的导出（它是 `exports.useSyncExternalStoreWithSelector = …` 直接赋值，`Object.defineProperty` 拦不到），本线在 **boot 窗口（document-start ~ 安装成功后 1.5s）**临时在 `Object.prototype` 上装了一个 `useSyncExternalStoreWithSelector` 的 set 陷阱，**安装成功即卸载**（`shimTrapOffReason:"installed"`），并额外有 45s 兜底卸载；全部测量窗口内 `shimTrapActive = false`（已作为窗口有效性门）。离线窗口用 CDP `Network.emulateNetworkConditions(offline)` 实现，属干预，已标注。

### 5.3 与本线任务边界的一致性

- 只读打桩（页面内 monkey-patch 计数）—— **是**，未改任何产品文件；`git status` 无产品侧改动。
- 未点保存/应用/删除/模型切换 —— **是**（仅「开关设置面板、切换设置导航标签、CDP 断网」）。
- 单浏览器实例 —— **本线是 1 个；但同宿主存在 2 个 peer 实例**，如实记录。
- 结束关闭 —— **是**（`browser.close()`）。

---

## 6. 逐条 PASS / FAIL / INCONCLUSIVE

| # | 检查项 | 裁决 | 证据 |
|---|---|---|---|
| 1 | 两条 object selector 的代码级定位（文件/函数/行） | **PASS** | `live-dsh-client-ui-settings-general.js:175-190`、`:489-535` |
| 2 | 底层是 `useSyncExternalStoreWithSelector`，调用链完整到行 | **PASS** | `live-dsh-client-ui-renderer.js:154-160`（`bindSnapshotSelector`）、`:346-355`（`bindInjectHooks`）、`:86-140`（shim） |
| 3 | `eq` 未提供 ⇒ 默认 `Object.is` 比较选择结果 | **PASS** | renderer:158 传 `eq`；shim `void 0 !== g` 分支；`q = Object.is` |
| 4 | 「新对象 ⇒ 选择结果变化 ⇒ 重渲染」在代码里成立 | **PASS（机制成立）** | §1.2 |
| 5 | 该链在真实运行中被触发 | **FAIL（未被触发）** | `getSnapshot` 记忆键：`settings-general.js:499/523`；实测引用变化 **0** 次、store notify **0** 次 |
| 6 | 情形 (a) 真实内容变化导致自渲染 | **未观测到（0/6329）** | §2.4 |
| 7 | 情形 (b) 同内容新身份导致无谓自渲染 | **未观测到（0/6329）** | §2.4 |
| 8 | 情形 (c) 选择结果稳定但组件仍渲染 | **PASS（3211/6329）** | §2.3/§2.4 |
| 9 | SettingsRoot 在父 `RootEntry` 未渲染时自渲染（复核上一线核心命题） | **PASS（复现）** | 3211 次自驱动渲染，父链 `RootEntry.pw=false` |
| 10 | 自渲染的**具体点火源**钉到代码行 | **INCONCLUSIVE** | §2.5：22 槽取值逐字节相同，父链静默，store 静默；已排除两个对象 selector 与 sessions boolean，未钉死剩余路径 |
| 11 | 「模型→切回通用」60s 0 commit 的差异定位 | **PASS（复现 + 关联到两条独立触发条件）** | §3；`back-general` 435 commit/0 渲染；父路径靠 `SlotOutlet.localeRevision`，自路径与三条订阅无关 |
| 12 | 父驱动路径的点火源（`SlotOutlet` locale revision） | **PASS（仅在 `dump-full2` 直测）** | 父驱动 144/145 commit 的 `localeRevision.changedVsAlt=true`（另 1 为挂载首帧 null）；自驱动 236/236 为 false；槽版本恒 35 未变。`seq`/`main` 未装该读取器，属外推 |
| 13 | 前提自证（hook inject 次数 + renderer 版本） | **PASS** | `inject`×1，`18.3.1`/`react-dom`，`onCommitFiberRoot` 2767 次 |
| 14 | **hook 下标映射自证**（并纠正上一线的 5/6/7） | **PASS** | `raw/probe-hooks.json`：22 槽；sections=7、onboardingSteps=12、sessions=17 |
| 15 | 宿主 PID / 并发实例数记录 | **PASS** | PID 1390375；本线 1 实例，peer 2 实例 |
| 16 | ≥3×60s 窗口 + 无效窗口保留 | **PASS** | 6×60s + 4×45s + 器械窗口，全部保留，无剔除 |
| 17 | 绝对速率标注并发条件 | **PASS** | §5.1；本报告只用比值/为零/占比 |
| 18 | 最小修复设计 + 回归风险 + 验收判据 | **PASS** | §4（F1–F4；含 F3 比较器会吞 locale 标签的显式风险与三项回归判据） |
| 19 | 修复是否已实施 | **未实施（本线为只读审计，边界所限）** | 无产品文件改动 |

---

## 7. 复现方式

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/root-subscriptions

# 器械自证：SettingsRoot 22 槽 hook 链（~45s，只开面板/切标签）
node scripts/probe-hooks.mjs

# 主测量：6 × 60s（通用 / 模型 / 切回通用 / 模型again / 关闭 / 离线）
node scripts/measure.mjs --window 60000 --tag main \
  --states general,models,back-general,models-again,closed,offline

# 状态依赖复现：4 × 45s
node scripts/measure.mjs --window 45000 --tag seq --states general,models,back-general,models-again
```

产物：`raw/report-<tag>.json`（窗口汇总）、`raw/dump-<tag>.json`（逐 commit fiber/hook 记录）、`raw/progress-<tag>.json`（逐窗口落盘）。

---

## 8. 要最终确认点火源还需哪一次干净测量（交协调者统一串行安排；本线**不再自行运行**）

§2.4bis 的判别因子表把范围收敛到了一个明确的问题：**SettingsRoot 自身三条订阅全部被排除，但其自渲染真实存在（3211 次）**。要把点火源钉到代码行，只需**一次**干净测量，不需要重做本线已有的任何工作。

### 8.1 所需测量的最小规格

| 项 | 规格 | 理由 |
|---|---|---|
| 窗口数/时长 | **2 × 60s**（`models` 状态 + 一次「首次打开通用」） | `models` 是自渲染必现状态；「首次打开通用」是父路径必现状态，两窗即可同时覆盖两条路径 |
| 独占要求 | **单浏览器实例、无外来 Playwright 进程**（当前 7 线并发下不可得，故须由协调者串行安排） | 点火源判别本身是确定性的，但"干净"能让 §4bis.2 中被标 INCONCLUSIVE 的绝对值一并变得可用 |
| 已就绪的器械 | 直接复用 `scripts/lib-init-slots.js` + `scripts/measure.mjs`（已被本线自证可用） | 无需重新开发 |
| 纪律 | 只开/关设置面板 + 切换设置导航标签；不点保存/应用/删除/模型切换 | 与本线一致 |

### 8.2 该测量要回答的三个具体问题（按判据写死）

1. **React 提交层**：在自渲染 commit 上读取 `root` 根 fiber 与 `SettingsRoot` 的 `lanes`/`childLanes`、以及 `root.current` 的 `memoizedState` 上是否有**同一次提交内被合并的其它更新**。判据：若自渲染 commit 上根 fiber 的 `lanes` 非空 ⇒ 点火源是**本组件之外**的更新被合并进来；若为空 ⇒ 点火源是 uSES 自身路径。
   - 需要的额外器械：`onCommitFiberRoot` 里补读 `root.current.lanes`、`f.pendingProps`、`f.lanes`（**约 10 行**，本线已有框架可直接扩展）。
2. **`RootEntry` 的执行口径复核**：用 `renderer client.js:711` 的 `RootEntry` 函数体插桩（经 `defineProperty` 拦 `jsx`/`createElement` 导出并包裹，**本线两次尝试未成功**，需在干净环境下重试；若仍不可得，则改判 §2.4bis 的祖先链判别是否在本构建下对"父渲染但子元素引用未变"存在偏差）。
3. **`SlotOutlet` 的槽版本是否真的恒定**：本线抓 `getVersion` 未成功（cordis 服务实例经 `#core` 私有字段持有，`Object.prototype` 陷阱与 `Object.entries` 面都取不到）。该测量需改用 **Proxy 包住 `ctx.slots` 服务对象**或在**插件侧只读注入**的方式取到 `getVersion` 返回值序列，确认 `number:35` 恒定是否被观测偏差掩盖。

### 8.3 不需要重做的（避免重复劳动）

- 三个 selector 的身份语义与"未被触发"结论（S1–S5）：已用 6329 次渲染 + 全部窗口的 store 计数确证，**不必复测**。
- hook 下标映射（7/12/17）：已在 `raw/probe-hooks.json` 自证，**可直接复用**；但**请勿再沿用旧线的 5/6/7**。
- 状态依赖的存在性（S6/S7）：4×45s + 6×60s 已复现，**不必复测**；只有 8.2 的第 3 项（槽版本序列）需要补。

### 8.4 停止采集声明

本线**自 15:55 起未再启动任何浏览器或采集脚本**；全部残留进程 **0**；未使用 `/tmp` 脚本或 `--nolockwait` 绕过任何锁；未执行 `pkill`/`kill`。后续一律按协调者指令：**只读分析已有数据，发现异常进程只记 PID 上报**。§7 的复现命令**仅作记录**，不在当前并发条件下执行。
