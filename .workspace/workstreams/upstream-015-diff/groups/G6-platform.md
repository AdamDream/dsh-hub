# G6-platform 增量调研笔记（ARCH 0.1.5-rc.2 vs GLOB 0.1.1-rc.2）

只读调研。方向约定：所有 diff 为 `diff -u ARCH GLOB`，`-` 行 = 0.1.5（ARCH），`+` 行 = 0.1.1（GLOB）。
本组无本地补丁包（本地补丁仅 agent-loop / client-ui-subagent / host-apiproxy / subagent / web-search-deepseek）。

## 核心背景结论（影响全组）

0.1.5 引入了**新会话模型**：`session.eventAt(seq)` / `SessionSeq(seq)` 品牌类型 / `snapshotEvents()` /
`ownEvents()` / `SessionLogOffset` / `header.seedLength` / `SurfaceManager`，并重新引入 `ctx.sessionProjections`
子系统。0.1.1（GLOB）是**纯 `session.events` 数组 + 纯 fold 辅助函数**（`effectiveSandboxMode`、
`effectivePermissionPreset`、`effectiveApprovalPolicy`、`openTurn` 等）。因此：
- 凡 hunk 触碰会话访问方式（eventAt/ownEvents/snapshotEvents/SessionSeq/SessionLogOffset/seedLength/sessionProjections/surface），
  一律判为**不可独立借**（会话模型耦合）。
- 0.1.1 在"纯 fold"方向上反而领先于 0.1.5（sandbox-policy/permission-presets/tool-goal/user-questions/shell-env/
  attachment-local 的 0.1.1 侧更"新"），这些包 0.1.5 无增量可借。
- 0.1.5 协议级重命名：`tool/code-dispatch-*`→`tool/ptc-dispatch-*`（dsh-tools / dsh-spill-policy / dsh-scope）、
  `tools/code-dispatch-log`→`tools/ptc-dispatch-log`、`mode:'code'`→`'ptc'`、surfaceOp `{start,end}`→`{startSeq,endSeq}`、
  `images`→`attachments`（command-goal）、persona 配置 `text`↔`prefix/suffix`——全部为协议/配置破坏，勿借。

---

## (a) 每包增量分类 + (e) 每包裁决

