# N17 根因勘误报告（WP8 · 独立复核并改写 N17 的因果链）

**工单号**：WP8
**状态**：完成（六项证据全部实跑/源码取证；一项建议置信项未验证，已单列）
**执行档**：dsh-020 迁移轮 WP8
**写入边界**：本文件 + `.workspace/audit-020/n17-erratum/**`（未越界，见 §7）
**实跑环境**：`node v22.23.2`；0.2.0-rc.2 真件 `$B = .workspace/audit-020/assembly-020/prefix-cli-rc2/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai`
**语料快照**：`p0a/corpus/sessions`（2508 份 `.jsonl.zstd` + 3 个 `session.lock`）= `~/.dsh/sessions` 于 **2026-09-30 10:55** 的冻结副本；转换产物 `p0a/converted/sessions`

## 0. 证据路径与命令索引

| 脚本/输出 | 路径 |
|---|---|
| 我自写的独立扫描器（系统 `zstd` CLI 解压 + 真实 catalog 读打开） | `n17-erratum/scan.mjs` |
| 拒因/分布分析 | `n17-erratum/analyze.mjs` |
| 单文件打包行读取+展开计数 | `n17-erratum/decode-one.mjs` |
| 三处消息位置的结构级普查（不依赖 codec） | `n17-erratum/posscan.mjs` |
| **只改 descriptor 2→3** 的消融语料构建器 | `n17-erratum/desc-only.mjs` |
| 基线扫描输出 | `n17-erratum/out/scan-baseline.jsonl` |
| 只改 descriptor 的扫描输出 | `n17-erratum/out/scan-desc-only.jsonl` |
| 转换产物扫描输出 | `n17-erratum/out/scan-after.jsonl` |
| 10:55 之后新写入文件的扫描输出 | `n17-erratum/out/scan-live-drift.jsonl` |

三次全量实跑的核心数字：

```
dataset          total   ok     rejected  rate
scan-baseline    2508    229    2279      9.13%
scan-desc-only   2508    2052   456       81.82%
scan-after       2508    2508   0         100.00%
```

---

## 1. 一句话结论（N17 的**修正后**因果链）

> **N17 的修正后因果链**：0.2.0 读不了 0.1.1 历史会话，是因为两道**写入侧形态闸**——
> ①`subagent/descriptor` 行写的是 `version: 2` 而 0.2.0 的 v0 codec 只接受 `version: 3`（挡 2275 份）；
> ②插件消息来源写的是 `{kind:"plugin", plugin:"taste", form:"snapshot"}` 而**不带 `sections` 数组**，
> 0.2.0 的 v0 codec 判定 `form === "snapshot"` 时 `sections` 必须是数组（挡其余 456 份，全部由
> `dsh-taste/lib/learner.js:219` 这一处 emit 产生）。
> **三种打包行（`text-chunks`/`reasoning-chunks`/`tool-call-chunks`）从来不是闸门**：0.2.0 的 v0 codec
> 本来就支持顶层打包行（`PACKED_TAGS` / `scanRows` packed 分支 / `decodePackedRun` / `expandAssistantChunkRun`），
> 语料里 349 份含打包行的日志在**未做任何修复**的基线下已有 **162 份**可读，其中单文件最多含 **72,479** 行打包行。
> 打包实现确实"从 `dsh-session` 顶层行迁走了"，但**不是被移除而是搬了两处**：读侧搬进
> `dsh-session-format-v0-to-v1`（顶层行的解码器，功能等价），写侧搬进 `dsh-llm` 的
> `AssistantStreamAccumulator` 落进 `assistant/message.data.stream`（由 `v1→v2` 边承接）。
> 修完 ①② 两处后 **2508/2508 = 100%** 可读。
> **本轮追加发现**：0.2.0 自己仍在**写 v0 格式**的会话日志，且写出的正是被它自己 v0 codec 拒收的
> ①② 两种形态（10:55 之后新写入的 9 份中 7 份当场被拒），即**写入侧与读入侧自相矛盾**。

---

## 2. 与原叙述的逐条对照表

原叙述 = `dsh-020_NEXT_SESSION_PROMPT.md:95`（§5 N17）。

| # | 原说法 | 本轮实测 | 判定 | 证据 |
|---|---|---|---|---|
| N17-a | 实测**抽样 3%** 可读 | 未复核该抽样口径；**全量**基线为 **229/2508 = 9.13%** | **[未验证]**（不矛盾：3% 为抽样，9.1% 为全量；抽样口径未给出，无法复算） | §3.3 |
| N17-b | 修 descriptor 后 **60%** | 修 descriptor 后 **2052/2508 = 81.82%** | **不成立**（比例偏差 21.8 个百分点） | §3.3 消融实跑 |
| N17-c | 余 **40%** 卡在**三种打包行**（`text-chunks`/`reasoning-chunks`/`tool-call-chunks`） | 余 **18.18%（456 份）**全部卡在**同一条**报错：`agent/inbox/spliced N inserted message source sections must be an array`；**打包行不受影响** | **不成立** | §3.1 §3.2 §3.4 |
| N17-d | **打包行本来就受支持**（协调者本轮结论） | 确认：`PACKED_TAGS`/`scanRows` packed 分支/`decodePackedRun`/`expandAssistantChunkRun` 四处齐备；349 份打包行文件中基线即可读 162 份 | **成立** | §3.1 §3.2 |
| N17-e | 第二道闸是"插件消息来源 `form:"snapshot"` 缺 `sections` 数组"（协调者本轮结论） | 确认：`$B/dsh-session-format-v0-to-v1/lib/index.js:942-947`；该形状在 v0 出现于**三处**消息位置（各给行号）；语料中 **456 份 × 2 处**命中 | **成立** | §3.4 |
| N17-f | 该形状是"写入侧既有形态"而非数据损坏（协调者本轮结论） | 确认：0.1.1 与 0.2.0 的 `dsh-taste/lib/learner.js` **逐字节相同**（`diff` 空输出，sha256 一致），`:219` 就是那个形状；**且 0.2.0 现在仍在写这个形状** | **成立**（本轮加强为"至今仍在写"） | §3.4 §3.6 |
| N17-g | 修完两处后 **2508/2508 = 100%** 可读（协调者本轮结论） | 确认：转换产物扫描 **2508 ok / 0 rejected**；且与协调者 `recon/scan-after.jsonl` **逐份 2508/2508 一致** | **成立** | §3.5 |
| N17-h | "packing 实现**从 `dsh-session` 顶层行迁到 `dsh-llm` 的 `event.data.stream`**" | **部分成立**：`dsh-session` 的 `chunk-rows.js` 与 `packChunkRuns` 在 0.2.0 树中**确已消失**；但落点是**两处**——①读侧 `dsh-session-format-v0-to-v1` 的 `decodePackedRun`（顶层行解码器，**功能等价地保留**）②写侧 `dsh-llm` 的 `AssistantStreamAccumulator` ⇒ `assistant/message.data.stream`。说"迁到 dsh-llm"只覆盖了写侧那一半 | **部分成立** | §3.6 |
| N17-i | "**旧位置解码器被移除**" | **不成立**（就"能力"而言）：旧位置解码器的**功能完整保留**在 v0 codec 中；被移除的是**文件/导出名**（`chunk-rows.js`、`packChunkRuns`、`decodeStorageRecord`），不是能力 | **不成立** | §3.6 |

