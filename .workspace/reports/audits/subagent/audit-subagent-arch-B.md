# 审计：子代理 worker_threads + LLM 非流式输出（B 版独立审计）

> 结论以亲自读代码为准，逐条给 file:line。只审计、只写本文件，不改任何包代码。

## 一、Facts（三问逐条）

### Q1. 子代理驱动流程与 worker_threads 可行性

**执行链（进程内全程）**
1. `dsh-subagent-spawn-in-process/lib/index.js:28-43` — `SpawnInProcessProvider` 是 cordis 插件：`apply(ctx, config)` 里 `ctx.subagents.registerProvider(new SpawnInProcessProvider(...))`；其 `start(request)`（L39）直接 `return startInProcessRun(request, {})`。
2. `dsh-subagent-in-process-driver/lib/index.js:160 startInProcessRun` — 核心：`L179 parent.ctx.agents.create({ sessionId, meta, seed, agentOptions, signal, setup })`。子 agent 在**父的同一个 cordis context** 里创建。
3. `dsh-subagent-in-process-driver/lib/index.js:196-205 drivePublishedRun` — 驱动：`child.followup(createUserMessage({content: prompt}))` + `await child.whenIdle()` + `readResult(child, boundary, ...)`。结果从 `child.session.events.slice(boundary)` 读（L210）。
4. `dsh-agent/lib/index.js:543 create(options)` — `Reflect.apply(target.createAgent, receiver, [ownerCtx, options])`；factory 由 `setFactory`（L517）注册，实际由 `dsh-agent-loop` 提供。
5. `dsh-agent-loop/lib/index.js:606 step()` — agent loop 本体：`while(true)` 里 `buildRequest` → `stream` → `for await (chunk)` → 工具执行 → 循环。

**关键结论 A：后端可插拔（好消息）。** 子代理后端是 `ctx.subagents.registerProvider(provider)` 注册的服务（`dsh-subagent/lib/index.js:2570`），`dsh-tool-subagent` 通过 `ctx.subagents.start(config.provider, ...)`（`dsh-tool-subagent/lib/index.js:262,271`）按 provider `name` 字符串选择（`spawn`/`fork`）。→ 新增一个 worker_threads 后端**不需要 fork 核心包**，只需写一个像 `@local/dsh-btw` 那样的 cordis 插件、`registerProvider` 一个 name 新 provider。

**关键结论 B：现有 worker_threads 模式不适用（坏消息，机制级）。** `dsh-workflow-worker-thread` 是现成的 worker 用法，但它**只把编排脚本放进 worker，agent 执行仍在 host**：
- `dsh-workflow-worker-thread/lib/index.js:6 import { Worker } from "node:worker_threads"`、`:143-179` 定义 `WorkerToHostType`（Ready/Phase/Log/AgentStart/AgentEnd/...）与 `HostToWorkerType`（Go/Cancel/ChildStarted/...）。
- `worker.cjs:404 agent()` 钩子 → `:420 run = await this.children.startAgent({...})`，`children` 经 `parentPort.postMessage` 把「启动子 agent」请求发回 host；`:654` 发 `WorkerToHostType.ChildStart`。即 worker 里**没有 agent loop**，只有 `node:vm` 跑脚本 + 代理。
- worker.cjs 顶部只 require `dsh-llm / dsh-session / dsh-tools / dsh-workflow / node:vm`（`worker.cjs:24-29`），**没有** `dsh-agent` / `dsh-agent-loop`。

**可行性判定 #1（worker_threads 跑完整 agent loop）：低-中可行性、改动面大。** 要把子代理 agent loop（`dsh-agent-loop` step + LLM stream + 工具执行 + session append）真正挪进 worker，worker 内必须自建一个 cordis context（`ctx.llm`/`ctx.agents`/`ctx.tools`/session 服务 + 工具注册 + 沙箱）。这远超现有 workflow worker 的「vm 脚本 + host 代理」模式，等于把 `dsh-agent` 的运行时在 worker 里重新 bootstrap。**且收益存疑**：agent loop 本身轻，真正的 CPU/I/O 在 LLM 流式解析与 session append（见 Q2）、以及工具执行（bash/fs 已在 `dsh-subprocess` 里走子进程）。最小改动面 = 新写一个 worker 侧 agent runtime（不是改几行）。

