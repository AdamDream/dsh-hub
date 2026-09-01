# DSH 架构分析与"本地偏好学习（Taste）"集成点评估
（深读子代理 B 报告全文存档）

## 0. 一句话结论
DSH 是 **cordis（Koishi 系插件框架）微内核 + ~200 个 `@deepseek-ai/dsh-*` 插件包**的组合式架构，任务所需的全部能力（轮末钩子、prompt 注入、受限工具、斜杠命令、UI 卡片、用户级存储）**都已有一等插件扩展点**——taste 可做成一个"双半插件"（host 半 + 浏览器半）**零内核改动**实现。

## 1. 整体架构（文字图）
```
组合层（dsh-app-boot loadProfile→composeEntries→applyEntryPatches 摊平为插件行列表）:
  profile package.json dsh.profile.bundles: @deepseek-ai/dsh-base → dsh-web-app
  → 各 bundle 内 cordis.patch.yml → profile cordis.patch.yml（用户 patch 层）
  → ~/.dsh/cordis.patch.yml → --patch   【insert {id,name:模块说明符}，支持本地路径】

HOST 进程（node, dsh-cordis-host-runner 承载 cordis 运行时）:
  Agent 抽象(dsh-agent) ── dsh-agent-loop/ReactLoopAgent（唯一循环实现）
     ├ ctx.llm（dsh-llm + dsh-llm-deepseek / dsh-llm-pi-ai 适配器，provider/model 可路由）
     ├ ctx.systemPrompt（注册表式组装）  ctx.tools（工具注册表）  ctx.commands
     ├ ctx.agents / AgentFactory（子代理创建）  ctx.jobs（后台任务）  ctx.goals
     └ Session(dsh-session)＝append-only 事件日志 = 唯一事实源
          ├ dsh-session-persistence-jsonl → ~/.dsh/sessions/<projectKey>/<id>/session.jsonl.zstd
          ├ dsh-session-projection（read-model 注册表）→ projection-cache(~/.dsh/storages/)
          └ dsh-session-query(-sqlite 本部署为 :memory:)
  dsh-host-webserver(:3080, node:http) + dsh-host-frontend-static(SPA fallback)
  dsh-api-gateway + dsh-api-remotes（typert RPC 网关 + 事件下发白名单）
  dsh-client-modules（node 半）：扫描 dsh.client 包 → 组 window.__DSH_BOOT__ + /plugins/<id>/client.js

BROWSER（dsh-web-frontend/dist vite shell + 浏览器内第二套 cordis）:
  __ModuleLoader__ 惰性 CJS 物化 client 插件 → ctx.slots(SlotRegistry) / ctx.conversationEvents
  / ctx.layout / ctx.commandUi / ctx.remote.$on（下行事件）+ connection.rpc.call（上行 RPC）
```
数据流：GUI(slots UI) —POST `/api/<ns>/<method>`(typert RPC) + WS `/api/events.*`(下行帧)→ host → `agent.send/followup` → loop turn/step → LLM/工具 → session 事件落盘 + projection → 推回 GUI。

