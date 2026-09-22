# 设置页「栏目切换 / 滚动」卡顿 — 只读静态机制裁决（sub-mechanism）

审计线：incident2 / tab-switch / 静态机制（只读）
方法：**只读源码 + 字节一致性校验**，无浏览器、无网络端口、无进程操作、无产品文件修改。

## 0. 证据基线与可信度声明

| 项 | 值 |
|---|---|
| npm-global（正在服务的安装） | `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/<pkg>/lib/client.js` |
| 本地插件（npm-global 下无 `@local`） | `/home/CNS2026495165/.dsh/profiles/node_modules/{dsh-workspace-enhancement,@local/*,@deepseek-ai/dsh-vision-adam}/lib/client.js` |
| slot 核心（SlotCore / React outlet） | 源码不在磁盘：`@deepseek-ai/dsh-client-ui-slots` 是**打进 shell bundle 的 static module**（`dsh-web-frontend/dist/assets/index-ClqxG24t.js`，minified 单行），React 侧 outlet 在 `dsh-client-ui-renderer/lib/client.js`（可读） |

**字节一致性校验（本次实测）**：本线交付目录 `bundle/` 中父代理抓取的 served 副本与上述磁盘源码**逐字节相同**（`cmp` 全 IDENTICAL）：
`_local_dsh-wallpaper.js`=610 行、`dsh-workspace-enhancement.js`=5453 行、`_local_dsh-ssh-gui.js`=1014 行、
`_deepseek-ai_dsh-vision-adam.js`=214 行、`_local_dsh-subagent-model.js`=322 行、
`_deepseek-ai_dsh-client-ui-settings{,-general,-plugins,-plugin-inventory}.js`。
⇒ 下面所有行号对**当前在服务的代码**有效。

**行号引用约定**：可读源码给 `path:line`；minified shell bundle 只能给 `path:56`（该文件 97 行、单行 227 KB），
并附**字节偏移**以便复核。

**INCONCLUSIVE 声明（本报告未取到证据的点）**：
- SlotCore 的 TypeScript **原始源码**不在磁盘（只有 minified bundle），故「per-key 通知」结论基于 minified 代码阅读（可信，但无 type 级证据）。
- 各栏目**真实 DOM 节点数/提交次数**：静态源码只能给量级与结构，精确计数需活体（本线不做测量）。
- models 栏目 `llm.providers` 返回的 provider 行数：取决于宿主 provider 目录，本机 `settings.yaml` 无 `llm:` 段，无法从静态确定。

---

## 1. 导航列表与激活栏目的 React 结构 —— 【源码事实】

读取方 = `ui-settings-general` 的 `SettingsRoot`（唯一向 `settings.section` 取列表的插件）。

| 事实 | 证据 |
|---|---|
| 导航列表由 `rows`（settings.section ledger 快照）**直接 map 成 `<button>`**，不走 slot 渲染，key = `row.id` | `dsh-client-ui-settings-general/lib/client.js:130-144`（`key: row.id` 在 143） |
| 激活态只是 className / `aria-current` 变化，**导航节点不重建** | 同文件 `:132-138` |
| 激活栏目的内容 = **一条 `renderSlot("settings.section", {close}, {only: active})`**，用 `only` 过滤 list 到唯一一项 | 同文件 `:162-165` |
| `only` 的过滤发生在 outlet 内部：`if (opts?.only !== void 0) list = list.filter(i => i.id === opts.only)` | `dsh-client-ui-renderer/lib/client.js:845` |
| 列表项 key = `e${entryKeyOf(entry)}`（entry 身份键，**随注册条目变**） | 同文件 `:847`（`entryKeyOf` 在 `:500-507`） |
| `rows` 快照按 `slots.getVersion("settings.section")` + `locale.revision` **缓存**，仅版本变化时 `entries()+map+sort` | settings-general `:489-510` |
| `rows` 由 `useSections(sel)`（uSES 选择器 hook）读取 | settings-general `:188` + renderer `:154-160`、`:197-204` |

