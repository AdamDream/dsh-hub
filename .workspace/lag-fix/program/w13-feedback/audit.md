# w13-feedback 审计：反馈面与可恢复性

- 日期：**2026-09-22**
- 审计线：`.workspace/lag-fix/program/w13-feedback/`（协调者线；下辖 2 个二级只读子代理档：`E-HOST.md` / `E-UI.md`）
- 代码根：`/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`（197 包，已构建产物）
  - 例外 1：**`dsh-client-ui-primitives` 不在上述目录**（Toast / ConnectionBanner / StateDot 的实现被打包进 Web 外壳 `dsh-web-frontend/dist/assets/index-ClqxG24t.js`，399 KB 压缩产物，变量名已 mangle）⇒ **对该包的改动不享受「热面刷新即生效」**，需重建 Web 产物。
  - 例外 2：`@local/dsh-usage`（用量卡片）在 `/home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-usage/`（外部安装插件，非 197 包之一）；源码副本在 `/home/CNS2026495165/dsh/dsh-usage/`。
- 宿主：PID **301709** = `node /home/CNS2026495165/.npm-global/bin/dsh web`，GUI `http://127.0.0.1:3080`。

> ## 只读纪律声明
> 本审计为**只读审计**。**未修改任何产品文件**（npm-global 与 `~/.dsh/profiles/@local` 下全部只读；子代理档 `find … -newermt 14:30` 复核 = 0 个产品文件被改）；**未重启 / kill / pkill 任何进程**（宿主 start time 全程保持 `10:54:59`）；**未启动任何浏览器**；**未发起任何写操作**（未调 `/usage/refresh`、未订阅 `/api/events.*`）。唯一写入位置 = 本目录（`audit.md` + `evidence/`）。
> 唯一的活体动作是经**逐字读码确证无副作用**的只读 RPC：`POST /usage/status`（handler 仅 `return statusProvider()`，`@local/dsh-usage/lib/rpc.js:203-204`）与 `GET /`。

> ## 证据分级（每条结论均标注）
> - **读码确证**：逐字读源码 + 逐字引用，静态可判定。**本报告未标注者绝大多数属此类，不等价于实测。**
> - **实跑确证**：本机真实执行并留证（只读 RPC / `curl` / `ps` / 文件系统）。
> - **复刻微基准**：把算法按逐字语义复刻为独立 Node 脚本计时。**不是产品端到端实测**，只有同比与增长阶有效，绝对毫秒数不得外推。
> - **推断**：由结构推出、无直接证据。

---

## 0. 摘要

### 0.1 一句话结论

> **反馈面的结构性问题不是「每次事件都全量重算」**——那条**成立但已用两个独立复刻微基准证伪为"可感卡顿立柱"**（N=1000 时 0.034–0.037 ms/次，要占单核 1% 需 ~270 帧/s）；**而是三条最关键的失败通道在客户端被传输到、却零 UI 消费**：
> ① `listError`（会话列表拉取失败）**零消费者**；② `lastAgentError`（宿主 `host/agent-error`）**零消费者**；③ 连接断开/重连**零消费者**——primitives 里甚至导出了一个专用 `ConnectionBanner` 组件（含现成文案与全宽横幅 CSS）而**197 包 0 引用**。
> 与之对偶的是**服务端**：宿主插件**日志没有任何持久出口**（cordis 唯一 exporter 是 1000 条内存环形缓冲，而该 buffer 全树**零读取点**）⇒ 所有 `log.warn` 级失败（ingest 失败 / worker 崩溃 / DB 不可用 / bootstrap 失败）**沉入 Terminator 终端回滚缓冲**。
> 因此本线的裁决是：**DSH 的业务 RPC 契约是健康的（错误码具体、不折叠成成功、模型失败可持久可重试），真正缺的是「失败之后你能知道什么」**——缺口集中在**传输层**与**可观测层**，而不是业务层。

### 0.2 判定总表（本线汇总；详见 §3–§6）

| 范围 | PASS | FAIL | INCONCLUSIVE |
|---|---|---|---|
| ① 通知/状态系统（触发频率与渲染成本） | 4 | 2 | 2 |
| ② 错误呈现（宿主 RPC 失败/超时） | 2 | 4 | 1 |
| ③ 不可恢复状态可观测性 | 2 | 4 | 1 |
| ④ 性能诊断入口 | 1 | 3 | 1 |
| **合计** | **9** | **13** | **5** |

分档统计（子代理档自报，本报告 §8 已复核其关键证据）：`E-HOST` PASS 6 / FAIL 7 / INCONCLUSIVE 3；`E-UI` PASS 8 / FAIL 8 / INCONCLUSIVE 6。

### 0.3 本审计对任务书前提的两条更正（重要，先看这里）

| # | 任务书/BATCH-PLAN 的表述 | 实测事实 | 影响 |
|---|---|---|---|
| **C1** | 「`ingest` 的 45 s timer 未触发，异常被 `index.js:220` 的 `.catch` 吞成一行 warn」 | 机制成立但**该形态已过时**：deployed `index.js` 已改用正确的 `ctx.inject(["timer"], cb)`（`@local/dsh-usage/lib/index.js:318-334`），但**被整体包在常量 `INGEST_TIMER_ENABLED = false` 内**（`:67`）⇒ timer 目前是**死代码**。且 `:220` 是注释，真实吞异常点是 `:335`（bootstrap 链尾）、`:184`/`:188`/`:310`。 | **U-IG2 未落地，BATCH-PLAN 闸门 G1 仍未被回答**。本线**不宣称**「timer 已修好」。详见 §5.3。 |
| **C2** | 「`syncCompletedNotifications` 可能每次事件都渲染、成本高」 | 后半**不成立**：触发频率确为「每事件一次」（3 个调用点，PASS），但每次成本 **0.034 ms @N=1000**，且**两个独立复刻微基准相互吻合**（本线 `raw/bench-notify-path.txt` 0.0358 ms；子代理档 `raw/microbench-notifications.out.txt` 0.0336 ms，差 6%）。 | **不得**把它写成卡顿立柱。可行的真实收益是**结构整洁性**（把 `:8089` 挪出重放循环，M 倍），不是帧率。详见 §3.2。 |

---

## 1. 方法

- **两阶段闭环**按 `~/.dsh/AGENTS.md`：本档（协调者）承担范围 ① 核心机制 + ③/④ 交叉验证 + 裁决；两个二级只读档并行扇出，文件边界互斥（`E-HOST.md` 由 A 档独占、`E-UI.md` 由 B 档独占），本档只写 `audit.md`。
- **交叉验证**：本档与两个子代理档对 `syncCompletedNotifications` 做了**互相独立的算法复刻微基准**，两套数字吻合（见 §0.3 C2）；对 `/usage/status` 陈旧性做了**三条独立采样**（本档 2 次 + A 档 1 次，跨越 80 s > 45 s 周期，`lastIngest` 逐字节相同）。
- **不重复测量**：incident2 已确证的结论（宿主 `session.list` 全量重扫、9 路 `/usage/*`、设置面板无 keep-alive、遮罩 `backdrop-filter`）一律**引用而非重测**，来源标注在行内。
- ⚠️ **本报告不含任何浏览器端测量**（本档无锁、且 BATCH-PLAN §五要求独占门禁）⇒ 所有渲染侧结论都是**读码确证**，不写实测帧数。

---

## 2. 范围 ① 通知 / 状态系统：触发频率与渲染成本

### 2.1 `syncCompletedNotifications` 的触发频率 —— **PASS**（「每个事件都全量重算」为真）

`dsh-client-runtime/lib/client.js` 中 **3 个调用点**（`grep -n syncCompletedNotifications` 全仓仅此 3 处 + 定义处）：

| # | `file:line` | 语境 | 触发频率 |
|---|---|---|---|
| 1 | `dsh-client-runtime/lib/client.js:8251` | `recordMutation()` 内 | **每个 list mutation 一次** |
| 2 | `dsh-client-runtime/lib/client.js:8089` | `refreshList()` 的 **mutation 重放循环体内部** | **每次 pull × 每个积压 mutation** |
| 3 | `dsh-client-runtime/lib/client.js:8094` | `refreshList()` 成功路径末尾 | 每次 pull 一次 |

逐字（`:8247-8253`）：

```js
			/** Apply immediately and retain for replay when a list response is in flight. */
			recordMutation(mutation) {
				this.listMutations?.push(mutation);
				this.summaries = applyMutation(this.summaries, mutation);
				this.syncCompletedNotifications();
				this.notifier.markDirty();
			}
```

逐字（`:8086-8094`）：

```js
							for (const mutation of mutations) {
								summaries = applyMutation(summaries, mutation);
								this.summaries = summaries;
								this.syncCompletedNotifications();
							}
							this.summaries = summaries;
							this.listState = "idle";
							this.listPhase = "ready";
							this.syncCompletedNotifications();
```

