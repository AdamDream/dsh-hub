# w09 · btw（侧边对话）加载卡顿审计

> 用户报告（最高优先级）：**侧边对话（btw）加载时仍有点小卡顿**。
> 本文只写有证据的结论，逐条给 **PASS / FAIL / INCONCLUSIVE**，并显式标注**每条结论的测量覆盖范围**。
> 原始数据：本目录 `raw/*.json`；探针：`probes/*.mjs` + `probes/btw-probe.js`。
> 时间：2026-09-22 14:32–15:10（本地时区）。Chrome 153.0.8010.52（headless，`--force-renderer-accessibility`，视口 2560×1440 / DPR 2）。
> 器械：`probes/btw-probe.js`（`addInitScript` 注入，包 `getComputedStyle` / `getBoundingClientRect` / `fetch` / `WebSocket`，rAF 双时钟 + LoAF + LongTask）+ Playwright/CDP。
> 判据合规：阳性对照为**页内 `setTimeout` 注入**（协议 §五.13）；主判据 LoAF(`duration`)+ 页内 wall-clock rAF 播种窗口（§五.19）；`>50ms` 帧计数仅作相对 KPI。

---

## 〇、结论速览

| # | 结论 | 判决 |
|---|---|---|
| 1 | **btw 没有踩设置弹窗那个坑**：`.drawer` / `.placementRoot` / `.mobileScrim` 全部 **`backdrop-filter: none`**；`backdrop-filter` 在 btw 里**只出现在 `.lightboxMask` 一处**（看图片才渲染，抽屉打开时不在 DOM） | **PASS（坑不存在）** |
| 2 | 抽屉打开相位**无长帧**：LoAF 条目 **0**（全部 non-positive arm），最大 rAF 帧间隔 **17.1 ms**、无一帧 >20 ms、>`50ms` 计数 **0** | **PASS** |
| 3 | **真实来源**：页面**首次**打开抽屉时，一次 `getBoundingClientRect` 的**强制同步布局**要 **25.7–28.2 ms**（≈1.7 个 vsync）；**第 2 次起降到 0.6–1.7 ms** | **PASS（已定位，一次性的）** |
| 4 | 这笔代价**不是 btw 代码写得差**：无类名的等价 DOM 骨架同样要 **14.9 ms**；CSS 只占其中约 11 ms | **PASS** |
| 5 | `useOverlayPlacement` 每次 `measure()` **遍历 DOM 两次**（确定性的重复读取），但单次中位 **0.1 ms / 峰值 0.9 ms** | **PASS（真实缺陷，量级可忽略）** |
| 6 | 打开抽屉**没有重复 RPC**（同一方法不重发）：首次打开是 **3 条互不相同** —— `sideChat/start`（`controller.ts:142`）+ `sideChat/read`（`:174`→`:690`，首次 poll 立即执行）+ `sideChat/listTree`（`SideChatJumpList.tsx:63`）；带图转录另加 **每图 1 条** `readImage`。其中 `listTree` 的结果**首开时用户看不到**（`jumpOpen` 默认 false） | **PASS（无重复）/ FAIL（多余取数）** |
| 7 | **700 ms 空闲轮询会无条件重渲染**（`publish()` 无 revision 去重）；实测 6 s 内 gbcr / DOM 变更增量为 **0**，帧间隔中位 16.7 ms 不变 | **FAIL（缺陷成立）但影响未测出** |
| 8 | 与设置弹窗同窗对照：设置弹窗遮罩已是 `backdrop-filter: none`、面积占比 1.0；打开耗时 **0.1–0.2 ms**（面板常驻，只切显隐） | **PASS（对照成立）** |
| 9 | "预暖 CSS 类" 这一最小修复候选**经 A/B/A 实测无效**（25.4 vs 25.7 ms） | **FAIL（候选被自己否掉）** |
| 10 | 用户体感的那一下小卡顿**是否由本次测到的 26 ms 造成** | **INCONCLUSIVE** |

**一句话**：btw **不是**设置弹窗那个 `backdrop-filter` 坑的重复；它的打开路径在全量器械下**干净**（LoAF 0、帧间隔 ≤17.1 ms），唯一确切的可测代价是**页面首次打开时的一次 ~26 ms 强制布局**；没能在本次仪器条件下把它变成用户可感的"小卡顿"，因此**不给未经验证的最小修复**。

---

## 一、范围与测量覆盖范围（必须先读）

