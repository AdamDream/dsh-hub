# exec-keepalive — K1（设置栏目 keep-alive）修订执行复核一体档报告

- 线：`.workspace/lag-fix/exec-keepalive/`（独占）
- 审计契约：`.workspace/lag-fix/program/w01-client-render/audit.md` §4.2/§4.2bis/§4.4/§6.2 K1 + `raw/w01-verdicts.json` + `raw/settings-nav-rows.json` + `static-coupling.md`
- 宿主：`http://127.0.0.1:3080`，PID **301709**（`node /home/CNS2026495165/.npm-global/bin/dsh web`）——**全程未重启、未 pkill、未改任何产品文件**
- 角色：**修订执行复核一体**（按已完成的审计落地；不重新拆解、不扩范围）
- 授权：最多 2 个二级 subagent（已用 1 个：live A/B 器械档 `9ec0c360`）
- **deployed 写入由协调者执行**（本档只产出候选件 + 补丁器 + 证据）

---

## 0. 裁决（先给结论）

**总体：K1 三段的实现与纪律全部达标；核心收益（切回不重取数）在 live A/B 上 8/8 达成。有两条偏差必须由协调者裁决，不得由本档自行放行：**

- **偏差 A（判据替换）**：硬性验收 2 的"二次访问 **mount fiber = 0**"**字面未达标**（P 相位 cycle2 实测 18–153）。
  依据：该通道在本环境**结构性不可用**（B 空转地板 1404–1674 > 点击信号 16–274），且本档用**无混淆**的两条判据给出了等价且更强的结论——
  **RPC 二次访问 8/8 为零** + **面板子树 DOM 节点身份存活（切走后仍 connected、同一节点、被隐藏而非被卸载）**。
  ⇒ 请裁决"是否接受把 mounts 判据替换为 RPC + DOM 节点身份"。
- **偏差 C（协调要求，非补丁缺陷）**：本档执行期间**兄弟线改掉了 2 个目标文件的基座**（`dsh-usage`、`settings-general`，见 §6.6/§6.6.1）。候选件已全部在**收尾基座**上重建并（对风险最高的两栏）复测通过；但**部署前必须再跑一次 `verify-KeepAlive-v1.mjs`**，并确保**先落本档补丁、后落其它线对同两个文件的改动**（或由协调者串行化），否则需要按 §6.6 的流程重新生成候选件。
- **偏差 B（未获验证）**：硬性验收 3 的 **C1 护栏（`apply` 的 cost/script 不劣化）在本状态不可测**：dwell 态 `apply` 自采样 = **0**（两个独立器械一致），根因是 `apply` 只由主题快照变化触发（`layout:553/555`）而本部署 `ui-theme.preference = light` 使 `prefers-color-scheme` 通路失效（`theme:1136`）⇒ 比值是 0↔0。
  ⇒ **既未证劣化，也未证未劣化**。停止条件（劣化）未触发，但**该护栏本批未获验证**，落地后必须按 §7.3 的配方复测。

| # | 判据 | 结论 |
|---|---|---|
| 1 | K1 三段按 **③→②→①** 顺序落地、可逐段独立回滚 | **PASS**（16 hunks / 5 文件 / 三段文件互不重叠；只回滚 k1-1 时其余 4 个不受影响，实测） |
| 2 | 补丁器纪律（dry-run 默认、全命中才写、pre-image、`node --check`、幂等、`--rollback`） | **PASS**（含排练实测往返一致 + 无附带改动的字节增量对账） |
| 3 | 逐栏目门控 **8/8**（切走后 60 s 该栏目 RPC = 0） | ✅ **PASS**：P 相位 **8/8 全为零**，窗长 65.03 s、心跳 66–67 ticks；**独立第二器械复现**（§7.1）。<br>⚠️ 全部 4 个 P 相位跑次合计 **26 次"栏目×窗口"测量中 25 次为 0**，唯一一次非零（模型，`POST /api/credentials.describe`）已按 URL 证据归因为**该面板自身首访两段式加载的第二段晚到**（跨窗口边界），非隐藏面板泄漏（§7.1.1） |
| 4 | 二次访问 **mount fiber = 0** 且 **RPC = 0** | ⚠️ **分裂**：**RPC = 0 → PASS（8/8，P）；mounts = 0 → 字面未达标**（通道污染，见偏差 A 与 §7.2） |
| 5 | C1 护栏：`ThemePresenter.apply` 的 `cost/script` 比值不劣化 | ⚠️ **INCONCLUSIVE（未获验证）**，见偏差 B 与 §7.3；**DOM 常驻量已量化**（697 → 1339/1422 节点） |
| 6 | 既有断言不回归（S9 / 弹窗开合 / 焦点 / 键盘可达性 / 可见面板恒 1） | ✅ **PASS**（两相位逐项；P 的 locale 未测到，已标注） |
| 7 | 不宣称"消除可感卡顿" | **PASS**（收益口径严格写成"消除重复小成本 + 零判据"；帧级数字只作相对 KPI） |
| 8 | 静态门控面完整（"门控遗漏是静默的"这一风险） | **PASS**（§5：keep-alive 可达子树内**只有 1 处**重复性 RPC 源，已被 k1-2 双闸门覆盖） |
| 9 | 同档自复核 | **§10**：静态 PASS / live 带上述两条偏差 ⇒ 自裁决 **PASS-with-caveats**（不是无条件 PASS，也不是整体 REWORK） |


**本档最重要的三个新事实**（审计未给出、本档实测/静态新增）：

1. **8 个栏目自身的组件区域内"零"重复性副作用**（`setInterval/setTimeout/Observer/addEventListener/rAF` 逐条按 `//#region` 归属，见 §5.1）⇒ keep-alive 不可能从这 8 个栏目自身泄漏轮询；`hidden` 不会停 effect 这条风险，在实际门控面上**只落在一处**。
2. **keep-alive 可达子树内的唯一重复性 RPC 源** = 嵌套在「插件」栏目里的 `@local/dsh-usage` 卡片（`IO:799` + `setInterval:986`，`refreshSec` 默认 **60 s**）。k1-2 把设置壳的 `visible` 一路下发到该卡片并在其 `setInterval` effect 上**消费**，形成"IO + 显式 prop"双闸门（IO 回调是投递时序相关的，单闸门不稳）。
3. **门控不变量可静态证明**：候选件里 `cardVisible` 恰好出现 **3 次**（声明 :761 / 轮询条件 :988 / deps :997），**首访加载 effect 与手动刷新块内 0 次** ⇒ "只有计时器受门控，首访加载与手动刷新无条件"这条硬约束被锚点断言，而不是靠注释承诺。

---

## 1. 交付物清单

| 交付物 | 路径 | sha256-12 |
|---|---|---|
| 补丁脚本 | `apply-KeepAlive-v1.mjs` | 见 §4 运行证据 |
| 静态自证器 | `tools/verify-KeepAlive-v1.mjs` | — |
| 静态证据 | `raw/verify-static.json` | — |
| 候选件 k1-1 | `candidate/general.client.js` | **`1e75c77ba045`**（基座经 masklook 变更后重生成；旧基座版本 `6464b7b06ca0` 已作废） |
| 候选件 k1-2 | `candidate/plugins.client.js` | `4ddfa5bb02ba` |
| 候选件 k1-2 | `candidate/usage.client.js` | `992fe978004e` |
| 候选件 k1-3 | `candidate/sshGui.client.js` | `b3e0c225b3da` |
| 候选件 k1-3 | `candidate/wsEnh.client.js` | `56faaf956705` |
| pre-image（原字节） | `pre-image/*.orig.js` + `pre-image/manifest.json` | 见 manifest |
| live A/B 器械 | `tools/k1-ab.mjs`（二级档产出） | — |
| live A/B 原始 JSON | `raw/ab-<phase>-*.json`、`raw/ab-summary.md`、`raw/ab-run.log` | — |

**部署态 referent（本档**未改动任何产品文件**）**：
- 本档**开工时**（审计 referent）：`settings-general=bd7edeaec382`、`settings-plugins=36afbb9bcc6e`、`dsh-usage=cdbd87b6d97e`、`dsh-ssh-gui=5e23bc192d14`、`workspace-enhancement=7df7a655ee66`
- **收尾时实测（期间被兄弟线改了 2 个文件，见 §6.6）**：`settings-general=0853da8858dc`（exec-masklook）、`dsh-usage=8f53e475d625`（exec-usage9）；其余 3 个未变。

**候选件（收尾时，待协调者部署）**：`general=1e75c77ba045`、`plugins=4ddfa5bb02ba`、`usage=51fd8d9b0cb6`、`sshGui=b3e0c225b3da`、`wsEnh=56faaf956705`。

---

## 2. 判据与纪律（口径声明，先声明再报告）

| 项 | 本档取值 |
|---|---|
| 主判据 | `RunTask`（trace 类别**含** `disabled-by-default-devtools.timeline`）+ LoAF `duration` |
| 页内判据 | **wall-clock rAF**（回调入口 `performance.now()`，不用 `ts`），**开窗前播种 ≥1 帧并保留块前那一帧** |
| 阳性对照 | **页内 `setTimeout` 注入 120 ms 忙循环**（**禁用** CDP `Runtime.evaluate` 注入） |
| 相对 KPI | `>50ms` 帧计数**只作相对 KPI**（本器械分辨下界 ≈40–50 ms） |
| 并发口径 | `/proc/*/cmdline` 含 `--remote-debugging-pipe` 且不含 `--type=`，排除自身；**禁止 `pgrep -f`** |
| 锁 | 只用 `../lib/probe-lock.mjs`；**绝不回收未确证死亡的锁** |
| 绝对值 | 采集期**非独占** ⇒ 一切绝对 ms/ms/s/fps 标 `INCONCLUSIVE(CONTENDED)`；只有**计数 / 为零 / 比值 / 占比**可作结论 |
| 本档窗口附加要求 | **每窗周期心跳 + 浏览器 pid 存活**（新增，见 §7） |
| 禁止 | 以 `visibilityState` 当"帧在产出"证据；把 `mutation_count` 当 re-render 证据；挑选最佳窗口；剔除失败窗口 |

**并发条件（本档实测，如实记录）**：

| 时刻（CST，本档） | 锁 | 外来主浏览器 | loadavg |
|---|---|---|---|
| 15:23 | **BUSY**：`agent=w14-residual-env pid=921464`（liveness **ALIVE**，purpose "headed gecko A/B/C matrix"） | `--remote-debugging-pipe` 普查 **0** | 3.71 4.43 5.57 |

⇒ 本档**未持锁**（预算内未获得），未回收、未争抢、未触碰他人 `owner.txt`。live 相位全部按 `lockMine:false` 标注。

---

## 3. K1-③ 守卫（**先做**，取消/失效语义）

**为什么必须先做**：设置壳上提 keep-alive 后，面板不再随切栏目卸载 ⇒ 上一轮的**在飞响应**会落回一个仍然存活的组件，具备"晚期响应覆盖新响应/覆盖缓存"的竞态条件。先补守卫再加缓存，顺序不可颠倒。

### 3.1 `@local/dsh-ssh-gui`（此前**零 cleanup**；每次访问扇出 **4+2N**）

| hunk | 原锚点 → 改动 | 候选件行 |
|---|---|---|
| SG-1 | 在 `const refresh = async (silent) => {` 之前插入 `aliveRef` + `refreshGenerationRef` + cleanup effect（卸载时 `aliveRef=false` 且 generation 自增） | `:550-551` |
| SG-1 | `refresh` 体内取 `generation = ++refreshGenerationRef.current` 与 `current()` 判据 | `:559-561` |
| SG-2 | 第一波 `Promise.all([nodes.list, keyref.list, config.get, serial.ports])` 之后：`if (!current()) return;` | `:570` |
| SG-3 | 第二波逐节点 `conn.status/node.status` 之后：`if (!current()) return;` | `:596` |
| SG-4 | `catch` 改 `if (current()) setErr(...)`；`finally` 改 `if (!silent && current()) setBusy(false)` | `:599`、`:601` |

