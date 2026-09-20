# dsh-usage 「趋势图改按小时平滑曲线」审计报告

- 审计类型：只读代码审计（未修改任何被审文件）
- 审计对象：`@local/dsh-usage` v0.1.0
- 审计日期：2026-09-18
- 证据基线：部署位 `~/.dsh/profiles/node_modules/@local/dsh-usage/`（运行态权威）+ 工作区源码副本 `/home/CNS2026495165/dsh/.workspace/dsh-usage-src/` + 真实库 `~/.dsh/storages/usage/usage.db`

---

## 一句话结论

**可行，且改动面不大**：数据侧 `usage_events` 表存的是**原始毫秒时间戳**（`ts INTEGER NOT NULL`），按小时重分桶只需改 1 行 SQL 和 1 处 RPC 白名单；真正的工作量在客户端——当前折线是**直连 polyline**（无任何平滑代码，需新写路径生成函数）、X 轴标签取 `day.slice(5)`（小时会退化成"日"）、且**存在小时空洞必须补零**；配色侧发现一处**现存缺陷**：趋势图用的 `--dsw-state-business-primary/secondary` 两个 token 在 DSH 全树**从未定义**（正确的是 `--dsw-alias-state-business-primary`）。

## 改动面清单

| # | 文件 | 位置 | 大致行数 | 冷面/热面 |
|---|---|---|---|---|
| 1 | `lib/rpc.js` | :54 `GRANULARITIES`、:138-143 校验 | +2 / 改 1 | **冷面（需重启宿主）** |
| 2 | `lib/db.js` | :307 `DAY_SQL` 旁增 `HOUR_SQL`；:386-407 `queryTimeseries` 按 granularity 分支 | +8~12 | **冷面（需重启宿主）** |
| 3 | `lib/client.js` | :271-283 增小时粒度选项；:497-529 载荷 `granularity` | +6~10 | 热面（刷新浏览器） |
| 4 | `lib/client.js` | :157-167 `scaleArea`（补零/标签/ts） | +10~16 | 热面 |
| 5 | `lib/client.js` | 新增 `smoothPath()` 平滑曲线生成 | +25~40 | 热面 |
| 6 | `lib/client.js` | :330-341 面积分支改用 smoothPath + 新配色 | 改 4~6 | 热面 |
| 7 | `lib/client.js` | :16 CSS 增 `--du-trend-line/-fill` 变量（亮/暗两套） | +2~4 | 热面 |
| 8 | `lib/charts.js` | 同步 #4/#5（`charts.js 内联` 约定要求逐字一致） | 同 #4/#5 | 源码侧，运行时不读 |
| 9 | `lib/index.js` | :39-68（可选）增 `trend.granularity` 开关 | +6 | **冷面（需重启宿主）** |

**冷面合计约 30 行**（rpc.js + db.js，必须重启宿主）；**热面约 50~70 行**（client.js / charts.js，刷新即生效）。

---

## 1. 图表清单与实现方式

**全部自绘 SVG，零第三方图表库，无构建产物。三张图没有各自的独立文件——趋势图（面积/柱状）与热力图都在 `lib/client.js` 里，几何计算在 `lib/charts.js`。**

### 1.1 反证「引库」：显式声明零依赖
`lib/charts.js:1-10`：
```js
//#region lib/charts.js
/**
 * Pure SVG geometry generators for the dsh-usage card (AUDIT U10, A5 decision:
 * 零新增依赖、自绘 SVG — no echarts). Every function is dependency-free and
 * returns plain structures directly consumable by `React.createElement('svg',
 * …)` — the client bundle inlines these bodies verbatim (build-free bundle,
 * see the `charts.js 内联` marker in lib/client.js); this file is the
 * source of truth and stays `node --check`-able on its own.
 * @module dsh-usage/charts
 */
```
`lib/client.js:26`：
```js
//#region charts.js 内联 (build-free inline of lib/charts.js — keep in sync)
```
→ **代码确证**：三图渲染技术 = 手写 SVG path/rect + `react.createElement`，无 canvas、无 echarts。

### 1.2 趋势图（面积图）——用户要改的那张
`lib/client.js:303-341`，函数名 **`TrendChart`**（303 行起，到 365 行止，**共 63 行**）：
```js
303: function TrendChart(props) {
304: 	const series = (props.rows || []).map((r) => ({ day: r.day, value: bucketValue(r, props.bucket) }));
305: 	const w = 560;
306: 	const h = 150;
...
319: 	if (props.mode === "bar") {
...
330: 	} else {
331: 		const scaled = scaleArea(series, w, h);
332: 		const geom = areaPath(scaled.points, w, h);
...
337: 		children.push(react.createElement("path", { d: geom.area, fill: "var(--dsw-state-business-secondary)", opacity: 0.35 }));
338: 		children.push(react.createElement("path", { d: geom.line, fill: "none", stroke: "var(--dsw-state-business-primary)", strokeWidth: 2 }));
339: 		children.push(react.createElement("g", { fill: "var(--dsw-alias-label-caption)", fontSize: 9, textAnchor: "middle" },
340: 			scaled.ticks.map((t) => react.createElement("text", { key: "t" + t.x, x: t.x, y: h - 2 }, t.label))));
341: 	}
```
面积图与柱状图是**同一个组件内的 mode 分支**（`props.mode === "bar"` vs `else`），模式由页面下拉框驱动（`lib/client.js:705-707`）：
```js
705: react.createElement("select", { className: "du_select", value: chartMode, onChange: (e) => setChartMode(e.target.value) },
706: 	react.createElement("option", { value: "area" }, "面积图"),
707: 	react.createElement("option", { value: "bar" }, "柱状图"))),
```

