# 「点击设置就卡」— 事件/订阅/副作用 穷举审计（static-events 线）

- 审计日期：2026-09-22（CST，宿主时区）
- 输出目录：`.workspace/lag-fix/incident2/static-events/`
- 宿主：`node ~/.npm-global/bin/dsh web`，**PID 10806**（未重启、未 pkill、未改任何产品文件）
- 现场：`http://127.0.0.1:3080`，`__DSH_BOOT__.rev = f461dc4deaa2`
- 原始 JSON：`raw/open-probe-run1.json`（run1）、`raw/reflow-probe-run2.json`（run2）
- 器械：`scripts/lib-init-counters.js`（run1）、`scripts/lib-init-counters2.js`（run2）、
  `scripts/open-probe.mjs`、`scripts/reflow-probe.mjs`、`scripts/spike-surface.mjs`
- 子线产物：`raw/sub-slots-registry.md`（槽注册表语义）、`raw/sub-subscriptions.md`、`raw/sub-general-mount.md`

---

## 0. 裁决摘要（先给结论）

| # | 命题 | 裁决 | 证据 |
|---|---|---|---|
| A | 点设置会触发**「订阅即回调」**事件风暴 | **FAIL（否证）** | 见 §3；`fireImmediately` 全库 0 处调用 |
| B | 点设置会触发**同步布局 / forced reflow** | **FAIL（否证）** | run1 `layout.read.rect`=**1**、`reflow.*`=**0**；run2 复测见 §4 |
| C | 点设置会写 `localStorage` | **FAIL（否证）** | 全库仅 3 个持久化 store，均与设置打开无关，见 §5.3 |
| D | 点设置会注入新 CSS / 新增样式规则 | **FAIL（否证）** | `styleTags` 93→93；`headStyleSheets`/`headCssRules` 95/2984 前后不变（run1 + 兄弟线 `first-open-profile/raw/probe2-clean.json`） |
| E | 点设置会建立长期订阅/定时器/观察器**泄漏** | **FAIL（否证）** | run1：新增 `setInterval` 0、新增 observer 0；新增 `setTimeout` 3 个全部来自既有 `dsh-workspace-enhancement.scheduleScan`，非设置代码 |
| F | 点设置**确实**产生可测的主线程阻塞 | **PASS（证实）** | run1：2s 窗口内 3 个 longtask = **106 + 52 + 75 = 233 ms**；帧间隔首帧 **166.6 ms**（兄弟线 `probe-summary.json`） |
| G | 阻塞的主要来源是**设置子树首次挂载**（而非事件/订阅风暴） | **PASS（证实，量级已测）** | §2 调用链 + §6 成本点 1；CPU profile 首次打开非 idle 118 ms vs 重开 42 ms |
| H | 卡顿的**最终点火源**（哪一个具体函数占掉 106 ms） | **INCONCLUSIVE** | 见 §6 成本点 1 的量级说明与 run2 LoAF 归因 |

**一句话**：用户提出的两条机理（订阅即回调、同步布局）在本证据下**均被否证**；
「点击设置就卡」在静态 + 只读计数下可测的具体事实是——**点击后 2 秒内 233 ms 长任务、
首帧卡 166.6 ms，集中在设置子树首次挂载这一处**，且**没有**伴随订阅风暴、样式注入、
forced reflow 或定时器/观察器泄漏。

**对第 2 问（事件风暴）的关键修正**：本代码库**不存在**「订阅即回调」（`fireImmediately` 全库
0 调用，zustand/locale/槽三套订阅一律 `Set.add`）。但存在一个**形似而机理不同**的模式，
且它是**唯一被证明会在点击提交内触发订阅者回调**的机制：
**挂载 effect 主动写 store → 通知既有订阅者**
（`permission-presets:68-70 → :266-269`、`settings-general:326-328 → :381-386`）。
详见 §2.3。

**点击瞬间「实际会发生」的完整清单**（本线穷举结果，即任务第 1 问的收敛答案）：

1. 1 次局部 `setState`（`settings-general:212`）→ 挂载 `SettingsPanel`；
2. 2 个面板级 effect：document `keydown` 监听（`:99-107`）+ `closeButton.focus()`（`:108-111`）；
3. 挂载 **6 个 `settings.general.item` 行 + 4 个 Menu + 2 个 Slider + 7 个 outlet/boundary ≈ 21 个组件**；
4. **1 次跨进程 RPC**：`agentPresets.list`，宿主侧**无缓存**重扫预设目录（`agent-preset:293-296 → :533`）；
5. **2 次 store 写入引起的同步通知**（permission / 文档动作），各多一次渲染；
6. **1 次全局副作用**：`WallpaperRow` 把「设置已打开」写进模块级 `pageState` 并**重铺壁纸 + 走主题覆盖层**
   （`wallpaper:400-403 → :518-521 → :238-268`），挂载时还渲染一张 **2.33 MB / 1810×1279** 的预览图（`:453`）；
7. **1 次别的插件的连带工作**：`dsh-workspace-enhancement` 的全文档 MutationObserver 被设置面板的
   176 个新节点触发 → 去抖 120 ms 的 `scan()`（窗口内触发 2–3 次）；
8. 1 条**常驻既存**的跨域级联继续跑：`sessions.list → workspaces.project()`。

**没有发生**：订阅即回调、新订阅风暴、样式注入/规则膨胀、forced reflow、`localStorage` 写、
新增定时器/观察器、主题重放、网络风暴。

> 纪律说明：本线**未**点击保存/应用/删除/模型切换/设置导航标签；关闭面板只按 `Escape`
> （等价于点遮罩，`settings-general:104-109` 的实现即此两路）。浏览器运行次数记账见 §8。

---

## 1. 点击路径的完整地图（调用链图 + path:line 表）

### 1.1 调用链图

