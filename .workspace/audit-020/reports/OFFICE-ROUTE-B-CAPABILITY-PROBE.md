# OFFICE ROUTE B 官方能力勘察档（0.2.0-rc.1）

- 调研对象：`@deepseek-ai/dsh@0.2.0-rc.1` 是否已对**插件**开放「从工作区文件创建一个会话/工作区」的能力面。
- 性质：**只读源码级勘察**。未修改任何既有文件；未启动任何监听端口的服务；未向任何端口发请求；零模型请求；未使用 `sandbox_permissions`。
- 唯一写入：本文件。
- 阅读约定：凡本档给出「文件:行号」的结论，均为本次亲自打开文件读到的内容。凡未能亲自读到出处的，一律标 **[未核]**，不引用历史报告结论。

---

## 0. 结论摘要（三分类）

### 判定：**`已有官方开放面`（Route B 不需要官方新增任何接口）**

0.2.0 不仅对插件开放了「文件 → 工作区 + 会话」的原语，而且**已经把这个组合打包成了一个官方插件包**：

> `@deepseek-ai/dsh-webhook` —— 官方描述原文：「Fire-and-forget webhook rule runtime that creates Workspace-backed DeepSeek Harness Sessions」；README 摘要原文：「a registry for trusted programmatic webhook rules plus **the one built-in action, creating an ordinary root Session inside a Web Workspace**」。
> 出处：`$T020/dsh-webhook/package.json:3`（description）、`$T020/dsh-webhook/README.md:4,12`。

其内置动作的入参就是本任务所需的最小面：`{ workspacePath, title, prompt, agentPreset, permissionPreset, model? }`（`$T020/dsh-webhook/lib/types/types.d.ts`，`WebhookSessionRequest`），且运行时**自己完成**「解析或创建工作区 → 以该路径为 `SessionHeader.cwd` 创建 Agent → 挂预设 → 附加会话 → 设权限 → 设标题 → 投 prompt」全链路（`$T020/dsh-webhook/lib/index.js:148-219`）。

三点判定依据（缺一不可）：

1. **原语已开放且是官方面向插件的**：`ctx.agents.create(options)`（`$T020/dsh-agent/lib/index.js:451`）与 `ctx.workspaceRegistry.create(path, title?)`（`$T020/dsh-workspace/lib/types/index.d.ts:145`）。前者被官方插件 `dsh-acp`（stdio JSON-RPC 驱动会话）与 `dsh-headless`（CLI 一次性任务）实际调用，类型声明里明确写着该面是给 `ctx.agents` 消费者（举例即 ACP bridge）编程用的。
2. **组合已官方打包**：`dsh-webhook` + `dsh-webhook-github` 是 0.2.0 新增的官方包，**已随包发布但没有任何 bundle 挂载**（§4.4 表 + §8.3 的范围说明 + 附录可复现命令）⇒ 属于「profile 显式加一行即启用」的既有开放面，不是需要上游开发的新接口。
3. **入口形态已有官方范式**：`dsh-webhook-github` 演示了「外部投递 → 会话」的官方推荐入口形态 —— 在 `ctx.webServer` 上注册**一个非 `/api` 的精确路由**（因此**完全绕开** `dsh-client-connection` 的 `admit()` cookie 门），鉴权由适配器自己实现（HMAC），返回 `202` 不等待（`$T020/dsh-webhook-github/lib/index.js:118-127,190`）。

### 对三个子问题的直接回答

| 问题 | 回答 |
|---|---|
| 官方是否提供「插件可用的会话创建」面？ | **是**。原语 `ctx.agents.create()`；打包形态 `ctx.webhookRuntime` 的 `WebhookSessionRequest`；Remote 形态 `session/create`。 |
| `workspace.list` 在 0.2.0 的替代品？ | **`workspace/follow`（stream）**。`workspace` 命名空间在 0.2.0 **没有 `list`**；工作区列举从一元 RPC 改成了 gateway 流：首个 item 即完整 baseline `{items, archivedSessionIds, pinnedSessionIds}`，其后是增量。另有 `session/list`（会话列举）、`workspaceFiles/list`（目录项列举）、`directoryPicker/list`（文件系统浏览，受 `browse` 能力门控）三个**语义不同**的 `list`，**都不是** `workspace.list` 的替代品。 |
| host 侧插件是否天然绕过 cookie 门？ | **是，天然绕过**。`admit()` 只在 web server 的路由处理器里被调用（`$T020/dsh-client-connection/lib/index.js:647` 与 `:834`）；插件走进程内 `ctx.*` 服务调用，不经过 HTTP。官方 README 亦明说「a composition **without** Connection … owns an operator scope with the same contract」（`$T020/dsh-client-connection/README.md:45`），Gateway 的 `operatorPeer()` 正是该路径（`$T020/dsh-api-gateway/lib/index.js:795-800`）。 |

---

## 1. 证据基线

| 代号 | 路径 | 用途 |
|---|---|---|
| `$T020` | `/home/CNS2026495165/dsh/.workspace/audit-020/assembly-020/prefix-cli/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/` | 0.2.0-rc.1 主证据树（288 包） |
| `$T011` | `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/` | 0.1.1 对照树（197 包，只读） |
| `$A20` | `/home/CNS2026495165/dsh/.workspace/audit-020/assembly-020/` | 已装配的 0.2.0 home（含 `home/profiles/web/cordis.patch.yml`） |

包清单层面的版本差异（`ls` 实测）：

- 0.2.0 新增相关包：`dsh-api-session-controller`、`dsh-api-workspace-controller`、`dsh-api-workspace-files`、`dsh-api-job-controller`、`dsh-api-account-controller`、`dsh-api-settings-controller`、`dsh-api-terminal-controller`、`dsh-skill-office`、`dsh-office-to-pdf`、`libreoffice-kit`、`libreoffice-kit-wasm`、`dsh-acp`、`dsh-acp-app`、`dsh-webhook`、`dsh-webhook-github`、`dsh-typert-registry`、`dsh-typert-protocol`、`dsh-sdk-app`、`dsh-sdk-jsonrpc-server`、`dsh-sdk-minimal`、`dsh-api-remotes`、`dsh-util-workspace-path`、`dsh-fs-observation-policy`（last two 属其他范围）。
- 0.1.1 有而 0.2.0 没有：`dsh-host-apiproxy`（0.1.1 的 `/api` 实现体）、`dsh-client-runtime`、`dsh-code-runtime`、`dsh-workflow-worker-thread`、`dsh-tool-subagent-report`、`dsh-agent-presets`、`dsh-settings-file`、`dsh-host-apiproxy` 等。
- 0.1.1 **完全没有** office 相关包：`ls $T011 | grep -i "office\|libre"` 返回空。office 能力是 0.2.0 全新引入。

> ⚠️ 本档所有 `$T020` 的 `lib/index.js` 均为 tsdown 打包产物（单文件含全部内部模块，如 `dsh-api-session-controller/lib/index.js` 共 3189 行）。行号对**该产物文件**有效，不对上游 TS 源文件有效。若需 TS 源行号，须另取源码树。

---

## 2. 会话创建面核验

### 2.1 `ctx.sessions`（`SessionStore`）—— 有 `create`，但**不是**给插件建「可用会话」的

| 项 | 值 | 出处 |
|---|---|---|
| 服务键 | `sessions`（`super(ctx, "sessions")`） | `$T020/dsh-session/lib/index.js:1621`（类声明 `:1596`，构造器 `:1620`） |
| 类 | `SessionStore extends Service` | `$T020/dsh-session/lib/index.js:1596`；类型 `$T020/dsh-session/lib/types/index.d.ts:334` |
| 导出名 | `SessionStore`（default 亦为它） | `$T020/dsh-session/lib/index.js:1933`（export 行，亲自读到） |
| `create(id?, options?)` | ✅ 存在，返回 `Session` | 类型 `$T020/dsh-session/lib/types/index.d.ts:370`；运行时 `$T020/dsh-session/lib/index.js:1653` |
| `prepare(id?, options?)` | ✅ 存在，返回**未入库**的 `Session` | 类型 `:390`；运行时 `$T020/dsh-session/lib/index.js:1680` |
| `enter(session)` | ✅ 入库并装 append 钩子，返回 detach disposer | 类型 `:413`；运行时 `:1734` |
| `announce(session)` | ✅ 恰好一次发 `session/created` | 类型 `:423`；运行时 `:1782` |
| `flush(session)` | ✅ 持久化屏障 | 类型 `:439`；运行时 `:1832`（`async flush(session)`） |
| `get(id)` / `list()` | ✅ | 类型 `:447` / `:452`；运行时 `:1861` / `:1868` |
| `open(id, 'write')` | ❌ **`ctx.sessions` 上不存在**，无 mode 参数，无 reader/writer 概念 | 全文件 grep `writer-held`、`mode: "write"`、`'write'` 于 `$T020/dsh-session/lib/index.js` 均为 0 命中 |

**关键前置条件（决定 Route B 必须走 `ctx.agents` 而非 `ctx.sessions`）**：