支撑该分支的两个几何函数：
- `scaleArea` — **`lib/client.js:157-167`（11 行）**，`lib/charts.js:227-242`
- `areaPath` — **`lib/client.js:50-56`**，`lib/charts.js:20-28`

### 1.3 柱状图
`lib/client.js:319-329`（`TrendChart` 内 bar 分支），几何为 `scaleBars`（`lib/client.js:142-156`；`lib/charts.js:194-215`）+ `barRects`（`lib/client.js:57` 起；`lib/charts.js:42-53`）：
```js
326: children.push(react.createElement("g", { fill: "var(--dsw-state-business-primary)" },
327: 	rects.map((r) => react.createElement("rect", { key: r.x + "-" + r.y, x: r.x, y: r.y, width: r.width, height: r.height, rx: 1 }))));
```

### 1.4 热力图
函数名 **`HeatmapChart`**，`lib/client.js:366-433+`，几何 `heatmapGrid`（`lib/client.js:69` 起；`lib/charts.js:78-155`）。面板挂载点在 `lib/client.js:709-711`：
```js
709: react.createElement("div", { className: "du_panel" },
710: 	react.createElement("div", { className: "du_panelTitle" }, "热力图（按日总量）"),
711: 	react.createElement(HeatmapChart, { days: heatmap, tooltip: settings.ui.tooltip, peakRing: …, levels: settings.heatmap.levels })),
```
趋势图面板挂载点 `lib/client.js:700-708`（面题"趋势"）。

**结论**：三张图 = 1 个趋势组件（双模式）+ 1 个热力图组件 + 6 个纯几何函数，全部手写 SVG。**代码确证。**

---

## 2. 数据来源与粒度（关键）

### 2.1 数据源链路（代码确证）
```
ingest-dsh / ingest-cc  →  SQLite usage_events（原始 ts 毫秒）
                              ↓ 读时聚合（NOT 查 usage_daily）
        queryTimeseries  →  /usage RPC "timeseries"  →  client TrendChart
```
客户端经 `ctx.connection.rpc.call` 走 `/usage` 通道（`lib/client.js:504-511`）：
```js
504: const calls = await Promise.all([
505: 	rpc.call(CHANNEL, "summary", payload),
506: 	rpc.call(CHANNEL, "timeseries", Object.assign({ granularity: "day" }, payload)),
...
511: ]);
```
数据库真实位置：`~/.dsh/storages/usage/usage.db`（34.5 MB + WAL，`~/.dsh/storages/usage/usage.db-shm/-wal`）。路径解析见 `lib/db.js:31-34` 的 fallback chain。

### 2.2 关键结论：**只有「天」桶是现成的；但原始时间戳完整存在，小时桶可随时重算**

**（a）原始表存毫秒时间戳 —— 代码确证**
`lib/db.js:104-122`：
```sql
CREATE TABLE IF NOT EXISTS usage_events (
  id INTEGER PRIMARY KEY,
  data_source TEXT NOT NULL,
  session_id TEXT NOT NULL,
  dedup_key TEXT NOT NULL,
  ts INTEGER NOT NULL,
  ...
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  UNIQUE(data_source, session_id, dedup_key)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_events_ts ON usage_events(ts);
```

**（b）聚合表只有天粒度 —— 代码确证**
`lib/db.js:126-135`：
```sql
CREATE TABLE IF NOT EXISTS usage_daily (
  day TEXT NOT NULL,
  data_source TEXT NOT NULL,
  model TEXT,
  project TEXT,
  requests INTEGER NOT NULL,
  ...
  PRIMARY KEY(day, data_source, model, project)
) STRICT;
```
折天 SQL 见 `lib/db.js:231`（`strftime('%Y-%m-%d', ts / 1000, 'unixepoch', 'localtime') AS day`）。

**（c）但读路径根本不查 `usage_daily`** —— `queryTimeseries` 直接从 `usage_events` 现算，`lib/db.js:388-398`：
```js
389: .prepare(`
390: SELECT ${DAY_SQL} AS day,
391:        COUNT(*) AS requests,
...
396: FROM usage_events ${clause}
397: GROUP BY day ORDER BY day`)
```
`DAY_SQL` 定义 `lib/db.js:307`：
```js
307: const DAY_SQL = "strftime('%Y-%m-%d', ts / 1000, 'unixepoch', 'localtime')";
```
→ **无按天 memo、无物化读缓存挡住小时粒度**：改 SQL 即刻生效，零回填、零迁移。

**（d）RPC 只白名单了 day —— 代码确证**
`lib/rpc.js:53-54`：
```js
53: /** `timeseries` granularity whitelist — v1 supports day-only. */
54: const GRANULARITIES = new Set(["day"]);
```
`lib/rpc.js:138-143`：
```js
138: if (endpoint === "timeseries") {
139: 	const granularity = payload.granularity === undefined ? "day" : payload.granularity;
140: 	if (typeof granularity !== "string" || !GRANULARITIES.has(granularity)) {
141: 		throw new UsageRpcError("invalid-params", `usage: granularity must be one of [${[...GRANULARITIES].join(",")}]`);
142: 	}
143: }
```

### 2.3 真实库采样（只读、聚合查询，未 dump 全表）

样本命令：`node -e` + `new DatabaseSync(path, { readOnly: true })`，只跑 `COUNT/MIN/MAX/GROUP BY`。

