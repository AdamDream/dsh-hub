# T08 · 本地插件资产清点与「源头—部署件」对账（DSH 0.1.1-rc.2 → 0.2.0-rc.1）

- 轨道：T08（审计阶段，只读；仅写 `.workspace/**`）
- 采样时刻：本轮实测（`~/.dsh/profiles/node_modules` 与仓库工作树，2026-09-29）
- 对账口径：`sha256` 逐文件；排除 `node_modules/`、`.git/`、符号链接
- 现役 `0.1.1-rc.2`（3080）与隔离 `0.1.7-rc.2`（3097）**均未触碰**；`~/.dsh/**`、`~/.dsh-017/**`、仓库内既有插件源码**均未修改**
- 复现工具：`.workspace/audit-020/{recon.py,match.py,jdiff.py,final_table.py}`，原始输出 `.workspace/audit-020/recon-all.txt`

---

## 1. 结论摘要

**盘面**：实际参与现役组合的本地定制共 **13 个**，全部以「非符号链接真实目录」落在 `~/.dsh/profiles/node_modules` 下：

| 分布 | 包 |
|---|---|
| `@local/`（9） | `dsh-btw` `dsh-logfile` `dsh-pptmaster` `dsh-ssh-gui` `dsh-subagent-model` `dsh-usage` `dsh-wallpaper` `dsh-web-search-sse` `dsh-workerspace` |
| `@deepseek-ai/` 作用域**但不是官方包**（3） | `dsh-session-board` `dsh-taste` `dsh-vision-adam` |
| 顶层非作用域（1） | `dsh-workspace-enhancement` |

> ⚠️ `@deepseek-ai/dsh-session-board` 是**任务清单里没有的第 10 个本地插件**（本地自制包，借用官方作用域名）。它已在 `cordis.patch.yml` 里以 `id: session-status-board` 挂载并在本会话的工具面上出现（`query_peers`），若不迁移会静默丢失会话看板。

**四类迁移方式判定（13 个，无遗漏）**

| 迁移方式 | 数量 | 插件 |
|---|---:|---|
| `源码重建` | **6** | `dsh-btw` `dsh-logfile` `dsh-subagent-model` `dsh-web-search-sse` `dsh-taste` `dsh-session-board` |
| `需改造后再重建` | **6** | `dsh-pptmaster` `dsh-ssh-gui` `dsh-wallpaper` `dsh-workerspace` `dsh-workspace-enhancement` `dsh-vision-adam` |
| `部署件直接复制` | **1** | `dsh-usage` |
| `退役（0.2.0 官方已内置）` | **0** | —（1 个候选假设被本轮证据**否定**，见 §4.4） |

**最关键的 3 条发现**

1. **`dsh-usage` 没有任何权威源码可重建。** 实测 12 个候选树（仓库 `dsh-usage/`、`.workspace/workstreams/sources/dsh-usage-src`、`.workspace/lag-fix/exec-*` 各 stage、`_migration/usage-v4-017`、升级备份等）**无一**能复现部署件；最接近的只有 `.workspace/lag-fix/exec-cold-batch/evidence/pre-image-deployed`（10 文件 8 同 2 异）。部署件是 v4 图表版 + `ingest-runner/ingest-worker` 拆分，仓库源码是更早的并行线（`lib/charts.js` 27 396 B vs 7 112 B）。**它是唯一必须走「部署件直接复制」的插件**；且注意 `lib/ingest-dsh.js` 仍是**代次 0 旧选择语义**（与仓库同哈希 9717 B），v4 会话格式修复只存在于 `_migration/usage-v4-017`（未落位）。

2. **6 处「现场热修未回流源码」**——只有源码才能重建，这些改动**一旦按源码重建就会静默丢失**：
   - `dsh-wallpaper/lib/client.js`：`sameShadedTokens` 主题叠层幂等去重（源码 0 命中）
   - `dsh-ssh-gui/lib/client.js`：`dsh-perf-fix K1-3 keep-alive guards v1`（`aliveRef`+generation，源码 0 命中；**017 副本已带走**，哈希 `b3e0c225`）
   - `dsh-pptmaster/lib/client.js`：1 行 module-loader id `dsh-pptmaster` → `@local/dsh-pptmaster`（`.bak` = 原版 `8b6563f7`，017 以部署件为 preimage `e2b5d28b`）
   - `dsh-workerspace/lib/index.js`：新增 2 行 `additionalProperties: false`（9 vs 源码 7；`.bak` = 原版 `3a8b5dcf`；**017 端口已保留**）
   - `dsh-workspace-enhancement/lib/client.js`：至少 2 处（`Array.from(new Set(ids))` 去重 + `dsh-perf-fix K1-3` keep-alive guards）——**0.1.2/0.1.3/0.1.4 tgz 与 0.1.4 源码全部 0 命中**，即**任何上游版本都不含这两处**
   - `dsh-vision-adam`：部署件是本地演进的 **0.2.0-v2**（opencode 网关 + `analyzeImageBytes` 导出 + `lib/client.js` 设置页），与 `dsh-upgrade-backup/dsh-vision-adam-0.2.0`（adam 网关 `gemini-3.6-flash`、无 client）**不是同一条线**

3. **`dsh-workspace-enhancement` 的 0.1.2 源码线已不存在，且它没有被 017 适配过。** 0.1.2 只以**构建产物**形态存在；仓库里唯一带 `src/` 的是 **0.1.4**。实测部署件与 `.dsh-017` 部署件、`dsh-upgrade-backup/20260925-110042` 三方**逐字节全等（119/119）**⇒ 0.1.1→0.1.7 是原样搬运。它是 `dsh-ssh-gui` 的**阻断性上游依赖**（`import { remoteWorkspacesRoot } from 'dsh-workspace-enhancement'`），其 0.2.0 适配是整条 SSH/串口链的前置。

**另需登记的通行前置**：13 个插件里 **12 个**的 `peerDependencies` 范围显式排除 0.2.0（`>=0.1.1-rc.2 <0.2.0` 或 `^0.1.1-rc.2`），仅 `dsh-logfile`（0 peer）免疫。这是机械替换，但**是每个插件安装的前置闸门**。

---

## 2. 证据

