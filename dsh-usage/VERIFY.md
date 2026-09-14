# dsh-usage 执行与验证记录（AUDIT F 节交付）

> 阶段：修订并执行（Revise & Execute，`adam/deepseek-v4-flash`）
> 日期：2026-09-12 · 环境：Node v22.23.2（node:sqlite 可用）、宿主 web2 profile（cordis 0.1.5）
> 依据：`AUDIT.md`（U01–U12）与 `DESIGN.md`（未修改）
> 复跑方式：`node test/verify.mjs`（输出 `test/verify-result.json`）；`node smoke.mjs`；语法检查见「校验」节。

## 1. 交付单元状态

| 单元 | 内容 | 状态 | 说明 |
|---|---|---|---|
| U01 | 包骨架 `package.json`（name `@local/dsh-usage`、exports、dsh.client/bundle 声明、engines、peerDeps） | ✅ 完成 | 照抄 btw/taste 安装形态；`dsh.client.platform=web` + `inject=[]`（客户端 bundle 自带 inject） |
| U02 | 宿主入口 `lib/index.js`（`id:'usage'`、inject=['connection']、B8 空 Config、ingest 调度、生命周期） | ✅ 完成 | web2 patch 现有 id：vision-adam / agent-presets / taste / btw / wallpaper —— 无 `usage` 冲突 |
| U03 | `lib/zstd.js` 多帧 zstd（B1：结构帧扫描逐帧解压、tornStart、splitJsonLines） | ✅ 完成 | 宿主 `scanZstdFrames` 算法逐字移植 |
| U04 | `lib/db.js`（B2 去重键、B3 桶、STRICT schema、user_version=1、aggregate 查询） | ✅ 完成 | 见 §2 验收明细 |
| U05 | `lib/ingest-dsh.js`（枚举、增量折叠、last-seen request/header 归属、B5 并集去重） | ✅ 完成 | 见 §2 验收明细 |
| U06 | `lib/ingest-cc.js`（枚举、B3/B7 桶映射、message.id 去重、subagent 归属、cwd 权威项目） | ✅ 完成 | 见 §2 验收明细；冲突键策略经复核裁决改为「最新观测胜出」（见 §4/§7 返工轮） |
| U07 | 宿主 RPC 通道 `lib/rpc.js` | ✅ 完成（返工轮） | 复核裁决 0.1.5 API：`ctx.connection.register(ctx, '/usage', handle)` + `webServer` inject（taste 安装件实证）；9 端点实现并经 ctx stub 验收（见 §7） |
| U08 | 宿主接线 `lib/index.js` step 4 = `registerUsageRpc(ctx,…)` | ✅ 完成（返工轮） | `inject=['connection','webServer']`；settings 注册后同步接线 registerUsageRpc；dispose 并入生命周期（见 §7） |
| U09 | 客户端 `lib/charts.js` + `lib/client.js`（settings.plugin.item key='dsh-usage'、自绘 SVG、轮询、下钻） | ✅ 完成 | 见 §2「客户端」验收；`useStore` 按审计未定义 → `()=>({})` 占位（B8 空 namespace，卡片不读设置项） |
| U10 | `README.md`（用途/范围、统计口径、架构、INSTALL） | ✅ 完成 | 含「宿主未注册 /usage 通道」已知限制说明 |
| U11 | `scripts/install-web2.sh`（幂等安装/卸载，--dry-run/--uninstall） | ✅ 完成 | dry-run 实测输出目标路径与 patch 变更正确（§2） |
| U12 | `smoke.mjs`（独立冒烟：真实会话日志 ingest + 聚合数字） | ✅ 完成 | 实测通过（§3） |

另交付（执行档自检，未扩范围）：`test/verify.mjs` + `test/verify-result.json`（验收脚本与结果）、`data/.gitignore`（回退链末位目录，不入库）。

## 2. 验收明细（`node test/verify.mjs` 实测，全部 PASS）

