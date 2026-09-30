# T05 会话数据代际与格式兼容审计（0.1.1 / 0.1.7 → 0.2.0）

- 审计轮次：2026-09-29（本轮全部结论绑定当轮实测，无历史证据复用）
- 目标：0.2.0-rc.1（npm `next`）；对照：0.1.7-rc.2（隔离 3097）、0.1.1-rc.2（现役 3080）、0.1.6-alpha.2（v3 代际写入者）
- 代码来源：`.workspace/audit-020/src-020`（0.2.0-rc.1）、`src-017`（0.1.7-rc.2）、`src-011`（0.1.1-rc.2）、`src-016a`（0.1.6-alpha.2），均由本轮 npm 安装（`--ignore-scripts`）
- 实验数据：`.workspace/audit-020/drill/*`（自建合成假会话）+ 真实会话根 `~/.dsh/sessions` 的**只读**探测
- 合规：全轮只读；**未写入**任何真实会话文件（有改动前/后完整性实测，见 §2.7）；报告不含会话正文、密钥、原始会话 id

---

## 1. 结论摘要

1. **0.2.0 支持的会话文件代际只有 v0–v4，当前代际 = v4**。0.2.0 与 0.1.7 在会话数据层的**代际与选择算法实现逐字节相同**：`dsh-session-format`、`dsh-session-format-catalog`、`dsh-session-format-v0-to-v1…v3-to-v4`、`dsh-session-persistence`、`dsh-session-persistence-jsonl`、`dsh-session-query`、`dsh-session-query-sqlite`、`dsh-session-projection`、`dsh-session-projection-cache` 的 `lib/index.js` sha256 全部相等（§2.1）。**不存在 v5 或新代际，也不存在新字段**（唯一有差异的会话相关包是 `dsh-session`（崩溃修复逻辑）与 `dsh-session-log-deepseek`（配置项改为 volatile），两者都不改文件格式）。
2. **读取时的代际选择算法仍然是"按目录内最高代选代"，且不校验内容包含/父集关系**：`resolveGenerationInDirectory()` 把会话目录内所有规范名 `session[.vN].jsonl.zstd` 解析出代际号，**按版本号降序取第一个**（`dsh-session-persistence-jsonl/lib/index.js:3327-3357`，取最高在 `:3351`）。没有任何一步把被选文件与同目录的低代文件做事件数/前缀/摘要对比。
3. **选择算法唯一的自洽性校验是"文件名代际 == 头部代际"**（`:3078`），以及"头部 id/cwd 必须指回被选路径"（`:3384-3395`）。因此：文件名与头部代际不一致时，`list()`/`stat()` 抛出**普通 Error** 直接炸掉整棵根目录的枚举（`:3043` 只吞掉 `SessionFormatUnsupportedError`/`SessionPersistenceCorruptionError`）；而同目录存在"更旧但更完整"的低代文件时，**静默读了低信息量的高代文件**（实测样例 S7：v3 有 2 条事件、残留 v4 只有 1 条 → 读到 1 条，且写打开成功，低代数据被永久忽略）。
4. **"更高代文件存在"会整体遮蔽会话**：只要某个会话目录存在 `session.v5.jsonl.zstd`（哪怕旁边有完全合法的 v4），`findLog` 选到 v5 → `open()/stat()/写打开` 一律 `SessionFormatUnsupportedError("uses log format v5 … upgrade the harness")`，而 `list()` 因为吞掉该异常**返回空列表**（会话在列表里直接消失，实测 S8）。
5. **旧会话可读性——这是本轮最重要的结论：0.1.1（现役 3080）写出的真实会话，绝大多数在 0.2.0 下不可读**。原因是 **v0 代际载荷校验器硬性要求 `subagent/descriptor.data.version === 3`**（`dsh-session-format-v0-to-v1/lib/index.js:1289-1290` 的 `literalValue(data["version"], [3], …)`；`:1584-1586` 对 `version===0` 的制品直接抛 `SessionFormatUnsupportedMigrationError`），而 **0.1.1-rc.2 写的是 `SUBAGENT_DESCRIPTOR_VERSION = 2`**（现役树 `@deepseek-ai/dsh-subagent/lib/index.js:328`；0.1.7/0.2.0 写的是 3）。实测全量只读迁移：**2456 会话中 226 可读（9.2%）、2230 被拒（90.8%）**，被拒会话的原始文件保持不变（§2.5）。
6. **该阻断不是 0.2.0 特有，0.1.7（隔离 3097 的目标版本）同样如此**：用 0.1.7 代码读同一条会话得到完全相同的 `SessionFormatUnsupportedError: subagent/descriptor 0 uses unsupported descriptor version 2`（§2.5）。因此**把迁移目标从 0.1.7 改锚到 0.2.0 并不改变这条风险**，0.1.1→(0.1.7|0.2.0) 的会话升级在代际链上就存在缺口。
7. **失败是"响亮拒绝"而不是静默降级**：被拒会话的原始文件保持不变（错误消息自带 `source v0 artifact remains unchanged`），`list()`/`stat()` 仍能列出（只读头部），只有真正读正文/续写才失败。**没有发现静默丢弃正文的路径**；真正的静默风险在相反方向——见第 2、3、4 条（选代与遮蔽）与第 8 条。
8. **两个构建对"同一个会话目录"会解析到不同文件——真实库已经发生，并且其中一例是静默数据丢失**：0.1.1 的 `findLog` 只按**固定文件名** `session.jsonl.zstd` 定位（`src-011 …/dsh-session-persistence-jsonl/lib/index.js:1315-1334`，拼名在 `:1322`），既不枚举代际也不认 `session.vN.*`（v3-only 目录对它**完全不可见**，实测返回 `undefined`）；0.2.0 则取目录内**最高代**。真实库有 3 个会话目录同时存在 v0 与 v3 文件（§2.8）：2 对是同一会话的等价表示（地标计数逐项一致，v3 较新，无害）；**第 3 对危险**——`session-bc0…` 的 v0 文件 mtime 2026-09-17、34468 行、659 step/start、673 tool/call、682 tool/result、291 user/message、121 turn/end，而 v3 文件 mtime 2026-09-12、332 行、41/41/64/64/21/4：**v0 比 v3 晚 5 天、内容约 10 倍**。0.2.0 选中这个陈旧的 v3 ⇒ 静默按 09-12 的快照呈现该会话，09-12 之后的全部对话/工具结果在当前代际里不可达（这就是 §6 S7 的真实数据版；若在 0.2.0 下续写，还会在这个陈旧前缀之上继续追加，形成永久分叉）。
9. **读打开不落盘，写打开才发布新代际**：只读 `open(id,'read')` 对历史代际只在内存里迁移（`requireStoredLog` → `prepareStoredMigration`），**不写文件**（实测：v3-only 目录读后目录内容与文件 sha256 完全不变，§2.6）；而 `open(id,'write')` 会先取 `session.lock`（flock），再把迁移结果以**排他创建**方式发布为 `session.v4.jsonl.zstd`（旧代际文件保留）。这决定了备份/回滚与"先读后写"的次序。
10. **迁移/校验方案**（§7）：先做三类只读预检——①哪些会话会被 0.2.0 拒绝（本轮 90.8%）；②哪些会话目录存在**多个代际文件**（须逐个判定高代是否为低代超集，本轮真实库已发现 1 例"高代陈旧"）；③可迁移会话的旧/新两侧"消息投影哈希相等"无损判定。写操作前做整根快照 + 新代际文件清单；回滚 = 删除本轮新发布的 `session.v4.*` 并复位清单，但**回滚后 0.1.1 看不到 v4-only 会话**（§2.8）。**不建议**在没有针对 descriptor v2 的转换器之前，让 0.2.0 以写方式打开 0.1.1 会话。
11. **并发/快照**：会话存储是**纯 JSONL，没有 SQLite 索引**（`session-query-sqlite` 在 0.1.7 与 0.2.0 的 base 组合里都是 `path: :memory:` + `openAt: never`，SQLite 从不打开）。所以"顺序 cp db+wal+shm 不可靠、应 `{readOnly:true}` + `VACUUM INTO`"这条历史结论**对本部署的会话数据不再适用**；它只适用于 `~/.dsh/storages/usage/usage.db`（WAL 模式的 SQLite，来自本地插件 `dsh-usage`）等**非会话**存储。会话数据的正确快照姿势见 §7.4。

