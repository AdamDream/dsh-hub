# W24 · 三栏 shell 与响应式审计（布局 store 写入面 / 三段拖拽手柄 / 断点 / 焦点与层级）

> **范围**：三栏 shell（`dsh-client-ui-layout`）与响应式行为。
> **授权**：只读。**未改动任何产品文件、未写用户 profile、未重启/触碰用户浏览器（宿主 pid 2988915 未动）**。
> **产物**：本文 + `raw/*.json`（47 个）+ `evidence/*.png`（19 张）+ `section-02-handles-static.md`（二级子代理静态档）+ `raw/focus-zindex-static.json`。
> **纪律**：判据一律同窗对照 / 比值 / 计数；绝对 ms 一律标注并发条件；每条结论带 `file:line`；逐条 PASS/FAIL/INCONCLUSIVE。

---

## 0. 口径、版本锚点与仪器自证

### 0.1 部署根与版本锚点（本次实测核对，非引用）

| 项 | 值 | 核对方式 |
|---|---|---|
| GUI / 宿主 | `http://127.0.0.1:3080`，宿主 pid **2988915**（旧 301709 已退出，本线在重启后重跑） | `curl` 200 + `/proc/2988915` 存在 |
| 本线唯一权威产物 | `$H/dsh-client-ui-layout/lib/client.js`，**md5 `ed91f7f345cb91c87a941088fc5dba71`，907 行** | served `/plugins/@deepseek-ai/dsh-client-ui-layout/client.js` md5 **与服务端同值** |
| `$H` | `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai` | 遍历 `/proc/*/cmdline` 得宿主 `node .../bin/dsh web`，profile 软链指向该树 |
| 已落地的新层 | **`U-A11Y1:v1` 焦点层，源文件 `:566-901`（纯增量，`:1-564` 行号仍然有效）**；运行时守卫 `window.__dshA11yOverlayLayer.version` 实测回读 `"U-A11Y1:v1"` | `raw/w24-recon.json`、`raw/w24c-run.json` |
| btw 抽屉 | served = profile = md5 **`6b3245b994574bde79e82cbac87324a7`** / 335,993 B；仓库候选 R2 = `ca6cc0ec…` / 361,651 B；**served 字节内 `col-resize` 命中 0** ⇒ **R2 未部署，服务中抽屉无手柄** | 本线 `curl` + md5；子代理独立 sha256 复核一致 |
| `[data-slot]` 面积为 0 | 属正常（`display:contents`），不是缺陷 | 本线 `shellControls` 探针 |

### 0.1bis 构建冻结自证（四次运行可比性的前提）

其他线在本轮持续落地改动，因此**必须证明我的四次运行跑在同一份产物上**。实测各相关产物的 mtime 与我的运行时刻：

| 产物 | mtime | 我的运行时刻（本地） |
|---|---|---|
| `dsh-client-ui-layout/lib/client.js` | **18:08:52** | w24 **18:38:33** |
| `dsh-client-runtime/lib/client.js` | 18:08:53 | w24b **18:42:47** |
| `dsh-web-frontend/dist/assets/index-ClqxG24t.js` | 18:09:30 | w24c **18:46:32** |
| `dsh-client-ui-conversation/lib/client.js` | 18:12:54 | w24d **18:52:24** |
| `dsh-client-ui-renderer/lib/client.js` | 18:30:56 | — |
| `dsh-client-ui-settings-general/lib/client.js` | 16:39:07 | — |

⇒ **全部相关产物最后一次修改都早于我的首次运行 ⇒ 四次运行跑在冻结的同一构建上**，跨运行比较有效。运行期间 `layout` md5 全程恒为 `ed91f7f3…`（首末各核一次）。
> 另：本线**唯一的写入**全部落在 `program/w24-shell/` 内（`tools/`、`raw/`、`evidence/`、`audit.md`、两份子代理 `section-*.md`）。产品树与用户 profile 的改动**来自其他线**，不是本线；本线对 `dsh-client-ui-layout` 等**未做任何写入**。
> 引用复核：本线读到的 `renderer` 行号（`:107/:116` 自定义 `eq` 短路、`:154` `bindSnapshotSelector`、`:281-298` `boundRenderSlot` 无 key 派生）已在 18:30 之后的构建上**逐行复验**，仍然成立。

### 0.2 引擎与 DPR 自证（协议 §五.10 / §五.9）

```
UA: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko)
    HeadlessChrome/131.0.6778.33 Safari/537.36
devicePixelRatio 回读 = 1（由本线显式 deviceScaleFactor:1 设定，非人为 flag 产物）
viewport 1280×800 / 900 / 800 / 720 / 640 / 560 / 520（CDP Emulation.setDeviceMetricsOverride，每次窗内重放）
```

> ⚠️ **引擎边界（必须随结论一起读）**：本线用 playwright 1.49.1 自带 **Chromium 131**，**不是**用户浏览器与兄弟线用的 **Chrome 153**。⇒ 本线的**计数类**结论（fiber 渲染数、mount 数、几何、Tab 序、inert 集合）与引擎版本无关，可直接用；**绝对帧时**只作同引擎同窗对照，不得跨线比绝对值。

### 0.3 并发与锁（协议 §五.1–§五.2）

| 运行 | 锁 | 窗口内 foreign | 结论可用性 |
|---|---|---|---|
| `probe-w24.mjs`（首轮） | **BUSY（`w19-slots` 存活，purpose 恰为 "layout write / section switch"）** ⇒ 按协议**照跑并逐窗标 CONTENDED** | `1/1` | 仅作探索；**tier-2 结论不引用** |
| `probe-w24b.mjs` | ACQUIRED | **0/0 全部窗** | 独占，主证据 |
| `probe-w24c.mjs` | ACQUIRED | **0/0 全部窗** | 独占，主证据 |
| `probe-w24d.mjs` | ACQUIRED | 0/0 | 独占，裁决证据 |

census 口径 = **cmdline 含 `--remote-debugging-pipe` 且不含 `--type=`**，并排除本线自己的 user-data-dir（协议 §五.1/§五.18；**不使用 `readlink(/proc/<pid>/exe)`**，该调用在本环境对几乎所有进程返回 EACCES）。

### 0.4 阳性/阴性对照：**首轮失败，已定位并修正**（协议 §五.19①）

| 轮次 | 注入 | rAF 墙钟 max | `>50ms` 帧 | LoAF count/max | 判定 |
|---|---|---|---|---|---|
| w24b（**失败**） | 页内 `setTimeout` 忙等 120 ms，**注入发生在窗内首帧之前** | **18.1 ms** | 0 | 0 / null | ❌ **120 ms 停滞落进窗边界间隙 ⇒ 不可见**（正是 §五.19① 记录的"武装后立即注入 + 丢弃首帧"口径陷阱） |
| w24c（**修正**） | 先播 **4+ 帧**（`framesBefore=669`）再注入 | **132.1 ms** | 1 | **1 / 131 ms** | ✅ 通道确能报出 |
| w24c 阴性对照 `none` | 同长窗不注入 | **17.0 ms** | 0 | 0 / null | ✅ 干净 |
| w24d（复证） | 同上 | **135.8 ms** | 1 | **1 / 135 ms** | ✅ |

⇒ **本报告所有 `over50=0` / `loaf=0` 的观测均建立在"通道已自证"之上**（协议 §五.19⑤ 强制要求）；同时**首轮的绝对帧数一律不引用**。

### 0.5 本线自曝的四处仪器缺陷（已修正；不修正会得到错结论）

| # | 缺陷 | 后果（若不修） | 修正 |
|---|---|---|---|
| **D1** | 阳性对照在窗内首帧之前注入 | 通道被误判为"不灵" | 窗口播种 ≥4 帧后再注入（§0.4） |
| **D2** | 合成遮挡盒 `height:200px` 而探针点在 `y=400` | 会得出"overlay 子元素不遮挡手柄"的**假阴性** | 全高盒 + 显式 `containsProbePoint` 断言 ⇒ 结论**反转**为"遮挡成立" |
| **D3** | CDP viewport override 被 `page.screenshot` 重置（playwright 重放自身 viewport） | `narrow-expand` 窗实际跑在 1280，测出"toggle 无效"**假结论** | 每个窗体内重放 override；并校验窗内 `innerWidth` |
| **D4** | clamp 扫描在回到原点后才采样 | 最小值**从未被观测**（首轮报"atMin=370"） | 在**极值点**采样 ⇒ 实测 **264 / 420** 精确命中 |

> **另有一处通道局限必须声明**：`mounts`（`fiber.alternate === null`）**存在与交互无关的逐提交底座**——`DocumentTitle` 在几乎每次提交都重新挂载（≈1/commit），idle 窗 **175 mounts / 35 commits ≈ 5/commit**。⇒ **mount 数不能单独归因于某次交互**，本报告只把它当"churn 指标"并给出底座，**归因精度 = INCONCLUSIVE**。