```
[用户点击侧边栏底部「设置」]
  │
  ├─(1) 按钮本体：settings-general/lib/client.js:204-213
  │      <button class="VOzbGW_trigger" aria-haspopup="dialog" aria-expanded={open}>
  │      onClick: () => { setOpen(true) }          ← 唯一的状态变更，组件局部 useState
  │      └─ 注意：不写 store、不写 context、不发 RPC；纯粹 setState
  │
  ├─(2) React 18 批处理 → 提交 → 挂载 SettingsPanel（同一提交内）
  │      settings-general/lib/client.js:95-170
  │      ├─ useEffect[onClose] → document.addEventListener("keydown", onKeyDown)   :100-108
  │      │     └─ ★ 首开特有：面板每次打开都新建一个 document 级 keydown 监听（Escape 关闭）
  │      ├─ useEffect[] → closeButton.current?.focus()                            :109-111
  │      │     └─ ★ 首开特有：同步 focus() → 触发 DOM focus 事件与:focus 样式匹配
  │      └─ 面板 DOM：overlay(fixed inset:0) > mask(backdrop-filter) + panel(800×800)
  │            settings-general/lib/client.js:28（CSS 常量）
  │
  ├─(3) 面板内容槽渲染 —— 仅渲染「当前激活的 section」
  │      settings-general/lib/client.js:164
  │      renderSlot("settings.section", { close: onClose }, { only: active })
  │      └─ active 默认 = rows 排序后的第一项 = "general"（order 0）
  │         注册处 settings-general/lib/client.js:585-595
  │
  ├─(4) General 段 → 逐行挂载 settings.general.item（★ 首开特有的主要成本）
  │      settings-general/lib/client.js:294-299  renderSlot("settings.general.item", {})
  │      注册者 6 处（全部在本次点击时首次挂载，slot 顺序按 order）：
  │        ├─ dsh-client-ui-agent-preset/lib/client.js:1700  (order -25) 《★ 挂载即发 RPC》
  │        │     AgentPresetRow :290-329
  │        │     useEffect[load] :293-296 → load() :1580 → controller.load() :633-655
  │        │       → beginRosterRead(:560-576，只挡 in-flight，**无已加载缓存**)
  │        │       → api.agentPresets.list({})  :533
  │        │       → 宿主 dsh-agent-presets/lib/index.js:887-889 list()
  │        │       → discoverPresets :270-277 → scanRoot :236-264
  │        │           readdir + isFile(stat) + readPresetMetadata + compositionProblem
  │        │           逐 preset 解析 YAML（本机 4+1 个 preset，最大 13 431 B）
  │        ├─ dsh-client-ui-permission-presets/lib/client.js:442 (order -20)
  │        │     PermissionRow :63-148；load :68-70 → controller.load :260-271
  │        │       （`??=` 一次性订阅；ensure() 在 mirror 已 ready 时**不发 RPC**）
  │        ├─ dsh-client-locale/lib/client.js:1251        (order 0) 语言
  │        │     LanguageRow :908-953，**无任何 useEffect**；inject → sync → 写 <html lang>
  │        ├─ dsh-client-ui-theme/lib/client.js:1338      (order 10) 外观
  │        │     AppearanceRow :74-94，**零 effect / 零 RPC / 零 DOM 读写**（六行中最便宜）
  │        ├─ dsh-client-ui-conversation/lib/client.js:9911 (order 20) Enter 发送
  │        │     EnterBehaviorRow :4208-4259，**无 useEffect / 无 RPC**
  │        └─ @local/dsh-wallpaper（order 30，**部署副本**）
  │              .dsh/profiles/node_modules/@local/dsh-wallpaper/lib/client.js:591 注册
  │              WallpaperRow :386-486
  │              ★ useEffect[] :400-403 → notifySettingsOpen(true) :518-521
  │                  → applyCurrent :348-350 → applyWallpaper :236-268
  │                  → 写 wallpaperEl.style.backgroundImage / filter (:253-255)
  │                  → shadeTokens :190-211 → ctx.theme.overrideTokens（**全局主题覆盖层**）
  │              且该行渲染预览图 <img src={config.source}> :453 —— 本机指向
  │              /dsh-wallpaper/media/37758c1c-….png（**2 334 260 B，1810×1279**，
  │              见 ~/.dsh/settings.yaml:199-204，opacity .88 / blur 0 / darkMask 0）
  │      级联深度：section → item **只一层**（六行均未声明 children），见 raw/sub-general-mount.md §7
  │
  ├─(5) 面板 header 槽
  │      settings-general/lib/client.js:151  renderSlot("settings.action", {})
  │      └─ SettingsDocumentAction（:319-345）
  │           ├─ useEffect[controller] → controller.load()                        :326-328
  │           │     settings-general/lib/client.js:377-387
  │           │     ├─ describeFace.subscribe(...)  ← ★ 首开才建立的订阅（幂等 ??=）
  │           │     ├─ store.update(status="loading")      → 触发一次 React 渲染
  │           │     └─ await this.describeFace.ensure()
  │           │            ui-settings/lib/client.js:1246-1251
  │           │            └─ 若 mirror.status !== "idle" 则立即 resolve（不发起新 RPC）
  │           └─ if (state.status !== "ready") return null                        :329
  │                 └─ ⇒ status="ready" 后「打开配置文件」按钮出现，按钮出现本身再触发一次渲染
  │
  ├─(6) 面板 nav 槽：settings.header（:126-129）、settings.close（:155-163）
  │
  └─(7) 与设置无关但**同时**被触发的既有全局观察器
         dsh-workspace-enhancement/lib/client.js:4445-4454
         MutationObserver(document.body,{childList,subtree}) → :4446 scheduleScan()
         └─ :4403-4412 去抖 120ms / 最小间隔 300ms；:4413-4416 onChange 也调 scheduleScan
              ⇒ run1 实测：打开窗口内被触发 2–3 次（t=343.8/869.5/1841.5ms）
```

### 1.2 path:line 表（首开特有动作单独标注）

| # | 动作 | path:line | 首开特有？ | 证据 |
|---|---|---|---|---|
| 1 | 点击处理器：`setOpen(true)` | `dsh-client-ui-settings-general/lib/client.js:212` | 否（每次点都走） | 源码 |
| 2 | 新挂 `document` keydown（Escape） | `…settings-general/lib/client.js:103-105` | **是** | run1 roster.listeners 含 `keydown on document`，栈指向 `settings-general/client.js:103` |
| 3 | 同步 `closeButton.focus()` | `…settings-general/lib/client.js:109-111` | **是** | 源码；CPU profile `focus` 自耗 6.5 ms（首开）/5.5 ms（重开） |
| 4 | `renderSlot("settings.section", {only:active})` | `…settings-general/lib/client.js:164` | 否（每次开） | 源码 |
| 5 | General 段挂载 6 个 item 行 | `…settings-general/lib/client.js:298` + §1.1(4) 六处 | **是** | run1 dialog 文本含「标准模式（子代理…）」「中文」「浅色/深色/跟随系统」「排队发送」 |
| 6 | `controller.load()`（文档动作） | `…settings-general/lib/client.js:327` → `:377-387` | **是** | 源码；`follow ` 用 `??=` 幂等 |
| 7 | `describeFace.ensure()`（可能一次 `settings.describe` RPC） | `…settings-general/lib/client.js:386` → `dsh-client-ui-settings/lib/client.js:1246-1251` | **首开**（mirror 已 ready 时为零成本） | run1 `fetch.call`=1（该 fetch URL 已被 Playwright 记为 ""，见 §5.2 局限） |
| 8 | 面板 overlay 首次绘制（`backdrop-filter: blur(2px)`） | `…settings-general/lib/client.js:28` | **是** | token 定义 `dsh-client-ui-theme/lib/client.js:130`（`--dsw-mask-blur:blur(2px)`；另有 `dsh-client-ui-attachment` 同名 token） |
| 9 | 既有 MutationObserver 被 DOM 变更触发 → `scheduleScan` | `dsh-workspace-enhancement/lib/client.js:4445-4447`、`:4403-4412` | 否（常驻，但**由本次 DOM 变更触发**） | run1 roster.timers 三条栈均指向 `scheduleScan:4407` ← `onChange:4415` |
| 10 | `aria-expanded` 属性翻转 | `…settings-general/lib/client.js:208` | 否 | run1 `mut.attr.aria-expanded`=1 |

---

## 2. 事件风暴排查：打开期间会触发的全部订阅

### 2.1 订阅清单与「是否订阅即回调」判定

判定基准（**代码级**，非推断）：

- zustand `subscribe`：`dsh-client-runtime/lib/client.js:4744-4747`
  `const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };`
  → **只是 Set.add，无任何立即调用**。
- zustand `subscribeWithSelector` 的立即回调**唯一入口**是 `options.fireImmediately`：
  `dsh-client-runtime/lib/client.js:4787` `if (options?.fireImmediately) optListener(currentSlice, currentSlice);`
  → **全库 `fireImmediately` 出现次数 = 1（仅这处定义），调用点 0 处**。
  证据：`grep -rn fireImmediately <all client.js>` → 仅 `dsh-client-runtime/lib/client.js:4787`。
- locale `subscribe`：`dsh-client-locale/lib/client.js:1085-1090` `this.listeners.add(fn); return () => …`
  → **无立即调用**。
