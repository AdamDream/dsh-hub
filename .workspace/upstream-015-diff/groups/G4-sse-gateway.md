# G4-sse-gateway 分组调研笔记（0.1.5-rc.2 vs 0.1.1-rc.2，借源码不升级）

调研者：只读 subagent（G4-sse-gateway）。仅本文件为唯一写操作。
包：dsh-client-connection / dsh-api-gateway / dsh-api-remotes / dsh-host-webserver / dsh-host-frontend-static / dsh-tool-cordis

## 0. 重要前置：预生成 diff 的方向是反的（务必注意）

`upstream-015-diff/pkgs/<pkg>.{combined,libjs}.diff` 的头部是 `--- ARCH(0.1.5)` `+++ GLOB(0.1.1)`，
即按 `diff ARCH GLOB` 生成：**"-" 行 = 0.1.5 独有内容，"+" 行 = 0.1.1 独有内容**，与自然方向（GLOB→ARCH，+ 为上游增量）相反。
本笔记所有行号均按直接读取 ARCH/GLOB 源码核实的正向方向给出，引用 diff 文件时请自行翻转语义。
另：`dsh-host-frontend-static` 没有预生成 diff（疑似生成遗漏），本组用 `diff -u GLOB ARCH` 直接比对。

## 0.1 本地补丁对照（BASE vs GLOB，47 行，全部在 dsh-host-apiproxy/lib/index.js）

用 BASE（纯 0.1.1）对照 GLOB 确认：本地 apiproxy 补丁恰为 3 项 + btw（BASE→GLOB diff 仅 47 行）：
- U-5+U-5b：`MAX_QUEUED_FRAMES=4096` + `isAnswerableFrame`（approval/requested、approval/resolved、question/requested、question/resolved 4 类应答帧永不丢弃，溢出只丢普通帧最旧）→ GLOB apiproxy lib/index.js:1094-1119（BASE 原版 FrameQueue 无界，见 BASE lib/index.js:1095-1113）。
- U-4：会话级订阅过滤 —— `subscribeSession(queue, subscribed, session)` 维护 subscribed Set，`ctx.on("session/event")` 先判 `!subscribed.has(session.id)` 则 return → GLOB apiproxy lib/index.js:1171-1178、3546-3600。
- btw：session/prompt-image-transform waterfall → GLOB apiproxy lib/index.js:2766-2788。
（GLOB 里的 index.js.orig 是 2026-09-12 16:08 快照，**已含 U-4/U-5/U-5b**，不是纯基线；纯基线在 BASE。）

## (a) 每包增量分类

### 1. dsh-client-connection（GLOB: index.js 588L / client.js 10326L；ARCH: index.js 788L / client.js 6428L）
分类：**api**（传输协议整体更换）+ **stability**（连接恢复增量）+ **gui**（浏览器会话认证）。
- host 侧（index.js）：
  - 0.1.1：bridge→apiproxy 的 toFetchHandler；WS downlink /api/events.mux+/api/events.host 泵 apiproxy 的 SSE 流（GLOB index.js:374-455）；浏览器信任围栏 isTrustedApiRequest + PRIVILEGED_METHODS 回环门禁（GLOB index.js:233-330, 540-560）；无认证。
  - 0.1.5：http-bridge 增加 buffered/streaming 两种 body 模式（ARCH index.js:40-104）；新增 BrowserAuth HMAC 签名 cookie 认证（ARCH index.js:217-449：AUTH_RECORD_KEY:219、launch token:240、v1.payload.sig:300、authorizeIndex:386、isAuthenticated:431、timingSafeEqual:275-279）；HostConnectionService 增加 fetchRoutes 精确路由表（ARCH:570-586）与 requestRejection（403 信任围栏→401 认证，ARCH:553-556）；Config 新增 recovery/cookieMaxAgeDays（ARCH:737-742）；inject 增加 ["credentials"]（ARCH:736）；向 index 注入 `__DSH_CONNECTION_RECOVERY__`（ARCH:760-766）；**全部 /api 请求要求认证**（ARCH:768-781）。
  - 0.1.5 删除 WS downlink（职责移入 api-gateway 的 /api/remote.mux）。
