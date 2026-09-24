# w04 — 插件加载：bundle 抓取/解析/求值 + 客户端模块加载器 + 清单渲染规模 + 启停重载成本

- 单元：`.workspace/lag-fix/program/w04-plugin-load/`
- 宿主：PID **301709**（`node /home/CNS2026495165/.npm-global/bin/dsh web`，未重启、未改动任何产品文件）
- GUI：`http://127.0.0.1:3080`
- 日期：2026-09-22
- `$D` = `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai`
- 纪律：**只读审计**。全程未改产品文件、未重启宿主、未 pkill、未传 `sandbox_permissions`。

---

## 0. 并发诚实记录与方法学前提

### 0.1 仪器与口径（`.workspace/lag-fix/exec-audit/BATCH-PLAN.md` §五）

| 项 | 本线做法 |
|---|---|
| 并发口径 | **cmdline**（含 `--remote-debugging-pipe` 且不含 `--type=`）；**不用** `readlink(/proc/<pid>/exe)`（本机普遍 EACCES，§五.17/18） |
| 共享锁 | `.workspace/lag-fix/lib/probe-lock.mjs`；只释放自己的锁。probe A/B 成功取锁；probe C 取锁失败（owner = `w08-boot-causal` pid 832923，存活）⇒ **probe C 标 `CONTENDED`**，但 C 的全部结论都是**计数/存在性**判据（与时间无关），不受污染影响 |
| 引擎 | `HeadlessChrome/153.0.0.0`（UA 读回）；`devicePixelRatio` 页内读回 = 1；视口 1440×900 |
| 阳性对照 | 页内 `setTimeout` 注入 120 ms 忙循环 → LongTask **如实报 120.0 ms**（probe A `positiveControl.last = {start:20042.4, dur:120}`）⇒ 通道可用；**未**用 CDP `Runtime.evaluate` 做阳性对照（§五.13/19 的盲区） |
| 帧口径 | 本线**不用**帧计数做立柱（§五.19/20）；只用 **LoAF `scripts[]` 归因 + wall-clock + CDP `Performance.getMetrics`** |
| 未做 | 有头/真实 GPU 合成路径（本机有头 Chromium 100% 启不来，VERDICT §三.4）；headless 下 `Paint`/`CompositeLayers` 不存在 |

### 0.2 本机被测期间**并不安静**（必须打折的地方）

- loadavg 全程 **5.2–8.7**（1 分钟值）；browser 主进程普查 foreignCount **0–4**（兄弟线 `w07-streaming` / `w08-boot-causal` 在跑浏览器）。
- ⇒ **凡"绝对墙钟 ms"一律按 CONTENDED 处理**，只用**比值 / 计数 / 存在性 / 同批配对**判据。
- 宿主 PID 301709 自身空闲期 CPU ≈ **103% of one core**（`host-serve-bench.json → idleBaseline`：24535 ms 墙钟内 25180 ms CPU）——因为**它同时就是本次 agent 会话的运行时**。⇒ **任何用 `/proc/<pid>/stat` 做的宿主 CPU 归因都是空洞的**（burst 28730 ms vs idle 25180 ms，不可分辨）。**该指标的结论一律 INCONCLUSIVE**。

### 0.3 一次被自己抓到的仪器产物（重要）

probe A 全程挂着 CDP `Tracing`（`devtools.timeline` + `disabled-by-default-v8.compile`）：

- 抓到的抓取窗口是 **startTime 1718–13991 ms、responseEnd ≤ 14936 ms**；
- 而 **不挂 tracing**（probe B / incident2 的干净 rig）同一批 50 个 bundle 的 startTime 是 **27–1869 ms**，incident2 是 **56–162 ms**。
- ⇒ **tracing 让抓取窗口膨胀约 100×**（`dsh-client-runtime` 单包 duration 4238 ms）。
- **处置**：probe A 的**墙钟数字全部作废**（已在本文中剔除）；只保留它的**归因类**结果（`EvaluateScript` 逐脚本耗时、请求计数、缓存头）。绝对时序一律取 probe B（无 tracing）与 incident2 的干净 rig。
- 同类自曝：本线最初还把 `.workspace/lag-fix/incident2/plugins-page/audit.md:148` 的"50 个 bundle 在 click−2400 ms（即**打开设置那一刻**）抓取"当成前提——**该表述已被本轮证伪，见 §2.0**。

### 0.4 三条给协议的回写建议（本线 + 子代理 A/B 共同发现）

1. **`owner.txt` 的 `agent` 值不得含空格**：`w07-streaming` 写入的是 `agent=w07-streaming(pid 768958)`。§五.16 规定单行 `key=value` 以空白切分，于是 `agent` 被解析成 `"w07-streaming(pid"`（`pid` 仍是独立 token，**存活判定与被动等待未受影响**）。建议：`agent` 值禁空格，或改 `agent="…"` 引号语法。
2. **`no-cache` 没有验证器 = 连 304 都拿不到**：本线实测 51/51 响应 `cache-control: no-cache` 且 `etag: null` / `last-modified: null`。任何"`no-cache` 只是每次都问一下"的直觉在本部署**不成立**——它等于每次整包重取（`transferSize` 恒为 8,277,805 B）。后续线引用缓存相关结论时请带上"无验证器"这一条。
3. **字节锚点口径统一**：见 §7.4。

### 0.5 一处口径差（供对账）

协调者口径提到"50 个 bundle = **11.9 MB 无压缩**"。本线可复算的权威值是 **8,262,805 B = 7.880 MiB**，且被**两条独立线**确认（本线 `raw/dsh-boot.json` 逐包 HTTP `encodedBodySize` 求和；子代理 B `sub-b/raw/bundle-size-summary.json` 按 `exports["./client"]` 直接量磁盘文件）。该路由**不做压缩**（`readFile` + `res.end`，只发 `content-type`/`cache-control`），所以"无压缩"与 `encodedBodySize` 是同一个量。**11.9 MB 疑似含了 shell 资产（`index-ClqxG24t.js` 399,361 + `vendor-D22_Mp1f.js` 744,872）或另一口径；下轮引用请以 8,262,805 B / 7.880 MiB 为准，或说明 11.9 MB 的构成。**

---

## 1. 结论速览

