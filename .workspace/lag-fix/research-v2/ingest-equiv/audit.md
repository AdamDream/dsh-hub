# 整体 fold 进 Worker — 等价性对拍与可行性预检（离线）

工作区：`/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/ingest-equiv/`
日期：2026-09-21 · 纯离线：未触碰真实 `~/.dsh/sessions`、`~/.claude/projects`、真实 `usage.db`；未调用 `resolveDbPath()`；未修改任何产品文件；未重启宿主。

被测对象（真实 deployed，只读导入）：

| 文件 | 路径 | 与仓库 `dsh-usage/lib/` |
|---|---|---|
| `index.js` | `~/.dsh/profiles/node_modules/@local/dsh-usage/lib/index.js` | **DIFF** |
| `db.js` | 同上 | **DIFF**（deployed 783 行 / 源码 776 行） |
| **`ingest-dsh.js`** | 同上 | **SAME**（md5 相同） |
| **`ingest-cc.js`** | 同上 | **SAME**（md5 相同） |
| `rpc.js` | 同上 | DIFF |
| `zstd.js` | 同上 | SAME |

两个 `ingest-*.js` 与仓库源码逐字节相同 → 本档结论同时适用于 deployed 与源码。

---

## 0. 结论摘要

**等价 = 可推进**（附 3 个必须先决的约束、2 个必须同批处理的宿主侧改动、1 个建议同批修掉的既有缺陷）。

- 对拍：**9 个对比面对全部 byte-identical**，3 个时区（UTC / Asia/Shanghai / America/New_York）全部 PASS；追加/offset 4 阶段 PASS；CC offset 4 场景 PASS。
- 可行性：**`DatabaseSync` 不可跨线程传递**（硬阻断"把 db 句柄交给 worker"这条路），worker 必须以**自己的连接打开同一文件**。两条连接共存的 WAL 可见性已实测成立。
- 语义变化：**"events COMMIT → daily rebuild" 之间确实出现旧路径不存在的读可见窗口（实跑证实）**，但在全部 9 个 RPC 端点上**读结果没有任何差异**；受影响的只有内部 `usage_daily` 表本身。barrier 不是正确性必需，且**会把 fold 时长转嫁给查询延迟**（见 §3.4）。
- 缓存：worker 内 `invalidateMaxDailyDayCache()` **不能**清宿主线程的 `MAX(day)` 缓存（实测）。宿主侧清理点必需，且该函数当前**未导出**。
- **本档不主张生产延迟已改善**：对拍只能证明算法搬移等价；fold 的总工作量、总同步 SQLite 调用次数**完全不变**（§7）。

---

## 1. 逐条复核前置事实

复核基准 = 另一档所读的真实 deployed 文件。**6 条前置事实全部 PASS**（其中 A6 的行号已精确化，且额外给出"不由 `Object.keys` 导出"的实测证据）；**另新增 4 条纠正/补强（C1–C4）**。

| # | 前置事实 | 判定 | 证据（path:line） |
|---|---|---|---|
| A1 | deployed `runIngest` 外壳 async，但对 fold 是同步调用（占宿主线程） | **PASS** | `lib/index.js:115` `const runIngest = async () => {`；`:120` `foldDshSource(db, undefined, …)`、`:126` `foldCcSource(db, undefined, …)`；**115–143 行函数体内无 `await`** —— async 只是外壳，`fold` 全程同步执行；唯一 await 在 `:207 await runIngest()`（bootstrap 调用点，非函数体） |
| A2 | DSH 源同步 `readFileSync` 全量 + 每 frame 同步解压 + 逐行 `JSON.parse` | **PASS** | `lib/ingest-dsh.js:15` 导入 `readdirSync/readFileSync/statSync`；`:182 buf = readFileSync(file)`（**全量**，无 offset 切片）；`lib/zstd.js:26` `zstdDecompressSync`、`:112` `zstdDecompressSync(buffer.subarray(frame.start, frame.end))` 在 `for (const frame of frames)` 内 → **逐 frame**；`lib/ingest-dsh.js:93 record = JSON.parse(line)` 在 `for (const line of lines)` 内 → **逐行** |
| A3 | CC 源全读但按 `last_offset` 只解析后缀 | **PASS** | `lib/ingest-cc.js:154 buf = readFileSync(file)`（全量）；`:162-164` `offset = size >= Number(state.last_offset) ? Number(state.last_offset) : 0`；`:165 chunk = buf.subarray(offset)`、`:166 text = chunk.toString("utf8")` → 只解析后缀 |
| A4 | SQLite 全同步 `DatabaseSync` | **PASS** | `lib/db.js:68 const { DatabaseSync } = await import("node:sqlite")`、`:73 new DatabaseSync(path)`（**不是** `node:sqlite` 的 `DatabaseSync` 之外的异步 API）；全库无 `Promise` 化的 DB 调用；唯一 `async` 是 `openUsageDb`（为 `await import`）而**非** SQL 异步 |
| A5 | `insertEvent` 实为 `ON CONFLICT DO UPDATE WHERE excluded.ts >= old.ts`（不是 IGNORE） | **PASS** | `lib/db.js:187-196`：`ON CONFLICT(data_source, session_id, dedup_key) DO UPDATE SET ts=excluded.ts, …, cache_write_tokens=excluded.cache_write_tokens` + `WHERE excluded.ts >= usage_events.ts`；**另加**：`:175-180` 先做 `SELECT 1 … WHERE data_source=? AND session_id=? AND dedup_key=?` 预检，`:213 return !exists` —— 返回值"是否新插入"由预检决定（docstring `:164-169` 说明 `changes` 对 UPDATE 也返回 1） |
| A6 | `invalidateMaxDailyDayCache` 未导出（deployed :483 / 源码 :476 附近） | **PASS** | deployed `lib/db.js:483 function invalidateMaxDailyDayCache()`（**无 `export`**）；源码 `dsh-usage/lib/db.js:476` 同形。实测 deployed `db.js` 的 19 个具名导出中**不含**该符号 |