> 类型文档原文：「In-memory session store (`ctx.sessions`). **Persistence is intentionally not implemented here** — the agent lifecycle attaches a session-log writer to each published session's write handle; **a session published outside that lifecycle persists nothing**.」
> 出处：`$T020/dsh-session/lib/types/index.d.ts:327-333`。

即：`ctx.sessions.create()` 只造一个内存 `Session`，**不落盘、不绑 writer、不建 Agent**。要得到「能被 GUI 列出、能持久化、能跑模型」的会话，必须走 agent 生命周期。

### 2.2 `open(id, 'write')` 的真实归属

用户提问中的 `open(id, 'write')` **不在 `ctx.sessions`，而在 `ctx.sessionPersistence`**（持久化层，管日志 I/O 与单写者所有权）：

- README 原文示例：`const handle = await ctx.sessionPersistence.open(id, 'write')  // claim single-writer ownership of an existing session`
  出处：`$T020/dsh-session-persistence/README.md:40`。
- 单写者语义：「`create` and `open(id, 'write')` take in-process single-writer ownership: a second write open while an owner is active rejects with `SessionAlreadyOwnedError` … a mutation on a `read` handle rejects with `SessionReadOnlyError`」——`$T020/dsh-session-persistence/README.md:53`。
- 错误类定义：`$T020/dsh-session-persistence/lib/index.js:44-50`（`SessionAlreadyOwnedError`，消息形如 `session "<id>" is already owned by an active write handle`）。
- 另有跨进程租约：「The shipped JSONL provider adds a kernel-backed lease across instances and processes」——`$T020/dsh-session-persistence/README.md:149`。
- 该错误被 API 层映射为 wire 码：`session/writer-held`——`$T020/dsh-api-session-controller/lib/index.js:241` 与 `:1008`。

> **修正用户的表述**：`open(id,'write')` 是**日志单写者所有权**，不是「会话写权限」；它**没有任何权限/鉴权含义**，是并发正确性原语。

### 2.3 `ctx.agents`（`AgentRegistry`）—— **这就是 Route B 要找的那一环**

| 项 | 值 | 出处 |
|---|---|---|
| 服务键 | `agents`（`super(ctx, "agents")`） | `$T020/dsh-agent/lib/index.js:332`（类声明 `:322`） |
| 类 | `AgentRegistry extends Service` | `$T020/dsh-agent/lib/index.js:322` |
| `create(options)` | ✅ `Promise<AgentHandle>` | 运行时 `$T020/dsh-agent/lib/index.js:451`；类型 `$T020/dsh-agent/lib/types/index.d.ts:278` |
| `resume(options)` | ✅ `Promise<AgentHandle>` | 运行时 `:464`；类型 `:286` |
| 工厂 | `setFactory(factory)`（`dsh-agent-loop` 在构造时注册） | `$T020/dsh-agent/lib/index.js:427`；调用点 `$T020/dsh-agent-loop/lib/index.js:1563` |
| `AgentHandle` | `{ agent, dispose(): Promise<void> }`，`dispose()` 停 loop→注销→移出 store→解挂作用域 | `$T020/dsh-agent/lib/types/index.d.ts:143-146`（文档 `:129-142`） |

`CreateAgentOptions`（`$T020/dsh-agent/lib/types/index.d.ts:48-128`）关键字段：

```
sessionId: SessionId                       // 必填，由调用方提供
meta?: { cwd?, parentSession?, isSeeded?, origin?: 'subagent', delegationDepth?, agentPreset? }
seed?: readonly SessionEvent[]             // fork/replay 历史
agentOptions?: AgentOptions                // provider / model …
signal?: AbortSignal
setup?: AgentSetup                         // 发布前的会话作用域组装（挂工具、prompt 段、restrict()…）
```

文档明确该面是给插件用的：`AgentFactory` 的注释原文 ——「Kept on the `dsh-agent` interface so that consumers (**e.g. the ACP bridge**) program against `ctx.agents` without depending on the concrete `dsh-agent-loop` package.」出处：`$T020/dsh-agent/lib/types/index.d.ts:147-153`。

**官方实际调用者（同版本树内，可交叉验证这是「生产用法」而非死代码）**：

| 调用点 | 形态 | 出处 |
|---|---|---|
| `dsh-acp`（官方 ACP stdio 服务） | `await ctx.agents.create({ sessionId, meta: { cwd }, agentOptions, signal, setup })` | `$T020/dsh-acp/lib/index.js:695-704`（`resume` 在 `:714-723`） |
| `dsh-headless`（官方 CLI 一次性任务） | `(await agents.create({ sessionId, meta: { cwd }, agentOptions, setup })).agent` | `$T020/dsh-headless/lib/index.js:316-321` |
| `dsh-webhook`（官方 webhook 运行时） | `await ctx.agents.create({ sessionId, signal, meta: { cwd: workspace.path, agentPreset }, agentOptions, setup })` | `$T020/dsh-webhook/lib/index.js:163-175` |
| `dsh-api-session-controller`（官方 Remote 层） | `await this.ctx.agents.create({ sessionId, agentOptions, meta: { cwd, agentPreset }, setup })` | `$T020/dsh-api-session-controller/lib/index.js:450-458` |

`dsh-headless` 的 cordis patch 注释直接把这个模式写成了官方范式：「the direct driver **creates a fresh Agent**, or adopts the exact Session the flag names, **through the core registry**」——`$T020/dsh-headless/cordis.patch.yml:5-7`。且该 bundle「mounts no Host, HTTP server, Web runtime, or browser plugin」（同文件 `:2`）⇒ **完全无 HTTP、无鉴权、无 cookie**。

### 2.4 `session/create`（Remote 形态）语义与前置条件

| 项 | 值 | 出处 |
|---|---|---|
| 端点 | `session/create`（HTTP 路径 `/api/session/create`） | `$T020/dsh-api-session-controller/lib/typert.host.js`（见 §2.5 抽取法） |
| 命名空间注册 | `super(ctx, "sessionController", { namespace: "session" })` | `$T020/dsh-api-session-controller/lib/index.js:2847` |
| 实现 | `SessionCommandController.create(request)` | `:686-714` |
| 参数互斥 | `workspaceId` 与 `cwd` **不可同时给**，否则 `gateway/bad-request` | `:687` |
| workspaceId 解析 | `ctx.workspaceRegistry.get(workspaceId)`，找不到 → `workspace/not-found` | `:690-693` |
| cwd 优先级 | `workspace?.path ?? request.cwd ?? defaultCwd`（`defaultCwd = process.cwd()`） | `:694`；`:2850` |
| 身份 | `request.sessionId ?? session-<randomUUID>` | `:688` |
| 创建/收养 | `this.agents.ensureSession(sessionId, cwd, request.sessionId !== undefined, request.agentPreset)` | `:697`；`ensureSession` 定义 `:253-275` |
| 附加工作区 | 有 workspaceId 时 `await workspace.attachSession(sessionId)`，失败 → `session/workspace-attach-failed` | `:701-708` |
| **目录副作用** | 收养失败（会话不存在）后**会 `mkdir(cwd, { recursive: true })`** 再创建 | `:445-448`（在 `createOrAdopt` 内） |
| cwd 冲突检查 | 已存在会话的 `header.cwd !== cwd` → `ApiSessionCwdConflict` | `:273` |
| 单写者冲突 | `SessionAlreadyOwnedError` → wire 码 `session/writer-held` | `:241` |

**注意 `session/create` 的鉴权前置条件**：它是 Remote 端点，经 `/api` 即受 `admit()` cookie 门约束（§5.1–§5.3）；经 Gateway 进程内 `invoke()` 则不受（§5.4）。

### 2.5 RPC 方法清单：0.1.1 vs 0.2.0（完整枚举）

#### 抽取方法（可复现）

- **0.1.1**：一元 RPC 的唯一权威表是 `$T011/dsh-host-apiproxy/lib/types/api/rpc-map.d.ts:22-75` 的 `RpcMethodMap`（52 个键）；运行时表在 `$T011/dsh-host-apiproxy/lib/index.js` 的 `UNARY_ROUTES`（如 `"workspace.list"` 在 `:4790`，带 `invoke: (api, r) => api.workspace.list(r)`），路径解析见 `$T011/dsh-host-apiproxy/lib/types/fetch/handler.js:77` 的 `methodFor(path)`、`:226` 的 `path.slice('/api/'.length)` ⇒ **wire 路径 = `/api/<点号方法名>`**。
- **0.2.0**：唯一权威表是每个包的**生成产物** `*/lib/typert.host.js`，其 endpoint 块形如
  `id: '<pkg>#<ns>/<method>', service: '<key>', namespace: '<ns>', method: '<m>', [mode: 'stream',]`
  （样例：`$T020/dsh-api-workspace-controller/lib/typert.host.js:339-344`）。以正则批量抽取 24 个包，得 **138 个端点**。命名规则见 `$T020/dsh-typert-registry/lib/index.js:29-34`（`typertEndpoint` = `` `${namespace}/${method}` ``）⇒ **wire 路径 = `/api/<ns>/<method>`**。
