# U-VIRT1 —「插件列表」虚拟化（修订执行复核一体档）

单元目录：`.workspace/lag-fix/exec-virtual/`
宿主：PID 301709（`node dsh web`，**全程未重启、未 pkill、未碰用户浏览器 PID 494362**）；GUI `http://127.0.0.1:3080`
日期：2026-09-22 · 审计契约：`incident2/plugins-page/audit.md` + `program/w01-client-render/audit.md §6 K5` + `program/FINDINGS-INDEX.md`
**deployed 未写入**（按纪律由协调者落地）；本档只产出候选件 + 补丁脚本 + 证据 + 报告。

**自裁决：通过**（保留意见见 §7）。全部五条验收（①节点/SVG ②监听器 ③滚到底 ④零回归 ⑤不与 keepalive 冲突）**实测通过**。

---

## 0. 结论口径（先钉死，避免夸大）

本单元收益口径**只有一条**：**减少常驻节点 / SVG / 事件监听器与首挂成本**。
**不宣称消除可感卡顿**——`w01` 已实测 32 次设置栏目切换**无一越过 50 ms**；本线 click 窗口 LongTask/LoAF 亦全为阳性零；
既有审计并已**否证**「节点数 = 代价载体」（`ρ(optSvg,代价) = −0.261`）。
本单元改的是**常驻结构规模**，不是「卡一下」的时长。

---

## 1. 前置闸门：`@tanstack/react-virtual` 能不能用

**结论：已安装、确实被 `ui-trajectory` 使用，但当前部署下「不可从插件 bundle 侧解析」⇒ 启用任务书允许的等价最小自研方案。**

完整 file:line 证据见 **`raw/dependency-evidence.md`**。摘要：

| 判据 | 结论 | 决定性证据 |
|---|---|---|
| 已安装 | ✅ | `~/.dsh/profiles/node_modules/@tanstack/react-virtual@3.14.12`、`virtual-core@3.17.10` |
| 已被 `ui-trajectory` 使用 | ✅ | `dsh-client-ui-trajectory/lib/client.js:4348` 调 `useVirtualizer`（`:2281` 定义） |
| 但该使用是**构建期内联** | ⚠️ | `:1113/:1143/:1175`（virtual-core）与 `:2189`（react-virtual）是 `//#region ../../../node_modules/.pnpm/@tanstack+…` 注释 ⇒ 源码被打进 bundle；全文 **0** 处 `require("@tanstack/…")` |
| 有 bundle 为它注册工厂 | ❌ | 两个插件根全量 grep `id: "@tanstack` ⇒ **0 命中** |
| 在平台 seed 里 | ❌ | 壳 `/assets/index-ClqxG24t.js` 的 `Jd()` 返回**恰好 7 个 key**：`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@deepseek-ai/cordis`、`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-primitives`；整份壳 `tanstack` 命中 **0** |
| 加载器有 node_modules 解析 | ❌ | `dsh-client-modules/lib/client.js:251-261` 的 `makeRequire` 只有三条命中路径（seed → loadCache → factories），否则抛错；`:25-31` 契约注释自陈 "anything else → throw" |
| 实测 boot graph | ✅ 无该行 | HTML 共 52 条 `/plugins/<id>/client.js` 行，含 `plugin-inventory`、**0 条**含 `tanstack` |

> 这正是 `w01 §6 K5`「已安装且已被使用」的**准确边界**：静态档讲的是「存在与先例」，**不等于**「另一个 bundle 能在运行时要到它」。
> 内联副本来自构建机 pnpm 树（3.14.9 / 3.17.7），与 profile 已装的 3.14.12 / 3.17.10 **也不是同一份**。

**⇒ 自研最小方案（固定行高 + 行对齐窗口化）**。除「不可用」外还有成本理由：把 tanstack dist 内联进这个 17,303 B 的手改 bundle
意味着体积增至 ~10×、补丁脚本要承载整份第三方源码，而其可变行高测量/多轴/平滑滚动对本场景**过剩**。

---

## 2. 候选件设计（`candidate/pluginInventory.client.js`）

### 2.1 先探明的关键几何（实测）

