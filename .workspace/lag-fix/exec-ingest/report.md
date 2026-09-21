# 修订执行复核一体档：Ingest-v1（B0 + B1，B2 只留开关）

- 日期：2026-09-21
- 档位：**修订执行复核一体**（按已完成的执行前审计逐条落地，不重新拆解、不扩范围）
- 工作目录（本档独占）：`.workspace/lag-fix/exec-ingest/`
- 契约：`.workspace/lag-fix/exec-audit/ingest/audit.md`（690 行）、`exec-audit/BATCH-PLAN.md` §3bis、`research-v2/ingest-gate/verdict.md`、`research-v2/ingest-equiv/audit.md`（U1–U6）
- **本档未写工作区之外**：`~/.dsh/profiles/node_modules/@local/dsh-usage/` 只读；
  **deployed 写入由主 agent 执行**（脚本已就绪，见 §7）。未 commit、未重启、未开浏览器、未启用 timer、未新增任何周期性 ingest 触发、未碰 `ingest-cc.js`。

---

## 0. 结论摘要（先读这一节）

### 0.1 自裁决：**PASS（可进入 deployed 写入）**

| 交付单元 | 状态 | 关键证据 |
|---|---|---|
| **B0 `db.js`**（U-IG3 修法 A+B、`invalidateMaxDailyDayCache` 导出、`busy_timeout=5000`、`temp_store=2` 加固） | **完成** | A1–A5 全绿（§3.5）；真实 sessions root 冷 fold `failed=0`（UNIQUE=0，原为 11） |
| **B1 worker + runner + 接线** | **完成** | E1 等价 11 面对拍 × 3 时区 × 3 个 lib = **9 次全 byte-identical**（§3.1）；G1 替代验证 **11.07 / 11.86 ms < 100 ms**（§3.2） |
| **B1 G2 单飞** | **完成** | runner 级：10 并发共享 **1 个 promise 对象**、worker 侧 `start`=1；rpc 级：经真实 `/usage/refresh` handler 的 10 并发 → fold=**1**（§3.3） |
| **B1 G4 生命周期** | **完成** | 卸载后线程数回到基线；崩溃/停滞 → 重建且成功，**不重试**（§3.4） |
| **B2 timer 启用** | **未启用（按铁律）** | `INGEST_TIMER_ENABLED = false`；修法形状已用真 cordis 4.0.2 验证（§3.6）；**必须等 G1 在生产实测通过后由主 agent 单独开** |
| **可验证候选 + 补丁脚本** | **完成** | `apply-Ingest-v1.mjs` 对**真实 deployed 目录** dry-run：5 个文件全部锚点唯一命中、声明/导入/语法校验全 `[ok]`，且 deployed 树 md5 未变（§7） |

**停止条件检查**：等价对拍**通过**；singleflight 已证明；G1 替代验证 **11.86 ms ≪ 100 ms** ⇒
**未触发"阻止恢复 45s 周期"的铁律**。但 timer 仍**不得**在本批启用（B2 是独立的一次开关翻转 + 重启）。

### 0.2 三条对主 agent 最重要的事

1. **`apply-Ingest-v1.mjs` 默认 dry-run，`--apply` 才写**，锚点不唯一即 fail-closed、不写任何文件；
   对 deployed 的 dry-run 已全部 `[ok]`（§7.1 有原样输出）。
2. **`db.js` 必须与 B1 同批写入**：`ingest-runner.js` 硬依赖 `db.js` 的
   `invalidateMaxDailyDayCache` 导出，未打 `db.js` 时 runner **加载即抛**
   `SyntaxError: does not provide an export named …`（实测，§5.1）。这正是 BATCH-PLAN 的"同一写入者"要求。
3. **两处必须由主 agent 裁决的偏差**（我按"行为保持"实现并标注，未自行扩范围）：
   - 审计草图的 `waitIdle: () => runner.inFlight ?? Promise.resolve()` 会让**手动 `/usage/refresh` 变成 no-op**
     （timer 关闭时它是唯一可用的刷新手段）⇒ 我实现为 `() => runner.run()`（"加入在飞 pass，否则启动一个"），
     **语义等价于 `ingest`，因此单飞必须由 runner 提供**（已证明）。见 §6.1。
   - 修法 A 的区间上界我用**本地日历**（下个本地午夜）而非 `+ 86_400_000`：DST 春季跳变日上后者会落到
     **次日 01:00**，使 DELETE 与 INSERT 同时覆盖"次日的一部分"，从而可能写入**被截断的错误聚合**。
     非 DST 窗口下与旧表达式**逐字节相同**（已实测）。见 §6.2。

---

## 1. 交付物清单