| 包 | 分类 | 裁决 | 要点 |
|---|---|---|---|
| dsh-sandbox | noise | 不借 | 仅 import 归位（assertNever 来源） |
| dsh-sandbox-local | api | 不借 | 0.1.5 依赖包改名 `@deepseek-ai/node-addon-landlock-run`→`@deepseek-ai/node-addon-system`（libjs diff 头） |
| dsh-sandbox-policy | api | 不借 | 0.1.5 把 0.1.1 的 fold 迁回 `ctx.sessionProjections`（combined diff L414-443、L571-600 package.json 增 dsh-session-projection peerDep）；0.1.1 的 `effectiveSandboxMode(session.events)` 已是纯 fold，功能等价，无增量 |
| dsh-fs | api | 不借 | 0.1.5 在 FileSystem 基类新增 `processPathFromHostPath(hostPath)`（lib/index.js L83）；ARCH 侧 dsh-fs-local L749 实现、被 dsh-tmux-context/dsh-llm* 等调用，但 0.1.1 无任何消费方 → 借来是死代码 |
| dsh-fs-local | noise | 不借 | 0.1.5 新增命名函数 readByteWindow；0.1.1 已有等价的 range+abort 读（GLOB L387 FS_ABORTED 同线号），无功能差 |
| dsh-fs-sandbox | noise | 不借 | lib/index.js 逐字节相同；0.1.5 反而删除了 invariant.js 伴生（GLOB 保留） |
| dsh-fs-observation-policy | noise | 不借 | libjs=0，index.js 相同；仅 README/package.json（0.1.5 删 invariant 伴生 + 补 exports） |
| dsh-bash-local | stability | 部分借 | 0.1.5 把 spawn 失败注记改为**始终**并入 stderr（ARCH diff L80-98）；0.1.1 仅 stderr 为空时才显示（GLOB L302）→ 信息丢失修复；另 `installSettingsSection` 抽取（GLOB 已有该 helper，纯重构不借） |
| dsh-subprocess | api | 不借 | 0.1.5 把 `proxyEnvironmentForChild()`（dsh-http-proxy）合并进子进程环境；0.1.1 的 dsh-http-proxy **无此导出** → 依赖他组，不可独立借 |
| dsh-subprocess-local | api | 不借 | 0.1.5 为**整体重写**：systemd user scope（SystemdScopeOwner/probeLinuxNative/launchLinuxScope）+ spawn runner 协议 + dsh-win32-process 依赖；0.1.1 是 /proc+koffi+taskkill 检查器（LinuxProcessInspector 等）。平台模型不同，无小增量 |
| dsh-atomic-write | stability | 部分借 | 0.1.5 新增 Windows rename 瞬态错误（EACCES/EBUSY/EPERM）有界指数退避重试（ARCH diff L15-45）；GLOB L41 裸 rename。仅 Windows 生效（Linux 部署价值低） |
| dsh-schedule | api | 不借 | 0.1.5 用 `session.ownEvents()`+`SessionLogOffset`，0.1.1 用 `session.events`+`header.seedLength`（libjs diff）——会话模型迁移 |
| dsh-jobs | noise | 不借 | libjs=0，仅 README/版本 |
| dsh-jobs-local | noise | 不借 | 同上 |
| dsh-spill | noise | 不借 | 仅注释 |
| dsh-spill-local | stability | **借** | 0.1.5 新增**启动清理 sweep**（cleanupPeriodDays 默认 30；发现历史默认根、安全目录校验、过期删除、空目录/空根回收）+ `saveTextFile` 的 mkdir/open ENOENT 竞态重试循环（ARCH diff L108-123，GLOB L87 裸 open）——0.1.1 溢出文件永久累积 |
| dsh-spill-policy | api | 不借 | 0.1.5 事件改名 `tools/code-dispatch-log`→`tools/ptc-dispatch-log`（libjs diff）；协议耦合 |
| dsh-compaction | api | 不借 | 0.1.5 全为会话模型迁移：`session.eventAt(seq)`/`SessionSeq`/`snapshotEvents()`/`SurfaceManager`（libjs diff 全篇），并删 compaction/prune 校验 |
| dsh-compaction-basic | api | 不借 | 同上 + surfaceOp `{start,end}`→`{startSeq,endSeq}`（libjs L112-118）+ shadowedTokenCount 计量源变化（heuristicTokens↔tokens，L96-98） |
| dsh-compaction-tool-result-pruner | api | 不借 | eventAt→events[seq] 迁移 + surfaceOp 字段名 |
| dsh-credentials | noise | 不借 | 0.1.1 已去掉 brandString 品牌化（纯类型层） |
| dsh-credentials-local | noise | 不借 | libjs=0 |
| dsh-attachment | api | 不借 | 0.1.5 新增 `admitEncodedFile`/`admitPromptContent` 图像入提示管线（与 0.1.5 图像管线耦合，涉及他组） |
| dsh-attachment-local | noise | 不借 | 0.1.1 反而领先：低色数检测 + PNG palette + 归一化质量梯（NORMALIZATION_QUALITIES）；0.1.5 简化 |
| dsh-file-reference | noise | 不借 | 仅构建期装饰器样板差异 |
| dsh-file-reference-local | perf | 部分借 | 0.1.5: `DEFAULT_FILE_SEARCH_MAX_ENTRIES` 10k→**50k**、排除目录 2 个→**14 个**（补 dist/build/out/coverage/target/.next/.venv/__pycache__ 等）；GLOB L17/L19；索引失效机制两版分歧（settled 缓存 vs generation abort），不借 |
| dsh-skill | noise | 不借 | import 归位 |
| dsh-tool-skill | api | 不借 | 0.1.5 eventAt/SessionSeq 迁移（libjs diff）；`kind:"enter"` 在 0.1.1 已有 |
| dsh-skill-filesystem | noise | 不借 | libjs=0（0.1.5 README 提到 bundledSkillDir 但 lib 相同） |
| dsh-user-questions | api | 不借 | 0.1.1 领先：有 `registerProvider`+DUPLICATE_PROVIDER+restoreUserQuestionError；0.1.5 走 scopeTarget waterfall（新 scope API） |
| dsh-permission-presets | api | 不借 | 同 sandbox-policy：0.1.1 已是 fold（effectivePermissionPreset/applyKnobEvent/foldKnobs），0.1.5 迁回 sessionProjections |
| dsh-message-feedback | api | 部分借 | 结构分歧：0.1.1=storageDomain 持久表（inject storageDomain/sessionPersistence/sessions）+ 会话身份 CAS；0.1.5=会话事件 fold + zod 内联校验。仅 **category 字段**（FEEDBACK_CATEGORIES）是 0.1.5 增量，正交可借 |
| dsh-command-feedback | api | 部分借 | 0.1.5 新增 FEEDBACK_CATEGORIES 常量；0.1.1 有 sharing 门控文案（两版各有所长） |
| dsh-command-goal | api | 不借 | 0.1.5 schema `images`→`attachments` 改名（0.1.1 用 images，不升级则不动） |
| dsh-tools | api | 不借 | 0.1.5 全量重命名 code→ptc（事件 tool/code-dispatch-*、mode 枚举 'code'、ptc.js 模块）；getSectionOrder↔硬编码顺序（system-prompt 变更） |
| dsh-workflow | noise | 不借 | libjs=0 |
| dsh-workflow-worker-thread | noise | 不借 | 仅 import 来源变化 |
| dsh-goal-round-driver | stability | 不借 | 0.1.5 在 goal/changed pause 时取消运行中 agent + startsRequestSeries（ARCH diff）；但依赖 `ctx.agents.currentInitiator()` 与 `agent.cancel(…,{keepInbox:true})`，**0.1.1 dsh-agents 无这两个 API** → 不可独立借 |
| dsh-tmux-context | api | 不借 | 0.1.5 新增 typert Remote 绑定（RemoteError/bindTypertRemote），依赖 0.1.5 typert 协议 |
| dsh-shell | noise | 不借 | settingsNamespace helper（0.1.1 已有） |
| dsh-shell-env | api | 不借 | 0.1.1 领先：已注册 DSH_SESSION_JSONL 环境变量 provider |
| dsh-terminal | noise | 不借 | libjs=0 |
| dsh-terminal-bash | gui | 不借 | 0.1.5 引入 @xterm/headless 仿真器（渲染能力，GUI 侧） |
| dsh-headless | api | 不借 | 0.1.5 新增 agent/assistant-stream reasoning 转发（**SSE 帧协议**耦合）+ eventAt 迁移 |
| dsh-cmdline | stability | 部分借 | 0.1.5 新增 `exitOnStdinEnd` + `ctx.provide("appReady", host.ready)`（ARCH diff）；0.1.1 无 stdin EOF 退出 → 管道/非交互 stdin 关闭后可能挂起 |
| dsh-home-paths | noise | 不借 | libjs=0 |
| dsh-host-plugin-inventory | gui | 不借 | 0.1.5 list() 增 agentPresets 富化（GUI 能力，依赖 agent-presets） |
| dsh-scope | api | 不借 | 事件表：0.1.5 用 ptc-dispatch-log + agent/assistant-stream；0.1.1 用 code-dispatch-log |
| dsh-persona | api | 不借 | 0.1.1=单段 text/PERSONA_SECTION；0.1.5=prefix/suffix 两段（配置破坏，勿借） |
| dsh-launch-environment | api | 部分借 | 0.1.5 新增 `launchedThroughSsh` 辅助（SSH_CONNECTION/SSH_TTY 检测），10 行纯函数 |
| dsh-invariants | noise | 不借 | libjs=0 |
| dsh-storage | noise | 不借 | libjs=0 |
| dsh-storage-domain | stability | 部分借 | 0.1.5 新增 spec 校验（layout/compatibleVersions）+ **invalidRecords 'backup-and-skip'**（坏记录备份后跳过，不阻塞 domain 加载；GLOB L367/371 直接 throw） |
| dsh-storage-json | api | 不借 | 0.1.5 记录格式改带版本戳 `{version,record}`（改磁盘格式，迁移成本） |
| dsh-anonymous-user-id | noise | 不借 | libjs=0 |
| dsh-code-runtime | noise | 不借 | 仅注释 |
| dsh-code-runtime-worker-thread | noise | 不借 | import 归位 |
| dsh-tool-bash | noise | 不借 | 顺序常量 105（system-prompt 变更） |
| dsh-tool-fs | noise | 不借 | 0.1.1 的 REMEDIES 表已更通用（GLOB），0.1.5 反而特判两条——不借；顺序常量 100-102 |
| dsh-tool-fs-search | noise | 不借 | 0.1.5 加 win32 `-rg.exe` sidecar 路径（Linux 无关）+ 错误文案 |
| dsh-tool-web | stability | 部分借 | 0.1.5 新增 turndown `removeNonVisibleContent` 规则（过滤 SCRIPT/STYLE/hidden/display:none 等内容）+ `EXTERNAL_WEB_CONTENT_NOTICE` 不可信提示（GLOB L57 parts=[]） |
| dsh-tool-todo | api | 不借 | 0.1.5 invariant 加 turn/start-turn/end 边界校验（todo/write 必须在开轮内）——依赖 turn 事件+invariant 体系，低价值 |
| dsh-tool-goal | api | 不借 | 0.1.1 已有纯 fold openTurn；0.1.5 用 turnBoundary 投影——不借 |
| dsh-tool-ask-user | noise | 不借 | libjs=0 |
| dsh-tool-call-timeout-policy | noise | 不借 | 仅注释（FIXME 路径） |
| dsh-typert-loader | noise | 不借 | import 归位 |
| dsh-typert-protocol | api | 不借 | 协议分歧：0.1.5 RemoteError/remote-methods 描述符 vs 0.1.1 TypertLookupFailure/markers——跨版本 IPC 不兼容 |
| dsh-typert-registry | noise | 不借 | 参数改名 adapter→provider/binder |
| dsh-session-title | api | 不借 | 0.1.5 invariant 用 SessionSeq/eventAt 校验 messageSeqs（会话模型耦合） |
| dsh-session-title-llm | noise | 不借 | import 归位 |
| dsh-session-title-first-prompt-llm | noise | 不借 | libjs=0 |
| dsh-client-ui-message-feedback | gui | 部分借 | 0.1.5 UI 有分类 chips + FAILURE_COPY（version-conflict/note-too-large）；随 category 功能链一起借才有效 |

