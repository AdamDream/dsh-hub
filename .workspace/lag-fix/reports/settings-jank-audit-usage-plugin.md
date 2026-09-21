# 设置页「插件」标签挂载 `dsh-usage`：只读同步查询/轮询/渲染审计

- 审计对象：设置页各标签，重点「插件」标签内 `@local/dsh-usage`。
- 纪律：只读；未点击保存/应用/删除/确认；未改源码、配置、部署件；未重启宿主；未对 `/usage/refresh` 做探针调用。
- 证据基线：源码 `dsh-usage/`、部署件 `~/.dsh/profiles/node_modules/@local/dsh-usage/`、已有 `audit-client.md`、`unit-A.md`、`copy-drift.md`、`audit-cross-client.md`。

## 1. 结论摘要

1. **首次挂载不是串行请求瀑布**：`UsageCard` 初始 effect 同时启动 `loadAll`、`loadSessions`、`loadStatus`；`loadAll` 内再用 `Promise.all` 并发 6 个查询。因此可见网络层是两层并发批次，而不是 6 个 heatmap→trend→table 的串行瀑布。证据：`dsh-usage/lib/client.js:308-340,342-370`。
2. **存在高成本端点**：`heatmap` 查询曾在宿主事件循环占用约 285–309ms，配对背景探针最大约 265–272ms；`unit-A.md` 的只读等价性/计划复核显示补丁后的离线 `queryHeatmap` 约 0.081ms，但宿主真实重启后数字按既有报告仍属待实测。不要把离线数字写成端到端已证实。
3. **轮询是 60s 默认，且代码有可见性门控**：`setInterval` 位于 `client.js:371-387`，依赖 `[refreshSec,pollVisible]`，检查 `document.hidden`，可见性由 `IntersectionObserver`（`218-253`）驱动；observer 在 ref callback 中断开/重连。已有 `DECISIONS.md` 记录曾发现 A-gating 死代码并修复；当前源码已有 `setPollVisibleRef.current = setPollVisible`（`224-227`）。
4. **轮询 effect 只包住 `loadAll`，首次挂载和筛选变化仍会立即发完整批次**：`loadAll/loadSessions/loadStatus` 的初始 effect 无可见性门控（`366-370`）；手动刷新还会调用 `refresh`（写入/ingest，应避免在审计探针中触发）后再加载两组查询（`388-398`）。因此「滚出视口后零请求」只能声称对定时器周期成立，不能声称首次加载/手动刷新均不请求。
5. **客户端 heatmap 仍只发 `{year,dataSources}`**：`client.js:318`；RPC `rpc.js:199` 又只白名单传 `{year,dataSources}`。所以范围选择器不影响热力图，已有 `audit-heatmap-range.md` 的 A/B 逐字节相同证据支持这一点。趋势/summary 等则携带 `from/to`（`client.js:307,316-317,319-321`）。
6. **SVG/DOM 规模是数据线性项**：`HeatmapChart` 每个 grid cell 生成一个 `<rect>`（源码 `client.js:183-195`）；`heatmapGrid` 会按数据覆盖周数生成 `weeks*7` cells，甚至包含零值格（部署 `client.js:289-360`）。趋势也按 points/ticks 生成 SVG children。已有浏览器证据：插件页约 962 节点；用量卡片 `du_*` 节点 59（`audit-cross-client.md:101-111`），当前部署特性（trend hourly fallback、month labels、peak ring）来自部署侧超集，不能用简短 source 版替换部署版。
7. **低危但已证实的 UI 回归：重复 option**：部署实测刷新下拉 5 项：`0,5,60,30,60`，重复「60s 刷新」。根因与建议见 `audit-cross-client.md:227-247`、`copy-drift.md`：补丁规格把 60s 做成前插而非替换；这不改变实际默认周期，但造成重复视觉/选择歧义。
8. **插件 tab 的生命周期是设置壳层的主要累积风险**：已有 `audit-client.md:85-92` 证实 visited tab 只 `hidden` 不卸载；访问过的标签 DOM/订阅会单调累积，插件页实测为八 tab 中最大（962 节点）。这不是 `dsh-usage` 自己的 timer 泄漏证据，但会让 usage 卡片及其它插件在长会话中共同驻留。
9. **宿主插件有独立 45s ingest 定时器**：`dsh-usage/lib/index.js:142-164`：microtask 打开 DB、首次 `runIngest()`，随后 `ctx.setInterval(runIngest, INGEST_INTERVAL_MS)`，无 ctx.setInterval 时退回原生 interval；`index.js:167-184` 的 lifecycle dispose 清理 timer 并 close DB。该定时器属于插件宿主生命周期，不是设置页打开触发；它可能与页面查询争用同一 Node 主线程/SQLite，但本审计没有制造并发写入或压测。