- **裸 `@Remote`（无参）取被装饰方法名**，`@Remote("<name>")` 则**改名**。机制：`$T020/dsh-typert-protocol/lib/index.js:183-194`（`Remote` 无 export name 时的分支）、`:239-255`（`const method = context.name;`，`mark(...)` 仅在 `exportName !== method` 时写入 `exportName`）。因此源码里 `_x_decorators = [Remote]` 与 `Remote("y")` 必须区别对待——本节清单按 **export name**（即 wire 名）取值。

#### 0.1.1 完整清单（52 个一元方法）

| 命名空间 | 方法 |
|---|---|
| `session` (12) | list, search, create, history, models, selectModel, rename, fork, prompt, attachment, updateQueue, cancel |
| `subagent` (4) | list, history, prompt, interrupt |
| `host` (5) | describe, pickDirectory, listDirectory, createDirectory, openPath |
| `workspace` (7) | **list**, create, rename, delete, insertBefore, insertSessionBefore, archiveSession |
| `skill` (1) | list |
| `agentPreset` (6) | list, select, read, copy, openDocument, remove |
| `goal` (6) | create, edit, pause, resume, complete, clear |
| `settings` (5) | describe, openDocument, update, replace, mutate |
| `credentials` (3) | describe, set, unset |
| `llm` (3) | providers, models, discoverModels |

来源：`$T011/dsh-host-apiproxy/lib/types/api/rpc-map.d.ts:22-75`。

0.1.1 的**非一元** HTTP 路由（同一 fetch handler）：`/api/events.mux`（GET→ws）、`/api/events.host`（GET→ws）、`/api/session.export`（GET/HEAD）、`/api/respond`（POST）—— 出处 `$T011/dsh-host-apiproxy/lib/types/fetch/handler.js:180,183,186,220`。下载类路由（存在 `api/downloads.js` / `downloads.schema.js`）本次**未逐一枚举**，标 **[未核]**。

#### 0.2.0 完整清单（138 个端点，按命名空间）

| 命名空间 | 端点（`[stream]` = `mode: stream`） | 包 |
|---|---|---|
| `session` (19) | list, search, create, selectModel, initializeDefaultModel, modelCatalog, canOpenWorkspacePath, openWorkspacePath, workspacePathApplications, rename, fork, prompt, attachment, updateQueue, cancel, page, **follow [stream]**, projections, **control [stream]** | dsh-api-session-controller |
| `fileReferences` (1) | list | dsh-api-session-controller |
| `skills` (1) | list | dsh-api-session-controller |
| `workspace` (11) | create, initializeDefault, rename, delete, insertBefore, insertSessionBefore, archiveSession, unarchiveSession, pinSession, unpinSession, **follow [stream]** —— **无 `list`** | dsh-api-workspace-controller |
| `directoryPicker` (3) | pick, list, createDirectory | dsh-api-workspace-controller |
| `workspaceFiles` (5) | read, readBytes, stat, list, **changes [stream]** | dsh-api-workspace-files |
| `job` (3) | kill, **list [stream]**, **follow [stream]** | dsh-api-job-controller |
| `terminal` (10) | environment, shells, list, create, retain, follow, write, resize, rename, close | dsh-api-terminal-controller |
| `account` (9 一元 + 2 流) | getState, getProfile, getBalance, getUnnotifiedBonuses, ackBonusNotified, startSignIn, cancelSignIn, hasRunningAccountTasks, signOut; watch [stream], watchExpiry [stream] | dsh-api-account-controller |
| `credentials` (3) | describe, set, unset | dsh-api-settings-controller |
| `settings` (5) | describe, openSettingsDocument, update, replace, mutate | dsh-api-settings-controller |
| `agentPresets` (3) | list, read, select | dsh-agent-preset-registry |
| `commands` (2) | list, execute | dsh-commands |
| `goals` (7) | create, edit, pause, resume, complete, clear, get | dsh-goal |
| `schedule` (5) | catalog, list, history, update, delete | dsh-schedule |
| `subagents` (2) | prompt, interruptByParent | dsh-subagent |
| `llm` (3) | listProviders, listConfigurableProviders, discoverModels | dsh-llm |
| `fileUploads` (1) | upload | dsh-client-file-upload |
| `sessionReferenceResolver` (1) | candidates | dsh-session-reference |
| `sessionFeedback` (1) | record | dsh-command-feedback |
| `messageFeedback` (3) | list, put, delete | dsh-message-feedback |
| `permissionPresets` (1) | catalog | dsh-permission-presets |
| `pluginInventory` (1) | list | dsh-host-plugin-inventory |
| `pluginManager` (12) | listBundles, listPlugins, installBundle, removeBundle, setBundleEnabled, setPluginEnabled, inspect, registries, listVersionExemptions, setVersionExemption, cancelInstall, waitForInstall | dsh-plugin-manager |
| `pluginRegistryProbe` (1) | fastest | dsh-client-ui-plugin-manager |
| `dynamicCordisRunner` (12) | inventory, invoke, getClientCode, runHostHalf, syncInspectManifest, resolveInspectQuery, resolveRequestRun, settleUserRun, reportClientGuardFailure, reportRenderFailure, stopFromPanel, undefineFromPanel | dsh-cordis-host-runner |
| `productAnalytics` (2 + 1 流) | enabled, report; watchPolicy [stream] | dsh-client-product-analytics |
| `speech` (5 + 1 流) | cancelPreparation, catalog, configure, prepare, transcribe; follow [stream] | dsh-experimental-api-speech-to-text |
| `officeToPdf` (2) | render, generation | dsh-office-to-pdf |

#### 增删（对 Route B 有意义的部分）

| 0.1.1 | 0.2.0 | 性质 |
|---|---|---|
| `workspace.list` | **`workspace/follow`（stream）** | **改形**（一元 → 流；baseline 含 `items`/`archivedSessionIds`/`pinnedSessionIds`） |
| `workspace.create` | `workspace/create` | **保留**（语义不变，见 §3.2） |
| — | `workspace/initializeDefault` | 新增（首次使用建默认工作区） |
| — | `workspace/unarchiveSession` / `pinSession` / `unpinSession` | 新增 |
| `session.history` | `session/page` | 改名/改形（「cold-safe, message-aligned Session history page」，`$T020/dsh-api-session-controller/lib/index.js:3124-3132`） |
| `session.models` | `session/modelCatalog` | 改名（「Describe every currently routable model for Host-generation selectors」，`:2998-3001`） |
| — | `session.follow` / `session.control` | 新增流 |
| — | `session.initializeDefaultModel` / `canOpenWorkspacePath` / `openWorkspacePath` / `workspacePathApplications` / `projections` | 新增 |
| `session.create` | `session/create` | **保留**（语义见 §2.4） |
| `host.*`（5） | **整体消失** | 拆解：目录选择 → `directoryPicker/{pick,list,createDirectory}`；`host.openPath` → `session/openWorkspacePath` + `session/workspacePathApplications` |
| `skill.list` | `skills/list` | 改名 |
| `agentPreset.*`（6） | `agentPresets/{list,read,select}`（3） | 收窄（copy/openDocument/remove 无对应；settings 侧出现 `settings/openSettingsDocument`） |
| `settings.openDocument` | `settings/openSettingsDocument` | 改名 |
| `llm.providers` / `llm.models` | `llm/listProviders` / `llm/listConfigurableProviders` | 改名 |
| `subagent.{list,history,interrupt}` | `subagents/{prompt,interruptByParent}` | 收窄 |
| `goal.*` | `goals/*` + 新增 `goals/get` | 改名 + 新增 |
| — | `sessionFeedback/*`、`messageFeedback/*`、`job/*`、`terminal/*`、`account/*`、`workspaceFiles/*`、`officeToPdf/*`、`pluginManager/*` 等 | 全新 |

---

## 3. 工作区面核验（`workspace.list` 归属）

### 3.1 结论：`workspace.list` 在 0.2.0 **不存在**；替代品是 `workspace/follow`（stream）

**四重独立证据**（不依赖历史报告）：

1. **生成端点的正则批量抽取**：`$T020/dsh-api-workspace-controller/lib/typert.host.js` 中 `namespace: 'workspace'` 的端点全集为
   `archiveSession, create, delete, follow, initializeDefault, insertBefore, insertSessionBefore, pinSession, rename, unarchiveSession, unpinSession` —— **11 个，无 `list`**。
2. **装饰器端**：`$T020/dsh-api-workspace-controller/lib/index.js:701-711` 仅注册
   `create, initializeDefault, rename, delete, insertBefore, insertSessionBefore, archiveSession, unarchiveSession, pinSession, unpinSession`，外加 `:711` 的 `_follow_decorators = [Remote({ mode: "stream" })]`。类体（`:855-958`）的公开方法同此，**无 `list`**。
