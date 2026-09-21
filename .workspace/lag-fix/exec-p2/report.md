# P2AC 执行档报告（修订执行复核一体档）

- **档位**：修订执行复核一体（Revise-Execute-Review）。严格按 `.workspace/lag-fix/exec-audit/p2/audit.md` 落地，**未重新拆解、未扩范围、未做设计决策**。
- **目标文件（deployed）**：`~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js`
- **live sha256（本次全程首尾一致）**：`d71a8ca524307aa35b74c5504ce396458cd6cdd38bd2759be8e16bd1b783d69b`（397957 B / 10661 换行 / `split('\n')` 10662）
- **候选件 sha256**：`357f1703722464ee7fc40566f13e0ae4dd225131589862c8d1def67deb93d61f`（398569 B / 10667 行，Δ+5 行）
- **独占命名空间**：`.workspace/lag-fix/exec-p2/`
- **执行纪律**：工具调用**全程未传 `sandbox_permissions`**；**未写 deployed 目标**（沙箱写权限也仅限工作区内）；未重启、未 pkill、未发信号、未开浏览器、未 commit、未改 `patches/client-runtime-perf.sh`、未碰 C1/B1 脚本。
- **同档自复核裁决**：**PASS**（见 §9；无 REWORK）。

---

## 0. 结论摘要

| # | 必跑自证项 | 结论 | 证据 |
|---|---|---|---|
| 1 | 7 项锚点 `grep -cF` 全 == 1（候选生成前对 live 校验） | ✅ **PASS** | `results/anchors-grep-c.txt`（7/7 全 1） |
| 2 | 变体对拍 三态 × 六场景（含 `unpatched_reproduces_defect=true`、`member_gate_is_full_fix=true`） | ✅ **PASS** | `results/candidate-p2ac-verify.json`：**58 PASS / 0 FAIL**；四态 × 七场景全绿 |
| 3 | `harness-a-p2-stale-row.cjs` 18/18（改前态）＋ 候选态副本 18/18 | ✅ **PASS** | `results/`（baseline 18/18 实跑；候选态 18/18，同一实例两轮） |
| 4 | S-IDENT：两轮内容不变时 `published2 === published1` | ✅ **PASS** | 三态均 `same-ref`（候选件 true 实测） |
| 5 | S-CUTOVER：第 0 轮未改代码写入带 `child` 的 `listProjection`，第 1 轮补丁代码**首轮即清掉** | ✅ **PASS** | `["p","child"] → ["p"]` |
| 6 | 候选件 `node --check` + 标识符校验 | ✅ **PASS** | 21 项静态断言全绿（含 G5 标识符声明校验） |
| 7 | 反向对照：去闸门 / 基数式 / 声明放错缩进 **必须被判失败** | ✅ **PASS** | 6 个破坏变体全部被捕获（含**真实** T1/T2 复现 `ReferenceError`） |
| 附加 | 沙箱彩排：写路径 + 幂等 + 回滚真的可用（不碰 deployed） | ✅ **PASS** | 10/10 步 OK（`results/run-all-verify.json`） |
| ⚠️ | **E2 活体 stale row 只读判据** | **INCONCLUSIVE** | 见 §7，**不得**写成活体验收判据 |

---

## 1. 交付物清单（`.workspace/lag-fix/exec-p2/`）

