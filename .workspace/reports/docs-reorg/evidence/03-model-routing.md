# 03 — 模型路由 / Provider / 网关 证据集

采集：2026-09-20 · 只读证据档 subagent · 未改动任何文件
被测部署：`node /home/CNS2026495165/.npm-global/bin/dsh web`（PID 20806）· `@deepseek-ai/dsh` **0.1.1-rc.2**（`…/@deepseek-ai/dsh/package.json:4`「`  "version": "0.1.1-rc.2",`」）
路径简写：`G`=`/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai` · `H`=`/home/CNS2026495165/.dsh` · `W`=`/home/CNS2026495165/dsh/.workspace` · `R`=`/home/CNS2026495165/dsh`
同一条目内多条证据用 `；` 分隔，格式统一为 `path:line「verbatim」`。**未打印任何密钥值**，只出现 env/credential 变量名。

---

## A. 生效的设置文件（VERIFIED）

- 运行中的 host 只读 **`H/settings.yaml`** 一处；`~/.dsh` 下不存在第二份 settings 文件，profile 目录内也没有。
  — 证据：`H/settings.yaml:1`「`ui-onboarding:`」；`find /home/CNS2026495165/.dsh -maxdepth 3 -name 'settings*.yaml'` 仅返回该一例
- 设置文件路径解析：显式 `path` 优先，否则 `<harness home>/settings.yaml`。
  — 证据：`G/dsh-settings-file/lib/index.js:31`「`	const filename = resolve(config.path ?? join(resolveDshHome(config.dshHome), "settings.yaml"));`」
- harness home 名固定 `.dsh`，优先级 `configured path > $DSH_HOME > ~/.dsh`。
  — 证据：`G/dsh-home-paths/lib/index.js:11`「`const DSH_HOME_DIR_NAME = ".dsh";`」；`:75`「`	return resolve(expandHomePath(configured ?? (fromEnv !== void 0 && fromEnv.trim().length > 0 ? fromEnv : defaultDshHome())));`」
- 进程环境里**没有** `DSH_HOME`，也没有任何 `*_API_KEY`（密钥由 credentials 服务解析，不走环境变量）。
  — 证据：`/proc/20806/environ`（只读 grep）对 `DSH_HOME` / `ADAM_API_KEY` / `OPENCODE_GO_API_KEY` / `DEEPSEEK_API_KEY` 全部无命中
- 密钥引用名存在于 `H/.credentials.yaml`（值 `<redacted>`，未读取）。
  — 证据：`H/.credentials.yaml` 内含 `ADAM_API_KEY`、`DEEPSEEK_API_KEY`、`OPENCODE_GO_API_KEY` 三个 ref 名；结构键 `version`/`refs`/`records`（1–6 行）
- web profile 的组合入口是 `cordis.patch.yml`；`cordis.yml` 本体为空数组（由 bundle + patch 层组合）。
  — 证据：`H/profiles/web/cordis.yml:4`「`[]`」；`H/profiles/web/cordis.patch.yml:1`「`# Your patch layer for this dsh profile, applied after every bundle layer:`」

## B. Provider 清单、baseURL、apiKeyEnv（VERIFIED）

设置命名空间 = `llm-pi-ai`（providers/models 的归属段）。
— 证据：`H/settings.yaml:4`「`llm-pi-ai:`」；`G/dsh-llm-pi-ai/lib/index.js:2346`「`const NS = settingsNamespace("llm-pi-ai");`」

| provider | baseURL | api | apiKeyEnv | 模型条目 | 设置行 |
|---|---|---|---|---|---|
| `opencode-go` | **未声明**（取内置 catalog） | 未声明 | `OPENCODE_GO_API_KEY` | 16 | `H/settings.yaml:6-72` |
| `adam` | `https://llmapi.roboscience.xyz/v1` | `openai-completions` | `ADAM_API_KEY` | 60+ | `H/settings.yaml:73-182` |
| `llm-deepseek` | —（段为空对象） | — | — | 0 | `H/settings.yaml:3` |

