# 设置页「栏目切换 / 滚动」卡顿审计 — tab-switch 线

- 线别：`incident2 / tab-switch`（owner：本线独占 `.workspace/lag-fix/incident2/tab-switch/`）
- 宿主：`node .../dsh web` **PID 301709**（只读引用，全程未重启/未 pkill/未改产品文件）
- GUI：`http://127.0.0.1:3080`
- 用户线索（本轮最高优先级）：**Chrome 里整体流畅**，但在设置页的「通用设置 / 插件 / 设置栏目」之间切换、以及滚动时**有小卡顿**；其他设置功能页流畅。
- 器械：Playwright 1.49.1 + `chromium_headless_shell-1148`（**headless**）＋页内 document-start 打桩（LongTask / LoAF / rAF 帧序列 / fetch 捕获 / MutationObserver / 强制布局读取计数）＋ CDP `Performance.getMetrics`
- 原始数据：`raw/tabswitch-run1.json`（主）、`raw/tabswitch-run2.json`、`raw/tabswitch-run4.json`、`raw/run3-identity.json`、`raw/tabswitch-run5.json`、`raw/pos-debug.json`、`raw/recon.json`、`raw/boot.json`
- 静态证据（两个只读子代理）：`raw/sub-mechanism.md`、`raw/sub-section-cost.md`

> **方法学修正采纳（2026-09-22，来自 `incident2/plugins-page` 的实测 + 本线自身器械诊断）**
> 1. **阳性对照必须用「页内定时器/点击任务」注入，不能用 `Runtime.evaluate`。** 本线独立得到同一结论（§2.1 三臂矩阵：点击驱动 120 ms → LongTask **120 ms**；`Runtime.evaluate` 120 ms → LongTask **0 条**，而 LoAF 122 ms）。对方 LoAF 123.5 / LongTask 0 与之**互相印证**。本线阳性对照**本来就是用页内任务做的**（`S.spinTask` / `S.installClickSpin`），未受影响。此边界已写入 §2.1、§2.2。
> 2. **「插件」导航 ≠ 「插件列表」。** 点导航「插件」落到 `插件配置`（`configurable`，order 0；`dsh-client-ui-settings-plugins/lib/client.js:420/489/1289-1291`），inventory tab 是 `dsh-client-ui-settings-plugin-inventory/lib/client.js:288` 的 order 10。**本线数据本来就分开计**：点导航「插件」= 9 个 `/usage/*`、**不发** `pluginInventory.list`；后者**只在点「插件列表」子标签时发一次**（run6 实测复现，§3.7）。
> 3. **宿主 `pluginInventory.list` 不是"每次点击无缓存重扫目录"** ⇒ §3.7 更正：它遍历内存 `ctx.loader.entries()`（`dsh-host-plugin-inventory/lib/index.js:102-114`，该文件**无 `fs` 引用**），HTTP p50 **9.09 ms**（177 条 / 21,742 B）vs 9 字节对照 p50 **10.98 ms**（比值 0.83）⇒ **载荷大小无可测代价**。本线 run5 据"窗口内未 settle"推断的 **>1.8 s 已作废**（run6 实测 41.9 / 27.6 ms）。
> 4. **a11y 乘数（引用，不重测）**：`--force-renderer-accessibility`（用户 Chrome 实开）在 Blink 侧带来 **×1.4–1.8**（导航热点击 4.2→6.6 ms、tab 点击样式重算 0.51→0.89 ms、冷导航重算 2.00→3.18 ms）。已作为候选放大器纳入 §7 #10。

---

## 0. 逐条裁决（对照任务 1–5）

| # | 任务项 | 裁决 | 一句话依据 |
|---|---|---|---|
| 1 | 读出设置页实际存在的全部栏目/标签及其 id | **PASS** | 静态（live bundle 内 8 处 `settings.section` 注册）与活体 DOM（`nav button` × 8，中文标签逐一对应）**完全一致**，另发现「插件」内含 2 个子标签。见 §1 |
| 2 | 逐标签测量（含阳性对照） | **PASS（阳性对照 PASS；但"时间量"不可分辨）** | 点击驱动 120ms 阻塞 → LongTask **精确报出 120ms**（决定性闸门 PASS）。36 个点击窗口**全部 0 长任务、0 个 >50ms 帧**；栏目间差异是**分类量**（RPC 数 / 节点数），不是可测的时间量。见 §2–§3 |
| 3 | 滚动测量与根因 | **FAIL（未能归因）** | 主线程侧可**否定**样式写入与强制布局（ΔRecalc=0、ΔLayout=0、layoutReads=0）；但"壁纸遮罩层 / backdrop-filter"的 A/B **正序与逆序结论相反**，**不可复现 ⇒ INCONCLUSIVE**。见 §4 |
| 4① | 哪些标签**确实**更贵（同窗倍数、"是否可测差异"） | **PASS** | 「插件」= **9 个 RPC/切换（全部 `/usage/*`，77–791 ms）**、内容子树 337 节点；「插件列表」子标签 = **1820 节点 / 192 SVG**。其余 0–4 RPC。**RPC 数完全可分离**；时间量**不可分辨**。见 §3、§5.1 |
| 4② | 贵的共同点 | **PASS** | 共同点 = **"栏目自己带取数逻辑且挂载即取数"**（无 keep-alive、无跨切换缓存）。节点数/SVG 数不是共同点。见 §5.2 |
| 4③ | 是否存在「整面板重挂载」/「订阅即重渲染」 | **PASS（否定）** | 8 次切换中 `dlg/nav/header/close/content容器` **对象身份全部不变**，且外壳开销恒为 **84 节点**；仅内容子树被替换。见 §5.3 |
| 5 | 最小修复候选（2–3 条） | **PASS** | 3 条（2 热 1 冷），含预期收益/风险/验收/热冷面。见 §6 |
| — | 未能归因的部分 | 已列 | 见 §7（含**用户 Chrome 侧卡顿未被本线复现**、滚动根因、headless 保真度、锁被抢占） |

---

## 1. 标签集合：静态注册 vs 活体 DOM

### 1.1 机制
设置页导航**不是硬编码**，而是各插件向 **slot `settings.section`**（列表槽）注册条目；`settings-general` 读该槽并渲染成左侧导航，内容区用
`renderSlot("settings.section", …, { only: active })`（`dsh-client-ui-settings-general/lib/client.js:162-165`）**同层替换**。

### 1.2 全部栏目（8 个）— 静态注册点（`path:line`）