| 文件 | 作用 |
|---|---|
| `candidate/client.js`（sha256 `357f1703…`） | **可验证候选件** = live + P2AC 4 处整行变换 |
| `candidate/client.js.source-mirror` | 该候选件对应的 **pre-image 副本**（`d71a8ca5…`），便于主 agent 现场核验 pre/post 关系 |
| `apply-P2AC.mjs` | 落地脚本：dry-run 默认、`--apply` 才写、`--print-target=<path>` 出候选、`--rollback`、`--preimage-only`；锚点唯一命中才写；自动 pre-image + `node --check` + 标识符声明校验 |
| `assert-candidate-static.js` | **静态断言脚本**（T1/T2/T3 机器判据，21 项 + 4 反向对照） |
| `verify-candidate-p2ac.cjs` | 候选件对拍（三态/四态 × 六/七场景 + 6 反向对照，58 项） |
| `verify-preimage.cjs` | pre-image / 候选件可复现 / live 只读 三方核对（9 项） |
| `harness-a-p2-stale-row-post-p2ac.cjs` | **候选态 harness 副本**（18/18） |
| `run-all-verify.cjs` | 一键跑全部闸门 + 沙箱彩排（10 步） |
| `preimage/20260921-165036/`（`client.js` + `.sha256` + `META.txt`）+ `preimage/CANONICAL.txt` | **独立 pre-image 回滚点**（从当前 live 取，非 R4） |
| `sandbox/deployed-client.js` | 沙箱彩排靶（`--apply` / 幂等 / `--rollback` 三态演练，非 deployed） |
| `results/anchors-grep-c.txt` | 7 项锚点 `grep -cF` 计数原始输出 |
| `results/candidate.diff` | live → 候选件 的完整 diff（4 个 hunk） |
| `results/candidate-static.json` | 静态断言原始产物 |
| `results/candidate-p2ac-verify.json` | 对拍原始产物 |
| `results/preimage-verify.json` | pre-image/可复现/只读核对原始产物 |
| `results/p2-stale-row-post-p2ac.json` | 候选态 harness 原始产物 |
| `results/run-all-verify.json` | 一键自证汇总（10/10） |

---

## 2. 逐单元实施（审计 §1/§2，逐字节照抄，不重新设计）

### 2.1 四处锚点（候选生成前 7 项 `grep -cF` 全 == 1，见 `results/anchors-grep-c.txt`）

| 锚点 | 锚点串（可移植，不含缩进） | 实测命中 | 动作 |
|---|---|---|---|
| **A1** | `if (current !== void 0 && currentAddress !== void 0) {` | 1（`:9294`，**4 Tab**） | 在其**上方**插入 1 行声明（**4 Tab**） |
| **A2** | `seen.add(childId);` | 1（**全文件唯一**，`:9299`，6 Tab） | 其后插入 1 行登记（**6 Tab**） |
| **A3** | `for (const id of Object.keys(previousProjection.byId)) if (byId[id] === void 0) byId[id] = previousProjection.byId[id];` | 1（`:9327`，**5 Tab**） | 2 行替换（**5 Tab**） |
| **A3′** | `Carry the previous projection's extra rows` | 1（`:9326`，紧邻 A3 上方，5 Tab） | **连行带换行整行删除**（T3） |
| **闸门** | `const nextById = previousProjection !== void 0 && reusedEntries === liveKeys.length ? previousProjection.byId : stableById;` | 1（`:9340`，**4 Tab**） | 4 行替换（**4 Tab**） |
| 参考 | `reusedEntries === liveKeys.length` / `const liveKeys = Object.keys(byId);` | 1 / 1 | — |

### 2.2 实际落地文本（与审计 §2.2/§2.3 逐字符一致）

