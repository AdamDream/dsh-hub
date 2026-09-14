# dsh-usage 复核报告（REVIEW）

> 阶段：三阶段闭环 · 复核（deepseek-v4-flash）
> 日期：2026-09-12 · 环境：Node v22.23.2、宿主 web2 profile（@deepseek-ai/dsh 0.1.5-rc.2）
> 依据：`DESIGN.md` / `AUDIT.md`（U01–U12）/ 真实安装件（`~/.dsh/profiles/web2/node_modules` 下 dsh-taste、
> dsh-btw、dsh-wallpaper、dsh-session-query-sqlite、dsh-client-connection、dsh-settings、dsh-home-paths）/ 本档实测复跑
> 裁决：**返工（rework）** —— 1 项阻塞（RPC 通道未注册，GUI 取不到数）、1 项数据质量缺陷（cc 流式重录
> 「先写先赢」导致输出/缓存读系统性少计），另有 2 项验收基准/声明需裁决修正、2 项轻微。

---

## 1. 复核方法

1. **逐单元核对** U01–U12 交付物与验收标准（对照 AUDIT D 节）。
2. **与真实 0.1.5 API 对照**（本档实读安装件源码，非推测）：
   - RPC 注册：dsh-taste `lib/bridge.js` + `dsh-client-connection` `lib/index.js`（`rpc.handle` 语义、`connection.register(owner, channel, handler)`、`owner.webServer.register` 依赖）；
   - 设置页：dsh-wallpaper `lib/index.js`（`settings.register(ns, schema)`）、dsh-settings `register/installSection` 双函数；
   - 客户端：dsh-taste `lib/client.js`（ModuleLoader bundle、`exports.inject`、`slots.inject` keyed slot、`rpc.call`）、dsh-client-connection `lib/client.js`（`provide("connection")`）；
   - package.json 字段：dsh-btw / dsh-taste / dsh-wallpaper 三份实样比对。
3. **真实日志格式抽查**：dsh 会话 `session/request/header/assistant/chunk/assistant/message` 记录形态逐条与解析器对照；cc 转录 `message.usage` 字段与 `sessionId/cwd/timestamp` 对照。
4. **复跑验证**：`node --check` ×10、`node test/bundle-smoke.mjs`、`node smoke.mjs`、`node test/verify.mjs`（24 项验收全 PASS）；另独立量化 cc 去重与首/尾记录取值差异。

## 2. 逐单元核对结论

