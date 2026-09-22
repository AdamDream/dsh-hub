# 设置页逐栏目静态成本画像（只读静态审计）

审计时间：本次会话（只读，未启动浏览器/未测量/未触碰 PID 301709）。
方法：直接读**客户端真实可读副本**的源码，逐条标注 `文件:行`。
凡非源码直证者标【推断】；无法确证者标 INCONCLUSIVE。**无编造 path:line。**

## 0. 源码可读副本对照（本次实际使用的路径）

| 短标签 | 真实路径 | 备注 |
|---|---|---|
| WP | `/home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-wallpaper/lib/client.js` | 610 行，与 `dsh/dsh-wallpaper-local/lib/client.js` 同源 |
| WE | `/home/CNS2026495165/.dsh/profiles/node_modules/dsh-workspace-enhancement/lib/client.js` | 5453 行（唯一可读副本，workspace 下 `repos/` 另有源码仓） |
| GG | `…/node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/client.js`（`.npm-global/…/dsh/node_modules/@deepseek-ai/…`，604 行） | 设置壳（导航 + 通用设置栏目） |
| GM | `…/dsh-client-ui-settings-models/lib/client.js` | 2811 行 |
| GP | `…/dsh-client-ui-settings-plugins/lib/client.js` | 1327 行 |
| GI | `…/dsh-client-ui-settings-plugin-inventory/lib/client.js` | 301 行 |
| GIH | `…/dsh-host-plugin-inventory/lib/index.js` | 118 行（宿主侧 `pluginInventory.list`） |
| AP | `…/dsh-client-ui-agent-preset/lib/client.js` | 1724 行 |
| APH | `…/dsh-agent-presets/lib/index.js` | 1178 行（宿主侧 `agentPresets.list`） |
| SSHG | `/home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-ssh-gui/lib/client.js` | 1014 行 |
| SAM | `/home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-subagent-model/lib/client.js` | 322 行 |
| VA | `/home/CNS2026495165/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/client.js` | 214 行 |
| USG | `/home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-usage/lib/client.js` | 配置卡片，**不是** 8 个栏目之一（见 §3.7） |
| SET | `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings/lib/client.js` | settings 域 + 共享 describe 镜像 + `settingsScope` |

**共同前提（1 条，影响所有栏目）**：【事实】设置弹窗只渲染**当前**栏目：
`GG:164` `renderSlot("settings.section", { close: onClose }, { only: active })`，
且 `settings.section` 是 `kind:"list", scope:"root"`（`GG:555-558`）。
`settings.plugins.tab` 同理只渲染 active tab（`GP:497`）。
→ **切换栏目 = 卸载旧栏目组件 + 挂载新栏目组件**，卸载/挂载副作用即为切换成本来源。

**共同前提（2 条）**：【事实】`settings.describe` 是**进程级单例镜像**，`bind()` 不复读线路：
`SET:1150-1199` `describe()` 返回共享 `this.mirror`；`SET:1170-1176` `bind()` 注释「binding adds no wire read of its own」；
`SET:1246-1251` `ensure()` 只在 `status === "idle"` 时才 `load()`。
→ 任何栏目「读 settingsScope 快照」都是**读本地 mirror，0 RPC**（除非镜像首次 idle）。

---

## 1. 逐栏目画像总表

