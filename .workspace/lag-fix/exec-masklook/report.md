# report.md — U-W11-A 执行复核一体档：环带遮罩（ring bands）落地交付

- 线：`exec-masklook`（独占目录 `.workspace/lag-fix/exec-masklook/`）
- 上游契约：`program/w11-mask-look/audit.md` §7 **U-W11-A**（唯一交付单元）+ §3/§4.②′ + §8 局限
- 宿主：PID **301709 全程未重启**；未对任何浏览器/宿主进程发信号；**未写入任何工作区外文件**
- 日期：2026-09-22　批次戳：`look-20260922T073213Z`（判据批）、`look-20260922T073126Z`（冒烟，**不作判据**）、`func-regress-20260922T074351Z`
- 本档性质：**修订执行复核一体** —— 按审计 §7 落地，不重新拆解、不扩范围；同档自复核结论见 §14

---

## 0. 一句话裁决

> **U-W11-A 落地完成并通过全部四项验收**：交互相 LoAF **1 条**（对照真模糊 46 条，判据 ≤2）、>50 ms 帧 **1 个**（对照 46，判据 ≤8）、环带像素差 **0.0029 均值 / 0.0235 % >2/255**（判据 ≤0.05 / ≤0.1 %；噪声地板 **0**）、点击环带/Esc/面板内点击/焦点四项交互回归**全部 PASS**、回滚一步可达。
> **关键新事实（本档超出审计的收获）**：审计的 `ringBands` 是**页内注入**（pre-image 字节 + `mask.display=none` + JS 像素矩形），本档把它做成了**真字节实现**并实测：`geomMaxΔ = 0 px`（CSS `calc()` 算出的 4 块环带与浏览器实测面板盒内缩 32 px **逐像素完全一致**），且**观感数字与注入臂逐位相同**（0.0029 / 0.0235 % / max 8 / 残差 2 788 像素落在 8×8 网格第 1、6 行）——即审计的预测在真实现上被完整复现，而不是"只在注入条件下成立"。

---

## 1. 交付物（唯一落点 + 候选件 + 脚本）

| 文件 | 角色 | sha256 |
|---|---|---|
| `~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/client.js` | **落点（当前 live，本档未改动）** | `bd7edeaec382be26…`（26593 B） |
| `candidate/client.js` | **候选件（待协调者 deployed 写入）** | **`0853da8858dcdd48…`（28084 B）** |
| `candidate/client.js.pre` | 候选件的源字节（= 当前 live，供 `cp` 回滚） | `bd7edeaec382be26…` |
| `candidate/client.js.manifest.json` | 候选件 manifest（锚点/偏移/标记普查/解析判决） | — |
| `apply-MaskLook-v1.mjs` | 补丁脚本（dry-run 默认 / `--apply` / `--rollback` / 幂等 / 全或无） | `2e2e589f819788ba…` |

**deployed 写入（由协调者执行，本档不代劳）**

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-masklook
node apply-MaskLook-v1.mjs                       # ① dry-run：应打印 dry-run-ok，delta=+1491，不写任何东西
node apply-MaskLook-v1.mjs --apply               # ② 写入落点（自动抓 pre-image + manifest + 保留文件 mode）
sha256sum ~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/client.js
#   期望 = 0853da8858dcdd4805f7e65a40db70c9001f2224d3b19e4033fc674e7b180584
node apply-MaskLook-v1.mjs --rollback            # ③ 回滚（恢复 bd7edeae… 字节）
# 兜底等价回滚（不经脚本）：cp candidate/client.js.pre <落点>
```

⚠️ 落点是**热面**：刷新页面即生效，无需重启宿主（审计 §7 通用前提，本档复用同一机制——验收器械就是靠 `context.route()` 用候选字节应答同一个真实 bundle URL，见 §5）。

---

## 2. 改动内容（三处字节精确拼接，全部锚点唯一命中）

### 2.1 sha256 与标记核对

| 项 | 值 |
|---|---|
| 改动前（现状，已含上游 F1 的 `backdrop-filter` 删除） | `bd7edeaec382be264262c61933395b1fec6026dbedf57fd1be17a307cc899aec`（26593 B） |
| 改动后（候选件） | `0853da8858dcdd4805f7e65a40db70c9001f2224d3b19e4033fc674e7b180584`（28084 B） |
| 字节增量 | **+1491 B**（脚本断言 `delta == expectedDelta`） |
| 锚点 | **A1 `.VOzbGW_mask{…}` 规则**（77 B，命中 1 次）· **A2 mask 元件 JSX**（200 B，1 次）· **A3 类名映射 `rail`→`trigger` 两行**（57 B，1 次）；三者 `old=1 / new=0`（改动前）与 `old=0 / new=1`（改动后）均被断言 |
| **既有标记核对** | 目标文件内**没有任何注入式补丁标记**（上游 F1 是纯删除、未插标记；本档沿用同一约定，**不新增标记注释**）。既有结构标记逐字节保持不变，脚本对 8 项标记 + `//#region`/`//#endregion` 计数（12/12）在改前改后**必须相等**，实测相等：`dsh-css:…/SettingsRoot.module.css.mjs`=1 · `const tagId$3 …`=1 · `The modal layer…`=1 · `"aria-hidden": "true",`=1 · `.VOzbGW_panel{…}`=1 · `border-radius:24px;…overflow:hidden}`=1 · `exports.apply = apply;`=1 · `window.__ModuleLoader__.load({`=1 · regions 12/12 |
| **CSS 规则普查** | 模块 CSS 字符串内共 22 条既有规则（与审计 `audit-static.md` A1 的"22 条规则"计数一致）：**21 条逐字节相同**，**唯一被有意改动的选择器是 `.VOzbGW_mask`**；**新增 5 条**（`.VOzbGW_ring` + Top/Bottom/Left/Right）；**删除 0 条** ⇒ 改后 27 条 |
| `node --check` | 改前 `{esm:true,cjs:true}` → 改后 `{esm:true,cjs:true}`（**解析判决未移动**，两种解析器都过） |

