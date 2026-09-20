# 单元 B1 交付报告 — 服务端 `session.list` 不再全量下发前端不渲染的 subagent 会话

**档位**：修订执行复核一体（Revise-Execute-Review）
**依据**：`/home/CNS2026495165/dsh/.workspace/settings-lag/audit-subagent-filter.md`（265 行）+ 用户裁决（方案 B + 补聚合字段，N=200）
**产出目录**：`/home/CNS2026495165/dsh/.workspace/lag-fix/`
**沙箱纪律**：未写入 `/home/CNS2026495165/.dsh/` 或任何工作区外路径；未重启/停止/干扰 PID 20806；HTTP 探针 **单发 1 次**（POST `/api/session.list`，只读）；未压测；未使用 `sandbox_permissions`。
**日期**：2026-09-20

---

## 0. 结论（自裁决）

> **通过（可交付主 agent 执行 `--apply`）**，但带 **1 项必须知晓的修订**：
>
> ⚠️ **任务书点名的 `lib/types/api-proxy.js` 不是宿主实际加载的文件。**
> `package.json` 的 `main` 是 `lib/index.js`，且 `dsh-client-connection` 以**裸包名** `import { toFetchHandler } from "@deepseek-ai/dsh-host-apiproxy"`；
> `lib/index.js` 是一份**自带 `//#region lib/types/api-proxy.js` 的打包副本**（内含完整 `createApiProxy`，不 import `./api-proxy.js`）。
> **结论：只按任务书改 `api-proxy.js` 将「完全不生效」**。故本补丁**同时改两份**（`lib/index.js` 为生效文件，`api-proxy.js` 为任务书点名 + `./api/*` 子路径导出的一致性文件），
> 两份差异仅在排版（TAB/去尾逗号/双引号/`void 0` vs 4 空格/尾逗号/单引号/`undefined`），由 `B1-transform.cjs` 从源文件实测风格生成，dry-run 对两份均通过 ESM 语法校验。

其余交付单元 1:1 落地，无扩范围；C2–C5 消费方**未改动**；`sessions.search` **未改动**（理由见 §7）。

---

## 1. 交付物清单

| 文件 | 作用 |
|---|---|
| `patches/server-session-filter.sh` | 服务端过滤 + 聚合字段补丁（`--dry-run` / `--apply` / `--rollback` / `--help`） |
| `patches/B1-transform.cjs` | 服务端变换引擎（锚点计数校验 + 按实测风格生成代码 + 变更后自校验） |
| `patches/workspace-ui-runsubagent-count.sh` | C1 消费方最小改动补丁（同样三种模式） |
| `patches/B1-transform-client.cjs` | 客户端变换引擎 |
| `patches/B1-semantic-test.cjs` | 服务端语义自测（真实 payload：过滤 + 聚合逐 id 比对） |
| `patches/B1-client-semantic-test.cjs` | 客户端取值语义自测（宿主字段优先/回落/`entryCache` 新鲜度） |
| `patches/B1-simulate-post-patch.cjs` | 用真实 payload 生成「打补丁后」模拟响应（沙箱内无法重启宿主时用于端到端离线复核） |

> **命名纪律（本次按主 agent 通报整改）**：本单元全部产物使用 **`B1-` 前缀**或 `unit-B1` 名，
> **不写 `patched/`**（该目录被 C1 与 C2 两个档位当交付副本目录使用，已有「C1 覆盖 C2」先例）、
> **不写 `tmp/` 与 `backup/` 顶层**（多档共用）。本单元独占路径见 §1.1。
| `probes/session-list-shape.mjs` | 只读探针（条目/字节/顶层 ID 逐条比对/新字段检查；支持 `--from-file` 离线复核） |
| `evidence/*.txt` `evidence/*.json` | 本轮全部实测输出（dry-run diff、语义自测、探针前后对照） |
| `reports/unit-B1.md` | 本报告 |

### 1.1 产物命名冲突审计（应主 agent 通报）

| 共享路径 | 他档占用情况 | 本单元的做法 |
|---|---|---|
| `patched/` | C1 的 `client.js`（client-runtime，398,784 B）+ `client.js.diff`、C2 的 `workspace-enhancement.client.js`；发生过程序性互覆 | **完全不写**。本单元不产出交付副本到共享目录；打补丁后的完整副本只落在**本单元时间戳工作区** `tmp/B1/dryrun-<stamp>/b1-*.patched.js` |
| `tmp/`（顶层） | C1/C2/A 的 `dbg-*.js`、`debug*.mjs`、`mod/`、`orig/`、`patched/` 等 | **不写顶层**。本单元工作区根 = `tmp/B1/`（dry-run 目录名也带单元标签：`tmp/B1/dryrun-<stamp>/`、`tmp/B1/dryrun-client-<stamp>/`） |
| `backup/`（顶层） | 已有 `settings.yaml.pre-image-decl-*`；且 `usage-plugin.sh`、`workspace-enhancement-perf.sh` 与本单元两脚本**都**用 `backup/<时间戳>/` → 回滚时 `ls -d backup/*/ \| tail -1` 可能取到**他档快照** | 本单元备份根改为 **`backup/B1/<时间戳>/`**；`--rollback` 增加**所有权校验**：目录必须同时含本单元两个目标文件，否则 `[FAIL] … 拒绝回滚以免误覆 live` |
| `patches/` | 与 A/C1/C2 同目录 | 本单元文件全部带 **`B1-` 前缀**或单元名（`server-session-filter.sh`、`workspace-ui-runsubagent-count.sh`、`unit-B1.md`），无同名 |
| `probes/` `reports/` | 与 C1/C2 同目录 | `probes/session-list-shape.mjs`、`reports/unit-B1.md` —— 均唯一名 |

