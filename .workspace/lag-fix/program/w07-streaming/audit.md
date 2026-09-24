# w07-streaming 审计：流式（SSE/WS）在**长回复**下的真实成本

- 日期：2026-09-22 · 线：`program/w07-streaming` · 授权写入面：本目录（只读审计，未改任何产品文件）
- 宿主：`PID 301709`（`node …/bin/dsh web`），GUI `http://127.0.0.1:3080`，**未重启、未 pkill、未改产品文件**
- 交付：本文件 + `raw/` 原始 JSON + `tools/` 全部探针（可重跑）
- 上游必读：`exec-audit/BATCH-PLAN.md` §五、`incident2/VERDICT.md`、`research-v2/MEASUREMENT-STATUS.md`

## 0. 口径与证据分级（先声明，后结论）

| 等级 | 含义 | 本报告中的用法 |
|---|---|---|
| **A 精确事实** | 计数/字节/比例，不依赖机器负载 | WS 帧率、键直方图、键/帧对应关系、代码路径（file:line） |
| **B 同窗比值** | 同一进程/同一语料内两件事之比；负载约掉 | `zod÷JSON.parse`、`commits÷projection帧`、`chunk÷原语`、未 idle 占比 |
| **C 跨窗外推** | 由 B 的比值 × A 的速率得出 | **仅作方向与量级，标注"外推"** |
| **D 不可用** | 绝对 ms / ms/s / fps 基线 | 本机全程不独占（见下），一律 **INCONCLUSIVE** |

**本报告的性能结论只用比值 / 为零 / 占比 + 同窗对照**（BATCH-PLAN §五；`MEASUREMENT-STATUS.md:9-10`）。

**独占性自证（诚实声明）**：本轮我发起的浏览器窗口**不独占，且两次都被第三方终止**——
`tools/stream-cost.mjs` 在开窗前按 cmdline 口径普查（含 `--remote-debugging-pipe` 且不含 `--type=`，排除自身）：

| 窗 | 开窗普查（外来浏览器主进程） | 结局 | 残留可用数据 |
|---|---|---|---|
| `s1`（14:45:58 取锁 → 15:00 由我 KILL） | **12** | 浏览器被第三方终止；`page.evaluate` 挂死（加固前） | 无（连部分 JSON 都未落盘） |
| `s2`（14:56–14:58） | **13** | 同上：`cdpSession.send: Target page, context or browser has been closed` + `page.evaluate: Target page…closed` | 仅 readiness 快照（探针已加固，部分 JSON 落盘 `raw/stream-cost-s2.json`） |

⇒ 我**没有**拿到"流式窗口内的客户端 commit/纤维数"直接测量值；该格判 **INCONCLUSIVE（环境限制）**，不以外推冒充测量。
历史独占批（`cpuX` 7/7 门禁通过）的**同窗占比**可用，已单独标注来源与时间。
**⚠️ 该环境事实对其他线同样有效**：在本机当前状态下，任何**以浏览器为器械**的测量都会在窗口中途被第三方 `pkill` 型清理打断——
这与 `MEASUREMENT-STATUS.md §2` 记录的"一条线用 `pkill -f playwright_chromiumdev_profile` 误杀兄弟线浏览器"同型。
本线**两次**复现，建议协调者把"窗口中途浏览器存活"纳入窗口有效性判据（现状门禁只在**开窗前/收窗后**采样，中途死亡不可见）。

---

## 1. 结论摘要（每条给判据与等级）

| # | 命题 | 判据 | 判定 |
|---|---|---|---|
| **C1** | **"事件率越高越卡"** 在流式场景同样不成立；客户端 React commit **不由** `session/event` 驱动 | 13/13 窗 `corr(commits, projection)=0.9995`，`corr(commits, session/event)=0.3759`；W2 事件 8 804 却只有 929 commit，W1 事件 1 845 有 1 238 commit（**反相关**） | **PASS（已确证）** |
| **C2** | **不存在"逐 token 触发整树重渲染"**：`assistant/chunk` 走 rAF 合并 | `ui-conversation:7821-7826` + `runtime:7670-7673`（`markFrameDirty`）；实测 5 074 chunk → **11.7 flush/s**，合并倍数 **8.54×**（另一会话 9.18×） | **PASS（已确证）** |
| **C3** | **但 `session/projection` 帧是"每帧一次提交"的未合并路径**，且每次提交重渲染**近整树** | `runtime:8302-8305` 用 `markDirty()`（microtask，**逐 WS 消息一次**）；`runtime:5823-5827 →7980-7986 →7844-7845` 全表重建；13 窗 `commits÷projection = 1.157–1.250`（均值 **1.190**）；`wholePw÷commits = 231–304`（树总量 278–341） | **PASS（已确证，同窗比值）** |
| **C4** | **单帧解码+zod 校验成本可忽略** | 真实语料 158.6 帧/s ⇒ JSON.parse+zod 合计 **0.219 ms/s**（隔离测量：envelope zod 0.06 µs、muxFrame zod 0.27 µs、JSON.parse 1.05 µs/帧，zod÷JSON.parse=0.314） | **PASS（已确证，比值为零类）** |
| **C5** | **整个"流式→渲染"链在主线程 CPU 中占比极小** | 独占批 `cpuX` 7 窗同窗占比：`ui-conversation+trajectory+renderer+sidebar ≤0.52%`、`client-runtime ≤1.16%`（最活跃场景 `long-active`）；同窗第一非 idle 是 `ThemePresenter.apply` **15.06%** | **PASS（占比；绝对值 INCONCLUSIVE）** |
| **C6** | **批处理现状**：`session/event` 有 rAF 合并（有效），`session/projection` 只有 microtask 合并（跨消息**无效**） | 见 §2.3；实测每事件循环轮次只投递 **1 条**消息（p50=1，多消息轮次占比 **5.9%**，max 31）⇒ microtask 合并**几乎不产生跨消息合并** | **PASS（已确证）** |
| **C7** | 传输层 `inbox.shift()`（O(n)）**在生产中不构成二次方积压** | 每轮次 1 条消息 ⇒ 队列长度恒 ~1；`readWebSocket` 消费者同步处理（`connection/client.js:10275-10331`） | **PASS**（结构性结论；`shift` 微基准见 §5） |
| **C8** | 499 KB `session.list` 的客户端同步成本 = **1.93 ms**（`runtime:8077-8112`）；**zod 不是成本** | 505 088 B / 299 行：`JSON.parse` 0.867 ms、信封 zod **B÷A = 1.00**、真两个 parse **D÷A = 0.66**、`G_whole_refresh` **1.930 ms（G÷A = 2.23）**；整调用 `sessions.list()` C÷A = 5.79，但其中 `Response.json()` 自身 = 1.95× 且 1/3 是 harness | **PASS（同窗比值）；"是否影响可感卡顿" INCONCLUSIVE** |
| **C8b** | **`E_reordered` 不是伪影，是真实 O(n²) 路径** | `mergeOrderedBaseline` 非快路径 `merged.findIndex`（`runtime:5580-5587`）：**502–975×** 于活跃路径；**重连不触发** | **PASS（比值）；绝对 ms 不可引用** |
| **C11** | **每次重连都重新索取整份 505 KB，无 memo / 无 debounce** | `runtime:8447-8448 handleConnected() { this.refreshList();`；single-flight（`runtime:8071`）只合并并发、不缓存结果 | **PASS** |
| **C9** | **"流式渲染节流"作为修复候选：方向正确但收益量级有限** | 由 C3×C4×C5：流式链占总主线程 ≤1.7%，而 projection 帧率已≈帧率（64/s vs 60/s）⇒ 纯 rAF 化收益 **≤1.07×**；真正杠杆是 **按"表是否真的用该键"过滤**（84.7% 的 projection 帧没有表层读者） | **PASS（裁决）；收益须用预注册阈值验收** |
| **C10** | 断线/重连正确性 | 见 §5（委托档）；seq 单调 + `subscribed.lastSeq` truncate + gap repair | **见 §5** |