| order | id | 来源插件 | 活体中文标签 | 注册点 |
|---|---|---|---|---|
| 0 | `general` | `@deepseek-ai/dsh-client-ui-settings-general` | **通用设置** | `<npm-global>/…/dsh-client-ui-settings-general/lib/client.js:585-590`（`label: () => t("general.nav")`，zh 字典 `"general.nav": "通用设置"` 同文件 `:443`）|
| 10 | `models` | `…dsh-client-ui-settings-models` | 模型 | `…/dsh-client-ui-settings-models/lib/client.js:2784-2790` |
| 15 | `plugins` | `…dsh-client-ui-settings-plugins` | **插件** | `…/dsh-client-ui-settings-plugins/lib/client.js:1276-1282` |
| 20 | `agent-presets` | `…dsh-client-ui-agent-preset` | Agent 预设 | `…/dsh-client-ui-agent-preset/lib/client.js:1706-1712` |
| 40 | `dsh-workspace-enhancement` | 本地 `dsh-workspace-enhancement` | 远程工作区 | `~/.dsh/profiles/node_modules/dsh-workspace-enhancement/lib/client.js:5376-5383`（`label: () => t("settings.label")` → zh `"远程工作区"`）|
| 50 | `@local/dsh-ssh-gui` | 本地 `@local/dsh-ssh-gui` | 分布式控制 · dsh-ssh-gui | `~/.dsh/profiles/node_modules/@local/dsh-ssh-gui/lib/client.js:987-993` |
| 60 | `@deepseek-ai/dsh-vision-adam` | 本地 `@deepseek-ai/dsh-vision-adam` | vision-adam 识图设置 | `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/client.js:201-207` |
| 70 | `@local/dsh-subagent-model` | 本地 `@local/dsh-subagent-model` | 子代理模型 | `~/.dsh/profiles/node_modules/@local/dsh-subagent-model/lib/client.js:309-315` |

> `<npm-global>` = `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai`
> 活体核对：`raw/tabswitch-run1.json → nav.tabs`（由 `[role="dialog"] nav button` 读出）：
> `通用设置 | 模型 | 插件 | Agent 预设 | 远程工作区 | 分布式控制 · dsh-ssh-gui | vision-adam 识图设置 | 子代理模型` —— **与静态 8 条一一对应，无多无少。**

### 1.3 「插件」栏目内部的 2 个子标签（`settings.plugins.tab` 槽）

| id | 活体标签 | 注册点 |
|---|---|---|
| `configurable`（**默认选中**）| **插件配置** | `…/dsh-client-ui-settings-plugins/lib/client.js:1288` |
| `all` | **插件列表** | `…/dsh-client-ui-settings-plugin-inventory/lib/client.js:285` |

### 1.4 用户说的「设置栏目」最可能对应哪一个？

**没有**任何一个标签的字面名称是「设置栏目」（8 个栏目名已全部列出，无此名）。候选排序：

1. **最可能 = 左侧导航栏这一列本身**（用户把"设置页里的那排栏目"统称为"设置栏目"）：`[role="dialog"] nav`，即上面 8 个栏目。→ **本线已全量测试**。
2. **次可能 = 「插件」栏目内部的两个子标签**（「插件配置 / 插件列表」，`role="tab"`，位置在面板内 y≈218，形态上就是"栏目"）→ **已测试**（§3.3）。
3. 第三可能：某个用户侧口语化/记忆偏差的名字（例如把「远程工作区」「子代理模型」记成"设置栏目"）→ 无法判定。

**处置**：8 个栏目 + 2 个子标签**全部纳入测试**，故无论指向哪一个都已覆盖。

---

## 2. 器械与阳性对照（先证明"没测到"是可采信的）

### 2.1 阳性对照矩阵（9 窗；`raw/tabswitch-run1.json → positiveControl`）

三个注入臂 × 三个通道：

| 注入方式 | 请求 | 实测阻塞 | `longtask` PO | LoAF `dur` | rAF 帧间隔 max | 帧 >50ms |
|---|---|---|---|---|---|---|
| **DevTools 任务**（`page.evaluate` 内忙等）| 60 ms | 60 | **无** | — | 36.2 | 0 |
| DevTools 任务 | 120 ms | 120 | **无** | 122 | 18.4 | 0 |
| DevTools 任务 | 200 ms | 200 | **无** | 202 | 16.8 | 0 |
| **页面任务**（`setTimeout` 内忙等）| 60 ms | 60 | **60** | 61 | 32.5 | 0 |
| 页面任务 | 120 ms | 120 | **120** | 121 | 45.3 | 0 |
| 页面任务 | 200 ms | 200 | **200** | 201 | 28.5 | 0 |
| **点击驱动**（`click` 捕获钩子里忙等，经 `page.mouse.click` 真实投递）| 60 ms | 60 | **60** | 61 | 62.7 | 1 |
| **点击驱动（决定性闸门）** | **120 ms** | **120** | **120** | 121 | 28.8 | **0** |
| 点击驱动 | 200 ms | 200 | **200** | 202 | 19.2 | 0 |

**判定**
- ✅ **`PC-C 点击驱动 120ms` = PASS**：注入 120ms → LongTask 报 **120ms**（误差 0）。**与后续真实测栏切换完全同路径**（`page.mouse.click` → 页内事件处理），故"没测到长任务"是**可采信**的否定结论。
- ✅ `PC-P 页面任务 120ms` = PASS（120ms）。
- ℹ️ `PC-D DevTools 任务` = **通道盲**（LongTask 不产出条目；LoAF 与 CDP trace `RunTask` 仍能报出 202/120ms）。这是 Chromium 的行为：LongTask 只统计页面自身任务队列的任务，不统计 inspector 直接下发的任务。**器械边界，已记录**。**该边界已由 `incident2/plugins-page` 独立复现**（页内 `setTimeout`/rAF 注入 → LongTask **120.0 ms 整**；`Runtime.evaluate` 注入 → LongTask **0**，而 LoAF 抓到 **123.5 ms**）——与本线三臂矩阵结论一致。**故本线阳性对照一律用页内任务（`S.spinTask` / `S.installClickSpin`），从不使用 `page.evaluate` 做阳性对照。**独立确认见 `raw/pos-debug.json`：「页面任务」臂 `longtask=200`，「DevTools 任务」臂 `longtask=null` 而 `trace RunTask=200.16ms`。

### 2.2 ⚠️ 器械重大边界：**rAF 帧间隔在本环境不能当失速探测器**

同一份数据里，**120ms / 200ms 的同步阻塞没有产生任何 >50ms 的帧间隔**（`frames>50 = 0`，`frameMax` 16.8–45.3ms；`raw/pos-debug.json` 里 200ms 阻塞的帧间隔 top5 全是 ~16.8ms，8ms `setInterval` 心跳最大间隔也仅 8.1–21.3ms）。