| 事实 | 实测值 | 对设计的影响 |
|---|---|---|
| 滚动容器 | **内层滚动容器** `DIV.VOzbGW_options`（`overflowY:auto`，`clientHeight 746`），**不是 document 滚动** | 窗口必须按**最近可滚动祖先**的可视带算；也解释了任务书为何要求显式测滚动 |
| 网格 | `grid-template-columns: 277px 277px` ⇒ **2 列**（<680px 转 1 列） | 窗口必须**整行对齐**，否则列错位 |
| 卡高 / 行距 | 卡高 **54 px**、`row-gap` **10 px** ⇒ **stride 64 px** | 与 `CARDS_FALLBACK_STRIDE = 64` 一致 |
| 总高自证 | 89 行 × 64 − 10 = **5686 px** = 实测 `<ul>.scrollHeight` | 几何模型与浏览器一致 |

### 2.2 形状：整行对齐窗口 + 两个 padding（**不引入嵌套滚动条**）

在既有 `<ul class="cards">` 上做窗口化，只渲染 `rows [startRow, endRow)`：

```
<ul class="cards" style="padding-top: offsets[startRow]; padding-bottom: offsets[rows]-offsets[endRow]; overflow-anchor:none">
```

**两条不变式（等价性由构造保证，不靠运气）**

1. **位置不变式**：`<ul>` 的 border-box 顶与 `getBoundingClientRect().top` 和内部 padding 无关
   ⇒「未窗口化时的第 `row` 行」其屏幕 y 恒为 `gridRect.top + borderTop + offsets[row]`，**窗口化前后逐像素相同**。
2. **总高不变式**：`padTop + 窗口内容 + padBottom = offsets[rows] − gap = total`
   （推导并复核：`windowContent = (offsets[end]−offsets[start]) − gap`）⇒ **滚动高度与滚动位置完全不变**。

窗口由**滚动不变量对** `(offsetTop = 网格内容原点 − 可视带顶, bandHeight)` 驱动 ⇒ 内层容器与 document 滚动两种形态都对；
带内外各留 `OVERSCAN=2` 行；首屏在实测落地前只渲染 `CARDS_INITIAL_ROWS=12` 行（**有界首挂**），并保证最少 6 行（可视带完全不相交也不空）。

### 2.3 行为等价的逐项落实（任务书第 2 条）

| 要求 | 实现 | 证据 |
|---|---|---|
| 搜索过滤 | `filteredEntries` / `matches()` **一字未改** | 不变量断言 + `177→173→177` 两臂相同 |
| 禁用/启用状态 | `data-enabled`、状态点、`aria-label` 组装 **一字未改** | 不变量断言 |
| chevron 展开 | `open ? 详情 : null` **一字未改**；展开行高度用 `expandedStride` 单独测量 | 54→120→54 px，`aria-controls` 命中 6/6 |
| 键盘可达 | 卡片仍是真 `<button>`；`onFocus → revealRow` 保证**聚焦行永不因窗口收缩而卸载**，`onBlur`（焦点离开网格）才收回下限 | 45 次 Tab 两臂**均 45/45 且序列逐字相同** |
| `data-plugin-count` | 仍由 `filteredEntries.length` 计算（**不读 DOM**） | 全程 = 177 |
| `aria-controls` | `detailId` 与详情元素 `id` **逐字保留** | `controlsMatchesDetail = true` |

### 2.4 补丁形态：**只加不删**

`raw/candidate.diff`：**4 处锚点、+249 行、仅 1 行原文被替换**
（`children: filteredEntries.map((entry) => {` → `…(entry, index) => {`），其余全是插入 ⇒ 复核成本低、回滚面小。

---

## 3. 补丁脚本 `apply-Virtual-v1.mjs`（纪律逐条）

