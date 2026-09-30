# WP5 报告 · 办公入口 Route B（外部事件 → 0.2.0 工作区会话）

* **工单号**：WP5（办公入口 Route B 的可实施设计与实现草案）
* **状态**：**完成**（A/B/C/D 四项均产出；自建件为**可编译草案**，**未装配**）
* **写入边界**：只写 `/home/CNS2026495165/dsh/.workspace/audit-020/p0c/**`（本文与同目录产物）。
  未改 `$A/**` 的任何既有文件、未改 `~/.dsh/**`、未改 `~/.dsh-017/**`、未改
  `~/.local/lib/dsh-office-handoff/**`。**未起任何服务、未重启 3098/3080/3097、未发网络请求。**
* **证据路径**：
  * `p0c/harness/selftest.mjs`（34 断言，`[实跑]`）
  * `p0c/deliverer-patch/selftest.mjs`（18 断言，`[实跑]`）
  * `p0c/harness/dump-config.out` / `.err`（`--dump-config` 组合校验，`[实跑]`）
  * `p0c/probe-home/`（只读组合校验用的**副本** HOME）、`p0c/resolve-check/`（裸名解析验证）
  * 源码锚点全部在 `$B = $A/prefix-cli-rc2/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai`（**rc.2**，与上一轮勘查的 rc.1 **不是同一棵树**）
* **结论强度标注**：`[实跑]` = 本次亲自执行并读到输出；`[源码]` = 亲自打开文件读到并给出文件:行号；`[未验证]` = 未实跑/未读到出处。

> **与上一轮勘查的关系**：`reports/OFFICE-ROUTE-B-CAPABILITY-PROBE.md` 做在 **rc.1**（`$A/prefix-cli/`）。
> 本报告**独立在 rc.2 上复现了关键几条**（§A 每条都带 rc.2 行号），并把
> 「装配方案 / 自建面 / Runbook」补齐到可执行。rc.1→rc.2 的**结论无变化**（§A.5 列了差异点）。

---

## 0. 一句话结论

**官方件够用，但不够到"零代码"。**

* `@deepseek-ai/dsh-webhook`（rc.2，官方件）提供 `ctx.webhookRuntime`：`register(rule)` /
  `dispatch(delivery)` + **唯一内置动作**「在 Web Workspace 里建一个普通 root Session」，
  自带**完整回滚**。`[源码 $B/dsh-webhook/lib/index.js:148-219, 261-350]`
* 但它**没有 `Config`**、**没有 YAML 配置规则的入口** —— 官方 README 原文：
  *"User-authored rule plugins inject `webhookRuntime` and yield the disposer returned by `register()` through their own effect."* `[源码 README:46]`
  ⇒ **"只改投递器、不加宿主插件"在结构上不可能**。自建面**必然**包含一个宿主薄插件。
* 所以本工单的取舍结论是：**新增一个宿主薄插件 `@local/dsh-office-route-b`**（≈470 行，含纯逻辑层），
  而不是改造现有投递器去适配官方 `dsh-webhook-github`（§C.2 给了两种方案的逐项成本对比）。
* **投递器仍然必须改**（它现在是 Route A：`POST /api/workspace.list` + `workspace.create`，
  **不带任何凭据**，在 0.2.0 上结构性失效）—— 补丁文本已产出，**未落地**（越界）。

---

## A. 官方件能力复核（源码级，带 rc.2 行号）

### A.1 `dsh-webhook` 的 Config schema + 内置动作的入参形状

**`dsh-webhook` 没有 Config。** `[源码]`
* `grep -n "Config\|Schema" $B/dsh-webhook/lib/` 只命中 `lib/types/types.d.ts:13` 的一句**注释**
  （"Configured adapter instance such as `primary-github`"），**没有任何 `Config` 定义/导出**。
* `lib/index.js:352` 的导出面：`{ WebhookDeliveryId, WebhookRuleId, WebhookRuntime, WebhookRuntime as default, WebhookSourceId }` —— 无 `Config`。
* `[实跑]` 加载验证：`node --input-type=module -e "import('…/dsh-webhook/lib/index.js')"` ⇒
  `exports = WebhookDeliveryId,WebhookRuleId,WebhookRuntime,WebhookSourceId,default`。

它的"配置"面**只有服务级 inject 与两个方法**：

| 项 | 值 | 出处 |
|---|---|---|
| 类 | `WebhookRuntime extends Service` | `lib/index.js:261` |
| 服务键 | `webhookRuntime` | `:274` `super(ctx, "webhookRuntime")` |
| `static inject` | `["agents","agentDefaultModel","agentPresets","permissionPresets","sessionTitle","workspaceRegistry"]`（6 个） | `:262-269` |
| `register(rule)` | 校验：`id` 非空串（`:289`）、`kind` 非空串（`:290`）、`run` 是函数（`:291`）、**id 全局唯一**（`:297` 抛 `webhook rule "…" is already registered`）；注册进 `ctx.effect`（`:294-306`）；返回**可 await 的 disposer**（`:307-309`） | `:287-310` |
| `dispatch(delivery)` | `snapshotDelivery`（`:318`）→ 对**每个** `rule.kind === delivery.kind` 的规则 `startInvocation`（`:319-322`）；**同步返回**，不等 callback 结算 | `:316-323` |
| `startInvocation` | `:328` `const request = await registration.rule.run(delivery, signal)`；`:330` `if (request !== null) await createWebhookSession(...)`；失败只 warn（`:331-334`） | `:325-339` |
| `WebhookRule` 契约 | `id: string`（非空）、`kind: string`（非空）、`run(delivery, signal) => null \| WebhookSessionRequest`（可返回 Promise，因为会被 await） | `:289-291` + `:328` |
| delivery 形状 | `{ kind, source, deliveryId, receivedAt:number }` 全部必填；整体必须 **lossless JSON**，随后 `deepFreeze` | `:251-259` |

**内置动作（唯一）的入参形状** —— `resolveRequest`，`[源码 lib/index.js:74-120]`：

```
WebhookSessionRequest = {
  workspacePath: string   // 必填、非空、**必须 isAbsolute**（:78-79）
  title:         string   // 必填、非空（:80）
  prompt:        string   // 必填、非空（:81）
  agentPreset:   string   // 必填、非空（:82）
  permissionPreset: string// 必填、非空（:83）
  model?: {               // 可选；给了就必须 provider+model 非空，maxTokens 为正安全整数
    provider: string, model: string, maxTokens?: number
  }                       // (:84-110)
}
```
* `model` **省略**时：`ctx.agentDefaultModel.currentSelection()` 的 provider/model 被快照成
  本次创建的初始模型选择（`:88-94` + `installInitialModelSelection` `:126-135`）。
* 返回类型定义在 `lib/types/types.d.ts`（`WebhookSessionRequest`）。

