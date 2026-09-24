# exec-shellfix · 修订执行复核一体档报告（U-SH1 / U-SH2 / U-SH3 / U-SH4）

> **档位**：W24 三栏 shell 审计的**修订执行复核一体**档。按审计结论逐条落地，**不重新拆解、不扩范围**。
> **独占目录**：`.workspace/lag-fix/exec-shellfix/`（本档全部写入都在此目录内，**未写入任何部署路径**）。
> **审计契约**：`program/w24-shell/audit.md`（554 行，§① 布局 store / §② 三段手柄 / §③ 响应式 / §④ 焦点与层级）
> + `section-02-handles-static.md` + `section-04-focus-zindex.md` + `raw/*.json` + `evidence/*.png`。

---

## 0. 口径、基线锚定与并发条件

| 项 | 值 | 核对方式 |
|---|---|---|
| GUI / 宿主 | `http://127.0.0.1:3080`，宿主 pid **2988915**（本档未触碰，**未重启/未 pkill 任何浏览器**） | 未做进程操作；仅 headless 自建 Chromium |
| 权威产物 | `$H/dsh-client-ui-layout/lib/client.js` **md5 `ed91f7f345cb91c87a941088fc5dba71` / 907 行** | 开工核对 + `curl` served **与磁盘同值**（`ed91f7f3…`）；每次探针运行前**再核一次**，不符即拒绝出报告 |
| `$H` | `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai` | — |
| 候选字节 | `candidates/deploy.client.js` md5 **`feaedc5d28fcfb5c29ec59036bf65cce`** / 1028 行（**最终验收全部跑在此字节上**） |
| 引擎 | **playwright 1.49.1 自带 Chromium 131**（`HeadlessChrome/131.0.6778.33`），viewport 1280×800，DPR 1 | 每次运行打印 UA |
| **绝对帧时** | **不跨线比**（用户 Chrome 153）⇒ 本档只用**同窗 A/B 与比值**；绝对 ms 均标注并发条件 | — |
| 探针锁 | `lib/probe-lock.mjs`；本档 **run2/run3/run4 均 ACQUIRED（持锁）**，run1 亦 ACQUIRED。⚠️ 每次运行启动时锁显示前一持有者已 `DEAD`（那是本档上一次运行自己的锁，进程确已退出）⇒ 按库的"确证死亡才回收"规则回收，**未回收任何存活兄弟线的锁** | 报告 JSON 的 `lock` 字段 |
| 机器安静门禁 | **不成立**（审计实测空闲 20 s 仍有 24 事件，本机同期有 10+ 条兄弟线在飞）⇒ 结论一律同窗对照/比值 | `foreign` 计数逐窗记录 |
| 二级 subagent | **0 / 2（未使用）**：本档为单一写入者，产物边界清晰，无并行扇出必要；复核按契约**并入本档**完成 | — |

### 0.1 本档**没有**触碰的面（硬性纪律）

grep/字节级确认：`@local/dsh-btw`、`dsh-client-ui-renderer`、`dsh-client-runtime`、primitives（`dsh-web-frontend/dist/assets/*.js`）
**全部零写入**。唯一被改写的候选文件是 `dsh-client-ui-layout` 的 `lib/client.js` 与 `lib/types/client/columns.d.ts`（后者纯文档、无运行时作用）。

---

## 1. 交付物

| 类别 | 文件 | 说明 |
|---|---|---|
| **补丁器** | `tools/apply-ShellFix-v1.mjs` | dry-run 默认 / `--apply` / `--rollback` / `--target` / `--dts` / `--units` / `--json` / `--list`；锚点唯一命中否则零写入；自动 pre-image；`node --check`；幂等；逐单元回滚 + 依赖强约束 |
| **候选件** | `candidates/deploy.client.js`(**落地目标**)、`candidates/deploy.columns.d.ts`、`candidates/ush4-only.client.js`（不落地）、`candidates/ush1|ush2|ush13.*`（单单元留档）、`candidates/baseline.*` | 全部通过 `node --check` |
| **探针** | `tools/probe-shellfix.mjs`（验收全窗）、`tools/probe-recon.mjs`（侦察 + 夹具自证）、`tools/diag-hint.mjs`（可视提示判定）、`tools/verify-ush2-equivalence.mjs`（纯函数等价性）、`tools/sh-init.js`（页内仪表，沿用 `w24-init.js`） | — |
| **落地手册** | `DEPLOY.md` | 落地/回滚/最小验收/风险 |
| **原始证据** | `raw/*.json` + `raw/*.log` | 见 §10 索引 |
| **截图** | `evidence/*.png` | 含手柄可视提示前后对比（§5.5） |

### 1.1 候选字节指纹

| 文件 | md5 | 行数 |
|---|---|---|
| 基线 `lib/client.js` | `ed91f7f345cb91c87a941088fc5dba71` | 907 |
| 基线 `lib/types/client/columns.d.ts` | `5cc5169b7511062170f442167b08c904` | 60 |
| **`candidates/deploy.client.js`** | **`feaedc5d28fcfb5c29ec59036bf65cce`** | **1028** |
| **`candidates/deploy.columns.d.ts`** | `66e47c34a0f1983f91aa2a511cb85eef` | 68 |
| `candidates/ush4-only.client.js` | `3f7f90b1960b426a0ccea20799a047ef` | 911 |

---

## 2. 补丁器自证（纪律 1 逐条）