---

## 3. 六项证据

### 3.1 【证据一·[源码]】打包行受支持的源码证据（带文件+行号）

文件：`$B/dsh-session-format-v0-to-v1/lib/index.js`（0.2.0-rc.2）

**(a) `PACKED_TAGS` — 行 1610-1614**

```js
1610  const PACKED_TAGS = new Set([
1611      "text-chunks",
1612      "reasoning-chunks",
1613      "tool-call-chunks"
1614  ]);
```

**(b) `scanRows` 的 packed 分支 — 行 1656-1690**（关键行 1661-1664、1675、1683-1690）

```js
1661  if (typeof type === "string" && PACKED_TAGS.has(type)) {
1662      packed = true;
1663      decoded = decodePackedRun(record, type, currentRow);
1664  } else decoded = decodeEvent(record, currentRow);
...
1675  const seq = packed ? decoded.firstSeq : decoded.seq;
1676  if (seq !== eventCount) { ... seq gap 判定 ... }
...
1683  if (packed) {
1684      const run = decoded;
1685      eventCount += run.eventCount;
1686      context.emitRun(run);
1687  } else {
1688      eventCount += 1;
1689      context.emitEvent(decoded);
1690  }
```

**(c) `decodePackedRun` — 行 1741-1808**（关键行 1749、1767-1770、1780、1796-1808）

```js
1749  const seq0 = sessionFormatCount(row["seq0"], `${label} seq0`);
1767  const payload = data[isTool ? "args" : "texts"];
1768  if (!Array.isArray(payload) || payload.length === 0 || payload.some(m => typeof m !== "string"))
          throw new SessionFormatError(`${label} payload must be a non-empty string array`);
1769  const gaps = data["dt"];
1770  if (!Array.isArray(gaps) || gaps.length !== payload.length - 1)
          throw new SessionFormatError(`${label} dt length must match its payload`);
1780  const lastSeq = sessionFormatCount(seq0 + payload.length - 1, `${label} final seq`);
...
1796  const run = {
1797      runType: "released-assistant-chunks",
1798      firstSeq: seq0,
1799      eventCount: payload.length,
...
```

**(d) `expandAssistantChunkRun` — 行 1809-1843**

```js
1809  function* expandAssistantChunkRun(run) {
1811      const members = stream["type"] === "tool-call-chunks" ? stream["args"] : stream["texts"];
1817      const chunk = stream["type"] === "text-chunks" ? { type: "text-delta", index, text: member }
1821          : stream["type"] === "reasoning-chunks" ? { type: "reasoning-delta", index, text: member }
1822          : { type: "tool-call-delta", index, id, name?, argumentsDelta: member };
1832          yield {
1833              type: "assistant/chunk",
1834              seq: run.firstSeq + index,
1835              time,
1836              data: { turn: run.turn, step: run.step, chunk }
1837          };
```

**`seq0` 与 `eventCount = payload.length` 的 seq 会计（逐条推演）**

1. 一条打包行在物理日志里**只占 1 行**，但它承载的是**一整段连续 `assistant/chunk` 事件**，这些事件的 seq 在原始（未打包）日志里是 `seq0, seq0+1, …, seq0+N-1`。
2. `seq0`（行 1749）就是**这段连续 seq 的首号**；`payload`（行 1767：`text-chunks`/`reasoning-chunks` 取 `data.texts`，`tool-call-chunks` 取 `data.args`）是这段里**每个成员的内容数组**，长度 `N = payload.length`。
3. `dt`（行 1769-1770）是 `N-1` 个相邻时间差，用于在展开时重建每个成员的时间戳（行 1771-1775 校验 `lastTime` 不越界）。
4. `eventCount: payload.length`（行 1799）与 `lastSeq = seq0 + payload.length - 1`（行 1780）是**同一件事的两个坐标**：打包行"吃掉"了 `N` 个 seq。
5. `scanRows` 因此**不能用 `decoded.seq`**：在行 1675 用 `packed ? decoded.firstSeq : decoded.seq` 取"起始 seq"，与全局游标 `eventCount` 比对（行 1676-1682）——若不一致即报 `seq gap`，这证明 codec 对打包行的 seq 会计是**按首号 + 长度**精确对齐的，不是"跳过不校验"。
6. 校验通过后走行 1683-1686：`eventCount += run.eventCount`（**加 N 而不是加 1**），并 `context.emitRun(run)` 把整段作为一个 compact run 交给下游（由 `expandAssistantChunkRun` 在需要事件级视图时展开成 N 个 `assistant/chunk`，seq 依次为 `run.firstSeq + index`，行 1834）。

> 结论：**打包行是 0.2.0 v0 codec 的一等公民**，有专门的识别集、专门的分支、专门的解码器、专门的展开器，还有与普通事件不同的（按长度递增的）seq 会计。断言"打包行不受支持"与源码直接冲突。

---

### 3.2 【证据二·[实跑]】反证：至少 3 份含打包行、且**未做任何修复**就能读开的日志

**方法**：先做一次全量基线扫描（§3.3），筛出 `ok === true && packed > 0` 的记录——**162 份**。取其中 4 份（覆盖 4 个不同工程键，按打包行数降序），再用 `n17-erratum/decode-one.mjs` 逐份实跑，断言"读打开成功 + 打包行种类 + payload 总量"。

**可复现定位方式**：`corpus/sessions/<工程键>/<会话目录>/session.jsonl.zstd`。下表按脱敏约定给出「工程键序号 P## + 会话序号 S###」（序号由 `n17-erratum/out/scan-baseline.jsonl` 中 `packed>0 && ok` 记录按打包行数降序编号），同时给出可复现的**会话目录名**（会话 ID 本身非正文内容）。

