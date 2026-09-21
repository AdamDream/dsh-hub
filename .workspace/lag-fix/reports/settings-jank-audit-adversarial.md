# 设置页卡顿反方审计：否决“P1/P2/C2 后已不卡”

- 身份：独立反方审计员。
- 纪律：本轮未修改任何源码、配置、live bundle、数据库或宿主进程；只读阅读源码、live bundle、已有测量和补丁脚本。
- 结论：现有证据最多证明局部微基准改善，**不能推出设置页全链路不卡**。应否决“P1/P2/C2 已覆盖全部重渲染源/请求源”的断言。

## 一、源码证明的残余候选

### F1（高）：P2 可能保留过期 address-chain synthetic row

live `@deepseek-ai/dsh-client-runtime/lib/client.js` 的 `projectList()` 在 9323–9327：当 `sameIdList(previousProjection.ids, ids)` 为真时，把旧 `previousProjection.byId` 中当前 `byId` 缺少的键全部拷回。旧 `byId` 可能含由 `currentAddress` 生成的 synthetic child（9304–9320），而 `ids` 只来自 manager items（9274–9292）；因此 ids 不变不代表地址链不变。

可执行只读反事实：构造旧状态 `ids=[p]`、`byId={p,child}`、`currentAddress=p→child`，新 manager 保持 `ids=[p]` 但将 `currentAddress` 置空，运行同一投影逻辑。预期应删除 child；现行 carry-forward 会把 child 拷回。若通过，证明 P2 的微基准并未覆盖 address-chain 语义；未测前不得声称完全等价。

### F2（高）：usage card 无取消/代次保护，旧请求可覆盖新筛选

live `@local/dsh-usage/lib/client.js:874–923` 的 `loadAll` 每轮发 7 个 RPC，`904–912` 直接写 state；没有 request generation、AbortSignal 或 mounted guard。effect `949–953` 依赖 `loadAll/loadSessions/loadStatus`，筛选或趋势日变化会启动新轮，旧轮不会取消。

只读反事实：在 DevTools 对旧来源/旧范围请求 A 注入延迟，切换筛选后让 B 先返回，再放行 A。若 A 覆盖 B，即证实竞态。已有 `measure8.json` 只有首轮 9 请求和离开标签 75 秒 0 请求，没有乱序或快速筛选证据，因此“请求不会重复/过期覆盖”必须否决。

### F3（高）：C2 仍是宽订阅 + body 全树观察

live `dsh-workspace-enhancement/lib/client.js:4445–4454` 在 `document.body` 上使用 subtree `MutationObserver`；任意非 badge childList 变化都会 `scheduleScan`。`installRowBadges` 的订阅同时接 `workspacesFeed` 和 `sessionsFeed`（5413–5418、5437–5443），任一 session snapshot 变化都会 `rebuildRemote()`，随后扫描全部 tree（4364–4395）。C2-2 只缓存 sessions 映射结果，不缩小订阅字段，也不缓存 workspaces。

只读反事实：仅改变 session 的 `running/updatedAt`，保持 title/cwd 不变；snapshot 引用仍变化，subscribe、remoteSessionIndex、全树 query 仍执行。仅改变设置面板非 badge DOM 节点，同样会触发 body observer。Set 替换和 sessions 数组记忆化不能覆盖这条同步工作链。

### F4（高）：B1 最近 N 过滤不等价于 running 后代语义

`unit-B1.md` 已承认窗口外孙代/后代可能降级。过滤后再由 retained items 聚合；若 running subagent 超出 N，顶层计数必然少计。现有自测只覆盖当前样本的 3 个 running 项均在窗口内。

只读反事实：构造 201 个 subagent，令排序第 201 条 running 且 parent 为顶层，N=200；过滤结果没有该条，聚合为 0，而真实 lineage 为 1。该结果只能标为已知行为降级，不能叫完全等价优化。

### F5（中高）：visited/hidden 标签生命周期未被证明

既有 `audit-server.md`/`audit-client.md` 定位到：插件标签按 visitedIds 保留已访问 section，离开时使用 hidden 而非必然卸载；usage card 自身只在 `763–768` 订阅 settingsScope、在 `949–970` 管理轮询，没有读取 tab active。IntersectionObserver 只控制几何可见性，不证明 mount/unmount。`measure8.json` 离开插件标签 75 秒无 usage 请求，无法区分卸载、hidden 不相交、document hidden 或周期恰未到。

只读测试：记录插件 card mount/unmount、effect cleanup、timer 创建/清理，切换插件/模型/通用标签并等待多个 60 秒周期。离开标签仍有 card effect/订阅，证明 hidden 不等于卸载。

### F6（中高）：手动 refresh 与自动 loadAll 可重叠

