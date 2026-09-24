# W08 · DSH Web GUI 冷启动时间线审计（启动 → 首屏可交互 → 侧栏会话列表就绪）

> 线：`w08-boot`｜产出目录：`.workspace/lag-fix/program/w08-boot/`｜日期：2026-09-22
> 对象：`http://127.0.0.1:3080/`（宿主 PID 301709，服务中，**全程只读，未重启/未 pkill/未改产品文件**）
> 器械：Playwright + `chromium_headless_shell-1148`（CDP trace / Resource Timing / 页内 PerformanceObserver）、
> 直接 HTTP RPC 计时、`/proc` 计数器、静态字节与代码取证。
> **所有结论以同窗对照/比值为判据**；绝对 ms 一律标注并发条件与器械，且因 **headless 无 GPU 合成**只作**下限**。

---

## 0. 一句话结论（TL;DR）

**首屏被两类完全不同的东西先后卡住，且二者互相独立：**

| # | 阻塞源 | 量级（本机实测，受污染口径） | 归属 | 结论强度 |
|---|---|---|---|---|
| **A** | **启动期把全部 50 个 client bundle 都拉下来并逐个建 fiber，之后才 `mountApp`**（含 4.1 MB 的 PPT 插件、设置页专属包、用量包…） | app chrome 挂载 **930 ms**（最平静窗）/ 1.12–16.4 s（受污染窗）；**10/10 相位**挂载时刻都**紧贴"最后一个 bundle 到达"之后 22–151 ms** | 客户端（网络 + 启动协议） | **已确证（因果：延迟单包 ⇒ 挂载同比位移 +686.5 ms）** |
| **B** | **`session.list` 的延迟有灾难性并发尾巴**：单发 TTFB **0.24–3.85 s**（同窗 A-B-A，N=9），**4 路并发 ⇒ 13.3–18.2 s（4–10×）**；宿主被自审并发压住时 23–25 s，**30 s 客户端超时 ⇒ 侧栏永久空白**，直接 HTTP 亦曾 >90–120 s 不返回。返回体 **505 KB**，传输 <1 ms ⇒ **100% 是服务端计算/排队** | 侧栏会话行就绪 **15.29 s**（最平静窗），受污染窗**永不出现** | **宿主服务端**（与浏览器无关；纯 HTTP 即复现；**并发敏感**） | **已确证（同窗 A-B-A 并发对照 + GUI 内 + 进程外）** |

> **两条阻塞互相独立**：`session.list` 在 **954 ms 就已发出**（早于挂载），与 bundle 加载**并行** ⇒ 侧栏慢不是被 A 拖的。修复 B 不会改善 A，反之亦然。

**首屏可见轮廓（FCP 130–185 ms）不被二者阻塞**；被卡住的是"可交互的应用外壳"与"侧栏有内容"。
**`host.describe` 是串行就绪闸门**，`session.list` 与 `workspace.list` 在其后并发发出——所以 B 不是被 A 拖慢的，是纯并行分支上的独立阻塞。
**主线程解析/求值不是瓶颈**：启动窗（0 → 挂载）内实测 `TaskDuration 534 ms`、`ScriptDuration 153 ms`（见 §3）⇒ 首屏的时间几乎全部花在"**等字节**"与"**等宿主**"上。

---

## 1. 器械、口径与自证（先说清可信边界）

### 1.1 并发条件（决定绝对值能否引用）
- 全部相位 `windowValid = CONTENDED`：窗口起止快照的**外部浏览器主进程数 3–7**（口径 = cmdline 含 `--remote-debugging-*` 且不含 `--type=`，绝不使用 `readlink(/proc/<pid>/exe)`，见 BATCH-PLAN §五.17/.18）。
- `loadavg` 全程 **6.5 → 9.7**。用户的 Chrome（PID 494362，带 `--force-renderer-accessibility`）与 snap Firefox（547226）常驻。
- 同批另有兄弟线在跑（`w04-plugin-load`：`bundle fetch/parse/eval cost on boot vs settings-open`、`clean boot timeline (no tracing)`；`w07-streaming`）。**我未与其争抢**：所有浏览器窗口先取共享锁（`.workspace/lag-fix/lib/probe-lock.mjs`，单行 owner.txt + 原子 rename、任何读取失败一律 ALIVE），拿不到就轮询等待，绝不回收他人锁。
  ⇒ **本报告的绝对 ms 全部是"宿主被并发自审压着"的口径，只作下限**；**结论全部建立在同一窗口内的相对位移上**。
- 锁与普查不覆盖机器级负载：**锁独占 ≠ 机器独占**（这是本批最大的口径陷阱，已如实标注）。

### 1.2 仪器自证（每条都做了阳性/阴性对照）
| 项 | 结果 |
|---|---|
| **LongTask 通道阳性对照** | 每个相位都用**页内 `setTimeout` 注入 120 ms 忙循环**（绝不用 CDP `Runtime.evaluate` 注入，BATCH-PLAN §五.13/.19）⇒ **9/9（做了对照的相位）如实报出 `120.0 ms`**，通道有效；`bootwindow` 相位未含对照，故不计入分母 |
| **阴性对照** | 未注入时启动期只出现 3 个长任务（见 §2.1 / §2.2b），无虚假长任务 |
| **DPR 自证** | 每相位页内读回 `devicePixelRatio=1` / `innerWidth×innerHeight=1600×900`；命令行**未使用** `--force-device-scale-factor`（BATCH-PLAN §五.10） |
| **trace 类别** | 含 `disabled-by-default-devtools.timeline`（否则 `RunTask` 条数=0，§五.19⑤）；实测 `runTaskCount>0` |
| **时钟口径** | 全部时间线锚在**页内 `performance` 时钟**（Resource Timing + 页内 marks），避免跨进程/跨时钟域污染（trace 的 `ts` 曾被外部时钟域事件拉低到 4.6 小时跨度，已弃用于绝对定位） |
| **引擎** | Blink（`headless_shell`），UA 由页内读回；无 GPU 合成、无 Paint/Composite ⇒ **"不卡"类结论只对主线程 JS/布局成立** |
| **正样本一致性** | `session.list` 的 `decodedBodySize` 在 **14 个独立样本**上为 **504,073–505,215 B（差 <0.25%）**，而同一批的延迟跨 0.24 s ↔ >120 s ⇒ 体量与延迟解耦，抓取不是盲区 |

