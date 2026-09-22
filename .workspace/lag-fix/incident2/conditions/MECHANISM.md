# MECHANISM.md — 设置页打开的「条件→卡顿」机制预测与可伪证清单

线：`incident2 / conditions`（本文件只写 MECHANISM.md；未改任何产品文件；未启动浏览器；未 kill 任何进程）
方法：只读源码/部署产物 + 只读读 `matrix.mjs` 的 cell 定义（只读，未改）。所有绝对 ms 一律按
`research-v2/MEASUREMENT-STATUS.md` §3.-1.0 的纪律标为不可用；本文件只给**方向 / 比值 / 结构**。
前置已接受（未重新论证）：`ThemePresenter.apply` 已被内容签名跳过修好（`apply` 调用 70/31→0），
残余 65–100 ms/s 未归属，`RecalcStyle/Task` 0.235→0.039 ⇒ **残余不是 Recalc**。

---

## 0. 三个结构性事实（后面所有预测都建立在它们上）

**F1 — 点击设置不加载任何 chunk、不注入任何 CSS。**
`runPluginBoot` 在**页面启动时**就把 manifest 里**每一个** plugin 都 `loader.create()`（= import→materialize），
只对 `immediately` 标记的行做提前 `prefetch`；非 immediate 行只是一个 `Promise.all` 里的并行加载，**不是按需**：
- 启动序列：`dsh-web-frontend/dist/assets/index-ClqxG24t.js` char 397139 `prefetchImmediateTier(){...manifest.plugins.filter(i=>i.immediately).map(i=>this.modules.prefetch(i.id)...)}` → char 397562 / 397778 `async runPluginBoot(...)`：`const u=this.manifest.plugins.map(c=>c.id); await i; await Promise.all(u.map(async c=>{ ... await l.create({name:c}) }))`。
- module body 在 **materialization** 时执行（`dsh-client-modules/lib/client.js:17-19` 注释），而各 plugin 的
  `<style>` 注入就在 module body 顶层：`dsh-client-ui-settings-general/lib/client.js:30-36`
  （`document.querySelector("style[data-plugin-css=...]")===null` → `appendChild`）。
- 设置类包**没有** `immediately`：`dsh-client-ui-settings-general` / `-models` / `-plugins` / `@local/dsh-usage`
  的 `package.json` `dsh.client` 只有 `inject`+`platform`；只有 `@local/dsh-wallpaper` 是 `immediately: true`。
- 全仓 client.js 里唯一的 `import()` 是语法高亮 `./langs/*.js`，设置路径上没有任何动态 import。
⇒ **条件 2 的「首开会编译/加载 chunk」这一假设在源码上不成立。**

**F2 — 点击设置新增的、唯一与视口面积成正比的层，是一个全屏 `backdrop-filter`。**
`SettingsPanel` 只在 `open` 时挂载（`settings-general/lib/client.js:213` `open && jsx(SettingsPanel, ...)`），
它渲染：
```
.VOzbGW_overlay{z-index:1000;...;position:fixed;inset:0}
.VOzbGW_mask{background:var(--dsw-alias-bg-mask-1);backdrop-filter:var(--dsw-mask-blur);position:absolute;inset:0}
.VOzbGW_panel{...width:800px;max-width:calc(100vw - 48px);height:min(800px,100vh - 48px);box-shadow:var(--dsw-shadow-lv3);...}
```
（`settings-general/lib/client.js:28`，`SettingsPanel` 组件 `:96`，overlay/mask 渲染 `:113-118`）
`--dsw-mask-blur` 的真实值是 **`blur(2px)`**：`dsh-client-ui-theme/lib/client.js:130`
（`body{...;--dsw-mask-blur:blur(2px)}`）。**没有任何 `@media` 中断它**，shell CSS 里也没有 width 断点
（`index-C6eRlFa6.css` 只有 2 条 `@media(prefers-reduced-motion:reduce)`）。
⇒ 点击 = 多出一个 **100vw×100vh 的 backdrop blur**，其栅格成本 ∝ 视口面积；面板本体固定 800px，**与宽度无关**。
另注：面板**没有**入场动画/transition（该 CSS 里 overlay/panel 均无 `animation`/`transition`），
所以点击成本是「一次 commit + 一次全屏 backdrop 栅格化」，不是持续逐帧动画；也不存在 MutationObserver /
ResizeObserver / IntersectionObserver 挂在设置面板上（`settings-general/lib/client.js` 全文只有 `:99-107`
的 `keydown` 与 `:109-111` 的 `focus()`）。