### 新增纠正（前置事实未覆盖，但对本候选有直接影响）

| # | 纠正 | 证据 |
|---|---|---|
| C1 | **`ingest-dsh.js` 的注释已过时**：模块头与内联注释仍称 `INSERT OR IGNORE`，与实际实现的 UPSERT 不符。读注释会得出错误结论 | `lib/ingest-dsh.js:7` "`INSERT OR IGNORE` over `(data_source, session_id, dedup_key)` as the 去重兜底 (B5)"；`:191` "INSERT OR IGNORE keeps it safe." —— 与 `db.js:187` 的 `DO UPDATE` 矛盾 |
| C2 | **"chunk wins on collision" 只对"同一文件内解析期"成立，对 DB 层不成立**。实测：同一 `turn:step` 先 message(5/6) 后 chunk(100/200) → `byKey` 中被 chunk 覆盖，与文档一致；但**chunk 在前、message 在后**时 message 覆盖 chunk，`ts` 相同时 `excluded.ts >= old.ts` 恒真 → **末端记录胜出**，不是 chunk 胜出 | 代码 `lib/ingest-dsh.js:131 if (isChunk \|\| !byKey.has(key))`（仅"chunk 或首次"才覆盖）；`lib/db.js:196 WHERE excluded.ts >= usage_events.ts`。实跑：fixture `turn2:step1` 先 message(`ts=…100_000`, 5/6) 后 chunk(`ts=…100_000`, 100/200，同 ts) → 最终落库 `in=100 out=200`（`out/compare-tz-UTC.json` → `db.usage_events`）。**结论：前置事实的"chunk wins"是解析期规则，不等于入库规则** |
| C3 | **CC 字节游标存在 off-by-one 漂移**：完整读完一个以 `\n` 结尾的文件后，`last_offset = size + 1`（越界 1 字节） | `lib/ingest-cc.js:170` `const consumedBytes = Buffer.byteLength(completeLines.join("\n") + "\n")` —— 当 `endsWithNewline === true` 时 `completeLines = rawLines`，join+`\n` 把末尾那条空串行**还原成多一个 `\n`**，故 `consumedBytes === text.length + 1`；`:213 last_offset: offset + consumedBytes` 累加该误差。实跑：454 B 文件 → `last_offset=455`（`out/append-tz-UTC.json` 第 1 阶段） |
| C4 | 上述漂移在真实数据上会让 CC 的**增量 offset 分支永久失效**（退化为每轮全量重扫），而非增量 | 实测真实源：`~/.claude/projects/**/*.jsonl` 共 **388 个文件，388 个全部以 `\n` 结尾**（0 个例外）→ `last_offset = size + 1 > size` → `size >= last_offset` 恒假 → `offset = 0` 全量重扫。仅当"撕裂尾行（无 `\n`）自身处理完"时 `last_offset < size`（实测 393 B 文件 → `last_offset=197`），此时增量分支**才会**激活并落入 C3 的漂移 → 见 §3 的实跑数据 |