### 2.2 A1 —— mask 规则改为"不绘制" + 4 条环带规则（CSS 字符串内）

```css
.VOzbGW_mask{background:transparent;backdrop-filter:none;position:absolute;inset:0;
  --w11-pw:min(800px,calc(100vw - 48px));--w11-ph:min(800px,100vh - 48px);--w11-ov:32px}
.VOzbGW_ring{position:absolute;background:var(--dsw-alias-bg-mask-1);backdrop-filter:var(--dsw-mask-blur)}
.VOzbGW_ringTop{inset:0 0 auto 0;height:calc(50% - var(--w11-ph)/2 + var(--w11-ov))}
.VOzbGW_ringBottom{inset:auto 0 0 0;height:calc(50% - var(--w11-ph)/2 + var(--w11-ov))}
.VOzbGW_ringLeft{left:0;width:calc(50% - var(--w11-pw)/2 + var(--w11-ov));top:calc(50% - var(--w11-ph)/2 + var(--w11-ov));bottom:calc(50% - var(--w11-ph)/2 + var(--w11-ov))}
.VOzbGW_ringRight{right:0;width:calc(50% - var(--w11-pw)/2 + var(--w11-ov));top:calc(50% - var(--w11-ph)/2 + var(--w11-ov));bottom:calc(50% - var(--w11-ph)/2 + var(--w11-ov))}
```

- `--w11-pw/--w11-ph` 与 `.VOzbGW_panel` 的尺寸表达式**逐字符相同**（`min(800px,calc(100vw - 48px))` / `min(800px,100vh - 48px)`，运行时读回证实）；`--w11-ov:32px ≥ border-radius:24px`（运行时读回 `32>=24`）。
- **未被改动**：`.VOzbGW_panel`（含 `border-radius:24px`）、`nav/navCell/content/header/options/close/trigger` 等全部既有规则逐字节不变（见 §11 的 21/22 规则核验）。

### 2.3 A2 —— `.VOzbGW_mask` 元件**保留**，内加 4 个子 div

```js
children: [(0, react_jsx_runtime.jsxs)("div", {
  className: SettingsRoot_module_css_default.mask,
  "aria-hidden": "true",
  onClick: onClose,
  children: [(0, react_jsx_runtime.jsx)("div", { className: clsx(…ring, …ringTop) }),
             (0, react_jsx_runtime.jsx)("div", { className: clsx(…ring, …ringBottom) }),
             (0, react_jsx_runtime.jsx)("div", { className: clsx(…ring, …ringLeft) }),
             (0, react_jsx_runtime.jsx)("div", { className: clsx(…ring, …ringRight) })]
}), (0, react_jsx_runtime.jsxs)("div", { className: …panel, …
```

- `onClick: onClose` / `aria-hidden="true"` **原样保留**（只多了一个尾逗号），`pointer-events`/`cursor` 未改（运行时读回 `cursor: auto`，与现状臂一致）。
- 4 个子 div 是 mask 的**子元素** ⇒ 点击环带经冒泡落回 mask 的 `onClick` ⇒ 关闭路径不变（§10 实测 1–3 ms 关闭）。

### 2.4 A3 —— 类名映射补齐（与文件既有风格一致，避免散落字符串字面量）

```
"ring": "VOzbGW_ring", "ringBottom": …, "ringLeft": …, "ringRight": …, "ringTop": …
```

---

## 3. 补丁脚本 `apply-MaskLook-v1.mjs`：契约与实测

