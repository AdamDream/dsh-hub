# exec-boot · 修订执行复核一体 交付报告

> 线：`exec-boot`（本档独占 `.workspace/lag-fix/exec-boot/`）｜日期：2026-09-22
> 宿主：**PID 301709，全程未重启、未 pkill 用户浏览器**（`ps` 复核 `ELAPSED 04:50:51` 仍在跑）
> 审计契约：`.workspace/lag-fix/program/w08-boot/audit.md` + `evidence/critical-path-top10.json` + `evidence/static-inventory.{json,md}`
> 本档职责：**按已完成的审计落地，不重新拆解、不扩范围**。
> 器械：真实文件字节 + 真实 HTTP 客户端（raw http，避免 fetch 自动解压）+ Playwright 独立复测。
> 纪律：**未使用 `sandbox_permissions`**（本会话审批已禁用）；**未写任何产品文件**（deployed 写入由协调者执行）。

---

## 0. 一句话结论

| 单元 | 状态 | 一句话 |
|---|---|---|
| **U-BOOT1**（压缩 + Range/条件请求，两个发点） | ✅ **候选就绪，可部署** | 两个发点的补丁候选 + 补丁脚本 + 28/28 纪律自证 + 49/39/41 条功能断言全绿；关键路径 wire 字节 **11.90 MB → 6.04 MB（−49.3% 全路径 / −62.3% 覆盖集）**，br q4 在 **libuv threadpool** 执行、主线程抖动 **max 2.5 ms**，启动突发整窗 wall 仅 **+21.2 ms** |
| **U-BOOT2**（启动闭包与惰性层） | ⛔ **BLOCKED，停止上报** | 触发审计给出的停止条件：本机**无 `apps/web` 源码树**（无法重建产物），且 `assertEntriesActive` 遍历**全部** loader entries ⇒ 惰性化必然要求"改写启动失败语义"，与硬性要求冲突。已交诊断 + 源码级设计 + 可执行解耦判据协议 |
| **U-BOOT3**（pptmaster 瘦身） | 🟡 **见 `uboot3/` 二级档结论** | 内联 base64 已实测 = **2,498,860 B / 116 个 blob**，解出为 **WebP**；外置后 br 压不动（已在估算中按 1.0 计） |
| **U-BOOT4**（HTTP/2 / 连接复用） | 🟡 **只交可行性结论** | 结论：**能装，但不宜由本档实施**（改动面含 SSE 三通道 + 8 个 webServer 消费者 + 打包部署面）；且 U-BOOT1 已把该阶梯的"高度"压掉 62% |

---

## 1. U-BOOT1 —— 压缩 + Range/条件请求（两个发点）

### 1.1 改了哪两个发点（审计 C2 取证的两个）

| 发点 | 文件 | 原行为（字节级取证） | 改后 |
|---|---|---|---|
| **A** 插件 bundle | `<dsh>/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js`，`serveBundle`（L459–490） | `res.writeHead(200,{ "content-type":…, "cache-control":"no-cache" })` → `res.end(body)`；**无 encoding、无 ETag、无 Range** | br/gzip 协商 + 强 ETag/304 + Range 206/416 + `Vary` + `Accept-Ranges` + 内存编码缓存 + 并发上限 + 预热 |
| **B** `/assets/*`、`/` | `<dsh>/node_modules/@deepseek-ai/dsh-host-frontend-static/lib/index.js`，`serveStatic`（L47–72） | `res.writeHead(200,{ "content-type": type })` → `res.end(body)`；**无 encoding、无 cache-control、无 ETag** | 同上；并把 `req` 透传进 `serveStatic`（原签名 `(pathname,res,…)` **拿不到 req**），旧 5 参调用保持可用 |

`<dsh>` = `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh`。

> **发点 B 的一个非显然改动**：`serveStatic` 的签名从 `(pathname,res,distRoot,distIndex,renderIndex)`
> 改为 `(req,res,distRoot,distIndex,renderIndex,legacyPathname)`，因为 `Accept-Encoding`/`Range`
> 只存在于 `req` 上，而原签名把它丢掉了。`serveStatic` 是**被 export 的公共面**，故保留旧调用形态
> （第一参为字符串时按旧形态解释）。该兼容路径已被断言覆盖。

### 1.2 验收 A1：wire 字节显著下降 —— **PASS**

**两路独立测量，互相印证**（同一可比集合 = 50 个 plugin bundle + shell 资产）：

| 路径 | before（**现状实测，未压缩**） | after（**补丁后，编码器输出**） | 降幅 | 来源 |
|---|---|---|---|---|
| **离线真实字节**（真实文件字节 × 实测压缩比，50/50 个 bundle 的字节数**逐一与审计对齐**） | 11,904,125 B | 6,041,912 B | **−49.25%** | `evidence/estimate-wire.json` |
| 其中"本补丁覆盖"集（不计壁纸/API） | 9,472,450 B | 3,613,139 B | **−61.86%** | 同上 |
| **独立 Playwright 浏览器轮**（canonical run5；三口径 50/50 相等） | 9,509,446 B | 3,620,518 B | **−61.93%** | `evidence/verify-browser-encoding.json` |