**自检命令（可复核，只读）**：

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix
ls -la patched/                       # 本单元 0 个文件（全是 C1/C2 的）
ls -la tmp/B1/                 # 本单元独占工作区（--dry-run 产出；backup/B1/ 仅在 --apply 后出现）
grep -nE 'patched/|tmp/|backup/' patches/server-session-filter.sh patches/workspace-ui-runsubagent-count.sh | grep -vE 'patched\.js|B1/'
```

`sha256`（本轮最终版）：

```
cb1c12d02703baeaaad2ad4a67c32840023382f8013ecc9c59f6349a318efcd3  patches/B1-transform.cjs
75bee3a0c9ecf18979c00cd3fe9942a49bd5de6204073e4ba20ecac017838c8f  patches/B1-transform-client.cjs
d6c65e816142ee5de950f5dbbf85a6610a166b79fab0c954b18584f713b1e0ee  patches/server-session-filter.sh
b3834d78117460af3e0d587e2dd52eff7f685b01a05c1c093c26fb920952912c  patches/workspace-ui-runsubagent-count.sh
15a75439f09d5c42fbec384d90f4882d928b899b025af1f57b617afdc1af0a46  patches/B1-semantic-test.cjs
5eeb391808ee128c96ada2f6b199510b10981c5595a422d325da35da67e58a7a  patches/B1-client-semantic-test.cjs
d4a197aaf8c6448f05a375c30bbb05f1a21c7706243ce53c06fce47943e26703  patches/B1-simulate-post-patch.cjs
e156b97768f046e7786dc7a93412c93281fe2a0e892deb2224b38b80245ddb50  probes/session-list-shape.mjs
```

---

## 2. 逐条交付单元（文件:行号 → 改动 → 验收命令 → 预期数字）

> 行号口径：**live 文件行号**（打补丁前）+ **打补丁后行号**（dry-run 副本实测）。
> 基线实测（本轮二次只读抓取，`evidence/probe-pre-patch.json`）：**2,386 条 / 3,924,952 B / 顶层 85**（较审计快照 2,361/84 各 +25/+1，是运行期间的新会话增量）。

### B1-0（前置发现）目标文件有两份，都必须改

| | |
|---|---|
| **文件** | ① `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js`（**宿主实际加载**，5580 行 / 213,007 B）<br>② 同包 `lib/types/api-proxy.js`（任务书点名，3358 行 / 171,271 B） |
| **证据** | `package.json` `"main": "lib/index.js"`；`dsh-client-connection/lib/index.js:2` `import { toFetchHandler } from "@deepseek-ai/dsh-host-apiproxy"`；`lib/index.js:872` 含 `//#region lib/types/api-proxy.js`；`grep -c 'from "\./api-proxy' lib/index.js` = 0 |
| **验收命令** | `grep -c 'api-proxy.js' <pkg>/lib/index.js   # 期望 1（仅 region 注释）`<br>`node -e 'console.log(require("<pkg>/package.json").main)'   # 期望 lib/index.js` |
| **预期** | 只改 `api-proxy.js` → **运行期完全无效果**；本补丁两份都改 |

### B1-1 subagent 截断到最近 200 条（顶层全量）

| 位置（live → patched） | 改动 |
|---|---|
| `api-proxy.js:1416` → `1461..1467` | `const items = ctx.sessions.list().map(summarizeAttached);` → 先分流：顶层 id 全收 `keep`，subagent 按 `sessionListUpdatedAt` 降序取前 `SUBAGENT_LIST_MAX`，再 `filter(keep).map(summarizeAttached)` |
| `api-proxy.js:1421-1422` → `1470..1487` | `const cold = (await persistence.list(signal)).filter(...)` → `coldSource` + `coldSubagentCandidates`（降序 `slice(0,N)`）+ 状态式 `filter`（非 subagent 恒保留；subagent 需在候选集且 `coldSubagentSeen <= N`）**并顺手修掉原实现的重复 `persistence.list` 只调用一次** |
| `api-proxy.js:1458` → `1524..1529` | 排序后收口：`overflow = subagentItems.slice(N)` → 只丢这 N 条以外的 subagent，`return annotateRunningSubagentCounts(retained)` |
| `lib/index.js:2187 / 2192 / 2220` → `2232..2238 / 2241..2258 / 2285..2292` | 同一逻辑（TAB/双引号/无尾逗号排版） |
| 常量：`api-proxy.js:381` 前插入 → `382-384`；`index.js:1230` 前插入 → `1231-1233` | `const SUBAGENT_LIST_MAX = Number.isFinite(globalThis.__DSH_SUBAGENT_LIST_MAX) ? Math.max(0, Math.trunc(...)) : 200;`（默认 200；运行期可用 `globalThis.__DSH_SUBAGENT_LIST_MAX` 覆盖，**无需改配置 schema**） |

**验收命令**

```bash
grep -c 'dsh-lag-fix B1: 顶层全发 + subagent 最近 N 条' <pkg>/lib/index.js   # 期望 1
grep -c 'coldSubagentSeen <= SUBAGENT_LIST_MAX' <pkg>/lib/index.js          # 期望 1
node probes/session-list-shape.mjs                                          # A1/A2/A7
```

**预期数字**：条目 `2386 → ≤ 285`（顶层 85 + 200）；subagent 行 `2301 → 200`。

### B1-2 聚合字段 `runningSubagentCount`