- **U04 zstd**：最大真实文件 22,808,279 B → 82,430 行、首行为 session 记录、`completeBytes === size`；合成撕裂帧 → `tornStart` 置位不抛错；双帧拼接 → 2 帧。
- **U05 db**：`user_version=1`；重开幂等；`usage_events` 表含 `dedup_key`/`is_subagent`；同键二次 insert 不新增；cc 行 turn/step 为 NULL 且同 `message.id` 不双计。
- **U06 dsh 全量**：扫描 ~1,690 文件（审计时 1,656，宿主持续新增/压缩会话），`failedFiles=0`，并集事件 49,193（审计基准 47,846；见 §4 数据漂移说明；每次复跑因活数据略增）。provider/model 归属抽查 191/191 与最近前向 `request/header` 一致；每文件并集与独立重算完全一致（0 文件差异）。
- **U07 cc 全量**：扫描 388 文件（主 50 + subagent 338），`failedFiles=0`；去重后 22,700 事件（原始 41,071 = 含 18,371 条流式重录；**复核裁决 P2：验收基准 = 去重口径 22,700**，见 §4）。B3 公式复算 50/50 通过；subagent 抽查 50/50：`is_subagent=1` 且 `session_id`=记录 `sessionId`（父会话 uuid）；目录名逆编码 `-home-CNS…-Dexterous-Hand-23Dof` → `/home/CNS2026495165_Dexterous_Hand_23Dof`。**返工轮 P1 后为终值口径**：cc 输出 12,767,817 / 缓存读 1,385,726,932 / 缓存写 42,529,305（修复前首条口径 4,977,433 / 1,103,100,139 / 51,005,431，见 §7）。
- **增量幂等（冻结副本确定性测试）**：25 个大 dsh 文件 + 110 个 cc 文件拷贝到只读快照 → 首轮 dsh 9,889 / cc 14,311，次轮新增 0；且 dsh 快照的 parse 并集（9,889）与 DB fold 结果逐条相等。
- **增量机制证据**：`sync_state` 每源文件一行（mtime/size/fingerprint）；二次全扫对运行期间追加的会话仅新增增量事件（活数据预期行为，非重复入库）。
- **客户端 bundle（stub 加载实测）**：ModuleLoader 加载 OK；`exports.inject=['slots','connection','sessions']`；`apply(ctx)` 注册 `settings.plugin.item`（key=`dsh-usage`、locale=`dshUsage`）；注入面 `{useStore, rpc: ctx.connection.rpc, sessions: ctx.sessions}` 类型正确；`charts.js` 纯函数（areaPath/barRects/heatmapGrid/scaleBars/scaleArea/formatTokens）数值抽查通过。
- **U11 脚本 dry-run**：正确打印 5 项拷贝目标 + patch 追加块（幂等检测含）。web2 patch 无 `usage` id 冲突。

## 3. 冒烟结果（`node smoke.mjs`，1 个真实 dsh 会话 + 1 个真实 cc 转录）

- dsh：`--home-CNS2026495165-Dexterous_Hand_23Dof--/01106167-…/session.jsonl.zstd` → 解析 50 事件、0 解析错误。
- cc：`…/subagents/agent-a1b89e1ad58071e88.jsonl` → 17 事件（message.id 去重后）。
- 聚合（返工轮 P1 后，cc 为终值口径）：requests=67、input=572,849、output=53,538、cacheRead=3,707,136、cacheWrite=0、命中率 86.6%；按日 2 天、按模型/项目/会话下钻正常；`usage_daily` 2 行与按日聚合一致。（修复前同文件 output=45,575 —— 首条部分记录被 `INSERT OR IGNORE` 冻结。）

## 4. 上报项与复核裁决（2026-09-12 复核已逐项裁决，返工轮按裁决落地）

1. **U07 RPC API（0.1.1 vs 0.1.5）** → **复核裁决 P0**：真实 0.1.5 API 为
   `ctx.connection.register(ctx, '/usage', handler)`（taste bridge.js 实证；
   `dsh-client-connection` 源码 `get rpc()` 绑定 connection 服务自身 ctx，无 webServer，
   0.1.1 形态结构性消失）；`inject=['connection','webServer']`。→ **已实现**：`lib/rpc.js`
   + `lib/index.js` step 4（见 §7）。
2. **U07 验收 1 基准（41,071）与 B2 message.id 去重（22,700）矛盾** → **复核裁决 P2**：
   基准改为去重后口径 **22,700**；41,071 = 原始含 usage 行数（含 18,371 条流式重录），
   两者是同一数据的原始/去重双口径。verify.mjs 断言已更新为 `ccTotal === 22700`。
3. **B5「先写先赢」冻结 cc 首条部分用量** → **复核裁决 P1**：冲突键改「最新观测胜出」
   （`ON CONFLICT … DO UPDATE … WHERE excluded.ts >= usage_events.ts`）。→ **已实现**（见 §7）。
4. **数据漂移（非实现缺陷）**：dsh 并集审计基准 47,846 系审计时点冻结值，宿主持续追加/
   压缩会话（复核时点 48,788；返工轮 49,115）。实现正确性由「冻结副本幂等 + parse 并集与
   DB 逐条相等 + 归属抽查 191/191 + failedFiles=0」钉死，绝对数以复核时点全量扫描为准。

## 5. 校验（全部通过）

