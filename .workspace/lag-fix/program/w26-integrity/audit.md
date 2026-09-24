# w26-integrity 审计：数据完整性与恢复（2026-09-22）

> 范围：① 会话 `jsonl.zstd` 多帧容器的崩溃/断电可恢复性 + 全库帧级只读完整性扫描
> ② `session_projcache` 的损坏/孤儿  ③ usage SQLite 完整性与 WAL/busy_timeout
> ④ `~/.dsh/storages` 各文件的版本/迁移/备份策略  ⑤ 前三优化候选
>
> **全程只读**：未写 `~/.dsh/**`，未改任何产品文件，未重启/未向任何进程发信号。
> 所有破坏性实验都在 `/tmp` 的临时副本/合成 root 上做，产物与脚本全部落盘可复核。

---

## 0. 一句话结论

**多帧容器本身设计正确、且当前全库 100% 健康**——1419 个 artifact / 1,199,487 个帧**全部 CLEAN**，
双解码器逐字节一致，**0 个撕裂尾、0 个静默丢事件**；**真正的风险不在"截断"而在"字节损坏"**：
- 截断（撕裂尾）**可检测、可恢复到最后一个完整帧、并把撕裂帧里的完整记录捞回来**（实测捞回 23 条，语义自洽、零丢失）——**PASS**；
- 但**任意一个帧内部坏一个字节（含头帧）⇒ 整个会话不可读，无任何 salvage**；头帧坏 ⇒ **整张会话列表抛错**（爆炸半径 = 全部会话）；头帧缺 ⇒ 该会话**静默消失**——**FAIL**；
- **`~/.dsh/storages` 四个持久化产物没有任何自动备份**，且 `session_projcache.json` 损坏后**是永久硬故障**（注释承诺的 "Version bumps discard the whole medium" **在代码里不存在**）——**FAIL**；
- 🚨 **全库最严重的一条具体机制**：**`usage.db` 被截断成 0 字节时，真实 `openUsageDb` 不报任何错，把它当"文件不存在"重建为空表 ⇒ 149,506 条用量历史静默归零**（根因只是 `db.js:70-72` 判了存在性、没判内容）——**FAIL**。

**已确证当前无实际损坏**（这是"风险"而非"事故"），唯一已存在的实体缺陷是 3 个陈旧 `session.v3.jsonl.zstd` + 3 个 0 字节 `session.lock` 残留（1.05 MB，且对扫描器不可见）。

---

## 1. 环境变更声明（与任务书前提的差异，必须先说）

| 项 | 任务书前提 | 实测现状（本文全部数字基于它） |
|---|---|---|
| 宿主 PID | **301709（严禁重启）** | **301709 已于 18:11:49 退出**（非本线所为，是 `deploy-lag` 工作流的正规重启：`dsh-restart.sh` 发 SIGTERM → 6 s 退出 → 新实例 **PID 2988915** → 2 s 冒烟 HTTP 200）。本线**未**发送任何信号 |
| artifact 数 | **1209** | **1419**（我扫描时，18:32）+ 仍在增长（15:16 时 1280 → 18:51 时 1451） ⇒ 任务书里的 1209 是 `w03` 更早的读数，**已过期约 3.5 小时**；我扫的是**当时全量** |
| 产品代码 | — | ⚠️ **`dsh-session-persistence-jsonl` 在 15:54:12 被替换过**（md5 `251f69df…` → **`3423e8b7e8aff6dff372e28a608351dd`**，1461 → 1539 行；新增 HR1 memo + HR4 有界并发）。本文所有 `file:line` **均已对当前版本复核**（≤1060 行未变，>1060 行已重定位） |
| 探针锁 | — | 我用的是**新版** `probe-lock.mjs`（17:21）。首次尝试时锁被 `w14-residual-env`（存活）持有 ⇒ 我**未强占**，用 `wait-lock.mjs` 有界重试，38.1 s 后拿到再跑全库扫描 |

---

## 2. 仪器与证据强度（先说清"凭什么信"）

### 2.1 调用的是**真实 deployed 代码**，不是我重写的近似实现
`dsh-session-persistence-jsonl` 只导出类本身，但 `readRaw` / `readZstdPrefix` / `readFirstZstdLine` /
`readStableFile` / `listArtifacts` / `probeArtifactMemosized` 等**均不依赖实例字段**（`readRaw` 只用
`this.compression` / `this.findLog` / `this.ensureRootEncoding` / `this.readStableFile`）。
因此用**合成 receiver + `Class.prototype.<m>.call(recv, …)`** 就能直接调用真函数（`raw/m5`、`raw/m6` 都这么做）。
→ `scripts/probe-import.mjs` 验证了 10 个目标方法全部可调用。

### 2.2 唯一需要"提取"的是 `scanZstdFrames`，且做了交叉验证
它是模块**内部**函数、未导出，故从源文件**逐字提取**（记录源 md5 + 字节区间，可审计：
`:503-566`，`ZSTD_MAGIC` 取自 `:491`）。提取正确性**不靠自证**，而由
**"我提取的 `tornStart` 与产品自己 `readZstdPrefix` 的 `tornMarker.truncateTo` 逐文件一致"** 校验：
全库 1419/1419 一致（`tornAgreeAll: true`）。

### 2.3 双解码器互证（防"解码器 bug 掩盖损坏"）
- 产品路径：`createZstdFrameDecoder()`（Node 私有 stream handle，`:588-590`）
- 独立 oracle：`node:zlib.zstdDecompressSync`（公共 one-shot，逐帧解压并校验 checksum）
两者在 **1419/1419** 个 artifact 上解出的明文字节**逐字节相等**（`dualDecoderAgreeAll: true`）。

### 2.4 阳性/阴性对照（关键：全库"0 损坏"必须证明仪器**不是瞎的**）
- **阴性对照**：爆炸半径实验里 `scenario: none` → 真实 `listArtifacts` 返回 3 条（健康态可被正确报告）。
- **阳性对照**：合成损坏矩阵 14 个样本中，**9/9 个截断变体**与 **5/5 个损坏变体**全部被仪器判为非 CLEAN，
  且报错位置精确到字节（如 `frame at byte 10773690`、`invalid frame magic at byte 10773690`）。
- **自洽性对照**：`m4` 的三方对账（全量读 − 前缀读 == 末帧明文长度）实测**成立**（见 §3.3）。
⇒ 因此"全库 1419 个 CLEAN"是**有灵敏度的阴性结论**，不是空结论。

---

## 3. ① 崩溃/断电后的可恢复性（多帧容器）

### 3.1 容器设计与恢复机制（`file:line` 全部对当前 md5 `3423e8b7…` 复核）

| 机制 | 位置 | 事实 |
|---|---|---|
| 每批一个**独立可解压、带 checksum** 的帧（不重压全文件） | `:491`（magic）、`:494`（`ZSTD_c_checksumFlag:1`）、`:572-574`、`:1258-1261` | 容器 = 帧串接 |
| 物化写 `header 帧 + 首批事件帧` 两帧 | `:1249-1256` | 头帧**恰好一行** |
| **只做结构扫描、不解压**定位完整帧 + 撕裂尾 | `:503-566` | 结构坏 ⇒ 抛；EOF 落在末帧内 ⇒ 返回 `tornStart` |
| 头帧独立可读（列表路径只读头帧） | `:1357-1397` | 8192 B 分块 + `scanZstdFrames(content,1)` + `:1390` 恰好一行的断言 |
| 前缀读：完整帧解压 + 撕裂帧**尽力取回**明文 | `:955-1019`（`:992-999` 用 `ZSTD_e_flush`） | `tornMarker = {truncateTo: tornStart, recoveredEvents}`（`:1004-1011`） |
| 修复落盘：先截断到帧边界，再把捞回的事件补成一个新帧 | `:1031-1035` + `:1315-1325`（truncate+fsync） | 两步各自 fsync |
| 载入时的合成补写（未闭合 turn/step 的 closer） | 协调器 `dsh-session-persistence/lib/index.js:1005-1006,1035-1036` | `interruptedTurnClosers` |
| HMR/reload 路径也截断撕裂尾 | 协调器 `:1303` | `commitRepair(meta, tornMarker, [])` |
| 追加失败**回滚文件大小**（避免重复 seq） | `:1278-1305`、`:1306-1314` | 写失败 ⇒ truncate 回原 size |

**结论（设计层）：容器是"截断安全"的**——写入以整帧为原子单位（fopen `"a"` + 单次 `writeFile` + `fsync`），
崩溃最坏留下**一个**不完整末帧，且该末帧的完整记录还能被 `ZSTD_e_flush` 捞回。

### 3.2 全库帧级扫描（只读，`scripts/m1-frame-scan.mjs`）

| 指标 | 实测 |
|---|---|
| 扫描时刻 | 2026-09-22 18:32（本地），锁持有 38.1 s |
| **artifact 数** | **1419**（1416 `session.jsonl.zstd` + **3 陈旧 `session.v3.jsonl.zstd`**） |
| 总字节 | **734,487,393 B = 700.4 MB** |
| **总帧数** | **1,199,487**（平均 612.3 B/帧） |
| 判定分布 | **CLEAN 1419 / 1419（100%）** |
| 撕裂尾 | **0** |
| 双解码器分歧 | **0** |
| `tornStart` 判定分歧（提取 vs 产品） | **0** |
| 头帧"恰好一行"违规 | **0** |
| 读取期间被并发追加（stat 前后不稳） | **0** |
| 耗时 | 37,693 ms（≈26 ms/artifact，含 3 次全量解码工作量） |

原始数据：`raw/m1-frame-scan-summary.json`、`raw/m1-frame-scan-detail.json`（逐文件）、`raw/artifact-inventory.tsv`。

> ⚠️ **规模漂移（诚实记录）**：`w03` 报 1207/1209，我 15:16 快照到 1280，18:32 扫到 1419，18:51 已是 1451+3。
> 本机每秒都在新建子代理会话 ⇒ **任何"全库数字"都带时间戳才有效**。本文所有数字均附采样时刻。

### 3.3 截断矩阵：**可检测 / 可恢复 / 无静默丢失**（PASS）

样本：`--home-CNS2026495165-dsh--/session-6a7367fe-…/session.jsonl.zstd`
= **22,808,279 B / 69,229 帧 / 冷（11.1 天未改）**——选冷的，排除"宿主正在追加"的干扰。
（`scripts/m2-recovery-matrix.mjs`、`scripts/m4-loss-and-blast.mjs` → `raw/m2-recovery-matrix.json`、`raw/m4-loss-and-blast.json`）

| 变体 | 结构扫描 | `readRaw`（全量读） | `readZstdPrefix`（前缀读） | 判定 |
|---|---|---|---|---|
| T0 截到 0 B | 0 帧 | ✗ `empty or header-less` | ✗ 同 | 可检测；头帧丢失 |
| T1 头帧写一半（100 B） | 0 帧, torn=0 | ✗ 同 | ✗ 同 | 可检测 |
| T2 头帧 60% 处 | 0 帧, torn=0 | ✗ 同 | ✗ 同 | 可检测 |
| T3 恰好在 `frames[0].end` | 1 帧, 无 torn | ✓ 190 B | ✓ ev=0 | 干净前缀 |
| T4 恰好在中间帧边界 | 34615 帧, 无 torn | ✓ 23,669,707 B | ✓ ev=613,627 | 干净前缀 |
| **T5 中间帧 payload 中途截断** | 34615 帧, **torn=10773863** | ✓ 23,669,707 B（= T4，撕裂帧整体不计） | ✓ ev=613,627, `tornMarker{truncateTo:10773863, recovered:0}` | **可恢复，不静默多给** |
| **T6 末帧 checksum 掉最后 2 B** | 69228 帧, **torn=22804136** | ✓ 51,739,900 B | ✓ ev=1,364,371, **`recovered:23`** | **捞回 23 条完整记录** ✅ |
| T7 末帧只留 magic（4 B） | 69228 帧, torn 同上 | ✓ 51,739,900 B | ✓ ev=1,364,348, recovered:0 | 可恢复 |
| T8 末帧整帧消失 | 69228 帧, 无 torn | ✓ 51,739,900 B | ✓ ev=1,364,348, 无 torn | 干净前缀 |

