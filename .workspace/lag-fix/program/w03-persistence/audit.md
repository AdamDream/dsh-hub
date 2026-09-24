# w03-persistence 审计：会话持久化与压缩链路（2026-09-22）

- 独占目录：`.workspace/lag-fix/program/w03-persistence/`
- 宿主：PID **301709**（`node /home/CNS2026495165/.npm-global/bin/dsh web`，12 线程，其中 **4 个 `libuv-worker`** = 301716–301719，VmRSS 3.63 GB）
- 纪律：**只读审计**。未重启、未 pkill、未改任何产品文件与 `~/.dsh` 下任何文件。
  ⚠️ **本会话对 `~/.dsh` 无写权限**（workspace-write 沙箱 + 审批已禁用），因此所有写探针在 **workspace 内、同一 ext4 挂载 `/dev/nvme0n1p2`** 上做（`findmnt -T` 实测两侧同为该挂载）。
- 原始数据：`raw/*.json`（主档）、`sa1-scan/raw/*.json`、`sa2-projcache/raw/*.json`
- 复现命令：见每节「复现」

---

## 0. 一句话结论

**问题不在压缩、不在 fsync、也不在"重压全文件"。**
会话日志 append 是 **O(1)、帧级、~2.1 ms/次、97% 是 fsync**，而且 **zstd 用的是 Node 默认 level 3，压缩耗时几乎可忽略**（§1）。

**真正的靶点是 `session_projcache.json`：单文件 2856 条记录，每写一条就把整个 10.56 MB 全量重序列化 + 全量重写。**
**而且这是上游 per-record 分片布局的回归**（仓库内有 diff 与旧布局实物，§3.5 P9）⇒ 修法是"回到上游"，不是"发明新格式"。

> 🔴 **同时必须把两件事分开（本档最重要的边界）**
> 1. **`session.list` 当前是 25 s 超时的活体回退**（每次烧 26.2–34.3 s 宿主 CPU；同窗 no-op 对照 RPC 中位 264 ms ⇒ ≥95×；incident2 修复后基准为中位 0.166 s）。
> 2. **projcache 已被实测排除为该回退的原因**（占空比仅 **3.50%**，"窗内有无 publish"对超时**零区分度**）；**persistence 侧对该回退的贡献上界 ≤1%**（§4.6）。
> ⇒ **修 projcache 不会修好 `session.list`**；真靶指向 `dsh-host-apiproxy` 的**活体事件折叠 2–3 遍**（§4.6 末尾）。
在宿主**当前运行中**实测（三个独立仪器，见 §7.1「仪器冲突仲裁」）：

| 仪器 | 窗口 | 全文件重写次数 | 速率 | 写盘 |
|---|---|---|---|---|
| **inotify + 20 Hz inode 差分双法吻合**（空闲窗，sa2） | 90 s | 45 | **0.500 /s** | **5.07 MB/s** |
| **inotify + 20 Hz inode 差分双法吻合**（繁忙窗，sa2） | — | — | **1.273 /s** | **12.90 MB/s** |
| **inotify `rename` 计数**（主档仲裁，`other=0`） | 50 s | 33 | **0.660 /s** | **7.02 MB/s** |
| mtime 轮询 100 ms（**较不可靠，仅作上界**） | 40 s | 59 | **1.475 /s** | **15.58 MB/s** |

⇒ **projcache 每秒把整个 10.6 MB 文件重写 0.50（空闲）～1.273（繁忙）次 = 写盘 5.07～12.90 MB/s**；主档 mtime 轮询得的 1.475 /s 作为**装载依赖的上界**。
**发布是突发的**：inotify 实测间隔 min **149–379 ms** / p50 **501–1364 ms** / max 7640 ms。

| 量 | 实测值 | 复现 |
|---|---|---|
| 同窗口会话日志 append | **346 次 = 8.65 次/秒，9.3 KB/s**（40 s 窗口） | `raw/m5-live-rate.json` |
| ⇒ 写放大比 | **projcache : 会话日志 = 545–1,387 : 1**（5.07–12.90 MB/s ÷ 9.3 KB/s） | 同上 + `raw/m11` |
| 同步主线程阻塞 | **占空比 3.50%**（sa2 实测：41.3 ms × 1.273 次/s；峰值 18.46%）；主档口径 13–17 ms/s，上界 37.5 ms/s | `raw/m7-gc-realism.json`；**sa2** `key-numbers.json` |
| 事件循环最大延迟 | **47.45 ms**（p99 28.44 ms）；真实 deployed 代码路径单次 put 时 **40.6 ms**（阳性对照 201.6 ms / 阴性 10.4 ms） | `raw/m7`,`raw/m10` |
| 单次 `putRecord` 端到端（**真实 deployed 代码**） | **59 ms p50（46–64 ms）**，每次写 **10,561,778 字节** | `raw/m10-real-path.json` |
| 该文件增长 | 8.84 MB/2400 条（09-20 07:45）→ **10.56 MB/2856 条**（09-22 06:33）= **+36.7 KB/h、+9.74 条/h，单调无回收** | §5 |
| 其中**孤儿记录**（磁盘上已无对应日志） | **1670 / 2856 = 58.5%** | §5 |

**因果链（钉死到 file:line）**：
`session/event`（`turn/end` 无条件触发）→ `sessionProjectionCache.flushSoft` → `put()` → `table.put()` → 存储域**单条 promise 写链**（严格串行）→ `JsonKvUnit.putRecord()` → `publish()` → `writeAtomic()` → **`JSON.stringify(整个 state, null, 2)`（同步、主线程、26.4 ms）** + 写 10.56 MB + **文件 fsync** + rename + **目录 fsync**。

它和「RPC 卡顿」的耦合**不是通过被读**（投影列的读是**零 I/O 纯内存**，§4.4），而是：
1. 每次重写都在**主线程同步阻塞 26–41 ms**，期间**任何 RPC 都被推迟**（实测占空比 **3.50%**，峰值 18.46%）；
2. 写入串行在同一条 promise 链上（`dsh-storage-domain:210-214`），而 `write()` 还额外 `await ctx.sessions.flush(session)`（多一次日志 fsync），所以 `turn/end` 处理会**排在其他会话的全量重写之后**。

> 🔴 **但必须明确：`session.list` 当前的 25 s 超时回退，`projcache` 已被实测排除**（§4.6）。
> projcache 的占空比只有 **3.50%**，不可能产生 `session.list` 实测的 **26.2–34.3 s CPU**；且"窗内是否发生 projcache publish"对超时**零区分度**（sa2）。**修 projcache 不会修好 `session.list`。**

**它是不可持续的增长**：写量 ∝ 文件大小，而文件只增不减。按实测增长率线性外推（**外推，非实测，标 INCONCLUSIVE**）：1 个月 26 MB ⇒ 约 12–17 MB/s 写盘（上界 38 MB/s）；1 年 322 MB ⇒ **约 160–210 MB/s 写盘（上界 475 MB/s）+ 每次 805 ms 同步 stringify** ⇒ 事件循环直接死亡。

---

## 1. 问题①：`dsh-session-persistence-jsonl` 的每次 append 成本

### 1.1 代码事实（file:line）

| 断言 | 位置 |
|---|---|
| append 入口 | `dsh-session-persistence-jsonl/lib/index.js:1200-1227` `appendLines()` |
| 每次 append 只编码**这一批** | `:1180-1183` `encodeEventBatch()` → `:572-574` `compressZstdFrame()` |
| zstd 选项**只设 checksum，不设 level** | `:494` `const CHECKSUM_OPTIONS = { params: { [constants.ZSTD_c_checksumFlag]: 1 } }` |
| **不重压全文件**（帧级追加，每批一个独立帧） | `:1180-1183`；`materialize` 另写"header 帧 + 首批帧"两帧（`:1168-1179`） |
| append 操作序列 | `:1203` `open(path,"a")` → `:1211` `handle.stat()` → `:1213` `handle.writeFile(content)` → **`:1214` `handle.sync()`（fsync）** → `:1225` `handle.close()` |
| 写批窗口 | `dsh-session-persistence/lib/index.js:324-333` `enqueue()`：**首个事件**到达时 arm `setTimeout(maxDelayMs)`；`:355-359`；默认 200 ms（`:436` `DEFAULT_WRITE_BATCH_MAX_DELAY_MS = 200`） |
| 但 `flush()` 会**立即**排空并取消窗口 | `dsh-session-persistence/lib/index.js:339-348` + `:397` `while (this.pending.length > 0) await this.startWrite(false)`；触发点 `:1168` `ctx.on("session/flush", …)` |

### 1.2 实测（复现：`node raw/m2-append-cost.mjs`、`node raw/m9-zstd-level.mjs`）

**A. 确实不是"重压全文件"（PASS）**——用帧扫描器数真实日志的 zstd 帧数（帧数 ≈ append 次数）：

| 日志 | 字节 | **帧数** | 平均帧字节 |
|---|---|---|---|
| `session-6a7367fe…` | 22,808,279 | **69,229** | 329 |
| `session-aa169d83…` | 22,770,869 | **77,464** | 294 |
| `session-b64308f0…` | 13,772,205 | 45,374 | 304 |
| `session-0b9bfaf5…` | 12,245,962 | 41,945 | 292 |

⇒ 22.8 MB 文件里有 **69,229 个独立帧**，平均 329 字节。**每次 append 只写新帧**，与文件大小无关（O(1)）。全盘 1207 个日志 616 MB，按**最大日志实测的帧密度（≈2.9 帧/KB）外推**约 **1.8–1.9 M 次 append 历史**（**估算，非全量逐帧实测**——小文件因含固定 2 帧 header 密度更高，故真值应 ≥ 此）。
另：**live 精确计数** 346 次 append / 40 s，平均 **1,077 字节/次**（`raw/m5-live-rate.json`）。

**B. `appendLines` 各步骤占比（p50，small frame 2 KB）**

| 步骤 | ms | 占比 |
|---|---|---|
| open | 0.026 | 1.2% |
| stat | 0.026 | 1.2% |
| write | 0.029 | 1.4% |
| **fsync** | **2.047** | **96.6%** |
| close | 0.024 | 1.1% |
| **合计** | **2.12** | 100% |

32 KB / 512 KB / 4 MB 帧：合计 2.69 / 3.00 / 5.96 ms，fsync 仍占 76% / 90% / 58%。⇒ **append 成本 ≈ fsync 成本，且与写入量弱相关。**

**C. zstd 级别 = 3（Node 默认），且它不是瓶颈**

`CHECKSUM_OPTIONS` 不含 `ZSTD_c_compressionLevel` ⇒ Node 默认。用**真实会话文本**（从真实日志解出前 200 帧，260,340 字节明文）做同窗对照：

| 级别 | ms p50 | 压缩后字节 |
|---|---|---|
| 1 | 0.63 | 71,289 |
| **3（Node 默认，= 产品实际）** | **1.14** | **65,702** |
| 产品默认（不传 level）实测 | **1.335** | **65,702** ← 与 level 3 字节逐一相等，**确证级别 = 3** |
| 9 | 5.07 | 60,739 |
| 15 | 25.8 | 59,988 |
| 19 | 57.8 | 47,057 |
| 22 | 220.0 | 46,929 |