| # | 范围 | 判定 | 一句话 |
|---|---|---|---|
| ①-0 | **前提修正**：50 个 bundle 的抓取时刻 | **FAIL（原说法错）** | 50 个 bundle 全部在**页面加载（启动）**时抓取，**不是**"打开设置那一刻"；打开设置路径的 bundle 抓取数 = **0** |
| ①-1 | 启动路径 **抓取** 成本 | **PASS** | 每次页面加载 **50 个请求 / 8,262,805 B (7.880 MiB)**；`@local/dsh-pptmaster` 单包 **4,096,057 B = 49.5%**；top-5 = 68.5% |
| ①-2 | 启动路径 **解析(compile)** 成本 | **PASS（且是负面结果）** | 主线程 V8 编译 ≈ **0.67–0.91 ms** / 8.26 MiB；trace 逐脚本 `EvaluateScript` 合计 **5.3–5.6 ms**（51 个脚本，每个 0.10–0.20 ms）⇒ **"4 MB 包解析很贵"是错觉** |
| ①-3 | 启动路径 **求值/物化** 成本 | **PASS** | 集中在少数包：去重后 6 次冷启动共 **1137.7 ms** 长帧脚本时间，其中 `@local/dsh-pptmaster` **559.2 ms (49%)**、`dsh-client-connection` 238.2、`dsh-client-locale` 113.3、`ui-conversation` 66.6、`wallpaper` 56.0 |
| ①-4 | 打开设置路径的 bundle 成本 | **PASS** | 打开设置（1 条 RPC）+ 巡游 9 个设置面（含"插件"导航 10 条请求）⇒ **plugin-bundle 请求总数 = 0** |
| ①-5 | 是否可延迟到真正需要时 | **FAIL（当前不可）** | 已有 `immediately` 两级声明（11 行 true / 39 行 false），但 shell 启动循环**无条件 import 全部 50 行**，且 `assertEntriesActive` 硬断言"全部 active" |
| ①-6 | `no-cache` 是否导致重复读盘 | **PASS（但量级被证伪）** | 代码上**每请求都 `readFile`**；实测 4.1 MB 读盘 **min 0.30 ms / p50 0.59 ms**（页缓存），一整趟 50 文件 ≈ **2.2 ms** ⇒ **磁盘不是代价，8.26 MiB 重传才是** |
| ②-1 | 加载器缓存/去重（会话内重复求值？） | **PASS（无重复）** | `loadCache` memo + `factories` 重复注册守卫 + `pendingArrival` 在途去重；实测每次加载 **51 个 `/plugins/` 请求、unique 51、0 重复** |
| ②-2 | 版本失效策略 | **FAIL（不存在有效策略）** | `invalidate()` 唯一调用者是 HMR `rebuilt`；`?rev=<内容 sha1>` 是**唯一**失效手段，而服务端**完全忽略 rev** 且回 `no-cache` + **无 ETag/Last-Modified** ⇒ rev 形同装饰，浏览器也无法做条件请求 |
| ②-3 | 会话内是否重复抓取/求值 | **PASS（不重复）** | 见 ②-1；且 `register()` 对二次注册直接抛错，全程 0 次抛错 |
| ③-1 | 清单渲染结构规模 | **PASS** | panel 内 **1398 元素 / 178 SVG / 177 卡片**；逐卡斜率 7.898 元素 + 1.006 SVG（R²=0.9999） |
| ③-2 | 简报「1820 节点 / 192 SVG」 | **FAIL（无法复现）** | 任何口径都不是它；`provenance unknown`，以实测为准 |
| ③-3 | 虚拟化的真实收益 | **PASS（可量化）** | 帧 **2.05 ms（独占窗配对）～4.80 ms（阶梯）**；客户端 CPU 5.8–6.2 ms；**占总交互 6.6–15.5%**；固定项（宿主 RPC）占 **67.6%** |
| ③-4 | 是否值得做虚拟化 | **FAIL（不值得）** | `>50 ms` 帧 = 0、LongTask = 0；换不来可感知帧改善；代价是 6 类语义面（含 `data-plugin-count` 与 `getByRole`） |
| ③-5 | `content-visibility: auto` 替代方案 | **PASS（实测，候选）** | 1 行 CSS：layout −1.47 ms / recalc −1.23 ms / 帧 −2.0 ms，DOM/SVG/监听器/无障碍**逐项不变**；代价 = 滚动 TaskDuration ×1.48 |
| ④-1 | 设置里有没有启停开关 | **FAIL（没有）** | inventory 面板是**只读**视图（`:63`），宿主 `dsh-host-plugin-inventory` **只有 `Remote("list")`** |
| ④-2 | 启停是否需宿主重启 | **FAIL（不需）** | cordis loader 热 dispose/construct + `dsh-client-modules` `processOne` 实时增删图行 |
| ④-3 | 启停后客户端是否必须整页重载 | **PASS（必须）** | 图是启动快照；host 从不推 `graph` 帧；客户端 `case "graph": break;` 丢弃 |
| ④-4 | 改配置是否整页重载 | **FAIL（不会）** | 全树 `location.reload` 命中 0；走 `settings/document-updated` 局部刷新 |
| ④-5 | 能否热载 | **PASS（工程可行）已有生产先例** | `dsh-cordis-client-runner/lib/client.js:548-556` 证明"无 graph row 也能 `__ModuleLoader__.load` + `loader.create`"；但**本轮建议不做** |

---

## 2. 范围 ①：两条路径上的 bundle 抓取 / 解析 / 求值成本

### 2.0 前提修正（必须先说，否则后面全错）

**简报里的「50 个 lazy client bundle 在"打开设置"那一刻集中抓取解析」= FAIL（错）。**

它们是**页面加载时**抓取的。三组独立证据：

| 证据 | 内容 |
|---|---|
| **E1 页面资源时序（无 tracing，incident2 干净 rig）** | `.workspace/lag-fix/incident2/plugins-page/raw/click2-raw-*.json → scenarios.P1.navSeries[0].data.resources`：50 个 `/plugins/*/client.js` 的 `startTime` 全在 **56.3–161.7 ms**，而同一轮的锚点 `anchor.tClick = 5740.3 ms`（页面时钟）⇒ 抓取发生在 click **前约 5.6 秒**，即**页面加载期** |
| **E2 本线 probe B（4 次加载，无 tracing）** | 50 个 bundle 的抓取窗口 `[min startTime, max responseEnd]` = 324.7–2505.6 / 142.8–891.7 / 27.4–1869.0 / 209–7784.7 ms（**4 次全部在启动期**，且次次完整 50 个） |
| **E3 结构性（代码，决定性）** | shell 启动循环对 **`manifest.plugins` 全量** `loader.create({name})`：`$D/dsh-web-frontend/dist/assets/index-ClqxG24t.js`（Vite 压缩产物，line 93）`runPluginBoot` @ **byte 397194**、`manifest.plugins.map(c=>c.id)` @ **byte 398004**、`assertEntriesActive` @ **byte 398254**。每个 `create` → `internal.import(id)` → `arriveGraphRow` → `arrive()` 追加一个 `<script>`。**与用户是否打开设置无关** |

**打开设置路径的实测（probe A + probe C）**：

- 打开设置入口：`totalRequests=1`（`/api/agentPreset.list`），**pluginBundleRequests = 0**
- 巡游 9 个设置面（`通用设置 / 模型 / 插件 / Agent 预设 / 远程工作区 / dsh-ssh-gui / vision-adam / 子代理模型` + 关闭）：**每一窗 pluginBundleRequests = 0**，而 `插件` 导航那一窗共 10 条请求（9 个 `/usage/*` + 1 个 `pluginInventory.list`）——**依旧 0 个 bundle**
- 结构性理由：**没有"还没抓的" bundle 了**。`graphRows` 在构造期一次性由 `__DSH_BOOT__` 建成（`$D/dsh-client-modules/lib/client.js:164-171`），50 行在启动时全部 `import` 并物化（`loadCache` 命中），所以设置面无论怎么点都不会再发 `/plugins/` 请求。

> **对既有文字的更正**：`incident2/plugins-page/audit.md:148` 与 `:209` 的"冷开设置 = 50 个 bundle + 4.1 MB pptmaster 在那一刻抓取并解析"应当改写为"**那 50 个 bundle 在页面加载时就已经抓完**"；该句其余部分（`no-cache`、`:480` `readFile`）成立。

### 2.1 启动路径：抓取

**清单与字节（`raw/tier-split.json`、`raw/dsh-boot.json`）**

| 项 | 值 |
|---|---|
| 图行数 | **50**（`__DSH_BOOT__.entries.length = 50`，`rev = 06d6b47449f1`） |
| 每次加载的 `/plugins/` 请求 | **51** = 50 个 bundle + 1 个 `/plugins/events`（SSE）；`unique = 51`、**0 重复** |
| 总字节 | `encodedBodySize` 合计 **8,262,805 B = 7.880 MiB** |
| 最大单包 | `@local/dsh-pptmaster` **4,096,057 B = 4.00 MB = 49.5%** |
| top-5 合计 | 5,661,655 B = **68.5%**（pptmaster / ui-conversation 437 KB / client-runtime 389 KB / client-connection 351 KB / ui-trajectory 351 KB） |
| 中位单包 | **39,235 B** ⇒ 一整页 ≈ **210 个中位插件** |

**`immediately` 两级声明已经存在，但第二级没有被延后**（`raw/tier-split.json`）

| tier | 行数 | 字节 | 占比 |
|---|---|---|---|
| `immediately: true` | **11** | 1,253,631 B (1.20 MiB) | 15.2% |
| 非 immediate | **39** | **7,009,174 B (6.68 MiB)** | **84.8%** |

