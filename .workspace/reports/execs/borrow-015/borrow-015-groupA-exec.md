# borrow-015-groupA-exec.md — 0.1.5 扩展清单组 A 修订执行复核一体档报告

- 档期：2026-09-15（修订执行复核一体，路由 adam/deepseek-v4-flash）
- 素材：`~/.dsh/profiles-archive/web2-20260915-105429/node_modules/@deepseek-ai/`（ARCH = 0.1.5）
- 目标：`~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`（GLOB = 0.1.1 部署树）
- 依据：`.workspace/upstream-015-diff.md` §6.2/§6.4 + 深挖 notes G4/G5/G6 对应项
- 约束遵守：只写 `.workspace/deploy-015/` 与报告；未改 `~/.dsh`/`~/.npm-global` 目标树；未用 sandbox_permissions；未触碰 replay-lag-fix.sh；未触碰 5 既有补丁包（agent-loop/host-apiproxy/subagent/client-ui-subagent/web-search）

## 总裁决

**6/6 项落地完成（S14 为 partial：代码移植完成且向后兼容，功能激活依赖 launcher 配套）**。
全部 6 个 patch 已通过 `patch -p1 --dry-run` 对 pristine 0.1.1 副本可应用性校验，且 **patch 应用结果与 deploy-015 副本逐字节一致**（diff -rq IDENTICAL，六包全过），确保主代理集成时"apply patch = deploy 副本"。

## 每项明细

### S1 — spill-local 启动清理 sweep（P1）｜ status: **done**
- 目标包：`dsh-spill-local`（仅碰本包）
- diff 路径：`.workspace/deploy-015/patches/dsh-spill-local.cleanup-sweep-saveTextFile-retry.patch`（与 S11 同包合并一个 patch，两文件独立 hunk 段）
- 应用后完整副本：`.workspace/deploy-015/dsh-spill-local/`
- 移植面（对照报告值 ~200 行 + Config + d.ts）：
  - `lib/index.js`：新增 cleanup 模块（DEFAULT_ROOT_RE/SESSION_DIR_RE/warnSafely/isTrustedDirectory/rootIdentity/hasProtectedAncestors/resolveRoot/unlinkIdempotent/sweepSessionDir/sweepSpillRoots/discoverDefaultRootRecords/discoverDefaultRoots/gatherSweepRoots，取自 ARCH L107-456）；`LocalSpillStore.Config` 增加 `cleanupPeriodDays: z.number().step(1).min(0).default(30)`；构造器增加 `ctx.effect` 生命周期（启动 sweep + 卸载时 await quiesce）；新增 `runCleanup/gatherRoots/defaultRootsBase` 方法；`MS_PER_DAY` 常量；导出面同步 ARCH（+DEFAULT_ROOT_PREFIX/isErrno/discoverDefaultRoots/sweepSpillRoots）
  - `lib/types/cleanup.d.ts`（新增，ARCH 原样）；`lib/types/index.d.ts`、`lib/types/store.d.ts` 同步 ARCH
  - GLOB 本地补丁 `lib/invariant.js`/`invariant.d.ts` **未触碰**
- 锚点（集成用）：
  - `static Config = z.object({ root: z.string(), cleanupPeriodDays: ... .default(30) })`（index.js LocalSpillStore）
  - `ctx.effect(function* () { ... }, "spill-local cleanup sweep")` 构造器生命周期
  - `export { DEFAULT_ROOT_PREFIX, ..., sweepSpillRoots }` 导出行
  - 行为锚点：启动时回收 `dsh-spill-` 前缀历史根下 mtime > 30 天的溢出文件；`cleanupPeriodDays: 0` 关闭
- 备份/回滚要点：patch 逆应用即回滚；deploy 副本即应用后全量，可整目录回拷覆盖。无 schema 破坏（新 config 字段可选、有默认值）
- Linux 适用性：**适用**（POSIX uid/mode/sticky 检查；win32 分支 `process.platform === "win32"` 提前返回，安全降级为信任目录）
- 自复核：移植面 = 报告值 ✅；无新 peer 依赖（仅 node:fs/promises 等内建 + 既有 schemastery/cordis/dsh-spill）✅；node --check 通过 ✅；与 ARCH 语义 diff 仅 import 顺序/encodeSegment 书写风格差异 ✅

