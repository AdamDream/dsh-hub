# w16-llm 审计：模型 / LLM 网关路径（DSH 性能与操作体验，波次 2）

- 审计线：`w16-llm`（独占目录 `.workspace/lag-fix/program/w16-llm/`）
- 日期：2026-09-22（午后至傍晚；**宿主已重启**，本轮全部读数取自**新宿主 pid 2988915**）
- 只读审计：**未修改任何产品文件 / settings / profile**。所有实跑 = 纯 Node + 本地回环 HTTP 服务器 + 只读 RPC。
- 原始证据：`raw/w16-http.json`、`raw/w16-retry.json`、`raw/w16-resolve.json`、`raw/w16-settings.json`、`raw/w16-timeout.json`、`raw/settings.yaml.snapshot-w16`
- 探针脚本：`raw/w16-probe-http.mjs`、`raw/w16-probe-retry.mjs`、`raw/w16-probe-resolve.mjs`、`raw/w16-probe-settings.mjs`、`raw/w16-probe-timeout.mjs`

---

## 0. 口径与自曝（先说清楚哪些保证**不成立**）

### 0.1 本轮窗口**没有**满足 §五.2 的排他门禁——必须打折声明

| 项 | 实情 |
|---|---|
| 锁 | 我起初在**一次性 `node -e` 进程**里取锁（pid 3016745）⇒ 该进程退出后锁成**陈旧残留**（属主已死）。期间我未再持有。**收尾时锁已由存活兄弟线 `w25-conversation`（pid 503806，purpose `conv2 typing/scroll dose`）合法回收并持有**（其 `liveness=ALIVE`）。我的 `release()` 返回 `NOT_MINE` 并**正确地没有动它**。⇒ **这是我的纪律失误**：锁应在长命探针进程内取。**未伤害任何兄弟线**（回收只发生在我的 pid 被确证死亡之后）。 |
| 外来浏览器 | 我的测量窗口内**存在 1 个外来浏览器主进程**（`chromium_headless_shell`，cmdline 口径含 `--remote-debugging-pipe` 且不含 `--type=`），另 loadavg 7.9–9.9。 |
| 结论 | ⇒ **本轮所有窗口按 §五.2 判为「非排他」**。我**不**主张任何 "quiet gate: foreign=0" 保证。 |

### 0.2 为什么非排他窗口下结论仍然可用（**按判据类型分级**，不搞一刀切）

本轮结论**不依赖边缘毫秒**，而依赖三类**对污染不敏感**的量：

1. **计数类（污染无关）**：TCP 连接数 1 / 4 / 8；HTTP 请求数 3；重试轮数 6 / 40 / 1。计数不受 CPU 争用影响。
2. **精确值类（有阳性对照锚定）**：退避 `[500,1000,2000,4000,8000]` 与 `±10%` 抖动是**代码算出的确定值**，实测逐值吻合；TTFT 阳性对照注入 300 ms ⇒ 报 303.3 ms（Δ300.9）。
3. **比值/占比类（同窗内自比）**：每块边际成本由**同窗 4 点最小二乘**得出，非跨窗绝对值。

**明确不作数的**：任何"本机 LLM 首 token 绝对值"、"llm.models 的绝对延迟"都**不得**当作生产数字；报告里已逐处标注。

### 0.3 与 §五 相关的两处仪器纪律（本轮遵守）
- §五.8（`monitorEventLoopDelay` 不得在阻塞前 `reset()`）：本轮**改用 10 ms 心跳间隔**判定"退避是否阻塞"，**完全绕开**该陷阱（探针 `w16-probe-retry.mjs` Q2）。
- §五.1（并发口径必须按 cmdline 且排除 `--type=`）：全部快照按此实现（探针内 `concurrencySnapshot()`）。

### 0.4 未撤回项核对
本报告**未引用** `incident2/VERDICT.md §二` 的任何已撤回结论，也未引用 `FINDINGS-INDEX.md` 标注需裁决的 `session.list` 旧性能数字。

---

## 1. 部署事实基线（本轮实测 sha256，用于跨线对账）

| 文件 | sha256（前 16） | 备注 |
|---|---|---|
| `@deepseek-ai/dsh-llm/lib/index.js` | `90de54c106866d93` | 71,462 B |
| `@deepseek-ai/dsh-llm-retry/lib/index.js` | `41d782e3a88871b0` | 6,600 B / 193 行 |
| `@deepseek-ai/dsh-llm-pi-ai/lib/index.js` | `e183a9cdde703b47` | 105,974 B |
| `@deepseek-ai/dsh-llm-deepseek/lib/index.js` | `0d2ba750c5d9c12a` | 84,474 B |
| `@deepseek-ai/dsh-settings/lib/index.js` | `18e5dd394cf88b8d` | 26,666 B |
| `@deepseek-ai/dsh-timeout/lib/index.js` | `744fdb4f79c8d513` | — |
| `@deepseek-ai/dsh-agent-default-model/lib/index.js` | `3f9ec5b953658fa1` | — |
| `node_modules/openai/package.json` | `24889958f2fc85cc` | openai SDK **v6.26.0** |
| `~/.dsh/settings.yaml` | `18b2644ee62c0c55` | 6,258 B，mtime 2026-09-22 15:21:28 |
| 运行时 | Node **v22.23.2**；`@earendil-works/pi-ai` **0.82.1** | — |