| 位置（live → patched） | 改动 |
|---|---|
| `api-proxy.js:381-391` → `424-437`；`index.js:1230-1242` → `1273-1285` | `sessionListFields(header, events = [])` → `(header, events = [], extra = void 0)`，返回体在 `agentPreset` 之后追加 `...extra === void 0 ? {} : extra` |
| 新增 `annotateRunningSubagentCounts(items)`：`api-proxy.js:394-421`；`index.js:1243-1271` | 用 `items` 建父子图 + `ctx.sessions.list()` 的 live `agents.get(id)?.status === 'running'`，对**每个顶层行**按「不间断 subagent 血缘链」BFS 统计 running 后代数，写入 `item.runningSubagentCount`。成本 = 一次行遍历 + 一次 live agent 查表，**无新增投影/读盘** |

**验收命令**

```bash
grep -c 'function annotateRunningSubagentCounts' <pkg>/lib/index.js   # 期望 1
node probes/session-list-shape.mjs | grep A6                          # 期望 PASS
```

**预期数字**：全部顶层行带 `runningSubagentCount`（number）；真实 payload 下 3 条 running subagent → 顶层总和 = 3；模拟复核中为 4（运行期新增 1 条）。

### B1-C1 消费方最小改动（侧边栏状态点）

| 文件:行号（live → patched） | 改动 | 理由 |
|---|---|---|
| `dsh-client-ui-workspace/lib/client.js:171` → `171` | `runningSubagentCount: typeof s.runningSubagentCount === "number" ? s.runningSubagentCount : (descendants.get(s.id)?.runningCount ?? 0)` | C1 唯一的取值点（`sessionNode`，分组视图） |
| 同文件 `:286` → `286` | 同上（变量 `summary`，搜索结果行） | 同一字段的第二个取值点，属同一消费方，必须同改否则搜索结果行状态点不一致 |
| `dsh-client-runtime/lib/client.js:8570` → `8572` | `entryCache` 新鲜度链尾追加 `&& prev.runningSubagentCount === entry.runningSubagentCount` | 该链**逐字段**判定是否复用旧条目对象；`runningSubagentCount` 不在链上时，「计数变了但其他字段没变」会复用旧对象 → 状态点不刷新（我实测确认了这条链的存在与判定方式） |

**验收命令**

```bash
grep -c 'dsh-lag-fix B1/C1' <ui>/lib/client.js                      # 期望 2
grep -c 'prev.runningSubagentCount === entry.runningSubagentCount' <runtime>/lib/client.js  # 期望 1
```

**预期数字**：宿主字段 = 3/0 → 取 3/0；宿主字段缺失（服务端未重启）→ 回落原就地聚合值（**零回归**）；非 number → 回落。

### B1-C2…C5：**不改**（按裁决第 3 条）

| 消费方 | 方案 B（顶层全发 + subagent 最近 200）下的实际影响 | 依据 |
|---|---|---|
| C2 子代理面板作者计数 `ui-subagent:397/415-420` | 直接子仍由 `subagents.list`（catalog）撑住，不受影响；孙代及以上若落在 200 窗口外则计数偏低——与审计 §3 判定一致（降级，非破坏） | 不动 |
| C3 面包屑祖先链 `ui-conversation:7290-7306` | 当前链有合成条目（`client.js:9245-9266`），窗口内的祖先链完整 | 不动 |
| C4 同级切换器 `ui-subagent:664-667` | 窗口内的 subagent 行仍带 `origin`，切换器可用；仅窗口外降级 | 不动 |
| C5 workflow-run 成员跳转 `ui-workflow-run:171-179` | 近 200 条覆盖近期 workflow 成员，跳转可用；只有「很久以前」的成员行会不可点（审计 §7 未证实项 1 的同一条件） | 不动 |

**若主 agent 想彻底消除 C2–C5 的理论降级**，唯一办法是把 N 提到 ≥ 全量（等于回到今天的行为）或走审计的方案 C（新增按需 RPC）——**两者都超出本单元范围，本档不自行决定。**

---

## 3. dry-run 实测输出（真实执行，逐字粘贴）

命令：`bash patches/server-session-filter.sh --dry-run`（完整输出见 `evidence/dryrun-server-filter.txt`，263 行）

```
===== server-session-filter（单元 B1）模式：dry =====
PKG=/home/CNS2026495165/.dsh/profiles/node_modules/@deepseek-ai/dsh-host-apiproxy
subagent 下发上限：200（常量在源文件内，可用 globalThis.__DSH_SUBAGENT_LIST_MAX 覆盖）
[PASS] 锚点校验通过（sessionListFields / 内存分支 / 冷会话分支，两个文件各 1 次唯一命中）
工作区副本：/home/CNS2026495165/dsh/.workspace/lag-fix/tmp/dryrun-20260920-151940
TRANSFORM_OK 212617 -> 215933      ← lib/index.js（宿主实际加载；212617/171157 是本次读取瞬间的实测字节）
TRANSFORM_OK 171157 -> 174810      ← lib/types/api-proxy.js
[PASS] 两份副本均变换成功且通过 ESM 语法校验（node --check）
```

diff 摘要（8 个 hunk，4 个/文件）：

```
@@ -1227,7 +1227,50 @@   ← index.js: 常量 + annotateRunningSubagentCounts（新增 43 行）
@@ -1236,7 +1279,9 @@    ← index.js: sessionListFields 形参 + 聚合字段
@@ -2184,12 +2229,34 @@   ← index.js: 内存分支过滤（+22 行）
@@ -2217,8 +2284,12 @@    ← index.js: 排序收口 + 聚合调用
@@ -378,7 +378,50 @@      ← api-proxy.js: 同上（+43 行）
@@ -388,6 +431,8 @@       ← api-proxy.js: sessionListFields
@@ -1413,13 +1458,34 @@   ← api-proxy.js: 内存 + 冷会话分流
@@ -1455,8 +1521,12 @@    ← api-proxy.js: 排序收口
```