### 1.1 本次**未能**复现"点击 btw 按钮打开抽屉"的完整真实路径

`SideChatDrawer` 只在**当前会话已有侧边会话打开**时渲染：

- `src/client/SideChatDrawer.tsx:40-44` → `visible = state.phase !== 'closed' && state.parentSessionId !== undefined && … && view.visible && view.presentation === 'drawer'`
- `src/client/SideChatDrawer.tsx:58` → `if (!visible) return null`

而 btw 的入口按钮挂在 `conversation.session.header.actions`：

- `src/client/index.ts:46-55`（`id: 'dsh-btw.action'`, `order: 40`）

本次全部 6 次页面加载中，**侧边栏的会话列表为空**（`[class*=sessionRow]` 计数 0，点开 `dsh` 项目行 `aria-expanded` 变 true 但不产出子行），因此**页面上不存在 btw 入口按钮**（`button[aria-label="侧边对话"]` 计数 0，见 `raw/phase-timing.json` → `notes.btwTriggerCount = 0`）。
创建新会话与打开已有会话都无法在只读授权下可靠触发（前者会在共享宿主上真实起一个 agent turn）。

**因此**：本文的核心测量是"抽屉打开相位"的**页面侧成本**用**复刻真实 DOM/CSS 的等价物**测的（下称**复刻臂**），而不是用户点击路径的端到端复刻。

**复刻臂的保真度**（逐条）：
- **类名**：从部署物推导，`lib/client.js` 里 99 个 `SalQ5q_*` 类全部来自 `src/client/side-chat.module.css`，映射规则 `<hash>_<camelName>`（`lib/client.js:944-` 的 `side_chat_module_css_default`）。复刻用真类名。
- **DOM 形状**：`placementRoot` + `safeAreaProbe` + `mobileScrim` + `drawer` + `jumpList` + `header/titleCluster/headerActions` + `parentStatus` + `transcript/emptyState` + `composerArea/composer/textarea/sendButton` + `composerFoot`，33 个节点，挂到 `[data-slot="shell.overlay"]`（与 `SideChatDrawer.tsx:60-94` 同构）。
- **CSS 变量**：复刻写入与 `overlayPlacementStyle()`（`use-overlay-placement.ts:345-354`）同样的 7 个自定义属性。
- **放置几何**：实测抽屉矩形 **443.5 × 891 px**，与 computes 出的 `desiredWidth` 448 / `safeMargin` 12 一致，说明走的是同一条放置分支。
- **路径等价性**：复刻的根同样命中 `root.closest('[data-shell-overlay]')`、`root.closest('[data-slot="shell.overlay"]')`，所以 `geometryElements()`（`use-overlay-placement.ts:126-149`）在两侧看到的元素集合一致。

**复刻臂不覆盖**（诚实清单）：
- **不含 React 协调**（`reconcile`/`commit`/`useSyncExternalStore` 通知链）。→ 因此设置弹窗臂（组件树全真）作为**上界对照**。
- **不含 `MutationObserver` / `ResizeObserver` 的注册与首次回调**（`use-overlay-placement.ts:267-323`）。注册本身是 O(1)。
- **不含真实 `controller.open()` 的 RPC 往返**（另有静态专测，见 §三.3；真实耗时未测）。
- **不含合成器/光栅**：headless Chrome 无 GPU 合成，**本线无法测"painting / 180 ms `drawer-in` 动画是否真的每帧上屏"**。本线只能证明**主线程**在打开相位不阻塞、rAF 帧间隔稳定在 16.7 ms（中位）/ ≤17.1 ms（最大）。这与已知边界一致：有头 Chromium 在本机 100% 启不来（`incident2/VERDICT.md` §三.4）。
- **由此得到的一个下界**：真实 React 协调只会**加**在复刻臂之上，而首开那次 ~26 ms 的强制布局落在**同一帧内**且不可被 React 抵消 ⇒ **真实首开在主线程上的阻塞下界 ≥ 26 ms**（见 §五.3）。

### 1.2 系统状态

