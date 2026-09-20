# `@local/dsh-usage` 宿主主线程冻结 — 最小改动方案（只读调研）

调研时间：2026-09-20 14:4x（宿主进程 20806 未受干扰，全程未写 `~/.dsh`，`usage.db` 一律 `readOnly:true` + `PRAGMA temp_store=MEMORY`）
被测对象：`/home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-usage`（v0.1.0）
数据库：`/home/CNS2026495165/.dsh/storages/usage/usage.db`（36,728,832 B，WAL，`user_version=1`，104,907 行事件）

---

## 0. 结论速览（决策用）

| # | 结论 | 依据 |
|---|---|---|
| 1 | **改 `lib/client.js` = 改完 ≤500ms 自动热替换（不重启宿主、不用手动刷新）；改 `lib/index.js` / `lib/db.js` = 必须重启宿主进程 20806 才生效** | HMR 的 `root:['.']` 锚在 profile 目录，且 `node_modules` 被双重排除；客户端则是 `dsh-client-hmr` 独立 stat 轮询 |
| 2 | 宿主侧最大收益在 **`lib/db.js` 的 `queryHeatmap`**：默认 7 天窗口下，单次 30s 轮询周期 = **578ms** 事件循环阻塞，其中热力图 **289ms（占 50%）** | 本轮实测（node:sqlite readOnly，与宿主同运行时） |
| 3 | 热力图走 **`usage_daily` 预聚合表**：289ms → **0.0ms**，输出与现状**逐行完全一致**；仅 sargable 化（`ts` 范围）只能降到 160ms | EXPLAIN 由 `SCAN` 变 `SEARCH`，且 `usage_daily` 是 `usage_events` 的完美镜像 |
| 4 | `usage_daily` **可以**满足 heatmap / byDay / byModel / byProject / timeseries(day) 的全部维度与过滤器；**不能**满足 `summary`（需 `COUNT(DISTINCT session_id)`）、`timeseries(hour)`（无小时列）、`sessions`（无 session_id） | 见 §4 等价性矩阵 |
| 5 | 索引齐全，**无需也不应新建索引**（`idx_events_ts` 已存在）；因此 `usage.db` 必须保持只读，方案全部落在查询改写上 | `PRAGMA index_list` 实测 |
| 6 | 只改客户端即可**立刻止血**：卡片已有「不轮询」选项（`refreshSec=0`），无需改代码即可把周期阻塞降为 0 —— 但需要用户在设置页点一下 | `lib/client.js:1040-1043` |
| 7 | **⚠️ 走 `usage_daily` 前必须先修客户端的窗口对齐**：`rangeDays` 走的是 `Date.now() - N*86400000`，**永远不是日对齐**（`lib/client.js:800-806`），直接喂给日粒度表会**静默多算**：30 天 +1.29% requests / +1.06% tokens，繁忙边界日可达 **+9.85% / +17.43%** | 独立复核实测（§4.5） |
| 8 | 剩余 104ms 残值 **≈100% 是逐行 `strftime(...,'localtime')`**：索引范围扫描仅 0.9ms、`TEMP B-TREE` 排序 ≈0ms（只有 21-31 个分组键）。**优化排序毫无意义，唯一杠杆就是桶表达式本身** | 独立复核实测（§3.5） |
| 9 | `data_source IN ('dsh','cc')` 谓词在本库**匹配 100% 行却有害**：它让计划退化成 UNIQUE 索引（`ts` 变残余过滤），22.3ms vs 纯 ts 覆盖索引 10.4ms | 独立复核实测（§3.5 / §5 A2b） |

**一句话方案**：`lib/db.js` 改两处 —— `queryHeatmap`（`:431/:442`，日级谓词换 `ts` 范围）并让它读 `usage_daily`，外加 `rebuildDailyForDays`（`:241`）同样的 sargable 化；前置条件是 `lib/client.js:800-806` 把滚动窗口对齐到本地日（否则日粒度表会静默多算 1.3%，繁忙边界日可达 9.9%）。效果：单周期宿主阻塞 **578ms → ≈0ms**（ingest 重算顺带 150→22ms）。因为改的是宿主侧 `node_modules` 下的文件，**必须重启一次宿主**；若坚持不重启，则只能走「客户端对齐窗口 + 停轮询/可见性门控」这条零重启路 —— 它能把「多久砸一次」降到 0，但**不会**让单次 578ms 变便宜。

> 本报告的 §3.5、§3.6、§4.4 微秒级明细、§4.5 边界误差来自**独立复核子代理**对同一数据库的只读实测（原始 JSON：`/tmp/vq/*.json`，报告：`verify-daily-fit.md`）。它修正了本报告初稿一处**不可采信的乐观数字**：初稿测得「近 7 天」档误差 0.000% 并据此认为默认路径可用；复核证明那只是因为头尾半天恰无事件，滚动窗口**从来不是**日对齐（详见 §4.5(1)）。

---

## 1. 生效路径（关键问题）

### 1.1 这个插件是怎么被加载的（证据链）

| 环节 | 文件:行 | 内容 |
|---|---|---|
| 插件清单 | `.../dsh-usage/package.json` | `"main": "lib/index.js"`；`"exports": {"./client": "./lib/client.js"}`；`"dsh.client": {"platform":"web","inject":["@deepseek-ai/dsh-client-connection","@deepseek-ai/dsh-client-ui-settings"]}` |
| profile 挂载 | `~/.dsh/profiles/web/cordis.patch.yml` | `- insert: [{id: usage, name: '@local/dsh-usage'}]` |
| profile 组合 | `~/.dsh/profiles/web/package.json` | `dsh.profile.bundles = ['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app']`，`patchReload: "live"` |
| 模块解析 | `~/.dsh/profiles/node_modules/@local/dsh-usage` | 真实目录（非符号链接），从 `~/.dsh/profiles/web/` 向上解析命中 |
| host 半 | `lib/index.js:92` `apply(ctx)`（`name='usage'`，`inject=['connection','webServer']`）→ `index.js:168 registerUsageRpc` | `/usage/*` RPC 在宿主进程内同步执行 SQL |
| client 半 | `package.json` 的 `dsh.client` + `exports["./client"]` | 由 `@deepseek-ai/dsh-client-modules` 扫描 loader entries 后按 `/plugins/<id>/client.js?rev=<hash>` 提供给浏览器 |

### 1.2 host 半：**HMR 覆盖不到，必须重启宿主**

三条独立证据，任一成立即足以否定热重载：

