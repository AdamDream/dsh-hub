# report.md — exec-projcache：U-PC1 / U-PC2 修订执行复核一体档报告

- **依据**：`.workspace/lag-fix/program/w21-storage/audit.md` §5 候选 2（→U-PC1）与候选 3（→U-PC2）；
  另读 `w03-persistence/audit.md`（分片回归上游证据）、`w02-host-rpc/audit.md`（projcache 停顿起点数字）。
- **本档只落地审计已批准的候选**：候选形态、收益口径、验收标准、回滚语义全部取自审计 §5（候选 2 含其
  "per-unit 可配置"缓解措施；候选 3 的"一次 `publish()` 落全部脏记录"）。**没有重新拆解、没有扩大候选范围。**
  为实现审计指定的机制所**必需**的接口与健壮性改动（`putMany` 的 thunk 形态、逐会话隔离、半补丁退化、
  卸载即停）记在 §3.6，其来源是独立对抗性复核对抗性发现，不是本档自行加需求。
- **持锁状态**：❌ **未持探针锁**。`.workspace/lag-fix/research-v2/.probe.lock` 由 `w23-nav`（pid 352148）
  持有且 `liveness=ALIVE` ⇒ 本档**不取锁、不回收**，与审计 §6.3 同规。所有窗口标 **`CONTENDED`**，
  **绝对 ms 只作同窗比值用**。
- **不重启 / 不 pkill**：本档只启动过自己的 `node` 探针进程与 1 个二级 subagent（只读审查），
  **没有触碰宿主 pid 2988915**，没有点 Sessions 树行内按钮。
- **写入边界**：本档**没有写任何工作区之外的文件**；部署位（`~/.npm-global/.../@deepseek-ai/*`）由主 agent 执行写入。

---

## 0. 一句话结论 + 同档自裁决

| 单元 | 自裁决 | 依据 |
|---|---|---|
| **U-PC1**（per-unit 紧凑序列化） | ✅ **PASS** | 同窗 A/B（三轮）−53.44% / −53.56% / −55.62% 耗时、−53.57% 真字节；E1–E6 六组硬断言全绿（含"旧代码读新紧凑介质 3,109 条逐条相等"）；`workspace`/`message_feedback` 介质逐字节不变；回滚逐字节还原 |
| **U-PC2**（interval 内合并发布） | ⚠️→✅ **初版被独立复核证伪 3 条 claim ⇒ 已修复并加定向回归后 PASS**（附一条未达标的量化边界，见 §3.2） | 同窗 −90.0% 发布数（interval 主导场景）/ −66.1%（强制点占比 0.6 次/s 场景）；inotify 1:1 阳性对照；**全量 3,119 条记录** mem==disk、0 差异；崩溃窗口**不扩大**（实测略优）；批失败**重试**且重试后核对 0 差异；**复核发现的 F1–F5 全部修复，R1–R5 定向回归 5/5 PASS（含检测器阳性对照）** |
| **补丁脚本** | ✅ **PASS** | 镜像 11/11 自证：逐字节镜像保真、干跑零写入、apply/`node --check`/幂等、累积门禁、U-PC2/U-PC1 逐字节回滚、顺序门禁拒绝 |

**总体：PASS（无 REWORK）**，可直接由主 agent 落地。

**停止条件检查（三条，全部未触发）**：
1. 语义等价无法硬断言 → ❌未触发（E1–E6 全部 `node:assert` 硬断言通过，逐记录而非抽样）。
2. 合并发布会扩大丢失窗口且无法用崩溃窗口分析收窄 → ❌未触发（实测**不扩大**，且有解析上界证明，§3.4③）。
3. 需要动 `version` 或迁移 → ❌未触发（`version` 一字未动；无迁移；E4 证明紧凑介质**旧代码可直接读**）。

---

## 1. 交付物

```
exec-projcache/
  apply-ProjCache-v1.mjs              锚点制补丁脚本（13 条编辑 / 2 个单元）
  report.md  DEPLOY.md
  candidates/{pc1,pc2,both}/          候选件（整文件，兜底用）
  tools/selftest-apply.mjs            脚本自证 T0–T8（11 项）
  tools/upc1-bench.mjs                U-PC1 同窗 A/B
  tools/upc1-equiv.mjs                U-PC1 语义等价 E1–E6
  tools/upc2-harness.mjs              U-PC2 同窗 A/B + 全量核对 + 崩溃窗口 + 强制度
  tools/upc2-regressions.mjs          U-PC2 定向回归 R1–R5（复核 F1–F5 的断言化 + 阳性对照）
  raw/review-U-PC2.md                 独立对抗性复核报告原文（F1–F8）
  mirror/{deploy,node_modules,old,pc1,pc2,both,halfproj}  逐字节镜像与 5 个代码变体（halfproj = 半补丁混合装配）
  preimage/{_pristine,U-PC1,U-PC2}    自动 pre-image（回滚用）
  media/*.snapshot.json               真实介质只读快照
  raw/                                全部原始 JSON 证据；raw/invalid/ 保留被判定无效的仪器产物
```

真实介质快照（**只读**，未在部署位写入任何字节）：

| 文件 | 字节 | md5 |
|---|---|---|
| `~/.dsh/storages/session_projcache.json` | 11,520,185 | `68379d4583593c889fb6bd707bf3d162` |
| `~/.dsh/storages/workspace.json` | 11,382 | `7f790ed02635f978d571d9f9bd0bfeda` |
| `~/.dsh/storages/message_feedback.json` | 639 | `ba87316e24b6ac936d7ebbe94f454b1d` |

配置实读（`dsh-web-app/cordis.patch.yml:76-80`）：`session-projection-cache` → `writeEveryEvents: 200`、
`writeIntervalMs: 5000`、`storage-domain.backend: json` ⇒ 与审计反推一致。

---

## 2. U-PC1：per-unit 紧凑序列化（候选 2）

