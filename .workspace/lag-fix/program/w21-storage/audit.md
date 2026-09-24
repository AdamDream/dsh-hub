# w21-storage 审计：存储层写路径形态、分片回归修复、并发队列、版本迁移与候选

- 档位：**只读审计 + 本档内复现**。全程未重启/未杀进程/未修改任何产品文件与 `~/.dsh` 文件。
- 环境（**已变更，必须据此读本报告**）：
  - 审计起点给的宿主 **PID 301709 已退出**；审计期间发生一次**冷面重启**，当前宿主为 **PID 2988915**
    （`node /home/CNS2026495165/.npm-global/bin/dsh web`，判据用 `/proc/2988915/cmdline`，非 `exe`——本环境 `readlink /proc/<pid>/exe` 对几乎所有进程返回 EACCES，团队 §五.17）。
  - 32 核；`/proc/loadavg` 全程 4.7–8.97。**并发口径按"主浏览器进程"计数**（cmdline 含 `--remote-debugging-pipe` 且不含 `--type=`），未在本档做浏览器侧测量。
  - 探针锁 `.workspace/lag-fix/lib/probe-lock.mjs`：本档全程**未持锁**（他线占用：先 `w14-residual-env` pid 860747、后 `w26-integrity` pid 3016981、`w19-slots` pid 3047219，均经 `/proc` 确认**存活**，**未回收、未删除**）。
    ⇒ 按 BATCH-PLAN §五.2，**本档所有时间窗口标注 `CONTENDED`，不开窗门禁**；频率类的**事件计数**不受污染影响（见 §1.5 对照），**绝对 ms 只作同窗比值用**（§五.7：受污染会膨胀 4.5–10.3×）。
- 产品根 `R = /home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai`。
- Node v22.23.2。文件系统：`~/.dsh` 与本档目录同 ext4 `/dev/nvme0n1p2`。
- **本档未引用** `w02` 已撤回的 "projcache 9.7 次/s ≈ +0.5 核"。
- **频率量全部用事件式仪器（inotify）**，无任何轮询口径的结论（§1.5）。

---

## 0. 一句话结论

1. **回归确证且根因在存储层布局**：`dsh-storage-json` 的写原语是**整文件重写**——`putRecord` → `publish()` →
   `serialize()`（`:79` `JSON.stringify(document, null, 2)`）→ `writeAtomic()`。真实 deployed 代码 + 真实
   11.50 MB state 下：**serialize 中位 25.95 ms**（运行时捕获 `:79` 真实调用）/ 复刻 29.28 ms、
   **端到端 putRecord 中位 52.07 ms**。
2. 🔴 **本档最重发现（推翻一条被当作前提的设计自述）**：`dsh-session-projection-cache/lib/index.js:58-62`
   自述 "**Version bumps discard the whole medium**"，**该机制不存在**。实测把 descriptor 的 `version: 3`
   改成 `4` 打开真实介质 ⇒ **抛 `StorageError code=version-mismatch`**，**介质原封不动留在盘上**
   （sha/字节数逐位不变、无删除、无改名）。全产品对 `version-mismatch` **唯一处理就是抛**（`:98`），
   无任何 dispose/migrate/upgrade 缝。README 亦自述 "**no migration, pre-release stance**"。
   ⇒ **"分片回归修复 = 域 version 3→4"这条路线不可行**；bump 版本只会让域打开失败（§4）。
3. **写路径的第二大头此前未被单独量化**：`writeAtomic` 的 `:30 handle.writeFile(data, "utf8")` 收的是
   **~11.3 MB 字符串**，UTF-8 编码发生在主线程。**单独测 `Buffer.from(json,'utf8')` 中位 11.06 ms**；
   在 writeAtomic 内以"预编码 Buffer vs 字符串"同窗交替实测 **编码 delta 6.26 ms = writeAtomic 的 32.6%**。
4. **跨 unit 互阻的机制与前提描述不同（前提需更正）**：写链在 `dsh-storage-domain/lib/index.js:109`
   的 `DomainImpl.chain` 上，**每个域一条、不是全局一条**（`DomainFacility.open` 每个域 new 一个 `DomainImpl`，`:359`）。
   实测两域两条链**互相重叠**（小写 74.9 ms 先于 11.4 MB 大写在 82.8 ms 完成）⇒ 单 unit 串行成立、
   "单条共享链 ⇒ 多 unit 互阻"**作为字面表述不成立**。真正的跨 unit 耦合是**共享主线程**：
   1 ms 心跳在只有 projcache 发布时被拉长到 **max 52.88 ms（9 次 > 20 ms）**，基线 p95 仅 1.076 ms。
5. **`dsh-storage-json` 自身不提供写序保证**（`:118-125` 自述 "Writes are NOT queued here — write ordering
   belongs to the caller"）：绕过域链并发 `putRecord`，**20 次里 7 次**盘上落到的不是最后一次写的值
   ⇒ 正确性**完全押在域链上**，且跨进程无任何保护（实测父进程 8 条记录只活下 2 条）。
6. **无淘汰机制是实证而非推断**：live 介质 **3,104 条记录** vs 盘上 **1,443 个会话目录**
   ⇒ **孤儿 1,770 条 = 57.02%**；B2 归档删掉的 **1,670** 个会话目录**盘上 0 个存活、其记录 1,670 条全在**。
   产品自述 `dsh-session-projection-cache/README.md:61` "No eviction or retention surface"。
7. **分片修复的收益已实测（候选 1）**：单条记录（中位 1,561 B）分片后 **stringify 22.94 ms → 0.003 ms（−99.987%）**、
   **序列化字节 11,496,048 → 3,570 B（−99.969%）**、**writeAtomic 11.02 → 4.06 ms（−63.2%）**；
   写放大 **21.11 MB/s → 6.6 KB/s（−99.97%）**；端到端 **52.07 → ≈4.1 ms（≈12.7×）**。
8. **有一个零风险且热的候选**：去掉 `:79` 的 `, null, 2` ⇒ 同窗交替实测 **耗时 −51.08% / 字节 −53.58%**，
   且 `parse` 走 `JSON.parse`（`:90`）**对空白不敏感** ⇒ **不改变介质 schema、不需要版本迁移、双向可回滚**。

---

## 1. 问题①：写路径形态（逐段 file:line + 实测）

### 1.1 完整写链（全部已实读）

| 段 | file:line | 内容 |
|---|---|---|
| 写触发（强制点 1） | `dsh-session-projection-cache/lib/index.js:201-203` | `event.type === "turn/end"` → **无条件** `flushSoft(session,"turn/end")`（**未 await**，浮空 promise） |
| 写触发（计数阈值） | `:211-213` | `state.pending >= config.writeEveryEvents` → `flushSoft(session,"count threshold")`（未 await） |
| 写触发（定时器） | `:214-217` | `state.timer ??= setTimeout(..., config.writeIntervalMs)` → `flushSoft(session,"interval")` |
| 写触发（强制点 2） | `:219-221` | `session/disposed` → `flushSoft(session,"detach")` + `markClean` |
| 节流记账 | `:242-250` | `markClean`：pending 归零 + `clearTimeout` |
| 写实现 | `:159-163` | `write()`：`sessionProjections.checkpoint` → `markClean` → `sessions.flush` → `put` |
| 快照 + 落库 | `:252-259` | `put()`：`snapshotJsonValue(rows)` → `requireTable().put(id,{identity,rows})` |
| 失败软化 | `:234-240` | `flushSoft`：catch → `logger.warn`（**宿主插件日志无持久出口**，见 w13 F1） |
| 域写链 | `dsh-storage-domain/lib/index.js:109` | `chain = Promise.resolve()`（**每个 DomainImpl 一条**） |
| 入队 | `:210-215` | `enqueue(job)`：`this.chain.then(job)`，`chain = result.then(noop,noop)` |
| 表 put | `:246-252` | `put(key,value)` → `enqueue` → `await unit.putRecord(...)` → 改内存 → `emitPut` |
| 域 open | `:341-373` | `DomainFacility.open`：`descriptorOf(spec)` → `backend.kv.open` → `loadAll` → zod 校验 → `new DomainImpl`（`:359`） |
| **记录写入** | `dsh-storage-json/lib/index.js:169-180` | `putRecord()`：`records.set` → `await publish()`，**失败回滚内存**（`:176-177`） |
| **publish（整文件）** | `:219-224` | `writeAtomic(this.path, serialize(this.descriptor.name, this.state))` |
| **serialize** | `:68-80` | `:70 Object.fromEntries(records)`；**`:79` `` `${JSON.stringify(document,null,2)}\n` ``** |
| **writeAtomic** | `:25-41` | `:28 open(tmp,"wx",384)` → `:30 handle.writeFile(data,"utf8")` → **`:31 handle.sync()`** → `:33 close` → **`:35 rename`** → **`:36 fsyncDirectory`**；`:37-40` 仅 catch 时 `rm(tmp,{force:true})` |
| 目录 fsync | `:44-52` | POSIX 打开目录再 `sync()` |
| 常驻 state | `:149` | `this.state`（全量 Map，进程常驻） |
| 单元不自排队 | `:118-125` | **doc 自述**："Writes are NOT queued here — write ordering belongs to the caller" |
| 后端无写队列 | `:241-275` | `JsonStorageBackend` 只有 `open`/`opening` 簿记 + `:243-244`；**无队列** |
| 组合配置 | `dsh-web-app/cordis.patch.yml:51-57` | `storage` / `storage-json`（`root: dshHomePath('storages')`） |
| 路由 | `:59-62` | `storage-domain`：`backend: json`，**未配 `routes`** ⇒ 三个域全部落 json 后端 |
| 节流实际生效值 | `:76-80` | `writeEveryEvents: 200` / `writeIntervalMs: 5000`（`:79-80`） |