**裁决**：激活内容 = **同层替换（list outlet 内单元素换 key）**，不是「重建整个面板树」。
切换 `active` 时：`.VOzbGW_navList` 的按钮原地更新；`.VOzbGW_options` 里的 section outlet 锚点 div 保留，
其**唯一子节点**由 A 栏目换成 B 栏目（key 变化 ⇒ A unmount、B mount）。
⇒ 每次切栏目**必然**发生「A 栏目整棵子树的 unmount + B 栏目整棵子树的 mount」，这是设计使然；
但**外壳（nav/header/close/actions/文档 tab）不参与**（见 §2）。

---

## 2. 是否存在「整面板重挂载」 —— 【源码事实】不存在（外壳不重挂载）

| 判据 | 结论 | 证据 |
|---|---|---|
| `SettingsPanel` 定义位置 | **模块级函数**，非内嵌定义（不会被每次渲染新建类型） | settings-general `:96` |
| 是否有随 active 变化的 `key` | **没有**：`open && jsx(SettingsPanel, {rows, renderSlot, activeId, onSelect, onClose})`，无 key | settings-general `:213-219` |
| 组件树位置是否稳定 | 稳定：位于 `Fragment` 第 2 子位（第 3 子位是 onboarding 条件项） | settings-general `:202-227` |
| 传参身份是否稳定 | `renderSlot` 由 `renderSlotCache`(WeakMap per entry) 缓存 ⇒ 恒等；`onClose`=`useCallback([])`；`setActiveId`=useState setter | renderer `:280-298` + settings-general `:180-187` |
| `useEffect` cleanup 会不会销毁子资源 | Escape 监听仅依赖 `onClose`（稳定）⇒ 切栏目**不重订阅**；`closeButton.focus()` 依赖 `[]` ⇒ 只在挂载时跑一次 | settings-general `:99-111` |
| header/close/actions/文档 tab 是否在 active 子树内 | **不在**：`settings.header`/`settings.action`/`settings.close` 都是独立 outlet，位于 `.VOzbGW_header`（`:145-161`），与 `.VOzbGW_options`（`:162-165`）平级 | settings-general `:145-165` |

**关键副结论（源码事实）**：`SettingsDocumentAction`（「打开配置文件」按钮）在 `settings.action` 槽，其
`useEffect(() => { controller.load() }, [controller])`（`:326-328`）**只在面板挂载时跑一次**；
`SettingsDocumentStore.load()` 内的 `describeFace.subscribe` 用 `??=` 幂等、`ensure()` 幂等（`:377-387`）⇒
**切栏目不会重发 `settings.describe`、也不会重复订阅**。

**唯一的重挂载点**：`SettingsPanel` 整体只在 `open` 由 false→true 时挂载。**每次打开设置页都是全新挂载**
（`open &&`，`:213`）；关闭→再打开会重建全部栏目本地状态。这与「来回切换栏目」不同，需在活体测量里分开归因。

---

## 3. 「订阅即重渲染」—— 订阅回调里做了什么 —— 【源码事实】

| 订阅 | 回调内容 | 是否触发未 memo 的大范围 setState |
|---|---|---|
| `settings.section`（nav 列表） | `subscribe: (listener) => { offLedger = slots.subscribe("settings.section", listener); offLocale = locale.subscribe(listener) }`，`listener` 即 uSES 的 onStoreChange | **否**：不是 setState，是 uSES → 只重渲 `SettingsRoot`（及其子 `SettingsPanel`）；快照有版本缓存 ⇒ 无谓通知也只会重渲一次、`rows` 引用不变 | settings-general `:511-518` |
| `settings.plugins.tab`（插件页子标签） | 同上模式：ledger + locale 两路 | 同上 | settings-plugins `:1267-1274` |
| `settings.plugin.item`（插件卡片账本） | `slots.subscribe("settings.plugin.item", () => configurable.refresh())` | **否**：`refresh()`→`publish()` 有**相等性早退**（`loaded`/`namespaces` 全等则 return），仅变化时 `store.set` | settings-plugins `:1245-1247` + `:964-976` |
| 各 outlet 自身 | `useSyncExternalStore((fn)=>host.subscribe(slotKey,fn), ()=>host.getVersion(slotKey))` | **否**：uSES 精确到该 slotKey 的 version | renderer `:741-750` |