**`recordMutation` 的上游事件**（即「每个事件」具体是哪些），全部在 `SessionManager`：

- `:8297-8301` —— mux 帧 `session/event` + `user/message`（用户消息）
- `:8363-8372` —— `host/session-added`（经 `mergeSummary`，定义在 `:8224`）
- `:8379-8386` —— `host/session-removed`
- **`:8410-8415` —— `host/session-status`（running 位翻转）**，逐字：

```js
					case "host/session-status":
						this.recordMutation({
							kind: "status",
							sessionId: frame.sessionId,
							running: frame.running
						});
						this.sessions.get(frame.sessionId)?.handleRunning(frame.running);
						this.updateCatalogActivity(frame.sessionId, frame.running);
						return;
```

⇒ **每一条 `host/session-status` 帧（= 每个 agent 起 / 停，含每个子代理的起停）都触发一次 N 行全量重算**。判定 **PASS**。

**关键对照（说明为什么这是"唯一未合并者"）**：同一文件里的 `Notifier` **已经**做了批处理——`markDirty()` 合并到微任务、`markFrameDirty()` 合并到一帧（`:5662-5674`），`rafBatch` 在 `:5365-5383`。而 `syncCompletedNotifications()` 是**同步、立即、未被任何批处理覆盖**的——即**全项目唯一「在 batched notifier 旁边同步全量跑」的计算**。判定 **PASS（结构性）**。

### 2.2 每次成本 —— **PASS（结构）/ 量级极小（复刻微基准）**

逐字（`:8536-8552`）：

```js
			syncCompletedNotifications() {
				const seen = /* @__PURE__ */ new Set();
				for (const s of this.summaries) {
					seen.add(s.sessionId);
					const prev = this.prevRunning.get(s.sessionId);
					if (prev === void 0) {
						this.prevRunning.set(s.sessionId, s.running);
						continue;
					}
					if (prev && !s.running) {
						if (s.sessionId !== this.selected) this.completedNotifications.add(s.sessionId);
					} else if (s.running) this.completedNotifications.delete(s.sessionId);
					this.prevRunning.set(s.sessionId, s.running);
				}
				for (const id of this.prevRunning.keys()) if (!seen.has(id)) this.prevRunning.delete(id);
				for (const id of this.completedNotifications) if (!seen.has(id)) this.completedNotifications.delete(id);
			}
```

成本结构：**每次调用 `new Set()` 一次** + 3 趟 O(N) 遍历（主循环 + `prevRunning.keys()` 清理 + `completedNotifications` 清理），全部原地 add/delete，无数组分配。

**两个独立复刻微基准**（`evidence/raw/bench-notify-path.txt` 为本档；`evidence/raw/microbench-notifications.out.txt` 为 B 档）：

| N | 本档 `syncCompletedNotifications` | B 档同函数 | B 档 `recordMutation` 合计（含 `applyMutation`） |
|---|---|---|---|
| 100 | 0.0140 ms | 0.0042 ms | 0.0043 ms |
| 1000 | **0.0358 ms** | **0.0336 ms** | **0.0374 ms** |
| 2000 | 0.0716 ms | — | — |
| 5000 | 0.2906 ms | 0.2733 ms | 0.3039 ms |

**量级裁决**：N=1000 时 0.037 ms/次 ⇒ 要占单核 1%（10 ms/s）需 **~270 帧/s**。本机当前 workspace 的会话规模（实跑：`~/.dsh/sessions/--home-CNS2026495165-dsh--/` = **400 个会话目录**，全库 1209 个）远达不到该帧率。
⇒ **判定：结构问题成立（PASS），但"构成可感卡顿"被证伪（FAIL 该假设）。不得作为卡顿立柱。**

B 档补充的 **M-重放放大**（`raw/microbench-notifications-m.out.txt`，N=1000）：legacy 在 pull 循环内跑 M 次 vs 合并 1 次 —— M=1 → 0.0377 vs 0.0323 ms；M=20 → 0.6237 vs 0.0332；M=100 → 3.2108 vs 0.0310 ⇒ **倍数 = M**。这是 `:8089` 的**唯一**实质后果，属结构整洁性。

### 2.3 可合并性 —— **PASS（有正确方案）/ 朴素合并会破坏语义（重要陷阱）**

绿点靠 `prevRunning` 的 **true→false 边沿**（`:8545-8547`），代码注释**自陈**了为什么不能在快照构建期统一跑（`:8528-8534`）：

```js
			* Reconcile completion reminders against the latest summaries, eagerly after
			* every mutation and pull (a snapshot-build-time pass would collapse
			* consecutive status frames into one observation). A running→idle edge of a
			* non-selected session arms its reminder; running disarms it; removal drops
			* it. First observation only records the running bit — sessions already
			* idle at load get no reminder.
```

⇒ **正确修法不是「少调用几次」，而是把「边沿检测」下沉为 `applyMutation` 内的 O(1) 操作、把「快照清理」留在 flush 期**。验收哨兵必须是**语义等价**（同微任务内 true→false 仍须亮），**不能**用性能收益验收——否则会把 bug 当收益交付。

### 2.4 运行中子代理计数 —— **PASS（宿主字段为主，覆盖 100%）/ 客户端兜底仍无条件计算**

**双源**，逐字（`dsh-client-ui-workspace/lib/client.js:171`）：

```js
				runningSubagentCount: typeof s.runningSubagentCount === "number" ? s.runningSubagentCount : (descendants.get(s.id)?.runningCount ?? 0), /* dsh-lag-fix B1/C1 */
```

- **源 A（宿主，主）**：`dsh-host-apiproxy/lib/index.js:1244-1274` `annotateRunningSubagentCounts()`，对**每一个非 subagent 行**无条件赋值（`:1256-1272`，`if (item.origin === "subagent") continue;` → `item.runningSubagentCount = count`）⇒ **顶层行覆盖率 100%**，且注释（`:1236-1240`）明确说明**截断不影响计数**（血缘与 running 同源于 `ctx.sessions.list()` 一趟遍历），并**要求消费方优先采用本字段**。成本 = 一趟 live 会话表遍历（与 running 合并）。
  ⇒ 这**解决了 B 档标 INCONCLUSIVE 的 §1.4**：本档据此改判 **PASS**（读码确证，覆盖率由 `:1257` 的 `continue` 反向证明为「除 subagent 行外全部」）。
- **源 B（客户端，兜底）**：`dsh-client-runtime/lib/client.js:10360-10381` `indexSubagentDescendants()` —— 对**每个** subagent 后代**沿父链向上走**，且**每个后代各 `new Set()` 一次**（`:10364`）⇒ O(N × 血缘深度) + N 次 Set 分配。

**被 4 处调用，全部依赖整快照身份**：`dsh-client-ui-workspace/lib/client.js:194`（`deriveGroups`）、`:224`（`deriveFlat`）、`:253`（`deriveSearchResults`）、`dsh-client-ui-subagent/lib/client.js:415`（`CatalogDropdown`）。
⚠️ 即使顶层行都命中源 A，**这 4 处仍然无条件把整张索引算出来**（`:415` 的 `useMemo` 无论如何都执行 `indexSubagentDescendants(summaries)`）。⇒ **有一个纯收益的优化**：当所有行都带宿主字段时整张索引可省（或按需惰性计算）。

**更新频率**：宿主字段随 `session.list` 刷新；帧路径上的即时性由 `host/session-status` → `updateCatalogActivity`（`:8469-8489`）提供。**注意 `updateCatalogActivity` 没有更新 `runningSubagentCount`**——它只更新 `catalogs` 里的 `entry.activity`，而列表行的计数要等下一次 `session.list`。**⇒ 存在一个可见的不一致窗口**：子代理停掉后，列表行的「运行中」计数**不会**随帧立刻减一。判定 **INCONCLUSIVE**（未实跑测该窗口长度；`session.list` 刷新触发点见 `:8448`/`:9074`）。

### 2.5 完成提示（绿点）的渲染路径与 memo —— **PASS（引用稳定性）/ FAIL（行级无 memo）**

**渲染位置更正**：绿点**不在** `dsh-client-ui-sidebar`（该包仅 321 行，是纯外壳），而在 **`dsh-client-ui-workspace`**：`:598-605` 判 `node.completed` → `state:"done"` + `t("status.completed")`。

**引用稳定性三重门闸（PASS，逐字）**：
1. `entryCache` 逐字段比较，`completed` 参与（`dsh-client-runtime/lib/client.js:8572`）：