**三方自洽对账（`m4`，判定"是否静默丢事件"的决定性证据）**

| 量 | 实测 |
|---|---|
| 全文件 `readRaw` 明文字节 | **51,756,592** = Σ(全部 69,229 帧明文) ✅ 一致 |
| 去掉末帧后的 `readRaw` | **51,739,900** |
| 差值 | **16,692 B == 末帧明文长度 16,692** ✅ |
| 事件数差 | 1,364,371 − 1,364,348 = **23** == 末帧事件数 ✅ |
| `selfConsistent` | **true** |

⇒ **截断语义完全自洽：既不静默丢、也不静默重。** 这是 ① 里最干净的一条 PASS。

### 3.4 字节损坏矩阵：**整会话不可读，零 salvage**（FAIL）

| 变体 | 结构扫描 | `readRaw` / `readZstdPrefix` | `readFirstZstdLine` |
|---|---|---|---|
| 损坏 C1 中间帧 payload 翻 1 bit | 69229 帧（结构完好） | ✗ `corrupt …: frame at byte 10773690 failed validation` | ✓ |
| 损坏 C2 中间帧 payload 清零 16 B（模拟 delayed-alloc 掉电空洞） | 同上 | ✗ 同上 | ✓ |
| 损坏 C3 **末帧** payload 翻 1 bit | 同上 | ✗ `frame at byte 22804136 failed validation` | ✓ |
| 损坏 C4 中间帧 **magic** 坏 | ✗ `invalid frame magic at byte 10773690` | ✗ 同 | ✓ |
| 损坏 C5 **头帧** payload 坏 | 69229 帧 | ✗ `frame at byte 0 failed validation` | **✗ `header frame failed validation`** |

**判定 FAIL，理由（这是本线最重要的发现）**：
1. **可检测**：是。报错精确到字节，且结构扫描与解码两层都能报。
2. **可恢复到最后一个完整帧**：**否**。`:963` 的 `decoder.decode(buffer, frames)` 是**全帧遍历**，
   第 N 帧失败即整体抛出；`:1012-1015` 只做 abort 检查后原样 rethrow；协调器
   `dsh-session-persistence:1023-1026` 再包成 `SessionPersistenceCorruptionError`。
   **没有任何"跳过坏帧、保守截到第 N−1 帧"的分支**——而这恰恰是**截断路径已经具备的能力**（§3.3）。
3. **静默丢事件**：这一条是**否**（它是响亮的失败，不是静默）——但代价是**整个会话永久打不开**。
4. **不对称性**：**同一份数据，末尾缺一个字节能救回 23 条事件；中间多坏一个 bit 却整篇作废。**
   而按 §3.1 的写入模型，崩溃只会造成末帧不完整；**中间帧损坏只可能来自位腐（bit rot）、盘上空洞、
   或就地改写**——概率低但后果最重，且当前**没有任何恢复手段**（见 §6：连备份都没有）。

### 3.5 爆炸半径：头帧坏 ⇒ 整张列表抛错；头帧缺 ⇒ 静默消失（FAIL）

方法：合成 root（`--proj--/` + 2 个健康会话 + 1 个受损会话），header 的 `id`/`cwd` 严格改写以通过
`assertStoredIdentity`（`:1423-1434`），然后跑**真实 `listArtifacts`**。
（`scripts/m4-loss-and-blast.mjs` → `raw/m4-loss-and-blast.json`；对照 `scenario: none` = 3 条 ✅）

| 受损会话的损坏形态 | `listArtifacts` 结果 | 判据 |
|---|---|---|
| `none`（对照） | ok，**列出 3** | ✅ 对照有效 |
| **头帧内部坏**（byte 20） | **抛错，列出 0** | 🔴 **整张会话列表不可用**（其余 2 个健康会话也全丢） |
| **头帧 magic 坏**（byte 0） | **抛错，列出 0** | 🔴 同上 |
| **0 字节文件** | ok，**列出 2** | 🟠 **静默跳过**（该会话凭空消失，无任何日志/告警） |
| **头帧截断到 28 B** | ok，**列出 2** | 🟠 静默跳过 |
| **头帧截断到 82 B** | ok，**列出 2** | 🟠 静默跳过 |
| 中间帧坏（头帧完好） | ok，**列出 3** | ✅ 列表不受影响（但该会话 §3.4 打不开） |
| 末帧坏（头帧完好） | ok，**列出 3** | ✅ 同上 |

**机制（`file:line`）**
- 整表抛错：`:1096-1097` `for (const entry of await this.probeArtifactsBounded(...)) { if (entry.error !== void 0) throw entry.error; }`
  —— `probeArtifactsBounded`（`:1150-1173`）**故意把每目录的错误收进 `{error}`**（`:1162-1165`），
  但 `listArtifacts` 立刻**按目录顺序把第一个错误抛出**（注释 `:1082` 明说"抛错优先级不变"）。
  ⇒ 隔离机制**已经存在**（错误被 per-dir 捕获了），缺的只是"不再 rethrow"这一个决定。
- 静默跳过：`:1123` `if (first === void 0) return void 0;` 与 `:1125` `if (meta === void 0) return void 0;`
  —— 头帧读不出（截断/空文件）或不是合法 header 行时**直接返回 undefined**，**调用方无法区分
  "此目录没有会话"与"此目录的会话坏了"**。
- 头帧抛错的来源：`:1390` 前后 `assertZstdHeaderFrame` / `readFirstZstdLine` 内的
  `throw new Error("corrupt Zstandard session log: header frame failed validation")`（当前 `:1382` 附近）。

### 3.6 真实重启样本（18:11:49）：优雅停机 ⇒ **帧原子、零撕裂**（PASS，强证据）

`~/.dsh/backups/dsh-restart.log` 实录：`SIGTERM -> PID 301709（有界等待 15s dispose）` → `进程已退出（6s）`
→ 新实例 `2988915` → `✅ boot OK（2s）… HTTP 200`。

**独立的盘面证据（不是转述日志）**：`find -newermt 18:00 ! -newermt 18:20` 显示
**12 个 artifact 共享同一个 mtime `2026-09-22 18:11:43.1439145070`**（纳秒级全等 ⇒ 一次协调写入），
且它们解出的**最后一个事件 `time` 全部等于 `1790071903094`**，事件体同为：

```json
{"type":"agent/inbox/spliced","seq":N,"time":1790071903094,
 "data":{"target":"next-step","start":0,"removedCount":K,"inserted":[],"outcome":"canceled"}}
```

⇒ 优雅停机时宿主对**每个待处理会话**追加了一条"取消 pending next-step"事件，**全部落在整帧边界上**。
这 12 个文件在 §3.2 的全库扫描中**全部 CLEAN、0 撕裂尾**。停机 6 s 前的最后一次写是**完整帧**。

### 3.7 真实中断会话普查：34 个冷会话末尾未闭合（自然阳性对照）

`scripts/m7-open-turns.mjs`（全库流式折叠，峰值内存 O(1 帧)）→ `raw/m7-open-turns.json`：

| 指标 | 实测 |
|---|---|
| 折叠 artifact 数 / 事件数 | **1445 / 1,713,224**（0 解析错误） |
| 末尾停在**未闭合 turn**（⇒ 下次载入需 `interruptedTurnClosers` 修复） | **75** |
| 其中缓冲 **`live<1m`（正在跑）** | 40 / 43 —— **正常态** |
| `warm<10m` | 1 / 8 |
| **`cold<24h`** | **17 / 493** |
| **`archive>=24h`** | **17 / 901** |
| 悬空**工具调用**（pending tool calls） | **0** |

⇒ **34 个冷会话是被非优雅中断留下的**（文件本身完好、无撕裂），它们下次打开时会走
`prepareCore` → `commitRepair` 的合成 closer 路径。**这是"修复路径在真实环境确实会被用到"的实证**，
也说明：**帧容器保证了"文件不烂"，但"turn 未闭合"是语义层的常态遗留**——修复靠的是**载入时补写**，不是崩溃时写。

---

## 4. ② `session_projcache` 损坏 / 孤儿

### 4.1 现状实测（`scripts/m6-projcache-storages.mjs` → `raw/m6-projcache-storages.json`）

采样时刻 **2026-09-22 10:41:53Z / 18:41 本地**（文件 mtime 18:42:08，**仍在被重写**）

| 指标 | 实测 |
|---|---|
| 文件 | `~/.dsh/storages/session_projcache.json`，**11,489,140 B（11.0 MB）** |
| unit 头 | `{name:"session_projcache", version:3}`，`global: null` |
| **记录数** | **3,103** |
| 行数（rows 总计） | **42,261** |
| 持久层真实会话数（真实 `listArtifacts`） | **1,441** |
| **孤儿记录** | **1,670 ⇒ 孤儿率 53.82%**（二级档 SA-1 独立重算（18:35:28Z 快照 / 11,438,481 B）**同为 1670，逐位相同**；其口径 54.03% 与 58.5% 的差异经核对 = **分子 ±0、分母 +235 的纯分母漂移**，且孤儿是**冻结的死集合（12 h 零增长）** ⇒ **一次性清理后不会长回来**。按序列化字节占 **52.11%**） |
| 孤儿近似字节 | **2,697,283 B ≈ 2.57 MB** |
| 反向缺失（有会话、无缓存记录） | 8（0.56%）—— 缓存语义允许，非缺陷 |
| 序列化口径 | `JSON.stringify(pc, null, 2)+"\n"` **与磁盘文本逐字节相等**（`reserializeByteEqualsDisk: true`）⇒ 就是宿主实际写出的格式 |

**孤儿率与 `w03` 的 58.5% 对账**：**口径一致、数字不同源于时间漂移**（分母 3,103 vs 当时更少，且会话以 ~2/min 增长）。
**不是矛盾**——这正是 `w03` §7.1bis 自我更正过的同类现象。本轮**独立重算**得 53.82%，方向一致。

### 4.2 成本：每次整文件重写 ≈ 81.8 ms **同步**工作（实测）

| 步骤 | p50（本轮实测） |
|---|---|
| `readFile` 11.5 MB | **18.29 ms** |
| `JSON.parse` | **25.69 ms** |
| `JSON.stringify(pretty)` | **37.79 ms** |
| 合计（同步 CPU） | **≈81.8 ms**（另有 writeFile + 文件 fsync + 目录 fsync） |

**重写节奏（22.0 s 窗口 / 12 次采样）**：**8 次变更 = 0.363 次/s**，且 **inode 不稳定 ⇒ 确证 temp+rename 原子替换**。
（`w03` 测的 32.5 ms p50 是更早、文件更小（10.3 MB）时的值；本轮文件长到 11.5 MB，故同步前缀更长。
两个数字**不矛盾**，是同一趋势的两点。）