---

## 2. 证据（当轮命令与输出摘要）

### 2.1 包级逐字节对照

```
$ for p in dsh-session-format dsh-session-format-catalog dsh-session-persistence-jsonl \
      dsh-session-persistence dsh-session dsh-session-format-v3-to-v4 dsh-session-format-v2-to-v3 \
      dsh-session-query dsh-session-projection dsh-session-query-sqlite dsh-session-projection-cache; do
    sha256sum src-017/$p/lib/index.js src-020/$p/lib/index.js; done
```
输出摘要（0.1.7-rc.2 vs 0.2.0-rc.1）：

| 包 | 结果 |
|---|---|
| dsh-session-format | SAME (`6c7417ec2cd555e2…`) |
| dsh-session-format-catalog | SAME (`836bbb772ab505c2…`) |
| dsh-session-persistence-jsonl | SAME (`0845707017acc2b4…`) |
| dsh-session-persistence | SAME (`cc0b6d3a224133af…`) |
| dsh-session-format-v0-to-v1 / v1-to-v2 / v2-to-v3 / v3-to-v4 | SAME |
| dsh-session-query / dsh-session-query-sqlite / dsh-session-projection / dsh-session-projection-cache | SAME |
| **dsh-session** | **DIFF**（仅 `repair.js` 工具结果恢复重写，无格式/字段变化） |
| **dsh-session-log-deepseek** | **DIFF**（`enabled` 由常量改为 `.volatile()`，改为按请求读取；无格式变化） |

代际与迁移链（两版完全相同）：

```
$ sed -n '41,63p' src-020/node_modules/@deepseek-ai/dsh-session-format-catalog/lib/index.js
currentVersion: 4,
codecs: [releasedV0…releasedV4SessionFormatCodec],
currentEncoder: releasedV4SessionFormatCodec,
migrations: [sessionFormatV0ToV1, sessionFormatV1ToV2, sessionFormatV2ToV3, sessionFormatV3ToV4],
```
`src-017/.../dsh-session-format-catalog/lib/index.js` 与 0.2.0 版本 `diff` **无差异**（exit 0）。

### 2.2 环境实测：各版本会话写入代际

```
$ node -e "require('…/<ver>/dsh-session/package.json')" + grep SESSION_FORMAT_VERSION
0.1.1-rc.2 → SESSION_FORMAT_VERSION = 0
0.1.6-alpha.2 → SESSION_FORMAT_VERSION = 3
0.1.7-rc.2 → SESSION_FORMAT_VERSION = 4
0.2.0-rc.1 → SESSION_FORMAT_VERSION = 4
# 目录内实体命名（dsh-session-format/lib/index.js:472-489）
v0 → session.jsonl[.zstd]      vN>0 → session.vN.jsonl[.zstd]
```
各版本 descriptor 版本：0.1.1-rc.2 = **2**；0.1.7-rc.2 = 3；0.2.0-rc.1 = 3（`@deepseek-ai/dsh-subagent` 的 `SUBAGENT_DESCRIPTOR_VERSION`）。

### 2.3 合成数据：v0 / v3 / v4 三代都能读

- `mk-v0.mjs`：按 0.1.1 的物理规则手工构造 v0 制品（首帧=头部行、次帧=事件体，两帧均带 checksum 的 zstd）。**这是描述格式的证据，不是真实会话内容。**
- `mk-v3.mjs`：用 **0.1.6-alpha.2 自己的写入器**生成真实 v3 制品。
- `mk-v4.mjs`：用 **0.2.0 自己的写入器**生成真实 v4 制品。

```
$ node read020.mjs store-syn-020 | store-syn-016 | store-syn-011
store-syn-020  list=1  read={events:2, headerVersion:4}          # v4
store-syn-016  list=1  read={events:2, headerVersion:4}          # v3 迁移后
store-syn-011  list=2  read={events:2, headerVersion:4} / {events:0, headerVersion:4}   # v0（含空会话）
```
结论：v0→v4 的**头部**迁移链可用；**正文**能否迁移取决于载荷校验（见 2.5）。

### 2.4 真实库结构与规模（只读，仅计数/字段名）

```
$ find ~/.dsh/sessions -type f | sed 's#.*/##' | sort | uniq -c
   2456 session.jsonl.zstd           # v0 代际（0.1.1 及更早写出）
      3 session.v3.jsonl.zstd        # v3 代际（0.1.5/0.1.6 期写出）
      3 session.lock                 # 每会话目录一把 flock 锁文件（不删除）
$ node headkeys.mjs    # 真实 v0 头部键集（仅键名）
388  session.jsonl.zstd v0 keys=[agentPreset,createdAt,cwd,delegationDepth,id,origin,parentSession,type,version]
  5  … keys=[…,origin,seedLength,…]
  4  … keys=[agentPreset,createdAt,cwd,delegationDepth,id,origin,type,version]
  3  … keys=[…,origin,parentSession,seedLength,…]
  1  … keys=[agentPreset,createdAt,cwd,delegationDepth,id,type,version]
```
即真实头部键集完全落在 v0 编解码允许集内（不触发 `assertNoRetiredHeaderFields` / 字段集拒绝）。

