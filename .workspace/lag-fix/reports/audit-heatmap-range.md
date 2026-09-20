# 审计：让用量热力图尊重卡片范围选择器（`filters.from/to`）——影响面与交付单元

- 审计档：能力/影响面审计（只读；除本报告外未修改任何文件；未重启/干扰宿主 PID 20806；`usage.db` 全程 `readOnly:true`）
- 审计时间：2026-09-20（宿主 PID 20806，`dsh web`，启动于 2026-09-20 11:47:23）
- 被审对象（**以真实代码为准**）：
  - 部署拷贝（GUI 实际加载）：`/home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-usage/lib/{rpc,client,db,index}.js`
  - 工作区源码副本（早期快照，已漂移）：`/home/CNS2026495165/dsh/dsh-usage/lib/{rpc,client,db}.js`
- 只读参考（另一档产物，未改动）：`.workspace/lag-fix/reports/unit-A.md`、`patches/usage-plugin.sh`、`probes/*.mjs`、`tmp/{orig,patched}/`
- HTTP 探针用量：**5 发**（3 发 JSON-RPC POST + 2 发 GET bundle，串行单发；上限 6）

---

## 0. 结论摘要（先看这段）

1. **最重要的纠正**：前序审计的建议「把 `filters.from/to` 传给 `queryHeatmap` 就会让热力图尊重范围选择器」**单独实施是纯 no-op（无效）**，原因是**双重丢弃**：
   - **客户端根本不发**：`client.js:828`（部署）/ `:252`（源码）的 heatmap 调用载荷是字面量 `{ year: …, dataSources: … }`，**没有 `from/to`**。于是 `rpc.js` 里 `normalizeFilters` 解析出的 `filters.from/to` 恒为 `undefined`，透传与否没有区别。
   - **DB 层还会再丢一次**：现行 `db.js:426` 主动 `eventWhere({ ...filters, from: undefined, to: undefined })` 抹掉窗口，只保留 `year + dataSources`。
   - 实测证据（探针 A/B，见 §7.1）：`heatmap{year:2026}` 与 `heatmap{year:2026, from: now-7d, to: now}` 两次应答**逐字节相同**（31 行，2026-08-10..2026-09-18，总 14,721,117,199）。
   - ⇒ 要真正生效，必须**客户端 + rpc + db 三层同时就位**（db 层已由另一档 unit-A 的补丁交付，见 §3）。
2. **现状语义**：热力图 = **单个自然年**（`[year-01-01, year-12-31]`，按本地时区日聚合）的 GitHub 风格贡献度图；只消费 `year` 与 `dataSources`，**忽略 `from/to`**（以及 `model/project`）。UI 上**没有年份选择器**——年份由「范围选择器的起点所在年」隐式决定（`client.js:828` 的 `new Date(range.from || Date.now()).getFullYear()`）。
3. **确实存在不一致**：默认档就是「近 7 天」，此时 hero/趋势图/明细表都是 7 天，**热力图却是整年**（本次实测热力图 31 天合计 14.72B tokens，而 7 天 summary 只有 4.39B，差 **3.35×**；热力图甚至显示了窗口之外的 8 月数据）。
4. **最大风险**：改动后默认档（近 7 天）下热力图**只剩 1 列格子**。用真实 `usage.db`（只读）+ 真实 `heatmapGrid` 仿真的几何：`range=7天 → weeks=1, gridW=11, viewBox=200 → 网格仅占 31px/560px`（现状 `year=2026` 是 6 列 / 227px）。**格子尺寸与画布高度不变**（`560/200=2.8` 两侧相同），但热力图会从「6 列概览」退化成「一根竖条」，产品价值可疑。**渲染层本身不会坏**（数据驱动，见 §2），坏的是产品语义与文案。
5. **建议：有条件做（Do, with conditions）** —— 推荐**方案 B**，但必须先满足 §6 的 6 个条件（其中 C3 是产品决策闸门：默认 7 天档是否接受「1 列热力图」）。若 C3 不可接受，则改做**方案 C**（保留整年 + 标题标注年份/窗口，零重启、零风险）。
6. **Workload 量级**：方案 B ≈ **3 个文件、约 40–80 行改动**（rpc 1 行 ×2 份拷贝；client 2–4 处约 20–40 行；文案 2–3 行；可选 viewBox 1 行）+ 1 档验证；**追加重启次数 = 0**（搭 unit-A 已计划的那一次重启）。方案 C ≈ **1 个文件 2–3 行、零重启**（client 热替换）。

---

## 1. Q1 现状语义：热力图到底忽略/使用了哪些筛选维度

### 1.1 `filters` 有哪些字段、各端点消费哪些

