# B1-fix2 修订执行复核一体 —— 落地候选 / 补丁脚本 / 全绿自证

- 日期：2026-09-21
- 档位：**修订执行复核一体**（按已完成的执行前审计落地，不自行拆解、不扩范围）
- 独占目录：`.workspace/lag-fix/exec-b1/`
- 契约：`.workspace/lag-fix/exec-audit/b1/audit.md`（§2/§3/§4/§5）+ `.workspace/lag-fix/exec-audit/b1/DECISIONS.md`
- 上游关键工具（复用/改造）：`anchor-probe.cjs`、`fix-replay.cjs`、`mk-v2.cjs`、`B1-transform.v2-candidate.cjs`、`verify-v2-selfcheck.cjs`、`verify-b1-ctx-binding.A2-proposed.mjs`
- **沙箱边界（硬约束）**：`~/.npm-global/...` **本档不可写**。因此本档产出 = **可验证候选 + 补丁脚本 + 全部测试绿**；**deployed 写入由主 agent 用本档脚本执行**。
- 工具调用**未传** `sandbox_permissions`（审批已禁用，不可自内拓宽）；未重启宿主；未 `pkill`；未联网；未 `git commit`。

---

## 0. 一句话结论

**自裁决 = PASS（可落地）**。全部 5 个交付单元已实现并**真跑**通过：候选件 sha256 与审计期望值**逐字节相符**（`96ad39b7…` / `f4752c39…`），审计给的 40 锚点与新增的 24 条并集锚点**全部唯一命中**，反事实（`MAX=2` 低成本几何 + 201 原始几何）**0 → 1**，`verifyServerFilter` 反向对照 **9/9 被拒**，哨兵夹具三向自证通过。

**剩余阻塞只有一条，且是权限而非技术**：`deployed` 写入需由主 agent 执行 `node exec-b1/apply-B1-v2.mjs --apply`（本档沙箱对 `~/.npm-global/...` 只读）。**A6 活体集合等式**在重启前**必然**为 INCONCLUSIVE（宿主进程加载的是启动时的 v1 字节），重启后加 `--expect-deployed` 复验。

---

## 1. 交付单元实施（逐条对照审计 §7）

