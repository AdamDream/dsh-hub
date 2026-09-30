# T22 — 0.2.0 在「零模型请求」模式下的可运行性审计

- 轨道：T22（审计阶段，只读；不改产品代码）
- 审计对象：`@deepseek-ai/dsh@0.2.0-rc.1` 及其 289 个 `@deepseek-ai/*` 依赖
- 权威源码面（本轮实读）：
  - 完整安装树 `.workspace/audit-020/work/closure020/node_modules/@deepseek-ai/`（289 包，CLI `0.2.0-rc.1` 已可执行）
  - CLI 解包面 `.workspace/dsh-020-pkg/x/package/`
- 审计边界：**本轮自身零模型请求**；未修改 `~/.dsh/**`、`~/.dsh-017/**`；未启动任何监听端口的服务；未触碰现役 `0.1.1-rc.2`(3080) 与隔离 `0.1.7-rc.2`(3097)。
- 隔离运行根：`DSH_HOME=/home/CNS2026495165/dsh/.workspace/audit-020/t22/home/.dsh`（全新空目录）。

---

## 1. 结论摘要

1. **启动期不存在模型凭据强制校验。** 所有适配器的凭据解析都是**按请求惰性求值**，没有任何启动期
   `resolveAuth` / 探活 / `models` 列表拉取的调用点。空 key、空 `~/.dsh`、无网络下，profile 组合与
   CLI 启动路径**全部成功**（第 2 节 E1/E2 实测）。
2. **首次启动不会自发发起任何模型请求。** `agent-loop` 的 `agents: []` 使进程启动后**没有任何
   agent 处于 running 相位**；`session-title` 的自动标题只在「用户发出首条消息」后才被排程
   （且需等主请求头落盘）；压缩只在 `agent/pre-step`（真实回合内）触发。
3. **无 key 的行为 = 启动成功且功能受限**：本地读取类功能（历史会话、卡片渲染、deck/preview、
   设置页、模型选择器）全部可用；只有**真正需要模型的路径**才会以
   `MISSING_CREDENTIAL`（本地抛出，**不落网**）失败。没有「静默重试」路径（3 节逐路径）。
4. **自发请求风险共 6 条**，其中 **3 条属隐藏后台风险**（首提示词自动标题、回合内自动压缩、
   打开「模型设置」页触发的模型发现）。全部可被第 5 节的最小配置片段关闭。
5. **UI 验收可以在零模型下完成**（第 6 节）：历史会话读取 / 既有卡片渲染 / 设置页 /
   模型选择器均为纯本地数据面；本地插件 `dsh-pptmaster` 的 `deck/preview` **在 0.2.0 上复核仍为
   本地文件读取**（`readState` + `readOutput` + base64，无模型调用、无外呼）。
6. **`unshare -rn` 网络隔离下，0.2.0 的启动期组合路径实测可用**：`--profile web --dump-config` /
   `--dump-default-config` / `--profile web --help` 三者在 `env -i` + `unshare -rn` 下全部 exit 0，
   输出与联网态**逐字节一致**（sha256 相同）。

> 一句话：**0.2.0 的「零模型」可运行性成立**；风险不在启动期，而在**用户交互触发的三条后台自发调用**，
> 必须用第 5 节配置显式关闭后，零模型验收才是可证明的。

---

## 2. 证据（源码行号 + 当轮命令）

### 2.1 启动期「无凭据校验」的源码证据