### Q2. LLM 流式调用点与非流式改法

**流式是硬编码、全栈只有 stream。**
1. `dsh-agent-loop/lib/index.js:617 const stream = preparedCall?.stream(request) ?? this.loopCtx.llm.stream(request)`；`:619-622 for await (chunk) { ... this.session.append("assistant/chunk", {turn,step,chunk}) }` — **每个 token chunk 都 append 一条 `assistant/chunk` 事件**（这就是流式写入的源头：N 个 chunk → N 条 append → 持久化批量 → fsync）。
2. `dsh-llm/lib/index.js:1636 stream(options) → streamWithRegistration → adapterStream`（`:1559 async *adapterStream`）。**没有** `complete`/`generate`/非流式方法；`prepareCall`（`:1126`）返回的 `adapterCall` 也只有 `.stream`（`:1129,1571`）。
3. `dsh-llm-deepseek/lib/index.js:239-250 stream: true` + 注释「Always streaming (`stream: true`, usage...)」；`:879-1079` 只有 SSE 解析（`parseSse` + `translateSse`）。**适配器层也没有非流式路径。**

**可行性判定 #2（非流式 LLM）：中可行性、精确改点明确。** 两条等价路线：
- **路线 A（wire 非流式，贴合"LLM 输出非流式"字面）**：改 `dsh-llm-deepseek` 加 `stream:false` 分支 + 单次 JSON 响应解析 → 改 `dsh-llm` 暴露非流式 `complete()` → 改 `dsh-agent-loop` 子代理路径调 `complete()`。**牵动 3 个核心包，且这些是 ESM 依赖，fork 需 pnpm overrides（见 Q3，当前不可用）。**
- **路线 B（loop 层缓冲，最小核心改动）**：只改 `dsh-agent-loop/lib/index.js:617-622` —— 把 `for await` 里的 `session.append("assistant/chunk")` 改为**只 push 到 assembler、不逐 chunk append**，循环结束后一次性 `append("assistant/message")`（现在 L651 已有这条）。即「wire 仍流式，但 session 写入非流式」：N 条 append 压成 1 条。**只改 1 个包、1 个函数、约 5 行**，直接把「流式写入」I/O 量降到 1/N，且不动 `dsh-llm`/`dsh-llm-deepseek`。

> 注：路线 B 严格说不是「LLM 输出非流式」而是「LLM 结果非流式落盘」。若要严格字面（wire 非流式）则必须走路线 A 并解决核心包 fork（见 Q3）。建议用户裁决路线；从「减少卡顿」目标看，路线 B 命中「流式写入」根因、改动最小、风险最低，但会保留网关侧 token 流（网卡侧仍有流式）。

### Q3. 包解析与 fork 机制

**依赖关系**
- 顶层 `~/.dsh/profiles/web/package.json` 只声明 `@deepseek-ai/dsh`（`^0.1.1-rc.2`）+ `@deepseek-ai/cordis-plugin-group`。子代理/llm 全是**传递依赖**。
- 链路：`@deepseek-ai/dsh`（deps 含 `dsh-tool-subagent`、`dsh-tool-subagent-control`）→ `dsh-base`（bundle，deps 含 `dsh-subagent`、`dsh-subagent-spawn-in-process`、`dsh-subagent-fork-in-process`）→ `dsh-subagent-*-in-process`（deps 含 `dsh-subagent-in-process-driver`）→ `dsh-agent` → `dsh-agent-loop`（deps 含 `dsh-llm`）→ `dsh-llm` → `dsh-llm-deepseek`。全部 hoisted 到 `~/.dsh/profiles/web/node_modules/@deepseek-ai/`。

