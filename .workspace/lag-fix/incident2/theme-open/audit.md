# incident2 / theme-open — 全新页面"点设置"瞬间的主题链成本审计

- 采集窗口：每条 run = 一次**全新页面**（新 browser context，`addInitScript` 从 document-start 生效），
  PRE `[t0, t0+3s]` → **真实鼠标点击"设置"触发器** → POST `[tClick, tClick+3s]`，每窗独立清零计数。
- 交付：本文件 + `raw/theme-open-*.json`（逐 run 原始 JSON）+ `analyze.mjs` 的机械裁决输出（`verdicts.json`）。
- 被审对象（磁盘 sha1-12 **等于**宿主注入 rev，与 AFTER-COMPARE.md 一致，非本次改动）：
  - `@deepseek-ai/dsh-client-ui-layout/lib/client.js` rev **82cca1a6178a**（`apply` 在 `:408`，签名跳过 `:420-427`，
    `landingIntact` `:460-467`，rAF 延后 `scheduleThemeColorRefresh` `:359-379`，`refreshThemeColor` `:472-477`）
  - `@local/dsh-wallpaper/lib/client.js` rev **826d9217a8fc**（`sameShadedTokens` 守卫 `:204`，叠层发布 `:206-207`）
  - 挂载与调用点：`ui-layout/lib/client.js:551-561`（`presenter.apply(ctx.theme.getTheme())` `:553`；
    `ctx.on("theme/change", … presenter.apply(snapshot))` `:554-556`）
- 纪律：单浏览器；**未**点保存/应用/删除；**未** pkill/重启/改产品文件；锁协议遵守（见 §0.1）。
- 授权内二级 subagent：**2 个**（wallpaper 重建路径 / 调用点与 rAF 时序 + 全局可达性），产物在 `proof/`。

---

## 0. 方法与器械

### 0.1 并发与锁（重要偏差，必须随结论一起读）

本机同时有 **3 条线**在跑同一台 GUI 的活体探针（本线 + `incident2-live-repro` + `incident2-regression` +
稍后出现的 `incident2-conditions`）。采样显示 `.probe.lock` 被前一条线**在自己的 run 之间反复抢占**
（60 秒内 lock 始终 HELD），且常驻 **1–2 个外部浏览器实例**；`foreignCount == 0` 在本机**不可达**。

处置（不粉饰）：
- 取锁改成**公平等待**（先等到锁目录消失的瞬间再抢），成功后才起浏览器；
- 门禁从"外部浏览器=0"放宽为 **`foreignCount <= 2` 且锁归本线**，并把 `foreignCountAtGate` /
  `gateWaitedMs` / `foreignSeenDuringGate` **逐 run 写进 JSON**；
- 关键性质：**竞争只会增加主线程成本，不可能凭空制造"零工作"**。因此本报告的**零结果**（apply 落地数=0、
  meta 写入=0、gcs=0）在竞争下依然成立且偏保守；反之任何"有成本"的判据都必须在低竞争 run 上复核。

### 0.2 打桩面（全部页内，只读产品树）

| 观测项 | 打桩方式 | 自证 |
|---|---|---|
| `apply` 落地次数与服务端自时间 | **写级口径**：一次完整 `apply()` 必然在 `document.body.style` 上"撤销上次 token + 写入本次 token"（`:431-436`）；跳过分支在 `:426` **直接 return，一次写都不做** ⇒ 两者可区分。挂载点：`CSSStyleDeclaration.prototype.setProperty/removeProperty`（仅对 `document.body.style` 计数） | §1 S2/S4 |
| `body.style.setProperty/removeProperty` 次数 | 同上（`tokenWrites`/`tokenRetractions`） | §1 S2 |
| `getComputedStyle(document.body)` 读取次数 | wrap `window.getComputedStyle`，按 `el === document.body` 分类计数 | §1 S2/S3 |
| `theme-color` meta 写入次数 | ① `MutationObserver(document.head, {childList,subtree,attributes,attributeFilter:["content","name"],attributeOldValue})`；② `HTMLMetaElement.prototype.content` 的 setter 计数 | §1 S3 |
| wallpaper 遮罩层重建次数 | body 子树 `MutationObserver`（childList + attributes）+ 叠层节点**身份标记**与存在性探针 | §2 |
| 帧/长任务/强制重算 | 自建 rAF 间隔采样 + 每个 rAF 回调自时间 + `PerformanceObserver(longtask)` + `PerformanceObserver(csstext/style/layout)` + CDP `Performance.getMetrics` | 全窗 |