3. **全树 grep**：`grep -rn "workspace/list\|workspace\.list" $T020/*/lib/index.js` → **0 命中**（即连兼容别名都没有）。
4. **对照 0.1.1 确证存在过**：`$T011/dsh-host-apiproxy/lib/types/api/workspace.d.ts:42-45` 定义 `list(request)` 返回 `{ items: WorkspaceView[]; archivedSessionIds }`；运行时 `$T011/dsh-host-apiproxy/lib/index.js:4790-4793` 有 `"workspace.list"` 行，`invoke: (api, r) => api.workspace.list(r)`；客户端绑定 `:5517`。

### 3.2 替代品的确切形态

`workspace/follow`（`@Remote({ mode: "stream" })`）的 baseline/增量结构（`$T020/dsh-api-workspace-controller/lib/index.js`）：

- `WorkspaceFeed.baseline()`（方法体 `:66-71`）返回
  `{ items: <每个 workspace 的 workspaceView>, archivedSessionIds: [...], pinnedSessionIds: [...] }`
  其中 `workspaceView`（`:16-27`）字段为 `{ workspaceId, path, title, sessionIds, createdAt, updatedAt }` —— **与 0.1.1 `WorkspaceView`（`$T011/.../workspace.d.ts:18-33`）字段逐一对应**。
- `WorkspaceFeed.follow(signal)` 是 async generator（`:78`），先给完整 baseline，再给有序增量（`domain/changed` 事件驱动）；控制器入口 `WorkspaceController.follow(signal)` 在 `:952`，返回 `this.feed.follow(signal)`。
- 0.1.1 baseline 只有 `{items, archivedSessionIds}`；0.2.0 多出 `pinnedSessionIds`。

### 3.3 三个「同名但不替代」的 `list` —— 必须分清

| 端点 | 语义 | 出处 |
|---|---|---|
| `workspaceFiles/list` | **一个目录的直接子项**（`WorkspaceDirectoryListing { path, entries, truncated }`），锚定**某会话的工作区根**；需传 sessionId | `$T020/dsh-api-workspace-files/lib/index.js:349`（`Remote("list")`）、命名空间 `:395`（`super(ctx, "workspaceFiles")`，无 `options` ⇒ 按 `$T020/dsh-typert-protocol/lib/index.js:148` 默认取服务键）；README 有方法表 |
| `directoryPicker/list` | **in-app 目录浏览器的一层**，返回该层 listing + ancestry；路径可为绝对路径（省略则列 home）；**受能力门控** | `:497-504`；能力门控 `requireCapability("browse","list")` 见 `:498` 与 `:525-529` |
| `session/list` | **会话**列举（不是工作区） | `$T020/dsh-api-session-controller/lib/index.js:2581`（`Remote("list")`） |

> **Route B 端点命名落点**：注册表里**没有** `workspace.list`。若 Route B 需要「把工作区列给 OS 侧看」，应消费 `workspace/follow` 的 baseline，或用 `session/list`；**不要在 `/api/workspace/list` 上打请求**（0.2.0 下未认领端点一律 404，见 §5.3）。

### 3.4 `directoryPicker` 的能力门控（对本部署尤其重要）

```js
requireCapability(kind, method) {
  const capability = this.ctx.directoryPicker.capability();
  if (capability.kind !== kind) throw new RemoteError("directory-picker/unavailable", ...);
  return capability;
}
```
出处：`$T020/dsh-api-workspace-controller/lib/index.js:525-529`。

- `pick` 要求 `kind === "native"`（`:483`）；`list` 与 `createDirectory` 要求 `"browse"`（`:498`, `:517`）。
- 本部署已装配的 profile 关掉了 auto picker、换成 browse 后端：

```yaml
- id: directory-picker
  disabled: true
- insert:
    - id: directory-picker-browse
      name: '@deepseek-ai/dsh-host-directory-picker-browse'
```
出处：`$A20/home/profiles/web/cordis.patch.yml:72-76`。

⇒ **在本装配下 `directoryPicker/list` 与 `directoryPicker/createDirectory` 可用（browse），`directoryPicker/pick` 不可用（native）**。这是源码 + 装配文件双证据推断，**未实跑验证**，标 **[未核-实跑]**。

### 3.5 `ctx.workspaceRegistry` 的创建面

| 项 | 值 | 出处 |
|---|---|---|
| 服务键 | `workspaceRegistry` | `$T020/dsh-workspace/lib/index.js:374` |
| `create(path, title?)` | ✅ `Promise<Workspace>` —— **对「已存在目录」注册（不 mkdir）** | 类型 `$T020/dsh-workspace/lib/types/index.d.ts:145` |
| `initializeDefault(resolveDirectory)` | ✅ `Promise<Workspace \| undefined>` | 类型 `:158` |
| `archivedSessionIds` / `pinnedSessionIds` | 只读集合 getter | 类型 `:195`（archived） |
| 幂等收养语义 | 路径已是某 workspace ⇒ 返回该 workspace（`created: false`） | 0.1.1 契约文档 `$T011/.../workspace.d.ts:46-53`；0.2.0 实现 `$T020/dsh-api-workspace-controller/lib/index.js:211-226` 走同一 `ctx.workspaceRegistry.create(request.path)` |
| 附加会话 | `workspace.attachSession(sessionId)` | 使用点 `$T020/dsh-webhook/lib/index.js:179`、`$T020/dsh-api-session-controller/lib/index.js:702` |
| 分离（回滚） | `workspace.detachSession(sessionId)` | `$T020/dsh-webhook/lib/index.js:201` |

---

## 4. 官方 office 能力现状

### 4.1 `dsh-skill-office`：**存在、完整、可插件化复用，但 web 侧未挂载**

| 项 | 值 | 出处 |
|---|---|---|
| 包存在 | ✅ `$T020/dsh-skill-office/`（0.1.1 **无**） | 目录实测 |
| 插件名 | `skill-office` | `$T020/dsh-skill-office/lib/index.js:23` |
| 注入 | `inject = ["skills"]` | `:25` |
| 注册方式 | `ctx.skills.registerProvider(() => provider)` | `:95` |
| 提供的技能 | `office-docx`, `office-pptx`, `office-xlsx`（`SKILL_NAMES`） | `:11-15`；资产 `assets/office-{pptx,docx,xlsx}/SKILL.md` + `assets/scripts/check_office.py` |
| provider id | `dsh-office`，`source: "bundled"`，`rank: BUNDLED_SKILL_RANK` | `:70-72` |
| 依赖 | `@deepseek-ai/libreoffice-kit`（`^0.1.1`）、`yaml`、`schemastery` | `package.json` |
| **挂载它的 bundle** | **只有 `dsh-sdk-app`** | `$T020/dsh-sdk-app/cordis.patch.yml:36-41` |
| **门控** | `disabled: !!js "!(process.env.DSH_PRIMARY_RUNTIME ?? process.env.DSH_BUNDLED_PRIMARY_RUNTIME)"` | 同文件 `:38` |
| 配置 | `assetRoot` = `$DSH_PRIMARY_RUNTIME/../office-skills`；`node` = `$DSH_PRIMARY_RUNTIME/dependencies/node/bin/node` | 同文件 `:40-41` |

**web bundle 未挂载它**：`grep -rn "skill-office" $T020/*/cordis.patch.yml` 只命中 `dsh-sdk-app/cordis.patch.yml`。web 侧的 `dsh-web-app/cordis.patch.yml` 里**没有** skill-office 行。

⇒ **「哪个 bundle 挂载它」的答案：只有 SDK bundle，且受 `DSH_PRIMARY_RUNTIME` 门控**。`DSH_PRIMARY_RUNTIME` 在整树中的出现位置仅：`dsh-sdk-app/{cordis.patch.yml,README.md,README.zh.md}`、`dsh-tool-workspace-dependencies/{README.md,README.zh.md}`（`grep -rln` 实测）——即该变量是 **SDK/packaged-app 专属**概念，与 web profile 无关。

⇒ **能否被插件化复用**：**能**。它是一个普通 Cordis 插件，`inject: ["skills"]`，任何 profile patch 都能加一行
`- insert: [{ id: skill-office, name: '@deepseek-ai/dsh-skill-office', config: { assetRoot: <绝对路径>, node: <绝对路径> } }]`
（`Config` 三字段：`assetRoot`、`node`、`cli`，见 `:17-21`）。注意 `assetRoot` / `node` **必须绝对路径且文件存在**，否则 `apply` 直接抛错（`:56-57`, `:43`）。

### 4.2 `dsh-office-to-pdf`：**在 web layer，已挂载，且是 Remote + 进程内双面**