**插件 vs 核心依赖（关键差异）**
- **插件可 fork**：`@local/dsh-btw` / `@local/dsh-wallpaper` 放在 `~/.dsh/profiles/node_modules/@local/`，由 `~/.dsh/profiles/web/cordis.patch.yml` 的 `- insert: {id: btw, name: '@local/dsh-btw'}` 装载（`cordis.patch.yml:15-17,21-24`）。这是 **cordis 服务装载**：靠插件自身的 `apply(ctx)`/`inject`/`name` 注册，Node 从 `node_modules/@local/` 按名字解析。→ **任何"可插拔 seam"都能走这条路**，包括新写一个 subagent provider（`ctx.subagents.registerProvider`）。
- **核心 ESM 依赖不能走 cordis patch**：`dsh-agent-loop`/`dsh-llm`/`dsh-llm-deepseek` 是被 `import "@deepseek-ai/..."` 引用的普通模块，靠 Node 模块解析（hoisted node_modules），cordis patch 的 `insert` 只装载"服务插件"，管不到 import 重定向。要覆盖它们只能：① package.json `pnpm.overrides`（指向 `file:` fork）→ **需要重跑 `pnpm install`，而本 checkout 的 pnpm install 已知会失败且损坏 node_modules**（上一子代理实测：`verify-deps-before-run` 触发自动 install，把 `@deepseek-ai/*` 移进 `node_modules/.ignored/`，失败点在 `dsh-client-ui-settings` registry 解析）；② 直接改 `~/.dsh/profiles/web/node_modules/@deepseek-ai/<pkg>/lib/`（立即可用但 npx 缓存/重装会覆盖、不可回滚）。

**可行性判定 #3（fork 核心包）：不可行（pnpm overrides 路径当前断裂）。** 结论：**凡需要改核心 ESM 包的改动（路线 A、以及"在 dsh-agent-loop 里加 stream 开关"）当前都缺一个可回滚的覆盖机制**；除非走"直接改 node_modules + git 备份 + 文档记录回滚步骤"。而**走可插拔 seam 的改动（新 worker provider、路线 B 若可封装成 provider 级改动）可以用 @local + cordis patch 干净落地**。

---

## 二、Feasibility（三改动评级）

| # | 改动 | 评级 | 最小改动面 | 阻塞点 |
|---|---|---|---|---|
| ① | 子代理 worker_threads | **低-中** | 新写 `@local/dsh-subagent-worker-thread` provider（cordis 插件可 fork）；但 worker 内要重建 agent 运行时（cordis context + llm + session + 工具） | 无现成"agent 在 worker 内跑"的运行时；workflow worker 只是脚本代理，不能照搬；收益存疑（loop 轻，重头在 LLM 流式 + session append，见 ②） |
| ②a | LLM wire 非流式（字面） | **中** | `dsh-llm-deepseek`(stream:false+JSON 解析) + `dsh-llm`(complete()) + `dsh-agent-loop`(子代理路径调 complete) | 3 个核心 ESM 包，fork 需 pnpm overrides（当前断裂） |
| ②b | LLM 结果非流式落盘（buffer 后单条 append） | **高** | 只改 `dsh-agent-loop/lib/index.js:617-622`（约 5 行） | 仍属核心 ESM 包 `dsh-agent-loop`；但改动极小，可用"直接改 + git 备份"落地 |
| ③ | fork 核心包到 @local | **不可行**（当前） | pnpm overrides/patchedDependencies | `pnpm install` 已知失败并损坏 node_modules |

---

## 三、Plan（建议路线，待用户裁决）

**现实组合（推荐，命中"卡顿"根因且可落地）：**
1. **②b 优先**：`dsh-agent-loop` 的 stream 消费处改「buffer → 单条 `assistant/message` append」，把 N 条 `assistant/chunk` append 压成 1 条。这是「流式写入」I/O 的直接削减，只改 1 函数。落地方式：**直接改 `~/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js` + 先 `cp -r` 备份原目录 + 记录回滚命令**（pnpm overrides 不可用时的唯一可回滚手段）。
2. **① 降级**：不做「完整 agent loop 进 worker」（改动大、收益存疑），改为**只把可插拔的 provider 层换成 worker 编排**——若用户坚持 worker_threads，可新写 `@local/dsh-subagent-worker-thread` 走 `registerProvider`，但 worker 内仍需 bootstrap 运行时，工程量大，建议先上 ②b 实测 I/O 削减效果再决定是否投入。
3. **②a 作为可选项**：若 ②b 后仍卡，且用户要严格「wire 非流式」，再评估直接改 `dsh-llm-deepseek`（单包、单函数加 `stream:false` JSON 分支）——改动集中、可备份回滚。