- `opencode-go` 只给凭据引用名，无 baseURL/api（由内置 catalog 补齐）。
  — 证据：`H/settings.yaml:6`「`    opencode-go:`」；`:7`「`      apiKeyEnv: OPENCODE_GO_API_KEY`」
- `adam` 三件套：凭据名 + 协议 + 网关地址。
  — 证据：`H/settings.yaml:74`「`      apiKeyEnv: ADAM_API_KEY`」；`:75`「`      api: openai-completions`」；`:76`「`      baseURL: https://llmapi.roboscience.xyz/v1`」
- `llm-deepseek` 段在本部署为空对象（该适配器默认模型未启用）。
  — 证据：`H/settings.yaml:3`「`llm-deepseek: {}`」；`G/dsh-llm-deepseek/lib/index.js:1723`「`const NS = settingsNamespace("llm-deepseek");`」

### B.1 模型条目字段（contextWindow / maxTokens / input）

- `opencode-go` 条目**全部**显式给 `contextWindow` + `maxTokens`。
  — 证据：`H/settings.yaml:9`「`        - id: minimax-m3`」；`:11`「`          contextWindow: 1000000`」；`:12`「`          maxTokens: 131072`」
- `adam` 条目几乎只给 `contextWindow`，**不给** `maxTokens`（回退默认 32768）。
  — 证据：`H/settings.yaml:81`「`        - id: deepseek-v4-pro`」；`:82`「`          contextWindow: 1000000`」
- `adam` 中**仅两个**模型声明了 `input` 且含 `image` —— 这是「原图直传」的唯一开关（详见 G 节）。
  — 证据：`H/settings.yaml:173`「`        - id: deepseek-v4.1-flash`」；`:175`「`          input:`」；`:178`「`        - id: deepseek-v4-flash-vision-exp`」；`:180`「`          input:`」
- `adam` 里带 `image` 字样的**图像生成**模型（`gemini-3-pro-image-preview*`、`veo3.1-*`）**没有**声明 `input`（属输出型）。
  — 证据：`H/settings.yaml:159`「`        - id: gemini-3-pro-image-preview`」；`:171`「`        - id: veo3.1-fast`」

## C. Provider/Model 配置 schema 与默认 contextWindow（VERIFIED）

- 默认上下文容量常量就是 **262144**；默认输出上限 `32768`。
  — 证据：`G/dsh-llm-pi-ai/lib/index.js:849`「`const DEFAULT_CONTEXT_WINDOW = 262144;`」；`:851`「`const DEFAULT_MAX_TOKENS = 32768;`」
- schema 以这两个常量作**路由级**默认值。
  — 证据：`G/dsh-llm-pi-ai/lib/index.js:940`「`	defaultContextWindow: z.number().step(1).min(1).default(DEFAULT_CONTEXT_WINDOW),`」；`:941`「`	defaultMaxTokens: z.number().step(1).min(1).default(DEFAULT_MAX_TOKENS),`」
- 实例化路由时再兜底一次字面量（双保险）。
  — 证据：`G/dsh-llm-pi-ai/lib/index.js:1024`「`			defaultContextWindow: source.defaultContextWindow ?? 262144,`」；`:1025`「`			defaultMaxTokens: source.defaultMaxTokens ?? 32768`」
- 三级回退顺序：**模型条目 → 内置 catalog → 路由默认**（maxTokens 同构）。
  — 证据：`G/dsh-llm-pi-ai/lib/index.js:639`「`		const contextWindow = entry.contextWindow ?? base?.contextWindow ?? request.defaultContextWindow;`」；`:641`「`		const maxTokens = entry.maxTokens ?? base?.maxTokens ?? request.defaultMaxTokens;`」
- 模型条目字段定义（`id`/`name`/`contextWindow`/`maxTokens`/`input`/…）。
  — 证据：`G/dsh-llm-pi-ai/lib/index.js:918`「`const modelFields = {`」；`:920`「`	contextWindow: z.number().step(1).min(1),`」；`:922`「`	input: z.array(z.union(MODALITIES)),`」