### 1.3 仪器限制（诚实清单）
- **3 个相位因浏览器中途死亡而失败**（`Target page, context or browser has been closed`：`rep3-warm`、`causal-bdelay(首轮)`、`bootwindow-2`），内存充足（43 GB 可用、`/dev/shm` 31 GB 仅用 205 MB）⇒ 疑似环境级进程杀手，非 OOM。已改用**最小序列**重取关键因果实验（`bdelay` 单独成对），其余相位取自已落盘的前序序列。
- `/proc/301709/io` **EACCES** ⇒ 无法把宿主 CPU 与磁盘 I/O 分离（见 §4.6 末段，标 INCONCLUSIVE）。
- 未测真实 **TTI（输入→呈现延迟）**：headless 无合成/绘制口径 ⇒ 本报告用"**app chrome 挂载**"作 TTI 的**代理**，并显式声明其局限。

---

## 2. ① 冷启动时间线（分段 · 时长 · 阻塞归属）

### 2.1 主时间线（`rep1-cold`，本批最平静窗口；仍为 CONTENDED，绝对值为下限）

| 段 | 起 → 止 (ms) | 时长 | 内容 | **阻塞归属** |
|---|---|---|---|---|
| S0 文档请求 | 0 → 69.6 | 69.6 | `GET /`；TTFB 68.8（宿主每请求 `readFile(index.html)`+`JSON.stringify` 50 条图） | 宿主 HTTP（受污染口径） |
| S1 boot 注入解析 | 69.6 → 90.3 | 20.7 | 内联 queue 脚本 + 2 个 **parser-blocking classic script** 的发现与取回（72.9/73.1 → 79.1/81.8）；`bootGlobalAtInstall=false`（仪表先于 boot 注入，自证注入时序） | 客户端解析 |
| S2 **启动前置阻塞任务** | 128 → 236 | **108** ✓长任务（本批最长） | **内部归属 INCONCLUSIVE**：该 `RunTask` 在 trace 中**无 `EvaluateScript` 子事件**，而 `ParseHTML` 全程仅 2.1 ms、`UpdateLayoutTree` 单次最大 4.4 ms ⇒ 只能确认"这是一个 108 ms 的主线程阻塞块，位于 DCL(114.7) 之后、首帧(130) 之中"；候选为 boot 注入物化/模块图编译求值，**未取得可分辨证据** | **客户端主线程**（量级确证；机理未定） |
| S3 首批 9 个 bundle | 110.8 → 307.4 | ~197 | `immediately:true` 预热层（`prefetchImmediateTier`） | 客户端网络（HTTP/1.1 排队） |
| S4 第二批 39 个 bundle | 309.4 → **779.3** | 470 | **全部剩余 bundle（含 4.1 MB pptmaster）** 同时发起 | **客户端网络 + 启动协议** |
| S5 长任务（批尾求值） | 308.1 → 364；807.9 → 901 | **56 + 93** ✓长任务 | 批尾 bundle 的解析/求值；93.4 ms 任务与 pptmaster 求值**同属一个 `RunTask`**（逐包精确归因见 §6.2） | **客户端主线程** |
| S6 `window.load` | — → 903.9 | — | — | — |
| **S7 app chrome 挂载（TTI 代理）** | — → **930.4** | — | `frame_layout`/`sidebar_shell`/`project_row`/`composer`/`settings_trigger` **同一帧同时成立** | **被 S4 钉住（Δ=151.1 ms）** |
| S8 LCP | — → 979.5 | — | — | — |
| S9 `session.list` 在飞 | 536.5 → **15,249.2** | **14,712.7** | **TTFB 14,712.6 ms，传输仅 3.9 ms，505 KB** | **宿主服务端（100%）** |
| **S10 侧栏会话行就绪** | — → **15,292.6** | — | 4 个项目行 + 4 条会话行 | **被 S9 钉住（Δ=43.4 ms）** |
| S11 设置点击（附加测量） | 17,853 → 20,681 | — | 点击后新增 **0 个 bundle 请求**，只有 `agentPreset.list`(TTFB 2,830.2 ms) 与壁纸图重载 | 宿主 RPC |

> S1/S2 的 `domInteractive`=90.3 ms、`domContentLoaded`=114.7 ms；FCP=130 ms（**仅主题底色与启动遮罩**，此时应用尚未挂载）。
> 另注：`modulesystem-live` 标记（报 237 ms）是**我 4 ms 轮询的产物**——该轮询被 S2 的 108 ms 长任务阻塞，故 237 ms 只是"长任务结束后的第一次可观测时刻"，**不得**当作模块系统启动时刻引用。

### 2.2 "挂载被最后一个 bundle 钉住" —— 10/10 相位一致（本报告最强的单条不变量）

| 相位 | 挂载 (ms) | 最后 bundle 到达 (ms) | Δ = 挂载 − 末包 | session 行就绪 |
|---|---|---|---|---|
| rep1-cold | 930.4 | 779.3 | **151.1** | 15,292.6 |
| rep1-warm | 2,627.7 | 2,574.1 | **53.6** | 永不（超时） |
| rep2-cold | 7,974.1 | 7,851.6 | **122.5** | 永不 |
| rep2-warm | 16,404.5 | 16,352.0 | **52.5** | 永不 |
| rep3-cold | 4,087.3 | 3,945.7 | **141.6** | 永不 |
| causal-cold | 1,115.6 | 995.7 | **119.9** | 23,508.3 |
| causal-cold2 | 10,062.3 | 10,040.1 | **22.2** | 永不 |
| causal-sdelay | 1,835.9 | 1,781.8 | **54.1** | 永不 |
| causal-bdelay | 1,802.1 | 1,748.1 | **54.0** | 25,038.1 |
| bootwindow-w1 | 2,355.0 | 2,233.3 | **121.7** | 永不（30 s 超时） |

Δ 的绝对值随机器负载漂移（22–152 ms），但**方向 10/10 一致**：挂载从不早于末包、且总在其后百毫秒内 ⇒ 挂载被"最后一批 bundle"钉住。
（`bootwindow-w1` 的 `windowValid=CONTENDED`，外部浏览器主进程峰值 **7**。）

### 2.2b 启动窗内的主线程成本（相位切分，同窗两次 `Performance.getMetrics` 取增量）

`bootwindow-w1`（挂载 2,355 ms，末包 2,233.3 ms）：

