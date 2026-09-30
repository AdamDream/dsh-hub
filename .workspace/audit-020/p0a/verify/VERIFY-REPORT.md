# 工单 WP1 / 状态：**完成**（Q1/Q2/Q3 全量通过；另发现并已由协调者修复 1 个高危物理布局缺陷）/ 实跑命令见 §0.2 / 证据路径见 §0.3

> 对象：`p0a/converted/sessions/`（转换产物，**协调者 2026-09-30 修订后的版本**）对照 `p0a/corpus/sessions/`（原语料只读副本）。
> 写入边界：仅 `p0a/verify/**`。本档**未**修改 `convert.mjs` / `scan.mjs` / `framecheck.mjs` / `assembly-020/**` / `reports/**` / `converted/**` / `corpus/**`，**未**触碰 `~/.dsh/**`、`~/.dsh-017/**`，**未**起任何服务、**未**重启 3098/3080/3097。
> 结论强度标注：`[实跑]`（本档实际执行命令所得）/ `[源码]`（引官方件行号）/ `[未验证]`（见 §8）。

---

## 0. 摘要

### 0.1 三问结论（一张表）

| 问题 | 判据 | 结果 | 强度 |
|---|---|---|---|
| **Q1 读打开（current/v3）** | `historicalSessionFormatCatalog.createRestore(header,{recovery:'recoverable',validation:'current'})` 逐份解码 | **转换后 2508/2508 = 100.00%**；对照转换前 **229/2508 = 9.13%**（失败 2279：`descriptor-version` 2275 + `inbox-spliced-sections` 4） | `[实跑]` |
| **Q2 写打开 / v4 全链** | `createSessionFormatCatalogWithChildren(真实 child facts).createRestore(header,{recovery:'recoverable',validation:'current'})` 逐份跑 v0→v1→v2→v3→v4 | **2508/2508 = 100.00%，失败清单 0 条**；补充口径 `validation:'transformed'`（持久层真实接线）同样 **2508/2508** | `[实跑]` |
| **Q3-1 头部不变量** | 9 个字段逐字段 + 头部整行逐字节 + 头部对象深比 | **全部相等**：整行逐字节 2508/2508；字段不一致 0；深比差异 0 | `[实跑]` |
| **Q3-2 地标计数不变** | 落库行 + packed 行按 `payload.length` 展开 | **9 个地标两侧全等，差异文件 0 份**；`assistant/chunk` 展开后两侧同为 **34,085,630** | `[实跑]` |
| **Q3-3 消息投影哈希** | 稳定规范化（去 `time`/`seq`、键字典序）后 sha256 | 行级扣除白名单后 **2508/2508 相等**，非白名单差异 **0 条**；事件级在源侧可解码的 229 份上 **229/229 相等**；0.1.1 侧独立解码 **2505/2505 事件数相等、去白名单哈希全等** | `[实跑]` |
| **附加：物理布局闸门** | 0.2.0 真件 `readFirstZstdLine` / `listArtifacts` | 修订后：闸门 **2508/2508 通过**，`listArtifacts` 枚举到 **2505**（= 目录数）。修订前实测同一根枚举 **0** | `[实跑]` |

**一句话**：修订后的转换产物在 0.2.0 侧做到了「可读打开 100% + 可写打开（v4 全链）100% + 物理层可枚举」，
且保真三项在**全量 2508 份**上无一例外；转换的改动面被**精确**限定为白名单（R1 2275 处 + R2 912 处），无任何附带改动。

**两处易被误读、先在此声明（详见 §5.4 / §6）**：

1. `curgen-result.json` 的 **30/30 拒绝不是失败**——它是对**只读历史根**跑「当前(v4)代际」检查，
   而转换产物**刻意保持 v0/v3**，v4 后继由 0.2.0 在写打开时惰性发布。⇒「**判据不适用于本轮口径**」；
   改判据应为「写打开后应产生 v4 后继」（本档未执行发布，列入 §8 未验证）。
2. `legacy-011-result.json` 里 `formatPackages.*.exists = false` → 0.1.1 侧**不存在** `dsh-session-format-*`（该类包由 0.2.0 引入）。
   0.1.1 侧结论**只用于 0.1.1 自己的口径**（跨代不可比），**未**与 0.2.0 的拒因并列归因。

### 0.2 实跑命令（全部可复跑）

```bash
cd /home/CNS2026495165/dsh/.workspace/audit-020/p0a

# 主验证（Q1+Q2+Q3+物理闸门，全量 2508 份；约 375s）→ 写 verify/per-file.jsonl + verify/summary.json
node --max-old-space-size=8192 verify/verify-v4.mjs

# 冒烟（pass2 限 25 份）
node --max-old-space-size=8192 verify/verify-v4.mjs --limit 25

# 0.1.1 侧对照解码（真件 dsh-session-persistence-jsonl@0.1.1-rc.2 的原生 readZstdPrefix）→ verify/legacy-011-result.json
node --max-old-space-size=8192 verify/verify-v4.mjs --legacy011 2508

# 可复现反证 A：把同一内容重压成**单帧**（= 旧 convert.mjs 形态）→ verify/singleframe-result.json
node --max-old-space-size=8192 verify/verify-v4.mjs --singleframe 500

# 可复现反证 B：把同一内容重压成**分帧**（= 修订后形态）→ verify/reframe-result.json
node --max-old-space-size=8192 verify/verify-v4.mjs --reframe 500

# current-generation 读路径边界（readZstdPrefix 对历史代按设计拒绝）→ verify/curgen-result.json
node --max-old-space-size=8192 verify/verify-v4.mjs --curgen 30

# 协调者新闸门（独立复核，非本档产物）
node framecheck.mjs converted/sessions
```