**未发现**「某订阅回调对全局 store 做未 memo 的 setState」这一形态（即：不存在「切一个标签 ⇒ 全树重渲」的显式通路）。
已排除的对照线：本线不重复 zustand `fireImmediately` 结论（父代理已否证）。

### 3.1 但发现一处**每渲染重订阅**的低效（源码事实 + 推断）
```js
// dsh-client-ui-renderer/lib/client.js:743
react.useSyncExternalStore((fn) => host.subscribe(slotKey, fn), () => host.getVersion(slotKey));
```
两个闭包**每次渲染都新建**（`:743`、根 outlet 同形 `:852`）。同文件对 locale 面**专门做了缓存**以避免
「每个 outlet 每帧一对 unsubscribe/resubscribe」（注释见 `:458-463`，实现 `:464-475`），但 slotKey 这处没有。
【推断】按 React `useSyncExternalStore` 的既有语义（`subscribe` 身份变化 ⇒ 重新订阅），
**每次重渲每个 outlet 都会产生一次「退订+订阅」**；设置外壳常驻 ~4-5 个 outlet（trigger/header/action/close/section，
见 settings-general `:129,151,159,164,211`），切一次栏目 ⇒ 约 5-10 次订阅抖动。
量级很小（Set add/delete），**不构成主因**，但属于真实存在的每渲染固定开销。

---

## 4. 订阅范围与 `getVersion`/`entries` 调用频率 —— 【源码事实】

| 问题 | 结论 | 证据 |
|---|---|---|
| 导航订阅的是整个 `settings.section` 列表还是单条目 | **整个列表**（一个 key 的全部 entries），但列表恒为 8 项（父代理已核） | settings-general `:502-507` |
| 任一 slot ledger 变化是否让所有栏目重渲 | **否**。`markDirty(name)` 只把该 record 标脏；`flush()` 只对**脏 record** 的 listeners 回调 | shell bundle `index-ClqxG24t.js:56`（`markDirty` @offset 196688、`flush()` @196927） |
| 全局变更通道 | `SlotCore.onMutate` → `ctx.emit("slots/changed", key)`（runtime `:36-38`）。**本部署无任何监听方**（全仓仅事件声明 `dsh-cordis-client-runner:1547-1549`）⇒ 实际为空转，不放大 | runtime `:36-38`；`grep slots/changed` |
| `slots.entries(...)` 频率 | 只在 `version`/`locale.revision` 变化时调用（结果缓存 + 复用同一数组引用） | settings-general `:497-509`、settings-plugins `:1253-1265` |
| `slots.getVersion(...)` 频率 | **每次渲染都会调**（uSES 的 getSnapshot 契约）：`SettingsRoot` 常驻（设置面板关闭时也在，只渲染 sidebar 触发按钮）⇒ 每次 ledger 变更/每次自身重渲一次 Map 查表；开销可忽略 | settings-general `:497`、`:522`、`:188` |

**裁决**：订阅粒度是 **per-slotKey**，不是「大列表 → 全栏目」。切换栏目本身不会引发跨栏目重渲风暴。

---

## 5. 切换栏目是否每次都重发 RPC —— 逐栏目表

约定：**「首挂载」= 该 store 首次 idle 时取数；「每次切回」= 栏目组件 unmount 后再次 mount 时必然重发**。