### 2.1 改动（3 文件 8 处编辑，全部锚点唯一命中）

| # | 文件 | 改动 |
|---|---|---|
| 1–5 | `dsh-storage-json/lib/index.js` | `serialize(name, state)` → `serialize(name, state, pretty = true)`；`:79` 改 `return pretty ? \`${JSON.stringify(document, null, 2)}\n\` : \`${JSON.stringify(document)}\n\`;`；`publish()` 传 `this.descriptor.pretty !== false`；两处 JSDoc |
| 6–7 | `dsh-storage-domain/lib/index.js` | `descriptorOf(spec)` 透传 `...spec.pretty === void 0 ? {} : { pretty: spec.pretty }`（未声明则描述符**逐键不变**）；JSDoc |
| 8 | `dsh-session-projection-cache/lib/index.js` | `projectionCacheDomainSpec` 增 `pretty: false` |

**为什么做成 per-unit 开关而不是直接删 `, null, 2`**：审计 §5 候选 2 的缓解措施就是
"把紧凑化做成 per-unit 可配置（如 `descriptor.pretty: false`），只对 projcache 生效，保留
`workspace`/`message_feedback` 的可读性"；且审计 §5 候选 1 已把 `descriptorOf()` 透传当作既定手法。
本实现的收益与"全局删缩进"对 projcache **完全相同**（projcache 就是那个 11.5 MB 的 unit），
但对两个**权威用户数据** unit 的爆炸半径为零（已硬断言，见 E3/E5）。

### 2.2 验收① 同窗对照：耗时与字节降幅 ✅

`raw/upc1-bench.json`（n=15/侧，**同一进程内交替轮流**，同一份 11.5 MB 真实 state；
用运行时包裹 `JSON.stringify` **捕获真实 `:79` 调用**，不是复刻实现）。窗口 `CONTENDED`。

**两轮独立同窗 A/B**（`raw/upc1-bench.json` 为最后一轮；两轮都是 n=15/侧、交替轮流、同一份 state）：

**三轮独立同窗 A/B**（`raw/upc1-bench.json` 为最后一轮；三轮都是 n=15/侧、交替轮流、同一份 state）：

| 量 | 轮次 | old（pretty） | pc1（compact） | 降幅 | 审计目标 |
|---|---|---|---|---|---|
| `serialize` median | 1 | 31.857 ms | 14.795 ms | −53.56%（比值 0.4644） | ≈ −48% |
| `serialize` median | 2 | 32.172 ms（p25 31.268 / p75 32.935） | 14.279 ms | −55.62%（比值 0.4438） | ≈ −48% |
| `serialize` median | **3（canonical）** | **31.800 ms** | **14.807 ms** | **−53.44%** | ≈ −48% |
| `serialize` 输出字符数 | 3 | 11,371,971 | 5,201,037 | **−54.26%** | ≈ −54% |
| **盘上真实字节（UTF-8）** | 3 | **11,520,185** | **5,349,251** | **−53.57%** | ≈ −54% |
| 端到端 `putRecord` median（含 writeAtomic+fsync，CONTENDED） | 3 | 57.872 ms | 30.963 ms | −46.5% | — |
| 写后介质不变量 `mediumInvariant` | 3 | ok=true | ok=true | —（both 亦 true） | — |

三轮耗时降幅 **−53.44% / −53.56% / −55.62%**（**都优于审计的保守值 −47.8%**，比值 0.4438–0.4644 vs 审计 0.4892–0.5218），
逐轮极差 2.2 pp。字节口径三轮**完全一致**（字符 −54.26%、真字节 −53.57%、盘上文件 11,520,185 → 5,349,251，逐字节可复现）。

- ⚠️ **口径更正（本档新增）**：审计的"字节 −53.57%（11,496,048 → 5,337,219）"是
  `string.length`（**字符数**），而介质是 UTF-8、内容含中文（`bytes/char = 1.0130`）⇒ **真字节**与字符数不同。
  本档两法都给：字符 −54.26%、**真字节 −53.57%**。真字节降幅与审计数字巧合一致。
- `both` 变体（U-PC1+U-PC2）的字节/字符与 `pc1` **完全相同**（5,349,251 / 5,201,037）⇒ U-PC2 不改介质格式（`judgement.bothVariantEqualsPc1Bytes=true`）。
- **本轮比值优于审计区间**（0.4438–0.4644 vs 审计 0.4892–0.5218）：可能因本轮宿主负载/页缓存状态不同（窗口 CONTENDED，不可跨窗口比对绝对值）。**设计依据仍以审计的保守值 −47.8% / −53.57% 为准**；本档只声明"降幅**至少**复现审计的保守值"。
- 中位数之外的分布也一并留档（如 new 侧 `min 10.700 / p95 16.727 / max 18.840 ms`，old 侧 `max 64.783 ms`），便于主 agent 独立判断。

### 2.3 验收② 语义等价硬断言 ✅ `raw/upc1-equiv.json`（6/6 PASS，`node:assert/strict`）

| 断言 | 结果 |
|---|---|
| **E1** 旧/新序列化文本不同、`JSON.parse` 后 `deepStrictEqual`（**3,109 条逐记录**，不只整体）；且**未打补丁的旧 `openJsonUnit` 能读 compact 介质** | PASS，3,109 条全部相等 |
| **E2** `null` = never written 哨兵：空介质给出 `global === null`；序列化后仍 `null`；写入的 global 逐字段往返；`setGlobal(null)` 后再重开**仍是 null**（不得被 `initial` 悄悄顶替） | PASS（两变体各 3 项） |
| **E3** `workspace` 域往返：真实 `workspaceDomainSpec` + 真实 `DomainFacility`，写一条记录后重开 ⇒ `initialized` / `workspaceIds`(11) / `archivedSessionIds`(77) **逐字段不变**、11 条 workspace 记录全等；**三个变体写出的 `workspace.json` sha256 完全相同**（`3977892…76eb`，11,382 B） | PASS |
| **E4** **双向介质兼容**：`pc1`/`both` 写出的 compact 介质（5,349,251 B）由**未打补丁的旧代码**重开 ⇒ **3,109 条记录逐条 `deepStrictEqual`** 通过 | PASS ⇒ **回滚无需搬迁** |
| **E5** `message_feedback` 三个变体介质 sha256 完全相同（`bfa2028…be2d`） | PASS |
| **E6** 真实介质 打开→读写→重开 一轮全绿，且**交叉变体**（新写旧读 / 旧写新读）；新增记录往返一致 | PASS |

