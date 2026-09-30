# T07 · guard 工具链对 0.2.0 的前向兼容审计

> **轨道**：T07（审计阶段，只产出结论与方案，不改产品代码）
> **采样/试跑时刻**：2026-09-29（本轮，`date -Is` = `2026-09-29T17:18:31+08:00`）
> **边界**：只读审计 + 仅 `.workspace/**` 内试跑。**未触碰** 3080（0.1.1）/3097（0.1.7）两实例，
> **未起任何监听端口服务**，**未发起任何模型请求**，**未写 `~/.dsh*` 下任何文件**（仅只读打开）。
> 未使用 `sandbox_permissions`。所有写入均落 `.workspace/audit-020/t07-trial/**`（0700）。
>
> 与相邻轨道的分工：**T05**（会话格式增量）与 **T21**（会话数据面迁移判据）负责"格式差什么、数据怎么迁"；
> **T07 只回答"上一轮那套校验/保全工具链，在 0.2.0 上还能不能直接用、要改哪里"**。
> 两份报告在"0.1.7→0.2.0 会话格式零增量"这一点上必须一致（本档 §1.7 给出实测依据）。

---

## 0. 结论摘要

**一句话**：这套工具链**结构上仍然可用**，且本轮实跑**全绿**；但它有一处**版本硬编码族**（"高代 = v3"）
和一处**插件路径硬编码**，直接照搬到 0.2.0 会**静默测错对象或直接失败**。0.2.0 与 0.1.7 之间
**会话格式链零增量**（§1.7），因此**最省的做法不是重造，而是"同样本 + 0.2.0 链"复跑（零改造，§4.1）**，
另加一处**必须做**的路径参数化（`lib/dbfold.mjs`）。

### 0.1 分类计数（清点 28 个单元，§2 有逐条表）

| 判定 | 数量 | 代表 |
|---|---|---|
| **可直接复用**（零改造，已在 0.2.0 语境下实测或源码级证明） | **9** | `lib/probe.mjs`、`lib/select.mjs`、`zstdframes.mjs`、`guards.mjs`、`selftest.mjs`、`run-all.sh`、`run-a329-attribution.mjs`、`chain-driver.mjs`（v3 目标）、usage-v4 `tests/selftest.mjs` |
| **需改造**（有具体失效点 + 最小改造点） | **13** | `lib/dbfold.mjs`、`lib/expected.mjs`、`run-p0-freeze.mjs`、`run-p1-p9.mjs`、`run-p5-p6-p8.mjs`、`run-verify-invariants.mjs`、`run-p7-restore-drill.mjs`、`header-contract.mjs`、`fix-core.mjs`、usage-v4 `tests/*` |
| **已失效**（历史一次性件，不应带入 0.2.0） | **6** | `_audit/cmp.js`、`_audit/dl.sh`、`_audit/hdr.mjs`、`_audit/tally.mjs`、`deps-*.txt`、`diff-*/` |

### 0.2 三条最关键的发现

1. **【决定性好消息】0.2.0-rc.1 的已发布链能把冻结的 "官方链修复 v3" 工件逐字节复现出来。**
   用 `chain-driver.mjs` 的 `emit` 模式，把 `chainModules` 从 0.1.7 树换到 0.2.0 树（`.workspace/iso-020/npm-global/node_modules`），
   对 A/B/C 三个样本重产修复件，**sha256 与冻结件完全相同**（`612ec813…` / `8025135e…` / `195222ce…`，`cmp` 逐字节 IDENTICAL）。
   ⇒ 会话数据面的"修复/发布"语义在 0.1.7→0.2.0 之间**没有位移**（§1.4）。

2. **【必须改的硬编码】`lib/dbfold.mjs` 把"口径来源插件"写死成现役 0.1.1 的绝对路径。**
   `dbfold.mjs:18,24` 硬编码 `file:///home/<user>/.dsh/profiles/node_modules/@local/dsh-usage/lib/db.js`，
   且是**模块顶层 `await import()`**。在 0.2.0 迁移里这意味着：**测的永远是 0.1.1 的落库语义，且 attests 的是它的 sha256**；
   一旦该路径不存在（现役 home 被升级 / 换隔离 HOME），**任何 import 它的脚本直接崩**。
   已有旁证：上一轮的 `usage-v4-017/tests/run-verify.mjs:1346` 明确注释"**不加载其 dbfold.mjs，避免顺带 import 现役插件**"——
   即作者自己绕过过这个坑。**最小改造点 = 一个 env 覆盖（`GUARD_PLUGIN_DB_URL` 或 `--plugin-db`）**（§2.1）。

3. **【工具链从未验过 v4，而 0.2.0 产的就是 v4】**
   0.2.0 与 0.1.7 的 `SESSION_FORMAT_VERSION` **都是 4**；工件名规则 `generation === 0 ? "session.jsonl" : \`session.v${generation}.jsonl\``
   在两版中**同一行、逐字节相同**。而 `~/.dsh-017/sessions` 里**已存在 8 个 `session.v4.jsonl.zstd`**，
   工具链的样本却只有 v0 + v3，且 5 个脚本把"高代"**字面写死为 `session.v3.jsonl.zstd` / `generation: 3`（**16 行代码、24 处字面量**，另 2 处在注释）**。
   同时还测到：`header-contract.mjs` 对 v4 工件**直接判红**（`version-not-3`，exit 2）。
   ⇒ 若 0.2.0 迁移产生 v4 工件，工具链会"**看不到高代**"或直接失败（§1.5、§2.1、§3.4）。

### 0.3 给 0.2.0 迁移的一句话建议

**先用零改造的「同样本 + 0.2.0 链」复跑拿"数据面无损"的强证明（§4.1）**；
**再决定是否投入重冻结（§4.2）**——重冻结的代价是 `expected.mjs` + 16 行 v3 字面量 + 白名单机制类提升，
而它证明的是"新样本内部自洽"，**不是**"0.2.0 没改语义"（后者只有 §4.1 能证）。

---

## 1. 证据（当轮实测）

### 1.1 只读声明与不动点

| 项 | 值 |
|---|---|
| 试跑根 | `.workspace/audit-020/t07-trial/`（工具链副本 + 私有根，均 0700） |
| 工具链原件 | `workbuddy-reverse-proxy/proto/generation-preservation/`（**未改一字**，§1.6 有逐件 sha256） |
| 现役/隔离实例 | 3080 / 3097 **未起停、未访问**；未 `curl`、未连任何端口 |
| 网络 | 工具链全树 `grep -n "listen(|createServer|fetch(|http|127.0.0.1|3080|3097"` = **0 命中** |
| `~/.dsh*` 写面 | **0**（只读打开 `~/.dsh/storages/usage/usage.db`、`~/.dsh-017/storages/usage/usage.db`，由 `run-p7-restore-drill.mjs` 只读枚举） |
| 会话正文 | 本报告只出现计数、哈希、键形状与类型名，**不含正文、不含密钥、不含原始会话 id** |

### 1.2 端到端复跑：`run-all.sh` **ALL GREEN（5/5）**

在**原位**（仓库内）执行，用 `GPS_*` 环境变量把输入改指到**冻结只读证据 + 冻结预映像库**（避免为审计去读活库）：

```
── 真实退出码（logs/exit-codes.tsv）──
p0-freeze	0
p1-p9-select	0
p5-p6-p8	0
verify-invariants	0
selftest	0

ALL GREEN: P0/P1/P2/P3(模拟)/P4/P5/P6/P7/P8/P9 断言全过
```

私有根：`.workspace/audit-020/t07-trial/t07-priv-all`（`mode = 700`）。
`evidence/` 四件在位：`00-freeze.json`(347 KB) / `01-select.json`(22 KB) / `02-delta-gates-idempotence.json`(137 KB) / `03-invariants.json`(114 KB)。
总耗时 **≈4.8 s**。

**注意（编排缺口）**：`run-all.sh` **只编排 5 步**——`run-p7-restore-drill.mjs` 与 `run-a329-attribution.mjs`
**不在其内**，必须单独调用（§4 的验收序列已把它们补进去）。

### 1.3 逐脚本试跑结果