**F3 — 面板每次重开都是从零重新挂载。**
关闭只是 `open=false`（`:180-183` `close()`），`SettingsPanel` 整个卸载；重开是全新 mount，effect 全部重跑。
⇒ 「复开更快」不可能来自缓存，只能来自 V8 惰性编译 / 宿主/FS 缓存变热。

补充已核实的环境事实：`~/.dsh/settings.yaml:199-204` 确有壁纸
（`source: /dsh-wallpaper/media/37758c1c-....png`，`darkMask: 0`，`opacity: 0.88`，`blur: 0`；图为 1810×1279，
解码 RGBA ≈ 9.3 MB），`:218-219` `ui-theme: preference: light`。
`darkMask: 0` ⇒ @local/dsh-wallpaper 自己的 `_mask_` 元素**当前不存在**（见 §a2-D6）。

---

## (a) 预测表

判定列取值：**JANKY / MILD / NOT-JANKY / NO-EFFECT**。行内「vs」左侧为预测更差的一侧。
所有 `file:line` 均为部署产物真实行号（bundle 为打包后行号，避免整文件读取，均以 grep 定位）。

| # | condition（cell） | 预测判定 | 预测主导成本 | 机制 | 证据 file:line | 置信 |
|---|---|---|---|---|---|---|
| 1A | 入口=HOME（BASE） | **MILD** | 一次全屏 backdrop 栅格 + 面板 mount commit | 点击只挂载 SettingsPanel（F2）；同步开销 = 祖先链 `RootEntry→SlotErrorBoundary→SettingsRoot` 全渲染 + 面板子树（量级见 MEASUREMENT-STATUS「子树 26.5–62 fiber/commit」）+ 新增 100vw×100vh `backdrop-filter:blur(2px)` 首帧栅格。设置打开路径**对会话数 O(1)**（`SettingsRoot` 只读 `state.byId[state.current]`）。 | `settings-general/lib/client.js:213,113-118,28`；`ui-theme/lib/client.js:130`；`settings-general/lib/client.js:188-191` | 中高 |
| 1B | 入口=先打开长会话（D1-longsession） | **JANKY**（三个入口中最差） | 大 DOM 之上的全屏 backdrop 栅格/合成（非 JS） | 打开设置**不会卸载**会话子树，全屏 blur 的 backdrop 就是「长会话 DOM + 壁纸」；既有实测证明成本/DOM 单调放大（`apply` cost/script 比 首页 0.98× → 长会话 3.5–3.9×，MEASUREMENT-STATUS §3.-1.2）。会话页自身无持续 rAF 循环（conversation 的 rAF 都是合并/一次性：`dsh-client-ui-conversation/lib/client.js:3671,9319-9333`），只有**活动回合**才有 1s tick（`:5600`）与重试 250ms tick（`:5181`）⇒ 若长会话处于 idle，1B 与 1A 的差应主要落在 backdrop 栅格面积上。 | `dsh-client-ui-conversation/lib/client.js:5600,5181,9319-9333`；MEASUREMENT-STATUS §3.-1.2 | 中 |
| 1C | 入口=先打开承载用量卡的插件页（D1-pluginusage） | **NOT-JANKY**（若点击距该页稳定 >1s）；**仅在并发瞬间 JANKY** | 宿主事件循环争用（RPC），不是客户端渲染 | 用量卡挂载即发 **8+2 个 RPC**（`loadAll` 的 7 个 + `loadStatus` + `loadSessions`），其中 `byDay` 实测 p50 189ms、`session.list` p50 250ms，宿主单线程同步查询 ⇒ 与设置打开的 RPC 互抢；另有 60s 轮询（每条注释自陈「每轮让宿主阻塞 ~0.3–0.5s」）。**⚠ 该 lever 可能根本没生效，见 §a2-L1**。 | `@local/dsh-usage/lib/client.js:910-921,943-955,960-975,976-992`（**`:981`** 宿主阻塞注释）；MEASUREMENT-STATUS §6（M7 表） | 中（受 L1 影响） |
| 2 | 首次开 vs 同页第 2/3 次复开（D2-reopen） | **NO-EFFECT**（若必须选方向：首开略差，差距 < 噪声） | 仅 V8 惰性编译 + 宿主/FS 冷缓存 | F1（无 chunk、无 CSS 注入）+ F3（每次全新 mount）⇒ 首开与复开的**结构性成本相同**；首开独有的只有「首次执行设置子树函数体的 JIT 编译」与「宿主侧 agentPreset 名册冷读」（`:290-295`→`api.agentPresets.list`），且 `beginRosterRead` **无缓存闸门**、复开照样重读（`:556-571`）。 | `settings-general/lib/client.js:213`；`client.js:195-214`（模块装载器）；`agent-preset/lib/client.js:1699-1704,290-295,535,556-571` | 低（**硬币**） |
| 3 | 载入后立即（D3-immediate, cache off） | **JANKY**（全矩阵最强预测） | 启动期主线程忙：51 个 bundle / 8.05 MB JS 的下载+parse+compile+materialize，叠加首帧渲染与首个 `session.list` | 所有 client bundle 走 HTTP 且响应头为 **`cache-control: no-cache`**，`cacheDisabled` 下全部重新传输；`waitReady` 只等到「DOM 节点数达标 + 出现设置按钮」就点，此时 `Promise.all` 里的 `l.create` 队列与首个 `session.list`（实测 p50 250.5ms、500KB 载荷）仍在飞。点击的 commit 排在这些工作后面。 | `dsh-client-modules/lib/index.js:459-490`（`:483` `cache-control: no-cache`）；`index-ClqxG24t.js` char 397139/397562（boot 并行 create）；MEASUREMENT-STATUS §6（`session.list` 12/12 >100ms） | **高** |
| 3 | 载入后 10s（D3-wait10） | **MILD / NOT-JANKY** | 同 1A | 启动队列与首个 `session.list` 早已落定；此时与 BASE 同构。 | 同上 | 高 |
| 3 | 载入后 60s（D3-wait60） | **NOT-JANKY，且应与 wait10 无显著差** | 同 1A | **客户端无 60s 定时器**（唯一的 60s 轮询在用量卡内，且被 IntersectionObserver+`document.hidden` 门控）；**宿主 ingest 定时器是关的**（`INGEST_TIMER_ENABLED = false`），启动时的 `await runIngest()` 是一次性且走 worker。 | `@local/dsh-usage/lib/index.js:67,46,314,318,213-216`；`lib/client.js:983,986-992`；`ingest-runner.js:139`（`new Worker`） | 高 |
| 4 | 1920×1080 vs 1440×900（D4-1920） | **MILD，随面积单调（1920 略差）** | 全屏 backdrop 栅格面积 | F2：面积 1920×1080=2.07MP vs 1440×900=1.30MP ⇒ **1.60×**；壁纸层同时按 `background-size:cover` 重新栅格（源图 1810×1279）。面板固定 800px，不随宽度变。 | `settings-general/lib/client.js:28`；`~/.dsh/settings.yaml:199-204` | 中 |
| 4 | 收窄窗口（D4-narrow, **900×800**） | **MILD / 方向不定** | 面积下降（0.72MP，约 BASE 的 0.55×）**但**跨过了侧栏折叠断点 | 900 < `SIDEBAR_AUTO_COLLAPSE = 1024` ⇒ 侧栏自动折叠为 rail，经 `ResizeObserver`+rAF 路径改版式，属于**额外的一次版式变化**，与「面积变小」方向相反地叠加。⇒ 该 cell 是**混合因子**，不能单独读成面积效应。 | `dsh-client-ui-layout/lib/client.js:13,177-187`（`getBoundingClientRect` 在 `:181`） | 中低 |
| 5 | 会话规模 99 vs 少（D5-smallws） | **NO-EFFECT**（我最敢押的一条） | —（点击路径对会话数 O(1)） | 侧栏默认**每组只渲染 5 行**（未展开），`COLLAPSED_SESSION_LIMIT = 5` + `group.sessions.slice(0, COLLAPSED_SESSION_LIMIT).map(...)`；设置打开路径只读 `state.byId[state.current]`；所有 O(N) 路径（`buildListSnapshot`、`projectList`、宿主 `session.list` 冷折叠）**都不在点击路径上**。 | `dsh-client-ui-workspace/lib/client.js:1039,1404`；`settings-general/lib/client.js:190`；`dsh-client-runtime/lib/client.js:8553,9272`；`dsh-host-apiproxy/lib/index.js:2224-2300` | **高**（前提：分组默认折叠，见 §a2-L2） |
| 6 | 壁纸在 vs 移除页内遮罩层（D6-nomask） | **NO-EFFECT → MILD**（取决于移除的是哪一层，见 §a2-L4） | 少一个全屏 backdrop-filter 合成层 | 若移除的确是一个**已存在的全屏半透明+backdrop-filter 层**，则少一次全屏 blur 合成；**但设置自己那层 `.VOzbGW_mask` 是点击时才创建的**，删不到它 ⇒ 对「点击新增成本」影响有限。壁纸**图**本身因带 `background-image` 被该 lever 明确排除，所以**不构成「有壁纸/无壁纸」的对照**。 | `matrix.mjs` `removeWallpaperMask`（char 20153，`if (score > 0 && !hasBgi) cands.push(...)`）；`settings-general/lib/client.js:28`；`index-C6eRlFa6.css` char 11403/11489 | 中低 |
| 7 | 浅色 vs 深色（D7-dark） | **NO-EFFECT**（且该 cell 很可能是**空 lever**，见 §a2-L3） | —（几何/模糊半径完全同） | `--dsw-mask-blur` 与 mask 几何在两种主题下完全相同，只有 `--dsw-alias-bg-mask-1` 的值变（浅 `#0000003d` / 深 `#00000080`）。唯一的**结构**差异是 body 的 `data-ds-dark-theme` 属性与根 `color-scheme`（影响原生滚动条/表单控件，设置面板确有多处 `overflow-y:auto` 与 range/select）。 | `ui-theme/lib/client.js:130,124`（alias-bg-mask-1 两套值）；`dsh-client-ui-layout/lib/client.js:428-430`；`settings-general/lib/client.js:28` | 中高 |

