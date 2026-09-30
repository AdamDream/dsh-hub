# T21 — 会话数据迁移兼容性「数据面」审计（0.1.x → 0.2.0-rc.1）

- 轨道：T21（会话数据面迁移与无损判据），阶段=审计（只读 + 仅在 `.workspace/**` 内实验）
- 审计时间：2026-09-29（本文件所有数字均为当轮实测）
- 证据脚本（可复跑，均只读）：`.workspace/audit-020/t21/`
  - `survey.mjs`（结构/计数/体积/代际）、`frame-scan-check.mjs`（zstd 帧走查器自证）
  - `chain-probe.mjs`、`children-probe.mjs`、`runtime-probe.mjs`（**运行时忠实**迁移复现）
  - `triage.mjs` / `triage-current.mjs`（行级可解码性＋失败分类；后者 = current 级校验）、
    `attach-probe.mjs` / `attach-shape.mjs`（附件边界）
  - `baseline.mjs`（冻结基线 capture/verify/project/compare）
  - 原始输出：`survey-011.json` `survey-017.json` `chain-011.json` `children-011.json`
    `runtime-011.json` `triage-011.json` `base-017.json` `base-011.json`（现役冻结基线，2.86 MB）
    `proj-011.json`（现役全量逻辑投影）`proj-017-a.json`（隔离根投影，工具链自证）
- 源码依据根：
  - 0.2.0 闭合依赖树 `…/audit-020/t30/full020/node_modules/@deepseek-ai/`（289 包，含全部 format codec）
  - 0.2.0 CLI 包 `…/audit-020/src-020`、`…/workspace/dsh-020-pkg/x/package`

> 本文**不抄录任何会话正文**，不输出原始会话 id / cwd 明文。统计以工作区序号 `wsN` 表示。
> 例外说明：`baseline.mjs` 生成的**基线清单文件**（落在 `.workspace/**`）为"可判定无损"必须含 id 与摘要，属敏感件，不得外传。

---

## 1. 结论摘要

### 1.1 规模（当轮实测）

| 数据根 | 工作区目录 | 会话文件 | lock | 其他 | 总文件 | 总体积 | 代际分布（按文件名） | 代际分布（按头部 version） |
|---|---|---|---|---|---|---|---|---|
| 现役 `~/.dsh/sessions` | 20（`_no-cwd` 为空目录，共 21 个一级目录） | **2456**（采样时刻；20 分钟后已增至 2459） | 3 | 0 | 2459（同上，已增至 2462） | **1 189 107 953 B ≈ 1.107 GiB** | `session.jsonl.zstd` 2453 + `session.v3.jsonl.zstd` 3 | **v0: 2455，v3: 3** |
| 隔离 `~/.dsh-017/sessions` | 6 | **19** | 8 | 0 | 27 | **2 442 471 B ≈ 2.33 MiB** | `session.v3.jsonl.zstd` 11 + `session.v4.jsonl.zstd` 8 | **v3: 11，v4: 8** |

- 历史事实"27 件"= 27 **文件**（19 日志 + 8 lock），已复核；`v3=11 / v4=8` 已复核。
- 现役根在 `survey-011` 采样时刻为 **2456 条日志 + 3 个 lock = 2459 文件**（不是 2453；2 453 是 `session.jsonl.zstd` 单类计数）。
- **采样期间现役根仍在增长（本轨道自身即证据）**：`survey.mjs` 与 `attach-probe.mjs` 读到 2456–2457 条日志，
  约 20 分钟后为核对计数再跑 `find` 已读到 **2459 条日志 / 2462 文件**（+3 条新会话）。
  ⇒ **本文所有现役侧计数都带"采样时刻"语义，不是常量快照**；这正是 §5.3 边界 1 的现场证据。
- **两代的代际语义完全不同**：现役几乎全是 **generation 0 / 格式 v0**（2455/2458），隔离根是 v3/v4。

### 1.2 四条关键结论（按重要性）

**结论 1（最重要，阻断级）：现役会话集中 ≈90.8% 的日志在 0.2.0 下根本无法解码。**
用 0.2.0 真实 format chain 逐行复现（行级，与 child facts 无关）：

| 复现方式 | 脚本 | 语料 | accepted | refused |
|---|---|---|---|---|
| 行级可解码性（`validation:'transformed'`） | `triage.mjs` | 2458 条（`survey-011` 时刻） | **229** | **2229** |
| 运行时忠实（含真实 child-facts 语料） | `runtime-probe.mjs` | 2458 条（同一时刻） | **229**（v0:226 / v3:3） | **2229** |
| 全量逻辑投影（`validation:'current'`，即真实"读打开"口径） | `baseline.mjs project` | **2459 条**（`base-011` 时刻，晚 25 min） | **226**（v0:223 / v3:3） | **2233** |

**最终权威口径 = 全量逻辑投影（`proj-011.json`）**，因为它与运行时的 `read open`（current 级校验）等价。
失败分类 **精确到每条日志**（互斥）：

| # | 失败类 | 条数 | 0.2.0 报错 |
|---|---|---|---|
| F1 | `subagent/descriptor` 版本 2 | **2220** | `SessionFormatUnsupportedMigrationError: subagent/descriptor N uses unsupported descriptor version 2` |
| F2 | **v0 含未登记事件类型 `system/message`** | **3** | `… format v0 contains unknown historical event type "system/message" at seq N` |
| F3 | 真实 seq gap | **6** | `SessionFormatError: released Session row N has seq gap (expected N, got N)` |
| F4 | `agent/inbox/spliced` 畸形 | **4** | `… refuses this format v0 Session: agent/inbox/spliced N inserted message source sections must be an array` |
| | 合计 | **2233** | |

投影成功会话共恢复 **211 373** 个事件；运行时复现（2458 条语料）的输入规模为 `inEvents 2 419 877 → outEvents 216 390`。
⇒ **0.2.0-rc.1 无法打开现役 2233 条会话（90.8%）。这不是环境问题、不是配置问题，
是格式编解码器对该历史数据形态的显式拒绝**，且四类失败互不重叠、各有独立的源码判定点（§3.4）。

**结论 2：拒绝是"fail-closed"而非"静默截断"，因此原数据不会丢，但会"打不开"。**
0.2.0 对不支持的历史形态抛 `SessionFormatUnsupportedMigrationError`，且**不受 `recovery: 'recoverable'` 兜底**
（源码依据见 §3.4：recoverable 只降级 `SessionFormatError`，`SessionFormatUnsupportedMigrationError` 直接抛出）。
配合"读打开不发布后继、写打开才发布 v4 后继、源文件字节不变"（§3.1），
⇒ **迁移不需要搬动数据就能保证不丢；风险只在"可用性"（旧会话在 0.2.0 里打不开），不在"数据完整性"。**

