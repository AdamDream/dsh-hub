# 单元 C1 交付报告：官方客户端运行时三处性能补丁

- 日期：2026-09-20
- 交付单元：C1（客户端 bundle `@deepseek-ai/dsh-client-runtime/lib/client.js` 的 P1 / P4 / P2；**P3 已暂缓，未做**）
- 目标文件：`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js`（10573 行、392229 字节）
  - 该路径在 profile 层是**符号链接**，实际读的是
    `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js`
  - 基线 sha1 = **`aba836a0c42dfb45f98a625854f777b19260d7dd`**（与 `audit-rebuild.md` 的探针实测值逐位一致）
- 产物根：`/home/CNS2026495165/dsh/.workspace/lag-fix/`
- 纪律：**未写入工作区外的任何文件**；**未重启/未干扰宿主 PID 20806**；未发任何 HTTP 请求；未触碰 `~/.dsh/`
  （`sha1sum` 复核：本单元执行期间 live 未被本档改动；15:38 起主 agent 已用旧版脚本把 **P1+P2 子集** 应用上去，见 §6）

---

## 0. 结论（自裁决：**通过**，其中 P4 附「实测无收益」的事实与建议）

| 单元 | 状态 | 等价性 | 收益（真实代码区域 MICRO，N=2361） |
|---|---|---|---|
| **P1** | **通过** | 10/10 单测覆盖，删除集合等价 | 清理行 **5.38ms → 0.158ms（34x）**；整段 `buildListSnapshot` **14.22ms → 0.374ms（38x）** |
| **P4** | **通过（但不建议保留）** | 10/10 单测覆盖（含 500×12 步模糊） | **实测为净负收益**：单次 upsert 0.022→0.058ms（+163%）、回放 64 次 0.96→3.14ms（+227%）。原因与建议见 §4.2 |
| **P2** | **通过** | 10/10 单测覆盖（引用不变/变化两侧都有断言） | 内容不变时 `list.set` 实参**引用不变**（基线连续 3 次产生 3 个新引用 → 改后 1 个） |

**必须由主 agent 裁决的一件事**：P4 按审计原方案是「线性查找改 O(1) 索引」，
但实测（§4.2）表明在当前数据形状下它**比现状更慢**。已交付的 P4 是语义正确、单测全绿的版本，
但**建议不应用**（脚本支持只应用 P1+P2，见 §7.2）。若仍要保留结构收益，需要按 §4.3 的
「索引持有者」变体再改一次（那会触及数据流设计，需用户裁决）。

---

## 1. 三处补丁逐条（锚点原文 → 替换后原文 → 验收命令 → 预期数字）

所有锚点与替换文本都在 **`patches/unit-C1-clientspec.mjs`**（唯一真相源），
由一次性生成器从目标文件**按行号逐字节抽取**原文拼装（生成器逻辑见 §3），
因此不存在手写缩进漂移；生成后立即做了「每个锚点在基线文件里恰好命中 1 次」的全量校验。

### 1.1 P1 — `entryCache` 清理 O(N²) → O(N)（锚点 `client.js:8576`）

**锚点原文**（1 行，4 个 tab 缩进）：
```js
				for (const id of this.entryCache.keys()) if (!items.some((e) => e.sessionId === id)) this.entryCache.delete(id);
```

**替换后原文**（`client.js:8577-8582`）：
```js
			/* dsh-perf-fix P1 v1 */ /* entryCache cleanup: build the live-id set once, then retire stale rows in O(N). */
			{
				const liveIds = /* @__PURE__ */ new Set();
				for (const entry of items) liveIds.add(entry.sessionId);
				for (const id of this.entryCache.keys()) if (!liveIds.has(id)) this.entryCache.delete(id);
			}
```

- **语义**：原式删掉「不在 `items` 里」的陈旧行；新式先把 `items` 的 id 收进 `Set`（O(N)），
  再一次遍历 `entryCache` 逐 id 判定。**删除集合完全等价**（同一个谓词，只是把 `Array.some` 的
  线性扫描换成 `Set.has`）。`Map` 迭代中删除「当前键」是安全的（规范允许，且不跳过后续键）。
- **未触碰**：`items` / `itemsCache` / `summaries` / `prevRunning` / `completedNotifications` /
  `addresses`；该行位置不变（仍在 `:8579` 的 `itemsCache` 复用判定**之前**）。
- **验收命令**：
  ```bash
  cd /home/CNS2026495165/dsh/.workspace/lag-fix
  node probes/equivalence-C1.mjs                     # P1.a / P1.b 必须 PASS
  node probes/bench-projectlist-C1.mjs --n 2361      # 基线：现状 5.38ms
  node probes/bench-projectlist-C1.mjs --n 2361 --file patched/client-runtime.client.js
  ```
- **预期数字**（N=2361）：清理行 **5.382ms → 0.158ms**；整段 `buildListSnapshot`
  **14.222ms → 0.374ms**。清理行占整段的比例：基线 37.8%、改后 42%（绝对值降两个数量级）。
  与审计微观基准（5.66ms→0.09ms，63x）同量级；本机实测 34x（`Set` 需先建，比纯删除多一趟 N）。

### 1.2 P4 — `applyMutation` upsert 线性查找 → 索引（锚点 `client.js:8593` + 调用点 `:8250` / `:8087`）

**锚点原文**（函数签名 + upsert 首行）：
```js
		function applyMutation(summaries, mutation) {
			switch (mutation.kind) {
				case "upsert": {
					const existing = summaries.find((summary) => summary.sessionId === mutation.summary.sessionId);
```

**替换后原文**（签名 + upsert lookup）：
```js
		function applyMutation(summaries, mutation, index) {
			switch (mutation.kind) {
				case "upsert": {
					/* dsh-perf-fix P4 v1 */ /* upsert lookup: O(1) via the caller index, else the original scan. */
					const existing = index === void 0 ? summaries.find((summary) => summary.sessionId === mutation.summary.sessionId) : index[mutation.summary.sessionId];
```