> ⚠️ **`settings.yaml` 在本轮中途被改过**（15:21:28；`agent-default-model.model` 由 `qwen3.8-flash` → `deepseek-v4-pro`）。我两次读取都留了快照，**本报告以 15:21 之后的版本为准**（`raw/settings.yaml.snapshot-w16`）。

### 1.1 实际生效的出站路径（**这是全篇的前提**）

```
dsh-agent-loop  →  ctx.llm.stream(request)
   └─ dsh-llm (provider 注册/解析)
        └─ dsh-llm-pi-ai  (adapter；provider 路由到 pi-ai)
             └─ @earendil-works/pi-ai  dist/api/openai-completions.js:102 stream()
                  └─ openai SDK v6.26.0  new OpenAI({...})  (openai-completions.js:505-510)
                       └─ 裸 globalThis.fetch  →  Node 内建 undici
```

依据：`settings.yaml:73-76` `adam` 段 `api: openai-completions` + `baseURL: https://llmapi.roboscience.xyz/v1`；`agent-default-model: {provider: adam, model: deepseek-v4-pro}`（`:186-188`）。
**`dsh-llm-deepseek` 路径在本部署未被 `adam` 使用**（`settings.yaml:3` `llm-deepseek: {}`，且活体目录只 advertise `deepseek-official`）。

---

## 2. 逐条结论（PASS / FAIL / INCONCLUSIVE）

编号规则：`A#`=① 模型解析链，`B#`=② 重试退避，`C#`=③ 出站 HTTP，`D#`=④ 流式成本，`E#`=⑤ 能力声明与路由表。

### 2.1 ① 模型解析链

| # | 主张 | 证据（file:line） | 实跑数值 | 判 |
|---|---|---|---|---|
| **A1** | `settings.yaml` 的 provider/model 表**逐条**进入运行时目录（50↔50，零差异） | `dsh-host-apiproxy/lib/index.js:1010-1038 buildModelCatalog()`（`listProviders`→`listModels`→`resolveModelInfo` 全链） | `llm.models` 实测 `groups=3`：`deepseek-official` 3 / `opencode-go` 16 / **`adam` 50**；`failures=[]`；与 `settings.yaml:77-185` 的 adam 段对账 **onlyInSettings=[] onlyInLive=[]** | **PASS（端到端）** |
| **A2** | 解析链往返成本 | 同上 | `llm.models` 遍历 69 模型：**med 60.3 ms**（n=5，`raw/w16-resolve.json`）。⚠️ 非排他窗口 ⇒ **只作"不构成瓶颈"的存在性判据，不作生产绝对值** | **PASS（量级）** |
| **A3** | 输入模态解析链 = 声明 → 内置目录 → 路由默认 | `dsh-llm-pi-ai/lib/index.js:651` `input: declaredInput(entry.input) ?? base?.input ?? [...request.defaultInput]`；`:286-288 declaredInput()`（空数组=未声明）；`:862 DEFAULT_INPUT = ["text"]` | — | **PASS（静态确证）** |
| **A4** | 自定义 provider（`adam`）**没有内置目录**⇒ `base=undefined` ⇒ 未声明 `input` 的模型解析为 `["text"]` | `:609 defaults = catalogModels(provider)`；`:615/:624` 明确"内置目录不描述该路由"即 `defaults.size===0` | 实测 `builtinProviders()` = **38** 个，**不含 `adam`**、含 `opencode-go` | **PASS** |
| **A5** | 带图请求遇到未声明 `input` 的模型是**硬错**，不是静默丢弃 | `dsh-llm-pi-ai/lib/index.js:1721` `if (containsImage && !model.input.includes("image")) throw new LlmError(..., "UNSUPPORTED_CONTENT")`；`:1723` 无 attachment 服务亦抛 | — | **PASS（静态确证）** |
| **A6** | **`adam` 段 50 个模型里只有 3 个声明了图像输入** | `settings.yaml:81-85`（deepseek-v4-pro）、`:176-180`（deepseek-v4.1-flash）、`:181-185`（deepseek-v4-flash-vision-exp） | 我逐行核对了 50 个条目：`input:` 出现 **3** 次 | **FAIL（缺口）**：其余 **47** 个（含 `claude-opus-4-6`、`gpt-5.6-sol`、`gemini-3.5-flash`、`qwen3.7-max` 等命名上明显具备视觉能力的模型）在附件图片时会**硬失败** |
| **A7** | 上述 47 个"上游其实支持视觉" | — | **未实发** | **INCONCLUSIVE（未能量化）**：需要逐模型实发一条含图请求才能确证；本轮**不做**（会污染用户会话且需要附件）。**A6 的本地链条结论不受影响**。 |
| **A8** | `input` 缺失且带图时 pi-ai 内部会 `TypeError` | `@earendil-works/pi-ai/dist/api/openai-completions.js:972` `if (hasImages && model.input.includes("image"))` | 我在最小复现里**实际拿到过** `Cannot read properties of undefined (reading 'includes')`（未填 `input` 时，请求**未到达服务器**） | **PASS（边界确证）**，但运行时不命中：`:651` 保证 `input` 总被填充 |
| **A9** | 成本字段：自定义路由的模型 `cost` 恒为 `NO_COST` | `dsh-llm-pi-ai/lib/index.js:652` `cost: base?.cost ?? NO_COST`（`:266 NO_COST`）+ A4 | 静态确证：`adam` 全部 50 个模型 `cost = NO_COST` | **PASS（静态）**⇒ 对 `adam` 路线的成本记账恒 0。**是否影响 UI 展示须交 `w05-usage` 线裁决**（越界，不在本线判） |