### 最敢押 / 硬币

- **最敢押（第一名）**：**条件 3 的三档顺序 = immediate ≫ wait10 ≈ wait60**，且 immediate 那一格的
  可观测签名是**一次与点击重叠的长任务（>100–300ms）**，而不是「script ms/s 变高」。
  依据是 F1 的量化：**51 个 web client bundle / 8,048,011 字节**，其中只预先 prefetch 了 **11 个 / 1,253,631 字节**，
  其余 40 个（6.8 MB，含 `@local/dsh-pptmaster` 单文件 4.1 MB）全在启动 `Promise.all` 里；
  且响应头 `cache-control: no-cache`。
- **最敢押（并列）**：**条件 5 = NO-EFFECT**。理由是侧栏默认只渲染每组 5 行，且点击路径 O(1)。
  这条如果被证伪，唯一可信的解释是**该 cell 的分组被展开了**（见 L2）。
- **硬币（我不押方向）**：**条件 2（首开 vs 复开）**。F1+F3 说明没有「首开一次性初始化」可利用，
  但 V8 惰性编译与宿主冷缓存确实是首开独有；两者大小我无法在没有浏览器的情况下排序。

---

## (a2) 对已实现 cell 的杠杆有效性警告（给跑矩阵的那条线；不改你的文件）