`rpc.js:129-163`（部署）`normalizeFilters(endpoint, payload)` 产出：

| 字段 | 来源 | 校验 | 注释 |
|---|---|---|---|
| `from` / `to` | `parseTime(payload.from/to)`（`:82-98`） | 有限 ms 或 ISO 字符串；`from <= to`（`:132-134`） | 全端点解析，**但 heatmap 不消费** |
| `dataSources` | `parseDataSources`（`:107-119`） | `dsh`/`cc`/`all` 或数组 | 全端点消费 |
| `model` / `project` | 非空字符串 | 仅透传 | 六端点经 `eventWhere` 消费；heatmap 不消费（且 rpc 层就没给） |
| `granularity` | 仅 `timeseries`（`:138-147`） | `day`/`hour` | 2026-09-18 起真正生效 |
| `year` | 仅 `heatmap`（`:148-153`） | 必须整数 | heatmap 唯一的时间维度 |
| `limit` | 仅 `sessions`（`:154-161`） | 1..500 | — |

端点消费矩阵（部署拷贝）：

| 端点 | 消费维度 | 代码位置 |
|---|---|---|
| `summary` | `from,to,dataSources,model,project` | `rpc.js:201` → `db.js:355`（`eventWhere` `:319-344`） |
| `timeseries` | 同上 + `granularity` | `rpc.js:202` → `db.js:392-394`（`DAY_SQL`/`HOUR_SQL`） |
| **`heatmap`** | **仅 `year,dataSources`** | `rpc.js:203`（显式白名单构造 `{year, dataSources}`）；`db.js:426` 再抹掉 `from/to`；`db.js:431` 用 `DAY_SQL BETWEEN '${year}-01-01' AND '${year}-12-31'` |
| `byModel` / `byProject` / `byDay` | `from,to,dataSources,model,project` | `rpc.js:204-206` → `db.js:453/484/515` |
| `sessions` | `from,to,dataSources,limit` | `rpc.js:207` → `db.js:549` |
| `status` / `refresh` | 无筛选 | `rpc.js:189-195` |

补充事实：`dataSources:'all'` 在 `db.js:294-304` 里被展开为 `data_source IN ('dsh','cc')`（**不是**空子句）。

### 1.2 产品语义：是「整年贡献度图」吗？

- **是**。`db.js:422-444` 的注释与实现都是「per-day grand-total grid for one **year** (GitHub-style)」，窗口由 `year` 决定整自然年（含 12-31，闭区间）。
- **UI 侧没有年份选择器**：对部署 `client.js` 全文件检索 `year`/`年`，**唯一命中就是 `:828`**——年份是「范围起点所在年」的副产物。
  ⇒ 现状下用户**无法**显式选择热力图年份；只能通过「自选」范围把 `customFrom` 放在别的年份来间接切换（且跨年范围只显示起点那年，这是个既有的隐性歧义）。
- 热力图面板标题是 `热力图（按日总量）`（`:1082`），**既不写年份也不写窗口**；图例注释为 `单位 tokens/日 · 灰格 = 无数据 · 峰值 X tokens/日（YYYY-MM-DD）`（`:707-709`）。⇒ 现状的「整年」语义**完全靠月份标签与格子排布暗示**。

### 1.3 接上 `from/to` 后用户会看到什么（具体到可见行为）

依据 §7.2 的只读仿真（真实库 + 真实 `heatmapGrid`，cell=11/gap=3/startWeekday=0，`.du_svg{width:100%;max-width:560px}` `client.js:16`）：

| 场景 | rows | weeks | gridW | viewBox 宽 | 渲染比例@560px | 格边长 | 画布高 | 网格实占宽 |
|---|---|---|---|---|---|---|---|---|
| 现状 `year=2026` | 31 | 6 | 81 | 200 | 2.800 | 30.8px | 311px | 227/560px |
| 改后 `range=7天`（默认档） | 5 | **1** | 11 | 200 | 2.800 | 30.8px | 311px | **31/560px** |
| 改后 `range=30天` | 20 | 5 | 67 | 200 | 2.800 | 30.8px | 311px | 188/560px |
| 改后 `range=90天` | 31 | 6 | 81 | 200 | 2.800 | 30.8px | 311px | 227/560px |