| 纪律 | 实现 | 实测证据 |
|---|---|---|
| dry-run 默认 | 不带 `--apply` 只核对与打印 | `raw/apply-dryrun-1.json`：全部 span `old×1 new×0`，零写入 |
| **锚点唯一命中否则零写入** | 任一 span `old` 命中 ≠ 1 ⇒ 整轮 `die`（写循环之前） | 本档 4 次实测触发（含一次因自身缺 anchor 导致的正确拒绝） |
| 自动 pre-image | 首次写入前 `cp <t> <t>.pre-ShellFix-v1.bak` + sha256 前后值入 JSON | `raw/apply-*.json` 的 `targets[].sha256_before/after` |
| `node --check` | 写 `<t>.shellfix-v1.tmp.js` → 检查 → 原子 `rename`（失败即删临时文件） | 全部候选 `node --check` OK；失败路径实测过一次并已修正（`.tmp` 扩展名会被 node 拒绝） |
| 幂等 | 每 span 三态机（`applied` 优先于 `baseline`，避免"new 以 old 为前缀"导致二次注入） | 二次 `--apply` ⇒ 全部 `already-applied`，**md5 不变**（`identical=YES`） |
| **每单元独立回滚** | 反用各单元自己的 (old,new) 对；**依赖强约束**（见下） | `--apply(ush1,ush2,ush3)` → 逐个 `--rollback` ⇒ 两个文件都回到基线 md5，**逐字节一致** |
| 依赖约束 | `ush3.requires=['ush1']`（ush3 的渲染面引用 ush1 引入的 `onPointerCancel`/`onLostPointerCapture`） | 实测 `✖ 回滚 ush1 被拒：依赖它的 ush3 仍存在于目标文件 ⇒ 会留下引用未定义标识符的产物` |

**最终一致性认证**（对交付字节再做一遍，2026-09-22 收尾）：

```
apply(ush1,ush2,ush3)  →  /tmp/rt.client.js md5 = feaedc5d…   ==  candidates/deploy.client.js  ✅ 完全一致
再 apply（幂等）        →  md5 不变                            ✅
rollback(ush3) → rollback(ush1,ush2)
  client.js  → ed91f7f345cb91c87a941088fc5dba71  == 基线      ✅
  columns.d.ts → 5cc5169b7511062170f442167b08c904  == 基线    ✅
部署树未被本档写入：lib/client.js ed91f7f3… / columns.d.ts 5cc5169b… / served == 磁盘  ✅
```

**逐字节往返**（最强回滚证据）：

```
client.js   : ed91f7f345cb91c87a941088fc5dba71  →  apply  →  rollback  →  ed91f7f345cb91c87a941088fc5dba71   IDENTICAL
columns.d.ts: 5cc5169b7511062170f442167b08c904  →  apply  →  rollback  →  5cc5169b7511062170f442167b08c904   IDENTICAL
```

---

## 3. U-SH1 · C2 拖拽卫生（低风险，必做）

### 3.1 逐条落地

| 子项 | 实现（`lib/client.js`，全部在 `DragHandle`/`AppFrame`） | 与审计条文对应 |
|---|---|---|
| ① 只认主键 | `onPointerDown` 首行 `if (e.button !== 0) return;`（在 `preventDefault`/`setPointerCapture` **之前**） | C2 改动点 4 |
| ② 取消语义 | 新增 **幂等** 收尾 `finish(e, commit)`：先清 `activeId` → 取消挂起 rAF → 按需提交 → `setDragging(false)` → `onEnd()`；`onPointerCancel`/`onLostPointerCapture` 均 `finish(e,false)`；**并已挂到渲染 props** | C2 改动点 2 |
| ③ 卸载清状态 | 手柄卸载清理：若 `activeId !== null` 则清 rAF + `onEnd()`（父层 `onDragEnd` 仅 `setDragging(false)`，幂等） | C2 改动点 3 |
| ④ 消除死区 | 饱和重定位基准：`raw = base + dx; next = clamp(raw); if (next !== raw) base = next - dx;`（details 侧对称：`base = next + dx`） | C2 改动点 1 |

> ⚠️ **本档自曝并在验证中抓到的一处缺陷（已修正）**：首次生成候选时，`onPointerCancel`/`onLostPointerCapture` **只被定义、没有被挂到渲染 props**（props 仍以 `onPointerUp` 结尾）⇒ 取消语义是**空操作**。是 M4 验收窗（原生事件投递计数 + DOM 状态比对）把它抓出来的，已新增 span `handle-props-attach` 修复并重跑全窗。**这条保留在报告里，作为"验收真的在起作用"的证据，也作为对审计的提醒：props 挂载必须与处理器定义分开核对。**

### 3.2 验收（全部为**同窗 A/B**，基线 = 当前部署字节，候选 = 路由改写注入）

| 判据 | 基线实测 | 候选实测 | 判定 | 证据 |
|---|---|---|---|---|
| **首次生效行程 ≤ 20 px**（超程 300 px 到顶点后回退） | `firstChangeAtDx=130` ⇒ **170 px** | `firstChangeAtDx=290` ⇒ **10 px** | **PASS** | `raw/acceptance.json` M1；run1/2/3 **三次同值** |
| 顶点钳制仍精确 | 420 | 420 | PASS | M1/M5 |
| **卸载后 `data-dragging` 为 `null`** | 卸载后 `"true"`，pointerup 后仍 `"true"`，重新加宽后仍 `"true"`（只有 reload 能清） | 卸载后 **`null`**、pointerup 后 `null`、重新加宽后 `null`；`transition` 全程 **0.3s** | **PASS** | M2 |
| **右键按下宽度不变** | 右键按下即 `dragging="true"`、`transition 0s`；按住移动 280→**360** | 全程 `dragging=null`、`transition 0.3s`、宽度 **280 不变** | **PASS** | M3 |
| **pointercancel 后状态复位** | （基线无取消路径） | 见 §3.3 | **PASS** | M4 |
| **钳制 264/420 不回归** | 264 / 420 | 264 / 420 | **PASS** | M5（`minIs264=true, maxIs420=true`） |
| 「回原点精确复原 280」 | `widthAtOriginAfterApex = 280` | `widthAtOriginAfterApex = **264**` | ⚠️ **CONFLICT-1**（见 §7） | M1 |

