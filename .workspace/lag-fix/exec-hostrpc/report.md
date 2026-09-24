# exec-hostrpc 修订执行复核一体档：HostRPC-v1（U-HR1 memo · U-HR2 signal · U-HR3 去重复折叠 · U-HR4 有界并发）

- 档：`.workspace/lag-fix/exec-hostrpc/`（本档独占）
- 契约：`.workspace/lag-fix/program/w02-host-rpc/audit.md` + `raw/VERDICT.json` + `.workspace/lag-fix/program/w08-boot/audit.md` + 协调者追加单元（`w06`/`w08`：扫描层上限语义 / 有界并发 IO / 跳数断言）
- 宿主：PID **301709**（`node .../dsh web`，启动于 10:54:59），Node v22.23.2
- **本轮全程未重启、未发任何信号、未改产品文件**；`deployed` 写入由协调者执行（**已完成**，见 §一）
- 交付：**4 个单元**的候选件（2 文件）+ 补丁工具 + 离线/在线证据 + 验收与回滚脚本 + 本报告

---

## 零、一句话结论与自裁决

> **四个单元全部落地为候选件，且协调者已把候选件写入 live（哈希逐字节相符）。
> 离线真证：集合等式逐字节成立、memo 命中跳数归零、冷扫描跳数 8.94 → 2.25/目录、
> U-HR3 的重复折叠被"计数级"证明消除且行值逐字节不变。
> 宿主侧三项（单发 p50 / 并发矩阵 / abort 反事实）**已取得重启前基线**（旧代码口径）——
> 作为验收读数一律 **INVALID**，须重启后重测；验收脚本本身已端到端跑通并在部署文件上
> 通过 C4/C5/C6/C7 四项（其中 C7 是**进程内构造实例**，与宿主进程内是否新代码无关）。
> 自裁决：`PASS（附 3 项条件）`。**

| 单元 | 状态 | 候选件 sha256 | 关键证据 |
|---|---|---|---|
| **U-HR1** persistence header 扫描按目录 memo | **已落地（=已部署）** | `4c7059e7…`（含 HR4） | 集合等式逐字节 PASS；awaits **10 868 → 20**（**543×**）；p50 137.4 → **2.41 ms**；memo 命中 **0 per-session IO / 0 轮次** |
| **U-HR2** `req.signal` 传进 `session.list` | **已落地（=已部署）** | `a6fe1ae9…`（含 HR3） | 审计定位的 1 行**不足**：路由表也丢 signal ⇒ 实为 **2 处**（§三） |
| **U-HR3** 去重复折叠（请求内单次折叠快照） | **已落地（=已部署）** | 同上 | P1 行值逐字节不变 / P2 recency 不变（10/10 真实会话）；**P3 省下的迭代量 == 恰好一趟折叠**（计数级证明） |
| **U-HR4** 冷扫描有界并发化 | **已落地（=已部署）** | `4c7059e7…` | 冷扫描跳数 **8.94 → 2.25/目录（3.97×）**；p50 **197.0 → 69.2 ms（2.85×）**；**syscall/await 总量逐臂不变** |
| 追加 ① 上限只挡行不挡扫描 | 已由 U-HR1 覆盖 | — | 1 356 扫描 / 200 上线 ⇒ **1 156（85.3%）被扫但永不下发** |
| 追加 ② 有界并发 IO | **已落地** | `4c7059e7…` | 冷 8.94 → **2.25/目录**（判据 ≤3.0 达标）；墙钟 2.85×；8 路饱和不再获益 |
| 追加 ③ 跳数断言 | 已实现并 PASS | — | memo 命中 0 per-session IO；冷扫描 ≤3.0 每目录（实测 2.25） |

**⚠️ 第一条提醒**：宿主**尚未重启** ⇒ 磁盘上是新代码、进程内仍是旧代码。
下面所有"宿主侧"结论一律标 INVALID，**不得据此宣称宿主修复达标**；`raw/verify-prerestart.json` 是重启前基线。

---

## 一、部署状态（协调者已完成写入；冷面未生效）

`raw/deployment-state.json` 逐字记录：

| 文件 | live 当前 sha256 | mtime | 等于本档候选件？ | 覆盖单元 |
|---|---|---|---|---|
| `dsh-session-persistence-jsonl/lib/index.js` | `4c7059e7b1b4…ab8aa8` | **2026-09-22 15:54:12** | **是** | U-HR1 + U-HR4 |
| `dsh-host-apiproxy/lib/index.js` | `a6fe1ae90e8e…d35836` | **2026-09-22 15:54:12** | **是** | U-HR2 + U-HR3 |

- 宿主进程 `301709` 启动于 **10:54:59**，**早于**部署时刻 ⇒ **进程内仍是旧代码**（`restartedSinceDeploy: false`）。
- ⇒ 宿主侧验收（C1 单发 p50 / C2 并发矩阵 / C3 abort 反事实）**必须重启后才能测**；本档不伪造。
- **⚠️ 回滚操作提示**：本次写入**未经本工具登记 pre-image**（`pre-image/applied/index.json` 为空）⇒
  协调者回滚请用 **`node apply-HostRPC-v1.mjs --rollback all --from-preimage`**（逐字节 pre-image 副本 + 严格守卫：
  仅当目标当前 sha256 恰等于本计划输出时才覆盖，否则拒绝且不动其他文件）。详见 `DEPLOY.md` §4。
- **写入发生在 15:54:12，造成一次证据口径切换**：此后 `--module live`（即导入产品树）拿到的是**已打补丁的文件**，
  不再是"修复前"基线。本档已把全部基线臂改为显式导入 `pre-image/`，并在 `raw/deployment-state.json` 里
  逐条标注哪些早期产物因此失效（§九.1）。**这是"before 悄悄变成 after"这类静默错误的一个真实实例**，值得全组注意。

---

## 二、U-HR1：`persistence.list()` header 扫描按目录 memo

### 2.1 独立复核的安全前提（**通过**，比审计覆盖更全）

| 写路径 | 位置 | 语义 | 可能改写 header 帧？ |
|---|---|---|---|
| 创建 | `materialize` → `encodeMaterialization`（`:1171-1181`）→ `materializePosix`/`writeSyncedTempFile`（`:1159-1169`） | `headerFrame + eventFrame` 一次性写临时文件 → `rename` 发布 | 唯一一次 |
| 追加 | `appendLines`（`:1200-1227`） | `open(path, "a")` + `writeFile(encodeEventBatch(events))` | **否**，只写事件帧 |
| 追加回滚 | `rollbackAppend`（`:1228-1237`） | `truncate(before)`，`before = handle.stat().size`（**本批追加前**的大小） | 否；`before ≥ 完整 header 帧长度` |
| 崩溃修复 | `repair`（`:1238-1247`）← `commitRepair`（`:1031-1036`） | `truncate(tornMarker.truncateTo)`；来源 = `readZstdPrefix` 的 `tornStart`（`:1008`，残缺帧起始偏移）或 `scanLog` 的 `committedBytes`（`:934`，最后一条完整行末尾） | 否；能产出 `meta` 即证明 header 帧完整，截断点必在其后 |

