# T17 — SSH / 远程工作区 / workspace-enhancement 族在 0.2.0 的兼容性审计

- **轨道**：T17（审计阶段，只读；除 `.workspace/**` 外未写任何路径）
- **迁移目标**：`@deepseek-ai/dsh@0.2.0-rc.1`
- **对比基线**：`0.1.7-rc.2`（隔离 3097 家族）+ `0.1.1-rc.2`（现役 3080 家族，用于判定"今天能跑、迁移后会不会断"）
- **审计对象**：`dsh-workspace-enhancement`（底座）、`@local/dsh-ssh-gui`、`@local/dsh-workerspace`
- **纪律**：未发起任何真实 SSH 连接；未启动任何监听端口的服务；未发起模型请求；未触碰 `~/.dsh/**`、`~/.dsh-017/**`、`~/.dsh/remote-workspaces/**` 与既有插件源码（全部只读）。沙箱未升级、未使用 `sandbox_permissions`。

---

## 0. 证据基线（本轮实测冻结）

| 代号 | 路径 | 版本 / 内容 |
|---|---|---|
| **A020** | `.workspace/audit-020/work/closure020/node_modules/@deepseek-ai/` | `0.2.0-rc.1`，289 个包（本轮用于全部 0.2.0 结论） |
| **A017** | `.workspace/audit-020/work/closure017/node_modules/@deepseek-ai/` | `0.1.7-rc.2`，284 个包 |
| **A011** | `~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`（只读） | `0.1.1-rc.2`，现役 3080 家族 |
| **CLI020/CLI017** | `.workspace/audit-020/extracted/v020/package/`、`.../v017/package/` | CLI 薄包；**lib 逐字节相同**（sha256 `2103210a…`/`935e95d0…`），仅 `package.json` 版本与 1 条依赖不同 |
| **WSE-LIVE** | `~/.dsh/profiles/node_modules/dsh-workspace-enhancement/`（只读） | **0.1.2**（现役实际加载的版本；`lib/` 已构建） |
| **WSE-SRC** | `.workspace/workstreams/research/repos/dsh-workspace-enhancement/`（只读引用） | **0.1.4**（git `ee25ed1`，`src/` TypeScript 源码；`lib/` 未构建） |
| **SSHGUI** | `~/.dsh/profiles/node_modules/@local/dsh-ssh-gui/`（只读） | 0.2.0，`lib/` 已构建 |
| **WS** | `~/.dsh/profiles/node_modules/@local/dsh-workerspace/`（只读） | 0.1.0，`lib/` 已构建 |
| **P011 / P017** | `~/.dsh/profiles/web/cordis.patch.yml` / `~/.dsh-017/profiles/web/cordis.patch.yml`（只读） | 现役 / 0.1.7 隔离的装配面 |

方法学说明：**包的契约差异用 `lib/` 目录逐文件 `diff -rq` 判定，不用整包哈希**（整包哈希会将 `package.json` 的版本号变动误判为契约变动——本轮先用整包哈希得到"289 个包几乎全变"的**假阳性**，改判为 `lib/` diff 后收缩到 56 个包，其中与本族相关的仅 6 个）。凡跨版本引用，一律标注「包@版本 + 符号 + 行号」，行号只在同一份快照内有效。

### 0.1 包集增量（0.1.7 → 0.2.0）

`comm` 比较两个 closure 的 `@deepseek-ai/*` 目录名：**0 个删除，5 个新增**，全部与本族无关：

```
dsh-client-product-analytics
dsh-client-ui-settings-session-log
dsh-experimental-schedule-bundle
dsh-host-product-telemetry-otel
dsh-otel
```

CLI 薄包 `package.json` 的依赖增量同样只有 1 条：`@deepseek-ai/dsh-experimental-schedule-bundle`。

> **对协调者基线的校正**：`PLAN.md` 记「0.2.0-rc.1 相对 0.1.7 新增依赖 `dsh-skill-office`、`dsh-tool-subagent-control`、`dsh-workflow-ptc`」。本轮实测**不成立**——这三个包在 **0.1.7-rc.2 的 closure 中已存在**，且 `dsh-tool-subagent-control` 的 `lib/` 在 0.1.7↔0.2.0 之间**逐字节相同**（见 §2）。它们是 0.1.7 线已引入的传递依赖，不是 0.2.0 新增。

---

## 1. 结论摘要

1. **本族定制依赖的官方 provider 抽象层在 0.2.0 完全没有变化。** `dsh-fs`、`dsh-fs-local`、`dsh-fs-sandbox`、`dsh-subprocess`、`dsh-subprocess-local`、`dsh-bash-local`、`dsh-bash-sandbox`、`dsh-tool-bash*`、`dsh-sandbox`、`dsh-sandbox-policy`、`dsh-tools`、`dsh-host-directory-picker{,-auto,-browse}`、`dsh-workspace`、`dsh-util-workspace-path`、`dsh-tool-workspace-dependencies`、`dsh-tool-subagent-control` —— **`lib/` 全部逐字节相同**。`ctx.fs` / `ctx.subprocess` 仍是「每个 context 一个实现」的单槽 seam（`dsh-fs/lib/types/index.d.ts:16-18`、`dsh-subprocess/lib/types/index.d.ts:42-44`），0.2.0 未引入远程 provider 抽象、未引入多 provider 路由、未改 provider 名。

2. **`dsh-workspace-enhancement` 不是 insert-only。** 它自带的 bundle patch（`cordis.patch.yml`）**disable 了 3 条官方行**：`directory-picker`（`@deepseek-ai/dsh-host-directory-picker-auto`）、`subprocess`（`@deepseek-ai/dsh-subprocess-local`）、`fs-sandbox`（`@deepseek-ai/dsh-fs-sandbox`）；现役 profile patch 又叠加 disable 了官方 `directory-picker`。**三条被 disable 的行 id 在 0.2.0 的 `dsh-base` / `dsh-web-app` patch 里都仍然存在**，所以 disable 仍然命中（不是静默失效）。"insert-only" 的自我描述只在 `@local/dsh-ssh-gui` 上成立（其 patch 只有 1 条 `insert`，0 个 `disabled`）。

3. **本族在 0.2.0 上有两处「一挂就废」的硬断点，且两处都不是 0.2.0 新引入、而是 0.1.5 线就已发生、0.2.0 继承：**
   - **(a) `@deepseek-ai/dsh-settings` 的 `installSettingsSection` / `settingsNamespace` 在 0.1.7 与 0.2.0 已被整体删除**（全树 grep 0 命中）。`@local/dsh-ssh-gui`（`lib/index.js:49,68,173`）与 `@local/dsh-workerspace`（`lib/index.js:30,41,123`）都在模块顶层具名导入它 ⇒ **ESM 链接期 `SyntaxError`，插件整行加载失败**。本轮已在隔离探针树上**动态复现**（§4）。
   - **(b) `ctx.settings` 的服务实现已从"命名空间注册表"换成 `SettingsForms`**（`get(namespace)` 方法消失）。`dsh-workspace-enhancement`（0.1.2 与 0.1.4 同一份代码）用 `ctx.get('settings')?.get('locale')?.preference` 读宿主语言 ⇒ **`TypeError: settings?.get is not a function`**。本轮已**动态复现**（§4）。触发点是工具 schema 投影（`localizeTool` 用 getter 包 `description`/`parameters`），即首个会话的首次 prompt 组装，不是挂载期。

4. **`/dsw` 自挂前缀通道在 0.2.0 上「确定退化的部分」是 loopback 信任豁免，注册本身是否失败未定。** `dsh-client-connection` 在 0.1.5 线把 `rpc.handle` 从 **3 参降为 2 参**（`handle(channel, handler, options)` → `handle(channel, handler)`），`{ authority: 'loopback' }` 被 **JS 静默忽略** ⇒ 该通道原有的 loopback 信任约束**消失**（不再有 0.1.1 的 `options.authority === "loopback" ? [] : this.trustedHosts` 豁免）。**但"注册必抛错"的说法本轮被证伪**：我用 `@deepseek-ai/cordis@4.0.4` 做了最小复现（§9 探针 6），结论是 **`owner.webServer` 无论 `inject` 是 `["webServer","credentials"]` 还是 `["credentials"]` 都能解析成功**（cordis 的服务值统一落在 root fiber store，代理的 `internal/get` 回退会向上走到 root 命中），`handle()` **不抛**；只有 `webServer` 服务**根本未挂载**时才会因 `owner.webServer === undefined` 而失败（报错是 `Cannot read properties of undefined (reading 'register')`，**不是**插件文档所记的 `cannot get property "webServer" without inject`）。B 型失败在正常 web profile 中不成立（`dsh-web-app/cordis.patch.yml:169-171` 必挂 `webserver` 行 → `@deepseek-ai/dsh-host-webserver`，`:101-103` 必挂 `settings` 行）。**结论：`/dsw` 面按「loopback 语义确定丢失 + 注册成败待真机实测」处理，不再断言"必废"。**
   现役 **WSE-LIVE=0.1.2 仍走 `connection.rpc.handle('/dsw', …)`**（`lib/web.js:504`）；**0.1.4（WSE-SRC）已换到官方共享 `/api` 的精确 Fetch 路由** `connection.fetch.register`，本轮核验 `dsh-client-connection@0.2.0-rc.1` 的 `ConnectionFetchRoute` / `HostConnectionFetch.register` 与 `API_PATH='/api'` **逐字节相同**（`lib/types/rpc.d.ts:111-129`、`lib/index.js:14,573-584`）⇒ **无论 0.1.2 的注册是否失败，迁移到 0.1.4+ 的 `/api/dsw/*` 都是正确的落点，且完全绕开 loopback 豁免丢失问题**。

5. **`@local/dsh-ssh-gui` 的 UI 席位有一个在 0.1.5 线被删除**：它注册的 `sidebar.workspaces.remoteHosts`（`lib/client.js:1018`）**在 0.1.1-rc.2 存在、在 0.1.7-rc.2 与 0.2.0-rc.1 都不存在**（全树 0 命中）。`slots.inject` 对未声明槽位的语义是"回调永不执行且不报错"（插件自身 `docs/compatibility.md` §2 亦记录此语义）⇒ 侧栏「分布式节点」树**静默消失**。它另用的 `settings.section`、`conversation.session.header.actions` 在 0.2.0 仍在。

