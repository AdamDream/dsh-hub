# 设置页卡顿：架构 / 部署 / 证据一致性交叉审计

- **审计角色**：第二独立总审计员（只读；本文件是唯一写入）
- **审计时间**：2026-09-20（当前工作区与 live 盘面）
- **对象**：`http://127.0.0.1:3080/` 设置页卡顿修复，A / B1 / B2 / C1 / C2 全链路
- **结论等级**：**修复件已部署且 B1 已重启生效；“设置页卡顿已解决”仍不能成立。最可能机制是 C1/P2 不能消除的高频事件驱动列表投影/下游渲染成本，在高事件流、浏览器实际负载和设置页无 memo 边界下复发；A 的同步 SQLite 冻结已被代码路径修复但缺少正式 live 端到端验收。**

## 1. 取证范围与当前状态

已读取：

- `docs/program-notebook.md`；`docs/architecture/01-architecture-overview.md`、`02-plugin-system.md`、`03-model-routing-gateway.md`、`04-ops-deploy.md`
- `.workspace/lag-fix/RUNBOOK.md`、`REBOOT-RUNBOOK.md`
- `.workspace/settings-lag/DIAGNOSIS.md`、`audit-client.md`、`audit-server.md`、`audit-data.md`、`audit-rebuild.md`、`audit-usage-fix.md`、`audit-subagent-filter.md`
- `.workspace/lag-fix/reports/unit-A.md`、`unit-B1.md`、`unit-B2.md`、`unit-C1.md`、`unit-C2.md`
- `BEFORE-AFTER.md`、`audit-cross-acceptance.md`、`audit-cross-client.md`、`audit-cross-patches.md`、`audit-cross-data.md`、`finding-A-gating-inert.md`、`finding-B1-ctx-scope-inert.md`
- 当前 git 状态、当前 live 文件、当前宿主和 HTTP 状态。

当前现场证据：

1. Git：`main`，HEAD=`562b7418`（B1 ctx 作用域事故修复）；相对 `origin/main` 领先 19；当前 git status 输出无未提交改动。
2. 宿主并非 Runbook 中的旧 PID 20806，而是当前 `node .../bin/dsh web` PID **1209782**（上层包装 PID 1209767/1209781）；`curl http://127.0.0.1:3080/` = **HTTP 200**。因此 RUNBOOK 中固定 PID 20806 已过期，不能作为当前验收前提。
3. 当前 live 哈希（sha256）：
   - usage `db.js`=`77ab2e8e...`，`client.js`=`eeb5dcf2...`；A 补丁在盘。
   - host-apiproxy `lib/index.js`=`1b9915f5...`、`lib/types/api-proxy.js`=`f5c34a43...`；B1 ctx 修复后的两份文件在盘。
   - client-runtime=`d71a8ca5...`；C1 P1/P2 + B1/C1 行在盘，P4 未应用。
   - workspace-enhancement=`7df7a655...`；C2 在盘。
4. 用真实 RPC 请求活体复核 `POST /api/session.list`：HTTP 200，响应 **501,909 B**，**290 条 = 顶层 90 + subagent 200**，90/90 顶层含数值型 `runningSubagentCount`。这与 `finding-B1-ctx-scope-inert.md` 的重启后 290/469,855 B 结论方向一致，但当前活体已经有新会话增长，不能再引用旧 PID/旧字节数。
5. 直接请求 `/api/usage/heatmap` 和 `/usage/heatmap` 返回 404；这不是 A 失败的证据，usage 接口是插件 RPC 面而非这两个裸 REST 路径。但也说明“heatmap <40ms”必须用正确 RPC 探针验收，不能用裸 URL 证明。

## 2. 总体架构裁定：同意什么、反驳什么

### 2.1 `DIAGNOSIS.md` 的 M1/M2

**同意，但需要把“已解决”拆成两个不同命题：**

- M1（usage 同步 SQLite 主线程冻结）是源码和旧 live 实测共同支持的直接机制：`DatabaseSync` + 非 sargable `strftime` 全表扫描确实可造成 0.3–0.5 秒宿主事件循环冻结；`usage_daily` 快路径和 `ts` 范围回落是合理修复。
- M2（事件流驱动的会话列表 churn）仍是最可能的设置页残余机制。诊断给出的 `buildListSnapshot`、O(N²) 清理、每次新 projection 引用、设置面板无 memo 的链路与架构边界一致。C1 P1 明显降低了单次清理成本，P2 可在投影内容不变时稳定引用；但它们**没有**消除高频 `session/event` 触发、`projectList()` 的全量构造、设置页 renderer 的无 memo 边界，也没有建立“设置页不订阅/隔离会话列表更新”的边界。因此不能由补丁落盘推出卡顿根治。
- 反驳诊断中任何把 M1+M2 写成“两个修复均已正式验收”的表述：`BEFORE-AFTER.md` 和 `RUNBOOK.md` 自身已经承认客户端门槛未成立；M1 的 0.046/0.081ms 是离线或副本测量，不是当前宿主 RPC 的 live 结果。