| 单元 | 结论 | 说明 |
|---|---|---|
| U01 package.json | ✅ 通过 | 字段与 taste/btw/wallpaper 惯例一致（`main`/`exports` 含 `./client`、`./cordis.patch.yml`、`./package.json`；`dsh.bundle.patch`；`dsh.client.platform=web`；`engines`；peerDeps 区间与真实 dsh-settings 0.1.5-rc.2 匹配）。**1 项待改**：`dsh.client.inject: []` 与客户端 bundle 消费 `connection` 服务不匹配（见 P3）。 |
| U02 cordis.patch.yml | ✅ 通过 | `- insert: - id: usage, name: '@local/dsh-usage'`；web2 patch 现有 id（vision-adam/agent-presets/taste/btw/wallpaper）无冲突。 |
| U03 LICENSE | ✅ 通过 | 首行 `MIT License`，版权人/年份正确。 |
| U04 lib/zstd.js | ✅ 通过 | 帧结构扫描 + 逐帧解压 + 撕裂末帧跳过；真实 22.8MB 文件 82,430 行、首行为 session 记录；合成撕裂帧不抛错。与宿主 `dsh-session-persistence-jsonl` 的 scan 语义一致。 |
| U05 lib/db.js | ✅ 通过 | `dedup_key`/`is_subagent` 修正落表；`INSERT OR IGNORE` 去重实测生效（同键二次不插入、cc NULL turn/step 同 message.id 不双计）；聚合查询（summary/timeseries/heatmap/byModel/byProject/byDay/sessions）跑通且与手工 SQL 对账一致。**1 项关联**：`insertEvent` 的「先写先赢」在 cc 流式重录下保留部分用量（P1）。 |
| U06 lib/ingest-dsh.js | ✅ 通过 | 真实格式逐字段匹配（session 顶层字段、`request/header` 的 `data.header.config`、`assistant/chunk` 的 `data.chunk.type==='usage'`、`assistant/message` 的 `data.usage`）；chunk 优先 + message 兜底并集去重正确（抽查 chunk/message 同 (turn,step) 数值相同）；`compaction/summary` 等排除；provider/model last-seen 归属抽查 191/191；mtime/size 门 + 全量重扫 + INSERT OR IGNORE 幂等（冻结副本二次运行新增 0）；`size < last_offset` 防御在案。 |
| U07 lib/ingest-cc.js | ⚠️ 部分通过 | 解析/去重/归属/B3 公式均正确（B3 复算 50/50、subagent 50/50、failedFiles=0、幂等），**但** B5「先写先赢」对 cc 流式重录保留首条部分用量（P1）；验收基准 41,071 与 B2 去重自相矛盾（P2）。 |
| U08 lib/rpc.js | ❌ **未实现（阻塞）** | 执行档按审计 F 上报歧义后跳过。复核已确认真实 0.1.5 API：`ctx.connection.register(ctx, '/usage', handler)`（handler `(endpoint, payload, signal) => {ok,value}|{ok,error}`）+ `webServer` inject（taste 实证）。`rpc.handle` 在 0.1.5 存在但绑定 connection 服务自身 ctx（`dsh-client-connection` 源码 `get rpc() { const owner = this.ctx; ... }`），该 ctx 无 webServer，不可用。见 P0。 |
| U09 lib/index.js | ⚠️ 部分通过 | steps 1/2/3/5/6 落地正确（`settings.register('dsh-usage', 空 schema)` 与 wallpaper 一致；45s 定时 + 异步首扫 + 生命周期清理）；**step 4（RPC 接线）缺失**（依赖 U08，见 P0）。 |
| U10 lib/client.js + charts.js | ✅ 通过 | ModuleLoader bundle 加载/导出正确（bundle-smoke 实测）；`settings.plugin.item` keyed slot（key=`dsh-usage`，与宿主 namespace 配对，符合 cookbook/AUDIT A4 双重确认）；`rpc.call(CHANNEL, endpoint, payload)` 照 taste；轮询 useEffect+setInterval；下钻 `sessions.select`；charts.js 与 client.js 内联版逐函数一致（areaPath/barRects/heatmapGrid/scaleBars/scaleArea/formatTokens）。**1 项待改**：`inject()` 直接取 `ctx.connection.rpc`，在 `dsh.client.inject` 未列 provider 包时可能 undefined（P3，需防御）。 |
| U11 README.md | ✅ 通过 | 用途/口径（C.3+B3）/架构/INSTALL 完整；已知限制如实标注。 |
| U12 scripts/install-web2.sh + smoke.mjs | ✅ 通过 | dry-run/幂等/--uninstall 实测；smoke 跑真实日志输出合理（50 dsh 事件 + 17 cc 事件，聚合与日聚合一致，命中率 86.5% 与手工计算一致）。 |

## 3. 问题清单（影响 + 最小修法）