关键片段（`api-proxy.js` 版，宿主版仅排版不同）：

```diff
-        const items = ctx.sessions.list().map(summarizeAttached);
+        /* dsh-lag-fix B1: 顶层全发 + subagent 最近 N 条 */
+  const attachedSessions = ctx.sessions.list();
+  const attachedSubagents = attachedSessions.filter((session) => session.header.origin === 'subagent');
+  attachedSubagents.sort((a, b) => sessionListUpdatedAt(b.header, sessionListMetadata(b.events)) - sessionListUpdatedAt(a.header, sessionListMetadata(a.events)));
+  const keep = new Set();
+  for (const session of attachedSessions) if (session.header.origin !== 'subagent') keep.add(session.id);
+  for (const session of attachedSubagents.slice(0, SUBAGENT_LIST_MAX)) keep.add(session.id);
+  const items = attachedSessions.filter((session) => keep.has(session.id)).map(summarizeAttached);
...
-            const cold = (await persistence.list(signal))
-                .filter(meta => !attached.has(meta.id) && meta.cwd !== undefined);
+            // 冷会话同源分流：顶层 id 一条不少；subagent 只保留「最近 SUBAGENT_LIST_MAX 条」作为候选，
+            // 其余在下面的 filter 中直接剔除，避免为它们做投影与冷读（本次削峰的主路径）。
+            const coldSource = (await persistence.list(signal));
+            const coldSubagentCandidates = coldSource
+              .filter((meta) => meta.origin === 'subagent')
+              .sort((a, b) => b.updatedAt - a.updatedAt)
+              .slice(0, SUBAGENT_LIST_MAX);
+            const coldSubagentIds = new Set(coldSubagentCandidates.map((meta) => meta.id));
+            let coldSubagentSeen = 0;
+            const cold = coldSource.filter((meta) => {
+              if (attached.has(meta.id) || meta.cwd === void 0) return false;
+              if (meta.origin !== 'subagent') return true;
+              if (!coldSubagentIds.has(meta.id)) return false;
+              coldSubagentSeen += 1;
+              return coldSubagentSeen <= SUBAGENT_LIST_MAX;
+            });
...
-        items.sort((a, b) => b.updatedAt - a.updatedAt);
-        return items;
+        items.sort((a, b) => b.updatedAt - a.updatedAt);
+        // 收口：合并排序后按 updatedAt 只留「最近的 SUBAGENT_LIST_MAX 条 subagent」；顶层一条不丢。
+        const subagentItems = items.filter((item) => item.origin === 'subagent');
+        const overflow = subagentItems.slice(SUBAGENT_LIST_MAX);
+        const retained = overflow.length === 0 ? items : items.filter((item) => !overflow.some((drop) => drop.sessionId === item.sessionId));
+        return annotateRunningSubagentCounts(retained);
```

命令：`bash patches/workspace-ui-runsubagent-count.sh --dry-run`（完整输出 `evidence/dryrun-client.txt`）

```
工作区副本：/home/CNS2026495165/dsh/.workspace/lag-fix/tmp/B1/dryrun-client-20260920-152324
[PASS] 锚点校验通过（3 处单行锚点各 1 次唯一命中）
TRANSFORM_OK 113461 -> 113665      ← ui-workspace/lib/client.js（113461/392055 为本次读取瞬间实测字节）
TRANSFORM_OK 392055 -> 392115      ← client-runtime/lib/client.js
[PASS] 两份副本均变换成功且通过 ESM 语法校验

@@ -168,7 +168,7 @@
-				runningSubagentCount: descendants.get(s.id)?.runningCount ?? 0,
+				runningSubagentCount: typeof s.runningSubagentCount === "number" ? s.runningSubagentCount : (descendants.get(s.id)?.runningCount ?? 0), /* dsh-lag-fix B1/C1 */
@@ -283,7 +283,7 @@
-						runningSubagentCount: descendants.get(summary.id)?.runningCount ?? 0,
+						runningSubagentCount: typeof summary.runningSubagentCount === "number" ? summary.runningSubagentCount : (descendants.get(summary.id)?.runningCount ?? 0), /* dsh-lag-fix B1/C1 */
@@ -8569,7 +8569,7 @@
-					if (prev !== void 0 && ... && prev.completed === entry.completed) return prev;
+					if (prev !== void 0 && ... && prev.completed === entry.completed && prev.runningSubagentCount === entry.runningSubagentCount) return prev;
```

> 注：客户端补丁里三元分支的回落项写成 `(descendants.get(x.id)?.runningCount ?? 0)` 是**必须的括号**——
> `??` 优先级低于 `?:`，不括号会被解析成 `cond ? a : (b ?? 0)`，导致「宿主字段为 `undefined` 时整式归零」而不是回落。这条是执行中**实测发现并修掉**的真实缺陷（`B1-client-semantic-test.cjs` 的「宿主字段缺失 → 回落 7」用例即为此守门）。

### 语义自测（真实 payload）

`node patches/B1-semantic-test.cjs`（`evidence/semantic-server.txt`）：