6. **0.2.0 官方没有内置远程工作区能力，该族不能整体退役**。证据：包集增量 5 个全部与远程/工作区无关；`dsh-workspace`（工作区注册表）`lib/` 逐字节相同，其 `WorkspaceView.path` 是 `fs.realpath` 后的**本机**目录路径（`dsh-workspace/lib/types/types.d.ts:61-66`、`dsh-api-workspace-controller/lib/types/types.d.ts:17-27`），**无 transport / remote 字段**；全树 grep `ssh2` / `ssh://` / `remote workspace` **0 命中**；没有任何官方包声明 `ctx.ssh`。**但"多工作区（本机多目录 + 会话归组）"确实是官方能力且早已存在**——这部分可退役定制，远程部分不可退役。

7. **迁移判定分布：3 个插件全部"需改"（0 个可原样迁移、0 个可退役）。** 其中 `dsh-workspace-enhancement` 必须**先升到 0.1.4+**（不能带着现役 0.1.2 迁），`@local/dsh-ssh-gui` 与 `@local/dsh-workerspace` 必须改造 settings 装配后才能上 0.2.0（前者另需通道与槽位两项改造）。

8. **迁移后暂不可用的能力共 9 条**（§7），其中 **2 条为"插件整行不加载"级**（`@local/dsh-workerspace`、`@local/dsh-ssh-gui` 的 ESM 链接期 `SyntaxError`，均已动态复现），其余 7 条为确定退化或待实测。

9. **与并行轨道有两处结论分歧，需协调者裁决**（详见 §10）：① T16 判 `sidebar.workspaces.remoteHosts`"0.1.1 也从未声明"，本轮实测该槽**在 0.1.1 存在、在 0.1.5 线被删除** ⇒ 这是**用户可感知的迁移回归**而非"历史死项"，直接影响迁移前的知情告知；② T24 给 `rpc.handle` 的修法是"去掉第 3 参"，本轮认为该修法**既恢复不了 loopback 豁免、又预设了未验证的"注册本来就成功"**，建议以 §8.10 的真机 boot 实验为前置闸门，落点改用 `connection.fetch.register`。

---

## 2. 官方 provider 抽象差异（审计项 1）

### 2.1 与本族相关的 `lib/` 逐文件 diff（A017 → A020）

| 包 | diff 文件数 | 判定 |
|---|---|---|
| `dsh-fs` | **IDENTICAL** | 无变化 |
| `dsh-fs-local` | **IDENTICAL** | 无变化 |
| `dsh-fs-sandbox` | **IDENTICAL** | 无变化 |
| `dsh-fs-observation-policy` | **IDENTICAL** | 无变化 |
| `dsh-subprocess` | **IDENTICAL** | 无变化 |
| `dsh-subprocess-local` | **IDENTICAL** | 无变化 |
| `dsh-bash-local` | **IDENTICAL** | 无变化 |
| `dsh-bash-sandbox` | **IDENTICAL** | 无变化 |
| `dsh-tool-bash` | **IDENTICAL** | 无变化 |
| `dsh-tool-bash-persistent` | **IDENTICAL** | 无变化 |
| `dsh-tool-fs` | **IDENTICAL** | 无变化 |
| `dsh-tool-fs-search` | **IDENTICAL** | 无变化 |
| `dsh-sandbox` | **IDENTICAL** | 无变化 |
| `dsh-sandbox-policy` | **IDENTICAL** | 无变化 |
| `dsh-pwsh-local` / `dsh-pwsh-sandbox` | **IDENTICAL** | 无变化 |
| `dsh-tools` | **IDENTICAL** | 无变化 |
| `dsh-tool-workspace-dependencies` | **IDENTICAL** | 无变化（该包与"远程工作区"无关，见 §5） |
| `dsh-tool-subagent-control` | **IDENTICAL** | 无变化（0.1.7 已存在，不是 0.2.0 新增） |
| `dsh-tool-subagent` | **IDENTICAL** | 无变化 |
| `dsh-util-workspace-path` | **IDENTICAL** | 无变化 |
| `dsh-workspace` | **IDENTICAL** | 无变化 |
| `dsh-workspace-changes` | **IDENTICAL** | 无变化 |
| `dsh-api-workspace-files` | **IDENTICAL** | 无变化 |
| `dsh-host-directory-picker` | **IDENTICAL** | 无变化 |
| `dsh-host-directory-picker-auto` | **IDENTICAL** | 无变化 |
| `dsh-host-directory-picker-browse` | **IDENTICAL** | 无变化 |
| `dsh-host-directory-picker-native` | 1（`lib/index.js`） | **仅内部 `run(...)` 多传 `"hidden"`，导出签名不变** |
| `dsh-client-connection` | **IDENTICAL（0.1.7↔0.2.0）** | 无变化——但相对 0.1.1 是硬断裂，见 §2.3 |
| `dsh-client-ui-slots` | **IDENTICAL** | 无变化 |
| `dsh-client-locale` | **IDENTICAL** | 无变化 |
| `dsh-credentials` / `dsh-credentials-local` | **IDENTICAL** | 无变化 |
| `dsh-settings` | **IDENTICAL** | 无变化——但相对 0.1.1 是硬断裂，见 §2.4 |
| `dsh-user-approval` | **IDENTICAL** | 无变化 |
| `dsh-system-prompt` | **IDENTICAL** | 无变化 |
| `dsh-timeout` / `dsh-llm` / `dsh-jobs` / `dsh-tool-jobs` | **IDENTICAL** | 无变化 |
| `dsh-agent` | **IDENTICAL** | 无变化 |
| `dsh-host-webserver` / `dsh-api-gateway` / `dsh-plugin-manager` | **IDENTICAL** | 无变化 |
| `dsh-terminal` | **IDENTICAL** | 无变化 |
| `dsh-terminal-bash` | 2（`lib/index.js`、`lib/types/config.d.ts`） | **纯增量**：新增 `promptTailGraceMs` 配置项（默认 `0`），校验放宽；无破坏 |
| `dsh-sandbox-local` | 1（`lib/index.js`） | **纯增量**：win32 且无 `runnerCommand` 时 `ctx.inject(['skills'], …)` 注册 ACL 诊断 skill |
| `dsh-session` | 5 | **纯增量**：`dsh-session/lib/types/index.d.ts:21` 新增导出 `ToolCallRecovery`；`'session/created'` 事件声明（`index.d.ts:42`）**未变** |
| `dsh-client-ui-workspace` | 7 | 见 §2.2（仅 1 处注释语义变化 + 1 个 locale 键 + 1 个签名增量） |
| `dsh-api-workspace-controller` | 2 | `index.js` / `default-directory.js`：仅 `run(...)` 多传 `"hidden"` |
| `dsh-api-remotes` | 3（含 `lib/types/client/index.d.ts`） | 仅新增一行 type-only import `dsh-client-product-analytics/remote`；**该包与 SSH 无关，见 §5** |
| `dsh-app-boot` | 1 | 仅 `OPTIONAL_BUNDLES` 数组多一项 `@deepseek-ai/dsh-experimental-schedule-bundle` |

### 2.2 `dsh-client-ui-workspace` 的 7 处改动逐条判定

- `lib/types/client/contract/slots.d.ts`：唯一变化是第 70 行 `displayTitle` 的**注释**（"persisted title, project basename, or Session id" → "persisted title, or empty"）。**槽位声明未变。**
- `lib/types/client/index.d.ts`：删除了文件头一大段**说明性块注释**（这就是 §6 里 `conversation.hero.workspace` / `sidebar.workspaces` 命中文件数各减 1 的唯一原因），并新增 `session.untitled` locale 键引用。
- `lib/types/client/navigation.d.ts`：`forkSession(sessionId)` → `forkSession(sessionId, onCreated?)`，返回值 `Promise<void>` → `Promise<SessionId>`。**签名放宽（可选参数 + 更宽的返回），对本族无影响。**
- `lib/types/client/tree.d.ts`：注释语义变化（`title` 由"渲染器替换空标题"改为"渲染器本地化空标题与未命名标题"）。
- `lib/types/client/locales.d.ts`：新增 `'session.untitled'`。
- `lib/types/client/session-actions/RenameSession.d.ts`：注释变化（未命名会话以空草稿开始且必须命名）。
- `lib/client.js`：浏览器 bundle 重建。

**结论：0.2.0 对本族使用的槽位契约（`sidebar.workspaces` / `conversation.hero.workspace` / `settings.section` / `conversation.session.header.{actions,utilities}` 的声明与 owner props）没有任何破坏性变化。**

### 2.3 `dsh-client-connection`：0.1.7↔0.2.0 无变化；相对 0.1.1 的**确定变化**是 `rpc.handle` 的第 3 参被删除

```
A020/A017  dsh-client-connection/lib/index.js:573-577  get rpc() { const owner = this.ctx; return { handle: (channel, handler) => this.register(owner, channel, handler), … } }
A020/A017  dsh-client-connection/lib/index.js:640      register(owner, channel, handler) {
A020/A017  dsh-client-connection/lib/index.js:656        return owner.effect(() => owner.webServer.register(route), …)
A020/A017  dsh-client-connection/lib/index.js:798      const inject = ["credentials"];
A020/A017  dsh-client-connection/lib/index.js:14       const API_PATH = "/api";

A011       dsh-client-connection/lib/index.js:222      handle: (channel, handler, options) => this.register(owner, channel, handler, options),
A011       dsh-client-connection/lib/index.js:241      register(owner, channel, handler, options) {
A011       dsh-client-connection/lib/index.js:243        const trustedHosts = options.authority === "loopback" ? [] : this.trustedHosts;
A011       dsh-client-connection/lib/index.js:525      const inject = ["webServer"];
```

**两条相对 0.1.1 的差异，影响等级不同，必须分开陈述：**

**(a) 确定：`options` 参数被删除，loopback 豁免消失。** 0.2.0 只接受 `handle(channel, handler)`，第 3 参被**静默忽略**（不报错、不告警）。0.1.1 里 `{ authority: 'loopback' }` 会让 `trustedHosts = []`（只允许受信任的 loopback 来源），0.2.0 的前缀路由改用共享的 `admit(req)`（Host/Origin + 浏览器会话）⇒ **任何继续用这个 API 的插件都会静默失去原有的信任收紧**。这是安全语义级变化，也是 T24 的 E-1。

