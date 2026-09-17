# 审计报告：subagent 模型选用能否 GUI 切换并热重载

- 档位：审计（route adam/deepseek-v4-flash）；只读、机制级取证，未改任何代码。
- 日期：2026-09-17；基线：部署树 `~/.dsh/profiles/node_modules/@deepseek-ai/`（0.1.1-rc.2，与全局树 `~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/` 逐字节一致，diff 已核 4 包）。
- 结论先行：**可行**。subagent 模型选用做成「settings 命名空间 + 设置页 GUI + dispatch 热读」无机制障碍——三块拼图（S20 agentOptions 透传、S21 preflight/list_models、settings 值级热载与 settings.section GUI 先例）全部在位；唯一需要动核心包的是 dispatch 读取层一处（dsh-tool-subagent execute），且与既有裁决（AGENTS.md 固定路由）不冲突：默认值 = 现路由，GUI 保存 = 用户显式指令。

---

## 一、路由现状：subagent 模型从哪来（冷/热）

### 1.1 preset 固定路由（standard-glm）——静态组合配置，非包内硬编码

- `~/.dsh/.agent-presets/standard-glm/agent.cordis.yml`：`tool-subagent` 行与 `tool-subagent-fork` 行的 `config.agentOptions: {provider: adam, model: deepseek-v4-flash}`——**路由唯一事实源是这份 preset 组合配置**，不是包代码、不是 settings、不是工具参数。
- `~/.dsh/profiles/web/cordis.patch.yml`：`agent-presets.config.default: standard-glm`（把官方 standard 换成用户自建 preset）。
- `~/.dsh/settings.yaml:145`：`agent-presets.default: standard-glm`（settings 覆盖层，见 §二）。
- `dsh-agent-presets/lib/index.js`：preset 从 `$DSH_HOME/.agent-presets` 目录发现装载（`discoverPresets`/`resolveMountable`，注释 L800-805 明示 unmemoized、目录级热可见），**preset 组合行是 mount 时静态求值**——agentOptions 非热。
- 与 AGENTS.md 一致：subagent/subagent_fork **工具 schema 无 provider/model 参数**——`dsh-tool-subagent/lib/index.js:413-425` 仅在 `modelSelectionEnabled`（即 S21 开启）时才渲染 provider/model/reasoning_effort 参数；当前 preset 未开，模型无法经工具参数换。

### 1.2 dispatch 链：模型如何决定（全部 file:line）

```
工具调用 → dsh-tool-subagent execute (L491-562)
  L495  parentOptions = parentAgentOptionsForDelegation(parent)      ← 父会话 requestHeader.config（S4，动态）
  L496  requiresRoutePreflight = hasDelegationModelRequest(args) || hasConfiguredLlmSelection(config.agentOptions)
  L497-500 requestedChildAgentOptions = requestedAgentOptions(parentOptions,
            config.agentOptions(预设静态) 合并 providerRouteDefaults, modelRequest, modelSelectionEnabled)
            —— 合并层序：工具参数(仅 S21 开) > 预设静态 agentOptions > 父路由继承
  L501  assertAllowedModelSelection(policy, ...)                     ← S21 路由白名单（见 §1.4）
  L502-507 preflightChildLlmRoute(llm, ...)                          ← llm.resolveCallConfig 实时校验（热）
  L558-561 ctx.subagents.start(config.provider, {request, agentOptions}) → 前台；L526-533 startContinuable
→ dsh-subagent SubagentRuntime (lib/index.js:807-851)
  L807  resolveChildAgentOptions(parent, request.agentOptions, childDepth)
  L500-527: 父 options 合并 requested，routeChanged 且未显式 effort 时 delete reasoningEffort
→ dsh-subagent-in-process-driver (lib/index.js:179-183)
  L179  parent.ctx.agents.create({ agentOptions: resolveChildAgentOptions(...), ... })
→ dsh-agent-loop buildRequest (lib/index.js:700-717)
  L700-701 route = {provider: this.options.provider, model: this.options.model}   ← agentOptions 直达子代理 LLM 路由
  闭环确认：config.agentOptions → request.agentOptions → 子代理 create agentOptions → 子代理实际请求路由。
```