```
payload: 2361 行（顶层 84 / subagent 2277）
[PASS] N=200：顶层会话逐 ID 相等（84 条）
[PASS] N=200：subagent 行数 ≤ 200
[PASS] N=200：条目总数 ≤ 顶层+200
[PASS] N=200：保留的 subagent 全为 updatedAt 最新的 200 条
字节：全量 3885937 → 保留 475385（−87.8%）
[PASS] N=200：字节 ≤ 500KB
[PASS] N=0：只剩顶层
[PASS] N=∞：一条不丢
[PASS] 聚合：从副本抽出 annotateRunningSubagentCounts
payload 中 running===true 的 subagent：3 条
[PASS] 聚合：每个顶层行都写入了 runningSubagentCount（number）
[PASS] 聚合：计数与客户端 indexSubagentDescendants 逐 id 相等
[PASS] 聚合：全部 3 条 running subagent 都在保留窗口内（状态点可达）
[PASS] 边界记录：N=0 时聚合计数归零（已知限制；本单元取 N=200）
===== 语义自测全部 PASS =====
```

`node patches/B1-client-semantic-test.cjs`（`evidence/semantic-client.txt`）：19 项全 PASS（宿主字段=3→3、=0→0、缺失→回落 7、非 number→回落 7、不在 `byId` 的冷父靠宿主字段仍可达、`entryCache` 同值复用/异值不复用）。

### 探针（真实只读，1 次 HTTP）

`node probes/session-list-shape.mjs --out evidence/probe-pre-patch.json`（**打补丁前**，`evidence/probe-pre-patch-run.txt`）：

```
POST http://127.0.0.1:3080/api/session.list（1 次，只读）
HTTP 200  657 ms  原始响应 3924952 B
条目：2386（顶层 85 / subagent 2301）
[FAIL] A1 条目数 ≤ 顶层+200 — 实得 2386
[FAIL] A2 字节 ≤ 500 KB — 实得 3924952 B
基线：2361 条 / 3885937 B → 现在 2386 条 / 3924839 B   （条目 −-1.1%，字节 −-1.0%）
[PASS] A3a 顶层会话一条不少（基线 84 条）
[PASS] A3b 多出的 1 条顶层会话均为快照之后新建（updatedAt > 1789885381804）
[FAIL] A6 顶层行全部带 runningSubagentCount（number） — 0/85
[FAIL] A7 subagent 行 ≤ 200 — 实得 2301
行字段并集：agentPreset, blank, cwd, origin, parentSessionId, projections, running, sessionId, updatedAt
===== 探针 4 项 FAIL =====
```

→ **符合预期**：未打补丁时 A1/A2/A6/A7 全红、A3（顶层 84 条一条不少）已绿——这正是补丁要修的 4 项。

打补丁后的 **离线端到端复核**（沙箱不能重启宿主，故用真实 payload 喂同一逻辑生成同形状响应，`evidence/probe-post-sim-run.txt`）：

```
node patches/B1-simulate-post-patch.cjs                          → 285 条（顶层 85 / subagent 200）/ 472584 B
node probes/session-list-shape.mjs --from-file evidence/probe-simulated-post-patch.json
[PASS] A1 条目数 ≤ 顶层+200（当前阈值 285；审计快照值为 284）
[PASS] A2 字节 ≤ 500 KB
[PASS] A3a 顶层会话一条不少（基线 84 条）
[PASS] A3b 多出的 1 条顶层会话均为快照之后新建
[PASS] A6 顶层行全部带 runningSubagentCount（number）     顶层 runningSubagentCount 之和 = 4
[PASS] A7 subagent 行 ≤ 200
行字段并集：…, running, runningSubagentCount, sessionId, updatedAt
===== 探针全部 PASS =====
```

**实测数字对照表**

| 口径 | 打补丁前（真实抓取） | 打补丁后（模拟复核） | 审计基线快照 | 目标 |
|---|---|---|---|---|
| 条目 | 2,386 | 285（=85+200） | 2,361 | ≤ 284 / ≤ 顶层+200 |
| 字节（信封） | 3,924,952 B | 472,584 B（−87.8%） | 3,886,050 B | ≤ 500 KB |
| 顶层会话 | 85（含 1 条新增） | 85（逐 ID 一条不少） | 84 | 一条不少 |
| subagent 行 | 2,301 | 200 | 2,277 | ≤ 200 |
| `runningSubagentCount` | 无 | 全部顶层行，总和 4 | — | 必须存在 |

---

## 4. 自复核结论

| 复核项 | 结论 | 证据 |
|---|---|---|
| `--dry-run` 在工作区副本跑通并贴 diff | ✅ | `evidence/dryrun-server-filter.txt` / `evidence/dryrun-client.txt` |
| 语法校验（改后文件） | ✅ 4/4 `node --check`（ESM 上下文） | 两个 dry-run 的 `[PASS] … ESM 语法校验` |
| 锚点唯一性：每处先计数，不符即拒绝（未写 live） | ✅ | `patches/*.sh` 的 `anchor_precheck()`；服务端 6 个锚点 × 2 文件 = 12 次计数、客户端 4 个锚点，**全部计得 1** 才继续 |
| 顶层会话 84 条 ID 逐条相等 | ✅ | `semantic-server.txt`（离线 payload 84/84）+ `probe-post-sim-run.txt` A3a/A3b（真实抓取 85/85 含增量） |
| 新字段出现且逐 id 与客户端算法一致 | ✅ | `semantic-server.txt`「计数与客户端 indexSubagentDescendants 逐 id 相等」 |
| running 状态点数据可达（A4 的前置条件） | ✅ 逻辑层：全部 running subagent 都在 200 窗口内 | `semantic-server.txt` 末两项 |
| 幂等 | ✅ 命中 `dsh-lag-fix B1` 即 SKIP；半应用状态（只有一份带标记）**拒绝继续并要求先回滚** | `unit_state()` |
| 未触碰宿主 / 未越界写盘 | ✅ 0 次重启、0 次压测、HTTP 仅 1 次 | 全程 `--dry-run`，live 文件字节未变（见下） |