| 窗口 | TaskDuration | ScriptDuration | LayoutDuration | RecalcStyleDuration | 长任务 |
|---|---|---|---|---|---|
| **启动窗**（0 → 挂载 2,355 ms） | **0.534 s** | **0.153 s** | 0.036 s | 0.033 s | 103 + 54 + 77 = **234 ms** |
| 侧栏等待窗（挂载 → 30 s 超时） | +0.755 s | +0.387 s | +0.001 s | +0.004 s | 0 |

⇒ 启动期主线程只花 **0.53 s 的 task 时间、其中 JS 仅 0.15 s**，其余时间在**等字节**；而侧栏等待窗额外烧掉 0.755 s 的渲染进程 task 时间（WS 事件/轮询等）。**主线程不是首屏瓶颈。**

### 2.3 代码侧的因果链（与上表互为印证）
shell 启动类（`dsh-web-frontend/dist/assets/index-ClqxG24t.js`，**第 93 行**，我自行定位字节偏移）：

- `this.manifest = this.modules.manifest; const u = this.prefetchImmediateTier(); ... await this.runPluginBoot(c, u); await this.mountApp(c)`
  → `prefetchImmediateTier` @ byte **397,139**；`mountApp` @ byte **397,224**
- `runPluginBoot`：`const u = this.manifest.plugins.map(c => c.id)` @ byte **397,991** → `await Promise.all(u.map(async c => { ... await l.create({ name: c }) }))` → `await l.await()` → `assertEntriesActive` @ byte **398,254** → 之后才 `mountApp`
- **`immediately` 在全库只有一处消费**（预热），真正的加载点是"**对全部 50 条逐个 `loader.create` 并整体 await**"。
- `create` 非惰性：`cordis-plugin-loader/lib/index.js:225→466/517` → `:270 ctx.loader.internal.import` → `dsh-client-modules/lib/client.js:262/210/196` → **`:113-124 document.createElement("script")`**（经典脚本动态注入）。
- `assertEntriesActive`：**任一条未激活即整体启动失败** ⇒ 启动协议**结构上不容忍缺失的 bundle**，每条都在关键路径上。
- boot 注入实现：`dsh-client-modules/lib/index.js:196-243`（`bootInjections`：内联 queue → 2 个 parser-blocking `script-src` → `__DSH_BOOT__` global）。

### 2.4 因果实验：延迟**单个非首屏** bundle ⇒ 挂载同比位移【决定性】
`sdelay`/`bdelay` 用 CDP `Fetch.requestPaused` 把单个请求**扣住固定时长**（不改产品文件、不改包内容），同窗 A-B（`causal-cold` vs `causal-bdelay`）：

| | causal-cold（基准） | causal-bdelay（扣住 pptmaster **+1500 ms**） | 位移 |
|---|---|---|---|
| pptmaster 该类请求耗时 | 720.6 ms（其中服务端 ~720 ms） | **1,558.0 ms**（1500 注入 + 58 服务端） | 注入**如实生效** |
| **pptmaster 到达时刻** | 984.9 ms | 1,748.1 ms | +763.2 ms |
| **app chrome 挂载** | **1,115.6 ms** | **1,802.1 ms** | **+686.5 ms** |
| 挂载 − 末包 | 119.9 ms | 54.0 ms | 仍紧贴末包 |
| `window.load` | 1,093.9 ms | 1,776.1 ms | +682.2 ms |
| 侧栏会话行 | 23,508.3 ms | 25,038.1 ms | +1,529.8 ms（**与本次注入无关**，是宿主 `session.list` 漂移） |

⇒ **一个首屏完全用不到的 4.1 MB 插件包，被扣住 1.5 s ⇒ 应用外壳挂载晚 ~0.69 s。** 这是"首屏被非关键工作阻塞"的**直接因果证据**（非相关推断）。
> 位移量（686 ms）小于注入量（1500 ms）的原因已查明：基准相位里该包本身因宿主争用已耗 ~720 ms 服务端时间，故**净效应被基准耗时吸收**；这不影响因果方向。

---

## 3. ② 关键路径上最贵的 10 个资源（体积 × 解析/求值成本）

口径：资源 = `rep1-cold` 中 `responseEnd <= 挂载(930.4 ms)` 的启动期资源；体积 = 浏览器实测 `decodedBodySize`；"可延迟" = 静态审计（`evidence/static-inventory.json`）按 slot 注册面与运行时不消费 `wire inject` 的判定。

| # | 资源 | 体积 (B) | 到达 (ms) | 主线程求值实测 | **在关键路径** | **可延迟** | 证据 |
|---|---|---|---|---|---|---|---|
| 1 | `/plugins/@local/dsh-pptmaster/client.js` | **4,096,057** | 779.3 | 与 93.4 ms 长任务同属一个 `RunTask`（逐包精确值 INCONCLUSIVE） | 是 | **yes** | 内联 base64 预览 2,498,758 B + pptx-renderer 1,487,836 B（`client.js:12` / `:775`） |
| 2 | `/dsh-wallpaper/media/…png`（首屏背景） | **2,334,260** | 761.9 | — | 是 | 视觉相关，非逻辑必需 | 同一文件在设置点击时**再次**以 `img` 拉取（17,853→20,352 ms，2.5 s） |
| 3 | `/assets/vendor-D22_Mp1f.js`（shell 依赖） | 744,872 | 83.6 | `modulepreload` 已声明 | 是 | no（shell 必需） | `dist/index.html` modulepreload |
| 4 | `/plugins/…/dsh-client-ui-conversation/client.js` | 447,932 | 451.2 | — | 是 | no（会话渲染必需） | 分类 `conversation_render` |
| 5 | `/assets/index-ClqxG24t.js`（shell 本体） | 399,361 | 82.0 | — | 是 | no | 含启动协议与 `mountApp` |
| 6 | `/plugins/…/dsh-client-runtime/client.js` | 398,569 | 81.8 | 0.16 ms（`EvaluateScript`，**不可信，见下**） | 是（**parser-blocking**） | no | 先行阻塞脚本，S2 的 108 ms 长任务主体 |
| 7 | `/plugins/…/dsh-client-connection/client.js` | 359,924 | 163.1 | — | 是 | no | `onConnected` 闸门（`dsh-client-connection/lib/client.js:203-209`） |
| 8 | `/plugins/…/dsh-client-ui-trajectory/client.js` | 359,173 | 767.8 | — | 是 | **yes** | 分类 `optional_feature` |
| 9 | `/plugins/@local/dsh-btw/client.js` | 335,348 | 771.8 | — | 是 | **yes** | 本地插件，设置/工具栏面 |
| 10 | `/plugins/dsh-workspace-enhancement/client.js` | 267,026 | 771.6 | — | 是 | **partial** | 侧栏扩展（部分首屏相关） |