```bash
node --check lib/{index,zstd,db,ingest-dsh,ingest-cc,rpc,charts,client}.js   # 8/8 OK（返工轮新增 rpc.js）
node --check smoke.mjs test/verify.mjs test/bundle-smoke.mjs                 # OK
node -e "JSON.parse(readFileSync('package.json'))"                           # OK
bash scripts/install-web2.sh --dry-run                                       # OK（见 §2）
```

## 6. 未落地项（复核裁决后已全部落地，见 §7；仅余宿主级终验）

- ~~`lib/rpc.js`（U07）~~ → 已实现并接入（§7 P0）。
- ~~客户端卡片「宿主未注册 /usage RPC 通道」错误态~~ → 通道已注册；该文案现仅在不
  可注册/注入缺失时出现（`ctx.connection?.rpc ?? null` 防御，P3）。
- **宿主级终验（需主 agent 按 U12 装入 web2 后执行，本档沙箱不写 `~/.dsh/profiles`）**：
  U09 验收 1–4 —— 宿主日志 `dsh-usage` 初始化/首扫行、浏览器 `/usage/status` 可调、
  卡片渲染与下钻、与 btw/wallpaper/taste 互不干扰。

## 7. 返工轮（REVIEW P0–P4 修复，2026-09-12）

> 依据：`REVIEW.md` 问题清单（P0 阻塞 / P1 数据质量 / P2 基准裁决 / P3 风险 / P4 轻微）。
> 范围约束：只按复核最小修法落地，不扩范围、不做新设计决策。

### P0（阻塞）`/usage` RPC 通道 —— 已实现并接线

- **新增 `lib/rpc.js`**：`registerUsageRpc(ctx, {db, ingest, statusProvider})`，用 0.1.5
  真实 API `ctx.connection.register(ctx, '/usage', handle)`（对照安装的
  `@deepseek-ai/dsh-taste/lib/bridge.js` 0.1.5 移植注释 + `dsh-client-connection`
  源码 `register(owner, channel, handler)` / `rpcFetchHandler` 核实：handler 形状
  `(endpoint, payload, signal) => {ok,value}|{ok:false,error}`，返回值被 wire 原样包裹；
  0.1.1 `rpc.handle` 路由 owner 为无 webServer 的 connection 自身 ctx，结构性失效）。
  `ctx.effect(() => dispose, 'dsh-usage.rpc.channel')` 双绑 dispose（taste ISSUE-5 模式）。
- **9 端点**：`summary / timeseries / heatmap / byModel / byProject / byDay / sessions /
  status / refresh`，全部复用 `lib/db.js` 聚合函数；参数校验（from/to 接受毫秒或 ISO、
  from≤to、`dataSources ∈ {dsh,cc,all}` 或数组、granularity 白名单 `day`、year 整数、
  sessions.limit ∈ 1..500）失败返回 `{ok:false, error:{code:'invalid-params', message}}`；
  `refresh` 调 ingest 后回 status；`status` 返回 `{dbPath, dbSource, lastIngest,
  eventsDsh, eventsCc, scannedDsh, scannedCc, failedDsh, failedCc}`（客户端 statusLine
  消费 lastIngest/eventsDsh/eventsCc）。
- **`lib/index.js` 接线**：`inject=['connection','webServer']`（0.1.5 `register` 经
  `owner.webServer.register` 绑路由到本插件 ctx）；settings 注册后同步调用
  `registerUsageRpc(ctx, {db: () => db, ingest: runIngest, statusProvider})`（db 在 apply
  返回后的微任务中打开，getter 取最新引用，未就绪时端点回 `db-unavailable`）；statusProvider
  闭包读取 dbPath/dbSource/lastIngest/ingestSummary 与实时事件计数。
- **连带修复（P0 使该路径首次被执行暴露的存量缺陷）**：`queryHeatmap` 此前
  `WHERE ${where}` 双重前缀（eventWhere 已含 `WHERE `）→ 语法错误；改为剥离一次前缀后
  再拼装，`heatmap` 端点实测返回按日总量网格。
- **验收（verify.mjs U08 新增 17 项断言，全部 PASS）**：ctx stub 捕获 `/usage` handler →
  summary 与 `querySummary` 对账（requests=71,815）、timeseries 26 天、heatmap 10 格、
  三个维度表数组、sessions limit 生效（5 行）、status 事件数=dsh 49,115/cc 22,700、
  refresh 调 ingest 一次并回 status；非法 from/from>to/granularity/dataSources/limit →
  `{ok:false,invalid-params}`，未知端点 → `{ok:false,unknown-endpoint}`，均不抛异常。

### P1（数据质量）cc 冲突「最新观测胜出」—— 已实现并对账