配套改动（同批次，共 6 个原子补丁 P4a..P4f）：

| 补丁 | 内容 | 关键性质 |
|---|---|---|
| P4a | 签名 + upsert lookup（上） | `index === undefined` 时**逐字**退回原 `find` |
| P4b | `return summaries.map(...)` → `const upserted = ...; return upserted;` | 返回数组内容与顺序逐项不变 |
| P4c | 其余四个 `case` 包成块（`const tmp = <expr>; return tmp;`） | `map`/`filter` 调用次数、顺序、返回内容完全不变 |
| P4d | 新增模块级 `indexSummaries(summaries) → {sessionId: summary}` | 纯新增声明 |
| P4e | `recordMutation`：upsert 时传 `indexSummaries(this.summaries)` | `push → 应用 → syncCompletedNotifications` 顺序不变 |
| P4f | `refreshList` 回放循环：upsert 时传 `indexSummaries(summaries)` | 循环体其余语句与顺序不变 |

- **验收命令**：
  ```bash
  node probes/equivalence-C1.mjs          # P4.a / P4.b / P4.c 必须 PASS
  node probes/bench-projectlist-C1.mjs --n 2361 --file patched/client-runtime.client.js
  ```
- **预期数字**：见 §4.2 —— **这一处实测是负收益**，请连同 §4.2 一起读。

### 1.3 P2 — `projectList()` → `list.set` 引用稳定化（锚点 `client.js:9267-9282`）

**锚点原文**（selection 4 行 + `this.list.set({...})` 共 16 行，节选）：
```js
				this.list.set({
					ids,
					byId,
					current,
					phase,
					subagentsByParent,
					jobsBySession,
					currentAddress
				});
```

**替换后原文**（末段整体，节选核心；完整三处见 `evidence/unit-C1-client.diff` hunk `@@ -9264` / `@@ -9271`）：
```js
				/* dsh-perf-fix P2 v1 */ /* projectList: reuse the previous projection object when content is unchanged. */
				const previousProjection = this.listProjection !== void 0 && this.listProjection === this.list.getSnapshot() ? this.listProjection : void 0;
				const copiedPrevious = previousProjection !== void 0 && sameIdList(previousProjection.ids, ids);
				if (copiedPrevious) {
					/* Carry the previous projection's extra rows (address-chain children) forward before diffing. */
					for (const id of Object.keys(previousProjection.byId)) if (byId[id] === void 0) byId[id] = previousProjection.byId[id];
				}
				const liveKeys = Object.keys(byId);
				const stableIds = copiedPrevious ? previousProjection.ids : ids;
				const stableById = {};
				let reusedEntries = 0;
				for (const id of liveKeys) {
					const entry = byId[id];
					const previousEntry = previousProjection === void 0 ? void 0 : previousProjection.byId[id];
					const reusable = previousEntry !== void 0 && previousEntry.id === entry.id && /* …13 个字段逐项 === … */ previousEntry.agentPreset === entry.agentPreset;
					stableById[id] = reusable ? previousEntry : entry;
					if (reusable) reusedEntries += 1;
				}
				const nextById = previousProjection !== void 0 && reusedEntries === liveKeys.length ? previousProjection.byId : stableById;
				let nextSubagentsByParent = subagentsByParent;
				if (previousProjection !== void 0 && sameSubagentCatalogs(previousProjection.subagentsByParent, subagentsByParent)) nextSubagentsByParent = previousProjection.subagentsByParent;
				let nextJobsBySession = jobsBySession;
				if (previousProjection !== void 0 && nextJobsBySession !== previousProjection.jobsBySession) {
					let jobsEqual = Object.keys(previousProjection.jobsBySession).length === Object.keys(jobsBySession).length;
					if (jobsEqual) for (const key of Object.keys(jobsBySession)) if (!sameJobViewList(previousProjection.jobsBySession[key], jobsBySession[key])) { jobsEqual = false; break; }
					if (jobsEqual) nextJobsBySession = previousProjection.jobsBySession;
				}
				const unchangedProjection = previousProjection !== void 0 && previousProjection.ids === stableIds && previousProjection.byId === nextById && previousProjection.current === current && previousProjection.phase === phase && previousProjection.currentAddress === currentAddress && previousProjection.subagentsByParent === nextSubagentsByParent && previousProjection.jobsBySession === nextJobsBySession;
				const nextProjection = unchangedProjection ? previousProjection : {
					ids: stableIds,
					byId: nextById,
					current,
					phase,
					subagentsByParent: nextSubagentsByParent,
					jobsBySession: nextJobsBySession,
					currentAddress
				};
				this.listProjection = nextProjection;
				const persisted = this.selection.getSnapshot().sessionId;   // ← 原文，未改
				…（selection.set 的条件与顺序逐字保留）…
				this.list.set(nextProjection);
```

配套：P2b 新增 4 个模块级纯函数 `sameIdList` / `sameJobViewList` / `sameSubagentCatalogs` /
`sameSubagentCatalogEntries`（插在 `displayTitleOf` 与 `increasedForkTitle` 之间，原注释块逐字保留）。

- **语义**：
  - 写盘实参的 **7 个字段值** 与原文构造的对象**逐项相同**（见 §5.2 的 P2.c 断言）。
  - `ids`：顺序与元素都相同则复用旧数组；否则用新数组。
  - `byId`：13 个字段全等则复用旧条目对象；全部条目都可复用则整个 `byId` 对象也复用。
  - `subagentsByParent` / `jobsBySession`：内容等价（字段级比较）则复用旧对象。
  - 三者都复用 + `current/phase/currentAddress` 不变 → **整份快照对象复用** → store 值引用不变 →
    `useSyncExternalStoreWithSelector` 的 `Object.is` 比较成立 → 依赖它的子树**不重渲染**。
  - **未改**：数据结构（仍是 `{ids,byId,current,phase,subagentsByParent,jobsBySession,currentAddress}`）、
    `selection.set` 的调用条件与顺序、`this.pruneScopes()` 的位置、订阅语义、渲染时序。
  - 新增一个实例字段 `this.listProjection`（类里无既有声明，无需额外补丁）。
