# S21 决策简报：是否启用 subagent 显式模型选择（`modelSelectionSettings: true`）

- 简报类型：只读决策档（未改 settings、未重启、未 patch、未 install、未使用 sandbox_permissions）
- 取证时间：2026-09-17（+08:00）
- 取证对象：部署位 `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tool-subagent/lib/index.js`（下文简称 `tool-subagent/lib/index.js`），dsh 版本 `0.1.1-rc.2`
- 引用行号规则：除特别标注 `[arch]` 者外，一律指部署位 695 行版本

---

## 结论（一句话）

**S21 不是被注释、也不是被常量写死，而是「工具组合配置 flag 走 schema 默认 false」的休眠；但在当前部署（dsh `0.1.1-rc.2`）上，S21 不只是休眠——它缺宿主半边（`lib/model-selection-settings.js` 在 0.1.1 树中根本不存在），一旦设为 `true` 会走 `throw` 分支直接让 preset 组合加载失败，因此应判定为「当前不可用 + 语义与已裁决事项冲突」双重否决。**

## 推荐

**不启用（否决）。** 附一条有条件的次要建议：把「当前子代理路由的只读展示」由现有 `dsh-subagent` settings 段 + 设置页承担即可（已具备），不需要 S21。

**一句话理由：** 启用 S21 在当前树会先抛错（缺 `subagentModelSelection` 宿主服务），即便补齐也把「路由选择权」从用户交到模型手里，直接触碰「路由调整须用户明确指令」这条已裁决边界，换来的只是模型自选模型这一项无需求支撑的能力。

## 关键证据行号（速查）

| # | 事实 | 位置 |
|---|---|---|
| 1 | 开关定义（schema 默认 false） | `tool-subagent/lib/index.js:287` |
| 2 | 休眠判定点：`!== true` 直接 `install(ctx, void 0)` 返回 | `tool-subagent/lib/index.js:618-621` |
| 3 | 启用即需宿主服务，缺则 throw | `tool-subagent/lib/index.js:622-623` |
| 4 | 部署树中 `model-selection-settings.js` 不存在、`package.json` 无该 subpath | `tool-subagent/package.json:16-27`；`ls lib/` 仅 `index.js`/`invariant.js` |
| 5 | 参数暴露面：仅 `modelSelectionEnabled` 为真才渲染 provider/model/reasoning_effort | `tool-subagent/lib/index.js:444-457` |
| 6 | 路由白名单强校验（显式选择才校验） | `tool-subagent/lib/index.js:90-97`、`536` |
| 7 | 当前 preset 两行均未写该键 → 生效值 = schema 默认 false | `~/.dsh/.agent-presets/standard-glm/agent.cordis.yml:186-206` |
| 8 | 0.1.5 树中存在该子插件（对照物） | `~/.dsh/profiles-archive/web2-20260915-105429/node_modules/@deepseek-ai/dsh-tool-subagent/lib/model-selection-settings.js:92-95` |
| 9 | 线上 boot 图无该宿主行，且无 `list_subagent_models` | `curl :3080/` → `"id":"@local/dsh-subagent-model"`、无 `subagent-model-selection-settings`；`.workspace/acceptance-probe/dump.txt` 命中 `list_subagent_models` = 0 次 |

---

## 1. S21 到底是什么

### 1.1 定义位置与当前状态（代码中确证）

S21 是 `dsh-tool-subagent` 的**工具组合配置项**（不是 settings 命名空间、不是环境变量），字段名 `modelSelectionSettings`：

```js
// tool-subagent/lib/index.js:284-289
const Config = z.object({
	provider: z.string().required(),
	toolName: z.string().default("subagent"),
	modelSelectionSettings: z.boolean().default(false),   // ← L287
	enableRunInBackground: z.boolean().default(true),
	backgroundMode: z.union(["one-shot", "continuable"]).default("one-shot"),
```

类型面同样文件（`lib/types/index.d.ts:25-29`，部署位）：

```ts
    /**
     * Sample the Host `subagent-model-selection` setting for each new top-level
     * Session and inherit that decision in its child Sessions.
     */
    modelSelectionSettings?: boolean;
```

### 1.2 休眠的**确切机制**：schema 默认 false + 提前 return（不是注释、不是常量）

```js
// tool-subagent/lib/index.js:617-623
	};
	if (config.modelSelectionSettings !== true) {
		install(ctx, void 0);          // ← L619：policy = undefined
		return;                        // ← L620：后面整段启用逻辑根本不执行
	}
	const settings = ctx.get("subagentModelSelection");           // ← L622
	if (settings === void 0) throw new Error("tool-subagent: `modelSelectionSettings` requires @deepseek-ai/dsh-tool-subagent/model-selection-settings in the Host scope");  // ← L623
```

休眠的传递链（三段全部确证）：