> ⚠️ **与"45 s ingest timer 验收 REJECT（第 3 窗口 2 拍 >1000 ms、max 1417 ms）"的关系**：
> 本轮**不做**该验收的裁决（题外，且需安静窗）。但提供一条可比对的事实：
> projcache 单次重写的**同步不可打断前缀 ≈82 ms**，理论上**单拍不足以造成 >1000 ms 停顿**；
> 若要造成 1 s 级单拍，需要约 12 次重写落在同一拍内，或与**同进程的其它同步块叠加**
> （11.5 MB stringify 与 appendLines/usage 事务共享事件循环与 4 个 libuv 线程）。
> **我未测该叠加，故不下结论**，仅指出"projcache 单独不是 1 s 级停顿的充分解释"。

### 4.3 损坏回落路径：**硬故障、无自愈、无备份**（FAIL）

方法：用 **真实 `JsonStorageBackend`**（`dsh-storage-json` 导出类，构造参数 `root`）在 `/tmp` 临时 root 上
按 `projectionCacheDomainSpec`（`name=session_projcache, version=3`）打开 11 种输入：

| 输入 | 结果 | 文件是否被改名/删除/重建 |
|---|---|---|
| 文件不存在 | ✅ 打开（空 state，惰性创建） | — |
| 合法空 unit | ✅ 打开 | 否 |
| 非法字节注入（`\u0000`） | ✗ `StorageError[malformed-medium]: file is not valid JSON` | **否（原样留在盘上）** |
| **`version: 2`（版本回退）** | ✗ `StorageError[version-mismatch]: stored version 2 != expected 3` | **否** |
| **`version: 9`（版本前滚）** | ✗ `version-mismatch` | **否** |
| `unit.name: "workspace"`（串台） | ✗ `malformed-medium: missing or foreign unit header` | **否** |
| 缺 `unit` 头 | ✗ 同上 | **否** |
| `tables.sessions` 非对象 | ✗ `malformed-medium: table 'sessions' is not an object` | **否** |
| 顶层是数组 | ✗ `malformed-medium` | **否** |
| **空文件（0 B）** | ✗ `malformed-medium: file is not valid JSON` | **否** |

**全部 9 种失效输入：文件都原样保留、不被改名、不被备份、不被重建。**

代码链（`file:line`）：
1. `dsh-storage-json/lib/index.js:87-115` `parse()`：`:92` JSON 失败 ⇒ `malformed-medium`；`:96` 头不符 ⇒ `malformed-medium`；`:98` 版本不符 ⇒ `version-mismatch`。**只抛，不修。**
2. `dsh-storage-json/lib/index.js:133-145` `openJsonUnit()`：`:137-139` **只有 ENOENT 走"新建空 state"**；其它一律 `parse(text, descriptor)` 抛出。**没有 rename 成 `.corrupt-<ts>`、也没有重建空 state 的分支。**
3. `dsh-storage-domain/lib/index.js:341-373` `open()`：注释 `:330` **明写** "backend `version-mismatch`/`malformed-medium` **pass through**"；`:365-368` 只 `unit.close()` 后 rethrow。
4. `dsh-session-projection-cache/lib/index.js:107-112` `[Service.init]()`：`await this.ctx.storageDomain.open(projectionCacheDomainSpec)` —— **无 try/catch**。

🟠 **二级档 SA-1 补充的一类"静默损坏"（本档未测，采信其 harness 实测）**：
往**字符串值内部**注入非法 UTF-8 字节 `0xFF` ⇒ JSON 解析层把它换成 **U+FFFD**，
**两层都报 OK（12 条记录）、没有任何日志**——**格式本身没有 checksum，值级损坏不可检测**。
后果不是报错而是**静默弃用**：值被改坏 ⇒ `identityMatches`
（`dsh-session-projection-cache:282-284`）失配 ⇒ 该记录被当作"不属于本会话"**静默丢弃**
（表现为**缓存莫名 miss**，不报错、不留痕）。⇒ 这是比"打不开"更隐蔽的一类：**能启动、能用、悄悄不缓存**。

🔴 **与产品自己的文档承诺直接冲突**：`dsh-session-projection-cache/lib/index.js:54-56` 写着
> "**Version bumps discard the whole medium** (cache semantics: a stale or unreadable cache costs a longer tail replay, never a wrong value)."

以及 `:88-89`："Every durable write is **fail-soft**: failures log a warning and the cache **self-heals** on the next write or cold read."

**全仓检索（`@deepseek-ai/*` 全部 lib）没有任何实现该"s discard"的代码**：`version-mismatch` 只有
`storage-json:98` 抛、`storage-domain:330` 透明转交、`tool-cordis:2785`（文档字符串）。
⇒ **承诺的"丢弃整块介质"是注释里的意图，不是代码里的行为。**
(`:22-23,73` 说的 `ver` mismatch discard 是**行级** `checkpointRow.ver`，不是**介质级** unit version——两回事，勿混。)

**后果（分两层，强度不同）**：
- **进程层：非致命。** cordis 把插件 init 错误收敛为 `context.logger.error(error)` 并记在 fiber 的 `_error` 上
  （`cordis/lib/index.js:979-981,1359-1360`）⇒ 宿主不会因它崩。
- **功能层：该服务永久缺席，且不会自愈。** 消费方以 **可选链** 读取：`dsh-host-apiproxy/lib/index.js:1489`
  `ctx.get("sessionProjectionCache")?.cachedSnapshot(meta)` ⇒ `session.list` **降级但仍可用**（回落到非缓存路径）。
  ⇒ **爆炸半径在功能上是"变慢"，不是"崩"**；但**坏文件永久留在盘上，每次冷启动复发，必须人工删/修**。
- ⚠️ **消费方降级：已由 SA-1 查明，两种模式并存、且都不丢会话行**（这解掉了我原先的 INCONCLUSIVE）：
  ① `session.list` 的投影列 `dsh-host-apiproxy/lib/index.js:1487-1495`（**可选链 + try/catch**）
  ⇒ **静默省略该列、不丢会话行**；② `dsh-subagent/lib/index.js:1869,1986-1989,1997`
  ⇒ **回退到 `persistence.inspect` 全量检视（慢但正确）**。
  ⇒ **全仓无任何路径会"静默返回空导致丢会话列表条目"**。projcache 失效的代价被限定为**变慢/少一列**。

### 4.4 行级 schema 与"半坏"数据

`checkpointRecord`（`dsh-session-projection-cache:49-52`）的 zod 校验实测拒绝：
`missingIdentity`（缺 identity）、`seq < -1`、`val` 非 JSON、`ver` 非整数。
⇒ 单条记录不合 schema 时，`dsh-storage-domain:352-356` 的 `parseRecord` 会把它变成
`DomainError[invalid-record]`（`:394-407`）**并让整个 domain 打不开**。
**即：一条坏记录 = 整个 projcache 服务缺席**（同样的永久性）。这是一个**比文件级损坏更容易发生**的入口
（11.5 MB JSON 里 42,261 行，任一行的 `ver`/`seq`/`val` 越界即可触发）。

### 4.5 残留物（顺带查清）

| 项 | 实测 | 判定 |
|---|---|---|
| `~/.dsh/storages/session_projcache/`（**空目录**） | 存在，`contents: []`，mtime **2026-09-20 07:45:50Z** | **残留**（不是新布局：json backend 落在 `<root>/session_projcache.json`，见 `dsh-session-projection-cache:13`；该目录无任何代码引用） |
| `~/.dsh/storages/.<uuid>.tmp` | 同一时刻**恰好 1 个**、大小随写入变化（本轮见 1.57 MB → 3.67 MB） | **正常在飞临时文件**：`dsh-storage-json:26` `.${randomUUID()}.tmp` → `:35` `rename` → `:38` 失败时 `rm`。**UUID 每次更换 ⇒ 确实在被 rename 掉，不是累积残留**。SA-1 独立复核（三拍 stat + `find ~/.dsh -maxdepth 3 -name '*.tmp' -mmin +5` = **0**）⇒ **恒为"在途"、当前无残留**；**并发度 max = p50 = p90 = 1 ⇒ 单写者严格串行（PASS）**。⚠️ **唯一缺口**：`rename` 之前进程被杀会留下孤儿 `.tmp`，而**启动时没有任何清理**（`openJsonUnit` 只读 `<name>.json`）⇒ 孤儿**无害但永不回收**。 |

---

## 5. ③ usage SQLite（44.5 MB）完整性与 WAL/busy_timeout

`scripts/m8-usage-db.mjs`（`readOnly: true` 打开，未做 checkpoint、未改任何 pragma）→ `raw/m8-usage-db.json`

### 5.1 完整性：PASS

| 检查 | 结果 |
|---|---|
| `PRAGMA integrity_check` | **ok** |
| `PRAGMA quick_check` | **ok** |
| `PRAGMA foreign_key_check` | **[]（空）** |
| 文件 | `usage.db` **49,442,816 B（47.2 MiB）** @18:47（`w05` 时的 44,589,056 已是更早读数；6 分钟内 `page_count` 10891 → **12074**，**在长**） |
| `-wal` | **4,560,872 B** |
| `-shm` | 32,768 B |
| 表 | `usage_events` **149,005** 行；`usage_daily` **335** 行；`sync_state` **3,503** 行 |
| 索引 | `idx_events_ts` / `idx_events_model` / `idx_events_project` + 3 个 autoindex（UNIQUE 约束） |
| SQLite | 3.51.3（经 `node:sqlite`，**实验特性**，每次启动打 `ExperimentalWarning`） |

**空间分布（`dbstat`，实测）**

| 对象 | 字节 | 占比 |
|---|---|---|
| `usage_events`（表） | 22,433,792 | 45.4% |
| `sqlite_autoindex_usage_events_1` | 11,173,888 | 22.6% |
| `idx_events_project` | 8,065,024 | 16.3% |
| `idx_events_model` | 3,866,624 | 7.8% |
| `idx_events_ts` | 2,502,656 | 5.1% |
| `sync_state` + autoindex | 1,286,144 | 2.6% |
| `usage_daily` + autoindex | 102,400 | 0.2% |

⇒ **索引合计 ≈25.6 MB，占库 49.4 MB 的 51.8%：索引比表本身（22.4 MB）还大。**
（这是体积/写入放大的可优化点，见 §7；**不是完整性缺陷**。）

### 5.2 WAL / busy_timeout / 崩溃安全

**应用实际设置的 PRAGMA（`~/.dsh/profiles/node_modules/@local/dsh-usage/lib/db.js`）**

| PRAGMA | 值 | 位置 |
|---|---|---|
| `journal_mode` | **WAL** | `db.js:74` |
| **`busy_timeout`** | **5000 ms** | **`db.js:81`** |
| `temp_store` | **2（内存）** | `db.js:90` |
| `application_id` | 守护：不符则写入本插件 id | `db.js:91-94` |
| `user_version` | 迁移账本 + **降级守护**（`user_version > 支持版本` ⇒ 关闭并抛"upgrade the plugin"） | `db.js:95-109` |
| `synchronous` | **未设置** ⇒ 取 `node:sqlite` 默认 **2 = FULL** | — |
| `wal_autocheckpoint` | **未设置** ⇒ 默认 **1000 页** | — |

