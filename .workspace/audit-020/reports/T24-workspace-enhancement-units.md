# T24 — `dsh-workspace-enhancement` 0.2.0 改造交付单元清单

- 轨道：T24（审计阶段，只读；本轮未改动任何产品代码）
- 目标版本：`0.2.0-rc.1`；现状基线：本机在跑 `0.1.1-rc.2`
- 本轨道定位：T17 的**深度补充**，聚焦源码级可执行改造单元，不重复 T17 的宏观结论
- 证据口径：**全部结论绑定当轮实测的 0.2.0 源码/类型文件行号**；未判定项在 §8 显式列出

---

## 1. 结论摘要

1. **插件源码定位**：插件是第三方包 `dsh-workspace-enhancement`（作者 DobyChao），**不是仓库内自研代码**。工作区内可读源码位于 `.workspace/workstreams/research/repos/dsh-workspace-enhancement`（git 仓库，**master = v0.1.4**）。**实际部署的构建产物等价于 tag `v0.1.2`**（`git archive v0.1.2 src` 的模块清单与部署 `lib/` 一一对应），仅客户端 bundle `lib/client.js` 有 3 处本地补丁（见 §2.4）。
2. **契约点规模**：共提取 **75 条**宿主契约点（A~F 六族；逐条见 §3，逐条核验见 §4）。核验结果：**存在 52 / 签名变化 17 / 消失 5 / 未判定 1**。**不兼容（签名变化 + 消失）合计 22 条**。
3. **最关键的 3 条发现**（详见 §4）：
   - **F-1（业务级致命）**：`ctx.settings` 在 0.2.0 由 `SettingsProvider` 变为 `SettingsForms`，**`get(ns)` 被彻底删除**。插件宿主侧语言解析 `locale/host.ts:61` 依赖 `settings.get('locale').preference`，且 0.2.0 `dsh-base/cordis.patch.yml:101-102` **确定会挂载 settings 行** ⇒ 宿主语言面（RPC 错误文案、工具描述、工作区标签、注册表标签）将在 0.2.0 上**抛 TypeError**，共 9 个调用点 / 6 个文件。
   - **D-1（能力级致命）**：`FileSystem` 在 0.2.0 **新增抽象方法 `readByteRange`**（`dsh-fs/lib/types/index.d.ts:197`），`SubprocessRuntime` **新增抽象方法 `terminalEnvironment`**（`dsh-subprocess/lib/types/index.d.ts:94`）。插件的 `SshFileSystem`/`MixedFileSystem`/`SshSubprocessRuntime`/`MixedSubprocessRuntime` 均未实现，而 0.2.0 官方消费者**确实会调用**（`dsh-api-workspace-files/lib/index.js:452`、`dsh-api-terminal-controller/lib/index.js:18`）⇒ 远程工作区文件预览/下载 与 远程会话 web 终端 直接 `TypeError`。
   - **E-1（安全语义级）**：`ctx.connection.rpc.handle()` 在 0.2.0 **由 3 参降为 2 参**，`options.authority: 'loopback'` 参数被删除（`dsh-client-connection/lib/types/rpc.d.ts:138`）。插件 `web.ts:525` 传入的第 3 参将被 **JS 静默忽略** ⇒ `/dsw` 通道原有的 loopback 信任约束**静默失效**，不报错、不告警。
4. **对协调者简报的重要更正**：简报称该插件为「insert-only（未 disable 官方缝）」。实测**不成立**：`~/.dsh/profiles/web/cordis.patch.yml:79-80` 明确 `- id: directory-picker-ssh` + `disabled: true`，即**官方配置禁用了插件自己的 picker 行**（以免与 `@deepseek-ai/dsh-host-directory-picker-browse` 重复注册 `directoryPicker`）；另有 `:72-73` 禁用官方 `directory-picker` 行。此外插件包自带 `cordis.patch.yml`（`dsh.bundle.patch`）内含 3 条 disable，**当前未应用**（profile 的 `dsh.profile.bundles` 仅 `dsh-base` + `dsh-web-app`）——但若 0.2.0 上改用 bundle 方式安装，这 3 条会生效并关闭官方本地 provider。
5. **显著简化机会存在**：0.2.0 的 `dsh-base` 已挂载官方本地 provider（`cordis.patch.yml:220-221` `@deepseek-ai/dsh-subprocess-local`、`:518-519` `@deepseek-ai/dsh-fs-sandbox`）。插件当前**从自己的私有依赖岛**（`node_modules/@deepseek-ai/*` 全部钉死 `0.1.1-rc.2`）重新 new 出**旧版** `LocalSubprocessRuntime`/`LocalFileSystem`/`SandboxedFileSystem` 并 `ctx.set` 顶掉官方实现。**丢掉私有岛、改为委托宿主已挂载的官方 provider，可消解 §5 中 6 个改造单元**（见 §6）。

---

## 2. 源码定位与文件清单

### 2.1 定位结论

| 用途 | 路径 | 版本 | 说明 |
|---|---|---|---|
| **部署实况（权威）** | `~/.dsh/profiles/node_modules/dsh-workspace-enhancement/` | `0.1.2` | 实际运行产物；`package-lock.json` 表明由 npm 就地安装 |
| **可读源码（本轮基线）** | `.workspace/audit-020/work/t24/src-012/src/` | `tag v0.1.2` | 本轮用 `git archive v0.1.2 src cordis.patch.yml package.json` 提取，**只读** |
| 上游 git 仓库（master） | `.workspace/workstreams/research/repos/dsh-workspace-enhancement/` | `0.1.4` | origin = `https://github.com/DobyChao/dsh-workspace-enhancement`；含 v0.1.0…v0.1.4 全 tag |
| 仓库内第二份镜像 | `.workspace/workstreams/research/research-dsh-workerspace/repos/dsh-workspace-enhancement/` | `0.1.4` | 同内容副本 |
| 历史审计副本（多份） | `workbuddy-reverse-proxy/_audit/*/home/profiles/node_modules/dsh-workspace-enhancement/` | 各期 | 隔离升级演练留下的快照 |
| npm tarball 对照 | `workbuddy-reverse-proxy/_audit/ws-enhance/npm/dwe-0.1.2.tgz`、`dwe-0.2.1.tgz` | — | 上下游对比用 |
| **0.2.0 宿主源码（核验基线）** | `.workspace/iso-020/npm-global/node_modules/@deepseek-ai/` | `0.2.0-rc.1` | 289 个包，完整 0.2.0 安装树 |
| 0.2.0 CLI 包 | `.workspace/dsh-020-pkg/x/package/` | `0.2.0-rc.1` | 协调者提供 |

> 复现基线的提取命令（只读 `git archive`，未写仓库）：
> ```
> cd .workspace/workstreams/research/repos/dsh-workspace-enhancement
> git archive v0.1.2 src cordis.patch.yml package.json \
>   | tar -x -C .workspace/audit-020/work/t24/src-012
> ```

### 2.2 部署实况与版本等价性证明

- `diff -rq <部署>/lib <npm-0.1.2 解包>/lib` 结果：**仅 `lib/client.js` 不同**，宿主侧全部字节一致。
- `tag v0.1.2` 的 `src/` 模块清单与部署 `lib/` 的 `.js` 文件清单**逐一对应**（宿主 22 个 + `client/` 11 个 + `locale/` 4 个），无多无缺。
  ⇒ **host 侧契约点以 tag v0.1.2 的 TS 源码行号为准是安全的**。

### 2.3 文件清单（v0.1.2，行数为文件行数上限参考）

| 层 | 入口 | 文件 |
|---|---|---|
| **宿主（聚合行）** | `src/index.ts` → `src/plugin.ts#apply` | `plugin.ts`（聚合挂载 + 混合 provider 装配） |
| 宿主 provider | — | `runtime.ts`（`ctx.ssh`）、`subprocess.ts`（`ctx.subprocess`）、`filesystem.ts`（`ctx.fs`）、`mixed.ts`（本地/远程路由 facade）、`process.ts`（SSH 子进程句柄）、`terminal.ts`（SSH PTY）、`output.ts`（输出读取器）、`exec-tools.ts`（`sw_*`/`bash` 工具 + system prompt 段）、`tools.ts`（工作区工具） |
| 连接与凭据 | — | `ssh-core.ts`、`connection.ts`、`transport.ts`、`credential.ts`、`hostkey.ts`、`environment.ts`、`listing.ts` |
| 多连接注册表 + RPC | `src/web.ts#apply` | `web.ts`（`SshRegistry` + `/dsw` RPC 通道）、`registry.ts`（`ctx.sshRegistry`）、`session-workspaces.ts`（`ctx.sideWorkspaces`） |
| **picker 后端** | `src/picker.ts`（`dsh-workspace-enhancement/picker`） | `picker.ts`（`SshDirectoryPicker extends DirectoryPicker`，注册为 `ctx.directoryPicker`） |
| 本地化 | — | `locale/index.ts`、`locale/host.ts`、`locale/dsw.ts`、`locale/dsw.en.ts` |
| **客户端** | `src/client/index.ts`（`dsh-workspace-enhancement/client`） | `client/index.ts`（slot 注册 + inject 面）、`client/flow.tsx`、`client/form.tsx`、`client/icons.tsx`、`client/machine-form.tsx`、`client/machine-payload.ts`、`client/row-badges.ts`（DOM 徽标层）、`client/settings.tsx`、`client/side-workspaces.tsx`、`client/status.tsx`、`client/ui.ts`（+2 个 `.module.css`） |
| 配置 | — | `cordis.patch.yml`（`dsh.bundle.patch`，含 3 条 disable）、`package.json`（`dsh.client.inject`） |

### 2.4 本地补丁（部署独有的 3 处 `lib/client.js` 改动）

`diff <npm-0.1.2>/lib/client.js <部署>/lib/client.js` = 58 行差异，3 个 hunk，均带 `dsh-perf-fix K1-3` 注释：

| # | 位置（部署 `lib/client.js`） | 内容 |
|---|---|---|
| P1 | ~4124 | 会话标题索引去重：`Array.from(new Set(ids))` + `unique[0] !== void 0` 守卫 |
| P2 | ~4561-4583 | machines `refresh` 的 keep-alive 守卫：`aliveRef` + `refreshGenerationRef` + 卸载 cleanup，防在飞 promise 落进已死组件 |
| P3 | ~5434-5452 | sessions 快照投影按 snapshot 身份记忆化（`cachedState`/`cachedRows`） |

⇒ **这三处本地补丁不在任何 tag 内**，重新安装（任何版本）都会丢失，必须单列改造单元（U18）。

### 2.5 私有依赖岛（迁移风险源）

`~/.dsh/profiles/node_modules/dsh-workspace-enhancement/node_modules/@deepseek-ai/` 存在 **65 个包**，关键项全部为 `0.1.1-rc.2`：

```
dsh-fs 0.1.1-rc.2        dsh-fs-local 0.1.1-rc.2     dsh-fs-sandbox 0.1.1-rc.2
dsh-subprocess 0.1.1-rc.2 dsh-subprocess-local 0.1.1-rc.2 dsh-tools 0.1.1-rc.2
dsh-host-directory-picker 0.1.1-rc.2  dsh-host-directory-picker-native 0.1.1-rc.2
dsh-llm / dsh-sandbox / dsh-sandbox-policy / dsh-timeout / dsh-session / dsh-settings 均 0.1.1-rc.2
@deepseek-ai/cordis 4.0.2   schemastery 3.18.2
```

