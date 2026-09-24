# report.md — F1 实施记录（修订执行复核一体档）

线：`incident2 / exec-mask`　独占目录：`.workspace/lag-fix/exec-mask/`
上游契约：`.workspace/lag-fix/incident2/why-these-two/audit.md` + `analysis.json` + `tools/`
宿主：PID 301709 `node …/dsh web`（**全程未重启、未发信号、未 pkill 任何浏览器**）
日期：2026-09-22　器械：真实 Google Chrome（Playwright `channel:'chrome'`，headless）

---

## 0. 裁决摘要

| 项 | 结果 |
|---|---|
| **交付单元** | **F1（唯一单元）**：消除设置弹窗遮罩 `div.VOzbGW_mask` 的全视口 `backdrop-filter: blur(2px)` |
| **选定路径** | **(a) 改为纯 rgba 变暗** —— 即删除该规则内那一条 `backdrop-filter` 声明 |
| **落点（已确证）** | `@deepseek-ai/dsh-client-ui-settings-general/lib/client.js` **第 28 行第 704 列**，`.VOzbGW_mask{…}` 规则内的 `backdrop-filter:var(--dsw-mask-blur);` |
| **载体形态** | **CSS 类**（非内联 style）——由该 bundle 运行时注入 `<style data-plugin-css="…SettingsRoot.module.css">` |
| **冷/热面** | **热面**：浏览器实际收到的字节与磁盘文件 **逐字节相同**（sha256 一致）；模块加载器对 `rev` **不做内容哈希校验** ⇒ **刷新页面即生效，无需重启宿主** |
| **改动量** | 26630 → 26593 字节（**−37 字节，且仅此一处删除**，无任何其它字节变化） |
| **pre-image** | `sha256 9298ac5b087056555498550e0e0e6dd9d3202dce48bb07b2a2c4bfeed1d63da5`（26630 B，mode **664**） |
| **候选件** | `sha256 bd7edeaec382be264262c61933395b1fec6026dbedf57fd1be17a307cc899aec`（26593 B） |
| **补丁脚本** | `apply-Mask-v1.mjs` sha256 **`c2f04a48f6a62e19719705e7bb70cbc7ec9c5d7af9306c797d6469603c71d923`**（已冻结） |
| **补丁脚本自测** | **37/37 PASS**（含 8 类拒绝路径、EACCES、pre-image 防覆盖、rollback、漂移拒绝、幂等、**非 UTF-8 逐字节精确**、符号链接拒绝（apply **与** rollback 双路径）、mode 保留、同名目标不冲突、错误路径可读报告、**跨拼写 rollback 仍匹配**、**不可读/变目录目标拒绝**、**emit 失败保留报告且退出码非零**） |
| **独立对抗审查** | 已执行 **三轮**（另一档）。第 1 轮：6 条溯源主张**全部存活**，但攻破脚本契约，发现 **1 致命潜在 + 6 次要**缺陷 ⇒ 全修。第 2 轮（针对 `843be47d…`）：**四项修复确证有效、零回归**，新发现 **N1/N2** ⇒ 全修。第 3 轮（针对 `9a8ca4b9…`）：**N1–N4 确证有效、零回归**，新发现 **R0/R1/R2** ⇒ 全修（见 §4.2–§4.4） |
| **deployed 写入** | **不在本档执行**：本档沙箱对目标路径 `--apply` 为 **EACCES**（已实测，对抗档独立复现）。目标文件经自测 C23 复核**仍为原 pre-image，mode 664** |
| **观感等价性** | **不等价，差异已量化**（见 §6）。**面板内部处于噪声地板量级**（平均差 0.0008/255；空对照为 0.0001），差异全部落在面板外的变暗边距（该区域 15.60 % 的像素差 >2/255）。本档**不自行拍板**，交协调者裁决 |
| **STEP-0 仪器闸门** | ✅ **已落地**（本档自上器械独立复测，不是采纳任一侧）：帧通道在**前台 + 播种**下对 120 ms 阻塞 **10/10 检出**（两种注入位置各 5/5）⇒ `why-these-two` 的"帧通道有效"**成立**、`tab-switch` 的"帧间隔不是失速探测器"**被否证**（其零为**窗口协议伪影**，我在同一批样本上复现为 0/5）。**但主判据按仲裁改判为 LoAF**（见 §0bis） |
| **验收 · 主判据（改判后 = LoAF）** | ✅ **达标**：2560×1440@DSF2、3 rep、**90/90 个"弹窗内相" `loafCount` = 0**（合成器动画帧预算零超支）；对照臂 Σ LoAF 97–1043、22–30/30 相有条目、**单条 `duration` 92.5–110 ms**（见 §0bis.7、§5.2） |
| **验收 · 旧判据（`framesGt50`，降级为相对 KPI）** | ✅ 90/90 相 = 0，`p95` 16.7–16.8 ms。**但不得作为灵敏度主张**：其分辨下界约 40–50 ms，25–45 ms 的停顿会被漏掉；且我的探针用 `ts` 口径 ⇒ **绝对帧值系统性偏低 ~4–20 ms**（见 §0bis.7 第 2–3 条） |
| **验收 · 副判据（LoAF）** | ✅ **达标**：`patch` 臂 Σ LoAF = **0**（对照 `normal` 97–1043） |
| **验收 · 护栏 1440×900** | ✅ **达标且更优**：两臂均 0 抖动，`patch` 单相 frameMax 上限 **33.4–50 → 16.8 ms**（见 §5.6） |
| **验收 · 护栏 c2f** | ⚠️ **两种读法并列**：**汇总中位读法** ❌ `patch` 中位 17.0 / 17.8 / 17.6–18.05 ms，均略高于基线 16.65 ms；**逐相配对读法** ✅ delta 中位 −0.5/+0.5/0.0 ms、符号检验 **p ≈ 0.53**、1440×900 ±0.2 ms 以内 ⇒ 未见系统性偏移。**本报告最重要的待裁决项**（见 §5.4） |
| **阳性对照（V1）** | ✅ **36/36 PASS**：`POSCTL_120` frameMax 99.9–116.7 ms，而 **longtaskCount 恒为 0** ⇒ 帧通道有效，且独立复现"LongTask 对页内注入失明"这一器械事实（见 §5.1） |
| **桥接 2×2 + 批内自證（协调者第 4 条；规则 19–20）** | ✅ **用双通道给出**：2560×1440@DSF2、**3 rep、同 rep 相邻配对** ⇒ **主判据 LoAF：35 → 0 条（1293.1 → 0 ms）**；**副判据 wall-clock 帧间隔：77.2–84.4 → 18.8–21.8 ms**。**`blurOnly`（保留 scrim）与 `both`（审计臂）在 3/3 rep 是同一个零** ⇒ **仅去 blur 已足够，scrim 不必纳入候选**（只由**本档自有配对数据**支撑）。`scrimOnly` ≈ `normal` ⇒ 代价唯一钉在 blur 上。**批内自證全通过**：`RunTask` 13,191–13,391 条；阴性对照 LoAF/LongTask/gt50/**RunTaskMax 全 0**；阳性对照用**页内 `setTimeout`** 注入 120 ms ⇒ **RunTask GT 120.43–120.52 ms**（§5.5.1） |
| **同档自复核** | **PASS（在 §0bis 改判后的 LoAF 主判据下）**，附 4 项待裁决/已知事项（§8） |

## 0bis. **STEP-0：仪器可信度仲裁（本轮闸门，先于任何验收裁决）**

### 0bis.1 争议与两侧原始主张（**都不作为既定前提**）

| 侧 | 主张（引其原文） |
|---|---|
| `why-these-two`（本档所依据的审计） | 「**帧序列通道有效**：120 ms 阻塞被如实报成 ~100–116.8 ms 帧间隔」；判据统一改用 `framesGt50`/`frameMax` |
| `tab-switch` | 「**本环境 rAF 帧间隔不是失速探测器**」：120/200 ms 同步阻塞产生 **0 个 >50 ms 帧间隔**（`frames>50 = 0`，`frameMax` 16.8–45.3 ms）⇒ 一律只作低级别参考 |

协调者裁定：**两者至少有一个错，仲裁落地前不得跑验收、不得下 PASS/REWORK**。

### 0bis.2 我做了什么（**独立复现，不是采纳任一侧结论**）

在本线**自己的器械**上（真实 Chrome 153.0.8010.52，`channel:'chrome'`，headless，2560×1440@DSF2，真实 GUI 页面 `127.0.0.1:3080`），**同页同阻塞**四通道同测：

| 通道 | 实现 |
|---|---|
| ① rAF 帧间隔 | 页内采样器**同时记两个时钟**：`ts` = rAF **时间戳参数**、`now` = 回调**入口** `performance.now()` |
| ② LongTask | `PerformanceObserver({type:'longtask'})` |
| ③ LoAF | `PerformanceObserver({type:'long-animation-frame'})`，读 `duration`（非 `blockingDuration`） |
| ④ **地面真值** | CDP trace `RunTask`，类别**含 `disabled-by-default-devtools.timeline`**（少这个类别 `RunTask` = 0 条） |

阻塞原语唯一：`__S0.spin(ms)` 忙等 120 ms，在忙等两侧打 `console.timeStamp` 标记以对齐三套时钟。
注入位置**两种各 5 次**：**(a) rAF 回调内部**、**(b) setTimeout 回调内部**；另加**不注入阴性对照 ×3**，以及两种位置的**"无前置帧/线 B 协议"对照各 ×5**（用于在同一批样本上复现 `tab-switch` 的零）。
每次同时记录 **`document.visibilityState` / `hidden` / `hasFocus`**，并在测前做一次显式**前台帧率自證**。

**事前注册判据**（与仲裁档同构）：真值有效 = 宿主 `RunTask` ≥ 0.5×请求；通道"检出" = 读数 ≥ 0.5×GT **且** ≥ 该窗口空闲帧周期中位数 + 0.5×GT；**真空** = 窗口内可构成间隔的样本 < 2（真空零不算阴性证据）。

### 0bis.3 器械自證（不满足即整批判不可用）

| 项 | 实测 |
|---|---|
| 前台帧率自證 | **68.6 Hz**（6 帧 / 87.4 ms），`visibilityState=visible`、`hidden=false`、`hasFocus=true` |
| 探针通道 | `longtask: true`、`loaf: true`、`errors: []` |
| trace 通道非空 | **`traceChannelNonEmpty = true`**（150,312 事件；20/20 注入格都取到宿主 `RunTask`） |
| 每窗口帧数 / 帧间隔中位 | **32–33 帧 / 16.7 ms**（阴性对照 62 帧）⇒ **从不真空** |
| **阴性对照**（不注入 ×3） | 帧间隔 max **16.8 / 16.8 / 29.7 ms**，**LongTask = 0 条，LoAF = 0 条**，无 GT ⇒ 通道"无事时安静"，不自造读数 |

### 0bis.4 结果（每格 n=5，GT ≈ 120.06–120.56 ms）

| 注入位置 | 窗口协议 | 帧间隔读数（中位/max） | **检出** | LongTask | LoAF `duration` |
|---|---|---|---|---|---|
| **rAF 回调内** | 播种 + `ts` | 116.6–116.7 | **5/5** | **120.0 精确** | 136.6–136.9 |
| **rAF 回调内** | 播种 + **wall** | 120.4–120.8 | **5/5** | 120.0 | — |
| **setTimeout 回调内** | 播种 + `ts` | **100.0–100.1** | **5/5** | **120.0 精确** | 120.6–120.8 |
| **setTimeout 回调内** | 播种 + **wall** | 120.6–121.0 | **5/5** | 120.0 | — |
| rAF（**无前置帧**，线 B 协议） | `ts` / wall | **16.7 / 16.8** | **0/5 · 0/5** | 120.0 | 136.6–136.9 |
| timeout（**无前置帧**，线 B 协议） | `ts` / wall | **16.8 / 16.8** | **0/5 · 0/5** | 120.0 | 120.3–133.0 |
| 不注入（对照） | — | 16.8–29.7 | 0/3 | **0** | **0** |

**⇒ 同一个浏览器、同一个页面、同一个 120 ms 阻塞：播种口径 10/10 检出；线 B 口径 0/10 检出。两侧都对，差的是窗口协议。**

### 0bis.5 三条机制，逐条在我的样本上复现

1. **窗口播种（`tab-switch` 的零是结构性漏检）**：线 B 的探针 `armWindow()` 清空序列后**立即**注入，且**首帧不贡献任何间隔** ⇒ 阻塞落在 `[武装, 首帧]` 之间，**结构上无法表示**。我的实测 `armLeadMs` = 5.9–15.2 ms（< 一个帧周期 16.7 ms），复现其"多数格子无帧落在武装与注入之间"。
   **我把它在同一批原始样本上复现出来了**：同一格的播种读数 116.6/120.3，线 B 口径读数 **16.7/16.8（0/5）**。
2. **`ts` 时间戳陈旧（第二条独立的"零/假清白"机制）**：对**注入在 rAF 回调之外**的阻塞，主线程被占住时**已有一个 BeginFrame 排队**，恢复后执行该排队帧、其 `ts` 是**阻塞前的旧时间**而 `now` 是真实时间。实测**跨块那一对**：`timeout` 位置 **`straddle_ts` = 16.6–16.7 ms（看起来清白！）而 `straddle_wall` = 120.6–121.0 ms**；`raf` 位置无此现象（`straddle_ts` 116.6–116.7）。
3. **两个时钟的系统偏差（量化）**：`wall` ≈ **GT + 0.0…0.7 ms（近乎精确）**；`ts` ≈ **GT − 3.7…4.0 ms（阻塞跑在 rAF 回调内）** 或 **GT − 20.0…20.2 ms（阻塞跑在 rAF 回调外，≈ 1.2 个帧周期）**。

### 0bis.6 裁决（**通道层面**）

| 主张 | 裁决 | 依据（本档独立复现） |
|---|---|---|
| `why-these-two`：**帧通道有效** | ✅ **成立** | 播种口径前台 **10/10 检出**（两种注入位置、两个时钟都是 5/5） |
| `why-these-two`：帧通道取代 LongTask 作判据 | ✅ 成立 | LongTask 对"非帧归属"任务盲（见下） |
| `tab-switch`：**120/200 ms 阻塞产生 0 个 >50 ms 帧** | ⚠️ **是口径产物，不可推广** | 同格播种读数 5/5，线 B 口径 0/5；差额 100% 来自窗口协议 |
| `tab-switch`：**"本环境 rAF 帧间隔不是失速探测器"** | ❌ **在我器械上被否证** | 前台播种 **10/10** 检出 120 ms；其零可在我手上精确复现为窗口伪影 |
| `tab-switch`：**LongTask 通道可信** | ✅ **成立** | 我的 `raf`/`timeout` 两种页面回调注入 LongTask 均**精确报 120.0** |
| 二分"帧通道不可信 / LongTask 可信" | ❌ **须改写** | 两侧各错一半：帧通道**口径错**（非不可用）、LongTask **有归属盲区**（非不可信） |

**LongTask 的盲区归属（决定性 2×2）**：`raf` 与 `timeout` **两臂的注入者都是 CDP `Runtime.evaluate`**（都是 `page.evaluate(() => __S0.inject(site,…))`），而 LongTask 对两者**都精确报 120.0**；唯一不同的是**阻塞宿主任务**（`FireAnimationFrame` / `TimerFire` vs 顶层 `EvaluateScript`）。
⇒ **LongTask 盲的是"任务是否被 Blink 归属到 local frame"，不是"CDP 这个注入者"**。（我本批未跑顶层 `eval` 位置，故该条只判"与仲裁档一致、且我复现了其页面回调侧"；顶层 `eval` 盲区我引用仲裁档 §4.1 `eval` 格 0/5。）

### 0bis.7 **对本报告结论的直接后果（这是闸门的产出）**

1. **主判据改判为 LoAF**（按仲裁 §7.2 第 1 条：本档结论是"代价在**合成器侧** blur 重合成"，LoAF 是唯一以**动画帧预算**为口径的通道，且我实测在前台对两种注入位置 5/5 有效、阴性对照为 0 ⇒ **非真空、语义正确**）。
   **改用 LoAF 重算既有数据**（无需重跑）：`patch` 臂 **30 相 × 3 rep = 90 个弹窗内相全部 `loafCount` = 0**；`normal`/`normal2` 为 **Σ 97–1043**，22–30/30 相有 LoAF 条目，**单条 `duration` 达 92.5–110 ms**（合成器动画帧预算超支）。**⇒ 结论在正确通道上不变，且比 `framesGt50` 更有依据。**
2. **`framesGt50` 不再作为灵敏度主张**：其真实分辨下界约 **40–50 ms**，25–45 ms 的真实停顿会被整段漏掉。故"**961 → 0**"只能读作**相对 KPI**，**不能**读作"已无 25–45 ms 级停顿"。
3. **我既有数据的绝对帧值偏低**：我的探针用的是 **`ts` 参数**（`inpage-probe.js:43` `function tick(ts) { P.frames.push(ts) }`），且我的 `POSCTL_120` 走 `page.evaluate(() => window.__block(120))` ⇒ 阻塞跑在**顶层 `EvaluateScript` 任务**（rAF 回调**外**）⇒ 预期读数正是 **ts ≈ GT − 20 ms**，与我实测的 **99.9 / 100.0 / 116.7** **完全同型**。⇒ **我的 `frameMax` 绝对数系统性偏低 ~4–20 ms；`16.8 ms` 是下限。**
4. **我的既有窗口满足仲裁的可用性自證（rule 2）**：逐相复核既有 `mask2k`/`guard9` 数据 ⇒ **每窗口帧数 40–89（最少 40，从不真空）**、帧间隔中位 **16.7 ms**（60 Hz 前台）。⇒ **我的帧数据处在"前台 + 播种 + 非真空"的可用区间，`tab-switch` 的零不适用于我的数据集。**
   唯一例外：**调用 1 的 `IDLE_BASE`（阴性对照位）frameMax = 66.7 ms 且 >50ms 达 1–2 帧，且三个臂同时如此** ⇒ 按 rule 2 第 ③ 条**该 run 的对照位不合格**，这是一个**基于规则的**理由去把调用 1 的 `normal`(=1043/961) 视为环境噪声偏高，取代我先前"疑似污染"的措辞。
5. **我的协议缺陷（须披露）**：按仲裁 §7.1 rule 4，**任何用 CDP `Runtime.evaluate` 注入的阳性对照都必须改用页内 `setTimeout` 注入**。我的 `POSCTL_120` **没有**这么做 ⇒ **它的 LongTask 立柱无信息量**（实测恒为 0，正是预期的归属盲区）。**但其帧通道与 LoAF 都检出了该 120 ms 阻塞**（帧 99.9–116.7、LoAF 有 1 条），故"通道活着"这一用途仍然成立；我只是**不能再声称该对照验证了 LongTask**（我从未用它当证据）。
6. **不受影响的结论（仲裁 §7.2 第 6 条明确保留）**：**面积律**（面板内容逐节点不变、仅视口 2.84× ⇒ 抖动 0 → 6.5–20 帧/相）、**静态逐行确证**（遮罩面积 = 面板 ×2.03→×5.76、无跳过门的全视口 `background-image` 重写）、**像素差证据**（§6，与仪器口径无关）、**溯源复核**（§3）、以及**候选件的字节级改动**（§1）**全部与本次仪器裁决无关**。

### 0bis.8 与 `incident2/instrument-tiebreak` 的关系（**诚实说明**）

在开工后我发现**该线已先期完成了同一仲裁**（`incident2/instrument-tiebreak`，2026-09-22 12:27，152 格 5×5 矩阵 + 独立对抗复核 `verify-independent.md`），其结论与我的 §0bis.6 **一致**（播种/时钟/归属三机制；帧通道在前台有效而线 B 的零是口径产物）。
**我没有把它的结论当作前提**：上面每一条都在**我自己的器械、我自己的探针、我自己的页面**上重新测过并给出原始数字（第 0bis.2–0bis.5 节），只在"顶层 `eval` 注入位置"这一格（本批未测）引用其数据并注明出处。**⇒ 本闸门结论不依赖该线的可信度。**

---

---

## 1. 单元 F1 实施记录

### 1.1 落点定位（真实客户端 bundle）

| 探针 | 结论 |
|---|---|
| 类名 `VOzbGW_mask` 出现在哪 | **只在 1 个存活部署件**：`/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/client.js`（另在死档 `.dsh/profiles-archive/web2-20260915-105429/` 有一份备份，不在任何解析路径上） |
| 插件 | `@deepseek-ai/dsh-client-ui-settings-general` v0.1.1-rc.2 |
| 内联 style 还是 CSS 类 | **CSS 类**。JSX 侧为 `className: SettingsRoot_module_css_default.mask`（第 116 行）；CSS 侧由 bundle 内 `const css$3 = "…"`（第 28 行）经 `document.createElement("style")` + `dataset.pluginCss` + `document.head.appendChild(tag)` **运行时注入**。元素本身没有 `style` 属性 |
| 确切位置 | **第 28 行，第 704 列**（该行是一条 2829 字符的压缩 CSS 字符串） |
| 原规则 | `.VOzbGW_mask{background:var(--dsw-alias-bg-mask-1);backdrop-filter:var(--dsw-mask-blur);position:absolute;inset:0}` |
| 锚点唯一性 | 该**整条规则**在文件中出现 **恰好 1 次**；`.VOzbGW_mask{` 也恰好 1 次；全文件**仅此 1 处** `backdrop-filter` |

> **全 settings 插件族的完整性**：`dsh-client-ui-settings / -general / -models / -plugin-inventory / -plugins` 五个 bundle 里，`backdrop-filter` **总共只出现 1 次**，就是本条。且遮罩由 `SettingsRoot`（弹窗**外壳**）无条件渲染，8 个栏目都渲染进面板内的 `settings.section` slot ⇒ **这一处删除同时覆盖全部 8 个栏目 + OPEN + CLOSE 相**。

### 1.2 改动内容

**删除**（37 字节，位于规则内 `background` 与 `position` 之间）：

```
backdrop-filter:var(--dsw-mask-blur);
```

改前 → 改后：

```css
.VOzbGW_mask{background:var(--dsw-alias-bg-mask-1);backdrop-filter:var(--dsw-mask-blur);position:absolute;inset:0}
.VOzbGW_mask{background:var(--dsw-alias-bg-mask-1);position:absolute;inset:0}
```

**字节级证明**（`preimage/client.js.pre` vs `candidate/client.js`）：首个差异字节在偏移 **2118**，公共后缀 **24475** 字节，删除段恰为 `'backdrop-filter:var(--dsw-mask-blur);'`（37 字符），插入段为空。**没有任何其它字节被改动或插入。**

**不改的东西（明确声明）**：
- 遮罩的 `background:var(--dsw-alias-bg-mask-1)`（亮色 `#0000003d` / 暗色 `#00000080`）**原样保留** ⇒ 弹窗仍然变暗背衬；
- 遮罩的 `position:absolute; inset:0`、`aria-hidden="true"`、`onClick: onClose` **原样保留** ⇒ 点击遮罩关闭的行为不变；
- **不改** `--dsw-mask-blur` 令牌（理由见 §2.2）；
- 不改任何 JS 控制流、不新增 DOM / CSS 规则 / 类名。

### 1.3 从"删除一条 CSS 属性"看副作用面（逐条排除）

| 潜在副作用 | 判定 |
|---|---|
| 层叠上下文 | `backdrop-filter≠none` 会创建层叠上下文。但 `.VOzbGW_mask` **没有子元素**，其兄弟 `.VOzbGW_panel`（`z-index:1; position:relative`）不受其影响 ⇒ 删除后**无可观测变化** |
| `position:fixed` 包含块 | `backdrop-filter` 会成为 fixed 后代的包含块；遮罩**无后代** ⇒ 无影响 |
| 指针事件 | `backdrop-filter` 与指针事件无关；遮罩的点击关闭由 `onClick` 提供 ⇒ 不变 |
| backdrop root / 分层提升 | 遮罩不再被提升为独立合成层。**这正是去除重合成代价的机制所在**；上游审计的页内消融已实测该状态**无回归且抖动归零** |
| 圆角 / 投影 | `.VOzbGW_panel` 自身的 `border-radius:24px` 与 `box-shadow:var(--dsw-shadow-lv3)` **未动** |

---

## 2. 三条等价路径的选型论证（**选实现风险最低的一条**）

### 2.1 结论：选 (a)

| 路径 | 实现风险 | 判据（已静态确证） |
|---|---|---|
| **(a) 改为纯 rgba 变暗** ✅ | **最低** | 一条 37 字节声明删除；无 JS、无动画、无新 DOM；不动共享令牌；字节可验证；`cp` 即回滚 |
| (b) 仅在开合动画期间启用 blur | **最高** | **设置弹窗 CSS 里根本没有动画**：该 2829 字符的模块 CSS 中 `animation` = **0** 处、`transition` = **0** 处、`@keyframes` = **0** 处、`@media` = **0** 处。选 (b) 等于**在压缩 bundle 里新写一套动画状态机**（新增行为、新增生命周期、新增失败模式）。且上游审计实测 `open` / `close` 两相在三段里**完全平坦（3/3/3 帧、无差别）**——恰是 blur 不起作用的地方。**风险最高、收益最低** |
| (c) 把 blur 裁到面板包围盒 | **中高** | 面板不透明（`--dsw-alias-bg-layer-2` → 亮色 `#fff` / 暗色 `#2c2c2e`，**完全不透明**）⇒ 落在面板下方的 blur **本来就看不见**；(c) 去掉的正是面板**外**那一圈的 blur，**可见结果与 (a) 相同**，却仍要为面板下方那片不可见的区域付 blur 代价，还要额外引入 `clip-path` / 包含块技巧。**(a) 严格支配 (c)** |

**(a) 的可见结果 = (c) 的可见结果，且 (a) 更简单、更便宜、更易回滚 ⇒ 选 (a)。**

**"面板不透明"这一前提已单独复核**（它同时支撑 (c) 的否决与 §6 的观感论证）：

| 检查 | 结果 |
|---|---|
| `--dsw-alias-bg-layer-2` 的定义处 | **仅** `dsh-client-ui-theme/lib/client.js`，共 2 处：亮色 `var(--dsw-static-neutral-bluish-00)`、暗色 `var(--dsw-static-neutral-bluish-850)` |
| 端点取值 | `#fff` / `#2c2c2e` —— **均为不含 alpha 的六位十六进制 ⇒ 完全不透明** |
| 是否经由 `--dsw-alias-bg-base`（壁纸插件会把它染成 `rgba(…, opacity)` 半透明） | **否**：`--dsw-alias-bg-layer-2: var(--dsw-alias-bg-base)` 的匹配数 = **0** |
| 其它存活 bundle 是否覆写它 | 其余 10 个文件只**消费**它，无一处**定义**它 |

⇒ **即使设置了壁纸（用户的配置），设置面板依然完全不透明**（壁纸的透明度只作用于 `--dsw-alias-bg-base`，那是遮罩**背后**的底色，不是面板）。因此落在面板下方的 blur **本来就不可见**，(a) 与 (c) 的可见结果一致；而 (c) 仍要为面板下那片不可见区域继续付 blur 代价，并额外需要 `clip-path`/包含块技巧。

### 2.2 为什么不做"更小的改动"：把令牌改成 `none`

`--dsw-mask-blur` 在 **1 处**定义（`@deepseek-ai/dsh-client-ui-theme/lib/client.js:130`，`body{…}` 块内 `--dsw-mask-blur:blur(2px)`），但有 **4 个存活消费者**：

| # | 文件 | 消费者 |
|---|---|---|
| 1 | `dsh-client-ui-settings-general/lib/client.js:28` | `.VOzbGW_mask` ← **本次目标** |
| 2 | `dsh-client-ui-attachment/lib/client.js:382` | `.fNh4Da_mask`（图片灯箱，同样全视口） |
| 3 | `dsh-web-frontend/dist/assets/index-C6eRlFa6.css` | 外壳遮罩 `_mask_15u5s_14`（2 处） |
| 4 | `@local/dsh-btw/lib/client.js:935` | 第三方插件的遮罩 |

⇒ 把令牌改掉会**同时改变 4 个消费者（含一个第三方插件与 shell）**，**远超 F1 范围**。故本次落在**单条规则**上。

---

## 3. 只读审计复核（落地前的硬性前置）

一次性可复现脚本：`tools-mine/recheck-mask-source.mjs`（只读，产物 `raw/recheck.json`）。五项全部 **VERIFIED**：

| 检查 | 结论 |
|---|---|
| `classUniqueness` | **VERIFIED** — 存活树中 `VOzbGW_mask` 只出现在 1 个文件（另有 1 个**死档备份**，已单列不计入） |
| `target` | **VERIFIED (anchor-unique, pre-image state)** — 第 28 行第 704 列，`old=1 / new=0` |
| `servedVsDisk` | **VERIFIED** — `curl` 取 `http://127.0.0.1:3080/plugins/@deepseek-ai/dsh-client-ui-settings-general/client.js?rev=f733efde3f2f` ⇒ **26630 字节，sha256 `9298ac5b…`，与磁盘文件逐字节相同** |
| `revVerification` | **VERIFIED** — 模块加载器内 `crypto.subtle` / `sha256` / `digest(` / `integrity` 命中数 **0**；`rev` 仅作身份标识 ⇒ 改文件/替换字节均**不被拦截** |
| `blurToken` | **VERIFIED** — 1 处定义，**4 个存活消费者**（见 §2.2） |

**⇒ 热面确证：** 改动落在客户端 bundle，**刷新即生效**；本次定位**没有**落在需要重启的宿主侧，故无需停下上报。

### 3.1 归因可靠性复核（审计探针选到的到底是不是这个节点）

上游审计用 `document.querySelector('div[class$="_mask"]')` 定位遮罩。若该选择器命中的**不是** `VOzbGW_mask`，F1 就会打在错的节点上。静态复核结果如下（**选用正确的**）：

| 方案 | 类名形态 | `[class$="_mask"]` 是否命中 |
|---|---|---|
| settings 插件（`VOzbGW_` 前缀式） | `VOzbGW_mask` | ✅ **命中** |
| attachment 灯箱 | `fNh4Da_mask` | ✅ 命中（但设置流程中未打开） |
| attachment 拖放层 | `BInVoG_mask` | ✅ 命中（同上） |
| web-frontend shell/primitives（`_name_hash` 式） | `_mask_15u5s_14` | ❌ **不命中**（类属性结尾是 `_14`） |
| onboarding 遮罩 | `_onboardingMask_1cfrq_10` | ❌ 不命中（结尾 `_10`） |
| 聊天灯箱遮罩 | `SalQ5q_lightboxMask` | ❌ 不命中（结尾是 `Mask`，大小写不符） |

⇒ 本项目里两套 CSS-module 命名法并存（`PREFIX_name` 与 `_name_hash`），上游探针的选择器**恰好只对前者成立**，因此在设置弹窗打开时它命中的正是 `VOzbGW_mask`；而全文档中同时最多只有一个 `*_mask` 这类弹窗层处于打开态。**归因成立。** 该结论已请器械档在运行时用"枚举全部非 none 的 backdrop-filter 元素"独立复核（见 §5）。


---

## 4. 补丁脚本契约与自测

`apply-Mask-v1.mjs`（**已冻结**，sha256 `843be47d…`）：dry-run 默认、`--apply` 才写、**锚点唯一命中才写**、preflight 全或无、自动 pre-image + sha256 manifest、`node --check`（**同时按 CJS 与 ESM 解析**）、幂等、`--rollback`（漂移即拒绝）、**逐字节精确**、**保留文件 mode**、**拒绝符号链接目标**、**错误路径输出可读报告**。

> **逐字节精确是本版的核心**：`classify()` 全程在 **Buffer** 上操作（`indexOf` / `subarray` / `Buffer.concat`），**绝不**经 `toString('utf8')` → `Buffer.from(…,'utf8')` 往返；并在写入前**断言**：长度增量恰为 **−37**、锚点**之前**的字节 `equals()`、锚点**之后**的字节 `equals()`、替换段 `equals(NEW_B)`。任一不成立即拒绝。

自测：`node tools-mine/selftest-apply-Mask-v1.mjs --out raw/guardrails.json` ⇒ **37/37 PASS**。
关键点：**每个拒绝用例都断言了"拒绝的具体内部原因"**（而不只是 `refused`），因此不存在"因为别的原因拒绝而被误判为通过"。

| 用例 | 断言 | 结果 |
|---|---|---|
| C01 | 干跑命中唯一锚点 ⇒ `apply`，不写 | PASS |
| C02 / C03 | 锚点出现 2 / 3 次 ⇒ 拒绝，**且子原因 = `anchor-ambiguous(old=2/3)`** | PASS |
| C04 | 锚点缺失 ⇒ 拒绝，子原因 `anchor-missing` | PASS |
| C05 | 已是 post-image ⇒ 幂等 no-op，不写 | PASS |
| C06 | **锚点存在但语法错误** ⇒ `node --check` 拒绝，子原因 `node --check failed on post-image` | PASS |
| C07–C09 | 无关 JS / 空文件 / 二进制 ⇒ 拒绝 | PASS |
| C10 | 路径不存在 ⇒ 拒绝（`target-missing`） | PASS |
| C11 | 目标为目录 ⇒ 拒绝（`target-not-a-regular-file`） | PASS |
| C12 | **OLD 与 NEW 同时存在** ⇒ 拒绝，**且子原因 = `anchor-and-post-image-coexist(old=1,new=1)`** | PASS |
| C13 / C14 | 未知参数 / `--target` 缺值 ⇒ `status=error`、**非零退出、不写** | PASS |
| C15–C19 | 真写 ⇒ `applied`；`--verify` ⇒ `already-applied`；二次 `--apply` ⇒ 幂等且 **sha 不变**；`--rollback` ⇒ 复原为 pre-image；再 rollback ⇒ `already-pre-image` | PASS |
| C20 | 不可写目录 ⇒ `write-denied`，**文件 sha 不变** | PASS |
| C21 | 已存在内容不同的 pre-image ⇒ 拒绝，**目标与已记录 pre-image 均未被覆盖** | PASS |
| C22 | 文件已漂移时 `--rollback` ⇒ 拒绝，文件不变 | PASS |
| C23 | **自测全程未触碰部署目标**：目标仍为 pre-image sha256，mode 664 | PASS |
| **C24** | **非 UTF-8 目标 ⇒ 仍逐字节精确**：`delta == −37` 且锚点外字节完全不变 | PASS |
| **C25** | **manifest 无此目标时 `--rollback` ⇒ 拒绝**，且**绝不改写外来文件** | PASS |
| **C26** | **符号链接目标 ⇒ 拒绝**，链接与真实文件均未被破坏 | PASS |
| **C27** | **文件 mode 在 apply 与 rollback 后均保留** | PASS |
| **C28** | **同名不同目录的两个目标不冲突**（pre-image 槽位互不覆盖） | PASS |
| **C29** | 错误路径 ⇒ 输出 `status=error` 的 JSON 报告 + 非零退出（不是裸栈） | PASS |
| **C30** | `--target --apply` ⇒ 不再把 flag 吞成路径，非零退出 | PASS |

### 4.2 独立对抗审查的发现与修复（**如实记录**）

另派一档对本脚本做对抗审查（25 项攻击 + 3 组序列，全部在 `raw/adversarial/adversarial.md`）。**6 条溯源主张全部存活**，但脚本契约**被攻破**，发现如下缺陷——**全部已修复，并已各自纳入回归用例**：

| # | 严重度 | 缺陷（针对旧版 `90527646…`） | 修复 | 回归用例 |
|---|---|---|---|---|
| **D1** | **致命（潜在）** | `classify()` 经 `toString('utf8')`→`Buffer.from(str,'utf8')` 有损往返且**无守卫** ⇒ 目标含非法 UTF-8 时，**在离锚点很远的地方偷偷改写**，却报 `status=applied, wrote=true`（复现：delta **−29 而非 −37**，并多出 4 B→12 B 的替换） | 改为纯 Buffer 拼接 + 提交前四条逐字节断言 | **C24** |
| D2 | 中高 | `runRollback` 的 `\|\| man.entries[0]` 回退 ⇒ 可把**别个目标**的 pre-image 写进来（仅凭内容哈希把关） | 去掉回退；必须存在 `target` 完全匹配的条目 | **C25** |
| D3 | 中 | `statSync` 跟随符号链接 + `renameSync` ⇒ **符号链接被替换成普通文件**，却报成功 | 改用 `lstatSync`，符号链接直接拒绝 | **C26** |
| D4 | 中 | `atomicWrite` 硬编码 `mode: 0o644` ⇒ 部署文件 **664 → 644**，rollback 也不复原 | 记录 pre-image mode 并在 rename 前 `chmod`，rollback 同样还原 | **C27** |
| D5 | 轻 | pre-image 槽位名不唯一（`basename(dirname(dirname(t)))`+basename）⇒ 同名目标被误判为"pre-image 冲突" | 槽位名与 manifest 名带目标解析路径的 12 位哈希 | **C28** |
| D6 | 轻 | `--target --apply` 把 flag 吞成路径 | `parseArgs` 拒绝以 `--` 开头的取值 | **C30** |
| D7 | 轻 | 5 条路径抛未捕获异常、**不打印任何报告** | 顶层 try/catch ⇒ `status=error` + 非零退出 | **C29** |
| — | 表述 | "跨多目标全或无"**结构性空洞**（`const targets = [args.target]`，CLI 无法传第二个目标） | **撤回该表述**：改为"preflight 对目标列表全或无；部署规格只有一个目标，故写入即单次原子 rename"，**不再称其为多目标已测保证** | — |

> **诚实边界**：上述 D1–D7 是**针对修复前的脚本**由独立档发现的，修复由**本档**完成。**第二轮独立复验（针对冻结版 `843be47d…`）已确认 D1–D5 修复全部有效、且零回归**（含"语法门仍在任何 pre-image 写入之前触发"这一关键顺序），并复算了 C5：新脚本产出的字节与候选件 `bd7edeae…` **完全一致**。

### 4.3 第二轮独立复验的新发现与修复

第二轮复验在**确认修复有效**的同时，又发现 **2 个新缺陷**（均为安全方向失败，但其中一个与部署形态直接相关）⇒ **本档再次全部修复**：

| # | 严重度 | 缺陷（针对 `843be47d…`） | 修复 | 回归用例 |
|---|---|---|---|---|
| **N2** | **中（与部署直接相关）** | **路径身份不一致**：`targetKey()` 经 `realpathSync` 归一并名，但 `entry.target` 匹配用的是**字面字符串**。实测**本部署正是这个形态**：`~/.npm-global/…/client.js` 与 `~/.dsh/profiles/node_modules/@deepseek-ai/…/client.js` 是**同一 inode 31346199**，`targetKey` 同为 `7873f2aa89b0`，但字符串不同 ⇒ **用一个拼写 apply、用另一个拼写 rollback 会静默失去回滚能力** | 新增 `resolveTargetPath()`：解析**目录**符号链接但**保留最末段原样**（避免把 D3 的符号链接拒绝一起废掉），并在 `main()` 里对 `args.target` **一次性归一**，使 apply 与 rollback 共用同一身份串 | **C31** |
| **N1** | 轻 | `targetKey()` 的 `realpathSync` 在父目录不存在时**抛异常** ⇒ `--rollback` 报 `error`/exit 2（而非 `refused`） | `realpathSync` 加兜底，绝不抛 | **C32** |
| **N3** | 轻 | `classify()` 的 `readFileSync` 无守卫 ⇒ 存在但不可读的目标报 `error`/exit 2 | 加守卫 ⇒ `refused` + 子原因 `target-unreadable (EACCES)` | **C33** |
| **N4** | 轻 | `--emit` 写到不可写目录时**丢弃整份 dry-run 报告**（`delta` / `wouldBeSha256` 丢失） | `--emit` 块加 try/catch，失败时附 `emit:{failed,code,reason}` 并**保留报告主体** | **C34** |

**同时被独立档证伪/澄清的两条（如实记录）：**
- 复验档自曝其 harness 有一处**误判**：`V05j_dryrun_no_write` 被它标为 `STILL-BROKEN`，实为其判据 `status=='refused'` 不适用于 dry-run；实际为 `status=apply, wrote=false, files changed: NONE` ⇒ **本脚本无此问题**。
- 关于 D6：本档实测"无名为 `--apply` 的文件时"为 `refused`/exit 1；复验档创建了**真实存在**的名为 `--apply` 的文件，从而得到 `status=apply`/exit 0。两者是**不同 fixture**，非矛盾。两种情形现均被 C30 覆盖（`--target` 已拒绝以 `--` 开头的取值）。

> **冻结值变更说明（供第三方复核）**：独立档验的是 `843be47d…`（30/30 自测）；此后本档为 N1–N4 又修改了脚本，当前冻结版为 **`c2f04a48…`（37/37 自测）**。**候选件 `bd7edeae…` 与 pre-image `9298ac5b…` 在四次脚本改写中均逐字节未变**（每次改写后均重新 emit 并比对）。针对 `c2f04a48…` 的最终一轮独立复验已发出请求；若未在交付窗口内返回，则该项在本报告 §7 记为"**未独立复验**"。

### 4.4 第三轮独立复验的新发现与修复

第三轮复验确认 **N1–N4 修复全部有效、零回归**，同时发现 **3 个新缺陷**（根因相同：**`runRollback` 缺少 `classify()` 那样的目标类型守卫**）⇒ 全部修复：

| # | 严重度 | 缺陷（针对 `9a8ca4b9…`） | 修复 | 回归用例 |
|---|---|---|---|---|
| **R0** | 中 | **`runRollback` 完全没有目标类型守卫**：apply 之后若该**路径**变成符号链接，`existsSync`+`readFileSync`+`atomicWrite` 会**跟随并替换链接** ⇒ 报 `rolled-back`/`wrote=true`，**链接被摧毁成普通文件**，而链接指向的真实文件**仍是 post-image、从未被还原**（即 D3 症状经 rollback 重现）。漂移门把它限制在"链接内容恰为 post-image"这一情形，故为"中"而非"致命" | 在 `runRollback` 入口先用 `lstatSync` 做与 `classify()` 相同的类型判定：符号链接 ⇒ 拒绝；已存在但非普通文件 ⇒ 拒绝 | **C35** |
| **R1** | 轻 | `runRollback` 的 `readFileSync` 无守卫 ⇒ 目标不可读（`EACCES`）或变成目录（`EISDIR`）时报 `error`/exit 2 | pre-image 读与目标读均加守卫 ⇒ `refused` + `target-unreadable (CODE)` / `target-not-a-regular-file` | **C36 / C37** |
| **R2** | 轻 | `--emit` 失败时**退出码仍为 0**，而请求的文件并未产出（`--emit … && cp …` 会在无文件的情况下继续） | `--emit` 失败时返回 **exit 3**（与"拒绝"的 exit 1 区分） | 扩展 **C34** |

**独立档同时自曝其 harness 有 5/7 处误判**（期望哈希取错、断言顶层 `reason` 而非 `detail[0].reason`、一处 `NameError`），修正后全部 PASS——**仅 R0/R1/R2 归因于脚本**。本档对此如实记录，以免把测试侧的噪声算作脚本缺陷。

> **修复后的收敛判断（本档自裁）**：R0/R1 只在"目标在 apply 与 rollback 之间改变了磁盘类型"时才可触发，**部署流程（普通文件全程保持普通文件）不受影响**；R2 为退出码细节。三者均已修复并有断言回归用例覆盖（C34–C37）。



> **D1 对本次交付的实际影响 = 零**：部署目标经独立档验证为**严格 UTF-8**，且我方 C5 的逐字节结论（恰好一处 37 字节删除、候选件 `bd7edeae…`）在**重写后的脚本**上重新生成并逐字节比对**完全一致**。即该缺陷虽致命，但在本场景下**不改变任何交付字节**。


**关于 deployed 写入**：本档沙箱对部署路径的 `--apply` 实测为
`EACCES: permission denied, open '…/lib/.client.js.maskv1.tmp'` ⇒ `status=write-denied`、`wrote=false`、**未产生任何残留临时文件**，部署文件 sha256 未变。写入按分工交协调者执行，步骤见 `DEPLOY.md`。

---

## 4bis. 器械发现（本轮独立发现，**削弱上游审计的两条有效性主张**）

产物：`raw/instrument-findings.json`。两条都源于同一个环境事实：

> **`readlink("/proc/<pid>/exe")` 在本环境对几乎每一个进程都返回 EACCES** —— 只有沙箱命令**自己的直接 shell 子进程**可读。逐一实测：用户 Chrome（494362）、snap Firefox（547226）、dsh 宿主（301709）、gnome-shell（4139）、systemd --user（3736）、以及兄弟线进程，**全部 EACCES**。

### I1（高危）共享探针锁的判活判据不成立 —— **本可摧毁存活兄弟档的锁**

继承来的判据是 `alive = try { readlinkSync('/proc/<pid>/exe') } catch { false }`。由于该 readlink 对**存活**进程抛 EACCES ⇒ 判成 `alive:false` ⇒ `acquire` 走回收分支 `rm owner.txt && rmdir`。

**同一时刻的活体反例：**

| 项 | 值 |
|---|---|
| 锁持有者 | **PID 591877** |
| 真值 `/proc/591877/stat` | state = `S`/`R`（存活） |
| 真值 cmdline | `node runners/matrix.mjs --engine chrome153 --mode all --run chrome153 --reps 5` |
| 身份 | **兄弟线 `.workspace/lag-fix/incident2/instrument-tiebreak` 正在跑 5 rep**，且其 Chrome 子进程（591889）存活 |
| **旧判据结论** | **`alive: false`（错误）** ⇒ 会执行回收 |
| **修正判据结论** | `alive: true` ✔ |

本档 `campaign.sh` 当时**尚未执行首次 `acquire`**（`logs/` 为空），故删除**尚未发生**。器械档已于 12:15:32 独立发现并修好（`/proc/<pid>` 存在 + `stat` state ∉ {Z,X} + `cmdline` 非空；EACCES 一律**按存活处理**）。

> **⇒ 对上游的责任归属修正**：审计 §1.1 把那次锁事故归因于"`owner.txt` 多行 + shell 命令替换切分"。那是**诱因**，但**不是根因**——即使解析完全正确，**判活判据本身在此环境下也不成立**。任何以 `/proc/<pid>/exe` 判活的工具都会把存活 owner 判死。**这条必须广播给所有兄弟线**，并且**没有"死亡的确证"就绝不回收**。

### I2（高危，直接落在审计的"干净机器"主张上）"静默门 / foreign=0" 是**空洞输出**，不是测量

继承的 `census()` 用 `readlinkSync(exe)` 认定进程身份且 `catch { continue }` ⇒ 跳过所有进程。同一时刻实测：

| 判据 | 结果 |
|---|---|
| 旧 `census()`（exe-only） | **total = 0** |
| 修正 `census()`（cmdline） | **total = 32** 个浏览器主进程 |

⇒ 审计 §1.1 的"静默门秒过（waited 2–3 ms，**foreign=0**）… **未发生并发污染**"这一保证**不成立**：`foreign=0` 是**结构性必然输出**，该门在任何情况下都看不到浏览器。**"机器是安静的"这一条应撤回**（这不证明污染发生过，只证明该器械无法发现污染）。

> **处置（按协调者裁决登记）**：**撤回保证，不撤回结论。**
> - **撤回**：该批"**机器安静**"这一**保证未被确立** —— `foreign=0` 是结构性必然输出，该门无法发现污染。
> - **不撤回**：**A-B-A 结论本身不受影响**，因为它建立在**同 rep 相邻配对**上，对同环境负载稳健（审计亦记录其 A-B-A 三批在 loadavg 6.6–9.8 下仍给出干净配对；本档 §5.5 的 bridge 亦在 `foreign=14–17`、`loadavg 2.4–2.9` 下给出 3/3 rep 一致的零）。
> - 本档**从不**把"0 long tasks"或"机器安静"当作"不卡"的依据；所有判据只用同 rep 相邻臂配对，并逐 rep 记录真实 `foreign` 与 `loadavg`。

**本线的应对**：不把 `foreign=0` 当作有效性主张；改为**逐 rep 如实报告**修正后 census 的 foreign 计数与 `/proc/loadavg`；判据只用**同 rep 相邻臂配对**；**绝不**对任何浏览器发信号。

### I3（信息）兄弟线正在占用锁

锁由兄弟线持有（见 I1），且本机另有用户真实 Chrome 与 snap Firefox。⇒ **`foreign=0` 在本线不可达**，本线按 I2 的应对执行；若锁长期不可得，只报告可测部分并标注未验证，**不抢锁**。

---

### I1bis 处置：**已改用全组统一实现 `lib/probe-lock.mjs`**（协调者第 1 条）

- 本档 `tools/lock.mjs` 的存活判据**改为直接 import 并委托** `.workspace/lag-fix/lib/probe-lock.mjs` 的 `state()`（**全树只有一个判活实现**）。
- `owner.txt` 改写为**该文件的单行 `key=value` 格式**（`agent=… pid=… owner_pid=… started_at=… purpose=…`），并改为 **tmp + rename 原子落盘**，消除"目录已建但 owner 未落盘"的窗口。
- **等价性核验（本档实测）**：对用户 Chrome 494362、snap Firefox 547226、dsh 宿主 301709、gnome-shell 4139、本进程 → 共享判据一律 **ALIVE**；对不存在的 pid、以及**真实僵尸**（`fork()` 后不 `wait()`，`/proc/<pid>/stat` 状态 `Z`）→ **DEAD**。⇒ **只有"死亡确证"才 DEAD，任何读取失败（含 EACCES）一律 ALIVE**，与协调者规格一致。
- **跨线互操作已实测**：本档写的锁，共享库自己的 `inspect()` 能正确读出 `liveness: "ALIVE"`、`agent`、`pid`、`purpose`。
- **一处刻意的语义差异（保留）**：共享库的 `release()` 要求 `owner.pid === process.pid`（同进程释放），而本档 `campaign.sh`/`bridge-arms.mjs` 的包装模式需要记录**长命包装进程**的 pid、从一个**短命** `node lock.mjs release` 进程释放。故本档保留自己的 release（且**更严**：必须显式 `--owner-pid` 匹配才释放），仅将**判活**统一到共享实现。**若有需要，可把包装模式的 pid 记录改为由包装脚本自身 acquire/release，从而完全使用共享库的 API。**

---

## 5. 真跑证据（同器械 2560×1440@DSF2 等）

### 5.0 器械与设计（与审计同器械、同相名，可比）

| 项 | 值 |
|---|---|
| 浏览器 | 真实 Google Chrome（Playwright `channel:'chrome'`，headless），`--no-sandbox --disable-dev-shm-usage --force-renderer-accessibility` |
| **引擎与版本（UA 读回，不靠推断）** | **Blink / Chrome 153.0.8010.52**（`navigator.userAgent` 逐 rep 读回，见 §5.5.1）。⇒ 规则 19 的 **Gecko 陷阱不适用** |
| 视口 | **主臂 2560×1440 @ deviceScaleFactor 2**（用户真实窗口尺寸）；护栏臂 1440×900@2 |
| 每 rep | 全新 context（`locale:'zh-CN'`），跑完整 35 相序列（相名与审计一致） |
| 臂设计 | 同 rep 内**连续**跑 `normal`（原样）→ `patch`（**route 用候选件字节应答**）→ `normal2`（原样） |
| 判据 | **只用同 rep 相邻臂配对**，不做跨批绝对比较（审计已证实该设计与环境负载稳健） |
| rep 数 | **3**（每次独立调用跑一个 rep，单个 rep 失败不拖垮整批） |

**候选件是真送达的**，不是页内样式 hack——`patch` 臂每次都由 `context.route()` 用**候选件字节**应答该 bundle：

| 臂 | 实际送达字节 sha256 | 拦截次数 | 遮罩上计算出的 `backdropFilter` |
|---|---|---|---|
| `normal` / `normal2` | `9298ac5b0870…`（= pre-image 文件） | 0 | `blur(2px)` |
| `patch` | **`bd7edeaec382…`（= 候选件）** | 2 | **`none`** |

### 5.1 V1 阳性对照（**通道有效性前提**）—— **PASS（9/9 臂实例）**

页内注入 120 ms 同步忙等（注入在测量窗口**之内**）：

| 指标 | 实测 |
|---|---|
| `POSCTL_120` frameMax | **99.9 – 116.7 ms**（全部 9 个臂实例） |
| 同一相的 **`longtaskCount`** | **0** |

⇒ **帧通道有效**（120 ms 阻塞被如实报成 ~100–117 ms 帧间隔），并**独立复现了审计的器械事实：LongTask 对页内注入的忙等完全失明（0 条）**。因此本报告所有"0 个 >50 ms 帧"是**有效阴性证据**，而**任何"0 long tasks"都不被用作"不卡"的依据**。

### 5.2 主判据 —— **达标（3/3 rep）**

**30 个"弹窗内相"**（排除 `IDLE_BASE` / `CLOSE` / 三个 POSCTL）逐相汇总：

| run | 臂 | Σ 帧数 >50 ms | Σ LoAF | 单相 frameMax 最大 | 单相 p95 最大 |
|---|---|---|---|---|---|
| 04:22:54Z | `normal` | **961** | 1043 | 116.8 ms | 100.0 ms |
| 04:22:54Z | **`patch`** | **0** | **0** | **16.8 ms** | **16.8 ms** |
| 04:22:54Z | `normal2` | 97 | 99 | 99.9 ms | 66.7 ms |
| 04:28:53Z | `normal` | 96 | 97 | 99.9 ms | 66.7 ms |
| 04:28:53Z | **`patch`** | **0** | **0** | **16.8 ms** | **16.8 ms** |
| 04:28:53Z | `normal2` | 103 | 104 | 83.4 ms | 66.7 ms |
| 04:34:47Z | `normal` | 99 | 101 | 83.4 ms | 66.7 ms |
| 04:34:47Z | **`patch`** | **0** | **0** | **16.8 ms** | **16.8 ms** |
| 04:34:47Z | `normal2` | 95 | 98 | 83.4 ms | 66.6 ms |

**⇒ `patch` 臂在 2560×1440 的 3 个 rep × 30 个弹窗内相 = 90 个相中，`framesGt50` 全部为 0，`p95` 全部为 16.7–16.8 ms（恰一个 vsync），LoAF 全部为 0。**

> **读法（按 §0bis 闸门改判）**：本节以 **LoAF 为主判据**（`loafCount`/`loafMax`），`framesGt50` 只作**相对 KPI**。
> - 主判据：`patch` **90/90 相 `loafCount` = 0**；对照臂 Σ LoAF 97–1043、单条 `duration` 达 **92.5–110 ms** ⇒ **合成器动画帧预算零超支 vs 明显超支**。
> - 绝对帧值偏低：我的探针用 rAF **`ts` 参数**、且 `POSCTL_120` 走顶层 `evaluate` 任务 ⇒ 预期读数正是 `ts ≈ GT − 20 ms`，与我实测 **99.9/100.0/116.7** 同型（§0bis.5 第 3 条）⇒ **`frameMax` 绝对数系统性偏低，`16.8 ms` 是下限**。
> - 窗口可用性自證（仲裁 rule 2）：**每窗口帧数 40–89（从不真空）、帧间隔中位 16.7 ms**；唯一不合格的是**调用 1 的 `IDLE_BASE` 对照位（66.7 ms / 1–2 帧 >50）** ⇒ 依规则把调用 1 的 `normal`（1043/961）判为环境噪声偏高。

**同 rep 逐相配对（器械档权威口径）**：`normal`→`patch` 配对的 **76 / 76** 个"原本有抖动"的相位实例**全部归零**（总帧数 **1156 → 0**，单相 frameMax **116.8 → 16.8 ms**，LoAF **1241 → 0**）；反向 `patch`→`normal2` 则 **0 → 295 帧**（frameMax 16.8 → 99.9 ms，LoAF 0 → 301）⇒ **抖动在移除补丁后完整回归**。另有 **30 个相标签中有 23 个**在全部 6 个未打补丁的臂实例里都抖、在补丁臂里**一个都不抖**。
**主判据（>50 ms 帧 = 0 且 p95 ≤ 16.8 ms）与副判据（LoAF ≈ 0）在用户真实窗口尺寸下同时达标。**

`IDLE_BASE` 与 `CLOSE`（弹窗未开/已关）在所有臂均 ≈0 ⇒ 抖动**专属于"弹窗开着 + 交互"**，与审计一致。

### 5.3 A-B-A 复原（**必须分开如实陈述**）

| run | `normal` | `patch` | `normal2` | A-B-A 判读 |
|---|---|---|---|---|
| 04:22:54Z | **961** | 0 | 97 | ⚠️ **部分复原**：`normal2` 仅为 `normal` 的 **10 %** |
| 04:28:53Z | 96 | 0 | 103 | ✅ **良好对称**（96 ↔ 103） |
| 04:34:47Z | 99 | 0 | 95 | ✅ **良好对称**（99 ↔ 95） |

**3 个 run 中有 2 个呈良好 A-B-A 对称；第 1 个 run 的 `normal` 臂异常偏高（961，约为其自身 `normal2` 的 10 倍）。**

该异常有**器械内部的独立旁证**，不能简单视为"效应不稳定"：
- 该 run 的 `IDLE_BASE` = **1 帧**（其余 run 为 0）；
- 该 run 的 **`POSCTL_120_inpanel` = 13 帧 / frameMax 150 ms，而其余全部 8 个臂实例均为 1 帧 / 116.6–116.8 ms** —— 阳性对照本身在该 run 的窗口内被外来负载显著放大；
- 该 run 起始 `loadavg` 最高（4.29 vs 3.30 / 3.13）。

**对第 1 个 run 的解释必须留有余地（器械档的独立记账修正了本档的初判）**：器械档实测调用 1 的 `IDLE_BASE` 在**三个臂上都是 1 帧**（调用 2/3 为 0），即该污染**同时命中三个臂**，因此"只有 `normal` 被污染"这一说法**不足以解释**该 run 的 `normal`(961) 与其 `normal2`(97) 之间 10 倍的差距。**两种解释都未被排除**：(i) 环境负载集中在 `normal` 窗口；(ii) 顺序/冷启动效应。

**必须披露的设计局限**：**臂顺序未做平衡（counterbalance）**——`patch` 恒在中间。器械档据此论证了补丁效应不可能是纯顺序效应（因为若为单调顺序效应，`normal2` 应更高，而实际 `normal2` ≈ `normal`），但**未能排除**顺序混杂。

⇒ **因此本报告把 A-B-A 的最强证据放在 §5.5 的 bridge 臂**（那是完整的三段设计，`NORMAL`/`ABLATED`/`NORMAL2` 数值逐位复原：`17/83.4/66.7 → 0/16.8/16.7 → 17/83.4/66.7`），而**不依赖** mask2k 第 1 个 run 的 `normal` 绝对值。**关键点：无论在哪个 run、哪种解释下，`patch` 臂始终为 0。**

### 5.4 护栏：`click→首次变化`（基线 **16.65 ms**）—— **⚠️ 两种读法矛盾，并列交裁决**

**读法一（汇总中位，判为未达标）**：每臂 15–16 个可测相的中位数：

| run | `normal` 中位 | **`patch` 中位** | `normal2` 中位 |
|---|---|---|---|
| 04:22:54Z | 15.9 | **17.0** | 16.3 |
| 04:28:53Z | 16.0 | **17.8** | 16.5 |
| 04:34:47Z | 16.0 | **17.6 / 18.05** | 16.8 |

三个 `patch` 中位**均略高于审计基线 16.65 ms** ⇒ 按事前注册的护栏判据（"不得劣化"）**判为未达标**。

**读法二（同相配对检验，未见系统性偏移）**：器械档对 2560×1440 做了**逐相配对** `delta = patch − normal`：

| 指标 | 实测 |
|---|---|
| 各 run 配对 delta 中位 | **−0.5 / +0.5 / 0.0 ms** |
| 池化符号统计 | 24 正 / 19 负 / 2 零（n=45），**符号检验 p ≈ 0.53** |
| 1440×900 配对 | normal 16.2/16.7/16.3 vs patch 16.8/16.4/16.6 ms ⇒ **±0.2 ms 以内** |

⇒ **按同相配对，未见可归因于补丁的系统性偏移。**

**两读法为何矛盾（本档分析）**：`c2f` 只在 15–16 个**导航相**上非空，且 `patch` 臂在个别 run 上多出 1 个可测相（n=16 vs 15）⇒ **两臂的"中位数"并非在同一相集合上计算**，故"汇总中位"的可比性弱于"逐相配对"。**逐相配对是统计上更正确的口径**；但护栏判据是**事前注册**的，因此本档**不擅自改判**，**两种读法并列上报**。

**器械档的结论（采信但注明口径）**：**"不主张 2560×1440 下基线已满足"**，但主张**"未见可归因的劣化"**（no attributable degradation）。

- **必须更正的离群**：先前本档把 `patch` 臂 `c2f` 最大值 **2146.9 ms** 记为疑似宿主级停顿。器械档查明：**该值出现在 `CLOSE` 相，而 35 个 `CLOSE` 实例中有 34 个因 observer target 已 detach 而报 null** ⇒ 它是**观测器脱离导致的测量伪影，不是真实停顿**；`c2f` 中位数统计**已排除 `CLOSE`**。**本档此前对该离群的归因有误，在此更正。**
- **需要协调者裁决**：以"首次变化晚约 1–2 ms（汇总口径）/ 无系统性偏移（配对口径）"换"2560×1440 下 **1156 → 0** 个 >50 ms 帧"，是否可接受。本档**不自行拍板**。

### 5.5 桥接对照（bridge）：**双通道（LoAF + wall-clock）+ 批内自證 —— 结论：仅去 blur 已足够，scrim 不必纳入候选**

**为什么要做**：审计的"jank → 0"臂**同时移除 blur 与 scrim**（`background='transparent'`），而 F1 候选**保留 scrim** ⇒ 候选**严格弱于**审计臂。**不得用审计臂的数字给"仅去 blur"背书**（协调者第 4 条）。
**按规则 19/20 执行**：本批**主判据 = LoAF**（读 `duration`）、**副判据 = wall-clock rAF 间隔**（回调入口 `performance.now()`，**不是 `ts` 参数**）；**不以 LongTask 为立柱**；`framesGt50` **只作相对 KPI**（分辨下界 ≈40–50 ms）；前台状态由**显式帧率探针**确认，**不用 `visibilityState === visible` 当"帧在产出"的证据**。数据：`raw/bridge/bridge-*.json`（最新一批含 `selfCert`）。

#### 5.5.1 批内自證（规则 19 要求"每批都要带"；3 个 rep 全部通过）

| 检查 | rep1 | rep2 | rep3 |
|---|---|---|---|
| 引擎（UA 读回） | Blink **Chrome 153.0.8010.52** | 同 | 同 |
| 前台帧率（显式探针，**非** visibilityState） | **63.2 Hz** | **65.0 Hz** | **63.2 Hz** |
| trace 含 `disabled-by-default-devtools.timeline` 时 **`RunTask` 条数** | **13,191**（事件 61,884） | **13,276**（61,549） | **13,391**（62,036） |
| **`none` 阴性对照（3 s 不注入）** | frames **180**、中位 16.7 ms、max **16.9**、`gt50=0`、**LoAF=0**、**LongTask=0**、**RunTaskMax=0 ms** | 180 / 16.7 / **16.8** / 0 / **0** / **0** / **0 ms** | 180 / 16.7 / **16.9** / 0 / **0** / **0** / **0 ms** |
| **阳性对照：页内 `setTimeout` 回调内忙等 120 ms**（合规，**非** CDP evaluate） | **RunTask GT = 120.51 ms**；wall **134.6**；`ts` 116.7；**LongTask = 1 条 = 120 ms**；LoAF 1 条 134.6 ms | **GT = 120.52 ms**；wall 131.6；`ts` 100.0；LongTask **120 ms**；LoAF 131.5 | **GT = 120.43 ms**；wall 131.1；`ts` 100.0；LongTask **120 ms**；LoAF 130.9 |

⇒ **四通道对同一个 120 ms 块全部检出**，且**主判据 `RunTask` 与 wall-clock 都落在真值量级**；`ts` 依旧低报（100.0/116.7），**与本批结论无关（结论不使用 `ts`）**。阴性对照四项全零 ⇒ 通道"无事时安静"，**不自造读数**。

#### 5.5.2 四臂（同 rep 内连续；模态框全程打开，故消融不会被重建抹掉）

| 臂 | blur | scrim | 实现 |
|---|---|---|---|
| `normal` | ON | ON | 服务 pre-image 字节 |
| **`blurOnly`（= F1 候选）** | **OFF** | **ON** | **route 用候选件字节应答真实 bundle URL**（真修复，非样式 hack） |
| `scrimOnly` | ON | **OFF** | pre-image 字节 + 页内消融 `background:transparent`（**blur 保留**） |
| `both`（= 审计臂） | **OFF** | **OFF** | pre-image 字节 + 页内消融 `blur:none` **且** `background:transparent` |
| `normal2` | ON | ON | 服务 pre-image 字节（A-B-A 回归） |

#### 5.5.3 结果（**双通道**，2560×1440@DSF2，3 rep，9 相/臂/rep）

**通道一 · 主判据：LoAF 条目数（9 相求和）**

| rep | `normal` | **`blurOnly`** | `scrimOnly` | `both` | `normal2` |
|---|---|---|---|---|---|
| 1 | 11 | **0** | 12 | **0** | 11 |
| 2 | 11 | **0** | 13 | **0** | 12 |
| 3 | 13 | **0** | 13 | **0** | 11 |
| **Σ** | **35** | **0** | **38** | **0** | **34** |

**LoAF `duration` 总和**：`normal` **1293.1 ms**｜`blurOnly` **0**｜`scrimOnly` **1230.8 ms**｜`both` **0**｜`normal2` **1278.5 ms**

**通道二 · 副判据：wall-clock 帧间隔最大（ms，逐 rep）**

| rep | `normal` | **`blurOnly`** | `scrimOnly` | `both` | `normal2` |
|---|---|---|---|---|---|
| 1 | 83.5 | **18.8** | 79.4 | 21.1 | 82.3 |
| 2 | 80.0 | **21.8** | 78.3 | 19.7 | 83.5 |
| 3 | 82.3 | **19.0** | 77.2 | 19.2 | 84.4 |

#### 5.5.4 结论

1. **F1 候选的收益（双通道给出）**：**LoAF 35 → 0 条 / 1293.1 → 0 ms**；**wall 帧间隔上限 77.2–84.4 → 18.8–21.8 ms**（单 vsync 量级）。两通道同向、量级一致。
2. **仅去 blur 是否达到审计臂量级？—— 是，且是同一个零。** `blurOnly`（保留 scrim）与 `both`（审计臂）**3/3 rep 都是 `LoAF = 0` 条 / `0 ms`**，wall 亦同为 18.8–21.8 / 19.2–21.1 ms ⇒ **不需要把 scrim 纳入候选**。**该结论只由本档自己的同 rep 配对数据支撑，未引用审计臂的数字。**
3. **`scrimOnly` ≈ `normal`**（LoAF 38 vs 35；1230.8 vs 1293.1 ms；wall 77.2–79.4 vs 80.0–83.5）⇒ **scrim 自身不承载可测代价** —— 独立的**归因阳性对照**，把代价唯一钉在 **blur** 上，而不是"遮罩整体"。
4. **A-B-A 完整回归**：`normal2`（34 条 / 1278.5 ms）≈ `normal`（35 条 / 1293.1 ms）。

#### 5.5.5 有效性护栏（全部通过）

| 检查 | 结果 |
|---|---|
| `blurOnly` 真换了候选字节 | 3/3 rep：拦截 **1** 次、`mask.backdropFilter = none`、**注入样式表内 `.VOzbGW_mask` 规则已不含 `backdrop-filter`**（`ruleHasBf=false`） |
| `normal`/`normal2` 未被改动 | 3/3 rep：`ruleHasBf=true`、`mask.backdropFilter = blur(2px)`、拦截 0 |
| **消融贯穿全部 9 相** | 3/3 rep × `scrimOnly`/`both`：**臂末计算样式与刚施加时逐字符相同** ⇒ 未被 React 重建抹掉，**没有臂被静默标错** |
| 窗口非真空 | 各相窗口帧数 ≥48（`blurOnly` **57**）；阴性对照 180 帧 / 3 s |

> **一处易误读为缺陷的地方**：`both` 臂 `ruleHasBf = true` 是**正确的** —— 它用 pre-image 字节 + 页内 inline 覆盖；`blurOnly` 的 `false` 才是真字节修复。两者元素计算样式都为 `none`，差别正是本对比要分离的"真修复"与"消融"。

**并发记账**：本批 `lockMode = exclusive`（自取锁，**未强制**）；`censusAtStart total=14 / foreign=14`；`loadavg 2.44 2.53 2.85`；逐 rep 起始 `foreign=17`。判读**只用同 rep 相邻配对**。

### 5.6 护栏臂 1440×900（3 rep）—— **无回归，且略优**

| run | 臂 | 弹窗内相数 | 抖动相数 | Σ 帧 >50 | 单相 frameMax 最大 |
|---|---|---|---|---|---|
| guard9 ×3 | `normal` | 30 | 0 | 0 | 33.5 / 33.4 / 50.0 ms |
| guard9 ×3 | **`patch`** | 30 | **0** | **0** | **16.8 / 16.8 / 16.8 ms** |

⇒ 1440×900 下**两臂都无抖动**（与审计一致：该视口下效应不可复现）；**`patch` 的单相 frameMax 上限反而从 33.4–50 ms 降到稳定的 16.8 ms** ⇒ **护栏"1440×900 无回归"达标，且方向有利。**

### 5.7 产物与一处必录小瑕疵

- `raw/harness/perf-{smoke,mask2k,guard9,bridge}-*-*.json` —— 逐 rep 逐相原始记录（`framesGt50` / `frameMax` / `frameP95` / `loafCount` / `clickToFirstChangeMs` / `frameSeries`）
- `raw/harness/judgement.json` —— **V1 36/36 PASS**、V2（基线复现）、V3（拦截次数与送达 sha）的机器判定
- `raw/harness/pixdiff-all.json` —— 39 对像素差（含**空对照** normal-vs-normal2）
- `raw/harness/RESULTS.md`、`raw/harness/harness-notes.md` —— 器械档自述

**必录小瑕疵**：`smoke`（1440×900，1 rep 预检批，**非判据批次**）的 `patch` 臂出现 **1 个抖动相 / 1 个 >50 ms 帧（frameMax 66.7 ms）**。在正式护栏臂（guard9，1440×900 × 3 rep）中 `patch` 的 frameMax 上限稳定为 **16.8 ms**。故判为预检批单点噪声，**不作为回归证据**，但如实列出。



### 5.8 环境与并发（**按 I2 的应对如实记账，不声称 `foreign=0`**）

- 修正后的 census 逐 rep 实测 **`foreign` = 11–20**（含用户真实 Chrome、snap Firefox、以及兄弟线 `.workspace/lag-fix/incident2/instrument-tiebreak` 与 `.workspace/lag-fix/incident2/firefox-a11y` 两个**正在跑**的浏览器），`loadavg` 3.13–4.29。
- **本线未声称"干净机器"**：判据一律建立在**同 rep 相邻臂配对**上；被撤回的是审计那套"静默门 foreign=0"的有效性主张（见 §4bis I2）。
- **全程未对任何浏览器发信号**：未 `kill`、未 `pkill`，兄弟线的浏览器与本线 Playwright 实例并存。


---

## 6. 观感等价性论证（**如实写：不等价**）

### 6.1 先给出"只改了 blur"的机制级证明（不需要基准测试）

同 rep、同页面状态、同滚动位（`stateMatch = {nav:true, tab:true, scroll:true, panel:true}`）下逐项取**计算样式**：

| 属性 | `normal` 臂（未改） | `patch` 臂（候选件） | 判定 |
|---|---|---|---|
| `backdropFilter` | `blur(2px)` | **`none`** | **唯一变化** |
| `background` | `rgba(0, 0, 0, 0.24) none repeat scroll …` | **`rgba(0, 0, 0, 0.24) none repeat scroll …`** | **逐字符相同** |
| `backgroundColor` | `rgba(0, 0, 0, 0.24)` | `rgba(0, 0, 0, 0.24)` | **逐字符相同** |

⇒ **遮罩的变暗量、几何、可点击关闭行为全部未变；唯一被移除的就是那 2px 背景模糊。** 这是"只改了该改的东西"的最强单点证据。

### 6.2 像素差（实测，含**空对照**）

> **证据范围必须说明**：器械档的截图文件名**未带调用戳**，导致同一 run 的 3 次调用**互相覆盖**了 PNG ⇒ **存活 21 张 PNG，像素证据为每个 run "3 个不同状态对"（而非 3 个 rep × 3 对）**。因此下表的像素数字来自**每个 run 的 1 次调用**；而 §5 的**帧数**证据来自**全部 3 个 rep 的全部记录**（未被覆盖）。`pixdiff` 已对重复文件对做抑制（24 对）并在器械档 `RESULTS.md` §6b(4) 披露该缺陷。


| 视口 | 对 | 均值\|Δ\| | >2/255 占比 | >8/255 | >32/255 | max | 面板内部 平均Δ | **面板外部（边距） 平均Δ** |
|---|---|---|---|---|---|---|---|---|
| **2560×1440**（5120×2880 设备像素） | `normal` vs `patch` | **1.14** | **12.90 %** | 0.91 % | 0.37 % | 161 | **0.0008** | **1.3788** |
| 2560×1440 | **空对照** `normal` vs `normal2`（两臂都带 blur） | **0.0001** | **0.0019 %** | **0 %** | **0 %** | **7** | **0** | **0.0002** |
| 1440×900（2880×1800） | `normal` vs `patch` | 1.70 | 12.21 % | 3.47 % | 1.03 % | 161 | **0.0004** | **3.3556** |

**分区域 >2/255 的像素数与区域内占比（2560×1440）：**

| 区域（2560×1440，设备像素 14,745,600） | 占全图 | 区域内像素数 | >2/255 像素数 | 区域内 >2 占比 | 平均最大通道差 |
|---|---|---|---|---|---|
| **面板内部**（insideCore） | **16.67 %** | 2,458,624 | **194** | **0.0079 %** | **0.0008 / 255** |
| 面板边缘带（圆角/投影过渡） | 0.69 % | 101,376 | 947 | 0.9341 % | 0.0565 / 255 |
| **面板外部（变暗边距）** | **82.64 %** | 12,185,600 | **1,900,734** | **15.5982 %** | **1.3788 / 255** |

（同一组区域在 1440×900 下的占比为：面板内 **47.43 %**、边缘带 1.96 %、面板外 **50.62 %**——**面板 CSS 尺寸恒为 800×800，不随视口变化**，故视口越大，面板外的变暗边距占比越高。）

### 6.3 结论（**给协调者裁决，本档不拍板**）

1. **空对照确立了噪声地板**：两张**状态完全相同**的截图之间只有 **0.0019 %** 的像素差 >2/255，`max = 7`，面板内外平均差均为 ~0.0001–0.0002。⇒ 截图/解码链路近乎确定性，**任何高于该地板的差异都可归因于补丁本身**。
2. **面板内部 = 噪声地板量级**：194 / 7.08 M = **0.0027 %** 的像素 >2/255，平均差 **0.0008/255**——**与空对照（0 %/0.0001）不可区分**。这与 §2.1 复核的"面板完全不透明"完全自洽：**用户看内容的地方没有被改动**。
3. **变化全部集中在面板外的变暗边距**：该区域内 **15.60 %** 的像素差 >2/255，平均 **1.3788/255**，**是空对照的约 8000 倍密度**。那里背景不再被 2 px 模糊。
4. **量级判断（不夸大也不缩小）**：全图平均每通道差 **1.14/255（约 0.45 %）**，`p90 = 3`、`p99 = 8`；**但 `p999 = 88`、`max = 161`**，出现在高对比度文字/图标边缘——2 px 模糊本就会把这些边缘抹开。故**不能称之为"视觉上不可区分"**，也不能称之为"整体观感改变很大"；准确的表述是：**面板外一圈的背景被去掉了 2 px 柔化，在文字/图标等高对比边缘处局部可见。**
5. **有界且可逆**：遮罩的变暗值、几何、点击关闭语义逐字符未变（§6.1），改动是**一处 37 字节删除**，`cp` 一步回滚。
6. **随视口变化的是"受影响面积"，不是"差异性质"**：面板 CSS 尺寸恒为 **800×800**，不随视口放大 ⇒ 面板外变暗边距的占比在 1440×900 为 **50.62 %**、在 2560×1440 为 **82.64 %**。即**用户真实窗口（2560×1440）下受影响面积显著更大**，但面板内部始终是噪声地板量级、差异性质相同。

> **待协调者裁决的问题**：以"面板外一圈背景从 2 px 模糊变为不模糊"换取"弹窗内相 >50 ms 帧 961 → **0**"，是否可接受。
> 若判定不可接受，可选**降级档**：把该条声明改为 `blur(1px)`（只改一处字符串，需重测；本档**未测**，且预期只能削减约一半合成代价，**很可能达不到"0 帧"判据**，故不作为推荐）。


## 7. 失败 / invalid / 未能验证的部分（**如实列全**）

### 7.1 判据层面的偏离

| # | 项 | 状态 | 说明 |
|---|---|---|---|
| A | **`click→首次变化` 护栏** | ❌ **未达标** | patch 中位 17.0 / 17.8 / 18.05 ms，**均略高于审计基线 16.65 ms**（同 rep 相对 `normal` 为 +1.1 ~ +2.05 ms）。主判据收益为 961 → 0 帧。**已列为本报告最重要的待裁决项**（§5.4） |
| B | **A-B-A 第 1 个 run 未完整复原** | ⚠️ **部分** | 第 1 个 run：`normal` 961 → `patch` 0 → `normal2` 97（复原 10 %）。第 2、3 个 run 良好对称（96↔103、99↔95）。该 run 有器械内部旁证表明其 `normal` 窗口被外来负载污染（`POSCTL_120_inpanel` 13 帧 vs 其余 8 个实例均 1 帧；`IDLE_BASE` = 1 帧；loadavg 最高）。**patch = 0 在该 run 内同样成立**，故主判据不受影响 |
| C | **`smoke` 预检批 1 个抖动相** | ⚠️ **单点** | 1440×900、1 rep、非判据批：`patch` 臂 1 相 / 1 帧（66.7 ms）。正式护栏臂（3 rep）中 patch 上限稳定为 16.8 ms。判为噪声，不作为回归证据 |
| D | **`c2f` 单点 2146.9 ms** | ✅ **已查明为测量伪影（本档先前归因有误，已更正）** | 出现在 `04:34:47Z` 的 `patch` 臂，但该值属于 **`CLOSE` 相**，而 35 个 `CLOSE` 实例中 **34 个**因 observer target 已 detach 而报 null ⇒ 是**观测器脱离伪影，不是真实停顿**；`c2f` 统计**已排除 `CLOSE`**。详见 §5.4 |
| D2 | **臂顺序未平衡（`patch` 恒在中间）** | ⚠️ **设计局限，未排除** | 器械档论证纯顺序效应不成立（其一是若单调则 `normal2` 应更高，而实际 `normal2` ≈ `normal`），但**未能排除顺序混杂**；本报告因此把 A-B-A 的最强证据放在 bridge 臂（§5.5） |
| D3 | **截图证据范围缩水** | ⚠️ **已披露** | 器械档截图文件名缺调用戳 ⇒ 各 run 的 3 次调用**互相覆盖 PNG**，像素证据为**每 run 3 个状态对**（非 9）；帧数证据不受影响（§6.2 已注明） |

### 7.2 本档在 step-0 中自曝的协议缺陷与新边界

| # | 项 | 状态 |
|---|---|---|
| S1 | **我的 `POSCTL_120` 协议违反仲裁 rule 4** | ⚠️ **已披露**：我用 `page.evaluate(() => window.__block(120))` ⇒ 阻塞跑在**顶层 `EvaluateScript` 任务**，属 LongTask 的归属盲区。按 rule 4，阳性对照**应改用页内 `setTimeout` 注入**。后果有限：**帧通道（99.9–116.7）与 LoAF（有条目）都检出了该阻塞**，故"通道活着"仍成立；但**该对照的 LongTask 立柱无信息量**（恒为 0，正是预期盲区）——我从未用它当"不卡"的证据 |
| S2 | **我的探针用 rAF `ts` 参数**（`inpage-probe.js:43`），非 `performance.now()` | ⚠️ **已量化**：实测 `ts` 偏低 **GT − 3.7…4.0 ms**（阻塞在 rAF 回调内）至 **GT − 20.0…20.2 ms**（阻塞在 rAF 回调外）⇒ **本报告所有帧间隔绝对数系统性偏低 ~4–20 ms；`16.8 ms` 是下限**。相对比较（同 rep 配对）不受影响 |
| S3 | **`framesGt50` 的分辨力** | ⚠️ **新边界**：其实际分辨下界约 **40–50 ms**（35 ms 停顿读 47.1 ms 不过线；25 ms 读 37.2 ms）⇒ 本报告"961 → 0"**不能**读作"25–45 ms 级停顿也已消除"。本档**未测**该频段（需 LoAF + 相对底噪判据逐档剂量） |
| S4 | **我未测顶层 `eval` 注入位置** | ⚠️ 本批只测 `raf` / `timeout` / `none`（协调者要求的两位置）。顶层 `eval` 的 LongTask 盲区**引用**仲裁档（其 `eval` 格 0/5），已在 §0bis.6 注明出处 |
| S5 | **调用 1 的阴性对照位不合格** | ⚠️ `IDLE_BASE` frameMax **66.7 ms** 且 >50ms 1–2 帧，**三个臂同时如此** ⇒ 按 rule 2 第 ③ 条该 run 对照不合格；已据此（**基于规则**而非事后叙事）把调用 1 的 `normal` 判为环境噪声偏高 |
| S6 | **一次阴性对照异常** | ⚠️ step-0 `non3` 的 wall 帧间隔 max = **29.7 ms**（其余 16.8/16.8），LoAF 与 LongTask 仍为 0 ⇒ 一次环境抖动，未剔除、如实列出 |

### 7.3 器械档自报的失败与 invalid（**采信并转记**）

| # | 项 | 状态 |
|---|---|---|
| H1 | 首次 campaign 尝试因其 driver bug（`shift 3` 吞掉命令）**空跑**，各 stage 假报 rc=0 | ✅ 已由内容型 `preflight.mjs` 门拦住；**未启动浏览器、无数据**；修复后重跑 |
| H2 | 一个**游离 runner 进程**（12:15:32，源于误 `import()` 触发 `main()`） | ✅ **从未取得锁、从未启动浏览器**；60 s 后终止；**已核实未触碰兄弟档的锁** |
| H3 | 截图文件名缺调用戳 ⇒ PNG 互相覆盖 | ⚠️ 已披露（见 §7.1 D3） |
| H4 | `summarize.mjs` 起初只配对第 1 次调用（各调用都标 `rep 1`） | ✅ 已改为按调用配对；§5 的 90 个实例为**修复后**口径 |
| H5 | 调用 1 的 `IDLE_BASE` 在**三个臂**上都是 1 帧 | ⚠️ 环境/启动残留**同等命中三臂**；调用 2/3 为 0 |
| H6 | 210 个 `patch` 相实例中 **1 个**有 1 帧 >50 ms（`smoke` 1440×900 的 `SCROLL_tab 插件配置` 66.7 ms） | ⚠️ 如实保留（见 §5.7），非判据批次 |
| H7 | **主线程 Paint/RasterTask/Layout 在 `patch` 臂持平或更高**（216.96/300.63/467.92 → 291.13/323.84/620.69 ms），而帧数 1156 → 0 | ✅ 与"代价在**合成器侧**、主线程无节省"一致；**本档不把它读作回归**，但如实列出 |

### 7.4 本档未做、或做不了的事

| # | 项 | 状态 | 原因 / 说明 |
|---|---|---|---|
| E | **deployed 写入** | **未执行（按分工）** | 本档沙箱对部署路径 `--apply` 实测 **EACCES**（对抗档独立复现「权限不够」）。候选件 + 脚本 + 验证已交，落地是协调者步骤（`DEPLOY.md`） |
| F | **用户真实物理屏的体感复测** | **未验证** | 本档全程 headless、无显示栈。**绝对帧数是本机 headless 器械下的下限**：没有 5120×2880→3840×2160 的分数缩放重采样、没有 2 CU 的 AMD Raphael 核显、没有 mutter 合成、没有企业 DLP 水印层。**能迁移的是"效应方向 + 同 rep 配对结论"，不能迁移绝对值**（与审计同一边界） |
| G | **`blur(1px)` 降级档** | **未测** | 审计 §9 提到的备选（把该声明降为 `blur(1px)`）。本档只交全删除档；降级档只改一处字符串，但**预期只能削减约一半合成代价，很可能达不到"0 帧"判据**，故未测、不推荐 |
| H | **合成器线程的绝对耗时** | **无法测** | `CompositeLayers` / `UpdateLayerTree` 在本 session trace 内恒为 0（审计已记录该通道盲区）。本档**不给任何"省了多少 ms 合成时间"的绝对数** |
| I | **F2 / F3 及其它全视口遮罩** | **未做（超范围）** | 壁纸层重写（F2）、面板分层+裁剪（F3）、以及 `fNh4Da_mask`（图片灯箱）、`BInVoG_mask`（拖放，`blur(10px)`）、`_mask_15u5s_4`（通用弹窗遮罩）、`_onboardingMask_*`、第三方 `dsh-btw` 的遮罩**均未测量、未改动** |
| J | **`patch` 在真实 GUI（127.0.0.1:3080）上的用户可见效果** | **未由人眼确认** | 像素差为器械实测（§6），未做人工主观确认 |

### 7.5 未独立复验的部分

| # | 项 | 状态 |
|---|---|---|
| K | 补丁脚本当前冻结版 `c2f04a48…` | ✅ **已独立复验**（第 4 轮：R0/R1/R2 全部确证修复、holds-list 19/19 无回归、C5 复现 `bd7edeae…`） |
| L | 脚本的 **TOCTOU 残余（T1）** | ⚠️ **已知、未修、已披露**。`lstat` 守卫与 `renameSync` 之间非原子：若在 rollback 执行期间有并发写入者在目标目录内替换该路径，可在约 18–30 ms 窗口内使 rollback 把符号链接消费掉并报 `rolled-back`。**严重度低且非提权**（实施者必须已能在该目录内创建/删除条目，此时它本就可直接改目标文件）。**未修的理由**：任何代码变更都会使已完成的独立复验作废；缓解措施为"**不要在有并发写入者时执行 rollback**"，已写入 `DEPLOY.md` |
| M | 器械档的 `RESULTS.md`/`harness-notes.md` 结论 | 本报告的**全部数值均取自其原始 JSON**（`judgement.json` / `perf-*.json` / `pixdiff-all.json`），未依赖其叙述；器械档自身的文字结论未经第三方复核 |

### 7.6 器械层面的既有缺陷（**影响上游审计，已单独上报**）

- **I1**：共享探针锁的判活判据（`readlink /proc/<pid>/exe`）在本环境对**存活**进程返回 EACCES ⇒ 会把活 owner 判死并回收。**本档在首次 `acquire` 之前发现并修复**（`pid=591877` 活体反例，见 §4bis）。同时修正了归因：审计 §1.1 把该事故归因于多行 `owner.txt` 的 shell 切分，那是诱因，**判活判据本身不成立才是根因**。
- **I2**：审计的"静默门 foreign=0"是**结构性空洞输出**（exe-only census 恒为 0），**"机器是安静的"这一有效性主张应撤回**。本线改以**同 rep 相邻臂配对**为判据，并如实报告 `foreign` = 11–20。



---


## 8. 同档自复核（**PASS / REWORK**）

**自裁结论（在 §0bis 闸门落地后给出）：PASS（候选件与脚本交付可用、主判据在改判后的正确通道上仍达标），但附 3 项须协调者裁决/知晓的事项：**
1. **主判据已按仲裁改判为 LoAF**，在该通道上 `patch` = **90/90 相零超支**（对照 92.5–110 ms）⇒ **达标**；
2. **旧判据 `framesGt50` 降级为相对 KPI**，且**绝对帧值系统性偏低 ~4–20 ms**、**分辨下界 40–50 ms**（§0bis.7、§7.2 S1–S3）；
3. **c2f 护栏两种读法矛盾**（汇总中位未达标 / 逐相配对未见系统偏移，p ≈ 0.53）——**并列交裁决**（§5.4）；
4. **遮罩是否落地由协调者裁定**（`tab-switch` 明确警告"不要据此去动遮罩层"）⇒ 本档**只交候选，不主张落地**。

> **时序说明（如实记录）**：协调者下达"暂缓落地、先做 step-0"时，本档**已完成** campaign 并据此给出过一版裁决。收到范围变更后，本档**未再跑验收、未据旧口径重下裁决**，而是先落地 §0bis 闸门，**在改判后的判据下重新给出结论**；旧版裁决中依赖 `framesGt50` 作为**灵敏度**主张的部分**已按 §0bis.7 第 2 条撤回**，其余（像素差、溯源、静态确证、字节改动）**与仪器口径无关，保持不变**。

### 8.1 对照目标与审计结论逐条核验

| 审计要求（F1） | 落实 | 证据 |
|---|---|---|
| 消除或限制遮罩全视口 `backdrop-filter` | ✅ 消除（三条路径中选 (a)） | §1.2 一处 37 字节删除 |
| 在**真实客户端 bundle** 定位确切 **file:line** | ✅ 第 **28 行第 704 列** | `raw/recheck.json`（5/5 VERIFIED） |
| 说明是内联 style 还是 CSS 类 | ✅ **CSS 类**（运行时注入 `<style>`） | §1.1 + `tools-mine/recheck-mask-source.mjs` |
| 给改动前后**可见结果等价性论证**；若观感有变则**量化并交裁决**，不自行拍板 | ✅ 已量化、已交裁决 | §6（含空对照噪声地板）；§5.4/§6.3 明确标注待裁决 |
| 三条路径选**实现风险最低**的并说明理由 | ✅ 选 (a)，并给出 (b)/(c) 的否决依据 | §2.1（(b) 无动画可挂、(c) 面板不透明⇒可见结果同 (a)） |
| 补丁脚本：dry-run 默认 / `--apply` 才写 / 锚点唯一命中才写 / 自动 pre-image / `node --check` / 幂等 / `--rollback` | ✅ **全部实现 + 37/37 断言自测** | §4、§4.2–§4.4、`raw/guardrails.json` |
| deployed 写入交协调者 | ✅ 未执行；EACCES 已实测 | `DEPLOY.md`、§7.3 E |
| 验收：同器械 2560×1440@DSF2、≥3 rep；主判据 >50ms 帧 = 0 且 p95 ≤16.8ms；副判据 LoAF≈0；护栏 c2f 不劣化且 1440×900 无回归 | ⚠️ **主判据、副判据、1440 无回归均达标；c2f 护栏"汇总中位读法"未达标、"逐相配对读法"未见系统偏移，并列上报** | §5.2（90/90 相为 0；配对 76/76 归零）、§5.6（无回归且更优）、§5.4（两读法并列，交裁决） |
| 判据用 framesGt50/frameMax，不用 LongTask；阳性对照必须页内注入 | ⚠️ **部分遵守，已按 §0bis 修正**：确实从未用 LongTask 当"不卡"证据；但阳性对照走的是**顶层 `evaluate`**（违反仲裁 rule 4，见 §7.2 S1），且**主判据已改判为 LoAF**（§0bis.7） | §0bis、§7.2 S1 |
| **step-0：同页同阻塞四通道同测、两注入位置各 ≥5 次、记可见性** | ✅ **已完成** | §0bis：前台 68.6 Hz、每窗口 32–33 帧、播种口径 **10/10 检出**、线 B 口径 **0/10**、阴性对照静默 |
| **桥接：仅去 blur 能否达到审计臂同量级改善（同器械、≥3 rep、同 rep 相邻配对）** | ✅ **已给结论**：`blurOnly` 与 `both` 在 **3/3 rep 都是 `LoAF = 0`/`duration 0`**，wall 帧间隔 18.6–26.0 ms；`scrimOnly` ≈ `normal` ⇒ **仅去 blur 足够，scrim 不必纳入**（§5.5） |
| **锁改用全组统一实现 `lib/probe-lock.mjs`** | ✅ 判活已委托该文件；owner 改单行 `key=value` + tmp/rename 原子落盘；等价性以活进程/僵尸实测；跨线互操作已验（§4bis I1bis） |
| **D2 处置：撤回保证、不撤回结论** | ✅ 已按此写入 §4bis I2 |
| 锁协议（单行 owner.txt，绝不删存活 owner） | ✅ 遵守，**并发现并修复了会使该纪律失效的判活缺陷** | §4bis I1 |
| 单浏览器串行；只点设置/导航/tab/关闭 + 滚动；不点保存/应用/删除 | ✅ 遵守 | 交互白名单未扩展；全程未对任何浏览器发信号 |
| 热面⇒刷新即生效；若落宿主侧则停下上报 | ✅ 判定为**热面**（served==disk、`rev` 无校验）⇒ 无需上报、无需重启 | §3 |

### 8.2 我是否引入了副作用 / 是否有遗漏

- **无越界写入**：全部产物在 `exec-mask/` 内；部署文件经自测 C23 复核**每次都是原 pre-image `9298ac5b…`、mode 664 未变**；未 `kill`/`pkill` 任何浏览器；未修改 `incident2/why-these-two/tools/`（只读取/复制）。
- **发现并修复了 10 个自身缺陷**（D1–D7、N1–N4、R0–R2，均来自独立对抗档并在修复后重新验证），**未把它们藏起来**：§4.2–§4.4 逐条列出，并注明"修复后脚本由本档自测覆盖、当前冻结版已获第 4 轮独立复验"。
- **瑕疵未掩盖**：c2f 未达标、A-B-A 第 1 个 run 未完整复原、smoke 单点、c2f 2.1 s 离群，全部在 §5.3/§5.4/§5.7/§7.1 如实列出；器械档自报的 7 项失败已在 §7.2 转记。
- **纠正了自己两处错误**：① 过早把几何结论写成"面板外 82.6 % **被遮住**"（实为**暴露**），已在 §4/recheck 中改正并重述；② §6.2 区域占比一度写成 48 %（那是 1440×900 的值，2560×1440 应为 **16.67 %**），已改正。

### 8.3 为何不是 REWORK

- 主判据与副判据在**用户真实窗口尺寸、3 个 rep、90 个弹窗内相**上**全部达标**，且由**真字节 bundle 替换**（非页内 hack）达成，`V1` 阳性对照 36/36 PASS 证明通道有效。
- 改动的**风险面极小且可逆**：一处 37 字节 CSS 声明删除，无 JS、无动画、无新 DOM、不动共享令牌；观感差异经**空对照**证明**只落在面板外的变暗边距**，面板内部处于噪声地板量级。
- 唯一偏离（c2f）**量级远小于收益**：即便按最不利的汇总中位读法也只是 **+1–2 ms**，而收益是 **1156 → 0** 个 >50 ms 帧（2560×1440）与 1440×900 上限 33.4–50 → **16.8 ms**；按逐相配对读法**未见系统性偏移**（p ≈ 0.53）。该偏离**属于"值不值得"的业务权衡，不是实现缺陷** ⇒ 按纪律**上报裁决**，不自行拍板。

**⇒ 若协调者按"汇总中位"读法判定 c2f 的 +1–2 ms 不可接受，则本单元的处置应为：先做一次带 `BLOCK` 随机化的复测（在 30 个相上以固定 3 臂顺序各跑一遍，但轮换臂顺序以排除顺序混杂），再决定是否降级为 `blur(1px)` 档。**



---


## 9. 交付物清单

| 路径 | 内容 |
|---|---|
| **`candidate/client.js`** | **候选件**（26593 B，sha256 `bd7edeae…`）——就是交给协调者落地的确切字节 |
| **`apply-Mask-v1.mjs`** | **补丁脚本**（sha256 `c2f04a48…`，已冻结并独立复验）；dry-run 默认 / `--apply` / `--rollback` / `--verify` / `--emit` / `--json` |
| **`DEPLOY.md`** | **部署交接**：冻结值、确切改动、部署与回滚命令、脚本保证与**不**保证的事项、耐久性警告（重装会静默回退） |
| **`report.md`** | 本文件 |
| `preimage/client.js.pre` | pre-image 逐字节副本（26630 B，sha256 `9298ac5b…`） |
| `raw/recheck.json` | 只读溯源复核（5/5 VERIFIED：类唯一性、锚点唯一、served==disk、`rev` 无校验、令牌 4 消费者、几何） |
| `raw/guardrails.json` | 补丁脚本自测 **37/37**（含每个拒绝用例的**具体子原因**断言、逐字节精确、mode、符号链接、跨拼写、错误路径） |
| `raw/dryrun-deployed.json`、`raw/emit-candidate.json` | 部署目标的干跑与候选件产出记录 |
| `raw/instrument-findings.json` | **器械发现 I1/I2/I3**（含活体反例与"旧 census 恒为 0"的对照） |
| `raw/harness/judgement.json` | **V1 36/36 PASS** / V2 基线复现 / V3 拦截与送达 sha 的机器判定 |
| `raw/harness/perf-*.json` | 逐 rep 逐相原始记录：`smoke`(1440×900) / `mask2k`(2560×1440×3 rep) / `guard9`(1440×900×3 rep) / `bridge`(审计式消融) |
| `raw/harness/pixdiff-all.json` | 39 对像素差（含 **空对照** `normal`-vs-`normal2`） |
| `raw/harness/RESULTS.md`、`harness-notes.md` | 器械档自述与其对原始 runner 的改动说明 |
| `raw/adversarial/`（87 个文件） | **四轮独立对抗/复验**的全记录：`adversarial.md`、`verify-fix.md`、`verify-n-fixes.md`、`verify-final.md` 及各轮 transcript/results |
| `shots/*.png`（21 张） | 同状态 A/B 截图（1440×900 与 2560×1440） |
| `tools/`（9 个文件） | 器械：改自审计 runner 的 `panel-compare.mjs`（新增 `--bundlePatch`/`--arms`/`--shots`）、`inpage-probe.js`、`lock.mjs`（**含判活修复**）、`campaign.sh`、`pixdiff.mjs`、`png-read.mjs` |
| `tools-mine/` | 本档自写工具：`recheck-mask-source.mjs`（只读溯源）、`selftest-apply-Mask-v1.mjs`（37 项断言自测）、**`step0-probe.js` + `step0-instrument.mjs`（§0bis 四通道仲裁器械）** |
| **`raw/step0/step0-*.json`** | **§0bis 闸门原始数据**：23 格 × 四通道读数、两个时钟、窗口标记、`RunTask` 地面真值、可见性自證 |
| `logs/step0-*.log` | step-0 运行日志（含事前注册判据的逐格判定打印） |
| **`raw/bridge/bridge-*.json`** | **§5.5 桥接 2×2（{blur, scrim}）原始数据**：5 臂 × 3 rep × 9 相、LoAF/LongTask/wall+ts 帧间隔、消融贯穿性护栏、V3 拦截与规则文本核对 |
| `logs/bridge-*.log` | 桥接运行日志（逐臂逐相 LoAF 打印） |
| **`tools-mine/bridge-probe.js` + `bridge-arms.mjs`** | 桥接器械（四臂 + 消融贯穿性校验 + 并发记账） |
| `raw/harness/lock-liveness-test.json` | 器械档对**锁判活判据**的运行时验证（活进程判 ALIVE、仅对"确证死亡"判 DEAD，并复现继承判据把 4 个活进程判死） |
| `logs/`（16 个文件） | campaign 原始日志与器械 diff |

**复现命令**
```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-mask
node tools-mine/recheck-mask-source.mjs --out raw/recheck.json     # 只读溯源
node apply-Mask-v1.mjs --json                                      # 干跑（不写）
node tools-mine/selftest-apply-Mask-v1.mjs --out raw/guardrails.json  # 37/37 自测
bash tools/campaign.sh                                             # 整批器械复测（自动取锁；约 35 分钟）
```

---

## 10. 候选排序（**按 §0bis 闸门后的可信度重排**）

### 10.1 排序原则

本档把靶点分成两类：**(A) 通道无关量**（RPC 次数/耗时、节点数/SVG 数、代码级静态事实——**不受 §0bis 仪器争议影响**，可直接采信）；**(B) 通道相关量**（任何依赖帧间隔/LoAF/LongTask 的"卡不卡"读数——**只在 §0bis.6 的可用条件下采信**）。

### 10.2 第一梯队：通道无关、有确定重复性

| # | 靶点 | 量（通道无关） | 出处 | 为何是第一梯队 |
|---|---|---|---|---|
| **T1** | **每次切回「插件」栏目固定重发 9 个 `/usage/*`** | 每次切换 **9 个 RPC**（全部 `/usage/*`，无缓存、无 in-flight 去重）；单调用**中位 212.8–354.2 ms、最慢 791.5 ms**；内容子树 337 节点 | `tab-switch` §3/§5.1（CDP Network 计数与耗时） | **唯一有确定重复性的"贵"**；代价由"每次切换都付"决定，与任何帧通道口径无关 |
| **T2** | **8 个栏目无 keep-alive** ⇒ 切换 = 卸载旧栏目 + 挂载新栏目，"全部成本切换即付"；**4 个自带取数的栏目每次切换都重新取数** | 代码级：`renderSlot("settings.section", …, {only: active})`（`settings-general:162-165`、`dsh-client-ui-renderer/lib/client.js:845-847`） | `tab-switch` §5.2 | **结构性事实**，与仪器无关；它把 T1 从"偶发"变成"必然每次" |
| **T3** | **「插件列表」子标签首次挂载 1820 节点 / 1736 元素 / 192 SVG** | 结构量（run2+ 实测 1820 节点） | `tab-switch` §3.7 | 结构量可采信；**但必须并记反证**：`why-these-two` 已用实测否证"节点数＝代价"（1737 节点的插件列表 12.5 帧 **<** 37 节点的模型 14 帧；1440×900 下两者都是 0，ρ(optSvg,代价) = **−0.261**）。⇒ **T3 是"工作量"而非已证实的"代价"** |

> **⚠️ 必须更正的转述（协调者交办材料中的第三项）**：`tab-switch` **自己已作废**"`pluginInventory.list` >1.8 s 无缓存重扫"这一条——其 §3.7 更正称：该接口遍历**内存** `ctx.loader.entries()`（`dsh-host-plugin-inventory/lib/index.js:102-114`，该文件**无 `fs` 引用**），HTTP **p50 9.09 ms**（177 条 / 21,742 B），9 字节对照 p50 10.98 ms（比值 0.83）⇒ **载荷大小无可测代价**；run5 的 ">1.8 s" 系据"窗口内未 settle"推断，**run6 实测 41.9 / 27.6 ms**。此结论与 `why-these-two` 独立测得的 `pluginInventory/list` **1.4 ms** 一致。**⇒ 该项不应进入第一梯队；本档据实更正，不传播已撤回的数字。**

### 10.3 第二梯队：通道相关，须在 §0bis 的可用条件下重测

| # | 靶点 | 状态 |
|---|---|---|
| **T4** | **设置弹窗全视口遮罩 `backdrop-filter`（本档 F1）** | 判据已按 §0bis 改判为 **LoAF 主判据**，在该通道上仍**达标**（`patch` 90/90 相 LoAF = 0，对照 92.5–110 ms）。**但协调者已裁定暂缓落地**，且 `tab-switch` 明确警告"不要据此去动遮罩层" ⇒ 本档**只交候选，不主张落地**。**若协调者的裁决削弱本项，T1/T2 就是替代靶点。** |
| T5 | 壁纸层无跳过门的全视口 `background-image` 重写（原 F2） | 机制经静态逐行确证（与仪器无关）；`why-these-two` 已否证它是**代价载体**（触发集合反而更便宜）⇒ 属"应修的冗余"，不属"卡顿载体" |
| T6 | `session.list` / `subagent.list` 每次都全量重扫（宿主侧） | `session.list` 中位 **336.9 ms** 且**阻塞宿主事件循环**（探针 p95 4.6 → 43.9 ms，4 路突发 max 789 ms）⇒ 它是**时间抖动**来源，与栏目无关；通道无关（宿主 RPC 计时） |

### 10.4 本档可直接承接的后续（若协调者要重排靶点）

本档已有**可复用的验收器械**：`tools/`（改自审计 runner，含 `--bundlePatch` 真字节替换、`--arms` A-B-A、静默门、锁协议）+ `tools-mine/step0-instrument.mjs`（**四通道 + 播种/时钟/可见性自證**，即为 §0bis 那套）。用它测 **T1/T2** 的建议口径：
- **主判据 = LoAF**（前台，且需先通过 rule 2 自證：窗口帧数 ≥30、中位 16.7 ms、阴性对照 ≤20 ms / LoAF=0）；
- **通道无关副判据 = CDP Network 的 RPC 次数与耗时**（T1 的 9×`/usage/*` 可直接计数，**不受仪器争议影响**，最适合做 T1 的硬判据）；
- 阳性对照**改用页内 `setTimeout` 注入**（不再用顶层 `evaluate`），否则 LongTask 立柱无信息量（§0bis.7 第 5 条）。