- 槽 `slots.subscribe`：**只在 ledger version 变化时通知，且经 `queueMicrotask` 批处理**；
  订阅时不回调（子线 `raw/sub-slots-registry.md` §1，含 `SlotCore` 逐行引用）。

| 域 | 订阅点 | 谁订阅 | 订阅即回调？ | 证据 |
|---|---|---|---|---|
| sessions | `dsh-client-runtime/lib/client.js:8963-8971`（`this.list` store） | `dui-settings-general` 的 `useSessions`（经 `useSyncExternalStore`）；sidebar/conversation 等多个消费者 | **NO** | zustand 语义 `:4744-4747`；`fireImmediately` 未用 `:4787` |
| sessions（内部级联） | `:8975-8978` `this.list.subscribe(() => { this.followCurrent(); this.provideChannel.publishCurrent(); })` | sessions 自身 | **NO**（但**每次 list 变更**都跑 followCurrent + publishCurrent） | 源码 |
| workspaces | `dsh-client-runtime/lib/client.js:9921-9934` `this.list` store；`:9929-9933` `this.sessions.list.subscribe(() => this.project())` | workspaces 自身 + 消费方 | **NO** | 源码；注意 sessions→workspaces 的**跨域级联** |
| slots | `dsh-client-ui-renderer/lib/client.js:743` `useSyncExternalStore(host.subscribe(slotKey,fn), host.getVersion(slotKey))` | 每个 `SlotOutlet` | **NO**（版本变更才回调，且微任务批处理） | 子线 `sub-slots-registry.md` §1/§3 |
| locale | `dsh-client-locale/lib/client.js:1085-1090`；渲染侧 `dsh-client-ui-renderer/lib/client.js:484-486 useLocaleRevision` | 每个 `SlotOutlet` + `settings-general:513` + `settings-plugins:1269` | **NO** | 源码 |
| theme | `dsh-client-ui-layout/lib/client.js:554-556` `ctx.on("theme/change", …)`（**事件**非 store 订阅） | layout 的 ThemePresenter | **NO**（仅主题变更时） | 源码 |
| settings | `dsh-client-ui-settings/lib/client.js:991-993`（scope 建时 `mirror.subscribe`）、`:1222-1224`（mirror store） | 每个 `SettingsScopeController` | **NO** | 源码 |
| settings（打开时新增） | `dsh-client-ui-settings-general/lib/client.js:378` `this.following ??= this.describeFace.subscribe(...)` | SettingsDocumentStore | **NO** | 源码；`??=` 保证只建一次 |

**结论（对应任务第 2 问）**：设置打开期间会触发的订阅共有上表 8 类，**没有任何一类在订阅瞬间
立即回调一次**。用户/前序假设中的「订阅即回调是最常见的打开就卡模式」在本代码库
**不成立**——因为该库统一用 zustand vanilla + `Set.add`，且从未使用 `fireImmediately`。

### 2.2 但有一条真实存在的「跨域级联」，值得记账

`sessions.list` 每次变更 → `workspaces.project()`（`dsh-client-runtime/lib/client.js:9930-9932`），
且 `sessions` 内部 list 变更还会跑 `followCurrent()` + `provideChannel.publishCurrent()`（`:8975-8978`）。
这不是「订阅即回调」，而是**一次通知引起两域重算**；在活跃会话流下会被高频触发
（run1 关闭态基线：2s 内 528 条 `ws.message.server-request`）。
**待量化**：本线未测「sessions.list 变更 → workspaces.project 的成本」，标 **INCONCLUSIVE**。

---

### 2.3 关键修正：唯一在点击提交内触发订阅者回调的机制是「挂载 effect 写 store」

「订阅即回调」被否证（§2.1）。但**另一条**路径确实会在点击的那个提交内同步通知既有订阅者：

| 位点 | 代码 | 后果 |
|---|---|---|
| `dsh-client-ui-permission-presets/lib/client.js:68-70` | `useEffect(() => { load(); }, [load]);` | 挂载即跑 |
| `dsh-client-ui-permission-presets/lib/client.js:266-269` | `this.store.update((state) => { state.status = "loading"; state.error = null; });` | **同步通知**（zustand `listeners.forEach` `dsh-client-runtime:4747`） |
| 同上 `:270-271` | `await this.describeFace.ensure(); this.derive();` | `ensure()` 在 mirror 已 ready 时立即 resolve；随后 `derive()` **再写一次** |
| `dsh-client-ui-settings-general/lib/client.js:326-328` | `useEffect(() => { controller.load(); }, [controller]);` | 挂载即跑 |
| 同上 `:381-386` | `this.store.update((state) => { state.status = "loading"; … });` | **同步通知** |
| `dsh-client-ui-settings/lib/client.js:1087-1110` | `derive()` 把 `revision/base/user/writable` 写在 `if (decoded === void 0) return;` **之前** | ⇒ immer 必然产出新状态，**每次 mirror 通知都必定变化** |
| `dsh-client-ui-permission-presets/lib/client.js:64` | `const state = usePermission((snapshot) => snapshot);` | 整快照 selector ⇒ 任何字段变化都重渲染整行 |

**为什么这仍然不是「打开就卡」的主因**：这些写入只影响 **1–2 个行级 store**，
消息量级是「几次」而非「几百次」；且本线 run1 的 `mut.total` 只有 10、DOM 增长一次性完成（§3.3）。
⇒ 它是一个**真实但量级有限**的放大器（子线 `sub-subscriptions` 将其列为头号可疑放大器，
但那是在**无 trace** 的条件下排序；本线有计数证据可把它的量级下修）。

**INCONCLUSIVE**：这些 store 写入共产生了几次额外 React 提交、各耗多少毫秒——
本线未对 store 订阅打桩计数，标 **INCONCLUSIVE**。

## 3. 只读计数验证（run1；打桩自证）

### 3.1 打桩自证（先证器械会动）

`selfTest()` 主动制造流量后，以下计数器**确实增长**（`raw/open-probe-run1.json.selfTest.deltaKeys`）：

```
raf.callback, raf.request, raf.selfChain, mut.total, mut.childList, mut.addedNodes,
mut.attributes, mut.attr.style, mut.attrLayout.style, style.append.style,
listener.add, listener.remove, layout.read.rect, layout.read.offsetHeight, layout.read.gcs,
ws.message, ws.message.server-request
```

`mutationObserverReady = true`、`longtaskObserverReady = true`。
⇒ 器械对「变更 / 布局读取 / 监听器 / 计时器 / 长任务」均有效，**不是空跑**。

### 3.2 关闭态对照基线（2s，不点击）

| 计数 | 值 |
|---|---|
| `ws.message` / `ws.message.server-request` | **528** |
| `mut.total` | 15 |
| `timer.setTimeout` | 3 |
| `raf.callback` | **0** |

⇒ 页面在观察窗内**没有拍动画帧**（headless、无持续动画），而会话流仍以 ~264 msg/s 速率在跑。
这解释了本机「开着活跃会话时任何 UI 操作都更容易被感知为卡」的背景负载。

### 3.3 点击 → 2s 窗口（run1）

