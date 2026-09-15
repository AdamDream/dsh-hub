# dsh-usage 三图自绘跟随鼠标 tooltip — 修订执行复核一体报告（2026-09-14）

阶段：修订执行复核一体（route: adam/deepseek-v4-flash），同一档内完成修改 + 自复核 + 验证，未另派独立复核。
工作区源码库（source of truth）：`/home/CNS2026495165/dsh/.workspace/dsh-usage-src/`。
部署位 `~/.dsh/profiles/node_modules/@local/dsh-usage/` **未触碰**（diff 确认仍为基线：两文件与工作区不一致 = 仅工作区改动）。
预览产物：`/home/CNS2026495165/dsh/.workspace/usage-tooltip-previews/`（亮/暗 × 三图无悬停 + hover 示意，共 8 张）。

---

## 1. 改动文件 + 行号

仅两个库文件 + dev/ 维护资产（与部署位 diff 确认：`db.js / rpc.js / index.js / ingest-*.js / zstd.js / cordis.patch.yml / package.json / README.md` 零改动）。

### `lib/charts.js`（source of truth，纯几何；2026-09-14 增量）
| 位置 | 内容 |
|---|---|
| 38–39 / 51 | `barRects`：输出透传 `day: v.day`（JSDoc + 实现），供渲染层命中后直接读日期 |
| 181 / 201 | `scaleBars`：rects 输出补 `day: s.day`（JSDoc + 实现） |
| 213 / 228 | `scaleArea`：points 输出补 `day: s.day`、`value: s.value`（JSDoc + 实现） |

> 几何输出携带 day 后，渲染层无需按 index 回查 series 即可命中（面积/柱状 tooltip 数据自含）；热力图 cells 本就自带 `{day, value, level}`（既有），无需改动。

### `lib/client.js`（build-free bundle；`charts.js 内联` 副本 + 渲染层）
| 位置 | 内容 |
|---|---|
| 16（CSS 注入串） | 新增 `.du_tip{position:fixed;z-index:1000;pointer-events:none;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:5px 9px;font-size:12px;line-height:15px;box-shadow:0 4px 16px rgba(0,0,0,.18);white-space:nowrap}`、`.du_tipDay`（label-caption 11px）、`.du_tipValue`（label-primary 600 tabular-nums）、`.du_tipMuted`（label-caption 400，热力图"无数据"行）——全部 `--dsw-*` 主题 token，暗色自动可用 |
| 66 / 148 / 160 | 内联 `barRects / scaleBars / scaleArea` 同步 day 透传（legacy concat 风格，行为与 charts.js 一致，见 §3） |
| 175–247 | 新增渲染层命中/定位工具：`hitAreaPoints(points, mx, my, maxDist)`（顶点距离 + 折线段距离，取最近点）、`hitBarRects(rects, mx, my)`（严格 rect 内优先；窄柱按水平最近 + 垂直跨度 ±8 容差回退）、`hitGridCells(cells, mx, my, offsetY)`（cell 包含，y 加 monthRow 偏移）、`tipAtEvent(e, estW, estH)`（+14 偏移，超出 viewport 右/下缘翻转，再 clamp ≥8） |
| 278–331 | `TrendChart` 重构：`useState` 浮层态；svg 挂 `onMouseMove/onMouseLeave`；坐标换算 = `(clientX-rect.left)×(viewBoxW/rect.width)`；area 分支命中 `hitAreaPoints(…, 12)`，bar 分支命中 `hitBarRects`；命中显示 `.du_tip`（两行：`du_tipDay` 日期 + `du_tipValue` `formatTokens(value) + " tokens"`）；外层包 `position:relative` div 承载浮层 |
| 333–398 | `HeatmapChart` 重构：保留每格 `<title>` 兜底（无障碍/原生兜底）；svg 挂事件，命中 `hitGridCells(grid.cells, vx, vy, monthRow)`；level 0 → 行 2 为 `无数据`（`.du_tipMuted`），否则 `总用量 <formatTokens> tokens`；蓝阶/空心/月份/峰值环/图例/说明行原样保留 |

