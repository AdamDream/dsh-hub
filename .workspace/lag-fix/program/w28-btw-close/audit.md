# w28 · btw（侧边对话）「X 关闭按钮」关闭相卡顿审计

> 用户报告（最高优先级）：**点击 btw（侧边对话）的 X 关闭按钮时，关闭这个界面会很卡。**
> 本线只写有证据的结论，逐条给 **PASS / FAIL / INCONCLUSIVE**，并显式标注**每条结论的测量覆盖范围**与**未能量化处**。
> 日期：2026-09-22（本地时区，13:40–16:4x）。宿主 `dsh web` PID **301709**（全程未重启、未发信号、未 pkill 用户浏览器；用户浏览器 PID 494362 / 547226 全程存活）。
> 原始数据：`raw/*.json`；探针：`probes/*.mjs` + `probes/init-probe.js`；分析器：`tools/analyze.mjs`。
> **本线未改动任何产品文件**（唯一被写的目录是本线独占的 `.workspace/lag-fix/program/w28-btw-close/`）。

---

## 〇、结论速览

| # | 结论 | 判决 |
|---|---|---|
| 1 | **X 不是"最小化"，是"结束 btw"(End)**：抽屉头部 `×`（`aria-label="结束 btw"`）先弹确认框；`—`（`收起 btw`）与 Escape 才是最小化 | **PASS（已确证）** |
| 2 | **关闭相分两段，卡的是"确认框可见期"**：点 ×（干净，0–1 长帧）→ 确认框可见 **3.5–3.7 s**（**24–40% 帧 >33 ms，帧率跌到 19–30 fps**）→ 点「结束」→ 面板消失 | **FAIL（缺陷成立）** |
| 3 | **根因可被否证地定位：确认框的全视口 `backdrop-filter: blur(2px)` 遮罩**（`._mask_15u5s_14`，areaShare=1.0）。**页内禁用它**后同段 >33 ms 帧占比 **24–40% → 2–3%**，帧率 19–30 → 45–50 fps | **PASS（A/B/A 成立，见 §三）** |
| 4 | **打开相干净**（3/495 帧 >33 ms = 0.6%，与静止相 0.6% 同水平）⇒ **"关闭比打开差"成立，且差 8–12 倍** | **PASS** |
| 5 | **Escape / `—` 关闭同样干净**（0–0.6% 长帧、0–1 条 LoAF）⇒ 问题**只挂在 X 这条路径**上 | **PASS** |
| 6 | **面板消失本身不慢**：6/6 rep 抽屉 DOM 在点「结束」后 **19–79 ms**（≤2 帧）内消失（**不受** `sideChat/close` 门控——该 RPC 实测 18 / 65 / 1044 / 1054 / 1139 / 2644 ms） | **PASS（不是主因）** |
| 6b | **但存在间歇竞态（1/6 rep）**：抽屉在点击后消失、**+32 ms 又复活**，直到 `sideChat/close`（该 rep 2644 ms）落地才真正卸载 ⇒ 从点「结束」到界面消失 **2661 ms**（用户会看到面板"弹回来"） | **FAIL（成立但间歇）**；机制 **INCONCLUSIVE** |
| 7 | 点「结束」后客户端在 **2/3 rep** 又发了一条 `sideChat/listTree`（点后 10–31 ms），**耗时 27.5–58.8 s**，结果对用户不可见 | **FAIL（多余取数）** |
| 8 | H2「关闭触发整体订阅整树重渲染」**不成立**（btw 不写 input store；实测窗口内 mutations 仅 21 次、无侧栏重建） | **FAIL（否决）** |
| 9 | H3「关闭让 usage 面板重新可见并取数」**不成立**（题面行号不存在；真实门控是 IntersectionObserver + `document.hidden`、周期 60 s，翻可见不立即取数） | **FAIL（否决）** |
| 10 | H5「焦点陷阱拆除触发滚动/布局」**不成立**；但**"关闭后焦点丢到 body"确证**（`activeElement=BODY`） | **FAIL（性能机制）/ PASS（行为核实）** |
| 11 | H6「就是环境」**不成立为本线差异的解释**：环境决定**绝对**帧率上限，但**同窗内所有臂同等承担**；关闭相的额外损失是**臂内差分**，不能记在环境账上 | **FAIL（否决）** |
| 12 | 环境侧（w14：5120×2880@DPR2 极简页 42.4 Hz、掉帧 27.2%）在本线器械内的对照形态 = 静止相**孤立** ~0.65–0.69 s 帧（6 s 内 0–1 次），**不构成持续掉帧** | **PASS（已标注不可跨引擎搬运）** |
| 13 | **未能在 Gecko / 用户真实环境复核**（Gecko 无 LoAF/LongTask，Firefox 155 无 CDP ⇒ 只能 wall-clock；本线未跑有头 Gecko） | **INCONCLUSIVE（环境限制）** |

**一句话**：用户点的那颗 X =「结束 btw」——它会先弹一个**带全视口 `backdrop-filter: blur(2px)` 遮罩**的确认框；**这个遮罩把整页从 60 fps 拖到 19–30 fps（重时 4.3 fps）**：确认框可见的 3.5 s 里 **1/4–2/5 的帧超 33 ms**（同一页内把该 blur 关掉即回到 **45–56 fps、2–3%**）。打开相没有这个遮罩，所以"关闭比打开差"；Escape/最小化也没有，所以"只有 X 卡"。**这与协调者此前对设置弹窗遮罩所做的修复（exec-mask F1）是同一个坑的另一个载体**（shell `Modal` 的那一份从未被测过——w11 §L9 明确登记为"未测、未改"）。
面板的**消失本身不慢**（5/6 rep 为 19–79 ms，不受 RPC 门控），但存在 **1/6 的间歇竞态**会让面板"弹回来"、把消失推到 **2.66 s**（与 `sideChat/close` 的 2644 ms 同量级）——这是**第二条、次要的**关闭相缺陷。

---

## 一、被测物身份、环境与器械（必须先读）

### 1.1 被服务的 btw 产物身份（⚠️ 极易搞错，本线已踩过一次）

| 路径 | md5 | 字节 | 是否被服务 |
|---|---|---|---|
| `~/.dsh/profiles/node_modules/@local/dsh-btw/lib/client.js` | **`73e90a5cb2f292e7853a440bea3a84de`** | 335,348 | **✅ 是** |
| `/home/CNS2026495165/dsh/dsh-btw/lib/client.js`（仓库新构建，含 resize handles） | `8bb93955954c0f08d340a241494590a6` | 361,167 | ❌ **不是** |

- 实测：`curl -s http://127.0.0.1:3080/plugins/@local/dsh-btw/client.js -o /tmp/btw-served.js` → 335,348 B、md5 **逐字节相同**；boot payload `rev=374dca63f9aa`。
- ⇒ **本文所有代码引用一律指向被服务产物**（`B/client.js`），**不引用**仓库里那份更新的 `src/*.tsx`（`SideChatDrawer.tsx` 已被另一条线的 resize 工作改写，行号会漂）。
- 静态档已独立复核同一 md5（`static-close-path.md §0`）。

### 1.2 关闭入口的四个身份（运行时读回，非推断）

被服务产物 `B/client.js:2817-2880` 的抽屉头部只有这两个"关"，运行时时读回：

| 入口 | glyph | `aria-label`（zh） | 动作 | 是否弹确认框 | 是否发宿主 RPC |
|---|---|---|---|---|---|
| **X** | **`×`** | **`结束 btw`** | `setConfirmEnd(true)`（`:1665-1667`）→ 确认框 → `presentation.end()`（`:2005-2009`） | **✅ 弹** | **✅ `sideChat/close`** |
| `—` | `—` | `收起 btw` | `viewStore.minimize`（`:2000-2004`） | ❌ | ❌ |
| Escape | — | — | 同 minimize（`:2829-2836`） | ❌ | ❌ |
| 移动端 scrim | — | `Minimize btw` | 同 minimize（`SideChatDrawer` 的 `mobileScrim`，桌面 `display:none`） | ❌ | ❌ |