**结论 3：附件门禁的最小关闭动作 = 把 `~/.dsh/attachments/v1` 按同结构复制到新根。**
两代共享**完全相同的存储布局与寻址**：
- 0.2.0 `LocalAttachmentStore`：`root = join(dshHome, "attachments", "v1")`（`dsh-attachment-local/lib/index.js:996`）
- 对象寻址：`normalizedImagePath = join(root, "objects", sha256.slice(0,2), sha256)`（同文件 `:296`）
- `attachmentId` 形状 `sha256:<64hex>`，`ensureReference` 只取 `ref.attachmentId`（`ID_PATTERN = /^sha256:([a-f0-9]{64})$/`）
- 现役实测：`objects/` 982 文件 209 384 193 B、251 个两位分片目录、文件名长度全为 64。
⇒ 会话文件与附件存储是**两个独立根**；只复制会话文件必然 `ATTACHMENT_NOT_FOUND`（历史事实与源码一致）。
**实测覆盖率：现役 47 条日志引用 971 个不同 `attachmentId`，全部 971 个在 store 中命中（missing = 0，命中体积 207 018 587 B）。**
即：**会话↔附件在现役根内部自洽；门禁只需"整目录一并迁移"，不需要任何转换。**

**结论 4：迁移本身是"整根字节复制"，0.2.0 不需要预转换，但必须接受"能复制的 ≠ 能打开的"。**
`dsh-base` 组合把会话根写死为 `root: !!js dshHomePath('sessions')`（`dsh-base/cordis.patch.yml:133`），
附件根写死为 `<DSH_HOME>/attachments/v1`（无配置覆盖），两者都只由 `DSH_HOME` 决定 ⇒ 新隔离根 = 新 `DSH_HOME` + 同结构两份拷贝。

### 1.3 迁移方案一句话

**整根字节复制（会话根 + `attachments/v1`）→ 用冻结基线证明复制无损 → 让 0.2.0 自己按需惰性迁移（写打开时发布 v4 后继、源 v0/v3 文件原样保留）→ 用 `baseline.mjs compare` 证明"能打开的 226 条"逻辑等价。**
不要做预转换：没有任何官方 CLI/API 入口（§5.2 已核实 0.2.0 CLI 无 session 迁移命令），
自造转换器只会把"可回退"变成"不可回退"。

---

## 2. 证据：统计表（计数与体积，无内容）

### 2.1 现役根 `~/.dsh/sessions` 结构（`survey-011.json`）

- 目录深度直方图：`{1: 21, 2: 2453}` + 根 1 ⇒ 布局为 `root/<--projectKey-->/<encodedId>/`，**无扁平文件、无更深层**。
- 文件类型：`session.jsonl.zstd 2453`、`session.v3.jsonl.zstd 3`、`session.lock 3`（lock 全为 0 字节）。
- 分层（layer）：`log:gen v0 = {2453 文件, 1 188 006 150 B}`；`log:gen v3 = {3 文件, 1 101 803 B}`；`session.lock = {3 文件, 0 B}`。
- 头部 `version` 直方图：`v0: 2455`、`v3: 3` ⇒ **文件名代际 = 头部代际**（文件名 `session.jsonl` ⇒ v0），与源码 `sessionFormatLogFilename()` 一致（§3.2）。
- 体积分位（日志文件）：p50 = 261 363 B，p90 = 696 769 B，p99 = 6 117 429 B，max = 22 808 279 B。
- 行数分位：p50 = 279，p90 = 949，p99 = 22 210，max = 90 508。
- 体积分桶：`<100KB 595`、`100KB–1MB 1708`、`1–5MB 115`、`>5MB 38`。
- 时间跨度（`createdAt`）：2026-08-19T06:42:00.442Z → 2026-09-29T08:56:55.353Z（约 41 天）；
  文件 mtime：2026-08-20T06:52:01.612Z → 2026-09-29T09:00:45.352Z。
- 血缘：带 `parentSession` 2227 条，`origin = "subagent"` 2292 条 ⇒ **绝大多数是子代理会话**。
- 头部键形态（top）：`…,origin,parentSession,…` 2218 条；无 `parentSession` 的 158 条；含 `seedLength` 41 条；含新式 `isSeeded` 仅 3 条（都是 v3）。
- zstd 帧：全部 `decodeFailedFrame = null`，`tornStart = null`（0 条撕裂尾部）。
- 行级 JSON 解析：`parseErrors > 0` 的日志 **0 条**。

**工作区分组（按体积降序，workspace 用序号）**

| wsIndex | 文件 | 日志 | lock | 体积(B) | 代际 |
|---|---|---|---|---|---|
| ws0 | 1120 | 1120 | 0 | 504 439 747 | v0×1120 |
| ws1 | 838 | 836 | 2 | 376 960 676 | v0×834 + v3×2 |
| ws2 | 31 | 31 | 0 | 141 312 030 | v0×31 |
| ws3 | 208 | 208 | 0 | 60 173 978 | v0×208 |
| ws4 | 69 | 69 | 0 | 24 997 405 | v0×69 |
| 其余 15 个 | ≤ 55 | ≤ 55 | ≤ 1 | ≤ 17.6 MB | 均 v0 |

共 20 个工作区、0 个纯空工作区（`_no-cwd` 为空目录，不计入 20）。

### 2.2 隔离根 `~/.dsh-017/sessions` 结构（`base-017.json` / `survey-017.json`）

- 目录深度：`{1: 6, 2: 17}` + 根 1；文件 27 = 19 日志 + 8 lock。
- 分层：`log:gen v3 = {11 文件, 1 709 706 B}`、`log:gen v4 = {8 文件, 732 765 B}`、`session.lock = {8, 0 B}`。
- 记录数（含头部行）合计 2625；`torn 0`、`unstableDuringRead 0`。
- 逐工作区（wsIndex，按 27 文件口径）：

| wsIndex | 文件 | 日志 | lock | 体积(B) | 代际 |
|---|---|---|---|---|---|
| ws0 | 10 | 5 | 5 | 53 209 | v4×5 |
| ws1 | 8 | 7 | 1 | 620 925 | v3×6 + v4×1 |
| ws2 | 1 | 1 | 0 | 30 209 | v3×1 |
| ws3 | 4 | 3 | 1 | 1 624 626 | v3×2 + v4×1 |
| ws4 | 2 | 1 | 1 | 17 815 | v4×1 |
| ws5 | 2 | 2 | 0 | 95 687 | v3×2 |

- `session_projcache/sessions/` 6 个 per-record 文档（约 3.7–4.2 KB/条），见 §3.5。

### 2.3 zstd 容器自证（`frame-scan-check.mjs`）

自研精确帧走查器（镜像 0.2.0 `scanZstdFrames` 语义）在隔离根 19 文件 / 235 帧上：
`{"files":19,"totalFrames":235,"torn":0,"okAll":19}` ⇒ 每帧独立解压成功、无撕裂。
**重要**：`zlib.zstdDecompressSync(allBytes)` 只解**第一个帧**（实测 17 530 B → 202 B / 1 行），
必须**按帧切片**或流式才能取到完整 JSONL；任何"整文件一次性解压"的迁移/校验脚本都会静默漏掉 99% 内容。这是本轨道踩到的第一个陷阱。