可见变化清单（逐条）：
1. **格子数量骤减**：默认「近 7 天」下从 6 列变 **1 列**（7 格竖条）；30/90 天档与现状接近（因为库里只有 31 天数据：2026-08-10 起）。**未来数据攒满一年时**，同一改动会是「53 列 → 1 列」的更大落差。
2. **峰值与图例口径改变**：`峰值` 从「整年峰值（2026-08-11）」（`:706-709`）变成「范围内峰值」；「近 7 天」档下峰值日会是 2026-09-18。这与 hero 的 7 天口径**终于一致**（这正是改动的收益）。
3. **月份标签变化**：`weeks <= 4` 时 `heatmapGrid` 折叠为首/末月（`client.js:356-359`）→ 7 天档只剩 1 个月标签（仿真输出 `months=[9月]`）。
4. **画布尺寸不变**：`viewBox` 下限仍是 `Math.max(grid.width, 200)`（`:734`），高度公式不变（`:678`），所以整体高度不变，只是右侧大面积留白。
5. **标题不变**：仍是 `热力图（按日总量）`——**用户看不到「这张图现在只覆盖 1 周」的任何文字说明**（这是必须联动修的点，见 §6 C2）。

---

## 2. Q2 客户端契约：范围 vs 年份，是否不一致，渲染假设

### 2.1 「范围」与「年份」的关系（代码事实）

- 范围选择器：`client.js:770` `rangeDays`（默认 **7**），选项 7/30/90/自选（`:1031-1035`），自选时出现两个 `<input type="date">`（`:1036-1040`）。
- 范围 → 时间窗：`:800-806`。现状（未打 unit-A 补丁）：`近 N 天 = [now - N*86400000, now]`（滚动窗口，非日对齐）；自选：`[customFrom 00:00:00, customTo 23:59:59]`。
- 卡片级载荷：`:807` `payload = {from, to, dataSources}` → 供 `summary/timeseries/byModel/byProject/byDay`（`:826-831`）。
- **热力图走的是另一条路**：`:828` 只发 `{year: new Date(range.from || Date.now()).getFullYear(), dataSources}`。
- 结论：**「年份」不是用户可选的维度，而是「范围起点」的派生值**；两者不是并列关系，没有「年份 vs 范围」的交互约定，只有一处隐式耦合。

### 2.2 「选了近 7 天但热力图仍显示整年」——是，实测已证

- 探针 A/B：`heatmap` 带 `from/to` 与不带**逐字节相同**（31 行，2026-08-10..2026-09-18，合计 14,721,117,199）。
- 同刻 `summary{from: now-7d, to: now}` = **4,391,030,015** requests=24,931。窗口内的热力图日合计 = **4,391,030,015**，与 summary **逐位相等** ⇒ 口径本身是一致的（四桶之和 = 日总量），只是**窗口不同**：热力图多算了窗口外的 26 天（14.72B vs 4.39B，**3.35×**）。
- 附带发现（可作正面证据）：热力图日粒度总量与 summary 的四桶之和**完全一致**，说明改动后 hero/热力图不会出现"总和对不上"的新问题。

### 2.3 前端是否有「热力图恒为整年」的渲染假设？

**没有硬编码的 365/53 列假设**，渲染层是数据驱动的：

- `heatmapGrid`（`client.js:289-361`）从**返回数据本身**推出 `first/last`，按周对齐算 `weeks = ceil(daysTotal/7)`；无数据返回空 cell 列表（`:295`）；月份标签按列 run 生成，`weeks<=4` 折叠首/末月（`:356-359`）。`hitGridCells`（`:583` 附近）按 cell 实际坐标命中，与列数无关。
- 设计文档亦有明文：`.workspace/usage-heatmap-exec.md:46`「画布保持数据范围自适应（**不改年度固定画布**）……**无年度固定画布**」；`:55` 记录 40/40 等价性覆盖「空数组、**单日**、**窄 3 周**、月界跨周、**全年 365 天**、跨年」。
- 唯一的「整年时代」遗留物是两处**非功能性**假设：
  1. `viewBox` 下限 200（`:734`）——在整年网格（739 宽）下无感，在 1 周网格（11 宽）下会把 31px 的竖条撑进 200 宽的坐标系（视觉比例见 §1.3）。
  2. 文案（标题 `:1082` + 图例 `:706-709`）不写窗口，靠月份标签暗示年度。
- **结论：改动不需要重写布局算法，但必须同步改标题/图例（否则"只剩一列却不说覆盖哪段"），并需要**一次**产品决策：窄网格是否接受 `Math.max(grid.width,200)` 的拉伸效果。

---

## 3. Q3 正确性风险：与另一档「分段 + `usage_daily` + 日对齐」的交互

**关键事实：另一档 unit-A 交付的补丁版 `queryHeatmap` 已经原生支持 `from/to`。**（`tmp/patched/db.js:521` 起，`hasFrom/hasTo` 分支 + 日边界闸门 + 两段合并；见 `reports/unit-A.md:50-59`）。所以这不是"新增一个未验证能力"，而是"启用一条已被等价性验证过的路径"。

### 3.1 逐条对照