| 脚本 | 命令（试跑） | 结果 |
|---|---|---|
| `selftest.mjs` | `node selftest.mjs` | `{"pass":22,"fail":0}` exit 0 |
| `run-p0-freeze.mjs` | `--priv <新根> --src <冻结src> --cand <冻结out/repaired> --db <冻结预映像>` | `ok:true, failures:[]`, `privMode 700`, `sharedInodeCount 0`，`vnDigestMatchesDoc:false`（与历史 R-5 披露一致） |
| `run-p1-p9.mjs` | `--priv <根>` | `ok:true`；A=`T2/T2`、B=`T4(plugin)/T1(authoritative) **dependsOnPolicy=true**`、C=`T1/T1`；`rework[]` 含 **A index 329 / tool/result / payload-hash / unexplained** |
| `run-p5-p6-p8.mjs` | `--priv <根>` | `ok:true`；`E1 hazard shrinkOutput = 614139` 命中；`E2` anomaly `stale-higher-generation`（A: 654→hold 41）；`E3 pass1.scanned=3/newEvents=0`、`pass2.scanned=0`；`ccIdentical:true`；反并集禁用值 695/224/24 未出现；`publishV0Unchanged:true` |
| `run-verify-invariants.mjs` | `--priv <根> --src … --cand … --db …` | `ok:true`；`frozenSrcVnCount=3`、`frozenCandVnCount=2062`、9 个 pin 全 match |
| `run-p7-restore-drill.mjs` | `--priv <根>` | `RESULT = PASS`，`failures=0 stops=0`；预映像 62,513,152 B / `b2ebf06e170dc65c67d4e703…`；`restored == before` 逐值；真实库 `dsh` 单调不减（200,968 → 200,968）、`cc` 逐值不变；`user_version=1` / `application_id=1146312007` |
| `run-a329-attribution.mjs` | 默认根（在**副本**里跑） | **exit 2 FAIL**（§1.3.1） |
| `run-a329-attribution.mjs` | `A329_SESSIONFULL=… A329_GP=… node run-a329-attribution.mjs` | **exit 0 PASS**，13/13 断言全 OK |

#### 1.3.1 `run-a329-attribution.mjs` 的可重定位性（重要）

它用 `REPO = resolve(HERE,'..','..','..')` 自推仓库根，再 `join(REPO,'workbuddy-reverse-proxy')` **拼死兄弟目录名**。
把工具链整体复制到别处（本档的试跑副本）后，自推根就指向错误位置 ⇒ 三个输入全部 `MISSING`、`RESULT = FAIL`、exit 2。
但脚本头部提供了 `A329_SESSIONFULL` / `A329_GP` 覆盖入口，**设上就恢复 PASS**。
⇒ 结论：**"复制到别处直接跑"不成立；"原位跑"或"设 env 覆盖"成立**。0.2.0 迁移时**只需换这两个 env**，**不需要改脚本**。

#### 1.3.2 两处 fail-closed 行为的实测（不是纸面声明）

| 实验 | 命令 | 实测 |
|---|---|---|
| 拒绝覆盖既有证据 | 对已有 `db/restore-drill.db` 的私有根**不加** `--force` 重跑 | `exit 2`，`STOP-A4:path-guard-violation`，detail「已存在；拒绝覆盖既有证据（需显式 --force）」，**未 unlink、未 copy** |
| **`HOME` 决定"真实面"负向控制（新发现的静默缺口）** | `HOME=/tmp/<伪home> node run-p7-restore-drill.mjs --priv <根> --dest <根>/db/restore-drill-homeprobe.db` | **§6「真实库单调性/不变性断言」整段输出为空**（两条真实库一行都没枚举），**退出码仍为 0（PASS）** |

第 2 条是一个**真实的健全性缺口**：`FORBIDDEN_PREFIXES`（`run-p7-restore-drill.mjs:87-92`）与 §6 的真实库清单（`:443-446`）
**全部由 `process.env.HOME` 派生**。**0.2.0 隔离迁移的天然姿势就是改 HOME**——
一旦这么跑，脚本既不会拒收"落在隔离 home 下"的目标路径，也不会去核真实库不变性，**而且不报任何错**。

### 1.4 决定性实验：**0.2.0 已发布链逐字节复现冻结修复件**

被驱动件：`proto/session-copy-repair/lib/chain-driver.mjs`（`emit` 模式 = 应用本工具 `fix-core` 的 F1/F2a → 过真链 → 用**真实 v3 codec** 编码 → 按「header 独占帧 + 事件批帧」写出）。
这正是上一轮产出 `out/repaired/*` 的同一路径（对照 `out/run.json`：`command="repair"`、`artifactMode="chain-v3"`）。

| 样本 | 0.1.7 链产出 | 0.2.0 链产出 | 冻结件 | `cmp` |
|---|---|---|---|---|
| A | `612ec81395a305af…` / 6,638,062 B | `612ec81395a305af…` / 6,638,062 B | `612ec81395a305af…` / 6,638,062 B | **IDENTICAL** |
| B | `8025135e28210e37…` / 863,630 B | `8025135e28210e37…` / 863,630 B | `8025135e28210e37…` / 863,630 B | **IDENTICAL** |
| C | `195222ce405c4660…` / 45,733 B | `195222ce405c4660…` / 45,733 B | `195222ce405c4660…` / 45,733 B | **IDENTICAL** |

（A/B/C 三件与 `lib/expected.mjs` 的 `repairedV3.sha256Prefix` / `bytes` **逐值相符**；`outEvents` 4483 / 696 / 102。）

另：`artifact` 模式（用真链读取器直接读 v3 工件）在 0.1.7 链与 0.2.0 链上输出**完全相同**：
`{"ok":true,"outVersion":3,"outEvents":332,"inheritedEventCount":0}`。
`raw` 模式把 v0 过完整链：`outVersion 3`、`outEvents 4483`。

> **这条是本报告最强的一条**：它把"0.2.0 会不会把会话数据弄坏"从"读 release note 猜"变成"**同一输入、两个版本、同一字节**"。

### 1.5 v4 工件的读写面实测

以 `~/.dsh-017/sessions`（只读）为语料，用 **guard 自己的 `lib/probe.mjs` 原语**：

| 项 | 实测 |
|---|---|
| vN 文件构成 | `v4` × **8**、`v3` × 11（共 19） |
| `parseGeneration('session.v4.jsonl.zstd')` | `4`（**正则 `^session(?:\.v([1-9][0-9]*))?\.jsonl\.zstd$` 天然接受任意 N ≥ 1**） |
| `readRecords(v4)` | `frames=6, parseErrors=0, lineCount=20, headerVersion=4`（**无异常**） |
| `extractUsage` on v4 | 正常返回（样本为小测试会话，`authoritativeRows=0`、`carriers.excluded=1`） |
| **`header-contract.mjs` on v4** | **exit 2，`problems: ["version-not-3"]`**（对应 v3 工件 exit 0） |

⇒ **解析层已前向兼容 v4；契约/断言层没有。**

### 1.6 历史 sha256 常量当轮复核

| 历史值 | 本轮实测 | 对应文件 |
|---|---|---|
| guard `4c159098…` | `4c159098fbf0293524295afc5af0ed06a050415e16449f0efc2320b08cab7f8f` ✅ **相符** | `_migration/usage-v4-017/lib/ingest-dsh.js` |
| PPT `d2190648…` | `d21906483454e92719609d8e03021759cd4b10daf878efe1da8e76dda7ea21d1` ✅ **相符** | `_migration/ppt-017/dsh-pptmaster/lib/client.js` |

⚠️ **但这两个 seal 都是"迁移副本"的，不是"现役部署件"的**：

| 对象 | 迁移副本 | 现役部署（`~/.dsh/profiles/node_modules/@local/…`） |
|---|---|---|
| `dsh-pptmaster/lib/client.js` | `d2190648…`（seal） | `e2b5d28b45174e13ee8631719759a04d9902caf36c6e28b197cc3adb4de83790`（**不同**） |
| `dsh-pptmaster/lib/index.js` | `7eefe053…` | `7eefe053…`（相同） |
| `dsh-usage/lib/db.js` | `ecb86c23…` | `ecb86c23…`（相同；仓库源 `dsh-usage/lib/db.js` 是 **`48ea5758…`，不同**） |
| `dsh-usage/lib/ingest-dsh.js` | `4c159098…`（guard） | `f735185e…`（**未部署该 guard**） |

