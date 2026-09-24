# audit.md — W11：设置弹窗「观感回退」审计与方案交付

- 线：`program/w11-mask-look`（独占目录 `.workspace/lag-fix/program/w11-mask-look/`）
- 宿主：PID 301709 `node …/dsh web`　**全程未重启、未改任何产品文件、未对任何浏览器发信号**
- GUI：`http://127.0.0.1:3080`（真实 Google Chrome 153.0.8010.52，headless，Playwright `channel:'chrome'`）
- 日期：2026-09-22
- 上游契约：`exec-mask/report.md`（§5.5 桥接：`blurOnly` 与审计臂同为 LoAF 0 条；`scrimOnly ≈ normal` ⇒ 代价钉在 blur 上）、`exec-audit/BATCH-PLAN.md` §五（判据规则 19/20）
- 本档性质：**只读审计 + 方案设计 + 实测裁决**；`audit.md` / 原始 JSON / 截图对比全在本目录

---

## 0. 裁决摘要（TL;DR）

**用户诉求**：设置弹窗「观感变化」要回退 —— 恢复**背景模糊的观感**，同时**保留已获得的流畅度**。

**本档最重要的机制发现（推翻了一条前提）**：

> **模糊的代价不是"持续"支付的，而是"逐次重绘"支付的。**
> 弹窗**静态停留**时，`blur(2px)` 的代价 = **0**（3 个 run、9 个空闲相窗口全部 `LoAF=0`、帧间隔上限 16.9 ms，与"已删除模糊"的臂**不可区分**）；
> 代价只出现在**会让遮罩背后重绘的交互帧**上（每次交互相 1–6 条 LoAF、单帧 63–137 ms）。
> ⇒ **①「只在开合动画期启用模糊」的前提（"静态交互期要付持续代价"）不成立**，且设置弹窗 CSS 里**根本没有任何动画可挂**（见 §4.①）。

**推荐顺序（按"观感收益 ÷ 风险"）**：

| 序 | 方案 | 观感（环带像素差 vs 真模糊） | 代价（LoAF / 帧>50ms） | 实现面 | 判定 |
|---|---|---|---|---|---|
| **1** | **②′-环带（ring bands）** | **0.0235 %**（1 px 级带缝，人眼不可辨） | **LoAF 1 条 / 27 窗口**、**>50 ms 帧 6 个**（对照 blur2 = 45 条 / 44 个） | 仅 `dsh-client-ui-settings-general` 自己的模块 CSS/JSX，**热面** | ✅ **推荐** |
| 2 | ③-a 内容预模糊（`filter` 打在遮罩下内容上） | 0.4063 % | **0 条**（= 现状） | 需跨包碰 AppFrame 子元素（脆弱） | ✅ 可行（次选） |
| 3 | ④-b 壁纸预模糊（已发货的 `wallpaper.blur`） | 1.6692 %（只恢复壁纸柔化，UI 仍锐） | **2 条** | **零代码**（改设置） | ✅ 兜底（部分观感） |
| 4 | ① 只在开合动画期启用模糊 | ≈ 现状（静态期仍无模糊） | ≈ 现状 + 开窗瞬间一次卡顿 | 需**新写**动画 | ❌ 否决 |
| 5 | ② clip-path 裁到面板盒 | **58.8 均差 / 99.99 % 像素变**（连 scrim 一起裁掉） | 29–63 条（没省下来） | 一行 CSS | ❌ 否决（双向失败） |
| 6 | ④ 降低半径 `blur(1px)`/`blur(0.5px)` | 9.16 % / 14.26 %（几乎等于"无模糊"） | **13–17 条（与 blur(2px) 无差别）** | 一行 | ❌ 否决（**剂量曲线是平的**） |
| 7 | ⑤ 维持现状（模糊关闭） | 15.32 % | 0 条 | 已落地 | — 回滚基线 |

**如果只能选一个**：**②′-环带**。它用"把全视口模糊拆成环带 4 块"这一个几何改动，把**观感恢复到人眼不可辨的程度**（残差 0.0235 %、max 8/255，且集中在两条 1 px 带缝上），同时把代价从 **45 条 LoAF / 44 帧>50 ms** 压到 **1 条 / 6 帧**，且完全落在设置插件自己的代码里（无跨包 DOM、无 portal、无 React 挂载点变更、刷新即生效、`cp` 一步回滚）。

---

## 1. 结论对上游契约的承接与修正

| 上游结论 | 本档处置 |
|---|---|
| 删除 `backdrop-filter` ⇒ LoAF 35→0、wall 84→19 ms（exec-mask §5.5） | ✅ **独立复现**：`shipped` 臂 3 个 run × 9 相 = **0 条 LoAF、0 帧>50 ms**（§3.2） |
| `blurOnly` 与 `both` 同一个零 ⇒ 代价唯一钉在 blur 上 | ✅ 采用（本档未重复 2×2；本档新增的是**机制**与**方案空间**） |
| 观感差异只在"面板外那一圈"（面板内部 0.0008/255） | ✅ **独立复现**：所有臂的 `panelCore` 平均差 0–0.0045/255、>2/255 占比 ≤0.03 %（§5） |
| 上游列的三条备选路径 (a) 删除 /(b) 动画期启用 /(c) 裁剪到面板 | (a) 已落地；(b) ❌ 前提不成立（本档 §4.①）；(c) ❌ **实测双向失败**（§4.②）——本档给出 (b)/(c) 之外的**第 4 条路**：**环带**与**内容预模糊** |

---

## 2. 器械、判据与批内自證

### 2.1 器械