| 契约 | 实现 | 实测证据（`report-assets/lifecycle/` 沙箱全生命周期） |
|---|---|---|
| dry-run 默认、`--apply` 才写 | `--apply` 才进写分支 | L1 `dry-run-ok wrote=false` |
| **锚点唯一命中才写，否则一个文件都不写** | 三锚点先全部定位：任一 `old>1`→`anchor-ambiguous`、`old==0`→`anchor-missing`、`new>0`→`anchor-and-post-image-coexist`，任一不满足即 `refused` 且**不写** | 开发期实捕获 2 个真实缺陷（见 §3.1） |
| 逐字节拼接、非字符串往返 | `Buffer` 上定位 + 升序拼接 + **保留段逐段字节比对**（锚点前/锚点间/最后锚点后） | L2 `applied`，且 `length == 26593+1491` |
| 自动 pre-image + manifest | `--apply`（落点模式）自动写 `<name>.<key>.pre` 与 `manifest.<key>.json`（含锚点、偏移、标记普查、解析判决） | L2 输出 `pre/client.js.acec5e63.pre` + `manifest.acec5e63.json` |
| `node --check` 门 | ESM+CJS 双解析器判决必须与 pre-image 相同 | 改前/改后均 `{esm:true,cjs:true}` |
| **幂等** | 二次 `--apply` 报 `already-applied` 且不写；`--out` 模式额外按**目标文件**分类（防"部署后重跑把候选覆盖成未打补丁字节"） | L3 `already-applied wrote=false` |
| `--rollback` | 从 manifest 恢复 pre-image；当前 sha 既非 pre 也非 post ⇒ **拒绝**（除非 `--force`） | L4 `rolled-back`（`0853da88…`→`bd7edeae…`）；L5 `already-pre-image`；L6 污染字节 ⇒ `refused`（exit 1） |
| 保留文件 mode | apply 记录/写入 mode，rollback 恢复 | L2/L4 通过 |

### 3.1 脚本开发期被自身守卫拦下的两个真实缺陷（如实留档）

1. **A3 锚点自包含**：原设计锚点为单行 `"rail": "VOzbGW_rail",`，而替换文本**包含**该行 ⇒ `post still contains anchor A3` 断言失败。修正为跨两行锚点（`rail`…`trigger`），使 pre-image 不可能是 post-image 的子串。
2. **偏移记账 off-by-one**：原实现在"逐次变异缓冲区"里定位锚点并减去累计 delta，但 **A3 位于 A2 之前**（CSS 行 28 / 类名映射行 54 / JSX 行 115），A2 产生的 delta 被错误地在 A3 上扣减 ⇒ `bytes before anchor A2 drifted`。修正为**先在 pre-image 坐标里定位、再按升序拼接并累计位移**。若没有"保留段逐段字节比对"这条守卫，此缺陷会**静默产出错位 1 字节的文件**——这正是要求 `node --check` + 字节断言的用途。

---

## 4. 器械复用与保真台账（**必须披露的偏离**）

器械 = 审计 `program/w11-mask-look/tools/` 的**逐字节副本**，落在本档 `tools/`。因目录深度不同，副本与原件有**精确 3 处路径常量差异** + 2 处**纯加性扩展**：

| 文件 | 与审计原件的关系 | 差异明细 |
|---|---|---|
| `summarize-look.mjs`、`recon-dom.mjs`、`verify-report-numbers.mjs` | **IDENTICAL**（逐字节） | — |
| `look-arms.mjs` | +45 / −2 | −2 = `EXEC_MASK` 与 `probe-lock.mjs` 的相对深度（`../../`→`../`）；+45 = **新增臂 `ringBandsReal`** 及其臂控/完整性断言 + JSON 记录 `ringLookCandidate` |
| `look-probe.js` | **+95 / −0（纯加性，零删除行）** | 新增 `P.deployedRingState()` 与 `probeState().deployedRing` 一个字段；既有通道（LoAF/rAF/LongTask/churn/自证）**一行未动** |
| `look-pixdiff-v2.mjs`、`ab-compose.mjs` | +1 / −1 | 仅 `png-read.mjs` 的相对深度 |
| `tools/crop.mjs`、`tools/verify-report-numbers-v2.mjs`、`tools/mask-func-regress.mjs` | **本档新增**（不在审计原件内） | 见各节说明 |

**为什么必须新增 `ringBandsReal` 臂**：审计的 `ringBands` 臂是 `serve: PRE`（**含 blur 的 pre-image 字节**）+ 页内注入（`mask.style.display='none'`、JS 量出面板矩形后插 4 个绝对定位 div）。它证明的是**想法**，不是**交付物**：真实现走的是"候选字节 + CSS `calc()` 几何 + React 子元素"，两者在字节、几何来源、DOM 位置上都不相同。故本档新增一个 **`serve: 候选字节、ablate: null`（零注入）** 的臂，其身份被 sha256 钉死（`--ringlook-sha` 可覆盖），并在运行时用 `deployedRing` 通道自证"送到的字节真的产生了预期的 DOM 与几何"。两条臂在**同一 rep 内相邻**跑，可直接比对（§8 显示二者观感数字逐位相同、代价同级）。

---

## 5. 批次协议与并发记账（**不声称机器安静**）