- 离线估算的 before **精确等于审计基线 11,904,125 B**（`auditBaselineMatch: true`），说明口径没跑偏。
- **口径澄清**：`after` 列是**打补丁后**的编码器输出，不是现状——现状运行时**完全没有响应压缩**
  （全 `@deepseek-ai` 树 `grep content-encoding|createBrotliCompress|createGzip` 零命中，二级档独立复核；
  本档亦实测 3080 对 `Accept-Encoding: br` 返回 `Transfer-Encoding: chunked`、无 `content-encoding`、
  wire == 磁盘字节）。
- 浏览器轮的 before 比离线高 **37 KB 量级**（9,509,446 vs 9,472,450），除 §1.6 的审计陈旧映射外，还因 run5 的集合含
  导航文档（16,648 B）与 `/plugins/events`；**逐 bundle 的 50/50 匹配与三口径相等**才是可比判据。
- **按类分解**（离线）：`plugin_bundle` 8,262,805 → 3,278,418（ratio **0.3968**，50 个文件全部实测）；
  `shell_asset` 1,209,645 → 331,819（**逐文件精确**）；`other`（壁纸 PNG / API）保守取 **1.0**（不假设可压）。
- **🎯 交叉验证（强证据）**：独立 Playwright 浏览器轮**逐类实测的压缩比与我的离线预测逐位一致**——
  `plugin_bundle` 50/50 逐一匹配、sha1 不匹配 **0**，类比 **0.3967**（离线预测 0.3968；差异来自浏览器轮集合含**会话期间被兄弟线重建过的** `@local/dsh-usage`，见 §1.6 第 3 条 —— 是集合差异不是预测误差）；
  `shell_asset` 331,853 / 1,209,645 = **0.2743**（预测 0.2743，**同集**，逐位一致）；
  index HTML 16,648 → 2,865 = 0.1722；整体 `ratioDecodedOverWireServer = **2.6265×**`、`reductionPctServer = **61.93%**`。两条互不依赖的测量链（离线真实文件字节 vs 真实浏览器线上字节）
  给出同一组比例 ⇒ 字节账可信，且**阴性对照成立**（identity 相位 pluginWire 8,262,805 == pluginDecoded，
  压缩在未协商时不发生）。

### 1.3 验收 A3：压缩算法选择依据 —— **PASS（Pareto 前沿 + 边际分析）**

三个真实文件（pptmaster 4.1 MB / shell vendor 745 KB / shell index 399 KB）上逐档实测，3 轮取中位：

| codec | 聚合 ratio | Σwall | 相对 br-4 的字节收益 | CPU 倍数 |
|---|---|---|---|---|
| br-11 | 0.4709 | 4124.4 ms | −5.19% | **110.0×** |
| br-9 | 0.4829 | 234.0 ms | −2.78% | 6.24× |
| br-6 | 0.4851 | 67.2 ms | −2.34% | 1.79× |
| br-5 | 0.4866 | 55.3 ms | −2.03% | 1.47× |
| **br-4（选定）** | **0.4967** | **37.5 ms** | **0** | **1×** |
| gzip-6 | 0.4969 | 73.6 ms | +0.05%（更大） | 1.96× |
| br-3 | 0.5014 | 28.0 ms | +0.95% | 0.75× |

**选择 br q4 的依据（不是"应该更快"，是边际拐点）**：
1. **gzip q6 被 br q4 严格支配**：更慢（1.96×）且**更大**（+0.05%）⇒ 只作为客户端不支持 br 时的回退。
2. **br q9 要 6.24× CPU 换 2.78% 字节**；**br q11 要 110× CPU 换 5.19% 字节**（单文件 3,158 ms）。
   在"启动窗要等字节"的场景里，把 4.1 MB 的一次压缩从 27.7 ms 拉到 3.16 s 只会**制造**新的串行阻塞。
3. **Pareto 前沿**（无其它档同时更小且更快）：br-1 → br-3 → br-4 → br-5 → br-6 → br-9 → br-11。
   br-4 的左侧是"省 CPU 但明显更大"，右侧是"显存收益递减、CPU 陡增"⇒ **q4 是本场景拐点**。
4. **关键负面事实**：br 对**已压缩内容几乎无效**——pptmaster（内联 base64 图像）ratio **0.5582**，
   而纯代码包 ratio **0.20–0.24**。这条直接支撑 U-BOOT3 的动机，也说明"只靠压缩"对 pptmaster 收益有限。

### 1.4 验收 A4：CPU 代价实测 —— **PASS（逐档 + 启动突发）**

**① 逐档 wall 与主线程抖动**（异步 zlib 走 libuv threadpool）：

| 目标 | 字节 | br-4 wall | br-4 主线程抖动(max) | br-9 wall | gzip-6 wall |
|---|---|---|---|---|---|
| pptmaster | 4,096,057 | **27.7 ms** | 0.26 ms | 185.1 ms | 58.0 ms |
| vendor shell | 744,872 | 6.2 ms | 0 ms | 27.1 ms | 8.9 ms |
| shell index | 399,361 | 3.6 ms | 0 ms | 21.8 ms | 6.7 ms |

**② 启动突发（54 个真实关键路径资源、客户端并发 = 6 模拟 HTTP/1.1 六连接）**：