| 项 | 值 |
|---|---|
| 浏览器 | **真实 Google Chrome 153.0.8010.52**（`channel:'chrome'`，headless，`--no-sandbox --disable-dev-shm-usage --force-renderer-accessibility`；UA 逐 rep 读回） |
| 视口 | **2560×1440 @ deviceScaleFactor 2**（用户真实窗口尺寸），每个臂全新 context（`locale:'zh-CN'`） |
| 待测字节 | **真字节**替换：`context.route()` 用候选字节应答真实 bundle URL `/plugins/@deepseek-ai/dsh-client-ui-settings-general/client.js`（**非页内样式 hack**） |
| 字节基线 | pre-image `9298ac5b…`（26630 B，含 `backdrop-filter:var(--dsw-mask-blur);` 恰好 1 次）；已落地候选 `bd7edeae…`（26593 B，该声明 0 次）——**两者 sha 均与本档独立复算一致** |
| 相序列（9 相/臂/rep，弹窗一次性打开、全程不关） | `IDLE_OPEN_1` → `NAV_general` → `SCROLL_general` → `NAV_models` → `NAV_plugins` → `TAB_pluginsList` → `SCROLL_pluginsList` → `IDLE_OPEN_2` → `NAV_general_back` |
| 臂序 | 同 rep 内**连续**跑完所有臂（同 rep 相邻配对） |
| 交互白名单 | 只点设置/导航/子标签/滚动；**未点保存/应用/删除** |
| 判据 | **主判据 = LoAF**（`duration` 与条数）；**副判据 = wall-clock rAF 帧间隔**（回调入口 `performance.now()`，**不是** `ts` 参数）；`framesGt50`/`ts` 仅作相对 KPI（分辨下界 ≈40–50 ms，规则 19⑤） |
| 附加通道（本档新增，**通道无关**） | ① `document.getAnimations()` 逐相普查（含动画属性与目标是否在遮罩背后）；② MutationObserver "churn" 计数（style/class + childList），**带自测阳性对照**；③ 截图 + 逐像素分区差（含**空对照**） |

### 2.2 批内自證（规则 19/20 要求，每批自带）

| 批次 | rep | 引擎 | 前台帧率（显式探针） | trace 事件 / `RunTask` | 阴性对照（3 s 不注入） | 阳性对照（**页内 setTimeout** 忙等 120 ms） | 地面真值 `RunTask` |
|---|---|---|---|---|---|---|---|
| run1 `063959Z` | 1 | Chrome 153.0.8010.52 | 63.6 Hz | 118 750 / 27 364 | 174 帧、中位 16.7、max 93.8、gt50 **1**、LoAF **2** | wall 135.2 / LoAF 1条 135.2 ms | **120.24 ms** |
| run1 | 2 | 同 | 65.0 Hz | 92 670 / 20 841 | 174 帧、16.7、max 84.6、gt50 **1**、LoAF **2** | wall 133.9 / LoAF 133.8 ms | **120.55 ms** |
| run1 | 3 | 同 | 64.6 Hz | 95 403 / 21 892 | 180 帧、16.7、max 17.4、gt50 **0**、LoAF **0** | wall 132.5 / LoAF 132.3 ms | **120.16 ms** |
| run2 `065133Z` | 1–3 | 同 | 61.9–66.8 Hz | 66–146 k / 15–24 k | **3/3 干净**（180 帧、max 16.9–17.5、gt50 0、LoAF 0、LongTask 0、RunTaskMax 0） | wall 120.6–132.0 / LoAF 1 条 120.5–131.9 ms | **120.18–120.54 ms** |
| run3 `070050Z` | 1–3 | 同 | 61.9–64.8 Hz | 66–105 k / 14–24 k | 2/3 干净（rep2 有 1 帧 59.8 ms / LoAF 1，已如实保留） | wall 120.6–132.0 / LoAF 1 条 120.5–131.7 ms | **120.18–120.37 ms** |

- **阳性对照四通道全部检出同一个 120 ms 块**（`RunTask` 120.16–120.55 ms、wall 120.6–135.2、LongTask 恰 120 ms、LoAF 1 条 ≈120–135 ms）⇒ **主判据与副判据都活着**，且**阳性对照按规则 19 用页内 `setTimeout` 注入**（不是 CDP `evaluate`）。
- **阴性对照在 5/6 个窗口完全安静**；run1 的 rep1/rep2 各有 1 帧 >50 ms 与 2 条 LoAF（环境负载，见 §2.3）——**如实保留，未剔除**。
- **churn 通道自测**：每个臂在开窗前做一次真实 DOM 变更阳性对照，`detected=true` 才继续（避免 I2 式"结构性空洞零"）。

### 2.3 并发记账（**不声称机器安静**）

- 三个 run 均为 `lockMode = concurrent`：共享锁被兄弟线持有（`w08-boot` / `w07-streaming`，均 **ALIVE**）⇒ **按纪律不回收、不夺取**，并发运行并如实记账。
- 逐 rep 实测 `foreign`（cmdline 口径）= **18–37** 个浏览器主进程（含用户真实 Chrome 494362、snap Firefox 547226 与兄弟线实例）；`loadavg` **6.5–8.7**。
- **判据只用同 rep 相邻臂配对**，不做跨批绝对比较；另设**基于规则的污染判据**（§3.4）。

---

## 3. 机制：代价在哪里、什么时候付

### 3.1 事实 A — **静态停留零代价**（这是本档最关键的一条）

| 臂 | `IDLE_OPEN_2`（交互全部结束后、静止 3 s 采样窗）逐 rep LoAF 条数 / 帧间隔上限 |
|---|---|
| `blur2`（blur(2px)） | run1 **0/17.0 · 0/16.9 · 0/17.2**；run2 **0/16.9 · 0/16.9 · 0/17.2**；run3 **0/17 · 0/43.1 · 33/90.9\*** |
| `blur1` | 0/17.0 |
| `blur05` | 0/17.0 · 0/16.8 · 0/20.1 |
| `shipped`（无模糊） | 0/16.9（全部 9 个实例） |

\* run3 rep3 是**被外部负载污染的一段**（见 §3.4），不计入。

⇒ **模糊在场、弹窗静止时，合成器不重跑模糊**（缓存复用）；与"无模糊"不可区分。**"持续代价"这一前提被否证。**

### 3.2 事实 B — **代价按"次"付，随交互重绘出现**

