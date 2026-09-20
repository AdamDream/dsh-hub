# 设置界面卡顿 —— 数据体量与加载路径审计

- 日期：2026-09-20
- 目标：判定「打开设置界面后严重卡顿」是否由**数据体量**与**加载路径**造成
- 宿主：`node /home/CNS2026495165/.npm-global/bin/dsh web`，PID 20806（**全程未重启、未改动配置**）
- 纪律：全程只读。SQLite 一律 `file:...?mode=ro`；未执行 VACUUM / ANALYZE；未写入任何 `~/.dsh` 文件
- 代码根：`~/.dsh/profiles/node_modules/@deepseek-ai/*` 与 `@local/*`（软链至 `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`）

---

## 0. 结论摘要（TL;DR）

| # | 数据源 | 体量 | 是否在设置页路径上 | 判定 |
|---|---|---|---|---|
| 1 | `sessions/`（1.2G / 2367 文件 / 2383 目录） | 大 | ❌ 设置页不枚举 | **体积大但与设置页无关** |
| 2 | `skills/`（116M du / 12938 文件） | 大 | ❌ 设置页不读取 | **体积大但与设置页无关** |
| 3 | `profiles/`（424M） | 大 | ❌ 仅启动时加载 | **体积大但与设置页无关** |
| 4 | `session_projcache.json`（8.7M） | 中 | ❌ 后台写入路径，非设置页读取路径 | **无关（但持续占用 CPU/IO，见 §3.3）** |
| 5 | **`usage.db`（36M / 104907 行）经 `@local/dsh-usage` 插件** | 中 | ✅ **设置页「插件」标签，挂载即发 8 个 RPC** | **✅ 机制 M1 成因** |
| 6 | **实时事件流（`session/event`）持续重渲染** | 与体量无关 | ✅ **设置面板是覆盖层不卸载对话** | **✅ 机制 M2 成因** |

**一句话判定**：卡顿的充分原因**不是** `sessions/`、`skills/`、`profiles/` 的体量（设置页根本不读它们），而是两条与体量无关的机制叠加：

- **M1（宿主侧）**：设置页「Plugins」标签里 `@local/dsh-usage` 卡片挂载即发 8 个 RPC，在宿主主线程上串行同步执行 `node:sqlite` 查询，实测 **0.51–0.55 s**（`heatmap` 单项 290 ms），且**每 30 秒重复**；
- **M2（客户端侧）**：设置面板是 `position:fixed` **覆盖层，不卸载其下的会话视图**，`session/event` 事件流（实测 **1309 帧/20 s**）持续触发重渲染，设置打开期间脚本负载 **121 → 190 ms/s（+57%）**、卡顿帧 **22 → 40（+82%）**。

判定依据：**"关闭设置"后的空窗同样要 1389 ms 脚本时间**，与打开任一标签相当 —— 证明主因不在设置面板内容，而在常驻事件重渲染与后台重写。

---

## 1. 逐项量化

### 1.1 体积与条目数（只读统计）

```bash
cd ~/.dsh
du -sh sessions profiles skills storages attachments          # 体积
find sessions -type f | wc -l                                 # 文件数
find sessions -type d | wc -l                                 # 目录数
find sessions -maxdepth 2 -type d -name 'session-*' | wc -l   # 会话目录数
find skills -type f | wc -l
```

| 目录 | du 体积 | 文件数 | 目录数 | 最大单文件 |
|---|---|---|---|---|
| `sessions/` | **1.2 G** | 2372 | 2383 | `session-6a7367fe….jsonl.zstd` **22.8 MB** |
| `profiles/` | **424 M** | 74816 | — | `@local/dsh-pptmaster` **244 M**；`dsh-workspace-enhancement` **159 M** |
| `skills/` | **116 M** | 12938 | 153 | `ppt-master/references/ai-image-comparison/rendering/vintage-poster.png` 1.88 MB |
| `storages/` | **51 M** | 1603 | 4 | `usage/usage.db` **36.7 MB**；`session_projcache.json` **8.71 MB** |
| `attachments/` | 17 M | — | — | — |

**`sessions/` 单工作区条目数**（`find <dir> -maxdepth 1 | wc -l`）：

| 条目数 | 工作区目录 |
|---|---|
| 936 | `--home-CNS2026495165-Dexterous_Hand_23Dof-Dexterous_Hand_23Dof--` |
| 573 | `--home-CNS2026495165-Dexterous_Hand_23Dof--` |
| 477 | `--home-CNS2026495165-dsh--` |
| 116 / 114 | RS / math |
| 其余 12 个 | ≤ 37 |