`$B = /home/CNS2026495165/dsh/.workspace/audit-020/assembly-020/prefix-cli-rc2/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai`

### 0.3 证据路径

| 路径 | 内容 |
|---|---|
| `p0a/verify/verify-v4.mjs` | 可复跑验证器（唯一脚本，6 个模式） |
| `p0a/verify/per-file.jsonl` | **每份日志一行**（2508 行）逐份结果 |
| `p0a/verify/summary.json` | 全量聚合 + 失败清单 + 判据 |
| `p0a/verify/legacy-011-result.json` | 0.1.1 侧对照解码全量结果 |
| `p0a/verify/singleframe-result.json` | 反证 A（单帧 ⇒ 枚举 0），可复跑 |
| `p0a/verify/reframe-result.json` | 反证 B（分帧 ⇒ 枚举正常） |
| `p0a/verify/curgen-result.json` | current-generation 读路径边界 |
| `p0a/verify/singleframe/sessions/`、`p0a/verify/reframe/sessions/` | A/B 两个抽样根（各 418 份 + 3 个 lock，可直接对它们重跑 `listArtifacts`） |
| `p0a/verify/VERIFY-REPORT.md` | 本报告 |

### 0.4 验证对象盘面（`[实跑]`）

| 项 | corpus | converted |
|---|---|---|
| `.jsonl.zstd` | 2508 | 2508 |
| `session.lock`（0 字节，按字节复制） | 3 | 3 |
| 其它文件（`.jsonl` / `none` / `v4` 产物） | **0** | **0** |
| 会话目录数 | 2505 | 2505 |
| 文件名直方图 | `session.jsonl.zstd`×2505 + `session.v3.jsonl.zstd`×3 | 同左（一一对应） |
| 相对路径集合 | — | 与 corpus **完全一致**（onlyCorpus 0 / onlyConv 0） |
| zstd 帧数 | 全部 ≥2（frame#0 恰好一行 header） | **全部 = 2**（frame#0 = header 行，frame#1 = 其余行） |

> **为什么 `listArtifacts` 期望是 2505 而不是 2508**：2508 个文件分布在 **2505 个会话目录**里，
> 其中 3 个目录同时存在 `session.jsonl.zstd`(v0) 与 `session.v3.jsonl.zstd`(v3) 两代；
> 0.2.0 `resolveGenerationInDirectory`（`$B/dsh-session-persistence-jsonl/lib/index.js:3326-3358`）
> 取同目录内**版本最高**的一代 ⇒ 每目录 1 份 ⇒ **2505**。corpus 与 converted 同为 2505，故「无静默跳过」。

---

## 1. 验证口径（与工单逐条对齐）

| 口径 | 用的官方件真实函数 | 源码判定点 |
|---|---|---|
| Q1 读打开 | `historicalSessionFormatCatalog`（currentVersion **3**，迁移链 v0→v1→v2→v3） | `$B/dsh-session-format-catalog/lib/index.js:91-111` |
| Q2 写打开 v4 全链 | `createSessionFormatCatalogWithChildren(children)`（currentVersion **4**，迁移链 v0→v1→v2→v3→**v4**） | 同文件 `:80-86`；v3→v4 边缺 child facts 必抛 `V3 catalog migration requires explicit historical child facts` | `$B/dsh-session-format-v3-to-v4/lib/index.js:1414-1416` |
| child facts 组装 | `historicalChildCatalogSource(artifact)` → `{childId, childCreatedAt, descriptorCount, descriptor}` | 同文件 `:871-883` |
| child 选取口径 | `header.origin === 'subagent' && header.parentSession === 父id`，逐父按其子代读子代自己的 descriptor | `$B/dsh-session-persistence-jsonl/lib/index.js:2684-2686` + `:2200-2258` |
| 打包行展开 | 每行贡献 `payload.length` 个 `assistant/chunk`（text/reasoning → `texts`，tool-call → `args`） | `$B/dsh-session-format-v0-to-v1/lib/index.js:1809-1843` |
| `seedLength → isSeeded` | `isSeeded = record.seedLength !== undefined`；`inheritedEventCount = seedLength` | 同文件 `:1707`、`:1720`、`:1728` |
| 物理首帧闸门 | `assertZstdHeaderFrame`（首帧恰好一行 header） | `$B/dsh-session-persistence-jsonl/lib/index.js:2293-2295` |
| 物理枚举入口 | `readFirstZstdLine`（:3293-3325）→ `readGenerationHeader`（:3059-3093）→ `listArtifacts`（:3031-3057） | 同上 |

**Q2 为什么必须绑定 child facts（而不是静态 catalog）**：`v3→v4` 边的 `sessionFormatV3ToV4.createStage` 直接抛
`SessionFormatUnsupportedMigrationError`（`$B/dsh-session-format-v3-to-v4/lib/index.js:1414-1416`），
只有 `createSessionFormatV3ToV4(children)` 才提供 `ReleasedV3ToV4Stage`（`:1424-1429`）。
本档**只**用 `createSessionFormatCatalogWithChildren`，**未**用静态 `sessionFormatCatalog` 做 Q2（T21 已证那会 100% 假失败）。

