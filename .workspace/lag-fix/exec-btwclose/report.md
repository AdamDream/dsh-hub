# exec-btwclose · 修订执行复核一体档报告

> 上游契约：`.workspace/lag-fix/program/w28-btw-close/audit.md`（F1–F4）+ `static-close-path.md` + `static-host-close.md`
> 机制依据：`.workspace/lag-fix/program/w11-mask-look/audit.md` §3（**模糊的代价不是持续的，是逐次重绘付的**；弹窗静态停留时 `blur(2px)` 实测 = 0）
> 本档独占目录：`.workspace/lag-fix/exec-btwclose/`；宿主 `dsh web` PID **301709**（全程**未重启、未发信号、未 pkill 用户浏览器**）
> 时间：2026-09-22 16:42 → 18:2x（本地）
> **本档未写任何工作区外文件**（部署写入按纪律由协调者执行；见 §7、§12）

---

## 0. 结论速览（逐单元 + 自裁决）

| 单元 | 内容 | 落地状态 | 实测裁决 | 证据 |
|---|---|---|---|---|
| **U1 = P1（首选·保观感）** | 确认框可见期冻结 StateDot 追灯动画（`dsh-state-dot-chase`），**`blur(2px)` 原样保留** | 源码补丁已就绪（`patches/apply-BtwClose-v1.mjs --units U1`），待协调者重建 + 部署 | **PASS（三判据达标）** | §2：`>33ms` **74.8% → 2.8%**、fps **18.8–20.1 → 56.4–56.8**、ΣLoAF **7185 → 614 ms**、`RunTask>8ms` **61–68 条 → 18–19 条**（同窗 blurOFF = 14–20 条）；观感像素差 **mean 0.0018/255**（低于同条件重复噪声 140 倍） |
| **U2 = P2（删掉遮罩 blur）** | shell CSS 删除 `._mask_15u5s_14` 的两条 `backdrop-filter` | **未落地（按契约：P1 达标即不做；且按用户新约束"保观感优先"，只能作紧急兜底，不得作为常规交付）** | 不适用；**量化代价已测**：掩码区 **21.57% 像素 >2/255**、mean 5.05/255，是同条件重复噪声的 **21 倍** | §4 |
| **U5 = P1b（备用载体）** | 只在 shell CSS 追加 `:has()` 规则做同一件事（与 U1 互斥） | 未落地（备用；见 §3.3 载体权衡：btw 包是 `no-cache`，shell CSS 无 cache 头） | 与 U1 同机制、未单测 | §3.3 |
| **U3 = P3（必做）** | `presentation.end()` 先 `viewStore.clear()` 再 `await controller.close()` | 源码补丁已就绪（`--units U3`） | **落地 PASS（结构充分性已证）**；**竞态本档 0/20 rep 未复现**（前验基线未取到，如实标注） | §5 |
| **U4 = P4（必做）** | `SideChatJumpList` 取数 effect 加 `if (!view.jumpOpen) return` | 源码补丁已就绪（`--units U4`） | **缺陷已带量复现**（13 次不可见取数、单次最长 **22 237 ms**）；后验需部署 | §6 |

**一句话**：用户点 X → 确认框那颗**全视口 `backdrop-filter: blur(2px)` 遮罩**之所以把页面拖到 19 fps，是因为**每帧都有一次"遮罩背后重绘"**（页面上有 16 个 StateDot 格子跑着 `animation: dsh-state-dot-chase 1s infinite`）；**把那个动画在确认框可见期冻结、模糊一点不动**，确认框可见期就从 **74.8% 帧 >33 ms（19 fps）** 回到 **2.8%（56.6 fps）**，而且**观感与冻结前逐像素不可辨**（§2.4）。这正是"保观感"路线，P1 达标 ⇒ 不需要删模糊。

---

## 1. 被测物身份、外部变更与本轮窗口

| 件 | md5 | 字节 | 说明 |
|---|---|---|---|
| **被服务 btw 产物（p1a/p1c 测量时）** | `73e90a5cb2f292e7853a440bea3a84de` | 335 348 | 与 w28 审计同一身份（本档开工时再次 `curl` 逐字节复核一致） |
| **被服务 btw 产物（16:55:55 起，**现已变更**）** | `6b3245b994574bde79e82cbac87324a7` | 335 993 | ⚠️ **兄弟 resize 线在本档途中重建并部署了新包**（`~/.dsh/profiles/.../dsh-btw/lib/client.js` mtime 16:55:55；仓库 `dsh-btw/lib/client.js` 17:15:06 又更新为 `bdc5c240…`/361 651 B） |
| shell 主包 CSS（P2 落点） | `30df0035bd34403a2e87f603b54e964c` | 35 770 | **全程未变**（18:0x 复核一致），规则 `._mask_15u5s_14` 0-based 字节偏移 **10 026**（审计记 10 027 为 1-based）、整条规则全文件唯一 1 次 |
| shell 主包 JS（primitives 内联） | — | — | `index-ClqxG24t.js`；`Modal` = `$u`、`StateDot` = `Pu`（见 `static/statedot-render-path.md`，含字节偏移） |
| 锁 | — | — | `.workspace/lag-fix/research-v2/.probe.lock` 由 **`exec-a11y`**（pid 1359413/1325910，liveness ALIVE）持有 ⇒ 本档 `acquire` 返回 **BUSY**，全部窗口按 **CONTENDED** 标注、**只做同窗差分**（`raw/lock-p1a.json`） |