1. **HMR 的 watch root 不是插件所在目录。**
   `dsh-app-boot/lib/profile-boot-*.js:256-263`：
   ```js
   if (ctx.get("hmr") === void 0) { await ctx.loader.create({ name: ".../cordis-plugin-hmr", config: { root: [] } }); }
   ```
   而 base bundle 已经把 HMR 行装好了 —— `node_modules/@deepseek-ai/dsh-base/cordis.patch.yml:19-22`：
   ```yaml
   - id: hmr
     name: '@deepseek-ai/cordis-plugin-hmr'
     config:
       root: ['.']
   ```
   由于 bundle 的 patch 在 boot 阶段先应用，`ctx.get("hmr")` 已存在 → profile-boot 的 `root: []` 分支被**跳过**，生效的是 `root: ['.']`。
   `cordis-plugin-hmr/lib/index.js:109`：`this.baseDir = fileURLToPath(new URL(config.base || ".", ctx.baseUrl))` —— 锚点是 **`ctx.baseUrl`（配置树锚 = profile 目录 `~/.dsh/profiles/web/`）**，不是进程 cwd。因此实际 watch root = `~/.dsh/profiles/web/`。**插件源码位于 `~/.dsh/profiles/node_modules/`，是它的兄弟目录，根本不在 watch root 内。**

2. **`node_modules` 被显式排除。**
   即使是同一棵树内的文件，HMR 也明确跳过 `node_modules`：
   - `cordis-plugin-hmr/lib/index.js:47-58`（`loadDependencies`）：`if (job.url.startsWith("node:") || job.url.includes("/node_modules/")) return;`
   - 同文件 `:286`：`const isExcluded = (url) => url.startsWith("node:") || url.includes("/node_modules/");`
   - `partialReload()` 用 `this.declined` 过滤，而 `declined` 初值就是 `externals`（由 `loadDependencies` 得到，天然不含 node_modules 依赖）。

3. **改动后进程内的模块缓存不会失效。**
   loader 走 `this.ctx.loader.internal.import(name, ...)`（`cordis-plugin-loader/lib/index.js:274`），即 Node 内部 ESM loader 的 `loadCache`，按 URL 缓存。HMR 只在「accepted 文件集」上清缓存并重导入；`@local/dsh-usage` 不在该集合内 → 即使触发重挂载，也会拿到**旧的** host 模块。
   推论：修改 `lib/index.js` / `lib/db.js` 后，运行中的 20806 **会一直执行旧代码**，直到进程重启。

> 附带确认：改 `~/.dsh/profiles/web/cordis.patch.yml` 只会触发 `watchUserPatches` 的 `entry.update()`（`dsh-app-boot/lib/index.js:761-781`），即**组合层热更新**，不会重新导入插件模块。所以「改 patch 层」不是让 host 代码生效的手段。

**结论**：host 半改动 → **必须重启宿主**（`dsh web` 进程）。无捷径。

### 1.3 client 半：**真热替换，不需要重启，也不需要手动刷新**

`dsh-client-hmr` 是一条与 chokidar 无关的独立链路，且**不排除 node_modules**：

- `dsh-web-app/cordis.patch.yml:151` 无条件挂载 `@deepseek-ai/dsh-client-hmr`。
- `dsh-client-hmr/lib/index.js:28`：`Config = z.object({ pollIntervalMs: z.number().min(1).default(500) })` → **默认 500ms**。
- `:78-91 pollWatches()`：对 graph 里每个 entry 的 client bundle 做 `statSync`，比对 `mtimeMs`/`size`；变化则 `rehash()`。
- `:41-54 rehash()` → `ctx.clientModules.rebuilt(id)`；`dsh-client-modules/lib/index.js:325-339` 用 **`shortHash(readFileSync(clientPath))`** 重新计算 `rev`（sha1 取前 12 位），**rev 直接来自文件内容** —— 不是 mtime、不是构建产物、不是任何 bundler hash。
- `rebuilt()` 变更后 `notifyGraphChanged()` + 通知 `onRebuilt` 监听者；`dsh-client-hmr/lib/index.js:145-152` 通过 SSE `/plugins/events` 推 `{type:"rebuilt", id, rev}`。
- 浏览器半 `dsh-client-hmr/lib/client.js:38-56 reload(id)`：`modLoader.invalidate(id)` → `await modLoader.prefetch(id)` → 摘掉旧 fiber、`removeOwnedStyles(id)` → `entry.refresh()`，**原地热替换**（不是整页刷新，不需要用户操作）。
- `serveBundle`（`dsh-client-modules/lib/index.js:459-490`）每个请求都 `await readFile(path)` 从磁盘读，响应头 `cache-control: no-cache` —— 所以**即使 URL 上的 `?rev=` 还是旧值，内容也已经是新的**。

> 关于任务描述里的「是否有 `pnpm run dev:web`」：**实测没有 vite / dev:web 进程**（`ps aux | grep -E "dev:web|vite"` 空）。但**这不影响客户端热替换** —— 这条链路完全不经过 vite，是宿主侧 500ms stat 轮询 + 内容哈希。`lib/client.js` 本身也是 build-free 的手写 bundle（文件头：`window.__ModuleLoader__.load({...})`，注释 "handwritten, build-free client bundle"），不存在「需要重建产物」的步骤。

**结论**：client 半改动 → **保存文件即可，≤500ms 后所有已打开页面的设置卡片自动重挂载**。无需重启宿主、无需重建、无需手动刷新。

### 1.4 「改完到生效」的确切步骤

| 改动对象 | 步骤 | 是否重启宿主 | 验收 |
|---|---|---|---|
| `lib/client.js`（客户端行为，如轮询/取值范围） | 1) 直接编辑 2) 等 ≤500ms 3) DevTools Network 看 `/plugins/@local/dsh-usage/client.js` 被重新请求 | **否** | 卡片自动更新；新 hash 可见 |
| `lib/index.js` / `lib/db.js`（宿主查询、RPC） | 1) 编辑 2) **重启宿主**（见 §6.3）3) 浏览器刷新 | **是（必须）** | `/usage/heatmap` 单发耗时 289ms→<1ms |
| `lib/charts.js` | **不要改** —— 死文件 | 否 | 全仓无 import；客户端用的是 `lib/client.js:26` 的内联副本（注释 "charts.js 内联 … keep in sync"），改它等于零效果 |
| `cordis.patch.yml` | 只影响组合层 | 否 | 与本次修复无关 |

---

## 2. 索引现状（`PRAGMA` 实测）

`mode=ro` 打开，`SELECT type,name,tbl_name FROM sqlite_master`：

```
index  idx_events_model            usage_events      -- (model)
index  idx_events_project          usage_events      -- (project)
index  idx_events_ts               usage_events      -- (ts)          ← 关键：已存在
index  sqlite_autoindex_usage_events_1  usage_events -- UNIQUE(data_source,session_id,dedup_key)
index  sqlite_autoindex_usage_daily_1   usage_daily  -- PK(day,data_source,model,project)
```