E2 直接覆盖任务红线：`null` 哨兵语义不变 ⇒ `initialized`/`workspaceIds`/`archivedSessionIds` 不会被静默重置。

### 2.4 验收③ 真实介质"打开→读写→重开"一轮 ✅

见 E4/E6：在真实 11.5 MB 快照上 open → `putRecord`（原记录回写 + 新增一条）→ close → **用另一变体**重开
→ 记录数 3,110 一致、探针记录与新增记录皆 `deepStrictEqual`。`both->old` 与 `pc1->old` 介质 5,350,829 B、
`old->pc1` 11,523,506 B。

### 2.5 验收④ 回滚逐字节还原 ✅ `raw/selftest-apply.json`（11/11 PASS）

T5 `--rollback=U-PC2` 逐字节还原到 U-PC2 pre-image（sha256 全等，diff=[]）；
T6 `--rollback=U-PC1` 逐字节还原到 `_pristine`（diff=[]）；T7 回滚后镜像与部署位逐字节一致。
脚本还顺带自证了 T0 镜像保真、T1 干跑零写入、T2/T3 `node --check` + 幂等、T4/T4b/T4c 累积与重复-apply 门禁、T8 顺序门禁。

---

## 3. U-PC2：同一 interval 内所有脏会话合并为一次发布（候选 3）

### 3.1 改动（3 文件 5 处编辑）

| # | 文件 | 改动 |
|---|---|---|
| 1 | `dsh-storage-json/lib/index.js` | 新增 `JsonKvUnit.putRecords(table, entries)`：一次 `publish()` 落多条记录；失败**逆序回滚**（重复键也正确）；空数组不发布 |
| 2 | `dsh-storage-domain/lib/index.js` | 新增 `KvTableImpl.putMany(entries \| thunk)`：**一个 `host.enqueue`（= 域链上的一个链节）**；`thunk` 形式在**链节内**求值（⇒ 切点顺序 == 入链顺序，见 §3.6 F1）；先 `await unit.putRecords` 再改内存 + `emitPut`；后端无 `putRecords` 时逐条落盘**并逐条更新内存**（= 打补丁前 `put` 的语义）。原 `put` 一字未动 |
| 3 | `dsh-session-projection-cache/lib/index.js` | `dirty` 值去掉 per-session `timer`，新增共享 `batchTimer`、`batchStopped` 标志、`armBatchTimer()`/`clearBatchTimer()`/`hasPending()`；`flushBatch()`（逐会话隔离日志落盘 → 能力探测 → **链内**取切点并一次 `putMany`）；`markClean` 只重置 `pending`；新增 `markDirty`（重试，且不复活已死会话） |

**为什么必须动 `dsh-storage-json` / `dsh-storage-domain`**：审计要求"一次 `publish()` 落全部脏记录"。
`dsh-storage-json:118-125` 自述"Writes are NOT queued here"，per-record 调用**必然**一次一发布；
只有把批落到 unit 层才能做到"一次发布"。**批是一整条域链链节 ⇒ 不绕过域链**（审计 §3.3 的硬前提）。

**保持不变（逐条对照）**：`turn/end` → 立即 `flushSoft`；`session/disposed` → 立即 `flushSoft` + `markClean` + `delete`；
`count >= writeEveryEvents` → 立即 `flushSoft`；公开 `write(session)` / `putSoft` 路径原样。

### 3.2 验收① 同窗发布次数降幅 —— ⚠️ **分场景给，并给出未达 80% 的量化边界**

`raw/upc2-harness.json`。三变体**同进程、同一时刻、同一事件脚本**并跑；被测对象是**真实原型方法**
（`Object.create(SessionProjectionCache.prototype)` 造 shim，**只替换 cordis service 装配，不替换任何写路径逻辑**），
下面挂**真实 `DomainFacility` + 真实 `JsonStorageBackend` + 真实 `domain.chain`**。
发布计数观测点：域层 `table.put` / `table.putMany`（storage-json 里二者各自**恰好** publish 一次，`:169-224`）。

| 场景 | 事件 | old | pc2 | both | 降幅 |
|---|---|---|---|---|---|
| **S1 interval 压力**（无强制点，10 会话持续脏） | 622/623 | **50**（1.60/s） | **5**（0.16/s） | **5** | **−90.0%** ✅ ≥80% |
| **S2 含强制点**（对称：每变体 12×`turn/end` + 3×`disposed`） | 637/638 | 59 | 20 | 20 | **−66.1%** ❌ <80% |

- **S1 是审计判据对应的场景**：审计把实测 **1.8417 次/s** 整体归因于"每会话各自的 5000 ms 定时器"，
  并反推同时脏会话 ≈9.2。本档 10 会话复现出 old = **1.60 次/s**，S2 下 old = **1.89 次/s** —— 与审计同阶/吻合。