| 单元 | 审计要求 | 本档实施 | 验收证据 | 结论 |
|---|---|---|---|---|
| **DU-B1-A**（冷排序） | 采用**策略②B1**：`(b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt) \|\| (a.id < b.id ? -1 : 1)`；**不采用 A2**；注释须写明「最近」已窄化为「最近创建」，**不得让注释说谎** | v2 规格 `coldStmtLines()`：比较器换为新式（T4）+ 注释改为 3 行（T3，显式写「**createdAt 最近**」并说明为何必须回落） | `probe-b1-counterfactual.json` F7/F3；`apply-B1-v2.DRYRUN.json` 锚点组；v2 产物中 `(a.id < b.id ? -1 : 1)` == 1 次、裸比较器剩 1 次（收口） | **PASS** |
| **DU-B1-B**（running 计数） | 采用**策略①A2**：`childrenOf` 由 `ctx.sessions.list()` 的 `header.parentSession` 建边，与既有 `liveStatus` **合并同一趟**；**不叠加 keep-set 豁免**；签名已是 `(ctx, items)`，**不改签名与调用点** | v2 规格 `aggBody`（T1：`liveSessions` 三声明 + 单趟 for 内同时填 `liveStatus` 与建边）+ jsdoc 4 行同步（T2，含语义边界与消费方优先级） | 候选件 `const liveSessions = ctx.sessions.list();` == 1、`session.header.parentSession` == 1、`item.parentSessionId` == 0；签名/调用点逐字未变（锚点各 1 次） | **PASS** |
| **DU-B1-C**（回放规格 v2） | 把 `B1-transform.cjs` 更新为 v2（审计 §3.2 的 T1–T4）；**姿势 = 对 pre-image 重放**；`verifyServerFilter` 新增 V1–V7（含「引入标识符必须在本文件内有声明」、「首形参必须是 ctx」、「调用点实参 == 形参」） | `B1-transform.v2.cjs`（body 与审计预验证候选**逐字节相同**，仅新增决策标注头）；`apply-B1-v2.mjs` 以「v1 规格自证 pre→deployed 不变量 + v2 规格重放 pre→target」双轨落地 | `validate-verifier-v2.json` 30/30：V1–V7 由源码差分证实、M1–M5 全被拒、W1 不误报、C1（现行 v1 部署）判失败 6 项 | **PASS** |
| **DU-B1-D**（哨兵夹具） | 更新 `probes/verify-b1-ctx-binding.mjs` 的 `fakeCtx`（补 `header.parentSession`）；要求**对 v2 产物 PASS、对现行部署也 PASS（向前兼容）、相 B 反向对照仍有效** | `apply-sentinel-fixture.mjs`（dry-run 默认，`--apply` 写回）；补丁后文件落在 `sentinel/verify-b1-ctx-binding.patched.mjs` | `apply-sentinel-fixture.DRYRUN.json` 8/8：v2 候选件 **PASS**、现行部署 **PASS**、相 B 两处都仍抛 ReferenceError；**对照**：现行未更新夹具对 v2 候选件 **FAIL**（`Cannot read properties of undefined (reading 'parentSession')`） | **PASS** |
| **DU-B1-E**（回滚准备） | 固化 pre-image 与回滚命令；**明确警告** `index.buggy.js`（`f568f8a9…`）**不是** pre-image（是「已打 B1 但缺 ctx」的中间故障态），回滚脚本必须只认前者 | `du-E-rollback.mjs` + `results/pre-image-manifest.json`（权威回滚点 / 非-pre-image 警告 / 回滚命令 / 语义后果）；`apply-B1-v2.mjs --apply` 会自动产出 `backup/B1/server/b1fix2-<stamp>/{MANIFEST.json,pre.sha256.txt,rollback.sh}` | `du-E-rollback.json` 15/15：三个 sha 各自等于记录值、pre-image 无任何补丁标记、`index.buggy.js` 独立证实含聚合函数且**签名缺 ctx 形参** | **PASS** |

### 1.1 主 agent 两个已拍板决策的落实

1. **`lib/types/api-proxy.js` 一并改 + 显式标注「运行时不可达」**：
   - `B1-transform.v2.cjs` 文件头新增**表格化标注**：`lib/index.js` = 运行时唯一加载者（生效件）；`lib/types/api-proxy.js` = **运行时不可达**，改动属**一致性维护**，验收与回滚判据一律以 `lib/index.js` 为准；
   - `apply-B1-v2.mjs` 的 `SPEC_NOTE` 同样标注；
   - 回放规格仍对**两个**文件重放并各自校验 sha（`96ad39b7…` / `f4752c39…`）。
2. **A6 活体集合等式允许读 `~/.dsh/sessions`，只解首帧 header**：
   - `probe-b1-cold-order.mjs` 内置 `readDiscipline` 并**留证**：每文件**恰好 1 次** `open`+`read(8192)`、只解**第一个** zstd frame、只取 `id/createdAt/origin/parentSession`（+ `cwd` 仅布尔存在性）、不解析对话内容、不写会话目录；
   - 实测：880 个会话文件、880 次 read、**最大首帧仅 238 B**、放弃 0 条；
   - 报告与 JSON 都记录该纪律与实测值。

---

## 2. 必须真跑的自证（逐条落盘，不许只写"应当通过"）

全部结果落盘在 `exec-b1/results/`。一键复跑：`node exec-b1/run-all.mjs`。

### 2.1 锚点探针 0 失败（含锚点撞车处理）