### 2.1 主对账表（部署件 vs 最佳候选源码，`sha256` 逐文件）

| 插件 | 部署件文件数 | 最佳候选源码 | 同 | 异 | 仅部署 | 仅源码 | 判定 |
|---|---:|---|---:|---:|---:|---:|---|
| `@local/dsh-btw` | 89 | `dsh/dsh-btw` | 48 | 38 | 3 | 26 | 有差异（源码更新） |
| `@local/dsh-logfile` | 4 | `.workspace/lag-fix/exec-logdrift/candidates/dsh-logfile` | 4 | 0 | 0 | 0 | **逐字节等价** |
| `@local/dsh-pptmaster` | 62 | `.workspace/workstreams/deploy/deploy-pptmaster/plugin/dsh-pptmaster` | 59 | 2 | 1 | 0 | 有差异（1 行现场补丁） |
| `@local/dsh-ssh-gui` | 8 | `.workspace/workstreams/deploy/deploy-ssh-gui/dsh-ssh-gui` | 7 | 1 | 0 | 0 | 有差异（K1-3 现场补丁） |
| `@local/dsh-subagent-model` | 3 | `.workspace/workstreams/deploy/deploy-subagent-model` | 3 | 0 | 0 | 15 | **逐字节等价** |
| `@local/dsh-usage` | 14 | `dsh/dsh-usage` | 5 | 7 | 2 | 11 | 有差异（**无源可复现**） |
| `@local/dsh-wallpaper` | 12 | `dsh/dsh-wallpaper-local` | 11 | 1 | 0 | 0 | 有差异（现场补丁） |
| `@local/dsh-web-search-sse` | 2 | `Dexterous_Hand_23Dof/.research/hybrid-imu-emf/local-plugins/dsh-web-search-sse` | 2 | 0 | 0 | 0 | **逐字节等价** |
| `@local/dsh-workerspace` | 11 | `.workspace/workstreams/deploy/deploy-workerspace/dsh-workerspace` | 9 | 1 | 1 | 0 | 有差异（2 行现场补丁） |
| `@deepseek-ai/dsh-taste` | 31 | `dsh/dsh-taste` | 31 | 0 | 0 | 0 | **逐字节等价** |
| `@deepseek-ai/dsh-vision-adam` | 5 | `dsh-upgrade-backup/dsh-vision-adam-0.2.0/dsh-vision-adam` | 1 | 2 | 2 | 0 | 有差异（版本线不同） |
| `dsh-workspace-enhancement` | 119 | `.workspace/workstreams/research/repos/dsh-workspace-enhancement` | 2 | 4 | 113 | 212 | 有差异（0.1.2 vs 0.1.4） |
| `@deepseek-ai/dsh-session-board` | 13 | `.workspace/workstreams/side-deploy/session-board` | **13** | 0 | 0 | 0 | **逐字节等价** |

> `dsh-session-board` 的**权威源码是 `.workspace/workstreams/side-deploy/session-board`（13/13 全等）**，而**不是**仓库 `dsh/session-board/dsh-session-board`（12/13，`package.json` 的 peer 范围写成畸形 `^0.1.1.2`）。

### 2.2 次优候选对账（用于定位权威源码 / 排除同名伪装）

| 插件 | 次优候选 | 同 / 异 / 仅部署 / 仅源码 | 结论 |
|---|---|---|---|
| `dsh-btw` | `.workspace/backups/btw/20260917-172915` | 80 / 6 / 3 / 3 | 部署件 ≈ 2026-09-17 旧快照 + 6 个 lib 构建产物差异 ⇒ **部署件是旧构建，不是被改过的现场** |
| `dsh-btw` | `.workspace/backups/btw/20260917-170146` | 80 / 6 / 3 / 3 | 同上 |
| `dsh-usage` | `.workspace/lag-fix/exec-cold-batch/evidence/pre-image-deployed` | 8 / 2 / 0 / 2 | 部署件的**前像**，之后 `index.js`+`client.js` 又各打了 1 次 |
| `dsh-usage` | `.workspace/workstreams/sources/dsh-usage-src` | 6 / 6 / 2 / 31 | 另一条并行线，**不等价** |
| `dsh-usage` | `_migration/usage-v4-017` | 11 / 3 / 0 / 5 | 0.1.7 **前向移植**（v4 选择语义 + settings API），未落位 |
| `dsh-usage` | `dsh-upgrade-backup/20260925-110042/.../@local/dsh-usage` | **14 / 0 / 0 / 0** | 与部署件全等（0.1.7 侧同为该件） |
| `dsh-workspace-enhancement` | `.workspace/.../research/tgz/x-we-0.1.2/package` | 116 / 2 / 1 / 0 | 0.1.2 上游产物；差异仅 `lib/client.js`+`package.json` |
| `dsh-workspace-enhancement` | `.dsh-017/profiles/node_modules/dsh-workspace-enhancement` | **119 / 0 / 0 / 0** | 与部署件全等 ⇒ 017 **未适配** |
| `dsh-vision-adam` | `.dsh-017/.../@deepseek-ai/dsh-vision-adam` | **5 / 0 / 0 / 0** | 与部署件全等 |
| `dsh-ssh-gui` | `_migration/settings-017/dsh-ssh-gui` | 6 / 2 / 0 / 0 | `lib/client.js` **与部署件同哈希**（现场补丁已带走）；`core.js`/`index.js` 是 017 端口 |
| `dsh-workerspace` | `_migration/settings-017/dsh-workerspace` | 10 / 1 / 0 / 0 | `.bak` 同哈希；`index.js` 是 017 端口（含 2 行补丁） |
| `dsh-pptmaster` | `_migration/ppt-017/dsh-pptmaster` | 56 / 6 / 0 / 1 | 017 以部署件为 preimage（`client.js.preimage-e2b5d28b` = 部署件 `e2b5d28b`） |
| `dsh-subagent-model` | `_migration/settings-017/dsh-subagent-model` | 0 / 3 / 0 / 0 | 版本 `0.2.0-017`，**另一条线**（0.1.7 端口） |

### 2.3 现场热修逐条证据（未回流）