**关键路径总量（实测）**：

| 指标 | 值 |
|---|---|
| 关键路径（挂载前）字节 | **11,904,125 B ≈ 11.9 MB**（**未压缩**，见 §4.3） |
| 其中**可延迟（yes）** | **5,434,448 B ≈ 5.43 MB（占关键路径 45.7%）** |
| 50 个 client bundle 合计 | 8,262,805 B（其中 pptmaster 占 **49.6%**） |
| 按 wire-`inject` 求出的"启动必需闭包" | **12 条 / 1,304,799 B（15.8%）**；闭包外 **38 条 / 6,958,006 B（84.2%）** |
| 挂载后到达 | 2,857,865 B（设置点击新增 **0** 个 bundle 请求） |

**关于"解析/求值成本"的诚实结论**：
- 逐资源的 `EvaluateScript` 读数（0.02–0.16 ms/bundle）**不可信**——V8 并发编译 + 顶层执行被归到 `FunctionCall`（全相位 `FunctionCall` 累计 1,504.6 ms）⇒ **逐资源解析/求值归因标 INCONCLUSIVE（§6.2）**。
- 可用的**相位级**事实：**启动窗内 `TaskDuration = 534 ms`、`ScriptDuration = 153 ms`、`LayoutDuration = 36 ms`、`RecalcStyleDuration = 33 ms`**（`bootwindow-w1`；其相位 2 因浏览器死亡失败，故为主线程指标的单相位证据）；**启动期长任务 234 / 243 / 257 ms，三相位一致，最长 108 ms**；`V8CompileDuration = 1.2 ms`（主线程编译可忽略，编译主要走并发/后台）。
- ⇒ **"最贵"的判据在本环境下由体积主导**：成本 = **字节要等**（HTTP/1.1 六连接阶梯、未压缩）+ **启动协议要求它们全部到齐**，而**不是**主线程解析。**这与直觉相反，是本次审计的一个关键纠偏**：把优化投在主线程/虚拟化上收益有限，投在"减少关键路径字节 + 懒加载分层"上收益大。

---

## 4. ③ 是否存在"首屏被非关键工作阻塞"？—— **是，且分三问三答**

### 4.1 "打开设置才需要的 bundle" —— **YES：50/50 在挂载前全部加载**
- 实测：`pluginBundleRequestCount = 50`（9/9 相位一致），且**全部在挂载前完成**（末包 779.3 ms < 挂载 930.4 ms）。
- 分类实测：`optional_feature` 9 条 / 5,188,976 B；`deferrable=yes` **21 条 / 5,434,448 B（占全部 client JS 的 65%）**——**全部落在挂载前**。
- 因果证据见 §2.4（扣住 pptmaster ⇒ 挂载 +686.5 ms）。
- 结构性证据：`assertEntriesActive` 令**缺失任一 bundle = 启动失败**，故"按需延迟"在现状下**不可能**在不改协议的前提下实现。

### 4.2 插件清单（`pluginInventory.list`）—— **NO（不在首屏）**
- 该 RPC **不在首屏 API 集合内**（首屏集合 = `host.describe` → `session.list` ‖ `workspace.list` ‖ `agentPreset.list`，前置 3 条 SSE）。
- 它只在「插件列表」子标签激活时发出（与 BATCH-PLAN §五.14 的"导航项 vs tab"辨析一致）。
- **但要区分**：其**bundle**（`dsh-client-ui-settings-plugin-inventory` 17,303 B）仍在启动期加载 ⇒ **"清单 RPC 不在首屏、但清单 bundle 在首屏"**。

### 4.3 用量请求（`/usage/*`）—— **RPC：NO；bundle：YES**
- 首屏 API 集合中**没有任何 `/usage/*`**（与历史结论一致）。
- 但 `@local/dsh-usage` 的 **72,804 B** bundle 在启动期加载（category `optional_feature` / deferrable yes）。

### 4.4 🔴 **对既有文档的两处更正（本线实测，请全组采用）**
| 既有表述 | 本线实测更正 |
|---|---|
| 「**打开设置那一刻抓 50 个 bundle**」 | **50 个 bundle 是"启动期"成本，不是"设置期"成本**。实测设置点击后 **新增 bundle 请求 = 0**；点击只新增 `agentPreset.list`（TTFB 2,830 ms，受污染口径）与壁纸图重载。把 50 个 bundle 记到"设置"头上会**错误归因**：设置的真实成本是 `agentPreset.list` + 面板重挂 + 遮罩，与这 50 个包无关。 |
| 「`session.list` 阻塞（探针 p95 4.6→43.9 ms、峰值 789 ms；修复后中位 0.166 s）」 | **方向确证，但机理与量级需要改写**：本线的实测**不是一个固定成本，而是一条灾难性的并发尾巴** —— 见 §4.6 的同窗 A-B-A。GUI 内 15.29 s、受污染窗 23.1/24.7 s、**30 s 客户端超时**（`DEFAULT_TIMEOUT_MS = 3e4`，`dsh-host-apiproxy/lib/index.js:5307`）⇒ **侧栏永久空白**；进程外纯 HTTP 亦曾 >90–120 s 不返回。**但同一输入也能在 240 ms 返回** ⇒ 该指标的**单点值不可作验收依据，必须用并发矩阵**。 |

### 4.5 逐段阻塞归属总表（回答 ① 的"阻塞归属"）
| 时间窗 | 归属 | 证据强度 |
|---|---|---|
| 0 → 0.93 s（HTML → 挂载） | **客户端**：69 ms 宿主 TTFB（受污染）+ 108 ms 前置阻塞任务 + 8.26 MB bundle 以 HTTP/1.1 分 3 波排队（末包 779 ms）+ 234–257 ms 长任务；启动窗 `TaskDuration` 仅 534 ms / `ScriptDuration` 153 ms ⇒ **时间花在等字节**；**挂载被末包钉住** | 实测 + 代码 + 因果实验 |
| 0.93 s → 15.3 s（挂载 → 侧栏有内容） | **宿主服务端 `session.list` 独占**（`ttfb ≈ total`：14,712.6 / 14,716.5 ms；传输仅 3.9 ms） | 实测（GUI 内 + 进程外 + 并发矩阵）|
| 并行分支（未被上述任一阻塞） | `session.list` 于 536.5 / 954.4 ms 发出，**早于挂载**，与 bundle 加载并行 ⇒ 侧栏慢**不是**被 bundle 拖的 | Resource Timing |