> 会话目录总数仅 **83**（`session-*` 目录），1.2 G 主要由 **22.8 MB 级的 zstd 日志**堆成，而非海量小文件。

**`skills/` 真实内容**：116 M 中 **`ppt-master` 一个 skill 占 116 M**；整个树只有 **2 个 `SKILL.md`**（合计 8.9 KB），其余 12936 个文件是参考图与模板。完整遍历该树（Node，实测）：

```
full skills tree walk: files=12938 bytes=75.8MB SKILL.md=2 (8.9KB)  45.1 ms
```

### 1.2 设置页真实加载路径（读代码判定，非按体积定罪）

设置页 DOM 由 `dsh-client-ui-settings-general/lib/client.js` 的 `SettingsPanel` 渲染，**只挂载当前激活的一个 section**：

```js
// dsh-client-ui-settings-general/lib/client.js:157-164
children: active !== void 0 && renderSlot("settings.section", { close: onClose }, { only: active })
```

全部 `settings.section` 注册及其 order（`grep -rn -A4 'inject("settings.section"'`）：

| order | id | 默认？ |
|---|---|---|
| **0** | **`general`** | ✅ **默认打开**（`rows[0]`） |
| 10 | `models` | |
| 15 | `plugins` | ← `@local/dsh-usage` 卡片所在 |
| 20 | `agent-presets` | |

**默认打开的 `general` 标签页**：`GeneralSection` 仅 `renderSlot("settings.general.item")`，唯一网络调用是 `connection.api.settings.openDocument... ` 之前的 `describeFace.ensure()` → `settings.describe`。宿主实现 `dsh-host-apiproxy/lib/index.js:3411`：

```js
settings: { describe(request) {
  return Promise.resolve(ok(request, {
    writable: settings.writable,
    hasDocument: settings.documentPath !== void 0,
    namespaces: settings.describe({ redactSecrets: true }).map(namespaceView)
  }));
}}
```

`dsh-settings/lib/index.js:352 describe()` 只对**内存中已注册的 namespace**做 `structuredClone` + schema 序列化，**不触盘**。输入侧实测：`settings.yaml` 仅 **6201 字节**，已注册 namespace 共 **11** 个。

→ **打开设置页（默认 general 标签）= 无任何大文件读取**。CPU 侧只有 11 个 namespace 的 schema 序列化，量级可忽略。

**结论：`sessions/`、`skills/`、`profiles/` 均不在设置页读取路径上。**

---

## 2. `usage.db` 深挖

### 2.1 打开与基本参数

```bash
python3 -c "import sqlite3;c=sqlite3.connect('file:/home/CNS2026495165/.dsh/storages/usage/usage.db?mode=ro',uri=True);..."
```

| 项 | 值 |
|---|---|
| 文件大小 | 36,728,832 B（36.7 MB）+ `-wal` 8272 B + `-shm` 32768 B |
| `journal_mode` | `wal` |
| `page_size` | 4096 |
| `page_count` | 8967 |
| `freelist_count` | 0 |
| 只读打开耗时 | **0.07 ms** |

### 2.2 表与行数

| 表 | 行数 |
|---|---|
| `usage_events` | **104,907** |
| `usage_daily` | 296 |
| `sync_state` | 2,744 |

### 2.3 schema 与索引（`sqlite_master` 全量）

```sql
CREATE TABLE usage_events (
  id INTEGER PRIMARY KEY, data_source TEXT NOT NULL, session_id TEXT NOT NULL,
  dedup_key TEXT NOT NULL, ts INTEGER NOT NULL, model TEXT, provider TEXT, project TEXT,
  turn INTEGER, step INTEGER, is_subagent INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0, cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  UNIQUE(data_source, session_id, dedup_key)) STRICT;
CREATE INDEX idx_events_model   ON usage_events(model);
CREATE INDEX idx_events_project ON usage_events(project);
CREATE INDEX idx_events_ts      ON usage_events(ts);

CREATE TABLE usage_daily (
  day TEXT NOT NULL, data_source TEXT NOT NULL, model TEXT, project TEXT,
  requests INTEGER NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL, cache_write_tokens INTEGER NOT NULL,
  PRIMARY KEY(day, data_source, model, project)) STRICT;

CREATE TABLE sync_state (
  source TEXT PRIMARY KEY, mtime INTEGER, size INTEGER,
  fingerprint TEXT, last_seq INTEGER, last_offset INTEGER) STRICT;
```

**索引覆盖盘点**：`model` ✅ / `project` ✅ / `ts` ✅ / `(data_source,session_id,dedup_key)` ✅
**缺失**：`session_id` 单独索引 ❌；`strftime(ts)` 表达式索引 ❌