---

## 1. ① 布局 store 的写入面（谁写、多频、每次写导致什么重渲染）

### 1.1 机制（代码级确证）

**store 定义**：`$H/dsh-client-ui-layout/lib/client.js:277-308`（下称 `LY`）

```js
function createLayoutStore() {
  return defineStore({
    init: () => ({ sidebar: 280, details: 0, narrow: false, narrowExpanded: false }),
    actions: {
      setSidebar: (d, px) => { d.sidebar = clampWidth(px, 264, 420); },
      setDetails: (d, px) => { d.details = clampWidth(px, 300, 520); },
      toggleSidebar: (d) => { if (d.narrow) d.narrowExpanded = !d.narrowExpanded; else d.sidebar = d.sidebar === 0 ? 280 : 0; },
      setNarrow: (d, narrow) => { if (d.narrow === narrow) return; d.narrow = narrow; d.narrowExpanded = false; },
      openDetails: (d) => { if (d.details === 0) d.details = 360; },
      closeDetails: (d) => { d.details = 0; },
    },
  });
}
```

**引擎**：`$H/dsh-client-runtime/lib/client.js:5397-5427`（下称 `RT`）

```js
function createSnapshotStore(init, opts) {
  const withSelector = subscribeWithSelector(() => init);
  const api = createStore()(withSelector);
  if (opts?.persist) attachPersistence(api, opts.persist.name);
  let subscribe = (fn) => api.subscribe(fn);
  if (opts?.flush === "raf") { /* 本 store 不走这条 */ }
  return { getSnapshot, subscribe,
    update: (mutator) => { api.setState(produce(api.getState(), (draft) => { mutator(draft); }), true); }, ... };
}
```
- **`flush` 缺省 = `"sync"`**（`RT:5387-5391` 注释 + `:5402` 的 `if (opts?.flush === "raf")`）⇒ 本 store **同步通知**，无帧合批。
- `update()` 用 **immer `produce`** ⇒ 每次写产生**新对象引用**（`RT:5419-5421`）。
- 读取端：`LY:159` `const panels = useStore((s) => s);` —— **恒等选择器**，经 `$H/dsh-client-ui-renderer/lib/client.js:154-159` `bindSnapshotSelector` 转发给 `useSyncExternalStoreWithSelector`，**未传 `eq` ⇒ 退回 `Object.is`（`:107/:116`）**。

⇒ **机制链**：`actions.setX()` → `store.update(immer produce)` → 新对象 → zustand `Object.is` 不等 → 同步通知 → `useStore((s)=>s)` 的 `Object.is` 不等 → **`AppFrame` 重渲染** → 它渲染 `renderSlot("sidebar"/"conversation"/"details"/"shell.overlay")`（`LY:228/233/237`）⇒ **整棵三栏子树重算**。

### 1.2 写入者全表（代码级，含频率）

| # | writer | 触发 | 频率 | `file:line` |
|---|---|---|---|---|
| W1 | `setSidebar(px)` ← `onSidebarDrag` | 拖 shell 侧栏手柄 | **每 rAF 一次**（`DragHandle` rAF 节流） | `LY:212-214`、`LY:131-134` |
| W2 | `setDetails(px)` ← `onDetailsDrag` | 拖 shell 详情手柄 | 每 rAF 一次 | `LY:215-217` |
| W3 | `toggleSidebar()` | 侧栏折叠按钮 | 每次点击 | `sidebar/client.js:283-284`（`ctx.layout.toggleSidebar()`）→ `LY:292-295` |
| W4 | `setNarrow(narrow)` | `AppFrame` effect，`narrow = viewport < 1024` | **仅在 `narrow` 翻转时**（ResizeObserver+rAF，`LY:177-193`） | `LY:191-193` |
| W5 | `openDetails()` | 对话区打开详情 | 偶发 | `conversation/client.js:10185` → `LY:301-303` |
| W6 | `closeDetails()` | 对话区关闭详情 **＋ 会话切换时 `AppFrame` 自动关** | 每次切换会话 | `conversation/client.js:10240`、`:7503`；`LY:167-171` |

### 1.3 每次写的真实后果（实测，独占窗）

| 窗（w24b，1280×800，无会话） | 时长 | commits | **AppFrame 渲染** | DragHandle | pw（PerformedWork） | pw/commit | rAF p50 / max | `>50ms` | LoAF max |
|---|---|---|---|---|---|---|---|---|---|
| idle-neg（无写） | 6004 ms | 35 | **0** | 0 | 7479 | 213.7 | 16.7 / 18.5 | 0 | — |
| **drag-sidebar-90px**（30 次移动，+90 px） | 1481 ms | 71 | **32** | **32** | **16674** | 234.8 | 16.7 / 25.0 | 0 | — |
| **drag-sidebar-0px**（阴性对照：按下+抬起，dx=0） | 406 ms | 4 | **2** | 2 | 917 | 229.3 | 16.7 / 17.8 | 0 | — |
| **drag-clamp-sweep**（82 次移动，+480 再 −480） | 2956 ms | 46 | **17** | 17 | 10579 | 230.0 | 16.6 / 23.9 | 0 | — |
| toggle-collapse | 728 ms | 29 | **1** | 0 | 4353 | 150.1 | 16.7 / 22.6 | 0 | — |
| toggle-expand | 735 ms | 9 | **1** | 1 | 1869 | 207.7 | 16.7 / 17.7 | 0 | — |
| breakpoint-1024-down | 1511 ms | 10 | **2** | 0 | 1596 | 159.6 | 16.7 / 20.0 | 0 | — |
| **breakpoint-1024-up**（无写） | 1508 ms | 13 | **0** | 0 | 2903 | 223.3 | 16.7 / 17.3 | 0 | — |
| keyboard-tab-40（无写） | 1418 ms | 22 | **0** | 0 | 4281 | 194.6 | 16.7 / 19.8 | 0 | — |
| modal-settings（无写） | 2297 ms | 18 | **0** | 0 | 4382 | 243.4 | 16.7 / 26.0 | 0 | — |
| narrow-expanded-squeeze-720 | 1106 ms | 3 | **1** | 0 | 420 | 140.0 | 16.7 / 16.8 | 0 | — |

**①-a 恒等选择器的真实后果 = PASS（条件性放大，已量化）**

- **【新】写→渲染是严格 1:1**：90 px 拖拽的 AppFrame 渲染 **32** = 30 次帧写 + 1 次 pointerup 补写 + 1 次起始态；**实测 32 与预测 32 吻合**。`DragHandle` 同为 32。
- **【新】每次“拖拽帧写”的成本 = 525 个 fiber 渲染**：`(16674 − 917) ÷ (32 − 2) = 525.2`（用 0 px 对照窗剔除 idle churn 与起止态开销）。
- **【新】w01「条件性放大器」在**两向**都得到确证**：**每当布局 store 被写，AppFrame 必渲染**（drag 窗 32/71 commit）；**每当没被写，AppFrame = 0**（idle 0/35、keyboard-tab 0/22、modal 0/18、`breakpoint-up` 0/13）。w01 §3.2 对"设置 dwell 窗实测 0"的表面矛盾由此**闭合**：不是选择器无害，而是那些窗**根本没有布局写入**。
- **判定**：**PASS（机制 + 计数）**；**用户可感的卡顿 = INCONCLUSIVE**（见 ①-d）。

**①-b 【新】同值写入是**免费**的 —— 且有两道独立保护（避免误判为缺陷）**

| 观测 | 值 | 说明 |
|---|---|---|
| 0 px 拖拽（dx=0，`setSidebar(280+0)`） | AppFrame **2**（均为 `setDragging` 的 React state），**store 通知 0 次** | 按下/抬起各一次 state 渲染 |
| `breakpoint-1024-up`：`setNarrow(false)` 而 `narrow` 已是 false | AppFrame **0** | `LY:297` `if (d.narrow === narrow) return;` |
| squeeze 720/640/560/480：`setNarrow(true)` 重复 | AppFrame **1**（仅 `setViewport` 的 state） | 同上 + immer 短路 |
| clamp 饱和：82 次移动只产生 **17** 次实际值变化 | AppFrame **17** | 超出 264/420 后的写入全部免费 |
| `toggle` 在详情已关时 `closeDetails()` | 无通知 | immer `Object.is` 短路 + zustand `Object.is` 守卫（`RT:5418-5425`） |