| # | 栏目 (order) | mount_rpcs[]（挂载时真发） | dom_scale | svg_count | big_media | loops | observers | heavy_compute | scroll_risk |
|---|---|---|---|---|---|---|---|---|---|
| 0 | **general** (0) `settings-general` | 【事实】**0 RPC**。仅 mirror 读：`WP:580-585` `scope.getSnapshot()`/`scope.subscribe`；`WP:591-597` 行注册。`GG:502` 仅 `ctx.slots.entries()`（本地账本）。**唯一网络副作用**：`WP:583-585` 订阅 `ctx.sessions.list` 快照（本地），`WP:180-181` 首次 ready 时 `cleanupMedia()` → **`fetch POST /dsh-wallpaper/cleanup`**（HTTP 非 RPC，仅一次，`cleanupDone` 门控 `WP:576-581`） | 7 行卡片（language / agent-preset / composer-enter / permission / appearance / wallpaper + 1 未具名）；每行 20~60 节点；**合计 ~300-450 节点**，无虚拟化 | 【事实】`GG` 内 6 处图标；`AP:1571+/1702` agent-preset 行有 chevron；量级 **<15 个内联 SVG** | 【事实】是。`WP:453` `<img src={config.source}>`（72×44 预览）——**src 指向 2,334,260 字节原图**（`~/.dsh/settings.yaml:199-201` `source: /dsh-wallpaper/media/37758c1c-….png`；`ls ~/.dsh/wallpapers` = 2 334 260 B）。**无缩略图、无 createObjectURL、无 base64** | 【事实】无 `setInterval`/`requestAnimationFrame`（`WP` 全文 0 命中）。`setTimeout` 亦无 | 【事实】无 Observer（`WP` 0 命中）。有 **1 个 `settings.section` 订阅**（`SET:1214` 镜像订阅，属共享镜像，非本栏目） | 【事实】`WP:335-351` `applyCurrent→applyWallpaper` 每次调用重建/改样式；`WP:323-328` `sync` 做 `normalizePage/normalizePages`（PAGES 常量循环 + 对象浅拷贝，O(1)~O(4)）；`WP:499-509` 写路径 O(fields)。**无大数组排序/正则回溯/深拷贝** | 【事实】**最高风险之一**：`WP:222` / `WP:232` 两个 `position:fixed; inset:0; z-index:-1; pointer-events:none` **全屏层**（壁纸 + 暗色遮罩）在 `document.body` 首部（`WP:223` `body.prepend`）。`WP:255` `background-size:cover` 让 2.33MB 图参与整窗 raster；`WP:257` 若有 `blur` 则加 filter 层。【推断】`z-index:-1` 使其位于 UI 之下、自身不滚动，滚动时应复用；但**每次重建层都会重 raster** |
| 1 | **models** (10) `settings-models` | 【事实】**首次挂载 3 类 RPC**：`GM:1856` `if (state.status === "idle") controller.load();` → `GM:548` `api.llm.providers({})` + `GM:548` `describeFace.ensure()`（镜像，已 idle 才读）+ `GM:578` `api.credentials.describe({refs})`（refs = 各行 `apiKeyEnv` 去重集合）。**再次进入不再发**（store 活在 apply 作用域 `GM:2743`，`GM:2707-2711` `refreshIfLoaded` 仅 status≠idle 时重读） | 【事实】表格式行（每 provider 一行，`GM:564` `providers.map`）。本部署 provider 数量小（【推断】3~8 行）→ **~150-400 节点**，无虚拟化 | 【事实】12 处图标引用；量级 **<20 个 SVG** | 【事实】无大图/base64/canvas | 【事实】无定时器；**事件驱动刷新**：`GM:2761-2768` 订阅 `settings/document-updated` / `credentials/reference-updated` / `llm/adapters-updated` / `connection/reset`（切 tab 本身不触发） | 【事实】无 Observer | 【事实】`GM:581` `new Set(rows.flatMap(...))`（O(N)）；`GM:583` `new Map(views.map(...))`（O(namespaces)，**与插件数无关**，只 map 已返回的 describe） | 【事实】无 sticky/滚动监听。风险低 |
| 2 | **plugins > all** (`settings.plugin.item` 无；tab `all` order 10, 栏目 order 15) `settings-plugin-inventory` | 【事实】**每次挂载 1 次新 RPC**：`GI:73-75` `Promise.resolve().then(() => list())`（`useEffect` deps `[list, request]`）→ `GI:279-283` `ctx.remote.pluginInventory.list()`。宿主 `GIH:99-115` **每次调用都遍历 `loader.entries()`**、不过滤缓存 → 成本 O(插件条目数)，且**无缓存门**（源码注释明说「a second cache would only add another lifecycle truth」） | 【事实】`GI:150` `filteredEntries.map(...)` 渲染卡片；CSS `qSYn7G_cards{grid-template-columns:repeat(2,minmax(0,1fr))}` → **双列卡片、无虚拟化**。本部署插件条目 40+（`@local/*` 7 + `@deepseek-ai/*` 60+）【推断】**40-70 张卡片 → ~1000-2500 节点** | 【事实】3 处（`GI:117` IconSearchOutline16、`GI:188` IconChevronDownOutline14、每卡状态点 `qSYn7G_statusDot` 是 span 非 SVG）→ **~70-140 个 SVG** | 【事实】无 | 【事实】无定时器 | 【事实】无 | 【事实】`GI:84` `filteredEntries = useMemo(entries.filter(matches))`，`GI:57-59` `matches` 每项做 2×`toLocaleLowerCase().includes()`。**O(N) 每按键**，N≈50 → 可忽略；但**首挂载 O(N) 构建 + N 卡片 React 树**是主要成本 | 【事实】无 sticky/滚动监听；`qSYn7G_cardDetails` 为展开区，展开会插 DOM |
| 3 | **plugins > configurable** (tab order 0) `settings-plugins` | 【事实】**挂载卡片时继承 UsageCard 的 RPC 风暴**：`USG:910-920` `Promise.all([summary, timeseries(day), heatmap, byModel, byProject, byDay, timeseries(hour)])` = **7 个 RPC**，加 `USG:950` `sessions(limit:200)` 与 `USG:965` `status` → **9 个 RPC/挂载**。控制器侧【事实】`GP:1241` `new ConfigurablePluginsTabController(describe(), …)`；`GP:944` `describeFace.ensure()`（镜像，已 idle 才读）→ **控制器本身 0 RPC** | 【事实】3 张内置卡（`GP:1303-1317` shell / agent-loop / web-search）+【推断】`dsh-usage` 卡（`USG:1232` `key: "dsh-usage"`，是否 `served` 决定是否渲染，`GP:966-967`）。UsageCard 内部：hero 栅格 + trend 图 + 热力图 + 3 张表（`sessions limit:200`）。【推断】**总 ~800-2500 节点**（热力图本身 ~371 rect） | 【事实】UsageCard 自绘 SVG：热力图 `USG:289` `heatmapGrid`、面积/柱/线图 `USG:364-385`。【推断】**约 400-500 个 SVG 节点**（357 天 ≈ 53×7 rect + 月标签 + 折线 path） | 【事实】无大图/base64；**有 canvas？**无（全 SVG） | 【事实】`USG:986-995` `setInterval(loadAll, refreshSec*1000)`（默认 `refreshSec=60`，`USG:773`），**并带可见性门控**：`USG:980` `if (!pollVisible \|\| document.hidden) return;` 且 `USG:988` 回调内再查 `document.hidden`。清理：`USG:993` `clearInterval`。注释自陈「every cycle costs the host ~0.3-0.5s of blocked event loop」（`USG:978-979`） | 【事实】`USG:799` `new IntersectionObserver(…, {threshold:0})`，观察 **cardRef（单节点，非全文档）**，用于 poll 门控；用 ref 回调绑定，mount 一次 | 【事实】`USG:925` payload/`range` 计算、`USG:940-944` 会话排序与折叠、热力图分桶（O(365)）；`USG:414-460` tooltip 命中测试 **O(rects) 每次 mouse move**（~371 次比较/帧，仅在 hover 时） | 【事实】`du_tableWrap{max-height:260px;overflow:auto}` + `du_table th{position:sticky;top:0}`（`USG:16` 内联 CSS）→ 表格内滚动有 sticky 表头；`du_tip{position:fixed;z-index:1000}` 悬浮 tooltip 跟随指针。【推断】滚动高热力图时若仍触发 hover hit-test，会叠加每帧 O(371) 计算 |
| 4 | **agent-presets** (20) `agent-preset` | 【事实】**每次挂载真发 1 次 `agentPreset.list`**：`AP:1156-1158` `useEffect(() => { load(); }, [load])`（deps 含 `load`，来自 `AP:1671-1673` `sectionInjected`，**每次注册新对象 → 每次挂载必发**）。宿主侧**无缓存门**：`APH:800-802` 注释「Discovery is **unmemoized**: `list()` and `resolve()` re-read the roots on every call」；`APH:887-889` `async list() { return await discoverPresets(this.resolvedRoots); }` → `APH:232-260` `scanRoot`：每 root 1×`readdir` + 每子目录 `stat` + 读 composition + `readPresetMetadata` | 【事实】卡片网格：`rtSEdW_cards{grid-template-columns:repeat(auto-fill,minmax(268px,1fr))}`，`AP:1160` 起 `state.rows.map`。本部署只有 1 个用户 preset（`standard-glm`）+ 系统 root 若干。【推断】**5-20 张卡 → ~300-900 节点**，无虚拟化 | 【事实】9 处图标；每卡 chevron/badge → **~20-60 SVG** | 【事实】无 | 【事实】无定时器（`AP` 全文无 setInterval/rAF） | 【事实】**每个卡片描述 1 个 `ResizeObserver`**：`AP:1121-1130` `CardDescription` 的 `useLayoutEffect` 里 `measure()` + `new ResizeObserver(measure).observe(el)`，卸载 `disconnect()`。→ **N 个局部 observer（N = 卡片数），不是全文档** | 【事实】`AP:1121` `el.scrollHeight > el.clientHeight` **在 layout effect 中同步读几何 → 每卡 1 次强制 reflow**。【推断】挂载时 N 次强制布局是本节目的主要自伤成本（N 小则廉价） | 【事实】无 sticky/scroll 监听。风险低 |
| 5 | **dsh-workspace-enhancement** (40) | 【事实】挂载发 1 次 `machines.list`：`WE:4553-4570` `RemoteWorkspaceSettingsPage` 的 `refresh()` + `useEffect(…, [])` → `WE:4563` `rpc("machines.list")` | 【事实】机器行列表 `WE:4693` `machines.map(...)`，每行 5 个按钮（edit/delete/setCurrent/forgetKey）。本部署机器数极小（`SET:208-209` 仅 `dsh-ssh-gui` 配置段存在）→【推断】**~50-300 节点**，无虚拟化 | 【事实】1 处图标引用 | 【事实】无 | 【事实】**有全局 `setInterval`**：`WE:4456` `setInterval(..., STATUS_POLL_MS)`，`WE:4061` `STATUS_POLL_MS = 3e4`（30s），回调仅当 `marked.size > 0`（侧栏有远程行）才发 RPC，且 `disposed` 门控；清理 `WE:4470` `clearInterval` | 【事实】**全文档 MutationObserver**（重点线索 ②，已核实）：`WE:4450-4454` `const rootTarget = document.body ?? document.documentElement; observer.observe(rootTarget, { childList: true, subtree: true });` → **`document.body` + `subtree:true`，全文档**。回调 `WE:4445-4447` `records.some(r => !isOwnBadgeMutation(r.target))` → `scheduleScan()`。节流：`WE:4403-4412` `SCAN_DELAY_MS = 120`（`WE:4062`）、`SCAN_MIN_GAP_MS = 300`（`WE:4063`）→ 最少间隔 300ms。清理 `WE:4468` `observer.disconnect()` | 【事实】`scan()`（`WE:4348-4396`）每次执行：`document.querySelectorAll('[role="tree"]')` **全文档查询** + 每 tree `querySelectorAll('[role="treeitem"][aria-expanded]')` + 每 row `rowTitleOf` / `closest('[role="tree"]')` / `Array.from(section.children)`；`withdrawStale`（`WE:4322-4347`）每 marked row 再做 `closest` + `querySelectorAll`。复杂度 **O(侧栏 treeitem 数)**，**每次 DOM 变更后 ≤300ms 触发一次**，含 1 处 `records.some` 过滤（O(records)） | 【事实】无 scroll 监听、无 sticky。**但全局 MutationObserver 的代价是：设置页任何 DOM 变动（切 tab、列表重渲染、markdown 流式）都会喂进 records 数组并可能触发一次全文档 tree 扫描**——注释自陈收敛后「performs ZERO DOM writes and zero self-induced scans」（`WE:3971-3973`），即稳态不放大，但**非稳态（频繁重渲染）下每 300ms 一次全文档 querySelectorAll** |
| 6 | **`@local/dsh-ssh-gui`** (50) | 【事实】**挂载即 4 并发 RPC + N+1 状态 RPC**：`SSHG:550-553` `Promise.all([nodes.list, keyref.list, config.get, serial.ports])` = **4 个**；随后 `SSHG:567-578` `await Promise.all(nodesList.map(node => conn.status \|\| node.status))` = **N 个**（N = 节点数）。触发点 `SSHG:587` `useEffect(() => { void refresh(false); }, [])`。**无缓存门**——每次切回都重跑 | 【事实】节点行 + 每行 keyRef 徽章 + 表单 + serial/ssh 对话框（`sg_dialog{width:min(760px,100%);max-height:80vh;overflow:auto}`）。本部署节点数【推断】很小 → **~200-600 节点**，无虚拟化 | 【事实】1 行 CSS 大段（`SSHG:25-45`），图标引用未命中 svg →【推断】**<10 SVG** | 【事实】无大图/base64（文件传输走 `file.put/file.get` base64 仅在用户操作时） | 【事实】无定时器（`SSHG` 无 setInterval/rAF） | 【事实】无 Observer（`SSHG` 0 命中） | 【事实】`SSHG:560` `nodesState.nodes.map(asNode).filter(n => n !== null)`（O(N)）；`SSHG:566` 同上；**配置/端口数组拷贝**。无深拷贝/排序 | 【事实】`sg_output{max-height:320px;overflow:auto}` 与 `sg_dialog{max-height:80vh;overflow:auto}` 局部滚动容器；无 scroll 监听、无 sticky。风险低 |
| 7 | **`@deepseek-ai/dsh-vision-adam`** (60) | 【事实】**0 RPC**：`VA:91-115` 仅 `scope.getSnapshot()` / `scope.subscribe`（mirror 本地）；`VA:197` `ctx.settingsScope.bind({namespace:"vision-adam"})`（`SET:1170-1176` 明示 binding 不加线路读） | 【事实】单表单：字段由 `FIELDS` 常量决定（`VA:177` `id: "vva-"+field.key`），本部署 `SET:189-194` 有 5 个键 →【推断】**~60-120 节点**，最小栏目 | 【事实】无（0 命中） | 【事实】无 | 【事实】无 | 【事实】无。**仅 1 个 scope 订阅**（`VA:112-115`），卸载 `unsubscribe()` | 【事实】`draftFrom(snapshot)` 浅拷贝 + `saveOps` O(FIELDS) | 【事实】无滚动容器（内容短，无 max-height）；无监听。**本栏目静态上最便宜** |
| 8 | **`@local/dsh-subagent-model`** (70) | 【事实】**0 RPC**：`SAM:127-153` `scope.subscribe(apply)+apply()`；`SAM:156-183` `catalogScope.subscribe(apply)+apply()`（`SAM:305` `bind({namespace:"llm-pi-ai"})`，mirror 本地） | 【事实】单表单 + provider select。catalog 来自 `SAM:90-100` `catalogOf(snapshot)`：遍历 `llm-pi-ai.providers` 的 **全部 provider × 全部 model 展开成 `<option>`**（`SAM:95-99`）。本部署 provider【推断】少 → **~100-300 节点**（若 provider/model 多则可上千） | 【事实】无（0 命中） | 【事实】无 | 【事实】无 | 【事实】无。2 个 scope 订阅，均 `unsubscribe()` | 【事实】`SAM:90-100` 双循环 O(P×M) + `out.push`；`SAM:60-75` `saveOps` O(FIELDS) | 【事实】无滚动容器；无监听。静态便宜（**但 catalog 规模随 `llm-pi-ai` 配置增长**） |

