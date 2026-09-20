# 审计：DSH 部署的 SSH 相关 GUI 现状 与「原生 SSH 连接 GUI」的最小实现面

- **审计档**：只读调研子代理（路由 adam/deepseek-v4-flash）
- **审计时间**：2026-09-15（DSH 进程 `node ~/.npm-global/bin/dsh web` 运行中，:3080 boot 实时抓取）
- **方法**：只读。全部结论以真实盘面证据（文件内容 + 行号、`~/.dsh/remote-workspaces/` 实态、:3080 boot JSON、运行中插件 client bundle）为准；未改任何代码；未使用 sandbox_permissions。
- **部署基线**：DSH core `@deepseek-ai/dsh` **0.1.1-rc.2**；profile `web`（`~/.dsh/profiles/web/`，bundles = dsh-base + dsh-web-app，patchReload live）；底座 `dsh-workspace-enhancement@0.1.2`（已含 4 行适配：2 peer + 2 picker dep 放宽到 `^0.1.1-rc.2`，见 audit-d-plugins.md §3.1）。
- **总体裁决**：**底座已经实现了「原生 SSH GUI」约 70% 的面**（主机 CRUD 设置页、连接状态徽章、目录流内远程浏览、远程目录作工作区、侧工作区）；缺失的是 ① keyRef 凭据绑定、② 持久远程文件树 + 上传/下载、③ 远端命令执行面板、④ 全局/会话级常驻状态与「会话↔主机」显式管理。**最小实现 = 新薄插件 `@local/dsh-ssh-gui`（不改底座、不改 core）**，复用底座 host 服务（`ctx.sshRegistry`、`ctx.credentials`、/dsw RPC）与 client slots 注册机制，新增一个自有 RPC 通道 `/ssh-gui` 补齐 4 个缺口。

---

## 1. 底座现有 GUI 面（dsh-workspace-enhancement@0.1.2）

### 1.1 装配（profile web 的 cordis.patch.yml，行号证据）

`~/.dsh/profiles/web/cordis.patch.yml`：
- **L39-45** `ssh-remote` insert：`name: dsh-workspace-enhancement`，config `host: 127.0.0.1 / port: 22 / username: ssh / cwd: /tmp` —— **占位连接行**（挂 `ctx.ssh` + 混合 `ctx.subprocess`/`ctx.fs` provider，懒建立）。
- **L48-51** `directory-picker-ssh` insert（`dsh-workspace-enhancement/picker`，maxEntries 1000）——**后被 L74-75 再次 disabled**（避免与 `directory-picker-browse` 重复注册 `directoryPicker` seam；audit-d §3.3 同结论）。
- **L54-57** `ssh-web-channel` insert（`dsh-workspace-enhancement/web`）——**多连接注册表 + /dsw RPC**，这是底座的 GUI 可写主机注册表所在。
- **L70-71** `directory-picker-browse` insert（官方 @deepseek-ai/dsh-host-directory-picker-browse，提供本机 `ctx.directoryPicker` browse 能力，lib/index.js L138/L152：`browseCapability = { kind:'browse', list, createDirectory }`）。
- **L67-68** 官方 `directory-picker`（auto）disabled。

### 1.2 host 侧对外能力（哪些可被新 UI 直接调用）

