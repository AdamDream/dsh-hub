# 设置页卡顿：只读宿主事件循环审计

- 审计时间：2026-09-21（当前 live PID 1209782，`dsh web`，未重启、未发信号）
- GUI：`http://127.0.0.1:3080`
- 纪律：只读源码/安装文件；HTTP 仅调用只读 RPC；SQLite 以 `mode=ro` / `DatabaseSync(..., {readOnly:true})` 查询；未写 live 数据、未改代码。
- 对照：`.workspace/settings-lag/DIAGNOSIS.md`、`.workspace/settings-lag/audit-server.md`、`.workspace/lag-fix/reports/unit-A.md`、`.workspace/lag-fix/reports/BEFORE-AFTER.md`。

## 结论先行

当前 live 已包含 usage heatmap 的快速路径：配对探针两次测得 heatmap 12.1 ms、2.14 ms，背景 `host.describe` 最大延迟 23.09 ms / 2.01 ms；门槛 `<40 ms` 通过，但样本只有两对，不能把“无卡顿”外推为长期证明。SQLite 真库为 110,335 events、306 daily rows；旧 heatmap 谓词仍解释为全表扫描，但当前 live `db.js` 已用 `usage_daily` 分段 + `ts` sargable 回落。

**因此，热力图修复已经消除了原先 285–306 ms 级的 host-loop 冻结；它不能解释仍存在的设置页卡顿。** 若用户仍感到卡顿，首要嫌疑转为客户端 session-list/projection churn（持续、与设置页整壳重渲染叠加），其次是 45 秒 ingest 在活跃大日志改变时的同步解压/JSON.parse 尖峰。只有在旧部署拷贝/未重启宿主仍加载旧 `db.js` 时，usage SQLite 才会重新升为第一嫌疑。

## 根因候选（按宿主事件循环占用排序）

### 1. 45 秒同步 usage ingest：最高瞬时占用，设置页无直接因果

**机制与 live 位置**

- `@local/dsh-usage/lib/index.js:109-136,184-191`：`runIngest` 是 async 外壳，但 `foldDshSource` / `foldCcSource` 内部同步执行；每 45 秒由 `ctx.setInterval` 调用。
- `ingest-dsh.js` / `ingest-cc.js` 使用 `readdirSync`、`statSync`、`readFileSync`、同步 SQLite；解析路径包含 `zstdDecompressSync` 和逐行 `JSON.parse`。
- mtime/size 门控改变时会重解析整个 session 日志，而不是使用 `last_offset` 增量游标（对照 `audit-server.md` §2 候选 2）。

**只读复测**

`node .workspace/settings-lag/measure-ingest2.mjs`：最大三个日志约 22.81 MB / 22.77 MB / 13.77 MB；本次 `read + decode/JSON.parse` 分别 **765.7 ms / 845.5 ms / 478.1 ms**。当前 live 会话文件数为 786（该探针使用当前目录状态），786 次只读 `sync_state` SELECT 为 1.9 ms。此前审计在更大活跃集上测到 924–980 ms 单文件阻塞。

**排序判断**：若大日志在 ingest tick 变更，单次占用可达约 0.5–1 秒，是所有候选中最大瞬时 host-loop 风险；目录枚举本身约 34 ms 级。它**不能单独解释“打开设置即卡”**，因为 45 秒 tick 与设置路由无关；但会与设置页期间的客户端 churn 及其他 RPC 叠加，造成周期性严重冻结。此前 `DIAGNOSIS.md` 已把“924 ms”限定为代码路径/独立测量，未在当时活动宿主上复现；故这里应标记为高影响、条件触发，而不是已捕获的当前 live tick。

### 2. usage SQLite RPC（旧 heatmap 路径）：历史上是设置触发的直接冻结；当前热力图修复后不再是第一位

**旧机制**

- `db.js:321` 的旧 `DAY_SQL = strftime(...)`，旧 `queryHeatmap` 在 WHERE 中对其做 BETWEEN，造成 `SCAN usage_events` + TEMP B-TREE；`DatabaseSync` 同步 API 在宿主主线程执行。
- 旧实测 heatmap 约 285–306 ms，loadAll 约 356–490 ms；挂载 usage 卡片后每 30 秒轮询，故可直接形成 0.3–0.5 秒冻结。