> 说明：`plugins` 栏目本身（`GP:1283-1295` 注册 `settings.section` id `plugins` order 15）渲染**自身容器 + tab 导航**，无 RPC；成本全部落在它 dispatch 出的两个子标签（=表中第 2、3 行）。

---

## 2. 重点线索核实（逐条给结论）

### ① `@local/dsh-wallpaper`：行挂载当页面信号 → 全局壁纸重铺 + 2.33MB 预览图

- **【源码事实】有全屏固定层，共 2 个**：`WP:220-225` `createWallpaperElement()` 写入
  `"position:fixed;inset:0;z-index:-1;pointer-events:none;width:100%;height:100%;background-size:cover;background-position:center;background-repeat:no-repeat;"`，
  并 `document.body.prepend(element)`；暗色遮罩 `WP:231-233` 同样 `"position:fixed;inset:0;z-index:-1;pointer-events:none;…"`。
  → `position:fixed` ✅、`pointer-events:none` ✅、`z-index:-1`（**低于 UI 内容**，非常规正 z-index 遮罩）。
- **【源码事实】「行挂载当页面信号」成立**：`WP:399-403` `WallpaperRow` 的
  `React.useEffect(() => { notifySettingsOpen(true); return () => notifySettingsOpen(false); }, [])`；
  `notifySettingsOpen`（`WP:518-522`）改 `pageState.settingsOpen` 后立即 `applyCurrent(ctx)`；
  `WP:344-347` `currentPage()` 三态之一即「本行已挂载」。
  **注意方向**：切到**别的**栏目 → 行卸载 → `notifySettingsOpen(false)` → 页面回落 home/session 并 `applyCurrent` → 若 global 与 home/session 覆盖不同则层内容变；**若相同，`WP:251-255` 仍会复用现存元素、只重写 `backgroundImage`**（同值赋值）。
