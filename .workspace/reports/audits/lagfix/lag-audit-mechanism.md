# lag-audit-mechanism：subagent 多开卡顿 机制级根因诊断（只读审计）

> 审计对象：当前运行中的 DSH（:3080，43 个客户端插件，boot rev `fce6c22da523`）。
> 审计原则：全部结论基于真实代码/运行态文件 + 行号证据；不确定项标「未确认」；只读（未改任何文件，唯一落盘为本报告）。
> 审计时间：2026-09-12。
> 运行解析根（实测）：`~/.npm-global/lib/node_modules/@deepseek-ai/dsh`（v0.1.1-rc.2）及其嵌套 `node_modules/@deepseek-ai/*`。`~/.dsh/profiles/web/node_modules` 现为**空目录**（2026-09-12 14:44），`~/.dsh/profiles/node_modules/@deepseek-ai/*` 均为指向上述全局树的符号链接（09-12 14:56 重装后建立）。

---

## 0. 结论摘要（先看这里）

1. **当前生效的 subagent 执行驱动 = in-process（同进程、同事件循环）**，证据链完整（§1）。`spawn` / `fork` 两个 provider 都是 `dsh-subagent-in-process-driver` 的实现；子代理经 `parent.ctx.agents.create()` 在父代理同一个 Cordis context 里创建，与主会话共享一个 Node 事件循环。
2. **「worker 独立线程」机制在部署中从未存在**（§4）：`@deepseek-ai/dsh-subagent-worker-driver` 在 npm registry 直接 404，0.1.1-rc.2 与 0.1.5-rc.2 两棵安装树都没有；历史审计只做了可行性评估（需大改/收益存疑），从未实现。**用户假设的「worker 线程被升级/回退覆盖丢失」证伪**——不可能丢失一个从未存在的东西。
3. **「subagent 非流式落盘」机制确实存在过、且确实被清除了**（§4/§5）：2026-09-08 落地过 ②b 补丁（`execution-2b.md` 权威记录：`dsh-agent-loop` 两行改动 + 备份 `dsh-agent-loop.orig-20260908/`），2026-09-12 回退/重装时随「旧 profile 真实目录被替换为指向全新全局树的符号链接」整体消失（live 树 grep `isSubagent` = 0 命中，备份目录不存在）。**用户假设的「非流式写入丢失」证实（机制半对）**。
4. **卡顿因果链**（§3）：in-process 驱动让 N 个子代理的 agent-loop 与主会话挤在同一事件循环；agent-loop 对每个 token 无条件 `session.append("assistant/chunk")`（流式写入），每个 append 同步做深拷贝 + surface 校验 + 全 observer 分发，其中 host-apiproxy 的 SSE mux 把**每一个子代理的每一个 chunk 事件**推给每个已连接浏览器（无会话过滤、无界队列无背压）。多开放大 = N×K 全部线性叠加在同一线程 + N 条持久化写链（每 200ms 一批 zstd+fsync）+ 线程池争抢 + 浏览器 N 面板重渲染。
5. **最小修复点**（§6）：恢复 ②b（对 live 解析根的 `dsh-agent-loop/lib/index.js` 重放两行补丁 + 目录备份）；可选加固 mux 订阅过滤与 FrameQueue 有界化；worker_threads 方向不建议投入。

---

## 1. 当前生效的 subagent 执行驱动：in-process（证据）

### 1.1 驱动选择机制：provider 按 name 字符串从注册表取，注册的只有 in-process 实现

- `dsh-subagent/lib/index.js`
  - **L2382** `providers = /* @__PURE__ */ new Map();`
  - **L2570** `registerProvider(provider)`（把 provider 实例登记进 Map）
  - **L2587** `getProvider(name)`（按名字取）
  - **L2607** `async start(name, request)`；**L2621** `return observeRun(this.emitLifecycle, name, request.parent, await provider.start(resolved));` —— 执行入口就是「按名字取 provider → 调它的 `start()`」。**没有任何 worker/线程/进程分支**。