- 锁：**未强占**。全程 `.probe.lock` 由兄弟线 `w07-streaming` 持有（`owner_pid 768958`，`liveness: ALIVE`）。本线按协议 §五.2 记 `concurrent-annotated` 并发运行，判据只用**同 rep 相邻配对**（`btw_*` / `set_*` / `idle` 在同一轮内背靠背）。
- 并发普查（按协议 §五.18 用 **cmdline** 口径，非 `readlink(exe)`）见 `raw/phase-timing.json`（本批数据采集时未写入该字段，改用下节的阳性对照自证通道健康）。
- **通道自证**：阳性对照（页内 `setTimeout` 里 120 ms 忙循环）在**每一个** positive arm 上都被 **LoAF（120.4–126.9 ms）+ LongTask（120 ms）+ rAF 帧间隔（126.5–130.3 ms）**三通道同时抓到；阴性对照（idle、neg）全部为 0。
  → 仪器**没有失明**；下文所有"0 条 LoAF / 帧间隔正常"是**有效阴性证据**。

---

## 二、① 打开 btw 抽屉的时间线（逐段 + file:line）

### 2.1 静态路径（代码层，`file:line`）

```
点击  SideChatButton.tsx:35              onClick={() => presentation.toggle(parentSessionId)}
  →   presentation.tsx:131-137           toggle(): viewStore.get().visible ? minimize : show
  →   presentation.tsx:114-129           show(): viewStore.show(parent, 'drawer')
                                          + controller.open(parent, …)
  →   controller.ts:126-195              open():
        controller.ts:132                  restoreExisting(parent)  ← 有 park 则走这条
        controller.ts:135-139              chatToken = randomUUID(); publish(startingState)
        controller.ts:142                  await this.remote.start({ parentSessionId, chatToken })   ← 首开唯一 RPC
        controller.ts:172                  publish(openState)                                        ← 触发抽屉挂载
  →   SideChatDrawer.tsx:33-45           useSyncExternalStore(controller) + useSyncExternalStore(viewStore)
                                          → visible 由 false 变 true
  →   SideChatDrawer.tsx:58-95           渲染 placementRoot / safeAreaProbe / mobileScrim / drawer / Surface
  →   use-overlay-placement.ts:254-340   useLayoutEffect → schedule() → rAF(measure)
```

### 2.2 实测时间线（复刻臂，6 轮 × 每轮 4 次打开，`raw/phase-timing.json` + `raw/trace-layout.json`）

单位 ms，值为中位/范围：

| 段 | 起点 → 终点 | 时长 | 归属 file:line |
|---|---|---|---|
| **① 点击 → DOM 出现** | `CLICK` → 抽屉根挂载 | **0.2–0.5** | `SideChatDrawer.tsx:60-95`（React 提交） |
| **② DOM → 内容就绪（首帧可见）** | 挂载 → 下一个 rAF | **17.1–17.3**（1 个 vsync） | 浏览器帧调度，非 btw 代码 |
| **③ 内容就绪 → 放置测量完成** | rAF → `measure()` 结束 | **1.3–2.1** | `use-overlay-placement.ts:286-296` |
| **④ 其中：`geometryElements()` 两次遍历** | 每次 measure 内 | 中位 **0.1**（峰值 **0.9**） | `use-overlay-placement.ts:269-284` + `:290` |
| **⑤ 页面首次打开的那一下强制布局** | 首次 `getBoundingClientRect(drawer)` | **25.7 / 28.0 / 28.2 / 26.4 / 26.1 / 30.6** | 见 §三 |
| **⑥ 同一页面后续打开的同一步** | 第 2–6 次 | **0.6–1.7** | 同上 |

**关键区分（必须一起读）**：
- **⑤ 是一次性的**：`raw/phase-timing.json` 的 `forcedSummary.gbcrWorst` 排序后只有一条大值（28.2 ms，`el: aside.SalQ5q_drawer`），其余同元素全部 ≤1.7 ms。
- **② 是每个 vsync 本来就要付的**：阴性对照窗口（`idle_*`、没有任何打开）帧间隔中位也是 16.7 ms、最大 16.8–17.1 ms。
- **③④ 每帧都付，但可忽略**。

---

## 三、② 强制重算 / 强制布局 / 全视口模糊 / 重复 RPC 打桩结果

### 3.1 强制重算与强制布局

**桩**：`probes/btw-probe.js` 包 `window.getComputedStyle` 与 `Element.prototype.getBoundingClientRect`，逐次记录耗时 + 调用点指纹（首个非探针栈帧）。

实测（`raw/phase-timing.json` → `forcedSummary`）：