🔴 **一处必须纠正的陷阱（否则会把"正常"当成"缺陷"）**：
`PRAGMA busy_timeout` 与 `PRAGMA synchronous` 都是**每连接**设置。
**只读探针连接读到的 `busy_timeout = 0` 是探针自己的默认值**（`node:sqlite` 新连接默认实测 =
`{journal_mode:"delete", synchronous:2, busy_timeout:{timeout:0}, temp_store:0, foreign_keys:1,
wal_autocheckpoint:1000, cache_size:-2000, mmap_size:0}`），**不是应用连接的值**。
`db.js:75-80` 的注释还明确记录了这段历史：**"shipped default 是 `busy_timeout = 0`，把每次碰撞变成立刻
`ERR_SQLITE_ERROR: database is locked`；5 s 把它变成短暂等待（实测：立即失败 → 等待 1530 ms → 成功）"**。
⇒ **结论：`busy_timeout` 在当前 deployed 代码里已经修好（5000）**。
（本线二级档 SA-2 的中断前产物里留有一条 `busy_timeout: 0`，**那是探针连接的属性，不可作为应用缺陷引用**——
此处就地纠正，避免错误结论被下游采纳。）

**WAL 是否失控：PASS（且二级档 SA-2 用纯字节解析把机制钉死，比本档初版更强）**：
本档初版只能说"4,560,872 B ≈ 阈值 4,096,000 的 111.3%、35 s 内稳定"。**SA-2 的独立解析更正了这个读法**：
- `4,560,872 B = 32 + 1107 × 4120`（**整除**）⇒ 这是 `-wal` 的**历史高水位**；`-wal` 的 **inode 与长度在 240 s / 80 点采样中恒定不变**。
- 按 WAL salt 校验，**当前代有效帧仅 119–976 个**，其余是**上一代残留字节**；
  `-shm` 的 `mxFrame`/`nPage` 与字节法**逐次吻合**。
- **autocheckpoint 确实触发**：SA-2 在自建 scratch 库复现 —— 第 4 pass 帧数 1217 越过 1000 ⇒
  `nBackfill` 0→1217、dbPages 1→1205；第 5 pass `ckptSeq`+1、salt 轮换、`mxFrame` 归小，
  而 **`walSize` 一点没变**（**原地重用**，因 `journal_size_limit = -1`）。
- 宿主 8 分钟内 `ckptSeq` **21→35**（≈每个 ingest pass 一次，与 `INGEST_INTERVAL_MS = 45000` 同频）。

⇒ **结论升级**：4.5 MiB **不是"未 checkpoint 的积压"**，而是被反复复用的高水位文件；
**真正"已提交但尚未落 `.db`"的上界 ≈1000 帧，实测瞬时 119–976 帧（0.5–4.0 MB）**。
这同时为"崩溃后需重放的 WAL 很短"提供了量化依据（配合 `synchronous=FULL`，见下）。

**掉电/`SIGKILL` 时已提交事务会丢吗？PASS（依据而非泛谈）**：
`journal_mode = WAL` + `synchronous` 未改 ⇒ 默认 **FULL**。WAL + `synchronous=FULL` 的语义是
**每次事务提交都对 WAL 文件做 fsync** ⇒ 已提交事务在崩溃后可由 WAL 重放，**不丢**。
唯一仍可能丢的是"尚未提交"的事务——这是定义使然，不是缺陷。
（残留边界：`node:sqlite` 是**实验特性**，其默认值理论上可能随 Node 版本变化；本机 Node **v22.23.2** 实测默认 `synchronous=2`。）

**并发写者（已由 SA-2 查清；附一条关键假阴性警告）**
- **进程数 = 1**：`/proc/locks` 按 inode 过滤只出现 **PID 2988915**（db inode 31074181 / shm inode 31075423），80/80 采样如此。
- **连接数 = 2（同一进程内）**：宿主 `@local/dsh-usage/lib/index.js:300` + **ingest worker 线程**
  `ingest-worker.js:107`（`node:worker_threads`，`openOnce` 跨 pass 复用）。
- 🔴 **假阴性警告（必须记住）**：**`/proc/<pid>/fd` 与 `/proc/<pid>/maps` 在本机返回 EACCES**
  （`ptrace_scope = 1`）⇒ **`lsof` / `fuser` 输出为空是假阴性，绝不能读成"无人持有"**。
  （本档初版把这个枚举列为 INCONCLUSIVE 而未做，正好避开了这个陷阱；SA-2 用 `/proc/locks` 绕过了它。）
- **窄 FAIL**：`db.js:73`（构造连接）→ `:81`（装 busy handler）之间存在一个**无 busy handler 的窗口**；
  仅当库不是 WAL 时 `:74` 需要排他锁才可能触发（**低危**）。
- **重试链已存在**：除 5 s busy handler 外，还有 **pass 级重试** —— `ingest-worker.js:169-176`
  （catch → `failed`）、`ingest-runner.js:122-124`（记账）、`index.js:78,345-348`（45 s 定时器）。
- **INCONCLUSIVE**：生产期是否**真的**出现过 `SQLITE_BUSY` —— 宿主 stdout 未落盘
  （`dsh-restart.log` 对 usage/locked/ingest **0 命中**），**无法证实亦无法证伪**。

### 5.3 损坏回落路径：**8 场景实测 —— 静默清空是最严重的一条**（FAIL）

方法：SA-2 在**副本**上跑**真实 `openUsageDb`**（其 `harness/db.js` 与部署文件 **sha256 一致**
`ecb86c23…80a00`）⇒ `raw/q3-results.json`。**本档初版这里标 INCONCLUSIVE，现已被实测取代。**
（我自己的只读探针 `m8` 不写库，故无法覆盖这些场景；这是"分档互补"的一个实例。）

| 场景（副本上） | 实测结果 | 判定 |
|---|---|---|
| **截断到 0 B** | 🚨 **无任何报错地重建为空表**，`usage_events` **147,685 → 0** | **FAIL：全部历史静默消失** |
| 截断到 1024 B / 头页覆写 | 抛错（`malformed` / `file is not a database`）；**文件未被改写**；`index.js:335-339` catch → warn `ingest disabled` ⇒ **宿主不崩、无自愈、该生命周期内 usage 永久失效** | **FAIL** |
| **删 `-wal` 只留 db** | 无报错，**静默丢 94 条已提交事件**，且 `integrity_check` **仍报 ok** | **FAIL（静默）** |
| 中段页覆写 | `integrity_check` **能查出**（`Tree 2 page 2049`），但**打开路径从不做该检查** ⇒ **带病上线** | **FAIL** |
| `user_version = 2` | 抛降级守卫错（`db.js:103-109`） | **PASS（唯一生效的守卫）** |
| 放入"别人的" SQLite 库 | **静默把 `application_id` 覆写**并并排建表 ⇒ `db.js:17` 注释所称的 "guard" **实为无条件覆写** | **FAIL** |
| 对照：`close()` 最后一个连接 | 会 checkpoint 并**删除** `-wal`/`-shm` | 机制确证 |
| `-shm` 丢失 | SQLite 自行重建 | **PASS** |

⇒ **最严重的一条**：**"0 字节"不是"文件缺失"，但代码把它当成了"文件缺失"**——
`db.js:70-72` 的 `if (!existsSync(path)) openSync(path, "wx")` 只判断**存在性**，不判断**内容**；
一个被截断成 0 B 的 `usage.db` 会走进"全新库"路径，`ensureSchema` 建出空表并**正常返回**。
**结果是 149,506 条用量历史在无任何报错、无任何日志的情况下变成 0。**

**其余相关事实**
| 问题 | 结论 |
|---|---|
| 启动时有没有 `integrity_check`？ | **没有**。`openUsageDb`（`db.js:67-112`）只做 WAL、busy_timeout、temp_store、application_id、`user_version` 降级守护、`ensureSchema` —— **不做任何完整性体检**（这使上表"中段页覆写"必然带病上线） |
| 会**静默**丢历史 usage 数据吗？ | **会**（0 B 截断、丢 `-wal`、外来库覆写 `application_id` 三条都是静默）。**这修正了本档初版"不会静默"的判断**——初版只看了三个显式抛错的守护，漏掉了"存在性判断被当成完整性判断"这条路 |
| 迁移策略 | **有**（`storages` 里唯一有正经迁移账本的产物）：`user_version` = 账本，`db.js:95-102` 明文规定"未来 v2+ 必须在此处 stepwise migrate；**绝不把更新的库静默重盖成 v1**"；当前 `user_version=1`（`schema_version=6` 是 SQLite 内部 cookie，非应用版本） |

### 5.4 另一处 SQLite 打开点：**它有自愈，但没在跑**

`dsh-session-query-sqlite/lib/index.js:40-70`（会话搜索派生索引）：

| 机制 | 位置 | 事实 |
|---|---|---|
| 外来库拒绝 | `:53-54` | `application_id` 既非 0 也非 `1146308689` ⇒ 抛"belongs to another application" |
| 空库判定 | `:55` | `application_id=0` 但有用户表 ⇒ 抛"not an empty or recognized derived index" |
| **版本不符 ⇒ 重建而不是失败** | `:57` | **`if (version !== 8) resetDerivedSchema(db, userTables);`** |
| 无 `busy_timeout` | — | 该 open 点**未设置** ⇒ 默认 0 |

⇒ **同类问题上存在一个正确的范式参照**：派生索引"版本不符就重建"，而 `storages` 的 json unit"版本不符就永远打不开"。
⚠️ **但**：本机 `~/.dsh` 下**只有 `usage.db` 一个 `.db`**，**不存在 session-search 库**
⇒ **该自愈路径当前未启用**，不能当作"系统已有自愈能力"来引用。

### 5.5 一处异常：`page_count × page_size` 与文件字节的差额 —— **已定性，不是损坏**（INCONCLUSIVE → 解决）

- 本档：当前 `12,074 × 4096 = 49,455,104`，文件 `49,442,816` ⇒ **差 12,288 B = 恰好 3 页**
- SA-2 的 07:18Z 副本：`10,891 × 4096 = 44,609,536`，文件 `44,589,056` ⇒ **差 20,480 B = 5 页**
- **差值不是常数**（3 页 / 5 页），且两次 `integrity_check` 都是 ok

**SA-2 用三方对齐把它定性了**：`page_count` 是"**WAL 已应用后的逻辑页数**"。
旧快照：物理 `44,589,056 / 4096 = 10,886` 页、`page_count = 10,891`、
WAL 最后一个 commit 帧的 `dbsize = 10,891` ⇒ **三方对齐，差 5 页**。
新副本复现：**11,966 物理 vs 11,970 逻辑（16,384 B）**；**18:52 采样差额 = 0**。
且 **`dbstat` 合计 == `page_count × page_size` == 同快照的物理字节**（无未解释字节）。

⇒ **判定：差额 = WAL 逻辑尺寸 − 物理文件尺寸，随快照漂移，属正常滞后，不是 header 损坏、也不是截断。**
（本档初版把"停机复测"列为验证条件；SA-2 用"同快照三方对齐 + 差额可归零"给出了**不需要停机**的等价证明，
故此项从 INCONCLUSIVE 结算为 **PASS（已解释）**。）

---

## 6. ④ `~/.dsh/storages` 各文件的版本/迁移/备份策略

### 6.1 版本与迁移账本（实测）