| 纪律 | 实现 | 实测 |
|---|---|---|
| 默认 dry-run | 无 `--apply` 一律不写 | `DRY_RUN_OK`、`written:false` |
| `--apply` 才写 | 写盘分支在最后，tmp+rename 原子落盘 | ✅ |
| 锚点唯一命中否则不写 | 4 处锚点先在内存全量校验 `split().length-1 === 1`；任一不为 1 ⇒ `ANCHOR_FAIL_NO_WRITE`(exit 3) | 4/4 唯一命中 |
| 自动 pre-image | `pre-image/pluginInventory.<sha12>.orig.js` + `manifest.json`（前后 sha256/字节/锚点计数） | ✅ |
| `node --check` | 写盘前对产物跑；失败 ⇒ `NODE_CHECK_FAIL_NO_WRITE`(exit 4) | ✅ |
| 幂等 | 产物含 `U-VIRT1` marker ⇒ `ALREADY_PATCHED` | ✅ 二次 `--apply` 返回 `ALREADY_PATCHED` |
| `--rollback` | 从 manifest 取 pre-image 覆盖，回滚前同样跑 `node --check` | ✅ **还原后 sha256 逐字节等于基线 `ac45985f…1c3e`** |
| 追加闸门 | 基线 sha256 封印；11 条「行为等价不变量」字符串必须仍在产物中，缺一不写(exit 5) | ✅ 11/11 |

deployed 全生命周期已在 scratch 目标上实跑：
`APPLIED → ALREADY_PATCHED → rollback-dry-run → rollback → sha256 与基线一致`。

---

## 4. 验收结果（同窗对照、ABBA 交替、3 rep/臂 + 补充轮）

主数据 **`raw/virtual-ab-final4.json`**（6 rep）；过滤态补充轮 `raw/virtual-ab-filtered-tail.json`；身份对照 `raw/identity-control.json`。
候选件 sha12 = **`9467210b9127`**。

### 4.1 主判据（面板作用域计数是**确定性**的：同臂全部 rep 逐字相同）

| 指标 | orig | candidate | 比值 | 目标 | 判定 |
|---|---|---|---|---|---|
| 面板内元素 | **1396** | **186** | 0.133 | ≤400 | ✅ **−86.7 %** |
| 面板内 SVG | **178** | **23** | 0.129 | ≤40 | ✅ **−87.1 %** |
| `JSEventListeners` 增量 | **+178** | **+27** | 0.152 | 下降 | ✅ **−84.8 %** |
| `Nodes` 增量 | +1943 | +290 | 0.149 | — | ✅ |
| 全文档元素 | 2353 | 1143 | 0.486 | — | ✅ −51 % |
| 全文档 SVG | 253 | 98 | 0.387 | — | ✅ −61 % |
| 常驻 `[data-plugin-entry]` | 177 | 22 | — | — | 窗口化生效 |
| `data-plugin-count` | 177 | 177 | 1.000 | =177 | ✅ |
| 总滚动高度 | 5912 | 5912 | **Δ 0 px** | 不变 | ✅ |

**同窗 CDP 分项 delta（tight 窗口）**：`LayoutDuration` **3.729 → 1.626 ms（−56 %）**、
`RecalcStyleDuration` **3.187 → 1.355 ms（−58 %）**、
`ScriptDuration` **10.695 → 10.687 ms（无变化）**——脚本时间不降是**预期**的：它由 21.7 KB RPC 响应解析与 React 提交主导，
本单元不声称节省这部分（与既有审计「≈15 ms 固定项与条目数无关」一致）。

### 4.2 正确性 / 零回归（逐条，含任务书要求「显式测」的那一条）

| 检查 | 结果 |
|---|---|
| **③ 滚动到底部仍正确渲染** | ✅ 滚到 `maxScroll`（5166/5166）后，**权威最后一条 id `959dcb36` 同时满足 lastRendered 与 lastVisible**，6/6 rep |
| 已渲染 id 是权威有序子序列、无洞 | ✅ `isSubsequence=true`、`hasHole=false` |
| 五档滚动位置**可见集合**等价 | ✅ 0/.25/.5/.75/1.0 五档集合**完全相等**（差异条数 0；可见数 18/24/24/26/23 两臂一致） |
| ④ 点击/展开 | ✅ `aria-expanded=true`、`aria-controls` 指向元素存在且 id 相符、卡高 54→120→54 |
| ④ 搜索零回归 | ✅ `data-plugin-count` **177→173→177** 两臂相同；过滤态**渲染 173（orig）vs 22（candidate）** 但**过滤态滚到底后最后可见 id = `include:dsh-subagent-model` = 权威最后一条过滤结果（两臂相同）**；过滤态总高 5784 = 5784；过滤态首屏可见集合相同 |
| ④ 键盘 45 次 Tab | ✅ **两臂均 45/45 全程不离列表**，且**序列逐字相同**（`keyboardSequenceEqual = true`） |
| 聚焦行不被滚动卸载 | ✅ 聚焦第 3 张卡后滚到 60 %，两臂焦点**仍在原卡**（6/6 `stillInList`） |
| chevron/SVG 关系 | ✅ 已渲染卡 34 / 卡内 SVG 34 / 面板 SVG 35（= 34 + 1 搜索图标） |
| 身份对照（拦截链自证） | ✅ 候选 = deployed 原件逐字节副本 ⇒ 两臂 `scrollHeight Δ 0`、搜索计数相同、展开 2/2、五档可见集合相等 |
| click 窗口 LongTask / LoAF | ✅ **12 个 rep-窗口全为 0 / 0** |