- **L1（重要）`USAGE_PAGE_LABEL = '用量 · dsh-usage'` 很可能选不中任何元素。**
  该字符串在整棵 `node_modules` 里**只出现一次**：用量卡的标题文本
  `"Token 用量 · dsh-usage"`（`@local/dsh-usage/lib/client.js:1126`，`<div class="du_title">`），
  而 `openPluginPage` 用的是 `page.getByText(label, { exact: true })`
  （`matrix.mjs` 10:22 版：`:60` 常量、`:367-368` 实现；我通读的是 10:17–10:18 版，语义相同），
  `exact:true` 是整串匹配 ⇒ `"用量 · dsh-usage" ≠ "Token 用量 · dsh-usage"`，将返回
  `{ok:false, reason:'plugin-label-not-found'}`，**D1-pluginusage 退化成 BASE + 3s 额外等待**。
  更重要的事实：**用量卡的唯一注册点是 `settings.plugin.item`**（`@local/dsh-usage/lib/client.js:1232`），
  即「设置 → 插件」标签页内部，**侧栏里根本没有这个页面**。若你想测「先开承载用量卡的插件页」，
  正确路径是：开设置 → 点插件 nav cell（`settings.section` id `plugins`, order 15）→ 让卡挂载（并看到 8+2 个
  usage RPC 落定）→ 关闭 → 再点设置。**请务必记录 `rec.levers.entry.ok` 与点击后的 URL**；若为 false，
  D1-pluginusage 的「无差异」**不能**当作证据。