shell 里**两波机制其实已经有了**：`prefetchImmediateTier()`（`index-ClqxG24t.js` byte **397139**）先串行预热 immediate tier（`await i`），随后 `runPluginBoot` 才创建全部 50 行。
但由于 `assertEntriesActive`（byte 398254）要求**每一行都 active**，第二波**不是"按需"、而是"紧接着立刻全做"**。
（补充：`prefetchImmediateTier` 的前置条件 `__DSH_TRANSPORT__?.loadBundle === undefined` 在本部署**成立**——全仓只有 `$D/dsh-client-connection/lib/client.js:10410` 读 `__DSH_TRANSPORT__`，**没有任何文件给它赋值**，它是 fixture/test 钩子 ⇒ 生产走 `defaultLoadBundle`，prefetch 分支确实执行，且与启动循环靠 `pendingArrival` 去重、不产生重复请求——实测 0 重复。）

**服务端/传输侧（`raw/host-concurrent-bench.json`，CONTENDED）**

- 50 请求**并发**突发（就是浏览器的真实模式）：wall **min 180.1 / p50 211.7 / max 1668.5 ms**；对照：5 个 5–6 KB 小包并发 **min 24.1 ms**。
- 单包串行 min 之和 **1952.8 ms**（per-request 地板很高：5,492 B 的 `ui-reference` min 也有 72.8 ms；9 字节 RPC 的 min 是 12.97 ms）⇒ 这些绝对数被争用支配，**只能作量级参考**。
- 与干净 rig 互证：incident2 无 tracing 批观测到抓取窗口 **56–162 ms**（loadavg 4.2–6.8）。

### 2.2 启动路径：解析（V8 compile）—— **负面结果，很重要**

| 指标 | 值 | 来源 |
|---|---|---|
| `V8CompileDuration`（每次加载） | **0.91 / 0.67 / 0.75 / 0.86 ms** | probe B `metricsDeltaFromCommit`，4 次加载 |
| CDP trace `EvaluateScript` 合计（51 个脚本） | **5.3–5.6 ms** | probe A（归因可用，绝对时长不可用） |
| 单个 bundle 的 `EvaluateScript` | **0.10–0.20 ms**（pptmaster 0.12 ms） | 同上 |
| `v8.compile` 事件合计 | **2.03 ms** | 同上 |

**结论**：8.26 MiB 的 JS 在**主线程上**的解析/编译代价 ≈ **0.7–1 ms（metrics）/ 5–6 ms（trace 口径）**。
机制：每个 bundle 的顶层只是一个 `window.__ModuleLoader__.load({id, factory})` 调用，**模块体全在箭头函数里**，V8 只做 **lazy pre-parse**（真正的编译发生在物化该函数时），且流式/后台编译线程吃掉了大部分。
⇒ **"4 MB 的 pptmaster 拖慢启动是因为解析贵"是错觉**；它的代价在**传输**与**物化**。

### 2.3 启动路径：求值 / 物化（哪个包最贵）

物化 = `factories.get(id)(require)` 执行模块体副作用（含 CSS 注入），`$D/dsh-client-modules/lib/client.js:223-244`。它发生在启动循环的 `await l.create(...)` 里，**不落在 `EvaluateScript` 上**，因此用 **LoAF `scripts[]` 的 `invoker` 归因**来量化。

**A. 本线 probe B load-1（冷，含 tracing=false）长帧归因**（`boot-clean-*.json → loads[0].loaf`）

| 长帧 invoker | 脚本耗时 | 帧时长 | blocking |
|---|---|---|---|
| `SCRIPT[src="/plugins/@local/dsh-pptmaster/client.js?rev=45d20726c34d"].onload` | **80.1 ms** | 81.2 ms | 31.1 ms |
| `TimerHandler:setTimeout` | 73.7 ms | 73.9 ms | 23.8 ms |
| `SCRIPT[src="/plugins/@local/dsh-wallpaper/client.js?rev=826d9217a8fc"].onload` | **56.5 ms** | 60.1 ms | 7.1 ms |
| `MessagePort.onmessage` | 20.7 ms | 62.0 ms | 11.5 ms |

**B. 跨 6 次冷启动的合并归因（incident2 干净 rig 全部 raw，按 `(start, dur, bundle)` 去重）**

> 去重是必须的：incident2 的探针用 `buffered:true` 反复读同一批条目，同一帧在多个 scenario 里被重读（原始计数 pptmaster 出现 26 次、去重后 8 次）。**去重前 1802.6 ms / 去重后 559.2 ms**，两者都不应直接当"每启动成本"，应除以启动次数。

| bundle | 去重后长帧脚本合计 | 条数 | 每启动折算 ≈ |
|---|---|---|---|
| **`@local/dsh-pptmaster`** | **559.2 ms** | 8 | **≈ 93 ms** |
| `@deepseek-ai/dsh-client-connection` | 238.2 ms | 4 | ≈ 40 ms |
| `@deepseek-ai/dsh-client-locale` | 113.3 ms | 2 | ≈ 19 ms |
| `@deepseek-ai/dsh-client-ui-conversation` | 66.6 ms | 5 | ≈ 11 ms |
| `@local/dsh-wallpaper` | 56.0 ms | 1 | ≈ 9 ms |
| `@local/dsh-btw` | 35.9 ms | 4 | ≈ 6 ms |
| `ui-settings` / `ui-trajectory` / `cordis-client-runner` | 30.5 / 21.8 / 16.2 ms | 5/4/3 | ≤5 ms |
| **合计** | **1137.7 ms** | 36 | ≈ **190 ms** |

**三条可引用的结论**：
1. **`@local/dsh-pptmaster` 一家占归因脚本时间的 49%**，且是**唯一**同时占据字节榜首（49.5%）与耗时榜首的包 —— 它是启动路径的头号靶点。
2. **字节大 ≠ 贵**：`@local/dsh-wallpaper` 只有 **31,803 B**（0.4% 字节）却贡献 56.0 ms（5%）；反之 `dsh-client-ui-conversation` 437 KB 只 66.6 ms。**排序必须按实测而不是按体积。**
3. 物化的总时长（≈190 ms/启动，只统计落在 >50 ms 帧里的部分，**是下界**）与 **主线程 JS 总时长**（probe B `ScriptDuration` 47–109 ms/加载）**同一量级** ⇒ 启动的主线程成本里，插件物化是**主要可归因项**，而解析几乎为零。
4. **第二靶点：`@local/dsh-wallpaper` 是唯一显式声明 `immediately:true` 的第三方插件**（`raw/dsh-boot.json`：`{"id":"@local/dsh-wallpaper", …, "immediately":true, "inject":[client-runtime, client-locale, ui-theme, ui-settings]}`），只有 **31,803 B** 却贡献 **56.0 ms / 出 9 ms 每启动** 的物化长帧。它有显式声明、且注入 `ui-theme`/`ui-settings` ⇒ **不建议作为延后靶点**，但值得单独 profile 它在 `apply()` 里做了什么（本线未做）。

**启动路径的主线程总量（probe B，4 次加载，CONTENDED）**

| 指标 | load1 | load2 | load3 | load4 |
|---|---|---|---|---|
| `TaskDuration` | 477.0 ms | 179.1 | 209.8 | 259.7 |
| `ScriptDuration` | 109.3 ms | 47.1 | 49.6 | 69.7 |
| `LayoutDuration` | 35.4 ms | 1.1 | 2.2 | 1.6 |
| `RecalcStyleDuration` | 19.3 ms | 12.3 | 17.1 | 18.4 |
| `TaskOtherDuration` | 298.1 ms | 111.2 | 130.8 | 153.3 |
| `[data-dsh-boot]` 消失 | 2629 ms | 927 | 1905 | 7822 |

⇒ **主线程工作量只有 180–480 ms（其中 JS 47–110 ms），但 boot overlay 寿命 0.9–7.8 s** ⇒ 启动耗时**主要是等待（传输 + 50 次 `import()` 往返 + 争用），不是主线程**。这一条与本线之外的观察（`TaskOtherDuration` 占最大头）一致，但**绝对墙钟因争用不可引用**。

### 2.4 `no-cache` 是否导致重复读盘 / 重复传输