**内置动作的执行序列**（`createWebhookSession`，`:148-219`）：

| # | 动作 | 行 |
|---|---|---|
| 1 | `resolveRequest`（上面的形状校验） | `:155` |
| 2 | `ctx.permissionPresets.resolve(permissionPreset)`（**先校验权限 preset 存在**） | `:156` |
| 3 | `await ctx.agentPresets.resolve(agentPreset)` | `:157` |
| 4 | `await ctx.agentPresets.acquireScope(preset.id)`（作用域所有权，随 disposer 释放） | `:158` |
| 5 | `const workspace = await ctx.workspaceRegistry.create(resolved.workspacePath)`（**解析或创建，不 mkdir**） | `:160` |
| 6 | `sessionId = brandString(\`webhook-${randomUUID()}\`)` ← **断言脚本靠这个前缀识别** | `:162` |
| 7 | `ctx.agents.create({ sessionId, signal, meta:{cwd: workspace.path, agentPreset}, agentOptions, setup })`；`setup` 里 `agentPresets.mount(...)` + 初始模型选择 | `:163-175` |
| 8 | `await workspace.attachSession(sessionId)`（`attached = true`） | `:179-180` |
| 9 | `ctx.permissionPresets.set(handle.agent.session, permissionPreset)` | `:182` |
| 10 | `ctx.sessionTitle.rename(handle.agent.session, title)` | `:183` |
| 11 | `handle.agent.followup(createUserMessage({ content:[{type:"text",text:prompt}], source:{ kind:"webhook", provider, source, deliveryId, ruleId, form:"notice", summary } }))` | `:184-198` |
| 12 | 失败回滚：`workspace.detachSession()` → `handle.dispose()`，两者各自失败只 report 不掩盖原错 | `:199-211` |

⇒ `[源码]` "自建面只剩投递侧触发 + 鉴权 + 白名单"这句话**成立**：会话创建/挂预设/attach/设权限/设标题/投 prompt/回滚**全部是官方实现的**。

### A.2 它注册在什么服务上？路由前缀？是否走 `admit()` cookie 门？

| 问题 | 答案 | 出处 |
|---|---|---|
| `dsh-webhook` 注册在什么服务上 | **不在 `webServer` 上**。它是纯 `Service`（服务键 `webhookRuntime`），**不注册任何 HTTP 路由** | `[源码 lib/index.js:261,274]` |
| `dsh-webhook-github` 注册在什么服务上 | **`ctx.webServer`**，`inject = ["webServer","webhookRuntime","credentials"]` | `[源码 lib/index.js:160-166]` |
| 路由形状 | `{ kind: "exact", path: config.path, handler }`（**精确匹配**，不是前缀） | `[源码 lib/index.js:181-189]` |
| 注册方式 | `ctx.effect(() => ctx.webServer.register(route), \`webhook-github: ${config.path}\`)` | `[源码 lib/index.js:190]` |
| 路由前缀 | `config.path` 由部署给；`assertConfig` 要求**绝对、非根、无尾斜杠、无 `?`/`#`** | `[源码 lib/index.js:174-177]` |
| **是否走 `admit()` cookie 门** | **不走**。`admit()` 在 rc.2 全文件只有**两个调用点**，都在 `/api` 相关路径内：`:647`（`connection.rpc.handle` 通道）与 `:834`（`/api` 前缀 handler）。`ctx.webServer.register()` 的非 `/api` 精确路由**完全不经过它** | `[源码 $B/dsh-client-connection/lib/index.js:14(API_PATH="/api"), 586-594(requestRejection/admit), 647, 829-840]` |
| webServer 的匹配顺序 | 先查 `exact` 表（`:324-325`），未命中再按**最长前缀**匹配 `prefixes`（`:327-331`），再落到 fallback | `[源码 $B/dsh-host-webserver/lib/index.js:322-331]` |
| `register(route)` 契约 | 重复 `(kind, path)` 抛 `webserver: duplicate <kind> route` | `[源码 $B/dsh-host-webserver/lib/index.js:177-184]` |
| 服务键 / 绑定 | `super(ctx, "webServer")`；`host` 枚举**只有** `127.0.0.1` / `0.0.0.0`；`listen(port, host)` | `[源码 …/dsh-host-webserver/lib/index.js:158, 142, 297]` |
| 本部署的实际挂载 | web bundle 挂 `webserver`，`host: !!js ctx.webStartup.host ?? '127.0.0.1'` ⇒ **默认 loopback** | `[源码 $B/dsh-web-app/cordis.patch.yml:169-173]` |

**⚠️ 关键安全事实**：`dsh-host-webserver` 的 README 明说自注册路由**不带任何** TLS / 认证 /
Origin 策略，且 `0.0.0.0` 会把**未保护路由与静态资产**一起暴露
`[源码 $B/dsh-host-webserver/README.md:39,113]` ⇒ **本设计一律 loopback，禁止改 `host`**。

### A.3 `dsh-webhook-github` 的「非 `/api` 精确路由」范式（逐步，带行号）

```
请求进入 dsh-host-webserver 的 exact 表 ──► createGitHubWebhookHandler(ctx, config)
```
`[源码 $B/dsh-webhook-github/lib/index.js:109-155]`，顺序**钉死**如下：

| 步 | 动作 | 失败状态码 | 行 |
|---|---|---|---|
| 1 | `request.method !== "POST"` → `setHeader("allow","POST")` + 405 | **405** | `:112-115` |
| 2 | `isJsonContentType(request.headers["content-type"])`（只容忍一个 `charset=utf-8` 参数） | **415** | `:116`（实现 `:73-79`） |
| 3 | `await readBoundedUtf8Body(request, maxBodyBytes)`：先看 `content-length`（歧义 ⇒ 400、超限 ⇒ 413），再**流式累计**（超限 ⇒ `request.resume()` + 413）；未 `complete` ⇒ 400；非 fatal UTF-8 ⇒ 400 | **413 / 400** | `:117`（实现 `:33-61`；长度解析 `:18-25`） |
| 4 | `requiredHeader(request, "x-hub-signature-256" / "x-github-delivery" / "x-github-event")`：用 `headersDistinct`，**必须恰好一个**值 | **400** | `:118-120`（实现 `:66-71`） |
| 5 | `await ctx.credentials.resolve(config.secretEnv)`；`undefined` 或 `value === ""` ⇒ 503 | **503** | `:121-122` |
| 6 | **HMAC 验签**：`new Webhooks({ secret }).verify(body, signature)`，抛错被吞、`verified !== true` ⇒ 401 | **401** | `:123-127` |
| 7 | **验签通过后才解析 JSON**：`JSON.parse` + 顶层必须是对象 + `snapshotJsonValue` 无损 ⇒ 否则 400 | **400** | `:128`（实现 `:91-102`） |
| 8 | 构造 provider-neutral delivery `{kind:"github", source, deliveryId, event:{name,payload}, receivedAt}` | — | `:129-138` |
| 9 | `ctx.webhookRuntime.dispatch(delivery)`；抛错 ⇒ 503 | **503** | `:139-144` |
| 10 | `respond(response, 202)`（**空体**），**不等**规则结算、不等会话建成 | **202** | `:145` |
| 兜底 | 非 `WebhookHttpError` 的意外 ⇒ warn + 503 固定文案 | **503** | `:146-153` |