```js
					if (prev !== void 0 && prev.updatedAt === entry.updatedAt && prev.running === entry.running && … && prev.completed === entry.completed && prev.runningSubagentCount === entry.runningSubagentCount) return prev;
```
2. `itemsCache` 数组身份门闸（`:8582`）：`if (!(items.length === this.itemsCache.length && items.every((e, i) => e === this.itemsCache[i]))) this.itemsCache = items;`
3. 投影级 `byId` 复用 + 键集闸门（`:9338-9345`、`:9357`）。

**但行组件没有 memo（FAIL，逐字）**——`dsh-client-ui-workspace/lib/client.js:693`：

```js
		function SessionNodeItem({ node, currentId, now, onOpen, onRename, onFork, onArchive, drag, flat = false, t }) {
```

全仓 `grep "memo("` 在 `dsh-client-ui-workspace/lib/client.js` **0 命中**（只有 `useMemo`/`useCallback`）。

⇒ **后果链（读码确证，非实测）**：一个会话完成 ⇒ `completed` 由 false→true ⇒ 该行 `entry` 身份变化 ⇒ `stableById` 全量重建 ⇒ 键集门闸失败（`:9345`）⇒ `nextById !== previousProjection.byId` ⇒ `unchangedProjection === false`（`:9357`）⇒ `this.list.set(...)` ⇒ 三个整快照选择器（`dsh-client-ui-workspace/lib/client.js:1201/1471/1589`）全部收到新身份 ⇒ `deriveGroups`/`deriveFlat`/`deriveSearchResults` 各重算 + `indexSubagentDescendants` 各重跑 ⇒ **所有已渲染的 `SessionNodeItem` 全部重渲染**。
⇒ **一个绿点 = 一次全列表派生 + 全行重渲染**，成本随已渲染行数线性增长。修法形状 = `React.memo(SessionNodeItem)`（其 props 已是逐值稳定的 entry 对象 + 稳定回调），**纯局部、零语义风险**。判定 **FAIL**，毫秒量级 **INCONCLUSIVE（未测，不得写成卡顿主张）**。

### 2.6 Toast / Badge 的触发频率与渲染成本 —— **FAIL（Toast 单槽 last-wins）/ PASS（badge）**

**Toast 实现位置（重要）**：`dsh-client-ui-primitives` **不在 197 包目录**，被打包进 `dsh-web-frontend/dist/assets/index-ClqxG24t.js`；该文件导出的 toast 组件逐字为：

```js
function af({text:n,icon:i,anchor:l,onDone:u}){R.useEffect(()=>{const h=setTimeout(u,4e3);return()=>{clearTimeout(h)}},[u]);…An.createPortal(f.jsxs("div",{className:Jl.toast,role:"alert",…}),document.body)}
```

⇒ `role="alert"`、portal 到 `body`、**4 s 自动消失**、带 `resize` 监听做锚定。**成本本身极小**（1 portal + 1 timer + 1 listener），判定 **PASS（成本）**。

**但消费端是单槽 last-wins、无队列、无去重（FAIL）**，逐字（`dsh-client-ui-conversation/lib/client.js:3575-3584`）：

```js
			const [toast, setToast] = (0, react.useState)(null);
			const toastSeq = (0, react.useRef)(0);
			const showToast = (0, react.useCallback)((text) => {
				toastSeq.current += 1;
				setToast({
					seq: toastSeq.current,
					text
				});
			}, []);
```

⇒ 后一条错误**直接覆盖**前一条（`key={seq}` 强制重挂）。同文件 `:3977-3981` 渲染、`dsh-client-ui-model-selection/lib/client.js:296-297` **又独立实现了一遍同样的单槽 toast**（两处重复实现）。
B 档另在 CSS（`index-C6eRlFa6.css`）找到 Toast 容器 `pointer-events:none` ⇒ **「加关闭按钮」在当前 CSS 下结构上不可能**，需连 CSS 一起改。
同类单槽还出现在通知通道：`SessionInputShell.notices` 是 `createSnapshotStore(null)`（`dsh-client-ui-conversation/lib/client.js:961`），注释自陈「Latest surfaced notice (null after clear)」⇒ **同样 last-wins**。判定 **FAIL**。

**Badge**：唯一带计数的 badge 是 cordis 插件面板 `dsh-client-ui-cordis/lib/client.js:1036-1041`（`data-cordis-badge` / `data-cordis-approval-badge`），计数用渲染期 `.length`（零遍历）、`data-active` 只在 `approvals > 0` 时置位、**无动画**。判定 **PASS**。

### 2.7 副产物：`updateCatalogActivity` / `applyCatalogParentExpandable` —— **PASS（存在）/ 成本未测**

逐字（`dsh-client-runtime/lib/client.js:8469-8489`）：每条 `host/session-status` 帧都遍历**全部已加载目录**，`.some` 命中则整目录 `.map` 复制 + `catalogs.set` 新对象。同胞 `applyCatalogParentExpandable`（`:8496-8514`）每条 `session-added` 一次。**毫秒量级完全未测 ⇒ INCONCLUSIVE，不得写成卡顿主张。**

### 2.8 范围 ① 小结

| 子项 | 判定 | 依据 |
|---|---|---|
| `syncCompletedNotifications` 触发频率 = 每事件一次 | **PASS** | `:8251` / `:8089` / `:8094` + 上游 4 类帧 |
| 每次成本是否显著 | **FAIL（假设被证伪）** | 两独立复刻微基准：N=1000 → 0.034–0.037 ms |
| 是否"每次事件都渲染"（React 层是否批处理） | **PASS** | `Notifier` 微任务/帧批处理 `:5662-5674` |
| 绿点引用稳定性 | **PASS** | `:8572` / `:8582` / `:9338-9345` |
| 行组件 memo | **FAIL** | `SessionNodeItem` `:693`，全文件 `memo(` 0 命中 |
| 运行中子代理计数正确性/来源 | **PASS** | 宿主 `index.js:1244-1274` 覆盖 100% 顶层行 |
| 计数随帧即时性 | **INCONCLUSIVE** | `updateCatalogActivity` 不更新该字段；窗口长度未测 |
| Toast/badge 成本与去重 | **FAIL（Toast）/ PASS（badge）** | 单槽 last-wins；`pointer-events:none` |

---

## 3. 范围 ② 错误呈现：宿主 RPC 失败 / 超时如何呈现、是否可恢复、有无重试退避

### 3.1 传输层错误分类 —— **FAIL（全折叠成 `internal`）**

**客户端侧逐字**（`dsh-client-runtime/lib/client.js:344-353`）：

```js
		function transportError(error) {
			return {
				ok: false,
				error: {
					code: "internal",
					message: error instanceof Error ? error.message : String(error),
					details: {}
				}
			};
		}
```

**宿主侧同族折叠**（`dsh-host-apiproxy/lib/types/api/rpc.js:24-29`，A 档逐字确证）。

⇒ **超时（`AbortError`）、HTTP 500、网络中断全部压成同一个 `code:"internal"`**，只把原始异常文本透传。**UI 因此在结构上无法判断"该不该重试"** —— 这是本范围所有下游缺口的根。

**超时常量**（`dsh-host-apiproxy/lib/types/fetch/client.js:79`、`:150-155`）：`DEFAULT_TIMEOUT_MS = 30_000`，`requestSignal = AbortSignal.any([AbortSignal.timeout(this.timeoutMs), signal])`。⇒ 每个 unary RPC 都有 30 s 上限，但**超时后不映射到已有的 `cancelled` 码**，落进 `internal`。

⚠️ **`pickDirectory` 是显式豁免**（`types/fetch/client.js:264-266`，A 档确证）⇒ 用户交互型调用不受 30 s 约束，属**有意设计**，不是缺口。

**反面（PASS）**：业务侧错误码**是具体的、且不折叠成成功**——实跑确证：`POST /usage/nosuch` → HTTP 200 + 信封 `{"ok":false,"error":{"code":"unknown-endpoint",…}}`（A 档 `E-HOST.md` §1.1/§4.4）。**⇒ 折叠只发生在传输层，业务契约是好的。** 判定 **PASS（业务层）/ FAIL（传输层）**。

### 3.2 各失败通道的 UI 呈现 —— **3 条零消费（FAIL）/ 5 条可见（PASS）**

**零消费者（FAIL，逐条逐字确证）**