### 2.5 关键实测：全量只读迁移预检（0.2.0 读 0.1.1 会话）

```
$ node fullpass.mjs        # 全库逐会话 open(id,'read') + read()；只输出聚合计数
sessions to attempt: 2456
progress 1200/2456 ok=125 err=1075
…
FINAL { "total": 2456, "ok": 226, "err": 2230, "events": 211418 }
errClasses: {
  "SessionFormatUnsupportedError: subagent/descriptor 0 uses unsupported descriptor version 2 …": 2184,
  "SessionFormatUnsupportedError: subagent/descriptor 5 uses unsupported descriptor version 2 …": 26,
  "SessionFormatUnsupportedError: subagent/descriptor 6 uses unsupported descriptor version 2 …": 10,
  "SessionFormatUnsupportedError: subagent/descriptor 267140 / 80368 / 211873 uses unsupported descriptor version 2 …": 3 / 2 / 1,
  "SessionFormatUnsupportedError: … format-v0-to-v1 refuses this format v0 Session: agent/inbox/spliced 3 inserted message source sections mu…": 4
}
```
- **可读 226 / 2456 = 9.2%；被拒 2230 / 2456 = 90.8%**；可读子集共 211418 条事件。
- 拒因分两类：①`subagent/descriptor` 载荷版本 2（**2226 会话**，其中 2184 例在 seq 0、42 例出现在会话中段 seq 5/6/80368/211873/267140 ⇒ 既有"子会话自身的 seed 描述符"，也有"父会话日志中回写的描述符"）；②`agent/inbox/spliced` 的 inserted message source sections 校验（**4 会话**，消息在 130 字符处被本报告的聚合逻辑截断，完整文案见 §8）。

同一份数据的对照（0.1.1 侧可读、0.1.7 侧同样拒绝）：

```
$ node read011d.mjs <id>        # 0.1.1-rc.2 后端
0.1.1 read -> OK events=1395 headerVersion=0
$ node sanity011.mjs <id>       # 该会话物理行 1395 行 → 事件 1395 条，seq 稠密，类型全为已知
{"n":1395,"denseSeq":true,"knownTypeRatio":1,"distinctTypes":16,"top3":[["tool/call",267],["tool/result",267],["step/start",254]]}
$ node read017.mjs <id>         # 0.1.7-rc.2 后端
0.1.7 -> SessionFormatUnsupportedError: subagent/descriptor 0 uses unsupported descriptor version 2; source v0 artifact remains unchanged
$ node read020.mjs              # 0.2.0-rc.1 后端
0.2.0 -> SessionFormatUnsupportedError: … 同上
```

**最小对照实验**（合成，只改一个字段）：

```
$ node desc-demo.mjs
descriptor payload version=2 -> SessionFormatUnsupportedError: subagent/descriptor 0 uses unsupported descriptor version 2
descriptor payload version=3 -> READ OK events=2 migratedHeaderV=4
```
两条日志除 `subagent/descriptor.data.version` 外完全相同：2 被拒、3 通过。且 v2 的成员集是 v3 允许集的子集（v3 仅新增可选 `agentReasoningEffort`），见 §4.3。

### 2.6 只读打开不落盘

```
$ node nonpublish.mjs      # v3-only 会话目录，open(id,'read') + read() 后
{"before":["session.v3.jsonl.zstd"],
 "afterReadOnlyOpen":["session.v3.jsonl.zstd"],
 "fileHashStable":true, "events":2, "statVersion":4, "inherited":0}
$ ls ~/.dsh/sessions/*/session*/session.v4.jsonl.zstd | wc -l     # 真实库
0                                                                    # 全轮探测未发布任何 v4 文件
$ find ~/.dsh/sessions -name session.lock | wc -l                 # 锁文件数未变
3
```

### 2.7 真实库完整性（只读探测前后）

```
$ node real-probe.mjs
files before: 2461 digest 87b24001…
list() OK, entries: 2455          # 只读头部：全部可列出
stat(): ok=2455 err=0             # 只读头部：全部可 stat（version 归一到 4）
size bytes: max=22808279 median=266400
full read-only migration: ok=9 err=0 events[min=102 max=7080 total=32541]   # 抽样（含 3 个 v3 会话）
files after: 2461 … unchanged: false   # 变化项 = 正在被 3080 追加的活跃文件（同路径、size/mtime 变）
```
`added: 32 / removed: 32` 为**同一批路径**的 size/mtime 变化（现役 3080 正在写入；本审计自身也运行在 3080 上，其会话文件必然增长），该窗口内**路径集合未增减**；事后 `session.v4.jsonl.zstd` 计数仍为 0、`session.lock` 计数仍为 3（§2.6）。综合判定：本轮只读探测**未发布新代际、未删除文件**；根目录文件计数会随 3080 自身活动波动，故计数变化不作为"本审计写库"的证据 —— 判定依据是路径集合比较 + 新代际/锁文件计数 + 合成样例的落盘对照（§2.6）。

### 2.8 双代际目录：两个构建选到不同文件（真实库实测）

真实库全量扫描后发现**恰好 3 个会话目录同时存在 `session.jsonl.zstd` 与 `session.v3.jsonl.zstd`**（`dualgen.mjs`，逐文件解码只统计行的 `type` 与地标计数）：

| 目录 | 文件 | mtime | 物理行 | 头部 | step/start | tool/call | tool/result | user/message | turn/end |
|---|---|---|---|---|---|---|---|---|---|
| `session-d2b…` | v0 | 2026-09-01 | 306 | v0 | 12 | 8 | 8 | 6 | 4 |
| | v3 | 2026-09-12 | 102 | isSeeded | 12 | 8 | 8 | 6 | 4 |
| `session-7bb…` | v0 | 2026-09-12 07:01 | 5345 | v0 | 112 | 131 | 135 | 19 | 4 |
| | v3 | 2026-09-12 06:45 | 696 | isSeeded | 112 | 131 | 135 | 19 | 4 |
| **`session-bc0…`** | **v0** | **2026-09-17** | **34468** | v0 | **659** | **673** | **682** | **291** | **121** |
| | **v3** | **2026-09-12** | **332** | isSeeded | **41** | **64** | **64** | **21** | **4** |