| 指标 | 值 |
|---|---|
| `getComputedStyle` 总次数 / 总耗时 | 1080 / **4.3 ms**（调用点：`unknown` 1080 次 + `ThemePresenter.refreshThemeColor` 2 次） |
| 单次 `getComputedStyle` 最大 | **0.1 ms** |
| `getBoundingClientRect` 最大单次 | **28.2 ms**（`aside.SalQ5q_drawer`，页面首次） |
| `getBoundingClientRect` 第 2 大起 | **≤1.7 ms** |
| 结论 | **不存在"写后读"交替的强制重排循环**；只有**页面首次**的一次性强制布局 |

**逐条定性**：
- `use-overlay-placement.ts:48-57` `positiveRect()` 是 **`getBoundingClientRect()` 之后紧跟 `getComputedStyle()`** —— 经典的"读-读"组合。但两者都不写样式，所以不会互相触发重排；实测单次成本 ≤0.1 ms。
- `use-overlay-placement.ts:269-284` `observeCurrentElements()` 调 `geometryElements()`，`:290` 又调一次 `collectOverlayGeometry()` → 后者内部（`:176`）**再调一次 `geometryElements()`**。
  → **每次 `measure()` 确定性地遍历 DOM 两次**（两次 `closest`、两次 `frame.children` 扫描、两次 `:scope > [data-pane=…]` 查询、两次对每个 avoid selector 的 `document.querySelectorAll`、两次 `[...slotHost.children].filter`）。
  → 其中还有一段**无效工作**：`:269` 的返回值只用于 `initial`（在 `:298` 使用），**在 `measure()` 里返回值被直接丢弃**（`:289` 不接收），所以 `measure()` 的第一次遍历唯一作用是补注册 ResizeObserver 目标。
- `pointerEvents` 读取（`:152`）只对"占满 frame 的穿透 sibling"发生，实测 `nSiblings` 在真实 shell 里为 0–1。
- 复刻臂实测 `measure()`：**中位 0.1 ms、p95 0.1 ms、峰值 0.9 ms**（20 次连续调用，`raw/phase-timing.json` → `arms[*].measureMedianMs/measureMaxMs`）。

判决：**⑤ 强制布局存在但只发生一次；③④ 每次 measure 的重复遍历是真实缺陷、量级可忽略**。

### 3.2 全视口模糊 / 遮罩

**桩**：把 btw 的 99 个 `SalQ5q_*` 类逐一实例化，读回 `getComputedStyle(el).backdropFilter` / `.filter`（`raw/phase-timing.json` → `staticFindings.perClass`）。

| 选择器 | `backdrop-filter` | `filter` | 出处 |
|---|---|---|---|
| `.placementRoot` | **none** | none | `side-chat.module.css:13-17` |
| `.safeAreaProbe` | **none** | none | `side-chat.module.css:19-29` |
| `.mobileScrim` | **none** | none | `side-chat.module.css:31-39` |
| `.drawer` | **none** | none | `side-chat.module.css:40-59` |
| `.transcript` / `.composerArea` / `.drawerHeader` / … | **none** | none | — |
| **`.lightboxMask`** | **`blur(2px)`** | none | **`side-chat.module.css:516-521`** |

- `--dsw-mask-blur` = **`blur(2px)`**（主题插件定义），btw 的**唯一消费者就是 `.lightboxMask`**。
- `.lightboxMask` 只在**点开图片**时渲染：`SideChatSurface.tsx:661-671` `{lightbox !== null && (<ImageLightbox …/>)}`。
  → **抽屉打开时它不在 DOM**。**与设置弹窗不是同一个坑。**
- 全视口遮罩 `.mobileScrim`（`inset:0`, `background: rgb(5 7 8 / 54%)`, `side-chat.module.css:31-39`）只在 `max-width: 720px` 且 `data-placement-mode="bottom-sheet"` 时 `display:block`（`:563-566`）。**实测视口 2560×1440 CSS px（DPR 2）→ `matchMedia('(max-width:720px)') = false`，`getComputedStyle(.mobileScrim).display = "none"`**。用户桌面是 3840×2160 接 150% 分数缩放（`incident2/VERDICT.md` §一②），CSS 宽约 2560 px ⇒ **1920px 也不触发，更不触发**。
- 全页现存 `backdrop-filter !== none` 的元素数 = **0**（`raw/campaign-6rep.json` → `staticFindings.existingBlurConsumers = []`；`raw/phase-timing.json` 同向）。
  → 反向确认协调者落地的设置弹窗遮罩修复**确实生效**：`.VOzbGW_mask` 实测 `backdrop-filter: none`、`background: rgba(0,0,0,0.24)`、面积占比 **1.0**。