- `PRAGMA index_info`：`idx_events_ts → [(0,4,'ts')]`（单列，`ts` 是 INTEGER，可直接用于范围 seek）。
- **存在可用于 `ts` 范围查询的索引：`idx_events_ts`。因此无需 `CREATE INDEX`** —— 这也是本次全程只读仍能给出完整方案的前提。
- `usage_events` 行数 104,907；`usage_daily` 296 行 / 31 天。
- 附带发现：`statusProvider`（`lib/index.js:146-147`）的 `COUNT(*) WHERE data_source='dsh'` 走 **COVERING INDEX**（实测计划 `SEARCH usage_events USING COVERING INDEX sqlite_autoindex_usage_events_1 (data_source=?)`），成本仅 1.4ms / 0.5ms —— **不是瓶颈，不必动**。

---

## 3. sargable 改写验证

### 3.1 改写内容（`lib/db.js:422-444 queryHeatmap`）

现状（`:431` 把日级谓词拼进 WHERE，`:442` 传 `start`/`end` 字符串）：

```js
const condition = [clause ? clause.replace(/^WHERE\s+/i, "") : "", `${DAY_SQL} BETWEEN ? AND ?`]...
... .all(...values, start, end)
```

改写为 `ts` 半开区间（局部日边界在 JS 侧算成 epoch ms）：

```js
const startMs = new Date(year, 0, 1).getTime();          // 本地 1/1 00:00:00
const endMs   = new Date(year + 1, 0, 1).getTime();      // 本地次年 1/1 00:00:00（半开）
const condition = [clause ? clause.replace(/^WHERE\s+/i, "") : "", "ts >= ? AND ts < ?"]...
... .all(...values, startMs, endMs)
```

SELECT 列表里的 `DAY_SQL`（`:437`）**保留不动** —— 它在 SELECT/GROUP BY 里只是 31 行输出上的分组键，不参与过滤，不是成本来源。

### 3.2 EXPLAIN QUERY PLAN 对照（node:sqlite，与宿主同运行时）

| 版本 | 计划 |
|---|---|
| 旧：`WHERE strftime('%Y-%m-%d', ts/1000,'unixepoch','localtime') BETWEEN ? AND ?` | `SCAN usage_events` + `USE TEMP B-TREE FOR GROUP BY` |
| 新：`WHERE ts >= ? AND ts < ?` | **`SEARCH usage_events USING INDEX idx_events_ts (ts>? AND ts<?)`** + `USE TEMP B-TREE FOR GROUP BY` |

**证明成立：SCAN → SEARCH（走 `idx_events_ts`）。** 另确认 `byDay` 的 `ts >= ?` 版本为 `SEARCH usage_events USING COVERING INDEX idx_events_ts (ts>?)`（索引覆盖）。

### 3.3 耗时对照（单发串行，循环 3 次取最小值，ms）

同一个 `usage.db`，`node:sqlite` `readOnly:true`（= 宿主的运行时；宿主 `openUsageDb` 未开 `PRAGMA jit`，node:sqlite 默认 `jit=false`，实测开/关只差 ~4%，不是主因）：

| 查询 | 旧（strftime 谓词） | 新（`ts` 范围） | `usage_daily` | 加速 |
|---|---|---|---|---|
| heatmap（年 2026） | **289.0** | 159.6 | **0.0** | 1.8× / ∞ |
| timeseries(day, 7d) | 210.0* | 46.5 | 0.0 | 4.5× |
| byDay (7d) | 212.2* | 43.8 | 0.0 | 4.8× |
| byModel (7d) | 117.9* | 12.8 | 0.0 | 9.2× |
| byProject (7d) | 119.9* | 12.6 | 0.0 | 9.5× |
| summary (7d) | 119.1* | 13.3 | 0.0 | 9.0× |
| timeseries(hour) | 9.8* | 9.5 | n/a | 无变化（且无 WHERE，受益有限） |

\* 「旧」列在 30 天窗口下测得（7 天窗口下 `eventWhere` 本来产出 `ts` 范围，再叠一层 strftime 谓词属于双倍工作）；量级与相对关系可代表收益比例。

**逐行结果等价**：新旧 heatmap 输出 `identical: true`（31 行，逐行 `day`/`total` 完全相同）。

### 3.4 `localtime` 时区边界语义

- **等价性成立**。SQLite 的 `'localtime'` 修饰符调用 libc `localtime_r`，读取**进程时区**；JS 的 `new Date(y,0,1).getTime()` 同样按宿主本地时区换算。二者同源（同一 `TZ`），实测边界互换可直接互验：
  `SELECT strftime('%Y-%m-%d %H:%M:%S', 1767196800000/1000,'unixepoch','localtime')` → `'2026-01-01 00:00:00'`；`1798732800000` → `'2027-01-01 00:00:00'`（TZ = UTC+8 / CST）。
- **边界处理**：用**半开区间 `[startMs, endMs)`** 而不是 `BETWEEN`。原因有二：(a) 旧代码是拿**字符串**比较（`'2026-01-01' <= day <= '2026-12-31'`），字符串 `BETWEEN` 恰好等价于整年，改写后若用闭区间就需要 `endMs = 次年1/1 的最后一毫秒`，容易在闰秒/DST 上出错；半开区间更稳。(b) 半开区间天然避免「次年 1/1 00:00:00.000 被算进今年」。
- **DST / 跨年**：`new Date(y, m, d)` 是「本地墙钟构造」，JS 会自行处理 DST 偏移，不需要手工算偏移量。CST（UTC+8）无 DST；即使换到有 DST 的时区，写法的语义仍然是「本地日边界」，与 `localtime` 一致。
- **一个附带的正向副作用**：现状 `queryHeatmap` 完全**忽略** RPC 传来的 `from`/`to`（`:426` 显式 `from: undefined, to: undefined`），只按 `year` 参数查整年 —— 也就是说用户把范围选成「近 7 天」，热力图**仍然全表扫一年**。改写后若在 `rpc.js:203` 把 `filters.from/to` 一并传下去，热力图才会真正尊重范围选择（可选增强，见 §5 A3）。

### 3.5 残值分解：sargable 之后剩下的时间花在哪（独立复核实测）

30 天窗口，`ts >= ? AND ts <= ?`：

| 变体 | 计划 | 耗时 |
|---|---|---|
| (a) `strftime(...) d, COUNT(*) ... GROUP BY d` | `SEARCH ... USING COVERING INDEX idx_events_ts (ts>? AND ts<?)` + `USE TEMP B-TREE FOR GROUP BY` | **104.2 ms** |
| (b) 同形状但 `SELECT ts, COUNT(*) GROUP BY ts` | 同上但**无** temp b-tree（索引本身已按 `ts` 有序 → 流式分组） | **15.1 ms** |
| (c) 裸 `SELECT COUNT(*)` 同区间 | `COVERING INDEX idx_events_ts` | **0.9 ms** |
| (d) 对照：逐行投影 strftime 但**不** GROUP BY | — | **125.0 ms** |