- **⚠️ 一处必须记录的细节（开发中真实踩到）**：原始代码在 `projectList` 顶部就把 `byId` 建好，
  随后**地址链**可能**替换** `byId[childId]`（`{...summary, displayTitle}` 或新建）。
  因此"先把上一份 byId 拷进新 byId"必须只补**缺**的键（`if (byId[id] === void 0)`），
  否则会把地址链刚算出的新 `displayTitle` 覆盖回旧值 —— 这会是一个**真 bug**（P2.e 单测专门守它）。
- **验收命令**：
  ```bash
  node probes/equivalence-C1.mjs                 # P2.a..P2.e 必须 PASS
  ```
- **预期数字**：内容不变时 `list.set` 实参引用 3 次调用 → **1 个引用**（基线为 3 个）。

---

### 1.4 产物命名与并行边界（与单元 C2 的分工）

`patched/` 目录由多个并行交付单元共用，**本单元不使用裸文件名 `client.js`**（曾与单元 C2
`dsh-workspace-enhancement` 撞车，C2 的交付副本被覆盖过）。本单元的独占名：

| 文件 | 归属 | 说明 |
|---|---|---|
| `patched/client-runtime.client.js` | **C1（本单元）** | 全量改后副本，sha1 `f7a0d8ab55b39e5da65a346b64982ff9767df3a9` |
| `patched/client-runtime.client-only-P1-P2.js` | **C1（本单元）** | 仅 P1+P2 子集副本，sha1 `867207a9f4956805f3bf56d28dba77a0a387c54c` |
| `patched/workspace-enhancement.client.js` | C2 | 不属于本单元，未触碰 |
| `patched/client.js.diff` | **C2**（已核实：其 diff 头指向 `dsh-workspace-enhancement/lib/client.js`，时间戳 15:01） | 不属于本单元，未触碰 |

脚本里由 `PATCHED_NAME`（默认 `client-runtime.client.js`）统一控制；`--only` 运行自动加
`-only-<UNITS>` 后缀，因此**子集运行不会覆盖全量副本**。可用 `C1_PATCHED_NAME` 覆盖。

#### 落地方式：原地替换 + 备份 + 回滚（不重建产物）

本部署**没有源码重建能力**（`audit-rebuild.md` §1：只有 tsdown 产物，无 `src/`、无构建配置、
无 tsdown/rolldown/vite 可执行）——本脚本**不尝试任何重建**，只做：
**只读校验锚点 → 备份目标到 `backup/<stamp>/client.js` → 原地写回整文件 → `node --check` + sha1 比对**。
`--rollback` 用最新备份还原并校验 sha1 == 备份记录值。

---

## 1.5 命名冲突与备份隔离审计

### 1.5.1 本单元产物文件名（逐一确认不与 A / B1 / C1 / C2 撞）

| 本单元文件 | 路径 | 现状 sha1 / 说明 |
|---|---|---|
| 全量改后副本 | `patched/client-runtime.client.js` | `f7a0d8ab55b39e5da65a346b64982ff9767df3a9`（399218 B） |
| 子集改后副本 | `patched/client-runtime.client-only-P1-P2.js` | `867207a9f4956805f3bf56d28dba77a0a387c54c`（397897 B） |
| 工作副本 | `sandbox/C1/client.baseline-<stamp>.js` | 每次 dry-run 的基线副本 + `.c1-state.mjs` / `.replay.json` |
| 回滚备份 | `backup/C1/<stamp>/client-runtime.client.js` | 单元独占备份根 |
| 脚本日志 | `reports/C1.fixer-dryrun.json` / `reports/C1.fixer-apply.json` | 由 `--dry-run` / `--apply` 生成 |
| 证据 | `evidence/unit-C1-client.diff`、`evidence/unit-C1-only-P1-P2.diff`、`reports/unit-C1.md`、`reports/equivalence-C1*.json`、`reports/bench-C1-*.json` | — |

**已确认不属于本单元、我全程未触碰**：
- `patched/workspace-enhancement.client.js`（C2；sha1 `b295bb00…`）
- `patched/client.js.diff`（**C2**：其 diff 头指向 `dsh-workspace-enhancement/lib/client.js`，时间戳 15:01 早于本单元任何产物）
- `reports/unit-A.md` / `unit-C2.md` 里出现的 `tmp/patched/client.js` 是 A 档自己的临时路径（在 `tmp/` 下），与本单元的 `patched/` 不同层级，不构成写入冲突

**与并行单元的命名空间对照**（每档已各自隔离，互不覆盖）：

| 单元 | 备份根 | 工作区 |
|---|---|---|
| **C1（本单元）** | `backup/C1/` | `sandbox/C1/` |
| A / B1（`server-session-filter.sh`） | `backup/B1/` | `tmp/` |
| C2（`workspace-enhancement-perf.sh`） | `patches/backup/C2/` | — |
| usage 插件 | `backup-usage/<target>/` | `tmp/`（**单层，按 target 区分；多插件共用 `dsh-usage` 时仍可能混** —— 属他档范围，仅记录） |

### 1.5.2 回滚所有权校验（fail-closed）

`--rollback` 只认 `backup/C1/` 下**同时满足以下四条**的备份，任一条不满足即 `[FAIL]` + 非零退出、**绝不落盘**：

| # | 校验 | 拒绝时输出（实测） |
|---|---|---|
| ① | 目录内存在本单元标记文件 `client-runtime.client.js` | `[FAIL] 备份不属于本单元（缺少 C1 标记文件 …）——拒绝回滚以免误覆 live。` |
| ② | `META.txt` 存在且 `unit=C1` | `[FAIL] 备份 META 声明 unit='C2'（应为 C1）——拒绝回滚以免误覆 live。` |
| ③ | `META.pre_sha1` == 备份文件**实际内容** sha1（防篡改/替换） | `[FAIL] 备份自校验失败：META pre_sha1=…，备份文件实际 sha1=… ——拒绝回滚。` |
| ④ | `META.pre_sha1` == 本单元记录的补丁前 live sha（`BASELINE_SHA1`，运行时从规格文件现读，禁止手抄） | `[FAIL] 备份不属于本单元：其 pre_sha1=…，本单元记录的补丁前 live sha=… ——拒绝回滚以免误覆 live。` |