---

## 3. 文件类型在 0.2.0 的去向判定（逐类 + 源码依据）

| 文件类型 | 0.2.0 是否仍读 | 是否需转换 | 索引 | lock | 处置 |
|---|---|---|---|---|---|
| `session.jsonl.zstd`（gen 0 / 格式 **v0**） | **读**（v0 codec 在册），但对本部署的 v0 日志中 **2220 条逐行拒绝（另有 3 条因 `system/message` 拒绝）** | 不需人工转换；写打开时由 0.2.0 惰性迁移 | 无独立索引；历史 `list()`/`stat()` 需全根扫描（见下） | — | **原样复制，不改** |
| `session.v3.jsonl.zstd`（格式 v3） | **读**，可迁移到 v4（需 child facts 绑定） | 同上，惰性 | 同上 | — | 原样复制 |
| `session.v4.jsonl.zstd`（格式 v4 = 当前） | 直读快路径 | 否 | 无 | — | 原样复制 |
| `session.lock`（0 字节） | **不读**（读者永不触碰） | 否 | 否 | **POSIX flock(2) 的 inode 载体** | **保留**（见 §3.6） |
| `storages/session_projcache*`（投影缓存） | 读，可自愈 | 否 | `compatibleVersions [3,4,5,6]` → 当前 7，老单文件可播种 | — | 复制或直接放弃（**派生态**） |
| `storages/usage/usage.db*` | 由 usage 插件管理（非本轨道） | — | — | — | 建议一并复制（见 §8 未验证项） |
| `attachments/v1/**` | 读，**布局不变** | 否 | 内容寻址，无索引 | — | **必须一并复制**（§7） |

### 3.1 读/写两条路径的语义（`dsh-session-persistence-jsonl/README.md` "Reading the logs"）

> "`open(id,'read'|'write')` selects the highest canonical generation. … For historical input, a read open decodes and migrates the source once, validates the current logical result, and returns it **without publishing a successor**. A write open … then encodes a same-directory temporary file in bounded chunks, verifies it in a Worker Thread, rechecks the source revision, and **publishes the current successor without overwrite** before returning. **The source remains byte-identical.**"

⇒ 迁移的权威路径是**惰性、非破坏、写时升级**。这直接决定无损判据的形态：
原 v0/v3 文件迁移后**必须逐字节不变**（可判定的强判据），新 v4 文件是**新增**产物。

### 3.2 文件名与代际（`dsh-session-format/lib/index.js:462-489`）

```js
const CANONICAL_LOG_FILENAME = /^session(?:\.v([1-9][0-9]*))?\.jsonl$/u;  // 无 .vN ⇒ v0
function sessionFormatLogFilename(version) { return generation === 0 ? "session.jsonl" : `session.v${generation}.jsonl`; }
```
压缩后缀由 persistence 层单独剥离（`dsh-session-persistence-jsonl/lib/index.js:745-775`：
`compressionSuffix = zstd ? '.zstd' : ''`，解析前先 `slice` 掉后缀）。
⇒ 本部署"文件名 `session.jsonl.zstd` = 格式 v0"的判定成立；`parseSessionFormatLogFilename('session.v4.jsonl.zstd')` 返回 `undefined` 属**预期**（后端先去后缀）。

### 3.3 版本支持面（`dsh-session-format-catalog/lib/index.js`）

```js
currentVersion: 4,
codecs: [releasedV0…V4],           // v0..v4 全部在册
migrations: [v0→v1, v1→v2, v2→v3, v3→v4],
```
`createSessionFormatChain.plan(from)`（`dsh-session-format/lib/index.js:132-136`）：
`from > currentVersion` ⇒ `SessionFormatUnsupportedMigrationError("stored Session uses newer format …")`。
⇒ **0.2.0 读 v0/v1/v2/v3/v4 都"在册"；"拒绝"发生在逐行语义校验，不发生在版本分发。**

### 3.4 为什么 2220+ 条被拒（这是本轨道最重要的源码定位）

#### F1 · `subagent/descriptor` 版本 2 —— 2220 条（主因）

`dsh-session-format-v0-to-v1/lib/index.js:1582-1587`：
```js
if (disposition === void 0) throw …(`format v0 contains unknown historical event type ${…}`);
if (event.type === "subagent/descriptor" && data["version"] !== 3) {
  const descriptorVersion = sessionFormatCount(data["version"], …);
  if (version === 0) throw new SessionFormatUnsupportedMigrationError(
    `${event.type} ${event.seq} uses unsupported descriptor version ${descriptorVersion}`);   // ← 命中
}
```
`subagentDescriptorValue()`（同文件 `:1289-1291`）：`literalValue(data["version"], [3], …)` —— **只接受 3**。
现役数据 `descriptorVersionHist = { v2: 2225 }`（`triage-011.json`；投影口径 2220，差值见 §3.4 注）。
**0.2.0 的 v0/v1 codec 不接受 descriptor v2，且迁移链上没有任何边做版本改写**
（v1→v2、v2→v3、v3→v4 中 `subagent/descriptor` 只做透传/登记）。

#### F2 · v0 含未登记事件类型 `system/message` —— 3 条

同文件 `:1582`：
```js
if (disposition === void 0) throw new SessionFormatUnsupportedMigrationError(
  `format v0 contains unknown historical event type ${JSON.stringify(event.type)} at seq ${event.seq};
   migration refuses unknown historical events even when ignorable`);
```
注意末句 **"even when ignorable"**：即使事件带 `ignorable` 标记也照拒。
现役 3 条 v0 日志含 `system/message`，而 v0 disposition 表（`RELEASED_V0_EVENT_DISPOSITIONS`）里没有该类型
（0.2.0 的 `KNOWN_SESSION_EVENT_TYPES` 里有 `system/message`，但那是**当前 v4** 的登记表，不能救 v0 解码）。
⇒ 这是"**新事件类型回填进老格式代际**"造成的代际污染，属**数据面**问题，不能靠升级解决。

#### F3 · 真实 seq gap —— 6 条

`scanRows(recoverable)`（`:1657-1684`）：
```js
if (seq !== eventCount) { const gap = new SessionFormatError(`… has seq gap (expected ${…}, got ${seq})`);
  if (!recoverable) throw gap; issue = gap; if (!packed && decoded.type === "turn/end") throw gap; return; }
```
`recoverable` 下把 gap 记为 `issue` 并**跳过其后所有行直到 `turn/end`**；`strict` 下直接抛错。
实测样本：`expected 57407, got 56933`、`expected 35690, got 33371`（gap 量级 100–500 事件/次）。
⇒ **若用 recoverable 打开，这 6 条会静默丢弃 gap 之后的内容**；必须单独 strict 处理（§6 H3）。

#### F4 · `agent/inbox/spliced.source.sections` 畸形 —— 4 条

v0 codec 要求 `data.inserted[].message.source.sections` 是数组，实测这 4 条不是
（`… inserted message source sections must be an array`）。属结构性畸形，`recoverable` 同样兜不住。