| 项 | 要求 | 实测 |
|---|---|---|
| 审计探针 `anchor-probe.cjs`（**40 锚点 = 20 id × 2 排版**） | 全部按期望命中 | **0 失败**（`failures=0`, exit 0） |
| 撞车锚点 `B1a-comparator-bare` | 裸比较器**同文件 2 次** | 实测 **2**（冷候选 + 收口字面相同）⇒ 证明**不可**用单行 `.sort(...)` 作锚点 |
| 替换锚点用**带 `coldSource` 上下文的整条四行语句** | 恰好 1 次 | 实测 **1**（`const coldSubagentCandidates = coldSource` 语句，字节偏移 `@89296 L2248` for index.js / `@70908 L1476` for api-proxy.js） |
| **修订后该裸字面量应恰好剩 1 次**（可作验收断言） | == 1 | 候选件实测 **1**（`structuralPost` S1；仅收口那处） |
| 本档新增登记表（`lib/anchors.cjs`） | 每条唯一命中 | **24 id × 2 排版 = 48 条**全部按期望命中（其中替换锚点 **14 id × 2 = 28 条**） |

> **口径澄清（本档发现并修正的一处口径错位）**：审计 §1.3 的「14 个锚点」是**替换锚点**，§1.1/§1.2 的「40 个锚点」是**含撞车证据的探针锚点**，二者不是同一集合。
> 本档因此把两者显式分开：`REPLACEMENT`（14 条/文件，替换锚点）+ `INTEGRITY`（10 条/文件，不改写但必须命中，含负向控制 `runningIds` 期望 0）⇒ 去重并集 **24 条/文件 = 48 条**。
> 与审计的 40 条是**并行口径**，两处都必须 0 失败，均已实测 0 失败。

### 2.2 规格重放：两个候选件 sha256 == 审计期望值

```
index.js            期望 96ad39b7c37e1e0ab7ef07d991ee86f103c649b0ff595317ca32b6990a2c3310  实测 ==  217,279 B ✅
types/api-proxy.js  期望 f4752c39623f863f9e5c9e455d1226d933bc1950e7b8c12b92cce87658165734  实测 ==  175,895 B ✅
```

**零差异来源说明**：无需解释差异 —— 本档候选件的字节与审计期望值**完全一致**（不是"接近"，是相等），且**不硬编码**：
期望值由「v2 规格对 pre-image（`142aac84…`/`7f56fb80…`）重放」逐字节复现。审计 §0-E2 的不变量同时被双向钉死：

- `applyServerFilter_v1(pre_image)` == **现行部署**（逐字节，`1b9915f5…`/`f5c34a43…`）—— 证明 pre-image 与规格的对应关系成立；
- `applyServerFilter_v2(pre_image)` == **候选件**（`96ad39b7…`/`f4752c39…`）—— 证明 v2 的改动量就是设计的那 4 处。

### 2.3 `verifyServerFilter` 反向对照自证（9/9）

`validate-verifier-v2.mjs` → **30/30 PASS**，其中审计要求的九项：

| # | 项 | 结果 | 实测失败项数 |
|---|---|---|---|
| 1–2 | 正向：两个候选件零失败 | PASS | 0 / 0 |
| 3 | **M1** 去掉 `ctx` 形参（9-20 事故原形） | **被拒** ✅ | 9 项 |
| 4 | **M2** 形参改名（形参不匹配） | **被拒** ✅ | 5 项 |
| 5 | **M3** 冷候选退回裸比较器（B① 缺陷原形） | **被拒** ✅ | 3 项 |
| 6 | **M4** 血缘边退回由已截断行构建（B② 缺陷原形） | **被拒** ✅ | 2 项 |
| 7 | **M5** 调用点只传一个实参（arity 不符） | **被拒** ✅ | 3 项 |
| 8 | **W1** 控制：中性注释编辑不误报 | PASS | 0 |
| 9 | **C1** 对照：**现行 v1 部署被判失败**（证明有区分力） | PASS | 6 项 × 2 文件 |

**V1–V7 的差分提取（不手抄）**：直接 diff `spec/B1-transform.v1.cjs` 与 `B1-transform.v2.cjs` 源码，由源码派生「新增的字面量计数断言」，实测 **v1 3 条 → v2 9 条，新增 6 条、删除 0 条**（只增不减，防削弱），与审计 §3.3 的 V1/V2×2/V3×2/V4 逐条对上；V5/V6/V7 为结构断言（`freeIdentifierRoots` / 首形参 / 调用点 arity），证实 **v1 无、v2 有**。