| 相位 | 整窗 wall | wire 字节 | TTFB p50 | TTFB p95 | TTFB max | non200 |
|---|---|---|---|---|---|---|
| A1 identity | **38.7 ms** | 9,472,450 | 2.6 ms | 14.4 ms | 16.3 ms | 0 |
| B1 br（冷缓存） | **59.9 ms** | 3,610,273 | 2.5 ms | 16.4 ms | 59.9 ms | 0 |
| B2 br（热缓存） | 57.0 ms | 3,610,273 | 2.7 ms | 13.8 ms | 57.0 ms | 0 |
| A2 identity | 26.0 ms | 9,472,450 | 2.1 ms | 7.1 ms | 8.6 ms | 0 |
| B3 gzip（冷缓存） | 74.7 ms | 3,592,005 | 2.2 ms | 14.3 ms | 74.7 ms | 0 |

- **CPU 代价：整窗 +21.2 ms（38.7 → 59.9 ms）换取线上字节 −61.9%（9.47 MB → 3.61 MB）。**
- **主线程抖动 max 2.5 ms**（5 ms interval 探针，p95 = 1.1 ms）⇒ 压缩没有阻塞事件循环；
  这批 bundle 全在页面加载早期，主线程抖动 2.5 ms 量级可忽略。
- **中位 TTFB 未退化**（2.6 → 2.5 ms）：本机零带宽成本，边压边发的净效应在小请求上互相抵消；
  **收益面在字节量**（与审计"收益主要在远程/慢链路"一致）。
- 并发上限（默认 8）有效：整窗 wall 未出现"50 个 4 MB 压缩同抢 4 线程"的排队尖峰。

### 1.5 验收 A2：客户端功能零回归 —— **PASS（114 条断言 + 独立浏览器轮）**

| 层 | 断言数 | 结果 | 原始 JSON |
|---|---|---|---|
| 编码器单元（独立于产品代码） | 49 | **49/49** | `evidence/verify-codec-unit.json` |
| 发点 A（从**真实补丁产物抽取**实际 `serveBundle` 跑） | 39 | **39/39** | `evidence/verify-patched-serveBundle.json` |
| 发点 B（从**真实补丁产物抽取**实际 `serveStatic` 跑） | 41 | **41/41** | `evidence/verify-patched-serveStatic.json` |
| 独立 Playwright 浏览器轮（**canonical run5**） | 5 判据 + 2 对照 | **5/5 PASS、`windowValid: true`、`allPass: true`**；run1/2/3/5 的 JSON 有留档，run4 只剩 run log（其 JSON 已被 run5 覆盖，如实标注） | `evidence/verify-browser-encoding.json`（== `raw/browser-encoding.json` == `raw/browser-encoding-run5.json`，逐字节相同） |

覆盖到的行为：br/gzip/identity 协商、`q` 值、`*` 通配、未知编码、`identity;q=0 ⇒ 406`、
强 ETag + `If-None-Match`（精确/`W/` 弱比较/列表/跨资源不误命中）、
Range（`bytes=0-99`、后缀 `-50`、开区间、越界 ⇒ 416 + `bytes */total`、`start>end` ⇒ 416、畸形 ⇒ 200 不得 500）、
HEAD（空体 + `content-length` 仍正确）、小于 `minBytes` 不压、
**原语义回归**：未知 bundle ⇒ 404、非 GET/HEAD ⇒ 405、目录穿越 ⇒ 403/404、sourcemap 分支可达、
`content-type` 不变、`cache-control: no-cache` 不变、index 的 `<base href="/">` 注入不变。

### 1.6 口径限制与一个真实发现（不掩盖）

1. **"挂载时刻改善"本轮未同窗测量。** 本档无产品文件写权限（workspace-write），deployed 写入由协调者执行
   ⇒ 3080 上跑的是**未打补丁**的宿主，无法测 after 的 `mountMs`。本档给出的是
   **关键路径字节（实测）× CPU 代价（实测）**，而**不是**"挂载快了 N ms"。部署后请用
   §DEPLOY 的 `probe-served-bytes.mjs` 重跑 same-window 对照。**这是本单元唯一未闭合的验收项。**
