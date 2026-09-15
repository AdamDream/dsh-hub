# 修订执行复核一体档报告 —— 原生 SSH 连接 GUI 插件 `@local/dsh-ssh-gui`

- **阶段**：修订执行复核一体（Revise-Execute-Review，执行档 + 同档自复核）
- **路由**：adam/deepseek-v4-flash
- **时间**：2026-09-15（DSH 进程未重启；未写 `~/.dsh`；未使用 sandbox_permissions）
- **输入**：`.workspace/ssh-gui-audit.md`、`.workspace/audit-d-plugins.md`、`.workspace/workspace-plugins-deep-research.md`、底座源码（`~/.dsh/profiles/node_modules/dsh-workspace-enhancement/lib/`）、客户端先例 `@local/dsh-usage/lib/client.js`
- **交付目录**：`.workspace/deploy-ssh-gui/`
- **自裁决**：**pass（可部署，验收项全部本地可验证；遗留 4 项"部署后实测"与 1 项实现偏差已如实列在 §5）**

---

## §0 directoryFlow 多消费者核实（先做，结论驱动实现）

### 0.1 结论

**官方 slots API 的 `directoryFlow` 是 `single` 槽 = 单消费者，不支持多消费者，也不支持可变多条目；底座 `dsh-workspace-enhancement` 已占用两个 directoryFlow 孔位 → 本插件不得再注册 directoryFlow（诚实降级）**，同 UX 改在插件自有入口呈现（仍满足"主机名作为大文件夹"）。

### 0.2 证据链（全部为真实盘面行号）

| # | 证据 | 位置 | 内容 |
|---|---|---|---|
| E1 | slot 种类声明 | `~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js` L2436-2449 | `children: { "sidebar.workspaces.directoryFlow": { kind: "single", scope: "root" } }` 与 `children: { "conversation.hero.workspace.directoryFlow": { kind: "single", scope: "root" } }`——**两个 directoryFlow 孔位都是 single** |
| E2 | single 槽注册语义 | 本机实物副本 `/home/CNS2026495165/dsh/dsh-btw/node_modules/@deepseek-ai/dsh-client-ui-slots/lib/index.js`（0.1.1-rc.2 原版；`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-slots` 是悬空软链指向已清理的 npx 缓存，属审计已记录的 52 项悬空之一） | `SlotCore.register()`：`case "single": { const occupant = rec.entries.find(e => (e.options.priority ?? 0) === priority); if (occupant) throw new Error('single slot "…" already has a registration …'); }`——**同 priority 二次注册直接 throw**；注释明示异 priority 是 `shadow`（"register at a different priority to shadow it (lowest renders)"）＝**替换渲染，不是多消费者** |
| E3 | 其它 kind 的多条目语义 | 同上 | `keyed`（按 `options.key` 唯一）、`list`（按 `options.id` 唯一）、`chain`（需 `options.select`）——**只有 list/keyed/chain 支持多消费者**，directoryFlow 三者都不是 |
| E4 | 底座已占用 | `dsh-workspace-enhancement/lib/client/index.js` L55-62 | `ctx.slots.inject('conversation.hero.workspace.directoryFlow', () => ctx.slots.inject('sidebar.workspaces.directoryFlow', function* () { yield ctx.slots.register({ name: 'conversation.hero.workspace.directoryFlow', … }, SshWorkspaceFlow); yield ctx.slots.register({ name: 'sidebar.workspaces.directoryFlow', … }, SshWorkspaceFlow); }))`——**底座已在两个孔位注册 SshWorkspaceFlow（远程主机→远程目录→打开为工作区）** |
| E5 | occupied 标志（单消费者语义的运行期印证） | ui-workspace L830 / L1654 `useDirectoryFlow((occupied) => occupied)` + L821-830 | 官方父组件把 directoryFlow 槽的占用当**布尔标志**（占用即隐藏内置流程、由唯一消费者接管渲染）——单槽语义 |
| E6 | 对照：可用多消费者槽 | ui-conversation L10053-10056 `"conversation.session.header.actions": { kind: "list", scope: "session" }`；ui-settings-general L555-557 `"settings.section": { kind: "list", scope: "root" }` | **list 槽**：多插件以各自 `id` 注册共存（底座 side 按钮 id=`dsh-workspace-enhancement-side` order=25；本插件 order=26） |