**服务端行为（代码，只读确证）**
- `serveBundle`：`$D/dsh-client-modules/lib/index.js:466-487`；`:480` `const body = await readFile(path);`；`:483` `"cache-control": "no-cache"`；**只发 `content-type` 与 `cache-control`** ⇒ **没有 `ETag`、没有 `Last-Modified`、没有 `Content-Length`（chunked）**。
- URL 由 `graphRow` 生成：`/plugins/${id}/client.js?rev=${rev}`（`:151-160`），`rev = shortHash(sha1(bundle 内容)).slice(0,12)`（`:143-145`、`:408-418`）。
- **服务端完全忽略 `?rev=`**：`serveBundle` 只用 pathname 反查 `clientPath`，再读**当前**文件 ⇒ 陈旧 rev URL 也返回新内容（子代理 B 实测 `?rev=DEADBEEF0000` 仍 200 全量）。

**实测**

| 问题 | 结论 | 证据 |
|---|---|---|
| 每次请求都读盘吗？ | **是**（代码路径） | `index.js:480` |
| 读盘贵吗？ | **不贵**：4.1 MB `readFile` **min 0.302 ms / p50 0.587 ms / p90 1.588 ms**（n=60）；50 个文件一整趟 **≈ 2.2 ms** | `raw/readfile-bench.json` |
| 浏览器会复用吗？ | **完全不复用**：第 2、3 次加载 50 个包**全部 `fromDiskCache = false`、全部 `status 200`、`transferSize` 合计 8,277,805 B == `encodedBodySize` 8,262,805 B**（差值 15,000 B 即响应头） | `raw/boot-parse-eval-*.json → load2 / load3` |
| 为什么连 304 都拿不到？ | 51 个响应**全部** `cacheControl: "no-cache"` 且 **`etag: null` / `lastModified: null`** ⇒ 符合规范的缓存必须"每次使用前再验证"，而**没有任何验证器可用于条件请求** ⇒ 只能整包重取 | 同上 `netLog` |

⇒ **回答**：`no-cache` 确实导致每次请求都 `readFile`（且从不复用），**但磁盘那部分是 2 ms 级的噪声**；真正的浪费是 **每次页面加载重传 8.26 MiB + 浏览器重新解析/重新物化全部 50 个包**。

### 2.5 范围 ① 逐条判定

| 判据 | 判定 | 依据 |
|---|---|---|
| 50 个 bundle 在"打开设置"时抓取 | **FAIL** | §2.0 E1/E2/E3；打开设置 0 个 bundle 请求 |
| 能否量化启动路径的抓取成本 | **PASS** | 50 请求 / 8,262,805 B；并发突发 min 180 ms（CONTENDED） |
| 能否量化启动路径的解析成本 | **PASS（负面）** | 0.67–0.91 ms（metrics）/ 5.3–5.6 ms（trace） |
| 能否量化启动路径的求值成本 | **PASS** | LoAF 归因 1137.7 ms / 6 次启动，pptmaster 占 49% |
| 哪几个包最贵 | **PASS** | pptmaster ≫ connection > locale > conversation > wallpaper |
| 是否可延迟到真正需要时 | **FAIL（当前不可）** | `runPluginBoot` 全量 create + `assertEntriesActive` 硬断言（`index-ClqxG24t.js` byte 397194/398004/398254） |
| `no-cache` 是否导致重复读盘 | **PASS（但代价在传输不在磁盘）** | `index.js:480/483`；`readfile-bench.json`；`load2/load3` 全量重传 |
| 启动绝对墙钟 | **INCONCLUSIVE** | 争用（loadavg 5.2–8.7、foreign 0–4）+ tracing 膨胀 100×；只有比值/计数可用 |

---

## 3. 范围 ②：客户端模块加载器的缓存与去重行为

全部依据 `$D/dsh-client-modules/lib/client.js`（浏览器半边）。

### 3.1 四张状态表

| 表 | 行 | 作用 |
|---|---|---|
| `loadCache` | `:150` | **物化结果 memo**（`{id, exports, styles, edges}`），写入点 `:239`，命中检查 `:224-225` / `:256-257` / `:265-266` |
| `factories` | `:152` | 已注册（已到达）的 factory；`register` `:190-194`，**二次注册直接抛** `duplicate factory registration ... (bundle executed twice without invalidate?)` |
| `pendingArrival` | `:155` | **在途 script 加载去重**：`:198-199` 命中即复用同一个 promise；`:200` 若已 `loadCache`/`factories` 则直接 `Promise.resolve()`；`:203-205` finally 清理 |
| `materializing` | `:157` | 物化重入守卫（CJS 无法交付部分导出 ⇒ 循环即致命），`:229` `:230-242` |

`graphRows`（`:158`）在**构造期一次建成**（`:164-171`），**没有任何增删 API** —— 这是范围 ④ 的关键约束。

### 3.2 会话内会不会重复求值？**不会**

- `materialize(id)` 首行查 `loadCache`（`:224-225`），命中直接返回同一 record ⇒ 模块体副作用（含 CSS 注入）**只跑一次**。
- `import()` 先查 `loadCache`（`:265-266`）⇒ 已物化模块直接给 `exports`。
- `arrive()` 对已在途/已注册/已物化的 id 短路（`:198-200`）。
- **实测**：每次加载 `/plugins/` 请求 **51 条、unique 51、0 重复**（`boot-parse-eval-*.json` 三次加载均如此）；`register()` 的重复注册异常**一次都没触发**（无 console error）。
- 顺带量化 `claimStyles`（`:133-139`，每次物化跑**两条全文档查询**）：`style:not([data-plugin])` **0.0060 ms/次**、`style[data-plugin="…"]` **0.0020 ms/次**，页内 `style` 标签 93 个 ⇒ 50 次物化合计 **≈ 0.4 ms**。**不值得立项**（登记为负面结果）。

### 3.3 版本失效策略：**事实上不存在有效策略（FAIL）**

| 机制 | 现状 |
|---|---|
| URL 内容寻址 | `?rev=<sha1-12>` 由 `graphRow`（`$D/dsh-client-modules/lib/index.js:151-160`）写入，rev 是 bundle 内容的短哈希（`:143-145`、`:408-418`） |
| 但服务端**忽略 rev** | `serveBundle`（`:466-487`）只用 pathname 反查路径再读**当前**文件 ⇒ rev 不是服务端寻址的一部分 |
| 浏览器侧 | 因为 `no-cache` + **无验证器**，rev 也**没能**换来任何复用（§2.4 实测 0% 命中） |
| `invalidate(id)` | `client.js:279-284`，只清 `factories` + `loadCache`；**唯一调用者**是 `$D/dsh-client-hmr/lib/client.js:44`（HMR `reload()` 内） |
| `prefetch(id)` | `client.js:272-278`；**唯一调用者**是 `$D/dsh-client-hmr/lib/client.js:45`（全仓唯一 `prefetch` 调用点） |
| graph 变化 | 宿主侧 `onGraphChanged` 只喂宿主自己的 watch；**从不向浏览器推 `graph` 帧**；浏览器侧即便收到也 **`case "graph": break;`**（`$D/dsh-client-hmr/lib/client.js:66`）直接丢弃 |
| 结论 | **有效的失效手段只有两个**：① 整页重载（重建全部 50 行）；② HMR 对**启动时已在图里**的 id 做 `invalidate → prefetch → entry.refresh()`。**新插件无法在运行中的页面里出现** |

### 3.4 范围 ② 逐条判定

| 判据 | 判定 |
|---|---|
| 会话内是否会重复求值 | **PASS（不会）** |
| 会话内是否会重复抓取 | **PASS（不会；0 重复请求实测）** |
| 重复注册是否有守卫 | **PASS（`:190-194` 抛错）** |
| 是否有版本失效策略 | **FAIL（有 rev 但服务端忽略 + 浏览器 0 命中；真正有效的只有整页重载与 HMR）** |
| 是否有 graph 增删 API | **FAIL（`graphRows` 构造期固定，`:158` `:164-171`）** |
| `claimStyles` 全文档查询是否是成本项 | **PASS（负面：0.4 ms/50 次，不值得立项）** |