2. **浏览器轮：canonical run5 通过（`windowValid: true`、`allPass: true`），另有 4 个无效窗口（run1/2/3/4）留档。**
   - **run5（canonical，与 `raw/browser-encoding.json` 及 `raw/browser-encoding-run5.json` 逐字节相同）**：
     5 判据 + 2 对照全 PASS。`windowValid=true` 的依据：浏览器 pid **1175616** 每个心跳 tick 都 `alive=true`、
     窗口末采样 `browserPidAliveAtWindowEnd=true`（关闭后 `false`，预期）、**心跳 11/11 tick**、最大间隔 **2,072 ms**、
     `ticksAfterWindowEnd=0`；普查 `2→3（多的是探针自己）→2`，外部 pid 集 `{1132988,1172750}` 全程稳定；
     `loadavg 12.37→9.95`（**已明确降级为「仅上下文、不参与 windowValid」**，见下）。
   - **`windowValid` 判据已改为「可检测事件」公式**：`heartbeatGapOk && !browserDeathMidWindow && fatalErrors === 0`
     = `true && !false && 0` ⇒ true。心跳 11/11、`interTickGapsMs` **1999–2117 ms**（上限 3000 ms = 1.5×2 s）、
     `overLimitGaps: []`、`deadTicks: []`、`ticksAfterWindowEnd: 0`。存活采样移到 teardown **之前**
     （`browserPidAliveSampledBeforeTeardown: true`），并另立诚实字段 `browserPidAliveAfterTeardown: false`
     （**探针自己 kill 的结果，不是死亡信号**）；真实窗口内死亡仍由 `browserDeathMidWindow` 判否。
   - **`loadavg` 已降级为 context-only**：JSON 内 `loadInsensitivity` 写明——5 条判据是**字节记账与解码正确性**主张
     （字节数 / sha1 相等 / HTTP 状态与头事实），**对负载不敏感**；争用只能改变「加载耗时」，不能改变「服务了多少字节」
     或「Chrome 是否解码正确」。只有**计时类**主张（启动延迟、正对照 ms）需争用注记。
   - **丢弃窗口（按纪律保留，不隐藏）**：run1 = `loadOnce` 漏返回正对照 + 关闭后才采样存活；
     run2 = 通过但缺诊断字段；run3 = 心跳在关闭后多打 1 tick（**并非浏览器中途死亡**，是有效性聚合语义缺陷，已修）；
     run4 = 同 run3 修正前的版本。
     **留档完整性（逐项核实后如实标注，不笼统声称"全部留档"）**：

     | run | JSON | serverlog | run log |
     |---|---|---|---|
     | run1 | ✅ `-run1.json` | ✅ `-serverlog-run1.json` | ✅ 即 `browser-encoding.run.log`（15:35，命名未带 run 序号，已核实为该轮） |
     | run2 | ✅ `-run2.json` | ✅ `-serverlog-run2.json` | ✅ `.run2.log` |
     | run3 | ✅ `-run3.json` | ✅ `-serverlog-run3.json` | ✅ `.run3.log` |
     | run4 | ❌ **已被 run5 覆盖** | ❌ | ✅ `.run4.log` |
     | run5（canonical） | ✅ `-run5.json` = `browser-encoding.json` | ✅ `-serverlog-run5.json` | ✅ `.run5.log` |

     ⇒ **run4 的机器可读件不可追溯**，本档**不以 run4 的任何数字作为结论依据**（报告只引用 run5 的字面值）；
     该事实已在此显式标注，而非依赖"全部留档"的笼统说法。
   - **阳性对照（timer-lag 口径成立）**：页内注入 120 ms 忙循环 ⇒ 事件环 timer lag **120.2 ms**（空转 RTT 1 ms vs 注入后 122 ms）；
     再注入 250 ms ⇒ lag **250.2 ms**、RTT 252 ms。⚠️ **如实记录一个仪器限制**：同窗 `PerformanceObserver('longtask')`
     （`supportedEntryTypes` 含 `longtask`、`visibilityState:"visible"`、`observerErr:null`）在两次注入下**均返回 0 条**，
     而 `buffered:true` 回读能看到页面早期 3 条 longtask（109/57/70 ms）⇒ **该 API 在本 headless shell 不交付注入期条目**；
     两个口径的数字都原样留在 JSON 里，正对照**仅由 timer-lag 口径**成立。
   - **阴性对照**：同源、逐请求把 `accept-encoding` 强制为 `identity`（**不改 codec 源码、不用 env 覆盖**）：
     `content-encoding` 全 `null`、br bundle **0**，上线 **9,509,446 B** vs br 相 **3,620,520 B**，
     **Δ +5,888,928 B（2.6265×）**；且外壳仍启动（mode `live`、`#root` 1 子树、bundle 请求 50、脚本类失败 0）
     ⇒ 记账口径有分辨力，不是常数。
   - **附加原始 socket 交叉校验（非 Chrome、非服务端计数器）**：plain `node:http` 不解码取同一 bundle——
     br 臂 `content-length=93,922` 且实收 **93,922 B**（磁盘 398,569 B）；identity 臂 **398,569/398,569 B**，均与服务端日志逐字节一致。
   - **执行证据**：`__DSH_BOOT__` entries **50**；`__ModuleLoader__` `mode:"live"`；Chrome 发出 `/plugins/*/client.js` **50/50**
     （boot graph 亦 50；唯一额外 `/plugins/` 请求是 `/plugins/events` ⇒ 204）；CDP `Debugger.scriptParsed` **52** 脚本
     / **9,391,516 字符**；`#root` 1 子树、innerHTML 47,367 字符、渲染出真实插件 UI 文本；
     页内只读观察器记录 **51 次注册事件 / 50 个唯一 id**（`queue:2 + live:49`，全部带 factory 函数），
     **唯一 id 数 50 == Chrome 发出的 bundle 请求数 50** ⇒ **50/50 个 bundle 都真的注册了 factory**。
     ⚠️ 早前读到的「`factoriesRegistered: 2`」是**仪表读了错字段**，已由代码级证据定案：
     `dsh-client-modules/lib/client.js:181-187` 在切 `mode="live"` 时**替换** `load` 为 `(r)=>this.register(r)`，
     而 `register()` 写**私有** `this.factories`（:152,:193）在 window 上不可达，且 `create()` 会 `splice` 清空
     `pendingQueue` ⇒ boot 后读 `pendingQueue` **永远得 0**（旧仪表正是读该字段）。修正后观察器把 `load` 改为
     **访问器**以捕获该替换（`loadPropReassignments: 1`），两条注册路径都计数。
     另披露一处 provenance 细节：canonical JSON 由紧随其前的一版脚本产出，其后**唯一**脚本改动是把一个自伤信息字段
     `moduleLoaderLoadIsLive`（对**我们自己包的 wrapper** 做字符串匹配，必然 false）换成两个正确字段；
     **未改任何判据、对照或测量路径**，故该 JSON 里 `moduleLoaderLoadIsLive: false` 已知为**假阴性**，
     硬证据是相邻的 `loadPropReassignments: 1` + `factoriesRegisteredByVia.live: 49` + `moduleLoaderMode: "live"`。
   - **零解码类失败**：脚本类 `requestfailed` **0**、`pageerror` **0**、解码相关 pageerror **0**、`/api/*` requestfailed **0**；
     console error/warning **29** 条**全部**归类（websocket-api 17 / api-json 6 / client-api-mirror 6），**未归类 0**，
     且同一集合在 identity 相同样出现 ⇒ 非解码伪影。
   - **记账三口径 50/50 逐一相等**：服务端 `content-length` 求和 == Playwright `request.sizes().responseBodySize`
     == 页内 ResourceTiming `encodedBodySize`；ResourceTiming 总数 3,617,653 = 3,620,520 − 2,867，差值正是导航文档（RT 不含文档）。