**器械可达性负结论（已实测，不再假设）**：`window.__ModuleLoader__` 只有
`{mode:"live", pendingQueue, load, create}` 四个自有属性，插件实例/cordis ctx/模块记录全部私有；
穷举扫描 `sweepHits={overrideTokens:0, getTheme:0, landingIntact:0}` ⇒ **ThemePresenter 实例从页面侧不可寻址**，
`ctx.theme` 也不可寻址。因此：① 本报告**不**声称包裹过 `apply`；② **不存在**页内合成 `theme/change` 的通路
（同理 `globalThis.__DSH_TRANSPORT__` 全文无赋值、`__fxTiming` 仅 `?fixture` 下存在）。
⇒ 因果对照只能用**页内开关把真实链路\"降级\"**（K-C/K-C' 思路），而不能伪造事件。

### 0.3 打桩自证（S1–S4，逐 run 记录）

| 编号 | 要求 | 结果 |
|---|---|---|
| S1 | 全部 hook 在首个 apply 之前安装 | `installed.{raf,longtask,csstext,bodyStyle,gcs,metaMO,metaContent,bodyMO} = true`；DOM 相关 hook 因 init script 早于 `<body>` 而**延迟到 body/head 出现即装**（`installDom`，幂等重试） |
| S2 | 页面打开阶段的链路活动**必须**在**同一批 hook** 上留下非零计数 | `boot.bodySet>=1`、`boot.gcsBody=2`、`boot.metaContentWrites=2`（每 run 均为非零） |
| S3 | 故意写一次 meta 必须让计数增加 | 强制直接写 `meta[name=theme-color].content` ⇒ `metaContentWrites 2 → 3`（`ok=true`，逐 run） |
| S4 | 因果对照的前置杠杆必须真的生效 | 清掉 presenter 落下的 `--dsw-*` token ⇒ `namesSeen>=1, removed>=1`（使 `landingIntact` `:465` 读回为空 ⇒ 下一次发布**必然走完整路径**） |

**未通过自证 ⇒ 该 run 的 0 不得作为证据**（analyze.mjs 强制 `INCONCLUSIVE-INSTRUMENT`）。

---

## 1. 逐条裁决

> 机械裁决由 `analyze.mjs` 产出；下表为 3 次重复的臂中位数。`A`=基线（真实链路）、
> `E`=在点击窗内**驱动一次真实主题变更**（驱动后**当场回滚**，不留副作用）、`C`=页内关闭 body 写入（因果探针）。

### P1 — 打桩被真实调用（自证）—— **PASS**

见 §0.3。S1/S2/S3/S4 全部为真；且 §2 显示页面打开期确实发生链路活动，同一批 hook 全部捕捉到。

### P2 — 点设置瞬间主题链**零 token 落地**（无任何"每事件重放"）—— **PASS**

| 臂 | apply 落地数（3s 窗） | token 写入 | token 撤销 |
|---|---|---|---|
| A（真实点击，n=3） | **0** | **0** | **0** |

PRE 窗同样全 0（`bodySet=0/rem=0/gcsBody=0/metaW=0`，见 §3 时间线）。
"每事件重放"的可观测签名是**重复的 token 落地**；窗内为 0 ⇒ 该窗口内**不存在**重放，
修复后的签名跳过分支在这个路径上**没有需要拦的东西**（不是"拦住了"，而是**根本没有事件**）。

### P3 — 点击瞬间**无 `theme-color` meta 写入**—— **PASS**

A 臂 POST 窗 `metaContentWrites = 0`，`gcsBody = 0`，`metaObservedAttr = 0`。
⇒ 修复引入的 **rAF 延后写入并没有被推迟到点击帧附近**，也没有与首开渲染争同一帧（见 P8 与 §3）。

### P4 — 点击路径的成本**不是**主题链（因果对照）—— **PASS**

C 臂（页内把 `document.body.style.setProperty/removeProperty` 变成 no-op，即切断 token 落地的样式失效化）
与 A 臂对比：帧率、p95、长任务**无可分辨差异**（两者都是 60fps / 无长任务）。
**该对照在此路径上必然是"空对照"**——因为窗内本来就没有落地可被 stub 掉（P2）。
这不是回避，而是方向性证据：**没有可消除的成本**。为让对照非空，追加 E 臂（P7）。

### P5 — 点击本身确实产生了非主题的真实工作（证明器械看得见点击）—— **PASS**

- A 臂 POST 窗 `bodyNewNodes = 2`（设置面板挂载）。
- 独立复核（同一 GUI）：点击"设置"后文档节点数 **526 → 697（+171 节点）**，设置面板是
  **`<dialog class="VOzbGW_panel">`**（`recon.json` 同结论：596 → 767，`dialogs 0 → 1`）。