- 路由（provider）字段定义；`providers` 是 **dict（按路由 id 键控）**，不再接受数组。
  — 证据：`G/dsh-llm-pi-ai/lib/index.js:933`「`	apiKeyEnv: z.string().role("credential-ref"),`」；`:966`「`const Config = z.object({ providers: z.dict(profile).default({}) });`」；`:997`「`		if (Array.isArray(providers)) throw new Error("llm-pi-ai: providers is now a dict keyed by provider route, not an array of profiles");`」
- 模态集合只有 `text` / `image`；**路由默认模态 = `["text"]`**（未声明即文本）。
  — 证据：`G/dsh-llm-pi-ai/lib/index.js:273`「`const MODALITIES = Object.keys({`」；`:862`「`const DEFAULT_INPUT = ["text"];`」；`:942`「`	defaultInput: z.array(z.union(MODALITIES)).default([...DEFAULT_INPUT]),`」
- 声明合并：条目 → catalog → 路由默认；**空数组与缺省等价**（都表示「未声明」）。
  — 证据：`G/dsh-llm-pi-ai/lib/index.js:287`「`	return configured === void 0 || configured.length === 0 ? void 0 : [...configured];`」；`:651`「`			input: declaredInput(entry.input) ?? base?.input ?? [...request.defaultInput],`」

## D. 子代理模型路由的合并层（VERIFIED）

派发顺序（`execute` 内）：**父路由 → settings 热层 → 请求层（工具参数）→ 路由预检 → 白名单校验 → 建 child**。
— 证据：`G/dsh-tool-subagent/lib/index.js:526`「`					const parentOptions = parentAgentOptionsForDelegation(parent);`」；`:530`「`					const effectiveAgentOptions = effectiveConfiguredAgentOptions(runtimeCtx, config.agentOptions);`」；`:532`「`					const requestedChildAgentOptions = requestedAgentOptions(parentOptions, requiresRoutePreflight && providerRouteDefaults !== void 0 ? {`」；`:536`「`					assertAllowedModelSelection(modelSelectionPolicy, parentOptions, requestedChildAgentOptions, modelRequest);`」；`:540`「`						await preflightChildLlmRoute(llm, parentOptions, requestedChildAgentOptions, exec.signal, providerRouteDefaults === void 0);`」

**「settings 压过 preset」= 字段级覆盖（非整对象替换）**：
— 证据：`G/dsh-tool-subagent/lib/index.js:109`「`* agentOptions: a non-empty settings `provider`/`model` overrides the preset`」；`:127`「`	if (settingsValue === void 0 || typeof settingsValue !== "object" || settingsValue === null) return configured;`」（读失败原样回退，不抛）；`:130`「`	if (provider === void 0 && model === void 0) return configured;`」；`:132`「`		...(configured ?? {}),`」；`:133`「`		...(provider === void 0 ? {} : { provider }),`」；`:134`「`		...(model === void 0 ? {} : { model })`」
- 每次派发重读 settings（热生效，无需重启）；命名空间 `dsh-subagent`。
  — 证据：`G/dsh-tool-subagent/lib/index.js:123`「`			settingsValue = settings === void 0 || typeof settings.get !== "function" ? void 0 : settings.get("dsh-subagent");`」；`:113`「` * Read per dispatch, so editing settings.yaml takes effect on the next`」
- **请求层**（工具调用参数）语义：仅在显式传 `provider` 时改路由，且 provider/model 必须成对。
  — 证据：`G/dsh-tool-subagent/lib/index.js:62`「`	if (!hasDelegationModelRequest(request)) return configured;`」；`:67`「`	if (request.provider === void 0 !== (request.model === void 0)) throw new Error("child LLM `provider` and `model` must be supplied together");`」
- 工具实例 `agentOptions` schema（provider/model/reasoningEffort/maxTokens），默认 `undefined`。
  — 证据：`G/dsh-tool-subagent/lib/index.js:290`「`	agentOptions: z.object({`」；`:295`「`	}).default(void 0),`」
