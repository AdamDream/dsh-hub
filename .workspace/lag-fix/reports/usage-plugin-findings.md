# dsh-usage 设置页插件卡片只读审计

- 审计范围：`/home/CNS2026495165/dsh/dsh-usage` 源码、仓库内部署/性能证据与补丁件；未修改源码，未点击保存/应用。
- 结论性质：下文区分 **已证实机制**、**推测/需现场验证**、**反例/边界**。
- 关键运行时注意：`dsh-usage` 的 host 代码与 client bundle 是两条生命周期；仓库源码和宿主 profile 安装件可能漂移，不能用源码整目录覆盖部署件（`.workspace/lag-fix/patches/usage-plugin-compare.py:4-14,227-232`）。

## 1. 挂载与生命周期

### 已证实机制

1. **Host 插件挂载**：`dsh-usage/cordis.patch.yml:1-3` 插入 id `usage`、包名 `@local/dsh-usage`；`dsh-usage/package.json:16-39` 的 main 是 `lib/index.js`，client 入口是 `lib/client.js`，web client inject 声明 `@deepseek-ai/dsh-client-connection`。
2. **设置 namespace 注册**：`dsh-usage/lib/index.js:64-71` 在 `apply()` 中通过注入的 settings 注册空 schema `dsh-usage`；这是设置页 keyed 插件卡片能分发的 host 前提。
3. **卡片 slot 挂载**：`dsh-usage/lib/client.js:543-560` 导出 `inject = ["slots", "connection", "sessions"]`，通过 `ctx.slots.inject("settings.plugin.item", ...)` 注册 key=`dsh-usage` 的卡片。注册动作发生在 client fiber 的 `apply()`，卡片本身由 settings 页 slot 决定是否挂载。
4. **卡片卸载**：源码没有在 `UsageCard` 内显式 `useEffect` cleanup 之外的全局资源；轮询 timer 由 effect cleanup 清除（`client.js:371-387`），IntersectionObserver 由 ref callback 在节点 detach 时 `disconnect()`（`client.js:229-253`）。因此正常 React unmount 不应留下 interval/observer。
5. **Host 生命周期**：`lib/index.js:137-164` 同步注册 RPC，随后 microtask 异步开 DB、首次 ingest，成功后安装 45s host ingest interval；`lib/index.js:167-184` 的 `ctx.effect` 在卸载时调用 timer disposer、关闭 DB、将 `db=null`。`lib/rpc.js:214-220` 的 RPC disposer也绑定到插件 ctx effect。

### 推测/需现场验证

- 是否“离开插件标签后”卡片 fiber 立刻 unmount，不能仅由插件源码证明，取决于 settings 页 tab 实现：若 tab 内容保持 keep-alive，卡片不会 unmount，但 IntersectionObserver/document.hidden 门控仍应停止 polling；若 tab 切换销毁内容，则 cleanup 应立即执行。
- 可用仓库探针 `.workspace/settings-lag/measure8.mjs:35-70` 现场验证：进入设置、插件 tab 记录 `/usage` 请求，切回通用设置持续约75s，再关闭设置持续约40s，比较请求数和 host latency。该探针只读，不保存设置。

## 2. 首次同步查询、请求瀑布与并发

### 已证实机制

1. **首次 load 是三组逻辑并行触发但 `loadAll` 内 6 请求并行**：`client.js:366-370` 首次 effect 同步 `void loadAll(); void loadSessions(); void loadStatus();`，没有 await 串联；`loadAll` 的 `Promise.all` 位于 `client.js:308-340`，同时发 `summary`、`timeseries`、`heatmap`、`byModel`、`byProject`、`byDay` 六个 RPC。
2. **同一初始挂载至少 8 个 RPC 请求**：六个聚合 + 一个 `sessions`（`client.js:342-356`）+ 一个 `status`（`client.js:357-365`）。这些三条调用链是并行启动，不是严格网络 waterfall；但 host 端每个 RPC handler 内的 SQLite 查询同步执行，多个请求在宿主事件循环上仍会排队执行。
3. **筛选变化会触发重新查询**：`loadAll` 依赖 `rpcAvailable,rpc,payload,range.from,dataSource`（`client.js:308-340`），`loadSessions` 依赖窗口、来源及 session 日期（`342-356`），effect 依赖 callback identity（`366-370`）。来源/日期档变更会再打全套聚合请求和 sessions/status；会话日期变化也会触发 `loadAll` effect（因为 range 依赖未变时 callback 变化只影响 sessions，具体需按 React dependency 计算）。
4. **轮询只刷新主聚合，不刷新 sessions/status**：interval 回调从 `loadAllRef.current` 取最新函数（`client.js:379-385`），因此每周期再次发 6 个查询；没有 `loadSessions` 或 `loadStatus`。
5. **手动刷新更重**：`client.js:388-398` 先调用 `refresh`，host `rpc.js:180-190` 会 await `ingest()`，再调用 `loadAll`、`loadSessions`；故一次手动刷新是 ingest + 6 聚合 + sessions，且不单独刷新 status。连续点击虽按钮 loading 禁用，但 interval/筛选变更与手动 refresh 之间没有 host-side in-flight mutex 的证据。
6. **host RPC 为同步 SQLite 查询**：`rpc.js:192-203` 直接调用 `querySummary/queryTimeseries/queryHeatmap/queryBy*`；`index.js:113-134` status 还同步执行两个 `COUNT(*)`。因此浏览器端 `Promise.all` 不代表 host 查询并行，宿主事件循环会按请求到达顺序串行执行。