**(b) 未证实（且本轮被最小复现证伪）："`inject` 从 `["webServer","credentials"]` 收紧为 `["credentials"]` ⇒ `owner.webServer` 属性读取必抛 `cannot get property "webServer" without inject`"。**
插件仓库 `docs/compatibility.md` §2 与 `docs/rounds/R18-F2-dsw-405.md` 把 0.1.5 线上 `/dsw` 的失败归因于此。本轮用 `@deepseek-ai/cordis@4.0.4` 做**同形最小复现**（§9 探针 6）：

| 场景 | `inject` | 结果 |
|---|---|---|
| A：`webServer` 已挂载 | `['credentials']`（0.1.7/0.2.0 形态） | `owner.webServer` **解析成功**（`typeof === 'object'`），`handle()` **不抛**，`webServer.register('/dsw')` 被正常调用 |
| B：`webServer` **完全未挂载** | `['credentials']` | `owner.webServer === undefined` ⇒ 抛 `Cannot read properties of undefined (reading 'register')` |
| C：`webServer` 已挂载 | `['webServer','credentials']`（0.1.1 形态） | 同样解析成功、不抛 |

机制：`ReflectService.provide` 把服务值写进 **root fiber 的 store**（`cordis@4.0.4 lib/index.js:800-823`，`this.ctx.fiber.store[name] = impl`），而 ctx 代理的 `internal/get` 回退沿 fiber 链**向上走到 root 命中**（`lib/index.js:672-696`）⇒ `inject` 只控制**激活重算**，不构成属性读取的访问闸门。因此：
- `inject` 收紧**不是** `rpc.handle` 失效的充分原因；
- 报错文本也对不上（B 型的真实文本是 `Cannot read properties of undefined`，不是 `without inject`）；
- 真实组合里 `webServer` 由 `dsh-host-webserver` 行提供且 `props.webServer` 已声明 ⇒ 落在 B 型之外。

**但插件在 0.1.5-rc.2 上实测的 `POST /dsw/connections.list → 405`（`R18-F2` §3：405 由 `dsh-host-frontend-static` 的兜底位对非 GET/HEAD 返回，语义是"没有具名路由匹配到 `/dsw`"）是一条真实的**仓库内运行时记录**，本轮无法解释也无法复现**——我不把它当作已证事实，也不因为最小复现成功就否认它。两者并存的最可能解释是"真实装载期的时序/装配差异"（例如 `apply()` 执行时 `webServer` 尚未 provide，或 fiber 的 `runtime` 尚未附着），**这属于必须真机 boot 才能收敛的未验证项（§8.10）**。

**对迁移的净影响**：无论 (b) 的机制如何，**(a) 已足以判定 0.1.2 的 `/dsw` 面不能直接带到 0.2.0**（loopback 豁免确定丢失），而 0.1.4 的 `/api/dsw/*` 精确 Fetch 路由在 0.2.0 上契约一致（C18）⇒ **"升 0.1.4 + 用 `/api/dsw/*`" 的迁移路径不变，且不受 (b) 的悬而未决影响**。

`connection.fetch.register` 走另一条路（`registerFetchRoute`，`lib/index.js:625-637`，只碰 `owner.effect` + 内部 Map，**不读 `owner.webServer`**），因此不受 (a)(b) 任一条影响。契约形状一致：

```
A020 dsh-client-connection/lib/types/rpc.d.ts:111-120  ConnectionFetchRoute { path; methods; requestBody; fetch }
A020 dsh-client-connection/lib/types/rpc.d.ts:122-129  HostConnectionFetch.register(route) => () => Promise<void>
A020 dsh-client-connection/lib/index.js:14             const API_PATH = "/api";
```

### 2.4 `dsh-settings`：0.1.7↔0.2.0 无变化，但相对 0.1.1 是断裂（本族第一个硬断点的根因）

| 符号 | A011 (0.1.1-rc.2) | A017 (0.1.7-rc.2) | A020 (0.2.0-rc.1) |
|---|---|---|---|
| `settingsNamespace(value)` | 导出（`lib/types/index.d.ts:20`） | **不存在** | **不存在** |
| `installSettingsSection(ctx, ns, schema, entry, hooks)` | 导出（`lib/types/index.d.ts:341`） | **不存在** | **不存在** |
| 模块导出面 | 含上面两个 + `SettingsForms` 等 | `SettingsConflictError, SettingsForms, redactSecrets, default` | 同 A017 |
| `ctx.settings` 服务类 | `SettingsForms`，原型含 `get(` / `register(` / `resolve(` / `section(` | `SettingsForms`，原型 **无 `get`** | `SettingsForms`，原型 **无 `get`** |

全树 grep（`grep -rl installSettingsSection closure0{17,20}/node_modules/@deepseek-ai/`）**0 命中**；`settingsNamespace` 仅作为 `dsh-api-settings-controller` 的**内部**符号存活，不在任何包的导出面。

0.2.0 的正式模型（`A020/dsh-settings/README.md` + `lib/types/index.d.ts:62-133`）：settings 表按**profile entry id** 组织（`describe/update/replace/mutate`），`settings.yaml` 只在启动后被**一次性导入**并重命名为 `settings.yaml.imported`；自带页面的插件走 `ctx.settings.configure({ auto: false }, ctx.fiber)`（`dsh-client-locale/lib/index.js:23-25` 即此形状）。

> 注意：`A020/dsh-settings/README.md` 记录导入映射 `ui-developer-tools → ui-settings`、`ui-onboarding → ui-settings-general`、`shell → 平台 shell 执行器行`——即**旧命名空间段按"同名 entry id"落位**。现役 `settings.yaml` 的 `dsh-ssh-gui:` / `dsh-workerspace:` 段对应的**不是** profile 行 id（行 id 分别是 `ssh-gui` / `workerspace`，见 P011:84-85、:64-66）⇒ 这两段**大概率无法落位**。此点属 T03（settings schema 轨道）判定范围，本轮只给出交叉指引，**不在此处下结论**。

### 2.5 provider 抽象层面的一句话总结

**0.2.0 没有改任何 provider 抽象。** `ctx.fs`、`ctx.subprocess`、`ctx.sandboxPolicy`、`ctx.sandbox`、`ctx.directoryPicker`、`ctx.tools`、`ctx.credentials`、`ctx.approval`、`ctx.agents`、`ctx.jobs`、`ctx.terminal` 的服务名与抽象类均逐字节未变；**没有任何"远程 provider"抽象被引入**。本族在 0.2.0 上撞到的墙**全部落在 settings 装配、连接通道装配、客户端槽位声明**这三个非 provider 面。

---

## 3. `dsh-workspace-enhancement` 契约核验表

判定口径：**「存在」= 0.2.0 源码里该缝/符号/服务名仍在且形状兼容**。行号按 §0 的代号标注。

### 3.1 它"提供"的缝（自建服务名 / 官方缝占用）

| # | 契约假设 | 0.2.0 是否仍存在 | 证据 | 最小改造点 |
|---|---|---|---|---|
| P1 | 提供 `ctx.ssh`（SshRuntime，连接所有权） | ✅ 无冲突 | 全树（A020）无任何官方包声明 `ctx.ssh`；官方 `ssh` 字样只出现在 `host-directory-picker-auto`（"DSH 自身被 SSH 拉起"事实）与 `host-open-in-app`（launch 候选事实） | 无 |
| P2 | 提供 `ctx.subprocess`（混合路由 facade） | ✅ seam 存在且形状不变 | `A020/dsh-subprocess/lib/types/index.d.ts:42-44` `interface Context { subprocess: SubprocessRuntime }`；该包 IDENTICAL | 无（前提是官方 `subprocess` 行仍被 disable，见 P9） |
| P3 | 提供 `ctx.fs`（混合路由 facade） | ✅ seam 存在且形状不变 | `A020/dsh-fs/lib/types/index.d.ts:16-18` `interface Context { fs: FileSystem }`；该包 IDENTICAL | 无（前提同上） |
| P4 | 自建服务名 `ctx.sshRegistry` | ✅ 无冲突 | 全树（A020）grep `sshRegistry` **0 命中** | 无 |
| P5 | 自建服务名 `ctx.sideWorkspaces` | ✅ 无冲突 | 全树（A020）`lib/types/*.d.ts` grep `sideWorkspaces` **0 命中**（`sideWorkspace` 的其它命中属 Windows ACL 的文件系统旁路，无关） | 无 |
| P6 | 自建服务名 `ctx.sessionConnections` | ✅ 无冲突 | 全树（A020）**0 命中** | 无 |
| P7 | 占用官方 `ctx.directoryPicker` seam（`dsh-workspace-enhancement/picker` 行） | ✅ seam 存在且 IDENTICAL | `A020/dsh-host-directory-picker/lib/` 与 A017 逐字节相同；`DirectoryPicker` / `DirectoryPickerError` 具名导出在 0.2.0 存在（动态 import 校验通过） | 无。**注**：现役 P011 **把该行 disable 了**（`- id: directory-picker-ssh / disabled: true`），改用官方 `directory-picker-browse` ⇒ 这条缝当前并未启用 |
| P8 | bundle patch disable 官方 `directory-picker` / `subprocess` / `fs-sandbox` 三行 | ✅ 三个行 id 在 0.2.0 仍存在 | `A020/dsh-base/cordis.patch.yml:220` `id: subprocess / name: '@deepseek-ai/dsh-subprocess-local'`；`:518` `id: fs-sandbox / name: '@deepseek-ai/dsh-fs-sandbox'`；`A020/dsh-web-app/cordis.patch.yml:113` `id: directory-picker / name: '@deepseek-ai/dsh-host-directory-picker-auto'`（A017 对应 `:219/:517/:94`） | 无。**但必须纠正"insert-only"的说法**（见 §3.4） |

### 3.2 它"消费"的官方缝（上游导入面）

对 **WSE-LIVE(0.1.2)** 与 **WSE-SRC(0.1.4)** 的全部 `@deepseek-ai/*` 具名导入逐个在 A020 上做动态存在性校验（`await import(pkg)` 后 `name in m`）：