| 面 | 符号 | 位置 | 对外能力 |
|---|---|---|---|
| 占位连接 | `ctx.ssh`（SshRuntime extends Service） | runtime.js L62/L98；`getClient()` L146、`getSftp()` L154、`getRemoteEnvironment()` L163、`exec()` L186 | 单占位目标（127.0.0.1:22/ssh）；新 UI 不需要直接用 |
| **多机连接池（即任务所称 ctx.sshPool 的实际符号）** | `ctx.sshRegistry`（SshRegistry extends Service） | registry.js L388/L424；状态持久到 `~/.dsh/remote-workspaces/machines.json`（L426） | `listMachines()` L477、`add()` L506、`saveMachine()` L556（upsert + 凭据后端）、`remove()` L647、`setCurrent()` L671、`test()` L688、`status()` L898、`statusOf()` L1033、`probe()` L1052、`reconnect()` L1067、`getActive()` L798、`route()` L496、`listConfigHosts()` L761（~/.ssh/config 别名）；连接按 id 懒建立（`get()` L484-494）、live Map 即池 |
| 混合 provider | `ctx.subprocess` / `ctx.fs` | plugin.js L88/L91（MixedSubprocessRuntime/MixedFileSystem，按 cwd 路由远端 vs 本地） | 会话 cwd 为 `ssh://<id>/<path>` 或占位树时，bash/fs 工具全量远端执行——**这正是「远端命令/文件读写」的引擎，GUI 面板可经 RPC 直调** |
| 工具（模型面） | sw_status / sw_connect / sw_pick_workspace / sw_exec /（win32 bash） | tools.js L207/L240/L280；exec-tools.js L573 `sw_exec`；注册于 web.js L506 | 是 `defineTool` 注册给 agent 循环的，**GUI 不能直接调工具**；但它们的底层（registry 方法 + connection.exec/getSftp）完全可被新 RPC 端点复用 |
| **/dsw RPC 通道** | `ctx.connection.rpc.handle('/dsw', dispatch, { authority:'loopback' })` | web.js L504 | 端点全集（web.js L260-503）：`connections.list/add/remove/test/resolve`、`config.hosts`、`machines.list/current/setCurrent/add/remove/test`、`hostkey.forget`、`status`、`conn.status/probe/reconnect`、`browse.home/list/mkdir`、`session.route`、`local.pickNative`、`session.ws.list/add/update/remove`。**≈ 原生 SSH GUI 所需数据面的全部「读 + 管理」端点已就绪** |
| 凭据 | OS keychain：`saveSecret/getSecret/deleteSecret/platformBackend`（credential.js）；TOFU：`HostKeyStore`（hostkey.js L22-38，known_hosts.json + `.secrets` 目录） | credential.js / hostkey.js | 密码可存 OS keychain（credentialBackend=keychain）或明文 machines.json；**未接 `~/.dsh/.credentials.yaml`（ctx.credentials）** |

### 1.3 client 注入（GUI 面，行号证据）

client 入口 `lib/client/index.js`：`inject = ['slots','workspaces','sessions','locale']`（L27），注入 6 个官方 bundle（package.json `dsh.client.inject`）；**boot 实时确认**：:3080 boot 第 46 条 `dsh-workspace-enhancement`（rev 42218c0d84c3，served bundle = `lib/client.js`，__ModuleLoader__ 预打包单文件 266 KB）。

注册的 GUI 面（client/index.js）：
1. **L55-62** `conversation.hero.workspace.directoryFlow` + `sidebar.workspaces.directoryFlow`（官方父槽的 single 子槽，见 dsh-client-ui-workspace/lib/client.js L2434/L2444 `children: {…directoryFlow: {kind:'single', scope:'root'}}`）→ **SshWorkspaceFlow**（flow.js L132）：「连接与位置」侧栏（已保存连接 / `~/.ssh/config` 主机一键解析注册 / 本机入口）+ 右窗远程目录浏览（`browse.list`）+ 新建连接表单 + 删除 + 确认 + 「打开为工作区」。
2. **L63-72** `settings.section`（id `dsh-workspace-enhancement`，order 40）→ **RemoteWorkspaceSettingsPage**（settings.js L86）：机器列表（**编辑/删除/设为当前/忘记主机密钥**）+ 共享 MachineForm（machine-form.js：主机/端口/用户/名称/默认工作区/**认证 tabs：私钥文件/密码/agent**/私钥口令/跳板链/「加密保存密码」/「测试连接」/保存）——**这就是「主机 CRUD」设置页，已经存在**。
3. **L75-82** `conversation.session.header.actions`（id `dsh-workspace-enhancement-side`，order 25）→ **SideWorkspacesAction**（side-workspaces.js）：每会话「⊕ 工作区」按钮 + 副工作区面板（本地/远程目录附加，fs r|rw + exec on|off 权限对，走 `session.ws.*`）。
4. **L83** installSidebarRowBadges：侧栏工作区/会话行上的远程路由徽章（DOM 兼容层）。
5. 状态徽章 **ConnStatusBadge**（status.js L182）：三态（◇ unknown / ● active / ● offline）+ 失败时「重试并连接」（`conn.reconnect`），TTL 缓存 + 去重（status.js L56-107）。

### 1.4 主机注册表：GUI 可写，但当前为空 → 实际只有占位单主机