| 臂 | 交互相 LoAF Σ（3 rep×7 相） | 空闲相 LoAF Σ（3 rep×2 相） | 单帧 wall 上限 |
|---|---|---|---|
| `blur2` | **44**（run1）/ 44（run2） | 3 / 0 | 128.8 / 137.6 ms |
| `shipped` | **0** | 0 | ≤36.7 ms |

逐相（`blur2`，中位/上限）：`NAV_general 0–1`、`SCROLL_general 1`、`NAV_models 2`、**`NAV_plugins 5`**、`TAB_pluginsList 2`、**`SCROLL_pluginsList 3`**、`NAV_general_back 1`。**3 个 run 的逐相指纹几乎逐位复现**。

### 3.3 事实 C — 代价与"DOM 变更"**不**一一对应，与"重绘/失效"对应

- `SCROLL_*` 相 churn（style/class + childList 变更）= **0**，却稳定出现 1–3 条 LoAF ⇒ **不需要 DOM 变更就能触发**；
- `NAV_general`（点已激活的导航）churn 0–4，LoAF 0–1；
- `NAV_plugins`（挂载 1820 节点）churn **26**，LoAF **5–6**（最重）。
⇒ 触发量是"**遮罩背后发生的绘制失效**"，DOM 变更只是它的一个常见来源。**这解释了为什么"按面积/按半径"省钱都收效有限，而"让失效不落在被模糊的元件上"才有效**（§4.②′）。

### 3.4 污染判据（事前注册，基于规则而非事后叙事）

`IDLE_OPEN_2` 在两个独立 run、12 个臂实例中恒为 **LoAF 0**；而模糊在场时静态窗**结构上不应有代价**（事实 A）。故：

> **规则 W11-R1**：任一臂窗口若 `IDLE_OPEN_2` 的 LoAF > 0，则该 rep 的**该臂窗口判为环境污染**，其读数标注但**不作为主判据**。

据此标注：run2 rep2 的 `blur05`（6）与 `clipPanel`（6）；run3 rep3 的 `blur2`（33，该 rep 连 `IDLE_OPEN_1` 也有 29 条）。**全部原始数据保留在 JSON 中，未删除任何窗口。**

---

## 4. 逐方案：可行性、成本、观感

### ① 只在开合动画期间启用模糊 —— ❌ **否决（前提不成立 + 无动画可挂）**

**（1）设置弹窗现在有没有动画？—— 两条独立证据都说没有：**

| 检查 | 结果 |
|---|---|
| 本档**运行时**普查（`document.getAnimations()` 在点击开窗后以 rAF 逐帧采样 1.6 s，97 个样本） | 全程**只有**外壳的 `_dsh-state-dot-chase_10orb_1`（状态点动画），**没有任何动画/过渡的目标是遮罩、面板或 overlay** |
| 本档**静态**规则普查（遍历 95 张样式表，含全部 `data-plugin-css`） | `@keyframes` **33** / `animation` **58** / `transition` **81** —— **但设置插件族的 3 处全部无关**：`PluginInventorySettingsTab .qSYn7G_chevron{transition:transform .14s}`、`ModelsSection .zGbnIq_customizedSummary::before{transition:transform/none}`；**`SettingsRoot.module.css`（22 条规则）里 `animation`/`transition`/`@keyframes` = 0** |
| 独立静态档（`audit-static.md` A1，另一档） | `settings-general`：`@keyframes`=0、`animation`=0、`transition`=0、`requestAnimationFrame`=0；面板是 `open && <SettingsPanel/>`（`:213`）⇒ **瞬开瞬关** |
| 参照物 | 同仓库里**确实有**带淡入的遮罩：附件拖放层 `.BInVoG_mask{animation:BInVoG_fade-in}` —— 说明"给遮罩加动画"有先例，但**设置弹窗这条线上不存在** |

**（2）因此本项 = 新写一个动画（新增行为），而不是"恢复"。**

**最小新增方案（供裁决，不建议采用）**：
```css
/* SettingsRoot.module.css —— 新增 2 条规则；不改既有规则 */
@keyframes w11-mask-in { from { backdrop-filter: var(--dsw-mask-blur) } to { backdrop-filter: none } }
.VOzbGW_mask { animation: w11-mask-in 200ms var(--ds-ease-in-out) both }
```
- 关闭相需要**额外 JS 状态机**（延迟卸载 ~200 ms）才能有对称的出场；
- 需补 `@media (prefers-reduced-motion: reduce)` 守卫（该文件当前 `@media` 计数为 **0**）。
- **验收**：(i) 开窗 +40/+120/+300 ms 截图应分别显示"模糊→渐消→无模糊"；(ii) 静态期 LoAF = 0（= `shipped`，本档已证静态期本来就 0）；(iii) 开窗相代价被限制在 ~12 帧内；(iv) **观感**：需用户确认"只在 200 ms 动画期内模糊"是否满足诉求。
- **本档判断**：**不满足诉求**。用户停留观察的时段**恰恰是静态期**，而本档已证明静态期**本来就不付代价**（事实 A）⇒ 该方案**主动放弃了它想保留的观感，却换不来任何流畅度**；并且把一次 60–130 ms 的重模糊挪到了开窗瞬间（新增一次卡顿）。

**①′ 变体（"静止时模糊、交互瞬间撤掉"）**：机制上**可行**（静态 = 免费，交互 = 撤回），但需要 JS 看门狗 + 交互监听，且**每次点击/滚动模糊都会肉眼可见地"跳一下"**，观感比"一直模糊"或"一直不模糊"都差；而 ②′ 环带能在**保持模糊常开**的前提下把代价压到 1 条 ⇒ **①′ 被 ②′ 严格支配**，不再单列。

---

### ② 把模糊裁剪到面板包围盒 —— ❌ **否决（观感崩坏 + 代价没省）**

**结论先行**：用 `clip-path` 把整块遮罩裁到面板盒，**会把 scrim（变暗）一起裁掉**，环带立刻变成"没变暗也没模糊"的亮背景。

实测（`clipPanel` 臂，真字节 pre-image + 页内 `clip-path: inset(320px …)`）：