**三个 unit（`~/.dsh/storages/`，全部实读）**：

| unit 文件 | 域 name / version | tables | hasGlobal | 声明处 | 大小 |
|---|---|---|---|---|---|
| `session_projcache.json` | `session_projcache` / **3** | `sessions` | 否 | `dsh-session-projection-cache/lib/index.js:58-62` | 11,495,047 B |
| `workspace.json` | `workspace` / **2** | `workspaces` | 是 | `dsh-workspace/lib/index.js:224-235` | 11,382 B |
| `message_feedback.json` | `message_feedback` / **0** | `sessions` | 否 | `dsh-message-feedback/lib/index.js:70-73` | 639 B |

配置生效性：`~/.dsh/settings.yaml` 无 `projcache`/`writeEveryEvents`/`writeIntervalMs`/`storage` 字样；
`backend: json` 后**无 `routes`** ⇒ 无 per-domain 覆写。

**`global` 槽位的实际语义（分片布局必须保留）**：`serialize:76` **无条件**写 `global: this.state.global`，
无 global 的 unit 因此把 `"global": null` 落到盘上。实测三份介质**都**含 `global` 键：
`workspace` 是真对象（`workspaceDomainSpec` 真的声明了 global：`dsh-workspace/lib/index.js:224-233`，
`schema: workspaceDomainState` / `initial: {initialized:false, workspaceIds:[], archivedSessionIds:[]}`，
盘上 11 条 `workspaces` 记录 + 真 global 状态）；
而 `session_projcache` / `message_feedback` **未声明 global**（`dsh-session-projection-cache/lib/index.js:58-62`、
`dsh-message-feedback/lib/index.js:70-73`），盘上那个键是 **`null`**。
`parse:102` 读回 `globalValue ?? null`，`dsh-storage-domain/lib/index.js:358` 把 `null` 当"从未写过"的哨兵
（这正是 `defineDomain:65` 强制"global schema 不得接受 null"的原因）。
⇒ **分片布局与任何迁移都必须保持这个 `null = never written` 哨兵**，否则 `workspace` 的
`initialized/workspaceIds/archivedSessionIds` 会被静默重置为 `initial`（`defineDomain:54-57` 已警告该失效模式）。

> ⚠️ **记录数是活体移动值**：本档孤儿统计那一刻读到 **3,104** 条，几分钟后另一处读到 **3,108** 条
> （`global` 校验时）。所有"记录数/孤儿数/占比"应视为**该时刻快照**，不是常量。

### 1.2 分段实测（真实 deployed 模块 + 真实 11.46–11.50 MB state，n=15/25，`CONTENDED`）

`raw/main-writepath.json`（源 `session_projcache.json` 11,464,430 B / md5 `efa98106…`，3,098 条记录 / 42,186 行）：

| 量 | median | p95 | max | 备注 |
|---|---|---|---|---|
| `serialize` **真实捕获**（`:79` 的 `JSON.stringify(x,null,2)`） | **25.945 ms** | 30.918 | 32.032 | 运行时包裹 `JSON.stringify` 抓 `:79` 那一次真实调用 |
| `serialize` **忠实复刻**（含 `:70`） | 29.280 ms | 33.922 | 57.198 | 两条独立取得路径互相印证 |
| `:70 Object.fromEntries(records)` 单独 | 0.711 ms | 1.996 | 2.068 | 只占 serialize 的 2.4% |
| **UTF-8 编码**（`Buffer.from(json,'utf8)`，冷串） | **11.061 ms** | 12.589 | 12.756 | 对应 `:30` 的 `writeFile(string,"utf8")` 内部那一步 |
| 端到端 `putRecord` | **52.067 ms** | 63.067 | 65.980 | |
| 常驻内存：load 增量（heapUsed） | **+50.53 MB** | — | — | 3 次重复 **50.54/50.53/50.53** |
| 常驻内存：load 增量（RSS） | **+44 MB** | — | — | 3 次 42.75/44/49 |
| 单元 open（readFile + parse） | 45.5 ms | — | — | `openMs` |

**`writeAtomic` 四阶段（同 payload，字符串 vs 预编码 Buffer 同窗交替，n=25）** —— `raw/main-fixcost.json`：

| 阶段 | median ms | 占 total |
|---|---|---|
| `:28` open tmp | 0.060 | 0.3% |
| **`:30` writeFile（字符串，含 utf8 编码）** | **10.884** | **56.7%** |
| **`:31` 文件 fsync** | **4.538** | 23.7% |
| `:33` close | 0.047 | 0.2% |
| `:35` rename | 1.077 | 5.6% |
| **`:36`+`:44-52` 目录 fsync** | **2.698** | 14.1% |
| **total（字符串 payload）** | **19.184** | 100% |
| total（**预编码 Buffer** payload） | **12.926** | — |
| **⇒ UTF-8 编码 delta** | **6.258** | **32.6%** |
| ⇒ fsync 合计（文件+目录） | **7.236** | **37.7%** |

**编码成本的两种口径（都报，不混用）**：冷串单独测 **11.061 ms**；在 writeAtomic 序列里以"字符串 vs 预编码 Buffer"同窗交替得 delta **6.258 ms**（该序列复用同一字符串，V8 可能复用已编码表示 ⇒ **6.258 是下限，11.061 更接近真实单次新增成本**）。

**端到端拆解**：`putRecord 52.067 ≈ serialize 25.945 + writeAtomic 19.184 + fromEntries 0.711 + 队列/微任务 ≈ 6.2 ms`。**serialize 占端到端的 49.8%**，与 sa2 的 49.3% 一致。

### 1.3 事件循环停顿（避开团队两条已知陷阱）

方法：每相位**新建** histogram，**全程不调用 `reset()`**；阻塞后 `await sleep(300)` 让内部定时器回调在**宏任务**阶段落库后再读 `h.max`。`raw/main-writepath.json.eld`：

| 相位 | wall ms | **ELD max ms** | mean | p99 |
|---|---|---|---|---|
| 阴性对照（仅 sleep 250） | 249.9 | **10.20** | 10.07 | 10.13 |
| **阳性对照（注入 200 ms 同步忙等）** | 200.1 | **208.40** | 12.98 | 10.10 |
| 真实 1× `putRecord` | 66.6 | **44.01** | 10.58 | 12.94 |
| 真实 3× `putRecord` | 184.9 | **45.22** | 11.34 | 39.78 |
| 5× 同 tick 连续同步 serialize | 142.3 | **151.52** | 12.14 | 10.08 |

⇒ **通道自证有效**（阳性 208.40 对注入 200；阴性 10.20）；**单次真实 `putRecord` 阻塞主线程 44.01 ms**；
同 tick 多次 serialize **累加**到 151.52 ms。

**第二条独立口径（心跳法，`raw/main-concurrency.json`）**：1 ms `setInterval` 心跳，基线 p95 **1.076 ms / max 1.453 ms**；
8 次 projcache 发布期间 p95 **32.711 ms**、**max 52.882 ms**、**9 次间隔 > 20 ms**。
⇒ 两条独立口径分别给出 **44.0 ms** 与 **52.9 ms** 的不可打断停顿，与本档起点给的 "32.5 ms p50 / 42.5 ms p95" 同阶且**互证**。

### 1.4 端到端 vs 纯 writeAtomic 的差（为什么"写盘"不是瓶颈）

sa2 报"写盘 27.09 ms"（= e2e − stringify）而 §1.2 的 writeAtomic 只有 19.18 ms，差来自
**真实 `serialize` 返回的是字符串**，`:30` 的 `writeFile(data,"utf8")` 还要在**主线程**做一次
~11 MB 的 UTF-8 编码（本档新量化的 6.26–11.06 ms）。**这一项此前未被单独列出，是"同步段"里被漏掉的一块。**

### 1.5 频率与写放大（✅ 事件式仪器 inotify；**无轮询口径结论**）

`raw/main-freq.json`。仪器：本机**无** `inotifywait`/`inotifywatch`/python `pyinotify`（已逐一确认）
⇒ 唯一事件通道是 Node `fs.watch`（libuv 的 inotify 绑定）。

