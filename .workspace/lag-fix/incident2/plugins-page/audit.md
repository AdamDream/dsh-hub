# 「点击插件页」这一下的成本分解 — 审计报告

单元：`.workspace/lag-fix/incident2/plugins-page/`
宿主：PID 301709（`node dsh web`，ELAPSED 1391 s，未重启、未改任何产品文件）
GUI：`http://127.0.0.1:3080`
日期：2026-09-22

---

## 0. 并发条件（所有绝对 ms 都带这些条件）

| 项 | 值 |
|---|---|
| 我方浏览器 | **Chrome 153.0.8010.52**，`headless`(new)，Playwright **1.49.1**，channel=`chrome` |
| 视口 / DPR / 语言 | 1440×900 / 1 / `zh-CN`（与用户 Chrome 的 `--lang=zh-CN` 一致） |
| profile | 每次冷启动全新临时 profile，无扩展；每个"冷"场景用独立 browser 实例 |
| 主机 loadavg | probe1 5.42 · probe2 4.50→4.24 · probe5 4.51→4.24（1 分钟值） |
| 并发 | `concurrentWith=peer-chromium`（同机另一条线在跑自己的 plain-chromium headless 探测，PID 400270，非我方实例）；无 GPU/合成器真实路径（headless） |
| 共享锁 | 我在 03:00:33Z 写入 `research-v2/.probe.lock/owner.txt` pid=310374；**03:17:52Z 另一条线（pid 408162，「same-page cross-panel comparison」）替换了 owner.txt**。我未删除其 owner.txt。probe1–probe4 在持锁期内完成；probe5 与其启动时段相邻 |
| 纪律 | 只手点：设置入口 / `通用设置` / `插件` / `插件列表` tab / 搜索框输入。**未点保存、应用、删除、禁用插件**。未 pkill、未重启宿主/用户浏览器、未改产品文件（宿主侧全部只读定位到 path:line） |

**测量口径**：所有 click 都是 Playwright 经 CDP 派发的**真实输入**；锚点 = 页内捕获阶段第一个 `isTrusted` 的 `pointerdown`（`performance.now()` 页面时钟）。所有窗口与 RPC 起始/结束时间都用页面时钟表达。
**单位**：CDP `Performance.getMetrics` 的 `Timestamp` 与各 `*Duration` 均为**秒**——用声明 2000 ms 的空闲窗验证：`Timestamp` delta = 2.0049（probe1 `C.idleAmbient`），probe3 声明 500 ms 的窗 delta = 0.5027。报告已统一 ×1000 成 ms。

---

## 1. 精确测量

### 1.0 前提修正（必须先说，否则后面全部会错）

简报里的两条既有证据描述的是**另一个点击**：

- **点击设置里的「插件」导航项，落到的是「插件配置」tab，不是「插件列表」。** 默认 tab 由注册顺序决定：`dsh-client-ui-settings-plugins/lib/client.js:420`（`active = rows.find(...)?.id ?? rows[0]?.id`）+ `:489`（只有 active 或 visited 的面板才渲染）+ `:1289-1291`（configurable tab `order: 0`），而 inventory tab 是 `dsh-client-ui-settings-plugin-inventory/lib/client.js:288` 的 `order: 10`。实测 DOM：`data-active="true"` 在 id `:rN:-tab-configurable`，`插件列表` 为未选中（`raw/discover.json`、截图 `raw/discover-plugins.png`）。
- 因此**点击「插件」这一下不发 `pluginInventory.list`**，它发的是 **9 个 `/usage/*` RPC**（channel=`/usage`，方法名取自请求体 `method` 字段）：`summary`、`timeseries`、`heatmap`、`byModel`、`byProject`、`byDay`、`timeseries`(第二次，granularity=hour)、`sessions`、`status`。
- `pluginInventory.list` 只在点 **「插件列表」tab** 时发一次（请求体 `{"type":"client-request","rpcId":...,"method":"pluginInventory/list","payload":{"args":{}}}`，响应 21,754 字符）。

两个点击我都测了，后文分别称 **导航点击** 与 **tab 点击**。

### 1.1 主结果