### 2.2 ② 重试与退避

| # | 主张 | 证据（file:line） | 实跑数值 | 判 |
|---|---|---|---|---|
| **B1** | **三层重试里只有一层生效** | ① openai SDK：`pi-ai/dist/api/openai-completions.js:137` `maxRetries: 0`（显式禁用）；② pi-ai `retryProviderRequest`：`:139-143` 传 `maxRetries: options?.maxRetries`，而 `utils/provider-retry.js:76` 默认 **0**，adapter 不传 ⇒ 禁用；③ `dsh-llm-retry` on `agent/request-error` | 我的探针只观测到**第③层**在动作 | **PASS**：无"双重退避"叠加 |
| **B2** | 默认策略常量 | `dsh-llm/lib/index.js:356-366`：`maxRetries=5`、`initialDelayMs=500`、`maxDelayMs=10000`、`jitterRatio=0.1`、`retryableCodes={EMPTY_RESPONSE,RATE_LIMIT,SERVER,TIMEOUT,TRANSPORT}`；`:425-431 resolveRetryPolicy(undefined)` 即此默认 | **活体交叉验证**：`settings.describe` 的 `llm-pi-ai` schema 里这些默认值以 `meta.default` 出现（`raw/w16-settings.json`）⇒ 与我的 harness 常量一致 | **PASS（双通道）** |
| **B3** | 退避时间表 | `dsh-llm-retry/lib/index.js:44-49 localDelay()` | **驱动真实模块**实测：`[500,1000,2000,4000,8000]`，合计 **15 500 ms**，6 轮后终止 | **PASS（端到端）** |
| **B4** | 抖动范围 ±10% | 同上 `:47 1 - jitterRatio + 2*jitterRatio*random()` | `random=0` → `[450,900,1800,3600,7200]`；`random=1` → `[550,1100,2200,4400,8800]` | **PASS** |
| **B5** | `maxDelayMs` 上限在 normal 模式下**永不生效** | `:46` `min(..., maxDelayMs)` | 最大退避 8000×1.1 = **8800 < 10000** ⇒ 封顶分支不可达（normal 模式最多 5 次） | **PASS（观察）**：上限形同虚设，但无害 |
| **B6** | **退避不阻塞**（不占事件循环） | `:68-81 cancellableDelay()` = `setTimeout` + abort 监听 | 500 ms 退避期间 10 ms 心跳间隔：**min 10.05 / med 10.09 / max 11.17 ms（n=47）** ⇒ 无拉长 | **PASS** |
| **B7** | 终态：5 次重试后**不再重试**，抛原始失败码 | `:171` `previousRetry >= policy.maxRetries → next()`；`dsh-agent-loop/lib/index.js:655-665`：`action?.kind !== "retry"` ⇒ `throw new LlmError(finish.failure.message, finish.failure.code, ...)` | 实测第 6 轮返回 `undefined`（= `next()` 默认值）⇒ 命中 `:664` 抛出 | **PASS** |
| **B8** | 非可重试码**确实不重试** | `:166` `!policy.retryableCodes.includes(failure.code) → next()` | `INVALID_CREDENTIAL` → **1 轮、0 条 `llm/retry` 事件** | **PASS** |
| **B9** | 采纳 provider 的 `Retry-After` | `:175-179` | `providerRetryAfterMs=250` ⇒ 实测退避**恰 250 ms** | **PASS** |
| **B10** | `Retry-After > maxDelayMs` 在 normal 模式**直接放弃重试** | `:175-177` `if (> maxDelayMs) { if (mode==="normal") return next(); ... }` | `providerRetryAfterMs=60000` ⇒ **0 条退避、0 条 `llm/retry`、直接终态** | **PASS**：语义正确但**值得知道**——服务端要求等 60 s 时 DSH 不再重试 |
| **B11** | `mode:"always"` **结构上无终态** | `:159-165`、`:171` 的 `maxRetries` 闸门只对 `"normal"` 生效 | 实测 **40 轮**仍返回 `{kind:"retry"}`（由我的 `maxRounds` 截断，非模块终止） | **PASS（静态+实测）**：本部署未启用 `always`（settings 无 `retryPolicy`），风险为**潜在** |
| **B12** | **重试 = 整请求重发**（无断点续传） | `dsh-agent-loop/lib/index.js:665 continue` ⇒ 回到 `:614 while(true)` → `:615 buildRequest` → `:619 stream()` 全新一次 | 实测 3 次尝试 = 服务器侧 **3 个独立 HTTP 请求**（失败 2 → 成功 1），各尝试耗时 13 / 2 / 2.1 ms | **PASS**：⇒ 已消耗的 token **全部重付**，且**已 append 的 `assistant/chunk` 不回收**（见 B16） |
| **B13** | **超时语义（关键）**：openai SDK 的 `timeout` 是**建连/TTFB 超时，不覆盖流式 body** | `openai/client.js:138,573` `DEFAULT_TIMEOUT = 600000`（客户端级）；`pi-ai/.../openai-completions.js:136` 仅在 `options.timeoutMs` 给定时才设 per-request `timeout` | **决定性实测**：`timeout=2000ms` 的 **4.42 s 慢流完整跑完、10 块全收、0 错误**；而"服务器只发头、永不发块"的同一超时下 **2002 ms 被掐**，错误 `Request timed out.` | **PASS（含阴性+阳性对照）** |
| **B14** | 读侧另由**每次 `next()` 前 arm** 的空闲看门狗兜底 ⇒ **不存在总时长超时** | `dsh-timeout/lib/index.js:85-124 idleWatchdog()`（`:92-97 arm()` 在 `:104` 每次 `next()` 前 arm、`:108` finally 清除）；pi-ai `:1718/1767`、deepseek `:1538/1553` 使用；默认 `streamIdleTimeoutMs=300000`（pi-ai `:833`、deepseek `:1286`） | — | **PASS（静态确证）** |
| **B15** | 🔴 **最坏用户等待 ≈ 30 min** | 由 B13+B14+B1③：一次"有头但停住"的流**每次尝试最长烧 300 s**；6 次尝试 = 1800 s，加退避 15.5 s | 算术确证（**未端到端实跑 30 min**，见 B15-注） | **FAIL（用户可感性）**；**B15-注：具体时长未实测**（不烧 30 分钟真时间）⇒ 量级由 `:833` 常量 + B13/B14 分支条件推出，属**代码确证**而非实测 |
| **B16** | 重试**不回收**上一次尝试已 append 的 `assistant/chunk` | `dsh-agent-loop/lib/index.js:614-629`：每轮 `new BlockAssembler()`、`chunkSeqs=[]` **新建**，但 `:623 session.append("assistant/chunk", ...)` 的事件**不撤销**；`"assistant/chunk"` 在 `dsh-session/lib/index.js:1084` 的 `KNOWN_SESSION_EVENT_TYPES` 内（会被持久化） | 静态确证路径存在；**未实跑**（需要构造真实失败会话） | **INCONCLUSIVE（未能量化）**：消费者 `dsh-token-meter/lib/index.js:268,303`（按 `usage` 块计数）与 `dsh-subagent/lib/index.js:87`（累积 `text-delta`）**结构上会看到孤儿块** ⇒ 建议**专项验证是否重复计量**。**注意**：`:623` 对 subagent（`isSubagent`）**根本不 append**，所以影响面限于主会话 |