**通道自证（PASS）**：建 watcher 前 `/proc/self/fd` 无 inotify，建 watcher 后出现 **fd 20 → `anon_inode:inotify`**
⇒ 确认走 inotify，非 fallback。
**阳性对照（PASS）**：在受控目录做 **20 次真实 `writeAtomic` 等价发布** ⇒ 目标文件名上**恰好 20 个 `rename` 事件**
（`eventPerPublish = 1.000`）⇒ 计数口径 1:1，无重复计数。
**阴性对照（FAILED —— 必须如实记录）**：空闲 20 s 内**目标文件仍有 24 个事件**、目录内共 632 个事件
⇒ **"机器安静"的门禁不成立**，本档窗口一律标 `CONTENDED`。
（该结果本身是**外部写入者活跃**的证据，不是仪器故障——同期本档探针未写 `~/.dsh`。）

**主窗（240.000 s）**：

| 文件 | `rename` 事件 | 次/秒 | 字节（窗末） | 写放大 |
|---|---|---|---|---|
| **`session_projcache.json`** | **442** | **1.8417** | 11,460,774 | **21.11 MB/s** |
| `workspace.json` | **0** | 0 | 11,382 | 0 |
| `message_feedback.json` | **0** | 0 | 639 | 0 |

**同窗双计数互证（不重复计数）**：同窗内**新出现的 `.tmp` 名字 443 个**（=`open(tmp,"wx")` 次数），
与目标文件 `rename` 事件 **442** 吻合（+1 为窗边界）。两条独立计数**逐个数一致**（442 vs 443）。

**到达间隔分布（ms）**：min **49.1**、p25 59.0、**median 68.9**、p75 111.5、p95 **1812.7**、max **20102.3**
⇒ **成簇突发**（活跃段密集到 ~15–20 次/s，静默段最长 20.1 s 无写）。
**tmp 文件副作用规模**：11,056 个事件（`change` 10,172 + `rename` 884）落在 443 个 tmp 名字上
⇒ 每次发布的 11.5 MB 数据写入在 inotify 面上还会额外产生 ~23 个 `change` 事件。

**⚠️ 与起点给定数字的差异（必须记录）**：起点给 **0.870 次/s**，本档实测 **1.8417 次/s（2.12×）**。
差异与宿主重启+当前负载（本波 100 条线的子代理会话数）一致；**本档不据此否定旧数字，只报趋势**。
**由频率换算的主线程占用**（同步段 = serialize 25.945 + 编码 6.258…11.061 = **32.2…37.0 ms**）：

| 频率来源 | 同步段 | 占用单核 |
|---|---|---|
| 起点 0.870 次/s | 32.5 ms | **2.83%** |
| 起点 0.870 次/s | 43.8 ms | **3.81%** |
| **本档 1.8417 次/s** | 32.2 ms | **5.93%** |
| **本档 1.8417 次/s** | 37.0 ms | **6.81%** |

⇒ 起点给的 **2.83–3.81%** 与 **0.870 次/s** 自洽；**同一模型在 1.8417 次/s 下给出 5.9–6.8%**。两者不矛盾，是同一公式的不同频率代入。

### 1.6 pretty vs compact（同窗交替，n=25，`raw/main-fixcost.json` + `raw/main-writepath.json`）

| 量 | pretty `(x,null,2)` | compact `(x)` | 比值 |
|---|---|---|---|
| 耗时 median | 22.938 ms | 11.968 ms | **0.5218**（省 **47.8%**） |
| 耗时 median（`main-writepath`，另一窗口） | 26.369 ms | 12.899 ms | **0.4892**（省 **51.08%**） |
| 字节 | 11,496,048 | 5,337,219 | **0.4643**（省 **53.57%**） |

两窗口耗时节省 47.8% / 51.1%（**保守取 47.8%**），字节节省 **53.57%**。
与 sa2（−47.0% / −54.2%）与 w03-m1（−38.7% / −53.5%）**方向与量级一致**。
⇒ 兼容性：`parse` 用 `JSON.parse`（`:90`）**对空白不敏感** ⇒ **去掉缩进不改变介质 schema**（§5 候选 2 的关键）。

---

## 2. 问题②：分片回归修复的完整方案

### 2.1 回归的实物与判定（三条独立证据）

1. **上游 diff**（路径更正：在 `.workspace/workstreams/`，**不在** `.workspace/lag-fix/workstreams/`）：
   `/home/CNS2026495165/dsh/.workspace/workstreams/upstream-015-diff/pkgs/dsh-session-projection-cache.libjs.diff`
   —— spec 的 doc 注释从
   `"the json backend stores the domain `per-record`: one document per session under <root>/session_projcache/sessions/, so a checkpoint write rewrites one session's document instead of the whole unit"`
   **改成**
   `"the json backend lands it at <root>/session_projcache.json, beside workspace.json"`。
2. **旧布局实物**：`backup/B2/20260920-074510/legacy-projcache-tree.tar`（6,123,520 B）实测 **1,597 个分片 + 2 个目录 = 1,599 条目**；
   路径形态 `session_projcache/sessions/<uuid>.json`；
   分片字节 **min 2,210 / p25 2,832 / median 2,894 / p75 3,284 / p95 4,091 / max 5,468 / mean 3,091.79 / 合计 4,937,595 B**。
3. **现盘旧目录已成空壳**：`~/.dsh/storages/session_projcache/` 存在但**空**（`sessions/` 不存在）⇒ 迁移已完成、旧代码路径废弃。

### 2.2 🔴 修复路线的前提被证伪：不能靠 bump version

见 §4.2（决定性的 T2 实测）。**结论："域 version 3→4 ⇒ 介质被整体丢弃"这条语义不存在。**
设计自述 `dsh-session-projection-cache/lib/index.js:58-62` 为**与实现不符的注释**。

### 2.3 修复方案（推荐形态：**在 `dsh-storage-json` 后端加"分片 unit"能力，而非改域版本**）

**(P1) 后端加 per-record 分片布局（opt-in，按 unit 声明）**
- 改动点：`dsh-storage-json/lib/index.js:257-269 openUnit()` 与 `:219-224 publish()`。
  增加 `descriptor` 的可选字段（如 `layout: "sharded"`），由 `descriptorOf()`（`dsh-storage-domain/lib/index.js:73-80`）
  从 spec 投影；unit 路径从 `<root>/<name>.json` 变为 `<root>/<name>/<table>/<key>.json`
  （**与旧布局 `session_projcache/sessions/<id>.json` 完全同形**，便于旧介质对读）。
- `publish()` 在分片模式下只序列化/写 **变更的那一条记录**（保存 `dirty: Set<[table,key]>`），
  而不是 `serialize(this.descriptor.name, this.state)` 全量。
- **实测收益**：见 §5 候选 1。
- **风险**：`putRecord` 的失败回滚（`:175-179`）语义需保持；多文件发布不再原子（**一次调用可能写多个分片**）
  ⇒ 需明确"单次调用只写一个分片"（`putRecord`/`deleteRecord`/`setGlobal` 天然如此），
  这样"每次调用原子且持久"（README:11）**仍然成立**。
- **热/冷面**：**冷面**（新增磁盘布局与路径解析，需重启；且涉及是否复用旧 `session_projcache/` 目录）。

**(P2) 旧介质处理（三条路，各有代价，须裁决）**

| 方案 | 做法 | 数据后果 | 代价 |
|---|---|---|---|
| **A. 沿用现有单文件**（零迁移） | spec 加 `layout:"sharded"`，但**首次打开时若发现 `<root>/<name>.json` 存在就按老单文件读**，之后写仍落单文件 | **不丢** | 该 unit **永远拿不到分片收益**（除非另做一次性搬迁） |
| **B. 一次性搬迁（推荐）** | 打开时若 `<name>.json` 存在且 `<name>/` 不存在 ⇒ 读出全量 state，**逐条写为分片**，全部成功后再把 `<name>.json` **改名**为 `<name>.json.migrated-<ts>`（**不删除**） | **不丢**（旧文件保留为回滚点） | 需要**显式迁移代码**（当前**无**任何迁移缝，见 §4.4）；约 3,104 次小写入 |
| **C. 丢弃重建** | 直接改用分片并忽略旧单文件 | **projcache 是缓存 ⇒ 语义上"只多花一次冷读尾重放"，不丢用户数据**；但 `workspace`/`message_feedback` **不可以**这样处理（§4.3） | 最少代码；需确认冷读尾重放成本可接受 |

> ⚠️ **B 的迁移必须自己写**：域/后端契约**没有** `migrate`/`upgrade`/`onVersionMismatch` 缝（§4.4 实测 grep 零命中）。
> 也因此**迁移不应挂在 version 上**，而应挂在"布局声明 + 介质探测"上（这正是 P1 用 `layout` 字段而非 bump version 的原因）。

**(P3) 孤儿回收（这是本题最大的**免费**收益，且与分片正交）**
- 现状（本档实测，`raw/main-orphan.json`）：记录 **3,104** 条 vs 盘上会话目录 **1,443** 个
  （19 个 project 目录 × 每目录下会话；**101 个 `session-*` + 1,342 个裸 UUID**）
  ⇒ **孤儿 1,770 条 = 57.02%**，覆盖率 42.98%；**109 个盘上会话无记录**（写后置的滞后，非缺陷）。