- client 侧（client.js）：
  - 0.1.1：ConnectionController（GLOB client.js:32-138）：同时开 events.mux+events.host 双 SSE 流 + host.describe 就绪握手；指数退避已带抖动；状态 "reconnecting"。
  - 0.1.5：ConnectionController（ARCH client.js:847-1027）：单一 generation source（WS mux）；网络可用性感知（setNetworkAvailable:892，离线挂起重试/恢复立即重连）；手动重连 reconnect()（:879，MANUAL_RECONNECT:821）；就绪告警+硬超时 waitForReady（:1029-1054，warn 3s/timeout 15s）；onReconnectRequested sink（:956）；重试中断判定（:912-914）。
  - 事件词表变化：0.1.1 用 approval/requested、approval/resolved、question/requested、question/resolved（GLOB client.js:5593-5617）；0.1.5 用 approval/asked、approval/decided、approval/policy，并新增 assistant/attempt（ARCH client.js:1718-1722）——注意 U-5b 守卫匹配的是 0.1.1 词表。
- 无 client 侧 FrameQueue（ARCH 全树 grep FrameQueue 无命中；0.1.5 客户端用 async generator 拉流）。

### 2. dsh-api-gateway（GLOB 0.1.1 小包: index.js 396L/client.js 448L；ARCH 0.1.5: index.js 1108L/client.js 1900L）
分类：**api**（承载 0.1.1 apiproxy 的 mux 职责，改为 WebSocket 流 mux）。
- 0.1.5 = typert 网关 + WS mux：`REMOTE_STREAM_MUX_PATH="/api/remote.mux"`（index.js:11-13）；RemoteStreamMuxServer/Connection（index.js:196-371，心跳 MAX_MISSED_HEARTBEATS=2:197、写串行化 send:346-365、stream 帧 open/cancel/item/end/error）；RemoteEventQueue 无界 Deque（index.js:881-913）；$events/$events/result（index.js:585-609, 683-693, 566-580）；registerRemoteEvents(host={home})（index.js:485-509）。
- 依赖变化：新增 ws、dsh-timeout、dsh-deque、schemastery（ARCH package.json deps）。
- Q1 回答（对照 U-4/U-5/U-5b 三个本地补丁目标）：
  - **U-4（mux 会话级订阅过滤）：0.1.5 未原生实现等价语义**。broadcastRemoteEvent 推给全部已连接 client（index.js:621-629）；startRemoteEvent 把 waterfall 事件发给全部 client、首个应答者获胜（index.js:630-693）；无服务端按会话过滤。0.1.5 的替代架构：会话事件改为拉取式 RPC（api-session-controller 的 list/search/page/…）+ 轻量广播事件（api-session/added|status|error|activity 等）+ 客户端 waterfall 本地过滤（api-gateway client.js:687-689 privateEvents waterfall）。→ 不可把 0.1.5 mux 的"某一段"移植成 U-4 等价物；U-4 仍是本地补丁独有。
  - **U-5（FrameQueue 有界 4096 丢最旧）：0.1.5 未实现，且是无界**（RemoteEventQueue.push 无容量上限、无丢帧，index.js:885-889）——0.1.5 状态反而比 0.1.1+补丁退化；本地补丁仍是唯一有界实现。
  - **U-5b（应答帧永不丢弃）：0.1.5 未实现**。approval/question 流改走 $events waterfall + $events/result RPC（客户端显式应答），队列无差异化守卫。
  - 可移植段（非 U 系列）：WS 心跳回收半死连接（index.js:251-267）、WS 写串行化防乱序（index.js:346-365）、consumeRemoteEvents 源意外终止抛错（index.js:610-619）、cancellableStream finally 调 iterator.return（index.js:994-1000）。

### 3. dsh-api-remotes（GLOB index.js 172L/client.js 6075L；ARCH index.js 207L/client.js 9674L）
分类：**api**（远程 host 机制重构）。
- 0.1.1：index.js 提供 createApiRemoteAgentResolver / inspectApiRemoteSession / hasApiRemoteSubagentOwner / apiRemoteSubagentOwnershipError（冷会话 resume + subagent 所有权围栏 agent-busy）——这是给 apiproxy 老 API 用的解析器。
- 0.1.5：index.js 变成纯事件源桥：API_REMOTE_FORWARDED_EVENTS 带 emit/waterfall 模式（index.js:8-94）；apply 只注册 `typertGateway.registerRemoteEvents(remoteEventSource(ctx), { home: homedir() })`（index.js:100-103）——**$host 描述 = {home: homedir()}**；RemoteEventQueue.end(reason) 会 reject 挂起 waterfall（index.js:143-160，正确性修复）；forwardWaterfall（index.js:183-205）。
- client.js：0.1.1 内联 6 个 typert.remote-client；0.1.5 内联 15+ 个（agent-presets、commands、settings-controller、llm、goal、cordis-host-runner、message-feedback、command-feedback、file-upload、session-reference、subagent、session-controller、workspace-controller、workspace-files）——客户端 RPC 面大幅扩张。
- 破坏面：0.1.1 导出的 agent-lookup 系列在 0.1.5 被移除（迁往他处）；0.1.5 的 remoteEventSource 依赖 typertGateway/scope/deque 0.1.5 基建。