---

## 2. ① 流式（WS）在长回复下的真实成本

### 2.1 传输与解码路径（逐行确证）

客户端**只有一个** WS 读循环，两个 downlink 各一个 socket：

| 事实 | file:line | 引用 |
|---|---|---|
| 浏览器 WS 读循环 | `dsh-client-connection/lib/client.js:10275` | `async *readWebSocket(path, signal, frameSchema, onOpen) {` |
| 逐帧**全量**解码 + 两级 zod | `:10294-10295` | `full = serverRequestSchema.parse(JSON.parse(event.data));` / `frame = frameSchema.parse(full.payload);` |
| 逐帧 tap | `:10300` | `this.onEnvelope(full);` |
| 入队 | `:10306` 前 | `enqueue({ kind: "frame", envelope: { rpcId: full.rpcId, payload: frame } });` |
| 唤醒消费者（microtask 续体） | `:10283` | `wake?.();` |
| 排空循环 | `:10323` | `const item = inbox.shift();` |
| 宿主侧发帧（每帧一次 `send`，串行 promise 链） | `dsh-client-connection/lib/index.js:353-372` | `const delivery = (downlinkWrites.get(socket) ?? Promise.resolve()).then(...)` |

`muxFrameSchema` 是 `discriminatedUnion("type", …)`，`session/event` 分支复用 `sessionEventSchema`（严格信封 + `data: z.unknown()` 直通，`dsh-host-apiproxy/lib/types/api/sessions.schema.js:21-29`）。

### 2.2 派发链：**每块（per chunk）**与**每帧（per frame）**要分开

```
WS message (1 task)
 └─ handleMessage  : JSON.parse + serverRequestSchema + muxFrameSchema   ← 每块同步，未合并
 └─ enqueue → wake() → for-await 续体（microtask）
     └─ SessionManager.handleMuxEnvelope  (runtime:8294)
         ├─ session/event  → session.handleMuxEnvelope (runtime:7461)
         │     └─ acceptLiveEvent (runtime:7649) → appendLive (runtime:7631)
         │         └─ conversation.append(input)   ← 每块同步（assembler 折叠）
         │         └─ scheduleConversation (runtime:7670) ← 只在这里合并
         ├─ session/projection → runtime:8302-8305
         │     ├─ projectionStore(...).apply(...)  → changed(key)  (runtime:5823)
         │     │      ├─ 5825 每键 notifier.markDirty()   （按需/窄面）
         │     │      └─ 5826 anyNotifier.markDirty()     （**无条件、粗粒度**）
         │     └─ 8304 this.notifier.markDirty()          ← microtask
         └─ (未实例化 session 的帧 → 丢弃/pendingBuffer，runtime:8340-8352)
```

- **每块同步成本** = JSON.parse + 2×zod + assembler 折叠。**已测**：合计 **0.219 ms/s**（§2.4），可忽略。
- **每帧（动画帧）成本** = `Notifier.flush()` → `conversation.flush()` + `buildSnapshot()` → React commit。**这才是成本所在。**

### 2.3 批处理 / 节流现状（**这是本项的核心**）

`Notifier`（`runtime:5655-5714`）有**两条**入口，语义不对称：

```js
markDirty() {                       // runtime:5662
  this.dirty = true; this.notifyPending = true;
  if (this.scheduled === "microtask") return;
  this.schedule("microtask");       // → queueMicrotask(publish)   runtime:5703
}
markFrameDirty() {                  // runtime:5669
  this.dirty = true; this.notifyPending = true;
  if (this.scheduled !== "none") return;                 // 已有排程则不叠加
  this.schedule(rAF ? "frame" : "microtask");            // → requestAnimationFrame
}
schedule(kind) { const generation = ++this.scheduleGeneration; ... }   // runtime:5694-5704
flush() { if (!this.notifyPending) return; if (this.listeners.size === 0) return; ... }  // runtime:5709-5717
```

**三处必须一起读的语义事实**：

1. **`session/event`（含 chunk）走 rAF**：`appendLive` 返回 `publication`，由定义对象声明；
   `dsh-client-ui-conversation/lib/client.js:7821-7826` 与 `dsh-client-ui-trajectory/lib/client.js:348-353` 完全一致：
   ```js
   publication: (match) => {
     if (match.event.type === "step/start") return "none";
     if (match.event.type !== "assistant/chunk") return "immediate";
     const type = match.event.data.chunk.type;
     return type === "usage" || type === "finish" ? "none" : "animation-frame";
   }
   ```
   ⇒ **纯文本/推理/tool-arg 增量 = 每帧最多一次 flush**（`markFrameDirty`）。