```
== usage_events ==
{"n":99405,"mn":1786355401092,"mx":1789643479950,"days":30,"hours":297}

== 最近 4 条事件（示例记录，metadata + token 字段） ==
{ "data_source":"dsh",
  "session_id":"session-6b9b6c3f-6ed5-4063-9122-c219be7afa16",
  "dedup_key":"t94:s5",
  "ts":1789643479950,
  "local_dt":"2026-09-17 19:11:19",
  "model":"deepseek-v4.1-flash",
  "project":"/home/CNS2026495165/Dexterous_Hand_23Dof",
  "turn":94,"step":5,
  "input_tokens":210,"output_tokens":1728,
  "cache_read_tokens":533120,"cache_write_tokens":0 }

== usage_daily ==
{"n":287,"mn":"2026-08-10","mx":"2026-09-17","days":30}

== 现成的 timeseries（day）结果（近 8 天） ==
[{"day":"2026-09-17","requests":3337,"total":502207707},
 {"day":"2026-09-16","requests":3826,"total":661305581},
 {"day":"2026-09-15","requests":5587,"total":1068945563},
 {"day":"2026-09-14","requests":6679,"total":890340253},
 {"day":"2026-09-12","requests":10028,"total":1433164245},
 {"day":"2026-09-11","requests":5551,"total":654036365},
 {"day":"2026-09-09","requests":165,"total":21352428},
 {"day":"2026-09-08","requests":4692,"total":628169761}]

== 试算小时桶（同一条 SQL 换格式串，近 8 小时） ==
[{"hour":"2026-09-17 19","requests":40,"total":9246038},
 {"hour":"2026-09-17 18","requests":812,"total":129975096},
 {"hour":"2026-09-17 17","requests":827,"total":94751397},
 {"hour":"2026-09-17 16","requests":464,"total":58645851},
 {"hour":"2026-09-17 15","requests":278,"total":44645676},
 {"hour":"2026-09-17 14","requests":188,"total":41890674},
 {"hour":"2026-09-17 13","requests":480,"total":61294700},
 {"hour":"2026-09-17 11","requests":57,"total":9578439}]

== data_source 分布 ==
[{"data_source":"cc","n":22700},{"data_source":"dsh","n":76705}]
```

**可重新分桶的字段路径（确切）**：
`usage_events.ts`（INTEGER，Unix **毫秒**）→ SQL 侧 `strftime('%Y-%m-%d %H', ts/1000, 'unixepoch', 'localtime')` 得到本地小时桶键。**已实测可跑通并出数据。**

**两个重要副产物（推断，基于上述采样，非代码断言）**：
1. **30 天只有 297 个非空小时**（理论上限约 720）→ 大量小时空洞。看上面小时列表：`12` 点整段缺失，`10` 点也缺。**小时桶必须补零**，否则 x 轴被压缩、曲线失真。
2. 天桶里 `2026-09-10`、`2026-09-13` 整天缺失（列表从 09-11 直接跳到 09-12）→ 现网已有"天级空洞"，当前折线是把这些天**直接跳过的**（同第 6 条风险项）。

### 2.4 结论
> **数据粒度：现存字段为「天」（`usage_daily` 表 + `DAY_SQL` 查询），但底层 `usage_events.ts` 是原始毫秒时间戳，小时粒度可随时现算，无需回填或迁移。**

---

## 3. 改成"按小时"的可行性与改动面

### 3.1 需要改的四处（逐条给出精确落点）

| 层 | 文件:行号 | 现状原文 | 改动 |
|---|---|---|---|
| RPC 白名单 | `lib/rpc.js:54` | `const GRANULARITIES = new Set(["day"]);` | → `new Set(["day", "hour"])`（+1 行） |
| RPC 校验说明 | `lib/rpc.js:53` | `/** `timeseries` granularity whitelist — v1 supports day-only. */` | 注释更新（+1 行） |
| 宿主聚合 | `lib/db.js:307` | `const DAY_SQL = "strftime('%Y-%m-%d', ts / 1000, 'unixepoch', 'localtime')";` | 旁增 `HOUR_SQL`（+1 行） |
| 宿主聚合 | `lib/db.js:386-407` | `export function queryTimeseries(db, filters = {}) { const { clause, values } = eventWhere(filters); return db.prepare(`SELECT ${DAY_SQL} AS day, …`).all(...values).map(…) }` | 按 `filters.granularity` 选 SQL 串并输出 `{hour|day, ts, requests, …}`（+8~12 行） |
| 客户端载荷 | `lib/client.js:506` | `rpc.call(CHANNEL, "timeseries", Object.assign({ granularity: "day" }, payload)),` | 粒度改为状态变量（+3~6 行，含下拉框 + 状态） |
| 类型/契约 | 无独立 `.d.ts` | `grep` 全树未见趋势点的类型定义文件 | **无需改类型定义**；契约靠 JSDoc（`lib/rpc.js:24-26`、`lib/db.js:386` 上方注释） |

**契约变更判定**：**是，前后端必须同时改**，但**不是硬性同步**——`lib/rpc.js:139` 对 `granularity` 缺省即 `"day"`，旧客户端不传该字段仍走今天的路径，**向下兼容**。反之新客户端往旧宿主传 `"hour"` 会得到 `invalid-params`（`lib/rpc.js:141`），需一起部署。**代码确证。**

### 3.2 有无缓存或按天 memo 挡住小时粒度
- **宿主侧：无。** `queryTimeseries` 直查 `usage_events`（`lib/db.js:388-398`），**完全不读 `usage_daily`**。`usage_daily` 只被 `rebuildDailyForDays`/`insertDaily`（`lib/db.js:222-256`）与 `queryByDay`（`lib/db.js:508-520`）使用。→ 改 SQL 即刻生效，**不需要回填历史、不需要改 schema**。
- **客户端侧：无 per-day memo。** 只有 `react.useMemo` 用来算日期区间与载荷（`lib/client.js:489-496`），`timeseries` 状态由 RPC 结果直接 `setTimeseries`（`lib/client.js:514`）。
- **唯一缓存风险点：宿主进程内模块缓存。** `lib/db.js` 是 ESM，改了必须重启宿主（见第 6 节），无热载通道（工作区文档 `.workspace` FEATURE-MAP.md:70 明确记载纯函数热载 B 通道"**尚不可用**"）。