**live 未被本档改动（自证）**：本轮所有验证都走 `--dry-run`，只写本单元独占目录 `tmp/B1/`。
`grep -c 'dsh-lag-fix B1'` 在 4 个 live 文件上均为 **0**；`patched/` 下**没有本单元任何文件**。

> ⚠️ **live 漂移提示（执行前必读）**：同项目**另有档位正在并发改写同批官方包**（实测本档读取期间
> `lib/index.js` 在 212,617 ↔ 213,007 B 之间变动、`dsh-client-runtime/lib/client.js` 在 392,055 ↔ 392,229 B 之间变动；
> `lib/index.js` 已含既有 `U-4` 补丁）。
> 本补丁的锚点**不依赖**那些改动（每次都从**当前** live 内容读取并校验），但**主 agent 执行 `--apply` 前必须重跑一次 `--dry-run`**：
> 若届时锚点计数不符，脚本会明确 `[FAIL] 锚点计数不符` 并**拒绝写入**（不会产生半改文件、不会误写）。
> 同理，跨档位 **apply 顺序**上若与其它档位改同一文件，请一次只让一个档位落地并各自验证。

### 执行过程中发现并修掉的真实缺陷（自复核价值所在）

1. **`??` 与 `?:` 优先级**：客户端首版生成 `cond ? a : b ?? 0`，语义变成「a 为 undefined 时归零」而非回落 → 已加括号并由语义测试守门（§3 注）。
2. **冷分支 `coldSubagentIds` 的 TDZ**：首版把候选集声明在 `filter` 之后 → 合并排序后虽语法合法但运行期必然 `ReferenceError`；已改为「先声明候选集，再状态式 filter」。
3. **`;` 丢失**：只替换 `.filter(...)` 片段会吞掉语句分号 → 已改为整条语句替换。
4. **块首缩进继承**：块插入到原行位置时会继承上一行缩进（出现 `\t\t/*` 与 `}` 同行等）→ 已用 `clipHead` + 原始缩进串修正；**两版排版（TAB/4 空格）现已各自风格一致**。

---

## 5. 需主 agent 执行的确切命令序列

> 沙箱在 `/home/CNS2026495165/dsh` 内可写，但 **live 目标在 `/home/CNS2026495165/.dsh/`（工作区外）**——本档按硬约束未尝试写入。
> 主 agent 若同样受 workspace-write 限制，`--apply` 会失败（脚本会明确报 `写入 … 失败`/不可写 WARN 并**不改任何 live 文件**）；此时请由具备该写权限的一方执行。

### 5.1 两个补丁的「生效方式」必须分开看（冷面 / 热面）

| | 服务端 `server-session-filter.sh` | 客户端 `workspace-ui-runsubagent-count.sh` |
|---|---|---|
| 目标 | `dsh-host-apiproxy/lib/index.js`（宿主加载件）+ `lib/types/api-proxy.js` | `dsh-client-ui-workspace/lib/client.js` + `dsh-client-runtime/lib/client.js` |
| 面 | **宿主侧冷面** | **客户端热面** |
| 机制 | web 层 `- id: <hmr> disabled: true`；兜底 HMR `root: []` → 宿主**不热重载**这两个文件 | 宿主按 `/plugins/<id>/client.js` **每次 GET 从磁盘读**（`no-cache`）；`?rev=` 只是 sha1-12 缓存破坏串；`dsh-client-hmr` 500 ms 轮询推 `rebuilt` |
| **生效前置** | **必须重启 DSH（`npx @deepseek-ai/dsh web`）**；**刷新浏览器无效** | **刷新浏览器即生效**（http://127.0.0.1:3080）；**无需重启** |
| 重启代价 | 会**中断当前会话连接** → 由主 agent/用户选时机执行，脚本不代为重启 | 无 |
| 回滚后 | 仍需重启才退出效果 | 仍需刷新浏览器 |

**⚠️ 明确前置**：服务端补丁**不是**「刷新即生效」。在宿主重启之前，`session.list` 仍返回全量 subagent 行、也不会出现 `runningSubagentCount` 字段；
此期间客户端补丁走回落分支，行为与今天完全一致（**零回归**），不会报错、不会显示错误的计数。

### 5.2 命令序列

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix

# 0) 预检（只读，不发 HTTP）：确认 live 尚未被改过、锚点仍在
grep -c 'dsh-lag-fix B1' /home/CNS2026495165/.dsh/profiles/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js        # 期望 0
grep -c 'dsh-lag-fix B1' /home/CNS2026495165/.dsh/profiles/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/types/api-proxy.js  # 期望 0
bash patches/server-session-filter.sh --dry-run            # 期望 exit 0 + 语义自测全 PASS（会真跑并打 diff）

# 1) 客户端（热面：改完刷新浏览器即生效，无需重启；可先行、可独立回滚）
bash patches/workspace-ui-runsubagent-count.sh --dry-run   # 期望 exit 0 + 客户端语义自测全 PASS
bash patches/workspace-ui-runsubagent-count.sh --apply
#    → 备份落在 backup/B1/<时间戳>/
#    → 刷新浏览器 http://127.0.0.1:3080

# 2) 服务端（冷面：需写 ~/.dsh/... 权限；**必须重启宿主才生效**）
bash patches/server-session-filter.sh --apply              # 备份 → 锚点校验 → 应用 → ESM node --check
#    → 备份落在 backup/B1/<时间戳>/（含 lib/index.js 与 lib/types/api-proxy.js 原件）
#    → 此刻文件已落盘但**尚未生效**：必须由主 agent/用户择机重启
npx @deepseek-ai/dsh web                                   # 重启（会中断当前会话连接）