### 2.3 ③ 出站 HTTP（连接池 / 复用 / 并发上限 / DNS·TLS）

| # | 主张 | 证据（file:line） | 实跑数值 | 判 |
|---|---|---|---|---|
| **C1** | 🔴 **"`dsh-llm-pi-ai:2107` 无池化"这一表述不成立** | `:2107` 只是 `discoverModels()` 里的一次性 `fetch(url, {...})`；**且 `:2090-2098` 在 provider 有声明模型时早返回，根本到不了 `:2107`**（`adam` 声明了 50 个 ⇒ 不到达） | 见 C2：`fetch` 走 undici 全局池，8 次请求只开 1 条连接 | **FAIL（该主张被证伪）** |
| **C2** | **存在连接复用**（间隔 < 4 s 时） | openai SDK `openai-completions.js:505-510` `new OpenAI({apiKey, baseURL, dangerouslyAllowBrowser, defaultHeaders})`——**未传 `fetch` / `httpAgent` / `dispatcher`** ⇒ 用进程级 undici 全局池 | **8 次顺序请求 @200 ms 间隔 → TCP 连接数 = 1**（HTTP 请求数 8） | **PASS（池化存在）** |
| **C3** | ⚠️ **但真实回合间隔会击穿 keep-alive**：undici 默认 `keepAliveTimeout = 4 s` | 同上（undici 内建默认，非 DSH 配置） | **4 次顺序请求 @6000 ms 间隔 → TCP 连接数 = 4**（每连接恰好 1 请求：`perConnReqsFinal=[1,1,1,1]`） | **PASS（实测）**：⇒ 用户相邻两次发消息（间隔通常 ≫4 s）**每次都要重建 TCP+TLS** |
| **C4** | **并发无上限** | 同上（undici 默认 `connections = null`，且 DSH/pi-ai 均未设上限） | **8 个并发请求 → TCP 连接数 = 8**，0 错误 | **PASS**：⇒ 无出站并发闸门；并发 N 路就是 N 条连接 |
| **C5** | 丢一条连接的代价（DNS/TLS 复用） | — | 到真实网关 `llmapi.roboscience.xyz`（解析到 **10.0.7.31**，内网）：**DNS med 0.533 ms、TCP med 1.901 ms、TLS med 5.013 ms ⇒ 握手合计 med ≈ 6.9 ms**（n=5，0 错误） | **PASS（实测）**：⚠️ **内网口径**。公网网关的 DNS+TLS 会远大于此 ⇒ 本数字**不可外推** |
| **C6** | 回合间隔 >4 s 的连接重建对用户可感度 | 由 C3+C5 | ≈ **6.9 ms/回合**（med） | **量级很小**：**不构成卡顿立柱**（见 §4 候选 3，我据此**不建议**为此单独立项） |
| **C7** | 是否存在 TLS 会话复用 / HTTP 代理分支 | `@earendil-works/pi-ai/dist/utils/node-http-proxy.js` 存在，但只被 `api/openai-codex-responses.js` 与 `api/bedrock-converse-stream.js` 引用 ⇒ **openai-completions 路径不经过代理解析** | 静态确证（全树 `undici|keepAlive|new Agent|dispatcher` 在 pi-ai 里只命中 bedrock） | **PASS**：本部署（`api: openai-completions`）**不受** `HTTP(S)_PROXY` 影响 |