### 3.3 可行性裁决
**可行，且属于本插件已明确预留的方向** —— `lib/rpc.js:53-54` 的 `GRANULARITIES` 白名单与其 "v1 supports day-only" 措辞，表明作者本就是按"将来加粒度"设计的。**代码确证。**

---

## 4. 平滑曲线的落点

### 4.1 现状：**没有任何平滑代码，是纯直连折线**
`lib/charts.js:20-28`（`lib/client.js:50-56` 内联副本同）：
```js
20: export function areaPath(points, w, h, opts = {}) {
21: 	const baseline = Number.isFinite(opts.baseline) ? opts.baseline : h;
22: 	if (!Array.isArray(points) || points.length === 0) {
23: 		return { line: "", area: "", w, h };
24: 	}
25: 	const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
26: 	const area = `${line} L${points[points.length - 1].x},${baseline} L${points[0].x},${baseline} Z`;
27: 	return { line, area, w, h };
28: }
```
→ 路径只含 `M`/`L` 指令（第 25 行），**零 `C`/`Q` 贝塞尔指令、无 Catmull-Rom、无单调插值**。**代码确证：必须新写路径生成函数，没有现成平滑代码可复用。**

**可复用的部分**：`areaPath` 的**面积闭合套路**（第 26 行：折线 → 末端下探 baseline → 首端折回 → `Z`）可以原样沿用，只需把 `line` 换成平滑后的 `C` 串——即新函数只需产出 `d` 字符串的曲线段，面积拼装逻辑不变。

### 4.2 需要引入什么
推荐 **monotone cubic（Fritsch–Carlson）+ 转三次贝塞尔**，或 **Catmull-Rom → 贝塞尔**（`C` 指令，控制点 = `P1 + (P2-P0)/6*tension`）。二者都是纯函数、约 25~40 行，符合"零新增依赖"（`lib/charts.js:3-5` 的 A5 决策）。

**必须选单调版本的理由（推断，有数据支撑）**：小时 token 量是**尖峰型**（采样中相邻小时从 40 → 812 → 827 → 464，量级差可达 20 倍）。Catmull-Rom 会在尖峰处**过冲（overshoot）到负值或超出 max**，画出事实上不存在的峰/谷，属数据失真。monotone cubic 保单调、不过冲，是该数据集的正解。

**改哪两个地方**：新函数需落 **两处逐字一致**——
1. `lib/charts.js`（源码 of truth，`lib/charts.js:6-8`）
2. `lib/client.js:26` 之后的 `charts.js 内联` 区（**运行态真正读取的是这份**，见 `lib/client.js:332` 调用的 `areaPath` 是内联副本）

### 4.3 X/Y 轴刻度与标签逻辑，以及小时标签的具体问题
**X 轴刻度的唯一产出点**：`lib/client.js:157-167`（`lib/charts.js:227-242`）：
```js
162: 	const tickEvery = Math.max(1, Math.ceil(series.length / 8));
163: 	const ticks = series
164: 		.map((s, i) => ({ label: s.day.slice(5), x: i * slot }))
165: 		.filter((_, i) => i % tickEvery === 0 || i === series.length - 1);
```
标签渲染在 `lib/client.js:339-340`（`fontSize: 9`, `textAnchor: "middle"`, `y: h - 2`）。

**Y 轴：根本没有刻度/标签逻辑。** `grep` 全文件无 `yTicks`/`gridline`/`yAxis`；Y 方向只有尺寸约束 `const h = 150`（`lib/client.js:306`），最大值仅用于归一化（`lib/charts.js:229` `const max = Math.max(1, ...series.map((s) => s.value));`）。**代码确证。**

**小时标签的四个具体问题**：

1. **标签文字会退化成"日"（硬 bug）**：`s.day.slice(5)` 对 `"2026-09-17"` 得 `"09-17"`（合理）；但对小时键 `"2026-09-17 19"` 仍得 `"09-17"` —— **丢掉小时，同一标签在一个屏幕上重复出现十几次**。必须改成按 `"YYYY-MM-DD HH"` 切 `slice(5)` → `"09-17 19"`，或者把标签格式从数据层独立出来（推荐后者：让 DB 返回 `label` 字段，客户端不再猜格式）。
2. **标签重叠（中高概率）**：`du_svg` 宽 `max-width: 560px`（`lib/client.js:16` `.du_svg{width:100%;max-width:560px;height:auto}`），字高 9px。`"09-17 19"` 约 8 字符 ≈ 40px 宽；`tickEvery = ceil(n/8)` 在 7 天 × 24h = 168 点时得 21，即 8 个标签 ≈ 每 70px 一个 —— **勉强不重叠**；但若用户选"近 30 天"（720 点，`tickEvery=90`）标签数仍为 8 个，同样安全。**真正的重叠风险来自时区/零点**（见下）而非数量。**推断（基于常量计算，未实机目视）**。
3. **跨零点**：小时桶的 `"09-17 00"` 与 `"09-16 23"` 相邻，若像"日"那样只显示 `HH:mm` 会产生"23 → 00"的跳变歧义；当前 `slice(5)` 恰好保留了日期前缀，**只要改成保留完整 `MM-DD HH` 就天然规避**。
4. **时区**：SQL 用 `'localtime'`（`lib/db.js:307`），**所有桶都是本地时区**，与 `lib/client.js:699` 的界面口径声明一致（`"本地时区。"`）—— `localStorage`/`Date.now()` 侧无 UTC 混用。**风险低**：唯一坑是宿主进程 TZ 与浏览器 TZ 不同（同一台机部署，实测不可能）。**代码确证 + 推断。**