1. `modelSelectionSettings` 缺失/非 `true` → `install(ctx, void 0)`
2. `modelSelectionPolicy === undefined` → `const modelSelectionEnabled = modelSelectionPolicy !== void 0;` 为 **false**（`tool-subagent/lib/index.js:419-420`）
3. `modelSelectionEnabled === false` → 三个模型参数从 schema 中整体消失（`:444-457` 的 `...modelSelectionEnabled ? {...} : {}`），且 `list_subagent_models` 不注册（该注册只在 `modelSelectionPolicy !== void 0` 时执行，`:421`）

### 1.3 本部署为什么是 false（确证）

`~/.dsh/.agent-presets/standard-glm/agent.cordis.yml:186-206` 的两行组合**完全没有写 `modelSelectionSettings` 键**：

```yaml
    - id: tool-subagent
      name: '@deepseek-ai/dsh-tool-subagent'
      config:
        provider: spawn
        toolName: subagent
        backgroundMode: continuable
        # 子代理固定走 adam 网关的 deepseek-v4.1-flash，不随主会话模型变化。
        agentOptions:
          provider: adam
          model: deepseek-v4.1-flash

    - id: tool-subagent-fork
      name: '@deepseek-ai/dsh-tool-subagent'
      config:
        provider: fork
        toolName: subagent_fork
        backgroundMode: continuable
        # 同上：fork 子代理固定 deepseek-v4.1-flash。
        agentOptions:
          provider: adam
          model: deepseek-v4.1-flash
```

→ 生效值来自 schema 的 `.default(false)`。**这是「配置未写」+「schema 默认关」的组合休眠，不是注释掉代码。**

### 1.4 线上实测交叉验证（只读探测）

- 活动主机组合 `~/.dsh/profiles/web/cordis.yml` 只有 4 行，宿主行来自 bundle + `~/.dsh/profiles/web/cordis.patch.yml`；后者**没有任何** `subagent-model-selection-settings` 行（该插件 id 的 0.1.5 残留 disabled 条目已按 `plugin-restore` 清理）。
- `curl -s http://127.0.0.1:3080/ | grep -o '"id":"[^"]*subagent[^"]*"'` 实测输出仅：
  `"id":"@deepseek-ai/dsh-client-ui-subagent"`、`"id":"@local/dsh-subagent-model"` —— **无** `subagent-model-selection-settings`。
- 本次会话工具面无 `list_subagent_models`（该工具只在启用时注册，见 §1.2 第 3 条），且 `subagent` / `subagent_fork` 的入参只有 `description` / `prompt` / `run_in_background`。

### 1.5 **最关键的新发现：即使想开，0.1.1-rc.2 树里也没有宿主半边**（代码中确证）

0.1.5 树中存在该子插件（对照物，`~/.dsh/profiles-archive/web2-20260915-105429/node_modules/@deepseek-ai/dsh-tool-subagent/lib/model-selection-settings.js`）：

```js
// profiles-archive/web2-20260915-105429/node_modules/@deepseek-ai/dsh-tool-subagent/lib/model-selection-settings.js:92-95
const name = "subagent-model-selection-settings";
//#endregion
export { SUBAGENT_MODEL_SELECTION_SETTINGS_NAMESPACE, SUBAGENT_MODEL_SELECTION_SETTINGS_SCHEMA, SubagentModelSelectionConfig, SubagentModelSelectionConfig as default, name };
```

它注册的服务名正是 `apply` 里 `ctx.get("subagentModelSelection")` 要找的（同文件 `:49-56`）：

```js
var SubagentModelSelectionConfig = class extends Service {
	static Config = z.object({ enabled: z.boolean().default(false), allowedModels: z.array(AllowedModelRouteSchema).default([]) });
	constructor(ctx, config = {}) { super(ctx, "subagentModelSelection"); ...
```

而**部署位（0.1.1-rc.2）没有这个文件、也没有这个 export**：

- `tool-subagent/package.json:16-27` 的 `exports` 只有 `.`、`./invariant`、`./src/*`、`./package.json`（无 `./model-selection-settings`）；
- `ls lib/` 实测只有 `index.js`、`invariant.js`、`types/`；
- 全盘搜索 `find /home/CNS2026495165/.npm-global/lib/node_modules /home/CNS2026495165/.dsh/profiles/node_modules -name "model-selection-settings*"` → **零命中**；
- 部署树的 preset 模板（`.../dsh/config/agent-presets/{standard,code,cordis}/agent.cordis.yml`）`grep -rn "modelSelectionSettings"` → **零命中**（上游在本版本树未启用 S21）；
- 历史结论同向：`.workspace/plugin-restore/README.md:14` 记「0.1.1 全局树无此 id……该 id 是 0.1.5 的 `lib/model-selection-settings.js` 子插件」，`.workspace/lag-audit-diff.md:11` 记该 id 为 0.1.5 尝试期残留。