形状**照抄仓库内既有样板** `@local/dsh-usage:840-852`（`aliveRef` + 三个 generation + setup 重新置活以兼容 StrictMode 的 setup→cleanup→setup）。
挂载取数 effect（原 `:587`）**保持无条件**——不写成 `[visible]` 依赖，否则每次切回都会重新取数，直接违反"二次访问 RPC = 0"。

### 3.2 `dsh-workspace-enhancement`（此前**零 cleanup**；`machines.list`）

| hunk | 原锚点 → 改动 | 候选件行 |
|---|---|---|
| WE-1 | `const refresh = async () => {` 前插入 `aliveRef` + `refreshGenerationRef` + cleanup effect | `:4565-4566` |
| WE-1 | `refresh` 取 generation + `current()` | `:4574-4575` |
| WE-2 | `await rpc("machines.list")` 之后 `if (!current()) return;`；`catch` 改 `if (current()) setErr(...)` | `:4579`、`:4583` |

**范围纪律（明确不做，避免扩范围）**：对话框里手动触发的保存/删除路径（`del`/`save` 等）未加守卫——它们由用户点击触发，且审计点名的缺陷是**挂载 effect 无 cleanup**（`audit.md:300/:585`）。同样，审计 §6.2 K1-③ 末尾提到的 `settings-models:538` generation "只排序不取消"**本档未改**，理由见 §9.2（"显式不做"）。

---

## 4. K1-① 容器（**最后上提**）— `dsh-client-ui-settings-general`

原状（审计 §4.2）：单条渲染 `active !== void 0 && renderSlot("settings.section", { close: onClose }, { only: active })` ⇒ 切栏目时旧 keyed child 从 list 消失 ⇒ **完整 unmount/remount**。

| hunk | 改动 | 候选件行 |
|---|---|---|
| GE-1 | 模块级 `const SECTION_HIDDEN_STYLE = { display: "none" };` | `:95` |
| GE-1 | `panelsId = useId()` + `visitedIds` state + `active` 变化时并入（`has(active)` 时不换引用） | `:106-107`、`:108-114` |
| GE-2 | navCell 加 `id: ${panelsId}-nav-${row.id}`（`aria-labelledby` 的目标） | `:152` |
| GE-3 | 单面板 → `rows.filter((row) => row.id === active \|\| visitedIds.has(row.id)).map(...)`，每项一个 `<div role="tabpanel" aria-labelledby hidden style data-keepalive-section>` 包裹 `renderSlot("settings.section", { close: onClose, visible: selected }, { only: row.id })` | `:181-191` |

**与 `settings-plugins:489-500` 完全同构**（`visitedIds` + `filter(active || visitedIds.has(id))` + 每 panel 传**该行自己的 id** ⇒ 真正的 keep-alive、首访才挂载 = lazy + keep）。**未改渲染器**（`renderer:845` 的 `only` 过滤原样保留），爆炸半径限制在设置壳内。

### 4.1 三个实现细节（都是踩点决定，不是风格）

1. **可见时不设 `style`、隐藏时内联 `display:none`（而非只靠 `hidden` 属性）**：`.VOzbGW_options` 是纯块容器（`flex:1;min-height:0;padding:0 24px 24px;overflow-y:auto`，**无 display 声明**），多包一层块级 wrapper **布局等价**；而"可见时用 `display:contents` + 只靠 `[hidden]`"的写法会让**内联样式压掉 UA 的 `[hidden]{display:none}`** ⇒ 隐藏失效。内联 `display:none` 位于任何作者规则之上，且是 `IntersectionObserver` 报 not-intersecting 的必要条件（这正是 k1-2 让既有 IO 闸门生效的机制）。
2. **`visitedIds` 放在 `SettingsPanel`**（随对话框关闭卸载）：保留策略严格是"**只保留访问过的**栏目"，且**不跨会话累积 DOM**——与审计风险 2 的保守做法一致。
3. **`role="tabpanel"` + `aria-labelledby` + `hidden`**：按审计 K1-① 指定的 SP 形状；为此给 navCell 补了 `id`（否则 `aria-labelledby` 是断引用）。**未改** `aria-current`（A4 哨兵：恒为 1）、**未改** 键盘可达性（navCell 仍是 `button`，Tab 序列不变，未加 `tabIndex`/`role="tab"`）。

### 4.2 DOM 常驻量（本批最大风险的量化）

- 审计已量化：8 栏目内容节点之和 **813** vs 现状单栏 **97** ⇒ 若一次性全挂 **8.4×**；整份文档 4638 → ≈5354 = **+15.4%**。
- 本档补一条审计未涵盖的更坏情形：**「插件」栏目的另一个子标签「插件列表」实测 1820 节点 / 192 SVG**（`incident2` D2）。若用户在同一个对话框会话里访问过「插件列表」，该子树也会被 keep-alive 保留 ⇒ 实际最坏常驻量**大于** 813 口径。因此把 **DOM 节点数 + `apply` 成本**一起放进 live 护栏（§7 第 3 项），而不是只用 813 估算。

---

## 5. K1-② 门控（**第二步**）— 可见性信号 + 门控面闭合

审计 K1-② 的形状：*"给每个 section 传一个 `visible` 信号（由 `active === r.id` 派生，经 ownerProps 下发），各 section 的轮询/订阅/观察器在 `visible===false` 时不得开始。**不变量**：首访的初始加载与手动刷新**不受门控**。"*

### 5.1 门控面普查（静态，`raw/verify-static.json` §A/§B/§B2）

**判据**：把每个包里的 `setInterval / setTimeout / new IntersectionObserver / new MutationObserver / addEventListener / requestAnimationFrame` 逐条按**最近的 `//#region` 归属**到组件，再判断它是否落在"keep-alive 可达子树"内。

**8 个栏目自身（`settings.section` 组件区域）内：零处。** 全部命中都在别的组件/模块级：

| 栏目 | 命中 | 归属 region | 判定 |
|---|---|---|---|
| 通用设置 | `:103 addEventListener` | `lib/types/client/SettingsRoot.js` | 设置壳自己的 Escape 监听，审计 §4.3 已确认**有 cleanup**；壳本身不参与 keep-alive（只有它内部的 section 面板被保留） |
| Agent 预设 | `:409 setTimeout` | `lib/types/client/AgentPresetSeat.js` | 一次性打字动画（带 `clearTimeout`），**不在** `AgentPresetRow` |
| 远程工作区 | `:4407 setTimeout`、`:4445 MutationObserver`、`:4455 addEventListener`、`:4456 setInterval` | `lib/client/row-badges.js` | **模块级**徽标子系统（审计 §4.3 已定性）：每次页面加载只跑一次，**keep-alive 不改变其生命周期** |
| 远程工作区 | `:2269 addEventListener` | `lib/client/ui.js` | 其他组件 |
| 分布式控制 | `:271 setTimeout` | `RemoteBrowser` region | `URL.revokeObjectURL` 清理定时器 |
| 模型 / 插件 / vision-adam / 子代理模型 | 0 | — | — |

**嵌套注册者（keep-alive 可达）内：只有 2 处，且同属一个组件。**

| 槽位/条目 | 命中 | region | 必须门控 |
|---|---|---|---|
| `settings.plugin.item[dsh-usage]` | `:799 IntersectionObserver` | `card components` | 是（**既有**闸门，未改） |
| `settings.plugin.item[dsh-usage]` | `:986 setInterval` | `card components` | 是（**k1-2 新增第二道闸门**） |
| 其余 11 个嵌套注册者（6 个 `settings.general.item` 行 + 2 个 `settings.plugins.tab` + 3 张 `settings.plugin.item` 卡片） | 落在本组件区域 **0** | — | — |

### 5.2 k1-2 的改动（把信号送到唯一需要它的地方）

`settings.plugin.item` 是 **keyed** 槽，卡片拿到的 `ownerProps` 是 `renderSlot("settings.plugin.item", {}, { entryKey: ns })` 的**空对象** ⇒ 光在 `settings.section` 上挂 `visible` **到不了** dsh-usage 卡片。因此 k1-2 必须把信号逐级下发：

| hunk | 文件 | 改动 | 候选件行 |
|---|---|---|---|
| PL-1 | `settings-plugins` | `PluginsSettingsSection({ t, renderSlot, useTabs, visible })` | `:416` |
| PL-2 | `settings-plugins` | `renderSlot("settings.plugins.tab", { visible }, { only: row.id })` | `:499` |
| PL-3 | `settings-plugins` | `ConfigurablePluginsTab`：`const visible = props.visible !== false;`（**未下发时默认 true = 保守，门控永不误闭**） | `:401` |
| PL-4 | `settings-plugins` | `renderSlot("settings.plugin.item", { visible }, { entryKey: ns })` | `:405` |
| US-1 | `dsh-usage` | `UsageCard`：`const cardVisible = props.visible !== false;` | `:761` |
| US-2 | `dsh-usage` | 轮询条件 → `if (!pollVisible \|\| !cardVisible \|\| document.hidden) return;` | `:988` |
| US-3 | `dsh-usage` | effect deps → `[refreshSec, pollVisible, cardVisible]` | `:997` |

**为什么不只靠 IO**：`IntersectionObserver` 回调是**投递时序相关**的（下一帧才到），单闸门在"隐藏瞬间恰好撞上一次 60 s tick"这类边界上不稳；显式 prop 由 React 状态驱动、与时序无关，两条闸门并存才不是单点。

### 5.3 不变量：静态锚点断言（不靠注释承诺）

`raw/verify-static.json` §F：

```
dsh-usage cardVisible 出现 3 次（期望 3：声明 + 轮询条件 + deps）
   :761 const cardVisible = props.visible !== false;
   :988 if (!pollVisible || !cardVisible || (typeof document !== "undefined" && document.hidden)) return;
   :997 }, [refreshSec, pollVisible, cardVisible]);
首访加载 effect 含门控 = false（期望 false）      ← 不变量
手动刷新块含门控       = false（期望 false）      ← 不变量
轮询 effect 含门控     = true （期望 true）
IO 闸门仍在 = true    document.hidden 闸门仍在 = true
⇒ 不变量 PASS
```

### 5.4 两级隐藏 × 闸门覆盖（诚实标注覆盖边界）

「插件」栏目有**两层**可隐藏结构：栏目层（`settings.section` 面板，k1-1 新引入）与子标签层（`settings.plugins.tab` 的 `hidden={!selected}`，**既有生产语义**）。二者对 dsh-usage 的闸门覆盖：

| 隐藏的是 | 谁关掉轮询 | 是否确定性 |
|---|---|---|
| **栏目被切走**（≤ 本轮验收场景） | k1-2 的 `visible` prop（React 状态驱动，**与时序无关**）+ 容器 `display:none` ⇒ IO | **双闸门，确定性** |
| **同栏目内切到另一个子标签**（如「插件列表」） | 仅子标签自己的 `hidden`（UA `display:none`）⇒ IO 报 not-intersecting | 单闸门（**与改动前完全一致**的既有行为） |

**本档的有意选择**：不改子标签层（不把 `visible && selected` 传下去）。理由：(a) 该场景不在本轮验收范围内；(b) 现状已是生产行为，改动＝扩范围、增加回归面；(c) 硬性验收 1 的场景是**栏目级切换**，那里已是双闸门。⇒ 记录为**已知覆盖边界**，而非遗漏。

### 5.5 为什么"二次访问 RPC = 0"是**结构性**的（静态推理，live 只作确认）

acceptance #2 的关键不是"希望不重取"，而是**面板不重挂 + 取数 effect 的依赖身份恒定**。逐栏目核对依赖身份：

