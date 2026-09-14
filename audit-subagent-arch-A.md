# 审计：子代理改 worker_threads + LLM 非流式输出 可行性基线

日期：本次会话。范围：只审计、只出方案，不改包代码。
核心包根：`~/.dsh/profiles/web/node_modules/@deepseek-ai/`（下文记 `@ds`）。

---

## 一、Facts（三问逐条，file:line 证据）

### Q1. 子代理驱动流程（进程内）

文件：`@ds/dsh-subagent-in-process-driver/lib/index.js`

- L160 `async function startInProcessRun(request, options)` — 子代理唯一启动入口。
- L179 `return drivePublishedRun(await parent.ctx.agents.create({...}))` —— **关键**：子代理
  是通过 `parent.ctx.agents.create()` 在**父代理同一个 Cordis context** 里创建的（进程内）。
- L181 `meta: childSessionMeta(parent, childDepth, activationBoundary)` 子会话元数据。
- L183 `agentOptions: resolveChildAgentOptions(parent, request.agentOptions, childDepth)`。
- L192-226 `drivePublishedRun`：
  - L204 `child.followup(createUserMessage({content: prompt, ...}))` 注入用户 prompt。
  - L208 `await child.whenIdle()` 等 agent loop 跑完。
  - L210 `readResult(child, boundary, ...)` 从 session.events 读结果。
- L228-249 `readResult`：`foldConsumedWork(own)` + `finalAssistantOutput(own)` 从子会话事件
  汇总最终文本。

结论：**agent loop 与父会话同事件循环**。`ctx.agents.create` 需要完整 Cordis context
（工具、LLM、session、persistence 服务都挂在这个 ctx 上），没有任何跨线程/跨进程边界。

**worker_threads 可行性判断**：
- worker_threads 只能通过 structured clone / SharedArrayBuffer / MessagePort 传数据，
  **不能共享 Cordis context**（ctx 含活的 service 对象、事件发射器、SQLite/文件句柄，
  均不可序列化）。
- 因此「把 loop 挪进 worker」等价于二选一：
  1. worker 内**重新 bootstrap 一个完整 Cordis context**（重载 profile/插件）——极重，
     且 session/persistence 会重复实例化、并发写冲突；
  2. worker 内跑**最小 agent loop**（只做 prompt 渲染 + LLM 调用 + 工具调用渲染），
     把「工具执行」和「session 事件持久化」经 MessagePort **代理回主线程**——这是唯一
     现实路径，但仍是大改。

**评级：需大改**。最小改动面（新驱动）：
- 新包 `@local/dsh-subagent-worker`（替代 in-process-driver 的调用侧）：
  - 主线程：把 `request`（prompt、persona、toolFilter、outputSchema、agentOptions、seed）
    序列化后 `new Worker(...)` 发过去；
  - worker：最小 loop（复用 dsh-agent-loop 的 prompt 渲染 + llm 调用，但不挂 session/tools）；
  - MessagePort 协议：`tool/call`（worker→主，主执行 `ctx.tools` 后回 `tool/result`）、
    `chunk`/`message`（worker→主，主持久化到子 session）、`done`（worker→主，带回结果）。
- 需跨边界的对象：工具 schema（可序列化 JSON）、LLM 配置（provider/model 字符串 + key）、
  system prompt 字符串。**不可跨边界**：ctx、工具执行器、session、DB 句柄。

### Q2. LLM 流式调用点

文件：`@ds/dsh-agent-loop/lib/index.js`

- L613 `const { request, preparedCall } = await this.buildRequest(turn, step, assembly.tools, system, this.session.deriveMessages(), signal);`
- L617 `const stream = preparedCall?.stream(request) ?? this.loopCtx.llm.stream(request);`
- L619-627 `for await (const chunk of stream) { chunkSeqs.push(this.session.append("assistant/chunk", {turn, step, chunk}).seq); assembler.push(chunk); }`

即：**loop 无条件走流式**，每个 chunk 都 `session.append("assistant/chunk", ...)`（这就是
「流式写入」的事件来源——每 token 一条事件 + 持久化）。

文件：`@ds/dsh-llm-deepseek/lib/index.js`（实际 LLM adapter，DeepSeek 网关）

- L239 `stream: true,`
- L240 `stream_options: { include_usage: true },`
- L250 注释 `Build the full wire request. Always streaming (stream: true, usage ...)`
- L1380 `stream: (options) => this.streamWithConnection(options, connection)`

即：**adapter 硬编码 `stream: true`，无 `stream: false` 分支**；LLM 服务 `@ds/dsh-llm`
只暴露 `stream()`（`lib/types/index.d.ts` L107/L114/L168），无非流式 `generate()`。

**主/子代理区分依据**：文件 `@ds/dsh-subagent/lib/index.js`
- L486-490 `resolveChildDepth(parent, maxDepth)`：`delegationDepthOf(parent) + 1`。
- L501-510 `resolveChildAgentOptions`：把 `subagentDepth: childDepth` 写进 agentOptions。
- L530-538 `childSessionMeta`：写 `delegationDepth: childDepth`。
即：子代理的 `agentOptions.subagentDepth > 0` 且 session meta `delegationDepth > 0`，主会话为
0/缺省。agent-loop 的 `buildRequest`/`step` 可读 `this.session.header` 或 agentOptions 判定。

