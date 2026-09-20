# unit-C2 — 第三方插件 `dsh-workspace-enhancement` 同热点路径开销（修订执行复核一体 · 定稿）

- **档位**：修订执行复核一体（DSH 第三方插件优化）
- **目标文件（唯一）**：`/home/CNS2026495165/.dsh/profiles/node_modules/dsh-workspace-enhancement/lib/client.js`
- **依据**：`.workspace/settings-lag/DIAGNOSIS.md` §2.2 / §3 第 7 项；`.workspace/settings-lag/audit-rebuild.md` §2（客户端 bundle 热替换、无需重启）
- **日期**：2026-09-20 · 宿主 PID 20806 全程未触碰（实测 `etime 03:19:24` 连续存活）
- **自裁决**：**通过（PASS）** —— 2/2 交付单元落地；dry-run 真跑通并贴 diff；`node --check` 通过；27 项等价性/契约断言全 PASS；`--apply` / `--rollback` / 幂等 / 漂移拒绝在沙箱副本上端到端实证。
- **未执行**：**未对 live 文件做任何写入**（`--apply` 仅要求主 agent 执行；见 §6）

---

## 0. 交付物

| 路径 | 内容 |
|---|---|
| `patches/workspace-enhancement-perf.sh` | 三段式补丁脚本：`--dry-run`（默认）/ `--apply` / `--rollback` / `--help`；幂等、锚点唯一性校验、hash 漂移拒绝、备份落工作区 |
| `patched/client.js` | 补丁后交付副本（267026 字节 / 5453 行；sha256 `7df7a655…`） |
| `patched/client.js.diff` | 交付副本对应的 `diff -u`（2 hunk / 10 删 21 增） |
| `patches/baseline.sha256` | 补丁前/后基线 hash 与锚点记录（权威值是脚本内常量） |
| `tools/make-patched.mjs` | 精确双锚点替换器（5 条前置断言 + 4 条后置断言；`--dry-run` 与 `--apply` 共用同一变换） |
| `tools/equiv-c2.mjs` | 等价性 + 记忆化契约 + 真实 bundle 行为测试（27 项断言） |
| `tools/bench-c2.mjs` | 微观基准（N=2361） |
| `reports/dry-run-C2.log` | `--dry-run` 原始输出（含 `diff -u` 全文） |
| `reports/bench-C2.log` | 基准原始输出 |

---

## 1. 逐条交付单元

### 单元 C2-1 `remoteSessionIndex` 内层去重 O(k²) → Set

**位置**：`client.js:4124`（函数 `remoteSessionIndex` 起始于 `:4109`）

**锚点原文（补丁前）**：

```js
			const index = /* @__PURE__ */ new Map();
			for (const [title, ids] of byTitle) {
				if (localTitles.has(title)) continue;
				const unique = ids.filter((id, index) => ids.indexOf(id) === index);
				if (unique.length === 1 && unique[0] !== void 0) index.set(title, unique[0]);
			}
			return index;
		}
```

**替换后原文（补丁后）**：

```js
			const index = /* @__PURE__ */ new Map();
			for (const [title, ids] of byTitle) {
				if (localTitles.has(title)) continue;
				const unique = Array.from(new Set(ids));
				if (unique.length === 1) index.set(title, unique[0]);
			}
			return index;
		}
```

**⚠ 锚点作用域（关键，非可选）**：`ids.filter((id, index) => ids.indexOf(id) === index)` 与紧随其后的 `if` 判定在全文件各出现 **2 次**：

| 行 | 所在函数 | 本单元是否改 |
|---|---|---|
| 4093 / 4094 | `remoteWorkspaceIndex`（`:4078` 起，C3 grouped-view index） | **不动**（越界） |
| 4124 / 4125 | **`remoteSessionIndex`（`:4109` 起）** | **改** |

因此替换必须**限定在 `function remoteSessionIndex(sessions) { … }` 内**。本交付的做法：`make-patched.mjs` 先按 `function remoteSessionIndex(sessions) {` 定位函数体（断言全文件唯一命中），在函数体内断言两个旧 token 各命中 1 次后再替换；补丁后断言旧 token 全局残留恰好 1 次（= `remoteWorkspaceIndex` 原样保留）。