**Q3-2 的计数口径**：以**落库行 + packed 展开**为准。理由（`[源码]`）：0.2.0 解码后的 v2/v3 词汇表**不含** `assistant/chunk`
——`$B/dsh-session-format-v1-to-v2/lib/index.js:6` 把 `assistant/chunk` 从 retained dispositions 中剔除，
`:4` 用 `AssistantStreamAccumulator` 将其折叠进 `assistant/message`/`assistant/attempt`/`system/message`。
故「解码事件里的 `assistant/chunk` 恒为 0」是**投影定义**，不是数量丢失；本档在 §4.2 同时给出该事实作为佐证。

---

## 2. Q1 读打开口径（current/v3）

`node --max-old-space-size=8192 verify/verify-v4.mjs`（全量）`[实跑]`

| 侧 | 通过 | 失败 | 通过率 | 失败分类 |
|---|---|---|---|---|
| **转换后** converted | **2508** | **0** | **100.00%** | — |
| **转换前** corpus（对照） | 229 | 2279 | **9.13%** | `descriptor-version` 2275；`inbox-spliced-sections` 4 |

- 失败清单条数：转换后 **0** 条（`per-file.jsonl` 中 `q1.target.ok === false` 的记录数 = 0）；转换前 **2279** 条（见 `summary.json → agg.q1.baselineFailList`）。
- 转换前的两个失败分类与协调者 `recon/scan-before.jsonl` 的口径**完全一致**（2275 + 4 = 2279，9.1%），本档独立复算得到同一数字。
- 转换后每条记录额外给出 `headerVersion = 3`（读打开后的逻辑版本），无例外。

**结论**：Q1 通过。`[实跑]`

---

## 3. Q2 写打开 / v4 全链（本轮关键一步）

`node --max-old-space-size=8192 verify/verify-v4.mjs`（全量）`[实跑]`

> **样本量声明（协调者点名核对）**：Q2 是**全量 2508 份，无抽样**。
> 主口径与补充口径各跑 **2508 次解码**（合计 5016 次 v4 级全链解码），耗时约 375s（含 Q1/Q3 与真件物理闸门）。
> 工单里没有出现「成本太高只能抽样」的情形，故不存在"用 100% 包装部分样本"的问题。
> 抽样只出现在**两类旁证**里，且已在各自小节标明样本量：
> 可复现反证 A/B（`--singleframe 500` / `--reframe 500`，实际抽中 418 份，§5.3）与
> `--curgen 30` 边界探针（§5.4）。二者都**不**参与 Q2 的通过率。

### 3.1 主口径 `validation:'current'`（工单指定）

- **通过 2508 / 2508 = 100.00%**
- **失败清单：0 条**（`summary.json → agg.q2.failList` 为空，`agg.q2.classes` 为空对象）
- 每份均产出 `headerVersion = 4` 的当前逻辑 artifact

### 3.2 补充口径 `validation:'transformed'`（持久层真实接线）

`$B/dsh-session-persistence-jsonl/lib/index.js:2702-2708` 里持久层真实传的是
`{recovery:'recoverable', validation:'transformed'}`，随后自己再做 `currentHeader` + `validateStoredEvents`。
本档对全量复算该口径：**通过 2508 / 2508 = 100.00%，失败 0**。

### 3.3 child facts 组装（复算 `prepareCatalogFacts` 口径）

| 项 | 值 |
|---|---|
| 被选中的 generation 数（按目录取最高版本，= `resolveGenerationInDirectory`） | **2505** |
| 成功解码并产出 facts 的子会话 | **2505** |
| 子会话解码失败（`unavailable` 记录） | **0** |
| 有子代事实的父会话 | **291** |
| facts 记录总数 | **2276** |

- facts 由官方件 `historicalChildCatalogSource` 直接产出（未自行复刻字段语义）；`descriptorCount`/`descriptor` 取自子代自身
  `seq >= inheritedEventCount` 的 `subagent/descriptor`（`:874-880`）。
- 2276 条 facts vs 2275 行 `subagent/descriptor`：多出的 1 条是 `descriptorCount = 0 / descriptor = null` 的子会话
  （该形状与 `prepareCatalogFacts` 的 `unavailable` 记录同构，`:2213-2219`），v3→v4 侧对它有既有处理，不影响通过率。
- **未**出现 `requires explicit historical child facts` 类失败 —— 这从反面证明 child facts 确实绑定生效，而不是「碰巧不需要」。

**结论**：Q2 通过，且是「带真实 child facts 的 v4 全链」。`[实跑]`

---

## 4. Q3 保真三项证据

### 4.1 头部不变量

对 8 个点名字段（`id`/`createdAt`/`cwd`/`parentSession`/`origin`/`delegationDepth`/`agentPreset`/`seedLength→isSeeded`）
在「原 v0 基线」与「转换后」两侧逐字段比对：

| 判据 | 结果 |
|---|---|
| 头部**整行逐字节**相等（`rawHeaderLine`） | **2508 / 2508** |
| 9 个字段逐一相等 | **不一致 0 处**（`agg.q3_1.fieldMismatch = []`） |
| 头部**对象深比**（`JSON` 键序无关的全字段对比） | **差异 0 处**（`agg.q3_1.jsonDeepDiff = []`） |
| 携带 `seedLength` 的文件 | 44 份（两侧同值） |
| 携带 `isSeeded` 的文件 | 3 份（正是 3 份 v3 generation，两侧同值） |
| 缺省语义 | 其余文件两侧**同时缺省**（`cwd` 等仍存在；`parentSession` 2279 份、`origin` 2344 份） |

