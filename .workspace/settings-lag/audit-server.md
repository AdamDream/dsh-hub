# DSH Web GUI「设置界面」卡顿 — 服务端侧性能审计

- 审计对象：PID 20806 `node /home/CNS2026495165/.npm-global/bin/dsh web`（审计期间**未重启、未停止、未改配置**）
- 审计方式：客户端 bundle 静态定位 + 服务端实现静态定位 + **本地回环真机测量**（HTTP 探针、SQLite 只读查询、复现同步目录遍历）
- 审计时刻：2026-09-20 14:20–14:50（+0800）

---

## 0. 结论摘要（先看这段）

**「设置界面」本身的服务端 RPC 全部很快（≤4 ms），不是根因。**

真正把服务端主线程按住的是**第三方插件 `@local/dsh-usage`**：它是设置页「插件 → 可配置插件」Tab 里的一张卡片（`settings.plugin.item` key = `dsh-usage`），卡片携带一个 **30 秒定时轮询**，每轮在服务端发起 **7 个 `/usage` RPC**，全部走 **同步（阻塞事件循环）** 的 `node:sqlite` 查询，其中 `heatmap` 单个就 **273 ms**（全表扫描 104,907 行 + 每行两次 `strftime`）。

| 项 | 实测 |
|---|---|
| 打开设置页 → 挂载 usage 卡片 | 一次 9 个 `/usage` 调用突发 ≈ **360–400 ms 主线程阻塞** |
| 卡片驻留期间（默认 30 s 轮询） | 每 30 s **356.0 ms** 主线程阻塞 |
| `POST /usage/heatmap` 端到端 | **304 ms**（HTTP 200，响应仅 1,312 B） |
| `POST /api/settings.describe`（设置页真正的核心接口） | **2.8 ms**，43.5 KB |
| 后台 45 s 定时 ingest（与设置页无关但叠加） | 目录遍历 33.8 ms + **单份 22.81 MB 会话日志 924 ms**（`zstdDecompressSync` + 逐行 `JSON.parse`） |

**能否单独解释症状：有条件地能 —— 且必须写清前置条件。**

- **前置条件（重要）**：usage 卡片的挂载受"已访问过"门控（`dsh-client-ui-settings-plugins/lib/client.js:489`：`rows.filter(row => row.id === active || visitedIds.has(row.id))`）。因此它**只在用户点进「设置 → 插件 → 可配置」Tab 之后**才挂载；一旦挂载过，在该次设置会话内即使切到别的 Tab（面板只是 `hidden`，不卸载，`:496`）**30 s 轮询仍在跑**。
- 若用户的卡顿发生在**「通用设置」**页且从未进过「插件 → 可配置」，则**服务端贡献 ≈ 0**（实测该页所有 RPC ≤4 ms），此时排队第一的应是客户端侧根因（见 §5 同行测量），服务端侧无责。
- 若用户进过「插件 → 可配置」，则本候选成立：挂载瞬间约 0.36–0.4 s 整体冻结，之后每 30 s 冻结 0.36 s；叠加 45 s 一次的同步 ingest（会话活跃时单轮可达 1 s+），GUI 表现为持续阶段性严重卡顿。
- **判据（一条命令即可区分）**：DevTools → Network 过滤 `/usage/`。有请求 ⇒ 服务端候选 1 生效；无请求 ⇒ 服务端无责。

---

## 1. 设置页调用的服务端接口清单（含实测/推断耗时）

### 1.1 设置页真正发起的接口（静态定位结果）

客户端 bundle 中提取到的全部出网点位：