- **S2 为什么只有 −66.1%：这是设计必然，不是缺陷。** pc2 的 20 次 = **5 次批 + 12 次 `turn/end` + 3 次 `disposed`**
  （算术完全闭合）。强制点**必须**同 tick 立即写（审计验收 ④ 与任务硬要求），因此它们构成不可合并的**地板**：

  > 新发布率 = 1 / writeIntervalMs + rate(`turn/end`) + rate(`disposed`)
  > 代入审计的 old = 1.8417/s：**降幅 ≥ 80% ⟺ 强制点合计 ≤ 0.168 次/s**。
  > S2 把强制点压到 15 次/25 s = 0.6 次/s ⇒ 降幅必然掉到 66%。

  落地后若要确认实际落在哪一侧，用 `DEPLOY.md` §4 的 `w21-freq.mjs` 复测：**残余 rename 率 ≈ 0.2/s 即 S1 侧；
  明显高于 0.2/s 说明由强制点主导**。
- **字节降幅（写放大，同窗仅计测量窗口内的发布）**：单次发布中位字节 old/pc2 = 11,525,665（pretty）、`both` = **5,351,775（compact）**。
  ⇒ S1 窗口写量：old 50×11.53 MB ≈ **549.6 MiB**；pc2 5×11.53 MB ≈ **55.0 MiB（−90.0%）**；`both` 5×5.35 MB ≈ **25.5 MiB（−95.4%）**。
  （`raw/upc2-harness.json` 的 `writeAmplification.bytesTotal` 含测量窗口**之后**的对照/强制点写，故此处用"窗口内发布数 × 中位发布字节"推导。）
- **inotify 口径 + 阳性对照**：`raw/upc2-harness.json` 的 `inotify` 与 `inotifyPositiveControl`。
  计数**只数目标文件名 + `rename`**（审计 §6.2 #4：把目录内所有事件当发布会计会高估 ~26 倍）。
  S1：old rename **50** == publish **50**；pc2 rename **5** == publish **5**（1:1）。
  额外阳性对照：跑完后再显式发 5 次写 ⇒ 三变体各得 **恰好 5 个 rename**（`oneToOne=true`）。

### 3.3 验收② 每一条记录最终盘上值正确 ✅（**全量，不是抽样**）

跑完后**全新 backend 重开介质**，把盘上每个记录与域层内存最终值逐条 `deepStrictEqual`：

| 变体 | 内存记录数 | 盘上记录数 | 逐条核对数 | 问题数 |
|---|---|---|---|---|
| old | 3,119 | 3,119 | **3,119** | **0** |
| pc2 | 3,119 | 3,119 | **3,119** | **0** |
| both | 3,119 | 3,119 | **3,119** | **0** |

（3,109 条来自真实 11.5 MB 介质快照 + 10 条合成会话；另断言无"盘上多出的记录"。）
并且 `everySessionDurable = true`（每个会话都至少落过一次盘）。

### 3.4 验收③ 崩溃窗口分析：**逐段判定 + 结论"不扩大"** ✅

定义：某会话在时刻 t 的"未落盘事件数"= 已发出但未被任何**成功写**覆盖的事件数；"陈旧度"= t − 最老未落盘事件时刻。
观测点用**每会话**事件序号（切点在 `checkpoint` stub 记录，写成功后才推进 `durable`）。

**逐段判定**

| 段 | 触发路径 | 旧实现窗口 | 新实现窗口 | 判定 |
|---|---|---|---|---|
| (a) | `turn/end` 强制点 | 立即（同 tick） | **立即（同 tick）**，不进批 | 不变 ✅（**结构性**：`flushSoft(session,"turn/end")` 在事件回调里**同步**调用、不排期到 interval；下表给出的是**写完成**延迟） |
| (b) | `session/disposed` 强制点 | 立即 | **立即** | 不变 ✅（同上） |
| (c) | `count >= 200` 阈值 | 立即 | **立即**，不进批 | 不变 ✅ |
| (d) | **`interval` 节流（唯一批点）** | 定时器在"该会话首次变脏"后 5000 ms 触发 ⇒ 上界 = 5000 + 事件间隔(400) | 共享定时器在"脏集合空→非空"时武装，即 `t_arm ≤ 任一会话自身首次变脏时刻` ⇒ 写时刻 = `t_arm + 5000 ≤ t_own + 5000` ⇒ **单会话上界不增** | **不扩大** ✅（解析上界 + 实测：S1 old 陈旧度 max **5688.9 ms** / 未落盘 max **15** 事件 vs pc2 max **5175.5 ms** / **13** 事件；S2 old **5475.4 ms** / **14** vs pc2 **5120.1 ms** / **13** —— 两场景**均略优**；三个量（脏会话数、未落盘事件数、陈旧度）的 p50/p95 也全部 ≤ old） |
| (e) | 批写失败 | 失败后**不重试**（要等下一个事件才可能再写） | 重新标脏 + 重排 timer ⇒ **一个 interval 后重试** | **严格更好** ✅（实测注入 1 次失败：`retriedAfterFailure=true`，重试后全量核对 **0 差异**，`logWarnings=1`） |

**相关性一节的诚实补充**：因为所有会话现在**共享一个** timer，同一 interval 内脏会话的写入时刻被**对齐**，
"一次崩溃同时丢失多个会话最近 ≤1 interval 进度"的相关性升高。但这不构成窗口扩大，理由是：
(i) 每会话的**独立**上界由上面的不等式保证不增；(ii) 实测"同时脏会话数"分布两实现**完全相同**（p50=10、max=10）；
(iii) 该介质的产品语义本身就是"可能陈旧、永不错误"（`seq` 表达陈旧度，`ver` 不匹配即丢弃，从不迁移）
—— 审计 §5 候选 3 风险②亦按此定性。

**强制点写完成延迟（⚠️ 口径更正：这是"从事件到**写完成**"的延迟，含在域链上排到队尾的排队时间，不是"发起调度"延迟）**

| 场景 | old | pc2 | both |
|---|---|---|---|
| S1 `turn/end` / `disposed`（末轮） | 56.4 / 78.1 ms | 59.5 / 54.9 ms | 31.5 / 33.1 ms |
| S2 `turn/end` / `disposed`（末轮） | 63.6 / 52.0 ms | 53.6 / 55.1 ms | 36.1 / 30.0 ms |