**推论**：索引范围扫描 ≈ **0.9ms（0.9%）**；逐行 `strftime(...,'localtime')` 物化 ≈ **100%+**（(d) 甚至比整个 GROUP BY 查询还慢）；`TEMP B-TREE` 排序在 (a) 之上**再花 ≈0ms**（只有 21-31 个分组键）。
→ **唯一杠杆是桶表达式本身（消掉逐行 strftime），而不是排序**。这正好解释了为什么「预聚合 `usage_daily`」能把 104-289ms 直接打到 0：它把逐行 strftime **在写入时做了一次**，读取时只剩 296 行的和。

### 3.6 `data_source IN ('dsh','cc')` 谓词在本库是纯损失（独立复核实测）

`eventWhere`（`db.js:330-334`）总会给查询拼上 `data_source IN (?,?)`。实测这一条**匹配窗口内 100% 的行**（库里只有 `dsh`、`cc` 两个取值，合计 82,207 + 22,700 = 全部 104,907 行），**过滤掉的零行**，但代价是计划劣化：

| 写法 | 计划 | 耗时（80,120 行窗口） |
|---|---|---|
| 带 `data_source IN (?,?)` | `SEARCH usage_events USING INDEX sqlite_autoindex_usage_events_1 (data_source=?)`（`ts` 退化为**残余过滤**） | **22.3 ms** |
| 去掉该谓词 | `SEARCH usage_events USING COVERING INDEX idx_events_ts (ts>? AND ts<?)` | **10.4 ms** |

两条独立证据说明 `idx_events_ts` 被绕开：(1) 成本不再随窗口缩放 —— 7/30/90 天：带谓词 16.3/22.3/37.9ms vs 纯 ts 4.2/11.6/27.2ms（前者含一次固定 ~104k 条目的索引走查）；(2) `dbstat` 显示 `idx_events_ts` = 1,769,472 B / 432 页 ≈ 19.5 B/条目，而 35MB 库远超 2MB 页缓存。
在完整的 `byDay` 形状里这点差异是噪声（120.2ms vs 122.2ms，两者都被 §3.5 的 strftime 主导），所以**不必为它单独重构**；但若做 A2，应让 `ts` 驱动索引、把 `data_source` 留作**结果集上的过滤**（例如聚合里用条件表达式），而不是让它抢走索引选择。

---

## 4. 能否改走 `usage_daily`

### 4.1 是否被持续维护：**是**

| 维护点 | 位置 |
|---|---|
| 建表 | `lib/db.js:125-136`（`PRIMARY KEY(day, data_source, model, project)`） |
| 重算实现 | `lib/db.js:222-248 rebuildDailyForDays`（`BEGIN` → `DELETE ... WHERE day IN (...)` → `INSERT ... SELECT ... FROM usage_events WHERE strftime(...) IN (...)` → `COMMIT`） |
| dsh 源调用点 | `lib/ingest-dsh.js:245` `rebuildDailyForDays(db, [...affectedDays])`（每个源文件处理完就调，`lib/ingest-dsh.js:234` 有 `affectedDays.add(localDay(ev.ts))`） |
| cc 源调用点 | `lib/ingest-cc.js:209` 同上 |
| 触发频率 | `lib/index.js:37 INGEST_INTERVAL_MS = 45_000` → `lib/index.js:185-191 ctx.setInterval(runIngest, 45s)` |
| 单日包装 | `lib/db.js:255-257 insertDaily`（当前无调用者，属冗余 API） |

即：**每个 ingest 周期（45s）对有新事件的「受影响日」做一次 delete+全量重插**（增量是「按天」粒度，不是按行），因此 `usage_daily` 与 `usage_events` 强一致（差一个 ≤45s 的重算窗口）。

### 4.2 完美镜像实测（这是走预聚合的底气）

| 指标 | `usage_events` | `usage_daily` | 一致 |
|---|---|---|---|
| 天数 | 31（2026-08-10 .. 2026-09-18） | 31（同） | ✅ 逐日相同 |
| requests | 104,907 | 104,907 | ✅ ratio 1.0000 |
| tokens 总和 | 14,721,171,199 | 14,721,171,199 | ✅ ratio 1.0000 |
| 缺失/偏短的日 | — | **0 天** | ✅ |
| 多余日 | — | 0 天 | ✅ |
| 维度 | 21 model / 61 project | 21 / 61 | ✅ |

### 4.3 各端点维度适配性（能 / 不能 + 依据）

| 端点 | 需要的维度 | `usage_daily` 能否满足 | 依据 |
|---|---|---|---|
| `heatmap` | day（+dataSources） | **能** | 只需 `day` + tokens 和；实测 31 行逐行一致 |
| `byDay` | day, data_source, model, project | **能** | `COUNT(*)`≡`SUM(requests)`，四个 token 桶都有列；实测一致 |
| `byModel` | model（+data_source/project/day 过滤） | **能** | `model` 为列（`COALESCE(model,'(unknown)')` 与源码 `db.js:457` 同一写法）；实测 21 行一致 |
| `byProject` | project | **能** | 同上；实测 61 行一致 |
| `timeseries(day)` | day | **能** | `granularity='day'` 时与 `byDay` 同构 |
| `timeseries(hour)` | **小时桶** | **不能** | `usage_daily` 只有 `day` 列，无小时维度；`HOUR_SQL`（`db.js:309`）无法由日粒度重构 |
| `summary` | 上述 + **`COUNT(DISTINCT session_id)`** | **不能** | `usage_daily` 无 `session_id`（`:125-136` 只有 5 个度量列）；`sessions` 计数无法预聚合 |
| `sessions` | **session_id + ts + 窗口函数** | **不能** | 明细钻取，天然需要事件级数据 |

**过滤器可行性实测**（逐行一致，非仅总数）：`data_source='cc'` 过滤 ✅ 10 行一致；`project='/home/CNS2026495165/Dexterous_Hand_23Dof/...'` 过滤 ✅ 19 行一致。

### 4.4 改写后的 SQL 与实测耗时

```sql
-- heatmap（年窗口 = 日对齐，精确）
SELECT day, SUM(input_tokens+output_tokens+cache_read_tokens+cache_write_tokens) AS total
FROM usage_daily WHERE day >= ? AND day <= ? GROUP BY day ORDER BY day;

-- byDay（日对齐窗口，精确）
SELECT day, SUM(requests) AS requests,
       SUM(input_tokens) i, SUM(output_tokens) o, SUM(cache_read_tokens) c, SUM(cache_write_tokens) w
FROM usage_daily WHERE day >= ? AND day <= ? GROUP BY day ORDER BY day;

-- byModel / byProject
SELECT COALESCE(model,'(unknown)') AS model, SUM(requests) AS requests, SUM(input_tokens) ...
FROM usage_daily WHERE day >= ? AND day <= ? GROUP BY COALESCE(model,'(unknown)') ORDER BY requests DESC;
```

