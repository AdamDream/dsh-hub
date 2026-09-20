# borrow-015-groupB-exec.md — 0.1.5 借鉴组 B（subagent 族）修订执行复核一体报告

- 档位：修订执行复核一体（route adam/deepseek-v4-flash）
- 日期：2026-09-15
- 上游背景：组 B 原档耗尽上下文；`.workspace/deploy-015/<pkg>/` 应用后副本已在，patch 疑似缺失/为空。经核验：**4 个 patch 均已在位且完整**（15:53 生成，内容 = GLOB→副本真实差异），本档对其做完整复核并补齐 sha256 锚点与报告。
- 约束遵守：只写 `.workspace/deploy-015/` 与报告；未改动 `~/.dsh`（部署由主代理执行）；未使用 sandbox_permissions。

## 0. 结论摘要（自裁决：通过）

| 项 | 结果 |
|---|---|
| 4 个 patch（GLOB→副本真实差异） | ✅ 均在位、完整、无缺失无空文件 |
| patch 可应用性 | ✅ 4 包 `patch -p1 --dry-run` 全过；实打后与副本**逐字节一致** |
| 副本语法 | ✅ 全部副本 `.js` 文件 `node --check` 通过（fail=0） |
| 锚点 S4/S5/S18-S22 | ✅ 逐项在副本中（含 reasoningEffort×7 锚点） |
| materialize 区零触碰 | ✅ patch 中 0 行 materializeContinuableChild；GLOB vs 副本函数体 2046B 逐字节一致 |
| 与既有补丁无冲突 | ✅ 无其它 patch 触碰这 4 包任何文件 |
| known-sha256-015.txt | ✅ 追加组 B 节（13 文件应用后 sha256） |

## 1. 逐项目标包 / diff 路径 / 锚点 / 状态

GLOB 基线 = `~/.dsh/profiles/node_modules/@deepseek-ai/<pkg>/`（版本 0.1.1-rc.2；**dsh-subagent 全局已含 materialize 补丁**，已确认）。diff = GLOB→副本完整递归差异（非仅 lib）。

| # | 包 | patch 路径（相对 `.workspace/deploy-015/patches/`） | 差异文件 | 锚点 | 状态 |
|---|---|---|---|---|---|
| 1 | dsh-subagent | `dsh-subagent.groupB.patch`（433 行） | lib/index.js + lib/types/{child-agent.d.ts, child-agent.js, continuation.js, index.d.ts, index.js, out-of-process.js, run-settlement.js}（8 文件） | S4、S5、S18、S19 | ✅ |
| 2 | dsh-subagent-fork-in-process | `dsh-subagent-fork-in-process.groupB.patch`（11 行） | lib/index.js | S20（capabilities.agentOptions: true） | ✅ |
| 3 | dsh-subagent-spawn-in-process | `dsh-subagent-spawn-in-process.groupB.patch`（11 行） | lib/index.js | S20（capabilities.agentOptions: true） | ✅ |
| 4 | dsh-tool-subagent | `dsh-tool-subagent.groupB.patch`（758 行） | lib/index.js + lib/types/index.d.ts + package.json（新增 zod ^4.4.3） | S21（模型选择；依赖 S20 旗标） | ✅ |

## 2. 逐项锚点核验（副本为证；patch 实打逐字节一致故同为证）