### 已证实性能风险/部署证据

- `.workspace/settings-lag/audit-usage-fix.md:4-23` 记录真实 DB（104,907 events）只读测量：默认窗口一次轮询约578ms事件循环阻塞，heatmap旧路径约289ms；`usage_daily`/sargable修复后的方案预期显著下降。该报告不是源码本身，但提供了性能测量证据。
- 同报告 `:75-89` 证实 client bundle 有独立 HMR stat 轮询（约500ms）并不等于卡片业务 polling；没有 `pnpm run dev:web` 也不影响这个 bundle 热替换结论。

### 反例/边界

- `Promise.all` 消除的是浏览器端等待串联，不消除 host 同步 SQL 的总 CPU/阻塞；不能以“没有 waterfall”推断“没有宿主卡顿”。
- 首次加载的 `loadSessions` 在 tab 默认值为 `byModel` 时仍然执行，虽 sessions 表暂时不可见，造成一次额外查询。
- `loadStatus` 失败静默（`client.js:357-365`），status 不会阻止主卡片渲染；聚合失败则统一显示一个失败。

## 3. 轮询与 IntersectionObserver

### 已证实机制

1. 默认 `refreshSec=60`，可选 0/5/30/60 秒：`client.js:217-218,511-515`。旧部署审计材料中曾记录30s默认，但当前仓库源码明确是60s；这是源码/部署漂移风险，必须以实际加载 bundle 为准。
2. 根节点 ref 使用 `attachCardRef`：`client.js:229-253,491-493`。每次 ref callback 先断开旧 observer，再对新 node 建立 `IntersectionObserver({threshold:0})`；节点 detach 时 `disconnect()`。
3. observer callback 把 `entry.isIntersecting` 写入 `pollVisible`：`client.js:243-247`。`setPollVisibleRef.current` 在每次 render 被赋 setter（`223-227`），避免旧版本死代码问题。
4. 不支持 IntersectionObserver 时强制 `pollVisible=true`（`239-241`），所以 fallback 是继续轮询，而不是安全停轮询。
5. polling effect：`client.js:371-387` 在 `refreshSec<=0`、卡片不可见、或 `document.hidden` 时不建立 interval；timer callback 再次检查 `document.hidden`，并经 `loadAllRef` 调用最新 loadAll。effect cleanup `clearInterval`。
6. timer 不随 filter 改变重启：依赖只有 `[refreshSec,pollVisible]`（`387`），通过 `loadAllRef` 保持最新 callback；这是减少 interval 重建的明确设计。

### 推测/需现场验证

- `IntersectionObserver` 是否在设置页 tab 切换时收到 `isIntersecting=false`，取决于 tabs 的 DOM/布局；源码无法证明。探针 `.workspace/lag-fix/probes/verify-usage-gating.mjs:1-9,50-122` 设计为可见/滚出视口两相验证，且明确“卡片未完全出视口”时结果 inconclusive。
- `document.hidden` 只在页面进入后台时可靠；切换设置页内部 tab 不一定改变 `document.hidden`，必须依赖 observer 或 unmount。

### 反例

- 没有 IntersectionObserver 的浏览器/测试环境会持续 polling；这是兼容性反例。
- 即使 observer 门控成功，初始 effect 的 `loadAll/loadSessions/loadStatus` 仍无条件执行（`366-370`），手动刷新也无条件执行（`388-398`）；门控只约束 interval，不是全量请求门控。

## 4. 趋势与热力图渲染

### 已证实机制

1. client bundle 内联 charts 实现，明确写了“keep in sync”：`client.js:26-125`；独立 `lib/charts.js` 是源文件但 UI 实际使用 bundle 内联副本。独立 charts 文件修改不会自动改变 client bundle（`.workspace/settings-lag/audit-usage-fix.md:91-98`）。
2. 趋势组件 `TrendChart`：`client.js:160-181`，先按 bucket 将每行四桶相加（`141-146`）；area 使用折线 `L` + baseline 填充（`45-50,174-177`），bar 使用等宽矩形（`91-104,166-172`）。当前仓库版本不是平滑 cubic 曲线；若部署报告/README 声称 monotone-cubic/hourly，应视为另一份部署件漂移，不应归因于当前源码。
3. 趋势数据来自 host `queryTimeseries`：`db.js:394-420` 按本地日 `strftime` 分组；RPC 当前只允许 `granularity=day`：`rpc.js:53-55,138-143`。因此当前源码趋势无小时粒度。
4. 热力图 `HeatmapChart`：`client.js:183-195`，`heatmapGrid` 以本地日排序、按周列×7行填充、最多6个强度级别（`63-90`）；同一天用 `Map` 最后一条覆盖前一条（`77`），正常 host 查询应唯一按日。
5. 主渲染会同时构建 hero、趋势、热力图和当前 tab：`client.js:407-540`；SVG 是 React element，不是 canvas。