**后果（确证 + 机制推断）**：在 0.1.1-rc.2 上把 `modelSelectionSettings` 设为 `true`，会命中 `:623` 的 `throw`。该 `throw` 发生在**组合（preset 装配）阶段**，不是派发阶段 —— 因此不会「开了一半」而是**该 preset 的委派工具行装载失败**（推断依据：`:618-623` 位于 `apply()` 顶层而非 `execute()`，且 `apply` 是插件装载入口，见 `lib/types/index.d.ts:75-80` 的 `export declare function apply(ctx: Context, config: Config, session?: Session): void;`）。**我无法确证**上游对「preset 行装载抛错」的容错粒度（是整份 preset 回滚到上一可用版本，还是仅该 group 缺工具）——缺的实验是「在隔离副本上设 true 后看 `:3080` boot 图与 `/plugins` 面板报错文案」。本档纪律禁止实际试跑，故列为**未确证项**（见 §6）。

---

## 2. 启用后行为面变化

### 2.1 工具入参 schema：会新增 3 个字段，直接暴露给模型（确证）

```js
// tool-subagent/lib/index.js:444-457
						...modelSelectionEnabled ? {
							provider: {
								type: "string",
								description: providerRouteDefaults !== void 0 ? "LLM provider route for the child. Supply together with model; omit both to use configured child defaults or this provider's route defaults." : "LLM provider route for the child. Supply together with model; omit both to use configured child defaults or inherit the parent route."
							},
							model: {
								type: "string",
								description: providerRouteDefaults !== void 0 ? "Model id interpreted by provider. Supply together with provider; omit both to use configured child defaults or this provider's route defaults." : "Model id interpreted by provider. Supply together with provider; omit both to use configured child defaults or inherit the parent route."
							},
							reasoning_effort: {
								type: "string",
								description: providerRouteDefaults !== void 0 ? "Adapter-owned reasoning effort for the effective child route. Omit to use a compatible configured effort or the selected model's default." : "Adapter-owned reasoning effort for the effective child route. Omit to inherit a compatible configured/parent effort or use a newly selected model's default."
							}
						} : {},
```

- **`subagent` 与 `subagent_fork` 都受影响**：这是同一个包的两行组合，preset 里各自独立配置（`agent.cordis.yml:186`、`:197`），哪一行写了 `modelSelectionSettings: true`，那一行的工具 schema 才会多出这三个字段。
- 同时新增一个发现工具 `list_subagent_models`（`tool-subagent/lib/index.js:198-226`，注册点 `:421`），工具描述原文（`:205`）：

```js
		description: "Discover LLM routes for subagents without changing the current Agent. Call with no arguments to list registered providers, with `provider` to list its advertised models, or with `provider` and `model` to inspect that exact model and its reasoning efforts. Catalog membership is advisory: an adapter may accept an unlisted model id. Use the returned ids with a delegation tool's `provider`, `model`, and `reasoning_effort` fields.",
```

### 2.2 「模型能否自主指定任意模型」：能选，但被白名单约束（确证）

约束不是编译期枚举，而是**运行期 settings 白名单**：

```js
// tool-subagent/lib/index.js:90-97
function assertAllowedModelSelection(policy, parentOptions, requested, request) {
	if (policy === void 0 || !hasDelegationModelRequest(request)) return;
	const provider = requested?.provider ?? parentOptions.provider;
	const model = requested?.model ?? parentOptions.model;
	if (provider === void 0 || model === void 0) throw new Error("cannot select child LLM values without an effective provider and model");
	if (policy.routes.some((route) => route.provider === provider && route.model === model)) return;
	throw new Error(`child LLM route "${provider}/${model}" is not allowed for this Session`);
}
```

调用点在被派发的每一次 execute 内（`:536`）：

```js
						assertAllowedModelSelection(modelSelectionPolicy, parentOptions, requestedChildAgentOptions, modelRequest);
```

被使用的白名单来自 `subagent-model-selection` settings 命名空间的 `allowedModels`（0.1.5 实现 `model-selection-settings.js:42-47`）：

```js
const SUBAGENT_MODEL_SELECTION_SETTINGS_NAMESPACE = "subagent-model-selection";
const SUBAGENT_MODEL_SELECTION_SETTINGS_SCHEMA = z.object({
	enabled: z.boolean().default(false),
	allowedModels: z.array(AllowedModelRouteSchema).default([])
});
```

要点：

- **白名单语义 = 穷举允许的 (provider, model) 精确对**（`modelRouteKey` = `${provider}\0${model}`，`tool-subagent/lib/index.js:16-18`），不是「provider 下所有模型」。
- **可选清单来源 = 运行期 LLM 清单**（`llm.listProviders()`/`llm.listModels()`），不是编译期枚举：`list_subagent_models` 会 `await llm.listModels(provider.id)` 再与 `allowedRoutes` **取交集**（`:185-187`）。工具描述自己就写明「Catalog membership is advisory: an adapter may accept an unlisted model id.」（`:205`）——即**adapter 侧不受清单约束，白名单才是硬闸**。
- 本部署这条路的事实源是 settings 里的 `llm-pi-ai.providers.adam.models`（`~/.dsh/settings.yaml:73-141`，含 `deepseek-v4-flash`/`deepseek-v4-pro`/`glm-5.3`/`claude-opus-5`/`gpt-5.6-sol` 等 ~50 项），`listModels` 走热读（`dsh-llm-pi-ai/lib/index.js:1660-1671`，`const snapshot = this.current();` 后 `snapshot.models.getModels(provider)`）。
- **重要的配置陷阱（确证）**：`allowedModels` 的 schema 默认是 `[]`，而 0.1.1-rc.2 树内的 `assertAllowedModelRoutes` **只校验「是数组」+ 非空字符串 + 不重复，不校验非空**：

