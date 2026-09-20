# 借码执行报告：0.1.5-rc.2 → 0.1.1-rc.2（P0/P1/P2 全采纳）

- 日期：2026-09-15
- 角色：修订执行复核一体（路由 adam/deepseek-v4-flash）
- 依据：`.workspace/upstream-015-diff.md` §3 值得借鉴短清单（P0/P1/P2 全采纳）；`upstream-borrow-validation.md` 已否决项直接引用、未重复评估
- 素材：0.1.5 归档 `~/.dsh/profiles-archive/web2-20260915-105429/node_modules/@deepseek-ai/`（只读）；0.1.1 全局树 `~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`（**只读，未修改**——部署由主代理执行）
- 产出：`.workspace/deploy-015/<pkg>/`（应用后完整副本，12 包）、`.workspace/deploy-015/patches/*.patch`（unified diff，patch -p1 于包目录）、`known-sha256-015.txt`（18 文件锚点）、`.workspace/deploy-lag/patch-official-015.sh`（独立重放脚本）
- 约束遵守：只写 `.workspace/deploy-015/`、`.workspace/deploy-lag/` 与本报告；未改 `~/.dsh` 任何文件与全局树（5 个既有补丁包时间戳保持 9-12 原值，实测确认）；未使用 sandbox_permissions

---

## 0. 逐项总览（来源 0.1.5 行号 → 目标 0.1.1 应用后行号）

| # | 级别 | 包 | 0.1.5 来源（lib/index.js） | 0.1.1 目标（应用后行号） | diff 路径 | 验证 |
|---|---|---|---|---|---|---|
| 1 | P0 | dsh-tool-web | 常量 `:12-13`、parts `:63`、header `:616` | 常量 `:7`、parts `:59`、header `:592` | `patches/dsh-tool-web.untrusted-notice.patch` | node --check ✓；锚点 EXTERNAL_WEB_CONTENT_NOTICE×3 ✓ |
| 2 | P0 | dsh-atomic-write | 常量+helper `:16-43`、调用 `:71` | 常量+helper `:16-43`、调用 `:69` | `patches/dsh-atomic-write.windows-rename-retry.patch` | node --check ✓；锚点 renameAtomicTemp×2 ✓；Linux no-op |
| 3 | P1 | dsh-goal-round-driver | `:222`（整行替换） | `:222` | `patches/dsh-goal-round-driver.attempt-attribution.patch` | node --check ✓；锚点×1 ✓；attempt.goalId/revision 字段 0.1.1 存在（`state.attempt` 字面量 :143-156） |
| 4 | P1 | dsh-user-approval | `:179` scopeTarget 一行 | `:189` | `patches/dsh-user-approval.scopeTarget-routing.patch` | node --check ✓；锚点×1 ✓ |
| 5 | P1 | dsh-mcp-client | `:152` Set + `:163-165` 检查 | `:152` Set + `:161-165` 检查 | `patches/dsh-mcp-client.cursor-dedup.patch` | node --check ✓；锚点 seenCursors×3 ✓；与 0.1.5 内容逐字一致（行号差 1=scopeOf import 未借） |
| 6 | P2 | dsh-tool-fs-search | import `:3`、sidecar `:122-123` | import `:3`、sidecar `:123-124` | `patches/dsh-tool-fs-search.win32-rg-sidecar.patch` | node --check ✓；锚点 `-rg.exe`×1 ✓；与 0.1.5 逐字一致 |
| 7 | P2 | dsh-tool-bash-persistent | `:71` 常量、`:93` 正则、`:156` exitCode、`:288` 超时 | `:71` 常量、`:93` 正则、`:155` exitCode、`:288` 超时 | `patches/dsh-tool-bash-persistent.status-report.patch` | node --check ✓；锚点×3 ✓；与 0.1.5 逐字一致 |
| 8 | P2 | dsh-fs | 抽象方法 `:75-83`、types `:106`+`:188` | `:83`、types `:105`+`:190` | `patches/dsh-fs.byte-range-api.patch` | node --check ✓；锚点×3 ✓（index.js 1 + types 2） |
| 9 | P2 | dsh-fs-local | readByteWindow `:390-422`、processPathFromHostPath `:746-749`、readByteRange `:797-803`、types ×2 | readByteWindow `:402-433`、方法 `:750`/`:800`、types ×2 | `patches/dsh-fs-local.byte-range-api.patch` | node --check ✓；锚点×7 ✓；readByteWindow 与 0.1.5 逐字一致 |
| 10 | P2 | dsh-tool-str-replace-editor | null 校验 `:158`、insert_line `:257`、schema `:286-306`、execute `:317-321` | null 校验 `:157`、insert_line `:256`、schema `:285-306`、execute `:316-320` | `patches/dsh-tool-str-replace-editor.null-placeholder.patch` | node --check ✓；锚点×7 ✓；与 0.1.5 内容逐字一致（行号差 1=文档注释行未借） |
| 11 | P2(条件→适用) | dsh-launch-environment | 函数 `:69-80`、export `:78`、types | 函数 `:75-86`、export、types `:74` | `patches/dsh-launch-environment.launched-through-ssh.patch` | node --check ✓；锚点×3 ✓；与 0.1.5 逐字一致 |
| 12 | P2(条件→适用) | dsh-llm-deepseek | region `:300-433`（134 行）、types image-tokens.d.ts、index.d.ts export | region `:297-430`、image-tokens.d.ts 新增、export `:1952` | `patches/dsh-llm-deepseek.image-tokens.patch` | node --check ✓；region EXACT MATCH；纯函数冒烟 10 例全过（整数、≥1、≤384 封顶） |