⇒ **提高 zstd 级别是明确的坏主意**：level 19 用 **50× 的 CPU** 只换 **28%** 的体积；而 append 里压缩只占 2.12 ms 中的 ~0.01–1.1 ms。**任务书里"zstd 级别"这一候选，实测结论是「已是最优，不要动」。**

**D. 真实压缩比只有 2.38×**（431,255 字节明文 → 181,372 字节压缩，采样前 400 帧，最大日志）
⇒ 617 MB 磁盘 ≈ **约 1.47 GB 明文**。这条是 §5 磁盘增长的真实基数（不是我合成载荷那种 194× 的假象）。

**E. 写放大**：**无 O(filesize) 项**（PASS）。真正的写放大是**帧数**层面而非字节层面——平均帧 300–1100 字节意味着**每次 append 都在 fsync 一次极小的写**。fsync 数是 append 数，不是字节数。

### 1.3 "99 顶层 + 200 子代理"规模下的表现

**真实规模比任务书假设更大**（`sa1-scan/raw/real-ids-summary.json`，实测遍历磁盘）：
- **1207 个会话日志 = 125 顶层 + 1082 子代理**（血缘深度直方图 `{0:308, 1:593, 2:277, 3:29}`）
- 磁盘 617.3 MB，最大单项目 196 MB

**扩展律（代码可推 + 实测锚点）**：
- `enqueue` 只在**队列为空**时 arm 200 ms 窗口（`dsh-session-persistence/lib/index.js:325,332`）⇒ 当某会话的事件率 < 5/s 时，**每个事件各自成批、各自一次 fsync**。append 速率 ≈ 事件速率。
- append 成本由 **4 个 `libuv-worker` 线程**承担（实测宿主 PID 301716–301719）。**fsync 在 libuv 线程池上，不阻塞主线程**——这点必须讲清楚，它不是通过"阻塞 JS"来伤人的，而是通过**占满线程池**。
- 实测排队效应（`raw/m3-threadpool.json`）：

| 场景 | p50 | 说明 |
|---|---|---|
| 串行 append | 2.91 ms（吞吐 378 次/s） | 基线 |
| **50 并发 append** | **82.20 ms** | **排队比 28.3×**；吞吐仅 **570 次/s** |
| 并发/串行吞吐 | **1.5×** | ⇒ 4 线程池**已饱和**，加并发几乎无收益 |

⇒ **append 路径的硬上限 ≈ 570 次/s**。要超过它，队列就会无界增长。
- **现状 8.65 次/s = 上限的 1.5%，今天不构成瓶颈。**
- 但 append 速率 ∝ 活跃会话数。若 1082 个子代理中哪怕 300 个活跃、每个 2 事件/s ⇒ **600 次/s > 570 上限 ⇒ 饱和**。
- 叠加：同池还要服务 **projcache 每秒 1.475 次的 writeFile+fsync+rename+目录fsync**（§3）与**全部 zstd 压缩**（`:492-493` 用 async `zstdCompress` ⇒ 也走线程池）。
  ⇒ **饱和是"append + projcache + zstd + 所有 fs 操作"共享 4 线程的合计效应**，这是量级放大期的主要风险面。

**判定**
| 断言 | 判定 | 证据 |
|---|---|---|
| A1 append **不**重压全文件，成本 O(1) | **PASS** | 帧数/文件大小实测（§1.2A） |
| A2 zstd 级别 = 3，压缩非瓶颈；提高级别是负收益 | **PASS** | level 对照表（§1.2C） |
| A3 append 成本 97% 来自 fsync，2.1–3.0 ms/次 | **PASS** | 分步计时（§1.2B） |
| A4 每次 append 一次 fsync，无批量合并兜底 | **PASS** | `:1214`；`:325,332` 空队列才 arm 窗口 |
| A5 append 今天不阻塞主线程（fsync 在线程池） | **PASS** | ELD 实测：真实 zstd 压缩 200×4KB 仅 **10.1 ms** max（阳性对照 201.3），`raw/m2` |
| A6 append 路径硬上限 ≈ 570 次/s，1082 子代理规模会饱和 | **PARTIAL / 上限实测 PASS，饱和为外推 ⇒ INCONCLUSIVE** | `raw/m3`；外推部分未在活体高扇出下实测 |
| A7 "99 顶层 + 200 子代理"这个规模假设本身 | **FAIL（规模低估）** | 实测 125 + **1082**（§1.3） |

---

## 2. 问题②：启动时扫描/加载成本

> 本节的深度测量由 **sa1-scan 档**完成，产物 `sa1-scan/audit-sa1.md` + `sa1-scan/raw/*.json`；主档做了独立复核（§2.4）与代码定位。

### 2.1 代码事实（file:line）

| 断言 | 位置 |
|---|---|
| `list()` = 只读 header，不解析全日志 | `dsh-session-persistence-jsonl/lib/index.js:1085-1087`（`listArtifacts` → `.header`） |
| 扫描 = 遍历 project × session 目录，**每目录 2 次 `exists`** | `:1090-1119` `listArtifacts()` |
| `exists()` = **`open(path,"r")` + `close()`**（不是 `stat`） | `:1362-1373` |
| 首帧读 = 8192 字节分块 + `scanZstdFrames(content, 1)` + **只解压第一帧** | `:1279-1313` `readFirstZstdLine()` |
| `listSnapshots()` = `listArtifacts()` + 每 artifact 一次 `stat` | `:1090-1108` |
| `checkRootEncoding()` 全量扫一遍（**记忆化**一次） | `:1068-1078`；`ensureRootEncoding()` `:1066-1071` |
| `findLog(id)` **对单个 id 遍历所有 project**，每 project 4 次 `exists` | `:1315-1342`；`rejectLegacyFlatArtifact` `:1408-1419` |
| `loadStored`/`readStoredRevision` 都走 `findLog` | `:1060-1070` 区段（`readStoredRevision` 见 `:1213` 附近注释） |
| 启动种子：`for (const session of ctx.sessions.list()) this.initFor(session)` | `dsh-session-persistence/lib/index.js:1170` |

### 2.2 实测（sa1-scan 档 15 轮 @N=1209 + 主档 9 轮 @N=1204，真实 `~/.dsh/sessions`）

| 操作 | 中位耗时 | syscall 计数（实测） |
|---|---|---|
| `listArtifacts()` | **165.9 ms**（min 143.8 / p95 236.8，n=15 @N=1209；主档 9 轮得 161.5）= **137.2 µs/文件** | `exists` **3612**、`readFirstZstdLine` **1204**、`listSessionDirs` 38、`listProjectDirs` 2、`assertStoredIdentity` 1204；**冷调用 census 8.1 syscall/文件**（稳态 6.1） |
| `list()` | **约 150 ms**（140.9–190.8） | `exists` 2408、`readFirstZstdLine` 1204 |
| `listSnapshots()` | **约 170 ms**（151.0–194.3） | `exists` 2408、`readFirstZstdLine` 1204 |
| `checkRootEncoding()`（新实例首调，一次性） | **约 30 ms** | `exists` **1207** |
| `findLog(id)` | **2.69–4.06 ms / id** | `exists` **76 / id**（19 project × 4） |
| N=100 个 id 循环 | **268.96 ms** | `exists` **7600**（= 100 × 76，逐 id 线性） |

⇒ **`findLog` 是 O(projects) 每 id ⇒ N 个 id 为 O(N × projects)**（如实命中任务的"99 顶层会话 + 大量子代理"关注点：任何按 id 逐个解析路径的调用都是 76 次 syscall/个）。

**独立确证（`strace -c` 真 syscall 计数，非插桩）**——N 从 0→1→10→100 的斜率：

| N（id 数） | `openat` calls（errors） | `statx` calls |
|---|---|---|
| 0（基线） | 1587（1517） | 1379 |
| 1 | 1664（1592） | 1455 |
| 10 | 2357（2267） | 2139 |
| 100 | 9287（9017） | 8979 |
| **斜率** | **(9287−1664)/99 = `77.0 openat/id`**；(2357−1664)/9 = 77.0 | 73.9 /id |

⇒ **`strace` 实测 77 `openat`/id，与解析预测的 76 `exists`/id 逐一吻合**（两个独立方法互证 O(projects) 结论）。
另有 `listArtifacts()` 单次调用的全 syscall 归因（`attrib-full-ops.json`）：**总计 24,976 次 syscall**（`openat` 5121、`read` 14,589、`close` 2509、`statx` 2586、`getdents64` 82），其中 `openat` 有 **2624 次是 ENOENT**（正是 `exists()` 探测不存在文件的开销）。

**扫描成本的时间归因（sa1 关键发现）**：`listArtifacts()` 的墙上时间中，**内核态只占 37%**，其余 **约 104 ms 是约 6,100 次 Node `fs` promise 往返**（每次 `exists()` 都是 `open()`+`close()` 两次 promise 往返，见 `:1362-1373`）⇒ **这是 JS 层调度开销主导的成本，不是磁盘**。
**线性度确证（同进程放大）**：文件数 2× → 耗时 **1.806×**、4× → **3.579×**，而 **µs/文件 139.3–155.7 保持平坦（±6%）**；跨目录对照（真实 root 179.0 ms vs `cp -r` 副本 183.0 ms）= **1.022×** ⇒ 成本由**文件计数**决定，与目录位置/内容无关。
**`findLog` 的 project 维放大（sa1 决定性对照）**：同样 10 个 id，**19 个 project = 30.79 ms**，**76 个 project = 119.92 ms** ⇒ **实测 3.895× vs 预测 4.000×** ⇒ `findLog` 对 project 数**严格线性**，O(projects) 被可控自变量直接证实（不是拟合）。边际 syscall 恒定：**311 syscall/id**（openat 77 / statx 76 / close 2 / getdents 2）。

**首帧读取代价与文件大小无关（实测，`firstframe-bench.json`，按大小分桶）**

| 桶 | n | 中位 |
|---|---|---|
| <64 KB | 229 | 0.0673 ms |
| 64 KB–256 KB | 446 | 0.0829 ms |
| 256 KB–1 MB | 453 | 0.0845 ms |
| 1 MB–4 MB | 44 | 0.0595 ms |
| 4 MB–16 MB | 33 | 0.0693 ms |
| ≥16 MB | 2 | 0.0571 ms |

⇒ 分桶中位全落在 **0.057–0.084 ms** ⇒ `readFirstZstdLine` 是 O(1)。
**更强的同窗对照（sa1 决定性实验：同一文件截断对比）**：把**同一个文件**的 `st_size` 做成 **2,784×** 之差（22,808,279 B vs 8,192 B），**21 次交错测得耗时比 = 0.988×**；1209 个文件的 大小-耗时 **Pearson r = −0.047**（无相关）。**每文件恰好 1 次 `openat` + 1 次 `read(8192)` + 1 次 `close`**（`strace -y` 逐 fd 证实）。**整库首帧扫描只读 9.90 MB = 语料 647.2 MB 的 1.53%**；最大 20 个文件上首帧 **2.338 ms** vs 全量 read+decode **66.453 ms** = **28.4×**。
⇒ **首帧设计是这条链路上唯一做对了的地方**；真正贵的是 2408+ 次 `exists()` 的 openat/ENOENT（§2.2）。