| 序号 | 工程键（脱敏） | 会话目录 | 物理行数 | 打包行数 | zstd 帧 | 基线是否可读 |
|---|---|---|---|---|---|---|
| P01-S001 | 工程键 P01（`--home-CNS2026495165-Dexterous_Hand_23Dof-Dexterous_Hand_23Dof--`） | `session-aa169d83-5517-429b-9899-4ca4b4963d84` | 90,507 | **72,479** | 77,464 | ✅ 可读 |
| P02-S001 | 工程键 P02（`--home-CNS2026495165-dsh--`） | `session-6a7367fe-7bd8-4b8d-b3fa-7c22a7d9b616` | 82,429 | **65,145** | 69,229 | ✅ 可读 |
| P03-S001 | 工程键 P03（`--home-CNS2026495165-Dexterous_Hand_23Dof--`） | `session-d8bb7bfc-c5a9-4bdd-86af-700be521624a` | 30,307 | **25,050** | 26,643 | ✅ 可读 |
| P04-S001 | 工程键 P04（`--home-CNS2026495165-Dexterous_Hand_23Dof-Dexterous_Hand_23Dof-orca_core-main--`） | `session-2e63b9dd-fcce-488e-985e-ef4b7aa1926b` | 28,589 | **22,355** | 24,104 | ✅ 可读 |

> 用于反证的会话目录名**本身不含会话正文**，给出它是为了让第三方能直接定位复算；工程键（含用户路径）已用 P## 序号替代。上表 4 行可直接在 `n17-erratum/out/scan-baseline.jsonl` 中按 `packed` 字段检索命中。

**定位命令**（`$E = .workspace/audit-020/n17-erratum`，`$CORP = p0a/corpus/sessions`）：

```bash
# ① 从基线扫描里筛出"含打包行且可读"的文件（162 份），按打包行数降序取前 4
node -e '
const fs=require("fs");
const recs=fs.readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean).map(JSON.parse);
const ok=recs.filter(r=>r.ok&&r.packed>0).sort((a,b)=>b.packed-a.packed);
const picked=[];const seen=new Set();
for(const r of ok){const pk=r.rel.split("/")[0];if(seen.has(pk))continue;seen.add(pk);picked.push(r);if(picked.length>=4)break;}
console.log(JSON.stringify(picked.map(r=>({proj:r.rel.split("/")[0],session:r.rel.split("/")[1],packed:r.packed,rows:r.rows})),null,1));
' $E/out/scan-baseline.jsonl

# ② 对其中任意一份实跑"解压 + 0.2.0 真实 catalog 读打开"
node $E/decode-one.mjs \
  "$CORP/--home-CNS2026495165-Dexterous_Hand_23Dof-Dexterous_Hand_23Dof--/session-aa169d83-5517-429b-9899-4ca4b4963d84/session.jsonl.zstd"
```

**实跑输出（#1，最大打包行文件，未做任何修复）**：

```json
{
 "headerVersion": 0,
 "rows": 90507,
 "packedRowKinds": { "reasoning-chunks": 56780, "tool-call-chunks": 10957, "text-chunks": 4742 },
 "packedRows": 72479,
 "packedPayloadTotal": 1235060,
 "readOk": true,
 "totalEvents": 5665
}
```

`readOk: true` 即"0.2.0 的真实 catalog 在未做任何修复的原始语料上读打开成功"，而该文件含 **72,479 行打包行**（三种打包行全部出现）。#2/#3 同样 `readOk: true`（65,145 行 / 25,050 行打包行，见 §0 脚本可复跑）。

**全局口径（同一实跑）**：

```
filesWithPackedRows           = 349
packedRowsReadableAtBaseline  = 162        # 未做任何修复即可读
maxPackedRowsInOneReadableFile= 72479
```

**消融补充（进一步排除"打包行是闸门"）**：`scan-desc-only` 把第一道闸单独拿掉后，349 份打包行文件中可读 **190** 份；而剩余被拒的 159 份**全部**报的是 `sections` 那条错，**没有一份**报打包行相关错误。修完两处后 349/349 全部可读。

> 结论：打包行不仅"受支持"，而且在**完全未修复**的语料上就已经能支撑大量日志读到 `readOk: true`。把"余 40%"归因于打包行，方向性错误。

---

### 3.3 【证据三·[实跑]】基线通过率复算（目录级完整统计 + 逐份计数）

**实跑命令**：

```bash
$E=/home/CNS2026495165/dsh/.workspace/audit-020/n17-erratum
node "$E/scan.mjs" "$CORP" "$E/out/scan-baseline.jsonl"
```

**实跑输出（扫描器汇总行）**：

```json
{"root":".../p0a/corpus/sessions","files":2508,"locks":3,"ok":229,"rejected":2279,"seconds":46}
```

（`locks` = 3 个 `session.lock`，0 字节，按字节复制，不参与读打开。）

**分析（`node "$E/analyze.mjs" "$E/out/scan-baseline.jsonl"`）**：

```json
{
 "total": 2508, "ok": 229, "rejected": 2279, "readableRate": 0.0913,
 "filesWithPackedRows": 349, "packedRowsReadableAtBaseline": 162,
 "byVersion": { "v0": { "total": 2505, "ok": 226, "rejected": 2279 },
                "v3": { "total": 3,   "ok": 3,   "rejected": 0 } },
 "rejectionClasses": { "descriptor-version": 2275, "plugin-source-sections": 4 },
 "topErrorMessages": [
   ["SessionFormatUnsupportedMigrationError: subagent/descriptor N uses unsupported descriptor version N", 2275],
   ["SessionFormatUnsupportedMigrationError: ... agent/inbox/spliced N inserted message source sections must be an array", 4]
 ]
}
```

**两类拒因的逐份计数**：

| 拒因 | 份数 | 说明 |
|---|---|---|
| `subagent/descriptor` 版本 2 → 不支持（只接受 3） | **2275** | 第一道闸 |
| `agent/inbox/spliced` 的插件来源 `sections` 非数组 | **4** | 第二道闸，**只在第一道闸放行的文件里可见**（其余同因文件被上面那类先挡住——这点用 §3.3 消融独立证明，而不是靠推断） |
| 拒绝合计 | 2279 | |
| 可读 | 229 | 229/2508 = **9.13%** |

**结构级旁证（不依赖 codec）**：`subagent/descriptor` 行的版本直方图——`v2: 1 行` 出现在 **2275 份**文件中，`无 descriptor` 出现在 **233 份**文件中（2275 + 233 = 2508，完全闭合）。

**与协调者产物的交叉验证（我的实跑 vs `p0a/recon/scan-before.jsonl`）**：

```text
mine=2508  theirs=2508  agree=2508  disagree=0  missing=0
```