`client.js:971–979` 的手动刷新先调用同步 `refresh`，再调用 `loadAll`；按钮只按 `loading` 禁用，而 loading 在 loadAll 开始后才设置；代码没有 refresh in-flight 锁。审计服务端已证明 refresh 会同步执行 ingest。

只读测试：延迟第一次 refresh RPC，快速再次点击或让轮询同时到期；记录 refresh 次数及之后的完整 7-call 批次。任何重叠即证明没有去重，缩容不会改变机制。

### F7（中）：初始 effect 与筛选变化可产生重复批次

mount 或筛选变化时，`useEffect` 同时运行 `loadAll`、`loadSessions`、`loadStatus`；loadAll 本身还有 7 个并发 RPC，React 批处理 state 不会合并网络请求或同步 SQL。

只读测试：给每次 RPC 加批次号，分别记录 mount、range/source/trendDay 单次变化对应的调用集合；不得用总请求量下降外推已去重。

### F8（中高）：直接 cp/install 覆盖 live 文件，缺原子替换证明

`usage-plugin.sh:323–325`、`workspace-enhancement-perf.sh:287–289`、C1 脚本均以 `cp`/`install` 直接覆盖 live bundle。客户端服务每次 GET 从磁盘读取，HMR 轮询可能与覆盖并发；`node --check` 是覆盖后检查，不能保护此前读请求。B1 还先后覆盖两份宿主文件，存在混合版本窗口。

只读证明要求：观察文件大小/hash/read error 与 HMR rebuilt 时间，或取得同目录临时文件 + 原子 rename 的部署证据。未见 rename/fsync/原子发布前，不得断言 HMR 中间态不存在。

## 二、重渲染、key、布局与数据归因

1. P2 的 `list.set(nextProjection)` 仍每次调用；只要 `phase/current/currentAddress/jobsBySession/subagentsByParent` 之一变化，订阅者仍被通知。P2 只减少内容不变场景，不覆盖这些字段高频变化。
2. C2 body observer 每次扫描仍执行 `querySelectorAll` 全树，并可能 appendChild/style 写入；50ms gap 是节流，不是零成本。需要 Performance/long-task 分解，不可由 Set 微基准外推。
3. usage 表格 key 虽使用业务字段，但 `sessions` rowKey 是 `"s" + data_source + session_id`；应对实际返回集合做碰撞扫描。UUID 通常唯一不是证明。
4. heatmap cell 使用 `key=c.day`，趋势 tick 使用坐标；本轮没有证据证明 key collision 是主因，也没有证据可排除动态 key/数组重排造成的局部 remount。
5. 安静态面板 mutations=0 只证明静态条件下 DOM 没变，不能否证活跃会话期间 SettingsPanel 被父组件重新执行；`audit-client.md` 已明确该频率未测。
6. `BEFORE-AFTER.md:28–32,66–80` 已否定单次归因：补丁前 N=2361，许多改后样本 N≈734/742；WS 帧率、帧类型、负载和宿主状态也变化。因而“设置打开后下降即由 P1/P2/C2 导致”“缩容后不卡即修复成立”均不可接受。

## 三、必须执行的只读反事实矩阵

| ID | 测试 | 通过/否决标准 |
|---|---|---|
| T1 | 活跃会话中设置页挂 panel/sidebar/body MutationObserver + rAF + long-task + RPC 记录 | panel 变化或提交频率与会话事件同阶，则 F1/F2 乘数仍存在；安静态 0 不足 |
| T2 | RPC monkey-patch/网络断点，快速切换 range/source/trendDay，令 A 延迟、B 先返 | A 覆盖 B 或一次操作出现多轮 7-call，则 F2/F7 成立 |
| T3 | address-chain synthetic child 反事实 | stale child 仍在 byId，则 P2 不能称完全等价 |
| T4 | N=200，201st running subagent 反事实 | 顶层计数少于真实 lineage，则 B1 是明确降级 |
| T5 | 记录插件 card mount/unmount、effect cleanup、timer 生命周期 | 离开 tab 后仍活跃，则 hidden/visited 仍是残余重渲染/请求源 |
| T6 | 只读观察直接覆盖期间 size/hash/read error 与 rebuilt 事件 | 出现截断/混合读，或无原子发布证据，则 HMR 风险保留 |

## 四、最终裁决

| 项 | 裁决 |
|---|---|
| P1 entryCache O(N²) | 局部成立；不覆盖其它重渲染源 |
| P2 引用稳定 | 不得宣称完全等价；address-chain 反事实未覆盖 |
| C2 Set + sessions memo | 局部成立；宽订阅/body 扫描仍在，否决“插件热点已解决” |
| B1 N=200 | 大小/性能局部成立；窗口外 running 后代少计是已知语义降级 |
| usage visible gating | 生命周期未充分证实；manual refresh、乱序响应、重复批次仍开放 |
| HMR | 直接覆盖缺原子替换证明，中间态风险保留 |
| “设置页现已不卡” | **否决**：归因被数据缩容和负载漂移污染，且 F1–F8 未完整排除 |