### 3.3 M4 取消语义（原生投递计数 + DOM 状态双证）

M4 用**四条投递路径**，并同时记录「浏览器是否真的把该事件派发到手柄」（document 捕获期计数器）
与「拖拽状态是否复位」，把"事件没派发"与"派发了但处理器没跑"彻底分开：

| 路径 | 原生投递（候选） | 基线状态 | 候选状态 | 判定 |
|---|---|---|---|---|
| **M4a 触摸 `touchCancel`**（CDP，trusted） | `pointercancel:1`（trusted，id=2） | `dragging="true"` / `transition 0s` ⇒ **不复位** | **`dragging=null` / `transition 0.3s`** ⇒ **复位** | **PASS** |
| **M4b 真实鼠标拖拽中 `releasePointerCapture`** | （本轮 200 ms 读窗内未见事件；见下注） | 不复位 | 不复位（读窗问题） | 见下注 |
| **M4c 合成 `pointercancel`**（untrusted） | `pointercancel:1`（untrusted） | 不复位 | **复位** | **PASS** |
| **M4d 合成 `lostpointercapture`**（untrusted；`raw/diag-lostpointercapture.json`） | 事件到达手柄 | — | **复位**（且按钮仍按下时继续移动**不再改宽度** ⇒ `activeId` 确被清空） | **PASS** |

> **M4b 的读窗注（本档自曝的仪器限制，不是候选缺陷）**：`releasePointerCapture` 之后浏览器并非派发
> `lostpointercapture`，而是派发**可信的 `pointercancel`**——这一条由紧随其后的独立诊断窗确证：
> 同一动作 + 250 ms 读窗 ⇒ `pointercancel:1 (trusted, id=1)` 且 `dragging=null`、`transition 0.3s`。
> M4b 之所以"未复位"，是因为它在 200 ms 就读了状态，**早于浏览器交付 cancel**。⇒ 该路径**实测 PASS**，
> 计数读数受读窗限制记 INCONCLUSIVE（保留在 §11 I12）。

> **另一处保留**：run1/run2 用「合成 `pointercancel` 判无效」得出的"取消语义不成立"结论是 **invalid**：
> 当时候选**确实**存在"处理器只定义、未挂载到渲染 props"的缺陷（§3.1），且两条路径未分开验。修复后重跑，四路径如上。

---

## 4. U-SH2 · C4 中心下限死代码（低风险，必做）

### 4.1 **选择：B（明确改文档承诺）+ 代码显式化。理由如下。**

审计给的是二选一。**本档选 B**，三条不可行性论证（每条都有文件/实测依据）：

1. **A 会破坏已文档化的不变量**：`lib/types/client/columns.d.ts` 明写 *"The sidebar never concedes: its rendered width is always the drag preference (or the collapsed rail)"*。要在 `details===0` 时兑现 640 中心下限，只能让侧栏让渡：
   - 视口 900、侧栏偏好 420（窄屏手动展开）⇒ 需要 `s ≤ 260`，**低于 `SIDEBAR_MIN = 264`**；
   - 视口 720 ⇒ 需要 `s ≤ 80`，连"折叠导轨 56"之上都只剩 24 px。
2. **A 会破坏窄屏展开的文档化语义**：`SIDEBAR_AUTO_COLLAPSE` 的文档注释原文即为 *"a manual toggle below it **re-expands over the squeezed center**"* ⇒ **挤压中心列正是该特性的设计意图**，不是缺陷。
3. **A 会造成布局溢出**：帧的列模板是 `gridTemplateColumns = "Spx minmax(0,1fr) Dpx"`（`LY:221`），中心是 `minmax(0,1fr)` 弹性轨；在 720 视口强制 `420px 640px 0px` 需要 1060 px > 720 px ⇒ 裁切/横向溢出。
4. **"文档承诺"其实并不无条件**：真正被违反的不是承诺，而是**代码里一处静默不可达的分支**——审计引用的 640 是"让步链目标"，`Columns` 接口文档本就写着 *"center may drop below CENTER_MIN **only at the final fallback**"*，而 `details===0` 时中心列就是 final fallback。**所以正解是把"何时不成立"写清楚，而不是推翻侧栏契约。**

### 4.2 死代码的确证（纯代码级，可判定）

```js
const d1 = d0 === 0 ? 0 : Math.max(300, viewport - s - 640);   // d0===0 ⇒ d1=0
if (s + d1 + 640 <= viewport) return { …, center: 640, … };     // ⇒ 条件与首级 `s + 0 + 640 <= viewport` 逐字相同
```
首级刚刚失败 ⇒ 该级在 `details===0` 时**恒不可达**。（`details>0` 时该级**是活的**：实测
`computeColumns(1220, 280, 360)` ⇒ `{center:640, details:300}`，即把详情从 360 让渡到 300 以保住中心 640。）

### 4.3 代码改动（**逐输入等价**，可穷举证明）

改为显式早退，消除静默退化：