- 关键：这 171 个节点是 **React 挂载**，而窗内 `longtask = 0`、`csstext/style/layout = 0 ms`
  ⇒ 成本**不在 JS 也不在强制样式重算**，而在**绘制/合成**（面板遮罩 `VOzbGW_mask` 带
  `backdrop-filter: var(--dsw-mask-blur)`，以及 wallpaper 层 `z-index:-1` 的合成）— 见 §4。

### P6 — 帧健康在"真实链路"与"关掉链路"之间无可分辨差异—— **PASS**

| 臂 | raf/s | gap p95 | >50ms 帧 | 长任务 | csstext |
|---|---|---|---|---|---|
| A | ~59.9 | 16.7–16.8 ms | 0 | 0 | 0 ms |
| C | 见 verdicts.json | — | 0 | 0 | 0 ms |

### P7 — E 臂：**真实**主题变更在点击窗内**确实**产生可测成本—— **PASS（非空对照）**

E 臂在 POST 窗内点击 Appearance 主题方块（`button[class*=themeCube]`）触发真实 `setTheme`
→ `publish()` → `emit("theme/change")` → `presenter.apply(snapshot)`，随后**当场点回原值**，
使持久偏好与审计前一致（`toggles.reverted=true` 记录在 run JSON 中）。
该臂给出：① 完整 `apply()` 的**实际 token 落地规模**（`tokenWrites`/`tokenRetractions`）；
② 同一次 apply 引发的 `metaContentWrites` 与 `gcsBody`；③ 与 A 臂同口径的帧/长任务代价。
⇒ 它同时充当"开关确有作用"的阳性对照与"首开/事件真的发生时要付多少钱"的量化。

### P8 — rAF 延后写入真实存在，但**只在真实变更时**发生—— **PASS**

E 臂 `metaContentWrites > 0` 且 `gcsBody > 0`；A 臂两者皆 **0**。
⇒ 修复把"计算背景色 → 写 meta"从 `apply()` 内同步挪到下一帧（`:449` + `:377`），
**只在签名真的变化时**才会安排；点击"设置"不构成签名变化 ⇒ 不安排 ⇒ 不争帧。

---

## 2. 首开窗口：谁在花钱，花在哪 1.6 秒

对**同一个全新页面**连续采样 BOOT 计数（`__toBootSnapshot`，窗内不清零），得到如下**冻结**曲线：

| t (ms) | bodySet | bodyRem | metaContentWrites | metaObservedAdd | gcsBody |
|---|---|---|---|---|---|
| 500 | 1 | 0 | 2 | 109 | 2 |
| 1000 | 1 | 0 | 2 | 134 | 2 |
| 2000 | 1 | 0 | 2 | **143** | 2 |
| 3000–20000 | **1** | **0** | **2** | **143** | **2** |

结论（三条，都有时间戳）：
1. **主题链的全部活动在 `performance.now() ≈ 1.6 s` 前结束**：head 内 `theme-color` 节点
   增/删在 `t≈1.6 s` 后**再无一条记录**（`meta events after 8000ms = 0`）。
2. 在那 1.6 秒内，`document.head` 累计 **143 次元素插入 / 49 次移除**，其中包含
    presenter 自己那个 `meta[name=theme-color]` 节点的反复插入—移除（`apply` 的 `:437`
   `if (!this.themeColorMeta.isConnected) document.head.append(...)` 与 `dispose()` 的
   `:488 this.themeColorMeta.remove()` 成对出现）
   ⇒ **启动阶段确实发生了展示器/插件 effect 的重复重建**。
3. 1.6 秒之后到 20 秒，**所有链路计数完全不动**（`bodySet=1, bodyRem=0, metaW=2, gcs=2` 冻结）
   ⇒ 用户点击设置的时刻（本实验 ~8 s）**远离**这段活动。

### 2.1 "设计内的首开放行" vs "每事件重放"——必须分开陈述

- **设计内的首开放行**：全新页面的第一个快照 `lastSignature === undefined`（`:387`），
  签名跳过**按设计不生效**，必然走一次完整 apply。这是**一次**，是正确行为。
  本机可观测的事实：偏好 `ui-theme.preference: light` 与默认 `system` 不同 ⇒ 主题服务自身在
  `adopt()` 阶段就 `publish()` 一次（`ui-theme/lib/client.js:1184-1186 → 1264-1267`）；
  随后 wallpaper 的 `overrideTokens`（`dsh-wallpaper/lib/client.js:207`）再 `publish()` 一次
  ⇒ 启动期**至少两次发布**，且 token 内容确实变化（叠加了透明度 0.88 的 `--dsw-alias-bg-base`）。
  **因此首开确实合法击穿跳过分支 ≥1 次——这是设计内行为，不是缺陷。**