2. **`session/projection` 走 microtask**：`runtime:8304` 用 `markDirty()`（**不是** `markFrameDirty`），
   而 microtask 的作用域是**当前 task**；WS 消息**每条约占一个 task**（§2.5 实测），
   ⇒ microtask 合并**几乎不产生跨消息合并**，即 **1 projection 帧 ≈ 1 次 flush ≈ 1 次 React commit**。
3. **"immediate" 会取消已排的 rAF 批次**：`markDirty()` 在 `scheduled === "frame"` 时
   `if (this.scheduled === "microtask") return;` 为假 ⇒ 调 `schedule("microtask")` ⇒ `scheduleGeneration++`
   ⇒ 已挂起的 rAF `publish` **因 generation 不匹配被丢弃**（`runtime:5698-5701`）。
   ⇒ 任何 `immediate` 事件（非 chunk 的 `session/event`、queue、approval 等）都会**提前切断**正在累积的 rAF 批次。
   **实测该风险在长回复中很小**：见 §2.5（流式会话 5 074 chunk / 仅 68 非 chunk 帧）。

### 2.4 实测（A 级）：真实长回复窗口的帧结构

**被动观察**：`ws://127.0.0.1:3080/api/events.mux`，Node 直连（**不开浏览器、不持锁、零干扰**）。
原始：`raw/mux-live-90s.json`、`raw/mux-live-120s.json`；分析：`raw/burst-90s.json`、`raw/stream-session-90s.json`。
方法：`tools/mux-observe.mjs`（逐帧记录 `payload.type` + 内层事件类型 + 内层 chunk 类型 + 到达时刻 + 原文）。

**90 s 窗（14 614 帧 / 10.88 MB）：**

| 量 | 值 |
|---|---|
| 总帧率 | **162.6 /s**（10.88 MB ⇒ 121 KB/s） |
| `session/projection` | **5 736**（63.7/s，均 316 B） |
| `session/event` | **8 803**（97.8/s，均 1 019 B） |
| 其中 `assistant/chunk` | **6 823**（75.8/s）= reasoning-delta 3 759 + text-delta 2 092 + tool-call-delta 972 |
| 活跃帧桶内帧率 | **656.8 /s**（另一窗 653.5/s，**2/2 一致**） |
| 每 16.7 ms 桶 | 全帧 p50 **9** / p99 39；chunk p50 **3**；projection p50 1 |

**单个"长回复"会话（`session-d565c2bf`，最强样本）：**

| 量 | 值 |
|---|---|
| chunk 帧 | **5 074**（占该会话帧 **98.68%**） |
| 非 chunk 帧（整个长回复期间） | **68**（其中 44 条本身是 projection） |
| chunk 速率 | **99.9 /s**（另一会话 230.3/s） |
| 相邻 chunk 间隔 | p50 **1 ms**、p90 4 ms、p99 96 ms |
| **每个占用的动画帧桶内 chunk 数** | p50 **8**、mean 8.56、max 20 |
| **rAF 合并后 flush 率** | **11.7 /s** |
| **若不合并（microtask/消息）** | 99.9 /s |
| **合并收益** | **8.54×**（另一会话 **9.18×**） |

⇒ **"长回复"的真实形态是：一个会话连续吐出 5 074 个 chunk 事件，期间只有 68 个其它帧。**
⇒ **rAF 合并已经存在且有效（8.5–9.2×，2/2 会话）**；"逐 token 触发整树重渲染"**被证伪**（C2）。

**解码成本（B 级，隔离测量）**：方法 `tools/parse-cost.mjs` / `tools/parse-cost2.mjs`，
语料 = 上述 14 277 帧真实原文，schema = 部署同源的 `dsh-host-apiproxy/lib/types/api/events.schema.js`（zod 4.6.2）。

| 阶段 | 均值/帧 | 比值 |
|---|---|---|
| `JSON.parse(raw)` | 1.05 µs | 1.000 |
| envelope zod（预解析后） | 0.06 µs | 0.057 |
| `muxFrameSchema` zod（预解析后） | 0.27 µs | 0.257 |
| **zod 合计** | 0.33 µs | **0.314** |
| **整帧处理（parse+zod）** | — | **0.219 ms/s** @158.6 帧/s |

⇒ **C4 PASS**：zod 只占解码的 ~31%，整条解码链占主线程 **0.02%**。另一档独立复算得 `fullHandler÷jsonParse = 1.39`、`zod_total÷fullHandler = 0.538`、`0.272 ms/s`（`raw/w07s-ws-frame-cost.json`）——**比值同向一致**。

### 2.5 提交驱动因子（B 级，**13 窗同窗比值**，本报告最强证据）

数据源：`research-v2/react-commit/raw/measure-{locked,main,smoke}.json`（2026-09-21，三批），
每窗**同一窗口内**同时记录：React commit 数、`payload.type` 帧数、整树渲染 fiber 数。脚本见 §8。

| 批次窗 | commits | `session/projection` | `session/event` | **commits÷proj** | wholeFiber÷commit | 树总量 |
|---|---|---|---|---|---|---|
| locked L1 | 616 | 519 | 5 333 | **1.187** | 295 | 341 |
| locked L2 | 658 | 544 | 3 552 | **1.210** | 262 | 309 |
| locked L3 | 330 | 271 | 3 827 | **1.218** | 231 | 278 |
| main W1 | 1 238 | 1 061 | 1 845 | **1.167** | 304 | 341 |
| main W2 | 929 | 787 | 8 804 | **1.180** | 268 | 309 |
| main W3 | 923 | 764 | 8 256 | **1.208** | 235 | 278 |
| main W4 | 732 | 612 | 6 303 | **1.196** | 302 | 341 |
| main W5 | 943 | 815 | 852 | **1.157** | 269 | 309 |
| main W8 | 425 | 340 | 11 488 | **1.250** | 267 | 309 |
| smoke W1/W3/W6 | 172/164/87 | 146/140/75 | 52/239/25 | 1.178/1.171/1.160 | (器械受限) | — |
| **汇总** | **n=13** | | | **min 1.157 / max 1.250 / mean 1.190** | **231–304 / 278–341** | |

- **`corr(commits, projection) = 0.9995`**；**`corr(commits, session/event) = 0.3759`**。
- **反相关反例**：W2（8 804 事件）→ 929 commit；W1（1 845 事件）→ **1 238** commit。事件多 **4.8×**，提交反而**少 25%**。
- **每次提交重渲染 231–304 / 278–341 个组件 fiber ⇒ 近整树**（无 memo 边界起作用）。