### P0（阻塞）宿主 `/usage` RPC 通道未注册 —— GUI 无数据
- **现状**：`lib/rpc.js` 不存在；`lib/index.js` 未接线 step 4（`inject=['connection']`，缺 `webServer`）。客户端卡片 `rpc.call('/usage', …)` 全部 404，仅显示「宿主未注册 /usage RPC 通道」。
- **为何执行档跳过**：AUDIT U08 写的是 0.1.1 API `ctx.connection.rpc.handle('/usage', handler, {authority:'loopback'})`；执行档实测发现与 0.1.5 不符，按 AUDIT F「新 API 签名变化 → 上报审计澄清，不得自行改写方案」上报并跳过。**跳过动作符合流程约束，但审计 U08 的前提本身错误**。
- **复核实证（0.1.5 真实 API）**：安装的 dsh-taste（web2 现役插件）用 `ctx.connection.register(ctx, '/taste', handle)`，注释明示「0.1.1 `ctx.connection.rpc.handle` … structurally gone in 0.1.5」；`dsh-client-connection/lib/index.js` 证实 `get rpc(){ const owner=this.ctx; return { handle:(ch,h)=>this.register(owner,ch,h), … } }` —— `rpc.handle` 的 owner 是 connection 服务自身 ctx（无 webServer），而 `register(owner, channel, handler)` 内部执行 `owner.effect(() => owner.webServer.register(route))`，故插件必须 `inject: ['connection','webServer']` 并直接调 `ctx.connection.register(ctx, '/usage', handler)`。
- **影响**：DESIGN §6 查询 API 与 §7 全部 GUI 视图（Hero/趋势/热力/Tabs/下钻）不可用，验收标准「GUI 各视图/筛选/下钻可用」不满足。客户端已就绪，无需改动。
- **最小修法**（新档）：
  1. 新增 `lib/rpc.js`：`registerUsageRpc(ctx, {db, ingest, statusProvider})`，`const dispose = ctx.connection.register(ctx, '/usage', handle)`；`handle = (endpoint, payload, signal) => ({ok,value}|{ok,error})`，端点 = `summary/timeseries/heatmap/byModel/byProject/byDay/sessions/status/refresh`（对应 AUDIT C.4），全部走 U05 聚合函数；参数校验（from/to 接受毫秒或 ISO、dataSources∈{dsh,cc,all}、granularity 白名单）失败返回 `{ok:false, error:{code:'invalid-params', message}}`；`status` 返回 `{dbPath, dbSource, lastIngest, eventsDsh, eventsCc, scannedDsh, scannedCc, failedDsh, failedCc}`（客户端 statusLine 消费 `lastIngest/eventsDsh/eventsCc`）；`refresh` 调 ingest 后回 status。
  2. `lib/index.js`：`inject` 改为 `['connection','webServer']`；apply 内注册 settings 后接线 `registerUsageRpc(ctx, {db, ingest: runIngest, statusProvider})`（把 dbPath/dbSource/ingestSummary/lastIngest 收进 statusProvider），dispose 并入生命周期清理。

### P1（数据质量）cc 流式重录 + 「先写先赢」→ 输出/缓存读系统性少计
- **现状**：cc 转录对同一条 API 调用（同 `sessionId + message.id`）随流式更新重录多次（实测 41,071 原始行中 11,069 组重复，均在同文件内，间隔约 1 秒；首条为部分用量 `input=2219/output=0`，末条为终值 `input=6844/output=57`）。`INSERT OR IGNORE`（B5「先写先赢」）保留首条。
- **实测影响**（对 22,700 去重后事件，首条 vs 末条全库对账，数值与本档 verify.db 逐项吻合）：
  - 输出桶：4,977,433 vs 12,767,817 → **少计 61.0%**；
  - 缓存读桶：1,103,100,139 vs 1,385,726,932 → **少计 20.4%**；
  - 缓存写桶：51,005,431 vs 42,529,305 → 多计 19.9%；输入桶差异 <0.2%。
  - 直接证据：当前库 cc 22,700 行中 **6,782 行（30%）`output_tokens=0`**（首条部分记录被保留）。
- **影响**：cc 源全部统计面板（总输出、命中率、按模型/按日/会话下钻）数字系统性偏低；dsh 源无此问题（chunk/message 同 (turn,step) 数值相同）。
- **最小修法**：`lib/db.js` 的 `insertEvent` 对冲突键改为「最新观测胜出」：
  ```sql
  INSERT INTO usage_events (...) VALUES (...)
  ON CONFLICT(data_source, session_id, dedup_key) DO UPDATE SET
    ts=excluded.ts, model=excluded.model, provider=excluded.provider,
    project=excluded.project, input_tokens=excluded.input_tokens,
    output_tokens=excluded.output_tokens,
    cache_read_tokens=excluded.cache_read_tokens,
    cache_write_tokens=excluded.cache_write_tokens
  WHERE excluded.ts >= usage_events.ts
  ```
  对 dsh 无害（同键值同 ts 域内更新恒等/仅 ts 变化）；对 cc 幂等（重扫同文件收敛到终值）。这偏离 B5 字面「先写先赢」，属审计决策——复核裁决：**采用「最新 ts 胜出」**（B5 的意图是防双计而非冻结部分值）。`insertEvent` 返回 true 仅当真正插入新行（供统计 newEvents）；DO UPDATE 计为新事件不改变去重语义。