- provider 的两个现实实现（**都是 in-process**）：
  - `dsh-subagent-spawn-in-process/lib/index.js`（44 行全文）：**L11** `name = "subagent-spawn-in-process"`；**L13** `Config = z.object({ providerName: z.string().default("spawn") })`；**L33-35** `start(request) { return startInProcessRun(request, {}); }`；**L40-42** `apply(ctx, config)` → `ctx.subagents.registerProvider(new SpawnInProcessProvider(config.providerName))`。文件头注释（L5-9）自述：“runs each child as a fresh child Agent on the **same cordis context**”。
  - `dsh-subagent-fork-in-process/lib/index.js`（34 行）：**L46** `start(request)`（fork 同样走 in-process driver，仅 seed 语义不同）。
  - 二者都从 `@deepseek-ai/dsh-subagent-in-process-driver` import `startInProcessRun`（spawn L2）。
- `dsh-subagent-in-process-driver/lib/index.js`（机制核心）：
  - **L160** `async function startInProcessRun(request, options)`
  - **L179** `return drivePublishedRun(await parent.ctx.agents.create({ sessionId: childId, meta: childSessionMeta(...), seed, agentOptions: resolveChildAgentOptions(...), signal, setup }), ...)` —— **子代理在父代理同一个 Cordis context 里创建**（同进程、同事件循环）。
  - **L192-226** `drivePublishedRun`：**L204** `child.followup(createUserMessage({content: prompt, ...}))`；**L208** `await child.whenIdle()`（等子 agent loop 跑完）；**L210** `readResult(...)`。
  - **L228-249** `readResult`：`child.session.events.slice(boundary)` + `foldConsumedWork` + `finalAssistantOutput` 从子会话事件汇总结果。

### 1.2 运行时实际选中的 provider：spawn / fork（preset 配置）

- 工具面：`dsh-tool-subagent/lib/index.js` —— **L23** `provider: z.string().required()`（工具配置必须有 provider 名）；**L262** 背景 continuable 路径 `ctx.subagents.startContinuable({ provider: config.provider, ... })`；**L271** 前台路径 `ctx.subagents.start(config.provider, {...})`。provider 名是纯配置字符串，**不存在「自动回退到 worker」之类的逻辑**。
- 当前 preset：`~/.dsh/.agent-presets/standard-glm/agent.cordis.yml`
  - **L189** `provider: spawn`（tool-subagent，`backgroundMode: continuable`）
  - **L200** `provider: fork`（tool-subagent-fork，`backgroundMode: continuable`）
  - **L216 / L225** `provider: codex` / `provider: claude-code` —— **disabled: true**（生产 dsh 不装可选 provider）
  - **L233** `workflow-worker-thread` 的 `provider: spawn`（注意：这是 workflow 编排脚本的 worker，**不是**子代理 agent-loop 的 worker，见 §4.2）
  - preset 注释：“The `subagents` registry and its spawn/fork backends live in the HOST composition”——即 spawn/fork 就是全部。
- 0.1.5-rc.2（web2）同款：`web2/node_modules/@deepseek-ai/dsh-agent-presets/presets/standard/agent.cordis.yml` **L184/L196** 也是 `provider: spawn` / `fork`。**0.1.5 同样没有 worker 驱动**。

### 1.3 配置/环境键：不存在驱动选择开关

- `~/.dsh/settings.yaml`：grep `subagent|persistence|worker|packChunks|stream` = **0 命中**。只有 `ui-onboarding` / `llm-deepseek` / `llm-pi-ai` / vision 相关段。
- `~/.dsh/profiles/web/cordis.patch.yml`：只有 vision-adam、agent-presets default、taste、btw、wallpaper 与 4 条 disable（wallpaper/vision-adam/subagent-model-selection-settings/taste），无任何 subagent 驱动配置。
- 结论：**没有任何 config/env 键可以在 in-process 与 worker 之间切换，因为 worker 驱动根本不存在**。

### 1.4 运行态直接观察（受限，如实记录）