**验收命令**：

```bash
F=~/.dsh/profiles/node_modules/dsh-workspace-enhancement/lib/client.js
grep -c 'const unique = Array.from(new Set(ids));' "$F"                       # 期望 1
grep -c 'const unique = ids.filter((id, index) => ids.indexOf(id) === index);' "$F"   # 期望 1（仅 remoteWorkspaceIndex）
sed -n '4109,4128p' "$F"                                                      # 目视：Set 版只出现在 remoteSessionIndex 内
node --check "$F"                                                             # 无输出 = 通过
```

**预期数字**：新 token ×1、旧 token ×1（补丁前分别为 0 / 2）。

---

### 单元 C2-2 `sessions()` 全量重建 → 按快照引用记忆化

**位置**：`client.js:5418`（`installSidebarRowBadges` 内 `sources.sessions`，函数起始 `:5400`）

**锚点原文（补丁前，`:5418-5428`）**：

```js
				sessions: () => {
					const state = sessionsFeed?.getSnapshot();
					if (state === void 0) return [];
					return Object.values(state.byId).map((row) => ({
						title: row.displayTitle,
						...typeof row.cwd === "string" ? { cwd: row.cwd } : {}
					}));
				}
```

**替换后原文（补丁后）**：

```js
				sessions: (() => {
					/**
					* Memoized by snapshot identity: the feeds publish a new state object
					* per update, so an unchanged reference implies unchanged rows and the
					* last projection is reused verbatim (same array contents, same order).
					*/
					let cachedState;
					let cachedRows = [];
					return () => {
						const state = sessionsFeed?.getSnapshot();
						if (state === cachedState) return cachedRows;
						cachedState = state;
						cachedRows = state === void 0 ? [] : Object.values(state.byId).map((row) => ({
							title: row.displayTitle,
							...typeof row.cwd === "string" ? { cwd: row.cwd } : {}
						}));
						return cachedRows;
					};
				})()
```

**设计要点（为满足"必须保证返回值语义等价"）**：

1. **未命中路径逐字保留原表达式**：`state === void 0 → []`、`Object.values(state.byId).map(...)`、`title` 取自 `row.displayTitle`、`cwd` 仅在 `typeof row.cwd === "string"` 时以展开方式加入（键缺席语义保留）。因此数组内容、元素顺序、对象键序与旧实现完全一致。
2. **记忆化键 = `getSnapshot()` 返回的快照引用**。上游 `createSnapshotStore`（官方 runtime `client.js:5397`，zustand 4.4.7）每次更新都由 `api.setState(..., true)` / immer `produce` 产生**新对象引用**，故引用变 ⇔ 状态已更新（§5 有源码依据）。
3. **用 IIFE 持有缓存槽，而非每次调用查 WeakMap**：缓存槽与安装器同寿命（`installSidebarRowBadges` 在 `apply()` 时调用一次，调用点全文件唯一 = `:5392`），保持改动局部、覆盖语义明确。
4. `sessions` 属性在传入 `installRowBadges` 的 `sources` 对象字面量内**只求值一次**，IIFE 在对象构造时执行 —— 语法与求值时机均已由 `node --check` + 真实 bundle 装载验证（§4 B1）。

**验收命令**：

```bash
F=~/.dsh/profiles/node_modules/dsh-workspace-enhancement/lib/client.js
grep -c 'sessions: (() => {' "$F"      # 期望 1
grep -c 'sessions: () => {' "$F"       # 期望 0
sed -n '5415,5442p' "$F"               # 目视
node --check "$F"
```

**预期数字**：`sessions: (() => {` ×1、`sessions: () => {` ×0。

---

## 2. `--dry-run` 实测 diff（原文照贴）

命令：`bash .workspace/lag-fix/patches/workspace-enhancement-perf.sh --dry-run`（exit 0；live 未写入）

