# 客户端侧审计：DSH Web GUI「打开设置界面后严重卡顿」

- 日期：2026-09-20
- 审计范围：**客户端侧**（设置插件 bundle + 渲染链），宿主 PID 20806 全程未重启、未改动
- 纪律：全程只读。未修改任何 DSH 安装文件、未改 `~/.dsh/settings.yaml`、未重启服务、未触发高频网络请求
- 方法：字节级精读已构建 bundle（**非压缩、带完整 JSDoc**）+ React 18 真实渲染基准 + 无头 Chromium 活体观测
- 产出脚本（均只读，位于本目录）：`render-cost.mjs`、`probe-open.mjs`、`probe-hotspots.mjs`、`ab-open-vs-closed.mjs`

---

## 0. 结论（先给判定）

> **设置插件代码本身不足以单独解释「打开设置界面后严重卡顿」。**
>
> 实测：在一段安静条件下，打开设置**反而让主线程脚本时间下降**（326 ms → 264 ms / 12s），
> 模型页仅 9 ms / 12s，面板子树 **0 次 DOM 变更**。设置页不是热源。

但设置页**在特定条件下会被动放大一个既有热源**，这条路径在代码里是确定存在的：

```
会话活跃（有流式/子代理/投影帧）
  → sessions.list 快照更新（每次都是全新对象）
  → SettingsRoot 的 useSessions 订阅触发重渲染
  → SettingsPanel 无 memo → 整棵设置子树重渲染
  → 打开的 provider 编辑器把 50 个模型行全部重渲染（523 节点 / 102 个 input）
```

即：**根因是"会话列表快照churn"（宿主/运行时侧），设置页的作用是把它乘上一个放大器，而放大器的缺失防护（无 memo / 无虚拟化）是客户端代码的责任。**

---

## 1. 逐条发现

判定口径：**「能否单独解释严重卡顿」** = 在安静条件下关掉其他因素后，仅凭该条是否产生肉眼可见卡顿。

### F1 ★★★ 设置面板是被动订阅方：会话列表每次变化都重渲染整个设置子树

| 项 | 内容 |
|---|---|
| 现象 | 会话活跃时，设置面板每个会话列表更新周期都整树重渲染一次 |
| 代码位置 | `dsh-client-ui-settings-general/lib/client.js:188` `const rows = useSections((s) => s);` 与 `:190` `const onboardingActive = useSessions((state) => state.phase === "ready" && (...))` |
| | `dsh-client-ui-settings-general/lib/client.js:213-219` `open && jsx(SettingsPanel, { rows, renderSlot, activeId, onSelect, onClose })` —— **没有 memo** |
| | `dsh-client-ui-settings-general/lib/client.js:164` `active !== void 0 && renderSlot("settings.section", { close: onClose }, { only: active })` |
| | 订阅源：`dsh-client-runtime/lib/client.js:9217` `projectList()` → `:9274 this.list.set({ ids, byId, current, ... })`（`ids`/`byId` 每次新建，快照引用必然变化） |
| | 驱动：`dsh-client-runtime/lib/client.js:8302-8306` `session/projection` 帧 → `notifier.markDirty()`；`:7844` `notifier = new Notifier(() => { this.listSnapshotCache = this.buildListSnapshot(); })` |
| 机制 | `SettingsRoot` 用 `useSessions((state) => state.phase === "ready" && (state.current === void 0 || state.byId[state.current]?.blank === true))` 订阅了全局会话列表快照。`sessions.list` 是 `createSnapshotStore`（zustand + immer，`dsh-client-runtime/lib/client.js:5397`），`projectList()` 里 `ids` 与 `byId` **每次重建**，所以只要 manager 发一次 notify，快照引用就变，`useSyncExternalStoreWithSelector` 的 `Object.is` 比较失败 → `SettingsRoot` 重渲染。`SettingsPanel` 是普通函数组件（**无 `React.memo`/`useMemo`/`PureComponent`**，全文件 `grep -c "memo("` = 0），于是每次父渲染都重新创建子树；`renderSlot` 由 `SlotOutlet` 内联渲染（`dsh-client-ui-renderer/lib/client.js:741-750`，`renderEntry` 直接 `jsx(Comp, {...})`，`dsh-client-ui-renderer/lib/client.js:628`），**renderer 内部也没有任何 memo**。 |
| 实测佐证 | `probe-open.mjs` 活体观测：25 秒内设置面板子树 **0 次 DOM 变更**；`ab-open-vs-closed.mjs`：四个连续 12s 窗口内 `panel_mutations` 全为 0。→ 说明**只有当 `sessions.list` 真的变化时**这条路径才被触发；安静态不触发。 |
| 单独解释力 | **否（安静态）／是（会话活跃时，且是"持续卡顿"而非"打开即卡"）**。它需要外部热源点火。 |