**⚠️ 换包对本档结论的影响（必须随结论一起读）**
1. p1a（16:46–16:49）与 p1c（16:55–16:59）的**页面在各自 boot 时抓取插件字节**；16:55:55 的新包**未进入任何一次测量**（p1c 于 16:55:0x 启动并已完成插件拉取）。
2. 换包**不改变本档任何结论**：缺陷的**两个机制件都不在 btw 包里**——遮罩 `._mask_15u5s_14`（shell 主包 CSS，全程未变）与追灯动画 `_dsh-state-dot-chase`（shell 主包 CSS/JS，全程未变）。
3. 新包（`6b3245b9`）**已复核仍不带本档三个修复**：`freezeStateDotChase` 命中 0；`if (!view.jumpOpen) return` 命中 0；`end()` 仍在 **B:2005** 且顺序未变（`await controller.close()` → `closeTab` → `viewStore.clear`）；抽屉可见性谓词逐字未变（§5.1）。⇒ **U1/U3/U4 仍是当前线上包所缺的修复。**

**窗口有效性四道门禁**（纪律 §4）

| 门禁 | p1a | p1b（作废） | p1c |
|---|---|---|---|
| 周期心跳（GUI HTTP） | 200 / 0.22 s | 200 | 200 |
| 浏览器 pid 存活 | 301709 存活（未重启） | 同 | 同 |
| 流量（boot + 真跑） | `session.list` 3.0 s → 4 行 | 3.2 s → **438.6 s 时 `rows:0`** | 3.2 s → 有行 |
| **链底座存在** | ✔ 4 行会话 | ✘ **`rows:0` ⇒ 该窗口作废（产物保留 `raw/p1b-invalid.stdout`）** | ✔ |

并发普查：本档每次开窗都有 **1 个**兄弟线 headless 浏览器（`exec-a11y`，`--remote-debugging-pipe`）同时在场 ⇒ 与本档**同窗同承**，故只引用臂内差分。

---

## 2. U1 = P1：实测验收（主判据三件套 + 观感量化）

### 2.1 方案（与"在页内做消融"逐字同形）

确认框可见期，用 WAAPI 暂停**所有** `animationName` 匹配 `/dsh-state-dot-chase/` 的 CSSAnimation（`a.pause()`），确认框卸载时 `a.play()` 原相位恢复；**不动 `backdrop-filter`**。之所以按 `animationName` 匹配：它**不含 CSS-Modules 哈希后缀依赖**（`_dsh-state-dot-chase_10orb_1` 变 hash 仍匹配），且**只碰这一颗装饰性动画**——spinner（`.spinner_1ionb_47`，也是 infinite）与模态自身的 transition 都不受影响。

### 2.2 同窗 A/B/C/A（一次 boot、同一页、背靠背、腿间只切"页内消融开关"、**不改产品文件**）

**run1 = `raw/p1-ablate-p1a.json`（dwell 2.5 s，3 rep/腿，无 CDP trace）**

| 腿 | 遮罩 blur | 消融 | 帧数 | **>33 ms** | **占比** | fps（逐 rep） | LoAF 条/Σ |
|---|---|---|---|---|---|---|---|
| `A1_shipped` | `blur(2px)` | 无 | 143 | 107 | **74.8 %** | 18.78 / 19.13 / 20.14 | 109 / 7185 ms |
| `B_blurOFF` | `none` | 无（禁用遮罩 blur，**不改产品文件**） | 451 | 1 | **0.2 %** | 60.01 / 59.73 / 60.01 | 0 / 0 |
| **`C_p1_dotpause`** | **`blur(2px)`** | **冻结追灯动画** | 427 | 12 | **2.8 %** | **56.83 / 56.43 / 56.45** | 10 / **614 ms** |
| `A2_shipped` | `blur(2px)` | 无（回召） | 149 | 106 | **71.1 %** | 25.92 / 16.37 / 18.23 | 105 / 6860 ms |

逐 rep 明细：C 腿 3/3 rep 都是 **4/14x 帧 = 2.8%**（**不是一次好运**）；A1 70.2–78.3%、A2 60.9–85.0%。**A/B/A 回召成立**（74.8 → 0.2 → 2.8 → 71.1）。

**同批对照（纪律要求）**：`IDLE`（静止、无抽屉）**360 帧 / 0 帧 >33 ms / 60 fps / LoAF 1 条 129 ms**；`POS120`（页内 `setTimeout` 120 ms 忙循环）**122 帧 / 1 帧 >33 ms（0.8%）/ 单帧 133.3 ms / 57.2 fps** ⇒ **通道灵敏、地板干净**。

**消融开关生效自证**（每 rep 运行时读回）：C 腿 `p1 = {running:5, matchRunning:0, matchPaused:16}`；`maskBlur = "blur(2px)"`（**模糊仍在**）；`freezeInfo={first:16, held:16}`（**首扫就冻住全部 16 个**）；停留结束时 `matchRunning:0 / matchPaused:16`（**冻结全程保持**）；`thaw={thawed:16}`（**干净恢复**）。⇒ 5/5 rep 如此，**不是"以为冻了"**。

**run2 = `raw/p1-ablate-p1c.json`（dwell 2.5 s，2 rep/腿，**带 CDP trace**：`disabled-by-default-devtools.timeline` 等）**