## 2. 已证实机制

### 2.1 请求批次与请求瀑布

- 初始渲染：effect 同步调度 `loadAll/loadSessions/loadStatus`，三者异步并发。
- `loadAll` 的 6 个 RPC：`summary`、`timeseries(day)`、`heatmap`、`byModel`、`byProject`、`byDay`，由一个 `Promise.all` 发出；任一失败则整个批次显示错误（`client.js:315-337`）。
- `loadSessions` 另发 `sessions`，limit=200（`342-356`）。`loadStatus` 发 `status`（`357-365`）。
- 轮询周期只重复 `loadAll`，不会重复 `sessions/status`（`371-387`）。筛选/日期状态改变会因 `loadAll/loadSessions` callback identity 变化而触发初始 effect，再次请求；`loadAllRef` 使 interval callback 不随筛选变化重建，但初始加载仍发生。
- `refresh` 是显式手动刷新路径，调用 ingest 后再加载 all+sessions；不要在只读审计中点击它。

**判定**：网络批次是「三路启动 + loadAll 内六路并发」，非串行瀑布；但每次筛选变更/重挂载仍可产生批量请求簇，宿主端点耗时会叠加到一次 UI 更新窗口。

### 2.2 IntersectionObserver、轮询与清理

- `attachCardRef` 先断开旧 observer，再绑定新 node；卸载时 React ref callback 收到 null，断开并清空 `ioRef`。
- Intersection callback 通过 setter ref 改 `pollVisible`；缺少该赋值时门控会退化为永远可见，已有 `DECISIONS.md` G1 记录曾捕获此问题；当前源码已存在修复行。
- timer cleanup 是 effect return `clearInterval(timer)`；依赖 refreshSec/pollVisible 改变时重建，`document.hidden` 在 interval callback 内二次检查。
- 当前源码对 observer/timer 的清理有实现；**尚未有本报告独立的真实浏览器 mount/unmount 计数**。已有 `unit-A.md:298` 明确 mock Hook/commit 不等价，IntersectionObserver 真实触发仍列为未验证。

### 2.3 趋势/热力图 SVG

- 热力图：`heatmapGrid` 对排序后的 days 建 map，然后生成 `weeks*7` 个 cell；React 对每 cell 建一个 SVG rect。数据行越宽、跨周越大，零值格也会生成。
- 部署版加入月标签、peak、stroke/strokeWidth、hourly trend 等特性（`copy-drift.md:53-67`）；source/deployed 是独立拷贝且漂移，禁止整文件覆盖。
- 证据中的插件卡片为 59 个 `du_*` 节点；插件 tab 总约 962 节点。未有本轮独立的逐元素 SVG count，因此具体 rect 数应以运行时 DOM 查询为准，不应臆填。

## 3. 推测/风险（不要当成已证实）

- **推测：宿主 ingest 与页面批次相互阻塞**。`runIngest` 可能与 `/usage/*` 同一 Node 线程/SQLite 连接竞争；但本次未触发 refresh、未改写 DB、未做并发压测，不能把它写成已证实根因。
- **推测：visited tabs 的 hidden 保留会放大 usage 卡片的长期重渲染成本**。代码路径/节点累积已证实，具体每秒 CPU 或每帧 rerender 尚未在活跃会话+全 tab 访问条件下测量。
- **推测：Promise.all 的响应完成后多个 setState 会导致高成本 SVG/表格重算**。React 18 通常会批处理，但本轮未录 React commit/profile，不能声称一定产生 6 次独立提交。
- **推测：SVG 大规模本身造成严重卡顿**。目前实测安静态设置不是热源；`audit-client.md:104-129` 显示模型页 12s script 仅 9ms、面板 0 次 DOM 变化。严重卡顿需要活跃会话 churn 等外部热源。