```
.workspace/lag-fix/exec-ingest/
├── apply-Ingest-v1.mjs              ← 补丁脚本（dry-run 默认 / --apply / 锚点唯一 / pre-image / 校验）
├── candidates/                      ← 5 个候选件（= 脚本对 pristine deployed 副本的输出，已证明未漂移）
│   ├── db.js            (d187d44932b3, 841 行)
│   ├── index.js         (303cab977557, 371 行)
│   ├── rpc.js           (fa2654ab8e05, 240 行)
│   ├── ingest-worker.js (9dc04f44ec98, 181 行)  ← 新增
│   └── ingest-runner.js (23c88e510906, 316 行)  ← 新增
├── tests/                           ← 全部自证（见 §3），tests/run-all.sh 一键
│   ├── run-all.sh / run-equiv-suite.sh / verify-candidates.sh
│   ├── run-worker-equiv.mjs         E1 等价对拍
│   ├── run-g1-latency.mjs           G1（沙箱替代）
│   ├── run-g2-singleflight.mjs      G2
│   ├── run-g4-dispose.mjs           G4 + 崩溃/停滞生命周期
│   ├── run-ig3-acceptance.mjs       A1–A5（含真实 root 冷 fold）
│   ├── run-wiring-assertions.mjs    接线静态 + 动态断言（W1–W8）
│   ├── run-counterfactuals.mjs      反向对照 CF-A…CF-D
│   ├── run-timer-shape.mjs          B2 修法形状（真 cordis）
│   ├── lib/harness.mjs, workers/{tap,faulty}-worker.mjs
├── tools/                           ← 沙箱机制探针（含两个把我自己坑到的仪器陷阱）
├── out/                             ← **全部原始 JSON + stdout**（本报告引用的每个数字都在这里）
├── stage/                           ← 隔离暂存 lib（lib-cand / lib-origdb / lib-cand-ccfix / lib-orig）
└── patch-runs / pre-image           ← 只在 --apply 后出现
```