⇒ 0.2.0 迁移引用这两个 seal 时**必须连口径一起写**（"迁移副本 seal，非部署件"），否则会被读成"现役就是这样"。
另注：`ingest-dsh.js` 的哈希在历史报告里经历过 `b7be2b23…` → `9dbc35a4…` → `4c159098…`（`office-upgrade-p0-generation-guard-supplement.md` J-6 已登记"被审件在复核期间被改"）；
**本档只认本轮实测值 `4c159098…`**。

### 1.7 会话数据面 0.1.7 → 0.2.0 增量 = **零**（T05 交叉依据）

| 检查 | 实测 |
|---|---|
| `SESSION_FORMAT_VERSION` | 0.1.7 = **4**；0.2.0 = **4**（`dsh-session/lib/types/types.js:54`，两版同值） |
| 工件名规则 | `dsh-session-format/lib/index.js:474` 两版**同一行**：`generation === 0 ? "session.jsonl" : \`session.v${generation}.jsonl\`` |
| 格式链 6 包 `lib/` 逐文件 diff | `dsh-session-format` / `-catalog` / `-v0-to-v1` / `-v1-to-v2` / `-v2-to-v3` / `-v3-to-v4`：**diffFiles 全为 0** |
| `dsh-session-persistence-jsonl/lib/worker.cjs` | 仅 1 处内在检查改写（`Function.prototype.toString.call(name==="Array"?Array:Object)`），**不涉及帧编码** |
| 事件词表 `known-event-types.js` | **逐字节相同**（⇒ guard 赖以定载体的 `assistant/message`、`assistant/attempt`、`request/header`、`compaction/summary`、`session/title-llm-request`、`web/deepseek-search-llm-request`、`session/end-seed` 全部仍在） |
| `dsh-session/lib/index.js` 的 `session/end-seed` 写入逻辑 | **同形**（仅行号位移：887/1306-1312 → 927/1346-1352） |
| `dsh-session/lib/types/repair.js` | **有真实重构**：156 → 189 行，`pendingCalls` 裸 Map 改为 `ToolCallRecovery` 类；但**合成 id 模板 `\`${cause.kind}-tool-result-${callId}-${seq}\`` 保留**（见 §3.5 的影响面判断） |
| `dsh-home-paths/lib/index.js` | 0.1.7 vendored 副本 vs 0.2.0 = **同一 sha256 `97c1c10b…`** |

---

## 2. 脚本清点表

> "版本假设"一栏只列**会随 0.2.0 变化的**假设。所有 sha256 均为本轮实测（工具链文件与 §1.6 同批）。

### 2.1 A 组 · `proto/generation-preservation/`（主校验台）

| 文件 | sha256 | 作用 | 输入 | 输出 | 版本假设 | 0.2.0 可用性 | 最小改造点 |
|---|---|---|---|---|---|---|---|
| `run-all.sh` | `577cd01d…` | 编排 5 步 + 真实退出码落盘 + 私根 0700/0600 加固；fail-closed | `GPS_SRC`/`GPS_CAND`/`GPS_DB`（均有默认） | `<priv>/logs/exit-codes.tsv` + 各步 log | 路径推导 `${HERE%/workbuddy-reverse-proxy/*}` 依赖目录名 | ✅ **可直接复用（原位）** | 若复制到别处：**必须**同时给全三个 `GPS_*`（否则 `EVID` 推导失败 → `missing required input` exit 64）。**建议**把 `p7-restore-drill`、`a329-attribution` 纳入编排 |
| `run-p0-freeze.mjs` | `fd092314…` | **P0** 冻结一致性（空间/权限预检 → DB 只读预映像 `VACUUM INTO` → 普通复制 → 对拍）+ **P4** 源旧代 hash pin | `--priv`(须不存在) `--src` `--cand` `--db` | `<priv>/evidence/00-freeze.json` | **高代名 = `session.v3.jsonl.zstd`（6 行 / 6 处）** | ⚠️ **需改造** | 1) 把 6 处 `'session.v3.jsonl.zstd'` 改为取自 `expected.mjs` 的 `s.genHi.name`；2) `--db` 支持"0.2.0 隔离 home 的 usage.db"（env 已可覆盖，无需改码） |
| `run-p1-p9.mjs` | `92e543e4…` | **P1** 四态代选择 T1–T4（**双口径各判一次并显式对拍**）+ **P9** 位置前缀对齐与白名单/REWORK + **P6④** 反并集 | `--priv` | `<priv>/evidence/01-select.json` | **高代名 + `generation: 3`（2 行 / 10 处，`:44-45`）** | ⚠️ **需改造** | 同 P0 的 2 处字面量参数化。**其余逻辑（口径对拍、白名单单一实现、反并集）与版本无关，应原样保留** |
| `run-p5-p6-p8.mjs` | `25ee0743…` | **P5** 统计侧 delta / **P6** 不缩水+反并集硬闸 / **P8** 幂等；**P3** 离线新根模拟发布（原子 rename、永不写 v0 名） | `--priv` | `<priv>/evidence/02-…json` + `<priv>/db/work-e*.db` | 高代名（4 行 / 4 处，`:73,74,76,82`）；**`shrinkOutput === 614139`（`:163`）**；并集禁用值 654+41/112+112/12+12（`:295`） | ⚠️ **需改造** | 1) 参数化 4 处文件名；2) `614139` 与三组"禁用并集值"**按新样本重新离线算出后写死**（**禁止**从跑批倒推，沿用 `office-upgrade-p0-generation-guard-supplement.md` R-2 的纪律） |
| `run-verify-invariants.mjs` | `a4e3d0a8…` | 收尾不变式：**P2** 原物全留 / **P4** 源 hash 不变 / **P7** 原 DB 保全 | `--priv --src --cand --db` | `<priv>/evidence/03-invariants.json` | 高代名（2 行 / 2 处，`:73,74`）；`frozenSrcVnCount === 3`（`:65`）与 **`frozenCandVnCount === 2062`（`:67`）** | ⚠️ **需改造** | 1) 参数化 2 处文件名；2) 把 3 / 2062 变成"从新冻结根现算 + 与登记对拍"（写死会在换样本时瞬红） |
| `run-p7-restore-drill.mjs` | `2bdd9cd1…` | **U-C1** DB 预映像**还原演练**（含 A4 symlink 路径硬化、`-wal/-shm` 预写入闸、目标名白名单） | `--priv`（`--method vacuum|cp`、`--dest`、`--force`） | `<priv>/evidence/restore-drill.json` | **`FORBIDDEN_PREFIXES` 仅含 `~/.dsh`、`~/.dsh-017`、`~/.npm-global`、`~/.npm-global-dsh017`（`:87-92`）**；§6 真实库清单**仅含 `~/.dsh`、`~/.dsh-017`（`:443-446`）**；**所有前缀由 `$HOME` 派生** | ⚠️ **需改造（安全面，最高优先）** | 1) `FORBIDDEN_PREFIXES` 增补 **`~/.dsh-020`、`~/.npm-global-dsh020`（及实际选用的隔离根）**；2) §6 真实库清单同样增补；3) **把"$HOME 派生"改为"显式传入 + 缺失即 fail-closed"**（否则改 HOME 后 §6 整段静默消失，见 §1.3.2） |
| `run-a329-attribution.mjs` | `459f3d69…` | **U-A1** 把 A 的 `index=329` `tool/result +3B` 差异固化为**只读复跑**并给出机制归属 | `A329_SESSIONFULL` / `A329_GP`（env，可选） | 只写 stdout（**不落盘**） | 默认根落 `_audit/session-full-verify-<冻结日>` 与 `_audit/generation-preservation-<冻结日>`；样本 A 的 id 由 `expected.mjs` 钉死 | ✅ **可直接复用（原位 / 设 env）** | 换 0.2.0 样本时**只换两个 env**；**不要**改脚本。若坚持复制到别处：需改 `REPO` 推导（把 `workbuddy-reverse-proxy` 兄弟名参数化） |
| `selftest.mjs` | `fb0572ab…` | 纯合成语料自测：四态 T1–T4 / 白名单 / 规范名 / 反并集（22 例） | 无（内存造 Map） | stdout | 无（`generation: 3` 只是合成语料取值） | ✅ **可直接复用** | 可**增补** v4 合成用例（`gen({generation: 4, …})`）作为回归护栏，非必需 |
| `lib/probe.mjs` | `93ba6bb6…` | 解帧→逐行 JSON→事件信封四维（`seq/type/time/payload-hash`）→ usage 双口径提取→键集摘要→位置对齐→代次枚举 | `Buffer` | 纯函数返回 | 规范名正则 `^session(?:\.v([1-9][0-9]*))?\.jsonl\.zstd$`（**已前向兼容任意 vN**）；帧解码复用 `zstdframes.mjs` | ✅ **可直接复用** | **无**。已实测可读 v4（§1.5）。**唯一建议**：把"torn 末帧直接抛错"的语义在文档里显式登记（见 §5.2） |
| `lib/select.mjs` | `05130ef5…` | 四态判定 + **例外白名单的单一实现** + T3 修复判定 + 反并集闸 | 纯函数 | 纯函数返回 | 无版本常量 | ✅ **可直接复用** | **无**。若要提升 A329 类（§3.5），在此**新增一个机制类** |
| `lib/expected.mjs` | `56eb637b…` | 冻结基线与已知例外（"只引用，不发明"） | — | 常量 | **全部钉死在 0.1.1 期样本**：A/B/C 的 v0/oldV3/repairedV3 哈希与四桶、`DB_BASELINE_0928`、`VN_SET_DIGEST_PREFIX`、`KNOWN_PREFIX_EXCEPTIONS` | ⚠️ **需改造（换样本即必改）** | 见 §3 全节。**0.2.0 若要新样本，必须整份重冻结** |
| `lib/dbfold.mjs` | `7489de64…` | DB 只读快照/读数 + **代次感知折叠（候选语义，仅副本）**；schema 与 UPSERT 复用现役插件 `lib/db.js` | `DatabaseSync` 句柄 + 根路径 | 计数器/统计 | **`dbfold.mjs:18,24` 硬编码 `file:///home/<user>/.dsh/profiles/node_modules/@local/dsh-usage/lib/db.js`，且为模块顶层 `await import()`** | ❌ **需改造（关键，见 §0.2 第 2 条）** | 1) 加 `GUARD_PLUGIN_DB_URL`（或 `--plugin-db`）env 覆盖，默认仍指现役以保持向后兼容；2) `PLUGIN_DB_SHA` 必须随之重算（**它已经是"实际加载件"的 sha，语义正确，只需让路径可变**）；3) 被依赖的导出面 `{ensureSchema, insertEvent, rebuildDailyForDays, upsertSyncState, getSyncState}` 本轮实测在位 |
| `README.md` | — | 工具链自述（口径纪律、边界、不可证事项） | — | 文档 | 引 `_audit/session-full-verify-20260925-170505` 等日期化路径 | ⚠️ **需改造（文档）** | 0.2.0 复跑后须补：样本根日期、`--plugin-db` 用法、`expected.mjs` 重冻结流程、"run-all 不含 p7/a329" |