```diff
--- /home/CNS2026495165/.dsh/profiles/node_modules/dsh-workspace-enhancement/lib/client.js	2026-09-14 14:54:49.203333066 +0800
+++ /tmp/lagfix-c2.cewCBY/client.candidate.js	2026-09-20 15:04:41.405205187 +0800
@@ -4121,8 +4121,8 @@
 			const index = /* @__PURE__ */ new Map();
 			for (const [title, ids] of byTitle) {
 				if (localTitles.has(title)) continue;
-				const unique = ids.filter((id, index) => ids.indexOf(id) === index);
-				if (unique.length === 1 && unique[0] !== void 0) index.set(title, unique[0]);
+				const unique = Array.from(new Set(ids));
+				if (unique.length === 1) index.set(title, unique[0]);
 			}
 			return index;
 		}
@@ -5415,14 +5415,25 @@
 					title: item.title,
 					path: item.path
 				})) ?? [],
-				sessions: () => {
-					const state = sessionsFeed?.getSnapshot();
-					if (state === void 0) return [];
-					return Object.values(state.byId).map((row) => ({
-						title: row.displayTitle,
-						...typeof row.cwd === "string" ? { cwd: row.cwd } : {}
-					}));
-				}
+				sessions: (() => {
+					/**
+					* Memoized by snapshot identity: the feeds publish a new state object
+					* per update, so an unchanged reference implies unchanged rows and the
+					* last projection is reused verbatim (same array contents, same order).
+					*/
+					let cachedState;
+					let cachedRows = [];
+					return () => {
+						const state = sessionsFeed?.getSnapshot();
+						if (state === cachedState) return cachedRows;
+						cachedState = state;
+						cachedRows = state === void 0 ? [] : Object.values(state.byId).map((row) => ({
+							title: row.displayTitle,
+							...typeof row.cwd === "string" ? { cwd: row.cwd } : {}
+						}));
+						return cachedRows;
+					};
+				})()
 			}, (onChange) => {
 				const un1 = workspacesFeed?.subscribe(onChange);
 				const un2 = sessionsFeed?.subscribe(onChange);
```

**diff 统计**（脚本输出）：`变更行数：10 删除 / 21 新增；hunk 数：2`

**dry-run 关键行**（`reports/dry-run-C2.log`）：

```
[PASS] live sha256 命中补丁前基线（aef0a3e6…），可安全应用
[PASS] C2-1 锚点 C2-1×2 / C2-2×1 唯一命中，作用域标记齐备
     C2-1 作用域：remoteSessionIndex @ 4109（同形实现 remoteWorkspaceIndex 保留不动）
     C2-2 作用域：installSidebarRowBadges 的 sources.sessions @ 5419
[PASS] node --check 通过；NEW×1/NEW×1；OLD 残留 1/0（remoteWorkspaceIndex 未动）；sha256 命中基线
[PASS] 候选与交付副本 patched/client.js 字节一致
[PASS] equiv-c2.mjs 全部 PASS（27 项）
===== DRY-RUN 完成（live 未做任何写入）=====
```

---

## 3. `node --check` 结果

| 文件 | 命令 | 结果 |
|---|---|---|
| live（补丁前基线，未改动） | `node --check <live client.js>` | **通过**（基线对照） |
| 交付副本 | `node --check .workspace/lag-fix/patched/client.js` | **通过** |
| dry-run 候选（临时路径） | 由脚本 `verify_patched()` 调用 | **通过** |
| 脚本自身语法 | `bash -n patches/workspace-enhancement-perf.sh` | **通过** |

---

## 4. 等价性 / 记忆化契约测试（`tools/equiv-c2.mjs`：27 项全 PASS）