v0.1.2 的 `package.json` 把这些钉在 `dependencies`（`^0.1.1-rc.2`），而 `files` 字段**不含 `node_modules`** ⇒ 该岛由就地 `npm install` 生成，**升级时可选择保留或丢弃**——这个选择直接决定 §5 中多个单元的存废（见 §6）。

---

## 3. 契约点总表（插件侧）

行号均为 `.workspace/audit-020/work/t24/src-012/src/` 下相对路径。族：A=cordis 核心；B=官方 provider 缝；C=tools/prompt/jobs；D=settings；E=宿主 connection；F=客户端。

### A. cordis 核心

| ID | 契约点 | 插件侧 | 类型 |
|---|---|---|---|
| A1 | `import { Context, Service } from '@deepseek-ai/cordis'` | `registry.ts:23`、`runtime.ts:16`、`picker.ts:38`、`session-workspaces.ts:26`、`subprocess.ts:16` | import |
| A2 | `Context` / `Service` 类型与基类 | 同上 + `filesystem.ts:14`、`transport.ts:22`、`exec-tools.ts:25`、`web.ts:14`、`plugin.ts:24`、`tools.ts:13`、`locale/host.ts:21`、`client/index.ts:18` | 类型 |
| A3 | `ctx.set(name, value)` | `plugin.ts:96`、`plugin.ts:97`（`owner.set('fs', …)`） | 方法 |
| A4 | `ctx.get(name)` / `ctx.get(name, false)`（可选读取） | `plugin.ts:87`、`plugin.ts:109`、`web.ts:227`、`web.ts:240`、`exec-tools.ts:706`、`exec-tools.ts:725`、`locale/host.ts:61`、`client/index.ts:168`、`client/index.ts:214`、`client/index.ts:216`、`client/index.ts:231` | 方法 |
| A5 | `ctx.effect(fn, label)` | `web.ts:526`、`exec-tools.ts:840`、`exec-tools.ts:846`、`exec-tools.ts:992`、`exec-tools.ts:998`、`runtime.ts:239`、`subprocess.ts:55`、`locale/index.ts:66` | 方法 |
| A6 | `ctx.inject([...], cb)` | `plugin.ts:110` | 方法 |
| A7 | `ctx.plugin(Class, config?)` | `plugin.ts:126`、`plugin.ts:135`、`plugin.ts:136`、`web.ts:219` | 方法 |
| A8 | `ctx.on('session/created', handler)` | `plugin.ts:62` | 事件 |
| A9 | `ctx.logger.warn` / `.info` | `plugin.ts:134`、`registry.ts:697`、`registry.ts:699`、`registry.ts:1440` | 成员 |
| A10 | `declare module '@deepseek-ai/cordis' { interface Context {…} }` 模块增强 | `web.ts:56-69`（注入 `connection.rpc.handle` 面） | 类型 |
| A11 | `Service` 子类 + `super(ctx, <name>)` 注册 | `runtime.ts:155/195`（`'ssh'`）、`registry.ts:628/677`（`'sshRegistry'`）、`session-workspaces.ts:301/307`（`'sideWorkspaces'`） | 基类 |
| A12 | cordis 依赖版本 | `package.json` `@deepseek-ai/cordis ^4.0.1` | 依赖 |

### B. 官方 provider 缝

| ID | 契约点 | 插件侧 | 类型 |
|---|---|---|---|
| B1 | `ctx.subprocess` 服务名 + `SubprocessRuntime` 基类 | `plugin.ts:96`（`ctx.set('subprocess', …)`）、`subprocess.ts:181-188`（`SshSubprocessRuntime extends SubprocessRuntime`，`static inject=['ssh']`）、`mixed.ts:101-103/169-191`（`MixedSubprocessRuntime`） | 服务+基类 |
| B2 | `SubprocessRuntime.resolveExecutable / spawn / spawnTerminal` | `subprocess.ts`、`mixed.ts:169/174/183` | 抽象方法 |
| B3 | `SubprocessHandle` 面（`pid`/`stdin`/`stdout`/`stderr`/`collected`/`done`/`terminate`/`waitForExit`） | `process.ts`（`SshSubprocessHandle`） | 接口 |
| B4 | `SubprocessTerminalHandle` 面（`pid`/`output`/`done`/`write`/`inspectForeground`/`signalForeground`/`terminate`） | `terminal.ts`（`SshTerminalHandle`） | 接口 |
| B5 | `SubprocessSpawnSpec` / `SubprocessTerminalSpawnSpec` 字段 | `subprocess.ts`、`terminal.ts`、`process.ts` | 接口 |
| B6 | `SENSITIVE_ENV_PATTERN` | `environment.ts:3` | import |
| B7 | `CollectedOutput` / `SubprocessOutputRead` / `SubprocessOutputReader` | `output.ts:8` | 类型 |
| B8 | `MAX_TIMER_DELAY_MS` | `subprocess.ts:24`（grace 上界校验 `:37-41`） | 常量 |
| B9 | `ctx.fs` 服务名 + `FileSystem` 基类 | `plugin.ts:97`（`owner.set('fs', …)`）、`filesystem.ts:589-595`（`SshFileSystem extends FileSystem`，`static inject=['ssh']`）、`mixed.ts:193-227/229-…`（`MixedFileSystem`） | 服务+基类 |
| B10 | `FileSystem` 抽象方法（`resolve`/`processPath`/`fileUrl`/`contains`/`stat`/`lstat`/`readText`/`streamText`/`readBytes`/`listDir`/`writeText`/`editText`） | `filesystem.ts:154-353`、`filesystem.ts:599-…`、`mixed.ts:241-357` | 抽象方法 |
| B11 | `FsError` / `FsTargetKey` / `FsVersion` | `filesystem.ts:15` | import |
| B12 | `FsDirEntry`/`FsEditOutcome`/`FsEditRequest`/`FsInfo`/`FsPathInfo`/`FsTarget`/`FsWriteIntent`/`FsWriteOutcome` | `filesystem.ts:16-25`、`mixed.ts:34-35` | 类型 |
| B13 | `LocalSubprocessRuntime`（官方本地实现类） | `plugin.ts:27`，构造 `plugin.ts:93` | import+构造 |
| B14 | `LocalFileSystem` | `plugin.ts:28`，构造 `plugin.ts:117` | import+构造 |
| B15 | `SandboxedFileSystem` | `plugin.ts:29`，构造 `plugin.ts:111` | import+构造 |
| B16 | `ctx.directoryPicker` 服务名 + `DirectoryPicker` 基类 + `capability()` | `picker.ts:124-126`（`SshDirectoryPicker extends DirectoryPicker`，`static inject=['ssh']`）、`picker.ts:146` | 服务+基类 |
| B17 | `DirectoryPickerError` | `picker.ts:40` | import |
| B18 | `DirectoryEntry` / `DirectoryListing` / `DirectoryPickerBrowseCapability` / `DirectoryPickerCapability` | `picker.ts:41-46` | 类型 |
| B19 | `pickNativeDirectory` | `web.ts:16` | import |
| B20 | `ctx.ssh` 自注册服务（被 B1/B9/B16 消费） | `runtime.ts:195`；消费点 `subprocess.ts:66`、`filesystem.ts:375`、`picker.ts:167/225/237/306`、`transport.ts` | 自有 |
| B21 | `ctx.sandboxPolicy` + `ctx.inject(['sandboxPolicy'])` | `plugin.ts:109`、`plugin.ts:110` | 服务 |
| B22 | `setSandboxMode(session, mode)` | `plugin.ts:25`、`plugin.ts:64`（`session/created` 强制 `danger-full-access`） | import |

### C. tools / system-prompt / jobs

| ID | 契约点 | 插件侧 | 类型 |
|---|---|---|---|
| C1 | `ctx.tools.register(definition): () => void` | `exec-tools.ts:839`、`exec-tools.ts:991` | 服务方法 |
| C2 | `defineTool(options)` | `exec-tools.ts:27`、`tools.ts:14` | import |
| C3 | `parameterSchemaSpecToJsonSchema` | `exec-tools.ts:27`、`locale/host.ts:23` | import |
| C4 | `TOOL_ABORTED` | `exec-tools.ts:27` | import |
| C5 | `ParameterSchemaSpec` / `ToolRunContext` | `exec-tools.ts:28`、`tools.ts:15`、`locale/host.ts:22` | 类型 |
| C6 | `ctx.systemPrompt.section(section): () => void` | `exec-tools.ts:841`、`exec-tools.ts:993` | 服务方法 |
| C7 | `ctx.jobs.start(spec): JobId`（本地最小面声明） | `exec-tools.ts:509-517`、调用 `exec-tools.ts:725`、`exec-tools.ts:814/819`、`exec-tools.ts:934/939` | 服务方法 |
| C8 | `HarnessError` | `exec-tools.ts:26` | import |

### D. settings

| ID | 契约点 | 插件侧 | 类型 |
|---|---|---|---|
| D1 | `ctx.get('settings', false)` → `settings.get('locale')?.preference` | `locale/host.ts:61`（`hostLocaleOf`，定义 `:60`） | 服务读取 |
| D2 | `HostLocaleSettings.get(namespace)` 最小结构面声明 | `locale/host.ts:32-35` | 本地类型 |
| D3 | `hostLocaleOf(ctx).t` 的调用面（9 处 / 6 文件） | `registry.ts:719`、`web.ts:224`、`exec-tools.ts:745`、`exec-tools.ts:882`、`transport.ts:149`、`transport.ts:155`、`transport.ts:172`、`session-workspaces.ts:361`、`tools.ts:284` | 内部消费 |

### E. 宿主 connection（`/dsw` RPC 通道）

| ID | 契约点 | 插件侧 | 类型 |
|---|---|---|---|
| E1 | `ctx.connection.rpc.handle(channel, handler, options)` | `web.ts:525`（`handle('/dsw', dispatch, { authority: 'loopback' })`）+ 清理 `web.ts:526` | 服务方法 |
| E2 | handler 签名 `(endpoint, payload, signal) => Promise<Result>` | `web.ts` `dispatch`（`web.ts:56-69` 的本地增强声明） | 回调签名 |
| E3 | 结果信封 `{ok:true,value} \| {ok:false,error:{code,message,details?}}` | `web.ts:36-38`（`ChannelResult` 本地声明） | 类型 |
| E4 | `ctx.get('sshRegistry')`（自有服务跨行读取） | `web.ts:227` | 服务读取 |
| E5 | `ctx.get('sideWorkspaces', false)` | `web.ts:240`、`web.ts:527` | 服务读取 |

### F. 客户端契约