**额外自证（审计未显式固化，本档补上）**：把 verifier 的**每类判据逐条破坏**（改期望值 / 把判定改成 `if (false)` / 把标识符过滤改成恒真），断言对应 check 由 PASS 变 FAIL。5/5 通过 —— 说明没有一条判据是**空转**的。

### 2.4 反事实：`__DSH_SUBAGENT_LIST_MAX=2` + 3 个子代理的低成本几何

`probe-b1-counterfactual.mjs` → **18/18 PASS**。被测函数体**不是手抄**，而是从两个真实产物按大括号配平切出的字节（legacy = 现行部署；fixed = v2 候选件）；`SUBAGENT_LIST_MAX` 表达式也从候选件切出并在 `globalThis.__DSH_SUBAGENT_LIST_MAX=2` 下求值（实测 `default=200`、`override=2`）。

| 夹具 | 几何 | 修订前 | 修订后 | 判据 |
|---|---|---|---|---|
| **F1（最低成本）** | `MAX=2` + 3 子代理，第 3 条（最新）running，该行被剔除 | **0** | **1** | 真值 1 由"未截断的同一 items 调同一函数"独立确立 |
| **F3（审计原始）** | 201 子代理、第 201 条 running、`MAX=200` | **0** | **1** | 同上；被剔除项实测 = `["s-201"]`（恰 1 条，正是 running 行） |
| **F2a** | 两级链 `p → a(running) → c(running)`，**c 自身行**被剔除 | **1** | **2** | 审计 §2.2 的 1→2 |
| **F2b** | 同上，**祖先 a 行**被剔除 | **0** | **2** | keep-set 豁免救不了这一格（A2 的关键优势） |
| **F4** | 零回归（无截断常规场景） | `p1:2,p2:1,a:-,b:-,c:-,d:-` | **逐行完全一致** | 零回归 |
| **F5** | 冷行（不在 live 表） | 0 | **0** | 不得凭空计数 |
| **F6** | 血缘环 `a↔b` | —— | **终止，值 0，0 ms** | seen 守卫有效 |
| **F7** | 两代比较器在同一份真实形状冷 meta 上的截断集合 | `legacy` 截断集 = 枚举序前 2（`NaN` 退化） | `fixed` = createdAt 降序前 2 | 实测两集合**不同** |

> **`MAX=2` 低成本几何的可用性验证**：真 MAX 常量读取 `globalThis.__DSH_SUBAGENT_LIST_MAX`，实测在 override=2 下求值 == 2 ⇒ `SUBAGENT_LIST_MAX=2 + 3 子代理` 与 `MAX=200 + 201 子代理` **几何同构**，无需真起 201 会话。
> 代价照录（审计 §4.3）：`globalThis` 覆盖需**重启**才在活体生效 ⇒ 本档只把它用于**离线几何**，活体复现留给主 agent 的可选步骤。

### 2.5 冷路径**集合等式**（oracle 只解首帧 header）

`probe-b1-cold-order.mjs` → 离线 **8/8 PASS**，A6 活体判定 **INCONCLUSIVE（如实记录，不冒充）**。

| 项 | 实测 |
|---|---|
| oracle 规模 | 880 个会话文件；**880 个首帧成功解出**、放弃 0 条；`origin` 直方图 `{subagent: 782, undefined: 98}`；id 唯一 |
| 读取纪律 | 880 次 `read(8192)`（每文件**恰好 1 次**）；**最大首帧仅 238 B**；无任何追加读取；只取 4 字段 |
| **期望集合 == 按键降序前 200** | **PASS**：`expected=200` 条；`subs=782`（确有截断）；三种枚举序（真 Fisher–Yates 置换）得到**同 1 个集合** |
| 修订前对照 | 三种枚举序得到 **3 种不同集合**（名额取决于 `readdir` 序） ⇒ 等式对"是否已修订"**有区分力** |
| 边界单调性 | `oldest-kept=1789712494453 >= newest-dropped=1789706425548` ✅ |
| **确定性（弱判据）** | 连续两次调用集合相同 = true —— **但审计 §4.4 明确：该断言在修订前也恒真，单独不构成通过**。本档把它单列为"弱判据"并与集合等式分开记录，**不用它冒充通过**。 |
| A6 活体判定 | **INCONCLUSIVE** —— 宿主进程加载的是**启动时**的 v1 字节（实测活体入选集合与 v2 期望、与 legacy 期望均不同）⇒ 写入 v2 产物**后需重启**，届时用 `--expect-deployed` 复验（该模式下升格为硬断言） |