- **L2 `reduceRenderedSessions` 改的是「已渲染行数」，不是「会话总数」**（点工作区名折叠/切换分组，
  以 `[aria-label^="会话“"]` 计数判有效性）。因为默认每组只渲染 5 行，**BASE 本身的行数可能已经很少**，
  D5 的杠杆幅度会很小 ⇒ 请把 `levers.scale.rowsBefore/rowsAfter/effective` 一并记入结论；
  若 `effective === false`，D5 是 null test，**不能**用来否证 O(N) 假设。若要真正测条件 5，
  建议加一格「先点『展开其余 N 个会话』把长会话组全部展开」再点设置。
- **L3 D7 的深色 lever 在源码上无法生效。**（`matrix.mjs` 10:22 版 `:416-430` 未变）
  `forceDarkTheme` 设置的是
  `documentElement` 的 `data-theme="dark"` 与 `class="dark"`，并 `emulateMedia({colorScheme:'dark'})`；
  但本应用的主题是 `body[data-ds-dark-theme]`（`dsh-client-ui-layout/lib/client.js:429`）
  且 shell/vendor CSS 里**不存在任何 `data-theme` 选择器**（`index-C6eRlFa6.css`、`vendor-CjyC-hUb.css` 均 0 命中），
  并且 ui-theme 的 media 监听显式早退：`if (this.preference !== "system") return;`
  （`dsh-client-ui-theme/lib/client.js:1126-1136`），而部署配置为 `preference: light`（`~/.dsh/settings.yaml:218-219`）。
  ⇒ `levers.theme.renderedDark` 预期为 `false`。**D7 请改用**：写 `~/.dsh/settings.yaml` 的
  `ui-theme.preference: dark`（需宿主重载/热载）**或**在「设置 → 通用 → 外观」点深色方块，
  并断言 `document.body.hasAttribute('data-ds-dark-theme') === true` 之后再开测。