# 3) 验收（仅 1 次只读 HTTP；需在重启之后）
node probes/session-list-shape.mjs --out evidence/probe-post-patch.json
#    期望：A1 条目 ≤ 顶层+200 / A2 字节 ≤ 500KB / A3a A3b PASS / A6 PASS / A7 PASS

# 4) 如需回滚（脚本带所有权校验，只认 backup/B1/ 下的本单元完整快照）
bash patches/workspace-ui-runsubagent-count.sh --rollback  # 之后刷新浏览器
bash patches/server-session-filter.sh --rollback           # 之后再次重启 DSH
```

**顺序建议与理由**：先 apply 客户端（热面、无副作用、可独立回滚，且服务端字段缺失时自动回落原行为），
再 apply 服务端并重启。这样**服务端回滚后客户端仍保持今天的行为**，两者不会互相牵制；
反之若先重启服务端，客户端回落分支同样安全（聚合字段会被忽略），故顺序不是硬要求，只是更稳。

---

## 6. 「重启后」验收清单

| # | 验收项 | 怎么做 | 期望 |
|---|---|---|---|
| R1 | `session.list` 形状 | `node probes/session-list-shape.mjs` | A1 条目 ≤ 顶层+200；A2 ≤ 500 KB；A6 全部顶层行带 `runningSubagentCount` |
| R2 | 顶层会话一条不少 | 同上 A3a/A3b | 基线顶层 ID 全在；多出的仅为重启后新建会话 |
| R3 | **侧边栏「N 个子代理运行中」状态点（人工）** | ① 打开 GUI 侧边栏，记下当前**未**显示状态点的顶层会话；② 派一个长时间 subagent（例如让当前会话起一个调研子代理）；③ 观察该顶层会话行右侧是否出现「N 个子代理运行中」状态点 | 出现状态点且 N ≥ 1（这是本单元 A4，**必须人工核验**；沙箱内无法验证实机渲染） |
| R4 | 反向核验（证明数据来自宿主聚合而非就地聚合） | DevTools Console：`(await (await fetch('/api/session.list',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:crypto.randomUUID(),method:'session.list',payload:{}})} )).json()).result.value.items.filter(r=>r.runningSubagentCount>0)` | 返回的行数 > 0；且同一行的 `runningSubagentCount` 与侧边栏文案数字一致 |
| R5 | 子代理抽屉（A5） | 展开任一顶层会话的子代理目录 | 条目数/标签/运行态与打补丁前一致（走独立 `subagents.list`） |
| R6 | 打开子代理转录（A6） | 点开一个子代理会话 | 轨迹正常渲染；token/usage 概览正常 |
| R7 | 搜索语义回归（A10） | 搜一个只存在于**很老** subagent 转录里的词 + 搜一个近期词 | 近期词仍命中（窗口内 200 条保留）；很老 subagent 的命中可能消失（**预期行为**，见 §7） |
| R8 | 第三方远程徽标（A9） | 观察远程工作区行 | 徽标不减少 |
| R9 | 回滚演练 | `--rollback`（客户端）+ 刷新浏览器 | 状态点回到「就地聚合」行为；服务端未回滚时不影响其它功能 |

---

## 7. `sessions.search` 同源白名单：**本次不改**（附最小一致性改动备选）

**事实**：`listVisibleSessionSummaries()` 同时是 `sessions.search` 的可见性白名单（`api-proxy.js:1678` 调用、`:1690` 用它过滤 provider 命中）。方案 B 下这个白名单从「2,386 条」变为「顶层 + 200 条 subagent」。

**判断：不需要改。**理由（均为可核实的结构性事实）：

1. **顶层会话一条不少** → 所有「正常对话」的搜索可见性**完全不变**；这也正是方案 B 相对方案 A 的核心优势。
2. 被移出白名单的只有 `updatedAt` 最老的 201 条 subagent 行（2301 − 200），占可见集 **8.4%**，且是按**新近度**裁掉的。
3. **成本上升有硬上界且余量充足**：搜索循环是 `while (authorized.length <= 20)`，在最坏情况（只能靠 subagent 命中凑满 20 条）下，可见集缩小 8.4% 意味着期望多翻约 `20 × (1/(1−0.084) − 1) ≈ 2` 次 provider 调用；硬上限是 `SESSION_SEARCH_PROVIDER_CALL_LIMIT = 100`（`api-proxy.js:43`）。**风险面并未因此实质扩大。**
4. 语义上更像「修正」：审计 §3 已判定 subagent 转录被内容搜索命中属「侧边栏本来就不显示」的隐蔽结果。

**若主 agent 后续仍想消除这 8.4% 的差异**，最小一致性改动是**唯一一处**：把 `:1678` 的 `listVisibleSessionSummaries(signal)` 换成「顶层 + 全部 subagent 行」的搜索专用白名单（即新增一个 `listSearchVisibleSessionSummaries()`，只复用 `summarize`/`summarizeCold` 而不做截断）——代价是把冷会话的投影/冷读成本加回搜索路径，**收益极小**。**本档不做此改动**（用户裁决第 3 条：不扩大改动面）。

---

## 8. 明确标注：无法在沙箱内验证的事项（不假装通过）

| # | 事项 | 为什么验不了 | 谁来验 / 怎么验 |
|---|---|---|---|
| U1 | **侧边栏状态点的实机表现（A4）** | 需要跑一个真实 subagent 并看浏览器渲染；本档不能重启宿主、不能改 live 文件、无浏览器自动化授权 | 主 agent 按 §6 R3/R4 人工核验 |
| U2 | 打补丁后**真实** `session.list` 的条目/字节/TTFB | 同上（补丁未应用到 live）。本档用「真实 payload + 同一逻辑」的模拟复核替代 | 重启后跑 `probes/session-list-shape.mjs`（§5 第 3 步） |
| U3 | `runningSubagentCount` 的服务端耗时 | 需在 live 宿主内计时；本档只做复杂度分析（1 次行遍历 + 1 次 live agent 查表，无新增投影/读盘） | 重启后在 `host.describe`/日志侧观察会话列表耗时；或对比 R1 探针的 `elapsed`（本轮 657 ms） |
| U4 | C2/C3/C4/C5 降级的可见程度（审计 §7 未证实项 1、2） | 需要真实多代理 workflow / 跨链导航实测 | 保持原状；如用户观察到具体反例，再按 §2 B1-C2…C5 表定点处理 |
| U5 | `--apply` 本身的真实执行 | 目标在 `/home/CNS2026495165/.dsh/`（工作区外），本档按硬约束不写入、不提权 | 主 agent（或具备写权限方）执行 §5 的 `--apply` |
| U6 | 客户端 bundle 热替换后的浏览器表现 | 需刷新浏览器并观察 | 刷新后按 §6 R3 |

---

## 9. 附：证据文件索引与复核命令

| 证据 | 文件 |
|---|---|
| 服务端 dry-run 全文（含 8 hunk diff） | `evidence/dryrun-server-filter.txt` |
| 客户端 dry-run 全文（含 3 hunk diff） | `evidence/dryrun-client.txt` |
| 服务端语义自测（14 项） | `evidence/semantic-server.txt` |
| 客户端语义自测（19 项） | `evidence/semantic-client.txt` |
| 真实 payload（打补丁前，1 次 HTTP 抓取） | `evidence/probe-pre-patch.json`（3,924,952 B） |
| 打补丁前探针结论（4 项 FAIL，A3 已 PASS） | `evidence/probe-pre-patch-run.txt` |
| 模拟打补丁后响应 | `evidence/probe-simulated-post-patch.json` |
| 打补丁后探针结论（全 PASS） | `evidence/probe-post-sim-run.txt` |
| 模拟脚本输出 | `evidence/simulate.txt` |
| 打补丁后的完整副本（服务端两份排版） | `tmp/B1/dryrun-<stamp>/b1-index.patched.js`、`b1-api-proxy.patched.js` |
| 打补丁后的完整副本（客户端两份） | `tmp/B1/dryrun-client-<stamp>/b1-ui-workspace.patched.js`、`b1-client-runtime.patched.js` |
| 本单元备份（`--apply` 时创建） | `backup/B1/<时间戳>/lib/index.js`、`lib/types/api-proxy.js` 或 `dsh-client-*/lib/client.js` |

> 说明：`tmp/B1/` 由 `--dry-run` 创建；`backup/B1/` **只在 `--apply` 时创建**（本档未 apply，故当前不存在，属预期）。

一条命令重跑全部证据：

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix
bash patches/server-session-filter.sh --dry-run                 > evidence/dryrun-server-filter.txt 2>&1
bash patches/workspace-ui-runsubagent-count.sh --dry-run        > evidence/dryrun-client.txt 2>&1
node patches/B1-semantic-test.cjs                                 > evidence/semantic-server.txt 2>&1
node patches/B1-client-semantic-test.cjs                          > evidence/semantic-client.txt 2>&1
node patches/B1-simulate-post-patch.cjs                           > evidence/simulate.txt 2>&1
node probes/session-list-shape.mjs --from-file evidence/probe-pre-patch.json              > evidence/probe-pre-patch-run.txt 2>&1
node probes/session-list-shape.mjs --from-file evidence/probe-simulated-post-patch.json   > evidence/probe-post-sim-run.txt 2>&1
```

