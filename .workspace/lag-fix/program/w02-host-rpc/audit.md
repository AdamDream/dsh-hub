# w02-host-rpc 审计：`session.list` 残余耗时分解 · 宿主事件循环阻塞源 · 头阻塞机制 · 前三修复候选

- 日期：2026-09-22（午后）
- 审计范围：`.workspace/lag-fix/program/w02-host-rpc/`（本档独占）
- 宿主：PID **301709**（`node /home/CNS2026495165/.npm-global/bin/dsh web`），Node v22.23.2
- **live 代码根**（本报告所有 file:line 均指此树，非 `.workspace/` 历史副本）：
  `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`
  - `dsh-host-apiproxy/lib/index.js` sha256 `0d96607e…38cfc4`（217,797 B，5660 行）
  - `dsh-session-persistence-jsonl/lib/index.js`
  - `dsh-session-projection/lib/index.js`
  - `dsh-storage-json/lib/index.js` sha256 `563bf17d…bc0db1`
- 纪律：**全程只读**。未重启、未发任何信号（含 SIGUSR1）、未 strace/gdb、未改产品文件、未使用 `sandbox_permissions`、未杀宿主进程。
- 机器状态：load 5.3→8.8，同期 13+ 条审计线并行 ⇒ **所有绝对值含污染，仅量级可信**；关键结论用**同进程相邻秒配对**或**离线精确复算**取得。

---

## 零、一句话结论

> **`session.list` 的"残余"根本不是算出来的——它是等出来的。**
> 同一份代码、同一份 ~504 KB 响应，实测单次耗时在 **512 ms 到 238 991 ms 之间（466×）**；
> 而把该路径的全部**内在工作量**拿到线下用**真实数据 + 真实函数**精确复算，只有 **45–70 ms**。
> 差距来自：**每次调用顺序执行 ≈8 490 个 `await`（无任何 memo）＋ 1 210 次 zstd 线程池往返**，
> 在已被占满的宿主事件循环（主线程常态 **1.0–1.36 核**）上，每个 `await` 都要重新抢一次事件循环轮次。
> ⇒ **同一个 RPC 的延迟 ∝ 宿主拥塞度 × 8 490**，这就是"廉价 RPC 被拖慢 30–39×"的同一条因果链。

---

## 一、范围①：`session.list` 残余耗时的函数级分解

### 1.1 端到端实测（同代码、同体积响应）

响应体恒为 **504–505 KB / 299 行**（99 顶层 + 200 subagent），`bodyMs` 仅 **0.3–1.4 ms** ⇒ **100% 的延迟在 handler（TTFB）内部**。

| 时刻 | TTFB (ms) | 字节 | 出处 |
|---|---:|---:|---|
| 14:34 | 2 260 | 501 191 | 首次 curl 抓包 |
| 14:55 | **122 894** | 505 501 | `raw/sl-long.w` |
| 15:01 | 74 900 | 505 071 | `raw/sl-clean1.json`（job bash-80） |
| 15:01 | **238 991** | 505 117 | `raw/sl-timing.txt` rep1 |
| 15:01 | 17 041 | 505 026 | 同上 rep2 |
| 15:01 | 8 397 | 505 027 | 同上 rep3 |
| 15:03 | 9 899.8 | 504 241 | `raw/ttfb-…07-03-12` rep0 |
| 15:03 | 3 705.4 | 504 241 | 同上 rep1 |
| 15:03 | 1 580.8 | 504 242 | `raw/hol-final` L1 |
| 15:03 | 1 224.8 | 504 242 | `raw/hol-final` L2 |
| 15:04 | 5 773.4 | 504 244 | `raw/ttfb-…07-04-26` rep0 |
| 15:04 | 564.4 | 504 214 | 同上 rep1 |
| 15:04 | 511.9 | 504 214 | 同上 rep2 |
| （参照）修比较器后 | 166 | — | 协调者既有实测 |

> **跨度 466×，响应体字节数几乎不变。** 物理上不可能是"数据变多"；只能是**排队/等待**。
> 同一进程内连续 3 次（15:01）为 **239 s → 17 s → 8.4 s**，呈**积压排空**形态，不是稳态成本。

### 1.2 内在工作量：线下精确复算（真实数据 + 真实函数）