### 3.3 重复 RPC

**桩**：包 `window.fetch` 与 `WebSocket.prototype.send`（记录 URL/耗时/状态/调用点栈帧）。

**代码层**（`controller.ts` + `SideChatJumpList.tsx`）：
- **首开（该 parent 无 park）**：`open()` → `:132 restoreExisting()` 返回 false → `:142 remote.start(...)` → `:174 poll(epoch)`。
- **重开（该 parent 有 park）**：`:594-598` 命中 `restoringByParent` → `publish(restoringState)` **立即渲染**，然后 `confirmRestore()`（`:623-640`）→ `:628 remote.read({chatToken})`。
- ⚠️ **打开相位不是 1 条 RPC，而是 3 条** —— 本线自查更正（原稿写 1，后改 2，**经独立复核档更正为 3**）：
  1. `@local/dsh-btw#sideChat/start`（`controller.ts:142`）
  2. `@local/dsh-btw#sideChat/read`（`controller.ts:174` → `poll(epoch)` → `controller.ts:690`；**首次 `poll` 立即执行，不是等 700 ms**）
  3. `@local/dsh-btw#sideChat/listTree`（`SideChatJumpList.tsx:63` → `controller.ts:368`）—— **用户看不到结果**：
     `SideChatDrawer.tsx:77-82` **无条件渲染** `<SideChatJumpList>`，其取数 `useEffect`（`SideChatJumpList.tsx:58-75`）依赖
     `[controller, parentSessionId, tab]`，**不含 `view.jumpOpen`**；而 `view.jumpOpen` 默认 `false`（`view-store.ts:22-29`），
     列表体（`SideChatJumpList.tsx:107` `{view.jumpOpen && (…)}`）**首开时隐藏**。
  4. 另有 **每张未缓存图片 1 条** `readImage`（`SideChatSurface.tsx:279-313` → `:296` → `controller.ts:351`）：首开带图转录时 RPC 数 = 3 + N。
  `listTree` / `listProject` 结果**按 parent 缓存**（`controller.ts:362-366` / `:384-385`），所以只有**首次**真正发往宿主。
  注意缓存键用的是 `currentSessionId()`（`controller.ts:362`），且每次 `sessions.list` 变化都会清空（`controller.ts:561-562`）。
- **RPC 总表**（部署物 `lib/remote-descriptors-D37stQ5y.js`，模板 `src/remote-descriptors.ts:15,26` = `@local/dsh-btw#sideChat/<method>`）：
  `start, read, send, answer, cancel, close, setModel, readImage, listTree, listProject` —— **共 10 个方法**。
  ⚠️ **这些 id 是模板拼出来的**（`${PACKAGE}#sideChat/${method}`），**在部署物里 grep 完整 id 查不到** —— 本线的 `rpc-identity` 探针第一版就栽在这个坑上（`wireId: "(template)"`），复核档独立命中同一坑。
- **客户端调用点计数**（`probes/rpc-identity.mjs` 源码扫描）：
  `start`×1（`controller.ts:142`）、`read`×2（`controller.ts:628`、`controller.ts:690`）、`send`×2、`answer`×2、`cancel`×2、`setModel`×2、`readImage`×2、`listTree`×1（`controller.ts:368`）、`listProject`×1（`controller.ts:387`）、`close`×3。

判决：**不存在"同一方法重复发"的重复 RPC**；但存在**首开时多余的取数**（`listTree` 结果不可见）。
**未实测**：这些 RPC 的真实往返耗时（需要活跃会话；复刻臂无 controller）。`incident2` 已确证宿主是单线程、宿主级停顿才是 0.3–0.8 s 量级卡顿的唯一来源（`incident2/VERDICT.md` §一③ D3），所以这三条往返的**宿主侧成本是本次唯一没能覆盖、且量级可能最大的未知项**。

### 3.4 打开之后：700 ms 空闲轮询会无条件重渲染【FAIL】

- `controller.ts:688` `let delay = 700`
- `controller.ts:723` `delay = running ? 220 : 700`
- `controller.ts:746` `this.pollTimer = setTimeout(() => { void this.poll(epoch) }, delay)`
- `controller.ts:799-802` `publish(next)`：**`this.state = Object.freeze(next); for (const listener of this.listeners) listener()`** —— **没有按 `revision` 去重**。

