# 执行前审计：ingest worker 化 / timer 未触发 / daily rebuild 重复键

- 日期：2026-09-21
- 工作区：`/home/CNS2026495165/dsh`
- 审计目录（本档独占）：`.workspace/lag-fix/exec-audit/ingest/`
- 性质：**只读执行前审计**。未修改任何产品文件、未部署、未重启、未 pkill、未写 `~/.dsh`。
  （唯一写入 = 本目录下的探针脚本、`scratch*/` 临时库、`stage-ws/` 暂存拷贝。）
- 纪律说明：本报告逐条标注 **PASS / FAIL / INCONCLUSIVE**，并把 **【实跑】**（我本人执行并得到该观测）
  与 **【推断】**（读码/文献推断，未实测）分开写。

---

## 0. 结论摘要（先读这一节）

### 0.1 三条硬结论

| # | 结论 | 判定 | 证据类型 |
|---|---|---|---|
| **1** | **45s timer 未触发的根因已钉死：`dsh-usage` 的 `inject` 列表里没有 `timer`，而 `ctx.setInterval` 是 timer 服务的 mixin accessor → 读取即抛 `cannot get property "timer" without inject`。异常发生在 `typeof` 求值那一刻，三元表达式的 else（`ctx.effect` 兜底）根本没机会执行，整个 bootstrap 被末尾 `.catch()` 吞成一行 `log.warn`。** | **PASS** | 实跑复现（宿主真实 cordis 4.0.2 + 真实 `cordis-plugin-timer` 1.1.4）+ 读码 |
| **2** | **U-IG3 重复键根因已钉死：`rebuildDailyForDays` 的 DELETE 集合 = 调用方传入的非连续 day 集合，而 INSERT 的 SELECT 用的是 `[min(days), max(days)+1day)` 连续区间 → 区间内的**间隙日**没有被 DELETE，却被 GROUP BY 重新产出并裸 INSERT → UNIQUE 冲突。** | **PASS** | 实跑：11/11 个 UNIQUE 失败**逐例**都满足"产出集合 = 删除集合 ∪ 间隙日"；最小同构复现 100% 必现 |
| **3** | **`unable to open database file`（3/11）不是产品缺陷、也不是空库假象：它是本沙箱环境"SQLite 临时文件无法创建"的产物，任何需要 temp-store 的聚合都会失败。我用生产库只读连接复现了它，并证明 `PRAGMA temp_store=2`（内存临时表）后立即可用。** | **PASS（机制）** / 生产影响 **INCONCLUSIVE** | 实跑（生产库只读 + temp_store 判别） |

### 0.2 对"恢复 45s timer"的裁决输入

- **U-IG2 现在可以修，且修法确定**（§1.5）。修 `timer` 注入是**一行**。
- **但顺序铁律仍然成立且现在有精确判据**：修完 U-IG1（worker 化）之前不得启用 timer。
  判据见 §5.3（可直接当闸门用）。
- 附带说明：**当前"timer 不跑"确实在保护交互**——宿主自 14:37:03 启动，首扫（`await runIngest()`，
  `index.js:207`）在启动后 ~3s 内同步跑完一次全量/增量 fold，这就是启动瞬间的秒级冻结来源之一。

### 0.3 交付物与判定汇总

| 交付项 | 判定 |
|---|---|
| 1. timer 未触发根因 + 只读判别实验 | **PASS**（§1，含"未验证"清单 §1.7） |
| 2. U-IG1 细粒度交付单元 | **PASS**（§2，6 个单元，每单元含文件/函数/改动形状/验收/回滚/是否重启） |
| 3. U-IG3 根因与修法 | **PASS**（§3，根因实跑钉死；修法与等价性已实跑验证） |
| 4. CC 游标修复落地锚点 | **PASS**（§4，锚点脚本已就绪且幂等；三条复现全部实跑） |
| 5. 执行顺序与批次 / timer 阻断判据 | **PASS**（§5） |

---

## 1. timer 未触发的根因（U-IG2 前提）

### 1.1 被测对象（真实文件，已核 md5）

| 文件 | 路径 | md5 |
|---|---|---|
| `index.js`（deployed） | `~/.dsh/profiles/node_modules/@local/dsh-usage/lib/index.js` | `1f0aeeb35241effd168057711c368827` |
| `index.js`（workspace source） | `dsh-usage/lib/index.js` | 同上（**两侧一致**） |

deployed 与 workspace source 的 `index.js` **在 timer 这段代码上完全同形**（`diff` 的 66 行差异全部集中在
Config schema 注释、R4 代次注释、rpc register 注释等，**不涉及 timer 块**）。timer 块锚点：

```
index.js:209  disposeTimer =
index.js:210      typeof ctx.setInterval === "function"      ← 异常在这一行的求值中抛出
index.js:211          ? ctx.setInterval(runIngest, INGEST_INTERVAL_MS)
index.js:212          : ctx.effect(() => {                   ← 兜底分支，永远不会被执行到
index.js:213              const timer = setInterval(() => void runIngest(), INGEST_INTERVAL_MS);
index.js:214              return () => clearInterval(timer);
index.js:215          }, "dsh-usage: ingest interval");
```
外层捕获点：`index.js:220` `.catch((error) => log.warn(\`bootstrap failed: ...\`))`。

### 1.2 装配事实（回答"timer 是否被挂载、挂在哪个 ctx"）

**【实跑 + 读码】PASS**：timer 服务**确实被挂载**，且挂在**根 ctx**上。

- `dsh-base` bundle 的 patch 第 16–17 行：
  `- id: timer` / `name: '@deepseek-ai/cordis-plugin-timer'`
  （文件：`…/node_modules/@deepseek-ai/dsh-base/cordis.patch.yml`）
- `dsh-usage` 由 profile patch 插入：
  `~/.dsh/profiles/web/cordis.patch.yml` → `- insert: - id: usage / name: '@local/dsh-usage'`
- profile 的 `cordis.yml` 是空数组，树 = bundles 逐层 patch + `cordis.patch.yml`；
  `cordis-plugin-timer` **没有任何 disable/覆盖**。
- 模块解析：`~/.dsh/profiles/node_modules/@deepseek-ai/cordis-plugin-timer` 是指向
  `…/@deepseek-ai/dsh/node_modules/@deepseek-ai/cordis-plugin-timer` 的**符号链接**（同理 `cordis`），
  即版本 `cordis@4.0.2` / `cordis-plugin-timer@1.1.4`，**与我探针加载的是同一份代码**。

**【实跑】**离线最小组合（真实 `cordis@4.0.2` + 真实 `TimerService`）：

```
root ctx:  hasTimer=true  hasSetInterval=function  hasInterval=function  hasEffect=function
rootTicks=12 / 22（重复触发，是真 interval，不是一次性）
```
→ timer 服务在根 ctx 上**可用且工作正常**。

### 1.3 根因：【实跑】`ctx.setInterval` 在 usage 的 ctx 上**不存在，读取即抛**

`cordis-plugin-timer` 的 `TimerService` 构造时：
```js
super(ctx, "timer");
ctx.mixin("timer", ["timeout","interval","throttle","debounce","setTimeout","setInterval"]);
```
`mixin()` 注册的是 **accessor（getter）**，其 `getTarget` 是 `ctx["timer"]`（`cordis/lib/index.js:882-883`）。
而 cordis 的 proxy `get` trap（`:672-698`）在**未声明该服务注入**时，会走到 `:675`
`new Error('cannot get property "timer" without inject')`，再由 accessor 的 `getTarget` **抛出**：

```
cordis/lib/index.js:880  mixin(source, mixins)
cordis/lib/index.js:883      const service = getTarget(this, error);   ← ctx["timer"] 抛错
cordis/lib/index.js:675  const error = new Error(`cannot get property "${prop}" without inject`)
```