- fail-closed 两处：provider 不支持 child agentOptions 即抛；不在会话白名单即抛。
  — 证据：`G/dsh-tool-subagent/lib/index.js:410`「`		if (config.agentOptions !== void 0 && !subagentProvider.capabilities.agentOptions) throw new Error(`tool-subagent: provider "${subagentProvider.name}" does not support child agentOptions`);`」；`:96`「`	throw new Error(`child LLM route "${provider}/${model}" is not allowed for this Session`);`」

### D.1 ⚠ 本部署 settings 覆盖与 preset 的配对陷阱（VERIFIED 事实 + 代码推论）

- 本部署 `dsh-subagent` 段**只设 model，未设 provider**。
  — 证据：`H/settings.yaml:217`「`dsh-subagent:`」；`:218`「`  model: deepseek-v4-pro`」
- 按 `:132-134` 的字段级合并，**provider 键缺失 ⇒ preset 的 `provider: adam` 保留**，仅 `model` 被替换 ⇒ 生效路由应为 `adam/deepseek-v4-pro`，而非 preset 的 `adam/deepseek-v4.1-flash`。
  — 证据：`G/dsh-tool-subagent/lib/index.js:132`「`		...(configured ?? {}),`」（先铺 preset，再逐字段覆盖）
- 故 `H/AGENTS.md` 中「两个阶段统一路由到 `adam/deepseek-v4.1-flash`」**已被本部署 settings 段覆盖**，文档不得照抄该结论。
  — 证据：`H/AGENTS.md`（「两个阶段统一路由到 `adam/deepseek-v4.1-flash`」）与 `H/settings.yaml:218`「`  model: deepseek-v4-pro`」冲突
- 设置页把「默认 = adam/deepseek-v4.1-flash」写死为展示文案，并说明清空字段才恢复该默认。
  — 证据：`H/profiles/node_modules/@local/dsh-subagent-model/lib/client.js:37`「`		const DEFAULT_ROUTE = { provider: "adam", model: "deepseek-v4.1-flash" };`」；`:220`「`				setMessage({ kind: "ok", text: "已清除 dsh-subagent 段的覆盖项，恢复为 preset 默认 " + DEFAULT_ROUTE.provider + "/" + DEFAULT_ROUTE.model + "。" });`」

## E. 三条 preset / 路由常量（VERIFIED）

preset 文件 = `H/.agent-presets/standard-glm/agent.cordis.yml`（用户自建；默认 preset = `standard-glm`）。

| 载体 | provider | model | 证据行 |
|---|---|---|---|
| `subagent` | `adam` | `deepseek-v4.1-flash` | `agent.cordis.yml:193-195` |
| `subagent_fork` | `adam` | `deepseek-v4.1-flash` | `agent.cordis.yml:204-206` |
| `workflow`（`workflow-worker-thread`） | — **无 agentOptions**（仅 `provider: spawn`） | — | `agent.cordis.yml:230-233` |
| btw（不在 preset 内） | — | `deepseek-v4.1-flash`（vision 兜底默认） | `R/dsh-btw/src/host/vision.ts:103` |

- `subagent` 工具实例固定路由。
  — 证据：`H/.agent-presets/standard-glm/agent.cordis.yml:192`「`        # 子代理固定走 adam 网关的 deepseek-v4.1-flash，不随主会话模型变化。`」；`:194`「`          provider: adam`」；`:195`「`          model: deepseek-v4.1-flash`」
- `subagent_fork` 同一路由。
  — 证据：`H/.agent-presets/standard-glm/agent.cordis.yml:203`「`        # 同上：fork 子代理固定 deepseek-v4.1-flash。`」；`:205`「`          provider: adam`」；`:206`「`          model: deepseek-v4.1-flash`」
- **workflow 没有自己的默认模型常量**：`workflow-worker-thread` 只声明 `provider: spawn`，模型继承父代理。
  — 证据：`H/.agent-presets/standard-glm/agent.cordis.yml:230`「`    - id: workflow-worker-thread`」；`:232`「`        provider: spawn`」；全文无 `agentOptions`