## 2. 九问解答（`$B=/home/CNS2026495165/.dsh/profiles/web/node_modules/@deepseek-ai`）
1. **monorepo 布局**：源码 repo 按 `packages/<group>/<name>`（如 core/agent-loop、bundle/base）；本机为安装产物：每包 = `lib/index.js`(Node 半) + `lib/client.js`(浏览器半，UI 包) + `lib/types/*.d.ts` + README。dsh-base 插入全部基础行，dsh-web-app 叠加 web surface；相互依赖靠 cordis 服务键（ctx.tools/systemPrompt/…），非硬 import。
2. **agent 核心循环**：`$B/dsh-agent-loop/lib/index.js`（ReactLoopAgent L335-735）。链：send→wakeDriver→`turn()`(L516, append turn/start)→`preStep()`(L492, 认领 inbox+assemble system prompt+agent/pre-step)→`step()`(L606, agent/request→llm.stream→assistant/chunk→assistant/message→executeToolCalls→tool/call/result)→无 tool call 则 `agent/turn-stopping`→`turn/end{reason}`(L592)。无内存 messages 数组，`session.deriveMessages()` 每步从日志投影。**钩子=纯 cordis 事件**（ctx.on），无 "settled" 事件；durable 事件见 `dsh-session/lib/types/types.d.ts` SessionEventMap（turn/start|end、step/start|end、user/message、assistant/chunk|message、tool/call|result、request/header|context…），live 事件见 `dsh-agent/lib/types/runtime-types.d.ts`（agent/status、session-start、pre-step、request、turn-stopping…）+ firehose `session/event`。
3. **system prompt**：`dsh-system-prompt` 注册表模式——`section({name,order,text|fn})` + `context()` + `variable()` + `tools()`，assemble 按 order 排序→求值→`system-prompt/assemble` waterfall→`renderPrompt()` 插值 `{{var}}` 空行 join；**每 step 重新 assemble**（agent-loop L497/611），text 为函数即每轮动态。渲染层不加 XML 标签，`<system-reminder>` 等由插件自写。AGENTS.md/CLAUDE.md 走 `dsh-agent-instructions`：**不进 system prompt**，而是持久 user 消息 `<system-reminder>` 折入批次；扫描 ~/.dsh/AGENTS.md + 项目路径沿途候选文件，`instructionFileCandidates` **可配置**。
4. **工具系统**：`dsh-tools`（ctx.tools）——`ctx.tools.register(defineTool({name,description,parameters,output:{schema,render},execute}))`；经 `ctx.systemPrompt.tools()` 暴露；作用域分层（agent.ctx 注册=仅该 agent），`ctx.tools.restrict()` agent 级 allow/deny。执行管线 tools/pre-execute→execute→post-execute→result。子代理受限集=**`toolFilter:{allow?,deny?}`**（`dsh-tool-subagent/lib/types/index.d.ts`；dsh-tools/types/index.d.ts:474），schema 隐藏+执行拒绝一体，但**非安全边界**（可见性组合）；`report` 工具 scope-local 免疫。
5. **子代理**：spawn=全新 agent 无父历史；fork=父 completed-turn 前缀 seed。in-process driver（`dsh-subagent-in-process-driver`）经 `parent.ctx.agents.create` 未发布事务装 persona/toolFilter/structured_output→`child.followup()`+`whenIdle()`。provider/model 由 `AgentOptions{provider,model,maxTokens}` 指定（dsh-agent/types/runtime-types.d.ts:21）——preset `~/.dsh/agent-presets/*/agent.cordis.yml` 可固定，调用时 `SubagentStartRequest.agentOptions` 可覆盖；workflow 钩子 `agent(prompt,{provider,model,schema})` 同样支持。
6. **命令系统**：`dsh-commands`——`ctx.commands.register({name,description,input:{hint},handler(invocation)=>{kind:'success'|'error',text}})`；GUI 由 dsh-client-ui-commands 缓存 + input-trigger '/' 菜单自动呈现；结果直接渲染进对话流，**永不进模型历史**；任意插件可注册。
7. **Web GUI**：HTTP POST unary RPC(`/api/<ns>/<method>`, typert=类型化 RPC+Zod 编解码) + 下行-only WS；SPA=`dsh-web-frontend/dist`，client 插件 bundle 走 `/plugins/<id>/client.js`。UI 扩展=SlotRegistry：`ctx.slots.register/inject`；对话流自定义卡片=①`ctx.conversationEvents.register(kind definition)` ②`slots.inject('conversation.chat.node')` keyed renderer（现成范例：ui-workflow-run、ui-goal、ui-message-feedback）；轻量位 `conversation.input.dock`/`composer.dock`；**无独立 footer 槽**→`shell.overlay` pill 或 `conversation.session.header.actions` badge；设置卡=`settings.plugin.item`。
8. **配置**：`~/.dsh/settings.yaml`（dsh-settings-file 读，chokidar 热更新）——顶层键=namespace 节，插件 `ctx.settings.register(ns,schema)` 注册；cordis 静态配置走 `Config: z<Config>`。目录：agent-presets→dsh-agent-presets、storages→dsh-storage-json（`ctx.storageDomain.open` zod 域+原子写）、attachments→dsh-attachment-local；路径 API=`dsh-home-paths` 的 `dshHomePath()`。
9. **会话持久化**：`~/.dsh/sessions/<projectKey>/<sid>/session.jsonl.zstd`（首行 header{cwd,agentPreset…}，每行 `{type,seq,time,data,surfaceOp?}`）；user/assistant 文本**原文落盘**（assistant/message.content 按 part 区分 reasoning/text/tool-call）。settled 后取回：`ctx.sessionQuery.readSession(id)/readSurface(id)`（含脱敏前原文；`extractSessionEventText()` 不含 reasoning 勿用）；写侧 `ctx.sessionPersistence.readRaw/readFrom`。限制：工具输出超限全文走 spill(/tmp)不保证可回溯；sqlite 本部署 :memory: 不落盘。

