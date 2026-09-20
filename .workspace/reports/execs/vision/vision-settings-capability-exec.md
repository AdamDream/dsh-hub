# vision-settings-capability-exec — 修订执行复核一体档报告

日期：2026-09-16 · 角色：修订执行复核一体（adam/deepseek-v4-flash）
任务：① vision-adam 识图模型设置的 GUI 设置页；② 图像能力检测（声明 input 含 image → 原图直传，否则 vision-adam 转文本，主会话 + btw 全局）。
范围：仅 `.workspace/dsh-vision-adam-src/`、`dsh-btw/`、部署产物目录 `.workspace/deploy-vision-settings/`、本报告。`~/.dsh` 未改动（部署由主代理执行）；未使用 sandbox_permissions；官方包（dsh-host-apiproxy 等）未改动。

---

## §0 审计先行：input modalities 解析面

**声明链路（settings.yaml → 注册表 → inputModalities）**：

| 环节 | 位置 | 说明 |
|---|---|---|
| 模型 input 字段 schema | `dsh-llm-pi-ai/lib/index.js:922` `input: z.array(z.union(MODALITIES))`，`MODALITIES = {text, image}`（`:267`） | 模型条目的声明入口 |
| 声明合并 | `:286-290` `declaredInput`（缺省/空 → undefined）；`:651` `input: declaredInput(entry.input) ?? base?.input ?? [...request.defaultInput]` | 条目 → 目录 → 路由默认，逐层回退 |
| 路由默认 | `:862` `DEFAULT_INPUT = ["text"]`；`:942` `defaultInput` schema 默认值 | 未声明 input 的路由默认文本-only |
| 适配器导出 | `:1668`/`:1687` `inputModalities: [...model.input]`（listModels / resolveModel 均导出） | 注册表面向消费者的模态视图 |
| dsh-llm 归一化 | `dsh-llm/lib/index.js:1404-1424` `normalizeModelInfo`（`inputModalities` 数组或缺省）；`:1513` `prepareCall` 透出；`:1585` 文本模型时把 image 块投影为占位文本（dsh-llm 最后兜底，非能力检测） | `ctx.llm.resolveModelInfo(provider, model)` 即消费入口 |
| 会话路由 | `dsh-session/lib/index.js:1524` `requestHeader()` → `EpochHeader.config`（provider/model）；`dsh-agent/lib/index.js:301-360` `installModelSelection`；`host-apiproxy/lib/index.js:1709-1737` `selectionFor`（picked → 日志 header → 默认）；`dsh-agent-default-model/lib/index.js:56` `currentSelection()` | 模型来源 |
| 官方闸门（未改） | `host-apiproxy/lib/index.js:2771` `session/prompt-image-transform` waterfall；`:2778` 图片残留时按 `selectionFor(agent).current` 查 `inputModalities` 拒绝文本模型 | waterfall 语义：**undefined=不拦截（原图继续）→ 闸门决定**；文本数组=替换；throw=不发送 |

**最小取用路径（两路各自在哪拿模型、在哪判断）**：

- **主会话**（prompt-transform 监听器，`payload.agent`）：
  1. 模型：`agent.session.requestHeader()?.config` → `{provider, model}`（dsh-session 公共 API，与宿主日志层同源）；未登录 header → `ctx.get('agentDefaultModel')?.currentSelection()`（宿主默认层）；再不可得 → 回退（保守走 vision-adam）。宿主 picked 层（UI 切模型未发请求前的内存态）对 btw 不可见——btw 只会更保守，最终发送仍由宿主闸门按权威选择校验，不会不安全。
  2. 判断：`ctx.get('llm')?.resolveModelInfo(provider, model)` → `inputModalities.includes('image')`。
  3. 决策：含 image → `return undefined`（不拦截，宿主闸门按声明放行原图）；否则 → vision-adam 转文本 + R1-9 包装。
- **btw 侧聊**（side-chat-service `send()` 图片处理点）：
  1. 模型：`entry.modelSelection?.current`（picked → `childAgent.session.requestHeader()?.config` → 默认 `adam/deepseek-v4-flash`）。
  2. 判断：同一 `modelAcceptsImage(ctx, route)`。
  3. 决策：含 image → 消息内容携带 `{type:'image', attachment: ref}` 内容块直传（附件轨照常记录，可读回）；否则 → 既有 vision-adam 路径。

**当前部署实际值**：`~/.dsh/settings.yaml` 的 `llm-pi-ai.providers.adam.models` 无任何 `input` 字段 → 全部解析为默认 `['text']` → 改造后主会话与侧聊仍全部走 vision-adam，行为与改造前一致；某模型条目显式声明 `input: [text, image]`（或路由 `defaultInput`）后即直传原图。检测基准=声明，非运行时探测。

---

## §1 vision-adam 设置页

**产物**：
- `.workspace/dsh-vision-adam-src/lib/client.js`（手写 `__ModuleLoader__.load` bundle：`id: "@deepseek-ai/dsh-vision-adam"`，`exports.inject = ["slots", "settingsScope"]`）。
- `settings.section` 注册：`id "@deepseek-ai/dsh-vision-adam"`、`order 60`、label「vision-adam 识图设置」，组件 `VisionAdamSection`。
- 表单字段（**沿用既有 Config 键名与默认值**，`lib/index.js:66-78`）：`model`（默认 deepseek-v4.1-flash）、`baseURL`（默认 https://opencode.ai/zen/go/v1）、`apiKeyEnv`（默认 OPENCODE_GO_API_KEY）、`maxTokens`（默认 2000，正整数）。
- 读写：`ctx.settingsScope.bind({ namespace: "vision-adam" })` → `getSnapshot()` 读生效值/`user` 层；保存时按「表单值 ≠ user 层（未存则 ≠ 生效值）」逐字段 `scope.set`，清空字段 → `scope.unset`（恢复默认）；**字段级写入，apiKey/maxBytes/maxVideoBytes/xApiKey/sessionHeader 永不触碰** → 旧值兼容（旧配置仅 `{model, maxTokens}` 正常显示/编辑，未声明键回退默认）。
- `package.json`：新增 `exports["./client"]` 与 `dsh.client { platform: "web", inject: ["@deepseek-ai/dsh-client-runtime", "@deepseek-ai/dsh-client-ui-settings"] }`。
- 部署包：`.workspace/deploy-vision-settings/`（package.json + lib/index.js + lib/client.js + README.md，含复制命令）。