---

## 4. 范围 ③：插件清单渲染规模与虚拟化收益

> 由二级子代理 A 独立执行（**唯一拿到独占锁 `CONTENDED=false` 的批次**），完整报告 `sub-a/audit.md`（66 KB / 778 行）+ `sub-a/raw/analysis.json`（321 KB）+ 3 份 raw。**本节不重复其推理，只给结论与它们的证据指针。**

### 4.1 渲染规模（同窗实测，与历史基线精确一致）

| 口径 | 元素 | SVG | `<li>` | `<button>` | `[data-plugin-entry]` | 可聚焦 |
|---|---|---|---|---|---|---|
| **inventory 面板内** | **1398** | **178** | **177** | **177** | **177** | **178** |
| 文档级 | **2352** | **253** | 180 | 231 | 177 | 247 |

- 每卡片 **7.898 元素 + 1.006 SVG**，逐卡剂量斜率 `+7.844 元素/卡`（**R² = 0.9999**）。
- **⚠️ 简报里的「1820 节点 / 192 SVG」无法复现**：子代理 A 的任何口径都不是它（panel 1398/178；文档 2352/253，也不同于 incident2 的 2423/260——两者口径不同）。**`provenance unknown`，以实测为准。**
- **把历史标为 INCONCLUSIVE 的"每卡片 1 个监听器"升级为逐卡斜率确证**：`JSEventListeners` **恰好 +1.000/卡、R² = 1.0000、截距 = 0**（机制仍未验证）。

### 4.2 这一下交互的成本构成（分母）

| 项 | 值 | 占比 |
|---|---|---|
| click → 177 卡可见 | **31.0 ms（中位）/ 114.1 ms（max）**，n=8 | 100% |
| ↳ **等宿主 `pluginInventory.list`** | **20.95 ms** | **67.6%**（历史 72.4%，互证） |
| ↳ 客户端提交窗（RPC 返回 → 177 条可观测） | 13.1 ms | 42% |
| ↳ **其中"挂载 177 张卡片"的纯增量**（同页 A/B 对照） | Script **+2.90 ms** / RecalcStyle **+0.34 ms** / Layout **−0.32 ms（≈0）** | ≤10% |

### 4.3 虚拟化的真实收益（同窗对照，逐条）

| 口径 | 省下 | 证据强度 |
|---|---|---|
| 帧间隔（blockGap 中位）177 → 24 | **2.05 ms** | **probe-c 独占窗直接配对 n=8** ⭐ |
| 帧间隔（中位）177 → 22 | **4.80 ms** | probe-b 阶梯，各 n=5 |
| 客户端 CPU 合计 | **5.8–6.2 ms**（script 2.67 + recalc 1.12–1.76 + layout 2.00–2.08） | 斜率 0.0380–0.0407 ms/卡 × 153–159 |
| DOM | **−1653 节点 / −1194 元素 / −153 监听器（−85%/−86%）** | probe-c 配对 + 斜率吻合 |
| **占总交互** | **6.6%（配对）～15.5%（阶梯）** | 分母 31.0 ms |
| **它碰不到的部分** | **固定项（宿主 RPC）67.6%** | — |

**阈值判据（"是否值得"的关键约束）**：**241 个测量窗中 `>40 ms` 帧 = 0、`>50 ms` 帧 = 0、LongTask/LoAF = 0**；`>25 ms` 帧 **18 个，100% 落在"终态 = 177 张"的臂上**，其中 **16 个在 a11y 条件**（a11y 24% 窗口 vs 默认 2%）。挂载 177 张把"恰好一帧"从 ~16.8 ms 抬到 **21.6 ms（a11y 下 ~27.0 ms）** ⇒ **越过 16.7 ms 帧预算，但从未接近 50 ms 卡顿阈值**；**N ≤ 88 时完全不可见**。
⇒ 子代理 A 的 a11y 乘数实测：**只在逐卡项上**（script ×1.20 / recalc ×1.29 / layout ×1.16 / 帧斜率 ×2.38）⇒ **用户在真实 Chrome（开 a11y）下虚拟化收益约为本报告 headless 默认批的 ×1.2–1.3**。

### 4.4 判定：**虚拟化 = 建议不做（FAIL「值得做」）**，替代方案 `content-visibility`

**不建议做全套 virtualizer**，三条理由各有实测支撑：
1. **量级不够**：≤4.8 ms，占这一下交互 ≤15.5%，而 **67.6% 的成本在宿主 RPC**（与 N 完全无关）——虚拟化碰不到天花板。
2. **不跨越任何阈值**：`>50 ms` 帧 = 0、LongTask = 0。**虚拟化换不来任何用户可感知的帧改善**，因为本来就没有可感知的帧问题。
3. **代价与收益不成比例**：需处理 **6 类语义面**，其中 `data-plugin-count` 语义（`client.js:136`：是 **slice 之前**的 `filteredEntries.length`）与 `getByRole` 名称（`:160-168`）会**破坏现有测试与审计口径**（含本线与 incident2 的 rig）；**键盘可达性从"差但完整（177 个 tab stop）"变成"不完整"**。

**替代方案（实测）**：`content-visibility: auto; contain-intrinsic-size: auto 54px` —— **1 行 CSS，回滚 = 删一行**：
- N=177 时 **layout −1.47 ms（×0.526）/ recalc −1.23 ms（×0.560）/ TaskDuration −2.60 ms / 帧 −2.0 ms（18.8→16.8）**
- = 虚拟化 layout 收益的 **71%**、recalc 的 **70–110%**、帧的 **42–98%**
- **DOM 元素 / SVG / 监听器 / 无障碍语义逐项不变**（1385 / 177 / 177 相同）
- 代价：**滚动 `TaskDuration` ×1.48（5.851→8.662 ms）**——成本从"挂载"挪到"滚动"
- ⇒ **候选但同样不构成性能立项（≤2.6 ms）**；`content-visibility` / `IntersectionObserver` 在本仓库 **0 使用**（100+ bundle 全扫描）

### 4.5 实现成本澄清（防止被当成收益证据）

`@deepseek-ai/dsh-client-ui-trajectory` **已内置 TanStack Virtual**（`useVirtualizer` `lib/client.js:2281`、`VIRTUALIZATION_THRESHOLD = 100` `:3158`、`overscan 12` `:3159`、`data-virtual-position` `:4731`、`scrollToIndex` `:4506-4516`）。**177 > 100**，按该门槛策略"本就该走虚拟化分支"。
⇒ 这是**"容易做"的证据，不是"值得做"的证据**；而且 Trajectory 的虚拟行是 **表格行 `tr`**（`role=table`，天然有 `aria-rowindex`），inventory 是 `<ul>/<li>` + **CSS Grid 2 列扁平结构**（`:11`），**迁移不是复制粘贴**。

### 4.6 顺带发现的既有缺陷（与虚拟化正交，建议单独修）

- **`aria-controls` 悬空 177/177（实测，`expandedTrue = 0`）** —— `client.js:155/164/197` 的 `aria-controls ↔ id` 从未对上；WCAG 4.1.2。修复收益：无障碍正确性（不是帧）。
- **177 个 tab stop**（每卡是真 `<button>`，`:160`）——可对照 `dsh-client-ui-settings-plugins/lib/client.js:456-485` 已有的 tablist 方向键模式改 roving tabindex。

### 4.7 范围 ③ 逐条判定