- `seedLength → isSeeded`：0.2.0 在 v0 解码时把 `seedLength` 映射为 `isSeeded`，并把 `seedLength` 作为
  `inheritedEventCount`（`$B/dsh-session-format-v0-to-v1/lib/index.js:1707/:1720/:1728`）。
  转换器**整行原样复制头部**，故物理头两侧逐字节相同；逻辑头上，44 份 `seedLength` 文件映射出的 `isSeeded=true` 与
  转换后一致，3 份 v3 文件的 `isSeeded` 也一致。
- **补充（分帧无损，协调者点名核对）**：转换后 frame#0 的解码结果与原始文件 frame#0 **逐字节相同**
  （sha256 相等 **2508/2508**）；frame≥1 的按行拼接在 churn 侧给出：行数相等 **2508/2508**，
  文本逐行相同 **229/2508**（恰好 = 无需白名单修复的 229 份），其余 2279 份的差异行**全部**落在白名单位置上
  （`restDifferingRowsWhitelistOnly = 2508/2508`，非白名单行差异 **0**）。
  即：重分帧没有丢失/重排/改写任何事件行。

**结论**：Q3-1 通过（字段级 + 字节级 + 对象级三重相等，且分帧无损）。`[实跑]`

### 4.2 地标计数不变

**判据实现**：对同一份日志，两侧各自统计落库行；`text-chunks`/`reasoning-chunks` 按 `data.texts.length`、
`tool-call-chunks` 按 `data.args.length` 展开为 `assistant/chunk`（口径依据 `$B/dsh-session-format-v0-to-v1/lib/index.js:1809-1843`）。

**出现差异的文件数：0 / 2508。** 两侧全量合计：

| 地标 | corpus | converted |
|---|---:|---:|
| `turn/start` | 8589 | 8589 |
| `turn/end` | 8524 | 8524 |
| `step/start` | 169188 | 169188 |
| `step/end` | 169128 | 169128 |
| `assistant/message` | 168594 | 168594 |
| `tool/call` | 207283 | 207283 |
| `tool/result` | 208208 | 208208 |
| `user/message` | 33699 | 33699 |
| `agent/inbox/spliced` | 32125 | 32125 |
| **`assistant/chunk`（打包行展开后）** | **34,085,630** | **34,085,630** |

- 打包行 **1,089,733** 行，展开出 **33,742,680** 个 chunk；另有 **342,950** 行本就是显式 `assistant/chunk` 行
  （33,742,680 + 342,950 = 34,085,630 ✓，与直接行类型直方图自洽）；`packedBad = 0`（无 payload 形状异常）。
- **「只允许 `assistant/chunk` 一处出现差异」的条件在本产物上根本没有被触发**：两侧**连 `assistant/chunk` 都完全相同**，
  其余 8 个地标也完全相同。即 R2 的 `sections: []` 确实没有引起任何 chunk 变化。
- **独立佐证（0.1.1 侧）**：用真件 0.1.1 原生解码器（§6）读两侧，`assistant/chunk` 计数同为 **34,085,630**，
  与上面的展开口径**逐位相符**；0.1.1 解码的总事件数两侧同为 **35,123,307**，**逐类型计数 0 处不同**。
- **信息性备注（不参与判据）**：669 份文件里「0.2.0 解码投影」与「行级展开」的计数不同
  （668 份为 `assistant/chunk`、5 份为 `turn/end`），原因是 §1 所述的 v1→v2 折叠/合成，属投影定义差异，
  **不是**转换引起的差异（两侧的投影口径一致，且行级计数两侧完全相同）。

**结论**：Q3-2 通过（0 差异，包含 `assistant/chunk`）。`[实跑]`

### 4.3 消息投影哈希相等

**规范化口径**：只丢弃**信封** `time`/`seq`（行级另去 `time0`/`seq0`），对象键按字典序递归排序，再取 sha256。
**两个数字**：`raw`（全字段）与 `stripped`（扣除两个白名单字段：
`subagent/descriptor.data.version`、plugin-snapshot 的**空** `sections`）。

> **两个数字在 `per-file.jsonl` 里逐份可见**（协调者点名核对）：每行都同时给出
> `q3_3.rows_raw_hash.{corpus,converted}`、`q3_3.rows_stripped_hash.{corpus,converted}`、
> `q3_3.events_raw_hash.{corpus,converted}`、`q3_3.events_stripped_hash.{corpus,converted}`
> 四组（共 8 个 sha256），以及 `q3_3.rows_strip_diff` / `events_strip_diff` 的逐字段差异路径。
> 转换前 9.13% 那 2279 份的源侧事件级哈希为 `null`（附 `events_source_refused: true` + 0.2.0 的拒因），
> **不是**被跳过，而是源侧确实不可解码 —— 故本档对全量另给**行级**两个哈希（无需解码即得，§下表首两行）
> 与**shim 对照装置**的两个哈希（§下表第五组），保证每份都有可比的数字。
>
> **差异只来自白名单的证明**：R1 = `subagent/descriptor.data.version` 2→3（本档实测 corpus 侧 2275 处）；
> R2 = plugin 来源补 `sections: []`（实测 corpus 侧 912 处）。
> 扣除这两个字段后**全量 2508 份的哈希相等且结构差异为 0**；未扣除时不相等的恰是这 229 份之外的 2279 份。
> 反向证据：白名单面审计显示 converted 侧 `version≠3` 残留 **0**、缺 `sections` 残留 **0**、
> 且**已有非空 `sections` 的 12095 处一处未动** ⇒ 不存在"多改"或"少改"。