### S11 — spill-local saveTextFile ENOENT 竞态重试（P2）｜ status: **done**
- 目标包：`dsh-spill-local`（与 S1 同包同 patch）
- 移植面（对照报告 ~12 行）：`lib/index.js` `saveTextFile` 改为 ARCH `for(;;)` 循环——`mkdir(recursive)` 后 `open(path,"wx")` 捕获 ENOENT 重试（目录在 mkdir 与 open 间被并发删除）；新增 `isErrno` 助手（GLOB L87 裸 open → ARCH L108-123）
- 锚点：`async function saveTextFile(options)` 内 `for (;;)` + `if (isErrno(error, "ENOENT")) continue;`
- 备份/回滚：同 S1（同 patch 文件，逆应用回滚；如需只回滚 S11 可用 `git apply -R` 指定 hunk 或手工还原旧 saveTextFile）
- Linux 适用性：**适用**（POSIX 目录竞态同样存在；行为无平台差异）
- 自复核：移植面 = 报告值 ✅；S1 与 S11 独立成两个 S 项但同文件，patch 内 hunk 分离、报告分列 ✅；无新依赖 ✅

### S2 — ConnectionController 恢复增强（P1）｜ status: **done**
- 目标包：`dsh-client-connection`（仅碰 `lib/client.js`；`lib/index.js` 未动——G4-WS-1 心跳属他组范围，本组不碰）
- diff 路径：`.workspace/deploy-015/patches/dsh-client-connection.recovery-enhancement.patch`
- 应用后完整副本：`.workspace/deploy-015/dsh-client-connection/`
- 移植面（对照报告 client.js:32-138 控制器区）：重写 `ConnectionController`（GLOB 原 L8-147 区域，7 hunk 全部落在控制器区，消费者接线 L10296 未动）：
  - 恢复逻辑照搬 ARCH：`reconnect()` 手动重连（MANUAL_RECONNECT 哨兵中止 current/retryDelay、immediateRetry 重置）、`setNetworkAvailable()` 网络感知挂起（离线 `disconnected` 状态 + waitForAbort 挂起重试、网络恢复即重连）、`onReconnectRequested` sink、`retryDelay` 可中止退避（AbortController）、`backoffCap/backoffDelay` 拆分、`isRetryInterrupted`
  - 超时逻辑照搬 ARCH：`waitForReady` 就绪握手 3s 告警（generationReadyWarnMs）+ 15s 硬超时（generationReadyTimeoutMs）——替换 GLOB 的 `streamOpenTimeoutMs` 软超时（就绪可无限等 → 硬截止防挂死）
  - **transport 保持 0.1.1 双 SSE 流**：仍用 `this.api.events.mux({}, ac.signal, muxOpened)` + `this.api.events.host({}, ...)` 双流 pump + `this.api.host.describe({})` 就绪握手，仅把就绪抽象为 `reportReady(host)` + `ready/sourceLost` promise 竞速（符合报告"把 source 抽象为双流源+reportReady"）
  - 状态词兼容：保留 GLOB 消费者依赖的 `"reconnecting"`（L10296 消费者 `state === "reconnecting"` 清 description），新增 `"disconnected"/"connecting"` 状态仅透传，不破坏现有接线
- 锚点：`var ConnectionController = class`（新 L48）；`await Promise.race([waitForReady(ready, this.config, ac.signal), sourceLost])`；`this.sinks.onReconnectRequested?.()`；`config.generationReadyTimeoutMs`
- 备份/回滚：patch 逆应用即回滚；deploy 副本整目录覆盖可恢复
- Linux 适用性：**适用**（浏览器端 JS，平台无关）
- 自复核：移植面 = 报告值 ✅（仅控制器区，consumer/transport 未动）；无新依赖（bundle 内已含所需原语）✅；node --check ✅；patch 应用 = 副本一致 ✅；G4 note 警告"重连状态机行为变化需回归"→ 已保留 0.1.1 双流+describe 传输与 reconnecting 状态词，行为变化仅限恢复/超时语义（这正是目标）✅