### 2.2 A 线（usage）

**同意实现方向；反驳验收闭环已完成。**

- 同意 `usage_daily` + 能力护栏 + sargable 回落 + 60 秒/可见性门控的设计，`unit-A.md` 的等价性和 `finding-A-gating-inert.md` 的行为探针足以证明补丁文本和门控行为本身。
- 同意此前“门控已落地”曾经是错误结论；`setPollVisibleRef` 死代码被行为探针发现，说明仅 grep 标记/渲染冒烟不足。
- 反驳“宿主冻结已消失”的强断言：`db.js` 是冷面，必须以正确 RPC 在当前 PID、真实 usage 卡片挂载后复测宿主停顿和端点耗时。当前裸 URL 404，不能冒充验收。
- 额外一致性风险：源码 `dsh-usage/` 与部署拷贝不是完全同步，报告承认部署侧是更新超集。9/9 补丁区一致只说明本次补丁区一致，不等于源码、部署件、未来重放源完全同构。coordinator 必须决定是否回灌源代码，或明确部署件为唯一运行真相。

### 2.3 B1 服务端过滤/聚合

**同意重启后主要功能已生效；反驳“B1 已完整解决/最近 200 语义成立”。**

- 同意 `finding-B1-ctx-scope-inert.md`：之前的 `ctx` 自由变量导致真实重启后 `session.list` 500，且测试通过 `new Function('ctx', ...)` 注入缺失绑定，属于测试无法证伪实现的严重盲区。
- 同意 ctx 修复已经 live：当前真实 RPC 200、290 条、顶层计数覆盖，证明过滤/聚合主路径已过重启闸门。
- **必须反驳 B1 报告 §2 的“冷会话最近 200 条”结论**：`persistence.list()` 返回 header meta，不含 `updatedAt`；生产代码的 `coldSource` 排序使用 `b.updatedAt - a.updatedAt`，会得到 `NaN`，排序退化为枚举顺序。该缺陷已经在 `finding-B1-ctx-scope-inert.md:103-117` 明确记录，尚未修复。因此当前 200 条只是数量上限，不是“最近活跃 200 条”；它会影响旧 subagent 的可见性和列表稳定性，也可能造成客户端仍接收不理想的行集。
- 当前 290 条响应和 90 个顶层计数只能证明“服务端路径不再 500”，不能证明冷会话排序、父子可达性、所有客户端切换器语义完全成立。

### 2.4 B2 数据缩容

**同意安全性，反驳其作为性能因果证据。**

- 同意 1,670 条 subagent 的全量规则审计、tar 可恢复性、顶层会话不误删，以及 phase 2 必须在重启后执行的时序判断。
- 反驳用 B2 后的 N≈734 与诊断期 N=2361 直接宣称 C1 带来 −77%/−67%/−82%。N 是 M2 的主变量，且机制近似 O(N²)；代码补丁和数据删除同时发生，性能收益不可归因。
- phase 2 是否已经执行不能从“重启完成”自动推出。旧报告要求重启后再清理 `session_projcache.json` / `sync_state`，而当前尚未读取新的 phase-2 apply 记录；应视为**未知/待证**，不能把孤儿投影清理写成完成。

### 2.5 C1 官方 client-runtime

**同意 P1/P2 的局部正确性；反驳设置页根治结论。**

- 同意 P1 的 `Set` 替代 `Array.some` 是语义等价且微观基准有显著收益；同意 P2 比较器的反向测试比早期“只看标记”更强；同意 P4 用户已弃用，live 中不应声称存在。
- 反驳端到端门槛已通过：`audit-cross-acceptance.md` 的独立复测 idle 84.3ms/s、settings-open p99 66.7ms，均超过门槛；同一批数据还有 89.8/81.4ms/s 和 p99=100/83.4。`BEFORE-AFTER.md` 已正确收回 v1“全部通过”。
- 因此 C1 目前是“降低一个热点的单位成本”，不是“阻止设置页被高频列表更新卷动”。残余 M2 仍可解释设置页在真实活跃流下复发。

### 2.6 C2 第三方插件

**同意局部优化，反驳其足以闭合主因。**