判读：
- 前两对：地标计数**逐项相等**，物理行差异来自 v0 打包/展开表示 vs v2 起 stream 内嵌表示（同一会话的两种编码，v3 为较新表示，无害）。
- 第三对：v0 在 v3 快照之后又长了 5 天、内容约 10 倍（653 assistant/message、673 tool/call、682 tool/result、291 user/message、121 turn/end 对 41/64/64/21/4），**是"陈旧高代文件遮蔽较新低代日志"的真实案例**。
- 两个构建的选择规则（源码）：0.1.1 `findLog` 拼死名 `session${logSuffix}`（`src-011 …/lib/index.js:1315-1334`）；0.2.0 `resolveGenerationInDirectory` 取最高代（`src-020 …/lib/index.js:3327-3357`）。因此同一目录：0.1.1 读 v0、0.2.0 读 v3，**读者不同则"会话"不同**。
- v3-only 目录对 0.1.1 **不可见**（实测 `loadStored` 返回 `undefined`；`store-syn-016` 合成库），不是"拒绝"。

（本节最初曾把"0.1.1 读 v3 目录得到 114123 事件"解读为"0.1.1 静默误读 v3 文件"；经 `findLog` 源码核对与合成库对照，实际是**0.1.1 读的是同目录的 v0 文件**——34468 行中 23404 行是打包 chunk 行，展开后正好≈114k 条 `assistant/chunk`。该误读结论已撤回。）

---

## 3. 0.2.0 代际与选择算法（引源码行号）

### 3.1 支持的代际

- `dsh-session-format-catalog/lib/index.js:41-63`：`currentVersion: 4`；codecs = `releasedV0…releasedV4SessionFormatCodec`；migrations = v0→v1→v2→v3→v4（链完整，无缺边）。`createSessionFormatCatalog` 在构造期强制"每个 0..4 代际恰有一个 codec、链无重复无缺口"（`dsh-session-format/lib/index.js:284-293`，缺边抛 `SessionFormatUnsupportedMigrationError` `:126`）。
- 高于当前代际一律拒绝：`plan()` `:132-136`；`readHeader()` `:301-306`；`artifactCodec()` `:334-339`。
- 目录内规范名：`CANONICAL_LOG_FILENAME = /^session(?:\.v([1-9][0-9]*))?\.jsonl$/u`（`dsh-session-format/lib/index.js:464`），压缩后缀由后端剥离（`dsh-session-persistence-jsonl/lib/index.js:747-775`）。v0 只能叫 `session.jsonl[.zstd]`，`session.v0.jsonl*`、大写 `.V4`、前导零 `.v04`、`.tmp` 皆**非规范**。

### 3.2 读取时的代际选择算法（核心）

```
dsh-session-persistence-jsonl/lib/index.js
:3327  async resolveGenerationInDirectory(dir, signal)      // “Select the numerically highest canonical generation”
:3340      const version = parseGenerationLogFilename(entry.name, this.compression)
:3348      否则若匹配“相反压缩后缀”→ 记入 opposite（随后 :3350 抛 encodingMismatch，整根不可用）
:3351      const latest = generations.sort((l, r) => r.version - l.version)[0]   // ← 按最高代选代
:3353-3357 return { sourcePath: latest.path, sourceVersion: latest.version,
                    currentPath: join(dir, generationLogFilename(currentVersion, …)) }
:3360  async findLog(id, signal)      // 跨 project 目录收集；多个目录命中同一 id → 抛 duplicate
:3078  if ("storedVersion" in result && result.storedVersion !== selected.sourceVersion)
         throw new Error(`session generation filename identifies v${…}, but its header identifies v${…}`)
:3031  async listArtifacts(signal)  :3043  仅吞 SessionFormatUnsupportedError / SessionPersistenceCorruptionError（其余错误外溢）
:3384  async assertStoredIdentity(...)      // 仅校验 header.id/cwd 指回被选路径（身份，不是内容包含）
```

**是否仍是"按最高代选代、不校验内容包含"：是。**
选择只依据**文件名的代际号**；被选文件的**头部**再做一次身份/代际一致性校验（`:3078`、`:3391`），但**没有任何**"高代文件必须包含低代文件全部事件"的校验：
- 读路径对历史代际（`sourceVersion < 4`）走内存迁移（`:2603-2645`，`prepareStoredMigration` → `prepareJsonlMigration`），对**当前代际**直接解析（`:2645-2646`）——**两者都不回看低代文件**；
- 写路径的"已是当前代际则直接续写"（`:2486-2522`）同样不看低代文件。
唯一涉及"包含关系"的校验只存在于**发布迁移结果**时的冲突判定：若 `session.v4.*` 已存在，则要求它与刚迁移出的字节**完全相等**（`publishPreparedMigration` `:2101-2105`，`verifyCurrentGeneration` `:1798-1831` 要求"目标字节以迁移结果开头且摘要相同"）。但如上所述，只要 v4 存在，选择算法根本不会去迁移 v3，所以该路径实际只在**并发双进程同时迁移**时可及。

### 3.3 代际与压缩后缀强耦合

`:3447-3451 checkRootEncoding()` 会遍历**整根**所有 project/session 目录找"相反压缩后缀"的文件，命中即抛 `encodingMismatch`（`:3490-3492`）。`:3434-3440 listSessionDirs()` 还会因 project 目录里存在扁平 `<id>.jsonl[.zstd]` 而抛 `legacyLayout`（`:3493-3495`）。两者都是**根级致命**，会把全部会话一起拖死（实测 S5/S6）。

---

## 4. 新旧字段差异

### 4.1 物理头部逐代对照（引源码）

| 代际 | 物理头部必需键 | 可选键 | 源码位置 |
|---|---|---|---|
| v0 | `type,version,id,createdAt,delegationDepth` | `cwd,parentSession,**seedLength**,origin,agentPreset` | `dsh-session-format-v0-to-v1/lib/index.js:1596-1610` |
| v2（v1 同形） | `type,version,id,createdAt,**isSeeded**,delegationDepth` | `cwd,parentSession,origin,agentPreset` | `dsh-session-format-v1-to-v2/lib/index.js:28-40`（逻辑）/`:149-204`（物理） |
| v3 | 同 v2（`assertReleasedV3Header` 仅换 version） | 同 v2 | `dsh-session-format-v2-to-v3/lib/index.js:398-404` |
| **v4（当前）** | `version,id,createdAt,isSeeded,delegationDepth`（物理行仍带 `type:"session"`） | `cwd,parentSession,origin,agentPreset` | `dsh-session-format-v3-to-v4/lib/index.js:946-975`（校验器）/`:1058-1101`（编解码） |