- **【源码事实】预览图 = 原图 URL，非缩略图**：`WP:453` `jsx("img", { src: config.source, style: styles.preview })`，
  `styles.preview`（`WP:362`）72×44；而 `config.source` 即 `/dsh-wallpaper/media/37758c1c-….png`（`SET:199-201`），
  文件实测 **2 334 260 B（2.33 MB）**。→ **每次行挂载都重新解码整张原图到 72×44 缩略位**。
- **【源码事实】无 `new Image()` / `createObjectURL` / base64 / canvas**（全文 grep 0 命中）→ 走浏览器原生 `<img>` 与 CSS `background-image` 缓存；**是否命中解码缓存取决于浏览器**，
  【推断】同 URL 重复挂载时解码结果**通常**被缓存，但**每次挂载都会新建/复用 fixed 层并重新布局+raster 整窗**，且 72×44 的 `<img>` 是独立解码需求。
- **【源码事实】滚动是否因该层重绘**：层为 `z-index:-1` + `pointer-events:none`，自身不滚动不参与 hit-test；【推断】滚动时若浏览器将其提升为独立合成层，代价可控；**但 `WP:255` 的 `cover` 大图 + `WP:257` 可选 `blur()` filter 会强制整层 raster**，任何尺寸/主题变化（`WP:587` `ctx.on("theme/change", () => applyCurrent(ctx))`）都会重建。
- **INCONCLUSIVE（需实测）**：该层是否被提升为独立合成层、2.33MB 图片的实际解码/光栅耗时、是否在切 tab 时观察到 paint/FPS 变化 —— 均需浏览器侧测量，**本次静态审计不做**。

