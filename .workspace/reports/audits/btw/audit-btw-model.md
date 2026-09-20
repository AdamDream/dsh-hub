# btw 模型路由 + 选择 UI — 审计报告（主代理源码级基线）

> 独立审计子代理 0a64cf25 4 轮未落盘已中断。本报告由主代理基于本会话对真实文件的直接读码（file:line 证据）整理，作为审计阶段交付物。复核阶段再独立验证实现。

## 一、事实基线（亲读 file:line）

### 1. 当前模型解析
- `dsh-btw/src/host/side-chat-service.ts:388` 与 `:442`：`resolveChildAgentOptions(parent, undefined, childDepth)` → 子对话**继承父会话 provider/model**。
- `dsh-subagent/lib/index.js:501-511`：`resolveChildAgentOptions` 返回 `{ ...parentProvider, ...parentModel, ...parentMaxTokens, ...requested, subagentDepth }` — **`requested` 展开在父字段之后，可覆盖父模型**。
- `composeChild`（side-chat-service.ts:473-484）只设 persona/toolFilter/guard，无其它模型来源。

### 2. 默认模型（glm-5.3-flash，不跟随主会话）
- 在 start/resume 调 `resolveChildAgentOptions(parent, { provider:'adam', model: 选中或默认 }, childDepth)` 即可覆盖父模型。默认 `glm-5.3-flash`。

### 3. 中途切换模型（关键）— 现成机制 `installModelSelection`
- `dsh-agent/lib/index.js:272-298` `installModelSelection(agentCtx, selection)`（**已导出** L794）挂两个 waterfall 钩子：
  - `system-prompt/assemble`：读 `selection.current`，写 `selection.assembled`，把 provider/model 注入 assembly 变量。
  - `agent/request`：`const resolved = await next()` 后用 `selection.assembled` **覆盖** `provider/model`。
- `dsh-host-apiproxy/lib/index.js:1705` 现成 `selection` 结构（照抄）：
  ```js
  let picked;
  const selection = {
    get current() { if (picked !== void 0) return picked;
      const logged = agent.session.requestHeader()?.config;
      if (logged === void 0) return DEFAULT; // btw: {provider:'adam', model:'glm-5.3-flash'}
      return { provider: logged.provider, model: logged.model, ... };
    },
    set current(next) { picked = next; },
    assembled: void 0,
  };
  ```
- **改模型 = `selection.current = { provider:'adam', model }` → 下一轮 `agent/request` 即用新模型**。

### 4. 持久化
- `dsh-agent-loop/lib/index.js:693-744` `buildRequest`：`route = { provider: this.options.provider, model: this.options.model }`；`config` 经 waterfall（含 installModelSelection 覆盖）后 `session.append("request/header", { header, reason })` **把覆盖后的 config 持久化**。
- resume 后 `selection.current` getter 读 `session.requestHeader()?.config` → 读回上次模型。**随对话持久化成立**。

### 5. UI / 协议 / 描述符
- `src/shared/remote.ts`：`startSideChatRequestSchema` 仅 `{parentSessionId, chatToken}`（无 model）；`readSideChatResultSchema` value 无 model。需新增 `setSideChatModelRequest/Result`、`start` 加 `model`、`read` 回传 `model`。
- `src/client/remote.ts`：`SideChatRemoteNamespace` 6 方法，需加 `setModel` + 登记 `TypertRemoteMap['sideChat/setModel']`。
- `src/client/controller.ts`：`SideChatClientState` 无 model；`open()` L129 调 `remote.start({parentSessionId, chatToken})`。需加 `model` 字段 + `setModel()` + `read` 回填。
- `src/client/SideChatSurface.tsx`：抽屉内容，`<header className={css.drawerHeader}>` L274，`<div className={css.headerActions}>` L285（end/minimize 按钮旁）放选择器；现有 primitive 仅 `Button/IconSendOutline16/IconStopFill16/MarkdownText/Modal` → **用原生 `<select>`**。
- `src/client/locales.ts`：`SideChatLocaleKey` + `en` 加模型标签。
- `src/remote-descriptors.ts` + `src/typert.host.ts`：**手写**（无生成脚本）；`remote-descriptors.ts` 用 `directDescriptor()` 逐方法登记。需加 `setModel` 描述符 + typert.host 的 members 项。
- `scripts/smoke-build.mjs:16,19`：硬断言 `invocations.length === 6`、`descriptors.length === 6` → 改 7。
- 构建：`tsdown.config.ts` 三入口（index / typert.host / typert.remote-client），`pnpm run build`。