方法：把 deployed bundle **逐字节复制**成 `raw/apiproxy-instrumented.mjs`，只追加 `export { … }`（不改函数体），
从而在离线直接调用**与线上完全相同的** `sessionListMetadata` / `sessionListFields` / `UNARY_VALUE_SCHEMAS`。
事件流用 `node:zlib.zstdDecompressSync` 从**真实 session 日志**逐帧解出。

| 组件 | file:line | p50 | 证据 |
|---|---|---:|---|
| **`persistence.list()` 全树 header 扫描** | `dsh-session-persistence-jsonl/lib/index.js:1037` → `:1059` `listArtifacts` → `:1078` → `readFirstZstdLine` `:1279`；**调用点 `dsh-host-apiproxy/lib/index.js:2255`** | **36.7 ms**（33.7–58.2） | `raw/persist-list-*.json` |
| `sessionListMetadata(events)` 事件折叠 | 实现 `:1217`；调用 `:1291`（`summarize`）与 **`:2242`（`attachedRecency`）** | 5.0 ms（62.6 ns/事件） | `raw/fold-*.json` |
| `resolveSessionPreset`（经 `sessionListFields`） | `dsh-host-apiproxy/lib/index.js:1276` → `dsh-agent-presets/lib/index.js:762` | 2.0 ms | `raw/fold-*.json`（`presetMs`） |
| 投影快照（13 个 wire 单元 × 299 行，逐值 `viewSchema.parse`） | `dsh-session-projection/lib/index.js:122-135` | ≲1 ms（上界：整包 zod parse = 0.76 ms） | `raw/codec-*.json` |
| `JSON.stringify(envelope)`（宿主侧序列化） | `:4914 fullResponse` → `Response.json` | **0.682 ms** | `raw/codec-*.json` |
| `JSON.parse(text)`（客户端解码） | `:5396` | **0.928 ms** | `raw/codec-*.json` |
| `zod UNARY_VALUE_SCHEMAS['session.list'].parse`（客户端校验） | `:5403` / `:5254` | **0.76 ms** | `raw/codec-*.json` |
| `items.sort((a,b)=>b.updatedAt-a.updatedAt)` 299 行 | `:2296` | **0.008 ms** | `raw/codec-*.json` |
| `annotateRunningSubagentCounts` BFS | `:1244`，调用 `:2301` | 未单独隔离；上界 = 99 顶层 × ≤200 子项 map 查表 | 代码阅读 |
| | | **合计 ≈ 45–70 ms** | |

> **⇒ 序列化 / RPC 编解码 / JSON 体积 / 排序这四项合计仅 ≈1.7 ms（占残余 <1%）。**
> JSON 体积本身（499–505 KB）**不是**延迟原因——`JSON.parse` 全程 0.93 ms。

### 1.3 负载：为什么 8 490 个 `await` 会变成几十秒

`listArtifacts`（`:1059`）对**每一个 session 目录**做：

```
exists(opposite)            // :1072  -> jsonl:1431 exists() = open + close = 2 awaits
exists(path)                // :1075  -> 2 awaits
readFirstZstdLine(path)     // :1078  -> jsonl:1279 = open + read(8192) + close = 3 awaits
assertStoredIdentity(...)   // :1082  -> 同步路径比较（无 I/O）
```

**每文件 7 个顺序 `await`**。当前 live 树实测 **1 210 个 session 目录 / 19 个项目目录**（`raw/firstline-*.json` census 一致）：

| 每次 `session.list` 的物理代价 | 数量 |
|---|---:|
| `readdir` | 20 |
| `exists`（open+close） | 2 420 |
| `open` / `read(8KB)` / `close` | 各 1 210 |
| **zstd 帧解压**（`decompressZstdFrame` → 线程池） | **1 210** |
| **顺序 `await`** | **≈8 490** |

**已排除的两个"看起来像"的嫌疑：**

