# Audit C — usage 插件（热力图+tooltip）与识图提示词（独立交叉审计）

- 日期：2026-09-15
- 审计子代理：adam/deepseek-v4-flash（两阶段闭环·审计阶段）
- 方法：以部署位文件与工作区源码的真实内容为准，逐项取证（文件:行号）+ 判定；只读，未改任何代码。
- **总体裁决：通过（5/5 项全部 PASS，无需修改）**。4 条非阻塞观察见文末。

---

## 1. usage 部署一致性 — PASS

| 文件 | cmp | sha256 | node --check |
|---|---|---|---|
| `~/.dsh/profiles/node_modules/@local/dsh-usage/lib/charts.js` vs `.workspace/dsh-usage-src/lib/charts.js` | IDENTICAL | `e1514fd0e9ec8abe57fd2aaa7b5fbaaac9b88d685dd32b0f3982e1181daa8fb7`（两端一致） | OK |
| `~/.dsh/profiles/node_modules/@local/dsh-usage/lib/client.js` vs `.workspace/dsh-usage-src/lib/client.js` | IDENTICAL | `f62812d12d50264f7b957b38db2c2d92922fd101175cf2b4150dd6a3019f7130`（两端一致） | OK |

- 证据：`cmp` 逐字节一致；`node --check` 双文件通过（charts.js / client.js 均无语法错误）。
- 范围外完整性（顺带核实）：dsh-usage lib 全部 8 个 .js（charts/client/db/index/ingest-cc/ingest-dsh/rpc/zstd）部署与源码均 SAME；dsh-btw 部署副本 `profiles/node_modules/@local/dsh-btw/lib/index.js` 与 `dsh-btw/lib/index.js` 亦 SAME。

## 2. 热力图重设计 — PASS

- **FILLS = --du-heat-0..6（7 项）**：charts.js:156-164；client.js 内联副本 32-40 一致。
- **双主题色带**（CSS 注入串，client.js:16）：
  - 亮色 `body{--du-heat-0:#f3f4f6 … --du-heat-6:#1e3a8a}`（近白→深蓝）✓；
  - 暗色 `body[data-ds-dark-theme]{--du-heat-0:#2f3540 … --du-heat-6:#bfdbfe}`（深→亮蓝，"越多越亮"）✓。
- **--du-heat-0 空心+stroke**：charts.js:130-131 与 client.js:121-122（level 0 → fill `var(--du-heat-0)`、stroke `var(--du-heat-0-stroke)`、strokeWidth `var(--du-heat-0-stroke-width)`）；CSS 中亮色 `#9ca3af / 1px`、暗色 `#8b93a1 / 1.5px` ✓。
- **月份列居中（dataMonths + textAnchor）**：charts.js:96-113（dataMonths 集合 + 按列 span 求中心 x，注释明确 text-anchor middle in the client）；渲染侧 client.js:386 `textAnchor:"middle"`；窄网格（≤4 周）折叠为首/末月（charts.js:144-147）✓。
- **峰值环**：client.js:380-383（`isPeak` → stroke `var(--du-heat-peak-stroke)`、strokeWidth 2）；CSS 亮色 `#ffffff`、暗色 `#0f1115` ✓（峰值格亮色为最深蓝、暗色为最亮蓝，环为对向色，可见性成立）。
- **说明行（单位+峰值+日期）**：client.js:391-392 `"单位 tokens/日 · 灰格 = 无数据 · 峰值 " + formatTokens(grid.peak) + " tokens/日（" + grid.peakDay + "）"` ✓。
- **CSS 注入串含 .du_tip 系列与 --du-tip-ax/ay**：client.js:16-24（style 注入 + data-plugin-css 去重）；串内含 `.du_tip`、`.du_tipL/R/D/U`、`--du-tip-ax`、`--du-tip-ay` 等全部 token ✓。
- **内联副本一致性**：charts.js 的 6 个导出（areaPath/barRects/heatmapGrid/scaleBars/scaleArea/formatTokens）在 client.js 内联区全部存在；heatmapGrid 内联（client.js:69-140）与源（charts.js:75-149）逐逻辑比对一致（levels=6、peak/peakDay、dataMonths 中心 x、narrow 折叠、FILLS 引用）。client.js:26 标注 `charts.js 内联` 同步标记 ✓。

## 3. tooltip 迭代 2 — PASS

- **.du_tipDay 用 label-secondary**：CSS `.du_tipDay{color:var(--dsw-alias-label-secondary);…}`（client.js:16 内）。语义 token 由 DS 主题保证对比度（亮/暗主题下 tooltip 底分别为 #ffffff / #2b303b，label-secondary 均为主题内高对比灰色系）。
- **tipTokens（一位小数+大写 M）**：client.js:255-266（1e6 → `(n/1e6).toFixed(1)+"M"`；1e9 → "B"，1e3 → "K"）✓。
- **tabular-nums**：`.du_tipDay` 与 `.du_tipValue` 均含 `font-variant-numeric:tabular-nums` ✓。
- **MM-DD 格式**：client.js:349（TrendChart）与 407（HeatmapChart）`tip.day.slice(5)` → "MM-DD" ✓。
- **四方向箭头**：CSS `.du_tipL::before`（左缘指向左）、`.du_tipR::before`（右缘指向右）、`.du_tipD::before`（下缘指向下）、U 向复用默认 `.du_tip::before`（上缘指向上，无独立 .du_tipU 规则——由注释 client.js:240-243 说明为设计意图）；暗色覆盖 `body[data-ds-dark-theme] .du_tip{background:#2b303b;border-color:#8b93a1}` + 四方向箭头边框 `#8b93a1` 全覆盖 ✓。
- **暗色 bg #2b303b + 边框 #8b93a1**：CSS 暗色覆盖块确认（box-shadow 亦随暗色增强）✓。
- **命中/翻转函数存在且逻辑自洽**（逐行核对）：
  - `hitAreaPoints`（client.js:180-204）：顶点距离 + 折线段投影距离取最近，段命中时取近端端点（`t<0.5 ? i : i+1`）——自洽。
  - `hitBarRects`（client.js:205-226）：先严格包含命中，窄柱退化为水平最近 + 垂直容差 ±8——自洽。
  - `hitGridCells`（client.js:227-235）：`offsetY` 抵消 `monthRow`，与渲染 `<g transform="translate(0,16)">`（client.js:419）一致——自洽。
  - `tipAtEvent`（client.js:236-254）：右缘溢出 `fx` → `left = clientX-estW-14`、dir="r"；底部溢出 → top=vh-estH、dir="d"；顶部溢出 → top=8、dir="u"；否则 dir="l"——四分支与 CSS 箭头方向一一对应，自洽。
  - 调用侧：TrendChart onMove（client.js:337-350）与 HeatmapChart onMove（client.js:393-408）均按 viewBox 坐标换算命中、ax/ay 钳制 10..92、`tip.dir.toUpperCase()` 拼 class，与 CSS 类名吻合 ✓。

