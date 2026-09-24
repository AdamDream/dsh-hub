# W12 · 操作效率与键鼠体验审计（焦点管理 / 快捷键 / 步数 / 输入延迟）

- 线：`program/w12-input-ux`（独占目录 `.workspace/lag-fix/program/w12-input-ux/`）
- 日期：2026-09-22
- 审计对象：**deployed 运行态**，非源码仓
  - 客户端插件包根：`/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`（197 个包，其中 38 个含 `lib/client.js`）
  - 本地插件：`/home/CNS2026495165/dsh/dsh-btw/`（TSX 源码 + `lib/client.js` 产物）
  - GUI：`http://127.0.0.1:3080`，宿主 PID 301709（**全程未重启、未 pkill、未改任何产品文件**）
- 纪律：只读审计。所有运行时证据来自**本线自己启动的 headless chromium**（`ms-playwright/chromium_headless_shell-1148`，UA `HeadlessChrome/131.0.6778.33`，Blink，DPR=1）；从未 attach 用户浏览器（PID 494362）。

## 0. 口径、前置校正与证据强度

### 0.0 部署根路径（按包遍历会漏掉两个本地插件）

| 根 | 内容 | 备注 |
|---|---|---|
| `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/` | 197 个官方包，其中 38 个含 `lib/client.js` | §2.1 的"全量 grep"即在此范围内 |
| `/home/CNS2026495165/.dsh/profiles/node_modules/` | **本地插件**（含 `dsh-workspace-enhancement`，267 KB `lib/client.js`） | **全产品唯一的对话框 a11y 范式在这里** |
| `/home/CNS2026495165/dsh/dsh-btw/` | btw（`src/client/*.tsx` 源码 + `lib/client.js` 产物，**两者 md5 一致**） | 全产品唯一的真全局组合键在这里 |

⚠️ 只按 `@deepseek-ai/*` 遍历会**同时漏掉**唯一正确的键盘范式与唯一的全局快捷键——本线两侧都踩过，故单列。

### 0.1 三项前置校正（不校正会得到错结论）

| # | 任务书/上下游的说法 | 实测校正 | 证据 |
|---|---|---|---|
| 1 | "会话列表应在 sidebar / layout 里" | **不成立**。`dsh-client-ui-sidebar`（321 行）只有品牌行/新建会话/折叠开关 + 一个 `sidebar.workspaces` **插槽洞**；`dsh-client-ui-layout`（570 行）只有三列几何与拖拽手柄。**两者全文 `.focus(` / `tabIndex` / `onKeyDown` 计数均为 0**。会话列表真正实现在 **`dsh-client-ui-workspace/lib/client.js`（2464 行）** | `dsh-client-ui-sidebar/lib/client.js:222`、`:299-302`；`dsh-client-ui-workspace/lib/client.js:2435-2440`（注册者） |
| 2 | "全库 `document` 级 keydown 监听者只有 4 个" | **仅对插件源码成立**。运行时随打开的 `Modal`/`Menu` 实例数**线性增长**（primitives 的 `Modal`/`Menu` 每开一个就各挂一个 document 监听）。实测统计：**window 级 3 个 + document 级 6 个**（含 capture 1 个） | 见 §2.3 表 |
| 3 | 任务书给出的 5 处"焦点恢复正确范式"引用 | **逐字核实为真**，可作修复基线 | `attachment:416-424`、`jobs:141-145`、`model-selection:352-364`、`message-feedback:503-511`、`subagent:471-472` |

### 0.2 ⚠️ 隔离声明：已被证伪的主张（本报告不再传播）

> **「高回报率鼠标 + 每事件重排导致跟手掉帧」已被证伪**（三只鼠标均 USB Full Speed ≤1000 Hz；最坏实现 13.77 ms/1000 事件 = **1.4% CPU**）。
> 本报告**不含**任何以此为前提的结论；本线审计范围内也**未复现**跟手掉帧类现象。

### 0.3 仪器陷阱（本线自曝，必须随结论一起读）

| 陷阱 | 现象 | 处置 |
|---|---|---|
| `page.waitForFunction(fn, options)` 签名 | 第 2 个参数是 `arg` 不是 `options` ⇒ 传入的 `timeout` **静默失效**、走默认 30 s | 改为 `waitForFunction(fn, null, {timeout})` |
| 启动谓词选错 | 用 `#root.textContent.length > 200` 会**假失败**（hero 态 textContent 仅 143 字符，但 `button` 已达 33 个、应用其实已就绪） | 改用 `document.querySelectorAll('button').length > 10` |
| `head`/管道截断 | `node script \| head -N` 触发 EPIPE 杀掉探针，**产物文件根本不会落盘**，看起来像"探针挂了" | 探针输出一律重定向到文件 |
| LongTask 注入位置 | 协议 §五.19：CDP `Runtime.evaluate` 注入对 LongTask 是**盲区**；本线一律用**页内 `setTimeout` 注入**做阳性对照 | 见 §4.1，实测报出 **120.0 ms（n=1）**，通道确证可用 |
| 本线自己的孤儿浏览器 | 探针被信号杀死时残留 `headless_shell` 会**占住资源导致后续 boot 超时**（实测 3 次连续 boot 失败，杀掉孤儿后立即恢复） | 每轮收尾核查 `ms-playwright` 孤儿并只清自己的（PID 精确 kill，不用 `pkill -f`）；⚠️ `pkill -f <脚本名>` 会**匹配到自己的命令行**并自杀（实测），必须用 PID |
| 鼠标坐标点击被 hover-card 抢占 | 用 `mouse.click(x, y)` 点 `projectRow` **永远点不开**（鼠标移动先触发 hover-card 覆盖该行，落点被卡片吃掉）⇒ `latency2` 的 4 个 rep 全部作废 | 改用 **JS `.click()`**（`page.evaluate` 里对元素调 `.click()`），并自证 `aria-expanded` 前后变化；`latency3` 已用此法成功切换展开态 |
| 会话数据的前置状态 | 未选工作区时 `group.sessions` 为空 ⇒ 会话列表"展开也是空"、搜索 0 结果、composer `readOnly` ⇒ **任何需要"真实会话"的测量都拿不到** | 这类 rep 一律记 `ABORT` 并写明前置条件，不得当成产品缺陷；需写权限才能先选工作区 |
| **初始状态跨轮不稳定** | 两轮 boot 拿到的初始态不同（一轮已选工作区、一轮未选）；该状态由**宿主侧持久状态**决定，可被用户或**并行兄弟线**改变 | 任何依赖"初始态"的观测都要**当轮自证**（读回 placeholder/aria-label/chip 文本），**禁止跨轮假定** |
| 逃逸点的位置是内容相关的 | 设置弹窗的 Tab 逃逸首点在同一脚本两轮里分别是 **#15 / #16**（面板首屏控件数随设置项变化）⇒ 引用"第 N 次 Tab 逃逸"必须写清是**哪一轮、哪种面板内容** | 报告写**区间**（#15–#16）并注明两轮；判据用"**是否存在 `inPanel=false` 的落点**"而不是某个固定序号 |

---

## 1. ① 键盘可达性普查：焦点管理

### 1.1 焦点矩阵（每个交互面 × 六问）

`五问` = 打开后焦点去哪 / 首焦元素 / Esc / Tab 可达性 / 方向键 / 关闭后焦点恢复。
"运行时"列 = 本线 headless 实测（`raw/probe-focus.json`、`raw/probe-focus2.json`、`raw/diag2.log.txt`）；"静态"列 = 读 deployed 代码。

| # | 交互面 | 打开/进入后焦点去哪 | Esc | Tab 能否跑出去 | ↑↓/Home/End | 关闭后恢复焦点 | 判定 |
|---|---|---|---|---|---|---|---|
| **S** | **设置弹窗**（核心面） | **关闭按钮**（运行时实测首焦 = `button.VOzbGW_close`）<br>静态：`settings-general:108-111` `closeButton.current?.focus()` | ✅ `document` 级 `settings-general:99-107`（裸 `key==="Escape"`，无 `stopPropagation`、不判最上层） | ❌ **能：两轮实测各有 16–17 个落点跑出面板**（见 §1.2） | ❌ 导航项无 roving tabindex、无方向键（`:132-143` 只是普通 `<button>`+`aria-current`） | ❌ **FAIL：实测关后焦点落 `document.body`，不回到触发按钮**（`close()` `:180-183` 只 `setOpen(false)`） | **FAIL** |
| **B** | **btw 抽屉**（drawer 模式） | 120 ms 后给 composer textarea（`SideChatSurface.tsx:315-328`，`321`） | ✅ **window** 级（`SideChatDrawer.tsx:47-56`） | ❌ 能（`role="complementary"` 非模态，无陷阱——语义上可接受） | ❌ 无 | ❌ 不还焦（`SideChatButton.tsx:28-38` 不持 ref） | 部分 FAIL |
| **B2** | btw 图片灯箱 | **不移入**（焦点留在 dialog 外的缩略图上） | ✅ document 级 + `stopPropagation`（`SideChatSurface.tsx:197-207`） | ❌ 能 | ❌ 无 | ✅ `SideChatSurface.tsx:390-393` | **FAIL**（首焦） |
| **B3** | btw 结束确认框 | ✅ 首焦 footer 首按钮（`SideChatSurface.tsx:344`） | ✅ document + `stopPropagation`（`:345-349`） | ⚠️ 有循环但**只覆盖 2 个按钮**（`:420-431`），header 关闭按钮不在循环内 | ❌ 无 | ✅ `:332-339` | 部分 PASS |
| **L** | **会话/工作区行**（列表主操作） | 无（行不可聚焦） | ❌ 无 | — | ❌ 无 | ❌ 无 | **FAIL（最重）** |
| **L2** | 行内"…"动作菜单 | ❌ 不移入菜单 | ✅（primitives `Menu` 的 document Escape） | ❌ 能 | ❌ **无 ↑↓**（`Menu` 无导航） | ❌ 不还焦 | **FAIL** |
| **D** | **详情面板**（"返回"） | 无焦点动作 | ❌ **无 Esc** | — | ❌ 无 | ❌ `closeDetails()` 不还焦（layout `:304-306`） | **FAIL** |
| **C** | 对话区 composer | ✅ 页面初始焦点即 composer（运行时实测），会话切换时**强制抢焦**（`conversation:3657-3663`，依赖 `[locked, sessionId]`） | ✅ 转交 input-trigger 仲裁（`conversation:3753-3756`） | — | ⚠️ ↑↓ 只被 input-trigger 消费（`:3749-3752`），**空草稿按 ↑ 不召回历史输入** | ❌ 会话切换路径**结构上没有"触发者"**（行不可聚焦） | **FAIL**（无恢复语义） |
| **O** | 官方其余 12 个浮层 | 见 `raw/findings-B-overlays-shortcuts.md §2.1` | 部分有 | ❌ **全线能跑出去**（零 `inert`、零 Tab 处理） | 各自为政（model-selection/subagent/commands/input-trigger 各一套，行为不一致） | 仅 5 个插件有 | **FAIL** |