```
=== A. 逻辑复刻对拍（证据 A） ===
[PASS] A1 remoteSessionIndex：13/13 用例逐项一致（Map 的 key 顺序 + value）
[PASS] A1 有效用例校验：'P' 两条同 conn → 去重后 size=1 且 value='dup'
[PASS] A2 sessions()：8/8 用例逐项一致（含键集：无 cwd 的行不得出现 cwd 键）
[PASS] A2-memo 输入未变：连续 3 次调用返回同一数组引用
[PASS] A2-memo 内容正确：[{"title":"A","cwd":"/one"}]
[PASS] A2-memo 边界（显式声明）：同一引用下原地改内容不触发重建 —— 记忆化键=引用，不深比较
[PASS] A2-memo 输入变化：返回新数组引用（不复用旧结果）
[PASS] A2-memo 输入变化：内容按新快照重建且键序一致
[PASS] A2-memo 对照：老实现两次调用返回不同数组（内容相同、引用不同 = 改动的真实差异）
[PASS] A2-memo 时序对拍：4 步（含同快照连打/换快照/清空）内容序列一致
[PASS] A3 NaN 反例：旧式去重把 NaN 全部丢弃（0 项），Set 保留 1 项 → 二者不等价（实测 indexOf(NaN) = -1）
[PASS] A3 字符串域：'' 与重复串上两者等价（故等价性依赖「ids 元素恒为字符串」）
[PASS] A3 空数组：两者均为 []
=== B. 真实 bundle 行为验证（证据 B） ===
[PASS] B1 live bundle 加载成功：apply=function,inject=array(4)
[PASS] B1 patched bundle 加载成功且导出面一致：apply=function,inject=array(4)
[PASS] B2 驱动成功：apply(ctx) 无异常，sessions 订阅数=1，apply 期投影重建 1 次
[PASS] B2 同一快照引用重复触发 onChange：投影重建计数不变（1 → 1）= 记忆化命中
[PASS] B2 第三次触发同快照：计数仍为 1（稳定复用）
[PASS] B2 换新快照触发 onChange：计数 +1（1 → 2）= 按引用失效正确
[PASS] B2d workspaces 订阅触发同一 onChange（sessions 快照未变）：投影重建计数不变（2 → 2）= 记忆化命中
[PASS] B2d 再次 workspaces 订阅触发：计数仍不变（稳定命中）
[PASS] B2c patched 在真远程会话数据上运行 remoteSessionIndex（Set 版）无异常
[PASS] B2c live（旧 O(k²) 版）在相同数据上同样无异常 —— 行为面等价
=== C. 静态交付物断言 ===
[PASS] C1 锚点 2→1：仅 remoteSessionIndex 被替换，remoteWorkspaceIndex 保留旧实现
[PASS] C1 新 token 在 patched 中唯一
[PASS] C2 锚点 1→0、新 token 1：sessions() 已改为记忆化闭包
[PASS] 交付副本存在：patched/client.js
===== ALL PASS =====
```

**A1 用例清单**（13 例）：空数组 / 单条远程 / 重复 id×3 / 重复 id+另一 connId（歧义丢弃）/ 顺序敏感（aaa 先于 bbb 各 2 次）/ 顺序敏感（唯一 id 在第 4 位）/ local 无 cwd 撞名 / cwd 无 placeholder / 空标题跳过 / 多标题 Map 插入顺序 / 缺 cwd 字段 / 非法 connId 字符 / k=1。

**A2 用例清单**（8 例）：byId 空 / 单行带 cwd / 单行无 cwd（键必须缺席）/ cwd 为 null·number·空串 / 多行混合顺序 / 行内键序不同 / displayTitle 空串 / displayTitle undefined。

**A2-memo 补充**：另有 4 步时序对拍（同快照连打、换快照、清空），逐项比较 `JSON.stringify` 序列，证明"每次调用前快照可能变化"的真实使用模式下输出与旧实现一致。

**B 组的诚实边界**（写进测试输出本身，不夸大）：

- patched 实例内 `remoteSessionIndex` 返回的 Map 位于闭包内、外部不可达 → **其逐项等价性由 A1 复刻对拍证明**；B2/B2c 只证明真实运行期不抛错 + 记忆化命中/失效行为。
- B2 的计数探针是给 `state.byId` 套 `Proxy` 拦截 `ownKeys`（`Object.values` 会触发 `ownKeys`），因此"投影重建计数"是**运行期真实观测**，不是源码推断。

---

## 5. 复审中发现的量化边界（主 agent 决策必需）

我在复核时发现两件**必须如实上报**的事实；它们不改变单元落地（用户已拍板"一并修"），但决定这次改动的**真实收益量级**：

### 5.1 C2-1 在现实流量下几乎没有收益（O(k²) 的 k 恒为小常数）

实测（`reports/bench-C2.log`，N=2361 会话，400 轮平均）：