**本档踩到并修正的 3 个 oracle 坑（都是 harness 缺陷，不是产品缺陷）**：

1. **漏掉 `meta.cwd === void 0` 过滤**：live 冷 filter 还要求 `cwd` 存在，漏掉会多留一批旧会话 ⇒ 集合等式假失败。修正后实测被剔除 0 条（当前库内全部有 cwd）。
2. **`(i * k) % n` 不是置换**：审计 §9 的"步长 7 置换"在 `n=201` 时恰好成立，但在 `n=782` 时 `gcd(7,782) ≠ 1` ⇒ 会重复索引并丢元素。已改为**确定性 Fisher–Yates** 并加"真置换"断言。
3. **"不同集合"被误算成"不同序列"**：对排序数组直接 `new Set(arr.join(','))` 去重得到的是**序列**种类数，会把同一集合的不同顺序误算成多种 ⇒ **假报**"入选集合与枚举序有关"。已改为按元素多重集比较。

### 2.6 `node --check` 与语义校验

| 目标 | 结果 |
|---|---|
| 候选件 `dryrun/index.js` | `node --check` **通过** |
| 候选件 `dryrun/types/api-proxy.js` | `node --check` **通过** |
| 更新后的哨兵 `sentinel/verify-b1-ctx-binding.patched.mjs` | `node --check` **通过** |
| 「引入标识符必须在本文件内有声明」（V5） | 两个候选件的聚合函数体自由标识符根 = `[Map, Set]`，**未声明 0 个** |
| 「首形参必须是 ctx」（V6） | `params=[ctx, items]` ✅ |
| 模板字面量残渣回归探针（审计 §8 坑#4） | 候选件内无 `${u}` / `${lit(` 残渣 ✅ |

---

## 3. 产物清单（`.workspace/lag-fix/exec-b1/`）

| 文件 | 角色 | sha256 前 16 |
|---|---|---|
| `B1-transform.v2.cjs` | **v2 规格**（可直接替换 `patches/B1-transform.cjs`） | `e42916fb21ad9626` |
| `apply-B1-v2.mjs` | **补丁脚本**（dry-run 默认，`--apply` 才写） | `15f648532632c90e` |
| `lib/anchors.cjs` | 锚点登记表（14 替换 + 10 完整性 = 24 id/文件） | `91bf2a1769691a42` |
| `spec/B1-transform.v1.cjs` | v1 规格**只读副本**（自证 §0-E2 不变量；body 与 `patches/` 逐字节相同） | `82582cd5334dca45` |
| `validate-verifier-v2.mjs` | V1–V7 差分提取 + 反/正向对照 + 破坏性自证 | `995e454a5766ce22` |
| `probe-b1-counterfactual.mjs` | 反事实几何 | `cd8e7ea5fc1d93d7` |
| `probe-b1-cold-order.mjs` | A6 集合等式 + oracle 读取留证 | `4735801eb777eb92` |
| `apply-sentinel-fixture.mjs` | 哨兵夹具更新（dry-run 默认） | `80d4eb136f34ff67` |
| `sentinel/verify-b1-ctx-binding.patched.mjs` | 补丁后哨兵（待 `--apply` 写回 `probes/`） | `9fd7763577a3d3b3` |
| `du-E-rollback.mjs` | pre-image / 回滚固化 + buggy 负向钉死 | `277e669d5ddf6cfb` |
| `run-all.mjs` | 一键复跑（沙箱 / `--post` 两口径） | `71eb7bc2e8ef80eb` |
| `provenance.mjs` | 自指纹 + 写入边界声明 | —— |
| `dryrun/{index.js,types/api-proxy.js}` | **候选件**（`96ad39b7…` / `f4752c39…`） | ✅ |
| `dryrun-apply/{index.js,types/api-proxy.js}` | `--apply` 全流程演练产物（同 sha） | ✅ |
| `results/*.json` | **全部原始 JSON**（10 份，见下） | ✅ |