- 沙箱为 bwrap PID namespace（`--unshare-pid`），`ps`/`/proc` 只能看到沙箱自身进程，**无法直接观察 host dsh 进程的线程/子进程数**——本项「未确认（无法观察）」，改用间接证据：
  - `GET http://127.0.0.1:3080/` → **HTTP 200**（进程存活）。
  - `GET /api/events.mux`、`/api/events.host` → **HTTP 426**（路由存在、要求升级握手；非 404 → 浏览器 SSE 事件链已挂载）。
  - `~/.dsh/profiles/web` 的 `require.resolve('@deepseek-ai/dsh/package.json')` → 全局树（`~/.npm-global/lib/node_modules/@deepseek-ai/dsh`）→ 运行实例解析根 = 全局树（与 §0 一致）。
  - boot dump（`.workspace/.tmp-boot3080.html`，15:02 实抓）：43 个客户端插件条目，含 `@local/dsh-btw`；`dsh-client-runtime`、`dsh-client-modules`、`dsh-api-gateway`、`dsh-api-remotes`、`dsh-typert-registry` 均为 `immediately: true` —— 与「apiproxy mux 事件链在线」一致。
- 判定：运行态与静态证据一致 —— **当前生效驱动 = in-process**。

---

## 2. 子代理输出写入机制：流式（逐 token append），非流式补丁已被清除

### 2.1 流式写入是硬编码、全栈只有 stream

- `dsh-agent-loop/lib/index.js`（live 树）：
  - **L617** `const stream = preparedCall?.stream(request) ?? this.loopCtx.llm.stream(request);`
  - **L619-627** `for await (const chunk of stream) { signal.throwIfAborted(); chunkSeqs.push(this.session.append("assistant/chunk", { turn, step, chunk }).seq); assembler.push(chunk); }` —— **每个 token chunk 同步 append 一条 `assistant/chunk` 事件**（逐 token 事件 + 深拷贝 + observer 分发 + 持久化批）。
  - **L673-681** 一轮结束才 append 一条 `assistant/message`（带 `sourceEventSeqs: chunkSeqs`）。
  - 该文件当前**无 `isSubagent` 判定、无缓冲分支**（`grep isSubagent` = 0 命中）——原生流式版。
- `dsh-llm-deepseek/lib/index.js`：**L239** `stream: true,`、**L240** `stream_options: { include_usage: true },`；**L250** 注释 “Always streaming (`stream: true`, usage reporting on)”——适配器无 `stream:false` 分支。
- `dsh-llm/lib/types/index.d.ts`：服务只暴露 `stream()`（**L107 / L114 / L168**），无 `generate()/complete()` 非流式 API。
- `session.append` 的同步成本（`dsh-session/lib/index.js`）：**L1450** `snapshotJsonValue(data)`（每 chunk 深拷贝）、**L1457** `deepFreeze(...)`、**L1464** `surfaceManager.validateNext(event)`、**L1476** `invokeContainedSessionObservers(...)`（同步分发 `session/event` 给全部 observer）——**每个 token 一次**。

### 2.2 持久化写路径（每会话 200ms 批 + zstd + fsync，N 会话并发）

- `dsh-session-persistence/lib/index.js`（PersistenceCoordinator）：
  - **L780-783** `chains = new Map()` —— **按会话 id 串行化**（同一会话的写不交错，不同会话并行）。
  - **L436** `const DEFAULT_WRITE_BATCH_MAX_DELAY_MS = 200;`、**L788** 默认 `writeBatchMaxDelayMs: 200` —— 每会话 200ms 写批窗口。
  - **L824-840** `append(id, events)` → `serialize(id, ...)` → `backend.appendBatch(state.meta, events, materialized)`。
