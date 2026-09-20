# 设置界面卡顿根因诊断报告（定稿）

**对象**：DSH Web GUI（http://127.0.0.1:3080，宿主 PID 20806）
**症状**：打开设置界面后卡顿迟缓严重
**方法**：Playwright 无头实测（rAF 帧间隔 / CDP Performance / CDP CPU Profiler）+ 三条并行独立审计线（客户端渲染 / 服务端接口 / 数据存储）+ 微观基准
**版本**：v2 —— 三线交叉核对后修订（v1 的两处结论已按实测否证/细化，见 §5）

---

## 0. 结论：两条独立机制叠加

| | 机制 | 触发条件 | 量级 | 性质 |
|---|---|---|---|---|
| **M1** | **宿主用同步 SQLite 在主线程跑 usage 查询** | 进过「设置 → 插件」标签后 | 单次冻结宿主 **0.30~0.48s**，此后每 **30s** 复发 | 条件触发，但一旦触发就是"严重卡顿"的直接来源 |
| **M2** | **客户端会话列表 churn（O(N²) 重建 + 每次新引用整树重渲染）** | 始终（有会话事件流时） | 常态 **121ms/s** 主线程脚本；设置页打开 **190ms/s（+57%）**，>50ms 卡顿帧 **+82%** | 常态持续；**设置页是放大器，不是源头** |

**对"为什么打开设置就卡"的直接回答**：M2 让 GUI 本来就一直在顿（每秒 1~2 次 100ms+ 卡顿），打开设置后设置面板**没有 memo 边界**、跟着会话列表的整树重渲染一起跑，负载再涨 57%；如果你进过「插件」标签（usage 卡片一旦挂载就不卸载），M1 还会把宿主事件循环整个冻住 0.3~0.5 秒——那一下是"严重"的来源。

---

## 1. 实测数据

### 1.1 M1（宿主侧同步 SQLite）—— 本代理独立复测

进入「设置 → 插件」标签时的 `/usage/*` 请求（实测）：

| 端点 | 耗时 |
|---|---|
| `/usage/byProject` | **498.5 / 449.4 / 387.6 ms** |
| `/usage/byModel` | **477.1 / 432.3 / 371.9 ms** |
| `/usage/byDay` | **475.2 / 96.9 / 48.2 ms** |
| `/usage/heatmap` | **414.2 / 405.9 ms** |
| `/usage/timeseries` | **397.0 / 336.8 / 105.7 / 65.1 / 56.2 ms** |
| `/usage/sessions` | **337.8 / 84.0 ms** |
| `/usage/status` | 75.5 / 72.9 ms |
| `/usage/summary` | 16.8 / 13.9 ms |

单轮 **9~13 个请求**，多数在 300~500ms。

**宿主事件循环停顿（并发探针 `/api/host.describe`，基线中位数 2.1ms）**：

| 条件 | 中位数 | p95 | 最大 | >100ms 停顿 |
|---|---|---|---|---|
| 未进插件标签（150s，设置全程关闭） | 1.9 ms | 3.1 ms | **7.9 ms** | **0 次** |
| 进插件标签后 45s | 2.1 ms | 4.2 ms | **476.5 ms** | **2 次（476.5 / 297.5 ms）** |

即：正常情况下宿主 2ms 内响应，**开启 usage 卡片后整段事件循环被同步 SQLite 冻住 0.3~0.5 秒**，期间所有 API 与事件推送一起停摆。

### 1.2 M2（客户端会话列表 churn）

| 阶段（各 20s 窗口） | Script | Task | RecalcStyle | 帧 p50 | 帧 p99 | >50ms 帧 |
|---|---|---|---|---|---|---|
| 主界面空闲 | 2428 ms | 3087 ms | 419 ms | 16.7 ms | 100.1 ms | 22 |
| 打开设置 | 2550 ms | 3460 ms | 647 ms | 16.7 ms | 116.6 ms | 26 |
| 设置页停留 | **3795 ms** | **4898 ms** | **857 ms** | 16.7 ms | 116.7 ms | **40** |

规模与触发频率：