**当前 live 证据**

- `db.js:521-639` 已走 `usage_daily`（日对齐且不超过 `MAX(day)` 的段）和 `ts >= ? AND ts < ?` 的 sargable events 尾段；不支持的过滤维度回落 events。
- 只读 EXPLAIN 对照：旧谓词为 `SCAN usage_events` / `USE TEMP B-TREE FOR GROUP BY`；sargable 谓词为 `SEARCH usage_events USING INDEX idx_events_ts (ts>? AND ts<?)`。
- 当前 `usage.db`：37,855,232 bytes（约 36.1 MiB）、`usage_events=110335`、`usage_daily=306`、`sync_state=2831`。
- `.workspace/lag-fix/reports/settings-audit-host-pairs.json`：heatmap 12.1/2.14 ms；背景最大 23.09/2.01 ms；`blockUnder40ms=true`，但 `heatmapUnder1ms=false`。

**判定**：修复后不再支持“当前设置页必然由 heatmap 300 ms host freeze 导致”的说法。仍有两点边界：

1. live `db.js` 是宿主面，补丁需要重启才能加载；`unit-A.md` 明确说明未重启时不能把副本 0.081 ms 直接当 live 生效证据。
2. `loadAll()` 仍并发调用 summary/timeseries/byModel/byProject/byDay/hour 等同步查询；热力图只是最大旧热点，其他查询仍可能贡献几十毫秒，但当前配对结果未显示 >40 ms 冻结。

### 3. session projection/list + 客户端 session-list churn：最可能解释“仍然卡”，持续占用而非一次 host freeze

**服务端/RPC 侧**

- 当前 `session.list` 只读请求两次：约 **194.6 ms / 174.0 ms，472,338 bytes**。这不是设置页核心 RPC，但连接/列表更新会把 742 条当前列表（历史基线曾为 2,361–2,396 条）送到浏览器，并形成解析/投影压力。
- `dsh-host-apiproxy` 的 `settings.describe` 仍是内存路径；实测：settings.describe 3.36 ms / 43.5 KB，pluginInventory/list 0.94 ms，llm.providers 1.27 ms，llm.models 2.60 ms。普通设置 RPC 不是 host-loop 根因。

**客户端 live 代码热点**

- `dsh-client-runtime/lib/client.js:8553-8589`：`buildListSnapshot()` 每次将 summaries 全量 map、`flattenLineage` 后清理 entry cache；`:8576` 仍是 `for (entryCache) ... items.some(...)` 的 O(N²) 清理。
- `:8596` 的 upsert 仍使用 `summaries.find(...)`；`:9217-9283` 的 `projectList()` 每次构造全新的 `ids`、`byId` 和对象并调用 `list.set(...)`，使下游订阅树收到新引用。
- workspace-enhancement `lib/client.js:4109-4127` 的 remoteSessionIndex 已使用 Set 去重；`:5418-5436` 的 sessions projection 已按 snapshot identity memoize。这些局部修复减少了插件附加成本，但没有消除 runtime 的 O(N²) 清理或 projectList 新引用风暴。

**对照实测与判定**

`DIAGNOSIS.md` / `BEFORE-AFTER.md` 的原始条件下：WS 约 73 帧/s、N=2,361，设置停留 script 约 **189.8 ms/s**，p99 约 116.7 ms，>50 ms 帧 40；CPU profile 第一热点 `buildListSnapshot` 9.2%。受控基准 N=2,361 时旧清理约 5.225 ms/次，新 Set 路径约 0.0838 ms/次（仅说明算法段收益，不能等价于端到端页面收益）。

**排序判断**：这是当前仍能解释“设置页卡顿”的第一候选：它持续发生，只要会话事件流存在；设置面板/renderer 缺少 memo 边界，会被全树列表 churn 被动卷入。它解释的是浏览器帧和 script 忙，不是宿主 Node 事件循环冻结；因此应与候选 1/2 分开计量，不能用 host.describe 单一指标否定它。

### 4. session projection cache / loader：中低概率，需区分启动成本与持续成本

