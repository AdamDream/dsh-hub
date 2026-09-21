# ingest 判定与冷/热代价（协调者亲测，2026-09-21 16:04）

## 1. 判定结论：**timer 从未触发；`runIngest` 本身完全正常**（根因已由执行前审计钉死）

> **根因（机制级，非猜测）**：`dsh-usage` 的 `inject` 列表**没有 `"timer"`**，而 `ctx.setInterval` 是 timer 服务的 **mixin accessor**，
> **读取即抛** `cannot get property "timer" without inject`（`cordis/lib/index.js:675/883`）。
> 致命点：`typeof ctx.setInterval === "function"` 这个**探测本身抛异常**（不是返回 false）⇒ 三元表达式的兜底分支
> `ctx.effect(() => setInterval(...))` **语法上不可达**，整个赋值抛出后被 `index.js:220` 的 `.catch` 吞成一行静默 warn。
> **与 B1 的 `ctx is not defined` 同类：死掉的兜底路径。**
> 实跑对照：`inject=["connection","webServer"]`（现状）下 timer 7 个属性**全部抛**；加入 `"timer"` 后全部可用。
> 修法已验证：把安装动作放进 `ctx.inject(["timer"], cb)`（3s 同步占用后仍安装成功、2.5s 内触发 9 次）；**不要保留 `typeof ctx.setInterval` 式探测**。

上一轮遗留的二选一假设（① timer 没装成／② timer 在跑但 `runIngest` 每轮抛错）现已判定为 **①**。

| 步骤 | 观测 |
|---|---|
| 前置 | `lastIngest = 14:37:06`、`eventsDsh = 89394`、`scannedDsh = 61`、`failedDsh = 0`（自宿主 14:37:03 启动起冻结 ≈88 分钟，跨 ≈117 个 45s 周期） |
| 调 `/usage/refresh`（**直接调用 `runIngest`，不经 timer**） | HTTP 200、`result.ok=true`、**墙钟 2.682 s** |
| 触发后 | `lastIngest = 16:04:54`、`eventsDsh = 92889`（**+3495**）、`scannedDsh = 50`、`failedDsh = 1` |

⇒ `runIngest` 能正常扫描并摄入（50 文件 / 3495 事件）；冻结的唯一解释是 **45s timer 没有被安装**。
⇒ 也说明：**当前"timer 不跑"这个缺陷正在保护交互**（见 §2）。

### 1.1 独立于 timer 的第二条启动卡顿解释
`index.js:207` 的 `await runIngest()` 位于 bootstrap microtask 中，**微任务先于 I/O 服务跑干** ⇒ 那一次 fold（现约 2.7s，空库 36s）
**发生在宿主开始服务请求之前**。这是"启动后立刻卡一下"的独立解释，**不依赖 timer**（证据：`lastIngest=14:37:06` 与宿主 14:37 启动对齐）。

## 2. 代价量级（决定"能不能简单修 timer"）

| 场景 | 宿主同步阻塞 | 依据 |
|---|---|---|
| 增量（少量 dirty 文件） | **2.682 s** | 本次 refresh 实测 |
| **全量冷摄入**（空库、871 文件、53,488 事件） | **36.1 s** | 协调者用真实 `foldDshSource` + 真实 sessions root + 临时库实测 |

**结论（必须写进任何修复方案）**：`runIngest` 内部是**同步 fold**（另一线已核实 `index.js:115–143` 函数体内 0 个 `await`）。
因此——

> **不得只修 timer。** 若把 45s 周期修好而不先 worker 化（或显著降低单轮成本），就会变成 **每 45 秒冻 2.7 秒**（冷启动甚至数十秒），把现在的"数据陈旧"换成"周期性卡死"。

## 3. 附带发现的真实缺陷：`daily rebuild` 重复键

用真实 `foldDshSource` 在**空库**上跑真实 sessions root：`failedFiles = 13`，其中 **11 例**为

```
daily rebuild: UNIQUE constraint failed: usage_daily.day, usage_daily.data_source, usage_daily.model, usage_daily.project
```

生产上一轮 refresh 也报 `failedDsh = 1` ⇒ **可复现、非本档环境假象**。
另 **3 例** `daily rebuild: unable to open database file` 仅见于此空库环境，生产未报 ⇒ **标为环境相关，不声称是生产缺陷**。

影响面（据 ingest 等价线读码）：`usage_daily` **只有 `queryHeatmap` 读**，且仅作快路径门控（`MAX(day)` 为 null 时整窗回落 raw-events 精确路线）⇒
**不产生错数字，但会让日聚合长期陈旧、并使快路径失效**。

**待查**：`rebuildDailyForDays` 的写入口是否用 upsert（`ON CONFLICT ... DO UPDATE`）而非裸 INSERT；以及重复键是否由"聚合查询的 GROUP BY 键与表 UNIQUE 键不一致"或 NULL 语义差异造成。

## 4. 对"用户可感卡顿"的意义

若用户所说的"卡"包含**界面整段冻住**，那么候选源现已有三个量级匹配的：
1. 冷摄入 **36 s**（启动/首次使用时最明显）；
2. 增量摄入 **2.7 s**（每次触发一次）；
3. **并发负载下的宿主 RPC 停顿**（R4 实效线曾测 status 11.06 s / summary 8.19 s / session.list 9.80 s，但那些在 4–6 并发浏览器下采集，需 M7 干净复测才能定性）。

客户端渲染侧（62 fiber/commit、266–281 fiber/commit）**在量级上无法解释秒级冻结**。

## 5. 修复合集（按依赖排序，待批准）

| 单元 | 内容 | 依赖 |
|---|---|---|
| U-CC1 | CC 游标 off-by-one 修复（已就绪、已行为验证） | 需重启 |
| U-IG1 | **先把 ingest 移出宿主主线程或显著降本**（worker / 单飞 / 增量） | **U-IG1 必须先于 U-IG2** |
| U-IG2 | 修 45s timer 未触发（诊断"未安装"还是"未调度"，含 `ctx.setInterval` 可用性与 `ctx.effect` 抛错路径） | 依赖 U-IG1 |
| U-IG3 | 修 `rebuildDailyForDays` 重复键（upsert 或对齐 GROUP BY 键） | 独立 |
| U-B1 | B1 冷排序（无 `updatedAt` → NaN）+ running 计数双通道 | 需重启 |
| U-P2 | P2 address-chain 残留（两处同修） | 热面 |
| U-C2 | C2 投影签名门闸（可选小项，2.6→0.6 ms/s） | 热面 |

> 顺序铁律：**U-IG1 未完成前不得启用 U-IG2**，否则把"数据陈旧"换成"每 45s 冻 2.7s"。