### 2.2 B 组 · `proto/session-copy-repair/lib/`（修复/真链生产端）

| 文件 | sha256 | 作用 | 输入 | 输出 | 版本假设 | 0.2.0 可用性 | 最小改造点 |
|---|---|---|---|---|---|---|---|
| `zstdframes.mjs` | `ccb1708c…` | 拼接帧容器原语：结构扫描 / 逐帧解码 / 逐帧重编码 | `Buffer` | frames / 文本 | 仅 `node:zlib`（`zstdDecompressSync`），**与 DSH 版本无关** | ✅ **可直接复用** | 无（Node 版本需 ≥ 具备 `node:zlib` zstd 的版本；本机 v22.23.2 实测可用） |
| `chain-driver.mjs` | `f6326b9c…` | 装载**真实发布物**驱动链：`createSessionFormatCatalog({currentVersion:3, codecs:[v0..v3], migrations:[v0→v1,v1→v2,v2→v3]})` → `createRestore` → 逐行 `decodeRow` → `finish()`；`emit` 用真 v3 codec 产出工件 | `<file> <raw\|repair\|artifact\|emit> <chainModulesDir> [out]` | stdout 一行 JSON（`emit` 另写工件） | **`currentVersion: 3` + 只加载到 v3 codec/migration（`:39-69`）** | ✅ **可直接复用（目标仍为 v3）**；⚠️ 若要产 **v4** 工件则**需改造** | 换 `chainModules` 到 0.2.0 树**无需改码**（已实测，§1.4）。若要 v3→v4 边：补 `releasedV4SessionFormatCodec` + `sessionFormatV3ToV4`，`currentVersion: 4`，并把 emit 的 `encodeHeader/encodeEvent` 换成 v4 codec |
| `fix-core.mjs` | `2eaf0d9e…` | F1/F2a 两处修复的纯函数 + 保守 gate + 深相等断言 | 事件行文本 | 修复后文本 | **v2→v3 专用**：`V3_ALLOWED_DESCRIPTOR_KEYS`（v2 键集 + `agentReasoningEffort`） | ⚠️ **需改造（若目标为 v4）** | 若 0.2.0 只要求 v3 中间态（当前链路就停 v3），**可不动**；若要产 v4，须按 v3→v4 的实际字段变化**重新推导键集白名单**（`dsh-session-format-v3-to-v4` 1552 行，含 `developer message` / `forked-tool-result` / `not-started` 等新形状） |
| `guards.mjs` | `80038535…` | 「零原件改写」闸门：源/输出根不得落在 `~/.dsh` 下、拒硬链接/软链、源前后 hash 不变、git 可追踪目录拒写、**工件名必须 `session.vN.jsonl.zstd`（N≥1）** | 路径 | 抛错/通过 | 版本假设**只有**"vN 命名"，且方向是"**绝不写 v0 名**" | ✅ **可直接复用** | 无。⚠️ 但同 §1.3.2 的 `$HOME` 派生前缀问题在此**同样存在**（"现役 home"判定同样只看 `~/.dsh`） |
| `header-contract.mjs` | `3494243b…` | **B4**：v3 工件 header 契约只读探针（键集 ⊇ `{type,version,id,createdAt,isSeeded,delegationDepth}`，**不含** `sandboxMode`/`approvalPolicy`） | `<artifact>` / `--root <dir>` | stdout JSON 汇总 | **硬编码 v3 契约** | ❌ **需改造（实测对 v4 直接判红）** | 1) 把"必须 version === 3"改为"version ∈ 支持的代次集"；2) 键集白名单**按代次分表**（v4 header 是另一份契约）。**在改造前，绝不能用它去验 v4 工件** |

### 2.3 C 组 · `_migration/usage-v4-017/`（统计侧迁移副本 + 其测试）