| # | 通道 | 赋值点 | 进快照 | UI 消费者 | 后果 |
|---|---|---|---|---|---|
| 1 | **`listError`**（`session.list` 失败/超时） | `dsh-client-runtime/lib/client.js:8108-8116` | `:8590` `error: this.listError` | **全仓 0** （`grep listError` 仅 `:7821/8074/8110/8116/8590`，全在 runtime 内；`dsh-client-ui-*` 0 命中） | 侧栏**永久空白/停在 `pending`**，无提示、无按钮 |
| 2 | **`lastAgentError`**（宿主 `host/agent-error`） | `:7557-7560`（注释自称「the only outlet for live failures with no turn position」）；reset `:7198` | `:7726` | **全仓 0**（`grep lastAgentError` 仅 runtime + `.d.ts` + 外壳里的一份 d.ts 文本） | **模型/代理"无轮次位置的失败"完全不可见** |
| 3 | **连接断开/重连** | `dsh-client-connection/lib/client.js:147` `emitState("reconnecting")` | — | **仅 1 处**：`dsh-client-runtime/lib/client.js:10618-10620` 只调 `sessions.handleDisconnected()`，**不产生任何反馈** | 用户看到的是「界面停止更新」；primitives 导出的 `ConnectionBanner`（`function of({reconnecting,label="连接已断开，正在重连…"})`，导出名 `ConnectionBanner:of`，全宽横幅 CSS）**197 包 0 引用 ⇒ 死导出** |

**⚠️ `host/agent-error` 还有第二个更硬的缺陷（本档新增，读码确证）**——逐字（`dsh-client-runtime/lib/client.js:8419-8421`）：

```js
					case "host/agent-error":
						this.sessions.get(frame.sessionId)?.handleAgentError(frame.message);
						return;
```

`this.sessions` 是**原始 Map**（`:7794`），而 SessionManager 的惰性实例化入口是**同名方法** `get(sessionId)`（`:7933-7957`，会 `createSession` 并补播缓冲帧）。
⇒ **对"从未被打开过"的会话（后台跑的子代理正是这一类），`this.sessions.get(...)` 返回 `undefined`，`?.` 静默吞掉 ⇒ 错误当场永久丢失**，连 `lastAgentError` 都不会被赋值。宿主发帧处 `dsh-host-apiproxy/lib/index.js:3742-3748`。且 `handleHostEnvelope` 路径**没有** mux 那样的 `pendingBuffers` 兜底（`:7938-7942` 只对 mux 帧生效）。
⇒ **这是"出口本身是空操作"**：即使把 `lastAgentError` 接到 UI，后台失败仍看不到。

**可见的错误面（PASS，逐字确证；共 8 处，下表列 6 处）**

| # | 面 | `file:line` | 呈现 | 可重试 |
|---|---|---|---|---|
| 1 | 会话打开失败 | `dsh-client-ui-conversation/lib/client.js:5629` 选择器 → `:5835-5839` | 内联红字（`message`+`code`） | ❌ **无按钮**（需重新选中） |
| 2 | 轮次错误 | `dsh-client-ui-conversation/lib/client.js:4254` CSS `_turnErrorRow/_turnErrorTitle`；`:6579` `case "retry"` | 会话流内错误行 | ✅ 有重试行 |
| 3 | 提交失败 | `dsh-client-ui-conversation/lib/client.js:3588-3596` → `:3977-3981` Toast | 4 s toast | 用户重发 |
| 4 | 命令面板 RPC 失败 | `dsh-client-ui-commands/lib/client.js:989-1001` | 内联 + **重试按钮** | ✅ |
| 5 | 模型选择失败 | `dsh-client-ui-model-selection/lib/client.js:515-521` / `:587-593` | 内联 + **重试按钮** | ✅ |
| 6 | 用量卡片 RPC 失败 | `@local/dsh-usage/lib/client.js:1149-1152` | 内联 `数据加载失败：…` + code | ✅ `:1148` 手动刷新 + 60 s 轮询 |

另有：会话搜索失败（`dsh-client-ui-workspace/lib/client.js:1605/1627-1631`，灰字，无显式重试）、子代理记录异常（`dsh-client-ui-subagent/lib/client.js:55-59`/`:227-228`，「会话记录损坏」）。

⇒ **呈现质量的两极分化**：业务 RPC 的错误面**做得相当好**（内联 + 具体 code + 重试按钮），而**基础设施类失败（列表拉取 / 代理错误 / 断线）恰恰是最不可见的三条**。

### 3.3 重试与退避 —— **PASS（连接层齐备且带抖动）/ FAIL（RPC 层无任何退避）**

**连接层（PASS，逐字确证）**——`dsh-client-connection/lib/client.js:9-15`：

```js
		const CONNECTION_DEFAULTS = {
			backoffBaseMs: 500,
			backoffFactor: 2,
			backoffMaxMs: 1e4,
			generationReadyWarnMs: 3e3,
			generationReadyTimeoutMs: 15e3
		};
```

`:107-114`（指数 + **full-jitter 下半区**）：

```js
			backoffCap(attempt) {
				const { backoffBaseMs, backoffFactor, backoffMaxMs } = this.config;
				return Math.min(backoffMaxMs, backoffBaseMs * backoffFactor ** Math.max(0, attempt - 1));
			}
			backoffDelay(attempt) {
				const cap = this.backoffCap(attempt);
				return cap / 2 + Math.random() * (cap / 2);
			}
```

并有**网络感知挂起**（`:96-106` `setNetworkAvailable`）、**手动重连**（`:83-91`）、**换代就绪超时**（`:42-44`）。
⚠️ **但 `attempt` 无上限 ⇒ 无限重试、没有"放弃"终态可展示**（A 档确证）。判定 **PASS（有退避+抖动）/ 缺口（无终态）**。

**模型调用层（PASS）**——`dsh-llm/lib/index.js:356-366`：

```js
const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_INITIAL_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 1e4;
const DEFAULT_JITTER_RATIO = .1;
const DEFAULT_RETRYABLE_CODES = Object.freeze([EMPTY_RESPONSE_CODE, "RATE_LIMIT", "SERVER", "TIMEOUT", "TRANSPORT"]);
```

执行在 `dsh-llm-retry/lib/index.js:44-48`（`localDelay`，含 jitter）与 `:122-155`（每次重试**先持久化再等待**，可取消）。
**且重试链在会话流里可见**——`dsh-client-ui-conversation/lib/client.js:5158-5220`（`message.retry.active/scheduled/started/cancelled` + 倒计时 + `delay/failure` 明细）、`:8655-8692`（`llm/retry` / `llm/retry-started` 建节点）。判定 **PASS（这是全项目做得最好的一条错误/重试通道）**。

**RPC 层（FAIL）**：`refreshList()` 只有 2 个触发点——`:8448`（连接换代 `handleConnected`）与 `:9074`（显式 refresh）。**没有自动重试、没有退避、没有定时重试、没有重试按钮**（`listError` 无消费者，见 §3.2）。判定 **FAIL**。

### 3.4 范围 ② 小结

| 子项 | 判定 |
|---|---|
| 传输错误分类学 | **FAIL**（`internal` 一元化） |
| 超时常量存在 | **PASS**（30 s，`types/fetch/client.js:79`） |
| 超时/HTTP 5xx/网络故障可区分 | **FAIL** |
| handler 崩溃原因是否到达客户端 | **FAIL**（纯文本 500，`types/fetch/handler.js:116`，客户端只看 status 就抛，`types/fetch/client.js:162-163`） |
| 连接层重试+退避+抖动 | **PASS** |
| 连接状态可见 | **FAIL**（`ConnectionBanner` 死导出） |
| 模型调用重试可见 | **PASS** |
| RPC 层退避/重试 | **FAIL** |
| `session.list` 失败可见 | **FAIL**（`listError` 零消费者） |
| 业务错误码具体且不折叠成成功 | **PASS** |

---

## 4. 范围 ③ 不可恢复状态的可观测性

### 4.1 插件加载失败 —— **PASS（可见 + 可重试）**

- **运行期（已挂载后）**：`dsh-client-ui-settings-plugin-inventory/lib/client.js` 有逐插件状态点（CSS `qSYn7G_statusDot[data-phase=active|failed|loading]`）与 `挂载失败` 文案（`:46`/`:236`），并有错误态 + **重试按钮**（逐字 `:100-110`）：

```js
					state.status === "error" ? (0, react_jsx_runtime.jsxs)("div", {
						className: PluginInventorySettingsTab_module_css_default.failure,
						children: [(0, react_jsx_runtime.jsx)("p", { role: "alert", children: t("error") }),
						(0, react_jsx_runtime.jsx)("button", { type: "button", onClick: retry, children: t("retry") })]
					}) : null,
```

  宿主侧数据源 `dsh-host-plugin-inventory/lib/index.js:106-111`（`fiberPhase`）。
- **启动期**：Web 外壳的 boot 页（`dsh-web-frontend/dist/assets/index-ClqxG24t.js`，`Gd` 类 `render()`）逐条列出 `failed` 条目 + `Failed to load plugins`，并在 `assertEntriesActive()` 里区分 `import failed (see console for the import error)` / `pending (waiting for service: …)` / 其他状态。