⇒ 两道独立守卫：**actions 内的显式 early-return**（`LY:297`、`:302`）与 **immer 代理 set trap 的 `Object.is` 短路 + zustand setState 的 `Object.is`**。**这纠正了"每次 rAF 必然造成整树重渲染"的朴素表述**：饱和/同值阶段确实不重渲染。

**①-c 【新·裁决】clamp 死区：机制成立，静态档引用的"140 px"数字**错误****

绝对位移语义：`onSidebarDrag = (dx) => actions.setSidebar(sidebarBase.current + dx)`（`LY:212-214`），`sidebarBase` 在 pointerdown 时取**已解析列宽**（`LY:198,205`）。逐 px 采样实测（w24d `T1_deadzone`，独占）：

```
base = 280 → 顶点 dx = +300 ⇒ sidebar = 420（钳制）
回退：dx=290/240/190/140 ⇒ 仍 420；dx=130 ⇒ 410（首次变化）
⇒ 阈值 dx = 140 = clampMax(420) − base(280)
⇒ 从顶点到首次生效的**指针行程 = 170 px**
```
⇒ **死区 = 超程量 − 阈值，随超程线性增长、无上界**。以 `section-02` 自己的例子（base 280、右拖 500 px）：死区 = 500 − 140 = **360 px**，而非其写作的"140 px"；左侧同理（阈值 = base − 264 = 16）。
**判定**：死区**机制 PASS / 手感 FAIL**（缺陷成立）；**静态档的数值 FAIL（本线更正为"行程 170 px @ 超程 300 px，通式 deadZone = 超程 − 阈值"）**。

**①-d 帧时与卡顿：本环境未观察到掉帧，但**载荷不足** ⇒ 用户可感卡顿 INCONCLUSIVE**

- 全部 15 个窗 `rafP50 = 16.6–16.7 ms`，**`over50 = 0`**；拖拽窗 `rafMax = 25.4 ms`；LoAF count 全 0（且通道已自证，§0.4）。
- ⇒ 在**空树（无会话）**下，525 fiber/帧的写入路径**装在帧预算内**。
- ⚠️ **但本环境树规模极小**：无工作区/会话 ⇒ `sidebar`/`conversation`/`details` 三个 slot 实质为空（`details` 恒为 0）。**加载真实会话后的每帧成本未测**（需会话；只读授权下不做）。
- **判定**：**帧时 PASS（本环境） / 用户可感卡顿 INCONCLUSIVE（载荷不足，见 §6 未定项 1）**。

**①-e 持久化：三栏列宽**零持久化**（机制 + 实测双证）**

| 证据 | 内容 |
|---|---|
| 机制（三层钉死） | `createLayoutStore`（`LY:277-308`）**只传 `{init, actions}`，无 `persist`**；`defineStore`（`RT:5472-5477`）`persistKey = decl.persist === void 0 ? void 0 : …` ⇒ `undefined`；`createSnapshotStore` 仅在 `opts?.persist` 时 `attachPersistence`（`RT:5400`）⇒ **永不挂载** |
| 实测（w24d） | 拖到 **380 px** → reload → **280 px**（合约默认） |
| 实测（w24d） | reload 后 `localStorage` 键 = `["dsh.workspace.view.v5","dsh.sessions.current"]`，**布局类键 0 个** |

⇒ 机制**与设计一致**（`LY:267-275` 注释："the preference IS the width… reopening restores the contract default"），但**用户可感 = FAIL**：刷新/重启/插件重载后侧栏与详情宽度一律回默认；对照 `dsh.sessions.current`（`RT:9000`，w10 记为 `:8954`，**行号已迁移**）证明持久化机制**存在但未被本 store 使用**。

### 1.4 §1 判定汇总

| 项 | 判定 | 依据 |
|---|---|---|
| 恒等选择器导致"布局写 ⇒ 整树重渲染" | **PASS（条件性放大，已量化）** | §1.3 ①-a：写→AppFrame 1:1，32/32；525 fiber/帧写 |
| 无布局写时不重渲染 | **PASS** | idle/keyboard/modal/breakpoint-up 均 AppFrame=0 |
| 同值写入免费（两道守卫） | **PASS** | §1.3 ①-b：0px 拖拽通知 0 次；clamp 饱和 82→17 |
| 拖拽帧造成用户可感卡顿 | **INCONCLUSIVE** | 空树未掉帧；真实会话载荷未测 |
| 每 rAF 一次写（频率） | **PASS** | 32 写 / 30 帧；`LY:131-134` rAF 节流 |
| clamp 死区 | **FAIL（手感）** | 行程 170 px @ 超程 300 px |
| 三栏列宽持久化 | **FAIL（用户可感）** | reload 380→280；布局键 0 个 |
| 写入者清单完整（6 个 writer，无第七个） | **PASS** | 全树 grep `ctx.layout` 仅 `sidebar:284`、`conversation:10185/10240`；`LayoutController` 只暴露 3 个动作（`LY:313-341`） |

---

## 2. ② 三段拖拽手柄（sidebar / details / 内嵌）实测

**三段归属先钉死**：H1 = shell 侧栏手柄、H2 = shell 详情手柄（两者同属 `dsh-client-ui-layout`）；**H3 = `dsh-client-ui-trajectory` 的 details 内分栏手柄，它属 `conversation.view` slot，不是 shell details 列的子元素**（`section-02 §0`、`trajectory/client.js:4899-4957`）。btw 抽屉的 resize 手柄**在服务中不存在**（§0.1）。

### 2.1 存在条件与几何

| | H1 sidebar | H2 details | H3 trajectory 内嵌 |
|---|---|---|---|
| 渲染条件 | `!sidebarCollapsed`（`LY:239`） | `cols.details > 0`（`LY:246`） | 取决于 `conversation.view` 内容（`trajectory:4899-4957`） |
| 额外门槛 | 侧栏已展开 | **必须有非 blank 的当前会话**：`detailsSession === undefined` 时 `panels.details` 被**强制当 0**（`LY:195`）⇒ **无会话时 H2 结构上不存在** | 需打开会话 + trajectory |
| 几何（实测 H1） | rect `x=276 w=8`（跨 276–284），中心 280 = `cols.sidebar`；`left:280px; width:8px; margin-left:-4px; top:0; bottom:0` | `left: viewport − cols.details`（同 8 px 盒，`LY:248`） | `left:-4px`，绝对子元素（`trajectory:2995`） |
| `z-index`（实测） | **2** | **2** | 详情列内（z 5 的浮层对照见 `section-02 §2`） |
| `pointer-events` / `touch-action` | `auto` / `none` | 同 | 继承 `.drawer` 内 `auto` |
| 存在性实测 | **`handleCount = 1`**（只有 H1）——无会话态下 H2 不可观测 | — | — |

**H1×H2 能否互相重叠 ⇒ 不能**：`section-02 §1.3` 解析证明最小间距 ≥ 640 px；本线从 `computeColumns`（`LY:34-53`）独立复核：分支 1/2 都令 `center ≥ 640`，分支 3 强制 `details = 0` ⇒ 两柄盒不可能相交。**判定 PASS**。

### 2.2 遮挡（overlay 层级）—— 本线把 w10 的静态断言**升级为同窗实测**

**实测计算样式**（`raw/w24-recon.json`）：`.pI_x6G_handle` `z-index 2` < `.pI_x6G_overlayLayer` `z-index 20`；overlay 层 `position:absolute; inset:0; pointer-events:none`。

**【新】合成遮挡实验（w24c `zorder-synthetic-fullheight`，独占，探针点含在盒内已断言）**：

| 条件 | `elementFromPoint(手柄中心)` | 结论 |
|---|---|---|
| 基线 | `DIV.pI_x6G_handle`（`handleIsTopmostBefore=true`） | 手柄在最上 |
| overlay 层内插入**全高**合成子元素，`pointer-events:auto`（`containsProbePoint=true`） | **`DIV.`（合成元素）** | ✅ **遮挡成立**：z20 > z2，任何 `pointer-events:auto` 的 overlay 子元素在**重叠处**夺走命中 |
| 同一盒子改 `pointer-events:none` | `DIV.pI_x6G_handle` | ✅ **穿透成立** |
| overlay 子元素**不声明** `pointer-events` | `getComputedStyle(...).pointerEvents = "auto"` ⇒ 同样遮挡 | ✅ **宿主规则 `.pI_x6G_overlayLayer>*{pointer-events:auto}` 真实生效** |
| 清理后 | `DIV.pI_x6G_handle`，`syntheticLeftBehind = 0` | ✅ 无残留 |

⇒ **遮挡律（本线实测）**：**overlay 层子元素在重叠处必然遮挡手柄，在非重叠处必然穿透**。这正是 w10 "抽屉变宽会遮挡 details 列宽手柄、非抽屉区仍可穿透"的机制本体。