| 文件 | sha256 | 作用 | 输入 | 输出 | 版本假设 | 0.2.0 可用性 | 最小改造点 |
|---|---|---|---|---|---|---|---|
| `lib/db.js` | `ecb86c23…` | 与**现役部署** `@local/dsh-usage/lib/db.js` **逐字节相同**（本轮实测） | — | — | `import { dshHomePath } from "@deepseek-ai/dsh-home-paths"`（vendored 0.1.7 副本，`97c1c10b…`） | ✅ **可直接复用** | 无需改（vendored `dsh-home-paths` 与 0.2.0 同 sha256，实测） |
| `lib/ingest-dsh.js` | **`4c159098…`**（guard seal） | 迁移后的 `parseDshSession` / `usageKeySnapshot` / `generationDominates` / `foldDshSource` | 会话工件 | 事件/DB 行 | **v4 载体优先级 + `interrupted-tool-result-<callId>-<seq>` id 形状**；`EXCLUDED_TYPES` 含 `compaction/summary` 等 | ✅ **可直接复用** | 无版本硬编码（已实测其 `zstd.js` 为宿主 `scanZstdFrames` 的自写同构移植，宿主侧 0.2.0 仅 1 行内在检查变化）。**唯一未闭项**：`attempt` 载体优先级仍未部署（U-B1） |
| `tests/selftest.mjs` | `79ee1ab9…`（⚠️ 见 §5.3 N-6：与历史 pin `fcd3a979…` **已不同**） | 纯函数表 T-1* | 无 | stdout JSON | 无 | ✅ **可直接复用** | 本轮实测 `{"ok":true,…}`，含 1 条 `observations: A7-hidden-directory / open-undefined`（S-7 未满足，历史登记） |
| `tests/run-verify.mjs` | `4eee25b8…`（⚠️ 与历史 pin `e26ad93c…` **已不同**） | X1/X1b/X2*/X3/X4/X5/X6 全在 **DB 副本**上；X6 = 与冻结 proto 的 `authoritative` 口径对拍 | `--priv --frozen --proto` | `<priv>/evidence/09-summary.json` | **`:51-53` 硬编码 A/B/C 的 proj/dir/bytes/sha/四桶**（与 `expected.mjs` **重复一份**）；`:1050` 硬编码两个 live 项目目录名 | ⚠️ **需改造** | 1) 删掉重复基线，改为 `import { SESSIONS } from <proto>/lib/expected.mjs`（**消除双份常量漂移风险**）；2) 参数化 live 项目目录；3) `:1346` 保持"**不加载 dbfold.mjs**"的注释与做法，直到 `dbfold.mjs` 完成 env 参数化 |
| `tests/run-all.sh` | `5adf5bea…`（与历史 pin **相同**） | 预映像快照 + selftest + run-verify + 产物 hash pin | `<private-root> [--resnap]` | `<priv>/logs/exit-codes.tsv` 等 | `REAL_DB` 默认 `$HOME/.dsh/storages/usage/usage.db`；`:67` **硬编码 `$HOME/.dsh-017/profiles/node_modules/@local/dsh-usage/lib/ingest-dsh.js`** | ⚠️ **需改造** | 把 `:67` 的哈希登记项改为"当前部署件（可配）"，并补 0.2.0 隔离根对应项 |
| `tests/lib/fixtures.mjs` | `0f9e7696…`（与历史 pin **相同**） | 合成语料构造器 | — | — | 随 `run-verify.mjs` | ⚠️ **需改造（随动）** | 一般无需改；若新增 v4 载体用例需补 `msgUsage/msgStream/attempt/chunk` 之外的载体形状 |

### 2.4 D 组 · `_audit/` 一次性历史件（**建议不带入 0.2.0**）

| 文件 | 作用 | 失效原因 | 判定 |
|---|---|---|---|
| `_audit/cmp.js` | 读 `deps-*.txt` 打三版依赖差异表 | **写死三版**：`load('0.1.1-rc.2')`/`'0.1.5-rc.3'`/`'0.1.7-rc.2'`，输出表头也是这三列 | **已失效**（若需要，改成"版本列表参数"） |
| `_audit/dl.sh` | 批量 `npm pack` 指定包的三版 | 同上，版本数组写死 0.1.1/0.1.5/0.1.7；且 `cd` 进 `_audit` 假定 CWD | **已失效** |
| `_audit/hdr.mjs` | 读文件**首帧**打 header 首行 | `zstdDecompressSync(buf.subarray(0,8192))` 对拼接帧容器是**取巧**（可能截断首帧）；功能已被 `lib/probe.mjs::readRecords` 完全取代 | **已失效** |
| `_audit/tally.mjs` | 统计 `~/.dsh/sessions` 各代次文件数 | **硬编码 `root='/home/<user>/.dsh/sessions'`**，无参数 | **已失效** |
| `_audit/deps-0.1.1/0.1.5/0.1.7-rc.2.txt` | 三版依赖清单快照 | 缺 0.2.0；且 0.1.5 已无意义 | **已失效**（0.2.0 侧已有 `.workspace/audit-020/` 的更完整闭包分析） |
| `_audit/diff-{0.1.1,0.1.5,0.1.7}-rc.2/` | 逐版 CLI `lib/` 快照 | 只到 0.1.7；且 `MEASURED-BASELINE.md` §2 已证 CLI `lib/**` 三版逐字节相同 | **已失效** |
| `_audit/npm-cache*/`、`_audit/packs/`、`_audit/sub/` | 历史 npm 缓存/打包产物 | 与 0.2.0 无关 | **不适用**（保留但勿复用） |

---

## 3. `lib/expected.mjs` 白名单审计

### 3.1 它其实是**三样东西**，只有第三样是"白名单"

| 导出 | 行 | 性质 | 是否带机制依据 |
|---|---|---|---|
| `SESSIONS`（A/B/C） | `:10-47` | **冻结样本基线**：idHash、目录、v0/oldV3/repairedV3 的 `bytes`/`sha256Prefix`/`mtime`、四桶 `expect`、`docV3TsLaterRows` | 否。是"源未被改动"的比对锚（`run-p0-freeze.mjs:151-157` 逐值比对） |
| `DB_BASELINE_0928` | `:50-58` | 2026-09-28 现役 DB 快照登记（62,304,256 B、`2d6ec1ce…`、三表计数） | 否 |
| `VN_SET_DIGEST_PREFIX` | `:61` | vN 集合摘要前缀（构造须随引用写明） | 否 |
| **`KNOWN_PREFIX_EXCEPTIONS`** | `:64-70` | **位置前缀"已知例外"清单**（A: index 329 / 332；B: index 696；C: 空） | **部分是**：只有 332/696 两条 `kind: 'terminal-end-seed-time'` 有对应机制；**329 那条无机制依据** |

### 3.2 条目机制：**不带机制依据、** 但**禁通配**

逐条核对（源码级，本档实读）：

1. **条目的机制依据字段不存在。** A329 条目是
   `{ index: 329, kind: 'payload-value-diff', type: 'tool/result', bytesDelta: 3 }`——
   它是**位置+类型+字节差**的登记，**没有** `mechanism` / `basis` 字段。
   对照：`office-upgrade-p0-audit-20260929.md` §5 U-A2 曾**建议**该条目须含
   `mechanism:'stale-generation-message-id-remint'`、`basis:'candidate==v0'`——
   **本轮实测：该建议未被落实**（`grep -rn 'stale-generation-message-id-remint'` 全仓仅命中那条建议本身）。
2. **唯一带机制依据的白名单在 `lib/select.mjs`，不在 `expected.mjs`。**
   `classifyPrefixException()`（`select.mjs:25-51`）只授予**一类**例外：
   末条 `session/end-seed` 的 `time` 与**该代文件自身 mtime** 一致（`|Δ| ≤ STAMP_TOLERANCE_MS = 2 ms`），
   且必须同时满足 `leftType === rightType === 'session/end-seed'` ∧ `leftSeq === rightSeq` ∧ `leftIsLast === true` ∧ `dims === ['time']`（**仅 time 一维**）。
   `mechanismBasis` 字段**逐条生成**并写进证据（`run-p1-p9.mjs:110`），观测到 `+1 ms` / `0 ms`（§1.3 实测）。
3. **禁通配——实测成立。** `grep -n '\*\|RegExp\|glob' lib/expected.mjs lib/select.mjs` 只命中注释星号；
   匹配是**严格相等**：`run-p1-p9.mjs:117-122` 断言
   `exceptions.length === known.length && exceptions.every((e,i) => e.index === known[i].index && e.type === known[i].type)`。
   **没有 glob、没有正则、没有前缀匹配、没有"数量上限"。**
4. **`declaresNoDifference` 恒为 `false`**（`select.mjs:41,49,123` 与 `run-p1-p9.mjs:230` 三处硬编码）
   ⇒ 工具链**在任何路径上都不会宣称"两代无差异"**。这条纪律**有效且应保留**。
5. **未获机制依据的差异 → `rework[]` 并保留现场**（不 fail、但**不放过**）。本轮实测 A329 即此路径。
6. **⚠️ 断言强度缺口（本轮新发现）**：`expected.mjs` 条目的 `kind`、`bytesDelta`、`timeDelta` 三个字段
   **从未被任何断言读取**——只有 `index` 与 `type` 参与比对。
   ⇒ 这些"机制注释"**可以静默漂移**。实测 A332 的 `timeDelta`（733269）与 B696（945492）恰好与登记相符，
   但**这是巧合而非保证**。**最小加固**：`run-p1-p9.mjs:117-122` 的 `every()` 里补
   `e.timeDelta === known[i].timeDelta`（对 time 维）与 `Math.abs(e.bytesDelta) === known[i].bytesDelta`（对 payload 维）。

### 3.3 例外清单的"现行分类结果"（本轮实测）