| 腿 | **>33 ms** | fps | ΣLoAF | **`RunTask` >8 ms 条数 / Σ** |
|---|---|---|---|---|
| `A1_shipped` | 47.3 / 49.1 % | 25.0 / 24.0 | 5138 ms | **64 / 66 条；4021 / 4365 ms** |
| `B_blurOFF` | 3.2 / 3.1 % | 48.9 / 49.4 | 1495 ms | **14 / 20 条；1044 / 1273 ms** |
| **`C_p1_dotpause`** | **3.6 / 3.6 %** | **52.2 / 49.8** | 1430 ms | **18 / 19 条；1788 / 2039 ms** |
| `A2_shipped` | 46.5 / 54.9 % | 23.6 / 20.7 | 6753 ms | **61 / 68 条；3948 / 4686 ms** |

### 2.3 判据裁决（逐条）

| 契约判据 | 实测 | 裁决 |
|---|---|---|
| ① 确认框可见期 `>33 ms` 帧占比 **≤3%** | **p1a（协议口径、无 trace）：2.8%**（3/3 rep）；**p1c（带 trace）：3.6%**，同窗 `blurOFF` 参照 **3.1–3.2%** | **PASS（p1a 达标）**；p1c 未达绝对值 3%，但**与同窗 blurOFF 地板差 0.4–0.5 pp** ⇒ 按"回到 blurOFF 水平"判 **PASS**。原因如实说明：**带 trace 的窗口地板自身抬高**（blurOFF 从 p1a 的 60.0 fps 掉到 48.9 fps） |
| ② **ΣLoAF ≤ 900 ms** | p1a：**132 / 228 / 254 ms**（逐 rep，全部 ≤ 900）；p1c：**597 / 833 ms** | **PASS**（对照 A1 腿 1928–3769 ms、A2 2984–3769 ms） |
| ③ **`RunTask` >8 ms 条数回到 blurOFF 水平** | C = **18 / 19 条** vs B = **14 / 20 条**（shipped = 61–68 条） | **PASS（条数口径）**；**残留如实标注**：Σ 上 C（1788 / 2039 ms）仍是 B（1044 / 1273 ms）的 **1.6×**，未完全回落到 B 的 Σ |
| ④ **观感未退化（新增硬约束）** | 见 §2.4 | **PASS** |

**残留的候选解释（未单测，登记备查）**：C 腿自身的**周期重扫**（`setInterval(scan, 400)` 每次调 `document.getAnimations()`）落在被测窗口内；实测 **5/5 rep 的重扫都"零新增"**（`held` 恒为 16）⇒ 该重扫**在本批里是不必要的**。若协调者要把最后 0.4–0.5 pp 也拿掉，可把周期重扫降为"单次冻结 + 由抽屉重渲染事件触发重扫"（**本档未落地，仅给出实测依据**，避免超范围）。

### 2.4 观感量化（"模糊一点没动"的可复核证据）

**（a）运行时读回**：C 腿每次 rep `maskBlur = "blur(2px)"`、`areaShare = 1`（全视口遮罩仍在）。

**（b）掩码区锐度指标**（页内实时计算：**半分辨率、步长 2、排除对话框包围盒**的平均二阶差分 = 边缘响应；**数值越低越糊**）

| 腿 | 边缘响应均值（逐 rep） |
|---|---|
| `A1_shipped`（blur ON，动画在跑） | **0.74 / 0.74** |
| **`C_p1_dotpause`（blur ON，动画冻结）** | **0.741 / 0.740** |
| `B_blurOFF`（删模糊） | **8.217 / 8.215**（≈ 11× 锐） |
| `A2_shipped`（回召） | 0.73 / 0.74 |

**（c）逐像素差**（5120×2880 实况帧，排除对话框包围盒，`p1c-*-r0-confirm.png`）

| 对比 | mean | >2/255 | >8/255 | max |
|---|---|---|---|---|
| **A1 ↔ C（P1 的观感代价）** | **0.0018** | **0.0085 %** | 0.00285 % | 15 |
| A1 ↔ A2（**同条件重复 = 噪声地板**） | 0.2432 | 1.2924 % | 0.647 % | 122 |
| **A1 ↔ B（P2 的观感代价）** | **5.0531** | **21.5672 %** | 8.542 % | 166 |
| C ↔ B | 5.0532 | 21.5722 % | 8.543 % | 166 |

**读法**：**P1 相对现状的差异（mean 0.0018、0.0085% 像素）比"同一条件跑两遍"的噪声（mean 0.2432、1.29% 像素）还小 140 倍** ⇒ 在 5120×2880 实况帧上**测不出观感退化**。反之，**删模糊（P2）改动 21.57% 的遮罩区像素**，是噪声的 21 倍、是 P1 的 **2 500 倍**。

**（d）1:1 裁剪人眼复核**：`shots/LOOK-compare-A1-C-B.png`（三块 1400×900 设备像素 1:1 并排，左 A1 / 中 C / 右 B）与半尺寸版 `shots/LOOK-compare-A1-C-B-half.png`。多模态复核结论（原文摘录）：**"中（P1）与左（A1）几乎像素级一致……在静止截图里不可辨"**、**"右（B）狐狸完全锐利——耳尖分形、额发一缕缕、发带上下缘、杏仁形眼睛（含眼白与瞳孔）全部清晰可数"**；并指出 B 版"背景过锐、层级被打乱（背景插画抢侧栏文字）"。⇒ **人眼与像素口径一致：P1 保住了模糊那层降噪观感，P2 明显改变了观感。**