```js
// tool-subagent/lib/index.js:24-25
function assertAllowedModelRoutes(routes) {
	if (!Array.isArray(routes)) throw new Error("subagent model selection requires an array of routes");
```

  非空校验只存在于 0.1.5 的宿主类里（`model-selection-settings.js:87-90`，原文逐行：`87: validate(value) {` / `88: assertAllowedModelRoutes(value.allowedModels);` / `89: if (value.enabled && value.allowedModels.length === 0) throw new Error("enabled subagent model selection requires at least one allowed model");` / `90: }`）。**若移植时只补 `index.js` 而不补这一条**，则 `enabled: true` + `allowedModels: []` 会得到「工具参数已暴露、但任何显式选择都被 `:95-96` 拒绝」的静默半开状态（推断，依据是两处代码的非空校验缺位对比）。

### 2.3 启用后的层序（逐层写清，确证）

`execute` 内的合并链（`tool-subagent/lib/index.js:522-542`，逐行标注）：

```
L525  const modelRequest = args;                                  ← 第 1 层：工具显式选择（仅启用时 schema 才有 provider/model/reasoning_effort）
L526  const parentOptions = parentAgentOptionsForDelegation(parent); ← 第 4 层：父路由（父会话 requestHeader().config，见 dsh-subagent/lib/index.js:499-509）
L530  const effectiveAgentOptions = effectiveConfiguredAgentOptions(runtimeCtx, config.agentOptions);
                                                                   ← 第 2 层（P0' 补丁）：settings `dsh-subagent`，覆写第 3 层
L531  const requiresRoutePreflight = hasDelegationModelRequest(modelRequest) || hasConfiguredLlmSelection(effectiveAgentOptions);
L532-535  requestedAgentOptions(parentOptions, effectiveAgentOptions, modelRequest, modelSelectionEnabled)
                                                                   ← 第 1/2/3 层合并；第 4 层父路由由 dsh-subagent 在创建子代理时兜底
L536  assertAllowedModelSelection(modelSelectionPolicy, parentOptions, requestedChildAgentOptions, modelRequest); ← 白名单闸（仅显式选择时生效）
L540  await preflightChildLlmRoute(...)                            ← 用 llm.resolveCallConfig 实时校验路由/effort 合法
```

优先级（高 → 低）：

| 优先级 | 层 | 启用 S21 前 | 启用 S21 后 |
|---|---|---|---|
| 1（最高） | 工具显式 `provider`/`model`/`reasoning_effort` | **不存在**（schema 无字段） | **存在**，覆盖下面所有层（`requestedAgentOptions` 内 `...request.provider === void 0 ? {} : { provider, model }`，`:74-77`） |
| 2 | settings `dsh-subagent` 段（P0' 补丁） | 生效（当前段为空 → 走第 3 层） | 不变；**仅在模型没显式传时不生效** |
| 3 | preset 静态 `agentOptions`（standard-glm） | 兜底/实际生效值 = `adam/deepseek-v4.1-flash` | 降为兜底 |
| 4（最低） | 父路由继承 | `dsh-subagent/lib/index.js:512-537` 在 `ctx.agents.create()` 阶段兜底 | 不变 |

**一句话**：启用 S21 **不改动**已裁决的「settings > preset > 父继承」三层默认链，只是在它**上面加一层模型可写的最高优先级层**，并给该层加一道白名单闸。默认值（无人显式选择时）**完全不变**。

补充两条机制细节（确证）：

- `provider` 与 `model` 必须成对（`tool-subagent/lib/index.js:67`：`throw new Error("child LLM \`provider\` and \`model\` must be supplied together")`），空串被拒（`:64-66`）；
- 「换路由但没点名 effort」会**清掉**已配置路由自带的 effort（同函数 `:70-73`，`const { reasoningEffort: _configuredReasoningEffort, ...configuredWithoutReasoning } = configured ?? {}`），使新模型用自己的默认 effort；`dsh-subagent` 侧有对应镜像逻辑（`dsh-subagent/lib/index.js:536-537`，`if (routeChanged && requested?.reasoningEffort === void 0) delete resolved.reasoningEffort;`，位于 `resolveChildAgentOptions`（`:522`）内）。

### 2.4 前置能力旗标（确证，当前已满足）

启用会额外要求 provider 具备 `agentOptions` 能力，否则组合期直接抛错：