| 风险点 | 判定 | 依据 |
|---|---|---|
| 任意非整年范围下 `usage_daily` 是否仍可用 | **可用**：补丁版对任意窗口都是「闸门①日对齐 ∧ 闸门②`day <= MAX(day)` ∧ 交集非空」→ 已聚合段走 daily、其余段走 `usage_events` 的 `ts` 半开区间，两段按 day 合并 | `tmp/patched/db.js` `queryHeatmap` 全文；`unit-A.md:50-59` |
| 边界日处理是否仍成立（含 12-31、含 `to`） | **成立**：`from/to` 按**含**端点处理（`toExclusive = hi + 1`），与旧字符串 `BETWEEN ...-12-31` 语义一致；`T3a`(31 行全等)/`T6a`/`T6c` PASS | `unit-A.md:202`（作者曾把含端点写成半开 → `T3a` 立刻报错并修正）、`unit-A.md:131-141` |
| `MAX(day)` 闸门是否需要额外分支 | **不需要**：窗口整体落在未聚合区（daily 交集为空）→ `useDaily=false` → 纯 events 路径，已验证 | `T6a`（5,385 事件 / 1 行全等） |
| 是否破坏「逐行等价」性质 | **不破坏（已实测）**：`T4`（改前客户端滚动窗口 7/30 天形态）逐行全等；`T6c`（非日对齐滚动窗口）逐行全等；`T4c`（`year` 语义未被 `from/to` 误伤）PASS | `unit-A.md:131-141` |
| **新的性能回归（重要）** | **有，仅限"自选"档**：`rangeDays===0` 的 `to = customTo + "T23:59:59"`（`client.js:804` 部署 / `:236-240` 源码，unit-A 的 A0 **只改了 `rangeDays>0` 分支**）→ `.000` ≠ 日末 `.999` → 闸门①不成立 → **退回 events 全扫（≈289ms/次）**，正是 unit-A 要消灭的冻结源 | `tmp/patched/client.js` range useMemo（A0 只改近 N 天分支）+ `db.js` `isLocalDayEnd` 定义 |
| 其它端点/语义 | 无交叉：`usage_daily` 只被 `queryHeatmap` 消费；`MAX(day)` 45s TTL 缓存与 `invalidateMaxDailyDayCache` 只影响该函数 | `grep queryHeatmap`：部署包内仅 `db.js:422` / `rpc.js:203` |

### 3.2 顺序/原子性（决定能否安全分期落地）

- **rpc.js 改动单独落地 = 无可见变化**（双重 no-op，§0.1）⇒ **可以先落地、零风险**。
- **db.js 补丁单独落地（rpc 不改）= 无可见变化**（`filters.from/to` 恒 undefined，`hasFrom/hasTo` 为假 → 整年分支）⇒ unit-A 的补丁是**行为中性**的。
- ⇒ 两者**可解耦、任意顺序**；用户可见效果只在**三者同时就位**时出现。而 `rpc.js/db.js` 属于宿主侧（需重启），`client.js` 是每请求 `readFile` 热替换（§7.1 实测 served sha1 == 磁盘 sha1）。
- ⇒ **落地窗口建议**：把 rpc/client 的改动**并入 unit-A 已计划的那一次重启**，零额外重启成本；否则需要各自单独重启。

### 3.3 未证实项（需要什么观测）

- `usage_daily` 陈旧（某天在 `MAX(day)` 之下但从未聚合）时的静默少计：改动后**窄窗口可能 100% 来自 daily**（无 events 段交叉校验），暴露面比整年窗口更集中。**现状同样信任 daily**（整年窗口里 8/10–9/18 也全来自 daily），故非新增风险，但建议验收时用「窗口热力图 vs 直连 `usage_events` 真值 SQL」逐行比对（复用 `T3b/T6a` 方法）。
- 浏览器真实像素（§1.3 的 560px 渲染比例）为**按 CSS/几何推算**，未在浏览器中渲染补丁后 bundle 实测；需 1 次「本地渲染补丁后 client.js + 7 天档截图」才能确认观感是否可接受。

---

## 4. Q4 影响面：所有被波及的消费方