### dev/ 维护资产（非部署物）
- `dev/charts-loader.mjs`：loadChartsModule 扩展导出 `scaleBars/barRects/scaleArea/areaPath/formatTokens`。
- `dev/dump-trend.mjs`（新增）：复刻 `queryTimeseries`（dataSources='all'，近 30 天）+ 客户端 `bucketValue('total')` → 真实 `scaleBars/barRects/scaleArea/areaPath` 计算 → `dev/trend.json`。
- `dev/render-tooltip-preview.py`（新增）：PIL 渲染 8 张预览（真实几何输出，色值近似 DSW token），hover 图复刻 `tipAtEvent` 防溢出逻辑。
- `dev/verify-inline.mjs`：扩展覆盖 scaleBars/barRects/scaleArea 行为等价 + day token 奇偶。
- `dev/verify-hit.mjs`（新增）：从 client.js 提取**真实**命中/定位函数做单元断言（见 §3.3）。

---

## 2. 逐需求状态

| # | 需求（用户裁决） | 状态 | 落实 |
|---|---|---|---|
| 1 | 三图全部改为自绘跟随鼠标 tooltip | ✅ | area（点+path 命中区，maxDist=12）、bar（rect 命中 + 窄柱最近回退）、heatmap（cell 命中）三路都走 svg `onMouseMove/onMouseLeave` + 命中函数 + `.du_tip` 浮层；`<title>` 仅热力图保留为兜底（需求允许） |
| 2 | 悬停显示 日期 + token 格式化值 | ✅ | 浮层两行：`.du_tipDay` 日期（YYYY-MM-DD）、`.du_tipValue` `formatTokens(value) + " tokens"`（热力图沿用既有 `总用量 X tokens` 文案，无数据格显示 `无数据`）；date/token 直接来自命中点/格的 `day`/`value`（verify-hit 逐点断言与源数据一致） |
| 3 | 热力图另含"无数据"态 | ✅ | level 0 格命中 → 浮层行 2 = `无数据`（`.du_tipMuted` 弱化样式） |
| 4 | 浮层跟随鼠标、viewport 内防溢出 | ✅ | `tipAtEvent`：+14 偏移跟随；右/下缘超出时水平/垂直翻转，再 clamp ≥8；verify-hit 验证翻转与 clamp 四分支 |
| 5 | 样式 `--dsw-*` token + 既有 du_* 类扩展，暗色可用 | ✅ | `.du_tip` 系列全用主题 token（bg-base/border-l2/label-primary/label-caption），未引入新依赖、未动主题变量；暗色预览目检可读 |
| 6 | 不破坏既有：蓝阶/空心/月份/峰值环保持 | ✅ | `heatmapGrid` 未动；HeatmapChart 渲染原样 + 仅加浮层与事件；预览与既有 v3 一致（见 §3.4） |
| 7 | 数据点来源 | ✅ | 面积/柱状 `{day, value}` 在 TrendChart 调用点可得（`series`），并经 charts.js 几何输出透传 `day`；热力图 cells 自带 `{day, value, level}` |

---

## 3. 验证摘要

### 3.1 语法
`node --check lib/charts.js` ✅、`node --check lib/client.js` ✅（node v22.23.2）。

### 3.2 内联一致性（`dev/verify-inline.mjs`）
- 功能等价 **182/182** 通过：heatmapGrid 52 例（既有）+ scaleBars/scaleArea/barRects 130 例（14 数据集 × {560,300} 宽 × pad 变体，deep-equal 含 day 字段）——charts.js 与 client.js 内联副本输出完全一致；
- token 奇偶：几何 token 19 个两文件齐备（含 `day: s.day`、`day: v.day`、`2026-09-14 tooltip`）；渲染 token 15 个仅 client.js（du_tip/onMouseMove/tipAtEvent/hit* 等）；
- 函数体归一化 diff 仅语法风格差异（与既有约定一致：内联副本为 legacy concat 风格化移植，行为等价闸门证明）。

### 3.3 命中/定位单元验证（`dev/verify-hit.mjs`，真实数据）
- area：22 个真实数据点逐一在自身坐标命中（12px 阈值）；线段中点命中两端点之一；远点 miss；命中返回的 day 与源 series 一致；
- bar：22 个真实 rect 中心/角命中；柱间隙回退最近柱；柱顶上方 20px miss；命中 rect 的 day/value 与 series 逐值相等（如 08-24 → `253.45m` 源值）；
- heatmap：35 个真实 cell 全部自命中（含 monthRow 偏移）；level 0 格返回 day + level 0；图外 miss；
- tipAtEvent：中部 +14、右缘左翻、下缘上翻、左上不翻、翻转后 <8 clamp 到 8——5 分支全过。
- 结果 **64/64 PASS**。