**原始 JSON 清单**：`apply-B1-v2.DRYRUN.json`、`apply-B1-v2.STAGED.json`（apply 全流程）、`validate-verifier-v2.json`、`probe-b1-counterfactual.json`、`probe-b1-cold-order.json`、`apply-sentinel-fixture.DRYRUN.json`、`du-E-rollback.json`、`pre-image-manifest.json`、`provenance.json`、`run-all.SANDBOX.json`。

---

## 4. 主 agent 落地步骤（deployed 写入由你执行）

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-b1

# 0) 核对脚本指纹（与 results/provenance.json 对账，确认跑的是被验证过的那份）
node provenance.mjs

# 1) 写入 deployed（dry-run 默认不会写；--apply 才写）
#    脚本自带：三态 pin 校验 → 24×2 锚点唯一命中闸门 → 自动备份当前 deployed 态
#              → node --check → 引入标识符校验 → 事务式写入 → 写入后 sha/锚点复查
node apply-B1-v2.mjs --apply
sha256sum ~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js
#   期望 96ad39b7c37e1e0ab7ef07d991ee86f103c649b0ff595317ca32b6990a2c3310
sha256sum ~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/types/api-proxy.js
#   期望 f4752c39623f863f9e5c9e455d1226d933bc1950e7b8c12b92cce87658165734

# 2) 同步哨兵夹具（**必做**，否则重启后必然假 FAIL）
node apply-sentinel-fixture.mjs --apply

# 3) 用主 agent 的单一写入者替换 patches/B1-transform.cjs（本档未改本体）
cp B1-transform.v2.cjs ../patches/B1-transform.cjs

# 4) 重启宿主（**本批次最后一次动作**，不与 usage/ingest 批次合并计数）