| 指标 | 实测 | 对照 |
|---|---|---|
| 环带区域平均像素差（vs `blur2`） | **58.82 / 255** | `shipped` 仅 1.111；噪声地板 0.0006 |
| 环带 >2/255 像素占比 | **99.9989 %** | `shipped` 15.32 % |
| LoAF Σ（3 rep×9 相） | **31**（run1，reps2–3） | `blur2` 45–47，`shipped` **0** |

⇒ **它既没买到观感（反而把 scrim 弄坏了），也没买到流畅度（只降约 1/3）。** 上游 §2.1 的推理（"面板不透明 ⇒ 裁到面板盒的可见结果等于删除模糊"）**在本档实测中被证伪**：可见结果不是"等于删除模糊"，而是"连变暗也一起消失"。

**②′（本档新增、唯一可行的 ② 族方案）：把模糊**拆成环带**，只覆盖它真正可见的地方**

- **构造**：把"1 个全视口 `backdrop-filter` 元件"换成"**环绕面板的 4 块矩形**"（上/下/左/右），每块都带 `background: var(--dsw-alias-bg-mask-1)` + `backdrop-filter: var(--dsw-mask-blur)`，四块拼满**除"面板盒内缩 32 px"以外的全部视口**（内缩量必须 ≥ 面板 `border-radius:24px`，否则圆角缺口会露出未变暗的背景）。面板（`z-index:1`，不透明）依旧盖在中间 ⇒ **观感与原件在构造上等价**，唯一差别是**没有元件覆盖面板盒区域**（那片区域本来就不可见）。
- **代价**：见 §5 —— **LoAF 1 条 / 27 相窗口（对照 `blur2` 45 条）、>50 ms 帧 6 个（对照 44 个）、帧间隔上限 59.9 ms（对照 137.6 ms）**。
  - **归因强度（如实）**：同一 rep 内 `shipped` 的相内上限为 17–36.7 ms，而环带臂在 **3 个 rep 的同一批相**上稳定落在 **35.8–59.9 ms** ⇒ 方向与量级一致，支持"这是环带自身的残余代价"；但**臂序未随机化**，不能排除环境成分（见 §8 L7）。
- **观感**：见 §5 —— 环带像素差 **0.0029 均值 / 0.0235 % >2/255**（噪声地板 0.0006 / 0.0029 %；`shipped` 1.111 / 15.32 %）⇒ **人眼不可辨**（§6 视觉复核原文："indistinguishable … no seam line, no value step, no rounding difference"）。
- **残差在哪**：环带 >2/255 的像素**全部集中在 8×8 网格的第 1、6 行**（即两条**水平带缝**：面板上沿 CSS y≈352、下沿 y≈1088 处；网格其余 48 格全为 0），`max = 8/255`，合计 **2 788 像素 = 全图 14.75 M 设备像素的 0.019 %**。**成因**：相邻矩形边缘恰好相接、模糊无法跨块采样。**处置**：默认接受（实测不可辨）；若在用户物理屏上可见，可让左右带上下各**外扩 1 px**与上/下带重叠 —— 代价是重叠处 scrim 叠加会形成 1 px **偏暗**线（`0.24 → 0.42` alpha），属"换一种 1 px 线"，故不作为默认。

---

### ③ 静态快照模糊 —— 字面不可行；**但"预模糊真实内容层"可行且零成本**

**（1）字面上的"快照"在本技术栈内不可实现**（独立静态档 A6 + 本档复核）：
- 客户端栈内 `getContext(` / `toDataURL` / `<canvas` / `html2canvas` / `dom-to-image` / `-webkit-canvas` / `element()` / `filter:url(` **全部为 0 命中**；界面是 DOM 而非 canvas；浏览器也不给页面"给自己截图"的 API。
- 唯一的"快照式"手段（把背景栅格化成位图再模糊）需要引入外部库，**成本与风险远超本诉求**。

**（2）但诉求的实质（"别每帧重算模糊"）可以用另一条路实现：把 `blur()` 打在**真实内容层**上，而不是打在每个失效时刻的 backdrop 上。**

- 机制：`filter: blur(2px)` 作用在一个（相对）静态的子树 ⇒ 合成器把它**栅格化一次并缓存**；此后只有该子树**自身**的内容变化才会重新栅格化，**遮罩上的"backdrop 失效"不再触发全视口重模糊**。
- **实测（`filterContent` 臂，真字节候选 + 页内给"遮罩下方全部内容"加 `filter: blur(2px)`）**：3 rep × 9 相 = **LoAF 0 条 / 0 ms、>50 ms 帧 0 个、帧间隔上限 31.7 ms** ⇒ **与 `shipped` 不可区分**（这正是"零代价"）。
- **观感**：环带像素差 **0.0651 均值 / 0.4063 % >2/255**（`shipped` 为 1.111 / 15.32 %）⇒ **恢复了约 97 % 的差异面积**，残差集中在**视口四周与分栏边界**（`filter` 无法跨元件采样导致的边缘 clamp，`max = 16/255`）。
- **可行性（两形状，风险差别很大）**：

| 形状 | 做法 | 实测/证据 | 风险 |
|---|---|---|---|
| **③-b portal + 单一 filter** | 把设置 overlay 移出内容根（外壳自己的 Modal 就是 `createPortal(…, document.body)` 的先例），再对 `#root` 与 body 级壁纸层各打一个 `filter: blur(2px)` | **本档实测失败（3/3 rep）**：页内 `document.body.appendChild(overlay)` 在相序列中被 **React 重新挂回原父节点**（`ABLATION WIPED: overlay back under div`，无页面异常抛出）⇒ **"偷偷搬 DOM"这条路不稳定；必须在 React 层改挂载点（`createPortal`）**，而该改法本档**无法在页内验证** | **高**（挂载点/focus/z-index/a11y 都要重验） |
| **③-a 兄弟遍历** | 不搬 DOM：从 overlay 往上，逐层给"不在 overlay 路径上的兄弟"加 `filter`（外加 body 级 `z-index<0` 壁纸层） | **本档实测 0 LoAF**（就是 `filterContent` 臂的做法） | **中**（要碰 AppFrame/sidebar 的 DOM，类名是 CSS-module 哈希；且 2 px 视口边缘 clamp 残差） |