| 产物 | 介质 | name | **version** | 定义点 | 迁移能力 |
|---|---|---|---|---|---|
| `session_projcache.json` | storage-json | `session_projcache` | **3** | `dsh-session-projection-cache/lib/index.js:58-62` | ❌ **无**（版本不符 ⇒ 永久打不开；注释说"discard"但无实现） |
| `workspace.json` | storage-json | `workspace` | **2** | `dsh-workspace/lib/index.js:224-227`（SA-2 另指 `dsh-workspace/lib/invariant.js:42-60`） | ❌ 无迁移；但**丢失可由 `sessionPersistence.list()` 重建**（`dsh-workspace/lib/index.js:320-323`，因 `initial.initialized=false`），代价是丢标题/排序/归档 |
| `message_feedback.json` | storage-json | `message_feedback` | **0** | `dsh-message-feedback/lib/index.js:70-74` | ❌ 无（且 mtime **08-28**，已 25 天未变） |
| `usage/usage.db{,-wal,-shm}` | **SQLite**（非 storage-json unit） | — | **`user_version=1`**（`schema_version=6` 是 SQLite 内部 cookie） | `@local/dsh-usage/lib/db.js:95-110` | ✅ **有**：`user_version` 账本 + 明确"未来 stepwise migrate"规定 + **降级守护** |
| `session_projcache/`（空目录） | — | — | — | 无代码引用 | 残留，见 §4.5 |
| `.<uuid>.tmp` | — | — | — | `dsh-storage-json:26,35,38` | 在飞临时文件；崩溃孤儿**无启动清理** |

**通用版本守护（storage-json）**：`dsh-storage-json/lib/index.js`
`:87-115` `parse()` — `:92` 非法 JSON ⇒ `malformed-medium`；`:96` unit 头缺失/串台 ⇒ `malformed-medium`；
`:98` **`version !== descriptor.version` ⇒ `version-mismatch`**。
`:133-145` `openJsonUnit()` — **仅 ENOENT 走惰性建空 state**，其余抛出。
`dsh-storage-domain/lib/index.js:341-373` — **`version-mismatch`/`malformed-medium` 透明转交给调用方**（注释 `:330` 自认）。

### 6.2 **缺什么**（逐条，带证据）

| # | 缺什么 | 证据 |
|---|---|---|
| 1 | 🔴 **没有任何自动备份/快照** | `ls ~/.dsh/backups/` 共 22 项，**全部**是 settings/taste/插件源码的手工 `.bak`（mtime 8-28 ~ 9-17）；`find ~/.dsh -name '*projcache*' -o -name 'usage.db*' -o -name 'workspace.json*'` 在 `storages/` **之外零命中** ⇒ **storages 的 4 个产物一个备份都没有** |
| 2 | 🔴 **没有损坏自愈**（storage-json 全线） | §4.3 的 9/9 失效输入：文件**原样保留、不改名、不重建**；`openJsonUnit:133-145` 无 `.corrupt`/rename/rebuild 分支 |
| 3 | 🔴 **没有完整性体检** | usage 打开路径无 `integrity_check`；storage-json 除 `JSON.parse` 外无校验；zstd artifact 的完整性只有"读到才验"（全库扫描是我做的，产品无此功能） |
| 4 | 🟠 **一条坏记录 = 整个 domain 打不开** | `dsh-storage-domain:352-356` + `:394-407`（`invalid-record` 使整个 `open()` 失败）；projcache 有 42,261 行 ⇒ 命中面不小 |
| 5 | 🟠 **注释承诺与实现不符**（"discard the whole medium" / "self-heals"） | `dsh-session-projection-cache:54-56,88-89` vs 全仓无实现（§4.3） |
| 6 | 🟠 **无启动清理**（崩溃孤儿的 `.tmp`） | `dsh-storage-json:26,35,38`（只在**当次**错误时 `rm`）；`openJsonUnit` 只读 `<name>.json` |
| 7 | 🟡 **无跨库对账**（SA-2 双向 grep = **0 命中**） | `session_projcache.json`（3,103 记录，含 identity 绑定 `(id, createdAt, cwd)`，`dsh-session-projection-cache:39-52`）与 `usage.db`（`usage_events` 149,506 行，按 `dedup_key`）**两套代码零交叉引用、零对账、无共享水位**（usage 的 `last_seq` 是**源文件游标**，不是投影 `seq`）；**语义还相反**（projcache："只会过期不会错"、`ver` 不符即丢行；usage：UPSERT 最新观测胜）⇒ §5.3 的单侧故障（丢 `-wal` / 0 B 截断）只打掉 usage 一侧 ⇒ **不一致会被静默制造且无人发现** |
| 8 | 🟡 **全仓迁移逻辑 = 0** | `grep -rn migrat` 仅命中 4 条"**永不迁移**"的注释；`dsh-storage-json:98` 的版本校验是**硬相等**，没有 upgrade 步骤 |

### 6.3 **崩了会怎样**（逐产物，判定）

| 产物 | 损坏/丢失后的后果 | 判定 |
|---|---|---|
| `session_projcache.json` **损坏** | 文件永久保留、每次冷启动复发；`sessionProjectionCache` 服务缺席；消费方用 `ctx.get(...)?.` ⇒ **`session.list` 降级（变慢）不崩**；**无自愈、无备份** | **FAIL** |
| `session_projcache.json` **丢失** | ✅ 惰性重建空 state（`dsh-storage-json:137-139`）⇒ 等价于冷缓存，代价是 tail replay 变长 | **PASS** |
| `workspace.json` 损坏 | 同 projcache 机制（无自愈）；SA-2 查明**损坏无重建**，但**丢失可从 `sessionPersistence.list()` 重建**（`dsh-workspace/lib/index.js:320-323`），代价丢标题/排序/归档；⚠️ 消费点是否带可选链**未验证** | **FAIL（损坏）/ PASS（丢失可重建）** |
| `message_feedback.json` 损坏 | 同构（SA-2 确认）；丢失=惰性重建（丢用户反馈，非关键） | **PASS（丢的是可重建/低价值数据）** |
| `usage.db` **被截断成 0 B** | 🚨 **静默重建为空库，149,506 条事件归零**（SA-2 副本实测，§5.3） | **FAIL（最严重）** |
| `usage.db` 头页/中段损坏 | 抛错 ⇒ `ingest disabled`，宿主不崩、无自愈、该生命周期内 usage 永久失效；中段坏**带病上线** | **FAIL** |
| `usage.db` 丢失 | `if (!existsSync(path)) openSync(path,"wx")` ⇒ **静默建空库**，历史用量**永久丢失且无备份** | **FAIL（静默丢历史）** |
| `usage.db-wal` 丢失 | **静默丢 94 条已提交事件**（SA-2 副本实测），`integrity_check` 仍 ok；**无备份** | **FAIL（静默）** |
| `usage.db-shm` 丢失 | SQLite 自行重建 | **PASS** |
| 外来 SQLite 库被放到该路径 | **静默覆写 `application_id` 并并排建表**（"guard"实为无条件覆写） | **FAIL** |
| zstd 会话 artifact 损坏 | 见 §3.4/§3.5：**中间帧坏⇒整会话不可读；头帧坏⇒整表打不开；头帧缺⇒静默消失** | **FAIL** |

---

## 7. ⑤ 前三优化候选（收益 / 风险 / 验收 / 回滚 / 热冷面）

> **排序原则**：按"**最坏后果 × 发生概率 × 恢复手段是否存在**"排。本线的核心观察是——
> **恢复手段不存在**（无备份、无 salvage、无自愈），所以第一位不是"修 bug"，而是"先让能恢复"。
> **面（热/冷）判据**：本程序约定 **宿主 JS 补丁 = 冷面（需重启宿主才装载）**；客户端插件 = 热面。以下均为**宿主 JS / 运维脚本**，故基本都是**冷面**。

### 候选 1（**首选**）：`~/.dsh/storages` 的冷备份 + 可验证恢复（含损坏隔离）

**做什么（最小可落地）**
1. 在 `dsh-restart.sh` 的停机前后各加一步：停机后、启动前，把 4 个持久化产物
   （`session_projcache.json`、`workspace.json`、`message_feedback.json`、`usage/usage.db{,-wal,-shm}`）
   复制到 `~/.dsh/backups/storages.<ts>/`，**保留最近 N 份**（N=3），并对每份写 `sha256 + size + unit.version`。
   ⚠️ **usage 必须三件套一起复制**（缺 `-wal` 结论无效），或先对副本执行只读打开后的 `VACUUM INTO`。
2. 启动时**不**自动还原（避免把好数据覆盖坏数据）；只在**检测到 unit 打不开**时打印一条明确的
   `RECOVERY: <unit> failed to open; backup at <path>; restore command: cp ...`。
3. 恢复脚本 `storages-restore.sh --from <ts> --unit <name>`：**先备份现状**再覆盖，单产物粒度。

**收益**：把 §6.2#1 与 §6.3 的一整列 **FAIL**（"永久丢失"）变成"有回滚点"。这是本线全部发现里
**唯一把不可逆变成可逆**的改动。备份体积：~62 MB/份（11.5 + 11.4 + 49.4 + 0.01）⇒ **保留 3 份 ≈186 MB**。
**风险**：低（纯增量文件操作，不碰产品逻辑）。真实风险是**备份把 WAL 抄成不一致快照** ⇒
必须"三件套一起 + 同一次 `cp`"，或停机后复制（停机后 WAL 已静默，最安全）。
**验收**：① `ls ~/.dsh/backups/storages.*/` 有 N 份且每份 `sha256` 与当次记录一致；
② 故意损坏一份**副本**上的 projcache（注入 `\u0000`）后用恢复脚本还原 → `JsonStorageBackend.kv.open` 成功；
③ 恢复前后 `du -sh` 与 `unit.version` 一致。
**回滚**：`rm -rf ~/.dsh/backups/storages.<ts>/` 与删除 script 中的两个 hook；**不影响任何运行态**。
**面**：**冷面**（`dsh-restart.sh` 钩子 + 脚本，随下次重启生效）。

### 候选 2（**本线新发现，性价比最高**）：`usage.db` 打开路径的**损坏守卫**（把"静默清空"改成"拒绝 + 改名保底"）

**为什么它排第二**：§5.3 实测出了一条**全库最严重的具体数据丢失机制**——
`usage.db` 被截断成 **0 字节**时，真实 `openUsageDb` **不报任何错**，把它当"文件不存在"重建为空表，
**149,506 条用量历史静默归零**（`db.js:70-72` 只判**存在性**、不判**内容**）。
这比"打不开"更坏：**打不开会喊，静默清空不会**。而修复面极小、风险极低。

**做什么（细粒度，4 处，全部在 `~/.dsh/profiles/node_modules/@local/dsh-usage/lib/db.js`）**
1. **`:70-72` 的存在性判断补上内容判断**：`existsSync(path) && statSync(path).size > 0`。
   **0 字节 ⇒ 视为损坏，不走"新建"路径**（进入第 2 步的守卫）。
2. **新增 `assertUsableDb(path)`（在 `new DatabaseSync` 之前，且在 `:81` busy handler 之前）**：
   - 文件存在且非 0 字节 ⇒ 以**只读**连接读 `PRAGMA application_id` + `user_version`：
     - `application_id` 既非 0 也非 `DSH_USAGE_APPLICATION_ID` ⇒ **拒绝打开**（外来库）；
     - 有用户表但 `application_id === 0` ⇒ **拒绝**（未认领的库）；
     - `user_version` 超版本 ⇒ 沿用现有降级守卫（`db.js:103-109`，**这条已 PASS，不要动**）。
   - 任一拒绝发生时：**先把文件（含 `-wal`/`-shm` 三件套）`rename` 成
     `usage.db.corrupt-<ts>`**，**然后才**允许走"新建空库"，并 `logger.warn` 一条明确告警。
3. **把 `db.js:91-94` 的 `application_id` 从"无条件覆写"改成"仅当为 0 时写入"**
   （现在注释称 guard、实为覆写，会把外来库的标识静默改掉，§5.3）。