```js
// 详情已关闭 ⇒ 没有可让渡者（sidebar 合约上永不让渡）⇒ 直接进文档所述的 final fallback
if (d0 === 0) return { sidebar: s, center: Math.max(0, viewport - s), details: 0 };
const d1 = Math.max(300, viewport - s - 640);
if (s + d1 + 640 <= viewport) return { sidebar: s, center: 640, details: d1 };
return { sidebar: s, center: Math.max(0, viewport - s), details: 0 };
```

**等价性穷举**（`tools/verify-ush2-equivalence.mjs`，无需浏览器、0.3 秒）：

| 项 | 值 |
|---|---|
| 输入组合数 | **2,149,392**（结构化网格 viewport 0–2600 逐整数 × sidebar 8 值 × details 8 值 + 随机 50 万 + 小数/极端 5 万，对 ush2 / deploy / ush4 三个候选各一遍） |
| 差异 | **0 处** |
| 结论 | **`details>0` 的既有行为逐字节不变**（验收要求），`details=0` 亦不变（只是可读性与文档口径变了） |

定点（与审计实测一致）：`900,s=280,d=0 → center 620`；`900,s=420,d=0 → center 480`；`720,s=420,d=0 → center 300`；
边界 `s=420` 时 `1059→center 639`、`1060→center 640`（阈值 `viewport = s + 640` 精确）。

### 4.4 文档改后文本（验收要求的"改后文本"）

`$H/dsh-client-ui-layout/lib/types/client/columns.d.ts`（**纯文档**，无运行时作用）：

```diff
-/** Center column floor; only the final fallback may go below it. */
+/** Center column floor. It is a **concession target, not a hard floor**: the solver keeps
+ * center >= CENTER_MIN by shrinking details, then by auto-closing them (derived zero width).
+ * Once details are closed there is nothing left to concede — the sidebar never concedes — so
+ * the center becomes the last resort and absorbs the whole deficit (the final fallback).
+ * Consequence: with details closed, a viewport narrower than sidebar + CENTER_MIN yields
+ * center < CENTER_MIN by construction (e.g. narrow-expanded 720 ⇒ 420px 300px 0px). */
 export declare const CENTER_MIN = 640;
```
以及顶部让步链段落追加：
```diff
- * deficit as the last resort. Inputs are the layout store's plain width
+ * deficit as the last resort. When details are ALREADY closed there is no
+ * rung left to concede, so the floor is not binding at all: the center is
+ * the last resort from the first step and falls below CENTER_MIN by
+ * construction (measured: narrow-expanded 900 ⇒ 420px 480px 0px, and 720
+ * ⇒ 420px 300px 0px). Inputs are the layout store's plain width
```
运行时产物内同样补了函数 doc（`computeColumns` 上方），使**代码与文档口径一致**。

### 4.5 U-SH2 验收

| 判据 | 实测 | 判定 |
|---|---|---|
| 窄屏中心列实测（候选） | 900 ⇒ `280px 620px 0px`（center 620 < 640）；720 ⇒ `280px 440px 0px`；520 ⇒ `280px 240px 0px`；1280 ⇒ `280px 1000px 0px`（无回归） | 与"改文档承诺"一支自洽；与纯函数定点**逐值一致** |
| `details>0` 既有行为 | 2,149,392 组输入 **0 差异** | **PASS** |
| 文档已改并给出改后文本 | §4.4 | **PASS** |

> 说明：窄屏实测用 280 的侧栏偏好（复现审计的"中心被挤压"现象）；审计记录的 `420px 480px / 420px 300px` 是同一机制在偏好 420（拖到最大）下的取值，本档的定点表已覆盖该组（`900,s=420→480`、`720,s=420→300`）。

---

## 5. U-SH3 · C3 手柄可达 + 可视 + 持久化（中风险）

### 5.1 落地内容

| 面 | 实现 |
|---|---|
| 语义/键盘 | `role="separator"`、`aria-orientation="vertical"`、`aria-label`（`调整侧边栏宽度` / `调整详情栏宽度`）、`aria-valuenow/min/max`、`tabIndex=0`、`onKeyDown`（`→/←` ±16、`Shift` ±64、`Home/End` 到钳制端、`Enter` 回契约默认宽度；方向按"手柄移动方向"取义：sidebar 在左（→ 变宽）、details 在右（← 变宽）） |
| aria 同步 | `aria-valuenow` 直接绑 `props.value`（= 已解析列宽）⇒ 拖拽与键盘两条路径都自动同步 |
| 可视提示 | CSS 药丸规则从 `[data-side=details]` 扩到两侧（基础规则改为 `.pI_x6G_handle:after`，并补 `.pI_x6G_sidebarCol:hover~…[data-side=sidebar]:after` 揭示规则）；补 `:focus-visible` 焦点环 + 聚焦时显示药丸 |
| 持久化 | `defineStore({init, actions, persist: "dsh.layout.panels"})` |

### 5.2 `persist` 的既有语义核查（**停止条件 1**）

**不触发停止条件**。代码级确证：`SlotRegistry.resolveStore`（`dsh-client-runtime/lib/client.js:295-306`）对 root 作用域走

```js
const key = record.scope === "root" ? ROOT_INSTANCE_KEY : sessionId;
instance = record.scope === "root" ? handle.create() : handle.create(key);   // ← root 不传 scopeKey
```
⇒ `defineStore.create(scopeKey=undefined)` ⇒ `persistKey = decl.persist`（**字面量，无后缀、不按会话分片**）。
实测印证：`dsh.layout.panels` = `{"sidebar":380,"details":0,"narrow":false,"narrowExpanded":false}`，**恰好 1 个新键**。

### 5.3 验收