- **有 GUI 可写的注册表**：`/dsw machines.add/remove/setCurrent`（web.js L320-335）→ `SshRegistry.saveMachine/remove/setCurrent` → 持久 `~/.dsh/remote-workspaces/machines.json`（registry.js L1180-1192 persist）。设置页就是调用者。
- **当前实态**：`~/.dsh/remote-workspaces/` **目录不存在**（`ls` 证实）→ machines.json 无 → 表空。此时 `activeSpec()`（registry.js L787-812）回退 `configDefaultMachine()`（L981-998）＝ cordis 占位 **127.0.0.1:22/ssh**（cwd /tmp）。即：**部署现状只有占位单主机，任何真实主机都必须先在 GUI（设置页/流内表单）或让模型跑 `sw_connect` 注册**。

---

## 2. 缺失清单（相对「原生 SSH GUI」需求逐项）

| 需求 | 现状 | 缺口 | 可复用 |
|---|---|---|---|
| ① 主机管理 CRUD（host/user/port/keyRef） | ✅ 设置页 + 流内表单已实现 CRUD；表单含 host/user/port/密码/私钥路径/agent/跳板/测试连接 | **keyRef 绑定缺失**：只认 `privateKeyPath`（文件路径，connection.js L107/L181-182 `readIdentityFileFor` 读盘）或明文密码 / OS keychain；**未接 `~/.dsh/.credentials.yaml`（ctx.credentials refs）** | `saveMachine`（registry.js L556）可被新 host 端点直接调用（含更新 privateKeyPath）；`ctx.credentials.resolve(credentialRef(name))`（dsh-credentials 服务，dsh-base patch L85-86 已挂 dsh-credentials-local） |
| ② 连接状态指示 | ✅ 三态徽章 + reconnect，出现于设置页行内与流侧栏 | 无全局/会话级常驻状态栏；无「所有主机一览 + 心跳」视图 | `status()` / `conn.status/probe/reconnect`（web.js L358-388）；deriveConnectionState（registry.js L32-38） |
| ③ 浏览远程文件 / 上传下载 | ⚠️ 浏览仅在「添加工作区」对话框内（瞬态，flow.js `browse.list`）；`session.route` 可把远程目录设为工作区（web.js L405-422 + 占位 cwd，transport.js L39-45） | **无持久文件树面板**；**/dsw 无 upload/download 端点**（dispatch L260-503 全表无 put/get）——SFTP 能力在连接层存在（`getSftp()`），但未暴露 | `browse.home/list/mkdir`（web.js L389-404）；`connection.getSftp()` 可新增 fastGet/fastPut 端点；官方 browse 面板（directory-picker-browse）只服务本机 |
| ④ 远端命令执行面板 | ❌ **无 GUI 面板**：只有模型工具 `sw_exec`（exec-tools.js L573，远端 spawn/PTY/后台）与混合 provider 下 bash 工具 | 无「命令输入 → 执行 → 输出」GUI；无流式 | `registry().getActive()/get(id).connection.exec()`（exec 通道，ssh-core）；sw_exec 的 spawn/collect/background 模式（exec-tools.js）可照抄为 RPC 端点 |
| ⑤ 多主机/会话管理 | ⚠️ machines 列表 + current + 侧工作区（逐会话附加）已有 | 无「会话 ↔ 主机」显式绑定管理 UI（路由靠会话 cwd 隐含：transport.js `remoteRouteFromCwd` L112-121）；无全局主机面板 | `machines.current`（web.js L301）、`session.ws.*`（L430-493）、`session.route` |

**小结**：数据面（注册表 + 状态 + 浏览 + 路由）底座已 100% 就绪且 GUI 可写；缺的是**三个交互面**（keyRef 绑定、持久文件树 + 传输、命令面板）+ **一个常驻状态视图**。底座 client 是预打包 bundle（`lib/client.js`），无法就地扩面板；host 服务却全部可经 `ctx.get('sshRegistry')` 从**任何** cordis 行访问（web.js 自身就是这么拿的：L191-196 `ctx.get('sshRegistry')`）。

---

## 3. 新插件最小设计（推荐：`@local/dsh-ssh-gui`，不改底座）

### 3.1 为什么「新插件」而非「对底座补 GUI」