| 点击 | 条件 | **click→内容可见** | 窗口内 JS | 布局 | 样式重算 | LongTask | LoAF | 窗口宽 |
|---|---|---|---|---|---|---|---|---|
| 导航「插件」 | 冷（本页首次）n=1 | **12.9 ms** | 7.66 ms | 3.93 ms | 2.00 ms | 0 | 0 | 50.3 ms |
| 导航「插件」 | 热 n=7（p50 / min–max） | **4.2 ms** / 4.0–4.7 | 3.24 / 3.06–4.11 | 0.68 / 0.64–0.69 | 0.70 / 0.68–0.76 | 0 | 0 | 44.8 ms |
| tab「插件列表」 | 每次重挂载 n=6 | **20.8 ms** / 19.8–42.9 | 6.79 / 4.98–10.37 | 0.16 / 0.16–0.37 | 0.51 / 0.47–0.88 | 0 | 0 | 59.0 ms |
| 独立复现（新 browser） | 冷 | 14.8 / 22.5 ms | 8.8 / 7.9 | 5.5 / 0.3 | 2.2 / 0.6 | 0 | 0 | ~54 ms |

- `click→内容可见`：导航点击 = `h2.pbvGtq_heading`（插件区标题+tab 栏同一提交）；tab 点击 = 首个 `[data-plugin-entry]` 进 DOM。取的是 MutationObserver/5 ms 轮询的命中时刻，非 rAF 二次确认（headless 下 rAF 不锁 vsync，见 1.4）。
- **"LongTask = 0、LoAF = 0" 的统计跨度比表中"窗口宽"大得多**：两次计数器的切片起点在 300 ms 配对空闲窗**之前**，终点在 click+1500 ms 之后，即**每次点击约 1.8 s 的跨度**（含 300 ms 空闲 + arm→click + click + 600/1500 ms 尾部）。14 次点击 × ~1.8 s 内 LongTask 与 Long Animation Frame 均为 **0**。

### 1.2 阳性对照：证明 LongTask 通道真的能报出阻塞，并暴露一个盲区

120 ms 忙循环，三条注入路径（`raw/click2-raw-*.json → scenarios.P1.controls`）：

| 注入路径 | LongTask 报告 | LoAF 报告 | CDP ScriptDuration |
|---|---|---|---|
| `Runtime.evaluate`（直接 evaluate 里跑） | **0 个（盲区）** | 123.5 ms | 23.2 ms |
| 页内 `setTimeout` 任务 | **120.0 ms** ✓ | 121.7 ms（blocking 70.2） | 120.5 ms |
| 页内 `requestAnimationFrame` 回调 | **120.0 ms** ✓ | 136.1 ms（blocking 70.3） | 206.4 ms |

结论（这是本次最重要的方法学结果）：
1. **LongTask 通道已被证明能报出 ≥50 ms 阻塞**（页内任务 120 ms → 报 120.0 ms 整）。
2. **Long Tasks API 不把 DevTools 注入（`Runtime.evaluate`）的任务归因给页面**：同一段 120 ms 忙循环，从 evaluate 注入时 LongTask 报 0，从页内定时器注入时报 120 ms。
3. 因此我第一轮 probe1 用 evaluate 做的对照是**假阴性**（当时 LongTask=0 而 LoAF 抓到 122.9 ms），已修正；同时说明**probe1 里"点击窗口 0 LongTask"的结论依然成立**，因为通道有效性已由页内任务对照独立证明。

### 1.3 逐帧序列

`click ± 600 ms` 窗口内帧间隔：**最大 16.8 ms**，无 >20 ms 间隔（导航冷点击 42 帧、tab 点击 3 帧、空闲档 446 帧/2 s）。
**注意**：headless 下 rAF 不受 vsync 约束（空闲 2 s 内 446 帧 ≈ 223 次/s），所以**帧数不能当 fps 读**，只能把"帧间隔"当作卡顿指标读。

### 1.4 CDP `Performance.getMetrics` 分项 delta（Chrome 153 headless）