| # | 断言 | 证据位置 | 关键行 |
|---|---|---|---|
| A1 | DeepSeek 适配器**不注册**任何启动期凭据校验；`resolveAuth` 仅在请求内被 await | `dsh-llm-deepseek-api-key/lib/index.js` | `40-51`：`const resolveApiKey = async (connection) => {...}`；无 key 时 `throw new LlmError(..., "MISSING_CREDENTIAL")`（第 50 行） |
| A2 | `apply()` 只做注册，不调用 resolveApiKey | 同上 | `37-39`：`function apply(ctx, config) { const options = () => resolveAdapterOptions(...); options(); ... }` — 只解析**端点/协议配置**，不解析凭据 |
| A3 | 模型清单来自**静态目录**，非远端拉取 | `dsh-llm-deepseek/lib/index.js` | `42-54`：`const DEFAULT_MODELS = [{ id: "deepseek-flash", ... }, { id: "deepseek-v4-pro", ... }]`；`2091-2092`：`async listModels(provider) { return this.dependencies.discoverModels?.(provider) ?? []; }`，而 api-key 适配器注入的 `discoverModels` 为 `connection.models.map(catalogModelInfo)`（`dsh-llm-deepseek-api-key/lib/index.js:62-65`）——**纯本地映射，零 HTTP** |
| A4 | 无 key 抛错发生在 **fetch 之前** | `dsh-llm-deepseek/lib/index.js` | `2149`：`const auth = await this.dependencies.resolveAuth(connection);` 位于 `2188` 的 `await fetch(\`${messagesApiRoot(...)}/messages\`)` 之前，且 `2149` 在 `try{}`（2150）**之外** —— 抛错不进入 fetch 分支 |
| A5 | 凭据解析顺序：`credentials` 服务存在时**不再回退环境变量** | `dsh-llm-deepseek-api-key/lib/index.js` | `43-49`：`if (credentials !== void 0) {...} else { ambient... }` —— web 组合恒注入 `credentials-local`，故走 if 分支；`else` 分支的 env 回退在 web profile 下**不可达** |
| A6 | 无 key 时 `credentials.resolve` 返回 `undefined`（不抛） | `dsh-credentials-local/lib/index.js` | `473-490`：env → stored → dotenv → `return Promise.resolve(void 0)` |
| A7 | account 平台插件在无凭据时**提前 return，不发网** | `dsh-deepseek-account-platform/lib/index.js` | `587-589`：`async [Service.init]() { const record = await this.ctx.credentials.readRecord(KEY); if (record === void 0) return; ...}` |
| A8 | agent-loop 启动后**无 agent 运行** | `dsh-agent-loop/lib/index.js` | `1551-1560`：构造器只注册投影与 factory；`1567-1590`：`for (const { id, ... } of this.config.agents)` 创建/恢复 agent 后立即返回，**不调用 `wakeDriver()`**（`wakeDriver` 仅在 `send`/`inbox` 有 pending 时调用，见 `852-868`） |
| A9 | `agent-default-model` 仅读取配置引用，无网络 | `dsh-agent-default-model/lib/index.js` | `38-45`：`currentSelection()` 返回 `this.config.provider.get()`；无 fetch |

### 2.2 启动期自发模型调用的**穷举**（关键结论）

全树拉网（当轮命令见 §2.4 的 C1）：

- 只有 **4 个包**调用 `ctx.llm.stream`：
  `dsh-agent-loop`、`dsh-compaction-basic`、`dsh-session-title-llm`、`dsh-experimental-auto-review`。
- `dsh-experimental-auto-review` **不在**默认组合内：它只出现在自身 `dsh-experimental-auto-review/cordis.patch.yml`，
  并被 `dsh-app-boot/lib/index.js:552-557` 列为 `OPTIONAL_BUNDLES`（**默认关闭**）。
- 默认组合（`dsh-base`）中 `agent-loop` 的 `agents: []`、`llm-retry` 只在 `agent/request-error` 上工作、
  `token-meter` / `compaction-basic` 的预算计算为纯本地 token 记账。
- `session-title` 的 `get(session)` 为 `foldSessionTitle(session.snapshotEvents())`
  （`dsh-session-title/lib/index.js:281-283`）—— **历史会话读标题纯本地折叠，零模型**。

**⇒ 启动期（进程起来到第一个 UI 请求之间）模型请求数 = 0。**

### 2.3 触发时机的源码证据（为什么「首启动」是 0）

| # | 机制 | 证据位置 | 关键行 |
|---|---|---|---|
| B1 | 首提示词自动标题的排程条件：**用户消息 + 根会话 + 首条 + 尚无标题** | `dsh-session-title/lib/index.js` | `379-388`：`if (registration.provider.automatic === "all-prompts" \|\| session.header.parentSession === void 0 && count === 1 && this.get(session) === void 0) { state.pending = ... }` |
| B2 | 排程后**并不立即发请求**，要等主请求头落盘 | 同上 | `405-415`：`onRequestHeader(...) { ... this.startPending(session, state, pending, route) }`，`route` 取自 `event.data.header.config.{provider,model}` |
| B3 | 只对 **agent-loop 自己装配的请求**生效 | `dsh-session-title/lib/index.js:262-267` + `dsh-llm/lib/index.js:377-388` | `ctx.on("llm/stream", ...)` 内 `if (!isAgentLoopRequest(options)) return;`；`isAgentLoopRequest` 判定 `AGENT_LOOP_REQUESTS.has(request)`，而 `markAgentLoopRequest` 仅由 `dsh-agent-loop/lib/index.js:1269` 调用 ⇒ 压缩/标题自身发起的流**不会**再触发标题 |
| B4 | 标题请求先落**请求事件**再发流 | `dsh-session-title-llm/lib/index.js` | `216-223`：`request.session.append("session/title-llm-request", {...})`；`226`：`for await (const chunk of ctx.llm.stream(options))` |
| B5 | 自动压缩挂在 `agent/pre-step`（仅真实回合内） | `dsh-compaction-basic/lib/index.js` | `839-842`：`ctx.on("agent/pre-step", async ({agent, signal}, next) => { ... this.compactIfNeeded(agent, "pressure", signal) ... })`；`323`：`for await (const chunk of ctx.llm.stream(options))` |
| B6 | 压缩默认开启（需显式关） | 同上 | `85`：`auto: config.auto ?? true` |
| B7 | 默认组合里标题 LLM provider 与压缩**都是开启的** | `dsh-base/cordis.patch.yml` | `62-69`：`- id: session-title-llm / name: '@deepseek-ai/dsh-session-title-first-prompt-llm'`（含 `timeoutMs: 60000`）；`341-342`：`- id: compaction-basic / name: '@deepseek-ai/dsh-compaction-basic'`；`127-128`：`- id: llm-pi-ai`（dormant 挂载）|