### 4.6 🔴 `session.list` 的并发敏感性（同窗 A-B-A，纯 HTTP，`raw/session-list-concurrency.txt`）

| 批次 | 并发度 | 各次 TTFB (s) | 体量 |
|---|---|---|---|
| **A**（前置单发） | 1 | 1.864 / 3.155 / 2.491 | 504,290 B |
| **B1**（并发） | **4** | 17.295 / 17.827 / 18.068 / 18.222 | 504,240 B |
| **B2**（并发） | **4** | 13.304 / 13.331 / 13.350 / 13.370 | 504,241 B |
| **A′**（后置单发） | 1 | 0.873 / 3.848 / 1.693 | 504,241 B |
| （另一次单发，15:00） | 1 | **0.2407** | 505,215 B |

**读法（三条硬事实）**：
1. **并发 4 路 ⇒ 每次延迟 13.3–18.2 s，是单发的 4–10×**，且 4 个响应在 ~1 s 内几乎同时到达（**排队/争用特征，非 4 份独立并行计算**）——`listVisibleSessionSummaries` **无 memo / 无 TTL / 无 single-flight**（`dsh-host-apiproxy/lib/index.js:2226-2300`），每个并发调用都做一整趟全量扫描。
2. **返回值与延迟无关**：体量 14 个样本全部 504,240–505,215 B（差 <0.2%），而延迟跨 **0.24 s ↔ >120 s（≥500×）** ⇒ 延迟由**宿主争用/饥饿**决定，不由数据量决定。
3. **传输不是问题**：`ttfb ≈ total`（如 240.73 / 240.73 ms）⇒ **100% 的延迟在服务端**，505 KB 传输 <1 ms。

**与 GUI 观测完全自洽**：本批 ~100 条研究线同时开工时，每条线的浏览器首屏都会发一次 `session.list` ⇒ 实际并发 ≫ 4 ⇒ 落在 13–18 s 档甚至更差 ⇒ **30 s 客户端超时 ⇒ 侧栏静默空白**（`bootwindow-w1` 实测：954.4 ms 发出、30,954.3 ms 结束、`decoded=0`）。

**`session.list` 的成本结构（可测 vs 不可测）**：
- 可测：**返回 505 KB**；宿主进程 `/proc/<pid>/stat` 在采样窗内 **utime+stime = 5,043 ticks/45 s ⇒ 112% 单核**，随后 60 s 窗 **8,012 ticks ⇒ 133% 单核**（进程 PID 301709，**该进程同时承载全部 ~100 条研究线**，故**不能**把 CPU 独占归给 `session.list`）。
- 可测（进程外复现，来自 `evidence/server-rpc.md`）：`sessionPersistence.list` 单独跑 **中位 182.8 ms**（1209 个 `session.jsonl.zstd`、2418 次 open、每文件首帧 zstd 解压+头行解析，`dsh-session-persistence-jsonl/lib/index.js:1060-1095`）⇒ **冷启动 I/O 地板 183 ms**，与单发实测 0.24–3.85 s 同量级（1.3–20×）⇒ **单发的残余开销主要就是"全量扫描 + 逐会话投影"**；而 13–18 s / 30 s+ 的部分是**并发放大**。
- 实现面（`dsh-host-apiproxy/lib/index.js`）：B1-perf v1 已把比较器里的 O(N log N)×events 折叠预计算掉（:2233-2246）；剩余成本点为**对合入的每个会话逐条做投影/`summarizeAttached`**、冷会话按 `COLD_SUMMARY_BATCH_SIZE=16`（:882）分批 `summarizeCold` + 每文件 `coldBlankProbeMaxBytes=1024`（:1712）头探测、`SUBAGENT_LIST_MAX=200`（:1231-1233）、以及 :2295 的 `annotateRunningSubagentCounts` 再走一趟 live 会话表——**这些在并发下被重复执行 N 次，是尾巴的结构性来源**。
- **INCONCLUSIVE**：attached 折叠 / 冷投影 / 持久化扫描 / CPU 饥饿**四者各自的占比无法从现有通道分离**（`/proc/<pid>/io` EACCES；该宿主进程同时跑全部研究线，CPU 无法归因）——见 §6.3。

---

## 5. ④ 可测的首屏优化候选（每项含 收益/风险/验收/回滚/热面或冷面）

> 验收通则（沿用 BATCH-PLAN §四）：**同窗对照、比值判据、保留所有 invalid 窗口**；功能回归须含 `assertEntriesActive` 全 active、设置 4 个 tab、插件列表、用量 9 路 RPC。
> 收益一律给**相对量**；括号内为本地 localhost 口径的量化预期（**远程/慢链路会放大**）。

### C1 ★ 给启动协议引入"惰性层"：把兜底 fiber 创建移出 `mountApp` 之前
- **改动点**：shell `index-ClqxG24t.js:93`（`runPluginBoot` 的 `manifest.plugins.map(c=>c.id)` → `Promise.all(50 create)` → `assertEntriesActive` → `mountApp`）；把 `assertEntriesActive` 的断言范围限定为**启动必需闭包（12 条 / 1.30 MB）**，其余 38 条改为挂载后空闲期或首次使用时创建。
- **收益**：关键路径字节 **11.9 MB → ≈6.5 MB（−46%）**（= 11.9 − 5.43 MB 可延迟集；其中闭包 1.30 MB 必留、shell 资产 1.15 MB 必留）；按 §2.4 的因果斜率，挂载同窗相对降幅 **≥30%**（本地观测值 0.93 s 量级 ⇒ 目标 ≤0.65 s）。与 C2/C7 叠加后可再降。
- **风险**：`assertEntriesActive` 现为硬闸门 ⇒ 惰性后必须显式定义"未物化条目的失败/加载态"，否则会把启动失败变成使用期静默失败；wire `inject` 目前运行时不消费（静态审计已确认），故**不会**因缺少被注入方而断链——但该结论需在回归里逐条验证。
- **验收**：① 同窗 A-B-A：`mountMs` 相对降幅 ≥30%；② `bytesOnCriticalPath ≤ 7.0 MB`（仅 C1 生效；与 C2/C7 叠加时按各自验收判）；③ **解耦判据**：`mountMs − lastBundleEndMs` 不再随 bundle 波动（对照 §2.2 表，10/10 相位 Δ≤152 ms 的"钉住"形态消失）；④ 功能回归：50 条 fiber 最终全部 active、设置 4 tab、插件列表、用量 9 路、会话列表行数不回归（顶层一条不少、subagent 上限 200 语义不变）。
- **回滚**：eager 名单做成配置项，一键回退现状（原子：`settings` 段热载）。
- **面**：**冷**（shell 属 `apps/web` 产物，需重建 + 刷新）。