- **btw 默认模型不在 preset 内**（preset 未插入 btw）；btw 是 host 级 `@local/dsh-btw` 插件。
  — 证据：`H/profiles/web/cordis.patch.yml:22`「`- insert:`」；`:23`「`    - id: btw`」；`:24`「`      name: '@local/dsh-btw'`」；`H/.agent-presets/standard-glm/agent.cordis.yml` 全文无 `btw`
- 默认 preset 在 patch 层与 settings 段**双处冗余**声明为 `standard-glm`（改动需同步）。
  — 证据：`H/profiles/web/cordis.patch.yml:16`「`- id: agent-presets`」；`:18`「`    default: standard-glm`」；`H/settings.yaml:191`「`agent-presets:`」；`:192`「`  default: standard-glm`」

### E.1 btw 识图兜底默认（VERIFIED，本地源码）

- btw vision 默认四元组：model `deepseek-v4.1-flash` / baseURL `https://opencode.ai/zen/go/v1` / apiKeyEnv `OPENCODE_GO_API_KEY` / maxTokens 2000。
  — 证据：`R/dsh-btw/src/host/vision.ts:102`「`export const VISION_DEFAULTS: VisionOptions = Object.freeze({`」；`:103`「`  model: 'deepseek-v4.1-flash',`」；`:104`「`  baseURL: 'https://opencode.ai/zen/go/v1',`」；`:105`「`  apiKeyEnv: 'OPENCODE_GO_API_KEY',`」；`:106`「`  maxTokens: 2000,`」
- 侧聊路由默认在 `routeOf(defaults?.currentSelection?.())` 处收口，具体默认 id 见 J.1（未逐行确认）。
  — 证据：`R/dsh-btw/src/host/vision.ts:80`「`  return routeOf(defaults?.currentSelection?.())`」

## F. vision-adam 插件：配置与 URL 规范化（VERIFIED）

源码副本与部署副本**字节一致**（md5 `ad4114ba94c13938e4ff59583eede71e`），可任引一处。
— 证据：`md5sum` 对 `W/dsh-vision-adam-src/lib/index.js` 与 `H/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js` 输出同值

- 插件默认值：baseURL 指向 opencode 网关，`/chat/completions` 由代码追加。
  — 证据：`H/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js:32`「`/** Default gateway base; `/chat/completions` is appended (opencode.ai/zen/go). */`」；`:33`「`const DEFAULT_BASE_URL = "https://opencode.ai/zen/go/v1";`」；`:35`「`const DEFAULT_MODEL = "deepseek-v4.1-flash";`」；`:37`「`const DEFAULT_API_KEY_ENV = "OPENCODE_GO_API_KEY";`」；`:39`「`const DEFAULT_MAX_TOKENS = 2000;`」
- 配置声明：`apiKey`（secret）/`apiKeyEnv`（credential-ref）/`baseURL`/`model`/`maxTokens`/`maxBytes`/`maxVideoBytes`/`xApiKey`/`sessionHeader`。
  — 证据：`H/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js:66`「`const Config = z.object({`」；`:68`「`  apiKeyEnv: z.string().role("credential-ref").default(DEFAULT_API_KEY_ENV),`」；`:69`「`  baseURL: z.string().default(DEFAULT_BASE_URL),`」；`:71`「`  maxTokens: z.number().step(1).min(1).default(DEFAULT_MAX_TOKENS),`」
- 设置命名空间 = `vision-adam`，与 settings 段名一致。
  — 证据：`H/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js:81`「`const VISION_ADAM_SETTINGS_NAMESPACE = settingsNamespace("vision-adam");`」；`H/settings.yaml:186`「`vision-adam:`」；`:187`「`  model: deepseek-v4.1-flash`」
- **本部署已改写 vision-adam 的网关与凭据**（非插件默认的 opencode 网关 / OPENCODE_GO_API_KEY），并把 maxTokens 从 2000 提到 393216。
  — 证据：`H/settings.yaml:188`「`  baseURL: https://llmapi.roboscience.xyz/v1`」；`:189`「`  apiKeyEnv: ADAM_API_KEY`」；`:190`「`  maxTokens: 393216`」