- `dsh-session-persistence-jsonl/lib/index.js`：
  - **L1200-1227** `appendLines`：`open(path, "a")` + `handle.writeFile(content)` + **`handle.sync()`（每次批 fsync）**；失败截断回滚（L1228-1236）。
  - **L732** `DEFAULT_PACK_CHUNKS = true` —— 存储层把 chunk 打包成行（降存储行数），但**内存日志与 observer 分发仍逐 chunk**（§2.1），mux 帧也逐 chunk（§3.2）。
  - zstd 压缩：`compressZstdFrame`（L572-573，promisify 的 `zstdCompress` → libuv 线程池）。

### 2.3 「非流式落盘（②b）」补丁：曾经存在 → 已被清除

- **存在证据**（工作区根 `execution-2b.md`，2026-09-08，含独立复核 PASS）：
  - 改动 2 处，落在 `~/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js`：
    1. `step()` L611 后新增 `const isSubagent = (this.options.subagentDepth ?? 0) > 0 || (this.session.header?.delegationDepth ?? 0) > 0;`
    2. L621 逐 chunk append 条件化：`if (!isSubagent) chunkSeqs.push(this.session.append("assistant/chunk", {...}).seq);`
  - 备份：`dsh-agent-loop.orig-20260908/`（完整目录拷贝，回滚 Runbook 在 execution-2b.md L26-31）。
  - 效果（原文）：子代理（delegationDepth>0）不再逐 token 写 `assistant/chunk`，一轮只写 1 条 `assistant/message`；主会话/btw（depth=0）仍流式。
- **当前缺失证据**：
  - live 树 `dsh-agent-loop/lib/index.js`：`grep -n isSubagent` = **0 命中**；L619-627 为无条件逐 chunk append（§2.1）。
  - 备份目录 `find ~/.dsh ~/.npm-global -name 'dsh-agent-loop.orig*'` = **无残留**。
  - web2（0.1.5-rc.2）的 `dsh-agent-loop`：`grep isSubagent` = 0 命中（0.1.5 侧也从没打过）。
- **丢失机制**（mtime 证据链）：
  - 09-08 运行树是 `profiles/web/node_modules/@deepseek-ai/` **真实 npm 平铺目录**（audit-subagent-arch-A §Q3：“`@ds/dsh` 是真实目录（非符号链接）”），②b 补丁与备份就在其中。
  - 09-12 14:44：`profiles/web/node_modules` 被清空（现为空目录，mtime 14:44）。
  - 09-12 14:56：`~/.npm-global/lib/node_modules/@deepseek-ai/dsh` 全新重装（**全部包 mtime 14:56**，无任何 `.bak/orig` 残留）；`profiles/node_modules/@deepseek-ai/*` 全部变为指向该全局树的符号链接；`~/.npm-global/bin/dsh` 链接也更新于 14:56。
  - 结论：回退/重装把「旧真实目录（含补丁与备份）」整体替换为「指向全新全局树的链接农场」，②b 补丁随旧目录消失。当前 :3080 解析根 = 全新全局树 → **回到原生流式写入**。

---

## 3. 卡顿因果链（多开放大机制）

### 3.1 第一环：in-process 驱动 → N 个子代理与主会话挤在同一事件循环

- `dsh-subagent-in-process-driver` L179：子代理 = `parent.ctx.agents.create(...)`，同 ctx、同事件循环、无线程/进程隔离。
- 每个子代理跑完整 `dsh-agent-loop`（L606 step 的 `while(true)`：buildRequest → LLM stream → 工具执行 → 循环），所有 N 条流的 **SSE 解析（llm-deepseek `parseSse`/`translateSse`）在主线程执行**。
- 每步 `buildRequest` 还做 `this.session.deriveMessages()`（agent-loop L613；dsh-session L1543）——按日志长度折叠上下文，长日志子代理每步成本 O(事件数) 上升。
- 多开放大：N 条流 × K 个 token，全部线性叠加在一个线程；子代理还有 `maxDepth: 3`（tool-subagent L37）可树状再派生。

### 3.2 第二环：每 token 同步 append 链（事件风暴源头）