**日志尺寸分布（sa1，实测 1207 个）**：min 320 B / median **230,298 B** / p95 1,676,790 / p99 7,239,547 / max **22,808,279**；总 **645,915,950 B（616 MB）**。

### 2.3 冷启动（主档实测，`raw/m8-coldstart.json`）

忠实复现 `dsh-storage-json` 的 `openJsonUnit`（`:133-145`）= `readFile(path,'utf8')` + `JSON.parse` + `new Map(Object.entries(...))`（`:112`）：

| 步骤 | p50 |
|---|---|
| `readFile` 10.56 MB | 17.4 ms |
| **`JSON.parse` 10.56 MB（同步主线程）** | **17.27 ms** |
| `new Map(2856 entries)` | 0.55 ms |
| **合计** | **36.43 ms** |

sa2 档用**真实 deployed `JsonStorageBackend.openJsonUnit`** 独立测得 `load_ms = 39.2 ms`、`heapUsed` 增量 **+47.3 MB**（⇒ 2856 条记录的常驻内存约 **45–55 MB**）。两档互证。

### 2.4 判定

| 断言 | 判定 | 证据 |
|---|---|---|
| S1 启动扫描是 O(projects × sessions) 的文件系统 syscall 序列；1209 文件下 `listArtifacts()` = **165.9 ms（137 µs/文件）** | **PASS** | §2.2；放大 2×→1.806×、4×→3.579×，µs/文件平坦 ±6%；内核态仅占 37% |
| S2 首帧读取代价与日志大小无关（只付 header） | **PASS（强证）** | 同文件 `st_size` 比 **2784×** → 耗时比 **0.988×**；**r = −0.047**；每文件恰 1 openat + 1 read(8192) + 1 close；整库只读 **1.53%** 语料 |
| S3 `findLog` 是 O(projects) 每 id ⇒ N 个 id 为 O(N × projects) | **PASS（精确到常数）** | 每 id `exists` **恒为 76 = 4×19**（N=1/10/50/100 全为 76）；边际 **311 syscall/id 恒定**；N 维 66.3× 线性；**project 维 19→76 = 30.79→119.92 ms = 3.895× vs 预测 4.000×** |
| S4 启动**不**全量解压会话（懒加载），只付 header + projcache 的 10.56 MB `JSON.parse` | **PASS**（附一条被关停的例外路径，见 §2.7） | `list()` 只取 header；`preparedSessionCacheSize` 默认 5（`dsh-session-persistence/lib/index.js:434`）；projcache 解析 17.3 ms |
| S5 扫描是否阻塞宿主事件循环 | **PASS（不阻塞）** ← **已由 INCONCLUSIVE 更正** | 阳性对照 200.03 ms 同步阻塞 → ELD max **202.51 ms**（通道有效）；`listArtifacts`(1209) max **5.22 ms** / mean 5.03 ms（= 5 ms 分辨率地板）= 对照的 **0.026×**；机制 = 解压走 `promisify(zstdDecompress)` 在 libuv 线程池（`:580-582`） |
| S6 `assertStoredIdentity` 是否退化为 `realpath` 逐会话调用 | **PASS（未退化）** | 实测 `sameFile` = 0、`realpathPairs` = 0（`:1352-1356` 的 `path !== expectedPath` 短路生效） |
| S7 `checkRootEncoding()` 一次性成本 | **PASS** | median **31.2 ms / 1207 次 exists**（`lib/index.js:1402-1407`）；记忆化后 `exists` = 0（`1398-1400` 生效） |
| S8 `listSnapshots()` = `listArtifacts()` + 每 artifact 1 次 `stat` | **PASS** | 比值 **1.098×**；`strace` 显示 `statx` **+1207** |
| S9 全量 `loadStored` 1209 条的代价（= 把整库全量解压一遍） | **PASS** | **16,176 ms**（median 5.56 / p95 46.5 / max 624 ms） |

> ⚠️ **S5 的更正说明（测量档推翻主档结论，保留在案）**：主档初版把 S5 标为 INCONCLUSIVE，理由是「无法向宿主注入探针」。sa1 档在本机**同代码、同 Node/libuv 模型**下用 `enable→settle(300ms)→work`（**绝不在阻塞前 `reset()`**）并**配阳性对照**把通道钉死，实测扫描只造成 **5.22 ms** 事件循环延迟 ⇒ 该断言**可判定**，不需要宿主内注入。**因此主档把 S5 从 INCONCLUSIVE 更正为 PASS。**

### 2.5 与 `session.list` 的直接关系

`session.list` → `listVisibleSessionSummaries`（`dsh-host-apiproxy/lib/index.js:2224`）→ `await persistence.list(signal)`（**:2255**）⇒ **每次 `session.list` 都付一次 §2.2 的 `list()`（≈150 ms，2408 次 `exists` + 1204 次首帧解压）**。
这正是 incident2 D3 里"无 memo 全量重扫"的**剩余部分**（已修的是比较器 O(N log N × events)，`dsh-host-apiproxy/lib/index.js:2249-2254` 注释自陈 1.35 s → 0.166 s）。**扫描路径本身仍未 memo 化。**

### 2.6 sa1 顺带发现的三条**未被 memo 化**的调用点（供其它批次，实测）

| 调用点 | 成本 | file:line |
|---|---|---|
| **每个反馈请求**都调 `listSnapshots()` | **约 182 ms + 1209 次 stat** | `dsh-message-feedback/lib/index.js:355` |
| 一次 reconcile 调 **两次** `listSnapshots()` | 约 2 × 182 ms | `dsh-session-query-sqlite/lib/index.js:714,727` |
| **每次新建会话**都付一次 `loadStored` 探测 | **76 次 `exists`** | `dsh-session-persistence/lib/index.js:819-820` |
| 3 个 session 目录有陈旧 `session.v3.jsonl.zstd` 不被扫描 | 只占盘（清理项） | — |

### 2.7 ⚠️ 一条**被关停的冷启动地雷**（若有人"顺手打开"就是 61.9×）

存在一个**完整**的 sqlite 会话索引器：`dsh-session-query-sqlite/lib/index.js:532-534, 705-742`（724 行 `inspect()`），其 schema **默认 `openAt: "startup"`**（`:479-483, 1075`）——即"启动时把全库解压进 sqlite"。
**当前部署把它关掉了**：`dsh-base/cordis.patch.yml:117-121` 与 `dsh-web-app/cordis.patch.yml:30-33` 均为 `openAt: never`，且本机 `~/.dsh/profiles/web/cordis.patch.yml` **未覆盖**（sa1 三处交叉核对）。
**实测若打开**：**16,176 ms**（vs header 扫描 **261 ms** = **61.9×**），读 **647.2 MB**（vs 9.90 MB），且 `path: ":memory:"` ⇒ **每次启动重建，无持久化收益**。
⇒ 列为**「不要做」**项（§6.4）：任何"加上会话全文搜索/索引"的改动若把 `openAt` 从 `never` 改回 `startup`，会立刻给冷启动加 **16.2 秒**。

---

## 3. 问题③：`session_projcache.json` 的修法候选之前提——先量化现状

### 3.1 代码链（file:line，全链已核对）

```
session/event  ──► dsh-session-projection-cache/lib/index.js:199-228  installWritePath()
                   ├─ :201-204  turn/end  ⇒ flushSoft()    ← 无条件写
                   ├─ :211-213  pending >= writeEveryEvents(200) ⇒ flushSoft()   (config: dsh-web-app/cordis.patch.yml:79)
                   ├─ :215-217  首个脏事件后 writeIntervalMs(5000) ⇒ flushSoft()  (config: dsh-web-app/cordis.patch.yml:80)
                   └─ :219-223  session/disposed ⇒ flushSoft() + markClean()  ← 无条件写
                   │
                   ▼ :159-164  write(session)
                   │   ├─ :162  await ctx.sessions.flush(session)   ← 额外一次会话日志 fsync
                   │   └─ :163  await this.put(session.id, identity, rows)
                   ▼ :252-259  put()  ⇒ table.put(id, {...})
                   ▼ dsh-storage-domain/lib/index.js:246-249  table.put() → host.enqueue()
                   ▼ dsh-storage-domain/lib/index.js:210-214  enqueue(): this.chain = this.chain.then(job)
                        ▲▲ 每个 domain 一条 promise 链 ⇒ 所有 projcache 写严格串行、无并发
                   ▼ dsh-storage-json/lib/index.js:169-180  JsonKvUnit.putRecord()
                   ▼ dsh-storage-json/lib/index.js:219-224  publish()
                   ▼ dsh-storage-json/lib/index.js:25-41    writeAtomic()
                   │   ├─ :26   tmp = .<uuid>.tmp（同目录）
                   │   ├─ :30   handle.writeFile(data,"utf8")   ← 写 10.56 MB
                   │   ├─ :31   await handle.sync()             ← 文件 fsync
                   │   ├─ :35   await rename(tmp, path)         ← 原子替换
                   │   └─ :36   await fsyncDirectory(dirname)   ← 目录 fsync
                   ▼ dsh-storage-json/lib/index.js:68-80    serialize()
                       :79  `${JSON.stringify(document, null, 2)}\n`   ← ★ 整个 state 全量 pretty-print，同步、主线程
```

### 3.2 实测：真实 deployed 代码路径端到端（`node raw/m10-real-path.mjs`）

直接 `import` 部署的 `dsh-storage-json/lib/index.js` 的 `JsonStorageBackend`，用**真实 10.56 MB 载荷**、**真实 2856 条记录**调 `unit.putRecord("sessions", key, record)`：

| 量 | 实测 |
|---|---|
| `putRecord` 端到端 | **59 ms p50**（min 46.0 / p95 64.0 / max 64.0，n=10） |
| 事件循环最大延迟 | **40.6 ms** |
| 每次写字节 | **10,561,778 字节 = 整个文件** |
| 观测速率下写盘 | **5.07–7.02 MB/s**（inotify 权威；上界 15.58） |

**sa2-projcache 档独立复现**（runtime wrap `JSON.stringify` 捕获，未改产品文件）：`putRecord` 中位 **55.8 ms**、**`stringify` 单独中位 27.5 ms**、stringify 输出 10,429,594 字节。**两档互证（59 vs 55.8 ms；26.4 vs 27.5 ms）。**

### 3.3 拆解各项成本（主档，`raw/m1` / `raw/m7` / `raw/m10`；sa2 独立复现）

| 项 | p50 | 备注 |
|---|---|---|
| `JSON.stringify(state, null, 2)`（**同步、主线程**） | **26.4–28.1 ms** | 产出 **两字节 UTF-16 字符串**（含中文）⇒ 每次 **约 20.8 MB 分配** |
| `writeFile` 10.56 MB | 10.2 ms | 页缓存写 |
| **文件 fsync** | 5.3 ms | |
| rename | 0.12 ms | |
| **目录 fsync** | 4.4 ms | |
| **合计** | **46–64 ms** | 与实测 59 ms 吻合 |

**缩进/紧凑/fsync 的同窗对照（`raw/m1-projcache-cost.json`）**