# 5) 重启后活体验收
node run-all.mjs --post          # A6-live 升格为硬断言
node ../probes/verify-b1-ctx-binding.mjs
bash ../probes/verify-post-restart.sh
```

**回滚**（只回 B1）：`bash ../backup/B1/server/<b1fix2-stamp>/rollback.sh`（脚本由 apply 自动生成），或用 `results/pre-image-manifest.json` 里的 `rollbackCommand`。
⚠️ **回滚只认** `backup/B1/server/20260920-154039/lib/**`（`142aac84…`/`7f56fb80…`）；**绝不**用 `b1fix-20260920-183319/index.buggy.js`（`f568f8a9…`）—— 那是「已打 B1 但 `ctx` 缺参」的**中间故障态**，回滚到它会**复现** 2026-09-20 的 `ReferenceError: ctx is not defined` → HTTP 500。

---

## 5. 失败 / invalid / 剩余阻塞

| 项 | 状态 | 说明 |
|---|---|---|
| deployed 写入 | **未执行（权限阻塞，非技术）** | 本档沙箱对 `~/.npm-global/...` 只读；脚本已按"可被主 agent 直接执行"交付，`--apply --out ./dryrun-apply` 全流程已演练通过（39/39） |
| A6 活体集合等式 | **INCONCLUSIVE** | 重启前宿主仍加载 v1 字节，该等式**必然**不成立；离线集合等式已 PASS。**不得**用"两次调用相同"冒充通过（审计 §4.4 硬要求，已遵守） |
| 活体 201-subagent 反事实 | **未做（建议不做）** | 审计 §4.3 明示"真起 201 会话不建议"；本档用 `MAX=2 + 3 子代理` 低成本几何等价复现，并实测 MAX 覆盖点可用 |
| `patches/B1-transform.cjs` 本体替换 | **留给主 agent** | 按指令不改本体；v2 规格已就绪（body 与审计预验证候选逐字节相同） |
| `probes/verify-b1-ctx-binding.mjs` 写回 | **留给主 agent** | 补丁后文件已备好并三向自证；本档未触碰 `probes/`（`fe8cf12554f75b23…` 未变） |
| `A0/A1/A2/A3/A4/A7`（需要重启的活体验收项） | **未测（需重启）** | 属主 agent 重启后的验收范围；本档的 `run-all.mjs --post` 已把相关命令串好 |

**invalid 记录（本档内部发现并修正的错误，如实留痕）**：
1. `anchors.cjs` 初版把「完整性锚点」按 pre-image 计数 ⇒ 22 条假失败。**根因**：pre-image 比 deployed 少 4 个 B1 hunk，`MARK-*`/`B2b-*` 在 pre-image 内根本不存在。**修正**：登记表改为只对 **deployed / target** 两态断言，并把三态关系写进文件头。
2. `anchors.cjs` 初版有 2 行负向控制写反（`item.parentSessionId` 期望 0 却在 deployed 上为 1）。**修正**：删除该行（它已被替换锚点 `B2-edge-parent-from-item` 的 post=0 覆盖），并把 `runningIds` 负向控制保留。
3. `apply-B1-v2.mjs` 初版用 **v2 规格**校验 §0-E2 不变量 ⇒ 2 条假失败。**根因**：v2 规格**故意**产出不同字节。**修正**：新增 v1 只读副本，不变量改用 v1 规格自证，并加"v1 副本 body == patches 本体"的防篡改断言。
4. `probe-b1-counterfactual.mjs` 两个夹具期望值写错（F2 的成因、F3 的"被剔除者"）。**修正**：F3 改为"最新创建那条被 legacy 枚举序剔除"（与审计反事实一致），F2 拆为 F2a（自身行被剔除 1→2）/F2b（祖先行被剔除 0→2）。
5. `probe-b1-cold-order.mjs` 三处 oracle 缺陷（见 §2.5）。**修正**：补 `cwd` 过滤、改真置换、改集合（非序列）比较。
6. `apply-B1-v2.mjs` 备份目录名末尾多一个 `.`（`toISOString().slice(0,15)`）。**修正**：改为本地时间 `YYYYMMDD-HHMMSS`。

> 这 6 条都属**本档自证的 harness 缺陷**，全部在候选件**未被改动**的前提下修正；候选件 sha 自始至终等于审计期望值（可作为"修正未污染产物"的证据）。

---

## 6. 同一档内自复核 —— 对照审计逐条检查

### 6.1 遗漏检查（审计 §7 的 8 个单元 × 本档边界）

| 审计单元 | 是否属本档 | 本档处置 |
|---|---|---|
| B1-1（更新 spec 4 处） | ✅ | 已产出 v2 规格 |
| B1-2（新增 V1–V7） | ✅ | 已产出 + 差分提取 + 反向对照 |
| B1-3（备份当前 deployed + MANIFEST） | ✅ | `--apply` 时自动执行并已演练 |
| B1-4（对 pre-image 重放写回） | ⚠️ **写入需权限** | 脚本与候选就绪，写入由主 agent 执行 |
| B1-5（更新哨兵夹具） | ✅（脚本形式） | 补丁 + 三向自证；`--apply` 交主 agent |
| B1-6（重启一次） | ❌ 非本档 | 主 agent 批次内最后动作 |
| B1-7（重启后验收） | ❌ 非本档 | `run-all.mjs --post` 已备 |
| B1-8（更新 MEASUREMENT-STATUS.md） | ❌ 非本档 | 主 agent 文档线 |

### 6.2 副作用检查

| 检查 | 结果 |
|---|---|
| `patches/B1-transform.cjs` 是否被改 | **未改**（`0f3a66767874841b…` 与开工时一致） |
| `probes/verify-b1-ctx-binding.mjs` 是否被改 | **未改**（`fe8cf12554f75b23…`） |
| `~/.npm-global/...` 是否被写 | **未写**（dry-run 后复查 deployed sha 仍为 `1b9915f5…`/`f5c34a43…`） |
| `~/.dsh/sessions` 是否被写 | **未写**（只读首帧 header；只 `open('r')`，无写句柄） |
| 是否重启 / `pkill` / 联网 / commit | **全部未做** |
| 是否使用 `sandbox_permissions` | **未使用**（审批已禁用） |
| 与其它档的写入冲突 | **无**：本档写入仅落在新增目录 `exec-b1/**` 与 `backup/B1/server/b1fix2-*/`（其它档在 `exec-ingest`/`exec-p2`/`exec-theme`） |

### 6.3 真跑验证命令（原始输出摘要）

```
node exec-b1/run-all.mjs
  PASS [0] 审计锚点探针（40 锚点，0 失败）                      failures=0
  PASS [0] 审计回放（40 项，v2 规格 sha 自证）                  verdict PASS failures=0
  PASS [0] 审计 9 项自证（M1–M5/W1/C1）                        self-check PASS
  PASS [0] 落地脚本 dry-run                                    outcome=PASS checks=36/36
  PASS [0] V1–V7 差分提取 + 反向对照 + 破坏性自证               PASS 30/30
  PASS [0] 反事实几何                                          PASS 18/18
  PASS [0] A6 冷路径集合等式                                   离线 0 失败；A6 活体 INCONCLUSIVE
  PASS [0] 哨兵夹具三向自证（dry-run）                          PASS 8/8
  PASS [0] pre-image / 回滚固化                                PASS 15/15
  PASS [0] 候选件 index.js 语法 / api-proxy 语法 / 哨兵语法     全部 node --check 通过
  [run-all] PASS  失败 0/13