| 项 | 值 | 出处 |
|---|---|---|
| 包存在 | ✅（0.1.1 无） | 目录实测 |
| **挂载它的 bundle** | **web bundle**：`- id: office-to-pdf` / `name: '@deepseek-ai/dsh-office-to-pdf'` | `$T020/dsh-web-app/cordis.patch.yml:269-270` |
| 服务键 / 命名空间 | `super(ctx, "officeToPdf")`（无 options ⇒ 命名空间 = `officeToPdf`） | `$T020/dsh-office-to-pdf/lib/index.js:453` + `$T020/dsh-typert-protocol/lib/index.js:148` |
| Remote 端点 | `officeToPdf/render`（JS 方法 `render`，装饰器为**裸** `[Remote]`：`:408` + 方法名 `:412`）、`officeToPdf/generation`（装饰器 `Remote("generation")` **改名**，JS 方法名为 `getGeneration`：`:409` + `:421-423`） | 同文件；亦见 §2.5 抽取表。抽取表按 **export name** 取值，故为 `generation` |
| 浏览器侧接线 | `dsh-api-remotes/lib/client.js` 引入 `@deepseek-ai/dsh-office-to-pdf/remote` 并 `$mount` | `$T020/dsh-api-remotes/lib/types/client/index.js:7,42` |
| 消费方 | `dsh-client-ui-sidebar-documentpreview`（文档预览的 Office→PDF） | `grep` 命中该包 |
| 引擎 | `@deepseek-ai/libreoffice-kit`（native 或 WASM） | README「Summary」/`package.json` |
| **进程内可用性** | README 原文：「Callers submit … through `ctx.officeToPdf.convert()`. … **In-process `convert()` does not require those services.**」（those services = `workspaceFiles` 授权与 `fs` 读取） | `$T020/dsh-office-to-pdf/README.md`（"Use this package" 段） |

⇒ **能否被插件化复用**：**能，且 web 侧已在位**。插件可直接 `ctx.officeToPdf.convert()` 而不经 Remote/授权链（官方 README 明示），也可让浏览器走 `officeToPdf/render`。

### 4.3 0.1.1 对照

0.1.1 树中 `ls $T011 | grep -i "office\|libre"` **返回空**；`dsh-skill-*` 只有 `dsh-skill`、`dsh-skill-badge`、`dsh-skill-filesystem`。⇒ **office 相关能力在 0.1.1 完全不存在**，「办公入口」此前必须自研，这一点与背景事实一致（本次独立复核通过）。

### 4.4 附带发现：`dsh-acp` / `dsh-headless` 是同一族「外部投递 → 会话」官方实现

| 包 | 形态 | 挂载 | 鉴权 |
|---|---|---|---|
| `dsh-acp` | JSON-RPC **stdio**（`ndJsonStream(process.stdout, process.stdin)`）—— `$T020/dsh-acp/lib/index.js:1319`；`name = "acp"`（`:1047`）；包描述「Automation-only Agent Client Protocol server for driving DeepSeek Harness agents over JSON-RPC stdio」 | `dsh-acp-app/cordis.patch.yml:16-22`（**独立 bundle**，`dsh-acp-app`） | **无任何鉴权**；信任边界 = 谁能写子进程 stdin |
| `dsh-headless` | CLI 一次性任务（`dsh --profile headless "<task>"`） | `dsh-headless/cordis.patch.yml:20-31`（**独立 bundle**） | **无任何鉴权**；信任边界 = 本机进程 |
| `dsh-webhook` + `-github` | 进程内规则运行时 + HTTP 适配器 | **无 bundle 挂载**（见 §4.4 与 §8.3） | 适配器自带（HMAC 签名） |

---

## 5. 鉴权面机制与插件是否绕过

### 5.1 `admit()` 的确切校验内容

```js
requestRejection(request) {
  if (!isTrustedApiRequest(request, this.trustedHosts)) return 403;
  return this.browserAuth.isAuthenticated(request) ? void 0 : 401;
}
admit(request) {
  const rejection = this.requestRejection(request);
  return rejection === void 0 ? { peer: this.operator } : { rejection };
}
```
出处：`$T020/dsh-client-connection/lib/index.js:586-594`。服务键 `connection`（`:566`）。

**两道门，顺序固定**：

1. **Host/Origin 信任栅栏 → 403**（`isTrustedApiRequest`，`:205-219`）：
   - `Host` 头必须存在且可解析（`:206-209`）；
   - 主机名必须**是 loopback，或在 `trustedHosts` 中**（`:210`）；
   - `sec-fetch-site: cross-site` 一律拒（`:211`）；
   - 有 `Origin` 时其 host 必须等于 `Host`（`:212-218`）。这是 DNS-rebinding / 跨站防御，**不建立身份**。
2. **浏览器 cookie → 401**（`browserAuth.isAuthenticated`，`:433-443`）。

### 5.2 cookie 的具体形态（`BrowserAuth`）

| 项 | 值 | 出处 |
|---|---|---|
| 类 | `BrowserAuth`（私有构造，`static create(processOwner, credentials, maxAgeDays)`） | `:344+`；类型 `$T020/dsh-client-connection/lib/types/browser-auth.d.ts:9-22` |
| **cookie 名** | `dsh-auth-` + `base64url(sha256(authority))`，`authority` = 规范化后的 `Host`（`requestAuthority`，`:257-265`） | `COOKIE_PREFIX = "dsh-auth-"`（`:227`）；`cookieName(authority)`（`:284-286`） |
| **cookie 值格式** | `v1.<base64url(JSON payload)>.<base64url(HMAC-SHA256(secret, body))>` | `encodeCookie`（`:302-305`）；`decodeCookie`（`:306-324`） |
| payload | `{ version: 1, authority, issuedAt, expiresAt }` | `:397-402`（签发）、`:322`（校验） |
| **签名密钥位置** | 凭据记录 `credentialKey("client-connection", "browser-session")`（`AUTH_RECORD_KEY`，`:223`），经 `ctx.credentials.modifyRecord(...)` 懒创建；32 随机字节（`SECRET_BYTES = 32`，`:225`）；本地 provider 落在 `$DSH_HOME/.credentials.yaml` | 代码 `:325-341`；README 原文 `$T020/dsh-client-connection/README.md:41` |
| **如何签发** | ① 每进程一个随机 launch token：`encodeBase64Url(randomBytes(32))`，存 `WeakMap`（key = root ctx）—— `:244-250`；② 启动时把它作为 `?token=` 加进应用 URL（`authenticatedUrl`，`:376-377`）；③ 浏览器 `GET /` 携带该 token ⇒ 校验 `tokenMatches`（timingSafeEqual，`:279-283`）⇒ 写 `Set-Cookie` 并 `303 → ./`；④ 无 token 时改用已签发 cookie | `authorizeIndex`（`:388-427`） |
| cookie 属性 | `Max-Age=<n>; Path=/; Expires=…; HttpOnly; SameSite=Strict`（**故意不带 `Secure`**，因出厂是 loopback HTTP） | `sessionCookie`（`:296-298`）；README `:41` |
| 有效期 | `cookieMaxAgeDays`，默认 **30** | `:802`（schema default）、`:815` |
| `isAuthenticated` 实际检查 | `Host` 头可解析 **且** cookie 存在 **且** 用密钥解出 payload **且** `payload.authority === authority` **且** `issuedAt <= now < expiresAt` **且** `expiresAt - issuedAt <= maxAge` | `:433-443` |
| 401 文案 | `dsh web authentication required; reopen the URL printed by dsh web.` | `:444-450` |

**「无开关可关」的源码依据**：`/api` 路由在 `apply()` 里**无条件**先 `admit`（`$T020/dsh-client-connection/lib/index.js:829-843`），`Config`（`:796-804`）只有 `recovery` / `trustedHosts` / `cookieMaxAgeDays` / `maxRequestBodyBytes` —— **没有关闭鉴权的字段**。README 进一步明说：「**there is no method-specific loopback tier**」（`:39`）。0.2.0 全树 `grep -rn "PRIVILEGED" $T020/*/lib/index.js` → **0 命中**，即 0.1.1 的「特权方法名单」机制已被整体删除。

### 5.3 `/api` 是唯一被 admit 的通道；端点语法为 `ns/method`

- **`/api` 前缀路由**：`path: API_PATH`（`"/api"`，`$T020/dsh-client-connection/lib/types/api-path.d.ts:6`），handler 内先 `admit`（`:834`）再 `bridge(...)`（`:840`）。
- **`connection.rpc.handle(channel, handler)` 注册的通道**：同一路由工厂内也先 `admit`（`:640-657`，判门在 `:647`）。
- **`connection.fetch.register(route)` 注册的精确路由**：由 `createSharedFetchHandler`（`:608-624`）分发，而它**只在 `/api` 前缀 handler 内部被调用**（`:829`）⇒ 同样经过 `admit`。例子：`/api/file`（`$T020/dsh-api-session-controller/lib/index.js:2396-2401`）。
- **端点语法**：`endpointFromPath(channel, pathname)`（`:711-716`）取 `${channel}/` 之后的部分，按 `/` 切段并逐段过 `ENDPOINT_SEGMENT_PATTERN`（`:550`）。配合 `typertEndpoint = ns/method`（`$T020/dsh-typert-registry/lib/index.js:29-34`）⇒ **HTTP 路径 = `/api/<namespace>/<method>`**（例：`/api/session/create`、`/api/workspace/follow`）。
- 摘要体校验：只收 `POST` + `content-type: application/json`（`:678-679`），且 `message.method` 必须与端点一致，否则 `gateway/bad-request`（`:689-693`）。
- **未认领端点 = 404**：`createSharedFetchHandler` 在无匹配精确路由、无匹配 interceptor 时 `new Response("not found", { status: 404 })`（`:620`）。README 同述「unclaimed requests return 404」（`:32`）。