| 项 | 值 |
|---|---|
| 浏览器 | 真实 Google Chrome **153.0.8010.52**（`channel:'chrome'`，headless） |
| 视口 | 2560×1440 @ DSF 2（用户真实窗口尺寸），每臂全新 context |
| 送达方式 | **真字节**：`context.route()` 用各臂字节应答 `/plugins/@deepseek-ai/dsh-client-ui-settings-general/client.js`（12/12 臂次均命中 1 次且 sha 与臂声明一致，T5 表） |
| 臂序（同 rep 内连续） | `blur2`（真模糊，对照"观感上限"）→ `shipped`（现状，对照"无观感零代价"）→ `ringBands`（审计注入臂）→ **`ringBandsReal`（本档真字节交付物）** |
| 相序列 | 9 相/臂/rep：`IDLE_OPEN_1` → `NAV_general` → `SCROLL_general` → `NAV_models` → `NAV_plugins` → `TAB_pluginsList` → `SCROLL_pluginsList` → `IDLE_OPEN_2` → `NAV_general_back`（弹窗开一次，全程不关） |
| 判据 | 主 = **LoAF**（条数 + duration）；副 = **wall-clock rAF 间隔**（回调入口 `performance.now()`）；`framesGt50`/`ts` 仅作相对 KPI；**只用同 rep 相邻配对** |
| 锁 | `.workspace/lag-fix/lib/probe-lock.mjs`：**BUSY → 未夺取、未回收**（持有者 `w07-exec-proj` pid 948439，`liveness: ALIVE`），`lockMode = concurrent` |
| 负载 | 逐 rep 实测 `foreign`=**26** 个浏览器主进程、`loadavg`=**6.56 / 5.96 / 9.75**（rep3 起点 9.75 偏高，如实保留） |

---

## 6. 批内自證：判据通道全部活着（四通道同一 120 ms 块）

| rep | 引擎 | 前台帧率 | trace 事件 / RunTask | 阴性对照（3 s 不注入） | 阳性对照（**页内 setTimeout** 120 ms） | 地面真值 `RunTask` |
|---|---|---|---|---|---|---|
| 1 | Chrome 153.0.8010.52 | 64.0 Hz | 87 396 / 19 627 | 180 帧、中位 16.7、max 17.1、gt50 **0**、LoAF **0**、LongTask 0、RunTaskMax 0 | wall 131.2 / LoAF 1 条 131.3 ms | **120.40 ms** |
| 2 | 同 | 66.2 Hz | 95 827 / 21 696 | 180 帧、16.7、max 17.0、gt50 **0**、LoAF **0**、LongTask 0、RunTaskMax 0 | wall 131.2 / LoAF 1 条 131.2 ms | **120.59 ms** |
| 3 | 同 | 61.5 Hz | 111 602 / 26 063 | 180 帧、16.7、max 20.3、gt50 **0**、LoAF **0**、LongTask 0、RunTaskMax 0 | wall 129.3 / LoAF 1 条 129.3 ms | **120.53 ms** |

- 阳性对照按规则 19 用**页内 `setTimeout`** 注入（不是 CDP `evaluate`）；`RunTask`（trace 类别含 `disabled-by-default-devtools.timeline`，RunTask 非 0）四舍五入到 **120.4 / 120.6 / 120.5 ms**，与注入量吻合。
- **阴性对照 3/3 干净**（LoAF 0、gt50 0、RunTaskMax 0）——本批比审计的 run1（2/3 有杂音）更干净。
- churn 通道自测：每臂开窗前做一次真实 DOM 变更阳性对照，`detected=true` 才继续。

---

## 7. 运行时臂控：真字节交付物的"意图自证"（本档新增证据）

`ringBandsReal` 臂不是"送字节就完事"：它在**开窗后（mid）与整个相序列结束后（end）各读回一次**，共 **6 次观测**，全部满足：

| 断言 | 实测（6/6） |
|---|---|
| 环带元素数 = 4（`VOzbGW_ring` + Top/Bottom/Left/Right） | `4,4,4,4,4,4` |
| 每块环带 `backdrop-filter` = `blur(2px)` | 全 true |
| mask 本身不再绘制（`backdrop-filter:none` + `background:rgba(0,0,0,0)`） | `none/rgba(0, 0, 0, 0)` ×6 |
| `--w11-ov ≥ border-radius` | `32>=24` ×6 |
| **CSS 几何 == 浏览器实测面板盒内缩 32 px** | **`geometryMaxAbsDelta = 0 px`**（不匹配项 0 条）×6 |
| 环带并集 = 视口 − 洞（175 采样点/次） | 未覆盖点 **0**、洞内漏覆盖 **0** ×6 |
| `--w11-pw/--w11-ph` 与面板表达式逐字符相同 | ✓ |
| 相序列结束后**未被 React 抹掉**（end 与 mid 一致） | ✓ |

**实测几何（rep1，CSS px）**：面板 `(880,320) 800×800` ⇒ 洞 `x 912…1648, y 352…1088`；`Top (0,0) 2560×352` · `Bottom (0,1088) 2560×352` · `Left (0,352) 912×736` · `Right (1648,352) 912×736`；scrim `rgba(0,0,0,0.24)`；`elementFromPoint` 命中：`(200,700)→ringLeft`、`(2360,700)→ringRight`、`(1280,100)→ringTop`（即指针确实落在环带元素上，再冒泡到 mask）。