| 栏目（order） | 挂载时取数逻辑 | 方法名 | 首挂载 | 每次切回重发 | 证据 |
|---|---|---|---|---|---|
| `general`(0) 通用设置 — 权限行 | `useEffect(()=>{load()},[load])` → 控制器 `load()` 只做 `describeFace.subscribe`(幂等) + `describeFace.ensure()`(幂等) + `derive()` | **无 wire RPC**（首启时由 settings shell 统一 ensure） | 无 | **不重发**，但每次 mount 会把该行 store 置 `loading`→`ready`（2 次额外渲染 + 短暂 loading 文案） | permission-presets `:63-70`、`:260-269`、`:431`；settings shell `:1246-1251` |
| `general` — 代理预设行 | `useEffect(()=>{load()},[load])` → `AgentPresetSettingsController.load()` → `api.agentPresets.list({})`（**无条件**） | `agentPresets.list` | 发 | **每次都重发** | agent-preset `:290-295`、`:1578-1583`、`:1439-1449` |
| `general` — 外观行 | 由 `theme/change` + 注入时 `sync()` 驱动，无 RPC | — | 无 | 不重发 | theme `:1324-1344`（`sync` 有 `revision<=` 早退，`:113`） |
| `general` — 语言行 / Enter 行为行 | store 注入时同步，无 RPC | — | 无 | 不重发 | locale `:1243-1258`（注册 `:1251`）；conversation `:4208-4212`（注册 `:9911`） |
| `general` — 壁纸行 | **无 RPC**；但 mount/unmount 触发全局副作用（见 §6.1） | — | 无 | 不重发 RPC，但触发壁纸重铺 | wallpaper `:386-403`、`:591-602` |
| `models`(10) | 渲染体内 `if (state.status === "idle") controller.load()`；store 在 apply() 单例（跨 mount 存活） | `llm.providers` + `credentials.describe`(+`ensure` 幂等) | 发 | **不重发**（status 已 ready） | models `:1856`、`:538-548`、`:578`、`:2742` |
| `plugins`(15) | 无 mount RPC；列表/卡片由共享镜像 + 账本驱动 | — | 无 | 不重发 | settings-plugins `:414-502`、`:1241-1247` |
| `plugins` → 子标签「插件列表」 | `useEffect(()=>{…list()})` → `ctx.remote.pluginInventory.list()` | `pluginInventory.list`(remote) | 发 | **每次该子标签 mount 都重发**（离开插件栏目即卸载；同一栏目内 `visitedIds` 会保持挂载） | inventory `:65-71`、`:279-283`；settings-plugins `:419-427`、`:489-499` |
| `agent-presets`(20) | `useEffect(()=>{load()},[load])` → `load()`→`beginRosterRead`（仅拒「正在进行中」）→`agentPresets.list({})` | `agentPresets.list` | 发 | **每次都重发** | agent-preset `:1150-1158`、`:1670-1675`、`:755-756`、`:534-538` |
| `dsh-workspace-enhancement`(40) 远程工作区 | `useEffect(()=>{refresh()},[])` → `rpc("machines.list")` | `/dsw machines.list` | 发 | **每次都重发** | WE `:4570-4572`、`:4561-4565` |
| `@local/dsh-ssh-gui`(50) | `useEffect(()=>{void refresh(false)},[])` → `Promise.all` 4 个 RPC | `nodes.list`、`keyref.list`、`config.get`、`serial.ports` | 发（4 并发） | **每次都重发 4 个** | ssh-gui `:587`、`:546-554` |
| `@deepseek-ai/dsh-vision-adam`(60) | 无 useEffect；读已绑定的 settings scope 快照 | — | 无 | 不重发 | vision-adam `:202-207`、`:120-170` |
| `@local/dsh-subagent-model`(70) | 2 个 `useEffect` 只做 `scope.subscribe`/`catalogScope.subscribe` | — | 无 | 不重发 | subagent-model `:127-135`、`:156-160` |
| 外壳「打开配置文件」 | `SettingsDocumentAction.load()`：`ensure()` 幂等 | 仅首次/镜像 idle 时 `settings.describe` | 首启一次 | 不重发 | settings-general `:324-328`、`:377-387` |

**汇总（源码事实）**：**4 个栏目（general 的预设行、agent-presets、远程工作区、dsh-ssh-gui）每次切回都会重发 RPC**；
ssh-gui 每次切回发 **4 个并发 RPC**。总账：一轮「通用设置↔分布式控制」来回 ≈ `agentPresets.list` × 2 + `/dsw machines.list` + `nodes.list/keyref.list/config.get/serial.ports`。

**附加放大器（源码事实，跨栏目）**：models 的推送失效处理**不按命名空间过滤**——
`settings/document-updated` 一律 `refreshIfLoaded(controller)`（models `:2769-2775`）。⇒ 只要模型页被打开过一次，
**任何** settings 写入（含壁纸滑块的每一次 `scope.set`）都会触发 `llm.providers` + `credentials.describe` 重读（`refreshIfLoaded` 定义 `:2712-2715`）。

---

## 6. 每个栏目的静态成本面（源码结构推断量级）

### 6.1 全局常驻成本（与栏目无关，但在设置页交互时被放大）