### 1.3 S20 旗标（fork/spawn agentOptions 透传，已在位）

- `dsh-subagent-fork-in-process/lib/index.js:36-37`、`dsh-subagent-spawn-in-process/lib/index.js:23-24`：`capabilities = { agentOptions: true, ... }`。
- fork 的语义 = 父会话 completed-turn 前缀 seed（fork L23-28 `completedTurnPrefix`）；spawn = 全新子会话。两者 `start(request)` 都直通 `startInProcessRun(request, {seed})`。
- `dsh-tool-subagent/lib/index.js:377-381` 组合加载时校验：`config.agentOptions !== undefined && !capabilities.agentOptions` → 抛错。**S20 是 S21/任何 agentOptions 直传的前提，当前部署已满足。**

### 1.4 S21 modelSelectionSettings / route 策略 / preflight：配置源、热还是冷

- `modelSelectionSettings` = **工具组合配置 flag**（`dsh-tool-subagent/lib/index.js:256`，默认 false），不是 settings 命名空间。当前 preset 未开启 → **S21 在本部署休眠**：
  - `L583-586`：`modelSelectionSettings !== true` 时直接 `install(ctx, void 0)`（无 policy、无 provider/model 工具参数、不注册 list_subagent_models）。
  - 若开启：`L587-588` 要求 host 服务 `ctx.get("subagentModelSelection")`，由 `@deepseek-ai/dsh-tool-subagent/model-selection-settings` 子模块提供——**该子模块在部署树与全局树中均不存在**（grep 两树仅命中 index.js 报错字符串），开启会直接抛错。
- **route 策略读取时机 = 冷（session 级捕获，非每 dispatch）**：`L589-605` `selectForSession`——新 session 首次 install 时 `settings.current()` 读一次 allowedModels，经 `recordSubagentModelSelection`（L229-232）写入 session 投影 `subagentModelSelectionPolicy`（L198-213），此后该 session 固定；子会话从父会话投影继承（L593-598）。
- **route 策略语义 = 显式选择授权，不是默认值设置**：`assertAllowedModelSelection`（L90-97）仅在 `hasDelegationModelRequest(request)`（工具显式传了 provider/model/effort）时校验目标路由 ∈ 白名单；纯继承路径（未传任何模型字段）完全绕过策略。→ **S21 管「模型能否选」，不管「默认用哪个」**。
- **preflight = 热**：`preflightChildLlmRoute`（L116-127）每次 dispatch 经 `llm.resolveCallConfig` 实时校验 provider/model/effort，非法路由当场抛清晰错误。
- **list_subagent_models = 热、无缓存**：`L144-165` 每次调用实时 `llm.listProviders()` / `llm.listModels(provider.id)` / `llm.resolveModelInfo()`；`dsh-llm/lib/index.js:1372-1390` 每次透传 adapter；`dsh-llm-pi-ai/lib/index.js:1484-1487` `listModels` 实时读 `this.config.options().models`。模型清单事实源 = settings.yaml `llm-pi-ai.providers.adam.models`（L73+，含 deepseek-v4-flash、deepseek-v4.1-flash 等）——**settings 驱动、热**。

### 1.5 路由现状小结

| 层 | 来源 | 热/冷 |
|---|---|---|
| 默认路由 | preset 静态 `config.agentOptions`（agent.cordis.yml） | 冷（mount 固定） |
| 继承路由 | 父会话 requestHeader.config（S4） | 动态（随父） |
| 显式选择 | 工具参数 provider/model/effort（仅 S21 开） | 当前关闭 |
| 白名单 | host 服务 `subagentModelSelection`（子模块缺失） | 休眠；即便启用也是 session 级冷捕获 |
| 校验 | llm.resolveCallConfig preflight | 热（每 dispatch） |
| 模型清单 | settings `llm-pi-ai.providers.*.models` → llm.listModels | 热（无缓存） |