### 反例/边界

- 趋势的 X 轴标签用 `s.day.slice(5)`（`101-103,111-115`），对 `YYYY-MM-DD` 正常，但若部署侧传入小时桶键会退化/截断；当前 RPC whitelist 又禁止 hour，所以“hour bug”属于部署漂移或未来改造风险，不是当前 source 的已运行路径。
- `heatmapGrid` 对跨年/稀疏日期会补满从首日所在周到末日所在周的空 cell；这可能比实际有数据天数大很多，但属于布局设计，不是重复查询。
- `scaleArea/scaleBars` 对空数组返回空结构，TrendChart 显示“暂无趋势数据”；heatmap 空数组显示“暂无热力图数据”（`164,187`）。

## 5. 重复 option / 重复注册检查

### 已证实机制

- 当前 `client.js` 中四个独立 select 的 options 均无同一 select 内重复 value：来源 `all/dsh/cc`（`497-500`）、日期 `7/30/90/0`（`501-505`）、刷新 `0/5/30/60`（`511-515`）、趋势 bucket 由唯一 `BUCKETS` key 生成（`128-134,528-529`）、图形 `area/bar`（`530-532`）。React key 也分别唯一。
- tabs 由唯一 `TABS` key 生成（`135-140,537-538`），table columns 的 key 在每个表内唯一，row key 按 model/project/day/session 构造（`197-208,420-486`）。
- settings slot 只有一个 `ctx.slots.inject` 注册点（`550-560`），host namespace 只有一个注册点（`69-71`）；源码内没有明显重复 option 或重复卡片注册。

### 推测/反例

- 若 client fiber 被 host loader 重复 apply 而没有正常 dispose，外部 slot 系统是否去重属于平台语义，源码自身没有全局幂等 guard；需以运行时 slot registry/boot graph 验证。
- “重复 option”更可能来自 source/deployed 两份 bundle 漂移，而非当前 source；应运行 `usage-plugin-compare.py`，禁止整份覆盖 deployed。

## 6. 最小只读验证实验

1. **加载/挂载**：只读抓取 boot graph 与 `/plugins/...dsh-usage/client.js?rev=`，确认实际包路径和 hash；浏览器打开设置→插件，记录首轮 `/usage` 请求数量（预期 8：6+sessions+status）。
2. **请求并发/瀑布**：Playwright `page.on('request')/requestfinished` 记录时间戳，比较 6 个 loadAll 请求 start 时间；若 start 接近则浏览器端并行，仍用 host latency/日志判断同步 SQL 排队。
3. **tab 生命周期**：运行 `.workspace/settings-lag/measure8.mjs`（不保存设置），进入插件 tab 后切通用设置75s；若卡片 unmount，应 0 个 `/usage`；若 keep-alive，应 observer 门控后 0 个周期请求。关闭 settings 后再观测40s确认 cleanup。
4. **observer 门控**：运行 `.workspace/lag-fix/probes/verify-usage-gating.mjs`，确保卡片完全滚出 viewport；可见阶段应有约60s自动请求，完全不可见阶段应为0；缺 IO 时结果应显示 fallback 继续轮询。
5. **同步 SQL 基线**：对只读副本执行现成 `.workspace/lag-fix/probes/usage-host-latency.mjs`，分别统计一次 `/usage/heatmap`、六请求批次和 status；不要对真实 DB 写入，不要触发 refresh。
6. **源码/部署漂移**：只读运行 `.workspace/lag-fix/patches/usage-plugin-compare.py --source /home/CNS2026495165/dsh/dsh-usage --deployed <实际宿主包> --replacements .workspace/lag-fix/patches/usage-plugin.replacements.txt --out .workspace/lag-fix/reports/usage-plugin-compare.md`；重点看 client.js 的默认 refreshSec、hour/granularity、settingsScope 与 charts 行数。

## 7. 总结裁决

- **已证实主要风险**：首次挂载每次至少8个RPC；轮询每周期6个同步 host SQL；手动刷新额外 ingest；`Promise.all`不是host并行；observer只门控周期timer，不门控首次/手动请求。
- **已证实主要缓解**：60s默认轮询、可见性门控、document.hidden检查、latest callback ref、interval cleanup、observer disconnect、host ctx effect cleanup。
- **未证实事项**：设置页 tab 切换究竟 unmount 还是 keep-alive；实际宿主包是否与仓库源码同版本；重复卡片是否可能由外部 loader 重复 apply；这些必须按上面的最小实验确认。
- **未发现**：当前源码单一 select 内重复 option、明显重复 tabs/columns key、client 侧未清理的 interval/observer。