| 层级 | 判据 | 结果 |
|---|---|---|
| **落库行**（全量 2508，无需 shim） | `raw` 哈希相等 | **229/2508**（恰好 = 无 R1/R2 修复的集合） |
| | **`stripped` 哈希相等** | **2508 / 2508** |
| | 扣除白名单后的结构差异条数 | **0** |
| **解码事件**（0.2.0，源侧可解码子集） | 源侧被读打开拒绝 | 2279 / 2508（= Q1 baseline 失败集，同一集合） |
| | `stripped` 哈希相等（双侧可解码的 229 份） | **229 / 229** |
| | 扣除白名单后的结构差异条数 | **0** |
| **解码事件**（源侧加白名单 shim 后，全量） | `raw` 相等 | **2508 / 2508** |
| | `stripped` 相等 | **2508 / 2508** |
| **解码事件**（0.1.1 原生解码，独立实现） | 事件数相等 | **2505 / 2505** |
| | `stripped` 哈希相等 | **2505 / 2505** |
| | `raw` 哈希相等 | 226 / 2505（= 229 − 3，3 份是 0.1.1 读不了的 v3 文件） |

**为什么 `stripped` 必须相等而 `raw` 不必然**：转换只改两处（`subagent/descriptor.data.version` 与补 `sections: []`），
所以 `raw` 哈希在**被修复的那 2279 份**上必然不同；把这两个白名单字段扣除后必须完全相等。实测正是如此，
且**非白名单差异 0 条**——即「差异只来自白名单」已被证明，而非假定。

**白名单面审计（精确全量计数，非抽样）**：

| 计数对象 | corpus | converted |
|---|---:|---:|
| `subagent/descriptor` 行中 `data.version ≠ 3` | **2275** | **0** |
| `subagent/descriptor` 行中 `data.version = 3` | 0 | **2275** |
| plugin-snapshot 来源**缺** `sections` | **912** | **0** |
| plugin-snapshot 来源 `sections = []` | 0 | **912** |
| plugin-snapshot 来源 `sections` 非空 | **12095** | **12095** |

⇒ 转换器命中的修复点恰好是 **R1 2275 处 + R2 912 处**；**12095 处已有非空 `sections` 一处未动**；
转换后**不存在**任何 `version ≠ 3` 或缺失 `sections` 的残留。既无遗漏也无越界。

**集合恒等式（强自洽信号）**：在 2508 份上，
`无 R1/R2 修复目标` = `Q1 转换前可读` = `行级 raw 哈希相等` = `事件级 stripped 哈希相等` = **同一批 229 份**（`[实跑]` 逐一比对集合相等）。
这说明「转换改了什么」与「哪 2279 份曾经读不开」是同一件事，不存在第三类改动。

**结论**：Q3-3 通过（含两个数字与逐字段定位）。`[实跑]`

---

## 5. 物理布局闸门（本轮关键发现与修复确认）

### 5.1 发现的缺陷（已在 §0.2 告警，协调者已修）

**旧 `convert.mjs` 把「header 行 + 全部行」重压成单个 zstd frame**，破坏了 0.2.0 持久层的首帧不变量：

- 0.2.0 要求首帧**恰好只有一行 header**：`$B/dsh-session-persistence-jsonl/lib/index.js:2293-2295`（`assertZstdHeaderFrame`）。
- 该断言在两个真实入口生效：`:3310-3315`（`readFirstZstdLine` ← `readGenerationHeader` ← `listArtifacts`）
  与 `:2951`（`readZstdPrefix` ← `readStoredLog`）。
- `listArtifacts` 在 `:3043` 把 `SessionPersistenceCorruptionError` **静默 `continue`** ⇒ 这类文件**既不被枚举也不报错**。
- `scan.mjs` 之所以报 100% 通过，是它自己做帧遍历后 `Buffer.concat` 全部帧再喂 catalog，**绕过了首帧断言**
  ——它只能证明 codec 层可解码，不能证明持久层可枚举。

**实测（`[实跑]`，对**已被替换的旧产物**）**：真件原型 `listArtifacts` 在旧 `converted/sessions` 上返回 **0**，
在 `corpus/sessions` 上返回 **2505**；`readFirstZstdLine` 抽样 40 份：corpus 40/40 通过、旧 converted **0/40**（全部
`first frame is not exactly one header line`）。

### 5.2 修复后复测（权威结论）

| 判据（真件调用，非复刻） | corpus | converted（修订后） |
|---|---|---|
| `readFirstZstdLine` 逐份（`:3293-3325`） | **2508/2508 通过** | **2508/2508 通过** |
| `listArtifacts` 整根枚举（`:3031-3057`） | **2505** | **2505** |
| 枚举到的 `sourceVersion` | — | `[0, 3]` |
| 帧布局 | 全部 ≥2 帧，frame#0 = 恰好一行 header | **全部 = 2 帧**（frame#0 = header 行，frame#1 = 其余行） |
| 静默跳过 | 0（枚举数 = 目录数 2505） | **0**（枚举数 = 目录数 2505） |

