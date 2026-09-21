# 设置页性能审计证据交叉核对

- 核对目标：设置页，尤其“插件”标签的性能审计；明确证据边界、可复用选择器、负载前提。
- 核对方式：只读阅读已有报告、JSON 产物和 Playwright/探针脚本；未改代码、未改部署位、未重启宿主、未重新发压测。
- 运行时基线：报告记录的宿主 PID 为 `20806`，GUI URL 为 `http://127.0.0.1:3080`。这些是历史观测前提，不等同于当前现场仍完全相同。

## 1. 证据索引与结论分级

### A. 已证实（有代码定位且有活体/产物佐证）

1. **设置页核心 RPC 不是慢点。**
   - `.workspace/settings-lag/audit-server.md:32-57`：`settings.describe` 约 2.8 ms、`pluginInventory.list` 约 3.8 ms、`llm.providers` 约 1.0 ms、`llm.models` 约 2.1 ms；对照 `/usage/heatmap` 约 304 ms。
   - `.workspace/settings-lag/audit-server.md:9-21`：该审计把第三方 `@local/dsh-usage` 识别为条件性服务端阻塞源。

2. **“插件”标签进入后会加载 usage 卡片并产生一批 `/usage/*` 请求。**
   - `.workspace/settings-lag/audit-server.md:120-138`：客户端注册/挂载点、`loadAll()` 请求点、30 秒轮询点的静态定位；报告记为 7 个并发主请求加 `sessions`/`status`。
   - `.workspace/settings-lag/measure8.json:1-14`：一次实测 9 个 usage 请求，含 `heatmap:405.9ms`、`byModel:477.1ms`、`byProject:498.5ms`。
   - `.workspace/settings-lag/measure7.json:21-102`：另一轮实测记录 `/usage/heatmap` 356.7/414.2 ms、`byDay` 475.2 ms 等，说明耗时有现场波动。

3. **离开“插件”标签后，已访问 tab 的内容仍保持挂载，历史测量期间未再产生 usage 请求。**
   - `.workspace/settings-lag/audit-client.md:85-92`：`dsh-client-ui-settings-plugins/lib/client.js:489-498` 使用 `rows.filter(row => row.id === active || visitedIds.has(row.id))`，非选中项以 `hidden: !selected` 保留。
   - `.workspace/settings-lag/measure8.mjs:47-57`：从插件切到“通用设置”，连续约 75 秒（250 次、间隔 300 ms）监听 `/usage`；产物 `.workspace/settings-lag/measure8.json:15-24` 为 `usage_calls: 0`，host probe `max:62.8ms`、无 >100 ms 停顿。
   - 注意：该结果证实“没有继续发 usage 请求”，不单独证明组件已卸载；静态代码反而支持“保持挂载”。

4. **插件标签历史样本的 DOM 规模最大，但 DOM 数不等于卡顿因果。**
   - `.workspace/settings-lag/measure2.json:31-44`：插件标签 962 节点，为该轮 8 个标签中最大。
   - `.workspace/settings-lag/audit-client.md:125-129`：另一探针中模型页面板 120/711 节点，sidebar 481/711；热区可能在 sidebar/body。

5. **设置页在安静负载下没有观察到持续的面板 DOM churn。**
   - `.workspace/settings-lag/probe-open.mjs:99-127`：MutationObserver 直接挂在 `[role="dialog"]` 子树，且同时记录 rAF、长任务、节点数。
   - `.workspace/settings-lag/audit-client.md:104-129`：`ab-open-vs-closed` 的设置打开窗口面板变更为 0；模型页 12 秒 script 约 9 ms、>50 ms 帧为 0（该报告的核心否证样本）。
   - `.workspace/settings-lag/audit-client.md:156-166`：报告明确声明 F1 的“每帧重渲染”在活跃会话条件下未直接测量。

6. **运行时 session list 负载很大，且与 settings 不是同一证据。**
   - `.workspace/settings-lag/measure3.json:42-64`：历史 `session_list` 约 3,763,290 bytes、2,361 项，字段包含 `sessionId/updatedAt/running/...`。
   - `.workspace/settings-lag/measure5.json:1-21`：一轮 20 秒观测记录 73 WS 帧/s，其中 `session/event` 1309、`session/projection` 139。
   - `.workspace/settings-lag/measure2.json:174-218`：CPU profile 的 `buildListSnapshot` 自身约 9.205% sample，占比高；这是运行时/sidebar 证据，不是插件标签内部证据。