运行时证据（`raw/close-campaign-main1.json` → `env.domOpen.drawBtns`）：
`[{"g":"▸"},{"g":"×","aria":"结束 btw"},{"g":"—","aria":"收起 btw"},{"aria":"发送"}]`
⇒ **用户说的"X 关闭按钮" = End 路径 = 本文主角**。（这也回答了静态档的提醒"请让报告人明确他按的是哪一个"：**他说的是 X，不是 Esc**。）

### 1.3 器械与窗口有效性

- **主器械 A（Blink，headless）**：`ms-playwright/chromium_headless_shell-1148`，UA 读回 **`HeadlessChrome/131.0.6778.33`**、`devicePixelRatio=2`；视口 **2560×1440 CSS px @ DPR 2 = 5120×2880 背衬**（**与用户配置同像素量**，w14 口径）。
- **通道能力自证**：LoAF 可用（同批 14 条 LoAF 带 `scripts` 归因）；**但绝大多数 LoAF 条目 `scripts: []` 且 `styleAndLayoutStart` 远落后于帧起点** ⇒ **这批掉帧是"渲染/合成受限"而非 JS 长任务**（与 §3.7 的 blur 机制一致）。
- **页内错误**：0（`raw.errs = []`），探针打桩未破坏应用。
- **页内主仪器** `probes/init-probe.js`（`addInitScript`，最早执行）：wall-clock rAF 间隔（回调入口 `performance.now()`）+ rAF `ts` 双口径、LoAF、LongTask、`getComputedStyle`/`getBoundingClientRect` 打桩、HTTP/WS RPC 台账、rAF 里程碑（抽屉/对话框/焦点/节点数）、`MutationObserver` 逐批 + **元素存在性逐批记录**、`animations()`、`arm/mark`（含 `performance.mark('w28:*')` 供 trace 对齐）。
- **窗口播种**：每个臂/子段都以 mark 界定，并**保留块前那一帧**（mark 记 `prevFrameIdx`，统计从 `frameIdx-1` 起）——协议 §五.19。
- **阳性对照**：**页内** `setTimeout` 120 ms 忙循环（协议 §五.13，**不用 CDP evaluate**）。实测：`B_POS120` 段出 **1 条 LoAF（50 ms）+ 1 帧 123 ms**，同窗口的 `poscontrol-120:start→:end` 页内标记对给出 **120.0 ms** ⇒ **通道灵敏、仪器没瞎**。
- **阴性对照**：`A_IDLE`（无抽屉、无注入）—— 6 s 内 **0 条 LoAF**、`p50 = 16.7 ms`、>33 ms 帧 2–3 个（0.6%）。
- **判据阈值**：一律用 **`>33 ms`**（`w14` 实测 `>50ms` 会假阴性：有 10–38 帧 >33 ms 却 0 帧 >50 ms）；正文同时给 `>50 ms` 计数便于对照。**分辨下界 ≈ 25–33 ms**（协议 §五.19 ④：`ts` 口径系统性低 ≈ 一个帧周期；本线主口径是 wall-clock，误差 +0…17 ms）。
- **锁与并发**：`lib/probe-lock.mjs` 全程读回 **`.probe.lock` 由兄弟线 `w27-scale150`（pid 1069928, liveness ALIVE）持有** ⇒ 本线按协议以 **`concurrent-annotated / CONTENDED`** 运行：**只做同窗（同页、同窗口、同器械、背靠背）相对比较**，不引用跨窗绝对数。并发普查（cmdline 口径，含 `--remote-debugging-pipe` 且不含 `--type=`）在每次开窗记入 `raw/*.json.env.census*`。

### 1.4 测量路径（真实用户路径，非复刻）

`w09` 未能复现真实路径（当时会话列表为空 ⇒ 页面上没有 btw 入口）。本线**复现成功**，路径与用户完全一致：

```
boot(GUI) → 等 session.list（本机实测 6.5 s / 18.3 s / >90 s / >300 s，方差极大）
 → 展开 dsh 工作区 → 点一条**旧会话**行（`/grill-me # 交接提示词 v5`，1 天前，**不是用户当前活跃会话**）
 → 会话头部出现 btw 入口按钮（`button[title="打开 btw"]`）→ 点它打开抽屉
 → **点抽屉头部 `×`（真实鼠标坐标点击）** → 确认框 → **点「结束」（真实鼠标坐标点击）** → 面板消失
```

- ⚠️ **只点安全目标**：工作区行/会话行本体、btw 入口、抽屉 `×`、确认框「结束」。**从未**点 `…` 菜单（Rename/Delete）、新建会话、发送。
- ⚠️ **副作用如实申报**：一次 smoke 运行误选了用户**当前活跃会话**（当时的 fallback 逻辑取"第一个未选中行"），把该会话**已存在的** parked btw 恢复了一次（`~/.dsh/btw/index.json` 里 `session-6ea8d570…` 的 `lastActiveAt`/preview 被刷新，**未新增条目、未删除任何条目、未结束任何会话**——diff 见 `raw/btw-index-before.json` vs 现状）。此后所有正式运行改为 `--session-match` 锁定**旧会话**，不再触碰活跃会话。

---

## 二、① 关闭相时间线（逐段时长 + 归属 file:line）

### 2.1 静态路径（被服务产物 `B = ~/.dsh/profiles/node_modules/@local/dsh-btw/lib/client.js`）

```
点 ×（glyph "×", aria-label "结束 btw"）   B/client.js:1665-1667   setConfirmEnd(true)        ← 同步 setState
  → 确认框挂载                            primitives Modal（主包 /assets/index-ClqxG24t.js 的 $u）
                                          → createPortal(..., document.body)、document keydown(Escape)
                                          → btw 自己把焦点放到「取消」  B/client.js:1544
  → 点「结束」                            B/client.js:1569-1581   setEnding(true); await onEnd()
  → onEnd                                 B/client.js:8649-8652   await presentation.end(current)
  → presentation.end                      B/client.js:2005-2009   await controller.close(); …; viewStore.clear(parent)
  → controller.close()                    B/client.js:285-317
        :289 stopPolling()                                   ← 同步
        :304 this.publish(this.closedState())                ← 同步：phase="closed" ⇒ 抽屉 visible=false
        :306 const close = this.remote.close({chatToken})    ← 异步：唯一 await 的宿主 RPC
        :317 await close
  → SideChatDrawer visible               B/client.js:2825     state.phase!=="closed" && state.parentSessionId!==undefined
                                                              && String(state.parentSessionId)===parentKey
                                                              && view.visible && view.presentation==="drawer"
  → 不可见 ⇒ B/client.js:2839 return null                      ← 整棵子树（surface/jumpList/transcript/portal）一次 commit 卸载