### 2.4 每表实际占用（`dbstat` 可用）

```bash
python3 -c "import sqlite3;cur=sqlite3.connect('file:...usage.db?mode=ro',uri=True).cursor();print(list(cur.execute('SELECT name,SUM(pgsize),COUNT(*) FROM dbstat GROUP BY name ORDER BY 2 DESC')))"
```

| 对象 | 字节 | 页数 |
|---|---|---|
| `usage_events` | 16,642,048 | 4,063 |
| `sqlite_autoindex_usage_events_1` | 8,241,152 | 2,012 |
| `idx_events_project` | 6,193,152 | 1,512 |
| `idx_events_model` | 2,752,512 | 672 |
| `idx_events_ts` | 1,769,472 | 432 |
| `sync_state`(+autoindex) | 1,028,096 | 251 |
| `usage_daily`(+autoindex) | 98,304 | 24 |
| `sqlite_schema` | 4,096 | 1 |
| **合计** | **36,728,832** | 8,967 |

> 索引总计约 **19 MB**，占库容 **52%** —— 索引并不少，问题在于**查询写法绕过了索引**（见 §2.5）。

### 2.5 `EXPLAIN QUERY PLAN` —— 缺索引/绕索引的全表扫描

```bash
python3 -c "import sqlite3;cur=sqlite3.connect('file:...?mode=ro',uri=True).cursor();print(list(cur.execute('EXPLAIN QUERY PLAN '+Q)))"
```

| 常见聚合 | 查询计划 | 判定 |
|---|---|---|
| `... GROUP BY session_id` | `SCAN usage_events` + `USE TEMP B-TREE FOR GROUP BY` | ⚠️ **全表扫描**（无 `session_id` 索引） |
| `... GROUP BY model` | `SCAN usage_events USING INDEX idx_events_model` | ✅ 走索引 |
| `... GROUP BY project` | `SCAN usage_events USING INDEX idx_events_project` | ✅ 走索引 |
| `... GROUP BY ts` | `SCAN usage_events USING INDEX idx_events_ts` | ✅ 走索引 |
| **`GROUP BY strftime('%Y-%m-%d', ts/1000,'unixepoch','localtime')`** | **`SCAN usage_events` + `USE TEMP B-TREE FOR GROUP BY`** | ⚠️ **全表扫描 + 临时 B 树**（表达式索引缺失，`idx_events_ts` 不可用） |
| `WHERE ts BETWEEN ? AND ?` | `SEARCH ... USING INDEX idx_events_ts` | ✅ 范围走索引 |
| `SELECT COUNT(*) FROM usage_events` | `SCAN usage_events` | 必然全表，但 <6 ms，无害 |
| `usage_daily` 任意聚合 | `SCAN usage_daily USING INDEX sqlite_autoindex…`（296 行） | ✅ 0.03 ms |

**实测耗时（Python sqlite3，`PRAGMA temp_store=MEMORY`）**：

| 聚合 | 行数 | 中位耗时 |
|---|---|---|
| `COUNT(*)` 全表 | 1 | 5.0 ms |
| `GROUP BY session_id`（无索引） | 2347 | **20.3 ms** |
| `GROUP BY model`（索引） | 21 | 9.2 ms |
| `GROUP BY project`（索引） | 61 | 8.5 ms |
| `GROUP BY strftime(day)`（绕索引） | 31 | **31.6 ms** |
| `usage_daily` 汇总（296 行） | 31 | **0.03 ms** |

**关键判断：`usage_events` 上的日/小时聚合是 CPU 密集的全表扫描 + 临时 B 树；而已经预聚合好的 `usage_daily` 只要 0.03 ms。** `usage.db` 里本来就有正确答案，但热路径没用它。

**冷/热对比（证明是 CPU bound 而非磁盘 bound）**：

```bash
cp ~/.dsh/storages/usage/usage.db /tmp/dsh-lag-proof/   # 仅用于计时，原库只读不动
```

| 数据源 | heatmap 同款聚合耗时 |
|---|---|
| `/tmp` 副本（冷页缓存） | 61.7 / 60.5 / 60.5 ms |
| 原库（热页缓存） | 60.1 / 59.1 / 58.9 ms |

→ 冷热**无差异**，瓶颈是 CPU（全表扫描 + 逐行 JS 映射），不是 IO。

---

## 3. `session_projcache.json`（8.71 MB）

### 3.1 结构与条目数（本地只读解析）

```bash
time python3 -c "import json;d=json.load(open('/home/CNS2026495165/.dsh/storages/session_projcache.json'));print(len(d['tables']['sessions']))"
```