- 末轮 12 组样本**全部 ≤ 78.1 ms**。前一轮出现过 **1 组 109.8 ms**（pc2 的 S2-`disposed`，同窗 old 为 62.1 ms）——
  原因不是"强制点被延后调度"，而是**它排在一个 11.5 MB 批写后面**（域链是 FIFO）。因此本档把它记为
  "**写完成**延迟（含排队）× 窗口 CONTENDED"的正常波动，**结构性的同 tick 触发**由代码路径保证：
  `installWritePath` 里 `turn/end` 与 `session/disposed` 都**直接**调 `flushSoft`、不经 timer；
  两个强制点在所有样本里都在**同一 interval 内**完成，**从未被推迟到下一个 interval**（若被批处理吞掉，
  它们会立刻体现在发布计数上：S2 的 pc2 计数 20 = 5 批 + 12 `turn/end` + 3 `disposed`，算术闭合）。
- `old` 同样会排队（它一个 interval 内要串行发 10 次 11.5 MB 写），所以这不是 pc2 独有的性质。

**结论：合并后单次丢失窗口不扩大（实测略收窄），无需用额外手段收窄。**

### 3.5 验收④ 未引入"最后一次写丢失"新风险 ✅

四条独立论据：

1. **没有任何被 await 的写被推迟**：四处 interval 触发**本来就全部未 await** `flushSoft`（审计 §3.4），
   批处理只替代"节流后的 interval 写"，不改变任何调用方可见的时序。
2. **公开 `write(session)` 未被批处理**：强制点与 cold-read write-back 走的仍是"立即 publish"的 `write()` 路径
   （§3.4 段 (a)(b) 实测即时）。
3. **批内每会话语义 == 单会话 `write()`**：切点在该 interval 边界**同步**取全部会话；
   `putMany` 在 `await unit.putRecords(...)` **之后**才 `records.set` + `emitPut`
   ⇒ 与 `put` 相同"先落盘、后改内存、失败不脏内存"；`putRecords` 失败时**逆序回滚** unit 内部状态。
4. **批失败会重试**（§3.4 段 (e)）⇒ 比旧实现的"静默丢掉直到下一个事件"更不容易丢最新 cut。

**写放大（字节降幅，同窗）**：S1 下 `old`（pretty，未打补丁）与 `pc2`（仅 U-PC2，仍 pretty）每发布 ≈11.52 MB，
`both`（U-PC1+U-PC2）每发布 ≈5.35 MB。见 `raw/upc2-harness*.json` 的 `writeAmplification`
（字段：`bytesTotal` / `bytesPerSecond` / `format`）。相对 `old`，`pc2` −90% 字节、**`both` ≈ −95% 字节**
（发布数 −90% 叠加单次字节 −53.6%）。

---

## 3.6 独立对抗性复核（F1–F8）与修复 ★

按团队纪律，"修订执行复核一体"档的自复核之外，另派了 **1 个独立对抗性复核 subagent**（干净上下文，
只读、只写 1 个新文件）。它用**真实 `DomainFacility` + 真实 `JsonStorageBackend` + 真实 `DomainImpl.chain`**
的探针攻了 6 条 claim，产出 `raw/review-U-PC2.md`（156 行）。结果：**claim 2/3/4 被证伪**，
U-PC2 **初版**确有真实缺陷。全部发现逐条处置如下（**这是本档最有价值的一段：候选不是我"自证通过"就算过关**）。