旁证：`toHeaderLine`（`:36-51`）JSDoc 原文即 **"the immutable session metadata to serialize"**，字段集
`type/version/id/createdAt/cwd/parentSession/seedLength/origin/delegationDepth/agentPreset` **全为创建期固定**
（**不含** title/name/updatedAt）；`assertZstdHeaderFrame` 强制首帧 = 单行 header；全文件对**已发布** log 只有上述 4 处写；
宿主 `dsh-host-apiproxy` 全文件 **0 处 `rm(`/`unlink`**（grep 实证）；`this.root` 只在构造器赋值一次（grep `this.root *=` = 1）。

### 2.2 改动形状（在两处做了**必要的加固**，否则直接违反硬性验收 #2）

1. **不做负缓存。** `materializePosix` 的顺序是 `mkdir root → mkdir project → mkdir sessionDir → 写临时文件 → fsync → rename`
   ⇒ **存在"目录已存在、日志尚未发布"的窗口**（含一次完整 fsync，拥塞时可达数十 ms）。若把"该目录无 artifact"也缓存，
   而目录集合此后不变，该会话**永远不会出现** —— 正是验收 #2 点名的反事实。
   ⇒ memo **只缓存成功探测到的 artifact**；未产出者**每次重探**（稳态下 ~0–1 个目录）。
2. **不把结果对象共享出去。** 打补丁前每次调用都 `parseHeaderMeta` 出新对象；`sessionPersistence.list()` 有 12+ 处跨包消费点
   （`dsh-workspace`/`dsh-subagent`/`dsh-session-query`/`dsh-api-remotes`/`dsh-schedule`/`dsh-message-feedback`…）。
   ⇒ 每次命中返回 **header 浅拷贝**（字段全为原始值 ⇒ 浅拷贝即深拷贝），对象新鲜度与打补丁前一致。

形状：`listArtifacts` 保留目录顺序，逐目录改调 `probeArtifactMemoized(dir, memo, signal)`；末尾按 `seen` 逐出；
重复 id 检测与 `encodingMismatch` 抛错保持**目录顺序**语义。**无 TTL**；失效信号只有目录集合（1 readdir/项目，实测 20 次）。
memo 落在 `this.lagFixHr1ArtifactMemo`（实例属性；服务重建即冷一次，正确）。

**消费点覆盖**：`dsh-host-apiproxy:2255`（`session.list`）与 **`dsh-subagent/lib/index.js:1874`（`subagent.list`）同实例共用同一 memo**，
追加单元点名的"同构消费点"自动受益，无需另改文件；`listSnapshots` 的 `revision` 仍逐次 `stat`，**未被缓存**。

### 2.3 真跑证据（离线真根 A/B，`raw/offline-ab.json`）

器械：`scripts/offline-ab.mjs` —— 同进程三臂（**基线 = `pre-image/` 显式导入**），root = 真实 `/home/CNS2026495165/.dsh/sessions`：

| 量 | pre-image（基线） | candidate 冷（`memo.clear()`） | **candidate 暖（memo 命中）** |
|---|---:|---:|---:|
| `list()` p50 (ms) | 137.43 | 51.92† | **2.41** |
| `list()` p90 (ms) | 179.19 | 183.67 | **3.20** |
| 顺序 await 数 | 10 868 | 10 868 | **20** |
| `exists` 调用 | 2 708 | 2 708 | **0** |
| `readFirstZstdLine` 调用 | 1 354 | 1 354 | **0** |
| `readdir` 调用 | 20 | 20 | 20 |
| 返回行数 | 1 356 | 1 356 | 1 356 |

† 该次运行（15:52:02，部署前）的冷臂已含 U-HR4（并发 4）⇒ 51.92 ms 是"U-HR1+U-HR4 冷扫"；
**纯 U-HR1 的冷扫不加速**（§五 的 HR1-only 臂 = 183.6 ms ≈ 基线 197.0 ms）。

- **集合等式（硬性验收 #2）**：三对比较（`candCold_vs_live` / `candWarm_vs_live_cold` / `candWarm_vs_candCold`）
  **全部逐字节相等**（比较对象是 `[header, path]` 的完整 JSON）。比较前做**目录集合漂移控制**：第 1 次尝试即 `dirSetStable: true`。
- **哨兵**：`realSessionDirs.sessionDirs = 1356` == `list()` 行数 **1356**（19 个项目）。
- **忠实性对照**：基线臂与 candidate 冷臂的 await 数**完全相等（10 868）**——交叉证明"冷模拟 = 真实冷扫"。
- **收益**：await **543×** 下降；p50 **57×** 下降（137.43 → 2.41 ms）。

### 2.4 真跑证据（精确跳数，`raw/hop-count.json`）

器械：`scripts/hop-count.sh` —— 用真实会话目录复制出**受控合成根**（保持 `projectKey(cwd)/encodeSegment(id)/session.jsonl.zstd`
相对布局，否则 `assertStoredIdentity` 会走 realpath 分支改变成本模型），对每种配置跑 `--scans 0` 与 `--scans 2`，
取 `(counts(2) − counts(0)) / 2` = **每扫描精确成本**。strace 只用于**计数**（它扰动延迟，故延迟一律不取自 strace 运行）。

**每会话目录斜率（N=8 → N=16）**：

| 探针 | pre-image 冷 | candidate 冷（HR1+HR4） | **candidate 暖（memo 命中）** |
|---|---:|---:|---:|
| `openat` | 3.06 | 3.00 | **0.00** |
| `close` | 2.06 | 2.00 | **0.00** |
| zstd 帧读（`"(\265/\375`） | 1.00 | 0.88 | **≈0** |
| **实 fs syscall 合计** | ~6.1 | ~5.9 | **0.00** |
| **事件循环轮次代理** | **8.94** | **2.25** | **0.00** |
| `read` 总量（含 eventfd 轮询） | 10.12 | 3.44 | 0.38 |

- **审计的"首帧在第一次 8 KB 读内闭合"得到硬证据**：迭代级追踪可见 `read(fd, "(\265/\375…", 8192) = 8192` 后立刻 `close`
  ⇒ `zstdFrameReads = 1.00/目录`。**O(F²) 证伪成立。**