**当前「subagent 默认模型」没有任何 settings 读取点**——这正是可插入的位置。

---

## 二、settings 命名空间承载「subagent 默认模型」+ 值级热载：可行

### 2.1 热载机制（P0-b，已生产使用）

- `dsh-settings-file/lib/index.js:3` chokidar watch；`:46-58` `patchNode` 用 `deepEqualJson`（dsh-settings/lib/index.js:99-111）做**叶子级最小 diff**（仅改 `setIn`/`deleteIn`，不动注释/格式）；`:155-196` watcher→单链 reload queue（写读互斥）。
- `dsh-settings/lib/index.js:511-518` commit 仅在**原始 section 值**变化（deep-equal 判变）时 bump revision + 更新 `registration.resolved` + 通知 watchers；`:302-331` `register(ns, schema, {base})` 返回 scope `{get: () => registration.resolved（同步热读）, watch, update, replace}`。
- **热载生效条件 = 命名空间已注册 + 值经校验 + raw section 变化 → 下一次 `get()` 即新值，无需重启。**

### 2.2 同机制现成先例（三个，皆生产）

1. **`dsh-agent-presets`（最强先例）**：`lib/index.js:855-857` `settingsCtx.settings.register("agent-presets", AgentPresetSettingsSchema, {base: {default: config.default}})`；`:876-881` `get defaultId()` 注释原文——「**Read per call rather than cached: the settings document is hot-reloaded, so changing the default takes effect on the next session created**」；`:1059-1060` 删除后经 `settingsService.mutate` 清用户层。→ **「settings 命名空间 + 每次读取」的默认值热载已被核心包自身使用**（当前 `settings.yaml:145 agent-presets.default: standard-glm` 即此机制生效中）。
2. **`dsh-agent-default-model`**：`lib/index.js:29-55` `installSettingsSection(ctx, "agent-default-model", schema, entry, {setSource, onChange})`——source 热切到 settings 实时值，`saveSelection` 写 `settings.replace`。「默认模型 settings 化」的规范模式（本部署无运行时消费者，属休眠服务，但模式完整）。
3. **`dsh-vision-adam`**：`lib/index.js:222` `installSettingsSection(ctx, "vision-adam", Config, config, hooks)`——插件默认值 settings 化，GUI 写 settings.yaml 后 `scope.watch → hooks.onChange` 即时生效。

### 2.3 读取层选点

- **推荐：`dsh-tool-subagent` execute（lib/index.js:491-500 附近）**——在 `requestedAgentOptions` 合并前把 settings 命名空间值作为新默认层：`settings 有值 > preset config.agentOptions > 父路由继承`。该 ctx 已有 `runtimeCtx.get("llm")`（L503）先例，`runtimeCtx.get("settings")?.get("dsh-subagent")` 同理可达（settings 为 host 平面服务，dsh-settings/lib/index.js:269 `super(ctx, "settings")`）。**每 dispatch 读 = 热。**
- 备选：`dsh-subagent` `resolveChildAgentOptions`（需把 settings 传入纯函数，牵动核心包更深，不推荐）。
- 不可行面：preset 组合 YAML 是 mount 静态求值，`!!js` 表达式也只在装载时跑一次（冷），不能承担热载。

### 2.4 缓存面清查（无阻塞）

- 模型清单：llm.listModels 实时无缓存（§1.4）✅
- route policy：session 投影冷捕获，但 S21 休眠、且即便启用也只约束显式选择、不设默认 ✅
- 唯一「缓存」= preset 静态 config.agentOptions（冷基准）——被 settings 层覆盖即可，无需失效机制 ✅

### 2.5 风险

- settings 值非法（provider/model 不存在）→ `preflightChildLlmRoute`（L116-127）每次 dispatch 实时校验并抛错，错误清晰、不静默。
- 读 settings 失败（服务缺失/命名空间未注册）→ 降级到现有静态路由（base 兜底），行为不退变。
- 值级热载粒度：settings-file 叶子 diff 按命名空间提交，改 `dsh-subagent` 段不影响其它段。