**Config schema 全文** `[源码 lib/index.js:167-172]`：

```js
const Config = z.object({
  source:       z.string().required(),
  path:         z.string().required(),
  secretEnv:    z.string().role("credential-ref").required(),
  maxBodyBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required()
});
```
* **四个字段全部 required、无默认值**。
* `assertConfig`（`:174-177`）额外要求：`source.trim() === source && source !== ""`；
  `path` 绝对、非 `/`、无尾斜杠、无 `?`、无 `#`。
* `secretEnv` 经 `credentialRef()` 品牌化后交给 `ctx.credentials.resolve()`（**每次请求解析**，
  所以轮换即时生效，官方 README:35 同述）。
* `[实跑]` 导入验证：`Config` 的键 = `source,path,secretEnv,maxBodyBytes`，`name = "webhook-github"`，
  `inject = ["webServer","webhookRuntime","credentials"]`。
* **日志纪律**：`ctx.logger.warn` 只有三处固定文本（`:142`、`:151` 与 401/415 等错误仅回给客户端），
  官方 README:40 承诺 *"never logs the secret, signature, or payload"*。`[源码]`

### A.4 两个包的装配依赖（peerDependencies 与实际树是否满足）

`[源码 package.json]` + `[实跑]` 逐个 `require('…/package.json').version`：

| 包 | `peerDependencies` | `dependencies` | 树里实际 |
|---|---|---|---|
| `dsh-webhook` (0.2.0-rc.2) | `cordis ~4.0.4`、`dsh-agent`、`dsh-agent-default-model`、`dsh-agent-preset-registry`、`dsh-llm`、`dsh-invariants`、`dsh-permission-presets`、`dsh-workspace`、`dsh-session-title`、`dsh-session`（全部 `0.2.0-rc.2`） | `dsh-brand`、`dsh-util-values` | **全部齐备**：10 个 peer 全在 `$B/` 下且版本 `0.2.0-rc.2`；2 个 dependency 同在 `$B/` |
| `dsh-webhook-github` (0.2.0-rc.2) | `dsh-credentials`、`dsh-host-webserver`、`cordis ~4.0.4`、`dsh-webhook`、`dsh-session` | `@octokit/webhooks ^14.2.0`、`dsh-util-values`、`schemastery ~3.18.4` | **全部齐备**：5 个 peer 全在；`@octokit/webhooks` **14.2.0** 在 `…/@deepseek-ai/dsh/node_modules/@octokit/webhooks`；`schemastery` 3.18.4 |

* **profile 侧解析面已就位** `[实跑]`：`$A/home/profiles/node_modules/@deepseek-ai/` 下有 **291 条**软链，
  其中 **`dsh-webhook` 与 `dsh-webhook-github` 的软链已经存在**，都指向 rc.2 树。
  ⇒ 装配时 `name: '@deepseek-ai/dsh-webhook'` **可直接解析，无需再装任何东西**。
* `[实跑]` 用 `node --input-type=module` 真加载两个包（同时验证其传递依赖可解析）⇒ 均成功，无 `ERR_MODULE_NOT_FOUND`。
* `[实跑]` **没有任何 bundle 挂载它们**：`grep -rln "dsh-webhook" $B/*/cordis.patch.yml` → **0 命中**
  （上一轮 rc.1 的同一条结论在 rc.2 复现）。⇒ 属"profile 显式加一行即启用"的既有开放面。

### A.5 rc.1 → rc.2 的差异（本报告独立复现后确认无结论性变化）

| 项 | rc.1（上一轮勘查） | rc.2（本次独立复现） |
|---|---|---|
| `dsh-webhook` 版本与导出面 | 有 | 相同（`WebhookRuntime`，**无 Config**） |
| `createWebhookSession` 行号 | `148-219` | **相同** `148-219` |
| `WebhookRuntime` 类/服务键/inject | — | `:261` / `:274` / `:262-269`（6 个依赖） |
| `dsh-webhook-github` Config 四字段 | — | `:167-172`，**全 required** |
| `dsh-webhook-github` handler 顺序与状态码 | 202 不等待、HMAC 先于 JSON | 完整复现，见 §A.3 |
| 是否被任何 bundle 挂载 | 否 | **否**（rc.2 同样 0 命中） |
| `admit()` 调用点 | `:647,:834`（rc.1 报告写 `$T020`） | rc.2 **同为 `:647` / `:834`**，`API_PATH` 在 `:14` |

---

## B. 装配方案（给协调者照抄的补丁文本）

**补丁文本**：`p0c/cordis.patch.insert.yml`（追加到 `$A/home/profiles/web/cordis.patch.yml` **末尾**）。
**`[实跑]` 语法/组合校验**：把该片段接到真实 patch 尾部、放到 `p0c/probe-home/`（**副本 HOME**），
跑 `DSH_HOME=p0c/probe-home node <rc2>/lib/bin.js --profile web --dump-config`
⇒ **exit 0**，组合产物里出现 `- id: webhook-runtime` / `- id: office-route-b`（行 1727-1730），stderr 为空。
**真实 profile patch 未被触碰**（`mtime`/`size` 前后一致）。

### B.1 完整 config（片段原文）

```yaml
- insert:
    - id: webhook-runtime
      name: '@deepseek-ai/dsh-webhook'

- insert:
    - id: office-route-b
      name: '@local/dsh-office-route-b'
      config:
        source: office-handoff
        path: /office-handoff
        tokenRef: DSH_OFFICE_ROUTE_B_TOKEN
        maxBodyBytes: 262144
        workspaceRoots:
          - !!js (process.env.DSH_OFFICE_HANDOFF_WORKSPACE ?? ((process.env.HOME ?? '/tmp') + '/DSH-办公投递'))
        extensions: ['.docx','.doc','.xlsx','.xls','.pptx','.ppt','.pdf','.odt','.ods','.odp','.csv','.md','.txt','.rtf']
        maxFileBytes: 67108864
        maxFiles: 32
        agentPreset: standard-glm
        permissionPreset: workspace-write
        titlePrefix: 办公投递
```
（片段文件里 `extensions` 写成逐项列表并带注释，等价。）

**每个取值的依据**：