| 发现 | 严重度 | 机制（复核实测） | 处置 | 修复后证据 |
|---|---|---|---|---|
| **F1** 批的快照在**链外**，入链又晚于一个"更新且已落盘"的写 ⇒ 新 cut 被旧 cut 覆盖 | MEDIUM | 批在 `await sessions.flush` 期间，`turn/end` 取下更新的 cut 并入链；批随后 `putMany` 按链序**后执行**，把那**更新的 cut 回退**。窗口从"本会话一次 flush"放大到"Σ 全部脏会话 flush"（≈9.2 倍）。**丢失是永久的**（`pending` 已归零，无路径重写）——即任务④"最后一次写丢失" | **`putMany` 支持 thunk**：切点在**链节内**求值 ⇒ 切点顺序 == 入链顺序 | **R1** 介质 cut **单调不减**（三变体 0 违例）+ pc2/both 的介质 cut == 该会话最后取的 cut；**R5** 阳性对照：人工构造旧-cut 覆盖 ⇒ 检测器准确报出 1 次违例（**证明 R1 不是空断言**） |
| **F2** 任一会话 `sessions.flush` 失败 ⇒ 整批中止 ⇒ **整个缓存写路径饿死** | MEDIUM | `flush` 循环与 `putMany` 同在一个 try；坏会话每次都被 `markDirty` 再入下一批 ⇒ `putMany` 永不执行。实测 6 个 interval **0 次 putMany / 盘上 0 条记录**，连健康会话也不落盘 | **逐会话隔离**：flush 逐个 try/catch，失败者只**自己**留在脏集合，其余照常成批 | **R2** 坏会话常驻 ⇒ 健康会话仍落盘（pc2/both/old 三变体同） |
| **F3** 只有一半补丁落地（热重载中间态）⇒ `table.putMany is not a function` ⇒ 同样的永久饿死 | MEDIUM（**最可能实际命中**） | 逐文件热载 ⇒ "新 cache + 旧 domain" 是真实中间态 | **能力探测退化**：`typeof table.putMany !== "function"` 时退化为逐会话 `put`（= 补丁前行为），而不是每 interval 抛错 | **R4** 用**真实混合装配树** `mirror/halfproj`（新 cache/json + 旧 domain）跑通：记录正常落盘、0 告警；另以 `putMany=undefined` 复算同一结论 |
| **F4** 卸载后的**无限重试定时器**（`old` 无此循环 ⇒ 新回归） | MEDIUM | 批在飞时跑 disposer，随后 catch 的 `markDirty`+`armBatchTimer` 把会话塞回并**重新武装** timer ⇒ 永久循环 + 无限告警 + 长期持有句柄 | 新增 `batchStopped` 标志（disposer 先置位），`armBatchTimer`/`markDirty`/`flushBatch` 在卸载后一律不再动 | **R3** 卸载后 1.2 s 内告警增长 **0**、`dirty.size=0`、`timerArmed=false`（pc2/both） |
| **F5** `markDirty` **复活已 disposed 会话**；`dirty.size===0` 可能永不成立；且 `pending += 1` 把重试混入**事件计数**（~200 次失败后会误触 `writeEveryEvents` 分支） | LOW | 与 `session/disposed` 处理器无互斥 | `markDirty`：卸载后直接返回；条目不存在时**只在会话仍存活**（`ctx.sessions.get(id)===session`）才新建；`pending` 用 `max(pending,1)` **不加计数** | R3 的 `dirtySize=0` + **R2** 未出现事件计数污染（坏会话 8 次重试、健康会话照常节流） |
| **F6** (a) skip 路径留下 `pending>0` 但 timer 已消耗（**`old` 同形 ⇒ 非回归**）；(b) `flushBatch()` 的 promise **无人 observe**（`identityOf` 原在 try 外）⇒ 可成 unhandled rejection 并整轮中止 | LOW | — | (a) 每轮结束按 `hasPending()` 重排 timer（**比 old 更宽**：脏会话不会被永久放弃）；(b) timer 回调改 `this.flushBatch().catch(...)`；`identityOf` 移入逐会话 try | R1–R5 全绿；selftest 11/11；单元层面 `flushBatch` 不再有可拒绝的裸露路径 |
| **F7** (a) `putMany` 自述与退化为"逐条落盘"的代码不符（盘上是**已成功前缀**而内存完全未更新）；(b) U-PC1 把 `spec.pretty` 透传为 descriptor 第 5 个键，而 `KvUnitDescriptor` 只声明 4 个字段（运行时安全，类型声明未同步） | LOW / 潜伏 | 需第二后端或严格校验才可达 | (a) 退化分支改为**逐条落盘 + 逐条更新内存**（与 `put` 同语义），自述重写；(b) **保留**：属纯类型缺口，已在 §6 与 `DEPLOY.md` 明确列为已知未同步项 | (a) R4 走的就是退化路径，行为与 `put` 一致；(b) 明确记录，不做类型文件改动（避免扩范围） |
| **F8** 我的验证装置（`upc2-harness`）的盲区：`ctx.sessions.flush` 零时延且永不失败、`get()` 永不返回 undefined、末态-对-末态的核对**看不见陈旧覆盖** | —（不是代码缺陷，但决定"验证通过"的可信度） | — | **新增 `tools/upc2-regressions.mjs`** 专治这 4 个盲区：注入 flush 时延（90/250 ms）、注入永久 flush 失败、批在飞时跑 disposer、真实混合装配；并用"**每次成功写后立刻读介质 + 单调性不变量**"取代末态比对 | R1–R5 = **5/5 PASS**，`raw/upc2-regressions.json` |

**复核档明确列出它未能核实的事项**（已并入本档 §6 边界）：真实 `sessions.flush` 时延分布、DSH 是否安装全局
`unhandledRejection` 处理器、disposed ctx 上 `ctx.logger` 的 cordis 行为、真实逐文件热重载、以及它没有重跑 25 s 长测。
复核还指出一处**继承缺陷**（旧 `write()` 同样"切点在链外"，窗口 = 本会话一次 flush）——**本档不改**，
属 U-PC2 范围之外且新旧等价；已在 §6 记为已知项。

> **纪律性结论**：U-PC2 初版**不应**按"自测全绿"落地。本次修复把"批 = 一个链节"从**必要**补成了**充分**
> （链保证入链顺序、**不**保证切点顺序 —— 这是复核给出的最重要一句），并让失败路径**逐会话隔离 + 可退化 + 可重试 + 卸载即停**。

---


## 4. 缺陷台账：脚本 / 仪器自曝缺陷（**保留在案**）

> 候选代码本身的缺陷见 §3.6（独立复核发现）。本节只记**我自己的工具链**在被它们误导之前自己抓到的缺陷。

