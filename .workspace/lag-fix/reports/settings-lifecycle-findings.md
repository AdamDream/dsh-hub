# 设置页标签生命周期只读审计

日期：2026-09-20
范围：只读检查当前工作区源码；未点击保存/应用，未修改产品代码。重点覆盖 Plugins/插件槽位、`dsh-usage`、以及可见的远程工作区 Settings 页面实现。

## 结论摘要

- **高风险：`dsh-usage` host bootstrap 存在卸载竞态。** `apply()` 用 `queueMicrotask` 延迟打开 DB；生命周期 disposer 同步注册但只读取当时的 `db`/`disposeTimer`。若插件在 microtask 或 `await openUsageDb()` 期间卸载，disposer 可能看到 `db === null`，随后异步任务仍会打开 DB、首扫并挂上 45s timer。没有 `disposed`/generation guard，也没有保存并关闭 pending open 的机制。证据见 `dsh-usage/lib/index.js:73-83,142-164,167-184`。
- **中风险：插件/设置页异步请求没有卸载保护。** `dsh-usage` 初次 6 路 Promise、sessions/status、轮询期间的 RPC 完成后直接 setState；`RemoteWorkspaceSettingsPage.refresh()` 及删除/切换/forget 请求同样无 mounted guard/AbortSignal。`SideWorkspacesPanel` 的 refresh/toggle 也无卸载保护。快速切标签会留下请求和回调，即使 React 不再报 warning，也会浪费 RPC/解析并可能更新陈旧实例。
- **已正确清理的部分：** `dsh-usage` card 的 `IntersectionObserver` 在 ref 重新绑定时 disconnect；ref 变 null 时释放；轮询 effect 返回 `clearInterval`。DOM row-badge 层清理 MutationObserver、click listener、interval、pending timeout、订阅和注入节点，整体是较好的对照实现。
- **规模热点：** dsh-usage 的 sessions 固定 `limit: 200`，每行 9 个 cell；热力图按日期窗口产生 `weeks*7` 个 SVG rect；趋势图按返回行数产生 bar/text SVG 节点。当前实现没有客户端上限/虚拟化/采样。切到“会话明细”或大年度热力图时，DOM/SVG 会明显增大。

## 证据清单

### 1. Plugins 标签与 dsh-usage 挂载

1. host 声明 `inject = ["connection", "webServer"]`，并在 `apply()` 内通过 `ctx.inject(["settings"], ...)` 注册空的 `dsh-usage` namespace：`dsh-usage/lib/index.js:30-34,64-71`。
2. client 通过 `ctx.slots.inject("settings.plugin.item", () => ctx.slots.register(...))` 注册 key 为 `dsh-usage` 的插件设置卡，并注入 `rpc` 与 `sessions`：`dsh-usage/lib/client.js:543-560`。因此插件标签是否出现同时依赖 host namespace 与 client slot；任一侧未装配时不是普通“空设置项”，而是缺卡/卡片显示 RPC unavailable。
3. 卡片挂载根节点使用 callback ref `attachCardRef`：旧 observer 先 `disconnect()`，node 为 null 时返回；有 IntersectionObserver 时 observe 新节点：`dsh-usage/lib/client.js:228-253`。这是正确的节点重绑清理路径。
4. 轮询 effect 在 `refreshSec <= 0`、不可见、后台标签页时不建 timer；timer disposer 调用 `clearInterval`：`dsh-usage/lib/client.js:371-387`。回调经 `loadAllRef.current` 取最新函数，避免 filter 变化反复重启 interval。
5. 但 load 初始 effect 每次依赖 identity 改变会发 `loadAll + loadSessions + loadStatus`，且无取消/序号校验：`dsh-usage/lib/client.js:308-370`。`loadAll` 内 `Promise.all` 六请求完成后直接写 summary/timeseries/heatmap/byModel/byProject/byDay；切换过滤条件时旧请求可能晚于新请求完成，旧结果覆盖新筛选。
6. session 查询固定 `limit: 200`：`dsh-usage/lib/client.js:342-356`。`UsageTable` 对每行、每列创建 `tr`/`td`：`dsh-usage/lib/client.js:197-208`；会话列有 9 列：`dsh-usage/lib/client.js:470-485`。
7. 趋势图用每个 bar 一个 `rect`，并为 tick 一个 `text`：`dsh-usage/lib/client.js:160-181`；热力图对 `grid.cells` 每项创建一个 `rect`：`dsh-usage/lib/client.js:183-195`。`heatmapGrid()` 以 `weeks * 7` 填满整个日期范围：`dsh-usage/lib/client.js:63-89`。
8. 固定 option 组在单卡内重复声明于源码：来源 3 个、范围 4 个、刷新 4 个、图表 bucket 5 个、图表模式 2 个，共 **18 个 option**；分别见 `dsh-usage/lib/client.js:497-515,528-532`。它们不是重复 DOM（每个 select 只渲染自身选项），但选项字面量分散，未来多标签复制容易漂移；`BUCKETS` 仅趋势 select 使用，而来源/范围/刷新仍手写。