### 0.3 降级实现（本插件实际形态）

在同一 UX 语义下搬到自有入口，**不注册任何 directoryFlow / directoryPicker seam**：

1. **`settings.section` 条目内「远程主机」大文件夹树**（`id: @local/dsh-ssh-gui`，order 50）：
   顶层「远程主机」→ 各主机（**可变多槽子项**：主机数由 `/dsw machines.list` 实时决定，UI 侧 map 渲染，无槽位数量限制）→ 展开某主机即浏览其根目录（`/ssh-gui file.list`，home 由登录环境 HOME 解析）→ 逐级下钻 → 「打开为工作区」（复用 `/dsw session.route` 得本地占位 cwd → `ctx.workspaces.create({path})` → `connectWorkspace` → `sessions.open`，会话经底座混合 provider 远端执行）。
2. **`conversation.session.header.actions` 条目**（`id: @local/dsh-ssh-gui-actions`，order 26）：「SSH」按钮 → 对话框（命令面板 / 文件树 + 上传下载），沿用同一「远程主机 → 目录」浏览组件。

### 0.4 可升级路径（给主代理的裁决依据）

| 触发条件 | 升级动作 | 代价 |
|---|---|---|
| DSH 升级到将 directoryFlow 声明为 `list`/`keyed`/`chain` 的版本线（需官方 ui-workspace 改声明） | 把本插件「远程主机」树以新 `id` 注册进 directoryFlow 槽，成为目录流内顶层项 | 小：组件已就绪，仅换注册点与 props 适配（flow owner 契约：`open/busy/onPicked/onCancel`，与官方 `WorkspacePickFlow` 一致） |
| 底座被替换/移除（directoryFlow 空出） | 直接注册 directoryFlow（single 只有 1 个消费者，本插件独占） | 小 |
| 维持现状 | 双入口并存（底座目录流 + 本插件远程主机树），**零冲突** | 零 |

> 明确不做：不注册 directoryFlow（会 throw 或 shadow 底座 UI，破坏现网）、不注册 `directoryPicker`（服务级重复注册已定案禁用，audit-d §3.3 教训）。

---

## §1 交付物清单（`.workspace/deploy-ssh-gui/`）

| 文件 | 行数 | 说明 |
|---|---|---|
| `dsh-ssh-gui/package.json` | 51 | 包名 `@local/dsh-ssh-gui` v0.1.0；`dsh.bundle.patch` + `dsh.client{platform:web, inject:[client-connection]}`；`exports["./client"]`（client-modules 必需，见 `dsh-client-modules/lib/index.js` L395）；peerDependencies：cordis ^4.0.1 / dsh-credentials / dsh-settings / schemastery / dsh-workspace-enhancement 0.1.2 |
| `dsh-ssh-gui/lib/core.js` | 805 | **纯逻辑**（无 cordis/网络/`~/.dsh` 硬依赖）：keyRef 路径与侧表读写、PEM 判定、0600 落盘、exec 参数构造（白名单/超时/cwd/输出截断/deadline）、file 上限与 base64、脱敏、配置投影、**`createDispatch(env)` 端点分发**（全部外部面注入） |
| `dsh-ssh-gui/lib/index.js` | 193 | cordis 薄接线：settings 命名空间 `dsh-ssh-gui` + `ctx.connection.rpc.handle('/ssh-gui', dispatch, { authority: 'loopback' })` + 服务懒取（`ctx.get('sshRegistry')` / `ctx.get('credentials')`）+ SFTP 适配 |
| `dsh-ssh-gui/lib/client.js` | 661 | 手写 `__ModuleLoader__` 零构建 bundle（照 @local/dsh-usage 先例）：settings 页 + header「SSH」对话框；仅 `require("react")`（平台种子词） |
| `dsh-ssh-gui/cordis.patch.yml` | 7 | 插件自带装配片段（insert-only 一行） |
| `dsh-ssh-gui/README.md` / `LICENSE` | 58 / MIT | 插件说明 + MIT |
| `deploy.sh` | 200 | `dry-run`（默认）/`--apply`/`--rollback`；preflight 含 `node --check` + 单测自检；**零 install** |
| `RUNBOOK.md` | 114 | 部署/验收/回滚/安全核对/已知约束 |
| `test/{keyref,exec,file,security,dispatch}.test.mjs` | 124/97/73/82/261 | **44 用例**（keyRef 9 / exec 9 / file 7 / security 6 / dispatch 13） |