```js
// tool-subagent/lib/index.js:406-411
	const modelSelectionCapable = config.modelSelectionSettings === true;
	ctx.sessionProjections.register(subagentModelSelectionProjectionDefinition);
	const assertSubagentProviderConfiguration = (subagentProvider) => {
		...
		if (modelSelectionCapable && !subagentProvider.capabilities.agentOptions) throw new Error(`tool-subagent: provider "${subagentProvider.name}" does not support child model selection`);
```

本部署两个 provider 都声明了该能力（**S20 已在位**）：`dsh-subagent-spawn-in-process/lib/index.js:24`、`dsh-subagent-fork-in-process/lib/index.js:37` 均为 `agentOptions: true`。→ **这一条不是启用障碍**。

---

## 3. 风险

### 3.1 与「模型路由三处统一 adam/deepseek-v4.1-flash、路由调整须用户明确指令」的冲突面（冲突，且是原则性冲突）

- **确证的冲突**：S21 的全部存在意义就是 **让模型通过工具参数自行指定子代理路由**（§2.1）。授予该能力后，「子代理路由由谁决定」这一问题的答案从「用户（settings 段 / 设置页）」变成「模型（每次调用可覆盖）」。这与裁决的表述方向直接相反。
- **确证的边界**：白名单是本部署唯一可控闸门（`:90-97`）。若白名单**只放 `adam/deepseek-v4.1-flash` 一条**，则 S21 在功能上退化为「模型可以显式重复指定它本来就会拿到的路由」——**零收益、纯增面**。若要让它有实际用途，白名单必须放宽到多条路由，**那一刻就实质突破了裁决**。
- **冲突的可见性**：由于设置页 `@local/dsh-subagent-model`（`~/.dsh/profiles/node_modules/@local/dsh-subagent-model/lib/index.js:44-52`）写的是 `dsh-subagent` 命名空间，而 S21 读的是另一个命名空间 `subagent-model-selection`（0.1.5 `model-selection-settings.js:42`），**「默认路由」与「允许模型自选的路由」会分裂成两个互不知情的配置面**：用户以为自己在设置页钉死了路由，模型却能在白名单内绕过它。这是最容易被误判为「已统一」的陷阱。

### 3.2 可观测后果

| 维度 | 启用后 | 证据 |
|---|---|---|
| **成本** | 模型可在白名单内自行把子代理切到高价模型（本环境清单含 `claude-opus-5`、`gpt-5.6-sol`、`kimi-k3 (2x usage)` 等，见 `~/.dsh/settings.yaml:99-112`）。本部署未见按路由分账的用量统计面 → **成本可观测性缺口** | `~/.dsh/settings.yaml:73-141`；`@local/dsh-usage` 仅统计 token 总量 |
| **误路由** | 显式选择被白名单拒绝时直接抛错（`:95-96`），子代理派发**失败**而非静默降级 → 模型会看到报错并可能重试，形成「选错→报错→再选」的额外轮次 | `tool-subagent/lib/index.js:90-97` |
| **误路由（更隐蔽的一种）** | 白名单通过但 effort 被清空（`:70-73`），新模型走自己的默认 effort；对 `fork` 子代理还会影响父上下文前缀复用（工具描述原文 `:427` 末句："Changing the route can prevent provider-side reuse of the inherited conversation prefix."）→ **同一段对话可能因模型自选路由而丢掉 KV cache 复用** | `tool-subagent/lib/index.js:70-73`、`:427` |
| **审计难度** | 有**部分**审计面：白名单决策会以 `subagent/model-selection-policy` 事件持久化（`:260-263`），子代理描述符里有持久 `agentModel` 字段（`dsh-subagent/lib/index.js:332-339` 的 descriptor 键列表含 `"agentModel"`）。但：① `list_agents` 面不暴露模型（`dsh-tool-subagent-control/lib/index.js` 内 `grep agentModel` 零命中）；② 白名单是**会话级冷捕获、只 append 一次**（`recordSubagentModelSelection` 内 `if (subagentModelSelectionPolicy(...) !== void 0) return;`，`:261`）→ **每次派发实际用了哪个模型、为什么，不在这条投影里** | `:260-263`、`dsh-subagent/lib/index.js:332-339` |

### 3.3 越权 / 注入面

- **注入面（推断，依据确证）**：路由选择变成模型可写的工具参数，意味着任何能影响模型输出的输入（被委派任务里的文档、网页、仓库 README 等）都可能间接诱导模型改写委派路由。白名单把影响半径封在 `allowedModels` 内 —— 这正说明**白名单的宽度就是注入面的宽度**：只放一条 = 注入无收益；放 N 条 = 注入可在 N 条内任意搬运成本与能力档位。
- **越权面（确证为「无新增宿主权限」）**：S21 只走 `llm.resolveCallConfig` 做校验（`tool-subagent/lib/index.js:147-157` 的 `preflightChildLlmRoute`），不新增 fs/网络/命令能力；子代理的沙箱与权限继承与现状一致。**唯一的权限语义变化是「路由决定权」**。
- **策略继承面（确证）**：子会话会继承父会话的白名单（`:627-633` 的 `parentId → subagentModelSelectionPolicy(parent)`），新顶层会话才重新采样 settings（`:634-637`）。即白名单改动**对已存在会话不追溯**，与 preset 静态层的「会话级」特征一致。