⇒ **C1 PASS / C3 PASS**：客户端 commit 由 **`session/projection` 帧**以 **≈1.19:1** 驱动，
与 `session/event`（含 chunk）**无关**；而每次提交几乎重渲染整棵树。

**为什么是 1:1**：`runtime:8302-8305` 的 projection 分支是**未合并的 microtask**，
且 `ProjectionValueStore.changed()`（`runtime:5823-5827`）**无条件**置脏 `anyNotifier`，
其唯一读者（`runtime:7984-7986`）再次 `this.notifier.markDirty()`；再加上 `:8304` 的直呼，
最终 `Notifier.flush()` → `runtime:7844-7845 this.listSnapshotCache = this.buildListSnapshot();`。
`buildListSnapshot()`（`runtime:8553`）**无键过滤**：对全部 summaries 做 `.map()`（299 行）、
`flattenLineage`（`runtime:5603`，2 × Map + DFS）、`entryCache` 14 字段比较、
`Object.fromEntries(catalogs)`；`runtime:8570-8572` 的 `prev.projectionValues === entry.projectionValues`
因 `changed()` 已清 `valuesCache`（`runtime:5824`）而**必失配** ⇒ `items` 新数组 ⇒ `projectList` → `list.set`（`runtime:9375`）⇒ React 提交。
**投影键的完整读者清单、84.7% 帧无表层读者、重复派发 8 条路径** → 见 `raw/subscribers.md`（§1–§4、§6）。

### 2.6 归因份额（B 级，**独占批** `cpuX`，7/7 门禁通过）

来源：`research-v2/cpu-profile/raw/profile-cpuX-*.json`（每窗同窗内部 `selfTop` 占比，分母 = 采样主线程时间）。

| 场景 | `(idle)` | `ThemePresenter.apply` | `ui-conversation+trajectory+renderer+sidebar` | `client-runtime`（含 `projectList`/`buildListSnapshot`） | `(program)` |
|---|---|---|---|---|---|
| home-idle | 97.3% | 1.09% | 0.09% | 0.21% | 0.45% |
| **long-active** | 76.8% | **15.06%** | **0.52%** | **1.16%** | 3.20% |
| long-idle | 94.3% | 3.47% | 0.05% | 0.14% | 1.30% |
| settings-dwell | 82.3% | 12.44% | 0.13% | 0.73% | 2.16% |
| settings-open | 81.2% | 11.77% | 0.48% | 0.90% | 3.23% |

⇒ **C5 PASS**：整条"流式→渲染"链在**最活跃**场景只占主线程 **≤1.7%**；
同窗第一位是 `ThemePresenter.apply`（8.5–15%），与 `incident2/VERDICT.md`/`MEASUREMENT-STATUS.md §3.-1` 一致。

> **必须同读的边界**：`cpuX` 的产物**不含 `payload.type` 计数**（键只有 `meta/scenario/intervalUs/msPerSample/sampleCount/nodeCount/selfTop/bundles`），
> 因此**无法确认该批窗口是否含 chunk 流**——上表只能读作"**该场景下**整条会话链的占比"；流式重载窗口的同类占比**未直接测量**（§0 括号中的原因）。

### 2.7 ① 的裁决

1. **每块对客户端提交的影响 ≈ 0**（0.219 ms/s；zod 只占 31%）。
2. **不存在逐 token 整树重渲染**：chunk 走 rAF，合并 8.5–9.2×（实测 2/2 会话）。
3. **批处理现状 = 一半有效**：`session/event`→rAF（有效）；`session/projection`→microtask（**跨消息无效**，≈1.19 commit/帧，且每次近整树）。
4. **流式的真实成本 = projection 帧率 × 近整树提交**，而 projection 帧率由**全部会话（含 34 个 subagent 会话）的 agent 活动**驱动：
   本机实测 63.7/s（对照：§2.5 历史 13 窗的 4.5–17.7/s；差异来自并发会话数，不是"流式与否"）。
5. **但该成本在总主线程中占比 ≤1.7%**（独占批同窗占比）⇒ 它是**可省的浪费**，不是**可感卡顿的主因**。

---

## 3. ② `session/projection` 与 `session/event` 的下游订阅者清单

**完整清单（含 file:line、每键读者、粗/窄粒度、重复派发、可合并边）→ `raw/subscribers.md`（536 行）+ `raw/subscribers.json`（16 节）。**
以下是必须进入本审计的结论：

| 事实 | 证据 |
|---|---|
| **投影键无运行时注册表**：`faceOf(key)` 是**未校验字符串**；宿主侧 `SessionProjectionMap` 只在 `.d.ts` 里声明合并、**运行时擦除** | `subscribers.md §2.3`；`dsh-session-projection/lib/types/index.d.ts:37-74` |
| **没有 `advance` 谓词**：单元表面恰为 `key/stateSchema/init/apply/wire/stateVersion`；唯一闸门是引用闸门 `!Object.is(next, cell.state)` | `dsh-session-projection/lib/index.js:294`；同 §2.1 |
| **宿主发射是单一键无关通道** | `dsh-host-apiproxy/lib/index.js:1849-1855`（`sessionProjections.onChanged → broadcast`，**无 `subscribed` 守卫**，对照 `session/event` 的 `:3660`） |
| **实测键直方图（5 736 帧 / 90 s）** | `subagentTiming` 1 919、`sessionStats` 1 823、`contextPressure` 830、`contextBreakdown` 825、`tokenUsage` 300、`sessionListMetadata` 22、`title` 10、`todos` 4、`permissions` 3；`imageLimits/subagent/goal/plan` **0** |
| **每键读者路径** | `subagentTiming` → 仅 `ui-subagent:90` 的表快照（**粗**）；`contextPressure`/`contextBreakdown` → 仅 `ui-conversation:3099/3100`（**窄**）；`sessionListMetadata` → 客户端**零读者**（真读者在宿主 `apiproxy:1294/1336`）；`title` → `runtime:8556` 合法粗读 |
| **84.7% 的 projection 帧没有表层读者**，却每次都跑完整表重建 | `subscribers.md §3(b)`；299 行 × 63.7 帧/s ⇒ **≈19 000 行访问/s**、**≈64 次 `list.set`/s** |
| **重复派发 8 条**（D1–D8），无一造成双重建；其中 **D1** 同一 manager notifier 被 `5826→7985` 与 `8304` 各置脏一次（靠 `markDirty` 幂等免费）；**D4** 跨层重复：`usage` chunk 对会话无影响（publication `"none"`）却发 2 条 projection ⇒ 2 次全表重建；**D8** 37 个 store 共享一个 manager notifier | `subscribers.md §6` |
| **可合并边 9 条**，最高价值 M1（只把**表层真的读**的键路由到 manager notifier）/ M2（`subagentTiming` 每事件扇出）/ M3（一次 `assistant/message` 的 5 帧合并） | `subscribers.md §7` |
| **`assistant/chunk` 不是 surface event**（`dsh-session:219-222`） ⇒ 除 `subagentTiming` 外**没有键在文本/推理/工具参数 chunk 上变化** | `subscribers.md §2.4` |