- **精确跳数定标**：每会话目录 = **3 openat + 1 read + 2 close = 6 syscall**（逐次调用追踪核对：`exists(opposite)` 是一次 **ENOENT** 的 `openat`，
  无 read/close；`exists(path)` 是 open+close；`readFirstZstdLine` 是 open+read+close）。
  顺序 await = **8/目录**（两处 `exists` 各 2 + `readFirstZstdLine` 的 open/read/`decompressZstdFrame`/close 4；arity 逐行读自 `:1431`、`:1279-1313`、`:580`）
  ⇒ 1 356 目录 = **awaits ≈ 10 868**，与 §2.3 实测**完全一致**。
- **口径分歧已解释**：w02 报 8 490（7/目录，漏 `decompressZstdFrame` 那一跳）、w06 报 6 065（含一个不存在的 `stat`）；
  本档给出逐行核对的 **8 await / 6 syscall**，并由"基线臂与冷臂实测 await 逐值相等"交叉验证。
- 代入审计放大律（0.1545 ms/await）：`10 868 × 0.1545 ≈ 1 679 ms`，与 w08 稳态实测 1 224.8 / 1 580.8 / 512 / 564 ms 同量级
  ⇒ **审计的单参数模型被独立复现，且用的是更准的跳数**。

---

## 三、U-HR2：把 `req.signal` 传进 `session.list` —— **审计的 1 行不足，实为 2 处**

`handleUnary`（`:4928`）确实把 `req.signal` 作为**第 3 实参**传给 `route.invoke`（`:4937`），
**但 `UNARY_ROUTES["session.list"]` 的路由表 invoker 是 `(api, r) => …`（`:4684`）⇒ signal 在进 handler 前就被丢了**
（对照 `:4688` 的 `session.search` 是 `(api, r, signal)`）。52 条路由中仅 **10** 条转发 signal
（`grep -c "invoke: (api, r, signal)"` = 10；`grep -c "invoke: (api, r)"` = 42）。

```js
// 修前 :4684
	"session.list": { schema: sessionListRequestSchema, invoke: (api, r) => api.sessions.list(r) },
// 修后（edit#0 路由表 + edit#1 handler，两处缺一不可）
	"session.list": { schema: …, invoke: (api, r, signal) => api.sessions.list(r, signal) },
	async list(request, signal) { return ok(request, { items: await listVisibleSessionSummaries(signal) }); },
```

⇒ **只改 `:2493` 得到的是死代码**（参数永远 `undefined`，行为与修复前逐字节相同）。本档按单元意图落 2 处（同 marker、同单元、可整单元回滚）。
下游链路复核：`listVisibleSessionSummaries(signal)` 全程 `signal?.throwIfAborted()`（`:2225/:2240/:2262/:2264/:2267/:2284/:2286…`），
`persistence.list(signal)` → `listArtifacts(signal)` 亦全程（`:1061/:1063/:1067…`）⇒ 修复后客户端 30 s 超时
（`DEFAULT_TIMEOUT_MS = 3e4`，`:5307`）或主动断开会在**下一个** `throwIfAborted()` 处抛出，**不再把 10 868 个 await 跑完**。

**与 U-HR1 必须同批（追加单元 ④ 确认）**：U-HR1 砍乘数、U-HR2 砍积压自我放大，两者修的不是同一件事；只做其一的收益都缺一半。两处同为冷面 ⇒ 合并成本为零。

---

## 四、U-HR3：去掉 subagent 事件流的重复折叠（**本轮落地**，附口径说明）

### 4.1 改动形状（请求内单次折叠快照）

原状：`attachedRecency`（`:2240` 区）对每个 attached subagent 折一遍 `sessionListMetadata(session.events)`，
随后 `summarize(session, running)`（`:1290`）**再折一遍**。`summarize` 全文件只有 **1 个调用点**，因此改动面很小。

```js
function summarize(session, running, metadata) {          // 新增可选第 3 参
	const resolved = metadata ?? sessionListMetadata(session.events);
	return { sessionId, updatedAt: sessionListUpdatedAt(header, resolved), running, blank: resolved.blank, ...sessionListFields(...) };
}
// 折叠循环：折一次，快照留给 summarize 复用
for (const session of attachedSubagents) {
	const metadata = sessionListMetadata(session.events);
	attachedMetadata.set(session.id, metadata);
	attachedRecency.set(session.id, sessionListUpdatedAt(session.header, metadata));
}
// summarizeAttached：subagent 命中快照；顶层会话取不到 ⇒ 缺省再折一次（与原来一致）
...summarize(session, agent?.status === "running", attachedMetadata.get(session.id)),
```

**折叠次数**：subagent 由 **2 趟 → 1 趟**；顶层 attached 会话**不变**（本来只折 1 趟，现在仍 1 趟）。

### 4.2 口径说明（**必须与验收口径一起读**）

快照建立在同一同步段内 ⇒ **recency 排序键与行内 `updatedAt` 现在取自同一时刻**（修复前两者可能取自不同时刻 —— 这本身更像一个潜在不一致）。
代价：subagent 行的 `updatedAt` / `blank` / `lastPromptAt` 是**"请求开始时刻"**的快照；
若同一请求在飞期间该会话追加了事件，取值会比打补丁前**略早**。
⇒ 审计 F3(a) 的"`items[]` 与 pre-image 逐行等值"在**冻结输入**下成立（§4.3 P1 已证）；
在**活动宿主**上，若恰好有 subagent 在请求飞行的 0.5–3.85 s 内追加事件（宿主 append+fsync 实测 9.17 次/s），
`updatedAt` 可能与"晚折"实现有 **1 个事件的时序差**。这是**唯一**的行为差异，且方向是"排序键与显示值一致"。

### 4.3 真跑证据（`raw/fold-dedupe.json`，**10 个真实会话**）

器械：`scripts/fold-dedupe.mjs` —— 借 w02 的 **export-append 技法**（逐字节复制两个 apiproxy bundle，追加
`export { sessionListMetadata, sessionListUpdatedAt, sessionListFields, summarize }`，**不改产品文件**），
事件流用真实日志经 `readPrefix()` 解出（样本跨 size 分布抽取，含一条 **658 870 事件**的重会话）。

| 性质 | 断言 | 结果 |
|---|---|---|
| **P1 行等值** | `summarize(s,r,meta)` 与 `summarize(s,r)` 产出**逐字节相同**的行（两个 bundle 交叉验证） | **10/10 PASS** |
| **P2 recency** | `sessionListUpdatedAt(header, sessionListMetadata(events))` 不变 | **10/10 PASS** |
| **P3 折叠计数** | 用 Proxy 计事件数组读取次数：`readsShapeA − readsShapeB` **恰好等于一趟折叠的读取量** | **10/10 PASS**（逐会话精确相等） |
| **P4 墙钟** | 交错计时 shapeA vs shapeB（各 6 次取均值） | 见下 |