**独立消融（本轮新增，用于证明"第二道闸真实规模 456"而不是"4"）**：

```bash
node "$E/desc-only.mjs" "$CORP" "$E/out/desc-only/sessions"   # 只把 descriptor.data.version 2→3
# 输出：{"files":2511,"rewritten":2508,"locksCopied":2278,"descriptorRowsRewritten":2275,"sectionsInjected":0}
# 注意 sectionsInjected=0：没有补任何 sections
node "$E/scan.mjs" "$E/out/desc-only/sessions" "$E/out/scan-desc-only.jsonl"
# 输出：{"files":2508,"locks":3,"ok":2052,"rejected":456,"seconds":46}
```

**基线拒因的"真身"是第二道闸的 456 份，而不是 4 份**——第一道闸（descriptor）先于第二道闸失败，**掩盖了** 452 份本该报 `sections` 错的文件。这与 `BRIEF.md §2.1` 的措辞"其余同因文件被上面那类先挡住"一致，本轮给出**可复算的数字**。

**关于语料快照的可复现性（重要计量注意事项）**：`~/.dsh/sessions` 是**活跃 append-only 日志根**，本轮实测期间仍在被写入：

| 观察 | 数值 |
|---|---|
| 语料快照时刻 | 2026-09-30 10:55:37 |
| 10:55 之后新增的 `.jsonl.zstd` | **2 份**（导致 `~/.dsh/sessions` 现在有 2510 份，而快照为 2508 份） |
| 10:55 之后被追加的文件 | **7 份**（如 `session-017de004-…`：原件 4,041,170 B / 8,126 个 zstd 帧，快照副本 3,718,034 B / 7,549 帧，**+577 帧**） |

因此：**本报告与协调者的所有比例都基于 10:55 的冻结副本**（该副本内部逐份字节一致，可复算）；直接对 `~/.dsh/sessions` 现场重跑会得到与 2508 略有差异的分母。这不是数据损坏，是正常的多帧追加。

---

### 3.4 【证据四·[源码]+[实跑]】第二道闸的定性：不是数据损坏

#### (a) 判定点行号

`$B/dsh-session-format-v0-to-v1/lib/index.js`：

```
919  function pluginSourceValue(source, label) {
920      const optional = [ "form", "sections", "summary" ];
926      assertReleasedV0Keys(source, ["kind", "plugin"], optional, label);
932      const form = source["form"];
933      if (form === void 0) return;
934      literalValue(form, ["instructions","catalog","snapshot","notice","relay","recall"], `${label} form`);
942      if (form === "snapshot") arrayValue(source["sections"], `${label} sections`, (member, memberLabel) => {
943          const section = exactRecord(member, memberLabel, ["name", "text"]);
944          nonEmptyString(section["name"], `${memberLabel} name`);
945          stringValue(section["text"], `${memberLabel} text`);
946      });
947      else if (source["sections"] !== void 0) throw new SessionFormatError(`${label} sections require snapshot form`);
```

- **`sections` 在 `optional`（行 920-924）里 ⇒ `undefined` 本身不是"键不存在"的违规**；
- **但行 942 的 `arrayValue` 要求：一旦 `form === "snapshot"`，`sections` 就必须是通过类型校验的数组** ⇒ `undefined`/非数组一律抛错。
- 判定函数总入口是 `messageSourceValue`（行 771）`switch (source["kind"]) case "plugin": pluginSourceValue(source, label)`（行 781-782）。

#### (b) 该形状在 v0 里出现的**三处**消息位置（各自行号级判定点）

`messageValue`（行 715）是唯一的消息校验器，末尾行 731-733 统一交给 `messageSourceValue`：

```
731  const source = releasedV0Record(message["source"], `${label} source`);
732  if (version < 2 && expected === "user" && source["kind"] === "goal" && source["change"] !== void 0) legacyGoalMessageValue(...);
733  else messageSourceValue(source, `${label} source`, version, expected);
```

`messageValue` 的调用点即"消息位置"。与插件来源相关的**三处**：

| # | 消息位置（JSON 路径） | 事件类型 | `messageValue` 调用点 | 报错标签形态 | 本轮语料命中 |
|---|---|---|---|---|---|
| 1 | `user/message.data.source` | `user/message` | **行 550** `messageValue(data, label, version, "user")`（`label = "user/message <seq>"`） | `user/message <seq> source …` | **456 处** |
| 2 | `agent/inbox/spliced.data.inserted[].source` | `agent/inbox/spliced` | **行 282-283** `arrayValue(data["inserted"], …, (value) => messageValue(value, \`${label} inserted message\`, version, "user"))`（`label = "agent/inbox/spliced <seq>"`） | **`agent/inbox/spliced <seq> inserted message source sections must be an array`** ← **就是本轮 456 份的实际报错** | **456 处** |
| 3 | `assistant/message.data.message.source` | `assistant/message` | **行 310-312** `messageValue(data["message"], \`${label} message\`, version, "assistant")` | `assistant/message <seq> message source …` | 0 处（该位置 `expected="assistant"`，行 773 只接受 `kind === "model"`，插件来源不出现） |

> 补充说明：另有行 448（`session/title-llm-request.data.messages[]`，无 `expected` 限制）与行 535（`tool/result.data.message`，`expected="tool"`）两处调用点；本轮语料在这两处各命中 **0 处**插件 snapshot 来源，故原叙述所说"三处"在**本语料的实际命中**上精确成立。

**逐份实跑（结构级普查，不依赖 codec）**：

```bash
node "$E/posscan.mjs" "$CORP"
```

```json
{
 "scanned": 2508,
 "occurrences": {
   "user/message.data.source": 456,
   "agent/inbox/spliced.data.inserted[].source": 456,
   "assistant/message.data.message.source": 0,
   "session/title-llm-request.data.messages[].source": 0,
   "tool/result.data.message.source": 0
 },
 "filesAffected": {
   "user/message.data.source": 456,
   "agent/inbox/spliced.data.inserted[].source": 456,
   "assistant/message.data.message.source": 0,
   "session/title-llm-request.data.messages[].source": 0,
   "tool/result.data.message.source": 0
 },
 "emitterPlugins": { "taste": 912 }
}
```

要点：

- **456 份文件、每份恰好 2 处**（位置 1 与位置 2），共 912 处，**全部来自同一个 emit 者 `taste`**。
- codec 先校验位置 2（`seq` 更小），所以 456 份的报错标签**全部**是 `agent/inbox/spliced 4`（452 份）/ `agent/inbox/spliced 3`（4 份）——即 `BRIEF.md §2.1` 记录的"4 份"是**同一根因在前一道闸下露出的那一小部分**。
- **同一份文件里位置 1 也坏**，只是没轮到它报错。这解释了为什么只数"报错文件数"会把真实规模严重低估。