### P2（验收基准矛盾）U07 验收 1「41,071 ± 10」与 B2「重复 message.id 无双计」不可同时成立
- **现状**：41,071 是**原始含 usage 行数**（与 AUDIT A3/DESIGN §2 完全一致），其中 18,371 行是流式重录重复；B2 去重后为 **22,700**（复核时点实测）。实现按 B2 正确落地，verify.mjs 已如实标注冲突。
- **裁决**：基准改为**去重后口径 22,700**（复核时点），并在 AUDIT/README 注明「41,071 = 原始行数（含流式重录），请求数口径 = 去重后 22,700」；与 P1 修复结合后该基准同时是终值口径。
- **影响**：无实现缺陷；仅基准表述与验收脚本断言需更新（verify.mjs 的 U07 断言改为 `ccTotal === 22700` 或以「冻结副本幂等 + B3 复算」为锚）。

### P3（风险）`dsh.client.inject: []` 与客户端 bundle 消费 `connection` 服务不匹配
- **现状**：`package.json` 的 `dsh.client.inject=[]`，但 `lib/client.js` 通过 `ctx.connection.rpc.call` 消费客户端 `connection` 服务（另 `sessions`）。真实对照：taste 的 bundle 同样用 `ctx.connection.rpc`，其 `dsh.client.inject` 显式含 `@deepseek-ai/dsh-client-connection`（btw/wallpaper 亦把 bundle 消费的 @deepseek-ai 客户端包全部列出）。`dsh.client.inject` 声明的是「bundle 消费其服务的 @deepseek-ai 客户端包」，与 `require()` 依赖是两回事。
- **影响**：客户端 `inject()` 直接解引用 `ctx.connection.rpc`；若 `connection` 服务未随该声明注入，卡片渲染期抛 TypeError（白屏）。本环境无 web 壳源码，无法在本机终验；taste 先例强提示该列表为必需。
- **最小修法**：`package.json` `dsh.client.inject` 补 `"@deepseek-ai/dsh-client-connection"`（照 taste 形态）；`lib/client.js` 的 `inject()` 改防御式：`rpc: ctx.connection?.rpc ?? null`，卡片对 `rpcAvailable=false` 已现成显示不可用文案（不会白屏）。安装后按 U10 验收 2/4 实测确认。

### P4（轻微）其他
1. **`openUsageDb` 未读 `user_version` 迁移**：每次 `ensureSchema` 直接 `PRAGMA user_version=1`，若未来库为更高版本会误标（v1 现状无影响）。最小修法：迁移入口先读 `user_version`，>1 时拒绝或按版本迁移，留注释即可。
2. **验收基准漂移（非缺陷）**：dsh 并集基准 47,846 系审计时点冻结值，日志持续追加（复核时点 48,788，文件 1,684）。verify.mjs 已用「冻结副本幂等 + parse 并集与 DB 逐条相等（9,889=9,889）+ 归属 191/191 + failedFiles=0」锚定实现正确性，绝对数以复核时点重扫为准；建议 README 注明「数字随会话增长」。
3. **验证产物**：`data/verify.db`（约 26MB）为验收脚本落库产物，已被 `data/.gitignore` 覆盖，可保留可清理。

## 4. 复核实测记录（本档复跑）