---

## 三、settings.section 设置页 GUI：改动面（vision-adam 完整先例）

### 3.1 先例闭环（四件套，全部在位）

1. **host 侧注册**：`dsh-vision-adam/lib/index.js:222` `installSettingsSection(ctx, settingsNamespace("vision-adam"), Config, config, hooks)`；`dsh-settings/lib/index.js:618-637` `installSettingsSection` = `settings.register(ns, schema, {base: entry})` + `hooks.setSource(() => scope.get())` + `scope.watch(() => hooks.onChange())`（热）。
2. **客户端 bundle**：`dsh-vision-adam/package.json` `"dsh": {"client": {"platform": "web", "inject": ["@deepseek-ai/dsh-client-runtime", "@deepseek-ai/dsh-client-ui-settings"]}}` + `"./client": "./lib/client.js"`；`lib/client.js`（手写、无构建，`window.__ModuleLoader__.load`，L1-214）：`apply(ctx)` L194-208 `ctx.slots.inject("settings.section", () => ctx.slots.register({name: "settings.section", id, order, label}, Section))`；`scope = ctx.settingsScope.bind({namespace: "vision-adam"})`；表单经 `scope.getSnapshot()`/`scope.subscribe`/`scope.set/unset` 读写（L96-148，字段级 op、snapshot.mode==="host" 才允许写、空值 unset 回继承默认——**可直接照抄**）。
3. **渲染端**：`dsh-client-ui-settings-general/lib/client.js:164, 497-512, 585-586`——General 页 `renderSlot("settings.section")`、`ctx.slots.entries("settings.section")` 列出全部注册页、`ctx.slots.inject("settings.section", ...)`。
4. **settingsScope 服务**：`dsh-client-ui-settings/lib/client.js:1131+` `SettingsScopeBinder`（`bind` → `SettingsScopeController`）；共享 mirror `SettingsDescribeMirror`（host 为事实源、invalidations 重读 = GUI 热跟随）。部署：`cordis.patch.yml` `insert: @deepseek-ai/dsh-vision-adam`（已在位，GUI 实测可用）。

### 3.2 新增「subagent 模型」设置页改动面

1. host 插件（`@local/` 新包或并入既有）：`settings.register("dsh-subagent", {provider, model, reasoningEffort?, maxTokens?})` + `installSettingsSection`（base = 现 preset agentOptions adam/deepseek-v4-flash）+ **dispatch 读取层接入（§2.3）**。
2. 客户端 bundle：settings.section「subagent 模型」页——默认模型下拉（provider 分组）+ 恢复默认按钮 + 当前生效行；写 `scope.set/unset` → settings.yaml `dsh-subagent` 段（抄 vision-adam 的 saveOps/unset 模式）。
3. **模型清单来源（下拉项）**：a) 实时 `llm.listModels("adam")`（经 host RPC/工具面，热）；b) 读 settings `llm-pi-ai.providers.adam.models`（同一事实源、已是热清单）；c) 硬编码白名单（不推荐）。S21 的 `list_subagent_models` 工具面（§1.4）也可作清单源，但当前休眠——GUI 不依赖它即可。
4. 部署：`cordis.patch.yml` insert + package.json `dsh.client` 声明。全部走 @local/cordis 可插拔 seam，**不 fork 核心包**。
5. 与 P0-b 热载闭环：GUI 保存 → host `settings.replace/update` → 原子写 settings.yaml →（写路径自带 in-process commit + watcher 回环）→ `registration.resolved` 更新 → 下次 dispatch 读到新值。**改完即生效，无需重启。**

### 3.3 GUI 改动面风险

- 客户端 bundle 是手写 React（无构建链），复用 vision-adam 模板即可，量小。
- 设置页本身不碰路由——只写 settings.yaml；路由读取在 dispatch 层，二者解耦。
- 若默认模型清单很大（llm-pi-ai adam 下几十个），下拉需分组/搜索，属 UI 工作量非机制风险。