**【实跑】决定性对照（同一组合，只改 `inject` 列表）**：

| 插件 ctx 的 inject | `timer` | `setInterval` | `interval` | `setTimeout` | `timeout` | `throttle` | `debounce` |
|---|---|---|---|---|---|---|---|
| `["connection","webServer"]`（**= dsh-usage 现状**） | THROW | THROW | THROW | THROW | THROW | THROW | THROW |
| `["connection","webServer","timer"]` | object | function | function | function | function | function | function |

（THROW 全部为同一条：`cannot get property "timer" without inject`）

**【实跑】把 deployed `index.js:210-215` 的表达式形状原样搬进探针**：

```json
{ "expressionThrew": "Error: cannot get property \"timer\" without inject", "calls": 1 }
```
→ 表达式**抛错**，`out.installed` 从未被赋值（即 `disposeTimer` 保持 `null`），
而 `runIngest` 已经被调用 1 次（首扫照常完成）——**与生产观测完全吻合**。

### 1.4 为什么"`ctx.effect` 兜底路径"没有生效

**因为它在语法上不可达。** `typeof ctx.setInterval === "function"` 位于条件表达式（`A ? B : C`）中，
JS 必须先求值 `A` 才能决定走 `B` 还是 `C`。`A` 自身**抛异常**（不是返回 `false`），
于是整个赋值语句 `disposeTimer = A ? B : C` 抛出，`C`（`ctx.effect` 兜底）**一次都不会被求值**。

这一点是本档推翻上一轮二选一假设（"未安装" vs "未调度"）的关键：
**不是"未安装后没兜底"，而是"检测动作本身抛错，兜底根本没机会跑"**。

### 1.5 修法（U-IG2 最小、与现有代码同构）

**首选（推荐）**：把 timer 依赖**显式注入**，并把安装动作放进注入回调里。

```js
// index.js —— 在 bootstrap 的那个 await runIngest() 之后
ctx.inject(["timer"], (timerCtx) => {
  if (!isActive(bootstrapGeneration)) return;
  disposeTimer = timerCtx.setInterval(runIngest, INGEST_INTERVAL_MS);
  ctx.effect(() => () => { try { disposeTimer?.(); } catch { /* best effort */ } }, "dsh-usage: ingest interval");
});
```
- 优点 1：`typeof ctx.setInterval` 这个会抛的检测**从代码里消失**，不需要 try/catch 兜。
- 优点 2：`ctx.inject(services, cb)` 在服务缺失时只是**把回调挂起**，不抛（**【推断】**，
  依据 `cordis/lib/index.js:1599-1605` 的 `inject()` 实现 + §1.3 的 fiber 挂起机制；
  已实测"未满足 inject 的 fiber 停在 state 0 且不抛"，见 §1.6 对照）。
- 优点 3：与文件里已有的 `ctx.inject(["settings"], …)`（`:97-99`）写法同构，改动面最小。

**备选（改动更小，但不推荐）**：只把 `timer` 加进模块级 `inject` 数组
（`const inject = ["connection","webServer"]` → `[...,"timer"]`）。
缺点是**过度耦合**：timer 若因任何原因不可用，整个插件（含 `/usage` RPC 路由）会被一起挂起，
而现状下 RPC 是好的。**首选方案把 timer 依赖局部化，失败面更小。**

**两者都必须保留**：无论选哪个，都不要写成"先 `typeof` 再决定"的形式去访问 `ctx.timer` 系列属性。

**【实跑】修法形状已验证可用**（`probe-r5i-fix-shape.mjs`：先做 3s 同步占用模拟冷 fold，
再走 `ctx.inject(['timer'], cb)` 的修法形状）：

```json
{ "afterInjectSync": "no-throw",
  "path": "ctx.inject([timer])",
  "hasSetIntervalInInject": "function",
  "installed": true,
  "valueType": "function", "hasThen": "function",
  "callsAfterSpinPlus2500ms": 9,
  "intervalFired": true }
```
→ ① 注入回调内 `timerCtx.setInterval` 是 function；② 长同步占用之后安装**不被回收**；
③ 250ms 周期在 2.5s 内触发 9 次（**真 interval**）。

### 1.6 只读判别实验（可复现、可审计）

| 探针 | 作用 | 结果 |
|---|---|---|
| `probe-r5g-guard.mjs` | 同一组合下只改 `inject`，逐个探测 7 个 timer 属性 | **PASS**：未注入全 THROW；注入后全部 function/object |
| `probe-r5h-fallback.mjs` | 把 `index.js:210-215` 的表达式原样搬进探针并捕获异常 | **PASS**：抛 `cannot get property "timer" without inject`；`runIngest` 已调用 1 次 |
| `probe-r5e.mjs` | 校准 cordis 插件形状（`await ctx.plugin(...)` 才会 apply；未满足 inject 的 fiber 停在 state 0 且不抛） | **PASS**（同时说明：provider 必须先于依赖者装载） |

复现命令：
```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-audit/ingest
node probe-r5g-guard.mjs
node probe-r5h-fallback.mjs
```
两个探针都**只做内存内组合**：不写文件、不碰产品代码、不碰 `~/.dsh`。

### 1.7 明确"未验证"的部分（不得当成已证）

| # | 未验证项 | 为什么未验证 / 风险 |
|---|---|---|
| N1 | **生产日志里没看到那行 `bootstrap failed: ...`** | 宿主 stdout 未落盘（`/proc/<pid>/fd` 不可读；`~/.dsh/backups/dsh-restart.log` 只到启动行为止）。**根因结论不依赖它**：由"timer 从不触发 + 首扫正常 + 表达式实跑必抛"三点共同锁定。 |
| N2 | `ctx.effect` 兜底路径**在真实宿主里的**行为 | 该分支在生产从未执行过（因为被异常短路）。我**不主张**它坏，也不主张它好——**它只是不可达**。 |
| N3 | `clock`/epoch 一次性 effect 回收是否是**第二重**原因 | 本档**排除**它成为主因：兜底分支根本没跑到。**我未构造**"fiber epoch 变化导致一次性 effect 被丢弃"的独立复现。 |
| N4 | 45s timer 恢复后的真实卡顿量级 | 本机全程非独占（见 `research-v2/MEASUREMENT-STATUS.md §1`），**绝对性能数字一律不可采信**。以既有 2.682s/36.1s 相对量级为唯一依据。 |

---

## 2. U-IG1：把 ingest 移出宿主主线程 —— 细粒度交付单元