| 形态 | 旧 `filter+indexOf` | 新 `Array.from(new Set)` | 比值 |
|---|---|---|---|
| **现实形态**（远端会话约 14%，其中部分重复 conn） | 0.0809 ms/次 | 0.0787 ms/次 | 1.03x（差 0.0022 ms，噪声级） |
| 最坏形态 k=2（同一 title 下 2 条重复 conn） | 0.0006 ms | 0.0001 ms | 5.3x |
| 最坏形态 k=100 | 0.0013 ms | 0.0005 ms | 2.6x |
| 最坏形态 k=1000 | 0.0125 ms | 0.0042 ms | 2.9x |
| 最坏形态 k=2361（全部同 title 同 conn） | 0.0159 ms | 0.0136 ms | 1.2x |

原因：`byTitle` 的 value 数组在本函数里**只由 cwd 解析出的 connId 堆成**，同一 title 要出现重复 conn，必须有多条**同名会话指向同一远端连接**。现实数据里 k≈1~3，O(k²) 的 k 是常数而非 N。

脚本已内置**无回退门禁**：`[PASS] 无回退：现实流量下新版比旧版慢 -0.0022 ms ≤ 预算 0.05 ms`（超预算即 `exit 1`）。

> 对照 `DIAGNOSIS.md` §1.2 的 `O(N²) 清理（现状）= 5.66 ms/次 → 换 Set 0.090 ms → 63x`：那是**官方** `dsh-client-runtime/lib/client.js:8576` 的 `entryCache` 清理（`items.some(...)`），与第三方插件的这个内层去重**不是同一处**，量级不可互相引用。

### 5.2 C2-2 记忆化只在"sessions 快照未变"时命中，而线上该情形取决于 workspaces 订阅

静态事实（逐条 grep 可复现）：

| 事实 | 证据 |
|---|---|
| `sources.sessions()` 全文件**只有一个调用点** | `grep -n 'sources\.sessions()'` → `:4222`，位于 `rebuildRemote()` 内 |
| `rebuildRemote()` 全文件**只被 `onChange()` 调用** | `:4414`（`grep -n 'rebuildRemote()'` → `:4221`(定义内)、`:4414`(调用)） |
| `onChange` 挂在**两个**订阅上 | `:5429-5434` `un1 = workspacesFeed?.subscribe(onChange)` / `un2 = sessionsFeed?.subscribe(onChange)` |

⇒ 推论：

- **仅 sessions 快照变化时**（会话流式期间的主路径）：每次状态更新 → `onChange` 一次 → `rebuildRemote` 一次 → `sessions()` 一次 ⇒ **记忆化不命中，收益为 0**（B2 的"换新快照计数 +1"即此路径）。
- **仅 workspaces 快照变化时**：`onChange` 触发 → `sessions()` 拿到**同一 sessions 快照引用** ⇒ **记忆化命中，省掉一次 0.2051 ms 的全量重建**（B2d 实测计数不变）。

因此本单元没有消除"每次重建都全量重建 sessions 投影"这条路径，只是让**同一快照纪元内的重复调用**复用结果。要真正消除，需要在运行时侧改动（不在本单元范围，我也不越界）。

**重建成本实测**（N=2361）：`Object.values + map + 展开` = **0.2051 ms/次**，与 `DIAGNOSIS.md` §1.2 记载的 `0.21 ms/次` 同量级（`grep -c` 的调用占比 0.38% 也是同一量级）。

### 5.3 结论：本单元的定位

| | 收益 | 性质 |
|---|---|---|
| C2-1 | 现实流量 ≈ 0.002 ms/次（噪声级）；只要 k 保持小常数即无回退 | **卫生性修复**：把二次复杂度从代码里去掉，防未来同名重复 conn 数据退化 |
| C2-2 | 命中时省 0.205 ms/次；命中条件 = workspaces 侧变化 | **有界收益**，上限 = 每快照纪元一次 0.205 ms |
| 合计（含一次命中） | 单次 `rebuildRemote` 0.2860 ms → 0.0787 ms | **实测上限**，不是稳态均值 |

按 `DIAGNOSIS.md` 实测的整条重建 ≈ 5.94 ms/次衡量，本单元覆盖的约 0.29 ms 占 **≈4.9%**；M2 的主成本（`buildListSnapshot` 9.2% CPU、`:8576` 的 O(N²) 清理、`:9274` 新引用风暴）都在**官方 runtime 包**里，不属本单元。请勿据本报告宣称"卡顿已解决"。