合计 2726 行；**本档写入仅限 `.workspace/deploy-ssh-gui/` 与本报告**（`git status` 中其余改动文件 mtime 均早于本档开工时间 11:30，属既有改动，非本档所为；`~/.dsh` 零字节写入、进程未重启、未执行任何 install）。

---

## §2 需求逐条核对（用户裁决 5 条 + 执行要求 6 条）

### 需求 1 —— 载体=新插件、复用底座 seam、不改底座、防装配冲突

| 核对点 | 实现 | 证据 |
|---|---|---|
| 新插件 `@local/dsh-ssh-gui` | ✅ | `package.json` name/version；client bundle `id` == 包名（audit-d §4 规则） |
| 复用底座 host 注册表/连接池 | ✅ 零重复实现 | host 只用 `ctx.get('sshRegistry')`（`registry.js` SshRegistry：`listMachines/get/getActive/saveMachine`）；exec/file 走 `connection.exec` / `connection.getSftp` |
| 复用 cordis 全局 seam | ✅ | `ctx.get('credentials')`（dsh-credentials-local）+ `ctx.connection.rpc.handle` + client `ctx.slots` |
| 不改底座 | ✅ 只读引用 | 底座目录零写入；改动面 = 插件目录 + profile patch 1 行 insert + settings.yaml 1 段（可选） |
| 防装配冲突 | ✅ insert-only | 不 disable/覆盖任何行；**不注册 directoryFlow**（§0）；**不注册 directoryPicker**；不二次 `handle('/dsw')`（仅 `/ssh-gui`）；client 用新 id + 新 order（settings 50 > 底座 40；header 26 ≠ 底座 25） |

### 需求 2 —— 主机管理 settings.section 新条目 + keyRef 只存引用

| 核对点 | 实现 | 证据 |
|---|---|---|
| settings.section 新条目 | ✅ | `client.js` apply → `ctx.slots.register({ name:'settings.section', id:'@local/dsh-ssh-gui', order:50, label:… })`；smoke 实测注册成功 |
| CRUD：host/user/port | ✅ | `MachineForm`（host/user/port/显示名）+ `/dsw machines.add`（upsert）/`machines.remove`/`machines.setCurrent`/`hostkey.forget` |
| 显示名 | ✅ `label` 字段（留空回落 `user@host`，底座语义） | `saveMachine` label 规则 |
| agent | ✅ 表单 agent 字段 → `/dsw machines.add { agent }` | `applyInputFieldsInto` agent 分支 |
| 测试连接 | ✅ `/dsw machines.test`（编辑态带 `id`，底座 `mergeTestFields` 合并存量密钥/口令） | `testMachine()` in client.js |
| keyRef 绑定 | ✅ 绑定/解绑按钮 + 表单 keyRef 输入/下拉 | `/ssh-gui keyref.set` / `keyref.unbind` / `keyref.list` |
| keyRef 只存引用 | ✅ 侧表 `~/.dsh/remote-workspaces/ssh-keyrefs.json` 仅 `{machineId: refName}`（0600） | `core.readKeyrefsFile/writeKeyrefsFile` |
| 经 ctx.credentials 解析 | ✅ `ctx.credentials.resolve(credentialRef(refName))`（`~/.dsh/.credentials.yaml` 由 dsh-credentials-local 提供） | `index.js` credentials 注入；单测 `keyref.set` 全链路 |
| → 0600 密钥文件 | ✅ `~/.dsh/remote-workspaces/.secrets/keys/<machineId>`（mkdir 0700 + write 0600 + chmod） | 单测断言 `mode & 0o777 === 0o600`（文件）/`0o700`（目录） |
| 明文永不进模型/浏览器 | ✅ 值只在 host 内存→0600 文件；`keyref.list` 只回 ref 名 + `configured`；错误消息不含值 | 单测：`assert.doesNotMatch(JSON.stringify(result.value), /BEGIN OPENSSH/)`；非 PEM ref 错误不回显值 |
| 主机配置持久化 | ✅ **复用底座 `machines.json`**（决策注明） | `saveMachine` 落 `privateKeyPath`；**keyRef 引用本身**存插件自有 `ssh-keyrefs.json`——因底座 `normalizeMachine`（registry.js L177-239）白名单无 keyRef 字段，两层存储是审计 §3.2 的既定方案 |