| # | 契约假设（导入符号） | 0.2.0 | 证据 |
|---|---|---|---|
| C1 | `dsh-fs`: `FileSystem`, `FsError`, `FsTargetKey`, `FsVersion` | ✅ | 包 IDENTICAL；动态校验 OK |
| C2 | `dsh-fs-local`: `LocalFileSystem` | ✅ | 同上（`lib/types/index.d.ts:28` `class LocalFileSystem extends FileSystem`） |
| C3 | `dsh-fs-sandbox`: `SandboxedFileSystem` | ✅ | 同上（`lib/types/index.d.ts:48` `class SandboxedFileSystem extends LocalFileSystem`） |
| C4 | `dsh-subprocess`: `SubprocessRuntime`, `SENSITIVE_ENV_PATTERN`（+ 类型 `CollectedOutput`/`SubprocessOutputRead`/`SubprocessOutputReader`） | ✅ | 包 IDENTICAL；动态校验 OK |
| C5 | `dsh-subprocess-local`: `LocalSubprocessRuntime` | ✅ | 同上 |
| C6 | `dsh-sandbox-policy`: `setSandboxMode`（远程会话 pin `danger-full-access`） | ✅ | 包 IDENTICAL；动态校验 OK；`session/created` 事件声明未变（`A020/dsh-session/lib/types/index.d.ts:42`） |
| C7 | `dsh-tools`: `defineTool`, `TOOL_ABORTED`, `parameterSchemaSpecToJsonSchema` | ✅ | 包 IDENTICAL；动态校验 OK |
| C8 | `dsh-host-directory-picker`: `DirectoryPicker`, `DirectoryPickerError` | ✅ | 包 IDENTICAL；动态校验 OK |
| C9 | `dsh-host-directory-picker-native`: `pickNativeDirectory` | ✅ | `lib/index.js` 有 1 处内部改动（`run(..., "hidden")`），**导出签名与 types 未变**；动态校验 OK |
| C10 | `dsh-timeout`: `MAX_TIMER_DELAY_MS` | ✅ | 包 IDENTICAL；动态校验 OK |
| C11 | `dsh-llm`: `HarnessError` | ✅ | 包 IDENTICAL；动态校验 OK |
| C12 | `dsh-agent`: `ctx.get('agents').currentInitiator()`（审批门） | ✅ | `A020/dsh-agent/lib/types/index.d.ts:218` `currentInitiator(): Agent \| undefined`；包 IDENTICAL |
| C13 | `dsh-user-approval`: `ctx.get('approval').request({ agent, toolName, reason, signal })` | ✅ | 包 IDENTICAL；`ApprovalRequest` 形状含全部 4 字段（`A020/dsh-user-approval/lib/types/index.d.ts:68-89`） |
| C14 | `dsh-jobs` / `dsh-tool-jobs`：后台任务 | ✅ | 两包 IDENTICAL |
| C15 | `dsh-credentials`：`resolve` / `describe` | ✅ | 包 IDENTICAL |
| C16 | `dsh-session`: `Session` 类型 | ✅ | 包 diff 为纯增量（新增 `ToolCallRecovery` 导出，`lib/types/index.d.ts:21`） |
| C17 | `dsh-client-ui-slots`: `LocaleDictOf` / `TranslateNS` / `LocaleNamespaceMap`（type-only） | ✅ | 包 IDENTICAL |
| **C18** | **`ctx.connection.fetch.register`（0.1.4 的 `/api/dsw/*` 精确 Fetch 路由）** | ✅ | `A020/dsh-client-connection/lib/types/rpc.d.ts:111-129`、`lib/index.js:573-584,625-637`；`API_PATH='/api'`（`lib/index.js:14`）。形状与 `WSE-SRC/src/web-channel.ts` 的 `ChannelRoute` 逐字段一致 |
| **C19** | **`ctx.connection.rpc.handle('/dsw', dispatch, { authority:'loopback' })`（0.1.2 的现役通道）** | ⚠️ **第 3 参确定失效；注册本身本轮最小复现为"能成功"，真机待实测** | 签名 `handle(channel, handler)` 只剩 2 参（`A020/…/lib/index.js:576`），`{authority:'loopback'}` 静默丢弃；`owner.webServer` 在 cordis 层可解析（§2.3 情况 A）。仓库内另有 0.1.5-rc.2 的 405 运行时记录（§8.10） |
| **C20** | **`ctx.get('settings')?.get('locale')?.preference`（宿主语言面）** | ❌ **不可用** | `A020/dsh-settings/lib/types/index.d.ts:25-28` `settings: SettingsForms`；`SettingsForms.prototype` 无 `get`（实测 `typeof SettingsForms.prototype.get === 'undefined'`，原型方法名 `constructor,importLegacyDocument,configure,invalidate,writable,documentPath,prepareDocument,describe,update,replace,mutate,write,schema`）。**0.1.2 与 0.1.4 同一份实现**（`WSE-SRC/src/locale/host.ts:60-66`；`WSE-LIVE/lib/locale/host.js:39-42`） |

### 3.3 客户端侧契约

| # | 契约假设 | 0.2.0 是否仍存在 | 证据 |
|---|---|---|---|
| U1 | `dsh.client.inject` 全部包名存在：`dsh-client-connection` / `-locale` / `-ui-conversation` / `-ui-sidebar` / `-ui-workspace` | ✅ 5/5 存在 | A020 目录存在性校验通过 |
| U2 | 同上的 `@deepseek-ai/dsh-client-runtime` | ⚠️ **A017 与 A020 都不存在** | 该名字从 0.1.7 起就不在家族包集里 ⇒ **属既有状态，不是 0.2.0 回归**；`dsh-client-modules` 的 `inject` 解析逐字节未变（包 IDENTICAL，`lib/client.js:66,125-137,656`），未观察到致命处理，列入 §9 未验证项 |
| U3 | `slots.inject('sidebar.workspaces.directoryFlow')` + `register` | ✅ | 槽位声明文件 `A020/dsh-client-ui-workspace/lib/types/client/contract/slots.d.ts:108-112`，与 A017 **逐字节相同** |
| U4 | `slots.inject('conversation.hero.workspace.directoryFlow')` | ✅ | 同上 `:102-106`，逐字节相同 |
| U5 | `slots.inject('settings.section')` | ✅ | A020 命中 35 个文件（与 A017 同） |
| U6 | `slots.inject('conversation.session.header.actions')` | ✅ | A020 命中 12 个文件（与 A017 同） |
| U7 | `slots.inject('conversation.session.header.utilities')` | ✅ | A020 命中 9 个文件（与 A017 同）；声明在 `A020/dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts`（该文件与 A017 **逐字节相同**） |
| U8 | 注入的宿主包 `dsh-client-ui-conversation` / `-sidebar` 的槽位契约文件 | ✅ | 两者 `contract/slots.d.ts` 与 A017 `cmp` 结果 **IDENTICAL**；`client-ui-sidebar` 的 diff 仅为删除一行文件头注释 |
| U9 | 0.1.1→0.2.0 的**槽位目录**整体 diff（本族用到的槽是否被删） | ✅ 本族 5 个槽全部在 A020 存在 | 见 §3.3.1 |

#### 3.3.1 客户端槽位目录跨代 diff（0.1.1 → 0.2.0），对判定"迁移后是否静默丢席位"关键

从 `*/lib/types/client/contract/slots.d.ts` 抽取 `sidebar.* / conversation.* / settings.* / shell.*` 槽 id 集合：0.1.1 有 40 个，0.2.0 有 58 个。

**仅在 0.1.1 存在（0.2.0 已删除）——共 2 个：**
```
conversation.details.tool
sidebar.workspaces.remoteHosts        ← @local/dsh-ssh-gui 注册的席位，见 §4
```

**本族用到的槽位逐项核对：**

| 使用方 | 槽 id | 0.1.1 | 0.1.7 | 0.2.0 | 判定 |
|---|---|---|---|---|---|
| WSE-SRC | `conversation.hero.workspace.directoryFlow` | ✅ | ✅ | ✅ | 保留 |
| WSE-SRC | `sidebar.workspaces.directoryFlow` | ✅ | ✅ | ✅ | 保留 |
| WSE-SRC / SSHGUI | `settings.section` | ✅ | ✅ | ✅ | 保留 |
| WSE-SRC / SSHGUI | `conversation.session.header.actions` | ✅ | ✅ | ✅ | 保留 |
| WSE-SRC | `conversation.session.header.utilities` | ✅ | ✅ | ✅ | 保留（名称未变，命中数 5→9 属新增引用方） |
| **SSHGUI** | **`sidebar.workspaces.remoteHosts`** | ✅ | ❌ | ❌ | **已删除 ⇒ 静默丢席位** |

### 3.4 「是否 insert-only」专项判定（任务点名项）

**结论：`dsh-workspace-enhancement` 明确不是 insert-only；历史描述是错的。**

`WSE-SRC/cordis.patch.yml`（= `WSE-LIVE/cordis.patch.yml`，两版逐字节相同）含 3 条 `disabled: true` 覆盖行：

```yaml
- id: directory-picker
  name: '@deepseek-ai/dsh-host-directory-picker-auto'
  disabled: true

- id: subprocess
  name: '@deepseek-ai/dsh-subprocess-local'
  disabled: true

- id: fs-sandbox
  name: '@deepseek-ai/dsh-fs-sandbox'
  disabled: true
```

且该 patch 的文件头自述理由与 insert-only 相矛盾："the local-provider rows below are therefore **DISABLED here**（this bundle layer is applied after dsh-base/dsh-web-app, so the disable wins）"、"The default host directory picker is **disabled**"。

现役 `P011` 的本地注释写「insert-only，未 disable 官方缝」，但**同一个文件**在后面的 `- id: directory-picker / disabled: true` 又把官方 `directory-picker` 禁了一次（此外还禁了自己的 `directory-picker-ssh`）。**注释与内容自相矛盾**，应以内容为准。

对照：`SSHGUI/cordis.patch.yml` **确实**是 insert-only（仅 1 条 `insert`，`grep -c disabled` = 0）；`@local/dsh-workerspace` **没有** `cordis.patch.yml`（`files` 白名单里不含，目录内实无），完全靠 profile patch 的 insert 挂载。

**兼容性影响**：三条被 disable 的行 id 在 0.2.0 全部仍然存在且 name 完全匹配（§3.1 P8），所以 disable 依然命中——但这也意味着**该族在 0.2.0 上仍会移除官方的 `dsh-subprocess-local` 与 `dsh-fs-sandbox` 两条 provider 行**。这是"远程能力不可退役"的直接后果（见 §5.3），不是 0.2.0 的破坏。