**⇒ 对 Route A 的判决（独立复核，与背景事实一致）**：0.2.0 下 `/api` 的**每一个**入口（前缀通道、`rpc.handle` 通道、`fetch` 精确路由、WebSocket upgrade）都在 `admit` 之后；无 cookie ⇒ 401，未认领路径 ⇒ 404。**Route A 在 0.2.0 上结构性不可行，且无配置可关**。

### 5.4 host 侧插件是否天然绕过它？——**是，有四重源码依据**

1. **`admit` 的唯一调用点在 web server 路由处理器内**：全文件仅两处 —— `$T020/dsh-client-connection/lib/index.js:647` 与 `:834`。插件在进程内调 `ctx.agents.create(...)` / `ctx.workspaceRegistry.create(...)` 时**根本不经过 HTTP**，也就无从经过 `admit`。
2. **官方 README 明说存在「无 Connection 的组合」**：
   > 「`OperatorPeer` is exported so **a composition without Connection, such as the Gateway's in-process carrier, owns an operator scope with the same contract**.」
   出处：`$T020/dsh-client-connection/README.md:45`。
3. **Gateway 自带进程内 operator**：`operatorPeer()` —— 「when Connection is mounted … otherwise an operator scope the Gateway owns for its own lifetime」；代码为 `this.inProcessOperator ??= new OperatorPeer(this.ctx)`，`$T020/dsh-api-gateway/lib/index.js:789-800`。
4. **Gateway 提供不经验证的进程内调用入口**：
   - `ctx.typertGateway.invoke(request)`（`:718`）—— request 形如 `{namespace, method, args, signal, peer?}`，`peer` **可选**（`remoteRequest`，`:1216-1228`，`...peer === void 0 ? {} : { peer }`）。
   - `ctx.typertGateway.stream(request)`（`:737`）。
   - README 原文：「`ctx.typertGateway.invoke()` resolves the current descriptor and Cordis Service for each call, validates **exact named arguments**, resolves registered object or Context identities, and invokes the public business method.」——`$T020/dsh-api-gateway/README.md:27`。注意它校验的是**参数形状**，不是**身份/授权**。
5. **官方插件的实际姿态印证**：`dsh-acp` 是 stdio JSON-RPC 服务，全文件无任何 token/cookie/signature 校验（`grep` 未见鉴权构件），却直接 `ctx.agents.create(...)`；`dsh-headless` 同理且其 patch 注释自称「mounts no Host, HTTP server, Web runtime, or browser plugin」（`$T020/dsh-headless/cordis.patch.yml:2`）。

**结论**：**host 侧插件走的是进程内 `ctx.*`，与 `admit()` 正交，天然绕过**。这不是漏洞，而是 0.2.0 的**有意的分层**：`admit` 保护的是**浏览器 ↔ Host 的 HTTP 面**，不是 **Host 进程内的插件面**。插件面的信任边界是「进程/加载器」，由 profile patch 与插件清单决定。

### 5.5 但**非 `/api` 的自注册路由没有任何门**

`dsh-host-webserver` 的 README 原文（两条）：

> `host` accepts exactly two values: `127.0.0.1` (default posture, loopback only) and `0.0.0.0` (deliberate network exposure — **the server carries no TLS, authentication, or origin policy of its own**).
> 出处：`$T020/dsh-host-webserver/README.md:39`。

> **No server-wide TLS, authentication, or origin policy** — route owners such as `dsh-client-connection` enforce their own request policy. **Binding a non-loopback address still exposes unprotected routes and static assets to that network.**
> 出处：`$T020/dsh-host-webserver/README.md:113`。

`register(route)` 契约在 `$T020/dsh-host-webserver/lib/index.js:177`；`host` 枚举只有 `127.0.0.1` / `0.0.0.0`（`:142`）；`listen(port, host)` 在 `:297`。web bundle 的默认绑定是 loopback：`host: !!js ctx.webStartup.host ?? '127.0.0.1'`（`$T020/dsh-web-app/cordis.patch.yml:173`）。

**⇒ 关键安全事实**：`ctx.webServer.register()` 注册的非 `/api` 路由**既不经过 `admit`，也没有任何默认栅栏**；它的安全性**完全取决于路由所有者自己**。`dsh-webhook-github` 正是这么做的（HMAC），并提供「隔离 webServer + 独立监听 + TLS 反代」的官方组合范式（其 README「Dedicated listener composition」段，示例 `127.0.0.1:3081/github` 起反代）。

---

## 6. Route B 可行性判定与最小用法

### 6.1 判定

**`已有官方开放面`。** Route B 不需要任何上游新增接口、不需要改产品代码、不需要动 `/api`。

原先「Route B 被否决」的理由是担心暴露「任意文件 → 会话」的面（`docs/architecture/office-handoff.md` §1）。就 **0.2.0 的官方事实**而言，该担心**已被官方以受控形态正面解决**：官方给出的不是「给 HTTP 调用者一个任意文件→会话」的开关，而是

1. 一个**进程内规则运行时**（`ctx.webhookRuntime`），其 `run()` 是**部署自己写的可信代码**，由部署自行校验投递内容后才**构造** `WebhookSessionRequest`（`workspacePath` / `title` / `prompt` / `agentPreset` / `permissionPreset` 全部由规则代码逐字段决定）；
2. 一个**适配器范式**（`dsh-webhook-github`）：在 `ctx.webServer` 上注册**一个精确路径**、**自带签名鉴权**、**限长**、**HMAC 先于 JSON 解析**、返回 202 不等待。

即：**「文件→会话」的授权判断被显式地放在部署自己的规则/适配器代码里**，官方只提供带完整回滚的创建原语。这正是 Route B 需要的形状。

### 6.2 最小用法 A（推荐）：`dsh-webhook` 运行时 + 自写适配器

**挂载三行**（profile patch，`$A20/home/profiles/web/cordis.patch.yml` 里追加；**本档不执行**）：

```yaml
- insert:
    - id: webhook-runtime
      name: '@deepseek-ai/dsh-webhook'
- insert:
    - id: office-handoff-adapter
      name: <自研适配器包>          # 参照 dsh-webhook-github 形状
      config:
        source: primary-office
        path: /office-handoff        # 非 /api 的精确路径
        secretEnv: <credential ref>  # 你自己的共享密钥引用
        maxBodyBytes: <上限>
```

`dsh-webhook` 的运行时可注入依赖（`inject`，`$T020/dsh-webhook/lib/index.js:262-269`）：
`agents`、`agentDefaultModel`、`agentPresets`、`permissionPresets`、`sessionTitle`、`workspaceRegistry`。
**这六个在本部署的组合里均已满足**：`agents` ← `dsh-agent`（`$T020/dsh-base/cordis.patch.yml:75`）、`agentDefaultModel` ← `dsh-agent-default-model`（base）、`agentPresets` ← `dsh-agent-preset-registry`（`$T020/dsh-web-app/cordis.patch.yml:562-565`）、`permissionPresets` ← `dsh-permission-presets`（base `:251`）、`sessionTitle` ← `dsh-session-title`（base）、`workspaceRegistry` ← `dsh-workspace`（`$T020/dsh-web-app/cordis.patch.yml:91-92`）。

**规则注册（自研插件内）**：

```js
ctx.webhookRuntime.register({
  id: 'office-handoff',                       // 全局唯一
  kind: 'office',                             // 与适配器投递的 kind 对应
  run(delivery, signal) {                     // 部署自己的可信代码：在这里做授权判断
    // 例：校验投递来源、扩展名白名单、目标目录白名单、大小上限…
    return {
      workspacePath: <已授权的绝对目录>,        // 必须存在（create 不 mkdir）
      title:          <标题>,
      prompt:         <初始提示词>,
      agentPreset:    <已注册的 preset id>,
      permissionPreset: <已注册的权限 preset>,
      // model?: { provider, model, maxTokens? }
    };
  }
});
```
`WebhookRule` 契约见 `$T020/dsh-webhook/lib/types/types.d.ts`；`register` 返回**可 await 的 disposer**（先摘除规则、再 abort 并 drain 在跑的 callback）—— `$T020/dsh-webhook/lib/index.js:287-310`。

**运行时替你做的一致性保障**（官方已实现，不必自己写）——`createWebhookSession`，`$T020/dsh-webhook/lib/index.js:148-219`，顺序为：