**三分解读（机制 / 桌面路径 / 降级路径，不可混谈）**：

| 层 | 判定 | 依据 |
|---|---|---|
| **机制律**（重叠 ⇒ 遮挡） | **PASS（本线实测）** | 合成全高盒覆盖手柄 ⇒ `elementFromPoint` 返回合成元素；`pointer-events:none` ⇒ 穿透；宿主 `>*{pointer-events:auto}` 生效 |
| **真实抽屉在桌面右侧停靠路径是否重叠** | **REFUTED（静态，`section-04 §A.5`）** | 手柄盒 = `[detailsCol.left−4, detailsCol.left+4]`（`layout:56` 的 `margin-left:-4px`）；而 drawer 的障碍矩形被 `margin = max(12, safeMargin)` **外扩 12 px**（`btw:2336-2352`）⇒ 抽屉右边界上界 = `detailsCol.left − 12` ⇒ **恒定 8 px 空隙，永不重叠** |
| **降级回退分支（`minimum-overlap-fallback`，`btw:2515-2559`）** | **未测（见 §6 未定项 5）** | 该分支在找不到零重叠候选时**允许重叠** ⇒ 此时手柄的视觉与指针**同时被夺**（z20 > z2 且 drawer `pointer-events:auto`） |

⇒ 精确表述：**"抽屉压手柄"不是常态机制，而是窄视口/降级排布下的边角情形**（`section-04 §A.5`）。另：**overlay 层整框覆盖不会吞掉手柄拖拽** —— 它 `pointer-events:none` 且唯一子节点 `.SalQ5q_placementRoot` 同为 `none`（`section-04 A-7`），本线的合成实验独立复证了这条（`pointer-events:none` 盒 ⇒ 穿透）。

**模态期的手柄可达性（w24c `modal-handle-edge-probe`，独占）**：
- 设置弹窗打开：`hardCount=1`，dialog rect `x 240–1040, y 24–776`；在手柄 x=420 处沿全高取 5 个 y（4 / 12 / 400 / 788 / 796）——**5/5 都命不中手柄**（最上层分别是 `VOzbGW_ring ringTop`、`NAV.VOzbGW_nav`、`ringBottom`）⇒ **设置弹窗开启时侧栏手柄 100% 被遮挡、完全不可用**。
- 但 `handle.inert = false`、`sidebarCol.inert = false`（下详 §4.3）⇒ **失效来自遮挡，不来自 inert**。

### 2.3 边界（实测精确命中）

| 量 | 实测 | 判定 |
|---|---|---|
| H1 下界 | **264 px**（拖到 −360 px 处采样） | **PASS**，与 `clampWidth(px,264,420)`（`LY:287`）逐 px 一致 |
| H1 上界 | **420 px** | **PASS** |
| 回原点复原 | 从任意位置回到 `dx=0` ⇒ **精确 280**，无漂移 | **PASS**（绝对位移语义的正面：不可累积漂移） |
| H1 拖拽映射 | +90 px 拖拽 ⇒ 280→**370 px**（1:1），中心 1000→910 | **PASS** |
| H2 钳制 | `[300, 520]`（`LY:290`，静态） | **INCONCLUSIVE**（H2 不可观测，无会话） |
| clamp 死区 | 见 §1.3 ①-c | **FAIL（手感）** |

### 2.4 持久化 / 键盘可达 / 可视提示 / 取消语义

| 项 | 实测或 `file:line` | 判定 |
|---|---|---|
| 持久化 | **无**（§1.3 ①-e）：reload 380→280，布局键 0 个 | **FAIL（用户可感）** |
| **键盘可达（H1/H2）** | 运行时 DOM：`tabindex=null, role=null, aria-orientation=null, aria-valuenow=null, aria-label=null`；**Tab×40 ⇒ `handleHits = 0`**（独占，`raw/w24b-keyboard-tab-40.json`） | **FAIL（0 个可聚焦手柄）** |
| **可视提示（H1）** | 计算样式 `::after.content = "none"`、`::before.content = "none"`、背景透明 ⇒ **只有 `col-resize` 光标**；CSS 里的 `::after` 药丸规则**只作用于 `[data-side=details]`**（`LY:56`） | **FAIL（零可视提示）** |
| **取消语义** | 渲染 props 仅 `onPointerDown/Move/Up`（`LY:147-155`）——**无 `onPointerCancel` / `onLostPointerCapture`** | **FAIL（下条为其实测后果）** |
| **【新】拖拽中手柄被卸载 ⇒ 状态永久残留** | w24d `T2`：按住拖到 340 → viewport 降到 900（`sidebarCollapsed` 翻转 ⇒ 手柄卸载，`handleCount=0`）⇒ `frame[data-dragging]="true"`、`transition-duration: 0s`；**pointerup 后仍为 true**；**重新加宽到手柄重新挂载后仍为 true**；**只有 reload 才清除**（`dragging=null`、`transition 0.3s`） | **FAIL（比静态预测更严重：残留跨越 pointerup 与重新加宽）** |
| **【新】非主键也会拖** | w24d `T3`：`mouse.down({button:'right'})` ⇒ `frame[data-dragging]="true"`、`handle.dragging="true"`、`transitionDuration 0.3s→0s`，右键按住移动 ⇒ **280→360 px**（真的改了布局） | **FAIL** |
| 双 `dragging` state | `AppFrame`（`LY:200`）与 `DragHandle`（`LY:106`）各一份；前者驱动 `frame[data-dragging]`（关过渡），后者驱动 `handle[data-dragging]`（显示药丸）。同一次 pointerdown/up 同帧批量 ⇒ **1 次提交**，成本可忽略；但**两者都可能与真实指针状态脱钩**（上两行的残留即由此而来） | **PASS（成本）/ FAIL（一致性）** |
| H3 内嵌手柄（静态，`section-02 §2`） | 无 rAF 节流（每 `pointermove` 2 次 `setState`，`trajectory:4928-4934`）；`splitWidth` 在 pointerdown 冻结（`:4917,4922,4931`）⇒ 陈旧上界；**缺 `aria-valuenow/min/max`**；`:2995` `:focus-visible{outline:none}`（可聚焦但焦点不可见）；`clampDetailsWidth` 下界 320 与 CSS `max-width:calc(100%-280px)` 冲突 ⇒ **split < 600 时手柄空转**；内联 `width` 覆盖 `@media (width<=760px)` 的 `width:min(92%,420px)` | **FAIL ×6（静态）**；实测 **INCONCLUSIVE**（需会话） |

### 2.5 §2 判定汇总

| 项 | 判定 |
|---|---|
| H1 存在/几何/钳制/1:1 映射/无漂移 | **PASS（实测精确 264/420）** |
| H1×H2 不可重叠（最小间距 640） | **PASS（解析，本线独立复核）** |
| 遮挡律（z20 > z2，重叠遮挡 / 非重叠穿透 / `>*{pointer-events:auto}`） | **PASS（本线合成实测）** |
| 设置弹窗期手柄 100% 被遮挡 | **PASS（实测 5/5 命不中）** |
| 手柄键盘可达 | **FAIL（0 个可聚焦；Tab×40 命中 0）** |
| 侧栏手柄可视提示 | **FAIL（`::after`/`::before` 皆 none）** |
| 取消语义（pointercancel / 丢捕获） | **FAIL（缺失）** |
| 拖拽中卸载 ⇒ `data-dragging` 永久残留 | **FAIL（实测，跨 pointerup 与重新加宽）** |
| 非主键进入拖拽 | **FAIL（实测右键真改布局）** |
| clamp 死区 | **FAIL（170 px @ 超程 300 px，无上界）** |
| 列宽持久化 | **FAIL（reload 后回默认）** |
| H2 全部数值 | **INCONCLUSIVE（无会话，结构上不可观测）** |
| H3 内嵌手柄 | **FAIL（静态 6 条）/ 实测 INCONCLUSIVE** |
| btw 抽屉手柄 | **不存在于服务中（R2 未部署，字节级证明）** |

---

## 3. ③ 响应式断点与重挂载成本

### 3.1 断点清单：**shell 只有 1 个 JS 断点；`<720px` 与 `COMPACT_CONTENT_PEEK` 都不是 shell 常量**