### 2. dsh-usage host 生命周期

- `db`, `disposeTimer` 初始为空：`dsh-usage/lib/index.js:73-80`。
- `queueMicrotask` 中先 `await openUsageDb()`，再 `await runIngest()`，最后才赋值 `disposeTimer`：`dsh-usage/lib/index.js:142-164`。
- 同步注册的 disposer 只调用当前 `disposeTimer`、当前 `db.close()`，随后 `db = null`：`dsh-usage/lib/index.js:167-184`。

这形成具体竞态：卸载发生在 `openUsageDb` 尚未完成时，disposer 无 timer/db 可清理；异步 bootstrap 随后继续并挂 interval。即使 `runIngest()` 执行期间卸载，函数只检查 `db === null` 开始时的快照式条件，未在 await 边界复查；`ctx.setInterval` 返回的 disposer 也可能在生命周期 disposer 已经运行后才产生。

RPC 路由本身有显式 effect cleanup：`dsh-usage/lib/rpc.js:214-219`，这部分未发现同类漏清理证据。

### 3. 远程 Workspace Settings 页

- 首次刷新只在 mount effect 调用一次：`.workspace/workstreams/research/research-dsh-workerspace/repos/dsh-workspace-enhancement/src/client/settings.tsx:140-150`。
- `refresh()` 的 RPC 完成后直接 `setMachines/setCurrentId`：同文件 `140-149`；删除、切换当前、忘记 host key 的 async handlers 也直接 set state：`158-205`。无 AbortController、请求代次或 `alive` guard。
- `handleSaved()` 会 `void refresh()`：`209-216`；如果用户离开设置标签，响应仍可能到达旧组件。
- Settings 表单 `machine-form.tsx:428-445,477-496,509-553,556-599` 的 alias resolve/config hosts/test/save 请求同样没有卸载取消；虽然 generation counter 能防止旧 alias 覆盖新输入，但不能防止卸载后的请求继续运行。
- `status.tsx:180-186` 的 `useConnStatus` 至少有 `alive` guard，避免自动 status 请求完成后写入已卸载 badge；但 `refresh/reconnect` action 的 `run()` 在 await 后无 alive guard（`187-209`），用户点击后立即切标签仍可能 setBusy/setView。

### 4. 其他标签/DOM observer 对照

`row-badges.ts` 是目前最完整的清理范本：

- `MutationObserver`、document click listener、interval、pending scan timeout 在 disposer 中全部释放：`.workspace/workstreams/research/research-dsh-workerspace/repos/dsh-workspace-enhancement/src/client/row-badges.ts:660-702`。
- 同时取消订阅、语言订阅，移除所有注入 badge 并清空 maps。
- `SideWorkspacesPanel` 的初始 refresh 和 toggle 请求在 `side-workspaces.tsx:154-200` 无同样的 mounted guard；`useSessionCwd` 的订阅本身有 effect cleanup（`86-100`）。