| 查询 | 实测（ms，min-of-3） |
|---|---|
| heatmap via `usage_daily` | **0.0 / 0.1** |
| byDay via `usage_daily` | **0.0** |
| byModel via `usage_daily` | **0.1** |
| byProject via `usage_daily` | **0.1** |
| summary via `usage_daily`（`sessions` 置空） | 0.0 |
| 对照：heatmap via events（新 sargable） | 159.6 |
| 对照：heatmap via events（旧） | 289.0 |

微秒级明细（独立复核，21 天窗口 137 行）：

| 变体 | 计划 | 耗时 |
|---|---|---|
| `SELECT day, SUM(requests) ... GROUP BY day` | `SEARCH usage_daily USING INDEX sqlite_autoindex_usage_daily_1 (day>? AND day<?)`，**无** `USE TEMP B-TREE` | **18.3 µs** |
| 同上但去掉 GROUP BY | 同 | 9.1 µs |
| `SUM(input+output+cache_read+cache_write) GROUP BY day` | 同，无 temp b-tree | **22.5 µs** |
| 无 WHERE 的 `GROUP BY day` | `SCAN usage_daily USING INDEX sqlite_autoindex_usage_daily_1`，仍无 temp b-tree | 63.4 µs（全表 296 行） |

> **为什么这么快**：PK 是 `(day, data_source, model, project)`，**`day` 打头**，所以范围既是索引 seek、返回又已按 `day` 有序 → 聚合完全流式，连排序都省了（对比 §3.5 里 events 路线要 `TEMP B-TREE`）。若 PK 把 `data_source` 放在 `day` 前面就享受不到这一点。
> 相对 events 路线（120.2ms / 104.2ms），日对齐路线便宜约 **6,500×** —— 但代价是只回答「日粒度」的问题，因此仅对 §4.5(1) 的日对齐窗口**精确**。

### 4.5 ⚠️ 两个必须处理的前提（否则会引入错误/陈旧）

**(1) 窗口必须「日对齐」，否则按日粒度求和会多算 —— 而卡片的默认路径恰恰不对齐。**
`usage_daily` 只有日粒度，套在**非日对齐的滚动窗口**上必须把 `from` 向下取整到本地日、`to` 向上取整到本地日，这会**超出原窗口，且只会多算、不会少算**。

关键结构性事实（`lib/client.js:800-806`）：
```js
if (rangeDays > 0) return { from: now - rangeDays * 86400000, to: now };   // ← 滚动窗口
const from = customFrom ? new Date(customFrom + "T00:00:00").getTime() : undefined;   // ← 日对齐
const to   = customTo   ? new Date(customTo   + "T23:59:59").getTime() : undefined;
```
`now - N*86400000` 相对本地午夜的偏移是 `(Date.now() mod 86400000) - 8h`，**每毫秒都在变 → 永远不日对齐**。只有「自选」档（硬编码 `T00:00:00`/`T23:59:59`）天然对齐。

实测误差（独立复核，min-of-3，同一 `Date.now()` 锚点）：

| 卡片档位 | 精确（events） | usage_daily（日取整） | 误差 |
|---|---|---|---|
| `rangeDays=1` | 0 req | 0 req | 0.000%（边界日本身无事件） |
| `rangeDays=7` | 24,931 req / 4,391,030,015 tok | 同 | **0.000%（巧合，见下）** |
| `rangeDays=30` | 80,120 req / 10,310,975,630 tok | 81,150 / 10,419,760,029 | **+1.286% req / +1.055% tok** |
| `rangeDays=90` | 104,907 / 14,721,171,199 | 同 | 0.000%（覆盖全量数据跨度） |
| 自选 08-01..09-18、09-01..09-18 | — | 同 | 0.000%（真对齐） |
| 自选 `09-10 .. 09-12T18:00`（繁忙尾日） | — | — | **+9.851% req / +17.426% tok** |

⚠️ **7 天档的 0.000% 不可采信**：它之所以为 0，是因为窗口头/尾那两个半天**恰好没有事件**（库里最近事件在 09-18 11:02），不是路由对齐了。`rangeDays=30` 的 +1,030 行正好等于头部半天（08-21 00:00→14:48）。**只要边界日有流量，误差就是无界的**（上表最后一行给出 +9.9%/+17.4% 的实证）。
→ **结论：`usage_daily` 绝不能直接接在 `rangeDays` 滚动窗口上。** 必须二者之一：
  - **(A) 客户端把滚动窗口对齐到本地日**（见 §5 A0，纯客户端改动 → 热替换、零重启）；或
  - **(B) 宿主侧显式闸门**：`from`/`to` 落在本地日边界上 **且** `toDay <= maxDailyDay` 才走 `usage_daily`，否则回落 sargable events（见 §5 A1）。
  两者都做最稳：A0 消除误差、A1 保证即使窗口没对齐也不会算错。

**(2) 新鲜度只到「最后一天」，不是「到现在」。**
实测：事件 `MAX(ts)` = `1789724522500` → 本地 **2026-09-18 11:02**；`usage_daily` `MAX(day)` = `2026-09-18`；而系统时钟是 **2026-09-20 14:47**。即**库里最近两天根本没有事件**（这本身是另一件事：ingest 未发现更新的会话文件）。
风险在于：走 `usage_daily` 后，新鲜度完全绑定在 ingest 的「按天重算」上；一旦 ingest 出问题（异常、`failedFiles`、或某天只重算了部分），`usage_daily` 可能落后于 `usage_events`，而现状直接扫 events 至少「所见即所用」。
→ **护栏**：`usage_daily` 只在请求窗口**完全落在已聚合日范围内**时才使用：

```js
// 每次 ingest 后（或惰性缓存 45s）读一次 MAX(day) → maxDailyDay
const toDay = localDay(to);                       // 本地日字符串
if (toDay <= maxDailyDay) { /* 走 usage_daily */ } else { /* 回落 events sargable */ }
```

这样「今天/最近被截断的那一天」自动走 events，既拿到 99% 的收益，又不会把陈旧数据当成实时数据。

---

## 5. 最小改动清单（按「风险最小、收益最大」排序）

> 每条的「预期数字」都是本轮**实测值**，不是估算。全程只读改法，不涉及 `usage.db` 任何写操作（不需要新索引 —— `idx_events_ts` 已存在）。

### A0 ★★★ 客户端把 `rangeDays` 窗口对齐到本地日（走 `usage_daily` 的前提，且**零重启**）