补充：**修订后根里没有混入 3098 正在写入的 v4 / `none` 产物** —— `converted/sessions` 仅有
2505×`session.jsonl.zstd` + 3×`session.v3.jsonl.zstd` + 3×`session.lock`，非 `.zstd`/非 lock 文件 **0** 个
（若混入未压缩 `.jsonl` 会触发 `legacyLayout`，`:3429-3455`；实测无此风险）。

**独立复核**：协调者新闸门 `node framecheck.mjs converted/sessions` 报 `files 2508 / ok 2508 / bad 0 / frameCounts {2:2508}`
（`[实跑]`）。注意 `framecheck.mjs` 是对该断言的两行**复刻**，而本档用的是**真件原型方法**，两者一致。

### 5.3 可复现反证 A/B（不依赖已被替换的旧产物）

在 `verify/` 边界内用**同一批内容**构造两个抽样根（各 418 份 + 全部 3 个 lock），再用真件闸门实测：

| 抽样根 | 形态 | 真件首帧闸门（抽 60） | 真件 `listArtifacts` |
|---|---|---|---|
| `verify/singleframe/sessions` | **单帧**（旧 convert.mjs 形态） | **0 / 60 通过**（60 条均为 `first frame is not exactly one header line`） | **0** |
| `verify/reframe/sessions` | **分帧**（修订后形态） | **60 / 60 通过** | **418** |
| `corpus/sessions`（对照） | 分帧 | 2508/2508 | 2505 |
| `converted/sessions`（修订后真产物） | 分帧 | 2508/2508 | 2505 |

⇒ 缺陷与修复的因果被**同内容 A/B** 钉死：唯一变量是分帧形态。

### 5.4 边界记录：current-generation 读路径不是历史根的门槛 —— **判据不适用于本轮口径**

> **明确声明（采纳协调者口径，本档独立复核后同意）**：`--curgen` 的 30/30 拒绝**不是转换失败，也不是缺陷**，
> 而是**判据不适用于本轮口径**。转换产物**刻意保持 v0/v3 物理格式**（文件名与 header 都不动），
> v4 后继由 0.2.0 在**写打开**时惰性发布（`$B/dsh-session-persistence-jsonl/lib/index.js:2697-2712`
> 的 `prepareJsonlMigration`，其中 `:2710` 把 `verifyCurrentGenerationInWorker`（`:1481`）接为
> `verifyCurrentFile`，即该检查作用于**发布后的当前(v4)代际文件**）。
> 对一个只读历史根做"当前代际存在性"检查，本来就应当全失败。

本档实际调用的是 `readZstdPrefix`（`:2937`，经 `:2782 readStoredLog` / `:2795 decodeStoredLog` 的**当前代**读路径），
对历史 v0/v3 文件的正确行为就是拒绝，报：

```
session "…" uses log format v0, older than the supported v4, and this build ships no upgrade path for it
```

实测 **30/30 拒绝**（`verify/curgen-result.json`，样本量 30，抽样规则：按 `allRel` 均匀步长取 30 份）。
**改判据的话**应当是「**写打开后应产生 v4 后继**」——本档**没有**执行写打开发布（会写 `converted/**`，越界），
故该判据留作 `[未验证]`（见 §8 第 1 条）。**本档不把它计入任何通过率，也不记为失败。**

### 5.5 与协调者 2524 / 2521 数字的对照说明（**不同对象，不是数字冲突**）

协调者实测「磁盘 2524 个 `.zstd` − 3 个被更高代际遮蔽 = **2521**（v0 2502 + v3 3 + v4 16）」。
本档的 2505 是**另一个根**的数字，两者不冲突：

| 根 | 是否本档验证对象 | `.jsonl.zstd` | 构成 | `listArtifacts` |
|---|---|---|---|---|
| `p0a/corpus/sessions` | 对照基准 | 2508 | 2505 v0 + 3 v3 | 2505 |
| **`p0a/converted/sessions`** | **本档唯一验证对象** | **2508** | **2505 v0 + 3 v3，无 v4** | **2505** |
| `$A/home/sessions` | 否（cutover 目标根） | **2538** @11:37 | 2505 v0 + 3 v3 + **30 v4** | 未跑 |
| `~/.dsh/sessions`（现役） | 否 | 2512 @11:37 | 2509 v0 + 3 v3 | 未跑 |

> 上表两个"非验证对象"的数字是**带时刻的瞬时读数**（`2026-09-30 11:37:06`）；它们会随时钟漂移
> —— `$A/home/sessions` 在本档作业期间已由 `2524`（协调者较早读数）涨到 `2538`，v4 由 `16` 涨到 `30`。

- 协调者的 **2521** 落在 `$A/home/sessions` 一侧：该根本档实时读数为 **2538**（v4 从 16 涨到 30），
  **原因是 3098 正在把新会话写成 v4 generation 到那个根里**（本档这次子会话本身就跑在 `$A/home` 下）——
  即该根在我们作业期间**持续增长**，2524 是较早时刻的快照。
- 「3 个被遮蔽」的机制与我的实测**完全一致**：同样那 3 个会话目录（`--home-CNS2026495165-RS--/session-d2bc0458…`、
  `--home-CNS2026495165-dsh--/session-7bbd330d…`、`--home-CNS2026495165-dsh--/session-bc0b7655…`）
  同时含 `session.jsonl.zstd`(v0) 与 `session.v3.jsonl.zstd`(v3)，`resolveGenerationInDirectory` 取最高代际 ⇒ v0 被遮蔽，
  这是**正确语义**（`$B/dsh-session-persistence-jsonl/lib/index.js:3326-3358`）。我的 2505 = 2508 − 3 也是同一算法。