### 4.3 判据通道自证（**必须播种**）

- 页内 `setTimeout` 120 ms 忙循环 ⇒ **LongTask 120 ms、LoAF 120.6 ms（blocking 70.2）、wall-clock rAF 100 ms** —— **三通道同时报出，6/6 rep** ✅
- 阴性对照（同长度空闲窗）⇒ LongTask **0**、LoAF **0**，6/6 ✅
- 每 rep 页内 500 ms 心跳递增 + 浏览器主 pid 存活断言 ⇒ 全部通过 ✅

### 4.4 直观对比截图（`shots/`）

| 文件 | 内容 |
|---|---|
| `virtual-orig-top.png` / `virtual-candidate-top.png` | 列表**顶端**同视口对照 ⇒ **两张 PNG 逐字节相同**（sha256 同为 `372413e9…`）——177 张卡片常驻 vs 22 张常驻，**屏幕逐像素一致** |
| `virtual-orig-bottom.png` / `virtual-candidate-bottom.png` | 列表**末端**对照（`scrollTop = maxScroll = 5166`）⇒ **卡片网格区域逐像素相同**；全图仅 **48 个像素**、**每通道差 ≤ 2/255**（文字抗锯齿），分布在 `tool-subagent` 一张卡的文字区 |

（`shots-virtual.json` 记录每张图的 `scrollTop / maxScroll / mounted / firstMounted / lastMounted`：orig 177 常驻，candidate top 22 / bottom 27，两臂 `lastMounted` 均为 `959dcb36`。）

### 4.5 ⚠️ 绝对时延数字在本轮**不可用**（诚实声明）

`click→首个卡片` 墙钟：orig 71 / 21.9 / **1155.4** ms，candidate 290.2 / 87.3 / 75.9 ms —— **噪声压倒信号**。
原因是并发环境：本机 `loadavg` 1 分钟值 7.29（过程峰值曾达 **14.23**）、**外来 chrome 主进程 6–11 个**、
探针锁在兄弟线间轮转（`exec-keepalive`、`w07-exec-proj`、`exec-usage9-probe`）。
⇒ 本报告**不给出**任何「首挂快了 X ms」的结论。**上表的计数类指标是确定性的**（同臂全 rep 逐字相同），不受该噪声影响；
`LayoutDuration`/`RecalcStyleDuration` 的下降幅度在同窗两臂间稳定（orig 3.2–4.6 vs cand 1.3–1.8 ms），可作为方向性证据。
若要时延口径，须在机器安静、持独占锁条件下复测。

---

## 5. 本档发现并修掉的两个**真实产品缺陷**

自研窗口化最大的风险正如任务书预判：**键盘与滚动**。本轮抓到两个，都不是理论担忧。

### D1 —— 无限更新循环（React #185），会让整个列表**消失**

**现象**：45 次 Tab 走到第 18 次时，全文档 `[data-plugin-entry]` 从 42 掉到 **0**、焦点落 `BODY`；
orig 臂同一序列 45/45 全中。**确定性复现**（修复前 3/3 rep 都停在第 17 张卡）。

**定位**：`raw/diag-keyboard-candidate.json` 抓到页内报错 `Minified React error #185`（Maximum update depth exceeded）
+ `slot entry crashed in 'settings.plugins.tab'`；再用**插桩候选件** `candidate/debug/pluginInventory.debug.js`
记录每次 commit，得到 **65 次提交的状态逐字相同**（`startRow 1 / endRow 22 / offsetTop −230 / stride 64 / focusRow 9 / mounted 42`）
—— 即**状态没变却在无限重渲染**。