| 键 | 值 | 依据 |
|---|---|---|
| `path` | `/office-handoff` | 非 `/api` 的绝对精确路径（对齐官方 `assertConfig` 的形状约束 `[源码 dsh-webhook-github:176]`） |
| `tokenRef` | `DSH_OFFICE_ROUTE_B_TOKEN` | 必须是 POSIX 标识符（`credentialRef` 的 `REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/`，`[源码 $B/dsh-credentials/lib/index.js:12,21-27]`） |
| `workspaceRoots` | **复用投递器已有的环境变量名** `DSH_OFFICE_HANDOFF_WORKSPACE` | 该名字就是投递器的 `WORKSPACE_ENV`（`[源码 ~/.local/lib/dsh-office-handoff/lib/cli.js:52]`）⇒ **一个变量钉住两侧**，消除 `HOME` 推断歧义 |
| `extensions` | 14 项 | 与投递器 `lib/paths.js:24-28` 的 `DEFAULT_EXTENSIONS` **逐项一致** `[源码]`（两侧必须同集，否则一侧放行一侧拒绝） |
| `agentPreset` | `standard-glm` | 本 profile patch 已把 `agent-preset-registry` 的 `default` 设为 `standard-glm`（`$A/home/profiles/web/cordis.patch.yml:24-26`），且 `$A/home/.agent-presets/standard-glm/` 在位 `[实跑 ls]` |
| `permissionPreset` | `workspace-write` | `dsh-base` 的 preset 表里确有 `read-only` / `workspace-write` / `danger-full-access`（`[源码 $B/dsh-base/cordis.patch.yml:250-260]`） |
| `maxBodyBytes` | 262144 | 信封只含"目录 + 文件名列表 + 附注"，256 KiB 足够；官方同形默认无，需显式给 |
| `path` 不 volatile | — | 改它要重注册路由，属组合级事实；其余全部 volatile（§B.4） |

### B.2 secret 的存放方式 + 凭据引用的确切写法

**结论**：走 **0.2.0 的 credentials 服务**，配置里**只写引用名**；值优先落
`$DSH_HOME/.credentials.yaml` 的 `refs:` 段，**也**支持启动环境变量（分层更高）。

* 引用写法（**唯一正确写法**）：`tokenRef: DSH_OFFICE_ROUTE_B_TOKEN` —— 一个**裸 POSIX 标识符**，
  **不是** `${VAR}`、**不是**路径、**不是** `env:` 前缀。
  插件内部 `credentialRef(effective.tokenRef)` 品牌化后调 `await ctx.credentials.resolve(ref)`
  （每次请求解析一次 ⇒ 轮换即时生效，无需重启）。
  `[源码 $B/dsh-credentials/lib/index.js:21-27]`、`[源码 $B/dsh-credentials/lib/types/index.d.ts:129]`
* 服务实例：`credentials-local` 由 **base bundle** 挂载 `[源码 $B/dsh-base/cordis.patch.yml:117-118]`
  ⇒ web profile 天然具备。
* 存储位置：`$DSH_HOME/.credentials.yaml`（`[源码 $B/dsh-credentials-local/lib/index.js:13,18,49,58,390]`），
  形如
  ```yaml
  refs:
    DSH_OFFICE_ROUTE_B_TOKEN: <值>
  records:
    <owner>/<id>: { … }
  ```
  `[源码 $B/dsh-credentials-local/README.md:109]`（`refs` 按环境变量名存键值，
  `records` 按 `<owner>/<id>` 存；`:137` 同述；文件只允许 credentials，其余键一律拒绝）
* **解析分层顺序（第一个有值的胜出）** `[源码 README:71-80,12,201]`：
  1. **启动环境**（`DSH_OFFICE_ROUTE_B_TOKEN=… dsh`）—— 只读、不可被产品改写；
     ⚠️ **它是启动时的快照**（"The environment layer is the launcher's snapshot taken at launch"），
     **启动后再 export 无效**；
  2. `.credentials.yaml` 的 `refs:`（产品管理的存储，可写，落盘即生效）；
  3. 项目 `.env`；
  4. harness-home `.env`。
* **不选**：把令牌直接写成插件 config 字段（会进配置 UI/settings 文档，违背"值不进配置"的契约）；
  也不选启动环境变量作**唯一**来源（`boot-web.sh`/官方启动姿势用 `env -i`，变量容易丢，
  且刷新一次快照要重启）。

### B.3 **必须由用户在启动环境里提供（或落盘）的变量**

| 名字 | 用途 | 谁读 | 是否必须 |
|---|---|---|---|
| `DSH_OFFICE_ROUTE_B_TOKEN` | **令牌的凭据引用名**（同时是"引用名"与"环境层变量名"）。值 = 共享令牌（≥32 字节随机） | 宿主插件 `ctx.credentials.resolve`；投递器侧同一名字读环境 | **是**（或落盘到 `.credentials.yaml` 的 `refs:`） |
| `DSH_OFFICE_HANDOFF_WORKSPACE` | **两侧白名单根**（绝对路径）。宿主侧 patch 的 `!!js` 读它；投递侧 `--workspace` 的兜底读它 | patch 求值 + 投递器 | 推荐（不设则回落到 `$HOME/DSH-办公投递`） |
| `DSH_OFFICE_ROUTE_B_TOKEN_FILE` | 令牌文件路径（Nautilus 拿不到终端环境时的通道） | 投递器 | 可选 |
| `DSH_WEB_URL` | 目标 origin（0.2.0 实例，**不是 3080**） | 投递器 | 推荐 |
| `DSH_OFFICE_HANDOFF_ROUTE` | 路由覆盖 | 投递器 | 可选 |
| `DSH_OFFICE_HANDOFF_STATE` | 投递器状态根（journal/lock/spool/token 默认位置） | 投递器 | 可选 |
| `DSH_OFFICE_HANDOFF_FORBID_3080` | 设 `1` ⇒ 任何打向 3080 的请求 fail-closed | 投递器 | **推荐** |
| `DSH_TELEMETRY_MODE=DISABLED` | 关遥测（既有启动姿势） | 产品 | 验收期推荐 |

> **本报告不含任何真实密钥值。**

### B.4 条目 `id` 的选择与 settings 命名空间的关系

**0.2.0 的 settings 命名空间 = profile 条目 id（YAML 的 `id:`）** —— `[源码]`：

* `dsh-settings/lib/index.js:411` 文档原句：*"@returns Forms keyed by unique profile entry ids."*
* `:418-420`：`volatileForm(schema)` 为 `undefined` ⇒ **整条 `return []` 跳过**；否则 `active.add(entry.id)`。
* `:432` / `:443`：`ns: entry.options.id` ← **命名空间直接取条目 id**。
* `:502`：`write(ns, …)` 用 `entries().find((row) => row.options.id === ns)` 反查条目。
* `:505-506`：`volatileForm === undefined` ⇒ 直接抛 `Plugin entry "<ns>" has no volatile fields`。
* README `:12` / `:33`：*"Forms identify each plugin by its profile entry id"* /
  *"Forms expose only volatile fields from active, uniquely addressed profile entries."*