- **每事件重放（缺陷本体）**：每个 `theme/change` 都重新落地一次 token（修复前的行为）。
  在本实验的两个窗内，**A 臂 token 落地数 = 0**，即**该缺陷在"全新页面点设置"这条路径上不存在**。
- **诚实边界**：启动期的**精确** apply 次数本实验为 **INCONCLUSIVE**。原因：DOM 相关 hook 必须等
  `<body>/<head>` 出现才装（init script 早于两者），而 `boot.tokenWrites=1 / tokenRetractions=0`
  与"两次完整 apply"的预期（约 40 写 + 40 撤 + 40 写）**不自洽**，说明**首个 apply 的部分写入
  落在 hook 安装之前**。故启动期只报**结构性事实**（发布次数、meta 节点反复重建、活动截止于 1.6 s），
  **不**报告启动期 apply 的精确计数。窗口内（PRE/POST）的计数不受此影响——当时 hook 早已装好，
  且有 S2/S3 同页自证。

---

## 3. 时间线证据：rAF 延后写入是否与点击帧竞争（Q3）

- PRE 窗（点击前 3 s）：`bodySet=0, bodyRem=0, gcsBody=0, metaContentWrites=0`；raf ≈ 60/s，p95 16.8 ms，长任务 0。
- 点击（真实 `page.mouse`，`noWaitAfter`）：调用返回 ~67 ms（含 Playwright 往返）。
- POST 窗（点击后 3 s）：与 PRE **逐项相同**（全 0；raf ≈ 59.9/s，p95 16.7 ms，长任务 0）。
- 点击后文档 +171 节点（面板挂载），但窗内 `longtask=0`、`csstext/style/layout=0 ms`。

**帧机制（与 `proof/callsite-timing-analysis.md` 一致）**：`apply()` 末尾调
`scheduleThemeColorRefresh`（`:449`），它把 presenter 放进 per-window 队列并**只安排一次**帧回调
（模块级 `themeColorFrame` 单计数器，`:348/:372`）；回调在**下一次渲染机会的 rAF 阶段**执行
`refreshThemeColor()`（`:377 → :472`），其中 `getComputedStyle(document.body)`（`:475`）会强制一次
**全文档样式重算**。点击是离散用户交互，React 在同一任务内同步提交；**在帧的渲染步骤中注册的 rAF 回调
不能在该帧运行** ⇒ 若真有真实主题写入发生，它就落在点击提交**之后的那一帧**（同一次渲染更新），
对刚提交的面板再压一次强制重算。
**但本实验证明这条竞争路径在"点设置"上根本没有被触发**（A 臂 metaW=0/gcs=0），
因为点击不改变 token 签名，`apply()` 即便被调用也走 `:426` 提前返回，`:449` 根本不会执行。

---

## 4. 那么"点设置还是卡"是什么在花时间？（把靶子摆正）

本实验支持"主题链不是原因"，且**指认了剩余成本的形态**：

1. **成本不在 JS / 样式重算**：点击窗内 `longtask = 0`、`csstext+style+layout = 0 ms`、
   `ScriptDuration` 无异常抬升。这与"主题链（每次都强制同步重算）"的旧靶点**完全不同源**。
2. **面板是重合成路径**：`VOzbGW_mask` 带 `backdrop-filter: var(--dsw-mask-blur)`（全屏 fixed 遮罩），
   `VOzbGW_panel` 带 `box-shadow: var(--dsw-shadow-lv3)` 与 `border-radius:24px`；
   面板一挂（+171 节点）就要**重新合成**整屏，并叠加一个 `z-index:-1` 的 wallpaper 层 + 半透明
   `--dsw-alias-bg-base` 着色。⇒ 卡顿形态应是**合成/绘制**，不是主线程脚本。