7. **source 与 deployed 是独立拷贝，不能以 source 全量覆盖 deployed。**
   - `.workspace/lag-fix/reports/copy-drift.md:3-5`：source=`/home/CNS2026495165/dsh/dsh-usage`，deployed=`/home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-usage`。
   - `copy-drift.md:9-23`：`lib/client.js`、`lib/db.js` 等存在字节/行数漂移；`copy-drift.md:25-31`：inode 不同，确为独立拷贝。
   - `copy-drift.md:33-47`：本次补丁 9 个替换点在两侧均唯一命中；`copy-drift.md:68-74`：局部补丁可分别应用，但禁止整份 source 覆盖 deployed。

8. **unit-A 的性能/验证边界是“补丁副本与只读等价性”，不是部署后浏览器或重启后宿主实测。**
   - `.workspace/lag-fix/reports/unit-A.md:23-38`：PASS、`queryHeatmap` 289 ms→0.081 ms、逐行等价、无新索引/写库；同时记录 `db.js` 需重启才生效。
   - `unit-A.md:127-147`：T1–T8 的等价性、查询计划、逐行输出和 0.081 ms 属只读复核/副本证据。
   - `unit-A.md:295-301`：明确未验证重启后宿主数字、浏览器真实 HMR/IntersectionObserver、ingest 端到端 wall-clock、DST 与 45 秒缓存故障路径。
   - `unit-A.md:324-380` 与 `copy-drift.md:49-74`：部署侧含额外 hourly/trend/settingsScope/peakRing 功能，不能用源码旧拷贝推断线上完整行为。

### B. 推测/待直接确证

1. **“插件标签导致严重卡顿”的成立条件是进入该标签，而非仅打开设置。**
   - 代码与请求产物支持该方向，但要把它作为当前现场结论，必须确认当前页面确实加载了 `dsh-usage` 卡片、`/usage/*` 请求存在且请求时序与卡顿重合。
   - 最小现场判据：浏览器 Network 过滤 `/usage/`；在设置面板内进入插件标签，观察挂载突发和约 30 秒周期。该判据和前提见 `audit-server.md:23-30,164-172`。

2. **usage 请求是否仍是“默认 30 秒”取决于 deployed bundle 当前内容。**
   - 历史静态定位为 deployed `@local/dsh-usage/lib/client.js:773,887-891`（`audit-server.md:124-133`）；unit-A 的 B2 方案将默认周期改为 60 秒且加可见性门控（`unit-A.md:74-82`）。
   - 但 unit-A 同时说明 `lib/client.js` 需要 HMR/部署路径验证，浏览器真实行为未测（`unit-A.md:295-300`）。因此审计脚本不能把“计划中的 60 秒”当作“当前浏览器已生效”。

3. **“离开 tab 仍挂载”与“离开后不再轮询”必须分别报告。**
   - 前者由 `visitedIds` 静态代码强支持；后者由 `measure8` 历史观测支持，但只覆盖该次运行约 75 秒和当时响应。
   - 不能把 `usage_calls:0` 推导为所有插件卡片卸载，也不能把 `hidden` 推导为定时器一定停止。

4. **客户端 F1（session 快照变化→设置子树重渲染）尚未在活跃会话中得到面板级直接计数。**
   - `audit-client.md:36-48` 给出代码路径与安静态 0 变更；`audit-client.md:156-160` 明确未证实。
   - 需要活跃流式会话/子代理/投影帧负载下，复用 `[role="dialog"]` MutationObserver，同时记录 `session/projection` 帧率和 React commit/面板变更，不能用安静态数据替代。

### C. 反例/限制（防止过度归因）