⇒ **本线对帧间隔（p50/p95/p99/max、>50ms 帧数）一律只作低级别参考，不作"流畅/卡顿"的证据**；主结论建立在 **LongTask / LoAF** 两个通道上。
⇒ 反过来说：**"0 个 >50ms 帧"绝不能读作"不卡"**（further：见 §4 的正序/逆序自相矛盾）。

### 2.3 RPC 捕获
`fetch` 在 document-start 被包装，记录 `path / method / 起止 / 耗时 / 状态`。DSH 的 RPC = `fetch POST /api/<method>`；事件流 = `fetch` SSE `/api/events.mux|host`（流式，单独标记，不计入耗时统计）。

### 2.4 并发门禁
- run1/run3：窗口首尾各做一次 `/proc/*/exe` 精确普查（**禁用**会自匹配的 `pgrep -f`，见 incident2 §六.1）。run1 起止 `foreign=0`；run3/run5 每窗前后断言 `foreign==0 && own>=1`。
- 自身浏览器按 `--user-data-dir` 识别并扣除。

---

## 3. 逐标签测量结果

### 3.1 主表（run1：SWEEP 3 轮 + PING 3 轮；NULL = 面板内惰性点击基线）

| 栏目 | n | click→内容可见 ms（全值）| 长任务 | 帧 p95(中位) | 帧 max（全值）| >50ms | **RPC/切换** | dlg 节点 | dlg SVG | **内容子树节点**(run3) | ΔLayout | ΔRecalc | ΔScript(s) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **NULL 基线**（不切栏目）| 3 | — | 0 | 16.8 | 20.8 | 0 | **0** | 168（不变）| 0 变 | 不变 | 0 | 2 | ~0.001 |
| 通用设置 | 6 | 35.2 / 12.2 / 33.4 / 11.4 / 34.0 | 0 | 16.8 | 24.3–30.2 | 0 | **0.83** | 168 | 16 | 84 | 1 | 6 | 0.070 |
| 模型 | 3 | 10.3 / 15.9 / 9.0 | 0 | 16.8 | 22.7–30.8 | 0 | **0** | 96 | 11 | 12 | 1 | 5 | 0.035 |
| **插件** | 6 | 53.1 / 36.6 / 34.5 / 37.7 / 16.5 / 7.8 | 0 | **20.4** | 24.7–32.4 | 0 | **9.0** | **421** | 14 | **337** | **4** | 7 | 0.062 |
| Agent 预设 | 3 | 13.7 / 31.2 / 15.0 | 0 | 18.7 | 29.5–30.8 | 0 | **1.0** | 87 | 21 | 3 | 1 | 5 | 0.093 |
| 远程工作区 | 3 | 48.6 / 15.2 / 10.5 | 0 | 17.0 | 22.2–37.5 | 0 | **1.0** | 132 | 9 | 48 | 1 | 5 | 0.051 |
| 分布式控制 · dsh-ssh-gui | 3 | 33.9 / 10.2 / 41.9 | 0 | 17.1 | 27.9–36.9 | 0 | **4.0** | 99 | 9 | 15 | 3 | 7 | 0.044 |
| vision-adam 识图设置 | 3 | 13.7 / 5.0 / 30.4 | 0 | 16.9 | 27.9–28.8 | 0 | **0** | 108 | 9 | 24 | 2 | 6 | 0.047 |
| 子代理模型 | 3 | 9.2 / 29.4 / 14.3 | 0 | 16.9 | 23.5–27.3 | 0 | **0** | 152 | 9 | 68 | 2 | 6 | 0.025 |

**全 48 个窗口：长任务总数 = 0，>50ms 帧总数 = 0。**（dlg 节点/dlg SVG/ΔLayout/ΔRecalc/ΔScript 来自 run1；内容子树节点来自 run3 的对象身份测试 `raw/run3-identity.json`）

### 3.2 每个 RPC 的方法名与耗时（run1 全部窗口合并；ms = min/中位/max）

| 栏目 | RPC/切换 | 方法 | n | 耗时 min/中位/max (ms) |
|---|---|---|---|---|
| 通用设置 | **0.83** | `/api/agentPreset.list` | 5（6 窗中 5 窗）| 4.4 / **11.6** / 98.2 |
| 模型 | **0** | — | 0 | — |
| **插件** | **9.0** | `/usage/timeseries` | 12 | 77.2 / **212.8** / 459.1 |
| | | `/usage/heatmap` | 6 | 77.9 / **273.0** / 506.9 |
| | | `/usage/byModel` | 6 | 95.8 / **315.6** / 665.7 |
| | | `/usage/byProject` | 6 | 113.5 / **354.2** / **791.5** |
| | | `/usage/byDay` | 6 | 87.4 / **148.5** / 240.0 |
| | | `/usage/sessions` | 6 | 245.1 / **272.2** / 504.7 |
| | | `/usage/status` | 6 | 248.3 / **285.3** / 643.4 |
| | | `/usage/summary` | 6 | 17.4 / **24.9** / 121.1 |
| Agent 预设 | **1.0** | `/api/agentPreset.list` | 3 | 7.1 / **15.3** / 68.1 |
| 远程工作区 | **1.0** | `/dsw/machines.list` | 3 | 3.9 / **9.4** / 15.2 |
| 分布式控制 · dsh-ssh-gui | **4.0** | `/ssh-gui/nodes.list` | 3 | 5.7 / 18.1 / 179.0 |
| | | `/ssh-gui/keyref.list` | 3 | 8.4 / 27.2 / 193.0 |
| | | `/ssh-gui/config.get` | 3 | 8.9 / 41.9 / 193.0 |
| | | `/ssh-gui/serial.ports` | 3 | 10.1 / 69.5 / 193.3 |
| vision-adam 识图设置 | **0** | — | 0 | — |
| 子代理模型 | **0** | — | 0 | — |

> 注：`/usage/*` 的 9 次调用来自「插件」栏目下被 dispatch 的 **`dsh-usage` 卡片**（`settings.plugin.item` 槽），`timeseries` 在窗口内出现 2 次。

### 3.3 「再次点击同一标签」（无栏目变化）— REPEAT ×3（子代理模型）

| 窗口 | 内容变化 | 长任务 | RPC | ΔLayout | ΔRecalc | ΔScript |
|---|---|---|---|---|---|---|
| REPEAT#1/2/3 | **无变化** | 0 | **0** | **0** | 2 | 0.011 / 0.089 / 0.041 |

⇒ 点击"已激活"的标签是**接近零成本**（不重挂载、不重发 RPC）。