---

## 四、与 AGENTS.md「模型路由调整需用户明确指令」边界的关系

- 裁决原文（~/.dsh/AGENTS.md:48-61）：subagent/subagent_fork 由部署 preset standard-glm 固定为 `adam/deepseek-v4-flash`；模型路由**不在工具调用参数里**。
- **GUI 切换不破坏裁决**：
  1. 默认值 = 当前路由（adam/deepseek-v4-flash），零行为变化启动。
  2. 改变默认的唯一入口 = settings.yaml（GUI 保存或用户手动编辑）——**GUI 即用户明确指令的载体**（用户在设置页显式选择并保存，属用户裁决，非模型/编排自行调整）。
  3. 工具 schema 仍无 provider/model 参数（S21 `modelSelectionSettings` 保持 false）——模型无法自行换路由，裁决的「不可经工具参数」约束保持。
- **需标注的文档变更点**：热载生效后，改 settings.yaml `dsh-subagent` 段会**立即**影响后续所有 subagent 派发（含两阶段闭环档的模型）。AGENTS.md 应补充一行说明「subagent 默认模型可在设置页/`~/.dsh/settings.yaml` 的 `dsh-subagent` 段调整，修改即热生效」——把「用户显式指令」的载体从「改 preset 文件+重启」升级为「设置页/设置文件即时生效」。
- 与 S21 显式选择的关系（若未来开 P1）：`modelSelectionSettings: true` 会把 provider/model 参数暴露给模型自主选择——那才触碰裁决边界，需单独用户裁决；P0 不涉及。

---

## 五、推荐方案（P0 / P0' / P1）与改动面、风险

### P0（推荐）：settings 命名空间 + 设置页 GUI + dispatch 热读
- 改动面：
  1. **核心包一处**：`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-tool-subagent/lib/index.js` execute（L491-500）——在 `requestedAgentOptions` 合并前插入 settings 默认层（`runtimeCtx.get("settings")?.get("dsh-subagent")` 有值则覆写 `config.agentOptions` 的 provider/model）；等价于把 `hasConfiguredLlmSelection` 的判定来源扩到 settings。落地方式：直接改 + 目录备份（fork 机制断——pnpm install 已知失败损坏 node_modules，见 audit-subagent-arch-B §Q3/三；S20/S21 已按此方式部署）。
  2. **新 host 插件**（`@local/dsh-subagent-model` 或并入既有 @local 插件）：`settings.register("dsh-subagent", schema)` + `installSettingsSection`（base=当前路由）+ 可选：把 S21 `preflightChildLlmRoute` 的触发条件顺带覆盖 settings 默认（校验热、错误清晰）。
  3. **新客户端 bundle**：settings.section「subagent 模型」页（§3.2，vision-adam 模板）。
  4. `cordis.patch.yml` insert + package.json `dsh.client`。
- 风险：核心包直接改 node_modules（备份可回滚，重装会丢——与 S20/S21 同条件）；settings 读失败降级静态路由；需注意 execute 里 settings 默认层与 preset agentOptions 的合并顺序（settings 优先、preset 兜底）。
- 与 S20/S21/preset：S20 旗标已在位（agentOptions 直传）；S21 的 preflight/list_models 可顺手复用（不改其开关）；preset 的 agentOptions 退为 base 层；「preset 固定路由」裁决文档化为「默认值 = preset/settings 兜底链」。

### P0'（仅 settings 热载，无 GUI）
- 改动面 = P0 的第 1+2 项（dispatch 热读 + settings 命名空间），无客户端 bundle、无 cordis.patch client 注入。
- 用户改 `~/.dsh/settings.yaml` 的 `dsh-subagent` 段即热生效（P0-b 已验证机制）。
- **推荐作为 P0 的第一步**：先验证「settings 写 → dispatch 热读 → 子代理换模型」整链路，验收后再加 GUI（GUI 只是 settings.yaml 的写入器，不改变链路）。