### S3 — trajectory zh 字典 9 个英文值修复（P1）｜ status: **done**
- 目标包：`dsh-client-ui-trajectory`（仅碰 `lib/client.js` zh dict）
- diff 路径：`.workspace/deploy-015/patches/dsh-client-ui-trajectory.zh-dict-9values.patch`
- 应用后完整副本：`.workspace/deploy-015/dsh-client-ui-trajectory/`
- 移植面（对照报告 9 值）：zh dict 中 `toolbar.duration`/`useActualDuration`/`useEqualWidth`/`turns`/`expandTurns`/`collapseTurns`/`calls`/`expandCalls`/`collapseCalls` 9 个英文值 → ARCH 中文（时长/使用实际时长/使用等宽操作/轮次/展开所有轮次/收起所有轮次/调用/展开所有调用/收起所有调用）。en dict 不动；ARCH 新增的 kind.* 键**未引入**（超出最小移植面）
- 锚点：`const zh = { ... "toolbar.duration": "时长", ... }`（lib/client.js L52-61 区）
- 备份/回滚：patch 逆应用即回滚
- Linux 适用性：**适用**（纯字典字符串，平台无关）
- 自复核：恰好 9 值、en 未动 ✅；node --check ✅；无新依赖 ✅

### S10 — host-frontend-static base href + .gz MIME（P2）｜ status: **done**（gzip 预压缩标注未做）
- 目标包：`dsh-host-frontend-static`（仅碰 `lib/index.js`）
- diff 路径：`.workspace/deploy-015/patches/dsh-host-frontend-static.base-href-gz-mime.patch`
- 应用后完整副本：`.workspace/deploy-015/dsh-host-frontend-static/`
- 移植面（对照报告 index.js:46-92）：① MIME 表增加 `".gz": "application/gzip"`；② `renderIndex` 注入 `<base href="/">`（`replace(/<head...>/i, open => open + '<base href="/">')`，ARCH L84-86）。**authorizeIndex 未借**（依赖 0.1.5 BrowserAuth/connection 认证栈，0.1.1 无此服务，G4 明确不单独借）；**gzip 预压缩服务标注未做**（ARCH 侧也无独立预压缩逻辑，仅 MIME 表项；host-webserver gzip 属 G4-WEB-1 需新依赖 compression/negotiator，非本项面）
- 锚点：`".gz": "application/gzip"`；`<base href="/">` 注入行
- 备份/回滚：patch 逆应用即回滚
- Linux 适用性：**适用**（平台无关）
- 自复核：移植面 = 报告值 ✅（base href + MIME 两项齐全，gzip 预压缩如实标注未做）；node --check ✅；无新依赖 ✅

### S13 — file-reference-local 索引常量调优（P2）｜ status: **done**
- 目标包：`dsh-file-reference-local`（`lib/index.js` + `lib/types/search.js`，两处常量位点 + config fallback）
- diff 路径：`.workspace/deploy-015/patches/dsh-file-reference-local.index-constants.patch`
- 应用后完整副本：`.workspace/deploy-015/dsh-file-reference-local/`
- 移植面（对照报告两常量）：
  - `DEFAULT_FILE_SEARCH_MAX_ENTRIES`: `1e4` → `5e4`（lib/index.js L17）且 config fallback `maxEntries: config.maxEntries ?? 1e4` → `?? 5e4`（L290）——报告未列此第三处，但 ARCH 同步改了（ARCH L335 `?? 5e4`），属同一常量的必要一致性同步
  - `DEFAULT_FILE_SEARCH_EXCLUDED_DIRECTORIES`: `[".git","node_modules"]`（2 项）→ ARCH 清单（**15 项**含 .gradle：.git/node_modules/dist/build/out/coverage/target/.next/.nuxt/.turbo/.venv/__pycache__/.pytest_cache/.mypy_cache/.gradle）——报告写"2→14"，ARCH 实码为 **15 项**（含 `.gradle`），按 ARCH 实码移植并在此如实标注
  - `lib/types/search.js`（独立 `./search` 子模块入口，`DEFAULT_FILE_SEARCH_MAX_ENTRIES = 10_000` → `50_000` + 同清单）——报告最小面只提 lib/index.js 两常量，但 `./search` 子模块为同常量导出面，ARCH 同改，属一致性必要项