### 3.4 PING（通用设置 ↔ 插件 来回 3 轮，6 窗）
| 方向 | click→内容可见 | RPC | 内容节点 |
|---|---|---|---|
| → 插件 | 37.7 / 16.5 / 7.8 | **9 / 9 / 9** | 337 |
| → 通用设置 | 33.4 / 11.4 / 34.0 | 1 / 1 / 1 | 84 |

⇒ **「插件」每次切回都稳定重发 9 个 `/usage/*`**（无缓存、无 in-flight 去重），**这是唯一有确定重复性的"贵"**。

### 3.5 「插件」栏目内部子标签（`raw/tabswitch-run5.json`，每次点击前重读坐标）

| 点击目标 | `aria-selected` 是否切换 | dlg 节点 | 内容节点 | dlg SVG | 本窗 RPC |
|---|---|---|---|---|---|
| （初始）| 插件配置 = 选中 | 425 | 341 | 14 | — |
| r1 → **插件列表** | 是 | **174**（列表尚在加载）| 90 | 12 | **`/api/pluginInventory/list` ×1** |
| r1 → 插件配置 | 是 | 425 | 341 | 14 | 0 |
| r2 → **插件列表** | 是 | **1820** | **1736** | **192** | 0（数据已到）|
| r2 → 插件配置 | 是 | 1820 | 1736 | 192 | 0 （见下）|
| r3 → 插件列表 | 是 | 1820 | 1736 | 192 | 0 |
| r3 → 插件配置 | 是 | 1820 | 1736 | 192 | 0 （见下）|

**可确定的结论**
- `插件列表`（`all`）挂载 → **恰好 1 次 `/api/pluginInventory/list`**。~~⇒ 耗时 > 1.8 s~~ **该推断已作废**：run5 只记了"窗口内未 settle"（`ms` 缺失）就外推了上界，属**单样本过度解读**。run6 定点复测（等到 resolve 为止）得 **41.9 ms（本会话首次）／27.6 ms（二次）**，见 §3.7。
- **`插件列表` 完整渲染规模 = 1820 dlg 节点 / 1736 内容节点 / 192 SVG**，对比 `插件配置` 的 425 / 341 / 14 ⇒ **4.3× / 5.1× / 13.7×**。这是本设置页里 DOM 规模最大的面板。
- 全部 6 个窗口：**0 长任务**、`ΔLayout` 1–2、`ΔRecalc` 6–7、`ΔScript` 0.010–0.019 s（与空操作同量级）。

**未能分离的部分（INCONCLUSIVE）**
r2/r3 的「→ 插件配置」点击后 `aria-selected` 已切回「插件配置」，但**内容规模仍为 1820 节点、未回落到 425**，且本窗 `ΔScript` 与空操作同量级 ⇒ 要么该子标签切换存在**状态与渲染不一致**（疑似前一子标签内容未卸载），要么本线器械未能可靠驱动它。**本线无法区分这两种解释**，故子标签的「切换成本」标 INCONCLUSIVE；上面两条「可确定结论」不受影响。

### 3.7 定点裁决（run6）：`pluginInventory.list` 真实耗时 + 「插件」导航 vs「插件列表」的前提澄清

`raw/run6-inventory-rpc.json`（loadavg 3.74，`foreign=0`，单请求等到 resolve，上限 25 s）：

**(A) 点导航「插件」** → **9 个 RPC，且 `pluginInventory.list` 的命中数 = false**（与会话 2 完全一致）：

| 方法 | click→发出 | 发出→响应头 | 响应字节 |
|---|---|---|---|
| `/usage/summary` | +9.5 ms | 30.9 ms | 270 |
| `/usage/timeseries` | +10.3 ms | 94.8 ms | 934 |
| `/usage/heatmap` | +10.6 ms | 96.2 ms | 1430 |
| `/usage/byModel` | +10.8 ms | 120.3 ms | 1091 |
| `/usage/byProject` | +10.9 ms | 163.6 ms | 1039 |
| `/usage/byDay` | +11.0 ms | 223.8 ms | 934 |
| `/usage/timeseries`(hour) | +11.0 ms | 247.5 ms | 245 |
| **`/usage/sessions`** | +11.3 ms | 301.7 ms | **54,062** |
| `/usage/status` | +11.4 ms | 352.3 ms | 312 |

⇒ 9 个请求在 **click+9.5…11.4 ms 内并发发出**，**25–352 ms 内陆续到齐**。**`/usage/sessions` = 54,062 字节**，与 `incident2/plugins-page` 独立实测的 **54,062 字符**逐字节吻合。

**(B)/(C) 点「插件列表」子标签** → `/api/pluginInventory/list`，**HTTP 200**：

| 次 | click→发出 | 发出→响应头 | 响应体读完 | 字节 |
|---|---|---|---|---|
| 首次（本会话冷）| +1.9 ms | **41.9 ms** | 43.4 ms | **21,754** |
| 二次（切走再切回，温）| +1.8 ms | **27.6 ms** | 28.5 ms | 21,754 |

**结论与更正**
- **本线 run5 的 ">1.8 s" 推断作废。** 真实量级是 **几十毫秒**，与 `incident2/plugins-page` 的 HTTP 实测 **p50 9.09 ms** 同量级（本线略高：页内带 fetch 包装 + body 副本读取 + 同期多线并发 loadavg≈3.7）。
- **`pluginInventory.list` 不是"无缓存重扫目录"**（对方证伪，本线采纳）：宿主 `dsh-host-plugin-inventory/lib/index.js:102-114` 遍历**内存** `ctx.loader.entries()`，该文件**无 `fs` 引用**；177 条 / 21,742 B 的 p50 **9.09 ms** 与 9 字节对照的 p50 **10.98 ms** 比值 **0.83** ⇒ **载荷大小无可测代价**，~6 ms 地板是启动+回环+调度。本线 §6 候选 3 的**理由已据此改写**。
- **run5 为何显示未 settle（根因 INCONCLUSIVE）**：run5 只记了 `t0`（在窗口内）而**未记 click→发出的偏移**，若该请求在接近窗口末尾才发出，1800 ms 窗口会在 resolve 前结束。**这是最可能解释，但本线无法从 run5 原始数据证实**（run5 未落盘 issuance 偏移），故标 INCONCLUSIVE；run6 已补齐该字段。

### 3.6 静置（dwell）12 s —— 最大的面板闲着的时候完全空闲

在 **1820 节点 / 192 SVG** 的 `插件列表` 面板静置 12 s（`raw/tabswitch-run5.json → dwell`，并发门禁通过）：