- **L4 D6 移除的不是设置自己的遮罩。** `removeWallpaperMask` 在**打开设置之前**执行
  （`matrix.mjs` 杠杆顺序：入口 → 会话规模 → 壁纸 → 主题 → 才 `openAndMeasure`），
  且筛选条件是「fixed/absolute + ≥90% 视口 + (backdrop-filter 或 0<alpha<1) + **没有 background-image**」，
  按分数取最高者 ⇒ 命中的大概是 HOME 上**已存在**的全屏 blur 层，最可能是 onboarding 遮罩
  `._onboardingMask_1cfrq_10`（`position:absolute;top:80px;bottom:0;backdrop-filter:blur(2px);background:#0000003d`，
  `index-C6eRlFa6.css` char 11489）或 shell 自己的 Modal 遮罩 `._mask_15u5s_14`（char 10026，同样 `var(--dsw-mask-blur)`），
  **而不是**点击时才创建的 `.VOzbGW_mask`。所以 D6 实际测的是「少一个既存全屏 blur 层」，
  请把 `levers.wallpaper.maskFound / pick.cls / pick.bf` 写进结论——若 `maskFound:false`，D6 是 null test。
  另外 `darkMask: 0` 意味着**壁纸插件自己的遮罩元素当前不存在**，所以「移除壁纸遮罩」在本部署里
  等价于「移除别的层的遮罩」，不是「关掉壁纸」。

---

## (b) 什么会证伪我（可观测签名 + 该看哪个指标对）

**首要伪证对（信息量最大）：`D3-immediate` vs `D3-wait60`（两者都是 cacheDisabled=true，只差等待）。
指标：点击后 500ms 窗口内的 LongTask 次数与 `maxMs`（`ltPost.maxMs`）、以及 click→面板可见耗时
（`clickToPanelMs`）。**
- 我的预测签名：immediate 出现一次 **>100–300ms** 的 LongTask 与明显更大的 `clickToPanelMs`，
  wait10 / wait60 两格无该长任务、彼此在噪声内。
- **若三格都在噪声内** ⇒ 我的第一名预测死掉，残余与「启动期主线程忙」无关；此时应立刻改押
  **条件 6 / 条件 1B（大 DOM 之上的全屏 backdrop 栅格）**，并把分析转向 Paint/Composite 而非 Script。

**第二伪证对：`D6-nomask` vs `BASE`。指标：`Task` 里 Paint/Composite 自时间（若有 GPUTask/RasterTask 更好）
+ 页内 `getComputedStyle(e).backdropFilter !== 'none'` 的全屏元素个数（矩阵已有 `FACTS_FN` 采这类字段，见 `matrix.mjs:415`）。**
- 我的预测签名：BASE 比 D6 至少多 0–1 个全屏 blur 层且 paint ms/s 更高；若**完全同**，
  说明全屏 blur 不是残余来源 ⇒ 残余只能是「DOM 规模驱动的渲染/版式」（此时看 1B、4）。

**第三伪证对：`D5-smallws` vs `BASE`。指标：`levers.scale.rowsBefore/rowsAfter` 必须先确认有效。**
若行数确实下降 3 倍以上而帧指标无差 ⇒ 我押的「NO-EFFECT」成立，并**顺带否证**「会话数 O(N) 放大设置卡顿」；
若行数下降且明显变好 ⇒ O(N) 成立，且方向应指向 **DOM 规模**而非「会话数」本身（因为点击路径不查会话）。

**口径纪律（不得违反 MEASUREMENT-STATUS）**：本机从未真正独占，**绝对 ms/s 只在同 cell、同窗口长度内做相对比较**；
禁止用 panel MutationObserver 次数当重渲染证据（§3 表）；跨线时间先换算成本地时刻（§6 时区）。

---

## (c) 7 个 condition 覆盖不到的机制（若矩阵**普遍**卡，先看这一节）