- **本档不对 2521 做背书也不做否定**：它不是本档验证对象的数字，本档只对 `p0a/converted/sessions`（= 2505）负责。
  若需 2521 的口径核对，应由协调者在其 cutover 根上单独出具证据（本档未把 `$A/home/sessions` 纳入验证对象，
  也未把它的 v4 文件纳入任何通过率）。

---

## 6. 0.1.1 侧对照解码（工单点名的只读输入）

> **口径声明（采纳协调者意见，本档同意并已就此改写）**：`dsh-session-format-*` 系列是 **0.2.0 才引入**的包，
> 0.1.1 侧没有它们（本档实测其五个符号链接全部悬空，`legacy-011-result.json → formatPackages.*.exists = false`）。
> 因此本节结论**只用于 0.1.1 自己的口径**，属**跨代不可比**：
> - 0.1.1 的事件词汇表、拒因措辞（`SessionFormatUnsupportedError`）与 0.2.0 的 `SessionFormatUnsupportedMigrationError` /
>   `descriptor-version` / `inbox-spliced-sections` **不是同一套判据**，本档**没有**把两代的拒因并列归因或放进同一张表；
> - 本节的用法只有两种，都是**同侧成对比较**（corpus vs converted，两侧都用 0.1.1 解码器），
>   以及「0.1.1 能否读原语料」这一**单侧可解码性**事实；
> - 0.1.1 的 `assistant/chunk = 34,085,630` 与 §4.2 的 0.2.0 展开口径数字相同，只能说明
>   **两套独立实现对同一物理量给出一致读数**（这是佐证，不是互证判据），不构成跨代哈希/事件数的可比性主张。

工单把 `/home/CNS2026495165/.dsh/profiles/node_modules/@deepseek-ai/` 列为「0.1.1 侧对照解码」输入。实测有两点：

1. **`dsh-session-format-*` 五个包在该树里全是悬空符号链接**（`[实跑]`，见 `legacy-011-result.json → formatPackages`），
   指向已不存在的 `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session-format*`
   ⇒ **0.1.1 侧不存在 format-catalog 路径**（该类包由 0.2.0 引入），工单点名的这条入口**按其字面不可用**。
2. 但 0.1.1 的**原生解码器**在 `dsh-session-persistence-jsonl@0.1.1-rc.2` 内，且其 `readZstdPrefix` **不使用 `this`**，
   可用原型调用做真实 0.1.1 侧解码（`readZstdPrefixIsThisFree = true`）。本档据此取得下述**同侧成对**证据。

**全量结果（2508 × 两侧）**：

| 判据 | corpus | converted |
|---|---|---|
| 0.1.1 侧读打开 | **2505 / 2508**（3 份 v3 被拒，0.1.1 只读 v0 —— 预期） | **2505 / 2508**（同一批 3 份） |
| 解码事件总数 | **35,123,307** | **35,123,307** |
| 逐事件类型计数 | — | **0 处不同** |
| `assistant/chunk` | **34,085,630** | **34,085,630** |

**逐份配对（2505 份）**：事件数相等 **2505/2505**；扣除白名单后哈希相等 **2505/2505**；全字段 `raw` 相等 **226/2505**
（= 229 份无修复文件 − 3 份 v3 文件，**完全自洽**）；3 条「未配对」记录经逐条核对**全部是 3 份 v3 文件**（0.1.1 读不了），
非语义差异。

**意义**：① 0.1.1 原生解码器对**原语料 100%（v0 部分）可读**，说明语料本身**没有损坏**，
0.2.0 基线那 2279 份的拒绝是**格式演进**而非数据破坏；② 转换后在 0.1.1 眼里事件序列**逐份不变**，
是独立于 0.2.0 的第二套实现给出的保真背书。

---

## 7. 交付物与复跑说明

- 交付物三项（工单要求）：`verify/verify-v4.mjs`、`verify/per-file.jsonl`（2508 行）、`verify/VERIFY-REPORT.md`（本档）。
- 附赠证据：`summary.json`、`legacy-011-result.json`、`singleframe-result.json`、`reframe-result.json`、`curgen-result.json`、
  以及两个 A/B 抽样根（各 ~101 MB）。
- **可复跑性**：全部模式只读 `corpus/` 与 `converted/`，只写 `verify/`；主验证脚本 375s 全量完成、内存峰值 < 4 GB
  （必须带 `--max-old-space-size=8192`；默认堆上限会在大文件上 OOM）。
- `per-file.jsonl` 每行字段：`rel`、`version`、`bytes`、`frames`、`q3_1`（头部逐字段）、`q3_1b`（分帧无损）、
  `whitelistAudit`（R1/R2 精确计数）、`q3_2`（地标两侧计数 + 差异 + 投影备注）、`q1`（双侧读打开）、
  `q2`（facts 数 + `current`/`transformed` 结果）、`q3_3`（raw/stripped 两套哈希 + 差异路径）、`physical`（真件闸门结果）。

---

## 8. 未验证项