- **存在的字段**（`analysis.json → probe1.clicks[...]` 的 `keysPresent`，实测 35 个）：`LayoutCount`、`RecalcStyleCount`、`LayoutDuration`、`RecalcStyleDuration`、`ScriptDuration`、`TaskDuration`、`TaskOtherDuration`、`V8CompileDuration`、`Timestamp`、`Nodes`、`JSEventListeners`、`JSHeapUsedSize/TotalSize`、`Documents`、`Frames`、`Resources`、`LayoutObjects`、`ThreadTime`、`ProcessTime`、`DevToolsCommandDuration` … 等。
- **`Paint` / `CompositeLayers` 字段在本 headless 配置下不存在**。我按事实只报告存在的字段，**未编造任何绘制/合成数值**；因此"绘制/合成"这一维度在本报告中为 **INCONCLUSIVE**。
- 关键 delta（×1000 成 ms，窗口宽度见 1.1 表）：
  - 导航点击（冷）：`LayoutCount` 1、`RecalcStyleCount` 5、`Nodes` **+315**、`JSEventListeners` **+17**
  - 导航点击（热）：`LayoutCount` 1、`RecalcStyleCount` 6、`Nodes` **+305**、`JSEventListeners` **+17**
  - tab 点击：`LayoutCount` 1、`RecalcStyleCount` 6、`Nodes` **+1773**、`JSEventListeners` **+178**

### 1.5 DOM / SVG 计数（事件提交后）

| 指标 | 打开设置后（停在 `通用设置`） | 导航点击后（`插件配置`） | tab 点击后（含两个面板） |
|---|---|---|---|
| 文档元素 | 755–771 | 1024 | **2423**（inventory 面板内 1398） |
| SVG | 83–84 | 80–82 | **260**（inventory 面板内 **178**） |
| `[data-plugin-entry]` | 0 | **0** | **177** |
| `[data-plugin-count]` | – | 无 | **177** |

**对既有证据的修正**：简报里的「149 个 SVG」在本部署实测是 **178 个**，而插件数是 **177**。结构归因是干净的：面板内 `svg=178` = **177 个卡片 chevron（每卡片恰 1 个，`firstCardSvg`=1，源 `client.js:188`）+ 1 个搜索图标（`client.js:117`）**；`path=179`（178 + 搜索图标多 1 条 path）。`li=177`、`button=177`、`strong=177`、`span=502`。文档级 260 = 178（inventory 面板）+ 82（`插件配置` 面板，因 `visitedIds` 机制保持挂载）。

### 1.6 页内每个 RPC 的方法名与耗时

方法名取自**请求体** `method` 字段（不是 HTTP 动词，也不是 URL 猜的）；channel 取自 URL 路径首段，一并给出，因为 `/usage` 通道的 `method` 是**不带命名空间的裸名**：

**导航点击窗口（`/usage` 通道，全部 `POST`，均 click+6…8 ms 发出）：**

| 请求体 `method` | channel | 相对 click 结束 | 耗时 | 响应字符 |
|---|---|---|---|---|
| `summary` | /usage | +24.7 | 18.3 ms | 270 |
| `timeseries` | /usage | +156.5 | 149.6 ms | 934 |
| `heatmap` | /usage | +157.5 | 150.5 ms | 1430 |
| `byModel` | /usage | +177.9 | 170.8 ms | 1091 |
| `byProject` | /usage | +198.5 | 191.3 ms | 1039 |
| `byDay` | /usage | +93.5 | 86.3 ms | 934 |
| `timeseries`（hour） | /usage | +237.7 | 230.3 ms | 245 |
| `sessions` | /usage | +285.1 | 277.6 ms | **54 062** |
| `status` | /usage | +290.2 | 282.6 ms | 312 |

**tab 点击窗口：** `pluginInventory/list`（channel `/api`）——click+1.4 ms 发出、click+16.7 ms 返回、**15.05 ms**、21,754 字符（p50，n=6，max 34.8 ms）。

> 9 个 `/usage` RPC 是**并发**发出、异步返回：它们**不阻塞**主线程，但决定了"插件页看起来多久才填满"（最后 ~270–380 ms 才到齐）。这是导航点击唯一"贵"的地方，而它属于**等待**，不是**阻塞**。