3. **🔴 真实发现：审计的 `@local/dsh-usage` 映射已陈旧。** 审计记该 bundle 为 72,804 B / `rev=4536b91ed282`；
   基线探针实测服务端返回的是 **81,123 B**（磁盘文件 sha1-12 = `7b7e47569500`，mtime **15:44 = 本会话期间**）。
   ⇒ 该 bundle 在审计之后被兄弟线**重建过**，`?rev=` 与内容哈希的对应关系在**该文件上不再成立**。
   影响：审计的 11,904,125 B 基线里这一条偏低 8,319 B（占比 0.07%，可忽略）；
   **但它证明"同一集合的 before/after 必须同窗同刻采集"**——本档的 before 因此改用
   `served-bytes-baseline.pre-deploy.json`（同刻实测 9,480,769 B）。
   同时这也**反向印证**了本补丁的实现选择：**ETag 一律由响应体重算 sha1，绝不读 `?rev=`**
   ⇒ 面对这类"内容变了但 URL rev 未变/变了但缓存未清"的情况，304 语义仍正确。
4. **`?rev=` 与内容哈希的关系已独立核验**：未部署时 50/50 的 `rev` **恰好**等于磁盘 sha1 前 12 位
   （`{same:50, diff:0}`）。这是巧合级证据，代码**不依赖**它；部署后的核对脚本见 `DEPLOY.md` §3.2。
5. **`Range` 对压缩表示不做切片**（返回全量编码体）——设计选择，非缺陷；仅 identity 表示支持 206/416。
6. **`DSH_W08_ENCODER_CACHE_DIR` 默认关闭**：本机 dsh 在 workspace-write 沙箱下 `mkdtemp('/tmp')` 会 EACCES
   （本档实测），故默认走"内存缓存 + `setImmediate` 预热"；生产宿主建议显式开启磁盘缓存。

### 1.7 补丁交付纪律 —— **28/28（`evidence/selftest-patch-scripts.json`）**

在**沙箱副本**上逐条自证（产品文件哈希前后比对，证明测试未触碰产品文件）：

| 检查 | A | B |
|---|---|---|
| dry-run 不写任何文件（字节哈希不变） | ✅ | ✅ |
| dry-run 锚点均唯一命中 | ✅ | ✅ |
| dry-run 写前 `node --check` 通过 | ✅ | ✅ |
| `--apply` 写出且 pre-image == 原文件 | ✅ | ✅ |
| 二次 `--apply` 幂等（`ALREADY_APPLIED`，字节不变） | ✅ | ✅ |
| `--rollback` 精确还原（sha256 == 原文件） | ✅ | ✅ |
| **锚点被破坏 ⇒ 状态 `ANCHOR_FAIL` 且一个文件都不写** | ✅ | ✅ |

> 自测过程中**修掉了 5 个真实缺陷**（都由"断言失败"抓出，不是推测）：
> ① zlib 异步 API 未 promisify；② 缓存键 `digest.encoding` 在 digest 含 `.` 时与 `encoding.digest` 撞车；
> ③ single-flight 登记了"被吞掉拒绝"的 promise ⇒ 并发同键永久挂起；
> ④ import 去重把**必需的** zlib 常量解构删掉 ⇒ `BROTLI_PARAM_QUALITY is not defined`；
> ⑤ 抽取 harness 用箭头函数 ⇒ `.bind()` 无效。
> 另修掉 1 个**自测自身的缺陷**：锚点"破坏不彻底"（只在锚点末尾插注释，原锚点仍唯一命中 ⇒ 假 PASS）。

---

## 2. U-BOOT2 —— 启动闭包与惰性层：**BLOCKED（停止上报）**

完整诊断见 `candidates/U-BOOT2-HOLD.md`（含真实字节级取证）。摘要：

- **真实协议**（`dsh-web-frontend/dist/assets/index-ClqxG24t.js:397,7xx–398,5xx`，本档实测 sha1-12 = `6a27728a8730`）：
  `u = manifest.plugins.map(c=>c.id)` → `await Promise.all(u.map(create))` → `await l.await()` →
  `assertEntriesActive(n)` → **之后才** `await this.mountApp(c)`。