#### 注（三套口径差值的解释）

- `triage`（2458 条）与 `project`（2459 条）的 F1 计数 2225 vs 2220，**由语料时刻不同 + 口径不同共同造成**：
  triage 在**行级**（不跑 v3→v4 边、不跑 current 校验），project 在**完整迁移链**上，
  少数日志在更早的边上就因 F2/F3/F4 失败，不再到达 F1 判定点，故 F1 计数下降、F2/F3/F4 计数上升。**两类失败互斥但优先级由链序决定。**
- `runtime-probe`（229）与 `project`（226）的差：v4 当前格式日志在前者走**静态 catalog**，后者走
  `createSessionFormatCatalogWithChildren(facts)`；两者对 v4 的接受面不同（§3.4-a 的 child-facts 绑定语义）。
  **以 `project`（= 真实读打开口径）为准。**

#### (a) v3→v4 边必须绑定 child facts，否则拒绝
`dsh-session-format-v3-to-v4/lib/index.js:1411-1419`：
```js
createStage() { throw new SessionFormatUnsupportedMigrationError(
  "V3 catalog migration requires explicit historical child facts, including an empty array for a parent without children"); }
```
`dsh-session-format-catalog/lib/index.js:80` 的 `createSessionFormatCatalogWithChildren(children)` 才绑定真实事实；
runtime 由 `prepareCatalogFacts()`（`dsh-session-persistence-jsonl/lib/index.js:2200`）按
`header.parentSession === 父id && origin === 'subagent'` 从**同一语料**里发现直接子代，
读子代自己的 descriptor 得到 `{childId, childCreatedAt, descriptorCount, descriptor}`。
**推论：整根复制天然满足此前提；跨根拆分语料会退化成"unknown 成员"（不阻塞，但丢失子代理模式标签）。**
> 复现对照：`chain-probe.mjs` 用**静态** catalog ⇒ 2458/2458 全部报该错（**100% 假阳性**）；
> `children-probe.mjs` 用 `createSessionFormatCatalogWithChildren([])` ⇒ 隔离根 19/19 通过。
> 因此**任何只调静态 catalog 的迁移校验脚本都是错的**。

### 3.5 索引与缓存

- **会话无独立索引**。`list()`/`stat()` 走"选最高代际 + 只读头部帧"；
  但**历史（非当前）条目**的 revision 需要对整个持久化根做指纹（README "Fingerprinting reads filesystem metadata only"），
  且"Historical `stat` and `list` revisions require metadata work proportional to the root's Session count"。
  ⇒ 2456 条的现役根在 0.2.0 下 `list()` 成本与根规模成正比；**这是可接受的性能代价，不是兼容问题**。
- **投影缓存需要重建/自愈**：`@deepseek-ai/dsh-session-projection-cache` 域 `session_projcache`，
  `version: 7`、`compatibleVersions: [3,4,5,6]`、`layout: 'per-record'`、`invalidRecords: 'backup-and-skip'`。
  语义明确：**"a row is possibly stale but never wrong，write path 全部 fail-soft"** ⇒ 缓存是**派生态**，
  搬不搬都不影响会话历史正确性（最差是一次冷读重放）。
- **老式单文件布局在 0.2.0 有播种路径**：`dsh-storage-json/lib/index.js:293,357`
  "whole-unit file `<root>/<name>.json` (the pre-per-record layout) seeds per-record documents, provided its stored unit version is in the accepted versions"。
  现役 `~/.dsh/storages/session_projcache.json`（7 101 731 B，单文件）**可被 0.2.0 接受并播种**；
  隔离根则是 per-record（`session_projcache/sessions/*.json`）。
  ⇒ 统一迁移`storages/`时，两种布局都能进 0.2.0，但**不要同时放单文件与同名目录**（会歧义）。

### 3.6 `session.lock` 判定：**保留，不丢弃、不重建**

`dsh-session-persistence-jsonl/lib/types/lease.d.ts`：
> "POSIX takes a non-blocking `flock(2)` … on `session.lock` beside the log … Release never removes the POSIX lock file: every acquired lock belongs to a materialized or materializing session, and the surviving file keeps the stable inode later lockers verify against. … **Removing a live session's lock file therefore forfeits exclusion on POSIX**（nothing in the harness does so）… Readers never touch the lock."

- lock 文件 **0 字节、内容无关紧要**，但**存在性 + inode 稳定性**是排除语义的一部分。
- `SessionWriteLease.acquire(dir, id)` 会 `mkdir -p` 会话目录，所以删掉也能重建 —— 但**保留更省事且更安全**。
- 现役仅 3 个 lock（1120/838/31 个会话的 ws0/ws2 无 lock），说明 lock 只在**曾被写打开**的会话目录存在；v0.2.0 不需要"每条会话都有 lock"。
- **处置：`session.lock` 按字节复制（含 0 字节文件），迁移后不从源删除。**

### 3.7 会**拒绝整个根**的两条硬规则（迁移时必须避免）

`dsh-session-persistence-jsonl/lib/index.js:3429-3455`：
1. `listSessionDirs()` 在**工程目录里发现任何扁平文件**（`.jsonl` / `.jsonl.zstd`）⇒
   `legacyLayout` 错误："uses the unsupported flat-file layout; use a separate root or move it into a project/session directory before loading"。
2. `checkRootEncoding()` 逐目录调 `findOppositeGenerationInDirectory`：**同一会话目录里出现另一种压缩后缀**的世代 ⇒ `encodingMismatch`。
   且启动期 `ensureRootEncoding()` 会**遍历整个根**校验。
   README 亦明示："**A root belongs to one encoding** … compression conversion, mixed-root fallback, and dual write remain unsupported"。

⇒ **迁移纪律**：
- 新根**只能有 `.zstd`**，不得混入未压缩 `.jsonl`（哪怕为了"可读备份"也不行）；
- 不要把"迁移后的 v4 文件"以 `compression: 'none'` 写进同一个根；
- 若要留人类可读副本，写到**根之外**（如 `.workspace/**`）。

---

## 4. 迁移方案与命令序列

### 4.1 方案总览（推荐 · 零转换整根复制）

```
源：/home/CNS2026495165/.dsh            （现役 0.1.1-rc.2，3080，正在写）
    ├── sessions/           2456 日志 + 3 lock   1.107 GiB
    └── attachments/v1/     991 对象             201 MiB
             ↓ 字节级复制（不转换、不改名、不改内容）
目标：<NEW_DSH_HOME>/                   （0.2.0 全新隔离根）
    ├── sessions/           同构同字节
    └── attachments/v1/     同构同字节
```

理由（每条都有源码依据）：
1. 0.2.0 的附件根与会话根都由 `DSH_HOME` 派生（`dsh-base/cordis.patch.yml:133`、`dsh-attachment-local:996`）⇒ 换根即隔离。
2. 0.2.0 迁移是**惰性写时升级**，源文件字节不变 ⇒ 今日复制、日后随用随迁，无需一次性大迁移窗口。
3. 226 条可打开的会话里，v0 需要 child facts ⇒ **整根复制天然满足**；跨根拆分会让子代理目录降级为 unknown。
4. 不做预转换 ⇒ 任何"打开失败"都只是可用性问题，**原数据 100% 保留**，可回退。