- 锚点：`DEFAULT_FILE_SEARCH_MAX_ENTRIES = 5e4`；`DEFAULT_FILE_SEARCH_EXCLUDED_DIRECTORIES` 15 项清单；`maxEntries: config.maxEntries ?? 5e4`
- 备份/回滚：patch 逆应用即回滚
- Linux 适用性：**适用**（平台无关）
- 自复核：核心两常量按报告落地 ✅；额外两处（config fallback、./search 子模块）为同一常量的 ARCH 一致性同步，已在报告中说明，不视为扩范围 ✅；node --check（index.js/search.js/index.js）✅；无新依赖 ✅

### S14 — cmdline stdin-EOF 退出（P2）｜ status: **partial**（代码移植 done，功能激活待 launcher 配套）
- 目标包：`dsh-cmdline`（仅碰 `lib/index.js` + `lib/types/index.d.ts`）
- diff 路径：`.workspace/deploy-015/patches/dsh-cmdline.stdin-eof-exit.patch`
- 应用后完整副本：`.workspace/deploy-015/dsh-cmdline/`
- 适用性核实（报告要求"需 0.1.1 host .ready——核实适用性，不适用则标注"）：
  - ARCH launcher `~/.dsh/profiles-archive/.../@deepseek-ai/dsh/lib/profile-boot-*.js` L285/317：`const appReady = createAppReady()` + `provideCmdline(hostCtx, { args, exit, ready: appReady.service })` + L342 `appReady.commit()`
  - **0.1.1 launcher `~/.npm-global/lib/node_modules/@deepseek-ai/dsh/lib/profile-boot-DG5t9aNs.js`（L250）只传 `{ args, exit }`，无 `ready`，也无 `createAppReady`/`commit`** → 0.1.1 host **不适用** `.ready`
- 移植处理：代码侧按 ARCH 完整落地（向后兼容）：
  - `provideCmdline` 增加 `if (host.ready !== void 0) ctx.provide("appReady", host.ready)`（守卫式，0.1.1 launcher 不传 ready 则不 provide，零行为变化）
  - 新增 `exitOnStdinEnd(ctx, label)`（stdin EOF → appReady.onReady 后 `exit(0)`；ctx.effect 清理；`stdin.readableEnded` 兜底）；`internals` 增加 `stdin`；导出 +`exitOnStdinEnd`；d.ts 同步（AppReady/AppStdin/CmdlineHost.ready）
- **标注：功能在 0.1.1 部署下不激活**——`exitOnStdinEnd` 若被调用会 throw（appReady 未 provide），而当前 0.1.1 树无任何消费者调用它（grep 全树 0 命中），故移植为"就绪但休眠"。激活需 launcher（dsh 包 profile-boot）配套 `createAppReady/commit/ready 传递`，**launcher 不在本组 6 包范围**，交主代理裁决是否另开档
- 锚点：`if (host.ready !== void 0) ctx.provide("appReady", host.ready)`；`function exitOnStdinEnd`；`export { exitOnStdinEnd, ... }`
- 备份/回滚：patch 逆应用即回滚（0.1.1 现状零影响）
- Linux 适用性：**适用**（stdio 管道 EOF 语义 Linux 优先；win32 平台无差异，非 no-op）
- 自复核：移植面 = 报告值 ✅（代码全量，含 appReady 提供与 exitOnStdinEnd）；适用性结论如实标注 partial ✅；无新依赖 ✅；node --check ✅

## 自复核（统一）