---

## (b) 值得借到 0.1.1 的候选

| id | 价值（一句话） | patch 面 | 与本地补丁冲突 | 风险 | 成本 | 优先级 |
|---|---|---|---|---|---|---|
| C1 | **spill-local 启动清理 sweep**：0.1.1 溢出文件在 tmpdir 永久累积（每个进程一个新 dsh-spill-* 根，永不回收），0.1.5 用 cleanupPeriodDays(默认30) 一次性清理历史根+过期文件+空目录 | dsh-spill-local/lib/index.js 新增 cleanup.ts 模块（ARCH diff L143-492：discoverDefaultRoots/sweepSpillRoots/resolveRoot 安全校验/生命周期 ctx.effect + Config.cleanupPeriodDays，ARCH L521-550）+ d.ts | 无 | 中：sweep 与并发 spill 写的竞态（0.1.5 自身处理了 ENOENT/ENOTEMPTY/安全目录）；**切勿同时引入 0.1.5 对 saveTextFile 的循环删除**（见 C2） | 大（>200 行，机械搬移） | P1 |
| C2 | **spill-local saveTextFile 的 mkdir/open ENOENT 重试**：目录在 mkdir 与 open 之间被外部删除时 0.1.1 直接失败 | dsh-spill-local/lib/index.js saveTextFile（GLOB L87 裸 open；ARCH for(;;) 循环 L108-123） | 无 | 低 | 小（~12 行） | P2 |
| C3 | **tool-web 抓取内容去噪**：turndown 过滤 SCRIPT/STYLE/隐藏节点 + display:none，省 token 且去垃圾；外加"外部内容不可信"提示 | dsh-tool-web/lib/index.js（ARCH diff：EXTERNAL_WEB_CONTENT_NOTICE + parts 构造 + removeNonVisibleContent 规则 ~L13-27；GLOB L57 parts=[]） | 无 | 低（行为性：转写结果变化） | 小（~30 行） | P2 |
| C4 | **file-reference-local 搜索索引调优**：排除目录 2→14（build/dist/.venv/__pycache__ 等），maxEntries 10k→50k | dsh-file-reference-local/lib/index.js L17/L19 两常量（ARCH diff） | 无 | 低（50k 上限抬内存/索引时间，可只借目录清单） | 小（2 常量） | P2 |
| C5 | **atomic-write Windows 原子替换重试**：rename 遇 EACCES/EBUSY/EPERM 有界退避重试（0.1.1 直接失败） | dsh-atomic-write/lib/index.js（GLOB L41；ARCH renameAtomicTemp L15-45） | 无 | 低（仅 win32 分支生效） | 小（<50 行） | P3 |
| C6 | **bash-local spawn 失败归因**：0.1.1 在 stderr 非空时丢弃 spawn 失败信息，0.1.5 始终并入 | dsh-bash-local/lib/index.js L275-302（ARCH 版 L80-98） | 无 | 低 | 小（~10 行） | P3 |
| C7 | **cmdline stdin EOF 干净退出**：非交互/管道下 stdin 结束即退出（需一并加 appReady 提供） | dsh-cmdline/lib/index.js provideCmdline 区（GLOB L26-29；ARCH 加 `ctx.provide("appReady", host.ready)` + exitOnStdinEnd） | 无 | 中：需 0.1.1 host 提供 `.ready`，交互场景语义需验证 | 中（<100 行） | P2 |
| C8 | **storage-domain 坏记录容错**：invalidRecords:'backup-and-skip'（备份并跳过，日志告警），0.1.1 一条坏记录让整个 domain 加载失败 | dsh-storage-domain/lib/index.js（GLOB L367/371 throw；ARCH spec 校验+backupRecord 分支）+ storage-json 配合 | 无 | 中：spec 新增字段需各后端/消费方配合，API 演进 | 中（<200 行） | P3 |
| C9 | **反馈分类（category）**：command-feedback FEEDBACK_CATEGORIES + message-feedback item.category + client-ui 分类 chips | dsh-command-feedback/lib/index.js 常量 + dsh-message-feedback spec/schema + dsh-client-ui-message-feedback 对话框（0.1.5 侧） | 无 | 中：0.1.1 存储行需 schema/版本升级；UI 需同步 | 中 | P3 |
| C10 | **launchedThroughSsh 辅助**：SSH 启动环境检测 | dsh-launch-environment/lib/index.js（ARCH diff） | 无 | 低 | 小（~10 行） | P3 |

