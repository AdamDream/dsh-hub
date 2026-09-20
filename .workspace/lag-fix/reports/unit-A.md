# 单元 A：`@local/dsh-usage` 宿主主线程冻结修复 — 交付与自复核报告

- 档位：修订执行复核一体（只按裁决落地，不做设计决策、不扩范围）
- 产出目录：`/home/CNS2026495165/dsh/.workspace/lag-fix/`
- 真实现场：**未改动**（本次全程只读真实文件、只读 `usage.db`、未触碰宿主进程 20806）
- 依据：`.workspace/settings-lag/audit-usage-fix.md`（§4.5 / §5 A0、A1、A2、B2）+ 用户裁决四项

| 交付物 | 路径 |
|---|---|
| 补丁脚本 | `patches/usage-plugin.sh`（`--dry-run` / `--apply` / `--rollback`） |
| 替换块定义（脚本的数据源） | `patches/usage-plugin.replacements.txt` |
| 宿主延迟探针 | `probes/usage-host-latency.mjs`（含 `--pairs` 配对阻塞模式） |
| 只读等价性复核 | `probes/verify-daily-equivalence.mjs` |
| 客户端 bundle 冒烟 | `probes/smoke-client-bundle.mjs` |
| 浮点日边界陷阱守卫 | `probes/float-trap-guard.py` |
| 一键自复核 | `probes/run-verification.sh` |
| 重启后应答比对 | `probes/compare-live-endpoints.mjs` |
| 两份拷贝漂移比对 | `patches/usage-plugin-compare.py`（由 `--compare` 驱动）→ 报告 `reports/copy-drift.md` |
| 证据产物 | `reports/dry-run.txt`、`reports/harness-full.txt`、`reports/verify-daily-equivalence.{json,txt}`、`reports/smoke-client-patched.{json,txt}`、`reports/probe-A-before.json`、`reports/live-endpoints-before.json` |

---

## 0. 结论速览

| # | 结论 |
|---|---|
| 1 | **自复核裁决：通过（PASS）**，但含 **1 处必须上报的边界裁决**（§3.1 闸门语义）与 **3 个自复核抓出的真实缺陷**（§3.2，均已修正并加了回归守卫） |
| 2 | 单发 `queryHeatmap` **289ms → 0.081ms**（×3546），达到审计验收门槛 `<1ms`（`T7a/T7b`） |
| 3 | 输出**逐行全等**：31 行全年热力图、`dataSources=dsh/cc`、单日窗口、未聚合日窗口、非日对齐滚动窗口，全部与「独立 SQL 真值 / 原件」逐行一致（`T1/T3/T4/T5/T6`） |
| 4 | 计划确证：旧谓词 `SCAN usage_events`、新谓词 `SEARCH usage_events USING INDEX idx_events_ts (ts>? AND ts<?)`、daily 路线 `SEARCH usage_daily USING INDEX sqlite_autoindex_usage_daily_1 (day>? AND day<?)` **无 TEMP B-TREE**（`T2a/T2b/T2c`） |
| 5 | **未建任何索引**：`db.js` 的 `CREATE INDEX` 集合与原件完全相同（`model,project,ts`），库内索引集合 6 个未变；无 `VACUUM`/`ANALYZE`/`usage_events` 新写语句（`T8a/T8b/T8c`） |
| 6 | `usage.db` 全程 `readOnly:true`；本会话结束时 `usage.db`(36,728,832B)/`-wal`/`-shm` 的 **mtime 与大小与开始时逐字节一致**（11:47:13 / 11:47:24），宿主 PID 20806 未受干扰（未发信号、未重启、未压测） |
| 7 | 生效路径：`lib/client.js` 由 `dsh-client-hmr` ≤500ms 热替换（零重启）；`lib/db.js` **必须重启宿主**才生效（**未由本档执行**） |
| 8 | **两份拷贝**：工作区源码 `dsh-usage/`（git 跟踪）与部署拷贝 `~/.dsh/.../@local/dsh-usage` 是**独立拷贝且已漂移**（部署侧为更新的超集）；但补丁的 4 个目标区域两侧**逐字节相同**、9 个替换点两侧均唯一命中 → **无需合并**，两侧各自 `--apply` 即可（§7） |
| 9 | **交叉验证两处更正**：主 agent 称「`is_subagent` 全为 0、`provider` 恒为 adam」，我独立复算**不成立**（`is_subagent=1` 有 10,154 行、`provider` 有 5 个取值）；已据此在闸门中加入「按能力判断」护栏 —— 带 daily 表达不了的维度过滤时自动整窗回落 events（§8） |
| 10 | **备份隔离与所有权校验**：备份根收进本单元独占命名空间 `backup-usage/<target>/`；每次 apply 写 `MANIFEST`+`POST_SHA256SUMS`；`--rollback` 三重校验（备份自洽 / 清单属本单元 / live 归属）→ 任一不符 exit 1 且**不落盘**。3 个对抗场景（混入别单元快照 / live 未打补丁 / 备份被篡改）**全部被拦住且 live 未被改动**（§9） |
| 11 | **生效路径分两类（勿混说）**：`client.js` = **热面**（GET 从磁盘读 + no-cache、`?rev=` 仅 sha1-12 缓存破坏串、HMR 500ms 轮询推 `rebuilt`）→ 保存 ≤500ms 生效、无需重启；`db.js` = **宿主面**（web HMR disabled、兜底 `root: []`、模块缓存不失效）→ **必须重启宿主**（§9.7） |
| 12 | **⚠️ 复核期间实测：两侧 live 均已被主 agent 打上本补丁**（15:40，`backup-usage/{source,deployed}/backup-20260920-154018` 的 pre/post-sha 与之逐字节吻合 → 应用正确）。复核工具已适配 live 的 pre/post 两态（§9.7）；**`db.js` 仍需重启宿主才生效** |
---

## 1. 逐条交付单元（文件:行号 → 改动 → 验收命令 → 预期/实测数字）

### A0 · 客户端窗口按本地自然日对齐 —— `lib/client.js:800-806`

| 项 | 内容 |
|---|---|
| 锚点（唯一命中校验） | `if (rangeDays > 0) return { from: now - rangeDays * 86400000, to: now };`（live 第 802 行，`grep -c` = 1） |
| 改动 | `rangeDays > 0` 分支改为本地日历对齐 `[今天-(N-1) 天 00:00:00.000, 今天 23:59:59.999]`（29 行 → 30 行）；保留「不日对齐则退回滚动窗口」的守卫兜底 |
| 验收命令 | `node probes/smoke-client-bundle.mjs --client tmp/patched/client.js` → `S3b` |
| 预期数字 | 30 天档误差 **+1.286% req / +1.055% tok → 0.000%**；`from` 本地 `00:00:00.000`、`to` 本地 `23:59:59.999` |
| 实测 | **S3b PASS**：1/7/30/90 天与 00:00:01、23:59:59 起点共 5 组，`fromOK=true toOK=true spanOK=true`（iso 输出为 UTC，如 7 天档 `2026-09-13T16:00:00.000Z..2026-09-20T15:59:59.999Z` = 本地 09-14 00:00:00.000 .. 09-20 23:59:59.999） |