一键复现：

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-ingest
./tests/run-all.sh                 # 除 G1 外全部（≈3 min）；结果 in out/*.json + out/run-all.log
./tests/run-all.sh --with-g1       # 含 G1（≈3 min，需机器相对安静）
# 2026-09-21 实测：INGEST-V1 SUITE EXIT: 0
```

> `scratch/`（临时库与变体 lib）与 `patch-runs/`（`--apply` 时才生成）合计 130+ MB，属**可再生**产物，
> 交付前已清空数据目录（保留 `scratch/node_modules` 依赖软链）；清理后重跑 wiring / counterfactuals / E1 仍全 PASS。

---

## 2. 逐单元实施（锚点级）

### 2.1 B0 — `db.js`（单一写入者，5 处锚点）

| 锚点 | 内容 | 依据 |
|---|---|---|
| **D1** | `PRAGMA journal_mode = WAL` 之后插入 `PRAGMA busy_timeout = 5000` 与 `PRAGMA temp_store = 2` | U-IG1.5 + §3.4 加固（明确标注"加固，不是 U-IG3 修复"） |
| **D2** | `rebuildDailyForDays` 的 `lo/hiExclusive` 计算块 → 加 `lastDay`、**日历锚定的** `hiExclusive`、`spanDays` 枚举 | U-IG3 修法 A（区间对齐）+ DST 修正（§6.2） |
| **D3** | 删除函数顶部 `const placeholders = days.map(…)` | 见 §5.2：不删会与 `spanDays` 冲突并触发 TDZ |
| **D3b** | `DELETE … .run(...days)` → 就地声明 `placeholders`（由 `spanDays` 构造）并 `.run(...spanDays)` | U-IG3 修法 A 的实际生效点 |
| **D4** | INSERT 追加 `ON CONFLICT(day, data_source, model, project) DO UPDATE SET …` | U-IG3 修法 B（保险） |
| **D5** | `function invalidateMaxDailyDayCache()` → `export function …` | U-IG1.3（**函数体一字未改**） |

### 2.2 B1 — 新增 `lib/ingest-worker.js`（181 行）

- 协议：`{type:'start', id, dbPath, dshRoot?, ccRoot?}` → `progress` / `done` / `failed`，**只发 JSON 可序列化值**（`failedFiles[].file` 先 `String()`）。
- 硬约束（注释 + 测试双重保证）：① **路径一律由宿主传入**，worker 内**绝不自己解析路径**（脚本内置静态禁令检查：该标识符出现次数必须为 0）；② 不建 schema（宿主已建）；③ 一个 worker 生命周期内复用同一条连接；④ 不搬 `DatabaseSync`。
- 折法**与 `index.js` 原实现完全同序同参**：`foldDshSource(conn, root)` → `foldCcSource(conn, root)`；progress 节流 `≥200ms 或 +100 事件`，并在**相位边界各发一条**（让宿主停滞看门狗拿到相位心跳）。
- `failedFiles`/`scanned`/`newEvents` 一律 `Number()/String()` 归一化后再过线程边界。

### 2.3 B1 — 新增 `lib/ingest-runner.js`（316 行）

| 设计点 | 实现 |
|---|---|
| 签名 | `createIngestRunner({dbPath, log, workerUrl?, dshRoot?, ccRoot?, stallMs=120000, hardTimeoutMs=900000, watchdogTickMs=5000, onProgress, invalidate?})` → `{run(), dispose(), stats()}` |
| **单飞** | `run(){ if (inFlight !== null) return inFlight; const p = start().finally(…); inFlight = p; return p; }` ⇒ 并发调用者拿到**同一个 promise 对象** |
| **停滞看门狗** | 距上条 `progress > stallMs`（默认 120 s）→ `terminate()` + 丢弃 worker，本次 `run()` 以 `{ok:false, reason:'stalled'}` 结束，**绝不重试**；`hardTimeoutMs` 仅作最后保险（**不用总时长超时**） |
| id / 代次 | 自增 id + `pending.worker` 身份比对：陈旧 worker 的消息一律丢弃；`settle()` 以 `entry.settled` 保证只落定一次 |
| 错误/退出/超时 | `error` / `exit` / watchdog / hard timeout / `dispose` **五条路径都会清 pending 并落定**，`run()` **永不 reject** |
| **宿主清理点** | `start()` 的 `finally` 调 `invalidateHostCache()` ⇒ 成功、失败、停滞、超时、dispose **全部覆盖**（worker 内的 invalidate 不能跨线程，见 ingest-equiv §3.3） |
| dispose | 落定在飞请求 → `terminate()` → 等 `inFlight` 收尾；之后 `run()` 返回 `{ok:false, reason:'disposed'}` 且不再起线程 |
| 可观测 | `stats()` 返回 runs/ok/failed/stalls/timeouts/workerSpawns/invalidations/workerAlive/workerThreadId/pendingId/inFlight/disposed（G2/G4 验收与主 agent 复测用） |

> 说明：这里唯一"新增的周期性定时器"是**在飞 pass 的停滞看门狗**（`setTimeout` 链，`unref()`，settle 即清）。
> 它**不触发 ingest**，只在一次 pass 进行中做存活判定；`INGEST_TIMER_ENABLED` 关闭时它只在实际跑 pass 时存在。
> 这满足"不得新增任何周期性 ingest 触发"。

### 2.4 B1 — `index.js` 接线（9 处锚点）

- 新增常量：`INGEST_VIA_WORKER = true`（回滚开关，见 §6.3）、**`INGEST_TIMER_ENABLED = false`**（带 G1–G5 说明与开启方法）。
- `runIngest` 拆成 `runIngestSync`（原同步体**逐字保留**，回滚点）+ `runIngestWorker`（`await runner.run()`），
  由 `runIngest` 按 `INGEST_VIA_WORKER && runner !== null` 分派；**dispose / db===null 守卫与 await 语义原样保留**
  （首扫 `:207 await runIngest()`、45s tick、`/usage/refresh` 三处都是 await 同一个 promise）。
- runner **在 `dbPath` 赋值之后**创建（worker 要靠它自开连接）；`onProgress` 回填 `ingestSummary`；
  `lastIngest`/`firstScanAt` 语义不变；`done` 到达后用**落定结果**覆盖计数（progress 可能被节流掉最后一条）。
- timer 块：**整块替换**为 `if (INGEST_TIMER_ENABLED) { ctx.inject(["timer"], timerCtx => …) }`，
  **`typeof ctx.setInterval` 探测彻底删除**（探测本身抛错，旧 `ctx.effect` 兜底分支因此不可达）。
- dispose：`disposeTimer = null` + `void runner?.dispose()` + `runner = null`。
- `registerUsageRpc` 增加 `waitIdle: () => (runner === null ? runIngest() : runner.run())`。

### 2.5 B1 — `rpc.js`（**仅** refresh 去重，2 处锚点）

- `const { ingest, statusProvider, waitIdle } = deps;`
- `refresh` 分支：`if (typeof waitIdle === "function") await waitIdle(); else if (typeof ingest === "function") await ingest();`
- **`status` 与 7 个数据端点一行未改**；静态断言：`waitIdle` 的所有出现**必须全部位于 `if (endpoint === "status")` 之前**（W3，实测 afterStatus=0）。
- deployed 的 `ctx.connection.rpc.handle("/usage", handle, {authority:"loopback"})`（`:225`）**一字未动**——这正是"严禁整文件 cp source→deployed"的原因，脚本走锚点。

### 2.6 B2 — 未启用

`INGEST_TIMER_ENABLED = false`；修法形状已用**真 cordis 4.0.2 + cordis-plugin-timer 1.1.4** 验证（§3.6）。
启用方式写在常量注释里：**改一个 `false` → `true` + 重启**，无需其它改动。

---

## 3. 真跑结果（全部可在 `out/` 复核）

### 3.1 E1 等价对拍（worker 路径 vs 原 fold 路径）— **PASS**

对拍面 11 个：`return.{dsh,cc}First / Second / Append / Clean`（8）+ `usage_events` + `usage_daily` + `sync_state`（含 `last_offset`），
最终态一律由**写者关闭后的全新只读连接**读取，两侧 fixture 根路径归一化为 `<ROOT>`。

| 运行 | TZ | 结果 |
|---|---|---|
| `stage/lib-cand`（全部候选件） | UTC / Asia-Shanghai / America-New_York | **PASS — 11 面 byte-identical** |
| `stage/lib-origdb`（**未打 U-IG3 补丁的 db.js**，仅加导出） | 同上 3 时区 | **PASS — 11 面 byte-identical** |
| `stage/lib-cand-ccfix`（+ U-CC1 已修 `ingest-cc.js`） | 同上 3 时区 | **PASS — 11 面 byte-identical** |

- 夹具复用 `research-v2/ingest-equiv/harness/fixture.mjs`（多 frame zstd / header 切换 / chunk 优先 / 排除类型 / 坏 JSON / 撕裂尾帧 / CC 子代理冲突 / 种子游标 / 空根目录），
  并**扩展了一个真实 append 相位**（追加同一条 CC 记录后重跑），用于把 `last_offset` 推进纳入对拍。
- 落地几何：`events=6 / daily=5 / sync=5`；ccfix 下追加相位 `newEvents=1` → `events=7`，两侧一致。
- 非空断言（防"空表也算全等"）：`events>0 && sync>0` 已断言。
- **CC 游标既有缺陷的诚实记录**：未修 `ingest-cc.js` 时，追加相位的两侧**同样**是 `newEvents=0 / failed=1`（`1 unparsable JSON lines`）——
  这是审计 C3/C4 的 `last_offset = size+1` 漂移，**两条路径一致**（对拍要证的正是"搬移不改变行为"）；打了 U-CC1 后两侧都变成 `newEvents=1 / failed=0`。
- 原始 JSON：`out/equiv-lib-cand-*.json`、`out/equiv-lib-origdb-*.json`、`out/equiv-lib-cand-ccfix-*.json`（9 个）。

### 3.2 G1（沙箱替代）事件循环延迟 — **PASS，且余量极大**

工作负载 = **真实** `~/.dsh/sessions`（880–888 文件）+ `~/.claude/projects`（388 文件），冷 fold 到 scratch 库；两种路径跑**同一次完整 pass**。

| 轮 | 路径 | 墙钟 | `monitorEventLoopDelay` max | 10ms 心跳最大间隔 |
|---|---|---|---|---|
| 1 | **worker** | 30 212 ms | **11.07 ms** | 1 ms |
| 1 | 同步（对照） | 31 440 ms | **31 188.84 ms** | 31 157 ms |
| 2 | **worker** | 31 744 ms | **11.86 ms** | 2 ms |
| 2 | 同步（对照） | 30 096 ms | **29 829.89 ms** | 29 809 ms |

- **G1 判据（< 100 ms）在 worker 路径上以 ~8× 余量成立**；两套独立仪器（histogram + 心跳）互相印证。
- worker 侧确实干了活：每轮 `dsh scanned=880~888 new≈55k failed=0`、`cc scanned=388 new=22700`。
- 比值 worker/sync = **0.0004**。
- 原始：`out/g1-latency.json`、`out/g1.stdout`。

**⚠ 这一节含一个必须转告的仪器陷阱（我实测并复现了它）**：
`monitorEventLoopDelay` 在 `reset()` 之后**丢弃第一个样本**。若 `reset()` 紧邻一个长同步阻塞，读数会**严重偏低**：

| 纪律 | 3 000 ms 阻塞 | 20 000 ms 阻塞 |
|---|---|---|
| `enable → settle → reset → block`（**错**） | 报 **10.31 ms** | 报 **10.16 ms** |
| `enable → settle → block`（对） | 报 **3 003 ms** | 报 **20 015 ms** |

复现：`node tools/probe-eld-reset.mjs`。**任何用 `monitorEventLoopDelay` 测"主线程阻塞"的档都必须避开这个坑**；
本档的 G1 探针已改为不二次 `reset()`（注释里写明原因），并且**额外用 10 ms 心跳**做独立交叉验证。

### 3.3 G2 单飞 — **PASS（两层证据）**

runner 级（`tests/run-g2-singleflight.mjs`）：

```
G2a 10 个并发 run() → 1 个 distinct promise 对象        PASS
G2b 10 个调用者拿到同一个 result 对象且 ok=true        PASS
G2c runs=1 workerSpawns=1                              PASS
G2d worker 侧 tap 日志：start 计数 = 1                 PASS   ← 独立于宿主侧的计数
G2e 在飞期间再来 2 个调用者 → 仍然只多 1 个 start       PASS
G2f 落定后再调用 → 新 pass（单飞槽已释放，不是死锁）    PASS
```

rpc 级（`tests/run-wiring-assertions.mjs` W5a/W6，**经真实 `rpc.js` handler**）：
`10 × handler("refresh")` → 10 个响应全 `ok:true`、worker 侧 `start = 1`、runner `runs = 1`。
另测：无 `waitIdle` 时 refresh 仍走 `ingest()`（向后兼容）；`status` 与数据端点**都不等待**（W7/W8，实测 0 ms）。

### 3.4 G4 卸载无残留 worker + 生命周期 — **PASS**

线程计数用 `/proc/self/task`（外部客观量；`process._getActiveHandles()` 实测**不可用**——terminate 后句柄项仍在）。

```
G4a 一次 pass 恰好 1 条线程，threadId=1                    PASS
G4b dispose() 后线程数回到基线（7）                        PASS
G4c dispose 后 run() = {ok:false, reason:'disposed'} 且不起线程  PASS
G4d worker 崩溃(exit 3) → reason='worker-exit'；下一次 run() 重建并成功  PASS
G4e 停滞(无 progress) → 401ms 后 reason='stalled'、stalls=1、重建后成功、线程回基线  PASS
G4f 看门狗按"进展"而非总时长判定（progressing pass 不被误杀）  PASS
```

### 3.5 U-IG3 验收 A1–A5 — **PASS**

构造：`usage_events` 在 08-19/20/21/22/24/25 有行，`usage_daily` 预先为**全部**这些日持有行（模拟"上一轮/别的文件写过"），
调用方只传**非连续**的 4 天（08-19/20/24/25）——即部署版必现 UNIQUE 的形态。

| 断言 | 结果 |
|---|---|
| **A1a** 非连续 rebuild 不抛 | PASS（部署版：抛 `UNIQUE constraint failed: usage_daily.day, usage_daily.data_source, usage_daily.model, usage_daily.project`） |
| **A2a** daily↔events 收敛（**纯 JS 聚合**，非 SQL GROUP BY） | PASS：`keys expected=12 actual=12 mismatched=0 orphan=0` |
| **A2b** 无陈旧残留 | PASS：0 行仍带预置的 999 标记 |
| **A2c** 与"全量重算"逐行一致 | PASS（同一连接内顺序比较，避开 WAL 拷贝陷阱，见 §5.3） |
| **A5** 同一 day 连跑 3 遍 | PASS：3 次结果完全一致、无错 |
| **A4** `产出 day 集合 ⊆ DELETE day 集合`（插桩变体实测） | PASS：`deleted=[08-19…08-25 共 7 天]`、`produced=[6 天]`、`produced∖deleted=[]` |
| **A3** 8 个端点"重建前/后"同值 | PASS：`events=12`、重建后 `daily rows=12`、8 个端点 **byte-identical** |
| **A1b**（真实 root）冷 fold `UNIQUE=0` | PASS：`scanned=888 new=55357 failed=0 (UNIQUE=0, open=0, other=0) in 44875ms` |

时区覆盖：Asia/Shanghai、UTC、America/New_York 三份 `out/ig3-acceptance-*.json` 全绿；真实 root 一份 `out/ig3-acceptance-Asia-Shanghai-real.json`。

### 3.6 B2 修法形状（真 cordis，timer 仍关闭）— **PASS**

`out/timer-fixshape-audit-probe.txt`（**重跑审计既有探针** `probe-r5i-fix-shape.mjs`，未改一行为）：
`installed=true`、`hasSetIntervalInInject=function`、3 s 同步占用后 2.5 s 内**触发 9 次** ⇒ 真 interval 且不被回收。

`tests/run-timer-shape.mjs`（把**我写进 index.js 的那段形状**放进真 cordis）：

```
B2a 开关 OFF：inject 调用 0 次、未安装、未触发、无异常             PASS
B2b 开关 ON ：1.5s 同步占用后仍安装成功、有 setInterval           PASS
B2c 开关 ON ：250ms interval 在 ~2s 内触发 13 次                  PASS
B2d 旧 typeof ctx.setInterval 探测确实抛 "cannot get property \"timer\" without inject"  PASS
```

### 3.7 反向对照（"这些断言有没有牙齿"）— **PASS**

| 对照 | 预测 | 实测 |
|---|---|---|
| **CF-A** 去掉 U-IG3 修复（部署版 db.js） | 必现 UNIQUE | **必现**，且是生产原文错误 |
| **CF-B** 只上修法 B（upsert、不做区间对齐） | 不抛，但 `产出 ⊄ DELETE` | **不抛**；插桩实测 `deleted=[08-19,20,24,25]`、`produced=[6 天]`、违反项 = **`["2026-08-21","2026-08-22"]`**（正是审计的间隙日）⇒ upsert 只是**掩盖**缺陷 |
| **CF-C** 去掉单飞 | >1 次 fold | worker 侧 **start=10**（10 个并发各跑一份） |
| **CF-D** 候选件过同样三条断言 | 全过 | **全过** |

原始：`out/counterfactuals.json`。

### 3.8 候选件来源可证（`tests/verify-candidates.sh`）

对 **pristine deployed 副本**跑 `apply-Ingest-v1.mjs --apply`，逐文件 `cmp`：

```
SAME  db.js / index.js / rpc.js / ingest-worker.js / ingest-runner.js
candidates are provably the script's output
```

⇒ `candidates/` 与脚本产物**不可能漂移**（`db.js`=d187d44932b3、`index.js`=303cab977557、`rpc.js`=fa2654ab8e05、
`ingest-worker.js`=9dc04f44ec98、`ingest-runner.js`=23c88e510906）。

---

## 4. G1–G5：沙箱已验 / 必须重启后验的清单

| 闸门 | 沙箱内状态 | 依据 | 重启后**必须**由主 agent 复测的部分 |
|---|---|---|---|
| **G1** 一次 pass 期间宿主最大延迟 < 100 ms | **已验（强）**：11.07 / 11.86 ms，对照同步版 31.2 s / 29.8 s；真实语料 880+388 文件 | §3.2 | 真实宿主进程内的 `/usage` 路径（含 `webServer`/RPC 同进程竞争）；本机非独占，绝对数值只作量级 |
| **G2** 并发 10 次 refresh 只触发 1 次 fold | **已验**：runner 级 1 promise / 1 start；**rpc handler 级 10 并发 → 1 fold** | §3.3 | 真实 HTTP 层的并发 refresh（含客户端 60 s 轮询叠加） |
| **G3** `status` 在 ingest 期间不等待 | **已验（单测）**：`status`/数据端点均 0 ms 返回、`waitIdle` 调用 0 次 | §3.3 W7/W8 | 活体：pass 进行中对 `/usage/status` 与 `/usage/summary` 计时，确认不随 fold 时长增长 |
| **G4** 卸载后无残留 worker | **已验**：`dispose → terminate`，线程回基线；崩溃/停滞重建 | §3.4 | 真实插件 reload/unload 路径（`ctx.effect` teardown 在 cordis 内的实际调用时机） |
| **G5** `ingest-equiv/run-suite.sh` 全绿 | **未跑原套件**（它硬编码指向 deployed 模块，不经候选件）；**已跑等价替代**：11 面 × 3 时区 × 3 lib 全 byte-identical，并**扩展了 append 相位** | §3.1 | 部署后重跑 `research-v2/ingest-equiv/run-suite.sh`（对 deployed 生效后即为端到端回归）；另跑 `research-v2/cc-cursor/repro-cc-cursor.mjs --lib <deployed>` 验 CC `LOSS→NO_LOSS` |
| **额外** | `A1b` 真实 sessions root 冷 fold `failed=0` | §3.5 | 真实库（生产 `usage.db`）上不报 UNIQUE |
| **B2** | 开关关闭 + 形状已验证 | §3.6 | **G1 生产实测通过后**再翻开关（独立一次改动 + 重启） |

**明确不在沙箱内验证的**：真实宿主启动路径（`apply()` 会 `resolveDbPath()` 并打开**生产库**，本档**故意不跑** `apply()`，以免写生产数据/触发真实 ingest）；
两连接下的生产查询耗时回归；45 s 周期开启后的绝对卡顿量级（本机非独占，按 BATCH-PLAN §5 一律不可采信绝对值）。

---

## 5. 失败 / invalid / 踩到的坑（全部已修，记录以免他档重复踩）

### 5.1 `ingest-runner.js` 硬依赖 `db.js` 的导出（**部署顺序约束**）
用**未打补丁的 db.js** + 新 runner/worker 跑等价对拍时，加载即抛
`SyntaxError: The requested module './db.js' does not provide an export named 'invalidateMaxDailyDayCache'`。
⇒ **`db.js` 与两个新文件必须同批写入**（BATCH-PLAN 的"同一写入者"）；`apply-Ingest-v1.mjs` 已把这条写成
跨文件导入断言（`import:ingest-runner.js←./db.js:invalidateMaxDailyDayCache`）。

### 5.2 修法 A 的第一个版本**是错的**（我在自检里抓到并修正）
审计草图的形状里，`DELETE` 的 `placeholders` 仍在函数顶部由 `days` 构造、且 `.run(...days)` 未改：
- 直接照抄会得到 **TDZ 报错**（`spanDays` 在下面才声明）；
- 忘记改 `.run(...days)` 会让绑定参数与小括号数量不匹配（SQLite 直接报错）。
本档最终把 `placeholders` 的声明**移到 DELETE 之前**并绑定 `spanDays`（D3 删除旧声明 + D3b 就地声明/绑定），
并用 `node --check` + **真跑 A1–A5** 双验证（`--check` 抓不到 TDZ，只有真跑能抓到 ⇒ 这也是"必须真跑"的价值）。

### 5.3 沙箱里两个**测量/构造**陷阱（与产品无关，但会给出**假结论**）
1. **WAL 拷贝陷阱**：`cpSync(usage.db, copy.db)` 只复制主文件，WAL 中的数据不在其中 ⇒ 副本"有 schema 没数据"，
   查询直接 `no such table`。修法：拷贝前 `PRAGMA wal_checkpoint(TRUNCATE)`，或改在同一连接上顺序比较（A2c 采用后者）。
2. **ESM 里 `spanDays ?? days` 仍会抛**：未声明的标识符在 ESM 中不是 `undefined` 而是 `ReferenceError`
   ⇒ 插桩代码必须写 `typeof spanDays === "undefined" ? days : spanDays`。

### 5.4 沙箱自身的 temp-store 约束（审计已实测；本档如何规避）
本档候选 `db.js` 含 `PRAGMA temp_store = 2`，因此 `rebuildDailyForDays` 的多列 GROUP BY 与 7 个数据端点
在沙箱内**都正常执行**（A2/A3 因此非空、有效）。未打该 pragma 的变体（`lib-origdb`）在本档小夹具上同样能跑通——
说明该 pragma 在此环境**不是**必需，我把它保留为**加固**（审计建议）而非修复，并**没有**把沙箱的 temp-store 行为当成产品结论。

---

## 6. 与审计的偏差（逐条标注，供主 agent 裁决）

### 6.1 `waitIdle` 的语义（**建议主 agent 确认**）
- 审计 U-IG1.4/§U-IG1.6 写：`waitIdle: () => runner.inFlight ?? Promise.resolve()`。
- **问题**：`runner.inFlight` 是 runner 私有字段（我实现为闭包变量，无此公开字段）；即便暴露，"空闲时返回
  `Promise.resolve()`"意味着**空闲时的手动 `/usage/refresh` 不会触发任何 ingest**——在 timer 关闭的当前状态，
  它是唯一可用的刷新手段，会变成静默 no-op。
- **本档实现**：`waitIdle: () => (runner === null ? runIngest() : runner.run())`，即"加入在飞 pass，否则启动一个"，
  与 `ingest` 等价、**行为保持**；`rpc.js` 侧完全按审计形状改（先 `waitIdle`、无则回落 `ingest`）。
- 由于 `waitIdle` 与 `ingest` 同义，**G2 的去重实际由 runner 的单飞提供**——这正是审计"去重不是可选项"的真实落点。

### 6.2 修法 A 的区间上界（DST）
- 审计原文："INSERT 部分一字不改"，上界沿用 `max(localDayMs)+86_400_000`。
- **问题**：DST 春季跳变日（当地 23 h）上该表达式会落到**次日 01:00**，于是 DELETE 与 INSERT **同时**覆盖次日的前 1 小时；
  若只做区间对齐（修法 A），就会把次日**截断的部分聚合**写进 `usage_daily`——从"抛错"变成"静默错值"，比现状更糟。
- **本档实现**：上界改为**下个本地午夜**（日历锚定）。非 DST 窗口与旧表达式**逐字节相同**，
  且不改变 SELECT 的索引友好性；`hiExclusive` 与 `spanDays` 由同一循环保证一致。
- 影响面：当前部署时区（Asia/Shanghai）无 DST ⇒ **纯 latent**；成本极低，故顺手修掉并显式标注。

### 6.3 保留 `runIngestSync` 回滚点（审计 U-IG1.6 内部有张力）
- 审计同时写了"removed：`foldDshSource/foldCcSource` 的 import"与"**强烈建议**保留 `runIngestSync` fallback"。
  两者不能同时成立（保留 fallback 必须保留 import）。
- **本档取后者**（回滚价值更高：一个常量即可退回现状，不需重新部署任何文件），并在报告与代码注释里显式标注。

### 6.4 其它小幅增补（均为一句话可回退）
| 增补 | 理由 |
|---|---|
| `stats()` 只读内省方法 | G2/G4 验收与主 agent 复测需要可观测；无副作用 |
| `invalidate` 可注入 seam（默认真函数） | 审计验收②要求"宿主 invalidate 计数 +1"可插桩 |
| worker 在**每个相位边界发一条 progress** | 让停滞看门狗拿到相位心跳，避免"相位切换期"被误判停滞 |
| 脚本 `--replace-new` / `--root` / `--pre-image` | 新文件冲突时 fail-closed，但保留主 agent 显式覆盖的入口 |
| `busy_timeout` 也写在 `openUsageDb` → worker 连接同样生效 | 审计 U-IG1.5 风险栏建议"worker 侧也应设" |

### 6.5 worker 复用了 `openUsageDb`，因此**绕过不掉**它内部的 `ensureSchema`
- 审计 U-IG1.1 硬约束②写"不调 `ensureSchema`（宿主已建）"。worker **确实没有自己调用它**，
  但审计同时要求"复用 `openUsageDb`"，而 deployed 的 `openUsageDb` **内部**在 `:94` 就调了 `ensureSchema`
  ⇒ worker 每次开连接都会跑一次 `CREATE TABLE IF NOT EXISTS …` + `PRAGMA user_version = 1`（幂等，但 `user_version` 是一次写）。
- 这**不是**新增风险，反而**加强了 `busy_timeout` 的必要性**：worker 开连接时的这次写可能撞上宿主正在进行的写事务，
  `busy_timeout = 0`（现状）会当场硬失败。若主 agent 更希望 worker 完全不写，可另开单元（把 pragma 部分拆出一个只读 open 函数），
  本档**未扩范围**去做这件事。

---

## 7. deployed 写入指南（**由主 agent 执行**）

### 7.1 先跑 dry-run（我已对真实 deployed 目录跑过，原样输出）

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-ingest
node apply-Ingest-v1.mjs          # dry-run（默认）
```
实测输出（`out/apply-Ingest-v1-deployed-dryrun.txt`）：