---

## 4. 改动面与工作量

### 4.1 要启用需改哪些文件（按依赖顺序）

| # | 文件 | 改动 | 量 | 冷/热 | 依据 |
|---|---|---|---|---|---|
| 1 | **新增** `.../@deepseek-ai/dsh-tool-subagent/lib/model-selection-settings.js` + `lib/types/model-selection-settings.d.ts` + `package.json` 的 `exports`/`files` 两处 | 从 0.1.5 树移植宿主类（注册 `subagentModelSelection` 服务与 `subagent-model-selection` settings 命名空间） | 新增 ~95 行 JS + ~10 行 json + 1 个 d.ts（0.1.5 原文件 95 行） | **冷**（见 §4.2） | `tool-subagent/package.json:16-27` 现无该 subpath；0.1.5 `model-selection-settings.js:1-95` |
| 2 | `~/.dsh/profiles/web/cordis.patch.yml` | 新增宿主行（0.1.5 写法参照 `dsh-web-app/cordis.patch.yml` 的 `- id: subagent-model-selection-settings / name: '@deepseek-ai/dsh-tool-subagent/model-selection-settings'`） | +3 行 | **冷**（host 组合变更需重启） | 线上 boot 图无该行（§1.4）；`plugin-restore/README.md:14` |
| 3 | `~/.dsh/.agent-presets/standard-glm/agent.cordis.yml` | `tool-subagent` 行（如需含 fork 行）加 `modelSelectionSettings: true`（`provider`/`model` 同层） | 每行 +1 行 | **冷**（preset 文件本身不热 —— `~/.dsh/AGENTS.md` 已实测记录 preset 改动不热；只有 settings 段热） | `agent.cordis.yml:186-206` 现无该键；§1.3 |
| 4 | 可选：把「非空白名单」校验补进 `assertAllowedModelRoutes` | 防 §2.2 的半开状态 | +1~2 行 | **冷**（`lib/index.js` 宿主代码） | `:24-38` 与 0.1.5 `model-selection-settings.js:87-90` 的对比 |
| 5 | 用户侧：设置页/`settings.yaml` 写 `subagent-model-selection.enabled: true` + `allowedModels: [...]` | 运行期数据 | ~5 行 | **热**（命名空间值级热载，参照 `dsh-subagent` 段先例） | `@local/dsh-subagent-model/lib/index.js:44-51` 的 settings 机制先例 |

**总量**：新增 ~110 行 + 修改 3 个文件共约 6~10 行 + 1 处设置数据。

### 4.2 冷/热判定（机制理由）

- **第 1、2、4 项必须冷（需重启）**：它们改变的是**宿主进程的组合图与已装载模块**——`modelSelectionSettings` 是在 `apply()`（组合装配期，见 `:400-693` 整体处于 `apply` 内、`:618` 的分支在装配期求值）读取的，而 `ctx.get("subagentModelSelection")` 依赖宿主行已被 loader 装载成服务。组合图在 boot 时装配，运行期没有重挂机制 → **必须重启**。这与 `~/.dsh/AGENTS.md` 已记录的规则一致：「仍需重启的唯一场景：改 `dsh-tool-subagent` 宿主代码、或新增设置页插件本身」；`FEATURE-MAP.md:44` 亦记「宿主 lib 改动需重启一次生效」。
- **第 3 项必须冷**：preset 文件不热（`~/.dsh/AGENTS.md`：「preset 文件本身不热……实测改 preset 后 41 秒派发的子代理仍用旧模型」），因为子代理派发走 `bindScopeParent` 复用父 standing mount，绕开了组合文件 stamp 重挂载检查 → **必须重启**。
- **第 5 项热**：纯 settings 值。且 S21 的白名单是**会话级冷捕获**（`selectForSession` 只在新顶层会话首次组合时采样，`:624-641`），故即使值级热载，**已存在会话也不追溯** → 「重启才生效」在这个特性上比 settings 的一般规律更严格。

### 4.3 回滚方式与粒度

| 粒度 | 动作 | 生效 | 备注 |
|---|---|---|---|
| 最小（推荐的回滚单位） | 删掉 preset 里的 `modelSelectionSettings: true` 一行（或改回 false） | 重启后 | 回到当前态的**精确**语义：同样 `install(ctx, void 0)`、同样无 3 个参数、同样无 `list_subagent_models` |
| 中 | 设置 `subagent-model-selection.enabled: false` | 对新顶层会话 | 宿主仍在、工具参数 schema 仍在（因为 `modelSelectionEnabled` 由**会话级 policy** 决定，不由 settings 现值决定）→ **注意：这不是完整关闭**（依据：`:420` 的 `modelSelectionPolicy !== void 0`、`:635-637` 的采样逻辑） |
| 大 | 撤销第 1、2 项（删宿主行 + 删移植文件） | 重启后 | 与启用前全等 |
| 兜底 | 目录级备份还原（本部署既有实践：`.workspace/backup-subagent-model-20260917-165928/` 保留了 `dsh-tool-subagent.index.js` 与 `cordis.patch.yml`） | 重启后 | 注意 `pnpm/npm install` 会丢 node_modules 内补丁（既有已知条件） |