| 栏目 | 挂载取数 | effect deps | 为何二次访问 = 0 |
|---|---|---|---|
| 通用设置 | `AgentPresetRow` → `agentPresets.list` | `[load]`（`AP:293-295`） | `load` 来自 `cachedRootInject(entry, actions)`——**按 entry 缓存、每个 entry 的 inject 工厂只跑一次**（`renderer:396-403`）⇒ 身份恒定 ⇒ 面板不重挂时 effect 不重跑 |
| 模型 | `controller.load()`（**渲染期**闸门） | 无（`if (state.status === "idle")`，`models:1856`） | 首次 load 把 status 写成 loading→ready ⇒ 之后每次渲染 `idle` 都不成立 ⇒ **结构性 0**（审计已实测 2→0，本轮唯一例外） |
| 插件 | dsh-usage `loadAll`/`loadSessions`/`loadStatus` | `[loadAll, loadSessions, loadStatus]`（`usage:975`） | 三者的 `useCallback` 依赖全是 `useMemo`（`payload`/`range`）或 `useState` 或缓存 inject 值（`usage:941/959/970`）⇒ 身份恒定 ⇒ 初始加载 effect **只跑一次**；隐藏期的重渲染**不会**重跑 |
| Agent 预设 | `load()` | `[load]`（`AP:1156-1158`） | 同「通用设置」 |
| 远程工作区 | `machines.list` | `[]`（`WE:4570`） | 结构上只在挂载跑一次 |
| 分布式控制 | `nodes.list`/`keyref.list`/`config.get`/`serial.ports` + 逐节点 `conn.status`/`node.status` | `[]`（`ssh-gui:587`） | 同上 |
| vision-adam / 子代理模型 | 无 | — | 设计上 0 |

**⚠️ 同时标出这份推理的边界**：以上全部以"**面板不被重挂**"为前提——这正是 k1-1 提供的东西（`visitedIds` + 每 panel 自己的 `only`）。若 k1-1 未生效（例如 wrapper 的 `key` 不稳定、或 `only` 误传全局 `active`），这些 effect 会随每次切换重跑，表现为 mounts ≠ 0 **且** RPC 全部重发 ⇒ 因此 §8 的验收 2 同时看 mounts 与 RPC，两者互为交叉验证。

---

## 6. 补丁器 `apply-KeepAlive-v1.mjs`：自证与排练

### 6.1 纪律实现

| 要求 | 实现 |
|---|---|
| dry-run 默认 | 无 `--apply`/`--rollback` 时只校验 + 报告，不写盘 |
| `--apply` 才写 | ✔ |
| **锚点唯一命中否则一个文件都不写** | 先在内存里对全部文件全部 hunk 求 `count(anchor)` 与 `count(replace)`：只有 `na===1 && nr===0` 才算 `todo`；任一项 `BROKEN` ⇒ 立即 ABORT，**零写入**；写入集中在校验全部通过之后 |
| 自动 pre-image | 写盘前把原字节存 `pre-image/<file>.<sha12>.orig.js`，同 sha 只存一次、**绝不覆盖**；`manifest.json` 记录 sha256/字节数/时间 |
| `node --check` | 每个待写内容在**写盘前**先落临时文件跑 `node --check`，失败即 ABORT（零写入）；写盘后再 post-verify |
| 幂等 | 第二次 `--apply` 全部 hunk 判为 `applied` ⇒ "无需写盘"，退出 0 |
| `--rollback` | 段级（hunk 级逆替换，故与他段互不影响）+ 整批（逆序） |
| 三段独立回滚 | **三段文件互不重叠**（k1-3 = ssh-gui/ws-enhancement；k1-2 = plugins/usage；k1-1 = settings-general）⇒ 段级回滚天然独立 |

**⚠️ 排练抓到的两个真实缺陷**（记录下来，因为它们正是"dry-run/排练"的价值）：

1. **幂等判别顺序错**：对"**插入型** hunk"（`replace = anchor + 新增行`），应用后 anchor **仍在位** ⇒ 先判 `na===1` 会把它误判为 `todo`，第二次 `--apply` 会重复插入（实测 `SyntaxError: Identifier 'visible' has already been declared`）。**修复**：先判 `nr===1`（replace 在位）⇒ 已应用；`na===1 && nr===0` 才是 todo。**该误判被"`node --check` 先行 + 全命中才写"挡住，一个文件都没被写坏。**
2. 已打补丁态的 sha12 漂移被误报为 DRIFT ⇒ 改为按 hunk 状态判定并如实说明。

### 6.2 无附带改动证明（字节增量对账 + 逆向还原）

补丁的"最小性"不靠 eyeball diff，而靠两条可机检的等式（`raw/verify-static.json` §D2）：

1. **字节增量对账**：`bytes(候选) − bytes(pre-image)` 必须**恰好等于**补丁器自己声明的全部 hunk 的 `Σ(len(replace) − len(anchor))`。不等 ⇒ 存在声明之外的改动。
2. **逆向还原**：把候选件按 `replace → anchor` 逆替换全部 hunk，必须**逐字节还原** pre-image。还原则补丁没有第二处副作用。

| 文件 | 声明 hunks | Δbytes 期望 | Δbytes 实际 | 逆向还原 |
|---|---|---|---|---|
| `general` | 3 | 1526 | **1526** | **true** |
| `plugins` | 4 | 157 | **157** | **true** |
| `usage` | 3 | 508 | **508** | **true** |
| `sshGui` | 4 | 877 | **877** | **true** |
| `wsEnh` | 2 | 812 | **812** | **true** |

另核：`__ModuleLoader__.load({` 入口计数 `1→1`、文件首 3 行与末 3 行未动（无截断/无包裹破坏）。

### 6.3 排练实测（`--root rehearsal/`，镜像 5 个目标文件；逐条转录见 `raw/patch-*.txt`）

| 步骤 | 结果 |
|---|---|
| dry-run | 16/16 hunk `todo(a1/r0)`；5/5 `node --check` OK |
| `--apply` | 5 文件被写；`post-verify` 5/5 OK。**该次排练在开工基座上完成**（general `bd7edeaec382→6464b7b06ca0`、plugins `36afbb9bcc6e→4ddfa5bb02ba`、usage `cdbd87b6d97e→992fe978004e`、sshGui `5e23bc192d14→b3e0c225b3da`、wsEnh `7df7a655ee66→56faaf956705`）；**基座漂移后已在收尾基座上重新排练并重新生成候选件**（见 §6.6 的最终 sha 表） |
| 第二次 `--apply` | `全部 hunk 已应用` ⇒ **无需写盘**（幂等 PASS） |
| `--rollback --segment k1-1`（只回滚容器） | general 回到该次排练的基座 `bd7edeaec382`，**其余 4 个仍为已打补丁态**（段间独立性 PASS） |
| `--rollback`（整批） | 5/5 逐字节回到该次排练的基座（`bd7edeaec382/36afbb9bcc6e/cdbd87b6d97e/5e23bc192d14/7df7a655ee66`）⇒ **往返一致 ROUND-TRIP PASS**（该性质随后在**新基座**上重复验证：§6.6） |
| 再 `--apply` | 再次得到同一组候选 sha ⇒ 可重复 |

### 6.4 回滚命令（三段各自独立）

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-keepalive

# k1-3（守卫）单独回滚：ssh-gui + workspace-enhancement
node apply-KeepAlive-v1.mjs --rollback --segment k1-3

# k1-2（门控）单独回滚：settings-plugins + dsh-usage
node apply-KeepAlive-v1.mjs --rollback --segment k1-2

# k1-1（容器）单独回滚：settings-general（回到 only: active 单面板）
node apply-KeepAlive-v1.mjs --rollback --segment k1-1

# 整批回滚（逆序：k1-1 → k1-2 → k1-3）
node apply-KeepAlive-v1.mjs --rollback
```

**回滚安全性**：k1-2 的消费方在 `visible` 缺失时默认 `true`（门控开放）⇒ 单独回滚 k1-1 后 k1-2 变成**惰性但无害**；k1-3 与另两段无依赖 ⇒ 任意段可单独回滚。

### 6.5 部署指引（**由协调者执行**）

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-keepalive
node apply-KeepAlive-v1.mjs                  # dry-run 复核（应 16/16 todo）
node apply-KeepAlive-v1.mjs --apply          # 写入（顺序 k1-3 → k1-2 → k1-1）
node tools/verify-KeepAlive-v1.mjs           # 复核：disk 应等于候选 sha、served==disk
curl -s http://127.0.0.1:3080/plugins/@deepseek-ai/dsh-client-ui-settings-general/client.js | sha256sum
# 期望 sha256-12 = 1e75c77ba045（其余 4 个见 §1）
```

热面生效方式：**刷新 GUI 页面**（client bundle 是页面加载时取的；若浏览器缓存，强刷一次）。页面内自证：打开设置后 `document.querySelectorAll('[data-keepalive-section]').length >= 1`（部署前为 0）。

### 6.6 ★ 基座漂移事件（**真实发生**，以及我为此加的 fail-closed 闸门）

本档执行期间，**另一条线（`exec-usage9`）改写了 `@local/dsh-usage`**，实测：

| 文件 | 本档开工时（审计 referent） | 漂移后（实测） |
|---|---|---|
| `.dsh/profiles/node_modules/@local/dsh-usage/lib/client.js` | `cdbd87b6d97e` | **`8f53e475d625`**（81123 字节，+1654 行数 1249→1403） |

其余 4 个目标文件**未变**（`bd7edeaec382` / `36afbb9bcc6e` / `5e23bc192d14` / `7df7a655ee66`，实测仍 pristine 且 `served==disk`）。

**处置（已在事实上完成）**：
1. 在**新基座** `8f53e475d625` 上重新校验 usage 的三个 hunk 锚点（实测各**唯一命中 1 次**，见 §6.1 dry-run 输出）⇒ 语义未变（usage9 只是在轮询体内加了 `USAGE_MEMO` 记忆闸门等，**没有**加可见性门控，故 k1-2 的 `cardVisible` 闸门仍然必要且与它正交）；
2. **重新生成候选件**：`usage.client.js` 由 `992fe978004e` → **`51fd8d9b0cb6`**（其余 4 个候选 sha **未变**，因为它们依赖的基座未变）；
3. 旧 pre-image `pre-image/usage.cdbd87b6d97e.orig.js` **保留**（历史），新 pre-image `usage.8f53e475d625.orig.js` 自动落盘（§6.1 的"自动 pre-image"机制）；
4. 新增 **fail-closed 漂移闸门**：当某文件**确实有待写 hunk** 而它的当前 sha12 ≠ 本档校验过的基座 sha12 时，**拒绝写任何文件**（`exit 5`），除非显式 `--allow-drift`（越过后仍要求锚点唯一命中 + `node --check` + post-verify）。

**给协调者的操作提示**：部署前先跑 `node tools/verify-KeepAlive-v1.mjs`；
若 `E` 段显示某文件 `pristine=false` 且**不是**本档候选哈希，说明该文件又被别的线改过 ⇒ **不要**直接 `--apply`（会被 fail-closed 拒绝），应先重新校验锚点并重新生成候选件。

#### 6.6.1 第二处漂移（**同一批内第二次发生**）：`settings-general` 被 `exec-masklook` 改动

| 文件 | 开工时 | 收尾时（实测） | 兄弟线的改动内容 |
|---|---|---|---|
| `dsh-client-ui-settings-general/lib/client.js` | `bd7edeaec382` | **`0853da8858dc`**（28084 字节 / 618 行） | **设置遮罩 mask/ring 重做**：`.VOzbGW_mask` 由 `backdrop-filter` 改为 `background:transparent;backdrop-filter:none`，并在 mask 下新增 4 个 `ring` div（`ringTop/Bottom/Left/Right` + `var(--dsw-mask-blur)`）+ 对应 CSS token |

**冲突面分析（本档实测，非推断）**：
- 该改动在 `SettingsPanel` **同一个组件**内，但落在 **`.overlay > .mask` 子树**；
- 本档三个 GE hunk 的锚点在 **`.options` 子树 / 组件签名 / navCell 属性**上，与 mask 子树**不相交**；
- 在新基座上重新校验：**GE-1 / GE-2 / GE-3 各唯一命中 1 次**（`todo(a1/r0)`）、`node --check` OK ⇒ 两个补丁**可组合**。

**处置**：`general.expectSha12 → 0853da8858dc` → 重新排练 → **重新生成候选件 `general.client.js` = `1e75c77ba045`**（其余 4 个 sha 未变）→ 同步更新静态自证器与两个 live 器械的哈希 → **在新候选件上做定向 live 复测**：