### 2.4 ④ 流式首 token 与每块成本

> **与 `w07` 的边界（不重复论证）**：`w07` 已确证**客户端 React commit 由 `session/projection` 帧以 ≈1.19:1 驱动**、且**不是**由 `session/event` 驱动。**本节只测适配器/传输侧**，不触碰客户端 commit。

| # | 主张 | 证据 | 实跑数值 | 判 |
|---|---|---|---|---|
| **D1** | **阳性对照：TTFT 仪器有效** | 服务器首块前注入 300 ms（页内口径无关，纯服务端延迟） | 基线 TTFT med **2.399 ms** → 注入后 med **303.272 ms**，**Δ = 300.9 ms** | **PASS** |
| **D2** | 适配器侧首 token 开销（本地回环、单条 user 消息、无工具） | `pi-ai/dist/api/openai-completions.js:102-145`（`start` 事件 → 首个 `text_delta`） | TTFT med **1.91 / 2.69 / 2.64 / 2.12 ms**（chunks=1/100/500/2000 四档，各 n=5） | **PASS**：≈**2 ms** 量级 |
| **D3** | **每块边际处理成本** | 上述流水线（SSE 切分 → JSON.parse → `AssistantMessageEventStream.push` → 我的迭代器消费） | 同窗 4 点最小二乘：**斜率 ≈ 0.01898 ms/块**、截距 ≈ 4.51 ms（原始中位：1.946 / 9.733 / 13.225 / 42.506 ms） | **PASS** |
| **D4** | 折算到"典型 2000 块回复" | 同上 | **42.5 ms 总**（med，n=5）⇒ 单核吞吐 ≈ **47 000 块/s** | **PASS** |
| **D5** | 折算到现实 token 速率下的单核占用 | 同上 | 按数十块/s 的现实速率 ⇒ **≲1 ms/s ≈ 0.1% 单核** | **PASS**：⇒ **流式解析/适配器不是瓶颈**（与 `w07` 的"成本在 projection 驱动的客户端 commit"一致，互为支撑） |
| **D6** | 每块成本是否随块数劣化（超线性） | 同上 | 42.5/2000 = 0.0213 vs 9.733/100 = 0.0973 vs 13.225/500 = 0.0265 ⇒ **无边长型劣化的证据**（前段有固定开销摊薄效应） | **PASS** |
| **D7** | 首 token 前的"必然成本"里是否含同步 IO | `dsh-llm-pi-ai` 在 `stream()` 前做 attachment/图像预算处理（见 A3/A5 路径） | 本轮**只测了无图、无工具的纯文本请求** | **INCONCLUSIVE（未能量化）**：**带图/带附件的首 token 前同步成本未测**（需要 attachment 服务，越界） |