| 观测 | 数值 |
|---|---|
| 磁盘会话总数 | 2367 |
| `/api/session.list` 单次返回 | **2361 条 / 3,763,290 字节** |
| WebSocket 速率 | **73 帧/s**（其中 `session/event` **1309 帧/20s ≈ 65/s**） |
| CPU profile 非 idle 第一名 | **`buildListSnapshot` 9.2%**（约占全部非空闲工作 28%） |
| 第二名 | `layout apply` 5.0%；`notifier` 2.3%；第三方插件 `remoteSessionIndex` 0.6% + `sessions()` 0.38%；GC 0.41% |

微观基准（复刻真实代码，N=2361）：

```
O(N²) 清理（现状）      = 5.66 ms/次     ← 占单次 6ms 重建的 94%
换 Set（修复后）        = 0.090 ms/次    → 63x
第三方插件 sessions()   = 0.21 ms/次
单次重建合计            ≈ 5.94 ms
```

### 1.3 已排除：设置页自身的服务端接口与页面逻辑

| 观测 | 结果 |
|---|---|
| `settings.describe` | **2.8 ms / 43.5 KB** |
| `pluginInventory/list` | 3.8 ms（读 Cordis 内存表，**不扫 node_modules**） |
| `llm.providers` / `llm.models` | 1~2 ms |
| 设置面板子树 DOM 变更（活跃/安静两态，两次独立观测） | **0 次** |
| 设置插件内 `setInterval` / `rAF` / `Observer` / `localStorage` | 全 0 命中 |
| 设置默认视图规模 | 3 个 provider 行、编辑器折叠 = **20 元素**（截图证实） |

**客户端 A/B 实测（安静态，同一页面 4×12s 窗口）**：

| 窗口 | script | >50ms 帧 | 最大帧 | 面板 DOM 变更 |
|---|---|---|---|---|
| 设置关闭 | 326 ms | 2 | 100 ms | — |
| 打开·通用 | 264 ms | 3 | 116.7 ms | **0** |
| 打开·模型 | **9 ms** | **0** | 16.8 ms | **0** |

→ 安静态下打开设置**反而更省**。设置面板逻辑本身不是热源；1.2 节里"打开设置变卡"是**活跃事件流 + 无 memo 面板被动跟随重渲染**的结果。

---

## 2. 机制与代码位置

### 2.1 M1：同步 SQLite 阻塞宿主主线程

- 卡片注册：`@local/dsh-usage/lib/client.js:1130` → `settings.plugin.item`（key=`dsh-usage`）
- 轮询：`@local/dsh-usage/lib/client.js:889`
  ```js
  const timer = setInterval(() => void loadAll(), refreshSec * 1000);   // 30s
  ```
- 查询非 sargable：`@local/dsh-usage/lib/db.js:307`
  ```js
  const DAY_SQL = "strftime('%Y-%m-%d', ts / 1000, 'unixepoch', 'localtime')";
  ```
  → `queryHeatmap`（`db.js:431,441`）**全表 SCAN `usage_events` 104,907 行**，每行算两次 `strftime`（`EXPLAIN QUERY PLAN` 已证），单轮 `loadAll()` 实测 356.0ms（heatmap 占 273.2ms）。
- 执行方式：`node:sqlite` 的 **`DatabaseSync`（同步 API）**，直接跑在宿主主线程 → 事件循环整段冻结。
- **库里本来就有预聚合表**：`db.js:125` `usage_daily`（296 行，聚合实测 **0.03ms**），并有 `db.js:217-251` 的 recompute 机制维护它——**热路径却没走它**。
- 卡片受"访问过才挂载"门控：`dsh-client-ui-settings-plugins/lib/client.js:489`；已访问的 tab 永不卸载（面板仅 `hidden`），所以一旦进过「插件」，30s 冻结就持续存在。

### 2.2 M2：会话列表 churn

- 驱动：`session/projection` 帧 → `dsh-client-runtime/lib/client.js:8302` → notifier `:7844`
  ```js
  notifier = new Notifier(() => { this.listSnapshotCache = this.buildListSnapshot(); });
  ```
  流式期间 `Notifier.markFrameDirty()` **每帧最多重建一次**（`client.js:5639` 起）。