**（3）判定**：`③-b` 若走 `createPortal` 则**代价 0、观感 97 %**，但**需要改设置插件的挂载点**（本档实测的"直接搬 DOM"版本被 React 打回，说明这条路上有真实的工程风险）；`③-a` 代价同样 0、观感 97 %，但耦合别的包。**两者都比 ②′ 更"贵"在工程上，而 ②′ 的观感更好（0.0235 % vs 0.4063 %）** ⇒ ③ 降为次选。

---

### ④ 降低半径 / 换更便宜的模糊实现 —— ❌ 半径**无效**；壁纸预模糊**有效但只恢复一部分**

**（1）半径：剂量曲线是平的（真字节变体，只改一处字符串，`node --check` + 逐字节断言通过）**

| 臂 | 送达字节 sha12 | LoAF Σ（每个**干净** rep） | >50 ms 帧 | 单帧 wall 上限 |
|---|---|---|---|---|
| `blur2`（`blur(2px)`） | `9298ac5b0870` | **13 / 15 / 16 / 17** | 44–46 | 128.8–137.6 ms |
| `blur1`（`blur(1px)`） | `fe135ce583cd` | **15** | 15 | 124.7 ms |
| `blur05`（`blur(0.5px)`） | `8948b938f5c6` | **13 / 13 / 17** | 15–78 | 86.2–147.1 ms |
| `shipped`（无） | `bd7edeaec382` | **0** | 0 | ≤36.7 ms |

⇒ **把半径从 2 px 降到 0.5 px（4×），每个 rep 的 LoAF 条数几乎不动**（13–17 对 13–17），单帧代价也没变小（54–147 ms）。**上游 §6.3 的"降级档预期只能削减约一半合成代价"在本档被进一步否证：实测削减 ≈ 0。**
⇒ **④-半径是纯亏**：观感明显变弱（vs 真模糊：1 px 恢复 40 %、0.5 px 几乎等于现状），代价**一点没省**。

**（2）壁纸预模糊（④-b）：栈里**已经发货**的零成本杠杆**

- 事实（独立静态档 A6 + 本档运行时可读回）：`dsh-wallpaper` 有一个**持久化、UI 暴露**的 `wallpaper.blur` 滑块（0–60 px，当前值 **0**），实现是 `wallpaperEl.style.filter = blur(Npx)`，作用在 body 级 `position:fixed; inset:0; z-index:-1` 的**全视口壁纸层**上。该层是静态图 ⇒ **一次栅格化、每帧零成本**。
- 本档运行时可读回：该层确实存在且**确实配置了壁纸图**（`bgImage: url("http://127.0.0.1:3080/dsh-wallpaper/media/37758c1c-…")`, rect 0,0,2560,1440）。
- **实测（`wallpaperBlur` 臂 = 给该层加 `filter: blur(2px)`）**：**LoAF 2 条 / 3 rep、>50 ms 帧 2 个、帧间隔上限 60.8 ms** ⇒ 与 `shipped` 同级（**零成本**）。
  - 诚实披露：该臂第一次跑（run2）**3/3 rep 被判 `ABLATION WIPED`** —— 壁纸插件会按自己的状态重写 `wallpaperEl.style`，把页内注入的 inline filter 覆盖掉（本档据此加了"逐相加回"的钩子，run3 才量到）。**这条对生产实现的含义是正面的**：真实现是改插件自己的 `blur` 配置（由插件自己施加），不会被覆盖。
- **观感**：环带差 **0.4167 均值 / 1.6692 % >2/255**（`shipped` 1.111 / 15.32 %）⇒ 抹掉了**差异面积的大约 89 %**，但**>8/255 的尾部只从 0.96 % 降到 0.87 %**：即**壁纸被柔化了，而 UI 文字/图标的边缘仍然锐利**。视觉复核原文："variant B 的壁纸柔化与 A 几乎一致，但 UI 文字与图标完全锐利"。
- ⇒ **判定**：**零代码、零风险的"部分观感"**；适合作为"不想动代码时的兜底"。它**不能**替代 ②′（用户看到的"背景模糊"里，文字/图标边缘的柔化也是其中一部分 —— `shipped` 与真模糊的差异中，`p99 = 8`、`max = 161` 就出现在这些高对比边缘）。

---

### ⑤ 维持现状 —— 回滚基线

`shipped` = 已落地候选字节 `bd7edeae…`，代价 0（3 run 全零），观感差 15.32 % 环带像素。**作为所有单元的 rollback 目标。**

---

## 5. 观感收益 vs 每帧成本（一张总表）

**代价**（同一器械、同 rep 相邻配对；主判据 LoAF；`*` = 含 §3.4 标注的污染窗口）

| 臂 | LoAF Σ（3 rep×9 相） | 交互相 / 空闲相 | >50 ms 帧 Σ | 单相 wall 上限 | 与 `shipped` 的代价比 |
|---|---|---|---|---|---|
| `shipped`（现状） | **0 / 0 / 0** | 0 / 0 | **0** | ≤36.7 ms | 1× |
| **`filterContent`（③-a）** | **0**（run1，3 rep） | 0 / 0 | **0** | 31.7 ms | **≈1×** |
| **`ringBands`（②′）** | **1**（run2，3 rep） | 1 / 0 | **6** | 59.9 ms | ≈小残差 |
| **`wallpaperBlur`（④-b）** | **2**（run3，3 rep） | 0 / 0 | 2 | 60.8 ms | ≈小残差 |
| `blur1` | 16（1 rep） | 15 / 1 | 15 | 124.7 ms | **≈1×（无改善）** |
| `blur05` | 13 / 17 *（2 rep 干净） | ≈12 / ≈1 | 15–78 | 147.1 ms | **≈1×（无改善）** |
| `clipPanel`（②） | 31 / 63 * | ≈29 / 2–6 | 31–65 | 99.7 ms | ≈0.7× |
| `blur2`（真模糊） | 47 / 45 / 238 * | 44 / 3 | 44–46 | 137.6 ms | **≈3× 上限** |