| 常量 | 值 | 位置 | 是否属 shell |
|---|---|---|---|
| **`SIDEBAR_AUTO_COLLAPSE`** | **1024** | `LY:13`；`narrow = viewport < SIDEBAR_AUTO_COLLAPSE`（`LY:190`），viewport 由 **frame 上的 ResizeObserver + rAF 合并**得到（`LY:177-189`） | ✅ **shell 唯一 JS 断点** |
| `<720px` | CSS media query | **仅** `$H/dsh-client-ui-user-questions/lib/client.js:115`、`:233`（2 个块，圆角/内边距微调） | ❌ 非 shell |
| `<760px` | CSS media query | `$H/dsh-client-ui-trajectory/lib/client.js:2995`（把 details 改成绝对定位浮层 `z-index:5`） | ❌ 非 shell |
| `<680px` / `<560px` | CSS media query | plugin-inventory `:11` / workflow-run `:12` / settings-models `:2111,2173,2265` | ❌ 非 shell |
| **`COMPACT_CONTENT_PEEK`** | **240** | **仅** `@local/dsh-btw`：`src/client/overlay-placement.ts:58` = 构建产物 `client.js:2240`（配合 `REGULAR_CONTENT_PEEK=320`、`MODE_RESERVE=16`） | ❌ **btw 私有，shell 不引用** |

⇒ **口径澄清（对范围 ③ 的框架性纠正）**：任务书把 `<720px` 与 `COMPACT_CONTENT_PEEK` 与 shell 断点并列，但**两者都不在 shell 内**。shell 的紧凑模型**完全等于** `SIDEBAR_AUTO_COLLAPSE=1024` + `sidebarCollapsed` 的派生式。**判定：口径偏误，本线更正**。

### 3.2 窄屏各栏行为（实测，独占，`raw/w24b-*` 与 `raw/w24c-*`）

| viewport | 侧栏偏好 | 解析 `gridTemplateColumns` | `data-sidebar-collapsed` | H1 | AppFrame 渲染 |
|---|---|---|---|---|---|
| 1280（展开） | 280 | **`280px 1000px 0px`** | 无 | 1 | — |
| **900（跨 1024 ↓）** | 280（**未被改**） | **`56px 844px 0px`** | `true` | **0（H1 卸载）** | **2** = 1 次 `setNarrow(true)` 写 + 1 次 `setViewport` state |
| 720 | 280 | `56px 664px 0px` | `true` | 0 | **1**（`setNarrow` 同值 ⇒ 0 通知；仅 viewport state） |
| 640 / 560 / 520 | 280 | `56px 584/504/464px 0px` | `true` | 0 | **1** 各 |
| **1280（跨 1024 ↑）** | 280 | **`280px 1000px 0px`** | 无 | **1（重新挂载）** | **0** ⇒ **零布局写** |

- **【PASS】自动折叠是纯派生、无迟滞、自动恢复**：`sidebarCollapsed = narrow ? !panels.narrowExpanded : panels.sidebar === 0`（`LY:194`）⇒ 断点**从不改 `panels.sidebar`**（实测：900/720/640/560/520 一路下来 store 侧栏偏好仍是 280），回到 1280 立即 `280px 1000px 0px`（实测 `breakpointSeries.backUp`）且 **`breakpoint-up` AppFrame = 0 ⇒ 重新加宽一次写都没有**。与 `LY:24-33` 注释"Pure: no hysteresis"一致。
- **【FAIL】`computeColumns` 分支 2 在 `details === 0` 时是死代码 ⇒ 文档承诺的 640 px 中心下限在详情关闭时**永不生效**（本线独立解析 + 实测）**
  ```js
  const d1 = d0 === 0 ? 0 : Math.max(300, viewport - s - 640);      // LY:42
  if (s + d1 + 640 <= viewport) return { sidebar: s, center: 640, details: d1 };   // LY:43
  return { sidebar: s, center: Math.max(0, viewport - s), details: 0 };            // LY:48-52
  ```
  `d0 === 0` ⇒ `d1 = 0` ⇒ 分支 2 条件 `s + 0 + 640 ≤ viewport` **与分支 1 的条件逐字相同**，而分支 1 刚刚失败 ⇒ **分支 2 不可达**。于是落到分支 3：`center = viewport − s`，**没有下限**。
  **实测（独占，w24c）**：900 且窄屏手动展开 ⇒ **`420px 480px 0px`**（中心 480）；720 ⇒ **`420px 300px 0px`**（**中心 300**）。即**侧栏吃掉中心列，中心可被压到 300 px 甚至 0**（`Math.max(0, …)`）。
- **【FAIL】`narrowExpanded` 被任何一次断点翻转摧毁**：`setNarrow` 在 `narrow` 变化时**无条件** `d.narrowExpanded = false`（`LY:296-300`）。实测：900 手动展开（`420px 480px 0px`）→ 缩到 800 ⇒ 回到 `56px 744px 0px`（**折叠**），AppFrame=2（含 1 次 `setNarrow` 写）。⇒ **手动窄屏展开不具粘性**。

### 3.3 断点切换的重挂载成本

| 窗 | commits | **mounts** | mounts 构成（前几名） |
|---|---|---|---|
| 1024 ↓（展开→rail） | 10 | **66** | `DocumentTitle 10`（≈1/commit 底座）、`SlotOutlet/SlotErrorBoundary/RootEntry/OfficialBrandMark/lf/uf/$9/A9` 各 **7** ⇒ 侧栏 slot 链重挂载 |
| toggle-collapse | 29 | **221** | `DocumentTitle 29`、侧栏 slot 链各 **24** |
| toggle-expand | 9 | **117** | `Vu/tf/z9` 各 12–13、**`ProjectRowItem 11`**（工作区/项目行真的重挂载） |
| squeeze 720 | 18 | **122** | 侧栏 slot 链各 13 |
| idle（底座） | 35 | **175** | 5/commit 的常驻 churn |

- **【PASS】slot 参数变化**不会**导致 occupant 重挂载**：`renderSlot(key, owner)` 返回 `<SlotOutlet slotKey ownerProps>`（`renderer/client.js:281-298`），**不派生 `key`** ⇒ `{collapsed, width}` 变化只是 **props 重渲染**。w01 的"无 keep-alive ⇒ 完整 unmount/remount"针对的是 **slot 版本/条目切换**，与本节"断点参数变化"不是一回事，两者不矛盾。
- 观察到的 mounts 来自**组件内部分支翻转**（`SidebarRoot` 的 `wide = !collapsed || !settled` 与 `railIn` 分支，`sidebar:96-118`）以及 `ProjectRowItem` 等列表项。
- ⚠️ **归因精度 = INCONCLUSIVE**：`mounts` 含 ≈1/commit（交互窗甚至 ≈5/commit）的**常驻底座**（§0.5 通道局限）；把 221 全部记到"折叠"账上是过度归因。**可确证的是**：一次折叠/展开**确实**重挂载了侧栏 slot 链与项目行（7–24 个/次），**量级**为"数十个 fiber/次"。

### 3.4 §3 判定汇总

| 项 | 判定 |
|---|---|
| `<720px` / `COMPACT_CONTENT_PEEK` 属 shell 断点 | **FAIL（口径偏误，已更正：前者仅 user-questions 的 CSS，后者仅 btw 私有常量）** |
| shell 唯一 JS 断点 1024 + ResizeObserver/rAF | **PASS** |
| 自动折叠无迟滞、跨断点自动恢复、重新加宽零写入 | **PASS（实测 backUp 280/1000，AppFrame=0）** |
| 640 px 中心下限 | **FAIL（详情关闭时分支 2 不可达；实测中心 480 / 300）** |
| 窄屏手动展开的粘性 | **FAIL（任何断点翻转即复位）** |
| 断点切换 slot occupant 重挂载 | **PASS（无 key ⇒ 仅重渲染）** |
| 断点切换重挂载**成本归因** | **INCONCLUSIVE（mounts 含常驻底座）** |
| 窄屏 520/560/640/720 各栏行为 | **PASS（实测几何自洽：`56px (w−56)px 0px`）** |

---

## 4. ④ 焦点与层级

> **纪律**：w12 的运行时结论**引用不重测**（`program/w12-input-ux/audit.md`）。

### 4.1 引用 w12（不重测，作为改动前基线）

| w12 结论 | 位置 | 现状（本线核对） |
|---|---|---|
| `aria-modal="true"` 只声明不约束：无 `inert`、无 Tab 循环、背景无 `aria-hidden`；Tab×40 有 **16–17 个落点跑出面板** | w12 §1.2；`settings-general:121-122`（**w12 旧锚点**） | **已改变**（下 §4.2）。⚠️ **锚点已迁移**：该文件因 K1-1 keep-alive 增长约 30 行，**当前字节为 `settings-general:151-152`**（`section-04 §B.1`）⇒ 引用 w12 时**必须同时给出新锚点** |
| 7 个 document/window 级 `Escape` 监听器互不仲裁；唯一栈顶仲裁在 `dsh-workspace-enhancement:2241-2266` | w12 §2.4 C-1 / G1–G8 | **未改变**（`raw/focus-zindex-static.json`：G1–G8 在当前字节里**全部仍在且未改**） |
| 详情关闭不还焦（`layout:304-306`）、无 Esc | w12 §1.1 row D | 代码未变（**行号迁移 +336** ⇒ 现 `LY:304-306` 附近；见 §4.4） |
| 官方 38 包真焦点陷阱 = 0 | w12 §2.4 F-2 | 由 U-A11Y1 **外部补偿**（不改 primitives） |