- **强实证**：`deletable-dirs.list` **1,670** 行，逐行 `test -d` ⇒ **stillExist = 0**；
  这 1,670 个 id 里 **recordsStillPresent = 1,670**（**全部仍在介质里**）。
- 代码：`deleteRecord`（`dsh-storage-json/lib/index.js:181-191`）与域 `delete`（`dsh-storage-domain/lib/index.js:253-266`）
  **对 projcache 均无调用者**（全产品 grep：唯一命中是定义点本身，另一处 `dsh-llm-pi-ai:1903` 是**凭据存储**的同名方法，无关）。
  产品自述 `dsh-session-projection-cache/README.md:61`："**No eviction or retention surface**"。
- **回收设计（建议）**：在 `dsh-session-projection-cache` 内加一个**低频（如启动后一次 + 每 N 小时）**的 GC：
  以 `persistence.list()` 的现存会话 id 集合为保留集，对 `record` 里不在集合中的 id 调 `table.delete(id)`
  （**注意**：`table.delete` 目前在 projcache 里是**死代码**，启用前需验证其失败语义 —— `:253-266` 是**先写介质后改内存**，失败会抛出且**内存不变**，语义正确）。
- **风险**：误删。缓解：① 只删"盘上确无日志目录"且"记录 `identity.createdAt` 早于某水位"的 id；
  ② GC 只在**无并发写**的窗口跑（或经域链入队，天然串行）；③ 首次运行**只报告不删除**（dry-run 落日志）。
- **收益**：分片布局下每条记录是一个文件 ⇒ 1,770 条孤儿 = **1,770 个文件**；
  分片后磁盘占用 ≈ 3,104 × ~3.6 KB ≈ 11 MB，回收后 ≈ **1,334 × 3.6 KB ≈ 4.8 MB（−57%）**；
  更关键的是**打开时的 parse 量减少 57%**（open 45.5 ms → ~20 ms）与内存 50.5 MB → ~22 MB。
- **热/冷面**：可做成**热面**（纯运行时行为，域已打开；但若与分片一起落则同批冷面）。

**(P4) 崩溃安全（现状实测，`raw/main-migrate.json` T4）**
- 实测：子进程写 8,388,608 B 到 tmp 后 `SIGKILL` ⇒ **tmp 文件留在盘上**（`.5c1b8036-….tmp`，8 MiB），
  目标文件**不存在**（未 rename）。`rm(tmp,{force:true})` 只在 `:37-40` 的 **catch** 里 ⇒ **崩溃（SIGKILL/panic/断电）跳过清理**。
- **崩溃窗口逐段判定（依据 `:28-36` 的真实顺序）**：

| 崩溃时点 | 介质状态 | 是否丢数据 |
|---|---|---|
| (a) tmp 写入中 / 写完后、`:31` fsync 前 | 目标文件=**旧完整版本**；盘上多一个**孤儿 tmp** | **不丢**（旧版本完好），但**留垃圾** |
| (b) `:31` fsync 后、`:35` rename 前 | 同上（tmp 已持久但未上位） | **不丢** |
| (c) `:35` rename 后、`:36` 目录 fsync 前 | 目标文件=**新完整版本**；但目录项可能未持久 | **极端断电下可能回退到旧版本**（rename 非 crash-durable）⇒ 丢**最新一次**写，不损坏文件 |

- **live 目录的孤儿 tmp 实测（必须如实区分）**：三次采样各见到 **1 个** tmp
  （15:15 见 2,621,440 B；18:32 见 4,194,304 B；18:38 见 6,815,744 B；18:41 见 6,815,744 B），
  但**先前见到的两个名字随后都消失了**（`.99cb4f54-…`、`.2e3a2f05-…`）⇒ **它们是"在飞"的 tmp（进行中的一次发布），不是孤儿积累**。
  **⇒ 结论：孤儿 tmp 的机制已实测确证（T4），但在 `~/.dsh/storages/` 上跨 3h23m 未观测到孤儿积累。**
  分片布局会把这一风险**从 1 个/发布 变成 1 个/发布（但文件小 3 个数量级）**，且可用"启动时清理 mtime 超阈值且无对应目标名的 `.<uuid>.tmp`"作为配套。

**(P5) 是否需要 compact（压缩）？**
- **不需要引入通用 compaction**。分片后每个文件是**自包含的整条记录**（`:52-56` "whole-value discipline"），
  天然没有"追加日志+墓碑"式的碎片。孤儿回收（P3）就是唯一需要的"压缩"。
- 若仍走单文件路线，则 **compact（去掉 `, null, 2`）是唯一可行的"压缩"**（§5 候选 2），
  但它只是把 11.5 MB 降到 5.3 MB，**不解决"每次写一条要重写全量"这个根因**。

---

## 3. 问题③：并发写与队列（**前提需更正**）

### 3.1 前提的字面表述与代码事实不符

起点给的因果是"**单条 promise 链串行 ⇒ 多 unit 互阻**"。代码事实：

- 链是 `DomainImpl.chain`（`dsh-storage-domain/lib/index.js:109`），**构造在实例上**；
  `DomainFacility.open` 对**每个域** `new DomainImpl(...)`（`:359`）并放进 `this.domains`（`:363`）。
  ⇒ **每个 unit 一条链，没有全局链**。`JsonStorageBackend`（`dsh-storage-json/lib/index.js:241-275`）与
  `JsonKvUnit`（`:118-125` 自述）都**不排队**。
- 实测（`raw/main-concurrency.json` T1）：同 tick 派发"11.4 MB 域写"与"极小域写"，
  两条链**互相重叠**——小写 **74.9 ms** 完成时大写**仍在跑**（82.8 ms）⇒ 若是一条共享链，小写必须**等大写彻底结束**才能开始。
  （注意：两者只差 7.9 ms，**恰好说明真正的瓶颈不是链而是主线程**。）

### 3.2 真正的跨 unit 耦合 = 共享主线程（已量化）

`serialize(...)` 是 `publish()`（`:220`）的**同步实参**，在任何 `await` 之前于**主线程**执行；
`:30` 的 `writeFile(string,"utf8")` 也在主线程做 ~11 MB 编码。实测（`raw/main-concurrency.json` T2）：

| 量 | 基线（无写） | projcache 发布期间 |
|---|---|---|
| 1 ms 心跳间隔 median | 1.061 ms | 1.058 ms |
| 1 ms 心跳间隔 **p95** | **1.076 ms** | **32.711 ms** |
| 1 ms 心跳间隔 **max** | **1.453 ms** | **52.882 ms** |
| 间隔 > 20 ms 的次数 | 0 | **9** |

⇒ **跨 unit 互阻成立，但机制是共享主线程**：任何 unit 的 timer/RPC 回调在 projcache 发布窗口内被推迟最多 **52.9 ms**。
（与 `raw/main-writepath.json` 的 ELD max **44.01 ms** 互证。）

**第二种（未单独量化的）耦合**：三个 unit 的 fs 操作共享 **libuv 线程池（默认 4 线程）**（`UV_THREADPOOL_SIZE` 未设）。
本档**只做静态论断，未量化线程池饱和度** ⇒ 标 **INCONCLUSIVE（未测）**。

### 3.3 `dsh-storage-json` 不提供写序保证（潜在缺陷，已实测）

`:118-125` 的 doc 自述 "Writes are NOT queued here — write ordering belongs to the caller (the domain layer's write chain)"。
绕过域链、在 unit 层并发发两次 `putRecord`（`raw/main-concurrency.json` T3）：

- **20 次试验里 7 次**盘上最终值**不是最后一次写的值**（`{"n":1}` 覆盖了 `{"n":2}` 的意图）
  ⇒ 整文件 `rename` 的顺序在无调用方串行时**不保证**。

⇒ **正确性当前 100% 押在域链上**。这不是当前 live 缺陷（域链确实在用），但是
**"把 unit 直接暴露给第二个调用方"或"新增并行写路径"时会立刻变成数据丢失**的潜在缺陷，修分片布局时必须保留该契约。

### 3.4 浮空 promise（未 await 的写）

`installWritePath` 的四处触发（`:202`、`:212`、`:216`、`:220`）**全部未 `await`** `flushSoft(...)`
⇒ 同一时刻可有多个会话的写在飞，全部挤到同一条域链上。
**这放大了链长**（一条 `turn/end` 脉冲若跨多个会话，会产生 N 次全量重写排队）。
⇒ 这是 §5 候选 3（合并发布）的直接依据。

---

## 4. 问题④：版本迁移与向后兼容

### 4.1 版本字段的归属

`version` 是**每个 unit（域）自己的**，不是全局、也不是按后端：
- 声明在 spec：`defineDomain({name, version, tables})`（`dsh-storage-domain/lib/index.js:61-67`），
  校验为非负整数（`:63`）；