### 2.4 当轮实测命令与结果（全部零模型、零监听）

> 统一前置（下文 `$PKG`、`$HOME22`）：
> ```bash
> cd /home/CNS2026495165/dsh/.workspace/audit-020/work/closure020
> PKG=node_modules/@deepseek-ai/dsh/lib/bin.js
> HOME22=/home/CNS2026495165/dsh/.workspace/audit-020/t22/home
> DSHH=$HOME22/.dsh            # 全新空目录，与 ~/.dsh、~/.dsh-017 无关
> OUT=/home/CNS2026495165/dsh/.workspace/audit-020/t22
> ```

- **E1 · CLI 可执行性（无凭据、无网络）**
  ```bash
  DSH_HOME=$DSHH env -i PATH="$PATH" HOME=$HOME22 node $PKG -V
  ```
  结果：`0.2.0-rc.1`（exit 0）。

- **E2 · 启动期组合路径在 netns 网络隔离下成功**
  ```bash
  timeout 90 unshare -rn env -i PATH="$PATH" HOME=$HOME22 DSH_HOME=$DSHH \
    node $PKG --profile web --dump-config      > $OUT/dump-config-web-netns.out 2> $OUT/dump-config-web-netns.err
  timeout 60 unshare -rn env -i PATH="$PATH" HOME=$HOME22 DSH_HOME=$DSHH \
    node $PKG --profile web --help             > $OUT/web-help.out 2>&1
  ```
  结果：`dump-config` exit 0、**1259 行**、**stderr 0 字节**；`--help` exit 0（含 `--host/--port/--no-open/--trusted-host`）。
  与联网态输出**逐字节相同**：
  ```
  sha256sum dump-config-web.out dump-config-web-netns.out dump-default-web.json
  659238dbbddb6bdb8948c1c21ccca89a4f8d2551f124aea317805c941a2c7de5  (三者一致)
  ```
  即：**启动组合既不依赖网络，也不因缺凭据而改变**。

- **E3 · 组合里确认默认开启的自发调用源**
  ```bash
  grep -n "session-title\|llm-deepseek\|agent-default-model\|compaction\|web-search\|auto-review\|credentials" \
    $OUT/dump-config-web.out
  ```
  结果命中：`session-title`(29)、`session-title-llm`(35，`dsh-session-title-first-prompt-llm`)、
  `agent-default-model`(49)、`credentials`(72)、`compaction-basic`(271,727,909,1173)、`web-search-deepseek`(372)、
  `llm-deepseek`(405)、`llm-deepseek-account`(408)；**未命中** `auto-review`（默认关闭，佐证 A7-类结论）。

- **E4 · 穷举自发调用源（拉网）**
  ```bash
  cd node_modules/@deepseek-ai
  grep -rln "ctx\.llm\.stream\|llm\.stream(" --include="*.js" */lib/*.js */lib/**/*.js | sed 's#/lib/.*##' | sort -u
  ```
  结果（4 个）：`dsh-agent-loop`、`dsh-compaction-basic`、`dsh-experimental-auto-review`、`dsh-session-title-llm`。

- **E5 · 模型发现的两条路：本地 vs 外呼**
  ```bash
  grep -n "discoverModels" -A 30 node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js | head -40
  grep -n "useEffect" -A 14 node_modules/@deepseek-ai/dsh-client-ui-settings-models/lib/client.js | sed -n '1,20p'
  ```
  结果：pi-ai 的 `discoverModels` 在 `baseURL` 存在时 `await fetch(url, {method:"GET"})`（`dsh-llm-pi-ai/lib/index.js:2309`）；
  若 provider 命中内置目录则**直接返回本地目录**（`2284-2291`）。客户端在挂载时无条件 probe：
  `dsh-client-ui-settings-models/lib/client.js:597-607`。

- **E6 · 全树本地化确认**：宿主前端资源由 `dsh-web-frontend/dist`（5.8 MB，含 `assets/`、`favicon.svg`）本地提供，
  在 `dsh-host-frontend-static` / `dsh-client-ui-theme` 中**未发现** `fonts.googleapis.com`/CDN/`unpkg`/`jsdelivr` 引用
  ⇒ 离线渲染 UI 不依赖外网字体或 CDN。