---

## 2. 客户端 vs 宿主切分

### 2.1 tab「插件列表」点击（20.8 ms 的分解）

| 阶段 | 值 | 占比 |
|---|---|---|
| 事件派发 → RPC 发出 | 1.4 ms | **6.7 %** |
| **等待 `pluginInventory.list` 返回** | **15.05 ms** | **72.4 %** |
| RPC 返回 → 177 卡片进 DOM（React 提交） | 3.9 ms | **19.7 %** |

- **JS 自时间**：窗口 59 ms 内 `ScriptDuration` p50 **6.79 ms**；其中"渲染 177 张卡片"的自时间可由同路径的独立测量界定为 **≤ ~4 ms**（probe3 的 +172 卡片挂载行 = 3.87 ms script，且该值还含 `fill` 的 evaluate 开销）。
- **样式重算 / 布局**：`RecalcStyleDuration` p50 **0.51 ms**、`LayoutDuration` p50 **0.16 ms**（`LayoutCount`=1、`RecalcStyleCount`=6）。**布局不是成本项**。
- **等待 RPC**：15.05 ms，**是这一下的主体（≈72 %）**。
- 本底校准（同 rig、配对长度空闲窗）：script **p50 4.14 ms/s**（最大 132 ms/s 突发）、task p50 12.47 ms/s → 对 30–106 ms 的窗口，本底通常 <1 ms；但存在 ~33 ms 的偶发脚本突发（probe3 一个 250 ms 空闲样本），故**单次离群值（如 42.9 ms）不可归因**。

### 2.2 导航「插件」点击（4.2 ms 热 / 12.9 ms 冷）

**几乎全部是客户端 React 工作**：`RecalcStyleDuration` 0.70/2.00、`LayoutDuration` 0.68/3.93、`ScriptDuration` 3.24/7.66 ms；**没有任何阻塞式等待**。冷点击比热点击贵 ~3 倍（12.9 vs 4.2 ms），对应首次挂载 section + configurable 面板 + 仪表盘。

### 2.3 宿主侧切分：**"每次点击都无缓存重扫插件目录"被证伪**（双重证据）

**代码（只读定位，未改）**
- `dsh-host-plugin-inventory/lib/index.js:102-114`：`list()` 直接遍历 `this.ctx.loader.entries()` 做内存投影（`:104` `for (const entry of this.ctx.loader.entries())`），`:91` `static inject = ["loader"]`。
- `:96-100` 注释是明确的设计意图：*"Read the Loader directly on every call. Cordis's internal plugin/status events already maintain Entry.fiber and Fiber.state, so a second cache would only add another lifecycle truth to keep synchronized."*
- 该文件**完全没有 `fs` 引用**（无 `readdir`/`readFile`/`stat`）；宿主包中对插件目录做 `readdir` 的也只有 `dsh-client-modules` 的 bundle 服务路径，与 `pluginInventory.list` 无关。

**计时（直接 HTTP，不经浏览器）**
- `POST /api/pluginInventory/list`（177 条 / 21,742 字节）p50 = **9.09 ms**（n=40，min 6.42 / max 18.21）；
- 9 字节对照 `POST /api/agentPreset/list` p50 = **10.98 ms**（n=40，min 6.14 / max 92.06）；
- 比值 **0.83**（大载荷反而略快，差异落在进程启动 + 回环 + 调度噪声内；地板 min ≈ 6 ms，主要是每次调用一个 `curl` 进程的开销）。
- ⇒ **响应体大小与条目数没有带来可测的额外代价**。若每次点击都重扫目录，21.7 KB 的对照组不可能与 9 字节组同速。证据文件：`raw/host-rpc-bench.json`。

**唯一与磁盘相关的路径（但不在这条点击上）**
- `dsh-client-modules/lib/index.js:467-484`：`/plugins/<id>/client.js` 每次 `await readFile(path)`（`:480`）、回 `cache-control: no-cache`（`:483`）——即每次抓取都读盘。但**点击插件页不触发任何 bundle 抓取**：probe1 的 `resources` 显示 50 个 lazy client bundle 全部在 **click−2400 ms 附近（即"打开设置"那一刻）** 一次性抓取，其中包含 `@local/dsh-pptmaster` **4,096,057 字节**、`dsh-client-ui-trajectory` 359 KB、`dsh-client-ui-settings-plugin-inventory` 17.3 KB。点击窗口内 plugin bundle 抓取数 = **0**。