| ID | 契约点 | 插件侧 | 类型 |
|---|---|---|---|
| F1 | `dsh.client.inject` 包清单（含 `@deepseek-ai/dsh-client-runtime`） | `package.json` `dsh.client.inject`（6 项） | 清单 |
| F2 | 客户端 inject 服务名 `['slots','workspaces','sessions','locale']` | `client/index.ts:145` | 清单 |
| F3 | `ctx.locale.register('dsw', {zh, en})` | `locale/index.ts:66`（经 `client/index.ts` 调用 `registerDswLocale`） | 服务方法 |
| F4 | `ctx.locale.bind('dsw')` | `client/index.ts:162`、`client/index.ts:233` | 服务方法 |
| F5 | `ctx.slots.inject(name, cb)`（含 generator 形态） | `client/index.ts:173`、`client/index.ts:174`、`client/index.ts:182`、`client/index.ts:195` | 服务方法 |
| F6 | `ctx.slots.register({name, locale, inject, id, order, label}, Component)` | `client/index.ts:175-181`、`client/index.ts:178-181`、`client/index.ts:183-193`、`client/index.ts:196-203` | 服务方法 |
| F7 | slot 名 `conversation.hero.workspace.directoryFlow` | `client/index.ts:173`、`client/index.ts:176` | 槽位名 |
| F8 | slot 名 `sidebar.workspaces.directoryFlow` | `client/index.ts:174`、`client/index.ts:179` | 槽位名 |
| F9 | slot 名 `settings.section` | `client/index.ts:182`、`client/index.ts:184` | 槽位名 |
| F10 | slot 名 `conversation.session.header.actions` | `client/index.ts:195`、`client/index.ts:197` | 槽位名 |
| F11 | `ctx.workspaces.listDirectory(path?, signal?)` | `client/index.ts:165` | 服务方法 |
| F12 | `ctx.workspaces.createDirectory(path, name)` | `client/index.ts:166` | 服务方法 |
| F13 | `ctx.get('workspaces')`（含 `.list` 快照面） | `client/index.ts:214` | 服务读取 |
| F14 | `ctx.get('sessions')`（`.list` 快照，`byId[].displayTitle` / `.cwd`） | `client/index.ts:216`（消费于 `client/row-badges.ts`） | 服务读取 |
| F15 | `ctx.get('connection')` + `connection.rpc.call('/dsw', endpoint, payload, signal)` | `client/index.ts:168`、`client/index.ts:231` | 服务读取 |
| F16 | `LocaleNamespaceMap` 模块增强（`dsw` 命名空间） | `locale/dsw.ts:27`、`client/settings.tsx:16`、`client/flow.tsx:12`、`client/status.tsx:15`、`client/side-workspaces.tsx:14`、`client/form.tsx:11`、`client/machine-form.tsx:25`、`client/row-badges.ts:45` | 类型 |
| F17 | 侧栏行徽标 DOM 层（`MutationObserver` + 行选择器） | `client/row-badges.ts:263-575`（`data-dsw-badge` 自持标记，`:278`） | DOM 契约 |

---

## 4. 核验矩阵（0.2.0 源码逐条）

图例：**存在** / **签名变化** / **消失** / **未判定**

### 4.1 A 族 — cordis 核心

| ID | 0.2.0 证据（文件:行） | 判定 | 说明 |
|---|---|---|---|
| A1 | `cordis/lib/types/index.d.ts`（导出 `Context`、`Service`） | **存在** | 包名未变 |
| A2 | `cordis/lib/types/context.d.ts:1-…`、`cordis/lib/types/reflect.d.ts`（`Service`） | **存在** | `context.d.ts` **与 4.0.2 逐字节相同**（`diff` 0 行） |
| A3 | `cordis/lib/types/context.d.ts`（`set`） | **存在** | 同上，签名未变 |
| A4 | `cordis/lib/types/context.d.ts`（`get(name, strict?)`） | **存在** | 双参形态保留 |
| A5 | `cordis/lib/types/context.d.ts`（`effect`） | **存在** | — |
| A6 | `cordis/lib/types/context.d.ts`（`inject`） | **存在** | — |
| A7 | `cordis/lib/types/context.d.ts`（`plugin`） | **存在** | — |
| A8 | `cordis/lib/types/events.d.ts`（`session/created` 由 `dsh-session` 声明） | **存在** | — |
| A9 | `cordis/lib/types/logger.d.ts`（`warn`/`info`） | **存在** | `logger.d.ts` diff 0 行 |
| A10 | `cordis/lib/types/index.d.ts`（模块增强仍受支持） | **存在** | — |
| A11 | `cordis/lib/types/service.d.ts`（`Service` 构造 `(ctx, name)`） | **存在** | `service.d.ts` diff 0 行 |
| A12 | `cordis/package.json` version = `4.0.4` | **签名变化（非破坏）** | 4.0.2 → 4.0.4；`events.d.ts:230` `internal/update` 的 `next` 由 `() => void \| Promise<void>` 收紧为 `() => void`；`fiber.d.ts:199` `update()` 返回 `void`。插件未直接使用这两个 API |

> 结论：**cordis 层零破坏性变更**。A12 只要求 `package.json` peer/dep 段对齐。

### 4.2 B 族 — provider 缝（不兼容集中区）

| ID | 0.2.0 证据（文件:行） | 判定 | 说明 |
|---|---|---|---|
| B1 | `dsh-subprocess/lib/types/index.d.ts:43`（`subprocess: SubprocessRuntime`） | **存在** | 服务名与服务面保留 |
| B2 | `dsh-subprocess/lib/types/index.d.ts:88/94/102/110` | **签名变化** | 基类抽象方法由 3 个变 4 个：**新增 `abstract terminalEnvironment(signal?)` @ `:94`**（旧 0.1.1-rc.2 仅 `resolveExecutable:84`/`spawn:91`/`spawnTerminal:99`）。插件的 `SshSubprocessRuntime`（`subprocess.ts:181`）与 `MixedSubprocessRuntime`（`mixed.ts:162`）**均未实现** |
| B3 | `dsh-subprocess/lib/types/types.d.ts:158-182` | **签名变化** | **`pid` 被删**（旧 `types.d.ts:156`），**新增 `readonly control: Duplex \| undefined` @ `:164`**。插件的 `SshSubprocessHandle` 实现了 `pid` 却不提供 `control` |
| B4 | `dsh-subprocess/lib/types/types.d.ts:240-277` | **签名变化** | **新增 `resize(cols, rows): Promise<void>` @ `:255`**、**新增 `inspectActivity(): Promise<SubprocessTerminalActivity>` @ `:265`**。插件的 `SshTerminalHandle`（`terminal.ts`）两者皆无 |
| B5 | `dsh-subprocess/lib/types/types.d.ts:71-98`（`SubprocessSpawnSpec`）、`:200-216`（`SubprocessTerminalSpawnSpec`） | **签名变化** | `SubprocessSpawnSpec` 新增可选 `control?: 'pipe'`；`SubprocessTerminalSpawnSpec` **新增必填 `terminalType: string` @ `:210`** + 可选 `shellActivity?: boolean` @ `:212`。插件 `spawnTerminal` 不透传 `terminalType`（远端 PTY 的 `$TERM`） |
| B6 | `dsh-subprocess/lib/types/index.d.ts:22`（`export declare const SENSITIVE_ENV_PATTERN: RegExp`） | **存在** | 语义相同（`lib/index.js:32` `/KEY\|PASSWORD\|SECRET\|TOKEN/i`） |
| B7 | `dsh-subprocess/lib/types/index.d.ts`（`CollectedOutput`/`SubprocessOutputRead`/`SubprocessOutputReader` 全部 re-export） | **存在** | — |
| B8 | `dsh-timeout/lib/types/index.d.ts`（`MAX_TIMER_DELAY_MS`） | **存在** | `dsh-timeout` 表面 diff 为空 |
| B9 | `dsh-fs/lib/types/index.d.ts:17`（`fs: FileSystem`） | **存在** | — |
| B10 | `dsh-fs/lib/types/index.d.ts` 抽象成员清单 | **签名变化** | **新增 `abstract readByteRange(target, {offset,length}, signal?)` @ `:197`**。插件 `SshFileSystem`（`filesystem.ts:589`）、`SshFileSystemEngine`（`filesystem.ts:135`）、`MixedFileSystem`（`mixed.ts:229`）**均未实现** |
| B10b | `dsh-fs/lib/types/index.d.ts:71` + `dsh-fs/lib/index.js:70-73` | **签名变化** | **新增非抽象 `watch(target, changed, signal)`**，基类实现即 `Promise.reject(new FsError(…, 'FS_IO_ERROR'))` ⇒ 远端不可监视；`MixedFileSystem` 未覆写 ⇒ **本地分支的 watch 也退化为 reject** |
| B10c | `dsh-fs/lib/types/index.d.ts:115` | **存在** | 新增非抽象 `processPathFromHostPath()`，基类返回 `undefined` —— 对远端 provider 是**正确语义**，无需改造 |
| B11 | `dsh-fs/lib/types/index.d.ts`（`FsError`/`FsTargetKey`/`FsVersion`） | **存在** | `dsh-fs` 表面 diff **仅**新增项，无删除 |
| B12 | `dsh-fs/lib/types/index.d.ts`（8 个 `Fs*` 类型全在） | **存在** | — |
| B13 | `dsh-subprocess-local/lib/types/index.d.ts`（`LocalSubprocessRuntime`） | **存在** | 实际类本体大幅扩展（新增 50+ 内部符号），公开类名保留 |
| B14 | `dsh-fs-local/lib/types/index.d.ts`（`LocalFileSystem`） | **存在** | — |
| B15 | `dsh-fs-sandbox/lib/types/index.d.ts`（`SandboxedFileSystem`） | **存在** | — |
| B16 | `dsh-host-directory-picker/lib/types/index.d.ts:82`（`directoryPicker: DirectoryPicker`）、`:98`（`abstract capability()`） | **存在** | 抽象成员集合**未变**（旧 `:125` 同签名）；`DirectoryEntry`/`DirectoryListing` 迁到 `./types.ts` 但**从包根 re-export**，import 路径不受影响 |
| B17 | `dsh-host-directory-picker/lib/types/index.d.ts`（`DirectoryPickerError`） | **存在** | — |
| B18 | `dsh-host-directory-picker/lib/types/index.d.ts`（4 个 capability/entry 类型） | **存在** | — |
| B19 | `dsh-host-directory-picker-native/lib/types/index.d.ts`（`pickNativeDirectory`） | **存在** | — |
| B20 | 插件自有 `ctx.ssh` | — | 自注册，无外部契约 |
| B21 | `dsh-sandbox-policy/lib/types/index.d.ts:30`（`sandboxPolicy: SandboxPolicyService`） | **存在** | — |
| B22 | `dsh-sandbox-policy/lib/types/session-mode.d.ts:49`（`setSandboxMode(session: Session, mode: SandboxMode): void`） | **存在** | 与 0.1.1-rc.2 完全一致。**注意**：同包删除了 `effectiveSandboxMode`（旧 `types/index.d.ts`），**插件未使用**，无影响 |

### 4.3 C 族 — tools / system-prompt / jobs