| 变体 | stringify ms p50 | 字节 | writeAtomic total p50 | 相对现状 |
|---|---|---|---|---|
| **现状 `, null, 2`** | **28.08** | **10,561,777** | **21.20** | 1.00× |
| 紧凑 `JSON.stringify(x)` | **17.21** | **4,910,513** | 15.86 | stringify **1.63× 更快**、字节 **2.15× 更小**、I/O **1.34× 更快** |
| 现状但去掉文件 fsync + 目录 fsync | 28.08 | 10,561,777 | **10.60** | I/O **2.00× 更快** |

**GC / 分配（`raw/m7-gc-realism.json`，按实测 1.475 次/s 的真实到达率跑 30 s）**

| 量 | 实测 |
|---|---|
| 主线程同步阻塞 | **37.46 ms/s** |
| 分配速率 | **29.58 MB/s**（两字节字符串） |
| GC 暂停 | 1.66 ms/s，**单次最大 18.54 ms** |
| **事件循环延迟 max / p99** | **47.45 ms / 28.44 ms**（阳性对照 201.6，阴性 10.4 ⇒ 通道自证有效） |

### 3.4 修法候选的收益，从实测数字直接算

| 候选 | 收益（相对现状） | 依据 |
|---|---|---|
| (a) 去掉 `, null, 2` | stringify **−10.9 ms/次（1.63×）**；字节 **−53.5%（2.15×）**；I/O **−25%**；磁盘 5.1–7.0 → **约 2.4–3.3 MB/s**（上界 15.58 → 7.2）；主线程 13–17 → **约 6–8 ms/s**（上界 37.5 → 22.9） | §3.3 同窗对照 |
| (b) 合并/节流写（跨会话合批） | 发布次数按 5 s 合并窗 **约 0.66 → 0.2 次/s（约 3.3×）**；主线程块 **13–17 → 约 4–5 ms/s**；磁盘 **5.1–7.0 → 约 1.5–2.1 MB/s** | `raw/m11`（33/50 s）+ `writeIntervalMs=5000` |
| **(c) 按会话分片（恢复上游布局）** | 每次写 **10,429,594 B → 3,549 B**（**写字节 −99.97%**）；stringify **27.502 → 0.034 ms（阻塞 −99.876%）**；单次端到端 **55.83 → 5.60 ms** | **sa2 实测**（`sa2-projcache/raw/key-numbers.json`）+ 上游 diff `workstreams/upstream-015-diff/pkgs/dsh-session-projection-cache.libjs.diff:20-25` + 旧布局实物 `backup/B2/20260920-074510/legacy-projcache-tree.tar`（1,599 分片，均值 3,087.93 B） |

### 3.5 判定

| 断言 | 判定 | 证据 |
|---|---|---|
| P1 每次 `putRecord` **全量重写整个 projcache**（`, null, 2`），实测 **59 ms**、写 **10,561,778 字节** | **PASS** | `raw/m10`（真实 deployed 代码）+ `sa2-projcache/raw/a1-a3-rewrite-cost.json` |
| P2 该 stringify **同步阻塞宿主主线程**，实测 ELD max **40.6–47.5 ms**（阳性对照 201.6 / 阴性 10.4） | **PASS** | `raw/m7`,`raw/m10` |
| P3 缩进去除可省：stringify **1.63×**、字节 **2.15×**、I/O **1.34×** | **PASS** | `raw/m1` |
| P4 fsync/目录fsync 占比（**含量级更正**）：在 `writeAtomic` 内部 fsync 文件 40.2% + rename 12.4% + 目录 fsync 14.8%（fsync 合计 **55.0%**），全去使 **writeAtomic 21.20 → 10.60 ms = 2.00×**；**但 `writeAtomic` 只占端到端 55.83 ms 中的 11.02 ms ⇒ 去 fsync 实省仅 10.9%** | **PASS（含量级更正）** | `raw/m1`（writeAtomic 内部）+ **sa2** `a1-a3-rewrite-cost.json`（端到端占比）；⇒ **修缩进/分片都比去 fsync 更值** |
| P5 projcache 写频 **0.500 次/s（空闲窗）～1.273 次/s（繁忙窗）**，**双法逐个吻合**（inotify + 20 Hz inode 差分）；写放大 **5.07～12.90 MB/s**；间隔中位 501 ms、**最小 149 ms** | **PASS** | **sa2** `a5-publish-rate.json`（空闲 0.500/s→5.07 MB/s；繁忙 1.273/s→12.90 MB/s）+ `raw/m11`（0.660/s，`other=0`）；主档 `raw/m5` 的 1.475/s **降级为装载依赖上界**（§7.1bis） |
| P6 事件循环阻塞来自**写**路径而非读路径 | **PASS** | §4 |
| P7 常驻内存 = **45.13 MB（heapUsed 增量）/ 55.13 MB（GC 后）= 宿主 RSS 的 1.0–1.3% ⇒ 内存不是主问题** | **PASS** | **sa2** `key-numbers.json`；主档 `raw/m8` 独立得 +47.3 MB |
| P8 高扇出下 projcache 写入速率会升到 20–60 次/s（⇒ 主线程 528–1584 ms/s） | **INCONCLUSIVE** | 由代码的 per-session 定时器 + `turn/end` 无条件写**推出**，未在活体高扇出下实测（本会话不得制造 200 子代理负载）。**上界锚点**：繁忙窗实测已达 **1.273 次/s**（sa2），是空闲窗的 2.55× ⇒ 装载依赖已被实测证实，只是未测到扇出极值 |
| **P9** 单文件全量重写是**上游写放大回归**（旧版 per-record 分片），非设计本意 | **PASS（本档最重结构性发现）** | **sa2**：单分片 stringify **0.034 ms / 3,549 B** vs 全量 **27.502 ms / 10,429,594 B** ⇒ 阻塞 **−99.876%**、写字节 **−99.97%**（809× / 2,939×）；证据 `workstreams/upstream-015-diff/pkgs/dsh-session-projection-cache.libjs.diff:20-25` + `backup/B2/20260920-074510/legacy-projcache-tree.tar` |
| **P10** 分片化的收益在**主线程阻塞与写带宽**，**不在 fsync** | **PASS** | **sa2**：分片后 `writeAtomic` 仅 11.02 → 5.57 ms ⇒ **fsync 延迟与 payload 大小无关** |

---

## 4. 问题④：与 `session.list` 慢的耦合——谁在写、写多少、是否阻塞事件循环

### 4.1 谁在写

| 触发 | 位置 | 频率 |
|---|---|---|
| `turn/end` | `dsh-session-projection-cache/lib/index.js:201-204` | **无条件**，每次 turn 结束 1 次 |
| 计数阈值 200 事件 | `:211-213` + `dsh-web-app/cordis.patch.yml:79` | 每会话每 200 事件 |
| 间隔 5000 ms | `:215-217` + `cordis.patch.yml:80` | 每脏会话每 5 s |
| `session/disposed` | `:219-223` | **无条件**，每会话结束时 1 次 |

生效配置确证：`dsh-web-app/cordis.patch.yml:79-80` = `writeEveryEvents: 200` / `writeIntervalMs: 5000`；`~/.dsh/settings.yaml` **无任何覆盖**。
**live 观测到的形态**：59 次/40 s，且 31/59 的间隔贴到 100 ms 轮询地板（连发簇），其余间隔 200–5109 ms ⇒ **主要是 `turn/end` 的成簇触发，不是 5 s 间隔**（`raw/m5-live-rate.json`）。

### 4.2 写多少

- **projcache：5.07–12.90 MB/s**（0.500 空闲 / 1.273 繁忙 × 10.6 MB）——**每秒重写整个文件半次到一次以上**；主档轮询上界 **15.58 MB/s（1.475 次/s）**
- **会话日志：9.3 KB/s**（8.65 次/s × 1,077 B）
- ⇒ **545–1,387 : 1**。再叠加每会话至少一次 `turn/end` + 一次 `disposed` 的**无条件**写。

### 4.3 写入是否阻塞事件循环

**两条独立的阻塞通道，都已实测：**

1. **主线程同步阻塞（直接）**：`serialize()` 的 `JSON.stringify(整个 state, null, 2)` 在**主线程同步执行 26.4–27.5 ms**。实测 ELD max **47.45 ms / p99 28.44 ms**（sa2 独立得 max **41.29 ms**，阳性对照 208.27）；无此阻塞时基线 10.4 ms。⇒ **每次 projcache checkpoint 必然造成一次约 26–41 ms 的主线程停顿**，期间**所有 RPC 都被推迟**。
   占空比：**空闲窗 0.500 次/s ⇒ 13 ms/s（1.3%）**；**繁忙窗 1.273 次/s ⇒ 33.6 ms/s = 3.36%，与 sa2 独立实测的 3.50% 吻合**；上界 1.475 次/s ⇒ 37.5 ms/s。且是 25–40 ms 的**整块**（对应丢 1–3 帧）。
   ⚠️ **但这 3.5% 不足以解释 `session.list` 的 26–34 s CPU**（见 §4.6，C5 = FAIL）。
2. **线程池占用（间接）**：文件 fsync + 目录 fsync + 10.56 MB writeFile 全在 **4 个 `libuv-worker`**（宿主实测只有 301716–301719 四个）上，共 **9.7 ms/次 × 0.50–0.66 = 4.9–6.4 ms/s**（上界 14.3），并与会话日志 append 的 fsync（8.65 × 2.05 = 17.7 ms/s）、全部 zstd 压缩、以及 `session.list` 的 3612+2408 次 `exists` 争抢同一池。

**第三条：写链串行 + 额外 flush**
`dsh-storage-domain/lib/index.js:210-214` 让所有 projcache 写**串行**在一条 promise 链上，每链约 47–62 ms；而 `write()` 在 `:162` 还 `await ctx.sessions.flush(session)`（多一次会话日志 fsync）。⇒ **`turn/end` 的处理会排在其它会话的全量重写之后**，形成"扇出越大、每个 turn 越慢"的正反馈。

### 4.4 projcache 的**读**路径是零 I/O 的（重要澄清）

`session.list` 的投影列：`dsh-host-apiproxy/lib/index.js:1473-1481` `listProjectionsFor()` → `ctx.get("sessionProjectionCache")?.cachedSnapshot(meta)` → `dsh-session-projection-cache/lib/index.js:140-150`：`recordFor()` 是 `table.get(id)`（**O(1) 内存 Map 查**）→ `Object.keys` + `Math.min`（13–15 个键）。

⇒ **`session.list` 变慢与 projcache 的读取无关**；耦合 100% 在**写侧**（§4.3 通道 1/2/3）。这个区分很重要，它决定了修法方向是"减少/缩小写"而不是"加读缓存"。

### 4.5 判定