4. **（可选，但有价值）** 只读开一次 `PRAGMA quick_check`，失败 ⇒ 同上走"改名 + 告警"，
   不再带病上线（`integrity_check` 能查出中段页损坏，但当前打开路径从不调用，§5.3）。

**收益**：把 4 条 FAIL（0 B 截断静默清空 / 外来库覆写 / 中段坏带病上线 / 缺失静默建空）
压缩为"**改名保底 + 明确告警 + 显式恢复路径**"。这是唯一能阻止"149,506 条历史一夜归零"的改动。
**风险**：🟡 **低**。唯一真实风险是**误判**（把一个合法的空库当损坏）。
缓解：**只把"0 字节"与"`application_id` 不符/未认领"当作损坏信号**，
**不**把 `quick_check` 失败作为硬拒绝（保守起见，可先只告警）。
⚠️ **`rename` 而非 `rm`** 是硬要求——它让"误判"变成可回滚。
**验收**：① 副本上截断 `usage.db` 到 **0 B** → 启动后应**出现 `usage.db.corrupt-<ts>`** 且**原文件字节数 == 0 的副本保留**，
日志有明确 warn；② 副本上放一个外来 SQLite 库 → **拒绝打开**且 `application_id` **未被改写**；
③ 正常库（当前生产快照的三件套副本）→ **打开成功、`usage_events` 行数不变、不产生任何 `.corrupt-*`**（回归闸门）；
④ `user_version=2` 仍抛降级守卫错（**不得回退这条已 PASS 的行为**）。
**回滚**：改动是 4 处局部 edit，`git`/`cp` 回原版即可；`*.corrupt-<ts>` 是新增文件，`rm` 即清理；无 schema 变更。
**面**：**冷面**（`@local/dsh-usage` 是宿主侧插件 JS，需一次重启才装载）。

### 候选 3：`listArtifacts` 的**损坏隔离**（头帧坏 ⇒ 隔离单会话而非整表；头帧缺 ⇒ 显式计数而非静默）

**现状（§3.5）**：`dsh-session-persistence-jsonl/lib/index.js:1096-1097` 把
`probeArtifactsBounded` 已经**逐目录捕获**的错误（`:1162-1165`）**立刻 rethrow** ⇒
**1 个头帧坏的会话 = 整张会话列表不可用**；而 `:1123/:1125` 的 `return void 0` 让**截断/空文件静默消失**。

**做什么（细粒度，两处）**
1. `:1096-1097`：不再 rethrow。改为把 `{dir, error}` 收进 `quarantined[]`，**继续返回健康会话**，
   并在返回值/日志里带出被隔离的目录与原因（`entry.error.message` 里已有精确字节位置）。
   ⚠️ **必须保留**原有的"重复 id 检测"与 `encodingMismatch` 语义——**只隔离"单文件内容损坏"这一类**，
   `encodingMismatch` / `duplicate id`（`:1100`）仍应整体抛（它们是**配置级**错误，静默会掩盖真问题）。
2. `:1123/:1125`：把静默 `return void 0` 分成两类——**目录里没有 artifact**（真·空）保持静默、
   零开销；**artifact 存在但头帧读不出**（`:1118` 已确认 `pathExists`）→ 记入 `unreadable[]` 并计数上报。
3. 顺带：`assertStoredIdentity`（`:1423-1434`）抛错目前也会整表失败——同属可隔离类。

**收益**：把"1 个坏文件 ⇒ 99 个会话都看不到"降级为"1 个坏文件 ⇒ 1 个会话被隔离 + 明确告警"。
另：**当前已有 3 个陈旧 `session.v3.jsonl.zstd` + 3 个 0 字节 `session.lock`**（§3.2 / §3.7、合计 1.05 MB）
可借此暴露出来（它们现在对扫描器**完全不可见**，属"静默不计数"的实例）。
**风险**：🟠 **中**。核心风险是**把真实故障静默化**。缓解：隔离**必须**有可见出口
（日志 + `listArtifacts` 返回的隔离清单 + 计数指标），且**不得**把配置级错误（encoding/id 冲突）纳入隔离。
**验收**：① 在 §3.5 的合成 root 上重跑：`headerInsideCorrupt` / `headerMagicCorrupt` 应
**列出 2 个健康会话 + 隔离 1 个**（现在列出 0）；② `zeroByteFile` / 头帧截断应
**列出 2 + 报告 1 个不可读**（现在静默列出 2）；③ `encodingMismatch` / 重复 id 场景**仍整体抛**；
④ 真实全库回归：`listArtifacts` 仍返回 **1440+ 且与目录数闭包**（当前实测 1440/1440）。
**回滚**：单文件补丁，`git`/`cp` 回原版即可；无持久化副作用。
**面**：**冷面**（宿主 JS，需一次重启）。

### 候选 4（紧随其后，非"第四优先"而是"与候选 1/2 同批可做"）：projcache 损坏自愈（兑现注释承诺）+ 孤儿回收
**做什么（三件，按风险从低到高）**
1. **兑现"discard the whole medium"**：在 `dsh-session-projection-cache/lib/index.js:107-112` 的
   `[Service.init]()` 包 try/catch；捕获 `StorageError[malformed-medium|version-mismatch]` 与
   `DomainError[invalid-record]` 时——**先把文件 `rename` 成 `session_projcache.json.corrupt-<ts>`**（保底），
   再让 backend 以"文件不存在 ⇒ 惰性建空 state"（`dsh-storage-json:137-139` 已有该分支）重新 open。
   ⇒ **一次改动同时修好**：`version-mismatch` 永久打不开、`malformed-medium` 永久打不开、
   **一条坏记录拖垮整个 domain**（§4.3 / §6.2#4）、以及"注释承诺与实现不符"（§6.2#5）。
   ⚠️ **`rename` 而非 `rm`** 是关键——它同时提供了候选 1 想要的"可恢复"。
   ⚠️ **不要**改 `dsh-storage-domain` 的透明转交语义（那是通用层，改动面大且影响其它 unit）；
   **只**在 projcache 这一个消费点兜底。**这是"最小且安全"的切法。**
2. **孤儿回收**：`cachedSnapshot` 的读侧只接受 `identityMatches`（`:123-127`）的记录 ⇒
   孤儿（1,670 条 / 53.82% / ≈2.57 MB）**对正确性无害、纯占盘**（本线确证）。
   回收方式：在 `write(session)`（`:159+`）路径上顺带剔除
   `identity.createdAt/cwd` 与当前持久层 header 不符、且**连续 N 次未命中**的记录；
   或在冷启动扫一次 `listArtifacts` 的 id 集合做一次剪枝。
3. **（可选）拆分/压缩序列化**：11.5 MB × `stringify(pretty)` **37.79 ms 同步**（§4.2）是热点。
   `w03` 候选 2 已建议"按 unit 可配置紧凑序列化"——本线补充**量化**：紧凑化约可省
   **18–25% 字节 + 10–20 ms 同步前缀**（**估算，未实测**，见 §8 诚实清单）。

**收益**：① 消除"坏一次就永久坏"的 3 类入口（含 42,261 行任一行越界）；② 释放 ≈2.57 MB 盘面 + 缩短冷放大会话；
③ 减少每次 81.8 ms 同步前缀（对"不可打断停顿"有正贡献，但**不足以单独解释 1 s 级单拍**，§4.2）。
**风险**：🟠 **中**。①最大风险是"**误判损坏**"——若把可解析但**语义超前**的文件当损坏丢弃，
会**丢掉本可用的缓存**（缓存可复活 ⇒ 后果有限，且 `.corrupt-<ts>` 保底）；
② 必须**只在 init 兜底**，不要在每次写路径上做丢弃（否则一次瞬时 I/O 错误会清掉整块缓存）。
**验收**：① 对**副本**注入 `\u0000` / 改 `version:2` / 造一条 `seq=-5` 记录（SA-1 的 V6 毒丸），启动后应
**成功 open 且 `session_projcache.json.corrupt-<ts>` 存在、内容 == 原文**；
② 修复后 `session.list` 仍返回 1440+，且 `sessionProjectionCache` 服务在位（不再缺席）；
③ 孤儿率从 53.82% 下降到可解释水平（目标 <15%，**需先定义"连续 N 次未命中"的 N 并同窗对照**；
SA-1 指出孤儿是**冻结死集合**⇒ 一次性清理后不会长回来，故可作一次性收益）；
④ **回归**：正常启动路径下**不得**产生任何 `*.corrupt-*` 文件；
⑤ **SA-1 给出的关键闸门**：任何"写回 pruned 文件"的动作之后，必须用 harness 跑一次
`DomainFacility.open`，断言 `ok` 且 `tableSize == 1421` —— **防止写出 schema 不符的记录 ⇒ 按 N1 会整域永久打不开**。
⚠️ **本候选 4 修不了 N2（值级静默损坏）**：那需要给 unit 格式加 checksum/摘要（`dsh-storage-json:68-80`
目前无任何校验和）。**这是独立决策，不应塞进本候选**；在未做之前，N2 表现为"缓存偶尔莫名 miss"，
是可容忍的（缓存语义），因此**建议只在时序上排后**，不必现在动手。
**回滚**：删除该 try/catch 即回到现行为；`*.corrupt-<ts>` 是新增文件，`rm` 即清理。
**面**：**冷面**（宿主 JS，需一次重启）。

### 7.4 明确**不建议做**（本线实测依据）

| 提议 | 为什么不做 |
|---|---|
| **给 zstd 容器加"跳过坏帧继续读"的 salvage** | 看似补 §3.4 的洞，但它**改变耐久语义**：中间帧坏 + 继续读 ⇒ 会把"断层的会话历史"当成完整历史交给上层（seq 空洞、turn 配对错乱）。**正确顺序是先做候选 1（备份）与候选 4（rename 保底）**，再单独设计"salvage 必须携带显式断层标记且**永不就地覆盖原文件**"。**本轮不给实现方案。** |
| **为省 CPU 去掉文件 fsync / 降 zstd 级别** | `w03` 已实测：append 的 97% 是 fsync、提高 zstd 级别是 50× CPU 换 28% 体积（纯亏）。本线补充：**去掉 fsync 会直接摧毁 §5.2 的耐久性论证**（现在 `synchronous=FULL` 保证已提交事务不丢）⇒ **负收益**。 |
| **调大 `wal_autocheckpoint` 以减少 checkpoint** | 现 WAL **有界在阈值 111.3%**、35 s 稳定（§5.2）。调大只会让"崩溃后需重放的 WAL"更长，**劣化恢复时间**，换不到可测收益。 |
| **对 projcache 做"热清理"（宿主运行时从外部删孤儿记录）** | **实测不可行**：宿主 **0.363 次/s** 整文件重写、**inode 每次更换**（temp+rename）⇒ 外部修改会被下一次写**直接覆盖**；且**宿主内存态才是权威**（`dsh-storage-json:119-123` "in-memory state is authoritative"）⇒ 热清理无效且会误导。**必须是候选 4 那样的产品侧改动，或停机冷做。** |

---

## 8. 全表 PASS / FAIL / INCONCLUSIVE