---

## 4. 其余插件判定（审计项 3）

### 4.1 `@local/dsh-ssh-gui` 0.2.0 —— 判定：**需改（1 个致命断点 + 3 项确定退化/待实测）**

上游契约面（从 `SSHGUI/lib/*.js` 的真实 `import` 语句抽取）：

```
@deepseek-ai/dsh-settings   (installSettingsSection, settingsNamespace)   ← lib/index.js:49
@deepseek-ai/dsh-tools, dsh-fs, dsh-subprocess, dsh-credentials, dsh-llm, ...
```

| # | 契约 | 0.2.0 | 证据 |
|---|---|---|---|
| S1 | `import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'` | ❌ **符号不存在** | `SSHGUI/lib/index.js:49`（导入）、`:68`（`settingsNamespace('dsh-ssh-gui')`）、`:173`（`installSettingsSection(...)`）；A017/A020 全树 0 命中（§2.4） |
| S2 | `ctx.connection.rpc.handle('/ssh-gui', dispatch, { authority: 'loopback' })` | ⚠️ **第 3 参确定失效；注册成败待实测** | `SSHGUI/lib/index.js:460`；`inject`/`webServer` 的机制分析见 §2.3（最小复现显示可解析，仓库内另有 405 记录） |
| S3 | 第 3 参 `{ authority: 'loopback' }` 的 loopback 豁免 | ❌ **语义消失（确定）** | 0.2.0 `handle(channel, handler)` 只 2 参（`A020/…/lib/index.js:576`），第 3 参被静默忽略；`A011/…:243` 的 `options.authority === "loopback"` 分支不存在 |
| S4 | 客户端 `connection.rpc.call(channel, endpoint, payload, signal)` 调用形状 | ✅ 客户端半未变 | `dsh-client-connection` 包 IDENTICAL（`lib/client.js:1212` `async call(channel, endpoint, payload, signal)`）；但**服务端通道不存在**，调用只会拿到 404/405 |
| S5 | 客户端槽位 `settings.section`、`conversation.session.header.actions` | ✅ | §3.3.1 |
| S6 | 客户端槽位 `sidebar.workspaces.remoteHosts` | ❌ **0.2.0 未声明** | `SSHGUI/lib/client.js:1018-1019` 注册；A017/A020 全树 0 命中，A011 存在 ⇒ **0.1.5 线删除**。`slots.inject` 对未声明槽位无异常、回调永不执行 ⇒ 侧栏树**静默消失** |
| S7 | settings 命名空间 `dsh-ssh-gui`（`~/.dsh/settings.yaml` 段） | ⚠️ 语义改变 | 0.2.0 settings 表按 profile entry id 组织；profile 行 id 是 `ssh-gui`（`P011:84-85`），与段名 `dsh-ssh-gui` 不同名 ⇒ 旧段大概率不落位（**交叉 T03 判定**） |
| S8 | peer 范围 `@deepseek-ai/dsh-credentials >=0.1.1-rc.2 <0.2.0`、`dsh-settings >=0.1.1-rc.2 <0.2.0`、`dsh-workspace-enhancement 0.1.2` | ❌ semver 不含 0.2.0 | `semver.satisfies('0.2.0-rc.1', '>=0.1.1-rc.2 <0.2.0') === false`（实测）。安装期是否强制校验未验证（§9） |

**动态复现（本族第一个硬断点）**：把 `SSHGUI` 复制进隔离探针树（`node_modules/@deepseek-ai/* → A020`，`node_modules/dsh-workspace-enhancement → WSE-LIVE`），执行 `await import('@local/dsh-ssh-gui')`：

```
IMPORT FAIL: SyntaxError
The requested module '@deepseek-ai/dsh-settings' does not provide an export named 'installSettingsSection'
```

（探针脚本与目录见 §10，可重跑。）

### 4.2 `@local/dsh-workerspace` 0.1.0 —— 判定：**需改（1 个致命断点）**

| # | 契约 | 0.2.0 | 证据 |
|---|---|---|---|
| W1 | `import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'` | ❌ **符号不存在** | `WS/lib/index.js:30`（导入）、`:41` `settingsNamespace("dsh-workerspace")`、`:123` `installSettingsSection(...)` |
| W2 | 工具名 `ws_serial_list` / `ws_serial_open` / `ws_serial_send` / `ws_serial_read` / `ws_serial_close` / `ws_flash` | ✅ 无冲突 | A020 全树无 `ws_*` 工具名（grep 0 命中）；`dsh-tools` 包 IDENTICAL |
| W3 | `defineTool`（`dsh-tools`）+ `ctx.tools.register` | ✅ | 包 IDENTICAL |
| W4 | `ctx.get('approval').request({ agent, toolName, reason, signal })` | ✅ | `dsh-user-approval` 包 IDENTICAL；`ApprovalRequest` 含 4 字段（`A020/dsh-user-approval/lib/types/index.d.ts:68-89`） |
| W5 | `ctx.get('subprocess').spawn(spec)` | ✅ | `dsh-subprocess` / `dsh-subprocess-local` 均 IDENTICAL |
| W6 | settings 命名空间 `dsh-workerspace` | ⚠️ 语义改变 | profile 行 id 是 `workerspace`（`P011:64-66`），与段名不同名（同 S7，交叉 T03） |
| W7 | peer 范围 `@deepseek-ai/dsh-{credentials,fs,settings,subprocess,tools,user-approval} ^0.1.1-rc.2` | ❌ semver 不含 0.2.0 | `semver.satisfies('0.2.0-rc.1', '^0.1.1-rc.2') === false`（实测） |
| W8 | 被 `@local/dsh-ssh-gui` 借用的模块路径 `lib/serial.js`（绕开 `exports` 白名单） | ✅ 存在 | `WS/lib/serial.js` 在包内；对 0.2.0 无依赖关系 |

**动态复现（本族第一个硬断点的独立实例）**：

```
IMPORT FAIL: SyntaxError
The requested module '@deepseek-ai/dsh-settings' does not provide an export named 'installSettingsSection'
```

### 4.3 `dsh-workspace-enhancement` —— 判定：**需改（必须升版本 + 修语言面 + 修通道面）**

| 版本 | 对 0.2.0 的可用性 | 依据 |
|---|---|---|
| **0.1.2（现役 WSE-LIVE）** | ⚠️ **不确定（不建议）** | (1) `/dsw` 走 `connection.rpc.handle`（`lib/web.js:504`）：**loopback 豁免确定丢失**（第 3 参被忽略），注册成败待真机实测（§2.3、§8.10）；(2) 语言面 `ctx.settings.get('locale')` ⇒ `TypeError`（同 0.1.4，见下）；(3) 缺失 0.1.4 的会话连接/远程围栏/审批门 |
| **0.1.4（WSE-SRC，仓库 HEAD `ee25ed1`）** | ⚠️ **模块可加载，但运行期语言面必抛；其余主体面在 0.2.0 成立** | (1) 模块级 `await import('dsh-workspace-enhancement')` 在 A020 树中 **IMPORT OK**（实测，导出 32 个符号）；(2) `/api/dsw/*` 走 `connection.fetch.register`，0.2.0 契约一致（C18）；(3) 语言面同 0.1.2 必抛（下）；(4) peer 范围 `^0.1.5-rc.1` 不含 0.2.0 |

**动态复现（本族第二个硬断点）**——用 0.2.0 真实的 `SettingsForms` 原型构造 `ctx.settings` 的忠实替身：

```
$ node --input-type=module -e "…hostLocaleOf({get:(n,d)=> n==='settings' ? Object.create(SettingsForms.prototype) : d})…"
0.1.4(源码同形)  active() THREW: TypeError - settings?.get is not a function
0.1.4(源码同形)  t()      THREW: TypeError - settings?.get is not a function
LIVE 0.1.2       active() THREW: TypeError - settings?.get is not a function
```

调用点（触发面）：`WSE-SRC/src/tools.ts:415`（工具注册时取 `locale`，`localizeTool` 把 `description`/`parameters` 包成 getter ⇒ **在首次工具 schema 投影 / 首个会话的首轮 prompt 组装时抛**）、`src/web.ts:317`、`src/registry.ts:756`、`src/exec-tools.ts:922,1103`、`src/session-workspaces.ts:394`、`src/transport.ts:149,155,172`。`hostLocaleOf(ctx)` 本身安全（只调 `ctx.get`），抛点在 `t()` / `active()` 的**求值**。

**受影响能力**：工具描述与参数文案的运行时本地化（`locale.t`）、RPC 错误的本地化文案、`sw_*` 工具的 schema 投影。

### 4.4 三插件的装配面（现役 profile patch 事实，只读核对）

`P011`（现役）与本族相关的行：
- `insert` × 3：`ssh-remote`（`dsh-workspace-enhancement`）、`directory-picker-ssh`（`…/picker`）、`ssh-web-channel`（`…/web`）
- `insert` × 2：`workerspace`（`@local/dsh-workerspace`）、`ssh-gui`（`@local/dsh-ssh-gui`）
- `disabled: true` × 2：官方 `directory-picker`、以及插件自己的 `directory-picker-ssh`
- `insert` × 1：官方 `directory-picker-browse`（**替代**被禁的 `-auto`）

⇒ 现役部署中，**SSH 目录选择器是关的，走官方 in-app browser**；远程目录浏览由插件的客户端 UI 走 `/api/dsw/browse`（0.1.2 是 `/dsw/browse`）承担。

---

## 5. 官方内置能力判定（审计项 4）

### 5.1 检索范围（明确写出，便于复核）

1. 包集增量 `comm`：A017 vs A020 的 `@deepseek-ai/*` 目录名（0 删除 / 5 新增，见 §0.1）。
2. 全树 grep（A020，`*/lib/`）：`ssh2`、`ssh://`、`remote workspace` / `remote-workspace` / `remoteWorkspace` —— **全部 0 命中**。
3. 全树 grep（A020，`*/lib/types/*.d.ts`）：`sshRegistry`、`sideWorkspaces`、`sessionConnections` —— **0 命中**（即无官方同名服务）。
4. 可疑包逐个读 README + types：`dsh-api-remotes`、`dsh-api-workspace-controller`、`dsh-workspace`、`dsh-workspace-changes`、`dsh-tool-workspace-dependencies`、`dsh-tool-subagent-control`、`dsh-host-directory-picker-auto`、`dsh-host-open-in-app`。
5. profiles/preset 面：`dsh-base/cordis.patch.yml`（A017↔A020 全量 diff，只有 OTel 变化）、`dsh-web-app/cordis.patch.yml`（只有 telemetry / schedule / session-log 相关行变化）、`dsh-web-app/presets/standard.patch.yml`（A017↔A020 **逐字节相同**）。