| 判据 | 基线 | 候选 | 判定 |
|---|---|---|---|
| **Tab×40 每柄 ≥1 命中** | `handleHits = 0`（复现审计） | **`handleHits = 2`**，两侧落点均为 `sidebar` | **PASS（H1）**；H2 见 §5.6 |
| `role`/`aria-*` 非空且 `aria-valuenow` 与列宽一致 | 全 `null` | `role=separator`、`aria-orientation=vertical`、`aria-valuenow=280`、`aria-valuemin=264`、`aria-valuemax=420`、`tabindex=0` | **PASS** |
| 键盘步进精确 | — | `280→296→312→328`（+16×3）`→392`（+64）`→376`（−16）`→420`（End）`→264`（Home）`→280`（Enter 复位）`→264`（Shift+← −64 触底）；`aria-valuenow` **每一步与之逐值相等**；`reachableByTab=true` | **PASS** |
| **reload 后宽度 ≠ 280（真持久）** | 380 → reload → **280** | 380 → reload → **380** | **PASS** |
| **恰多 1 个 localStorage 布局键** | `["dsh.workspace.view.v5","dsh.sessions.current"]` | 追加 **`dsh.layout.panels`** 一个（`layoutish.length = 1`） | **PASS** |
| **焦点陷阱不得回归**（设置弹窗内 Tab×25 逃逸） | （审计基线） | **escapes = 0/25**；`hardCount=1`；`inertLeft=0`（Esc 后全清）；Esc 后 `activeElement = VOzbGW_trigger`、`activeIsOpener=true`（还焦到打开者） | **PASS** |
| 整屏可渲染 | 见 §8 | 见 §8 | **PASS** |

> 关于 `activeIsOpener`：本档第一次测量（程序化 `.click()`）把还焦目标记成 composer 输入框——**那是探针缺陷**（程序化点击不会把焦点交给触发器 ⇒ a11y 层的"打开者"历史退化）。改为**真实鼠标点击**后复现审计的"还焦到打开者" ✓（修正已落地）。

### 5.4 可视提示前后对比（含量化判据）

| 判据（`raw/diag-hint.json`，对**交付字节**重跑） | 基线 | 候选 |
|---|---|---|
| `::after` 计算样式（**与背景内容无关，最硬**） | `content: none`（伪元素根本不存在；`::before` 亦 `none`） | `content: ""`、`width/height 12px/32px`、`background rgb(255,255,255)`、`border 1px rgba(0,0,0,.1)`、**idle `opacity: 0`** |
| **idle vs 悬停 截图是否逐字节相同**（同一页、同一裁剪，只有指针移动） | **相同**（`b9a09167 == b9a09167`）⇒ 悬停**毫无反馈** | **不同**（`34a4b2a8 → 7205634b`）⇒ 悬停**揭示药丸**，且悬停态 `opacity: 1` |
| 视觉核验（多模态） | `diag-baseline-hover.png`：**只有 1 px 分隔线，无任何手柄提示** | `diag-candidate-hover.png`：**药丸存在**（≈12×32、近白填充 + 浅灰描边、居中于分隔线） |
| focus-visible | 不可聚焦（`tabindex=null`） | 可聚焦 + `outline: solid 2px` |

> ⚠️ **一处被自己复测推翻的说法（保留）**：早先一轮我写过"候选 idle 截图与基线 idle 截图逐字节相同 ⇒ 无 idle 常显"。
> 对**交付字节**重跑后该跨模式比对**不成立**（基线 `b9a09167` vs 候选 `34a4b2a8`）——原因是本 GUI 的背景是**活的**
> （水印插画 + 会话内容随时间变化），裁剪区背景像素本就不同，**逐字节比对不是合法判据**。
> 因此"无 idle 常显回归"改由两条与背景无关的判据支撑：① 候选 idle `::after` 计算样式 = `content:"" + opacity:0`；
> ② **同页** `idle == 同页 hover`（基线 true / 候选 false）。结论不变，判据换硬。

**截图证据**：`evidence/diag-baseline-hover.png`（**无**药丸）vs `evidence/diag-candidate-hover.png`（**有** 12×32 药丸，
近白填充 + 浅灰描边，居中于分隔线）；`evidence/hint-{baseline,candidate}-{idle-nohover,colhover,hover,focus}.png`。
用多模态核验结论：基线悬停 = 只有 1px 分隔线、**无任何手柄提示**；候选悬停 = **药丸存在**，尺寸/颜色与 CSS 声明一致。

> ⚠️ **一处曾误判、已定位的读数**：第一次采样把指针留在 (0,0)，而 (0,0) **落在 `sidebarCol` 上** ⇒ 触发列悬停揭示规则，被误读成"idle 常显"。
> 已把 idle 采样前把指针移出侧栏列，并**用截图 md5 逐字节比对**（候选 idle == 基线 idle）证伪"常显"。此为探针缺陷，非产品缺陷。

### 5.5 侧效应（诚实清单）

1. **整份 state 一起持久化** ⇒ `narrow` / `narrowExpanded` 也跨刷新存活（手动窄屏展开会"跨刷新粘住"）。
   只持久化部分字段需要改 `dsh-client-runtime`（**不在本档授权范围**，未触碰）。
2. **aria-label 是硬编码中文**（与线上 UI 语言一致；实测该部署按钮 aria-label 全为中文）。真正 i18n 需把 `ctx.locale` 接进手柄 ⇒ 超出本单元范围。
3. **新增 2 个 Tab 落点**（侧栏展开 +1、详情打开再 +1）：Tab 环由 17 目标增至 18（候选实测 `distinctClasses=18`）。设置弹窗内的焦点陷阱不受影响（§5.3）。

### 5.6 H2（详情手柄）的可观测性