**回滚风险点（确证）**：第 1 项是在 `node_modules` 内新增文件 + 改 `package.json`（该目录无版本管理、重装即丢），与 S20/S21 既有部署方式同条件。

---

## 5. 可替代方案

### 方案 A（**推荐**）：维持现状 —— settings 层已经够用

现部署已经具备「不重启改子代理默认路由」的能力，且是**用户显式指令**路径：

- 宿主热读 settings 段：`effectiveConfiguredAgentOptions()`（`tool-subagent/lib/index.js:119-136`，P0' 补丁），`L127` 起「非空字符串才覆盖、否则保留 preset」、读失败静默降级；
- 命名空间与设置页已在位：`@local/dsh-subagent-model`（`lib/index.js:26` 的 `NS = settingsNamespace("dsh-subagent")`、`:46-51` 的 `installSettingsSection`，客户端 `lib/client.js:300` 的 `ctx.settingsScope.bind({ namespace: "dsh-subagent" })`）；
- 合并序与当前值：`FEATURE-MAP.md:44` 记「层序 = 工具显式选择(S21 休眠) > settings > preset > 父路由继承」，且 `settings.yaml` 当前**无** `dsh-subagent` 段 → 实际生效 = preset 的 `adam/deepseek-v4.1-flash`。

→ 需求若是「子代理用哪个模型可配置」，**100% 已满足，且完全不需要 S21**。

### 方案 B：只读展示当前路由（若需求是「看得见」而不是「能改」）

在设置页/看板 read-only 展示 `effectiveConfiguredAgentOptions` 的三段来源（settings 现值 / preset 兜底 / 实际生效值），不引入模型可写参数。信息面等价于 S21 的 `list_subagent_models`（`:185-196` 就是 `llm.listProviders()` / `llm.listModels()` 的只读包装），但**不把路由写权交给模型**。成本：客户端一处渲染 + 可选一个只读 RPC，热面。

### 方案 C（有条件的中间方案）：要开也只开「只读发现」，不开「写」

- 可做：移植 `list_subagent_models` 这类**只读**工具面（本部署现有清单事实源本就是 `llm-pi-ai` 同源清单，热）。
- 不可做：`provider`/`model`/`reasoning_effort` 三个**写**参数一旦出现在 schema 里就没有「半开」开关——`:444` 的渲染条件就是 `modelSelectionEnabled`，而它由会话级 policy 决定（`:420`）。
- 若将来确有「模型按任务性质选路由」的真实需求，**建议的顺序是**：先只放 `adam/deepseek-v4.1-flash` 一条白名单跑通机制（收益为零但风险面为零，验证移植正确性），再单独就「放宽白名单到哪些路由」请用户裁决 —— **不要把这两步合并成一次裁决**。

### 方案 D（不推荐）：直接开 S21 + 宽白名单

收益是「模型自主选模型」，代价见 §3；且当前树会先抛错（§1.5），需要先做移植（§4.1）——**投入产出比最差**。

---

## 6. 推荐（明确）

> **不启用 S21。** 当前部署（0.1.1-rc.2）缺宿主半边，启用会走 `throw` 分支；即便补齐移植，S21 的语义（把路由写权交给模型）与已裁决的「路由调整须用户明确指令」直接冲突，而它想解决的问题（子代理默认路由可配置）已由 P0' 的 `dsh-subagent` settings 热载层 100% 覆盖。

**一句话理由**：S21 是「让模型自己选模型」的授权开关，本部署既没有这个需求（默认路由已可热配），又不具备启用条件（缺 `lib/model-selection-settings.js`），开它等于用一次宿主移植 + 一次重启换一个与裁决相反的能力面。

### 若**不启用**（推荐路径）的下一步最小动作

1. 在 `FEATURE-MAP.md` 的 S21 相关行补一句现状定性：**「0.1.1-rc.2 树无宿主半边，启用会 throw（`tool-subagent/lib/index.js:618-623`）；语义与路由裁决冲突，已否决」**——防止后续会话再把它当成「一行开关就能开」的休眠特性（当前 `FEATURE-MAP.md:44` 只写「S21 休眠」，未写「不可用」）。
2. 在本简报基础上，把「默认路由可热配」的入口写清（设置页「子代理模型」/`settings.yaml` 的 `dsh-subagent` 段，改完即热），作为「需求已被满足」的证据留档。
3. 无需任何代码、配置或重启动作。