### ② `dsh-workspace-enhancement`：全文档 MutationObserver + 是否注册 order 40

- **【源码事实】观察配置确切为**：`WE:4450-4454`
  ```
  const rootTarget = document.body ?? document.documentElement;
  observer.observe(rootTarget, { childList: true, subtree: true });
  ```
  → `document.body`、`subtree:true`、**仅 childList**（**无** `attributes`/`characterData`）。
- **【源码事实】回调成本**：`WE:4445-4447` `records.some(r => !isOwnBadgeMutation(r.target))` → 命中即 `scheduleScan()`（O(records)，短路）。`scheduleScan`（`WE:4403-4412`）**不是**每次都扫：`SCAN_DELAY_MS=120` / `SCAN_MIN_GAP_MS=300`（`WE:4062-4063`）→ 首次 120ms、后续最小间隔 300ms **去抖+限频**。
  `scan()`（`WE:4348-4396`）代价 = 全文档 `querySelectorAll('[role="tree"]')` + 每 tree `querySelectorAll('[role="treeitem"][aria-expanded]')` + 每 row `rowTitleOf`/`closest`/`Array.from(section.children)`，**O(侧栏 treeitem 数)**。
- **【源码事实】注册 `settings.section` 且 order = 40**：`WE:5376-5383` `id: "dsh-workspace-enhancement", order: 40, label: () => t("settings.label")` ✅ 与主代理核实一致。
  → **该观察器与设置页无关地常驻**（随 sidebar row-badges 特性生命周期，`WE:4448` 起 → 清理 `WE:4466-4480`）。