1. `ctx.permissionPresets.resolve(resolved.permissionPreset)`（`:156`）——先校验权限 preset 存在；
2. `await ctx.agentPresets.resolve(resolved.agentPreset)`（`:157`）；
3. `ctx.agentPresets.acquireScope(preset.id)`（`:158`，作用域所有权）；
4. `const workspace = await ctx.workspaceRegistry.create(resolved.workspacePath)`（`:160`）——**解析或创建**工作区；
5. `ctx.agents.create({ sessionId: 'webhook-<uuid>', signal, meta: { cwd: workspace.path, agentPreset: preset.id }, agentOptions, setup })`（`:163-175`），`setup` 内 `ctx.agentPresets.mount(agentCtx, preset.id)` + 装初始模型选择（`:171-174`）——**预设先于发布挂载**；
6. `await workspace.attachSession(sessionId)`（`:179`）⇒ `attached = true`；
7. `ctx.permissionPresets.set(handle.agent.session, resolved.permissionPreset)`（`:182`）；
8. `ctx.sessionTitle.rename(handle.agent.session, resolved.title)`（`:183`）；
9. `handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: resolved.prompt }], source: { kind: 'webhook', ... } }))`（`:184-198`）——**消息来源被标记为 webhook**，携带 provider / source / deliveryId / ruleId / summary；
10. **失败回滚**：`catch` 内先 `workspace.detachSession()` 再 `handle.dispose()`，两者各自的失败都被 report 而不掩盖原错（`:199-211`）。

> 注意：`workspacePath` 走 `ctx.workspaceRegistry.create()`，其语义是「对**已存在**目录注册，**不 mkdir**」（0.1.1 契约文档 `$T011/.../workspace.d.ts:46-53`）。若目标是「OS 投递的文件所在目录可能不存在」，需在规则里先自行建目录，或改用 `session/create` 的 `cwd` 路径（它会 `mkdir(cwd, {recursive:true})`，`$T020/dsh-api-session-controller/lib/index.js:445`）。**[未核-实跑]**：`dsh-webhook` 是否把 `workspaceRegistry.create` 的失败原样抛出、以及 `initializeDefault` 是否被用到，未实跑确认。

### 6.3 最小用法 B（更直接）：自研插件直接调两个原语

若不想要 webhook 的运行时间接层，可直接：

```js
const workspace = await ctx.workspaceRegistry.create('<已授权的绝对目录>');
const handle = await ctx.agents.create({
  sessionId: <SessionId>,
  meta: { cwd: workspace.path, agentPreset: <presetId> },
  agentOptions: { provider, model },
  setup: async (agentCtx) => { await ctx.agentPresets.mount(agentCtx, <presetId>); }
});
await workspace.attachSession(handle.agent.id);
ctx.permissionPresets.set(handle.agent.session, <presetId>);
ctx.sessionTitle.rename(handle.agent.session, <标题>);
handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: <提示词> }], source: { kind: 'user' } }));
```

**代价**：§6.2 第 1–10 步的校验与回滚全部要自己实现。**建议优先用法 A** —— 它把回滚、preset 前置校验、消息来源标记都做完了。

### 6.4 端点命名落点（Route B 若需要读侧）

| 需求 | 0.2.0 端点 | 备注 |
|---|---|---|
| 列出工作区 | `workspace/follow`（stream），取首个 baseline item 的 `items[]` | **不是 `workspace.list`** |
| 列出会话 | `session/list` | 一元 |
| 列会话某目录内容 | `workspaceFiles/list`（需 sessionId） | 锚定会话工作区根 |
| 浏览文件系统目录 | `directoryPicker/list` | 受 `browse` 能力门控；本装配可用 |
| 列模型 | `session/modelCatalog` | 替代 0.1.1 `session.models` |
| 读会话历史 | `session/page`（+ `session/follow` 流） | 替代 0.1.1 `session.history` |
| Office→PDF | `officeToPdf/render` / `officeToPdf/generation` | 已挂载；进程内亦有 `ctx.officeToPdf.convert()` |

### 6.5 与 Route A 的对比结论

| | Route A（零插件，直连 `/api`） | Route B（host 侧插件） |
|---|---|---|
| 0.1.1 | ✅ 可用（`PRIVILEGED_METHODS` 只锁 14 个方法到 loopback） | ❌ 当时被否决 |
| 0.2.0 | ❌ **结构性失效**：`/api` 全量 cookie 门（`README:39` 明示无 loopback 旁路），未认领端点 404，`workspace.list` 已删（改 `workspace/follow` 流），端点语法改 `ns/method` | ✅ **可行且官方已有打包形态**（`dsh-webhook` + 适配器范式） |
| 需要的官方新增 | — | **无** |

---

## 7. 安全面评估

### 7.1 若按 Route B 实现，新增的信任边界**具体**是什么

**一句话**：新增边界 = **「谁能投递到那个插件自有的入口（HTTP 路由 / stdio / 本地 socket），以及该入口自己实现的鉴权」** —— 不是 `/api` 的 cookie 门，也不是 DSH 用户身份。

分进程/用户枚举：

| 触发方 | 能否触发「文件→会话」 | 依据 |
|---|---|---|
| **本机同 UID 的任意进程** | **能** —— 一旦该插件被 profile 挂载，同 UID 进程只要能连上监听端口（loopback）或写 stdio，就能投递。注意：**不需要任何 DSH 凭据** | 插件面绕开 `admit`（§5.4）；`dsh-acp`/`dsh-headless` 即无鉴权先例 |
| **本机其他 UID** | 默认**不能**（loopback 绑定 + 文件权限），除非配置 `host: 0.0.0.0` | `host` 仅接受 `127.0.0.1`/`0.0.0.0`（`$T020/dsh-host-webserver/lib/index.js:142`）；默认 `127.0.0.1`（`$T020/dsh-web-app/cordis.patch.yml:173`） |
| **LAN / 网络** | 默认**不能**；一旦 `0.0.0.0` 则**能，且无任何默认保护** | README 原文：「Binding a non-loopback address still exposes **unprotected routes** and static assets to that network」（`$T020/dsh-host-webserver/README.md:113`） |
| **浏览器（含跨站页面）** | 若入口在 `/api` 之外且未自建 `Origin`/`SameSite` 防御：**同机浏览器页面可能触发**（DNS rebinding / 简单请求）。官方适配器用**签名**而非 cookie 来防 | 非 `/api` 路由**不走** `isTrustedApiRequest`（该函数只在 connection 内被调用，`$T020/dsh-client-connection/lib/index.js:587`）；`dsh-webhook-github` 的防御是 HMAC（`lib/index.js:118-127`） |
| **模型/agent 自身** | **能**（若插件把入口暴露给工具调用）——本设计不建议 | — |

### 7.2 能否限定本地回环、能否要求显式确认

| 需求 | 能否 | 怎么做 / 依据 |
|---|---|---|
| **限定本地回环** | ✅ 能，且是默认 | `host: 127.0.0.1`（默认值，`dsh-web-app/cordis.patch.yml:173`）。更强的做法用官方范式：**另起一个隔离 `webServer` 实例 + 独立端口**，只在该 group 内 isolate `webServer`（`$T020/dsh-webhook-github/README.md`「Dedicated listener composition」段）；或干脆**不开 HTTP**，走 stdio（照 `dsh-acp`）—— 此时边界纯粹是「父子进程」。 |
| **要求显式确认** | ⚠️ **无官方"创建前弹窗审批"面** —— **[未核]** 我未找到任何「会话创建需人工 approve」的开放面。可行的替代是**部署自己在适配器/规则里做确认**（如：适配器只**落盘一条待办**，由 GUI 侧插件渲染确认后**才**调 `ctx.webhookRuntime.dispatch()` 或建会话）。`ctx.userQuestions.registerProvider`（0.1.1 `$T011/dsh-host-apiproxy/lib/types/api-proxy.js:1108` 有该调用）在 0.2.0 的存在性与可用性**本次未核**，标 **[未核]**。 |
| **限定可访问目录白名单** | ✅ 能，且**必须**自己在规则里做 | `WebhookSessionRequest.workspacePath` 是自由字符串；`ctx.workspaceRegistry.create()` 不做白名单（§3.5）。官方把授权判断留给规则代码（README 原文：「A callback may execute arbitrary trusted code」，`$T020/dsh-webhook/README.md`） |
| **限定扩展名/大小** | ✅ 能 | 官方适配器范式：限长 `maxBodyBytes` + 先验签名后解析（`$T020/dsh-webhook-github/lib/index.js:118-127`） |
| **审计** | ✅ 部分 | webhook 消息来源带 `provider`/`source`/`deliveryId`/`ruleId`/`summary`（`$T020/dsh-webhook/lib/types/types.d.ts` 的 `MessageSourceMap.webhook`），会话内可追溯来源。适配器承诺「never logs the secret, signature, or payload」（其 README HTTP 契约段） |

### 7.3 与现役 Route A 相比，信任面是**变小**还是**变大**

**净变小**，但**性质改变**，且有三处必须补偿的缺口。

**变小的部分（有源码依据）**：