**唯一的结构性字段替换是 v0→v1**：`seedLength`（数值，缺省表示未播种）→ `isSeeded`（布尔）+ 头部**帧**携带的 `inheritedEventCount`：

```
dsh-session-format-v0-to-v1/lib/index.js:1707-1728
const seedLength = record["seedLength"] === void 0 ? 0 : sessionFormatCount(record["seedLength"], …)
…
isSeeded: record["seedLength"] !== void 0,
…
inheritedEventCount: seedLength
```
v1 起（含 v4）逻辑头部形状**完全一致**，后续三代只改 version 号与事件语义。

### 4.2 事件级语义差异（各边）

| 迁移边 | 语义变化 | 源码位置 |
|---|---|---|
| v0→v1 | "Identity format edge"：头部换代 + **展开 v0 打包 chunk 行**（`seq0/time0` + `text-chunks/reasoning-chunks/tool-call-chunks` → 逐条 `assistant/chunk`，`context.emitRun(run)`） | `.../v0-to-v1/lib/index.js:1805-1810, 1869-1878, 1900-1907` |
| v1→v2 | **`assistant/chunk` 不再作顶层事件**，嵌入 v2 `assistant/attempt`（必需 `turn,step,stream`）；`assistant/message` 增加必需 `stream`、可选 `usage,interrupted`；`session/end-seed` 增加可选 `inherited`；`session-log-deepseek/delivery-accepted` 增加可选 `sessionFormatVersion` | `.../v1-to-v2/lib/index.js:1-25, 367-380` |
| v2→v3 | 载荷准入/校验收紧（surface 事件集、source kind 清单、枚举校验） | `.../v2-to-v3/lib/index.js:1-30, 534-560, 680-690` |
| v3→v4 | **正文恢复必须显式提供子会话证据**：`sessionFormatV3ToV4`（`:1403`）的 `createStage()` 直接抛 `V3 catalog migration requires explicit historical child facts, including an empty array for a parent without children`，必须用 `createSessionFormatV3ToV4(children)`（`:1424`）绑定；V4 新增 tool 角色消息的原生准入、delivery watermark 与 catalog fact 校验 | `.../v3-to-v4/lib/index.js:1404-1443, 1042-1100, 1524` |

存储层含义：迁移 v3 会话时，**必须能列出同一根内该会话的 subagent 子会话**（`prepareStoredMigration` 里 `children = listArtifacts().filter(origin==='subagent' && parentSession===id)`，`dsh-session-persistence-jsonl/lib/index.js:2684-2687`），否则 `createStage` 必抛。这也是"读一个历史会话要扫全库头部"的原因（每次历史读都要 `listArtifacts()`）。

### 4.3 v0 载荷准入（本轮的实际阻断点）

```
dsh-session-format-v0-to-v1/lib/index.js:146-152   disposition(["mode","version","provider"],
                                                   ["label","agentProvider","agentModel",
                                                    "agentReasoningEffort","persona","toolFilter"])
:1584  if (event.type === "subagent/descriptor" && data["version"] !== 3) {
:1586      if (version === 0) throw new SessionFormatUnsupportedMigrationError(
              `${event.type} ${event.seq} uses unsupported descriptor version ${descriptorVersion}`);
:1289-1290 function subagentDescriptorValue(...) { literalValue(data["version"], [3], …) }
```
- v0 制品里 `subagent/descriptor` 只接受 **`version === 3`**；其余值在 v0 代际直接硬拒。
- 0.1.1-rc.2 写的是 version 2（`dsh-subagent` 现役树 `:328` `SUBAGENT_DESCRIPTOR_VERSION = 2`，payload 组装见 `:408-430`）。
- v2 与 v3 的成员差：v3 仅**新增可选** `agentReasoningEffort`（0.2.0 `dsh-subagent`:1390-1400 对比 0.1.1 `:408-430`），必需成员一致（`mode,provider`，continuable 另有 `label`；`agentProvider`/`agentModel` 必须成对）。
- ⇒ **从 v0→v1 的链看，0.1.1 的会话在"代际"上只差一个描述符版本号**，但官方链把它当硬拒；官方未提供任何 v0+descriptor-v2 的转换器/旁路（0.1.3-alpha.2 起各发布版本都带同一道门，见 §2.5/§8）。

---

## 5. 旧会话可读性判定

### 5.1 判定表（本轮实测）

| 会话来源 | 文件形态 | 0.1.1 读 | 0.1.7 读 | 0.2.0 读 | 说明 |
|---|---|---|---|---|---|
| 合成 v0（含 descriptor v3 / 无 descriptor） | `session.jsonl.zstd` | n/a | OK | **OK**（迁移到 v4，事件数一致） | 代际链本身可用 |
| 合成 v0（descriptor **v2**） | `session.jsonl.zstd` | OK | **拒** | **拒** | §2.5 最小对照 |
| 合成 v3（0.1.6 写入器） | `session.v3.jsonl.zstd`（v3-only） | **不可见**（`loadStored`=undefined） | OK | **OK** | 0.1.1 只找固定名 `session.jsonl.zstd`（§2.8） |
| 合成 v4（0.2.0 写入器） | `session.v4.jsonl.zstd`（v4-only） | **不可见**（同上） | OK | OK | — |
| 真实库抽样 8 个（3 个 v3 + 5 个最大 v0） | — | OK | OK | **OK**（102…7080 事件，~1s/会话） | 快 |
| 真实库 3 对双代目录（v0+v3 并存） | — | 读 **v0**（其中 1 例 v0 比 v3 晚 5 天、内容约 10 倍） | 读 v3 | 读 **v3**（其中 1 例只剩 09-12 快照） | §2.8：两侧读者不同则「会话」不同 |
| 真实库 40 会话细样（消息投影对照） | — | 40/40 可读 | — | **1/40 可读**（39 例因 descriptor v2 被拒） | 唯一可读的那 1 例：事件数 2 与消息投影哈希**完全一致** |
| 真实库全量 2456 会话 | — | — | — | **226 可读 / 2230 被拒（90.8%）** | §2.5；被拒会话在 0.1.1 侧可读（抽查已证） |

### 5.2 前置条件（能读旧会话需要什么）