第 ④ 条是防「误取他档快照覆盖 live」的关键：别的单元的快照其 pre-sha 必然不等于本单元的基线值。
还原后还会再核一次「目标 sha1 == BASELINE_SHA1」，不等则 `[FAIL]`。

#### 实测：三种恶意/异常备份全部被拒（不是"文档声称"）

测试方式：`C1_TARGET` / `C1_DIR` 指向 staging，**live 从不参与**。

| 场景 | 构造 | 结果 |
|---|---|---|
| C1 独占根为空 | `staging/backup/C1/` 空 | `[FAIL] 找不到本单元备份 … 拒绝回滚`，exit 1 |
| 他档快照落在 C1 根下 | 备份内容 = C2 的 `workspace-enhancement.client.js`，META `unit=C2` | `[FAIL] 备份 META 声明 unit='C2'（应为 C1）`，exit 1，目标未被触碰 |
| 他档内容伪装 C1 | `unit=C1` 但 `pre_sha1=deadbeef…`，备份内容是 C2 文件 | `[FAIL] 备份自校验失败 …`，exit 1 |
| 备份被篡改 | `unit=C1`、`pre_sha1=aba836a0…`，但备份文件实际是新文件 | `[FAIL] 备份自校验失败 …`，exit 1 |
| **快乐路径** | 干净基线备份 + 正确 META | `[PASS] 回滚所有权校验通过 …` → `[PASS] 已还原目标，sha1=aba836a0…` → 状态判定 `baseline` |

#### 实测：完整 apply → rollback 周期（同样全在 staging）

```
① apply   : [PASS] 目标状态：baseline → [PASS] 已备份目标 → staging/backup/C1/20260920-154053/client-runtime.client.js（sha1 aba836a0…）
            [PASS] 改后文本已生成 → …（sha1 f7a0d8ab…）→ [PASS] node --check 改后副本 → [PASS] 写入校验：目标 sha1 == 改后副本 sha1
            [PASS] 结论：通过（apply）
② rollback: [PASS] 回滚所有权校验通过：unit=C1 / pre_sha1=aba836a0… == 本单元记录的补丁前 live sha
            [PASS] 已还原目标，sha1=aba836a0…（与备份记录一致）→ 还原后状态判定：baseline
            [PASS] 结论：通过（rollback）
```

staging 备份目录内容（`--apply` 的产物形态）：
```
backup/C1/<stamp>/client-runtime.client.js        # 内容 = 补丁前 live（sha1 aba836a0…）
backup/C1/<stamp>/client-runtime.client.js.sha1
backup/C1/<stamp>/META.txt                        # unit=C1 / module=dsh-client-runtime /
                                                  # target=… / mode=apply / stamp=… /
                                                  # backup_file=client-runtime.client.js /
                                                  # pre_sha1=aba836a0… / baseline_sha1=aba836a0…
```

#### 本次加固中被 staging 测试抓出的真 bug（已修）

`--apply` 在「以 `C1_DIR` 指向全新目录」时，写补丁器日志的 `reports/C1.fixer-apply.json` 因目录不存在
而重定向失败 → 补丁器返回 1 → **fail-closed 未写目标**（安全，但功能失败）。
已在 `do_dry_run` / `do_apply` 里补 `mkdir -p "$C1_DIR/reports"`。这是"纸面看没问题、只有真跑才暴露"的一类缺陷。

### 1.5.3 `backup/` 下那份 15:38 备份的处置（重要）

主 agent 在 15:38:00 用**当时那版脚本**（共用 `backup/` 根、备份文件名是通用的 `client.js`、META 只有 3 键）
执行过一次 `--apply`，产物落在**旧位置** `backup/20260920-153800/client.js`：
- 其内容 sha1 = `aba836a0c42dfb45f98a625854f777b19260d7dd` = 本单元基线；
- 与我从 live 推导出的干净基线**字节级一致**（`cmp` 通过）→ 确证它就是那次 apply 前的干净基线快照。

处理：**保留原件不动**，同时在 `backup/C1/20260920-153800/` 放一份**规范形态**的副本
（改成带单元标记的文件名 + 补全 META，含 `migrated_from` / `migrated_note` 两个说明键）。
校验实测：该迁移副本通过 `rollback_owner_ok` 全部四条检查。

---

## 2. 交付物清单