### A1 · `queryHeatmap` 走 `usage_daily` + 显式闸门 + sargable 回落 —— `lib/db.js:422-444`

| 项 | 内容 |
|---|---|
| 锚点 | `export function queryHeatmap(db, filters = {}) {`（live 第 422 行，`grep -c` = 1） |
| 改动 | 新增 `localDayOf` / `localDayMs` / `isLocalDayStart` / `isLocalDayEnd` / `queryMaxDailyDay` / `maxDailyDayMs`（45s TTL 缓存）/ `invalidateMaxDailyDayCache` / `asDayTotals`；`queryHeatmap` 重写为「闸门 + 分段 + 合并」（29 行 → 197 行） |
| 闸门 | ① 窗口两端落在本地日边界（`isLocalDayStart(lo) && isLocalDayEnd(hi)`）；② daily 只服务 `day <= MAX(day)` 的日子；③ 已聚合段用 `usage_daily`、其余段用可走索引的 `ts` 范围查 `usage_events`，两段按 day 合并 |
| 验收命令 | `node probes/verify-daily-equivalence.mjs --live tmp/orig/db.js --patched tmp/mod/patched-db.js` |
| 预期数字 | heatmap **289ms → <1ms**，输出逐行一致 |
| 实测 | **T3a/T3b/T4/T4c/T5(×4)/T6a/T6c 全 PASS**；`T7a` **289.0ms → 0.081ms（×3546）**；`T7b` `<1ms` PASS |

### A2 · `rebuildDailyForDays` sargable 化 —— `lib/db.js:222-248`

| 项 | 内容 |
|---|---|
| 锚点 | `export function rebuildDailyForDays(db, days) {`（live 第 222 行，`grep -c` = 1） |
| 改动 | 重算谓词 `strftime(...) IN (${placeholders})` → `ts >= ? AND ts < ?`（由 `days` 算出本地半开区间）；`SELECT`/`GROUP BY` 的桶表达式**保持不动**；末尾调用 `invalidateMaxDailyDayCache()`（27 行 → 41 行） |
| 验收命令 | `EXPLAIN QUERY PLAN`（`T2a/T2b`）+ 输出等价（`T1`/`T3a` 依赖 daily 与 events 镜像） |
| 预期数字 | ingest 重算 3 天 **150.1ms → 22.1ms**；31 天全量 **281.6ms → 166.3ms**；输出逐行一致 |
| 实测 | 计划：旧 `SCAN usage_events USING COVERING INDEX idx_events_ts` → 新 `SEARCH usage_events USING INDEX idx_events_ts (ts>? AND ts<?)`（**T2a/T2b PASS**）。⚠️ **本次未在只读沙箱内复测 ingest 的端到端 wall-clock**（`rebuildDailyForDays` 会写 `usage_daily`，按纪律不得写库）——见 §5 未验证项 |

### B2 · 轮询可见性门控 + 默认周期 30s → 60s —— `lib/client.js:773, 887-891, 1041-1045, 1022, 857-858`

| 项 | 内容 |
|---|---|
| 锚点 | 6 个替换点全部 `grep -c` = 1（详表见 `reports/dry-run.txt` 的 `[PASS] …锚点唯一命中`） |
| 改动 | ① `useState(30)` → `useState(60)`；② 新增 `pollVisible` / `cardRef` / `setPollVisibleRef` / `ioRef` / `attachCardRef`（`IntersectionObserver`，`threshold:0`，无 IO 时兜底视为可见）；③ 轮询 effect 加 `if (!pollVisible \|\| document.hidden) return;`，依赖改为 `[refreshSec, pollVisible]`，回调读 `loadAllRef.current`（避免筛选项变化重启定时器）；④ `loadAllRef` 赋值；⑤ 下拉项新增 `60s 刷新` 并把 `30s` 降为次项；⑥ 根节点挂 `ref: attachCardRef` |
| 保留项 | `refreshSec=0`「不轮询」选项与 `if (refreshSec <= 0) return;` 语义**原样保留** |
| 验收命令 | `node probes/smoke-client-bundle.mjs --client tmp/patched/client.js` → `S2b/S2c/S4b/S4c` |
| 实测 | **S2b** 默认周期 `60000ms` PASS；**S2c** 卡住 `IntersectionObserver`（observers=1，已 observe 根节点）PASS；**S4b** 五态：可见+60s→建定时器 / `refreshSec=0`→不建 / 卡片不可见→不建 / 标签页隐藏→不建 / 两者都不可见→不建，全 PASS；**S4c** 周期 = `refreshSec*1000` PASS |

### 未动项（按裁决遵守）

- `lib/charts.js`：**未读取改动、未备份**（死文件）。
- `usage.db`：未建索引、未 `VACUUM`/`ANALYZE`、未任何写事务（全程 `readOnly:true` + `PRAGMA temp_store=MEMORY`）。
- `lib/rpc.js`：**未改**（见 §3.1 的范围裁决）。

---

## 2. 实测证据

### 2.1 dry-run（副本应用 + diff + 校验；真实文件未被触碰）

命令与完整输出：`reports/dry-run.txt`（`bash patches/usage-plugin.sh --dry-run`）

```
===== usage-plugin.sh：DRY-RUN（只动工作区临时副本） =====
PKG=/home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-usage
[PASS] A1 锚点唯一命中（db.js）：export function queryHeatmap(db, filters = {}) {…
[PASS] A2 锚点唯一命中（db.js）：export function rebuildDailyForDays(db, days) {…
[PASS] A0 锚点唯一命中（client.js）：if (rangeDays > 0) return { from: now - rangeDays * …
[PASS] B2-poll 锚点唯一命中（client.js）：if (refreshSec <= 0) return;…
[PASS] B2-option 锚点唯一命中（client.js）：react.createElement("option", { value: "30" }, "30s …
APPLIED db-route（1 处替换）/ db-rebuild（1 处替换）/ client-range（1 处替换）/ client-poll（6 处替换）
[PASS] node --check 通过：db.js
[PASS] node --check 通过：client.js
===== DRY-RUN 通过：真实文件未被修改（可安全 --apply）=====
```

dry-run 前后真实文件 sha256（`reports/harness-full.txt` 步骤 2）：

```
802834b56ab3ff400b540279a04534b61b1b996996b539b123b7f9a080160b96  db.js
a4f5a529f391a6d8517a98c31961c1f5d1de4a092e031efd1670ab1e17ce3b48  client.js
[PASS] 真实文件与 dry-run 前快照逐字节一致（dry-run 未触碰真实路径）
```

改动规模：`db.js` 588 → 770 行（+199/-18）、`client.js` 1147 → 1224 行（+82/-6）。

### 2.2 语法与模块可加载性

- `node --check`：补丁后 `db.js`、`client.js` **均通过**（`reports/harness-full.txt` 步骤 4）。
- 客户端 bundle **真实执行**（最小 React/Hook/DOM/DOM-IO 替身）：`S1` 载入注册、`S1a` `factory(require)` 返回 `{apply,inject}`、`S1b` `apply()` 注册卡片、`S1c` 8 轮渲染 + effect 执行无异常 —— **全 PASS**（`reports/smoke-client-patched.json`）。