| 指标 | 值 |
|---|---|
| 帧 | 719 帧，p50 **16.7** / p95 **16.8** / p99 **16.8** / max **16.9** ms，>50ms = **0** |
| 长任务 | **0**（0 ms）|
| RPC | **0**（SSE 流亦 0）|
| `ΔScriptDuration` | **0.0375 s / 12 s ≈ 3 ms/s** |
| `ΔRecalcStyleCount` / `ΔLayoutCount` / `ΔLayoutDuration` | **0 / 0 / 0** |
| DOM churn | added / removed / attributes / records 全 **0** |
| CDP `Nodes` / `JSEventListeners` | **0 / 0**（无泄漏、无增长）|

⇒ **本页最重的面板在静置时零活动。** 这一条**撤回**了 run4 中「1820 节点面板存在 ≈70 次/s 持续样式重算」的观察（该观察属瞬态/受并发污染，run5 干净复测为 0，详见 §7 #4）。

---

## 4. 滚动（任务 3）

### 4.1 程序化滚动规格
在设置面板滚动容器 `.VOzbGW_options`（`overflow-y:auto`；`dsh-client-ui-settings-general/lib/client.js:28` CSS、`:162-165` JSX）内，`scrollTop` 每 100ms 推进一档、单向 ≈2.2s，顶↔底往返 3 次（run1：2 个栏目 × 6 段 = 12 窗）。

滚动范围：**插件 851 px**（clientH 746 / scrollH 1597）、**通用设置 74 px**（746 / 820）。

### 4.2 run1（12 段）

| 栏目 | 帧 p95（6 段）| 帧 max | >50ms | 长任务 | **ΔLayout** | **ΔLayoutDuration** | **ΔRecalc** | **页内布局读取** | churn |
|---|---|---|---|---|---|---|---|---|---|
| 插件 | 19.3–23.0 | 20.9–30.9 | 0 | 0 | **0** | **0** | **0** | **0** | 0 |
| 通用设置 | 19.5–22.1 | 23.1–32.4 | 0 | 0 | **0** | **0** | **0** | **0** | 0 |

### 4.3 run2：A/B/C + 同时长「不滚动」对照（正序 A→B→C）

| 臂 | 插件 帧 p95 | 通用设置 帧 p95 |
|---|---|---|
| IDLE（不滚动，同时长）| **16.8** | **16.8** |
| A 原样 | 22.4 / 20.6 | 17.1 / 17.1 |
| B 隐藏壁纸固定层（`position:fixed;pointer-events:none`，1 个 div，`z-index:-1`）| 20.7 / 22.1 | 16.9 / 17.1 |
| C 关闭 `backdrop-filter`（`.VOzbGW_mask`，`blur(2px)`，1 个 div）| **16.8 / 16.9** | 17.1 / 17.0 |

正序看起来"关闭 backdrop-filter 完全消除滚动帧成本"。

### 4.4 run4：**逆序复现（C→B→A）** —— 结论翻转

| 臂（逆序执行）| 插件 帧 p95 | 帧 max |
|---|---|---|
| C 关闭 backdrop-filter | **21.5 / 18.2** | 40.5 / 32.1 |
| B 隐藏壁纸固定层 | **16.9 / 19.0** | 20.1 / 49.2 |
| A 原样 | **25.8 / 19.6** | 37.3 / 33.6 |
| IDLE（不滚动）| 16.9 | 42.2 |

逆序下 **C 并不便宜、B 反而最好**，与正序结论相反。且 run4 的 IDLE 窗自身就出现 p99=32.6 / max=42.2 的抖动。

> 两轮的条件也不完全相同：run4 滚动相位跑在 **1820 节点 / 192 SVG**（插件列表）状态下，run2 跑在 **421 节点 / 14 SVG**（插件配置）状态下。因此这既不是干净的复现、也不是干净的对照。

### 4.5 滚动裁决

| 假设 | 裁决 | 依据 |
|---|---|---|
| 来自**样式写入** | **FAIL（否定）** | run1 全部 12 段 `ΔRecalcStyleCount = 0` |
| 来自**强制布局**（read-after-write）| **FAIL（否定）** | run1 全部 12 段 `ΔLayoutCount = 0`、`ΔLayoutDuration = 0`、页内布局读取计数 = 0；静态侧也确认设置链路**无 scroll 监听、无 ResizeObserver、无 sticky** |
| 来自**大列表重绘** | **FAIL（否定）** | ① 帧成本与列表规模不成比例（851 px 的插件与 74 px 的通用设置帧 p95 同为 ~19–23 ms）；② 12 s 静置下 1820 节点 / 192 SVG 的 `插件列表` 面板 `ΔRecalc=0 / ΔLayout=0 / churn=0`（§3.6）⇒ **该面板不产生持续重算/重绘** |
| 来自**壁纸遮罩层 / backdrop-filter** | **INCONCLUSIVE（正序与逆序矛盾，不可复现）** | §4.3 vs §4.4 |
| 来自**呈现/合成侧** | **未证（倾向）** | 主线程三项全为 0 且无长任务，而帧间隔确有抬升 ⇒ 若有成本则在合成/光栅侧；但本环境为 headless 软合成，**无 GPU**，不可外推到用户 Chrome |

**结论：滚动卡顿的成因在本器械下 `INCONCLUSIVE`。** 可以确定的只有**否定项**：**不是**样式写入、**不是**强制布局、**不是**主线程长任务。

---

## 5. 机制裁决（任务 4）

### 5.1 ① 哪些标签**确实**比基线贵（同窗倍数 + "是否可测差异"）

判据分两类，必须分开说：

**(a) 分类量（完全可复现，可判"确实更贵")**

| 栏目 | RPC/切换（6 或 3 窗全值）| 与 NULL(0) 是否分离 | 内容子树节点 | 相对通用设置 |
|---|---|---|---|---|
| **插件** | **9 / 9 / 9 / 9 / 9 / 9** | ✅ **完全分离** | **337** | 4.0× |
| 分布式控制 · dsh-ssh-gui | 4 / 4 / 4 | ✅ 完全分离 | 15 | 0.18× |
| Agent 预设 | 1 / 1 / 1 | ✅ 完全分离 | 3 | 0.04× |
| 远程工作区 | 1 / 1 / 1 | ✅ 完全分离 | 48 | 0.57× |
| 通用设置 | 0 / 1 / 1 / 1 / 1 / 1 | ⚠️ 6 窗中 1 窗为 0 ⇒ 值域 (0,1) 与基线 {0} 重叠 ⇒ **不严格可分** | 84 | 1.0× |
| 模型 / vision-adam / 子代理模型 | 0 / 0 / 0 | ＝基线 | 12 / 24 / 68 | 0.14× / 0.29× / 0.81× |

**(b) 时间量（不可分辨）**