- ❌「首帧很大 ⇒ `readFirstZstdLine` 退化成 O(F²) 拷贝」——**已实测证伪**：1 210 个日志的文件首帧**全部在第一次 8 KB 读内闭合**（`raw/firstline-*.json`：`filesWithMultipleReads = 0`，每次调用共 1 210 次读、9.4 MB 拷贝）。机制存在（`assertZstdHeaderFrame` 强制首帧=单行 header），但当前语料不触发。
- ❌「zstd 线程池饱和」——**已实测证伪**：请求在飞时 4 个 libuv worker 各仅 **0.0065–0.0222 核**（`raw/threads-during-list-*.json`）。

### 1.4 等待量的直接刻度：`await` 放大律

用 `host.listDirectory` 当温度计——`dsh-host-directory-picker-browse/lib/index.js:165` 按构造**每个 dirent 一个 `await level.read()`**，顺序执行：

| 目录条目数 | 响应急 p50 |
|---:|---:|
| 200 | 31.57 ms |
| 400 | **59.71 ms** |

**斜率 = 0.1545 ms / await**（`raw/await-amplification-*.json`）。代入 `session.list`：
`8 490 × 0.1545 ms ≈ 1 312 ms` —— 与 15:03–15:04 稳态实测 **1 224.8 / 1 580.8 / 564 / 512 / 5 773 ms 同量级**；
而在宿主更拥塞的窗口（15:01）同一路径到 **239 s**，即每 await 代价涨到 ≈28 ms（**+180×**）。

> **单参数模型（只用独立测得的 0.1545 ms/await）就能解释稳态观测值**，这是本报告对"残余在哪"最有力的定量证据。

---

## 二、范围②：宿主事件循环阻塞源清单（逐项"每秒 CPU 占比 / 触发频率"）

主档 = `sa-evb/blockers.md`（29 条 + 8 类原语覆盖表 + 13 条不确定项）；原始采样 `sa-evb/raw/`。

### 2.1 宿主 CPU 的顶层归因（本档实测，`raw/threads-quiet-*.json`）

| 量 | 窗口 1（40.0 s） | 窗口 2（20.0 s） |
|---|---:|---:|
| **主线程 `tid=301709`** | **1.3559 核** | **1.2417 核** |
| ├ user | 0.8037 | 0.7472 |
| └ **sys** | **0.5522** | **0.4945** |
| 4× V8 后台线程 | 4 × 0.0817 = 0.327 | 4 × 0.063 = 0.252 |
| 4× libuv worker | 4 × 0.0218 = 0.087 | 4 × 0.0073 = 0.029 |
| **进程合计** | **≈1.77 核** | **≈1.52 核** |

**要点：宿主 CPU 压倒性在事件循环上，且其中约 40% 是内核态（`sys`），说明主线程本身在做海量同步/系统调用。**
（SA 线在另一窗口测得 90.6% / 96.1% 单核，主线程 80.4%，libuv 池 1.4% —— 同一结论，量级一致。）

### 2.2 阻塞源清单（合并 SA 线 + 本档；`%` = 单核百分比）