| 断言 | 判定 | 证据 |
|---|---|---|
| C1 `session.list` 的**读**路径不碰 projcache 的 I/O（纯内存 O(1)） | **PASS** | `dsh-host-apiproxy:1480` + `dsh-session-projection-cache:123-127,140-150` |
| C2 耦合在**写**路径：每次 checkpoint 同步阻塞主线程 26–40 ms，推迟所有 RPC | **PASS** | ELD 实测 40.6 / 47.45 ms，阳性对照 201.6 / 阴性 10.4 |
| C3 `session.list` 每次都付一次 `persistence.list()` 全量目录扫描（**166 ms** / 1209 文件 / 2408 `exists` + 1204 首帧解压），**未被 memo 化** | **PASS** | `dsh-host-apiproxy:2255`；§2.2 | ⚠️ **量级警告**：166 ms 只占当前 `session.list` 实测 **26–34 s 的 ≤1%**（§4.6）⇒ **真实成本、但不是主因** |
| C4 projcache 写链串行 + 额外 `sessions.flush()` ⇒ `turn/end` 排队 | **PASS** | `dsh-storage-domain:210-214`；`dsh-session-projection-cache:162` |
| C5 "session.list 慢的主因是 projcache" | **FAIL（projcache 被排除）** | **sa2 决定性同窗对照**：projcache 主线程占空比仅 **3.50%**（41.3 ms × 1.273 次/s，峰值 18.46%）——不可能产生 26–34 s 的 CPU 消耗；`session.list` **6/6 全部 25 s 超时**，每次烧 **26.2–34.3 s** 宿主 CPU（中位 29.1 s），而同窗 no-op 对照 RPC 仅 35–1000 ms（中位 264 ms）⇒ **≥95×**；且**"窗内是否发生 projcache publish" 对超时零区分度**（有写 3/3 超时、无写 3/3 也超时）。⇒ **projcache 不是该回退的原因**（它是真实的、但量级为 3.5% 的次因） |

---

### 4.6 🔴 `session.list` 的当前回退：**persistence 侧被量化排除（≤1%）**

sa2 在宿主存活期间做了同窗对照：

| 项 | 实测 | 依据 |
|---|---|---|
| `session.list` | **6/6 全部 25 s 超时**；每次烧宿主 **26.2–34.3 s CPU**（中位 29.1 s） | sa2 `key-numbers.json` |
| 同窗 no-op 对照 RPC | 35–1000 ms（中位 **264 ms**）⇒ **≥95×** | sa2 |
| 区分度检验 | **"窗内是否发生 projcache publish" 对超时零区分度**（有写 3/3 超时、无写 3/3 也超时） | sa2 |
| 基准对照 | incident2 修复后记录为**中位 0.166 s**（`incident2/VERDICT.md` D3） ⇒ **这是新回退** | `.workspace/lag-fix/incident2/VERDICT.md` |

**本档范围（持久化读路径）能贡献多少？——上界 ≤ 0.25 s / 26–34 s ≈ ≤1%**：

| 成分 | 实测/上界 | file:line |
|---|---|---|
| `persistence.list()` 全量扫描 | **166 ms**（1209 文件；内核态仅 37%，其余是 ~6,100 次 fs-promise 往返） | `dsh-host-apiproxy:2255` → `dsh-session-persistence-jsonl:1060-1102` |
| 冷摘要探针 `probeColdSessionMetadata` | 每冷会话 **1 次 `stat`**；只有 **≤`coldBlankProbeMaxBytes`（默认 1024，无部署覆盖）** 才走 `readFrom`（含 `findLog` 的 76 次 exists）。**盘上 1209 个日志中只有 7 个 ≤1024 B**（实测 `{<1KB:7, 1KB-1MB:1123, 1-10MB:74, >10MB:5}`）⇒ 该昂贵分支**几乎不触发**（7 × 76 ≈ 532 exists ≈ 20 ms） | `dsh-host-apiproxy:1332,1712`；`dsh-session-persistence-jsonl:832/844/873,1315` |
| **持久化侧合计** | **≤ 0.25 s ⇒ 占 26–34 s 的 ≤1%** | 上两行 |

**⇒ 结构性指向（本档给出判据，绝对量需专线实测）**：`listVisibleSessionSummaries`（`dsh-host-apiproxy/lib/index.js:2224`）对**每个活会话**做事件折叠 **2–3 遍**：
`summarize()` 里 `sessionListMetadata(session.events)`（`:1291`）**又** `sessionListFields(header, session.events)` → `resolveSessionPreset({header, events})`（`:1276-1280`）；再加 `attachedRecency` 预计算里的第二遍 `sessionListMetadata(session.events)`（`:2249-2250`）。
B1-perf 只消掉了**排序时的 O(N log N) 乘数**，剩下的 **2–3 遍 O(总活体事件数)** 仍在 ⇒ 建议开**「`session.list` 活体事件折叠 / 摘要路径」专线**，并先做宿主内采样或 CDP trace 定位。**不要在 projcache 上继续找原因。**

> ⚠️ **对全组的操作影响**：BATCH-PLAN §四把「`session.list` 200 与顶层行齐全」当作**冷面验收的通用回归哨兵**。该哨兵**当前不可用**（会 25 s 超时，每次烧 26–34 s 宿主 CPU）⇒ 本批任何冷面单元落地时，**不要用 `session.list` 作哨兵**，否则会（a）误判为本次改动引入的回退，（b）每跑一次哨兵给宿主加重 26–34 s CPU 负载，污染同窗测量。**替代哨兵**：直接读 `~/.dsh/sessions` 首帧统计（`listArtifacts()` 的 header 数，实测 **1,209**）+ 目标 unit 的专属断言。

---

## 5. 问题⑤：磁盘/内存增长趋势与清理策略

### 5.1 projcache 的增长（实测两点 + 单调性）

| 时点 | 字节 | 记录数 |
|---|---|---|
| 2026-09-20T07:45（`backup/B2/20260920-074510/meta/session_projcache.json`） | 8,842,703 | 2400 |
| 2026-09-22T06:33（live） | **10,561,778** | **2856** |
| **46.8 h 增量** | **+1,719,075（+19.44%）** | **+456** |
| **速率** | **+36.7 KB/h = +880 KB/日** | **+9.74 条/h** |

### 5.2 无任何回收机制（PASS = 事实确证）

- projcache 只有 `put`（`dsh-session-projection-cache/lib/index.js:255`），**从不调用 `deleteRecord`**；`:222` 的 `this.dirty.delete(session)` 是**内存脏表**，不是持久表。
- 存储域**有** `deleteRecord`（`dsh-storage-domain/lib/index.js:254-258`），但 projcache **不用**。
- 全产品 grep：**无** `retention` / `maxAge` / `prune` / `evict` / `maxSessions` / 会话清理，且 `session.delete` **零命中**。（`dsh-session/lib/index.js:1089` 的 `"compaction/prune"` 是**事件类型名**，不是磁盘清理。）
- **产品自述**：`dsh-session-projection-cache/README.md:61` = **「No eviction or retention surface」**（sa2 找到）；`deleteRecord` 定义在 `dsh-session-projection-cache:181-191`（sa2 定位）**无调用者**。

### 5.3 孤儿记录

跨盘比对 projcache 的 2856 个 id 与磁盘 1207 个会话目录：

| 项 | 值 |
|---|---|
| projcache 记录数 | **2856** |
| 磁盘会话目录/日志数 | **1207** |
| 能对上的记录 | 1186 |
| **孤儿（磁盘上已无日志）** | **1670 = 58.5%** |

⇒ 记录只增不减，**已经有一半以上是永远不会再被读到的死记录**，却仍在**每一次全量重写中被序列化和写盘**。这是 §3 成本的**结构性放大器**：`serialize()` 的成本 ∝ 全部历史记录数，而不是活跃会话数。

**外部独立交叉验证（sa2，强证据）**：团队 B2 归档里的 `deletable-dirs.list` 有 **1,670 行**（= 已被删除的会话目录），sa2 **逐行核查盘上 0/1670 存在**；而这 1,670 条记录 **（58.4%）仍留在 projcache 里**，文件从 8.84 → 10.64 MB **不缩反涨（约 0.88 MB/天）**。
⇒ 主档独立算出的 **1670/2856 = 58.5%** 与 sa2 的 **1670 条（58.4%）** **两条独立路径吻合**。

**产品自述（最硬的一条）**：`dsh-session-projection-cache/README.md:61` 自己写着 **「No eviction or retention surface」** ⇒ 不是"我们没找到清理机制"，而是**设计上就没有**。

### 5.4 磁盘与内存现状

| 项 | 实测 |
|---|---|
| `~/.dsh/sessions/` | 19 project、1207 会话目录、1207 日志、**617.3 MB**（全部文件 1213） |
| 最大单日志 | 22.8 MB（`session-6a7367fe…`） |
| 单日志大小分布 | min 320 B / p50 228 KB / p95 1.69 MB / max 22.8 MB |
| 最大项目 | `Dexterous_Hand_23Dof` 559 日志 196.1 MB；`dsh` 398 日志 191.0 MB |
| 真实压缩比 | **2.38×** ⇒ 617 MB ≈ 1.47 GB 明文 |
| projcache 常驻内存 | **45.13 MB heap（GC 后 55.13 MB）** = 宿主 RSS 的 **1.0–1.3% ⇒ 内存不是主问题**（`dsh-storage-json:149`） |
| 宿主 VmRSS | **3.63 GB**（主档 14:34 读）/ **4,350 MB**（sa2 稍后读）——宿主在增长 |

### 5.5 判定

| 断言 | 判定 | 证据 |
|---|---|---|
| G1 projcache 单调增长，**+36.7 KB/h（= 0.88 MB/日）**，sa2 独立两点斜率也得 **约 0.88 MB/日** | **PASS** | 主档两点（8.84 MB/2400 → 10.56 MB/2856 @46.8 h）；**sa2** 独立得 0.88 MB/天（sa2 自标为"两点单点斜率，非回归"） |
| G2 **不存在**任何 projcache / 会话日志的清理、保留期、淘汰机制 | **PASS（确证"无"）** | §5.2 |
| G3 58.5% 的 projcache 记录是孤儿，却仍被每次全量重写 | **PASS** | §5.3 |
| G4 写量 ∝ 文件大小 ⇒ 1 月约 12–17 MB/s（上界 38）、1 年约 160–210 MB/s（上界 475）+ 805 ms 同步 stringify | **INCONCLUSIVE（线性外推，非实测）** | §3.4/§3.5 的实测尺寸-成本关系外推；未在增长后实测 |
| G5 会话日志磁盘增长速率（MB/日） | **INCONCLUSIVE** | 只有单时点 617 MB；缺历史快照（`backup/` 下无 sessions 副本）。需要一段时间的重复采样 |

---

## 6. 前三修复候选（含收益 / 风险 / 验收 / 回滚 / 热面或冷面）

> **前提声明（必须随候选一起转述）**
> 1. 以下候选**都不能宣称"修复了 `session.list` 慢"**。`session.list` 当前是 **25 s 超时的活体回退**（burns 26–34 s CPU），而 **projcache 已被实测排除（C5 = FAIL，§4.6）**，持久化侧对该回退的贡献上界 **≤1%** ⇒ **修 projcache 不会修好 `session.list`**；那条需要单独专线（§4.6 末尾）。
> 2. 以下候选的收益是**针对"projcache 自身的写成本与无界增长"**，以及它作为**线程池/主线程次因（3.50% 占空比）**的削减。
> 3. **sa2 的 P9 发现改变了候选排序**：单文件全量重写是**上游 per-record 分片布局的回归**，仓库里有 diff 与旧布局实物 ⇒ 最高收益项同时是**收益最高、风险显著低于原评估**的一项。