| # | 位置 | 部署件哈希 | 源码哈希 | 差异内容 | 是否已带走 |
|---|---|---|---|---|---|
| P1 | `dsh-wallpaper/lib/client.js` | `0fc4fd87fe4e…` | `28141d52c252…` | `sameShadedTokens()` 幂等：theme 变更时不再重挂叠层 | ❌ 仅在部署件 |
| P2 | `dsh-ssh-gui/lib/client.js` | `b3e0c225b3da…` | `5e23bc192d14…` | `dsh-perf-fix K1-3 keep-alive guards v1`：`aliveRef`+`refreshGenerationRef`，4+2N 扇出响应不再落进已死组件 | ✅ 017 副本同哈希 |
| P3 | `dsh-pptmaster/lib/client.js` | `e2b5d28b4517…` | `8b6563f776ed…` | 1 行：module-loader id `dsh-pptmaster` → `@local/dsh-pptmaster` | ✅ 017 以部署件为 preimage |
| P4 | `dsh-workerspace/lib/index.js` | `4362201dacb9…` | `3a8b5dcfe9f2…` | +2 行 `additionalProperties: false`（9 vs 7 命中） | ✅ 017 端口保留（9 命中） |
| P5 | `dsh-workspace-enhancement/lib/client.js` | `56faaf956705…` | 0.1.4 源码 `f22181122304…` | `Array.from(new Set(ids))` 去重 + `dsh-perf-fix K1-3 keep-alive guards v1` | ❌ **0.1.2/0.1.3/0.1.4 tgz 与 0.1.4 src 全部 0 命中** |
| P6 | `dsh-workspace-enhancement/package.json` | `8f097a4630b5…` | `3c85869215f9…` | peer `^0.1.0-rc.6`→`^0.1.1-rc.2`；`ssh2 ^1.16.0`→`^1.17.0`；新增可选原生依赖 `cpu-features`/`koffi`/`node-pty` | ❌ 仅在部署件 |
| P7 | `dsh-vision-adam/lib/index.js` | `f331b3d8a077…` | `94e95b473be5…` | 网关 `llmapi.roboscience.xyz`/`gemini-3.6-flash` → `opencode.ai/zen/go`/`deepseek-v4.1-flash`；opencode 三头认证；新增 `randomUUID` 与 `analyzeImageBytes`/`resolveOptions`/`resolveApiKey` 导出 | ⚠️ 017 副本仍不同（`_migration/settings-017` 的 `index.js`/`client.js` 各异） |
| P8 | `dsh-vision-adam/lib/client.js` | 仅部署件有 | — | 手写设置页（`vision-adam` 段：model/baseURL/apiKeyEnv/maxTokens） | ⚠️ 同上 |
| P9 | `dsh-vision-adam/package.json` | `a9005cf716a3…` | `1b3d68cbf35d…` | 新增 `exports`（含 `./client`）、`files`、`dsh.client.{platform,inject}` | ⚠️ 同上 |
| P10 | `dsh-pptmaster/package.json` | `8efeba94d4f3…` | `7babd8cc3c4f…` | 规范化后**唯一**差异：`@aiden0z/pptx-renderer` `1.2.4`→`^1.2.4`（其余为字段重排，噪声） | — |

**现场备份件（`*.bak`）哈希**（重建时用于定位原版）：
- `dsh-pptmaster/lib/client.js.bak` = `8b6563f776ed…`（= 部署源 `lib/client.js`）
- `dsh-workerspace/lib/index.js.bak` = `3a8b5dcfe9f2…`（= 部署源 `lib/index.js`）
- `dsh-vision-adam/lib/index.js.bak-restore-20260912-161015`（`lib/client.js` 无对应源）

### 2.4 权威源码定位总表

| 插件 | 权威源码路径 | 性质 |
|---|---|---|
| `dsh-btw` | `dsh/dsh-btw` | **带 `src/` 的真源码**（tsdown 构建链、`node_modules` 就位） |
| `dsh-logfile` | `.workspace/lag-fix/exec-logdrift/candidates/dsh-logfile` | lib-only 手写 JS（4 文件全等） |
| `dsh-pptmaster` | `.workspace/workstreams/deploy/deploy-pptmaster/plugin/dsh-pptmaster` | lib-only 交付树（含 `skills/`、`scripts/`） |
| `dsh-ssh-gui` | `.workspace/workstreams/deploy/deploy-ssh-gui/dsh-ssh-gui` | lib-only 手写 JS |
| `dsh-subagent-model` | `.workspace/workstreams/deploy/deploy-subagent-model` | lib-only（3 文件全等） |
| `dsh-usage` | **无** | 仅有前像 + 并行线，无可复现源 |
| `dsh-wallpaper` | `dsh/dsh-wallpaper-local` | lib-only 手写 JS |
| `dsh-web-search-sse` | `Dexterous_Hand_23Dof/.research/hybrid-imu-emf/local-plugins/dsh-web-search-sse` | lib-only（2 文件全等） |
| `dsh-workerspace` | `.workspace/workstreams/deploy/deploy-workerspace/dsh-workerspace` | lib-only 手写 JS（带 `test/`） |
| `dsh-taste` | `dsh/dsh-taste` | lib-only 手写 JS（31 文件全等） |
| `dsh-vision-adam` | 无单一权威件（最近：`dsh-upgrade-backup/dsh-vision-adam-0.2.0/dsh-vision-adam`，为**旧线**） | 现场演进件 |
| `dsh-workspace-enhancement` | `.workspace/workstreams/research/repos/dsh-workspace-enhancement`（**0.1.4**，非部署的 0.1.2） | **带 `src/` 的真源码，但版本线不同** |
| `dsh-session-board` | `.workspace/workstreams/side-deploy/session-board` | lib-only（13 文件全等） |

**仓库 git 状态警示**：`dsh-btw` 在仓库 git 中被跟踪，且**工作树有大量未提交改动**（`M dsh-btw/lib/client.js`、`M src/client/SideChatSurface.tsx`、`M src/host/vision.ts`、`M src/index.ts`、`?? lib/remote-bQu4rpiV.js` 等 26 项）。`dsh-usage`（HEAD `97b6e1f1`）、`dsh-wallpaper-local`/`dsh-taste`（HEAD `88c68288`）工作树干净。⇒ **btw 的「源码」目前只存在于工作树，尚未落盘为提交**；重建前必须先固化（提交或备份），否则任何 git 操作都可能丢失。