1. **只打开设置但未进入插件标签**：历史 `measure8.json:1-3` 的 `open_default_tab_usage_calls:0`；`audit-server.md:25-27` 也把 usage 卡片挂载前提限定为“点进设置→插件→可配置”。此路径不能归因于 usage RPC。
2. **插件标签不是唯一热区**：`audit-client.md:115-129` 的热点观测中 `mutations_outside` 有 22 条，而面板为 0；sidebar 占总 DOM 约 68%。因此不能用“插件标签节点最多”证明它是主因。
3. **设置核心接口大响应/慢 RPC 反例**：`audit-server.md:38-57` 显示 settings/plugin inventory/LLM RPC 为毫秒级；`/api/session.list` 3.89 MB/约465 ms 是连接/侧边栏路径，明确不在设置页路径（`audit-server.md:59`）。
4. **usage 卡片离开后历史 probe 未见 75 秒轮询**：`measure8.json:15-24`；这反驳“只要访问过插件标签就必然持续每 30 秒阻塞宿主”的强断言。更准确说法是：组件静态上保持挂载，但该次观测未捕获后续 usage 请求。
5. **安静态 0 mutation 反驳“打开设置必然每帧重渲染”**：`audit-client.md:104-129,156-162`。只能说活跃 session 负载下尚待测量。
6. **unit-A 的 0.081 ms 不能直接宣称线上已降到该值**：`unit-A.md:295-300` 明确重启后真实数字与浏览器行为未验证；`copy-drift.md:9-23` 又证明 source/deployed 漂移。

## 2. 可复用的浏览器选择器与用途

| 用途 | 选择器/代码 | 证据位置 | 可靠性与限制 |
|---|---|---|---|
| 打开设置 | `button:has-text("设置")`；备选 `[aria-label*="设置"]`, `[title*="设置"]`, `a:has-text("设置")`, 英文 `Settings` 变体 | `playwright-measure-original.mjs:89-102` | 已用于历史脚本；`first()`/`last()` 依赖页面按钮顺序，现场需先 count/截图确认。 |
| 设置对话框根 | `[role="dialog"]` | `probe-open.mjs:99-124`; `measure2.mjs:75-83` | 最稳定的面板边界；用于 MutationObserver、节点计数和导航范围。若现场无该 role，脚本会退回 body（仅 `measure2`），会污染结论。 |
| 插件标签 | `[role="dialog"] button:has-text("插件"), [role="dialog"] [role="tab"]:has-text("插件")` | `measure6.mjs:64-73`; `measure8.mjs:37-50` | 历史脚本实际使用；必须限定在 dialog，避免页面其他“插件”文字误点。 |
| 通用设置 | `[role="dialog"] button:has-text("通用设置")` | `measure8.mjs:47-50`; `measure2.mjs:87-100` | 用于离开插件标签的对照；同样依赖中文文案。 |
| 模型标签 | `[role="dialog"] button:has-text("模型")` | `probe-open.mjs:92-97`; `ab-open-vs-closed.mjs:86-92` | 用于较大模型面板对照，不是插件标签本身。 |
| 关闭设置 | `[role="dialog"] button:has-text("关闭"), [role="dialog"] button[aria-label*="关闭"]` | `measure8.mjs:59-66` | 关闭按钮的文案/aria 可能随版本变；需检查 count。 |
| 面板内导航枚举 | `dialog.querySelectorAll('button,[role="tab"],a,[role="menuitem"]')`，取 `textContent` | `measure2.mjs:74-84` | 用于发现真实标签名；不能把所有短文本都当 tab，脚本历史上最多取前 14 个。 |
| 面板 MutationObserver | `document.querySelector('[role="dialog"]')` 后 observe `{childList:true,subtree:true,attributes:true,characterData:true}` | `probe-open.mjs:99-117` | 适合验证“面板是否发生重渲染”；观察到 0 只说明观测窗口内没有 DOM/属性/文本变更，不等同于没有 React render。 |
| usage 网络判定 | `requestfinished` 后检查 URL 去掉 origin 后是否 `startsWith('/usage')` | `measure8.mjs:24-30` | 比 DOM selector 更直接；记录的是浏览器请求完成，需结合请求发起时间、响应时间和 host latency。 |

## 3. 负载前提矩阵（审计必须同时记录）