### 2.3 「daily 与 events 输出逐行一致」前提的只读复核

`node probes/verify-daily-equivalence.mjs --live tmp/orig/db.js --patched tmp/mod/patched-db.js`
（`reports/verify-daily-equivalence.txt` / `.json`，退出码 0）

| 断言 | 结果 |
|---|---|
| `T1` `usage_daily` 与 `usage_events` 全量镜像 | PASS：104,907 行 / 31 天 / 四个 token 桶两侧完全相同 |
| `T2a` 新谓词计划 | PASS：`SEARCH usage_events USING INDEX idx_events_ts (ts>? AND ts<?)` |
| `T2b` 旧谓词计划（对照基线） | PASS：`SCAN usage_events USING COVERING INDEX idx_events_ts` |
| `T2c` daily 路线计划 | PASS：`SEARCH usage_daily USING INDEX sqlite_autoindex_usage_daily_1 (day>? AND day<?)`，**无 TEMP B-TREE** |
| `T3a` 日对齐全年（2026）新旧逐行全等 | PASS：31 行全等 |
| `T3b` 单日窗口 vs **独立 SQL 真值** | PASS：2026-08-19 / 2026-09-18 |
| `T4` `now-N*86400000`（改前客户端形态）逐行全等 | PASS：7 天档、30 天档各 31 行全等（不静默多算） |
| `T4c` `year` 语义未被 `from/to` 误伤 | PASS |
| `T5` `dataSources=dsh / cc` 逐行全等 | PASS：23 行 / 10 行 |
| `T6a` 未聚合日窗口 vs 独立真值 | PASS：5,385 事件、1 行全等 |
| `T6b` **反事实证明**（闸门拦住的正是这个误差） | PASS：真值 10,310,975,630 vs 日取整 daily 10,419,760,029 → **+1.055%**（与审计 §4.5 实测值吻合） |
| `T6c` 非日对齐滚动窗口 vs 独立真值 | PASS：80,120 事件、21 行全等（闸门拒绝 day 取整） |
| `T7a/T7b` 耗时 | PASS：**289.0ms → 0.081ms（×3546）**，`<1ms` |
| `T8a/T8b/T8c` 只读纪律 | PASS：无 `DROP INDEX`/`VACUUM`/`ANALYZE`、`usage_events` 写语句集合与原件相同、`CREATE INDEX` 集合与原件相同（`model,project,ts`）、库内索引 6 个未变 |

### 2.4 改前基线（宿主真实进程，只读 HTTP 探针）

`reports/probe-A-before.json`（`node probes/usage-host-latency.mjs --cycles 2`）：

| 指标 | 实测 | 审计报告预期 |
|---|---|---|
| heatmap 单发 | **285.2ms**（median 297.0，max 308.8） | 289ms ✅ |
| 单周期 `/usage/*` 串行总耗时 | **450–488ms** | 578ms（同量级）✅ |
| 背景探针最大尖峰（= 单周期阻塞） | **313.9ms** | 400–600ms |
| summary / timeseries(day) / byModel / byProject / byDay / timeseries(hour) | 12.7 / 47.4 / 40.1 / 18.1 / 45.5 / 14.3 ms | 13.3 / 46.5 / 12.8 / 12.6 / 43.8 / 9.8 ms ✅ |

`--pairs` 配对模式（heatmap 并发期间背景探针的 max = 事件循环被冻结的时长）：
`heatmap 285.4–288.6ms，背景探针 max 264.9–272.2ms`（`reports/probe-A-before.json` 同源方法）。

### 2.5 `--apply` / 幂等 / `--rollback` 全生命周期（在工作区沙箱副本上实测）

用 `USAGE_PKG_DIR=$PWD/tmp/apply-test` 指向一份原件副本（**真实路径未被触碰**）：

```
1) --apply              → [PASS] 全部哨兵命中 + node --check + 索引集合与备份一致 → APPLY 全部 PASS（退出码 0）
2) 再次 --apply         → [SKIP] 四个单元（A1/A2/A0/B2）均已应用，无操作（退出码 0，幂等成立）
3) --rollback           → 已还原 db.js / client.js + sha256sum -c 全部「成功」（退出码 0）
4) 还原后 vs 原件比对    → db.js: 成功 / client.js: 成功（逐字节一致）
```

### 2.6 真实目标与数据完整性（本档结束时）

```
sha256sum -c /tmp/before-dry.sha
  db.js: 成功      client.js: 成功                      ← 与本次会话开始时的哈希一致
stat usage.db*    → 36,728,832B @ 11:47:13 / -shm @ 11:47:24 / -wal @ 11:47:24   ← 未被写入
ps -p 20806       → node .../dsh web，ELAPSED 03:39:22                            ← 未重启、未被信号打断
```

---

## 3. 需要上报的裁决与自查出的缺陷（必须看）

### 3.1 ⚠️ 边界裁决：闸门语义「全有/全无」→「分段」（**这一处偏离了字面裁决，请确认**）

**用户裁决要求**：仅当「窗口日对齐 **且** `toDay <= MAX(day)`」才走 daily，否则回落 sargable。

**问题**：卡片的 heatmap 请求形状是**整自然年**（`client.js:828` 只传 `{year, dataSources}`，`queryHeatmap` 内部 `end = ${year}-12-31`）。在年中任何时刻，`toDay`（12-31）**恒大于** `MAX(day)`（实测 2026-09-18），所以按字面规则的**全有/全无**判据，daily 路线**永远不会被启用**——「289ms → ~0ms」这个验收目标在当前调用形状下不可能达成，等价于把 A1 做成死代码。

**落地读法（已实现，偏离字面裁决）**：把闸门判定改成**分段**——
- 已聚合段 `[lo, min(hi, MAX(day))]` 走 `usage_daily`；
- 其余段 `(MAX(day), hi]` 走 sargable `ts` 范围查 `usage_events`；
- 两段互斥、按 day 合并。

闸门**原则未被削弱**：daily 依然只服务 `day <= MAX(day)` 的日子（陈旧/未聚合日一定走 events，`T6a` 证明），**且**只有日对齐窗口才启用（非对齐整窗走 events，`T6c` 证明）。年度请求的收益因此可达（`T7`：289ms → 0.081ms）。

**若裁决必须保持字面语义**：把 `queryHeatmap` 中的分段合并退回「全部或全无」即可——但请先接受「卡片热力图单发仍是 ~160ms（sargable 后）」这一后果，因为年度窗口永远无法满足「全部已聚合」。**本档建议接受分段读法**（它同时满足两个目标：正确性闸门 + 验收数字），但裁决权在主 agent/用户。

### 3.2 自复核抓出的 3 个真实缺陷（均已在交付物中修正 + 加回归守卫）