| # | 来源 | file:line | 触发频率（实测） | 每秒 CPU 占比 | 证据 | 置信度 |
|---|---|---|---|---|---|---|
| **1** | **`session.list`/`session.search` 全树扫描**（8 490 awaits + 1 210 zstd/次，**无 memo**） | `dsh-host-apiproxy/lib/index.js:2255`；`dsh-session-persistence-jsonl/lib/index.js:1059`/`:1279` | 随 GUI 轮询（每次 RPC 1 次扫描） | 单次内在工作量 **36.7 ms**（`raw/persist-list-*.json`）；**延迟 0.5–239 s 由等待主导** | 本档实测 | **高** |
| **2** | **projcache 整文件重写**：同步 `serialize()`（10.65 MB pretty）+ 2×fsync + rename | `dsh-storage-json/lib/index.js:219-224`（serialize 是 `writeAtomic` 的**同步实参**）、`:79` pretty、`:25-41` 原子写 | **0.870 次/s**（300 s，261 次，双 inotify 计数器互证） | **2.83%–3.81%**（SB 实测）**＋每次不可打断同步停顿 32.5 ms(p50)/42.5 ms(p95)** | `sb-projcache/projcache.md` | 高 |
| **3** | 会话日志 append + **fsync** | `dsh-session-persistence-jsonl/lib/index.js:1200-1227`（fsync `:1214`） | **9.17 次/s**（SA 实测，44 活跃日志 / 258 变化 / 28.14 s） | 主线程小，贡献 ~9 fsync/s 与 sys | SA `raw/` | 高（未量化占比） |
| **4** | **zstd 同步解码族** | `…/dsh-session-persistence-jsonl/lib/index.js:412`（`writeSync` 循环）、`:468`（`zstdDecompressSync`） | 冷日志 header 探测 1 210 次/`session.list` | 随帧大小线性；本档已证**首帧全在 8 KB 内**（`raw/firstline-*.json`） | 本档实测 | 高 |
| **5** | client-hmr `statSync` 轮询 ×53 bundle | `dsh-client-hmr/lib/index.js:107`（`:82 statSync`，周期 `:28`=500 ms） | **106 `statSync`/s** | **<0.1%**（10 min 内 0 个 bundle 变更） | SA 实测 | 高 |
| **6** | `@local/dsh-usage` 同步 SQLite（`DatabaseSync`，44.5 MB，WAL 4.3 MB） | 宿主 `dsh-usage/lib/index.js:228-229`、`rpc.js:203-204`；`db.js:73` | 1/60 s（卡片轮询）；`busy_timeout=5000` 事件驱动 | 均值 0.5–0.83%，以 **0.3–0.5 s 阻塞突发**出现；`db.js:81` 单次最长 5 s | SA 静态+引用 | 中 |
| **7** | websocket 心跳 | `dsh-client-connection/lib/index.js:445`（`:339`=2000 ms） | 0.5 次/s | <0.01% | SA 静态 | 高 |
| **8** | `assertUsableRoot()` 同步 `readdirSync` | `dsh-session-persistence-jsonl/lib/index.js:1336`（构造期，`:796`） | 启动 1 次 | ≈0 | 本档代码阅读 | 高 |
| **9** | SSE mux 帧广播（投影变更） | `dsh-host-apiproxy/lib/index.js:1843-1847 broadcast`（listener 注册 `:1849-1858`） | 每会话每"引用变更"事件 × 13 单元 × 每个 mux 消费者 | 未单独量化；受 `MAX_QUEUED_FRAMES` 丢弃上限约束 | 本档代码阅读 | 中 |
| — | **已排除**：`Atomics.wait`/忙等（0 处）、热路径 `execSync`、`gzipSync`/`brotli*Sync`、`O_DSYNC`/`flush:true`、chokidar 轮询风暴、fd 泄漏 | — | — | 0 | SA 全量 grep | 高 |

**fsync 全集仅 10 处**：`storage-json:31,48` ｜ `session-persistence-jsonl:1164,1189,1214,1232,1243` ｜ `fs-local:523` ｜ `attachment-local:375,443`。
**同步 fs 全量计数**：`readFileSync` 15 / `writeFileSync` 6 / `existsSync` 12 / `statSync` 14 / `readdirSync` 2 / `mkdirSync` 5 / `openSync` 2 / `writeSync` 3 / `unlinkSync` 2 / `lstatSync` 3 / `rmSync` 2 / `readlinkSync` 2 / `chmodSync` 1 / `closeSync` 2；`appendFileSync`/`renameSync`/`copyFileSync` = **0**。

### 2.3 ⚠️ 需要撤回的起点数字（两线对账结论）

| 起点假设 | 实测 | 裁决 |
|---|---|---|
| projcache **≈29 次/3 s ≈ 9.7 次/s ≈ +0.5 核常驻** | SB 线 300 s 纯 inotify 被动计数：**0.870 次/s**，**2.83–3.81% 单核** | **撤回"9.7 次/s / +0.5 核"**。SA 线独立测到 1.47–1.63 次/s（`stat` 轮询口径，短窗+采样周期伪影，SB 已复现该 4× 低报机制）。**以 SB 的长窗双计数器为准** |
| 「projcache 是宿主 CPU 主耗项」 | projcache = 2.8–3.8% 单核；**主线程总耗 1.24–1.36 核** | **改判**：projcache 是「**间歇性事件循环抖动源 + 磁盘写放大器**」（每次 32.5 ms 不可打断同步停顿、9.26 MB/s、≈800 GB/天），**不是** CPU 主耗项 |
| 「改异步写可省 CPU」 | 4×libuv worker 仅 0.007 核；`writeAtomic` **本来就是 `await handle.writeFile`** | **撤回**：异步化收益 = 0；真正的同步点是 `serialize()` 作为**同步实参**求值（`storage-json:219-224`） |