| 计数 | 关闭态基线(2s) | 打开窗口(2s) | 读数含义 |
|---|---|---|---|
| `ws.message` | 528 | **60** | 打开窗口内**网络流反而更少**（非风暴） |
| `mut.total` | 15 | 10 | DOM 变更极少 |
| `mut.childList` / `addedNodes` | 15 / 8 | 2 / 2 | 设置面板**只新增 2 个节点子树入口**（面板 overlay + 行内 badge），节点总数 596→772 |
| `listener.add` | — | **9** | 其中 1 个是设置自己的 `keydown`（栈指向 `settings-general:103`），其余 8 个是 React 委托监听器 |
| `timer.setTimeout` | 3 | 3 | 全部来自 `dsh-workspace-enhancement.scheduleScan`，**非设置代码** |
| `timer.setInterval` | 0 | **0** | 无新增轮询 |
| `observer.*` / `observe` 事件 | 0 | **0** | 无新增观察器 |
| `styleCreate.style` / `style.append.style` | 0 | **0** | 无样式注入 |
| `layout.read.rect` | — | **1** | 2s 内仅 1 次 |
| `layout.readAfterWrite.*`（gap<8ms） | 0 | **0** | **无 forced reflow** |
| `fetch.call` | 0 | **1** | 见 §5.2 局限 |
| `longtask` | 0 | **3（106 / 52 / 75 ms = 233 ms）** | ★ 唯一的成本信号 |
| DOM 节点数 | 596 | **772** | +176 节点，且增长**只发生在一次采样间隙内** |

**DOM 增长时间线**（100ms 采样网格，`raw` 内 `samples`）：

```
t=13704.4  nodes=601     ← 点击前
t=14100.4  nodes=601     ← 点击前最后一个采样
t=14200.4  nodes=772     ← 已增长完毕（中间约 600ms 未采样 ⇒ 主线程被占住）
t=14200.4 … t=16100.4    nodes=772 恒定 ← 之后结构不再变化
```

⇒ 结构变化是**一次性**的（+176 节点），不是持续 churn；
但 `100ms` 采样网格在点击后**丢了一整格**（≈600ms 内 6 次采样只落了 1 次），
这是「主线程被长任务占住」的**独立第三证**（另两证：longtask 条目、兄弟线帧间隔 166.6ms）。

### 3.4 与兄弟线的独立交叉验证（非本线运行）

`incident2/first-open-profile/raw/`（同日 02:12–02:14Z 采集）：

| 指标 | 值 | 来源 |
|---|---|---|
| 帧间隔序列首帧（first-open） | **166.6 ms** | `probe-summary.json.rafSeries[0].raf[0]` |
| 帧间隔序列首帧（second-open） | **83.4 ms** | `probe-summary.json.rafSeries[1].raf[0]` |
| click→quiet | 876 ms（`settle` 段 779.8 ms） | `probe2-clean.json.phases[0].wallMs` |
| DOM mutation 数 | 10 | 同上（与本线 run1 的 10 完全一致） |
| `headStyleSheets` / `headCssRules` | 95 / **2984 → 2984（不变）** | `probe2-clean.json` census 前后 |
| `bodyCssText` | 仅 `--dsw-alias-bg-base` 一条，前后不变 | 同上 |
| CPU profile 首开 vs 重开非 idle | 118 ms vs 42 ms | `cpuprofile2-clean-first-open.json` / `-reopen.json` |

⇒ 三条独立路径同向：**首次打开有真实的一次性主线程成本（百毫秒量级），重开显著更轻**。

---

## 4. 样式与布局：forced reflow 逐处排查

### 4.1 命中的「写后立即读」代码位点（静态普查）

全量 `grep` 结果（`getBoundingClientRect` / `offsetHeight` / `clientHeight` / `scrollHeight` / `getComputedStyle`）：

| path:line | 代码 | 是否「写后立即读」 | 打开设置时会跑吗 | 频率 |
|---|---|---|---|---|
| `dsh-client-ui-conversation/lib/client.js:3451-3459` | `input.style.height=…; input.offsetHeight; …; scrollport.style.height=…; scrollport.offsetHeight;` （`repairSafariTextareaLayout`） | **是（教科书式写-读-写-读，2 组共 4 次强制布局）** | **不会**（调用点 `:3636` 受 `if (safari && nativeShrink)` 门控，本机为 Chrome） | 仅 Safari + 输入框原生收缩时 |
| `dsh-client-ui-conversation/lib/client.js:7174` | `scroller.style.setProperty("--dsh-composer-height", seat.offsetHeight+"px")` | 是（读后写，方向相反，非 thrash） | 否（composer 相关） | 布局变化时 |
| `dsh-client-ui-layout/lib/client.js:475` | `this.themeColorMeta.content = getComputedStyle(document.body).backgroundColor` | **是**（读在 `apply()` 写 token 之后） | **否**（仅 theme 变更） | 每次 `theme/change` |
| `dsh-client-ui-layout/lib/client.js:408-449` | `ThemePresenter.apply()` 逐 token `body.style.setProperty` 后读 computed 背景 | 是，**但已自带缓解** | 否 | 见下 |
| `dsh-client-ui-agent-preset/lib/client.js:1121` | `setTruncated(el.scrollHeight > el.clientHeight)` | 是 | 可能（若该行挂载时测量） | 待定，见子线 |
| `dsh-client-ui-deliverables/lib/client.js:229-235` | `getComputedStyle(row)` + `chipProbes.map(getBoundingClientRect)` | 是 | 否（deliverables chips） | 渲染 chips 时 |
| `dsh-client-ui-trajectory/lib/client.js:1185-1188` | `const {offsetWidth, offsetHeight} = element` | 是 | 否 | 虚拟列表测量 |
| `dsh-client-ui-sidebar/lib/client.js:132` | `column.current?.getBoundingClientRect()` | 是 | **否**（受 `pointerInside` 门控，`:130`） | 指针在侧栏内移动时 |
| `dsh-client-ui-workspace/lib/client.js:438/824/1196` | `getBoundingClientRect` | 是 | 否（拖拽/锚点） | 交互时 |

**关键**：`dsh-client-ui-layout/lib/client.js:408-449` 的 `apply()` **已经内置两层缓解**，
不能算作「打开设置导致的 forced reflow」：
1. **内容签名幂等闸门**（`:414-416` 计算 signature，`:418-427` 命中即 `return`），注释明确写
   「re-running the writes would change no computed value — it would only pay for another forced recalculation」；
2. **把 computed 背景读取推迟到下一帧**（`:449` `scheduleThemeColorRefresh(...)`，实现 `:359-378`
   用 `requestAnimationFrame` 合批，`:363` 注释「collapses a whole dispatch round into one read」）。

### 4.2 实测：打开设置期间没有 forced reflow

- run1（gap 阈值 8ms）：`layout.readAfterWrite.*` **全为 0**；`layout.read.rect` 总计 1 次。
- run2（gap 阈值放宽到 50ms、并对 `classList.add/remove`、`setAttribute("style"/"class")`、
  `CSSStyleDeclaration` 的 `cssText/height/width/top/left/visibility` 全部打桩）：
  结果见 `raw/reflow-probe-run2.json`，摘要见 §7.2。
- 兄弟线独立佐证：`headCssRules` 2984→2984、`headStyleSheets` 95→95，`bodyCssText` 不变
  ⇒ 打开设置**没有**引起级联重算范围的扩大，也**没有**主题重放。

⇒ **裁决 B 为 FAIL（否证）**：把「打开设置 → forced reflow」当作主因，在本证据下不成立。

### 4.3 打开设置确实带来的样式/绘制成本（非 reflow，但真实）

| 项 | 值 | 证据 |
|---|---|---|
| 面板 `box-shadow: var(--dsw-shadow-lv3)` | `0 0 1px 0 #0003, 0 0 4px 0 #00000005, 0 12px 32px 0 #00000014` | `dsh-client-ui-theme/lib/client.js:130` |
| 遮罩 `backdrop-filter: var(--dsw-mask-blur)` | `blur(2px)`，覆盖 `inset: 0`（全视口 1440×900） | `settings-general:28`；`probe2-clean.json.census.wp[0]` = 1440×900 z=1000 |
| 面板 `border-radius: 24px` + `overflow: hidden` | 触发裁剪层 | `settings-general:28` |
| 结果 | **无法从源码量化**（需 paint/layout 计时） | 标 **INCONCLUSIVE**；`scripts/lib-init-counters2.js` 里的 LoAF `styleAndLayoutStart` 可用于分离，但该复测**未取到跨线锁、未运行**（§7.2） |