**根因**：我在「每次渲染后都跑」的 `useLayoutEffect` 里**无条件调用** `setView`/`setGrid`。
即便 updater 返回同一个 state 对象，React 仍会**为该次 bail-out 安排一次渲染**；平时它以「每个 task 一次」的节奏空转
（所以早期 20 次 Tab 的测试侥幸通过、且每次崩溃步数不同：17/29/31），
而**离散 Tab 键事件把更新嵌套进同一次级联**，撞上 50 层嵌套上限 ⇒ React #185 ⇒ 错误边界卸载网格。

**修法**（最小、不改语义）：**只在真的变了时才通知**
```
if (!(Math.abs(view.offsetTop - offsetTop) < 0.5) || view.bandHeight !== bandHeight) setView({…});
if (grid.cols !== nextCols || grid.gap !== gap || !(Math.abs(grid.stride - stride) < 0.5) ||
    !(Math.abs(grid.expandedStride - expandedStride) < 0.5)) setGrid({…});
```
不用 ref 镜像（避免与 state 分叉），直接与 `useCallback` 闭包里**当前已提交**的 `view`/`grid` 比较；
用 `!(a < 0.5)` 形式处理首帧 `offsetTop = NaN`。
**修复后实测**（`tools/diag-keyboard.mjs`，40 次 Tab）：焦点连续推进到 `include:skill-badge`，
窗口 `padding-top` 0→64→128→512 px 平滑滑动，常驻卡片稳定在 **42–52（有界）**，**无任何页内错误**。

> 这条是本档最重要的产物：**若没有显式测键盘全量遍历，该缺陷会以「偶发列表消失」的形态上线**。

### D2 —— 聚焦行被滚动卸载（虚拟化经典焦点丢失）

窗口按可视带收缩时，键盘聚焦的卡片可能被卸载 ⇒ 焦点掉到 `BODY`。
**修法**：`focusRow` 同时钉住窗口**上下两界**（`startRow = min(startRow, focusRow)`；
`endRow ≥ focusRow + 1 + FOCUS_OVERSCAN(12)`），`<ul>` 的 `onBlur`（焦点真正离开网格）才收回下限；
12 行前向余量用于吸收「离散焦点事件 vs 提交时序」的竞争。
**实测**：聚焦后滚到 60 %，两臂焦点均**仍在原卡**。

---

## 6. 与其它执行档的冲突核查（任务书第 ⑤ 条闸门）

`exec-keepalive/apply-KeepAlive-v1.mjs` 目标文件共 **5 个**：
`dsh-client-ui-settings-general`、**`dsh-client-ui-settings-plugins`（父栏目）**、`@local/dsh-ssh-gui`、`@local/dsh-usage`、`dsh-workspace-enhancement`。
本单元改的是 **`dsh-client-ui-settings-plugin-inventory`（子标签）`lib/client.js`**
⇒ **无同文件写入冲突，无需停下上报。**

**但存在一个语义交互，已按构造处理**：keepalive 让「访问过的栏目保持挂载（`hidden`）而非卸载」，
inventory 面板可能在一段时间处于 `display:none`。候选件有两道防线：
① `measure()` 在 `listRect.height === 0 || bandHeight === 0` 时**直接返回**（不写入垃圾几何）；
② 监听器挂了 `ResizeObserver`（观察滚动容器）+ `resize`，面板重新可见时重算窗口。
⇒ 两批**不冲突**；**建议 keepalive 先落地、再落地本单元**，以便在同一状态下复测「再次访问时窗口正确」。

---

## 7. 自裁决与保留意见

**通过。** 三条必须随报告传递的保留意见：

1. **收益口径**：只主张「常驻节点/SVG/监听器 −85 %±2」「首挂内容有界（12 行起步）」「Layout/RecalcStyle 各约 −57 %」，
   **不主张**消除可感卡顿（与 `w01` 的 32 次切换无一越过 50 ms 一致）。