## 最小验证实验（不保存、不应用）

以下实验只观察请求/计时器/节点，不需要点击 Save/Apply；建议在隔离开发 profile 或浏览器 DevTools Console 执行。

### 实验 A：插件卡 observer/timer 清理

1. 打开 Settings → Plugins，确保能看到 `dsh-usage` 卡；不要改任何控件。
2. 在 DevTools 先 monkey-patch：
   ```js
   const si = window.setInterval, ci = window.clearInterval;
   let live = 0;
   window.setInterval = (...a) => { live++; const id = si(...a); console.log('interval+', live, a[1]); return id };
   window.clearInterval = id => { live--; console.log('interval-', live); return ci(id) };
   ```
3. 进入/离开 Plugins 标签 5 次；预期每次离开后 live 回到 0（若选择“不轮询”则本来为 0）。在 Elements 观察 `[role=img]` SVG 与卡片节点不应累积。
4. 在 Console 替换 `IntersectionObserver` 构造器或直接在 Sources breakpoint `disconnect`；滚出/滚入卡片，预期只有一个 active observer，不应每次 render 增加一个。

### 实验 B：卸载竞态（dsh-usage host）

1. 临时在隔离测试 stub 中让 `openUsageDb()` 延迟 100–500ms，调用 `apply(ctx)` 后立即执行所有 `ctx.effect` disposer。
2. 等待延迟结束，断言没有调用 `ctx.setInterval`，且 DB 最终被关闭；这是当前实现应失败的最小回归实验，因为 bootstrap 没有 disposed guard。
3. 同样让 `runIngest()` 延迟，在首扫期间卸载；断言首扫完成后不再安装 timer。

### 实验 C：旧请求覆盖新筛选

1. DevTools Network/ RPC stub 让第一次 `summary/timeseries/...` 请求延迟，第二次筛选请求立即返回。
2. 在 dsh-usage 卡切一次来源或范围（不保存），观察第二次结果先显示后，第一次结果是否回写覆盖；当前 `loadAll` 无请求代次/AbortSignal，存在覆盖可能。
3. Settings 远程页同理：stub `machines.list` 延迟，进入后立即离开再返回，记录旧响应是否仍触发旧实例 state update；不应影响新实例。

### 实验 D：规模量测

在插件卡稳定渲染后执行：
```js
const card = document.querySelector('.du_root');
({
  cardNodes: card?.querySelectorAll('*').length,
  svgs: card?.querySelectorAll('svg').length,
  svgRects: card?.querySelectorAll('svg rect').length,
  tableRows: card?.querySelectorAll('tbody tr').length,
  options: card?.querySelectorAll('option').length,
})
```
切换“会话明细”、扩大范围、切换热力图年度后重复记录；重点看 `svgRects`、`tableRows` 与总节点数是否线性增长。由于 sessions limit=200，9 列时仅 td 就可达 1,800 个，尚未计 tr/button/text 节点。

## 最小修复建议（本报告不执行）

1. host bootstrap 增加 `disposed` 标志与 bootstrap generation；每个 `await` 后复查，卸载后关闭刚打开的 DB，不安装 timer。将 timer disposer 先登记为可替换句柄，避免 late assignment 漏清理。
2. card 与设置页请求引入 AbortSignal（若 RPC 支持）或 effect-local generation/alive guard；`loadAll` 结果只允许当前 payload/代次提交。轮询也应在 unload 时通过同一 signal 终止 in-flight RPC。
3. 对 sessions 表采用更小 limit + 分页/虚拟化；热力图按最大窗口限制 cells，趋势 tick 与数据点设上限或降采样。
4. 将固定 option 组集中为常量数组并复用，至少避免同一设置页不同标签复制相同 value/label 后漂移。