| # | 消费方 | 位置 | 受影响类型 | 说明 |
|---|---|---|---|---|
| 1 | 卡片热力图面板（唯一 UI 消费方） | `client.js:828` 调用、`:1081-1083` 渲染、`HeatmapChart:667-740` | **有影响（核心）** | 列数/峰值/月份标签/（缺）窗口文案改变；布局不崩 |
| 2 | 热力图 panel 标题 / 图例注释 | `client.js:1082`、`:706-709` | **降级（必须联动修）** | 不写窗口 → 改动后无法解释"为什么只剩一列" |
| 3 | 卡片 hero / 趋势图 / 明细表（summary,timeseries,byModel,byProject,byDay） | `client.js:826-831` | **无影响** | 各自独立载荷，未共用热力图结果 |
| 4 | 会话表（sessions，自带日期筛选） | `client.js:858-872` | **无影响** | 自有 `sessionFrom/sessionTo`，是"面板局部窗口"的既有先例 |
| 5 | 卡片设置项（`heatmap.peakRing/monthLabels/legendNote/levels`、`ui.tooltip`） | `client.js:1097-1110`、`index.js:55` | **无影响** | 纯渲染开关，与窗口无关（`levels` 仍按范围内峰值分档） |
| 6 | 导出 / 报表 / CSV / 下载 | — | **无影响（不存在）** | `grep 导出\|csv\|download\|blob` 在 `client.js` **零命中**，本插件无导出功能 |
| 7 | 其它插件 / 外部调用者 | `grep -rl '/usage/'` 全 profile | **无影响（不存在）** | 除本插件自身外，无任何插件调用 `/usage/*`（`echarts.min.js` 的命中是无关字符串） |
| 8 | `lib/charts.js`（部署 602 行 / 源码 176 行） | 无 import | **无影响（死文件）** | 仅自引用 + `client.js` 注释「charts.js 内联」；unit-A `§未动项` 认定死文件 |
| 9 | 源码侧回归台 `test/verify.mjs:444` | `dsh-usage/test/verify.mjs` | **无影响** | 断言仅 `heatmap {year:2026,dataSources:'cc'} → ok && Array.isArray`；year-only 调用语义不变 ⇒ 仍 PASS |
| 10 | unit-A 等价性 harness（`probes/verify-daily-equivalence.mjs` T1–T8） | 直连 `db.js` | **无影响** | 直调 `queryHeatmap`，不经 rpc/client；且 T4c/T6c 已覆盖 from/to 路径 |
| 11 | 只读测量探针（`probes/capture-live-endpoints.mjs`、`compare-live-endpoints.mjs`、`usage-host-latency.mjs:93,132`、`.workspace/settings-lag/measure-*.mjs`） | 传 `{year, dataSources}` | **无影响** | 均不传 `from/to` ⇒ 走整年分支，期望值与现状一致（这正是"改后仍可逐行比对"的前提） |
| 12 | `.workspace/dsh-usage-src/dev/dump-grid.mjs`（离线预览数据生成） | 直连 db + `charts.heatmapGrid` | **无影响，可复用为验收工具** | 传 `year` 口径；若加 `--range` 参数即可产出「窄网格预览图」（PIL 渲染链已存在：`render-preview.py`） |
| 13 | 其它年份/口径的外部依赖 | — | **无影响（不存在）** | 全仓检索 `heatmap` 仅命中本插件、其文档与上述探针 |

---

## 5. Q5 候选方案对照

### 方案 A · 最小改动（**前序建议原文**）——判定：**无效，不要单独做**

| 项 | 内容 |
|---|---|
| 改动点 | `rpc.js:203`（部署）/ `rpc.js:199`（源码）：`queryHeatmap(db, {year, dataSources})` → `queryHeatmap(db, filters)` |
| 规模 | 1 行 × 2 份拷贝 |
| 风险 | **零**（因为完全无效果） |
| 实测验收 | 探针 A/B 逐字节相同（§7.1）⇒ 用户**看不到任何变化** |
| 回滚 | `git checkout`/备份还原 |
| 结论 | **不要作为独立交付**：它既不解需求，又会让后续审计误以为"已修"。若要改，必须与 U3（客户端）同批 |

### 方案 B · 兼顾一致性（三层联动 + 前端文案）——**有条件推荐**

| 项 | 内容 |
|---|---|
| 改动点 | ① `rpc.js:203`（部署）/`:199`（源码）透传 `filters`；② `client.js:828`（部署）/`:252`（源码）heatmap 载荷并入 `from/to`（保留 `year` 作旧宿主回退）；③ 依赖 unit-A 补丁版 `db.js:521+`（已支持 `from/to`）；④ 文案：标题 `client.js:1082` + 图例 `:706-709` 标注实际窗口；⑤ 可选：窄网格 `viewBox` 下限 `:734`；⑥ 可选：自选档为 heatmap 单独 snap 到日边界（保住 <1ms） |
| 规模 | 3 文件 / 约 40–80 行（① 1 行×2；② ~5 行；④ 2–3 行；⑤ 1 行；⑥ ~8 行）；**追加重启 0 次** |
| 风险 | 中低：**产品语义风险为主**（默认 7 天档热力图退化为 1 列，§1.3）；性能上"自选档退回 289ms"需 ⑥ 兜住；正确性/等价性 Risk 低（T4/T6c 已验） |
| 验收 | `node probes/verify-daily-equivalence.mjs`（T1–T8 复跑，year-only 调用逐行不变）+ 新窗口用例（7/30/90 天各 1 条 vs 直连 `usage_events` 真值 SQL 逐行比对）+ `node probes/smoke-client-bundle.mjs --client <patched>`（bundle 可执行）+ 1 张 7 天档离线预览图（`dump-grid.mjs` + `render-preview.py`）或浏览器截图 + 抓包确认 heatmap 载荷含 `from/to` |
| 回滚 | client：还原 `client.js`（热替换 <1s，零重启）；`rpc.js/db.js`：`backup-usage-deployed/backup-<ts>/` 还原后重启（或直接随 unit-A 一并 `--rollback`） |