| # | 断言 | 判定 | 证据 / file:line |
|---|---|---|---|
| A1 | 多帧容器**不重压全文件**，每批一个独立帧 | **PASS** | `:491,494,572-574,1258-1261`；实测 1419 文件 **1,199,487 帧**、均 612.3 B |
| A2 | 每帧带 checksum，可独立校验 | **PASS** | `:494`；独立 oracle 逐帧 `zstdDecompressSync` 全部通过 |
| A3 | 头帧**恰好一行**且随物化一次写定 | **PASS** | `:741-743,1249-1256`；1419/1419 `headerFrameExactlyOneLine` = true |
| A4 | 结构性撕裂尾**可检测**（不解压即定位） | **PASS** | `:503-566`；T1/T2/T5/T6/T7 全部检出，`tornStart` 精确到字节 |
| A5 | 撕裂尾**可恢复到最后一个完整帧** | **PASS** | `:1004-1011` `truncateTo = tornStart` |
| A6 | 撕裂帧里的**完整记录能被捞回** | **PASS** | `:992-999`（`ZSTD_e_flush`）；T6 实测 **recoveredEvents = 23** |
| A7 | 前缀读与全量读**语义自洽、无静默丢失/重复** | **PASS** | `m4`：全量 51,756,592 − 前缀 51,739,900 = **16,692 == 末帧明文**；事件差 23 == 末帧事件数 |
| A8 | 追加失败**回滚文件大小**（不留半帧、不重复 seq） | **PASS** | `:1278-1305`（`:1289` stat before）+ `:1306-1314` |
| A9 | 载入时对未闭合 turn/step **合成补写** | **PASS** | 协调器 `dsh-session-persistence:1005-1006,1035-1036`；实测 **34 个冷会话**处于该状态（自然阳性对照） |
| A10 | 全库当前**帧级完整性健康** | **PASS（强）** | 1419 artifact / 734,487,393 B / 1,199,487 帧 → **CLEAN 1419/1419**；`raw/m1-frame-scan-*` |
| A11 | **双解码器一致**（产品私有解码器无隐藏缺陷） | **PASS** | 1419/1419 逐字节相等（`dualDecoderAgreeAll`） |
| A12 | 提取的 `scanZstdFrames` 与产品判定一致 | **PASS** | 1419/1419（`tornAgreeAll`） |
| A13 | 真实优雅重启（18:11:49）**未留任何撕裂尾** | **PASS（强）** | 12 artifact 共享 mtime `18:11:43.1439145070` + 同一 `time=1790071903094` 的 cancel 事件；扫描全 CLEAN |
| A14 | **真实根**上 `listArtifacts` 无整表抛错、无静默丢会话 | **PASS** | 实测 **1440 listed / 150.7 ms**；目录 1440 == 有 artifact 的目录 1440；`silentDrop: false` |
| B1 | **帧内**字节损坏（任意位置）⇒ 整会话不可读，**无 salvage** | **FAIL** | C1–C5：`:963` 全帧遍历，`:1012-1015` 原样 rethrow；**无"截到 N−1 帧"分支** |
| B2 | 头帧损坏 ⇒ **整张会话列表不可用** | **FAIL** | `:1096-1097` rethrow（隔离机制 `:1162-1165` **已存在**却未使用） |
| B3 | 头帧缺失/截断/0 字节 ⇒ 会话**静默消失** | **FAIL** | `:1123`、`:1125` 的静默 `return void 0` |
| B4 | 中间/末帧坏（头帧完好）⇒ 会话在列但**打不开** | **FAIL** | 列表列出 3（`:1121` 只读头帧）vs `readRaw` 抛错（§3.4） |
| C1 | projcache 孤儿率 | **PASS（已量化）** | **53.82%**（1,670/3,103），≈2.57 MB；与 `w03` 58.5% 同向、差异源于时间漂移 |
| C2 | 孤儿**不影响正确性**（纯占盘） | **PASS** | `dsh-session-projection-cache:123-127` `identityMatches` 读侧过滤 |
| C3 | projcache 损坏 ⇒ **可自愈** | **FAIL** | 9/9 失效输入文件**原样保留**；`dsh-storage-json:133-145` 无 rebuild 分支 |
| C4 | `version` 不符 ⇒ "discard the whole medium"（注释承诺） | **FAIL（承诺未实现）** | 注释 `dsh-session-projection-cache:54-56`；实现只有 `storage-json:98` 抛 + `storage-domain:330` 转交；**全仓无 discard 代码** |
| C5 | 单条坏记录 ⇒ 整个 domain 打不开 | **FAIL** | `dsh-storage-domain:352-356,394-407`（`open()` 全有或全无）；projcache 有 **42,261 行**。SA-1 独立实测 V6（3,091 条里仅 1 条 `seq` 改字符串）/V10（缺 identity）⇒ json 层 OK、域层 `invalid-record`，**3,091 条会话缓存一次性永久不可用，无记录级隔离** |
| C5b | 值级**静默**损坏可被检测 | **FAIL（新，SA-1 实测）** | 字符串值内注入非法 UTF-8 `0xFF` ⇒ 换成 **U+FFFD**，两层**皆 OK(12 条)、无日志**（格式无 checksum，`dsh-storage-json:68-80`）⇒ `identityMatches` 失配 ⇒ **静默弃用，表现为缓存莫名 miss** |
| C6 | projcache 缺失**可惰性重建** | **PASS** | `dsh-storage-json:137-139`（ENOENT ⇒ 空 state）；SA-1：**删文件后 8/8 恢复 OK 且记录 0 条 ⇒ 人工删除是唯一恢复手段** |
| C7 | projcache 损坏的**功能爆炸半径** | **PASS（缓解）** | `dsh-host-apiproxy:1489` `ctx.get("sessionProjectionCache")?.` ⇒ 降级不崩；cordis 收敛 init 错误（`cordis:979-981`） |
| C8 | 其余消费点是否也都安全降级 | **PASS（SA-1 查明）** | 两模式：`:1487-1495` 可选链+try/catch（**省略列、不丢行**）；`dsh-subagent:1869,1986-1989,1997` **回退 `persistence.inspect` 全量检视（慢但正确）**。**无任何路径静默返回空而丢会话条目** |
| C9 | 外部**热清理**孤儿可行 | **FAIL** | `dsh-storage-json:119-123` 内存态权威 + 全量 `serialize`；触发点 `writeEveryEvents:200` / `writeIntervalMs:5000` ⇒ **外部删除寿命 ≤5 s**；且外部 rename 与 `writeAtomic:35` 交错可能把半写态推成正式文件 |
| D1 | usage.db 物理完整性 | **PASS** | `integrity_check=ok`、`quick_check=ok`、`foreign_key_check=[]`；`raw/m8-usage-db.json` |
| D2 | `journal_mode=WAL` | **PASS** | `@local/dsh-usage/lib/db.js:74` |
| D3 | **`busy_timeout`** | **PASS（已修）** | **`db.js:81` = 5000**；⚠️ 探针连接读到的 `0` 是**每连接默认值**，非应用值（§5.2） |
| D4 | `synchronous`（掉电丢已提交事务？） | **PASS** | 未设置 ⇒ `node:sqlite` 默认 **2(FULL)**（实测）；WAL+FULL ⇒ 已提交事务**不丢** |
| D5 | WAL 有界、autocheckpoint 生效（**机制已钉死**） | **PASS** | 本档：4,560,872 B = 阈值 4,096,000 的 **111.3%**、35 s 恒定。**SA-2 纯字节解析**：`32 + 1107×4120` **整除** ⇒ 高水位；inode+长度 **80/80 采样恒定**；salt 校验**当前代有效帧仅 119–976**；scratch 复现 autocheckpoint **确在 1217 帧触发**、随后**原地重用不截断**（`journal_size_limit=-1`）；宿主 `ckptSeq 21→35`/8 min ≈ 每 ingest pass 一次 ⇒ **「已提交未落 .db」上界 ≈1000 帧，实测瞬时 119–976 帧（0.5–4.0 MB）**，**4.5 MiB 不是积压** |
| D6 | usage 有版本迁移账本 + 降级守护 | **PASS** | `db.js:95-109`（`user_version`；"绝不静默重盖"；超前则抛） |
| D7 | usage 有**完整性体检** | **FAIL** | `openUsageDb`（`db.js:67-112`）无任何 `integrity_check`；SA-2：中段页覆写**能被 `integrity_check` 查出**，但打开路径从不调用 ⇒ **带病上线** |
| D8 | `usage.db` **0 B 截断**的回落行为 | **FAIL（最严重，SA-2 副本实测）** | 真实 `openUsageDb` **不报错**地重建为空表，`usage_events` **147,685 → 0** ⇒ **全部历史静默消失**（根因：`db.js:70-72` 只判**存在性**、不判**内容**） |
| D8b | 头页/中段损坏的回落行为 | **FAIL（SA-2 实测）** | 头部坏 ⇒ 抛错、文件不改写、`index.js:335-339` → warn `ingest disabled`（**宿主不崩、无自愈、该生命周期内永久失效**）；中段坏 ⇒ **能检出但不检查 ⇒ 带病上线** |
| D8c | `-wal` 丢失的回落行为 | **FAIL（静默，SA-2 实测）** | **静默丢 94 条已提交事件**，且 `integrity_check` **仍报 ok** |
| D8d | 外来 SQLite 库被放到该路径 | **FAIL（SA-2 实测）** | **静默覆写 `application_id`** 并并排建表 ⇒ `db.js:17` 注释所称 guard **实为无条件覆写** |
| D8e | `-shm` 丢失 | **PASS** | SQLite 自行重建（SA-2） |
| D9 | usage.db **丢失 ⇒ 静默建空库、历史永久丢失** | **FAIL** | `db.js:70-72` `openSync(path,"wx")`；且**无备份** |
| D10 | 实际并发写者数量 | **PASS（SA-2 查明）** | **进程 1 个**（`/proc/locks` 只出现 PID 2988915，80/80 采样）；**连接 2 个（同进程）**：宿主 `index.js:300` + ingest worker 线程 `ingest-worker.js:107`。🔴 **假阴性警告**：`/proc/<pid>/fd`、`maps` 因 `ptrace_scope=1` **EACCES** ⇒ `lsof`/`fuser` 空输出**不可读成「无人持有」** |
| D10b | 生产期是否真出现过 `SQLITE_BUSY` | **INCONCLUSIVE** | 宿主 stdout 未落盘（`dsh-restart.log` 对 usage/locked/ingest **0 命中**）⇒ 无法证实亦无法证伪。**注意**：`db.js:73`→`:81` 之间存在无 busy handler 的窗口（**窄 FAIL，低危**） |
| D11 | `page_count×page_size` 与文件差 3 页 | **PASS（已解释，原 INCONCLUSIVE）** | = **WAL 逻辑页数 − 物理文件页数**；SA-2 三方对齐（物理 10,886 / 逻辑 10,891 / WAL 末帧 `dbsize=10,891`）⇒ 差 5 页；新副本 11,966 vs 11,970；**18:52 采样差额 = 0**；`dbstat` 合计 == `page_count×page_size` == 物理字节（同快照） |
| E1 | storages 各 unit 的 name/version 可枚举 | **PASS** | projcache **3**、workspace **2**、message_feedback **0**、usage `user_version=1`（§6.1） |
| E2 | storage-json 的版本守护存在 | **PASS** | `dsh-storage-json:96-98`；`dsh-storage-domain:330,341-373` |
| E3 | **有任何自动备份** | **FAIL** | `~/.dsh/backups/` 22 项**全为** settings/taste/插件手工 `.bak`；storages 4 产物**零备份**（本档 `find` + SA-2 独立 `find` 双向佐证；`usage-p0b-prev.tar.gz` 33 KB 是**源码**、**不是** 49 MB 的库） |
| E4 | 崩溃孤儿的 `.tmp` 有启动清理 | **FAIL** | `dsh-storage-json:26,35,38`（仅当次错误 `rm`）；`openJsonUnit` 只读 `<name>.json`；**无害但永不回收** |
| E5 | 跨库（projcache ↔ usage）一致性有保障 | **FAIL** | 无任何对账/校验代码 |
| E6 | 陈旧产物被清理 | **FAIL** | 3 × `session.v3.jsonl.zstd`（30,209 + 552,482 + 519,112 = **1,101,803 B**）+ 3 × 0 字节 `session.lock`（mtime 09-12），对扫描器**完全不可见** |
| E7 | `workspace.json` 丢失可重建 | **PASS** | SA-2：可从 `sessionPersistence.list()` 重建（`dsh-workspace/lib/index.js:320-323`，`initial.initialized=false`）；代价丢标题/排序/归档。**损坏则无重建** |