| 样本 | 位置 | 维 | 类型 | 实测 | `select.mjs` 分类 | 后果 |
|---|---|---|---|---|---|---|
| A | 329 | `payload-hash` | `tool/result` | `data.message.id` 由 `…-328` 变 `…-132179`（+3 B） | **`unexplained`** | 进 `rework[]`，A 维持 `held-stale-higher` |
| A | 332 | `time` | `session/end-seed` | `timeDelta 733269`；`seed − file.mtime = +1 ms` | `terminal-end-seed-publish-stamp`（白名单） | 通过 |
| B | 696 | `time` | `session/end-seed` | `timeDelta 945492`；`seed − file.mtime = 0 ms` | 同上 | 通过 |
| C | — | — | — | 无差异 | — | 通过 |

### 3.4 **在 0.2.0 下白名单是否需要新增条目** —— 结论

**分两种迁移姿势回答，结论不同：**

**(甲) 姿势 = "同样本 + 0.2.0 链"（推荐，§4.1）：白名单不需要新增任何条目，且必须保持现状不动。**
依据：0.2.0 与 0.1.7 的格式链**零增量**（§1.7），且 0.2.0 链对同输入**逐字节复现**（§1.4）。
此时 `KNOWN_PREFIX_EXCEPTIONS` 的 3 条登记与本轮实测**逐条相符**（§3.3 已验证），
`expected.mjs` 应当**冻结不动**——任何"顺手更新基线"都是把证据锚点改成跟随实测的橡皮筋（违反 `expected.mjs:7-8` 的 S1 纪律）。

**(乙) 姿势 = "新样本（0.2.0 自产 v4 工件）"：白名单必须重做，且不只是"加条目"。**
必需三件事：
1. **整份重冻结** `SESSIONS`（新样本的 v0/vN 哈希、四桶、`docV3TsLaterRows`）——
   这是**基线**不是白名单，不能"加一条"了事。
2. **重算 `KNOWN_PREFIX_EXCEPTIONS`**：位置索引在新样本里**必然变化**（不同会话、不同事件数）。
   ⇒ 逐 index 登记的清单在新样本上**天然是错的**。
3. **把"机制类"补齐到 `select.mjs`（这才是重点）**：
   新样本上会**重新出现 A329 这一类**（`tool/result` 的 `payload-hash` 差异 = 陈旧代把
   `data.message.id` 的 `-<seq>` 后缀重铸为文件局部 seq；候选 == 权威 v0）。
   当前 `select.mjs` **没有**能识别它的机制类 ⇒ 它会**每轮都掉进 `rework[]`**（fail-closed 但阻塞迁移，且噪声会掩盖真正的未知差异）。
   **最小改造点（单点、可逐条实现）**：在 `lib/select.mjs::classifyPrefixException` 增加一个机制类
   `stale-generation-id-remint`，判据**必须可复算**、**不得用 glob**：
   ```
   条件：dims === ['payload-hash']
        ∧ leftType === rightType === 'tool/result'
        ∧ leftSeq === rightSeq
        ∧ 两侧 payload 的差异叶恰好 1 个、且叶路径 === 'data.message.id'
        ∧ 该 id 的差异为「`${前缀}-${数字}` 的数字部分不同」且一侧数字 === 本记录 seq
        ∧ 归属核验：右侧（候选）的 id 出现在该样本权威代（v0）中（`run-a329-attribution.mjs` 已有该复算能力）
   ⇒ whitelisted: true, class: 'stale-generation-id-remint', declaresNoDifference: false
   ```
   **且必须同时**把 `run-a329-attribution.mjs` 的归属复算纳入白名单判定的前置（否则"白名单无机制"会复现）。
4. **额外风险（0.2.0 特有）**：`dsh-session/lib/types/repair.js` 在 0.2.0 被重构
   （156 → 189 行、`pendingCalls` 裸 Map → `ToolCallRecovery` 类、待闭合工具的簿记条件新增
   `surfaceOp==='append' && turn/step 匹配`）。**合成 id 模板保留**，但"**哪些**待闭合调用会被补齐"变了
   ⇒ **A329 类的出现率/分布可能变化**，甚至可能出现**新的**前缀差异类。
   ⇒ 结论：**在新样本上，任何新的未解释差异一律不得靠"白名单扩容"消化**，
   必须逐条走 `run-a329-attribution.mjs` 式的机制归属（该脚本正是为此而生）。

### 3.5 A329 的现状小结（给裁决者）

* 机制**已被完整复算**：`run-a329-attribution.mjs` 本轮 13/13 断言通过，确认
  `diffLeaves===1` ∧ `leaf==='data.message.id'` ∧ `byteDelta===+3` ∧ `repId===v0Id` ∧ `oldId ∉ v0` ∧ `seq(rep)===seq(old)`。
* 并且本轮**新测到一条**：两代的该记录**原始键序不同**（`keysEqual(as set)=true` 但 `raw 键序相同=false`），
  归一到旧键序后字节差**恰为 id 长度差 +3** ⇒ 键序差**不构成语义差**，`payloadHash` 的差异**唯一来源就是 id**。
* **但改判仍未落地**（`expected.mjs` 无 `mechanism` 字段，`select.mjs` 无该机制类）。
* **改判的前置仍未做**：U-A3（`data.message.id` 是否参与宿主去重/会话视图键）在
  `office-upgrade-p0-audit-20260929.md` §5 被列为**必须前置**，本轮未发现其结论文档。
  ⇒ **本档不自行放行**；结论与历史一致：**A 维持 `held` + REWORK，除非 U-A2/U-A3 另有裁决。**

---

## 4. 0.2.0 验收命令序列

> 两条序列**互相独立**。**先跑 A**（零改造、证明力最强），**再决定是否投入 B**。
> 所有命令均**只读源 + 只写私根**；**不得**起监听端口、**不得**发模型请求。
> 记 `PRIV`/`EVID`/`GP`/`CHAIN020` 为变量；以下用实际路径书写。

### 4.1 序列 A（**推荐先跑**）· 同样本 + 0.2.0 已发布链 —— 零改造，证明"0.2.0 未改数据面语义"

```bash
cd /home/CNS2026495165/dsh/workbuddy-reverse-proxy/proto/generation-preservation

# 输入（全部只读）
export EVID=/home/CNS2026495165/dsh/workbuddy-reverse-proxy/_audit/session-full-verify-20260925-170505
export GP=/home/CNS2026495165/dsh/workbuddy-reverse-proxy/_audit/generation-preservation-20260928-152332
export CHAIN020=/home/CNS2026495165/dsh/.workspace/iso-020/npm-global/node_modules   # 0.2.0-rc.1 已发布物
export CHAIN017=/home/CNS2026495165/.npm-global-dsh017/lib/node_modules/@deepseek-ai/dsh/node_modules

# A-1 端到端 5 步（原位跑；给全三个 GPS_* 以免路径推导失败）
export GPS_SRC="$EVID/src" GPS_CAND="$EVID/out/repaired" GPS_DB="$GP/pre/usage.db"
PRIV=/home/CNS2026495165/dsh/.workspace/audit-020/t07-priv-A   # 必须不存在
./run-all.sh "$PRIV"

# A-2 P7 还原演练（run-all 不含它）
node run-p7-restore-drill.mjs --priv "$PRIV"

# A-3 A329 机制复算（只写 stdout）
A329_SESSIONFULL="$EVID" A329_GP="$GP" node run-a329-attribution.mjs

# A-4【决定性】0.2.0 链逐字节复现冻结修复件（对三个样本各跑一次）
EMIT=/home/CNS2026495165/dsh/.workspace/audit-020/t07-emit ; mkdir -p "$EMIT"
for spec in \
  "A:--home-CNS2026495165-dsh--:<session-dir-A>" \
  "B:--home-CNS2026495165-dsh--:<session-dir-B>" \
  "C:--home-CNS2026495165-RS--:<session-dir-C>" ; do
  IFS=: read L P S <<< "$spec"
  V0="$PRIV/src/$P/$S/session.jsonl.zstd"
  node ../session-copy-repair/lib/chain-driver.mjs "$V0" emit "$CHAIN020" "$EMIT/$L.v3.jsonl.zstd"
  cmp "$EMIT/$L.v3.jsonl.zstd" "$EVID/out/repaired/$P/$S/session.v3.jsonl.zstd" \
    && echo "[$L] 020-chain == frozen repaired: IDENTICAL"
done
# （样本目录名取自 lib/expected.mjs 的 sessionDir；本报告不转录原始会话 id）
```