### 5.2 判定

| 能力 | 0.2.0 官方是否内置 | 证据 |
|---|---|---|
| SSH 远程主机上的命令执行 / 文件系统 / PTY（远程工作区） | ❌ **没有** | 检索范围 1–3；`ctx.fs` / `ctx.subprocess` 无 provider 抽象变化；家族无 `ssh2` 依赖 |
| 远程目录浏览 / 远程主机连接注册表 | ❌ **没有** | 同上 |
| 会话挂多目录（"side workspace"） | ❌ **没有** | `dsh-workspace` 是"一个 Workspace = 一个本机目录"，`WorkspaceView.path` 为本机 `fs.realpath`；session header cwd 必须等于 workspace path（`A020/dsh-workspace/lib/types/types.d.ts:61-92`） |
| **多工作区（本机多目录的项目列表 + 会话归组 + 排序/隐藏/移除）** | ✅ **有，且早已存在** | `dsh-workspace`（`ctx.workspaceRegistry`，持久化项目列表）；A017↔A020 `lib/` **逐字节相同**；`dsh-api-workspace-controller` 提供 `WorkspaceView`/create/rename/move/archive 的 Remote 词汇（`lib/types/types.d.ts:15-27`） |
| "SSH 拉起 DSH 后用浏览器访问"（宿主自身在远端） | ✅ 有（但语义不同） | `dsh-host-directory-picker-auto/lib/types/resolve.d.ts:18-22`：`ssh: boolean` = **DSH 进程自身被 SSH 拉起**的事实，用来把目录选择器降级为 `browse`。这是"DSH 在远端"，**不是"DSH 驱动远端"**——与远程工作区正交 |
| 在远端 IDE 打开文件 | ✅ 有（但语义不同） | `dsh-host-open-in-app/lib/types/resolver.d.ts:63,78` 的 `ssh?: boolean` 同属"自身被 SSH 拉起"的 launch 事实 |

### 5.3 结论与"可退役性"

- **不能整体退役该族定制。** 现役部署真正无法被官方替代的能力有三块：**① 远程（SSH）会话的工作目录与执行/文件/PTY 通道；② 多机连接注册表（机器 CRUD / TOFU 主机密钥 / keychain 凭据 / `~/.ssh/config` 别名）；③ 会话内挂远程侧目录**。
- **可以退役的部分**：本机多工作区的"项目列表"本身已是官方能力（`dsh-workspace` + `dsh-client-ui-workspace` 侧栏），定制的 **侧栏/客户端增强** 中有相当部分与之重叠；但因为定制还在承担远程路由与远程浏览，**退役必须按能力切分而不是按插件切分**。
- `dsh-api-remotes` 的"remotes"是 **BFF 的 Host Remote contributions 门面**（API Gateway 的 RPC 装配），与 SSH 主机无关——`A020/dsh-api-remotes/README.md` 明确其为"Application Remote assembly: selects typed Host capabilities and forwarded events for Client consumers"。**不要把它误读为远程主机能力。**
- `dsh-tool-workspace-dependencies` 是"内置 Python/Node/pnpm 载荷路径"工具，与工作区/远程**无关**（`A020/dsh-tool-workspace-dependencies/README.md`）。
- `dsh-tool-subagent-control` 是 `send_message` / `interrupt_agent` / `list_agents` 三个子代理控制工具（`A020/dsh-tool-subagent-control/README.md`），与工作区/远程**无关**，且 0.1.7 已存在。

---

## 6. 逐插件迁移判定与最小改造清单（审计项 5）

> 说明：改造单元按"改哪个文件 / 改什么 / 验收标准"拆分，**不在此轨道实施**（只读审计）。所有改动都必须落在**插件源码**（`WSE-SRC` / `SSHGUI` / `WS` 的仓库），不得改 `~/.dsh/**`。

### 6.1 判定汇总

| 插件 | 现版本 | 判定 | 阻塞级 |
|---|---|---|---|
| `dsh-workspace-enhancement` | 0.1.2（现役）→ 候选 0.1.4 | **需改**：升级 + 语言面改造 + peer 放宽 | 高（语言面运行期必抛，已复现；0.1.2 的 `/dsw` 面 loopback 豁免确定丢失、注册成败待实测） |
| `@local/dsh-ssh-gui` | 0.2.0 | **需改**：settings 装配 + 通道装配 + 槽位重挂 + peer 放宽 | **致命**（模块加载即失败） |
| `@local/dsh-workerspace` | 0.1.0 | **需改**：settings 装配 + peer 放宽 | **致命**（模块加载即失败） |
| 可退役插件 | — | **0 个** | 见 §5.3 |

### 6.2 交付单元（精确到文件/符号/验收）

#### U-1 `@local/dsh-workerspace`：settings 装配迁移到 0.2.0 模型
- **文件**：`@local/dsh-workerspace/lib/index.js`（源码树对应文件）
- **改动**：
  1. 删除第 30 行的 `import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";`
  2. 删除第 41 行 `const WS_SETTINGS_NAMESPACE = settingsNamespace("dsh-workerspace");`
  3. 删除第 123 行的 `installSettingsSection(ctx, WS_SETTINGS_NAMESPACE, Config, config, {...})` 调用；保留 `Config` 作为 cordis 行的 schema（0.2.0 的 settings 表按 **profile entry id** 投影，行 id = `workerspace` 即命名空间）
  4. 若需隐藏自动表单页，改为可选注入形态：`ctx.inject(['settings'], child => child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)))`（与官方 `dsh-client-locale/lib/index.js:23-25` 同形）
- **前置依赖**：settings 段的落位规则由 T03 给出（`dsh-workerspace:` → `workerspace:` 的段名映射/迁移写法）
- **验收**：在 A020 隔离树上 `await import('@local/dsh-workerspace')` 返回 OK 且导出含 `apply`；宿主启动后 6 个 `ws_*` 工具在工具目录中可见；`settings` 页能读写 `ws_flash` 相关开关。

#### U-2 `@local/dsh-ssh-gui`：settings 装配迁移（同 U-1 形状）
- **文件**：`@local/dsh-ssh-gui/lib/index.js`
- **改动**：`L49 / L68 / L173` 三处同 U-1；命名空间由 `dsh-ssh-gui` 改为 profile 行 id `ssh-gui`
- **验收**：`await import('@local/dsh-ssh-gui')` 返回 OK；设置页出现节点管理入口。

#### U-3 `@local/dsh-ssh-gui`：`/ssh-gui` 通道从 `rpc.handle` 迁到 `/api` 精确 Fetch 路由
- **文件**：`@local/dsh-ssh-gui/lib/index.js`（`:460` 的注册点）
- **改动**（照抄 `WSE-SRC/src/web-channel.ts` 已验证的形状）：
  1. 把 `ctx.connection.rpc.handle('/ssh-gui', dispatch, { authority: 'loopback' })` 换成 `ctx.connection.fetch.register(route)`，`route.path` 形如 `` `/api/ssh-gui/<endpoint>` ``、`methods: ['POST']`、`requestBody: 'buffered'`
  2. 服务端复用官方信封 `{type:'client-request', rpcId, method, payload}` → `{type:'server-response', rpcId, result:{ok,value}|{ok:false,error}}`（与 `A020/dsh-client-connection/lib/index.js` 的 `rpcFetchHandler` 同形），并让 `route.fetch` 校验 `method === 'ssh-gui/<endpoint>'`
  3. 客户端（`lib/client.js` 的 `connection.rpc.call(channel, endpoint, payload, signal)`）改为 `call('/api', 'ssh-gui/<endpoint>', payload, signal)`
  4. **loopback 豁免的处理**：0.2.0 无 `authority: 'loopback'` 等价物；精确 Fetch 路由在物理载体层已通过共享的 `admit(req)`（Host/Origin + 浏览器会话）校验后再进入 handler ⇒ loopback 豁免**不需要也不可移植**，但必须**显式复核**该通道的信任假设（本机页面 vs 远程浏览器）并写进插件的安全说明
  5. 幂等：对 "is already registered" 形态的重复注册错误按 `WSE-SRC/src/web-channel.ts:isAlreadyRegistered` 的做法降级（热重载不抛）
- **验收**：0.2.0 宿主启动后 `POST /api/ssh-gui/<某只读端点>` → 200 且信封合法；热重载插件不抛。

#### U-4 `@local/dsh-ssh-gui`：侧栏席位重挂
- **文件**：`@local/dsh-ssh-gui/lib/client.js`（`:1018`）
- **改动**：`sidebar.workspaces.remoteHosts` 在 0.2.0 不存在。重挂到 0.2.0 实际声明的入口：`sidebar.panellist`（侧栏面板入口，A020 新增）或 `sidebar.workspaces.session.row.action` / `sidebar.session.row.leading` / `sidebar.session.row.hover`（会话行级席位），或退化为 `settings.section` 内的完整入口（代码里 `:739` 已有同 UX 的设置页补全入口，可作为降级路径）
- **验收**：0.2.0 GUI 中「分布式节点」入口可见且可展开；无静默丢失（用插件的 `scripts/slot-catalog.mjs --diff` 类工具或等价清单核对）。

#### U-5 `dsh-workspace-enhancement`：宿主语言面改造（**0.2.0 与 0.1.7 同构，改造一次即可同时满足两代**）
- **文件**：`src/locale/host.ts`（`hostLocaleOf`，`:60-66`）
- **改动**：把 `settings?.get('locale')?.preference` 换成 0.2.0 settings 模型的读法——`ctx.get('settings')` 现为 `SettingsForms`，语言段由 **profile entry id**（`dsh-client-locale` 对应行）承载，可用 `settings.describe()` 的投影读取，或改为从客户端推送/会话上下文获取（T03 需给出"宿主如何读 locale 段"的权威写法）。**必须保留可选服务语义**（无 settings 服务 → 回退 `'en'`），不得把 `settings` 变成硬依赖
- **验收**：在 A020 树上构造 `ctx.settings = SettingsForms 实例` 后 `active()` / `t(key)` **不再抛**且返回 `'zh'`/`'en'` 正确；`sw_*` 工具的 schema 投影不抛。