- `dsh-session-projection-cache/lib/index.js:199-227,234-249`：按事件数/时间触发 checkpoint，写路径异步外壳内包含 durable storage flush；`audit-server.md` 记录 `session_projcache.json` 约 8.58 MB，8 秒内重写 4 次，每次 `JSON.stringify` 约 21.3 ms + 8.6 MB 分配。
- 该成本可能占用宿主主线程几十毫秒并制造 GC/IO 抖动，但低于活跃大日志 ingest 的 0.5–1 秒，也不像 usage heatmap 旧路径那样由进入设置页直接触发。
- loader / plugin inventory 不是当前根因：`pluginInventory.list` 只读 Cordis loader 内存表，不扫 node_modules；当前实测 <4 ms。`settings.describe` 约 3 ms，且无设置页特有的持续 timer/rAF/observer。
- `session_projcache.json` 启动解析是一次性成本（此前约 42.5 ms），不能解释持续设置卡顿。

## “插件 RPC / loader / settings 页自身”排除结果

| 路径 | 当前观测 | 判定 |
|---|---:|---|
| `settings.describe` | 3.36 ms，43.5 KB | 排除为根因 |
| `pluginInventory/list` | 0.94 ms（历史 3.8 ms） | 排除 node_modules 扫描假说 |
| `llm.providers` / `llm.models` | 1.27 / 2.60 ms | 排除 |
| usage heatmap（当前 live） | 2.14–12.1 ms，配对 host max 23.09 ms | 修复后非第一位；旧 live/未重启仍需警惕 |
| `session.list` | 174–195 ms，472 KB | 不是 settings RPC，但会把列表/投影成本交给客户端；需与帧 profile 联测 |
| loader/bundle 读取 | 设置服务端路径无同步 node_modules 扫描；客户端 bundle 读取为异步 | 排除为持续 host-loop 根因 |

## 与四份既有报告的裁决对照

1. **与 `DIAGNOSIS.md` 一致**：M1（usage 同步 SQLite）曾是条件触发的直接冻结；M2（session-list churn）是持续客户端成本，设置页是放大器而非唯一源头。
2. **对 `audit-server.md` 的更新**：其候选 1 对“旧代码/重启前”的结论成立；本次 live 代码和配对探针显示 A1 修复已在当前宿主路径上反映为低毫秒 heatmap。不要继续把旧 285–306 ms 数字写成当前事实。
3. **与 `unit-A.md` 一致**：A1/A2/B2 的验收副本数据强，且强调 `db.js` 需要重启；本次没有重启，因此“补丁是否由当前 PID 加载”是必须保留的生效边界。配对探针是当前 PID 的低风险实测，显示当前 endpoint 已低延迟，但不替代完整重启后验收。
4. **与 `BEFORE-AFTER.md` 一致**：其宿主侧明确“重启前基线”及客户端门槛不可归因警告；当前 session.list 仍有约 175–195 ms 网络/RPC wall time，客户端负载必须固定 N、WS 速率、多次取中位数，不得用单窗口声称修复完成。

## 最小下一步（仍只读）

1. 通过已存在的浏览器探针在**不进入插件可配置 Tab**与**进入后**各测固定窗口，记录 `/usage/*`、WS 事件率、rAF/script；只看 Network/Performance，不点写操作。
2. 对当前 PID 做一次足够长的 host probe（至少覆盖两个 45 秒 ingest tick），并将 `>100 ms` 尖峰与 `lastIngest` 时间对齐；不要把独立 `measure-ingest2` 的最坏值当活动 tick 证据。
3. 固定当前 session N、WS 帧率，复跑设置 open/停留三次，单独报告 `buildListSnapshot/projectList` 的 CPU 与设置子树 render 次数。该项最有希望解释“heatmap 修复后仍卡”。
4. 若要确认 `db.js` 是否由当前宿主加载，只能在不重启的前提下继续通过当前 live endpoint 观察；不要通过修改 live 文件或发信号验证。

## 证据文件

- 当前配对探针：`.workspace/lag-fix/reports/settings-audit-host-pairs.json`
- 既有宿主基线：`.workspace/lag-fix/reports/host-latency-before-restart.json`
- 原始诊断：`.workspace/settings-lag/DIAGNOSIS.md`
- 服务端审计：`.workspace/settings-lag/audit-server.md`
- 单元 A：`.workspace/lag-fix/reports/unit-A.md`
- 前后对照：`.workspace/lag-fix/reports/BEFORE-AFTER.md`