**观感**（逐像素，2560×1440@2 截图，同一 rep 同一状态；参考 = 同 run 的 `blur2`；**"环带"口径 = 面板盒按 24 CSS px 外扩后的补集**，11.87 M 设备像素 = 全图 80.5 %）

| 臂 | 环带 平均\|Δ\| | 环带 >2/255 | 环带 >8/255 | max | 面板内部 平均\|Δ\| | 判定 |
|---|---|---|---|---|---|---|
| 噪声地板（`blur2` 跨 run 空对照） | **0.0000–0.0006** | **0–0.0029 %** | ≤0.0021 % | 72 | 0–0.0045 | — |
| **`ringBands`** | **0.0029** | **0.0235 %** | **0 %** | **8** | 0 | **人眼不可辨** |
| `filterContent` | 0.0651 | 0.4063 % | 0.036 % | 16 | 0.0009 | 极接近（边缘 clamp 残差） |
| `wallpaperBlur` | 0.4167 | 1.6692 % | 0.8718 % | 161 | 0.0045 | 部分（壁纸柔化） |
| `blur1` | 0.5933 | 9.1563 % | 0.4892 % | 64 | 0 | 明显弱于 2 px |
| `blur05` | 0.9094 | 14.2586 % | 0.738 % | 122 | 0 | 几乎等同现状 |
| `shipped`（现状） | **1.111** | **15.3177 %** | 0.9608 % | 161 | 0.0009 | **这就是"用户想改回来"的差距** |
| `clipPanel` | **58.82** | 99.9989 % | 99.99 % | 207 | 0 | **观感崩坏** |

> 读法：`shipped` 那一行 = **收益上限**（恢复模糊能把环带 15.32 % 的像素改回去，`p99=8`、`max=161`）；`ringBands`/`filterContent` 两行 = **代价**（离"真模糊"有多远）。`panelCore` 一列对**所有**臂都是 0–0.0045/255 ⇒ **面板内部（用户看内容的地方）不受任何方案影响**，与上游"面板不透明"的结论一致。

---

## 6. 截图对比证据

- 截图：`shots/w11-<arm>-<stamp>.png`（2560×1440@2 = 5120×2880，每臂 1 张，run1/2/3 各一套）
- 1:1 裁剪：`shots/crops/<batch>__<arm>__<region>.png`，4 个区域（侧栏文字 / 面板左侧聊天区 / 面板上方 / 面板左上圆角），**52 张**
- A/B 叠图（上=A 下=B，中间红条）：`shots/ab/`
- 逐像素结论：`raw/pixdiff-look.json`

**人工/多模态复核（原始结论摘录）**：

| 对比 | 复核结论 |
|---|---|
| `blur2` vs **`ringBands`**（面板左上圆角，1:1） | 「**They are indistinguishable** … no horizontal or vertical line/seam, no brightness step, no difference in corner rounding, no difference in dimming」 |
| `blur2` vs **`shipped`**（侧栏文字，1:1） | 「TOP（有模糊）字形的边缘发毛、笔画的孔洞被糊住、文件夹图标的缺口消失、背景插画线条糊成色块；**并排看立刻可辨**；单独看多数用户只会觉得"略灰、略糊"」 |
| `blur2` vs **`wallpaperBlur`** | 「壁纸（插画）柔化程度与 A 几乎一致；**UI 文字与图标完全锐利**」 |
| `blur2` vs `filterContent` | 环带 >2/255 仅 0.41 %，残差在视觉外框（clamp） |

> **裁剪尺度说明（必读）**：截图在 DSF=2 下拍摄，裁剪是**设备像素 1:1**（即用户 HiDPI 屏上看到的物理像素尺寸），未做任何缩放；视觉模型提到"看起来比 2 px 更强"即由此尺度决定，**不是**模糊被放大。

---

## 7. 分阶段交付单元（可直接交执行档）

> 通用前提：**热面**（浏览器实际收到的字节与磁盘逐字节相同、模块加载器对 `rev` 无内容哈希校验）⇒ **刷新即生效，无需重启宿主**；所有单元都用同一套验收器械（本目录 `tools/look-arms.mjs`），**判据同为"LoAF 主 + wall-clock 副 + 页内 setTimeout 阳性对照 + 阴性对照 + trace RunTask 地面真值"**；`rollback` 一律 = 恢复 `bd7edeae…`（当前 live）。

### U-W11-A（**首选**）：环带遮罩 —— 把全视口模糊拆成环绕面板的 4 块

- **目标文件**：`~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/client.js`（唯一落点；`VOzbGW_` 前缀的模块 CSS 字符串在**第 28 行**，`backdrop-filter` 全文件恰 1 处，在 pre-image 里）
- **改动**（保持 `.VOzbGW_mask` 元件本身不动 —— 保住 `onClick: onClose`、`aria-hidden`、指针行为）：
  1. `.VOzbGW_mask` 规则改为**不绘制**：`background: transparent; backdrop-filter: none`（保留 `position:absolute; inset:0`）；
  2. 在其 JSX 内新增 **4 个子 div**（`.VOzbGW_ringTop/Bottom/Left/Right`），CSS（纯 CSS、无需 JS 测量，尺寸表达式与 `.VOzbGW_panel` 对齐）：
     ```css
     .VOzbGW_mask{--w11-pw:min(800px,calc(100vw - 48px));--w11-ph:min(800px,100vh - 48px);--w11-ov:32px}
     .VOzbGW_ring{position:absolute;background:var(--dsw-alias-bg-mask-1);backdrop-filter:var(--dsw-mask-blur)}
     .VOzbGW_ringTop{inset:0 0 auto 0;height:calc(50% - var(--w11-ph)/2 + var(--w11-ov))}
     .VOzbGW_ringBottom{inset:auto 0 0 0;height:calc(50% - var(--w11-ph)/2 + var(--w11-ov))}
     .VOzbGW_ringLeft{left:0;width:calc(50% - var(--w11-pw)/2 + var(--w11-ov));top:calc(50% - var(--w11-ph)/2 + var(--w11-ov));bottom:calc(50% - var(--w11-ph)/2 + var(--w11-ov))}
     .VOzbGW_ringRight{right:0;width:calc(50% - var(--w11-pw)/2 + var(--w11-ov));top:calc(50% - var(--w11-ph)/2 + var(--w11-ov));bottom:calc(50% - var(--w11-ph)/2 + var(--w11-ov))}
     ```
     `--w11-ov: 32px` **必须 ≥ 面板 `border-radius:24px`**（否则圆角缺口露出未变暗背景）。