### 候选 1（**推荐首选**，收益最大且**已由 P9 降级为"回归修复"**）：projcache 恢复 per-record 分片布局 + 孤儿回收

| 维度 | 内容 |
|---|---|
| **改动点** | 把 `session_projcache` 从"**一个 unit 一个文件、整份 state 一次 publish**"（`dsh-storage-json/lib/index.js:1-4, 68-80, 219-224`）**恢复为上游的 per-record 分片布局** `<root>/session_projcache/sessions/<id>.json`（一次 checkpoint 只重写一个会话文档）。**这不是新设计——上游本来就是这样**：证据 = 仓库内 `workstreams/upstream-015-diff/pkgs/dsh-session-projection-cache.libjs.diff:20-25` + 旧布局实物 `backup/B2/20260920-074510/legacy-projcache-tree.tar`（**1,599 分片，均值 3,087.93 B**）。同时把 `defineDomain` 的 `version: 3` → `4`（`dsh-session-projection-cache/lib/index.js:58-62`），**语义即"丢弃旧介质 + 冷读重放"，因为缓存 only-stale 不是权威**（`:69-75`）；并按 §5.3 的孤儿比对做**启动期一次性孤儿回收**（对无日志的记录调 `dsh-storage-domain:256 deleteRecord`） |
| **收益（实测支撑，sa2）** | 每次写 **10,429,594 B → 3,549 B（写字节 −99.97%）**；stringify **27.502 ms → 0.034 ms（阻塞 −99.876%）**；单次端到端 **55.83 → 5.60 ms**；⇒ 主线程占空比 **3.50% → ≈0.04%**；磁盘 **5.07–12.90 MB/s → 约 5–13 KB/s**；**并且把 §5.3 的无界增长从"必然"变成"可回收"**（一次性消掉 58.5% 的孤儿） |
| **风险** | **中**（原评"高"，因 P9 降级：**这是回到上游布局的回归修复，不是发明新格式**）。① 仍需确认 `dsh-storage-domain` 的 `domainTable` 能否承载 per-key 分片（上游做过 ⇒ 有先例可循）；② 需确证 `coldSnapshot` 冷读阶梯（`dsh-session-projection-cache:177-198`，依赖 `readFrom(id, floor)` 的 tail + `identityMatches`）在分片后行为不变；③ 孤儿回收判据需"日志确实不存在"，避免把**暂时不可达**（外挂盘/权限）误判为孤儿而删掉活记录 —— 必须双向确认，且对任何 I/O 错误**一律假定存活、不删**（同 BATCH-PLAN §五.17 的存活判据纪律） |
| **⚠️ 必读的收益边界** | 分片**不会**明显改善 fsync：sa2 实测分片后 `writeAtomic` 仅 **11.02 → 5.57 ms**（**fsync 延迟与 payload 大小无关**）⇒ 收益在**主线程阻塞与写带宽**，**不在 fsync**。验收时不要用"fsync 变快"当判据。 |
| **验收** | ① 写盘字节/次 **< 10 KB**（现状 10,429,594 B）；② 冷读同一会话的 `coldSnapshot` 与改前**逐键同值**（同窗对拍）；③ `persistence.list()` 的 header 数仍为 **1,209**（**替代哨兵，见 §4.6 —— 不要用 `session.list`，它当前 25 s 超时**）；④ projcache 介质文件数 = 有日志的会话数（实测应 ≈1207，而非 2856）；⑤ 重启后无 `malformed-medium`；⑥ 孤儿回收的**反例测试**：构造"日志存在但读不出"的场景，断言**不删**；⑦ ELD max（带阳性对照）在 30 s 窗口内的占空比 **≤0.1%**（现状 3.50%） |
| **回滚** | 改回单文件实现；已丢弃的旧介质无需恢复（缓存语义），冷读自动重放 ⇒ **回滚无数据损失** |
| **面** | **冷面（重启）** |

### 候选 2（**最低风险**，1 行量级）：projcache 序列化改紧凑，且**按 unit 可配置**以保住可读性

| 维度 | 内容 |
|---|---|
| **改动点** | `dsh-storage-json/lib/index.js:68-80` `serialize()` 的 `JSON.stringify(document, null, 2)` → 由 descriptor 决定缩进（新增 `indent?: 0 \| 2`），`session_projcache` 域传 `indent: 0`，`workspace.json` 保持 2 |
| **收益（实测支撑，两档互证）** | 主档同窗对照：stringify **28.08 → 17.21 ms（1.63×）**、写字节 **10,561,777 → 4,910,513（2.15×）**、writeAtomic **21.20 → 15.86 ms（1.34×）**；**sa2 独立测得 −47.0% 耗时（25.91 → 13.73 ms）、−54.2% 字节（10.43 → 4.77 MB）**，两档交叉后保守取 **−38.7%**。⇒ 磁盘 **5.07–12.90 → 约 2.4–6.0 MB/s**；主线程占空比 **3.50% → 约 1.6–1.9%**；GC 分配 **29.6 → 约 13.8 MB/s** |
| **风险** | 低。`serialize` 的 pretty-print 是该后端**明示的存在理由**（`:56-60`："that legibility is this backend's reason to exist"）⇒ **不能全局改**，必须按 unit 配置；`parse()`（`:87-115`）不依赖缩进，**格式向后兼容**，旧文件仍可读，读后写回即变紧凑 |
| **验收** | ① 同窗对照 `JSON.stringify` 字节比 = **2.15×**、耗时比 **1.63×**（sa2 独立得 2.151× / 1.632× ⇒ 两档一致）；② `putRecord` p50 同窗对照下降 ≥ 25%；③ 紧凑文件能被 `openJsonUnit`→`parse` 正常加载（域 version 3 不变，`parse` 不依赖缩进）；④ `workspace.json` 仍为 pretty（**未被误伤**）；⑤ **`session_projcache` 域仍能冷读**：`coldSnapshot` 逐键同值。**⚠️ 不要用 `session.list` 作回归哨兵（§4.6）** |
| **回滚** | 改回 `indent: 2`（一行） |
| **面** | **冷面（重启）**（宿主插件） |

### 候选 3（收益最小，但改动面也最小）：projcache 跨会话合并写（纯节流，不动布局与格式）

| 维度 | 内容 |
|---|---|
| **改动点** | ① `dsh-session-projection-cache/lib/index.js:199-228` 把 per-session `flushSoft` 汇入**一个全局写队列**，用单个 5 s 窗口把多个会话的 checkpoint 合并成**一次** `publish`；② 配套给 `JsonKvUnit` 加 `putMany(table, entries)`，让一次 publish 承载多条记录。**注意**：sa2 实测 `writeIntervalMs: 5000` 已吸收大部分节流收益（10000 ms 才能把占空比 3.50%→1.75%）⇒ **本项收益有限**，排在分片与紧凑序列化之后 |
| **为何不把"去 fsync"放进来** | 见下方「不要做」：端到端只省 **10.9%**（sa2 实测 `writeAtomic` 仅占 55.83 中的 11.02 ms）且牺牲崩溃持久性 ⇒ 不值得与节流捆绑 |
| **收益（实测支撑）** | 发布次数按 5 s 合并窗 **约 1.273 → 约 0.2～0.3 次/s（约 4–6×）**；主线程占空比 **3.50% → 约 0.6–0.9%**；磁盘 **5.07–12.90 → 约 1.0–2.6 MB/s**（**但 sa2 指出：`writeIntervalMs=5000` 已吸收大半节流收益，故实测增量小于此表**） |
| **风险** | 中低。合并后**单个会话的 checkpoint 可能晚 ≤5 s 落地**（但 `turn/end` 与 `disposed` 两个强制点必须保持"立即写"，否则冷读回退更远）——需明确保留这两个强制点，并在验收里对它们单独断言。**（可选附加项）** 若同时去掉目录 fsync（`dsh-storage-json:36`），可再省 4.4 ms/次；掉电可能丢最后一次 rename 的目录项，但 rename 是**替换**语义（`:12-16`），最坏回退到上一版本，而 projcache 是**缓存**（`:69-75` 自陈 "never wrong, only stale"）⇒ 可接受。 |
| **验收** | ① **inotify `rename` 计数**测发布频率 **≤ 0.2 次/s**（现状 **0.500 空闲 / 1.273 繁忙**；⚠️ 不要用 `stat` 轮询，§7.1）；② `putRecord` p50 同窗对照，目标 ≤ 15 ms；③ `perf_hooks` ELD **max < 20 ms**（必带阳性对照 + 阴性对照，且阻塞后要 `await sleep(resolution)` 再读，§7.1）；④ **强制点断言**：`turn/end` 与 `session.disposed` 的 checkpoint 仍**立即**落地（不被合并窗推迟）；⑤ 冷读阶梯 `coldSnapshot` 对同一会话返回**同一** checkpoint 内容（同窗前后比对）；⑥ 重启后 projcache 能被 `parse()` 正常加载。**⚠️ 不要用 `session.list` 作回归哨兵 —— 它当前是 25 s 超时的活体回退（§4.6）** |
| **回滚** | 常量开关（`mergeWindowMs=0` 即恢复逐次写）；可选的去目录 fsync 用一行恢复 |
| **面** | **冷面（重启）**——`dsh-session-projection-cache` 与 `dsh-storage-json` 均为宿主插件；`writeEveryEvents`/`writeIntervalMs` 走 Config，无 settings 热通道 |

### 6.4 明确**不要做**（负收益或高风险，实测依据）

| 事项 | 实测依据 |
|---|---|
| **提高 zstd 级别** | level 19 = **57.8 ms**（level 3 的 50×）只换 **28%** 体积；append 里压缩只占 2.12 ms 的 ~0.01–1.1 ms ⇒ 纯亏（`raw/m9`） |
| **把 zstd 换成 none 以省 CPU** | 磁盘 617 MB → 约 1.47 GB（压缩比 **2.38×**），且 append 的 97% 是 fsync 不是压缩 ⇒ 几乎零收益、纯亏磁盘 |
| **只去文件 fsync、不配损坏自愈** | 省 5.3 ms/次（I/O 1.34×），但 `openJsonUnit`（`dsh-storage-json:133-145`）在 `parse` 失败时**直接抛 `malformed-medium`、无自愈** ⇒ 掉电截断会导致该 unit 打不开。必须先加"解析失败 ⇒ 改名备份 + 重建空 state"再考虑 |
| **在 `cachedSnapshot` 上做微优化** | 读路径是 O(1) 内存 Map + 13–15 键的 `Object.keys`/`Math.min`（`dsh-session-projection-cache:140-150`）⇒ 零收益（§4.4） |
| **加读缓存来解决 `session.list` 慢** | ① `session.list` 的 projcache **读**路径是零 I/O 内存 O(1)（§4.4）；② 持久化**写**路径已被实测排除（占空比 3.50%，C5 = FAIL）；③ 持久化**读**路径上界仅 **≤1%**（§4.6）⇒ **三条都打错靶**，真靶在 `dsh-host-apiproxy` 的**活体事件折叠 2–3 遍**（`:1291,1276-1280,2249-2250`） |
| **优先去 fsync** | 端到端只省 **10.9%**（sa2 实测：`writeAtomic` 仅占 55.83 ms 中的 11.02 ms，因为 **fsync 延迟与 payload 大小无关**）且牺牲崩溃持久性；**应先做分片与去缩进**（§候选 1/2）。若只做"去目录 fsync"（`:36`）可省 4.4 ms/次且 rename 是替换语义、缓存可丢 ⇒ 可作为候选 3 的可选附加项 |
| **只调 `writeEveryEvents` / `writeIntervalMs` 当成主修法** | sa2 实测 200/5000 已吸收大半节流收益（10000 ms 才把占空比 3.50%→1.75%）⇒ 增量有限，排候选 3 |
| **把 sqlite 会话索引器的 `openAt` 从 `never` 改成 `startup`** | 实测 **16,176 ms vs 261 ms = 61.9×**，读 647 MB，且 `:memory:` 每次重建 ⇒ 冷启动 +16.2 s（§2.7） |
| **为 `session.list` 做"首帧读优化"** | 首帧读已被证明 O(1)、只占语料 **1.53%**、整库仅 9.90 MB ⇒ **零空间**（§2.2 S2） |
| **把 `exists()`（open+close）换成 `stat`** | 需先测：`strace` 显示 `openat` 2624 次 ENOENT 是主要开销（§2.2），但 `statx` 也已 2586 次；换成 `stat` 只能省一半 syscall，**真正的 104 ms 是 promise 往返**（§2.2）⇒ 优先做**调用点 memo**，不是换 syscall |