### 方案 C · 不做热力图跟随，改为「口径可读 + 面板自带窗口」——**零风险备选**

| 项 | 内容 |
|---|---|
| 改动点 | ① 标题改为 `热力图（2026 年 · 按日总量）`（`:1082`，实际年份取自 `:828` 的隐式年份）；② 可选：给热力图自己的窗口档位（本年 / 近 90 天 / 跟随卡片范围），与"趋势图自带 gear、会话表自带日期筛选"的既有模式一致 |
| 规模 | ① 1–3 行；② 若做，约 30–50 行（新增 1 个 state + 载荷分支） |
| 风险 | 极低；**零重启**（client 热替换）；不触碰 rpc/db，与 unit-A 完全正交 |
| 验收 | 截图确认标题含年份；② 则抓包确认 heatmap 载荷随面板档位变化 |
| 回滚 | 还原 `client.js`（热替换） |
| 说明 | GitHub 贡献度图本就是「固定年度」语义；本卡已有"面板局部窗口"先例（趋势 gear `:1058-1074`、会话筛选 `:966-979`），故"热力图自带窗口"比"静默跟随卡片范围"更符合本卡的产品语言 |

---

## 6. Q6 明确建议：**有条件做（推荐方案 B；条件不满足则退方案 C）**

**理由**：改动方向正确（消除"hero 7 天 / 热力图整年"的口径错位，实测 3.35× 差异），且**正确性风险已被 unit-A 的 T4/T6c/T4c 实测压掉**、三层改动可解耦分期、追加重启为 0；因此不建议"不做"。但**不宜无条件做**——产品语义（默认档热力图只剩 1 列）与自选档性能回调两个问题必须由用户/主 agent 先裁决。

### 条件（全部满足才按方案 B 落地）

- **C1（前置闸门）**：unit-A 的 `db.js` 补丁已 apply **并完成重启**（否则改了三层也不生效）。判定：`heatmap{year}` 与 `heatmap{year,from,to}` 应答**开始不同**。
- **C2（文案联动）**：标题 + 图例注释必须随同标注实际覆盖窗口（否则是"静默降级"）。
- **C3（产品决策闸门）**：确认"默认近 7 天档下热力图只剩 1 列（31px 宽）"可接受。**若不可接受** → 改做方案 C，或采变体 B′「仅当范围 ≥ 28 天时跟随窗口，否则整年并标注」。
- **C4（性能兜底）**：自选档要么为 heatmap 单独 snap 到本地日边界（保住 daily 快路径），要么明确记录"自选档 heatmap ≈289ms/次"的已知回退（与 unit-A 的性能目标冲突）。
- **C5（回归）**：`year`-only 调用的逐行不变（探针 `capture/compare-live-endpoints` 必须全等）+ 新窗口用例对真值 SQL 逐行相等。
- **C6（窗口）**：与 unit-A 的重启同批；client 可先热替换（先 client → 重启 → 验证），顺序安全（§3.2）。

### 细粒度交付单元（方案 B；执行档逐条落地，不自行扩范围）