⇒ **② 判定 PASS（清单已建立，逐键逐消费者带 file:line）**；未决项 8 条见 `subscribers.md §8`（全部标注理由）。

---

## 4. ③ 大响应（499 KB `session.list`）的客户端解析与构造成本

**样本**：`raw/session-list-499k.json` = **505 088 B**、**299 行**（97 顶层 + 202 subagent）、**298 行带 projections**、**3 858 个键条目 / 13 个不同键**。
**方法**：`tools/bench-bigresponse.mjs`（60 reps，真实部署 bundle 的 schema）；原始 `raw/w07s-bigresponse-bench.json`。

> ⚠️ **本节已按委托档重写（2026-09-22 15:1x）**：初稿把 5.02 ms 误读成"整响应 zod"，**该归因是错的**。
> 委托档用 **Node 加载部署 bundle 还原出的真 schema**（`tools/load-connection-bundle.mjs`；bundle 是零外部 `require` 的
> `window.__ModuleLoader__.load()`，故可捕获 factory 拿到真 `serverResponseSchema` / `UNARY_VALUE_SCHEMAS["session.list"]`）
> 重测，把每一级分开。下表是**修正后**的口径（p50，比值可用；绝对 ms 仅示意）：

| 阶段 | 是什么 | p50 | 比值 |
|---|---|---|---|
| A | `JSON.parse(text)`（505 088 B） | 0.867 ms | 1.000 |
| B | `JSON.parse` + `serverResponseSchema.parse` | 0.867 ms | **B÷A = 1.00（信封 zod 免费**，value 槽是 `unknown()`） |
| D | `callUnary` 真正做的两个 parse | 0.573 ms | **D÷A = 0.66** |
| E | `mergeOrderedBaseline` **活跃路径**（`runtime:5567`） | 0.059 ms | E÷A = 0.068 |
| E_reordered | 同一函数**非快路径**（顺序不共享键位 ⇒ 触发 `findIndex` 分支） | 24.9–57.6 ms | **E_reordered÷E = 502–975×** |
| F_1 / F_100 / F_1000 | 1 / 100 / 1000 × `applyMutation`（`runtime:8598`） | 0.017 / 0.541 / 5.386 ms | F_1000÷F_100 ≈ 10 |
| **G_whole_refresh** | **parse + projections store 应用 + baseline 合并，作为一个同步块**（`runtime:8077-8112`） | **1.930 ms** | **G÷A = 2.23** |
| C | 真 `WebApiClient.sessions.list({})`（stub transport 回放捕获字节） | **5.020 ms** | **C÷A = 5.79**；**C_HARNESS÷C = 0.34**（1/3 是 harness 自身） |
| C_JSON_ONLY | `new Response(bytes).json()`，**完全不做 schema parse** | 1.687 ms | **C_JSON_ONLY÷A = 1.95** |

**G 内部的份额**（p50，彼此嵌套故有重叠）：`JSON.parse` **44.9%**、两个 zod parse **29.7%**、`mergeOrderedBaseline` **3.1%**。

**语义副作用**：`schemaSemantics.rowDroppedUnknownKeys = ["runningSubagentCount"]`；`projectionsValuesIsNewObject = true`、`nestedValueIdentityPreserved = true`。

**判决（修正后）**：
- **PASS（比值）**：单次 499 KB 的**客户端同步成本 = G ≈ 1.93 ms**（`runtime:8077-8112`）；整条 `sessions.list()` 调用 **C÷A = 5.79**，
  其中 `Response.json()` 自身就占 **1.95×**、harness 占 1/3 ⇒ **C 不能当客户端成本用**。
- **🔴 修正初稿的相反结论**：**本 payload 上 zod 不是成本**（B÷A = 1.00、D÷A = 0.66；
  行 schema 浅（`connection:5385-5394`）、`projections.values` 是 `record(string(), unknown())`（`connection:5497`）
  ⇒ 3 858 个投影值**按引用通过**，只分配 299 个行对象 + 298 个浅记录 + 1 个数组）。
  ⇒ §1 的 **C8 行与"zod 值得优化的面是大响应"的推论作废**：代价约 = 1 份对象构造 + 1 份 wire 解码 + 0.3 份 schema 校验。
  这与 §2.4 的逐帧隔离测量（envelope÷json = 0.057、mux÷json = 0.257）**同向**，两处一致。
- **⚠️ E_reordered 不是伪影，是真实 O(n²) 路径**：`mergeOrderedBaseline` 非快路径内层 `merged.findIndex(...)`（`runtime:5580-5587`）
  ⇒ **502–975×**。绝对 ms 跨两次运行差 ~2×，**绝对不可引用、比值才是发现**。**重连时不触发**（`refreshList` 传入上一份列表，循环成为 no-op）⇒ 属潜在风险。
- **重复触发是真实的**：`runtime:8447-8448 handleConnected() { this.refreshList();` ⇒ **每次重连都重新索取整份 505 KB**；
  另有 `runtime:8157/8170/8202`（create/fork/mutation 响应）与 **`runtime:8297`（每个 `user/message` 帧）**；
  `runtime:8071` 有 single-flight，但**无 memo、无 debounce**。
  按本线实测帧率折算：`user/message` 仅 53 帧/90 s ⇒ 该路径 ~0.01 ms/s，**可忽略**。
- **INCONCLUSIVE**：该成本是否落在**用户可感**交互上 —— 宿主侧 p50 **250.5 ms** / p95 400.1（`MEASUREMENT-STATUS.md §6` M7，n=12，12/12 >100 ms）
  说明宿主端已是数百毫秒量级，客户端 **1.93 ms** 不可能成为可感停顿主因；**但客户端这一层仍无独占窗测量**。

---

## 5. ④ 断线 / 重连 / 积压