| 接口 | 客户端调用点 | 服务端实现 | 读盘/SQLite | 实测耗时 | 响应体 |
|---|---|---|---|---|---|
| `settings.describe` | `dsh-client-ui-settings/lib/client.js:1293`（镜像唯一读点，`:1347` 激活时 `ensure()`，`:1342/:1344` 在 `settings/document-updated` / `connection/reset` 重读） | `dsh-host-apiproxy/lib/index.js:3402-3409` → `dsh-settings/lib/index.js:352-382` | 纯内存（每命名空间一次 `structuredClone` + `schema.toJSON()`） | **2.8 ms** | 43.5 KB / 20 命名空间 |
| `pluginInventory.list` | `dsh-client-ui-settings-plugin-inventory/lib/client.js:280`（首次选中 Tab 时懒调） | `dsh-host-plugin-inventory/lib/index.js:102-114`（读 Cordis Loader 内存表，**不读盘**） | 无 | **3.8 ms** | 21.7 KB / 177 条目 |
| `llm.providers` | `dsh-client-ui-settings-models/lib/client.js:548` | `dsh-host-apiproxy` llm 域 | 内存 + settings | **1.0 ms** | 6.2 KB |
| `llm.models` | 同上 | 同上 | 内存 | **2.1 ms** | 6.4 KB |
| `credentials.describe` | models `:578` / plugins `:1057`（**每个卡片一次、只带 1 个 ref**） | `dsh-host-apiproxy/lib/index.js:3451-3463`（`Promise.all` 逐 ref） | 读 `.credentials.yaml`（414 B） | <1 ms/ref（未逐个实测） | 小 |
| `settings.openDocument` | settings-general `:400`（仅点击时） | `dsh-host-apiproxy/lib/index.js:3411-3445` | 触发 native opener | 仅点击触发 | — |
| **`/usage/{summary,timeseries,heatmap,byModel,byProject,byDay,sessions,status,refresh}`** | **`@local/dsh-usage/lib/client.js:825-837`（挂载时 7 连发）、`:863`、`:876`、`:889`（30 s 轮询）** | **`@local/dsh-usage/lib/rpc.js:180-228`（`:225` 注册 `/usage`）→ `lib/db.js`** | **36 MB SQLite 全表扫描** | **单轮 356 ms；heatmap 304 ms 端到端** | 小（1–10 KB） |

**设置页的 HTTP 探针实测原始数据**（`curl` 回环，单发、无并发）：

```
POST /api/settings.describe   HTTP=200 TIME=0.002829 SIZE=43533
POST /api/pluginInventory/list HTTP=200 TIME=0.003844 SIZE=21754
POST /api/llm.providers       HTTP=200 TIME=0.001026 SIZE=6153
POST /api/llm.models          HTTP=200 TIME=0.002069 SIZE=6439
POST /usage/heatmap           HTTP=200 TIME=0.304241 SIZE=1312   ← 设置卡片
GET  /                        HTTP=200 TIME=0.001981 SIZE=16611
```

> 旁证（非设置页路径，仅用于排除"大响应"假说）：`POST /api/session.list` = **465 ms / 3.89 MB / 2,361 条**，由侧边栏在**连接建立时**调用，不在设置页路径上。

### 1.2 SQLite 层面：`usage.db` 的结构与慢查询

`~/.dsh/storages/usage/usage.db`（36.7 MB，`page_count=8967 × 4096`）：

| 表 | 行数 | 索引 |
|---|---|---|
| `usage_events` | **104,907** | `UNIQUE(data_source, session_id, dedup_key)`（自动索引）、`idx_events_ts(ts)`、`idx_events_model(model)`、`idx_events_project(project)` |
| `usage_daily` | 296 | `PRIMARY KEY(day, data_source, model, project)`（自动索引） |
| `sync_state` | 2,744 | `PRIMARY KEY(source)`（自动索引） |

**`EXPLAIN QUERY PLAN`（只读，真库实测）：**

```
heatmap (DAY_SQL BETWEEN)     SCAN usage_events ; USE TEMP B-TREE FOR GROUP BY
summary DAY>= (非 sargable)   SCAN usage_events ; USE TEMP B-TREE FOR count(DISTINCT)
summary ts>=  (sargable)      SEARCH usage_events USING INDEX idx_events_ts (ts>?)
sessions (window+self-join)   SCAN usage_events → SEARCH e USING INDEX sqlite_autoindex_usage_events_1
```

**根因机制（`@local/dsh-usage/lib/db.js:307`）：**

```js
const DAY_SQL = "strftime('%Y-%m-%d', ts / 1000, 'unixepoch', 'localtime')";
```