---

## 8. 代价（主判据）：交互相 LoAF

（同批、同 rep、9 相 × 3 rep；`*` = 规则 W11-R1 标注窗口，本批**无污染窗口**）

| 臂 | LoAF Σ | LoAF ms Σ | **交互相 LoAF Σ** | 空闲相 LoAF Σ | **>50 ms 帧 Σ** | 单相 wallMax 上限 | 逐 rep 交互相 LoAF |
|---|---|---|---|---|---|---|---|
| `blur2`（真模糊） | 47 | 3591.3 | **46** | 1 | **46** | 116.7 ms | 16 / 16 / 14 |
| `shipped`（现状无模糊） | 0 | 0 | **0** | 0 | **0** | 29.5 ms | 0 / 0 / 0 |
| `ringBands`（审计注入臂） | 2 | 118.3 | **1** | 1 | **5** | 70.0 ms | 0 / 1 / 0 |
| **`ringBandsReal`（本档真字节）** | **1** | **60.5** | **1** | **0** | **1** | **64.1 ms** | **0 / 0 / 1** |

- **主判据达成**：交互相 LoAF **1 ≤ 2**（且逐 rep `0/0/1` 均 ≤2）；`>50 ms` 帧 **1 ≤ 8**。
- **对照强度**：同 rep 相邻配对（`summarize-look.mjs` T4）——`ringBandsReal` 的 21 个交互相配对里 **19 相 LoAF 更小、2 相相同、0 相更大**（vs `blur2`），LoAF 比值 **0.02**；wallMax 中位 **39.8 ms vs blur2 的 74.4 ms**。
- **残差如实**：`ringBandsReal` 仍有 1 条 LoAF（rep3 `TAB_pluginsList`，wallMax 64.1 ms）。逐相 wall 帧上限的分布同样说明残差真实存在：7 个交互相 × 3 rep = **21 个相-次中，17 个的上限落在 32.6–64.1 ms**，仅 4 个回落到 16.8–19.5 ms（= 与无模糊不可区分）；对照 `shipped` 的 21 个相-次**全部 ≤ 25.5 ms**、`blur2` 为 16.9–116.7 ms、`ringBands`（注入臂）为 16.9–70.0 ms。⇒ 审计 §4.②′ 记的**"环带自身的残余 floor"**在真字节实现上同样存在，方向与量级一致。中位数：`ringBandsReal` 交互相 wallMax 中位 **39.8 ms**（`blur2` 74.4 ms、`shipped` 17.1 ms）。
- 审计 §7 记的"可选后续（`--w11-ov` 收到 0 + 不带 blur 的圆角补丁）"**本批未做**（时间预算用于把真字节实现与四项验收做扎实）。**不把预测当结论**：审计 §8 L3 已标"纯预测、未实测"，本档同样标注为未实测。

---

## 9. 观感（副判据）：逐像素差 vs 真模糊 + 人眼复核

（同一 rep1、同一状态、2560×1440@2 截图；参考 = 同批 `blur2`；"环带"口径 = 面板盒按 24 CSS px 外扩后的**补集**，11.87 M 设备像素 = 全图 80.5 %）

| 臂 | 环带 平均\|Δ\| | **环带 >2/255** | 环带 >8/255 | max | 面板内部 平均\|Δ\| | 判定 |
|---|---|---|---|---|---|---|
| 噪声地板（`blur2` 跨 run 空对照：本批 vs 审计 run1，同字节同状态） | **0.0000** | **0.0000 %** | 0 | **0** | 0 | — |
| **`ringBandsReal`（交付物）** | **0.0029** | **0.0235 %** | **0 %** | **8** | **0** | ✅ **人眼不可辨** |
| `ringBands`（审计注入臂，同批复现） | 0.0029 | 0.0235 % | 0 % | 8 | 0 | 与审计 run2 **逐位相同** |
| `shipped`（现状 = 用户想改回的差距） | **1.111** | **15.3177 %** | 0.9608 % | 161 | 0.0009 | 差距真实存在 |
| `filterContent`（次选③-a，同批参照） | 0.0651 | 0.4063 % | 0.036 % | 16 | 0.0009 | 97 % 恢复 |