- **S4（child-agent effort 泄漏修复）**：副本 `dsh-subagent/lib/types/child-agent.js` 中 `reasoningEffort` **×7**（原档锚点吻合）；`dsh-subagent/lib/index.js:500` 定义 `parentAgentOptionsForDelegation`（读取 `parent.session.requestHeader()?.config`，请求头拥有 provider/model/reasoningEffort，创建期 options 兜底并保留 maxTokens），`:523` 供 `resolveChildAgentOptions` 使用；route 变更且未显式指定 effort 时 `delete resolved.reasoningEffort`；`:2816` 导出。类型/声明同步（child-agent.d.ts、index.d.ts/index.js export 行）。
- **S5（run-settlement aborted 诊断）**：副本 `dsh-subagent/lib/types/run-settlement.js:35-37`：`case 'aborted': result.diagnostic === undefined ? {status:'killed'} : {status:'failed', detail: failureDetail(result)}`；`lib/index.js:2428` 同逻辑（`settleRunResult`）。
- **S18（out-of-process diagnostic 上限）**：副本 `dsh-subagent/lib/index.js:2238/2246`（`limitSubagentDiagnostic`/`normalizeSubagentDiagnostic`，`:2353` 接入 out-of-process 结果路径）；`lib/types/out-of-process.js:25/38/166` 同步。
- **S19（continuation 快照前置）**：副本 `dsh-subagent/lib/types/continuation.js:162-164`：先 `resolveChildAgentOptions(parent, request.agentOptions, childDepth)` 再快照（`// Snapshot before any await` 注释保留），同一 `agentOptions` 传入 create()。
- **S20（fork/spawn agentOptions 旗标）**：副本 `dsh-subagent-fork-in-process/lib/index.js:37`、`dsh-subagent-spawn-in-process/lib/index.js:24`：`capabilities = { agentOptions: true, ... }`。
- **S21（tool-subagent 模型选择）**：副本 `dsh-tool-subagent/lib/index.js`：`parentAgentOptionsForDelegation` 导入（:4）与使用（:495）；`modelSelectionSettings` 配置（:256）；`modelRouteKey`/`assertAllowedModelRoutes`/`requestedAgentOptions`/`assertAllowedModelSelection`/`preflightChildLlmRoute`（:16-132）；`list_subagent_models` 工具（:173）；Session 级 policy 投影 `subagentModelSelectionPolicy` 与 `recordSubagentModelSelection`（:234-260 区）；`package.json:46` 新增 zod。

## 3. 自复核