---

## 3. U1 的落地形态与载体权衡

### 3.1 落点（`patches/apply-BtwClose-v1.mjs --units U1`，两个 op，均 anchor 唯一）

1. **新建** `dsh-btw/src/client/frame-freeze.ts`（2 148 B）：导出 `freezeStateDotChase(): () => void`（按 `animationName` 匹配 + 单次冻结 + 400 ms 重扫 + 卸载时原相位恢复）。
2. **改** `dsh-btw/src/client/SideChatSurface.tsx`：加一行 import；在既有 `[confirmEnd]` 副作用（`containEscape` 那个）之后挂
   ```tsx
   useEffect(() => { if (!confirmEnd) return; return freezeStateDotChase() }, [confirmEnd])
   ```
   ⇒ 与"确认框可见期"**同生命周期**，用户取消（Escape/取消）也照常恢复。

### 3.2 为什么不是别的形态

- **不改 `dsh-client-ui-primitives`**：那是 shell 主包的内联产物，改动需重建 Web 产物、影响面不可控 ⇒ 按停止条件**不碰**（`static/statedot-render-path.md` Q2 给出各替代手段及其失效条件）。
- **不在遮罩上加 `will-change/contain`**：属"未实测假设"，本档不为它背书。

### 3.3 载体权衡（U1 = btw 包 vs U5 = shell CSS，二选一）

| 维度 | **U1：btw 包（推荐）** | U5：shell CSS 追加 `:has()` 规则 |
|---|---|---|
| 缓存面 | 插件 URL 带 `?rev=` 且响应头 **`cache-control: no-cache`** ⇒ **刷新必取新字节** | `/assets/index-C6eRlFa6.css` **无 `Cache-Control`/`ETag`/`Last-Modified`**（实测）⇒ 同名文件改字节**能否随普通刷新到达用户浏览器未确证**（P2 同样受此影响） |
| 作用面 | 只挂 btw 的结束确认框（= 用户报的这条路径） | 全应用所有 `[role=dialog][aria-modal=true]` 期间的 `svg rect` 动画（选择器不依赖 hash，更稳；但语义上由插件控制外壳，属越界） |
| 部署动作 | 重建 btw 包（与 U3/U4 同一次） | 单文件字节编辑（与 P2 共用一次写） |
| 被测关系 | **与实测消融逐字同形**（WAAPI 按名暂停） | 机制同、载体不同（CSS 暂停），**未单测** |

⇒ **推荐 U1**（实测同形 + 缓存面安全 + 与 P3/P4 同一次部署）；U5 作为"若协调者不愿等 btw 重建"的等价备用，**已内置互斥校验**（U1+U5 同时选中直接中止）。

---

## 4. U2 = P2：**未落地**（按契约 + 按"保观感优先"新约束）

**为什么不落**：① 契约明确规定 P2 仅"若 P1 不达标"才做，而 **P1 三判据达标**；② 用户新硬约束要求"解决遮罩及同类场景卡顿时**保留背景模糊**，不应默认用移除模糊这类观感退化做法作为长期方案" ⇒ **P2 只能作紧急兜底**。**本档不给它背书、不把它写成推荐解。** 补丁单元（U2）已就绪、dry-run 通过，供协调者在紧急情形下一次性落地/回滚。

**若仍要落，影响面（`static/p2-blast-radius.md` 全文，188 行）摘要**：

| 项 | 值 |
|---|---|
| 落点 | shell 主包 CSS 单规则：删 `-webkit-backdrop-filter:var(--dsw-mask-blur);` 与 `backdrop-filter:var(--dsw-mask-blur)`（**保留** `background:var(--dsw-alias-bg-mask-1)` 的变暗） |
| 渲染者 | primitives `Modal`（shell `index-ClqxG24t.js` 的 `$u`，line 56 / 字节 321 876；mask 渲染点字节 322 283）；类名映射 `At.mask = "_mask_15u5s_14"`（字节 200 376） |
| **会失去 2px 模糊的面** | 所有使用 primitives `Modal` 的弹窗（**含 btw 结束确认框、各类确认/信息弹窗**）；**不影响**设置弹窗的**环带**（`.VOzbGW_ring`，见下）与三处灯箱/引导遮罩 |
| 共享令牌 | **不动 `--dsw-mask-blur`**（该令牌被 4 个面消费：本 mask、settings 环带、attachment 灯箱遮罩、btw 灯箱遮罩 ⇒ 改令牌会连带 4 个面，**必须落单条规则**） |
| 覆盖/冲突 | **无**：全安装树 `grep -rl '_mask_15u5s'` 只命中 shell 的 JS+CSS，无任何插件覆盖该类；回滚与 exec-mask/w11 的改动**互不干扰** |