---

## 3. 逐插件迁移档案

> 字段口径：`宿主入口` = package.json `main`；`客户端入口` = `exports["./client"]` 或 `dsh.client` 声明；`settings ns` = 代码中实际注册的命名空间字符串（**0.2.0 若延续 0.1.7 的「profile 条目 id」语义则须改，见 §7 U-3**）；`槽位` 从 `lib/client.js` 实测。

### 3.1 `@local/dsh-btw` 0.4.0-btw.1
- 源码 / 部署：`dsh/dsh-btw` → `~/.dsh/profiles/node_modules/@local/dsh-btw`
- 宿主入口 `lib/index.js`；客户端入口 `lib/client.js`（`dsh.client.platform: web`，`immediately` 未设）
- 工具：`btw_ask_user`；服务：—；settings ns：`dsh-btw`（`settings.register`）
- 槽位：`conversation.session.header.actions`；typert 远程入口 `./typert`、`./remote`
- peer（18）：`dsh-agent` `dsh-api-remotes` `dsh-attachment` `dsh-llm` `dsh-session` `dsh-subagent` `dsh-tools` `dsh-typert-protocol` `dsh-vision-adam` `dsh-workspace` + 7 个 `dsh-client-*` + `react`；**16 个范围排除 0.2.0**
- 平台专属热修：无（但客户端 `require("@deepseek-ai/dsh-client-runtime")` 一类 seed 词在 0.1.7 已须改 `dsh-client-store`，0.2.0 必须重核）

### 3.2 `@local/dsh-logfile` 0.1.0
- 源码 / 部署：`.workspace/lag-fix/exec-logdrift/candidates/dsh-logfile` → `@local/dsh-logfile`（**4/4 全等**）
- 宿主入口 `lib/index.js`；**无客户端入口**；工具：无；服务：`ctx.provide('logfileStats')`
- settings ns：**无**（不 import `dsh-settings` 任何符号）⇒ `settings.yaml` 无对应段
- peer：**0 个** ⇒ **唯一不受 peer 范围闸门影响的插件**
- 组合配置（来自 `cordis.patch.yml`）：`level: 2`、`maxBytes: 8388608`、`maxFiles: 3`、`orphanWatch: true`
- 平台专属热修：无

### 3.3 `@local/dsh-pptmaster` 0.1.0
- 源码 / 部署：`.workspace/workstreams/deploy/deploy-pptmaster/plugin/dsh-pptmaster` → `@local/dsh-pptmaster`（59/62）
- 宿主入口 `lib/index.js`；`bin: dsh-pptd → lib/bin.js`；客户端 `lib/client.js`
- 工具（6）：`pptmaster_create` `pptmaster_get_template_pages` `pptmaster_list_templates` `pptmaster_scene_check` `pptmaster_scene_create` `pptmaster_update_slide`
- 槽位（实测 ≥14）：`conversation.chat.turnTail` `conversation.hero.actions` `conversation.hero.inputAccessory` `tool.artifact{,.fallback,.saved}` `tool.call.toolview` `tool.create.{running,done,failed}` `tool.download{ing}` `tool.inspect` `tool.fileActionFailed`
- 运行期依赖：`@aiden0z/pptx-renderer` `pptxgenjs` `fflate` `js-yaml` `typescript` `zod` `@deepseek-ai/schemastery`
- peer（18）：`dsh-agent` `dsh-brand` `dsh-invariants` `dsh-llm` `dsh-session` `dsh-skill` `dsh-subprocess` `dsh-system-prompt` `dsh-tools` + 7 个 `dsh-client-*` + `react`；**16 个排除 0.2.0**
- 平台专属热修：**P3（module-loader id `@local/` 前缀）** —— 这是「本地部署件 id 必须与包名一致」的现场修复范式

### 3.4 `@local/dsh-ssh-gui` 0.2.0
- 源码 / 部署：`.workspace/workstreams/deploy/deploy-ssh-gui/dsh-ssh-gui` → `@local/dsh-ssh-gui`（7/8）
- 宿主入口 `lib/index.js`；客户端 `lib/client.js`（`dsh.client.platform: web`）
- 工具：无原生工具；RPC 通道 `/ssh-gui`（`nodes.*` `node.status` `keyref.*` `exec.run` `file.*` `serial.*` `config.get`）+ 复用底座 `/dsw`
- 槽位：`settings.section` `conversation.session.header.actions` `sidebar.workspaces.remoteHosts`
- settings ns：`dsh-ssh-gui`（**≠ profile entry id `ssh-gui`** ⇒ 0.1.7 起自动导入必失败）
- peer（5）：`cordis` `dsh-credentials` `dsh-settings` + **`dsh-workspace-enhancement: 0.1.2`（精确钉版）**
- **阻断性上游依赖**：`lib/index.js` 导入 `remoteWorkspacesRoot`（来自 `dsh-workspace-enhancement`）⇒ 底座不迁则本插件无论怎么改都不可用
- 平台专属热修：**P2（K1-3 keep-alive guards）**

### 3.5 `@local/dsh-subagent-model` 0.1.0
- 源码 / 部署：`.workspace/workstreams/deploy/deploy-subagent-model` → `@local/dsh-subagent-model`（**3/3 全等**，含 `package.json`）
- 宿主入口 `lib/index.js`；客户端 `lib/client.js`（`dsh.client.platform: web`，inject `dsh-client-runtime` + `dsh-client-ui-settings`）
- 工具：无；settings ns：**`dsh-subagent`**（`provider`/`model` 可选，热覆盖 preset 静态路由）
- 槽位：`settings.section`
- peer（3）：`cordis` `dsh-settings`（1 个排除 0.2.0）+ `schemastery`
- 平台专属热修：**无包内补丁**，但配套**安装树补丁**（`dsh-tool-subagent` 补 1 helper + 3 行 `effectiveConfiguredAgentOptions`，`deploy-subagent-model/dsh-tool-subagent.index.js.patched` + `.p0.diff`）⇒ 见 §4.5 / §7 U-1