- **判据达成**：均值 **0.0029 ≤ 0.05**；`>2/255` **0.0235 % ≤ 0.1 %**；噪声地板 **0 <** 残差（空对照严格为零，即同字节同状态的截图**逐像素完全相同**）。
- **残差定位**：`ringBandsReal` 的 `>2/255` 像素 **合计 2 788**（全图 14.75 M 设备像素的 0.019 %），**全部落在 8×8 网格的第 1、6 行**（= 两条水平带缝：面板上沿外扩线 CSS y≈352、下沿 y≈1088），每行**恰好 6 个非零格**且是**面板 x 区间之外**的 6 列（网格第 3、4 列恒为 0——被不透明面板盖住的地方没有缝），`max = 8/255`。**与审计 run2 的注入臂结论（2 788 像素、第 1/6 行、max 8/255）逐项一致。**
- **人眼复核（1:1 裁剪叠图，`shots/ab/`，本档自建）**：评审原文——
  - 侧栏**高对比文字区**（`AB_sidebarText__blur2_vs_ringBandsReal.png`）："*the two halves appear visually identical… No seam line, brightness step, or sharpness discontinuity is visible between the halves… the patched construction appears to reproduce the original full-viewport backdrop blur without any noticeable visual regression.*"
  - 带缝区（`AB_seamTop/Bot__blur2_vs_ringBandsReal.png`，裁在 y=320–384 / 1056–1120 CSS px，**正对带缝**）："*I cannot identify a band of differing lightness… no seam, same degree of softness, no visible boundary*"。
  - **反证**：`AB_chatLeftOfPanel__blur2_vs_shipped.png`（现状 vs 真模糊）："*the bottom half is noticeably sharper… in the top half the outlines read as soft gradients; in the bottom half they read as distinct, continuous strokes*" ⇒ **本补丁恢复的是用户看得见的东西**，不是"数值上的自我安慰"。

---

## 10. 功能回归（③ 点击环带 / Esc / 焦点陷阱）——**独立档产出**

器械：`tools/mask-func-regress.mjs`（由二级 subagent 独立实现并运行；原始 JSON `raw/func-regress-20260922T074351Z.json`，逐 arm sha 运行时校验、漂移即 ABORT）。

| 检查 | `armA_blur2`（历史基线） | `armB_shipped`（当前 live） | **`armC_ring`（交付物）** |
|---|---|---|---|
| contract（a11y + 指针归属 + 真点击接线） | PASS | PASS | **PASS** |
| closeByRingClick（环带两处 `(200,700)`/`(1280,100)` 真点击关闭） | PASS | PASS | **PASS（1–3 ms 关闭）** |
| closeByEscape | PASS | PASS | **PASS** |
| noCloseInsidePanel（面板内点击不关闭 + 导航项真的激活） | PASS | PASS | **PASS** |
| focusAndTab（初始焦点 = 关闭按钮；12 步 Tab 序列） | PASS | PASS | **PASS** |
| reopen（2 轮开/关循环） | PASS | PASS | **PASS** |
| *补充*：`ringOverlapBand`（32 px 环带/面板重叠环带内 10 px 处真点击**不得**关闭，且 4 个点须命中面板子树） | PASS | PASS | **PASS** |

- **臂控**：`armC_ring` 送达 sha = `0853da8858dc…`（= 候选件），1 次拦截 + HTTP 200，`pageErrors = []`。
- **patch 特有风险已关闭**：环带与面板重叠 32 px，但**面板边缘内 10 px 的 4 个点全部命中面板子树**且真点击后面板**保持打开**；环带上的点击**命中环带元素**（不是 mask）并**经冒泡关闭**——即"多出来的 4 个子元素"既不偷面板的点击，也不丢 mask 的关闭路径。
- **诚实披露（不重新分类）**：预注册差分规则（"C 与 B 每项可观测结果必须相同"）给出 **5/6 相同 + `focusAndTab` = FAIL**；该 FAIL 的差异**仅是 12 步 Tab 窗口内容整体位移一格**（B 窗口首项 `Workspace Write`，C 窗口首项 `标准模式（子代理 deepseek-v4.1-flash）`）。四项独立证据表明**不是补丁所致**：① 同一差异在 run1 的 **A vs B**（两个都无环带、无补丁）之间也出现过、在 canonical run 又消失；② 面板内容集本身不确定（交错 B→C→B→C… 时 **两个臂各自**都产出过 24/25 两套可聚焦控件集）；③ 把该应用侧控件剔除后，面板 DOM 序可聚焦列表在**两臂 8 次观测中哈希到同一个值** `e6d3652b9f`，且两两 `LCS == min(len)`（**纯插入、无重排**）；④ 字节层面：候选件对现状的差量仅 `.VOzbGW_mask` 规则（删 1 加 1）+ 4 条 `.VOzbGW_ring*` + 5 个类名键 + mask 内 4 个 `<div>`，**21/22 条既有 CSS 规则逐字节相同**，`aria-hidden` 与 `onClick` 保留。⇒ 本档按 ③ 的验收（"点击环带 / Esc / 焦点陷阱**三项回归**"）判 **PASS**，同时**原样保留**该差分 FAIL 的读数与其解释，供协调者裁决。

---

## 11. 污染窗口：规则沿用、保留不删（④ 纪律）