| 机制 | 细节 | 触发条件 | 清理 | 证据 |
|---|---|---|---|---|
| **全文档 MutationObserver**（`dsh-workspace-enhancement`） | `observer.observe(document.body, {childList:true, subtree:true})`；回调里 `records.some(r => !isOwnBadgeMutation(r.target))` ⇒ `scheduleScan()`（debounce 120ms/最小间隔 300ms） | **插件 apply() 时安装 ⇒ 全程常驻**（`installSidebarRowBadges(ctx)` 在 `:5392`） | `ctx.effect(() => dispose)`（`:5445`），cleanup 在 `:4466-4480` | WE `:4445-4454`、`:4403-4412`、`:4061-4063`、`:5392` |
| 扫描本身 | `document.querySelectorAll('[role="tree"]')` + 逐 treeitem 遍历/取样（全文档查询） | 任一 DOM 变更（**包括打开/关闭设置、切栏目、壁纸元素增删**） | — | WE `:4372-4396` |
| document click 捕获监听 | `document.addEventListener("click", onClick, true)` | 常驻 | 同上 | WE `:4455`、`:4469` |
| 30s `setInterval` | 轮询已标记行的连接状态（`marked.size===0` 时早退） | 常驻 | `clearInterval` `:4470` | WE `:4456-4464` |
| 壁纸 fixed 图层 | `div{position:fixed;inset:0;z-index:-1;background-size:cover}` + 可选暗色 mask 层，`document.body.prepend` | 有壁纸时 | `teardownWallpaper` `:267-274` | wallpaper `:220-237` |
| 设置遮罩 backdrop-filter | `.VOzbGW_overlay{position:fixed;inset:0;z-index:1000}` + `.VOzbGW_mask{position:absolute;inset:0;backdrop-filter:var(--dsw-mask-blur)}`；`--dsw-mask-blur:blur(2px)` | 设置面板打开期间 | — | settings-general CSS（`:28`）+ theme `:130` |

【推断】壁纸（fixed、可选 CSS `filter: blur()`）+ 遮罩 `backdrop-filter` 形成「模糊链」：
面板内滚动时该区域背后内容不变，但两者都在同一合成层序上；2.33 MB 全屏位图 + 2px backdrop blur
在滚动重绘时比纯色背景贵。此项**需活体确认**（本线不做测量）。

### 6.2 各栏目的静态内容量级

| 栏目 | 结构量级（源码事实） | 大图 / 循环 / 观察器 |
|---|---|---|
| `general` 通用设置 | 6 个 feature 行（order −25/−20/0/10/20/30）+ 壁纸行 ~30-40 节点；SVG 数个 | ⚠ **壁纸行渲染 `<img src={config.source} style="width:72px;height:44px">`**（`:453`、`:467`）：把**全尺寸原图 URL** 塞进 72×44 缩略图。本机 `settings.yaml:199-204` 指向 `/dsh-wallpaper/media/37758c1c-….png`，磁盘实测 **2,334,260 B（≈2.33 MB）**（`~/.dsh/wallpapers/`）。**无** setInterval/rAF/Observer |
| `models` | provider 行（数量取决于宿主 provider 目录，静态 INCONCLUSIVE）+ 展开后的编辑器卡片（字段多） | 无 |
| `plugins` | 子标签栏 + configurable 卡片（bash/agent-loop/web-search 3 张表单卡） | 无 |
| `plugins` → 「插件列表」 | 每插件 1 个 `<li>`（~8-10 元素 + **2 个内联 SVG**：状态点/chevron），列表长度 = 宿主插件清单（本机 boot manifest `entries` = **50**）；展开项再加 `<code>`/`<dl>` | 无 |
| `agent-presets` | 预设行列表（本行数静态 INCONCLUSIVE：`~/.dsh/presets/` 不存在/为空） | 无 |
| `dsh-workspace-enhancement` | 机器行列表 + 共享表单；行数 = 机器注册表（小） | ⚠ 见 §6.1 的常驻观察器（栏目自身无观察器） |
| `@local/dsh-ssh-gui` | 节点/绑定/端口列表（含每节点状态子请求 `:176`/`:338`） | 无 |
| `vision-adam` | `FIELDS` 个输入框 + 提示（~7 字段，~30 节点） | 无 |
| `subagent-model` | provider/model 目录树（规模取决于 catalog） | 无 |