- **验收（同器械、3 rep、2560×1440@2）**：
  1. **主判据**：`ringBands` 臂交互相 LoAF **≤ 2 条**（本档实测 1 条；对照 `blur2` 44–47、`shipped` 0）、`>50 ms 帧 ≤ 8`（实测 6；对照 44–46 / 0）；
  2. **观感**：环带像素差 vs `blur2` **≤ 0.05 均值 且 ≤ 0.1 % >2/255**（实测 0.0029 / 0.0235 %；噪声地板 0.0006 / 0.0029 %）；
  3. **功能回归**：点击环带关闭、Esc 关闭、面板内点击不关闭、焦点陷阱、`aria-hidden` 不变；`--w11-ov ≥ border-radius`；
  4. **回滚**：恢复 `bd7edeae…` 字节（`cp` 一步）。
- **已知残差**：两条 1 px 水平带缝（`max 8/255`，视觉不可辨）；若物理屏可见，改用"左右带上下外扩 1 px"（代价：重叠处 scrim 叠加成 1 px 偏暗线）。
- **未验证的优化（可选后续单元）**：把 `--w11-ov` 收到 0、另用**不带 blur 的 scrim 补丁**盖住面板圆角缺口 —— 预期可把残差代价（各交互相 35–45 ms 的 floor）清零，**但这只是预测，未实测**。

### U-W11-B（次选，若不允许动遮罩结构）：内容预模糊（③-a）
- 落点同上（或改 `SettingsRoot` 挂载点走 `createPortal`，见 ③-b）。
- 改动：overlay 打开期间给"遮罩下方全部内容"（body 级 `position:fixed; z-index<0` 壁纸层 + 从 overlay 逐层向上的**非路径兄弟**）加 `filter: blur(var(--dsw-mask-blur))`；关闭时移除。
- 验收：同 U-W11-A 的第 1、3 条（LoAF ≤ 2），观感放宽到 **≤ 0.5 均值 / ≤ 1 % >2/255**（实测 0.0651 / 0.4063 %，残差在视口边与分栏边界的 clamp 带）。
- **风险**：碰别的包的 DOM（CSS-module 哈希类名）；**若改挂载点**，本档实测"页内直接搬 DOM"会被 React 打回（3/3 rep），**必须在 React 层用 `createPortal`**，且需重验 focus/z-index/`position:fixed` 包含块。

### U-W11-C（零代码兜底）：壁纸预模糊
- 改动：把设置里的 `wallpaper.blur`（0–60 px，当前 **0**）设为 **2**；无代码、无重启。
- 验收：LoAF 保持 0（实测 2 条/3 rep）；观感明确为**部分**（环带 ≤ 2 % >2/255，实测 1.67 %），**UI 文字仍锐**——须在交付说明里写明，避免被误当成"完整恢复"。

### U-W11-D（**不推荐**，仅为裁决留档）：① 的开合动画
- 见 §4.① 的最小新增方案与验收；**采纳前提**是用户明确要一个新的"聚焦进入"动效，而不是"恢复原观感"。

### U-W11-E（纪律单元，任何一项落地都必须带）
- 落地后**必须**用本档器械重跑一次 `--arms shipped,<新臂>,blur2 --reps 3 --shot`，并把**污染窗口（§3.4 规则 W11-R1）如实保留**；禁止只报最干净的窗口。

---

## 8. 未验证 / 局限 / 诚实边界

| # | 项 | 状态 |
|---|---|---|
| L1 | **真实物理屏体感** | **未验证**：全程 headless，无显示栈。本档迁移的是"效应方向 + 同 rep 配对结论 + 逐像素差"，**不是绝对帧数**（本机 headless 无分数缩放重采样、无 AMD Raphael 核显合成、无 mutter）。 |
| L2 | **① 的"开合动画"方案** | 未实测（本档只做了静态 + 运行时"无动画"确证）。其代价推断（开窗瞬间一次 60–130 ms 重模糊）来自 `blur2` 的单帧实测，**未直接测量动画档**。 |
| L3 | **②′ 的残差优化（ov=0 + 圆角 scrim 补丁）** | **纯预测，未实测**。 |
| L4 | **`portalFilter`（③-b 的"直接搬 DOM"版）** | **测量无效**：3/3 rep 被 React 打回（`ABLATION WIPED`），其 0 LoAF 与截图为**混合状态**，**不得引用**。真正的 `createPortal` 版未测。 |
| L5 | **`wallpaperBlur` 首次运行** | run2 3/3 rep 被插件自身重写覆盖 ⇒ 判 INVALID；run3 用"逐相加回"钩子后量得 2 条 LoAF。**该臂的观感证据来自 run3（与 run2 一致，像素数字逐位相同）。** |
| L6 | **污染窗口** | run2 rep2（`blur05`/`clipPanel` 的 `IDLE_OPEN_2` = 6）、run3 rep3（`blur2` 全相偏高，含 `IDLE_OPEN_2` = 33）**已按规则 W11-R1 标注并保留在 JSON**，未删除。`clipPanel` 的 run2 读数（63）受此影响，主判据采用 run1（31）。 |
| L7 | **臂顺序未做 counterbalance** | 臂序固定；本档判据全部是同 rep 相邻配对，且关键结论（0 vs 45）跨 3 个 run 复现，但**未排除顺序混杂**。 |
| L8 | **`framesGt50`/`ts` 口径** | 依规则 19⑤ 只作相对 KPI（分辨下界 40–50 ms），**未**用它下"无 25–45 ms 停顿"的结论。 |
| L9 | **其它全视口遮罩** | `fNh4Da_mask`（灯箱）、`BInVoG_mask`（拖放，10 px）、shell `Modal`、`_onboardingMask_*`、第三方 `dsh-btw` 遮罩**均未测、未改**；`--dsw-mask-blur` 的其它 2 个存活消费者（shell Modal、附件灯箱）**不在本轮范围**。 |
| L10 | **`audit-static.md` 为另一档产出** | 本档采用其计数（A1/A5/A6）时已在文中注明；本档**独立复现**了 A1（运行时 + 静态规则普查）与壁纸层存在性（运行时 `bgImage` 读回）。 |