| 复测项（`--rows 0,2`，65 s 真窗） | 结果 |
|---|---|
| 新候选件是否被页面真正加载 | `keepalive=1`（打开即有 wrapper）✔；响应体哈希 **5/5** 命中候选件（含新 general `1e75c77ba045`） |
| 通用设置（即被 masklook 改动的那个文件） | `span=65001.8 ms`、`ticks=65`、**`leak=0`**、`slotSurvived=true`、`hiddenNotUnmounted=true` ✔ |
| 插件（唯一有轮询源、最高风险） | `span=65001 ms`、`ticks=65`、**`leak=0`**、`slotSurvived=true`、`hiddenNotUnmounted=true`、首访 RPC=8 ✔ |
| 二次访问该两栏（revisit） | **RPC=0 / 0**，且 `slotStillSameNode=true` ✔ |
| 常驻集合与可见性 | `keepaliveCount=3`（general/plugins/vision-adam ⇒ **只保留访问过的**）、`hidden=2`、`visible=1`、`slotVisible=1`、`ariaCurrent=1` ✔ |

原始证据：`raw/k1-gate-independent-P-rebase.json`、`raw/k1-ind-P.log`。
（该文件 `verdict.overall` 写成 `REWORK` 是**器械按字面 8 行比较**的报告瑕疵——本次 `--rows 0,2` 只跑 2 行；**实质字段全绿**：`fail=0 / void=0 / sections 2/2 PASS / leak=0,0 / servedBodiesMatch=true / revisit 2/2 rpc=0 / mechanismSlots pass=true`。代码已改为按实际行数计算；原始 JSON **保持原样未改**。）

**⇒ 两处漂移都没有破坏本档补丁的正确性**：`general` 候选件已在 masklook 之后的基座上重建并复测通过。


---

## 7. live A/B 对照（B = 部署态，P = 候选件字节经 `page.route` 就地替换）

> **为什么用 route 拦截做 P 相位**：deployed 写入由协调者执行，本档**不能**改产品文件。用 `page.route` 把 5 个候选 bundle 的响应体替换为候选字节，页面运行的就是**将被部署的同一批字节**（sha 已核对并落盘），因此这不是模拟，而是"等价字节"的真实 A/B。
> **拦截生效的通道自证**：补丁给每个已访问面板加了 `data-keepalive-section`；B 相位期望 0、P 相位期望 ≥1（访问 3 个栏目后 =3、其中 `hidden` 恰为 2）。该断言若失败，P 相位结论作废。

### 7.0 器械评审：本档在**测量器械**上抓到并修掉的四个缺陷（先说，因为它决定哪些数字可用）

本档对两个器械（主器械 `tools/k1-ab.mjs`（二级档）与**独立第二器械** `tools/k1-gate-independent.mjs`（本档自写，只做验收 1 + 机制判据））做了交叉评审，抓到两类问题：

**缺陷 1（致命，会导致假 PASS）—— 门控观察窗实际跨度为 0**
主器械的门控窗口调用 `windowRun({ tag: 'gate-…' })` **漏传 `seconds`** ⇒ `setTimeout(r, Math.round(undefined*1000))` = `setTimeout(r, NaN)` **立即返回**；而日志用常量 `LEAK_S` 打印成 `leak(65s)` ⇒ 会出现"8/8 全绿但每个窗口真实跨度 ≈ 0 ms"的**静默假 PASS**。
- 处置：已通报二级档修复（补 `seconds`），并要求加**硬断言** `spanMs ≥ 0.9×leakSec×1000` **且** 心跳 `ticks ≥ leakSec−2`，不满足 ⇒ 该窗 `VOID(WINDOW_TOO_SHORT)`、整体判 **REWORK 而非 PASS**。
- 二级档已把缺陷期的产物**改名保留**（`raw/VOID-gate-instrument-defect-ab-B-*.json`、`raw/VOID-killed-before-any-window-ab-P-*.json`）并重跑；修复后窗口自证可见：`span=65025.2ms`、`hb ticks=67`（见 `raw/ab-run.log`）。
- 教训（写进结论）：**"为零"类判据必须同时绑定"窗口真的存在"的证据**（跨度 + 心跳），否则零是平凡的。

**缺陷 2（污染，会让"零判据"不可用）—— `mounts`（fiber 挂载）通道在本会话被后台事件流污染**
主器械的 **无点击 idle 窗口**实测（**以正式跑为准**）：`pre-cycle1 mounts=**1404** / commits=156 / wsInN=**0**`、`pre-repeat-active mounts=**1674** / commits=62 / wsInN=**0**`。
（本档早期引用过的 `216 / wsInN=117`、`999 / wsInN=565` 出自**后被作废的首跑** `VOID-gate-instrument-defect-ab-B-*.json`（其 gate 窗只有 19–34 ms）⇒ **不作为主要引用**，此处保留仅为溯源。
二级档给出的一处重要更正：正式跑的地板**更高**，且出现在 `wsInN=0`（**无会话帧**）时 ⇒ 污染**不止**来自"后台会话事件流"，该通道在本环境整体不可作判据。）
⇒ 在"设置面板开着 + 会话事件流仍在跑"的窗口里，**与设置无关的挂载**就能达到 216–999 / 2.5 s；因此 cycle 窗的 `mounts` **无法归因**给"设置面板重挂"（同样是 B 相位：cycle1 row0 mounts=885；而点**已活动项**的对照却稳定 `mounts=0/commits=0`）。
审计的 27/34/126 基线是在**远安静**的事件流下取的（其 `home-idle` = 3 commits/20 s）。
- 处置：把 `mounts` 降级为**旁证**并给出噪声地板；"二次访问不重挂"改用**无混淆的机制判据**——**DOM 槽节点身份存活**：
  给当前可见的 `[data-slot="settings.section"]` 槽节点打属性标记，切走后检查
  `isConnected`（keep-alive ⇒ true，被隐藏而非卸载；unmount/remount ⇒ false，节点被 React 销毁）。
  该判据不依赖 fiber 计数、不受事件流污染，且自带阴性对照（B 相位必须为 false）。
- 另一个由此暴露的仪器细节：槽锚点 div 用 `display:contents`（renderer 的 `ANCHOR_STYLE`）⇒ **它自己的 `getBoundingClientRect()` 恒为 0×0**，用 rect 判"可见"会得到 0（本档自写器械第一版就踩到，已改为按"最近 keep-alive wrapper 是否隐藏"判定）。**任何用 rect 判这些锚点可见性的探针都不可信**。

**缺陷 4（两个器械各犯一次，同样的类）—— 拦截目标匹配写错字符串**
- 二级档：`TARGETS.find((x) => url.split('?')[0] === x.url)` 用**绝对 URL** 与**相对路径**做 `===` ⇒ 恒 false ⇒ **P 相位 0 命中、页面拿的是未打补丁字节**（`fulfill=0 / targetsHit=[]`）。
- 本档独立器械：`url.includes('/plugins/' + pkg + '/client.js')` 而 `pkg` 少写了 `@deepseek-ai/` 前缀 ⇒ 5 个目标里只有 3 个命中（页内 `keepalive=0` 当场暴露）。
- **统一修法（已用于两器械）**：用 `new URL(u).pathname` 取出 `/plugins/<KEY>/client.js` 里的 **`<KEY>` 完整片段**（含 scope），以 `KEY === pkg` 精确比较；并把"命中数 / served 哈希 / 页内 `keepalive>=1`"三条做成**硬断言**——命中不全 ⇒ 相位作废（VOID），不得当 PASS。
- 方法论要点：**"我替换了字节"这件事必须自证**（路由命中数 + 响应体哈希 + 页内可观测标记），否则 P 相位会静默地变成"又一次 baseline"，把"未生效"读成"无差异"。

**可用/不可用清单（据此读下面的数字）**

| 通道 | 本档可用性 |
|---|---|
| `net.fetch` / `net.xhr` URL 与计数（逐栏目 RPC） | ✅ **可用**（计数类；并发不能凭空造出 `/usage/*` 请求） |
| 窗口真实跨度 + 页内心跳 ticks + 浏览器 pid 存活 | ✅ **可用**（本档新增要求） |
| DOM 槽节点身份存活（机制判据） | ✅ **可用**（确定性）——但**必须标记"面板自己的根节点"**，见缺陷 3 |
| `[data-keepalive-section]` / `slotVisible` / `aria-current` / `navCells` | ✅ **可用**（存在性/计数） |
| 响应体 sha256（证明页面收到的是候选字节） | ✅ **可用**（P 相位 5/5 逐位相同） |
| `RunTask` / LoAF / wall-clock rAF | ⚠️ 只作**相对 KPI**（全窗 CONTENDED） |
| `mounts`（fiber 挂载）零判据 | ❌ **本会话不可用**（B 空转地板 **1404–1674 > 点击信号 16–274**；二级档另证 `maxIdleMounts(1674) > minCycleMounts` ⇒ **不可分离**），仅作旁证 |
| `ThemePresenter.apply` 的 cost/script **比值** | ❌ **本状态不可测**：dwell 态 `apply` 自采样 = 0（见 §7.3 的代码级根因） |

**缺陷 3（判据无区分力，靠阴性对照才抓到）—— 标记错了 DOM 节点**
"槽节点存活"这条机制判据的第一版把标记打在 `div[data-slot="settings.section"]` 上。实测 **baseline 切走后仍报 `survived=true`** ⇒ 判据失效。根因（代码级确证）：
`div[data-slot="settings.section"]` **不是面板节点，而是 renderer 的 `SlotOutlet` 锚点**（`renderer:741-750`，`style:"display:contents"`）；
切栏目时该锚点**位置不变、只是 children（被 `e<entryKey>` keyed 的条目）被替换** ⇒ 它在 B/P 两相位**恒 `isConnected === true`**。
- 修正：标记**面板自己的根节点**（`anchor.firstElementChild`，unmount 时由 React 销毁），并把锚点作为**对照项**（两相位都应 true，证明探针确实在读 DOM）。
- 连带记录：该锚点是 `display:contents` ⇒ **它自己的 `getBoundingClientRect()` 恒为 0×0**，任何"用 rect 判该锚点可见性"的探针都会得到"不可见"（本档与二级档的探针各踩到一次）。判可见性必须看它最近的 `[data-keepalive-section]` wrapper 是否 `hidden`。
- 方法论要点：**这条判据必须自带阴性对照**（B 相位必须得到 `false`）。没有阴性对照，一个"恒 true"的坏探针会被读成"keep-alive 生效"。

### 7.1 门控 8/8（硬性验收 1）— **PASS（两个独立器械一致）**

**协议**：点栏目 i → settle → **切到一个"别的" 0-取数栏目**（vision-adam / 子代理模型互为对方的目标态）→ **观察 65 s**（> `dsh-usage` 的 `refreshSec`=60，保证未门控的 interval 至少触发一次）→ 统计该窗内**全部** `fetch+XHR`。
窗口自证：**真实跨度 + 页内 1 s 心跳 ticks**。

**器械 A（主器械 `tools/k1-ab.mjs`，二级档）**：

| # | 栏目 | B 首访 RPC | B leak(65s) | **P leak(65s)** | P 前 60s | 窗口跨度 | 心跳 |
|---|---|---|---|---|---|---|---|
| 0 | 通用设置 | 1 | 0 | **0** | 0 | 65.03 s | 66–67 |
| 1 | 模型 | 0 | 0 | **0** | 0 | 65.03 s | 66–67 |
| 2 | 插件（内含 dsh-usage 卡片） | 9 | 0 | **0** | 0 | 65.03 s | 66–67 |
| 3 | Agent 预设 | 1 | 0 | **0** | 0 | 65.03 s | 66–67 |
| 4 | 远程工作区 | 1 | 0 | **0** | 0 | 65.03 s | 66–67 |
| 5 | 分布式控制 · dsh-ssh-gui | 4 | 0 | **0** | 0 | 65.03 s | 66–67 |
| 6 | vision-adam 识图设置 | 0 | 0 | **0** | 0 | 65.03 s | 66–67 |
| 7 | 子代理模型 | 0 | 0 | **0** | 0 | 65.03 s | 66–67 |