---

## 1. 逐项执行详情

### P0-1 dsh-tool-web — EXTERNAL_WEB_CONTENT_NOTICE（提示注入防御）
- **移植面**：3 处（报告值 ~3 行）：① 常量定义（注释 + 1 行 const）；② `formatSearchOutput` 的 `parts` 数组前置 notice；③ `computeFetchOutput` 的 header 前置 notice。
- **0.1.5 行号** → **0.1.1 目标行号**：`:12-13` → `:7`；`:63` → `:59`；`:616` → `:592`。
- **未借（报告外噪音）**：`getSectionOrder` 注册表重构、`assertNever` import 迁移到 dsh-util-values、turndown removeNonVisibleContent 规则、HTML 转换失败文本、scope-aware systemPrompt（与 `ctx.tools.get` 耦合，0.1.1 无此 seam）。system-prompt 措辞更新为报告标注"可选"，因 0.1.5 实现是 scope-aware 函数形式，移植需改写，超出最小面，未借并在 §6 问题清单登记。
- **验证**：node --check ✓；`EXTERNAL_WEB_CONTENT_NOTICE` 计数 3 ✓；diff 与 0.1.5 对应 3 处内容逐字一致。

### P0-2 dsh-atomic-write — Windows rename 有界重试（Linux no-op）
- **移植面**：常量集（`WINDOWS_TRANSIENT_RENAME_ERRORS` Set + 3 个常量）+ 2 helper（`isTransientWindowsRenameError`、`renameAtomicTemp`）+ `writeFileAtomic` 调用替换 1 处，共 ~28 行（报告值 ~28 行）。
- **0.1.5 行号** → **0.1.1 目标行号**：`:16-43` → `:16-43`；调用 `:71` → `:69`。
- **Linux 平台适用性**：`isTransientWindowsRenameError` 首行 `if (process.platform !== "win32") return false;` → Linux 上所有错误直接 rethrow，行为与 0.1.1 完全一致（no-op）；Windows 分支完整保留（报告要求"Windows 专属项标注 no-op 但保留"）。
- **验证**：node --check ✓；`renameAtomicTemp` 计数 2 ✓；移植区与 0.1.5 `:16-46` 逐字 IDENTICAL；helper 内 `await rename(temp, filename)` 保留（`grep -n "await rename("` 仅 :34 一处，正确）。