- 投影进 descriptor：`descriptorOf()`（`:73-80`）；
- 落盘为**介质头部**：`serialize` 写 `unit:{name, version}`（`dsh-storage-json/lib/index.js:71-78`）；
- 打开时**严格相等**才通过：`parse` 的 `:98`
  `if (version !== descriptor.version) throw new StorageError("version-mismatch", ...)`。
- 后端是**无状态转发**：`JsonStorageBackend`（`:241-275`）不感知 version 语义。

三个域的版本：`session_projcache` **3** / `workspace` **2** / `message_feedback` **0**（各自 file:line 见 §1.1 表）。

### 4.2 🔴 决定性实测：bump version **不会**丢弃介质（T2）

`raw/main-migrate.json.T2_v4_descriptor_version_bump`（真实介质副本，只动本档目录）：

| 观测量 | 结果 |
|---|---|
| descriptor（version=4）打开 | **抛错**：`StorageError` / `code = "version-mismatch"` / `unit 'session_projcache': stored version 3 != expected 4` |
| 介质**打开前** | exists=true，sha256 `898790de…`，11,484,375 B |
| 介质**打开后** | exists=true，sha256 `898790de…`（**逐位不变**），11,484,375 B |
| `disposedOrDeleted` | **false**（无删除、无改名、无重建） |
| 目录清单前后 | 同为 `["session_projcache.json"]`（无新增/无遗留） |
| 对照（T1，version=3） | **PASS**：正常打开，3,103 条记录，`loadMs 54.4`，文件 sha 不变 |

⇒ **`dsh-session-projection-cache/lib/index.js:58-62` 的 "Version bumps discard the whole medium" 是 FALSE（未实现）**。
全产品对 `version-mismatch` 的**唯一处理就是抛**（`dsh-storage-json/lib/index.js:98`）；
`dsh-storage-domain/lib/index.js:11`/`:330` 明确记载该码"pass through"。
`dsh-storage-json/README.md:12` 自述："**no migration, pre-release stance**"。

### 4.3 回滚路径（实测 + 代码判定）

- **向后滚（新版→旧版）**：若某天介质是 v4、而代码退回 v3 ⇒ `:98` 同样抛 `version-mismatch`
  ⇒ **旧代码打不开该域**，用户看到的是该域打开失败（`Service.init()` 抛）。
  **没有任何降级路径**（代码里不存在 version 归一化/降级分支）。
- **本档**：因为 §4.2 的 bump 根本无法完成，**"v4 介质"在当前实现下不可能产生** ⇒ 当前不存在这个具体风险；
  但一旦按"bump version + 丢弃"的错误方案去实现，这个风险就会立刻出现（**前滚能升、后滚即挂**）。
- **数据不丢的证明（逐域）**：

| 域 | 语义 | version bump/discard 是否"安全" | 依据 |
|---|---|---|---|
| `session_projcache` | **缓存**（失之只多一次冷读尾重放，不产生错值） | **语义上可丢**（但仍**不推荐**：重建代价是 3,104 条记录的全量冷读尾重放 + 内存 50.5 MB 重解析） | `dsh-session-projection-cache/lib/index.js:24-35`（`checkpointRow`：`seq` 只说多陈旧、"A row is never wrong, only possibly stale"）、`:40-46`（`checkpointIdentity`：id 名槽不名生命周期）、`:52-56` "whole record is replaced on every write"、`:64-67` spec 注释 "Version bumps discard the whole medium (cache semantics: a stale or unreadable cache costs a longer tail replay, never a wrong value)"、`:83-93`（fail-soft 自述） |
| `workspace` | **权威用户数据**（工作区注册表：路径/顺序/归属） | ⛔ **绝不可丢** | `dsh-workspace/lib/index.js:224-235`（`workspaceDomainSpec` v2，表 `workspaces`）；该 unit 11,382 B，无任何"cache"自述 |
| `message_feedback` | **权威用户数据**（消息反馈/评分 + 版本） | ⛔ **绝不可丢** | `dsh-message-feedback/lib/index.js:70-73`（v0），`:132`（`version: item.version`）、`:316`（`nextVersion()`）|

⇒ **"version bump ⇒ 丢弃介质"即使被实现，也绝不能做成后端/域层的全局规则**——它只对 projcache 这类缓存成立。
**当前实现统一"抛错"反而是安全的默认**（fail-closed，不会静默丢 `workspace`/`message_feedback`）。

### 4.4 迁移缝：**不存在**（实测 grep）

- `version-mismatch` 全产品命中：**只有抛出点** `dsh-storage-json/lib/index.js:98` + 两处**文档**（`dsh-storage-domain/lib/index.js:11,330`）
  + 无关的 react-dom / projection 文案。**无任何 catch/处理分支**。
- `malformed-medium` 同理：仅 6 处抛出点（`:92,94,96,99,111,277-278`），无处理分支。
- 无 `migrate` / `upgrade` / `onVersionMismatch` / `compatibleVersions` 缝
  （**注**：旧版 `dsh-session-projection-cache` 曾有 `compatibleVersions` 概念，见 §2.1 的 diff —— 新版把它连同 `formatVersion`/lineage 字段**一起删掉了**，见 diff 中 `checkpointIdentity` 的 hunk）。
⇒ **任何迁移都必须新写**，且**不应挂在 version 上**。

### 4.5 跨进程（README 自述"无跨进程写锁"，已实测证实）

`raw/main-migrate.json.T3_cross_process_last_write_wins`：两个进程各开一个 backend 指向**同一 root**，
各自交错写 8 条记录 ⇒ 盘上共 10 条：**父进程 2/8 存活、子进程 8/8 存活** ⇒
**整文件 last-write-wins，父进程 6 条更新被整体覆盖**。
`dsh-storage-json/README.md:23` 自述 "No cross-process write locking … last write wins … multi-process story is deferred"。
⇒ 当前单宿主进程部署下**不是 live 缺陷**；但**任何"多进程/多实例共用一个 storages 根"的尝试都会立刻丢数据**。
（分片布局会把"覆盖整文件"缓和为"覆盖单条记录"，是**顺带**的健壮性改善。）

---

## 5. 前三优化候选（含收益 / 风险 / 验收 / 回滚 / 热冷面）

### 候选 1（**首选**，收益最大，且是**回归修复**）：恢复 per-record 分片布局 + 孤儿回收

- **改动**：`dsh-storage-json/lib/index.js:219-224 publish()` 与 `:257-269 openUnit()`；
  `dsh-storage-domain/lib/index.js:73-80 descriptorOf()` 透传 `layout`；
  `dsh-session-projection-cache` spec 声明分片。**不是** bump version（§4.2）。
- **收益（本档实测，`raw/main-fixcost.json`，n=25）**：

| 量 | 全量单文件 | 单条分片（中位记录 1,561 B） | 改善 |
|---|---|---|---|
| `stringify` pretty median | **22.938 ms** | **0.003 ms** | **−99.987%**（≈7,600×） |
| `stringify` 字节 | 11,496,048 | 3,570（pretty 文件） / 1,675（compact） | **−99.969%**（3,265×） |
| `writeAtomic`（Buffer payload） | 11.023 ms | 4.061 ms | **−63.2%** |
| 端到端（推算 = 分片 serialize+编码+writeAtomic） | 52.067 ms | **≈4.1 ms** | **≈12.7×** |
| **主线程不可打断停顿** | 32.2–37.0 ms（ELD 44.0 / 心跳 52.9） | **≈0.008 ms** | **−99.97%** |
| **写放大 @1.8417/s** | **21.11 MB/s** | **6.6 KB/s** | **−99.97%** |
| 单核占用 | 5.93–6.81% | **≈0.15%**（writeAtomic 走线程池，不占主线程） | — |
| 记录字节分布（现盘实测） | min 1,096 / median 1,561 / p95 2,409 / max 5,462 / mean 1,679 | — | — |

  **与旧布局实物的互证**：legacy tar 1,597 分片 mean 3,091.79 B / median 2,894 B，与本档现盘记录 mean 1,679 B、
  pretty 分片 3,570 B **同阶** ⇒ 收益不是推算产物。
- **风险**：① 目录内文件数从 3 变 **3,104+**（inode/目录项开销；每分片 pretty 3,570 B 落在 1 个 4 KB 块 ⇒ 磁盘 ≈ 12.4 MB vs 11.5 MB）；② 迁移需自写（无迁移缝，§4.4）；③ 必须保持"单次调用原子"契约（每调用只写一个分片）；
  ④ `close()` 的 `inFlight` 语义（`:202-210`）在多文件下需复核。
- **验收（可判定）**：① `session_projcache` 目录下分片数 == 记录数（3,104±滞后）；
  ② 同窗对照 `stringify` 从 ~23 ms 降到 **<0.05 ms**；③ 写放大从 ~21 MB/s 降到 **<0.1 MB/s**（inotify 事件式口径，
  **须带阳性对照**：N 次发布恰好 N 个 `rename` 事件）；④ 冷读功能回归：`coldSnapshot` 走缓存命中路径；
  ⑤ `listArtifacts()` header 数哨兵不变；⑥ 三条 PASS：`workspace.json`/`message_feedback.json` **内容逐字节不变**。