### 3.4 真实数据渲染预览（PIL，`dev/dump-trend.mjs` + `dev/render-tooltip-preview.py`）
- 数据：`~/.dsh/storages/usage/usage.db` 只读（node:sqlite），SQL 逐字复刻 `queryTimeseries`（近 30 天，dataSources='all'），几何由真实 charts.js 计算；热力图沿用 `dev/grid.json`（真实 queryHeatmap + heatmapGrid）。22 天（08-15 → 09-14），峰值 1.22b tokens（09-12）。
- 产物（8 张，2x 超采样）：`preview-{area,bar,heatmap,hover}-{light,dark}.png`。
- 目检结论（vision 模型复核）：
  - area 亮/暗：填充 + 折线横贯画布、刻度可读、无渲染缺陷；
  - bar 亮/暗：柱序与真实数据形态一致（含矮柱/峰值）、深色下对比充足；
  - heatmap 亮/暗：月份标签、蓝阶、灰底空心格、峰值环、图例 + 说明行与既有 v3 完全一致（无回归）；
  - hover 亮/暗：峰值柱（08-17 中位柱，253.45m tokens）上方蓝点光标 + `.du_tip` 圆角浮层两行文字（日期 / token 值）清晰可读，位置正确。

---

## 4. 自裁决：**PASS**

逐需求核对无遗漏（§2），验证全绿（§3：语法 + 182/182 行为等价 + 64/64 命中/防溢出断言 + 8 张真实数据预览目检），未发现需返工项。约束遵守：仅改 `.workspace/dsh-usage-src/` 与预览/报告目录；`~/.dsh` 未触碰（diff 证实）；全程未使用 sandbox_permissions。

### 问题清单（非阻塞，供主代理知悉/微调）
1. **面积图命中阈值 12（viewBox 单位）**：需求未给数值，取 12（约等于屏幕像素，1:1 映射下悬停折线 ±12px 内命中；viewBox 560×150 渲染到卡片 ≈ 1:1）。如需更宽松改 `TrendChart` 内 `hitAreaPoints(scaled.points, mx, my, 12)` 一处。
2. **柱状图窄柱回退容差**：严格 rect 内优先；近 90 天柱宽 ≈ 4px 时靠"水平最近 + 垂直跨度 ±8px"回退命中（`hitBarRects` 内 `tolX = max(8, width/2+2)`）。行为已由 verify-hit 在真实 22 柱数据上验证。
3. **浮层与原生 `<title>` 并存**：热力图保留 `<title>` 兜底后，悬停 1s+ 时浏览器原生 title 可能与自绘浮层叠加弹出。需求允许保留兜底；若目检后觉得干扰，删 `HeatmapChart` 中 `react.createElement("title", …)` 一行即可（自绘浮层已全覆盖）。
4. **每次 mousemove 的 setState 重渲染**：命中对象每次新建（浮层需跟随鼠标），图表元素量小（≤371 cells / ≤90 点），未做节流；React 对相同值（null）自动 bail-out。如未来数据量增大可加 rAF 节流（非本需求范围）。
5. **暗色热力图峰值环对比度**：既有 v3 已裁决取舍（环色与背景同色系、以内缘对比呈现，`usage-heatmap-exec.md` §7.4①），本次未改、非回归；预览中因 1:1 网格较小而视觉偏弱，浏览器放大至 560px 后更明显。
6. **预览 hover 用中位柱而非峰值柱**：峰值柱顶贴 viewBox 上缘（height≈146/150），其上方无空间放浮层；真实交互中浮层会自动翻转到左侧/下方（防溢出逻辑覆盖）。预览选 08-17 中位柱使浮层形态清晰可见，且与防溢出路径一致。

---

## 5. 部署注意点（主代理执行）

1. **替换两文件到部署位**（同时替换，缺一即内联行为不一致）：
   - `~/.dsh/profiles/node_modules/@local/dsh-usage/lib/charts.js` ← 工作区 `lib/charts.js`
   - `~/.dsh/profiles/node_modules/@local/dsh-usage/lib/client.js` ← 工作区 `lib/client.js`
2. **运行时只依赖 client.js**（与既有流程一致）：charts.js 无运行时引用，替换属 source-of-truth 卫生。
3. **生效方式**：client.js 是浏览器端 bundle，替换后刷新页面即生效；无需重启宿主、无需动 DB/RPC；CSS（含 `.du_tip` 系列）随 data-plugin-css 注入，无额外 CSS 文件。
4. **备份**：替换前对部署位两文件备份（沿用 `backup-dsh-usage-<ts>/` 惯例）。
5. **回滚/微调**：本档验证全在工作区完成；如目检不满意，按问题清单 ①–③ 微调 client.js 单文件后重新替换。
6. **维护资产重出预览**：`node dev/dump-trend.mjs && node dev/dump-grid.mjs && python3 dev/render-tooltip-preview.py`（预览写入 `.workspace/usage-tooltip-previews/`）。