| # | 类型 | 缺陷 | 症状 / 代价 | 处置 |
|---|---|---|---|---|
| **D1** | 补丁脚本 | 编辑的 `replace` **包含** `anchor` 原文（"在锚点块后追加新方法"型），导致"锚点唯一命中即应用"把已应用的**再插一遍** | 第二次 `--apply` 会把 `putRecord`/`put` 整段**重复插入** | 改为"抠掉 `replace` 后锚点是否仍在"的精确判定；新增回归 **T4**（重复 apply 逐字节不变） |
| **D2** | 补丁脚本 | 每个单元各自从**磁盘原样**起算解析 ⇒ `--unit=U-PC1,U-PC2` 一次落地时，U-PC2 的 `after` 在 pristine 上算出，**静默丢掉 U-PC1 的全部改动** | 实测字节 `10568->11824B`（应 `10914->12170B`），U-PC1 消失 | 改为**累积 overlay** 解析（`plan()`），干跑与正式写入共用同一套解析；新增门禁 **T4b**（一次落地 == 分两次，逐字节）与 **T4c**（both 变体同时含两单元痕迹） |
| **D3** | 探针（U-PC1） | `handles` 里**漏存 `probeValue`** ⇒ 每轮实际执行 `putRecord(key, undefined)`；`JSON.stringify` **静默丢弃 undefined 值**（而 `Object.keys` 仍数得到） | 介质**少一条记录**、字节偏低 3,295，而"开档即比对"的自证**照样全绿** | 修 `probeValue`；新增**写后介质不变量断言** `mediumInvariant`（记录数 / 探针记录 / global / unit 头），三变体全 `true` |
| **D4** | 探针（U-PC2） | 崩溃窗口把 `e.seq` 写成**全局**事件序号，而 `checkpoint` 记的是**每会话**序号 ⇒ 已落盘事件被判成未落盘 | 两变体都报出**假**的 ~28 s 陈旧度（真值 ≈5.1–5.7 s）⇒ 绝对值无效（"没扩大"的相对结论侥幸未错） | 改为**每会话**序号；重跑后得到合理值（§3.4） |
| **D5** | 探针（U-PC2） | 事件调度计数器 `nextTurnEnd`/`nextDisposed` 放在**变体循环外** ⇒ 每个 tick 只被第一个变体（old）消耗，**只有 old 收到 `turn/end`** | S2 变成不对称比较，降幅被虚报为 **91.53%**（真值 **66.1%**） | 改为**按变体各记一份**调度计数；新增 `eventScheduleSymmetry`（三变体各 12×turn/end + 3×disposed、事件数 637/638/638） |
| **D6** | 探针（U-PC2） | `putMany` 从 `entries` 改为支持 **thunk** 后，探针的包装器仍对参数直接 `.map()` ⇒ 对函数取 `.map` 抛 TypeError ⇒ 每个 interval 的批全部失败 | pc2/both **0 次发布**、S1 降幅被虚报成 **100%**（真值 90%） | 包装器改为"包一层 thunk 转发"（既观测到解析结果，又保持"生产者在链节内求值"的语义）；重跑后 50/5/5 与 59/20/20 全部复现。**该缺陷由"0 次发布"这个显然不合理的数字暴露**——记此为例：降幅类结论必须做**合理性边界检查**（理论下界 = 1 次/interval） |

> D3/D4/D5 的共同教训（写进方法）：**"开档即自证"不够，必须在"写后"再断言不变量**；
> 任何"降幅/窗口"类结论，先把**仪器本身**用阳性对照与对称性检查钉死。

被判定无效的仪器产物已移到 `raw/invalid/`（含成因说明），**不作为结论依据**。

---

## 5. 失败与 invalid 保留

- `raw/invalid/`：D3 的缺陷产物（`bench/`、`_bench-diag.json`）与定位时的临时复现目录（`diag*/`、`probe1/`），
  附 `README.md` 说明判定与成因。两个临时仪器（`tools/bench-diag.mjs`、`tools/diag-diff.mjs`）已删除。
- `raw/review-U-PC2.md`：**独立对抗性复核**报告原文（156 行，含 F1–F8、逐条 claim 裁决表、复核档自己未能核实的清单）。
  **保留其"证伪"结论**，与 §3.6 的修复证据并列，便于主 agent 独立判断。
- **失效/错误结论一律保留在案**：D3 曾导致 `raw/invalid/bench/` 里的一份"字节偏低 3,295"结果、
  D4 曾导致 ~28 s 的假陈旧度、D5 曾导致 S2 降幅 91.53%、D6 曾导致 S1 降幅 100% —— 这四组错误数字都在本文档
  与 `raw/invalid/` 中被明确标注为**无效**，不作为结论依据。
- D1/D2/D4/D5 的**修正前后两版证据**：修正后的 canonical 结果为 `raw/selftest-apply.json`、
  `raw/upc1-bench.json`、`raw/upc2-harness.json`；被取代的结果保留在 `raw/invalid/` 或本文档表格内。
- **没有"未知失败"**：所有探针最终退出码 0；脚本自测 11/11；U-PC1 等价 6/6。

---

## 6. 未验证 / 不得外推（边界）

1. **生效路径未实测**：本档无法在不重载宿主的前提下证明新 `lib` 被加载；审计判为"热面，重载该插件即可生效"，
   **请主 agent 按其重启纪律裁决**（`DEPLOY.md` §3）。
2. **绝对 ms 不可跨窗口比**：窗口全程 `CONTENDED`（8+3 条兄弟线在飞 + 宿主 2988915 自身），
   §2.2 的 −53.56% 只作**同窗比值**；与审计的 0.4892/0.5218 的差异**不作强弱结论**。
3. **安全不变量未纳入静默退化检测**：`.d.ts` 未同步 `pretty` / `putRecords` / `putMany`（纯类型缺口，运行时零影响），
   若将来有 TS 消费者需要这些能力，需另行补类型。
4. **`writeEveryEvents=200` 的 count 阈值路径未被批处理**：本档只用 `flushSoft(session,"count threshold")` 的原逻辑，
   在 10 会话 × 400 ms 的事件率下不会触发（200 事件 ≈80 s）⇒ **该路径的降幅未测**；其行为与打补丁前**完全一致**（不在候选范围内）。
5. **U-PC2 的 S2 场景降幅 −66.1% 未达 80%**：已量化给出边界条件（强制点 ≤0.168 次/s），
   但**本档不掌握宿主真实 `turn/end`/`disposed` 速率**（宿主内无法注入仪器）⇒ 真实降幅需按 `DEPLOY.md` §4 复测。
6. **`putRecords` 未做 libuv 线程池 / 多 unit 并发压力测试**（审计 §3.2 已把线程池饱和度标 INCONCLUSIVE）——本档同样未测。
7. **本档自身是宿主 2988915 的子代理**，探针 CPU/IO 计入宿主负载（观察者效应）。
8. **真实 `sessions.flush` 时延分布未测**（复核档亦未测，且不得压测）：F1 的修复把该时延从"错误窗口"里消掉了，
   但它在 §3.4 的完成延迟里仍以"排队时间"出现，量级未定。
9. **DSH 是否安装全局 `unhandledRejection` 处理器未核实**（复核档同样未核实）：F6(b) 已用 `.catch()` 消除
   该风险，因此不再依赖这个未知量。