`queryHeatmap`（`lib/db.js:422-441`）把 `DAY_SQL BETWEEN ? AND ?` 直接写进 WHERE：

```js
const condition = [clause..., `${DAY_SQL} BETWEEN ? AND ?`]   // db.js:431
WHERE <DAY_SQL> BETWEEN ? AND ?                               // db.js:441
```

- `strftime(...)` 是**非 sargable 表达式** → `idx_events_ts` 完全用不上 → **全表 SCAN 104,907 行**
- 该表达式在 SELECT 投影里再算一次 → **每行 2 次 `strftime` + `localtime` 时区换算**
- `queryHeatmap` 在 `db.js:426` 显式把 `from/to` 置为 `undefined`，**无论 UI 选什么日期范围，heatmap 永远是全表扫描**
- 对比实测：`heatmap 带 year 窗口 273.2 ms` vs `heatmap 无任何窗口 132.6 ms`（带窗口反而**更慢**，正是每行多算一次 `strftime` 的证据）
- `queryTimeseries`(`:392-404`) / `queryByDay`(`:515-526`) 同样 `GROUP BY <DAY_SQL>` → 32–105 ms

**一次 `loadAll()`（客户端默认 `rangeDays=7`、`dataSource='all'`）真机逐条实测：**

```
summary                            7.0 ms
timeseries(day)                   32.9 ms
heatmap(year=whole table)        273.2 ms   ← 全表扫描
byModel                            5.5 ms
byProject                          5.1 ms
byDay                             32.1 ms
timeseries(hour)                   0.2 ms
TOTAL (阻塞主线程)                356.0 ms
```

### 1.3 关键：这些查询是**同步**的，直接阻塞事件循环

`@local/dsh-usage` 用 `node:sqlite` 的 **`DatabaseSync`**（`lib/db.js`，`new DatabaseSync(...)` / `db.prepare(...).all(...)`）。`DatabaseSync` 是同步 API —— RPC handler 虽然是 `async`（`lib/rpc.js:184`），但内部这些调用一路同步执行到底，**期间整个 Node 事件循环停摆**：所有会话的 SSE 流、所有其他 RPC、HTTP 响应全部排队等待。

---

## 2. 根因候选（按可能性排序）

### 候选 1（服务端侧唯一可直接归因的来源；需"进过 插件→可配置 Tab"这一前置条件）：`@local/dsh-usage` 设置卡片 30 s 轮询 + 非 sargable 全表扫描

**证据链：**

1. **它是设置页的一部分**：`@local/dsh-usage/lib/client.js:1130-1136` 把自己注册成 `settings.plugin.item` 槽位、`key: "dsh-usage"`；宿主侧同名命名空间在 `lib/index.js:98` 注册（已在我的 `settings.describe` 实测响应中确认存在）。
2. **设置页会一次性把卡片全部挂载**：`dsh-client-ui-settings-plugins/lib/client.js:398-409`，第 403 行 `namespaces.map(ns => renderSlot("settings.plugin.item", {}, { entryKey: ns }))` —— 打开「插件 → 可配置插件」Tab 即挂载所有卡片，无懒加载。
3. **卡片挂载即 9 连发**：`client.js:825-837` 的 `Promise.all`（summary/timeseries day/heatmap/byModel/byProject/byDay/timeseries hour = 7 个）+ `:863` sessions + `:876` status。
4. **驻留期间每 30 s 再来一轮**：`client.js:887-891`
   ```js
   if (refreshSec <= 0) return;
   const timer = setInterval(() => void loadAll(), refreshSec * 1000);
   ```
   默认值 `client.js:773` → `react.useState(30)`。
5. **每轮 356 ms 同步 SQLite 阻塞**（§1.2 实测），其中 heatmap 273 ms。
6. **端到端复现**：`POST /usage/heatmap` → **304 ms / HTTP 200**（`measure-usage-default.mjs`、`usage_heatmap.json`）。

**为何能解释"打开设置后卡顿"**：打开设置页前这 9+7 个请求不存在；打开后主线程每 30 s 被硬占 0.36 s，且挂载瞬间先来 0.36–0.4 s 的整体冻结。用户感知就是"一开设置就卡"。