无会话/详情关闭时 `LY:195` 把 `cols.details` 强制为 0 ⇒ **H2 结构上不存在**（审计 §2.1/§2.5 记为 INCONCLUSIVE）。
本档实测环境里会话是活的，但详情列默认关闭 ⇒ `handleCount=1`（仅 H1）。因此：

- **H1 的 Tab/键盘/persist/可视提示 = 全量实测 PASS**（§5.3）；
- **H2 的 Tab 落点与键盘 = 静态确证**（两个调用点共用同一 `DragHandle` 与同一套 props，`ush3/call-sites` span 一次改写两处）+ **未观测**，与审计同口径记为 **INCONCLUSIVE**。

---

## 6. U-SH4 · C1 字段级选择器（**只出候选与脚本，不落地**）

### 6.1 候选内容

`LY:159` 的恒等选择器 `useStore((s) => s)` → 三个原始值选择器（`sidebar`/`details`/`narrowExpanded`），并把
`LY:194-195` 的读数改为这三个值。产物 = `candidates/ush4-only.client.js`（**不进入落地集合**）。

### 6.2 收益证据：**与审计预期相反，故不落地**

同窗 A/B（同一条 90 px 拖拽轨迹，30 次 3 px 移动；Chromium 131；同窗阳性对照**已自证**）：

| 指标 | 基线 | ush4 候选 | 判读 |
|---|---|---|---|
| **`AppFrame` 渲染数** | **32** | **32** | **结构性计数器，完全一致** ⇒ **C1 预期的 "32 → 每写 1 次" 不成立** |
| `DragHandle` 渲染数 | 32 | 32 | 一致 |
| commits | 65 | 64 | 噪声级 |
| 总 PerformedWork | 15377 | 14912 | −3%（run1 实测 15822 vs 15772 = −0.3%；run2 为 −29%）⇒ **跨运行噪声主导** |
| `rafMax` / `over50` | 19.1 ms / **0** | 22.5 ms / **0** | 无掉帧 |
| LoAF count | **0** | **0** | 无长动画帧 |
| **阳性对照**（注入 120 ms 忙等） | `rafMax 124.8 ms`、`over50=1`、`LoAF 1/121 ms` | `rafMax 136.8 ms`、`over50=1`、`LoAF 1/127 ms` | **通道自证成立** ⇒ 上面的 `0` 不是空洞结论 |

**机制解释（与结构计数一致）**：拖拽写的是 `sidebar` 本身，而 `AppFrame` 无论如何都依赖它
（`cols = computeColumns(viewport, sidebar…)`）⇒ 换成原始值选择器**不减少 AppFrame 的重渲染**，
只对"不触及这三字段的写"有效，而拖拽路径不存在这种写。因此审计 C1 验收里的
「`AppFrame` 由 32 次降到每写 1 次」「每帧 pw 比值 ≥5× 下降」**在实测中不成立**。

**结论**：`over50 = 0`、LoAF = 0（且通道已自证）⇒ 按任务书「若判断收益有据可依，必须给出可感证据（>33 ms 帧或 LoAF）再单独请示」，
**本档不给可感证据、不请示、不落地**；候选与脚本保留（`--units=ush4` 可随时产出），落地条件 =
"在**带真实会话**的载荷下复现出 >33 ms 帧或 LoAF 条目"。

---

## 7. CONFLICT-1：④ 死区修复 与「回原点精确复原 280」**数学上互斥**（必须上报）

### 7.1 实测（同轨迹，三次运行同值）

| 轨迹：base 280 → +300（顶点 420）→ 每 10 px 回退到 0 | 基线 | 候选 |
|---|---|---|
| 顶点读数 | 420 | 420 |
| **首次生效行程** | **170 px** | **10 px** |
| **回到 dx=0 的读数** | **280（精确复原）** | **264（= 钳制下界）** |

### 7.2 为什么不能两全（单调性证明）

设 `f(dx)` 为指针位移到列宽的映射，要求：
(B) 非饱和区 1:1：`f(140) = 420`（`= base + 140`，即钳制边界出现在 140 px 处，审计"钳制窗口内逐帧一致"）；
(C) `f(0) = 280`（回原点精确复原）；
(D) 顶点可回退：∃ `dx_v ∈ (140, 300]` 使 `f(dx_v − 20) < 420`（首次生效行程 ≤20 px）。
若要求 (E) 单调不减（推右不缩窄，这是"钳制"的语义前提），则由 (B)+(E) 得 `∀dx ≥ 140, f(dx) = 420`，与 (D) 矛盾。
**⇒ (B)(C)(D)(E) 四者不可能同时成立。** 消除死区必须以放弃 (E)（路径相关映射 = 重定位）或放弃 (C) 为代价。

### 7.3 本档的处置

- **按审计条文实现 ④**（"饱和重定位基准，使首次生效行程 ≤20px"是明确的数值验收，已达标 10 px），
  **并保留**钳制端点精确 264/420、非饱和区 1:1、跨手势无累积漂移（基准每次 pointerdown 由已解析列宽重锚定）。
- 代价是 (C) 在**饱和路径**上不成立（回到抓取点读数为钳制边界）。**这是本档唯一未能同时满足的验收条款**，
  已按纪律上报，请协调者裁决；两条可选处置：
  1. **接受现方案**（推荐）：死区无上界、用户可感，而"饱和后回抓取点差 16 px（280→264）"只在极端拖拽后出现一次；
  2. **保守方案**：删掉 `onSidebarDrag`/`onDetailsDrag` 中各 1 行重定位语句（共 2 行，见 `DEPLOY.md` §4），
     即恢复基线映射、只保留 ①②③——代价是死区照旧。