| 项 | 结论 | 证据 |
|---|---|---|
| **积压是否可能** | **结构性不可能形成长队列**：实测每事件循环轮次投递 **1 条**（p50=1、p90=1、p99=3、max 31；多消息轮次仅 **5.9%**），轮内跨度 p50 **0.0098 ms** | `raw/w07s-delivery-bursts.json`（20 s / 822 msg / 713 轮） |
| `inbox.shift()` O(n) 的二次方风险 | **当前不触发**（队列恒 ~1），但**一旦积压就是超二次方**：`shift÷cursor` @1e3 = **3.15×**、@1e4 = 3.55×、**@1e5 = 1288×**；log-log 斜率 `shift` 1e4→1e5 = **3.98**（`cursor` = 1.42）；`shift` 占"部署同款逐项流水线"的比例 @1e3 = **0.951**、@1e4 = **149.3**（>1 ⇒ 单项即超预算） | `raw/_shift-stdout.txt`、`tools/bench-shiftbacklog.mjs` |
| **积压的量级上界（本线推算）** | 队列长度 ≈ 主线程阻塞时长 × 到达帧率；实测峰值到达 **655 帧/s** ⇒ **要堆到 1e4 帧需要约 15 s 的同步阻塞**。本机已观测到的最长宿主阻塞是 ingest 的单次 **2.68 s / 36.1 s**（BATCH-PLAN §三bis.3）⇒ 若两者叠加，队列 ~1.8e3 帧，`shift` 占比仍是**可忽略**；**1e4 级需要 15 s 级阻塞，本机未观测到** | 组合 §2.4 帧率 + `exec-audit/BATCH-PLAN.md:61` |
| 消费者是否同步 | `readWebSocket` 的 `for await` 在每次 `enqueue` 后于 **microtask** 续体处理，处理期间不 `await` 网络 ⇒ 处理速率 ≫ 到达速率（占空比 **0.272 ms/s**，`w07s-ws-frame-cost.json`） | `:10275-10331` |
| 断线/重连状态机、seq 守卫、`subscribed.lastSeq` truncate、gap repair、`liveBuffer` | **见委托档**（`raw/bigresponse-reconnect.md`；若缺，原始依据为 `raw/w07s-*.json`），本表只列已核实的传输层事实 | 同左 |
| 宿主侧发帧背压 | 每 socket 一条串行 promise 链（`downlinkWrites`）⇒ 帧不会交错；天然限速，也意味着**慢客户端会把队列堆在宿主** | `dsh-client-connection/lib/index.js:341-372` |

> **未由本线测量**：重连风暴的帧数与重建量、reconnect 期间是否丢/重/乱序 —— 委托档给出静态与 Node 侧结论；
> 活体（浏览器内存内）判据按 BATCH-PLAN 的做法标 **INCONCLUSIVE**。

---

## 6. ⑤ 前三优化候选（含最小实现 / 收益 / 风险 / 验收 / 回滚 / 热冷面）

> **预注册阈值**（先立后测，禁止事后挑窗）：
> ① `commits ÷ (session/projection 帧)` 由 **1.19** 降到 **≤0.30**；② `commits ÷ (chunk 帧)` **不上升**（≤现状 ×1.05）；
> ③ `list.set` 次数/s **降 ≥70%**；④ 整树 `wholeFiber÷commit` **不上升**；⑤ `client-runtime` 同窗占比**不上升**；
> ⑥ 哨兵：`rafP50` 保持 16.7 ms 档、`session.list` 200 且顶层行齐全、`/usage` 9 路仍出数。

### 候选 1（**首选**）：`session/projection` 驱动的列表重建按"键是否真被表层消费"过滤 + rAF 合并
- **文件/锚点（全部已核实）**：
  - `dsh-client-runtime/lib/client.js:8302-8305`（projection 分支：`markDirty()` → 改 `markFrameDirty()`）
  - `dsh-client-runtime/lib/client.js:5823-5827`（`changed(key)`：`anyNotifier.markDirty()` 无条件 → 受"键可达性"闸门约束）
  - `dsh-client-runtime/lib/client.js:7980-7988`（`projectionStore()` 的 `subscribeAny` 回调）
  - 可达性判据来自 `runtime:8556`（表层只读 `title`）+ `runtime:8557`（把**全部** `values()` 塞进 `projectionValues`）
- **最小实现（两步，可分别开关，独立标记 `/* w07-throttle v1 */`）**：
  1. **rAF 化**：把 `:8304` 与 `:7986` 的 `markDirty()` 换成 `markFrameDirty()`。
     语义安全性：projection 是**幂等快照**（`apply` 有 `seq <= row.seq` 闸门，`runtime:5777`），延迟到本帧末**不丢状态**；
     代价 = 标题等列表可见字段最多晚 **1 帧（16.7 ms）**。
  2. **键闸门**：`buildListSnapshot` 的 `projectionValues` 注入改为**只注入表层真的会读的键集合**
     （现状：`ui-subagent:90` 读 `subagentTiming`、`ui-subagent:269` 读 `tokenUsage`、`runtime:8556` 读 `title`；
     `contextPressure`/`contextBreakdown`/`sessionStats`/`sessionListMetadata` 无表层读者）。
     保守起点 = **只对"无任何表层读者"的键不触发 `list.set`**（不是不建快照），使 `projectionValues` 保持引用稳定。
- **收益**：命中 §3 的 **84.7%** 帧（`contextPressure` 830 + `contextBreakdown` 825 + `sessionStats` 1823 + `sessionListMetadata` 22 = 3 500/5 736）。
  **同窗预期**：`commits÷projection` 1.19 → **≈0.18**（仅剩有表层读者的 15.3%）；`list.set`/s 降 ~85%。
  纯 rAF 化的额外收益受限于 projection 帧率已≈帧率（64/s vs 60/s）⇒ **≤1.07×**，**单独不足以达标**，必须与键闸门同批。
- **风险**：① 某插件通过 `values()` 读一个我们判为"无表层读者"的键 ⇒ 需要把闸门做成**显式白名单常量**而不是自动推导；
  ② 闸门若误伤 `subagentTiming` ⇒ 子代理耗时行不刷新（**必须在验收里显式检查该行**）；
  ③ `markFrameDirty` 在已有 microtask 排程时会被跳过（`runtime:5669` 早退）⇒ 与 `markDirty` 混用时**不会更差**，但也不会更优。