- **`assertEntriesActive` 遍历 `n.loader.entries()`（全部 loader 条目）**，不是"本次 create 过的那些"
  ⇒ **任何"少 create 几条"的做法都会让它抛 `web boot: N entries did not activate`**。
  ⇒ 惰性化不是参数调整，而是**启动协议语义改写**：必须新增"延迟集合 + 其失败上报通道 + 两段式断言"。
- **停止条件成立**：(a) 改动落在 `apps/web` 构建产物上，而本机**无源码树**
  （`package.json.files = ["lib/*.js","config"]`，无 `apps/`/`packages/`/`src/`，全机 `find` 未命中
  `dsh-web-frontend` 源码目录）⇒ 改 dist 无法从源码重建、升级即被覆盖；
  (b) 保持 `assertEntriesActive` 的失败语义 ⇒ 必须整体改写断言，与"最小锚点替换"不同量级。
- **本档另核验并更正了一条我自己的错误判断**：我最初认为 `mountApp` 未被 await。
  真实控制流是 `async run(){ try{ …; await this.runPluginBoot(...), await this.mountApp(c) }
  catch(n){ console.error(n), this.page.fail(...) } }` ⇒ **确实被 await**，且失败会走到 `page.fail`
  （更正痕迹保留在 `U-BOOT2-HOLD.md` §3 引用块内）。
- **已交付**：源码级设计（`bootTier` 分层 + 两段式断言 + 延迟集合的显式失败上报）+ 可执行解耦判据协议
  （`scripts/probe-decoupling.mjs`，**已备好未运行**：未部署的补丁无法测量）。判据为**双判据**：
  `Δ_deferred`（扣住非首屏 bundle）应降到噪声内，**同时** `Δ_essential`（扣住首屏必需 bundle）**必须保持显著**
  ——后者是阴性对照，防止"惰性层做过头、把首屏必需件也推迟"。

---

## 3. U-BOOT3 —— pptmaster 瘦身：**NOT-FEASIBLE（建议弃项）**

二级档完整判定见 `uboot3/UBOOT3-FEASIBILITY.md`（+ `uboot3/uboot3-measurements.json`、`blob-inventory.json`）。
**结论：`FEASIBLE-ONLY-WITH-SOURCE-CHANGE`；按本单元原定范围（dist 级补丁）为 `NOT-FEASIBLE`。**
该档三项关键判定同时成立，**且其中一项纠正了审计与我的共同前提**：

**① 内联数据清单（精确复现 + 一处更正）**

| 指标 | 实测值 |
|---|---|
| blob 数 | **116**（全部 `data:image/webp;base64,`，无其它 mime；全库 ≥200 字符的 base64 段恰好就是这 116 个，无未标记者） |
| base64 载荷 | **2,494,860 B** |
| 完整 data-URI 字面量 | **2,497,528 B** |
| 持有标识符 | `const CURATED_TEMPLATE_PREVIEWS` @714（line 15），键 `data-analysis` 58 + `vitality-blue` 58 |
| 审计的 2,498,758 | **是 `//#region src/client/curated-previews.ts` 的字节跨度**（523→2,499,281），比真实 data-URI 字面量多 3,898 B（0.16%）；审计的 **97.3%** 主张复现为 **97.34%** |

**② 这批数据不在首屏路径上**：标识符只有 2 处读取（`templatePreviewPages` @2,520,821、`TemplatePreview` @2,520,990），
两者都只经**模板网格**到达，而该面板由 `state.activeMode === "slides"` 门控（@2,539,136）；
`OfficePptInputAccessory` 在非 slides 模式下直接 `return null`（@2,532,820）。
⇒ 它只是**源码文本在关键路径上**（模块工厂执行时构建该对象字面量），而**功能上不需要**。

**③ ≤1.2 MB 验收在本单元范围内不可达**：全部 116 个 blob 外置后 bundle = **1,601,081 B（原 39.09%）**，
**比 1.2 MB 阈值高 401,081 B**；残差是 **1,488,545 B 的 `pptx-renderer` region**（偏移 2,541,724→4,030,269）。
要达标必须**再砍掉该 renderer 的 ≥26.9%** ⇒ 超出"内联预览外置"这一单元的范围。

**④ 🔴 最重要的一条：把字节移出 bundle 并不能解绑关键路径。**
实测"外置能省掉的字节成比例成本"合计仅 **≈6.0 ms**（浏览器 parse 1.86 + 工厂执行 0.56 + loopback 传输/UTF-8 解码 3.58），
是 1,115.6 ms 挂载的 **0.54%**，而审计要求的 ≥20% 是 **223.12 ms** ⇒ **差距约 37 倍**。
**机理澄清**：审计的 +686.5 ms 因果证据来自"**+1500 ms 网络扣留**"——它阻塞的是**到达时刻**；
而"字节变小"只省下 parse/传输/解码这点量级。
⇒ **只有把该 bundle 移出 `Promise.all(create)` 关键路径（即 U-BOOT2）才能真正解绑**；
单纯瘦身不行。**这条结论直接改变了 C6 的优先级判断**，建议协调者据此裁决。