- **位置**：`lib/client.js:800-806`（`range` 的 `useMemo`）。
- **改动**（约 6-8 行）：`rangeDays > 0` 分支改为本地日对齐，而不是 `now - N*86400000`：
  ```js
  if (rangeDays > 0) {
    const end = new Date(); end.setHours(0, 0, 0, 0);           // 今天 00:00
    const start = new Date(end); start.setDate(start.getDate() - (rangeDays - 1)); // 本地日回退，DST 安全
    const to = new Date(end); to.setDate(to.getDate() + 1);      // 次日 00:00（半开）
    return { from: start.getTime(), to: to.getTime() - 1 };      // 末尾 -1ms，兼容现有 ts <= to 语义
  }
  ```
  注意：必须用 `setDate(getDate()-n)` 做**本地日历**回退，不能用 `-n*86400000`（跨 DST 会偏一小时）。
- **改动量**：6-8 行，纯客户端。
- **验收命令**：卡片选「近 30 天」后，在 Console 打印 `payload`，确认 `from` 是本地 `00:00:00.000`、`to` 是 `23:59:59.999`：`new Date(payload.from).toString()` 应含 `00:00:00`。
- **预期数字**：误差从 30 天档 **+1.286%/1.055%** 变为 **0.000%**；同时它是 A1 能安全启用的前提。
- **风险**：最低（语义上「近 7 天」变成「含今天在内的 7 个自然日」，与档位文案一致；纯客户端 → §1.3 热替换，**不重启**）。

### A1 ★★★ 让 `queryHeatmap` 读 `usage_daily`（收益最大）

- **位置**：`lib/db.js:422-444`（`queryHeatmap`）。
- **改动**：
  1. 新增本地日工具（约 6 行）：`localDay(ms)`（用 `getFullYear/getMonth/getDate` 拼 `YYYY-MM-DD`，DST 安全）、`dayToMs(dayStr)`。
  2. 新增闸门 `canServeDailyRoute(filters)`：窗口边界落在本地日边界 **且** `toDay <= maxDailyDay`（`maxDailyDay` 由 `SELECT MAX(day) FROM usage_daily` 惰性缓存，ingest 后失效）。
  3. 命中闸门 → 走 `usage_daily`（§4.4 SQL），未命中 → 回落到**已 sargable 化**的 events 查询（A2）。
  4. `rpc.js:203` 顺带把 `filters.from/to` 传给 `queryHeatmap`（当前被 `:426` 丢弃），让热力图尊重范围选择器。
- **改动量**：约 25-35 行，集中在 `db.js` 一个函数 + 1 行 `rpc.js`。
- **验收命令**：
  ```bash
  node -e 'const{DatabaseSync}=require("node:sqlite");const d=new DatabaseSync("/home/CNS2026495165/.dsh/storages/usage/usage.db",{readOnly:true});d.exec("PRAGMA temp_store=MEMORY");
  const t=performance.now();const r=d.prepare("SELECT day,SUM(input_tokens+output_tokens+cache_read_tokens+cache_write_tokens) total FROM usage_daily WHERE day>=? AND day<=? GROUP BY day ORDER BY day").all("2026-01-01","2026-12-31");
  console.log((performance.now()-t).toFixed(1)+"ms rows="+r.length)' 2>/dev/null
  ```
  另需**逐行 diff** 新旧 heatmap 输出（`JSON.stringify` 比较），必须 `deepEqual`。
- **预期数字**：heatmap 289ms → **<1ms**；整个轮询周期 578ms → **≈289ms**（占当前 50% 的单项被消掉）。
- **风险**：中低。风险点是「日对齐判据写错 → 多算一天」与「陈旧数据」；两者都已由 §4.5 的闸门覆盖。**必须**配 A2 作为回落路径，不能只有 A1。

### A2 ★★★ `ts` 范围替换日级谓词（sargable 化）—— A1 的回落路径 + 独立收益

- **位置**：
  - `lib/db.js:431`（heatmap 的 `condition`）+ `:442`（传参由字符串 `start/end` 改为 `startMs/endMs`）；
  - **顺手（额外收益，已实测）**：`lib/db.js:241`（`rebuildDailyForDays` 的 `WHERE strftime(...) IN (${placeholders})` → `WHERE ts >= ? AND ts < ?`，由 `days` 数组算出最小/最大本地日边界）。这条直接**降低宿主每 45s ingest 时的阻塞**：实测 `SCAN` → `SEARCH ... USING INDEX idx_events_ts`，3 天重算 **150.1ms → 22.1ms**，31 天全量重算 **281.6ms → 166.3ms**，输出**逐行一致**（`identical=true`）。
  - **不要**给 `eventWhere`（`:319-344`）加 `strftime` 谓词 —— 核对了所有 RPC 调用点，`normalizeFilters`（`rpc.js:129-140`）只产出 `from`/`to` 毫秒，现有 5 个查询（summary/timeseries/byModel/byProject/byDay）本就是纯 `ts` 范围，**没有**非 sargable 问题。之前发现的那处「双倍谓词」只存在于 `queryHeatmap`。
- **验收命令**：`EXPLAIN QUERY PLAN` 必须出现 `SEARCH usage_events USING INDEX idx_events_ts`（旧为 `SCAN usage_events`）。
- **预期数字**：heatmap 289→160ms；ingest 3 天重算 150→22ms；7 天窗口下 timeseries(day) 46.5ms、byDay 43.8ms 已是 sargable 值；周期 578→448ms。
- **风险**：**最低**（纯谓词等价改写，全部输出已逐行 `identical: true` 验证）。

### A2b ☆（可选，收益小）别让 `data_source IN (...)` 抢走索引

- **依据**：§3.6 实测 —— 该谓词过滤掉 0 行，却让计划从 `COVERING INDEX idx_events_ts` 退化成 UNIQUE 索引（22.3ms vs 10.4ms）。
- **做法**：在 `ts` 驱动索引的前提下，把 `data_source` 留作聚合内过滤（如 `SUM(CASE WHEN data_source='cc' THEN ... END)`），或仅在 `dataSources` 为单值时才下推该谓词。
- **预期数字**：80,120 行窗口 22.3→10.4ms；但在完整 `byDay` 形状里只有噪声级差异（120.2 vs 122.2ms），**故优先级低**。
- **风险**：低，但会动 `eventWhere` 的公共语义（5 个查询共用）→ 属于「改动面扩大换小收益」，除非要一起重构，否则**建议先不做**。

### A3 ★★ 让 `querySessions` 也带上 `ts` 上界并收紧默认窗口