⇒ **命名空间 = profile 条目 id（`id: office-route-b`）**，而**不是**插件自定义的字符串。
⇒ 本插件除 `path` 外**所有**字段都标 `.volatile()`（扁平 schema，volatile 节点下不放 volatile 叶子，
参照 `@local/dsh-wallpaper/lib/index.js:93-108` 的注释），因此：
* 设置页会出现 `office-route-b` 条目，且**白名单/上限/预设可热改、不重挂插件**；
* 若把全部字段都设成非 volatile，就会复现本部署已有的那个 bug（设置页显示
  「设置命名空间未注册（…插件未加载？）」）。

**⚠️ 本部署必踩的坑（务必写进装配注意）**：标了 `.volatile()` 的字段在 `apply(ctx, config)` 里
拿到的是 **cosmokit 引用对象**而不是值，必须逐调用 `.get()` 解包
（同形参考 `@local/dsh-subagent-model/lib/index.js:44-55`、`@local/dsh-workerspace/lib/index.js:56-63`；
`VOLATILE_WRITE = Symbol.for("cosmokit.volatile.write")`）。
本插件的 `plain()` / `snapshot()` 就是这件事，且**每次使用都重新解包** ⇒ 热改立即生效。

---

## C. 自建面：投递侧触发 + 鉴权 + 白名单

### C.1 现有 Nautilus 投递器长什么样（只读勘查）

**位置**：`/home/CNS2026495165/.local/lib/dsh-office-handoff/`（`owner` 清单里 18 个文件的 sha256 + 版本 0.1.0，
安装于 2026-09-28）+ 桌面脚本 `~/.local/share/nautilus/scripts/DSH-纳入工作区`。

| 项 | 现状 | 出处 |
|---|---|---|
| **POST 到哪个路径** | `POST ${origin}/api/${method}` | `[源码 lib/api.js:76]` |
| **注册/探针用的方法** | 探针 `workspace.list`；登记 `workspace.create`；`workspace.delete`（回滚/验收用） | `lib/api.js:119`（探针）、`:203`（create）、`:225`（delete） |
| **信封形状** | `{ type: "client-request", rpcId, method, payload }` | `lib/api.js:73` |
| **带什么凭据** | **什么都不带**。请求头**只有** `content-type: application/json`（刻意不发 `Origin`/`Sec-Fetch-Site`，发了反而被信任栅栏 403） | `lib/api.js:8-9, 78` |
| origin 解析 | `--url` > `$DSH_WEB_URL` > `http://127.0.0.1:3080` | `lib/api.js:20,30-67` |
| 硬闸门 | `DSH_OFFICE_HANDOFF_FORBID_3080=1` ⇒ 打向 3080 一律 fail-closed | `lib/api.js:22,59-65` |
| 超时 | 3000 ms（`AbortSignal.timeout`） | `lib/api.js:24` |
| 目标目录 | 默认 `~/DSH-办公投递`（`DEFAULT_WORKSPACE_DIRNAME`），环境变量 `DSH_OFFICE_HANDOFF_WORKSPACE` | `lib/cli.js:50,52` |
| 扩展名白名单 | 14 项（与官方 webhook 无关，是本投递器自己的） | `lib/paths.js:24-28` |
| 状态根 | `$DSH_OFFICE_HANDOFF_STATE` > `$DSH_HOME/office-handoff` | `lib/state.js:21-28` |
| 编排 | ①候选归一 ②探针 ③用户确认 ④mkdir ⑤持锁只读校验+事务化复制 ⑥`workspace.create` ⑦失败回滚 | `lib/cli.js:5-11, 806-811, 1035-1060` |
| Nautilus 脚本 | **只转发**：`exec "$RECEIVER" --source=right-click -- "$@"`（`--` 终止符 + `IFS=$'\n'`） | 脚本原文 |
| `--json` 报告 | 含 `origin`/`probe`/`confirm`/`copies`/`journal`/`workspace{workspaceId,title,created}`/`refusal` | `lib/cli.js` finish 分支 |

**在 0.2.0 上会怎样**（这就是必须改造的原因）：
1. 探针 `POST /api/workspace.list` ⇒ 0.2.0 **没有这个端点**（`workspace` 命名空间 11 个端点无 `list`）
   ⇒ 未认领端点 404 ⇒ 被 `failedFrom` 判 `endpoint-missing`，**整条流程在②就 spool + 退出**；
2. 即便绕过探针，`/api/*` 在 0.2.0 上**全部**在 `admit()` 之后 ⇒ 无 cookie **401**
   （`[源码 $B/dsh-client-connection/lib/index.js:14,591,647,834]`，README:39 明说无 loopback 旁路）。

`[实跑]` 现役证据（说明这条路**曾经**能用）：`$A/home/storages/workspace.json` 里有一条
`path: /home/CNS2026495165/DSH-办公投递`、`title: DSH-办公投递`、`sessionIds: [session-55ab3dfc-…]`
—— 是 0.1.1 时代 Route A 的产物。

### C.2 取舍：「新增 host 插件」 vs 「只改投递器」

| 维度 | 方案 α：**只改投递器**（复用官方 `dsh-webhook-github` 做入口） | 方案 β：**新增 host 薄插件**（本工单选） |
|---|---|---|
| 结构可行性 | **不可能单独成立**：规则必须由插件 `register()`；`dsh-webhook` 无 Config、无 YAML 规则入口 `[源码 README:46]` ⇒ 仍需写规则插件 | 成立；一个包同时承担"规则 + 入口" |
| 新增宿主代码量 | 规则插件 ≈ 40-60 行（入口交给官方） | ≈ 470 行（含纯逻辑层 `core.js` 与自测） |
| 投递侧改动量 | 多 3 个 `x-github-*` 头 + 实现 `sha256=<hex>` HMAC（`@octokit/webhooks` 的 `verify` 期望格式） | 多 1 个 `authorization: Bearer <token>` 头 |
| 依赖面 | 需 `@octokit/webhooks`（**已在树里** 14.2.0）参与验签 | **零新依赖**（`node:crypto` + `node:fs`） |
| 语义可读性 | 办公投递伪装成 GitHub 事件（`kind:"github"`、`x-github-event: office`）⇒ 审计/排障时误导 | 语义自洽（`kind:"office-handoff"`，进 `ruleId`/`source` 可追溯） |
| 鉴权强度 | HMAC-SHA256（无时间戳，仍可重放；但需要密钥才能伪造） | 常量时间比较的共享令牌（同样是持有即可重放） |
| 官方姿势贴合度 | **高**（入口完全用官方实现与官方状态码表） | 中（HTTP 层照抄官方，属"官方范式的自实现"） |
| 失败语义 | 违反白名单 ⇒ 官方适配器**已返回 202**，规则只能在日志里记拒绝 ⇒ 投递侧只看到"成功" | 白名单在 dispatch **之前**判 ⇒ 投递侧拿到 **403 + 具名原因** |
| 风险 | 投递侧 HMAC 实现细节（`sha256=` 前缀、原始体字节）易错；且 202 掩盖拒绝 | 自建 HTTP 层需自己守 405/415/413/边界；已用 34 条单测覆盖 |