⇒ 即使 `read` 返回的 `revision` 与上次相同，每次轮询都会新建 state 对象并通知所有订阅者，而 `SideChatDrawer.tsx:33` / `SideChatSurface.tsx:235` 都用 `useSyncExternalStore` 直接以该对象为快照 ⇒ **每个 700 ms 触发一次 React 重渲染**（`SideChatSurface` 消息渲染在 `:517` `messages.map(...)`，**无 `useMemo`**）。

**但影响未测出**（阴性）：
- 复刻臂稳态 6 s：`gbcr` 增量 **0**、`mut` 增量 **0**、`gcs` 增量 **0**（`raw/rpc-identity.json` → `noDrawer` vs `withDrawerReplica`）。
- 帧间隔中位 **16.7 ms 不变**；>`20 ms` 帧 4 → 9（计数差落在噪声内，且 `>50ms` 计数两侧均 0）。

判决：**机制成立（FAIL），但本轮没有任何帧级证据表明它造成用户可感卡顿**。不允许把它当成"小卡顿"的已证来源。

---

## 四、③ 与设置弹窗同窗对照（同一器械、同一判据）

同一页面、同一 `btw-probe.js`、同一 rAF/LoAF/LongTask 通道、同一轮内背靠背：

| 指标 | btw 复刻臂（plain） | 设置弹窗（真实触发） | 对照解读 |
|---|---|---|---|
| 打开耗时（点击→就绪） | 0.5 ms（DOM）+ 17.1 ms（首帧）| **0.1–0.2 ms** | 设置面板常驻，点击只切显隐；btw 是真实挂载 |
| 首帧 | 17.3 ms（1 vsync） | 不适用（无挂载） | — |
| 遮罩 `backdrop-filter` | **none**（抽屉本身无遮罩层） | **none**（已修） | **两者都不踩坑** |
| 遮罩面积占比 | 0（`.mobileScrim` 未显示） | **1.0**（全视口） | 设置弹窗仍有全视口遮罩，只是不再模糊 |
| LoAF 条目 | **0** | **0** | 一致 |
| LongTask 条目 | **0** | **0** | 一致 |
| 帧间隔中位 / 最大 | 16.7 / **16.9–17.0** | 16.7 / **16.8–17.0** | 一致 |
| `>50ms` 帧 | **0** | **0** | 一致 |
| 阳性对照（页内 120 ms） | LoAF 123.5–126.9 / LongTask 120 / 帧 126.6–130.3 | LoAF 123.5–127.8 / LongTask 120 / 帧 127.3–130.3 | **两臂通道均灵敏** |
| 阴性对照（idle） | LoAF 0 / LongTask 0 / 帧最大 16.8–17.1 | 同 | — |

**结论**：在"打开相"这个判据下，**btw 抽屉与设置弹窗处于同一水平** —— 都不产生长帧。设置弹窗此前的问题（`backdrop-filter`）在 btw 里**载体不存在**。

---

## 五、④ 最小修复候选

### 5.1 候选 A（曾以为是答案）——"预暖抽屉的 CSS 类"：**已实测否决** ❌

**想法**：既然首开贵在样式解析，就在插件安装时用一个带全部 `SalQ5q_*` 类的游离元素把样式烘焙进缓存，之后丢弃。

**实测（`probes/prewarm-ab.mjs`，A/B/A、两个顺序各 4 次、每次全新页面，`raw/prewarm-ab.json`）**：

| 顺序 | 首次打开 `geomMs` 中位 | 后续打开中位 | 预暖自身成本 |
|---|---|---|---|
| 不预暖 | **25.7** | 1.4 | — |
| 先预暖 | **25.4** | 1.4 | 0.8 |

⇒ **无差异（25.4 vs 25.7 ms）**。原因已定位：这笔花费**不是类匹配**，而是**子树在最终位置上的首次布局**——
对照实验（同一页面、同一器械）：

| 插入对象 | 插入耗时 | 首次布局耗时 |
|---|---|---|
| 裸 `<div>` | 0.0 ms | **0.4 ms** |
| **无类名的 28 节点骨架** | 0.4 ms | **14.9 ms** |
| 带全部真类名的 33 节点抽屉 | 0.3 ms | **26–31 ms** |

⇒ **14.9 ms 来自结构本身，约 11 ms 来自 CSS**；而结构成本无法通过"预暖样式"消除。
**这是本线自己推翻的候选，不作为交付。**