### 4.2 一致性：活跃写入的会话怎么办

现役 3080 正在写（实测 mtime 到 2026-09-29T09:00Z 之后仍在变）。**无法整体停写**（本轨道不得触碰 3080/3097），
因此采用**两阶段"漂移可判定"复制**：

**阶段 A（冻结基线，只读）**：采集 `baseline.mjs capture`；
每文件读取前后各取一次 `stat`（dev/ino/size/mtimeNs），`stableDuringRead=false` 即记为"读期间被改"。

**阶段 B（复制 + 逐文件复验 + 漂移重取）**：
1. 逐个会话目录 `cp -a` 到目标根；
2. 目标文件 `sha256` 与**同一基线的源 `sha256`** 比对（`baseline.mjs verify` 的 changed 列表）；
3. 对 `missing/changed/unstable` 的条目，**只重取这些条目并再比一次**，直到该批全部稳定（最多 N 轮，本轮建议 3）；
4. 记录最终"漂移集"（迁移期间真正被写入的会话 id），这些会话的**权威内容**以"迁移后源根当前字节"为准，单独做一次单条校验。

**判据**：稳定批内，目标字节 == 源字节 ⇒ 复制无损；漂移集**显式列名**而不是被掩盖。
若需要**绝对原子快照**，唯一干净做法是让 3080/3097 停止写入（本轨道无此权限，属协调者/用户决策，见 §8）。

### 4.3 命令序列（可复制执行）

变量（全部落在允许写入范围内；目标根必须**不在** `.dsh` 与 `.dsh-017` 内）：

```bash
# ---- 0) 变量 ----
SRC=/home/CNS2026495165/.dsh                      # 源（只读）
NEW=/home/CNS2026495165/dsh/.workspace/audit-020/t21/newhome   # 新隔离 DSH_HOME（示例）
W=/home/CNS2026495165/dsh/.workspace/audit-020/t21
TOOLS=$W
```

```bash
# ---- 1) 冻结基线（只读，不改源）----
node $TOOLS/baseline.mjs capture "$SRC/sessions" \
  --manifest=$W/manifest-sessions-before.json --label="sessions-freeze-before-migration"

# 源根文件树指纹（含 lock 与目录结构）
( cd "$SRC/sessions" && find . -mindepth 1 -printf '%y %s %p\n' | LC_ALL=C sort ) > $W/tree-sessions-before.txt
sha256sum $W/tree-sessions-before.txt > $W/tree-sessions-before.txt.sha256
```

```bash
# ---- 2) 复制会话根（字节级、保属性；不转换）----
mkdir -p "$NEW"
cp -a --no-target-directory "$SRC/sessions" "$NEW/sessions"

# ---- 3) 复制附件存储（附件门禁的关闭动作）----
mkdir -p "$NEW/attachments"
cp -a --no-target-directory "$SRC/attachments/v1" "$NEW/attachments/v1"
```

```bash
# ---- 4) 复制派生态（可选但推荐：缓存/用量/工作区索引）----
mkdir -p "$NEW/storages"
cp -a "$SRC/storages/." "$NEW/storages/"        # 含 session_projcache.json / usage/ / workspace.json
# 注意：不要同时放入同名单文件与 per-record 目录（见 §3.5）
```

```bash
# ---- 5) 无损证明（物理层：逐字节）----
node $TOOLS/baseline.mjs capture "$NEW/sessions" \
  --manifest=$W/manifest-sessions-after.json --label="sessions-after-copy"
node $TOOLS/baseline.mjs verify "$NEW/sessions" --manifest=$W/manifest-sessions-before.json
#   → verdict: PASS 表示 missing=0 且 changed=0（extra 允许：迁移后新生成的 v4 后继文件）
( cd "$NEW/sessions" && find . -mindepth 1 -printf '%y %s %p\n' | LC_ALL=C sort ) > $W/tree-sessions-after.txt
diff $W/tree-sessions-before.txt $W/tree-sessions-after.txt && echo "TREE IDENTICAL"
```

```bash
# ---- 6) 附件覆盖证明（每条会话引用的 attachmentId 都能解析）----
# 逐条会话收集 attachmentId，校验目标 store 命中率（脚本只输出计数，不透出 id）
node $TOOLS/attach-probe.mjs "$NEW/sessions" "$NEW/attachments/v1"
#   → 期望：logsWithAttachmentId = 47，distinctAttachmentIds = 971，storeMissing = 0
#     （源侧实测基线：47 / 971 / 0）
```

```bash
# ---- 7) 逻辑层无损判据（只对"0.2.0 能打开的"会话）----
node $TOOLS/baseline.mjs project --manifest=$W/manifest-sessions-before.json --out=$W/proj-before.json
#   0.2.0 在新根首启、写打开若干会话（惰性发布 v4 后继）之后：
node $TOOLS/baseline.mjs capture "$NEW/sessions" --manifest=$W/manifest-sessions-migrated.json
node $TOOLS/baseline.mjs project --manifest=$W/manifest-sessions-migrated.json --out=$W/proj-after.json
node $TOOLS/baseline.mjs compare --a=$W/proj-before.json --b=$W/proj-after.json
#   → verdict: LOSSLESS 需 id 集合相等 + 事件计数相等 + 事件投影摘要相等 + createdAt 相等
```

```bash
# ---- 8) 迁移前后"能打开率"对照（验收指标，不可省）----
node $TOOLS/runtime-probe.mjs "$SRC/sessions" --examples=10 > $W/rt-before.json
node $TOOLS/runtime-probe.mjs "$NEW/sessions" --examples=10 > $W/rt-after.json
#   → 期望：accepted 数不下降；refused 集合不扩大
```

### 4.4 为什么不用 `cp -al`（硬链接）"零成本快照"

`cp -al` 快，但副本与源**共享 inode**，0.2.0 的"写打开发布后继 + append"会**写到源文件里**（POSIX 追加不写新 inode），
直接破坏现役 3080 的会话数据。**禁止**。若确需省空间，只能等源侧真停写后再做（本轨道无权限）。

---

## 5. 冻结基线与无损判据

### 5.1 冻结基线（"不可否认的指纹"）

**两层基线，一次采集**（`baseline.mjs capture`）：

1. **物理层（字节级）**：每个文件 `{rel, size, mtimeMs, dev, ino, mtimeNs, sha256, stableDuringRead}`；
   另加日志文件专属：`frames, tornStart, decodeFailedFrame, decompressedBytes, records, parseErrors`。
2. **逻辑层（结构级）**：每个日志的头部投影
   `{version, id, createdAt, cwd, parentSession, origin, isSeeded, delegationDepth, agentPreset, seedLength, keys}`，
   以及 `eventTypeCount / firstSeq / lastSeq / denseFromZero / duplicateSeq`。