1. **逐项锚点表**：S4/S5/S18-S22 全部在副本中命中，位置如上表（详见第 2 节）。✅
2. **S21←S20 顺序**：`assertSubagentProviderConfiguration`（副本 `dsh-tool-subagent/lib/index.js:379-380`）在组合加载时检查 `subagentProvider.capabilities.agentOptions`——`modelSelectionSettings` 开启时若无该旗标直接抛错。因此 **fork/spawn 的 S20 旗标必须先于 tool-subagent 组合加载**（初始 `getProvider` 与 `subagent/provider-added` 两条路径都校验）。另 tool-subagent 还依赖 dsh-subagent 导出 `parentAgentOptionsForDelegation`（S4），故部署顺序：**dsh-subagent → fork → spawn → tool-subagent**。✅
3. **materialize 区零触碰**：4 个 patch 中 `materializeContinuableChild` **0 行**（grep 全空）；GLOB vs 副本该函数体 2046B 逐字节一致（各 3 处出现）。✅
4. **与既有补丁无冲突**：`grep -l "dsh-subagent|dsh-tool-subagent" patches/*.patch` 仅命中 4 个 groupB 补丁本身；deploy-015/patches 内无任何其它补丁触碰这 4 包文件。✅ 对"既有 5 补丁"（replay-lag-fix.sh 管理：dsh-agent-loop / dsh-client-ui-subagent / dsh-web-search-deepseek / dsh-host-apiproxy + dsh-subagent 官方 materialize P0 补丁）的专项核验见 §6.3：groupB 的 dsh-subagent patch 建立在 materialize 之上，hunk 零重叠、可干净叠加。
5. **可应用性实测**：`/tmp/exec015-v/` 以 GLOB 重建 4 包，`patch -p1 --dry-run` 全过；实打后 `diff -rq` 与 `.workspace/deploy-015/<pkg>/` **逐字节一致（4 包全 ✓）**。✅
6. **副本语法**：全部副本 `.js`（含 lib/types/*.js）`node --check` 通过。✅
7. **sha256 锚点**：已追加至 `known-sha256-015.txt` 组 B 节（13 文件，见该文件）。✅

## 4. 问题清单（观察项，非缺陷；主代理裁决）

1. **dsh-subagent.groupB.patch 超出六锚点范围**：除 S4/S5/S18/S19 外还含 **image 模态守卫**（`contentHasImage` 导入、`assertImageCapable`、`MODEL_DOES_NOT_SUPPORT_IMAGES`，提交于 admitted/materialized 路径，index.js 与 types/continuation.js 双份）。这是副本与 GLOB 的**真实差异**，按"差异即 patch"原则保留；判断其与 image-tokens 借鉴项（dsh-llm-deepseek.image-tokens.patch 等）是否配套，由主代理裁决，本档不做设计决策。
2. **dsh-tool-subagent 新增运行时依赖 zod ^4.4.3**（package.json）：部署环境需安装 zod（`npm i zod` 或由部署脚本处理），否则工具加载失败。
3. **apply 签名扩展**：`apply(ctx, config)` → `apply(ctx, config, session?)`（session 可选，向后兼容）；`inject` 增加 `sessionProjections`——组合依赖方若注入列表固定需注意。
4. 遗留目录 `/tmp/patchgen-b`、`/tmp/patchverify` 为先前流程残留；`patchverify` 内容与 deploy-015 副本一致，佐证补丁历史一致性。本档自用 `/tmp/exec015-v`、`/tmp/exec015-final`、`/tmp/exec015-base`、`/tmp/exec015-v` 可一并清理（均非本档交付物）。live 树 `*.rej` 残留清理见 §6.2。
5. patch 头时间戳为生成时点（15:52:52），不影响 `patch -p1` 应用。

## 5. 集成要点（给主代理部署）

1. **顺序**：dsh-subagent → dsh-subagent-fork-in-process → dsh-subagent-spawn-in-process → dsh-tool-subagent（S21←S20 能力旗标 + S4 导出依赖；tool-subagent 加载时即校验）。
2. **应用方式**：每包目录内 `patch -p1 < .workspace/deploy-015/patches/<pkg>.groupB.patch`（已验证可应用且结果与副本逐字节一致）。
3. **基线注意**：dsh-subagent 基线 = 0.1.1 + 既有 materialize 补丁（全局已含）；groupB patch 不含 materialize，直接应用于该基线即可，勿重复叠加。**顺序硬约束**：materialize 必须先于 groupB dsh-subagent patch 存在（replay-lag-fix.sh 的 materialize 单元有锚点/字节幂等跳过，先跑它再跑 groupB 即满足）。
4. **依赖**：dsh-tool-subagent 需安装 `zod@^4.4.3`。
5. **验收锚点**：应用后各文件 sha256 对照 `known-sha256-015.txt` 组 B 节（13 行）。

## 6. 补充核验（GLOB 独立重放）与并发部署观察

### 6.1 GLOB 独立重放（不依赖任何 live 树）
以 pristine 源重建基线并完整重放，全部逐字节一致：
- dsh-subagent：`.workspace/baseline-011/x/dsh-subagent`（0.1.1 原样）+ `.workspace/deploy-p0/dsh-subagent.materialize.patch`（干净应用，触碰 lib/index.js + lib/types/index.d.ts）+ `dsh-subagent.groupB.patch` → 与 deploy-015 副本 **BYTE-IDENTICAL ✓**
- fork / spawn / tool-subagent：`.workspace/baseline-011/x/<pkg>` 原样 + 各自 groupB patch → 与副本 **BYTE-IDENTICAL ✓**（3 包全过）

### 6.2 并发部署观察（重要，主代理知悉）
本档核验期间（~16:05）主代理的部署动作已并发发生：
- 两个 live 树（`~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/<pkg>/` 与 `~/.dsh/profiles/node_modules/@deepseek-ai/<pkg>/`，二者内容恒一致）的 dsh-subagent / fork / spawn / tool-subagent 已变为 groupB 应用后状态，sha256 与组 B 节**逐一吻合**（如 dsh-subagent/lib/index.js = 36650446…）。
- 两树各包根目录出现 `*.rej` 残留（mtime 16:08，13 个），来源为部署方对已应用内容的二次 patch 触发 "Reversed (or previously applied) patch detected" 落盘；**与本档无关**（本档全部写操作为 /tmp 与 `.workspace/deploy-015/`，已用 /tmp/exec015-final 内的 .rej 产物佐证）。建议部署方清理 live 树 `*.rej`（`find <pkg> -name '*.rej' -delete`），不影响功能但属脏数据。

### 6.3 与既有 5 补丁（replay-lag-fix.sh 管理面）的冲突专项核验
- 5 既有补丁 = dsh-agent-loop / dsh-client-ui-subagent / dsh-web-search-deepseek / dsh-host-apiproxy + **dsh-subagent 官方 materialize（P0）**。
- groupB 仅与其中 dsh-subagent 同包。核验：materialize 补丁触碰 lib/index.js + lib/types/index.d.ts；groupB 同触这两文件但 hunk 区不重叠——先 materialize 后 groupB 干净应用（§6.1 重放即证），materializeContinuableChild 函数体 GLOB 原样（2046B 逐字节同）。**结论：零冲突，仅需顺序（materialize 先行）。**