**预期输出形态**

| 步骤 | 期望 |
|---|---|
| A-1 | `logs/exit-codes.tsv` = `p0-freeze 0 / p1-p9-select 0 / p5-p6-p8 0 / verify-invariants 0 / selftest 0`；末行 `ALL GREEN: …`；退出码 0。`evidence/` 四件 JSON 在位且 `ok: true` |
| A-2 | `RESULT = PASS`、`failures=0 stops=0`；`restored == before` 逐值；真实库 `dsh` 单调不减、`cc` 逐值不变；末行 `RESULT = PASS`，退出码 0 |
| A-3 | 13 条 `OK` + `RESULT = PASS`，退出码 0；其中必须含 `u-a1:repId===v0Id: …-<v0seq>` |
| A-4 | 三行 `IDENTICAL`（本次实测 A `612ec813…` / B `8025135e…` / C `195222ce…`） |

**失败判读（序列 A）**
* A-1 里 `p0-freeze` 非 0 → 冻结源被改动（S1），**立即停**，不要改基线迁就实测。
* A-1 里 `p1-p9-select` 非 0 → 出现**未解释差异**（`rework[]` 非空**不算**失败，但非零退出算）⇒ 保留私根现场，逐条走 A-3 式机制归属。
* A-2 非 0 → 预映像不可信（P7 硬失败）。
* A-4 出现 `DIFFER` → **0.2.0 改变了修复产物语义** ⇒ **最高优先级告警**（本档为零，但这正是要每次迁移都重测的原因）。

### 4.2 序列 B（仅在需要"新样本验收"时）· 0.2.0 自产样本的**重冻结**

> **前置**：先完成 §2.1 里 `expected.mjs` / `dbfold.mjs` / 5 个 run 脚本的改造（**16 行 v3 字面量 + 1 处 env 参数化**）。
> **纪律**：新样本的所有"期望值"（四桶、位置索引、禁用并集值、`shrinkOutput`）**必须离线先算后写死**，
> **禁止**从一次跑批结果倒推（沿用 `office-upgrade-p0-generation-guard-supplement.md` R-2 的既有纪律）。

```bash
cd /home/CNS2026495165/dsh/workbuddy-reverse-proxy/proto/generation-preservation

# B-0【必须先做】把 dbfold 的口径来源指到 0.2.0 部署件（改造后）
export GUARD_PLUGIN_DB_URL="file:///home/CNS2026495165/.workspace/iso-020/home/.dsh-020/profiles/node_modules/@local/dsh-usage/lib/db.js"
# 并把 ~/.dsh-020 / ~/.npm-global-dsh020 加入 run-p7-restore-drill.mjs 的 FORBIDDEN_PREFIXES 与 §6 真实库清单

# B-1 只冻结、不对拍（先看新样本长什么样）
node run-p0-freeze.mjs --priv "$PRIV_NEW" --src <0.2.0 会话树副本> --cand <0.2.0 链产出> --db <0.2.0 usage.db 只读预映像>

# B-2 用 run-a329-attribution.mjs 对新样本做机制归属（每个 unexplained 位置一次）
A329_SESSIONFULL=<新冻结根> A329_GP=<新旧代根> node run-a329-attribution.mjs

# B-3 重算期望值并写死到新的 expected.mjs，然后
node selftest.mjs && ./run-all.sh "$PRIV_NEW2"
node run-p7-restore-drill.mjs --priv "$PRIV_NEW2"
```

**预期输出形态**：与序列 A 同形（全 0 退出码 + `ALL GREEN`），但 **B 只能证明"新样本内部自洽"**，
**不能**证明"0.2.0 没有改变证据语义"——后者只有序列 A 的 A-4 能证。**这一点必须在验收报告里写明。**

### 4.3 序列里**不应做**的事

* **不要**起任何监听端口的服务，或用真宿主 `dsh` 去 `open` 这些工件来"验证无损"——
  工具链 README §4.1 已明确："**离线可读 ≠ 能打开 ≠ 可升级**"。
  真宿主 open 属于 U-D1（旧会话冷恢复）单元，需**独立组合 + 独立授权**。
* **不要**为了让 `run-all.sh` 变绿而放宽任何机制（glob、`seq` 当时间、改基线）。
  `office-upgrade-p0-audit-20260929.md` §5 U-B1 停止条件④已明令禁止。

---

## 5. 已失效部分清单 + 历史坑（避免重踩）

### 5.1 工具链中已被证伪 / 不再适用的部分

| # | 对象 | 判定 | 依据 |
|---|---|---|---|
| F-1 | `header-contract.mjs` 的 v3 契约（`version === 3`） | **已失效（对 v4）** | 本轮实测：v4 工件 → exit 2、`problems:["version-not-3"]`；v3 工件 → exit 0 |
| F-2 | `chain-driver.mjs` 的 `currentVersion: 3` + 只到 v3 的 codec/migration 集 | **不再是完整链** | 0.2.0 的 `SESSION_FORMAT_VERSION = 4`，且已装 `dsh-session-format-v3-to-v4`（1552 行）；脚本停在 v3 是**刻意的中间态**，但**不能**被表述为"完整迁移链" |
| F-3 | `fix-core.mjs` 的 `V3_ALLOWED_DESCRIPTOR_KEYS` | **v2→v3 专用** | 该键集是 v2 键集 + `agentReasoningEffort`；v3→v4 引入 `developer message`（`id/role/content/source`）、`forked-tool-result-*`、`not-started` 等新形状 ⇒ 白名单不可跨用 |
| F-4 | `_audit/{cmp.js, dl.sh, hdr.mjs, tally.mjs, deps-*.txt, diff-*/}` | **已失效** | 版本矩阵停 0.1.x；`tally.mjs` 硬编码现役 home；`hdr.mjs` 的取巧读法已被 `probe.mjs::readRecords` 取代 |
| F-5 | `README.md` §4.2 明示的"不覆盖 `v3→v4` 边" | **对 0.2.0 仍然成立（缺口未缩）** | 0.1.7 与 0.2.0 都是 `SESSION_FORMAT_VERSION = 4`、格式链零增量 ⇒ **这个边在 0.1.7 上就已存在**，0.2.0 既没扩大也没缩小它。**不得**在 0.2.0 报告里把它写成"新缺口"，也**不得**因为 0.1.7 用过就默认已覆盖 |
| F-6 | `expected.mjs` 条目的 `kind` / `bytesDelta` / `timeDelta` 字段 | **装饰性（未被断言）** | `run-p1-p9.mjs:117-122` 只比 `index` 与 `type`（§3.2 第 6 条） |

### 5.2 上一轮踩过的坑（迁移时**不要重复**）

| # | 坑 | 表现 | 本档位置 |
|---|---|---|---|
| K-1 | **测试工具缺陷被当产品故障** | `generationDominates` 的 torn 通道：**低代被截断 ⇒ 可见键集变小 ⇒ 陈旧高代反而"支配" ⇒ 静默采信**（真实 A 语料 1.0%–16.5% 截断区间内 62/160 切点假通过，损失量级与 `−614,139` 同）。exec 档把方向写成了相反的（保守面）并被复核推翻 | `office-upgrade-p0-generation-guard-review.md` §3、`…-supplement.md` §2 |
| K-2 | **"已修"误判**：torn 判据不是充分修法 | 在 zstd **帧边界**截断时 `torn === undefined` ⇒ torn 判据**原理性失明**（12.25% / 13.40% 两个真实切点仍假通过）。**帧边界截断在信息论上不可判**，只能靠**外部完整性锚**（冻结 manifest 的 `sha256`）+ 值域校验 | `office-upgrade-p0-generation-guard-supplement.md` §2/§3/§4 |
| K-3 | **兜底层次搞错** | 曾判"NaN 桶值不能绕过，因为落库必抛"——错：`foldDshSource` **只 INSERT 选中代**，**低代的 NaN 从不入库**，永不抛 ⇒ 低代 `NaN` 使 `shrink` 判据失明 = **假通过** | 同上 §1 |
| K-4 | **`sourceTransform` / "identity stub" oracle 错** | 用只产出逻辑对象、不产物理行的 identity stub 当 encoder，产出**非法 v3 工件**（真实读取器报 `lacks isSeeded`）。**"只改版本号"产不出合法工件** | `proto/session-copy-repair/lib/chain-driver.mjs:60-62` 注释 |
| K-5 | **常量错误 / 把历史常数当验收基准** | U-C1 原验收写死 `dsh 184,041 / cc 22,700 / sync_state 4,232` 等**历史绝对数**；审计 §9.2 明令**不得**作为基准 ⇒ 改为"**本次运行自绑定 before**"，历史值只作**信息性交叉提示**（脚本已按此实现，本轮实测 `selfBoundBefore=true, reusedHistoricalConstants=false`） | `run-p7-restore-drill.mjs` 头注 §9.2-1/2 |
| K-6 | **被审件在复核期间被改** | `ingest-dsh.js`：`b7be2b23…` → `9dbc35a4…` → `4c159098…`。**审计必须先钉哈希再下结论** | `…-supplement.md` J-6 |
| K-7 | **沙箱伪影当现场事实** | 委托子代理沙箱内 PID ns 隔离 ⇒ `ps -p <pid>` 恒返回 `NO_SUCH_PID`，与现场无关 | `office-upgrade-p0-audit-20260929.md` D-1 |
| K-8 | **"物理不存在"的误判** | 曾判"A 的修复高代在现有语料上不存在"，实测**物理存在**（6,638,062 B，654 键，`generationDominates=true`）⇒ 闸门是"**准入**"不是"**产能**" | `…-review.md` §5 + 勘误 E-1 |