P3 的样本（最能说明问题的一条）：`events = 658 870`，`readsOneFold = 1 317 742`，
`readsShapeA = 3 294 355`、`readsShapeB = 1 976 613`，**`savedReads = 1 317 742 == readsOneFold`（逐值相等）**
⇒ **省下的正好是一整趟事件流折叠**，不是估的。

P4：10 个会话合计 `msShapeA = 45.17`、`msShapeB = 27.98`（**省 17.19 ms**）；
但**中位数只有 0.0055 ms/会话**（典型 subagent 流 ~300 事件），均值 1.72 ms 由那条 658k 事件的重会话主导
（单它就 44.53 → 27.78 ms，**省 16.75 ms**）。
⇒ **U-HR3 是"常数项"，只在超长 subagent 流上才显著**（这与我先前判定"不是乘数"一致，但它确实在重流上有真实收益）。

---

## 五、U-HR4：冷扫描有界并发化（追加单元 ②）

### 5.1 改动形状（**保错误优先级**）

原写法在嵌套 `for` 里逐目录顺序 `await`。新写法：**先按目录顺序收集全部目录 → 有界并发探测 → 按目录顺序回放结果**。

```js
const dirs = [];                       // 顺序收集（readdir 仍是每项目 1 跳）
for (const project of await this.listProjectDirs(signal)) { … dirs.push(dir); }
for (const entry of await this.probeArtifactsBounded(dirs, memo, signal)) {
	if (entry.error !== void 0) throw entry.error;             // ← 仍抛目录顺序里第一个错
	const artifact = entry.artifact; …
	if (ids.has(artifact.header.id)) throw new Error(`duplicate JSONL session id …`);   // ← 顺序不变
}
```

- `probeArtifactsBounded` 用 `cursor` 驱动的 worker 池，宽度 `globalThis.__DSH_LIST_SCAN_CONCURRENCY ?? 4`，**每目录仍走 `probeArtifactMemoized`**
  ⇒ memo 命中者零成本，**只有 miss 真正并发**。
- 每个 worker 循环入口 `signal?.throwIfAborted()` ⇒ 取消仍被及时观察。
- 代价（如实记录）：**出错时已为后续目录付过 I/O**（只读、无副作用），且抛错前会多做工作。

### 5.2 真跑证据 A：剂量-响应（`raw/scan-concurrency-sweep.json`，真实 root 1 356 目录）

6 个臂**逐轮轮转顺序**（消除位置偏差）、每臂 8 次冷扫、交错执行：

| 臂 | p50 (ms) | p90 (ms) | 相对 pre-image | awaits | 实 fs syscall | 结果逐字节相等 |
|---|---:|---:|---:|---:|---:|---|
| **pre-image（基线）** | **197.0** | 253.4 | 1.00 | 10 868 | 6 800 | ✓ |
| candidate HR1-only（无 HR4） | 183.6 | 207.0 | 1.07 | 10 868 | 6 800 | ✓ |
| candidate HR1+HR4 conc=1 | 191.9 | 221.8 | 1.03 | 10 868 | 6 800 | ✓ |
| candidate HR1+HR4 conc=2 | 98.6 | 121.0 | 2.00 | 10 868 | 6 800 | ✓ |
| **candidate HR1+HR4 conc=4（默认）** | **69.2** | 101.1 | **2.85** | 10 868 | 6 800 | ✓ |
| candidate HR1+HR4 conc=8 | 69.9 | 103.5 | 2.82 | 10 868 | 6 800 | ✓ |

四条读数：
1. **工作不变性（断言而非叙述）**：`awaitsIdenticalAcrossArms = true`（全为 10 868）、`syscallsIdenticalAcrossArms = true`（全为 6 800）
   ⇒ U-HR4 **只改串行化，不改工作量**。
2. **HR1 不给冷扫加速**：HR1-only = 183.6 vs 基线 197.0（+7%，噪声内）—— memo 的正确形态，冷扫本就该不变。
3. **HR4 的并发=1 与基线等价**（191.9 vs 197.0）⇒ **U-HR4 的重构本身没有结构性开销**。
4. **conc=4 → 2.85×**，conc=8 **不再变好**（69.9 vs 69.2，p90 反而略差）⇒ **饱和点在 4，默认值取得正确**。

### 5.3 真跑证据 B：跳数（追加单元 ② 的专属判据）

见 §2.4 的斜率表：**事件循环轮次代理 8.94 → 2.25 /会话目录（3.97×）**，且 `openat`/`close`/zstd 帧读**基本不变**
（3.06→3.00 / 2.06→2.00 / 1.00→0.88）⇒ "跳数必须下降、工作必须不变"两条同时满足。

| 判据 | 追加单元要求 | 实测 | 判定 |
|---|---|---|---|
| 热路径（memo 命中） | **→ 0** | **0.00 syscall / 0.00 轮次 / 0 每会话 IO** | **达标（比要求更强）** |
| 冷路径（首次/目录变化） | **≤ 3.0 /目录** | **2.25 /目录** | **达标** |
| 冷路径绝对量（1 356 目录） | 原定 **≤1 520** | 2.25 × 1 356 ≈ **3 051**（基线 8.94 × 1 356 ≈ **12 123**） | **未达绝对目标，但已达 3.97×** |

**关于那个绝对目标**：`≤1 520` 是按 w06 的 **6 065 跳**基线 ×(1/4) 定的；本档实测基线是 **8.94/目录**
（1 356 目录 ⇒ 12 123 轮次），÷4 的等价目标是 **~3 030**，与实测 3 051 一致。
要真正压到 ≤1 520 需要并发度 ≈ **7–8**（实测 conc=8 为 **1.28/目录 ⇒ ~1 736**），
但 §5.2 已证 **conc=8 在墙钟上不再获益**（69.9 vs 69.2，p90 更差）⇒ **不建议提高默认值**；
需要时可用 `globalThis.__DSH_LIST_SCAN_CONCURRENCY` 热调（无需改代码）。

> **另注（仪器修订）**：本轮先做过一版"事件循环轮次代理"v1，它匹配固定的 fd 与固定的 eventfd 计数值；
> 两者都是错的（libuv 的唤醒计数会累加、fd 号会复用）⇒ v1 在**跨模块比较**上不可靠。
> v1 数字保留在 `raw/hopcount/`、`raw/hop-count-concurrency.json`、`raw/turn-proxy.json`，**已标为仅同运行内可比**；
> §5.3 的结论改用 v1 的**同一运行内对照**（preimage vs candidate 同一次运行），并由 §5.2 的墙钟剂量-响应独立佐证。

---

## 六、追加单元 ① / ③

### 6.1 ① `SUBAGENT_LIST_MAX = 200` 只挡"行"、不挡"扫描" —— **已被本实现覆盖**