| 判据 | 判定 |
|---|---|
| 结构规模可复核（1398 元素 / 178 SVG / 177 卡片） | **PASS** |
| 简报「1820 节点 / 192 SVG」 | **FAIL（无法复现，provenance unknown）** |
| 每卡线性、斜率可测 | **PASS**（R² 0.95–1.0000；监听器斜率恰 1.000/卡） |
| 177 卡片造成可检出的卡顿（>50 ms） | **FAIL（未复现）**；但 `>25 ms` 帧 18/241 存在且全在 N=177 臂 |
| 虚拟化绝对收益 | **PASS（可量化）**：2.05–4.80 ms，占总交互 6.6–15.5% |
| 虚拟化是否值得立项 | **FAIL（不值得）** |
| `content-visibility` 替代方案收益 | **PASS（实测）**：layout −1.47 / recalc −1.23 / 帧 −2.0 ms，语义零变更；**代价 = 滚动 ×1.48** |
| `content-visibility` 在 **a11y 下**的收益 | **INCONCLUSIVE（子代理 A 自曝的最大未闭合项）** —— A/B 只在默认条件下测过；建议下一轮第一优先复跑（同脚本加 `--force-renderer-accessibility`） |
| 绘制 / 合成维度 | **INCONCLUSIVE**（headless 下 `Paint`/`CompositeLayers` 不存在） |

---

## 5. 范围 ④：插件启停 / 配置变更的重载成本

> 由二级子代理 B 执行，完整报告 `sub-b/audit.md`（362 行）+ `sub-b/raw/`（9 个证据文件）。该线因共享锁被 `w08-boot-causal` 持有而**主动放弃浏览器运行**，标 `CONTENDED`，全部结论来自源码只读 + HTTP 只读抓取。摘要如下（每条带 file:line）。

### 5.1 逐条判定

| # | 判据 | 判定 | 关键证据 |
|---|---|---|---|
| 1 | 设置里**有没有**插件启停开关 | **FAIL（没有）** | `$D/dsh-client-ui-settings-plugin-inventory/lib/client.js:63` 文档即写 "Render the **read-only** current Loader inventory"；卡片唯一控件是展开 `:160-168`；`启用/停用` 只是标签 `:183-187`；文件内 `checkbox`/`role=switch`/`toggle` **0 命中**；宿主 `$D/dsh-host-plugin-inventory/lib/index.js:72` **只有 `Remote("list")`**，`list()` `:102-114` |
| 2 | 启停是否**需要宿主重启** | **FAIL（不需要）** | cordis loader 热 dispose/construct：`$D/cordis-plugin-loader/lib/index.js:706-723`（`:720` `options.disabled=true`、`:721` `tree.write()`）、`:389-392`/`:503-543`（refresh/init/start = 重新启用）；`$D/dsh-app-boot/lib/index.js:755-778` `watchUserPatches` 对 `cordis.patch.yml` 做 config-HMR；`$D/dsh-client-modules/lib/index.js:421-437` `processOne` **实时增删图行**（`:427` delete / `:429-436` set）→ `:363-376` 重组合图 |
| 3 | 启停后**客户端是否必须整页重载** | **PASS（必须）** | ① 图是启动快照（`$D/dsh-client-modules/lib/client.js:168-171`）+ `__DSH_BOOT__` 按 index 请求注入（`lib/index.js:209-250`，`:244-248`）；② 新 id 必失败：`import()` 抛 `:269` `not a row in the boot graph`、`prefetch()` 抛 `:276` `not a graph entry`；③ **无任何通道送新图**：宿主 `$D/dsh-client-hmr/lib/index.js:145-152` 只发 `rebuilt`，浏览器 `client.js:66` **丢弃 `graph` 帧**（实测 `GET /plugins/events` 3 秒仅 1 帧连接期 `graph`，rev `06d6b47449f1` 与 HTML 注入的一致） |
| 4 | 改插件**配置**是否整页重载 | **FAIL（不会）** | 全树 `location.reload` / `navigation.reload` **命中 0 个文件**；走 `$D/dsh-settings/lib/index.js:523-544` `emitDocumentUpdated` → `$D/dsh-client-ui-settings/lib/client.js:1342` `mirror.load()` 局部刷新 |
| 5 | **能否热载** | **PASS（工程可行，已有生产先例）** | `$D/dsh-cordis-client-runner/lib/client.js:548`（`modules.invalidate`）→ `:549-554`（**直接 `globalThis.__ModuleLoader__.load({id, factory})`**）→ `:555-556`（`loader.create`）→ `:566`（`fiber.await`）；卸载 `:628-630`。与 `$D/dsh-client-modules/lib/client.js:267-270` 的分支顺序吻合（**已注册 factory 时 import 不需要 graph row**） |

### 5.2 阻塞点（把 5.1#5 的配方搬到 boot 插件上缺什么）

① 新图无通道（协议要加 `graph` 广播 + 客户端 `graphRows` 合并）；② `prefetch` 对未知 id 必抛（`:276`）；③ 样式归属：`removeOwnedStyles`（`dsh-client-hmr/lib/client.js:26-29`）/ `claimStyles`（`client.js:133-139`），同 id 重载必须显式删旧 tag；④ `graphRows` 无增删 API（`:158`/`:164-171`）；⑤ boot 条目**无 pluginId→entryId 表**（需扫 `loader.entries()`，参考 `dsh-client-hmr/lib/client.js:23-25` `findEntry`）；⑥ 失败 UX 只有启动期一次 `assertEntriesActive`。

### 5.3 一条容易被串味的近亲（必须点名）

`dsh-cordis-host-runner/lib/index.js:1434-1445` + `dsh-client-ui-cordis/lib/client.js:903-913` 的 stop/remove 是**面板动态插件**，**不是** loader/boot 插件。它只能证明"页内热载在本产品是常规能力"，**不能**用来论证 boot 插件可热载。

### 5.4 子代理 B 的自曝更正（值得保留）

- **被推翻**：B 原本继承"`pkgMeta` 缓存 never expires ⇒ 插件集变化要重启宿主"（`$D/dsh-client-modules/lib/index.js:80-85` 注释）。被 `:421-437 processOne()` 推翻：脏 name 每次重新求值，不合格 `:427` 删行、新 name `:429-436` 建行 ⇒ **宿主的图确实随启停实时增删、不需重启**；被永久缓存的只是**包元数据**（`:377-404`，尤其 `:391` 的"不是 client 包"否定结论）。⇒ **"必须重启/刷新"是真的，但根因在客户端（boot 快照图 + 无更新通道），不在宿主缓存。按旧说法去修宿主缓存 = 白干。**
- **被降级**：曾以为"HMR 会推新图，客户端只是没处理" —— 反证：宿主**根本不发** graph 帧（`dsh-client-hmr/lib/index.js:145-152`），修法必须同时改两侧。
- **自纠错留档**：字节统计脚本先后得到 48/50=7.82 MiB、49/50=7.625 MiB 两个矛盾中间态，修正后 **50/50 = 7.880 MiB**（与范围 ① 的 8,262,805 B 吻合）。下游引用请用 `sub-b/raw/bundle-size-summary.json`。

---

## 6. 候选清单（收益 / 风险 / 验收 / 回滚 / 热面 or 冷面）

> 纪律：所有收益以**比值 / 为零 / 占比**表述（BATCH-PLAN §四）；绝对 ms 一律标 CONTENDED。

### W04-C1（**推荐**，最小、可回滚）：给 bundle 路由补上缓存验证语义 —— **冷面**

- **现状**：`$D/dsh-client-modules/lib/index.js:481-485` 只发 `cache-control: no-cache`，**无 `ETag` / 无 `Last-Modified`**；URL 已带内容 sha1（`:151-160`）。实测：第 2/3 次加载 50 个包 **0% 磁盘缓存命中、`transferSize` 合计恒为 8,277,805 B**。
- **改法 A（保守）**：保留 `no-cache`，补 **`ETag`**（取自 `stat` 的 `size+mtimeMs`，**不要**取自 `?rev=`）⇒ 浏览器每次仍发条件请求，命中返回 **304 空体**，语义与今天完全一致（"每次使用前再验证"），但省掉 8.26 MiB。
- **改法 B（收益最大）**：因 rev 已是内容哈希，改 `cache-control: public, max-age=31536000, immutable` ⇒ 二次加载 **0 传输**。**注意**：此时"内容变了但 `rebuilt()` 未被调用 ⇒ rev 不变 ⇒ URL 不变 ⇒ 服务陈旧代码"成为真实风险（今天 `no-cache` 会兜住它）。
- **收益**：每次页面加载省 **8,262,805 B（7.880 MiB）** 传输 + 50 次全量响应体；本机实测并发 50 请求突发 **min 180.1 ms** → 预期降到本地缓存命中的 **10–30 ms** 量级（**待复测，标预期不标实测**）。
- **风险**：A 低（语义不变）；B 中（陈旧 rev 会发陈旧代码，须确认 `rebuilt()` 是内容变化的唯一入口，`lib/index.js:322-324` 的注释声称如此）。**若走 B，建议同时保留 A 的 ETag 作为兜底。**
- **验收**：同一浏览器第 2 次 `page.reload()` 后，50 个 bundle 的 `transferSize` 之和 **8,277,805 B → ≤ 5 KB（A）/ 0 B（B）**；`encodedBodySize` 不变；`[data-dsh-boot]` 消失时间**不劣化**；HMR 触发后 URL 的 `rev` 变化且拿到新内容。
- **回滚**：把 header 改回 `no-cache`（单处、单行），冷面重启。
- **面**：**冷面**（`dsh-client-modules` 是宿主插件，需重启 `dsh web`）。