### F2 ★★★ 设置子树的每帧成本：模型页把 50 个模型行全部实例化，且无虚拟化

| 项 | 内容 |
|---|---|
| 现象 | 展开任一 provider 编辑器后，该 provider 声明的**所有**模型被一次性实例化进 DOM |
| 代码位置 | `dsh-client-ui-settings-models/lib/client.js:896-991`：`models.map((model, index) => jsxs("div", { className: modelEntry, children: [ ... 2 input + 2 button ... ] }))` —— **无分页、无虚拟化、无 windowing** |
| | `:1530-1534` `const curatedFields = (family) => { ... const models = modelDrafts(modelsOverridden ? customModels : inheritedModels()); ... }` —— 这是 **ProviderEditor 渲染期内的普通函数调用**（不是组件），每次渲染都全量重算 |
| | `:1436` `const modelFailure = validateDeepSeekModels(schema.getPath(draft, ["models"]));` —— 每次渲染对全部模型跑一遍校验（`:217-227`，O(N) 且非 memo） |
| | `:1578` `<details>` 只有 `summary`，**没有 `open` 属性**；`:953` `expanded.has(index) ? (jsxs("div", { className: modelAdvanced ... })) : null` |
| | 数据规模：`~/.dsh/settings.yaml:73-182` adam 声明 **50** 个模型、`:4-72` opencode-go 声明 **16** 个（脚本数得 66） |
| 机制 | 展开编辑器时 `models.map` 把 N 个模型全部实例化成 React 元素并提交；每个模型行固定产出 2 个受控 `<input>` + 2 个 `<button>` + 1 个 `<svg>`（`IconChevron`/`IconTrash`）。**`<details>` 未展开不阻止 React 生成与提交这些节点**，只阻止绘制。 |
| 实测（`render-cost.mjs`，真实 bundle + React 18） | 模型行数 → 元素数：N=49 → **513 元素 / 100 input / 103 button**；N=60 → 623；N=120 → 1223；N=300 → 3023。渲染耗时：N=49 → **0.99 ms**，N=60 → 1.20 ms，N=120 → 2.51 ms，N=300 → 6.13 ms |
| | 设置节挂载态（全折叠）：**仅 20 元素 / 0.12 ms** |
| 单独解释力 | **否**。0.99 ms 的单次渲染即使每帧跑一次也只占 16.7 ms 预算的 6%。只有当 F1 让它每帧重跑时才成为可观成本。**但它是 F1 的乘数**：N 越大，F1 每帧的代价越高（线性）。 |

### F3 ★ 无渲染循环、无定时器、无高频轮询（已实测排除）

| 项 | 内容 |
|---|---|
| 代码位置 | 五个设置 bundle 全量检索：`setInterval` / `setTimeout` / `requestAnimationFrame` / `MutationObserver` / `ResizeObserver` / `IntersectionObserver` / `localStorage` —— **全部 0 命中** |
| 机制 | 设置插件不注册任何定时器或观察者；没有周期性刷新 |
| 唯一定时器 | `SettingsPanel` 只在 **open 期间**挂一个 document `keydown` 监听（`dsh-client-ui-settings-general/lib/client.js:99-107`），关闭即移除 |
| 实测佐证 | `probe-open.mjs`：设置打开 15 s，面板子树 0 次 DOM 变更、0 个 longtask |
| 单独解释力 | **否**。"打开后持续卡顿"**不是**设置页自己的定时器造成的。 |