3. **树级**：`find . -printf '%y %s %p\n' | sort` 的清单 + 该清单的 sha256（捕获**空目录**与**目录结构**——文件哈希清单抓不到 `_no-cwd` 这种空目录）。

基线件落 `.workspace/audit-020/t21/`，`kind = dsh-session-freeze-baseline`，含 `capturedAt`（ISO，UTC）。

**已实测**：
- 隔离根 `base-017.json` = `files 27 / logs 19 / locks 8 / bytes 2 442 471 / records 2625 / torn 0 / unstableDuringRead 0`，
  与独立统计（§2.2）**逐项一致** ⇒ 基线工具与人工口径互证。
- 现役根 `base-011.json` = `files 2462 / logs 2459 / locks 3 / bytes 1 197 870 017 / records 2 426 824 / torn 0 /
  unstableDuringRead 0 / versions {v0: 2456, v3: 3}`（采集于 2026-09-29T17:26 前后）。
  **对比 `survey-011`（约 25 分钟前）：+3 条日志、+8.76 MB** —— 现役 3080 仍在写入，
  **这就是"基线只保证采集时刻之后的字节"的现场证据**（§5.3 边界 1）。
- `project` / `compare` 工具链自证：对隔离根投影 19 条 → `ok 17 / bad 2`（2 条 v3 在**空 child-facts** 绑定下
  触发 `system message requires plugin source`，见 §8 第 11 项），自比对 `verdict: LOSSLESS`
  （`idSetEqual true`、`counts.equal 17`、`digests.equal 17`、`headers.equal 17`）⇒ **摘要确定性成立、比较器可用**。

### 5.2 无损判据（**可判定**，分三层，逐层可证伪）

| 层 | 判据 | 判定方式 | 适用对象 | 通过标准 |
|---|---|---|---|---|
| **L1 物理相等** | `sha256(target) == sha256(source)` 且 `size` 相等 | `baseline.mjs verify` | **被复制的一切文件**（含 lock、附件对象） | `missing=0 && changed=0`；`extra` 允许（新 v4 后继） |
| **L2 结构相等** | 会话 id 集合相等；`records` 相等；第一帧记录数相等；`decodeFailedFrame` 不变；`stableDuringRead=true` | `verify` + `compare --a/--b`（capture manifest 亦可直接比） | 全部日志 | id 集合**双向**包含（`onlyInA=onlyInB=0`）；`records` 差集为空 |
| **L3 逐键深度相等（全量投影）** | 把源与目标**都**用 0.2.0 归一到逻辑层：`createSessionFormatCatalogWithChildren(childFacts).createRestore(header,{recovery:'recoverable',validation:'current'})` → `artifact.events` 按 `{seq,type,time,data}` 序列化取 sha256 | `baseline.mjs project` + `compare` | **0.2.0 能成功 restore 的会话**（源 226 条） | `eventDigest` 全等 + `eventCount` 全等 + `inheritedEventCount` 全等 + `createdAt` 全等 |
| **L3′ 投影等价（缩水版）** | 至少：`eventCount` 相等 + 事件类型直方图相等 + `firstSeq/lastSeq` 相等 | 同上（`typeHistogram` 字段） | 同上 | 直方图逐键相等 |
| **L4 可打开率不倒退** | 源可打开集合 ⊆ 目标可打开集合 | `runtime-probe.mjs` 前后对照 | 全量 | `acceptedAfter ≥ acceptedBefore` 且 `refusedAfter ⊆ refusedBefore` |

**L3 的形参化处理（唯一语义解释）**：
0.2.0 对 `sourceEventSeqs` 的物理表示做了**无损压缩**（README："consecutive runs of at least three sequence numbers become `[start,end]` pairs … reading expands the exact in-memory array"）。
因此**物理 JSON 文本必然不等**；判据必须建立在"**同一 codec 归一后的逻辑数组**"上——
即：`project(source)` 与 `project(target)` 都经 0.2.0 restore 后比较，而不是比较原始 JSONL 行。这是"投影等价"的严格形式。

### 5.3 基线本身的边界（必须写进验收口径）

1. **只保证采集时刻之后的字节不变**：基线是**某次扫描的采样**，不是文件系统快照。
   `stableDuringRead` 只能证明**单文件读取前后同一 revision**，不能证明"全根某一瞬间一致"。
   全根一致的严格快照**要求源侧停写**（本轨道无权限）。
2. **对活跃写入只给"漂移可判定"**：`stableDuringRead=false` 的文件（本轮源侧实测 0，但采集期间 3080 在写，属**采样占优**）必须**列名并重采**，不得算作通过。
3. **基线不覆盖被排除项**：README 明确"lock files and retained unselected generations do not contribute"于历史 revision 指纹。
   我们的 L1 比 README 的指纹更严（含 lock、含被保留的旧世代），这是**有意加严**；
   但反过来说，**0.2.0 自己不会因为 lock 或旧世代变化而认为会话变了**——两者语义不同，不可互相替代。
4. **基线不含附件**（除非另采）：`baseline.mjs` 只吃会话根。附件需另跑一次（或扩展脚本），
   L1 判据同样适用（`objects/<2hex>/<64hex>` 内容寻址，天然自校验：文件名即内容 sha256）。
5. **基线件本身是敏感物**：含会话 id / cwd / 摘要。落 `.workspace/**`，不进仓库、不外传。
6. **基线不能证明"可用"**：L1–L3 全过也**不等于**0.2.0 能打开（结论 1 的 2233 条就是反例）。可用性必须由 L4 单独判定。

---

## 6. 高风险会话识别与逐类处置