---

## 6. `--apply` / `--rollback` 端到端实证（沙箱副本，未碰 live）

在 `/tmp/c2-applytest/` 建了 live 副本 + 脚本副本（把 `LAGFIX_DIR` 与 `PATCHED` 重映射到沙箱），完整跑 8 步：

| 步骤 | 命令 | 结果 |
|---|---|---|
| 1 | 沙箱 `--dry-run` | exit 0，全部 PASS |
| 2 | 沙箱 `--apply` | exit 0，备份落 `backup-20260920-150636/`（client.js + pre.sha256 + meta.txt + c2.diff） |
| 3 | 应用后断言 | sha256 = `7df7a655…`；与交付副本 `cmp` 一致；`mode=644 size=267026`；**`.map` 字节未变** |
| 4 | 再次 `--apply`（幂等） | exit 0，`[SKIP] live sha256 已等于补丁后基线…已应用，无操作`；备份目录数仍为 **1**（未重复备份） |
| 5 | `--rollback` | exit 0，`[PASS] 回滚后新 token 均已消失` + `[PASS] 回滚后 sha256 = 还原前基线（aef0a3e6…）` + `node --check` 通过 |
| 6 | 回滚后断言 | sha256 = `aef0a3e6…`，与原始 live `cmp` 一致，`mode=644 size=266652` |
| 7 | 回滚后 `--dry-run` | `live 状态：pristine`，可再次应用 |
| 8 | 追加 1 行模拟外部改动后 `--apply` | exit 1，`live 状态：pristine-drift` + `[FAIL] 拒绝自动改写（未写任何 live 文件）` |

**沙箱已清理**（`rm -rf /tmp/c2-applytest`）；真备份目录 `.workspace/lag-fix/patches/backup/` **尚未创建**（apply 时才会建）。

---

## 7. 纪律复核（实测证据）

| 项 | 证据 |
|---|---|
| **未写 live / 未碰工作区外** | live `client.js` sha256 = `aef0a3e663af487abe91698135c7cc70b3138ad4716475fdd5a52e1293fed094`，mtime 仍为 `2026-09-14 14:54:49`，size 266652，mode 644（改动前=改动后） |
| **未改 map** | `client.js.map` sha256 = `0905e0f724f82df63d1d4c9d26683f4058e505bca953dcc355c758ac50bd1e8f`，mtime `2026-09-14 14:54:49` |
| **未重启/未干扰宿主 PID 20806** | `ps -o pid,lstart,etime,cmd -p 20806` → `STARTED 日 9月20 11:47:23 2026 / ELAPSED 03:19:24`（持续存活，无信号） |
| **未压测** | 无 HTTP / WebSocket / RPC 调用；仅本地 Node 计算与文件比较 |
| **未用 sandbox_permissions** | 全程无提权请求 |
| **产物全在工作区** | 见 §0 清单，均在 `.workspace/lag-fix/` |

---

## 8. 无法在沙箱内验证的事项（诚实声明）