### 2.5 ⑤ 能力声明与路由表（含热载 / preset 回落 / 未注册命名空间）

| # | 主张 | 证据（file:line） | 实跑数值 | 判 |
|---|---|---|---|---|
| **E1** | **`dsh-subagent` 段"settings 优先、preset 兜底"逐字成立** | `~/.dsh/profiles/node_modules/@local/dsh-subagent-model/lib/index.js:29 DEFAULT_ROUTE={adam, deepseek-v4.1-flash}`、`:38-41 Config{provider?,model?}`、`:46 installSettingsSection(..., {...DEFAULT_ROUTE, ...config}, ...)` | 活体 `settings.describe`：`ns="dsh-subagent"` → **`user={model:"deepseek-v4-pro"}`（只有 model）、`base={provider:"adam",model:"deepseek-v4.1-flash"}`、`value={provider:"adam",model:"deepseek-v4-pro"}`、`applies:"live"`** | **PASS（端到端）**：⇒ **缺 `provider` 时确实回落到 preset 的 `adam`** |
| **E2** | 该插件**确已挂载** | `~/.dsh/profiles/web/cordis.patch.yml:87-91`（`insert id: dsh-subagent-model`） | 活体命名空间列表**包含** `dsh-subagent` | **PASS** |
| **E3** | `agent-default-model` 亦为热载且值已生效 | `dsh-agent-default-model/lib/index.js:12-18`（**两字段 required**）、`:45-50 installSettingsSection` | 活体：`base={deepseek-official, deepseek-v4-flash}`、`user={adam, deepseek-v4-pro}`、**`value={adam, deepseek-v4-pro}`、`applies:"live"`** ⇒ **15:21 的 settings 改动已在运行中的宿主生效** | **PASS（端到端，含"改完即热"的直接证据）** |
| **E4** | 热载机制 | `dsh-settings/lib/index.js:618-636 installSettingsSection()` → `:624 setSource(() => scope.get())`；`:504-509 resolve()` = `base` ⊕ `user` 分层合并 | `settings.describe` 提供机器可读的 **`applies:"live"`** 字段（每命名空间） | **PASS** |
| **E5** | **活体 20 个注册命名空间** | `settings.describe`（只读 RPC） | `agent-default-model, agent-loop, agent-presets, dsh-btw, dsh-ssh-gui, dsh-subagent, dsh-usage, dsh-workerspace, llm-deepseek, llm-pi-ai, locale, permission, session-status-board, shell, ui-conversation, ui-onboarding, ui-theme, vision-adam, wallpaper, web-search-deepseek` | **PASS** |
| **E6** | **"未注册命名空间静默失效"机制存在** | `dsh-settings/lib/index.js:476-496 publish()` **只遍历 `this.registrations`** ⇒ 未注册段**永不被解析、永不被 warn**；`:473` 文档注释自陈 "unregistered sections preserved" | — | **PASS（静态确证）**：⚠️ **写**入未注册命名空间才抛（`:442` `settings namespace "…" is not registered`）⇒ **拼错键名 = 静默 no-op，零提示** |
| **E7** | **但当前无实际触发**（无静默失效实例） | 同上 | 对账：`settings.yaml` **12 个顶层键全部已注册** ⇒ `unregisteredButPresentInYaml = []`；`registeredButAbsentInYaml` 8 个（`agent-loop, dsh-btw, dsh-usage, locale, permission, session-status-board, shell, ui-conversation`）——属**正常**（走组合默认） | **PASS（端到端）**：⇒ 现状**没有**踩中 E6，但 E6 是**潜在**风险面 |
| **E8** | 段内非法值不会崩 | `dsh-settings/lib/index.js:484-492`：已注册命名空间校验失败 ⇒ **保留上一次好值 + `logger.warn`**，其他命名空间照常 `commit` | 静态确证 | **PASS**：⚠️ 但宿主**无持久日志出口**（`FINDINGS-INDEX` F1）⇒ 该 warn **实际看不到**，与 F1 叠加成"静默" |
| **E9** | `vision-adam` 确已注册（**不是**静默失效） | `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js:81 VISION_ADAM_SETTINGS_NAMESPACE`（**装在 profile 里，产品包树内不存在**） | 活体命名空间列表含 `vision-adam`；schema 显示 `baseURL` 默认 `https://opencode.ai/zen/go/v1`、`apiKeyEnv` 默认 `OPENCODE_GO_API_KEY`、`model` 默认 `deepseek-v4.1-flash`，被 `settings.yaml:189-193` 覆盖 | **PASS**：⚠️ **只查 `@deepseek-ai/*` 产品树会得假阴性**（同 `AGENTS.md` 的警告） |
| **E10** | 图像能力是**工具绕行**设计，而非主模型能力 | `dsh-vision-adam/lib/index.js:12-20`（`analyze_image` 工具、"media never enters that model's context as an image"）、`:163-178`（自建 OpenAI 兼容请求） | — | **PASS（静态确证）**：⇒ A6 的"主模型 text-only"是**设计选择**；A6 的缺陷仅在"用户直接在输入框贴图"这一路径上 |