```

**静态结论**：X 路径是**纯 React 卸载 + 一个确认 Modal**；**没有任何退场动画**（CSS 只有入场 `SalQ5q_drawer-in .18s`，`B/client.js:935`；全产物 `will-change` **0** 处）。

### 2.2 实测时间线（`raw/close-campaign-main1.json`，D0 臂，页内钟相对该臂起点）

**稳态情形（6/6 rep 中的 5 个）**——面板"消失"很快，慢的是"确认框可见期"：

| # | 事件 | 时刻 | 段长 | 归属 / 备注 |
|---|---|---|---|---|
| ① | 点 `×`（真实鼠标坐标） | **+152** | — | `activeElement` 由 `TEXTAREA`(btw 输入框) 变 `BUTTON.SalQ5q_endButton[结束 btw]` |
| ② | **确认框进入 DOM** | **+185** | **33 ms** | portal 挂到 `BODY`；`nodes 704→719`；焦点→「取消」`._button_kz6gm_4 _outline` |
| ③ | **遮罩代价帧** | +260 / +339 / +455 | **75 / 79 / 116 ms 帧** | 全视口 `backdrop-filter: blur(2px)` 首次上屏 |
| ④ | **确认框可见期**（用户看着框、把鼠标移到「结束」） | +185 → +3806 | **3621 ms** | **19–21 条 LoAF（Σ≈2.0 s）、25–27 帧 >33 ms（24–40%）、fps 19–30** ← **卡的就是这一段** |
| ⑤ | 点「结束」（真实鼠标） | **+3800**（该时刻发出 `sideChat/close`） | — | `setEnding(true)` → `onEnd()` → `presentation.end()` |
| ⑥ | **确认框 + 抽屉同时从 DOM 移除**（一次 commit） | **+3806** | **6 ms** | mutation `BODY rem 1` + `DIV rem 1`；`waitGone` 在 **+3809** 即成立（距 RPC 发出 **+1 ms**） |
| ⑦ | 稳态下一帧起 | +3806 → | — | `nodes 704`（= 无确认框、且**抽屉已不在**为 654，见下） |
| ⑧ | `sideChat/close` 完成（**与面板无关**，只决定头部按钮） | +3808+Dur | **Dur = 18…2644 ms** | mutation `BUTTON aria-pressed/title` 在 RPC 落地后翻转 |

**间歇竞态情形（6/6 中的 1 个：腿 A 的 D0）**——用户会看到面板"弹回来"：

| # | 事件 | 时刻（臂内） | 证据 |
|---|---|---|---|
| ⑤ | 点「结束」→ `sideChat/close` 发出（**该 rep 返回值耗时 2644 ms**） | +3808 | HTTP 台账 |
| ⑥ | 抽屉 + 确认框卸载；`waitGone` 成立 | +3806 / +3809 | mutation `BODY rem 1`、`DIV rem 1`；`waitGone` 谓词为真 |
| ⑦ | **抽屉被重新挂载**（复活） | **+3838（+32 ms）** | mutation `DIV add 1`；`nodes(+3882)=704` ⇒ 抽屉 50 节点回来了；`activeElement` 于 +3957 落在 btw 输入框 `TEXTAREA[输入一个临时问题…]`（抽屉不在时不可能） |
| ⑧ | 期间 `nodes` 由 704 增至 710 | +5819 | 抽屉内部再渲染 |
| ⑨ | `sideChat/close` 落地（2644 ms） | +6452 | HTTP 台账 |
| ⑩ | `viewStore.clear()` ⇒ 头部按钮 `aria-pressed` 翻转 | +6453 | mutation |
| ⑪ | **抽屉真正卸载** | **+6469** | `nodes 710→654`（−56 = 抽屉子树） |
| ⑫ | ⇒ **点「结束」→ 界面真正消失 = 2661 ms**（≈ 该次 RPC 时长 2644 ms） | | |

> 节点数自洽校验：确认框 = 15 节点（704→719），抽屉 = 50–56 节点（719−15−50 = 654；654+50 = 704 ✓）。
> **机制未确证**：代码上 `close()` 在 `B/client.js:304` **先** publish `closedState()`（⇒ 抽屉立刻卸载），而 `viewStore.visible` 仍为 true、`viewStore.clear()` 只在 `:2008`（`await controller.close()` **之后**）执行 ⇒ 任何在关闭之后仍会 publish `open` 状态的东西（在途 `poll`/`read` 回包 `:697-708` 无 revision 去重、或 `start` 的续体——该 rep 的 `sideChat/start` 当时**仍在途中**，耗时 45 964 ms、直到 88 s 才返回）都能把它"复活"。**本线未能在运行时锁定是哪一个**（见 §六.4）。

### 2.3 ⑦「抽屉复活」的证据强度（诚实标注）

- **direct（三通道自洽）**：① `waitGone` 谓词在 **点击后 +1 ms 成立**（抽屉确实消失了）；② mutation 台账 `+3806 DIV rem 1` → **`+3838 DIV add 1`**；③ `nodes` 序列 719（确认框在）→ **704（= 抽屉在，见 §2.2 的节点数自洽校验）** → 710 → **654（−56，抽屉不在）**；④ `activeElement` 在 +3957 落在 **btw 输入框**（抽屉不在时不可能）。
- **inferred（机制）**：`close()` 在 `:304` 先 publish `closedState()` ⇒ 抽屉卸载；但 `viewStore.visible` 仍是 `true`，`viewStore.clear()` 只在 `:2008`（`await controller.close()` **之后**）执行 ⇒ 期间**任何**仍会 publish `open` 状态的东西都能把它推回来（在途 `poll`/`read` 回包 `:697-708` 无 revision 去重；或该 rep 当时**仍在途中**的 `sideChat/start`（45 964 ms）续体）。**未能锁定是哪一路** ⇒ 机制 **INCONCLUSIVE**。
- `probes/ab-close.mjs` 的**存在性逐批记录**（`MutationObserver` + 250 ms 心跳，记录 `drawer|root|dialog` 状态串的**每一次翻转**）是为把这条彻底钉死而准备的器械；`raw/ab-close-ab4.json → raw.presence` 已落盘但该批**未再触发**复活（1/6 的概率）⇒ 仍待一次运气好的复现。

### 2.4 关闭时"卸载与副作用清理"清单（哪一段是卸载、哪一段是清理）

被服务产物行号（`B/client.js`）；带 ✅ 的为本线亲自核读，其余由静态档给出并已被其独立复核（`static-close-path.md §3`）。

| 类别 | 项目 | 注册 / 清理 | 关闭时行为 |
|---|---|---|---|
| React 卸载 | 抽屉整棵子树 | `B/client.js:2839 return null` ✅ | **一次 commit 同步卸载**（surface / jumpList / 转录 / 确认框 portal 一起走） |
| 订阅 | `controller.subscribe`（整 state 快照） | `:2818` | ⚠️ **不卸载**（抽屉组件实例仍在，只是 `return null`），仍在订阅 |
| 订阅 | `viewStore.subscribe` / 尺寸 `useStore` | `:2820-2823`, `:2826-2830` | 同上，仍在订阅 |
| 定时器 | 700/220 ms 轮询 | `:289 stopPolling()` ✅（End 路径）、`:563`（park 路径） | **End/park 停**；**minimize（Esc/`—`）不停**（`:2000-2004`） |
| 观察器 | `ResizeObserver` | `:2722` 建 / `:2788` 断 | 随副作用清理 `disconnect()`（与卸载同一 commit） |
| 观察器 | `MutationObserver`（**observe `document.body` childList**） | `:2753` 建 / `:2789` 断 | 同上 |
| 观察器 | `IntersectionObserver` | 全产品 **0 处** | — |
| 监听器 | `window` Escape → minimize | `:2834` 建 / `:2836` 摘 | 本 commit 摘 ✅ |
| 监听器 | `window` resize + `visualViewport` resize/scroll | `:2781-2783` / `:2790-2792` | 同上 |
| 监听器 | 确认框 `document` keydown(Escape) | primitives `Modal`（主包 `$u`，portal 到 `body`） | 随确认框卸载一起摘 |
| 监听器 | `containEscape`（document keydown） | `:1548` / `:1550` | 确认框关闭时摘 |
| 监听器 | 全局快捷键 ⌘⇧.（`window` keydown） | `:8663` / `:8665` | **不摘**（只在插件 dispose 时），与关闭无关 |
| DOM 宿主 | 确认框 `createPortal(..., document.body)` | React 负责移除 | 实测 +3806 `BODY rem 1` ✅ |

**判定**：关闭相**没有**"退场动画"段；真正的可归因段是 ① **确认框挂载/可见（全视口遮罩上屏）**、② **一次 commit 的整块卸载 + 上述清理**、③ **`publish(closedState())` 引发的抽屉内部重渲染**（`:304`，`publish` 无 revision 去重 `:764-767`）。

---

## 三、② 为什么"关闭"比"打开"差（核心；逐候选给证据）

### 3.0 同窗对照表（同一页、同一窗口、背靠背；`>33 ms` 为主判据）

来源：`raw/close-campaign-main1.json`（腿 A）、`raw/close-campaign-blurOFF.json`（腿 B）。

| 臂 / 子段 | 时长 | 帧数 | **>33 ms** | **占比** | `>50 ms` | LoAF 条 | ΣLoAF | **fps** |
|---|---|---|---|---|---|---|---|---|
| A_IDLE（静止，无抽屉） | 6.0 s | 360 | 2 | **0.6%** | 1 | **0** | 0 | 60.0 |
| B_POS120（页内 120 ms 阳性对照） | 2.0 s | 113 | 2 | 1.8% | 2 | 1 | 50 | 56.5 |
| **C_OPEN（点 btw 入口→抽屉就绪→稳态）** | 9.0 s | 495 | **3** | **0.6%** | 2 | 2 | 822 | 54.6 |
| **D-a：点 × → 确认框可见** | 0.17–0.19 s | 10–12 | 0–1 | 0–8% | 0 | 0–1 | 0–75 | — |
| **D-b：确认框可见 → 点「结束」**（**blur 原状**） | 3.5–3.7 s | 68–113 | **25 / 27 / 27** | **24.3% / 23.9% / 39.7%** | 25 / 25 / 27 | **19 / 19 / 21** | **1997 / 1938 / 2393** | **19.4 / 28.5 / 30.3** |
| **D-b 同段（页内禁用遮罩 blur）** | 3.2–3.3 s | 149–162 | **3 / 3 / 5** | **2.0% / 1.9% / 3.1%** | 3 / 3 / 3 | **3 / 3 / 3** | 874 / 549 / 469 | **45.2 / 49.6 / 50.4** |
| D-c：面板消失 → 稳态（10 s） | 10.0–10.2 s | 549–566 | 2–7 | 0.4–1.3% | 2–5 | 2–5 | 672–1051 | 53.8–55.9 |
| **E：重开 → Escape（minimize）→ 消失** | 4–5 ms（消失本身） | ~0 | **0** | — | 0 | **0** | 0 | — |
| **A1（单页 A/B/A 第一腿，blur ON）** | 2.51 s | 10 | **9** | **90.0%** | 9 | 9 | 2299 | **4.3** |
| **B（同页第二腿，页内关 blur）** | 2.51 s | 142 | **4** | **2.8%** | 3 | 2 | 133 | **56.1** |
| **A2（同页第三腿，恢复 blur）** | 2.50 s | 104 | **21** | **20.2%** | 21 | 22 | 1246 | **42.2** |

**要点**：
1. **打开相 = 静止相 = 0.6%**；**关闭相（X）= 24–40%**；**Escape 关闭 = 0**。⇒ 差异**不是**"抽屉开着的代价"，而是**X 这条路径独有**的东西。
2. 那段独有物 = **确认框 (primitives Modal) 的全视口遮罩**，运行时读回：
   `{"cls":"_mask_15u5s_14","backdropFilter":"blur(2px)","filter":"none","bg":"rgba(0,0,0,0.24)","areaShare":1,"inset":"0px"}`（三次 rep 一致，`raw/close-campaign-main1.json → maskEvidence`）。
3. 该遮罩的 CSS（被服务主包 CSS `/assets/index-C6eRlFa6.css`）：
   `._mask_15u5s_14{position:absolute;…;background:var(--dsw-alias-bg-mask-1);-webkit-backdrop-filter:var(--dsw-mask-blur);backdrop-filter:var(--dsw-mask-blur)}`，`--dsw-mask-blur: blur(2px)`。
4. **同一构建里，设置弹窗的遮罩已被协调者修成 `backdrop-filter: none`**（w09 §三.2 复核；exec-mask F1 落地）——**而 shell `Modal` 这份没修**。w11 §L9 已把"shell Modal"明确列为**未测、未改**的 blur 消费者；本线就是把它测了。

### 3.1 H1（退场动画成本）—— **部分成立，但载体不是"退场动画"**

| 子问 | 判定 | 证据 |
|---|---|---|
| btw 是否对大面做 transition/animation 退场？ | **否** | CSS 只有 `animation: .18s SalQ5q_drawer-in`（入场，`B/client.js:935`）；**全产物无 `drawer-out`/`*-exit` 关键帧、无 `will-change`**；卸载是纯 React commit（`B/client.js:2839`） |
| btw 自身 CSS 有 `backdrop-filter` 吗？ | **仅 1 处，且关闭路径上不存在** | `.SalQ5q_lightboxMask`（`B/client.js` CSS 串，看图预览才渲染）；抽屉/`.placementRoot`/`.mobileScrim` 全部 `none`（w09 §三.2 一致） |
| 有全屏 `box-shadow`/大面积重绘吗？ | **有，但不是主因** | 抽屉 `box-shadow: -18px 12px 70px …`（438×1416 px，运行时读回 `drawerRect`）+ `.placementRoot{position:absolute;inset:0}`（整屏覆盖层）在卸载时整块摘掉 ⇒ 一次全屏重绘；但 D-c 段（消失→稳态）只有 0.4–1.3% 长帧 ⇒ **量级远小于遮罩** |
| **X 路径独有的全视口 `backdrop-filter`** | **✅ 成立（根因）** | 见 §三.0；A/B/A 差分：24–40% → 2–3% |

**判定：H1 原表述（退场动画）FAIL；H1′（确认框全视口 blur 遮罩）PASS 且被 A/B 差分证实。**

### 3.2 H2（关闭触发"整体订阅"的整树重渲染）—— **否决**

- **静态**：`w12` 的三处整体选择器 `useInput((s)=>s)` 在 `dsh-client-ui-conversation/lib/client.js:3561 / 7159 / 7403`；btw **不写 input store**，关闭也不改这些 slice。btw 自己确实有"整 state 快照"范式（`B/client.js:2818` `useSyncExternalStore(controller.subscribe, …)` + `:764-767 publish` 无 revision 去重 ⇒ `:304 publish(closedState())` + 确认框的 `setConfirmEnd/setEnding` 各触发一次整抽屉子树重渲染，消息渲染无 `useMemo`），但那是**抽屉内部**，不是对话区/侧栏。
- **运行时**：D 臂窗口内 `MutationObserver` 只有 **21 条**，且全部集中在 `BODY`/`DIV`(overlay 槽) 的 1 节点进出 + `INPUT.qDHVXG_searchInput`/`TEXTAREA.uV2eYG_input` 的 `style` 属性（见 §三.3 观测）；**没有**侧栏会话树重建的特征（`sessionRow` 计数在关闭前后不变）。
- **判定：FAIL（不是"关闭比打开差"的原因）**。局部（抽屉内）重渲染成立但量级未单测。

### 3.3 H3（关闭清掉"可见性门控" ⇒ 700 ms 轮询恢复/面板重新取数）—— **否决（且题面行号有误）**

- ⚠️ **题面更正**：`~/.dsh/profiles/node_modules/@local/dsh-usage/lib/index.js` **只有 398 行**，`:774-810` / `:983` **不存在**。真实门控在 **`@local/dsh-usage/lib/client.js`**：条件 = `IntersectionObserver` 的 `isIntersecting` + `!document.hidden`（`:861, 886-895`），轮询 `:1107-1135`，唯一门控点 `:1114`；**周期 `refreshSec` 默认 60 s**（`:860`），且**只有 timer 被门控——翻可见不会立刻取数**（`:1109-1113` 注释自陈）。
- **关闭 btw 不会让它取数**：IO 不考虑遮挡；btw 抽屉不是全视口遮罩（`.mobileScrim` 桌面 `display:none` 已实测），usage 面板可见性不变。
- **附带纠正 w09 的覆盖面**：那条 700 ms 无去重轮询在 **End 路径会停**（`B/client.js:289 stopPolling()`）、在 **park 时也停**（`:563`），但**最小化（`—`/Escape/scrim）不停**（`:2000-2004` 只动 viewStore）⇒ 该缺陷属于 **minimize 相**，**不是**用户点的 X 相。父会话若正在生成，宿主还会每 **220 ms** 被 `sideChat/read` 全量 fold 一次（`:695`、宿主侧 `transcript()` 全量 + O(n²) 拼接）。
- **判定：FAIL（对 X 关闭相不成立）**。

### 3.4 H4（关闭时并发 RPC / 投影帧爆发）—— **成立，且是关闭相专属的第二条机制**

| 观测 | 数值 | 证据 |
|---|---|---|
| `sideChat/close` 往返（6 rep） | **18 / 65 / 1044 / 1054 / 1139 / 2644 ms** | HTTP 台账（腿 A+D0/D1/D2、腿 B+D0/D1/D2） |
| 面板 DOM 移除延迟（6 rep） | **21 / 19 / 26 / 79 / 25 ms，以及 1 例 2661 ms** | `raw/*-analysis.json` 里程碑（`drawer true→false`）与 End 点击对齐；见 §二.2 |
| 关闭后被动重发 | **`sideChat/listTree`：腿 A 3 rep 中 2 次**（点结束后 **+31 / +10 ms**），耗时 **58 796 / 27 453 ms**；结果不可见（`view.jumpOpen=false`） | HTTP 台账；w09 §三.3 已证该取数多余。⚠️ 该缓存**每次 `sessions.list` 变化都会清空**（部署物 `B/client.js:553-554`），所以它也会被宿主会话列表churn 触发，**不是严格关闭相专有** |
| 关闭后是否重发 `read`/`readImage` | **0**（`stopPolling` + `phase!=="open"` 守卫） | 静态档 §4 |
| 宿主侧 `close` 的固定成本 | **整册重写 `~/.dsh/storages/session_projcache.json`（11.1 MB，`JSON.stringify(document, null, 2)` 同步）**；链路 `close→dispose→cancel→whenIdle→scope.dispose→detachSession→session/disposed→projection-cache flushSoft→storage-json putRecord→serialize` | `static-host-close.md §0/§1`（含活体 11,107,192 B / 11,129,056 B 两次取证）+ `B/index.js:1358-1393`、`dsh-agent-loop:1136-1156`、`dsh-session:1792-1804`、`dsh-session-projection-cache:219-222,159-164`、`dsh-storage-json:79,169-180,219-223` |
| 打开相是否有同等落盘点 | **没有**（只有 `session/created` + `initFor`） | 静态档 §0 |
| 打开相 `sideChat/start` 实测 | **45 964 ms**（腿 A 首开；返回前抽屉已以 `startingState` 乐观渲染） | HTTP 台账 |
| 关闭是否让侧栏整体重渲染 | **否**（两级恒等记忆化：`dsh-client-runtime:8570-8582, 9324-9367, 5423-5425`；btw 子会话被剥掉 `parentSessionId` ⇒ 列表集合不变） | 静态档 §2；运行时 mutations 无侧栏重建 |
| w07 的"投影帧爆发" | **对关闭相不成立**（驱动源是 `session/projection` 帧，close 不发） | 同上 |

- **判定：PASS（存在）**。要点：**关闭相的 RPC/落盘爆发是"宿主侧"的**——它会拖慢整机（宿主单线程，别的线已证 0.3–0.8 s 量级停顿），但**不会**让浏览器渲染进程掉帧；本线实测的面板移除延迟只有 19–79 ms（5/6）。**只有在 §二.2 的间歇竞态里，它才把"界面消失"推迟到 2.66 s。**
- **未逐次配对**：2644 ms 与"11.1 MB 整册重写"的因果未在同一批里逐次对齐（并发线也在写 projcache）。

### 3.5 H5（焦点归还 / 焦点陷阱拆除）—— **否决为性能机制；行为本身确证**

- **实测**：确认框挂载时焦点 = 「取消」按钮（btw 自己聚焦，`B/client.js:1544`）；点「结束」后 `activeElement = BODY`（+3882、+6469 两次记为 milestone）；中间 +3957 焦点落到 btw 输入框（与"复活"一致）。
- **无滚动/布局后果**：`documentElement.scrollHeight` 全程 **1440 恒定**（无页面级滚动变化）；全产物 `preventScroll`/`scrollIntoView`/`ScrollAnchor` **0 处**（静态档 §6）。
- **判定：FAIL（不是"关闭更差"的机制）；"焦点丢到 body + 无焦点恢复"PASS（已核实，属 a11y 而非性能）。**

### 3.6 H6（就是环境）—— **否决为本线差异的解释，但必须承认其绝对量级**

- **量化依据（同窗对照）**：环境对**同窗内所有臂同等施加**，因此**只有臂内差分**可归因：`A_IDLE 0.6% → C_OPEN 0.6% → D-b 24–40% → blur 关掉 2–3%`。若差异来自环境，`C_OPEN`/`A_IDLE` 会一起恶化——实测没有。
- **环境侧基线在本线器械内的形态**：静止相 6 s 只有 **0–1 个孤立 ~0.65–0.69 s 帧**（两腿各 1 例）+ `p50 16.7 ms`；这属于**软件光栅/合成器的偶发停顿**，**不构成"持续掉帧"**，且**与遮罩无关**（blur 关掉后同形态仍在）。
- **与 `w14` 的关系**：w14 定量的是**用户配置（5120×2880@DPR2）下零 DSH 代码的极简页也只有 42.4 Hz、掉帧 27.2%**（同负载 1440×900@DPR1 为 60 Hz）—— 那是**绝对上限**；本线测的是**同一窗口内的相对差分**，两者不冲突。**本线不把环境的账算到 btw 头上**：btw 打开相 = 0.6%，本来就落在环境噪声地板里，**"打开不卡"这一点成立**。
- **判定**：**FAIL（"关闭相较差"不能由环境解释）**；同时 **PASS（环境是绝对帧率的主因）**。

#### 3.6.1 扣除环境基线后的"净额外成本"（协调者口径要求的算术）

以**同窗**（同页、同窗口、同器械）的 **`A_IDLE` / `C_OPEN` 共同给出的 0.6% 作为该窗口的环境+页面地板**，再做扣减：

| 量 | 值 | 说明 |
|---|---|---|
| 环境/页面地板（`>33 ms` 帧占比） | **0.6%**（A_IDLE 2/360；C_OPEN 3/495） | 含 w14 所说的 5120×2880@DPR2 环境代价 + DSH 页面自身稳态代价 |
| **X 关闭相（确认框可见期）** | **24.3 / 23.9 / 39.7%** | 腿 A 3 rep（blur 原状） |
| **净额外成本（扣基线）** | **≈ +23.7 / +23.3 / +39.1 个百分点**（≈ **40–65 倍**于地板） | ← **这才是 btw 专属的那一份** |
| 其中由该 blur 遮罩解释的部分 | **≈ 22.3 / 22.0 / 36.6 pp（占净额 ~92–94%）** | blur 关掉后残留 2.0 / 1.9 / 3.1%（净额 +1.4 / +1.3 / +2.5 pp） |
| 帧率口径 | 地板 ~60 fps（A_IDLE p50 16.7 ms）→ 关闭相 **19.4 / 28.5 / 30.3 fps** → blur 关掉 **45.2 / 49.6 / 50.4 fps** | 净损失约 **30–41 fps**，其中 blur 占 **26–36 fps** |

**读法**：**环境基线扣完之后，关闭相仍有 40–65 倍于地板的额外掉帧，且 ~9 成以上归因于那颗 X 独有的全视口 blur 遮罩**；因此**不是**"环境而已"。反过来也成立：**打开相 0.6% = 地板**，说明"btw 本体在环境里不产生可测的额外成本"——这两条同时成立，才是本线想给出的图景。（口径限制：0.6% 是**本线器械**的地板，绝对值不可搬到 Gecko/用户机器；可搬的是**同窗差分与占比**。）
- **对任务书指定分支的回答**：任务书要求"若 H6 成立，请明确写『没有 btw 专属可修项』"——**H6 不成立，本线不写这句话**。本线给出的是**一个可量化、可 A/B 复现、可秒回滚的 UI 专属可修项（F1，见 §四）**；同时**明确承认**：用户整体感知的帧率天花板**主因确实是环境**（Firefox 强制 a11y ×1.86 / 核显 + 150% 缩放 / 5120×2880@DPR2，见 incident2 与 w14），本线的修复只消掉"关闭那一下**额外**的 8–12 倍劣化"。

### 3.7 为什么 blur 遮罩是"持续"而非"一次性"变慢（本线新增机制片段，登记备查）

关闭窗内 `MutationObserver` 反复记录到 **`INPUT.qDHVXG_searchInput` 与 `TEXTAREA.uV2eYG_input` 的 `style` 属性每 ~1.2 s 被写一次**（+3811、+4993、…；E 臂同样出现）。这类周期性样式失效会**持续产生重绘**，与全视口 `backdrop-filter` 叠加时会**每帧重算全屏背景**。

**确认框可见时刻的运行中动画（`document.getAnimations()`，三次 leg 一致，`raw/ab-close-ab4.json → legs[].reps[].atModal.animate`）**：

```
["?@DIV.SalQ5q_composer" ×5,  "_dsh-state-dot-chase_10orb_1@rect.<SVGAnimate>" ×3, …]
```

- `_dsh-state-dot-chase_10orb_1` 是**无限循环的 SVG 动画**（状态点追逐），⇒ **页面持续产出帧**；`DIV.SalQ5q_composer` 上是 CSS transition（`border-color/box-shadow .12s`）。
- ⇒ 机制形状：**持续帧产出（动画） × 每帧全屏 backdrop 重算（blur）= 持续性掉帧**，而不是"挂载那一下的一次性成本"。这也解释了为什么 `D-A`（点 × → 确认框出现的 0.17–0.19 s）看起来干净，而**确认框可见的那 3.5 s 才是重灾区**。
- **反证**：把 blur 关掉后，**同样的动画仍在跑**（三次 leg 的 `anims` 完全相同），但帧率恢复到 45–50 fps ⇒ 掉帧**归因于 blur，不归因于动画本身**。
- ⚠️ "每 1.2 s 写 input `style`"的**写者与意图未定性**，登记给 w24/w25 线；本线只用它解释"持续"而非一次性。
- 另：确认框可见期并非**平滑**变慢：`+260/+339/+455` 先出现 75/79/116 ms 帧，随后自 `+1714` 起变为**近乎每帧 60–99 ms** 的持续状态（D0 明细见 `raw/close-campaign-main1-analysis.json → segments[].frames.over33Events`）。

---

## 四、③ 最小修复候选（含量化验收 / 回滚 / 热冷面）

### F1（首选·根因）去掉 shell `Modal` 遮罩的全视口 `backdrop-filter`

- **改动**：被服务 CSS `/assets/index-C6eRlFa6.css` 中 `._mask_15u5s_14{…;backdrop-filter:var(--dsw-mask-blur)}` → 删除该声明（保留 `background: var(--dsw-alias-bg-mask-1)` 的 rgba 变暗）。**与 exec-mask F1 对设置遮罩所做的完全同形**。
- **落地目标（已逐字节确证）**：
  `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-C6eRlFa6.css`
  md5 `30df0035bd34403a2e87f603b54e964c`、35,770 B（与 `curl http://127.0.0.1:3080/assets/index-C6eRlFa6.css` **逐字节相同**；`dsh/dsh-btw/node_modules/@deepseek-ai/dsh-web-frontend/…` 是同一份拷贝）。
  ⚠️ 这是 **shell 的构建产物（单行 CSS，1 行 35,770 字节）**，**不是插件 CSS**；目标规则在 **字节偏移 10 027** 起：
  `_mask_15u5s_14{position:absolute;top:0;right:0;bottom:0;left:0;background:var(--dsw-alias-bg-mask-1);-webkit-backdrop-filter:var(--dsw-mask-blur);backdrop-filter:var(--dsw-mask-blur)}`
  ⇒ **正确锚点是规则内那两条 `backdrop-filter` 声明（含 `-webkit-` 前缀）**，删掉后规则其余部分保持原样。
- **热/冷面**：响应头**无 `Cache-Control`/`ETag`**（实测）⇒ 正常刷新应能取到新字节；**但"改文件后是否立即生效"本线未实测**（只读授权内不能写该文件），交付时请按 exec-mask 的方法做一次 sha 核对 + 刷新验证。
- **收益（页内 A/B/A 实测，同窗同器械）**：确认框可见段 **>33 ms 帧占比 24.3/23.9/39.7% → 2.0/1.9/3.1%**；**fps 19.4/28.5/30.3 → 45.2/49.6/50.4**；LoAF 条目 **19/19/21 → 3/3/3**。
- **风险**：视觉上丢失"面板外 2 px 模糊"。参照 exec-mask §6 的同类量化：遮罩本身是 24–48% 不透明度纯色，2 px 模糊在其下**几乎不可辨**；且**观感变化面**= 所有使用 primitives Modal 的弹窗（不止 btw）。**这是唯一需要协调者裁决的点**。
- **验收标准（可执行）**：
  1. **主判据**：同一页内 A/B → 确认框可见段 `>33 ms` 帧占比 **≤3%**、`ΣLoAF ≤ 900 ms`（对照 1900–2400 ms）；
  2. **辅助**：CDP trace `RunTask` **最大值不高于**同窗静止相基线；
  3. **回归**：设置弹窗、btw 确认框、其它 primitives Modal 的**功能与层级**不变（`role=dialog`/`aria-modal`/Esc 关闭/点击遮罩关闭）；
  4. **观感**：A/B 截图像素差仅落在遮罩覆盖区且 ≤ 阈值（沿用 exec-mask §6 口径）。
- **回滚**：还原该 CSS 的原始字节（md5 `30df0035…`、35,770 B；**必须从当前 live 取 pre-image**）。

### F2（低风险·纯客户端）消除"面板复活"竞态

- **问题（间歇 1/6）**：`controller.close()` 在 `B/client.js:304` 已 publish `closedState()`（抽屉立刻卸载），但 `viewStore.visible` 仍为 true，且 `viewStore.clear()` 只在 `:2008`（`await controller.close()` **之后**）执行 ⇒ 期间任何仍会 publish `open` 状态的东西都能把抽屉"复活"（实测 D0：**+3806 卸载 → +3838 复活 → +6453 才最终消失，共 2661 ms**）。
- **改动形状（二选一）**：① `presentation.end()` 里把 `viewStore.clear()` **提前**到 `await controller.close()` 之前；② 在 `close()` 里置 `closing` 闸门，让后续 `poll`/`read`/`start` 的续体在 `closing` 期间**不得**把 `phase` 推回 `open`（`:697-708` 加守卫）。
- **验收**：点「结束」后 **≤1 帧**内 `[data-dsh-btw-root]` 消失，且在随后 30 s 内**不再出现**（`probes/ab-close.mjs` 的存在性记录直接给判据：0 次 `false→true` 翻转）；头部按钮 `aria-pressed` 仍可在 RPC 落地后翻转（功能不回退）。
- **风险**：低（纯客户端状态时序）；回滚 = 还原该两行。**热面**。
- **诚实预期**：**它不解决"确认框可见期掉帧"**（那是 F1），只消除"偶发地把界面消失推到秒级"。**不要把它当成主修**。

### F3（低风险）跳转列表取数懒加载（顺带消掉关闭后的 `listTree`）

- `SideChatJumpList` 的取数 effect 加 `if (!view.jumpOpen) return`；`view.jumpOpen` 默认 `false`（w09 §5.4 候选 D 的原文形状）。
- **本线新增证据**：点「结束」后 **54 ms** 仍会发一条 `sideChat/listTree`，**耗时 58.8 s**、结果不可见。
- **验收**：关闭窗口内 `sideChat/listTree` 出现次数 **= 0**（页内 fetch/WS 台账）；展开跳转列表后照常发出。
- **回滚**：还原该两行。**热面**。

### F4（宿主侧·跨线，非本线交付）投影缓存整册重写

- `session_projcache.json` 已 **11.1 MB** 且每次 detach 无条件整册 `JSON.stringify(…, null, 2)`（同步）⇒ 建议按 w03/协调者口径立项（增量写 / 去孤儿 / 异步化）；**本线不认领**。

### F5（不需要做）

- "新建会话"类规避、焦点恢复、Escape 行为：**与本次关闭相卡顿无关**（§3.5、§二）。
- 把 `mobileScrim` 之类遮罩当嫌疑：**桌面 `display:none`**，已排除。

---

## 五、判据清单（PASS / FAIL / INCONCLUSIVE）

| 判据 | 结果 | 证据 |
|---|---|---|
| X 的身份（End vs minimize） | **PASS** | §1.2 运行时读回 + `B/client.js:1665-1667` |
| 关闭相时间线逐段时长 + file:line | **PASS** | §二（稳态 8 段 + 间歇竞态 8 段，含 RPC 与卸载时刻） |
| 关闭相是否存在长帧 | **PASS（存在，24–40%）** | §3.0 |
| 关闭相 vs 打开相 vs 静止相（同窗） | **PASS** | §3.0：0.6% / 0.6% / 24–40% |
| H1 退场动画 | **FAIL（无退场动画）**；**H1′ 全视口 blur 遮罩 = PASS（根因）** | §3.1 |
| H2 整体订阅整树重渲染 | **FAIL（否决）** | §3.2 |
| H3 可见性门控/轮询恢复 | **FAIL（否决；题面行号不存在）** | §3.3 |
| H4 关闭相并发 RPC/落盘爆发 | **PASS（成立：close 18–2644 ms、listTree 27.5–58.8 s、projcache 11.1 MB 整册重写）；但主要在宿主侧，不解释掉帧** | §3.4 |
| H5 焦点归还/陷阱拆除 | **FAIL（性能机制）** / 行为属实 | §3.5 |
| H6 环境 | **FAIL（不能解释"关闭较打开更差"）**；环境仍是绝对帧率主因 | §3.6 |
| 阳性对照（页内 120 ms） | **PASS** | `poscontrol-120` 页内 120.0 ms；LoAF 50 ms、帧 123 ms |
| 阴性对照（静止） | **PASS** | `A_IDLE` 0 LoAF、p50 16.7 ms、0.6% |
| A/B 因果（blur 有 vs 无） | **PASS** | 腿 A 3 rep 24–40% vs 腿 B 3 rep 2–3%（§三.0 表） |
| A/B/A 第三腿（blur 恢复） | 见 §七（`raw/ab-close-ab5.json`；`main2` 因 `session.list` 未返回而 ABORT） | §七 |
| `RunTask`（协议主判据）独立复核 | **PASS（方向一致）** | §七：blur 开 ⇒ `RunTask>8ms` Σ 2182–4426 ms / 34–49 条；blur 关 ⇒ Σ 1218 ms / 13 条 |
| 最小修复候选（含收益/风险/验收/回滚） | **PASS（F1/F2/F3）** | §四 |
| **在用户真实引擎（Gecko）复核** | **INCONCLUSIVE（未做）** | §六.1 |
| 用户所感"卡"到底指"掉帧"还是"面板关不掉" | **INCONCLUSIVE** | §六.1 |
| 改动了产品文件？ | **无（只读）** | 全量写盘仅在 `program/w28-btw-close/` |

---

## 六、未能量化 / 未覆盖（必须随结论一起读）

1. **用户真实环境 = Firefox（Gecko）**。Gecko **无 LongTask/LoAF 通道**（协议 §五.9 实测：同页 200 ms 阻塞 Blink 报 2/3 条，Gecko 报 0/0），**Firefox 155 已移除 CDP**（§五.11）⇒ Gecko 侧只能用 wall-clock rAF + 播种，且 `>50 ms` 会假阴性。本线**没有**跑有头 Gecko（时间预算给了 Blink 的真实路径复现与 A/B），因此**"用户机器上是否同样掉帧"未复核**：本线只证明 **Blink 同窗差分**，方向与 exec-mask 在设置遮罩上的独立结论一致。
2. **headless 软件光栅会放大 `backdrop-filter` 成本**：因此 **24–40% / fps 19–30 是量级上界**，不可直接搬成"用户机器也掉这么多"；可搬的是 **有/无 blur 的差分方向与比例**。
3. **`sideChat/close` 2644 ms ⇄ projcache 整册重写的逐次配对未做**（并发线同时在写 projcache）⇒ 只作"存在性 + 单次实测"。
4. **抽屉"复活"（+3806 卸载 → +3838 重挂）**：mutation / 节点数算术 / `waitGone` 三条直接证据自洽，但**只在 6 rep 中出现 1 次**（腿 A 的 D0）；**是哪一路在关闭后仍 publish `open` 状态（在途 `poll`/`read` 续体、还是当时仍在途的 `sideChat/start` 续体）未能在运行时锁定** ⇒ **机制 INCONCLUSIVE**。`probes/ab-close.mjs` 的存在性逐批记录（`MutationObserver` + 250 ms 心跳，记录 `drawer|root|dialog` 状态串的每一次翻转）是为此准备的复核器械（`raw/ab-close-ab4.json → raw.presence`，该批未触发复活，故仍未复核成功）。
5. **`whenIdle()` 的无界等待未测**（需要子会话正在生成时点结束；本线为安全起见，`running=true` 时**不点结束**）。
6. **minimize 后不停轮询**（`:2000-2004`）为静态结论，**未单独实测**（本线的 E 臂只测"消失本身"，未测其后 700 ms 的宿主负载）。
7. **`session.list` 抖动导致两次启动尝试作废**：`raw/close-campaign-main2.json` 记 `NO_SESSION_ROWS`（300 s 内未返回）；本机实测 6.5 s / 18.3 s / >90 s / >300 s。所有窗口按 **CONTENDED** 标注（锁被 `w27-scale150` 持有）。
8. **所有臂都跑在同一条旧会话**（`/grill-me # 交接提示词 v5`，1 天前）：**转录长度固定的影响未扫**（`SideChatDrawer/Surface` 无 memo ⇒ 卸载/重渲染成本随消息数线性，本线未做长度剂量曲线）。
9. 额外观测（§3.7）中"每 ~1.2 s 写 input `style`"的**写者与意图未定性**。
10. `RunTask` 的**分段**归因未完成：第一版 trace 采集漏了 `TimeStamp` 事件（`performance.mark` 在 trace 里的载体是 `TimeStamp` + `args.data.name`），因此 §7.2 的 `RunTask` 只能给**整窗聚合**，不能按"确认框可见段/消失段"切分；补测（`ab5`，已修好 `TimeStamp` 采集）在 session 列表抖动窗口内**启动即 FATAL**——`raw/ab-close-ab5.json` 记 `FATAL:TimeoutError: page.waitForFunction: Timeout 600000ms exceeded.`（**等待会话行 600 s 超时**，与 `main2` 的 `NO_SESSION_ROWS` 同源）⇒ 该段为 **INCONCLUSIVE（器械未对齐）**；若要落地 F1 的逐段验收，请按 §九 的命令重跑 `ab-close --trace` 并确认 `trace.marks` 非空。
11. **`session.list` 是本轮最主要的外部不确定源**：实测 6.5 s / 12.1 s / 18.3 s / >90 s / >300 s，并有"先返回 4 行、随后变 0 行"的抖动（`raw/ab3.stdout` 第 314 s 记 `rows: {"n":0}`）⇒ 三次启动尝试作废（`raw/close-campaign-main2.json` 记 `NO_SESSION_ROWS`）。**这不是本线的结论对象**（兄弟线正在处理），但它限定了本线每个窗口的可用性。

---

## 七、A/B/A 单页长驻复核 + `RunTask` 轨迹（协议主判据的独立复核）

### 7.1 A/B/A（同一页、同一窗口；`raw/ab-close-ab4.json`，每腿 1 rep、腿间只切页内 CSS 开关）

| 腿 | 遮罩 `backdrop-filter`（运行时读回） | 确认框可见段：帧数 | p50 | max | **>33 ms** | **占比** | fps | LoAF 条 / Σ |
|---|---|---|---|---|---|---|---|---|
| **A1 blur ON** | `blur(2px)` | 10 | **240 ms** | 447.8 | 9 | **90.0%** | **4.3** | 9 / 2299 ms |
| **B blur OFF**（页内禁用） | `none` | 142 | 16.7 | 79.4 | 4 | **2.8%** | **56.1** | 2 / 133 ms |
| **A2 blur ON**（恢复） | `blur(2px)` | 104 | 16.7 | 67.9 | 21 | **20.2%** | **42.2** | 22 / 1246 ms |

- **A/B/A 复原成立**：两条"A"腿（90.0% / 20.2%）都远差于中间的"B"腿（2.8%）；`fps 4.3 / 42.2` vs `56.1`。
- `maskBlur` 每次 rep 都从运行时读回（`blur(2px)` / `none`）⇒ **开关确实生效**，不是"以为关了"。
- 该腿的靶会话与前两腿不同（ab4 的匹配串未命中，退化为"取最旧一行" = 另一条线的会话 `热刷新后 dsh 会话加载缓慢`）⇒ **说明该缺陷与具体会话内容无关**（A1 甚至更重：4.3 fps）。

### 7.2 `RunTask`（CDP trace，类别**必须**含 `disabled-by-default-devtools.timeline`）

同一批 trace 窗口 = 点 × 前 0.8 s → 确认框 → 停留 2.5 s → 点「结束」→ 面板消失（`raw/ab-close-ab4.json → legs[].reps[].trace`）：

| 腿 | `RunTask` 总数 | **`RunTask` > 8 ms：条数 / Σ / max** | `FireAnimationFrame` | `UpdateLayoutTree` | `Layout` |
|---|---|---|---|---|---|
| A1 blur ON | 4932 | **49 / 4426 ms / 246.1 ms** | 513 | 271 | 7 |
| B blur OFF | 5581 | **13 / 1218 ms / 72.7 ms** | 798 | 412 | 6 |
| A2 blur ON | 5887 | **34 / 2182 ms / 63.5 ms** | 713 | 372 | 7 |

- **`RunTask` 通道独立复现同一方向**：blur 开时"长任务时间"为 blur 关的 **1.8–3.6×**（Σ 2182/4426 vs 1218 ms；条数 34/49 vs 13）。
- ⚠️ **不敢用 `RunTask` 的 `max` 做判据**：245.1 ms 只出现在 A1，两条 blur-ON 腿的 max 分别是 246.1 / 63.5 ms ⇒ **max 被环境偶发停顿污染**（与本线 `A_IDLE` 的 0.65–0.69 s 孤立帧同源）。**主判据用条数与 Σ，不用 max。**
- ⚠️ **本批 trace 未能按 mark 切段**（`performance.mark` 在 trace 里是 `TimeStamp` 事件、名字在 `args.data.name`，第一版过滤没取到，见 §六.10）。补测（`probes/ab-close.mjs --stamp ab5 --trace`，已修好 `TimeStamp` 采集）**在等待会话行时 600 s 超时 FATAL**（`raw/ab-close-ab5.json`），**未产出轨迹**；因此**`RunTask` 只有整窗聚合、没有分段归因**，这一项判 **INCONCLUSIVE（器械未对齐）**，不得当作"确认框可见段 = 2.2 s 长任务"的证据。
- 阴性对照（同批）：静止窗口 `RunTask` 无 >8 ms 条目（见 §3.0 的 `A_IDLE`：0 LoAF、p50 16.7 ms）。阳性对照：页内 120 ms 忙循环被 LoAF（50 ms）与帧间隔（123 ms）同时抓到。

### 7.3 "面板复活"的复核结论

- 6 rep 的 End 点击 → 面板消失延迟：**21 / 19 / 26 / 79 / 25 ms（5 个）+ 2661 ms（1 个）**。
- 2661 ms 那一 rep 的三条证据（§二.2）：`waitGone` 在 +1 ms 成立（消失）→ `DIV add 1`（+32 ms 复活）→ `nodes(+3882)=704`（抽屉在）→ `DIV rem 1`（+6453）与 `nodes 710→654`（+6469，最终消失），且与 `sideChat/close` 的 2644 ms 同量级。
- **判定**：**"消失"是即时的（5/6）；"复活"是间歇的（1/6），机制 INCONCLUSIVE**（§六.4）。

---

## 九、给协调者的裁决点与复现方式

**需要裁决的只有一件事**：**F1 的观感交换**——去掉 shell `Modal` 遮罩的 `backdrop-filter` 会失去"弹窗外 2 px 模糊"，代价面是**所有**使用 primitives Modal 的弹窗（设置弹窗已是同款改法，见 exec-mask F1）。除此之外 F1 是"零语义变更 + 热面 + 秒回滚"。

**复现（任何人可重跑，全程只读）**：

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/program/w28-btw-close
# 腿 A（遮罩原状，3 rep）—— 真实点击 X→确认→结束
node probes/close-campaign.mjs --stamp repro-A --reps 3 --boot-wait 600000 --session-match "交接提示词 v5"
# 腿 B（同器械、页内禁用遮罩 blur；**不改产品文件**）
node probes/close-campaign.mjs --stamp repro-B --reps 3 --boot-wait 600000 --session-match "交接提示词 v5" --css-off blur
# A/B/A 单页长驻 + RunTask 轨迹
node probes/ab-close.mjs --stamp repro-AB --reps 1 --trace
node tools/analyze.mjs raw/close-campaign-repro-A.json --md
```

**判据**（与本文一致）：确认框可见段 `>33 ms` 帧占比（腿 A 期望 ≥20%，腿 B 期望 ≤3%），并**必须**同批做页内 120 ms 阳性对照与静止阴性对照。**注意**：`session.list` 可能耗时数分钟或长时间不返回（本线实测 6.5 s–>300 s），`--boot-wait` 请给足；锁被兄弟线持有时窗口标注 `CONTENDED`。

---

## 八、交付物

| 文件 | 内容 |
|---|---|
| `audit.md` | 本文 |
| `static-close-path.md` | 客户端关闭相静态审计（516 行，二级子代理，独立复核 md5 与 curl 字节） |
| `static-host-close.md` | 宿主侧关闭相静态审计（555 行，二级子代理；含 11.1 MB 整册重写的活体取证） |
| `probes/init-probe.js` | 页内主仪器（rAF 双时钟/LoAF/LongTask/强制布局/RPC/里程碑/存在性/animations/阳性对照） |
| `probes/close-campaign.mjs` | 真实路径战役（IDLE/POS/OPEN/CLOSE-X×3/CLOSE-ESC×3，含 `--css-off blur` A/B 开关） |
| `probes/ab-close.mjs` | 单页长驻 A/B/A + `RunTask` 轨迹（探针 `performance.mark` 对齐 trace；含元素存在性逐批记录） |
| `probes/recon.mjs`…`recon6.mjs`、`ws-ledger.mjs`、`http-ledger.mjs`、`boot-ledger.mjs`、`open-recon.mjs`、`trace-close.mjs` | 侦察链（含口径修正：**本构建 unary RPC 走 `fetch`、WebSocket 仅下行**，所以"包装 WebSocket.send"抓不到 RPC——`ws-ledger` 的 SENT=0 就是这个原因） |
| `tools/analyze.mjs` | 分段统计器（帧/LoAF/强制布局/mutation/RPC 逐段） |
| `raw/close-campaign-main1.json`（4.0 MB） | **腿 A** 全量原始（帧、LoAF、强制布局、mutation、里程碑、状态、RPC） |
| `raw/close-campaign-blurOFF.json` | **腿 B**（页内禁用遮罩 blur）全量原始 |
| `raw/close-campaign-smoke1.json` / `main2.json` | 早期 smoke / 因 `session.list` 未返回而 ABORT 的腿（**保留，不挑窗口**） |
| `raw/ab-close-ab4.json` | **A/B/A 单页长驻 + 三条 trace 的 `RunTask`**（§七 的数据源） |
| `raw/ab-close-ab{1,2,3,5}.json`、`raw/*.stdout` | 失败/作废尝试的原样留存（含 `NO_SESSION_ROWS`、`rows:0`、trace JSON 解析失败与 `picked -1`），供审计"不挑最佳窗口" |
| `raw/*-analysis.json` | 分段统计产物 |
| `raw/btw-index-before.json` | `~/.dsh/btw/index.json` 副作用前快照（申报副作用用） |
| `shots/*.png` | 就绪/打开/确认框/已关闭 各态截图（`main1-rep*-02-confirm.png` = 用户看到的那个确认框 + 全屏遮罩 + 右侧 btw 抽屉） |
