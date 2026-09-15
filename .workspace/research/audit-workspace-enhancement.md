# dsh-workspace-enhancement 源码级审计报告

> 审计对象：npm 包 `dsh-workspace-enhancement`（GitHub: https://github.com/DobyChao/dsh-workspace-enhancement）
> 审计目标宿主：本机 `@deepseek-ai/dsh` **0.1.1-rc.2**（全局安装于 `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/`，其全部子包同为 0.1.1-rc.2，`@deepseek-ai/cordis` 4.0.2）
> 审计方式：源码级（git clone 完整读码 + 与本机子包 `lib/*.d.ts` / `lib/index.js` 逐一比对 + npm registry 元数据核验）
> 日期：2026-09-14
> 克隆位置：`/home/CNS2026495165/dsh/.workspace/repos/dsh-workspace-enhancement`（`git clone --depth 50`）

---

## 1. 仓库与来源

| 项 | 证据 |
|---|---|
| 默认分支 | `master`（`git branch -a` → `* master`；`docs/rounds/R25-v0.1.4-release.md` 记录 0.1.3 期从 `main` 改为 `master`） |
| 最新 commit | `ee25ed1969e0accd256adda48fdb3b57b7aa44ce`「chore: prepare npm v0.1.4 release (#17)」2026-09-13 15:41:32 +0800（`git log -5`） |
| LICENSE 文件 | 存在 `LICENSE`（1077B），**MIT**，「Copyright (c) 2026 dsh-ssh contributors」。npm registry 5 个版本 license 字段均为 MIT（curl registry.npmjs.org 核验）→ **仓库与 npm 声明一致（MIT）**，注意版权人写的是「dsh-ssh contributors」而非作者 DobyChao |
| tags / releases | tag 5 个：`v0.1.0`~`v0.1.4`，与 npm 5 个发布版本一一对应（tag 提交日期 vs npm publish 日期相差 ≤1 天：npm 0.1.0=08-26 / tag=08-27；0.1.4=09-13 / tag=09-13）。GitHub Releases 页存在（`.atom` 流返回 5 条 release，v0.1.0~v0.1.4 + 一条 backup-docs 条目）；GitHub API 被 rate-limit 未取到 release 对象详情 |
| README 声明功能 | 见 §2；README 自带「版本兼容表」——**明确宣称只支持 0.1.5 线（0.1.4+）、0.1.2-rc.1 线（0.1.3）、其余更老线「从未支持」**（README.md「Compatibility」表；README.zh.md 同） |
| 维护活跃度 | 50 个 commit 覆盖 2026-08-26 ~ 2026-09-13（浅克隆上限）；版本节奏：08-26→08-28→08-31→09-09→09-13，约 3-18 天/版；单测 259 例（CHANGELOG 0.1.3） |

---

## 2. 功能面（它到底增强什么）

**一句话：SSH 远程开发 + 多工作区。** 通过**替换 host 的 `ctx.subprocess` / `ctx.fs` 为「本地↔SSH 混合 provider」**，让所有已走这两个接缝的官方工具（bash、fs 工具等）无需改代码即可在远程主机执行；另有独立的模型工具、机器注册表、TOFU 主机指纹、OS 钥匙串密码、浏览器端添加工作区 UI 与设置页。

### 2.1 注册的 host 侧工具（模型可见）

| 工具名 | 参数 | 作用 | 实现文件 |
|---|---|---|---|
| `sw_status` | `{}`（无参） | 活动连接/工作区/连接状态/主机指纹/后端/远程 env 汇总 | `src/tools.ts:434`（defineTool 定义）、`src/registry.ts`（状态源） |
| `sw_connect` | `machines: string[]`（必填） | 把**本会话**接到已注册机器集合（`[]`=全断；未知 id 抛错；全不可达抛错且不半应用）——注意 **0.1.4 起不再注册机器/不收凭据**（破坏性变更，CHANGELOG 0.1.4） | `src/tools.ts:472`、`src/session-connections.ts`（store） |
| `sw_pick_workspace` | `path: string`（必填，POSIX 绝对路径） | 把活动机器的工作区切到远程某目录（SFTP stat 校验是目录） | `src/tools.ts:536` |
| `sw_exec` | `command`、`description`（必填）+ `timeoutMs`、`workdir`、`server`、`run_in_background`（可选） | 在**指定已注册机器**上执行命令；目标 OS 每次连接探测一次（POSIX `bash -c` / win32 `pwsh -Command`，`src/exec-tools.ts:229-236`、`buildShellArgv` 同文件 :252）；0.1.4 增加会话连接门（`requireConnectedServer`）+ 可后台（依赖 `ctx.jobs`） | `src/exec-tools.ts:928`（注册 :1042） |
| `bash` | `command`、`description` + `timeoutMs`、`workdir`、`run_in_background` | **仅 win32 宿主**注册的 `bash` 工具（官方 bash 工具在 POSIX 已拥有 `bash` 名，重复注册会失败；win32 无官方 bash，故补此缝供远程 Linux 工作区用） | `src/exec-tools.ts:1108`（注册 :1231） |

### 2.2 注册的 host 侧服务（cordis 服务/接缝，非模型工具）

| 服务名 | 类型 | 作用 | 实现文件 |
|---|---|---|---|
| `ctx.ssh` | `SshRuntime` | 连接所有者：ProxyJump 链、TOFU、SFTP/exec 共享连接 | `src/runtime.ts:114-118` |
| `ctx.sshRegistry` | `SshRegistry` | 机器注册表（machines.json 持久化、`~/.ssh/config` 解析、TOFU known_hosts、钥匙串） | `src/registry.ts:304-308` |
| `ctx.sideWorkspaces` | `SessionSideWorkspaceStore` | 会话副工作区声明清单（挂/卸/改名） | `src/session-workspaces.ts:473-477` |
| `ctx.sessionConnections` | `SessionMachineConnections` | 会话级已连接机器集合（sw_connect / 面板写入） | `src/session-connections.ts:237-241` |
| `ctx.subprocess` / `ctx.fs`（**替换官方实现**） | `MixedSubprocessRuntime` / `MixedFileSystem` | 按 cwd 路由：`ssh://` 或 `dsw-routes/` 占位树 → SSH（远端），否则 → 本地 provider（LocalSubprocessRuntime / SandboxedFileSystem / LocalFileSystem） | `src/plugin.ts:98-151`、`src/mixed.ts` |
| `ctx.connection` 上的浏览器通道 | `/api/dsw/*`（0.1.4）/ `/dsw`（≤0.1.3） | 连接列表/状态/重连/远程目录 browse/会话连接端点 | `src/web.ts`、`src/web-channel.ts` |
| systemPrompt 段/上下文 | `sw-remote`（order 90）、`dsw-session-workspace`（order 90）、`tool:sw-exec`、`tool:bash` | 按会话注入远程/副工作区提示；本地零连接会话零注入 | `src/tools.ts:608-635`、`src/exec-tools.ts:1044-1056, 1230-1243` |

### 2.3 settings/schema 项（cordis Config）

| 行 | Config 字段 | 文件:行 |
|---|---|---|
| ssh 聚合行 | `host/port/username/password/privateKeyPath/passphrase/agent/cwd/strictHostKeyChecking/knownHosts/readyTimeout/…`（`src/runtime.ts` ResolvedConfig） | cordis.patch.yml `ssh-remote` 行 |
| registry 行 | `stateFile/machinesFile/knownHostsFile/secretsDir/hostKeyMode/statusTtlMs/host/port/username/password/privateKeyPath/passphrase/agent/cwd/strictHostKeyChecking/knownHosts` | `src/registry.ts:667-684` |
| web 通道行 | `stateFile/maxEntries`（默认 1000） | `src/web.ts:83-86` |
| picker 行 | `maxEntries`（默认 1000）/`remoteLabel`/`localLabel` | `src/picker.ts:127-131` |
| bundle patch | 禁用官方 `directory-picker-auto`、`subprocess-local`、`fs-sandbox` 三行，插入 `ssh-remote`/`directory-picker-ssh`/`ssh-web-channel` | `cordis.patch.yml`（仓库根） |

---

## 3. 架构

**是完整的三段式**：host 插件（cordis 服务 + `ctx.tools.register` + systemPrompt 段）＋ client 注入（`dsh.client.inject` 声明 + `exports["./client"]` bundle）＋ slot 注册（client 侧 `ctx.slots.inject/register`）。

### 3.1 host 侧入口与依赖

- 入口 `src/index.ts:32` `export { apply } from './plugin.ts'`；`src/plugin.ts:158-193` `apply()`：`ctx.plugin(SshRuntime, config)` → `forceRemoteSandboxMode` → `registerRemoteApprovalAnswerer` → `installMixedProviders`（构造 Local* 类 + `SshSubprocessEngine`，`ctx.set('subprocess', MixedSubprocessRuntime)`、`ctx.set('fs', MixedFileSystem)`，sandboxPolicy 存在时在 `ctx.inject(['sandboxPolicy'])` 内构造）。
- 依赖服务（`ctx.get`/`ctx.inject`）：`ssh`、`sshRegistry`、`sideWorkspaces`、`sessionConnections`、`subprocess`、`fs`、`jobs`（后台）、`approval`/`agents`（审批门，可选）、`sandboxPolicy`、`connection`（浏览器通道）。
- 工具注册：`src/tools.ts:573` / `src/exec-tools.ts:1042,1228` `ctx.tools.register(tool)`，全部 `ctx.effect` 绑定可逆卸载。

### 3.2 client 侧注入与 slot

- 包声明：`package.json` `dsh.client = { inject: ["@deepseek-ai/dsh-client-connection","@deepseek-ai/dsh-client-locale","@deepseek-ai/dsh-client-runtime","@deepseek-ai/dsh-client-ui-conversation","@deepseek-ai/dsh-client-ui-sidebar","@deepseek-ai/dsh-client-ui-workspace"], platform: "web" }`；`exports["./client"]` → `lib/client.js`。
- client 入口：`src/client/index.ts`；client 侧 `inject = ['slots', 'workspaces', 'sessions', 'locale']`（`src/client/index.ts:155`）。
- **slot 名称字符串（原文引用，全部在 `src/client/index.ts`）**：
  - `'conversation.hero.workspace.directoryFlow'`（:201，注册 :204）
  - `'sidebar.workspaces.directoryFlow'`（:202，注册 :207）
  - `'settings.section'`（:210，注册 :212，id=`dsh-workspace-enhancement`，order 40）
  - `'conversation.session.header.actions'`（:223，注册 :225，id=`dsh-workspace-enhancement-side`，order 25）
  - `'conversation.session.header.utilities'`（`src/client/remote-status.ts:44` `REMOTE_STATUS_SLOT`，注册于 index.ts:240-241）
- client 组件：`SshWorkspaceFlow`（flow.tsx，连接侧栏+目录浏览器）、`RemoteWorkspaceSettingsPage`（settings.tsx，机器设置页）、`SideWorkspacesAction`（side-workspaces.tsx，⊕工作区按钮）、`RemoteStatusAction`（remote-status-entry.tsx，头部远程状态格）、row-badges（sidebar 行徽标，DOM 兼容层）。
- 本地目录浏览走 `ctx.get('uiWorkspace')`（**0.1.4 新增**，`src/client/local-directory.ts`）或 `ctx.workspaces.listDirectory`（0.1.2/0.1.3）；远程浏览走自建 `/dsw` 或 `/api/dsw` RPC 通道（`web-channel.ts`）。
- 事件总线：`approval/request`（prepend 监听，AI answerer，`src/remote-approval-gate.ts:553`）、`session/created`（`src/plugin.ts:79`）。

---

## 4. ssh2 到底用来干什么（重要）

**ssh2 是核心引擎，不是边角**：它实现「远程主机 SSH 通道」——完整的多跳（ProxyJump 链）、SFTP 文件系统、远程子进程（exec）与 PTY 终端。

- `import { Client } from 'ssh2'`（`src/ssh-core.ts:18-19`）。
- **能力边界**：
  - **多跳 ProxyJump 链**：`src/ssh-core.ts:183` `openChain()`——逐跳连接、每跳 host-key 校验、失败回滚；`src/ssh-core.ts:175` 用 `client.forwardOut('127.0.0.1', 0, host, port, …)` 打通跳板直连通道。
  - **命令执行**：`client.exec(text, { pty: false }, …)`（`src/ssh-core.ts:260`）；`src/exec-tools.ts:392` `connection.exec(command, opts)`；`sw_exec` / win32 `bash` / 官方 bash/pwsh 经混合 provider 的 `SshSubprocessRuntime.spawn` 落到远端。
  - **SFTP 文件传输**：`src/filesystem.ts` 全量 SFTP 操作——`lstat`(:208)、`createReadStream`(:259,:284)、`readdir`(:325)、`stat`(:438)、`readFile`(:460)、`mkdir`(:512)、`writeFile`(:516)（staging+rename 原子写）；`ssh2` 的 `ext_openssh_rename` 同步抛错处理在 :536。
  - **PTY 终端**：`src/terminal.ts:134` `client.shell({ term: 'xterm-256color', rows, cols }, …)`，投影为 `ctx.subprocess.spawnTerminal` 的 `SubprocessTerminalHandle`（写 stdin、信号、无 foreground 进程组 `inspectForeground` 返回 undefined）。
  - **未实现**：端口转发（local/reverse）——`docs/decisions/ADR-0005-defer-port-forwarding.md` 明确延后（`sw_forward` 工具不存在）；无串口；无 `socks`。
- 认证：密码（OS 钥匙串 `src/credential.ts`）、私钥、agent、`~/.ssh/config` 解析（`src/registry.ts` `SshConfigBlock` :81-87）、TOFU 主机指纹（`src/hostkey.ts`，默认 `accept-new`）。
- 安全附加层（0.1.4）：远程命令审批门（`src/remote-approval-gate.ts`，默认 `off`；`human` 每条问人、`ai` 白名单自动放行）、远端 sandbox 围栏（`src/remote-sandbox-fence.ts`、`src/remote-sandbox.ts`，逐机器 `remoteSandbox` 档位，默认 off）。

---

## 5. 对本部署（0.1.1-rc.2）的 API 差异清单

方法：把插件 **v0.1.4**（当前 HEAD）全部 `@deepseek-ai/*` 具名导入（脚本全量提取，含行号）与本机 0.1.1-rc.2 子包 `lib/index.js` 运行时导出 + `lib/types/*.d.ts` 类型导出逐一比对。类型面核对：`dsh-fs/lib/types/index.d.ts`、`dsh-subprocess/lib/types/index.d.ts`、`dsh-tools/lib/types/index.d.ts` 等。

### 5.1 运行时导入（值导入）对比

| 导入符号 | 插件版本 | 本机 0.1.1-rc.2 是否存在 | 签名一致 | 说明 |
|---|---|---|---|---|
| `Context` / `Service`（@deepseek-ai/cordis） | 全版本 | ✅ | ✅ | 本机 cordis 4.0.2（26 导出） |
| `defineTool` / `TOOL_ABORTED` / `parameterSchemaSpecToJsonSchema`（dsh-tools） | 全版本 | ✅ | ✅ | rc.2 导出齐全；`ToolRuntime.register(def)` 存在（`dsh-tools/lib/index.js:2762`） |
| `HarnessError`（dsh-llm） | ≥0.1.1 | ✅ | ✅ | rc.2 导出 |
| `setSandboxMode`（dsh-sandbox-policy） | ≥0.1.1 | ✅ | ✅ | `dsh-sandbox-policy/lib/index.js:54` `session.append('sandbox/mode', {mode})`；rc.2 `Session.append(type, data, …)` 存在（`dsh-session/lib/types/index.d.ts:212`） |
| `SENSITIVE_ENV_PATTERN` / `SubprocessRuntime`（dsh-subprocess） | 全版本 | ✅ | ✅ | rc.2 导出（`dsh-subprocess/lib/types/index.d.ts`） |
| `LocalSubprocessRuntime`（dsh-subprocess-local） | ≥0.1.1 | ✅ | ✅ | rc.2 导出 |
| `LocalFileSystem`（dsh-fs-local） | ≥0.1.1 | ✅ | ✅ | rc.2 导出 |
| `SandboxedFileSystem`（dsh-fs-sandbox） | ≥0.1.1 | ✅ | ✅ | rc.2 导出 |
| `FileSystem` / `FsError` / `FsTargetKey` / `FsVersion`（dsh-fs） | 全版本 | ✅ | ✅ | rc.2 导出 |
| `DirectoryPicker` / `DirectoryPickerError`（dsh-host-directory-picker） | 全版本 | ✅ | ✅ | rc.2 导出；`ctx.directoryPicker` 接缝存在（`dsh-host-directory-picker/lib/types/index.d.ts:108-109`） |
| `pickNativeDirectory`（dsh-host-directory-picker-native） | 全版本 | ✅ | ✅ | rc.2 导出 |
| `MAX_TIMER_DELAY_MS`（dsh-timeout） | 全版本 | ✅ | ✅ | rc.2 导出 |
| `Session`（type，dsh-session） | ≥0.1.1 | ✅ | ✅ | rc.2 `Session` 类；`session/created` 事件存在（`dsh-session/lib/types/index.d.ts:44`） |
| z（schemastery default） | 全版本 | ✅ | ✅ | rc.2 schemastery 3.18.2 |
| `LocaleDictOf` / `TranslateNS`（dsh-client-ui-slots） | 全版本 | ⚠️ 类型面存在 | — | **该包未安装在本机全局树**，但仅作 client 构建期类型（devDependency），运行时不 import 其值；rc.2 各 client-ui 包 peerDeps 声明 `@deepseek-ai/dsh-client-ui-slots@^0.1.1-rc.2`，即该包属 rc.2 家族、构建期解析 |
| `pickNativeDirectory` 等（上述） | — | — | — | — |

### 5.2 类型导入（type-only，运行时不加载，但 typecheck 需要）

`dsh-fs`：`FsDirEntry/FsEditOutcome/FsEditRequest/FsInfo/FsPathInfo/FsTarget/FsWriteIntent/FsWriteOutcome`（`src/filesystem.ts:16`、`src/mixed.ts:24`）——rc.2 `dsh-fs/lib/types/index.d.ts` **全部存在**（export type 行含全部 8 个 + `FsErrorCode/FsObservation`）。✅

`dsh-subprocess`：`CollectedOutput/SubprocessCollect/SubprocessHandle/SubprocessOutcome/SubprocessOutputMode/SubprocessOutputRead/SubprocessOutputReader/SubprocessSpawnSpec/SubprocessTerminalForeground/SubprocessTerminalHandle/SubprocessTerminalSignal/SubprocessTerminalSpawnSpec`——rc.2 `dsh-subprocess/lib/types/index.d.ts` **全部存在**。✅

`dsh-tools`：`ParameterSchemaSpec/ToolDefinition/ToolRunContext`——rc.2 存在；`ToolRunContext extends ToolExecution`（`dsh-tools/lib/types/index.d.ts:283`），`ToolExecution.agent?: Agent`（:207）存在——插件靠 `exec.agent` 取会话（`src/tools.ts:388-394`）✅。

`dsh-host-directory-picker`：`DirectoryEntry/DirectoryListing/DirectoryPickerBrowseCapability/DirectoryPickerCapability`——需核对 rc.2 类型（见 5.4 备注）。

### 5.3 host 侧服务/API 关键比对（重点）

| 插件使用的 API（0.1.4） | 插件版本 | rc.2 是否存在 | 结论 |
|---|---|---|---|
| `ctx.systemPrompt.section({name,order,text})` / `.context(...)` | 全版本 | ✅ | rc.2 `SystemPrompt.section` :187、`context` :194（`dsh-system-prompt/lib/types/index.d.ts`）；`AssembleContext.scope?: ScopeKey` :42，且 rc.2 `dsh-agent/lib/index.js:384-390` `assembleContextFor(agent)` 返回 `{agent, scope: agent}`——插件「scope 即 agent、agent.session.header.{cwd,id}」假设成立 ✅ |
| `ctx.tools.register(def)` | 全版本 | ✅ | `dsh-tools/lib/index.js:2762` |
| `ctx.connection.rpc.handle('/dsw', dispatch, {authority:'loopback'})` | 0.1.2/0.1.3 | ✅ | rc.2 `HostConnectionRpc.handle`（`dsh-client-connection/lib/types/rpc.d.ts`）；`inject=["webServer"]`（`lib/index.js:479`）→ `owner.webServer.register(route)` 可读 ✅ |
| `ctx.connection.fetch.register(route)`（`/api` 精确路由） | **仅 0.1.4** | ❌ **不存在** | rc.2 `HostConnectionRpc` 只有 `handle` + `intercept`（`dsh-client-connection/lib/types/rpc.d.ts`；`lib/index.js:219-224`），**没有 `fetch` 成员** → 0.1.4 的 `src/web.ts:702` `ctx.connection.fetch.register(route)` 在本机**直接抛 TypeError，web 行起不来**（数据面全部不可用） |
| `rpc.intercept('/api', …)` | 0.1.2 曾用？ | ⚠️ 被占 | rc.2 `dsh-api-gateway/lib/index.js:62` 已单占位 `intercept('/api')`；`registerInterceptor` 对已有 interceptor 抛「already has an interceptor」——不可复用（这正是兼容性文档 F2 描述的 0.1.5 教训，rc.2 同理） |
| `setSandboxMode(session, 'danger-full-access')` | ≥0.1.1 | ✅ | rc.2 `dsh-sandbox-policy/lib/index.js:54` |
| `ctx.get('subprocess', false)` / `ctx.get('jobs', false)` / `ctx.get('approval', false)` | 全版本 | ✅ | rc.2 服务名 `subprocess`（dsh-subprocess d.ts Context 增广）、`jobs`（dsh-jobs）、`approval`（dsh-user-approval）均存在 |
| `ctx.on('session/created', …)` | ≥0.1.1 | ✅ | rc.2 `dsh-session/lib/types/index.d.ts:44` |
| `ctx.inject(['sandboxPolicy'], …)` | ≥0.1.1 | ✅ | rc.2 `ctx.sandboxPolicy`（`dsh-sandbox-policy/lib/types/index.d.ts:27`） |
| `ctx.webServer.register(route)`（经 connection.handle 间接） | ≤0.1.3 | ✅ | rc.2 `dsh-client-connection/lib/index.js:257` |
| 混合 provider 语义：`LocalSubprocessRuntime(ctx)`、`SandboxedFileSystem(ctx, config)`、`LocalFileSystem(ctx, config)` 构造 | ≥0.1.1 | ✅ | rc.2 同名类、同构造 |
| FileSystem 接缝方法集 | 全版本 | ✅（13 方法） | rc.2 抽象成员 13 个（resolve/processPath/processPathFromHostPath/fileUrl/contains/stat/lstat/readText/streamText/readBytes/listDir/writeText/editText）；插件 0.1.3/0.1.4 门面实现 13~14 个（含 `readByteRange` 为 0.1.5 新增的第 14 个，`src/mixed.ts:163-204`；rc.2 无此抽象成员 → 多实现一个方法无害）✅ |

### 5.4 client 侧关键比对（浏览器端）

| 插件用法 | 版本 | rc.2 是否存在 | 证据 |
|---|---|---|---|
| `dsh.client` 声明（inject/platform/exports["./client"]） | 全版本 | ✅ | rc.2 `dsh-client-modules/lib/index.js:119-145` 校验同形 |
| slot：`conversation.hero.workspace.directoryFlow` / `sidebar.workspaces.directoryFlow` | 全版本 | ✅（kind=single） | rc.2 slot 目录（`dsh-cordis-client-runner/lib/client.js`，48 条） |
| slot：`settings.section` / `conversation.session.header.actions` / `conversation.session.header.utilities` | 全版本 | ✅（kind=list） | 同上 |
| `ctx.slots.inject/register` + 选项 `name/id/order/label/locale/inject` | 全版本 | ✅ | rc.2 SlotCore `StoredEntry.options` 含 `locale/id/order/label`（`dsh-cordis-client-runner/lib/client.js:1953-1964`）；`slots` 服务在 rc.2（`dsh-client-runtime/lib/client.js:35 super(ctx,'slots')`）；`installLocale` 由 dsh-client-locale 调用（`dsh-client-locale/lib/client.js:1231`）→ `t` seat 可用 |
| `ctx.locale.register/bind/subscribe` | 全版本 | ✅ | rc.2 `dsh-client-locale/lib/client.js:1121/1144/1085`；`register(ns, dicts)` 双参形式兼容 |
| `ctx.workspaces.listDirectory/createDirectory`（0.1.2/0.1.3 客户端） | 0.1.2/0.1.3 | ✅ **正是 rc.2 的 API** | rc.2 官方 browse picker 就用它（`dsh-client-ui-directory-picker-browse/lib/client.js:1022-1023`）；实现于 `dsh-client-runtime/lib/client.js:9965/9976`，返回 `{path,home,crumbs,entries,truncated}` 与插件 WireListing 形状一致 |
| `ctx.get('uiWorkspace')`（0.1.4 客户端本地目录座） | **仅 0.1.4** | ❌ **rc.2 无此服务** | 全库 grep `uiWorkspace` 零命中（`grep -rl uiWorkspace $B/` 为空）；rc.2 里目录浏览能力在 **`ctx.workspaces`** 服务上（见上行）。0.1.4 的本地目录窗格在 rc.2 上**静默降级**为「目录服务不可用（uiWorkspace 未挂载）」一行文案（`src/client/index.ts:177-180` 懒解析 + `src/client/local-directory.ts:60-71` 守卫），其余 UI 不受影响 |
| `ctx.workspaces.list`（快照 feed，row-badges） | 全版本 | ✅ | rc.2 `workspaces.list`（`dsh-client-runtime/lib/client.js:269`、slots hostFace） |
| `ctx.sessions.list` / `ctx.connection.rpc.call('/api', …)` | 全版本/0.1.4 | ✅ / ⚠️ | rc.2 `ClientConnectionRpc.call(channel, endpoint, …)` 存在；但 rc.2 没有 `/api` 精确路由注册面，0.1.4 的 `/api/dsw/*` 通道在 rc.2 上**没有宿主侧 handler** → 远端数据面全断 |

### 5.5 「0.1.5-rc.1 / 0.1.2-rc.1 新增或改名」的 API 在本机是否存在的专项结论

| 上游新 API | 本机 rc.2 | 结论 |
|---|---|---|
| `ctx.workspace`（0.1.5 线 workspace 控制器） | ❌ | rc.2 无 `ctx.workspace` 单数服务；插件也不依赖它（用的是 client `workspaces` 服务 + host `sshRegistry`/`sideWorkspaces`） |
| `ctx.connection.fetch.register`（0.1.5 线） | ❌ | **0.1.4 的硬依赖，rc.2 缺** → 0.1.4 不可直接在 rc.2 跑 |
| `FileSystem.readByteRange`（0.1.5 线） | ❌（rc.2 无此抽象成员） | 对 rc.2 无害：多实现一个方法；但 0.1.4 的 `src/mixed.ts:348` 会在 rc.2 上探测 `ctx.get('fs')?.readByteRange` 并降级，语义安全 |
| client `uiWorkspace` 服务（0.1.2-rc.1 起） | ❌ | rc.2 目录浏览在 `ctx.workspaces.*`（见 5.4） |
| `dsh-host-directory-picker` 的 browse 能力（`DirectoryPickerBrowseCapability` 等类型） | ⚠️ | rc.2 `dsh-host-directory-picker/lib/types/index.d.ts` 需核对 `DirectoryEntry/DirectoryListing` 类型名；pickNativeDirectory 运行时导出存在（第 5.1 节 ✅）；0.1.4 的 `src/picker.ts:40-46` 类型导入若 rc.2 类型名不同则 typecheck 报错（仅编译期） |
| `Session.events` → `ownEvents()`（0.1.2-rc.1 改名） | rc.2 仍是 `events` | 插件源码不使用 `Session.events`/`ownEvents`（grep 无命中），无关 |
| `dsh-subprocess@0.1.5` 的 `@deepseek-ai/dsh-http-proxy` peer | rc.2 无 | 插件 0.1.3/0.1.4 devDeps 含 http-proxy；rc.2 家族无此包 → 编译期缺失，运行期不用 |

---

## 6. 可行的 backport 估计

### 6.0 先决结论（semver 已实测）

本机 Node 用 `/usr/lib/node_modules/npm/node_modules/semver` 实测：

```
^0.1.0-rc.6 vs 0.1.1-rc.2        => false   （用户判断正确：预发布范围不覆盖跨 tuple 的 0.1.1-rc.2）
^0.1.0-rc.6 vs 0.1.0-rc.6        => true
^0.1.1-rc.2 vs 0.1.1-rc.2        => true
^0.1.1-rc.2 vs 0.1.2-rc.1        => false
^0.1.2-rc.1 vs 0.1.1-rc.2        => false
^0.1.5-rc.1 vs 0.1.1-rc.2        => false
^4.0.1    vs 4.0.2               => true    （cordis OK）
^3.18.1   vs 3.18.2              => true    （schemastery OK）
```

原因：`^0.1.0-rc.6` 展开为 `>=0.1.0-rc.6 <0.2.0-0`，但 semver 预发布规则要求候选版本的 [major,minor,patch] 元组必须与**某个带预发布的比较器同 tuple**——`0.1.1-rc.2` 的 tuple 是 0.1.1，范围里只有 0.1.0-rc.6（tuple 0.1.0），故被拒；`includePrerelease: true` 才放行。**对安装的影响**：`dsh plugin --profile web add dsh-workspace-enhancement`（DSH 的 pnpm 供应链安装）会因 peer 不满足报 ERR_PNPM_OUTDATED_LOCKFILE / peer 冲突类错误；走 `--legacy-peer-deps` 或手工放宽 peer 才能装上。**deps 侧**：0.1.2 的全部 13 个 `@deepseek-ai/*` dependencies 都写 `^0.1.1-rc.2`——与本机版本**同 tuple，恰好全部满足**（§1 映射表全绿）。

### 6.1 结论速览

| 插件版本 | 能否在 0.1.1-rc.2 上跑 | 判定 |
|---|---|---|
| **0.1.2** | ✅ **最接近可跑**（仅 peer 挡 + 少量适配） | deps 全部对准 rc.2；host 侧用 `rpc.handle('/dsw')`（rc.2 存在）；client 侧用 `ctx.workspaces.listDirectory`（rc.2 正是此 API）；工具面同 0.1.4 的 sw_* 全集 |
| **0.1.3** | ✅ 同 0.1.2（peer 面收窄为 ^0.1.2-rc.1 反而更不可装，但代码可跑性同） | 0.1.2→0.1.3 只是依赖形态/提示词/方法补齐，无新的 rc.2 缺口 |
| **0.1.4** | ❌ **不可跑** | 硬依赖 rc.2 不存在的 `ctx.connection.fetch.register` + client `uiWorkspace`；README 亦声明仅支持 0.1.5 线 |

> 注意：上述「可跑」指**架构接缝全部对上**；官方作者在 README/compatibility.md 中已把 0.1.1-rc.2 线标为「停止支持/从未支持」（compatibility.md §1 把 0.1.1 标为「家族劈叉缺陷版」），且 0.1.3 的宿主线（0.1.2-rc.1）中 `dsh-session` 等已换 API。但**本审计逐项核对后**：0.1.2/0.1.3 的源码层面在 rc.2 上唯一确定的运行期断点没有发现（除了 5.4 的 `DirectoryPickerBrowseCapability` 类类型名编译期风险与 0.1.3 依赖 `dsh-session` 新事件 API——需实测）。**声明「可跑」必须有真 boot 验证**（作者自己的 F1 教训：typecheck 全绿 ≠ 能启动）。

### 6.2 0.1.2 适配到 rc.2 的具体改动面（估计 <100 行）

| 改动 | 文件 | 估计 |
|---|---|---|
| 1. peer 放宽（仅此即可装上） | `package.json`：把 2 个 peer `dsh-tools`/`dsh-system-prompt` 从 `^0.1.0-rc.6` 改为 `^0.1.1-rc.2`（deps 已全绿无需动）；或用 `--legacy-peer-deps` 装原包 | 2 行 |
| 2. typecheck 修正（如 `DirectoryEntry/DirectoryListing` 等类型名与 rc.2 不一致） | `src/picker.ts:41` 等类型导入 | ≤5 行 |
| 3. （可选）`maxEntries` 等 Config 默认值核对 | `src/picker.ts:128`、`src/web.ts:85` | 0 行 |
| 4. boot 冒烟验证（非代码） | 临时 DSH_HOME + `dsh plugin add` + 真 boot + `POST /dsw/connections.list` 探针 | — |
| 总计 | 2 个文件 + package.json | **<50 行，无架构改动** |

### 6.3 0.1.4 适配到 rc.2 的改动面（估计 300-600 行，需架构级）

| 改动 | 文件 | 估计 |
|---|---|---|
| 1. 浏览器通道从 `/api` 精确 Fetch 路由改回 rc.2 的 `connection.rpc.handle('/dsw', …)`（`rpc.intercept('/api')` 被 dsh-api-gateway 占死不可用） | `src/web.ts`（mount 部分 :685-712）、`src/web-channel.ts`（API_CHANNEL、channelEndpointOf、`/api/dsw/*` → `/dsw/*`）、`src/client/index.ts:195-199`、`src/client/remote-status.ts` 等 rpc.call 路径 | ~100-200 行 |
| 2. 本地目录座从 `uiWorkspace` 换回 rc.2 的 `ctx.workspaces.listDirectory/createDirectory`（官方 0.1.2/0.1.3 原写法） | `src/client/local-directory.ts`、`src/client/index.ts:177-180` | ~30 行 |
| 3. peer 13 项全部 `^0.1.5-rc.1` → `^0.1.1-rc.2`（或联合） | `package.json` | 13 行 |
| 4. devDependencies 21 项对齐 rc.2 家族（`dsh-http-proxy`/`dsh-invariants`/`dsh-session` 等版本） | `package.json` | 21 行 |
| 5. 0.1.4 新增的会话连接/审批门/围栏功能如要保留需逐个核对 rc.2 服务名（`approval`、`agents.currentInitiator`、`sandboxPolicy` 已核对存在 ✅） | `src/remote-approval-gate.ts`、`src/remote-sandbox-fence.ts` | 视取舍 0~200 行 |
| 总计 | | **~200-500 行**，且含「0.1.4 功能在 rc.2 上**未经作者验证**」的风险 |

### 6.4 结论

- **0.1.2**：可 backport，改动 <50 行、无架构改动、无新功能裁剪；deps 天然对准 rc.2。**这是首选基线**（作者 0.1.2 的依赖形态正好就是 rc.2 家族）。
- **0.1.3**：同 0.1.2 可跑性，但它把 deps 全改 peer、并依赖 0.1.2-rc.1 家族的一些细节（如 `dsh-session` 事件 API），backport 收益低于 0.1.2。
- **0.1.4**：不可直接跑，需架构级改动（通道换轨 + 本地目录 API 回退 + peer 放宽），约 200-500 行，且引入了作者在 rc.2 上从未验证过的会话连接/审批门/围栏语义。
- 无论哪个版本，**必须真 boot 冒烟**（作者 F1 教训：`compatibility.md` §2 的 0.1.5 启动即崩案例是 typecheck+单测全绿、运行时才炸）。

---

## 7. 风险

### 7.1 许可证

- 仓库 LICENSE = MIT，npm 5 版均 MIT，一致。✅
- 注意：版权行是「dsh-ssh contributors」（dsh-ssh 是上游 fork 源，README References 列出）；README/代码大量引用/移植自 `dsh-ssh`（UynajGI）与 `dsh-remote`（flymysql），如需二次分发建议核对这两者的许可证（MIT 文本同源）。

### 7.2 维护活跃度

- 活跃期 2026-08-26 ~ 2026-09-13（近 3 周 5 版，最高密度 08-31 一天 8 commit）；当前（09-14）最近版本 0.1.4 于 09-13 发布，**无停止迹象**，但「0.1.2 家族 2026-09-11 被作者单方面退场」显示版本线切换激进（`compatibility.md` §1、CHANGELOG 0.1.4「放弃 0.1.2 家族支持」）。
- 质量设施：CI（ubuntu/windows 矩阵）、单测 259+、静态闸门、upstream 哨兵、boot 冒烟、Trusted Publishing（OIDC provenance）——作者工程纪律良好。

### 7.3 是否侵入 DSH 核心

- **否**：无 monkey-patch、无 `Object.defineProperty` 改官方类、无 `__proto__`/prototype 篡改、无直接改 DSH 安装树（grep 无 `node_modules/@deepseek-ai/dsh/` 路径引用）。
- 侵入方式是**标准的 cordis 插件机制**：`cordis.patch.yml` 用官方 bundle patch 机制**禁用**官方 3 行（directory-picker-auto/subprocess-local/fs-sandbox）并插入自己的 3 行——「禁用官方行」属于**对部署装配的接管**，用户应知悉：装上后官方本地 provider 行被关，`ctx.subprocess`/`ctx.fs` 全部由本插件接管。
- `Object.defineProperty(tool, 'description'/'parameters')`（`src/exec-tools.ts:1036-1039,1222-1225`）只是对**自己 defineTool 返回的工具对象**做本地化 getter，非侵入核心。

### 7.4 对 rc.2 的兼容风险点清单

1. **0.1.4 通道断点（硬）**：`ctx.connection.fetch.register` 不存在（§5.3）→ 0.1.4 web 行必炸/静默无数据。
2. **0.1.4 本地目录断点（软）**：`uiWorkspace` 服务不存在 → 本地目录窗格降级为一行错误文案（不阻止其他 UI）。
3. **peer semver（安装层）**：任何 ≥0.1.2 版本的 peer 都不满足 rc.2（§6.0），需放宽；0.1.2 的 deps 恰全绿。
4. **`rpc.intercept('/api')` 被 dsh-api-gateway 单占位**：rc.2 同 0.1.5 一样不可复用它（`dsh-api-gateway/lib/index.js:62` + `registerInterceptor` 重复注册抛错）。
5. **client `inject=['slots','workspaces','sessions','locale']` 的服务面**：rc.2 全部存在（§5.4）；但 0.1.4 若在 rc.2 上跑，`connection.rpc.call('/api',…)` 无宿主 handler → 设置页机器列表/连接/浏览全部拿不到数据（不崩、静默）。
6. **类型面**：`dsh-client-ui-slots` 包未装入本机全局树（构建期解析）；`DirectoryPickerBrowseCapability` 等类型名需在 rc.2 家族验证（typecheck 级风险）。
7. **版本语义风险**：作者把 rc.2 线判为「家族劈叉缺陷版」（`compatibility.md` §1）——即作者认为 rc.2 线本身有依赖分裂缺陷（deps 停在 ^0.1.0-rc.6 而其余 ^0.1.1-rc.2），plugins 0.1.1 是其补丁版；在 rc.2 上跑 0.1.2 属于**作者不承诺**的组合，安全语义需自行 boot 验证。

---

## 附：本报告关键证据索引（文件:行）

| 证据 | 位置 |
|---|---|
| 工具注册 | `src/tools.ts:573`、`src/exec-tools.ts:1042,1228` |
| 工具定义（sw_status/sw_connect/sw_pick_workspace/sw_exec/bash） | `src/tools.ts:434,472,536`、`src/exec-tools.ts:928,1108` |
| 混合 provider | `src/plugin.ts:98-151` |
| client slots | `src/client/index.ts:201-241`、`src/client/remote-status.ts:44` |
| uiWorkspace 依赖 | `src/client/index.ts:177-180`、`src/client/local-directory.ts:5-13,60-71` |
| ssh2 引擎 | `src/ssh-core.ts:18-19,175,183,260`、`src/terminal.ts:134`、`src/filesystem.ts:208,259,325,438,460,512,516` |
| 端口转发延后 | `docs/decisions/ADR-0005-defer-port-forwarding.md` |
| rc.2 连接 RPC 面（无 fetch） | `…/dsh-client-connection/lib/types/rpc.d.ts`、`lib/index.js:219-224,479` |
| rc.2 目录浏览在 workspaces | `…/dsh-client-ui-directory-picker-browse/lib/client.js:1022-1023`、`…/dsh-client-runtime/lib/client.js:9965,9976` |
| rc.2 无 uiWorkspace | `grep -rl uiWorkspace <dsh tree>` 零命中 |
| rc.2 slot 目录 | `…/dsh-cordis-client-runner/lib/client.js`（48 条，5 个目标 slot 全在） |
| rc.2 systemPrompt section/context | `…/dsh-system-prompt/lib/types/index.d.ts:187,194` |
| rc.2 assembleContextFor scope | `…/dsh-agent/lib/index.js:384-390` |
| rc.2 setSandboxMode | `…/dsh-sandbox-policy/lib/index.js:54` |
| rc.2 api-gateway 占位 intercept | `…/dsh-api-gateway/lib/index.js:62` |
| semver 实测 | `/usr/lib/node_modules/npm/node_modules/semver`（§6.0 表） |
| npm 版本/license 核验 | `curl https://registry.npmjs.org/dsh-workspace-enhancement`（5 版全 MIT，latest=0.1.4） |
