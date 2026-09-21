# 设置页卡顿：官方 `dsh-client-runtime` 热点审计

> 只读审计。未修改 runtime、插件或探针代码。审计对象：`dsh-btw/node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js`（与 pristine 字节相同）及部署副本 `/home/CNS2026495165/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js`（P1/P2+B1/C1 live）。

## 1. 裁决摘要

**P1/P2/C1 与 C2 并未覆盖设置页卡顿的全部主因；“C2 覆盖约 4.9%”这一判断成立，而且对官方 runtime 不能外推为已解决。**

- pristine/C1 基线：`aba836a0c42d…`；当前部署：`a0fb4bb225d3…`；当前源码副本 `dsh-btw/.../client.js` 仍为 pristine（`aba836a0…`）。部署副本包含 P1、P2 与 B1/C1 的 `runningSubagentCount` 新鲜度字段。
- P1 解决的是 `buildListSnapshot` 尾部 `entryCache` 清理的 O(N²) 误伤；P2 解决的是 `projectList → list.set` 后续订阅/React 树的引用风暴。两者没有让 `buildListSnapshot` / `projectList` 变成“仅变更行增量计算”，也没有抑制事件源本身。
- C2 在第三方插件 `sessions()` 记忆化与远端连接去重上，实测覆盖约 **0.29/5.94 ≈ 4.9%** 的该插件重建成本；报告明确记载：会话快照变化是主路径时 C2-2 不命中，C2-1 现实流量约 0.002ms/次（噪声级）。这不是官方 runtime 的 9.2% CPU、entryCache 清理或 P2 引用风暴的替代修复。
- 端到端证据不能宣称设置页已达标：同一批 after 数据中 idle 为 45.0ms/s，但 settings-open 为 89.8、settings-dwell 为 81.4；另有 settings-open p99=100ms。历史 `27.5ms/s` 是有利单窗口，且 N、事件类型和 WS 负载不匹配；不能把下降归因给 P1/P2/C2 单独。

## 2. 调用链与频率 × 单次成本

### 2.1 数据流

```text
WS/Host envelope
  ├─ session/event(user message) -> recordMutation(activity)
  ├─ host/session-status / added / removed -> recordMutation(status/upsert/remove)
  ├─ session/projection -> ProjectionValueStore.apply -> manager notifier.markDirty
  ├─ session/jobs -> jobsBySession 更新 -> manager notifier.markDirty
  └─ approval/question -> pendingInteractions -> manager notifier.markDirty

Notifier (microtask batch)
  -> SessionManager.buildListSnapshot()
      summaries.map + projectionStore.get/values
      flattenLineage
      entryCache 按字段复用
      stale entryCache 清理
      Object.fromEntries(catalogs/jobs)
  -> SessionRuntime.projectList()
      N 行 ids/byId 构造、displayTitle、地址链
      list.set(snapshot)
  -> useSyncExternalStore/selector consumers
      sidebar/settings/session plugins/render tree
```

### 2.2 可量化链（N≈2361）

| 热点 | 频率证据 | 单次成本/结果 | 解释 |
|---|---:|---:|---|
| `buildListSnapshot` | 事件流约 65 frame/s；由 notifier 合并后实测反推约 23 rebuild/s（旧 5.225ms × 23 ≈ 120ms/s，与基线 script 121.4ms/s 同量级） | pristine/P1 微基准整段 **14.222→0.374ms**；其中清理行 **5.382→0.158ms** | P1 是巨大局部收益，但只消灭尾部清理，不消灭 `summaries.map`、`flattenLineage`、projection 合并和每次快照装配。23/s 是下界/反推，不是事件总频率；Notifier 只按 microtask 合并。 |
| `entryCache` stale cleanup | 每次 `buildListSnapshot` 一次 | 旧式 `for cache × items.some`：N=2361 全存活 **5.225ms/次**；P1 Set 版 **0.0838ms/次**（另一抽取基准 5.382→0.158） | 旧式在“全部存活”时最坏，约 O(N²)。这是 C1/P1 的明确主收益。 |
| `buildListSnapshot` 其余部分 | 与上行同频 | P1 后整段约 **0.374ms/次** 的微基准仍包含 map/flatten/projection/cache；真实部署还受对象形状和事件构成影响 | P1 不能解释设置页仍有 80–90ms/s 脚本量；端到端剩余成本在下游渲染与事件/投影 churn。 |
| `projectList` N 行投影 | manager notifier 每次 flush 一次；`create`/`fork` 还显式再调一次（`:9067`, `:9092`） | 每次新建 `ids`、`byId`，每行 displayTitle + 约 13 字段；P2 额外逐条字段比较，约亚毫秒；基线 `byId` 展开 **0.562ms/次**（N=2361） | P2 只在内容等价时复用 `ids/byId/subagents/jobs/整个 snapshot`，避免消费者重渲染；本次调用的 N 行扫描仍然发生。 |
| downstream render / store subscribers | 每次 `list.set`；此前每次新引用都会触发 selector miss | 设置页/侧栏下游脚本历史量级 **121–190ms/s** | 这是 P2 试图避免的最大项，但 P2 是否命中取决于字段/引用等价，且事件真实改变时必须重渲染。 |
| `applyMutation` upsert | 稳态约每帧最多 1 次；刷新/重连时可能批量回放 | P4 测得 `find` 仅 **0.0221ms**，而 `summaries.map` 才是 O(N) 主成本；P4 每次建索引 **0.040ms**，导致 upsert 变慢 | P4 已裁决弃用是正确的：优化了非主成本，且索引构建抵消收益。 |
| C2 `sessions()` | `rebuildRemote` 只由 workspaces/sessions 两订阅触发；sessions 变化主路径每次 miss | 全量 `Object.values+map+spread` **0.2051ms/次**；命中时省此成本 | 只有 workspaces 变化而 sessions 快照引用不变时命中；现实 C2-1 仅约 0.002ms/次。 |