---

## 3. 未能量化 / 明确的空白清单（诚实清单）

1. **B15 的 30 分钟最坏值未实测**——由 `streamIdleTimeoutMs=300000` 常量与 B13/B14 的分支条件推得（代码确证），非端到端计时。要实测需真烧 30 分钟。
2. **B16（重试不回收孤儿 `assistant/chunk`）未实跑**——需要构造真实失败会话。消费者存在（`dsh-token-meter` / `dsh-subagent`），是否**重复计量**未验证。
3. **A7（47 个模型上游是否真支持视觉）未实发**——需逐模型发含图请求。A6 的本地结论不受影响。
4. **D7（带图请求的首 token 前同步成本）未测**——需要 attachment 服务。
5. **C5 的 DNS/TLS 是内网口径**（网关解析到 10.0.7.31），**不可外推到公网**。
6. **A2 / C6 等绝对 ms 采自非排他窗口**（§0.1）⇒ 只作存在性/量级判据。
7. **`dsh-llm-deepseek` 路径本轮未实跑**（本部署 `adam` 不使用它；`settings.yaml:3` 为空）。其 `streamIdleTimeoutMs`/`filesApiTimeoutMs` 仅静态确证。

---

## 4. 前三优化候选（含收益 / 风险 / 验收 / 回滚 / 热冷面）

> 排序依据 = **实测收益 ÷ 改动风险**。**先说结论：LLM 网关路径不是本机卡顿的立柱**（D2/D3/D5/C2 全部实测为小量级）⇒ 候选 1、2 是**可用性**修复而非性能修复；候选 3 我**实测后建议不做**。

### 候选 1（最高优先）**停滞流的看门狗分级：把"有头后停住"的 300 s 从用户等待里拿掉**

| 项 | 内容 |
|---|---|
| **靶点** | `settings.yaml` 的 `llm-pi-ai.providers.adam.streamIdleTimeoutMs`（默认 300000，`dsh-llm-pi-ai/lib/index.js:833,957`）。**不需要改代码** |
| **缺陷** | 由 B13+B14：openai SDK 的 600 s 超时**不覆盖流式 body**（实测 2 s 超时下 4.4 s 慢流照跑完）；"有头后停住"只由 300 s 空闲看门狗兜底 ⇒ 单次尝试最长烧 **300 s**，5 次重试 + 退避 15.5 s ⇒ 用户最长 **≈30 min** 才见到可重试的失败（B15） |
| **收益** | 把最常见的实际故障（服务端挂住）的用户等待从**约 30 min 压到分钟级**。这是本轮**唯一**具有用户可感量级的候选 |
| **风险** | **误杀慢模型**：长思考/大 prompt 的"首块慢"可能 >60 s。⇒ **必须分级**：**首块阈值**（宽松，如 120 s）与**块间阈值**（收紧，如 60 s）分开；若产品只暴露一个 `streamIdleTimeoutMs`，则**取保守值 120 s**，并接受"更慢的模型可能被误杀"的显式取舍 |
| **验收** | ① 阳性：本地回环服务器"发头后静默" ⇒ 断言在阈值（+抖动容差）内产生 `TIMEOUT`（错误码 `LLM_STREAM_IDLE_TIMEOUT`，pi-ai `:1767`）；② **反事实**：块间 30 s 的正常慢流 ⇒ 断言**不中断**（我已有该服务器，见 `raw/w16-probe-timeout.mjs` 的 `slow-stream` 档，可直接改阈值复用）；③ 真实会话发一条长回复 ⇒ 断言无新增 TIMEOUT |
| **回滚** | 改回 `streamIdleTimeoutMs: 300000` 或删该行 |
| **热冷面** | **热面**：`settings.describe` 报 `applies:"live"`（E4）⇒ **值级热载，无需重启** |

### 候选 2 **补全 `adam` 段 47 个模型的 `input` 声明（图像能力）**