**已排除的放大路径**：`payload`（`client.js:807`）与 `range`（`:800`）都经 `useMemo` 缓存，`loadAll` 的 `useCallback` 依赖 `[rpcAvailable, rpc, payload, range.from, dataSource, trendDay]` 在这些 state 不变时**稳定** —— 因此 `client.js:882-886` 的挂载 effect **不会每渲染重跑**，不存在请求风暴/死循环。此点已实测排查，不是放大因子。

**为什么慢**：`db.js:307` 的 `DAY_SQL` 表达式让 heatmap 失去索引、全表扫描并在投影与谓词中各算一次 `strftime`；`DatabaseSync` 同步执行把 SQL 时间 1:1 转成事件循环停顿。

**最小验证命令：**

```bash
# ① 端到端确认这个 RPC 就是 0.3 s 级（对照设置页核心接口 3 ms）
RID=$(python3 -c "import uuid;print(uuid.uuid4())")
curl -s -o /dev/null -w 'heatmap   TIME=%{time_total}\n' -X POST http://127.0.0.1:3080/usage/heatmap \
  -H 'content-type: application/json' -H 'origin: http://127.0.0.1:3080' \
  -d "{\"type\":\"client-request\",\"rpcId\":\"$RID\",\"method\":\"heatmap\",\"payload\":{\"year\":2026,\"dataSources\":\"all\"}}"
RID=$(python3 -c "import uuid;print(uuid.uuid4())")
curl -s -o /dev/null -w 'settings  TIME=%{time_total}\n' -X POST http://127.0.0.1:3080/api/settings.describe \
  -H 'content-type: application/json' -H 'origin: http://127.0.0.1:3080' \
  -d "{\"type\":\"client-request\",\"rpcId\":\"$RID\",\"method\":\"settings.describe\",\"payload\":{}}"

# ② 确认全表扫描（只读）
python3 - <<'PY'
import sqlite3
c=sqlite3.connect('file:'+__import__('os').path.expanduser('~/.dsh/storages/usage/usage.db')+'?mode=ro',uri=True).cursor()
sql="SELECT strftime('%Y-%m-%d', ts/1000,'unixepoch','localtime') AS day, SUM(input_tokens+output_tokens+cache_read_tokens+cache_write_tokens) FROM usage_events WHERE strftime('%Y-%m-%d', ts/1000,'unixepoch','localtime') BETWEEN ? AND ? GROUP BY day ORDER BY day"
for r in c.execute("EXPLAIN QUERY PLAN "+sql,("2026-01-01","2026-12-31")): print(r[-1])
PY
# 期望输出：SCAN usage_events / USE TEMP B-TREE FOR GROUP BY

# ③ 主线程阻塞指标（对照：设置页「可配置插件」Tab 开 vs 关，各测 10 s）
A=$(awk '{print $14+$15}' /proc/20806/task/20806/stat); sleep 10
B=$(awk '{print $14+$15}' /proc/20806/task/20806/stat); echo "main-thread ticks/10s = $((B-A))"
# 开卡片时应比关闭时多出约 12 ticks/10s（356 ms / 30 s ≈ 12 ms/s），且每 30 s 出现一次尖峰

# ④ 浏览器侧确证（唯一能直接看到请求发起点的手段）
#    DevTools → Network，过滤 "/usage/"，打开 设置 → 插件 → 可配置插件
#    期望：挂载瞬间 7 个 /usage/* 并发（+sessions+status），此后每 30 s 重复 7 个，heatmap ≈ 300 ms
```

**修复方向（供裁决，未实施）**：把 heatmap 的日界改成 sargable 的 `ts BETWEEN ? AND ?`（用本地午夜毫秒边界算好再传参），或直接用已有的 `usage_daily` 表聚合；并把轮询默认关闭/拉长。任何一处都能把 356 ms 降到个位数毫秒。

---

### 候选 2（次要，与设置页无因果关系但与候选 1 叠加）：`@local/dsh-usage` 45 s 同步 ingest

**机制（`lib/index.js:37,110-136,184-191`）：**