### 4. dsh-host-webserver（GLOB 313L + 本地 invariant.js；ARCH 365L）
分类：**gui**（gzip 压缩 + boot 协议增量）。
- gzip 中间件（ARCH:12-37 createGzipMiddleware；config compression/level/threshold ARCH:139-146；Negotiator 协商 ARCH:24-31；filter 排除 content-range 与 text/event-stream ARCH:21-26；接入 ARCH:246-252）→ perf 增量。
- script-preload 注入行类型（ARCH:35-39）。
- `__DSH_BOOT_READY__` 就绪尾脚本（ARCH:58-60, 82）——0.1.5 client 入口 await 它再读注入状态；0.1.1 client 不认识它，单加无害但无收益。
- GLOB 的 lib/invariant.js 是本地补丁（ARCH 无），勿判为上游。

### 5. dsh-host-frontend-static（无预生成 diff，直接比对）
分类：**gui**（index 认证）+ **api**（inject 增加 connection）。
- 0.1.5：inject ["webServer","connection"]（ARCH:20）；serveStatic 对 index 响应先走 `ctx.connection.authorizeIndex(req,res)`（ARCH:45,57-59,92-95）；renderIndex 注入 `<base href="/">`（ARCH:84-86）；MIME 增加 .gz（ARCH:31）。
- `<base href="/">` 修正非根路径下资源相对解析（gui bugfix 性质）；authorizeIndex 依赖 0.1.5 client-connection 的 BrowserAuth，0.1.1 无此服务，单独借不可行。

### 6. dsh-tool-cordis（GLOB 7594L；ARCH 9627L）
分类：**noise**（生成型 API 目录，`scripts/gen-cordis-api.ts` 产物，头部注明"do not edit by hand"）。
- 165 个 hunk 全为 signature/description 文本变化，无任何逻辑 diff（grep class/function 定义 0 命中）。
- 0.1.5 目录描述的是 0.1.5 才有的服务（如 session-controller/workspace-controller），借到 0.1.1 会指向不存在的 API → 不借。

## (b) 值得借到 0.1.1 的候选

| id | 价值 | 最小 patch 面（GLOB 文件:行） | 与本地补丁冲突 | 风险 | 优先级 |
|---|---|---|---|---|---|
| G4-CC-1 | ConnectionController 增量：网络感知挂起重试、手动重连、就绪 3s 告警+15s 硬超时、onReconnectRequested（0.1.1 断网会空转退避、就绪可无限等待） | dsh-client-connection/lib/client.js:32-138（改造 controller；transport 保持 0.1.1 双 SSE 流，需把 source 抽象为"双流源+reportReady"） | 无（本地补丁不在 client-connection） | 中：client.js 是打包产物（window.__ModuleLoader__），手工改 bundle；重连状态机行为变化需回归 | P1 |
| G4-WS-1 | WS downlink 心跳（MAX_MISSED_HEARTBEATS=2 后 terminate）+ 写串行化 send 链，回收半死 socket、防帧乱序 | dsh-client-connection/lib/index.js:374-455（WebSocketDownlinks pump/send；心跳定时器可参照 ARCH api-gateway index.js:251-267） | 无 | 低（新增定时器 + 发送链，不动协议） | P2 |
| G4-STATIC-1 | frontend-static `<base href="/">` + .gz MIME（非根路径资源解析修复 + gzip 预压缩文件服务） | dsh-host-frontend-static/lib/index.js:46-92 | 无 | 低 | P2 |
| G4-WEB-1 | host-webserver 可选 gzip（含 SSE/content-range 排除 filter） | dsh-host-webserver/lib/index.js:12-37,139-146,246-252（需新增 compression+negotiator 依赖） | 无 | 中：0.1.1 SSE(/api/events.mux)已被 filter 排除，安全；但引入 2 个依赖 | P2 |
| G4-RPC-1 | http-bridge 流式 body 模式 + requestUnread 时 connection:close/req.destroy 防悬挂 | dsh-client-connection/lib/index.js:40-104 | 无 | 中：streaming 模式依赖 fetch handler 的 requestBodyMode 契约，0.1.1 的 toFetchHandler（apiproxy）不支持 → 只能借防御段（close/destroy），价值小 | P3 |
| G4-BOOT-1 | `__DSH_BOOT_READY__` + script-preload | dsh-host-webserver/lib/index.js:58-82 + 客户端 boot 配合 | 无 | 中：boot 协议联动，需 0.1.1 客户端 entry 配套改动 | P3 |