**结论性算术：** C2 最佳上限 `0.2860ms` / 插件重建 ÷ 整条约 `5.94ms` ≈ **4.9%**；P1 的局部理论节省则是旧清理 5.225−0.0838≈5.14ms × 23 rebuild/s ≈ **118ms/s**（满 65/s 事件重建上限时约 334ms/s→5.4ms/s，仅说明算法项量级，不是端到端保证）。P2 的收益不是“少算 N 行”，而是“少触发下游树”。

## 3. 缓存与引用稳定性核查

### 正向缓存（有效）

1. `Notifier` 有 `dirty` + microtask batching；`getListSnapshot()` 在 dirty 时同步 `ensureFresh()`，否则返回 `listSnapshotCache`。同一批事件不会为每帧同步重建。
2. `ProjectionValueStore.values()` 有 `valuesCache`；仅 `apply/seed/truncate` 的真实行变化清空。`seq <= row.seq` 的旧帧直接丢弃，避免过期投影触发更新。
3. `entryCache` 按 sessionId 及字段值复用 entry 对象；P1 将 stale 清理从 `items.some` 改为 Set。
4. P2 对 `ids`、`byId` 行、catalog entries、job views 和最终 list projection 做引用复用；等价快照下 `list.set` 传入同一对象，能切断 selector/render churn。

### 仍然存在的成本/不稳定引用

1. **buildListSnapshot 仍每次装配 `merged`、`pendingInteractions`、`items` 及返回对象。** `itemsCache` 只能复用 items 数组，不能免除前面的 map/flatten；即使 entry 都复用，`buildListSnapshot` 仍被调用。
2. `buildListSnapshot` 每次 `Object.fromEntries(this.catalogs)` 与 `Object.fromEntries(this.jobsBySession)`；P2 只能在 `projectList` 后比较并复用 list 中旧 wrapper，不能免掉 manager 侧的 wrapper 创建。
3. P2 的 `byId` 前向携带（当 ids 相同时把旧 byId 中缺失行带回）是刻意保留地址链子行的语义补丁，但会形成陈旧行走廊：后代索引若依赖 `byId` 而非 `ids`，理论上可能暂时保留已经离开地址链的 child。已有审计未观察到可见错误，仍应作为待观测项，不可当成“完全无风险缓存”。
4. `projectionValues` 的安全性依赖 `ProjectionValueStore.values()` 的稳定引用；当前 store 是“变更失效、重建”，未见就地 mutate，因此引用键缓存方向安全。但这是静态核查，未在所有远程工作区行为上证明。
5. catalog/job wrapper 的输入引用在 manager 快照中由 `Object.fromEntries` 新建；若内容不变，P2 的字段比较可恢复下游引用，但比较本身仍付费。

## 4. 订阅事件与事件风暴判断

### 已确认的放大路径

- `session/projection`：`ProjectionValueStore.apply()` 变更后先让 store 的 `anyNotifier` dirty，随后 manager 的 `projectionStore(sessionId)` 回调再让 manager notifier dirty（`:7980–7987`, `:8302–8305`）。同一 microtask 通常会合并，但每个真实 projection key 仍造成一次“脏化/最终 rebuild”机会。
- `session/jobs` 每帧/每次 jobs frame 都 `jobsBySession.set/delete` + `manager.notifier.markDirty()`（`:8307–8311`）。jobs 数组若 wire 每次新建，即便内容相同也会进入 manager 脏路径；P2 只能在 `projectList` 末端字段比较后复用 wrapper。
- `session/event` 的 user message 走 `recordMutation(activity)`，每次都复制/更新 summaries、执行 `syncCompletedNotifications()` 的全量 summaries 扫描，再 markDirty。该路径与 P1 清理无关。
- host status/added/removed 也走 `recordMutation`；removed 还更新 catalog activity、清 pending/jobs/projection 等，多处状态变化可能在一次通知前累计。
- `host/session-added` 对选中/打开 catalog 的父会话安排 50ms debounce；这是保护措施，但 menu open 期间仍会刷新 catalog，并在完成/尾刷时再次 markDirty。
- catalog `updateCatalogActivity` / `applyCatalogParentExpandable` 会对所有 catalog 扫描 entries，并在改变时复制 entries + catalog，再 markDirty；子代理活跃状态高频时，成本落在 manager/runtime，而非 C2。