⚠️ **但宿主侧 `fiberPhase` 只投影 4 个字段，无 `error`/`message`/`stack`**（`dsh-host-plugin-inventory/lib/index.js:106-111`）⇒ **用户看得到"挂载失败"，看不到"为什么失败"**；且 boot 页文案是**英文硬编码**（未走 locale）。
判定 **PASS（可见 + 可重试）/ 缺口（失败原因不可见）**。

### 4.2 模型调用失败 —— **PASS（轮次内）/ FAIL（无轮次位置的失败 100% 丢失）**

- **轮次内**：`agent/error` 事件 + `turn/end.reason` **被持久化**，且有真实订阅者（`dsh-goal-round-driver/lib/index.js:203`，A 档确证）；重试链在会话流可见（§3.3）。判定 **PASS**。
- **无轮次位置**：见 §3.2 第 2 条 —— `host/agent-error` → `handleAgentError` → `lastAgentError` → **UI 零消费**，**且对未实例化会话连赋值都不会发生**（`:8420` 原始 Map 惰性缺失）。判定 **FAIL**。

### 4.3 worker 崩溃（ingest）—— **FAIL（不可见，仅 `log.warn` 且日志无出口）**

deployed worker 路径（`INGEST_VIA_WORKER = true`，`@local/dsh-usage/lib/index.js:46`）**确实有**崩溃/停滞处理，但其结果**只写日志**：

- `ingest-runner.js:148-150` —— `spawned.on("exit", (code) => { … settle(pending, { ok:false, reason:"worker-exit", message: \`worker exited with code ${code}\` }) })`
- `ingest-runner.js:202` —— 停滞看门狗：`log.warn(\`ingest runner: no progress for ${stallMs}ms — terminating the worker (no retry)\`)`
- `ingest-runner.js:248` —— 硬超时：`log.warn(\`ingest runner: hard timeout after ${hardTimeoutMs}ms — terminating the worker (no retry)\`)`
- `index.js:184` / `:188` —— 上层把 `result.ok === false` 折成一行 `log.warn(\`ingest failed (${result.reason}): …\`)` 后 **直接 return，不更新任何状态字段**
- `index.js:310` —— `log.warn(\`db unavailable: … — ingest disabled\`)`
- `index.js:335` —— bootstrap 链尾 `catch` 吞掉一切
- **客户端还把"手动刷新失败"也吞掉了**：`@local/dsh-usage/lib/client.js:996-999` 逐字为

```js
					try {
						await rpc.call(CHANNEL, "refresh", {});
					} catch {
						// refresh endpoint is best-effort; reload regardless
					}
```

⇒ **四层静默**（bootstrap / ingest / DB / 客户端手动刷新）。且 `ingest-runner.js:87`、`:300-312` 的 **7 个计数器 + `workerAlive`**（注释自陈 "for tests/acceptance gates"）**不上任何端点**。
判定 **FAIL**。

### 4.4 日志出口 —— **FAIL（宿主插件日志无任何持久出口）** ← 本条是本范围最硬的结论

⚠️ 声明：宿主 `stdout/stderr` 的去向在本会话**不可判定**——`readlink /proc/301709/fd/1` 返回 EACCES（与 BATCH-PLAN §五.17 记载的"本环境对几乎每个进程 `readlink /proc/<pid>/exe` 都 EACCES"同源）。**故本结论不依赖该 fd**，只建立在三重读码 + 实跑确证上：

1. **代码层：唯一 exporter 是内存环形缓冲，且该 buffer 全树零读取点。** 逐字（`cordis/lib/index.js:583-602`）：

```js
	bufferSize = 1e3;
	buffer = [];
```
```js
		self.exporter({
			colors: 3,
			export: (message) => {
				self.buffer.push(message);
				if (self.buffer.length > self.bufferSize) self.buffer = self.buffer.slice(-self.bufferSize);
			}
		});
```

   本档独立复核：全 197 包 grep `exporter(` / `.buffer` —— **对 logger buffer 只有 `:601` 这一处写入，没有任何读取点**（`dsh-host-apiproxy` 的 `.buffer` 是**帧队列**，与 logger 无关）。**无 console exporter、无 file exporter。**
2. **journald**：`journalctl _PID=301709` 与按 cgroup 两路均 `-- No entries --`（A 档实跑）。
3. **文件**：`~/.dsh` 下无宿主日志（只有 `backups/dsh-restart.log`、`dsh-restart-watch.log`，**mtime 9月21 17:37，属上一次由 restart 脚本拉起的进程，不是当前宿主**）；`/home/CNS2026495165/dsh/logs/` **空目录**（4.0K，0 文件）；全包树无 `.log`。

**进程链实跑（本档）**：

```
 301709   10771 CNS2026+ node /home/CNS2026495165/.npm-global/bin/dsh web
  10771   10761 CNS2026+ /bin/bash
  10761    4139 CNS2026+ /usr/bin/python3 /usr/bin/terminator
```

⇒ **当前宿主从 Terminator 里的 bash 直接启动，其 `log.warn`/`log.error` 只落进终端回滚缓冲，无持久化、无轮转、无 UI 出口。**
⇒ **§4.3 的全部 ingest 失败、§4.1 的插件挂载失败原因、`bootstrap failed` 全部沉没。这是本范围所有其它缺口的"根"：即使你把 UI 接好，宿主侧也没有可读的失败数据源。**

### 4.5 范围 ③ 小结

| 子项 | 判定 |
|---|---|
| 插件加载失败可见 | **PASS** |
| 插件加载失败可重试 | **PASS** |
| 插件加载失败原因可见 | **FAIL**（`fiberPhase` 只 4 字段，无 error/message） |
| 模型失败（轮次内）可见可重试可持久 | **PASS** |
| 模型失败（无轮次位置）可见 | **FAIL**（双缺陷：零消费 + 惰性实例化下直接丢弃） |
| worker 崩溃可见 | **FAIL**（4 层静默 + 计数器不上端点） |
| 宿主日志有持久/可读出口 | **FAIL**（ring buffer 零读取点 + 无 journald/文件） |
| 宿主有失败记录/计数器 | **FAIL**（A 档 §1.7） |

---

## 5. 范围 ④ 性能诊断入口

### 5.1 现状：**无任何"健康/诊断"面板 —— FAIL**

`grep -rn "diagnos|health|doctor"` 在 197 包的 `client.js` 中命中 7 个包，**无一**是健康/诊断面板：`dsh-client-ui-subagent/lib/client.js:55-59` 只是单条子代理记录损坏原因（`会话记录损坏` / `版本不受支持` / `暂不可用`），其余是名称巧合。**无诊断导出入口**（无"下载诊断包"、无"复制诊断信息"），关键诊断只到 `console`（逐字确证）：

| `file:line` | 逐字 |
|---|---|
| `dsh-client-connection/lib/client.js:158` | `console.warn(\`[connection] connection lost, retry #${String(attempt)}\`)` |
| `dsh-client-connection/lib/client.js:256` | `console.error("[web-runtime] connection sink threw:", error)` |
| `dsh-client-connection/lib/client.js:265` | `console.warn(\`[connection] generation is still not ready after ${…}ms\`)` |
| `dsh-client-connection/lib/client.js:269` | `console.warn(\`[connection] ${error.message}; cancelling generation\`)` |
| `dsh-client-ui-renderer/lib/client.js:525` | （B 档定位）渲染器错误 |

⇒ **一条连接丢失 + 一次换代超时 = 3 条只在 DevTools 可见的 warn**，用户在 GUI 上零信息。判定 **FAIL**。

### 5.2 已有的可查询诊断面（正面清单）—— 部分 **PASS**

| 面 | 位置 | 内容 | 判定 |
|---|---|---|---|
| **`/usage/status`** | `@local/dsh-usage/lib/rpc.js:203-204` → `index.js:223-245` | `dbPath` / `dbSource` / `lastIngest` / `eventsDsh` / `eventsCc` / `scannedDsh` / `scannedCc` / `failedDsh` / `failedCc` | **PASS（可查）/ FAIL（见 §5.3）** |
| 用量卡片 `statusLine` | `@local/dsh-usage/lib/client.js:1093-1094`、`:1189` | 逐字 `"上次 ingest：" + (status.lastIngest ? fmtDate(status.lastIngest) : "—") + " · 来源事件：dsh " + … + " / cc " + …` | **PASS（有展示）/ FAIL（无陈旧语义）** |
| 插件清单 `pluginInventory.list` | `dsh-host-plugin-inventory/lib/index.js:106-111` | 逐插件 `entryId`/`moduleName`/`config`/`fiberPhase` | **PASS** |
| UI 内用量卡 | 注册于 `settings.plugin.item`（`@local/dsh-usage/lib/client.js:1232`） | 7 张图 + hero + sessions | **PASS** |
| 宿主日志 | — | **无出口**（§4.4） | **FAIL** |
| `/health` / `/doctor` 单一入口 | — | **不存在** | **FAIL** |