### 4.4 额外必须处理的一条：**小时空洞补零**
`scaleArea` 假定 x 均匀：
```js
160: 	const slot = series.length > 1 ? w / (series.length - 1) : w;
161: 	const points = series.map((s, i) => ({ x: i * slot, y: h - (s.value / max) * (h - 4) - 2, day: s.day, value: s.value }));
```
`i * slot` 是**按序号等距**，不是按时间等距。而 SQL 返回的是"**有数据的**小时"（第 2.3 节实测：297/720），空洞小时不在结果里 → **静默压缩时间轴**。修法：在客户端或宿主侧按 `from`/`to` 生成完整小时序列并补 `value: 0`。**不做这一步，"按小时平滑曲线"会画出一张时间轴撒谎的图。** **代码确证（机制）+ 采样确证（空洞存在）。**

---

## 5. 配色现状

### 5.1 三张图各自取色（文件:行号 + 原文 hex）

**（a）面积图 / 趋势图** —— `lib/client.js:337-338`：
```js
337: children.push(react.createElement("path", { d: geom.area, fill: "var(--dsw-state-business-secondary)", opacity: 0.35 }));
338: children.push(react.createElement("path", { d: geom.line, fill: "none", stroke: "var(--dsw-state-business-primary)", strokeWidth: 2 }));
```

**（b）柱状图** —— `lib/client.js:326`：
```js
326: children.push(react.createElement("g", { fill: "var(--dsw-state-business-primary)" },
```

**（c）热力图** —— 6 档蓝色阶，定义在插件自己的 CSS 里，`lib/client.js:16` 尾部：
```css
body{--du-heat-0:#f3f4f6;--du-heat-0-stroke:#9ca3af;--du-heat-0-stroke-width:1px;--du-heat-1:#dbeafe;--du-heat-2:#93c5fd;--du-heat-3:#60a5fa;--du-heat-4:#3b82f6;--du-heat-5:#2563eb;--du-heat-6:#1e3a8a;--du-heat-peak-stroke:#ffffff;--du-heat-month-fill:var(--dsw-alias-label-caption)}body[data-ds-dark-theme]{--du-heat-0:#2f3540;--du-heat-0-stroke:#8b93a1;--du-heat-0-stroke-width:1.5px;--du-heat-1:#1e3a8a;--du-heat-2:#2563eb;--du-heat-3:#3b82f6;--du-heat-4:#60a5fa;--du-heat-5:#93c5fd;--du-heat-6:#bfdbfe;--du-heat-peak-stroke:#0f1115;--du-heat-month-fill:var(--dsw-alias-label-secondary)}
```
消费方在 `lib/charts.js:162-170`（`FILLS` 数组）与 `lib/charts.js:136-137`（level 0 的 stroke）。

### 5.2 **发现一处现存缺陷：趋势图/柱状图用的两个 token 从未定义**
全树检索（`grep -rn -- "--dsw-state-business"` over `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/`，排除 `alias-` 前缀）**结果为空**：
```
--- END (empty = token never defined) ---
```
而主题包真正定义的是 **`--dsw-alias-` 前缀**版本 —— `node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js:124`（单行压缩 CSS，`body{…}` 与 `body[data-ds-dark-theme]{…}` 两块）：
```
--dsw-alias-state-business-primary => var(--dsw-static-deepseek-500)   [body{...}]
--dsw-alias-state-business-primary => var(--dsw-static-deepseek-400)   [body[data-ds-dark-theme]{...}]
--dsw-alias-state-business-tertiary => var(--dsw-static-deepseek-100)  [light]
--dsw-alias-state-business-tertiary => var(--dsw-static-deepseek-800)  [dark]
--dsw-static-deepseek-300 => #b7c8fe
--dsw-static-deepseek-400 => #679efe
--dsw-static-deepseek-500 => #4176e6
--dsw-static-deepseek-600 => #4868b2
--dsw-static-blue-400 => #60a5fa
--dsw-static-blue-500 => #3b82f6
```
**`--dsw-alias-state-business-secondary` 同样不存在**（在主题包中检索无任何匹配）。

**推断（未实机目视截图）**：因为 `--dsw-state-business-primary` 未定义，`stroke` 回退到 CSS 初始值 `black`；`fill` 回退到初始值 `black`，再乘 `opacity: 0.35` → **一张黑线 + 35% 黑底的图**，在暗色主题下很难看。**建议本次改动顺手把这两个 token 修正为 `--dsw-alias-state-business-primary`**（否则新写的浅蓝/深蓝配色会被同一个坑吞掉）。这一条**代码确证（token 不存在）**，但"当前肉眼看到黑色"属**推断**，需一次目视/截图确认。