### 3.6 `@local/dsh-usage` 0.1.0
- 源码：**无**；部署 `@local/dsh-usage`（14 文件）
- 宿主入口 `lib/index.js`；客户端 `lib/client.js`（`dsh.client.inject: ["dsh-client-connection","dsh-client-ui-settings"]`）
- 工具：无（settings 卡片 + 自绘 SVG 图表）；settings ns：`dsh-usage`（`settings.register`）
- 部署件 lib 组成：`charts.js`(27 396) `client.js`(81 631) `db.js`(38 493) `index.js`(16 863) `ingest-cc.js` `ingest-dsh.js` `ingest-runner.js` `ingest-worker.js` `rpc.js` `zstd.js`
- peer（4）：`cordis` `dsh-settings` `dsh-home-paths` + `schemastery`（1 个排除 0.2.0）
- 平台专属热修：**worker 依赖解析**（`ingest-worker.js` 由 worker 独立 loader 解析，0.1.7 已证 `healProfilesModuleFallback()` 被删、需建最小符号链接集）——详见 §5 与 §7 U-2

### 3.7 `@local/dsh-wallpaper` 0.5.0
- 源码 / 部署：`dsh/dsh-wallpaper-local` → `@local/dsh-wallpaper`（11/12）
- 宿主入口 `lib/index.js`；客户端 `lib/client.js`（`dsh.client.immediately: true`）
- 工具：无；settings ns：`wallpaper`（`settings.register`）；槽位：`settings.general.item`（`id:"wallpaper"`）
- peer（8）：`react` `cordis` `schemastery` `dsh-settings` + 4 个 `dsh-client-*`；**5 个排除 0.2.0**
- 平台专属热修：**P1（theme 叠层去重）**；另附 `install.sh`

### 3.8 `@local/dsh-web-search-sse` 0.1.0
- 源码 / 部署：`Dexterous_Hand_23Dof/.research/hybrid-imu-emf/local-plugins/dsh-web-search-sse` → `@local/dsh-web-search-sse`（**2/2 全等**）
- 宿主入口 `lib/index.js`；**无客户端入口**；工具：`web_search`（provider id `deepseek-sse`，**官方 `dsh-web-search-deepseek` 的派生分支**，仅新增 SSE 组装）
- settings ns：`web-search-deepseek-sse`；peer（5）：`cordis` `dsh-credentials` `dsh-launch-environment` `dsh-settings` `dsh-web`；**4 个排除 0.2.0**
- 组合配置：`apiKeyEnv: DEEPSEEK_API_KEY`、`baseURL: https://llmapi.roboscience.xyz/v1`、`model: claude-opus-4-6`、`maxUses: 100000`；`web.searchProvider: deepseek-sse`
- **退役判定见 §4.4：本轮证据否定退役**

### 3.9 `@local/dsh-workerspace` 0.1.0
- 源码 / 部署：`.workspace/workstreams/deploy/deploy-workerspace/dsh-workerspace` → `@local/dsh-workerspace`（9/11）
- 宿主入口 `lib/index.js`；**无客户端入口**（工具面 + 模态确认走宿主）
- 工具（6）：`ws_serial_list` `ws_serial_open` `ws_serial_send` `ws_serial_read` `ws_serial_close` `ws_flash`
- settings ns：`dsh-workerspace`（**≠ entry id `workerspace`**）；peer（8）：`cordis` `dsh-credentials` `dsh-fs` `dsh-settings` `dsh-subprocess` `dsh-tools` `dsh-user-approval` + `schemastery`，**6 个排除 0.2.0**
- 平台专属热修：**P4（+2 行 `additionalProperties: false`）**；带 `test/{core,flash,serial}.test.mjs`

### 3.10 `@deepseek-ai/dsh-taste` 0.1.0
- 源码 / 部署：`dsh/dsh-taste` → `@deepseek-ai/dsh-taste`（**31/31 全等**）
- 宿主入口 `lib/index.js`；客户端 `lib/client.js`；工具：`taste`
- lib 组成：`backfill/bridge/client/collector/commands/config/index/learner-tools/learner/model-registry/queue/storage`
- peer（9）：`dsh-agent` `dsh-atomic-write` `dsh-client-connection` `dsh-home-paths` + …，**7 个排除 0.2.0**
- 平台专属热修：无（源码即权威件）

### 3.11 `@deepseek-ai/dsh-vision-adam` 0.2.0（本地演进线）
- 源码：无单一权威件；部署 `@deepseek-ai/dsh-vision-adam`（5 文件，含 `lib/client.js` 与 `lib/index.js.bak-restore-20260912-161015`）
- 宿主入口 `lib/index.js`；客户端 `lib/client.js`（`dsh.client.platform: web`，inject `dsh-client-runtime` + `dsh-client-ui-settings`）
- 工具：`analyze_image`（图片 + 视频，OpenAI 兼容 `/chat/completions`；视频走 Zhipu 式 `video_url`）
- settings ns：`vision-adam`；导出可复用函数 `analyzeImageBytes` / `resolveOptions` / `resolveApiKey`（供 btw 复用）
- peer（6）：`cordis` `dsh-tools` `dsh-credentials` `dsh-launch-environment` `dsh-settings` `dsh-fs`，**5 个排除 0.2.0**（且范围是**更旧的 `^0.1.0-rc.7`**）
- 平台专属热修：**P7/P8/P9（v2 网关切换 + client 设置页 + exports/dsh.client 字段）**——均为现场演进，未回流上游
- ⚠️ 更正任务背景的一处假设：`vision-adam` 的现场件**不在** `Dexterous_Hand_23Dof`（该工作区贡献的是 `dsh-web-search-sse`）；`vision-adam` 的旧线在 `~/dsh-vision-adam`（**0.1.0**，adam 网关 `gemini-3.6-flash`，无 client）