> C3/C4 **不是本候选引入的**，而是 deployed 既有行为；对拍中两条路径表现**完全一致**。它们是"整体 fold 进 Worker"这批工作**应当顺带修掉**的既有缺陷（因为在 worker 里折叠会放大"每轮全量重扫"的 CPU 成本）。

---

## 2. 对拍结果（实跑）

### 2.1 方法

- **baseline**：宿主线程直接 import 真实 deployed `ingest-dsh.js` / `ingest-cc.js`，按 `index.js:120/126` 的调用形状跑 `foldDshSource(db) → foldCcSource(db) → 第二遍 → 空根目录对照`。
- **candidate**：`new Worker()`，worker 内 import **同一批** deployed 模块，经真实 `openUsageDb()` 打开**自己的连接**指向**同一个 db 文件**，执行**完全相同**的调用序列。
- 两侧各自使用**独立的内存/文件 DB**（不同 fixture 根，避免互相污染）；对比前把 fixture 根路径归一化为 `<ROOT>`。
- 对比面 9 个：`return.dshFirst` / `return.ccFirst` / `return.dshSecond` / `return.ccSecond` / `return.dshClean` / `return.ccClean` / `db.usage_events` / `db.usage_daily` / `db.sync_state`（含 `last_offset`）。
- 最终态一律由 **写者关闭后的全新连接**读取。

### 2.2 合成 fixture（`harness/fixture.mjs`，几何为实测值）

| 场景 | 构造 | 实测几何 |
|---|---|---|
| 多 frame zstd | 3 个独立 zstd frame（每 frame 一批事件，模拟宿主每批一帧） | 712 B |
| header 切换 | `request/header` provider `alpha→beta→gamma`；中间插一个 `config` 非对象的坏 header（必须**保持** beta） | — |
| chunk 优先 | 同一 `turn2:step1` 先 message 后 chunk（同 ts）；另含 `assistant/chunk` 非 usage chunk | — |
| 排除类型 | `compaction/summary`、`session/title-llm-request`、`web/deepseek-search-llm-request` 各带 usage 必须被丢弃 | — |
| 缺 turn/step、缺 ts、ts 非数字 | 3 条必须不入库 | — |
| 坏 JSON | 1 行非 JSON（解析器继续） | — |
| 撕裂 zstd 尾帧 | 完整 frame + 截断 frame | 268 B，完整部分 211 B，`tornStart=211` |
| 结构损坏 zstd | magic 非法 → `parseDshSession` 抛错 | 31 B |
| CC 主文件 | 4 条含 usage + 1 条坏 JSON + 1 条非 assistant；含 `max(0, input−read−creation)` 需为 0 的一行 | 916 B |
| CC subagent | 同 `sessionId`、`dedup_key` 与主文件冲突（`msg-1`）但 **ts 更晚** → 结果与 readdir 顺序无关 | 224 B |
| 空根目录 | `scanned=0 / newEvents=0 / failedFiles=[]` | — |

实测落地：**6 events / 5 daily**；`dshFirst scanned=2 new=5 failed=1`；`ccFirst scanned=2 new=1 failed=0`；第二遍两侧均 `scanned=0 new=0`（mtime/size 闸门生效）；`sessC` 报 `corrupt Zstandard session log: invalid frame magic at byte 0`；`sessB` 的 `sync_state` = `size=268, last_offset=211, fingerprint=torn:211`。

### 2.3 结果

| 运行 | TZ | 9 个对比面 | 原始 JSON |
|---|---|---|---|
| 等价比对 | UTC | **PASS — byte-identical** | `out/compare-tz-UTC.json` |
| 等价比对 | Asia/Shanghai | **PASS — byte-identical** | `out/compare-tz-Asia-Shanghai.json` |
| 等价比对 | America/New_York | **PASS — byte-identical** | `out/compare-tz-America-New_York.json` |
| 等价比对（含同步 barrier 路径） | UTC | **PASS — byte-identical** | `out/compare-gap-barrier.json` |
| 追加/offset 4 阶段（真实 append，非种子游标） | UTC | **PASS — identical across all 4 phases** | `out/append-tz-UTC.json` |
| CC offset 4 场景矩阵 | UTC / Shanghai / New_York | **PASS — identical in all 4 seed scenarios**（×3） | `out/cc-offset-tz-*.json` |

**追加场景（真实 append，实测 4 阶段全等）：**