### 1.2 实测硬证据：`aria-modal="true"` 是假的（设置弹窗焦点穿透）

`raw/probe-focus.json` / `raw/probe-focus.log.txt`（**同一记录文件在两轮独立运行中被覆盖式复现**；下表取 2026-09-22 14:59 那一轮）：

```
打开设置后焦点: button.VOzbGW_close slot=sidebar.settings inPanel=true inDialog=true "关闭"
dialog 信息: {"role":"dialog","ariaModal":"true","ariaLabelledby":":r1:","hasTabIndex":false,
             "overflow":"hidden","focusableInside":26,
             "rootInert":false,"bodyInert":false,"backgroundAriaHidden":[null]}
```

**Tab 穿透（两轮均复现；逃逸**首点**是内容相关的，两轮分别为 #15 与 #16）**：

```
轮 A（首轮）                         轮 B（14:59 重跑）
# 1 … #15  inPanel=true              # 1 … #14  inPanel=true
#16 composer[选择工作区] inPanel=**false** ← 逃出   #15 composer[选择工作区] inPanel=**false** ← 逃出
#17 agentPreset          inPanel=false           #16 agentPreset          inPanel=false
#18 textarea             inPanel=false           #17 textarea             inPanel=false
#19 … #31 全部 inPanel=false（composer / 侧栏都在 Tab 序里）   #18 … #31 同上
#32 … #40 又回到 inPanel=true（navCell ×8 + settings.action） #32 … #40 又回到 inPanel=true
```

- **判定：FAIL（运行时确证，两轮复现）**。`role="dialog" aria-modal="true"`（`settings-general:121-122`）**只声明不约束**：没有任何 `inert`（`rootInert=false` / `bodyInert=false`）、没有 Tab 循环、背景也没有 `aria-hidden`（`backgroundAriaHidden=[null]`）。
- **稳定的判据（不依赖轮次）**：设置弹窗打开后连续 Tab 40 次，**必然出现 `inPanel=false` 的落点**（两轮各出现 16–17 个），且**关不掉它的只有"关闭按钮/mask 点击/Esc"三条**。⇒ 引用时**不要**写"第 16 次逃逸"，要写"**存在逃逸**（首点 #15–#16，内容相关）"。
- 后果分两面：**键盘用户**在对话框里 Tab 十几次就掉进背景应用，位置感丢失；**屏幕阅读器用户**被 `aria-modal` 宣告为模态却能被移出模态。
- 关闭路径实测：`Esc` → dialog 数 0、焦点 `(body)`、`触发按钮被聚焦=false`；遮罩点击 → 同样落 `(body)`。**两条关闭路径都不还焦**。
- 产品内**已有**正确实现可对齐：`dsh-client-ui-settings-models/lib/client.js:2139-2146`（`appRoot.inert = true` + 还原）；`dsh-workspace-enhancement/lib/client.js:2226-2273`（Tab 循环 + 栈顶仲裁，是全库唯一真陷阱）。

### 1.3 实测硬证据：会话行键盘完全不可达

运行时（`raw/probe-focus2.log.txt §A2`）：

```
{'tag':'div','cls':'YDXeBa_projectRow','role':'treeitem','tabindex':None,'ariaSelected':None,
 'vis':True,'h':34,'cursor':'pointer','buttonsInside':2,
 'ownTabIndexButtons':['null|工作区"触觉产品资料"的操作','null|在工作区…中新建会话']}
```