1. **文件命名必须规范**：`session.jsonl[.zstd]`（v0）或 `session.vN.jsonl[.zstd]`（N≥1）；目录必须是 `<root>/<projectKey>/<encodeSegment(id)>/`（`projectKey` 见 `dsh-session-persistence-jsonl/lib/index.js:875-900`，`encodeSegment` 是单段注入安全编码 `:853-873`）。扁平 `<id>.jsonl*` 会**炸整根**。
2. **会话根**由组合配置给出：0.1.7 与 0.2.0 的 base 组合里都是 `root: !!js dshHomePath('sessions')`（`dsh-base/cordis.patch.yml:98-101` / `0.2.0 版 :130-133`）；本部署即 `~/.dsh/sessions`（隔离根 `~/.dsh-017/sessions`）。
3. **压缩模式必须与后端配置一致**（默认 `zstd` ⇒ `.jsonl.zstd`）；根内混入另一种后缀 ⇒ 整根 `encodingMismatch`。
4. **锁文件**：无需预置；写打开会 `mkdir` 会话目录并创建 `session.lock`（`SessionWriteLease.acquire` `:653-705`、`LEASE_FILENAME` `:643`，POSIX flock，**从不删除**）。只读不需要锁。
5. **没有索引/清单前置**：不存在必须存在的索引或 manifest；`list()` 就是遍历根目录 + 读每个制品首帧头部（`:3031-3057`）。
6. **读历史代际时的额外前置**：同一根内必须能列出该会话的子会话（v3→v4 需要 children 证据，§4.2）；`validateRelatedSources()` 会在迁移期间复核子会话集合是否变化，变化即报 `JsonlGenerationSourceChangedError` 并由读路径重试一次（`:2461-2465`）。

### 5.3 静默降级 / 静默丢弃风险点

| 风险 | 方向 | 实测/源码 |
|---|---|---|
| **残留在高代但信息量更少的文件** → 静默读到旧快照 | 静默丢数据（视图层） | 实测 S7（0.2.0 读 1 条而低代 v3 有 2 条；写打开成功，后续还会**在旧快照之上继续追加**） |
| **未来代际文件存在** → 会话从 `list()` 消失 | 静默消失 | 实测 S8（`list()`=[] ，`stat/read` 抛"upgrade the harness"） |
| **文件名/头部代际不一致** → `list()/stat()` 抛普通 Error | 响亮但**面状**（整根枚举失败） | 实测 S2/S3（`:3078` + `:3043` 只吞两类异常） |
| 根内出现相反压缩后缀 / 扁平遗留文件 | 响亮、整根不可用 | 实测 S5/S6 |
| 非规范命名（`.v0`、大写、`.tmp`） | 会话**不可见**（非"丢弃"） | 实测 S4 |
| 不可迁移的历史载荷（descriptor v2） | **响亮拒绝，不静默** | 全量预检（`:1586`，错误串含 `source v0 artifact remains unchanged`） |
| 旧构建（0.1.1）的定位规则只看固定名 | 高代文件**不可见**；双代目录**选到另一个文件**（可能与 0.2.0 读到不同内容） | §2.8（3 对真实双代目录；1 对内容相差 10 倍） |
| 头部的退役字段（`sandboxMode`/`approvalPolicy`） | 响亮拒绝（普通 Error） | `:797-806` + `:3076` |

**未发现**"迁移失败却写成空会话""事件被静默截断后发布"的路径：迁移失败时源文件不动、不发布目标文件；`list()`/`stat()` 只是不读正文。

---

## 6. 错误选择边界样例（自建假数据，全部在 `.workspace/audit-020/drill/`）

构造脚本：`sel.mjs` / `sel2.mjs` / `rewrite.mjs`（多帧 zstd 解/重编码 + 改头部代际 + 截断事件行）。

| 编号 | 目录内容 | 0.2.0 行为（实测输出摘要） | 结论 |
|---|---|---|---|
| **S1** | 只有 `session.v3.jsonl.zstd`（2 事件） | `list`=1；`read`=2 事件；`open(write)`=ok → **目录里随即多出 `session.v4.jsonl.zstd`** | 写打开会自动发布迁移结果（官方升级路径）；只读不发布（§2.6） |
| **S2** | `session.v4.jsonl.zstd`（合法）+ `session.v5.jsonl.zstd`（同一份 v4 字节） | 全部接口 `Error: session generation filename identifies v5, but its header identifies v4` | 文件名/头部不一致 → **普通 Error**（不是 typed 错误） |
| **S3** | v3 字节但命名为 `session.v4.jsonl.zstd` | `list`/`stat`：`Error: … filename identifies v4, but its header identifies v3`；`read`/`write`：`SessionFormatUnsupportedError: … uses log format v3, older than the supported v4, and this build ships no upgrade path for it` | ①整根枚举被一个坏文件炸掉；②读/写给出的诊断**具有误导性**（本构建其实有 v3→v4 链，只是选择算法按文件名取了 v4 通道） |
| **S4** | 只有 `session.v04.*`、`session.V4.*`、`session.v0.*`、`session.v4.jsonl.zstd.tmp-1234` | `list`=[]；`stat`=undefined；`read`=`SessionPersistenceNotFoundError` | 非规范名不参与选代 → 会话**不可见**（`.v0` 也不算规范名） |
| **S5** | 根内**另一个**会话目录放了明文 `session.v4.jsonl`（后端配 zstd） | 所有接口 `Error: session artifact … uses .jsonl, but this backend is configured for compression "zstd" …` | 根级编码检查 → **整根不可用** |
| **S6** | project 目录里放扁平 `‹id›.jsonl.zstd` | `list`：`Error: … uses the unsupported flat-file layout …` | 同上 |
| **S7（关键）** | 同目录：`session.v3.jsonl.zstd`（2 事件，**更完整**）+ `session.v4.jsonl.zstd`（手工截断成 1 事件，**更旧**） | `read`=**1** 事件（`["plan/mode"]`）；`stat`={v:4}；`open(write)`=**ok** | **"按最高代选代、不校验内容包含"复现成功**：低代的第 2 条事件被静默忽略，且写打开会在旧快照上继续追加 |
| **S7 续（关键）** | 在 S7 上做一次写打开并追加 1 条 | `before resume: current=[plan/mode]` → `after resume: current=[plan/mode,plan/mode]`；`session.v3.jsonl.zstd` 仍在磁盘上且仍有 2 条 | **永久性分叉**：当前代际从此只有"陈旧前缀 + 新事件"，低代那条事件（`session/end-seed`）在活跃路径上再也回不来 |
| **S8（关键）** | 同目录：合法 `session.v4.jsonl.zstd`（2 事件）+ `session.v5.jsonl.zstd`（头部 version=5、2 事件） | `list`=**[]**（静默）；`stat/read/write` = `SessionFormatUnsupportedError: uses log format v5, but this harness reads only v4: … upgrade the harness to open it` | 未来代际文件**遮蔽**同目录可用数据；列表侧静默消失、访问侧响亮失败 |
| S9 | v3-only + 只读打开 + 哈希比对 | 目录内容不变、文件 sha256 不变、事件 2 | 只读路径不落盘（备份/预检安全） |
| S10 | 合成 v0，多一条 `subagent/descriptor` v2 vs v3 | v2 拒 / v3 通过（其余完全相同） | §2.5 最小对照 |
| **S11（真实数据，关键）** | 真实库 `session-bc0…` 目录：v0 文件（mtime 2026-09-17，34468 行，682 tool/result、291 user/message、121 turn/end）+ v3 文件（mtime 2026-09-12，332 行，64 tool/result、21 user/message、4 turn/end） | 0.2.0 选 **v3** → 会话呈现为 09-12 的快照（09-12 之后 5 天、约 10 倍内容不可达）；0.1.1 选 **v0** → 完整 | S7 的危险在真实库**已经存在**：升级到 0.2.0 会让这个会话"回到 09-12"，且在 0.2.0 下续写会在陈旧前缀上继续追加 |