| 单元 | 文件 / 函数 | 具体改动内容 | 验收标准 |
|---|---|---|---|
| **U0（闸门，非代码）** | — | 确认 C1/C3/C4 已裁决；读取 unit-A 是否已 apply | 记录：db.js sha256 != `802834b56ab3…`（当前部署值）即已落地 |
| **U1** | `rpc.js:203`（部署 230 行版）/ `rpc.js:199`（源码 221 行版） | `queryHeatmap(db, { year: filters.year, dataSources: filters.dataSources })` → `queryHeatmap(db, filters)`（其余端点不动） | 直连 `handle("heatmap", {year:2026})` 结果与改前**逐行相同**；`handle("heatmap", {year:2026, from, to})` 在**补丁版 db** 下返回窗口行数 = 真值 |
| **U2** | `client.js:828`（部署）/ `:252`（源码） | 载荷改为 `Object.assign({}, payload, { year: new Date(range.from \|\| Date.now()).getFullYear() })`（**保留 `year`**：旧宿主/未打补丁 db 下行为不变） | 抓包/`smoke-client-bundle.mjs` 显示 heatmap 载荷含 `from/to/year/dataSources`；bundle 真实执行无异常 |
| **U3** | `client.js` `range` useMemo（部署 `:800-806` / 源码 `:236-240`）——**仅当采 C4** | 为 heatmap 派生日对齐窗口 `heatmapRange`（from = 起点日 00:00:00.000，to = 终点日 23:59:59.999；用本地 `Date` 组件算术，**禁止 `±1ms` 浮点写法**，参考 unit-A 的 `float-trap-guard.py`） | 7 天档/自选档下 heatmap 请求两端均落在本地日边界；补丁版 db 走 daily 快路径（<1ms） |
| **U4** | `client.js:1082`（标题）+ `:706-709`（legendNote） | 标题写实际窗口（如「热力图（近 7 天 · 按日总量）」/「热力图（2026-08-14 ~ 2026-09-20 · 按日总量）」）；legendNote 峰值保留口径说明 | 截图/预览图：任何档位下都能从文字读出覆盖窗口；峰值日必落在该窗口内 |
| **U5（可选）** | `client.js:734` `Math.max(grid.width, 200)` | 窄网格（weeks ≤ 6）下把下限收紧到 `grid.width`（或按列数给出最小 cell 数），避免 31px 网格被撑进 200 宽坐标系 | 7 天档预览图中单元格不再畸形放大、面板无大面积留白；整年档渲染与现状逐像素一致（对照 `grid.json`） |
| **U6（验收）** | — | 复跑 `probes/verify-daily-equivalence.mjs`（T1–T8）、`capture/compare-live-endpoints.mjs`（year-only 逐行全等）、`run-verification.sh`；新增窗口用例（7/30/90 天 vs 直连 `usage_events` 真值 SQL） | 全部 PASS；year-only 调用与 `reports/live-endpoints-before.json` 逐行一致 |
| **U7（回滚预案）** | — | client 单独回滚（还原文件即热替换生效）；`rpc.js` 回滚需随重启（或与 unit-A `--rollback` 合并） | `--rollback` 后 sha256 逐字节还原、重启后探针回到整年语义 |

---

## 7. 证据附录

### 7.1 实测探针（5 发，串行单发；脚本：`tmp/heataudit/probe-range.mjs`）

```
A heatmap{year:2026}             = {"rows":31,"first":"2026-08-10","last":"2026-09-18","total_all":14721117199}
B heatmap{year:2026,from,to 7d}  = {"rows":31,"first":"2026-08-10","last":"2026-09-18","total_all":14721117199}
A==B identical rows: true
B rows inside the 7d window: 5 sum: 4391030015 (days: 2026-09-14..2026-09-18)
summary{7d} total tokens: 4391030015 requests: 24931
window: 2026-09-13T07:33:36.798Z -> 2026-09-20T07:33:36.798Z
```
- ⇒ **`from/to` 在 heatmap 端点上完全被忽略**（同一 year 下逐字节相同）；且**窗口内日合计与 summary 逐位相等**（口径一致，仅窗口不同）。
- 客户端 bundle 一致性（2 发 GET）：
```
curl -sS http://127.0.0.1:3080/plugins/@local/dsh-usage/client.js | sha1sum  → 30ea5722bcd8
sha1sum .dsh/profiles/node_modules/@local/dsh-usage/lib/client.js             → 30ea5722bcd8
served bundle 第 828 行 = rpc.call(CHANNEL, "heatmap", { year: …, dataSources: dataSource })
```
- ⇒ 浏览器运行的正是磁盘上的 `client.js`，其 heatmap 请求**只含 `{year, dataSources}`** ⇒ rpc 层透传 `filters.from/to` 必然是 no-op。
- 只读性：探针全为 `POST /usage/*`（handler 不写库：`rpc.js:201-207` 只调 `query*`），无 `refresh` 调用；db 访问一律 `readOnly:true`。

### 7.2 只读几何仿真（脚本：`tmp/heataudit/sim-grid.mjs`；真实 `usage.db` + 真实 `heatmapGrid`）

```
range=7天(对齐后)   rows=  5 weeks= 1 gridW= 11 viewBoxW=200 → 比例2.800 格30.8px 画布311px 网格占宽 31/560px months=[9月] peak=1245420086(2026-09-18)
range=30天(对齐后)  rows= 20 weeks= 5 gridW= 67 viewBoxW=200 → 比例2.800 格30.8px 画布311px 网格占宽188/560px months=[8月,9月] peak=1433164245(2026-09-12)
range=90天(对齐后)  rows= 31 weeks= 6 gridW= 81 viewBoxW=200 → 比例2.800 格30.8px 画布311px 网格占宽227/560px months=[8月,9月] peak=1880694444(2026-08-11)
year=2026（现状）   rows= 31 weeks= 6 gridW= 81 viewBoxW=200 → 比例2.800 格30.8px 画布311px 网格占宽227/560px months=[8月,9月] peak=1880694444(2026-08-11)
```