- 语法：`node --check` ×10 全过；`package.json` JSON 解析过。
- `node test/bundle-smoke.mjs`：ModuleLoader 加载 OK；`exports=['apply','inject']`、`inject=['slots','connection','sessions']`；`apply` 注册 `settings.plugin.item`（key=`dsh-usage`、locale=`dshUsage`）；注入面 `{useStore, rpc, sessions}` 齐全。
- `node smoke.mjs`：dsh 50 事件 / parseErrors=0；cc 17 事件（message.id 去重）；聚合 requests=67、输入 570,509、输出 45,575、缓存读 3,663,616、缓存写 0、命中率 86.5%（与 `cacheRead/(input+cacheRead)` 手工计算一致）；日聚合 2 行与按日查询一致。
- `node test/verify.mjs`：**24/24 PASS**（U04×5、U05×5、U06×5、U07×6、U08 聚合×1、decodeCcProjectDir×1、summary×1）；dsh 48,788 / cc 22,700 / 汇总 requests=71,488。
- 真实格式抽查：`{type:'session', id, createdAt, cwd}`、`{type:'request/header', data:{header:{config:{provider,model}}, reason}}`、`{type:'assistant/chunk', seq, time, data:{turn, step, chunk:{type:'usage', usage:{inputTokens, outputTokens, cacheReadTokens}}}}`、`{type:'assistant/message', data:{turn, step, message, usage}}` —— 与解析器字段逐一吻合；chunk 与 message 同 (turn,step) 数值相同（B5 并集前提成立）。
- 真实 API 对照：taste bridge.js（`connection.register(ctx,'/taste',handle)` + `webServer`）、dsh-client-connection（`rpc.handle` 绑定 connection 自身 ctx、`register` 走 `owner.webServer.register`）、dsh-settings（`register(ns,schema,opts)` 存在，wallpaper 实用）、dsh-home-paths（`dshHomePath` 命名导出存在）。

## 5. 结论

- **返工（rework）**，返工面收敛为两处代码改动 + 一处声明 + 一处基准表述：
  1. **P0**：新增 `lib/rpc.js`（`ctx.connection.register(ctx,'/usage',handle)` 8 端点）并接入 `lib/index.js`（`inject=['connection','webServer']`）——恢复 DESIGN §6/§7 全部 GUI 功能；
  2. **P1**：`insertEvent` 冲突键改「最新 ts 胜出」（ON CONFLICT DO UPDATE WHERE excluded.ts >= usage_events.ts）——修复 cc 输出 −61%、缓存读 −20% 的系统性少计；
  3. **P3**：`dsh.client.inject` 补 `@deepseek-ai/dsh-client-connection`，客户端 `inject()` 防御 `ctx.connection?.rpc`；
  4. **P2**：验收基准改去重口径 22,700 并在文档注明与 41,071 的关系。
- 其余（U01–U07 主体、U09 非 RPC 部分、U10 客户端、U11 文档、U12 脚本与 smoke）**通过**：解析严格按真实日志格式、去重/增量逻辑成立（冻结副本幂等实证）、客户端卡片走 `settings.plugin.item`（key 与宿主 namespace 配对）、package.json 字段与真实安装件惯例一致。
- 返工完成后需重跑：`node test/verify.mjs`（P1/P2 断言更新后）、`node smoke.mjs`、并按 U12 装入 web2 后验证 U09 验收 1–4（宿主日志、`/usage/status` 可调、卡片渲染与下钻、与 btw/wallpaper/taste 互不干扰）。

---

## 6. 返工轮复核（2026-09-12 · deepseek-v4-flash）

> 复核对象：VERIFY.md §7 返工轮修复（P0–P4）+ 本档实测复跑。
> 结论：**通过（pass）** —— P0–P4 全部修复且实现正确；四组验证命令全部通过，实测数字与
> VERIFY.md 返工轮记录一致（cc 侧逐项精确一致，dsh 侧按 §4 文档化活数据漂移策略微涨）；
> 无阻塞性回归。附 1 项轻微观察（P4 级，不构成返工，见「副作用/回归检查」末条）。

### 6.1 P0–P4 逐项核对（对照 web2 安装件真实 0.1.5 API，本档实读源码）