### W04-C2（**推荐**，靶点最清晰）：把 `@local/dsh-pptmaster`（4.00 MB / 49.5% 字节 / 49% 物化耗时）移出启动关键路径 —— **冷面，依赖 C3**

- **现状**：它是**字节榜首**（4,096,057 B）**且**是**物化耗时榜首**（去重后占归因脚本时间 559.2/1137.7 ms）**且**它没有声明 `immediately`（`/home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-pptmaster/package.json` 的 `dsh.client` 无 `immediately`），却仍在启动时被抓取并物化。它是**按需使用的 PPT 工具插件**。
- **收益（本线实测，非外推）**：启动少 **4.00 MB（48.5% 字节）** + 少 **≈80 ms** 冷启动长帧脚本时间（probe B load-1 LoAF：`SCRIPT[pptmaster].onload` = **80.1 ms**，其中 blocking **31.1 ms**）。
- **风险**：中。① 用户第一次真正用到 PPT 功能时会付一次性加载延迟；② 只读查看已确证它的客户端半边在模块体里注册了**会话面 slot**（`/home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-pptmaster/lib/client.js` 尾部：`slots.register({name:"conversation.chat.turnTail", …}, OfficePptTurnDelivery)`，并导出 `OfficePptCreateRow / OfficePptHeroActions / OfficePptInputAccessory / OfficePptTurnDelivery / OfficePptUpdateRow`）⇒ **延后会让会话里的 PPT 入口短暂缺失**（不是设置面，设置面与它无关）。`dsh.client.inject` 声明了 5 个依赖包（client-connection / client-locale / client-runtime / ui-conversation / ui-tool）。
- **验收**：启动期 `/plugins/@local/dsh-pptmaster/client.js` 请求数 = **0**；首次使用 PPT 功能时才出现 1 次请求且功能正常；**会话视图的 PPT 入口在加载完成后与今天逐项一致**；启动总字节 ≤ **4.2 MiB**；`assertEntriesActive` 不抛。
- **回滚**：恢复其在启动期加载。
- **面**：**冷面**（条目声明/宿主侧），且**必须与 C3 一起做**才成立。

### W04-C3（**推荐，条件性**）：把非 `immediately` tier 的第二波延后到首帧之后 —— **冷面**

- **现状**：两级声明**已经存在**（11 行 `immediately:true` / 1.20 MiB vs **39 行非 immediate / 6.68 MiB / 84.8%**），shell 也已有 `prefetchImmediateTier()` 预热第一波（`index-ClqxG24t.js` byte 397139）；但 `runPluginBoot` 紧接着**无条件** `manifest.plugins.map` 创建全部 50 行（byte 398004），且 `assertEntriesActive`（byte 398254）**硬断言每一行都 active**。
- **改法**：把第二波改为 idle 调度（`requestIdleCallback` / 首帧后），并让 `assertEntriesActive` 对"尚未创建"的行放行。
- **收益**：启动关键路径少 **39 个请求 / 7,009,174 B（6.68 MiB）**；若同时做 C2（pptmaster 单独提前），则第二波剩 **38 个请求 / 2,913,117 B（2.78 MiB）**。
- **风险**：**高**。① 插件 UI 会"后长出来"；② 改的是 `dsh-web-frontend` 的 Vite 产物契约（`apps/web` shell），`assertEntriesActive` 是启动正确性的唯一断言；③ 可能把"启动慢"换成"启动后陆续抖动"。**在拿到"首帧 → 全部 active"的真实分布之前不建议直接做。**
- **验收**：首批只抓 11 行；`[data-dsh-boot]` 消失时间**不劣化**（比值判据）；最终 50 行全部 active 且 0 console error；`assertEntriesActive` 不再抛。
- **回滚**：恢复全量 create。
- **面**：**冷面**（重建 `dsh-web-frontend` dist）。

### W04-C4（**建议不做**）：客户端虚拟化「插件列表」；改用 `content-visibility: auto` —— 见 §4

- **虚拟化收益实测上界 4.80 ms（占总交互 15.5%）**，固定项（宿主 RPC 20.95 ms / **67.6%**）它碰不到；**`>50 ms` 帧 = 0**，因此**换不来可感知帧改善**；代价是 6 类语义面（`data-plugin-count` 口径 `client.js:136`、`getByRole` 名称 `:160-168`、177 个 tab stop、CSS Grid 2 列扁平结构 `:11`、展开态 IDREF、`<li>` 列表语义）。
- **替代候选（可做，但同样不构成性能立项）**：`content-visibility: auto; contain-intrinsic-size: auto 54px`（**1 行 CSS**）。
  - **收益（实测）**：layout **−1.47 ms（×0.526）** / recalc **−1.23 ms（×0.560）** / `TaskDuration` **−2.60 ms** / 帧 **−2.0 ms**；DOM 元素/SVG/监听器/无障碍语义 **逐项不变**。
  - **风险**：低—中。① 滚动 `TaskDuration` **×1.48（5.851→8.662 ms）**，成本从"挂载"挪到"滚动"；② **在用户真实 a11y 条件下未测**（子代理 A 自曝的最大未闭合项）⇒ **必须先补 a11y 复跑再落地**；③ 需确认 `contain-intrinsic-size` 与既有 CSS（`client.js:11` 的 2 列 grid、`@media (width<=680px)`）叠加后行高不漂移。
  - **验收**：N=177 挂载时 `LayoutDuration` 与 `RecalcStyleDuration` **不劣化**（比值判据，目标 ≤0.6×）；DOM 元素/SVG/监听器计数**逐项不变**（1385/177/177）；`data-plugin-count` 仍 = `"177"`；滚动时 `TaskDuration` 不超过 **×1.6**；a11y 条件下重跑同脚本给出同向结论。
  - **回滚**：删掉那一行 CSS（**热面即可**，客户端 bundle 由 `no-cache` 提供，刷新生效）。
  - **面**：**热面**（客户端 CSS）。

### W04-C4b（**建议做，与性能正交**）：修 `aria-controls` 悬空 + 177 个 tab stop

- 实测 `aria-controls` **177/177 全部悬空**（`expandedTrue = 0`），源 `sub-a` 六.3(g) / 本文 §4.6；源文件 `$D/dsh-client-ui-settings-plugin-inventory/lib/client.js:155/164/197`。WCAG 4.1.2 正确性缺陷，**与帧无关**。
- **验收**：任意卡片展开后 `document.getElementById(aria-controls) !== null`（177/177 可解引用）；`getByRole` 名称集合不变。
- **风险**：低（纯属性）；**面**：热面。

### W04-C5（**建议不做，仅登记**）：消除 `readFile` 重读盘 / 收窄 `claimStyles`

- `readFile`：实测 4.1 MB **min 0.302 ms**、一整趟 50 文件 **≈ 2.2 ms**（页缓存）⇒ 优化空间在上限 ~2 ms，且会引入 `stat`/mtime 失效的第二真相。
- `claimStyles` 双查询：**0.008 ms/次 × 50 = 0.4 ms** ⇒ 同样不值得。
- **验收（若仍要做）**：上述两项不得使 `pluginInventory.list` 或启动时间劣化（BATCH-PLAN §四"性能类一律以比值判据"）。
- **面**：冷面。