---

## 3. 规模化

- **本机插件数 = 177**（唯一权威来源：`pluginInventory.list` 响应 `entries` 长度，与页内 `data-plugin-count` 一致）：**146 已启用（fiberPhase=active）+ 31 已停用（fiberPhase=null）**。`node_modules` 下 `@deepseek-ai` 包 197 个、客户端模块图条目 50 个——**都不能当插件数**。
- **每插件成本（实测）**
  - DOM：面板内 **1398 元素 / 177 = 7.9 元素/插件**；**SVG 1.006 / 插件**（每卡片实测 7 元素 + 1 SVG）。
  - 事件监听器：**1 个 click 监听器/卡片**——CDP `DOMDebugger.getEventListeners` 实测：card `<button>`=1（click）、`<li>`=0、`<strong>`=0、`<chevron svg>`=0；`JSEventListeners` 增量恰好 **+178 = 177 + tab 按钮 1**。（计数已验证；产生机制未验证——React 本应在根委托，此处每卡片自带监听器，标 INCONCLUSIVE，见 §5。）
  - 客户端渲染：177 卡片 ≈ **4–7 ms script**、≤0.4 ms layout、≤0.9 ms 样式重算 → **≈ 0.03 ms script / 插件**。
- **"每插件成本 × 插件数" 对照实测总成本**
  - 线性外推（客户端部分）：177 × 0.03 ms ≈ **5.3 ms**；实测 tab 点击 **20.8 ms**。
  - 差额 **≈15 ms 是固定项**（`pluginInventory.list` 宿主往返，已证明与条目数无关）。
  - 导航点击 **4.2 ms**（渲染 0 张卡片）→ 说明还有一个与插件数无关的姿态基线。
  - ⇒ **总成本 = 固定项 + 线性项，二者之和；实测总成本并未高于线性外推**（差额可完整归因到已测出的固定项），所以**未发现超线性项**。
- **超线性/累积的其它检验（均为负）**
  - 8 次导航 + 6 次 tab 点击序列：耗时无上升趋势；每次节点/监听器增量恒定（+305/+17、+1773/+178）→ 无泄漏式累积。
  - 配对空闲窗 script p50 4.14 ms/s，不随点击次数增长。
- **未证实项（明确标 INCONCLUSIVE）**：probe3 的搜索过滤序列（同一条 `map()` 路径、不同列表长度）被环境突发噪声污染——零变更的对照行分别是 0.54 ms 与 13.23 ms script（噪声底 24×），**不能**用来定"每插件斜率"。可用的单点仍与上面的结论一致：+172 卡片挂载 = 3.87 ms script。

---

## 4. 最小修复候选（只出方案，**未改任何代码**）

### 候选 A —— 让插件页的两个重面板"按需/可见时才渲染"
现状：点导航即挂载 `插件配置`（含 dsh-usage 仪表盘，一进 section 就取数：9 个 `/usage` RPC、最大 54 KB 响应、图表渲染），点 `插件列表` 再挂载 177 张卡片（+1398 元素 / +178 SVG / +177 监听器）。inventory 本身已是 lazy slot，但**仪表盘不是**。
- 预期收益：导航点击窗口内的 `/usage` RPC 数降为 0，消除"点进去后 ~300 ms 内陆续填满"的观感（这才是导航点击唯一贵的地方）；tab 点击省下 ~0.4 ms layout + ~0.9 ms 样式重算（很小）。
- 风险：低（纯客户端渲染时机）。
- 验收：点击插件导航后 `/usage/*` RPC 计数 = 0；进入 `插件列表` 时 177 卡片可见延迟不高于现状 p50 20.8 ms；`data-plugin-count` 仍 = 177。
- **可由客户端热面修复**（改 client bundle，宿主按 `no-cache` 提供，刷新即生效）。