1. **Route A 在 0.2.0 已不可用**，本身不再构成可选项，所以不存在「Route A 的宽松面被 Route B 继承」。0.1.1 的 `PRIVILEGED_METHODS` 只把 14 个方法钉到 loopback，其余 ~38 个方法（含 `session.create`、`workspace.create`、`workspace.list`、`session.prompt`）对**任何通过 Host/Origin 栅栏的调用者**开放（`$T011/dsh-client-connection/lib/index.js:550-566,584,600-604`）。0.2.0 的 cookie 门把这个面从「~38 个方法任意人可用」收成「凭 cookie 的浏览器会话」。
2. **Route B 的入口是自己写的、窄的**：一个精确路径 + 自选鉴权，而不是整个 `/api` 的 138 个端点。
3. **不暴露 `session.create` 的任意 `cwd`**：若走 §6.2 用法 A，`workspacePath` 由**规则代码**决定（可取白名单），而不是由调用者任意指定；且 `workspaceRegistry.create()` **不 mkdir**，进一步限制「凭空造目录」。
4. **默认 loopback**，且官方给出「独立监听 + TLS 反代」的显式暴露范式。

**变大 / 新增的部分（必须正视）**：

1. **新增一个无 cookie 保护的入口**。它绕过 `admit`（§5.4），因此**不受 0.2.0 新增的 cookie 门保护** —— 门只保护 `/api`。这是「新增边界」的实质。
2. **同 UID 本机进程的权限上升**：Route A 时代，本机进程要投递必须过 Host/Origin 栅栏（且 0.1.1 下连这个都够；0.2.0 下还要 cookie）。Route B 后，本机同 UID 进程只需满足**你自己实现的鉴权**（若实现为「无鉴权」则= 无门槛）。**若把 stdio/本地无鉴权路由当成"反正是本机的"，就等于放弃了 0.2.0 刚加上的那层门。**
3. **`0.0.0.0` 是"一配置就裸奔"**：README 明说服务器自身不带任何 auth/origin。若为了「让 OS 侧的接收器从别处连进来」而把 webServer 开成 `0.0.0.0`，则**不仅新入口、连静态资产与其它未保护路由一起对外暴露**。**必须避免**。
4. **`session/create` 的 `mkdir` 副作用**：若走 Remote/`cwd` 路径而非 webhook 的 `workspaceRegistry.create`，`createOrAdopt` 会对不存在的 `cwd` 执行 `mkdir(cwd, {recursive:true})`（`$T020/dsh-api-session-controller/lib/index.js:445`）⇒ 任意路径可被创建。**走用法 A 可回避。**

**结论**：相对**现役 Route A（0.1.1 上那种「无鉴权 POST `/api`」）**，Route B 的信任面**明显变小** —— 从「整个 `/api` 的一元方法面对任意通过 Host/Origin 栅栏者开放」收窄为「一个自建入口 + 自建鉴权 + 自己白名单」。但**相对 0.2.0 自己刚建立的 `/api` cookie 门**，Route B 是**在那道门之外另开一扇门**；这扇门的安全性**完全由我们自己的实现决定**，官方只提供范式（签名 + 限长 + 精确路径 + 可选独立监听）与创建原语。

**最小安全实现清单（建议）**：
1. **不要**把 Route B 入口挂在 `/api` 之外的**同一个 webServer 的对外绑定**上；若必须 HTTP，照官方范式**另起隔离 webServer + `127.0.0.1:<独立端口>` + 前面挂 TLS 反代**（或直接只监听 loopback）。
2. 入口**必须有独立鉴权**：共享密钥 + HMAC/签名（照 `dsh-webhook-github`），密钥走 `ctx.credentials` 引用（`secretEnv`，`$T020/dsh-webhook-github/lib/index.js:169`）并可轮换（README：每次请求解析，轮换即时生效）。
3. 入口**限长**（`maxBodyBytes`）且**先验签名后解析 JSON**。
4. 规则里做**三重白名单**：目标目录、文件扩展名、投递来源。
5. **优先 stdio 而非 HTTP**（照 `dsh-acp`）：边界退化为「父子进程 + 文件权限」，无需自建网络鉴权，也不会误开 `0.0.0.0`。
6. 保留 `deliveryId`/`ruleId` 进消息来源，便于会话内追溯。

---

## 8. 未验证项（[未核]）

以下为**本次未亲自核到出处或未实跑**的内容，不应被当作结论使用：

1. **[未核-实跑]** 上述所有 API 均**只做静态源码核验，未实跑**。本次约束禁止启动监听端口服务、禁止发请求、零模型请求，故无运行时验证。特别是：`dsh-webhook` 挂进本部署后 `inject` 的六个服务是否全部解析成功、`agentPresets.mount` 与用户自建 preset（`standard-glm`）是否兼容，**均未实跑**。
2. **[未核]** 「会话创建需人工确认/审批」是否有官方开放面。我**未**在 0.2.0 中找到此类 API；但我也**未**系统排查 `ctx.userQuestions`、`dsh-user-approval`、`dsh-permission-presets` 是否可以挂到「创建会话」这一步上。属**未穷尽**，不等于不存在。
3. **[未核]** `dsh-webhook` / `dsh-webhook-github` 是否在某处（如 `dsh-sdk-minimal`、experimental bundle、或 CLI 侧的 profile 生成逻辑）被挂载。我的 grep 范围是 `$T020/*/cordis.patch.yml` 与 `$T020/*/package.json`，未覆盖 CLI 源码（`prefix-cli` 之外的 `apps/cli`）与 `$A20/home/profiles/**` 的全部层级。**装配文件 `$A20/home/profiles/web/cordis.patch.yml` 中未见这两行**（已通读全文）。
4. **[未核]** 0.1.1 的下载类路由（`api/downloads.js`、`downloads.schema.js`）对应的具体 HTTP 路径未逐一枚举；本档只列了我在 `fetch/handler.js` 亲自读到的 4 条非一元路由（`events.mux` / `events.host` / `session.export` / `respond`）。
5. **[未核]** `session/page` 与 0.1.1 `session/history` 的**响应字段级**差异未逐字段比对；本档只核到语义等价（「cold-safe, message-aligned Session history page」 vs 0.1.1 的 `{events, hasMore, projections?}`）。
6. **[未核]** 0.2.0 中 `agentPreset` 的 `copy` / `openDocument` / `remove` 是否有替代端点。我在 138 端点表里未见对应者，但未追查其是否被迁到 `settings/*` 或 CLI。
7. **[未核-实跑]** §3.4 关于「本装配下 `directoryPicker/pick` 不可用（browse backend）」的推断，依据是 `$A20/home/profiles/web/cordis.patch.yml:72-76` + `requireCapability` 源码，**未实跑**。另注意 `dsh-workspace-enhancement` bundle 也注册了 `directory-picker-ssh`（并在 profile 中被 `disabled: true`，见 `$A20/home/profiles/web/cordis.patch.yml:79-80`），其 `capability().kind` 实际取值**未实跑确认**。
8. **[未核]** `docs/architecture/office-handoff.md` §1（旧 Route B 否决理由）与 `workbuddy-reverse-proxy/reports/office-upgrade-*.md`、`20-02-dsh-office-plugin-audit.md` **本次未读**（按约束要求，历史证据不当结论）。本档全部结论独立来自源码树。
9. **[未核]** `@local/dsh-pptmaster`、`@local/dsh-usage`、`dsh-workspace-enhancement` 等本部署自有插件是否已实现部分 Route B 能力（未读其源码）。
10. **[未核]** 0.2.0 是否支持在同一进程内挂载第二个 `webServer`（`dsh-webhook-github` README 描述了该组合，但我**未核** `dsh-host-webserver` 是否允许多实例、以及 isolate 语义的确切写法）。

---

## 附：本档使用的一次性命令（可复现）

```bash
T020=/home/CNS2026495165/dsh/.workspace/audit-020/assembly-020/prefix-cli/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai
T011=/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai

# 0.1.1 一元方法全集
cat $T011/dsh-host-apiproxy/lib/types/api/rpc-map.d.ts
grep -rn '"workspace.list"' $T011/dsh-host-apiproxy/lib/index.js

# 0.2.0 端点全集（正则抽取生成产物）
grep -o "id: '[^#]*#\([^']*\)'" $T020/*/lib/typert.host.js | sort -u

# 0.2.0 无 workspace/list 的四重证据
grep -n 'Remote("' $T020/dsh-api-workspace-controller/lib/index.js
grep -rn "workspace/list\|workspace\.list" $T020/*/lib/index.js          # → 0 命中
grep -o 'workspace/[a-zA-Z]*' $T020/dsh-api-workspace-controller/lib/typert.host.js | sort -u

# 0.1.1 无 cookie 机制
grep -c "cookie\|Cookie\|admit\|isAuthenticated" $T011/dsh-client-connection/lib/index.js   # → 0

# webhook 未被任何 bundle 挂载
grep -rln "dsh-webhook" $T020/*/cordis.patch.yml $T020/*/package.json
```

---

*本档为只读勘察产物。未修改任何既有文件；未启动服务；未向端口发请求；未触碰 `~/.dsh/**` 与 `~/.dsh-017/**`；未使用 `sandbox_permissions`。*