- **回滚**：两处各一行 + 一个常量 → `git`/pre-image 单文件回滚；独立标记便于定点撤销。**热面（刷新即生效）**。
- **验收**：`raw/` 侧新探针（复用 `tools/stream-cost.mjs`）在同一 60 s 窗内同时记录 `commits`、`payload.type` 帧数、`list.set` 次数；
  判据 = 上述预注册阈值 ①②③⑤ + 哨兵⑥；**必须同窗对照（before/after 各 ≥2 窗，保留全部 invalid 窗）**。
  ⚠️ **前置条件（本线实测的阻塞点）**：本机当前状态下浏览器会在窗口中途被第三方终止（§0），
  验收必须**先建立"窗口中途浏览器存活"证据**（例如窗口内每分钟一次 `page.evaluate` 心跳 + 浏览器 pid 存在性），否则 before/after 都可能落到空窗上。

### 候选 2：合并"一次 `assistant/message` 的 5 条 projection"（宿主侧）
- **锚点**：`dsh-client-connection/lib/client.js:7787-7865`（`projectionFramesOf`：一条 `assistant/message` 产出 5 条帧）
  + 宿主通用发射器 `dsh-host-apiproxy/lib/index.js:1849-1855`。
- **最小实现**：`projectionFramesOf` 返回的帧数组在**同一 `seq`** 时合并为**一条多键帧**（或宿主侧按 microtask 聚合），
  由客户端 `runtime:8302` 一次性 `apply` 多键后**只置脏一次**。
- **收益**：`assistant/message` 每步 5 帧 → 1 帧；实测 300 条 `assistant/message` ⇒ **少 1 200 帧 / 90 s**；
  结合候选 1 后进一步压低峰值帧率。
- **风险**：**协议改动 = 冷面**（宿主 + 客户端同步升），且需兼容旧客户端 ⇒ 必须走版本兼容分支；
  收益（少 1 200/14 614 = **8.2%** 帧）**低于候选 1**，且风险面更大 ⇒ **本轮不建议先做**。
- **回滚/生效**：冷面（重启）；回滚 = 还原宿主与客户端两份文件。

### 候选 3：`session/event` 的 rAF 批次被 `immediate` 提前切断的加固（低风险收尾项）
- **锚点**：`dsh-client-runtime/lib/client.js:5662-5668`（`markDirty` 取消 frame 批次）+ `:7670-7673`。
- **最小实现**：`markDirty()` 遇到 `scheduled === "frame"` 时**不再降级**（保留 rAF 排程，仅置 `dirty`），
  除非调用方显式要求同步（`notifyNow()` 已有，`runtime:5679`）。
- **收益**：**实测在长回复中很小**（流式会话 5 074 chunk / 68 非 chunk ⇒ 只有 ~1.3% 的批次可能被切断）；
  **同窗零类收益无法用本机数据证明** ⇒ 仅作**加固**，不作为收益候选。
- **风险**：把"必须同 tick 生效"的路径（受控输入）延后 1 帧 → 光标跳动风险（`notifyNow` 的注释 `runtime:5676-5678` 正是为此存在）⇒ **若做，必须让所有受控输入路径显式走 `notifyNow()`**。
- **回滚**：单函数回滚。**热面**。

### 加固项（不进前三，但一处一行的低风险改动）
- **H1 `inbox.shift()` → 索引游标**（`dsh-client-connection/lib/client.js:10323`）：
  现状队列长度恒 ~1，**当前零收益**；但一旦出现 15 s 级同步阻塞，`shift` 的 log-log 斜率是 **3.98**（@1e5 比游标慢 **1288×**）。
  改法 = `let head = 0; … const item = inbox[head++];`，并用 `if (head > 1024) { inbox.splice(0, head); head = 0; }` 回收。
  **热面、可单行回滚、零语义变化**。**收益 = 尾部风险消除，不是可测加速。**
- **H2 窗口有效性判据补"中途存活"**：本轮两次浏览器在窗口中途被第三方终止（§0），而现行门禁只在**开窗前/收窗后**采样。
  建议所有浏览器类探针加**窗口内每分钟心跳**（`page.evaluate` + 浏览器 pid 存在性），否则空窗会被当成"干净窗"。

### 明确**不做**（并给理由）
- **不做** `cssText` 合并 / `ThemePresenter` 语义调整（本轮范围外，且 §2.6 显示它是第一位成本项，属另一批）。
- **不做**传输层批量投递（`inbox` 合批）：实测 **94.1% 的轮次本来就只有 1 条消息** ⇒ 收益上限 ~5.9%。
- **不做**投影窄面（per-key face）合并：会给计量器加一帧延迟（`subscribers.md §7 M4`）。

---

## 7. 逐条 PASS / FAIL / INCONCLUSIVE

| 项 | 判定 | 依据 |
|---|---|---|
| ①-A 每块/每帧解码成本 | **PASS** | 0.219 ms/s；zod÷JSON.parse = 0.314（§2.4） |
| ①-B 是否存在逐 token 整树重渲染 | **FAIL（命题被证伪）** | chunk→rAF；5 074 chunk → 11.7 flush/s，**8.54×**（§2.4）；`corr(commits, session/event)=0.376`（§2.5） |
| ①-C 批处理/节流现状（rAF / microtask 合并） | **PASS** | `session/event`=rAF 有效；`session/projection`=microtask ≈ 1 消息 1 commit（§2.3、§2.5） |
| ①-D 流式在总主线程中的占比 | **PASS（占比）** | 独占批同窗占比 ≤1.7%（§2.6）；**绝对值 INCONCLUSIVE** |
| ①-E 流式窗口内的客户端 commit/纤维实测 | **INCONCLUSIVE** | 环境限制：两次开窗普查外来浏览器 **12 / 13** 个；`s1`/`s2` 浏览器**均在窗口中途被第三方终止**（§0） |
| ② 订阅者清单（谁消费/可合并/重复派发） | **PASS** | `raw/subscribers.md`（536 行，逐条 file:line）；未决 8 条单列 |
| ③ 499 KB 客户端解析与构造 | **PASS（比值）** | C÷A = 5.8×、C p50 5.02 ms（§4） |
| ③-b "构造 57 ms" 读数 | **INCONCLUSIVE** | 顺序敏感伪影（原序 0.059 ms） |
| ④ 积压/背压 | **PASS** | 每轮次 1 条（94.1%），队列恒 ~1（§5） |
| ④-b 重连正确性（丢/重/乱序） | **见委托档** | `raw/bigresponse-reconnect.md`（或 `raw/w07s-*.json`）；活体判据 INCONCLUSIVE |
| ⑤ 候选是否达标（阈值①②③） | **未执行（本审计只给候选与阈值）** | 需执行档落地后同窗对照 |
| ⑤-C 纯 rAF 化是否**单独**足够 | **FAIL（不足）** | 帧率已≈帧率 ⇒ ≤1.07×（§6 候选 1） |