**统计（51 条断言）**：PASS **31** / FAIL **19** / INCONCLUSIVE **1**。
（FAIL 中 **0 条是"当前已发生的事故"**——全库与三库现状均健康；FAIL 表示"**宕机/位腐/静默损坏时不可恢复、不可检测或不可见**"的能力缺口。）

---

## 9. 诚实清单与边界

### 9.1 我没做到的（§8 现只剩 **1 条** INCONCLUSIVE：D10b「生产期是否真出现过 `SQLITE_BUSY`」；此处补充过程性限制）

1. **帧内损坏的"概率"没测**。我证明了"坏一个 bit 就整会话作废"，但**没测本机磁盘/文件系统实际发生位腐的概率**。
   本机是普通 ext4（未验证），且主机在跑 ⇒ 无法做长期可靠性统计。
2. **projcache 的"紧凑化收益"是估算**（§7 候选 4 第 3 件）。我实测了 pretty 序列化的成本（37.79 ms），
   **没有**实现紧凑版并同窗对照 ⇒ 那条 18–25% 的数字**是外推，不是实测**。
3. ~~**usage.db 的损坏行为没有实测**~~ → **已由二级档 SA-2 用真实 `openUsageDb` 在副本上补齐 8 个场景**
   （§5.3 / §8 的 D8 系列）。本档初版在此处标的 INCONCLUSIVE **已被更强的实测取代**
   —— 其中"0 B 截断 ⇒ 静默清空 149,506 条"是全库最严重的一条发现，
   **本档自己的只读探针（`m8`，不写库）结构上测不出它**。这正是"分档互补"的价值。
   ⚠️ 但 SA-2 与我都**没有**做字面的 `SIGKILL`/拔电实验（派单禁止）：D4 的"已提交事务不丢"
   是**由 `synchronous=FULL` + WAL 语义 + scratch 复现三条支撑的推论**，不是实测掉电。
4. **并发写者枚举（D10）未做** —— 我知道 `/proc/<pid>/fd` 是手段，选了不做以降低对运行中宿主的干扰。
5. **"45 s ingest timer 的单拍 >1000 ms"我没有裁决**（§4.2）。我给出的是一条**反证方向的量化**：
   projcache 单次同步前缀 ≈82 ms，**不足以**单独造成 1 s 单拍。真正的裁决需要安静窗 + 叠加测量，不属本线。
6. **`workspace.json` 的消费点是否带可选链未验证**（§6.3 的 INCONCLUSIVE）。我只验证了
   `sessionProjectionCache` 这一处（`dsh-host-apiproxy:1489`）；SA-1 补齐了它的其余消费点，
   但 **`workspace.json`（unit version 2）我没查**。
8. **SA-1 的写时长数字带 I/O 争用**：其测量窗口内有 5 条兄弟线并发 ⇒ 它自述那些"写在途时长/发布频率"
   **只能作上界**，不能作干净基线。本审计 §4.2 的 81.8 ms / 0.363 次/s 是**我自己的同窗实测**，
   但同样**不是安静窗基线**（当时有 `w14` 等线在跑）⇒ **两处频率类数字都应视为上界**。
7. **我没有验证宿主当前是否加载了新的 md5**。15:54 模块被替换、18:11:49 宿主重启 ⇒
   按时间顺序**新宿主应加载 18:11 时的版本**，且我扫描用的正是 `3423e8b7…`（15:54 之后）。
   但**"运行中进程实际加载的是哪个 md5"我没有直接测**（`w05` 有这类校验范式，本线未复用）。

### 9.2 边界（不得外推）

- 本文的 **FAIL 判定是对"能力缺口"的判定，不是"当前有损坏"的判定**。全库 1419/1419 CLEAN、
  usage.db `integrity_check=ok`、projcache 可解析 —— **现状健康**。
- 合成损坏矩阵的样本是**单个** 22.8 MB / 69,229 帧的冷 artifact。**极小文件（<1 KB）与只有 2 帧的
  新会话**未逐变体覆盖；不过 `m1` 的全库扫描覆盖了 1419 个真实文件（含大量小文件）。
- 全库数字**全部带时间戳**：artifact 数 **~2/分钟**增长（15:16 1280 → 18:32 1419 → 18:51 1451）。
  §3.2 的 1419 是 18:32 的快照，**不可与更晚的读数直接比较**。
- 我是**只读**的：所有"热清理不可行""必须冷做"的结论，**没有**用任何实际写入去验证（这本身就是结论的一部分）。

---

## 10. 原始数据与脚本索引

### 10.1 脚本（`scripts/`，全部可复跑）

| 脚本 | 作用 |
|---|---|
| `probe-import.mjs` | 证明真实 deployed 类可用合成 receiver 调用 |
| `with-lock.mjs` / `wait-lock.mjs` | 共享探针锁封装（**拿到才跑；绝不强占**；有界重试） |
| `m1-frame-scan.mjs` | 全库帧级完整性扫描（双解码器 + 结构扫描 + 撕裂/头帧判定） |
| `m2-recovery-matrix.mjs` | 截断/损坏 14 变体矩阵（真实读路径，副本上做） |
| `m3-blast-radius.mjs` | 爆炸半径初版（因合成 root 的 `cwd` 不匹配而作废，保留作失败记录） |
| `m4-loss-and-blast.mjs` | **损失自洽对账 + 爆炸半径（修正版，判定有效）** |
| `m5-live-list.mjs` | 真实根上跑真实 `listArtifacts` + 目录闭包性 |
| `m6-projcache-storages.mjs` | 真实 `JsonStorageBackend` 损坏矩阵 + 孤儿统计 + 重写节奏 + storages 清单 |
| `m7-open-turns.mjs` | 全库流式折叠，统计未闭合 turn/step/待定工具调用 |
| `m8-usage-db.mjs` | usage.db 只读完整性/WAL 探针（**不做 checkpoint、不改 pragma**） |

### 10.2 原始数据（`raw/`）

| 文件 | 内容 |
|---|---|
| `artifact-inventory.tsv` | 15:16 全量清单（path/size/mtime），1280 行 |
| `m1-frame-scan-summary.json` / `m1-frame-scan-detail.json` | 全库扫描汇总 + 逐文件明细（含 source md5、提取行号） |
| `m2-recovery-matrix.json` | 14 变体 × 3 读路径的完整行为 |
| `m4-loss-and-blast.json` | **损失自洽三方对账** + 8 场景爆炸半径 |
| `m5-live-list.json` | 真实根 `listArtifacts` 结果 + 目录闭包 + 陈旧 v3/lock 清单 |
| `m6-projcache-storages.json` | 11 种损坏输入（真实 backend）+ 行级 schema + 孤儿统计 + 22 s 重写节奏 |
| `m7-open-turns.json` | 1445 artifact / 1,713,224 事件的未闭合折叠结果 |
| `m8-usage-db.json` | usage.db pragma/integrity/dbstat/空间分布 |

### 10.3 二级档产物

| 路径 | 状态 |
|---|---|
| `sa2-usage-storages/raw/` | SA-2 首档（中断）**留下的真实产物**：`probe-sqlite.mjs`、`probe-original-ro.json`、`probe-copy-ro.json`、原库三件套副本。**已在本审计中被复核并就地更正一处**（§5.2 的 `busy_timeout` 陷阱） |
| `sa1-projcache/` | SA-1 首档（中断）**未留下产物**；**重派档已完成**：`audit-sa1.md`（493 行 / 31 条断言 = PASS 17 / FAIL 11 / INCONCLUSIVE 3）+ `raw/q1-corruption-harness.mjs`、`q1-corruption-results.json`（11 变体）、`q2-orphan-recount.mjs`、`projcache-snapshot-A.json`、`key-crosstab.json`、`q4-tmp-lifecycle.mjs` 等。**其 3 条新发现（N1 毒丸记录 / N2 静默损坏 / N3 文档-实现矛盾）已并入本审计 §4.3、§4.4、§8（C5/C5b/C9）与 §7 候选 4** |
| `sa2-usage-storages/raw/` | SA-2 首档（中断）**留下的真实产物**：`probe-sqlite.mjs`、`probe-original-ro.json`、`probe-copy-ro.json`、原库三件套副本。**已在本审计中被复核并就地更正一处**（§5.2 的 `busy_timeout` 陷阱：探针连接的每连接默认值 ≠ 应用值 `db.js:81`=5000） |
| `sa2-usage-storages/` | **重派档已完成**：`audit-sa2.md`（438 行）+ 45 项产物（`probe-wal.mjs`/`probe-shm.mjs`/`final-live-snapshot.json`/`q3-results.json`/`wal-timeline2.json`/`shm-probe/mimic.mjs`/sha256 校验过的 `harness/db.js`）。**其 3 条"推翻派单前提"的结论（`busy_timeout` 假象 / WAL 非积压 / 页差已定性）+ 6 条 Q3 损坏场景 + 并发写者查明**已并入 §5.2/§5.3/§5.5/§8（D3/D5/D8 系列/D10/D11）与 §6 |

---

## 11. 给协调者的一句话行动建议

**按这个顺序做三件，都是一次重启内的冷面改动：**

1. **候选 1 —— `~/.dsh/storages` 冷备份 + 可验证恢复**（纯运维面、零产品风险、约 62 MB/份）。
   它是本线**唯一把"永久丢失"变成"可回滚"**的改动；**注意 `usage.db` 必须连 `-wal` 一起备份，或 `VACUUM INTO`**。
2. **候选 2 —— `usage.db` 打开路径的损坏守卫**（`db.js` 4 处局部改，`rename` 保底 + 显式告警）。
   它挡住的是本线**最严重的一条具体机制**：**0 字节 `usage.db` ⇒ 149,506 条历史无报错归零**；
   同时顺手修掉外来库被静默覆写 `application_id`、以及"中段坏带病上线"。
3. **候选 3 —— `listArtifacts` 损坏隔离**。把"1 个坏文件搞垮整张会话列表"降级为单会话隔离 —
   **而隔离机制在产品里已经写好了**（`probeArtifactsBounded` 的 per-dir `{error}` 捕获，
   `:1162-1165`），只差"不去 rethrow"这一个决定（`:1096-1097`）；顺带让头帧缺失从**静默消失**变成**显式计数**。

**候选 4（projcache 自愈 + 孤儿回收）可与上面同批做**：它一次修好 3 类"坏一次就永久坏"的入口，
且有 2.57 MB 的确定性一次性收益（孤儿是**冻结死集合**，清完不会长回来）。
**但孤儿清理必须走产品侧或停机冷做** —— 实测外部热清理寿命 ≤5 s（§7.4）。

**一条纪律**：本线所有 FAIL 都是**能力缺口**而非**已发生的事故**。全库 1419/1419 CLEAN、
`usage.db` `integrity_check=ok`、projcache 可解析 —— **现在动手的收益是"把下一次事故变成可恢复"**，
不要把它们当成"当前正在丢数据"去紧急处置。