在 T1–T6 完成、固定同一 N/WS 事件率/标签状态至少三次配对测量，并逐项给出证据前，对外只能表述为：**“若干局部热点已优化；设置页全链路卡顿尚未证实消除。”**

## 五、候选状态：已证伪、已证实、未证伪

### 5.1 已证伪（不应再作为当前主因或证据链）

以下候选已有源码定位与只读测量否证，不能用来解释当前设置页卡顿：

| 候选 | 证伪依据 | 边界 |
|---|---|---|
| `settings.describe` 序列化/大响应是主热源 | `audit-server.md` 实测约 2.8ms、43.5KB；实现为内存读取/序列化 | 不代表所有设置 RPC 都快，也不代表客户端渲染免费 |
| `pluginInventory.list` 扫描 node_modules 是主热源 | 实现读取 Cordis Loader 内存表；实测约 3.8ms、无磁盘扫描 | 不排除其它 inventory 请求或重复调用 |
| 设置页 bundle 每请求同步读大文件 | bundle 服务路径为异步 `readFile`；设置相关 bundle 总量约 280KB | 不等于 live bundle 直接覆盖不存在 HMR 中间态 |
| 设置页自带定时器/轮询未清理是已证实主因 | 五个设置 bundle 检索未见相关 interval/timeout/RAF；安静态 15s 面板无 DOM 变更 | usage 卡片是插件卡片，另列为未证伪 |
| 仅凭安静态打开设置即可证明设置面板是热源 | `probe-open`/`ab-open-vs-closed` 面板 mutations=0；安静态打开甚至可能更省 | 不能外推到活跃会话事件流 |
| “设置页本身读取 sessions/skills/profile 大目录” | 代码路径与实测不支持；相关耗时不在设置页默认读取链 | 不否认宿主其它时机的 ingest/会话遍历 |

### 5.2 已证实但不是完整修复证明

| 候选/修复 | 已证实内容 | 不可外推内容 |
|---|---|---|
| P1 `entryCache` O(N²) 清理 | 同口径微基准与等价性测试显示该局部成本下降 | 不覆盖其它快照投影、React 提交、布局或设置 RPC |
| P2 内容不变时引用稳定 | 部分相同内容场景可复用 projection/entry 引用 | 未覆盖 address-chain、phase/current 等字段变化 |
| C2-1 Set 去重 | `remoteSessionIndex` 的局部去重从线性扫描改为 Set | 不覆盖 subscribe、全树 observer、全树扫描 |
| C2-2 sessions 映射记忆化 | 相同 snapshot 引用时复用 rows 数组 | 不覆盖 workspaces 映射或 session snapshot 变化触发的 onChange |
| B1 当前样本缩容 | 当前 payload 可降至最近 N，字节数显著下降 | 不是全量状态语义等价；窗口外 running 后代有明确降级 |

### 5.3 未证伪（必须保留，当前不能排除）

| 候选 | 当前状态 | 停止前不可接受的断言 |
|---|---|---|
| F1 P2 address-chain synthetic row 残留 | **未证伪**；源码反事实尚未执行 | 不得称 P2 完全等价 |
| F2 usage 请求乱序覆盖/重复批次 | **未证伪**；已有证据未覆盖快速筛选和乱序 | 不得称请求已去重、旧响应不可能覆盖 |
| F3 C2 宽订阅及 body 全树扫描 | **源码已证实存在，性能影响未定量** | 不得称 C2 已消除插件同步工作 |
| F4 B1 窗口外 running 后代少计 | **源码逻辑已证实为可能降级**；当前样本未触发 | 不得称 B1 行为完全等价 |
| F5 visited/hidden 标签生命周期 | **未证伪**；离开标签无请求不能证明卸载 | 不得称卡片已卸载、订阅已清理 |
| F6 manual refresh 与自动轮询重叠 | **未证伪**；代码缺少明确 in-flight 锁 | 不得称 refresh 已防重复 |
| F7 mount/筛选变化重复批次 | **未证伪**；effect 结构允许重复批次 | 不得用总请求下降替代批次证据 |
| F8 HMR/直接覆盖中间态 | **未证伪**；补丁路径未提供原子发布证明 | 不得称热替换期间绝无截断/混合读取 |
| 活跃会话时 SettingsPanel 被动重渲染 | **未证伪**；安静态观察不足 | 不得把安静态 mutations=0 当作活跃态否证 |
| key collision、样式/布局重算 | **未证伪且未证明为主因** | 不得声称已排除 key/layout/style 成本 |