| 阶段 | 文件大小 | 两侧 return | 两侧 sync_state |
|---|---|---|---|
| initial | 454 B | `scanned=1 newEvents=2 failed=0` | `size=454 last_offset=455` |
| append-new（追加 m-3） | 651 B | `scanned=1 newEvents=0 failed=1`（`1 unparsable JSON lines`） | `size=651 last_offset=652` |
| append-conflict-update（追加 m-1 新 ts） | 909 B | `scanned=1 newEvents=0 failed=1` | `size=909 last_offset=910` |
| unchanged-noop | 909 B | `scanned=0 newEvents=0 failed=0` | 不变 |

→ **两侧 4 阶段逐项全等**。注意：第 2、3 阶段 **m-3 / m-4 都没有入库**，且报"1 行不可解析"——这是 C3 漂移的必然结果（`last_offset` 越界 1 字节 → 后缀从半个字符处开始读 → 首行解析失败、真数据被跳过）。**该缺陷在 baseline 与 candidate 中完全一致**，属既有缺陷，非搬移引入。

**CC offset 矩阵（实跑，游标=精确首行长度 257 B）：**

| 场景 | 游标 | 两侧 return | 两侧 events | 两侧 `last_offset` |
|---|---|---|---|---|
| A-exact-cursor | 257 | `scanned=1 new=3 failed=0` | m-2,m-3,m-4 | 1029（文件 1028） |
| B-cursor-past-eof | 258 | `scanned=1 new=2 failed=1` | m-3,m-4 | 1029 |
| C-absurd-cursor | 10 000 000 | `scanned=1 new=4 failed=0` | m-1..m-4 | 1029 |
| D-no-state | — | `scanned=1 new=4 failed=0` | m-1..m-4 | 1029 |

→ **4 场景 × 3 时区，两侧 return / events / daily / sync 全等**。A 场景证明 `offset = last_offset` 的**后缀解析分支**在两侧行为一致（m-1 被跳过）；B 场景证明 `size >= last_offset` 为假时的**全量重扫**分支一致（丢掉 1 条 + 报 1 行不可解析）；C 证明超大游标回落一致。

**撕裂尾帧恢复路径**：主 fixture 的会话 B 用过期 size 触发重读，实测 `tornStart=211 / completeBytes=211 / fingerprint=torn:211`，两侧一致。

---

## 3. 搬进 worker 后语义会变的地方

### 3.1 硬阻断项：`DatabaseSync` 无法跨线程（实跑）

```
probe-db-clone → DataCloneError: Cannot clone object of unsupported type.
structuredClone(db) → DOMException: Cannot clone object of unsupported type.
```

**含义**：不存在"把宿主 `db` 句柄 postMessage 给 worker"的方案。worker 必须**自己开一条到同一文件的连接**（`openUsageDb(dbPath)`，路径必须由宿主显式传入，**不可**在 worker 里调用 `resolveDbPath()` —— 它会 `mkdirSync` 并触摸真实 home）。

**两条连接共存的 WAL 语义（实跑，`harness/probe-two-conn.mjs`）**：

| 观察 | 结果 |
|---|---|
| 写者事务**未提交**时宿主读 | `c=0`，`waited=0ms`，**无错误**（宿主看到自己的快照，看不到未提交行） |
| 写者 **COMMIT 后**宿主读 | `c=2`，跨连接立即可见 |
| 写者重建 `usage_daily` 后宿主读 | 聚合行立即可见 |

→ 两条连接方案**可行**，不需要把 db 句柄搬进 worker。

### 3.2 新增"读可见窗口"：确实存在（实跑）

`foldDshSource` / `foldCcSource` 在**每个文件**上的形状是：

```
BEGIN → N×insertEvent → COMMIT        ← 事务 A（只写 usage_events）
        ↓   （旧路径：两条紧邻同步语句，宿主事件循环不可能在此让出）
rebuildDailyForDays(days)             ← 事务 B（写 usage_daily，:236-254）
```

旧路径中 `COMMIT` 与 `rebuildDailyForDays` 之间**没有可观察窗口**（`index.js:115-143` 函数体内无 `await`，全程同步）。

在 worker 中它们变成**两条连接上的两个独立事务**，宿主 RPC 可以插在中间。**实跑证明该窗口存在且可达**（`out/design-txn-open.json`，每个 COMMIT 处 `VACUUM INTO` 取精确快照）：