- agent-loop **L621** 每 chunk 一次 `session.append` → dsh-session **L1450-1476**：深拷贝 + surface 校验 + 全 observer 同步分发。每个 observer 都被 N×K 次调用：
  - 投影驱动：`dsh-session-projection/lib/index.js` **L47-50** `ctx.on("session/event", ...)` → `this.drive(session, event)`。
  - SSE mux：host-apiproxy **L3556-3574**（见 3.3）。
  - 持久化 coordinator：`dsh-session-persistence` L824（200ms 批）。
  - 子代理生命周期：dsh-subagent L2621 `observeRun`。

### 3.3 第三环：SSE mux 帧风暴（浏览器路径，无会话过滤、无界队列）

- `dsh-host-apiproxy/lib/index.js`：
  - **L1672** `const muxQueues = new Set()`（每个已连接消费者一个队列）。
  - **L3524-3527** `events.mux()`：新消费者入队 + 对**所有** live session `subscribeSession`。
  - **L3556-3574** `ctx.on("session/event", ...)`：**无会话过滤** —— 每个 live 会话（主会话 + 全部子代理）的**每个事件**都被 `queue.push(frame({type:"session/event", sessionId, event, view}))` 推给**每一个**已连接浏览器；tool/call、tool/result 还会跑 `viewFor`（L1333-1366，调工具 `presentCall/presentResult`）。
  - **L1095-1127** `FrameQueue`：`buffer = []` 无界、`push()` 无背压、无合并 —— 浏览器渲染跟不上时队列无限增长（内存）+ 每帧携带完整事件对象。
- 浏览器侧：`dsh-client-runtime/lib/client.js` **L7463** `case "session/event": this.acceptLiveEvent(frame.event, frame.view)` → Session 对象层 → React store；`dsh-client-ui-subagent` 面板逐帧重渲染。**N 个子代理流式生成时，浏览器每 token 收一帧**（即使主面板没在看该子代理）。
- 实测：live 实例 `/api/events.mux` 返回 426（路由挂载、要求升级握手），该链在运行中。

### 3.4 第四环：持久化 I/O（N 条写链并发）

- 每会话独立 200ms 批（coordinator L780-788）+ 每批 zstd 压缩（线程池）+ **每批 fsync**（jsonl L1213-1214）。
- N 个子代理 = N 条并行写链，每 200ms 最多 N 次 zstd + fsync；libuv 线程池默认 4 线程 → 压缩与文件 I/O 争抢；加上主会话自己的写链。
- `packChunks=true`（L732）已把存储行打包，但**只影响落盘行数，不影响 §3.1-3.3 的逐 token 内存/分发/帧成本**。

### 3.5 第五环：完成期折叠（收尾一次性成本）

- 每个子代理结束：driver `readResult`（L228-249）`events.slice(boundary)` + `foldConsumedWork` + `finalAssistantOutput`，O(该子代理事件数)。多开逐个收尾时叠加。

### 3.6 因果链总结（一句话）

> in-process 驱动（L179）→ N 子代理 agent-loop 与主会话同线程（L606/L617）→ 每 token 同步 `assistant/chunk` append（L621）→ 每 append 深拷贝+surface+全 observer 分发（dsh-session L1450-1476）→ mux 无过滤推帧到每个浏览器（L3556）+ 无界队列（L1095-1127）→ 每会话 200ms 批 zstd+fsync（L780-788/L1200-1227）→ 全部 ×N 线性放大。**「多开」把每 token 的同步成本从 1 份变成 N 份挤在一个线程，并把持久化从 1 条写链变成 N 条并发写链、把 SSE 帧率乘以 N。**

### 3.7 ②b 补丁为何是核心命中点

- ②b 消除的是 §3.2 整条链（每 token 的 append/深拷贝/observer/mux 帧/持久化批）——与审计-A 的“关键洞察”（audit-subagent-arch-A L132-135：“真正高发的事件风暴来自 Q2 的 L621……先做 ② 非流式成本低、直接砍掉逐 token 事件流”）及审计-B 对 ②b 的评级（可行性高、只改 1 函数约 5 行、直接削减流式写入 I/O）一致。它不消除 SSE 解析（§3.1），但消除每 token 的最大同步开销来源。