| 指标 | 与 NULL 的倍数 | 是否可测差异 |
|---|---|---|
| click→内容可见 | 通用设置中位 33.4 ms、插件中位 35.6 ms、子代理模型 14.3 ms —— **值域互相重叠**（插件 min 7.8 ms ＜ 通用设置 max 35.2 ms）| ❌ **不可测差异** |
| 帧 p95 | 16.8（NULL）→ 20.4（插件）：+21%，但 run4 同臂抖动 16.9–29.1 | ❌ 不可测差异（且器械不敏感，§2.2）|
| 长任务 ms | 全部为 0 | ＝基线 |
| ΔScript | 插件 0.062 s、Agent 预设 0.093 s、通用设置 0.070 s —— 插件**不是最高** | ❌ 不可测差异 |
| ΔLayout | 插件 4 vs 其余 1–3 vs NULL 0 | ⚠️ 弱（单次布局 3–15 ms）|

**裁决**：**"确实更贵"成立的是「插件」栏目，判据是"每次切换固定重发 9 个 `/usage/*` RPC（中位 149–354 ms）" 与 "内容子树 337 节点（4.0×）"，而不是任何可测的时间量。** 「插件列表」子标签则在**节点规模**上显著（1820 节点 / 192 SVG）。其余栏目与基线在时间维度上**不可分辨**。

### 5.2 ② 贵的共同点是什么

- ❌ 不是节点数：「Agent 预设」3 个节点仍发 1 个 RPC；「ssh-gui」15 个节点发 4 个；「子代理模型」68 个节点发 0 个。
- ❌ 不是 SVG 数：「Agent 预设」21 个 SVG（最多）却是 0 长任务、最低 ΔScript 之一。
- ❌ 不是「整面板重挂载」：见 5.3。
- ✅ **共同点 = "该栏目自己有取数逻辑，且在每次挂载时无缓存/无 keep-alive 地重新取数"**。
  - 有取数：插件(9)、ssh-gui(4)、通用设置(1)、Agent 预设(1)、远程工作区(1) —— 也正是所有"贵"的栏目。
  - 无取数：模型、vision-adam、子代理模型 —— 0 RPC，读的是客户端 `settingsScope` 镜像快照（`settings.describe` 进程级单例，`bind()` 不走网络）。
  - 交叉印证（静态，`raw/sub-mechanism.md` §5）：4 个栏目**每次切回都重发**；models/plugins 外壳/vision-adam/subagent-model **不重发**。
- ✅ **放大机制 = 无 keep-alive 摊销**：`renderSlot("settings.section", …, {only: active})` ⇒ 切换 = 卸载旧栏目 + 挂载新栏目，**全部成本"切换即付"**（`settings-general:162-165`、`dsh-client-ui-renderer/lib/client.js:845-847`）。

### 5.3 ③ 是否存在「整面板重挂载」/「订阅即重渲染」

#### (a) 整面板重挂载 —— **不存在（实测否定）**

`raw/run3-identity.json`：给面板外壳的 DOM **对象**打 JS 身份标签，逐栏目切换后做 `===` 比对：

| 切换 | `dlg` 同一对象 | `nav` | `header` | `close` 按钮 | `content` 容器 | dlg 节点 | content 节点 | 外壳开销 |
|---|---|---|---|---|---|---|---|---|
| → 通用设置 | ✅ | ✅ | ✅ | ✅ | ✅ | 168 | 84 | **84** |
| → 模型 | ✅ | ✅ | ✅ | ✅ | ✅ | 96 | 12 | **84** |
| → 插件 | ✅ | ✅ | ✅ | ✅ | ✅ | 421 | 337 | **84** |
| → Agent 预设 | ✅ | ✅ | ✅ | ✅ | ✅ | 87 | 3 | **84** |
| → 远程工作区 | ✅ | ✅ | ✅ | ✅ | ✅ | 132 | 48 | **84** |
| → 分布式控制 | ✅ | ✅ | ✅ | ✅ | ✅ | 99 | 15 | **84** |
| → vision-adam | ✅ | ✅ | ✅ | ✅ | ✅ | 108 | 24 | **84** |
| → 子代理模型 | ✅ | ✅ | ✅ | ✅ | ✅ | 152 | 68 | **84** |

- **8/8 次切换中 5 个外壳对象身份全部不变**，且**外壳开销恒为 84 节点**（`dlgNodes − contentNodes = 84` 在 8 种情况下都成立）。
- ⇒ **只有内容子树被替换；面板外壳（header / 关闭 / 操作 / 文档 tab）从不重挂载。** 与静态结论一致（`SettingsPanel` 模块级定义、渲染处无 `key`，`settings-general:96 / :213-219`）。
- 重挂载只发生在**打开/关闭面板**（open `false→true`）。

#### (b) 订阅即重渲染 —— **不存在（否定）**

- 订阅粒度是 **per-slotKey**：`markDirty` 只标脏该 key 的 record，`flush()` 只回调脏 record 的 listeners；全局 `slots/changed` 事件在本部署**无监听方**（静态：`dsh-client-runtime/lib/client.js:36-38`）。
- 三处相关订阅（`settings-general:511-518`、`settings-plugins:1267-1274`、`settings-plugins:1245-1247`）均为带等值早退的 `useSyncExternalStore`，**不产生整树重渲染**。
- 实测支持：REPEAT 窗口（切到已激活标签）**0 RPC、ΔLayout=0、内容无变化**；8 次切换只替换内容子树（5.3a）。
- ⚠️ 本线**未**重复另一条线已否证的 zustand `fireImmediately` 结论；本线只回答"切换标签是否导致整树重渲染"，答案是**否**。
- 一处**轻量**发现（静态，`renderer:743`）：slot outlet 的 `useSyncExternalStore` 订阅闭包每次渲染新建（同文件 locale 面反而做了缓存 `:458-475`）⇒ 每渲染一对退订/订阅。量级小，**非主因**。

#### (c) 每次切换都重发 RPC —— **是（4 个栏目）**
见 §3.2 与 §5.1(a)：`插件`(9)、`ssh-gui`(4)、`通用设置`(1)、`Agent 预设`(1)、`远程工作区`(1)。

---

## 6. 最小修复候选（只出方案，不改代码）

### 候选 1（热面，最小改动面最大收益）：给「插件」栏目下 `dsh-usage` 卡片加**单飞 + 缓存 + 挂载去重**