## (c) 明显稳定性 bugfix 清单

1. dsh-spill-local/lib/index.js（GLOB L87）：无清理机制 → 溢出文件无限累积；0.1.5 补启动 sweep（ARCH cleanup.js）— **磁盘泄漏修复**。
2. dsh-spill-local/lib/index.js（GLOB L87）：saveTextFile 无 mkdir/open 竞态重试；0.1.5 补 for(;;) ENOENT 重试（ARCH L108-123）— **并发竞态修复**。
3. dsh-bash-local/lib/index.js（GLOB L302 `err.text.length > 0 ? err.text : consumeSpawnFailure()`）：stderr 非空时**丢弃 spawn 失败信息**；0.1.5 始终追加（ARCH L95-98）— **失败归因丢失修复**。
4. dsh-atomic-write/lib/index.js（GLOB L41 裸 rename）：Windows 瞬态 EACCES/EBUSY/EPERM 直接失败；0.1.5 有界退避重试（ARCH L15-45）— **Windows 稳定性修复**（Linux 部署低影响）。
5. dsh-storage-domain/lib/index.js（GLOB L367/371）：单条坏记录使整个 domain 加载 throw；0.1.5 backup-and-skip 容错 — **数据损坏容错**。
6. dsh-cmdline/lib/index.js（GLOB 无 stdin EOF 处理）：stdin 结束不退出；0.1.5 exitOnStdinEnd — **挂起修复**（需 appReady）。
7. dsh-tool-web/lib/index.js（GLOB L57 parts=[]）：无外部内容不可信提示、无隐藏内容过滤；0.1.5 补 notice + turndown 规则 — **内容卫生/安全提示**（非崩溃类）。
8. dsh-goal-round-driver/lib/index.js：0.1.5 goal/changed pause 时取消运行中 agent（ARCH diff）— 行为修复，但依赖 0.1.1 缺失的 agents API（currentInitiator/keepInbox），**不可独立借**。