**⚠️ 顺带上游纠正（direct，建议协调者采信）**：`w28 §3.0`/`w11 §L9` 说"设置弹窗遮罩已被修成 `backdrop-filter: none`"——**现象成立、归因串台**。盘上 `dsh-client-ui-settings-general/lib/client.js`（md5 `d1eebb63…`，29 610 B）里 `.VOzbGW_mask{background:transparent;backdrop-filter:none;…}` **外加 4 条 `.VOzbGW_ring*` 仍带 `background:var(--dsw-alias-bg-mask-1);backdrop-filter:var(--dsw-mask-blur)`** ⇒ 落地的是 **w11 的"环带"方案**（把变暗与模糊一起搬到面板外的 4 条环带），**不是 exec-mask F1 的"只删两条声明"形态**（F1 候选字节 `bd7edeae…`/26 593 B 已被替换）。**结论：设置面并没有"免除 blur"，只是把 blur 挪到了环带**；若后续要量化设置面的 blur 代价，目标应是 `.VOzbGW_ring`。**这与 P2 不冲突、不重复**（不同文件、不同类、不共享改动面）。

**范围外（交 w29 普查，本档不碰）**：`._onboardingMask_1cfrq_10`（onboarding，blur(2px)）、`.fNh4Da_mask`（attachment 灯箱）、`.SalQ5q_lightboxMask`（btw 看图灯箱）、`.VOzbGW_ring*`（settings 环带）。

---

## 5. U3 = P3：消除"面板复活"竞态

### 5.1 结构充分性（direct，直接读被服务产物）

```
const visible = state.phase !== "closed" && state.parentSessionId !== void 0
             && String(state.parentSessionId) === parentKey && view.visible && view.presentation === "drawer";
...
if (!visible) return null;
```
（新包 `6b3245b9` 逐字不变，行号同 B:2825/2839）⇒ **抽屉能否出现，硬依赖 `view.visible`**。把 `viewStore.clear(parentSessionId)`（它删除该 parent 的视图条目 ⇒ `visible=false`）**提到 `await controller.close()` 之前**，则"点结束 → 界面消失"**在同一个 commit 内完成**，且此后**无论哪个续体 publish `phase:"open"`，抽屉都无法回来**——这正是"不引入新状态机"的先验式修法。

### 5.2 机制（静态推断，**升级 w28 的 INCONCLUSIVE**）

- `close()`（`src/client/controller.ts:311-340`）只在 `token !== undefined` 时用 `openingByToken.get(this.state.chatToken)` 把**命中那一个** OpeningAttempt 标成 `disposition='closed'`；`open()` 的续体靠 `if (attempt.disposition === 'closed') { void this.remote.close(...); return }` **拦住复活**。
- **复活路径（inferred）**：若在 close 的 RPC 窗口内**又发生一次 `open()`**，`restoreExisting()` 会走 `const attempt = this.openingByParent.get(key); attempt.disposition = 'visible'; publish(startingState(attempt))`（`controller.ts:613-620`）——**把在途 start 的 disposition 又改回 visible**；于是那条**仍在途的 `remote.start` 续体**落到 `this.publish(openState)`（`:172`）⇒ 抽屉复活。触发"第二次 open"的现实入口包括 `presentation.show()/toggle()`（`presentation.tsx:113-135`，`SideChatButton` 的点击与 ⌘⇧. 快捷键）与 `controller` 内部的 `open()` 调用点。
- 本档观测到的**窗口放大机会**：p1a 有一条 `sideChat/close` 实测 **2 402 ms**（窗口比常态 19–284 ms 宽约 10×）而**未复活** ⇒ 印证"光有宽窗口不够，还需要那第二次 open"，与 w28 的 1/6 概率一致。

### 5.3 前验基线与验收（**如实标注**）

- **本档 20 rep（p1a 12 + p1c 8）自然运行，复活翻转 = 0/20**（判据 = `endclick` 后 30 s 内 `presence` 中 `drawer=false→true` 翻转次数；p1c 逐 rep 全 0）。**未复现** w28 的 1/6 竞态——**这不与 w28 矛盾**（1/6 概率下 20 次全不出现的概率 ≈ 2.6%，属可能；且本档 20/20 次的 close 都 ≤2 402 ms，而 w28 那次是 2 644 ms）。
- ⇒ **"点结束 → 界面消失"** 本档前验基线已是 **117–153 ms（p1a）/ 187–264 ms（p1c，带 trace 更慢）**，与 close 落地同量级；**w28 的 2 661 ms 是竞态路径的产物**。
- **所以**：U3 的收益在本档**无法用"改善前后"直接展示**（缺陷没出现），只能给**结构充分性 + 机制分析**；**"≥6 rep 内 0 次复活"的后验必须在部署后按 §12 的命令重跑**（探针判据已内置）。

---

## 6. U4 = P4：JumpList 取数懒加载

**缺陷带量复现（本档独立于 w28 的新证据）**：一次 boot、20 rep 里，抽屉**每次打开**都会发一条 `sideChat/listTree`，而 `view.jumpOpen` 全程为 `false`（本档从未展开跳转列表）⇒ **结果对用户完全不可见**：

| 运行 | `sideChat/listTree` 次数 | 单次耗时（ms） | Σ |
|---|---|---|---|
| p1a（12 rep） | 13 | 6 814 / 2 326 / 632 / 5 884 / **22 237** / 12 816 / 2 444 / 1 642 / 932 / 615（另有 3 条在窗口结束时未返回） | ≥ **56.3 s** 宿主侧工作时长（160 s 窗口内） |
| p1c（8 rep） | 4 | 2 936 / 2 284 / 418 / 380 | 6.0 s |