- 同意 `remoteSessionIndex` 的 Set 去重和 `sessions()` 按 snapshot 引用记忆化在测试数据形状下等价，且 live 哈希与交付副本一致。
- 必须保留其边界：记忆化安全性依赖 snapshot 引用变化与内容变化同步；报告只完成静态前提核查，未在真实远程工作区做就地 mutate 行为验证。该风险不是卡顿主因的证据，但不能写成无条件证明。
- C2 只削减第三方附加成本，不能解释/消除官方 runtime → settings renderer 的主链路；不能据 C2 PASS 推断设置页已不卡。

### 2.7 既有交叉审计

- **`audit-cross-client.md`：同意**其 rev/HTTP 字节/功能冒烟结论；反驳“功能冒烟足以代表性能解决”。该报告明确发现性能不可复现、服务端字段当时尚未生效，后续活体只证明 B1 已修复，不改变其方法学批评。
- **`audit-cross-acceptance.md`：基本同意且应作为当前门槛裁决依据**。它正确指出 N、WS 类型、窗口条件混杂，百分数算术正确但不可归因；当前不应恢复“通过”字样。
- **`audit-cross-patches.md`：同意其高危回滚发现**：共享 `client-runtime` 的 C1 回滚会抹掉 B1/C1 行；B1 两脚本路径存在性校验 fail-open；C1 dry-run 已应用子集输出误导。它证明部署治理仍有缺陷，但不证明运行时卡顿已解决。
- **`audit-cross-data.md` / `unit-B2.md`：同意删除规则、备份、可恢复性；同意 sync_state 的“前缀行数 ≠ 当前悬空行数”更正。反驳把 phase 2 结果当已完成；当前仍需新证据。
- **`finding-A-gating-inert.md` / `finding-B1-ctx-scope-inert.md`：完全同意其方法论教训**：行为类改动要制造触发条件；测试数据形状必须与生产对象形状一致；自由变量作用域不能由测试注入掩盖。B1 cold sort 仍是同类未决盲区。

## 3. 源码—部署件—补丁—重启状态一致性

| 面 | 裁定 | 证据 / 风险 |
|---|---|---|
| A usage deployed | **补丁在盘，已由当前哈希确认** | live `db.js`/`client.js` 为 POST 哈希；宿主侧 `db.js` 是否已由当前 PID加载需正确 RPC 性能探针确认 |
| A usage source | **补丁区相同但非全量同步** | `unit-A.md` 明示部署拷贝是更新超集；源码追平是待决项 |
| B1 server | **部署件已修，重启后生效** | 当前 session.list 200、290 条、90/90 计数；冷会话排序 defect 仍在 |
| B1 client/runtime | **live 在盘且服务已能正常列会话** | 当前 live runtime 哈希为已补丁态；需保留 B1/C1 共享回滚顺序 |
| C2 | **live 在盘** | 哈希=`7df7a655...`，与 `unit-C2` 交付副本一致 |
| phase 1 | **曾完成且有完整备份证据** | 1,670 会话 + 1,597 遗留文件；当前会话目录/投影数字会继续变化 |
| phase 2 | **当前未知** | 未见本次审计可确认的 apply 后记录；不能以“已重启”替代 phase-2 验证 |
| 重启 | **已发生且当前服务可用** | 旧 20806 已过期；当前 PID 1209782，HTTP 200。所有旧文档固定 PID 引用应改为时点化/判定式 |
| git/live 一致 | **只对仓库内文件可直接说一致；仓库外 live 依赖哈希证据** | 当前 live 文件不由 git status 覆盖，部署包/备份指纹才是证据；报告不能写“git clean ⇒ live clean” |

## 4. 最可能机制与之前审计盲区

### 最可能机制（按当前证据排序）

1. **首要残余机制：高频 `session/event` → `buildListSnapshot/projectList` → 全量 store 通知 → 设置页无 memo renderer 被动重渲染。** P1 把单次 O(N²) 清理降下来，P2 在内容不变时复用引用，但事件流存在时仍可能持续产生新投影；设置页没有订阅隔离/ memo 边界。此前可重复性不足且负载类型混杂，不能宣称已消失。
2. **次要机制：若用户进入“插件”标签，usage 卡片仍是宿主同步查询触发源。** A 已大幅降低查询，但正确 RPC + 当前宿主事件循环必须实测；裸 `/usage/heatmap` 404 说明现有错误探针不能作为排除依据。
3. **放大/一致性机制：B1 cold subagent 排序不是按 updatedAt，而是 header 上不存在的字段排序。** 这会使列表选集不稳定，可能保留任意旧 subagent，增加前端工作量或造成用户看到“近期活动不对”；虽不是主线程 O(N²) 的原始根因，却是修复语义未兑现。
4. **数据层残留：若 phase 2 未完成，projcache/sync_state 的孤儿残留可能让后续投影/同步工作量高于预期；必须以当前文件行数和宿主重写后的稳定性验证，不能推测。