静态事实：`persistence.list(signal)` 在 `dsh-host-apiproxy/lib/index.js:2255`，位于**任何**过滤/排序/截断之前
（`:2256-2259` 才 `filter/sort/slice`，`:2292-2295` 才最终 `overflow` 截断）。实测（`raw/offline-ab.json → rowLimitAddendum`）：

| 量 | 值 |
|---|---:|
| 扫描产出的 header artifact 数 | **1 356** |
| `session.list` 实际下发上限 | 200（subagent 行） |
| **被扫但永不下发** | **1 156（85.3%）** |

U-HR1 的语义正好满足追加单元要求：**memo 缓存的是 `listArtifacts` 的扫描结果本身**（1 356 条 artifact），
上限只作用在其**下游** ⇒ 把上限提到 1000/无限**成本中性**（memo 命中，0 per-session IO），只是下游多出千行。

**关于"把上限临时设 0/1 时成本应显著下降"这个反事实**，本档如实说明：它在**扫描层**才成立，
而 U-HR1 之后**扫描层已与上限无关**（这正是成果）。可执行的反事实是下面这条（写入 `verify-postdeploy.mjs` C7）：

| 观测（把 `globalThis.__DSH_SUBAGENT_LIST_MAX` 设为 1） | 修复前 | 修复后 |
|---|---|---|
| `session.list` 的 **scan 成本** | 不变（1 156 条白付） | **不变但已缓存**（0 per-session IO） |
| 同时刻 `session.list` 的**下游成本** | 显著下降 | 显著下降 |

### 6.2 ③ 跳数断言 —— **已实现，PASS**

`raw/offline-ab.json → hopAssertion`（对**部署文件同源**的实例，先热 memo，再清空计数器调一次 `list()`）：
`exists = 0`、`readFirstZstdLine = 0`、`readFirstLine = 0`、`assertStoredIdentity = 0`、`sameFile = 0`，
只剩 `listProjectDirs = 1` + `listSessionDirs = 19`（**20 个 await，全是 readdir**）⇒ **"不得再产生 per-session IO" 成立（是 0，不是"减少"）**。
并由 §2.4 的 strace 斜率 `0.00/目录` 独立佐证。`verify-postdeploy.mjs` 的 **C7 会在部署文件本体上重跑**，
并额外断言"冷扫描工作量不随并发度变化"。

---

## 七、候选件与补丁工具

### 7.1 产物与哈希

| 单元组 | 文件 | sha256 | 字节 | 已部署？ |
|---|---|---|---:|---|
| U-HR1 + U-HR4 | `candidates/dsh-session-persistence-jsonl/lib/index.js` | `4c7059e7b1b4d6d3ceb4252efe49c201e2f47392d26d103f152af3097dab8aa8` | 61 148 | **是（= live）** |
| U-HR2 + U-HR3 | `candidates/dsh-host-apiproxy/lib/index.js` | `a6fe1ae90e8e14ad45d799656b058a2c969161c29db5506cc63cf4ca4dd35836` | 219 613 | **是（= live）** |
| U-HR1 only（参考树） | `candidates-hr1only/…/index.js` | `1b3185c7dc8a10de8c6363305113a7b95855e6ac9afd53baf05aea14226bccc2` | 59 020 | 否 |
| pre-image（基线） | `pre-image/dsh-…__lib__index.js` ×2 | `8b6ebc45…97f3` / `0d96607e…38cfc4` | 57 305 / 217 797 | — |

- `patch-plan.json`：机读补丁计划（4 单元 / 2 文件 / **7 个 anchor**，逐字节取自 pre-image，含 `requires` 依赖与期望 pre-image sha256）。
- `scripts/build-plan.mjs`：从 `pre-image/` **现场重算**计划，anchor 按**逐文件累加器**解析（因为同一文件有多个单元），`--check` 校验漂移。
- **diff 规模**：persistence **1 hunk**、apiproxy **5 hunk**（共 6 hunk）。

### 7.2 `apply-HostRPC-v1.mjs`（逐条对应交付要求）

| 要求 | 实现 | 端到端实测（在**包树副本**上，`raw/apply-fakepkg.json`） |
|---|---|---|
| dry-run 默认 | 不带 `--apply` 只打印 | **未写任何文件**（前后 sha256 一致） |
| `--apply` 才写 | ✅ | 写出 sha256 = `4c7059e7…` / `a6fe1ae9…`，**与已部署文件逐字节相同** |
| **锚点唯一命中才写，否则一个文件都不写** | 全部文件/单元先预检，任一命中≠1 ⇒ 打印清单 + `exit 3` + **0 写入** | 在 U-HR1 文件注入**重复 anchor** 后 `exit 3`，**另一文件的 `dsh-lag-fix HR` 计数 = 0** ⇒ **跨文件 all-or-nothing 成立** |
| 自动 pre-image | `pre-image/applied/<stamp>/<fileKey>/index.js`（**每文件独立子目录**），登记 `index.json`（含该文件本次的单元列表）；复制后**立即校验备份 sha256**，不符 ⇒ `exit 6` + 0 写入 | ✅ |
| `node --check` | 先写同目录临时 `.mjs` 并 `--check`，通过后才 `rename` 就位 | 两文件均 `[node --check OK]` |
| 幂等 | 文件已存在 marker 集合 == 目标单元集合 ⇒ `ALREADY-PATCHED`，不写 | 二次 `--apply` → `完成：0 个文件写入` |
| **部分状态拒绝** | 只存在一部分 marker ⇒ `PARTIAL` + 拒绝（不做猜测式合并） | 先 `--skip U-HR4` 造成只含 HR1，再全量 `--apply` ⇒ `exit 3` + 0 写入 |
| 单元可独立回滚 | `--rollback all` / `--rollback U-HR1,U-HR4` / `--rollback U-HR2,U-HR3`；**按 apply 时记录的目标路径还原**（绝不按 `--root` 重算），并校验备份自身 sha256 | `--rollback U-HR1` 只还原 persistence（`8b6ebc45…`），**apiproxy 保持 `a6fe1ae9…` 未动**；`--rollback all` 两文件均回到 pre-image |
| 单元依赖 | `requires`：U-HR4 的 anchor 位于 U-HR1 的替换文本内；`--skip U-HR1` 会**自动带走 U-HR4** 并说明原因 | 预检输出显式列出 `U-HR4#0 命中 0 次` 等诊断，**不会留半套补丁** |
| 输入源 | `--base live|preimage`（默认：`--stage` 用 preimage，就地 `--apply` 用 live） | 部署后用 `--base preimage` 成功重建 U-HR1-only 参考树（`1b3185c7…`，与先前两次独立生成一致） |
| **无索引回滚** | `--rollback … --from-preimage`：不依赖 `index.json`，但**只在该文件当前 sha256 恰等于本计划的输出时**才覆盖，否则拒绝（`exit 7`）且其余文件不动 | ① 目标 = 本档候选件 ⇒ 回滚成功（两文件回到 pre-image）；② 目标被第三方追加一行 ⇒ `exit 7` + 拒绝，另一文件未动。**本批的 live 写入未经本工具登记，故协调者回滚必须走这条** |