**修法与锚点**：`SideChatJumpList.tsx` 的取数 effect 首行加 `if (!view.jumpOpen) return`，并把 `view.jumpOpen` 加入依赖，使"展开时才取数"。两处锚点均已核唯一（当前源码 mtime Sep 12，**未被兄弟线改动**）。

**口径澄清（诚实项）**：w28 §7「点结束后 54 ms 仍发一条 listTree」的**具体形态在本档未复现**——本档 20 rep 里每条 `listTree` 都与某次**抽屉打开**同时发生（`at` 与同 rep 的 `sideChat/start` 同毫秒）。因此本档把该单元的验收重述为**可测形态**：**"抽屉打开但跳转列表未展开时 `listTree` 次数 = 0；展开后照常发出"**（后验同样需部署，见 §12）。

---

## 7. 补丁脚本、候选件与构建验证

### 7.1 交付件

| 文件 | 内容 |
|---|---|
| `patches/apply-BtwClose-v1.mjs` | 五单元补丁器（U1/U2/U5/U3/U4）：**dry-run 默认**、`--apply` 才写、**all-or-nothing（任一锚点非唯一命中则整批中止、一个文件都不写）**、自动 pre-image（sha256 manifest）、**幂等**（`already-applied` 跳过）、**每单元独立回滚**（`--rollback Ux`/`--rollback-all`）、写后 `node --check`（JS/TS 分别口径）、`--status` 巡检、`--build` 可选重建、U1↔U5 互斥、shell CSS 字节漂移检测（`--allow-drift`） |
| `candidate/frame-freeze.ts` | U1 新增源文件候选（2 148 B，md5 `170bfc60…`） |
| `candidate/SideChatSurface.patched.tsx` | U1 改后源码候选（29 526 B，md5 `f839946d…`） |
| `candidate/presentation.patched.tsx` | U3 改后源码候选（7 543 B，md5 `259abd35…`） |
| `candidate/SideChatJumpList.patched.tsx` | U4 改后源码候选（7 125 B，md5 `c4fa2c9a…`） |
| `candidate/client.js.built-with-U1-U3-U4` | **镜像构建产物**（363 745 B，md5 `4d9c1ce8…`）——**参考件**，见 §7.3 的部署忠告 |
| `candidate/MANIFEST.json` | 以上 + 对照构建 + 部署位/仓库位的字节与 sha256/md5 |
| `probes/p1-ablate.mjs` | 单页四腿 A/B/C/A 消融探针（含：页内 **阳性对照 POS120**、**阴性对照 IDLE**、P1 冻结器、逐 rep `maskBlur`/`animCount`/freeze-thaw 读回、**观感截屏 + 边缘响应指标**、CDP `RunTask`、`presence` 复活判据、对 `session.list` 抖动的容错重试） |
| `probes/init-probe.js` | 复用的页内主仪器（w28 原样拷贝，未改） |
| `tools/p1-analyze.mjs` | 分段统计器（口径与 w28 `tools/analyze.mjs` 一致：`>33.4 ms` + `mark.prevFrameIdx` 播种） |
| `static/p2-blast-radius.md` / `static/statedot-render-path.md` / `static/btw-anchors.md` | 二级子代理只读静态侦察（188 / 193 / 283 行；P2 影响面、追灯动画渲染路径与可暂停手段、P3/P4 锚点表） |
| `raw/*` | 全部原始 JSON/日志（含失败件，见 §8） |
| `shots/*` | 8 张 5120×2880 实况帧 + `LOOK-compare-A1-C-B{,-half}.png` 1:1 观感对比 |

### 7.2 dry-run 证据（默认不发散、不写）

```
$ node patches/apply-BtwClose-v1.mjs --units U1,U3,U4      # 默认就是 U1,U3,U4
U1  not-applied   · create frame-freeze.ts / edit SideChatSurface.tsx ×2   （锚点均唯一命中）
U3  not-applied   · edit presentation.tsx                                  （锚点唯一命中）
U4  not-applied   · edit SideChatJumpList.tsx ×2                            （锚点均唯一命中）
shell CSS: md5=30df0035… ✔ 与 pin 一致；'_mask_15u5s_14{' 0-based 偏移=10026；整条规则出现 1 次
btw 部署位: md5=6b3245b9… bytes=335993（16:55:55 换包后）
[dry-run] 以上全部锚点唯一命中、文件均可写。加 `--apply` 才真正写。
$ node patches/apply-BtwClose-v1.mjs            # 全选 → 立即中止：U5 与 U1 互斥，一个文件都不写
```

### 7.3 构建验证（**在镜像里做，仓库工作树未被本档改动**）

为避免与兄弟 resize 线的写入边界冲突，本档**没有**改仓库 `dsh-btw/`（其 `src/client/*` 正被该线改动），而是在 `btsrc/` 复制一棵（`node_modules` 软链）应用 U1/U3/U4 后重建：

- `npx tsdown` → **成功**（977 ms/979 ms）；`lib/client.js` = **363 745 B**（含 zod 注释路径前缀差异的对照构建为 361 605 B ⇒ **U1+U3+U4 的净增量 = +2 140 B**）。
- `node --check lib/client.js` **通过**；产物内命中 `freezeStateDotChase` ×2、`jumpOpen) return` ×1。
- **镜像 vs 仓库同源构建的差异已定位**：仅 1 处、414 B，全部来自 zod 依赖注释里的相对路径（`node_modules/zod/…` vs `../../../../../dsh-btw/node_modules/zod/…`）⇒ **功能等价**；⇒ 仓库内重建的预期体积 ≈ **363.3 KB**，请以**仓库内重建 + sha256 核对**为准（**不要**直接部署本档的镜像产物）。