实跑确证（本档，只读）：

```
POST /usage/status → 200 in 0.29–0.48 s
{"ok":true,"value":{"dbPath":"/home/CNS2026495165/.dsh/storages/usage/usage.db","dbSource":"home-storages",
 "lastIngest":1790045703018,"eventsDsh":109424,"eventsCc":22700,
 "scannedDsh":165,"scannedCc":0,"failedDsh":0,"failedCc":0}}
```

### 5.3 **`/usage/status` 在数据停更 3 h 43 min 时仍报 `ok:true` —— FAIL（且是本范围最可复现的一条）**

| 项 | 值 |
|---|---|
| `lastIngest` | `1790045703018` = **2026-09-22 10:55:03** |
| 宿主启动 | `ps -o lstart` → **2026-09-22 10:54:59**（即 `lastIngest` = 启动后 4 s 的**首次扫描**，`let lastIngest = null` 为纯内存量，`index.js:135`，不持久化） |
| 探测时刻 | 本档 14:38:45 / 14:40:05；A 档 14:36:21 ⇒ Δ = **13,278–13,402 s ≈ 3 h 41–43 min** |
| 差分结论 | **跨 80 s（> 45 s 周期）`lastIngest` 逐字节不变，且 `ok:true`、无 error 字段** |
| `statusProvider` 字段集 | 逐字（`index.js:236-245`）**只有 9 个字段，无 `stale` / `lastError` / `timerEnabled` / `workerAlive` 任一告警位** |
| 客户端展示 | `statusLine`（`client.js:1093-1094`）只把 `lastIngest` 格式化成日期字符串，**无颜色、无阈值、无警告**；`failedDsh`/`failedCc` **根本没被渲染** |

⚠️ **归因更正（关键）**：该陈旧**不是缺陷，而是刻意的**——`@local/dsh-usage/lib/index.js:67` `const INGEST_TIMER_ENABLED = false;`（`:49-67` 的注释自陈 "U-IG2: is the 45s periodic ingest timer installed?"，默认 OFF），与 BATCH-PLAN §三bis.3 的**铁律**一致（"U-IG1 未通过 G1 前不得启用 U-IG2；落地时用常量开关先关着"）。
⇒ **真正的缺陷是"不可观测"，不是"不新鲜"**：一个**按设计关闭**的周期任务，在 `status`、在用量卡片、在任何 UI 上**都没有任何一处说"周期摄入已关闭 / 数据已陈旧"**。用户看到的是 3 h 43 min 前的数字，而系统说 `ok:true`。判定 **FAIL（可观测性）**。
🚩 连带：**BATCH-PLAN 闸门 G1 至今未被回答**（timer 路径未经运行验证，改该常量需冷面重启）——这属 U-IG1/U-IG2 范围，本线只负责记录"它没有被回答"，**不宣称 timer 已修好**。

### 5.4 轮询频率与渲染成本（诊断面的副作用）—— **PASS（已做门控）/ 缺口**

逐字（`@local/dsh-usage/lib/client.js:976-992`）：

```js
			react.useEffect(() => {
				if (refreshSec <= 0) return;
				// 2026-09-20 (audit §5 B2): the card is a settings-page section —
				// while it is scrolled out of view (or the tab is in the
				// background) it must not poll at all: every cycle costs the host
				// ~0.3-0.5s of blocked event loop. Only the timer is gated; the
				// initial load and the manual refresh stay unconditional.
				if (!pollVisible || (typeof document !== "undefined" && document.hidden)) return;
```

⇒ **已有可见性门控**（`pollVisible` 已接线，`:784`），默认 60 s（`:773`），且注释自陈每轮宿主成本 0.3–0.5 s 阻塞 ⇒ **这个门控是有价值的前置修复**，判定 **PASS**。
**缺口**：`pollVisible` **没有 UI 开关**（只能靠滚出视口/切后台）；`:986` 的 interval **只调 `loadAll()`**、**不调 `loadStatus()`** ⇒ `statusLine`（"上次 ingest"）在轮询下**永远不刷新**（只在 effect `:971-975` 挂载时取一次）——**与 §5.3 的陈旧告警缺失叠加**。

### 5.5 范围 ④ 小结

| 子项 | 判定 |
|---|---|
| 存在健康/诊断面板 | **FAIL** |
| 存在可导出诊断信息 | **FAIL** |
| 存在单一 `/health` 或 `/doctor` 入口 | **FAIL** |
| 存在可查询 status 面（`/usage/status`） | **PASS** |
| status 能表达"陈旧/已停用/上次失败" | **FAIL** |
| 用量卡展示 freshness | **PASS（有）/ FAIL（无语义）** |
| 宿主日志可读 | **FAIL**（§4.4） |
| 轮询有可见性门控 | **PASS** |
| 轮询覆盖 status（长轮询下 statusLine 是否刷新） | **FAIL** |

---

## 6. 范围 ⑤ 前 5 项改进（含验收标准）

> 验收通则（用户指定）：**错误必可见、可重试、不阻塞主线程**。每条都给出可判定的验收断言；**性能类一律以比值/为零判据**，不用跨窗绝对数（BATCH-PLAN §四）。
> 排序原则：**先补"数据源"（I-1），再补"最贵的静默"（I-2/I-3），最后才是体验与结构整洁（I-4/I-5）。** I-1 是其它的前提——UI 接好了但宿主无日志出口，等于没有数据源。

### I-1（最高优先）宿主插件日志落地为可读出口，并把失败计数器接进 `status`

- **症状**：`log.warn('bootstrap failed: …')` / ingest 失败 / worker 崩溃 / DB 不可用**全部沉没**（§4.3、§4.4）。
- **当前行为**：`cordis/lib/index.js:583-602` 唯一 exporter = 1000 条内存环形缓冲，**零读取点**；`@local/dsh-usage/lib/index.js:184/188/310/335` 只 `log.warn`；`ingest-runner.js:87,300-312` 的 7 个计数器 + `workerAlive` 不上端点。
- **修复形状**：① 给 cordis logger 挂一个 **file exporter**（`~/.dsh/logs/<date>.log`，按大小轮转），或让 `dsh web` 默认把 stdout/stderr 重定向到 `~/.dsh/backups/dsh-web.log`（与既有 `dsh-restart.log` 同族，**零新概念**）；② 把 `ingest-runner` 的 7 计数器 + `workerAlive` + `lastError` 并入 `statusProvider` 返回值。
- **验收标准**
  - **A1**：重启后 `~/.dsh/logs/` 下存在当日日志文件且包含启动行（"重启后仍在"）；`journalctl _PID=<新宿主>` 或该文件**至少一处**能检索到 `bootstrap failed` / `ingest failed` 字样。
  - **A2**：注入一次 ingest 失败（如临时把 `dbPath` 指向不可写路径）⇒ 日志文件中出现**带 `reason` 的**整行，且 `/usage/status` 返回体出现新增的 `lastError` 字段（**非空**）。
  - **A3**：正常路径回归：`failedDsh === 0 && failedCc === 0` 且 `workerAlive === true` 时 `lastError === null`（**阈值两侧都要断言**，不能只测失败侧）。
  - **A4（不阻塞主线程）**：file exporter 的写入不得同步阻塞——用 `perf_hooks.monitorEventLoopDelay` 测一次批量日志写入，**最大事件循环延迟 < 100 ms**；⚠️ 必须避开 BATCH-PLAN §五.8 的 `reset()` 陷阱（`enable → settle → block`，**不得在阻塞前 `reset()`**）。

### I-2 让三条零消费者的失败通道可见（`listError` / `lastAgentError` / 连接状态）