- **【推断】**：设置页内任何 DOM 变动（切栏目、卡片重渲染、UsageCard 每 60s 数据落地引起的重排）都会进入这个全文档观察器的 records，且**最多每 300ms 触发一次全文档 tree 扫描**；稳态（badge 收敛、无变动）时 0 次。**这是本次调查中唯一「全文档级」监听器**。

### ③ `settings-general` 的导航构建：每次渲染都调 `slots.entries` 吗？切换是否重建数组？

- **【源码事实】不是每次渲染都调；有版本+locale 双缓存**：`GG:494-510`
  `getSnapshot()` 内 `const version = ctx.slots.getVersion("settings.section"); const revision = ctx.locale.getSnapshot().revision;`
  **仅当 `version !== rowsVersion || revision !== rowsRevision`** 才重新
  `ctx.slots.entries("settings.section").map(...).sort((a,b)=>a.order-b.order)`，否则直接返回上一次的 `rows`。
- **【源码事实】切换栏目不会重建**：`active` 是 `SettingsRoot` 的 state（`GG:134` `row.id === active`），`onSelect` 只改 active；slot 账本 version 与 locale revision 都不变 → **`rows` 数组与 `rowsVersion` 保持，不重新 map/sort**。
  订阅侧 `GG:511-518` `ctx.slots.subscribe("settings.section", listener)` + `ctx.locale.subscribe(listener)`（仅这两者会 bump）。
- **结论**：导航列表**不是**切换成本来源。【事实】`navIcon(row.id)`（`GG:73-89`）按 id 分支返回图标，**每次渲染 8 个图标元素**（React 元素，非 SVG 重解析）。

### ④ `agent-presets` 栏目：`AgentPresetRow` 每次打开都发 RPC？宿主侧无缓存门？