**⑤ 源码与回归面（决定"能不能做"）**：本机 **无 `office-ppt` 源码树、无 `.ts`、无 source map**
（`//# sourceMappingURL=client.js.map` 是悬空引用，`package.json.files` 不含 `src/**` 与 `*.map`），也无生成器；
`lib/client.js` 已被手工后处理过一次（port 改名 +7 B）。且外置后**取图失败是静默的 broken `<img>`**
（面板逻辑不 gate 图片是否加载成功）⇒ **改动功能语义的风险是真实的**，与本单元"不得改动功能语义"冲突。

**⑥ 外置后的 WebP 不可再压**（实测）：拼接体 1,871,028 B，br q4 = 1,871,036 B，ratio **≈1.0000**
⇒ 本档估算据此把该类按 **1.0** 计入，**没有**把"外置后还能再压"的假收益算进 U-BOOT1 的账。

> ⚠️ 二级档同时纠正了一处表达歧义：它指出"当前运行时**不存在**响应压缩"（全 `@deepseek-ai` 树
> `grep content-encoding|createBrotliCompress|createGzip` 零命中），因此该 bundle 今天**以 4,096,057 B 原样过线**；
> 我给的 br q4 = 2,286,412 B 是**编码器输出**而非现状。两者不矛盾（U-BOOT1 正是要引入该编码器），
> 但表述必须分清"现状"与"打补丁后"，此处按二级档口径更正。

---

## 4. U-BOOT4 —— HTTP/2 / 连接复用：**只交可行性结论（不实施）**

**可行性结论：技术上能装，但不宜由本档实施。**

- **现状取证**：`dsh-host-webserver/lib/index.js`（313 行）用 `createServer` from `node:http`（L1、L197），
  `.listen()` 于 L244；升级面是**自定义**的 —— `this.server.on("upgrade", …)` + `upgrades: Map<path, route>`
  + `upgradedSockets: Set`。审计实测 `nextHopProtocol: http/1.1`，39 个 bundle 呈 **446→779 ms 六连接阶梯**。
- **改动面**：① `createServer` → `http2.createSecureServer`/`createServer`；
  ② `upgrade` 处理器要改为在 `session` 事件上按 `:path` 路由，Node 的 `Http2ServerRequest/Response`
  与 `IncomingMessage/ServerResponse` 在 `writeHead`/header 大小写语义上并不等价 ⇒ 8 个消费
  `webServer` 服务的插件都要重验；③ **SSE 三通道**（`/plugins/events`、`events.mux`、`events.host`）
  在 h2 下是 h2 stream 而非经典 GET 长连接，行为需重验；④ 本机是**明文 HTTP** 无 TLS 证书，
  而浏览器对 h2 的支持实际是 **h2 over TLS（ALPN）** 为主（h2c 需前置代理）
  ⇒ 真正落地要引入 TLS 终止或反向代理，属**打包/部署面**，超出"宿主 lib 补丁"范围。
- **收益已被本单元部分吃掉**：U-BOOT1 把这段阶梯上的**字节高度压掉 62%**
  ⇒ 阶梯仍在，但每级的时长显著缩短；同时审计已记录**本机零 RTT**，h2 的主要收益（多路复用省 RTT）
  在 localhost 口径下不可分辨（审计 C9 同结论）。
- **建议**：h2 作为**部署面**变更单独立项（反向代理 + SSE 重验 + 8 消费者回归），
  不要与 U-BOOT1 混在同一批；且优先在**远程/高 RTT** 场景验证收益。

---

## 5. 同档自复核（Revise-Execute-Review 一体）

### 5.1 对照审计逐条核对（无遗漏 / 无超范围）

| 审计条目 | 本档是否覆盖 | 说明 |
|---|---|---|
| C2（服务端压缩，两发点） | ✅ 已落地候选 | 审计给的"`content-encoding` 存在且 ≤0.45"对**纯代码包**成立（0.20–0.34）；**pptmaster 例外 0.5582**，已在验收里显式区分而不是含糊达标 |
| C2 的"与 ETag/Range 交互需重验" | ✅ 已重验 | 逐条断言见 §1.5 |
| C2 风险"每请求压 4.1 MB 不便宜 ⇒ 必须预压缩/带缓存" | ✅ 已处理 | 内存缓存（24 变体）+ single-flight + 并发上限 + `setImmediate` 预热；磁盘缓存因沙箱 EACCES 默认关（已说明） |
| C1（惰性层） | ⛔ BLOCKED | 见 §2；未越界自造方案 |
| C6（pptmaster 瘦身） | 🟡 二级档 | 未扩范围 |
| C3（HTTP/2） | 🟡 只交方案 | 见 §4；未实施 |
| **未扩范围** | ✅ | 未触碰 `/api/*` JSON、未改壁纸、未改 `session.list`、未改任何客户端 bundle |