1. **移植面逐项 = 报告值**：S1/S11/S2/S3/S10/S13/S14 全部按 §6.2 最小移植面落地；S13 追加 2 处同常量一致性位点、S14 标注 partial，均有说明 ✅
2. **无新 peer 依赖**：六包改动仅用 node 内建（fs/promises、path、os、crypto）+ 包内既有依赖（schemastery、cordis、dsh-spill、dsh-file-reference）✅
3. **避开 5 既有补丁包**：agent-loop / host-apiproxy / subagent / client-ui-subagent / web-search 均未触碰 ✅
4. **与在跑档文件不重叠**：本组只碰 dsh-spill-local、dsh-client-connection/lib/client.js、dsh-client-ui-trajectory、dsh-host-frontend-static、dsh-file-reference-local、dsh-cmdline 六包；`dsh-client-connection/lib/index.js`（G4-WS-1 心跳面）未动、`dsh-host-webserver`（G4-WEB-1 gzip）未动、launcher（dsh 包）未动 ✅
5. **验证命令**：全部改动文件 `node --check` 通过；6 个 patch 对 pristine 0.1.1 副本 `patch -p1 --dry-run` 全过；patch 实应用结果与 deploy 副本 `diff -rq` 六包 IDENTICAL ✅
6. **未改 replay-lag-fix.sh** ✅；未写 `~/.dsh`/`~/.npm-global` ✅

## 问题清单（无阻塞，交主代理）

1. **S14 partial**：功能激活需 launcher（dsh 包 profile-boot）增加 `createAppReady`/`ready: appReady.service`/`appReady.commit()`——launcher 不在本组范围。建议：若采纳 S14，另开一小档或由主代理在集成时一并处理；不采纳则本 patch 保持休眠态零影响。
2. **S13 报告值偏差**：报告写"排除目录 2→14"，ARCH 实码 15 项（含 `.gradle`），已按实码移植。集成锚点按 15 项清单核对。
3. **S1 与 S11 同包合并单 patch**：集成时两个 S 项共享一个 patch 文件（hunk 内独立段），如需分开部署可 `patch -p1 < file --forward` 后手工裁剪，或直接整包应用。
4. **S2 行为回归提示**（G4 note 预置）：重连状态机变化建议集成后做一次断网/恢复手动回归；双 SSE 传输与 reconnecting 状态词已保留，预期兼容。

## 集成锚点表（供主代理统一集成）

| S | 目标包 | diff 路径（deploy-015/patches/） | 锚点（grep 即验） | 状态 |
|---|---|---|---|---|
| S1 | dsh-spill-local | dsh-spill-local.cleanup-sweep-saveTextFile-retry.patch | `cleanupPeriodDays` Config；`ctx.effect(function* ..., "spill-local cleanup sweep")`；导出 `sweepSpillRoots` | done |
| S11 | dsh-spill-local | 同上（同包合并） | `saveTextFile` 内 `for (;;)` + `isErrno(error, "ENOENT")` | done |
| S2 | dsh-client-connection | dsh-client-connection.recovery-enhancement.patch | `waitForReady(ready, this.config, ac.signal)`；`onReconnectRequested?.()`；`generationReadyTimeoutMs` | done |
| S3 | dsh-client-ui-trajectory | dsh-client-ui-trajectory.zh-dict-9values.patch | zh dict `"toolbar.duration": "时长"` 等 9 值 | done |
| S10 | dsh-host-frontend-static | dsh-host-frontend-static.base-href-gz-mime.patch | `".gz": "application/gzip"`；`<base href="/">` | done（gzip 预压缩未做，标注） |
| S13 | dsh-file-reference-local | dsh-file-reference-local.index-constants.patch | `5e4`；15 项 EXCLUDED 清单 | done |
| S14 | dsh-cmdline | dsh-cmdline.stdin-eof-exit.patch | `if (host.ready !== void 0) ctx.provide("appReady", ...)`；`exitOnStdinEnd` 导出 | **partial**（launcher 无 .ready，休眠态） |

全部 patch 均可 `patch -p1` 于 `~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/<pkg>/` 目录直接应用；应用后与 `.workspace/deploy-015/<pkg>/` 逐字节一致，可用 `diff -r` 校验部署。