### 4.2 【新·决定性】U-A11Y1 已落地：`aria-modal` 从**声明**变成**约束**（同窗对照）

运行时自证：`window.__dshA11yOverlayLayer.version === "U-A11Y1:v1"`，源 `LY:566-901`（纯增量，`:1-564` 未动）。

| 观测（独占，`raw/w24b-modal-settings.json`、`raw/w24b-modal-esc-close.json`、`raw/w24c-modal-handle-edge-probe.json`） | 值 | 对照 w12 |
|---|---|---|
| 打开设置弹窗后 `hardCount` | **1** | w12 无此概念 |
| dialog 声明 | `role="dialog"` `aria-modal="true"`，rect 800×752 @ (240,24) | 同 |
| **inert 集合** | **`[hHd-Xa_logoRow, hHd-Xa_regionArea, hHd-Xa_footerActions, pI_x6G_centerCol, pI_x6G_detailsCol]`**，各带 `aria-hidden="true"` | w12：`rootInert=false`、`bodyInert=false`、背景 `aria-hidden=[null]` ⇒ **由 FAIL 转 PASS** |
| `#root` 自身 inert | **`false`** | dialog 在 `#root` **内部**（in-tree），故 `:689` 的 `sibling.id !== "root"` 特例不触发；覆盖靠**祖先链兄弟**逐层 inert |
| 弹窗内 `focusables` 数 | **24** | — |
| **Tab×25（弹窗内）逃逸次数** | **0 / 25** | **w12：Tab×40 有 16–17 个落点跑出面板** ⇒ **由 FAIL 转 PASS（决定性）** |
| Tab 落点示例 | `oY77xG_selector`、`hVGvvW_selector`、`_8HJdBW_themeCube`、`T1PP_q_selector`、`SELECT` —— 全部 `inDialog=true` | — |
| **Esc 关闭后** | `hardCount=0`、**inert 全清**、`activeElement = BUTTON.VOzbGW_trigger`（**还焦到打开者**） | **w12：焦点落 `(body)`、`触发按钮被聚焦=false`** ⇒ **由 FAIL 转 PASS** |
| 关闭后手柄 | `isHandleAtCenter = true` ⇒ 立即恢复可命中 | 无残留 |

### 4.3 【新】U-A11Y1 的残余缺口（本线实测 + 静态）

1. **inert 覆盖是"区域级"而非"列级"**：`applyChain`（`LY:680-696`）只对**祖先链兄弟中含可聚焦后代者**加 inert；`containsFocusable`（`LY:636-639`）只看 `querySelector(FOCUSABLE)` ⇒ **无子节点的 `div` 手柄被跳过**。实测：模态开启时 **`handle.inert = false`、`sidebarCol.inert = false`**，而它的三个兄弟区域与 `centerCol`/`detailsCol` 都 inert。
   ⇒ **残留风险 = 任何 `aria-modal` 表面，只要它的盒子不覆盖手柄条，shell 就仍可被拖宽**。今日不可利用（设置弹窗全高遮挡，实测 5/5 命不中），但这是**结构性潜在洞**。判定：**机制 PASS / 可利用性 = 按表面而定（设置弹窗 PASS 不可利用；其余 INCONCLUSIVE）**。
2. **该层完全不碰 `Escape`**（静态确证）⇒ **Esc 叠层关序与 w12 完全一致，仍是 8 个全局源且零仲裁**。判定：**FAIL（未改）**。
   `section-04 §C` 把这条推到更精确的两分：**"一次 Esc 关掉的层集合" = 确定性**（capture 恒先于 bubble，且唯一 capture 仲裁者 `workspace-enhancement:2246-2248` 只 `preventDefault` **不 `stopPropagation`** ⇒ 同一次按键可连关 **5–6 层**）⇒ **FAIL**；**"关闭的先后顺序" = 静态不可判 ⇒ INCONCLUSIVE**（同节点多监听器按注册序 = 打开序，依赖用户操作序列）。另有一条**确定性"纸牌屋"**：btw 灯箱/确认框在 `document` bubble 上 `stopPropagation`（`btw:1396/1547`）而抽屉 minimize 挂在 `window` bubble ⇒ **抽屉的 Esc 被永久吞掉**（与 w12 §2.4 C-3 同机制，当前字节逐字仍在）。
3. `primitives Modal` 声明 `aria-modal` 但**自身**不提供陷阱/inert/还焦 ⇒ 现被 U-A11Y1 **外部补偿**（依赖 layout 插件已加载 + 选择器契约 `[role=dialog][aria-modal=true]`）⇒ **耦合脆弱**。判定：**FAIL（上游未改）/ 当前已补偿**。
4. **三个 `#root.inert` 写者并存且语义不一致**（`section-04 §B.2 附2`，本线据其证据面裁定）：`U-A11Y1`（**WeakMap 引用计数**，`LY:653-677`）、`settings-models`（**保存并还原**旧值，`settings-models:2140-2146`）、primitives `nf`（**不保存、清理时写死 `false`**，`index-ClqxG24t.js` L56 @323020）⇒ 惰化早解除窗口。判定：**静态 FAIL（语义不一致确证）/ 运行时错还可复现性 INCONCLUSIVE**（本线未构造该交替路径，见 §6 未定项 4）。
5. `ContextMeter` 声明 `role="dialog"` **但不带 `aria-modal`** ⇒ **永不成硬层**（PASS，无泄漏）。
6. `primitives Menu`（`SOFT=[role="menu"]`）只做"关闭还焦"，**不做 Tab 陷阱、不把焦点移入菜单**。判定：**FAIL（by design）**。

### 4.4 z-index / 层叠上下文清单（静态，`raw/focus-zindex-static.json`：89 行层表 + 23 条 claim）

| 层级 | 值 | 归属 |
|---|---|---|
| 最高（全局） | **2147483647** | U-BOOT2 延迟失败横幅（`dsh-web-frontend/dist/assets/index-ClqxG24t.js:204`） |
| 插件内最高 | **1100** | message-feedback `notePanel`、onboardingOverlay、primitives Menu portal、Toast |
| | **1000** | settings-general、attachment lightbox、**btw 抽屉/灯箱**、usage、workspace-enhancement、`.VOzbGW` |
| | 200 | 本地 `@local/dsh-ssh-gui` |
| | 100–101 | commands、conversation popover、input-trigger、jobs、subagent |
| | 30 / 20 / 10 / 8 | cordis / **shell overlay 层** / conversation / conversation |
| | **20** | **`.pI_x6G_overlayLayer`**（`LY:56`） |
| | **2** | **`.pI_x6G_handle`**（`LY:56`） |
| **U-A11Y1 新增的 z-index / DOM 层** | **0 个** | 纯属性级（inert/aria-hidden/tabindex/focus），不加层、不加 z-index ⇒ **不引入新的绘制序风险**（PASS） |
| shell 祖先是否创建层叠上下文 | **否** ⇒ 所有 overlay 的 z-index **全局可比**（PASS） | 

**`aria-modal` 声明 vs 执行的两个计数（`section-04 §B.2`，headline）**：
- **声明 `aria-modal="true"` 的面 = 10 个**（官方 2：`settings-general:152`、`attachment:430`；本地 7：`btw:1413`、`ssh-gui:911`、`workspace-enhancement:2617/3167/3754/3821/3874`；共享 primitives `Modal` 模板 1）。
  > 本线独立 grep（仅 `$H/*/lib/client.js`）只命中 3 个文件 —— 因为**本地插件与打进 `index-ClqxG24t.js` 的 primitives 不在该 grep 面上**。以 `section-04` 的全树普查为准。
- **真正"执行"（inert + Tab 循环 + 背景 `aria-hidden` + 还焦，四件齐）的面 = 10/10**，但**执行者不是它们自己**：**10/10 由 `U-A11Y1` 统一执行**（选择器 `layout:598` 恰好覆盖全部 10 个声明面；inert `layout:653-696`；Tab 循环 `layout:857-874`；还焦 `layout:734-759`）。其中 workspace-enhancement 的 5 个**另有自有实现**（双保险），btw 结束确认框自有 2 按钮循环。
- **未声明的 5 个 `role="dialog"` 面 ⇒ 永不 inert/陷阱**（`ContextMeter conversation:3177`、`message-feedback:578`、`workspace-enhancement:5103` 等）。前两者是**非模态 popover ⇒ `aria-modal` 缺席是正确的**，不构成缺陷。
  > ⚠️ **对协同者转述的一处更正**（`section-04` 首段）：a11y 层**没有"覆写 primitives 的 `Modal`/`Menu`"** —— 它**不改 primitives、不重建 Web 产物**，而是在**热面** layout 插件里追加一个全局 IIFE，用 `querySelectorAll` **从外部**约束（只看 DOM 属性、不看组件）。