---

## 8. 证据清单（全部可重跑）

| 文件 | 内容 |
|---|---|
| `raw/mux-live-90s.json` / `mux-live-120s.json` | 被动 mux 原始帧（14 614 / 10 848 帧，含原文） |
| `raw/burst-90s.json`、`raw/stream-session-90s.json` | 桶占用、chunk 连跑、合并倍数 |
| `raw/mux-live-120s.json` → `raw/burst-120s.json` | 第二窗复核：活跃帧率 653.5/s（对照 656.8/s） |
| `raw/parse-cost.json`、`raw/parse-cost-isolated.json` | 逐帧解码 + zod 隔离测量 |
| `raw/session-list-499k.json`、`raw/w07s-bigresponse-bench.json` | 499 KB 样本 + 分阶段基准 |
| `raw/w07s-ws-frame-cost.json`、`raw/w07s-delivery-bursts.json` | 独立复算：帧处理占空比、投递轮次/积压 |
| `raw/subscribers.md` / `.json` | ② 完整订阅者清单（536 行 / 16 节） |
| `raw/bigresponse-reconnect.md` | ③④ 委托档完整报告（**若该文件尚未出现，以 `raw/w07s-bigresponse-bench.json`、`raw/w07s-delivery-bursts.json`、`raw/w07s-ws-frame-cost.json`、`raw/_shift-stdout.txt`、`raw/_shiftv2.out` 为准** —— 本报告 §4/§5 的全部数字均直接取自这些原始文件，**不依赖该 markdown**） |
| `tools/mux-observe.mjs` | 被动 mux 观察器（无浏览器、无锁） |
| `tools/burst-analysis.mjs`、`tools/stream-session.mjs` | 桶/连跑/合并倍数分析 |
| `tools/parse-cost.mjs`、`tools/parse-cost2.mjs` | 解码成本 |
| `tools/stream-cost.mjs`、`tools/stream-init.js` | 浏览器侧探针（**本轮未取得有效窗**，已加固待重跑） |
| `tools/burst-analysis.mjs` 等复算 §2.5 | 命令：`node -e` 读 `research-v2/react-commit/raw/measure-*.json`（脚本内联于本报告 §2.5 表格生成过程） |

**bundle 指纹（结论绑定字节，sha256 前 16 hex）**：
`dsh-client-runtime/lib/client.js = 357f1703722464ee`、`dsh-client-connection/lib/client.js = f729a994183ae736`、
`dsh-client-connection/lib/index.js = c354a001460736e6`、`dsh-client-ui-conversation/lib/client.js = fe448ef7e0b1f3e7`、
`dsh-client-ui-trajectory/lib/client.js = 2f5134b8c2117f54`、`dsh-subagent/lib/index.js = 36650446b5c20ebc`。

---

## 9. 未决 / 边界（诚实清单）

1. **流式窗口内的客户端 commit / 纤维数没有直接测量值**（§0）。**两次**尝试（`s1` 12 个外来进程、`s2` 13 个）**都在窗口中途被第三方终止浏览器**：
   `s1` 在加固前于 `page.evaluate` 挂死且未落盘；`s2` 已加固（每步 `withTimeout`、取消 CDP `Performance.getMetrics` 硬依赖、失败也落盘部分 JSON），
   仍收到 `Target page, context or browser has been closed`，`raw/stream-cost-s2.json` 只保住 readiness 快照（`hookInjected=1`、首 ~5.6 s 内 133 条 mux 帧、266 条被 SC 计数）。
   ⇒ 该格保持 **INCONCLUSIVE**；要取得它，必须在**浏览器存活可控**的窗口里重跑（见下方对协调者的建议）。
2. **锁事件（如实记录，未下结论）**：我的锁 `owner.txt = agent=w07-streaming(pid 768958) … started_at=2026-09-22T06:45:58Z`，
   在 **06:55:26Z** 被 `agent=w08-boot-causal pid=832923` 取代；**当时我的 pid 768958 仍存活**（`ps` 在 07:02 左右仍可见）。
   这符合 BATCH-PLAN §五.17 描述的"以不成立的存活判据回收存活 owner"形态；我未进一步取证其回收逻辑，**只记录事实**。
3. `cpuX` 的产物不含 `payload.type` 计数 ⇒ **无法确认** §2.6 各窗是否含 chunk 流；该表只能读作"该场景下会话链的占比"。
   同理，`research-v2/react-commit/raw/measure-*.json` 只按 `payload.type` 记 `session/event` 总数（**不记内层事件类型**），
   所以我**不能**断言 §2.5 的历史 13 窗"不含 chunk"——但**这不影响结论**：无论其中是否含 chunk，
   `corr(commits, session/event)=0.376` 与 `commits÷projection=1.19` 都成立（L1 窗 `session/event` 达 87/s，与流式会话的 98/s 同量级）。
4. §4 的 `E_reordered`（57.57 ms）为顺序敏感读数，**不得引用**。
5. §2.5 的 `commits÷projection = 1.19` 是**跨窗比值**（13 窗、三批），
   与本轮"流式重载"窗口（projection 63.7/s）结合得到的"~76 commit/s"属 **C 级外推**，**不作为测量值**。
6. 宿主侧 `projectionFramesOf` 的**全日志扫描**（`sessionStatsOf`/`tokenUsageOf`/`contextPressureOf`/`contextBreakdownOf`，`dsh-client-connection/lib/client.js:7605/7636/7747/7717`）
   在 90 s 内被调用 3 778 次（1 823+300+830+825）；其对**宿主** CPU 的占比本轮**未测**（属 M7/宿主侧面）。
7. `subagentTiming` 在子代理会话上**每个事件都产新对象**（`subscribers.md §2.4`，`dsh-subagent/lib/index.js:2140-2148`），
   是本轮最热的单键（1 919 帧/90 s = 33.5%）；其**表层读者确实存在**（`ui-subagent:90`）⇒ 候选 1 的键白名单必须**保留它**。