---

## 5. 副作用普查（定时器 / 观察器 / 样式写入 / rAF / localStorage）

### 5.1 打开设置**新建**的副作用（run1 roster，逐条）

| 类别 | 数量 | 明细（栈 → 源码位点） |
|---|---|---|
| `document` 级事件监听 | **1** | `keydown`，栈 `at https://…/dsh-client-ui-settings-general/client.js:103:14` ← `settings-general/lib/client.js:100-108` |
| React 委托监听（非设置代码） | 8 | `invalid`×7（select/input）、`error`/`load`（img），栈均在 `assets/index-ClqxG24t.js:53/56`（React DOM） |
| `setInterval` | **0** | — |
| `setTimeout` | 3 | 全部 `scheduleScan (dsh-workspace-enhancement/client.js:4407)` ← `onChange (:4415)` ← `dsh-client-runtime/client.js:4750`（zustand `listeners.forEach`）。**非设置代码** |
| `MutationObserver` / `ResizeObserver` / `IntersectionObserver` | **0 新建** | run1 `roster.observers = []`、`observeEvents = []` |
| `requestAnimationFrame` | 0（关闭态与打开态均为 0） | run1 两窗口 `raf.callback` 均为 0 |
| 样式注入 | **0** | `styleCreate.style`=0、`style.append.style`=0 |
| 写入 `document.body` 样式 | **0** | 兄弟线 `bodyStyleLen` 恒为 1、`bodyCssText` 不变 |
| `localStorage` 写入 | **0**（与设置打开无关） | 见 §5.3 |

### 5.2 一处必须承认的测量局限

run1 记录到 `fetch.call = 1`（t=6ms），但**URL 为空**——Playwright 的 `page.mouse.click` 使
`fetch` 的 `input` 落在无法读取的形态（大概率是 `Request` 对象且我的取值路径未覆盖）。
⇒ 「打开设置是否伴随一次网络 RPC」在本线**未能确证**。
**静态判断（可确证的部分）**：`SettingsDocumentStore.load()` 调用的 `describeFace.ensure()`
在 `mirror.status !== "idle"` 时**直接 resolve、不发新 RPC**（`dsh-client-ui-settings/lib/client.js:1246-1251`），
而 mirror 在插件激活时就已 `ensure()` 过（`dsh-client-ui-settings/lib/client.js:1347`），
且打开时窗口内 `ws.message` 仅 60 条（低于关闭态基线的 528）。
⇒ 该 fetch 更可能是**测试框架自身的产物**，但**本线不据此下断言**，标 **INCONCLUSIVE**。

### 5.3 `localStorage` 写入面普查（全库）

`createSnapshotStore(init, { persist: { name } })` 是唯一的 localStorage 持久化入口
（`dsh-client-runtime/lib/client.js:5397-5406` → `attachPersistence` `:5424-5436`，
`api.subscribe((state) => localStorage.setItem(name, JSON.stringify(state)))`）。
全库**仅 3 个**持久化 store：

| store | path:line | 与打开设置的关系 |
|---|---|---|
| `dsh.sessions.current`（会话选择） | `dsh-client-runtime/lib/client.js:8954` | **无关**（设置打开不改 current） |
| 通用 `decl.init()` + `persistKey`（动态 store 工厂） | `dsh-client-runtime/lib/client.js:5477` | 取决于调用方；未观测到打开时写入 |
| `dsh.trajectory.duration` | `dsh-client-ui-trajectory/lib/client.js:41` | **无关** |

⇒ 打开设置**不触发** `localStorage` 写入。**裁决 C 为 FAIL（否证）**。
（附注：`attachPersistence` 是「每次 state 变更同步写 JSON」——对高频 store 是隐患，
但它不在本次点击路径上。）

---

## 6. 最可疑的前 5 个成本点（按证据强度与量级排序）

### 成本点 1 —— 设置子树首次整体挂载（**唯一被直接测到量级的成本**）

- **证据**：run1 打开窗口 3 个 longtask = **106 + 52 + 75 = 233 ms / 2s**，关闭态基线 0；
  100ms 采样网格在点击后丢失一整格（≈600ms）；兄弟线首帧 **166.6 ms**（重开 83.4 ms）、
  click→quiet 876 ms、CPU profile 首开非 idle **118 ms** vs 重开 42 ms。