---

## 8. 失败 / INVALID 保留（不挑窗口）

| 件 | 内容 |
|---|---|
| `raw/p1b-invalid.stdout` + `raw/p1-ablate-p1b.json` | **p1b 作废整窗**：`session.list` 抖动复现——3.2 s 时曾返回行，随后 **438.6 s 时 `rows:0`**，`picked -1`；期间还出现页内 `PAGEERROR SlotAssemblyError: renderSlot('root') before any 'root' registration (boot order)`。该窗口在 `rows:0` 之后**由本档主动终止**（记录里 `aborts: ["FATAL:Error: page.waitForFunction: Target page, context or browser has been closed"]` 即此终止，**不是**探针自然报错）⇒ 事后**已修好探针**（行等待窗口 420 s→900 s、`rows:0` 时周期性重新展开工作区、逐轮落盘），随即以 **p1c** 成功重跑。**失败件全部保留**（与 w28 `main2`/`ab5` 的 `NO_SESSION_ROWS` 同源）。 |
| `raw/p1-ablate-p1a.json` 内的 `trace` | ⚠️ **p1a 的轨迹整批 INVALID**：本档首版探针误用 `Tracing.start{transferMode:'ReturnAsStream'}` ⇒ 不会发 `Tracing.dataCollected`，实测 12/12 rep `RunTask n=0 kept=0`。**已在 `probes/p1-ablate.mjs` 修正并加注释**（改回默认 ReportEvents），p1c 因此拿到 7 299 条 RunTask。**p1a 的帧/LoAF 判据不受影响**（与 trace 无关）。 |
| `raw/p1c.stdout` 首轮 | p1b 之后的重跑（即 p1c）**成功**；p1a→p1b→p1c 三次尝试全部落盘。 |
| 锁 | `raw/lock-p1a.json`：`acquire` 返回 **BUSY**（exec-a11y 持有，liveness ALIVE）⇒ **未回收**任何锁，全程 CONTENDED。 |

---

## 9. 副作用申报（如实）

1. **本档必须点「结束」**（共 **20 次**：p1a 12 + p1c 8）：U1 的判据段终止于"点结束"，P3 的复活判据更是只有真点结束才能测。**已按纪律只对"最旧一行"会话操作**（`--session-match` 未命中时取最后一个未选中行 = `热刷新后 dsh 会话加载缓慢`，与 w28 同一靶会话，**不是用户当前活跃会话**）。
2. **未点任何 Sessions 树行内按钮**（无 Rename/Delete 菜单）；只点会话行本体、btw 入口、抽屉 `×`、确认框「结束」。
3. `~/.dsh/btw/index.json` diff（本档窗口 **16:46:49–16:49:30**）：**新增条目 0、删除条目 0**；1 条**既有**条目 `session-547af6bc-cc6a-4058-8e15-92be67bfd8a7` 的 `lastActiveAt` 落在本档窗口内（`lastPreview` 可能被刷新）⇒ **申报：本档刷新了该既有条目**。另 4 条新增条目时间戳在 **16:31–16:43（本档窗口之前）**，归属兄弟线，**不记在本档账上**（快照对比见 §1 命令与 `raw/btw-index-after.json`；⚠️ 本档未在开工前取一次快照，属疏漏，已如实标注）。
4. 未改任何产品文件；未写工作区外；本档全部写盘都在 `.workspace/lag-fix/exec-btwclose/` 内。

---

## 10. 同档自复核：**PASS**（含 3 项如实残留）

**通过项**：① U1 三判据达标且**三腿对照 + 回召 + 阳性/阴性对照齐全**；② U1 的"开关生效"与"模糊保留"都有**运行时读回**（不是推断）；③ 观感退化用**噪声地板对照**（A1↔A2）证明"测不出差异"；④ U3 的充分性有**被服务产物的谓词原文**支撑；⑤ U4 的缺陷有**带量、可复核**的独立复现；⑥ 补丁器 dry-run/幂等/互斥/回滚/构建全链路自测通过；⑦ 失败件全部保留，未挑窗口；⑧ 未越界写、未回收锁、未动用户浏览器。

**残留（不构成 REWORK，但必须随结论读）**
- **R1**：p1c（带 trace 窗口）C 腿绝对值 **3.6% > 3%**，虽然同窗 blurOFF 地板本身是 3.1–3.2%；**协议口径（p1a）的 2.8% 才达标**。⇒ 采纳裁决建立在"p1a 达标 + p1c 与同窗地板等价"两条上。
- **R2**：`RunTask` 的 Σ（1788/2039 ms）仍为 blurOFF（1044/1273 ms）的 1.6×（**条数口径已回落**）。
- **R3**：**P3 与 P4 的后验验收无法在本档完成**——本档**无工作区外写权限**，而两者的载体（btw 包）必须部署到 `~/.dsh/profiles/...` 才能生效。本档只交付"补丁 + 前验基线 + 可复用探针"。**P3 的"≥6 rep 0 复活"在后验里无从"改善前后"对比**（前验 20 rep 就没复现）。
- 另：**Gecko 未复核**（纪律 §3：Gecko 无 LoAF/LongTask、FF155 无 CDP ⇒ 只能 wall-clock；本档未跑有头 Gecko）⇒ 本档结论的可搬运部分是**同窗差分与占比**，绝对帧率不可搬到用户机。