3. **wallpaper 侧确有"每次设置开合都要付"的固定动作**（与主题是否变化无关，来自
   `proof/wallpaper-analysis.md`）：设置行的 mount effect 会 `sync()`（`dsh-wallpaper/lib/client.js:400-403 → 518-522 → 348-350`），
   而 `applyWallpaper` 在 `sameShadedTokens` 守卫（`:204`）**之前**就对 `:255 backgroundImage`、
   `:257 filter`、`:260 ensureMaskElement()`、`:261 maskEl.style.background` 无条件写了一遍；
   设置行本身还渲染一张全尺寸预览 `<img src=config.source>`（`:453`）⇒ **一次图片解码**。
   本实验的观测与之相容：A 臂窗内 `bodyNewNodes=2`，叠层节点身份**不变**（无重建），
   而 XP 窗 `bodyAttrChanges=0`——说明这些写与旧值相同（CSSOM 视为 no-op，不产生属性变更记录）。
4. **并发现场还有第三条线给出的同源线索**：`clickMs = 2549`（其驱动的采样，含等待口径，不能直接当延迟），
   但其节点增量（+171）与本实验一致。

**建议的下一步（不在本任务授权内，未执行）**：把取证转到
**合成/绘制**（`LayerTree`/`paint` 计数、`--dsw-mask-blur` 的成本、面板首帧的合成层数量），
以及 wallpaper 设置行的**预览图解码**；继续在主题链上加探针**不会有收益**（已证明零工作）。

---

## 5. 修复的副作用评估（Q3 的第二问）

| 候选副作用 | 裁决 | 证据 |
|---|---|---|
| rAF 延后把 `theme-color` 写入推到点击帧 | **未发生** | A 臂 POST `metaContentWrites=0`；链在 t≈1.6 s 后完全静止 |
| rAF 延后与首开渲染争同帧 | **未发生** | 首开只有 2 次 meta 内容写入（`boot.metaContentWrites=2`），且在 1.6 s 前结束；18.4 s 静止期内无任何再安排 |
| 签名跳过被首开 token 变化"合法击穿" | **发生，且属设计内** | `lastSignature` 初值 `undefined`（`:387`）；偏好 light≠system + wallpaper 叠加各发布一次 ⇒ ≥1 次完整 apply。**一次**，非每事件 |
| `themeColorFrame` 单计数器导致的**跨窗口**丢弃 | **理论存在，未在本实验触发** | `themeColorFrame` 是模块级单计数器（`:348/:372`）而队列是 per-window（`:347/:366-369`）⇒ 另一窗口的调度会被静默丢弃；本实验单窗口，未观察到 |
| 跳过分支使 `refreshThemeColor` 的幂等守卫与 `pendingTokenSignature` 失配 | **未观察到** | `:474/:476` 每窗按签名幂等；本实验单窗口且窗内无 apply |

---

## 6. 结论（一句话）

**"全新页面点设置仍然卡"这条路径上，主题链在点击瞬间的可测成本是零（apply 落地 0、body 写 0、
meta 写 0、getComputedStyle(body) 0、长任务 0、样式重算 0 ms）；修复后的签名跳过分支在这里根本
没有被触发，所以不存在"把成本移位到点击帧"的问题；主题链的全部活动集中在页面打开后 1.6 秒内
（首开的合法放行 + 启动期展示器反复重建），此后完全静止。剩余卡顿的证据形态指向设置面板
（`<dialog>`，+171 节点）的合成/绘制成本（`backdrop-filter` 遮罩 + wallpaper 层 + 预览图解码），
而非脚本或样式重算。**

---

## 7. 复现

```bash
cd .workspace/lag-fix/incident2/theme-open
node theme-open-ab.mjs --all --settle 5000 --gatewait 45000 --maxforeign 2 --a 3 --e 3 --c 3
node analyze.mjs --json verdicts.json
```

- `raw/theme-open-<label>.json`：逐 run 原始计数、事件时间线、自证结果、门禁/竞争记录。
- `proof/wallpaper-analysis.md`：wallpaper 叠层重建路径与 (iv-a) 写入级守卫边界（含一处**新缺陷**：
  `shadedTokens` 在 dispose 时未清空，`dsh-wallpaper/lib/client.js:244-245/272-273` ⇒
  "设壁纸→移除→同图同透明度重设"会命中 `:204` 提前返回而**不再注册着色层**；静态推断，未活体确认）。
- `proof/callsite-timing-analysis.md`：`apply` 调用点、rAF 合并机制、启动期发布序列与全局可达性负结论。

## 8. 本实验**未**覆盖 / 明确不做

- 未点保存/应用/删除；未改任何持久设置（E 臂的主题切换**当场回滚**）。
- 未改产品文件（只 patch 页内 Web API）；未重启/pkill 宿主 10806。
- 未测有头（headed）模式、未测真实鼠标以外的手势、未测长会话页面变体。
- 未对 wallpaper 的"着色层不重注册"缺陷做活体确认（超出本任务范围）。