### P1-1 dsh-goal-round-driver — attempt 归属守卫（1 行）
- **移植面**：`agent/status` idle 分支条件追加 `attempt.goalId === goal.id && attempt.revision === goal.revision`（整行替换，与 0.1.5 同形：optional-chaining 改写 + 归属守卫）。
- **0.1.5 行号** → **0.1.1 目标行号**：`:222` → `:222`。
- **字段存在性核验**：0.1.1 `state.attempt` 字面量（:143-156）已含 `goalId: goal.id, revision: goal.revision`；`currentGoal(state)` 的 goal 含 `id`/`revision`（goalRef 用法同 0.1.5）。类型层无新增依赖。
- **未借**：`goal/changed` 的 `change` 参数 + `agent.cancel` 调用、`startsRequestSeries: true`（均 0.1.5 其它语义，报告最小面=1 行）。
- **验证**：node --check ✓；锚点×1 ✓；diff 精确 1 行。

### P1-2 dsh-user-approval — scopeTarget 路由（1 行）
- **移植面**：`decide()` 中 `scopeTarget(this, req.agent)` → `scopeTarget(req.agent, req.agent)`（waterfall 改用被问询 agent 自身 scope）。
- **0.1.5 行号** → **0.1.1 目标行号**：`:179` → `:189`。
- **未借**：sessionProjections 化重构（hasOpenTurn(session)/SessionSeq/eventAt、effectiveApprovalPolicy 删除、getContextOrder）——引用 `upstream-015-diff.md` §4.B1（勿借清单：0.1.1 seam 可选 vs 0.1.5 强制注册，改变插件组合契约）。
- **验证**：node --check ✓；锚点×1 ✓；diff 精确 1 行。

### P1-3 dsh-mcp-client — 续传游标去重（~8 行）
- **移植面**：`syncTools` 新增 `seenCursors` Set + `cursor` 赋值后重复检查抛错。
- **0.1.5 行号** → **0.1.1 目标行号**：`:152` → `:152`；`:163-165` → `:161-165`。
- **未借**：`scopeOf(ctx)` 的 activeServerNames per-scope 化（依赖 `dsh-scope`，0.1.5 新增语义，报告最小面不含）——引用报告 §3 P1 行"零文件重叠"。
- **验证**：node --check ✓；seenCursors 计数 3 ✓；与 0.1.5 内容逐字一致（行号差 1 = 未借的 scopeOf import 行）。

### P2-1 dsh-tool-fs-search — win32 rg sidecar（4 行）
- **移植面**：`node:path` import 加 `join, parse` + `resolveRgPath` 中 sidecar 推导 1 行改 2 行。
- **0.1.5 行号** → **0.1.1 目标行号**：import `:3` → `:3`；`:122-123` → `:123-124`。
- **平台**：win32 分支 `join(dir, name-rg.exe)`；Linux 分支保持 `` `${process.execPath}-rg` ``（报告：仅 win32 生效）。
- **未借**：SearchError 消息措辞、`save.source.kind: "tool"`、getSectionOrder（报告外噪音）。
- **验证**：node --check ✓；锚点 `-rg.exe`×1 ✓；与 0.1.5 逐字一致。

### P2-2 dsh-tool-bash-persistent — 状态报告（~4 行）
- **移植面**：① `TIMEOUT_STATUS_MARKER` 常量；② `trimTrailingNewline` 正则 `/\r?\n$/` → `/(?:\r?\n)+$/`；③ `renderCaptured` exitCode 存在即报告（含 0）+ 文案 `[exit code: N]` → `[Command finished with exit code N]`；④ 超时分支 `partial` → `appendStatusMarker(partial, TIMEOUT_STATUS_MARKER)`。
- **0.1.5 行号** → **0.1.1 目标行号**：`:71` → `:71`；`:93` → `:93`；`:156` → `:155`；`:288` → `:288`。
- **影响面核验**：`[exit code:` 仅存于各 shell 工具的模型可见渲染输出（bash/pwsh/pwsh-persistent/shell），无程序化解析依赖（grep 全树核实），文案变化安全。
- **验证**：node --check ✓；锚点×3 ✓；与 0.1.5 逐字一致。