| 项 | 值 |
|---|---|
| 文件大小 | 8,711,577 B（解析快照时 8,707,779 B） |
| 顶层键 | `unit` / `global` / `tables` |
| `unit` | `{"name":"session_projcache","version":3}` |
| 表 | `sessions` |
| **会话记录数** | **2365**（另有 `session_projcache/sessions/` 目录侧 1597 个按会话分片文件） |
| 每条记录结构 | `{identity:{createdAt,cwd}, rows:{…}}` |
| 每记录行数 | min 13 / **median 13** / max 15 |
| 总 checkpoint 行数 | 31,176 |
| `rows` 键 | `sessionStats, title, goal, tokenUsage, contextPressure, contextBreakdown, subagentTiming, subagent, permissions, **sessionListMetadata**, imageLimits, todos, plan` |

**解析耗时实测**：

| 操作 | 耗时 |
|---|---|
| `read` 文本 8.7 MB | 14.5 ms |
| `json.loads` | 23.2 ms |
| `read + parse`（合计） | **42.5 ms** |
| `json.dumps(indent=2)`（写出侧） | **127.6 ms** |
| **parse + stringify** | **170.1 ms / 次重写** |

### 3.2 是否在设置页/会话列表路径上被全量解析？

**读代码判定**：`dsh-session-projection-cache/lib/index.js`

```js
async [Service.init]() {
  const domain = await this.ctx.storageDomain.open(projectionCacheDomainSpec); // ← 打开时全量读+解析一次
  this.table = domain.table("sessions");
  ...
}
recordFor(id, expected) { const record = this.requireTable().get(id); ... }   // ← 此后纯内存 Map 查
cachedSnapshot(meta)    { const record = this.recordFor(meta.id, identityOf(meta)); ... } // ← 零 IO
```

- `recordFor()` / `cachedSnapshot()` 的注释明确写着 **"Synchronous from the domain's in-memory state"** / **"The zero-I/O listing read"** —— 会话列表读的是**已常驻内存的 Map**，**不会**每次全量解析 8.7 MB。
- **全量解析只在宿主启动时发生一次**（42.5 ms，一次性）。

**设置页路径上完全不涉及 projcache**：全仓 `cachedSnapshot` 调用点只有 `dsh-host-apiproxy`（会话历史 RPC）、`dsh-subagent`（子代理列表）与 `dsh-tool-cordis`；`settings.describe` / `openDocument` 均不触及。

### 3.3 但它确实在持续消耗 CPU/IO（与设置页无因果关系）

`dsh-storage-json` 是**整文件重写**后端：

```js
// dsh-storage-json/lib/index.js
async function writeAtomic(path, data) {          // 每次 put 都重写整个文件
  const tmp = join(dirname(path), `.${randomUUID()}.tmp`);
  const handle = await open(tmp, "wx", 384);
  await handle.writeFile(data, "utf8");
  await handle.sync();                            // fsync 文件
  await handle.close();
  await rename(tmp, path);
  await fsyncDirectory(dirname(path));            // 再 fsync 目录
}
function serialize(name, state) { ... return `${JSON.stringify(document, null, 2)}\n`; }  // 美化序列化 8.9 MB
```

而 `SessionProjectionCache.installWritePath()` 在 **`turn/end` 事件、计数阈值、时间阈值、session/disposed** 四处触发 `flushSoft → write → put → publish`（整文件重写）。

**实测重写节奏**（`stat` 轮询，30 秒窗口）：

```
14:26:10  8711574
14:26:12  8711574   ← 2.8 s 后
14:26:17  8711425   ← 4.9 s 后
14:26:23  8711424
14:26:31  8711357   ← 8.6 s 后
```

→ 有活跃会话时**每 3～9 秒重写一次 8.7 MB**（≈128 ms 序列化 + fsync 文件 + fsync 目录）。
**判定**：这是**后台写路径**，与"打开设置页"无关；但它持续制造主线程 CPU 与磁盘同步压力，可作为**背景噪音加剧**任何前台抖动——**不是**设置页卡顿的成因，单独**不能**解释症状。

---

## 4. `sessions/`（1.2 G）—— 谁在真正读它

设置页**不枚举** `sessions/`。真正遍历它的是 **`@local/dsh-usage` 插件的 ingest**：

```js
// @local/dsh-usage/lib/index.js:37
const INGEST_INTERVAL_MS = 45_000;      // 每 45 秒一次
// lib/ingest-dsh.js:15
import { readdirSync, readFileSync, statSync } from "node:fs";   // ← 同步 API
// enumerateDshSessions(): 递归 readdirSync + 每个匹配文件 statSync
if (entry.name !== "session.jsonl.zstd") continue;
stats = statSync(path);
```