⇒ **P 相位 8/8 全为零**（`GATE RESULT 8/8 pass=true`），B 相位同期也是 8/8 为零（B 是"切走即卸载"的阴性对照，本不该有轮询）。

**"为零"不是空洞通过——判别力论证（这是本节最关键的一段）**：
1. B 相位实测同一个 `@local/dsh-usage` 卡片**会发** `/usage/status`（B 的切回对照 RPC 里可见），说明轮询源真实存在、tap 能看见它；
2. P 相位 dwell 态实测 **8 个面板确实常驻未卸载**（`keepaliveCount=8`、`hidden=7`、`slotVisible=1`）；
3. ⇒ 那个 `refreshSec=60` 的 interval 在**整个 65 s 窗内都活着**，却发出 **0** 个请求 ⇒ **门控确实生效**，而不是"没有轮询源"。

**器械 B（独立第二器械 `tools/k1-gate-independent.mjs`，本档自写，只依赖自己的 fetch/XHR tap；不共用主器械的 init script、不共用 trace 通道）**

- **B 相位 8/8 leak = 0**，跨度 `65000.5–65002.2 ms`、ticks `65`（全部通过 `spanMs ≥ 0.9×65 s` 且 `ticks ≥ 63` 的硬断言）；
- 首访 RPC 独立复现审计：模型 **2**（`llm.providers` + `credentials.describe`）、插件 **8**、Agent 预设 **1**、远程工作区 **1**、分布式控制 **4** ✓；
- **P 相位完整跑完 8/8，`overall: PASS`**：

| # | 栏目 | 跨度 | 心跳 | 首访 RPC | **leak(65s)** | 常驻面板数 | **面板节点存活** | **隐藏而非卸载** |
|---|---|---|---|---|---|---|---|---|
| 0 | 通用设置 | 65001.1 ms | 65 | 0 | **0** | 2 | **true** | **true** |
| 1 | 模型 | 65001.5 ms | 65 | 2 | **0** | 3 | true | true |
| 2 | **插件**（内含 dsh-usage） | 65001.4 ms | 65 | 8 | **0** | 4 | true | true |
| 3 | Agent 预设 | 65000.3 ms | 65 | 1 | **0** | 5 | true | true |
| 4 | 远程工作区 | 65001.8 ms | 65 | 1 | **0** | 6 | true | true |
| 5 | 分布式控制 | 65001.1 ms | 65 | 4 | **0** | 7 | true | true |
| 6 | vision-adam | 65000.7 ms | 65 | 0 | **0** | 8 | true | true |
| 7 | 子代理模型 | 65001.4 ms | 65 | 0 | **0** | 8 | true | true |

  - `verdict = {"pass":"8/8","fail":0,"void":0,"gatePass":true,"mechanismPass":true,"mechanismSlotsPass":true,"servedOk":true,"overall":"PASS"}`
  - 机制判据：**8/8 `slotSurvived=true`**（`mechanismSlots.survivedCount=8, falseCount=0`）——**而同一判据在 B 相位对真实切走的 7 个栏目全部返回 `false`** ⇒ 该判据有判别力、不是恒真探针；
  - 常驻集合逐字等于 8 个导航行 id（`["general","models","plugins","agent-presets","dsh-workspace-enhancement","@local/dsh-ssh-gui","@deepseek-ai/dsh-vision-adam","@local/dsh-subagent-model"]`）⇒ "**只保留访问过的栏目**"这条保留策略被逐 id 证实；`keepaliveVisible=1`、`slotVisible=1`、`ariaCurrent=1`；
  - **二次访问（revisit）逐栏目 RPC = 0，8/8**，且每次复查 `slotStillSameNode=true`（同一节点，不是新建）；
  - 拦截通道自证：路由 `fulfill` **5/5**（**裁决**：该断言应写作"`targetsHit` 集合恰为那 5 个包 + 5 个目标响应体哈希逐位相符"，**不是**"事件数恰为 5"——二级档某次 `fulfill=6` 是因 general 包被请求两次（首屏 + 模块系统），属正常，其 `targetsHit` 仍恰为 5），**响应体 sha256-12 与候选件逐位相同**（`6464b7b06ca0 / 4ddfa5bb02ba / 51fd8d9b0cb6 / b3e0c225b3da / 56faaf956705`；`general` 那一项为其时的候选版本——**基座漂移后已重生成并按 §6.6 复测**）；页内 `[data-keepalive-section]` 打开时为 **1**（B 为 **0**）；
  - 自身浏览器 pid 存活：起跑 `[true]`、收尾 `[true,true,true]`；未匹配的插件请求 45 个（= 其余非目标 bundle，符合预期）。

**⇒ 验收 1：PASS（8/8，两个独立器械、两种实现、两份原始 JSON 一致）。**

#### 7.1.1 一处**必须在报告里出现**的非零观测（如实记录 + 归因）

二级档在交付后又自行补跑了一次 `--only gate`（P 相位，`raw/gate-P-20260922T082232Z.json`，16:22–16:32 CST，**已跑完**：`count = "7/8"`, `pass = false`）。该次观测到：

| 栏目 | leak | 泄漏 URL | 该窗 `firstVisit` 计数 | 心跳/valid |
|---|---|---|---|---|
| **模型** | **1** | `POST http://127.0.0.1:3080/api/credentials.describe` | **1**（而审计与本档其它跑次均为 **2**） | 67 ticks / valid=true |

**归因（有 URL 级证据，不是推测）**：
`settings-models` 的 `ModelsSettingsStore.load()` 是**两段式**：先 `await Promise.all([api.llm.providers({}), describeFace.ensure()])`（`:548`），**随后**再 `await api.credentials.describe({ refs })`（`:578`）。
该次运行里第一段落在"首访窗"，**第二段（`credentials.describe`）晚到、落进了切换后的泄漏窗**——`firstVisit` 只捕到 **1** 个请求（应为 2）恰好印证这次"一对被窗口边界切开"。
⇒ **这是刚访问过的面板自身首访加载的在飞尾巴，不是隐藏面板的轮询泄漏**；而且「模型」栏目**结构上没有任何轮询**（其 store 靠 `status === "idle"` 闸门，二次访问恒 0），隐藏态不可能自发出请求。
触发条件可解释：该窗与另一条线的浏览器重叠、`loadavg≈8`，`credentials.describe` 的往返被拉长到跨越 2.5 s 的 settle 边界。

**对结论的影响（诚实表述）**：
- 门控判据在**全部 4 个跑次、合计 26 次"栏目×窗口"测量中 25 次为 0，唯一 1 次非零**（模型，`credentials.describe`），已按 URL 证据归因为**在飞首访请求**。合账：

| 跑次 | 相位 | 覆盖 | leak=0 | 非零 |
|---|---|---|---|---|
| 主器械 full | P | 8 栏 | 8 | 0 |
| **独立器械 full** | P | 8 栏 | 8 | 0 |
| 独立器械（rebase 后定向） | P | 栏 0、2 | 2 | 0 |
| 主器械 `--only gate` 复跑 | P | 8 栏 | **7** | **1（模型，已归因）** |
| 主器械 `--only gate` | B | 8 栏 | 8 | 0 |
| 独立器械 full | B | 8 栏 | 8 | 0 |

- 归因成立的**独立旁证**：本档独立器械的完整 P 跑次（16:13–16:21）与主器械的完整 P 跑次（16:06–16:08）在同一栏目上均为 **leak=0**；
- #### 7.1.2 该次非零的**机制裁决**（二级档提"REWORK：模型包不在补丁覆盖内 ⇒ 真实缺口"；本档给出代码级反驳 + 保留其结论的操作面）

二级档的推理是："B 同栏目同协议 = 0 ⇒ 该请求是 keep-alive 引入；且 `settings-models` 不在 5 个候选件内、不消费 `visible` ⇒ 补丁面覆盖不足"。本档做了三项独立取证：

1. **URL 级**：该请求 `POST /api/credentials.describe` 正是 `ModelsSettingsStore.load()` 的**第二段**（`settings-models:548` 先 `await Promise.all([api.llm.providers({}), describeFace.ensure()])`，`:578` 再 `await api.credentials.describe({refs})`）。该次运行 `firstVisit` 对模型只捕到 **1** 个请求（本档两次全跑该栏均为 **2**：`llm.providers` + `credentials.describe`）⇒ **一对被窗口边界切开**。
2. **代码级（决定性）**：`ModelsSettingsStore` 的 `status` 从 `"idle"`(`:512/2387`) 只在 `load()` 内按 `"loading"(:541) → "ready"(:586)/"error"` 单向推进，**全库没有把它写回 `"idle"` 的路径**；而"是否再次 load"的唯一闸门就是渲染期的 `if (state.status === "idle") controller.load()`（`:1856`，另有 `:2210/:2298` 两处同形）。⇒ **隐藏面板的重渲染不可能重新触发 `load()`** —— "keep-alive 让隐藏模型栏重新取数"这条机制**在代码层被排除**。
3. **时序级**：该请求在泄漏窗开始后 **+5356 ms** 才发出（≈点击后 **8.7 s**）。若是"切换导致的重取数"，它应出现在切换附近（+0~0.1 s），而不是 5 s 之后；8.7 s 的首访时长与当时的 `loadavg≈8.5`（本档自己的浏览器也在同时跑）一致。

**本档的裁决（供协调者最终判定）**：
- 这是**该面板自身首访两段式加载的尾巴**（在飞续延），**不是隐藏面板的自发/轮询请求**，也不是 keep-alive 引入的新行为——`load()` 的续延在 B 相位同样存在（store 是 plugin 作用域、不随组件卸载消失）；两次 B 复跑（`raw/k1-baseline-model-leak-rep{1,2}.json`）里该栏**首访窗与泄漏窗都是 0**（即该次 `load()` 连请求都没落进我们的两个窗口）⇒ 该现象**在时序上不可复现**，B/P 的差异是**负载相关的时序差异**，不是机制差异。
- **但**：硬性验收 1 的字面表述是"切走后 60 s 内该栏目 RPC = 0"，该次**确实**被违反（26 次测量中的 1 次）。本档**不**把它记为 PASS 的例外而不说明，而是明确列为**开放项**。
- **若协调者要求"任何时序下都字面 8/8"**，正确的修法有两条，**都不在本档被授权的交付单元内**（K1 的三段只点名 general/plugins/usage/ssh-gui/ws-enh）：
  (a) **协议侧（推荐）**：切换前**等到网络静默**（或在泄漏窗内按 URL 家族排除"刚访问栏目首访在飞请求"）——因为这是"首访还没做完就走"的度量假阳性；
  (b) **功能侧**：给 `settings-models` 的 `load()` 第二段加"面板不可见则丢弃/不发起"语义——但首访本来就要取 credentials，改它等于改变首访语义，需单独审计授权。

**协议改进建议（给后续复测）**：把"切走"改成**等到网络静默**（或在泄漏窗内按 URL 家族排除**刚访问栏目的首访在飞请求**）——否则高负载下会周期性地产生这一类假阳性。本档**未**修改该次产物（保持原样），仅在此如实记录与归因。

### 7.2 重复访问收益（硬性验收 2）

判据按"可判别性"分成两栏，**必须分开陈述**：