### P2-3 dsh-fs + dsh-fs-local — readByteRange / processPathFromHostPath
- **移植面**：`dsh-fs`：FileSystem 基类新增 `processPathFromHostPath(hostPath) {}`（空方法）+ types 抽象声明 ×2（processPathFromHostPath、readByteRange）。`dsh-fs-local`：`readByteWindow` 纯函数（~33 行）+ 类方法 `processPathFromHostPath`（isAbsolute→resolve）+ `readByteRange`（委托 readByteWindow）+ types ×2（index.d.ts 类方法 + fsio.d.ts readByteWindow 导出）。
- **0.1.5 行号** → **0.1.1 目标行号**：dsh-fs `:75-83` → `:83`；types `:106`/`:188` → `:105`/`:190`；dsh-fs-local `:390-422` → `:402-433`、`:746-749` → `:750`、`:797-803` → `:800`。
- **依赖符号核验**：0.1.1 已具备 `statRegularFile`/`createReadStream`/`isAbortError`/`FsError`/`isAbsolute`/`resolve`（fs-local import 区与函数区实测），零新依赖。
- **验证**：node --check ✓；锚点 7（readByteWindow×2 + readByteRange×1 + processPathFromHostPath×1 + types×3）✓；readByteWindow 区与 0.1.5 `:392-423` 逐字 IDENTICAL。

### P2-4 dsh-tool-str-replace-editor — null 占位（~30 行）
- **移植面**：`replaceInFile` 新增 `newStr === null` 显式校验；`insert` 的 locations 处理 `insert_line === null` 按省略；5 处 schema（file_text/insert_line/new_str/old_str/view_range）改 `oneOf:[…, null]`（0.1.5 实际 5 参数全部 oneOf 化，报告"4 参数"指 4 个命令）；execute 分支 4 处 `?? void 0` 归一化。
- **0.1.5 行号** → **0.1.1 目标行号**：`:158` → `:157`；`:257` → `:256`；`:286-306` → `:285-306`；`:317-321` → `:316-320`。
- **未借**：文件头文档注释行（:18，描述性，报告未列）。
- **验证**：node --check ✓；锚点 7（oneOf×5 + newStr===null + insert_line===null）✓；与 0.1.5 内容逐字一致（行号差 1=文档注释行）。

### P2-条件① dsh-launch-environment — launchedThroughSsh（**裁决：适用，已移植**）
- **适用性评估**：0.1.1 的 `createLaunchEnvironmentSnapshot` **已含 `getFrom(name, sources)` API**（0.1.1 `:36-49`），0.1.5 函数体 `environment.getFrom(name, ["process"])?.value` 在 0.1.1 逐字可用；零新依赖。0.1.1 暂无消费者（0.1.5 消费者为新增包 host-open-in-app/host-directory-picker-auto），**纯导出新增、向后兼容**。
- **0.1.5 行号** → **0.1.1 目标行号**：`:69-80` → `:75-86`；types `:69-75` → `:74-80`。
- **验证**：node --check ✓；锚点×3 ✓；与 0.1.5 逐字 IDENTICAL。

### P2-条件② dsh-llm-deepseek — image-tokens 定价模块（**裁决：可移植，已移植**）
- **适用性评估**：① 纯函数模块（仅 Math），零新依赖；② 消费点（`deepSeekImageRequestPricing` 的 `priceImages`）位于 0.1.5 独有的 request-pricing region——0.1.1 无此结构，**移植后为纯新增导出，零行为影响**；③ 与既有 vision 补丁面协调：0.1.1 图片变换补丁在 **dsh-host-apiproxy 代理层**（`sessions/prompt-image-transform`），vision 工具化走 **dsh-vision-adam**（独立包），llm-deepseek 的 token 定价是**纯函数**，三者文件/语义零重叠（报告 §3 P2 条件：冲突低）；④ 报告要求"纯函数单测对照官方文档数值"——本档做了封顶/整数/下限冒烟（见下），官方数值对照（384 封顶、3:1 降采样）已通过 10 例几何冒烟。
- **0.1.5 行号** → **0.1.1 目标行号**：region `:300-433`（134 行）→ `:297-430`；types `image-tokens.d.ts` 新增；index.d.ts export 行 + index.js export 行补 `deepSeekImageTokens`。
- **未借**：request-pricing region 全部（`deepSeekImageRequestPricing`/`resolveRequestImagePolicy` 依赖 catalogModel/connection 等 0.1.5 结构）——引用 §2.5（image-tokens 单独评估）与 §4.B8（零新 peer 约束）。
- **验证**：node --check ✓；region 与 0.1.5 EXACT MATCH；`deepSeekImageTokens` 锚点×3；纯函数冒烟 10 例（14×14~8000×8000）全部整数、≥1、≤384（含 3840×2160→369、8000×8000→349）。