### 2.4 两个纠正既有认知的发现（SA 线）

1. **`dsh-session-query-sqlite` 是休眠的**：部署配置 `path: ':memory:'` + `openAt: never`（`dsh-base/cordis.patch.yml:117-121`、`dsh-web-app/cordis.patch.yml:30-33`）。真正跑 44.5 MB 同步 SQLite 的是 **`@local/dsh-usage`**（`DatabaseSync`，`db.js:73`）。
2. **`dsh-tool-bash-persistent` 未挂载**（三层 composition grep 全空）⇒ 其 40 次/s 轮询为**休眠**，收益 0。

### 2.5 不可读项（如实记录，不编）

- **`/proc/301709/io` EACCES 不可读**（`-r--------` 0400）⇒ 宿主物理 `write_bytes` **未直读**；SB 的 9.26 MB/s 是"频率 × 文件大小"推算。
- **`/proc/sys/kernel/task_delayacct = 0`** ⇒ `stat` 字段 42 恒 0，**"0" 是"未启用"而非"无 I/O 等待"** ⇒ 主线程 40% sys 无法进一步分解为 I/O 等待 vs 系统调用开销。
- `/proc/301709/fd` 可读（186 fd）但未做泄漏分析（SA 观察 66–224 波动、无单调增长）。

---

## 三、范围③：队列与头阻塞机制 —— 为什么廉价 RPC 被拖慢 30–39×

### 3.1 机制（三层，均已给锚点）

**(A) 单线程事件循环 + 长链顺序 `await`。**
宿主是单进程单主线程（`node:dsh web`）。`session.list` 的 handler 在**一次请求内**顺序执行 **≈8 490 个 `await`**（§1.3）。每个 `await` 都必须**重新获得一次事件循环轮次**；轮次代价 = 当时循环上排队的同步工作总量。**⇒ 请求延迟 = 8 490 × 轮次代价**，轮次代价又被所有并发负载抬高 ⇒ **正反馈**。

**(B) 廉价 RPC 与昂贵 RPC 争同一队列（头阻塞）。**
`host.describe`（262 B、**零 I/O、零 await**）在宿主空闲时 p50 **2.2 ms**；同一个进程、相邻 1 秒内，在一次 5 773 ms 的 `session.list` 在飞期间 p50 涨到 **27.7 ms**、峰值 **232.87 ms**（`raw/ttfb-…07-04-26` rep0 vs rep1）：

| 窗口 | `session.list` 自身 | 同窗 `host.describe` p50 | 放大 |
|---|---:|---:|---:|
| rep0（15:04） | 5 773 ms | **27.7 ms**（max 232.9） | **12.6×**（max **106×**） |
| rep1（15:04，+1 s） | 564 ms | **2.2 ms** | 1.0（基线） |
| rep0（15:03） | 9 900 ms | 37.6 ms（max 305.4） | 17× |
| rep1（15:03） | 3 705 ms | 43.8 ms（max 321.8） | 20× |

⇒ **与协调者实测的"探针 p95 4.6→43.9 ms（≈9.5×）、峰值 789 ms"同族**；"30–39×"出现在更拥塞的窗口（本档 `raw/threads-*` 窗口内 `host.describe` 曾达 p90 467 ms / **max 7 101 ms**）。

**(C) 无取消传播 ⇒ 积压自我放大（新发现，高危）。**
`handleUnary`（`:4928`）把 `req.signal` 作为第 3 实参传给 `route.invoke`（`:4937`），但：

```js
// dsh-host-apiproxy/lib/index.js:2493
async list(request) {                      // ⚠️ 丢掉第 2 个参数 signal
  return ok(request, { items: await listVisibleSessionSummaries() });   // :2494，也无 signal
},
async search(request, signal) { ... }      // :2496 —— search 传了，list 没传
```