| 项 | 结论 | 核对面 |
|---|---|---|
| **P0** `lib/rpc.js` + `lib/index.js` 接线 | ✅ 通过 | 实读 `~/.dsh/profiles/web2/node_modules`：`dsh-taste/lib/bridge.js` 用 `ctx.connection.register(ctx,'/taste',handle)` + `ctx.effect(()=>dispose)`；`dsh-client-connection/lib/index.js` 证实 `get rpc()` 的 owner 硬编码为 connection 服务自身 ctx（无 webServer，0.1.1 `rpc.handle` 结构性失效）、`register(owner,channel,handler)` 内部 `owner.effect(()=>owner.webServer.register(route))` —— 故插件必须 `inject=['connection','webServer']` 并直接调 `ctx.connection.register(ctx,'/usage',handle)`。taste 宿主 `inject` 同样含 `connection,webServer`（实证）。`lib/rpc.js` 的注册姿势、handler 形状 `(endpoint,payload,signal)=>({ok,value}\|{ok:false,error})`、双绑 dispose 与 taste 逐点一致；通道名 `/usage` 通过 `assertChannel` 正则；9 端点与 db.js 聚合函数一一对应；参数校验/unknown-endpoint/db-unavailable/refresh 行为符合 REVIEW §3 P0 最小修法；连带修复的 `queryHeatmap` 双 WHERE 剥离正确（heatmap 端点实测返回按日总量网格）。 |
| **P1** `insertEvent` 最新观测胜出 | ✅ 通过 | SQL 与复核裁决逐字一致（`ON CONFLICT(data_source,session_id,dedup_key) DO UPDATE SET … WHERE excluded.ts >= usage_events.ts`）；返回 true 仅当真正插入新行（前置 SELECT 判定，`node:sqlite` 的 `changes` 对插入/更新双路径均记 1 的实测前提已在注释与 U05 断言覆盖）。verify.mjs P1 独立复算（原始转录按 (sessionId,message.id) 取末条）：DB == 终值口径**逐项精确相等**（out=12,767,817 / cr=1,385,726,932 / cw=42,529,305）；首条口径 4,977,433 / 1,103,100,139 / 51,005,431 与 REVIEW §3 记录完全吻合；cc `output_tokens=0` 行 6,782 → **98**。连带一致性：`foldDshSource`/`foldCcSource` 受影响日集合覆盖每个事件（插入或更新），`usage_daily` 收敛。dsh 源不受影响（同键同值，冲突更新恒等；U05 断言覆盖后写/过期 ts 两分支）。 |
| **P2** 验收基准 22,700 | ✅ 通过 | verify.mjs U07 断言 `ccTotal === 22700`（本档实测 22,700）；原始 41,071（本档独立复算 raw=41,071，含 18,371 条流式重录）保留为信息性交叉核对；README 统计口径节已注明 41,071 与 22,700 的原始/去重关系。 |
| **P3** `dsh.client.inject` + 客户端防御 | ✅ 通过 | `package.json` `dsh.client.inject=["@deepseek-ai/dsh-client-connection"]` 与 taste 安装件形态一致（taste 的 inject 显式列出 bundle 消费的该客户端包）；`lib/client.js` `inject()` 返回 `rpc: ctx.connection?.rpc ?? null`，卡片 `rpcAvailable = rpc && typeof rpc.call === 'function'`、`sessions.select` 类型守卫、`useStore` 占位 —— 注入缺失时落到现成「宿主未注册 /usage RPC 通道」文案，不白屏。bundle-smoke 实测注入面 `{useStore,rpc,sessions}` 齐全。 |
| **P4** `user_version` 迁移入口 | ✅ 通过 | `openUsageDb` 打开时先读 `PRAGMA user_version`，>1 拒绝打开（downgrade guard，提示升级插件）并留 v1 唯一在产、未来按版本迁移的注释；v0→v1 由幂等 `ensureSchema` 引导，`user_version=1` 保持。 |

### 6.2 复跑验证（本档实测）