---

## 3. 启动期模型依赖判定

| 判定项 | 结论 | 依据 |
|---|---|---|
| 启动时强制校验模型凭据？ | **否** | A1/A2/A3/A7；E1/E2 实测无凭据亦成功 |
| 启动时探测模型列表 / `/models`？ | **否** | A3：适配器为静态目录；`buildModelCatalog` 的 `listModels(provider)` 在 deepseek 走向纯本地映射（`dsh-api-session-controller/lib/index.js:500-506`） |
| 启动时生成会话标题？ | **否** | B1/B2/B3：必须有用户消息且主请求头落盘 |
| 启动时生成会话摘要 / 压缩？ | **否** | B5：`agent/pre-step` 钩子，仅真实回合内 |
| 启动时遥测/账号外呼？ | **否（默认组合）** | A7；`profileContext.name` 非 `desktop` 时 telemetry/analytics 行被 `disabled`（`dsh-web-app/cordis.patch.yml:47,59`）；`dsh-resolveTelemetryPatch` 依赖 `DSH_TELEMETRY_DISABLED` |
| 进程内定时器是否发网？ | **否** | 宿主侧仅 3 处 `setInterval`：`dsh-api-gateway`（WS 心跳，`234-244`，回环）、`dsh-client-hmr`（文件轮询，`105-113`）、`dsh-host-directory-picker-native`（本机 portal 轮询） |
| 默认是否有 agent 自动跑？ | **否** | A8：`agents: []`，无 `wakeDriver` |

**⇒ 启动期模型依赖 = 0。**

---

## 4. 无 key 行为逐路径

| 路径 | 触发 | 现象 | 是否发网 | 是否静默重试 | 依据 |
|---|---|---|---|---|---|
| 进程启动（web profile） | `dsh web` | **成功**；凭据缺失不进入任何启动校验 | 否 | 否 | A1/A2/A7；E1/E2 |
| 打开历史会话 / 会话列表 | 侧边栏点击 | **成功**；标题由 `foldSessionTitle` 本地折叠，无标题时用确定性 fallback | 否 | 否 | `dsh-session-title/lib/index.js:281-283`、`604-640`（`fallbackSessionTitle`） |
| 渲染既有卡片 / 消息 | 会话视图挂载 | **成功**；投影与渲染为本地数据面 | 否 | 否 | `dsh-session-projection`、`dsh-client-ui-conversation` 不调用 `ctx.llm.stream`（E4 全集） |
| `deck/preview`（本地 PPT 预览） | 卡片自发 RPC | **成功** | 否 | 否 | §6.2 |
| 设置页 / 模型选择器 | 打开设置 | **成功**；`listProviders()` 只列已注册适配器（`dsh-llm/lib/index.js:1899-1901`），离线仍显示 DeepSeek 路由，可选中 | 否（deepseek 目录本地） | 否 | A3、`dsh-api-session-controller/lib/index.js:500-506` |
| 打开「模型」设置页并展示 provider 目录 | 挂载 `ModelListEditor` | **成功但会 probe 一次**：deepseek 走本地目录；pi-ai 若已配置 `baseURL` 则**真外呼** | **可能**（见 R4） | 否 | E5 |
| 用户发送首条消息（无 key） | 主请求 | 启动-成功但**本轮失败**：`MISSING_CREDENTIAL` 以错误事件落盘并回显 | 否（2149 在 fetch 前抛） | **否** | A4；`DEFAULT_RETRYABLE_CODES` 不含 `MISSING_CREDENTIAL`/`AUTH`（`dsh-llm/lib/types/retry-policy.js:16-22`）；`dsh-llm-retry/lib/index.js:151-160` |
| 同上 + 自动标题 | 主请求头落盘后 | 失败（同一 `MISSING_CREDENTIAL`），**但会先追加 `session/title-llm-request` 事件** | 否 | 否 | B1/B2/B4 |
| 凭据存在但**失效/错误**（401/403） | 主请求 | 失败；`code="AUTH"`，**不在可重试码内** ⇒ 不重试 | 是（1 次） | **否** | `dsh-llm-deepseek/lib/index.js:1753-1754`；`retry-policy.js:16-22` |
| 凭据存在但**网络被隔离** | 主请求 | `code="TRANSPORT"` ⇒ **可重试**，最多 5 次退避（≈0.5→10s，含 10% 抖动） | 是（1+5 次连接尝试） | **是** | `dsh-llm-deepseek/lib/index.js:2132`（`TRANSPORT`）；`retry-policy.js:12-22`；`dsh-llm-retry/lib/index.js:116-149` |
| 长会话触发压缩（无 key） | `agent/pre-step` 超阈值 | 压缩失败但**不阻断**回合（异常被捕获记录） | 否 | 否 | B5/B6；`dsh-compaction-basic/lib/index.js:839-845` 的 try/catch |