- **改动点**：`@local/dsh-usage` 客户端卡片（`settings.plugin.item` 槽注册于 `bundle/_local_dsh-usage.js:1232`）；其取数处于 `loadAll` 一簇（静态子代理：`USG:910-920` 七连发 + `:950` sessions(limit 200) + `:965` status）。
- **预期收益**：**消除每次切回「插件」的 9 次 RPC**（实测中位 149–354 ms / 最慢 791 ms）。宿主侧 `session.list` 已知是昂贵端点，9 连发会同时抬高宿主事件循环与客户端 commit 次数。
- **风险**：中低。缓存可能导致数据陈旧 ⇒ 必须保留显式「手动刷新」（该卡片已有 `手动刷新` 按钮）。
- **验收标准**：切「通用设置 ↔ 插件」6 次，每窗 `/usage/*` 调用数 **从 9 降到 0（命中缓存）或 ≤1（首次）**；`raw` 里 `rpc.by_method` 为证据；且卡片仍显示数据（非空态）。
- **热/冷**：**热**（客户端插件，`dsh-client-hmr` 在；但按产品纪律需确认生效路径）。

### 候选 2（热面）：设置栏目**跨切换保留**（keep-alive）或至少**保留各栏目内部 store**

- **改动点**：`renderSlot("settings.section", …, {only: active})`（`settings-general:162-165`）→ 改为对已访问栏目做隐藏保留；或（更保守）让 `ssh-gui`/`远程工作区`/`Agent 预设` 的取数走**已访问即缓存**。
- **预期收益**：消除**全部 4 个栏目的切回重发**（插件 9 + ssh-gui 4 + 通用设置 1 + Agent 预设 1 + 远程工作区 1 = 最多 16 次 RPC/轮满走）。
- **风险**：中高。① 保留会提高常驻内存与常驻定时器数量（`dsh-usage` 有 60s 轮询；`dsh-workspace-enhancement` 有 30s interval + 全文档 MutationObserver）——**保留 = 让这些常驻副作用一直活着**；② 改变 `only:` 语义可能影响其它 slot 使用方。
- **验收标准**：满走一轮 8 栏目后切回，**RPC 总数为 0**；常驻 `JSEventListeners` / 定时器数**不随时间增长**（run1 的 `cdpDelta.JSEventListeners` 在 6 轮内无趋势）；内存无单调增长。
- **热/冷**：**热**（同上）。
- **折中（推荐）**：只对**有 timer/observer 的栏目**做显式卸载，对**纯取数栏目**做保留 —— 即"保留数据、不保留副作用"。

### 候选 3（冷面，纯客户端规模面）：`插件列表` 列表**虚拟化**（不含宿主端点改动）

- **改动点**：**仅客户端** `dsh-client-ui-settings-plugin-inventory`（`…/lib/client.js:285` 注册；inventory tab `:288` order 10）。**宿主侧 `pluginInventory.list` 不动**——已实测其代价为几十毫秒量级、且载荷无关（§3.7），改它没有收益。
- **预期收益**：**全部落在客户端渲染规模上** —— `插件列表` 完整渲染 **1820 dlg 节点 / 1736 内容节点 / 192 SVG**，是通用设置的 **4.3× 节点 / 13.7× SVG**。**不再以 RPC 为理由**：run6 实测 `/api/pluginInventory/list` 仅 **41.9 ms（冷）/ 27.6 ms（温）**、21,754 B，且对方已证伪"无缓存重扫目录"（§3.7）⇒ **宿主端点不是成本点，"缓存"不是本候选的收益来源**。「常驻重算」这一预期收益亦已被 §3.6 实测排除。
- **风险**：中。虚拟化会改变 DOM 结构与滚动行为，可能影响既有 e2e 断言。
- **验收标准（仅客户端规模）**：`插件列表` 挂载后 `dialogNodes` 从 **1820 降到 ≤400**、`dlgSvg` 从 192 降到 ≤40；挂载窗口的 `ΔScriptDuration` / `ΔLayoutCount` 不高于 `插件配置` 的 1.5×；并顺带确认 `插件列表 ↔ 插件配置` 互切时**旧子标签内容确实被卸载**（§3.5 的 INCONCLUSIVE 项）。**不设 RPC 类验收**（宿主端点非成本点）。
- **热/冷**：**冷**（纯前端结构改动：虚拟化 1820 节点列表；不再涉及宿主端点）。
- **附**：同一修复应顺带查清 `插件列表 ↔ 插件配置` 互切时**旧子标签内容是否被卸载**（§3.5 的 INCONCLUSIVE 项）——若确认未卸载，则该面板的常驻节点成本会随访问次数累积。

> **不建议**：以 §4 的 backdrop-filter A/B 为理由去动遮罩层——该 A/B **不可复现**（§4.4）。

---

## 7. 未能归因 / INCONCLUSIVE（必须显式声明）