- 底座 0.1.2 是「历史正确版、已无人维护」（作者 2026-09-11 跳线 0.1.3/0.1.4 家族，deep-research §4.4）；其 client 是预打包 __ModuleLoader__ 单文件（266 KB），手工 patch bundle 脆弱、升级即碎。
- 底座 host 服务是 cordis 全局 seam：新插件行可 `ctx.get('sshRegistry')` / `ctx.get('credentials')` / `ctx.get('sideWorkspaces')` 直接复用（web.js L191-196 同款），**零依赖注入冲突**。
- 官方 slots 是链式/单槽注册：新插件用**新 id + 新 order** 注册 `settings.section` 与 `conversation.session.header.actions` 条目即可共存（底座设置页 id=`dsh-workspace-enhancement` order=40；header 按钮 id=`…-side` order=25）。**不碰 directoryFlow（single 槽被底座占）**——audit-d §3.3 的 picker 冲突教训即「同一 seam 不重复注册」。
- 已有 @local 先例：`@local/dsh-usage`（手写 __ModuleLoader__ client bundle，零构建链，boot 第 45 条在线）、`@local/dsh-workerspace`（host-only + settingsNamespace，audit-d §3.2）。

### 3.2 host 侧（新增一个薄行 + 自有 RPC 通道）

- **装配**：profile web 的 cordis.patch.yml 追加 1 条 insert（`id: ssh-gui, name: '@local/dsh-ssh-gui'`），插件自带 cordis.patch.yml（与底座同款 insert-only；**不 disable/覆盖任何底座行**）。
- **通道**：`ctx.connection.rpc.handle('/ssh-gui', dispatch, { authority: 'loopback' })`（照 web.js L504）——**不要**二次 `handle('/dsw')`（web.js 已独占）。
- **复用（零新代码）**：客户端可直接 `connection.rpc.call('/dsw', …)` 调 machines.* / conn.* / browse.* / session.route / config.hosts / status（web.js L260-503 全表）。
- **新增端点**（host ~150–250 行，全部走 `ctx.get('sshRegistry')` + `ctx.get('credentials')`）：
  - `keyref.set { machineId, refName }`：`credentials.resolve(credentialRef(refName))` → PEM（ssh-core.js L59-70 `resolvePrivateKey` 已接受 `-----BEGIN` 内容）→ 写 `~/.dsh/remote-workspaces/.secrets/keys/<machineId>`（显式 0600；与底座明文密码同一信任域）→ `registry().saveMachine({ id, privateKeyPath })`。**keyRef 侧表**（machineId → refName）存插件自有小 JSON（如 `~/.dsh/remote-workspaces/ssh-keyrefs.json`）——因为底座 `normalizeMachine`（registry.js L177-239）白名单字段，keyRef 不能直接进 machines.json。`keyref.list`：列出 credentials 中可用的 ref 名 + 当前绑定（只给名字，**值永不出 host**）。
  - `exec.run { id?, command, cwd?, timeoutMs? }`：`registry().getActive()`（L798）或 `get(id)` → `connection.exec(command, {signal: AbortSignal.timeout})` → `{exitCode, stdout, stderr}`；如需流式/后台，照 exec-tools.js 的 spawn + incrementalRead + `ctx.jobs` 模式（~+80 行）。
  - `file.get { id, remotePath }`（SFTP fastGet → base64，设大小上限）/ `file.put { id, remotePath, base64 }`（fastPut）——连接层 `getSftp()` 已在（runtime.js L154 / connection），RPC 未暴露是唯一缺口（~60 行）。
- **安全**：keyRef 只存引用名；PEM 落 host 0600 文件，**密钥内容永不进模型/浏览器**；命令面板执行前客户端二次确认（高危可走 `ctx.approval.request`，@local/dsh-workerspace ws_flash 先例 audit-d §3.2）；TOFU 主机指纹沿用底座默认 accept-new（status 暴露 hostKeyKnown，web.js L358-360）。

### 3.3 client 侧（手写 bundle，~400–600 行，照 @local/dsh-usage 先例）

- `dsh.client.inject` 同底座 6 包（connection/locale/runtime/conversation/sidebar/workspace），client.js 用 `__ModuleLoader__.load({id:'@local/dsh-ssh-gui', factory})` 手写（react / react/jsx-runtime 为平台种子词，deep-research §1.3）。
- **settings.section 新条目**（id `@local/dsh-ssh-gui`，order 50）：主机一览（复用 `/dsw machines.list` + `conn.status` 徽章）＋ CRUD（编辑预填 keyRef 下拉，选项来自 `keyref.list`）＋ 测试连接 ＋ 设当前 ＋ 忘记主机密钥。
- **conversation.session.header.actions 新条目**：「SSH 命令」按钮 → 对话框（主机选择 = current/机器列表，命令输入，`exec.run` 输出回显，可再次运行）；「SSH 文件」按钮 → 远程文件树对话框（`/dsw browse.home/list` 逐级 + `file.get/put` 上传下载入口）。
- 不做 directoryFlow 替换、不做独立侧栏面板（rc.2 无合适 single 槽；header.actions + settings.section 是底座验证过的唯二安全入口）。