## 3. Taste 集成点（a–f）
- **a) 轮末 hook**：`ctx.on('session/event',(session,ev)=>ev.type==='turn/end'&&reason 为 completed)`——durable 权威事实，`dsh-goal-round-driver/lib/index.js` L255-274 已示范此消费模式；监听内 detached 拉起 Learner（`ctx.agents.create()` owned AgentHandle 或 `ctx.jobs.start`），勿阻塞通知。备选 `agent/status`→idle。
- **b) <taste> 注入**：taste 插件 `ctx.systemPrompt.section({name:'taste',order:10( persona 后、plan 50 前),text:()=>读 taste.md})`，自包 `<taste>…</taste>`；每 step 重读即轮级生效。零代码备选：settings.yaml 配 `agent-instructions.instructionFileCandidates:['AGENTS.md','CLAUDE.md','taste.md']` 把 taste.md 以 `<system-reminder>` user 消息注入（走现有 AGENTS.md 机制）。注意 `{{` 严格插值、动态文本破坏 KV cache。
- **c) Learner 受限工具**：preset delegation 组加一行 dsh-tool-subagent 实例：`toolName:'learner', toolFilter:{allow:['read','write','edit','glob','grep']}, agentOptions:{provider,model}`——**纯配置零代码**；程序化等价=`SubagentStartRequest.toolFilter`。需 preset 含 tool-fs/tool-fs-search 行；toolFilter 非沙箱，写权限仍由 fs-sandbox/permission 面约束。
- **d) /taste 命令**：taste 插件 inject `['commands']`，`ctx.commands.register({name:'taste',input:{hint:'on|off|list|remember|forget|status'},handler})`；输出 `{kind:'success',text}` 直接渲染；要影响模型须另写 system-prompt section（命令文本不进历史）。参考 dsh-command-goal。
- **e) 活动卡片/状态**：host 半发持久 SessionEvent（type `taste/<event>`，SessionEventMap 可声明合并扩展）→ client 半 `conversationEvents.register` + `slots.inject('conversation.chat.node')` 渲染卡片（照抄 ui-workflow-run/lib/client.js:620-636）；开关状态放 `conversation.input.dock` 条目或 `shell.overlay` pill；配置卡走 `settings.plugin.item`；实时推送事件需进 dsh-api-remotes 白名单或改用 projection push。
- **f) 配置/存储**：`ctx.settings.register('taste',schema)`→settings.yaml `taste:` 节（热更新）；taste.md 本体=`dshHomePath('taste','taste.md')`+`dsh-atomic-write`；状态索引=storage domain `taste`（仿 dsh-message-feedback→`~/.dsh/storages/taste.json`）。插件加载=profile `cordis.patch.yml` 一行 `- insert:[{id:'taste',name:'./…或@scope/dsh-taste'}]`（本地未发包支持相对/绝对路径）。

## 4. 与 pi-taste 理念的相似/冲突
- **相似可复用**：① `dsh-agent-instructions`＝现成的"静态偏好文件注入"（taste.md 想静态注入可直接挂进它的候选表）；② in-process subagent＝现成 Learner 载体（spawn+toolFilter+structured_output+report 回传通道，fork 还能带父上下文）；③ `dsh-goal-round-driver`＝"后台驱动多轮"的完整范例（同 agent followup 开新轮）。
- **冲突/注意**：① AGENTS.md 机制只在会话首个 pre-step 组合 baseline、靠文件 touch 触发增量——**没有"每轮自动学习"语义**，学习侧必须自己挂 turn/end；② 命令不进模型历史、system prompt 渲染不加标签，taste 状态入上下文必须走 section；③ toolFilter 只是可见性裁剪，Learner 写 taste.md 的真实权限面是 fs-sandbox/workspace-write——别把它当安全边界宣传；④ turn/end 监听同步段不可阻塞日志 append；⑤ 每轮变化的 <taste> 文本会破坏 KV cache（pi-taste 同样问题，可 mtime 缓存+定期合并）。

## 5. 实现路径（规模小→大）
1. **纯外挂/配置级（半天，零代码）**：settings.yaml 把 taste.md 加进 agent-instructions 候选表（注入侧）；学习侧用外部脚本 tail `session.jsonl.zstd`（zstd 独立帧）或调 `ctx.sessionQuery` 之外的 CLI，自写 taste.md。缺点：无 /taste 命令、无 UI、Learner 不在进程内。
2. **包级扩展（推荐，~1 个插件包）**：`dsh-taste` 双半插件：host 半＝turn/end 监听→受限 Learner（toolFilter）→写 taste.md；`systemPrompt.section` 注入 <taste>；`commands.register('/taste')`；storage domain 存状态；client 半＝conversation.chat.node 卡片+input.dock 开关+settings.plugin.item 配置卡。挂载=cordis.patch.yml 一行 insert。**全部走公开扩展点，升级 DSH 不受影响。**
3. **深度内核集成（上游贡献向）**：SessionEventMap 正式注册 `taste/*` durable 事件类型、dsh-session-projection 注册 taste projection、dsh-api-remotes 白名单加推送、dsh-web-app bundle patch 内置、官方 preset 加 Learner 行——获得权威事件语义、投影缓存、GUI 首类支持，代价是跟随内核版本维护。