**⇒ 采纳方案 β，理由按权重排序**：
1. **规则插件躲不掉**（方案 α 也要写插件），所以"只改投递器"这个选项本身不存在；
2. 用户裁决要求「自建鉴权 + 目录/扩展名白名单**到位**」—— β 能做到"拒绝时给明确状态码"，
   α 在官方适配器形态下**必然**是"202 + 静默拒绝"；
3. β 的投递侧改动只有 1 个请求头，`--json` 报告与 spool 的现有结构不需要重做；
4. β 不引入新依赖，也不把办公语义伪装成 GitHub 语义。
**保留 α 作为回退**：若后续要把入口完全交给官方（例如要接真实 GitHub），
插件里的 `apply()` 只删路由那一段即可，规则段可原样复用。

### C.3 可编译草案代码

| 文件 | 行数 | 说明 |
|---|---|---|
| `p0c/plugin-draft/lib/core.js` | ~300 | **纯逻辑、零 DSH 依赖**（只 `node:crypto` + `node:path`）：`isInside`/`isInsideAny`、`extensionOf`、`isAllowedExtension`、`verifyToken`、`bearerTokenFromHeader`、`checkWorkspacePath`、`checkFileEntry`、`parseNote`、`normalizeExtensions`、`buildTitle`、`buildPrompt`、`redactText` |
| `p0c/plugin-draft/lib/index.js` | ~470 | Cordis 插件：`name`/`inject`/`Config`/`apply`/`plain`/`snapshot`/`assertConfig`/`authorizeDelivery`/`toSessionRequest`；有界读体、状态码表、规则注册、精确路由注册 |
| `p0c/plugin-draft/package.json` | — | `type: module`、`main: lib/index.js`、5 条 `peerDependencies`（cordis ^4.0.4 / schemastery ^3.18.4 / dsh-credentials / dsh-host-webserver / dsh-webhook，后三者 `0.2.0-rc.2`） |
| `p0c/plugin-draft/README.md` | — | 契约表 + 安全性质 + 安装命令 |
| `p0c/deliverer-patch/api.route-b.js` | ~290 | 投递器 `lib/api.js` 的**整份替换草案**（Route B 客户端） |
| `p0c/deliverer-patch/api.route-b.diff` | 399 | 与 `api.original.js` 的统一 diff |
| `p0c/deliverer-patch/cli.edits.md` | — | `lib/cli.js` 的 7 处精确"搜索→替换" |

**四项硬要求的实现位置**：

| 要求 | 实现 | 证据 |
|---|---|---|
| **白名单（扩展名集合 + 目标目录前缀）** | `core.checkWorkspacePath`（绝对 + 落在 `workspaceRoots` 内）+ `core.checkFileEntry`（必须在目标目录内 + 扩展名白名单）；`index.authorizeDelivery` 再用 `realpath`/`lstat`/`stat` **复判**（防 `..` 与符号链接逃逸、防 TOCTOU） | 单测 14 条 403 用例 |
| **常量时间比较的令牌校验** | `core.verifyToken`：**两侧都 sha256** 后 `crypto.timingSafeEqual`（定长 32 字节 ⇒ 比较耗时与输入长度无关，且永不因长度不等抛异常） | 单测 11 条（含 1 字节 vs 200 000 字节） |
| **请求体限长** | `index.readBoundedUtf8Body`：先验 `content-length`（歧义 400 / 超限 413），再流式累计（超限 `resume()` + 413），`!request.complete` ⇒ 400，非 fatal UTF-8 ⇒ 400（**逐条对齐官方 `dsh-webhook-github:33-61`**） | 单测 413 用例 |
| **拒绝时返回明确状态码** | 405 / 415 / 400 / 401 / 403 / 413 / 503 + **具名 code**（`workspace-path-outside-allowlist`、`file-extension-not-allowlisted`、`file-is-symlink`、`files-over-limit`、`file-too-large` …）；意外错误一律 503 + 固定文案 | 单测 20 条 handler 出口 |
| **不把令牌写进日志** | 无任何 header/body 日志；错误文本全为固定常量；`core.redactText` 作兜底；单测断言"全部日志行不含令牌字面量，也不含请求体片段" | 单测 D 段 2 条 |

### C.4 不启动服务的单元级自测命令与预期输出

```bash
# ① 宿主插件草案（34 断言；在真实 0.2.0-rc.2 依赖树上加载 lib/index.js）
cd /home/CNS2026495165/dsh/.workspace/audit-020/p0c
node harness/selftest.mjs
```
**预期输出（本次实跑，尾部）**：
```
=== A. core.js 纯函数（零服务、零 DSH 依赖）===
  ok   isInside 是**纯文本**判定（调用方必须先 path.resolve）   6/6
  ok   extensionOf 只取最后一段 basename   6/6
  ok   isAllowedExtension 白名单（大小写不敏感 / 缺省拒绝）   4/4
  ok   verifyToken：常量时间比较的真值表   8/8
  ok   verifyToken：长度差异既不失衡也不抛（两侧 sha256 定长）   3/3
  ok   bearerTokenFromHeader：唯一 + 只认 Bearer   7/7
  ok   checkWorkspacePath：绝对 + 白名单前缀（含 ../ 逃逸与 NUL）   8/8
  ok   checkFileEntry：必须在目标目录内 + 扩展名白名单   7/7
  ok   parseNote / normalizeExtensions / buildTitle 边界   6/6
  ok   buildPrompt：附注只在非空时出现，且被标为不可信   4/4
=== B. index.js：模块可加载 + apply() 注册面（真实 rc2 依赖树）===
  ok   模块导出面（真依赖树加载，非 mock）   name/inject
  ok   apply() 注册 1 条规则 + 1 个精确路由（无任何监听）   3 effects
=== C. 路由 handler：全部出口（内存假 request/response）===
  ok   GET → 405 + allow: POST（探针契约，零副作用、不需令牌）   405
  ok   POST text/plain → 415   415
  ok   POST 缺 authorization → 401   401
  ok   POST 重复 authorization 头 → 401（headersDistinct 长度≠1）   401
  ok   POST 令牌错误 → 401（且不回显令牌）   401
  ok   POST 声明长度超限 → 413   413
  ok   POST 令牌不可解析（凭据槽空）→ 503   503
  ok   POST 目标目录在白名单外 → 403   403
  ok   POST 目标目录符号链接逃逸 → 403   403 (symlink escape)
  ok   POST 目标目录不存在 → 403（宿主绝不按调用方输入 mkdir）   403
  ok   POST 扩展名不在白名单 → 403   403 (.exe)
  ok   POST 文件不在目标目录内 → 403   403 (sibling)
  ok   POST 文件是符号链接 → 403   403 (symlink)
  ok   单文件超字节上限 → 403（直调 authorizeDelivery，上限 512 B）   403 (1024 B > 512 B)
  ok   POST 文件数超上限 → 403   403 (4 > maxFiles=3)
  ok   POST 合法投递 → 202 空体 + dispatch 一次   202 + 1 dispatch
  ok   规则 run() 把投递映射成合法 WebhookSessionRequest   title="办公投递 · report.docx"
  ok   规则 run() 对空文件投递返回 null（不建会话）   null
  ok   authorizeDelivery 直调：非对象体 → 400   400
  ok   toSessionRequest 直调：空文件 → 具名拒绝   files-missing
=== D. 日志与凭据纪律 ===
  ok   全部日志行里没有令牌字面量，也没有请求体片段   1 log lines inspected
  ok   凭据按引用名解析（每次请求解析一次，可热轮换）   resolve(DSH_OFFICE_ROUTE_B_TOKEN) × 10

=== 结果：34/34 通过，0 失败 ===
```