### F4 ★ 不受订阅的通知风暴：`settings/document-updated` 等四条推送会触发整页 reload

| 项 | 内容 |
|---|---|
| 代码位置 | `dsh-client-ui-settings-models/lib/client.js:2767-2783` |
| | `ctx.remote.$on("settings/document-updated", ...)`、`credentials/reference-updated`、`llm/adapters-updated`、`ctx.on("connection/reset", ...)` → 全部指向 `refreshModels` → `controller.load()` |
| 机制 | `:2712-2714` `refreshIfLoaded` 有 `status === "idle"` 短路（未打开的页面不刷新），但**一旦打开过**，此后每次推送都跑 `load()`；`load()`（`:538-596`）并发发 `api.llm.providers()` + `describeFace.ensure()`，然后 `:585-595` 用 immer 重建整个 `rows` 与 `namespaces` → 快照引用变化 → 再叠加一次 F1 的整树重渲染 |
| 实测佐证 | `probe-hotspots.json` 15 s 窗口内 `/api/settings.describe` 等设置相关调用未出现（安静态无推送）；`measure3.json` 的 `api_call_counts` 显示设置页打开期间 `/api/settings.describe` 2 次、`/api/credentials.describe` 4 次 |
| 单独解释力 | **否**（需要推送源）。属于会叠加到 F1 的次级放大项。 |

### F5 ★ 「插件」页：访问过的 tab 面板永不卸载

| 项 | 内容 |
|---|---|
| 代码位置 | `dsh-client-ui-settings-plugins/lib/client.js:489-498` `rows.filter((row) => row.id === active \|\| visitedIds.has(row.id)).map(...)`，其中 `:496` `hidden: !selected` |
| 机制 | `visitedIds` 单调增长（`:419-427`），凡访问过的 tab 都保持挂载、仅加 `hidden` 属性。DOM 与各 tab 的订阅随访问次数单调累积，**不会随切走而释放** |
| 实测佐证 | `measure2.json`：「插件」页 962 节点，为八个 tab 中最大 |
| 单独解释力 | **否**（首次打开只挂一个 tab）。属长会话内的渐进劣化。 |

### F6 ★ 一次性的、无法解释持续卡顿的成本

| 项 | 内容 |
|---|---|
| 代码位置 | `:2784-2790` 注册 `settings.section`；`dsh-client-ui-settings-general/lib/client.js:555-558` 该 slot 为 `kind: "list"` |
| | `:164` `renderSlot("settings.section", {...}, { only: active })`；`dsh-client-ui-renderer/lib/client.js:845` `if (opts?.only !== void 0) list = list.filter(...)` |
| 机制 | 设置导航有 8 项，但**只有当前一项被挂载**。`ab-open-vs-closed.json` 实测：面板子树 120–168 节点（整页 711–759）。切 tab 只发生一次重渲染 |
| 实测佐证 | `ab-open-vs-closed.json` C 窗口（模型页）：`script_ms: 9`、`frames_over_50ms: 0`、`frame_max_ms: 16.8` |
| 单独解释力 | **否**。这是一次性成本，且量级极小。 |

### F7 ★★ 实测证伪：设置页在安静条件下不是热源

`ab-open-vs-closed.mjs`（同一页面、连续四个 12 s 窗口、无 profiler 干扰）：

| 窗口 | script ms | task ms | RecalcStyle ms | fps | >50ms 帧 | 最大帧 ms | DOM 节点 | 面板节点 | 面板变更 |
|---|---|---|---|---|---|---|---|---|---|
| A 设置关闭 | 326 | 492 | 78 | 58.9 | 2 | 100 | 588 | 0 | 0 |
| B 设置打开 · 通用设置 | **264** | 458 | 79 | 58.8 | 3 | 116.7 | 759 | 168 | **0** |
| C 设置打开 · 模型 | **9** | 123 | 39 | 60.1 | **0** | **16.8** | 711 | 120 | **0** |
| D 设置关闭（复原） | 6 | 74 | 23 | 60.0 | 0 | 16.8 | 588 | 0 | 0 |