1. **v4 后继的实际落盘与落盘后读回**：`publishStoredMigration` 会写 `converted/**`（越界），故「写打开」只验证到
   `createSessionFormatCatalogWithChildren(...).createRestore(...)` 全链解码完成（`validation` 的 `current` 与 `transformed` 两种口径，
   各 2508/2508），**未**验证 publication 阶段、也未验证发布后 `readStoredLog`/`readZstdPrefix`（current-generation 路径）的读回。
   ⇒ **本项的判据应当是「写打开后应产生 v4 后继（且 `verifyCurrentGenerationInWorker` 通过）」**，
   而不是对只读历史根跑当前代际检查（后者按设计全失败，见 §5.4，**不构成失败**）。
2. **真实实例 mount 整根后的端到端核对**：未起 0.2.0 实例把整个 `converted/sessions` 作为 sessions 根加载并核对 UI 会话列表
   （工单禁止起服务/改 `~/.dsh`）。本档只到「真件函数级入口」为止。
3. **0.1.1 侧对 3 份 v3 文件的解码**：0.1.1 只读 v0，属预期而非缺陷；这 3 份的两侧保真由 0.2.0 侧（Q1/Q2/Q3）覆盖。
4. **并发/写入期状态**：本轮是静态离线验证，未覆盖 `prepareCatalogFacts` 的 `validate()`（mtime/inode 见证）在并发写入下的行为，
   也未覆盖同目录多代文件被并发新增的竞争边界。
5. **`sections: []` 与 `descriptor version 3` 的语义正确性**：本档证明的是「最小补全 + 0.2.0 接受 + 保真不变」，
   「该 snapshot 确实不含任何小节」这一业务断言**未**在上游 0.1.1 侧独立取证（0.1.1 侧 emit 形态的依据引自 BRIEF §2.1 与
   `dsh-taste/lib/learner.js:219`，本档未复跑该 emit 侧）。
6. **单帧 → 分帧后的持久化语义**：修订后 frame#1 承载**全部**事件行（corpus 原本是多帧分批写）。
   读打开与枚举均不受影响（§5.2 实测），但**写入期**「torn final frame 只丢尾部」的粒度由「尾部帧」变成「整个事件体」。
   这是离线一次性转换的耐久性话题，**不构成本轮读/写打开判据的失败**，但建议协调者在 cutover 时知悉。
7. **`$A/home/sessions` 与 `~/.dsh/sessions` 不在本档验证范围内**：本档只对 `p0a/converted/sessions`（2508 份 / 2505 目录 / 2505 枚举）
   负责；这两个根含 3098 实时写入的 v4 产物且持续增长，其**文件数、代际分布与 `listArtifacts` 计数**均未由本档验证（§5.5）。
   协调者的 2521 属该范畴，本档不做背书也不做否定。
8. **0.1.1 侧结论仅限其自身口径（跨代不可比）**：不得与 0.2.0 的拒因/词汇表并列归因（§6 开头声明）。

---

## 9. 结论强度

- **Q1 读打开 100%、转换前 9.13%（229/2508）**：`[实跑]`（真件 `historicalSessionFormatCatalog`，全量 2508）。
- **Q2 写打开 v4 全链 100%（两种 validation 口径）、child facts 2505 份零失败**：`[实跑]`
  （真件 `createSessionFormatCatalogWithChildren` + 真件 `historicalChildCatalogSource`，全量 2508）。
- **Q3-1 头部不变量全等、分帧无损**：`[实跑]`（字节级 + 字段级 + 对象级，全量 2508）。
- **Q3-2 地标计数零差异、`assistant/chunk` 两侧同为 34,085,630**：`[实跑]`（全量 2508），
  并有 0.1.1 原生解码器独立复现同一数字 `[实跑]`。
- **Q3-3 扣除白名单后全量相等、非白名单差异 0**：`[实跑]`（行级 2508/2508；事件级 shim 全量 2508/2508；
  0.1.1 侧 2505/2505）。其中「源侧读打开被拒 2279 份」是 **0.2.0 的既有行为**（`[实跑]`，与 baseline 集合逐一相同），
  不是转换产物的问题。
- **物理布局闸门：修订后真件闸门 2508/2508 通过、`listArtifacts` 2505 = 目录数 2505（零静默跳过）**：`[实跑]`。
- **旧单帧产物会被整根判空**：`[实跑]`（真件 `listArtifacts` → 0；且已用同内容 A/B 在 `verify/` 内可复现）。
- **依赖的官方件行为**：`assertZstdHeaderFrame` 的两处调用点、`listArtifacts` 的静默 `continue`、
  v3→v4 的 child-facts 硬闸、v1→v2 的 chunk 折叠 —— 均为 `[源码]`（行号见 §1 与 §5.1）。
- **§8 清单内的一切**为 `[未验证]`，本档**未**把它们当作通过。

---

## 附：本档**没有**做的事（对照工单纪律）

- 未修改 `convert.mjs` / `scan.mjs` / `framecheck.mjs` / `assembly-020/**` / `reports/**` / `converted/**` / `corpus/**`。
- 未写 `verify/**` 以外的任何路径；未触碰 `~/.dsh/**`、`~/.dsh-017/**`。
- 未起任何服务，未重启 3098/3080/3097。
- 未为了让数字好看而放宽判据：转换前 9.13%、源侧读打开被拒 2279 份、0.1.1 读不了 3 份 v3、
  current-generation 路径 30/30 拒绝，均如实记录；`assistant/chunk` 的投影折叠差异单独标注为「信息性、不参与判据」
  而**没有**从判据中偷偷删除。
- 未把发现到的转换器缺陷自行修掉（物理布局缺陷由协调者修订，本档只复测）。