**验证**：`node --check lib/client.js`、`node --check lib/index.js` 通过；`smoke-client.mjs` PASS（注册形状 + section 注册 + 服务端渲染含 4 字段/默认值）；`smoke-client-interactive.mjs` PASS（happy-dom 交互：改 model→`set`、清空已存字段→`unset`、未动字段零写入）。注：`smoke-test.mjs`（旧探针，需部署位 node_modules + 凭据 + 网络）在本工作区不可解析，为既有问题、与本档改动无关。

---

## §2 能力检测（dsh-btw）

**改动（直接改源码，4 个文件 + 1 个新测试文件）**：

1. `src/host/vision.ts`：新增共享助手 `resolveAgentRoute(ctx, agent)`（header 日志层 → agentDefaultModel 默认层 → undefined）、`modelAcceptsImage(ctx, route)`（仅当 `resolveModelInfo().inputModalities` 含 'image' 返回 true；注册表缺失/查询失败/模态缺失/空 → false）、类型 `ModelRoute`/`ModelInfoLlm`。
2. `src/host/prompt-transform.ts`：`createPromptImageTransformHandler(ctx, analyze, passDirect?)` 新增第三参决策函数（默认 `defaultPromptImageDecision`）；**决策 true → return undefined（不拦截，原图直传）**，false → 既有 vision-adam 包装；`registerPromptImageTransform` 注册不变。
3. `src/host/side-chat-service.ts` `send()`：图片存在时取 `entry.modelSelection?.current` 路由 → `modelAcceptsImage` 为真 → 内容块直传（`{type:'text'} + {type:'image', attachment: ref}`，附件轨/`readSideChatImage` 不变）；否则既有 vision-adam 路径（失败不发送、requestId 可重试）。
4. 测试：`tests/capability-detect.spec.ts`（14 用例：路由解析 3、声明判断 5、主会话三态 6——支持直传/文本包装/未知声明保守回退/路由不可解析回退）；`tests/host-image.spec.ts` 新增 3 用例（侧聊声明 image 直传且零 vision-adam 调用、文本模型走包装、声明解析失败保守回退），harness 补 `requestHeader` 桩 + 复放 `composeChild` setup。

**回退安全（自复核）**：`modelAcceptsImage` 唯一 true 条件 = 声明数组含 'image'；其余全部 false → vision-adam（文本任何模型可收）。btw 直传窗口与宿主权威选择的差异由宿主闸门兜底（`:2778`），不可能把图发给文本模型。

**全量验证（基线命令 8 项，直接二进制）**：oxlint 0/0 ✓ · tsc ×3 零错 ✓ · vitest 216 passed / 2 skipped ✓ · tsdown build ✓ · `scripts/smoke-build.mjs` ok ✓ · publint All good ✓。

**部署件**：`.workspace/deploy-vision-settings/btw/`（构建后 `lib/` + 改动源码 + 测试 + README 复制命令）。

---

## §3 自裁决与问题清单

**自裁决：通过（PASS）**。两项交付均落地并经真实命令验证；解析面按审计结论取最小公共路径；官方包与 `~/.dsh` 零改动；两路（主会话 + 侧聊）能力检测全覆盖；回退保守。

**问题清单（上报主代理）**：
1. **部署顺序**：vision-adam 设置页需 `dsh.client` 声明被 client-modules 扫描——扫描对象是活动 loader 条目；部署新 package.json + lib/client.js 后**必须重启 dsh web**，重启后验收设置页出现「vision-adam 识图设置」。
2. **设置页写入通道**：`api.settings.mutate` 为 loopback 专属 RPC；远程浏览器连接是 memory 模式（界面会提示不可持久化，与官方设置页一致）。本机 GUI 走 host 模式正常写 settings.yaml。
3. **能力检测当前部署效果**：settings.yaml 的 adam 路由未声明 `input` → 默认 `['text']`，改造后两条路径仍走 vision-adam（行为不变）；要让直传生效需给目标模型条目加 `input: [text, image]`（或路由 `defaultInput`）——这是**配置层动作，不在本档代码范围**，属预期设计（检测基准=声明）。
4. **btw 模型解析的 picked 层不可见**（见 §0）：UI 切模型后未发请求的窗口内，btw 可能按旧 header 决策；只会更保守（走 vision-adam），且宿主闸门兜底，无安全影响。
5. 旧 `smoke-test.mjs`（vision-prompt 期探针）依赖部署位 node_modules/凭据/网络，本工作区不可运行，与本档改动无关，未处理。

**部署要点（主代理执行）**：`.workspace/deploy-vision-settings/README.md`（vision-adam：备份 + 覆盖 package.json/lib/index.js/lib/client.js）与 `.workspace/deploy-vision-settings/btw/README.md`（btw：`cp -r lib/*` 到部署位）→ 重启 dsh web → 按两 README 的验收清单核对。