### 5.3 暗色模式与透明度用法（既有可复用范式）
- **暗色适配机制**：`body[data-ds-dark-theme]` 选择器覆盖变量（`lib/client.js:16` 热力图段即用此写法；主题包同款两段式）。
- **透明度用法**：面积图用 `opacity: 0.35` 作用于 `<path>`（`lib/client.js:337`），**不是** `rgba()`/`fill-opacity`——若要"深蓝幅底"，当前写法下应改用**不透明深蓝 + 显式 `opacity`**，或引入 `--du-trend-fill` 变量承载带 alpha 的颜色。
- **可复用的调色板**：热力图的 `--du-heat-1..6` 就是一套**现成的、已做亮/暗双套的蓝色阶**：
  - 浅蓝候选：`#dbeafe`(heat-1) / `#93c5fd`(heat-2) / `#60a5fa`(heat-3)
  - 深蓝候选：`#2563eb`(heat-5) / `#1e3a8a`(heat-6)
  - 与用户诉求"浅蓝轮廓线 + 深蓝幅底"**方向完全一致**，且已暗色适配。

  **注意暗色下这套阶是反的**（`body[data-ds-dark-theme]` 里 `--du-heat-1:#1e3a8a` 是**深**蓝、`--du-heat-6:#bfdbfe` 是**浅**蓝）—— 若趋势图直接复用 `--du-heat-N`，"浅蓝轮廓 + 深蓝底"在暗色下会**反转成深蓝轮廓 + 浅蓝底**。→ **必须新建一对独立变量**（如 `--du-trend-line` / `--du-trend-fill`），不要在语义不同的热力阶上打补丁。**代码确证。**

---

## 6. 构建与部署链

### 6.1 bundle 是手写还是构建产物
**手写、无构建步骤。** `lib/client.js:1-6` 即模块加载器协议的手写外壳：
```js
1: window.__ModuleLoader__.load({
2: 	id: "@local/dsh-usage",
3: 	factory: (require) => {
4: 		var module = { exports: {} };
5: 		var exports = module.exports;
6: 		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
7: 		let react = require("react");
```
`lib/client.js:8`：`//#region dsh-usage Web GUI — handwritten, build-free client bundle.`
`package.json` 里没有 `scripts`/`build`/`devDependencies`（已读全文，只有 `main`/`exports`/`files`/`dsh`/`engines`/`peerDependencies`）。
→ **改完不需要任何构建/打包步骤。** **代码确证。**

### 6.2 客户端 bundle 的加载与热载（代码确证）
服务端把包解析成一条图行并带内容哈希 rev 暴露（`@deepseek-ai/dsh-client-modules/lib/index.js:153-158`）：
```js
155: url: `/plugins/${id}/client.js?rev=${rev}`,
```
热载由 `@deepseek-ai/dsh-client-hmr` 轮询实现（`dsh-client-hmr/lib/index.js:20-45`）：
```js
// One interval stat-polls every graph row's client bundle (polling by design: network
// mounts deliver no inotify events), reports content changes through
// `clientModuleHost.rebuilt(id)`, and serves the `/plugins/events` SSE channel
...
const Config = z.object({ pollIntervalMs: z.number().step(1).min(1).default(500) });
```
→ 默认 **500ms** 轮询 `clientPath`，`mtimeMs`/`size` 变化即 `rehash → rebuilt(id) → rev 变 → SSE 推给浏览器 → 重新拉取该 bundle`。
本部署 `@deepseek-ai/dsh-web-app` 是 profile bundle 之一（`~/.dsh/profiles/web/package.json:11-15`），且 `"patchReload": "live"`。

**历史落盘证据（与代码一致）**：
- `.workspace/usage-tooltip-exec.md:103`：「**生效方式**：client.js 是浏览器端 bundle，替换后刷新页面即生效；无需重启宿主、无需动 DB/RPC」
- `.workspace/usage-heatmap-exec.md:86`：「替换后**刷新页面**即生效（rev 变化重新拉取）；无需重启宿主、无需动 DB/RPC」
- `FEATURE-MAP.md:68`：「插件 `lib/client.js` 替换后**刷新浏览器即生效**，无需重启宿主（dsh-usage/btw 均为此形态）」

### 6.3 宿主侧（db.js / rpc.js）无法热载
`lib/db.js`、`lib/rpc.js` 由宿主 Node 进程 ESM 导入（`lib/index.js:28-31`），插件 `apply()` 同步注册 settings 命名空间与 RPC 通道（`lib/index.js:20-21`、`lib/rpc.js:221`）并开 DB —— **改这些必须重启宿主**。
工作区已明确记录纯函数热载通道**尚不可用**：`FEATURE-MAP.md:70`「**尚不可用**（闸门通过 · 未投产，2026-09-16）…投产需改官方 `cordis-plugin-hmr`（解除 node_modules 排除）+ 模块白名单 + 一次重启落地（鸡生蛋问题）——**当前不可用，勿围绕它设计**」。
可用的重启工具：`.workspace/deploy-lag/dsh-restart.sh`（`FEATURE-MAP.md:69` 一行式优雅重启，SIGTERM 有界等待 dispose → 重启 → 冒烟 200）。

### 6.4 "改完到生效"的精确步骤

**源码 of truth = `/home/CNS2026495165/dsh/.workspace/dsh-usage-src/`**
> 实测核对：该副本的 `lib/charts.js`、`lib/client.js`、`lib/db.js`、`lib/rpc.js`、`lib/index.js` 与部署位 **逐字节一致**（`diff -q` 全静默）。**注意 `/home/CNS2026495165/dsh/dsh-usage/`（仓库内旧目录）是过时副本**——已核对 `client.js` 差 393 行、`index.js` 差 44 行、`rpc.js` 差 13 行、`charts.js` 差 144 行（无 tooltip、用旧 `ctx.connection.register` 姿势），**不要改那里**。

**Phase A — 纯客户端改动（只动 `client.js` + `charts.js`，热面）**
```bash
# 1) 在 .workspace/dsh-usage-src/lib/ 下改 client.js / charts.js
# 2) 语法自检（charts.js 可独立 node --check，见其 :8 声明）
node --check /home/CNS2026495165/dsh/.workspace/dsh-usage-src/lib/client.js
node --check /home/CNS2026495165/dsh/.workspace/dsh-usage-src/lib/charts.js
# 3) 同步到部署位（仅这两个文件）
cp /home/CNS2026495165/dsh/.workspace/dsh-usage-src/lib/client.js \
   /home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-usage/lib/client.js
cp /home/CNS2026495165/dsh/.workspace/dsh-usage-src/lib/charts.js \
   /home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-usage/lib/charts.js
# 4) 浏览器刷新本 GUI（http://127.0.0.1:3080）→ 生效
```
**不需要重启宿主。** 机制：client-hmr 500ms 轮询发现 `mtimeMs/size` 变化 → `rebuilt` → rev 变 → 刷新即拉新 bundle。（若想免刷新，HMR SSE 通常会自动重载；保守起见手动刷新一次。）