**回滚粒度如实说明**：回滚是**按文件**的（U-HR1+U-HR4 同在 persistence、U-HR2+U-HR3 同在 apiproxy）。
要"只停用 U-HR4"的正确操作是 **`--rollback all` 之后 `--apply --skip U-HR4`**
（已实测得到 U-HR1-only 的 `1b3185c7…`，与独立生成的参考树一致）。

### 7.3 既有补丁标记核对（硬性验收 #5）

| 标记 | pre-image | 候选件（= live） | 判定 |
|---|---:|---:|---|
| `dsh-lag-fix B1`（apiproxy 行数） | 5 | **5** | 原样保留 |
| `dsh-lag-fix B1-perf v1`（apiproxy） | 1 | **1** | 原样保留 |
| `dsh-lag-fix HR1`（persistence） | 0 | 2 | 新增 |
| `dsh-lag-fix HR2`（apiproxy） | 0 | 2 | 新增 |
| `dsh-lag-fix HR3`（apiproxy） | 0 | 3 | 新增 |
| `dsh-lag-fix HR4`（persistence） | 0 | 2 | 新增 |

`diff -u pre-image candidate` **只有 6 个 hunk**，其余逐字节相同 ⇒ B1/B1-perf 区块**逐字节未被触碰**。
（`C6` 已把上表写成断言，重启后会再自动复核一次。）

---

## 八、生命周期反事实（`raw/counterfactual.json`，8/8 PASS）

用**真实 `materialize()`** 在合成根上造会话，驱动打了补丁的后端：

| 步骤 | 断言 | 结果 |
|---|---|---|
| baseline | 3 个会话被列出且 == 冷扫描 | PASS |
| **A1** | **目录先于日志出现时不做负缓存**（`memoHasEntry === false`） | PASS |
| **A2** | **日志发布后新会话立即出现**，且 == 冷扫描 | PASS |
| B | 新项目目录（新 cwd）被拾取 | PASS |
| C | 删除会话目录后行被丢弃 | PASS |
| D | 暖 memo 路径 == 强制冷扫描路径（逐字节） | PASS |
| E | `listArtifacts()` 数 == 磁盘会话目录数（**不用 `session.list` 当哨兵**） | PASS |
| F | 目录集合变化后重扫一次，随后回落到暖路径地板 | PASS |

A1 的断言（`memoHasEntry === false`）**正是判别性检查**：若实现改成整表/负缓存，A1 会立刻失败。

---

## 九、失败 / INVALID / 诚实清单

| # | 项 | 状态 | 说明 |
|---|---|---|---|
| 1 | **证据口径被部署打断** | 已修正并标注 | 部署发生在 **15:54:12**；此后导入产品树得到的是**已打补丁**的文件。因此 `raw/hop-count.json`(15:55)、`raw/turn-proxy.json`(15:55)、`raw/scan-concurrency-sweep.json`(15:57) **首版作废**，已改为显式 `pre-image/` 基线臂重跑。`raw/offline-ab.json`(15:52) 与 `raw/counterfactual.json`(15:52) 因写在部署前而**有效**，且 offline-ab 自带 `liveSha256=8b6ebc45…` 可自证。清单见 `raw/deployment-state.json`。 |
| 2 | **宿主侧三项未测** | **INVALID（未重启）** | 单发 p50 / 并发矩阵 / abort 反事实都需要进程内是新代码。见 §一。 |
| 3 | **C2 比值判据被实测证明"会退化/不稳定"** | **重要发现** | 在**同一份旧代码**（未重启）上跑了两次，loadavg 量级相近，判据给出**相反结论**：<br>· 第 1 次：单发 p50 **13 486 ms**、4 路 **15 400 ms** ⇒ **比值 1.14 ⇒ "PASS"**；<br>· 第 2 次：单发 p50 **12 826 ms**、4 路 **29 260 ms** ⇒ **比值 2.28 ⇒ "FAIL"**。<br>两次的**绝对量都是灾难级**（十几秒到几十秒），而比值一次判通过一次判失败。⇒ **比值判据在修复前的工作点上既会误判通过、又不稳定**，必须与绝对量一起读，且**绝对量应为判据主体**（§十.2）。 |
| 4 | **C3 单次 abort 不具判别力** | 已修，且新版**已证明具判别力** | 首版只 abort 1 个请求，跑出 `afterAbortP50 = 1.66 ms`（"PASS"），但 1 个请求可能在 200 ms 前就已完成 ⇒ 无法产生僵尸。已改为 **3 路并发 abort** 并记录判别力。新版实测（旧代码）：`stillInFlightAtAbortMs200 = 3`（**3 个请求都还在飞行中被 abort** ⇒ 判别成立），`host.describe` p50 **1.87 ms（基线）→ 4.38 ms（abort 后瞬间，头阻塞）→ 1.65 ms（1 s 后）**，`max` 43.7 ms。⇒ **测试确实能观测到头阻塞**，重启后同一条若仍 ≤5 ms 才有意义。 |
| 5 | **C7 检测方式有 bug** | 已修正，并在**部署文件上验证通过** | `lagFixHr1ArtifactMemo` 是**首次扫描时才惰性创建**的，所以"先看属性是否存在"永远得到 `undefined`（即使补丁在位）。首轮因此**误报 FAIL**。改为"读部署源码查 `dsh-lag-fix HR1` 标记 + 运行时断言"后实测：memo 命中 `exists=0、readFirstZstdLine=0、assertStoredIdentity=0`，只剩 `listProjectDirs=1 + listSessionDirs=19`；**暖路径 3.27 ms / 1 367 行**；冷扫描 **conc=1: 218.2 ms → conc=4: 102.5 ms（2.13×）**，且 `awaitsWork` 两臂**相等（10 936）** ⇒ **部署文件本身已满足 §十一 的 C7 判据**（注意：这是**进程内**构造实例的结果，与"宿主进程内是否新代码"无关）。 |
| 5b | **C4 会因会话持续创建而误报** | 已修正并分类 | 首版把"宿主下发了、我的冷扫描没看到"直接判 FAIL —— 实测确实出现 1 个此类 id（会话在我扫描之后才落盘）。已改为最多 4 轮重试并把差异**分类**：`identityFieldMismatches`（真错配，FAIL）vs `id-set drift only`（两次取样之间目录集合在动，PASS）。修正后实测 **`classification: "clean round"`，rounds=1**，100 顶层 == 100，0 错配。 |
| 6 | **补丁脚本两个真 bug（上轮由端到端测试发现，已修）** | 已修正 | ① `--rollback` 曾按 `--root` **重算**目标而非用记录路径（默认 root 下会把别的树的备份覆盖到 live 产品文件）；② 两单元备份曾**同名同目录**（后者静默覆盖前者）。二者均在包树副本上暴露并修复；本轮在**新的 4 单元模型**下重新全量验证通过（§7.2）。 |
| 7 | **枚举/解析缺陷（上轮）** | 已修正/标废弃 | strace `-c` 汇总行解析正则曾要求三列，**无 errors 的行被静默丢弃** ⇒ 首版 `raw/strace-hops.json` 不可用，已废弃保留。 |
| 8 | **w02 的 `persist-list-*.json` 并非"真实函数"** | 对审计的修正 | 其 `method` 字段实为 `"replica (deployed class construction failed: TypeError: self.ctx.reflect.provide is not a function)"`。本档用自返回 Proxy 修好 ctx stub（`scripts/lib-stub.mjs`），**首次**用真实类取数。结论方向不变（实测 137–197 ms，同量级）。 |
| 9 | **`createdAt` 不在 wire 行上** | 对审计验收口径的修正 | 真实行键 = `sessionId/updatedAt/running/blank/parentSessionId/origin/cwd/agentPreset/projections[/runningSubagentCount]`。验收脚本已改为实际在线字段 + 以 `sessionId` 为键。 |
| 10 | **投影键集"逐行一致"不成立** | 对审计口径的修正 | 实测 **3 种**键集、**16 行**投影块为空（设计上 fail-soft）。断言改为"键 ⊂ 13 个已注册单元 + 逐行键集跨取样稳定"。 |
| 11 | **memo 命中不再逐目录做 opposite-compression 检查** | 已接受的窄口径差异 | 根级同一检查本来就是"每实例一次"（`ensureRootEncoding` 的 `??=`），本改动只是让两者口径一致。代码中不存在产生该情形的路径。 |
| 12 | **未做 single-flight（Promise 共享）** | 明确的设计取舍 | 共享 in-flight Promise 会把某个调用者的 abort **传染**给其他调用者，违反 U-HR2 的每调用者取消语义。代价：memo 尚冷的并发突发仍各自全扫一次（等于今日行为），首个调用完成即转热。**测并发矩阵前必须先预热**（`verify-postdeploy.mjs` 已内置）。 |
| 13 | **事件循环轮次代理 v1 不可靠** | 已标注 | v1 硬编码 fd 与 eventfd 计数值；libuv 计数会累加、fd 会复用 ⇒ 跨模块比较不可靠。v1 数字保留但标为"仅同运行内可比"；结论改由 §5.2 的墙钟剂量-响应独立支撑。 |
| 14 | 未测 | 诚实记录 | (i) 宿主侧实测（未重启）；(ii) 客户端消费 505 KB 的渲染成本（w08 同一空缺）；(iii) `__DSH_SUBAGENT_LIST_MAX=1` 的宿主对照跑。 |