| 场景 | 已有数据 | 可支持的结论 | 不可越界的说法 |
|---|---|---|---|
| 安静、设置关闭 | `audit-client.md:108-113`；`measure9.json:1-14`（150 s、无 usage RPC、max 7.9 ms） | 基线/无插件请求对照 | 不能外推到活跃会话或已访问插件标签。 |
| 安静、设置打开但默认/通用 tab | `measure8.json:1-3`、`measure3.json:15-27` | 打开设置本身不必然触发 usage；核心 API 少量调用 | 不能断言“设置永远无责”，也不能覆盖已访问插件 tab 的历史挂载。 |
| 进入插件 tab | `measure2.json:31-44`、`measure7.json:21-102`、`measure8.json:1-14` | 会产生约 9 个 `/usage` 请求；历史样本中数百毫秒级 | 不能把一次请求耗时当作每轮稳定值；样本中 356–498 ms 有明显波动。 |
| 插件→通用设置，约75 s | `measure8.mjs:47-57` + `measure8.json:15-24` | 该次历史运行没有后续 usage 请求，host max 62.8 ms | 不能仅凭此证明卸载；与静态 `visitedIds` 保持挂载相冲突时，应分别陈述。 |
| 活跃 WS/会话/子代理帧 | `measure5.json:5-21`、`audit-client.md:128-129` | 运行时/sidebar 热负载存在；可作为 F1 复测前提 | 现有 panel mutation 证据是在安静态，不能宣称 F1 已在该负载被证实。 |
| patch 副本/静态等价性 | `unit-A.md:127-147,282-292` | 补丁逻辑、查询计划、输出等价和副本 benchmark | 不能替代 deployed bundle hash、浏览器 HMR、宿主重启后真实延迟。 |
| source vs deployed | `copy-drift.md:9-23,33-47,68-74` | 必须按 target 分别核验 | 不能读取 source 行号就断言部署 bundle 同行同实现；仅本补丁局部替换点已证明一致。 |

## 4. 对“插件标签性能审计”的推荐证据边界

### 可直接写入审计结论

- “进入设置→插件标签”是 usage 服务端候选的必要前提；“仅打开设置/通用设置”不是该候选的充分条件。
- usage 卡片的历史实测请求与同步 SQLite 路径足以证明**条件性**主线程阻塞风险；请求数和耗时必须引用具体产物，不应写成固定常数。
- `visitedIds` 造成访问过的 tab 保持 mounted/hidden 是静态事实；是否继续定时轮询必须以当前 deployed bundle 和现场 Network 实测为准。
- 安静态面板 mutation 为 0，故不能把“设置页每帧重渲染”作为已证实事实；活跃 session 负载是必要复测前提。
- source/deployed 漂移意味着任何修复验收必须标明 target；unit-A 的副本 PASS 不等于重启后线上 PASS。

### 最小现场复测（只读）

1. 先记录 deployed bundle 的 hash/服务响应版本，并确认 PID/URL；不要只读 source。
2. 用 `button:has-text("设置")` 打开设置，记录默认 tab 期间 `/usage/` 数量应为 0（若目标是复现 usage 路径）。
3. 在 `[role="dialog"]` 范围点击“插件”，记录挂载瞬间所有 `/usage/*` 的 URL、耗时、响应时间；至少覆盖一个 30/60 秒周期。
4. 切回“通用设置”，同时：
   - Network 继续监听 `/usage/`；
   - 以 `[role="dialog"]` 为根挂 MutationObserver；
   - 记录 host probe 延迟。
5. 如需验证 F1，必须在真实流式会话/子代理/投影帧持续期间重复第 4 步，并同步统计 `session/projection` 帧率；安静态结果只能作反例/基线。

## 5. 一句话裁决

现有证据支持的最窄结论是：**插件标签存在一个有明确挂载前提的 usage 卡片阻塞风险，历史进入该标签时确实出现数百毫秒级 `/usage` 请求；但“打开设置即持续卡顿”、 “离开插件后仍必然轮询”、以及“设置子树每帧重渲染”均不能在当前证据边界内作为无条件事实。修复/验收还必须区分 source 与 deployed，并把真实浏览器负载（尤其活跃会话）写进前提。**