**【本线 + section-04 合成的关键结构性发现】`shell.overlay` 是一个"始终渲染但通常为空"的 z=20 定位层**（`layout:234-238` 无条件渲染）。它 `pointer-events:none` 故当下无害，但**任何**未来注册进该槽的浮层都会**自动获得"在 z=2 手柄之上"的层级**（slot 文档 `dsh-cordis-client-runner:3070` 明写 "additive, and click-through until your entry opts into pointer events"）。
⇒ 本线的合成实验正是这一预留机制的**实证**：**w10 的"条件式"风险在机制上是被预留的，而不是偶然的**。判定：**PASS（机制预留已知）/ FAIL（缺少"手柄高于 overlay"的护栏）**。

### 4.5 焦点序实测（独占，`raw/w24b-keyboard-tab-40.json`）

Tab×40（侧栏展开）的落点序列是一个 **17 个目标的环**，重复两轮，**并且中间经过 `BODY`**：
```
BUTTON.pXSMma_workspace[F] > BUTTON.cubgiG_seat[F] > TEXTAREA.uV2eYG_input[F] > BUTTON.uV2eYG_add[F]
> BUTTON.Sh0Q9G_trigger[F] > BUTTON._7KE1Ra_trigger[F] > BUTTON.ydkMvW_close[F] > BODY.
> BUTTON.hHd-Xa_brand > BUTTON.hHd-Xa_iconButton(toggle) > BUTTON.hHd-Xa_newSession
> BUTTON.qDHVXG_searchButton > BUTTON.qDHVXG_iconButton ×2 > DIV.YDXeBa_sessionRow[F]
> BUTTON.ts_trigger[F] > BUTTON.VOzbGW_trigger[F] > (回到起点)
```
- **`handleHits = 0`**（两个 shell 手柄都不在 Tab 序内）；`inFrameHits = 38/40`；`distinct = 17`。
- **Tab 会经过 `<body>`（焦点丢失一次）** ⇒ 序是"环 + body 停靠"，不是纯线性；与 w12"Tab 序两轮不一致 ⇒ INCONCLUSIVE"**不矛盾**（本线两轮完全一致：17 目标重复两轮）。
- `DIV.YDXeBa_sessionRow` **已可聚焦** ⇒ 与已落地的 `U-A11Y2`（workspace 树行 roving tabindex）一致。

### 4.6 §4 判定汇总

| 项 | 判定 |
|---|---|
| `aria-modal` 的真实约束力（设置弹窗 Tab 逃逸 0/25） | **PASS（由 w12 的 FAIL 转为 PASS；本线实测面 = 1/10）** |
| `aria-modal` 全树声明/执行计数 | **声明 10 面 / 执行 10/10（静态普查，`section-04 §B.2`）**；⚠️ **本线的运行时验证只覆盖其中 1 面（设置弹窗）**，其余 9 面的"执行"仍是静态推断 ⇒ 全量实测为未定项 |
| 模态关闭还焦 | **PASS（还焦到打开者）** |
| 模态期背景 inert + `aria-hidden` | **PASS（5 个节点，逐节点实测）** |
| inert 覆盖的完整性（手柄/列级） | **FAIL（手柄与 sidebarCol 未 inert；今日被遮挡掩盖）** |
| Esc 叠层关序 | **FAIL（"关哪些层"确定 = 一次可关 5–6 层）/ INCONCLUSIVE（"关闭先后"静态不可判）** |
| z-index 体系 | **PASS（清单完整；overlay 20 > handle 2；U-A11Y1 零新增层；`#root` 不建层叠上下文 ⇒ 全局可比）** |
| 设置浮层**非 portal** ⇒ 同为 z=1000 时 body-portal 的灯箱/Modal **恒画在设置之上** | **PASS（静态，`section-04 §A.2`）** |
| shell 手柄键盘可达 | **FAIL（Tab×40 命中 0）** |
| `shell.overlay` 预留"未来浮层自动高于手柄" | **FAIL（缺护栏）；机制预留已知（PASS）** |
| `#root.inert` 三写者语义不一致 | **FAIL（静态）/ 运行时 INCONCLUSIVE** |
| primitives Modal/Menu 自身 a11y | **FAIL（上游未改；Modal 已被外部补偿，Menu 仅还焦）** |

---

## 5. 前三优化候选（含收益 / 风险 / 验收 / 回滚 / 热冷面）

### C1 · 布局 store 换成字段级选择器（消除恒等选择器放大器）

- **改动点**：`LY:159` `const panels = useStore((s) => s);` → 三个原始值 slice：`useStore(s => s.sidebar)`、`useStore(s => s.details)`、`useStore(s => s.narrowExpanded)`（或把 store 拆成"几何 / 模式"两个）。`LY:194-195` 的读数改用这三个值。
- **收益（实测基线）**：拖拽帧写成本 **525 fiber/帧写** ⇒ 目标 **≤60**；`AppFrame` 由 **32 次/90 px 拖拽** 降到**每写 1 次**（写次数不变，被拖动的子树变少）；`toggle/open/close` 类单次写不再把 `conversation`/`details`/`shell.overlay` 一起带下来（当前每次写都会 `renderSlot` 四次，`LY:228/233/237`）。
- **风险**：**LOW**。`Object.is` 对原始值是精确比较（`renderer:107/116`），不会漏更新；`panels` 只被读 3 个字段（全树 grep 已确认 `LY:194-195` 之外无消费者）⇒ 无隐藏消费者。
- **验收**：① **同窗 A/B**：同一条指针轨迹下 `gridTemplateColumns` 逐帧**逐字节相同**；② `AppFrame` PerformedWork **仍 = 写次数**（防"少渲染导致漏更新"）；③ 每帧 `pw` **比值 ≥5× 下降**（前 525 → 后 ≤105，判据为**比值**非绝对值）；④ `rafP50` 保持 16.7 ms（"没坏"哨兵）；⑤ 60 px / 90 px / 300 px 三档拖拽 + clamp 两端 + 折叠/展开 + 跨断点 全部几何一致。
- **回滚**：**单行**（恢复恒等选择器）；**热面**。
- **热冷面**：**热**（`dsh-client-ui-layout` 是 `/plugins/<id>/client.js?rev=` 直服，刷新即生效，无需重建 Web 产物、无宿主改动）。

### C2 · 手柄拖拽卫生：clamp 死区 + 取消语义 + 只认主键

- **改动点**（全部在 `LY:105-217`）：
  1. 死区：饱和时**重定位基准**（`if (next !== clamp(next)) base += (next − clamp(next))`）或直接对 `dx` 做窗口化钳制（只读 `LY:212-217`），保持"绝对位移"的抗漂移优点；
  2. 补 `onPointerCancel` / `onLostPointerCapture` → `callbacks.current.onEnd()`（`LY:147-155`）；
  3. 卸载兜底：`AppFrame` 在 `!sidebarCollapsed`/`cols.details>0` 条件翻转时清 `dragging`（`LY:200,239-252`）；
  4. `onPointerDown` 增加 `if (e.button !== 0) return;`（`LY:120-127`）。
- **收益（实测）**：消除 **170 px 行程死区**（超程 300 px 时；无上界）；消除**跨 pointerup 与重新加宽的 `data-dragging` 永久残留**（实测只有 reload 能清）⇒ 恢复 frame 的宽度过渡动画；消除**右键改布局**（实测 280→360）。
- **风险**：**LOW–MED**。① 改了手感，须保证钳制窗口内**逐帧等价**（用同一轨迹 A/B 曲线比对）；② `onPointerCancel` 是纯增量；③ 清 `dragging` 兜底可能与 `DragHandle` 自身 state 不同步（该 state 随卸载消失，无泄漏）。
- **验收**：① 超程 300 px 后回退，**首次生效行程 ≤20 px**（当前 170 px）；② 拖到 340 → viewport→900（手柄卸载）→ pointerup ⇒ `frame[data-dragging]` **为 null**；③ 右键按下 + 移动 ⇒ `data-dragging` 为 null 且宽度**不变**；④ `pointercancel` 注入后 `transition-duration` 回到 0.3s；⑤ 钳制窗口内同轨迹几何逐帧一致。
- **回滚**：**热面**，回退 `LY:105-217` 该块。
- **热冷面**：**热**。

### C3 · 手柄的键盘可达 + 可视提示 + 列宽持久化