| ID | 0.2.0 证据（文件:行） | 判定 | 说明 |
|---|---|---|---|
| C1 | `dsh-tools/lib/types/index.d.ts:636`（`register(definition: ToolDefinition): () => void`） | **存在** | 与旧 `:603` 同签名 |
| C2 | `dsh-tools/lib/types/schema.d.ts:248`（`defineTool<…>(options)`） | **存在** | 与旧 `:239` 同签名 |
| C3 | `dsh-tools/lib/types/schema.d.ts`（`parameterSchemaSpecToJsonSchema`） | **存在** | — |
| C4 | `dsh-tools/lib/types/index.d.ts`（`TOOL_ABORTED`） | **存在** | — |
| C5 | `dsh-tools/lib/types/schema.d.ts`（`ParameterSchemaSpec`、`ToolRunContext`） | **存在** | `DefineToolOptions` 仅**新增可选** `deferLoading?: true`@`:195`、`projectContent?`@`:217`，无删除、无必填新增 |
| C6 | `dsh-system-prompt/lib/types/index.d.ts:239`（`section(section: PromptSection): () => void`） | **存在** | 与旧 `:187` 同签名 |
| C7 | `dsh-system-prompt/lib/types/index.d.ts:47-62`（`PromptSection`） | **存在** | 新增可选 `interpolate?: boolean`@`:62`；必填仍为 `name`/`order`/`text` |
| C8 | `dsh-jobs/lib/types/index.d.ts:71`（`abstract start(spec: JobSpec): JobId`） | **存在** | 返回 `JobId` 未变 |
| C9 | `dsh-jobs/lib/types/types.d.ts:117`（`JobSpec`）、`:128`（`owner?: SessionId`） | **签名变化** | 类型名 `JobStart` → `JobSpec`；`owner` 由 `Agent` → `SessionId`。插件 `exec-tools.ts:509-517` 的本地面写 `owner?: unknown`，需按 `SessionId` 收窄 |
| C10 | `dsh-jobs/lib/types/types.d.ts:148`（`run(job: JobHandle): JobHooks`） | **签名变化** | 由零参 `run(): JobHooks`（旧 `types.d.ts:61`）改为**接收 `JobHandle`**。JS 层面多传参不报错，但拿不到 job 句柄就无法用新的输出写入面 |
| C11 | `dsh-jobs/lib/types/types.d.ts:102/109`（`JobHooks` 仅 `cancel`/`done`）、`:140`（`JobSpec.output?`）、`JobHandle:88`（`append(text, options?)`） | **消失** | **`JobHooks.readOutput?(): string`（旧 `types.d.ts:82`）被删除**。插件 `exec-tools.ts:515` 声明并依赖它，`:814/819`、`:934/939` 用 `incrementalRead()` 接线 ⇒ 后台 `sw-exec` 的增量输出读取在 0.2.0 无对应缝 |
| C12 | `dsh-jobs/lib/types/index.d.ts:77/:85`（`list/get` 的 `caller?: SessionId`） | **签名变化（弱）** | 由 `Agent` → `SessionId`；插件仅调 `start`，**实际不影响** |

### 4.4 D 族 — settings（业务级致命项）

| ID | 0.2.0 证据（文件:行） | 判定 | 说明 |
|---|---|---|---|
| D1 | `dsh-settings/lib/types/index.d.ts:27`（`settings: SettingsForms`）、`:62`（`class SettingsForms extends Service`）、成员清单 `:75-114` | **消失** | **`get(ns)` 不存在于 0.2.0 的 settings 服务**（旧 `dsh-settings/lib/types/index.d.ts:239` `get(ns: SettingsNamespace): unknown`）。0.2.0 成员为 `configure`@`:80`、`get writable`@`:75`、`get documentPath`、`prepareDocument`@`:91`、`describe`@`:96`、`update`@`:102`、`replace`@`:108`、`mutate`@`:114` |
| D2 | `dsh-settings/lib/types/index.d.ts:27` vs 旧 `:114`（`settings: SettingsProvider`） | **签名变化** | 服务实现类型名由 `SettingsProvider` → `SettingsForms` |
| D3 | `dsh-settings/lib/types/index.d.ts:80`（`configure(presentation:{auto?}, owner?: Fiber)`）vs 旧 `:225`（`register<T>(ns, schema, options)`） | **签名变化** | 注册面由 `register(命名空间+schema)` 改为声明式 `configure(页面策略)`；**插件未使用 register**，无直接影响 |
| D4 | `dsh-settings/lib/types/index.d.ts:8-19`（`SettingsDescriptor{ ns, autoGenerate, schema, value, revision, base?, user?, applies, secrets? }`） | **存在** | `describe()` 返回的 descriptor **携带 `ns` + `value`**，是本轮唯一可用的「读取某命名空间当前值」路径 |
| D5 | `dsh-base/cordis.patch.yml:101-102`（`- id: settings` / `name: '@deepseek-ai/dsh-settings'`，配 `:103 disabled: !!js "!ctx.get('profileContext')"`） | **存在（且正常 profile 启动下必挂）** | 该行仅在**缺 `profileContext` 服务时**才被禁用（`!!js` 表达式，`:103`）；正常 profile 启动由 `dsh-app-boot/profile-context` 提供 `profileContext`（`dsh-app-boot/lib/types/profile-context.d.ts:29`）⇒ 服务处于启用态。**故 D1 不是「服务缺失时优雅降级」，而是必然的类型错误崩溃**（`settings?.get(...)` 只护 undefined 服务，不护缺失方法） |

### 4.5 E 族 — 宿主 connection

| ID | 0.2.0 证据（文件:行） | 判定 | 说明 |
|---|---|---|---|
| E1 | `dsh-client-connection/lib/types/rpc.d.ts:138`（`handle(channel: string, handler: ConnectionRpcHandler): () => Promise<void>`）vs 旧 `lib/types/rpc.d.ts:23`（3 参含 `options: ConnectionRpcHandlerOptions{authority}`） | **签名变化** | **`options.authority` 参数被删除**。插件 `web.ts:525` 的第 3 参将被静默丢弃；`intercept` 同样由 4 参降为 3 参（`:148`） |
| E2 | `dsh-client-connection/lib/types/rpc.d.ts:103`（`ConnectionRpcHandler = (endpoint, payload, signal, peer: PeerScope) => Promise<ConnectionRpcHandlerResult>`）vs 旧 `:11`（3 参） | **签名变化** | 新增第 4 参 `peer: PeerScope`（`PeerScope` 来自 `@deepseek-ai/dsh-typert-protocol`） |
| E3 | `dsh-client-connection/lib/types/rpc.d.ts:13-42`（`ConnectionRpcFailure.details: object` 必填；`ConnectionRpcHandlerResult` 成功分支新增可选 `attachments?`） | **签名变化（弱）** | 插件 `web.ts:36-38` 的本地 `ChannelResult` 把 `details` 声明为可选，需对齐为必填 |
| E4 | `dsh-client-connection/lib/types/rpc-host.d.ts:9`（`connection: HostConnectionHandle`） | **存在** | 服务名保留；`HostConnectionHandle` 面被大幅扩展（`:130-180` 新增 `fetch`/`operator`/`createSharedFetchHandler`/`requestRejection`/`admit`/`authorizeIndex`/`authenticatedUrl`），**均为新增，不破坏既有 `rpc.handle` 调用** |
| E5 | 插件自有 `ctx.sshRegistry` / `ctx.sideWorkspaces` | — | 自注册，无外部契约 |

### 4.6 F 族 — 客户端

| ID | 0.2.0 证据（文件:行） | 判定 | 说明 |
|---|---|---|---|
| F1 | 0.2.0 安装树**无** `@deepseek-ai/dsh-client-runtime`；旧版本存在于 `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-runtime`（`0.1.1-rc.2`）与插件私有岛内 | **消失** | 插件 `dsh.client.inject` 含该名 ⇒ **依赖不可满足** |
| F2 | `dsh-client-ui-renderer/lib/types/client/index.d.ts:27`（`slots: SlotRegistry`） | **签名变化** | 服务名 `slots` 保留，但**提供者包由 `dsh-client-runtime` 迁到 `dsh-client-ui-renderer`**（旧 `dsh-client-runtime/lib/types/client/index.d.ts:109`） |
| F3 | `dsh-client-locale/lib/types/client/index.d.ts:59`（`locale: LocaleRuntime`） | **存在** | 包与服务名均保留（旧同位置 `:46`） |
| F4 | 0.2.0 `dsh-client-locale/lib/types/client/index.d.ts:199`（双参重载 `register<N>(ns: N, dicts: Record<BuiltInLocaleId, LocaleDictOf<N>>)`）、`:209`（三参重载）、`:226`（`bind(ns: string): Translate`）；`LOCALE_IDS = ["zh","en"]`（`locale-settings.d.ts:10`） | **存在** | 插件 `locale/index.ts:66` 用的是**双参**重载（`register('dsw', {zh, en})`），旧版即存在（旧 `dsh-client-locale/lib/types/client/index.d.ts:150`）。`BuiltInLocaleId`（新 `locale-settings.d.ts:12`）= 旧 `LocaleId`（旧 `:10`）= `'zh' \| 'en'` ⇒ **无破坏** |
| F5 | `dsh-client-ui-renderer/lib/types/client/registry.d.ts:111`（`inject(key, callback: () => SlotInjectionEffect): () => void`） | **存在** | 插件 `client/index.ts:173-181` 的嵌套 generator 形态未发现破坏 |
| F6 | `dsh-client-ui-slots/lib/types/index.d.ts:789`（`register<K, …, N extends (keyof LocaleNamespaceMap & string) \| undefined, …>(options, Component)`，`options.locale?: keyof LocaleNamespaceMap & string` @ `:131`） | **存在** | 4 个注册点的选项形态未发现必填新增（**逐字段差异见 §8 N5**） |
| F7 | `dsh-client-ui-workspace/lib/types/client/contract/slots.d.ts:102`（`conversation.hero.workspace.directoryFlow`）、`:195`（`DirectoryFlowSlotName` 联合）、`:450`（`WorkspacePickerProps` 渲染该槽） | **存在** | — |
| F8 | `dsh-client-ui-workspace/lib/types/client/contract/slots.d.ts:108`、`:195`、`:433`（`WorkspaceBrowserProps`） | **存在** | — |
| F9 | `dsh-client-ui-settings/lib/types/client/contract/slots.d.ts:73`（`settings.section`） | **存在** | — |
| F10 | `dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts:155`（`conversation.session.header.actions`）、`:534`（`ConversationSessionHeaderSlotProps` 渲染该槽） | **存在** | — |
| F11 | `dsh-api-workspace-controller/lib/types/client/service.d.ts:38`（`IWorkspaces`）——**该接口内无 `listDirectory`/`createDirectory`** | **消失** | 方法已迁到 `dsh-client-ui-workspace/lib/types/client/navigation.d.ts:138/139`（`UiWorkspace.listDirectory/createDirectory`） |
| F12 | 同上 | **消失** | 同 F11 |
| F13 | `dsh-api-workspace-controller/lib/types/client/index.d.ts:19`（`workspaces: import('./service.ts').IWorkspaces`） | **签名变化** | 服务名 `workspaces` 仍在，但**面已收窄**（导航/目录 UI 能力被拆到 `uiWorkspace`，见 `dsh-client-ui-workspace/.../navigation.d.ts:94`）⇒ 插件 `ctx.get('workspaces')` 取 `.list` 快照的用法需改判 |
| F14 | `dsh-api-session-controller/lib/types/client/index.d.ts:29`（`sessions: ISessions`）；`.../contract/sessions.d.ts:43-52`（`SessionListState{ ids, byId, phase, projectionsBySession }`）；`.../sessions/service.d.ts:21/22`（`SessionSummary.displayTitle: string`、`cwd?: string`） | **存在** | 服务名与数据结构**均保留**（提供者包由 `dsh-client-runtime` 迁到 `dsh-api-session-controller`）。注意 0.2.0 `SessionListState` **删除了 `current`/`subagentsByParent`/`jobsBySession`/`currentAddress`**，插件只读 `byId[].displayTitle`/`.cwd` ⇒ 不受影响 |
| F15 | `dsh-client-connection/lib/client.js:1477`（`ctx.provide("connection", handle)`）；`lib/types/client/index.d.ts:89`（`ConnectionHandle.rpc: ClientConnectionRpc`）；`lib/types/rpc.d.ts:218`（`call(channel, endpoint, payload, signal?)`） | **存在** | 客户端 `connection` 服务与 `rpc.call` **签名逐字未变**；结果类型名 `RpcResult`→`ConnectionRpcResult` 但 0.2.0 `rpc.d.ts:44` 保留 `RpcResult<T>` 别名 ⇒ 兼容 |
| F16 | `dsh-client-ui-slots/lib/types/index.d.ts:30`（`interface LocaleNamespaceMap`）、`:67`（`TranslateNS`）、`:73`（`LocaleDictOf`） | **存在** | 三个类型均保留，`dsw` 命名空间模块增强形态可用 |
| F17 | 未在 0.2.0 中核验官方侧栏 DOM 结构/类名 | **未判定** | 见 §8 |