- **事前规则 W11-R1 原样沿用**：任一臂窗口若 `IDLE_OPEN_2` 的 LoAF > 0 ⇒ 该 rep 该臂窗口判**环境污染**，读数**标注但不作主判据**。
- **本批判据批实测：`IDLE_OPEN_2` 的 LoAF = 0，12/12 个臂窗口全部干净**（4 臂 × 3 rep：`0,0,0,0,0,0,0,0,0,0,0,0`）⇒ **本批 0 个污染窗口**。
- **窗口一个都没删**：`raw/look-20260922T073213Z.json` 内含 12 个臂记录 × 9 相 = **108 个相窗口全部保留**，`summarize-look.mjs` 逐相输出（`report-assets/summarize.txt` T3）。
- **INVALID 批次保留并标注**：`raw/look-20260922T073126Z.json` 是**冒烟批**（1 rep、缩短相时长 `--idle-ms 800 --settle 700 --scroll-ms 400`、仅 1 臂），**不作为判据**（相时长不同 ⇒ LoAF 数不可与判据批比较），仅用于器械调试留痕。本档**未因它"干净"而引用它**（其 `ringBandsReal` 读数 0 条 LoAF 出现在 §8 之外、不入判据）。
- 锁全程 `concurrent`（兄弟线 `w07-exec-proj` 持有，**未夺取/未回收**），`loadavg` 5.96–9.75、`foreign` 26 —— **不声称机器安静**，判据全部为同 rep 相邻配对。

---

## 12. 验收裁决（审计 §7，不可放宽）

| # | 审计验收条款 | 判据 | 实测 | 对照 | 结论 |
|---|---|---|---|---|---|
| ① | 交互相 LoAF **≤2** | ≤2 | **1**（逐 rep 0/0/1） | `blur2` = 46、`shipped` = 0 | ✅ **PASS** |
| ① | `>50 ms` 帧 **≤8** | ≤8 | **1** | `blur2` = 46、`shipped` = 0 | ✅ **PASS** |
| ② | 环带像素差 **≤0.05 均值** | ≤0.05 | **0.0029** | 噪声地板 0.0000 | ✅ **PASS** |
| ② | 环带 **≤0.1 % >2/255** | ≤0.1 % | **0.0235 %** | `shipped` 15.3177 % | ✅ **PASS** |
| ③ | 点击环带 / Esc / 焦点陷阱 回归 | 与现状臂一致 | **6/6 检查 PASS，5/6 差分一致，第 6 项已证非补丁所致（§10）** | A/B 同项 PASS | ✅ **PASS**（附 §10 披露） |
| ③ | `--w11-ov ≥ border-radius` | ≥24 px | **32 ≥ 24**（运行时读回） | — | ✅ **PASS** |
| ④ | 回滚 = `cp` 回 `bd7edeae…` | 一步可达 | `candidate/client.js.pre` = `bd7edeae…`；`apply-MaskLook-v1.mjs --rollback` 沙箱实测 `rolled-back` | — | ✅ **PASS** |
| 附加 | 真字节实现的几何正确性 | CSS 几何 == 实测面板盒 | **`geomMaxΔ = 0 px`、覆盖 175/175、洞内漏 0** | — | ✅ **PASS（超出审计的加强项）** |

**判据自检**：`tools/verify-report-numbers-v2.mjs` 把本报告引用的每个关键数字与原始 JSON 对齐 ⇒ **40 PASS / 0 FAIL**（`raw/report-numbers.json`，与审计自检同为 40 条）。

---

## 13. 复核器械与复现命令

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-masklook

# ① 补丁脚本自检（不写任何东西）
node apply-MaskLook-v1.mjs                                       # dry-run: status=dry-run-ok, delta=+1491
node apply-MaskLook-v1.mjs --out candidate/client.js --apply     # 重建候选件(幂等: 已存在则 already-applied)

# ② 验收批（4 臂 × 3 rep；锁被占用时加 --allow-concurrent 并如实记账）
node tools/look-arms.mjs --reps 3 --shot --allow-concurrent \
  --arms blur2,shipped,ringBands,ringBandsReal

# ③ 全部表格（含每臂汇总 / 逐相 / 同 rep 配对 / 臂完整性）
node tools/summarize-look.mjs --out raw/SUMMARY.json

# ④ 逐像素差 + 1:1 裁剪（第二个 batch 仅用于提供跨 run 空对照）
node tools/look-pixdiff-v2.mjs --batches raw/look-20260922T073213Z.json,\
  ../../program/w11-mask-look/raw/look-20260922T063959Z.json

# ⑤ 带缝 1:1 裁剪 + A/B 叠图（本档新增 crop.mjs）
node tools/crop.mjs --in shots/w11-ringBandsReal-20260922T073213Z.png --x 100 --y 320 --w 620 --h 64 --out shots/ab/seamTop__ringBandsReal.png
node tools/ab-compose.mjs --a shots/ab/seamTop__blur2.png --b shots/ab/seamTop__ringBandsReal.png --out shots/ab/AB_seamTop__blur2_vs_ringBandsReal.png

# ⑥ 功能回归（差分）
node tools/mask-func-regress.mjs