### 3.12 `dsh-workspace-enhancement` 0.1.2
- 源码：`.workspace/workstreams/research/repos/dsh-workspace-enhancement`（**0.1.4**，带 `src/`+tsdown）；部署 `~/.dsh/profiles/node_modules/dsh-workspace-enhancement`（**0.1.2**）
- 宿主入口 `lib/index.js`；客户端 `lib/client.js`（另有 `lib/client/*.js` 子模块 + `.js.map`）
- 注册三席位（`cordis.patch.yml`）：`ssh-remote`（`ctx.ssh/subprocess/fs` 三远程 provider）、`directory-picker-ssh`（**已 disabled**）、`ssh-web-channel`（多连接注册表 + `/dsw` RPC）
- 工具：无直接工具（`exec-tools` 等经底座 RPC）；peer（2）：`dsh-system-prompt` `dsh-tools`，**2 个排除 0.2.0**
- 运行期依赖：`ssh2` + 可选原生 `cpu-features` `koffi` `node-pty`
- 平台专属热修：**P5/P6**；且 0.1.1→0.1.7 **零适配**（与 017 部署件逐字节全等）

### 3.13 `@deepseek-ai/dsh-session-board` 0.1.0（任务清单遗漏项）
- 源码 / 部署：`.workspace/workstreams/side-deploy/session-board` → `@deepseek-ai/dsh-session-board`（**13/13 全等**）
- 宿主入口 `lib/index.js`；**无客户端入口**；lib：`capture/board/tool/storage/inject/grouping/index`
- 工具：`query_peers`（= 本会话工具面上的 peer 看板）；settings ns：`session-status-board`（**与 profile entry id 同名** ⇒ 0.1.7 起属「段名==id」的**可自动导入**一类，但前提是该段字段全部 volatile，仍需 0.2.0 复核）
- peer（5）：`cordis` `dsh-tools` `dsh-settings` `dsh-atomic-write` `dsh-llm`，**4 个排除 0.2.0**
- 平台专属热修：无；带 `test/{unified-source,grouping-ttl}.test.mjs`、`CONTRACT.md`、`install.sh`
- ⚠️ **仓库内同名目录是伪装**：`dsh/session-board/dsh-session-board` 的 `package.json` peer 范围畸形（`^0.1.1.2`），不可作重建源

---

## 4. 迁移方式判定

### 4.1 `源码重建`（6）
| 插件 | 依据 |
|---|---|
| `dsh-logfile` | 4/4 逐字节等价；0 peer；lib-only 无构建链 |
| `dsh-subagent-model` | 3/3 逐字节等价（含 `package.json`）；lib-only |
| `dsh-web-search-sse` | 2/2 逐字节等价；lib-only |
| `dsh-taste` | 31/31 逐字节等价；lib-only |
| `dsh-session-board` | 13/13 逐字节等价（源在 `side-deploy/`）；lib-only |
| `dsh-btw` | 源码为**带 `src/` 的真源码且严格新于部署件**（部署件 ≈ 2026-09-17 旧快照）；现场无未回流改动；需 `tsdown` 重建 |

### 4.2 `需改造后再重建`（6）
| 插件 | 改造内容（前置，必须先回流/移植） |
|---|---|
| `dsh-wallpaper` | 回流 **P1** 到 `dsh-wallpaper-local/lib/client.js` |
| `dsh-ssh-gui` | 回流 **P2**（017 副本已有同哈希件可直接取用） |
| `dsh-pptmaster` | 回流 **P3**；并复核 6 工具 + 14 槽位在 0.2.0 的席位名 |
| `dsh-workerspace` | 回流 **P4**（017 端口已含，可对照） |
| `dsh-workspace-enhancement` | **重建基线换到 0.1.4 源码**并移植 **P5/P6**；0.1.2 无源码 ⇒ 若拒绝移植则降级为「部署件直接复制」 |
| `dsh-vision-adam` | 无权威源：需以 `dsh-upgrade-backup/dsh-vision-adam-0.2.0` 为基线**重建 v2 演进面**（**P7/P8/P9**），或直接以部署件为基线改造 |

### 4.3 `部署件直接复制`（1）
| 插件 | 依据 |
|---|---|
| `dsh-usage` | 12 个候选树无一致现源；最接近的前像仅 8/10 且之后又两次改动 ⇒ **部署件是唯一载体**；复制后再叠加 `_migration/usage-v4-017` 的 v4 修复（该修复**尚未落位**） |

### 4.4 `退役`（0）—— 1 个候选假设被本轮证据**否定**
| 候选 | 假设 | 本轮实测 | 判定 |
|---|---|---|---|
| `dsh-web-search-sse` | 0.2.0 官方 `dsh-web-search-deepseek` 已容忍 SSE ⇒ 可退役 | 解包 `deepseek-ai-dsh-web-search-deepseek-0.2.0-rc.1.tgz`：`lib/index.js` 仅 2 处 `response.json()`，`text/event-stream`/`getReader()`/`TextDecoder`/SSE **0 命中** | **❌ 不可退役**，仍须移植 |
| `dsh-subagent-model` | 0.2.0 新增原生 `subagentModelSelection` ⇒ 默认路由面已内置 | 解包 `deepseek-ai-dsh-tool-subagent-0.2.0-rc.1.tgz`：新面是 `SubagentModelSelectionConfig`（`enabled` + `allowedModels`）= **「向新会话提供可选项」**，不是默认路由；子代理路由仍由 `config.agentOptions`（profile 条目配置）解析，**无 `subagentDefaultRoute` 一类外部服务钩子**（`ctx.get` 仅 `agents`/`llm`/`sessions`/`subagentModelSelection`） | **❌ 不可退役**；但语义面重叠，须显式裁决（§7 U-1） |

> 结论：**0.2.0 官方未内置任何本地定制**，迁移「不丢定制」不适用于退役豁免。

### 4.5 三类之外的单列风险
- **`dsh-subagent-model` 的配套安装树补丁**：`dsh-tool-subagent` 侧补丁（`deploy-subagent-model/dsh-tool-subagent.index.js.patched`、`dsh-tool-subagent.p0.diff`）**绑定 0.1.1 的目标文件哈希**；0.2.0 的 `dsh-tool-subagent` 已改（`modelSelection` 相关代码与新错误路径 `tool-subagent: provider "…" does not support child agentOptions`），**补丁必须重新生成**（`before_sha256` 必变），不得直接 `patch`。

---

## 5. 遗漏定制补齐

任务背景列出 `@local/` 的 9 个 + `dsh-vision-adam` + `dsh-workspace-enhancement` = 11 个；本轮实测补齐 **2 个**：