node exec-b1/apply-B1-v2.mjs --apply --out ./dryrun-apply
  [mode=APPLY] outcome=PASS  checks=39/39
  （备份 → backup/B1/server/b1fix2-20260921-163817/，含 MANIFEST.json + rollback.sh + 写入前态副本）

node exec-b1/provenance.mjs
  [provenance] PASS  失败 0 项 / 共 14 项
```

### 6.4 自裁决

> ## ✅ **PASS（可落地）**

依据：
1. **5/5 交付单元全部实现并真跑通过**，无一条"应当通过"式的空口陈述 —— 全部有落盘 JSON；
2. **候选件 sha256 与审计期望值逐字节相符**（`96ad39b7…` / `f4752c39…`），且期望值由规格重放复现而非硬编码；
3. **锚点闸门**（24 id × 2 排版 = 48 条，含撞车锚点的"恰好 1 次"验收断言）全部唯一命中，任何不符都在写入前 hard-refuse；
4. **反向对照齐备**：M1–M5 全被拒、W1 不误报、C1（现行 v1）判失败、verifier 5 类判据破坏性自证全部生效；
5. **反事实真跑**：`MAX=2 + 3 子代理` 低成本几何 0→1，201 原始几何 0→1，两级链 1→2 / 0→2，零回归逐行一致，冷行不计，环终止；
6. **A6 不冒充通过**：只有集合等式被认作真判据，确定性被显式降级为弱判据，重启前如实记 INCONCLUSIVE；
7. **无副作用**：`patches/`、`probes/`、`~/.npm-global/...`、`~/.dsh` 均未被本档写入。

**返工触发条件（若出现，请退回本档而非主 agent 自行处理）**：
- 主 agent 执行 `--apply` 时任一锚点非唯一命中 / 候选 sha 不符（脚本会 hard-refuse 并 exit 2）；
- 重启后 `run-all.mjs --post` 中 **A6-live 硬断言失败**（说明活体语义与期望集合不符，需重新审计冷路径语义）；
- 重启后 `session.list` 非 200 或出现 `ReferenceError`（说明 V5/V6/V7 未生效，属 P0）。