#### U-6 `dsh-workspace-enhancement`：升到 0.1.4+ 并按 0.2.0 放宽 peer / 加通道哨兵
- **文件**：`package.json`（`peerDependencies` 13 项 + `devDependencies` 21 项）
- **改动**：把 `^0.1.5-rc.1` 扩成含 0.2.0 的联合范围，并**给 0.2.0 家族补一条 `upstream.yml` 哨兵通道**（该仓库现有 L1 静态闸门 #6 要求"联合范围里每个家族都必须被点名 + 有对应通道"，声明多一条就必须多验一条）
- **验收**：`npm run check` 的 #6 通过；0.2.0 通道上 typecheck + 单测 + `scripts/boot-smoke.mjs` 全绿（boot 冒烟必须断言 `POST /api/dsw/connections.list → 200` 且 `result.ok=true`）。

#### U-7 `dsh-workspace-enhancement`：**禁止**用 0.1.2 迁 0.2.0
- **改动**：迁移 Runbook 必须写明"先升插件、再升宿主"的顺序约束；0.1.2 的 `/dsw` 前缀通道在 0.1.7 起**已丢掉 loopback 信任豁免且可用性存疑**（§8.10），且 0.1.2 缺 0.1.4 的会话连接/远程围栏/审批门能力
- **验收**：Runbook 中有显式的"插件 ≤0.1.3 + 宿主 ≥0.1.7 = 拒绝迁移"闸门。

#### U-8 三个插件的 peer 范围与安装期校验
- **文件**：三个 `package.json`
- **改动**：把 `^0.1.1-rc.2` / `>=0.1.1-rc.2 <0.2.0` / `^0.1.5-rc.1` / `0.1.2`（`ssh-gui` 对底座的**精确 pin**）统一放宽到含 `0.2.0-rc.1` 的联合范围；`ssh-gui` 对底座的 pin 必须与迁移后实际安装的底座版本一致
- **验收**：`semver.satisfies('0.2.0-rc.1', <新范围>) === true`；安装期无 peer 警告（安装期是否强制校验见 §9）。

---

## 7. 迁移后暂时不可用的能力清单（9 条）

按"用户能感知的后果"排序；标 ⛔ 者为**插件整行不加载**级，⚠️ 为确定退化或待实测。

| # | 能力 | 后果 | 根因 | 是否有既定修法 |
|---|---|---|---|---|
| 1 ⛔ | **`@local/dsh-workerspace` 全部工具**（`ws_serial_list/open/send/read/close`、`ws_flash`） | SoC 串口收发、日志、烧录白名单全不可用（含 T17 任务书里给的 `ws_serial_*` / `ws_flash` 全部入口） | `dsh-settings` 删除 `installSettingsSection` ⇒ ESM 链期 SyntaxError | U-1 |
| 2 ⛔ | **`@local/dsh-ssh-gui` 全部能力** | 分布式控制 GUI（节点 CRUD / 状态 / `exec.run` / `file.get/put` / 目录浏览）整行不可用 | 同上 | U-2 |
| 3 ⚠️ | **`@local/dsh-ssh-gui` 的 `/ssh-gui` 通道的 loopback 信任豁免** | 该通道不再有 0.1.1 的 loopback-only 收紧，改由共享 Host/Origin + 浏览器会话策略裁决；注册本身是否成功待真机实测 | `handle` 第 3 参被删除（静默忽略） | U-3 |
| 4 | **`dsh-workspace-enhancement` 的宿主语言面**（工具描述/参数/RPC 错误本地化） | 首次工具 schema 投影即抛 `TypeError`；本地化文案退化为不可用 | `ctx.settings.get(ns)` 在 0.1.5+ 不存在 | U-5（这是**唯一需要改底座源码**的项） |
| 5 ⚠️ | **`/dsw` 数据面**（若沿用 0.1.2） | ① loopback 豁免确定丢失（安全语义）；② 通道是否可用**待实测**——若失败则连接列表/状态/重连/远程浏览整体不可用（仓库内 0.1.5-rc.2 有 405 记录） | `handle` 第 3 参被删除；注册成败的机制未收敛（§8.10） | U-7（升 0.1.4 后改为 `/api/dsw/*`，两条风险一并消除） |
| 6 | **SSH 目录选择器**（`dsh-workspace-enhancement/picker`） | 现状即已关（P011 disable），迁移后仍关；官方 `directory-picker-browse` 顶替，但**只能浏览本机** | 配置取舍，非技术阻断 | 若要恢复需在 0.2.0 上重开该行并复核 `ctx.directoryPicker` 单占位 |
| 7 | **`@local/dsh-ssh-gui` 侧栏「分布式节点」树** | 静默消失（不报错） | `sidebar.workspaces.remoteHosts` 槽在 0.1.5 线被删除 | U-4 |
| 8 | **settings 段 `dsh-ssh-gui:` / `dsh-workerspace:` 的用户设置** | 旧值可能不落位（段名 ≠ profile 行 id） | 0.2.0 settings 表按 entry id 组织 + `settings.yaml` 一次性导入 | 交叉 T03；U-1/U-2 的命名空间改名配套 |
| 9 | **远程工作区的"审批门/远程围栏"等 0.1.4 增强** | 若坚持用 0.1.2，这些能力本来就没有；用 0.1.4 则有 | 版本选择 | U-6/U-7 |

> 计口径说明：⛔ = 插件整行不加载（本轮已动态复现）；⚠️ = 确定退化或待实测。第 1、2 条为 ⛔；第 3、4、5、6、7、8、9 条为 ⚠️。

> 未列入上表的乐观结论（迁移后**仍然可用**，已核验）：`sw_status` / `sw_connect` / `sw_pick_workspace` / `sw_exec` 四个工具的注册面与上游依赖；`ctx.ssh` / `ctx.sshRegistry` / `ctx.sideWorkspaces` / `ctx.sessionConnections` 四个自建服务名；`DirectoryPicker` seam；5 个客户端槽中的 4 个；`approval` / `agents` / `jobs` / `credentials` / `terminal` 侧的调用形状。

---

## 8. 未验证项（明确边界，供裁决是否补测）

1. **真实宿主 boot 未跑。** 本轮全部结论来自"源码 diff + 模块加载 + 符号存在性"的隔离探针；**未启动任何 0.2.0 宿主实例**（硬约束：不启动监听端口的服务）。因此"插件整行不加载后宿主是否仍能启动""工具是否真的缺席"属**静态+加载级推断**，未经端到端 boot 证实。
2. **安装期 peer 校验是否强制未验证。** 已证实三个插件的 peer 范围 semver 不含 `0.2.0-rc.1`（实测 `semver.satisfies`），但 `dsh plugin add/install` 在 peer 不满足时是**警告**还是**拒绝**，本轮未执行安装命令、未验证。
3. **`ctx.settings.describe()` 作为语言面的替代读法未端到端验证。** 只证实了 `SettingsForms` 的原型方法清单与 `describe/update/replace/mutate` 的存在，未在真实组合里验证"宿主插件读 locale 段"的正确姿势（需 T03 权威结论）。
4. **`dsh.client.inject` 中不存在的 `@deepseek-ai/dsh-client-runtime` 是否会产生运行时告警/失败未验证。** 已证实该名字在 0.1.7 与 0.2.0 **都不存在**（非 0.2.0 回归），且 `dsh-client-modules` 包逐字节未变；但"缺失注入名"的实际处理分支未跑。
5. **`refresh`/热重载路径未验证。** `connection.fetch.register` 的重复注册降级假设（`isAlreadyRegistered`）来自 `WSE-SRC` 注释，本轮未在 0.2.0 上实测热重载。
6. **远程工作区的端到端执行（真 SSH）未验证。** 按硬约束**一律不对远端发起连接**，因此"混合 provider 在 0.2.0 上真正把命令送到远端"未验证；本轮只验证了其**上游契约面**。
7. **0.1.4 的 `lib/` 未构建。** `WSE-SRC` 只有 `src/`（TS），本轮对其做的是**源码级契约核验**与"用 0.1.2 已构建产物做加载级对照"；0.1.4 的**构建产物**在 0.2.0 上的加载未直接测（0.1.4 与 0.1.2 在 settings/通道两面是不同实现，已知 0.1.4 的通道面应可用）。若需强证据，需先 `npm run build` 再重跑 §10 探针。
8. **`~/.dsh/remote-workspaces/` 的机器/节点状态文件是否跨代可读未验证。** 未读取该目录内容（硬约束只读 + 隐私纪律），`machines.json` / `nodes.json` / 主机密钥 / keyRef 侧表的格式兼容性未核对。
9. **`dsh-sandbox-windows-acl` / `dsh-terminal-bash` 的改动对本族的影响未深究。** 已知前者新增 win32 ACL 诊断 skill 注册、后者新增 `promptTailGraceMs` 配置项，判定为纯增量；但在 win32 部署上的实际交互未验证（本机为 linux）。
10. **`connection.rpc.handle` 在 0.2.0 真实组合中到底成功还是失败 —— 本轨道最重要的悬置项。** 本轮已证：① `options` 第 3 参确定被删除、loopback 豁免确定丢失；② `owner.webServer` 在 `@deepseek-ai/cordis@4.0.4` 的最小同形复现中**无论 `inject` 如何都能解析**（§2.3 情况 A/C），所以"`inject` 收紧 ⇒ 必抛 `without inject`"这一归因**不成立**；③ 仅当 `webServer` 完全未挂载时才失败，且报错文本是 `Cannot read properties of undefined (reading 'register')`，与插件文档记录的文本不符。**无法解释的对照事实**：插件仓库记录 0.1.5-rc.2 上 `POST /dsw/connections.list → 405`（`docs/rounds/R18-F2-dsw-405.md` §3、`docs/compatibility.md` §2 的 2026-09-10 F1 / 2026-09-11 F2 两行），是**运行时实测记录**。两者并存的最可能解释是真实装载期的时序差异（`apply()` 时 `webServer` 尚未 provide，或 fiber `runtime` 尚未附着），但这**必须靠一次真实 boot 收敛**。**收敛方式（不属本轨道）**：在 0.2.0 隔离宿主里挂一个最小插件，`apply()` 内调用 `ctx.connection.rpc.handle('/probe', …)` 后断言 `GET/POST /probe/...` 的状态码；并在 0.1.7 隔离宿主上做同一实验作为对照。**在该实验完成前，Runbook 不得把 `/dsw` 写成"确定可用"或"确定不可用"。**
11. **本轨道未验证 `dir`/路径映射层面的一致性**：`dsh-util-workspace-path` 虽逐字节未变，但 0.2.0 的 `dsh-api-workspace-controller` 有 2 处 `run(..., "hidden")` 改动；本轮未核对「本机 workspace 路径 ↔ ssh 路由占位树（`dsw-routes/`）」在两侧的归一语义是否仍一致。