- 选项解析：settings 字段逐个 `??` 回退默认常量。
  — 证据：`H/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js:96`「`    baseURL: config.baseURL ?? DEFAULT_BASE_URL,`」；`:97`「`    model: config.model ?? DEFAULT_MODEL,`」
- **尾斜杠归一化 + URL 拼接 + fetch**（本次取证的核心行）。
  — 证据：`H/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js:161`「`  // 尾斜杠归一化（2026-09-17 加固）：`${baseURL}/chat/completions` 在 baseURL 带尾斜杠时`」；`:165`「`  const baseURL = options.baseURL.replace(/\/+$/, "");`」；`:166`「`  const response = await fetch(`${baseURL}/chat/completions`, {`」
- opencode 三头鉴权（Bearer + x-api-key + x-opencode-session），并附 UA。
  — 证据：`H/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js:155`「`    "authorization": `Bearer ${apiKey}`,`」；`:156`「`    ...options.xApiKey === false ? {} : { "x-api-key": apiKey },`」；`:157`「`    ...options.sessionHeader === false ? {} : { "x-opencode-session": randomUUID() },`」
- 媒体编码：视频走 Zhipu 风格 `video_url`，图片走 `image_url`（base64 data URL）。
  — 证据：`H/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js:177`「`            ? { type: "video_url", video_url: { url: `data:${mediaType};base64,${base64}` } }`」；`:178`「`            : { type: "image_url", image_url: { url: `data:${mediaType};base64,${base64}` } }`」
- 凭据解析三来源（credentials 服务 → 启动环境 → 字面量 apiKey），全失败即抛。
  — 证据：`H/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js:112`「`    resolved = (await credentials.resolve(options.apiKeyEnv))?.value;`」；`:114`「`    const ambient = launchEnvironmentOf(ctx).get(options.apiKeyEnv);`」；`:119`「`  throw new Error(`vision-adam has no API key for "${options.apiKeyEnv}"; store it through the credentials service, export it in the launching environment, or set a literal "apiKey" in the vision-adam config`);`」
- 插件形态：版本 0.2.0，`exports["./client"]` 提供设置页 bundle，`dsh.client.platform = "web"`。
  — 证据：`H/profiles/node_modules/@deepseek-ai/dsh-vision-adam/package.json:4`「`  "version": "0.2.0",`」；`:12`「`    "./client": "./lib/client.js",`」；`:22`「`      "platform": "web",`」
- **vision-adam 不在官方 dsh 包内**，是本部署自装插件，靠 profile patch 的 insert 行挂载。
  — 证据：`G/`（`ls | grep -i vision` 无命中）；`H/profiles/web/cordis.patch.yml:5`「`    - id: vision-adam`」；`:6`「`      name: '@deepseek-ai/dsh-vision-adam'`」

## G. 图像能力检测 / fail-closed 规则（VERIFIED）

判定链：**声明 `input` 含 `image` ⇒ 原图直传；否则 vision-adam 转文本**；一切不确定均落到保守的转文本路径。

- btw 判定函数：唯一 `true` 条件 = `inputModalities` 含 `'image'`；其余（路由不可解、注册表缺失、查询抛错、模态缺失/为空）全 `false`。
  — 证据：`R/dsh-btw/src/host/vision.ts:84`「` * Whether one route DECLARES image input. True only when the LLM registry's`」；`:90`「`export async function modelAcceptsImage(ctx: Context, route: ModelRoute, signal?: AbortSignal): Promise<boolean> {`」；`:92`「`  if (llm?.resolveModelInfo === undefined) return false`」；`:95`「`    return Array.isArray(info?.inputModalities) && info.inputModalities.includes('image')`」；`:96`「`  } catch {`」（`:97` `return false`）