---

## 11. 判据清单

| 判据 | 结果 | 证据 |
|---|---|---|
| P1 主判据 `>33 ms` ≤3%（协议口径） | **PASS 2.8%** | `raw/p1-ablate-p1a-analysis.md` |
| P1 主判据 vs 同窗 blurOFF 水平 | **PASS**（3.6% vs 3.1–3.2%，带 trace 窗口） | `raw/p1-ablate-p1c-analysis.md` |
| P1 ΣLoAF ≤900 ms | **PASS**（132/228/254；597/833） | 同上 |
| P1 `RunTask` >8 ms 条数回到 blurOFF | **PASS 条数**（18/19 vs 14/20）；Σ 残留 1.6× | `raw/p1-ablate-p1c.json` |
| P1 观感未退化（量化 + 1:1 复核） | **PASS**（mean 0.0018/255，低于噪声地板 140×；人眼不可辨） | §2.4、`shots/LOOK-compare-A1-C-B*.png` |
| P1 消融开关确证生效 | **PASS**（5/5 rep：`matchRunning 16→0`、`matchPaused 0→16`、`held 16`、`thaw 16`） | `raw/p1-ablate-p{1a,1c}.json` |
| A/B/A 回召 | **PASS**（74.8 → 0.2 → 2.8 → 71.1） | `p1a` |
| 阳性对照（页内 120 ms） | **PASS**（133.3 ms 帧 / 0.8%） | `p1a`/`p1c` |
| 阴性对照（静止） | **PASS**（0 帧 >33 ms、60 fps） | `p1a`/`p1c` |
| P2 落点字节确证 | **PASS**（唯一 1 次命中、md5 与 pin 一致） | `patches/apply-BtwClose-v1.mjs --status` |
| P2 影响面清单（强制项，若落地） | **已交付**（并按"保观感"约束降为**紧急兜底、不推荐**） | `static/p2-blast-radius.md` |
| P3 补丁落地 + 充分性 | **PASS（静态充分）**；前验竞态 **0/20 未复现**；后验待部署 | §5 |
| P4 缺陷复现（带量） | **PASS**（13 次 / 最长 22 237 ms / Σ≥56.3 s，全部 `jumpOpen=false` 不可见） | §6 |
| 窗口四道门禁 | p1a ✔ / **p1b ✘ 作废** / p1c ✔ | §1 |
| 是否改动产品文件 | **无**（仅本档目录 + 镜像 `btsrc/`） | `git status` 未出现本档改动 |

---

## 12. 给协调者的落地清单与待复核项

**建议落地顺序（全部为热面，`dsh-btw` 重启无关）**
1. `node .workspace/lag-fix/exec-btwclose/patches/apply-BtwClose-v1.mjs --units U1,U3,U4 --apply --build`
   （`--build` 会在 `dsh-btw/` 内重建 `lib/`；⚠️ **该目录 `src/client/*` 正被兄弟 resize 线改动** ⇒ 请在它收口后再跑，或改用"镜像构建 → 只拷 `lib/`"的既有路线。）
2. 按既有路线**只对 `lib/` 双向拷贝**（仓库 `dsh-btw/lib/` ↔ `~/.dsh/profiles/node_modules/@local/dsh-btw/lib/`），并核对 **sha256 + 响应体哈希**（`?rev=` 不是内容哈希）；部署后 `curl -s .../plugins/@local/dsh-btw/client.js | md5sum` 应与 `lib/client.js` **逐字节一致**。
3. 页面刷新一次（插件 URL 带 `?rev=` 且 `cache-control: no-cache` ⇒ 必取新字节）。
4. **P2 不落**（若确需兜底：`--units U2 --apply`，并**必须在交付里标注它是应急、观感退化 21.57% 遮罩区像素**）。

**待复核（部署后，命令可直接复用；探针已内置判据）**
```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-btwclose
# P1 后验（真实路径：点 X → 确认框 → 结束；三判据 + 观感截屏 + 复活翻转）——期望
#   A1/A2 仍 ~47-75%、B ~3%、C ≤3%（且 maskBlur 仍为 blur(2px)、edgeMean 与 A1 同级）
node probes/p1-ablate.mjs --stamp post-U1234 --reps 3 --dwell 2500 --trace --boot-wait 600000
node tools/p1-analyze.mjs raw/p1-ablate-post-U1234.json --md --json raw/post-U1234-analysis.json
# P4 后验：抽屉打开而跳转列表未展开时 listTree 次数应为 0（看 raw 的 http 台账）
# P3 后验：goneDelay 与 close 落地同量级；presence 里 endclick 后 30 s 复活翻转 = 0
```
**注意**：`session.list` 仍可抖动（本档实测 3.2 s 成功 / 438.6 s 时 `rows:0` 作废一次），`--boot-wait` 必须给足；若宿主重启，需重排窗口并复核 `-session-match` 命中的靶会话。

**登记备查（未做、不建议在本档做）**：① C 腿 400 ms 周期重扫在 5/5 rep 里"零新增" ⇒ 可降为单次冻结（实测依据已给，未落地）；② 若哪条线要量设置面的模糊代价，目标应是 `.VOzbGW_ring` 而非 `.VOzbGW_mask`（§4）。