明确不借：0.1.5 mux 整体（api-gateway + api-remotes + api-session-controller 是 typert/WS 新协议，移植即改协议）；BrowserAuth 认证栈（牵动 credentials 依赖 + /api 全量加锁）。

## (c) 明显稳定性 bugfix 清单

- ARCH dsh-client-connection/lib/index.js:82-103：http-bridge 对"流式请求体未被读取"的响应标记 `connection: close` 并在响应结束后 `req.destroy()`——修复流式上传中止时连接悬挂/泄漏。bugfix。
- ARCH dsh-client-connection/lib/client.js:1029-1054：就绪握手 3s 告警 + 15s 硬超时（generationReadyWarnMs/TimeoutMs）——0.1.1 循环对永不就绪的流可无限等待重试；加硬截止防挂死。stability 增强。
- ARCH dsh-api-gateway/lib/index.js:610-619：consumeRemoteEvents 在源未 abort 却结束时抛 "forwarded Remote event source ended unexpectedly"——把"事件源静默死亡"变成可见失败。bugfix。
- ARCH dsh-api-gateway/lib/index.js:251-267：WS 心跳（missedHeartbeats≥2 → terminate，unref 定时器）——回收半死 socket（0.1.1 WS downlink 无心跳）。stability。
- ARCH dsh-api-gateway/lib/index.js:346-365：send() 写串行化（this.writes 链）+ 关 socket 时拒绝——防帧交错、提供背压。stability。
- ARCH dsh-api-gateway/lib/index.js:994-1000：cancellableStream finally 调 iterator.return?.()——client abort 时停掉 host 生成器，防资源泄漏。bugfix。
- ARCH dsh-api-remotes/lib/index.js:143-160：RemoteEventQueue.end(reason) 对挂起 waterfall dispatch 逐一 reject——pending approval/question 在源终止时干净失败而非静默丢弃。bugfix。
- ARCH dsh-host-webserver/lib/index.js:21-26：gzip filter 排除 text/event-stream 与 content-range——避免压缩破坏 SSE 流/范围请求（特性内守卫）。
- ARCH dsh-host-frontend-static/lib/index.js:84-86：index 注入 `<base href="/">`——修复非根路径服务时资源相对解析。gui bugfix。
- ARCH dsh-client-connection/lib/index.js:390-392：authorizeIndex 要求 token 参数恰为 1 个（tokens.length===1）——拒绝重复/歧义 token。防护。

## (d) 0.1.5 破坏性 API/接口变更（勿借项）