```
mode  : DRY-RUN (validates only; pass --apply to write)
root  : /home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-usage/lib
── db.js  [patch]  sha(before)=77ab2e8ec489024f sha(after)=ecb86c2357314c2c
── index.js  [patch]  sha(before)=743469a5aaa22e0e sha(after)=ce85f4bdf2bfb0d9
── rpc.js  [patch]  sha(before)=3c91ac22f4863b0e sha(after)=6a3e774181d262de
── ingest-worker.js  [create]  sha(before)=— sha(after)=15ac65f7d6c009d3
── ingest-runner.js  [create]  sha(before)=— sha(after)=92acb9bc014fa110
RESULT: VALIDATED (dry-run). Re-run with --apply to write.
```
（每个锚点的 `[ok] … anchor unique`、声明/导入/语法校验明细见该文件；dry-run **不写任何文件**，
实测 deployed 三个文件 md5 与目录清单**未变**。）

### 7.2 写入

```bash
node apply-Ingest-v1.mjs --apply
# 产物：patch-runs/pre-image/{db.js,index.js,rpc.js}（原始 pre-image）
#       patch-runs/pre-image/{ingest-worker.js.ABSENT,ingest-runner.js.ABSENT}
#       patch-runs/manifest.json（含 sha + 每锚点命中数）
# 已存在同内容 pre-image 时不会覆盖（另存 <file>.<ts>.pre），保证"最初原件"永不丢失
```
脚本在写之前就完成了全部校验（锚点唯一 + 标识符声明 + 跨文件导入 + 语法），**任一失败则一个文件都不写**；
写入后 `node --check` 逐文件复核（`.mjs` 副本做权威 ESM 解析）。