**要点**：零 key 场景**没有任何一条路径会发网**，因此零模型验收的"无 key 必然失败"这一层证据是**闭合**的。
唯一会反复尝试连接的是「**有 key + 网络被隔离**」的组合（`TRANSPORT` 重试）；验收时必须用 `env -i` 彻底去掉
`DEEPSEEK_API_KEY` 等，而不是只依赖 netns。

---

## 5. 自发请求风险清单

| ID | 风险路径 | 触发条件 | 默认状态 | 是否后台/隐蔽 | 严重度 | 证据 |
|---|---|---|---|---|---|---|
| **R1** | 首提示词**自动会话标题** LLM 调用 | 根会话 + 首条用户消息 + 无用户标题；等主请求头落盘后自动发起 | **开启**（`dsh-session-title-first-prompt-llm`） | **是**（用户只感知"我发了一条消息"，标题调用是额外的第 2 次模型调用） | **高** | B1/B2/B4/B7 |
| **R2** | 回合内**自动上下文压缩** LLM 调用 | 真实回合内 token 压力超 `thresholdRatio` | **开启**（`auto ?? true`） | **是**（不询问、无 UI 提示，只在日志留 `compaction (pressure): ...`） | **高** | B5/B6；`dsh-compaction-basic/lib/index.js:85,323,839` |
| **R3** | **pi-ai 模型发现**真外呼 `GET <baseURL>/models` | 设置页「模型」渲染 `ModelListEditor` 且该 provider 有 `baseURL`（pi-ai 路由由 `llm-pi-ai:` settings 段激活） | 客户端**无条件 probe**；默认无 pi-ai profile 故不触发 | **是**（打开设置页即发，非用户点按钮） | **中**（默认组合 dormant，扩展后即高危） | E5；`dsh-llm-pi-ai/lib/index.js:2282-2313`；`client.js:597-607` |
| **R4** | `deepseek-official` 目录 probe（本地，**非外呼**） | 同上 | 开启 | 是 | **低**（仅为本地目录映射，零 HTTP） | A3；`dsh-llm-deepseek-api-key/lib/index.js:62-65` |
| **R5** | `web_search` / `web_fetch` 工具 | 模型主动调用工具（需先有模型回合） | 工具已挂载（`web-search-deepseek`，dump 行 372） | 否 | **低**（前置依赖模型回合；可用工具禁用配置关掉） | E3；`dsh-base/cordis.patch.yml:461-479` |
| **R6** | `experimental-auto-review` 自动复核 LLM 调用 | 该 bundle 被启用后 | **默认关闭**（`OPTIONAL_BUNDLES`，未出现在组合 dump 中） | 是 | **中（潜在）** | E3/E4；`dsh-app-boot/lib/index.js:552-557` |

> 结论：**真正需要在零模型验收里显式关闭的是 R1、R2、R3**。R5/R6 属于前置依赖或默认关闭项。

---

## 6. 零模型下 UI 验收可行性（含 `deck/preview` 复核）

### 6.1 可行路径清单

| 验收入口 | 零模型可行性 | 依据 |
|---|---|---|
| 打开历史会话（列表 + 正文） | **可行** | 会话来自 `$DSH_HOME/sessions` 的 JSONL（`session-persistence-jsonl`，`dsh-base/cordis.patch.yml` 配置 `root: dshHomePath('sessions')`）；标题本地折叠（`session-title/lib/index.js:281-283`） |
| 渲染既有卡片 / 消息 / 工具结果 | **可行** | 投影 + 客户端渲染，均无 `ctx.llm.stream`（E4 全集） |
| 本地文件读取类预览（PPT deck/preview） | **可行** | §6.2 |
| 设置页（通用/插件/会话日志/子代理/模型） | **可行**（模型页有一次本地 probe；见 R3/R4） | `ModelsSettingsStore.load()` 只走 `remote.llm.listProviders/listConfigurableProviders/credentials.describe`（`client.js:1003-1055`），全部宿主本地服务 |
| 模型选择器（会话头部） | **可行** | `buildModelCatalog` → `listModels` → `resolveModelInfo`，deepseek 全本地（A3） |
| 新建会话但**不发消息** | **可行** | 无模型调用（B1 要求用户消息） |
| 发送消息 / 任何生成类操作 | **不可行**（预期） | 无 key ⇒ `MISSING_CREDENTIAL`；这正是"零模型"的定义域外 |

### 6.2 `deck/preview` 复核（历史结论「本地文件读」是否仍成立）