---

## 9. 产物清单与复现命令

| 路径 | 内容 |
|---|---|
| **`audit.md`** | 本文件 |
| `audit-static.md` | 另一档的只读静态审计（A1–A6 + 方案空间），509 行 |
| `raw/recon-dom.json` | 只读 DOM 侦察：样式表规则普查、令牌链、遮罩/面板/祖先链/`position:fixed` 清单、开窗期 `getAnimations()` 97 样本、空闲 churn |
| `raw/look-20260922T063959Z.json` | run1 原始数据（臂：`blur2, shipped, blur1, blur05, clipPanel, filterContent`；3 rep） |
| `raw/look-20260922T065133Z.json` | run2 原始数据（臂：`blur2, shipped, blur05, clipPanel, ringBands, wallpaperBlur`；3 rep） |
| `raw/look-20260922T070050Z.json` | run3 原始数据（臂：`blur2, portalFilter, wallpaperBlur`；3 rep） |
| `raw/look-20260922T063801Z.json`、`raw/look-20260922T063838Z.json` | **预检/烟测批**（2–3 臂、缩短相时长），**不作为判据**，仅用于器械调试留痕 |
| `raw/pixdiff-look.json` | 逐像素分区差（含跨 run 空对照、4 区域、8×8 网格） |
| `raw/static-a1a5.json`、`raw/static-a6.json` | 静态审计的机器可核计数 |
| `logs/look-*.log`、`logs/recon-dom.log` | 逐批运行日志（含逐臂逐相 LoAF 打印） |
| `shots/w11-*.png`（**14 张**：`blur2`×4、`shipped`×2、`wallpaperBlur`×2、`blur1`/`blur05`/`clipPanel`/`filterContent`/`ringBands`/`portalFilter` 各 1）、`shots/crops/*.png`（**52 张** 1:1 裁剪）、`shots/ab/*.png`（**5 张** A/B 叠图） | 截图、1:1 裁剪、A/B 叠图 |
| `shots/prelim/*.png`（9 张） | **预检**：用**上游 exec-mask 的** A/B 截图（`mask2k-r1-normal/patch`）裁出的 1:1 对照（含 3 张叠图），用于在自建器械就绪前先取得一次观感复核；**不作为判据**（跨臂非同批截图，仅作定性参考） |
| `tools/look-arms.mjs` + `tools/look-probe.js` | **验收器械**（7 臂、真字节替换、消融完整性守卫、churn 自测、批内自證） |
| `tools/recon-dom.mjs` | 只读侦察器械 |
| `tools/look-pixdiff-v2.mjs`、`tools/ab-compose.mjs` | 逐像素差 / A/B 叠图（纯 JS PNG 编解码） |
| `tools/summarize-look.mjs` | 从原始 JSON 生成全部表格（**本档所有数字均由此产出，无手工转录**） |
| `tools/verify-report-numbers.mjs` | **报告数字自检**：40 条断言把 `audit.md` 引用的每个关键数字与原始 JSON 对齐 ⇒ **40 PASS / 0 FAIL**（含"环带残差恰好只落在网格第 1、6 行、合计 2 788 像素"这类空间断言） |

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/program/w11-mask-look

# 只读侦察（约 25 s）
node tools/recon-dom.mjs

# 验收批（7 臂 × 3 rep，约 20–30 min；锁被占用时加 --allow-concurrent 并如实记账）
node tools/look-arms.mjs --reps 3 --shot --allow-concurrent \
  --arms blur2,shipped,blur1,blur05,clipPanel,filterContent,ringBands,wallpaperBlur

# 全部表格
node tools/summarize-look.mjs

# 逐像素差 + 裁剪
node tools/look-pixdiff-v2.mjs --batches raw/look-<stamp1>.json,raw/look-<stamp2>.json,raw/look-<stamp3>.json

# 报告数字自检（应输出 40 PASS / 0 FAIL）
node tools/verify-report-numbers.mjs
```

**复现关键值（供第三方核对）**：pre-image `9298ac5b087056555498550e0e0e6dd9d3202dce48bb07b2a2c4bfeed1d63da5`（26630 B）；候选/live `bd7edeaec382be264262c61933395b1fec6026dbedf57fd1be17a307cc899aec`（26593 B）；本档变体 `blur(1px)` = `fe135ce583cd…`、`blur(0.5px)` = `8948b938f5c6…`（均只改该一处字符串，逐字节断言 + 解析判决不变）。

---

## 10. 一句话交回协调者

> **模糊不必"持续付费"——它在弹窗静止时本来就免费；代价只发生在遮罩背后被重绘的交互帧上。**
> 因此**最小且最优的回退**不是"少模糊"（降半径实测无效）也不是"裁到面板盒"（连 scrim 一起裁坏），而是**把全视口那一块模糊拆成环绕面板的 4 块**：观感恢复到人眼不可辨（环带残差 0.0235 %、max 8/255），代价从 45 条 LoAF / 44 帧 >50 ms 降到 **1 条 / 6 帧**，且改动**只落在设置插件自己的模块 CSS/JSX 内**，热面刷新生效、`cp` 一步回滚。