### 抑制并不等于没有风暴

Notifier 的 microtask 合并避免“每个 envelope 都同步 projectList”，但高事件率下如果每个 microtask 都有事件，仍可达到高 rebuild 频率。已有证据：基线 WS 事件流约 65/s、脚本 121–190ms/s；after 的窗口间脚本 45–90ms/s 不稳定，说明负载/事件构成仍主导观感。P2 在内容确实变化的 `running/updatedAt/title/projectionValues/jobs/catalog` 上必须失效，不能静默冻结以换性能。

## 5. 与 pristine、C1/B1/P2 live diff、上游实现对照

- pristine 与工作树 runtime：`aba836a0…`，无 C1 标记；部署副本：`a0fb4bb2…`，含 `dsh-perf-fix P1/P2 v1` 与 B1/C1 running count freshness 条件。说明本审计没有把部署后的补丁误当 pristine。
- P1 diff 仅替换 `entryCache` 清理谓词，删除集合语义等价；P2 diff 集中在 comparators、projectList 引用复用与 `list.set(nextProjection)`；B1 只在 entry freshness 增加 `runningSubagentCount`。没有证据表明这些 diff 触及 event ingress、settings component 自身或宿主热图/SQLite 慢路径。
- 上游/官方实现的核心设计（本地包源码）已具备 snapshot store + `Notifier` batching、projection values cache、session/jobs 分支与 catalog debounce；因此“无缓存、每 frame 强制同步 render”的简单诊断不准确。真正残余是：**批处理后的每次 rebuild 仍是全量投影，且事件改变时 downstream 仍必须工作。**
- `applyMutation` 的 P4 对照证明一个重要误区：把 O(N) `find` 换 O(1) lookup 并不自动有收益，因为随后无论如何 `summaries.map` 全量复制；优化应围绕真正的大项（事件频率、全量 rebuild、下游 render、宿主同步慢路径）而非局部复杂度标签。

## 6. 对“主因仍在别处”的定量判断

**判断：是。** 证据分层如下：

1. C2 自身报告已给出 4.9% 上限，且命中率受 workspaces 变化限制；不能解释设置页主线程 80–190ms/s。
2. P1 解决一个确实巨大的局部（旧 N² cleanup），但 after 数据仍在 settings-open 89.8ms/s、settings-dwell 81.4ms/s；这说明剩余瓶颈至少包括 downstream tree/事件 churn，且不能由 C2 覆盖。
3. P2 只在内容不变时阻止引用传播；真实 `session/event`, projection, jobs, running/status 事件改变内容时，P2 必然失效。它无法降低事件 ingress、`syncCompletedNotifications` 全量扫描、`projectList` N 行构造或设置页自身工作。
4. 早先 heatmap/usage 证据显示宿主事件循环可停顿约 264.9–272.2ms，且 A 线曾确认某些宿主慢路径约 285–289ms；若设置页卡顿与这些宿主同步/数据库任务同窗发生，runtime P1/P2 不可能覆盖该阻塞。
5. 现有端到端比较受 N（2361→734）、WS 帧类型（基线 session/event vs after server-request envelope）和并发活跃会话影响；只能说改动方向合理，不能从 −77% 等点值推出主因已消失。

## 7. 建议的下一轮只读验证（不在本审计中改代码）

1. 在同一 N、同一 session/event/projection/jobs 构成下分别计数：`handleMuxEnvelope`、`recordMutation`、`buildListSnapshot`、`projectList`、`list.set`、实际 selector/render commit；报告每秒次数和 p50/p95 单次耗时。
2. 给每种 dirty 来源单独计数并记录合并率：`projection`, `jobs`, `activity/status`, `catalog`, `pendingInteraction`；确认“事件 65/s → rebuild 23/s”在当前 settings-open 是否成立。
3. 分离 runtime script 与宿主任务：Long Task/Performance trace 中标记 SQLite/usage/heatmap RPC、React commit 与 runtime functions，避免把宿主 285ms 阻塞归给 P1/P2。
4. 复测 P2 命中率（最终 projection identity unchanged / manager dirty 次数），因为仅看总体 script ms/s 无法知道是减少渲染还是负载改变。

## 最终结论

P1/P2/C1 的局部收益真实：P1 让 entryCache 清理从 O(N²) 降为 O(N)，P2 在等价内容上恢复引用稳定；B1 freshness 修正避免 running-subagent count 陈旧。C2 的第三方改动覆盖约 4.9%，且现实命中受限。**设置页卡顿的主因没有被这些改动完整覆盖：剩余主热区是事件/投影/jobs/catalog 驱动的全量 manager rebuild、`projectList` 的 N 行投影及真实内容变化下的下游渲染，外加可能独立的宿主同步/数据库长任务。**