- `node --check` ×10（8 个 lib + smoke.mjs + test/verify.mjs + test/bundle-smoke.mjs）+ `package.json` JSON 解析：**全部通过**。
- `node test/verify.mjs`：**42/42 PASS** —— 检查项构成与 VERIFY.md §7「42/42」一致（U05×8、U04×5、U06×6、U07×6、P1×2、聚合×1、U08×14）。dsh=49,279 / cc=22,700 / summary requests=71,979（`test/verify-result.json` pass=true 已落盘）。
- `node smoke.mjs`：dsh 50 / cc 17（message.id 去重）；requests=67、input=572,849、output=53,538、cacheRead=3,707,136、cacheWrite=0、命中率 86.6% —— 与 VERIFY.md §3 返工轮记录**逐项一致**。
- `node test/bundle-smoke.mjs`：bundle 加载 OK、`exports=['apply','inject']`、`inject=['slots','connection','sessions']`、slot key=`dsh-usage`/locale=`dshUsage`、注入面齐全 —— 与 VERIFY.md §2 一致。
- `bash scripts/install-web2.sh --dry-run`：5 项拷贝目标 + patch 追加块正确；web2 patch 当前无 `usage` id 冲突（宿主级安装仍留待主 agent 按 U12 执行 —— 本复核遵守「只写 /home/CNS2026495165/dsh 之下」规则，未写入 `~/.dsh/profiles`）。

### 6.3 数字一致性（VERIFY.md 返工轮记录 vs 本档实测）

- **cc 侧（P1 修复目标）逐项精确一致**：去重 22,700、终值口径四桶 out=12,767,817 / cr=1,385,726,932 / cw=42,529,305、零输出行 98、原始 41,071；firstWins 对照 4,977,433 / 1,103,100,139 / 51,005,431 与 REVIEW §3 P1 完全吻合。
- **dsh 侧按文档化漂移策略微涨**：VERIFY.md 终跑 49,193 → 本档 49,279（requests 71,893 → 71,979；全源四桶中 dsh 驱动桶同步微涨、cacheWrite=42,529,305 精确不变）。verify.mjs 将 47,846 基准漂移显式标注为信息性观察，与 §4/§7 漂移说明一致，非实现缺陷（宿主会话持续追加属预期）。

### 6.4 副作用/回归检查

- **GUI 卡片 rpc.call 链路**：卡片 9 个端点名与载荷逐一通过宿主 `ENDPOINTS`/`normalizeFilters`（timeseries.granularity='day'、heatmap.year=整数、sessions.limit=200≤500、dataSources∈{all,dsh,cc}）；`rpc.call(channel,endpoint,payload)` 三参签名与安装版 dsh-client-connection 客户端一致；通道 `/usage` 通过客户端 `assertTarget`。**无回归**。
- **ingest 增量幂等性**：冻结副本二次运行新增 0（pass1 dsh=9,889/cc=14,311 → pass2 0/0）；UPSERT 不改变去重语义（冲突更新非新事件，`newEvents` 由前置 SELECT 决定）；未变文件由 `sync_state` mtime/size 门跳过。**无回归**。
- **新观察（轻微，P4 级，不构成返工）**：`lib/rpc.js` 的错误信封为 `{ok:false, error:{code,message}}` 而无 `details` 字段；安装版 dsh-client-connection 客户端 `parseConnectionResponse` 严格要求 `error.details` 为 record（缺失即 throw，本档用安装件解析逻辑实测复现）。影响仅限错误路径的文案保真（GUI 显示「transport: connection: invalid server-response failure」而非具体 code/message）；happy path 不受影响、不白屏；安装版 dsh-taste 的 handler 错误信封同形（平台先例，非本插件独有）。最小修法：`lib/rpc.js` 各错误对象补 `details: {}`，建议下轮顺手修。

### 6.5 结论

- **通过（pass）**，返工面（P0–P4）已全部关闭；无需再返工。
- 遗留事项（均不阻塞）：① 上述 P4 级错误信封 `details` 观察；② 宿主级终验（按 U12 装入 web2 后验证 U09 验收 1–4：宿主日志、`/usage/status` 可调、卡片渲染与下钻、与 btw/wallpaper/taste 互不干扰）—— 需主 agent 在宿主 profile 执行。