| 判据 | 基线（B，切回即重挂） | 打补丁（P） | 结论 |
|---|---|---|---|
| **二次访问该栏目 RPC**（计数类，**无污染**） | 分布式控制 **4**、远程工作区 **1**、Agent 预设 **1**、通用设置 **1**、插件 **1**（`/usage/status`）、模型 0 | **8/8 全为 0**（主器械 cycle1+cycle2 双轮、含排除"点击前已活动"后的 7 次真实切换）；**独立器械另跑一轮 `revisit` 也 8/8 为 0**，且每次 `slotStillSameNode=true` | ✅ **PASS（两器械一致）** |
| **二次访问 mount fiber = 0**（字面判据） | — | cycle2 mounts = `0/18/18/18/27/27/153/18` ⇒ **≠ 0** | ❌ **字面未达标** |
| **面板子树是否被卸载**（无混淆机制判据，本档新增） | B：**`isConnected=false`**（切走即被 React 销毁） | P：**`isConnected=true` 且 `sameNodeStillTagged=true` 且 `hiddenNotUnmounted=true`** | ✅ **PASS** |
| 阴性内对照（重复点击已活动项） | B 2/2 `mounts=2349/1215`（被污染） | P 2/2 **`mounts=0 / commits=0 / RPC=0`** | ✅ PASS |
| DOM 常驻量 | 单面板（`allStar≈697`） | 8 面板常驻（`allStar=1339`／独立器械 **1339–1422**），`slotVisible=1` | 已知成本，见 §7.3 |
| 常驻集合内容 | — | `keepaliveIds` 逐字等于 8 个已访问栏目的 id（顺序与导航行一致）⇒ **"只保留访问过的"**被逐 id 证实；且未访问的栏目不会出现 | ✅ PASS |

**二级档独立复核（本轮追加，加强本节）**：它用 `--serve-preimage` 造出**真基线臂**（`route.fulfill` 注入 `pre-image/*.orig.js` 基线字节，启动时逐件校验 `bd7edeaec382/36afbb9bcc6e/cdbd87b6d97e/5e23bc192d14/7df7a655ee66` 全 match），并把"槽节点身份存活"做成**主判据**（锚点仅作诊断），得到：
- **B 臂（真基线字节）8/8**：切走后内容节点 `isConnected=false`、切回 `sameNode=false`（卸载 + 重建新节点）；
- **P 臂 8/8**：切走后 `isConnected=true` + `hiddenByWrapper=true`、切回 `sameNode=true`（隐藏而非卸载 + 复用同一节点）；
- 其 P 臂实测送达哈希 = **`1e75c77ba045 / 4ddfa5bb02ba / 51fd8d9b0cb6 / b3e0c225b3da / 56faaf956705`**，即**本档最终（已部署的）修订版** ⇒ 该主判据在**实际线上字节**上成立；其后续第三次回报（`raw/mech3-B-preimage-20260922T084439Z.json` / `raw/mech3-P-20260922T084528Z.json`）再次给出同结论，并**补齐了器械阳性对照**：B 臂（真基线字节）`isConnected=false` **且** `anchorStillConnected=true` ⇒ 判据**能**测到卸载 ⇒ **器械 VALID**；P 臂 `isConnected=true ∧ sameNodeStillTagged=true ∧ hiddenByKeepaliveWrapper=true`，`panelRectW=0` 属**正确预期**（常驻面板被 `display:none`）。两条线、两套器械、四组臂全部一致；
- 它同时独立复现了本档 §7.0 缺陷 3 的结论（**只标槽锚点无判别力**，基线臂里锚点同样 `anchorIsConnected=true`；须标记"锚点的渲染子节点 = 栏目实例根"）——两条线**独立得到同一修正**。

**关于"mounts ≠ 0"的裁决依据（为什么它不是反证）**：
1. **该通道在本环境结构性不可用**：主器械的**无点击空转窗**实测 B 地板 `mounts=1404/1674`（**点击窗信号只有 16–274 ⇒ 地板高于信号**）；同器械 P 空转地板 `0/0`。**两个相位的 mounts 不可比**，B 侧审计基线（27/34/126/…）在本环境无法复现。
2. **本档的无混淆机制判据直接回答了那个问题**：面板**自己的根 DOM 节点**在切走后仍 `connected`、且**同一节点**（`sameNodeStillTagged`）在被隐藏状态下存活 ⇒ 面板**没有被卸载/重挂**。
3. ⇒ P 切换时那 18–153 个挂载**不是设置面板的重挂**（否则 RPC 必然重发，而 RPC 实测 0/8）。最可能的来源是别的子树（后台会话事件流/懒挂载路径），本档**不把它归因给设置面板**（无归因证据就不归因）。
4. **必须如实标注**：任务书里"二次访问 mount fiber = 0"这条**字面判据在本环境未达标**；本档用 **RPC 为零 + DOM 节点身份存活**两条等价且更强的判据替代，**是否接受这次判据替换由协调者裁决**。

### 7.3 C1 护栏：`ThemePresenter.apply` 的 cost/script 比值（硬性验收 3）— **INCONCLUSIVE（未获验证）**

**两个独立器械、两种实现，结论一致：dwell 态下 `apply` 的自采样数为 0。**

| 器械 | 窗口 | `totalSamples` | `jsHits` | **`applySelfHits`** | `applyShare` |
|---|---|---|---|---|---|
| 主器械（二级档） | B ×3×20 s | ≈52 k | 1.6–1.9 k | **0** | 0 |
| 主器械（二级档） | P ×3×20 s | ≈131 k | 726–851 | **0** | 0 |
| 独立器械（本档） | P ×2×15 s | 98 979 / 97 612 | 4 583 / 5 066 | **0** | 0 |

**根因（代码级，本档独立定位）**：
- `apply` 只有两个调用点：`dsh-client-ui-layout/lib/client.js:553`（启动时一次）与 `:555`（`ctx.theme.subscribe` 回调内）⇒ **只有主题快照变化时才跑**；
- 本部署 `~/.dsh/settings.yaml:219` 是 **`ui-theme.preference: light`**（不是 `system`）⇒ `dsh-client-ui-theme` 的 `prefers-color-scheme` 监听在 `:1136`（`if (this.preference !== "system") return;`）**直接返回** ⇒ 连"用 CDP 模拟 `prefers-color-scheme` 制造主题变化"这条**只读**刺激手段也被这条配置堵死；
- 独立器械的采样明细证实窗口本身是空闲的：`(idle)` **91 471 / 98 979 = 92.4%**，且 top-20 节点里**没有任何一帧来自 `dsh-client-ui-layout`**（`layoutTop=[]`）。

⇒ **比值是 0 ↔ 0，无判别力**。按纪律：**不得据此宣称"不劣化"**，也不得宣称"劣化"。**停止条件（`apply` 比值劣化）未触发**（无劣化证据），但该护栏**本批未获验证**。

**已测到的相关量（供协调者判断风险）**：
- DOM 常驻量：**B 单面板 `allStar≈697` → P 8 面板 `1339`（主器械）/ `1422`（独立器械）**，即"访问过全部 8 栏"后文档节点 **约 +92%~+104%**；
- **二级档追加的"三臂"对照（本轮唯一新增的可作结论量；基线臂用 `--serve-preimage` 注入逐件校验过的真 pre-image 字节）**：
  **真基线 DOM = 739** ／ **已打补丁**（部署态 **1413**、候选拦截 **1406**）⇒ keep-alive 常驻 8 面板的代价 ≈ **+667~674 节点（≈ +90%）**。
  该口径比本档的 697→1339/1422 更干净，两者量级一致（+90%~+104%）⇒ 互为交叉验证。
  其 C1 三臂逐窗本轮**补齐了 `foreignCount` / `loadavg` / `lockMine` / 心跳**（此前缺），`applyShare`/`applyOverScript` 仍全为 0 ⇒ §7.3 的 `INCONCLUSIVE` 结论**不变**（0↔0 无判别力）；
  独立器械 P 的 dwell 态：`keepaliveCount=8`、`keepaliveHidden=7`、`slotVisible=1`。
- 审计已量化：`apply` 的 `cost/script` 比随 DOM 规模单调放大（首页 0.98× → 长会话 3.5–3.9× → 设置态 4.1–4.9×）。
- **可复测的配方（交协调者）**：① 把 `ui-theme.preference` 暂设为 `system` 并在窗口内用 CDP `Emulation.setEmulatedMedia({features:[{name:'prefers-color-scheme',value:'dark'}]})` 每 ~500 ms 翻转一次（只读、不动产品文件）⇒ 可稳定制造 `apply` 调用，再比 B/P 的 `applyShare`；或 ② 由 `cpu-profile` 线在其既有插桩下重测。**在拿到该数之前，K1 落地后必须复测这一项。**

### 7.4 既有断言不回归（硬性验收 4）+ 三通道对照 — **PASS**

| 断言 | B | P |
|---|---|---|
| 设置对话框开/关各 3 次 | 0 报错（pageerror + console.error 全期 0） | 0 报错 |
| 打开成功 | 3/3 | 3/3 |
| 初始 focus = 关闭按钮（`VOzbGW_close`） | 3/3 | 3/3 |
| Escape 可关闭 | 3/3 | 3/3 |
| `aria-current="true"` 的 navCell 恒为 1 | 3 reps + 全部 16 次 cycle 点击，取值集合 `[1]` | 同上 |
| `data-slot="settings.section"` **可见**面板恒为 1 | 全 1 | 全 1（独立器械另证 `slotVisible=1`，8 面板常驻时亦然） |
| navCell 恒 8 | ✔ | ✔ |
| 键盘 Tab 依次到达 navCell | 8/8 distinct、单调递增 | 8/8 distinct、单调递增 |
| 语言切换后 8 行 label 正确刷新 | **OK**（中文→English→中文，逐字一致） | **NOT MEASURED**（P 那次语言行定位器未命中）⇒ 不作为 P 的回归证据（B 已过） |
| S9（切走后轮询 0 次） | 0 | **0**（= §7.1 的 8/8 同一批窗口） |

**三通道对照（每相位各一次，阳性=页内 `setTimeout` 忙循环，禁用 CDP 注入）**：

| 通道 | 阳性（120 ms 注入） | 阴性（同长 `none`） |
|---|---|---|
| CDP `RunTask` | 条数 26 081（B 20 072）；**每窗非空** ⇒ 类别写对、无静默空通道 | — |
| LoAF `duration` max | **120 ms** | `null`（无条目） |
| wall-clock rAF max | **121 ms** | 24.3 ms |

⇒ 三通道同时报出（3/3）；窗口播种满足（块前那一帧被保留）。

### 7.5 并发条件与窗口清单（如实记录，含失败窗口）

| 项 | 实测 |
|---|---|
| 宿主 | PID **301709** 全程存活；**未重启、未 pkill 任何进程**（含浏览器） |
| 锁 | B 相位取到过（2 次 BUSY 后成功，`lockMine=true`）；P 相位**始终未取到**（4 次 BUSY；持有者 `exec-a11y pid=963852`、`w07-exec-proj pid=1018556`、`exec-a11y pid=1022131`、`w27-scale150 pid=1069928`，liveness 全 **ALIVE**）⇒ 预算耗尽后**不持锁继续跑**并逐窗标 `lockMine:false`。**从未回收、未争抢、未改写他人 `owner.txt`** |
| 外来主浏览器 | 每窗 **1–4** 个（cmdline 含 `--remote-debugging-pipe` 且不含 `--type=`；**未用 `pgrep -f`**） |
| `/proc/loadavg` | 4.2 – 8.5（实测区间） |
| 独占窗口 | **0/20** ⇒ **一切绝对 ms/ms/s/fps 标 `INCONCLUSIVE(CONTENDED)`** |
| 窗口心跳 | 每窗 Δ1 s-ticks 与 ΔrAF-ticks 均 > 0；门控窗 ticks 65–67 / 65.0 s（与跨度一致） |
| 浏览器 pid 存活 | 每窗前后记 `/proc/<pid>/stat`（失败按存活）⇒ 全 true |

**保留的失败 / VOID / INVALID 窗口**（**一律未剔除**）：
- `raw/VOID-gate-instrument-defect-ab-B-*.json`（gate 窗口塌缩成 ~20 ms 的缺陷期数据）；
- `raw/VOID-killed-before-any-window-ab-P-*.json`（修复前的 P 跑次，未进入任何窗口）；
- `raw/VOID-url-match-bug-*.json`（P 拦截 0 命中的那一次 —— 其 `INTERCEPT SELF-PROOF pass=false` 把它挡住了）；
- **独立器械的首次 P 跑次**：在 i=1 时被环境关闭浏览器（`FATAL page.evaluate: Target page, context or browser has been closed`，日志在 `raw/k1-ind-P.log` 的首轮记录里保留；该跑次只落盘 1/8 栏目，随后**完整重跑**得到 §7.1 的 8/8）。
- **独立器械的首次 P 跑次之前还有一次**：因本档自身的 plugin-key 前缀缺陷导致 `[data-keepalive-section]=0`（页面拿到未打补丁字节）⇒ 被页内断言当场识别，未进入结论（日志同样保留）。