### P1（复用 S21 modelSelectionSettings + 补全 model-selection-settings 子模块）
- 改动面：需新写 host 服务 `@deepseek-ai/dsh-tool-subagent/model-selection-settings`（settings 命名空间 + `current(): {enabled, allowedModels}`，§1.4 缺失件）+ preset 开 `modelSelectionSettings: true` → 工具获得 provider/model/reasoning_effort 显式选择参数 + 白名单（session 投影）。
- 语义错位：**S21 管「显式选择授权」不管「默认值」**——即使启用，默认仍来自 config.agentOptions/父路由，仍要 P0 的 dispatch 默认层才能实现「GUI 切默认」。且工具 schema 暴露模型参数 = 模型可自主换路由，**触碰 AGENTS.md 裁决边界**，需单独用户裁决。
- 结论：P1 是「按调用显式选模型」的补强，不是「默认模型 GUI 切换」的替代；仅在用户同时想要「每次派发显式指定模型」时才立项，且需先裁决策略边界。

### 最终推荐
**P0' 先行（settings 命名空间 + dispatch 热读，最小、可回滚、验证热载链路）→ 通过后上 P0（vision-adam 模板加设置页）**。默认值保持 `adam/deepseek-v4-flash`，不破坏 AGENTS.md 裁决；AGENTS.md 补一行「默认模型可在设置页/settings.yaml 调整、即时生效」的文档说明。P1 单独留待用户对「显式选择」策略边界的裁决。

---

## 附：关键文件索引

| 文件 | 关键行 |
|---|---|
| `~/.dsh/.agent-presets/standard-glm/agent.cordis.yml` | tool-subagent / tool-subagent-fork 行 `config.agentOptions` |
| `~/.dsh/profiles/web/cordis.patch.yml` | agent-presets default: standard-glm；vision-adam/usage 等 insert |
| `~/.dsh/settings.yaml` | L73+ `llm-pi-ai.providers.adam.models`；L139 `agent-default-model`；L144 `agent-presets.default` |
| `dsh-tool-subagent/lib/index.js` | L256/375 modelSelectionSettings；L491-562 execute；L583-605 休眠的 subagentModelSelection；L90-97/116-127 策略与 preflight；L144-165 list_subagent_models |
| `dsh-subagent-fork-in-process/lib/index.js` | L36-37 S20 旗标；L23-28 fork seed |
| `dsh-subagent-spawn-in-process/lib/index.js` | L23-24 S20 旗标 |
| `dsh-subagent/lib/index.js` | L500-527 parentAgentOptionsForDelegation/resolveChildAgentOptions；L807-851 startContinuable |
| `dsh-subagent-in-process-driver/lib/index.js` | L160-183 startInProcessRun → agents.create |
| `dsh-agent-loop/lib/index.js` | L700-717 buildRequest route=this.options.provider/model |
| `dsh-settings/lib/index.js` | L269 settings 服务；L302-331 register scope；L511-518 commit；L618-637 installSettingsSection |
| `dsh-settings-file/lib/index.js` | L3 chokidar；L46-58 叶子 diff；L155-196 watch/reload |
| `dsh-agent-presets/lib/index.js` | L855-857 注册；L876-881 每次热读（先例） |
| `dsh-agent-default-model/lib/index.js` | L29-55 installSettingsSection 默认模型模式 |
| `dsh-vision-adam/lib/index.js` / `lib/client.js` / `package.json` | L222 installSettingsSection；client L194-208 settings.section；dsh.client 声明 |
| `dsh-client-ui-settings-general/lib/client.js` | L164/497-512/585-586 settings.section 渲染端 |
| `dsh-client-ui-settings/lib/client.js` | L1131+ SettingsScopeBinder |
| `dsh-llm/lib/index.js` / `dsh-llm-pi-ai/lib/index.js` | L1372-1390 / L1484-1487 listModels 实时无缓存 |