**复核对象**：本地组合插件 `@local/dsh-pptmaster`（实现在本仓库
`workbuddy-reverse-proxy/_migration/ppt-017/dsh-pptmaster/lib/index.js`，82 036 行）。

- RPC 分发：`case "deck/preview": if (typeof request?.deckId !== "string") throw ...; return ok(await service.preview(sessionId, request.deckId));`
  （`lib/index.js:6902-6904`）
- 服务实现：`async preview(sessionId, deckId)`（`lib/index.js:6071-6099`）函数体只做四件事：
  1. `this.store.readState(sessionId)` 取 deck 元数据（本地文件）
  2. `this.store.readOutput(deck.output.storageKey)` 读已生成的 pptx 字节（本地文件）
  3. `previewBytes(storedBytes)` 或超限时直接返回原字节；`Buffer.from(bytes).toString("base64")` 装进 `finalFile`
  4. 返回 `slides: deck.slides.map(...)`（从已存状态投影）

**结论：0.2.0 上该结论仍然成立** —— `deck/preview` **不调用 `ctx.llm`，不发起任何模型请求，也不外呼**；
它是纯本地状态 + 本地文件读取。复核方法为**源码级**（插件是本地私产，不随 0.2.0 分发；
`dsh-pptmaster` 依赖 0.2.0 的 web RPC 通道 `deck/preview` 端点与 `finalFile` base64 契约，
该通道在 0.2.0 组合 dump 中由 `dsh-client-ui-sidebar-documentpreview`(275) 与 `dsh-office-to-pdf`(270) 同族提供）。
**未做端到端浏览器实测**（见 §9 未验证项 U3）。

> 注意：插件内另有 `createWorkBuddyDeck`（`lib/index.js:6101+`）等**模型产出物消费**路径 —— 那些路径
> 接收的是模型产物（`input.pages`），本身也不发模型请求；零模型验收不得把它们与 `deck/preview` 混为一谈。

---

## 7. 最小禁用配置片段

**目标**：在 0.2.0 上做到「启动 + 全部本地 UI 验收」期间**模型请求恒为 0**。

### 7.1 位置

写入 profile 的用户 patch 层：`$DSH_HOME/profiles/web/cordis.patch.yml`
（或任一 `--patch <path>` overlay）。patch 语义为「按 `id` 覆盖/禁用既有行」，
`patchSchema` 要求条目形如 `{ id, disabled }`（`dsh-app-boot/lib/index.js:2736-2738`、`2863-2866`；
默认组合自身即用此法，见 `dsh-web-app/cordis.patch.yml:47`）。

### 7.2 片段（三行即可关掉全部后台自发调用）

```yaml
# $DSH_HOME/profiles/web/cordis.patch.yml
# 零模型验收：关闭一切自发 LLM 调用。
# 会话标题回退到确定性 fallback（本地字符串截断），历史会话标题仍可读。
- id: session-title-llm        # R1 首提示词自动标题
  disabled: true
- id: compaction-basic         # R2 回合内自动压缩
  disabled: true
- id: llm-pi-ai                # R3 pi-ai 模型发现（及多provider 路由）
  disabled: true
```

**依据**
- `session-title-llm` 是 `dsh-session-title-first-prompt-llm` 的**组合行 id**（`dsh-base/cordis.patch.yml:62-63`），
  禁用后 `session-title` 服务仍工作，仅失去"模型标题"，继续走 `ensureFallback`
  （`dsh-session-title/lib/index.js:615-640`，`fallbackMaxWords: 5 / fallbackMaxBytes: 40`，本地确定性）。
- `compaction-basic` 行 id 见 `dsh-base/cordis.patch.yml:341`；`auto` 默认 `true`（`compaction-basic/lib/index.js:85`）。
  若需保留压缩能力又想零模型，可改为 `disabled: false` + `config: { auto: false }`（**关闭自动触发**，保留手动 `/compact`），
  依据同上 `85` 与 `839`（自动触发唯一挂在 `agent/pre-step`）。
- `llm-pi-ai` 行 id 见 `dsh-base/cordis.patch.yml:127`；它默认 dormant（零路由），但一旦
  `llm-pi-ai:` settings 段提供 profile，其模型发现会真外呼（E5）。直接禁用可把 R3 从"潜在"降为"不存在"。
- **无需**禁用 `llm` / `llm-deepseek` / `llm-deepseek-api-key`：它们只在请求时惰性解析凭据（A1/A4）。
  若为"绝对保险"想连适配器一起摘掉，可追加：
  ```yaml
  - id: llm-deepseek
    disabled: true
  - id: llm-deepseek-account
    disabled: true
  ```
  代价是模型选择器变空（`listProviders()` 返回空），会削弱 UI 验收覆盖面，**不推荐**。