`probe-hotspots.mjs`（设置打开在模型页，15 s 窗口）：

```
script_ms 306 (≈20 ms/s)   layout_ms 1   recalc_style_ms 106
ws_frames 15 (1/s)         longtasks 0
mutations_panel   { records: 0, added: 0, removed: 0 }
mutations_outside { records: 22, added: 1, removed: 1 }   ← 热点在 body / sidebar
dom_nodes_total 711 | dom_nodes_panel 120 | dom_nodes_sidebar 481
```

**判定**：安静态下打开设置不产生卡顿。设置面板只占整页 DOM 的 17%（120/711），
而**侧边栏单独占 68%（481/711）**——那才是会话列表倒影所在。

与 `DIAGNOSIS.md` 的实测对照，可解释差异：该报告的 A/B（121 → 190 ms/s）是在**有会话/子代理活跃、
WS 73 帧/s**的条件下测的；本次 A/B 是安静态。**两者不矛盾：热源是会话列表 churn，不是设置页。**

---

## 2. 根因候选清单（按可能性排序）

| # | 候选 | 证据强度 | 能否单独解释症状 | 最小确证观测 |
|---|---|---|---|---|
| **1** | **会话列表快照 churn（运行时侧）**：`projectList()` 每次重建 `ids`/`byId`（`dsh-client-runtime/lib/client.js:9217,9274`），由 `session/projection`（`:8302`）与活动帧驱动 | **强**（CPU profile 9.2% + 实测 121 ms/s；本次 `probe-hotspots` 证实热点在 sidebar/body 而非面板） | **能**（安静态即已卡；峰值 WS 73 帧/s 时 D 窗口同样卡） | 已有：`measure3.json` 空闲 20 s = 2428 ms script、22 个 >50ms 帧 |
| **2** | **设置面板无 memo，被动跟随 #1 整树重渲染**（F1） | **强**（代码确定 + 无 memo 可证；但安静态实测为 0 次变更，触发条件未直接观测到） | 否，是 **#1 的乘数** | 需在**会话活跃**时给面板子树挂 `MutationObserver`，同时统计 `session/projection` 帧率；若每帧 ≥1 次变更则证实 |
| **3** | **模型行全量实例化、无虚拟化**（F2） | **强**（`render-cost.mjs`：N=49 → 513 元素 / 0.99 ms；N=300 → 3023 元素 / 6.13 ms） | 否，是 **#2 的乘数** | 展开 adam 编辑器后测「每次渲染耗时 × 每秒重渲染次数」；用 Performance 面板录 React commit |
| **4** | `settings/document-updated` 等四条推送触发整页 reload（F4） | 中（代码确定，安静态未观测到推送） | 否 | 打开模型页后在其他会话写一次设置，观察 `/api/settings.describe` 与面板变更计数 |
| **5** | 插件页已访问 tab 永不卸载（F5） | 中（代码确定） | 否 | 依次点过全部 8 个 tab，观察 DOM 节点单调增长 |
| **6** | 模型 `<details>` 未展开仍提交全部节点（F2 附带） | 中（`renderToString` 已证实 markup 产出；浏览器是否影响 layout 未实测） | 否 | Chrome DevTools Layers / Rendering 面板观察 closed `<details>` 内容是否参与 layout |

**已排除**（有代码与实测双重否证）：

| 候选 | 排除依据 |
|---|---|
| 设置页自己的 `setInterval` / 轮询未清理 | 五个 bundle 全量检索 0 命中；活体 15 s 面板 0 变更 |
| 挂载时的大 JSON 解析 / 大字符串拼接 / 正则回溯 / localStorage 大读写 | `settings.describe` 为一次性 RPC；`attachPersistence`（`dsh-client-runtime/lib/client.js:5436`）仅在 `opts.persist` 存在时启用，设置页的 store（`:511`、`:1207`）均未传 `persist` |
| INFINITE render loop（uSES 快照不稳定） | `createSnapshotStore` 用 immer（`:5397-5427`），`getSnapshot()` 引用稳定；实测面板 0 次变更 |
| 上千行一起渲染成 DOM | 默认视图只有 **3 个 provider 行，编辑器全折叠 = 20 个元素**（截图 `shot-models-tab.png` 证实）；只有手动展开某个 provider 才会出现 50 行的模型表 |
| 全局 store 写入风暴由设置页发起 | 设置页打开只额外触发 1 次 API 调用（`measure3.json`） |