- 重建里的 O(N²)：`dsh-client-runtime/lib/client.js:8576`
  ```js
  for (const id of this.entryCache.keys())
      if (!items.some((e) => e.sessionId === id)) this.entryCache.delete(id);
  ```
- 新引用风暴：`dsh-client-runtime/lib/client.js:9217` `projectList()` → `:9274 this.list.set({ ids, byId, ... })` **每次重建全新引用** → 依赖它的整棵子树重渲染。
- `flattenLineage`（`:5602`）每次重建为 2361 条各展开一个对象 → 分配压力（GC 0.41%）。
- 同性质隐患：`:8595` 起 `applyMutation` 的 upsert 用 `summaries.find(...)`（每次 O(N)），而 upsert 是高频路径。
- 第三方插件叠加：`dsh-workspace-enhancement/lib/client.js:5417` 的 `sessions()` 每次调用 `Object.values(state.byId).map(...)` **全量重建 2361 个对象**；`:4108` `remoteSessionIndex` 全量遍历 + 内层 `ids.filter((id,i) => ids.indexOf(id) === i)`（O(k²) 去重）。
- **设置页为何被卷进来**：`dsh-client-ui-settings-general/lib/client.js:188` 订阅 → `:213` 创建**无 memo** 的 `SettingsPanel` → `:164` `renderSlot(..., { only: active })`；renderer 同样无 memo（`dsh-client-ui-renderer/lib/client.js:628,741-750`）。全文件 `memo(` 命中 **0**。设置面板因此被动跟随每一次列表 churn 重新渲染（它自身 0 DOM 变更）。
- 乘数：模型页 `dsh-client-ui-settings-models/lib/client.js:896-991` `models.map(...)` 全量实例化、无虚拟化（实测 300 模型 = 3023 元素 / 6.13ms）。

---

## 3. 修复建议（按性价比）

| # | 措施 | 位置 | 预期收益 | 风险/成本 |
|---|---|---|---|---|
| **1** | **heatmap/day 查询改 sargable（`ts BETWEEN ? AND ?`）或直接读 `usage_daily`** | `@local/dsh-usage/lib/db.js:307,431,441`（本地插件） | 356ms → **个位数 ms**，宿主 0.3~0.5s 冻结消失 | 低；需保证 `usage_daily` 与热路径一致性 |
| **2** | **去掉/延长 30s 轮询，或仅在卡片可见时拉取** | `@local/dsh-usage/lib/client.js:889` | 消除"每 30s 冻一次" | 低；只是刷新频率 |
| 3 | O(N²) 清理改 `Set` | `dsh-client-runtime/lib/client.js:8576`（官方包） | 单次重建 5.66ms → 0.09ms（**63x**） | 需重建 web 产物；评估与上游升级冲突 |
| 4 | `projectList`/`list.set` 引用稳定化或增量更新 | `dsh-client-runtime/lib/client.js:9217,9274` | 砍掉整树重渲染的主因 | 中；触及运行时数据流设计 |
| 5 | 设置面板加 memo 边界 + 模型列表虚拟化 | `dsh-client-ui-settings-general:213`、`-settings-models:896` | 设置页不再被 churn 卷动 | 中；官方包 |
| 6 | `applyMutation` 的 `find` 改 `Map` 索引 | `dsh-client-runtime/lib/client.js:8595` | 高频 upsert O(N)→O(1) | 低 |
| 7 | 第三方插件 `sessions()` 加缓存、`remoteSessionIndex` 去重改 Set | `dsh-workspace-enhancement/lib/client.js:4107,5417` | 每次重建省 0.2~0.8ms | 低；本地插件 |
| **8** | **清理/归档历史会话，把 N 从 2361 降到几百** | 用户数据 | O(N²) 按平方下降：2361→500 约 **22 倍** | **动用户数据，需明确授权** |

**1、2、7、8 不需要改官方包**，见效最快。3~6 属官方包补丁，须评估重建与升级冲突。

---

## 4. 复现命令