---

## 7. 仪器、边界与诚实清单

### 7.1 仪器自证（都带阳性 + 阴性对照）

- **事件循环延迟**：`perf_hooks.monitorEventLoopDelay`，一律 `enable → settle(60 ms) → 工作 → 采`，**绝不在阻塞前 `reset()`**（BATCH-PLAN §五.8）。
  对照实测：**阳性 200/201.6 ms、阴性 10.4/10.3 ms**，逐条实验都带 ⇒ 通道有效。
- **进程存活/身份判据**：不用 `readlink(/proc/<pid>/exe)`（本环境普遍 EACCES，BATCH-PLAN §五.17）；统一读 `/proc/<pid>/cmdline`。
- **宿主识别**：`/proc/301709/cmdline` = `node /home/CNS2026495165/.npm-global/bin/dsh web`；线程名实测 `libuv-worker` × 4。
- **同窗对照**：§3.3 的缩进/fsync 对照、§1.2C 的 zstd 级别对照、§1.3 的串行/并发对照 **均在同一进程同一轮次内**完成；跨窗口绝对数**一律未作为证据**。
- **独立复现**：projcache 的 `putRecord` 与 `stringify` 由主档（自研 harness + 真实 deployed 模块）与 sa2 档（runtime wrap `JSON.stringify` 捕获）**两套独立实现**得到 59 / 55.8 ms 与 26.4 / 27.5 ms，互证。
- ⚠️ **BATCH-PLAN §五.8 之外的第 2 个直方图陷阱（sa2 发现，建议并入团队纪律）**：`monitorEventLoopDelay` 的延迟样本由内部定时器回调在**宏任务**阶段落库；阻塞结束后若只 `await` 一个**已 resolve 的 async 函数**，续体作为**微任务**先跑，`h.max` 会在样本落库前被读走 ⇒ **sa2 首轮把 200 ms 阳性对照误报成 10.07 ms**。**修法**：阻塞后额外 `await sleep(resolution)`（sa2 用 300 ms）再读 `h.max`。
  - **主档自查**：本档所有 ELD 读取都在工作后 `await setTimeout(20–25 ms)`（**定时器 = 宏任务**）再读 ⇒ **不受此陷阱影响**；阳性/阴性对照逐条复现（200/201.6 vs 10.4/10.3）即为自证。
- ⚠️ **频率量的仪器纪律（主档自曝，§7.1bis）**：`stat`/`mtime` 轮询测"文件被改了几次"会**分辨率饱和（2 s 采样全钉 2002 ms）且受负载偏移**（sa2 与主档各自踩到）⇒ **必须用事件式的 inotify `rename` 计数**。

### 7.1bis ⚠️ 仪器冲突仲裁：projcache 发布速率（**本档自曝并已更正**）

三个仪器给出 **3× 分歧**，必须仲裁而不是挑一个：

| 仪器 | 窗口 | 次数 | 速率 | 判定 |
|---|---|---|---|---|
| **inotify `rename` 事件计数**（sa2，`fs.watch`） | 90 s | 45 | **0.500 /s** | **权威** |
| **inotify `rename` 事件计数**（主档仲裁，`raw/m11`） | 50 s | 33 | **0.660 /s** | **权威** |
| mtime 轮询 100 ms（主档 `raw/m5`） | 40 s | 59 | **1.475 /s** | **仅作上界** |

**为何 inotify 权威**：`writeAtomic`（`dsh-storage-json:25-41`）每次 publish **恰好一次 `rename()`**；主档仲裁窗口内实测 `other = 0`（无任何非 rename 事件）⇒ **rename 计数 == publish 计数**，且是**事件式**而非采样式。
**为何 mtime 轮询只作上界**：它是 100 ms 采样，**分辨率地板就是 100 ms**（实测 31/59 个间隔贴在 100 ms 地板），且**装载依赖**——该 40 s 窗口内主档 + 两个子代理 + 兄弟线同时在跑 ⇒ `session/event` 更多 ⇒ `turn/end` 更多 ⇒ 发布更密。反证：50 s 的 inotify 窗口里 **0/32 个间隔 < 300 ms**（min 379 ms），而 m5 窗口声称有 31 个 ≤110 ms 的间隔 ⇒ 两窗口的**真实负载确实不同**，不是同一现象的两个读数。

**结论与纪律**
1. 头条数字一律用 **inotify 权威口径 0.50–0.66 次/s / 5.1–7.0 MB/s**；m5 的 1.475 次/s / 15.58 MB/s 明确标注为**较忙窗口的装载依赖上界**。
2. **发布是突发的**（inotify：min 379 ms、p50 1364 ms、p90 2025 ms、max 7640 ms）⇒ **均值低估了突发时的主线程停顿密度**；偶发连发时可在数百 ms 内叠加 2–3 次 26–40 ms 停顿。
3. 该分歧**不改变任何结论方向**：即使用保守口径，projcache 仍比会话日志多写 **550×**，仍是**每次一小段 26–40 ms 的主线程硬阻塞**，且仍**只增不减**。
4. 教训（供全组）：**"文件被改了几次"这类频率量必须用事件式仪器（inotify）**；用 `stat` 轮询得到的频率**分辨率与负载双重有偏**，不得作为头条。

### 7.2 边界（不得外推）

1. **写探针在 workspace 而非 `~/.dsh`**（本会话对 `~/.dsh` 无写权限，审批已禁用，未申请升级）。两侧经 `findmnt -T` 确认同为 `/dev/nvme0n1p2` ext4 ⇒ **I/O 量级与相对比值有效**；但**宿主 `~/.dsh` 所在目录的 ext4 目录规模更大**，其 rename/目录 fsync 的绝对值可能与本测略异 ⇒ 绝对 ms **不作跨目录断言**。
2. **未能在宿主进程内注入探针** ⇒ "宿主主线程被 projcache 阻塞多少 ms"是**同构载荷的外推**（同 Node 版本、同 ext4、真实 deployed 代码、真实载荷），不是宿主内直采。已在 §4.3/C2 标注。
3. **高扇出（200–1082 子代理）下的实测缺失**：本会话不得制造该负载（会污染宿主与兄弟线）。§1.3 的饱和与 §3.5 P8 的高速率均为**代码推导 + 单机扩展律外推**，标 INCONCLUSIVE。
4. **锁纪律**：本档**未创建任何 `.probe.lock`**、未启动任何浏览器、未做任何写盘到共享目录的动作 ⇒ 与兄弟线无资源冲突。全部写操作限于本档独占目录。
5. **未改动任何产品文件**：`~/.npm-global/lib/node_modules/@deepseek-ai/dsh/` 下所有文件仅读取。`sha256` 前后一致，见各档 raw JSON 的 `moduleSha256`（sa1 记录 `8b6ebc45…d97f3`）。
6. **被测规模在审计期间漂移**：N 从 **1185 → 1209**（+2.0%，宿主实时增长）⇒ 绝对毫秒只能绑定当时的 N；**比值与扩展律不受影响**（sa1 已标注）。
7. **宿主进程内探针不可得（两个独立确认）**：sa1 与 sa2 **各自独立**实测 **`/proc/301709/io` 返回 EACCES** ⇒ ① "宿主主线程真实阻塞多少 ms" 与 ② "projcache 占宿主总写带宽比例" **两项均无法直采**；现有数字是同构载荷/间接判据，已在 §4.3/C2 与 §7.3 对应行标注所需条件。
8. **审计期间发现一条与本书无关但更严重的活体回退**：`session.list` 25 s 超时（§4.6）。本档只做**排除性归因**（persistence ≤1%），**未**给出其修复方案。

### 7.3 全表 PASS / FAIL / INCONCLUSIVE