```bash
# ② 投递侧草案（18 断言；全部用假 fetch，零网络）
cd /home/CNS2026495165/dsh/.workspace/audit-020/p0c/deliverer-patch
node selftest.mjs
```
**预期输出（本次实跑，尾部）**：
```
=== E. 与宿主插件草案的契约一致性 ===
  ok   默认路由两侧同值（投递侧 DEFAULT_ROUTE = 宿主插入片段的 config.path）   /office-handoff
  ok   扩展名白名单两侧逐项一致   14 extensions
  ok   令牌环境变量名 = 宿主凭据引用名   DSH_OFFICE_ROUTE_B_TOKEN

=== 结果：18/18 通过，0 失败 ===
```

```bash
# ③ 补丁片段语法/组合校验（只读；用的是 p0c 下的副本 HOME，不碰 $A/home）
cd /home/CNS2026495165/dsh/.workspace/audit-020/p0c
DSH_HOME="$PWD/probe-home" node \
  /home/CNS2026495165/dsh/.workspace/audit-020/assembly-020/prefix-cli-rc2/lib/node_modules/@deepseek-ai/dsh/lib/bin.js \
  --profile web --dump-config | grep -n -A3 'id: office-route-b'
```
**预期输出（本次实跑）**：
```
1729:- id: office-route-b
1730-  name: '@local/dsh-office-route-b'
1731-  config:
1732-    source: office-handoff
```
且 `grep -n 'id: webhook-runtime' …` 命中 `1727`，stderr 为空，退出码 0。

```bash
# ④ 裸名解析验证（模拟 loader 的模块解析；这次用的是 p0c/resolve-check 软链）
cd /home/CNS2026495165/dsh/.workspace/audit-020/p0c/resolve-check && node probe.mjs
```
**预期输出（本次实跑）**：
```
bare-name resolve OK: office-route-b Config,RULE_ID,apply,assertConfig,authorizeDelivery,inject,name,plain,snapshot,toSessionRequest
subpath export OK: function
```

> `p0c/node_modules/`、`p0c/harness/`、`p0c/probe-home/`、`p0c/resolve-check/`、
> `p0c/deliverer-patch/errors.js`（软链到只读源）**都是测试脚手架**，
> **不要**随插件一起复制到 `profiles/node_modules/@local/`。

---

## D. 端到端验收 Runbook

**路径**：`p0c/RUNBOOK-WP5.md`（给用户整段复制用）。

它包含：§0 变量 → §1 只读前置检查 → §2 安装插件【协调者】→ §3 追加 patch + **两侧白名单同值断言**【协调者】
→ §4 **生成并落地令牌**【用户亲自】→ §5 起 3099 实例【协调者/用户】→ §6 探针 + **端到端断言脚本**
（含"投递后多久、在哪里能看到新工作区/新会话"）→ §6.5 负例断言 → §7 **Nautilus 右键**【用户亲自】→
§8 故障排查表 → §9 停栈与回滚 → §10 未验证项 → §11 需要用户裁决的点。

**"投递后多久、在哪里能看到"的精确答案**（这是 Runbook 断言脚本的设计依据）：

| 观测面 | 位置 | 期望 |
|---|---|---|
| HTTP 受理 | `POST http://127.0.0.1:3099/office-handoff` | **202 + 空体**，立即（3 s 超时内） |
| 会话日志目录 | `$DSH_HOME/sessions/<编码后的工作区路径>/webhook-<uuid>/` | 出现 `session.lock`(0 B) + **非空** `session.v4.jsonl.zstd`；轮询 **≤30 s** |
| 工作区注册表 | `$DSH_HOME/storages/workspace.json` → `tables.workspaces.<id>` | 出现 `path == 白名单根` 的条目，且其 `sessionIds` 含该 `webhook-<uuid>` |
| GUI | 浏览器打开 0.2.0 页面（首次需带 `?token=`） | 左栏出现工作区「DSH-办公投递」，其中一条会话标题 `办公投递 · <文件名>` |
| 会话消息来源 | 会话首条 user 消息 | `source.kind === "webhook"`，含 `provider/source/deliveryId/ruleId`（官方 runtime 写入 `[源码 $B/dsh-webhook/lib/index.js:189-197]`） |

> `webhook-<uuid>` 前缀来自官方 `sessionId = brandString(\`webhook-${randomUUID()}\`)`
> `[源码 $B/dsh-webhook/lib/index.js:162]` —— 断言脚本因此可以**只靠前缀**识别 Route B 产物。
> 会话目录名（cwd 编码 `~XXXX`）本工单**未在源码里找到出处** ⇒ 断言脚本用"投递前后取差集"
> 而不是预测路径（§10 第 7 条）。

---

## 未验证项（`[未验证]`，不得当结论使用）

1. **路由真的注册到 3099 上、真的返回 202** —— 未实跑。本工单禁止起服务。
   已完成的最强近似：`[实跑]` 在内存假 ctx/request/response 上跑通全部出口 + `[实跑]` patch 组合校验通过。
2. **`dsh-webhook` 挂进本部署后 6 个 inject 服务是否全部解析** —— 未实跑。源码层已核 6 个服务
   在本组合里均有挂载者（`[实跑 grep]`）：
   `agents` ← `dsh-agent`（base）、`agentDefaultModel` ← `dsh-agent-default-model`（base）、
   `agentPresets` ← `dsh-agent-preset-registry`（**web-app**）、
   `permissionPresets` ← `dsh-permission-presets`（base）、`sessionTitle` ← `dsh-session-title`（base）、
   `workspaceRegistry` ← `dsh-workspace`（**web-app**）—— 但**未起实例确认**它们彼此顺序正确
   （官方 README:46 要求"after Agents, model defaults, agent presets, permission presets, titles,
   and the Workspace registry"）。