1. **用量卡的 60s 轮询会周期性阻塞宿主**：`@local/dsh-usage/lib/client.js:976-992`，
   代码注释自陈每个周期让宿主事件循环阻塞 **~0.3–0.5s**（`:981`），每周期 8 个 RPC（`:910-921`）。
   只要「设置 → 插件」标签页开着或曾在视口内，点击设置若落在该窗口内就卡，**与 7 个 condition 全都无关**。
2. **`document.hidden` 门控**：同一轮询在标签页隐藏时直接 return（`:983,987`），
   用量卡的 IntersectionObserver 也只在卡片入视口时轮询（`:795-812`、`:983`）⇒ **headless/后台标签的实测
   与 headed/前台不可互比**（你们另有 `headed-vs-headless` 线，注意共用这一条）。
3. **onboarding 全屏遮罩（一个既存的全屏 blur 层，且只在 HOME 出现）**：
   `._onboardingOverlay_1cfrq_3{position:fixed;inset:0;z-index:1100}` +
   `._onboardingMask_1cfrq_10{position:absolute;top:80px;bottom:0;backdrop-filter:blur(2px);background:#0000003d}`
   （`index-C6eRlFa6.css` char 11403/11489）。它的显现条件
   `onboardingActive = sessions.phase==="ready" && (current===undefined || current 会话为 blank)`
   （`settings-general/lib/client.js:190-191`）**恰好在 HOME（1A/3 的默认入口）成立**，
   而「是否已完成」只存在组件本地 state、**每次页面加载都重置**（`:179,192-195`），
   步骤由 `welcome-notice` / `deepseek-official` 注册（`settings-models/lib/client.js:2791-2802`）。
   ⇒ 若该层在 HOME 真的在屏，则 **HOME 组本身多带一层全屏 blur，1A 与 1B 的对照被污染**，
   且条件 3 的 immediate 档还会叠加「sessions store 何时到达 ready」这一时序。
   **廉价自查**（一行 DOM 查询，不用改产品）：在 HOME 数
   `[...document.querySelectorAll('*')].filter(e=>getComputedStyle(e).backdropFilter!=='none').length`
   以及是否存在 `._onboardingOverlay_1cfrq_3`。
4. **`theme/change` → 壁纸重放**：`@local/dsh-wallpaper/lib/client.js:588` 是 `ctx.on("theme/change", () => applyCurrent(ctx))`，
   `applyCurrent`→`applyWallpaper` 会**无条件**重写全屏 fixed 层的 `backgroundImage`/`filter`
   （`:238-266`，`:255,:257`）。同一文件另有 `sessions.list.subscribe(...)` 也调用 `applyCurrent`
   （`:584-587`）。任何**设置文档/主题发布**（不只条件 7 的浅深切换）都会走这条路，
   ⇒ 7 个 condition 没有一格能区分「本次点击是否伴随一次壁纸重放」。
5. **shell 自己的全屏 Modal 遮罩** `._mask_15u5s_14`（`index-C6eRlFa6.css` char 10026，同样 `var(--dsw-mask-blur)`）：
   若你的「插件页/目录选择器」路径上留了一个 shell Modal 挂着，就会与设置遮罩**叠两层 backdrop-filter**（backdrop 套 backdrop）。
   7 个 condition 没有这一格。
6. **宿主侧与 reconnect 绑定的 O(N) 冷折叠**：`session.list` 会为每个冷会话读一次 artifact
   （`dsh-host-apiproxy/lib/index.js:2224-2300`，批大小循环 `:2264`），而它**每次连接世代都会跑**
   （`dsh-client-runtime/lib/client.js:8448` `handleConnected()` → `refreshList()`，`:8070`）。
   ⇒ 测量期间任何一次 WS 重连都会注入一次 250ms+ 的宿主停顿，与 7 个 condition 无关；
   请把 `concurrency`/连接世代计数记进每格结论。
   `/usage/status` 每次调用还要做两次 `SELECT COUNT(*)` 全表计数（`@local/dsh-usage/lib/index.js:223-233`）。