- **回滚**：介质层可回——旧单文件保留为 `<name>.json.migrated-<ts>`（**不删除**），
  回滚 = 恢复该文件 + 回退二进制。**不要**用 version 做开关（§4.2）。
- **热/冷面**：**冷面**（磁盘布局 + 打开路径解析）。

### 候选 2（**风险最低、唯一热面、零 schema 影响**）：去掉 `, null, 2`

- **改动**：`dsh-storage-json/lib/index.js:79` 一处——`` `${JSON.stringify(document)}\n` ``。
- **收益（同窗交替，n=25，两个独立窗口）**：耗时 **−47.8%（保守）/ −51.1%**；字节 **−53.57%**（11,496,048 → 5,337,219）。
  由 1.8417 次/s 换算：单核占用 **5.93–6.81% → 3.0–3.5%**；写放大 **21.11 → 9.8 MB/s**。
- **风险（唯一的、且是产品取舍）**：破坏 `:56-61` 自述的设计意图（"kept human-readable (pretty-printed) — that legibility is this backend's reason to exist"）。
  可缓解：把紧凑化做成 **per-unit 可配置**（如 `descriptor.pretty: false`），只对 projcache 生效，保留 `workspace`/`message_feedback` 的可读性。
- **兼容性（关键优势）**：`parse` 用 `JSON.parse`（`:90`），**对空白不敏感** ⇒ **不需要版本迁移、双向可回滚、新旧代码互相可读**。这是三个候选里唯一**完全可逆**的。
- **验收**：① 介质字节数落在 5.3 MB ±5%；② 同窗 `serialize` 比值 ≤ 0.55；③ `JSON.parse(盘上内容)` 成功且 state 与紧凑前**深度相等**（逐记录断言）；
  ④ `workspace`/`message_feedback` 若保持 pretty，其字节不变（证明 per-unit 开关生效）。
- **回滚**：改回一行即可（介质格式两向兼容，**无需搬迁**）。
- **热/冷面**：**热面**（纯序列化改一行；`dsh-storage-json` 是宿主插件，需重载该插件即可生效，不必全量重启）。

### 候选 3（收益次大、风险中等）：**同一 interval 内合并所有脏会话为一次发布**

- **依据（实测）**：`installWritePath`（`:199-227`）按**会话**记账，`writeIntervalMs: 5000` **每会话各自粗粒度**；
  4 处触发**全部未 await**（§3.4）。实测发布率 **1.8417 次/s**，而每会话上界是 1/5s
  ⇒ 反推**同时脏的会话 ≈ 9.2 个**（1.8417 × 5 s）。**每个脏会话各自触发一次全量重写** ⇒ 同样的 11.5 MB 被重复写 ~9 次。
- **改动**：`flushSoft`/`write` 改为在 interval 边界**收集一批** `(session, rows)`，一次 `publish()` 落全部脏记录
  （仍是"whole-value discipline"，每条记录仍整体替换，语义不变）。
- **收益**：发布次数 **−~89%**（9.2 → 1）⇒ 单核占用 **5.93–6.81% → 0.65–0.75%**；写放大 **21.11 → 2.3 MB/s**。
  与候选 2 叠加后 **≈0.3%**；与候选 1 则被**完全吸收**（分片后单次发布已只写一条）。
- **风险**：① 改变节流语义（`README.md:62` 自述 "Interval throttle is per-session coarse … writes once per interval, not a sliding window"）⇒ 需确认不影响 `turn/end`/disposed 两个**强制点**（`:201-203`/`:219-221` 必须保持立即写）；
  ② 崩溃时"未 flush 的脏会话"范围变大（对缓存可接受，因为 `seq` 表达陈旧度）；
  ③ 失败软化路径（`:234-240`）需按批报告，否则一次失败整批丢。
- **验收**：① 同窗发布率 ≤ 0.25 次/s（inotify 口径 + 阳性对照）；② 单核占用 ≤ 1%；
  ③ 功能断言：连续 200 事件后 5 s 内所有脏会话的 checkpoint 均落盘（按会话断言存在性，不只断言文件变了）；
  ④ **`turn/end` 与 `session/disposed` 的即时写不变**（边沿等价：这两个触发点必须在同 tick 内发起写）。
- **回滚**：还原 `flushSoft` 调用形态（纯运行时行为，无介质变更）。
- **热/冷面**：**热面**（无磁盘格式变更）。

### 明确**不要做**（依据本档实测，均为负收益或高风险）

| 不做 | 实测依据 |
|---|---|
| **去 fsync**（`:31`/`:36`） | fsync 合计 7.236 ms = writeAtomic 的 37.7%，但只占端到端 13.9%（7.236/52.067）；且直接摧毁 §2.3(P4) 的崩溃持久性（窗口 (c) 会变成"丢最新写"的常态）。**修 serialize/编码比分 fsync 值 3.5 倍** |
| **只把 `writeIntervalMs` 调大** | 收益线性但有限（5000→10000 只把 5.93% 减半），且已被 200/5000 吸收大半；候选 3 用同样改动拿到 −89%，**优于**单纯调参 |
| **用 version bump 触发丢弃/迁移** | §4.2 实测：**不会丢弃**，只会让域**打不开**；且会对 `workspace`/`message_feedback` 造成不可接受的数据风险（§4.3） |
| **把 `writeEveryEvents` 调小** | 方向相反（会更频繁写） |

---

## 6. 仪器自证、陷阱与边界

### 6.1 仪器自证（都带阳性 + 阴性对照）

| 仪器 | 阳性对照 | 阴性对照 | 判定 |
|---|---|---|---|
| **inotify 事件计数**（`fs.watch`） | 20 次真实发布 ⇒ **恰好 20 个 `rename` 事件**（1:1） | 空闲 20 s ⇒ **目标文件仍有 24 事件** | 计数口径 **PASS**；**"机器安静"门禁 FAILED**（外部写入者活跃） |
| **inotify 通道身份** | 建 watcher 后 `/proc/self/fd` 出现 `anon_inode:inotify`（fd 20） | 建 watcher 前 0 个 | **PASS**（确认非 fallback） |
| **事件计数第二法** | 同窗新出现 `.tmp` 名 **443** vs 目标 `rename` **442** | — | **PASS**（两法逐个数一致） |
| **ELD**（`monitorEventLoopDelay`） | 注入 200 ms 同步忙等 ⇒ 报 **208.40 ms** | 仅 sleep 250 ⇒ 报 **10.20 ms** | **PASS**（通道有效） |
| **心跳法（独立第二口径）** | 发布期间 p95 32.7 / max 52.9 ms | 基线 p95 1.076 / max 1.453 ms | **PASS** |
| **serialize 真实捕获** | 运行时包裹 `JSON.stringify` 抓 `:79` ⇒ 25.945 ms | 复刻实现独立给 29.280 ms | **PASS**（两条路径互证） |
| **崩溃安全** | SIGKILL 后确见孤儿 tmp（8 MiB） | 正常路径 tmp 被 rename 掉（live 目录两次采样见 tmp 随后消失） | **PASS** |

### 6.2 本档自己踩到 / 自曝的仪器问题（保留在案）

1. ⚠️ **会话目录布局假设错误（自曝并已更正）**：`~/.dsh/sessions/` 的**第一层是 project 目录**
   （`--home-…--`），会话在**第二层**。首轮只扫一层 ⇒ 19 个"会话"、**孤儿 100%**——这是**仪器产物**，
   与 sa2 自曝的"只数 `session-*` 得 99"是同一类错误。更正后：**1,443 个会话目录（101 + 1,342 裸 UUID）**、孤儿 **57.02%**。
2. ⚠️ **`writeAtomic` 的字符串→Buffer 编码成本此前未被单独列出**（本档新增量化：冷串 11.061 ms / 序列内 delta 6.258 ms）；
   若只报"write 阶段 10.884 ms"会把编码混进 I/O 里，得出"写盘是瓶颈"的错误归因。
3. ⚠️ **"内存 after-GC 保留量"口径不稳（标 INCONCLUSIVE）**：同进程多轮重复时基线被前一轮未回收垃圾抬高
   （复测 3 次得 6.43 / 0.00 / 0.00 MB，**明显是伪影**）。改用**每轮一个全新进程**后稳定：
   **load 增量 +50.77 MB heap / +53.5…54.5 MB RSS（3/3 完全一致）**，
   **GC 后保留 +6.65 MB heap / +10.3…11.1 MB RSS（3/3 一致）**。
   ⚠️ **但 +6.65 MB 这一对数字与"解析了 3,106 条记录"的直觉不符，本档无法解释** ⇒ **稳态常驻量标 INCONCLUSIVE**，
   需要 heap snapshot 工具才能定论。**可作结论的只有"打开时的瞬时增量 ≈ +50.8 MB heap / +54 MB RSS"**（3/3 复现）。