## 4. 反例与边界

- 安静条件下，打开设置反而使主线程脚本时间下降（326ms→264ms/12s；模型页 9ms/12s），面板子树 0 次 DOM 变更（`audit-client.md:104-129`）。因此不能归因「打开插件页必然持续卡顿」。
- `dsh-usage` 自身 bundle 全量检索中，设置页插件代码没有 `requestAnimationFrame/MutationObserver/ResizeObserver` 等渲染循环；已有 `audit-client.md:65-73` 还证实设置 bundles 无自身 interval/observer，但该结论不应覆盖 dsh-usage 当前新增的 observer/timer。
- 轮询设置为 0 时 `refreshSec<=0` 直接 return；标签页隐藏/卡片不可见时 timer 不建立或 callback 跳过，但初始请求不因此消失。
- 热力图 RPC 的 year-only 形状意味着 UI 的近 7 天选择器不会缩短 heatmap 数据窗口；已有 `audit-heatmap-range.md` 仿真指出窄范围若未来接通会改变网格宽度，当前不能假设已接通。

## 5. 选择器、负载和只读探针前提

已有真实 GUI 证据使用：打开设置入口后点击文本标签「插件」；用量卡片可用 `[class*="du_root"]`，刷新选择器可用 `.du_select`；插件面板总量和 tab 切换来自 aria/text 选择器。选择器可能受 CSS hash 或多实例影响，探针应先断言唯一性再观测，禁止盲点写状态按钮。

建议只读探针负载记录：单浏览器实例、请求数控制在「一次设置打开 + 一次插件 tab + 必要的短时静置」；不调用 refresh、不选择模型、不点应用/保存；记录 `document.querySelectorAll('[class*="du_root"]')`、`.du_select option`、`svg.du_svg`、`svg.du_svg rect`、插件面板节点数，并监听 `/usage/` 请求计数。若需要验证活跃会话放大器，必须单独记录 WS 帧/s、会话是否流式、窗口长度与是否访问过其它 tabs，不能拿不同负载点值直接比较。

## 6. 最小验证实验（建议顺序）

### E1：确认初始请求拓扑（低负载、只读）

1. 新开单一浏览器页，监听 request URL/method/timestamp/response duration。
2. 只打开设置→插件，不点刷新/保存/应用；等待 3 秒。
3. 预期：首批为 `summary,timeseries,heatmap,byModel,byProject,byDay,sessions,status`，其中前 6 个同一 `loadAll` 批次并发；随后 60s 内不应有第二个 `loadAll` 周期。
4. 记录选择器断言、总请求数、响应时间，不把页面加载自身的 bundle/RPC 混入 `/usage/*` 计数。

### E2：验证可见性门控和真实清理（低负载）

1. 在同一插件卡片上先确认 `.du_root` 唯一，再记录 70s `/usage/*` 请求。
2. 首次进入后滚出 `.du_root`（优先滚动其真实滚动容器，不假定 window）；保持 70s，再滚回并记录。
3. 预期：滚出期间定时器周期请求为 0；滚回后下一个可见周期恢复。切离设置/卸载卡片后记录 observer/timer 不再增加请求。
4. 若滚出仍有请求，首先判定是否是首次 load 或其它重复实例，不直接归因 IO 失效；同时在 DevTools/注入包装器记录 observer 数量和 callback 次数。

### E3：请求瀑布/宿主阻塞配对（谨慎、只读）

1. 复用已有 `probes/usage-host-latency.mjs --pairs`，只打读端点；n≤3，记录背景探针 max 与 heatmap duration。
2. 仅比较同一宿主 PID、同一 DB、同一时段；补丁前后的真实端到端门槛需宿主重启后再测。不得把离线 `0.081ms` 代替 HTTP/Node wall-clock。

### E4：SVG/DOM 规模扫描（不改状态）

在插件标签静止 2 秒后采样：`du_root` 节点数、所有 `svg.du_svg` 的 rect/path/text 数、表格行数、插件 tab 总节点数；再切换一个只读 tab 或滚动离开，重复采样。依次访问其它插件 tabs 后观察 DOM 是否单调增加。记录是否存在多个 `.du_root`，以排除 visited hidden 造成的重复 usage 实例。

### E5：重复 option 回归最小复现