1. **`isLocalDayEnd` 用 `isLocalDayStart(ms + 1)` 判日末 → 恒假**。epoch 是 float，`1798732800000 + 1` 得到的是「次日 `.001`」而不是「当天 `.999`」（实测 `getMilliseconds() === 1`），导致**日对齐判据永远不成立、daily 路线永不启用**。已改为按本地日历取次日午夜再 `-1`。**首次实测即暴露**：`T7` 当时只到 10.5ms（走的是 events 回落）。
2. **年度窗口的包含/半开语义写错 → 丢掉 12-31 一整天**。`queryHeatmap` 的 `to` 是**含**端点（旧代码是字符串 `BETWEEN '${year}-01-01' AND '${year}-12-31'`），我一度把边界当成半开端点，`T3a` 立刻报「31 行不全等」而暴露。
3. **分段合并分支漏掉未聚合尾部 → 静默丢数据**。窗口 = 日对齐段 + 尾部时，合并分支只在两段都「应为空」的条件下触发，结果只返回 daily 段、丢掉尾部（`T6c` 报 21 行 vs 0 行）。已改为「两段都会产出时必然合并」。

配套新增 `probes/float-trap-guard.py`（已并入一键自复核步骤 7）：对「非新建 Date 的 `getTime()±1`」「日长算术后再 ±1」「硬编码 `.999/.001`」三类写法回归拦截。**反向自测**（危险/安全样例各半）确认：5 个危险样例全部命中、2 个安全样例不误报；对交付的补丁块 0 命中。

另：客户端 A0 分支同样踩到 `-1` 浮点坑（`midnight - 1` → `.001`），且初始版还有「先取含 `.999` 的 `to` 再 `setDate` 回退，导致 `start` 继承小数毫秒」的顺序错误——**两者都会让 A0 静默退回滚动窗口**（速度回到 events 路线，且日对齐前提不成立）。已改为「先在整毫秒日边界上做日历回退、再用 `now` 取当日末毫秒」，`S3b` 五组样例全 PASS。

### 3.3 范围裁决（**未做，需主 agent 决定**）

审计 §5 A1「第 4 步」建议顺带改 `lib/rpc.js:203`，把 `filters.from/to` 传给 `queryHeatmap`，让热力图尊重范围选择器。**本档未改**，理由：那会**改变卡片可见行为**（热力图从「整自然年」变成「跟随范围选择器」），属于用户裁决四项之外的范围扩张，且需要前端联动确认。脚本当前**不触碰 `rpc.js`**；若主 agent 要启用，建议单独一档并配一次前后端联合验收。

---

## 4. 主 agent 需要执行的确切命令序列（含 source 与 deployed 两步）

> 前提：本插件有**两份互不相同的拷贝**（见 §7）。两侧都得打补丁才「源码与线上一致」，
> 但**两者是独立步骤、各自有独立回滚**，且**绝不能用某一侧覆盖另一侧**。

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix

# ══ 步骤 0：只读前置（不改任何文件）══
./patches/usage-plugin.sh --compare            # 漂移清单 + 锚点矩阵 → reports/copy-drift.md
./patches/usage-plugin.sh --dry-run --target source     # 工作区源码副本 diff
./patches/usage-plugin.sh --dry-run --target deployed   # 部署拷贝副本 diff
./probes/run-verification.sh --target source    # 全量自复核（期望退出码 0）
./probes/run-verification.sh --target deployed  # 全量自复核（期望退出码 0）
# 改前基线（只读 HTTP 探针 + 原始应答快照，供重启后逐行比对）
node probes/capture-live-endpoints.mjs
node probes/usage-host-latency.mjs --cycles 2 --label before-apply --out reports/probe-A-before.json
node probes/usage-host-latency.mjs --pairs 3 --label before-apply --out reports/probe-A-pairs-before.json

# ══ 步骤 1：改**工作区源码**（source；工作区内、无需审批；git 可直接 diff/回滚）══
./patches/usage-plugin.sh --apply --target source ; echo "apply_source=$?"
cd /home/CNS2026495165/dsh && git diff --stat dsh-usage && git diff dsh-usage/lib/db.js dsh-usage/lib/client.js | less
cd /home/CNS2026495165/dsh/.workspace/lag-fix
# 回滚（source）：用本脚本备份，或用 git 直接退回（git 跟踪，二选一）
./patches/usage-plugin.sh --rollback --target source ; echo "rollback_source=$?"
#   （等价：cd /home/CNS2026495165/dsh && git checkout -- dsh-usage/lib/db.js dsh-usage/lib/client.js）

# ══ 步骤 2：改**部署拷贝**（deployed；工作区外 → 必须带审批执行）══
./patches/usage-plugin.sh --apply --target deployed ; echo "apply_deployed=$?"
#   ⚠️ 若沙箱拒绝写入，请以更宽权限重试同一条命令（本档按纪律从未尝试提权）
#   备份位置：.workspace/lag-fix/backup-usage/deployed/backup-<时间戳>/{db.js,client.js,SHA256SUMS,MANIFEST,POST_SHA256SUMS}
# 回滚（deployed）
./patches/usage-plugin.sh --rollback --target deployed ; echo "rollback_deployed=$?"

# ══ 步骤 3：客户端半生效验证（零重启，≤500ms 热替换；只对 deployed 有意义）══
curl -sS "http://127.0.0.1:3080/plugins/@local/dsh-usage/client.js" | sha1sum | cut -c1-12
sha1sum /home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-usage/lib/client.js | cut -c1-12
#   两者应相同（serveBundle 每请求 readFile + no-cache；rev = sha1 前 12 位）
#   浏览器：设置页 dsh-usage 卡片默认档位应为 60s；卡片滚出视口后 Network 不再出现 /usage/*；
#           选「不轮询」后彻底无请求。

# ══ 步骤 4：重启宿主（唯一需要动进程的一步；deployed/db.js 生效的前提）══
#   ⚠️ 由主 agent/用户执行：
kill 20806            # 或 SIGTERM；父进程 20805 是 `sh -c dsh web`
dsh web               # 重新拉起；确认新 PID ≠ 20806，日志含
                      #  "dsh-usage: db ready at .../storages/usage/usage.db" 与 "dsh-usage: ingest done: ..."