- 主会话决策契约：`true` = 直传原图（不拦截）；`false` = vision-adam 文本包装（保守）。
  — 证据：`R/dsh-btw/src/host/prompt-transform.ts:49`「` * = declared image input → pass through unchanged; `false` = text-only or`」；`:52`「`export type PromptImageDecision = (ctx: Context, agent: unknown) => Promise<boolean>`」；`:60`「`export function defaultPromptImageDecision(ctx: Context, agent: unknown): Promise<boolean> {`」；`:62`「`  if (route === undefined) return Promise.resolve(false)`」；`:63`「`  return modelAcceptsImage(ctx, route)`」
- 已构建产物中同一决策的落点（侧聊直传 + 主会话导出），两代构建稳定。
  — 证据：`W/deploy-vision-settings/btw/lib/index.js:1181`「`			if (route !== void 0 && await modelAcceptsImage(this.ctx, route)) directContent = [...text.length > 0 ? [{`」；`:1560`「`	return modelAcceptsImage(ctx, route);`」；`W/backup-btw-20260917-172915/lib/index.js:1208`（同构旧备份）
- **官方 host 闸门（未改动官方包）**：waterfall `session/prompt-image-transform`；返回 `undefined` = 不拦截、原图继续；随后若有 image 块残留，则按当前 selection 的 `inputModalities` 拒绝文本模型。
  — 证据：`G/dsh-host-apiproxy/lib/index.js:2771`「`							const transformed = await ctx.waterfall("session/prompt-image-transform", { agent, content }, () => void 0);`」；`:2772`「`							if (transformed !== void 0) effective = transformed;`」；`:2778`「`							if (modelInfo.inputModalities !== void 0 && !modelInfo.inputModalities.includes("image")) return err(request, {`」；`:2781`「`								details: { reason: "MODEL_DOES_NOT_SUPPORT_IMAGES" }`」
- LLM 适配器最后一道 fail-closed（pi-ai）：带图但模型未声明 image ⇒ 抛 `UNSUPPORTED_CONTENT`；缺附件服务同样抛。
  — 证据：`G/dsh-llm-pi-ai/lib/index.js:1720`「`				const containsImage = options.messages.some((message) => contentHasImage(message.content));`」；`:1721`「`				if (containsImage && !model.input.includes("image")) throw new LlmError(`pi-ai model "${model.id}" does not support image input`, "UNSUPPORTED_CONTENT");`」；`:1723`「`				if (containsImage && attachments === void 0) throw new LlmError("pi-ai image input requires the durable attachment service", "UNSUPPORTED_CONTENT");`」
- 官方 deepseek 适配器同类闸门（本部署 `llm-deepseek` 段为空，故不生效）。
  — 证据：`W/deploy-lag/backup-015-20260915-162541/dsh-llm-deepseek/lib/index.js:1396`「`				if (connection.models.find((entry) => entry.id === options.model)?.inputModalities?.includes("image") !== true) throw new LlmError(`DeepSeek model "${options.model}" does not accept image input.`, "UNSUPPORTED_CONTENT");`」
- 设计意图：本部署 adam 网关的 `deepseek-v4-pro` 无图片渠道，故用 vision-adam 以文本返回、绕开闸门。
  — 证据：`H/profiles/node_modules/@deepseek-ai/dsh-vision-adam/README.md:8`「`这让文本模型（例如 adam 的 `deepseek-v4-pro`，它在网关下没有图片渠道）也能看图、看视频：`」；`:16`「`- `deepseek-v4-pro` 在 adam 网关下没有图片渠道（实测带图请求 500/503）。`」
- 本部署**当前实际效果**：adam 路由仅 2 个条目声明 input ⇒ 其余全部解析为 `['text']` ⇒ 主会话与 btw 侧聊**仍全部走 vision-adam 转文本**；只有 `deepseek-v4.1-flash` / `deepseek-v4-flash-vision-exp` 直传。
  — 证据：`H/settings.yaml:175`「`          input:`」；`:180`「`          input:`」；`W/vision-settings-capability-exec.md:34`「`**当前部署实际值**：`~/.dsh/settings.yaml` 的 `llm-pi-ai.providers.adam.models` 无任何 `input` 字段 → 全部解析为默认 `['text']` → 改造后主会话与侧聊仍全部走 vision-adam，行为与改造前一致`」（**该报告写于 2026-09-16，早于 `:175/:180` 的 input 声明，结论已被后续配置部分推翻**）