| COMMIT # | usage_events 行数 | usage_daily 请求数之和 | events − daily |
|---|---|---|---|
| 1 | 4 | 0 | **4** |
| 2 | 4 | 3 | 0 |
| 3 | 5 | 3 | **1** |
| 4 | 5 | 4 | 0 |
| 5 | 5 | 4 | 0 |
| 6 | 6 | 4 | **1** |
| 7 | 6 | 5 | 0 |

`events − daily ≠ 0` 的时刻就是窗口：**窗口在 fixture 中每轮出现 ~4 次**，且**每个文件的每次 events COMMIT 之后都会出现一次**。此外它是**多文件叠加**的：第 k 个文件的 COMMIT 提交后，第 k+1..n 个文件的日常重建也可能尚未完成，因此"events − daily"窗口可以跨越整个 pass。

**但这个窗口在 RPC 层面不可观察（实跑，关键证据）**：把**同一份事件集**冻结成 DB 副本，对"重建前"与"对同一副本执行真实 `rebuildDailyForDays` 后"两态跑**全部 9 个端点**：

```
summary_all / heatmap_2025 / heatmap_2026 / byDay_all / byModel_all /
byProject_all / timeseries_day / timeseries_hour / sessions_all / raw_count
   → 10 项全部 SAME（同值）
daily_maxday ({"d":null} → {"d":"2025-08-24"})
daily_rows   ({"c":0}    → {"c":3})
   → 仅这两项是内部表探测，不是 RPC 端点
```

原因（读源码确认）：`db.js` 中**只有** `queryHeatmap` 读 `usage_daily`（`:586-593`），且它只是一个**快路径门控** —— `MAX(day)` 为 null 时 gate (2) (`:552-565`) 把整窗回落到**精确的 raw-events 路线**。两条路线都被既有测试（注释 `:515-516` 的 T3/T4/T5/T6）验证同值。其余 7 个端点（`querySummary:369` / `queryByDay:710` / `queryByModel:648` / `queryByProject:679` / `queryTimeseries:406` / `querySessions:744`）**只查 `usage_events`**。

同时实测：窗口期间宿主读**不阻塞、不报错**（`raw_count={"c":4}`，`waited≈0`），写者事务**已提交**故无写锁争用。

**结论：窗口是"内部表去规范化滞后"，不是"用户可见的错误数字"。**

### 3.3 worker 内的 invalidate 能否清宿主线程的 `MAX(day)` 缓存？**不能**（实跑）

`db.js:471 let maxDailyDayCache = { at: 0, value: null }` 是**模块级**状态；`:483 invalidateMaxDailyDayCache()` 只重置本线程自己的绑定。worker 有独立的模块实例。

**实测（保真插桩副本 `probe/lib/db.js`，见 `probe/README.md`；与 deployed 的 diff 仅剩 1 行 import 桩）：**

| 观察 | 结果 |
|---|---|
| worker 启动时自己的缓存 | `undefined`（全新实例） |
| worker 内 `rebuildDailyForDays` → `invalidate` 计数 | `invalidate: 1`（在 **worker 线程内**生效） |
| 宿主线程 `invalidate` 计数（worker 跑完后） | 仍为 `1`（**只有宿主自己那次**；worker 的 invalidate **未穿透**） |
| 宿主缓存是否被清 | **没有** |
| 宿主 `queryHeatmap` 结果是否仍正确 | **是**（`hostHeatmapStillCorrect: true`） |

**宿主侧清理点（设计，最小改动）**：

1. `db.js` 导出 `invalidateMaxDailyDayCache`（当前 `:483` 无 `export`，属 C-类必须改动）。
2. `index.js` 中 `runIngest` 的 worker 等待 promise **settle 之后**（成功或失败都算）由宿主调用一次。建议放在 `:134 lastIngest = Date.now();` 一带，或包在 `finally` 中。
3. 语义澄清（重要）：该缓存**变旧不会导致错值**。`MAX(day)` 只会单调不减，"旧值"意味着 gate 用了一个**更早**的 `day` 边界 → 更多天数回落到 raw-events 精确路线 → **仍然正确**，只是少了快路径。故这是**性能项**，不是正确性项；不做也安全，做了更好。**不要把它写成"必须修否则数字错"**。

### 3.4 barrier 设计（若仍要消除窗口）——以及为什么本档**不建议默认开启**

最小 barrier 形状：