### 候选 B —— 卡片结构减重（每卡片 1 SVG + 1 个 `role="img"` 状态点）
现状：每卡片 1 个 `IconChevronDownOutline14` SVG（178 SVG / 177 卡片）、1 个带 `aria-label` 的 `role="img"` 状态点、1 个文本 tag，共 7 元素。
- 方案：chevron 改 CSS 绘制或改用单个 `<use>` symbol 复用；状态点改纯 CSS + 合并进卡片 `aria-label`；卡片加 `content-visibility:auto`。
- 预期收益（本 rig）：~0.5–1 ms 样式重算；**在强制无障碍下价值更明显**——用户 Chrome 实开 `--force-renderer-accessibility`，我 A/B 实测该 flag 让**导航热点击 p50 4.2→6.6 ms（n=7 vs n=3，×1.57）**、导航热点击 `RecalcStyleDuration` p50 0.70→1.01 ms（×1.44）、**tab 点击 `RecalcStyleDuration` p50 0.51→0.89 ms（×1.75）**、冷导航 `RecalcStyleDuration` 2.00→3.18 ms；tab 点击可见延迟 20.8→21.75 ms（≈无变化）。**但绝对量仍只有毫秒级，不足以解释 ≥115 ms。**
- 风险：低-中（视觉与无障碍语义变更，需给回等价 aria 方案）。
- 验收：`svg`（inventory 面板内）从 178 降到 ≤2；`getByRole` 仍能读到 177 张卡片的无障碍名称；条目数仍 177；样式重算不高于现状。
- **可由客户端热面修复**。

### 候选 C —— 给 `pluginInventory.list` 加缓存门（**建议不做**）
现状：宿主每次重新投影并序列化 177 条 / 21.7 KB，无缓存（有意设计，见 `index.js:96-100`）。
- 预期收益：本 rig 下省的是 21.7 KB 的序列化 + 传输 + `JSON.parse`，量级 **1–2 ms**；而且"无缓存重扫目录"的担忧已被 §2.3 证伪，所以**这条不解决任何已测到的痛点**。
- 风险：高——会引入第二个生命周期真相，与该文件的设计意图正面对冲；正确性风险明显大于收益。
- 验收（若仍要做）：`pluginInventory/list` p50 不低于现状 9.09 ms（不得为缓存而变慢）；响应条目数仍 177。
- **需宿主冷面重启**（`dsh-host-plugin-inventory` 是宿主插件）。

> 一句话取舍：**A 与 B 是客户端热面、低风险、可回滚，且各自对应一个已量化的项；C 只在 profiling 显示序列化占比高时才值得，且需要冷面重启。**

---

## 5. 结论口径、对账与 INCONCLUSIVE 清单

### 5.1 与用户主观感受的对账
用户说"Chrome 里整体流畅，但点击插件页有卡顿"。在本 rig（全新 profile、headless、小 DOM：771→2423 元素、loadavg 4.2–6.8）下：**导航点击 4.2 ms（热）/ 12.9 ms（冷），tab 点击 20.8 ms；14 次点击窗口内 0 个 LongTask、0 个 Long Animation Frame**。即**未复现为 ≥50 ms 的阻塞事件**。

因此用户的主观"卡顿"更可能来自**等待与填充**而非主线程阻塞：点进插件页后，9 个 `/usage` RPC 并发拉数据，`sessions` 一个响应就 54 KB，直到 ~270–380 ms 才到齐并绘出图表——页面"点完先空、随后陆续长出来"。这与"只有插件页卡、别的设置页不卡"完全一致（别的设置页没有这个仪表盘）。这是一个**可测的、已被数据支持的**解释方向，但**"用户在真实 Chrome 里感受到的那一下就是它"仍属未证**。