| # | 类别 | 实测规模 | 风险 | 处置 |
|---|---|---|---|---|
| H1 | **含 `subagent/descriptor` v2 的 v0 会话** | **2220 条**（占 90.2%） | **0.2.0 永久拒绝**；不可恢复（recoverable 不兜），且不支持任何迁移边 | **A 档（阻断）**。①原样保留（数据在）；②可选离线"降级副本"（见 §6.1）；③在 0.2.0 UI 中这批会话会呈现打开失败 —— 必须事先告知用户 |
| H1b | **v0 日志含未登记的 `system/message` 事件** | **3 条** | 同 A 档：`format v0 contains unknown historical event type "system/message"`（**"even when ignorable"** 也拒） | **A 档（阻断）**。属"新事件类型回填进老代际"的代际污染；**升级不能解**。处置：原样保留 + 单列；若必须可读，只能在副本上**把该事件整行移出**并重排 seq（同 §6.1 纪律），原始日志不动 |
| H2 | **`agent/inbox/spliced.source.sections` 畸形** | **4 条** | 同上，属真数据畸形 | 原样保留；这 4 条建议单列，**离线只在副本上修结构**后重试，源不动 |
| H3 | **真实 seq gap**（v0 packed 行导致的 gap 不算） | **6 条**（运行时复现可见：`expected 57407, got 56933` 等） | `recoverable` 会**静默丢弃 gap 之后的内容**直到 `turn/end`；`strict` 会抛错 | **指定 strict 处理**：这 6 条**禁止用 recoverable 静默通过**；先离线定位 gap 是否可解释（是否有未落盘的 batch），再决定"人工接受截断"或"放弃该条" |
| H4 | **多代际混存**（同一会话目录同时有 v3 与 v4） | 隔离根实测存在（ws1、ws3 各有 v3+v4 同源对：如 552 482 B/v3 与 553 032 B/v4，均 696 事件） | 0.2.0 选**最高代际**；低代际作为"保留的旧世代"不参与指纹。这**不是**压缩混用（同后缀），故不触发 `encodingMismatch` | 整目录复制；**不要**删低代际（"retained predecessors do not provide automatic fallback"——留着不能降级，但删了就永久没了；留着的成本只是体积） |
| H5 | **超大会话** | `>5MB: 38 条`，max 22 808 279 B（90 508 行） | 0.2.0 迁移是"bounded chunks + Worker Thread 校验 + 流式 1 MiB 切片"；单条 22 MB 可承受，但**迁移耗时会明显**，且 `list()` 语义下历史 revision 需全根指纹 | 复制不特殊处理；**验收时对这 38 条单独计时**，并在迁移时优先打开（把长尾成本前置暴露） |
| H6 | **撕裂尾部（torn frame）** | 实测 **0 条**（`tornStart=null` 全覆盖；帧走查 235/235 帧可解） | 若未来出现：0.2.0 只采纳**完整解码的 JSONL 记录**，写打开会 `truncateTornTail` 后重写恢复记录 | 当前**无需处置**；但迁移脚本必须**保留 tornStart 字段**（基线已含），以便未来回归时能识别 |
| H7 | **子代指向根外父代（跨根孤儿）** | 隔离根 `childFactWarnings = 7` 条子代其父不在该根内 | 不会阻塞；父侧目录会缺 "unknown 成员"标签（"Missing … descriptors likewise produce unknown-mode membership without inventing a label"） | 若要求子代理目录完整，**必须把父会话一起迁入同一根**（整根复制天然满足）；单独搬子代需显式接受标签缺失 |
| H8 | **`session.lock` 缺失/残留** | 现役仅 3 个 lock；隔离根 8 个 | 缺失不阻塞（`acquire` 会建目录）；**删除存活会话的 lock 会丧失 POSIX 互斥** | 整目录复制（含 lock）；**迁移后不从源删除** lock |
| H9 | **扁平旧布局 / 混压缩** | 当前两根源均**无**（实测 0 例） | 一旦引入即**整根拒载**（`legacyLayout` / `encodingMismatch`） | 纪律：新根只放 `.zstd`；人类可读副本写根外 |
| H10 | **`_no-cwd` 空目录** | 现役 1 个（0 文件） | 文件哈希清单抓不到空目录 ⇒ "目录结构丢失" | 用 §5.1 的**树清单**兜住；`cp -a` 保留空目录 |

### 6.1 H1 / H1b 的"降级副本"（可选，风险与代价明确）

`subagent/descriptor` 事件的语义是**UI/子代理模式元数据**（`{mode, version, provider, label, agentProvider, agentModel, …}`），
不是对话内容；`system/message` 同理属系统注入类事件。理论上可以造一份"移出这些行"的副本让 0.2.0 能读。
但**本轨道判定：不推荐作为默认动作**，理由：
- 必须**从 v0 物理行层面**（zstd 帧 + JSONL 行）删除，绕过 codec（codec 在读之前就抛）；
- 删行后要**重编 seq 密度**（codec 要求 `seq === eventCount` 密排），否则触发 gap 逻辑；
- 失去 `subagent/catalog` 的证据 ⇒ 子代理目录退化为 unknown；
- **任何上述步骤出错都可能产出"看似成功但内容缺失"的日志**，违反"数据无损"。

**若必须做**（用户明确要"尽量能打开"），执行纪律：
①只在 `.workspace/**` 的副本上做；②做完必须跑 L3 全量投影比对（§5.2），
`eventCount` 必须等于"原行数 − 被删 descriptor 行数"且**逐条可解释**；
③产出物**不能**覆盖源文件、不能放进同一个根（否则新旧并存会混淆语义）；
④在报告里逐条列出被删事件数。**本轨道不实施，仅给方案。**

---

## 7. 附件（attachment）引用边界与最小关闭动作

### 7.1 0.2.0 的判定（源码）

- 引用形状：`ImageAttachmentRef { attachmentId, mediaType, bytes, width, height, name?, originalDimensions? }`
  （`dsh-attachment/lib/types/types.d.ts`）；`attachmentId` 是 `sha256:<64hex>` 的**不透明存储标识**。
- 解析：`ensureReference(ref)` 用 `ID_PATTERN = /^sha256:([a-f0-9]{64})$/` 校验后**只取 hash**；
  路径 `join(root, "objects", sha256.slice(0,2), sha256)`（`dsh-attachment-local/lib/index.js:296`）。
- 存储根：`root = join(resolveDshHome(config.dshHome), "attachments", "v1")`（同文件 `:996`）——**两代同形**。
- 缺失语义：`readImageFile()` 捕获 `ENOENT` ⇒ `AttachmentError("Attachment object is missing.", "ATTACHMENT_NOT_FOUND")`（`:602`）；
  文件流同理 `:738`。**只影响"读取/投影"，不影响会话日志本身**。
- 请求版本缓存：`cacheRoot = dshCachePath({dshHome}, "attachments")` ⇒ `<DSH_HOME>/cache/attachments`；
  `<root>/request-images/<hash.slice(0,2)>/<hash>`（`:813`）——**纯派生态，可重建**。

### 7.2 迁移边界判定

| 复制内容 | 结果 |
|---|---|
| **只复制会话文件** | 会话历史可读；但消息里的图片引用解析失败 ⇒ 分页/附件投影时报 `ATTACHMENT_NOT_FOUND`（**与历史事实一致**）。未见内容损坏（因为缺失是**读取期**错误，日志字节未被改写） |
| **会话 + `attachments/v1`** | **完整**。引用 → 对象路径逐字节对齐，无需转换 |
| **会话 + `attachments/v1` + `cache/attachments`（request-images）** | 完整且省一次重算；`request-images` 可省（可重建） |
| **只复制 `attachments/v1` 不复制会话** | 孤儿对象，无害但占空间 |

**现役实测（`attach-probe.mjs`）**：
- 扫描 2456 条日志（本探针在**物理行层**工作，被 `subagent/descriptor` v2 拒绝的日志同样被完整计入，故覆盖无偏）→ **47 条含 `attachmentId`**，**971 个不同 attachmentId**，跨日志引用 982 次。
- store 对照：**storePresent = 971 / storeMissing = 0**，命中体积 **207 018 587 B**；对象尺寸 p50 126 738 B、max 2 401 249 B。
- store 布局：`objects {982 文件, 209 384 193 B}`、`request-images {9, 1 796 136 B}`、`tmp {0, 0}`、`file-objects` **不存在**（⇒ 本部署从未产生 verbatim 文件类附件）。
- 引用出现位置（结构，无内容）：`<data.message.content[].content[].attachment>`（tool/result，979 次）、
  `<data.inserted[].content[].attachment>`（agent/inbox/spliced）、`<data.content[].attachment>`（user/message）。