---

## 十、需协调者裁决的三项

1. **U-HR2 实为 2 处（路由表 + handler）**，只落 handler 是死代码。本档已按 2 处落地并部署；若坚持 1 行形态请明示（但那样修复无效）。
2. **并发矩阵判据需校准**（本轮已取得**实测反证**，见 §九.3）：修复前在拥塞宿主上"4 路/单发 = **1.14×** ⇒ PASS"而绝对量是 **15.4 s**。
   建议把主判据改为**绝对量为主**：`4 路并发 p50 ≤ 150 ms`、`4 路并发 max ≤ 300 ms`，比值与 loadavg/浏览器数**照报用于解释**。
   `verify-postdeploy.mjs` 的 C2 detail 已同时给出 `singleBaselineP50 / concurrentP50 / ratio / concurrentMax`，两种口径都能判。
3. **U-HR3 的口径**：本档已落地并证明"冻结输入下逐行等值"，唯一差异是 subagent 行的 `updatedAt/blank/lastPromptAt`
   取自"请求开始时刻"（修复前排序键与显示值可取不同时刻）。若协调者要求**逐字节与 pre-image 完全一致**，
   需回退 U-HR3（`--rollback all` 后 `--apply --skip U-HR3`），代价是重会话每请求多 ~16.8 ms 折叠。

---

## 十一、同档自复核

### 11.1 逐条对照硬性验收

| # | 验收 | 结果 | 证据 |
|---|---|---|---|
| 1 | **主判据 = 并发矩阵**（4 路 ≤ 单发×1.2）；单发 p50 ≤150 ms ×20 | **宿主侧 INVALID（未重启）**；离线机制证据充足 | 离线：4 路并发结果**逐字节等于**冷参考；memo 路径并发 await = **80**（4×20）vs 基线 **43 472**。比值口径问题见 §九.3/§十.2 |
| 2 | **集合等式**逐行等值（含全部投影键） | **PASS** | 三对比较全等（第 1 次尝试、目录集合稳定）；宿主侧 `C4` 亦 PASS（1358 == 1358） |
| 2b | **新建会话立即出现** | **PASS** | `raw/counterfactual.json` A1+A2（不做负缓存 + 发布后立即出现且 == 冷扫）+ B–F |
| 3 | **取消传播反事实** | **已实现、已强化；宿主侧 INVALID** | 代码链逐环复核并修好两个断点；C3 已改为 3 路并发 abort 且记录判别力 |
| 4 | **回归**：header 数 == 真实目录数；标记行保留 | **PASS** | 离线 **1 356 == 1 356**；宿主 `C5` **1358 == 1358**；B1=5 / B1-perf=1 **行数与字节全未变** |
| 5 | 既有补丁原样保留 + 锚点/标记核对 | **PASS** | 候选 diff 仅 6 hunk；`C6` 已把 6 个 marker 计数写成断言并在部署文件上 PASS |
| 6 | 补丁脚本 7 项要求 | **PASS（端到端实测）** | §7.2：dry-run / 幂等 / 跨文件 all-or-nothing / PARTIAL 拒绝 / 分文件回滚 / pre-image 校验 / `node --check` 闸门全部实测 |
| 7 | 测量纪律：标注并发条件、同窗配对、禁用单点 TTFB | **PASS（自评）** | 每个 JSON 带 `loadavg` + 浏览器数；A/B 用**交替/轮转顺序**；比较前做**目录集合漂移控制**；strace 只取计数不取延迟；并发比值采用**保守基线**；并发跑标 `concurrentWith=` |
| 追加 ① | 上限只挡行不挡扫描 | **PASS** | memo 缓存扫描结果本身；1 356 扫描 / 200 下发 = 85.3% 被扫不下发（§6.1） |
| 追加 ② | 有界并发 IO，判据用跳数 | **PASS（相对）；绝对目标未达，理由见 §5.3** | 8.94 → **2.25/目录**（≤3.0 达标）；墙钟 197.0 → **69.2 ms**；工作不变性断言通过 |
| 追加 ③ | 跳数断言 + 反事实证明上限生效 | **PASS（跳数）** | memo 命中 0 per-session IO（§6.2）；上限反事实见 §6.1 |
| 追加 ④ | F1/F2 必须同批 | **确认正确，已同批** | §三 末 |