### W04-C6（**采纳子代理 B 的 C-1/C-2**，推荐）：把"插件集变化需刷新页面"从静默失败变成可解释状态

- `clientModules.graph().rev` 只读加进 `pluginInventory.list`（`$D/dsh-host-plugin-inventory/lib/index.js:102-114`），页面比对 `window.__DSH_BOOT__.rev`，不一致即提示"插件集合已变化，请刷新页面"。
- **验收**：`pluginInventory.list` 仍应在 incident2 实测的 **27.6–41.9 ms** 量级 —— **不得复活已撤回的 ">1.8 s 无缓存" 说法**。
- **面**：热面（客户端）+ 冷面（宿主只读字段）。

---

## 7. adversarial 自检 / 未验证清单

### 7.1 本线被自己推翻或降级的判断

1. **被证伪（简报前提）**："50 个 lazy client bundle 在**打开设置那一刻**集中抓取解析" → 实为**页面加载时**抓取（§2.0）。附带更正 `incident2/plugins-page/audit.md:148`/`:209`。
2. **被推翻（本线仪器）**：probe A 挂 CDP tracing 时抓到的抓取窗口（1718–14936 ms）比无 tracing 口径（27–1869 ms）**膨胀约 100×**；probe A 的**墙钟数字全部作废**，只保留归因类结果。
3. **被降级（量级直觉）**："`no-cache` ⇒ 重复读盘 ⇒ 贵" → 读盘实测 **0.30 ms/4 MB**，一整趟 2.2 ms；真正的浪费是 **8.26 MiB 重传**（§2.4）。
4. **被降级（量级直觉）**："4 MB 的 pptmaster 贵在解析" → 主线程 `V8CompileDuration` 全程 **0.67–0.91 ms**；它贵在**传输**与**物化**（§2.2 vs §2.3）。
5. **被降级（统计口径）**：把 incident2 原始 LoAF 直接求和会得到 pptmaster **1802.6 ms / 26 条**；**按 `(start,dur,bundle)` 去重后是 559.2 ms / 8 条**（`buffered:true` 被多 scenario 重读）。**任何引用 incident2 LoAF 汇总的下游都必须先去重。**
6. **被推翻（宿主 CPU 归因）**：本想用 `/proc/301709/stat` 的 utime+stime 把 8.26 MiB 的 CPU 代价归给 bundle 路由；实测**空闲 24535 ms 窗口内宿主就烧了 25180 ms CPU**（宿主同时是本次会话的运行时）⇒ **该指标结构性不可用，标 INCONCLUSIVE**。

### 7.2 本线**没有**验证的东西

- **有头 / 真实 GPU 合成路径**：本机有头 Chromium 100% 启不来（VERDICT §三.4）⇒ 所有"启动/打开设置"的主线程结论**只对 headless 成立**；`Paint`/`CompositeLayers` 维度缺失（INCONCLUSIVE）。
- **用户真实会话的启动绝对墙钟**：本机全程 loadavg 5.2–8.7、foreign 0–4；probe B 的 927–7822 ms 分布**不能**当作"用户冷启动要 N 秒"。
- **`@local/dsh-pptmaster` 的延后安全性**：已只读确证它在模块体里注册**会话面 slot**（`…/@local/dsh-pptmaster/lib/client.js` 尾部 `slots.register({name:"conversation.chat.turnTail"…})`），但**没有**验证"延后 X 毫秒后这些入口是否会在用户已可见的会话里补上"（需要改产品才能测，本线只读）。
- **CDP trace `EvaluateScript` 与 `V8CompileDuration` 的口径差**（5.3 ms vs 0.9 ms）：本线只报告两者，**未做口径仲裁**；两者都指向"解析不是瓶颈"。
- **`no-cache` 改动后的实际收益**：C1 只有**现状实测**（0% 复用、8,277,805 B 恒定），**没有做修复后的复测**（本线是只读审计，不改产品文件）。
- **`immediately` 语义在其它部署下的用法**：只核了本部署的 50 行 + 86 个 `dsh.client` 声明。
- **判定 ③（虚拟化）**由子代理 A 独立给出，本线未复核其原始数据。

### 7.3 并发诚实记录（逐探针）

| 探针 | 锁 | foreign（cmdline 口径） | loadavg | 标记 |
|---|---|---|---|---|
| probe A `boot-parse-eval` | 取得（pid 757555） | start 0 / end 2 | 6.81 → … | **挂 tracing，墙钟作废**；归因可用 |
| probe B `boot-clean` | 取得 | start 3 / end 3 | 6.82 → 8.70 | 4 次加载全部捕获；**绝对墙钟 CONTENDED** |
| probe C `settings-tour` | **未取得**（`w08-boot-causal` pid 832923 存活） | start 3 / end 3 | 7.63 → 7.21 | **CONTENDED**；结论全为计数/存在性，不受影响 |
| `host-serve-bench` / `host-concurrent-bench` | 不适用（纯 HTTP） | — | 5.71–8.7 | **CONTENDED**，只取 min 与量级 |
| `readfile-bench` | 不适用（纯文件读） | — | 6.0–6.78 | 只取 min |

---

## 8. 证据索引

| 文件 | 内容 |
|---|---|
| `raw/dsh-boot.json` | 服务端 HTML 注入的 `globalThis["__DSH_BOOT__"]` 原文（50 行 / rev `06d6b47449f1` / 逐行 `immediately`+`inject`） |
| `raw/index.html` | `GET /` 原文 —— 只含 **2 个** parser-blocking 插件脚本（client-modules / client-runtime）+ shell module |
| `raw/tier-split.json` | 按 `immediately` 分级的行数/字节/时长（11 行 1.20 MiB vs 39 行 6.68 MiB） |
| `raw/boot-parse-eval-*.json` | **probe A**：trace 逐脚本 `EvaluateScript`、3 次加载的请求计数与缓存头、`openSettings` 窗口、阳性对照。**墙钟作废** |
| `raw/boot-clean-*.json` | **probe B**：无 tracing 的 4 次加载（资源时序 / metrics delta / LoAF / longTask / boot overlay 寿命） |
| `raw/settings-tour-*.json` | **probe C**：9 个设置面巡游逐窗请求计数（**plugin-bundle = 0**）+ `claimStyles` 查询成本（+ `CONTENDED`） |
| `raw/readfile-bench.json` | `readFile` 逐包耗时（4.1 MB：min 0.302 / p50 0.587 ms；50 文件一趟 ≈ 2.2 ms） |
| `raw/host-serve-bench.json` | 宿主 CPU 归因尝试（**INCONCLUSIVE**，空闲即 103% 单核）+ 首包/小包/RPC 延迟 |
| `raw/host-concurrent-bench.json` | 50 请求并发突发（min 180.1 / p50 211.7 ms）+ 5 小包对照（min 24.1 ms）+ 逐包 min |
| `tools/lib-w04.mjs` | cmdline 普查 / 锁 / 启动 / 资源时序公用库 |
| `tools/probe-w04-boot.mjs` | probe A |
| `tools/probe-w04-clean.mjs` | probe B |
| `tools/probe-w04-tour.mjs` | probe C |
| `tools/readfile-bench.mjs` · `tools/host-serve-bench.mjs` · `tools/host-concurrent-bench.mjs` | 宿主侧三个只读基准 |
| `sub-a/audit.md` + `sub-a/raw/` | 范围 ③（插件清单渲染规模与虚拟化，子代理 A） |
| `sub-b/audit.md` + `sub-b/raw/` | 范围 ④（启停/配置变更重载成本，子代理 B，362 行 + 9 个证据文件） |
| `.workspace/lag-fix/incident2/plugins-page/raw/click2-raw-*.json` | 外部互证：50 个 bundle 的干净 rig startTime 56.3–161.7 ms（**该目录 `audit.md:148` 的解读已由本线更正**） |