| 补齐项 | 为何会漏 | 证据 |
|---|---|---|
| `@deepseek-ai/dsh-session-board` | 不在 `@local/` 下，**借用官方作用域名**，且未出现在任务的本地插件清单里 | `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-session-board` 是**真实目录**（非符号链接，指向 DSH 安装树的都是符号链接）；`cordis.patch.yml` 有 `id: session-status-board`；本会话工具面可见 `query_peers`；与 `side-deploy/session-board` 13/13 全等 |
| `@deepseek-ai/dsh-taste` | 同上（`@deepseek-ai/` 作用域下的自制包） | 真实目录；`cordis.patch.yml` 有 `id: taste`；与 `dsh/dsh-taste` 31/31 全等；注册 `taste` 工具 |

**排查方法（可复用）**：在 `~/.dsh/profiles/node_modules` 下遍历顶层与 `@scope/` 两级，**凡是真实目录（非符号链接）即为本地放置件**；指向 `~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/...` 的符号链接是官方安装树，可排除。本轮结果为：`@local/*`(9) + `@deepseek-ai/{dsh-session-board,dsh-taste,dsh-vision-adam}`(3) + `dsh-workspace-enhancement`(1) = **13**。

**未发现遗漏的第三类路径**：`@deepseek-ai` 下其余真实目录（`@babel`/`@aws`/`@types` 等）均为 profile 依赖树，非本地插件；`@deepseek-ai` 两级的真实目录恰好只有上述 3 个。

**任务背景的一处更正**：`dsh-vision-adam` 并非「来自 `Dexterous_Hand_23Dof` 工作区」——该工作区贡献的是 `dsh-web-search-sse`（`Dexterous_Hand_23Dof/.research/hybrid-imu-emf/local-plugins/dsh-web-search-sse`）。`dsh-vision-adam` 的旧线在 `~/dsh-vision-adam`（0.1.0），现役件是本地演进的 0.2.0-v2。

---

## 6. 可执行重建清单

**通用前置（全部 13 个）**
1. 冷备 `~/.dsh/settings.yaml` 与 `~/.dsh/profiles/web/cordis.patch.yml`（settings 导入用 `rename()`，**无回滚点**）。
2. peer 范围改写：把 `>=0.1.1-rc.2 <0.2.0` / `^0.1.1-rc.2` / `^0.1.0-rc.7` 改为 0.2.0 兼容范围（**12 个插件受影响**；`dsh-logfile` 无 peer 免疫）。
3. 复制到 `.workspace/audit-020/` 下再操作（**禁止**改动 `~/.dsh/**` 与仓库内既有插件源码）；重建产物落 `.workspace/`。
4. npm 环境：`export npm_config_cache=/home/CNS2026495165/dsh/.workspace/npm-cache`、`export npm_config_logs_dir=/home/CNS2026495165/dsh/.workspace/npm-logs`（本地缓存已 275 MB，可支撑部分离线安装）。

| # | 插件 | 重建动作 | 构建/安装命令形态 | 网络 |
|---|---|---|---|---|
| 1 | `dsh-btw` | 工作树固化 → `tsdown` 构建 → 部署 | `cp -a dsh/dsh-btw .workspace/audit-020/build/btw && cd …/btw && npm run build`（`node_modules/.bin/tsdown` **已就位**）；校验 `npm run smoke`（`scripts/smoke-build.mjs`） | **可离线**（依赖树已装） |
| 2 | `dsh-logfile` | 源码直拷 | `cp -a <src>/lib <src>/package.json <dst>/` | **离线** |
| 3 | `dsh-subagent-model` | 源码直拷 + 重生成安装树补丁 | `cp -a <src>/{lib,package.json} <dst>/`；补丁：`patch -p0 < dsh-tool-subagent.p0.diff` 前**必须对 0.2.0 目标文件重算 `before_sha256`**（勿直接套用） | **离线**（拷贝）；补丁为本地文件操作 |
| 4 | `dsh-web-search-sse` | 源码直拷 | `cp -a <src>/{lib,package.json} <dst>/` | **离线** |
| 5 | `dsh-taste` | 源码直拷 | `cp -a dsh/dsh-taste/{lib,package.json,…} <dst>/` | **离线** |
| 6 | `dsh-session-board` | 源码直拷（**用 `side-deploy/session-board`**） | `cp -a .workspace/workstreams/side-deploy/session-board/* <dst>/` | **离线** |
| 7 | `dsh-wallpaper` | **先回流 P1** → 直拷 | 在 `dsh-wallpaper-local/lib/client.js` 补入 `sameShadedTokens` 逻辑 → `cp -a …`；可选 `bash install.sh` | **离线** |
| 8 | `dsh-ssh-gui` | **先回流 P2**（或直接取 017 副本）→ 直拷 | `cp _migration/settings-017/dsh-ssh-gui/lib/client.js <src>/lib/`（同哈希 `b3e0c225`）→ 直拷；**须先解决 `dsh-workspace-enhancement`（#11）** | **离线** |
| 9 | `dsh-pptmaster` | **先回流 P3** → 直拷 → 安装运行期依赖 | `cp -a <src>/* <dst>/`；依赖：`npm install --prefix <dst> @aiden0z/pptx-renderer pptxgenjs fflate js-yaml zod typescript` | **需网络**（运行期依赖）；缓存可能覆盖 ⇒ 先试 `--prefer-offline` |
| 10 | `dsh-workerspace` | **先回流 P4** → 直拷 → 跑测试 | 直拷后 `node <dst>/test/{core,flash,serial}.test.mjs` | **离线** |
| 11 | `dsh-workspace-enhancement` | **基线换 0.1.4 源码 + 移植 P5/P6** → 构建 | `cp -a .workspace/workstreams/research/repos/dsh-workspace-enhancement .workspace/audit-020/build/we && cd …/we && npm install && npm run build`（`tsc && tsdown`）；随后移植 P5（client.js 2 处补丁）与 P6（peer/依赖） | **需网络**（源码树无 `node_modules`）；**或**降级为「部署件直接复制」 |
| 12 | `dsh-vision-adam` | 以 0.2.0 旧线为基线重建 v2 面（P7/P8/P9）**或**直拷部署件后改造 | 直拷路线：`cp -a <deployed> <dst>/`；重建路线：以 `dsh-upgrade-backup/dsh-vision-adam-0.2.0/dsh-vision-adam` 为基线补 v2（无构建链） | **离线**（拷贝）；重建路线亦离线 |
| 13 | `dsh-usage` | **部署件直接复制** + 叠加 v4 修复 | `cp -a <deployed> <dst>/`；再对照 `_migration/usage-v4-017/lib/{index.js,client.js,ingest-dsh.js}` 施加 v4 选择语义与 settings API 端口；**worker 解析**：按 0.1.7 经验为 `@deepseek-ai/dsh-home-paths` 建最小符号链接集（**只新增不剪枝**） | **离线** |