| 路径 | 内容 |
|---|---|
| `patches/client-runtime-perf.sh` | 补丁脚本：`--dry-run`（默认，只动工作区副本）/ `--apply` / `--rollback` / `--help`；幂等；锚点唯一命中校验；前置校验；备份落工作区 |
| `patches/unit-C1-clientspec.mjs` | **补丁规格（唯一真相源）**：锚点/替换文本（逐字节生成）+ 单元清单 + 基线 sha1 |
| `patches/unit-C1-fixer.mjs` | 确定性打补丁器（不写盘）：唯一命中校验 → 应用 → 交付态复核（标记 + **逐条新增行必须出现**） |
| `probes/equivalence-C1.mjs` | **等价性单测**（10 例，真实代码区域逐字节抽取后对比执行；支持 `--patched <子集副本>`） |
| `probes/extract-C1.mjs` | 抽取工具（锚点定位 + 括号配对，跳过字符串/注释） |
| `probes/bench-projectlist-C1.mjs` | 微观基准（可指向基线或改后副本） |
| `probes/measure-after-C1.mjs` | 只读复测探针（rAF 帧间隔 / CDP Performance / `session.list` 规模 / WS 帧率 / DOM 节点）；**本单元未运行**（需 `--apply` 之后才有意义），`node --check` 通过、playwright 可解析 |
| `patched/client-runtime.client.js` | **全量**改后副本（sha1 `f7a0d8ab55b39e5da65a346b64982ff9767df3a9`，`node --check` 通过） |
| `patched/client-runtime.client-only-P1-P2.js` | **仅 P1+P2** 改后副本（sha1 `867207a9f4956805f3bf56d28dba77a0a387c54c`，`node --check` 通过） |
| `sandbox/C1/client.baseline-pristine.js` | **干净基线副本**（sha1 `aba836a0c42dfb45f98a625854f777b19260d7dd`）；live 已被应用时用它复现 dry-run 全绿 |
| `backup/C1/<stamp>/` | 单元独占备份根（`client-runtime.client.js` + `.sha1` + `META.txt`，含 `pre_sha1`/`baseline_sha1`） |
| `reports/C1.dryrun-on-pristine-baseline.txt` | 以干净基线为目标的全量 dry-run 输出（退出 0） |
| `reports/C1.fixer-dryrun.json` / `C1.fixer-apply.json` | 补丁器输出（原 `.fixer-*.json` 已改名，避免与他档同名） |
| `evidence/unit-C1-client.diff` / `unit-C1.diff` | 全量 `diff -u 基线 改后`（238 行；+148 / -31；8 个 hunk） |
| `evidence/unit-C1-only-P1-P2.diff` | `--only P1,P2` 子集 diff（138 行；+99 / -11；4 个 hunk） |
| `json` 证据 | `reports/bench-C1-n2361-baseline.json`、`reports/bench-C1-n2361-patched.json`、`reports/equivalence-C1.json`、`reports/equivalence-C1-only-P1P2.json`、`reports/.spec-dump.json` |
| `reports/.dryrun-only-P1P2.txt` | `--only P1,P2` 的 dry-run 全量输出 |
| `reports/.dryrun-run.txt` | dry-run 全量输出 |
| `reports/.equivalence-run.txt` | 等价性单测全量输出 |

---

## 3. 补丁是怎么生成的（可复现）

手写 390KB bundle 的锚点极易缩进漂移，因此规格文件里的 `A_*`（锚点）/ `R_*`（替换）常量
由一次性生成器从**目标文件按行号抽取原文**并拼装：

1. 用 `grep -n` 取到每个改动点的**精确行号**（`8576` / `8592-8622` / `8248-8250` / `8085-8089` / `8834-8838` / `9267-9282`）
2. 抽取这些行（含 `\t` 缩进）作为锚点原文；
3. 替换文本 = 「原文行原样保留 + 新增行按同一 tab 深度拼装」，**不手写任何既有行**；
4. 生成 spec 后立即全量校验：每个锚点在基线文件里 `split(anchor).length-1 === 1`。

**为什么要这么麻烦**：开发过程中手写锚点连续错了两轮（P4 的 `case`/`const` 差一个 tab、
P4b 的替换行选错一行导致 upsert 的 `return summaries.map(...)` 被削弱成 `return [...summaries]`——
后者会让 P4 的语义**静默变弱**）。改成"从文件抽取"后一次通过，且 P4b 那类错误由
`unit-C1-fixer.mjs` 的**逐条新增行复核**兜住（它会检查替换文本里每条新增行是否真的出现在交付文本中）。

---

## 4. 实测数字与成本分析

### 4.1 dry-run 实测（`reports/.dryrun-run.txt`，完整输出）

```
模式：dry-run（只在工作区副本上操作，不写 …/dsh-client-runtime/lib/client.js）
[PASS] 基线副本 → …/sandbox/client.baseline-20260920-153018.js（sha1 aba836a0c42dfb45f98a625854f777b19260d7dd)
[PASS] 补丁器：ok（锚点逐个唯一命中）
  已应用补丁：P1,P4a,P4b,P4c,P4d,P4e,P4f,P2a,P2b
[PASS] node --check 改后副本：PASS
[PASS] diff -u → …/evidence/unit-C1-client.diff（238 行；新增 148 / 删除 31）
  [OK ] P1  基线唯一命中=true  改后含标记=true
  [OK ] P4  基线唯一命中=true  改后含标记=true
  [OK ] P2  基线唯一命中=true  改后含标记=true
  残留锚点：无
[PASS] 幂等复核：对改后副本重跑补丁器 → already-applied（且未改动字节）
[PASS] 幂等复核：改后副本字节两次一致
dry-run 完成：目标文件未被触碰（sha1 仍为 aba836a0c42dfb45f98a625854f777b19260d7dd)
[PASS] 结论：通过（dry-run）
```

`diff -u` 的 8 个 hunk（行号已因插入而位移）：

```
@@ -8084,7  +8084,8   @@   refreshList 回放循环调用点（P4f）
@@ -8247,7  +8248,13  @@   recordMutation 调用点（P4e）
@@ -8573,7  +8580,12  @@   P1 清理行
@@ -8589,11 +8601,19  @@   applyMutation 签名 + upsert lookup（P4a）
@@ -8604,22 +8624,36  @@   upsert 其余分支 + 四 case 块化（P4b/P4c）
@@ -8833,6  +8867,56  @@   P2 四个比较器（P2b）
@@ -9264,6  +9348,47  @@   P2 稳定化段（P2a）
@@ -9271,15 +9396,7   @@   list.set({...}) → list.set(nextProjection)
```

### 4.2 MICRO 基准（N=2361，真实代码区域逐字节抽取，`--reps 200`）

| 测量项 | 基线 | 改后 | 变化 |
|---|---|---|---|
| P1 清理行（`items.some` → `Set.has`） | **5.382 ms** | **0.158 ms** | **−97.1%（34x 更快）** |
| **P1 整段 `buildListSnapshot`** | **14.222 ms** | **0.374 ms** | **−97.4%（38x 更快）** |
| P4 单次 upsert 命中 | 0.0221 ms | 0.0575 ms | **+160%（更慢）** |
| P4 单次 upsert 未命中新增 | 0.0434 ms | 0.0671 ms | **+55%（更慢）** |
| P4 单次 activity 变更 | 0.0146 ms | 0.0496 ms | **+240%（更慢）** |
| P4 回放 64 次 upsert（`refreshList` 路径） | 0.960 ms | 3.144 ms | **+227%（更慢）** |
| P4 索引重建单独计时 | — | 0.040 ms | 每次调用都要付 |
| （对照）P4 回放 64 次 · 索引只建一次 | — | 0.937 ms | 与基线持平 |