### 需求 3 —— directoryFlow 集成（§0 结论驱动）

| 核对点 | 结论 |
|---|---|
| 前置核实（多消费者/可变条目） | ✅ 完成：**single 槽、单消费者、不可变多条目**（证据 E1-E6），底座已占 |
| 诚实降级 | ✅ 同 UX 搬到自有入口：设置页「远程主机」大文件夹树（顶层文件夹 → 可变多主机子项 → 主机根目录 → 点选目录打开为工作区）+ header SSH 对话框 |
| "主机名作为大文件夹" | ✅ 顶层「远程主机」+ 每主机一行「🖥 <显示名>」可展开（可变子项由主机数实时决定） |
| 「点选远程目录即打开为工作区」 | ✅ 复用底座路由：`/dsw session.route`（本地占位 cwd + 机器 workspace 写回）→ `workspaces.create` → `connectWorkspace` → `sessions.open` |
| 不踩 directoryPicker 重复注册 | ✅ 本插件零 seam 注册（仅两个 list 槽条目） |

### 需求 4 —— 命令面板 + 文件树/上传下载（host `/ssh-gui` 通道）

| 通道/端点 | 实现 | 核对 |
|---|---|---|
| `handle('/ssh-gui', …, {authority:'loopback'})` | `index.js` L~185 | ✅ **未二次 handle('/dsw')** |
| `keyref.set` / `keyref.list` | ✅（+ `keyref.unbind` 完成生命周期） | 单测全链路 |
| `exec.run`（`connection.exec`） | ✅ registry 连接池 `get(id)/getActive()` → `connection.exec(command, {signal, cwd})` | 单测：exitCode/stdout/stderr/cwd 透传 |
| exec 二次确认（高危） | ✅ 客户端确认模态（显示目标主机 + cwd + 完整命令）+ host 侧 `security.execAllowlist` 硬闸 + `security.confirmExec` 开关 | 单测：白名单外命令被 host 拒（bad-request） |
| `file.get` / `file.put`（base64） | ✅ stat 门 → `readFile` → base64；base64 → 上限 → `writeFile` | 单测：base64 往返、写远端断言 |
| 上限 settings 可配默认 10MB | ✅ `dsh-ssh-gui.file.maxBytes`（默认 10485760；schema `z.number().min(1)`） | 单测：默认值投影 + 超限拒绝 |
| 大文件提示走 sw_* 工具 | ✅ 超限消息 `… exceeding the N-byte limit; use the sw_* tools for large files` | 单测断言 `/sw_\*/` |
| client header 按钮 → 命令面板/文件树对话框 | ✅「SSH」按钮 → 对话框（命令 tab / 文件 tab） | client smoke：header 槽注册 id/order/label 正确 |
| 附加（面板所需）：`file.list` | ✅ **必要**：底座 `/dsw browse.list` 只返回目录（`listing.js` L184 `if (!entry.attrs.isDirectory() && !entry.attrs.isSymbolicLink()) continue`），文件树/上传下载必须能列文件 | 单测：含文件条目 + `.`/`..` 过滤 |
| 附加（GUI 需知配置）：`config.get` | ✅ 投影 file/exec/security（无秘密） | 单测 |

### 需求 5 —— 安全四则

| 项 | 实现 | 验证 |
|---|---|---|
| TOFU accept-new（沿底座） | ✅ 零代码：exec/file 都走 `registry().get(id)` 的 `SshConnection`，其 `HostKeyGuard` 默认 `accept-new`（connection.js L207-217 / registry.js L430） | 代码路径核对；部署后 RUNBOOK §5.4 实测 |
| PEM 0600 | ✅ `mkdirSync 0o700` + `writeFileSync {mode:0o600}` + `chmodSync 0o600`（纠正 umask） | 单测断言 mode |
| 命令白名单/确认 | ✅ `security.execAllowlist`（非空=首 token 精确匹配；空=不限制）+ 客户端确认模态 | 单测：`ls`/`lsusb` 前缀误放行被拒；白名单外 `rm -rf /` 拒绝 |
| 脱敏 | ✅ `redactText`/`redactError`（阈值规则与底座 `redactValues` 一致：<4 字符且无路径分隔符的值跳过）；覆盖 privateKeyPath/password/passphrase + 跳板链 | 单测：错误消息中私钥路径与口令 → `<redacted>`；keyref.set 错误不回显凭据值 |