### C2 ★ 服务端开启压缩（br/gzip）
- **证据**：`/plugins/*` 发点 `dsh-client-modules/lib/index.js:481-485`（仅 `content-type` + `cache-control: no-cache`）；`/assets/*` 发点 `dsh-host-frontend-static/lib/index.js:70-71`（**无 encoding、无 cache-control**）。实测带 `Accept-Encoding: gzip, br` 与 `Range` 均被忽略（无 `content-encoding`、无 206、一律 chunked）。
- **收益**：关键路径 11.9 MB → **≈2.9–3.4 MB（−72%~−76%）**；本地观测收益小（0.2–0.4 s），**远程/慢链路为主要收益面**。
- **风险**：每请求压缩 4.1 MB 的 pptmaster 不便宜 ⇒ 必须**预压缩/带缓存**（其发点(`:459-489`)当前**每请求重读磁盘、无内存缓存**，`evidence/server-rpc.md` §D）；与 ETag/`Range` 的交互需重验；代理层可能重复压缩。
- **验收**：`content-encoding` 存在且 `encodedBodySize/decodedBodySize ≤ 0.45`；`bytesOnCriticalPath ≤ 3.5 MB`；`mountMs` 不退化；脚本仍可执行、`?rev=` 与磁盘 sha1-12 一致、`assertEntriesActive` 全 active。
- **回滚**：移除中间件（纯服务端，无客户端状态）。
- **面**：**冷**（宿主代码 + 重启）。

### C3 ★ 消除 HTTP/1.1 六连接阶梯
- **证据**：`nextHopProtocol: http/1.1`；39 个 bundle 的 `responseEnd` 呈 **446 → 524 → 541 → 694 → 767 → 779 ms** 的阶梯（并发上限 6）。启动期共 60+ 请求同源。
- **收益**：阶梯压缩，`lastBundleEndMs` 同窗相对降幅 **≥30%**（并直接带动 §2.2 的挂载）。
- **风险**：TLS/证书与 SSE（`/plugins/events`）长连接行为需重验；反向代理配置属部署面。
- **验收**：在飞请求数峰值 >6 且阶梯形态消失；`lastBundleEndMs` 相对降幅 ≥30%；SSE 三通道（`/plugins/events`、`events.mux`、`events.host`）不断连。
- **回滚**：切回 HTTP/1.1 监听。
- **面**：**冷**。

### C4 ★★ `session.list`：先加 single-flight/memo，再瘦身分页
- **证据**：§4.6（并发 4 路 ⇒ 单次 13.3–18.2 s，是单发的 4–10×；`ttfb≈total` ⇒ 全在服务端；体量与延迟无关）；`payload` 已有 reserved `cursor` 字段（`dsh-host-apiproxy/lib/index.js:438-440`）⇒ 分页是既有设计意图。
- **两步走**：
  - **C4a（最便宜、先做）**：**single-flight / 短 TTL memo**：同一时刻的并发 `session.list` 共享同一趟扫描结果（当前 4 个并发 = 4 趟全量）。
  - **C4b**：首屏只取"最近 N 条 + 计数"，其余按 `cursor` 分页/按需。
- **收益**：**本批最大单项**。C4a 直接砍掉"并发 ×N 的全量重复"（本机 4 路即 4–10×）；C4b 把单发从 0.24–3.85 s 压向 I/O 地板（183 ms）。目标：`sessionListTTFB` 相对降幅 **≥90%**，`sessionRowMs ≤ mountMs + 500 ms`，30 s 超时不再触发。
- **风险**：memo 的一致性（会话创建/删除/改名/`runningSubagentCount` 变化必须失效或 TTL 足够短）；分页需保持全量排序语义；`session.search` 与列表的可见性口径必须一致。
- **验收**：
  ① **并发矩阵**（本候选的**专属判据**，单点值不可用）：同窗 A-B-A，**4 路并发时每次 TTFB ≤ 单发的 1.2×**（当前 4–10×）；
  ② 单发 `sessionListTTFB` 相对降幅 ≥90%；响应体 ≤64 KB（C4b 后）；
  ③ 回归哨兵：顶层行数**一条不少**、subagent 上限 200 语义不变、`session.list` 200 与顶层行齐全（BATCH-PLAN §四冷面哨兵）、`runningSubagentCount` 与客户端 `byId` 兜底值一致；
  ④ 负对照：人为超时/失败必须呈现**显式错误态**而非静默空白。
- **回滚**：C4a 保留直通开关；C4b 保留旧全量路径。
- **面**：**冷**（宿主）+ 可能**热**（客户端分页消费）。

### C5 ★ 侧栏骨架屏 + 把列表从"启动闸门"降为异步补齐
- **证据**：项目行/外壳在 **930 ms** 已就绪，真正缺的只是会话行（15.3 s）。
- **收益**：用户可见"侧栏有内容" **15.29 s → ≈0.95 s（−94%）**；**不减少总工作量**，只改感知与失败模式（消除 30 s 超时后的空列表）。
- **风险**：骨架↔真实行的视觉跳动；与虚拟化/搜索的交互。
- **验收**：`projectRowMs ≤ mountMs + 200 ms` 且存在骨架 DOM 断言；`sessionRowMs` 不变差（±10%）；失败/超时必须显式错误态。
- **回滚**：客户端开关。
- **面**：**热**（客户端 bundle，客户端 HMR 生效）。