1. **浏览器传输协议整体更换**：SSE /api/events.mux + /api/events.host（含 WS downlink）→ WS /api/remote.mux typert 流（open/cancel/item/end/error 帧）+ $events/$events/result waterfall。0.1.1 host（apiproxy）无 /api/remote.mux upgrade 路由、无 $events 端点 → 借 0.1.5 client-connection 整包到 0.1.1 **必然破坏与 0.1.1 host 的协议兼容**（必答项：是，破坏）。唯一不破坏的借法是只借 controller 增量并保留 0.1.1 的 SSE 双流传输。
2. **事件类型词表变化**：approval/requested|resolved、question/requested|resolved（0.1.1，也是 U-5b 守卫匹配名）→ approval/asked|decided|policy、user-questions/request、api-session/*、assistant/attempt（0.1.5）。任何借用帧守卫/消费者需保留 0.1.1 词表。
3. **dsh-host-apiproxy 在 0.1.5 被删除**：其 SSE mux/FrameQueue 职责并入 api-gateway（WS 化）；api-gateway 依赖 typert/typertGateway/cordis 0.1.5 基建 + ws/dsh-deque/dsh-timeout/schemastery——单包回迁不可行，等于整体升级。
4. **client-connection 强制认证**：inject ["credentials"] + BrowserAuth；/api 全量 401（0.1.1 仅信任围栏 403）。0.1.1 无 credentials 服务的组合会激活失败；外部 LAN 调用方（测试/工具）全部被拦。
5. **api-remotes 导出面破坏**：createApiRemoteAgentResolver / inspectApiRemoteSession / hasApiRemoteSubagentOwner / apiRemoteSubagentOwnershipError 从导出移除（0.1.5 只导出 API_REMOTE_FORWARDED_EVENTS/apply/inject）；0.1.1 消费者（apiproxy 老 API 解析）直接断裂。

## (e) 每包一句话裁决

- dsh-client-connection：**部分借**——只借 ConnectionController 恢复增量（G4-CC-1，P1）+ WS downlink 心跳/写串行化（G4-WS-1，P2）；整包不借（协议断裂 + 认证栈依赖）。
- dsh-api-gateway：**不借整包**——0.1.5 的 mux 是 WS/typert 新协议且无 U-4/U-5/U-5b 等价实现；仅心跳/写串行化/生成器清理可作参考移植到 0.1.1 WS downlink。
- dsh-api-remotes：**不借**——0.1.5 事件源桥依赖 typertGateway/scope/deque 新基建，且 0.1.1 的 agent-lookup 导出被移除；RemoteEventQueue 无界反而不如本地 U-5 补丁。
- dsh-host-webserver：**部分借**——gzip（可选，P2，perf）；__DSH_BOOT_READY__/script-preload 需客户端 boot 配合（P3，单独评估）。
- dsh-host-frontend-static：**部分借**——`<base href="/">` + .gz MIME（P2）；authorizeIndex 需 BrowserAuth 配套，不单独借。
- dsh-tool-cordis：**不借**——纯生成目录噪音，借了会描述不存在的 0.1.5 服务。

## 证据行号索引（ARCH = ~/.dsh/profiles-archive/web2-20260915-105429/node_modules/@deepseek-ai；GLOB = ~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai；BASE = /home/CNS2026495165/dsh/.workspace/baseline-011/x）

- BASE apiproxy 无界 FrameQueue：BASE/dsh-host-apiproxy/lib/index.js:1095-1113；BASE→GLOB 补丁 47 行（U-4/U-5/U-5b/btw）。
- GLOB apiproxy 补丁位点：MAX_QUEUED_FRAMES/isAnswerableFrame:1094-1119；subscribed 过滤:1171-1178,3546-3600；prompt-image-transform:2766-2788。
- 0.1.5 无 SSE：ARCH 全树 grep "text/event-stream"/events.mux 0 命中；mux 在 ARCH/dsh-api-gateway/lib/index.js:11-13(路径),196-371(WS mux),881-913(无界 RemoteEventQueue),485-509(registerRemoteEvents host={home})；waterfall:630-693；$events/result:566-580。
- 0.1.5 客户端 WS 载波：ARCH/dsh-api-gateway/lib/client.js:291-447（RemoteStreamMuxClient）。
- 0.1.1 客户端双流 SSE：GLOB/dsh-client-connection/lib/client.js:32-138（ConnectionController），readSse:5309-5313；0.1.1 WS downlink：GLOB/dsh-client-connection/lib/index.js:374-455。
- 0.1.5 认证：ARCH/dsh-client-connection/lib/index.js:217-449（BrowserAuth）,736（inject credentials）,768-781（/api 加锁）。
- 事件词表：GLOB client.js:5593-5617 vs ARCH client.js:1718-1722。
- api-remotes：ARCH index.js:8-94(事件表 emit/waterfall),100-103($host home),133-160(队列 end reject),183-205(forwardWaterfall)。
- host-webserver：ARCH index.js:12-37(gzip),58-82(boot ready),139-146(config)。
- frontend-static：ARCH index.js:20(inject),45-59(authorizeIndex),84-86(base href),31(.gz)。
- tool-cordis：ARCH/GLOB 均为生成目录（文件头注明 gen-cordis-api.ts），diff 165 hunk 全文本。