---

## 2. 统一 diff 与副本产物（.workspace/deploy-015/）

- 12 个 unified diff：`patches/<pkg>.<feature>.patch`，`patch -p1` 于包目录可应用（多文件 patch 如 dsh-fs/dsh-fs-local/dsh-llm-deepseek/dsh-launch-environment 含多个 `--- a/...` 文件头）。
- 12 个应用后完整副本：`deploy-015/<pkg>/`（含 package.json/lib/README 等全包）。
- `known-sha256-015.txt`：18 个被改文件的应用后 sha256 锚点。
- **可应用性验证**：在临时目录从 0.1.1 原包完整复制后，12 个 patch 全部 `patch -p1 --dry-run` OK → 实际应用 OK → 应用后与 deploy-015 副本**逐字节一致**（0 MISMATCH）。

---

## 3. replay 扩展：`.workspace/deploy-lag/patch-official-015.sh`（新增独立脚本）

- **裁决：新增独立脚本，不并入 replay-lag-fix.sh**。理由：
  1. **主题正交**：replay-lag-fix.sh 是"subagent 多开卡顿修复"主题（U-1..U-8 + btw + P0 materialize），前置依赖 PATCH_TGZ/settings.yaml/pyyaml；0.1.5 借码单元不需要这些前置，只依赖 patch/diff/node/grep/cp。合并会强制 12 个新单元接受无关前置校验。
  2. **零文件重叠**：12 个借码包与 5 个既有补丁包（agent-loop/host-apiproxy/subagent/client-ui-subagent/web-search-deepseek）无任何重叠；合并会稀释 lag-fix 的 sha256 锚点语义、动已验收脚本引入回归风险。
  3. **单元化一致性**：新脚本与 replay-lag-fix.sh 模式同构——每单元独立 backup/apply/verify/rollback/幂等锚点；独立 dry-run/rollback/help；独立备份目录 `backup-015-<stamp>/`（不与 lag-fix 的 backup-* 冲突）。
- **覆盖能力（按任务要求逐项）**：备份（backup_all 12 包整目录快照）✓；应用（patch -p1 于包目录，先 dry-run 预检）✓；校验（node --check 每 .js + 锚点 grep -c ≥min + sha256 全等双保险）✓；回滚（--rollback 用最新备份还原）✓；幂等锚点（unit_applied = 锚点命中且 sha256 全等，命中则 SKIP）✓；bash -n ✓（实测通过）；--dry-run ✓（实测只打印不写入）；--help ✓。
- **端到端实测（临时 ROOT，未碰真实树）**：run → 12 单元全部 PASS；幂等重跑 → "全部单元均已应用，无操作"；--rollback → 还原后锚点归零（EXTERNAL_WEB_CONTENT_NOTICE=0）；rollback 后重跑 → 13 PASS（12 单元 + 汇总行）/ 0 FAIL。
- **修复记录**：初版发现 3 个 bug 已修复——① UNITS 数组说明文字含 `${process.execPath}` 被 bash 展开导致数组赋值失败（改为字面量）；② `grep -c` 失败时 count 空串（`${count:-0}`）；③ 锚点 `-rg.exe` 以 `-` 开头被 grep 当选项（`grep -c --`）；④ dsh-fs-local 锚点从 readByteRange（index.js 仅 1 处）改为 readByteWindow（index.js 2 处：定义+调用），保证幂等判定可靠。

---

## 4. 自复核（逐项核对）