### 6.3 壁纸行的「行挂载＝页面信号」机制（父线索的机制复核）—— 【源码事实】

```js
// wallpaper :400-403   行挂载/卸载即页面信号
React.useEffect(() => { notifySettingsOpen(true); return () => notifySettingsOpen(false); }, []);
// wallpaper :518-522   信号 → 重新铺壁纸
notifySettingsOpen: (open) => { if (pageState.settingsOpen===open) return; pageState.settingsOpen=open; applyCurrent(ctx); }
// wallpaper :348-350 / :238-266   applyCurrent → 按 currentPage() 重解析 override 并整体重写背景
```
- 该行注册在 **`settings.general.item`（order 30）**（`:591-602`）⇒ **只随「通用设置」栏目的挂载/卸载而生灭**。
- 因此 **每次在「通用设置」与任何其他栏目间切换**都会：`settingsOpen` true↔false → `currentPage()` 在
  `"settings"` 与 `"session"/"home"` 间翻转 → `applyWallpaper(...)` 整体重跑（写 `backgroundImage`/`filter`/暗色层 + `shadeTokens`）。
- **本机配置下的实际代价（源码事实 × 配置事实）**：`settings.yaml` 只有 `wallpaper.global`，**无任何分页 override**
  ⇒ 每页都解析到**同一份** config ⇒ 写入的 `backgroundImage` 字符串完全相同、
  `shadeTokens` 因 `sameShadedTokens` 早退（`:190-211`）**不会**触发 `theme.overrideTokens` ⇒ **不产生 theme/change 风暴**。
  ⇒ 每次切栏目的壁纸代价 ≈ 1 次 `document.body.contains` + 1 次同值 style 赋值 + **壁纸行 `<img>` 的重建**（72×44 缩略图指向 2.33 MB 原图）。
- **【推断】高风险场景**（本机未配置，但代码路径明确）：一旦给「设置页/会话页/首页」建了**分页 override 且与 global 不同图**，
  切栏目就会在两张全屏图之间来回切换（解码/绘制）+ `shadeTokens` 命中不同 tokens ⇒ `theme.overrideTokens` → `publish()`
  → `ctx.emit("theme/change")`（theme `:1224-1236`、`:1264-1268`）⇒ 全文档主题写入路径被唤醒
  （presenter 有内容签名早退，`ui-layout :408-427`，故仅内容真变时才付代价）。
- **附带发现（源码事实，潜在缺陷）**：`shadeTokens` 用 `shadedTokens` 做「同值早退」，但 **`applyWallpaper` 在无壁纸分支
  只 `overrideDispose?.()` 而**不重置 `shadedTokens`**（`:239-248` 对比 `:190-211`）⇒ 先「有壁纸」→「无壁纸」→「同一 opacity 的壁纸」时，
  早退会**阻止 base token 覆盖被恢复**（壁纸的半透明底衬丢失）。属可疑行为，**建议单独复核**（本线只做静态阅读，未活体验证）。

### 6.4 壁纸滑块的写入风暴（源码事实，属「通用设置」内交互）
`Slider` 同时绑 `onInput` 与 `onChange`（`:381`）→ 每次拖动事件都 `setValue` → `commitField` → `scope.set(...)`
（`:481-483`、`:495-511`）→ `settings.mutate`（settings `:1035-1045`）。**无 debounce**；
写入经 `enqueue` **串行排队**（settings `:1078-1079`）⇒ 一次拖动可积压数十个串行 `mutate`，
且每次都 `applyCurrent(ctx)`（`shadeTokens` → 可能 `overrideTokens`）+ 每次提交可能广播
`settings/document-updated`（进而触发 §5 的 models `refreshIfLoaded`）。

---

## 7. 滚动相关 —— 容器 / 监听 / 遮罩 / 每帧重算