- 附带上限复核（0.2.0 默认）：`maxMessageImageBytes = 209 715 200`，实测最大单图 2 401 249 B ⇒ 远低于阈值；`mediaTypes` PNG/JPEG/WebP/GIF 覆盖常见类型（**未逐文件验 mediaType**，见 §8）。

### 7.3 关闭该门禁的**最小动作**（结论）

> **最小动作 = `cp -a "$SRC/attachments" "$NEW/attachments"`（保持 `attachments/v1/objects/<2hex>/<64hex>` 结构），并在迁移验收里跑一次"引用↔对象"覆盖检查，要求 `storeMissing = 0`。**

不需要：转换、重命名、重建索引、迁移 request-images 缓存、改写会话里的引用。
**唯一前提**：新根的 `DSH_HOME` 即新根（因为附件根无配置覆盖项，只能随 `DSH_HOME` 走）。

---

## 8. 未验证项（显式标注）

1. **`sessions` 根是否可被 profile patch 覆盖**：`dsh-base/cordis.patch.yml:133` 写死 `root: !!js dshHomePath('sessions')`，
   理论上用户 profile 的 `cordis.patch.yml` 可按 id 覆盖 `session-persistence-jsonl.config.root`。
   **未实测**（不得启动监听端口）。若需"只搬会话不动别的东西"，这是唯一入口，需在 T25 隔离启动时验证。
2. **0.2.0 Web/CLI 在遇到 2233 条不可读会话时的用户可见行为**：是"列表中隐藏"（README：不可读头部会从 discovery 与 `list()` 中省略）
   还是"列表可见但打开报错"。**未实测**（不得发起模型请求、不得起服务）。建议并入 T25 验收项。
3. **`agent/inbox/spliced` 那 4 条的具体畸形层级**：0.2.0 codec 报 `source sections must be an array`，
   但我们独立的键路径扫描 `splicedBadRows = 0`（可能字段在 `inserted[].message.source.sections` 之外的等价位置）。
   **未定位到具体键路径**，需单独 dump 这 4 条的结构（仅键）。属本轨道未判定项。
4. **6 条真实 seq gap 的成因**：无法从只读数据判定是"未落盘批次"还是"packed 行语义差异"。
   需要对着 0.1.1 的写路径源码复盘（不在本轨道范围）。
5. **`storages/usage/usage.db`（72 MB）+ `workspace.json` + `message_feedback.json` 在 0.2.0 的兼容性**：
   属其他数据面（非 `sessions/**`），本轨道**只清点未判定**。建议由 T19/T31 或单独轨道覆盖。
6. **`dsH_home/cache/` 目录的现存内容**：`~/.dsh` 下未见到 `cache/`（0.2.0 附件请求缓存根）；
   未确认为"从未产生"还是"在别处"。**未验证**。
7. **每个附件对象的 `mediaType` 与字节是否仍然自洽**（0.2.0 `readImageFile` 会校验）：
   仅按 `attachmentId` 做了存在性覆盖（971/971），**未逐对象做媒体类型/像素校验**（那需要解码图片，代价与风险都高）。
   若要更严的附件验收，建议加一条"逐对象 `sha256(file) == 文件名`"的校验（内容寻址自证，零解码成本）——
   本次**未跑**（但由 0.2.0 的寻址方式可推知其为充要）。
8. **活跃写入下"全根一致快照"**：未实现（需要源侧停写）。本轮只提供"漂移可判定 + 漂移重取"。
9. **`session_projcache.json` 单文件被 0.2.0 播种的实测**：源码注释明确支持（`dsh-storage-json/lib/index.js:293,357`），
   但**未在隔离根实跑**。
10. **真实会话 id / cwd 未出现在本报告中**（纪律要求）；如需逐条对照，请使用 `.workspace` 内的 manifest 文件，勿外传。
11. **child-facts 绑定对"事件合成"的影响面**：实测在**空 child-facts** 下，隔离根 2 条 v3 日志投影失败于
    `SessionFormatError: system message requires plugin source`（`proj-017-a.json`），
    而同一批日志在 `triage-current.mjs`（`validation:'current'` 但走**整根行级**路径）下全部通过。
    ⇒ v3→v4 的 `system/message` 合成**取决于绑定到的 child catalog**。
    **未判定**：真实 runtime 对"父在根内但子不在"的语料会合成出什么、是否会触发同一错误。
    这直接影响迁移的语料完整性要求（§3.4-a），**建议并入 T25 用真实隔离根实测**。
12. **`base-011.json` / `proj-011.json` 是"某一时刻"的现役语料**（采集期间 3080 在写）；
    之后的会话不在这两份基线里。**任何"迁移后比对"都必须重新采集目标侧清单，并只比对基线的 id 集合**（§5.2 L2）。

---

## 9. 给协调者的裁决建议

| 项 | 建议 | 依据 |
|---|---|---|
| **迁移是否可行** | **可行，且数据无损可证**；但**"旧会话可用"只对 226/2459 成立（90.8% 打不开）** | §1.2 结论 1、结论 2 |
| **是否要做预转换** | **不做**。走"整根复制 + 0.2.0 惰性迁移" | §3.1、§4.1；无官方迁移入口 |
| **2233 条不可读会话** | 视为**已知可接受损失（可用性损失，非数据损失）**，在用户沟通里显式列出；若要抢救，按 §6.1 的纪律做**副本级**降级 | §3.4 F1/F2、§6.1 |
| **附件** | 必须整目录迁移；验收加 `storeMissing = 0` | §7.3 |
| **验收门槛** | L1（字节）+ L2（结构）+ L3（逻辑投影，仅 226 条）+ L4（可打开率不倒退）+ 附件覆盖率 | §5.2 |
| **是否需要停写窗口** | 严格无损证明**需要**（否则只有"漂移可判定"）；若用户要求"绝对无损"，请安排 3080/3097 短停 | §5.3 边界 1 |
| **对用户需求的直接回答** | 用户要求"**数据无损、旧会话可用**"：**前半条 100% 可达成（字节复制 + 基线可证）**；**后半条只能达成 9.2%（226/2459）**。建议**明确区分**"数据无损（保证）"与"旧会话可用（受限）"两件事向用户报备，不要合并表述 | §1.2 结论 1/2、§5.2 |
| **本轨道是否需要追加实测** | 需要两项，均属隔离侧（不影响 3080/3097）：①真实 0.2.0 隔离根上验证 226 条的打开与投影（§8-11）；②对 2220 条 F1 会话做一次"离线降级副本"的**可行性小样**（只做 3–5 条，不进产品） | §8、§6.1 |

---

*本报告全部数字来自当轮实测脚本输出；未实测项已在 §8 显式标注。*