### 4.7 矩阵汇总

逐行统计（§4.1~§4.6 的行数即契约点数）：

| 判定 | §4.1 A | §4.2 B | §4.3 C | §4.4 D | §4.5 E | §4.6 F | 合计 |
|---|---|---|---|---|---|---|---|
| **存在** | 11 | 18 | 8 | 2 | 2 | 11 | **52** |
| **签名变化** | 1 | 6 | 3 | 2 | 3 | 2 | **17** |
| **消失** | 0 | 0 | 1 | 1 | 0 | 3 | **5** |
| **未判定** | 0 | 0 | 0 | 0 | 0 | 1 | **1** |
| **小计** | 12 | 24 | 12 | 5 | 5 | 17 | **75** |

明细：

| 判定 | ID |
|---|---|
| **存在（52）** | A1-A11（11）；B1、B6-B9、B10c、B11-B22（18）；C1-C8（8）；D4、D5（2）；E4、E5（2）；F3-F10、F14-F16（11） |
| **签名变化（17）** | A12；B2、B3、B4、B5、B10、B10b（6）；C9、C10、C12（3，其中 C12 弱影响）；D2、D3（2，其中 D3 插件未用）；E1、E2、E3（3，其中 E3 弱）；F2、F13（2） |
| **消失（5）** | C11、D1、F1、F11、F12 |
| **未判定（1）** | F17（+ §8 的 N1-N9 运行期/安装方式类问题不计入本表） |

> **合计 75 条；不兼容 = 签名变化 17 + 消失 5 = 22 条。**
> 计数口径：B10c 归入「存在」（新增成员，但对远端 provider 是正确语义，无需改造）；C12/D3/E3 计入「签名变化」并已标注弱影响或插件未用。

---

## 5. 改造交付单元清单

字段：`{文件, 函数/位置, 现状, 改为, 依据(0.2.0 源码行号), 验收标准}`。
所有「文件」除特别标注外，均指插件源码 `src/` 下相对路径（基线 = tag v0.1.2）。

> **前置决策（不属于单元，需协调者裁决）**：是否保留 §2.5 的私有依赖岛（钉死 `0.1.1-rc.2`）。
> - 选 **A. 保留旧岛** ⇒ 必须执行 U01-U09 全部；
> - 选 **B. 丢弃旧岛、导入宿主 0.2.0 包** ⇒ U01/U03/U04/U05/U07/U08/U09 **大幅简化或取消**（官方 0.2.0 的 `LocalSubprocessRuntime`/`SandboxedFileSystem` 已实现这些新成员，facade 只需路由）。**建议 B**，理由见 §6。

### U01 — `SshSubprocessRuntime` 实现新增抽象方法 `terminalEnvironment`
- **文件**：`src/subprocess.ts`
- **函数/位置**：`SshSubprocessRuntime`（类声明 `:181`，`static inject = ['ssh']` `:182`，构造 `:188`）
- **现状**：只实现 `resolveExecutable`/`spawn`/`spawnTerminal` 三个抽象方法
- **改为**：新增 `async terminalEnvironment(signal?: AbortSignal): Promise<SubprocessTerminalEnvironment>`，经 `ctx.ssh` 在远端执行 `uname -s` 探测平台、经 `$SHELL`/`getent passwd` 解析登录 shell，返回 `{ platform: 'posix' | 'windows', defaultShell?: string }`；`signal` 中止时抛 `AbortError`（复用 `exec-tools.ts` 现成的 abort 处理风格）
- **依据**：`dsh-subprocess/lib/types/index.d.ts:94`（`abstract terminalEnvironment`）；返回类型 `dsh-subprocess/lib/types/types.d.ts`（`SubprocessTerminalEnvironment{ platform, defaultShell? }`）
- **验收标准**：`tsc --noEmit` 通过；`new SshSubprocessRuntime(ctx)` 构造出的实例上 `typeof inst.terminalEnvironment === 'function'`；`await inst.terminalEnvironment()` 对 posix 远端返回 `platform === 'posix'`

### U02 — `MixedSubprocessRuntime` 转发 `terminalEnvironment`
- **文件**：`src/mixed.ts`
- **函数/位置**：`MixedSubprocessRuntime`（成员清单 `:101-103` 为接口面，实现 `:169/174/183`）
- **现状**：只转发 `resolveExecutable`/`spawn`/`spawnTerminal`
- **改为**：新增 `terminalEnvironment(signal?)`，按 `spec`/上下文无可判定 cwd 时**默认转发本地分支**（本地 `terminalEnvironment` 反映宿主平台，与 `resolveExecutable` 的默认一致），保留一条 `remoteRouteFromCwd` 判定分支以便后续按会话 cwd 路由
- **依据**：`dsh-subprocess/lib/types/index.d.ts:94`
- **验收标准**：`tsc --noEmit` 通过；`ctx.set('subprocess', mixed)` 后 `ctx.subprocess.terminalEnvironment()` 不抛 `TypeError`

### U03 — `SshSubprocessHandle` 补齐 `control` 成员
- **文件**：`src/process.ts`
- **函数/位置**：`SshSubprocessHandle` 类体（实现 `pid` 的同一位置）
- **现状**：暴露 `pid`，不暴露 `control`
- **改为**：删除/保留 `pid` 均可（0.2.0 已不再是契约成员，保留无害），**新增** `readonly control: Duplex | undefined = undefined`；并在 `spawn(spec)` 入口对 `spec.control === 'pipe'` 做**显式拒绝**（抛带明确文案的错误），不得静默返回 `undefined`
- **依据**：`dsh-subprocess/lib/types/types.d.ts:164`（`readonly control: Duplex | undefined`）；`control?: 'pipe'` @ 同文件 `SubprocessSpawnSpec`；实际请求者 `dsh-ptc-runtime-node/lib/index.js:969`
- **验收标准**：类型检查通过；SSH handle 的 `control` 属性存在且为 `undefined`；传 `control:'pipe'` 时抛错而非静默

### U04 — SSH 终端句柄补齐 `resize`
- **文件**：`src/terminal.ts`
- **函数/位置**：`SshTerminalHandle` 类体（实现 `write`/`inspectForeground` 的同一位置）
- **现状**：无 `resize`
- **改为**：新增 `async resize(cols: number, rows: number): Promise<void>`，用 `ssh2` 的 `stream.setWindow(rows, cols, 0, 0)` 下发；对非正整数入参抛错
- **依据**：`dsh-subprocess/lib/types/types.d.ts:255`；消费者 `dsh-api-terminal-controller/lib/index.js:428`
- **验收标准**：`tsc --noEmit` 通过；方法存在；`resize(120, 30)` 在已连接终端上不抛（无连接时抛明确的「transport not connected」）

### U05 — SSH 终端句柄补齐 `inspectActivity`
- **文件**：`src/terminal.ts`
- **函数/位置**：`SshTerminalHandle` 类体
- **现状**：无 `inspectActivity`
- **改为**：新增 `async inspectActivity(): Promise<SubprocessTerminalActivity>`，返回 `{ state: 'idle' | 'busy' | 'unknown', revision: number }`；在无法可靠观测时**必须返回 `state: 'unknown'`**（契约允许），`revision` 随每次写入/输出递增
- **依据**：`dsh-subprocess/lib/types/types.d.ts:265`（`SubprocessTerminalActivity` 定义见同文件 `:210-…`「Idle requires positive prompt evidence」）；消费者 `dsh-api-terminal-controller/lib/index.js:341`
- **验收标准**：`tsc --noEmit` 通过；方法存在；无 prompt 证据时返回 `state: 'unknown'`

### U06 — `spawnTerminal` 透传 `terminalType`
- **文件**：`src/subprocess.ts`、`src/terminal.ts`
- **函数/位置**：`SshSubprocessRuntime.spawnTerminal`（声明 `subprocess.ts` 抽象实现处）→ `spawnSshTerminal(...)`（`terminal.ts` 导出）
- **现状**：未读取 `spec.terminalType`，远端 PTY 的 `$TERM` 未设置
- **改为**：把 `spec.terminalType` 透传到远端 `pty` 请求（`ssh2` 的 `pty(term, ...)` 或远端 `export TERM=<terminalType>`），并在 `spec.shellActivity === true` 时记入句柄状态供 U05 使用
- **依据**：`dsh-subprocess/lib/types/types.d.ts:210`（`terminalType: string` 必填）、`:212`（`shellActivity?: boolean`）
- **验收标准**：类型检查通过；远端 `echo $TERM` 等于传入的 `terminalType`

### U07 — `SshFileSystem` / `SshFileSystemEngine` 实现 `readByteRange`
- **文件**：`src/filesystem.ts`
- **函数/位置**：`SshFileSystemEngine`（`readBytes` 实现于 `:230`）与 `SshFileSystem`（`readBytes` 实现于 `:631`）
- **现状**：只有 `readBytes(target, signal, maxBytes)`（按上限读前缀），无窗口读
- **改为**：两处各新增 `async readByteRange(target: FsTarget, range: { offset: number; length: number }, signal?: AbortSignal): Promise<Uint8Array>`：经 SFTP `createReadStream` 的 `{ start: offset, end: offset + length - 1 }` 读取，**不得整文件缓冲**；`offset` 越界（≥ 文件大小）返回空 `Uint8Array`；负值/非整数入参抛 `FsError`；`signal` 中止抛 `FS_ABORTED`
- **依据**：`dsh-fs/lib/types/index.d.ts:197`（`abstract readByteRange`）；消费者 `dsh-api-workspace-files/lib/index.js:452`；参考实现 `dsh-fs-local/lib/index.js:843`
- **验收标准**：`tsc --noEmit` 通过；对已知内容文件 `readByteRange(t, {offset:2,length:3})` 返回第 3-5 字节；`offset` 等于文件长度时返回长度 0；不读取超过 `length` 的字节