## 4. 识图提示词 — PASS

- **部署一致性**：`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js` 与 `.workspace/deploy-vision-prompt/index.js` sha256 一致（`54ac2548ff3215b0837185de6949c6bd796e0de637877997f5fb5587cffe8ae8`），cmp IDENTICAL。
- **analyzeImageBytes 三分支**（index.js:147-153）：question 分支（149-150，含 "In any case, transcribe the entire visible content…" + "aesthetic and design-rationale analysis"）、video 分支（151-152）、默认 image 分支（153）——三分支均含「transcribe the entire visible content…」与「aesthetic and design-rationale analysis」✓。
- **工具 description 追加句**：index.js:238 结尾 "Use this whenever you need to understand what is in an image or video. The returned description prefers a complete transcription of the visible content (text, layout, colors, element positions) plus an aesthetic/design-rationale assessment when applicable." ✓。
- **vision.ts:46 VISION_DEFAULT_QUESTION**（`dsh-btw/src/host/vision.ts:46`）：`'请用中文尽可能完整转录这张图片的全部可见内容（文字逐字、布局、颜色、元素位置），并附审美与设计合理性分析（配色、层级、对齐、可读性、改进建议）。'` 含「完整转录+审美」✓；并由 analyzeImages（vision.ts:117）作为 question 传入 analyzeImageBytes 的 question 分支。
- **systemPrompt（:229-233）不含强提示——位置语义确认**：`ctx.systemPrompt.section({name:"tool:analyze-image", order:100, text:"Use the analyze_image tool…Prefer it whenever a task mentions an image or video file…"})` 是写给**主会话模型**的工具使用提示（何时该调 analyze_image），不是注入 vision 模型的指令。vision 模型请求体（index.js:161-178）仅含一条 `role:"user"` 消息（analyzeImageBytes 的 prompt + 媒体 part），无 system 消息、无任何外部注入文本。即：主会话 systemPrompt 提示与 vision 模型调用完全隔离，vision 模型只会看到 analyzeImageBytes 生成的提示 ✓。

## 5. settings 联动 — PASS

- **vision-adam 段**（`~/.dsh/settings.yaml:135-139`）：`model: deepseek-v4.1-flash` / `baseURL: https://opencode.ai/zen/go/v1`（opencode）/ `apiKeyEnv: OPENCODE_GO_API_KEY` / `maxTokens: 393216` — 与插件 Config 字段（index.js:66-78）一一对应；maxTokens 无上限约束（`.min(1)`），393216 合法；未设 xApiKey/sessionHeader 走默认 true（三头认证）✓。
- **与 usage 无冲突**：usage 插件注册的是独立 settings 命名空间 `dsh-usage`（index.js:67-70，空 schema），与 `vision-adam` 命名空间不同、无共享键；settings.yaml 中亦无 dsh-usage 段。两个插件均已在 web profile 启用（`cordis.patch.yml:5-6` vision-adam、`28-29` usage）✓。
- **跨模块默认一致**：vision.ts VISION_DEFAULTS（vision.ts:38-43）与插件默认（index.js:33-39）一致，settings 覆盖关系清晰（readVisionConfig 优先 settings，缺省降级默认）✓。

---

## 非阻塞观察（不影响裁决）

1. `tipAtEvent`（client.js:253）返回的 `fx`/`fy` 字段调用侧未消费（调用方只取 left/top/dir/ax/ay）——死字段，可留可清。
2. U 向箭头无独立 `.du_tipU::before` 规则，依赖默认 `.du_tip::before` 兜底（暗色下由 `body[data-ds-dark-theme] .du_tip::before` 覆盖，行为正确）；若未来改动默认箭头位置需同步留意 U 向。
3. 亮色主题 tooltip 底为 `#ffffff`（非审计要求项，仅记录）；峰值环在"峰值落于 level-1 浅色格"的极端数据下对比度偏低（亮色 #fff 环 + #dbeafe 格），正常峰值（深色格）无碍。
4. tipTokens 的 K 分支为 `toFixed(0)`（无小数），与"一位小数"描述仅对 M/B 成立——属既定取舍（注释 index.js 内 client.js:256-259 已说明），非偏差。

## 审计结论

**判定：通过 / 无需修改。** 五项审计范围全部以真实文件取证 PASS；未发现部署漂移、逻辑不自洽或与目标描述的偏差。可进入后续环节（如需）。