| # | 项目 | 状态 | 说明 |
|---|---|---|---|
| 1 | **用户报告的 Chrome 侧"切换/滚动小卡顿"本身** | **未能复现** | run1 48 + run2 14 + run4 13 + run5 6 = **81 个带器械的窗口**里**长任务总数为 0、>50ms 帧总数为 0**；click→内容可见 5–53 ms。本线在 headless 下**没有再现**该症状。**这不等于"不存在"**——见 #2。 |
| 2 | **headless 保真度** | **硬边界** | 器械为 `chromium_headless_shell`（**无 GPU、软合成**）、视口 1500×950、DPR=1（`run2.fidelity` 实测读回）。用户环境为 **5120×2880 帧缓冲 / 逻辑 2560×1440 / DPR=2 / 2 CU 核显**（incident2 §三bis 元凶②）。**合成与光栅成本不可外推。** 本线所有"不卡"结论**只对主线程 JS/布局成立**。 |
| 3 | **滚动根因** | **INCONCLUSIVE** | 正序（run2）指向 backdrop-filter，逆序（run4）翻转；两轮面板状态不同（421 vs 1820 节点）⇒ 既非干净复现也非干净对照。仅"非样式写入/非强制布局/非长任务"是否定性的确定结论。 |
| 4 | ~~`插件列表` 面板持续样式重算 ≈70/s~~ | **已撤回** | run4 曾在 1820 节点面板下观测到 ΔRecalc≈154/2.2s；**run5 在同等条件下静置 12 s 复测为 `ΔRecalcStyleCount = 0`**（§3.6）⇒ 该观察**不成立**，判为瞬态/受并发污染。**原结论撤回，不作为任何修复依据。** |
| 5 | **子标签「插件配置」互切的真实行为** | **INCONCLUSIVE** | 修坐标后（run5）`aria-selected` 每次都切换，但 r2/r3 的「→插件配置」后内容仍为 1820 节点、未回落 425（§3.5）。**「状态与渲染不一致」与「器械未能驱动」两种解释无法区分**；需在真实 Chrome 里人工点击确认。 |
| 6 | **绝对性能数字（ms / fps / p95）** | **不可当基线** | 全程与其他 6+ 条线**争抢同一把共享锁**；run1 期间锁被 `incident2-why-these-two` 抢占（`raw/tabswitch-run1.json → release.refused = "not my lock"`）。run1 首尾普查 `foreign=0`，但**未做每窗门禁**；run3/run4/run5 已补每窗 `foreign==0 && own>=1` 门禁。**故 time 类绝对值一律不作基线，只用协议与相对/分类指标。** |
| 7 | **LoAF 的 `blockingDuration` / `styleAndLayoutStart`** | **不可用** | 实测 `blocking: 0`、`styleAndLayout` 为负值（headless 无真实渲染）⇒ 只采用 LoAF 的 `duration`。 |
| 8 | **`模型` 栏目的 provider 行数、`Agent 预设` 的预设行数** | 静态无法确定 | `~/.dsh/presets/` 为空；实测为活体观测（模型 12 节点 / Agent 预设 3 节点）。 |
| 9 | **rAF 帧间隔通道** | **不可用作失速探测器** | §2.2：120/200 ms 注入阻塞产生 0 个 >50ms 帧间隔。**因此本报告不把"帧 p95/p99/max"当作卡顿证据。** |
| 10 | **a11y 乘数（引用他人实测，本线未重测）** | **候选变量，未纳入本线对照** | `incident2/plugins-page` 实测：`--force-renderer-accessibility`（**用户 Chrome 实开**）在 Blink 侧带来 **×1.4–1.8**（导航热点击 4.2→6.6 ms、tab 点击样式重算 0.51→0.89 ms、冷导航重算 2.00→3.18 ms）。**本线器械为 headless_shell，未开该开关**，故本线所有时间量与用户的绝对时间量之间**至少差一个 ×1.4–1.8 的已知乘数**（方向：用户更慢）。这与"用户在 Chrome 里感到小卡顿、而本线 headless 测不到长任务"**不矛盾**——本线的 0 长任务结论**只对主线程 JS/布局成立**。 |
| 11 | **`pluginInventory.list` 的"无缓存"表述** | **已更正（采纳对方证伪）** | 见 §3.7：宿主遍历内存 `ctx.loader.entries()`、无 `fs`、载荷无关；本线原表述（来自静态子代理 `raw/sub-section-cost.md`）**过强，已更正**。 |

---

## 8. 纪律记账（可审计）

| 项 | 记录 |
|---|---|
| 宿主 | PID **301709** 全程未重启、未 pkill、未改产品文件；只读 `ps`/`/proc`/`curl` 读 live bundle |
| 浏览器实例 | **单实例串行**（A→B→C 不并发）；每次 `browser.close()` 只关自己；5 次运行（recon / run1 / run2 / run4 + run3 run5 + pos-debug） |
| 点击范围 | 只点：**「设置」触发器**、**设置面板内栏目导航 8 个标签**、**插件子标签 2 个**、面板内**惰性区域**（基线）；关闭只按 **Escape**。**未点**保存/应用/删除/模型切换/usage 手动刷新/权限开关 |
| 滚动 | 仅对 `.VOzbGW_options` **程序化赋值 `scrollTop`**；未向宿主注入滚轮事件 |
| A/B 注入 | run2/run4 为归因实验，在**本线自己的浏览器页内**临时改 `backdrop-filter` 与 `display`（跑完即恢复，未落盘、未影响宿主与用户浏览器）；已在 §4 声明 |
| 共享锁 | `research-v2/.probe.lock`（mkdir 原子 / 18s 重试 / `rm owner.txt && rmdir`）。**未强占任何他人锁**；**也从未清理过他人锁**——唯一一次清理发生在 2026-09-22 11:26，对象是 **`owner.txt` 已被我自己的 run2 删除、目录为空、无任何 owner 记录**的残留目录（我的 `rmSync(dir)` 抛 `ERR_FS_EISDIR` 所致），已在 §8② 记录。`owner_pid 408162` 那条 `owner.txt` 被替换与本线无关（那是 `incident2-why-these-two` 合法持锁期间，我的 `release` 对它的处置是**拒绝删除**）。run6 起 loadavg 与 `concurrentWith` 已随每轮落盘（`raw/run6-inventory-rpc.json`）。**事故两次均已修复**：① run1 结束时锁已被 `incident2-why-these-two` 持有 → `release` **正确拒绝删除**（`refused: not my lock`）；② run2 因 `rmSync(dir)` 抛 `ERR_FS_EISDIR` 把空目录留在原地 → **本线已即时 `rmdir` 清除**并修复 `lib/lock.mjs`（改用 `rmdirSync` + 空目录兜底），已自测（acquire→release→目录消失；拒绝外来 owner） |
| 并发门禁 | run1：首尾普查（`foreign=0`）；run3/run4/run5：**每窗前后**断言 `foreign==0 && own>=1`。普查按 `/proc/*/exe` 精确统计主进程（**禁用**自匹配的 `pgrep -f`）|
| 二级 subagent | 授权 ≤2，**实际派发 2**（未越额）：① `raw/sub-mechanism.md`（挂载/订阅/重发 RPC 机制）；② `raw/sub-section-cost.md`（逐栏目静态成本画像）。两者均只读、继承沙箱、**未传 `sandbox_permissions`**、未启浏览器、未触碰任何进程 |
| 工具调用 | 全程**未传 `sandbox_permissions`** |

---

## 9. 复算方式

```bash
cd .workspace/lag-fix/incident2/tab-switch
python3 scripts/boot.py > raw/boot.json          # 取 live __DSH_BOOT__ 插件清单
./scripts/fetch-all.sh                            # 抓 50 个 live client bundle 到 bundle/
python3 scripts/parse-registers.py                # 枚举各 slot 注册（含 settings.section ×8）
python3 scripts/analyze.py                        # run1 主表：逐标签 / 同窗倍数 / RPC 方法耗时
python3 scripts/scroll_ab.py                      # run2+run4 滚动 A/B/C 与子标签
node scripts/run.mjs      # 主测量（含 9 臂阳性对照 + 3×8 SWEEP + REPEAT + PING + SCROLL）
node scripts/pos-debug.mjs # 三通道 × 两注入方式 的通道诊断 + CDP trace RunTask 交叉验证
node scripts/run3.mjs     # 面板对象身份测试（整面板重挂载裁决）
node scripts/run5.mjs     # 插件子标签 A/B（修坐标）+ dwell
node scripts/run6.mjs     # 定点裁决 pluginInventory.list 真实耗时（冷/温）+ 「插件」导航 vs「插件列表」前提澄清
```