| 项 | 内容 |
|---|---|
| **靶点** | `settings.yaml:77-185` 的 `llm-pi-ai.providers.adam.models[*].input`（现仅 3/50 声明，A6） |
| **缺陷** | `:651` 的解析链在自定义路由上 `base=undefined`（A4）⇒ 未声明即为 `["text"]`；`:1721` 带图即抛 `UNSUPPORTED_CONTENT` 硬错（A5）。⇒ 用 `claude-opus-*` / `gpt-5.*` / `gemini-3.*` 等**命名上具备视觉能力**的模型贴图会直接失败 |
| **收益** | 消除一类**确定性功能失败**（非性能）。用户侧体验：贴图不再报错 |
| **风险** | 声明了但上游不支持 ⇒ 请求被上游 4xx（错误**从本地硬错变成远端错误**，可诊断性略降）。⇒ 必须**逐模型实测**后再加，不可整段照抄 |
| **验收** | ① 对每个拟新增的模型：实发一条含图请求 ⇒ 断言 **HTTP 200 且非 `UNSUPPORTED_CONTENT`**；② 反事实：**未**声明图像的某模型（如 `glm-5.1`）实发含图 ⇒ 断言**仍**报 `UNSUPPORTED_CONTENT`（证明闸门没被整体关掉）；③ 活体 `llm.models` 的 `failures` 仍为空 |
| **回滚** | 删除新增的 `input:` 行 |
| **热冷面** | **热面**（settings 值级热载，E4） |
| **依赖** | 需先做 A7（逐模型实发），那是**新增测量工作**，不在本线已完成范围内 |

### 候选 3 **（实测后建议**不做**）把 undici `keepAliveTimeout` 抬到覆盖真实回合间隔**

| 项 | 内容 |
|---|---|
| **靶点** | 宿主启动期 `setGlobalDispatcher(new Agent({ keepAliveTimeout: 60000 }))` |
| **缺陷** | C3 实测：4 次 @6 s 间隔 → 4 条连接（undici 默认 `keepAliveTimeout=4 s`）⇒ 相邻回合要重建 TCP+TLS |
| **收益** | **≈6.9 ms/回合**（C5 med，**内网网关**口径）。按一次交互 1 回合计，**约 7 ms**，**在 100 ms 级预算里不可感** |
| **为什么建议不做** | ① 收益实测为**毫秒级**，而 D2/D3/D5 已证适配器侧本就不是瓶颈；② 引入进程级全局 dispatcher ⇒ 影响**所有**出站 HTTP（含 `dsh-web-fetch`、usage ingest、插件市场），**风险面远大于收益**；③ C4 显示并发**无上限**，若顺手加 `connections` 上限会把并发压成排队，**可能劣化** |
| **若仍要做** | 验收：同一服务器 4 次 @6 s ⇒ 连接数 **4→1**（我已留可复用脚本 `raw/w16-probe-http.mjs` 的 `seq-4-gap6000ms` 窗口）；反事实：`getGlobalDispatcher()` 未被业务代码覆盖；回滚：删除该启动行 |
| **热冷面** | **冷面（重启）**——而 BATCH-PLAN §四要求冷面走 sha 校验 + 哨兵，**成本高于收益** |

---

## 5. 给协调者的一句话总结

> **LLM/模型网关路径在本机不是卡顿立柱**：适配器首 token ≈2 ms、每块 ≈0.019 ms（2000 块回复共 42.5 ms ≈ 0.1% 单核）、连接**有**池化（8 次请求 1 条连接）、退避**不阻塞**（心跳 10.05–11.17 ms）。
> **真正值得动的是两件"可用性"事**：① **停滞流会让用户最长等 ~30 min 才看到失败**（openai SDK 的 600 s 超时**不覆盖流式 body**，实测确证；兜底只有 300 s 空闲看门狗）——**热面改一个 settings 常量**；② **`adam` 的 50 个模型里 47 个没声明图像能力**，贴图直接硬错（`UNSUPPORTED_CONTENT`）。
> **明确证伪**：旁路报的"`dsh-llm-pi-ai:2107` 无池化"不成立——那是 `discoverModels` 的早返回路径，且 `fetch` 本身走 undici 池。

---

## 6. 附录：原始证据索引

| 文件 | 内容 |
|---|---|
| `raw/w16-http.json` | ③ 连接计数三窗口（1/4/8）、④ TTFT 阳性对照（Δ300.9 ms）与四档块数、③b 远端握手（DNS/TCP/TLS） |
| `raw/w16-retry.json` | ② 默认退避表 `[500,1000,2000,4000,8000]`、抖动两端、心跳非阻塞、非可重试码、Retry-After、`always` 40 轮、整请求重发（3 请求） |
| `raw/w16-resolve.json` | ① `llm.providers` ×8、`llm.models` 全链 groups=3/failures=[]、与 settings.yaml 的 50↔50 对账 |
| `raw/w16-settings.json` | ⑤ `settings.describe` ×3、20 个已注册命名空间、`dsh-subagent`/`agent-default-model` 的 `user`/`base`/`value`/`applies:"live"`、12 个 yaml 键全部已注册 |
| `raw/w16-timeout.json` | ② 超时语义三档（2 s 慢流跑完 / 30 s 慢流跑完 / 静默服务器 2002 ms 被掐） |
| `raw/settings.yaml.snapshot-w16` | 本轮口径的 settings 快照（sha256 `18b2644ee62c0c55`） |
| `raw/w16-probe-*.mjs` | 五个可复跑探针（均显式接管 SIGINT/SIGTERM/SIGHUP，§五.3） |