```js
let inFlight = null;                     // index.js: let inFlight = null;
const runIngest = () => (inFlight ??= (async () => { …原同步 body… })()
  .finally(() => { inFlight = null; invalidateMaxDailyDayCache(); }));

// registerUsageRpc(ctx, { db, ingest: runIngest, statusProvider, waitIdle: () => inFlight ?? Promise.resolve() })
// rpc.js handle():
//   refresh → await waitIdle(); return { ok: true, value: statusProvider() }   ← usage 路径才等
//   status  → 不等，立即 statusProvider()                                       ← 保持现状
//   数据端点 → await waitIdle() 后再 getDb()/query*
```

**但实测给出了反对默认开启的三条依据：**

1. **窗口在 RPC 层不可观察**（§3.2 的 10 项 SAME），收益是"内部表瞬时一致性"，零用户可见收益。
2. **barrier 会把 fold 时长直接转嫁给查询延迟**：worker 在折叠期间（生产是"全量重扫 + 百万行"量级），`summary/byDay/...` 全部要等整个 pass 结束才响应 —— 这正是当前 `refresh` 已经有、而其他端点**刻意没有**的行为（`rpc.js:189-195` 把 `refresh` 与 `status` 分开处理就是这个意图）。等于用"L 秒的查询停顿"换一个不可见的窗口。
3. **`status` 若也并入等待，会直接打掉进度可见性**：`index.js:121-124` 的 `onProgress` 在 pass 中途写 `ingestSummary`，`statusProvider` (`:148-170`) 读的正是这份实时状态（docstring `:145-147` 明说是刻意设计成"读调用时刻的可变状态"）。建议**永不**让 `status` 等待；否则客户端在 ingest 期间看不到任何进度。

**因此本档建议：默认不启用 barrier**，只保留 `inFlight` 引用用于 `refresh` 去重（防止两次 refresh 叠加跑两份 fold）。

### 3.5 其他实测到的差异面（都不影响等价，但会影响落地）

| 项 | 实跑结果 | 影响 |
|---|---|---|
| 连接数 | 搬移后宿主与 worker **各持一条连接**（原本仅宿主一条） | 宿主的 `getDb()` 连接不再复用原模块的单连接/prepared-statement 缓存；需实测查询耗时回归 |
| `busy_timeout` | deployed **未设置任何** `busy_timeout`（`grep busy_timeout db.js` = 无；实测 `PRAGMA busy_timeout` → `{"timeout":0}`） | 见下条 |
| 写事务争用 | 实测：worker 持**写事务**时，宿主 `SELECT` **0ms 成功**；宿主 `BEGIN IMMEDIATE` **立即失败** `ERR_SQLITE_ERROR: database is locked`（设 `busy_timeout=5000` 后改为等待 1530ms 成功） | 宿主侧若将来出现任何写路径（或 WAL checkpoint 竞态），会**硬失败**而非短等。**建议宿主连接设 `busy_timeout`**（一行，低成本保险） |
| 间歇性 `database is locked` | 全套件 2 次运行中，**1 次**在宿主旁观者连接上出现 `ERR_SQLITE_ERROR: database is locked`（`out/compare-tz-Asia-Shanghai.json`、`out/compare-same-state.json`）；加 250ms 重试后消失。**未能稳定复现**（专项压测：持写事务 25 轮、跨界停车 60 轮、worker 关闭竞态 40 轮，**0 次失败**） | **INCONCLUSIVE**（见 §5）。与 3.5 的 `busy_timeout=0` 直接相关：产品当前把任何碰撞都变成硬失败 |

---

## 4. 逐条判定表