### U08 — `MixedFileSystem` 路由 `readByteRange`
- **文件**：`src/mixed.ts`
- **函数/位置**：`MixedFileSystem`（`readBytes` 实现于 `:317`；接口面 `:201`）
- **现状**：无 `readByteRange`
- **改为**：新增 `readByteRange(target, range, signal?)`，沿用现有分支判定（与 `readBytes` `:317` 同款 `target` 归属判断）路由到本地或远端分支；接口面（`:193-227`）同步加声明
- **依据**：`dsh-fs/lib/types/index.d.ts:197`；`dsh-api-workspace-files/lib/index.js:452`
- **验收标准**：`tsc --noEmit` 通过；本地路径与 `ssh://` 路径分别命中本地/远端分支（可断言分支计数或 mock 返回值）

### U09 — `MixedFileSystem` 覆写 `watch`
- **文件**：`src/mixed.ts`
- **函数/位置**：`MixedFileSystem` 类体
- **现状**：未覆写 ⇒ 继承 0.2.0 基类实现，即**无条件** `reject(FsError('Filesystem watching is not supported by this provider.', 'FS_IO_ERROR'))`
- **改为**：新增 `watch(target, changed, signal)`：本地分支委托给本地 delegate 的 `watch`（0.2.0 的 `LocalFileSystem` 支持）；远端分支**显式** `reject(new FsError('remote filesystem watching is not supported', 'FS_IO_ERROR'))`
- **依据**：`dsh-fs/lib/types/index.d.ts:71`；基类实现 `dsh-fs/lib/index.js:70-73`；消费者 `dsh-api-workspace-files/lib/index.js:75`
- **验收标准**：`tsc --noEmit` 通过；本地目标的 `watch` 返回可用的 close 函数；远端目标返回带 `FS_IO_ERROR` 的拒绝且**不**影响其他能力

### U10 — `/dsw` RPC 通道改为 2 参 `handle` + 4 参 handler
- **文件**：`src/web.ts`
- **函数/位置**：`web.ts:525`（`const dispose = ctx.connection.rpc.handle('/dsw', dispatch, { authority: 'loopback' })`）；模块增强声明 `web.ts:56-69`
- **现状**：3 参调用（第 3 参为 `{ authority: 'loopback' }`）；本地增强声明 `handle(channel, handler, options)`
- **改为**：
  1. 调用改为 `ctx.connection.rpc.handle('/dsw', dispatch)`（去掉第 3 参）；
  2. `dispatch` 签名补第 4 形参 `peer: PeerScope`（可 `_peer` 忽略）；
  3. **必须补一条显式的信任约束等价物**：在 `dispatch` 入口用 `peer` 判定会话/操作者身份，或在 profile 配置层声明 `trustedHosts`/loopback（0.2.0 信任策略由 Connection 自身承载，见 `HostConnectionHandle.requestRejection`/`admit`）——**不得依赖「参数被忽略后自动安全」**；
  4. 模块增强声明同步改为 2 参 + `peer` 形参，或直接删除本地增强、改用官方的 `HostConnectionHandle` 类型
- **依据**：`dsh-client-connection/lib/types/rpc.d.ts:138`（`handle(channel, handler)`）、`:103`（handler 含 `peer: PeerScope`）、`:170-183`（`HostConnectionHandle.requestRejection`/`admit`）；旧 3 参形态见 `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-connection/lib/types/rpc.d.ts:23`
- **验收标准**：`tsc --noEmit` 通过；`/dsw` 通道端点仍可调用；**在验收记录中明确写出「原 `loopback` 约束现由何处承担」**，无此记录视为未通过

### U11 — 对齐 RPC 结果信封类型
- **文件**：`src/web.ts`
- **函数/位置**：`ChannelResult` 本地类型声明 `web.ts:36-38`
- **现状**：`{ ok: false; error: { code: string; message: string; details?: Record<string, unknown> } }`（`details` 可选）
- **改为**：`details: object`（必填；失败分支统一填 `{}`）；成功分支可保留现有形状（0.2.0 新增的 `attachments?` 为可选，不需要支持）
- **依据**：`dsh-client-connection/lib/types/rpc.d.ts:13-17`（`details: object`）、`:34-42`（`ConnectionRpcHandlerResult`）
- **验收标准**：`tsc --noEmit` 通过；所有 `error` 返回点均带 `details` 字段

### U12 — 宿主语言解析改走 `settings.describe()`
- **文件**：`src/locale/host.ts`
- **函数/位置**：`HostLocaleSettings` 结构面声明 `:32-35`、`hostLocaleOf(ctx)` `:60-67`（`ctx.get('settings', false)` 后 `settings.get('locale')` 于 `:61`）
- **现状**：`settings?.get('locale')?.preference`（依赖已删除的 `get()`）
- **改为**：
  1. 结构面改为 `{ describe(options?: { redactSecrets?: boolean }): ReadonlyArray<{ ns: string; value: unknown }> }`；
  2. `active()` 实现为：`const d = settings?.describe(); const v = d?.find(x => x.ns === 'locale')?.value; return localeOf((v as {preference?: unknown} | undefined)?.preference)`；
  3. **保留**「service 缺失 ⇒ fallback `'en'`」的既有语义，并加 `try/catch` 兜底：`describe()` 抛错时回落 `'en'`，**绝不向上抛**（该面被 9 处运行时路径调用）；
  4. **可选但建议**：把语言做成插件自身 Config 的 `locale.preference` 字段作为一等来源，`describe()` 仅作兜底
- **依据**：`dsh-settings/lib/types/index.d.ts:27`（`settings: SettingsForms`）、`:62` 类体、`:96`（`describe(options?)`）、`:8-19`（`SettingsDescriptor{ns, value}`）；**`get()` 不存在**（旧 `dsh-settings/lib/types/index.d.ts:239`）；`ctx.settings` 必挂证据 `dsh-base/cordis.patch.yml:101-102`
- **验收标准**：`tsc --noEmit` 通过；`hostLocaleOf(ctx).t('rpc.invalidWorkdir', {...})` 在 0.2.0 上**不抛**且返回字符串；`locale.preference === 'zh'` 时返回中文；`describe()` 被 mock 为抛错时仍返回 `'en'`；9 个调用点（`registry.ts:719`、`web.ts:224`、`exec-tools.ts:745`、`exec-tools.ts:882`、`transport.ts:149/155/172`、`session-workspaces.ts:361`、`tools.ts:284`）全部走同一实现

### U13 — 后台任务面适配 0.2.0 `dsh-jobs`
- **文件**：`src/exec-tools.ts`
- **函数/位置**：`BackgroundJobs` 面声明 `:509-517`；`run()` 实参构造 `:814-819`、`:934-939`；`incrementalRead` 辅助 `:530`
- **现状**：`start(spec)` 的 `spec.run(): { cancel, done, readOutput?() }`、`owner?: unknown`、切面读 `readOutput()`
- **改为**：
  1. `BackgroundJobs` 面重写为 `{ start(spec: { kind: string; label: string; owner?: string; output?: readonly unknown[]; run(job: { append(text: string, options?: unknown): void; updateProgress(line: string): void }): { cancel(reason?: string): void; done: Promise<unknown> } }): string }`；
  2. `owner` 传 **session id 字符串**（不再传 agent 对象）；
  3. `readOutput` 退场：改为在 `run(job)` 内用 `job.append(chunk)` 主动推送增量（把现有 `incrementalRead` 的两个游标循环改造成定时/事件驱动的 append 循环）；
  4. 若确认 `output?: JobOutputSource[]` 的拉取源契约可复用现有读取器，则改用它而非 `append`（二选一，**需在实现时按 `dsh-jobs` 0.2.0 的 `JobOutputSource` 定义定夺**；本单元要求不得两头都留）
- **依据**：`dsh-jobs/lib/types/types.d.ts:117`（`JobSpec`）、`:128`（`owner?: SessionId`）、`:140`（`output?: readonly JobOutputSource[]`）、`:148`（`run(job: JobHandle)`）、`JobHooks` 仅 `:102`/`:109`（**无 `readOutput`**）、`JobHandle:88`（`append(text, options?)`）、`:94`（`updateProgress`）
- **验收标准**：`tsc --noEmit` 通过；后台 `sw-exec` 启动返回 job id；任务完成通知带输出；**grep 结果中 `readOutput` 在插件源码内 0 命中**

### U14 — 客户端目录能力改挂 `uiWorkspace`
- **文件**：`src/client/index.ts`
- **函数/位置**：inject 清单 `:145`；`injected()` 工厂 `:165`、`:166`；`installSidebarRowBadges` 的 `ctx.get('workspaces')` `:214`
- **现状**：`inject = ['slots','workspaces','sessions','locale']`；`ctx.workspaces.listDirectory(...)`、`ctx.workspaces.createDirectory(...)`
- **改为**：
  1. inject 清单改为 `['slots', 'uiWorkspace', 'sessions', 'locale']`；
  2. `:165` 改 `ctx.uiWorkspace.listDirectory(path, signal)`；`:166` 改 `ctx.uiWorkspace.createDirectory(path, name)`；
  3. `:214` 的 `ctx.get('workspaces')`：若目标只是读 `.list` 快照，**改为 `ctx.get('sessions')` 不可替代**（那是会话面）；须改为经 `ctx.uiWorkspace` 找不到时才回落 `ctx.get('workspaces')`（`IWorkspaces` 在 0.2.0 仍存在但面已收窄）——**实现时以 `dsh-api-workspace-controller/lib/types/client/service.d.ts:38` 的 `IWorkspaces` 成员清单为准**，若其不再提供徽标所需的行视图，则徽标层的 workspace 分组能力降级为「仅按 sessions 标记"
- **依据**：`dsh-client-ui-workspace/lib/types/client/navigation.d.ts:94`（`uiWorkspace: UiWorkspace`）、`:138`（`listDirectory`）、`:139`（`createDirectory`）；`dsh-api-workspace-controller/lib/types/client/service.d.ts:38`（`IWorkspaces`，**无这两个方法**）、`.../client/index.d.ts:19`（`workspaces: IWorkspaces`）
- **验收标准**：`tsc --noEmit` 通过；inject 清单含 `uiWorkspace` 且不含已废弃用法；本地目录列出/新建在 SSH 工作区添加流程中可用