**Phase B — 含宿主改动（`rpc.js` / `db.js`，冷面）**
```bash
# 1) 改 .workspace/dsh-usage-src/lib/{rpc.js,db.js}
node --check .../lib/rpc.js && node --check .../lib/db.js
# 2) 同步到部署位（cp 覆盖同上）
# 3) 重启宿主：bash /home/CNS2026495165/dsh/.workspace/deploy-lag/dsh-restart.sh
#    （默认只读预览 + 确认；-w 可保存即自动重启）
# 4) 浏览器刷新 → 生效
```
**改了 `rpc.js`/`db.js` 就必须重启宿主**，这是本次改动唯一的冷面成本。

> 注：仓库内的 `dsh-usage/scripts/install-web2.sh` 指向 **已不存在的 `~/.dsh/profiles/web2/`**（实测 `ls: 无法访问 …/profiles/web2: 没有那个文件或目录`），**该脚本当前不可用**，不要用它部署——直接 `cp` 到 `~/.dsh/profiles/node_modules/@local/dsh-usage/lib/`。

---

## 7. 风险与副作用

| 风险 | 判定 | 依据 / 缓解 |
|---|---|---|
| **影响其它图** | **低** | 柱状图独立分支（`lib/client.js:319-329`），共用 `series` 但各自缩放。热力图完全独立（`HeatmapChart` + `heatmapGrid`），且 `heatmapGrid` 的入参契约就是按天 `{day:'YYYY-MM-DD', total}`（`lib/charts.js:56-67`）—— **不要把小时数据喂给热力图**，其周网格按 `86400000` 步进（`lib/charts.js:95`）会算错。 |
| **tooltip 开关（`dsh-usage.ui.tooltip`）** | **低** | 开关逻辑与渲染分支解耦：`const tooltipEnabled = props.tooltip !== false;`（`lib/client.js:310`）决定是否挂 `onMouseMove`（`:363`）；`hitFn` 无论开关都会算（`:318-336`）。改了曲线几何后**仍按数据点命中**（`lib/client.js:181-205` `hitAreaPoints` 做顶点+线段距离），曲线平滑后视觉与命中点会有极小偏差（控制点凸起处），**属已知可接受偏差**，但 `maxDist=12`（`:334`）在 168~720 点、560px 宽时每点间距仅 0.8~3.3px，**命中会过于敏感 → 建议把 maxDist 调小或改为按 x 就近取点**。**代码确证（间距计算为推断）** |
| **性能：数据点变多** | **低** | 实测最密情况 30 天 = 297~720 个非空小时（`usage_events` 采样）。SVG 元素数：1 条 `path`（线）+ 1 条 `path`（面）+ ≤8 个 `text` —— **与点数无关，DOM 不膨胀**。开销只在 `hitAreaPoints` 的 O(n) 逐点扫描（`lib/client.js:185` 起）与 `Math.max(...series.map())` 展开（`lib/charts.js:229`，720 个参数远低于引擎上限）。**低风险。** |
| **RPC 载荷变大** | **低-中** | 单条记录 ~7 字段 `{day, requests, 4×token}`。日粒度 30 条 → 小时粒度最多 720 条，**约 24 倍**。JSON 体积约 30~60 KB，30s 轮询（`lib/client.js:472` 默认 `refreshSec=30`）下可接受，但**建议加"趋势粒度"下拉而不是无条件改默认**，避免每次轮询都拉 720 条。 |
| **旧数据兼容（历史按天 vs 新按小时混用）** | **无风险** | 两个粒度**同源**：都从同一条 `usage_events` 读时现算（`lib/db.js:388-398` 与新增小时分支）。**无迁移、无回填、无 schema 变更**，`usage_daily` 保持原样不动。`bucketValue` 读的是 `input_tokens` 等字段名，与粒度无关（`lib/client.js:284-290`）。 |
| **设置 schema 兼容** | **无风险** | 若新增趋势粒度开关（`lib/index.js:39-68` 的 `Config`），其注释已声明 "Schema grows only-additively (no key removal) so old documents stay valid"；缺失键回退默认（`lib/client.js:726-740` `usageSettingsOf` 的 `!== false` 兜底）。 |
| **标签重叠 / 时间轴失真** | **中（本次主要功能风险）** | 见 §4.3、§4.4。**必须做**：(1) 标签保留 `MM-DD HH`；(2) 小时空洞补零。 |
| **配色 token 现存缺陷被继承** | **中** | 见 §5.2。改用 `--dsw-state-business-*` 的任何新代码会**继承同一个 undefined 坑**。**建议一并修正为 `--dsw-alias-state-business-primary`，或自建 `--du-trend-line/-fill`。** |
| **旧客户端/新宿主错配** | **低** | 旧客户端不传 `granularity` 即默认 `"day"`（`lib/rpc.js:139`），向后兼容；反向（新客户端+旧宿主）会得到明确的 `invalid-params` 错误并被卡片渲染为错误条（`lib/client.js:692-696`），不会静默失败。 |

---

## 最小可行实现路径（推荐）

**目标**：趋势图新增"按小时"粒度 + 单调平滑曲线 + 浅蓝轮廓/深蓝幅底。