### 7.3 必须同时具备的环境条件（比配置更重要）

```bash
# 1) 清空全部模型凭据（含 .env 回退层）
env -i PATH="$PATH" HOME="$HOME22" DSH_HOME="$DSHH" DSH_TELEMETRY_DISABLED=1 \
  node "$PKG" --profile web --no-open --port <free-port>

# 2) 网络隔离（历史约定）
unshare -rn env -i PATH="$PATH" HOME="$HOME22" DSH_HOME="$DSHH" \
  node "$PKG" --profile web --no-open --port <free-port>
```

- `env -i` 是**必需**项：`credentials-local` 的解析层次为
  `进程环境 > $DSH_HOME/.credentials.yaml > <cwd>/.env > $DSH_HOME/.env`
  （`dsh-credentials-local/lib/index.js:11-46, 473-490`）—— **启动目录的 `.env` 也会供 key**，
  这是零模型验收最容易漏的一条。
- 另需确认启动目录无 `.env`、`$DSHH/.credentials.yaml` 不存在、`$DSHH/.env` 不存在。
- **不要**依赖"有 key + 网络隔离"来做零模型验收：那时 `TRANSPORT` 会触发最多 5 次重试（§4 末行）。

---

## 8. 证据链与采集命令

按强度从高到低；**零模型验收至少跑 E1 + E2 + E3 + E4**。

### 第 1 级（最强）：netns 外呼阻断 + 启动成功

启动全程处于 `unshare -rn`（仅有 `lo`），任何外呼都会以 `ENETUNREACH/EAI_AGAIN` 失败。若启动完成且
无模型请求，则"零模型"成立。

```bash
# 0) 前置：确认 home 干净
ls -la "$DSHH" 2>/dev/null; ls -la "$DSHH/.credentials.yaml" "$DSHH/.env" ./.env 2>&1 | head

# 1) netns 内启动（不监听对外地址；--no-open 避免拉起浏览器）
timeout 120 unshare -rn env -i PATH="$PATH" HOME="$HOME22" DSH_HOME="$DSHH" \
  node "$PKG" --profile web --no-open --port 3099 \
  > "$OUT/boot-netns.log" 2>&1 &

# 2) 证明 netns 内网络确实不可用（反向对照，避免"隔离了但其实有网"的假阳性）
unshare -rn node -e "fetch('https://api.deepseek.com').then(()=>console.log('REACHABLE')).catch(e=>console.log('BLOCKED',e.code||e.cause?.code||e.message))"

# 3) 采集 socket 面：应只有 lo 的 LISTEN/ESTABLISHED，无对外 ESTABLISHED
ss -tanp 2>/dev/null | head -30
cat /proc/net/tcp | awk 'NR>1{print $2,$3,$4}' | head -20

# 4) 采集日志面：不得出现 llm 调用痕迹
grep -nE "llm|messages|model|title|compaction|TRANSPORT|MISSING_CREDENTIAL" "$OUT/boot-netns.log" | head -40
```

### 第 2 级：外呼计数（fetch 探针）

```bash
cat > "$OUT/fetch-probe.mjs" <<'EOF'
import { appendFileSync } from 'node:fs';
const LOG = process.env.PROBE_LOG;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input?.url ?? input);
  appendFileSync(LOG, `${new Date().toISOString()}\t${init?.method ?? 'GET'}\t${url}\n`);
  return realFetch(input, init);
};
EOF

PROBE_LOG="$OUT/fetch.log" node --import "data:text/javascript,import('file://$OUT/fetch-probe.mjs')" \
  node_modules/@deepseek-ai/dsh/lib/bin.js --profile web --dump-config >/dev/null
wc -l "$OUT/fetch.log"    # 期望：不存在或 0 行
```
> 局限（须在报告里如实声明）：Node 内部 undici 路径在某些情形下不经 `globalThis.fetch`；
> 故本层为**辅助证据**，不能单独证明零外呼。第 1 级才是主证据。

### 第 3 级：无 key 必然失败（正向闭合）

证明"没有 key 时任何模型路径在本地就失败、且请求根本没发出"：

```bash
# 无 key 下发起一次真实交互（需在隔离实例 UI 里发一条消息，或经 headless profile 单发）
# 然后检查会话日志中的两种证据：
#   (a) 失败凭据证据：MISSING_CREDENTIAL
grep -rF "MISSING_CREDENTIAL" "$DSHH/sessions/" | head
#   (b) 标题调用确实"尝试过但没发出去"
grep -rF "session/title-llm-request" "$DSHH/sessions/" | head   # 会出现（请求已装配）
grep -rF "session/title\"" "$DSHH/sessions/" | head            # 不会出现（从未成功）
grep -rF "automatic title generation failed" "$DSHH/logs/" | head
```
**判读规则（重要，防误判）**：`session/title-llm-request` 是**请求装配后、`ctx.llm.stream` 前**写入的事件
（B4，`dsh-session-title-llm/lib/index.js:216`）。**它的存在不等于发生过模型调用**——只有 `session/title`
（成功落库）与 `llm/retry`（重试链）才代表真的发生了对外模型请求。因此：
- `title-llm-request` 有 + `session/title` 无 + netns 内无连接 ⇒ **零模型成立**；
- 任何 `llm/retry` / `llm/retry-started` 记录（`dsh-llm-retry/lib/index.js:141,143`）⇒ **发生过外呼尝试，验收不合格**。