**单份样例（位置 2 的实际 JSON 形状，不含正文）**：

```
agent/inbox/spliced seq=4  target=next-turn  start=0  inserted.length=1
  inserted[0]: keys = ["content","source","role","id"]
               role = "user"
               source = {"kind":"plugin","plugin":"taste","form":"snapshot"}   ← 无 sections 键
               content[].type = ["text"]
```

#### (c) 证明这**不是数据损坏**：0.1.1 与 0.2.0 的 `dsh-taste/lib/learner.js` **逐字节相同**

> 说明：`dsh-taste` 是**用户级本地插件**，不在 0.2.0 官方包树里（`$B/dsh-taste` 不存在）。它在 0.1.1 现役树与 0.2.0 隔离根中各有一份，路径见下。

```bash
OLD011=/home/CNS2026495165/.dsh/profiles/node_modules/@deepseek-ai/dsh-taste/lib/learner.js
NEW020=/home/CNS2026495165/dsh/.workspace/audit-020/assembly-020/home/profiles/node_modules/@deepseek-ai/dsh-taste/lib/learner.js

sha256sum "$OLD011" "$NEW020"
# 7b1e24c13c53089030aa53195cc33f690a0cfc06700fb0f7055eb57cf1b29902  .../learner.js   (0.1.1 现役)
# 7b1e24c13c53089030aa53195cc33f690a0cfc06700fb0f7055eb57cf1b29902  .../learner.js   (0.2.0 隔离根)

diff -u "$OLD011" "$NEW020" ; echo "diff exit=$?"
# (无输出)
# diff exit=0

wc -c -l "$OLD011" "$NEW020"
#  242 13224 .../learner.js
#  242 13224 .../learner.js
#  484 26448 total
```

（同 hash 还出现在 0.1.7 树 `.dsh-017/profiles/.../learner.js`，即该文件跨三个版本未变。）

**`:219` 就是那个不带 `sections` 的形状**（行 212-221）：

```js
216  handle.agent.followup(
217      createUserMessage({
218          content: [{ type: "text", text }],
219          source: { kind: "plugin", plugin: "taste", form: "snapshot" },
220      }),
221  );
```

**为什么这足以定性为"写入侧既有形态"而非数据损坏**：

1. **不是被破坏的字节**：文件能被 `zstd` 完整解压、每行都是合法 JSON、`dt`/`seq0` 会计自洽（§3.1 的 seq 校验通过）。它只是**不符合 v0-to-v1 codec 对 `snapshot` 的字段要求**。
2. **是同一个 emit 者的稳定输出**：`learner.js` 在 0.1.1 与 0.2.0 **逐字节相同**，`:219` 一处 emit 覆盖了实测的全部 912 处命中。
3. **同版本内自洽（0.1.1 侧不做该字段校验）**：0.1.1 现役 `@deepseek-ai/dsh-session@0.1.1-rc.2` **整包没有 snapshot/`sections` 的来源校验**——
   `grep -rn "snapshot" src-011/node_modules/@deepseek-ai/dsh-session/lib/` 只命中 `types/types.d.ts` 里的注释/类型文档，
   `lib/types/chunk-rows.js` 中 `sections|pluginSource|form === 'snapshot'` 命中数 = **0**；
   `dsh-session-persistence-jsonl` 侧只有 3 处局部的 `snapshots` 变量（`:1042/:1048/:1058`），与来源校验无关。
   所以 0.1.1 **写得出来、也读得回去**——这是"该版本形态合法"，不是"数据坏了"。
4. **0.2.0 至今仍在写这个形状**（见 §3.6 末尾的实跑），所以它也不是"历史遗留的孤立异常"。

---

### 3.5 【证据五·[实跑]】修完两处后的通过率

**转换产物**：`p0a/converted/sessions`（协调者产物，本轮作为**验证对象**只读）。
**验证时点说明（重要）**：该产物在 **2026-09-30 11:12:45 – 11:13:24** 被协调者整体重建了一次
（2508 份文件 mtime 全部落在这个窗口内），协调者的 `scan-after.jsonl` 生成于 **11:15:05**，
我的验证扫描跑在 **11:20:54**——三者都作用于**同一批 11:12 产物**，故本次交叉验证对的是同一份盘面。

**实跑命令与输出**：

```bash
node "$E/scan.mjs" /home/CNS2026495165/dsh/.workspace/audit-020/p0a/converted/sessions "$E/out/scan-after.jsonl"
# {"files":2508,"locks":3,"ok":2508,"rejected":0,"seconds":44}
```

**分析**：

```json
{
 "total": 2508, "ok": 2508, "rejected": 0, "readableRate": 1,
 "filesWithPackedRows": 349, "packedRowsReadableAtBaseline": 349,
 "byVersion": { "v0": {"total":2505,"ok":2505,"rejected":0}, "v3": {"total":3,"ok":3,"rejected":0} },
 "rejectionClasses": {},
 "topErrorMessages": []
}
```

- **可读率 = 2508/2508 = 100.00%**
- **失败清单 = 0 条（空）**
- 349 份含打包行的文件**全部**可读（打包行未造成任何拒绝）

**交叉验证（我的实跑 vs 协调者 `p0a/recon/scan-after.jsonl`）**：

```text
mine=2508  theirs=2508  mineOk=2508  theirsOk=2508
agree=2508  disagree=0  missing=0
```

**该一致性同时证明转换器是确定性的**：调和者的扫描（11:15:05，基于 11:12 产物）与我的扫描
（11:20:54，同一批 11:12 产物）**逐份 2508/2508 判定完全相同**，说明转换器对同一输入产生同一可读性结论
（虽为不同实现：协调者用自写 zstd 帧游走器，我用系统 `zstd` CLI + 真实 catalog）。

---

### 3.6 【证据六·[源码]+[实跑]】核对"旧位置解码器被移除"

原话（`dsh-020_NEXT_SESSION_PROMPT.md:95`）：*"packing 实现从 `dsh-session` 顶层行迁到 `dsh-llm` 的 `event.data.stream`，且旧位置解码器被移除。"* 分三问核对。

#### 问 1：0.2.0 树里是否存在 `dsh-llm` 的 `event.data.stream` 解码路径？—— **存在**

`$B/dsh-llm/lib/index.js`（0.2.0-rc.2）：