### 5.2 候选 B（可秒回滚）——`useOverlayPlacement` 消除每次 measure 的重复遍历

**改动**（`src/client/use-overlay-placement.ts`）：`measure()` 里做一次 `geometryElements()` 并把结果同时用于注册观察者与计算几何，删除 `collectOverlayGeometry()` 内部的第二次 `geometryElements()`（`:176`）。

**验收标准**：
1. `measure()` 内 `document.querySelectorAll` 调用次数**减半**（当前对每个 avoid selector 调 1 次 × 2 遍 = 2 次/selector/measure）；
2. 打开相 **LoAF = 0**、帧间隔上限 **≤20 ms**（当前 17.1 ms，预算充裕）；
3. 放置结果逐像素不变：同一视口下 `--side-chat-left/top/width/height` 完全一致（复刻臂已给出基线 `443.5 × 891`）；
4. 回滚 = 还原该文件（纯内部重构，无 API/样式变更）。

**诚实预期**：收益 **≤0.1 ms/次**（实测 measure 中位 0.1 ms）。**它不能让用户感到差别**，只能消除一个确定的冗余。不建议作为"解决小卡顿"的方案单独上报。

### 5.3 候选 C（唯一的量级项，但风险最高，仅作候选）——把首开的强制布局从帧内移出

`useOverlayPlacement` 的 `measure()` 在 rAF 里，而它**不读抽屉自己的几何**（只读 `overlay` / `frame` / panes / siblings / avoid）。首开的 26 ms 实际上来自：**rAF 帧里 `drawer` 子树的首次布局被 `getBoundingClientRect` 提前同步化**。

- 若把 `schedule()` 从 `requestAnimationFrame(measure)` 改为 `requestIdleCallback(measure, {timeout: 100})`，首帧可以只渲染不测量；26 ms 会被挪到空闲回调里（或被浏览器自行分帧）。
- **代价**：`useLayoutEffect` 的同步语义丢失——首帧可能用 `fallbackPlacement()`（`use-overlay-placement.ts:216-229`，整视口宽）渲染一次，然后跳到正确位置 ⇒ **观感会变（一次跳位）**，直接违反"观感不变"的验收标准。
- ⇒ **不作为交付**，仅登记为"若要真正削掉首开峰值，只有把测量搬出帧内，代价是首帧可能跳位"。

### 5.4 候选 D（低风险）——把跳转列表的取数改成懒加载

**问题**：`SideChatJumpList.tsx:59-77` 的取数 effect 依赖 `[controller, parentSessionId, tab]`，**不含 `view.jumpOpen`**；而 `view.jumpOpen` 默认 `false`（`view-store.ts:28`），列表体 `SideChatJumpList.tsx:108` 是 `{view.jumpOpen && (…)}`。⇒ 首开必然发一条**结果不可见**的 `sideChat/listTree`。

**改动**：在 effect 首行加 `if (!view.jumpOpen) return`，并把 `view.jumpOpen` 加入依赖数组。

**验收标准**：
1. 首开（未展开跳转列表）时**只发 1 条** RPC（`sideChat/start`）——用 §三.3 的 `fetch`/WS 桩验证：
   **页内 `WebSocket.prototype.send` 记录中，`sideChat/listTree` 在首开窗口内出现次数 = 0**；
2. 展开跳转列表后 `listTree` **照常发出**且列表正常渲染（回归）；
3. `tab` 切换到 `project` 后 `listProject` 照发（回归）；
4. 观感不变：跳转列表的展开/收起行为、`aria-expanded`、空/加载/错误三态完全一致；
5. 回滚 = 还原该两行。

**诚实预期**：这条**不在主线程**上省时间（省的是宿主一次 RPC + 一次往返）。宿主是单线程的，`incident2` 已确证宿主级停顿是唯一能造成 0.3–0.8 s 量级卡顿的东西（`incident2/VERDICT.md` §一③ D3），所以**这条值得上报，但本线没有测它的宿主侧耗时**，不宣称它是"小卡顿"的来源。

### 5.5 用户可自行执行的零风险动作（可选）

若想验证"26 ms 首开"是否就是他感到的那一下：**同一个会话里关掉再开一次侧边对话**。
- 第 1 次：会付 26 ms（≈1.7 vsync）。
- 第 2 次起：1–2 ms。
- 若体感差异明显 ⇒ 主因就是首开这一下；若两次一样 ⇒ **26 ms 不是他感到的东西**，需要另找（此时应优先查 `incident2` 已确证的 Firefox 强制 a11y ×1.86 与核显 150% 缩放这两条环境放大器）。