```bash
cd /home/CNS2026495165/dsh/.workspace/settings-lag

node measure3.mjs     # 空闲/打开/停留 各 20s 对比 + session.list 规模 + API 计数（~80s）
node measure5.mjs     # WebSocket 事件速率（~30s）
node measure7.mjs     # /usage/* 逐个耗时 + 宿主延迟停顿（~60s）
node measure8.mjs     # usage 卡片挂载门控与离开标签后的行为（~120s）
node measure9.mjs     # 150s 宿主延迟基线（用作 M1 对照）
node measure2.mjs     # 打开设置的 CPU profile 热点 + 逐标签页开销（~60s）
node /tmp/bench2.mjs  # O(N^2) 现状 vs Set 修复的微观基准
```

全部为**只读观测**：只加载首页、点开设置/标签、采集指标；不写任何数据与配置，不重启宿主。

---

## 5. 被否证与未证实的说法（诚实声明）

| 说法 | 裁定 | 依据 |
|---|---|---|
| "45s 同步 ingest（`zstdDecompressSync` + 逐行 JSON.parse）阻塞宿主 924ms" | **未在运行宿主上复现** | `measure9.mjs`：150s（≈3 个 45s 周期）、设置全程关闭，宿主延迟 中位数 1.9ms / p99 6.8ms / **最大 7.9ms / >100ms 停顿 0 次**。该 924ms 是审计对**代码路径的独立测量**，非活动宿主的实测停顿，故不作为成因 |
| "打开设置触发设置面板重渲染，是卡顿来源" | **细化（v1 结论修正）** | 安静态 A/B：打开设置 264ms vs 关闭 326ms，面板子树 **0 次 DOM 变更** → 面板逻辑不是热源，是**无 memo 的被动放大器** |
| "sessions/ 1.2G、skills/ 116M、profiles/ 424M 体积导致卡顿" | **否证** | 均不在设置页读取路径上：默认标签零磁盘读（`settings.describe` 2.8ms）；skills 全量枚举 45ms 且无 settings 槽；sessions 唯一遍历者 45s ingest 实测 30.9ms |
| "`session_projcache.json` 8.71MB 解析慢" | **否证为成因** | 仅启动时解析一次（42.5ms），此后常驻内存 Map，零 I/O |
| 服务端常规接口慢 | **否证** | 全部 ≤4ms |

---

## 6. 结论边界

- 全部数字来自**无头 chromium**；真实浏览器（扩展、更高 DPI、更多标签页）通常更差。
- M2 的常态负载是在**本会话/子代理活跃、WS 73 帧/s** 条件下测得；系统完全静默时基线会低于 121ms/s，但"设置页被 churn 卷动"的结构性问题与 N 的平方关系不变。
- M1 的冻结时长随 `usage_events` 行数增长（全表扫），当前 104,907 行 → 0.3~0.5s。
- `Notifier`"每帧重建"由源码确定；**实际每帧是否都重建未直接计数**（无法在不改代码前提下 hook 闭包），结论由"65 事件/s × 每帧批量上限 × 单次 6ms"与实测 121~190ms/s 相互印证。

---

## 7. 证据文件

| 文件 | 内容 |
|---|---|
| `measure.json` / `measure2.json` | 三阶段帧对比；打开设置的 CPU profile 热点 + 逐标签页开销 |
| `measure3.json` | 空闲 vs 打开 vs 停留（各 20s）、session.list 规模、API 计数 |
| `measure5.json` | WebSocket 帧速率与事件类型分布 |
| `measure6.json` / `measure7.json` | 宿主侧阻塞验证；`/usage/*` 逐个耗时 + 停顿 |
| `measure8.json` | usage 卡片"访问过才挂载"门控 + 离开标签后的行为 |
| `measure9.json` | 150s 宿主延迟基线（否证 ingest 阻塞） |
| `shot-1-main.png` ~ `shot-4-tabs.png` | 界面截图 |
| `audit-client.md` | 客户端渲染路径审计（含安静态 A/B 否证） |
| `audit-server.md` | 服务端接口与 usage 端点审计 |
| `audit-data.md` | 数据体量与 SQLite 审计（604 行，含复现命令） |