## (d) 0.1.5 破坏性 API/接口变更（勿借项）

1. **dsh-tools**：mode 枚举 `'code'`→`'ptc'`、事件 `tool/code-dispatch-start|dispatch`→`tool/ptc-dispatch-*`、模块 code-mode.js→ptc.js——配置与事件协议双破坏。
2. **dsh-spill-policy / dsh-scope**：`tools/code-dispatch-log`→`tools/ptc-dispatch-log` 事件重命名（与 tools 联动）。
3. **dsh-compaction-basic / dsh-compaction-tool-result-pruner**：surfaceOp 字段 `{start,end}`→`{startSeq,endSeq}`。
4. **dsh-persona**：配置 `text`（单段）↔`prefix`/`suffix`（两段）。
5. **dsh-command-goal**：schema `images`→`attachments`。
6. **dsh-sandbox-local**：addon 依赖包 `@deepseek-ai/node-addon-landlock-run`→`@deepseek-ai/node-addon-system`。
7. **0.1.5 会话模型整体**：`session.events` 数组 → `eventAt/SessionSeq/snapshotEvents/ownEvents/SessionLogOffset/header.seedLength` + 重新引入 `ctx.sessionProjections`。凡依赖它的改动（compaction*/schedule/tool-goal/tool-skill/headless/session-title/sandbox-policy/permission-presets 的全部代码增量）一律**不可独立借**；0.1.1 的 fold 实现已存在且可用。
8. **dsh-subprocess-local**：后端整体重写（systemd scope + spawn-runner + dsh-win32-process 运行时依赖），非增量，借任何一块都要连带新运行模型。
9. **dsh-subprocess**：proxy 环境合并依赖 dsh-http-proxy 的 `proxyEnvironmentForChild` 导出，0.1.1 无 → 不可独立借（需他组配合）。
10. 系统提示顺序 API 漂移（tool-* 包 getSectionOrder↔硬编码 100-105/110）：属 dsh-system-prompt 变更，勿借。