### 11.2 停止条件核对

| 停止条件 | 触发？ |
|---|---|
| header 不可变前提无法复核 | **未触发** —— 通过，且比审计更完整（含 `repair`/`rollbackAppend` 两条此前未覆盖的截断路径） |
| 集合等式不成立 | **未触发** —— 逐字节成立（离线真根 1 356 行 + 反事实 8/8 + 宿主 C4） |
| 任一既有补丁标记受影响 | **未触发** —— 6 个 marker 计数逐项断言通过，diff 仅 6 hunk |

### 11.3 自裁决

> **PASS（附 3 项条件）**
> ① U-HR2 按 2 处落地（已部署）；
> ② 并发矩阵判据按 §十.2 校准后再判 PASS/FAIL（本轮已给出"比值判据会误判通过"的实测反证）；
> ③ 宿主侧四项（单发 p50、并发矩阵、abort 反事实、部署文件上的跳数断言 C7）**只能重启后测**，
>    本轮全部 INVALID，**不得据此宣称宿主修复达标**。
>
> 附加：本轮已取得**重启前基线**（`raw/verify-prerestart.json` 最终版）：
> 单发 p50 **3 871 ms**（另两次分别 12 960 / 32 780 ms）、4 路并发 p50 **29 260 ms**、比值 2.28；
> `C4 = clean round`、`C5 1367==1367`、`C6` 六项 marker 全中、`C7` 在**部署文件本体**上 memo 命中 0 per-session IO
> 且冷扫描 conc1→conc4 = 218.2→102.5 ms（工作不变）、`C3` 判别力成立（3/3 在飞，abort 后瞬态 4.38 ms、1 s 后 1.65 ms）。
> 全为旧代码（未重启）口径，重启后同窗口可直接对照。
>
> **验收脚本本身已端到端跑通并修正三处自身缺陷**（C4 漂移分类 / C7 惰性字段误判 / C3 判别力断言）——
> 上一轮因探针锁被 6+ 条兄弟线连续占用而未能验证，本轮按协调者授权并发运行并标注 `concurrentWith=`。
> 端到端跑通的价值在本轮直接兑现：**三个缺陷都是"第一次真跑"才暴露的**。

---

## 十二、原始证据索引与复现

| 文件 | 内容 | 有效性 |
|---|---|---|
| `raw/deployment-state.json` | 部署事实（哈希/mtime/宿主未重启）+ 证据口径影响清单 | 权威 |
| `raw/offline-ab.json` | 三臂 A/B：集合等式、时序、await 普查、跳数断言、row-limit、并发矩阵 | **有效**（自带 `liveSha256=8b6ebc45`=真基线） |
| `raw/scan-concurrency-sweep.json` | 6 臂剂量-响应（pre-image / HR1-only / conc 1·2·4·8）+ 工作不变性断言 | **有效** |
| `raw/hop-count.json` + `raw/hopcount/` | 受控根精确 syscall / zstd 帧读 / 轮次代理斜率 | **有效**（同运行内对照） |
| `raw/fold-dedupe.json` | U-HR3 的 P1 行等值 / P2 recency / P3 折叠计数 / P4 墙钟（10 个真实会话） | **有效** |
| `raw/counterfactual.json` | 生命周期反事实 8 步 | **有效** |
| `raw/apply-fakepkg.json` | 补丁工具端到端（写入/幂等/分文件回滚/all-or-nothing/PARTIAL） | **有效** |
| `raw/apply-staged.json`、`raw/apply-staged-hr1only.json` | 候选件生成记录（anchor 命中数、前后字节、`node --check`） | 有效 |
| `raw/verify-prerestart.json` | 重启前 live 跑（最终版）：C4 判 `clean round`、C5/C6/C7 PASS、C3 判别力成立（3/3 在飞）；C1/C2 为旧代码基线 + 并发条件 `concurrentWith=` | **重启前基线**，非验收 |
| `raw/turn-proxy.json`、`raw/hop-count-concurrency.json`、`raw/strace-hops.json` | 轮次代理 v1 / 早期并发扫描 / 解析缺陷版 | ⚠️ **仅同运行内可比 / 已废弃**（§九.1、§九.7、§九.13） |
| `raw/superseded/`（`verify-predeploy-lockbusy.json`、`apply-fakepkg-1.json` + `README.md`） | 上一轮的锁占用记录、2 单元模型的旧测试快照 | ⚠️ **不可引用**（说明见该目录 README） |

### 复现命令

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-hostrpc

# 计划与候选件
node scripts/build-plan.mjs                          # 从 pre-image 重算 plan（含逐文件累加器自检）
node scripts/build-plan.mjs --check                  # 校验现计划未漂移
node apply-HostRPC-v1.mjs                            # dry-run（默认，不写任何文件）
node apply-HostRPC-v1.mjs --apply --base preimage --stage candidates   # 只产出候选副本

# 离线证据
node scripts/offline-ab.mjs --reps 12 --concurrency 4        # 集合等式 + 跳数断言 + 时序
node scripts/scan-concurrency-sweep.mjs --reps 8             # U-HR4 剂量-响应 + 工作不变性
bash scripts/hop-count.sh                                    # 受控根精确 syscall / 轮次斜率（自建受控根）
node scripts/fold-dedupe.mjs --sessions 10                   # U-HR3 P1/P2/P3/P4
node scripts/counterfactual.mjs                              # 生命周期反事实

# 补丁工具端到端（在包树副本上，不碰 live）
#   把 pre-image 的两文件放到 tmp/fakepkg/<pkg>/lib/index.js 后：
#   node apply-HostRPC-v1.mjs --root $PWD/tmp/fakepkg --apply
#   node apply-HostRPC-v1.mjs --root $PWD/tmp/fakepkg --apply        # 幂等
#   node apply-HostRPC-v1.mjs --rollback U-HR1,U-HR4                # 分文件回滚

# 重启后（由协调者执行）
node scripts/verify-postdeploy.mjs --singles 20 --waves 5
node scripts/verify-postdeploy.mjs --singles 3 --waves 1           # 冒烟
```