**验收标准（②b）**
- 子代理一次 turn 的 `assistant/chunk` 事件数降为 0，`assistant/message` 仍 1 条；文本/reasoning/tool-call 内容与改造前逐字一致。
- 主会话与 btw 的流式体验**不受影响**（改动必须只命中子代理路径，或确认主会话也接受非流式落盘）。
- 多子代理并发时，`dsh-session-persistence-jsonl` 的 append 批次数显著下降（用现有 telemetry 或 `strace -c`/日志观测）。
- 回滚 = 还原备份目录；重启 DSH 后行为恢复。

---

## 四、Units（细粒度交付单元）

### U1（②b 核心，唯一必须单元）
- **文件**：`~/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js`（`step()`，约 L606-655）
- **函数**：`step(assembly)` 的 `while(true)` 块内 LLM 消费段（L617-622）
- **改动**：把 `for await (chunk of stream)` 里的 `this.session.append("assistant/chunk", ...)` 去掉（chunk 只 `assembler.push(chunk)`，不 append）；保留结束后 L651 的 `this.session.append("assistant/message", ...)`。注意保留 `interrupted` 分支（L625-642）在中断时仍要用 assembler 已有块补 `assistant/message`。
- **验收**：一次 turn 0 条 `assistant/chunk`、1 条 `assistant/message`；`foldConsumedWork`/`finalAssistantOutput`（`dsh-subagent-in-process-driver` 读结果用）仍能拿到输出；主会话文本/reasoning/tool-call 不变。

### U2（路径隔离，随 U1）
- **文件**：同上 `dsh-agent-loop/lib/index.js`（`buildRequest`/`step` 上下文）
- **改动**：确认/加一个「本 agent 是否子代理」的判定（`this.options` 或 session meta 里的 subagent 标记），确保 U1 的非流式落盘**只作用于子代理**，主会话/btw 仍流式 append（若用户要求主会话也非流式则此单元可省略）。
- **验收**：主会话 GUI 打字机效果不变；子代理侧无逐 chunk append。

### U3（备份与回滚 Runbook，前置）
- **文件**：`~/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-agent-loop/` 目录
- **改动**：`cp -r dsh-agent-loop dsh-agent-loop.orig-<date>`；记录回滚命令 `rm -rf dsh-agent-loop && mv dsh-agent-loop.orig-<date> dsh-agent-loop`。
- **验收**：回滚命令可一键执行并恢复原行为。

### U4（可选，① worker_threads provider 骨架）
- **文件**：新包 `~/.dsh/profiles/node_modules/@local/dsh-subagent-worker-thread/`（`lib/index.js` + `package.json` + `cordis.patch.yml` 登记）
- **改动**：`registerProvider` 一个 name=`spawn-worker` 的 provider，`start()` 先 `new Worker(...)` 起 worker；worker 内后续再补 agent 运行时（本单元只搭骨架 + 消息协议，先不跑完整 loop）。
- **验收**：`ctx.subagents` 出现 `spawn-worker` provider；`subagent` 工具配 `provider: spawn-worker` 能 start 并回传占位结果；不破坏原 `spawn`/`fork`。

### U5（可选，②a wire 非流式）
- **文件**：`~/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-llm-deepseek/lib/index.js`（buildRequest + 响应解析）
- **改动**：加 `stream:false` 请求分支 + 单 JSON 响应 → 转成等价单个 StreamChunk/block；`dsh-agent-loop` 调用侧改非流式消费。
- **验收**：一次 HTTP 往返返回完整 response；文本/reasoning/usage/tool-call 与流式结果一致；错误码（STREAM_CLOSED 等）路径对应改写。

---

## 五、风险与裁决点（交主 agent）
1. **① worker_threads 的真实收益需先验证**：agent loop 本身轻，CPU 争抢主要来自 LLM 流式解析 + 逐 chunk session append（②）与工具子进程。**建议先上 ②b 实测**，再决定要不要投入 ① 的大工程。
2. **核心 ESM 包 fork 当前断裂**：pnpm overrides 依赖 `pnpm install`，而 install 已知失败损坏 node_modules。→ 凡改 `dsh-agent-loop`/`dsh-llm`/`dsh-llm-deepseek` 只能"直接改 + 目录备份 + 回滚 Runbook"。
3. **②a 与 ②b 二选一需用户裁决**：②b（loop 层缓冲）最小、命中 I/O 根因但 wire 仍流式；②a（wire 非流式）贴合字面但牵 3 个核心包。已用问答题工具上报，等用户拍板。