# ⑦ 报告数字自检（应输出 40 PASS / 0 FAIL）
node tools/verify-report-numbers-v2.mjs
```

---

## 14. 同档自复核：**PASS**（附 5 条必须随交付转达的残余）

**自裁决：PASS。** 四项验收不可放宽条款全部达成，且**证据是"真字节 + 零注入 + 运行时自证几何"三级加固**的，比审计的注入臂更强；补丁脚本经完整生命周期自测（dry-run → apply → 幂等 → rollback → 幂等 → 污染拒绝），开发期被自身守卫拦下并修正了 2 个会产生错位文件的真实缺陷。**未发现需要返工的项。**

必须随交付转达的残余/边界（不隐藏）：

1. **残差 floor 真实存在**：真字节臂 21 个交互相-次里 17 个的 wall 帧上限落在 **32.6–64.1 ms**（`shipped` 全部 ≤25.5 ms）；即"1 px 带缝 + 4 块独立模糊面"本身有代价（主判据仍为 1 条 LoAF / 1 个 >50 ms 帧，但**副判据的残差是真实的、未抹平**）。审计 §7 的"ov=0 + 圆角 scrim 补丁"仍是**未实测的预测**，本档未做，不得当作结论。
2. **带缝 1 px**：`max = 8/255`、2 788 设备像素、正对带缝的 1:1 裁剪在人眼下**不可辨**；若协调者在**物理屏**上看到，按审计 §7 已知残差处置（左右带上下各外扩 1 px，代价是重叠处 scrim 叠加成 1 px 偏暗线）——**本档未采用该变体**。
3. **真机/物理屏未验**：全程 headless（无分数缩放重采样、无核显合成、无 mutter）。本档迁移的是**效应方向 + 同 rep 配对 + 逐像素差**，不是绝对帧数（沿用审计 §8 L1）。
4. **臂序未做 counterbalance**（沿用审计 §8 L7）：臂序固定，关键结论跨 4 臂同批复现，但**未排除顺序混杂**。
5. **`framesGt50` 只作相对 KPI**（沿用审计 §8 L8，分辨下界 ≈40–50 ms）：本档**未**用它下"无 25–45 ms 停顿"的结论。
6. **本档范围**：未碰 `createPortal`（审计 §5 纪律 5：`portalFilter` 3/3 被 React 打回、真实现未测）；未碰其它全视口遮罩（`fNh4Da_mask` 灯箱 / shell `Modal` / `_onboardingMask_*` / `dsh-btw` 遮罩，沿用审计 §8 L9）；未改 `--dsw-mask-blur` 令牌（会波及 4 个消费者）。

---

## 15. 产物清单

| 路径 | 内容 |
|---|---|
| **`report.md`** | 本文件 |
| **`apply-MaskLook-v1.mjs`** | 补丁脚本（dry-run 默认 / `--apply` / `--rollback` / 幂等 / 全或无 / 标记核对 / `node --check`） |
| **`candidate/client.js`** | **候选件**（`0853da8858dc…`，28084 B） |
| `candidate/client.js.pre`、`candidate/client.js.manifest.json` | 候选源字节（= live `bd7edeae…`，**`cp` 回滚即用它**）与候选 manifest |
| `preimage/`（空，落点模式尚未执行）、`report-assets/lifecycle/` | 落点模式 pre-image/manifest 的目标目录；以及**脚本全生命周期自测**沙箱（L1 dry-run → L2 apply → L3 幂等 → L4 rollback → L5 幂等 → L6 污染拒绝），沙箱内文件与落点**无关** |
| `raw/look-20260922T073213Z.json` | **判据批**原始数据（4 臂 × 3 rep × 9 相，108 个相窗口全保留） |
| `raw/look-20260922T073126Z.json` | **冒烟批**（1 rep/1 臂，**不作判据**，保留） |
| `raw/pixdiff-look.json` | 逐像素分区差（4 区域 + 环带 8×8 网格 + 跨 run 空对照） |
| `raw/func-regress-20260922T074351Z.json`（+ 2 个补充 run） | 功能回归差分原始数据 |
| `raw/report-numbers.json` | **报告数字自检**（40 PASS / 0 FAIL 的机器可核产物） |
| `raw/SUMMARY.json`、`report-assets/summarize.txt` | 全部表格（T1 自證 / T2 汇总 / T3 逐相 / T4 同 rep 配对 / T5 臂完整性） |
| `logs/look-20260922T073213Z.log`、`logs/batch1.stdout.log`、`logs/func-regress-*.log` | 逐批日志（含逐臂逐相 LoAF 打印） |
| `shots/w11-<arm>-20260922T073213Z.png`（**4 张全页截图**）、`shots/crops/*.png`（**32 张 1:1 裁剪**，4 臂 × 4 区域）、`shots/ab/*.png`（**14 个文件 = 8 张叠图 + 6 张正对带缝的 1:1 裁剪**） | 截图证据 |
| `tools/`（7 个审计器械副本 + `look-arms.mjs`/`look-probe.js` 加性扩展 + `crop.mjs` + `verify-report-numbers-v2.mjs` + `mask-func-regress.mjs`） | 器械；与审计原件的差异见 §4 保真台账 |