`listVisibleSessionSummaries(signal)` 本身**支持** signal（`:2224`，内部多处 `signal?.throwIfAborted()`）——**只是调用方没传**。
⇒ 客户端超时/断开后，**handler 仍把 8 490 个 await 全部跑完**。本档实测：14:52–15:01 期间连续 3 次被 120 s 超时放弃的请求，直接把随后的 `session.list` 推到 239 s、把 `host.describe` 推到 p90 467 ms / max 7.1 s。

### 3.2 协议层修法候选（按"是否触及线上契约"分类）

| 候选 | 机制 | 预期收益 | 风险 | 热/冷 |
|---|---|---|---|---|
| **T1 memo / 缓存 header 清单** | 砍掉 8 490 个 await 中的 **8 490 个**（唯一真正的大头） | `session.list` 内在开销 36.7 ms → ≈0；**放大律失去乘数** | 低（header 创建后不可变，见 §4 F1） | 冷 |
| **T2 取消传播** | 断连即停，切断正反馈 | 阻断 239 s 级积压 | 极低（1 个参数） | 冷 |
| **T3 增量投影 / 直接复用已注册投影** | `attachedRecency`（`:2242`）先折一遍、`summarize`（`:1291`）再折一遍——**同一份事件折两次**；而 `sessionListMetadata` **本来就是已注册的投影**（`:1860-1869`） | 省 1 趟 O(events)；语义不变 | 低（带回退折叠） | 冷 |
| **T4 载荷去重 / interning** | `imageLimits` 在 **298/298 行完全相同**、`permissions` 只有 **3** 个不同值、`goal` 247/298 为 null | 线上 **−158 806 B = −31.7%**；每行 zod 工作量同步下降 | 中（wire 契约变更，需客户端同批） | 冷 |
| **T5 分页 / 游标** | 响应里 **`cursor` 已是保留字段**（`dsh-host-apiproxy/lib/index.js:438`「cursor is a reserved seat, unimplemented in v1」）⇒ **是已预留的接入点**，无需改契约形状 | 单次载荷与行数可控；GUI 首屏只需最近 N 条 | 中（需客户端配合做续页） | 冷 |
| **T6 背压** | `FrameQueue.push` 已有 `MAX_QUEUED_FRAMES = 4096`（`:1095`）上限并按"应答帧优先"淘汰（`:1102-1131`）——**mux 侧已有背压**；缺的背压是 **RPC 侧**（§3.1C） | 防单消费者拖死广播 | 低 | 冷 |
| **T7 合并/去抖** | GUI 若在同一事件循环轮次内多次请求（切 tab、重连）可合并 | 减少重复全扫 | 低 | 热（客户端） |

> **注意**：T4/T5/T7 都是**二级**收益。**没有任何协议层润色能替代 T1+T2**——因为延迟是 `8 490 × 轮次代价`，不砍乘数就只是把常数改小。

---

## 四、范围④：最小且可回滚的前三修复候选

> 三条均为**宿主侧（冷面，需重启）**；本档**未执行任何一步**（只读审计）。
> 每条给出：改动形状 / 预期收益 / 风险 / 验收 / 回滚 / 热冷面。

### F1（首选）— 给 `persistence.list()` 的 header 扫描加 memo

- **锚点**：`dsh-session-persistence-jsonl/lib/index.js:1059`（`listArtifacts`）/ `:1037`（`list`）；消费点 `dsh-host-apiproxy/lib/index.js:2255`
- **为什么安全（关键前提，已核实）**：**header 创建后不可变**。
  - 创建：`materialize` → `encodeMaterialization`（`:1171-1181`）把 `headerFrame + eventFrame` **一次性**写入；
  - 追加：`appendLines`（`:1200-1227`）以 `open(path, "a")` 打开，**只写事件帧**，不重写 header。
  - 语义上 `dsh-host-apiproxy/lib/index.js:1593` 与 `:1646` 亦明确「会话的 composition/preset 在创建时固定」。