### 5.2 与既有证据「插件页常数最大（客户端 ≤115 ms）」的对账 → **INCONCLUSIVE**
三种可能来源，我无法用现有数据判定是哪一种，**故不使用"应该很贵"来代替证据**：
1. **锚点定义不同**：我用的是页内 `trusted pointerdown → 选择器进 DOM`；若对方用"CDP 下发输入 → 下一帧合成"或"selector 可点击"，会叠加 CDP 往返、actionability 等待与合成器等待。
2. **被测对象不同**：对方测的很可能是**"冷开设置"**（50 个 lazy bundle + 4.1 MB `@local/dsh-pptmaster` 在那一刻抓取并解析），而不是点插件页；或点的是 `插件列表` tab 而非导航项。
3. **环境放大**：用户 Chrome 是长寿命页面、DOM 远大于我的 2423 元素，且实开 `--force-renderer-accessibility`。我实测该 flag 只带来 **×1.4–1.8** 的放大（导航热点击 p50 4.2→6.6 ms、tab 点击样式重算 p50 0.51→0.89 ms、冷导航重算 2.00→3.18 ms），**不足以单独解释 115 ms**；更大幅度的放大（真实 DOM 规模、长寿命状态、真实 GPU/合成路径）我**没有做**，属未测项。

### 5.3 明确 INCONCLUSIVE 的项（逐条）
1. **绘制 / 合成**：headless 下 CDP `Paint`/`CompositeLayers` 字段不存在，本报告无此维度数据。
2. **环境放大到 115 ms 的机制**：未定位。DOM 规模放大实验、长寿命页面状态、headed/真实 GPU 路径均未做（受"单浏览器实例串行 + 不打扰用户桌面"约束）。
3. **每插件边际斜率的回归**：probe3 过滤序列被突发噪声污染（噪声底 24×），不能定斜率。
4. **`--force-renderer-accessibility` 在用户真实 Chrome 上的绝对贡献**：我只测到本 rig 的 ×1.3–2。
5. **每卡片 click 监听器的产生机制**：计数已验证（+178），机制未验证。
6. **用户主观"卡顿"的精确对应物**：仅给出"填充延迟"这一有数据支持的方向，未证。

### 5.4 证据索引
| 文件 | 内容 |
|---|---|
| `raw/click-raw-2026-09-22T03-06-46-699Z.json` | probe1：首轮（含发现的两个 rig 假象） |
| `raw/click2-raw-2026-09-22T03-12-41-979Z.json` | probe2：紧窗口 + 8/6 次序列 + **三路注入对照** + ambient 配对 |
| `raw/click3-raw-2026-09-22T03-14-38-726Z.json` | probe3：SVG/DOM 结构归因 + 配对空闲窗 + 过滤序列 |
| `raw/click4-raw-2026-09-22T03-*.json` | probe4：每卡片监听器（`DOMDebugger.getEventListeners`） |
| `raw/click5-raw-2026-09-22T03-16-31-387Z.json` | probe5：`--force-renderer-accessibility` A/B |
| `raw/host-rpc-bench.json` | 宿主 `pluginInventory.list` vs 9 字节对照 RPC（各 n=40×2） |
| `raw/discover.json` / `raw/discover-*.png` | 设置面板结构与默认 tab 的现场证据 |
| `raw/user-chrome-cmdline.txt` | 用户 Chrome 的 `--force-renderer-accessibility` 只读快照 |
| `analysis.json` | 全部原始数据的机器可读汇总 + `derived` 结论 |
| `analyze.py` | 由 `raw/` 复算 `analysis.json`（可重跑） |
| `probe.mjs` `probe2.mjs` `probe3.mjs` `probe4.mjs` `probe5.mjs` `lib-instrument.mjs` `lib-env.mjs` | 探针与页内插桩（插桩只做观测式包装，不改应用状态） |

### 5.5 未能归因的部分（不编造）
- 导航点击的"TaskDuration 10.28 ms"里，除 JS 3.24 + 布局 0.68 + 重算 0.70 之外还有 **~5.7 ms 未归因任务时间**（IPC、GC、观测开销、本底突发）。本底 p50 12.47 ms/s，对该 45 ms 窗口约 0.6 ms，**不足以解释差额** → 标 INCONCLUSIVE。
- tab 点击的"TaskDuration 15.09 ms"里，除 JS 6.79 + 布局 0.16 + 重算 0.51 之外还有 **~7.6 ms 未归因**（含 21.7 KB 响应解析、promise/调度、观测开销）→ 标 INCONCLUSIVE。