- **症状**：会话列表拉取失败、宿主 `host/agent-error`、断线重连**在 UI 上完全不可见**（§3.2）。
- **当前行为**：`listError`（`runtime:8108-8116` → 快照 `:8590`）**0 消费者**；`lastAgentError`（`:7557-7560` → `:7726`）**0 消费者**；`ConnectionBanner` **死导出**（外壳 `index-ClqxG24t.js` 中 `function of({reconnecting,…})`，197 包 0 引用）。
- **修复形状**：① 侧栏头部消费 `listError`/`listState === "error"` → 内联错误条 + **重试按钮**（调既有 `refreshList()`，触发点 `:9074` 已存在）；② 会话头消费 `lastAgentError` → 与既有 `openError`（`dsh-client-ui-conversation:5835-5839`）**同款内联红字**（**这是零新设计**，照抄现成面即可）；③ 在 layout 挂载 `ConnectionBanner({reconnecting})` 并接 `onStateChange`（`runtime:10618-10620` 已有接线点）。
- **验收标准**
  - **A1（错误必可见）**：注入 `session.list` 失败（如临时让宿主 handler 抛错）⇒ 侧栏出现可见错误条且含 `error.code`；注入 `agent/error` ⇒ 对应会话头出现可见错误行；断开宿主（SIGSTOP 宿主 **≤ 5 s 后 SIGCONT**，只读约束下由持有独占锁的线执行）⇒ 出现"正在重连"横幅。三项各需 **1 张截图/1 条 DOM 断言**。
  - **A2（可重试）**：恢复后端后点重试按钮 ⇒ **无需刷新页面**即恢复（`listState` 回到 `idle`、侧栏行数恢复）。断言"点一次后 30 s 内自愈"**不算通过**——必须是**用户可触发**的那一次。
  - **A3（不阻塞主线程）**：三条通道各自注入时，页内 wall-clock rAF 间隔 **p99 ≤ 33 ms**；且必须自带**页内 `setTimeout` 阳性对照**（BATCH-PLAN §五.19：注入阻塞 ⇒ 通道确能报出）+ `none` 阴性对照。
  - **A4（无回归）**：正常路径下三条 UI 面**均不渲染**（`listError === null && lastAgentError === null && !reconnecting` ⇒ 三个组件 `return null`）——断言"没有错误时不出现空条"。

### I-3 修 `host/agent-error` 的惰性实例化丢弃（这是 I-2 的前置，否则 I-2 只修好一半）

- **症状**：`dsh-client-runtime/lib/client.js:8419-8421` 用**原始 Map** `this.sessions.get(...)`，对未实例化会话 `?.` 静默吞掉 ⇒ **后台子代理的失败连 `lastAgentError` 都不会被赋值**（§3.2）。
- **当前行为**：惰性入口是**同名方法** `get()`（`:7933-7957`，会 `createSession` + 补播缓冲），但帧路径没走它；`pendingBuffers` 兜底只对 mux 帧生效（`:7938-7942`）。
- **修复形状（二选一，见 §8 边界）**：(a) 帧路径改用 `this.get(frame.sessionId)`（**代价**：为一个错误帧**实例化**一个可能永远不会被打开的会话，与"resident instance"策略相冲突）；(b) **推荐**：在 `SessionManager` 上加一个 manager 级 `agentErrors: Map<sessionId, string>`，帧到达时**无条件**记录，`Session` 实例化时（`createSession`，`:7958-7974`）注入并清空——**与 `pendingInteractions`（`:7803`）完全同构，是既有先例**。
- **验收标准**
  - **A1**：构造反事实 —— 若子代理会话**从未被选中**，其 `agent/error` 仍须在列表行/会话头上可见（或至少在 `get()` 后被正确补播）。**"只测当前已打开的会话"不算通过**（这正是缺陷所在）。
  - **A2（订单式）**：`get(sessionId)` 返回后 `lastAgentError` 非 null 且等于帧内 message；再调一次 `prompt()` ⇒ 清空（`promptError`/`lastAgentError` 的既有 reset 语义 `:7198` 不变）。
  - **A3（不阻塞主线程）**：帧路径新增 Map 写入为 **O(1)**，不引入遍历；一次 200 帧突发的同步耗时增幅 **< 1 ms**（用复刻微基准证明，见 §2.2 的既有方法）。
  - **A4**：不改变"会话实例数"行为（方案 b 下 `sessions.size` 在错误帧到达后**不变**）——防方案 a 的副作用。

### I-4 `status` 增加陈旧/停用告警，并把 `failedDsh`/`failedCc` 渲染出来

- **症状**：`/usage/status` 在数据停更 3 h 43 min 时报 `ok:true`；`failedDsh`/`failedCc` 从未被渲染；轮询不刷新 status（§5.3、§5.4）。
- **当前行为**：`statusProvider` 9 字段无告警位（`index.js:236-245`）；`statusLine` 只用 `lastIngest`（`client.js:1093-1094`）；`:986` interval 只调 `loadAll()`。
- **修复形状**：① `statusProvider` 增加 `timerEnabled`（直接返回 `INGEST_TIMER_ENABLED`）与 `staleSeconds`（`(Date.now()-lastIngest)/1000`，`lastIngest === null` 时 null）；② 客户端 `statusLine` 在 `staleSeconds > 2×周期`（或 `timerEnabled === false`）时**换色 + 追加"周期摄入已停用/数据陈旧"**，并渲染 `failedDsh`/`failedCc`（非 0 时标红）；③ interval 里补一次 `loadStatus()`。
- **验收标准**
  - **A1（阈值两侧）**：`lastIngest = now - 30 s` ⇒ **不出**告警；`now - 600 s` ⇒ **出**告警；`INGEST_TIMER_ENABLED === false` ⇒ **恒出**"已停用"文案。三条都要断言（**只测触发侧不算通过**）。
  - **A2（失败可见）**：`failedDsh > 0` ⇒ 卡片上出现非零失败计数且带 error 语义色；`=== 0` ⇒ 不出现。
  - **A3（不阻塞主线程）**：`staleSeconds` 计算为 O(1)，禁止在 `statusProvider` 里新增任何 SQL 聚合（现有 SQL 已 `try/catch`，`index.js:226-232`）。
  - **A4（无回归）**：`timerEnabled === true` 且数据新鲜时，卡片文案与改动前**逐字一致**。

### I-5 传输错误分类学 + Toast 队列（体验与可恢复性的公共底座）

- **症状**：所有传输异常折叠成 `code:"internal"`（`:344-353`），UI 无法判可重试性；Toast 单槽 last-wins、`pointer-events:none`、无队列（§2.6、§3.1）。
- **当前行为**：`transportError` 只保留 `message`；`AbortSignal.timeout(30_000)` 的超时也走同一折叠；toast 消费端 `dsh-client-ui-conversation/lib/client.js:3575-3584` 单槽覆盖。
- **修复形状**：① `transportError` 增补 `code` 映射：`AbortError`（超时）→ 既有 `cancelled` 或新增 `timeout`、HTTP 5xx → `unavailable`、`TypeError`（网络）→ `transport`——**不得新造成功路径**，只做分类；② Toast 容器改为可挂起的队列（最多 N 条，去掉 `pointer-events:none` 或对"关闭按钮"单独开 `pointer-events:auto`）。
- **验收标准**
  - **A1（可判定）**：三个反事实各断言一次 —— 模拟 30 s 超时 ⇒ `code === "timeout"`（非 `internal`）；模拟 HTTP 500 ⇒ `code === "unavailable"`；模拟断网 ⇒ `code === "transport"`。**全部不等于 `internal` 才算通过。**
  - **A2（不破坏业务契约）**：业务错误码（如 `unknown-endpoint`）**逐字不变**——回归断言"业务层 `code` 集合与改动前逐项一致"。
  - **A3（Toast 不丢错误）**：同一微任务内连续 `showToast` 3 条 ⇒ 3 条**都**可见（或明确排队且可逐条关闭），**不得只留最后一条**。
  - **A4（不阻塞主线程）**：错误分类为 O(1) 字符串映射；3 条 toast 同帧挂载时页内 wall-clock rAF p99 ≤ 33 ms。
  - **A5（可热载性）**：⚠️ 因 `dsh-client-ui-primitives` **不在 197 包目录**（打包进 Web 外壳），Toast 改动**必须走 Web 产物重建**——验收里必须包含"重建后 served rev 与磁盘 sha1-12 一致"（BATCH-PLAN §四 热面通则），**不得**承诺"刷新即生效"。

---

## 7. 与既有结论的关系（不冲突声明）

- 本线**不推翻** incident2 任何结论。以下引用而非重测：宿主 `session.list`/`subagent.list` 全量重扫（`dsh-host-apiproxy/lib/index.js:2239` 注释自陈"实测 session.list 单次 0.3–2.5 s"）、「插件」栏 9 路 `/usage/*`（本线在 `@local/dsh-usage/lib/client.js:909-965` 逐数复现 = 7+1+1 = 9，与 D1 吻合）、设置面板无 keep-alive（`dsh-client-ui-settings-general/lib/client.js:164` `renderSlot("settings.section", …, { only: active })` 独立复现）、遮罩 `backdrop-filter`（D6，本线不涉及）。
- 本线的两条更正（§0.3）与 incident2 的 D4（"点击设置本身廉价"）方向一致：本线**没有**发现任何"打开设置卡顿"的新反馈面成因。
- ⚠️ **`session.list` >30 s 挂死不得作为性能结论引用**（见 §8.2）。

---

## 8. 诚实清单：不成立的假设与未确证项

### 8.1 本线**证伪或降级**的假设