---

## 六、PASS / FAIL / INCONCLUSIVE 清单

| 判据 | 结果 | 证据 |
|---|---|---|
| ① 打开抽屉时间线逐段给出时长与归属 | **PASS** | §二，`raw/phase-timing.json`、`raw/trace-layout.json` |
| ① btw 遮罩/抽屉是否用 `backdrop-filter` | **PASS（否）** | §三.2，`side-chat.module.css:13/31/40/516`，`raw/phase-timing.json.staticFindings.perClass` |
| ① 全视口模糊是否存在 | **PASS（否）** | `.lightboxMask` 唯一，`SideChatSurface.tsx:661` 条件渲染；现存 blur 消费者 0 |
| ① 流式首块开销 | **INCONCLUSIVE** | 需要活跃会话；本轮无会话，未测 |
| ② 强制重算 `getComputedStyle` | **PASS（无毒）** | 1080 次 / 4.3 ms 总，单次 ≤0.1 ms |
| ② 强制布局（写后读） | **PASS（已隔离）** | 仅页面首次 26–31 ms；之后 ≤1.7 ms |
| ② `measure()` 重复遍历 | **FAIL（缺陷成立）** | `use-overlay-placement.ts:270` vs `:290` → `:176` |
| ② 重复 RPC | **PASS（无重复）/ FAIL（1 条首开多余换取）** | §三.3；打开相位恰 2 条，互不相同 |
| ② 700 ms 轮询无去重 | **FAIL（缺陷成立，影响未测出）** | `controller.ts:746,799-802` |
| ③ 与设置弹窗同窗同器械对照 | **PASS** | §四 |
| ④ 最小修复候选（含量化验收 + 秒回滚） | **FAIL（候选 A 被实测否决）** | §五.1 `raw/prewarm-ab.json` |
| ④ 验收标准"打开相 LoAF≈0 且帧间隔上限 ≤20 ms" | **当前已满足** | LoAF 0；帧间隔上限 17.1 ms（btw），16.8–17.0 ms（设置） |
| 观感不变 | **PASS（无改动落地）** | 本线未改动任何产品文件 |
| 可秒回滚 | **PASS（无改动）** | 同上 |

---

## 七、交付物

| 文件 | 内容 |
|---|---|
| `audit.md` | 本文 |
| `raw/phase-timing.json` | 主战役：6 轮 × 5 臂（btw / 设置 × plain/pos/neg + idle），逐段时长、measure 20 次分布、逐帧序列、静态 CSS 读回、LoAF/LongTask、强制读/写计数 |
| `raw/phase-page-*.json` | 上面对应的页内原始序列（rAF 双时钟、LoAF、LongTask、gcs/gbcr 逐次、fetch/ws 逐条） |
| `raw/trace-layout.json` | CDP trace：13 × `UpdateLayoutTree` / 13 × `Layout` / 401 × `RunTask` / 25 × `Paint`，以及页内 6 次打开的 `geomMs` 序列 |
| `raw/campaign-6rep.json` | 第一版战役（含 `staticFindings.existingBlurConsumers = []`） |
| `raw/prewarm-ab.json` | 候选 A 的 A/B/A 实测（否决证据） |
| `raw/rpc-identity.json` | RPC 方法表、调用点清单、轮询代码行、稳态 6 s 增量 |
| `raw/btw-client-deployed.js` | 被测部署物（md5 `73e90a5cb2f292e7853a440bea3a84de`，与 `dsh-btw/lib/client.js` 及 `~/.dsh/profiles/node_modules/@local/dsh-btw/lib/client.js` **三者一致**） |
| `raw/discover.json` | GUI 侦察（证明本批会话列表为空、btw 入口按钮不存在） |
| `probes/*.mjs`, `probes/btw-probe.js`, `probes/lock-keeper.mjs` | 全部探针，可重跑 |
| `shots/` | `state-default.png`（boot 态）、`state-loaded.png`、`sidebar-state.png`、`discover.png`、`after-session.png` |
| `verify/verify-notes.md` | 独立对抗复核（二级 subagent，干净上下文） |

**未改动任何产品文件**（只读审计）。唯一被写的目录是本线独占的 `.workspace/lag-fix/program/w09-btw-load/`。