## 二、设计裁决
- 三模型常量（provider 均 `adam`）：`glm-5.3-flash`（默认）、`glm-5.3`、`deepseek-v4-pro`。
- 默认/切换/持久化三合一：`resolveChildAgentOptions` 显式给默认（不继承主会话）+ `installModelSelection` 管切换与 resume 读回。
- 切换语义「下一轮生效」：`setModel` 只更新 `selection.current`，不打断进行中的 generation；`send`/`answer` 下一轮 buildRequest 读到新模型。

## 三、交付单元（9 项）

### U1 `src/shared/remote.ts`（schema）
- `startSideChatRequestSchema` 加 `model: z.string().min(1).max(64).optional()`。
- 新增 `setSideChatModelRequestSchema = { chatToken: uuid, model: string(1..64) }.strict()` + `setSideChatModelValueSchema = { chatToken, accepted: true }.strict()` + `setSideChatModelResultSchema`（discriminatedUnion ok）。
- `readSideChatResultSchema` value 加 `model: z.string().optional()`。
- 导出全部类型。验收：`tsc` 通过。

### U2 `src/remote-descriptors.ts`
- import 新增 schema；加 `directDescriptor('setModel', 'SetSideChatModelRequest', ..., 'SetSideChatModelResult', ..., line)`。验收：descriptor 数 7。

### U3 `src/typert.host.ts`
- `model.services[0].members` 加 `setModel` 方法项（signature `setModel(request: SetSideChatModelRequest): Promise<SetSideChatModelResult>`）。验收：members 含 setModel。

### U4 `src/client/remote.ts`
- `SideChatRemoteNamespace` 加 `setModel: (request: SetSideChatModelRequest) => Promise<RemoteResult<SetSideChatModelResult>>`；`TypertRemoteMap` 加 `'sideChat/setModel'`。验收：类型通过。

### U5 `src/host/side-chat-service.ts`
- 定义 `const BTW_MODELS = ['glm-5.3-flash','glm-5.3','deepseek-v4-pro'] as const` 与 `DEFAULT_MODEL='glm-5.3-flash'`、`PROVIDER='adam'`。
- startFresh/startResumed：`resolveChildAgentOptions(parent, { provider: PROVIDER, model: request.model ?? DEFAULT_MODEL }, childDepth)`。
- `LiveSideChat` entry 加 `modelSelection` 字段；`composeChild` 里构造 `selection`（照 dsh-host-apiproxy:1705 的 getter/setter，默认 `{provider:'adam',model:'glm-5.3-flash'}`）+ `installModelSelection(childCtx, selection)` + 存入 entry。
- 新增 `setModel(request)` 服务方法：查 entry → `entry.modelSelection.current = { provider:'adam', model: request.model }`（校验 model ∈ BTW_MODELS）→ 返回 accepted；未开则 error 'not-open'。
- `read()` 结果 value 加当前 model（`selection.current?.model ?? DEFAULT_MODEL`）。
- 验收：`pnpm run build` 通过；start 默认 flash、setModel 后 read 回传新 model。

### U6 `src/client/controller.ts`
- `SideChatClientState` 加 `model?: string`。
- `open()` 读初始 model（start 请求可不带，host 默认；start result value 加 `model` 回传）——**简化：start value 加 model，open 后 state.model = value.model**。
- 新增 `setModel(model)`：调 `remote.setModel({chatToken, model})`，成功后 `state.model = model`。
- `poll()`/`confirmRestore()` 从 read value 回填 `model`。
- 验收：类型通过；切换后 UI 立即反映。

### U7 `src/client/SideChatSurface.tsx`
- `headerActions` 内加 `<select value={model} onChange={...}>`，三 `<option>`（文案走 locale）；未 open 时禁用。验收：三选项可选、切换触发 setModel。

### U8 `src/client/locales.ts`
- 加 `drawer.model` + `drawer.modelOption.flash/glm53/deepseek`（或 model 标签）+ en 文案。验收：t() 可解析。

### U9 `scripts/smoke-build.mjs`
- 6 → 7 两处断言 + 加 `setModel` 存在性断言。验收：`pnpm run smoke` 通过。

## 四、构建安装 + 验证 Runbook
```bash
cd /home/CNS2026495165/dsh/dsh-btw
pnpm run build && node scripts/smoke-build.mjs
# 安装到 @local（沿用既有 btw 同步方式：产物 copy 到 ~/.dsh/profiles/node_modules/@local/dsh-btw/lib）
```
重启后：开 btw → 默认应 flash；切 glm-5.3/deepseek-v4-pro → 下一轮生效；关闭重开 → 沿用上次选择。