| 问题 | 结论 | 证据 |
|---|---|---|
| 滚动容器是哪个 DOM | **`.VOzbGW_options`**：`{flex:1;min-height:0;padding:0 24px 24px;overflow-y:auto}`；位于 `.VOzbGW_content`(flex column) → `.VOzbGW_panel`(固定高 `min(800px,100vh−48px)`、`overflow:hidden`) → `.VOzbGW_overlay`(`position:fixed;inset:0;z-index:1000`) 内 | settings-general `:28` CSS（`VOzbGW_options` @offset 2662、`panel` @818、`overlay` 片段）；JSX 结构 `:112-168`（`:162-165` 即 options 容器） |
| 是否包一层 `display:contents` 锚点 | **是**：每个 slot outlet 的锚点 `div[data-slot]{display:contents}` ⇒ 栏目 DOM 直接成为 options 的 flex 子项 | renderer `:740-750` |
| 是否有 `scroll` 监听器 | 设置面板链路**没有**（外壳、各栏目、本地插件均无）。全仓共 3 处：`dsh-client-ui-subagent:531`（`document` capture，但 `if (!open) return` 守卫，`:522-523`，仅该菜单打开时存在）、`dsh-client-ui-trajectory:1252`、`dsh-client-ui-conversation:5776`（后两处在会话/轨迹区）。⇒ **滚动设置面板不会命中任何 scroll 监听器** | 左列 `path:line` |
| `position:fixed/sticky` 遮罩层 | **fixed**：`.VOzbGW_overlay`(inset:0)、`.VOzbGW_mask`(absolute inset:0 + `backdrop-filter:blur(2px)`)、壁纸 `div`(fixed inset:0, z-index:-1)（wallpaper `:222`）。设置面板内**无 sticky**（sticky 仅出现在会话区 CSS） | settings-general `:28`；wallpaper `:222`/`:232` |
| 每帧重算高度的 ResizeObserver | 设置面板链路**无** ResizeObserver。全仓 ResizeObserver 均在会话/附件/轨迹/交付物区（`ui-attachment:109-110`、`ui-conversation:3010/5794/7173`、`ui-trajectory:1212/1324`、`ui-deliverables:240`、`ui-agent-preset:1124`——最后一项属**代理预设栏目内**，用于测量菜单/编辑器尺寸，**不是滚动容器的每帧重算**） | 见左列 `path:line` |

**滚动裁决**：滚动本身**没有** JS 逐帧监听者；切栏目也没有滚动监听重装。可归因的滚动期成本是**渲染/合成侧**：
(a) 遮罩 `backdrop-filter` + 壁纸 fixed 全屏图层（§6.1）【推断】；
(b) 目标栏目 mount 时的同步渲染成本（§5 的 RPC 只是异步尾巴，**不阻塞**首帧，但会带来后续重渲）；
(c) 插件列表等长列表的 mount 一次性 DOM 构建。

---

## 8. 结论摘要（供裁决）

1. **不存在「整面板重挂载」通路**：外壳无 active key、组件在模块级、effect 依赖稳定（§2）。切栏目 = 仅内容区 A→B 的换 key。
2. **不存在「切标签 ⇒ 全树重渲」的显式订阅通路**：ledger 通知 per-slotKey（§4），三处订阅均为 uSES/带早退（§3）。
3. **切栏目的确定成本 = 3 项**：
   (a) 内容子树 unmount+mount（设计使然）；
   (b) **4 个栏目每次切回重发 RPC**（general 预设行 / agent-presets / 远程工作区 / dsh-ssh-gui 4 个并发）（§5）；
   (c) 壁纸行 mount 信号触发的 `applyCurrent` 重铺（本机配置下代价小；有分页 override 时显著）（§6.3）。
4. **常驻全局放大器**：workspace-enhancement 的 body MutationObserver + 全文档 `[role=tree]` 扫描 + click 捕获 + 30s interval，
   **在插件 boot 时安装，设置页所有 DOM 变动都会触发扫描**（§6.1）。这是本线认为最值得优先复核的「非栏目自身」成本。
5. **滚动路径无 JS 监听者**（§7）；可疑成本在合成侧（backdrop-filter + 全屏壁纸）与栏目 mount 的同步渲染规模。
6. **额外可信线索**：壁纸滑块的「每事件一次串行 mutate」写入风暴（§6.4），以及 models 页面「任何 settings 提交都重读 provider/credential」的跨栏目放大器（§5）。