4. ⚠️ **`fs.watch` 的 tmp 文件会产生大量 `change` 事件**（11.5 MB 写入 ⇒ ~23 个 `change`/发布）。
   若把"目录内所有事件"当作发布计数会**高估 ~26 倍**。必须按**目标文件名 + `rename`** 计数，且**必须做 1:1 阳性对照**。
5. ⚠️ **起点给的频率 0.870 次/s 与本档 1.8417 次/s 不同**（2.12×）。本档只报趋势与自洽性（§1.5），
   不据此否定旧值；两值代入同一公式分别给出 2.83–3.81% 与 5.93–6.81%，**互为量纲自证**。

### 6.3 边界（不得外推）

- **本档全程未持探针锁**（他线存活占用，未回收）⇒ 所有窗口 `CONTENDED`；
  **绝对 ms 只能同窗比值用**，跨窗口/跨历史的绝对值不可比（团队 §五.7）。
- **主线程停顿在忠实复现进程中测得**（同一份 deployed 代码 + 同一份真实 state），
  **不是**在宿主 2988915 内测得（无法向运行中的宿主注入 `monitorEventLoopDelay`，禁止改宿主状态）⇒ 宿主侧只有**间接**判据。
- **写成本测的是 workspace 内副本**，非 `~/.dsh` 本身；两侧同 ext4（语义一致）但**副本页缓存温热** ⇒ fsync 数字是**下限**。
- **`/proc/<pid>/io` 本环境 EACCES**（sa2 已发现，本档未重测）⇒ 无法给 projcache 在宿主总写带宽中的**占比**。
- **未测（越界）**：libuv 线程池饱和度；宿主内 ELD；`session.list` 自身成本（已由他线修复）；
  分片布局落地后的真实磁盘/inode 行为（本档只做同形成本的忠实复刻，**未真正改产品**）。
- **观察者效应**：本档自身是宿主 2988915 的子代理，探针的 CPU/IO 计入宿主负载。

---

## 7. 逐条 PASS / FAIL / INCONCLUSIVE

- `[PASS]` **W1** 写原语是**整文件重写**：`putRecord` → `publish()` → `serialize()` → `writeAtomic()`。
  — `dsh-storage-json/lib/index.js:219-224`（publish）、`:68-80`（serialize，`:79` pretty stringify）、`:169-180`（putRecord）、`:25-41`（writeAtomic）、`:149`（常驻 state）
  — 真实 11.46 MB state：**serialize 中位 25.945 ms**（运行时捕获 `:79`）、端到端 `putRecord` **52.067 ms**（n=15）。`raw/main-writepath.json`
- `[PASS]` **W2** `serialize` 的实参求值是**同步**的（在 `writeAtomic` 的 promise 存在之前），故**阻塞主线程**。
  — `:220` `writeAtomic(this.path, serialize(this.descriptor.name, this.state))`
  — ELD max **44.01 ms**（1× 真实 putRecord）；独立心跳口径 **max 52.882 ms**（9 次 > 20 ms，基线 p95 1.076 ms）；同 tick 5× serialize **151.52 ms**。阳性对照 208.40 / 阴性 10.20。`raw/main-writepath.json`、`raw/main-concurrency.json`
- `[PASS]` **W3（本档新增量化）** `writeAtomic` 内部的主线程 **UTF-8 编码**成本此前未被单独列出：`:30 handle.writeFile(data,"utf8")` 收 ~11.3 MB **字符串**。
  — `:30` — 冷串 `Buffer.from(json,'utf8')` 中位 **11.061 ms**；writeAtomic 内"字符串 vs 预编码 Buffer"同窗 delta **6.258 ms = total 的 32.6%**（n=25）。`raw/main-writepath.json`、`raw/main-fixcost.json`
- `[PASS]` **W4** `writeAtomic` 分阶段占比：open 0.3% / **write（含编码）56.7%** / **文件 fsync 23.7%** / close 0.2% / rename 5.6% / **目录 fsync 14.1%**；**fsync 合计 37.7%**；**去 fsync 仅省端到端 13.9%**。
  — `:28`/`:30`/`:31`/`:33`/`:35`/`:36`+`:44-52` — total 19.184 ms，fsync 7.236 ms，端到端 52.067 ms（7.236/52.067 = 13.9%）。`raw/main-writepath.json`
- `[PASS]` **W5** 紧凑序列化（去 `, null, 2`）收益：耗时 **−47.8%（保守）/−51.1%**、字节 **−53.57%**。
  — `:79` — 22.938→11.968 ms、11,496,048→5,337,219 B（n=25）；另一窗口 26.369→12.899 ms（n=15）。`raw/main-fixcost.json`、`raw/main-writepath.json`
- `[PASS]` **W6（事件式仪器，无轮询）** projcache 发布频率 **1.8417 次/s**（**442** 个 `rename`/240.000 s），写放大 **21.11 MB/s**；`workspace.json` 与 `message_feedback.json` 同窗 **0** 事件。
  — `:35` rename + `:26` `open(tmp,"wx")` — inotify 通道已自证（`anon_inode:inotify` fd 20）；**阳性对照 20/20（1:1）**；**同窗第二法 `.tmp` 名 443 ≈ 442**。到达间隔 min 49.1 / median 68.9 / p95 1812.7 / max 20102.3 ms。`raw/main-freq.json`
- `[PASS]` **W7（本档最重发现）** 🔴 **"version bump ⇒ 整体丢弃介质"不存在**：descriptor `version: 3→4` 打开真实介质 ⇒ **抛 `StorageError code=version-mismatch`**，介质**逐位不变**（sha256 `898790de…`、11,484,375 B 前后一致）、无删除/无改名/无重建。
  — `dsh-storage-json/lib/index.js:98`（唯一抛出点）；`dsh-session-projection-cache/lib/index.js:58-62` 的 doc 自述 **FALSE**；README:12 自述 "no migration, pre-release stance" — 对照 T1（v3 正常打开，3,103 条，文件 sha 不变）。`raw/main-migrate.json`
- `[PASS]` **W8** 产品**没有**任何 version 迁移缝：`version-mismatch` 全产品仅**抛出点** + 两处**文档**，**无处理分支**；无 `migrate`/`upgrade`/`onVersionMismatch`；`malformed-medium` 同理（6 处抛出、0 处理）。
  — `dsh-storage-json/lib/index.js:92,94,96,98,99,111,277-278`；`dsh-storage-domain/lib/index.js:11,330` — grep 全产品零处理分支（唯一旧痕迹是 §2.1 diff 中被**删除**的 `compatibleVersions`/`formatVersion`）。`raw/main-migrate.json` + 静态
- `[PASS]` **W9** `dsh-storage-json` **不提供写序保证**（doc 自述 + 实测）：绕过域链并发 `putRecord`，**20 次里 7 次**盘上不是最后一次写的值。
  — `:118-125` doc；`:169-180`。`raw/main-concurrency.json` T3
- `[PASS]` **W10（前提更正）** "单条 promise 链串行 ⇒ 多 unit 互阻" **作为字面表述不成立**：链在 `DomainImpl.chain`（每域一条，`DomainFacility.open` 每域 new 一个 `DomainImpl`），实测两域两条链**互相重叠**（小写 74.9 ms 先于大写 82.8 ms 完成）。
  — `dsh-storage-domain/lib/index.js:109`（chain）、`:210-215`（enqueue）、`:359`（每域 new DomainImpl）；`dsh-storage-json/lib/index.js:241-275`（后端无队列）。`raw/main-concurrency.json` T1
- `[PASS]` **W11（更正后的真实机制）** 跨 unit 互阻**确实存在**，机制是**共享主线程**：1 ms 心跳在只有 projcache 发布时被拉到 **p95 32.711 / max 52.882 ms（9 次 > 20 ms）**，基线 p95 1.076 / max 1.453 ms。
  — `dsh-storage-json/lib/index.js:220`（同步 serialize）+ `:30`（主线程编码）。`raw/main-concurrency.json` T2
- `[PASS]` **W12** 孤儿记录实证：记录 **3,104** vs 盘上会话目录 **1,443**（19 project 目录；101 `session-*` + 1,342 裸 UUID）⇒ **孤儿 1,770 = 57.02%**，覆盖率 42.98%，109 个盘上会话无记录；**B2 归档 1,670 个目录盘上存活 0，其记录 1,670 条仍在**。
  — `deleteRecord`（`dsh-storage-json/lib/index.js:181-191`）与域 `delete`（`dsh-storage-domain/lib/index.js:253-266`）**对 projcache 无调用者**；自述 `dsh-session-projection-cache/README.md:61` "No eviction or retention surface"。`raw/main-orphan.json`
- `[PASS]` **W13** 分片布局的反事实收益（候选 1，n=25）：单条中位记录（1,561 B）⇒ **stringify 22.938 → 0.003 ms（−99.987%）**、**字节 11,496,048 → 3,570 B（−99.969%）**、**writeAtomic 11.023 → 4.061 ms（−63.2%）**；由 1.8417 次/s 换算写放大 **21.11 MB/s → 6.6 KB/s（−99.97%）**。
  — 旧布局实物互证：legacy tar 1,597 分片 mean 3,091.79 / median 2,894 B。`raw/main-fixcost.json`、`raw/main-orphan.json`