| # | 检查项 | 判定 | 实跑 / 设计 |
|---|---|---|---|
| 1 | A1 `runIngest` async 壳 + 同步 fold | **PASS** | 实跑（读码 + 全文检索无 await） |
| 2 | A2 DSH 同步全量读 + 逐 frame 解压 + 逐行 parse | **PASS** | 实跑（读码） |
| 3 | A3 CC 全读 + 按 `last_offset` 解析后缀 | **PASS** | 实跑（读码 + offset 矩阵 A 场景） |
| 4 | A4 SQLite 全同步 `DatabaseSync` | **PASS** | 实跑（读码） |
| 5 | A5 `insertEvent` 是 UPSERT + `WHERE excluded.ts >= ts`，非 IGNORE | **PASS** | 实跑（读码 + 同 ts 覆盖实测） |
| 6 | A6 `invalidateMaxDailyDayCache` 未导出（deployed :483 / 源码 :476） | **PASS** | 实跑（`Object.keys(db)` 19 项不含该符号） |
| 7 | C1 DSH 注释仍写 `INSERT OR IGNORE`（过时） | **PASS（纠正成立）** | 实跑（读码） |
| 8 | C2 "chunk wins" 只是解析期规则，DB 层是同 ts 末端胜出 | **PASS（纠正成立）** | 实跑（fixture 实测落库 100/200） |
| 9 | C3 CC `last_offset = size + 1` 漂移 | **PASS（缺陷实证）** | 实跑（454 B → 455） |
| 10 | C4 漂移使真实 CC 增量分支失效（388/388 文件以 `\n` 结尾） | **PASS（实证 + 统计）** | 实跑（真实源统计 + 逻辑推演） |
| 11 | `DatabaseSync` 不可跨 worker 传递 | **PASS** | 实跑（DataCloneError） |
| 12 | 两连接共存的 WAL 可见性 | **PASS** | 实跑 |
| 13 | 9 对比面 byte-identical × 3 时区 | **PASS** | 实跑 |
| 14 | 追加/offset 4 阶段全等 | **PASS** | 实跑 |
| 15 | CC offset 4 场景 × 3 时区全等 | **PASS** | 实跑 |
| 16 | `COMMIT → rebuild` 窗口存在且可达 | **PASS（窗口存在）** | 实跑（每 COMMIT 精确快照） |
| 17 | 该窗口**不产生任何 RPC 值差异** | **PASS** | 实跑（同事件集 9 端点 × 10 项 SAME） |
| 18 | worker 的 invalidate **不能**清宿主缓存 | **PASS** | 实跑（保真插桩副本） |
| 19 | 宿主缓存变旧**不导致错值**（仅失快路径） | **PASS** | 实跑 + 源码门控分析 |
| 20 | 宿主读在 worker 持写事务时**不阻塞** | **PASS** | 实跑（60 轮，`waited≤1ms`） |
| 21 | 宿主写事务与 worker 写事务会硬失败 | **PASS（风险实证）** | 实跑（`BEGIN IMMEDIATE` 立即 lock 失败；`busy_timeout` 可解） |
| 22 | 间歇性 `database is locked`（宿主旁观连接） | **INCONCLUSIVE** | 实跑到现象，**未能稳定复现**（压测 0/125） |
| 23 | barrier 最小设计（`inFlight` + 端点等待） | **设计（未落地）** | 设计 + 部分实跑（`--barrier` 路径跑通且对拍 PASS） |
| 24 | 宿主侧缓存清理点（导出 + settle 后调用） | **设计（未落地）** | 设计 |
| 25 | 搬进 worker 后**生产延迟改善** | **未主张 / 未测量** | 明确不做结论 |

---

## 5. 结论：等价 = 可推进

**等价性成立**：在合成 fixture 覆盖的全部路径（多 frame、header 切换、chunk/message 优先、坏 JSON、结构损坏、撕裂帧 + 游标恢复、CC 后缀解析、CC 全量回落、空根目录、幂等第二遍、真实 append、同 ts 冲突更新）上，**宿主线程 fold 与 worker fold 的 `return` / `usage_events` / `usage_daily` / `sync_state`（含 `last_offset`）逐字节相同**，跨 3 个时区成立。

### 最小交付单元

| 单元 | 内容 | 验收 |
|---|---|---|
| **U1** | worker 入口：接收**显式** `dbPath`（**禁止**调用 `resolveDbPath()`），import 真实 `ingest-dsh/cc`，用真实 `openUsageDb` 开自己的连接，跑与 `index.js:120-131` **完全相同**的调用序列，回传两个结果对象 | 本档 `harness/run.mjs` 的 9 项对比在 3 时区全 PASS |
| **U2** | `index.js`：`inFlight` promise + `Worker` 生命周期（`dispose` 时 `terminate`）、错误只 `log.warn`、`ingestSummary.onProgress` 经 message 回传 | `status` 端点在 ingest 期间仍实时（不等待） |
| **U3** | `db.js`：`export` `invalidateMaxDailyDayCache`；`index.js` 在 settle 后（含失败路径）调用一次 | 插桩实测宿主 invalidate 计数 +1 |
| **U4** | `refresh` 端点复用 `inFlight` 去重（**不**给数据端点加 barrier） | 并发两次 refresh 只跑一份 fold |
| **U5** | 宿主连接设 `busy_timeout`（如 5s），消除 hard-fail 面 | `BEGIN IMMEDIATE` 争用下等待而非立即失败 |
| **U6**（建议同批） | 修 C3：`consumedBytes` 在 `!endsWithNewline` 时不得 `+1`；修 C1 的过时注释 | CC append 场景 m-3/m-4 正常入库；`last_offset === size` |