> 补充：该条款的"无漂移"本意（映射是绝对位移、不逐事件累加）**在候选上仍然成立**：同一轨迹重复执行得到同一结果，
> 且下一次手势完全不受上一次影响（基线每次 pointerdown 重新锚定）。

---

## 8. 整屏可渲染门禁（每模式每窗均检）

判据：frame 容器存在 + `.pI_x6G_centerCol` 后代 > 0 + `pageerror === 0` + 插件失败界面不出现。
⚠️ 按要求**不使用 `[data-slot]` 面积**（运行时多为 `display:contents`，面积恒 0）。

| 模式 | frame | centerCol 后代 | `#root` 文本长度 | 插件错误 UI | pageerror |
|---|---|---|---|---|---|
| 基线 | ✓ | 61–98 | 151–265 | **0** | **[]** |
| 候选（deploy） | ✓ | 75–98 | 193–265 | **0** | **[]** |

（`raw/acceptance.json` 的 `M12_render_gate[*]`；run1/2/3 三次一致。）

---

## 9. 同档自复核：**PASS（含 1 条 CONFLICT-1 上报，1 条 U-SH4 裁决）**

### 9.1 逐条对照任务书验收

| 单元 | 验收条款 | 自裁 |
|---|---|---|
| U-SH1① | 右键按下宽度不变 | **PASS** |
| U-SH1② | pointercancel 后状态复位 | **PASS**（且抓到并修掉了"只定义未挂载"的自身缺陷） |
| U-SH1③ | 卸载后 `data-dragging` 为 `null` | **PASS** |
| U-SH1④ | 首次生效行程 ≤20 px（实测 10 px） | **PASS** |
| U-SH1 回归 | 钳制精确 264/420 | **PASS** |
| U-SH1 回归 | 回原点精确复原 280 | ⚠️ **CONFLICT-1**（饱和路径 264；证明互斥，已上报） |
| U-SH2 | 640 下限真生效 **或** 文档改口径 + 给出改后文本 | **PASS（选 B，改后文本见 §4.4）** |
| U-SH2 | `details>0` 既有行为逐字节不变 | **PASS**（2,149,392 组输入 0 差异） |
| U-SH3 | Tab×40 每柄 ≥1 命中 | **PASS（H1=2 次命中）**；H2 = INCONCLUSIVE（结构不可观测，与审计同口径） |
| U-SH3 | reload 后宽度 ≠280；恰多 1 个布局键 | **PASS**（380 存活；`dsh.layout.panels` 唯一新增） |
| U-SH3 | aria-valuenow 随拖拽/键盘同步 | **PASS**（键盘 9 步逐值相等） |
| U-SH3 | 新 Tab 落点不得破坏 U-A11Y1 焦点陷阱 | **PASS**（Tab×25 逃逸 0/25，还焦到打开者） |
| U-SH4 | 只出候选与脚本，不落地 | **PASS**（并给出"不落地"的实测依据） |
| 纪律 | 探针锁 / 未碰禁改面 / 未重启浏览器 | **PASS** |
| 纪律 | 补丁器：dry-run/唯一锚点/pre-image/node --check/幂等/独立回滚 | **PASS**（§2） |

### 9.2 停止条件核查（三条，全部**不触发**）

1. **`persist` 让"root 作用域不传 scopeKey"的既有语义出问题？** ⇒ **否**。代码级确证 root 走 `handle.create()`（不传参）⇒ 键为字面量；实测恰好 1 个新键、不按会话分片（§5.2）。
2. **640 下限修正会破坏 `details>0` 的既有行为？** ⇒ **否**。2,149,392 组输入 0 差异（§4.3）。
3. **新 Tab 落点破坏焦点陷阱？** ⇒ **否**。设置弹窗内 Tab×25 逃逸 **0**，Esc 后 inert 全清、还焦到打开者（§5.3）。

### 9.3 未定项（诚实清单）

1. **H2（详情手柄）的 Tab/键盘/钳制**：无会话详情打开态 ⇒ 结构不可观测（静态确证 props 一次改写两处）。
2. **带真实会话**（长对话/大工具输出）下的拖拽帧时：本档空树载荷下 `over50=0`；真实载荷未测（只读授权 + 不改产品数据）。
3. **`narrow`/`narrowExpanded` 持久化的产品意图**：本档按"整份 state 持久化"实现，粘性是否符合产品预期需协调者裁决（§5.5）。
4. **`aria-label` 的 i18n**：硬编码中文，locale 切换时不会跟随（§5.5）。
5. **ush4 的收益前提**：仅当真实载荷下出现 >33 ms 帧/LoAF 才值得落地（§6）。

---

## 10. 复现步骤与证据索引

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-shellfix

# 1) 补丁器自证（零写入）
node tools/apply-ShellFix-v1.mjs --units=ush1,ush2,ush3          # dry-run
node tools/apply-ShellFix-v1.mjs --list

# 2) U-SH2 等价性穷举（0.3 秒，无需浏览器）
node tools/verify-ush2-equivalence.mjs

# 3) 全窗验收（headless；用路由改写注入候选字节，不写部署树；约 7 分钟）
node tools/probe-shellfix.mjs                                    # → raw/acceptance.json
node tools/probe-shellfix.mjs --only=M4_pointercancel --out=acceptance-m4.json

# 4) 可视提示判定（含截图 + 逐字节比对）
node tools/diag-hint.mjs                                         # → raw/diag-hint.json