| # | 断言 | 判定 | file:line | 数字 / 比值 |
|---|---|---|---|---|
| A1 | append **不**重压全文件，成本 O(1) | **PASS** | `dsh-session-persistence-jsonl/lib/index.js:1180-1183,1200-1227` | 22.8 MB 文件含 **69,229 帧**（均 329 B）；每次只写新帧 |
| A2 | zstd 级别 = 3（Node 默认），压缩非瓶颈；提高级别负收益 | **PASS** | `:494` `CHECKSUM_OPTIONS`（无 level） | 默认实测 65,702 B == level 3 的 65,702 B；L19 = 57.8 ms 换 28% |
| A3 | append 成本 97% 来自 fsync，2.1–3.0 ms/次 | **PASS** | `:1214` `handle.sync()` | fsync 2.047 / 合计 2.12 ms = **96.6%** |
| A4 | 每次 append 一次 fsync，窗口仅在空队列时 arm | **PASS** | `dsh-session-persistence/lib/index.js:324-333,355-359` | 空队列才 arm ⇒ 事件率 <5/s 时**每事件一 fsync** |
| A5 | append 不阻塞主线程（fsync 在线程池） | **PASS** | `:492-493`（async zstdCompress） | 真实 zstd(200×4KB) ELD max **10.1 ms**（阳性 201.3 / 阴性 10.3） |
| A6 | append 路径上限 ≈ 570 次/s；1082 子代理规模会饱和 | **FAIL（上限实测 PASS，饱和未测）** → 整体 **INCONCLUSIVE** | 同上 | 50 并发 p50 **82.2 ms** vs 串行 2.9 ms = **28.3×**；吞吐 570 vs 378 次/s（仅 1.5×） |
| A7 | "99 顶层 + 200 子代理"规模假设 | **FAIL（低估）** | `sa1-scan/raw/real-ids-summary.json` | 实测 **125 顶层 + 1082 子代理 = 1207** |
| A8 | 真实压缩比 | **PASS** | `:572-574` | **2.38×**（431,255 → 181,372 B，400 帧采样） |
| S1 | 启动扫描 O(projects×sessions)；1207 日志下 `list()` ≈150 ms | **PASS** | `:1090-1119,1362-1373` | `list` 中位 **150 ms**、`exists` **2408**、`readFirstZstdLine` **1204**；`listArtifacts` 单次 **24,976** 次 syscall（其中 2624 openat 为 ENOENT） |
| S2 | 首帧读取代价与日志大小无关 | **PASS** | `:1279-1313` | 8192 B 分块 + `maxFrames=1`；实测跨 **320×** 尺寸范围中位 **0.0673 → 0.0693 ms（比值 1.03）** |
| S3 | `findLog` O(projects)/id ⇒ N 个 id 为 O(N×projects) | **PASS** | `:1315-1342,1408-1419` | 插桩 **76 `exists`/id** + **`strace` 实测 77.0 `openat`/id**（两法互证）；2.69 ms/id；N=100 ⇒ **269 ms**、9287 openat |
| S4 | 启动不全量解压；只付 header + projcache 的 `JSON.parse` | **PASS** | `list()` 只取 header；`dsh-session-persistence/lib/index.js:434` | projcache 冷启动 **36.4 ms**（read 17.4 + parse 17.3） |
| S5 | 扫描是否阻塞宿主事件循环 | **INCONCLUSIVE** | — | 无法向宿主注入探针；未直采 |
| S6 | `assertStoredIdentity` 未退化为逐会话 realpath | **PASS** | `:1352-1356` | `sameFile` = 0、`realpathPairs` = 0 |
| P1 | 每次 `putRecord` **全量重写整个 projcache**，实测 59 ms / 10,561,778 B | **PASS** | `dsh-storage-json/lib/index.js:169-180,219-224,25-41,68-80`；调用方 `dsh-session-projection-cache/lib/index.js:252-259` | **59 ms p50**（46–64）；每次写 **10,561,778 B** |
| P2 | 该 stringify 同步阻塞主线程，ELD max 40.6–47.5 ms | **PASS** | `dsh-storage-json:79` | ELD max **40.6 / 47.45 ms**（阳性 201.6 / 阴性 10.4）；p99 28.44 |
| P3 | 缩进去除：stringify 1.63×、字节 2.15×、I/O 1.34× | **PASS** | `dsh-storage-json:79` | 28.08→17.21 ms；10,561,777→4,910,513 B；21.20→15.86 ms |
| P4 | fsync（文件 5.3 + 目录 4.4）占 I/O 46%；全去 2.00× | **PASS** | `dsh-storage-json:31,36` | 21.20→10.60 ms = **2.00×** |
| P5 | projcache 写频 **1.475 次/s**、写放大 **15.58 MB/s** = 日志的 **1,675×** | **PASS** | `dsh-session-projection-cache:199-228` | 40 s 窗口 **59 次**；日志 **9.3 KB/s** |
| P6 | 事件循环阻塞来自**写**路径而非读路径 | **PASS** | `dsh-host-apiproxy:1480`；`dsh-session-projection-cache:123-127,140-150` | 读 = O(1) 内存 Map，零 I/O |
| P7 | projcache 常驻内存 45–55 MB | **PASS** | `dsh-storage-json:149`（`unit.state`） | heapUsed 增量 **47.3 MB**（sa2）；load 39.2 ms |
| P8 | 高扇出下 projcache 写速率升至 20–60 次/s | **INCONCLUSIVE** | `dsh-session-projection-cache:199-228` | 代码推导：writes/s ≈ turn/end 率 + 脏会话/5s + dispose 率；未活体实测 |
| C1 | `session.list` 读路径不碰 projcache I/O | **PASS** | `dsh-host-apiproxy:1473-1481` | `cachedSnapshot` = 零 I/O |
| C2 | 耦合在写路径：每次 checkpoint 同步阻塞 26–40 ms，推迟所有 RPC | **PASS** | `dsh-storage-json:79` | 主线程 **13–17 ms/s**（0.50–0.66 × 26.4；上界 37.5） |
| C3 | `session.list` 每次都付一次未 memo 的 `persistence.list()` 全量扫描 | **PASS（含量级警告）** | `dsh-host-apiproxy:2255` | 每次 **166 ms**、2408 `exists` + 1204 首帧解压；**但只占 26–34 s 的 ≤1% ⇒ 不是主因**（§4.6） |
| C4 | 写链串行 + 额外 `sessions.flush()` ⇒ `turn/end` 排队 | **PASS** | `dsh-storage-domain:210-214`；`dsh-session-projection-cache:162` | 单链 ~47–62 ms，严格串行 |
| C5 | "`session.list` 慢的主因是 projcache" | **FAIL（projcache 被排除）** | `dsh-session-projection-cache:199-228` | 占空比 **3.50%** vs `session.list` 烧 **26.2–34.3 s** CPU、6/6 超时 25 s；对照 RPC 中位 **264 ms** ⇒ ≥95×；"窗内有无 publish"**零区分度** |
| G1 | projcache 单调增长 +36.7 KB/h、+9.74 条/h | **PASS** | 文件 + `backup/B2/20260920-074510/meta/` | 8.84 MB/2400 → 10.56 MB/2856 @46.8 h（**+19.44%**） |
| G2 | **不存在**任何清理/保留期/淘汰机制 | **PASS（确证"无"）** | `dsh-session-projection-cache:255`（只 put）；`dsh-storage-domain:254-258` 有 deleteRecord 但未被调用 | 全产品无 retention/maxAge/prune/evict |
| G3 | 58.5% projcache 记录是孤儿却仍被全量重写 | **PASS** | `dsh-storage-json:68-80` | **1670 / 2856 = 58.5%** |
| G4 | 1 月约 12–17 MB/s（上界 38）、1 年约 160–210 MB/s（上界 475）+ 805 ms stringify | **INCONCLUSIVE（线性外推）** | — | 由实测尺寸-成本关系外推，未在增长后实测 |
| G5 | 会话日志磁盘增长速率（MB/日） | **INCONCLUSIVE** | — | 仅单时点 617.3 MB；`backup/` 下无 sessions 历史副本 |
| G6 | 磁盘/内存规模现状 | **PASS** | — | sessions **617.3 MB / 1207 日志 / 19 projects**；宿主 VmRSS **3.63 GB** |

**计**：PASS **37**、FAIL **3**（A7「99 顶层 + 200 子代理」规模假设低估 = 事实更正；A6 上限已实测但饱和未测 ⇒ 该条整体仍 INCONCLUSIVE；**C5 = projcache 被排除**）、INCONCLUSIVE **4**（A6、P8、G4、G5）+ **主档初版被纠正 2 条**（S5 INCONCLUSIVE→PASS；C5 INCONCLUSIVE→FAIL）。

### 7.4 ⚠️ 主档初版被推翻/更正的三处（自曝，保留在案）

1. **C5「projcache 是否是 `session.list` 慢的主因」：INCONCLUSIVE → FAIL（被排除）**。主档初版只做到"两个并列成本、缺 A/B 故不可归因"。sa2 用**同窗对照 + 区分度检验**做出了判定：projcache 占空比 3.50% 不足以产生 26–34 s CPU，且"窗内是否 publish"对超时零区分度 ⇒ **可以排除**，不是"不可归因"。**教训：当待证对象的量级比观测现象低 2 个数量级时，"缺 A/B"不构成 INCONCLUSIVE 的理由。**
2. **S5「启动扫描是否阻塞事件循环」：INCONCLUSIVE → PASS（不阻塞，5.22 ms）**。主档默认"无法向宿主注入探针 ⇒ 不可判定"；sa1 用**同代码同 Node/libuv 模型的进程内实测 + 阳性对照（200.03 → 202.51 ms）**直接判定。
3. **P4 的量级**：主档说"去 fsync = I/O 2.00×"，**在 `writeAtomic` 内部成立**，但 sa2 指出 `writeAtomic` 只占端到端 11.02/55.83 ⇒ **端到端只省 10.9%**；主档初版因此把"去 fsync"排得过高，已下调（§6.4 列为不推荐优先）。
4. **projcache 发布速率的头条数字**：主档初版用 100 ms `stat` 轮询得的 1.475 次/s；经 inotify 事件计数仲裁（0.500 空闲 / 1.273 繁忙）后**降级为上界**（§7.1bis）。

---

## 8. 原始数据索引

| 文件 | 内容 |
|---|---|
| `raw/m1-projcache-cost.json` | stringify pretty/compact、事件循环延迟（含阳性/阴性对照）、writeAtomic 分步、端到端 |
| `raw/m2-append-cost.json` | 1207 日志帧扫描、大小分布、zstd 批量压缩、appendLines 分步、ELD |
| `raw/m3-threadpool.json` | 串行 vs 50 并发 append（28.3× 排队）、混合负载 6.67× 膨胀、并发写 ELD |
| `raw/m4-live-observe.json` | 45 s 被动观测：日志 append 增量 + projcache mtime 变化 |
| `raw/m5-live-rate.json` | **40 s 精确计数**：346 次 append / 8.65 次/s；**59 次全文件重写 / 1.475 次/s** |
| `raw/m6-gc.json` | 密集 stringify 的 GC 画像（两字节字符串确证） |
| `raw/m7-gc-realism.json` | 按真实到达率 678 ms 的 30 s 运行：37.46 ms/s 主线程块、29.58 MB/s 分配、ELD 47.45/28.44 |
| `raw/m8-coldstart.json` | projcache 冷启动 read/parse/map 分解 + 线性外推 |
| `raw/m9-zstd-level.json` | 真实压缩比 2.38× + zstd L1/3/9/15/19/22 对照（确证产品 = L3） |
| `raw/m10-real-path.json` | **真实 deployed `dsh-storage-json` 代码路径** `putRecord` 端到端 59 ms + ELD 40.6 ms |
| `raw/m11-inotify-arbitrate.json` | **inotify `rename` 仲裁**：50 s / 33 次 rename（`other=0`）⇒ 0.660 次/s、7.02 MB/s；发布间隔 min 379 / p50 1364 / max 7640 ms |
| `sa1-scan/audit-sa1.md` + `sa1-scan/raw/*.json` | 启动扫描/加载档（listArtifacts/list/listSnapshots/checkRootEncoding、**findLog 斜率 + strace 计数**、**首帧尺寸无关性分桶**、规模直方图 125 顶层 + 1082 子代理） |
| `sa2-projcache/audit-sa2.md` + `sa2-projcache/raw/*.json`（9 份）+ `tools/*.mjs`（5 个探针） | projcache 写路径档：真实 `putRecord` **55.83 ms**（stringify 27.50 + 写盘 27.09）、**发布频率空闲 0.500/s→5.07 MB/s / 繁忙 1.273/s→12.90 MB/s（双法吻合）**、**P9 上游分片回归**（0.034 ms / 3,549 B vs 27.502 ms / 10,429,594 B）、**P4 量级更正**（去 fsync 端到端仅省 10.9%）、内存 45.13 MB、**`README.md:61` 自述无淘汰**、`deletable-dirs.list` 1,670 行 0/1670 在盘、**P6 排除 projcache**（`session.list` 6/6 超时 25 s / 26–34 s CPU）、直方图宏任务陷阱 |
| `raw/projcache-copy.json` | 审计时点的 projcache 快照（workspace 内副本，供复现） |