- **改动点**：
  1. `LY:147-155` 渲染属性补 `role="separator"`、`aria-orientation="vertical"`、`aria-valuenow/min/max`、`tabIndex=0`、`aria-label`，并加 `onKeyDown`（←/→ 步进、Home/End 到钳制端、双击/Enter 复位）；`focus-visible` 焦点环样式进 `LY:56` 的 CSS 串；
  2. `LY:56` 的 `::after` 药丸规则从 `[data-side=details]` **扩到 `[data-side=sidebar]`**；
  3. `LY:277-308` `defineStore({ init, actions, persist: "dsh.layout.panels" })`（root 作用域 `create()` 不传 scopeKey，键即字面量，见 `RT:5476`）。
- **收益**：手柄键盘可达 **0 → 2**；消除"被遮挡即彻底不可达"（当前 H1 零可视提示 + 零键盘路径 ⇒ 一旦被 overlay 遮挡就**没有任何替代操作路径**）；列宽**跨刷新存活**（实测当前 380→280）。
- **风险**：**MED**。① 新增 2 个 Tab 落点会插入到当前那个"17 目标环 + body 停靠"的序里（可接受，但须复核 Tab 序不与新 a11y 层的 `HARD` 陷阱交互）；② `persist` 是**新的 localStorage 键**（须确认命名不与 `dsh.workspace.view.v5` / `dsh.sessions.current` 冲突）；③ `aria-valuenow` 必须随拖拽实时更新，否则比没有更糟。
- **验收**：① Tab×40 ⇒ **每个手柄 ≥1 次命中**（当前 0）；② `role`/`aria-orientation`/`aria-valuenow/min/max` 全部非空且 `aria-valuenow` 与解析后列宽一致；③ → ×3 ⇒ 宽度精确 +3×step，`aria-valuenow` 同步；④ 拖到 380 → **reload ⇒ 仍 380**（判据：**不等于 280**）；⑤ `localStorage` 恰好多 **1** 个布局键，且 `clearPersisted()` 路径可用（`RT:5492-5497`）；⑥ `prefers-reduced-motion` 下无回归。
- **回滚**：**热面**；去掉 `persist` 即回到当前基线（键可另行清理）；去掉 `tabIndex` 即恢复当前 Tab 序。
- **热冷面**：**热**（三处均在 `dsh-client-ui-layout`）。

---

## 6. 未定项（诚实清单；每条写成可测问题）

1. **加载真实会话后的拖拽成本**（最高优先）：空树 525 fiber/帧（`rafP50=16.7`、零掉帧）；**带真实会话的 `conversation`/`details` 子树未测**。可测问题：在同一指针轨迹下，`pw/帧` 与 `over50` 是否随会话树规模线性上升、并在某规模后开始掉帧？**需要会话（只读授权下不做）。**
2. **H2（详情手柄）全部实测值**：无会话时 `detailsSession === undefined` ⇒ `cols.details` 被强制 0（`LY:195`）⇒ **H2 结构上不可观测**。可测问题：打开任一非 blank 会话后，H2 的 `left` 是否恒为 `viewport − cols.details`、钳制是否精确 `[300,520]`、Tab 是否可达？
3. **H3 内嵌手柄**：属 `conversation.view`，需会话。静态 6 条 FAIL 待运行确认，尤其 `splitWidth < 600` 时空转、内联 `width` 覆盖 `@media (width<=760px)`、每 `pointermove` 2 次 `setState` 的实际帧代价（**须页内 `setTimeout` 阳性对照**）。
4. **`#root.inert` 三写者错还**（`U-A11Y1` WeakMap 计数 / `settings-models` 保存还原 / primitives `nf` 清理写死 `false`）：静态 FAIL，**运行时可复现性未测**。可测问题：按"引导浮层关 → 设置弹窗开 → 设置弹窗关 → 引导浮层开"的**交替序列**操作后，`#root.hasAttribute('inert')` 是否回到基线？（`section-04 §B.2 附2`）
5. **btw 抽屉与 `data-side=details` 手柄的实际像素重叠**：**桌面右侧停靠路径已被静态证伪**（恒定 8 px 空隙，`section-04 §A.5`）；**降级分支 `minimum-overlap-fallback`（`btw:2515-2559`）允许重叠但未测**；且 **R2 调宽高未部署**（served md5 `6b3245b9…` / 335,993 B，`col-resize` 命中 0）。可测问题：在窄视口逼出 fallback 分支后，`elementFromPoint(handleCenter)` 是否命中 drawer？R2 落地后再复测一次。
6. **`aria-modal` 面 10 个里只有 1 个（设置弹窗）经本线运行时验证**。可测问题：对 `attachment:430` 原图灯箱、btw 图片灯箱、ssh-gui、workspace-enhancement 的 5 个弹窗逐一复跑"Tab×25 逃逸计数 + Esc 后 `activeElement`"两问，确认 10/10 的"执行"不止于静态。
7. **Esc 关闭集合的运行时确认**：静态已判"集合确定 = 一次可关 5–6 层"。可测问题：同时开设置 + ContextMeter + btw 抽屉 + btw 灯箱，按一次 Esc，记录实际关闭集合与调用序。
7. **引擎边界**：本线为 Chromium 131（playwright 1.49.1），用户与兄弟线为 Chrome 153 ⇒ **绝对帧时不跨线比较**；计数类结论不受影响。
8. **`mounts` 通道的归因精度**：需先测出"无交互底座"（本线 idle ≈5 mounts/commit、`DocumentTitle` ≈1/commit）才能把 remount 成本归给具体交互。

---

## 7. 产物索引

| 类别 | 文件 |
|---|---|
| 本文 | `.workspace/lag-fix/program/w24-shell/audit.md` |
| 二级子代理静态档（手柄） | `section-02-handles-static.md`（10 节 / 64.9 KB）、`raw/handles-static.json`（69 条：**50 PASS / 14 FAIL / 5 INCONCLUSIVE**） |
| 二级子代理静态档（层级） | `section-04-focus-zindex.md`（458 行 / 63 KB：§A z-index 清册 + §B 声明vs执行 + §C Esc + §D 焦点可达 + 60+ 行证据表 + 11 条未定项）、`raw/focus-zindex-static.json`（**89 行层表 + 23 条 claim**，含 md5 锚点 `verified_hashes`） |
| 探针 | `tools/w24-init.js`（页内仪表）、`tools/probe-w24.mjs`（首轮，CONTENDED）、`tools/probe-w24b.mjs`（独占主证据）、`tools/probe-w24c.mjs`（缺陷修正 + 合成遮挡 + 模态）、`tools/probe-w24d.mjs`（四项裁决） |
| 原始 JSON | `raw/w24-*.json`（9）、`raw/w24b-*.json`（17）、`raw/w24c-*.json`（13）、`raw/w24d-run.json` + 4 份运行日志 |
| 截图 | `evidence/*.png`（19 张：`b-drag-90px-after`、`b-collapsed`、`b-breakpoint-900`、`b-modal-settings-open`、`c-modal-handle-edge`、`c-narrow-expanded-900/480` 等） |
| 锁 | `.workspace/lag-fix/lib/probe-lock.mjs`（w24b/c/d 均 ACQUIRED，收尾 `released:true`） |

**关键原始数字一眼表**（独占窗）：

```
写→渲染 1:1        90px 拖拽 = 30 帧写 → AppFrame 32（预测 32）
每帧写成本          (16674−917)/(32−2) = 525 fiber/帧写
同值写免费          0px 拖拽 AppFrame=2 且 store 通知 0；clamp 饱和 82 移动 → 17 渲染
无写不渲染          idle 0/35、Tab 0/22、modal 0/18、breakpoint-up 0/13
钳制                264 / 420 精确命中；回原点精确复原 280
死区                超程 300 → 首次生效行程 170px
残留                拖拽中卸载 ⇒ data-dragging=true 跨 pointerup + 重新加宽，仅 reload 清除
右键                按下即 dragging=true，按住移动 280→360
键盘                Tab×40 → handleHits 0；手柄 tabindex/role/aria-* 全 null
可视提示            H1 ::after/::before content 均为 none
中心下限            900 → 420px 480px 0px；720 → 420px 300px 0px（分支2 在 details=0 时死代码）
持久化              reload 380→280；localStorage 布局键 0 个
aria-modal 约束     Tab×25 弹窗内逃逸 0/25（w12 基线 16–17/40）；Esc 后还焦到触发按钮
遮挡律              overlay z20 子元素重叠处必遮挡 / 非重叠必穿透 / >*{pointer-events:auto} 生效
阳性对照            注入 120 → rafMax 132.1/135.8、loaf 131/135；阴性 17.0 / 0
```