### 7.3 关键代码位置速查（部署 / 源码）

| 语义 | 部署 | 源码 |
|---|---|---|
| heatmap 载荷（唯一） | `client.js:828` | `client.js:252` |
| 范围 useMemo | `client.js:800-806` | `client.js:236-240` |
| 范围选择器 UI | `client.js:1031-1040` | `client.js:421-427` |
| 热力图面板标题 | `client.js:1082` | `client.js:455` |
| 图例/峰值注释 | `client.js:706-709`（legendNote） | **源码副本无此代码**（早期版本，仅 `:189-192` 的「少/多」色阶图例） |
| `viewBox` 下限 200 | `client.js:734` | `client.js:194` |
| `heatmapGrid`（数据驱动） | `client.js:289-361` | `client.js:63-…` |
| rpc heatmap 白名单 | `rpc.js:203` | `rpc.js:199` |
| rpc `year` 校验 | `rpc.js:148-153` | `rpc.js:144-149` |
| db `queryHeatmap` | `db.js:422-444`（`from/to` 被抹于 `:426`） | `db.js:415-…`（`:419`） |
| unit-A 补丁版 `queryHeatmap`（**已支持 from/to**） | — | `lag-fix/tmp/patched/db.js:521+` |
| unit-A 补丁版客户端（**仍只发 year**） | — | `lag-fix/tmp/patched/client.js:890` |

### 7.4 拷贝漂移（影响改动的落点选择）

| 维度 | 部署拷贝（GUI 运行） | 源码副本 `dsh/dsh-usage` |
|---|---|---|
| `client.js` 行数 / sha1-12 | 1147 行 / `30ea5722bcd8` | 487 行 / `27641760…`(md5) |
| heatmap 渲染层 | 月份标签 + 峰值环 + legendNote + tooltip（`667-740`） | **无**月份标签/峰值环/legendNote（`184-195`） |
| rpc 注册姿势 | `ctx.connection.rpc.handle(…,{authority})`（`rpc.js:225`） | `ctx.connection.register(ctx,…)`（`rpc.js:216`） |
| `timeseries` 粒度 | `day`+`hour`（`rpc.js:54`、`db.js:309`） | 仅 `day`（`rpc.js:54`） |
| heatmap 载荷 | `client.js:828` | `client.js:252`（同为 year-only） |

⇒ **改动的第一目标是部署拷贝**（用户可见、`sha1` 与 served bundle 逐字节一致）；源码副本若要同步，只能做**同结构最小同步**（且其 U4/U5 无对应代码，需另行判定是否补齐，属范围扩张，建议不在本单元内做）。

### 7.5 未证实项 / 需要补的观测

1. **浏览器真实像素**：§1.3 的 560px 渲染比例为 CSS+几何推算，未在真实浏览器渲染补丁后 bundle（需 1 次本地渲染截图；`dev/dump-grid.mjs` + `render-preview.py` 可零浏览器产出预览图）。
2. **自选档慢路径的实测耗时**：闸门①不成立 ⇒ 预计 ≈289ms/次（沿用 `reports/probe-A-before.json` 的 heatmap 基线 285–309ms），未在"补丁后 + 自选档"组合下实测。
3. **`usage_daily` 陈旧导致窄窗口静默少计**：未证实存在，也未被现有 harness 覆盖（T1 只在当前快照上校验 daily↔events 镜像）；需"窗口 heatmap vs 直连真值 SQL"用例。
4. **unit-A 补丁当前未落地**：部署 `db.js` sha256 = `802834b56ab3ff400b540279a04534b61b1b996996b539b123b7f9a080160b96`（= unit-A 记录的 pre-patch 值），`rpc.js` sha256 = `3c91ac22…` 未被任何补丁触碰 ⇒ C1 尚未满足。

### 7.6 纪律声明

- 未修改任何插件文件 / 任何他人产物；临时脚本仅落在 `tmp/heataudit/`（`probe-range.mjs`、`sim-grid.mjs`）；本报告为唯一新增交付物。
- 未重启、未 signal、未干扰 PID 20806；未对 `usage.db` 做任何写操作（`readOnly:true`，仅 `SELECT`）。
- HTTP 探针 5 发（≤6），串行单发；未调用 `refresh`/`status` 之外的写路径（`refresh` 亦未调用）。