- **`lib/db.js` `insertEvent`**：由 `INSERT OR IGNORE`（先写先赢）改为
  `INSERT … ON CONFLICT(data_source, session_id, dedup_key) DO UPDATE SET
  ts/model/provider/project/四桶 = excluded.* WHERE excluded.ts >= usage_events.ts`
  （复核裁决的精确 SQL）；返回 true 仅当真正插入新行（前置 SELECT 判定——
  `node:sqlite` 的 `changes` 对 UPSERT 的插入与更新路径都记 1，实测确认）。
- **cc 全量对账（verify.mjs 新增 P1 断言，DB 与原始转录按 (sessionId, message.id)
  取「末条终值」独立复算逐项相等）**：

  | 桶 | 首条口径（旧，INSERT OR IGNORE） | 末条终值口径（新） | 复核预期 |
  |---|---|---|---|
  | 输出 | 4,977,433 | **12,767,817** | 4,977,433 → 12,767,817 ✅ 一致 |
  | 缓存读 | 1,103,100,139 | **1,385,726,932** | 1,103,100,139 → 1,385,726,932 ✅ 一致 |
  | 缓存写 | 51,005,431 | **42,529,305** | 51,005,431 → 42,529,305 ✅ 一致 |
  | 输入 | — | 差异 <0.2% | 复核预期 <0.2% ✅ |

  `output_tokens=0` 行：6,782（修复前，30%，冻结的部分首条）→ **98**（修复后，真零输出）。
  原始 41,071 行中 18,371 条流式重录、去重 22,700 键不变；冻结副本二次运行新增 0（幂等保持）。
- 对 dsh 源无影响（chunk/message 同键同值，冲突更新恒等）；verify.mjs U05 新增
  「后写覆盖前写 / 过期 ts 不覆盖 / cc 同规则」断言全部 PASS。
- **连带一致性**：冲突 UPDATE 会改变 `usage_events` 数值，故 `foldDshSource` /
  `foldCcSource` 的受影响日集合改为覆盖「扫描到的每个事件」（无论插入还是更新），
  保证 `usage_daily` 随终值口径收敛（当前无查询消费 usage_daily，各聚合直读
  usage_events；该调整防止未来消费者读到过期日聚合）。

### P2（验收基准）cc 去重口径 22,700 —— 已更新断言与文档

- `test/verify.mjs` U07 断言改为 `ccTotal === 22700`（复核裁决基准），保留原始 41,071
  作为信息性交叉核对（`41071 = raw lines incl. 18371 streaming re-records`）；U06 漂移注记
  的文件数改为运行时实测。
- 41,071（原始含 usage 行数，DESIGN §2/A3 口径）与 22,700（去重后请求数）的关系已在
  `README.md`（统计口径节）与本文档 §4 注明。

### P3（风险）`dsh.client.inject` 与客户端防御 —— 已落地

- `package.json` `dsh.client.inject: [] → ["@deepseek-ai/dsh-client-connection"]`（照
  dsh-taste 安装件形态：taste 的 inject 显式列出 bundle 消费的 `@deepseek-ai/dsh-client-connection`）。
- `lib/client.js` `inject()` 改防御式：`rpc: ctx.connection?.rpc ?? null` —— 注入缺失时
  卡片落到现成的 `rpcAvailable=false`「宿主未注册 /usage RPC 通道」文案，不再渲染期
  TypeError 白屏。`test/bundle-smoke.mjs` 复跑通过（注入面 `{useStore, rpc, sessions}` 齐全）。

### P4（轻微）`user_version` 迁移入口 —— 已落地

- `openUsageDb` 打开时先读 `PRAGMA user_version`：> 1（v2+ 未来库）→ 拒绝打开（downgrade
  guard，提示升级插件），并留注释说明 v1 是唯一在产 schema、未来在此按版本迁移后再落
  `ensureSchema`（幂等 CREATE IF NOT EXISTS 即 v0→v1 引导，`user_version=1` 保持）。

### 返工轮复跑结果

```bash
node --check lib/{index,zstd,db,ingest-dsh,ingest-cc,rpc,charts,client}.js   # 8/8 OK
node test/verify.mjs    # 42/42 PASS（U05×8 + U04×5 + U06×6 + U07×6 + P1×2 + 聚合×1 + U08×14）
node smoke.mjs          # OK：dsh 50 / cc 17（终值口径），聚合与按日一致
node test/bundle-smoke.mjs  # OK：bundle 加载、apply 注册 slot、注入面齐全
```

汇总（最终复跑）：`dsh events=49,193 / cc events=22,700 / 请求数=71,893`；四桶（全源）=
输入 3,195,599,096 / 输出 74,078,355 / 缓存读 5,783,631,236 / 缓存写 42,529,305；
cc 终值口径四桶 = 输出 12,767,817 / 缓存读 1,385,726,932 / 缓存写 42,529,305。
（dsh 数字随宿主会话持续增长，见 §4 漂移说明。）