**清单一句话**：**只有 `dsh-pptmaster`（运行期依赖）与 `dsh-workspace-enhancement`（0.1.4 源码树无 `node_modules`）可能需要网络**；其余 11 个均可离线完成（拷贝或本地构建）。

---

## 7. 未验证项

| # | 未验证项 | 为何未验证 / 影响的判定 |
|---|---|---|
| U-1 | **`dsh-subagent-model` 在 0.2.0 是否仍需要** | 已证 0.2.0 原生 `subagentModelSelection` 是「opt-in 提供可选路由」，**不是默认路由覆盖**；但「preset `agentOptions` 烘焙默认路由」在 0.2.0 是否已足够、设置页替代能力是否可接受，属**用户裁决**，不属本轨道可判定范围 |
| U-2 | **0.2.0 的 worker 依赖解析缺口是否仍在** | 0.1.7 已证 `healProfilesModuleFallback()` 被删、worker 退回原生解析 ⇒ 需最小链接集。0.2.0 新增 `dsh-workflow-ptc`（旧名 `dsh-workflow-worker-thread`）在依赖表中，但**其是否自愈、router 是否覆盖 worker 未实测**；`dsh-usage` 的 `ingest-worker.js` 直接依赖该结论 |
| U-3 | **0.2.0 的 settings 契约（`installSettingsSection`/`settingsNamespace` 是否仍存在、命名空间是否已改为「profile 条目 id」）** | 本轮只解了 `dsh-tool-subagent` 与 `dsh-web-search-deepseek` 两个 0.2.0 包；**未解 `dsh-settings-0.2.0-rc.1.tgz`**（该包在 `.workspace/audit-020/pkgs/` 可用）。这直接决定 7 个插件的 `settings` 半边要不要改：`dsh-ssh-gui`（`dsh-ssh-gui` ≠ `ssh-gui`）、`dsh-workerspace`（`dsh-workerspace` ≠ `workerspace`）、`dsh-subagent-model`、`dsh-usage`、`dsh-wallpaper`、`dsh-btw`、`dsh-vision-adam` |
| U-4 | **客户端 seed 词表与槽位名在 0.2.0 是否仍同名** | 0.1.7 已删 `dsh-client-runtime`（改 `dsh-client-store`）并改 `configForms` 契约。0.2.0 的 `@deepseek-ai` 包列表显示 `dsh-client-store` **仍在**、`dsh-client-ui-conversation/layout/primitives/locale/ui-settings/ui-tool` **均在**，但**未逐个核对导出的槽位 id 与 `bind→get` 语义**；影响 `dsh-btw`（7 个 inject + 2 槽位）、`dsh-pptmaster`（14 槽位）、`dsh-wallpaper`、`dsh-usage`、`dsh-ssh-gui` |
| U-5 | **`dsh-usage` 部署件 2 个「仅部署」文件（`ingest-runner.js`/`ingest-worker.js`）的权威文本** | 已确认它们**不在任何源码树**；重建立即依赖现存部署件字节（已在 §2.3/§6 按「直接复制」处置），但其**维护来源**（谁写的、是否还有更完整分支）未能定位 |
| U-6 | **`dsh-workspace-enhancement` P5 的完整补丁清单** | 只逐条比对了 `lib/client.js` 与 `package.json`（其余 116 个文件与 0.1.2 tgz 全等）⇒ 可确定差异**仅限**这两文件；但 `lib/client.js` 内部未做整文件语义走查（只定位了 2 个已知补丁点），**可能仍有未识别的现场改动** |
| U-7 | **`@deepseek-ai/dsh-session-board` 的 0.2.0 适配面** | 本轮只做资产对账；其 `session-status-board` 命名空间与 `query_peers` 工具在 0.2.0 的席位/契约未核（且 0.2.0 是否新引入官方看板能力未查） |
| U-8 | **`dsh-pptmaster` / `dsh-ssh-gui` / `dsh-workerspace` 是否有更权威的源码仓（而非 `_workspace/workstreams/deploy/` 交付树）** | 全盘搜索（`maxdepth 8-12`）未发现同名源码仓；结论基于「交付树是唯一现存源」。若存在仓库外的开发副本（未在 `$HOME` 下或超出搜索深度），本结论需修正 |
| U-9 | **`dsh-usage`/`dsh-taste`/`dsh-pptmaster` 等的 `settings.yaml` 段在 0.2.0 的导入可行性** | 依赖 U-3 结论；本轨道不做配置面判定 |

---

## 附：复现命令

```bash
# 环境
export npm_config_cache=/home/CNS2026495165/dsh/.workspace/npm-cache
export npm_config_logs_dir=/home/CNS2026495165/dsh/.workspace/npm-logs

# 全量对账（输出至 .workspace/audit-020/recon-all.txt）
cd /home/CNS2026495165/dsh/.workspace/audit-020
python3 recon.py            # 主+次候选对账
python3 final_table.py      # 主对账表
python3 match.py <target> <candidate...>   # 任意两树比对
python3 jdiff.py <a.json> <b.json>          # package.json 规范化差异（去字段序噪声）

# 本地放置件排查（找出所有非符号链接真实目录）
find ~/.dsh/profiles/node_modules -maxdepth 2 -mindepth 1 -type d \
  -not -path '*/node_modules/*' | while read p; do
  [ -L "$p" ] || echo "REALDIR ${p#*/node_modules/}"; done
```