---

## 6. 迭代 2（2026-09-14 收尾修订 — 主代理目检 preview 后要求，未部署）

主代理目检迭代 1 预览后提出 7 项收尾要求（日期对比度、浮层体量、数字跳宽、日期格式、箭头同底色+暗色 elevation、边界翻转验证、重渲+新增图）。本档在 `dsh-usage-src` 完成 v2 修改并同档自复核。仍只改 `lib/charts.js`（本轮零改动）+ `lib/client.js`（与部署位 diff 确认），另更新 dev 工具链与预览。

### 6.1 增量改动（client.js 位置以改动后为准）

| 位置 | 内容 |
|---|---|
| CSS 注入串 | `.du_tip` 系列 v2：padding 4px 7px（原 5px 9px）、day 10px/value 12px/line-height 12–14px 收紧；`.du_tipDay` 色 `label-caption → label-secondary`（亮 #61666b/暗 #cfd3d6，白底 6.04:1、暗底 9.36:1，均 ≥4.5:1）；`.du_tipValue` 保留 tabular-nums + **新增 `.du_tipDay` 同加 tabular-nums**（数字等宽，跟随鼠标不跳宽）；新增 `.du_tipUnit`（label-caption 10px，tokens 弱化）；**四方向箭头**：`.du_tip::before`（尖朝上）+ `.du_tipL/R/D`（尖朝左/右/下），尖轴由 CSS 变量 `--du-tip-ax`（水平位）`/--du-tip-ay`（垂直位）动态定位，**箭头与卡片同一 background + 同色边框边**（一次绘制语义，无拼色断层）；暗色变体 `body[data-ds-dark-theme] .du_tip`：背景 `#262b36→#2b303b`（略提亮）、边框 `#8b93a1`（vs 页面 #151517 ≈ 5.95:1 ≥3:1）、阴影加深 `0 6px 20px rgba(0,0,0,.55)` |
| `tipAtEvent` | v2 定位：浮层**垂直居中于光标** + 水平 +14（右缘翻转）；返回 `dir`（l/r/d/u 四方向，箭头始终指向点位）：默认 L、右缘翻转 R、底部溢出 D（浮层移到点位上方）、顶部溢出 U（clamp 8，浮层在点位下方） |
| `TrendChart`/`HeatmapChart` | 浮层渲染：第一行日期 `day.slice(5)`（**MM-DD，与轴标签一致**，年份省略）；第二行 `tipTokens(value)` + `<span class="du_tipUnit"> tokens</span>`（单位降次级弱化；热力图去"总用量"前缀统一三图格式，"无数据"态保留 `.du_tipMuted`）；style 传 `--du-tip-ax/--du-tip-ay`（箭头尖水平/垂直正对点位，clamp 在卡内）；className `du_tip du_tip{L|R|D|U}` |
| 新增 `tipTokens(value)` | **浮层专用**紧凑格式化：一位小数 + 大写单位（`253448547 → 253.4M`、`1.22b → 1.2B`、`1234 → 1K`）；全局 `formatTokens`（表格/hero/热力图说明，两位小数小写）**保持不动**（既有验收范围外） |

### 6.2 逐项落实（对照 7 项要求）