**非流式可行性判断：可行（中等改动）**，三层：
1. `dsh-llm-deepseek`：加 `stream: false` 分支——请求 body `stream:false`，响应为单个 JSON
   （choices[0].message.content），转成**一条** `text-delta` chunk（或直接 message）。
2. `dsh-agent-loop.step()`：加非流式分支——若子代理（depth>0），走非流式，把完整文本
   一次性 `session.append("assistant/message", ...)`，跳过 `assistant/chunk` 逐条 append。
3. 判定开关：loop 里读 `delegationDepth`/`subagentDepth > 0`。
只改子代理路径：主会话/btw 的 `delegationDepth === 0` 仍走流式，互不误伤。

### Q3. 包解析与 fork 机制

文件：`~/.dsh/profiles/web/package.json`
- dependencies 仅两项：`@deepseek-ai/cordis-plugin-group` + `@deepseek-ai/dsh`（`^0.1.1-rc.2`）。
- **无 `overrides` 字段**。
- 子代理/agent-loop/llm 相关包都是 `@deepseek-ai/dsh` 的**传递依赖**。

布局证据：
- `~/.dsh/profiles/web/package-lock.json`（320628 B）+ `node_modules/.package-lock.json`
  （291469 B）→ **npm 平铺布局**（非 pnpm：无 `.modules.yaml`、无 `.pnpm/` store）。
- `@ds/dsh` 是真实目录（非符号链接）。
- 插件 `@local/dsh-btw` / `@local/dsh-wallpaper` 位于
  `~/.dsh/profiles/node_modules/@local/`（**注意：在 `profiles/` 下，不是 `profiles/web/` 下**）。

插件 vs 核心依赖的覆盖机制差异（关键）：
- **插件（btw/wallpaper）**：经 `~/.dsh/profiles/web/cordis.patch.yml` 的
  `insert: [{id: btw, name: '@local/dsh-btw'}]` 由 **Cordis loader** 按 `name` 解析，
  loader 把 `~/.dsh/profiles/node_modules` 纳入解析路径 → `@local/` 从 profiles 下解析。
- **核心包（dsh-subagent / dsh-agent-loop / dsh-llm-deepseek）**：是 `@deepseek-ai/dsh` 的
  传递依赖，由 **Node 标准模块解析**从 `profiles/web/node_modules/@deepseek-ai/` 解析，
  **不走 Cordis loader 的 name 解析**，`@local/` 覆盖不了它们。

因此核心包 fork 只有三条路（评级）：
1. **npm `overrides` + 重装**（推荐，最正规可回滚）：在 `profiles/web/package.json` 加
   `"overrides": {"@deepseek-ai/dsh-subagent": "file:../node_modules/@local/dsh-subagent", ...}`
   然后 `npm install`。风险：dsh CLI（`npx @deepseek-ai/dsh`）是否每次启动 `npm install`
   会覆盖该字段/重装——**未在本轮核实**（`@ds/dsh/bin.js`、`profile-boot-*.js` 里 grep 不到
   install/npm 字样，疑似安装逻辑被打包进压缩产物或由 npx 外层完成，需执行档实测）。
2. **直接替换/符号链接 `profiles/web/node_modules/@deepseek-ai/dsh-XXX`**（快、可备份回滚）：
   先 `cp -r` 备份原包，再把 fork 覆盖进去或软链到 `@local/` fork。风险同上：重装会被覆盖。
3. **原地改 `profiles/web/node_modules/@deepseek-ai/` 原包**（最快，无隔离、重装必丢）。

**建议**：路径 1（overrides）优先；若 dsh CLI 实测每次启动都 `npm install` 且会抹掉
overrides，则退到路径 2（备份 + 覆盖 + 软链），并在 `cordis.patch.yml` 里不改（核心包不进
patch 层）。

---

## 二、Feasibility 汇总

| 改动 | 评级 | 最小改动面 | 主要风险 |
|---|---|---|---|
| ① 子代理 → worker_threads | **需大改** | 新驱动 `@local/dsh-subagent-worker` + MessagePort 协议（prompt/工具 schema/LLM 配置入，tool/call·chunk·done 出），主线程代理工具执行与 session 持久化 | 边界协议复杂、工具执行要跨线程代理、session/persistence 并发；收益受制于 LLM 本身是 I/O 绑定（远程推理），本地 CPU 省的是 prompt 渲染 + chunk 解析 |
| ② LLM 非流式 | **可行（中等）** | `dsh-llm-deepseek` 加 `stream:false` 分支 + `dsh-agent-loop.step()` 加子代理非流式分支（一次 `assistant/message` 替代逐 `assistant/chunk`） | 需正确区分 depth>0，且非流式失去「边生成边看」的流式体验（子代理场景可接受） |
| ③ fork 核心包到 @local | **可行** | npm `overrides` + 重装（或备份+覆盖+软链） | dsh CLI 重装行为未核实，可能覆盖 overrides/软链 |