---

## 4. 用户假设验证

### 4.1 「worker 独立线程」—— 证伪（从未存在，谈不上丢失）

- `@deepseek-ai/dsh-subagent-worker-driver`：`npm view` → **404 Not Found（registry 无此包）**；web（0.1.1-rc.2）与 web2（0.1.5-rc.2）安装树均 MISSING。
- 0.1.1-rc.2 与 0.1.5-rc.2 的 provider 面完全相同：只有 `spawn`/`fork`（in-process）± 可选的 `codex`/`claude-code`（默认 disabled）（§1.2）。
- `dsh-subagent/lib/index.js` 全文唯一 “worker” 字样 = **L2375 设计注释**（“serialization and hostile-input validation belong at real process, worker, …”），不是驱动实现。
- 现存唯一的 worker 机制 `dsh-workflow-worker-thread` **只把编排脚本放进 worker、agent 执行仍在 host**（audit-subagent-arch-B §Q1-B 机制级证伪：`worker.cjs` 只 require `dsh-llm/dsh-session/dsh-tools/dsh-workflow/node:vm`，**没有 `dsh-agent`/`dsh-agent-loop`**）。
- 历史审计结论：audit-subagent-arch-A「线 W：worker_threads 驱动 = 需大改、收益存疑」；audit-subagent-arch-B「① worker_threads 低-中可行性、无现成运行时、**建议先上 ②b 实测再决定是否投入**」。execution-2b.md L49 同样记录“① worker_threads 视 ②b 实测效果再决定”——**从未实现**。
- 判定：**升级/回退不可能“覆盖丢失”一个从未部署的机制**。用户把「审计提案（线 W/①）」与「已部署机制」混淆了。

### 4.2 「subagent 非流式写入」—— 证实（存在过、已丢失、机制半对）

- 存在：execution-2b.md（09-08，复核 PASS）—— ②b 补丁落在运行树的 `dsh-agent-loop`（§2.3）。
- 丢失：09-12 回退/重装把旧真实目录（含补丁与备份）整体替换为指向全新全局树的符号链接（§2.3 mtime 证据链）；live 树已回到原生流式逐 chunk 写入（§2.1）。
- **重要澄清**：丢失与「升级 0.1.5（web2）」本身无直接因果 —— web2 树也从未打过 ②b；丢失发生在**回退时对 web profile 的重装/重建**（14:44 清空 + 14:56 全局重装）。触发因素正确（升级尝试后的回退操作），但机制不是“0.1.5 覆盖了它”，而是“重装重建了运行树，补丁只在旧树上”。

### 4.3 与 lag-audit-diff 审计线交叉核对

- `.workspace/lag-audit-diff.md` **尚未落盘**（本次检查时不存在；该线任务「备份 tgz 内补丁记录」的 tgz 在 `~/.dsh` 亦未找到，仅 `~/.dsh/taste/display.zh.json.migrated-backup-*` 一处备份）——本报告以 `execution-2b.md`（②b 唯一权威执行记录）+ 备份目录全盘搜索（无残留）+ mtime 证据为准；若 lag-audit-diff 结论与本报告冲突，以其盘面为准复核，标「未确认」。
- 「未确认」项清单：① host 进程线程数（沙箱 PID namespace 限制，§1.4）；② 0.1.5 尝试期间旧全局树是否也打过 ②b（无残留物证，按 execution-2b.md 的路径 `profiles/web/node_modules` 判断为否）；③ mux 消费端（浏览器）对非可见会话帧是否渲染（客户端行为，host 侧无法观测，帧风暴事实不受影响）。

---

## 5. 卡顿与「多开」放大因子汇总（机制级）