---

## §3 验证证据（全部实跑，命令可复现）

| # | 验证 | 命令 | 结果 |
|---|---|---|---|
| V1 | 语法 | `node --check dsh-ssh-gui/lib/{core,index,client}.js` | ✅ 3/3 OK |
| V2 | 单测 | `node --test test/*.test.mjs` | ✅ **44/44 pass**（keyref 9 / exec 9 / file 7 / security 6 / dispatch 13；0 fail） |
| V3 | 部署脚本语法 | `bash -n deploy.sh` | ✅ OK |
| V4 | 部署 dry-run | `bash deploy.sh` | ✅ preflight（底座在位 + 3 文件语法 + 单测全绿）→ 完整计划打印；`ls ~/.dsh/profiles/node_modules/@local/` 无 `dsh-ssh-gui`，`cordis.patch.yml`/`settings.yaml` mtime 未变 = **零副作用** |
| V5 | host 模块 ESM 加载冒烟（/tmp 副本 + 依赖软链，不写 `~/.dsh`） | `import pkg from '@local/dsh-ssh-gui'` | ✅ `name=ssh-gui inject=["connection"] apply=function`；`Config` 为 schemastery 对象（keys: type/meta/toString/dict） |
| V6 | 依赖解析（从未来部署位置 `~/.dsh/profiles/node_modules/@local/dsh-ssh-gui/lib/index.js`） | `createRequire(...).resolve(...)` | ✅ `@deepseek-ai/schemastery` / `dsh-credentials` / `dsh-settings` / `dsh-workspace-enhancement` 全部 resolve（**零第三方依赖、无需任何 install**） |
| V7 | client bundle 冒烟（stub `window.__ModuleLoader__`/`document`） | 加载 `client.js` + 调 `factory(require)` | ✅ entry id `@local/dsh-ssh-gui`；`exports = {apply, inject}`；`inject=["slots","connection","sessions","workspaces"]` |
| V8 | client `apply()` 注册冒烟（fake slots） | 同上 + fake ctx | ✅ 两条注册：`{name:'settings.section', id:'@local/dsh-ssh-gui', order:50, label:'SSH 主机 · dsh-ssh-gui'}`、`{name:'conversation.session.header.actions', id:'@local/dsh-ssh-gui-actions', order:26, label:'SSH'}`，component 均为 function |
| V9 | client-modules 装配契约核对 | `dsh-client-modules/lib/index.js` L135-145/L395 | ✅ 声明 `dsh.client{platform:'web'}` 且 `exports["./client"]` 为字符串 → 满足 loader 必需条件 |
| V10 | 未写 `~/.dsh` / 未重启 / 未 install | `ls`/`stat` 复核 | ✅ 全部满足（本档严格执行"部署由主代理执行"） |

> 部署后（主代理执行）才可做的实测项：boot 出现新 client 条目、GUI 渲染、真机 SSH exec/上传下载、0600 产物落盘——步骤见 `RUNBOOK.md` §5。

---

## §4 自复核（对照目标与审计结论的遗漏/副作用检查）

**覆盖性检查**（对照审计 §2 缺失清单的 5 项）：
- ① keyRef 凭据绑定 → ✅ 实现（set/list/unbind + 0600 + 侧表 + machines.json 派生绑定）
- ② 连接状态指示 → 复用 `/dsw conn.status`（每行三态点 + 点击 probe），未新建视图（审计列其为"常驻状态视图"，属可选增强，**未扩范围**）
- ③ 持久文件树 + 上传下载 → ✅ 实现（自有文件树对话框 + file.list/get/put；底座 browse 只有目录的缺口被 file.list 补上）
- ④ 远端命令面板 → ✅ 实现（exec.run + 输出回显 + 再执行）
- ⑤ 多主机/会话管理 → 「远程主机」树覆盖多主机浏览与开工作区；会话↔主机显式绑定沿用底座 `session.ws.*`（未扩范围）