## 证据行号索引（libjs/combined diff 内）

- spill-local 清理：dsh-spill-local.libjs.diff L143-492（cleanup 模块）、L520-550（Config/生命周期）、L105-123（saveTextFile 重试循环）。
- bash-local：dsh-bash-local.libjs.diff L66-118（spawnFailureNote）；GLOB lib L275-302。
- atomic-write：dsh-atomic-write.libjs.diff L15-45；GLOB lib L41。
- tool-web：dsh-tool-web.libjs.diff L1-27（notice/turndown 规则）；GLOB lib L57。
- file-reference-local：dsh-file-reference-local.libjs.diff L1-20（常量）；GLOB lib L17/19。
- storage-domain：dsh-storage-domain.libjs.diff L1-35（spec 校验、backup-and-skip）。
- sandbox-policy：dsh-sandbox-policy.combined.diff L329-447（fold→projection）、L571-600（peerDeps）。
- permission-presets：dsh-permission-presets.libjs.diff L1-30（fold 函数、inject 变化）。
- message-feedback：dsh-message-feedback.libjs.diff L1-60（zod fold vs spec/storageDomain）、L80-160（put/delete 实现分歧）。
- compaction 族：dsh-compaction.libjs.diff L290-316（eventAt→events[seq]）；dsh-compaction-basic.libjs.diff L110-120（surfaceOp 改名）、L92-100（token 计量）。
- tools：dsh-tools.libjs.diff L1-30（ptc/code 重命名、顺序常量）。
- goal-round-driver：dsh-goal-round-driver.libjs.diff L1-20（snapshotEvents）、L21-40（pause-cancel 依赖缺失 API）。
- cmdline：dsh-cmdline.libjs.diff L1-40（appReady/exitOnStdinEnd）；GLOB lib L26-29。
- dsh-fs：直接 diff（ARCH lib L83 processPathFromHostPath 基类；ARCH fs-local L749 实现）。
- dsh-fs-sandbox：直接 diff（lib 相同；ARCH 删 invariant.js）。
