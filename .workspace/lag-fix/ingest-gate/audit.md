# ingest 阻塞重新定性（子代理摘要的落盘记录）

> ⚠️ **本文件的来源与边界**：内容来自 ingest 审计档（含其隔离子档）的**文字摘要**。该档及其子档在收尾时遭遇工具参数校验故障（连续把可选的 `sandbox_permissions` 传成非法值，调用在参数层就被拒），因此**没有测出任何产物、没有跑成任何测试**。它明确的结论是「不能声称测试通过」。
> 主 agent 因此**只登记其已读源码得到的事实**，并把它标为**未独立复核**；不冒充为本轮验证结果。

## 1. 478–846ms 这一数字的口径（必须收窄）

- 出处：`.workspace/lag-fix/reports/settings-jank-audit-host-loop.md:26` 引用 `measure-ingest2.mjs`。
- 该脚本行为：`:3` 导入**真实 deployed** `~/.dsh/profiles/node_modules/@local/dsh-usage/lib/ingest-dsh.js`，`:9` 遍历最大的 3 个日志文件、**强制同步** read + parse。
- 因此它是 **deployed 路径的 parser 基准（独立进程）**，**不是**当前宿主 PID 的 45s ingest tick 实测；也没有历史 hash 可回溯当时文件。
- 旧报告 `host-loop.md:28` 本已限定；**综合报告 `settings-jank-audit-synthesis.md` 的表述过宽，已在本轮更正**（见该文件 §一 裁决 C 的更正注）。

## 2. 已读源码得到的事实（子代理读真实文件所得，主 agent 未独立复核）

| 项 | 事实 |
|---|---|
| 宿主接线 | deployed `index.js:110` `runIngest` 外壳是 async，但 `:113/:119` 直接**同步**调用 `foldDshSource` / `foldCcSource`；`:184` 首次 scan、`:187/:189` 45s timer；**无 Worker**。（async/microtask 不会把执行搬到别的线程。） |
| DSH 源 | 同步 `enumerate`（stat 比较 mtime+size 跳过未变文件）；dirty 文件 `readFileSync` 全量读；`zstd:112` 每 frame 同步解压、`:116` concat；parse `:93` 逐行 `JSON.parse`（全量）；`last_offset` 只记完整帧末尾。 |
| CC 源 | `:154` 全量 read，`:161-165` 按 `last_offset` 截尾后 `JSON.parse` —— **不是全量 parse**（先前说法需修正）。 |
| SQLite | 全同步（`db:73` `DatabaseSync`）；`:174` `insertEvent` 实为 `ON CONFLICT … DO UPDATE WHERE excluded.ts >= old.ts`（**不是**注释所称 IGNORE）；`:222` daily rebuild 已有 ts 索引范围优化；`:261` 清 cache。 |

## 3. 提出的最小侵入方案（**仅设计，未实现、未测试**）

整体 fold 进 Worker，需同时改动以下四处，缺一不可（子代理明确「不能只换 index 的 fold 调用就部署」）：

1. 新增 `lib/ingest-worker.js`：显式 `dbPath`/roots，worker 内独占 writer 连接，调用原 fold 顺序不变，只回传小型 progress/result（不搬 events）。
2. 新增 `lib/ingest-runner.js`：持久 worker、requestId/generation、singleflight、error/exit/timeout 清 pending、超时 terminate 后重建。
3. `index.js`：apply/bootstrap/runIngest/lifecycle 接线，保留首次/45s/manual refresh 的 await 语义（并保留本轮 R4 新加的 `disposed`/`activationGeneration`）。
4. **读可见性 barrier**：`rpc.js` 的 query/status 在活动 ingest 时 await 当前 `inFlight`（仅 usage 等待，其它 host RPC 不受影响）—— 因为整体 fold 进 worker 后，events COMMIT 与 daily rebuild 之间会出现**旧同步路径不存在的可见窗口**。
5. `db.js` 导出 `invalidateMaxDailyDayCache`（deployed `:483` 未导出 / 源码 `:476`）：worker 内清缓存**不影响**宿主线程，宿主必须在收到完成/失败后自己清，否则 `MAX(day)` 缓存有 45s TTL 的陈旧风险。

**明确不推荐**：仅把 zstd 异步化（不覆盖 JSON/SQLite）；把 parser 切开 yield（大 JSON/单条 SQL 切不开）；增量解析（会改 header/chunk/rewrite/torn 语义，侵入过大）。

**收益边界**：整体 worker **不降低总 CPU/IO**，也不改善 RPC 自身的同步查询，**不宜声称是完整 GUI 修复**。

## 4. 必须先做的最小验证（未做）

同一合成 fixture 下，对**独立内存 DB** 分别跑「原 fold」与「worker fold」，逐项对拍 `return` / `events` / `daily` / `sync_state` 全等；覆盖：初始、重复、append、truncate/torn、header 切换/chunk 优先、坏 JSON。不得使用真实 roots / 真实 DB / 真实 `resolveDbPath`。

> 对拍只能证明**算法搬移等价**，**不能**证明生产生命周期、锁争用或实时延迟 —— 后者需要冷面重启 + 跨自然 tick 的低频只读 probe。