```text
@@ A1（4 Tab，插在 `if (current !== …) {` 上方）
				const chainRowIds = new Set(); /* p2ac-fix */

@@ A2（6 Tab，紧随 `seen.add(childId);`）
						chainRowIds.add(childId); /* p2ac-fix */

@@ A3（5 Tab，替换旧散文注释 + 旧回拷行；注释整行连同换行删除）
					/* p2ac-fix */ /* address-chain scoped carry-forward: only ids a visited chain step genuinely needs. */
					for (const id of Object.keys(previousProjection.byId)) if (byId[id] === void 0 && chainRowIds.has(id)) byId[id] = previousProjection.byId[id];

@@ 闸门（4 Tab，4 行替换）
				/* p2ac-fix */ /* key-set gate: reusing the whole previous byId object is only sound when its key set has no extra key. */
				/* the previous key set is read AFTER the chain-scoped carry-forward, so it is compared against the same liveKeys. */
				const reusableByIdKeys = previousProjection !== void 0 ? Object.keys(previousProjection.byId) : void 0;
				const nextById = previousProjection !== void 0 && reusedEntries === liveKeys.length && reusableByIdKeys.length === liveKeys.length && reusableByIdKeys.every((id) => Object.prototype.hasOwnProperty.call(byId, id)) ? previousProjection.byId : stableById;
```

### 2.3 换行/缩进事实（机器核对）

- 缩进层级：`projectList` 方法体顶层 = **4 Tab**，`if (current !== …) {` 内 = 5 Tab，walk 内 = 6 Tab，`if (copiedPrevious) {` 内 = 5 Tab —— 插入文本**逐字符带 Tab**，无空格缩进（静态断言 S2/S8/S12 均核）。
- 行数 Δ = **+5**：A1 +1、A2 +1、A3 +1（2 新 − 1 旧行）、旧注释删除 −1、闸门 +3。
- 该 bundle 末尾**无换行**（10661 个 `\n`、10662 个 `split('\n')` 元素），脚本按原字节写出，未追加换行。

### 2.4 标记与命名（独立单元）

- 标记 **`/* p2ac-fix */`**，候选件内恰 **4** 处；**未复用** `/* dsh-perf-fix P2 v1 */`（live/cand 均为 2，未动）、**未复用** `/* dsh-lag-fix B1/C1 */`（live/cand 均为 0）。
- **未**把改动塞进 `patches/client-runtime-perf.sh`，**未**改 B1 脚本，**未** commit。

---

## 3. 真跑结果（全部落盘）

### 3.1 一键自证 `node run-all-verify.cjs` → **10/10 OK**（`results/run-all-verify.json`）

```
[OK] 0. pre-image + candidate reproducibility          （verify-preimage.cjs 9 PASS / 0 FAIL）
[OK] 1. candidate static assertions (T1/T2/T3 + 反向)   （assert-candidate-static.js 21 PASS / 0 FAIL）
[OK] 2. candidate variant matrix (3 forms x 6 scenarios)（verify-candidate-p2ac.cjs 58 PASS / 0 FAIL）
[OK] 3. PRE-state baseline harness                      （research-v2/.../harness-a-p2-stale-row.cjs 18 PASS / 0 FAIL）
[OK] 4. POST-state harness                              （harness-a-p2-stale-row-post-p2ac.cjs 18 PASS / 0 FAIL）
[OK] 5a/5b/6a/6b/6c  沙箱彩排：--apply / 结果==候选件字节 / 幂等 SKIP / --rollback / 回滚==pre-image 字节
```

### 3.2 变体对拍（`results/candidate-p2ac-verify.json`，58 PASS / 0 FAIL）

三态 × 六场景 + S-CUTOVER（矩阵与审计 §7.4 逐格一致）：

| 变体 | S1 清空 | S2 目录在+改名 | S3 目录缺席 | S4 改指 | S5 ids 变 | S-IDENT | S-CUTOVER |
|---|---|---|---|---|---|---|---|
| 未改（真函数） | `stale` ❌（`["p","child"]`） | ok | ok | `stale` ❌（`["p","child2","child1"]`） | cleared | same-ref | `stale` ❌ |
| **候选件文件字节** | **fixed** ✅（`["p"]`） | ok | ok（保留 `["p","child"]`） | **fixed** ✅（`["p","child2"]`） | cleared | **same-ref** ✅ | **fixed** ✅（`["p","child"]→["p"]`） |
| 派生成员性闸门 | fixed | ok | ok | fixed | cleared | same-ref | fixed |
| 基数式 P-AC | fixed | ok | ok | fixed | cleared | same-ref | fixed |

关键 flag 实测：

```
candidate_matches_audited_patch = true     （候选件 projectList 字节切片 == live 切片 + 审计变换，逐字节同一）
unpatched_reproduces_defect     = true     （未改代码在 S1/S4/S-CUTOVER 上复现 stale）
candidate_file_is_full_fix      = true
member_gate_is_full_fix         = true
count_gate_is_full_fix          = true
p2_identity_preserved           = true     （published2 === published1）
cutover_drops_preexisting_stale_row = true （第 0 轮旧代码写入 ["p","child"]，第 1 轮候选件清掉）
reverse_controls_caught         = true     （6/6 破坏变体被捕获）
```

方法学守门：**同一场景两轮跑在同一个 `SessionRuntime` 实例上**（审计 §7.5）；S-CUTOVER 用显式搬运 `listProjection` 的独立函数实现。

### 3.3 候选件静态断言（`results/candidate-static.json`，21 PASS / 0 FAIL）

`T1_declaration_scope_ok=true`、`T2_anchor_position_ok=true`、`T3_whole_line_deletion_ok=true`、`reverse_controls_caught=true`。

其中 T1 用**双判据**（括号栈 + 缩进开启行）交叉验证：声明所在行的最外层 `{` 块与 `const copiedPrevious` 同一块，且该块的开启行是 **3 Tab 的 `projectList() {`**（`:9272`）——不是 4 Tab 的 `if (current !== …) {`，也不是 walk 体。

### 3.4 pre-image / 可复现 / 只读（`results/preimage-verify.json`，9 PASS / 0 FAIL）

- pre-image 取自**当前 live**（sha256 `d71a8ca5…`），`META.txt` 含 `unit=P2AC-unit` / 绝对 `target` / `pre_sha256` / 回滚铁律。
- **候选件可复现**：用同一套变换从当前 live 在内存重算 ⇒ sha256 == 候选件 sha256（证明候选件不是手改）。
- ⚠️ 已按审计 §1.2 拒用 `backup/R4-20260921-115821/deployed/client.js`（`eeb5dcf2…`，宿主侧另一个同名 71 KB 文件，**不是**本 bundle 的 pre-image）。

---

## 4. 三处陷阱的机器断言（要求项 2）与**实测新增的第四处**

### 4.1 T1 作用域（要求项）

- 静态断言：声明行缩进 == **4 Tab**；声明的最外层块 == `const copiedPrevious` 的最外层块；该块开启行 = `projectList() {`（3 Tab）。
- **真跑反证**（不是推理）：把声明放进 `if (current !== void 0 && currentAddress !== void 0) {` 块内（5 Tab）⇒ 首轮 `projectList()` 抛 **`ReferenceError: chainRowIds is not defined`**；放进 walk 循环体（6 Tab）⇒ 抛 **`ReferenceError: Cannot access 'chainRowIds' before initialization`**。两者都被 verifier 判为"已捕获"。

### 4.2 T2 锚点位置（要求项）

- 静态断言：声明索引 < `const copiedPrevious` 索引 **且** < `if (current !== void 0 && currentAddress !== void 0) {` 索引；声明行本身不含 `copiedPrevious`。
- **真跑反证**：把声明锚在 `const copiedPrevious`（walk 之后）⇒ 首轮抛 `Cannot access 'chainRowIds' before initialization`，被捕获。

### 4.3 T3 整行删除（要求项）

- 静态断言：旧散文注释 0 次；候选件内 **不存在孤立 8 Tab 行**、不存在 5 Tab 空白行；改动区内空白行数 == 0；空白行总数 == pre-image 空白行数（4 行，全在改动区外）；A3 注释头与链域回拷行相邻且同为 5 Tab。
- **真跑反证**：把旧注释"只替换文本、不删整行"⇒ 旧语句原样残留（`a3OldSurvives=true`）且产生孤立空白行 ⇒ 被捕获。

### 4.4 ⚠️ 落地时实测踩到的第四处陷阱（审计未列，本档已修并已机器化）

**只把探针串（去缩进的那一行内容）交给 `split/join` 会切在行中间**：探针之前的缩进字节留在前半段，替换文本自带的缩进再叠上去 ⇒ **缩进翻倍**（A3 变 **10 Tab**、闸门变 **8 Tab**），而且 A3 行里那条旧语句**原样残留**（条件仍是 `byId[id] === void 0`）——"看着像替换成功、语义却没变"。

- 现象（首次生成的候选件，已废弃）：A3 行 10 Tab、闸门行 8 Tab、旧语句仍在。
- 修复：A1/A2/A3/闸门**一律走「整行替换」**（行首 Tab 由探针行实测取得，`spliceWholeLine`）。
- 机器化：A3/闸门替换后**行数必须为 5/4 Tab**（静态断言 S8）、旧语句必须 0 次（S9）、缩进翻倍会同时让 S7b/S12 失败。
- 溯源：本档的 `verify-preimage.cjs` 的"候选件可复现"检查正是靠这条才抓到该问题（复算 sha256 ≠ 候选件 sha256）。

另外两处**口径修正**（本档实测发现，已修正并记录，非产品改动）：

1. **检测闸门用的"探针"必须是行内容**（`line.trim()`），不能用带缩进的行——否则同样会缩进翻倍。
2. **候选态 harness 的判据必须与改前态不同**：原 harness 用 `unpatched_ok === false` 作为"确实修好了"的依据（其基准是缺陷态）；候选态基准本身已修好，该判据恒假 ⇒ 必须改用"该变体在全部 4 项检查上都成立"。已在副本内注明，原 harness 未动。

---

## 5. harness 的"同一实例"要求（要求项 3）

- **改前态**：`.workspace/lag-fix/research-v2/semantics/harness-a-p2-stale-row.cjs`（sha256 `08c04f62…`，**未改动，作为"改前态"物证**）→ 实跑 **18 PASS / 0 FAIL**，`residue` 相关断言全部为"缺陷存在"。
- **候选态**：`harness-a-p2-stale-row-post-p2ac.cjs` → 实跑 **18 PASS / 0 FAIL**。该副本相对原文件的有意改动仅 4 类（已在文件头注明）：
  1. `TARGET` → `exec-p2/candidate/client.js`，`EXPECTED_SHA256` → 候选件 sha256（这是"指向候选件"的机制；`EXPECTED_SHA256` 未被静默删除，只是重新钉死并显式断言）；
  2. `requiredAnchors` 换成 P2AC 语义锚点（旧散文注释/无差别回拷已不存在）；
  3. 4 条"缺陷必须存在"的断言改为"缺陷必须不存在"（S1 残留、S1 残留键、S1 被 `indexSubagentDescendants` 消费、S4 双行残留）；
  4. 反事实候选集改为**候选态**的 4 个变体，判据同步改写（见 §4.4 第 2 条）。
- 两轮均在**同一 `SessionRuntime` 实例**上跑（原 harness 的 `makeRuntime` + `__advance` 结构），因此 P2 复用分支真的被走到；否则未改代码会假 PASS（审计 §7.5）。
- 产物落盘：改前态写回 `research-v2/semantics/results/p2-stale-row.json`（脚本自身设计行为，非产品文件），候选态写 `exec-p2/results/p2-stale-row-post-p2ac.json`。
- **写边界说明**：审计 §7.1 建议"在原 harness 旁复制一份 `*-post-p2ac.cjs` 只改该常量"。本档的写权限被限定在工作区内（deployed 与 `research-v2/` 不在本档直接写面），因此副本落在 `exec-p2/`（内含对原路径的全部引用与常量），主 agent 若要在原目录旁留档，直接 `cp` 本副本即可。

---

## 6. 反向对照（要求项 7，verifier 有区分力）

`verify-candidate-p2ac.cjs` 的 6 个故意破坏变体，全部被捕获（`reverse_controls_caught=true`）：

| 破坏方式 | 捕获方式 | 实测 |
|---|---|---|
| 声明放进 `if (current !== …) {` 内（5 Tab，真实 T1） | 运行时抛错 | `ReferenceError: chainRowIds is not defined` |
| 声明放进 walk 循环体（6 Tab） | 运行时抛错 | `Cannot access 'chainRowIds' before initialization` |
| 声明锚在 `const copiedPrevious`（T2） | 运行时抛错 | `Cannot access 'chainRowIds' before initialization` |
| 去掉 A3 链域过滤（留无差别回拷 + 成员闸门） | S1 仍 stale | `byId=["p","child"]` |
| 整条删掉成员性闸门（退回整体复用旧 byId） | S1 仍 stale | `byId=["p","child"]` |
| 去掉闸门 + 恢复无差别回拷 | S1 仍 stale | `byId=["p","child"]` |

同时 `assert-candidate-static.js` 对 T1(5 Tab)/T1(8 Tab)/T3(文本式替换)/无链域过滤 四类破坏给出 **CAUGHT**，并对**真候选件**给出同一批断言的 PASS（`S14b`，无假阳性）。

---

## 7. ⚠️ 必须原样写进验收口径的一条

> **E2「活体 stale row 只读判据」= INCONCLUSIVE。**
> 残留 row 只存在于**浏览器页面内存**的 `SessionRuntime.listProjection` / zustand store（`this.list.set(nextProjection)`），**不落盘、不出网络、不进日志**；宿主侧只提供投影的服务端来源（`getListSnapshot()`），而缺陷恰恰发生在**客户端把服务端快照投影成 store 的那一步**（`projectList`）。无头浏览器"只读"观测也不成立（要触发 S1 必须操作真实会话的选中态＝写操作，且需注入页面脚本读内部 store＝侵入式）。
> **因此不得把"刷新后活体上确认 stale row 不再出现"写成 PASS 判据**；**本缺陷只能由离线 harness 判定**（改前态 18/18 复现 + 候选态 18/18 消失，两者均按字节自 live bundle 提取并以运行时同一性自证）。
>
> 落地后可做的**次级、非判定性**只读验收：
> 1. `grep -c '/\* p2ac-fix \*/' <target>` == `4`；
> 2. `sha256sum <target>` == `357f1703722464ee7fc40566f13e0ae4dd225131589862c8d1def67deb93d61f`（无越界改写）；
> 3. `node --check <target>` 通过；
> 4. served rev：`sha1sum <target> | cut -c1-12` 与 `curl -s 'http://127.0.0.1:3080/plugins/<id>/client.js?rev=<12位>' | sha1sum | cut -c1-12` 一致（client 热面，每次 GET 从磁盘读、no-cache）；
> 5. 刷新后浏览器 console 无异常、侧边栏无重复/幽灵行 —— **仅人眼定性，不作为 PASS 判据**。

---

## 8. 生效面、共存与回滚（给主 agent 的操作口径）

### 8.1 生效面（热面）

`dsh-client-runtime/lib/client.js` 属**客户端热面**：宿主按 `/plugins/<id>/client.js` **每次 GET 从磁盘读**、`no-cache`；`dsh-client-hmr` 以 500 ms 轮询推 `rebuilt`。⇒ **刷新 `http://127.0.0.1:3080` 即生效，不需要重启 DSH、不需要 pkill**。

### 8.2 与 C1 / B1 的共存（实测事实）

- `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-runtime` 是指向 `.npm-global/.../dsh-client-runtime` 的**符号链接**（同一 inode `31355018`）。
- B1 对 runtime bundle 的全部改动 = `:8572` 追加 `&& prev.runningSubagentCount === entry.runningSubagentCount` 一行；P2AC 只动 `projectList`（`:9294/9299/9326-9327/9340`），**两者不重叠**（候选件里 `:8572` 一行原样保留，`dsh-lag-fix` 计数 0→0、`dsh-perf-fix P1/P2` 计数均未变）。
- 本档**增加**了 5 行（`+5`），因此 `:9340` 之后的既有行号**后移 5 行**；`projectList` 之前的行号（含 `:8572`）不变；任何以行号钉死 `:9340` 的文档/脚本需知悉（harness 的 `client.js:9366`、`client.js:9322-9327` 只出现在**代码推断注释文本**里，不参与断言）。

### 8.3 回滚点与铁律

- 回滚点：`.workspace/lag-fix/exec-p2/preimage/20260921-165036/`（`client.js` + `client.js.sha256` + `META.txt`），`preimage/CANONICAL.txt` 固定指向它（**沙箱彩排的 pre-image 不会覆盖正式回滚点**）。
- 回滚命令（幂等、只覆盖本单元目标）：

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-p2
node apply-P2AC.mjs --rollback                 # 用 CANONICAL.txt 指定的正式 pre-image
# 回滚后三条自证（脚本会自动跑 node --check 并打印前两条）：
sha256sum <target>                    # == d71a8ca5…（pre-image 记录值）
grep -c '/\* p2ac-fix \*/' <target>   # == 0
node --check <target>                 # SYNTAX-OK
```

- **回滚铁律（次序不可换）**：**① P2AC → ② B1/C1 → ③ C1**。
  - **禁止**用 C1 `--rollback` 作为 P2AC 的回滚手段：它还原 `aba836a0` baseline，会**连带抹掉 B1 的 `:8572` 行与 P1/P2 全部**。
  - 跳步会被守卫拒绝（B1/C1 的 live 归属校验要求 sha ∈ `{pre,post}`），但**不得依赖守卫兜底**。
  - P2AC 回滚后若之前回滚过 B1/C1，**必须重新应用 B1/C1**，否则 runtime 悬停在 `867207a9`（C1 post、B1 pre）形成悬挂态。
- **不得**把本改动塞进 `patches/client-runtime-perf.sh`（C1）或 B1 脚本；**不得**复用 `dsh-perf-fix P2 v1` / `dsh-lag-fix B1/C1` 标记。

---

## 9. 同档自复核（对照目标与审计结论逐条检查）

| 复核项 | 结论 | 依据 |
|---|---|---|
| 严格按审计 §1 的四处锚点落地，未重新拆解/未扩范围 | ✅ PASS | `results/candidate.diff` 只有 4 个 hunk，全部落在审计给定位置 |
| 改动语义 == 审计 §3.1/§3.2（链域回拷 + 成员性闸门） | ✅ PASS | 候选件 projectList 字节切片 == live 切片 + 审计变换（逐字节同一） |
| 三处陷阱已机器化且**真跑反证** | ✅ PASS | §4.1–4.3（含真实 `ReferenceError` 复现） |
| 独立标记 + 独立 pre-image（从当前 live 取，非 R4） | ✅ PASS | §2.4 / §3.4 |
| `apply-P2AC.mjs` 纪律：dry-run 默认、`--apply` 才写、锚点唯一才写、自动 pre-image + `node --check` + 标识符声明校验 | ✅ PASS | 脚本 G1–G5；`--print-target` 亦走同一套后置断言 |
| 幂等与回滚真的可用（不碰 deployed） | ✅ PASS | 沙箱彩排：重复 `--apply` → G3 SKIP；`--rollback` → 字节回到 `d71a8ca5…` |
| 七个必跑自证项 | ✅ 7/7 PASS | §0 表 + 各原始 JSON |
| E2 活体只读判据的定性 | ✅ PASS（口径正确） | §7 明确 **INCONCLUSIVE**，未当成验收判据 |
| deployed 写入 | ⛔ 未做（越权/边界） | 本档只能写工作区；`--apply` 由主 agent 执行（已沙箱实证可用） |
| 副作用披露 | ✅ | 唯一副作用：跑改前态 harness 会重写其自身产物 `research-v2/semantics/results/p2-stale-row.json`（脚本设计行为，**非产品文件**）；deployed 目标全程只读（V6 首尾一致） |

**自裁决：PASS。** 无 REWORK 项。

---

## 10. 失败 / invalid / 剩余阻塞

1. **无功能性失败**：全部闸门 10/10 步绿（58 + 21 + 18 + 18 + 9 项断言全 PASS）。
2. **本档越权的两处（已按边界处理，需主 agent 接手）**：
   - **deployed 写入**：`~/.npm-global/.../client.js` 在本档写面之外 ⇒ **由主 agent 执行**：
     ```bash
     cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-p2
     node apply-P2AC.mjs --preimage-only     # 可选：先留一枚新鲜 pre-image（不写目标）
     node apply-P2AC.mjs --apply             # 真正落地：自动 pre-image + 写后 node --check + 4 处后置断言
     sha256sum <target>                      # 期望 357f1703722464ee7fc40566f13e0ae4dd225131589862c8d1def67deb93d61f
     grep -c '/\* p2ac-fix \*/' <target>     # 期望 4
     node --check <target>                   # SYNTAX-OK
     ```
     也可直接 `cp candidate/client.js <target>`（字节与 `--apply` 结果完全相同，已由沙箱 5b 步实证）。
   - **harness 副本留档到 `research-v2/semantics/` 旁**（审计 §7.1 的建议位置）在本档写面之外 ⇒ 如需，主 agent `cp exec-p2/harness-a-p2-stale-row-post-p2ac.cjs` 到该目录即可（副本内已记录常量改动）。
3. **剩余阻塞：无**。停止条件（锚点非唯一命中 / 静态断言失败 / 对拍未达 39/39 与 18/18）**均未触发**。
4. **留给主 agent 的既有偏差提示（非本档引入）**：`research-v2/semantics/harness-a-p2-stale-row.cjs` 以 `extractMethod(source, 'projectList() {', '\t\t\t')` 取锚点（3 Tab），而该 bundle 的 `projectList` 声明是 **3 Tab**、方法体 4 Tab —— 实测 18/18 通过，仅记录事实，本档未改动它。