- 行本体是 **`<div role="treeitem">` + `tabindex=null`**（不可聚焦）——与静态分析一致：`dsh-client-ui-workspace/lib/client.js:718-724`（会话行）、`:469-473`（工作区分组行）。
- 行内仅有的两个真 `<button>` 是 **hover-only**：CSS `:334` `.rowActions{display:none}`，仅 `:hover`/`.menuOpen` 显示；展开后实测这两个按钮是 **`w:0 h:0`**（未 hover）⇒ 也不在 Tab 序里。全文 `focus-within` 计数 = **0**。
- `role="tree"` 在 `:1328`/`:1533`/`:1613` **三处声明**，但无 roving tabindex、无 ↑↓/Home/End、无 `role="group"`（计数 0）⇒ **声明了树形语义、没有树形行为**。
- 无模态时全量 Tab 序（22 步，`raw/probe-focus.log.txt`）**只经过**：搜索按钮(#12)、视图选项(#13)、添加工作区(#14)、偏好库(#15)、设置(#16)——**没有任何一个会话/工作区行**。

### 1.4 实测硬证据：焦点会落进"不可见控件"（**条件性**）

详情面板列宽解算为 0 且**从不卸载**（`dsh-client-ui-layout/lib/client.js:32` 注释明写 never unmounted、`:48-52` 返回 `details: 0`、`:233` 无条件渲染、CSS `:56` `overflow:hidden`）。

- **实测 A（`raw/probe-focus.log.txt`）**：Tab 序第 **#7** 步落点 = `button.ydkMvW_close[关闭详情] slot=details` ⇒ **面板挂载时，其内部按钮确实在 Tab 序里**。
- **实测 B（`raw/geom.run.txt`）**：该列几何 = `w=0, h=1000, x=1600, overflow=hidden`（宽度精确为 **0**，且位于视口右边界外）⇒ 被它 `overflow:hidden` 裁切后，内部按钮的**可见面积 = 0**。

⚠️ **必须一起读的条件性**：实测 B 那一轮 `[data-slot="details"]` 的**子节点数 = 0**（面板**根本没挂载**，`[data-slot="details"] button` 为 `null`），12 步 Tab 也**没有**落到该面板。
⇒ **面板挂载是有条件的**（无会话时不挂载）。故判定 = **FAIL（条件性：面板挂载时成立）**，并明确标注"无会话状态下不出现该缺陷"。修法：`cols.details === 0` 时给该列设 `inert`（范式已在 `settings-models:2139-2146`），并在过渡结束后再设（复用 sidebar 的 `COLLAPSE_SETTLE_MS`，`dsh-client-ui-sidebar/lib/client.js:83`、`:97-109`）。

### 1.5 Tab 序与视觉序：两轮观测**不一致** ⇒ **INCONCLUSIVE（需专项确定性检查）**

| 轮次 | 起始焦点 | 观测到的 Tab 序 |
|---|---|---|
| `raw/probe-focus.log.txt` | 已自证 `(body)` | **对话区优先**：`conversation.composer`(#1) → `agentPreset`(#2) → `textarea`(#3) → … → `details 关闭`(#7) → body(#8) → **侧栏** `brand`(#9) … `settings`(#16) → 回到对话区(#17–#22) |
| `raw/btwkey.run.txt` | **btw 全局热键的运行时确证**：`Ctrl+Shift+.` 在可编辑输入框里 ⇒ value 不变且 `input` 事件 0 条（吞键）；`Shift+.` 单独按 ⇒ `">"`；对照 `x` ⇒ `"x"`；完整 keydown/keyup/input 事件流水 |
| `raw/geom.run.txt` | 未自证 | **侧栏优先**：`sidebar.brand`(#1) → … → `sidebar.settings`(#8) → `conversation.composer`(#9) → `agentPreset`(#10) → `textarea`(#11) → body(#12) |

两轮的**列顺序完全相反**。本线**未能定位**原因是"起始焦点不同"还是"列 DOM 顺序非确定"（后者更严重：意味着列顺序可能依赖插件挂载顺序/竞态）。
⇒ **判定 INCONCLUSIVE**。因此**不**把"重排 Tab 序"列入 §5 的前 5 项优化（前提未确证）。
**需什么证据才能定**：同一实例内连续 5 次 `boot → 记录首焦 + #1..#6`；若顺序随轮次变化则确证为非确定性，否则是起始焦点差异。

### 1.6 无工作区态下 composer 是只读的（实测；**本线自纠一处过度声称**）

**实测（`raw/diag2.log.txt`）**：

```
无焦点时 activeElement: BODY
focus() 后 activeElement: TEXTAREA.uV2eYG_input readOnly=true disabled=false
press("a") 后: value=""   events=[keydown a → target=TEXTAREA, defaultPrevented=false]  （无 input 事件）
```

"无工作区选定"时 composer 是**只读的 Workspace 选择器**（与 `dsh-cordis-client-runner:2352` 的契约文档一致："the no-workspace hero renders the **SAME textarea DOM as a read-only Workspace-picker trigger**"）；`onKeyDown` 里 `Enter/Space` 被改派为"打开工作区选择器"（`dsh-client-ui-conversation/lib/client.js:3719-3726`）。
这不是缺陷 —— 是有意的同一 DOM 复用，且**不可编辑这件事是被明示的**：

| 证据 | 内容 |
|---|---|
| `raw/probe-focus.log.txt`（2026-09-22 14:59 重跑，无工作区态） | Tab #3 落点 = `textarea.uV2eYG_input[选择工作区]{选择一个工作区开始}` ⇒ **aria-label="选择工作区"、placeholder="选择一个工作区开始"** |
| `raw/focusables.json`（首轮，**已选定**工作区态） | `textarea ... {描述你想要构建的内容}`，且 `conversation.composer` 的 chip 文本 = `Dexterous_Hand_23Dof` |

🔴 **本线自纠（原稿写的"placeholder 仍是'描述你想要构建的内容'、没有任何提示"是错的）**：placeholder 与 `aria-label` **都会随状态切换**——无工作区时明说"**选择一个工作区开始**"。因此"无提示"的指控**不成立**。
⇒ **判定：PASS（可发现性）**。原稿的 FAIL 判定作废（保留此更正如上，不静默删除）。

⚠️ **同时暴露一个更重要的不确定性**：两轮 boot 的初始状态**不同**（一轮已选定工作区、一轮未选定）。初始工作区/会话态来自**宿主侧持久状态**（`~/.dsh/storages/workspace.json` 等），既可能被用户操作改变，也可能被**并行的兄弟审计线**改变。⇒ **本线无法断言"新浏览器的默认态是什么"**；该点标 **INCONCLUSIVE**。凡是依赖"初始是否选定工作区"的观测（含 §1.8、§4.3 第 1/2 条）都必须连同这个前提一起读。

### 1.7 实测：主输入框的焦点指示器在 outline / box-shadow **两条通道上均为空**（FAIL，带精确边界）

`raw/probe3.log.txt §C`（12–14 步 Tab，逐项读 `getComputedStyle`）：

```
# 1 button.hHd-Xa_brand        outline=auto/1px/rgb(16,16,16) shadow=none
# 8 button.VOzbGW_trigger      outline=auto/1px/rgb(16,16,16) shadow=none
#11 textarea.uV2eYG_input      outline=none/0px/rgba(0,0,0,0) shadow=none     ← 主输入框
```

- 侧栏/设置等**按钮**依赖浏览器默认焦点环（`outline: auto 1px`）——能用，但**产品自己没有任何 `:focus-visible` 样式**（全库 grep 未见自定义焦点环），且默认色 `rgb(16,16,16)` 是**近黑**：深色主题下 1 px 近黑环几乎不可见（本线在浅色主题下测得，**深色主题未实测 ⇒ 该子结论标 INCONCLUSIVE**）。
- **composer 主输入框（`textarea.uV2eYG_input`）计算样式为 `outline: none/0px` + `box-shadow: none`** ⇒ 这两条通道都不提供焦点指示。
- ⚠️ **精确边界（不过度声称）**：本线**只采证了 `outline` 与 `box-shadow` 两条通道**，**未单独比对 `border-color/width` 的变化**。因此严格表述是"**outline 与 box-shadow 双通道均为空**"；"完全没有任何焦点指示"需要补一次 border 三态（未聚焦 / 鼠标聚焦 / Tab 聚焦）比对才能定论。
- 判定：**FAIL（outline/box-shadow 双通道缺失 = 实测确证）**；是否存在 border 通道补偿 = **INCONCLUSIVE**；深色主题下按钮焦点环可见性 = **INCONCLUSIVE**。

### 1.8 实测：无工作区状态下，会话列表与会话搜索都是空的（且无解释）

- `raw/probe3.log.txt §A/§B`：把 `dsh` 工作区行的展开态置为 `aria-expanded="true"`（JS `.click()` 确实生效，实测 `before:"false"` → 之后 `"true"`）后，子树里**仍然只有 `projectRow`，`sessionRow` 计数 = 0**；随后"取未展开的 `treeitem` 当会话行"得到 `candidates: 0`。
- `raw/diag2.log.txt §Q2`：展开会话搜索并输入 `btw` 后 `visibleTreeitems: 0`、`allButtons: 4`。
- 与静态一致：会话行仅在 `group.expanded && group.sessions.length > 0` 时渲染（`dsh-client-ui-workspace/lib/client.js:208`：`sessions: expanded ? g.sessions.map(...) : []`）⇒ **无工作区上下文时 `group.sessions` 为空**。
- 判定：**FAIL（可发现性，中等）但严重度 INCONCLUSIVE**。用户看到的是一棵"展开后仍为空"的树 + 一个"搜不到任何东西"的搜索框，而**列表/搜索本身不给任何原因**。
  ⚠️ 边界（必须一起读）：① 该状态只出现在"未选工作区"时，而**composer 的 placeholder 同期会明说"选择一个工作区开始"**（§1.6）⇒ 提示是有的，只是**不在列表/搜索处**，而在输入框处；② §1.6 已暴露"初始是否选定工作区"本身不确定 ⇒ 用户侧是否遇到 **INCONCLUSIVE**。
  ⇒ 精确表述：**"列表空/搜索空"是"未选工作区"的必然后果且在该处无提示；但全局有一个（输入框上的）提示** ⇒ 判定为**可用性瑕疵而非缺陷**，严重度降级。

---

## 2. ② 快捷键清单与冲突

### 2.1 裁定一：不存在任何快捷键注册中心 / keymap / 仲裁层

**PASS（强证据，全量 grep 确证）**，三条独立判据：

1. 在 **38 个 deployed `@deepseek-ai/*/lib/client.js`**（约 8 万行）中，`metaKey|ctrlKey|altKey` 总计命中 **2 处**，同在 `dsh-client-ui-conversation/lib/client.js`：`:3758`（`Cmd/Ctrl+Z` / `+Y` 草稿撤销重做）、`:3779`（`Ctrl/Cmd+Enter` 加速提交判据）。
2. 在 **38 个 deployed `@deepseek-ai/*` 包内**，`"Tab"` 的真实处理 = **0 处**（唯一命中是 React 的 keyCode 映射表）。
   ⚠️ **精确边界（必须一起读）**：**本地插件** `dsh-workspace-enhancement` **是例外**——它是全产品**唯一**真正的对话框 a11y 实现，同时具备**栈顶仲裁 + Tab 陷阱 + 首焦**：
   `dsh-workspace-enhancement/lib/client.js:2240-2241`（首焦）、`:2241-2248`（`stack[stack.length-1] !== close` 即 return ⇒ **只有栈顶响应**）、`:2249-2253`（真 Tab 循环）、`:2269`（`document.addEventListener("keydown", … , true)`，**全库唯一 capture=true**）。
   该文件在 **`/home/CNS2026495165/.dsh/profiles/node_modules/dsh-workspace-enhancement/lib/client.js`**（267 KB），不在 `@deepseek-ai/*` 目录下，故按包遍历会漏掉它。
   ⇒ 正确表述：**官方 38 个插件包零焦点陷阱；本地插件里有一套完整范式，却只服务它自己打开的 5 个弹窗，未被任何官方浮层复用**。
3. 任务书提示的 "the keyboard command face" **不是注册中心**：`dsh-client-ui-conversation/lib/client.js:1552-1560` 的 JSDoc 明写 *package-internal … **never across a plugin boundary***，实现体是 `keyboard(id){ return this.shell(id) }`，能力域全是 composer 局部文本编辑（`setDraft`/`undo`/`redo`/`space`/`arbitrate(up|down|escape|enter)`/`submit`/`steerQueue`/`dismissPopup`）。
4. **行为学旁证（两轮共 24 组按键探针全部无反应）**：
   `Ctrl+K` / `Ctrl+P` / `Ctrl+B` / `Ctrl+/` / `Ctrl+,` / `Ctrl+\` / `Ctrl+G` / `Ctrl+F` / `Ctrl+Shift+P` / `Ctrl+Shift+K` / `F1` —— 全部 `changed=false`（dialog 数、焦点、`#root` 文本长度三项都不变）；
   另 `Alt+1` / `Alt+2` / `Alt+b` / `Alt+s` —— 全部 `no-change`。
   证据：`raw/probe-focus.log.txt §5`、`raw/probe-focus2.log.txt §D`。
   ⇒ **旁证成立：既没有命令面板热键，也没有菜单加速键（mnenomics）。**

### 2.2 快捷键总表（真·全局组合键：**仅 1 条**）

| 键 | 层级 | 作用 | 定义位置 | 可发现 |
|---|---|---|---|---|
| `Cmd/Ctrl + Shift + .`（判 `code === "Period"`） | **window** | 切换 btw 侧聊抽屉 | `dsh-btw/src/client/index.ts:86-95`（产物 `dsh-btw/lib/client.js:8655-8668`） | ❌ **零提示** |

### 2.3 全部全局监听者与局部按键消费点

**A. 全局（window / document）监听者：9 个**

| # | 键 | 层级 | 作用 | file:line | `preventDefault` / `stopPropagation` |
|---|---|---|---|---|---|
| G1 | `Escape` | window | btw 抽屉 minimize | `SideChatDrawer.tsx:47-56`（产物 `2830-2836`） | ✅ / ❌ |
| G2 | `Escape` | document | btw 灯箱关闭 | `SideChatSurface.tsx:197-207` | ❌ / ✅ |
| G3 | `Escape` | document | btw 结束确认（挡抽屉） | `SideChatSurface.tsx:345-349` | ❌ / ✅ |
| G4 | `Escape` | window | attachment 原图灯箱 | `dsh-client-ui-attachment/lib/client.js:418-419` | ❌ / ❌ |
| G5 | `Escape` | document | **设置弹窗关闭** | `dsh-client-ui-settings-general/lib/client.js:100-105` | ❌ / ❌ |
| G6 | `Escape` | document | conversation `ContextMeter` 弹出层 | `dsh-client-ui-conversation/lib/client.js:3113-3121` | ❌ / ❌ |
| G7 | `Escape` | document | message-feedback 备注面板 | `dsh-client-ui-message-feedback/lib/client.js:493-500` | ❌ / ❌ |
| G8 | `Escape` + `Tab`/`Shift+Tab` 循环 | document **capture** | workspace-enhancement 弹窗 a11y（**唯一带栈顶仲裁**） | `dsh-workspace-enhancement/lib/client.js:2269`（逻辑 `2241-2266`） | ✅ / — |

**B. composer（`dsh-client-ui-conversation`，键盘密度最高的面）**

| 键 | 条件 | 作用 | file:line | 可发现 |
|---|---|---|---|---|
| `Enter` | 非 shift、非 composing | 提交 | `:3728`、`:3772-3784` | 部分 |
| `Cmd/Ctrl + Enter` | `canSteerQueue` | 插话发送全部排队消息（steer） | `:3779`、`:3781` | ✅ `:6140`/`:6313` 文案 |
| `Shift + Enter` | — | 放行给原生换行 | `:3728` | 部分 |
| `Cmd/Ctrl + Z` | — | 草稿撤销 | `:3758-3762` | ❌ |
| `Cmd/Ctrl + Shift + Z` / `Cmd/Ctrl + Y` | — | 草稿重做 | `:3761` | ❌ |
| `Backspace` / `Delete` | 无选区、光标贴引用 token | 整块删除引用 | `:3730-3748` | ❌ |
| `Space` | — | 引用收尾 | `:3765-3769` | ❌ |
| `ArrowUp/Down` | — | 转交 input-trigger 仲裁（**空草稿不召回历史**） | `:3749-3752` | ❌ |
| `Escape` | — | 关掉 composer 弹层 | `:3753-3756` | ❌ |
| 复制/剪切 | 选区触及引用 chip | 用 `clipboardText` 展开引用后写剪贴板 | `:3796-3813` | ❌ |

**C. 其余局部 `onKeyDown`（按 key 判定分支共 42 个，去重后语义快捷键 32 条）**：`↑↓`（`model-selection:373-375`、`subagent:579-582`、`commands:951-958`、`input-trigger:407-419`）、`Home/End`（**仅** `subagent:573-576`）、`←→`（`subagent:293`、`trajectory:4944-4949`）、`Tab 循环`（**仅** btw 确认框 `SideChatSurface.tsx:420-431` 与 `workspace-enhancement:2226-2273`）、`Enter`（workspace×2 / dir-picker×2 / user-questions / goal / skill / tool / settings-plugins 等十余处）。

### 2.4 冲突清单

| # | 类型 | 机制 | file:line | 影响 | 判定 |
|---|---|---|---|---|---|
| **C-1** | **冲突（最高优先级）** | **7 个 document/window 级 `Escape` 监听器互不仲裁**：判据全是裸 `event.key === "Escape"`，**无一检查 `document.activeElement`、`event.defaultPrevented`、或"我是不是最上层"**。G8 是全库唯一正确实现（栈顶仲裁）却只服务自己的 5 个弹窗 | `settings-general:101`、`conversation:3115`、`message-feedback:494`、`attachment:419`、btw `Surface:1400`/`1550` | 一次 Esc 可**同时**关掉多层浮层（设置 + ContextMeter + btw 抽屉） | **FAIL**（机制确证；"叠层时同时关闭"的运行时可复现性见 §2.5 INCONCLUSIVE 项） |
| **C-2** | **冲突（已运行时确证 + 修正一处推断）** | btw 全局热键**不判 `activeElement`**（无输入元素豁免）；`:89` **无条件** `preventDefault()`，`:91` 才 `if (current !== undefined) presentation.toggle(...)` ⇒ **按键先被吞、再决定做不做**。源码：`if (!(meta\|\|ctrl) \|\| !shift \|\| code !== 'Period') return; event.preventDefault(); const current = controller.currentSessionId(); if (current !== undefined) presentation.toggle(String(current))` | `dsh-btw/src/client/index.ts:86-95`（判据 `88`、`preventDefault` `89`、`toggle` `91`）；产物 `dsh-btw/lib/client.js:8655-8668` | **在可编辑输入框里按 `Ctrl+Shift+.` ⇒ 字符被吞掉、什么都不发生**（实测）；有会话时同一路径还会**同时切换抽屉** | **FAIL（运行时确证）**。⚠️ **修正 `findings-B` 的推断**：B 判断"字符已进输入框 + 抽屉开了"（双重效果）——**实测为 0 条 `input` 事件、value 不变**，即 `keydown` 阶段的 `preventDefault()` **确实阻止了该可打印字符的插入**，不存在"双重效果" |
| **C-3** | **冲突** | btw 抽屉 Esc 挂 **window**，子层用 **document + `stopPropagation`** 挡住它（"纸牌屋"）：保护契约散落在两个子组件注释里（`Surface:199-201`、`:345`） | `SideChatDrawer.tsx:54`、`SideChatSurface.tsx:202`、`:346` | 任何在 window/capture 阶段新增的监听都会**静默**破坏它 ⇒ Esc 同时关灯箱+关整个抽屉 | **FAIL**（脆弱性确证） |
| **C-4** | **冲突** | 共享 primitives `Menu` 只有 Esc、**无 ↑↓/Home/End/typeahead**；而 model-selection / subagent / commands / input-trigger 各自手写导航，**行为互不相同**（有无 Home/End、是否循环、是否还焦） | `Menu`（bundle `Vu`，`dsh-btw/node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/index.js:1530` 起，Esc 在 `1598-1602`）；对比 `subagent:565-583` | 同一 UI 家族三种键盘行为；`Menu` 使用者（视图选项、Enter 行为、agent-preset、permission-presets）只能靠 Tab 逐个走 | **FAIL** |

### 2.5 失效 / 不可发现清单

| # | 类型 | 现象 | file:line | 判定 |
|---|---|---|---|---|
| **F-1** | **不可发现** | 32 条语义快捷键里**只有 2 条**有 UI 提示：`Cmd/Ctrl+Enter`(steer)（`conversation:6140`/`:6313` + 设置项描述 `:6180`/`:6353`）与 btw 的 `Shift + Enter`（`SideChatSurface.tsx:651`，且**只讲换行、不讲 Enter 发送**）。**其余 30 条零提示**——尤其唯一的全局组合键 `Cmd/Ctrl+Shift+.` 在任何 UI 中都不存在 | 同上 | **FAIL** |
| **F-2** | **失效** | **官方 38 个插件包内：真焦点陷阱 = 0**；全产品唯一的真陷阱在**本地插件** `dsh-workspace-enhancement/lib/client.js:2249-2253`（+栈顶仲裁 `:2241-2248`），**官方浮层一个都没复用**；`inert` 的唯一真实用法在 `dsh-client-ui-settings-models:2139-2146` | 见 §0.0 / §1.2 / §2.1 | **FAIL** |
| **F-3** | **失效** | `dsh-client-ui-commands` 命令卡**无 `role`**（只有 `aria-label`），卡内又有 `role="listbox"`/`role="option"`，且 `role="alert"` 被误用于**含选项的区域** | `commands:970-975`（卡片，`onKeyDown` 在 `975`）、`:991`（alert）、`:1017`/`:1021`（listbox/option） | **FAIL** |
| **F-4** | **失效** | `dsh-client-ui-commands` 的 `role="listbox"` 选项**缺 `aria-activedescendant` 关联**（输入框上没有指向高亮项的属性）⇒ SR 不播报高亮移动 | `commands:977-988`（input）、`:1020-1023`（option） | **FAIL** |
| **F-5** | **失效** | `dsh-client-ui-jobs`：`aria-expanded` 有但 **无 `aria-haspopup`**；菜单是裸 `<ul aria-label>`（**无 `role="menu"`**）、行是 `<li>`（无 `role="menuitem"`）；Esc 绑在根 `div` ⇒ **焦点 Tab 出子树后 Esc 不再关闭** | `jobs:146`（trigger）、`:150`（根 div 的 onKeyDown）、`:160`（ul） | **FAIL** |
| **F-6** | **失效** | 会话搜索收起时 `tabIndex` 从 0 变 -1，但**焦点不还给搜索按钮**（按钮无 ref）；点击外部收起路径同样 | `workspace:1924`（tabIndex）、`:1928-1932`（Esc）、`:1938-1942`（清空）、`:1905-1915`（按钮无 ref）、`:1732-1749`（click-outside） | **FAIL** |
| **F-7** | **不可发现 / 布局依赖** | btw 热键判 `code === "Period"`（物理键位）。用 `code` 而非 `key` 是**正确选择**（Shift+. 的 `key` 是 `>`）；但在 AZERTY/QWERTZ 上「打出 `.` 的键」`code` 不是 `Period` ⇒ **该键在这些布局上不可达**，且零提示 ⇒ 用户也无法自行发现 | `dsh-btw/src/client/index.ts:88` | **INCONCLUSIVE**（机械推断；未在非 QWERTY 布局实机验证） |
| **F-8** | **INCONCLUSIVE** | C-1 的"一次 Esc 关多层"——**机制已读码确证**，但"叠层时是否真的同时关闭"需要**同时打开两层浮层**的运行时复现（本线未构造成功——无会话状态下 btw 抽屉不可见、ContextMeter 无内容可开，故两层叠置不可得） | `settings-general:101` 等 | **INCONCLUSIVE** |
| **F-9** | **FAIL（运行时 + 读码双确证）** | 产品里**唯一的全局组合键**在"无会话"时 = **吞掉按键 + 静默空操作**：`:89` 的 `preventDefault()` 与会话无关地先执行，`:91` 的 `if (current !== undefined)` 才决定是否 toggle。**实测证据** `raw/btwkey.run.txt`（在会话搜索输入框里，`readOnly=false`）：<br>· 仅 `Shift+.` ⇒ value=`">"`（字符正常可打）<br>· **`Ctrl+Shift+.` ⇒ value=`""`，事件流水里 `input` 条数 = 0**（按键被吞）<br>· 对照：普通 `x` ⇒ value=`"x"`<br>**已排除"btw 未启用"**：`~/.dsh/profiles/web/cordis.patch.yml:23-24` 明确 `insert: id: btw / name: '@local/dsh-btw'`（故 toggle 未发生是**会话为空**导致，不是插件缺失） | `dsh-btw/src/client/index.ts:86-95`；`presentation.tsx:62-71`（`visible===false` → minimize） | **FAIL**：① **无输入元素豁免** ⇒ 在输入框里会静默吞掉 `Ctrl+Shift+.`；② **无任何 UI 提示**（§2.5 F-1）⇒ 用户不可能发现；③ 有会话时同一路径会**同时**吞字符并切换抽屉（读码确证，运行时未复现，因本线不可选工作区） |

### 2.6 命令面板现状裁定

> **一句话：没有 `Cmd/Ctrl+K` 式全局命令面板，也没有任何注册表；只有三个"需要先有入口动作"的 composer 局部浮层。**

| 现有入口 | 形态 | file:line | 是否算命令面板 |
|---|---|---|---|
| `/` 斜杠补全菜单 | **combobox，焦点留在 textarea**，`role=listbox` + `aria-activedescendant` | `dsh-client-ui-input-trigger/lib/client.js:776-789`；仲裁 `:403-419`；由 composer textarea 驱动 `conversation:3715-3790` | ❌ |
| 命令选择浮层 | **持焦**（内层搜索框接管焦点），`Enter`/`↑↓` 驱动高亮、`Esc` 回 composer | `dsh-client-ui-commands/lib/client.js:905-970`（首焦 `944`，键盘分支 `949-970`） | ❌（是**命令触发**的，非热键唤起） |
| 工具行「+」按钮 | `aria-label=命令`、`aria-haspopup="listbox"`、`aria-expanded` | `dsh-client-ui-conversation/lib/client.js:4078-4086`；运行时实测 Tab 序 #4 | ❌（需点击） |

⇒ **新增命令面板的最小实现形状**：复用 `commands:905-970` 的 `PopupSelectView` + `filterOptions` + `popup.move`（它已具备首焦/↑↓/Enter/Esc+回焦四件套），只缺**全局热键入口**与**跨插件注册表**。

---

## 3. ③ 高频操作步数分析（当前 vs 可达最小）

步数口径：鼠标步 = 一次点击（含必要指针移动）；键盘步 = 一次按键。**"可达最小"指在现有代码结构上加最小改动可达到的下限**，并注明靠什么实现。

| 操作 | 当前·鼠标 | 当前·键盘 | 可达最小·鼠标 | 可达最小·键盘 | 差距来自哪里（file:line） |
|---|---|---|---|---|---|
| **切换会话**（列表点行） | **1** | **不可达**（绕行：点搜索→输入→点结果 ≈ 5） | 1（已达成） | **2**（列表获焦 + `Enter`；或 `↑↓` + `Enter`） | 行是 `<div role=treeitem>` 无 `tabIndex`/`onKeyDown`：`workspace:718-724`；树容器无 roving：`:1328`/`:1533` |
| **打开设置** | 1（点侧栏"设置"） | **1 Tab + Enter**（设置在 Tab 序 **#12–#16**，随初始态/面板内容变动，见 §0.3） | 1 | **1**（`Cmd/Ctrl+,`） | 无热键：全库 `metaKey/ctrlKey` 仅 2 处（`conversation:3758`/`:3779`）；触发按钮 `settings-general:203-212` |
| **返回**（关详情面板） | 1（点"关闭详情"） | **实际不可用**（面板挂载时 Tab 会落进 **0 宽**、`overflow:hidden` 的列；见 §1.4） | 1 | **1**（`Esc`） | 面板无 Esc、`closeDetails()` 不还焦：layout `:304-306`；列从不卸载：`:32`/`:233` |
| **复制消息** | 1（按钮常驻，真 `<button>`+`aria-label`） | **2**（Tab + Enter），已可达 | 1 | **1**（聚焦消息后 `Ctrl/Cmd+C` 且无选区 → 复制） | 按钮 `conversation:5108-5114`；**无消息级快捷键** |
| **搜索会话** | 1（点搜索按钮）+ 输入 | **Tab + Enter + 输入** | **1 键唤起** | **1**（`Cmd/Ctrl+K` / `Ctrl+F`） | 无热键；搜索框收起时 `tabindex=-1`：`workspace:1924` |
| **批量选择**（多选/全选/Shift 区间） | **功能不存在** | **功能不存在** | — | — | `multiSelect`/`selectionMode`/`selectedIds`/`selectAll` 在 sidebar/layout/workspace/conversation **0 命中**；全库 `shiftKey` 仅 3 处且均不相关（`conversation:3728`/`:3761`、`user-questions:456`） |
| **折叠/展开侧栏** | 1 | **1 Tab + Enter**（Tab 序 #2–#10，随初始态变动） | 1 | **1**（`Ctrl/Cmd+B`） | 按钮 `dsh-client-ui-sidebar/lib/client.js:185-186`；无热键 |
| **新建会话** | 1 | **1 Tab + Enter**（Tab 序 #3–#11，随初始态变动） | 1 | **1**（`Ctrl/Cmd+N`） | 按钮 `sidebar:207-211`；无热键 |

**结论**：鼠标路径普遍已是 1 步（无可压缩空间，且实测"点击设置"本身廉价：incident2 四条线收敛为 click→可见 13.2–19.8 ms、0 个 >50 ms 长任务）；**真正的差距全在键盘侧**——会话切换从"不可达"到 2 步、返回/搜索/设置/折叠 从"多步或不可用"到 1 步，且**批量选择整功能缺失**。

---

## 4. ④ 输入延迟（输入框在长会话下的按键到渲染）

### 4.1 判定：**量级 INCONCLUSIVE（环境 + 只读授权限制）；机制 PASS（静态确证）**

**结论一句话**：**长会话 vs 短会话的"按键→渲染"延迟我没有测到数**——不是仪器不行（仪器已自证可用），而是**本线拿不到"可打字的 composer"**。原因是产品的一处状态前置条件 + 本任务的只读禁令，两条叠在一起把这条测量路径**结构上堵死**。我把机制用静态证据补上了，并给出了可直接复跑的探针。

### 4.2 仪器自证（PASS，可排除"通道不灵"）

| 对照 | 结果 | 说明 |
|---|---|---|
| 引擎/口径自证 | `HeadlessChrome/131.0.6778.33`（Blink），`devicePixelRatio=1`，`visibilityState=visible`，`longtaskSupported=true` | 按协议 §五.9/10 读回，不靠推断 |
| **阳性对照**（**页内** `setTimeout` 注入 120 ms 忙循环） | `n=1, duration=120.0 ms` | 通道确证可用；**按协议 §五.19 用页内注入，未用 CDP `Runtime.evaluate`**（后者对 LongTask 是盲区） |
| **阴性对照**（静置 1.2 s） | `n=0` | 无自发长任务 |
| 帧间隔基线（hero 静置态） | `frames=286`，`frameInterval p50=16.7 ms / p95=16.8 / max=16.8 / over50=0`，`frame JS p50=0.1 ms` | 空载不卡；可作"没坏"哨兵 |

### 4.3 为什么测不到：状态前置条件（三项运行时证据，链式）

1. **新浏览器默认落"无工作区" hero ⇒ composer 是只读的**
   `raw/diag2.log.txt §Q1`：`focus() 后 activeElement: TEXTAREA.uV2eYG_input readOnly=true`；`press("a")` 产生 `keydown a`（target=TEXTAREA、`defaultPrevented=false`）但**没有 `input` 事件**、`value` 保持 `""`。
   这是**有意的同一 DOM 复用**（`dsh-cordis-client-runner/lib/client.js:2352` 契约文档：*the no-workspace hero renders the **SAME textarea DOM as a read-only Workspace-picker trigger***；`dsh-client-ui-conversation/lib/client.js:3719-3726` 把 `Enter/Space` 改派为"打开工作区选择器"）。
2. **同一状态下侧栏会话列表渲染 0 行、会话搜索返回 0 条**
   `raw/probe3.log.txt §A/§B`：把 `dsh` 工作区行的展开状态置为 `aria-expanded="true"`（JS `.click()` 确实生效，实测 `before:"false"` → 之后 `"true"`）后，子树里**仍然只有 `projectRow`，`sessionRow` 计数 = 0**；随后"找未展开的 `treeitem` 当会话行"得到 `candidates: 0`。
   `raw/diag2.log.txt §Q2`：展开会话搜索并输入 `btw` 后 `visibleTreeitems: 0`、`allButtons: 4`。
   ⇒ 与静态一致：会话行只在 `group.expanded && group.sessions.length > 0` 时渲染（`dsh-client-ui-workspace/lib/client.js:208` `sessions: expanded ? g.sessions.map(...) : []`）。**无工作区上下文时 `group.sessions` 为空**。
3. **要拿到可打字的 composer，必须先"选中工作区"**——那是**宿主侧持久状态**（`~/.dsh/storages/workspace.json`），会改动用户正在使用的 GUI 状态。

> **本任务的硬约束是"只读审计"**（且用户正在使用该 GUI）。因此本线**主动放弃**这一步，不越过只读边界去换取一个延迟数字。**这是被授权的边界，不是失败。**

### 4.4 机制：每次按键到底重渲染多少（静态确证，file:line）

按键路径：`textarea.onKeyDown`/`onChange`（`dsh-client-ui-conversation/lib/client.js:3786-3795`）→ `keyboard.setDraft(next, …)` → input store 变更。而 input store 的**订阅者用的是整体选择器 `(s) => s`**：

| 订阅点 | 选择器 | 后果 |
|---|---|---|
| `dsh-client-ui-conversation/lib/client.js:3561`（`InputBar`） | `useInput((s) => s)` | composer 自身重渲染（预期内） |
| `dsh-client-ui-conversation/lib/client.js:7159`（**`ConversationRoot`**） | `useInput((s) => s)` | **整个对话区根节点每次按键重渲染** |
| `dsh-client-ui-conversation/lib/client.js:7403`（**`ConversationSession`**，渲染 `renderSlot("conversation.view")`） | `useInput((s) => s)` | **对话视图容器每次按键重渲染** |

且 `ConversationRoot` 另外还整体订阅了 **session 全状态**（`:7158` `useSession((s) => s)`）、**workspaces 全状态**（`:7161`）、**composerBlock 全状态**（`:7162`）。

**兜底是存在的**：消息行普遍有 `react.memo`（`conversation:5384` `UserMessageNodeView`、`:5480` `ChatNodeSeat`、`:9526` `AssistantNodeView`、`:9461` `AssistantMarkdown` 等十余处）。

⇒ **静态结论（PASS）**：一次按键的固定开销**包含一次覆盖整个对话区子树的重渲染 + 对所有消息行的 memo 逐项比较**，其**下界随消息数量线性**（列表 map + memo 比较），但**单行渲染成本被 memo 挡住**，所以预期是"随会话长度缓慢劣化"而不是"线性爆炸"。**这条预测未经运行时量化验证**。

### 4.5 未能测量的确切范围（诚实清单）

- 未测：`keydown → input` 延迟、`keydown → 下一帧` 延迟、打字期间帧间隔分布、打字期间 LongTask，**以及它们随会话规模的变化**。
- 未测：鼠标跟手性、滚动、hover 响应。
- 已被本线**否定**的相关假设：❌「高回报率鼠标 + 每事件重排导致跟手掉帧」（已证伪，见 §0.2，本线未复现任何跟手掉帧）。

### 4.6 复跑方式（交有写权限的一档，约 3 分钟）

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/program/w12-input-ux
# 前提：先在浏览器里选中一个工作区（或直接点开一个会话），使 composer 的 readOnly 变为 false
node tools/probe-latency3.mjs > out/latency3.run.txt 2>&1   # 同窗交错 SHORT→LONG→SHORT→LONG
```
探针已内置：`readOnly` 自证（不满足即判该 rep 作废并记录在案）、阳性/阴性对照、每次打字后清空草稿并自证 `value===''`、`domNodes`/`msgChildren` 作为剂量变量。
**两个已修好的探针 bug（别再踩）**：① 工作区行必须用 **JS `.click()`** 触发展开——用鼠标坐标点击会被 `projectRow` 的 hover-card 抢占落点（`latency2` 的 4 个 rep 因此全部作废，已剔除非数据）；② 启动谓词不能用 `#root.textContent.length > 200`（hero 态只有 143 字符会假失败），要用 `button` 计数。

---

## 5. ⑤ 最小改动、最高收益的操作优化（前 5 项）

优先级排序依据 = （受益人数 × 频率 × 严重度）÷ 改动成本。全部标注**生效面**与**风险**。

### 优化 1 —— 让会话行可聚焦（roving tabindex + Enter 打开）

- **改哪里**：`dsh-client-ui-workspace/lib/client.js:718-724`（会话行）、`:469-473`（工作区行）；树容器 `:1328`/`:1533` 维护唯一 `tabIndex=0`。
- **怎么改（最小形状）**：行改为 `tabIndex={selected ? 0 : -1}` + `onKeyDown`（`Enter`/`Space` → 现有 `onOpen(id)`；`↑↓` → 移动 roving 光标；分组行接 `←→` 做展开收起，`:471` 已有 `aria-expanded`）。
  **不要改成 `<button>`**——行内已嵌 `<button>`（`:772`），button 套 button 是非法 HTML。
- **验收标准**：
  1. 无模态时 Tab 序中**出现**会话行（本线复测脚本 `tools/probe-focus2.mjs §A3` 可直接复用，判据：Tab 序出现 `role=treeitem` 元素，且 `tabIndex` 为 0/-1）；
  2. 聚焦某行按 `Enter` ⇒ `sessionId` 变更、对话区渲染出该会话（判据：`[data-slot="conversation.session"]` 子节点数 > 0）；
  3. `↑↓` 连续移动 5 次，`document.activeElement` 的 "行文本" 单调变化；
  4. 鼠标路径回归不变（原 `onClick` 行为逐字节保持）。
- **风险**：中。需与拖拽（`:725-742` `draggable`/`onDragStart`）、淡入动画（CSS `row-in`，`:334`）协调；roving 光标需要新增 per-tree 状态。
- **生效面**：**热面（刷新即生效）**。

### 优化 2 —— 给模态/浮层补"栈顶 Esc 仲裁 + 焦点陷阱 + 关闭还焦"三件套

- **改哪里（优先 3 个最高频面）**：设置弹窗 `dsh-client-ui-settings-general/lib/client.js:96-168`；btw 抽屉/灯箱 `SideChatDrawer.tsx:47-56`、`SideChatSurface.tsx:196-207`；官方通用 `Modal`（primitives，bundle 内 `$u`）。
- **怎么改（最小形状）**：
  1. **还焦**：`SettingsPanel` 记录 `document.activeElement`（打开时）并在卸载时 `?.focus()`——范式直接照抄 `dsh-client-ui-attachment/lib/client.js:416-424`（**产品内唯一记录"真实上一焦点"的实现**）。这一条单独就能覆盖"关闭后焦点落 body"。
  2. **陷阱**：面板容器加 Tab 循环；`#root` 加 `inert`——范式照抄 `dsh-client-ui-settings-models/lib/client.js:2139-2146`（`appRoot.inert = true` + 还原，前置条件已满足：Modal 已 `createPortal` 到 `document.body`）。
  3. **栈顶仲裁**：把 `dsh-workspace-enhancement/lib/client.js:2241-2266` 的 stack 模式提取为共享原语，7 个裸 Esc 监听改为注册到该栈；过渡期最小改动 = 每处处理体先 `if (event.defaultPrevented) return`，最内层 `preventDefault()` 标记已消费。
- **验收标准**：
  1. 打开设置 → Tab **40 次，落点全部 `inPanel=true`**（本线 `tools/probe-focus.mjs §2` 的 tab walk 判据，当前 FAIL 点为 #16–#31；改后应为 0 个 `inPanel=false`）；
  2. 关闭后 `document.activeElement === 设置触发按钮`（当前 FAIL：`=false`）；
  3. 叠层场景（设置 + ContextMeter 同开）按一次 `Esc` ⇒ **只有最上层关闭**（同时可结清 §2.5 F-8 的 INCONCLUSIVE）；
  4. `role="dialog"` 与 `inert` 并存回归：打开弹窗后背景元素**不可**被 Tab 到、也**不可**被点击穿透。
- **风险**：中。`#root` inert 会一并冻结 `#root` 内的其它 portal 目标（须逐个核对）；陷阱必须放行 IME/组合输入，并处理"无可聚焦元素"分支（参考 `workspace-enhancement:2249-2253` 的 `element.focus()` 兜底）。
- **生效面**：`settings-general`/btw 为**热面**；primitives 的 `Modal` 属**跨包改动**（primitives 不在 deployed 插件目录内，以 minify 形态打进 `dsh-web-frontend/dist/assets/*.js`）⇒ **必须动源码仓并重建 web 产物**。

### 优化 3 —— 新增最小全局命令面板 + 快捷键注册表（1 条新键先落地）

- **改哪里**：扩展 `dsh-client-ui-commands`（复用其 `PopupSelectView`，`lib/client.js:905-970`）+ 新增一个 cordis 服务 `keyboardRegistry`（模式参照 `conversation:1552-1560` 的 face，但**跨插件可注入**）。
- **怎么改（最小形状）**：`register({ id, chord, label, run, when })`；入口键 **`Cmd/Ctrl+K`**（`code === "KeyK"` 且同时接受 `key === 'k'`，兼顾非 QWERTY；与现有 `Cmd/Ctrl+Enter`/`Cmd/Ctrl+Z`/`Cmd+Shift+.` 均不冲突）。**三条硬纪律**：① 全局键默认在 `INPUT/TEXTAREA/SELECT/contentEditable` 内**不触发**（同时修 §2.4 C-2）；② Esc 一律走优化 2 的栈；③ 面板内逐条显示 chord（同时修 §2.5 F-1）。
- **验收标准**：
  1. 任意位置按 `Cmd/Ctrl+K` ⇒ 面板打开、焦点在搜索框（判据：`document.activeElement` 是面板内 input）；
  2. 在 composer 中按 `Cmd/Ctrl+K` ⇒ **面板打开且不吞字符/不触发提交**；
  3. 面板内 `↑↓` 移动高亮、`Enter` 执行、`Esc` 关闭并**把焦点还给 composer**；
  4. 注册表冲突检测：注册两个同 chord 命令 ⇒ 后注册者被拒绝并输出告警（需新增 1 条单元断言）。
- **风险**：中。需新增服务契约 + 至少 1 个消费点；primitives 可用版本未确证（见 §2.5 F-2 相关 INCONCLUSIVE），建议**先只动 `dsh-client-ui-commands`**，不碰 primitives。
- **生效面**：**热面（刷新即生效）**。

### 优化 4 —— 修"焦点落进不可见控件"与"搜索收起不还焦"（两处一行级改动）

- **改哪里 A**：`dsh-client-ui-layout/lib/client.js` 的详情列 —— 在 `cols.details === 0` 时设 `inert`，过渡结束后再生效（复用 `dsh-client-ui-sidebar/lib/client.js:83`/`:97-109` 的 `COLLAPSE_SETTLE_MS` 思路）。
- **改哪里 B**：`dsh-client-ui-workspace/lib/client.js` 给搜索按钮加 `ref`（`:1905-1915`），在 Esc 收起（`:1928-1932`）、清空（`:1938-1942`）、click-outside 收起（`:1732-1749`）三条路径后 `searchButtonRef.current?.focus()`。
- **改哪里 C（同一批，纯 CSS 一行）**：给 composer 主输入框补焦点环——实测其计算样式为 `outline:none/0px` + `box-shadow:none`（`raw/probe3.log.txt §C`），**两条通道都没有焦点指示**。加一条 `:focus-visible` 的 outline 或 box-shadow 即可（同时建议把按钮默认的近黑 1 px 环换成主题化颜色，因为深色主题下近黑环几乎不可见——该点在本线**未实测**，标 INCONCLUSIVE）。
- **验收标准**：
  1. 详情关闭状态下连续 Tab 30 次，**面板已挂载时**无任何落点在 `[data-slot="details"]` 子树内（当前 FAIL 点：Tab #7；注意无会话时该面板本就不挂载，脚本需先自证面板已挂载再判）；
  2. 展开搜索 → 按 `Esc` ⇒ `document.activeElement` 是搜索按钮（当前 FAIL：焦点留在已变 `tabIndex=-1` 的 input）；
  3. 点击外部收起搜索 ⇒ 同上；
  4. 详情面板**正常打开**时其内部控件仍可 Tab 到（inert 只作用于 `details===0`）；
  5. composer 聚焦后 `getComputedStyle(textarea).outlineWidth !== '0px'` 或 `boxShadow !== 'none'`（当前两条均为空）。
- **风险**：低。两处都是局部改动，无新契约。
- **生效面**：**热面**。

### 优化 5 —— 让快捷键可发现 + 补回"被吞掉"的高频键

- **改哪里**：① 文案/tooltip 层：为 `Cmd/Ctrl+Enter`、`Shift+Enter`、`Cmd/Ctrl+Z` 等已存在键补键位角标；为 btw 的 `Cmd+Shift+.` 在 `SideChatButton` 的 `title`（`SideChatButton.tsx:28-38`）与实际 tooltip 中补键位。② 行为层：btw 全局键加**输入元素豁免**（`if (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return`，`dsh-btw/src/client/index.ts:88`）。
- **验收标准**：
  1. 全库"有 UI 提示的语义快捷键"从 **2 条 → ≥ 6 条**（grep 判据：`conversation` 的 i18n 文案 + btw tooltip 文案）；
  2. 在可编辑输入框（composer textarea 或会话搜索框）中按 `Ctrl/Cmd+Shift+.` ⇒ **抽屉不切换**，且**字符 `>` 正常插入**（当前行为相反：字符被吞，见 §2.5 F-9 与 `raw/btwkey.run.txt`）。测法：`input` 事件数应为 1、`value` 应变为 `">"`；
  3. 在无输入焦点时按同一组合 ⇒ 抽屉**正常切换**（回归哨兵）。
- **风险**：**低**（纯增量文案 + 单文件单函数守卫）。
- **生效面**：纯文案为**热面**；btw 改动需重建 btw 的 `lib/client.js`。

---

## 6. 逐条判定汇总（PASS / FAIL / INCONCLUSIVE）

### 6.1 ① 键盘可达性

| # | 结论 | 判定 | 证据类型 |
|---|---|---|---|
| 1 | 设置弹窗打开后首焦 = 关闭按钮 | **PASS**（行为明确，但首焦对象选择本身可讨论） | 运行时实测 + 静态 `settings-general:108-111` |
| 2 | 设置弹窗**无焦点陷阱**，Tab 16 次即逃到背景 | **FAIL** | **运行时确证**（probe-focus true-positives） |
| 3 | 设置弹窗关闭后**不恢复焦点**（Esc / 遮罩点击两条路径均落 `body`） | **FAIL** | **运行时确证** |
| 4 | 会话/工作区行**键盘不可达**（`<div role=treeitem>` 无 `tabIndex`） | **FAIL** | **运行时确证**（`tabindex=null`）+ 静态 `workspace:718-724`/`:469-473` |
| 5 | 行内动作按钮 hover-only ⇒ 键盘不可达 | **FAIL** | **运行时确证**（`w:0 h:0`）+ 静态 `workspace:334` |
| 6 | `role="tree"` 声明 3 处但无树形键盘模型 | **FAIL** | 静态（`:1328`/`:1533`/`:1613`；Arrow/Home/End 计数 0） |
| 7 | 详情面板关闭时焦点落进被裁成 0 宽列内的不可见控件（**条件性：面板挂载时**） | **FAIL（条件性）** | **运行时确证**（Tab #7 落点）+ 几何实测 `w=0/overflow=hidden` + 静态 layout `:32`/`:48-52`/`:233` |
| 8 | Tab 序与视觉列序关系 | **INCONCLUSIVE**（两轮观测的列顺序**相反**，未定位原因） | 两轮运行时实测（`probe-focus` vs `geom`） |
| 8b | 主输入框（composer textarea）的 **`outline` 与 `box-shadow` 双通道均不提供焦点指示** | **FAIL** | **运行时确证**（`probe3 §C`） |
| 8c | 是否存在 border 通道补偿焦点指示 | **INCONCLUSIVE** | 未采证 border 三态 |
| 8e | 深色主题下按钮默认焦点环（近黑 1px）是否不可见 | **INCONCLUSIVE** | 未在深色主题下复测 |
| 8d | 未选工作区时会话列表展开为空、会话搜索 0 结果，且**列表/搜索处**无提示（但输入框 placeholder 有提示） | 可用性**FAIL（降级）**；用户侧是否遇到 **INCONCLUSIVE** | **运行时确证**（`probe3 §A/§B`、`diag2 §Q2`）+ 静态 `workspace:208` |
| 9 | 官方 12 个浮层全线可 Tab 逃出（零 `inert`、零 Tab 处理） | **FAIL** | 静态全量 grep + 抽样运行时 |
| 10 | 产品内已存在 3 处"正确范式"（还焦 / `#root inert` / Tab 栈 + 栈顶仲裁）但**均未被官方浮层复用** | **PASS**（事实确证） | `attachment:416-424`、`settings-models:2139-2146`、`dsh-workspace-enhancement:2240-2269`（**该包在 `~/.dsh/profiles/node_modules/` 下，不在 `@deepseek-ai/*`**） |
| 11 | 无工作区态下 composer 是只读 Workspace 选择器（有意），且**有明示**（`aria-label="选择工作区"` + placeholder `"选择一个工作区开始"`） | **PASS**（**取代原稿的 FAIL——原稿漏读了 placeholder，见 §1.6 自纠**） | **运行时确证**（`raw/probe-focus.log.txt` Tab #3）+ 静态 `conversation:3719-3726` |
| 11b | "新浏览器的默认初始态是什么"（是否已选定工作区） | **INCONCLUSIVE**（两轮 boot 观测到两种初始态；受宿主侧持久状态与并行线影响） | 两轮运行时实测对比 |
| 12 | btw 抽屉为非模态 `complementary`（无陷阱在语义上自洽） | **PASS** | 静态 `SideChatDrawer.tsx:76` |
| 13 | btw 灯箱声明 `aria-modal="true"` 但**不移入焦点** | **FAIL** | 静态 `SideChatSurface.tsx:196-212` |
| 14 | message-feedback / model-selection / subagent / jobs / attachment 的首焦与还焦 | **PASS** | 静态（逐条行号见 `findings-B`） |

### 6.2 ② 快捷键

| # | 结论 | 判定 | 证据类型 |
|---|---|---|---|
| 15 | **不存在**快捷键注册中心 / keymap / 仲裁层 | **PASS** | 全量 grep（8 万行仅 2 处修饰键命中）+ 行为学旁证（`Ctrl+K/P/B//,/\` 全 `changed=false`） |
| 16 | 真·全局组合键**只有 1 条**（btw `Cmd/Ctrl+Shift+.`） | **PASS** | 静态（`dsh-btw/src/client/index.ts:86-95`） |
| 17 | "keyboard command face" 不是注册中心，是 package-internal composer shell | **PASS** | 静态 JSDoc `conversation:1552-1560` |
| 18 | 7 个 Esc 监听器无仲裁 ⇒ 一次 Esc 可连关多层 | **FAIL**（机制确证）；叠层复现 **INCONCLUSIVE** | 静态 + 未构造出叠层运行时 |
| 19 | btw 全局键无输入元素豁免 ⇒ 在输入框里**吞掉按键**（并视会话状态决定是否切换抽屉） | **FAIL** | **运行时确证**（`raw/btwkey.run.txt`：`Ctrl+Shift+.` ⇒ 0 条 `input`、value 不变）+ 读码 `dsh-btw/src/client/index.ts:88-91` |
| 20 | primitives `Menu` 无键盘导航，各包自绘导航行为不一致 | **FAIL** | 静态（`Menu` bundle `Vu` 无 ↑↓；对比 4 处自绘） |
| 21 | 32 条语义快捷键里仅 2 条可发现 | **FAIL** | 静态全量 grep |
| 22 | 命令面板**不存在**（只有 3 个 composer 局部浮层） | **PASS**（裁定明确） | 静态（`commands:905-970`、`input-trigger:776-789`、`conversation:4078-4086`）+ 运行时（`Ctrl+K` 无反应） |
| 23 | 无平台判断缺失（`metaKey \|\| ctrlKey` 跨平台正确） | **PASS** | 静态 |
| 24 | btw 热键在非 QWERTY 布局不可达 | **INCONCLUSIVE** | 机械推断，未实机验证 |
| 25 | `Backspace/Delete` 引用块删除、`Space` 引用收尾等隐式键无任何提示 | **FAIL** | 静态 `conversation:3730-3748`/`:3765-3769` |

### 6.3 ③ 步数 / ④ 延迟

| # | 结论 | 判定 | 证据类型 |
|---|---|---|---|
| 26 | 鼠标路径普遍已 1 步（无可压缩空间） | **PASS** | 运行时 Tab/点击实测 + incident2 四条线（click→可见 13.2–19.8 ms） |
| 27 | 切换会话：鼠标 1 / **键盘不可达**（可达最小 2） | **FAIL** | 运行时 + 静态 |
| 28 | 复制消息：鼠标 1 / 键盘 2（已可达，缺 1 键路径） | 部分 FAIL | 静态 `conversation:5108-5114` |
| 29 | 搜索会话缺全局唤起键（可达最小 1） | **FAIL** | 静态 + 运行时 |
| 30 | 批量选择**功能不存在** | **FAIL**（缺失，非缺陷） | 静态全量 grep 0 命中 |
| 31 | 详情面板"返回"无 Esc（可达最小 1） | **FAIL** | 静态 layout `:304-306` |
| 32 | 输入延迟**量级**（长会话 vs 短会话） | **INCONCLUSIVE**（环境 + 只读授权限制；原因链见 §4.3） | 仪器自证 PASS（阳性 120.0 ms / 阴性 0），但未取得打字 rep |
| 33 | 按键重渲染的**机制**：`ConversationRoot`/`ConversationSession`/`InputBar` 均以整体选择器 `useInput((s)=>s)` 订阅 ⇒ 每次按键重渲染整个对话区容器；消息行有 `react.memo` 兜底 | **PASS**（静态确证） | `conversation:3561`/`:7159`/`:7403`（+ `:7158`/`:7161`/`:7162` 整体订阅）；memo `:5384`/`:5480`/`:9526`/`:9461` |
| 34 | 输入延迟**随会话规模劣化的量级** | **INCONCLUSIVE** | 预测为"线性下界 + memo 挡住单行成本"，未运行时量化 |
| 35 | 鼠标跟手性 / 滚动 / hover 延迟 | **未测**（本线范围外；且已知"高回报率鼠标 + 每事件重排"主张**已证伪**，见 §0.2） | — |

---

## 7. 原始证据索引

| 文件 | 内容 |
|---|---|
| `raw/probe-focus.log.txt` / `raw/probe-focus.json` | ① 主探针：初始焦点、无模态 Tab 序 22 步、设置弹窗 Tab 序 40 步（含逃逸点 #16–#31）、Esc/遮罩关闭与还焦实测、10 组全局快捷键行为、LongTask 阳性对照 |
| `raw/probe-focus2.log.txt` / `.json` | 侧栏树结构、展开工作区后的行 DOM（`role=treeitem`/`tabindex=null`/`w=0 h=0` 动作按钮）、搜索入口 |
| `raw/diag2.log.txt` | **Q1** composer `readOnly=true` 自证；**Q2** 搜索行为（输入后 0 结果）；**Q3** btw 热键（无会话时未唤起）与 keydown/keyup 事件流水 |
| `raw/probe3.log.txt` / `raw/probe3.json` | 终局验证：展开后 `aria-expanded=true` 但 `sessionRow=0`、会话行候选 0、**焦点指示器逐项**、Esc 行为、`probe3-expanded.png`/`probe3-btw.png` 截图 |
| `raw/btwkey.run.txt` | **btw 全局热键的运行时确证**：`Ctrl+Shift+.` 在可编辑输入框里 ⇒ value 不变且 `input` 事件 0 条（吞键）；`Shift+.` 单独按 ⇒ `">"`；对照 `x` ⇒ `"x"`；完整 keydown/keyup/input 事件流水 |
| `raw/geom.run.txt` | 详情列几何（`w=0, x=1600, overflow=hidden`）、面板未挂载证据（`detailsSlotChildren=0`）、第二轮 12 步 Tab 序（与 `probe-focus` 顺序相反） |
| `raw/probe-latency.log.txt`、`raw/latency.run.txt`、`raw/latency2.run.txt`、`raw/latency3.run.txt`、`raw/probe-latency2.json`、`raw/probe-latency3.json`、`raw/probe-latency3.log.txt` | 延迟探针三代原始日志。**latency/latency2/latency3 的 arm 全部作废**（原因：启动谓词假失败 / 鼠标点被 hover-card 抢占 / composer readOnly），**已按"失败 rep 不作数据"逐条记录在日志中**，仅保留阳性/阴性对照与树结构 dump 作证据。
⚠️ 口径说明：`raw/latency*.run.txt` 与 `raw/probe-latency.log.txt` 是**探针 stdout 的落盘捕获**（探针被信号杀死时其脚本内的 `writeFileSync` 日志**不会落盘**——这正是抓不到的产物；stdout 与脚本内日志是同一批 `say()` 行，故内容等价）。 |
| `raw/dump-dom.log.txt` / `dom-skeleton.txt` / `focusables.json` / `slots.json` / `boot.png` | 启动 DOM 骨架、42 个可聚焦元素（17 可见）、`data-slot` 归属表 |
| `raw/findings-A-sidebar-sessions.md` | 分支 A（292 行）：侧栏/会话列表/会话切换/对话区高频操作静态审计 + 步数表 + G1–G10 缺口 |
| `raw/findings-B-overlays-shortcuts.md` | 分支 B（424 行）：btw 抽屉 + 12 个浮层焦点矩阵 + **快捷键总表** + C-1…C-10 冲突清单 + 命令面板裁定 + 补全方案 |
| `tools/dump-dom.mjs`、`tools/probe-focus.mjs`、`tools/probe-focus2.mjs`、`tools/diag2.mjs`、`tools/probe3.mjs`、`tools/probe-geom.mjs`、`tools/probe-btwkey.mjs`（btw 热键吞键确证）、`tools/probe-latency{,2,3}.mjs`、`out/*.run.txt` | 全部探针脚本与原始运行日志（可复跑） |

### 复跑方式

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/program/w12-input-ux
node tools/probe-focus.mjs   > out/probe-focus.run.txt 2>&1    # 焦点矩阵 + Tab 穿透 + 快捷键行为
node tools/diag2.mjs         > out/diag2.run.txt 2>&1          # composer 可编辑性 / 搜索 / btw 热键
node tools/probe-latency2.mjs > out/latency2.run.txt 2>&1      # 输入延迟同窗对照
```