- **【源码事实】`AgentPresetRow`（通用设置里的行，`AP:1702-1706` 注册 `settings.general.item` id `agent-preset` order -25）依赖共享 `controller`（`AP:1567` 在 apply 作用域创建，**跨挂载存活**）**，其 `load()` 由 `AP:1620-1627` 的 `settings/document-updated`(ns==='agent-presets') / connection-reset 触发，**并非每次行挂载都发**。
- **【源码事实】真正每次打开都发的是 `agent-presets` 栏目**：`AP:1156-1158` `useEffect(() => { load(); }, [load])`，`load` = `AP:1673` `sectionInjected()` 内新建的闭包 → **每次栏目挂载（=每次切到该 tab）都调 `section.load()`**（`AP:727` `AgentPresetSectionController`），最终 `AP:1441` `await this.api.agentPresets.list({})`。
- **【源码事实】宿主侧确实无缓存门**：`APH:800-802` 注释「Discovery is **unmemoized**: `list()` and `resolve()` re-read the roots on every call so a preset authored while the process runs is visible immediately」；`APH:887-889` `list()` 直接 `discoverPresets(this.resolvedRoots)`；`APH:232-260` `scanRoot` **每 root 1×`readdir`** + 每子目录 `stat(composition)` + `compositionProblem` + `readPresetMetadata`。→ **每次切到该 tab = 一轮真实文件系统扫描**。
- 【推断】`@local/dsh-subagent-model` 的设置无需 RPC 也让 host 有别的读法，未涉；本条仅针对 presets。

### ⑤ `plugins > configurable`：是否对**全部**插件命名空间做一次性遍历/describe？

- **【源码事实】否**。`GP:935-975` `ConfigurablePluginsTabController.publish()`：
  `const served = new Set(mirrored.view?.namespaces.map(v => v.ns) ?? []);`
  `const namespaces = this.entries().flatMap(e => e.options.key !== void 0 && served.has(e.options.key) ? [e.options.key] : []);`
  → 遍历的是**已注册卡片（`settings.plugin.item` 条目，本部署 4 个）**，`served` 只是 `Set` 查表 O(1)；**不对全部 namespace 做 per-namespace describe 或遍历**。
  唯一「随命名空间数增长」的一步是 `GP:966` 构建 `Set(namespaces.map(ns))`，O(已 served 命名空间数)，**在共享镜像刷新时执行，不在切 tab 时**。
- **【源码事实】镜像读取有门**：`GP:944` `describeFace.ensure()` → `SET:1246-1251` 只在 `status === "idle"` 才 `load()`。
  控制器**在 apply 时构造**（`GP:1241`），即**插件加载时就 ensure 过一次**；后续切 tab 走缓存。
- **结论**：`configurable` 的成本**不随插件数增长**；它的成本来自**被 dispatch 的卡片的挂载副作用**——本部署实测最关键的是 `USG` UsageCard 的 **9 个 RPC/挂载 + 热力图 SVG + 60s 轮询**（见 §1 第 3 行）。
  【事实】`dsh-usage` 卡注册在 `USG:1232`（`key: "dsh-usage"`），**它没有自己的 `settings.section`**，只能通过本 tab 挂载。
  另：`@local/dsh-pptmaster` / `dsh-btw` / `dsh-workspace-enhancement` 也注册 `settings.plugin.item`，**未在本次可读副本中确认其 key 是否 served** → 【推断】本部署 `configurable` tab 实际挂载的卡片数 ≥4（3 内置 + dsh-usage），**准确数量 INCONCLUSIVE**（需实测或读宿主 settings 注册表）。

---

## 3. 汇总：按静态证据应当最贵的栏目（排序 + 依据）