- **改动形状**：把 `list()` 的结果按 `root` 缓存；失效条件 = 项目/会话**目录集合**变化（19 次 `readdir`，而非 8 490 次 await），或挂在宿主已知的会话 create/delete 事件上。
- **预期收益**：`session.list` 内在 36.7 ms → ≈0；**关键是砍掉 8 490 的乘数**，使延迟不再随宿主拥塞线性放大。预计稳态 `session.list` TTFB 回到 **≤20 ms 量级**。
- **风险**：**低–中**。唯一失效模式是"header 被就地改写"——代码上不存在；若未来出现，需要重新评估。
- **验收**：
  1. 20 次 `session.list` 的 **TTFB p50 ≤ 150 ms**（用本档 `scripts/ttfb-split.mjs`），且 ≥99 顶层行 + 200 subagent 行；
  2. **集合等式**：缓存版与强制冷扫描版返回的 `(sessionId, cwd, createdAt, origin, parentSession, agentPreset)` 逐行一致；
  3. 新建会话后**立即**出现在 `session.list`（无旧缓存漏行）。
- **回滚**：还原该单文件（**必须取重启前 live 的 pre-image**；不要复用 `raw/` 里的 `apiproxy-instrumented.mjs`）。
- **面**：冷面（重启）。

### F2 — 把 `req.signal` 传进 `sessions.list`

- **锚点**：`dsh-host-apiproxy/lib/index.js:2493-2495`（`async list(request)` 丢弃第 2 参数）；对照 `:2496` 的 `search(request, signal)` 是正确写法；`handleUnary :4928` 在 `:4937` 已把 signal 传下来。
- **改动形状**：`async list(request, signal) { return ok(request, { items: await listVisibleSessionSummaries(signal) }); }`（1 行）
- **预期收益**：客户端超时不再留下 8 490-await 的僵尸扫描；**消除 §3.1(C) 的自我放大**（本档实测该效应把延迟从 5.8 s 推到 239 s）。
- **风险**：**极低**。`listVisibleSessionSummaries` 内部已全程 `signal?.throwIfAborted()`。
- **验收**：发一次 `session.list` 并在 200 ms 处 abort；随后 1 s 内 `host.describe` p50 回到基线（≤5 ms），且宿主主线程 CPU 无持续抬升。
- **回滚**：单行还原。
- **面**：冷面（重启）。

### F3 — 去掉重复折叠 + 投影载荷去重（二选一或分两步）

- **锚点**：
  - (a) **重复折叠**：`:2242`（`attachedRecency` 折**全部** attached subagent）与 `:1291`（`summarize` 再折一遍保留下来的）：同一事件流**折两次**；而 `sessionListMetadata` 已是注册投影（`:1860-1869`，`apply: applySessionListMetadata`）⇒ 应直接读投影快照，折叠仅作 fallback。
  - (b) **载荷去重**：`:1478 listProjectionsFor` 逐行产出 13 个投影值；实测 `imageLimits` **298/298 完全相同**（63 772 B）、`permissions` 仅 **3** 个不同值（84 259 B）。
- **预期收益**：(a) 省一趟 O(events)（当前样本 5.0 ms，随会话增长线性放大）；(b) **−158 806 B = 线上 −31.7%**，每行 zod 工作量同步下降。
- **风险**：(a) **低**（保留折叠回退，判据 = 投影缺失时行为不变）；(b) **中**（wire 契约变更 ⇒ **必须客户端同批**，否则 GUI 读不到这些字段）。
- **验收**：(a)+(b) 后 `items[]` 与 pre-image **逐行等值**（含 13 个投影键）；wire ≤ **350 KB**；`session.list` TTFB p50 不升高。
- **回滚**：(a)(b) **可独立回滚**（不同文件/不同 hunk）。
- **面**：冷面（重启）。

### F4（并列，交批次裁决）— projcache compact JSON（SB 专线交付，此处只登记不重复论证）

- **锚点**：`dsh-storage-json/lib/index.js:79`（`, null, 2` → 去掉）
- **收益（SB 实测）**：字节 **−53.5%**、**同步主线程停顿 32.5 → 20.6 ms p50**、单核 **2.83% → 1.79%**
- **风险**：低–中（推翻 `:56-60` 的「人可读」设计理由；round-trip 已验证等价）
- **验收**：`parse` 往返等值；停顿 p50 ≤ 22 ms
- **回滚**：1 行
- **面**：冷面（重启）
- **理由入批次**：它是**每次 32.5 ms 不可打断的同步停顿**，会**直接叠加进 `session.list` 的 TTFB**（§2.2 #2），与 F1 正交。

---