2. **时延数字不作数**：本轮并发环境使墙钟首挂时延不可用（§4.5 已声明）；计数类判据是确定性的，不受影响。
3. **未覆盖面（INCONCLUSIVE）**：
   - 用户实机开启的 **`--force-renderer-accessibility`** 下收益**未测**（本 rig 未开该 flag）。
   - **headed / 真实 GPU 合成**路径未测（headless 下 `Paint`/`CompositeLayers` 字段不存在，无绘制维度数据）。
   - **触屏 / 惯性滚动**下窗口跟随未测。
   - **`exec-keepalive` 落地后的联合状态**未测（本轮 keepalive 未 deployed）。

---

## 8. 复现步骤

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-virtual

# 1) 生成候选件（不碰 deployed；--target 指向本工作区路径）
node apply-Virtual-v1.mjs --target candidate/pluginInventory.client.js --apply
node --check candidate/pluginInventory.client.js

# 2) 几何/键盘单点诊断
node tools/diag-keyboard.mjs --arm orig --tabs 40
node tools/diag-keyboard.mjs --arm candidate --tabs 40

# 3) 同窗对照 A/B（ABBA、≥3 rep、含截图）
node tools/probe-virtual.mjs --arms orig,candidate \
  --candidate candidate/pluginInventory.client.js --reps 3 --screenshot --out raw/virtual-ab.json

# 4) 身份对照（候选 = deployed 原件逐字节副本 ⇒ 两臂必须一致，防拦截链自身改变行为）
cp /home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-plugin-inventory/lib/client.js raw/identity-control.client.js
node tools/probe-virtual.mjs --arms orig,candidate --candidate raw/identity-control.client.js --reps 1 --out raw/identity-control.json

# 5) 同视口对比截图
node tools/shots-virtual.mjs

# 6) 回滚
node apply-Virtual-v1.mjs --rollback --apply
```

**协调者落地 deployed（唯一需要写 deployed 的一步，脚本会先存 pre-image）**：
```bash
node apply-Virtual-v1.mjs --dry-run    # 先看锚点/不变量/语法闸门
node apply-Virtual-v1.mjs --apply      # 写 deployed（热面：刷新即生效）
# 回滚：node apply-Virtual-v1.mjs --rollback --apply
```

---

## 9. 证据索引

| 文件 | 内容 |
|---|---|
| `raw/dependency-evidence.md` | §1 前置闸门全文（file:line 级） |
| `raw/candidate.diff` | 候选件 vs 原件完整 diff（4 锚点 / +249 行 / 仅 1 行替换） |
| `raw/virtual-ab-final4.json` | **主 A/B 原始数据**（6 rep、每 rep 全量原始采样） |
| `raw/virtual-ab-filtered-tail.json` | 过滤态补充轮（过滤态可见集合与「过滤态滚到底」） |
| `raw/identity-control.json` | 身份对照（拦截链自证，两臂差异 0） |
| `raw/diag-keyboard-candidate.json` | 键盘逐 Tab 诊断 + 页内 React #185 报错原文（orig 臂的键盘基线取自 `virtual-ab-final4.json` 的 `crossArm.keyboard.orig`，均为 45/45） |
| `raw/virtual-ab-final3.json`、`final2`、`main` | 修复前中间轮次（**保留以证 D1 的确定性复现**） |
| `raw/shots-virtual.json` | 每张截图的 `scrollTop/maxScroll/mounted/first/last` |
| `shots/virtual-{orig,candidate}-{top,bottom}.png` | **同窗同视口对比截图**（顶端两张逐字节相同） |
| `candidate/pluginInventory.client.js` | **候选件**（deployed 整文件替换，sha12 `9467210b9127`） |
| `candidate/debug/pluginInventory.debug.js` | 定位 D1 的插桩候选件（**仅诊断，非交付件**） |
| `apply-Virtual-v1.mjs` | 补丁脚本（dry-run/apply/幂等/rollback/三道闸门） |
| `tools/probe-virtual.mjs` | A/B 探针装置（ABBA/拦截/身份对照/播种/心跳/正确性 C0–C8） |
| `tools/diag-keyboard.mjs` | 键盘与窗口逐 Tab 诊断 |
| `tools/shots-virtual.mjs` | 对比截图装置 |
| `pre-image/` | 自动 pre-image + manifest |
| `logs/` | 每轮探针的人读日志与心跳 |