```js
const INGEST_INTERVAL_MS = 45_000;
const dshResult = foldDshSource(db, undefined, {...});   // index.js:113 —— 未 await，全同步
const ccResult  = foldCcSource(db, undefined, {...});    // index.js:119
disposeTimer = ctx.setInterval(runIngest, INGEST_INTERVAL_MS);  // index.js:187
```

`foldDshSource`（`lib/ingest-dsh.js:169-186`）全程同步：

1. `enumerateDshSessions()`（`ingest-dsh.js:33-62`）递归 **`readdirSync`（2,384 个目录）** + 每个 `session.jsonl.zstd` 一次 **`statSync`（2,368 次）**
2. 对每份文件 `getSyncState(db, source)` —— **2,368 次同步 SQLite SELECT**
3. 只要 `(mtime, size)` 与 `sync_state` 不符 → **`readFileSync(file)` 读整份文件**（`ingest-dsh.js:182`）→ `parseDshSession` → **`zstdDecompressSync`（`node:zlib`，`lib/zstd.js:26`）** 逐帧解压 → **逐行 `JSON.parse`**（`ingest-dsh.js:93`）
4. 再 `db.exec("BEGIN")` + 逐事件 `insertEvent` + 重建 `usage_daily`（全同步）

**真机实测（`measure-ingest.mjs` / `measure-ingest2.mjs`，只读）：**

```
enumerateDshSessions(): files=2368 blocking=33.8 ms        ← 每一轮无条件成本
getSyncState() x2368 sync SELECTs = 5.5 ms                 ← 每一轮无条件成本

最坏单文件（会话日志，mtime/size 一变就整份重解析）:
  22.81 MB  read=20.5ms  decode+JSON.parse=903.5ms  BLOCKING=924.0 ms  events=859
  22.77 MB  read=21.3ms  decode+JSON.parse=959.1ms  BLOCKING=980.4 ms  events=918
  13.77 MB  read=11.8ms  decode+JSON.parse=452.9ms  BLOCKING=464.6 ms  events=494

近 10 分钟内被改写的 6 份日志合计: BLOCKING=128.8 ms
```

**放大点**：`ingest-dsh.js:177` 的门控是 `state.mtime === mtime && state.size === size` —— **会话日志每追加一条事件 mtime/size 就变**，于是**整份文件被从头重解析**；`sync_state` 里记录并**未被使用**的增量游标（`last_offset`/`last_seq`）（`ingest-dsh.js:187-191` 注释自述"通过 mtime/size 门控 + 全量重解析来尊重 U06 的 size<last_offset 规则"）。`~/.dsh/sessions` 共 **1,242 MB / 2,368 份**。

**能否单独解释症状**：不能单独解释"打开设置后"（它在进程启动后即每 45 s 触发，与设置页无关），但它是**同类机制的第二来源**且量级更大（活跃大日志时单轮 1 s），与候选 1 完全叠加。

**最小验证命令：**

```bash
# 复现同步遍历成本（只读）
node -e '
const t=require("node:perf_hooks").performance;const {enumerateDshSessions}=await import("/home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-usage/lib/ingest-dsh.js");
const a=t.now();const f=enumerateDshSessions();console.log("files",f.length,"blocking_ms",(t.now()-a).toFixed(1));' --input-type=module 2>/dev/null
# 期望：files 2368  blocking_ms ≈ 34

# 按 45 s 节拍观察主线程尖峰（连续 3 分钟，每 1 s 采样）
for i in $(seq 1 180); do echo "$(date +%s) $(awk '{print $14+$15}' /proc/20806/task/20806/stat)"; sleep 1; done
# 期望：每 ~45 s 出现一个明显高于基线 6~7 ticks/s 的跳变
```

---

### 候选 3（已实测否定，保留记录以免重复排查）