- `[PASS]` **W14** 上游回归的三条独立证据（spec doc 注释改写 / 旧布局 tar 实物 / 现盘旧目录空壳）。
  — `.workspace/workstreams/upstream-015-diff/pkgs/dsh-session-projection-cache.libjs.diff`（**路径已更正**，不在 `lag-fix/workstreams/`）；`backup/B2/20260920-074510/legacy-projcache-tree.tar`；`~/.dsh/storages/session_projcache/`（空）。`raw/main-orphan.json`
- `[PASS]` **W15** 崩溃窗口与孤儿 tmp：SIGKILL 于 rename 前 ⇒ **孤儿 tmp 留下**（8,388,608 B），目标文件不存在；`rm(tmp,{force:true})` 仅在 catch 分支（`:37-40`）。
  — `:28-36` 顺序 + `:37-40` — 窗口 (a)(b) **不丢数据但留垃圾**；窗口 (c)（rename 后、目录 fsync 前）极端断电下**丢最新一次写**（rename 非 crash-durable）。`raw/main-migrate.json` T4
- `[PASS]` **W16** 跨进程无写锁，实测**丢更新**：父进程 8 条只存活 2 条、子进程 8/8。
  — `dsh-storage-json/README.md:23` 自述；`:25-41` 整文件 rename 语义。`raw/main-migrate.json` T3
- `[PASS]` **W17** 三个 unit 各自独立的 name/version/tables 引用已逐条钉死（projcache v3 / workspace v2 / message_feedback v0），且 `version` **每 unit 一个**、由 spec 声明、落介质头部、打开时严格相等。
  — `dsh-session-projection-cache/lib/index.js:58-62`、`dsh-workspace/lib/index.js:224-235`、`dsh-message-feedback/lib/index.js:70-73`；`dsh-storage-domain/lib/index.js:61-67,73-80`；`dsh-storage-json/lib/index.js:71-78,98`
- `[FAIL]` **W18** ❌ **"机器安静"门禁**：本档**全程未持探针锁**（`w14-residual-env`/`w26-integrity`/`w19-slots` 三线先后存活占用，**未回收**），且**阴性对照失败**——空闲 20 s 内目标文件仍有 **24** 个事件 ⇒ **所有窗口 `CONTENDED`**；绝对 ms 只作同窗比值。**这不证明被污染，只说明门禁不成立**（团队 §五.18 的同类纪律）。
- `[FAIL]` **W19** 起点给定的**前提链中有一环被推翻**：`dsh-session-projection-cache/lib/index.js:58-62` 的 "Version bumps discard the whole medium" 为 **FALSE**（§W7）；**"分片回归修复 = 域 version 3→4"因此不可行**。
- `[FAIL]` **W20** 起点"**单条 promise 链串行 ⇒ 多 unit 互阻**"的字面因果 **FAIL**（链是每域一条、实测两链重叠）；**更正为"共享主线程 ⇒ 跨 unit 停顿"**（W11 已量化）。
- `[INCONCLUSIVE]` **W21** **libuv 线程池饱和度**（默认 4 线程）作为跨 unit 的第二种耦合：`UV_THREADPOOL_SIZE` 未设 ⇒ 有效 4；本档**只做静态论断，未量化饱和度**。**需要**：线程池观测（如注入慢 fs 作业并测排队）或 eBPF。
- `[INCONCLUSIVE]` **W22** **宿主进程内**的事件循环延迟**未直接测量**（禁止向运行中的宿主注入探针）。只有**间接**判据（在忠实复现进程内测得 44.0/52.9 ms）与宿主 `/proc/<pid>` 级统计。**需要**：重启并加宿主侧埋点。
- `[INCONCLUSIVE]` **W23** **常驻内存的稳态保留量**：打开瞬时增量 +50.77 MB heap / +53.5…54.5 MB RSS 可复现（3/3）；但 **GC 后保留 +6.65 MB heap / +10.3…11.1 MB RSS（3/3 一致）与"解析 3,106 条记录"明显不符，本档无法解释**。**需要** heap snapshot / `--inspect` 分配采样。
- `[INCONCLUSIVE]` **W24** **projcache 占宿主总写带宽的比例**：`/proc/<pid>/io` 本环境 EACCES ⇒ 只能给绝对写放大（21.11 MB/s），**给不出占比**。**需要**可读的 `/proc/<pid>/io` 或 cgroup `io.stat`。
- `[INCONCLUSIVE]` **W25** **增长率**：三个时间点给出 **0.89 MB/天**（09-20 15:45 → 09-22 14:33，46.81 h）与 **5.35 MB/天**（09-22 14:33 → 现，**仅 4.13 h 且跨一次重启**）。短窗包含冷启动重放突发 ⇒ **不作为长期斜率**。**需要**更长/更多的历史采样点。
- `[INCONCLUSIVE]` **W26** **宿主 `/proc/2988915` 内 `heapUsed`/RSS 中 projcache 的占比**、以及**分片布局落地后的真实 inode/磁盘行为**（本档只做同形成本复刻，**未改产品**）。

---

## 8. 原始数据索引与复现

### 8.1 原始 JSON（全部在本档目录）

| 文件 | 内容 |
|---|---|
| `raw/main-freq.json`（1.50 MB） | **inotify 事件式频率**：通道自证（inotify fd）、阳性对照 20/20、阴性对照（24 事件 ⇒ 门禁 FAIL）、240 s 主窗逐事件时间戳、逐文件计数/到达间隔/写放大、tmp 事件分解、每秒 medium 采样、锁状态 |
| `raw/main-writepath.json` | serialize（真实捕获 vs 复刻）、`:70` 单独、UTF-8 编码、pretty/compact 同窗、writeAtomic 六阶段 + 预编码 Buffer 对照、端到端 putRecord、ELD 五相位（含阳/阴性）、内存 |
| `raw/main-fixcost.json` | **候选 1 反事实**：全量 vs 单条分片（median/p95/max）的 stringify/字节/writeAtomic；记录字节分布；内存新进程复测 |
| `raw/main-concurrency.json` | 两域链独立（T1）、跨 unit 主线程停顿（T2，心跳法）、unit 层并发丢更新 7/20（T3）、线程池（T4） |
| `raw/main-migrate.json` | **T2 决定性版本 bump 实测**、T1 v3 基线、T3 跨进程丢更新、T4 SIGKILL 孤儿 tmp、T5 live tmp 普查 |
| `raw/main-orphan.json` | 孤儿统计（1,770/3,104 = 57.02%）、会话目录布局与计数、`deleteRecord` 调用者、产品自述、legacy tar 分片统计、`deletable-dirs.list` 交叉验证、增长点与斜率 |
| `raw/wp-root/` `raw/conc-root/` `raw/mig-root/` `raw/crash-root/` `raw/fix-root/` `raw/memf1..3/` | 各实验的**私有根目录**（均为本档内副本；**未触碰 `~/.dsh`**） |

### 8.2 探针脚本（全部可重跑）

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/program/w21-storage

# ① 频率（事件式 inotify，含自证 + 阳性/阴性对照）；240 s
node tools/w21-freq.mjs raw/main-freq.json 240

# ② 写路径分段 + ELD（真实 deployed 模块 + 真实 11.5 MB state 副本）
node --expose-gc tools/w21-writepath.mjs raw/main-writepath.json 15

# ③ 候选 1 反事实 + 内存干净复测
node --expose-gc tools/w21-fixcost.mjs raw/main-fixcost.json 25

# ④ 并发/链独立性/丢更新
node tools/w21-concurrency.mjs raw/main-concurrency.json

# ⑤ 版本迁移（决定性）+ 崩溃安全 + 跨进程
node tools/w21-migrate.mjs raw/main-migrate.json

# ⑥ 孤儿 / legacy / 增长
node tools/w21-orphan.mjs raw/main-orphan.json

# ⑦ 内存（每轮一个全新进程，避免跨轮垃圾抬高基线）
node --expose-gc tools/w21-mem.mjs raw/memf1
```

### 8.3 引用的既有证据（本档复核，非重做）

- `program/w03-persistence/audit.md` + `sa2-projcache/audit-sa2.md`（全量重写、809×/2,939×、无淘汰、`session.list` 因果否证）
- `program/w02-host-rpc/audit.md`（**已撤回项不引用**）
- `program/FINDINGS-INDEX.md`
- `exec-audit/BATCH-PLAN.md §五`（测量协议 1–20）
- `backup/B2/20260920-074510/`（legacy tar + manifest + deletable-dirs.list）
- `.workspace/workstreams/upstream-015-diff/pkgs/dsh-session-projection-cache.libjs.diff`

> 本报告所有断言均给出 file:line 与实测数字；凡未能量化者已在 §7 显式标 `INCONCLUSIVE` 并写明所需条件。
> **未以"应该很贵"代替测量，未建立无证据的因果，未引用任何已撤回数字。** 全程未重启/未杀进程/未修改产品文件与 `~/.dsh`。