> 纪律申报：本轮 HTTP 探针 **1 次**（`POST /api/session.list`，只读、串行、≤5 次上限内）；0 次重启/停止宿主；0 次压测；未写 `/home/CNS2026495165/.dsh/` 与任何工作区外路径；未使用 `sandbox_permissions`。
> `lag-fix/` 下另有其它档位（C1/C2 等）产出的文件，**非本档产物**，本档未改动它们，完整清点如下（便于主 agent 区分）：
> `patches/usage-plugin.sh`、`patches/usage-plugin.replacements.txt`、`patches/workspace-enhancement-perf.sh`、`patches/baseline.sha256`（C2 基线）、`patches/unit-C1-fixer.mjs`、`patches/unit-C1-clientspec.mjs`、`probes/bench-projectlist-C1.mjs`、`probes/equivalence-C1.mjs`、`probes/extract-C1.mjs`、`probes/smoke-client-bundle.mjs`、`probes/usage-host-latency.mjs`、`probes/verify-daily-equivalence.mjs`、`probes/run-verification.sh`、`evidence/unit-C1.diff`。
> **本档产物（全部 `B1-` 前缀或单元名，独占命名）**：
> `patches/server-session-filter.sh`、`patches/workspace-ui-runsubagent-count.sh`、`patches/B1-transform.cjs`、`patches/B1-transform-client.cjs`、`patches/B1-semantic-test.cjs`、`patches/B1-client-semantic-test.cjs`、`patches/B1-simulate-post-patch.cjs`、`probes/session-list-shape.mjs`、`reports/unit-B1.md`、`evidence/dryrun-*.txt`、`evidence/semantic-*.txt`、`evidence/simulate.txt`、`evidence/probe-pre-patch.json`、`evidence/probe-simulated-post-patch.json`、`evidence/probe-pre-patch-run.txt`、`evidence/probe-post-sim-run.txt`；工作区/备份独占目录 `tmp/B1/`、`backup/B1/`。