只读读取 `.du_select` 的 `Array.from(select.options).map(o=>({value:o.value,text:o.textContent}))`，断言 value=60 的数量。当前已有实测为 2；不要调用 `select.value=` 或 dispatch change。若修复后复验，要求部署 bundle、source 替换规格与 served sha1 三者一致，并重做 E1/E2。

## 7. 证据索引

- `.workspace/settings-lag/audit-client.md`：设置页热源边界、visited tab 不卸载、DOM/活体数据、安静态反例。
- `.workspace/lag-fix/reports/unit-A.md`：heatmap/轮询补丁、读库等价性、离线与宿主待验证边界。
- `.workspace/lag-fix/reports/copy-drift.md`：source/deployed 独立拷贝和功能漂移，禁止整文件覆盖。
- `.workspace/lag-fix/reports/audit-cross-client.md`：真实 GUI 8 标签冒烟、用量卡片 59 节点、重复 60s option、探针负载纪律。
- `.workspace/lag-fix/reports/audit-heatmap-range.md`：heatmap 忽略 from/to 的请求/应答证据与网格边界。
- `dsh-usage/lib/client.js:210-398`：状态、初始批次、heatmap 调用、IO、轮询生命周期。
- `dsh-usage/lib/index.js:137-184`：宿主 DB/ingest/45s timer/lifecycle cleanup。
- `dsh-usage/lib/rpc.js:180-219`：RPC 白名单与注册清理。
- `dsh-usage/lib/charts.js:1-176`、部署 `lib/client.js:289-360`：纯 SVG 几何与部署侧增强。

## 8. 最终判定

**已证实**：并发批次而非串行瀑布；60s interval + IO/hidden 门控及 timer/observer 清理代码；heatmap year-only 请求；SVG cell 线性生成；插件 tab visited hidden 累积；重复 60s option；宿主 45s ingest lifecycle timer；历史热力图阻塞基线。

**推测**：ingest 与查询竞争、visited tab 对 usage 的长期放大、Promise.all 后 commit 规模、SVG 是否单独造成严重卡顿。

**反例**：安静态设置打开不产生面板变更/严重卡顿；refresh=0/hidden/not-visible 不应建立轮询 timer；当前近 N 天选择不改变 heatmap 请求。

本报告没有把未重启宿主的离线性能、未在真实活跃流量下测得的面板重渲染、或未执行的浏览器 observer 回调计数写成事实。

## 9. 生命周期补充：host bootstrap 竞态与旧响应覆盖

独立生命周期审计新增两项需要与“正常 cleanup”分开的风险：

- **已证实的代码竞态（尚未现场触发）**：`dsh-usage/lib/index.js:142-164` 在 `queueMicrotask` 内 `await openUsageDb()`、`await runIngest()` 后才把 45s timer disposer 赋给 `disposeTimer`；同步注册的 disposer 在 `167-184` 只清理当时已有的 `db/disposeTimer`。若卸载发生在 DB open 或首扫 await 期间，当前 disposer 可能先看到空引用，而异步 bootstrap 随后仍打开 DB、完成首扫并安装 interval。这里“代码缺少 disposed/generation guard”已证实；真实卸载时是否发生泄漏仍需隔离 stub 实验确认。
- **推测但可复现实验验证**：`client.js:308-370` 的初始/筛选请求没有 AbortSignal 或请求代次保护。若第一次 6 路批次较慢、第二次筛选批次先完成，旧 `Promise.all` 可能在之后回写旧的 summary/timeseries/heatmap/table 状态。RPC 是否支持取消、以及真实网络时序是否触发，尚未验证。
- 设置页其它 async RPC 也存在类似边界：`settings.tsx:140-205`、`machine-form.tsx:428-599` 等请求完成后直接 setState；这属于跨标签共同生命周期风险，不应误归因成 usage SVG 热点。

**最小补充实验**：在隔离 stub 中延迟 `openUsageDb` 100–500ms，`apply(ctx)` 后立即执行全部 effect disposer，等待延迟结束并断言不安装 timer、DB 最终关闭；再让首扫延迟重复。浏览器侧让第一轮 summary 等请求延迟、第二轮筛选请求立即完成，记录旧结果是否覆盖新结果。两项实验均不触碰真实 DB、不调用 refresh、不点击保存/应用。