**Step 1（冷面，约 12 行）— 宿主开小时粒度**
1. `lib/rpc.js:54` → `const GRANULARITIES = new Set(["day", "hour"]);`
2. `lib/rpc.js:138-143` → 把校验通过的 `granularity` 写入 `filters.granularity`
3. `lib/db.js:307` 旁增：
   ```js
   const HOUR_SQL = "strftime('%Y-%m-%d %H', ts / 1000, 'unixepoch', 'localtime')";
   ```
4. `lib/db.js:386-407` `queryTimeseries` → 按 `filters.granularity === "hour"` 选 `HOUR_SQL`，别名统一叫 `bucket`，并**同时返回 `ts`（用于补零排序与标签生成）**
5. **重启宿主**（`dsh-restart.sh`）

**Step 2（热面，约 40 行）— 客户端平滑曲线**
6. `lib/client.js` 内联的 `charts.js` 区（`:26` 之后，**两处逐字同步** `lib/charts.js`）新增：
   ```js
   function smoothPath(points, tension) { /* monotone cubic (Fritsch–Carlson) → C 指令串 */ }
   ```
   并用它替换 `areaPath` 的 `line` 产出（`lib/charts.js:25` 的 `M/L` 拼接），面积闭合段（`:26`）原样保留。
7. `lib/client.js:330-341` 面积分支：`geom.line`/`geom.area` 改用 smoothPath 产物。

**Step 3（热面，约 15 行）— 小时轴与标签**
8. `lib/client.js:157-167` `scaleArea`：新增可选 `label` 字段（由 `bucket` 派生 `MM-DD` 或 `MM-DD HH`），`ticks` 用 `label` 而非 `s.day.slice(5)`。
9. **补零**：在客户端按 `range.from/to` 生成完整小时序列，缺失小时 `value: 0`（或宿主侧 `queryTimeseries` 内补）。

**Step 4（热面，约 6 行）— 配色**
10. `lib/client.js:16` CSS 增亮/暗两套：
    ```css
    body{--du-trend-line:#93c5fd;--du-trend-fill:#1e3a8a}
    body[data-ds-dark-theme]{--du-trend-line:#bfdbfe;--du-trend-fill:#1e3a8a}
    ```
    （色值取自同文件已有的蓝色阶，见 §5.3；暗色**不要直接复用 `--du-heat-N`**，语义相反）
11. `lib/client.js:337-338` → `fill: "var(--du-trend-fill)"`, `stroke: "var(--du-trend-line)"`；**顺带修正** `:326` 柱状图与 `:338` 的 `--dsw-state-business-primary` → `--dsw-alias-state-business-primary`（§5.2）。

**Step 5 — 验证**
12. `node --check` 两个文件；`cp` 到部署位；**A 阶段只刷新浏览器**，B 阶段先重启再刷新。
13. 验收：切"近 7 天"→ 应出 168 点平滑曲线、标签 `09-17 19` 形式、空洞小时平落为零、亮/暗主题各看一眼。

**总成本估计**：冷面 ~12 行 + 一次重启；热面 ~60 行 + 刷新。**无构建、无迁移、无依赖新增。**

---

## 若不可行的替代方案

（若因为"平滑曲线不过冲"与"小时空洞补零"的工程量被否，或用户只想要观感改善）

1. **保留天粒度，只做观感修复（最小改动，~10 行）**：`scaleArea` 输出点不变，仅把 `areaPath` 的直线段换为 `Q`（二次贝塞尔，控制点取两点中点）—— 不引入单调插值，工程量 3 行，能显著改善"折线很硬"的观感，但**仍有过冲风险**，且**不解决"日期数少"的根本问题**。
2. **降粒度门槛而非升粒度**：把默认区间从"近 30 天"改为"近 7 天"（`lib/client.js:676-680`），让日粒度在图上有 7 个点 —— **无任何宿主改动、纯热面 1 行**，但用户诉求是"按小时"，这只是观感折中。
3. **改成纵向条形/阶梯图（step line）**：小时数据用 step 更诚实（token 是离散累加，非连续函数），且无需平滑算法 —— 用 `H`/`V` 指令替换 `L`（`lib/charts.js:25`），约 5 行。**若"平滑"只是手段而非目的，这是最省的正确解。**
4. **若连宿主重启也不行**：可在客户端用现有 `byDay` 数据 + 不可行 —— **明确否决**：天桶数据**无法**还原小时分布（信息已丢失），**必须**动宿主 SQL。**这条没有绕过路径。**

---

## 附：本报告的证据等级标注说明

- **代码确证**：直接引用了 `文件:行号 + 原文片段`，且经过跨文件核对（如 token 定义全树检索为空）。
- **推断**：基于代码常量计算或数据采样得出的结论，未做运行时目视/实测（已逐条标注），例如"当前趋势图肉眼是黑色"、"标签不会重叠"、"过冲风险"。
- **无法确证**：
  - 未在浏览器中实际渲染本插件卡片（只读审计，未打开 GUI 截图），因此**所有视觉结论均为推断**；建议实施后做一次亮/暗双主题目视。
  - `--dsw-state-business-primary` 未定义 → 浏览器实际回退色**未目视确认**（按 CSS 规范应为 `black`）。
  - 部署位与工作区副本已 `diff` 核对逐字节一致，但**未核对 `~/.dsh/profiles/node_modules/@local/dsh-usage` 是否被别处 symlink 复用**（`ls -la` 显示为普通目录，非符号链接）。
  - `~/.dsh/profiles/node_modules/@local/dsh-usage/data/verify.db`、`smoke.mjs`、`test/verify.mjs` 等测试资产未纳入本次审计（与趋势图渲染路径无关）。