### U15 — 重写 `dsh.client.inject` 包清单
- **文件**：`package.json`
- **函数/位置**：`dsh.client.inject` 数组（现 6 项：`dsh-client-connection`、`dsh-client-locale`、`dsh-client-runtime`、`dsh-client-ui-conversation`、`dsh-client-ui-sidebar`、`dsh-client-ui-workspace`）
- **现状**：含 **0.2.0 不存在的** `@deepseek-ai/dsh-client-runtime`
- **改为**：替换为 0.2.0 的等价提供者集合：
  ```
  "@deepseek-ai/dsh-client-connection",
  "@deepseek-ai/dsh-client-locale",
  "@deepseek-ai/dsh-client-ui-renderer",      // slots（取代 dsh-client-runtime）
  "@deepseek-ai/dsh-client-ui-conversation",  // conversation.session.header.actions
  "@deepseek-ai/dsh-client-ui-sidebar",
  "@deepseek-ai/dsh-client-ui-workspace",     // 两个 directoryFlow 槽 + uiWorkspace
  "@deepseek-ai/dsh-client-ui-settings",      // settings.section 槽
  "@deepseek-ai/dsh-api-workspace-controller",// 客户端 workspaces 服务
  "@deepseek-ai/dsh-api-session-controller"   // 客户端 sessions 服务
  ```
- **依据**：0.2.0 安装树无 `dsh-client-runtime`（全树 grep `dsh-client-runtime` 在 `package.json` 中 0 命中）；官方同构声明可参照 `dsh-client-ui-workspace/package.json` 的 `dsh.client.inject`（11 项，含 `dsh-client-ui-renderer`、`dsh-api-workspace-controller`、`dsh-api-session-controller`）；`dsh-client-locale/package.json` 的宣言（4 项）
- **验收标准**：清单中每一项都能在 0.2.0 安装树中解析到包；不再出现 `dsh-client-runtime`

### U16 — 私有依赖岛策略落地（二选一，需前置裁决）
- **文件**：`package.json`（`dependencies`/`peerDependencies`）、以及重新安装流程
- **函数/位置**：`package.json` `dependencies` 段（`@deepseek-ai/dsh-fs ^0.1.1-rc.2` 等 15 项）+ `peerDependencies` 段
- **现状**：宿主包走 `dependencies` 且就地 `npm install` 生成钉死 `0.1.1-rc.2` 的私有岛；插件 `plugin.ts:27-29` 直接从旧岛 new 出旧版本地 provider
- **改为**：
  - **方案 B（推荐）**：把 `@deepseek-ai/dsh-fs`、`dsh-fs-local`、`dsh-fs-sandbox`、`dsh-subprocess`、`dsh-subprocess-local`、`dsh-host-directory-picker`、`dsh-host-directory-picker-native`、`dsh-tools`、`dsh-system-prompt`、`dsh-timeout`、`dsh-sandbox`、`dsh-sandbox-policy`、`dsh-session`、`dsh-llm`、`@deepseek-ai/cordis`、`@deepseek-ai/schemastery` 全部从 `dependencies` 迁到 `peerDependencies`（范围 `^0.2.0-rc.1` 或双向 `>=0.1.1-rc.2 <0.3.0`），删除旧岛，让 `plugin.ts:27-29` 的 import 解析到宿主 0.2.0 包；
  - **方案 A**：保留旧岛，则 U01/U03/U04/U05/U07/U08/U09 全部保留为独立实现（工作量约 2 倍），且**无法**通过类型检查（旧岛类型缺新成员），必须在该单元内同时升级岛或加类型断言
- **依据**：0.2.0 已由 `dsh-base/cordis.patch.yml:220-221` 挂载 `@deepseek-ai/dsh-subprocess-local`、`:518-519` 挂载 `@deepseek-ai/dsh-fs-sandbox` ⇒ 宿主侧本地 provider **本就存在**，插件无需自带；v0.1.4 上游已把同一批包改成 `peerDependencies`（`.workspace/workstreams/research/repos/dsh-workspace-enhancement/package.json` `peerDependencies` 段）
- **验收标准**：重新安装后 `dsh-workspace-enhancement/node_modules/@deepseek-ai/` 不存在或版本 = `0.2.0-rc.1`；`plugin.ts:27-29` 解析到的 `LocalSubprocessRuntime`/`SandboxedFileSystem` 实例上存在 `terminalEnvironment`/`readByteRange`

### U17 — 依赖范围与 peer 对齐（版本段）
- **文件**：`package.json`
- **函数/位置**：`peerDependencies` / `engines` / `dsh.profile` 相关段
- **现状**：v0.1.2 的 `peerDependencies` 仅 `dsh-system-prompt`、`dsh-tools`（`^0.1.0-rc.6`），其余全在 `dependencies`
- **改为**：peer 段按 U16 方案重建为 0.2.0 区间；`engines.node` 保持 `>=22.0.0`（0.2.0 要求见各包 `engines`）；`dsh.bundle.patch` **建议摘除或改写**（见 §6 风险 R3）
- **依据**：v0.1.4 上游 `peerDependencies` 段已给出目标形状（`^0.1.5-rc.1` 一档），迁移到 `^0.2.0-rc.1` 即可
- **验收标准**：`npm ls` 无 peer 失配告警；`dsh plugin` 装载不触发版本闸门提示

### U18 — 本地客户端补丁迁移
- **文件**：`lib/client.js`（构建产物）与对应源码 `src/client/*`
- **函数/位置**：3 个 hunk（§2.4 P1/P2/P3）
- **现状**：3 处补丁只存在于**部署的构建产物** `lib/client.js` 中，未回写到 `src/`
- **改为**：
  1. 把 P1（标题索引去重 + `!== void 0` 守卫）回写到 `src/client/row-badges.ts` 或对应的标题索引建立处；
  2. 把 P2（machines `refresh` 的 `aliveRef`/`refreshGenerationRef` keep-alive 守卫）回写到 `src/client/settings.tsx` 的 `useEffect`；
  3. 把 P3（sessions 快照投影记忆化）回写到对应投影闭包；
  4. 在 0.2.0 客户端包上重新构建，**逐条核对** 3 个行为仍在（用源码级断言而非产物 diff，因为 0.2.0 的打包结果必然不同）
- **依据**：`diff <npm-0.1.2>/lib/client.js <部署>/lib/client.js` = 58 行 / 3 hunk（含 `dsh-perf-fix K1-3` 注释）；部署文件 mtime `2026-09-22 16:39`（远晚于包内其他文件 `2026-09-14`），证明为手工后补
- **验收标准**：`src/` 中出现三处改动；重新构建后**在浏览器中**验证：①同一标题多会话不串索引；②machines 面板卸载后不再 `setState`；③sessions 快照未变时不重建数组（可用 React DevTools Profiler 或计数断言）

### U19 — picker 行的启用/禁用决策落地
- **文件**：profile 配置 `~/.dsh/profiles/web/cordis.patch.yml`（**不在插件内**，属部署改动）
- **函数/位置**：`:79-80` 的 `- id: directory-picker-ssh` / `disabled: true`
- **现状**：0.1.1-rc.2 下官方配置**禁用**插件 picker 行（改由 `@deepseek-ai/dsh-host-directory-picker-browse` 承担目录浏览）
- **改为**：0.2.0 迁移时**逐条确认**这 3 条部署决策仍需保留：①`:72-73` 禁用官方 `directory-picker`；②`:74-76` 插入 `directory-picker-browse`；③`:79-80` 禁用 `directory-picker-ssh`。若 0.2.0 的官方 picker 行已能覆盖 SSH 场景，可整段删除并启用插件 picker
- **依据**：`~/.dsh/profiles/web/cordis.patch.yml:72-80`（实测）；0.2.0 `dsh-web-app/cordis.patch.yml:113-114` 仍有 `id: directory-picker` / `@deepseek-ai/dsh-host-directory-picker-auto`
- **验收标准**：0.2.0 启动后 `ctx.directoryPicker` 只有**一个**注册者（无重复注册报错）；SSH 目录浏览在 UI 中可用

### 单元与小节对应关系

| 单元 | 覆盖的不兼容项 |
|---|---|
| U01-U02 | B2 |
| U03 | B3 |
| U04-U05 | B4 |
| U06 | B5 |
| U07-U08 | B10 |
| U09 | B10b |
| U10 | E1、E2、A10 |
| U11 | E3 |
| U12 | D1、D2、D3 |
| U13 | C9、C10、C11、C12 |
| U14 | F11、F12、F13、F2 |
| U15 | F1 |
| U16 | 私有岛（§2.5）与 B13-B15 语义 |
| U17 | A12、依赖段 |
| U18 | §2.4 本地补丁 |
| U19 | §1-更正项（deployment disable） |

**共 19 个改造单元。**

---

## 6. 官方等价缝与简化方案

### 6.1 已确认的等价缝（0.2.0 官方已提供，插件可不再自建）

| # | 官方缝 | 0.2.0 证据 | 可简化掉的内容 |
|---|---|---|---|
| S1 | 官方本地 subprocess provider 已由 bundle 挂载 | `dsh-base/cordis.patch.yml:220-221`（`id: subprocess` / `@deepseek-ai/dsh-subprocess-local`） | 插件 `plugin.ts:93` 自行 `new LocalSubprocessRuntime(ctx)` |
| S2 | 官方沙箱 fs provider 已由 bundle 挂载 | `dsh-base/cordis.patch.yml:518-519`（`id: fs-sandbox` / `@deepseek-ai/dsh-fs-sandbox`） | 插件 `plugin.ts:111` 自行 `new SandboxedFileSystem(owner, LOCAL_FS_CONFIG)` 及其 `ctx.inject(['sandboxPolicy'])` 舞步（`plugin.ts:109-113`） |
| S3 | 官方目录 browse 后端 | `@deepseek-ai/dsh-host-directory-picker-browse`（0.2.0 存在；本机 profile 已启用） | 插件 picker 的 browse 能力（**注意**：遥控/SSH 目录浏览仍需插件） |
| S4 | 官方 settings 表单面 | `dsh-settings/lib/types/index.d.ts:96` `describe()` | 无需自建读取面——但**必须**替换 `get()`（U12） |
| S5 | 官方 jobs 输出拉取源 | `dsh-jobs/lib/types/types.d.ts:140` `output?: readonly JobOutputSource[]`（+ `JobHandle.append` `:88`） | 插件自造的 `incrementalRead` 双游标 + `readOutput` 钩子（U13） |

### 6.2 推荐简化方案（方案 B）

**做法**：丢弃私有依赖岛（U16 方案 B），把 `plugin.ts:81-120` 的 `installMixedProviders` 从「**构造本地实现 → `ctx.set` 顶掉**」改为「**读取宿主已挂载的官方 provider → 包一层路由**」。

改造后 `installMixedProviders` 的形状（伪码，供执行档落地）：
```
const localSubprocess = ctx.get('subprocess')      // 宿主官方 0.2.0 实现
ctx.set('subprocess', new MixedSubprocessRuntime(localSubprocess, new SshSubprocessEngine(ctx), sides))
const localFs = ctx.get('fs')                      // 宿主官方 fs-sandbox（0.2.0）
ctx.set('fs', new MixedFileSystem(localFs, new SshFileSystemEngine(ctx), sides))
```

**收益（可消解/大幅简化 6 个单元）**：