| # | 环节 | 单开成本 | 多开放大方式 | 证据 |
|---|---|---|---|---|
| 1 | LLM SSE 解析 + agent-loop step | 1 条流主线程解析 | N 条流同线程解析 | driver L179；agent-loop L606/L617 |
| 2 | 每 token `assistant/chunk` append | K 次深拷贝+分发 | N×K 次 | agent-loop L621；dsh-session L1450-1476 |
| 3 | SSE mux 帧推送 | K 帧/会话 | N×K 帧 × 每个浏览器；无界队列 | apiproxy L3556-3574、L1095-1127 |
| 4 | 持久化写链 | 1 条链 200ms 批 | N 条并发链 × zstd+fsync | persistence L780-788；jsonl L1200-1227 |
| 5 | 完成期折叠 | O(K) | 逐个叠加 | driver L228-249 |
| 6 | 每步上下文折叠 | O(日志长) | 长日志子代理每步上升 | agent-loop L613；dsh-session L1543 |

---

## 6. 修复方向（机制级建议）

### 6.1 最小修复：恢复「subagent 非流式落盘」②b 基线（推荐第一步）

- **文件**：live 解析根 `~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js`（§0：运行实例解析根 = 全局树；`profiles/web/node_modules` 是空目录、`profiles/node_modules/@deepseek-ai/*` 是指向它的符号链接，改 profile 侧无效，必须改全局树）。
- **改动**（与 execution-2b.md 完全一致，2 处）：
  1. `step()`（L611 之后）插入：`const isSubagent = (this.options.subagentDepth ?? 0) > 0 || (this.session.header?.delegationDepth ?? 0) > 0;`
  2. L621 的 `chunkSeqs.push(this.session.append("assistant/chunk", {...}).seq);` 包进 `if (!isSubagent) { ... }`（`assembler.push(chunk)` 保持在外）。
- **前置**：`cp -r` 备份该包目录（回滚 = 还原目录；execution-2b.md L23/L26-31 的 Runbook 可复用）。
- **验收**：子代理一轮 0 条 `assistant/chunk`、1 条 `assistant/message`；主会话/btw 打字机不变；多开时 mux 帧率下降（§3.7）。
- **风险（必须固化）**：任何 `npm i -g @deepseek-ai/dsh` 重装会再次清除补丁——需把补丁做成脚本 + 启动后校验（grep `isSubagent` 缺失即告警/自动重放），或纳入回退/升级 runbook。

### 6.2 可选加固（同一因果链上的后续点，均为核心包改动，落地方式同 6.1）

1. **mux 会话级订阅过滤**：`dsh-host-apiproxy` L3556 的 `session/event` 处理器目前无会话过滤（§3.3），改为只推消费者已订阅的会话，可把 N×K 帧风暴降为「可见会话」帧。改动面：1 个监听器 + 订阅集合。
2. **FrameQueue 有界化/背压**：L1095-1127 无界 buffer，改为超阈值合并/丢弃低价值帧（如 `assistant/chunk` 可合并）或暂停 push 等消费者。
3. **（可选）②a wire 非流式**：需同时改 `dsh-llm-deepseek`（加 stream:false 分支）+ `dsh-llm`（加 complete()）+ `dsh-agent-loop`（子代理路径调 complete）——3 个核心 ESM 包，改动面大于 ②b，收益主要是省 SSE 解析（§3.1），可在 ②b 之后按实测决定（audit-B §三-3）。

### 6.3 不建议投入：worker_threads 驱动

- 机制级障碍（audit-A/B 已证）：worker 无法共享 Cordis context（ctx 含不可序列化的 service/句柄），必须重 bootstrap 运行时或 MessagePort 代理工具+持久化；现存 worker 模式（workflow/code-runtime）都不跑 agent-loop；收益未经实测（LLM 推理在远端、本地 CPU 大头是每 token append 链与 SSE 解析，②b 已直接命中前者）。
- 若未来仍要做：走可插拔 seam —— 新 `@local/dsh-subagent-worker-thread` provider（`ctx.subagents.registerProvider`）+ worker 内最小 agent 运行时 + `tool/call`/`chunk`/`done` MessagePort 协议（audit-A 线 W 方案），并用 `cordis.patch.yml` 以 `provider: spawn-worker` 接线；**不可**经 npm registry 安装（`dsh-subagent-worker-driver` 不存在，也永远不会来自上游）。