### C6 ★ pptmaster 包瘦身（4.1 MB → ≤1.2 MB）
- **证据**：内联 base64 预览数据 **2,498,758 B**（`client.js:12`）+ pptx-renderer **1,487,836 B**（`:775`）= 该包的 97.3%；分类 `optional_feature` / deferrable yes。
- **收益**：单包占全部 client JS 的 **49.6%** ⇒ 关键路径 11.9 MB → **7.8 MB（−34%）**；§2.4 已直接证明该包在关键路径上。
- **风险**：PPT 生成链路依赖内联数据 ⇒ 必须改为按需资源端点（**功能回归是主要风险**）。
- **验收**：该 URL `decodedBodySize ≤ 1.2 MB`；`mountMs` 同窗相对降幅 ≥20%；PPT 全链路（场景检查 → 渲染 → 生成 PPTX）1 轮通过。
- **回滚**：保留旧包（`?rev=` 切回）。
- **面**：**冷**（插件包位于 `~/.dsh/profiles/node_modules/@local/dsh-pptmaster/`，改后需重载该插件）。

### C7 壁纸首屏图（2.33 MB PNG）
- **收益**：关键路径 **−2.33 MB（−20%）**。建议改 WebP/AVIF（同图）+ 尺寸适配；同时修掉"设置点击时同一图再拉一次"（17,853→20,352 ms）。
- **风险**：观感变化（属用户可见配置）。
- **验收**：同一图同尺寸下 `decodedBodySize ≤ 0.4 MB`；`mountMs` 同窗相对降幅 ≥10%；像素级视觉对照一致。
- **面**：**热**（用户配置/客户端）。

### C8 并行化 `host.describe` 串行闸门
- **证据**：`onConnected` 被 `host.describe` 串行 gate（`dsh-client-connection/lib/client.js:203-209`），`session.list` 在其之后才发出 ⇒ 首屏多付一个 RPC 的往返。
- **收益**：**小的固定量**（一个 RPC 往返；本机 TTFB 21–1,795 ms 受污染口径，无法给出可信比值）⇒ **收益标 INCONCLUSIVE**，仅作低优先候选。
- **验收**：`sessionList.startMs` 相对提前；`host.describe` 失败时的降级路径存在。
- **回滚**：开关。
- **面**：**热**（客户端 bundle）。

### C9 预连接/预加载策略 —— **本机口径下 INCONCLUSIVE**
- 事实：2 个 parser-blocking bundle 与 shell/vendor/2 CSS 在 **~73 ms 同批发出**（预加载扫描器已并行发现）；`vendor` 已有 `modulepreload`；TTFB 69 ms。
- ⇒ **在 localhost 无 RTT 成本的条件下，preconnect/preload 的可测收益为 0 量级（INCONCLUSIVE）**；只有在**远程部署/高 RTT**时才值得做。**不要**把预加载当作本机 TTI 改善手段（且 50 个包全都要加载，预加载不改变总量）。
- 面：热（HTML 注入）/ 冷（宿主注入模板）。

### C10 减小/缓存启动注入（`__DSH_BOOT__` 14,118 B，每请求现算）
- **证据**：图对象有缓存（`dsh-client-modules/lib/index.js:291,309`），但 **HTML 序列化每请求重算**：`dsh-host-frontend-static/lib/index.js:81-83` 每请求 `readFile(index.html)` + `renderIndex`；50 条图每请求 `JSON.stringify`（实测 14,118 B）。
- **收益**：对 TTI 量级**未量化 ⇒ INCONCLUSIVE**；主要价值在宿主 CPU 与 TTFB 稳定性。**优先级最低**。
- **验收**：`/` TTFB 同窗相对降幅 ≥30%（仅在宿主饱和时才有分辨力）；`__DSH_BOOT__` 内容与 `?rev=` 严格一致。
- **面**：**冷**（宿主）。

### 候选优先级（按"收益 ÷ 风险 ÷ 面成本"）
1. **C4a**（`session.list` single-flight/memo：最低成本、直接打在并发放大上，纯服务端，可热载需重启）
2. **C4b**（首屏只取最近 N 条 + 分页：把单发压向 183 ms I/O 地板）
3. **C1**（启动协议惰性层：结构性根因，收益大，需重建 shell）
4. **C6**（pptmaster 瘦身：单包占 49.6%，已有因果证据 +686.5 ms）
5. **C5**（骨架屏：感知收益即时，风险低，热面）
6. **C2 + C3**（压缩 + HTTP/2：主要收益在远程/慢链路）
7. **C7**（壁纸）、**C8**（闸门并行）、**C10**（注入缓存）
- **C9 不做**（本机 INCONCLUSIVE）。

---

## 6. 无法量化 / INCONCLUSIVE 清单（诚实边界）

| # | 项 | 原因 |
|---|---|---|
| 1 | **真实 TTI（输入→呈现延迟）** | headless 无 GPU 合成与绘制口径；本机有头 Chromium 100% 启不来（incident2 已记）。本报告用"app chrome 挂载"作代理并显式降级。 |
| 2 | **逐资源解析/求值成本** | `EvaluateScript` 逐包读数 0.02–0.16 ms 与体积严重不符（V8 并发编译 + 顶层执行归 `FunctionCall`，后者累计 1,504.6 ms）；只有相位级指标可信（启动窗 `TaskDuration 534 ms`/`ScriptDuration 153 ms`、长任务 234–257 ms）。 |
| 3 | **`session.list` 内部四段占比**（attached 折叠 / 冷投影 / 持久化扫描 / CPU 饥饿） | `/proc/301709/io` EACCES ⇒ 无法分离 CPU 与 I/O；且宿主进程同时承载 ~100 条研究线 ⇒ CPU 不可归因。已有：冷启动 I/O 地板 183 ms（进程外）、并发放大 4–10×（同窗 A-B-A）；**两者之间的分解仍 INCONCLUSIVE**。 |
| 4 | **绝对 ms 的可移植性** | 全部相位 `CONTENDED`（外部浏览器主进程 3–7、loadavg 5.9–9.7），且**锁独占 ≠ 机器独占**。绝对值只作下限；跨线比较请用比值。 |
| 5 | **C8 / C10 的收益比值** | 只观察到方向，未取得可比较的同窗配对数。 |
| 6 | **C9（预连接/预加载）收益** | localhost 无 RTT 成本，本机口径下不可分辨。 |
| 7 | **设置点击的 user-visible 延迟** | 本线只测到同刻新增 `agentPreset.list`（TTFB 2,830 ms 受污染）与壁纸图重载；click→可见未在本批重现（历史 D4 报 13.2–19.8 ms）。 |
| 8 | **S2 那 108 ms 长任务的具体成因** | trace 中该 `RunTask` 无 `EvaluateScript` 子事件，`ParseHTML`/`UpdateLayoutTree` 都无法解释 ⇒ 只能确认"存在 108 ms 前置阻塞块"，机理未定。 |
| 9 | **`sfail` 负对照相位**（session.list 失败 ⇒ 侧栏是否永不出行） | 该相位随浏览器中途死亡丢失；间接证据已有（30 s 超时相位 `decoded=0` 且 0 行）。 |
| 10 | 浏览器中途死亡（2 次长序列 + bootwindow 相位 2） | 疑似环境级进程杀手（内存充足：43 GB 可用、`/dev/shm` 31 GB 仅用 205 MB）。已用最小序列补回关键因果实验。 |
| 11 | **客户端消费 505 KB 的渲染成本**（回放实验未做） | **建议的下一个实验**：已捕获真实响应体 `raw/session-list-body.json`（505,215 B），用 CDP `Fetch.fulfillRequest` 把它**即时回放**给页面 ⇒ 可直接量出"session.list 变快后侧栏多久就绪"与"505 KB 的客户端渲染成本"。本线因浏览器反复死亡 + 时间预算未做；**现有间接证据**：`rep1-cold` 行出现在响应到达后 43.4 ms、`bdelay` 319 ms、`causal-cold` 452 ms ⇒ 客户端侧是**几十~几百 ms 量级**，不是瓶颈。 |