### 若**启用**的下一步最小动作（仅供将来真要做时按序执行，本档不做）

1. **先做隔离验证**（不碰生产 preset）：把 0.1.5 的 `model-selection-settings.js` 与 `exports` 补进一份 `dsh-tool-subagent` 副本，在**该副本目录**跑一次 preset 装配，确认 `ctx.get("subagentModelSelection")` 能被解析（消除 §1.5 的「未确证」项：preset 行抛错时的容错粒度）。
2. 把「非空白名单」校验补进 `assertAllowedModelRoutes`（防 §2.2 的半开状态）。
3. 修改 3 个文件（§4.1 第 1~3 项）→ **重启一次**（冷面，机制理由见 §4.2）→ 重启后按序验证：boot 图出现 `subagent-model-selection-settings`、`list_subagent_models` 可见、`subagent` schema 多出 3 字段、白名单外的显式选择被拒（`:95-96` 文案）。
4. 白名单**初始只放 `adam/deepseek-v4.1-flash` 一条**；任何放宽都需用户单独明确指令。
5. 回滚预案先落地：备份 `dsh-tool-subagent` 目录 + `cordis.patch.yml` + `agent.cordis.yml`（本部署既有 `backup-subagent-model-20260917-165928` 同款做法）。

---

## 附：论断可信度分级

### 代码中确证（有原文/行号）

- S21 开关名/位置/默认值：`tool-subagent/lib/index.js:287`；类型面 `lib/types/index.d.ts:25-29`
- 休眠机制（提前 return + 级联 undefined）：`:618-621` → `:419-420` → `:421`、`:444-457`
- 当前 preset 未写该键：`~/.dsh/.agent-presets/standard-glm/agent.cordis.yml:186-206`
- 启用即抛错 + 部署树缺宿主半边：`:622-623`；`tool-subagent/package.json:16-27`；`ls lib/` 实测；全盘 `find` 零命中
- 参数暴露面与发现工具：`:444-457`、`:198-226`、`:421`
- 白名单闸语义（精确对、仅显式选择时校验、拒绝即抛错）：`:16-18`、`:90-97`、`:536`、`:261-263`
- 优先级链与 P0' settings 层：`:525-540`、`:61-80`、`:119-136`；父路由层 `dsh-subagent/lib/index.js:499-509`、`:512-537`
- provider 能力前置（S20 已满足）：`tool-subagent/lib/index.js:406-411`；`dsh-subagent-spawn-in-process/lib/index.js:24`、`dsh-subagent-fork-in-process/lib/index.js:37`
- 0.1.5 对照实现（宿主服务名、命名空间、enabled 非空校验）：`profiles-archive/web2-20260915-105429/node_modules/@deepseek-ai/dsh-tool-subagent/lib/model-selection-settings.js:42`（命名空间）、`:44-47`（schema）、`:49-56`（`Service` 子类与服务名 `subagentModelSelection`）、`:87-90`（非空校验）、`:92`（插件名 `subagent-model-selection-settings`）
- 历史定性同向：`.workspace/plugin-restore/README.md:14`、`.workspace/lag-audit-diff.md:11`

### 推断（标注依据）

- 「启用会使 preset 委派工具行装载失败」：依据 `:618-623` 位于 `apply()` 装配期（对照 `lib/types/index.d.ts:75-80`）。
- 「注入面宽度 = 白名单宽度」：依据 `:90-97` 是唯一闸门、且 `:205` 工具描述自述「adapter may accept an unlisted model id」。
- 「成本可观测性缺口」：依据 `~/.dsh/settings.yaml:73-141` 的清单含高价模型 + 未在部署中发现按路由分账的用量面（`@local/dsh-usage` 只见 token 总量）。
- 「若只补 index.js 不补宿主的非空校验，会出现半开状态」：依据 `:24-38` 与 0.1.5 `:87-90` 的校验缺位对比。

### 无法确证（缺什么）

1. **preset 行装配抛错时的容错粒度**：缺的实验 = 在隔离副本上设 `modelSelectionSettings: true` 后观察 `:3080` boot 图与错误文案（是整份 preset 回退、还是仅该 group 缺工具、还是新会话完全无法创建委派工具）。本档为只读，未做。
2. **0.1.5 → 0.1.1 移植的依赖闭合性**：0.1.5 的 `model-selection-settings.js` 依赖 `@deepseek-ai/dsh-llm`（该文件 `:3` 的 `import "@deepseek-ai/dsh-llm";`）与 `installSection` 签名，未在 0.1.1 树上做编译级核对。
3. **本部署是否存在其他隐式开关该特性的路径**（例如某个 loader patch 注入 config）：已 grep `~/.dsh` 全部 `*.yml/*.yaml/*.json`（排除 sessions）无 `modelSelectionSettings` 命中，但**未穷举运行期注入**（`!!js` 表达式、插件内 `ctx.loader` 动态行）——线上 boot 图（§1.4）与 `list_subagent_models` 缺席是当前态的强反证，故此项不影响结论。