### 7.3 写入后建议的验收顺序（主 agent）

1. `md5sum` 与 §3.8 的 5 个值比对（期望：`d187d44932b3` / `303cab977557` / `fa2654ab8e05` / `9dc04f44ec98` / `23c88e510906`）。
2. 冷面合并一次重启（B0+B1+B3 同批；**U-IG2 不随本批启用**）。
3. 重启后：`/usage/refresh` 一次 → 看 `lastIngest` 更新、`usage_daily` 的 `MAX(day)` 前进、`failedDsh` 不再出现 UNIQUE。
4. G1 活体：重启后在一次 pass 期间采宿主事件循环延迟（< 100 ms），**通过后**才把 `INGEST_TIMER_ENABLED` 翻成 `true` 并再重启一次。
5. G3 活体 + G4 活体（reload 插件后 `/proc/<host>/task` 线程数回基线）。
6. `research-v2/ingest-equiv/run-suite.sh` 全绿（G5）+ CC 的 `LOSS→NO_LOSS`。

### 7.4 回滚

- 补丁级：用 `patch-runs/pre-image/` 覆盖回去即可（`ingest-worker.js`/`ingest-runner.js` 为纯新增，删除即回滚）。
- 运行级（不重新部署）：把 `INGEST_VIA_WORKER` 改回 `false` → 回到原同步 fold（`runIngestSync` 逐字保留）。
- 两者都不需要碰 `ingest-cc.js`（本档未触及）。