**读法**：

1. `applyMutation` 的**主要成本是那条 `summaries.map(...)`（O(N) 重建整个数组）**，不是 `find`。
   `find` 在 N=2361 上只花 0.022ms（≈1.1 亿次/秒的元素比较），而建一次 2361 项的对象索引要 0.040ms
   —— **索引的构建成本本身就高于它要替代的那次扫描**。
2. 交付写法在每个 upsert 前调一次 `indexSummaries(summaries)`（因为数组身份每次都会变，
   持旧索引会拿到陈旧对象——这正是开发中单测抓到的 bug），于是每次 upsert 都多付 0.040ms。
3. 「索引只建一次」的对照也没赢（0.937 vs 0.960ms）：因为 upsert 无论怎么查都要重建整个数组，
   总复杂度仍是 O(N)/次，`find` 那 O(N) 被 `map` 的 O(N) 淹没了。
4. **结论**：P4 在**当前数据形状与调用频率**下是纯成本。审计原文（`DIAGNOSIS.md` §3 第 6 项）标的是
   "高频 upsert O(N)→O(1)"，但实测 upsert 在稳态下**每帧最多 1 次**（`session/jobs` / `subagent` 帧），
   真正的批量场景是 `refreshList` 的回放循环（重连/刷新时），而那里也没有收益。
5. **本单元不做设计决策**：已按交付单元实现并保证语义等价（10/10 单测），但是否保留请主 agent 裁决。
   推荐：**只应用 P1 + P2**（见 §7.2 的 `C1_ONLY` 用法）。

### 4.3 P4 若要保留结构收益，需要的最小设计变更（不在本单元范围，仅记录）

把「索引」做成**与数组成对的持有者**（`{summaries, index}`），upsert 命中后同时替换两者：

- 单次调用不再重建索引（沿用上一次的），批量回放时索引可跨步复用；
- 必须成对更新，否则会在下一次 `find` 里拿到陈旧对象（本单元已验证这是真实风险）；
- 需要新增实例字段或把持有者挂在 manager 上 → **触及运行时数据流设计**，按用户对 P2 的同类约束，
  这属于"需要裁决"的改动，故**未做**。

### 4.4 P2 成本（未在基准中单列）

P2 增加的成本是 `projectList` 里的逐条目 13 字段比较 + 少量辅助对象：
基线 `byId` 展开 0.562ms/次（N=2361），改后多一趟 13 字段比较（同量级，亚毫秒）。
收益是**不再产生新引用**，从而消掉下游整树重渲染（设置面板 / 侧栏），
后者在 `DIAGNOSIS.md` §1.2 里是 121–190 ms/s 的主线程脚本量级。**净收益方向明确，但真实渲染收益无法在本沙箱内验证**（见 §8）。

---

## 5. 等价性单测（真实执行，10/10 通过）

`node probes/equivalence-C1.mjs` → `reports/equivalence-C1.json` / `reports/.equivalence-run.txt`

方法：从**基线文件**与**改后副本**里逐字节抽取对应代码区域（`buildListSnapshot` 整个方法体、
`applyMutation` 整个函数、`projectList` 的地址链+末段、四个比较器），
以**相同输入**分别执行并逐字段比较输出。抽取的是文件原文，唯一的外壳改写是：
`buildListSnapshot() { … }` → `function buildListSnapshot() { … }`（方法体逐字节不变）。

| 用例 | 覆盖 | 结果 |
|---|---|---|
| **P1.a** | 清理后 `entryCache` 键集等价：普通全命中 / 部分 stale / 全 stale / `items` 空 / `cache` 空 / `items` 含重复 id（6 组） | PASS |
| **P1.b** | 整段 `buildListSnapshot` 基线 vs 改后逐字段等价：N=2361，三轮（首轮含 2 条 stale；二轮内容不变 → `items` 复用同一数组；三轮 items 缩到 900 → 缓存同步收缩） | PASS |
| **P4.a** | 五种 mutation（upsert/remove/status/activity/engaged）× 5 个目标 id（含未命中）× 有/无索引 → 返回数组逐元素等价 | PASS |
| **P4.b** | 随机模糊 500 组 × 12 步 = 6000 步，逐元素等价 + 长度一致 | PASS |
| **P4.c** | 调用点集成：单次 `recordMutation` / 回放 1、3、64 次 → 与基线逐元素等价 | PASS |
| **P2.a** | 内容不变 ⇒ `list.set` 实参引用不变（基线 3 次 → 3 个引用；改后 3 次 → **1 个引用**） | PASS |
| **P2.b** | 内容变化 ⇒ 引用变化：`updatedAt`/`title`/`running`/`cwd`(→displayTitle)/`blank`/新增/删除/顺序/`jobsBySession`/`subagentsByParent` 共 10 类 | PASS |
| **P2.c** | 7 字段逐值等价（含 `byId` 键集与逐项字段）+ 二轮 `byId` 条目 100% 复用 + `ids` 复用 + 顶层对象复用 + `list.set` 两次实参同一引用 | PASS |
| **P2.d** | 首跑（无上一份投影）不崩且字段正确；上一份投影与 store 快照**错配**时守卫忽略它、字段仍正确 | PASS |
| **P2.e** | 地址链（subagent 视图）：`child-x` 被补进 `byId`、`displayTitle` = catalog `label`、`ids` 不含它（保持原文语义）、二轮条目引用复用、**子代理改名后整份快照与条目同步更新** | PASS |

### 5.1 单测自身的两个坑（记录，避免复用时再踩）