## H. preset 热载边界（VERIFIED，文档必引）

- `mount()` 只在会话创建时发生，而 `ensureStanding` 有 `compositionStamp`（mtimeMs + size）重挂载检查 ⇒ **改 preset 后新建的会话**本来就能拿到新组合；保持旧代际的是「改动前已存在的会话及其子代理」。
  — 证据：`G/dsh-agent-presets/lib/index.js:1134`「`			const current = await compositionStamp(preset.path);`」；`:1135`「`			if (current === void 0 || sameStamp(mounted.stamp, current)) return mounted;`」；`:1162`「`async function compositionStamp(path) {`」；`:1164`「`		const { mtimeMs, size } = await stat(path);`」
- 子代理派发**复用父 standing mount**（只 bind，不重新 `ensureStanding`）⇒ 子代理看不到 preset 文件的即时改动，这正是「换模型走 settings 段」的代码依据；本部署 patch 文件内有同结论注释。
  — 证据：`G/dsh-agent-presets/lib/index.js:959`「`		this.bindings.set(agentKey, bindScopeParent(agentKey, standing.key));`」；`:1110`「`		if (binding === void 0) this.bindings.set(agentKey, bindScopeParent(agentKey, standing.key));`」；`H/profiles/web/cordis.patch.yml:15`「`# 要热换子代理模型请走 settings 段 `dsh-subagent:` / 设置页，而不是改 preset 文件。`」

## I. 会话默认模型（VERIFIED）

- 新会话默认路由来自 settings 段 `agent-default-model`（本部署 = `adam/deepseek-v4-pro`）。
  — 证据：`H/settings.yaml:183`「`agent-default-model:`」；`:184`「`  provider: adam`」；`:185`「`  model: deepseek-v4-pro`」
- 该段 schema/命名空间由官方插件定义，可在无 settings provider 时退回组合条目。
  — 证据：`G/dsh-agent-default-model/lib/index.js:12`「`const AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE = settingsNamespace("agent-default-model");`」；`:15`「`	provider: z.string().required(),`」；`:16`「`	model: z.string().required(),`」

## J. UNVERIFIED / 未知（文档作者勿臆断）

1. **btw 侧聊默认模型 id 字面量**：源码只见 `routeOf(defaults?.currentSelection?.())` 收口（`R/dsh-btw/src/host/vision.ts:80`），未逐行确认默认 id；历史报告写作 `adam/deepseek-v4-flash`（`W/vision-settings-capability-exec.md:30`「`默认 `adam/deepseek-v4-flash``」），与 `VISION_DEFAULTS.model = deepseek-v4.1-flash` 不同源，**需另行核实**。
2. **`opencode-go` 的 baseURL / api 具体值**：settings 未声明（`H/settings.yaml:6-72`），实际取内置 catalog；catalog 数据表本轮未打开，**URL 未验证**。
   — 证据（机制，非取值）：`G/dsh-llm-pi-ai/lib/index.js:610`「`	const providerBaseUrl = catalogProvider(provider)?.baseUrl;`」
3. **`dsh-subagent` 段缺 provider 时的运行时最终路由**：按 `G/dsh-tool-subagent/lib/index.js:132-134` 推断为 `adam/deepseek-v4-pro`（provider 由 preset 补齐），但本轮未做运行时探针实测（避免干扰 host）。
4. **`workflow` 工具的默认模型**：preset 无 `agentOptions`，代码上继承父代理路由；是否有其它设置命名空间覆盖未检索到 ⇒ **未验证**。
5. **`web-search-deepseek` 段**（`H/settings.yaml:193`「`web-search-deepseek:`」、`:194`「`  baseURL: https://opencode.ai/zen/go/v1`」）属搜索能力而非模型路由，归类待定。
6. **`H/.credentials.yaml` 记录结构**：仅确认三个 ref 名存在，未读取记录内容（避免触碰密文），故凭据轮换/多记录语义未知。