**按该函数逐字复刻实测（Node）**：

| 项 | 值 |
|---|---|
| `enumerateDshSessions()` 命中文件 | **2367** |
| 累计字节 | **1183.6 MB** |
| **遍历耗时** | 27.5 / 29.2 / 30.9 / 33.1 / 42.9 ms，**中位 30.9 ms** |
| CC 侧（`~/.claude/projects`） | 388 文件 / 383.4 MB / 2.3 ms |

（ext4，`/dev/nvme0n1p2`）

**判定**：
- 纯遍历仅 **31 ms**（元数据已缓存），**不足以**造成严重卡顿。
- 但它是**每 45 秒无条件执行一次的同步文件系统调用块**，且随后按 `sync_state(mtime,size)` 跳过未变文件 —— 实测 45 分钟内变更文件仅 **11** 个，所以稳态 ingest 的重读与解码开销很小。
- 结论：**`sessions/` 的 1.2 G 体积与设置页卡顿无因果关系**；它只解释"后台有周期性负载"。

### 4.1 `skills/`（116 M）

设置页**不读取** skills。`skill.list` 的唯一前端消费方是 `dsh-client-ui-skill`，且它注册在 `tool.call.toolview` 槽（对话输入区技能目录），**不在任何 settings 槽**：

```js
// dsh-client-ui-skill/lib/client.js:227, 249
ctx.slots.inject("tool.call.toolview", ...);      // 非 settings 槽
const { result } = await skills.list({ sessionId }, abort.signal);
```

且 `dsh-skill-filesystem.list()` 走 `discoverRoot()`（按 skill 根发现候选），**不读资源图片**；`get()` 才读单个 `SKILL.md`。全树仅 2 个 `SKILL.md`（8.9 KB）。

**判定：`skills/` 116 M 属「体积大但与设置页完全无关」。** 即使被全量枚举，实测也仅 45 ms。

---

## 5. 真正的成因：`@local/dsh-usage` 用量卡片的挂载风暴

### 5.1 证据链

**① 该卡片确实挂在设置页里**（`@local/dsh-usage/lib/client.js`）：

```js
ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
  name: "settings.plugin.item", key: "dsh-usage", ...
}, UsageCard));
```

**② 它挂在 `plugins` 标签页，且该页会一次性挂载所有卡片**（`dsh-client-ui-settings-plugins/lib/client.js:403`）：

```js
children: namespaces.map((ns) => renderSlot("settings.plugin.item", {}, { entryKey: ns }))
```

**③ 卡片挂载即发 8 个 RPC，并每 30 秒轮询**（`@local/dsh-usage/lib/client.js:808-891`，已部署版本一致）：

```js
const [rangeDays] = useState(7);          // 默认 7 天窗口
const [refreshSec] = useState(30);        // 默认 30 秒轮询
useEffect(() => { loadAll(); loadSessions(); loadStatus(); }, [...]);   // 挂载即发
setInterval(() => loadAll(), 30_000);                                    // 每 30 秒再发 6 个
const calls = await Promise.all([
  rpc.call("/usage", "summary", payload),
  rpc.call("/usage", "timeseries", {granularity:"day", ...}),
  rpc.call("/usage", "heatmap", { year, dataSources }),   // ← 忽略 from/to，全量扫当年
  rpc.call("/usage", "byModel", payload),
  rpc.call("/usage", "byProject", payload),
  rpc.call("/usage", "byDay", payload),
  rpc.call("/usage", "timeseries", {granularity:"hour", ...}),
]);
rpc.call("/usage", "sessions", { ..., limit: 200 });      // 第 8 个
```

**④ 宿主侧是主线程同步 `node:sqlite`**（`@local/dsh-usage/lib/rpc.js:180`）：

```js
const handle = async (endpoint, payload, _signal) => {
  ...
  if (endpoint === "sessions") return { ok: true, value: querySessions(db, filters) };
```

函数虽标 `async`，但 `querySessions()` 内部是 `.all()` **同步调用**，直接在宿主主线程上跑完。

### 5.2 对**运行中的宿主**实测延迟（只读 POST `/usage/<endpoint>`，未改任何状态）

RPC 线协议取自 `dsh-client-connection/lib/client.js:10353`：
`POST /usage/<endpoint>`，body `{"type":"client-request","rpcId":…,"method":…,"payload":{…}}`

**逐端点（7 天窗口，`dataSources:"all"`，3～5 次取代表值）**：