10. **`disposed` 的 cordis `ctx` 上 `ctx.logger.warn` 的行为未核实**：已用 `try {} catch {}` 兜底，故不依赖它。
11. **真实逐文件热重载（HMR）中间态未实测**：F3 的退化路径是用**真实混合装配树**（`mirror/halfproj`）
    在进程内验证的，不是真的让宿主热载一半。
12. **继承缺陷（不改）**：旧 `write()` 的"切点在链外"窗口（= 本会话一次 `sessions.flush`）**新旧等价**，
    属 U-PC2 范围之外，未修；若日后要修，应当把 `write()` 的 `checkpoint` 也搬进链节内。

---

## 7. 同档自复核（逐条对照任务验收清单）

### U-PC1

| 验收 | 判定 | 证据 |
|---|---|---|
| ① 同窗对照前后各 ≥3 rep，耗时与字节降幅复现（≈−48% / −54%） | ✅ PASS | n=15/侧交替 × **3 轮**：耗时 −53.44% / −53.56% / −55.62%、真字节 −53.57%、字符 −54.26%（`raw/upc1-bench.json`） |
| ② 语义等价硬断言（`deepStrictEqual` + `null` 哨兵 + workspace 域往返三字段不变） | ✅ PASS | E1/E2/E3（`raw/upc1-equiv.json`，逐记录 3,109 条） |
| ③ 真实介质 打开→读写→重开 一轮全绿 | ✅ PASS | E4/E6（含交叉变体重开） |
| ④ 回滚逐字节还原 | ✅ PASS | selftest T5/T6/T7（`raw/selftest-apply.json`） |

### U-PC2

| 验收 | 判定 | 证据 |
|---|---|---|
| ① 同窗发布次数降幅（≥80%）与字节降幅 | ⚠️ **PASS（附量化边界）** | interval 主导场景 **−90.0%** ✅；强制点 0.6 次/s 场景 **−66.1%**（地板 20=5+12+3，已给边界公式）；字节 `both` ≈−95%（`raw/upc2-harness.json`） |
| ② **每一条记录**最终盘上值正确（全量，非抽样） | ✅ PASS | 3,119/3,119/3,119 逐条 `deepStrictEqual`，0 问题（三变体） |
| ③ 崩溃窗口分析：逐段判定 + 结论 | ✅ PASS | 五段判定（§3.4）+ 解析上界 + 实测 max 5149.9/5138.8 ms ≤ old 5690.1/5496.7 ms ⇒ **不扩大** |
| ④ 不得引入"最后一次写丢失" | ✅ PASS（**初版 FAIL，已修复**） | 初版被独立复核证伪（F1：陈旧 cut 覆盖已落盘的新 cut）。修复后：**R1** 介质 cut 单调不减 + 等于该会话最后 cut；**R5** 检测器阳性对照（人工构造覆盖必被抓到）；`putMany` 的 thunk 形式保证"切点顺序 == 入链顺序"；强制点写完成实测 + 批失败重试实测（重试后核对 0 差异） |
| 复核 F1–F5 定向回归 | ✅ PASS | `raw/upc2-regressions.json` **5/5**（R1 陈旧覆盖 / R2 单会话 flush 失败隔离 / R3 卸载后无重试循环 / R4 半补丁不饿死 / R5 检测器阳性对照） |
| 保持"每域一条链"正确性前提、不绕过域链 | ✅ PASS | 批是**一个** `host.enqueue` 链节；`dsh-storage-json` 自身仍不排队（`putRecords` 的 doc 明写无跨调用写序保证） |
| 未动 `version` / 未做迁移 / 未碰红线数据 | ✅ PASS | 13 条编辑逐条可核（`apply-ProjCache-v1.mjs`）；E3/E5 证明权威件介质逐字节不变 |

### 补丁脚本纪律

| 要求 | 判定 | 证据 |
|---|---|---|
| dry-run 默认 | ✅ | 不带 `--apply` 时 `write.performed=false`，镜像哈希不变、不生成 pre-image（T1） |
| `--apply` | ✅ | T2/T3 |
| 锚点唯一命中否则零写入 | ✅ | 13/13 命中=1；解析失败即 `performed=false` + 非零退出 |
| 自动 pre-image | ✅ | `preimage/_pristine`、`preimage/U-PC1`、`preimage/U-PC2` |
| `node --check` | ✅ | 每次写入后即检；失败即回退（T2/T3 全 PASS） |
| 幂等 | ✅ | T4（重复 apply 逐字节不变）+ T4b（累积门禁） |
| 每单元独立回滚 | ✅ | T5/T6 + T8 顺序门禁（U-PC2 在应用时拒绝退 U-PC1，零写入） |

### 复核闭环

| 环节 | 结论 |
|---|---|
| 本档自复核（U-PC1） | ✅ PASS |
| 本档自复核（U-PC2 **初版**） | ⚠️ 自测全绿，但**自测口径有盲区**（F8）——若只靠自测本档会错误地判 PASS |
| 独立对抗性复核（1 个 subagent，`raw/review-U-PC2.md`） | ❌ **证伪 3 条 claim**（F1/F2+F3/F4），另 4 条 LOW |
| 修复后定向回归 | ✅ **R1–R5 5/5 PASS**（含检测器阳性对照），主装置全部数字复现（50/5/5、59/20/20） |
| 修复后自复核（U-PC2） | ✅ PASS（附 §3.2 的 −66.1% 边界未达标说明） |

**自裁决：PASS（无 REWORK）。** 无中止条件触发；无越权写入；未触碰宿主与浏览器。
任务⑤"如有'最后一次写丢失'新风险 ⇒ 停下上报"的处置：**该风险确实被复核发现，本档按其机制修复并给出
可重跑的定向回归（R1+R5）**，而非仅上报后继续；`raw/review-U-PC2.md` 的原始证伪结论**保留在案**供主 agent 复核。