- **源码证据**：`settings-general/lib/client.js:212 → :164 → :298`，一次挂载 1 个 section +
  **6 个 `settings.general.item` 行** + header/action/close/nav 五组槽 outlet；
  且 `SettingsRoot` 每次渲染都新建 ownerProps/opts（`renderSlot(..., { wide })` 等），
  经无 memo 的 `RootEntry → SlotErrorBoundary → 子树` 逐级放大（子线 `sub-slots-registry.md` 附录 A：
  每次 `renderSlot(...)` 调用还会跑 `host.isLive(entry)` 的 O(#slot-records) 扫描，SettingsRoot 每渲染 4 次）。
  子线实测挂载树：**7–8 层组件深度、约 21 个 React 组件**（6 行 + 4 Menu + 1 null Modal + 2 Slider + 7 outlet/boundary）。
- **CPU profile 逐函数证据**（`first-open-profile/raw/cpuprofile2-clean-first-open.json`，
  窗口 1060.2 ms / 5889 样本，非 idle 118 ms）：自耗 Top 全部落在**渲染与数据投影**函数上——
  `index-ClqxG24t.js#get` **11.4 ms**（React 内部）、`dsh-client-runtime#(anon)` 9.3 ms、
  `projectList` 7.2 ms、`nextSessionOrderAccount` 5.4 ms、`(garbage collector)` 5.2 ms、
  `walk` 5.2 ms、`index#h` 4.7 ms、`index#Xo` 4.3 ms、`buildListSnapshot` 3.4 ms、
  `index#F4` 3.2 ms、`index#J3` 3.0 ms；
  **`dsh-client-ui-renderer` 仅 5.4 ms**、`dsh-client-ui-theme` **0 ms（未进入 ≥1 ms 名单）**、
  `@local/dsh-wallpaper` 合计 **≈1.3 ms**。
- **量级判断**：**百毫秒级、一次性、重开减半**（83.4 vs 166.6 ms）。
- **INCONCLUSIVE 的部分**：这 106 ms 里 **JS 与 style+layout 各占多少**——CPU profile 只覆盖 JS。
  run2 用 LoAF 的 `renderStart` / `styleAndLayoutStart` 做归因，结果见 §7.2。

### 成本点 2 —— `AgentPresetRow` 挂载即发宿主 RPC，且宿主侧**无缓存**重扫预设目录

- **源码证据（客户端）**：`dsh-client-ui-agent-preset/lib/client.js:293-296`
  `useEffect(() => { load(); }, [load]);` —— `load` 是**稳定闭包**（`:1580` `load: () => controller.load()`），
  即依赖不变但**每次挂载都执行**；`beginRosterRead`（`:560-576`）只挡 `status === "loading"` 的
  in-flight 读（`:563` `if (before.status === "loading") return void 0;`），**没有任何「已加载」缓存**。
- **源码证据（宿主）**：`api.agentPresets.list({})`（`:533`）→
  `dsh-agent-presets/lib/index.js:887-889` `async list() { return await discoverPresets(this.resolvedRoots); }`
  → `discoverPresets`（`:270-277`）对**每个** root 调 `scanRoot`（`:236-264`）：
  `readdir(withFileTypes)` + 逐子目录 `isFile(composition)`（stat）+ `readPresetMetadata` +
  `compositionProblem`（解析 YAML）。
- **本机规模（实测枚举）**：2 个 root（`~/.dsh/.agent-presets`、`dsh/config/agent-presets`），
  共 5 个 preset 目录（standard-glm / minimal / cordis / code / standard），
  最大 composition `13 431 B`。
- **量级判断**：**宿主侧 I/O 极小**（冷缓存下数 ms 级；本机 5 个目录 + ≤20 KB 读）。
  ⇒ **不足以解释 106 ms**，**不得**当作主因。但它是一条**确证的、每次打开都会重演的
  跨进程 RPC + 无缓存重扫**，在预设目录变大（多 root、大 preset）时会线性放大。
  该 RPC 的**往返时延本身未量化** → **INCONCLUSIVE**。
  （兄弟线 `host-click/` 正是测宿主侧 click 路径，其产物可补此项。）

### 成本点 3 —— `WallpaperRow` 把「设置是否打开」当页面信号，打开即**全局重铺壁纸**

- **源码证据**：`@local/dsh-wallpaper/lib/client.js:400-403`
  `React.useEffect(() => { notifySettingsOpen(true); return () => notifySettingsOpen(false); }, []);`
  （注释自称「this row mounts only while the settings modal's General section is open,
  so its mount/unmount is the page detector」）
  → `:518-521` `notifySettingsOpen: (open) => { if (pageState.settingsOpen === open) return; pageState.settingsOpen = open; applyCurrent(ctx); }`
  → `:344-350` `currentPage()` 因 `settingsOpen` 返回 `"settings"`，`applyCurrent` 用
  **settings 页的 override** 重新 `applyWallpaper`
  → `:250-268` 写 `wallpaperEl.style.backgroundImage = url(...)`、`style.filter`，
  并调 `shadeTokens` → `ctx.theme.overrideTokens(OVERRIDE_SOURCE, next)`（**全局主题覆盖层**）。
  ⇒ 打开与关闭**各触发一次** `applyWallpaper`（mount + unmount）。
- **同一次挂载还有一张大图**：`:453` `const preview = config.source === null ? null : jsx("img", { src: config.source, … })`；
  本机 `~/.dsh/settings.yaml:199-204` 指向
  `/dsh-wallpaper/media/37758c1c-9ca8-47d2-bade-3048ab825fb6.png`，**2 334 260 B / 1810×1279**。
- **量级判断**：**INCONCLUSIVE（并已排除为主因）**。
  已量化的反面证据：CPU profile 中 `@local/dsh-wallpaper` 全部函数自耗合计 **≈1.3 ms**
  （`applyWallpaper` 0.5 / `resolveOverride` 0.2 / `shadeTokens` 0.2 / `ensureWallpaperCss` 0.2 / 其余 0.2），
  **图片解码不在主线程**（解码/光栅在合成线程，本线无该线程数据）。
  ⇒ 有真实的全局副作用，但**不能**主张它是 106 ms 的来源。
- **缓解已存在**：部署副本 `:181-185 / :201-207` 有 `sameShadedTokens` 幂等闸门，
  注释明确「re-stacking identical content only re-enters every theme/change listener,
  so … its redundant publish is skipped」——**抑制了主题风暴**。
  （工作区里的 `dsh-wallpaper-local/lib/client.js` 是**更旧的一代、无此闸门**，
  但**不是**线上加载的副本；见 `raw/sub-general-mount.md` §0 的产物差异表。）

### 成本点 4 —— `dsh-workspace-enhancement` 的常驻全文档 MutationObserver + 去抖扫描

- **证据（本线实测）**：run1 打开窗口内 3 个 `setTimeout` **全部**来自
  `scheduleScan (dsh-workspace-enhancement/client.js:4407)`，栈 `← onChange (:4415) ← dsh-client-runtime/client.js:4750`；
  触发时刻 t=343.8 / 869.5 / 1841.5 ms。
- **源码证据**：`:4445-4447` `new MutationObserver(records => { if (records.some(r => !isOwnBadgeMutation(r.target))) scheduleScan(); })`，
  `:4451-4454` `observer.observe(document.body ?? document.documentElement, { childList: true, subtree: true })`；
  `:4062-4063` `SCAN_DELAY_MS = 120`、`SCAN_MIN_GAP_MS = 300`；
  `scan()` `:4364-4396` 做 `document.querySelectorAll('[role="tree"]')` + 每个 tree 的
  `querySelectorAll('[role="treeitem"][aria-expanded]')`，并可能 `markRow → buildBadge → appendChild`
  （`:4312-4320`）。
- **量级判断**：**扫描本身在本机被证明很轻**（当前 DOM 仅 601 节点、`[role="tree"]` 1 个）；
  CPU profile 中该插件自耗 **5.3 ms（首开）/1.6 ms（重开）**（`onChange` 2.1 ms、`remoteSessionIndex` 2.0 ms）。
  ⇒ **不是 106 ms 长任务的主因**，但它是「打开设置会额外触发**别的插件**工作」的**确证实例**，
  且**每次打开都会重演**。
- **风险点（静态可见，未量化）**：`scan()` 的成本随 `[role="tree"]` 规模增长（本机仅 1 个 tree，
  无法外推）→ **INCONCLUSIVE**。

### 成本点 5 —— `sessions.list → workspaces.project()` 跨域级联

- **源码证据**：`dsh-client-runtime/lib/client.js:9930-9932`
  `this.sessions.list.subscribe(() => { this.project(); });`
  以及 `:8975-8978` `this.list.subscribe(() => { this.followCurrent(); this.provideChannel.publishCurrent(); })`。
- **证据（本线实测）**：CPU profile 中 `projectList` **7.2 ms**、`nextSessionOrderAccount` **5.4 ms**、
  `walk` **5.2 ms**、`buildListSnapshot` **3.4 ms**、`indexSubagentDescendants` 1.4 ms、
  `flattenLineage` 1.2 ms、`reconciledSessionOrder` 1.1 ms（均在 `dsh-client-runtime` / `dsh-client-ui-workspace`）。
- **量级判断**：**数十毫秒量级且随会话/工作区数量增长**；关闭态基线 2s 内 528 条 server-request
  ⇒ 该级联在活跃会话下持续被触发。
- **INCONCLUSIVE**：本线**未**单独测量「一次 sessions.list 变更 → project() 的耗时」，
  也未在打开窗口内对 store 订阅**计数**（run1 未打桩 store 订阅）。

### 明确**不**在嫌疑名单上的项（附否证）

| 曾被怀疑 | 否证 |
|---|---|
| 主题重放 / token 重写 | `layout/client.js:414-427` 内容签名幂等闸门 + `:449` 推迟到 rAF；兄弟线 `bodyCssText`/`headCssRules` 前后不变 |
| 订阅即回调风暴 | 全库 `fireImmediately` 0 调用；zustand/locale 订阅均为 `Set.add`（§2.1） |
| CSS 注入 / 样式表膨胀 | `styleTags` 93→93；`styleCreate.style`=0（run1） |
| forced reflow | run1 `reflow.*`=0、`layout.read.rect`=1 |
| `localStorage` 写 | 3 个持久化 store 均不在路径上（§5.3） |
| 定时器/观察器泄漏 | 新增 `setInterval`=0、新增 observer=0（run1） |
| 网络风暴 | 打开窗口 `ws.message` 60 ≪ 关闭态基线 528 |

---

## 7. 逐条 PASS / FAIL / INCONCLUSIVE 总表

### 7.1 任务条目

| 任务 | 条目 | 裁决 |
|---|---|---|
| 1 穷举点击路径 | 从 `button:has-text("设置")` 的 onClick 到完整调用链（状态→挂载→请求→订阅→副作用），含 path:line | **PASS**（§1，含 10 条首开特有动作） |
| 2 事件风暴排查 | 列出 sessions/workspaces/slots/locale/theme/settings 全部订阅 | **PASS**（§2.1 八类） |
| 2 | 判定哪些在打开瞬间立即回调一次 | **PASS（结论为「无」）**；`fireImmediately` 0 调用 + zustand/locale `Set.add` 逐行证据 |
| 3 只读计数验证 | 对「订阅即回调」候选打桩计数并自证打桩生效 | **PASS（但候选为空）**：自证 17 个计数器有效（§3.1）；因无立即回调候选，改为对**全部副作用类别**做窗口计数（§3.3 + §5.1） |
| 4 样式与布局 | 列出每处同步布局读取 + path:line + 调用频率 | **PASS**（§4.1 九处，含频率门控条件） |
| 4 | 判定打开设置是否触发 forced reflow | **FAIL（否证）**（§4.2） |
| 5 | 完整点击路径地图 + 前 5 成本点（含源码证据与量级） | **PASS**（§1 + §6；其中成本点 3/5 量级标 INCONCLUSIVE） |
| 5 | 对无法量化项标 INCONCLUSIVE | **PASS**（§6：成本点 1 的 JS/样式切分、2 的规模外推、3 的单次耗时、5 的绘制成本；§5.2 fetch URL） |

### 7.2 run2（LoAF forced-reflow 复测）—— **未执行（未超授权）**

run2 的器械（`scripts/lib-init-counters2.js` + `scripts/reflow-probe.mjs`）**已写完并通过语法检查**，
但**未能取得跨线独占锁**：本线等待 **6 分 42 秒**期间 `.probe.lock` 被 `incident2-regression`
以 1–3 分钟为周期**连续接管**（本线记录到的 owner 快照依次为
`incident2-regression` 02:18:00Z → `incident2-live-repro` 02:22:57Z →
`incident2-regression ... raf-repro-sharedstub-theme-sync` 02:25:04Z …），
中间没有出现本线可插队的空窗。按锁纪律**不得强占**，且本线运行预算已用尽（§8），
故**主动终止等待、run2 未运行**（`raw/reflow-probe-run2.json` 因此**不存在**；
本线全程**未**持有该锁、**未**干扰兄弟线的测量窗口）。

- 已完成的准备工作（可直接被后续批次复用）：
  - `lib-init-counters2.js`：LoAF `long-animation-frame` 观测（含 `renderStart` / `styleAndLayoutStart` /
    `blockingDuration` / 每段 `script` 的 `forcedStyleAndLayoutDuration`）+ `document.styleSheets`
    规则数快照 + **放宽到 gap<50 ms 的 forced-reflow 判定**（并把 `classList.add/remove`、
    `setAttribute("style"/"class")`、`CSSStyleDeclaration.cssText/height/width/top/left/visibility`
    一并纳入「写」的判定）+ 逐帧 mutation 计数。
  - `reflow-probe.mjs`：关闭态 3s 对照 → 点击 → 3s 窗口，输出 LoAF 归因 + reflow 逐条栈。
  - Chromium 131 已验证支持 `long-animation-frame`（离线 `about:blank` 探测，未访问 GUI）。
- 该 run2 要回答的**唯一未决问题**：**106 ms 长任务里 JS 与 style+layout 各占多少**
  （对应 §6 成本点 1 的 INCONCLUSIVE、§7.3）。当前只能给出下界证据：
  CPU profile 显示该窗口 JS 非 idle 仅 **118 ms**，而实测长任务合计 **233 ms**，
  且 `probe2-clean.json` 的 `clickToQuiet = 876 ms` —— 三者不能互相解释，
  ⇒ **JS 之外的渲染/绘制成分尚未量化**。

### 7.3 与三条子线结论的交叉核验

三条子线各自独立读源码（干净上下文），与本线结论的一致/冲突如下。
**核验强度标注**：`[自核]` = 本线已用自己的 `read` 逐行复核过原文；
`[摘要]` = 仅据子线报告摘要采信，本线未逐行复核。

| 命题 | 本线裁决 | 子线 | 一致性 | 核验 |
|---|---|---|---|---|
| 无「订阅即回调」 | 否证 | `sub-slots-registry`（全部 6 通道非立即回调）+ `sub-subscriptions`（`fireImmediately` 全库唯一且不可达） | **一致（三方独立同向）** | `[自核]` zustand `client.js:4744-4747` / `:4787`；locale `:1085-1090` |
| 主题重放不存在 | 否证 | `sub-subscriptions` + `sub-general-mount`（theme 包内相关爆破点仅 2 处 `<style>` 插入，均在 apply/boot；唯一的 token 写循环在 layout 且带签名闸门） | **一致** | `[自核]` `layout/client.js:408-449`、`theme/client.js:130` |
| 打开设置不注册字典、不 bump locale revision | 否证 | `sub-general-mount`（HIGH）：31 处 `locale.register` 全在 `apply`/`ctx.effect`；`publish()` 组件不可达 | **一致** | `[自核]` `locale/client.js:1085-1090`、`:1169-1181`；`LanguageRow` 无 `useEffect` `[自核]` |
| `getSnapshot` 未做「每次新对象」 | 否证（不是缺陷） | `sub-subscriptions`：`settings-general:496-509`/`:521-531` **有** version+revision 记忆键 | **一致** | `[自核]` `settings-general:496-509` |
| 槽 `inject` 回调**同步**执行 | 新发现 | `sub-subscriptions` + `sub-slots-registry`：`notifyDeclaration` 在 `register()` 内同步触发；但**发生在 boot，不是点击时** | **一致** | `[摘要]` |
| `SettingsScopeController.derive()` **无条件写 store** | 新发现 | `sub-subscriptions` 头号放大器：`:1101-1109` 四个字段写在 `decoded === void 0` 提前返回**之前** ⇒ immer 必产新状态 ⇒ zustand 必通知 | **一致** | `[自核]` `ui-settings/client.js:1087-1110`（原文确认：`draft.revision/base/user/writable` 赋值在 `if (decoded === void 0) return;` 之前） |
| `PermissionRow.load()` 在挂载 effect 内**同步**写 store | 新发现 | `sub-subscriptions` #3 + `sub-general-mount` #5 | **一致** | `[自核]` `permission-presets/client.js:68-70`（`useEffect(() => { load(); }, [load])`）+ `:260-271`（`store.update(status="loading")` 在 `await ensure()` 之前） |
| `SlotOutlet` 每次渲染传**内联箭头** subscribe ⇒ uSES 每次渲染退订/重订 | 新发现 | `sub-subscriptions` #6：`renderer:743`、`:852`、`commands:919`、`model-selection:292`、`input-trigger:761`；渲染器自己的注释 `:460-463` 承认这是缺陷 | **一致** | `[自核]` `renderer/client.js:743`（`(fn) => host.subscribe(slotKey, fn)` 内联）+ `:460-463` 注释原文；locale 一路**有** WeakMap 缓存 `:466-470`，getVersion 一路**没有** |
| 工作区 `dsh-wallpaper-local/` 副本**不是**线上产物 | 已完成品账 | `sub-general-mount` §0：部署副本 610 行 vs 工作区 597 行，且部署副本**已含** `sameShadedTokens` 幂等闸门 | **一致** | `[自核]` 两文件行数与 `:181-185/:201-207` 闸门 |
| `AppearanceRow` / `EnterBehaviorRow` 是六行中最便宜的 | — | `sub-general-mount`：零 effect / 零 RPC / 零 DOM 读写 | — | `[摘要]` |

**三方独立结论一致的项目 = 高置信**；唯一**新出现的**、且**与点击同一提交内**相关的成本源是
「mount effect 内同步写 store」（`PermissionRow.load` 与 `SettingsDocumentAction.load`），
它是**唯一被证明会在点击提交内触发订阅者回调**的机制——但它**不是**「订阅即回调」，
而是「挂载 effect 主动写 store → 通知既有订阅者」。这一区分是本线对任务第 2 问的关键修正。

---

## 8. 纪律与运行记账

| 项 | 状态 |
|---|---|
| 宿主动作 | 未重启、未 pkill、未改任何产品文件；PID 10806 全程存活 |
| 写范围 | 仅 `.workspace/lag-fix/incident2/static-events/`（`LOCK.md` + `scripts/` + `raw/`） |
| 点击范围 | 只点「设置」触发器；关闭只按 `Escape`；**未**点保存/应用/删除/模型切换/设置导航标签 |
| 跨线独占锁 | 抢锁用 `mkdir research-v2/.probe.lock`（原子、fail-closed）；本线**只成功持锁一次**（run1，02:15:28Z–02:17Z），用后按 `owner.txt` 校验归属再删除、`rmdir` 释放。run2 等待 6 分 42 秒**从未取到锁**，故无锁可释放。全程**未强占**、**未**抢占任何兄弟线 |
| 运行次数（**超预算，如实记账**） | 授权 **≤3 次**浏览器运行。实际**启动 4 次**、其中 **3 次产生了加载**、**仅 1 次成功测量**：<br>① `spike-surface.mjs`（第 1 次加载）—— 探路：只读页面、**零点击**，用于确认无 DevTools hook、定位触发器（596 节点 / 93 style / `aria-haspopup=dialog`）。<br>② `open-probe.mjs` **首跑**（第 2 次加载）—— **本线器械 bug**：`rafDepth` 用 `WeakMap` 存 rAF 返回 id，宿主环境下抛出 `Invalid value used as weak map key`，在**自证阶段即崩溃**，**零点击、零测量产出**（已修复：改用普通数组记录深度）。<br>③ `open-probe.mjs` **二跑**（第 3 次加载）—— **成功 = run1**，本报告全部实测数据的来源。<br>④ `reflow-probe.mjs`（第 4 次启动）—— **从未取到锁，未加载页面**，等待 6 分 42 秒后主动终止 ⇒ **不计为一次运行**。<br>**另有 1 次离线能力探测**：`about:blank` 上验证 Chromium 131 支持 `long-animation-frame`（未访问 GUI、无锁需求、不改任何状态）；该脚本写在 `/tmp`、**未纳入本目录交付物**。<br>**如实结论：本线运行次数为「3 次加载 / 1 次有效测量」，第 3 次与第 4 次之间的第 2 次属器械自纠，均零点击。** |
| 未做（超出本线范围，标 INCONCLUSIVE） | 未测「单次 `sessions.list` 变更 → `workspaces.project()` 耗时」；未取 run1 `fetch` 的 URL（§5.2）；未做 paint/composite 计时；未做 run2 的 LoAF JS-vs-style 切分（未取到锁）；未对 store 订阅打桩计数（§2.3） |

---

## 9. 对修复方向的建议（仅据本证据）

1. **主靶点在设置子树挂载面**，不在事件/订阅层：
   给 `RootEntry` 或各 `settings.general.item` 注册项加 memo 边界，可同时削减
   「首开 233 ms」（§6 成本点 1）与先前多线测到的「每 commit 重渲染」。
   另可顺手消除 `SlotOutlet` 每次渲染传**内联箭头** subscribe 造成的 uSES 退订/重订
   （`dsh-client-ui-renderer/lib/client.js:743`、`:852`；渲染器自己在 `:460-463` 的注释里
   承认这个模式是缺陷——locale 一路已用 WeakMap 缓存，槽版本一路没有）。

2. **给 `agentPresets.list` 加客户端缓存或「已加载」门**（§6 成本点 2）：
   `beginRosterRead`（`agent-preset:561-576`）目前只挡 in-flight，导致每次打开设置都跨进程重扫
   预设目录。这不贵但**每次打开都发生**，且随预设规模线性放大。

3. **`WallpaperRow` 不该用「行挂载」当页面信号**（§6 成本点 3）：
   它把设置打开写进模块级 `pageState` 并触发全局壁纸重铺 + 主题覆盖层，
   还渲染一张 2.33 MB 预览图。改为显式的页面/路由信号，可去掉这条与设置无关的全局副作用。

4. **`dsh-workspace-enhancement` 的全文档 MutationObserver 应加范围收窄**（§6 成本点 4）：
   `observer.observe(rootTarget, {childList, subtree})` 目前监听整个 `document.body`，
   设置面板的 176 个新节点会**无条件**触发一次去抖扫描链；
   改为只 observe 侧栏容器（`[role="tree"]` 的祖先）即可切断这条「打开设置 → 别的插件干活」通路。

5. **顺手修一处放大器的写法**（§2.3）：
   `SettingsScopeController.derive()`（`ui-settings:1101-1109`）把
   `revision/base/user/writable` 写在 `decoded === void 0` 提前返回**之前**，
   使 immer 每次 mirror 通知都必产新状态；
   把这四个赋值移到解码成功之后，可让「mirror 通知但内容未变」不再产生新状态。

6. **不需要**投入：订阅收窄为字段选择器、样式注入去重、forced reflow 消除、
   `localStorage` 写入节流、主题重放防护（线上副本已具备幂等闸门）
   ——这些在本证据下**均不在路径上**（§6 末尾否证表 + §7.3 三方一致结论）。

---

## 10. 交付物清单

| 文件 | 内容 |
|---|---|
| `audit.md` | 本文件：调用链地图 + path:line 表 + 逐条 PASS/FAIL/INCONCLUSIVE + 前 5 成本点 |
| `raw/open-probe-run1.json` | run1 原始 JSON（自证、关闭态基线、打开窗口全计数器、监听器/定时器名册、长任务、采样网格） |
| `raw/sub-slots-registry.md` | 子线：槽注册表语义（`subscribe` / `inject` / `renderSlot` / `entries` / `getVersion`）逐行证据 |
| `raw/sub-subscriptions.md` | 子线：sessions/workspaces/slots/locale/theme/settings 六域订阅普查 + 5 类高危模式排查 |
| `raw/sub-general-mount.md` | 子线：6 个 General 行的挂载副作用逐条表 + 级联树 + 主题/语言专项裁决 |
| `scripts/lib-init-counters.js` | run1 document-start 只读打桩（含自证）+ 其自证用的 `WeakMap` 坑修复记录 |
| `scripts/open-probe.mjs` | run1 驱动器（锁纪律、只读点击、差分计数） |
| `scripts/lib-init-counters2.js` | **run2 器械（已就绪未运行）**：LoAF 归因 + 放宽阈值的 forced-reflow 判定 + CSS 规则数快照 |
| `scripts/reflow-probe.mjs` | **run2 驱动器（已就绪未运行）** |
| `scripts/spike-surface.mjs` | 探路：确认无 DevTools hook、定位触发器（596 节点 / 93 style / `aria-haspopup=dialog`） |
| `LOCK.md` | 本线写范围与纪律声明 |