---

## 8. 同档自复核

**结论：PASS。**

| 复核项 | 结果 |
|---|---|
| 是否逐条落地审计单元（U-IG1.1/1.2/1.3/1.4/1.5/1.6 + U-IG3 A/B + 加固） | 是（§2；偏差仅 §6 三条且已标注） |
| 是否有未声明的范围扩张 | 无；`ingest-cc.js` 未碰、timer 未启用、无新增周期性 ingest 触发、未 commit/重启 |
| 是否所有候选件 `node --check` + 标识符本文件内声明校验 + 跨文件导入校验 | 是（脚本内置；对 deployed dry-run 全 `[ok]`；`candidates` 已证明等于脚本产物） |
| 是否"真跑" | 是：E1（9 次对拍）、G1（2 轮真实语料前后对照）、G2、G4、A1–A5（含真实 root 冷 fold）、反向对照 4 条、B2 形状；全部原始 JSON 在 `out/` |
| 停止条件是否触发 | **未触发**（等价通过、单飞已证、G1 替代 11.86 ms ≪ 100 ms） |
| 失败项 | 无残留失败；过程失败 4 项（TDZ/绑定、WAL 拷贝、ESM 探针 ReferenceError、ELD reset 陷阱）均已定位并修正，见 §5 |
| 已知 invalid | 沙箱**非独占**：所有绝对耗时只能作量级；生产查询耗时回归、45 s 周期后的绝对卡顿量级**未测**（BATCH-PLAN §5 明确要求独占窗口） |

**明确不做结论的事**：worker 化**不降本**（fold 总工作量、SQLite/fs 调用次数完全不变，仅把同步占用移出宿主事件循环）；
本档**不主张**"用户可感卡顿已消除"，只主张"一次 ingest pass 期间宿主事件循环不再被长时间占住（G1）"。