---

## 3. 未证实事项（诚实声明）

1. **F1 的"每帧重渲染"未被直接观测到。** 本次两次活体观测（`probe-open`、`ab-open-vs-closed`）都在安静态，
   面板子树 DOM 变更为 **0**。代码路径确定存在，但在**会话活跃**条件下的实际触发频率**未测量**。
   不采信 `DIAGNOSIS.md` §3 第 2 条"每次会话流事件都会连带它一起重渲染"作为已证事实——该报告未给出面板级的变更计数。
2. **closed `<details>` 是否参与 layout 未实测。** `renderToStaticMarkup` 只证明 React 产出了节点，
   不证明浏览器为它们做了 layout。`probe-hotspots` 的 `layout_ms = 1`（15 s）说明**当前默认视图下 layout 可忽略**。
3. **模型数只按 `settings.yaml` 的声明统计（adam 50 / opencode-go 16）。** 编辑器在
   `modelsOverridden === false` 时读的是 schema 默认值（`dsh-client-ui-settings-models/lib/client.js:1534`
   → `inheritedModels()` `:1522-1524`），可能与声明值不同；真实值需在页面里读 DOM 计数确认。
4. **本报告未覆盖宿主侧**（`dsh-usage` 插件的 SQLite 同步查询等），那属于 `audit-server.md` 范围。

---

## 4. 最小确证方案（若要最终定性 F1）

在**有活跃会话（流式输出进行中）**时，于页面 console 执行：

```js
// 1) 给设置面板子树挂变更计数
const panel = document.querySelector('[role="dialog"]');
window.__n = { panel: 0, frames: 0 };
new MutationObserver(rs => { for (const r of rs) window.__n.panel += r.addedNodes.length + r.removedNodes.length; })
  .observe(panel, { childList: true, subtree: true, attributes: true, characterData: true });
requestAnimationFrame(function f(){ window.__n.frames++; requestAnimationFrame(f); });

// 2) 10 秒后读
setTimeout(() => console.log(window.__n, 'mutations/frame =', (window.__n.panel / window.__n.frames).toFixed(3)), 10000);
```

判读：
- `mutations/frame ≈ 0` → F1 不成立，设置页纯粹是无辜受害者，修复应全部投向会话列表管线。
- `mutations/frame ≥ 1` 且面板停在**模型页并展开 adam** → F1+F2 成立，应给 `SettingsPanel`/`renderSlot` 加 memo 边界，
  并给 `ModelListEditor` 加虚拟化。

配套（确认乘数大小）：在面板内展开 adam 编辑器后，用 DevTools Performance 录 5 s，
看 `React 组件名` 之一（如 `ProviderEditor`/`ModelListEditor`）的 commit 次数是否与 rAF 帧数同阶。

---

## 5. 证据文件

| 文件 | 内容 |
|---|---|
| `ab-open-vs-closed.json` | 四窗口 A/B：设置关/开（通用）/开（模型）/关 —— **本次核心否证证据** |
| `probe-hotspots.json` | 设置打开时的 WS 帧率、区域化 DOM 变更热点、sidebar 节点占比 |
| `probe-open.json` | 设置面板子树变更计数（0）+ 面板快照（3 provider 行、120 节点、活动 tab） |
| `render-cost.json` / `render-cost.mjs` | 真实 bundle + React 18 的渲染成本与 DOM 规模（含 N 扫描） |
| `harness.mjs` / `loader.cjs` / `primitives-stub.cjs` | 浏览器模块加载器仿真（仅内存内注入导出，磁盘文件不动） |
| `shot-models-tab.png` | 模型页实际挂载态（3 个 provider 行，全部折叠） |
| `probe-open.mjs` / `probe-hotspots.mjs` / `ab-open-vs-closed.mjs` | 活体观测脚本（只点击设置入口与导航，观测后关闭对话框） |