| 假设 | 裁决 |
|---|---|
| `syncCompletedNotifications` 是卡顿立柱 | **证伪**。两个独立复刻微基准：N=1000 → 0.034–0.037 ms/次；占单核 1% 需 ~270 帧/s。**结构问题仍成立**（`republish` 期未合并），但**不得**当性能主张。 |
| 「`ingest` 45 s timer 未触发是被吞掉的缺陷」 | **降级为"按设计关闭 + 不可观测"**。`INGEST_TIMER_ENABLED = false`（`index.js:67`）与 BATCH-PLAN §三bis.3 铁律一致 ⇒ 陈旧是有意的；缺陷在**没有任何一处告诉你它被关掉了**。 |
| 「DSH 调用 NVML 且故障无降级」 | **证伪**。全 197 包 + `bin/dsh` grep `NVML`/`nvidia` = **0 命中**（唯一匹配是 base64 假阳性）⇒ **DSH 不调用 NVML，无降级/观测义务**；不要把 incident2 的 `nvidia-smi` 失败写成 DSH 缺口。 |
| 「宿主 RPC 会把失败折叠成成功」 | **证伪**。传输异常一律进 `ok:false`；业务错误码具体（实跑 `/usage/nosuch` → `unknown-endpoint`，HTTP 200 + 信封）⇒ **折叠只发生在传输层**。 |

### 8.2 未确证 / 边界（不得当结论引用）

1. 🔴 **`session.list` >30 s 挂死 —— INCONCLUSIVE（本档与 A 档各自独立遇到，均明确定性失败）**。
   本档实测时序（**逐条如实记录，含失败与未执行项**）：
   - 批 ①（`-m 20`）：`POST /api/sessions.list` → **404** `not found`（方法名错，非路由失败；正确名为单数 `session.list`）；`POST /api/subagent.list` → **200** `bad-request: invalid payload`（0.13 s，证明 `/api` 通道健康）；`POST /api/agentPreset.list` → **200 ok，1,199 字节，2.688 s**。
   - 批 ②（`-m 30`）：`POST /api/session.list` ×2 → **两次均 `http_code=000`、30.0 s 无任何响应**（该批因累计 60 s 触发工具超时被 SIGTERM，后续 `agentPreset.list` **未执行**）。
   - 事后健康复核（14:38 之后）：`GET /` **200 / 0.39 s**、`POST /usage/status` **200 / 0.29 s** ⇒ **宿主未被我破坏**；`ps` 显示宿主 **STAT=Rl+、CPU 46.7%**。
   - A 档独立遇到两次（>15 s / >30 s），`/api/skill.list` ~0.1 s。
   **但**：同期宿主 CPU 46.7%、loadavg 7.47（他线在跑），**无法区分"另有慢路径" / "高负载放大" / "我的并发自干扰"** ⇒ **不得作为性能结论引用**，建议由持有独占锁、机器安静的线做专项复测。
   ⇒ 本档因此**未取得** `session.list` 的实际行数 N，改用文件系统上界：**当前 workspace 400 个会话目录、全库 1209**（`find ~/.dsh/sessions -mindepth 2 -maxdepth 2 -type d | wc -l`）。§2.2 的量级裁决在 N∈[400,1209] 全域成立。
   ⇒ 附带**正面证据**（对本审计的主题有直接价值）：一次**未回答**的 RPC 在客户端只会变成 `code:"internal"` + `AbortError` 文本，落进 `listError`，而 `listError` **零消费者** ⇒ **"请求根本没回来"与"请求回来了但业务失败"在 UI 上同样不可见**——这正是 §3.1/§3.2 的实机印证。
2. **宿主 stdout/stderr 去向**：`readlink /proc/301709/fd/1` = **EACCES**（与 BATCH-PLAN §五.17 全环境同源）⇒ INCONCLUSIVE。§4.4 的结论**不依赖**该项。
3. **`INGEST_TIMER_ENABLED = true` 路径未经运行验证**：`ctx.inject(["timer"], cb)` 是否真能装上 timer，需冷面重启才能验（越权）⇒ **不可当作"timer 已修好"**；BATCH-PLAN 闸门 **G1 仍未被回答**。
4. **渲染侧毫秒量级全部未测**：G6（一个绿点引发全列表重渲染）、`updateCatalogActivity`、`indexSubagentDescendants` 只有读码链，**无实测**。本档无锁、未启浏览器 ⇒ 一律 INCONCLUSIVE。
5. **`ConnectionBanner` 是否被 Web 外壳自身挂载**：未在运行态确认。压缩产物内部调用点无法按名字检索（minifier 重命名）⇒ 严格措辞只能是「**无任何插件包引用**」。需浏览器看 `_banner_ugy7y_1` 是否出现在 DOM。
6. **`runningSubagentCount` 的即时性窗口长度未测**：`updateCatalogActivity`（`:8469-8489`）不更新该字段 ⇒ 子代理停掉后列表行计数不会随帧立刻减一；窗口长度取决于下一次 `session.list` 触发（`:8448`/`:9074`）。判定 INCONCLUSIVE。
7. **7 个 `/usage/{summary,timeseries,heatmap,byModel,byProject,byDay,sessions}` 数据端点未探测**：按 BATCH-PLAN §三bis.4，本沙箱无法创建 SQLite 临时文件 ⇒ 本机探测必得**假失败**，故主动不测（标 INCONCLUSIVE 而非 FAIL）。
8. **宿主 `fiberPhase` 之外是否还有未检视路径注册 console exporter**：已在 197 包全树 grep `exporter(`，仅命中 cordis 自身（`dsh-web-frontend/dist` 另有一份**前端** logger，属客户端不影响宿主结论）。低风险但非穷尽证明。
9. **`promptError` → toast 的 effect 是否会被 `t`/`imageLimits` 身份变化重复触发**（同一条错误弹两次）：B 档判 INCONCLUSIVE（`imageLimits` 走 projection face 缓存、身份通常稳定，未实跑）。
10. **`/tmp/dsh-subprocess-301709-*.log` 是假阳性**：A 档一度疑为宿主日志，已逐字证伪（内容是建模工具 stdout，PID 是 bash 工具子进程的父 PID）——**在此记录以防后续线误用**。
11. **未测事件循环延迟**（刻意）：BATCH-PLAN §五.8 的 `monitorEventLoopDelay` `reset()` 陷阱 + 同机他线已占满 CPU ⇒ 本线**不产出阻塞类直接证据**，只引用 incident2 D3 的既有测量。

---

## 9. 证据文件索引（全部在 `.workspace/lag-fix/program/w13-feedback/`）

| 路径 | 内容 | 载体 |
|---|---|---|
| `audit.md` | 本文件（协调者档：裁决 + 范围 ① 核心 + ③/④ 交叉验证 + ⑤ 前 5 项改进） | 本档 |
| `evidence/E-HOST.md` | 宿主/传输/可观测层专项（777 行；9 条 Gap List；PASS 6 / FAIL 7 / INCONCLUSIVE 3） | 二级子代理 A |
| `evidence/raw/E-HOST-raw.md` | A 档原始小样本 | 二级子代理 A |
| `evidence/E-UI.md` | 客户端反馈面专项（876 行；9 条 Gap List；PASS 8 / FAIL 8 / INCONCLUSIVE 6） | 二级子代理 B |
| `evidence/raw/microbench-notifications.mjs` + `.out.txt` | `syncCompletedNotifications`/`applyMutation`/`buildListSnapshot` 三段**逐字复刻**微基准（N=1/100/1000/5000） | 二级子代理 B |
| `evidence/raw/microbench-notifications-m.mjs` + `.out.txt` | 固定 N=1000 的 M-重放扫描（证明 `:8089` 的 M 倍放大） | 二级子代理 B |
| `evidence/raw/bench-notify-path.mjs` + `bench-notify-path.txt` | 本档**独立**复刻微基准（含 `updateCatalogActivity`/`flattenLineage`/`indexSubagentDescendants` + 突发放大） | 本档 |
| `evidence/raw/usage-status-diff.sh` + `usage-status-diff.txt` | `/usage/status` 只读差分探针（跨 80 s > 45 s 周期，`lastIngest` 逐字节相同） | 本档 |

**复现命令**（全部只读，可重放）：

```bash
# 微基准（离线，无副作用）
node .workspace/lag-fix/program/w13-feedback/evidence/raw/bench-notify-path.mjs
# /usage/status 差分（只读；handler 仅返回 statusProvider()）
bash .workspace/lag-fix/program/w13-feedback/evidence/raw/usage-status-diff.sh
# 陈旧性单次采样
curl -s -X POST http://127.0.0.1:3080/usage/status -H 'content-type: application/json' \
  -d '{"type":"client-request","rpcId":"p1","method":"status","payload":{}}'
# 宿主日志出口三重确证（只读）
journalctl _PID=301709 --no-pager | tail
ls -la ~/.dsh/logs ~/.dsh/backups/*.log /home/CNS2026495165/dsh/logs/
```