| endpoint | 实测端到端 |
|---|---|
| `status`（2 个 `COUNT(*)`） | 12.3 ms |
| `summary` | 13～14 ms |
| `byModel` | 17～27 ms |
| `byProject` | 16～21 ms |
| `timeseries`（day） | 47～49 ms |
| `byDay` | 47 ms |
| `timeseries`（hour） | 47.6 ms |
| **`sessions`（limit 200）** | **38～41 ms** |
| **`heatmap`（全年，忽略 from/to）** | **285～292 ms** ← 最大单项 |

**复刻「卡片的 8 次挂载调用」（并发发出，宿主主线程串行执行）**：

| 轮次 | 8 并发总墙钟 |
|---|---|
| 首次 | **0.510 s** |
| 二次 | **0.525 s** |
| 三次 | **0.552 s** |

> 注：单看 `sessions` 仅 38 ms，但在 8 并发下它自己的墙钟被拉长到 **500 ms**（首轮观测）——这正是**宿主主线程被同步查询串行占满**的直接证据。

**为什么 `heatmap` 最贵**：它**丢弃** `from`/`to`，按整年扫描：

```js
// rpc.js
if (endpoint === "heatmap") return { ok: true, value: queryHeatmap(db, { year: filters.year, dataSources: filters.dataSources }) };
// db.js
const DAY_SQL = "strftime('%Y-%m-%d', ts / 1000, 'unixepoch', 'localtime')";
SELECT ${DAY_SQL} AS day, … FROM usage_events WHERE … GROUP BY day     // ← 绕开 idx_events_ts，全表扫 + 临时 B 树
```

**为什么 `sessions` 是第二贵**：CTE 自连接 `usage_events`，JOIN 条件 `e.session_id = l.session_id AND e.data_source = l.data_source`；实测计划显示 join 侧走 `SEARCH e USING INDEX sqlite_autoindex_usage_events_1 (data_source=? AND session_id=?)`，但外层有 `USE TEMP B-TREE FOR GROUP BY` 与 `USE TEMP B-TREE FOR ORDER BY` 两处排序开销：

```
CO-ROUTINE latest → SEARCH usage_events USING INDEX sqlite_autoindex_usage_events_1 (data_source=?)
                  → USE TEMP B-TREE FOR ORDER BY
SCAN l → SEARCH e USING INDEX sqlite_autoindex_usage_events_1 (data_source=? AND session_id=?)
       → USE TEMP B-TREE FOR GROUP BY / ORDER BY
```

### 5.3 复现命令（全部只读）

```bash
# 0) 取时间窗
NOW=$(python3 -c 'import time;print(int(time.time()*1000))'); FROM=$((NOW-7*86400000))

# 1) 单端点：heatmap（最贵，约 0.29 s）
curl -s -o /dev/null -w "heatmap %{time_total}s\n" -X POST -H 'content-type: application/json' \
  -d "{\"type\":\"client-request\",\"rpcId\":\"p1\",\"method\":\"heatmap\",\"payload\":{\"year\":2026,\"dataSources\":\"all\"}}" \
  http://127.0.0.1:3080/usage/heatmap

# 2) 复刻挂载风暴（8 并发，约 0.51–0.55 s）
for ep in summary timeseries byModel byProject byDay; do
  curl -s -o /dev/null -X POST -H 'content-type: application/json' \
    -d "{\"type\":\"client-request\",\"rpcId\":\"p-$ep\",\"method\":\"$ep\",\"payload\":{\"from\":$FROM,\"to\":$NOW,\"dataSources\":\"all\"}}" \
    http://127.0.0.1:3080/usage/$ep &
done
curl -s -o /dev/null -X POST -H 'content-type: application/json' \
  -d "{\"type\":\"client-request\",\"rpcId\":\"p-hm\",\"method\":\"heatmap\",\"payload\":{\"year\":2026,\"dataSources\":\"all\"}}" \
  http://127.0.0.1:3080/usage/heatmap &
curl -s -o /dev/null -X POST -H 'content-type: application/json' \
  -d "{\"type\":\"client-request\",\"rpcId\":\"p-sess\",\"method\":\"sessions\",\"payload\":{\"from\":$FROM,\"to\":$NOW,\"dataSources\":\"all\",\"limit\":200}}" \
  http://127.0.0.1:3080/usage/sessions &
wait
```

**浏览器侧复核**：打开 http://127.0.0.1:3080 → 设置 → **Plugins** 标签，DevTools Network 过滤 `/usage`，可看到挂载瞬间 8 个 `POST /usage/*`，其中 `heatmap` 约 290 ms，整体约 0.5 s，且**每 30 秒重复一轮**。

---

## 6. 最终判定