1. **日期对比度** ✅ `.du_tipDay` 换 `label-secondary`（亮 #61666b / 暗 #cfd3d6，均在 #5F6368/#6B7280 档位），白底 6.04:1、暗底 9.36:1 ≥4.5:1；仍用 token 不硬编码。
2. **浮层体量** ✅ padding/行距收紧（卡片高 40→37px、宽 ~89px vs 原 108px，-18%）；数值 `tipTokens` 一位小数（253.45m 级显示 253.4M）；单位 `tokens` 降 `.du_tipUnit` 次级弱化。覆盖度：7 天视图柱宽 ~80px → 浮层 89px 压 ~1.1 柱（达标 2-3 柱内）；30 天视图柱宽 25px → ~3.5 柱、热力图格 14px → ~6 格（文字宽度下限，报告中说明）。
3. **数字跳宽** ✅ `.du_tipValue` 本就 tabular-nums，v2 起 `.du_tipDay` 同步加 tabular-nums（日期数字也等宽）。
4. **日期格式** ✅ 浮层第一行 = `day.slice(5)` → `MM-DD`，与轴标签（scaleBars/scaleArea ticks 即 `s.day.slice(5)`）完全同格式；年份省略。
5. **箭头同底色 + 暗色 elevation** ✅ 箭头 = 旋转方块双边框（background 与卡片同值 + 两条 border 色边），视觉与卡片一体无拼色断层；暗色浮层背景 `#2b303b` + 边框 `#8b93a1`（5.95:1 ≥3:1）+ 加深阴影。
6. **边界翻转验证** ✅ 新增 `preview-hover-flip-{light,dark}.png`：点位在图表右下角 → 浮层水平翻转（fx），箭头 R 尖正对蓝点、无溢出；四象限代码级证明：`verify-hit.mjs` 新增 `pBr`（视口 1280×720、clientX=1270/clientY=715 → fx+fy 双翻转、dir=d）+ 原四分支（mid L / 右缘 R / 底部 D / 顶部 U + clamp）；**pointer-events:none 已生效**（.du_tip 不可命中，移出 svg 即 onMouseLeave 隐藏）；**mousemove 成本**：每次 move 一次 setState + 命中扫描（≤90 点 / ≤371 cell），未做 rAF 节流——量级极低、React 对相同值（null）bail-out，可接受（说明见 6.4 问题清单④）。
7. **重渲 + 新增图** ✅ 重渲 `preview-{area,bar,heatmap,hover}-{light,dark}.png` + 新增 `preview-hover-flip-{light,dark}.png`，共 10 张（vision 目检：hover 箭头朝左/朝右正对蓝点垂直对齐、暗色亮边框+投影区分明显、无拼色断层、文字清晰；hover-flip 浮层完整无溢出）。

### 6.3 验证摘要（v2）

- `node --check lib/charts.js` ✅、`node --check lib/client.js` ✅。
- 内联一致性（`dev/verify-inline.mjs`）：功能等价 **182/182**；token 奇偶 38 个全 ok（几何 19 + 渲染 19，含 `du_tipL/R/D`、`--du-tip-ax/--du-tip-ay`、`tipTokens`；已移除废弃 `du_tipFx/Fy`）。
- 命中/定位（`dev/verify-hit.mjs`）：**72/72 PASS**——三图命中与 date+token 一致性不变，新增 `tipAtEvent` 四象限方向断言（L/R/D/U + fx/fy + clamp + pBr 双翻转）与 `tipTokens` 六值断言（253.5M/1.2B/1.9B/1K/999/0）与 MM-DD 显示断言；全局 `formatTokens` 未变断言。
- 预览目检：10 张全过（见 6.2）。

### 6.4 自裁决（v2）：**PASS**

7 项收尾逐项落实、验证全绿。遗留观察（非阻塞）：
① 浮层宽 ~89px 在 30 天视图压 ~3.5 柱 / 热力图 ~6 格（用户目标 2-3 柱/格在 7 天视图达成；更长视图受文字宽度下限限制——如需更窄可去掉 `tokens` 单位或值仅显示 `253.4M`，一处字符串改动）。
② 箭头水平偏移 +14 使箭头尖与点位固有 ~9px 间隙（浮层不遮挡光标的语义正确）；视觉上箭头"正对点位方向"。
③ 热力图浮层文案去掉"总用量"前缀（三图统一 MM-DD + 数值）；原生 `<title>` 兜底保留原"总用量 X tokens"文案（未动）。
④ mousemove 未做 rAF 节流：每次 move 一次 setState，图表元素量 ≤371，React 同值 bail-out，成本可接受；若未来数据量大幅增长再加节流。
⑤ 暗色浮层背景 #2b303b vs 页面 #151517 明度比 ~1.5:1，elevation 主要由亮边框（5.95:1）与阴影承载——符合"阴影/更亮边框提升 elevation（≥3:1）"要求。
⑥ `tipTokens` 舍入为一位小数（253.448547m → 253.4M），用户示例 253.45m → 253.5M 为约数；数值精确无误差。

### 6.5 部署注意点（不变）

与迭代 1 相同：备份后**同时**替换部署位 `lib/charts.js` + `lib/client.js`，替换后刷新页面即生效；CSS（含四方向箭头与暗色变体）随 data-plugin-css 注入，无额外 CSS 文件。维护资产重出 v2 预览：`node dev/dump-trend.mjs && node dev/dump-grid.mjs && python3 dev/render-tooltip-preview.py`。