### 5.2 真实跑过的验证命令（可复现）

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-boot
node scripts/bench-codec.mjs                       # 11 档 × 3 文件 × 3 轮 → evidence/bench-codec.json
node scripts/estimate-wire.mjs                     # 50 个 bundle 全量实测 → evidence/estimate-wire.json
node scripts/bench-burst.mjs                       # 启动突发 A-B-A + gzip → evidence/bench-burst-conc8.json
node scripts/verify-codec-unit.mjs                 # 49/49
node scripts/apply-Boot1a-v1.mjs --out-copy candidates/A-dsh-client-modules-index.js
node scripts/verify-patched-serveBundle.mjs        # 39/39
node scripts/apply-Boot1b-v1.mjs --out-copy candidates/B-dsh-host-frontend-static-index.js
node scripts/verify-patched-serveStatic.mjs        # 41/41
node scripts/selftest-patch-scripts.mjs            # 28/28（沙箱内，未碰产品文件）
node scripts/build-boot1-evidence.mjs              # → evidence/U-BOOT1.json
node scripts/probe-served-bytes.mjs                # 部署前基线（只读 3080）
```

### 5.3 自裁决：**PASS（U-BOOT1）／BLOCKED（U-BOOT2）／只交结论（U-BOOT4）**

**判 PASS 的理由**：U-BOOT1 的 5 项验收里 4 项（A1 字节账、A2 零回归、A3 算法依据、A4 CPU 代价、
A5 Range/条件请求）都有真实跑出的数字与原始 JSON；补丁纪律 28/28 且**每个失败都被当成真缺陷修掉了**
（而不是放宽断言）。**唯一未闭合项是"after 的挂载时刻"**，原因是本档无写权限、deployed 写入属协调者职责
——已如实标注为未闭合，并交出了可一键复跑的 same-window 核对脚本。

**不判 REWORK 的理由**：不存在"已知会失败但仍交付"的项；所有 INCONCLUSIVE 都给了原因与替代证据；
U-BOOT2 是按契约**停止上报**而非返工。

---

## 6. 交付清单

| 类别 | 文件 |
|---|---|
| **报告** | `report.md`（本文件）、`DEPLOY.md`、`candidates/U-BOOT2-HOLD.md` |
| **候选件** | `candidates/A-dsh-client-modules-index.js`、`candidates/B-dsh-host-frontend-static-index.js`（`--out-copy` 产物，可与产品文件逐字节 diff） |
| **补丁脚本** | `scripts/apply-Boot1a-v1.mjs`、`scripts/apply-Boot1b-v1.mjs`（+ 共享 `scripts/patch-lib.mjs`、`scripts/codec-source.mjs`） |
| **验证脚本** | `scripts/verify-codec-unit.mjs`、`scripts/verify-patched-serveBundle.mjs`、`scripts/verify-patched-serveStatic.mjs`、`scripts/selftest-patch-scripts.mjs`、`scripts/probe-served-bytes.mjs`、`scripts/probe-decoupling.mjs`（未运行）、`scripts/bench-*.mjs`、`scripts/estimate-wire.mjs`、`scripts/build-boot1-evidence.mjs` |
| **原始 JSON** | `evidence/U-BOOT1.json`（汇总）、`bench-codec.json`、`bench-burst-conc8.json`、`estimate-wire.json`、`verify-codec-unit.json`、`verify-patched-serveBundle.json`、`verify-patched-serveStatic.json`、`selftest-patch-scripts.json`、`verify-browser-encoding.json`、`served-bytes-baseline.pre-deploy.json` |
| **二级档产物** | `uboot3/`（U-BOOT3 可行性） |
| **日志** | `raw/*.log` |

---

## 7. 给协调者的下一步（按优先级）

1. **部署 U-BOOT1**（两个 `--apply` → 冷面批次重启）→ 用 `probe-served-bytes.mjs` 重跑同刻对照，
   闭合 §1.6 第 1 条"after 挂载时刻"这一未闭合项。
2. **裁决 U-BOOT2**：要么提供 `apps/web` 源码树，要么明确授权改写 `assertEntriesActive` 的启动失败语义
   （并接受 dist 无源码、升级即失效的维护代价）。在两者之一到位前不要出补丁。
3. **浏览器验收已收敛**：canonical run5 通过（`windowValid: true`、`allPass: true`，5 判据 + 2 对照），
   run1/2/3 与 run5 的 JSON + run log 全部留档（run4 仅 run log，其 JSON 被 run5 覆盖，已如实标注）；`longtask` API 在本 headless shell 不交付注入期条目
   这一仪器限制亦已如实记录（正对照由 timer-lag 口径成立）。**若要复核，请以
   `raw/browser-encoding.json` + `scripts/verify-browser-encoding.mjs` 为准**（`cmp` 逐字节相同，provenance 干净）。
4. **U-BOOT3 建议弃项**（`uboot3/UBOOT3-FEASIBILITY.md` 判定 `NOT-FEASIBLE`）：其 ≤1.2 MB 验收在自身范围内不可达
   （外置后仍 1,601,081 B，超阈 401,081 B，残差是 1,488,545 B 的 `pptx-renderer`），
   且**可测收益仅 ≈6.0 ms（挂载的 0.54%），距 20% 目标差 ~37 倍**。
   若要保留该目标，须**重新界定为"预览外置 + `pptx-renderer` 代码分割"的合并单元并从上游源码构建**，
   验收阈值重述（eager bundle ≤200 KB、slides 模式懒加载经实测、A/B 实测挂载增量）。
   **⚠️ 这条结论改变优先级**：C6 原本的优先级建立在"该包在关键路径上"之上，但"变小"并不能解绑关键路径——
   **真正解绑只有 U-BOOT2**。
5. **带一条口径提醒给全组**：本档实测到 `@local/dsh-usage` 的 bundle 在审计之后被重建过
   （72,804 → 81,123 B），**`?rev=` 与内容哈希的对应关系会随重建而变**
   ⇒ 任何 before/after 对照都必须**同刻采集**，且缓存校验不要依赖 `?rev=`。