### 第 4 级：日志面无请求记录

```bash
# 会话日志不得出现任何 assistant 模型产物
grep -rlE '"type":"assistant/(message|attempt)"' "$DSHH/sessions/" | head
# 宿主日志不得出现模型请求/重试
grep -rE "llm|retry|title|compaction" "$DSHH/logs/" | head -40
```

### 第 5 级：代理/网关计数（如需第三方旁证）

若已部署反向代理（本仓库有 `workbuddy-reverse-proxy/` 历史工件），可在代理侧按 Host 统计：

```bash
# 代理 access log 中 api.deepseek.com 的命中数必须为 0
grep -c "api\.deepseek\.com" <proxy-access-log>
```

---

## 9. 未验证项（如实声明）

| ID | 未验证内容 | 原因 / 影响 | 建议验证方式 |
|---|---|---|---|
| **U1** | **未实测真实启动**（未 `dsh web` 起服务） | 本轨道硬约束「不得启动监听端口的服务」；且 3080/3097 已占用，起服务有端口与资源干扰风险。**已用 `unshare -rn` 下的组合/`--dump-config`/`--help` 作为替代证据**，覆盖"启动期组合无模型依赖"，但**不覆盖**运行时（UI 挂载后的客户端 probe） | 由 T25 在隔离根内以 `--port <free> --no-open` 完成；采集命令见 §8 第 1 级 |
| **U2** | 客户端 `ModelListEditor` probe 在**真实浏览器**中的实际请求数未实测 | 需真实 UI；源码层面已定性（E5） | T25 实例上用 CDP/network 面板按 URL 过滤统计 |
| **U3** | `deck/preview` **端到端浏览器实测**未做 | 需真实订阅 + 真实渲染；本轮为纯源码复核 | T25 或 office 轨道在隔离实例内复跑 `deck/preview` 并抓 HTTP 证据 |
| **U4** | `--dump-config-schema` 在 netns 下 exit 1，stderr 有 4 条 `unrecognized Loader tree carrier`（`[/179]`–`[/182]`）+ 2 条 validation warning | **与模型无关**（是 agent-preset 行的 Loader 树载体校验告警）；本轮未追根因，可能影响 T06/T16/T30 | 交由 T06（patch 层）/T16（客户端插件）判定是否 0.2.0 新增破坏性变更 |
| **U5** | 未核实 `session-checkpoint-policy` 在零 key 下 `flush` 的行为细节 | 仅确认其监听 `llm/stream` 且只做本地 flush（`dsh-session-checkpoint-policy/lib/index.js:61-75`） | 需要时随 T12（会话恢复）一并看 |
| **U6** | `dsh-repeat-tool-reminder`、`dsh-tmux-context` 内含**`LlmRuntime` 的打包副本**（`repeat-tool-reminder/lib/index.js:1419`、`tmux-context/lib/index.js:1420`） | 未确认是否构成"第二个 llm 服务实现"造成绕过；`repeat-tool-reminder` **默认在组合内**（`dsh-base/cordis.patch.yml:455`），值得关注 | 交由 T04（插件 API 兼容）/T18 复核包体重复与版本漂移 |

---

## 10. 附：本轮产物清单（均在 `.workspace/audit-020/t22/`）

| 文件 | 说明 |
|---|---|
| `dump-default-web.json` | `--dump-default-config`（无用户层）输出，1259 行 |
| `dump-config-web.out` | `--dump-config`（含用户层）输出，联网态 |
| `dump-config-web-netns.out` / `.err` | 同上，`unshare -rn` + `env -i`；stderr 0 字节 |
| `web-help.out` | `--profile web --help`，netns 内 |
| `dump-schema.out` / `.err` | `--dump-config-schema`，netns 内（见 U4） |
| `home/.dsh/` | 本轮使用的隔离 DSH_HOME（空根，非 3080/3097 实例） |

三份配置 dump 的 sha256 均为 `659238dbbddb6bdb8948c1c21ccca89a4f8d2551f124aea317805c941a2c7de5`，
即**联网/隔离、含/不含用户层，输出完全一致** —— 启动组合不含任何网络或凭据分支。