3. **`agentPresets.resolve("standard-glm")` / `permissionPresets.resolve("workspace-write")`
   在运行期成立** —— 未实跑（源码层：patch 的 `default: standard-glm` + base 的 presets 表含 `workspace-write`）。
4. **`!!js` 表达式在真实启动下求值正确** —— `--dump-config` **不求值 `!!js`**（其文档明说
   "without booting or evaluating `!!js`"），所以 §B 的 `workspaceRoots` 表达式**只验证了语法**。
5. **`.credentials.yaml` 的 `refs:` 落盘写法被 0.2.0 接受** —— 未实跑（本工单不写 `$A/home/**`）。
   依据只是 `dsh-credentials-local/README.md:102` 的文档形态。
6. **投递器补丁从未对真实 HTTP 服务发过请求** —— `api.route-b.js` 的 18 条断言全部用假 `fetch`；
   `cli.edits.md` 的 7 处改动**未应用、未 `node --check` 过真实文件**（改动后文件的语法检查在 Runbook §7 前置里）。
7. **会话目录名的 cwd 编码规则** —— 未找到源码出处，只是从 `$A/home/sessions/` 的现有目录名
   （`/home/CNS2026495165/DSH-办公投递` → `--home-CNS2026495165-DSH-~529E~516C~6295~9012--`）反推；本工单的
   编码实验**差一个尾随 `-`**（见 `[实跑]` 对照），故断言脚本不依赖它。
8. **官方 `docs/user/guide/github-review.md`**（两处 README 引用的"规则模块 + 专用监听端口 + 密钥设置 +
   工作区路由"完整示例）**未随包发布**：`find` 在 rc.2 树内无结果 ⇒ 其确切 YAML **未验证**，
   本报告**没有**据此编造"独立监听"的配置。
9. **`0.0.0.0` 暴露下的行为、TLS 反代组合** —— 未验证，且本设计**明确禁止**（§A.2）。
10. **rc.2 的 `dsh-settings` 写入往返**（设置页改 `extensions` 是否真的写回 patch 并热生效）——
    未实跑；依据是 `volatileForm`/`write` 的源码路径与 `@local/dsh-wallpaper` 的既有先例。
11. **`@local/dsh-office-route-b` 装机后的 loader 装载**（`name: '@local/dsh-office-route-b'` 能否
    被 profile 解析并 apply）—— 只验证到"裸名解析成功"（`[实跑]` 用 `p0c/resolve-check` 软链），
    **未在真实 profile node_modules 里装过**。

---

## 需要用户裁决的点

1. **落哪个实例**：Route B 最终挂到哪个 0.2.0 端口？（验收用 3099；**不能**是 3080 —— 那是 0.1.1。）
   现役 3098 是本会话宿主，**不允许重启**。
2. **白名单根**：用 `DSH_OFFICE_HANDOFF_WORKSPACE` 显式钉一个绝对路径，还是接受
   `$HOME/DSH-办公投递` 的默认（要求 dsh 与 Nautilus **同一个 `HOME`**）？本装配里 dsh 的
   `HOME=$A/home`，桌面 `HOME=/home/CNS2026495165` —— **默认值下两侧必然不同值**。
3. **是否另起独立监听**（官方 `dsh-webhook-github` README 的 "Dedicated listener composition"）：
   官方指南文件缺失（未验证项 8），要走这条路需要用户授权我/协调者去上游补文档或先用同 webServer。
4. **是否把入口交给官方 `dsh-webhook-github`**（方案 α）：若将来要接真实 GitHub webhook，
   建议 α；当前"办公投递"场景建议维持 β（能返回具名 403）。
5. **投递器补丁是否现在落地**：需先接受 `--json` 报告的**破坏性变更**
   （`workspace.workspaceId/title/created` → `null` / `"unknown"`；`probe.reason` 取值集合改变，
   spool 消费脚本必须同步改）。
6. **令牌轮换策略**：静态长期值 vs 定期轮换（轮换成本 = 重写 `.credentials.yaml` 的 ref + 令牌文件）。
7. **是否允许我在下一轮真正执行 Runbook §2–§7**（需要写 `$A/home/**` 与 `~/.local/**`、
   需要起 3099 实例）——**本工单的边界不允许**。

---

## 我**没有**做的事

* 未改 `$A/**` 的任何既有文件（**特别是没有改** `$A/home/profiles/web/cordis.patch.yml`；
  其 `mtime=2026-09-30 11:03:18`、`size=29063` 与本工单开工前一致 —— `[实跑 stat]`）。
* 未改 `~/.dsh/**`、`~/.dsh-017/**`、`~/.local/lib/dsh-office-handoff/**`（只读勘查）；
  投递器与 Nautilus 脚本的改动**只以补丁文本形式**产出。
* 未写 `$A/home/**`（含 `sessions/`、`storages/`、`.credentials.yaml`）——
  Runbook §4 的 `python3` 落盘脚本**没有执行过**。
* **未起任何服务**、未重启/停止 3098、3080、3097；未向任何真实端口发过请求
  （所有 HTTP 断言都用内存假 `fetch` / 假 `request`）。
* 未读 `$A/home/.credentials.yaml` 的**值**用于报告（勘查时 `grep` 到过真实密钥，
  **未转录进任何产物**；本报告只写"引用名"）。
* 未使用 `sandbox_permissions`、未申请任何越权。

### 关于"窗口内有其它文件被改动"的说明（避免误读）

`[实跑]` 用 `find … -newer <我的第一份产物>` 扫过，窗口内 `$A/home/sessions/**`、
`~/.dsh/storages/**`、`~/.local/state/**` 都有文件 mtime 变化。**这些不是本工单写的**：

* `$A/home/sessions/**` 与 `~/.dsh/storages/{usage,session_projcache}*` 是**正在运行的
  3098 宿主**在持久化会话/用量（新增的最新文件就是本会话与父会话的日志）；
* `~/.local/state/**`（wireplumber / xorg / codex-desktop）是桌面应用自己的日志；
* **本工单的每一条写命令目标都在 `p0c/**` 或 `/tmp`**；对 `$A/**` 的既有文件只做读
  （`read` / `grep` / `find` / `stat` / `node --input-type=module` 加载）。
* **判据**：`$A/home/profiles/web/cordis.patch.yml` 的 `mtime = 2026-09-30 11:03:18`、
  `size = 29063`，与我开工前读到的完全一致；`~/.local/lib/dsh-office-handoff/**` 与
  `~/.local/bin/dsh-office-handoff` 在窗口内**没有任何文件**被改动（`find -newer` 无输出）。