7. **V8 惰性编译 / code-cache 暖度**：整页 8.05 MB JS，设置子树的函数体在**首次执行**时才编译；
   这一项**每页只付一次**，任何刷新都会重置。7 个 condition 只被条件 3 部分覆盖，
   而条件 2 的复开是在**同一页内**（编译早已完成）⇒ 两条 condition 会各自归因到不同的东西，
   解读时别把 2 和 3 混成一个「首开成本」。
8. **`dsh-client-ui-trajectory`（另一个 transcript 渲染器）**自带 `ResizeObserver`+rAF 与 `rafId` 机制
   （`dsh-client-ui-trajectory/lib/client.js:1228,1340,2082`）。若「长会话」入口实际打开的是 trajectory 视图
   而不是 chat 视图，1B 的对照对象就换了渲染器——**UNVERIFIED**：我没有确认该包渲染哪个视图/标签。

---

## (d) UNVERIFIED（我无法在没有浏览器的情况下证实，全部标出）

1. **同值写入是否真的触发重绘**：`applyWallpaper` 每次把同一个 `backgroundImage`/`filter` 字符串写回全屏 fixed 元素
   （`@local/dsh-wallpaper/lib/client.js:255-257`），我**无法**在这里判定 Blink 是否对同值 inline style 做 early-out。
   若不做，则每次 `sessions.list` 发布 / `theme/change` 都会重绘一层全屏 1810×1279 图（≈10MB 解码），
   这笔成本会落在 **Paint** 而不落在 JS 自时间里——**与「残余 65–100 ms/s 未归属、且 Recalc 已降为 0.039」的现象高度吻合**。
   廉价验证：在窗口内对 `CSSStyleDeclaration.prototype.setProperty`/`style.backgroundImage` 计数，
   或直接看 Paint 自时间与 `wallpaperEl` 的重绘次数。**这是我最希望被矩阵顺手验掉的一条。**
2. **HOME 上是否真的存在 onboarding 全屏 blur 层**（§c-3 的 `_onboardingOverlay`）。步骤组件可能
   「挂载但决定不画」（`settings-general/lib/client.js:69-70` 注释自陈），所以从源码推不出屏上有几层。
3. **D1-pluginusage 的 lever 是否生效**（L1）。我依据的是 Playwright `getByText(exact:true)` 的整串语义
   + 全仓只有一处该字符串；**未实际运行**。
4. **`manifest.plugins` 的实际条数**：F1 的「点设置不加载 chunk」来自压缩后 shell bundle 的
   `runPluginBoot` 读法；我统计的 **51 个 web client bundle / 8,048,011 字节 / 11 个 immediately** 是按
   各包 `package.json` 的 `dsh.client` + `exports["./client"]` 静态枚举得到的，**与运行时 manifest 是否逐一对应未验证**。
5. **绝对耗时**：本机从未真正独占（MEASUREMENT-STATUS §3.-1.0 门禁局限）⇒ 我**不给任何 ms 预测**，
   只给方向与比值；上表所有判定都是「相对于同批其他 cell」的。
6. **`--dsw-mask-blur` 在壁纸的 `overrideTokens` 层里是否被改写**：override 只含 `--dsw-alias-bg-base`
   （`@local/dsh-wallpaper/lib/client.js:195-200`），我据此判定 `blur(2px)` 仍然生效；**未在运行时核对计算值**。
7. **条件 4 的断点效应**：`SIDEBAR_AUTO_COLLAPSE = 1024` 的折叠是否在 900×800 下真的触发并改变版式
   （由 `ResizeObserver`+rAF 路径驱动，`dsh-client-ui-layout/lib/client.js:177-187`）**未实测**。
8. **`dsh-client-ui-trajectory` 与「长会话」入口的对应关系**（§c-8）。