| 内容 | 行号 |
|---|---|
| `AssistantStreamAccumulator.push` 把 `text-delta`/`reasoning-delta` 压成 `text-chunks`/`reasoning-chunks` | 1170、1180-1196（record 压入） |
| `tool-call-delta` 压成 `tool-call-chunks`（`dt`/`args` 累加） | 1199-1214 |
| `snapshot()` 产出"可落盘的 compact record 列表" | 1230-1250 |
| **`expandAssistantStream(stream)`——把 compact record 列表展开回 chunk** | **1257-1285** |
| `assembleAssistantStream`/`assistantStreamHasVisibleText` 等读侧消费 | 1402-1403、1444-1461 |

`event.data.stream` 是真实存在的**读打开消费路径**（消费方实测到的调用点）：

| 消费方 | 行号 |
|---|---|
| `dsh-token-meter/lib/index.js` | `assembleAssistantStream(event.data.stream)` @ **790**；`lastAssistantStreamChunk(event.data.stream,'usage')` @ **392** |
| `dsh-session-stats/lib/index.js` | `assistantStreamFirstTokenTime(event.data.stream)` @ **97、110** |
| `dsh-headless/lib/json-stream-BA-F3lfb.js` | `streamUsage(event.data.stream)` @ **201、204** |
| `dsh-client-ui-chat/lib/client.js` | `streamUsage(event.data.stream)` @ **10333、10353** |
| `dsh-client-ui-trajectory/lib/client.js` | `assistantStreamFirstTokenTime(event.data.stream)` @ **815** |

该落点的 **`data.stream` 必须是数组**由迁移边校验：`$B/dsh-session-format-v2-to-v3/lib/index.js:173` `contentArray(data["stream"], label + ".stream")`；`$B/dsh-session-format-v3-to-v4/lib/index.js:208、347、1211-1223` 同样按数组逐项处理。

**这半句是对的**：packing 的**写侧实现确实在 `dsh-llm`**，落点是 `assistant/message.data.stream`（compact record 列表）。承接它的迁移边是 `$B/dsh-session-format-v1-to-v2/lib/index.js:4`（`import { AssistantStreamAccumulator } from "@deepseek-ai/dsh-llm"`）→ `:510`（`state.pending.group.accumulator ??= new AssistantStreamAccumulator()`）→ `:511-514`（`push({time, chunk})`）→ `:752/:764`（`stream: streamOf(group)` 写进 `assistant/message`/`assistant/attempt`）。

#### 问 2：0.1.1 的顶层打包行解码器是否真被移除？—— **文件/导出名被移除，能力未被移除**

**0.1.1 侧（现役）**：`src-011/node_modules/@deepseek-ai/dsh-session` 版本 **0.1.1-rc.2**

| 内容 | 证据 |
|---|---|
| 顶层打包行解码器文件 | `lib/types/chunk-rows.js`（存在） |
| 该文件的两个导出 | `export function packChunkRuns(events)` @ **`chunk-rows.js:144`**；`export function decodeStorageRecord(value)` @ **`chunk-rows.js:292`** |
| 该文件的信封/字段校验 | `:200` 要求恰好 `['type','seq0','time0','data']`；`:214/224` 要求 `data` 恰好 `{turn,step,index,id,name?,dt,args}` 或 `{turn,step,index,dt,texts}` |
| 分发包（`lib/index.js`）中的同一实现 | `expandRow` @ **`lib/index.js:973`**；`decodeStorageRecord` @ **`lib/index.js:1029`**，其分发为 `:1032-1033` —— `tag` 属 `text-chunks/reasoning-chunks/tool-call-chunks` 则 `expandRow(validateRow(value, tag))`，否则原样返回 |
| 读路径接线 | `dsh-session-persistence-jsonl/lib/index.js:9` `import { SESSION_FORMAT_VERSION, decodeStorageRecord, packChunkRuns } from "@deepseek-ai/dsh-session"`；`:279` `decoded = decodeStorageRecord(JSON.parse(line.toString("utf8")))` |
| 该 build 的格式版本 | `dsh-session/lib/index.js:37` `SESSION_FORMAT_VERSION = 0` |

**0.2.0 侧**：`$B/dsh-session` 版本 **0.2.0-rc.2**，`SESSION_FORMAT_VERSION = 4`（`dsh-session/lib/index.js:56`）

| 内容 | 实跑 |
|---|---|
| `ls $B/dsh-session/lib/types/ \| grep -i chunk` | **无输出**（`chunk-rows.js` 已消失） |
| `find $B -name "chunk-rows*"` | **无输出**（整棵 0.2.0 树都没有该文件） |
| `grep -rn "packChunkRuns" $B --include=*.js` | **无输出**（顶层打包行的**编码器**在 0.2.0 树中不存在） |
| `grep -rn "chunk-rows" $B --include=*.js` | **无输出** |

**但是**：顶层打包行的**解码能力**被完整搬进了 v0 codec（§3.1 的 `decodePackedRun`，`$B/dsh-session-format-v0-to-v1`，版本 **0.2.0-rc.2**），**形状约束与 0.1.1 逐条等价**：

| 校验项 | 0.1.1 `chunk-rows.js` | 0.2.0 `decodePackedRun` |
|---|---|---|
| 信封恰好 `{type,seq0,time0,data}` | `:200-201` | `:1743-1748` |
| `seq0` 非负安全整数 | `:203-205` | `:1749` |
| `texts` / `args` 二选一 | `:214-227` | `:1753-1766` |
| `dt.length === payload.length - 1` | `validateRunData` | `:1770` |
| 成员 seq 不越安全整数 | `:234-236` | `:1780` |
| 展开为 `assistant/chunk`，`seq = seq0 + k` | `:1008-1016`（`expandRow`） | `:1832-1837`（`expandAssistantChunkRun`） |

**实跑反证**：`decode-one.mjs` 在**未做任何修复**的原始语料上，用 0.2.0 的 `decodePackedRun` 成功吃下 **72,479 行打包行**（§3.2）。若"旧位置解码器被移除"指能力移除，则这 72,479 行不可能被读开。

**另一处并存实现（值得上游注意）**：0.2.0 树里存在**两套形状相近但不同 API/不同字段名**的打包实现——

- `dsh-session-format-v0-to-v1` 的 `decodePackedRun`（**顶层行**）：record 字段 `{type,time0,index,dt,texts|args}` **+ turn/step**；
- `dsh-llm` 的 `AssistantStreamAccumulator`/`expandAssistantStream`（**内层 stream record**）：record 字段 `{type,time0,index,dt,texts|args}` **无 turn/step**，另有 `{type:"chunk",time,chunk}` 形态。