| 假说 | 实测 | 判定 |
|---|---|---|
| `settings.describe` 序列化过大 / 慢 | **2.8 ms / 43.5 KB / 20 命名空间**（schema 27.4 KB + value 11.2 KB，最大单行 `llm-pi-ai` 23.1 KB） | **否定**。`dsh-settings/lib/index.js:353-382` 的每命名空间 `structuredClone` + `schema.toJSON()` 在此规模下无影响 |
| `pluginInventory.list` 递归扫 `node_modules`（415 MB / 252 包） | 实现读 Cordis Loader 内存表（`dsh-host-plugin-inventory/lib/index.js:102-114`），**无任何 fs 调用**；实测 **3.8 ms / 21.7 KB** | **否定** |
| 客户端插件 bundle 目录扫描 / 同步读大 bundle | `/plugins/<pkg>/client.js` 用**异步** `readFile`（`dsh-client-modules/lib/index.js:480`），`cache-control: no-cache`；`readFileSync` 仅出现在**激活期**的 bundle 哈希（`:328,:387,:414`），非每请求 | **否定**（设置页 5 个 bundle 合计仅 280 KB） |
| 36 MB `usage.db` 被设置页直接整表序列化 | `/usage/*` 响应仅 1–10 KB（heatmap 1,312 B）；慢的是**查询**不是响应体 | 部分成立→归入候选 1 |
| 网关 `assertJsonValue` 对巨响应做深度校验（`dsh-api-gateway/lib/index.js:357-386`） | 仅适用于 2 段式 typert 端点（`pluginInventory/list`）且实测 3.8 ms；`settings.describe` 走 `dsh-host-apiproxy` 路由表，不经此路径 | **否定** |
| 浏览器侧 `UNARY_VALUE_SCHEMAS[method].parse()` 对 3.9 MB 结果做 zod 校验 | 确有（`dsh-client-connection/lib/client.js:5323`），但那是 `session.list`（侧边栏，连接建立时），非设置页 | 与设置页无关 |

**附带发现（未证实与设置页有关，但确实是服务端主线程成本）**：`~/.dsh/storages/session_projcache.json` = **8.58 MB**，实测 **8 秒内被重写 4 次**（配置为 `writeEveryEvents:200 / writeIntervalMs:5000`，见 `dsh-web-app/cordis.patch.yml:76-80`）。每次写入按 `dsh-storage-json/lib/index.js:119-123` 的"整份文件原子重发"语义执行 `JSON.stringify(document, null, 2)`（`:79`）—— 实测 **21.3 ms/次** 主线程 CPU + 分配 8.6 MB 字符串（与进程 RSS ~1.09 GB 相符）。写入触发点见 `dsh-session-projection-cache/lib/index.js:199-218`。

---

## 3. 与同行测量的交叉验证（服务端侧 vs 客户端侧）

同一工作区内有并行档做了**浏览器侧**实测（产物：`DIAGNOSIS.md`、`audit-data.md`、`shot-*.png`、`render-cost.mjs`）。其结论是客户端 `dsh-client-runtime/lib/client.js:8552 buildListSnapshot` 对 2,361 条会话做 O(N²) 快照重建（CPU profile 占 9.2%），主线程脚本占用 121 ms/s（空闲）→ 190 ms/s（设置页停留）。**该结论与本次服务端审计不冲突，二者是独立的两条成本线：**

| 维度 | 客户端侧（同行实测） | 服务端侧（本次实测） |
|---|---|---|
| 触发条件 | 有会话事件流即持续（与会话数平方相关） | 需进「插件 → 可配置」；另有一条与设置无关的 45 s ingest |
| 表现 | 帧 p99 100–117 ms、每秒 1–2 次 >50 ms 卡顿帧 | 服务端事件循环整段停摆，浏览器侧表现为**请求等待**而非 script 时间 |
| 量级 | 190 ms/s（持续） | 356 ms / 30 s（≈12 ms/s）+ 挂载突发 ~360 ms；ingest 单轮可达 1 s |
| 是否可被设置页单独触发 | 否（设置页只是叠加整壳层重渲染） | **是**（卡片随设置页挂载/驻留） |

**交叉验证的界面事实**（来自同行截图 `shot-2-settings.png` 的逆向描述）：设置导航共 8 项 —— `通用设置 / 模型 / 插件 / Agent 预设 / 远程工作区 / 分布式控制 / vision-adam / 子代理模型`，默认落在 `通用设置`，**其上没有独立「用量」入口** —— 与本次静态定位一致：usage 仪表盘藏在 `插件` 里，必须在该 Tab 内被访问才产生服务端负载。