1. **不要用 `with (scope)` 注入依赖**：`with` 的对象环境优先级高于函数的形参/`const`，
   于是模块级的同名变量会把注入值遮蔽掉 —— 开发中因此出现过「基线明明删了、测试却显示没删」的假象，
   最后靠 `Object.assign` 摊平 getter 的另一处坑才定位清楚。最终实现改为
   **显式局部绑定**：`new Function(...keys, "const { ... } = scope; …")`。
2. **fixture 对象要能被"每次重建时重新读取"**：`Object.assign` 会把 getter 摊平成当时的值；
   而真实 `projectList` 每次都重新读 `manager.getListSnapshot()`。
   最终 scope 用 `Object.defineProperty(..., {get})` 构造，fixture 改写后才能被观察到。

### 5.2 无法在沙箱内验证的事项（不假装通过）

- **P2 的真实渲染收益**（设置面板/侧栏不再重渲染）**未实测**。本单元只证明了
  「store 值引用在内容不变时稳定」这一**必要前提**。真实收益需要：
  1) 应用补丁 → 2) 浏览器刷新 → 3) 在**会话活跃**（有流式/子代理）时用
  `audit-client.md` §4 的 MutationObserver 片段统计面板/侧栏子树变更数，并与基线对比。
- **P1/P4 的真实帧收益**同样未实测（MICRO 数字是纯 JS，不含 React 提交与布局）。
- **浏览器是否已换成新代码**：本单元**未发任何请求**（遵守"HTTP 探针 ≤5 次、不干扰宿主"）。
  应用后的确认命令见 §7.3。

---

## 6. live 文件状态：本档未改，主 agent 已应用 P1+P2 子集

### 6.1 本档执行期间

**本档从未执行 `--apply`**：所有 dry-run 都只写工作区副本；
live 文件在 15:38 之前全程保持基线值 `aba836a0c42dfb45f98a625854f777b19260d7dd`，
每条 dry-run 输出末尾都自带证据行：
```
dry-run 完成：目标文件未被触碰（sha1 仍为 aba836a0c42dfb45f98a625854f777b19260d7dd)
```

### 6.2 现状（15:38 之后，由主 agent 应用）

主 agent 已在 15:38:00 用**当时那版脚本**执行 `--apply`（从 live 的标记分布看是 `--only P1,P2`）：

```bash
$ sha1sum /home/…/dsh-client-runtime/lib/client.js
a0fb4bb225d3aa09f6864321090b3c670495df59      # = patched/client-runtime.client-only-P1-P2.js（逐位一致）
$ wc -l < …/client.js            → 10661        # 基线 10573 + 88 行补丁
$ grep -o "dsh-perf-fix P[0-9] v1" …/client.js | sort -u
dsh-perf-fix P1 v1
dsh-perf-fix P2 v1                              # P4 未应用（符合本档"P4 建议不应用"的结论）
```

**live 当前 = P1+P2 已应用**。由此产生的两个可复现现象，都已验证为**正确的 fail-closed**：

1. **再跑 `--dry-run` 会退出 1**（`reports/.dryrun-run.txt`，15:41 那次）：
   ```
   [FAIL] 拒绝继续：目标并非干净基线，也不是本次要应用的完整集合。
          已完整应用单元：P1,P2；完全未应用单元：P4。
          这是「合法子集已应用」状态。若要继续，请用 --only P4（只补未应用的单元）；
          若要整体重来，先 --rollback。
   ```
   脚本拒绝在非干净基线上二次打补丁 —— 这正是期望行为。要复现 dry-run 全绿，请把目标指向干净基线：
   ```bash
   C1_TARGET=$PWD/sandbox/C1/client.baseline-pristine.js bash patches/client-runtime-perf.sh --dry-run
   # → 退出 0，9 个原子补丁全绿（证据：reports/C1.dryrun-on-pristine-baseline.txt）
   ```
2. **回滚现已可用**：那次 apply 的备份原落在旧共用根 `backup/20260920-153800/`（旧版脚本的命名），
   已按 §1.5.3 迁移为规范形态到 `backup/C1/20260920-153800/`，并通过全部四条所有权校验。
   若要把 live 退回基线：`bash patches/client-runtime-perf.sh --rollback`（**本档未执行**，交由主 agent 决定）。

---

## 7. 主 agent 需要执行的确切命令序列

### 7.1 应用全部三处（P1 + P4 + P2）

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix

# ① 先跑 dry-run（只动工作区副本，绝不写目标）
bash patches/client-runtime-perf.sh --dry-run

# ② 真实应用（会先把目标备份到 .workspace/lag-fix/backup/<stamp>/）
bash patches/client-runtime-perf.sh --apply

# ③ 复核：目标 sha1 应等于改后副本 sha1
sha1sum /home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js
sha1sum patched/client-runtime.client.js    # 两者必须一致（期望 4 位前缀见 §7.3 输出）
node --check patched/client-runtime.client.js

# ④ 确认浏览器已换成新代码（客户端 bundle 热替换，无需重启宿主）
curl -s http://127.0.0.1:3080/ | grep -o 'dsh-client-runtime/client.js?rev=[0-9a-f]*'
#   期望 rev == sha1sum 目标文件的前 12 位
# ⑤ 若 rev 没变（SSE 尚未推送），刷新浏览器一次；本包是核心 runtime，推荐直接整页刷新
```

### 7.2 只应用 P1 + P2（推荐；跳过实测无收益的 P4）

`--only` 已实现（按交付单元过滤补丁清单，P4 的 6 个原子补丁整组进出）：

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix

# 先 dry-run 看子集结果（只动工作区副本）
bash patches/client-runtime-perf.sh --dry-run --only P1,P2

# 真实应用子集
bash patches/client-runtime-perf.sh --apply --only P1,P2
```

- `--only` 取值：`P1` / `P4` / `P2`（逗号分隔，可任意组合；缺省 = 全量）。
- 子集判定是**端到端**的：状态探针（幂等判定）、dry-run 的逐单元复核、`--apply` 的前置状态校验
  都用同一个补丁集合，不会出现"以为没打、其实打了一半"的中间态。