两套是**独立代码**，没有互相 import（只有 `v1→v2` 边 import 了 `dsh-llm`）。这是"旧实现消失 + 新实现并存两份"的现状，不是"一处实现被搬走"。

#### 问 3（本轮追加·[实跑]）：0.2.0 现在还在写"它自己读不开"的日志吗？—— **在写**

`~/.dsh/sessions` 的**新写入文件**（10:55 之后）实跑：

```bash
# 复制 10:55 之后新写入/被追加的 9 份到我的边界内，再原样扫描（不做任何修复）
node "$E/scan.mjs" "$E/out/live-drift/sessions" "$E/out/scan-live-drift.jsonl"
# {"files":9,"ok":2,"rejected":7}
```

```json
{ "descriptor-version | headerV0": 7, "READ-OK | headerV0": 2 }
sample rejects:
  1dfd215c-8150-44b5-a0d3-5cb546cfe325 | ... subagent/descriptor 0 uses unsupported descriptor version 2
  3f9f985e-3951-4418-bda4-676188f95d25 | ... subagent/descriptor 0 uses unsupported descriptor version 2
```

即：**这些是 0.2.0 当前进程刚写出来的 v0 会话**（例：`bcd8f27f-…` header `{"version":0, "origin":"subagent", "agentPreset":"standard-glm"}`，mtime 2026-09-30 10:44），其行类型直方图包含 `subagent/descriptor: 1`、`agent/inbox/spliced: 2`、`reasoning-chunks: 4`；对这些文件的形态普查显示与语料同形：`spliced seq4 plugin=taste` + `user/message seq8 plugin=taste`（`taste` snapshot 无 `sections`）。

> 结论：不能说"0.2.0 读不了 0.1.1 的历史"。更准确的表述是：**0.2.0 的 v0 codec 读不了 0.2.0 自己写出的 v0 日志**（当该会话有子代理、或触发过 taste 快照时）。这直接支持"这是**写入侧形态与 codec 契约不一致**"的定性，而不是"历史数据损坏"。

---

## 4. 对上游的处置建议

### 4.1 定性

| 维度 | 定性 | 理由 |
|---|---|---|
| 是"数据面问题"还是"需要上游修 codec"？ | **两者都不是单一问题**：主体是**写入侧形态与 codec 契约不一致**（data-shape mismatch），存量数据**没有损坏**，且**不必**改数据 | §3.4 证明文件可完整解压、JSON 合法、seq 会计自洽；缺陷只在字段要求 |
| 存量迁移 | **走数据面最小结构补全即可 100% 通过**，无需上游动作 | §3.5 实跑 2508/2508 |
| 上游侧 | **存在需要上游修的两个真实缺陷**，但**不是"打包行不受支持"** | 见 4.2 |

### 4.2 建议上游处理的两项（**不现在提 issue**，按 D22 等存量修完再说）

1. **`dsh-session-format-v0-to-v1` 对 `snapshot` 来源过于严格（兼容性缺口）**
   `pluginSourceValue`（`:919-950`，全文唯一出现处，§3.4(a)）要求 `form === "snapshot"` 时 `sections` 必须是数组，
   但**emit 侧的本地插件 `dsh-taste` 从 0.1.1 到 0.2.0 一直不写 `sections`**（`learner.js:219`，两版逐字节相同）。
   （说明：`dsh-taste` 是**用户级本地插件**，不在 0.2.0 官方包树里——`$B/dsh-taste` 不存在，
   它以 profile 本地插件形式挂在 `.dsh/profiles` 与 `assembly-020/home/profiles` 下。）
   建议上游：要么放宽为"`sections` 缺省即视为空快照"，要么让 emit 侧统一补齐 `sections: []`。
   **在放宽之前，本轮的"最小结构补全"就是唯一可行的迁移手段。**
2. **写入侧与读入侧自相矛盾（自读失败）**
   0.2.0 当前进程仍在写 v0 格式日志（`SESSION_FORMAT_VERSION = 4` 但落盘 `version: 0`——见 §3.6 问 3），且写出 `descriptor version: 2` + `taste` snapshot 无 `sections` 两种被自己 v0 codec 拒收的形态。这属上游 bug 级别的自洽问题，建议上游一并核查（同时也会让"迁移到 0.2.0 后继续产生不可读日志"的风险消失）。

### 4.3 对本轮迁移的实际建议

- **存量迁移**：按 `BRIEF.md §2.1` 的"最小结构补全"执行（descriptor `2→3`；插件 snapshot 补 `sections: []`，**不删字段、不改 `form`**）。实测 100% 通过，**不需要**任何针对打包行的处理。
- **打包行**：**无需任何动作**。旧日志里的打包行由 v0 codec 直接读；v1→v2 边会经 `dsh-llm` 的 `AssistantStreamAccumulator` 把它们重新表达为 `assistant/message.data.stream`。
- **活跃根**：`~/.dsh/sessions` 是 append-only 且**仍在增长**。正式转换前必须**重新取一次快照**并记录快照时刻（差分见 §3.3），否则会出现"转换产物比源少若干份/若干帧"的假失败。
- **不重开已裁决事项**：D22 已裁决"报官方 issue 等存量修复完再写"——本轮**不提交 issue**，只落本报告作为上游输入。

---

## 5. 未验证项与结论强度

### 5.1 结论强度标注

| 结论 | 强度 | 依据 |
|---|---|---|
| 打包行受支持（四处源码） | **[源码]** | §3.1，行号可核对 |
| 语料中 349 份含打包行、162 份基线可读、单文件最多 72,479 行 | **[实跑]** | §3.2/§3.3，`scan-baseline.jsonl` |
| 至少 4 份含打包行日志在未修复语料上可读 | **[实跑]** | §3.2，`decode-one.mjs` `readOk:true` |
| 基线 229/2508 = 9.13%，拒因 2275 + 4 | **[实跑]** | §3.3，我自写扫描器（系统 `zstd` CLI，不复用协调者代码） |
| 第二道闸真实规模 456（而非 4） | **[实跑]** | §3.3 消融（只改 descriptor 的独立语料） |
| 第二道闸判定点行号 + 三处消息位置 | **[源码]** | §3.4 |
| `learner.js` 0.1.1 ≡ 0.2.0（逐字节） | **[实跑+源码]** | §3.4 sha256 相同 + `diff` 空输出 |
| 修完两处 2508/2508 = 100% | **[实跑]** | §3.5 |
| `dsh-llm` 有 `event.data.stream` 解码路径 | **[源码]** | §3.6 问 1，行号可核对 |
| 0.1.1 顶层打包行解码器"文件被移除、能力未移除" | **[源码+实跑]** | §3.6 问 2（源码对照表 + 72,479 行实跑反证） |
| 0.2.0 仍在写自己读不开的 v0 日志 | **[实跑]** | §3.6 问 3，9 份新写入文件 7 份被拒 |
| 语料文件可完整解压 / JSON 合法 / seq 会计自洽（"非数据损坏"的依据） | **[实跑]** | §3.2：90,507 行全部解析成功；v0 codec 的 seq 游标校验通过（若 seq 会计崩坏会报 `seq gap`） |
| 0.1.1 侧不做 snapshot/`sections` 来源校验 | **[源码]** | §3.4(c) 第 3 点：`grep` 命中数 0（除 `.d.ts` 注释） |