## 六、停止条件与本轮收尾界限

本轮按用户要求**停止扩展实验**。审计在以下条件下收尾：

1. 已完成对现有实现、live bundle、设置页证据、补丁报告和前后测量归因的只读审查；
2. 已将候选明确分为“已证伪”“已证实但仅局部”“未证伪”；
3. 每个仍开放的高风险候选都给出可执行的只读反事实测试和判定门槛；
4. 已明确停止条件：在同一 N、同一 WS/事件率、同一标签状态下，至少三次配对测量，并覆盖 T1–T6；在此之前不得发布“设置页已不卡”或“所有重渲染源已覆盖”的结论；
5. 本报告之外不再创建测试脚本、不再修改源码/配置、不再重启或干扰宿主、不再扩展实验范围。

因此，本报告的最终结论是一个**有边界的否决**：局部补丁可以成立，但“设置页全链路卡顿已经消除”尚未被证实，且 F1–F8 中多个候选仍未被证伪。除非未来证据满足上述停止条件，否则审计结论保持不变。

## 七、F6 之后的完整收尾裁决

### 7.1 证据强度分级

- **强证据（可直接裁决）**：源码明确显示 C2 仍订阅 `workspacesFeed` 与 `sessionsFeed`，并对 `document.body` 做 subtree 观察；补丁脚本使用直接 `cp`/`install` 覆盖；B1 的保留窗口客观上可能丢弃窗口外 running 后代。这些结论不依赖缩容后的性能数字。
- **中强证据（只能裁决为未排除）**：usage `loadAll` 的 7 个请求批次没有代次/取消保护；manual refresh 没有显式 in-flight 锁；设置标签的 visited/hidden 生命周期未由现有 `measure8.json` 区分。代码结构支持风险，但还没有乱序、重叠或 cleanup 的活体证据。
- **局部实验证据**：P1 的 O(N²) 微基准、P2 的相同投影引用复用、C2 的 Set 去重与 sessions 映射记忆化、B1 当前 payload 缩容均可成立；它们不能外推到设置页全链路。
- **弱或不可归因证据**：补丁前后设置页脚本、帧 p99、长帧数量的比较同时改变了会话数 N、WS 帧率、帧类型、宿主活跃度与数据缩容状态。因此不能作为补丁单独收益的因果证明。

### 7.2 最小只读实验（仅作为未来复核方案，本轮不执行）

1. **请求顺序实验**：给每个 `/usage/*` 调用记录 batch、筛选快照和完成顺序；先延迟旧 batch，再切换范围/来源，验证旧响应是否覆盖新状态，同时统计一次操作是否产生重复 7-call 批次。
2. **标签生命周期实验**：对 usage card 记录 mount、effect cleanup、timer 创建/清理，依次进入插件标签、离开、等待至少两个 60 秒周期；仅据 cleanup/timer 事实判断 hidden 是否真的卸载。
3. **活跃态渲染实验**：固定 N 与会话事件率，分别记录 SettingsPanel、sidebar、body 的 mutation、React commit、long task 和 layout/style 时间；必须至少三次配对，而非比较不同时间线的单次结果。
4. **投影/计数离线反事实**：用 synthetic address-chain child 和第 N+1 个 running subagent 分别验证 P2 stale row 与 B1 少计；该实验只读、无需宿主或数据库。
5. **发布窗口审计**：只观察 bundle size/hash、服务端 GET 错误和 HMR rebuilt 时间，或检查发布实现是否提供同目录临时文件加原子 rename；没有原子发布证据就保留 F8。

### 7.3 明确停止条件

本审计在本轮停止，不再创建脚本、不再跑实验、不再触碰源码或 live 文件。未来若重新开放复核，必须同时满足：

- 固定同一会话列表规模 N、同一 WS/会话事件率、同一浏览器与标签状态；
- 同一条件至少做 3 次 before/after 配对，报告中位数、范围及异常值；
- 覆盖请求乱序/重复、标签 cleanup、活跃态 panel/sidebar/body 渲染、投影 stale row、B1 N+1 running 计数和 bundle 发布窗口；
- 每个候选都给出“通过、反例或仍未定性”，禁止以数据缩容、单次截图、单次长帧或总请求量下降替代机制证据；
- 在上述条件全部满足之前，最终表述必须保持：**“局部热点已有优化证据；设置页全链路卡顿尚未证实消除。”**

**最终裁决：不接受“P1/P2/C2 方向正确所以不卡”。现有证据支持局部修复，不支持全局结论；F6 之后的请求重叠、生命周期、归因、证据强度和停止条件如上，报告至此完整收尾。**