# ══ 步骤 5：重启后复测（验收门槛）══
node probes/usage-host-latency.mjs --pairs 5 --label after-restart --out reports/probe-A-pairs-after.json
#   期望：heatmap min <1ms；单周期阻塞（背景探针 max）<40ms
node probes/usage-host-latency.mjs --cycles 2 --label after-restart --out reports/probe-A-after.json
#   期望：单周期 /usage/* 串行总耗时从 ~450-490ms 降到 ~130-160ms 量级
#         （剩余大头是 summary/byDay/timeseries 等 events 路线 —— 本档按裁决只改 heatmap）
node probes/compare-live-endpoints.mjs --before reports/live-endpoints-before.json
#   期望：全部「逐行一致=true」（只有耗时变了）
```

**两个 target 的回滚对照**

| target | 应用命令 | 回滚命令（首选） | 回滚备选 |
|---|---|---|---|
| `source` | `--apply --target source` | `--rollback --target source` | `cd /home/CNS2026495165/dsh && git checkout -- dsh-usage/lib/db.js dsh-usage/lib/client.js` |
| `deployed` | `--apply --target deployed`（需审批） | `--rollback --target deployed` | 手工：`cp -p .workspace/lag-fix/backup-usage/deployed/backup-<TS>/{db.js,client.js} ~/.dsh/profiles/node_modules/@local/dsh-usage/lib/`（**仅在脚本校验拒绝时人工介入**；正常走 `--rollback`） |

**验收门槛（量化）**

| 指标 | 门槛 | 本档可测部分 |
|---|---|---|
| `queryHeatmap` 单发（原件 readOnly 复现） | **<1ms** | ✅ source 侧 0.077ms / deployed 侧 0.081ms |
| heatmap 单发（真实宿主，改后需重启） | **<40ms** | ⏳ 待步骤 4/5 |
| 单周期阻塞（背景探针 max，改后） | **<40ms** | ⏳ 待步骤 4/5 |
| 全年热力图 31 行 / ds 过滤 / 单日窗口 | **逐行一致** | ✅ **两个 target 各自** T3/T4/T5/T6 全 PASS |
| `is_subagent` / `provider` 过滤（daily 无此列） | **必须回落 events，不得静默算错** | ✅ T9a–T9e 全 PASS（两侧） |
| 任何新索引 / `VACUUM` / `ANALYZE` | **零** | ✅ 两个 target 各自 T8a/T8b/T8c PASS |

---

## 5. 无法在本沙箱内验证的事项（明确列出，未假装通过）

1. **重启后宿主侧的真实数字**：`lib/db.js` 需重启宿主才生效，本档被明确禁止干扰 20806，因此 `heatmap <40ms`、`单周期阻塞 <40ms`、周期总耗时下降**均未实测**，只给出「原件运行时 readOnly 复现」的 0.081ms 与待执行命令（步骤 5）。
2. **浏览器端真实行为**：`dsh-client-hmr` 的 500ms stat → sha1 → SSE `rebuilt` → 原地重挂载、以及 `IntersectionObserver` 在真实设置页中的触发，本档无法在无浏览器控制的条件下验证。已用「bundle 真实执行 + 源码抽取求值」替代（`S1..S4`），并在 §4 步骤 3 给出可直接执行的强证命令（`?rev=` 比对）。**注意**：mock 的 Hook/commit 语义与 React 不完全等价（见 `smoke-client-bundle.mjs` 内注释），因此 S3/S4 采用「从真实文件抽出代码求值」而非「假装 mock 出浏览器行为」。
3. **ingest 的端到端 wall-clock**：`rebuildDailyForDays` 会写 `usage_daily`，按只读纪律未执行，故「150→22ms」只由计划变化（`SCAN → SEARCH`）与审计报告实测支撑，本档**未复测**。
4. **跨时区/跨 DST 行为**：本机为 `Asia/Shanghai`（UTC+8，无 DST）。代码用本地日历构造（`new Date(y, m-1, d)`）而非固定 86400000 回退，理论上 DST 安全，但**未在有 DST 的 TZ 下实测**。
5. **`MAX(day)` 陈旧缓存的 45s 窗口**：`maxDailyDayMs` 有 45s TTL 且 ingest 后会失效。若 ingest 失败超过 45s，最新一天会走 events 回落（正确但慢），这一降级路径**未做故障注入验证**。

---

---

## 6. 自复核裁决

**通过（PASS）**，附 §3.1 的边界裁决上报与 §3.3 的范围说明；**两个 target（source / deployed）各自全量自复核通过**（§7.4 与 §8.8）。

**交叉验证**：主 agent 的 §8.1/8.2/8.3/8.7 四条独立结论与本档一致；其 §8.4（`is_subagent` 全为 0）与 §8.5（`provider` 恒为 `adam`）经我独立复算**不成立**，已在 §8 更正，并据此落地了「按能力判断」的闸门护栏（未来按这两列过滤会自动回落 events，不会静默算错）。

**「合并策略」不需要作为待裁决项**：两侧补丁区域逐字节相同、9 个替换点在两侧均唯一命中，漂移发生在这四个区域之外（§7.2）。唯一仍待裁决的是 §3.1 的闸门语义（它只影响热路径速度，不影响正确性）。

- 等价性/计划/纪律/维度护栏断言（`T1..T9`）+ 客户端断言（`S1..S4`）+ 浮点陷阱守卫：**两个 target 各 38 项 PASS / 0 FAIL**；
- 真实目标文件（两侧）与 `usage.db`：**逐字节未变**；宿主进程 20806：**未受干扰**；
- `--apply` / 幂等 / `--rollback` 生命周期：**在 source 与 deployed 两个 target 的工作区沙箱副本上各自实测通过**；
- 未验证项已在 §5 逐条列明，未以「应该没问题」代替证据。

**不建议在未确认 §3.1 之前重启宿主**：若主 agent 判定必须保持「全有/全无」闸门语义，需先按 §3.1 末段调整 `queryHeatmap` 再应用（届时热力图的热路径收益将退回 sargable 的 ~160ms）。

---

## 7. 两份拷贝（source / deployed）的漂移事实与处理

### 7.1 事实：是两份独立拷贝，且已经漂移

实测**同设备不同 inode**（`66306`）→ 是**拷贝**，不是符号链接也不是硬链接，因此两侧可各自漂移：

| 文件 | source inode | deployed inode | 结论 |
|---|---|---|---|
| `lib/db.js` | 32118476 | 32244137 | 独立拷贝 |
| `lib/client.js` | 32118436 | 32244135 | 独立拷贝 |
| `lib/index.js` | 32118475 | 32244136 | 独立拷贝 |

逐文件比对（完整版见 `reports/copy-drift.md`）：

| 文件 | source 字节/行 | deployed 字节/行 | diff 增删行合计 | 结论 |
|---|---|---|---|---|
| `lib/db.js` | 22367 / 581 | 22913 / 588 | **13**（+10/−3） | **漂移** |
| `lib/client.js` | 29310 / 487 | 66967 / 1147 | **768**（+714/−54） | **漂移**（部署侧 2.3×） |
| `lib/index.js` | 6972 / 188 | 8082 / 216 | **38**（+33/−5） | **漂移** |
| `lib/rpc.js` | 9295 / 221 | 10030 / 230 | **19**（+14/−5） | **漂移** |
| `lib/charts.js` | 7112 / 176 | 27396 / 602 | **478**（+452/−26） | **漂移**（部署侧 3.4×） |
| `package.json` | 1179 / 50 | 1226 / 51 | — | **漂移** |
| `lib/ingest-cc.js` / `lib/ingest-dsh.js` / `lib/zstd.js` / `cordis.patch.yml` / `README.md` | 同 | 同 | 0 | **完全一致**（sha256 相同） |

漂移内容定性（功能级标记，仅部署侧存在）：
`client.js`：`TREND_ANCHOR_HOUR`(0→7)、`trendGrain`(0→7)、`usageDayWindow`(0→4)、`fillBuckets`(0→5)、
`settingsScope`(0→16)、`peakRing`(0→9)、`granularity`(1→12)；
`db.js`：`HOUR_SQL`(0→2)、`granularity`(0→3)（即 **hourly 粒度** 查询）；
`index.js`：`peakRing`(0→1)；`rpc.js`：`granularity`(7→9)；`charts.js`：`usageDayWindow`/`fillBuckets`/`granularity`(0→1/1/6)。

→ **结论：部署侧是更新的超集**（含 hourly 粒度、趋势 gear、settingsScope、peakRing 等已上线功能），
source 侧停留在 9/12 的早期版本。

### 7.2 关键判定：**不需要合并，两侧可各自干净应用**

`--compare` 的锚点矩阵（9 个替换点逐个命中数校验）在两个目标上**全部「唯一命中」**：

| 替换单元 | 文件 | source | deployed | 两侧均可 |
|---|---|---|---|---|
| `db-route` #0 | `lib/db.js` | 唯一命中 | 唯一命中 | ✅ |
| `db-rebuild` #0 | `lib/db.js` | 唯一命中 | 唯一命中 | ✅ |
| `client-range` #0 | `lib/client.js` | 唯一命中 | 唯一命中 | ✅ |
| `client-poll` #0..#5（6 处） | `lib/client.js` | 唯一命中 | 唯一命中 | ✅ |

原因：本补丁只改四个**局部区域**（`queryHeatmap`、`rebuildDailyForDays`、`rangeDays` 窗口、轮询 effect），
而这些区域在两侧**逐字节相同**；漂移全部发生在这些区域**之外**。

**因此「合并策略」不需要作为待裁决项**——不存在互相冲突的改动，两侧各自应用同一份补丁即可。

**独立复核（`probes/region-identity.mjs`，exit 0）**：把补丁命中的 9 个区域的 OLD 原文逐一在两侧查找，
**9/9 个区域在两侧逐字节相同**（`db-route` 29 行、`db-rebuild` 27 行、`client-range` 2 行、`client-poll` 6 处各 1-4 行）
→ 补丁命中区域两侧完全一致，**区域级无差异、无需人工合并**。
漂移集中在这些区域**之外**，且方向是**部署侧多出功能**（`HOUR_SQL`/`granularity`、`TREND_ANCHOR_HOUR`/
`trendGrain`/`usageDayWindow`/`fillBuckets`/`settingsScope`/`peakRing`），不是「同一处实现不同」——
因此**不存在必须二选一的冲突，绝不需要用源码盲覆盖部署侧**。
⚠️ 仍需上报的**唯一**待裁决项是：**要不要把源码 `dsh-usage/` 追平部署侧**（把 hourly 粒度/趋势 gear/
`settingsScope`/`peakRing` 回灌到工作区源码），这**超出单元 A 范围，本档未做**。

### 7.3 仍然禁止的用法（漂移带来的真实风险）

**不要用 source 覆盖 deployed**（或反向）：`client.js` 会丢掉 hourly 粒度 / 趋势 gear / settingsScope / peakRing，
`charts.js` 更夸张（176 行 → 602 行）。本次补丁**不触碰** `charts.js`、`index.js`、`rpc.js`、`package.json`，
只改 `lib/db.js` 与 `lib/client.js` 的上述四个局部区域，所以两个方向都不会误伤漂移内容。

### 7.4 两 target 的独立验证结果（均已实测）

| 验证项 | `--target source` | `--target deployed` |
|---|---|---|
| `--dry-run`（工作区内副本，贴 diff） | ✅ 退出码 0 | ✅ 退出码 0 |
| 全量自复核（T1–T9 + S1–S4 + 浮点守卫） | ✅ 38 PASS / 0 FAIL | ✅ 38 PASS / 0 FAIL |
| `queryHeatmap` 单发（原件 readOnly 复现） | 286.2ms → **0.081ms** | 279.0ms → **0.06ms** |
| 全年热力图 31 行 / `ds=dsh`·`cc` / 单日 / 未聚合日 / 非日对齐 | ✅ 逐行全等 | ✅ 逐行全等 |
| 索引集合 / 无 VACUUM·ANALYZE | ✅ | ✅ |
| `--apply` → 幂等复跑 → `--rollback`（沙箱副本） | ✅ 全 PASS → SKIP → sha256 逐字节还原 | ✅ 同左 |
| 真实文件是否被 dry-run 触碰 | ✅ 未触碰（sha256 前后一致） | ✅ 未触碰 |

证据：`reports/dry-run-{source,deployed}.txt`、`reports/verify-daily-equivalence-{source,deployed}.json`、
`reports/smoke-client-patched-{source,deployed}.json`、`reports/copy-drift.md`。

### 7.5 顺带发现（不影响本次补丁，供参考）

- 部署侧 `db.js` 比 source 多出 `HOUR_SQL` 与 `timeseries(granularity)`；source 要追平线上需单独一次
  「源码同步部署侧」的对比合并 —— **本档未做**（超出单元 A 范围）。
- source 侧 `lib/charts.js` 仅 176 行而部署侧 602 行，说明 source 是早期快照；
  §1 已按裁决**未触碰** `charts.js`（死文件）。

---

## 8. 主 agent 交叉验证的纳入与两处**事实更正**（重要）

主 agent 对 `usage.db` 做了独立核对并要求纳入。我逐条**独立复算**（只读，脚本 `probes/` 同源方法），
结论如下——**3 条完全确认、2 条必须更正**。

### 8.1 ✅ 确认：daily 镜像前提成立（我独立复算，非抽样）

近 8 天窗口逐日对照（`(requests, input+output tokens)` 逐值相等）：

| 日期 | daily (req / tok) | events (req / tok) | 结论 |
|---|---|---|---|
| 2026-09-12 | 10028 / 54,484,309 | 10028 / 54,484,309 | 相等 |
| 2026-09-14 | 6679 / 35,209,501 | 6679 / 35,209,501 | 相等 |
| 2026-09-15 | 5587 / 37,268,123 | 5587 / 37,268,123 | 相等 |
| 2026-09-16 | 3826 / 25,344,493 | 3826 / 25,344,493 | 相等 |
| 2026-09-17 | 3454 / 15,190,436 | 3454 / 15,190,436 | 相等 |
| 2026-09-18 | 5385 / 23,136,694 | 5385 / 23,136,694 | 相等 |

聚合集合双向差集：`(day, model)` daily 114 行 / events 114 行，**双向差集 0**；
`(day, project)` daily 131 行 / events 131 行，**双向差集 0**。
→ 与主 agent 的独立结论**一致**，也与本档 `T1`（全库 104,907 行镜像）一致。

### 8.2 ✅ 确认：`idx_events_ts` 存在，sargable 回退成立，无需建索引

`sqlite_master`：`CREATE INDEX idx_events_ts ON usage_events(ts)`。本档 `T2a/T2b/T2c` 已实测该索引被用于
`SEARCH usage_events USING INDEX idx_events_ts (ts>? AND ts<?)`。补丁**未新建/未删除任何索引**（`T8b/T8c`）。

### 8.3 ✅ 确认：ingest 已停摆（这使新鲜度护栏成为必需项）

- `MAX(ts)` = `1789724522500` → **2026-09-18 17:42:02**
- `usage_daily` `MAX(day)` = **2026-09-18**
- `sync_state` 2744 行，最新 mtime = **2026-09-18 17:42:02**（`dsh:` 源；`cc:` 源停在 2026-09-07）
- 当前时间 **2026-09-20 15:33** → **近两天零写入**

→ 与主 agent 一致，也解释了「150s 观测窗内复现不出 45s ingest 阻塞」：那段代码当前根本没在跑。
本档**未改 ingest 逻辑**（超出单元 A 范围）；正因如此，`day <= MAX(day)` 的**新鲜度闸门是必需项而非可选项**——
若没有它，daily 路线会把 09-18 之后的日子算成 0（而 events 里同样为 0，但一旦 ingest 恢复，窗口尾部就会
从「已聚合日」和「未聚合日」之间产生静默偏差）。本档 `T6a/T6b` 已用反事实证明闸门有效。

### 8.4 ⚠️ **必须更正 1**：`is_subagent` 并非「全为 0」，而是 9.7% 为 1

主 agent 称「当前窗口内实测 `is_subagent` 全为 0」。**独立复算（全库 + 近 8 天）与之不符**：

| 维度 | 实测分布 |
|---|---|
| `is_subagent`（全库） | **0 → 94,753 行（13,645,931,880 tok）** / **1 → 10,154 行（1,075,185,319 tok）** |
| `is_subagent`（近 8 天） | 0 → 30,155 行 / 1 → **0 行** ← *主 agent 观察到的可能只是这个窗口* |
| `(day, is_subagent)` 组合 | 41 个（其中 10 天存在 `is_subagent=1`） |

推断：主 agent 的「全为 0」很可能来自**近 8 天窗口**（那里确实只有 0），而不是全库。
**这一更正让护栏更必要而非更不必要**：`is_subagent=1` 有 10,154 行真实数据，
若未来有任何查询按它过滤而仍走 daily，daily（无该列）会返回全量 → 静默多算 10,154 行。
本档已量化该缺口并写成断言 `T9e`：`is_subagent=1 行数=10154，daily 全量=104907（差 94753 行）`。

### 8.5 ⚠️ **必须更正 2**：`provider` 并非恒为 `adam`，而有 5 个取值

| provider | 行数 |
|---|---|
| `adam` | 81,595 |
| `claude` | 22,700 |
| `opencode-go` | 416 |
| `deepseek-official` | 195 |
| `opencode` | 1 |

近 8 天窗口内亦有**两个**取值：`adam` 29,960 行、`deepseek-official` 195 行。
`(day, provider)` 组合共 37 个。→ 同上：`provider` 过滤下走 daily 同样是静默错（daily 无该列）。

### 8.6 ✅ 确认并**已落地加固**：闸门保留可回退路径 + 按能力判断

主 agent 的护栏指示（「未来若出现按 `is_subagent` 过滤的查询，daily 不可直接代用」）已**写成代码约束**，
而不只是文档：

```js
// queryHeatmap 内（本次新增）
const DAILY_UNSUPPORTED_FILTERS = ["is_subagent", "provider"];
const hasDailyUnsupportedFilter = DAILY_UNSUPPORTED_FILTERS.some((k) => filters[k] !== undefined && filters[k] !== null);
const useDaily = aligned && maxDayMs !== null && lo < dailyEndExclusive && !hasDailyUnsupportedFilter;
// useDaily=false → tailFrom=lo → 整个窗口走精确的 sargable events 路线
```

即：**只要调用方带了 daily 表达不了的维度过滤，就整体回落到 `idx_events_ts` 精确查询**——
护栏是「按能力判断」而不是「按当前调用方」判断，因此未来新增查询**不会**踩到这个坑。
当前所有查询都不带这两列，所以热路径收益（289ms → 0.081ms）不受影响。

新增断言 `T9a..T9e`（两侧均 PASS）：
`T9a` daily 确无这两列（事实前提）· `T9b/T9c` 带 `is_subagent` 过滤时与真值/原件语义一致 ·
`T9d` 日对齐全年 + 该过滤下与原件一致（走 events 而非 daily）· `T9e` 反事实量化缺口。

### 8.7 ❌ 复核：漂移行数「以我的 diff 为准」——主 agent 的三个数字**完全正确**

独立复算（`diff -u` 的增删行合计）：

| 文件 | 主 agent 称 | 我独立复算 | 一致 |
|---|---|---|---|
| `lib/db.js` | 13 行 | **13**（+10/−3，2 个 hunk） | ✅ |
| `lib/client.js` | 768 行 | **768**（+714/−54，17 个 hunk） | ✅ |
| `lib/index.js` | 38 行 | **38**（+33/−5，2 个 hunk） | ✅ |

另补两个未提及的：`lib/rpc.js` **19**（+14/−5）、`lib/charts.js` **478**（+452/−26）。
**未用源码盲覆盖部署侧**：本补丁只对 `lib/db.js`、`lib/client.js` 的四个局部区域做定点替换，
9 个替换点在两侧均唯一命中（§7.2），未触碰 `index.js/rpc.js/charts.js/package.json`。

### 8.8 本节对交付物的影响

| 交付物 | 变化 |
|---|---|
| `patches/usage-plugin.replacements.txt` | `queryHeatmap` 闸门新增 `DAILY_UNSUPPORTED_FILTERS` 能力护栏（+11 行注释/代码） |
| `probes/verify-daily-equivalence.mjs` | 新增 `T9a..T9e` 五条断言（维度能力护栏 + 反事实量化） |
| 两 target 全量自复核 | **各 38 项 PASS / 0 FAIL**（原 33 项 + T9 五项） |
| 真实文件 | 仍逐字节未变；`usage.db` 仍只读未写 |

---

---

## 9. 备份隔离与所有权校验（跨单元防误覆）

### 9.1 隐患

多档补丁脚本共用备份根 + `ls -d "$BACKUP_ROOT"/backup-* | sort | tail -n 1` 选「最新备份」回滚。
一旦备份根被别的单元写入（或选定规则命中别人的快照），**回滚会拿别的单元的快照覆盖 live**。
本单元原实现用 `backup-usage-$TARGET` 作根（撞车概率低），但**缺所有权校验**，属必须补齐的隐患。

### 9.2 加固 1：备份根收进本单元独占命名空间

```bash
BACKUP_ROOT="${BACKUP_DIR:-$WORK/backup-usage/$TARGET}"   # 例：.workspace/lag-fix/backup-usage/source
B="$BACKUP_ROOT/backup-$STAMP"                            # 例：backup-usage/source/backup-20260920-153801/
```

`backup-usage/<target>/` 这一层由本单元独占；`<target>` 再区分源码/部署两份拷贝，两侧备份互不干扰。

### 9.3 加固 2：每次 apply 写入可校验的所有权元数据

每个备份目录现在包含 5 个文件：

| 文件 | 内容 | 用途 |
|---|---|---|
| `db.js` / `client.js` | 改前副本 | 回滚内容 |
| `SHA256SUMS` | 改前 sha（pre-sha） | 证明备份自洽（未被改动/损坏） |
| `MANIFEST` | `unit=usage-plugin/A0+A1+A2+B2`、`target`、`pkg`、`stamp`、`db_pre`、`client_pre` | 证明**这备份是本单元的** |
| `POST_SHA256SUMS` | 应用**后**应有的内容 sha | 证明 **live 确实被本单元改过** |

### 9.4 加固 3：`--rollback` 的三重校验（任一不符即拒绝，且不落盘）

1. **备份自洽**：`sha256sum -c SHA256SUMS` 全部通过；
2. **清单一致**：`MANIFEST` 的 `unit` 必须等于 `usage-plugin/A0+A1+A2+B2`、`target` 必须与本次 `--target` 相同、
   且清单里记的 pre-sha 必须与备份文件的实际 sha 相同；
3. **live 归属**：live 的 sha 必须 ∈ {pre-sha, post-sha}，**且至少一个文件 == post-sha**
   （证明该 target 确实被本单元改过）。

任一不符 → 打印 `[FAIL] 备份不属于本单元… 拒绝回滚以免误覆 live（live 未被改动）` 并 **exit 1**。
另外还原过程改为「先复制到 `mktemp` 暂存区 → `node --check` → 再落 live」，避免半还原。

### 9.5 对抗性实测（3 个攻击场景全部被拦住，live 全程未被改动）

| 场景 | 构造 | 结果 |
|---|---|---|
| ① 备份根混入**别的单元**的快照 | 造 `backup-20990101-000000/`（排序最晚，`tail -1` 必然选中它；内容取自部署侧、`MANIFEST unit=unit-B1-client-runtime`） | **拒绝**，exit 1；命中 7 条 FAIL（unit 不符 / target 不符 / pre-sha 不符 / live 归属不明 / 未处于改后状态）。`ls\|tail` 确实选中了它，但校验拦住了 |
| ② live **未打过本补丁**时回滚 | live 恢复为原件（pre 状态），备份为真实本单元备份 | **拒绝**，exit 1：`live 未处于本单元的改后状态（该 target 可能未打过本补丁）——拒绝回滚以免误覆`；live 保持 `f8f7518073fc` 未变 |
| ③ 备份**被篡改** | 往备份 `db.js` 尾部追加一行 | **拒绝**，exit 1：`备份内容与其 SHA256SUMS 不符` + `MANIFEST 记的 pre-sha 与备份文件不符`；live 保持 `48ea5758fd79` 未变 |

正向路径同样实测通过：`--apply`（写出 SHA256SUMS / MANIFEST / POST_SHA256SUMS）→`--rollback`
（`[PASS] 备份自洽` + `[PASS] 所有权校验通过：该备份确为本单元（usage-plugin / target=source）所建`）
→ 还原后 `sha256sum -c` 与原件逐字节一致。

### 9.6 dry-run 复跑（确认加固未破坏既有行为）

| 命令 | 结果 |
|---|---|
| `./patches/usage-plugin.sh --dry-run --target source` | ✅ exit 0，11 项 PASS / 0 FAIL，副本 `tmp/dryrun-source-<ts>/` |
| `./patches/usage-plugin.sh --dry-run --target deployed` | ✅ exit 0，11 项 PASS / 0 FAIL，副本 `tmp/dryrun-deployed-<ts>/` |
| `./probes/run-verification.sh --target source` | ✅ exit 0，**45 PASS / 0 FAIL**（T7 新增 4 项 + 基线身份/归属 3 项） |
| `./probes/run-verification.sh --target deployed` | ✅ exit 0，**45 PASS / 0 FAIL** |
| 两份真实文件 | ✅ sha256 未变（全程未写 live） |

### 9.7 ⚠️ 复核期间的实测现状：**两侧 live 均已被主 agent 打过补丁**（15:40）

复核过程中发现活跃状态变化（非本档所为；本档全程只读 live）：

| target | live 当前 sha | 备份记录的 pre-sha | 备份记录的 post-sha | 判定 |
|---|---|---|---|---|
| source | `48ea5758fd79` / `5bb727ffc044` | `f8f7518073fc` / `2275965aeb16` | `48ea5758fd79` / `5bb727ffc044` | ✅ live = post（已改后） |
| deployed | `77ab2e8ec489` / `c267687b62de` | `802834b56ab3` / `a4f5a529f391` | `77ab2e8ec489` / `c267687b62de` | ✅ live = post（已改后） |

即：`backup-usage/{source,deployed}/backup-20260920-154018/` 的 `MANIFEST.db_pre/client_pre`
与 `POST_SHA256SUMS` **分别等于本档记录的原始基线与本档补丁的产物**，`live` 等于 post ⇒
**主 agent 的两次 `--apply` 应用了本档的补丁，且应用内容逐字节正确**（本档用所有权元数据反向确认了这一点）。
`dsh-usage/` 的 `git diff --stat` = `db.js +231/-? / client.js +89/-?`（4 个单元哨兵全部命中，`node --check` 通过）。

**因此复核工具已适配「live 可能是 pre 或 post」两种状态**（原实现假设 live 恒为 pristine，会误报）：

| 环节 | 适配后行为 |
|---|---|
| `--dry-run` 基线选择 | live 是 pristine → 基线 = live 本体；live 已是改后 → 基线取自**最近一次本单元备份的 pre-sha 内容**（并打印该来源） |
| `--dry-run` 产物 | 目录内同时留 `db.js`/`client.js`（**应用后副本**）与 `db.js.pre`/`client.js.pre`（**pre 基线**）+ `SHA256SUMS.orig` |
| `--dry-run` 的 diff | 改为 **pre → post**（此前是 live → post；live 已改后时会得到空 diff，看不到补丁内容；现为 324 行有效 diff） |
| 自复核步骤 2 | 改为「抓运行开始时的 live 指纹 → dry-run 后比对」，证明 dry-run 未触碰真实路径（不再假设 pristine） |
| 自复核步骤 3 | 取用 dry-run 的 pre/post 副本，并断言 `pre ≠ post`、`pre 快照与 SHA256SUMS.orig 一致`，再判定 live 归属（pre / post / 其它） |

### 9.8 生效路径：两个半面机制**不同**，脚本帮助文案与本节都分开写清

| 半面 | 文件 | 机制 | 生效方式 |
|---|---|---|---|
| **热面** | `lib/client.js` | `/plugins/<id>/client.js` 每次 GET 都从磁盘 `readFile` + `cache-control: no-cache`；URL 上的 `?rev=` 只是 sha1-12 的**缓存破坏串**；`dsh-client-hmr` 每 **500ms** 轮询 `stat` 比对 mtime/size，变化即重算 rev 并经 SSE 推 `rebuilt` → 浏览器**原地热替换** | **保存文件 ≤500ms 生效**；无需重启、无需手动刷新 |
| **宿主面** | `lib/db.js` | web 层 HMR `disabled: true`、兜底 HMR `root: []`；运行中进程的模块缓存不失效 | **必须重启宿主进程**才生效（本脚本不重启） |

> 不要把两者都说成「刷新即生效」：`db.js` 刷新页面**不会**生效，只有重启宿主才会。

---