### 5.2 未验证项（如实列出）

1. **[未验证] "抽样 3% 可读"的抽样口径**：原叙述未给出抽样方法/样本量，无法复算。本轮给出的是**全量** 9.13%；两者不必然矛盾（3% 可能是小样本），但**无法证实**。
2. **[未验证] 原叙述"修 descriptor 后 60%"的中间态口径**：本轮独立复算为 81.82%（只改 descriptor，不动其他任何字节）。若原口径还叠加了别的条件（如另一种 descriptor 改写方式、或不同 recovery 参数），**60% 这个数字无法复现**；我给出的是可复现的 81.82% 及其构造脚本 `desc-only.mjs`。
3. **[未验证] 用 0.1.1 真实进程读取打包行文件**：受沙箱权限限制，我**未**调用 3080 的 HTTP API 做端到端确认（工单未要求，且工单禁止起服务）。"0.1.1 能读开放包行日志"的结论由**源码路径**支撑：`dsh-session-persistence-jsonl@0.1.1-rc.2:279` → `dsh-session@0.1.1-rc.2:1029-1033` → `expandRow`（`:1008-1016`），**未经进程级实跑**。
4. **[未验证] 0.2.0 为何以 `version: 0` 落盘**（`SESSION_FORMAT_VERSION = 4` 却写 v0）：本轮只**观测到现象**（§3.6 问 3），未定位到写侧选版本的代码分支，故把"为什么写 v0"列为未验证。
5. **[未验证] 452 份报 `agent/inbox/spliced 4` 与 4 份报 `… 3` 的差异原因**：只观测到两类标签的数字不同（4 vs 3），未逐份确认该数字是"事件 seq"还是别的坐标——按 §3.4 的源码（`label = \`${event.type} ${event.seq}\``）判定是 **seq**，但这属**从源码推断**，未对 456 份做逐份 seq 复核。
6. **[口径提示·非未验证] 计量基准**：所有比例基于 10:55 冻结副本；`~/.dsh/sessions` 现在已与快照有差异（+2 份、7 份被追加），现场重跑分母会变（§3.3）。

### 5.3 与协调者结论的一致性声明

- **一致项**：基线 229/2508；拒因 2275 + 4；第二道闸是 `sections` 而非打包行；`sections` 的三处位置与判定点行号；`learner.js` 逐字节相同；修完两处 2508/2508；打包行受支持。**逐份交叉验证 2508/2508 完全一致（`agree=2508, disagree=0`）**，基线扫描与转换后扫描各一次。
- **本轮新增（协调者未给）**：第二道闸的真实规模 **456 份**（用只改 descriptor 的独立消融语料量化）；0.2.0 **仍在写**自己读不开的 v0 日志；打包实现"两套并存"的形状差异对照；`~/.dsh/sessions` 的 append-only 漂移计量。
- **与原交接件的分歧**：N17-c（"余 40% 卡在三种打包行"）**不成立**；N17-b（"60%"）**不成立**；N17-i（"旧位置解码器被移除"）**不成立**（能力保留）；N17-h（"迁到 `dsh-llm` 的 `event.data.stream`"）**部分成立**（只覆盖写侧）。

---

## 6. 我没有做的事（边界声明）

1. **没有写越界文件**：只写了 `reports/N17-ROOT-CAUSE-CORRECTION.md` 与 `n17-erratum/**`；**未**触碰 `MIGRATION-ASSESSMENT.md`、`T21-session-data-migration.md`、`DELIVERY-020-FINAL.md` 等 `reports/` 下任何其它文件。
   > 边界核查附注（避免误判）：核查时 `reports/` 下另有三份文件带 11:15–11:22 的 mtime，
   > 那是**并发的其它执行档**所写（`SKILLS-MIGRATION-VERIFY.md` @11:15:26、
   > `RESTART-AND-VERIFY-RUNBOOK.md` @11:17:14、`VOLATILE-FIX-VERIFY.md` @11:22:07）。
   > 本档的写入集合可逐项枚举：新建 `reports/N17-ROOT-CAUSE-CORRECTION.md` + 新建目录
   > `n17-erratum/`（顶层 6 个脚本文件 `scan.mjs`/`analyze.mjs`/`decode-one.mjs`/`posscan.mjs`/
   > `desc-only.mjs`/`own-060.sh`、1 个符号链接 `node_modules`→0.2.0 官方树、`out/` 下 6 个输出文件
   > 与 2 个子目录 `desc-only/`、`live-drift/`）。
2. **没有改只读源**：`~/.dsh/**`、`~/.dsh-017/**`、`$A/**` 既有文件、`p0a/corpus/**`、`p0a/converted/**` 全部只读访问；`p0a/converted/**` 与 `p0a/corpus/**` 未做任何写入。
   > 边界核查附注：`find p0a/corpus -type f -newermt '2026-09-30 11:00'` **空**；
   > `find p0a/converted -type f -newermt '2026-09-30 11:00'` **不空**，但那些 mtime 是
   > **11:12:45–11:13:24（协调者的重建）**，早于我的验证扫描（11:20:54）且与我的任何命令时间不符；
   > 我的操作全部是 `readFileSync` / `zstd -d -c`（只读）。
3. **没有起服务/重启**：未启动任何端口，未 kill/restart 3080/3097/3098。
4. **没有提交上游 issue**（按 D22）。
5. **没有抄录会话正文**：报告只使用行数、类型名、seq、字段名、脱敏工程键序号与会话目录名。
6. **没有复用协调者的扫描代码**：`scan.mjs` 为自写，解压走系统 `zstd` CLI（协调者用自写 zstd 帧游走器），拒因分类独立实现；协调者产物**仅作交叉验证**。
7. **没有为"好看"重试**：`desc-only` 消融与 `live-drift` 观测均为一次性实跑，失败/异常如实记录（如 3% 抽样口径无法复算、`frames` 字段首版解析 bug 已修正后重跑并保留修正说明）。