**源码侧补充（未做竞态实测）**：若两个进程同时迁移同一会话，先发布者胜出，后者的排他创建失败后会要求"现有目标字节 == 我的迁移结果"，不等则抛 `JsonlGenerationTargetConflictError`（`:2073-2116`、`:2023-2042`）；发布前后还会复核源文件身份（`JsonlGenerationSourceChangedError`，`:2083`）。

---

## 7. 迁移与校验方案

> 全部命令在仓库根执行；`WC=/home/CNS2026495165/dsh/.workspace/audit-020`。**下列步骤对本轮只读审计是"方案"，未对真实库执行写操作。**

### 7.1 步骤 0：只读预检（不改任何真实文件）

```bash
# 0.1) 全库只读迁移预检：哪些会话在 0.2.0 下可读 / 被拒（含拒因分类）
node $WC/drill/fullpass.mjs                      # 结果落 $WC/drill/fullpass-result.json
# 0.1b) 双代目录排查（最高优先）：找出同一会话目录里存在多个规范代际文件的会话，并比较两侧地标
node $WC/drill/dualgen.mjs          # 逐文件只统计行 type / 地标计数，不输出正文
# 0.2) 旧侧（0.1.1）可读性基线 + 新侧（0.2.0）消息投影对照（40 会话抽样，可调参）
node $WC/drill/manifest.mjs src-011 ~/.dsh/sessions $WC/drill/manifest-011.json 40
node $WC/drill/manifest.mjs src-020 ~/.dsh/sessions $WC/drill/manifest-020.json 40
```
判读：`manifest-*.json` 的 `sessions.<idHash>` 逐项比较（事件数、类型直方图、消息投影哈希、header 键集）；`error` 项即被拒会话。

### 7.2 步骤 1：备份与回滚点

```bash
cp -a ~/.dsh/sessions ~/.dsh/sessions.bak-$(date +%Y%m%d-%H%M%S)      # 回滚点 1：整根
sha256sum ~/.dsh/settings.yaml ~/.dsh/profiles/web/cordis.patch.yml  # 回滚点 2：配置指纹
```
注意：0.2.0 的写打开会**新增** `session.v4.jsonl.zstd` 并**保留**旧代际文件；回滚 = 删除本轮新增的 `session.v4.jsonl.zstd` 并恢复配置。**但回滚不是无损的**：旧构建只认固定名 `session.jsonl.zstd`（§2.8），若 0.2.0 期间产生的是 v4-only 会话，回滚后 0.1.1 将看不到它们；且真实库已存在「陈旧 v3 + 较新 v0」的目录（§2.8），两侧读者本就会选到不同文件，切换构建等于切换「会话内容」。

```bash
# 本轮新增文件清单（写操作前先记录）
find ~/.dsh/sessions -name 'session.v4.jsonl.zstd' -printf '%p\n' | sort > $WC/drill/published-before.txt
# 回滚
comm -13 $WC/drill/published-before.txt <(find ~/.dsh/sessions -name 'session.v4.jsonl.zstd' -printf '%p\n' | sort) | xargs -r rm -f
```

### 7.3 步骤 2：可迁移会话的无损判定标准

定义"无损"（可判定、可复现）：
1. **事件数守恒**：新侧 `events.length == 旧侧 events.length`（同一次"读-迁移"不得增删事件；v0→v4 链在**打包行**上会展开，故此项只在**同一物理帧语义**下比较，即已在 v4 的会话或 v1+ 会话；v0 比较应改用物理行数与 §7.3.2）。
2. **消息投影相等**：对每个事件调用该构建自己的 `deriveEventMessage`，把消息规范化 JSON 的 sha256 **排序后取多项集哈希**，两侧必须相同（`manifest.mjs` 已实现）。这是跨代际最可靠的内容守恒判据（事件词汇会变，消息语义不应变）。
3. **序号稠密 + 继承切割一致**：`seq` 从 0 稠密；`inheritedEventCount` 两侧一致（v0 的 `seedLength` → v4 的头部帧切割）。
4. **头部不变量**：`id/createdAt/cwd/parentSession/origin/isSeeded/delegationDepth/agentPreset` 逐键相等（v0 的 `seedLength` 映射为 `isSeeded=true` + 切割值）。
5. **类型直方图只允许白名单变化**：`assistant/chunk`→（v2 起）`assistant/attempt`/`stream`；其余类型集合应不变。

```bash
# 判据 2/3/4 的一键对照（旧侧 vs 新侧）
node $WC/drill/manifest.mjs src-011 ~/.dsh/sessions $WC/drill/m-011.json 200
node $WC/drill/manifest.mjs src-020 ~/.dsh/sessions $WC/drill/m-020.json 200
python3 - <<'PY'
import json
a=json.load(open('/home/CNS2026495165/dsh/.workspace/audit-020/drill/m-011.json'))['sessions']
b=json.load(open('/home/CNS2026495165/dsh/.workspace/audit-020/drill/m-020.json'))['sessions']
for k in a:
    x,y=a[k],b.get(k,{})
    if 'error' in y: print('REFUSED', k[:8], y['error'][:60]); continue
    ok = x['msgHash']==y['msgHash'] and x['msgCount']==y['msgCount'] and x['events']==y['events']
    print('OK' if ok else 'MISMATCH', k[:8], x['events'], y['events'])
PY
```
（本轮 40 会话细样中，唯一两侧都可读的会话判据 1–4 **全部通过**。）