### 6.4 配置级：无现成开关

- settings.yaml / cordis.patch.yml 无任何流式/驱动开关（§1.3）；`dsh-session-persistence-jsonl` 的 `packChunks`（默认 true）与 `writeBatchMaxDelayMs`（默认 200）是仅有的相关可配项，但都改不到 §3.2/§3.3 的逐 token 成本。

---

## 7. 证据索引（file:line 速查）

| 证据点 | 位置 |
|---|---|
| provider 注册表 / 按名取 / start | dsh-subagent/lib/index.js L2382 / L2570 / L2587 / L2607 / L2621 |
| spawn provider（in-process） | dsh-subagent-spawn-in-process/lib/index.js L11 / L13 / L33-35 / L40-42 |
| fork provider（in-process） | dsh-subagent-fork-in-process/lib/index.js L46 |
| 子代理同 ctx 创建 | dsh-subagent-in-process-driver/lib/index.js L160 / L179 / L192-226 / L228-249 |
| 工具侧 provider 选择 | dsh-tool-subagent/lib/index.js L23 / L262 / L271 |
| preset 实际 provider | ~/.dsh/.agent-presets/standard-glm/agent.cordis.yml L189 / L200 / L216 / L225 / L233 |
| 0.1.5 同款 provider | web2 …/dsh-agent-presets/presets/standard/agent.cordis.yml L184 / L196 |
| worker 驱动不存在 | npm view @deepseek-ai/dsh-subagent-worker-driver → 404；两棵安装树均 MISSING；dsh-subagent L2375 仅注释 |
| 逐 token 流式 append | dsh-agent-loop/lib/index.js L617 / L619-627 / L673-681 |
| LLM 硬编码流式 | dsh-llm-deepseek/lib/index.js L239-240 / L250；dsh-llm types L107/114/168 |
| append 同步成本 | dsh-session/lib/index.js L1444-1484（L1450/L1457/L1464/L1476） |
| 持久化批/链/fsync | dsh-session-persistence/lib/index.js L436 / L780-788 / L824-840；dsh-session-persistence-jsonl L732 / L1200-1227 |
| mux 帧风暴 / 无界队列 | dsh-host-apiproxy/lib/index.js L1095-1127 / L1672 / L3524-3527 / L3556-3574 |
| 浏览器收帧 | dsh-client-runtime/lib/client.js L7463-7465 |
| ②b 曾存在（权威记录） | 工作区根 execution-2b.md（L6-15 改动 / L23 备份 / L26-31 回滚 / L51-57 复核 PASS） |
| ②b 当前缺失 | live 树 grep isSubagent = 0；备份目录全盘搜索无残留；web2 树无 |
| 丢失机制（mtime） | profiles/web/node_modules 空（09-12 14:44）；~/.npm-global 全部包 14:56 重装；profiles/node_modules/@deepseek-ai/* 符号链接 |
| 运行态 | :3080 root→200、events.mux→426；boot rev fce6c22da523 43 条目；进程树观察受沙箱 PID namespace 限制 |

---

## 8. 一句话答案

**当前 subagent 走 in-process 驱动（同进程同事件循环，spawn/fork 两 provider，无 worker、无任何驱动切换开关）；输出写入是硬编码流式（每 token 一条 `assistant/chunk` append + 深拷贝 + observer 分发 + mux 帧 + 200ms 批 zstd/fsync）。卡顿 = N 子代理 × K token 的全部同步成本叠加在一个线程 + N 条持久化写链 + 无会话过滤的 SSE 帧风暴 + 无界队列。用户假设半对：非流式写入确实在 09-08 部署过、09-12 回退重装时被清除（应恢复，§6.1）；worker 独立线程从未存在（npm 无此包、两版本无此 provider、历史审计仅提案未实现），谈不上被覆盖丢失。**