- **位置**：`lib/db.js:549-587`（CTE `latest` 的 `cteClause`/`joinClause` 已经是 `ts` 范围，问题在**客户端默认传 30 天**）+ `lib/client.js:864`（`limit: 200`）。
- **验收**：`loadSessions` 单发耗时。
- **预期数字**：实测 `sessions`（30 天窗口、limit 200）66.3ms；窗口收到 7 天后约 1/3。该项**只在卡片挂载/手动刷新时**触发（`client.js:883-886`，不在 30s 轮询里），故优先级低于 A1/A2。
- **风险**：低。注意 `LIMIT` 在 `GROUP BY` 之后生效，**无法**用分页替代窗口收紧。

### B1 ☆（零改动、立即可用）停掉 30s 轮询 —— 用户侧一条设置

- **位置**：`lib/client.js:1040-1043` —— 卡片工具栏的刷新选择器**本来就有** `option value="0"` = 「不轮询」；`lib/client.js:888-891` 的 `if (refreshSec <= 0) return;` 会让 `setInterval` 完全不建立。
- **操作**：在设置页 dsh-usage 卡片里把刷新档位选「不轮询」→ 周期阻塞 **578ms → 0**。
- **代价**：数据不再自动更新（手动「刷新」按钮仍在 `client.js:899-903`，会 `refresh` + `loadAll` + `loadSessions`）。**无需改代码、无需重启、立即生效。** 这是当下唯一「零改动止血」手段。

### B2 ★★ 轮询加可见性门控 + 并发去重（三种改法的评估）

任务要求评估三种改法：

| 改法 | 改动量 | 副作用 |
|---|---|---|
| (i) 去掉轮询 | 0 行（用 B1 的设置项）或删 `client.js:888-891` | 卡片数据静止；与现状「打开设置页看用量」的用法基本兼容，但失去自动刷新 |
| (ii) 延长周期 | 1 行：`client.js:773 refreshSec` 默认 `30` → `120`；可选在 `:1041-1043` 加 `option value="120"/"300"` | 阻塞频率降为 1/4，但**单次冻结时长不变**（仍 578ms→周期内一次性砸下来）。用户仍会感到卡顿，只是更稀。**治标**。 |
| (iii) **仅卡片可见时拉取** | 约 8-12 行：`client.js:888-891` 的 effect 内加 `IntersectionObserver`（观察卡片根节点）或 `document.visibilityState`；不可见时不建立 `setInterval`，重新可见时立刻 `loadAll()` 一次 | 设置页停留在别的标签/滚动到别处时阻塞归零；副作用是切回瞬间有一次 578ms 卡顿（可接受，且比每 30s 砸一次好）。**推荐**，但它是客户端改动 → 走 §1.3 热替换，零重启 |

补充（同一处、几乎零成本）：`client.js:899-903` 的手动刷新会调 `refresh` 端点，而 `rpc.js:189-191` 的 `refresh` 会**同步触发一次完整 ingest**（`index.js:110-136 runIngest`，内部两个源全量扫描 + 逐天 `rebuildDailyForDays`）—— 它比一次轮询贵得多。建议在 `index.js:110` 的 `runIngest` 加一个 in-flight 标志 + 5s 节流（约 5 行），避免连点「手动刷新」把宿主卡死。
- **验收**：DevTools 里 `refreshSec=0` 后 Network 面板 `/usage/*` 请求归零；或可见性门控后切走再切回只看到 1 组请求。

### C1 宿主侧「不阻塞」：分页 / LIMIT / 避开同步大查询 —— **本场景基本不适用（附反例）**

- **分页/LIMIT 收益 ≈ 0**：heatmap 只返回 31 行、byDay 31 行、byModel 21 行、byProject 61 行 —— **结果集极小，LIMIT 无从下手**（成本全在扫描与逐行 `strftime`，不在返回行数）。
- `sessions` 有 `LIMIT 200`（`db.js:552`），但 `LIMIT` 在 `GROUP BY`/窗口函数**之后**生效，**不减少扫描量** —— 这也是它仍要 66.3ms 的原因。
- 真正让「同步大查询」变小的三条路，按性价比：(a) 走 `usage_daily`（A1，收益 ∞）；(b) `ts` 范围 + 索引 seek（A2，收益 1.8-9×）；(c) 收紧窗口（A3/B2）。**「分页」不是本问题的解**。
- 附注：`summary` 需要的 `COUNT(DISTINCT session_id)`（`db.js:364`）**无法**由任何预聚合表满足（`usage_daily` 无 session_id），它天然要扫窗口内全部行。实测 7 天窗口 13.3ms，可接受；只有当窗口放到 90 天/自选全量时才会明显 —— 到那时它和 `byDay`/`timeseries(day)` 一起成为剩余瓶颈（各 ~45-210ms）。
- 不建议引入 worker thread 做查询：会把架构复杂化（`node:sqlite` 连接不能跨线程共享），A1+A2 已经把 578ms 打到近 0。

### 改动后预期总账（默认 7 天窗口、30s 轮询、单次周期）

| 阶段 | 单周期宿主阻塞 | 需重启宿主? | 说明 |
|---|---|---|---|
| 现状 | **578ms** | — | heatmap 289 + timeseries(day) 46.5 + byDay 43.8 + summary 13.3 + byModel 12.8 + byProject 12.6 + hour 0 |
| 只做 A2（sargable） | **≈449ms** | 是 | heatmap 160（另：ingest 重算 150→22ms） |
| A0 + A1 + A2（预聚合） | **≈0ms** | 是（A1/A2）/ 否（A0） | daily 类全部 <1ms；仅剩 hour 粒度（当前窗口 0ms）+ 每周期 1 次 `MAX(day)` 探测 |
| 再做 B1/B2 | **0** | 否（B1、B2 都是客户端） | 不轮询 / 不可见时不轮询 |

> **不想重启宿主时的组合**：只做 **A0 + B2 + B1**（全是客户端改动，走 §1.3 热替换）→ 周期阻塞从 578ms 降到 0（停止轮询或仅可见时轮询）。代价是**没有把单次 578ms 变便宜**，只是「少砸几次」。要真正把单次代价打下去，**A1/A2 必须重启一次宿主**。

（参考：宿主进程实测单请求 476-498ms 与本轮 heatmap 289ms 同量级；叠加宿主侧 `.dsh` ingest 全量扫描（现状 150-281ms/次，每 45s）与系统 loadavg 5.16 的争用，差值合理。故「单次冻结 0.3-0.5s」的根因确实主要是 heatmap 这一条全表扫。）

---

## 6. 回滚

### 6.1 改前备份（唯一被改文件）

只需备份 **2 个** 文件（`charts.js` 是死文件，不动也不备）：