**窗口/断言的完整清单**：主器械 20 个窗口（B 10 + P 10）全部 `valid`（跨度+心跳通过）且全部 `CONTENDED`（`exclusive=0`）；独立器械 B 8 窗 + P 8 窗 + revisit 8 次，全部通过跨度/心跳断言；C1 采样 B 3 窗 + P 3 窗 + 独立 P 2 窗（`applySelfHits` 全 0）。


<!-- LIVE-AB-BEGIN -->
（二级器械档 `9ec0c360` 的 `raw/ab-summary.md` + `raw/ab-*.json` 为本节数据出处；`raw/k1-gate-independent-*.json`、`raw/k1-c1-*.json` 为独立第二器械的原始证据）
<!-- LIVE-AB-END -->

---

## 8. 硬性验收逐条对照

| # | 硬性验收 | 状态 | 证据 |
|---|---|---|---|
| 1 | **逐栏目门控 8/8**：切走后 60 s 内该栏目 RPC = 0 | ✅ **PASS（8/8；全部 P 跑次合账 25/26，唯一 1 次非零已按 URL 证据归因，见 §7.1.1）** | 协议：点 i → 切到**另一个 0-取数栏目**（vision-adam ↔ 子代理模型 互为目标态）→ 观察 **65 s**（> `refreshSec`=60，保证未门控的 interval 至少触发一次）⇒ 窗口内任何出站请求都无歧义地算泄漏。主器械 8/8 为零（窗长 65.03 s、心跳 66–67）；独立第二器械复现。**判别力**：P 相位 8 面板确实常驻（`keepaliveCount=8 / hidden=7 / slotVisible=1`），那个 60 s interval 在整窗内活着却发 0 个请求；同一卡片在 B 相位实测**会**发 `/usage/status` ⇒ 非空洞通过 |
| 2 | **重复访问收益**：二次访问 mount fiber = 0、RPC = 0 | ⚠️ **RPC 8/8 = 0 → PASS；mounts 字面未达标** | RPC：P cycle1/cycle2 全 0/8 vs B 切回重取 4/1/1/1/1；mounts：P cycle2 = 0/18/18/18/27/27/153/18 ≠ 0，但**该通道在本环境结构性不可用**（B 空转地板 1404–1674 > 点击信号 16–274）。替代判据（无混淆）：**面板子树 DOM 节点身份存活** — B `isConnected=false`（切走即销毁）vs P `isConnected=true + sameNodeStillTagged=true + hiddenNotUnmounted=true`。阴性内对照：P 重复点已活动项 `mounts=0/commits=0/RPC=0` ✔。<br>⚠️ 另：审计的 mounts 基线（27/34/126/…）在本环境**无法复现**，本档**不引用**它作对照 |
| 3 | **C1 不劣化**：`ThemePresenter.apply` 的 `cost/script` 比值不劣化 | ⚠️ **INCONCLUSIVE（未获验证）** | 两器械、两种实现，dwell 态 `applySelfHits` 均为 **0**（主器械 3+3 窗、独立器械 2 窗；独立器械另证 `(idle)` 占 92.4%、top-20 无任何 layout 帧）⇒ 比值 0↔0 无判别力。代码级根因：`apply` 仅由主题快照变化触发（`layout:553/555`），而 `settings.yaml:219 preference=light` 使 `prefers-color-scheme` 通路失效（`theme:1136`）。**DOM 常驻量已量化**：697 → 1339/1422 节点（+92%~104%）。**落地后必须按 §7.3 配方复测** |
| 4 | **既有断言不回归** | ✅ **PASS（两相位）** | S9 切走后轮询 0 次（= 验收 1 的同一批窗口）；弹窗开/关各 3 次 **0 报错**；初始 focus = 关闭按钮 3/3；Escape 关闭 3/3；`aria-current="true"` 恒为 1（3 reps + 16 次点击，取值集合 `[1]`）；**可见面板恒为 1**（全 16 次点击 + 独立器械 8 面板常驻时 `slotVisible=1`）；navCell 恒 8；Tab 依次到达 navCell **8/8**。⚠️ P 的 locale 未测到（定位器未命中）⇒ 不作 P 的回归证据，已标注 |
| 5 | **不得宣称消除可感卡顿** | ✅ **PASS（口径遵守）** | 审计实测 32 次切换 `RunTask max ≤ 20.3 ms`、`LoAF 0`、`rAF max ≤ 23.2 ms`，无一越过 50 ms ⇒ 本档全部收益口径写成"**消除重复小成本**"与零判据；§7 的帧级数字一律只作相对 KPI |
| 6 | **判据与并发标注** | ✅ **PASS（口径遵守）** | 三通道 + 阳性/阴性对照 + 窗口播种；每窗心跳 + 浏览器 pid 存活 + `lockMine`/`foreignCount`/`loadavg` 标注；**20/20 窗口 CONTENDED**，绝对量一律 `INCONCLUSIVE`；失败/VOID/被环境中断的窗口**全部保留**（§7.5） |


---

## 9. 显式不做 / 范围纪律

1. **未改渲染器**（`dsh-client-ui-renderer`）：K1-① 只动设置壳，与审计"不需要改渲染器"一致。
2. **`settings-models:538` 的 generation "只排序不取消"未改**：审计 K1-③ 末尾提到它，但——(a) 它的 `load()` 已在 `generation !== this.generation` 时**丢弃被顶替的写入**（`:556/:584`），所谓"不取消"剩下的只是"在飞 RPC 不可 abort"，而当前 `rpc()` 契约没有 `AbortSignal`，真取消要改 rpc 层（**扩范围**）；(b) 它是**唯一**二次访问 RPC = 0 的栏目（idle 闸门 `:1856`），改动它反而有破坏该闸门的风险；(c) 没有任何硬性验收要求它。⇒ 记录为**显式不做**，理由是证据而非省略。
3. **未给 ssh-gui / ws-enhancement 加"重复性副作用门控"代码**：静态普查证明这两个栏目**没有任何重复性副作用**（§5.1）⇒ 加一段永不执行的 `visibleRef` 是死代码，只会扩大回归面。门控面只有 `dsh-usage` 一处，已在 k1-2 覆盖。
4. **未动 `dsh-workspace-enhancement` 的模块级徽标子系统**（`row-badges.js` 的 `MutationObserver`/`addEventListener`/`setInterval`）：模块级、每次页面加载只跑一次，keep-alive 不改变其生命周期（审计 §4.3 同结论）。
5. **未改** `settings-plugins` 既有的双层 keep-alive 语义（`visitedIds` + `hidden` + 键盘语义），只在其中**追加** `visible` 透传。

---

## 10. 同档自复核（Revise-Execute-Review 自裁决）

### 10.1 对照审计逐条核对

| 审计要求 | 落地 | 自评 |
|---|---|---|
| K1-① 形状：`rows.filter(active \|\| visitedIds.has)` + 每 panel `role/aria-labelledby/hidden` + `only` 传**该行自己的 id** | 完全同构（`:181-191`） | ✔ |
| K1-① 保留策略"只保留访问过的"（审计风险 2 的保守做法） | `visitedIds` 在 `SettingsPanel`，随对话框卸载释放 | ✔ |
| K1-① 收益口径写成零/比值 | §8 全部为零判据 | ✔ |
| K1-② `visible` 由 `active === r.id` 派生、经 ownerProps 下发 | 容器里 `visible: selected` | ✔ |
| K1-② 不变量：首访加载与手动刷新不受门控 | §5.3 锚点断言（`cardVisible` 3 次、两个块内 0 次） | ✔ |
| K1-② 门控遗漏是静默的 ⇒ 逐栏目为零断言 | §5.1 静态闭合 + §8 验收 1 的 live 8/8 | ✔（live 见 §7） |
| K1-③ 两个零 cleanup 包补 `aliveRef` + generation | SG-1..4 / WE-1..2，形状照抄 `dsh-usage:840-852` | ✔ |
| 三段顺序 ③→②→① 不可颠倒 | 补丁器段序即 ③→②→①；`--apply` 亦按此序 | ✔ |
| 三段可独立回滚 + 给出每段回滚命令 | §6.3 + 排练实测（只回滚 k1-1 时其余 4 个不受影响） | ✔ |
| 不宣称消除可感卡顿 | §8 验收 5 | ✔ |

### 10.2 副作用自查

| 潜在副作用 | 自查结论 |
|---|---|
| 布局变化（多包一层 wrapper） | `.VOzbGW_options` 无 `display` 声明（纯块容器）⇒ 块级 wrapper 布局等价；live §7 第 4 项报"可见面板恒为 1"作旁证 |
| `hidden` 被作者样式压掉 | 隐藏时**内联** `display:none`（内联优先于任何作者规则），不依赖 UA `[hidden]` |
| a11y 回归 | 只**新增** `role="tabpanel"`/`aria-labelledby`/navCell `id`；**未改** `aria-current` 语义与键盘可达性 |
| 门控误闭（把该加载的关掉） | `props.visible !== false` 缺省即开放（向后兼容）；且不变量断言证明加载/手动刷新未受门控 |
| 切回重新取数（最危险的写法） | 挂载取数 effect 的 deps **保持 `[]`**，未写成 `[visible]` |
| 父路径级联重渲染（audit K2/K5 面） | 未加 memo 边界（审计明确 K2 单独做零收益），本档不碰 |
| 段间耦合 | 三段文件互不重叠；k1-2 在 `visible` 缺失时惰性 |
| React key 唯一性 | 容器 wrapper 用 `key: row.id`，与**既有** nav map（`settings-general:132-143` 同样 `}, row.id)`）**同键策略** ⇒ 未引入新的键唯一性要求；live 导航行实测恒为 8 行（三次独立会话，`raw/settings-nav-rows.json`）⇒ `rows` 内 id 唯一 |
| 补丁器子串误伤 | 16/16 hunk 的 `anchor` 实测 `count===1`（dry-run 逐条打印 `a1/r0`）；§6.2 的字节增量对账给出"声明之外零改动"的机检证明 |
| DOM 常驻放大 C1 | 只保留访问过的栏目（visitedIds），实测"访问全 8 栏"后文档节点 697 → 1339/1422（+92%~104%）；DOM/`apply` 一并进 live 护栏 |
| 判据替换风险（本档自曝） | mounts 判据在本环境不可用 ⇒ 已换成 RPC 为零 + DOM 节点身份存活；**替换本身需协调者裁决**（见 §0 偏差 A） |
| 未验证项没有被掩盖 | C1 明确标 `INCONCLUSIVE`，未写成 PASS（见 §0 偏差 B 与 §7.3），并给出可执行的复测配方 |

### 10.3 自裁决

**口径**：本档是三段交付的**执行档**，不是"无条件放行"。按"审计契约 + 硬性验收"逐条核对后自裁决如下。

**PASS（可直接作为结论采纳）**
1. **K1-③/②/① 三段实现**：形状与审计指定的仓库内先例**同构**（`settings-plugins:419/489-500` 的 keep-alive；`dsh-usage:840-852` 的 aliveRef+generation；`dsh-usage:774-810/983` 的可见性门控），无自造机制、未改渲染器、未扩范围（§3/§4/§5）。
2. **门控不变量被锚点断言**：`cardVisible` 恰 3 次、首访加载与手动刷新块内 0 次（§5.3）——不是注释承诺。
3. **门控面闭合（静态）**：keep-alive 可达子树内**只有 1 处**重复性 RPC 源，已被 k1-2 覆盖；8 个栏目自身区域内**零**重复性副作用（§5.1）。
4. **补丁器纪律 + 无附带改动**：dry-run 默认 / 全命中才写 / 自动 pre-image / `node --check` / 幂等 / 段级回滚；字节增量对账 5/5 吻合且逆向还原 pre-image 逐字节相同（§6）。
5. **硬性验收 1（8/8 门控）**：P 相位 8/8 为零，窗长 65.03 s + 心跳双实证，**判别力已论证**；独立第二器械复现（§7.1）。
6. **硬性验收 2 的 RPC 判据**：二次访问 RPC **8/8 = 0**（B 相反对照仍在重取）（§7.2）。
7. **硬性验收 4（不回归）**：弹窗开合 0 报错、焦点/Escape/`aria-current`/可见面板恒 1/键盘 8/8 全过（§7.4）。
8. **口径纪律**：不宣称消除可感卡顿；绝对量全标 CONTENDED；失败/VOID/中断窗口全部保留（§7.5）。