## 五、原始证据索引

| 文件 | 内容 |
|---|---|
| `raw/VERDICT.json` | 本报告全部数字的机读汇总（含 latency 序列、分解表、候选表、对账结论） |
| `raw/apiproxy-instrumented.mjs` | deployed bundle 的**逐字节副本 + 追加 export**（离线调用真实函数的载体） |
| `raw/persist-list-*.json` | `persistence.list()` 全树扫描 p50/p95 + syscall census（1 209 目录） |
| `raw/firstline-*.json` | 1 210 个日志的 `readFirstZstdLine` 读次数分布（**证伪 O(F²)**） |
| `raw/fold-*.json` | 真实事件流的折叠成本（62.6 ns/事件、`presetMs`） |
| `raw/codec-*.json` | JSON 体积分解 + stringify/parse/zod/sort/投影去重潜力 |
| `raw/await-amplification-*.json` | `await` 放大律（0.1545 ms/await）与预测 |
| `raw/ttfb-*.json` | TTFB vs body 拆分 + 同窗 `host.describe` 探针（头阻塞配对证据） |
| `raw/hol-final-*.json` | 同进程 Q1/L1/Q2 + L2 配对窗口 |
| `raw/threads-*.json` | 逐线程 CPU 归因（主线程 1.24–1.36 核 / sys 0.49–0.55 核） |
| `raw/sl-timing.txt`、`raw/sl-long.w`、`raw/sl-clean1.json` | 单次 latency 原始记录（239 s / 122.9 s / 74.9 s） |
| `raw/session-list-payload.json`、`raw/sl-payload-*.json` | 抓到的真实 504–505 KB 响应体 |
| `scripts/*.mjs` | 全部可复跑测量脚本（`bench-persistlist` / `bench-firstline` / `bench-fold` / `bench-codec` / `await-amplification` / `ttfb-split` / `hol-final` / `thread-sample` / `quick-cheap` / `paired-hol`） |
| `sa-evb/blockers.md` + `sa-evb/raw/` | 宿主阻塞源清单 29 条 + 8 类原语覆盖 + 13 条不确定项 |
| `sb-projcache/projcache.md` + `sb-projcache/raw/` + `sb-projcache/scripts/` | projcache 量化证据档 + 修复候选 C1–C4 |

---

## 六、不确定项 / 边界（诚实清单）

1. **污染**：load 5.3–8.8，同期 13+ 审计线并行 ⇒ §1.1 的绝对值、§2.1 的 CPU 占比均**含他人负载**。已用（i）离线精确复算、（ii）同进程相邻秒配对、（iii）只取比值/斜率来抑制污染。
2. **部分头阻塞窗口是自加载的**：14:52–15:02 的部分慢窗口由本档自己的探针造成。**自洽证据是 15:04 的配对窗口**（同进程、相邻 1 秒：5 773 ms ↔ 564 ms / 1 224 ms ↔ 1 580 ms）。
3. **`await` 放大律的斜率是带噪拟合**：低条目数档（6/19/27/54）被噪声主导（6 条目 p50 反而 40.67 ms）。斜率 0.1545 ms/await 由 200/400 档支撑；**它是量级证据，不是精确常数**。
4. **未测**：`viewCheckpoint`（`dsh-session-projection/lib/index.js:195-211`，每行 2 次 zod parse × 各带 `wire` 的注册点）在**冷行**上的成本——需要活 Service/ctx 才能构造，本档**不做假数**（SB 线亦留下同一线索）。
5. **未做**：把 F1 的缓存原型真正接到 live 上做 A/B。**本档只读，未执行任何修复**。
6. **`/proc/301709/io` 不可读、`task_delayacct=0`** ⇒ 物理写字节与 I/O 等待时间无法直读（§2.5）。
7. **SA 与 SB 的 projcache 频率分歧（1.47–1.63 vs 0.870 次/s）** 已裁决以 SB 长窗双计数器为准；但**若起点"29 次/3 s"另有原始采样文件，应拿出来对账**（SA 报告中已标为待对账项）。
8. **未覆盖**：GUI 侧（客户端）`session.list` 调用频率与重试行为未测——本档只测宿主侧 RPC。T7（去抖/合并）因此只有方向、无数字。