```bash
TS=$(date +%Y%m%d-%H%M%S)
B=/home/CNS2026495165/dsh/.workspace/settings-lag/backup-usage-$TS
mkdir -p "$B"
P=/home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-usage/lib
cp -p "$P/client.js" "$P/db.js" "$B"/
sha256sum "$P/client.js" "$P/db.js" | tee "$B/SHA256SUMS"
```
（写入落在**工作区** `.workspace/`，不写 `~/.dsh`；`usage.db` 全程不备份、不触碰 —— 本方案不改数据、不建索引。）

### 6.2 还原

```bash
B=<上面的 backup-usage-<TS> 目录>
P=/home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-usage/lib
cp -p "$B/client.js" "$P/client.js"
cp -p "$B/db.js"     "$P/db.js"
sha256sum -c "$B/SHA256SUMS"          # 必须全部 OK
```
- **若只改了 `client.js`**：还原后 **≤500ms 自动热替换回旧行为**，无需重启（`dsh-client-hmr` 会检测到 mtime 变化并重新 hash → SSE `rebuilt` → 浏览器原地重挂载）。旧 `client.js` 自带 `removeOwnedStyles`，卡片会自己收拾干净。
- **若改了 `db.js` / `index.js`**：还原后**旧代码仍在内存中运行**，必须**再重启一次宿主**才真正退回（见 §6.3）。
- **若有客户端 UI 状态残留**（例如把刷新档位选成了「不轮询」）：它只是卡片内的 React state（`client.js:773`），页面刷新即恢复默认 30s，不落盘。

### 6.3 重启宿主（唯一需要动进程的操作 —— 仅在改了 host 半时）

> 由**主 agent / 用户**执行；我全程未触碰 20806。

```bash
kill 20806                 # 或 SIGTERM；父进程 20805 是 `sh -c dsh web`
# 确认退出后重新拉起（cwd 按原样即可，HMR 的 watch root 锚在 profile 目录，不依赖 cwd）
dsh web                    # 等价于 node /home/CNS2026495165/.npm-global/bin/dsh web
```
重启后自检：
1. `ps -o pid,etime,cmd -C node | grep "dsh web"` → 看到**新 PID**（≠20806）。
2. 宿主启动日志应含 `dsh-usage: db ready at /home/CNS2026495165/.dsh/storages/usage/usage.db` 与 `dsh-usage: ingest done: ...`（`index.js:179`、`index.js:129`）。
3. **验证客户端热替换是否真的生效**（可在改 `client.js` 后立刻做，不用重启）：
   在浏览器 Console 或 DevTools：
   ```js
   // 真实出现的 URL（window.__DSH_BOOT__ 携带 entries[].url）
   performance.getEntriesByType("resource").map(r=>r.name).filter(n=>n.includes("/plugins/@local/dsh-usage/client.js"))
   ```
   把它与磁盘文件哈希对比即可确认「线上跑的就是我刚改的那份」：
   ```bash
   sha1sum ~/.dsh/profiles/node_modules/@local/dsh-usage/lib/client.js   # rev = 该 sha1 前 12 位
   ```
   （`dsh-client-modules/lib/index.js:147-149`：`shortHash = sha1(content).slice(0,12)`，所以 `?rev=` 必然等于当前文件的 sha1 前 12 位。若不等，说明宿主还没 rehash —— 等 500ms，或看 `/proc` 不可读时改用下面第四条。）
4. 若想直接确认「运行中的宿主读的是磁盘最新内容」：`curl` 单发取 bundle，比对其 sha1 与磁盘 sha1 —— 由于 `serveBundle` 每请求 `readFile` + `cache-control: no-cache`（`dsh-client-modules/lib/index.js:480-484`），**必然一致**。
5. 注意：**`/proc/20806/fd` 在本环境不可读（`权限不够`）**，因此无法用「看进程打开的 watch fd」来验证 watcher；上述 1-4 是可行的替代验证。

### 6.4 回滚验收

- `lib/client.js`：还原后卡片恢复 30s 轮询；DevTools 里 `/usage/*` 每 30s 出现一组。
- `lib/db.js`：还原 + 重启后，单发 `/usage/heatmap` 耗时回到 ~289-500ms 量级；`EXPLAIN QUERY PLAN` 回到 `SCAN usage_events`。
- 数据零风险：本方案**不写** `usage.db`、**不建索引**、不执行 `VACUUM`/`ANALYZE`，所以不存在数据回滚问题。

---

## 7. 本次调研的纪律与限制（供复核）

- **全程只读**：未写 `~/.dsh` 下任何文件；`usage.db` 一律 `new DatabaseSync(path,{readOnly:true})` / `mode=ro`；**未创建任何索引、未 VACUUM/ANALYZE、未做任何写事务**（`temp_store=MEMORY` 是会话级 pragma，不落盘）。
- **未干扰宿主**：未 kill/stop/信号 20806；`ps` 只读观察。**HTTP 探针 0 次**（未对运行中的宿主发任何请求，全部结论由独立的只读 `node:sqlite` 进程测得）。
- **未使用 `sandbox_permissions`**（审批在本会话关闭，越界即失败）。
- **限制 1**：`/proc/20806/{fd,cwd,environ}` 读取被拒（`权限不够`）→ watcher 覆盖范围改用**源码级证据**（`root:['.']` + `node_modules` 双重排除 + `baseUrl` 锚点）与运行中宿主的**行为观测**（进程 20806 自 11:57 起持续运行、`client.js` 磁盘 mtime 为 9/18，两者独立成立）共同支撑。
- **限制 2**：实测耗时**未复现**上游报告的「单请求 476-498ms」。本机 node:sqlite（与宿主同运行时、同 `jit` 默认值）测得 heatmap 289ms、整周期 577.6ms。差异归因于运行中宿主的额外争用（宿主自身每 45s 一次的全量 ingest 扫描、系统 loadavg 5.16、浏览器并发轮询）。**结论方向不受影响**：heatmap 那条全表扫就是最大单项，且是唯一能被打到 ~0 的路径。
- **限制 3**：全部耗时均为**单发串行、循环 3 次取最小值**，无并发压测；查询一律带界（全年/7 天窗口），未做无界全表重复扫描。
- **未验证项（本环境不可能验证）**：「改 `lib/client.js` 后浏览器卡片自动重挂载」这一条是从源码链（500ms stat → sha1 → SSE `rebuilt` → `invalidate`+`prefetch`+`refresh`）推导的强结论，**我无法在无浏览器控制的条件下实测**。落地时请用 §6.3 步骤 3/4 实测一次再宣布生效路径成立。
- **数据库未被写入（两次独立确认）**：主流程全程 `readOnly:true`；独立复核子代理另做了改前/改后指纹比对 —— `usage.db`（含 `-wal`/`-shm`）的 md5、size、mtime **逐字节一致**，且 `PRAGMA quick_check` = `ok`。全库仍无 `idx_events_ts` 之外的新增索引，`page_count` 未变。