---

## 9. 附录：可重跑的探针与命令

```bash
# 1) 契约差异（本轮主判据）
cd .workspace/audit-020/work
for p in dsh-fs dsh-fs-local dsh-fs-sandbox dsh-subprocess dsh-subprocess-local \
         dsh-tools dsh-host-directory-picker dsh-client-connection dsh-settings \
         dsh-workspace dsh-tool-workspace-dependencies dsh-tool-subagent-control; do
  n=$(diff -rq closure017/node_modules/@deepseek-ai/$p/lib closure020/node_modules/@deepseek-ai/$p/lib | wc -l)
  echo "$p $n"
done

# 2) 0.1.5 线 settings API 删除
grep -rln "installSettingsSection" closure0{17,20}/node_modules/@deepseek-ai/   # 期望 0 命中
grep -rln "installSettingsSection" ~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-settings/  # 0.1.1：有

# 3) 插件加载级探针（隔离目录，已在 .workspace/audit-020/t17/probe）
#    node_modules/@deepseek-ai/* -> closure020 的 289 包；@local/* 与 dsh-workspace-enhancement 为副本（副本才能让解析走 0.2.0 树）；
#    ssh2/asn1/bcrypt-pbkdf/tweetnacl/nan/buildcheck/cpu-features 由现役插件自带的 node_modules 软链入
cd .workspace/audit-020/t17/probe
node --input-type=module -e "await import('@local/dsh-workerspace')"   # 期望 SyntaxError: installSettingsSection
node --input-type=module -e "await import('@local/dsh-ssh-gui')"      # 期望 同上
node --input-type=module -e "await import('dsh-workspace-enhancement')" # 期望 IMPORT OK（0.1.2 模块级可加载）

# 4) 语言面 TypeError 复现
cd .workspace/audit-020/t17/probe
node --input-type=module -e "
const m = await import('./node_modules/dsh-workspace-enhancement/lib/locale/host.js');
const { default: S } = await import('@deepseek-ai/dsh-settings');
const face = m.hostLocaleOf({ get: (n,d) => n==='settings' ? Object.create(S.prototype) : d });
try { face.active() } catch (e) { console.log(e.constructor.name, '-', e.message) }
"   # 期望 TypeError - settings?.get is not a function

# 5) 槽位目录跨代 diff
A=~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai
B=.workspace/audit-020/work/closure020/node_modules/@deepseek-ai
grep -rhoE "'(sidebar|conversation|settings|shell)\.[a-zA-Z.]*'" $A/*/lib/types/client/contract/slots.d.ts | tr -d "'" | sort -u > /tmp/s011.txt
grep -rhoE "'(sidebar|conversation|settings|shell)\.[a-zA-Z.]*'" $B/*/lib/types/client/contract/slots.d.ts | tr -d "'" | sort -u > /tmp/s020.txt
comm -23 /tmp/s011.txt /tmp/s020.txt   # 期望：conversation.details.tool / sidebar.workspaces.remoteHosts
comm -13 /tmp/s011.txt /tmp/s020.txt   # 期望：20 条新增槽（sidebar.panellist / conversation.header* / sidebar.session.row.* / shell.overlay …）

# 6) cordis 服务解析最小复现（判定 `rpc.handle` 是否因 inject 收紧而失效）
cd .workspace/audit-020/t17/probe && node cordis-probe3.mjs
#   期望：A) webServer 已挂 + inject=['credentials']   => RESOLVED（不抛）
#         B) webServer 未挂 + inject=['credentials']   => THREW: Cannot read properties of undefined (reading 'register')
#         C) webServer 已挂 + inject=['webServer','credentials'] => RESOLVED
#   源码依据：cordis@4.0.4 lib/index.js:800-823（provide 写 root fiber store）、:672-696（internal/get 回退沿 fiber 链上溯）
```

探针树位置：`.workspace/audit-020/t17/probe/`（3.7 MB；`dsh-workspace-enhancement` 的可执行副本为其 0.1.2 产物，`lib/` 完整、`node_modules/` 已剥离）。**不含任何密钥、凭据、会话正文或真实主机信息。**

---

## 10. 与并行轨道的结论分歧（协调者需裁决）

本轨道完成时，`reports/` 下已有若干同一主题的并行产物（`T16-web-client-plugin-compat.md`、`T24-workspace-enhancement-units.md`、`T08-local-plugin-inventory.md`）。本轮实测与其中两处**存在分歧**，逐条给出证据，供协调者裁决：

### 10.1 分歧一：`sidebar.workspaces.remoteHosts` 是否"0.1.1 也从未声明"

- **T16 的结论**（`T16-web-client-plugin-compat.md:499,668`）：该槽"在 0.1.1 的 48 项目录里**不存在**，0.2.0 也不存在 ⇒ 既有失效（静默）"，并据此把 `@local/dsh-ssh-gui` 判为"需改（小）· 1 处席位迁移"。
- **本轨道实测（相左）**：该槽 **在 0.1.1-rc.2 里存在**：
  ```
  $ grep -rl "sidebar.workspaces.remoteHosts" ~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/*/lib/
  dsh-client-ui-workspace/lib/types/client/contract/slots.d.ts
  dsh-client-ui-workspace/lib/client.js
  $ grep -rho "sidebar\.workspaces\.[a-zA-Z.]*" ~/.npm-global/.../dsh-client-ui-workspace/lib/types/client/contract/slots.d.ts | sort -u
  sidebar.workspaces.directoryFlow
  sidebar.workspaces.remoteHosts
  ```
  而 `0.1.7-rc.2` 与 `0.2.0-rc.1` 全树 **0 命中** ⇒ 它是**在 0.1.5 线被删除**的槽，不是"历史死项"。
- **差异的实际后果**：按 T16，"侧栏树从来没工作过"（迁移无损失）；按本轨道，"它今天在 3080 上工作，迁移后消失"（**用户可感知的回归**）。**这直接改变迁移前的知情告知内容**，建议以本轨道的实测为准（命令已列入 §9 探针 5，可当场复核）。T16 的计数方法与结论不一致的原因未查（可能用了不同的抽取范围或不同的槽目录口径）。

### 10.2 分歧二：`ctx.connection.rpc.handle` 的修法是否"只去掉第 3 参"

- **T24 的结论**（`T24-workspace-enhancement-units.md:15,17,415,418`）：F-1（`settings.get` 删除）与本轨道一致 ✅；E-1 判为 `rpc.handle` "第 3 参被静默忽略 ⇒ loopback 约束静默失效"，**修法为"调用改为 `ctx.connection.rpc.handle('/dsw', dispatch)`（去掉第 3 参）"**。
- **本轨道的补充**：E-1 的**事实描述一致** ✅。但对该修法本轨道**保留意见**：
  1. 去掉第 3 参**只能消除"类型层不匹配"**，无法恢复 loopback 豁免——0.1.1 里 `trustedHosts = []`（只信 loopback）与 0.2.0 的共享 `admit()` 策略**不是同一个东西**，去掉第 3 参后通道对**非 loopback 来源**的裁决权已不在该 API 手里。若原设计意图是"这条通道只允许 loopback 页面访问"，那么正确修法是**回到精确 Fetch 路由（0.1.4 的 `/api/dsw/*` 形状）**并显式复核信任假设，而不是继续用前缀通道。
  2. 该修法**预设"注册本来就成功"**。本轮的最小复现支持这一预设（§2.3 情况 A），但插件仓库在 0.1.5-rc.2 上的 405 实测记录与预设矛盾（§8.10）。**在真机 boot 收敛前，"去掉第 3 参即可"是一个未验证的修法**；本轨道把 `/dsw` 的迁移落点定为**换用 `connection.fetch.register`**（0.1.4 已在做、且不受该悬置项影响），因为它对两种情形都是正确落点。
- **建议**：若 T24 的 U 单元进入修订执行档，请以 §8.10 的真机实验作为**前置闸门**；否则存在"按 T24 改完仍不可用、且失去 loopback 语义"的双重风险。

### 10.3 与本轨道一致的部分（无需裁决）

- `T24` 的 F-1（`ctx.settings` 由命名空间提供者变为 `SettingsForms`、`get(ns)` 彻底删除、语言面必抛、最多 9 个调用点 / 6 个文件）——**与本轨道 §2.4 / §3.2 C20 / §4.3 完全一致**，且本轨道补充了**动态复现**（`TypeError: settings?.get is not a function`，0.1.2 与 0.1.4 两版都复现）。
- `T24:272` 关于"settings 行在正常 profile 启动下必挂 ⇒ 不是优雅降级而是必然崩"的判定——与 `A020/dsh-base/cordis.patch.yml:101-103` 一致 ✅。
- `T16` 关于 4 个槽（`settings.section` / `conversation.session.header.actions` / `conversation.hero.workspace.directoryFlow` / `sidebar.workspaces.directoryFlow`）在 0.2.0 正常——与本轨道 §3.3.1 一致 ✅。

---

## 11. 变更控制声明

- 本轨道**只写** `.workspace/audit-020/reports/T17-ssh-remote-workspace-020.md` 与探针目录 `.workspace/audit-020/t17/**`。
- **未修改**：`~/.dsh/**`、`~/.dsh-017/**`、`~/.dsh/remote-workspaces/**`、任何既有插件源码、任何产品代码。
- **未发起**：真实 SSH 连接、监听端口的服务、模型请求。
- 未使用 `sandbox_permissions`；沙箱模式继承为 `workspace-write`。