### ✅ 足以解释「打开设置页严重卡顿」—— 两条独立机制

> 说明：本节 M1 为我本人的测定；M2 引用了同目录并行代理的浏览器端 FPS/longtask 实测
> （`measure*.json`，Playwright+CDP），两者相互印证后合并为完整判定。

#### M1（宿主侧，本人实测）：`@local/dsh-usage` 用量卡片在 Plugins 标签的挂载风暴

- 8 个 RPC 在宿主**主线程**上串行执行同步 `node:sqlite` 查询，实测总墙钟 **0.51–0.55 s**；
- 单项 `heatmap` **290 ms**（全表扫描 + 临时 B 树，绕过 `idx_events_ts`）；
- 单项 `sessions` **38–41 ms**（自连接 + 两处临时 B 树；`session_id` 无单列索引）；
- **每 30 秒无条件重发 6 个查询**（`refreshSec` 默认 30），造成**周期性反复卡顿**，而非仅打开瞬间一次；
- 仅影响 **Plugins 标签**；默认 `general` 标签不触发。

#### M2（客户端侧，浏览器实测）：设置面板是**覆盖层**，不卸载底层会话，实时事件流持续重渲染

`SettingsRoot` 面板用 `position:fixed;inset:0;z-index:1000` 的 overlay，**没有卸载其下的对话视图**：

```js
// dsh-client-ui-settings-general/lib/client.js
overlay{z-index:1000;justify-content:center;align-items:center;display:flex;position:fixed;inset:0}
```

而客户端通过常驻 WebSocket 持续接收实时事件并驱动重渲染（`dsh-client-connection/lib/client.js`）：

```js
this.pumpStream(this.api.events.mux({}, ac.signal, muxOpened), this.sinks.onMuxEnvelope, settle);
```

浏览器实测（20 秒窗口）：

| 场景 | script 时间 | task 时间 | p99 帧 | >50ms 卡顿帧 |
|---|---|---|---|---|
| 空闲（主界面） | 121 ms/s | 154 ms/s | 100.1 ms | 22 |
| **按住设置页** | **190 ms/s** | **245 ms/s** | **116.7 ms** | **40** |

> 设置模式下主线程脚本负载 **+57%**、卡顿帧数 **+82%**。

同期 WebSocket 事件构成（20 秒，`ws_frames_per_s ≈ 73`，29.5 KB/s）：

| 事件类型 | 20 秒帧数 |
|---|---|
| **`session/event`** | **1309** |
| `session/projection` | 139 |
| `tool` | 127 |
| `subagent` | 44 |

→ 打开设置页并没有卸载对话视图，`session/event` 仍在高频到达并触发投影更新与重渲染，
**这是"设置页打开后持续卡顿"的第二条独立机制，且与数据体量无关**。

#### M2 的佐证：卡顿与标签页内容无关

浏览器实测的**逐标签**主线程开销（`measure2.json`）显示**每个标签**都要 0.6–1.8 s 脚本时间，
说明这是面板级/常驻负载，而非某标签的数据：

| 标签 | script ms | task ms | nodes | p95 帧 |
|---|---|---|---|---|
| 通用设置（默认） | **1401** | **1782** | 759 | 116.6 |
| 子代理模型 | 1198 | 1499 | 743 | 99.9 |
| Agent 预设 | 1022 | 1337 | 769 | 99.9 |
| 远程工作区 | 967 | 1246 | 723 | 66.7 |
| 插件（含 usage 卡片） | 906 | 1244 | 962 | 83.3 |
| vision-adam | 872 | 1151 | 699 | 50.1 |
| 打开配置文件 | 725 | 931 | 743 | 16.8 |
| 模型 | 688 | 923 | 711 | 16.8 |
| 分布式控制 | 638 | 858 | 690 | 16.8 |
| 关闭（回到空闲） | 1389 | 1686 | 588 | 100 |

> 注意最后一行：**"关闭"后的空窗也要 1389 ms 脚本** —— 与打开某个标签相当。
> 这直接证明主要开销**不来自设置面板内容**，而来自常驻的实时事件重渲染（M2）+ 后台 projcache 重写。

**次要放大因素**：`session_projcache.json` 每 3–9 秒整文件重写（≈128 ms 序列化 + 2 次 fsync），持续占用宿主主线程 CPU 与磁盘同步带宽，会**放大**上述前台抖动的体感，但**单独不足以**解释。

#### 两条机制的分工判定