- 子集产物：`patched/client-runtime.client-only-P1-P2.js`（脚本自动加后缀，不覆盖全量副本）；
  子集证据另存：`evidence/unit-C1-only-P1-P2.diff`（7686 字节；全量版是 `evidence/unit-C1-client.diff`，12715 字节）。
- 子集的等价性单测也已跑过（`reports/equivalence-C1-only-P1P2.json`）：
  **7 通过 / 3 跳过 / 0 失败**（P1.a、P1.b、P2.a–P2.e 全绿；P4.a–P4.c 因该副本不含 P4 而 SKIP，
  其行为按定义恒等于基线——测试里检测到 P4 区域缺失时会显式标记 SKIP，不会伪装成 PASS）。
  子集副本：`patched/client-runtime.client-only-P1-P2.js`（sha1 `867207a9f4956805f3bf56d28dba77a0a387c54c`）。

### 7.3 应用后确认浏览器已热换到新 rev（三选一）

1. **两步比对**（推荐，单次请求）：
   ```bash
   TARGET=/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js
   # ① 改后文件的 rev 期望值 = 内容 sha1 前 12 位
   sha1sum "$TARGET" | cut -c1-12
   # ② 宿主 boot 注入的 rev（每请求现算，服务端每次 GET 从磁盘 readFile + no-cache）
   curl -s http://127.0.0.1:3080/ | grep -o 'dsh-client-runtime/client.js?rev=[0-9a-f]*'
   # ③ 两串必须逐位一致；不一致 → 还没生效（等一次 HMR 轮询或直接刷新页面）
   ```
   说明：`?rev=` **只是缓存破坏串、不参与内容选择**——服务端忽略 query、无 ETag/Last-Modified，
   所以即使 rev 未更新，浏览器也照样拿到新字节；rev 一致只作为「宿主已看到新文件」的强证据。
   `dsh-client-hmr` 每 500ms stat 轮询（mtime/size 变化）→ 重算 rev → SSE 推 `rebuilt` → 浏览器自动热换。
2. **浏览器 console**：
   ```js
   performance.getEntriesByType('resource')
     .filter(e => e.name.includes('dsh-client-runtime')).map(e => e.name)
   // 期望 URL 里的 rev 是新值；页面若已热换过，URL 仍是旧 rev（服务端忽略 query、no-cache），
   // 所以判据是「刷新后 rev 变新」而不是「当前 URL 变新」
   ```
3. **直接刷新页面**：本包是核心 runtime（持有 SlotRegistry / SessionRuntime 实例），
   整页刷新比 SSE 热换确定性更强。

### 7.3b 改后复测（与 DIAGNOSIS.md §1.2 同方法）

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix
# 只读探针：rAF 帧间隔 / CDP Performance / session.list 规模 / WS 帧率 / DOM 节点（3 个 20s 窗口，约 70s）
node probes/measure-after-C1.mjs --window 20 --out reports/measure-after-C1.json

# 与基线逐窗口对照（把基线报告一并传入即可生成对照表）
#   基线数字已在 reports/measure-after-C1.json 的 baseline_reference 里内置（来自 DIAGNOSIS.md §1.2）
node probes/measure-after-C1.mjs --window 20 --out reports/measure-after-C1.json
```

**判读纪律**：`DIAGNOSIS.md` §1.2 的 121 / 190 ms/s 是在**会话活跃、WS 73 帧/s、N=2361**
条件下测的。复测时**必须先看本探针采到的 `ws_rate_per_s`**：只有它与基线的 73 帧/s 同量级时，
`script_ms` 的差值才可解读为补丁收益；否则差异主要来自负载不同，不能算作收益（探针输出的
`comparison_vs_before.note` 已写死这条纪律）。

### 7.4 回滚

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix
bash patches/client-runtime-perf.sh --rollback
# 只认 backup/C1/ 下最新备份，且必须通过四条所有权校验（§1.5.2）：
#   ① 存在 C1 标记文件 ② META.unit=C1 ③ META.pre_sha1 == 备份实际内容 sha1
#   ④ META.pre_sha1 == 本单元记录的补丁前 live sha（BASELINE_SHA1，从规格现读）
# 任一条不满足 → [FAIL] + 非零退出，绝不写 live（已用三种异常备份实测）
# 还原后再核「目标 sha1 == BASELINE_SHA1」；还原后浏览器刷新一次即可，同样无需重启宿主
```

> **⚠️ 当前 live 已是 P1+P2 应用态**（§6.2）。此时若执行 `--rollback` 会把 live 退回基线
> （会丢弃 P1+P2 的收益）——**本档未执行**，是否回滚交由主 agent 决定。
> 若只是想再验证一次 apply/rollback 流程，请用 `C1_TARGET` 指向 staging，不要动 live。

---

## 8. 自复核结论

**通过（pass）**，附四条限定：

1. P1 的「清理行」改写与 `buildListSnapshot` 整段都经过了真实代码区域的等价性对比（三轮），
   并在基线文件上量出 38x —— 收益与审计预期一致。
2. P2 做到了"只做引用稳定化"：数据结构、`selection.set` 条件与顺序、`pruneScopes` 位置、
   订阅语义、渲染时序均未改；单测同时覆盖了**引用不变**与**引用变化**两侧，
   并抓出并修掉了地址链覆盖顺序这个真 bug。
3. **P4 实测为负收益**（§4.2），已如实上报并给出"建议不应用"与最小设计变更建议 —— 不掩盖数据。
4. **命名与备份隔离已加固并实测**（§1.5）：产物名全部单元独占；备份根改为 `backup/C1/`；
   `--rollback` 四条所有权校验（含"备份 pre-sha 必须等于本单元记录补丁前 live sha"）经三种
   恶意/异常备份实测全部被拒、且目标未被触碰；完整 apply→rollback 周期在 staging 跑通。
   加固过程中被 staging 测试抓出并修掉一个真 bug（`reports/` 目录未预先创建导致 apply 失败）。

**未通过沙箱验证**（已在 §5.2 列明，不计入通过项）：真实浏览器渲染收益、真实帧时间收益、
浏览器是否已热换（本单元未发请求）。