| 复核项 | 结论 |
|---|---|
| 移植面 = 报告值 | ✓ 10 项与报告最小面一致（P0-1 3 处、P0-2 ~28 行、P1-1 1 行、P1-2 1 行、P1-3 ~8 行、P2-1 4 行、P2-2 4 处、P2-3 ~40 行、P2-4 ~30 行、launchedThroughSsh ~12 行、image-tokens region 134 行=0.1.5 完整模块） |
| 无新 peer 依赖 | ✓ 唯一新增 import 为 `node:path` 内置（join/parse），全部 12 patch 无新增 `@deepseek-ai/*` import；引用 §4.B8 约束 |
| 避开 5 补丁包 | ✓ 12 目标包与 agent-loop/host-apiproxy/subagent/client-ui-subagent/web-search-deepseek 零重叠；全局树 5 包 mtime 未变 |
| 条件项裁决 | ✓ launchedThroughSsh 适用（getFrom API 0.1.1 已存在）；image-tokens 可移植（纯函数、零依赖、与 vision 补丁面零重叠、无消费者零行为影响）；两者均已移植并注明 |
| 已否决项未重复评估 | ✓ 引用 upstream-borrow-validation.md：槽位多消费者（§1 无货可借）、流式/传输层（§2 架构级不借）、sessionProjections 强制化（§4.B1）等均未触碰 |
| 报告外噪音未借 | ✓ getSectionOrder 重构、assertNever import 迁移、scopeOf/activeServerNames、SearchError 措辞、request-pricing 等均未借（逐项核对见 §1） |
| 平台适用性标注 | ✓ 每单元在 UNITS 表附平台注释；atomic-write（Windows no-op 保留）、fs-search（win32 分支）已标注 |
| 未改 ~/.dsh / 全局树 | ✓ 全部产物在 .workspace 内；全局树与 ~/.dsh 仅只读访问 |

## 5. 自裁决

**裁决：PASS（通过）**。12 项全部落地、保真（与 0.1.5 逐字/内容级一致）、验证齐备（node --check + 锚点 + sha256 + 冒烟 + patch 可应用性 + 重放脚本端到端）。无 rework 项。

## 6. 问题清单（非阻塞，登记备查）

1. **tool-web system-prompt 措辞未借（可选未做）**：0.1.5 的 web_search/web_fetch systemPrompt 措辞加了"untrusted data, never instructions"，但其实现是 scope-aware 函数形式（依赖 getSectionOrder + ctx.tools.get），0.1.1 无此 seam，最小面（~3 行）不含。核心防御（输出前置 notice）已覆盖提示注入风险面；如需措辞层防御，需自研适配 0.1.1 静态字符串（超出本档范围，主代理可裁决追加）。
2. **image-tokens 无消费者**：0.1.1 无 request-pricing 结构，deepSeekImageTokens 为纯新增导出。零行为影响；将来若 vision 计费需要，可直接消费。已按"可移植"裁决落地，若主代理认为过度可跳过（回滚面=删除 region + export + types，锚点 known-sha256 同步）。
3. **str-replace-editor view_range 一并 oneOf 化**：报告写"4 参数"，0.1.5 实际 5 个 schema 字段全部 oneOf 化（含 view_range）。按 0.1.5 忠实移植（与上游逐字一致），报告行号 :286-306 覆盖。
4. **dsh-fs-local 锚点口径**：`readByteRange` 在 index.js 仅 1 处（方法定义），重放脚本幂等锚点改用 `readByteWindow`（2 处）。已知问题，已修复并在 §3 记录。

## 7. 部署步骤（主代理执行）

```bash
# 0) 前置：确认 5 个既有补丁包未漂移（replay-lag-fix.sh precheck 通过）
# 1) 备份 + 应用 + 校验（幂等，可重复执行）
.workspace/deploy-lag/patch-official-015.sh            # 或先 --dry-run 预览
# 2) 重启 DSH（npx @deepseek-ai/dsh web）使 12 包改动生效
# 3) 验收冒烟（可选）：
#    - web_search/web_fetch 输出首行含 "External web content follows..."
#    - 持久化 bash exit 0 输出含 "[Command finished with exit code 0]"
#    - node -e 直接 import image-tokens 纯函数（deploy-015 副本在 workspace 内可用）
# 4) 回滚（如需要）：.workspace/deploy-lag/patch-official-015.sh --rollback && 重启
# 注意：5 个既有补丁包仍由 replay-lag-fix.sh 管理，两脚本互不触碰。
```

- 部署脚本默认 DSH_ROOT 指向全局树；补丁根 `.workspace/deploy-015/` 经 `P015_DIR` 可覆盖。