**未达标 / 未验证（必须上报，不得自行放行）**
1. **`mounts === 0` 字面未达标**（P cycle2 = 18–153）。**我的判断**：这不是补丁缺陷，而是该通道在本环境不可判别（B 空转地板 1404–1674 > 信号 16–274；两相位不可比），且 **DOM 节点身份存活**这条无混淆判据已给出"面板未被卸载/重挂"的决定性证据。**但替换判据是业务裁决，交协调者。**
2. **C1 护栏未获验证**（`apply` 自采样 0，比值 0↔0）。**我不同意**把它写成"不劣化"；已标 `INCONCLUSIVE` 并给出复测配方（§7.3）。落地后必须复测。
3. **P 的 locale 未测到**（器械定位器未命中）；B 已过。不作 P 的回归证据。
4. **基座漂移两处**（兄弟线在同一批内改了本档两个目标文件）：
   - `@local/dsh-usage` `cdbd87b6d97e → 8f53e475d625`（`exec-usage9`）⇒ 候选件重生成 `51fd8d9b0cb6`；
   - `dsh-client-ui-settings-general` `bd7edeaec382 → 0853da8858dc`（`exec-masklook`，遮罩 mask/ring 重做）⇒ 候选件重生成 `1e75c77ba045`，并已在新基座上**定向 live 复测通过**（§6.6.1）。
   本档为此加了 **fail-closed 漂移闸门**（sha ≠ 校验基座 ⇒ 拒绝写任何文件）。**部署前必须再跑一次 `verify-KeepAlive-v1.mjs`**。
5. **`exec-usage9` 的落地改变了"插件"栏目的取数形状**（首访/切回从 9 路变少）：本档 P 相位的"插件=0"结论仍然成立（门控与它正交），但**B 相位的 9 路基线已不是当前的部署行为**；引用时请以 usage9 之后的行为为准。

**自裁决：`PASS-with-caveats`**（不是无条件 PASS，也不是整体 REWORK）。
判定依据：核心收益（切回不重取数 + 切走不漏轮询）在 live 上 **8/8 达成且有判别力**，既有断言零回归；两条偏差中一条是**判据环境不可用**（已给等价且更强的替代证据，等裁决），另一条是**未验证**（已如实标注，不冒充 PASS）。二者都不构成"实现有缺陷"的证据。

**`REWORK` 条件（触发即返工，不自行重跑）**
- 任一栏目"切走后 65 s 内 RPC = 0"不成立 ⇒ 继续向嵌套槽下发 `visible`（最可能是 `settings.plugin.item` 之外的路径）；
- 二次访问 **RPC ≠ 0**（本档 P 已 8/8 = 0；若部署后复测非 0 ⇒ 容器形状或取数 effect 的 deps 出问题）；
- 按 §7.3 配方复测后 **`apply` 的 cost/script 比值中位数劣化** ⇒ 收紧保留策略（如限制常驻面板数 / 离开后延迟回收），必要时放弃 K1-① 只保留 K1-②③；
- 部署前 `verify-KeepAlive-v1.mjs` 报出**新的**基座漂移且锚点不再唯一命中 ⇒ 重新生成候选件后再部署。

### 10.4 交付边界（诚实清单）

1. **`deployed` 写入未由本档执行**（按任务约定由协调者执行）；本档全部 live 结论来自**等价字节的就地替换**（`page.route` 注入候选件，响应体哈希 5/5 逐位核对）。
2. **独占窗口 = 0/20**：所有绝对量 `INCONCLUSIVE(CONTENDED)`；本档只用计数/为零/比值/存在性。
3. **C1 与 mounts 两个通道在本环境不可用**（原因见 §7.0 缺陷 2/3 与 §7.3），本档已改用可判别的替代判据并如实标注替换。
4. **本档未重启宿主、未 pkill 任何进程、未回收任何锁**。


---

## 11. 收口声明（2026-09-22 16:4x，响应"宿主随时重启"的收口通知）

### 11.1 ★ 部署已由协调者完成，且**逐字节命中本档候选件**（实测）

> **provenance 澄清（防止错误归因）**：二级档在复核时发现 `candidate/` 与部署态的哈希"在会话中途变化"（general `6464b7b06ca0 → 1e75c77ba045`、usage `992fe978004e → 51fd8d9b0cb6`），并推测为"另一条线把第二修订版落到了候选目录与部署态"。**该推测不成立**：
> 这两次变化分别来自 **① 本档自己**为响应两处基座漂移（`exec-usage9` 改 `dsh-usage`、`exec-masklook` 改 `settings-general`）而**重新生成候选件**，与 **② 协调者执行本档的 `--apply`**（部署）。**没有任何第三方改过 `candidate/` 或本档的 5 个目标文件**。
> 由此产生的有效约束（二级档提出、本档认同）：**每个跑次的结论只对其实际送达的哈希成立**——所以 §7/§11 的所有 live 结论都按"跑次 + servedHashes"记账（见 §7.1 的跑次合账表与 §11.1 的部署哈希表）。
> **补充（第三、四次回报仍写作"另一条线"）**：二级档后续两份报告继续把该变化描述为"另一条线改写了候选目录与部署态"，并据此提示"P 臂结论不能迁移到当前线上修订版"。**该提示在其自身数据上已不成立**：其后两次 P 臂（`mech2-P-*`、`mech3-P-*`）实测送达哈希均为 `1e75c77ba045 / 4ddfa5bb02ba / 51fd8d9b0cb6 / b3e0c225b3da / 56faaf956705`，**就是当前线上修订版** ⇒ 机制主判据（§7.2 的槽节点身份存活 8/8）**可以直接迁移到线上字节**；只有 07:54 那次 `ab-P` 的送达是旧修订（`6464b7b06ca0 / … / 992fe978004e / …`），其结论同样成立但不覆盖 masklook 基座。

| 文件 | 部署态 sha256-12 | 本档候选件 | 一致 | `served==disk` |
|---|---|---|---|---|
| `dsh-client-ui-settings-general` | `1e75c77ba045` | `1e75c77ba045` | ✅ | ✅ |
| `dsh-client-ui-settings-plugins` | `4ddfa5bb02ba` | `4ddfa5bb02ba` | ✅ | ✅ |
| `@local/dsh-usage` | `51fd8d9b0cb6` | `51fd8d9b0cb6` | ✅ | ✅ |
| `@local/dsh-ssh-gui` | `b3e0c225b3da` | `b3e0c225b3da` | ✅ | ✅ |
| `dsh-workspace-enhancement` | `56faaf956705` | `56faaf956705` | ✅ | ✅ |

**部署后零成本自证（witness 存在性 + 热面哈希，未新增实验）**：
`data-keepalive-section`=1 / `visitedIds`=3 / `SECTION_HIDDEN_STYLE`=2（general）；`useTabs, visible`=1、`{ visible }`=2（plugins）；`cardVisible`=**3**（usage，与静态断言期望一致）；`refreshGenerationRef`=4 / `if (!current()) return;`=2（sshGui）；`refreshGenerationRef`=4（wsEnh）。
⇒ **三段全部在部署态生效**；浏览器刷新一次即热生效。

### 11.2 可交回判定
- **已达标（可直接采纳）**：三段落地与纪律 / 门控 8/8（两个独立器械，合账 25/26 且唯一非零已归因）/ 二次访问 RPC=0（8/8）+ 面板 DOM 节点身份存活（8/8）/ 既有断言零回归 / 口径纪律（不宣称消除可感卡顿、绝对量全标 CONTENDED、失败窗口保留）。
- **需你裁决的两条**：① `mounts===0` 字面判据未达标（通道在地板之上，已用等价判据替代）；② 模型栏那 1 次晚到请求（§7.1.2 已用代码级证据排除"隐藏重载"，但字面判据被违反过 1 次 ⇒ 开放项，修法二选一）。

### 11.3 BLOCKED / 未做（明确缺什么，不扩范围）

| 单元 | 状态 | 缺什么 / 触发条件 |
|---|---|---|
| **C1 护栏（硬性验收 3）** | **BLOCKED（本状态不可测）** | 需要一个"主题快照发生变化"的窗口：把 `ui-theme.preference` 暂设 `system` + 用 CDP `Emulation.setEmulatedMedia` 翻转 `prefers-color-scheme`（只读、不动产品文件），或由 `cpu-profile` 线在其活动窗口重测。现状态下 `apply` 自采样恒为 0（两器械一致）⇒ 比值 0↔0 |
| **P 相位的 locale 回归项** | 未做 | 器械在 P 相位的语言行定位器未命中（B 相位已 OK） |
| **逐次切换的绝对 ms** | INCONCLUSIVE | 需要**独占窗口**（本档 0/20；锁被 ALIVE 兄弟线持有，按纪律未回收） |
| **`mounts===0` 字面判据** | 不适用 | 该通道本环境地板 1404–1674 > 信号 16–274；已用 RPC 为零 + DOM 节点身份存活替代，**待裁决是否接受替换** |
| **与 `exec-virtual` 的交互** | **未测（如实记录）** | 见 §11.4 |

### 11.4 与 `exec-virtual`（插件列表虚拟化）的语义交互 —— **如实记录，未扩改动面**

- **无文件/锚点冲突**：`exec-virtual` 改的是 `dsh-client-ui-settings-plugin-inventory`，**不在**本档 5 个目标文件内；本档 k1-② 只向 `settings.plugins.tab` 与 `settings.plugin.item` 追加 `visible` 键，该子标签不消费它 ⇒ 无覆盖冲突。
- **本档 live 测量不受其影响**：本档全部 live 跑次只点 8 个导航行，**从未进入「插件列表」子标签**，故该面板从未挂载 ⇒ 门控/机制/二次访问/RPC 结论与它无关。
- **潜在交互（**未验证**，仅记录假设，不据此改代码）**：k1-① 会让已访问过的面板在切走后**保持挂载**并处于 `display:none`（inline `display:none` + `hidden`）。虚拟化列表若以容器尺寸决定渲染窗口，在"隐藏态挂载"或"从隐藏态恢复显示"时可能需要一次重新测量，否则有短暂空白/行数不足的可能。**本档未测该项**（按收口通知不新增实验）。
- **一条零成本的检查（供你安排）**：刷新页面 → 打开设置 → 进「插件」→ 切到「插件列表」→ 切到别的栏目 → 再切回「插件」（观察列表是否仍完整可见、滚动到底最后一行是否与 `pluginInventory.list` 条数一致）。若异常，归因应在"虚拟化 + 隐藏态恢复"，而**不在** k1-① 的保留策略本身（保留策略已由 §7.2 的机制判据独立证明）。
- **对 C1 风险面的影响（有利于本档）**：`exec-virtual` 把该面板 DOM 从 1396 降到 186 节点（该线数字）⇒ keep-alive 的**最坏常驻量显著下降**；本档 §7.3 的 697→1339/1422 是**未含虚拟化收益**的上界口径。

### 11.5 收口状态
本档**产物已全部落盘**（`report.md` + `apply-KeepAlive-v1.mjs` + `candidate/`(5) + `pre-image/`(含两套基座) + `tools/`(4) + `raw/`(35 件)），**无未落盘的中间态**；未在跑的进程（仅二级档的 `--only gate` 跑次，已自行结束并落盘）。宿主 PID 301709 未被我重启/终止；锁从未被我回收。**可以重启宿主。**