1. **未验证浏览器端实际生效**。机制依据（`audit-rebuild.md` §2：`/plugins/<id>/client.js` 每次 GET 读盘、`cache-control: no-cache`、client-hmr 500 ms 轮询重哈希）是**既有调研结论**，本次未发任何 HTTP 探针。apply 后需要主 agent / 用户侧确认：`curl -s http://127.0.0.1:3080/ | grep -o 'dsh-workspace-enhancement/client.js?rev=[a-f0-9]*'` 的 rev 等于新文件 sha1 前 12 位。
2. **未在活动宿主上测量收益**。§5 的全部数字是本机微观基准 + 代码路径静态分析，**不是**端到端实测。特别是 5.2 的"workspaces 快照变化频率"**未实测**——需要运行时探针（给 `workspacesFeed.subscribe` 与 `sessionsFeed.subscribe` 分别计数）才能定出记忆化的真实命中率。
3. **未验证真实 `state.byId` 的行数与形态**。B2 用的是合成快照；N=2361 来自 `DIAGNOSIS.md` 的 `/api/session.list` 实测，本次未复核。
4. **未覆盖 SSE 热换路径**。`dsh-client-hmr` 是否在 500 ms 内推 `rebuilt` 并自动热换本插件，未实测；保守动作是**浏览器整页刷新**。
5. **`sessions` 返回值被下游改动的风险**：已逐个核对 `installRowBadges` 内对 `sources.sessions()` 的唯一消费方式 —— `remoteSessionIndex(...)` 只读遍历（`for (const session of sessions)`），结果存进新 `Map`，不回写、不排序、不 splice。因此"返回同一数组引用"无副作用。**但这是代码静态核对，不是运行期断言**（无法在闭包外取得该数组）。
6. **记忆化键=引用（不深比较）的边界**：若有代码**原地修改**同一快照对象的 `byId`（不换引用）而不经 `setState`，记忆化会返回陈旧结果。上游 `createSnapshotStore` 的写路径（`set` / `update`）都产生新引用，`A2-memo 边界` 断言把该前提显式固化在测试里；若未来第三方代码原地改状态，需重新评估。

---

## 9. 主 agent 需执行的确切命令序列

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix

# 0) 前置只读确认（可选）
sha256sum ~/.dsh/profiles/node_modules/dsh-workspace-enhancement/lib/client.js
#   期望 aef0a3e663af487abe91698135c7cc70b3138ad4716475fdd5a52e1293fed094
bash patches/workspace-enhancement-perf.sh --dry-run    # 期望 exit 0 + 全 PASS
node tools/equiv-c2.mjs                                 # 期望 27 项全 PASS
node tools/bench-c2.mjs                                 # 期望 exit 0（无回退门禁 PASS）

# 1) 应用（唯一写 live 的一步；自动备份到 patches/backup/backup-<时间戳>/）
bash patches/workspace-enhancement-perf.sh --apply       # 期望 exit 0 + [PASS] live 补丁后校验通过

# 2) 生效验证（只读；浏览器刷新即生效，无需重启宿主）
node --check ~/.dsh/profiles/node_modules/dsh-workspace-enhancement/lib/client.js
sha1sum ~/.dsh/profiles/node_modules/dsh-workspace-enhancement/lib/client.js | cut -c1-12
curl -s http://127.0.0.1:3080/ | grep -o 'dsh-workspace-enhancement/client.js?rev=[a-f0-9]*'
#   → 两者应一致（client-hmr 500ms 内刷新 rev）；浏览器 Ctrl/Cmd+R 后插件功能自检：
#     侧栏远程会话徽标、远程工作区树、SSH 目录选择器、设置页「远程机器」照常。

# 3) 回滚（任何时候，一条命令）
bash patches/workspace-enhancement-perf.sh --rollback    # 期望 [PASS] ×3 + 刷新浏览器即回滚
```

**apply 后请勿**：改 `client.js.map`、重启宿主（不必要）、把 `$.dsh/profiles` 的 `install-plugins.sh` 重跑（会 `rm -rf` 覆盖本插件目录，补丁需按 §9 重放）。

---

## 10. 自复核结论

**通过（PASS）** —— 但带 §5 的量化边界与 §8 的未验证清单：

- 2/2 单元按锚点原文精确落地，**未越界**（`remoteWorkspaceIndex`、SSH/RPC 功能逻辑、其它函数一律未动；`client.js.map` 未动）。
- 返回值语义等价：A1 13/13 + A2 8/8 + 时序 4 步逐项一致；记忆化契约（未变→同引用、变化→新内容）有显式断言与实测。
- `--dry-run` 真跑通并贴出 diff；`node --check` 三处通过；`--apply`/`--rollback`/幂等/漂移拒绝在沙箱副本端到端实证。
- **收益远小于 `DIAGNOSIS.md` §3 第 7 项"每次重建省 0.2~0.8ms"的表述**：实测上限 0.205 ms/次且需 workspaces 侧变化才命中；C2-1 在现实数据上仅去掉二次复杂度、实测无显著收益。**本单元不足以改变卡顿观感**，请勿与官方 runtime 侧修复混算。
- **未对 live 做任何写入** —— `--apply` 由主 agent 按 §9 执行。