### 7.4 只读快照的正确做法（针对 0.2.0 实际存储形态）

事实：会话存储是**每会话目录里的不可变代际 JSONL 文件**（`session.vN.jsonl.zstd`），当前代际是**追加写**；写者持有 `session.lock`（flock，POSIX 下进程死亡即释放，文件不删）；读者**不加锁**；**没有 SQLite/WAL/索引文件**（§1.11）。因此：

1. **不要**套用 `{readOnly:true}` + `VACUUM INTO` 到会话数据——这里没有数据库，该结论只适用于 SQLite 后端（本部署的 `~/.dsh/storages/usage/usage.db`+`-wal`+`-shm`，WAL 模式，见 `dsh-usage/lib/db.js:62-74`）。
2. **正确姿势**：`cp -a` 逐个会话目录（或 `rsync -a` 整根）。历史代际文件天然不可变；**当前代际**若正被追加，复制到的是"最后一次提交前缀 + 可能撕裂的尾帧"——0.2.0 的读路径会容忍并标记撕裂尾（`decodeStoredLog` 的 `tornTruncateTo/recoveredTail`；写入时才真正截断，`truncateTornTail`），所以快照可用，但应记录撕裂。
3. **验证快照**：对副本根做一次**只读**通过（`node $WC/drill/real-probe3.mjs` 或 `manifest.mjs` 指向副本根），逐个 `open(id,'read')`；失败的即"未提交/撕裂/被拒"。
4. **活跃会话**：复制前后比对 `size/mtime/ino`；若在复制窗口内变化，重读该会话直到稳定（读路径本身就有 revision-stable 重读循环，`readStableJsonlFile`）。
5. **不要复制锁文件当锁**；`session.lock` 是 flock 的载体，复制它没有锁定语义。
6. **一致性检查（可选）**：同根内所有会话的 `historicalCorpusRevision` 会在迁移期间被复核（`prepareStoredMigration` `:2680-2705`（`children` 在 `:2684`）），所以迁移期间**不要**并发写同一根——否则会触发 `JsonlGenerationSourceChangedError` 重试。

### 7.5 步骤 3：面向 descriptor v2 的处理选项（给执行档定夺）

1. **最小改动、最稳**：迁到 0.2.0 后把受影响的 0.1.1 会话**只按只读**使用（列表/统计可用），不下发"可续写"承诺；由使用方决定是否补写历史。
2. **一次性离线正规化（需自研，官方无此链）**：对受影响会话的**副本**，仅把 `subagent/descriptor.data.version` 由 2 改为 3（成员集是 v3 允许集子集，必需成员一致，§4.3），再让 0.2.0 写打开以发布 v4；必须逐会话走 §7.3 的无损判据，并保留原件。
3. **上游补链**：把 `assertReleasedEventPayload` 的 v0 分支扩为"接受 descriptor v2 并映射为 v3"，或按 `createSessionFormatV3ToV4` 的思路提供可注入迁移——属产品改动，不在本只读审计范围。

---

## 8. 未验证项

1. **descriptor v2 → v3 的"官方"旁路是否存在**：本轮确认 0.1.3-alpha.2/0.1.5-rc.3/0.1.6-alpha.2/0.1.7-rc.2/0.2.0-rc.1 的 v0→v1 **都带同一道门**；但未逐版本穷举 0.1.0–0.1.2 的每一个发布（0.1.2-rc.1 的该文件路径未能取到同形代码）。
2. **双代目录的全量排查**：本轮在某一时刻扫到 3 对 v0+v3 并存目录（§2.8），但这是**时间点快照**；迁移前应对全库重扫（`dualgen.mjs`），并对每一对判定「高代是否确实包含低代的全部地标」（本轮仅比较了 step/assistant/tool/user/turn 地标计数，**未做消息级比对**）。
3. **v0 打包行 vs v2+ 内嵌 stream 的完整等价性**：前两对双代目录地标一致，但未逐条比对消息内容（需先用 0.1.1 读 v0、再用 0.2.0 读 v3，比较消息投影哈希；本轮因两侧选择规则不同未做）。
4. **被拒会话的构成分析**：拒因分布已实测（seq 0 = 2184、中段 seq = 42、其它类别 = 4），但未逐会话核对"子会话 seed 描述符 vs 父会话回写描述符"的具体归属与占比。
5. **第二类拒因（4 会话，`agent/inbox/spliced` inserted message source sections）的完整文案与触发条件未取到**：本轮全量聚合把消息截断在 130 字符，且对最大 300 个 v0 会话的定向复扫未命中该 4 例（`secondclass.mjs`，scanned 300 / found 0）；需要一次带完整消息输出的全量复扫（约 35 分钟）才能定案。
6. **写打开在真实被拒会话上的行为**：会先 `mkdir`/建 `session.lock` 并尝试发布；按只读纪律**未对真实目录执行**，仅由源码推得（`:2454-2522`，其中 `claimWrite` 在 `:2486`；`:653-705`；`:2118-2141`）。
7. **并发迁移竞态**（`JsonlGenerationTargetConflictError` / `JsonlGenerationSourceChangedError`）未做双进程实测。
8. **0.1.7 隔离实例（3097）对自身的 `~/.dsh-017/sessions`**：本轮用 0.1.7 代码读的是 0.1.1 的库，未读 0.1.7 自己的库（其 descriptor 版本同为 3，预期可读，但未实测）。
9. **应用层可读性**：只验证到持久化层 `open/read`，未验证 Web/agent 投影层（`dsh-session-projection`、`dsh-session-query` 的应用路径）。
10. **消息级无损的样本量**：细样 40 会话中仅 1 个两侧都可读，判据 2 只有 1 个正样本。
11. **`compression: none`（明文）与 Windows 分支**：未实测；根级 `encodingMismatch` 的结论仅在 zstd 配置下取得。
12. **`storages/session_projcache` 的跨代际读兼容**：仅做配置/常量级检查（domain `version: 7`、记录带 `formatVersion: header.version`、陈旧即丢弃重建；`~/.dsh/storages/session_projcache/` 当前为空），未做代码级验证或实测重建。
13. **会话正文的语义等价性**：报告与 `.workspace` 产物中均无任何真实会话正文；只读探针为判定可读性在**进程内**解码了正文，但只输出计数、类型名与头部键名，未做人工语义抽查。