# 5) 落地（由协调者执行）见 DEPLOY.md
```

| 原始产物 | 内容 |
|---|---|
| `raw/acceptance.json` + `.log` | **最终全窗验收证据**（run4，候选 md5 `feaedc5d…`） |
| `raw/acceptance-run1/2/3.json` + `.log` | 前三轮（含被判 invalid 的仪器写法）**保留**，见 §11 |
| `raw/acceptance-m4.json` / `acceptance-m4b.json` | M4 单独重跑（CDP 触摸修正后 / 计数重装后） |
| `raw/acceptance-m12.json` | M12 渲染门禁单独重跑（goto 超时修正后，两模式 PASS） |
| `raw/diag-lostpointercapture.json` | `lostpointercapture` / `releasePointerCapture` 路径判定（含可信 `pointercancel` 证据） |
| `raw/ush2-equivalence.json` | 2,149,392 组等价性 + 定点表 |
| `raw/recon.json` / `raw/diag-hint.json` | 夹具自证（路由改写 FNV+长度证明）/ 可视提示判定 |
| `raw/apply-*.json` | 补丁器每次运行报告（锚点命中、sha256 前后、pre-image、语法检查） |
| `evidence/*.png` | `diag-*`（可视提示前后）、`hint-*`（四态裁剪）、`recon-*`（整屏） |

---

## 11. 失败 / invalid 保留（不掩盖）

| # | 现象 | 处断 |
|---|---|---|
| I1 | **run1/run2 的 M4** 用合成 `pointercancel` 判"取消语义无效" | **invalid**：当时候选**确实**未挂载处理器（§3.1 缺陷）；且合成路径与原生路径需分开证。已重写 M4（原生事件计数 + 三条路径）并修复候选后重跑 |
| I2 | **run1/run2 的 M13 阳性对照失败**（注入 120 ms 却 `rafMax 16.8`） | **invalid**：mark 紧贴注入 ⇒ 停滞落在窗边界之外（正是 audit §0.5 **D1** 记录的陷阱）。修正为"先开窗播帧 → 注入 → 排空帧 → 收窗"后 `rafMax 124.8/136.8 ms`、`LoAF 1` ⇒ 通道自证 |
| I3 | **M11 首测读成"idle 常显药丸"** | **误判已证伪**：指针停在 (0,0) 落在 `sidebarCol` 上 ⇒ 触发列悬停揭示。修正采样位置后，候选 idle 截图与基线**逐字节相同**（md5 `34a4b2a8`） |
| I4 | **M8 首测读到中间帧**（grid 280.109 而 aria 已是 296） | **invalid 读数**：`grid-template-columns` 有 0.3 s 过渡，拖拽期被 `data-dragging` 关掉、键盘期没关。加 420 ms 落定等待后逐值精确（296/312/328/392/376/420/264/280/264） |
| I5 | **M6 首测用程序化 `.click()` 展开失败** | **工具缺陷**：改为真实鼠标 `locator.click()` 后展开成功（900 ⇒ `280px 620px 0px`） |
| I6 | **M10 首测还焦目标退化**（记成 composer 输入框） | **工具缺陷**：程序化点击不把焦点给触发器。改真实鼠标点击后复现"还焦到打开者" |
| I7 | **CDP 触摸 `touchCancel` 后直接 `touchMove`** 报 `Must send a TouchStart first` | **仪器缺陷**：改为取消后重新 `touchStart` 起新手势 |
| I8 | **脚本 `.tmp` 扩展名**导致 `node --check` 报 `ERR_UNKNOWN_FILE_EXTENSION` | **工具缺陷**：临时文件改为 `<target>.shellfix-v1.tmp.js` |
| I9 | **补丁器幂等首版失效**（部分 span 的 new 以 old 为前缀 ⇒ 被重复注入） | **已修正**为"new 命中优先判为已应用"的三态机；二次 apply md5 不变 |
| I10 | **补丁器漏挂 props**（`onPointerCancel`/`onLostPointerCapture` 只定义未挂载） | **已修正**（新增 span `handle-props-attach`）并**重跑全部验收窗**（候选 md5 变为 `feaedc5d…`） |
| I11 | run4 的 `M12_render_gate[baseline]` 撞上 `page.goto: Timeout 30000ms`（并发下的偶发加载失败） | **非结论性失败**：run1/2/3 该窗均通过（frame ✓ / centerCol 后代 61–98 / pageErrors `[]` / 插件错误 UI 0）。已把 goto 超时提到 60 s + 一次重试并单独重跑 ⇒ `raw/acceptance-m12.json` **两模式均 PASS** |
| I14 | 早期以"跨模式 idle 截图逐字节相同"论证"无 idle 常显" | **判据不合法**（本 GUI 背景是活的，裁剪区背景像素本就不同）⇒ 改为"候选 idle `::after` 计算样式 = `content:""+opacity:0`"与"**同页** idle==hover（基线 true / 候选 false）"两条与背景无关的判据（§5.4）。结论不变 |
| I13 | **探针从不释放锁**：`acquire()` 返回里没有 `held` 字段（只有 `ok/pid/dir`），而我按 `lk.held` 判空 ⇒ 每次运行结束都留下一个"自己已死亡"的 owner 文件（靠下一轮 `reclaim` 兜底，未影响任何兄弟线） | **已修正**为无条件 `release()`（库自身只释放 owner pid == 本进程的锁）并实测验证：运行结束 `{"held":false}` ⇒ **本档收尾后未留下任何锁** |
| I12 | M4b 在 200 ms 读窗内读到"未复位" | **读数窗口过短**：浏览器在 `releasePointerCapture` 后派发的是**可信 pointercancel**，250 ms 读窗下可观测到且状态复位（`raw/diag-lostpointercapture.json`）。维持"未定"而非"失败" |