**验收（对拍作为回归门）**：本目录 `./run-suite.sh` 全绿 = 9 对比面 × 3 时区 + 追加 4 阶段 + CC offset 4 场景 × 3 时区 + 各项可行性探针。

### 阻断项（当前无硬阻断，但有 3 个"必须先决"）

1. **不得假设可以共享 db 句柄** —— `DatabaseSync` 不可克隆（实跑）。任何"把 db 传进 worker"的设计直接否决。
2. **必须显式传 dbPath** —— worker 内绝不能调 `resolveDbPath()`（会 mkdir 并触摸真实 home，违反离线/安全约束）。
3. **必须接受窗口或明确放弃 barrier** —— 窗口真实存在但 RPC 不可见；若坚持加 barrier，必须只加在数据端点（`status`/`refresh` 除外），并在文档中写明"查询会阻塞整个 pass 时长"的代价。

---

## 6. 对拍**不能**证明什么（明确边界）

- **不证明生产延迟改善**。fold 的总工作量、总同步 SQLite 调用次数、总 fs 调用次数**完全不变**；搬进 worker 只是把同步占用从宿主事件循环移走，同时**新增**线程启动 + 消息传递开销（本档 fixture 量级下平均 worker 启动 ≈ 50–670ms，属探针噪声区间，**不可**外推生产）。
- 本档**未**在真实数据规模（约 105k 行 / 35MB / 388 个 cc 文件）上测量，故**未**测量宿主事件循环阻塞时长的实际下降。
- 本档**未**测量两连接方案带来的查询耗时回归（宿主失去单连接 prepared-statement 复用）。
- 本档**未**验证 `MAX(day)` 缓存在两连接下是否会因 WAL 可见性出现"读到更早 MAX"的时序（逻辑上单调不减故安全，但未压测）。

---

## 7. 复现

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/ingest-equiv
./run-suite.sh                     # 全套件（3 时区 + 追加 + offset 矩阵 + 全部探针）
TZ=UTC node harness/run.mjs --label my-run                    # 等价比对
TZ=UTC node harness/run.mjs --label gap --gap-ms 600          # 窗口观察 + 同事件集端点对比
TZ=UTC node harness/run.mjs --label barrier --gap-ms 200 --barrier
TZ=UTC node harness/run-design-probes.mjs --label txn --hold-ms 700   # 每 COMMIT 快照 + D3
TZ=UTC node harness/run-cc-offset-matrix.mjs --label cc
TZ=UTC node harness/run-append-case.mjs --label append
TZ=UTC node harness/probe-barrier-lock.mjs 20
```

### 产物清单

| 路径 | 内容 |
|---|---|
| `audit.md` | 本文件 |
| `harness/fixture.mjs` | 合成 fixture 生成（多 frame zstd / header / torn / 坏 JSON / CC / 种子 sync_state） |
| `harness/run.mjs` | 等价比对主程序（baseline vs worker，9 对比面） |
| `harness/worker-run.mjs` | worker 侧同序列 fold（自己的连接） |
| `harness/query-probe.mjs` | 9 端点 + 重建前后同态探针 |
| `harness/run-cc-offset-matrix.mjs` | CC offset 4 场景矩阵 |
| `harness/run-append-case.mjs` / `worker-append.mjs` | 真实 append 4 阶段 |
| `harness/run-design-probes.mjs` / `worker-snapshots.mjs` | 每 COMMIT 精确快照 + 事务内重建反事实 |
| `harness/probe-*.mjs`, `harness/reader-child.mjs`, `harness/barrier-holder.mjs` | 各专项探针 |
| `probe/lib/db.js` + `probe/README.md` | 保真插桩副本（缓存跨线程证据） |
| `out/*.json` | 全部原始对拍 JSON |
| `out/suite.log` | 全套件原始输出 |
| `run-suite.sh` | 一键复现 |

---

## 附：本次对拍中被证伪/纠正的两个常见误判

1. **"`usage_daily` 落后 ⇒ 数字错"** —— 错。`usage_daily` 只被 `queryHeatmap` 的快路径门控读取，`MAX(day)` 落后时整窗回落到 raw-events 精确路线；实测 9 个端点同事件集下**全部同值**。
2. **"drop 掉 `usage_daily` 就能测出缓存是否命中"** —— 错。drop 之后 `queryHeatmap` **自身的 daily 分段**也会报 `no such table`，无法把"冷缓存"与"坏表"区分开。本档改用了保真插桩副本（`probe/`）。