| 排名 | 栏目 | 静态依据（要点） |
|---|---|---|
| **1（最贵）** | **plugins > `configurable`** | 单次挂载 **9 个 RPC**（`USG:910-920` ×7 + `USG:950` + `USG:965`）+ **热力图/趋势 SVG ≈400-500 节点**（`USG:289,364-385`）+ **60s 轮询**（`USG:986`，自陈每轮宿主阻塞 0.3-0.5s）+ `limit:200` sessions（`USG:950`）+ sticky 表头/`position:fixed` tooltip/`max-height:260px` 滚动容器（`USG:16`） |
| **2** | **plugins > `all`** | 每次挂载**无缓存**地真发一次 `pluginInventory.list`（`GI:73-75` → `GIH:99-115`，宿主注释明示不缓存），**双列卡片 × 40-70 项、无虚拟化**（`GI:150` + CSS `qSYn7G_cards`）→ ~1000-2500 节点 + ~70-140 SVG |
| **3** | **agent-presets** (20) | 每次挂载真发 `agentPreset.list`（`AP:1156-1158`），宿主侧**未记忆化 → 每 root readdir + 每 preset stat/读文件**（`APH:800-802,887-889,232-260`）；且**每张卡片 1 个 ResizeObserver + 1 次 layout-effect 强制 reflow**（`AP:1121-1130`）。卡片数少 → 绝对量小于 1/2，但「每次切换必发 FS 扫描 + N 次强制布局」的性质最差 |
| 4 | **`@local/dsh-ssh-gui`** (50) | **4 + N 个 RPC/挂载**（`SSHG:550-553` + `SSHG:567-578`），无缓存；N 小则总量小 |
| 5 | **general** (0) | 0 RPC，但挂载/卸载会**重建或改写 `position:fixed` 全屏层**并让 2.33MB `cover` 背景参与 raster（`WP:222,232,251-257`）+ 72×44 `<img>` 指向原图（`WP:453` + `SET:199-201`） |
| 6 | **models** (10) | 首次 3 类 RPC、之后 **store 跨挂载存活 → 复访 0 RPC**（`GM:1856` + `GM:2707-2711`） |
| 7-8 | **vision-adam** (60) / **subagent-model** (70) | **0 RPC、0 observer、0 timer**，纯本地 mirror 表单；subagent-model 的 catalog 双循环随 `llm-pi-ai` provider×model 增长（`SAM:90-100`） |

**跨栏目放大器（非某一栏目独有）**：
- 【事实】`WE:4451-4454` **全文档 MutationObserver** 常驻，设置页内高频重渲染（尤其 UsageCard 轮询落地）会以 **≤300ms 间隔**喂入全文档 `querySelectorAll('[role="tree"]')` 扫描 —— 与「最贵栏目」叠加时互相放大。
- 【事实】`GG:164` + `GP:497` 只挂载 active 栏目/子标签 → **所有成本都是「切换即付」，没有 keep-alive 摊销**。

## 4. INCONCLUSIVE 清单（本次未证实，禁止当结论用）

1. **未实测**：本报告全部为静态推断，**未做任何浏览器测量、未连任何端口、未重启进程**；「最贵」为静态证据排序，**不等于实测耗时排序**。
2. **wallpaper**：全屏 fixed 层是否被提升为独立合成层、2.33MB 图在切 tab 时的实际解码/光栅耗时、`cover` 重铺是否引发整窗 repaint —— INCONCLUSIVE（需 DevTools/Paint flashing）。
3. **wallpaper 预览**：同 URL 的 `<img>` 解码结果是否被浏览器缓存复用 —— INCONCLUSIVE。
4. **`configurable` tab 实际卡片数**：`@local/dsh-pptmaster` / `dsh-btw` / `dsh-workspace-enhancement` 的 `settings.plugin.item` key 是否落在 served 集合 —— INCONCLUSIVE（本次只确认 3 内置 + `dsh-usage`）。
5. **`plugins` 子标签切换成本**：`GP:497` 只渲染 active tab → 切 `all`↔`configurable` 会卸载/重挂卡片；**是否真的重发 RPC 取决于各卡片的 store 存活域**（UsageCard 的 store/ref 是否在 apply 作用域）—— 本次未逐卡追踪，INCONCLUSIVE。
6. **`dsh-usage` 是否真的 served**：`USG:1232` 注册 key `dsh-usage`，但 `served` 由宿主 describe 决定；`SET:200-201` 只有 `wallpaper`/`dsh-ssh-gui`/`vision-adam`/`dsh-subagent`/`agent-presets`/`web-search-deepseek` 等段，**未见 `dsh-usage` 段** → 该卡片可能因 `served` 不含 `dsh-usage` 而不渲染。**这直接决定排名 1 是否成立 → 优先实测确认**。
7. **`GG:502` 的 `rows` 缓存**：`ROWS` 在 `report` 的静态推理上不随 `active` 变化（已读源码确认），但 `settings.section` 的 `getVersion` 是否被某些插件在切 tab 时 bump —— 未穷举所有 8 个注册方，INCONCLUSIVE。
8. **`WE` 扫描频率的实际影响**：稳态 0 次 vs 设置页内的实际触发次数（是否真的每 300ms 一次）—— INCONCLUSIVE（需实测 MutationObserver 计数）。