**关键洞察（供裁决）**：真正高发的事件风暴来自 Q2 的 L621——loop 每收到一个 token chunk 就
`session.append("assistant/chunk")`，而子代理生成大量 token 时这会产生海量事件 + 逐条
持久化。**先做 ②（LLM 非流式）成本低、直接砍掉逐 token 事件流，可能比 ① 的收益更直接**；
① 是 CPU 隔离，但 LLM 推理在远端、工具执行在子进程/fs，本地 CPU 争抢的实际占比需实测。

---

## 三、Plan（修订后落地方案）

分两条独立可交付线，各自 fork 到 `@local/`：

### 线 B（先做，低风险）：LLM 非流式
1. fork `dsh-llm-deepseek` → `@local/dsh-llm-deepseek`：加 `stream: false` 请求分支
   （`stream:false` body + 解析单 JSON → 合成单 `text-delta` chunk）。
2. fork `dsh-agent-loop` → `@local/dsh-agent-loop`：`step()` 里加非流式分支——
   读 `delegationDepth`/`subagentDepth`，`>0` 时走非流式，一次性 append `assistant/message`。
3. 覆盖机制：web/package.json `overrides`（或备份+覆盖）把这两个包指到 @local/ fork。

### 线 W（后做，大改）：worker_threads 驱动
1. 新包 `@local/dsh-subagent-worker`：主线程侧 `startWorkerRun(request)` +
   worker 侧最小 loop + MessagePort 协议。
2. 替换 `dsh-subagent-in-process-driver` 的调用（或在 preset agentOptions 层切换 provider）。
3. 工具执行、session 事件、结果都经 MessagePort 回主线程。

验收标准（两条线公共）：
- 子代理能跑完一次完整调研并返回结果，主会话不卡死。
- 子代理 LLM 调用非流式（抓请求 body `stream:false` 或日志确认无逐 chunk 事件）。
- 主会话 / btw 仍流式（回归验证：主对话逐字输出、btw 思考链仍流式）。
- fork 可回滚（删 overrides/还原备份即恢复原包）。
- 三阶段闭环：审计（本文件）→ 修订并执行 → 复核。

---

## 四、Units（细粒度交付单元）

### 线 B（LLM 非流式）
- **B1** 文件 `dsh-llm-deepseek/lib/index.js` 函数 `buildRequest`/`streamWithConnection`：
  加 `stream:false` 分支；改动=请求 body 条件化 + 非流式 JSON 响应解析；验收=非流式请求返回单条完整文本。
- **B2** 文件 `dsh-agent-loop/lib/index.js` 函数 `step()`（L613-627 附近）：
  加非流式分支；改动=检测 depth>0 后调非流式、一次性 `session.append("assistant/message")`；验收=子代理不再产生逐 `assistant/chunk`。
- **B3** 文件 `dsh-agent-loop`/`dsh-llm` 判定开关：读 `delegationDepth`/`subagentDepth`（核实 loop 可访问该字段，若不可访问则经 `buildRequest` 注入 `nonStream` 标记）；验收=主会话 depth=0 走流式、子代理 depth>0 走非流式。
- **B4** 覆盖机制：web/package.json `overrides`（或备份+覆盖）指向 `@local/` fork；验收=重启后 `@local/` fork 生效、删 overrides 可回滚。

### 线 W（worker_threads 驱动）
- **W1** 新包骨架 `@local/dsh-subagent-worker`：主线程 `startWorkerRun` 序列化 request + 起 worker；验收=能起 worker 并收到 ack。
- **W2** MessagePort 协议：`tool/call`↔`tool/result`、`chunk/message`、`done`；验收=工具调用往返正确、结果回传。
- **W3** worker 内最小 loop（复用 prompt 渲染 + LLM 调用，去掉 session/tools 直连）；验收=worker 内能完成一次 LLM 往返。
- **W4** 替换 in-process 调用侧 + 回滚；验收=子代理跑通、主会话/持久化正常。

---

## 五、风险与未核实项
1. **dsh CLI 重装行为未核实**：`npx @deepseek-ai/dsh web` 是否每次启动 `npm install` 并覆盖
   overrides/软链，需执行档实测（`@ds/dsh/bin.js`、`profile-boot-*.js` 未 grep 到 install 字样，
   疑为打包进压缩产物或由 npx 外层处理）。
2. **worker_threads 实际收益待实测**：LLM 推理在远端（I/O 绑定），本地 CPU 争抢占比未知；
   若本地 CPU 主要来自 chunk 解析，则 ② 非流式已能大幅缓解，① 的投入产出需再评估。
3. **判定字段可访问性**：agent-loop 内能否直接读 `delegationDepth`/`subagentDepth` 未亲测，
   若不可则需经 `buildRequest` 注入，属 B3 单元内的技术风险。