---

## 7. 交付物与复现

### 7.1 文件
| 路径 | 内容 |
|---|---|
| `audit.md`（本文件） | 结论、时间线、候选、验收、INCONCLUSIVE |
| `raw/boot-index.html` · `raw/boot-graph.json` | 实际服务的 HTML（16,611 B）与 `__DSH_BOOT__` 图（50 条 / 14,118 B） |
| `raw/timeline-rep{1,2,3}-{cold,warm}.json` | 带 CDP trace 的冷/温相位原始数据 |
| `raw/timeline-rep1-cold.json` | §2.1/§3 的主要原始依据（含逐资源 Resource Timing、逐脚本 eval/compile、trace 汇总） |
| `raw/causal-{cold,bdelay,sdelay,cold2}.json` · `raw/causal-all.json` | **因果延迟探测**原始数据 |
| `raw/bootwindow-1.json` · `raw/bootwindow.log` | **启动窗/侧栏窗主线程指标切分**（`bootwindow-2` 因浏览器死亡失败，已在 §6.10 记录） |
| `raw/session-list-concurrency.txt` | **`session.list` 并发矩阵原始输出**（A 单发 / B 4 并发 / A′ 单发） |
| `raw/session-list-body.json` | `session.list` 真实响应体（505,215 B，用于后续回放实验） |
| `raw/timeline-summary.json` | 9 个相位的可比关键数汇总（含 §2.2 不变量表） |
| `raw/probe-run.log` · `raw/causal-run.log` · `raw/capture-session-list.log` | 运行日志（含 lock 等待、崩溃、并发快照） |
| `evidence/static-inventory.{json,md}` | 静态审计（二级子代理）：50 包字节/sha1/闭包/可延迟分类/加载机制/压缩裁决（107,761 B + 66,370 B） |
| `evidence/server-rpc.{json,md}` | 服务端/RPC 审计（二级子代理）：首屏 RPC 集合、闸门、session.list 现状与进程外复现、index 注入、56 条 HTTP 原始样本 |
| `evidence/critical-path-top10.json` | §3 的表 + 全部启动期资源明细 |
| `scripts/*.mjs` · `scripts/*.sh` · `scripts/*.py` | 复现脚本 |

### 7.2 复现命令
```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/program/w08-boot
node scripts/boot-timeline.mjs --reps 3 --out raw            # 冷/温相位 + CDP trace（需先拿到共享锁）
node scripts/boot-causal.mjs --sequence cold,bdelay --delay-bundle 1500 --out raw   # 因果延迟探测
node scripts/boot-window-metrics.mjs --phases 2 --out raw    # 按相位切分主线程指标
python3 scripts/build-summary.py                             # 汇总 §2.2 / §3 表
./scripts/session-list-concurrency.sh                        # ★ session.list 并发矩阵（A-B-A 同窗对照）
./scripts/rpc-probe.sh                                       # 宿主侧只读 RPC 计时（session.list vs host.describe）
./scripts/capture-session-list.sh                            # 捕获 session.list 真实响应体（回放实验用）
```

### 7.3 与全组纪律的对齐
- 只读：未重启宿主、未 pkill、未改任何产品文件、未用 `sandbox_permissions`（本会话审批已禁用）。
- 锁：`lib/probe-lock.mjs`（单行 `key=value` + `owner.txt.tmp`+rename 原子落盘；任何读取失败一律 ALIVE；从不在未确证死亡时回收）。
- 并发普查：cmdline 口径（含 `--remote-debugging-*` 且不含 `--type=`），**未使用** `readlink(exe)`。
- 阳性对照：页内 `setTimeout` 注入（9/9 报出 120.0 ms），**未使用** CDP `Runtime.evaluate` 注入作对照。
- 引擎与 DPR：每相位页内读回 UA/dpr/视口；未使用 `--force-device-scale-factor`。
- 未与其他线争抢：`w04-plugin-load` / `w07-streaming` 持锁期间本线**只等待**（日志可查）。

---

## 8. 待协调者裁决的两项（会影响全组账本）
1. **更正账本里的"50 个 bundle"归属**：应记入**启动期**（并把 `immediate` 预热层与"50 条全量 create"区分开），而不是"打开设置那一刻"。否则设置点击的真实成本（`agentPreset.list` + 面板重挂 + 遮罩）会被埋没。
2. **`session.list` 的定位需要改写为"并发敏感的尾巴"，而不是"某处固定热点"**：单发 0.24–3.85 s（冷启动 I/O 地板 183 ms 已证）、**4 路并发 13.3–18.2 s（4–10×）**、并发风暴下 >30 s ⇒ 客户端超时 ⇒ 侧栏静默空白。⇒ ① 任何后续验收**禁止用单点 TTFB**，必须用 §5-C4 的**并发矩阵**（4 路 ≤ 单发 1.2×）；② 建议优先派执行档做 **C4a（single-flight/memo）**，它成本最低、直接打在放大机制上；③ 回归哨兵沿用"顶层行一条不少 / subagent 上限 200 / `runningSubagentCount`"。此外，本批 ~100 条线**自身的集体首屏**就是该并发的来源之一 —— 多线同时开浏览器会把彼此的侧栏一起拖死，排期上值得错峰。