> 以下 6 个单元可直接逐条实现。**总前提：`DatabaseSync` 不可跨线程**（`ingest-equiv/audit.md` §3.1 实跑
> `DataCloneError`），worker 必须**自开连接**。**(来源标注：§3.1/§3.3/§3.4 的实测结论来自
> `research-v2/ingest-equiv/audit.md`（他人实测，我未复跑；我复跑的是 timer/daily/生产查询三类，见 §6.2）。**

### U-IG1.1 `lib/ingest-worker.js`（新增）

| 项 | 内容 |
|---|---|
| **文件** | `dsh-usage/lib/ingest-worker.js`（新文件；deployed 侧同路径） |
| **职责** | worker 线程入口：收一条 `start` 消息 → 用**宿主显式传入**的 `dbPath` 自开连接 → 按 `index.js:120-131` 的**完全相同顺序**跑 `foldDshSource` → `foldCcSource` → 回传结果 |
| **入参协议** | `{ type:'start', id:<int>, dbPath:<abs>, dshRoot?:<abs>, ccRoot?:<abs> }`（`dshRoot/ccRoot` 不传 = 模块默认根；**`dbPath` 必传且必须是宿主 `resolveDbPath()` 的结果**） |
| **出参协议** | `{ type:'progress', id, scanned, newEvents, phase:'dsh'\|'cc' }`（映射 `onProgress`，节流：≥200ms 或整百事件才发一次）<br>`{ type:'done', id, dsh:{scanned,newEvents,failedFiles:[{file,error}]}, cc:{...}, wallMs }`<br>`{ type:'failed', id, message, stack? }` |
| **消息形状约束** | 只发 JSON 可序列化值。**绝不 postMessage 任何 db 句柄/statement/Buffer**（`failedFiles` 里的 `file` 若为 URL 对象要先 `String()`）。 |
| **硬约束（必须写成注释 + 断言）** | ① **绝不调用 `resolveDbPath()`**（它会 `mkdirSync` 并触摸真实 home）；② 不调 `ensureSchema`（宿主已建）；③ 只在 `start` 时 `openUsageDb(dbPath)`，**一个 worker 生命周期内复用同一条连接**跑多轮。 |
| **连接设置** | 复用 `openUsageDb`（内含 `PRAGMA journal_mode=WAL`）；**额外** `PRAGMA busy_timeout = 5000`（见 U-IG1.5）。 |
| **验收** | ① `node --check` 通过；② 与真机同库对拍：worker 跑出的 `usage_events`/`usage_daily`/`sync_state` 与宿主同步 fold **逐字节相同**（回归门 = `research-v2/ingest-equiv/run-suite.sh` 全绿）；③ 静态审计：文件内 `grep -c resolveDbPath` = 0。 |
| **回滚点** | 纯新增文件，删除即回滚；不影响任何现有路径。 |
| **需要重启** | 是（与宿主半同批）。 |

### U-IG1.2 `lib/ingest-runner.js`（新增）

| 项 | 内容 |
|---|---|
| **文件** | `dsh-usage/lib/ingest-runner.js`（新文件） |
| **职责** | 宿主侧 worker 生命周期与**单飞**（single-flight）。对外只暴露 `run()` 与 `dispose()`。 |
| **签名** | `createIngestRunner({ dbPath, log, workerUrl?, stallMs = 120_000, hardTimeoutMs = 900_000, onProgress })` → `{ run(): Promise<Result>, dispose(): Promise<void> }` |
| **单飞语义（关键）** | `let inFlight = null; run() => (inFlight ??= start().finally(() => { inFlight = null; }))`。**并发 2 次 `run()` 只跑一份 fold，且第二个调用者复用同一个 promise**（不做 barrier、不排队第二次）。 |
| **worker 生命周期** | 惰性 `new Worker(workerUrl, { type:'module' })`；**崩溃/退出 → 下一次 `run()` 重建**（`worker.on('exit')` 里 `worker=null; inFlight=null`）；`dispose()` 里 `worker.terminate()` + 清 `inFlight`。 |
| **超时** | **不用"总时长"超时**（冷摄入 36.1s 且随数据增长，硬超时会误杀）。用**停滞看门狗**：距上一条 `progress` 超过 `stallMs`（默认 120s）→ `terminate()` 并**重建** worker，本次 `run()` 以 `{ ok:false, reason:'stalled' }` 结束，**绝不重试**（避免双份 fold 打架）。可选 `hardTimeoutMs` 仅作最后保险（默认 15min）。 |
| **id 关联** | 自增 `id`；只接受 `id === currentId` 的消息，其余丢弃（陈旧 worker 的消息不会污染状态）。 |
| **宿主清理点** | `run()` 的 settle（成功/失败/**停滞**）后，`finally` 里调用 `invalidateMaxDailyDayCache()`（见 U-IG1.3）。 |
| **验收** | ① 并发两次 `run()`：worker 侧只收到 **1** 条 `start`（可计数断言）；② 故意 `worker.terminate()` 后 `run()` 能自动重建并成功；③ 故意不响应 progress → `stallMs` 到点后 terminate 且 `run()` 返回 `{ok:false}`；④ `dispose()` 后无存活 worker/句柄（`process._getActiveHandles()` 或 worker 计数）。 |
| **回滚点** | 纯新增文件。 |
| **需要重启** | 是（与宿主半同批）。 |

### U-IG1.3 `db.js` 导出 `invalidateMaxDailyDayCache` + 宿主清理点

| 项 | 内容 |
|---|---|
| **文件/行** | `dsh-usage/lib/db.js:476`（workspace source）/ `:483`（deployed） |
| **改动形状** | `function invalidateMaxDailyDayCache() {` → `export function invalidateMaxDailyDayCache() {`（**仅加 `export`**，函数体一字不改） |
| **宿主清理点** | `ingest-runner.js` 的 `run()` 落定处（推荐），或 `index.js` 的 worker 等待 promise settle 之后（成功/失败都算）。**必须放在 `finally`**，否则失败路径下缓存不失效。 |
| **语义澄清（重要，别写成"不修就数字错"）** | 该缓存变旧**不会产生错值**：`MAX(day)` 单调不减，旧值只会让 gate 使用**更早**的 day 边界 → 更多天数回落到 raw-events 精确路线 → 仍然正确，只是少了快路径（`ingest-equiv/audit.md` §3.3）。**这是性能项，不是正确性项。** |
| **验收** | ① `Object.keys(await import('db.js')).includes('invalidateMaxDailyDayCache')` = true；② 插桩计数：worker 跑完一轮后**宿主线程**的 invalidate 计数 +1（worker 内的 invalidate **不会穿透**，故必须宿主自己调）。 |
| **回滚点** | 去掉 `export` + 删调用点，两处独立。 |
| **需要重启** | 是（与 U-IG1 同批）。 |

### U-IG1.4 `rpc.js`：**只**给 `refresh` 去重，**不加任何 query/status barrier**

| 项 | 内容 |
|---|---|
| **文件** | `dsh-usage/lib/rpc.js`（deployed 的 register 锚点在 `:225`，与 source 不同，见 §4 警示） |
| **改动形状** | `registerUsageRpc(ctx, { ..., ingest, waitIdle })` 增加可选 `waitIdle`；`refresh` 分支改为 `await (waitIdle ? waitIdle() : ingest())`。**`status` 与 7 个数据端点一行不改。** |
| **为什么默认不加 barrier** | `ingest-equiv/audit.md` 实跑：`COMMIT → rebuild` 窗口**在全部 9 个 RPC 端点上都不可观察**（10 项同值）；而 barrier 会把 fold 时长（生产"全量重扫 + 十万行"量级）**直接转嫁给查询延迟**，并把 `status` 的进度可见性打掉（`status` 读的是 `index.js:148-170` 的实时可变状态，是**刻意设计**）。 |
| **refresh 去重的真实必要性（本档新增论据，【实跑】读码）** | ① 客户端每 `refreshSec`（默认 60s，可调）轮询一次，`client.js:404-410` 只做"页面隐藏则不轮询"，**不做 in-flight 去重**；② 服务端 `rpc.js:189-192` 的 `refresh → await ingest()` **直接串行等待**。一旦把 ingest 交给 worker，若 `run()` 无单飞，重叠的 refresh 会**堆叠多份 fold**（每份都要读 871 文件）。因此**去重不是可选项**。 |
| **验收** | ① 并发 10 次 `/usage/refresh`：worker 侧 `start` 计数 = **1**，10 个响应都 200 且 `ok:true`；② `status` 在 ingest 期间仍**立即**返回（响应时间不随 fold 时长增长）；③ `summary/byDay/...` 在 ingest 期间不等待（同上）。 |
| **回滚点** | 删 `waitIdle` 参数与 refresh 分支改动。 |
| **需要重启** | 是（与 U-IG1 同批）。 |

### U-IG1.5 `busy_timeout` 设置点

| 项 | 内容 |
|---|---|
| **文件/函数** | `dsh-usage/lib/db.js` → `openUsageDb(path)`；插在 `db.exec("PRAGMA journal_mode = WAL")` **之后**、`PRAGMA application_id` 之前 |
| **改动形状** | `db.exec("PRAGMA busy_timeout = 5000");` |
| **依据【实跑】** | 生产库 `PRAGMA busy_timeout` → `{timeout: 0}`（**未设**，本档实测）。`ingest-equiv/audit.md` §3.5：worker 持写事务时宿主 `BEGIN IMMEDIATE` **立即硬失败** `ERR_SQLITE_ERROR: database is locked`；设 `busy_timeout=5000` 后改为等待 1530ms 成功。 |
| **为什么值得做** | 引入第二条连接（worker）后，"宿主侧出现写路径"或 WAL checkpoint 竞态的概率**上升**；当前配置把任何碰撞都变成**硬失败**而不是短等。一行成本换掉一整类间歇性失败。 |
| **验收** | ① `PRAGMA busy_timeout` 返回 `5000`；② 复现脚本：worker 持写事务时宿主 `BEGIN IMMEDIATE` **等待后成功**（而非立即抛）；③ 其余查询耗时无显著回归（**注**：本机非独占，耗时类只作比值参考）。 |
| **风险** | 单值 5000ms 是经验值；worker 侧也应设（worker 是独立单线程，无争用风险，但统一无害）。 |
| **回滚点** | 删该行。 |
| **需要重启** | 是（与 U-IG1 同批）。 |

### U-IG1.6 `index.js` 接线（宿主半）

| 项 | 内容 |
|---|---|
| **文件** | `dsh-usage/lib/index.js`（deployed 需按 §4 的"独立拷贝"纪律打锚点补丁，**不许整文件覆盖**） |
| **改动形状** | ① `runIngest` 体改为 `const runner = createIngestRunner({ dbPath, log, onProgress })` 并 `await runner.run()`；`ingestSummary` 的更新移到 `onProgress` 回调；`lastIngest = Date.now()` / `firstScanAt` 保持现状；② **removed**：`foldDshSource/foldCcSource` 的 import（改由 worker 引）；③ dispose（`index.js:225-243` 的 `ctx.effect`）里增加 `void runner?.dispose()`；④ `registerUsageRpc` 增加 `waitIdle: () => runner.inFlight ?? Promise.resolve()`（配合 U-IG1.4）。 |
| **顺序** | 必须**先** `await openUsageDb()` + `ensureSchema` 得到 `dbPath`，**再**创建 runner（worker 要靠它自开连接）。 |
| **验收（这是 U-IG1 的核心验收）** | ① **宿主事件循环零长任务**：在一次完整 ingest pass 期间用 `perf_hooks.monitorEventLoopDelay({resolution:10})` 采样，`max` **< 100ms**（现状对照：同一 pass 同步跑会出现 2.7s / 36.1s 的单次阻塞）；② ingest 结果与现状**等价**（`ingest-equiv/run-suite.sh` 全绿 = 9 对比面 × 3 时区 + 追加 4 阶段 + CC offset 4 场景 × 3 时区）；③ `status` 在 pass 期间**实时**（`lastIngest` 在 pass 结束后更新、`scannedDsh` 随进度递增）；④ 卸载插件后**无残留 worker**。 |
| **回滚点** | 保留 `index.js` 原同步路径为 `runIngestSync`（**同一文件内**的 fallback，由常量开关选择），出问题时切回即恢复现状——**这条强烈建议保留到 U-IG1 稳定后再删**。 |
| **需要重启** | 是。 |

### 2.7 U-IG1 的规模边界（必须同时说明，别夸大收益）

- **worker 化不等于降本**：fold 的总工作量、SQLite 调用次数、fs 调用次数**完全不变**；
  搬进 worker 只是把同步占用从宿主事件循环移走，并**新增**线程启动 + 消息传递开销。
- 因此 worker 化**只解决"宿主被冻结"**，不解决"每 45s 要花 2.7s CPU"。
  若还想降本，必须另开单元（增量降本：CC 游标修复会去掉"每轮全量重扫"，见 §4；DSH 源已有的
  mtime/size 闸门已生效）。
- **【本档未测】** worker 化后宿主查询耗时是否回归（宿主失去单连接 prepared-statement 复用）。
  建议在 U-IG1 落地后单列一条"两连接下的查询耗时对比"，且**必须在独占窗口**测（否则 INCONCLUSIVE）。

---

## 3. U-IG3：`daily rebuild` 重复键的根因与修法

### 3.1 复现（【实跑】，与协调者独立一致）

| 观测 | 值 |
|---|---|
| 真实 `foldDshSource` + 真实 sessions root + 空临时库 | `scanned=874/875`、`newEvents≈53.8k`、**`failedFiles=14`** |
| 失败分类 | **UNIQUE=11**、`unable to open database file`=3（见 §3.4） |
| fold 墙钟 | 26.4s – 33.4s（**注**：本机非独占，此数字只作量级参考） |
| 错误文本 | `daily rebuild: UNIQUE constraint failed: usage_daily.day, usage_daily.data_source, usage_daily.model, usage_daily.project` |

### 3.2 根因（【实跑】逐例钉死，非推断）

`rebuildDailyForDays(db, days)`（`db.js:222-266`）的三段：

```js
const lo = days.reduce((a,d)=>Math.min(a, localDayMs(d)), +∞);         // days 的最小日 00:00
const hiExclusive = days.reduce((a,d)=>Math.max(a, localDayMs(d)), -∞) + 86_400_000;  // 最大日 +1 天
db.exec("BEGIN");
  DELETE FROM usage_daily WHERE day IN (?, ?, …)                       // ← 只删 days 里的这些日
  INSERT INTO usage_daily (...) SELECT strftime(...'localtime') AS day, …
    FROM usage_events WHERE ts >= lo AND ts < hiExclusive              // ← 却扫描**整段连续区间**
    GROUP BY day, data_source, COALESCE(model,'(unknown)'), COALESCE(project,'(unknown)')
db.exec("COMMIT");
```

**当 `days` 非连续（有间隙日）时：**
- INSERT 的 `WHERE ts >= lo AND ts < hiExclusive` 覆盖 `[min(days), max(days)]` 之间**所有**日子；
- GROUP BY 会把**间隙日**也产出成行；
- 但 DELETE 只删了 `days` 里列出的那些天 → **间隙日的旧行仍在表里** → 裸 INSERT 撞主键。

**【实跑】11/11 个 UNIQUE 失败逐例符合此模式**（`out-r4.json` → `failingRebuilds[*].diag`）：

| 传入 days（= DELETE 集合） | GROUP BY 实际产出 | 产出 \ DELETE（= 冲突键所在日） | 冲突行数 |
|---|---|---|---|
| `08-19, 08-20, 08-24, 08-25` | `08-19,20,21,22,24,25` | **08-21, 08-22** | 2 |
| `08-19, 08-21` | `08-19,20,21` | **08-20** | 3 |
| `09-18, 09-21` | `09-18,20,21` | **09-20** | 2 |
| `09-16, 09-18, 09-21` | `09-16,17,18,20,21` | **09-17, 09-20** | 5 |
| `09-01, 09-05, 09-07, 09-08` | `09-01,02,03,05,07,08` | **09-02, 09-03** | 4 |
| `09-01, 09-08`（另 2 例形态相同） | 含 09-02/03/05/07 | **09-02,03,05,07** | 4 / 9 |
| `08-21, 08-24, 08-27` | `08-21,22,24,25,26,27` | **08-22, 08-25, 08-26** | 8 |
| `09-08, 09-11` | `09-08,09,11` | **09-09** | 2 |

`leftovers = []`（DELETE 集合内的行**确实删干净了**），`daysNotDeletedCount > 0` 且
`clashSample[*].existing` 与 `produced` **数值完全相同**（例：`08-21` produced requests=384 = existing 384）
——**三者共同排除**了"DELETE 没生效"和"数值被改坏"两种替代解释。

### 3.3 三个候选假设的裁决

| 候选 | 判定 | 依据 |
|---|---|---|
| **① 聚合 GROUP BY 键与 UNIQUE 键不一致** | **否决** | GROUP BY 键 `(day, data_source, COALESCE(model), COALESCE(project))` 与 PK `(day,data_source,model,project)` **语义一致**；且 `group by` 之后**同一键必然只有一行**，不可能自撞。 |
| **② 裸 INSERT 未 upsert** | **部分成立但不是根因** | INSERT 确实是裸语句。但【实跑】对照实验证明：**只要 DELETE 集合 ⊇ INSERT 产出集合，同键两遍重算完全不冲突**（`probe-r2` 的 `B_sameKeyTwice` / `C2_repeatCorrectDay` 都是 `error:null`；`probe-r6` 的 `B1` 只有"少删间隙日"时才抛）。所以"未 upsert"是**放大条件**，不是触发条件。 |
| **③ NULL 语义** | **否决** | 生产库 `usage_daily` 325 行**全部** `model/project` 非 NULL（`P1_nullVariants` = 0 NULL）；`COALESCE` 保证 INSERT 侧也永不 NULL。故 PK 的 NULL 语义**在这份数据上不可达**。 |
| **④ DELETE 集合 ⊊ INSERT 产出集合（区间 vs 集合不匹配）** | **成立 —— 根因** | 见 §3.2：11/11 逐例吻合；最小同构复现 100% 必现。 |

### 3.4 `unable to open database file`（3 例）—— 环境机制，【实跑】

**这不是空库假象，也不是数据损坏，而是本沙箱"SQLite 临时文件无法创建"。**

【实跑】判别链（全部只读，用**生产库**）：

| 实验 | 结果 |
|---|---|
| 生产库只读连接，跑**多列 GROUP BY**（`day, data_source, model, project`） | **40/40 失败**，全部 `unable to open database file`，重试仍失败 |
| 同一连接，跑**单列 GROUP BY**（`GROUP BY day`） | **10/10 成功** |
| 同一连接，`GROUP BY 1,2,3`（无 strftime） | 失败 |
| `GROUP BY data_source`（单列） | 成功 |
| 内存库 `:memory:` + 20 万行 + 多列 GROUP BY | 失败 |
| 同上，先 `PRAGMA temp_store = 2`（内存临时表） | **成功** |
| 同一 SQL 文本紧邻重试 | 仍失败（**不是偶发**，是确定性可用性问题） |

→ 结论：**凡是需要 SQLite temp-store 的聚合，在本沙箱内必然失败**；`temp_store` 指向文件时同样失败。
这是**环境约束**，不是产品缺陷。

【实跑】同机制下**产品自己的 7 个数据端点**在生产库上的表现：

| 端点 | 结果 |
|---|---|
| `querySummary` | OK（`requests=115589`） |
| `queryHeatmap(2026)` | OK（33 行；**它不 GROUP BY**，走 `usage_daily` 快路径） |
| `queryTimeseries`(day / hour) | **ERR unable to open database file** |
| `queryByDay` / `queryByModel` / `queryByProject` / `querySessions` | **ERR unable to open database file** |

**⚠ 对照事实（防止误判）**：**线上宿主自己（PID 1390375）的 /usage 卡片是正常出数的**，
说明**宿主进程所在的运行环境可以创建临时文件**。因此上表这些 ERR 是**我的 agent 沙箱**的产物，
**不得**据此认定生产 `timeseries/byDay/byModel/byProject/sessions` 有问题。

**但对本轮仍有一条真实含义（【推断】+ 部分实跑）**：同样的 temp-store 依赖意味着，
`rebuildDailyForDays` 的 INSERT 在**排序器超出内存阈值时**会失败——这正好解释
为什么 3 例 OPEN 失败的 `diag` 显示"产出集合 == 删除集合、无冲突、无残留"
（即**不是键的问题，而是语句本身执行不了**）。**生产上是否会发生，取决于 sorter 是否溢出内存，
本档无法在非独占机器上判定 ⇒ 标 INCONCLUSIVE。**

**建议的同批加固（可选、一行）**：在 `openUsageDb` 里加 `PRAGMA temp_store = 2`。
代价是聚合排序占用进程内存而非磁盘（本库 115k 事件、~100–300 组，量级很小），
收益是**消除一整类"聚合莫名失败"**。**建议标为"加固"，不标为"修 U-IG3"。**

### 3.5 最小修法（两选一，均可，建议 A）

**修法 A（推荐）：让 DELETE 集合 ⊇ INSERT 产出集合（对齐区间）**

```js
// 改动：把"只删 days"换成"删 [lo, hiExclusive) 覆盖的所有 day"
const lo = days.reduce((a, d) => Math.min(a, localDayMs(d)), Number.POSITIVE_INFINITY);
const hiExclusive = days.reduce((a, d) => Math.max(a, localDayMs(d)), Number.NEGATIVE_INFINITY) + 86_400_000;
const spanDays = [];
for (let t = lo; t < hiExclusive; t += 86_400_000) spanDays.push(localDayOf(t));
// 原：db.prepare(`DELETE FROM usage_daily WHERE day IN (${placeholders})`).run(...days);
db.prepare(`DELETE FROM usage_daily WHERE day IN (${spanDays.map(() => "?").join(", ")})`).run(...spanDays);
// INSERT 部分一字不改
```
- **语义**：区间内的间隙日**本来就该被重算**（它们的原始事件可能刚刚被本轮 fold 更新过），
  所以删了再算**不是副作用，而是修正**。
- **性价比**：消除了"为什么某个间隙日没被重算"的整类问题。
- **风险**：跨天跨度大时 DELETE 行数变多（最多 `max-min+1` 天 × 组数），代价可忽略（PK 前缀是 `day`）。

**修法 B（更保守）：INSERT 改 UPSERT**

```sql
INSERT INTO usage_daily (...)
SELECT ...
FROM usage_events WHERE ts >= ? AND ts < ?
GROUP BY day, data_source, COALESCE(model,'(unknown)'), COALESCE(project,'(unknown)')
ON CONFLICT(day, data_source, model, project) DO UPDATE SET
  requests = excluded.requests, input_tokens = excluded.input_tokens,
  output_tokens = excluded.output_tokens, cache_read_tokens = excluded.cache_read_tokens,
  cache_write_tokens = excluded.cache_write_tokens
```
- **优点**：与 `insertEvent` 的既有姿势一致；对任何未来"区间/集合不一致"都免疫。
- **缺点**：会把"该删没删"的 bug **静默掩盖**成"值对了就行"（但注意：区间间隙日的重算结果**本来就是对的**，所以掩盖的只是"多留了一行的历史"）。
- **注意**：`ON CONFLICT` 与 `GROUP BY` 同语句是否被本机 SQLite 接受，**建议实现时先 `node --check` 式小样验证**（我在 `probe-r6` 中**已实跑通**该组合，见下）。

**两者可以同时上**（A 修根因、B 做保险），风险最低。

### 3.6 验收（"不产生错数字、且日聚合不再陈旧"）

【实跑】`probe-r6-boundary-fix.mjs` 已给出三态对照（构造：08-19/20/24/25 有事件，
08-21/22 已被"别的文件"写过 daily 行）：

| 实现 | 结果 |
|---|---|
| **现状（deployed 语义）** | **抛 UNIQUE**（`error` 非空），daily 表停在被 DELETE 后的状态 |
| **修法 A（区间对齐）** | `error:null`，**与全量重算逐行一致**（`fixRangeEqualsFull: true`） |
| **修法 B（UPSERT）** | `error:null`，**与全量重算逐行一致**（`fixUpsertEqualsFull: true`） |

因此 U-IG3 的验收标准可直接写成：

| # | 验收断言 | 方法 |
|---|---|---|
| **A1** | **真实 sessions root 上 `failedDsh` 中的 UNIQUE 数 = 0**（当前 11） | 空临时库跑真实 fold，统计 `failedFiles` 分类 |
| **A2** | **日聚合收敛**：对全库做 `usage_daily` ↔ `usage_events` 逐键比对，`mismatched = orphan = missing = 0` | 纯 JS 聚合（**不要**用 SQL GROUP BY，见 §3.4 环境约束）；参照实现见 `probe-r2-ig3.mjs` 的 §E 与 `probe-r7-production.mjs` |
| **A3** | **不产生错数字**：7 个数据端点在 `usage_daily` 重建前后返回**同值**（窗口不可观察） | 复用 `ingest-equiv/harness/query-probe.mjs` 的"同事件集两态对比" |
| **A4** | **区间/集合一致性**：对每个 `rebuildDailyForDays` 调用断言 `产出的 day 集合 ⊆ DELETE 的 day 集合` | 在 `probe-r4` 的插桩形状上加断言（**修好后应当恒真**） |
| **A5** | 回归：`rebuildDailyForDays` 同一 day 连跑 3 遍无冲突、值稳定 | 断言 `error:null` 且 3 次结果 byte-identical |

**生产库现状（只读实测，作为修后回归基线）**：
`usage_daily` 325 行 / `MAX(day)=2026-09-21` / 与 `usage_events`(115,589 行) 逐键比对
**mismatched=0, orphan=0, missing=0**。
→ **生产当前没有陈旧残留**；UNIQUE 缺陷的生产后果是"**该轮 daily 重建整体失败**"，
即**未来某天的聚合会停在旧值**，而不是"现在就错"。

### 3.7 回滚点 / 重启

| 项 | 内容 |
|---|---|
| **回滚点** | 改动集中在 `db.js` 的 `rebuildDailyForDays` 单函数；保留 pre-image（锚点补丁脚本会自动备份） |
| **需要重启** | **是**（`db.js` 属宿主半，`patchReload: live` 只在组合/配置变化时重挂载，不改已加载模块的代码） |

---

## 4. CC 游标修复的接入点（U-CC1）

### 4.1 现状核实（【实跑】diff + md5）

| 侧 | `ingest-cc.js` md5 | 状态 |
|---|---|---|
| deployed `…/@local/dsh-usage/lib/ingest-cc.js` | `af9e7e36f42f7b5f5f7a78708fda769e` | **未修版本**：`offset = size >= Number(state.last_offset) ? … : 0`（原样）+ `completeLines.join("\n") + "\n"`（原样） |
| workspace source `dsh-usage/lib/ingest-cc.js` | `e551eef1fd58f89538e522dedcaf8ced` | **已含两处修复** |

`diff` 确认两侧差异**只有**这两处（+ 注释），无其他改动。
另：`cc-cursor/libfixed/ingest-cc.js` 的 md5 与 workspace source **完全相同**
（`e551eef1…`），故 §4.2 的 `repro-legacy-migration.mjs`（其 `FIXED` 常量指向 `libfixed`）
**等价于在验证 workspace source 的修复实现**。

### 4.2 三条复现【实跑】（全部已跑通，交付物已落盘）

| 复现 | 命令 | 结果 |
|---|---|---|
| deployed 缺陷确认 | `node repro-cc-cursor.mjs --tag deployed-verify` | **LOSS_CONFIRMED**：`pass1 size=242 last_offset=243(=size+1)`；追加后 `pass2 events=1 failed=[1 unparsable JSON lines]` |
| 修复实现确认 | `node repro-cc-cursor.mjs --lib <stage-ws>/lib --tag ws-source-staged` | **NO_LOSS**：`pass1 last_offset=242`；`pass2 events=2 newEvents=1 failed=[]` |
| 遗留游标自愈 | `node repro-legacy-migration.mjs` | **SELF_HEAL_PASS**：旧实现留 `243` → 修复实现第二轮 `events=2 size=484 last_offset=484 failed=[]`（被跳过的记录**被补回**） |

**import 陷阱（重要，本档实跑踩到）**：直接把 `--lib` 指向 `dsh-usage/lib`（workspace source 目录）
会 `ERR_MODULE_NOT_FOUND: @deepseek-ai/dsh-home-paths`——**源目录解析不到该依赖**。
必须让被测文件位于**能解析依赖的位置**。我用的隔离做法（不碰产品）：
```bash
S=.workspace/lag-fix/exec-audit/ingest/stage-ws
mkdir -p $S/lib $S/node_modules/@deepseek-ai
cp dsh-usage/lib/{db.js,ingest-cc.js,zstd.js} $S/lib/
ln -s ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-home-paths $S/node_modules/@deepseek-ai/dsh-home-paths
node repro-cc-cursor.mjs --lib $S/lib --tag ws-source-staged
```
**推论**：部署到 `~/.dsh/profiles/node_modules/@local/dsh-usage/lib/` 后，该依赖由 profile 的
`node_modules` 正常解析（deployed 现状已如此），**不存在此问题**。

### 4.3 最小锚点清单（deployed 侧）

现成脚本：`.workspace/lag-fix/research-v2/cc-cursor/apply-CC-cursor-fix.mjs`
（**幂等**：含 `dsh-perf-fix CC-cursor v1` 标记则跳过；锚点命中数 ≠ 1 则 **fail-closed 不写**；
`--apply` 才写；写前备份 `pre-ingest-cc.js`；写后 `node --check`，失败自动回滚）。

| 锚点 | deployed 原文（精确） | 替换为 |
|---|---|---|
| **F1** | `<TAB>const consumedBytes = Buffer.byteLength(completeLines.join("\n") + "\n");` | `const consumedBytes = endsWithNewline ? Buffer.byteLength(text) : Buffer.byteLength(completeLines.join("\n") + "\n");` |
| **F2** | `<TAB>offset = size >= Number(state.last_offset) ? Number(state.last_offset) : 0;` | `const cursor = Number(state.last_offset); const legacyOverrun = Number(state.size) + 1 === cursor; const usable = legacyOverrun ? Number(state.size) : cursor; offset = size >= usable ? usable : 0;` |

**注意**：脚本里的 `find` 用 `<TAB>` 缩进（`const T = '[ \\t]+'`）。deployed 该文件用 **Tab 缩进**，
与 source 同形（两侧仅这两处不同 → 缩进一致）。**建议先 `node apply-CC-cursor-fix.mjs`（dry-run）确认锚点命中数为 1。**

### 4.4 验收

| # | 断言 | 方法 |
|---|---|---|
| **C1** | 锚点唯一命中、`node --check` 通过、备份存在 | `apply-CC-cursor-fix.mjs` 的 dry-run 输出全 `[ok]` |
| **C2** | 部署后 `repro-cc-cursor.mjs`（`--lib` 指向 deployed）→ **NO_LOSS** | 复用 §4.2 命令 |
| **C3** | `repro-legacy-migration.mjs`（pass1 旧实现 → pass2 deployed）→ **SELF_HEAL_PASS** | 同上（该脚本的 `FIXED` 常量指向 `libfixed`，**需改指向 deployed 或新增一个 `--fixed` 参数**；这是落地时的一处小改动） |
| **C4** | 真实规模上 `sync_state` 的 `cc:*` 行满足 `last_offset == size`（当前生产 388/388 行是 `size+1`） | 只读查生产 `usage.db` 的 `sync_state` |
| **C5** | 自愈轮的单次 ingest 耗时**偏大**（要把旧游标到文件尾重读一遍），下一轮恢复增量 | 记 `lastIngest` 间隔与 `failedCc`；**不设绝对阈值**（本机非独占） |
| **C6** | `failedCc` 不再随 CC 追加而累加 `unparsable JSON lines` | `/usage/refresh` 前后对比 `failedCc` |

**重启要求：是**（宿主半）。

---

## 5. 执行顺序与批次

### 5.1 批次表

| 批次 | 单元 | 生效方式 | 说明 |
|---|---|---|---|
| **B0（先决，可并行）** | U-IG3（`db.js:rebuildDailyForDays`）、可选 `temp_store=2` 加固 | **需重启** | 与 U-IG1 同文件（`db.js`）→ **必须同一写入者**，见 §5.2 |
| **B1（核心）** | U-IG1.1 新增 `ingest-worker.js`、U-IG1.2 新增 `ingest-runner.js` | 新文件，**写入无冲突** | 可与 B0 并行（不同文件） |
| **B1 同批** | U-IG1.3（`db.js` 导出）、U-IG1.4（`rpc.js`）、U-IG1.5（`db.js` `busy_timeout`）、U-IG1.6（`index.js` 接线） | **需重启** | `db.js` 的两处改动必须与 B0 **同一写入者** |
| **B2（U-IG2）** | timer 注入修复（§1.5） | **需重启** | **硬闸门：B1 验收通过前不得进入** |
| **B3** | U-CC1（`ingest-cc.js` 锚点补丁） | **需重启** | 文件与 B0/B1 不重叠，可并入同一次重启 |
| **热载项（不在本档范围）** | P2 / C2 等热面 | 热载 | 与 ingest 无关 |

### 5.2 写入者边界（避免覆盖与中间态）

| 文件 | 本批涉及的单元 | 建议 |
|---|---|---|
| `dsh-usage/lib/db.js` | U-IG3 + U-IG1.3 + U-IG1.5 | **单一写入者**（三处改动同一次编辑 + 一次 `node --check`） |
| `dsh-usage/lib/index.js` | U-IG1.6 + **U-IG2**（同一文件！） | **同一写入者**；建议 U-IG2 的改动也在同一次补丁里（但**启用时机**由 §5.3 闸门控制——可以用常量开关或分两次提交同一文件） |
| `dsh-usage/lib/rpc.js` | U-IG1.4 | 独立 |
| `dsh-usage/lib/ingest-worker.js` / `ingest-runner.js` | U-IG1.1 / U-IG1.2 | 两个新文件，独立 |
| `dsh-usage/lib/ingest-cc.js` | U-CC1 | 独立 |
| deployed 侧 | **全部 5 个文件都是"独立拷贝"** | **禁止整文件 `cp` 覆盖**（source 与 deployed 不同：`db.js` 21 行差、`index.js` 66 行差、`rpc.js` 24 行差；`rpc.js` 的 register 姿势**完全不同**，见下） |

**⚠ 关键差异警示（实跑 diff）**：deployed 与 source 的 `rpc.js` 在 register 处**是两条不同的 API 路径**：
- source：`ctx.connection.register(ctx, "/usage", handle)`（0.1.5 姿势）
- **deployed：`ctx.connection.rpc.handle("/usage", handle, { authority: "loopback" })`（`rpc.js:225`，0.1.1 姿势）**

**若把 source 的 `rpc.js` 覆盖到 deployed，会立刻打断 `/usage` 路由。** 所有补丁必须走**锚点**。

### 5.3 **"恢复 timer 应被阻止"的判据**（可直接当闸门用）

**在以下任一条件未满足前，不得让 U-IG2 生效：**

| # | 闸门条件 | 判定方式 |
|---|---|---|
| **G1** | **一次完整 ingest pass 期间，宿主事件循环的最大延迟 < 100ms** | `perf_hooks.monitorEventLoopDelay` 采样；**现状对照**：同一 pass 同步执行会产生 2.68s（增量）/ 36.1s（冷）的单次阻塞 |
| **G2** | **并发 10 次 `/usage/refresh` 只触发 1 次 fold** | worker 侧 `start` 消息计数 = 1（U-IG1.4 验收 ①） |
| **G3** | **`status` 在 ingest 期间不等待**（响应时间不随 fold 时长增长） | 对比"空闲时"与"pass 进行中"的 `status` 响应时间 |
| **G4** | **卸载插件后无残留 worker**（否则重启周期性泄漏线程） | U-IG1.6 验收 ④ |
| **G5** | **等价性回归全绿** | `research-v2/ingest-equiv/run-suite.sh` 全绿 |

**若 U-IG1 本轮无法安全完成 ⇒ 明确阻止：**
1. **不修 `timer` 注入**（保持 timer 不触发 = 保持现状的"数据陈旧"）；
2. **不新增任何周期性 ingest 触发**（包括"用 `ctx.inject(['timer'])` 顺手装上"这类"看起来更安全"的写法）；
3. 若必须让数据变新，走**手动 `/usage/refresh`**（现状已可用，代价是单次 2.7s）；
4. 在交付说明里**显式写明**："timer 未修，因为 U-IG1 未过 G1–G5，按铁律阻止"。

**反过来说，长任务无阻塞的判据很具体**：**G1 一条即足以决定"能不能恢复 45s 周期"**——
因为 45s 周期的唯一新增风险就是"每 45s 冻结一次"，而 G1 正是这个风险的直接度量。

### 5.4 重启次数

**建议合并为 1 次重启**（B0+B1+B3 同批），但**必须**在 `node --check` + 锚点唯一性校验 +
`ingest-equiv` 等价回归全绿之后。**U-IG2 不得与"U-IG1 首次落地"同批启用**
（即便同一文件、同一次重启，也要用开关让它**先关着**，等 G1–G5 实测通过再打开）。

---

## 6. 逐条判定表 + 复现

### 6.1 判定表

| # | 检查项 | 判定 | 实跑/推断 |
|---|---|---|---|
| 1 | `cordis-plugin-timer` 在本 profile 被挂载（dsh-base patch `id: timer`），且 profile 无 disable | **PASS** | 读码（真实文件） |
| 2 | 根 ctx 上 `ctx.setInterval` 存在且是真 interval | **PASS** | 实跑（`rootTicks` 递增） |
| 3 | usage 现状 `inject` 缺 `timer` → 7 个 timer 属性**读取即抛** | **PASS** | 实跑（`probe-r5g-guard`） |
| 4 | deployed `index.js:210` 的表达式**原样**必然抛 `cannot get property "timer" without inject` | **PASS** | 实跑（`probe-r5h-fallback`） |
| 5 | 异常使 `ctx.effect` 兜底分支**不可达**（而非"跑了没生效"） | **PASS** | 实跑 + JS 条件表达式语义 |
| 5b | §1.5 的修法形状（`ctx.inject(['timer'], cb)` 内安装）**可用**，且长同步占用后不被回收 | **PASS** | 实跑（`probe-r5i-fix-shape.mjs`：2.5s 内触发 9 次） |
| 6 | 异常被 `index.js:220` 的 `.catch` 吞成 `log.warn`（首扫照常完成，`lastIngest` 仍会被写） | **PASS** | 读码 + 生产观测吻合（timer 不触发但首扫正常） |
| 7 | U-IG3 根因 = DELETE 集合（非连续天）⊊ INSERT 产出集合（连续区间含间隙日） | **PASS** | 实跑（11/11 逐例 + 最小同构必现） |
| 8 | "GROUP BY 键与 UNIQUE 键不一致" 假设 | **否决** | 实跑 + 逻辑（group by 后键唯一） |
| 9 | "NULL 语义" 假设 | **否决** | 实跑（生产 daily 325 行 0 NULL） |
| 10 | "裸 INSERT 未 upsert" 是放大条件而非触发条件 | **PASS** | 实跑（对照：DELETE 覆盖产出时同键重算不冲突） |
| 11 | `unable to open database file` 是**本沙箱 temp-store 约束**，与数据/空库无关 | **PASS（机制）** | 实跑（生产库只读 + `temp_store=2` 判别） |
| 12 | 该 OPEN 错误在生产上是否会发生 | **INCONCLUSIVE** | 无法在非独占机判定 sorter 是否溢出；线上宿主自身查询正常 |
| 13 | 修法 A（区间对齐）与修法 B（UPSERT）都能修掉 UNIQUE，且与全量重算逐行一致 | **PASS** | 实跑（`probe-r6` 的 `B2`/`B3`/`B_equivalence`） |
| 14 | CC 修复在 deployed **未生效**（缺陷仍在） | **PASS** | 实跑（`repro-cc-cursor --tag deployed-verify` → LOSS_CONFIRMED） |
| 15 | CC 修复在 workspace source **有效**（可复现 NO_LOSS） | **PASS** | 实跑（暂存拷贝 `stage-ws` → NO_LOSS） |
| 16 | 遗留 `size+1` 游标能自愈（补回被跳过的记录） | **PASS** | 实跑（`repro-legacy-migration` → SELF_HEAL_PASS） |
| 17 | deployed / source 是**独立拷贝**，且 `rpc.js` 的 register 姿势不同 | **PASS** | 实跑（diff） |
| 18 | 生产 `usage.db` 当前日聚合**无陈旧残留** | **PASS** | 实跑（只读逐键比对 0/0/0） |
| 19 | 生产连接 `busy_timeout = 0`（未设） | **PASS** | 实跑（`PRAGMA busy_timeout` → 0） |
| 20 | worker 化后宿主是否出现长任务（U-IG1 核心验收） | **未测（待落地后测）** | 需实现后才可测 |
| 21 | 45s timer 恢复后的绝对卡顿量级 | **INCONCLUSIVE** | 本机非独占（`MEASUREMENT-STATUS.md §1`） |

### 6.2 与既有档的关系（明确"谁实跑"）

| 结论 | 来源 | 我是否复跑 |
|---|---|---|
| `DatabaseSync` 不可跨线程（DataCloneError） | `ingest-equiv/audit.md` §3.1 | 否（采信） |
| worker 内 invalidate 不穿透宿主缓存 | 同上 §3.3 | 否（采信） |
| 读可见窗口在 RPC 层不可观察（10 项同值） | 同上 §3.2 | 否（采信） |
| 2.682s 增量 / 36.1s 冷摄入 | `ingest-gate/verdict.md` §2 | 否（采信）；我复跑 fold 得到 26.4–33.4s 同量级 |
| 11 UNIQUE + 3 OPEN 分类 | 同上 §3 | **是**（874/875 文件、UNIQUE=11、OPEN=3 完全一致） |
| CC off-by-one 与自愈 | `cc-cursor/audit.md` | **是**（三条复现全部重跑通过） |

### 6.3 复现清单（本档全部产物）

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-audit/ingest

# U-IG2 根因（只读、离线、无副作用）
node probe-r5g-guard.mjs            # inject 缺 timer → 7 属性全抛
node probe-r5h-fallback.mjs         # deployed 表达式原样必抛
node probe-r5i-fix-shape.mjs        # §1.5 修法形状可用性（3s 同步占用后仍触发 9 次）
node probe-r5e.mjs                  # cordis 插件形状/挂起语义校准

# U-IG3 根因与修法（真实 sessions root 只读；库在 ./scratch*）
TZ=Asia/Shanghai node probe-r4-ig3-key.mjs        # 11/11 UNIQUE 的精确冲突键（约 30s）
TZ=Asia/Shanghai node probe-r6-boundary-fix.mjs   # 日界一致性 + 修法 A/B 等价性（约 1min）
node probe-r7-production.mjs                      # 生产库只读：daily↔events 收敛性

# timer 兜底路径（离线组合；按判定该版本只跑到 T1 就在 typeof 处抛错，T2/T3/T4 未执行）
node probe-r5f-timer-final.mjs

# CC 游标（在 research-v2/cc-cursor/ 下）
cd ../../research-v2/cc-cursor
node repro-cc-cursor.mjs --tag deployed-verify                      # LOSS_CONFIRMED
node repro-cc-cursor.mjs --lib ../exec-audit/ingest/stage-ws/lib --tag ws-source-staged  # NO_LOSS
node repro-legacy-migration.mjs                                     # SELF_HEAL_PASS
```

| 产物 | 内容 |
|---|---|
| `probe-r5g-guard.mjs` / `probe-r5h-fallback.mjs` / `probe-r5e.mjs` | U-IG2 根因判别（timer 注入守卫） |
| `probe-r2-ig3.mjs` / `probe-r3-ig3-instrument.mjs` / `probe-r4-ig3-key.mjs` | U-IG3 根因链（含插桩与精确冲突键） |
| `probe-r6-boundary-fix.mjs` | 日界一致性（5480+17520 采样 0 分歧）+ 修法 A/B 等价性 |
| `probe-r7-production.mjs` | 生产库只读分析（daily↔events 收敛、busy_timeout、NULL 变体） |
| `out-r2.json` / `out-r3.json` / `out-r4.json` | 原始对拍 JSON（含 11 例逐例 diag） |
| `stage-ws/` | 仅用于解析依赖的隔离暂存拷贝（未部署） |
| `scratch*/` | 全部临时库（可整体删除） |

---

## 附 A：本轮**实跑**得到的两个额外事实（供协调者决策）

1. **首扫在插件加载后 ~3s 内同步跑完**：`index.js:207` 的 `await runIngest()` 位于 bootstrap
   microtask 中。微任务队列会在事件循环处理 I/O 之前**跑干**，因此这一次 fold（现在约 2.7s；空库/首次约 36s）
   **发生在宿主开始服务请求之前**。这是"启动后立刻卡一下"的一条独立解释，**不依赖 timer**。
   （证据：生产 `lastIngest = 14:37:06`，宿主 PID 1390375 启动于 14:37 —— 相差约 3s。**【推断】**为机制解释，
   【实跑】部分为时间戳对齐。）

2. **`queryHeatmap` 是唯一不 GROUP BY 的端点**（走 `usage_daily` 快路径），
   因此在 §3.4 的 temp-store 约束下**它仍然可用**——这也解释了为什么手写 SQL 里
   "单列 `GROUP BY day` 成功、多列失败"的边界如此清晰。

## 附 B：本档明确**没有**做的事

- 未修改任何产品文件（`dsh-usage/lib/*`、deployed `@local/dsh-usage/lib/*` 均未写入）。
  **自证（实跑）**：两处 lib 目录下 `db.js`/`index.js`/`rpc.js`/`ingest-cc.js` 的 mtime
  全部 ≤ 15:40，而本档工作时段为 16:11–16:28 —— **没有任何一处被本档触碰**。
- 未部署、未重启、未 pkill、未写 `~/.dsh`
  （**只读**：仅以 `DatabaseSync(..., { readOnly: true })` 读过生产 `usage.db`；
  未 VACUUM、未改 PRAGMA、未开写事务）。
- 未在共享 workspace 根目录外创建文件；除 `research-v2/cc-cursor/scratch-*/`（复现脚本自身约定）
  与 `exec-audit/ingest/**` 外无写入。
- 未测量任何"绝对性能"数字作为结论依据（本机非独占）。