### 之前审计的结构性盲区

- **把标记存在、文件哈希一致、页面能渲染当成行为生效**：A 门控死代码已证明这一缺陷；B1 ctx 事故进一步证明语义测试可因人为注入自由变量而失真。
- **测试数据形状与生产数据形状不一致**：B1 语义测试用带 `updatedAt` 的 summary 行模拟，生产 cold path 用无 `updatedAt` 的 header meta；因此“最近 200”测试全绿但生产不成立。
- **把离线等价性/微观基准升级成 live 端到端结论**：A 的 0.046/0.081ms、C1 的 5.225→0.084ms 都是有价值的局部证据，不等于当前浏览器设置页 p99 低于 50ms。
- **性能 A/B 未锁定 N、事件类型、事件速率、页面完成状态和同刻窗口**：跨 N 的 phase 1 缩容与代码补丁混杂；WS 信封类型和 session/event 类型混杂；`session_list` 探针曾因 RPC 信封错误固定返回 680B/null；某次 settings-open 实际面板未挂载。
- **重启状态记录依赖过期 PID**：RUNBOOK 的 20806 已失效；当前 PID 已变为 1209782。服务 200 不是性能验收，且旧文档“唯一待办是重启”已经过时。
- **部署边界没有单一真相源**：源码与 deployed usage 拷贝是更新超集关系；官方包 live 在 `.npm-global` 真实路径/符号链接农场；只看 git diff 无法确认 live。
- **只验证冷面重启成功，没有验证重启后的所有数据状态**：B1 500 暴露后虽已修复，但 phase 2、宿主重新写 projection、冷会话选择集、当前 usage 延迟仍未形成同一批次的闭环证据。

## 5. 必须由 coordinator 做的冲突裁决

1. **性能结论裁决**：正式状态只能写“局部热点已优化、设置页卡顿未正式解决/待受控复测”，还是允许写“主因已缓解但门槛未证实”。本审计建议前者。
2. **B1 cold 排序裁决**：是否立即追加一个独立单元，按 `sessionListMetadata`/projcache 的 `lastPromptAt` 与 header 合并计算 `updatedAt` 后再取最近 200；不得用当前 `meta.updatedAt` 假设继续验收。
3. **A live 验收裁决**：指定正确的 usage RPC 方法和请求体，重启后在当前 PID 下测 `/usage/*`、host event-loop max、usage 卡片挂载/离开视口行为；禁止用 404 裸 URL 或离线 0.081ms 代替。
4. **phase 2 状态裁决**：确认是否已 apply；若未执行，先在当前宿主稳定重启后执行，再读取 `session_projcache.json` 和 `sync_state` 的实际悬空行，并复验宿主不回灌。
5. **客户端门槛裁决**：重新设计受控测量：固定 N（或记录精确 N）、固定页面装载完成状态、固定 session/event 类型和流式速率、≥5 次重复，报告中位数与区间；将 C1/P1、P2、B2、C2 分别归因，不把 B2 删除数据收益归给 C1。
6. **源码/部署真相裁决**：决定 `dsh-usage/` 源码是否追平 deployed 超集；若不追平，明确“部署件为 live 真相、源码为非完整镜像”，并给出下次重放来源，避免源代码回灌旧行为。
7. **回滚治理裁决**：修复 B1/B1C1 回滚的内容指纹 fail-open 和共享 runtime 的所有权/顺序门禁；否则下一次回滚可能静默写入伪造文件或抹掉其它单元。
8. **文档裁决**：刷新 RUNBOOK 中固定 PID 20806、736/742/734 的互斥数字、0.046/0.081 两套 heatmap 数字，以及“唯一待办=重启”；所有 live 结论必须带时间戳、PID、请求方法和原始证据路径。

## 6. 最终裁定

- **部署一致性**：A/B1/C1/C2 的关键 live 文件与交付哈希一致；B1 ctx 事故已修、宿主已重启、session.list 当前真实 200/290 条，故“补丁未部署/未重启”不是当前最可能原因。
- **证据一致性**：补丁局部证据强，端到端性能证据弱且互相混口径；已有交叉审计对这一点的反驳成立。
- **最可能原因**：设置页仍被高频会话列表投影与无 memo 设置 renderer 卷动；A 只解决 usage 冻结的一条冷面路径，不能覆盖该残余机制。
- **是否已解决**：**反驳。当前证据不足以宣布“设置页卡顿已解决”；应标记为“局部修复已生效，残余卡顿未闭环验收”。**