### 5.3 本轮新识别的坑（建议登记）

| # | 坑 | 表现（本轮实测） |
|---|---|---|
| N-1 | **`$HOME` 派生真实面前缀 ⇒ 改 HOME 后安全断言静默消失** | `HOME=/tmp/<伪home>` 跑 `run-p7-restore-drill.mjs`：§6「真实库单调性/不变性」**整段无输出**，退出码**仍为 0（PASS）**。0.2.0 隔离迁移的天然姿势就是改 HOME ⇒ 必踩 |
| N-2 | **`dbfold.mjs` 顶层 `await import()` 硬编码现役插件路径** | 既导致"测错对象"（永远测 0.1.1 语义），也是"路径消失即崩"的单点。上一轮 `usage-v4-017/tests/run-verify.mjs:1346` 已用注释绕过 |
| N-3 | **同一套冻结常量被复制两份** | `proto/generation-preservation/lib/expected.mjs` 与 `_migration/usage-v4-017/tests/run-verify.mjs:51-53` 各有一份 A/B/C 的 bytes/sha/四桶 ⇒ 换样本时**极易只改一份** |
| N-4 | **"白名单条目带 kind/bytesDelta 但不被断言"** | §3.2 第 6 条；建议补 `every()` 比对 |
| N-6 | **guard 工具链自身已在报告 pin 之后被改（K-6 的活例）** | 本轮实测 `_migration/usage-v4-017/tests/selftest.mjs` = `79ee1ab9…`、`tests/run-verify.mjs` = `4eee25b8…`，而 `office-upgrade-p0-audit-20260929.md:197-198`（及 `office-upgrade-p0-exec-20260929.md:394-395`、`upgrade-usage-v4-migration-exec.md:266-267`）pin 的是 `fcd3a979…` / `e26ad93c…`。同目录的 `lib/fixtures.mjs`(`0f9e7696…`) 与 `run-all.sh`(`5adf5bea…`) **未变**。⇒ 0.2.0 迁移引用 C 组时**必须按本轮实测哈希**，不得沿用历史 pin |
| N-5 | **`run-all.sh` 不含 `p7-drill` / `a329`** | 只看 `ALL GREEN` 会漏掉"预映像可恢复"与"A329 机制复算"两项。0.2.0 验收序列必须显式补（§4.1 的 A-2/A-3） |

---

## 6. 未验证项（**不得当作已通过**）

| # | 未验证项 | 为什么没做 / 含义 |
|---|---|---|
| U-1 | **未对 0.2.0 自产的 v4 会话样本跑过完整工具链** | 0.2.0 隔离根（`.workspace/iso-020/home/.dsh-020`）目前**尚无 `sessions/`**，无 v4 样本可冻。本档只用 `~/.dsh-017` 的 8 个 v4 文件做了**读取面**实测（§1.5）。**"工具链能验 v4 样本"只证明了读写原语可用，未证明全套断言可用** |
| U-2 | **未执行真宿主 `dsh` open 任何工件** | 越界（需独立组合 + 授权）；工具链 README §4.1 亦明示"离线可读 ≠ 能打开 ≠ 可升级" |
| U-3 | **未跑 `usage-v4-017/tests/run-verify.mjs` 全量** | 需新私根 + 冻结源 + proto 三参数，且其 `:1050` 硬编码 live 项目目录名；本档只实跑其 `selftest.mjs`（`ok:true`）。⇒ **C 组的"需改造"判定是基于源码阅读 + 常量普查，不是端到端实跑** |
| U-4 | **未改任何脚本做"改造后"验证** | 本档是**审计档**，只给改造点，未落地（硬约束：不改产品代码/既有脚本）。⇒ §2 所有"最小改造点"**只到方案粒度，实测需在执行档补** |
| U-5 | **未验 0.2.0 原生（未替换）的 `@local/dsh-usage`** | 0.2.0 隔离根尚未安装该本地插件；`dbfold.mjs` 与 `ingest-dsh.js` 在**真实 0.2.0 组合**下的行为未测 |
| U-6 | **`data.message.id` 的下游语义（U-A3）仍无结论** | 该结论决定 A329 能否改判；未找到结论文档 ⇒ **A 维持 REWORK / held**（§3.5） |
| U-7 | **未复跑 `_migration/{ppt-017,btw-017,settings-017,web-search-sse-017}` 的测试** | 这四者**不是** guard/保全工具链，属被迁移资产（其自测见各自目录）；本档仅核对了 `ppt-017` 的 seal 哈希（§1.6） |
| U-8 | **`DB_BASELINE_0928` 的"地板"语义会随 0.2.0 组合变化** | 该常量只是 `>=` 地板，0.2.0 隔离 home 的 DB 若 `dsh` 行为 0（0.1.7 隔离库现状就是 **0 行**），`run-p5-p6-p8.mjs:280` 的 `global-vs-doc-floor` 断言在**新组合**上**必然失败** ⇒ 这是"换组合即需参数化"的另一处，本档**未实测**该失败，只是源码级推断 |
| U-9 | 报告未附原始会话 id / 正文 | **有意为之**（硬约束：报告不得含会话正文、密钥、原始会话 id）；样本目录名见 `lib/expected.mjs` |

---

### 附：本档试跑产物（供复核，均 0700，位于 `.workspace/audit-020/t07-trial/`）

| 路径 | 内容 |
|---|---|
| `proto/generation-preservation/`、`proto/session-copy-repair/` | 工具链只读副本（用于"复制后是否还能跑"的可重定位性实测，§1.3.1） |
| `t07-priv-1/` | 单脚本试跑私根（P0/P1-P9/P5-P6-P8/verify/p7-drill） |
| `t07-priv-all/` | `run-all.sh` 全量试跑私根（5/5 = 0） |
| `emit/repaired-{A,B,C}-{017,020}.v3.jsonl.zstd` | §1.4 决定性实验的产出（020 侧与冻结件 `cmp` 逐字节相同） |
| `a329.log` | `run-a329-attribution.mjs` 的完整 stdout（含两次：失败/成功） |
| `probe-v4-check.mjs` | §1.5 的 v4 只读探针（用 guard 自己的 `lib/probe.mjs` 原语） |
| `t07-priv-1/db/restore-drill.db`、`…/restore-drill-homeprobe.db` | §1.3.2 两次行为实测的产物（后者由 `HOME=<伪home>` 那次运行产生） |

> **体量说明**：`P5/P6/P8` 的三个中间实验库（`db/work-e*.db`，各 ≈62 MB）已在审计收尾时删除以控制工作区体量——
> 它们**不是证据**（`run-p5-p6-p8.mjs:43-48` 每次重跑都会从 `pre/usage.db` 重新派生），
> 结论证据在 `evidence/*.json`，全部保留。裁剪后 `t07-trial/` 约 368 MB。