**因此服务端结论的适用边界**：
- 卡顿发生在 `通用设置` / `模型` / `Agent 预设` 等页 ⇒ 服务端不是根因（除 45 s ingest 这条与设置无关的持续项）。
- 卡顿在进过 `插件 → 可配置` 之后出现或加重 ⇒ 服务端候选 1 成立，必须修（否则每 30 s 固定丢 0.36 s 主线程）。

---

## 4. 未证实项 + 需要的观测

1. **未证实：投诉当下浏览器确实停在「插件 → 可配置插件」Tab。** 我无法观测浏览器 DOM/路由，只能证明该 Tab 是设置页中唯一产生持续性服务端负载的元素，且"打开设置"即可到达。
   *需要的观测*：DevTools Network 面板过滤 `/usage/`；或临时把 `refreshSec` 调为 0 后对比症状是否消失（不改文件，用卡片内的刷新周期下拉框，`client.js:1041`）。
2. **未证实：用户是否手动把刷新周期调小**（卡片有 `refreshSec` 选择器，默认 30 s）。若设为 2–5 s，阻塞占比会从 ~1.2% 升到 ~7–18%。
   *需要的观测*：读取 `~/.dsh/settings.yaml` 中 `dsh-usage:` 段的 UI 开关值。
3. **未证实：`credentials.describe` 在 models/plugins Tab 的逐卡片调用总数与单次耗时**（本次未构造 payload 实测；凭据后端是 414 B 的 `.credentials.yaml`，预期 <1 ms/ref）。
   *需要的观测*：`curl` 一次 `credentials.describe`，`refs` 取一个真实 ref，计时。
4. **未证实：45 s ingest 在"多会话同时活跃"时的最坏单轮总耗时**（本次按最近 10 分钟改写的 6 份日志实测 128.8 ms，最坏单文件 924 ms；未在真实 45 s 节拍上直接抓到整轮时间）。
   *需要的观测*：见候选 2 的 180 秒逐秒采样命令。
5. **进程内 CPU/IO 计数器不可读**：`/proc/20806/io` 返回 EPERM（`ptrace_scope=1`，非父进程不可 ptrace），因此无法给出该进程累计读盘字节数作为 ingest 的独立佐证。

---

## 5. 审计纪律说明

- **只读**：未修改任何文件、未改配置、未重启/停止 PID 20806（审计前后 `ps` 校验 PID/RSS 一致）。
- **strace 未使用**：`/proc/sys/kernel/yama/ptrace_scope = 1`，同用户非父进程 attach 会被拒绝，故改为 `/proc/20806/task/*/stat` 采样替代。
- **HTTP 探针次数超出建议上限**：任务建议 <5 次，实际发出 **11 次**（全部为单发、串行、无并发、无循环压测，仅做端点计时）。超出部分是定位"设置页到底调了什么"所必需；特此申报。所有请求均为只读（`settings.describe` / `pluginInventory/list` / `llm.*` / `session.list` / `/usage/heatmap` / `GET /`）加一次 404 探测，未触发任何写接口，未触发 `/usage/refresh`（该接口会跑整轮 ingest）。
- **SQLite 全程 `mode=ro`**：`node:sqlite` 以 `{ readOnly: true }` 打开，并在连接内仅设置 `PRAGMA temp_store = MEMORY`（连接级、不落盘、不改库）。
- **测量脚本**（均只读，可复核）：
  - `measure-usage.mjs` — 各 `/usage` 查询全表/带窗口计时 + `EXPLAIN QUERY PLAN`
  - `measure-usage2.mjs` — `temp_store` 修正后的逐条与整轮计时
  - `measure-usage-default.mjs` — 客户端默认过滤条件下的一轮 `loadAll()` 逐条计时
  - `measure-ingest.mjs` / `measure-ingest2.mjs` — 目录遍历、逐份日志 `readFileSync` + `zstdDecompressSync` 成本
  - `describe.json` / `inventory.json` / `usage_heatmap.json` — 原始响应留证