### 3.4 改动面与风险（对照 audit-d-plugins.md 结论）

| 项 | 面 | 风险与规避 |
|---|---|---|
| profile patch | +3–5 行 insert | 只 insert，不 disable/覆盖底座行（audit-d §3.3 的教训：重复注册 directoryPicker 会炸；此处不注册任何 seam 冲突面） |
| host | 1 个新行（inject ['connection','tools','systemPrompt'] 或仅 ['connection']）+ /ssh-gui 通道 | 不二次 handle('/dsw')；`ctx.get('sshRegistry')` 懒取（web.js L191-196 同款，行序无关——dsh-base patch 注释：激活按服务可用性，非行序） |
| client | 手写 bundle，settings.section + header.actions 新 id | 链式槽多注册者合法（底座 settings 页与 usage 卡并存）；directoryFlow 是 single 槽，**碰即冲突**（audit-d §3.3） |
| 凭据 | keyRef 侧表 + 0600 密钥文件 | 与底座明文密码同一信任域（machines.json 已在 ~/.dsh 明文存密码，0600 由 umask 决定——新文件显式 0600 更严）；credentials 服务已在（dsh-base patch L85-86） |
| 装配冒烟（audit-d §1.3 方法） | 落地后：boot 出现新 client 条目、:3080 设置页渲染、machines.json 落盘、占位回退 vs 注册机切换、exec.run/file.get 实跑 | 每次 DSH 重启后核对；client 改动经 dev:web HMR 或重启后刷新（system 提示：apps/web 之外的插件 client 由插件目录静态伺服） |

---

## 4. 与「终端先连」流的对比结论

**当前链路（已是 GUI 原生，但入口分散）**：会话 hero / 侧栏「添加工作区」→ SshWorkspaceFlow（flow.js L132）→ 选已保存连接或 `~/.ssh/config` 主机一键注册（flow.js L384-400）→ 浏览远程目录（`browse.list`，flow.js L200-203）→ 打开为工作区：`session.route`（flow.js L225）→ host 本地建占位目录（`~/.dsh/dsw-routes/<id>/<path>`，transport.js L39-45）+ 机器 workspace 写回（web.js L420）→ 会话以占位 cwd 创建 → 混合 provider 按 cwd 路由远端（plugin.js L88-91）→ 注册机连接懒建立（registry.js L484-494）。**即任务所称「picker 选目录 → 占位连接」**。真正的主机注册入口分散在：设置页（CRUD）、目录流表单、`~/.ssh/config` 一键、或让模型跑 `sw_connect`（tools.js L240）。

**「终端先连再同步」的观感来源**：部署现状 machines.json 为空，有效目标只有占位 127.0.0.1:22/ssh（registry.js L787-812 回退链）；要接真实主机，用户要么主动进设置页（GUI），要么让模型在会话里先 `sw_connect`/`bash`——后者即「先在会话/终端里连好，GUI 列表/徽章才同步出现」。

**原生 GUI 如何替代**：把「主机 CRUD（含 keyRef）→ 连接状态 → 文件浏览/传输 → 命令执行 → 打开工作区」全部收敛进 GUI 两个入口（设置页条目 + 会话头部按钮），注册机 machines.json 成为唯一配置源，占位 127.0.0.1:22/ssh 仅作空表回退（registry.js L787-812）——GUI 内完成连接全生命周期，不再依赖模型/终端先行。

---

## 结论（一句话）

底座 0.1.2 已提供「GUI 可写的主机注册表 + CRUD 设置页 + 三态连接状态 + 目录流内远程浏览/开工作区 + 侧工作区」，缺 keyRef 凭据绑定、持久远程文件树与上传下载、远端命令面板、常驻状态视图四项；推荐**新薄插件 `@local/dsh-ssh-gui`**（host ~150–330 行新端点 + 手写 client bundle ~400–600 行 + profile 3–5 行 insert），全部复用 `ctx.sshRegistry` / `ctx.credentials` / `/dsw` RPC / 官方 slots 机制，不动底座、不动 core、不重复注册任何 seam，规避 audit-d §3.3 的 picker/装配冲突教训。