**副作用检查**：
- 未 disable/覆盖任何 profile 行；未注册任何既有 seam；未改底座/核心文件；未在 `~/.dsh` 落任何字节；未安装依赖；未重启进程。
- 插件独有写入面（运行期）：`ssh-keyrefs.json`、`.secrets/keys/<id>`、`machines.json` 的 `privateKeyPath` 字段——均在 `~/.dsh/remote-workspaces/`（底座既有信任域），且有 `keyref.unbind` + `deploy.sh --rollback` 两条退出路径。

**边界与降级诚实性**：
- `keyref.list` 的 ref 枚举：credentials seam **无 ref 枚举 API**（dsh-credentials-local 仅 `resolve/describe/set/unset` + 面向 scoped key 的 `listRecords`），故 ref 名由用户输入或从已绑定列表选择 + `describe` 报告 `configured`；已在 README/RUNBOOK 注明。
- 自有树对 symlink 目录不可下钻（`attrs.isDirectory()` 为 false）；底座目录流会跟随 symlink。属次要 UX 差异，已记录（§5-3）。

---

## §5 自裁决与问题清单

### 自裁决：**pass**（可交付主代理部署；无 blocker）

判据：全部执行要求（先核实 §0、交付物齐全、零 install、本地验证、不写 `~/.dsh`、自复核）已满足；44 项单测与 4 项冒烟全绿；两个 client 槽注册经 fake slots 实测通过；装配契约与依赖解析逐项核对通过。

### 问题清单（如实，含 1 项实现偏差与 4 项部署后实测项）

| # | 类型 | 内容 | 影响 / 处置 |
|---|---|---|---|
| P1 | **实现偏差（需主代理知悉）** | 需求 4 写"file.get/put（fastGet/fastPut，base64）"；实现用 `sftp.stat` 门 + `sftp.readFile`/`writeFile`（Buffer）→ base64。**理由**：`fastGet/fastPut` 的签名是 (remotePath, **localPath**)，要 base64 回 RPC 必须在 host 落临时文件再读删（额外磁盘明文 + 清理竞态）；`readFile/writeFile` 是 ssh2 同一 `fastXfer` 流引擎的内存安全封装（`SFTP.js` L502-514 fastGet/fastPut → `fastXfer`；readFile 先 stat 再读）。语义等价（SFTP 传输 + base64 + 上限），且**先 stat 后读**保证不会把超限文件读进内存 | 若主代理要求严格字面（含临时文件路径），返工点仅 `core.createDispatch` 的 file.get/put 两个分支 + `index.js` 的 SFTP 适配（约 30 行） |
| P2 | 部署后实测 | 真实 boot 条目 / GUI 渲染 / 真机 SSH exec 与上传下载 / 0600 产物落盘 | 部署 + 重启后按 `RUNBOOK.md` §5 执行（本档不得重启进程、不得写 `~/.dsh`，故无法在此验证） |
| P3 | 已知 UX 差异 | 自有树不跟随 symlink 目录（底座目录流跟随） | 可选改进（1 行 stat 跟随），非 blocker |
| P4 | 已知约束 | credentials 无 ref 枚举 API → ref 名需用户输入 | 已注明；升级路径：若 dsh-credentials 未来暴露 ref 列表，`keyref.list` 可直接补 candidates |
| P5 | 待用户裁量 | `keyref.unbind` 为审计清单（set/list）之外的补全项（生命周期完整性：从 keyRef 认证切回口令/agent 必需） | 已在 §2 需求 2 核对表注明；若判为超范围，删除该端点 + 客户端一个按钮即可（约 25 行） |

### 给主代理的部署指针

```bash
cd /home/CNS2026495165/dsh/.workspace/deploy-ssh-gui
bash deploy.sh              # dry-run（已验，零副作用）
bash deploy.sh --apply      # 真实部署（拷贝插件 + patch 1 行 insert + settings 段）
# 重启 dsh web → 按 RUNBOOK.md §5 验收（boot 条目 / 设置页 / header SSH 按钮 / keyRef 0600）
bash deploy.sh --rollback   # 回滚
```