| 症状 | 归因 |
|---|---|
| 点开设置的**瞬间**一次明显卡顿（各标签都有） | M2 常驻重渲染基线 + 该标签首帧 |
| 停在 **Plugins** 标签反复周期性卡顿 | M1（每 30 s 重发 6 个查询，宿主主线程 0.55 s 阻塞）**叠加** M2 |
| 停在其他标签也**持续**偏卡 | M2（`session/event` 1309 帧/20 s 持续重渲染）+ projcache 重写噪音 |
| 与 `sessions/`1.2G、`skills/`116M、`profiles/`424M | **无关**（均不在任一路径上） |

### ❌ 只是「体积大但与设置页无关」（避免误判）

| 数据源 | 体量 | 为何无关 |
|---|---|---|
| `sessions/` | 1.2 G / 2367 文件 | 设置页不枚举；唯一遍历者是用量插件的 45 s ingest，纯遍历实测仅 **31 ms**，且 45 分钟内仅 11 个文件变更 |
| `skills/` | 116 M / 12938 文件 | 不在任何 settings 槽；`skill.list` 属对话输入区技能目录路径，且只读 2 个 `SKILL.md`（8.9 KB）；全树枚举实测 **45 ms** |
| `profiles/` | 424 M / 74816 文件 | 插件加载器**启动时**读取一次；`settings.describe` 与 `llm.providers` 均返回内存态数据（`dsh-host-apiproxy/lib/index.js:3496` 无文件 IO） |
| `attachments/` | 17 M | 仅附件上传/预览路径 |
| `session_projcache.json` | 8.7 M | 全量解析仅在**启动时一次**（42.5 ms）；此后走常驻内存 Map，设置页零涉及；持续重写属**后台写路径**，非设置页读取路径 |
| `usage.db` 的 `usage_daily`（296 行） | tiny | 汇总仅 **0.03 ms** —— 库内本有预聚合表，热路径却不用它 |

### 修复方向（不在本次只读审计范围内，供裁决）

**针对 M1（宿主同步查询阻塞）**

1. **让热路径用 `usage_daily`**：`summary`/`byDay`/`timeseries`/`heatmap` 改查 296 行的预聚合表，`heatmap` 由 290 ms → 亚毫秒。
2. **补表达式索引**：`CREATE INDEX idx_events_day ON usage_events(strftime('%Y-%m-%d', ts/1000,'unixepoch','localtime'))`，或改存 `day` 列（`usage_daily` 已是此设计）。
3. **补 `session_id` 索引**：消除 `sessions` 自连接的两处临时 B 树。
4. **降低轮询**：`refreshSec` 默认 30 s → 300 s，或仅在标签页可见时轮询（`document.visibilityState !== "hidden"` 才发）。
5. **避免 `heatmap` 忽略 `from`/`to`**：按可视年份窗口下推时间过滤。
6. **把同步查询移出主线程**：`node:sqlite` 改为 worker 线程或异步驱动，避免 0.55 s 整段阻塞事件循环。

**针对 M2（覆盖层下的常驻重渲染）**

7. **设置面板打开时暂停底层会话重渲染**：`aria-hidden` 之上的对话视图应 `display:none` 或跳过投影订阅（保留状态但停止重渲染），使 1309 帧/20 s 的事件不再触发 DOM 更新。
8. **审查 `session/event` → 投影 → 重渲染的合批**：1309 帧/20 s（≈65/s）若逐帧 setState，应合并到 `requestAnimationFrame` 批处理。

**针对后台噪音**

9. **`session_projcache` 后端**：8.7 MB 整文件美化重写（`indent: 2` → 更紧凑，或按会话分片 / SQLite 后端）。`storages/session_projcache/sessions/` 分片目录已存在 1597 个文件，说明分片方案原本可用。

---

## 附：方法纪律声明

- 全程**只读**：SQLite 一律 `file:...?mode=ro`；未执行 `VACUUM` / `ANALYZE` / 任何写语句；未创建或删除 `~/.dsh` 下任何文件。
- `usage.db` 副本拷至 `/tmp/dsh-lag-proof/` **仅用于冷/热页缓存对比计时**，原库从未被写入。
- 未重启 / 未停止 PID 20806，未修改任何配置。
- 唯一写入：交付报告 `.workspace/settings-lag/audit-data.md`（位于会话工作区内）。
- 每个数字均标注获取方式（命令 / 代码位置 / 计时工具）；Python 计时用 `time.perf_counter()`，Node 计时用 `process.hrtime.bigint()`，端到端用 `curl -w %{time_total}`。
- `/proc/20806/fd` 符号链接受 `ptrace_scope` 限制不可读（`ls` 报"权限不够"），故未能直接核验宿主打开的 fd 清单；已改用代码路径分析 + 运行中端点实测替代，证据充分性不受影响。