| 单元 | 方案 B 下的变化 |
|---|---|
| U03（`control`） | **不变**（仍是 SSH 句柄自身的成员） |
| U04/U05（终端 `resize`/`inspectActivity`） | 仍需实现，但基类契约由 0.2.0 提供，实现更直白 |
| U07（`SshFileSystem.readByteRange`） | **仍需实现**（远端分支是插件职责） |
| U08（`MixedFileSystem.readByteRange`） | **退化为一行转发**——本地分支的官方 0.2.0 fs 已实现 `readByteRange`，facade 只需判定分支 |
| U09（`watch`） | **退化为一行转发**——本地分支的官方 0.2.0 fs 支持 `watch` |
| U01/U02（`terminalEnvironment`） | 本地分支可直接借宿主实现；远端分支仍需实现（B2 本质要求） |

**风险**：

| # | 风险 | 说明与缓解 |
|---|---|---|
| R1 | `ctx.get('fs')` / `ctx.get('subprocess')` 的**读取时机** | 插件 `apply` 时官方行可能尚未激活（cordis 激活是后继微任务）。缓解：把 facade 安装包在 `ctx.inject(['fs','subprocess'], …)` 内，与 `plugin.ts:110` 既有的 `ctx.inject(['sandboxPolicy'])` 同款手法 |
| R2 | `ctx.set` 顶掉官方 provider 的语义 | 0.2.0 的 `subprocess` 服务注释明确「one implementation per context; loading a second throws」（`dsh-subprocess/lib/types/index.d.ts:46-52`）。**用 `ctx.set` 替换已 provide 的值**与「再加载第二个实现」不同，但**本机未实测**该路径 ⇒ 见 §8 未判定项 |
| R3 | 插件自带 `cordis.patch.yml` 的 3 条 disable | 该文件经 `dsh.bundle.patch` 声明；当前 profile **未应用**。方案 B 后如仍以 bundle 方式安装，其 disable 会关闭 `directory-picker-auto`、`subprocess-local`、`fs-sandbox` ⇒ **与 S1/S2 直接冲突**。缓解：U17 要求摘除或改写 `dsh.bundle.patch` |
| R4 | 混合 facade 的语义漂移 | 官方 0.2.0 provider 的 terminate 语义已改为「managed range 而非 process tree」（`dsh-subprocess/lib/types/types.d.ts` 文档行），facade 的透传不应再假定 process-tree 语义 |

---

## 7. 迁移后暂不可用能力

> 口径：**在 0.2.0 上、未执行本清单改造前**即失效；括号内为恢复所需的单元。

| # | 不可用能力 | 根因（证据） | 恢复 |
|---|---|---|---|
| L1 | **远程会话的 web 终端整体** | `dsh-api-terminal-controller` 调 `subprocess.terminalEnvironment`（`lib/index.js:18`）⇒ SSH provider 无此方法 → `TypeError` | U01+U02（+U04/U05 恢复尺寸/活动观测） |
| L2 | **远程文件二进制窗口读取**（工作区文件预览/下载） | `dsh-api-workspace-files/lib/index.js:452` 调 `ctx.fs.readByteRange` ⇒ 0.2.0 基类该成员为 `abstract` 无实现 | U07+U08 |
| L3 | **本地文件监视**（`dsh-api-workspace-files/lib/index.js:75`） | `MixedFileSystem` 未覆写 `watch` ⇒ 继承基类无条件 reject `FS_IO_ERROR` | U09 |
| L4 | **远程文件监视** | 同上；且远端本就无实现 | U09 后仍不可用（**永久缺失**，需专门设计） |
| L5 | **宿主界面语言（zh/en）自适应** | `locale/host.ts:61` 的 `settings.get` 在 `SettingsForms` 上不存在 ⇒ RPC 错误文案/工具描述/标签路径抛错 | U12 |
| L6 | **后台 `sw-exec` 的增量输出读取** | `JobHooks.readOutput` 已在 0.2.0 删除（旧 `dsh-jobs/lib/types/types.d.ts:82`） | U13 |
| L7 | **远程 PTC / `control:'pipe'` 子进程** | SSH 句柄无 `control` 通道；`dsh-ptc-runtime-node/lib/index.js:969` 是唯一请求者 | U03 后仍不可用（**永久缺失**，需专门设计 `control` 通道契约） |
| L8 | **客户端 SSH 工作区添加流程**（目录流两个槽） | `ctx.workspaces.listDirectory/createDirectory` 已迁到 `ctx.uiWorkspace` ⇒ 方法不存在 | U14 |
| L9 | **客户端插件 bundle 的可靠加载** | `dsh.client.inject` 引用 0.2.0 不存在的 `@deepseek-ai/dsh-client-runtime` | U15（严重度见 §8） |
| L10 | **远端 PTY 的 `$TERM` 正确性** | `spawnTerminal` 不读 `spec.terminalType`（0.2.0 新必填 `types.d.ts:210`） | U06 |
| L11 | **本地 provider 的新能力**（若保留旧岛） | 插件用旧岛 `0.1.1-rc.2` 的本地类顶掉官方 0.2.0 实现 ⇒ 官方新增的 `readByteRange`/`watch`/`terminalEnvironment`/Windows Job 与 Linux scope 加固等**全部丢失** | U16 方案 B |

---

## 8. 未验证项

> 全部显式标注，**未做任何猜测填充**。

| # | 未判定事项 | 为什么未判定 | 建议验证方式（执行档/后续轨道） |
|---|---|---|---|
| N1 | `dsh.client.inject` 中**不可满足**的包名（`dsh-client-runtime`）在 0.2.0 浏览器端模块图加载器里的**具体后果**（硬失败 / 永久不激活 / 静默忽略） | 该解析发生在浏览器侧打包产物内；本轮未定位到可读的图构建实现，且规则禁止启动服务/浏览器 | 在 `.workspace` 隔离 profile 中挂载插件，读浏览器控制台与 `dsh-client-modules` 客户端 bundle 的依赖判定分支 |
| N2 | `ctx.set('fs'/'subprocess', facade)` 替换**已由官方行 provide 的服务**在 cordis 4.0.4 上是否被允许（与「第二个实现即抛」的边界） | cordis `context.d.ts` 未变，但该语义在 `dsh-subprocess` 注释中以「loading a second implementation」表述，`set` 替换路径未见文档化保证；本轮未做运行时实验 | 隔离 profile 内写最小探针 plugin：先 `ctx.plugin(LocalSubprocessRuntime)` 再 `ctx.set('subprocess', facade)`，观察是否抛错 |
| N3 | 私有依赖岛在 0.2.0 上重新安装时**是否会被重建**（取决于安装方式：`npm install <tarball>` vs `pnpm` vs 手工复制） | 取决于执行档选择的安装路径，本轮无该信息 | 在 `.workspace` 隔离目录中用目标安装方式实测，检查 `node_modules/@deepseek-ai/*` 版本 |
| N4 | 侧栏行徽标 DOM 层（`client/row-badges.ts` 的 `MutationObserver` + 行选择器 / `data-dsw-badge`）对 0.2.0 官方 sidebar DOM 结构的适配度 | 需要真实渲染 DOM；本轮禁止启动服务与浏览器 | 在隔离 profile 的 3080/3097 之一（或新端口）实测侧栏行选择器命中率 |
| N5 | 0.2.0 客户端 `ctx.slots.register` 选项类型是否有**新增必填**字段（本轮只确认了槽位名与 `inject` 可选面存在） | 未逐字段对比 `SlotRegistration` 选项类型 | 执行档在 `tsc --noEmit` 下以插件 4 个注册点为准获取编译错误 |
| N6 | `dsh-client-connection` 客户端 `connection` 服务在 0.2.0 **是否仍以同名 provide**（本轮只从 0.2.0 客户端产物 `lib/client.js:1477` 见到 `provide("connection", …)`，未核验其类型声明中的 Context 成员缺失是否影响运行时解析） | 客户端 `connection` 服务在 0.1.1-rc.2 亦**未**声明为 `Context` 成员（插件一直用本地接口 + `ctx.get` 读取），故两版都无类型声明，无法用类型差判断 | 隔离 profile 中在插件客户端代码里 `console` 打印 `ctx.get('connection')` 是否 undefined |
| N7 | `dsh-jobs` 0.2.0 `JobOutputSource` 的具体契约（决定 U13 走 `output[]` 还是 `job.append()`） | 本轮已定位 `output?: readonly JobOutputSource[]` 声明位置（`types.d.ts:140`），但未展开其成员定义 | 执行档在实现 U13 前展开 `dsh-jobs/lib/types/types.d.ts` 的 `JobOutputSource` 定义并二选一 |
| N8 | `IWorkspaces`（0.2.0，`dsh-api-workspace-controller/lib/types/client/service.d.ts:38`）的**完整成员清单**是否还能支撑侧栏徽标的 workspace 分组 | 本轮只确认其**不含** `listDirectory`/`createDirectory` | 执行档展开该接口全部成员后决定 U14 第 3 步的回退策略 |
| N9 | 真实 SSH 连通性与端到端行为（终端/文件/监视的实际表现） | **本轨道硬约束：不得发起真实 SSH 连接** | 后续轨道在真实远端上做冒烟（L1/L2/L3/L10 逐条） |

---

## 附录 A — 本轮使用的核验命令（可复现，均只读）

```bash
# 0.2.0 宿主源码树（289 包）
ls .workspace/iso-020/npm-global/node_modules/@deepseek-ai/

# 插件部署实况与 npm 0.1.2 的差异（仅 client.js）
diff -rq ~/.dsh/profiles/node_modules/dsh-workspace-enhancement/lib \
         workbuddy-reverse-proxy/_audit/ws-enhance/npm/x012/package/lib

# 插件私有依赖岛版本
for p in dsh-fs dsh-subprocess dsh-fs-sandbox cordis schemastery; do
  node -p "require('$HOME/.dsh/profiles/node_modules/dsh-workspace-enhancement/node_modules/@deepseek-ai/$p/package.json').version"
done

# v0.1.2 源码基线提取（只读）
git -C .workspace/workstreams/research/repos/dsh-workspace-enhancement \
    archive v0.1.2 src cordis.patch.yml package.json \
  | tar -x -C .workspace/audit-020/work/t24/src-012

# 抽象类成员对比工具（本轮自建，仅供审计）
node .workspace/audit-020/work/t24/class-members.mjs <d.ts> <ClassName>
node .workspace/audit-020/work/t24/surface-diff.mjs <oldPkgDir> <newPkgDir>

# 0.2.0 侧消费者定位（排除压缩客户端 bundle）
grep -rn "readByteRange(" <0.2.0>/dsh-api-workspace-files/lib/index.js
grep -rn "terminalEnvironment(" <0.2.0>/dsh-api-terminal-controller/lib/index.js
grep -n "name: '@deepseek-ai/dsh-settings'" <0.2.0>/dsh-base/cordis.patch.yml
```

## 附录 B — 审计约束遵守声明

- 本轮**未写入** `.workspace/**` 以外的任何路径；未修改插件源码、未触碰 `~/.dsh*`。
- **未发起任何 SSH 连接**；**未启动任何监听端口的服务**；**未发起模型请求**。
- 未使用 `sandbox_permissions`。
- 本报告不含会话正文、密钥、原始会话 id 或主机凭据。
- 现役 3080 / 隔离 3097 两个实例未被触碰。
