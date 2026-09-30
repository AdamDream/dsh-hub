# WP6：`remoteHosts` 回归的落点勘察 + 可实施方案

- **工单号**：WP6（dsh-020 迁移轮 · `remoteHosts` 回归）
- **状态**：**完成**（勘察 A/B/C 全部闭合；D 两方案 + 代码草案；E 离线验证 66 项全 PASS）
- **写入边界**：仅 `.workspace/audit-020/p1/**`。**未**改动 `$A/**` 既有文件、**未**动 `~/.dsh/**` 与 `~/.dsh-017/**`。
- **未起任何 web 服务**；3080/3097/3098 全程未触碰。

## 实跑命令（全部可复跑）

```bash
cd /home/CNS2026495165/dsh/.workspace/audit-020
bash p1/verify/run-all.sh          # 语法检查 4 项 + 源码断言 27 项 + 桩调用断言 35 项 ⇒ 66 PASS / 0 FAIL / exit 0
node p1/verify/check-contract.mjs  # 单独跑 A/B/C 的源码级断言（27 项）
node p1/verify/stub-harness.mjs    # 单独跑草案插件的桩调用 harness（35 项）
```

## 证据路径

| 路径 | 内容 |
|---|---|
| [WP6-REPORT.md](WP6-REPORT.md) | 本文件 |
| `p1/verify/out/run-all.txt` | 全量验证输出（66 PASS） |
| `p1/verify/out/contract-check.txt` | A/B/C 源码断言明细 |
| `p1/verify/out/stub-harness.txt` | 草案插件接线断言明细 |
| `p1/verify/check-contract.mjs` | 断言脚本（纯读文件） |
| `p1/verify/stub-harness.mjs` | 桩调用 harness（真实 `__ModuleLoader__` 载入形态 + 最小 hook 运行时） |
| `p1/draft/dsh-remote-hosts/**` | 方案 1 插件代码草案（**未安装**） |
| `p1/draft/plan2-ssh-gui-patch.md` | 方案 2 的 diff 草案（**未应用**） |

`$A = /home/CNS2026495165/dsh/.workspace/audit-020/assembly-020`，
`$B = $A/prefix-cli-rc2/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai`

## 0. 结论速览

| # | 问题 | 结论 | 强度 |
|---|---|---|---|
| A | 旧 `remoteHosts` 的 UI 落点 | 官方 `dsh-client-ui-workspace` 声明的 **`sidebar.workspaces.remoteHosts`**（`list`/`root`），由 `@local/dsh-ssh-gui` 注册入 | `[源码]`+`[实跑]` |
| A | 在哪一版消失 | **0.1.1-rc.2 有 → 0.1.7-rc.2 已删除**（与 0.2.0 同构） | `[实跑]` |
| A | 为什么以前没报错 | `ctx.slots.inject` 对**未声明**槽「回调永不执行且不报错」 | `[源码]` |
| B | `dsh-client-ui-sidebar-right` 是否存在 | **存在**，`0.2.0-rc.2`，且已挂载未 disabled | `[实跑]` |
| B | 可用的第三方席位 | `sidebar.right.pane.tab` / `.title`（keyed/session）+ `sidebarRightTabs.register` | `[源码]` |
| C | `nodes.json` 形状 | `{ version:int, currentId:null, nodes:[] }`，55 B，`nodes` 长度 **0** | `[实跑]` |
| C | `CH_DWS` 对齐 | **不对齐**：客户端 `/dsw` vs 宿主 `/api`+`dsw/` | `[源码]` |
| C | mixed-provider 根因 | WE 的 `dsh.bundle.patch` **从未被套用**（它不在 `dsh.profile.bundles` 里）⇒ 两条 `disabled: true` 失效 ⇒ 重复注册 | `[源码]`+`[实跑]` |
| C | 是否影响 remoteHosts | 侧栏树本身**不受影响**；但远端工作区的**执行面已坏**（见 §C.5） | `[源码]`+`[实跑]` |
| D | 推荐方案 | **方案 1**（新写独立薄客户端插件），方案 2 作回退 | 裁决建议 |
| E | 离线验证 | **66 项断言全 PASS**，无需启动服务 | `[实跑]` |

---

## A. 旧面 `remoteHosts` 到底是什么

### A.1 UI 落点

| 项 | 值 | 证据 |
|---|---|---|
| 席位名 | `sidebar.workspaces.remoteHosts` | `…/dsh-client-ui-workspace/lib/types/client/contract/slots.d.ts:65` |
| 种类 / 作用域 | `kind: 'list'`、`scope: 'root'`（注释明说「list-kind, so any plugin may add its own folder section」） | 同上 `:60-67` |
| 声明方 | 官方 `@deepseek-ai/dsh-client-ui-workspace` 的 `WorkspaceBrowser` 注册（`children` 表） | 0.1.1 `lib/client.js:2435-2445` |
| 渲染点 | `wide && renderSlot("sidebar.workspaces.remoteHosts", {})` —— **仅在侧栏展开为宽栏时**渲染（窄轨不渲染） | 0.1.1 `lib/client.js:2013` |
| 注册方 | `@local/dsh-ssh-gui`，`id: "@local/dsh-ssh-gui-remote-hosts"`，`order: 10`，`label: () => "分布式节点"` | `$A/…/@local/dsh-ssh-gui/lib/client.js:1018-1024` |
| 组件 | `SidebarDistributedNodesTree`，自带 section 定高（注释直言「官方渲染点是裸 renderSlot，空槽零 UI 影响」） | 同文件 `:939-1015` |

### A.2 数据源

- 读：`rpc(CH_SSH, "nodes.list", {})` + `rpc(CH_SSH, "config.get", {})`（组件 `refresh()`，`:955-962`）。
- `CH_SSH = "/ssh-gui"`（`:63`），由 ssh-gui 宿主侧 `ctx.connection.rpc.handle('/ssh-gui', dispatch, { authority: 'loopback' })` 挂载（`lib/index.js:506`）。
- ssh 节点展开后：目录浏览 `rpc(CH_SSH,"file.list")`（`:201`）、「打开为工作区」`rpc(CH_DWS,"session.route")`（`:224`）→ `workspaces.create` + `connectWorkspace`。

### A.3 写回路径

- **侧栏树本身不写**。节点 CRUD 全部在 `settings.section` 的「分布式控制 · dsh-ssh-gui」页：
  `nodes.add`（`:609`）/ `nodes.test`（`:624`）/ `nodes.remove`（`:649`）/ `nodes.setCurrent`（`:661`）/ `keyref.set|unbind`（`:674,687`）。
- 落盘：`<DSH_HOME>/remote-workspaces/nodes.json`（`lib/index.js:104-105`；读/原子写见 `lib/core.js:808-860`；目录权限 0600）。
- ssh 类节点**写穿**底座 `machines.json`，再同步进 `nodes.json`（`lib/core.js:1217`）。
- 注意这是**两张表**：WE 的注册表是 `remote-workspaces/machines.json`（`lib/registry.js:3`），ssh-gui 的是 `nodes.json`。`$A/home/remote-workspaces/` 目录下**只有 `nodes.json`**，没有 `machines.json`。

### A.4 在哪一版消失 / 原因

| 版本根 | `dsh-client-ui-workspace` | `remoteHosts` 命中 | 结论 |
|---|---|---|---|
| `~/.dsh/profiles/node_modules/@deepseek-ai/`（0.1.1 现役） | `0.1.1-rc.2` | `client.js` **2** + `slots.d.ts` **1** | **存在且被渲染** |
| `~/.npm-global-dsh017/…`（0.1.7 现役） | `0.1.7-rc.2` | **0** | **已删除** |
| `$B/`（0.2.0-rc.2） | `0.2.0-rc.2` | **0** | 与 0.1.7 同构 |

- 0.1.7 同一版的包描述也从「Workspace picker plugin: one WorkspacePicker registered into the sidebar and empty-state workspace slots」改写，席位表换成 `directoryFlow` + `session.menu.item` + `session.row.action`（`0.1.7 slots.d.ts:108/167/187`，渲染点只剩 `:3213 renderDirectoryFlow`）。⇒ **官方在 0.1.7 删掉了这个 sidecar 席位**。
- 插件侧从未改：三份 `@local/dsh-ssh-gui/lib/client.js`（现役 0.1.1 根 / 0.1.7 根 / `$A`）**逐字节相同**（63253 B，md5 `fa6d88b5dbe952f5619936e6679cca5c`，见 harness A4）。⇒ 是**宿主环境变了**，不是插件变了。

### A.5 静默失效的机制（源码级）

```js
// $B/dsh-client-ui-renderer/lib/client.js:1356-1370  （ctx.slots.inject 的实现）
const spec = this._core.specDynamic(key);
const epoch = this._core.declarationEpoch(key);
...
if (spec === void 0) return;                     // ← 槽未声明：回调永不执行，不报错、不告警
const disposeEffect = ctx.effect(callback, `slots.inject(${JSON.stringify(key)}): declaration`);
```
对照：如果直接 `ctx.slots.register` 一个未声明槽，会 **throw**
（`$B/dsh-client-ui-slots/lib/index.js:165`：`slot "<name>" is not declared (a parent entry's children table must declare it)`）。
两条路合起来正好解释现象：**ssh-gui 的注册调用静默 return，日志里什么都没有**。

### A.6 与既往报告的一致性

既往报告已独立得出同一结论，本档做的是**新增落点**而非推翻：
- `.workspace/audit-020/reports/T16-web-client-plugin-compat.md:43,378,398,674-686`（0.1.1 目录漏收该项，靠全树 grep 发现）
- `.workspace/audit-020/reports/T17-ssh-remote-workspace-020.md:58,265,277`（判为「用户可感知的迁移回归」）
- `.workspace/audit-020/reports/MIGRATION-ASSESSMENT.md:381-384,778`
- `.workspace/audit-020/reports/T08-local-plugin-inventory.md:165`

---

## B. 新面 `dsh-client-ui-sidebar-right` 契约（源码级）

### B.1 存在性与挂载态

- 包：`$B/dsh-client-ui-sidebar-right`，`version 0.2.0-rc.2`（`package.json`）。**它存在**。
- 组合树：`$A/logs/dump020b.yaml:728-729`
  ```yaml
  - id: ui-sidebar-right
    name: '@deepseek-ai/dsh-client-ui-sidebar-right'
  ```
  **无 `disabled`** ⇒ 已挂载、已启用。`[实跑 B5]`
- host half 是空实现：`lib/index.js` 全文 `function apply() {}`（纯浏览器侧插件）。

### B.2 六个席位（`lib/types/client/contract/slots.d.ts:35-109`）

| 席位 | kind / scope | 用途 |
|---|---|---|
| `rightbar.session` | single / session | root 作用域的停靠面容器，sidebar-right 自己占用 |
| **`sidebar.right.pane.tab`** | **keyed / session** | **一个 tab 类型的正文**（`key` = 类型 `id`，可被 `sidebar.right.tab.document` 之类扩展） |
| **`sidebar.right.pane.tab.title`** | **keyed / session** | 该 tab 的 chip / 浮窗标题（可选注册） |
| `sidebar.right.tab.guide` | chain / session | 替换引导页正文 |
| `sidebar.right.tab.guide.entry` | keyed / session | 一个 provider 的引导入口卡片 |
| `sidebar.right.tab.menu.item` | list / session | tab 右键菜单追加项 |

**子席位由谁声明**：由 sidebar-right 自己在 `rightbar.session` 的注册里声明
（`lib/client.js:9150-9163`：`children: { "sidebar.right.pane.tab": { kind:"keyed", scope:"session",
inject:{hooks:{tabInfo: tabInfoFactory}} }, "sidebar.right.pane.tab.title": {…}, "sidebar.right.tab.menu.item": {…} }`）。
第三方插件**只需要 inject 那个名字再 register**，不必也不该重复声明。

### B.3 注册 API 的确切入参形状

**① tab 类型**（静态声明，无运行时钩子）：

```js
ctx.sidebarRightTabs.register({
  id,            // 必填；全部注册中唯一；重复 id ⇒ throw
  kind,          // 必填；页类型名；同 kind 只能有一个 builtin + 一个 extension
  patterns?,     // 资源类型才给（dsh-resource:// 地址的 glob）；页类型不给
  priority?,     // 'extension'（默认，产品外最高档） | 'builtin' | 'fallback'
  canOpen?,      // (address) => boolean，否决一次命中
  title,         // (address?) => string，tab chip 文字（打开时捕获）
  guide?,        // [{ id, order, title, description?, icon? }]，引导页入口胶囊
  keepMounted?,  // true ⇒ 已访问正文在切 tab / 切会话 / 收起时保留
  multiple?,     // true ⇒ 每次打开得到独立内容地址（终端用）
})
```
证据：`lib/client.js:8684-8720`（`SidebarRightTabRegistry.register`，含 `duplicate guide entry id` / `tab type id "…" is already registered` / `tab kind "…" is already registered` 三条 throw）、`README.zh.md:83`、`guideDefinition` 与 `filesDefinition` 实例（`lib/client.js:8948-8955`；`dsh-client-ui-sidebar-files/lib/client.js:22-35`）。

**② tab 正文**（keyed 席位）：

```js
ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
  name: "sidebar.right.pane.tab",
  key: <definition.id>,        // ← 必须是「类型的 id」，不是 kind
  locale,                      // 可选，命名空间
  store,                       // 可选，createXStore() 句柄
  inject: (sessionId) => ({ … }),   // 可选，注入到组件 props
  children: { … },             // 可选，声明自己的子席位
}, Body))
```
证据：`dsh-client-ui-sidebar-files/lib/client.js:996,1003-1013`；终端变体 `dsh-client-ui-sidebar-terminal/lib/client.js:475-482`；语义 `lib/types/client/contract/slots.d.ts:46-58`。

**③ 标题**：同形，`name: "sidebar.right.pane.tab.title"`，`key` 同 `definition.id`（`sidebar-files:1014-1017`）。

**④ 打开入口**：`ctx.sidebarRight.openTab(kind, options?)`、`tab.actions.openTab(kind, options)`、
或让用户在 tab 条「添加控件」里点 guide 胶囊（内部即
`tab.actions.openTab(entry.kind, { replaceTab: true })`，`README.zh.md:121`）。
`options` = `{ paneId?, preferNewPane?, revealIfOpened?, replaceTab?, params? }`（`slots.d.ts:126-135`）。

### B.4 可用 props / 生命周期

- 正文与标题通过**框架注入的 hook** 读状态：`useTabInfo()` →
  `{ sidebar: { expanded, fullscreen }, panel: { id }, tab: TabRecord & { visible, navigation, signal, actions, refreshShortcut? } }`
  （`slots.d.ts:169-202`）。`inject.hooks.tabInfo` 由父注册提供（`client.js:9154-9162`）。
- `tab.signal`：**只在记录消失或本插件卸载时 abort**，收起/切会话**不**销毁（`slots.d.ts:187-188`）。
- 生命周期：类型注册与席位注册都包在调用方自己的 `ctx.effect` 里 ⇒ **与插件同生共死**；
  返回的 disposer 幂等（`client.js:8708-8720`）。`keepMounted: true` 时正文跨切 tab/会话保留。
- 面板无标题行；展开按钮在 `conversation.session.header.corner`；布局持久化在
  `localStorage['dsh.sidebar-right.v1.<sessionId>']`（`README.zh.md:74`）。

### B.5 `dump020b.yaml` 里的相关行

```yaml
728: - id: ui-sidebar-right
729:   name: '@deepseek-ai/dsh-client-ui-sidebar-right'      # 无 disabled
```
⇒ 落点可用，**不需要**任何 profile 改动就能承载一个新的 tab 类型。

### 结论：**落点成立** —— 包的 slot 表、注册 API、挂载态三者齐全，D18 裁决可执行。

---

## C. 数据面与远程子功能现状

### C.1 `nodes.json`

| 项 | 值 |
|---|---|
| 路径 | `$A/home/remote-workspaces/nodes.json` |
| 权限 / 大小 | `0600` / 55 B |
| 顶层键 | `currentId`, `nodes`, `version` |
| `version` | `int` |
| `currentId` | `null` |
| `nodes` | **`[]`（长度 0）** |

⇒ **当前注册表为空**，所以任何"恢复侧栏树"的验收都必须以「显示空态文案」为第一断言。
本报告不输出任何主机名 / 用户名 / 密钥（表为空，也无从输出）。

### C.2 `dsh-workspace-enhancement`（0.2.2）暴露的服务

| 组合树行（`dump020b.yaml`） | 行号 | 状态 | 作用 |
|---|---|---|---|
| `ssh-remote` = `dsh-workspace-enhancement` | `:1491-1492` | enabled | aggregate：`ctx.ssh` + **mixed** `ctx.subprocess` / `ctx.fs` + `sideWorkspaces` 服务 |
| `ssh-web-channel` = `dsh-workspace-enhancement/web` | `:1503-1504` | enabled | 多连接注册表 + `/api/dsw/*` exact Fetch 路由 |
| `directory-picker-ssh` = `dsh-workspace-enhancement/picker` | `:1498-1502` | **disabled: true** | 目录 picker 后端（与 `directory-picker-browse` 重复注册，被 profile patch 主动禁用） |

### C.3 `/dsw` RPC 的真实身份

- **32 个 endpoint**，清单在 `lib/web.d.ts` 的 `CHANNEL_ENDPOINTS`
  （`connections.*` / `machines.*` / `conn.status|probe|reconnect` / `hostkey.forget` / `status` /
  `browse.home|list|mkdir` / `session.route` / `local.pickNative` / `session.ws.*` / `session.conn.*` / `core.deploy|status`）。
- wire 身份（`lib/web-channel.js`）：
  ```
  :26  export const API_CHANNEL = '/api';
  :28  export const CHANNEL_NAMESPACE = 'dsw';
  :30-32  channelEndpointOf(e) => `dsw/${e}`      // 客户端传给 rpc.call 的 endpoint
  :34-36  channelPathOf(e)     => `/api/dsw/${e}` // 宿主注册的绝对路径
  :85-128 channelRouteOf(...)  => exact Fetch route，由 connection.fetch.register 注册
  ```
- 宿主挂载循环：`lib/web.js:729-737`（逐 endpoint `ctx.connection.fetch.register(route)`）。
- 文件头注释（`web-channel.js:1-24`）与 `web.js:716-720` 明说：旧做法
  `ctx.connection.rpc.handle('/dsw', …)` 在 0.1.5 线起**不可用**（connection 服务静态 inject 退化为
  `["credentials"]`，`owner.webServer` 解析不到 ⇒ 405），所以整体搬到 `/api` 的 exact 路由。

### C.4 客户端 `CH_DWS` 对齐判定：**不对齐**

| 侧 | 值 | 证据 |
|---|---|---|
| `@local/dsh-ssh-gui` 客户端 | `const CH_DWS = "/dsw";`，**7 处**调用（`:154,224,586,628,675,688,700`） | `lib/client.js:62` |
| 浏览器侧 URL 拼法 | `` fetch(`${channel}/${endpoint}`.slice(1)) `` ⇒ `POST /dsw/<endpoint>` | `$B/dsh-client-connection/lib/client.js:1212-1218` |
| 0.2.2 宿主 | **没有人再 mount `/dsw`**（`web.js` 里 `rpc.handle` 命中 0） | `[实跑 C3]` |
| 0.1.2 宿主（现役 0.1.1 / 0.1.7 根） | `ctx.connection.rpc.handle('/dsw', dispatch, { authority:'loopback' })` | `we-build/we-0.1.2-migrated-backup/lib/web.js:504` `[实跑 C4]` |

⇒ 在 0.2.0 上这 7 处会命中 `404`，客户端抛 `` `transport failure for /dsw/<x>: HTTP 404` ``。
**修法**：`CH_DWS` → `"/api"`，endpoint → `` `dsw/${name}` ``（方案 1 草案已按此写；方案 2 diff 给出 7 处改法）。

`/ssh-gui` 通道**不受影响**：`ctx.connection.rpc.handle` 的已知坑已被 profile patch 修好
（`$A/home/profiles/web/cordis.patch.yml:626-632`：`- id: connection / inject: [webRuntime, webServer]`）。
本次**未做实机 `/ssh-gui` 往返**（见「未验证项」）。

### C.5 mixed-provider 告警的机制级根因（本轮关键问题）

**告警原文**（`$A/home/logs/dsh-host.jsonl:13`，共 19 次，每次 boot 一条）：
```
dsw: mixed provider install failed, falling back to pure-SSH providers:
  Error: service "subprocess" has been registered at <LocalSubprocessRuntime>
```

**因果链（逐环有源码行号）**：

1. WE 本意是禁用本地 provider 行，让混合 provider 独占服务名：
   `$A/home/profiles/node_modules/dsh-workspace-enhancement/lib/cordis.patch.yml:29-36`
   ```yaml
   - id: subprocess
     name: '@deepseek-ai/dsh-subprocess-local'
     disabled: true
   - id: fs-sandbox
     name: '@deepseek-ai/dsh-fs-sandbox'
     disabled: true
   ```
2. **但这份 patch 层从未被套用**。patch 栈只由 `dsh.profile.bundles` 里声明的 bundle 层构成
   （`$B/dsh-app-boot/lib/index.js:468-477`：*"the tree is composed by applying each bundle's patch
   lists in `dsh.profile.bundles` order over an empty entry list"*），而
   `$A/home/profiles/web/package.json` 的 `dsh.profile.bundles = ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"]`
   —— **`dsh-workspace-enhancement` 不在其中**。它只是被 profile patch 以
   `- insert: - { id: ssh-remote, name: dsh-workspace-enhancement }` 当成**普通插件行**插入，
   其 `package.json.dsh.bundle.patch` 因此**不参与组合**。`[实跑 C12/C14]`
3. 于是 `dsh-base` bundle 层的两行原样生效（enabled）：
   `$B/dsh-base/cordis.patch.yml:220-221`（`id: subprocess` / `dsh-subprocess-local`）与
   `:518-519`（`id: fs-sandbox` / `dsh-fs-sandbox`）。组合结果见
   `$A/logs/dump020b.yaml:305-306` 与 `:589-590`——两行都在，**都没有 `disabled`**。`[实跑 C7/C13]`
4. `dsh-subprocess-local` 那一行先 provide 了服务名 `subprocess`（fiber name = 类名 `LocalSubprocessRuntime`）。
5. 随后 WE 的 aggregate 行激活：`lib/plugin.js:123 installMixedProviders(ctx)` →
   `:75 const localSubprocess = new LocalSubprocessRuntime(ctx);`（Service 子类构造即注册）→
   **第二次 provide 同名服务** → `$B/cordis/lib/index.js:813`
   ```js
   if (this.store[key]) throw new Error(`service "${name}" has been registered at <${this.store[key].fiber.name}>`);
   ```
   ⇒ 抛出 `service "subprocess" has been registered at <LocalSubprocessRuntime>`（尖括号里是**已有**那个 provider 的 fiber 名，所以是同一个类名）。
6. 被 `lib/plugin.js:125-126` 捕获 → 打 warn，进入"纯 SSH 回退"分支。
7. **回退路径自己也失败**：`:145-146` `ctx.plugin(SshSubprocessRuntime, gate)` / `ctx.plugin(SshFileSystem)`
   同样要抢注 `subprocess` / `fs` ⇒ 运行期再抛两条 error，日志名分别是
   `"name":"ssh-subprocess-runtime"` 与 `"name":"ssh-file-system"`（后者为
   `service "fs" has been registered at <SandboxedFileSystem>`）。三个计数都是 **19**。`[实跑 C10]`

**净效果（重要，与日志措辞相反）**：
> 0.2.0 上 `ctx.subprocess` / `ctx.fs` **既不是 mixed、也不是 pure-SSH**，而是 0.1.x 就有的纯本地实现。
> 日志里的「falling back to pure-SSH providers」**没有落地**——回退分支同样被 duplicate-service 挡死。

**它是否影响 `remoteHosts`？**
- **不影响侧栏树本身**：树只需要 `/ssh-gui` 的 `nodes.list`/`config.get` 与 `/dsw` 的 `session.route`；
  ssh 节点的**文件浏览**走 ssh-gui 自己的 SFTP 面（`file.list`/`file.get`/`file.put`），同样不经过 `ctx.fs`。
- **影响它的下游**：从侧栏「打开为工作区」建立**远端会话**之后，该会话里的
  `ctx.subprocess` / `ctx.fs` 路由是坏的 ⇒ 远端命令与远端文件操作**不会**走 SSH。
- ⇒ **建议把 mixed-provider 修复与 remoteHosts 上线并列为前置闸门**：只修 UI 会得到一个"能看见节点、
  但进入远端工作区后执行面仍然坏"的半成品。修法方向明确：把 `dsh-workspace-enhancement` 加入
  `dsh.profile.bundles`（或在与它同层的 patch 里真正 disable 那两行）。

**注**：`subprocess`/`fs` 重复注册的"为什么 0.1.1 没事"——0.1.1 现役根的 patch 结构由该轮自己的
部署方式决定，本档**未**去比对该根的组合树（越界读且非 WP6 范围），故不作断言。`[未验证]`

### C.6 客户端侧远程面现状（0.2.0）

WE 客户端注册的席位（`lib/client/index.js`）：
`sidebar.workspaces.directoryFlow`（经 `conversation.hero.workspace.directoryFlow` 注入，`:75-82`）、
`settings.section`（`:83`）、`conversation.session.header.actions`（`:95`）、
`conversation.session.header.utilities`（`REMOTE_STATUS_SLOT`，`remote-status.js:41`，`index.js:111`）、
侧栏行徽章（`row-badges.js`，DOM 层）。
**没有任何右栏 tab 类型** ⇒ 右栏「分布式节点」面完全空缺，正是 WP6 要补的洞。

---

## D. 可实施方案

### 方案 1（首选）：新写薄客户端插件 `@local/dsh-remote-hosts`

**改动文件清单**（全部为**新增**，零既有文件改动）：

| 文件 | 说明 |
|---|---|
| `$A/home/profiles/node_modules/@local/dsh-remote-hosts/package.json` | 含 `dsh.client.inject = ["@deepseek-ai/dsh-client-connection","@deepseek-ai/dsh-client-ui-sidebar-right"]` |
| `…/dsh-remote-hosts/lib/index.js` | host half：空 `apply()`（缺它 include 阶段报错） |
| `…/dsh-remote-hosts/lib/client.js` | 插件本体（草案已就绪） |
| `$A/home/profiles/web/cordis.patch.yml` | **协调者独占写入**，追加一行 `- insert: - { id: remote-hosts, name: '@local/dsh-remote-hosts' }` |

**插槽注册代码骨架**（草案全文见 `p1/draft/dsh-remote-hosts/lib/client.js`，此处是骨架）：

```js
const ID = "@local/dsh-remote-hosts";   // 类型 id == pane.tab 的 key
const KIND = "remote-hosts";
const CH_SSH = "/ssh-gui";              // ssh-gui 私有通道（仍被 rpc.handle 挂载）
const CH_DWS = "/api";                  // WE 0.2.2 共享通道（**不是** /dsw）
const dws = (endpoint) => `dsw/${endpoint}`;

function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }));
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: ID, kind: KIND, priority: "extension",
    title: () => t("type.label"),
    guide: [{ id: "remote-hosts", order: 30, title: () => t("guide.title"),
              description: () => t("guide.description") }],
  }));
  ctx.effect(() => ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
    name: "sidebar.right.pane.tab", key: ID, locale: NS,
    inject: () => ({ rpc }),
  }, Body)));
  ctx.effect(() => ctx.slots.inject("sidebar.right.pane.tab.title", () => ctx.slots.register({
    name: "sidebar.right.pane.tab.title", key: ID, locale: NS,
  }, Title)));
}
```

**数据流**：
- 读：`rpc("/ssh-gui","nodes.list")` + `rpc("/ssh-gui","config.get")`（第一版只读列表）。
- 写：**无**。节点 CRUD 仍留在 `settings.section`（旧路径不变），因此本方案不引入任何新写路径。
- 后续（第二版才做）：节点展开后的目录浏览复用 `rpc("/ssh-gui","file.list")`；
  「打开为工作区」用 `rpc("/api", dws("session.route"))` + `ctx.workspaces`。

**验收标准**：
1. `bash p1/verify/run-all.sh` ⇒ 66 PASS / 0 FAIL（本档已达成，针对草案本体）。
2. 一次性实例（**只允许 3099**）上：右栏 tab 条「添加控件」出现「分布式节点」胶囊；点开显示空态文案（`nodes.json` 现为空）；标题 chip 正确。
3. 节点表非空时（由协调者/用户加一条）列表项显示 name + transport，且 DOM 里**不含**任何 password/keyRef 值（harness H33 已用桩数据证明白名单有效）。
4. 卸载该行后右栏回到原样（effect 级可回滚）。

**风险与回滚**：

| 风险 | 说明 | 回滚 |
|---|---|---|
| 声明依赖缺失 | `dsh.client.inject` 未列 `dsh-client-ui-sidebar-right` ⇒ `ctx.sidebarRightTabs` 可能未 provide（症状：类型注册抛 undefined 调用） | 已在本草案 `package.json` 里列好；再不行就 `ctx.inject(["sidebarRightTabs"], …)` 包一层 |
| 与 ssh-gui 抢 `nodes.json` | 本方案只读，无写冲突 | 移除 profile 行即可 |
| 第二版引入写路径 | 若把 CRUD 搬进右栏，会和 `settings.section` 形成双入口 | 明确"右栏只读"边界；CRUD 保留在设置页 |
| mixed-provider 未修 | 远端工作区执行面仍坏（§C.5） | 与本方案正交，需另案；建议并列前置闸门 |

### 方案 2（降级）：把树并进现有 `@local/dsh-ssh-gui`

改动 `$A/home/profiles/node_modules/@local/dsh-ssh-gui/lib/client.js`：把死掉的
`sidebar.workspaces.remoteHosts` 注册换成 `sidebarRightTabs.register` + 两个 keyed 席位，
**正文组件 `SidebarDistributedNodesTree` 一字不改**；并顺带把 `CH_DWS` 改成 `/api` + `dsw/` 前缀。
`package.json.dsh.client.inject` 需补 `@deepseek-ai/dsh-client-ui-sidebar-right`。
完整 diff、验收、风险与回滚见 **`p1/draft/plan2-ssh-gui-patch.md`**。

### 取舍

| 维度 | 方案 1 | 方案 2 |
|---|---|---|
| 既有文件改动 | **0** | ssh-gui `client.js` + `package.json` |
| 可独立回滚 | ✅ 删一个包 + 一行 | ⚠️ 需回退 ssh-gui |
| 复用既有组件 | ❌ 第一版只读列表 | ✅ 直接复用目录浏览 / 串口控制台 |
| 加载序耦合 | 低（显式声明依赖） | 中（需补 inject） |
| 与 D18 语义贴合 | 高（"用右栏停靠面重新实现"） | 中（"换个宿主挂上去"） |

**推荐方案 1**；若要求"一周内看到与 0.1.1 等价的完整树（含目录浏览/串口控制台）"，则先落方案 2、
再逐步把逻辑抽到方案 1 的独立包里。

---

## E. 不启动服务的验证手段

### E.1 语法检查（`node --check`，ESM）

```bash
cd /home/CNS2026495165/dsh/.workspace/audit-020
node --check p1/draft/dsh-remote-hosts/lib/client.js
node --check p1/draft/dsh-remote-hosts/lib/index.js
node --check p1/verify/check-contract.mjs
```
**预期输出**：三条命令均无输出、退出码 0（`--check` 成功时静默）。`[实跑，PASS]`

### E.2 源码级契约断言（`check-contract.mjs`，27 项）

```bash
node p1/verify/check-contract.mjs
```
覆盖：sidebar-right 存在/版本/席位声明/reflect.provide/挂载态（B1-B7）、
旧席位在 0.1.1 存在而在 0.1.7/0.2.0 消失（A1-A3）、三份 ssh-gui 客户端逐字节相同（A4）、
`slots.inject` 静默语义（A6）、nodes.json 形状（C1）、`/api`+`dsw` wire 身份（C2）、
新旧 `/dsw` 挂载（C3/C4）、`CH_DWS` 不对齐（C5）、
mixed-provider 四环因果（C7/C8/C9/C10/C12/C13/C14）。
**预期输出**：`27/27 checks passed`，退出码 0。`[实跑]`

### E.3 桩调用 harness（`stub-harness.mjs`，35 项）

```bash
node p1/verify/stub-harness.mjs
```
它按**真实的客户端插件载入形态**验证草案：

1. 先设 `globalThis.window = { __ModuleLoader__: { load(def){ captured = def } } }`，
   再 `await import(.../lib/client.js)` ⇒ 断言插件以 `window.__ModuleLoader__.load({id, factory})` 自注册（H1/H2）。
2. 调 `captured.factory(require)`，其中 `require("react")` 返回**最小 React 桩**
   （`createElement` / `Fragment` / 带状态的 `useState` / 会同步执行的 `useEffect` / `useMemo`）。
3. `plugin.apply(stubCtx)`，`stubCtx` 只实现本插件用到的面
   （`effect` / `get("connection")` / `locale.register|bind` / `slots.inject|register` / `sidebarRightTabs.register`），
   并把每次调用**记录**下来。
4. 断言注册形状逐项匹配官方契约：类型定义只含契约字段、`title` 是函数、`guide[0]` 四字段齐、
   `slots.inject` 两处、席位名与 `key` 分别正确、**没有任何注册落到旧席位**（H8-H21）。
5. 断言数据面通道正确：`CH_SSH="/ssh-gui"`、`CH_DWS="/api"`、`dws("conn.probe")==="dsw/conn.probe"`（H22-H26）。
6. 断言秘密字段不出界：`normalizeNodes` 白名单化、渲染树里不含桩数据里的 `SECRET-*`（H27-H33）。
7. **真渲染两次**（effect 数据回路落地后重渲染一次）验证 loading→ready 状态迁移（H31/H32）。

**预期输出**：`ALL PASS`，退出码 0。`[实跑]`

### E.4 一键入口

```bash
bash p1/verify/run-all.sh      # ⇒ 66 PASS / 0 FAIL，末行 "ALL VERIFICATIONS PASSED (no web service started)"
```

### E.5 这些手段**不能**证明什么

- 不证明真实浏览器里的渲染、布局、dockkit 交互（无 React DOM / 无 real slots 服务）。
- 不证明 `/ssh-gui` 与 `/api/dsw/*` 的**实机往返**（未起服务）。
- 不证明与其它客户端插件的加载序在真实 profile 下成立。
这三项需要 3099 上的一次性实例（须协调者/用户批准）。

---

## 结论强度汇总

| 结论 | 强度 |
|---|---|
| 旧席位名/kind/scope/渲染点/注册方/数据源/写回 | `[源码]` |
| 0.1.1 有、0.1.7 起无（三版本树对比 + 三份客户端逐字节相同） | `[实跑]` |
| `slots.inject` 对未声明槽静默 | `[源码]` |
| sidebar-right 存在、版本、席位表、注册 API、挂载态 | `[源码]`+`[实跑]` |
| `nodes.json` 形状与空表 | `[实跑]` |
| `/api`+`dsw` wire 身份、32 endpoint | `[源码]` |
| `CH_DWS=/dsw` 不对齐（0.2.2 无人 mount `/dsw`） | `[源码]`+`[实跑]` |
| mixed-provider 根因（bundle 层未套用 ⇒ 重复注册 ⇒ 连回退都失败） | `[源码]`+`[实跑]` |
| 草案插件的静态/接线正确性 | `[实跑]`（66 项断言） |
| 实机行为、`/ssh-gui` 与 `/api/dsw/*` 往返、加载序 | `[未验证]` |

---

## 未验证项

1. **实机往返**：`/ssh-gui`（`nodes.list`/`config.list` 等）与 `/api/dsw/session.route` 在 0.2.0 上是否真的 200。
   本档只做静态对齐判定；未起服务、未发任何 RPC。**需要 3099 一次性实例**（`同一条命令内起→curl→kill`）。
2. **`/dsw` 404 的实机确认**：本次由"0.2.2 无 `/dsw` 路由 + 客户端拼 `/dsw/...`"推出 404，未实测 HTTP 状态码。
3. **mixed-provider 修复后的行为**：把 WE 加入 `dsh.profile.bundles`（或等效 disable）之后，混合 provider 是否真的
   安装成功、远端 cwd 路由是否生效——**未验证**（需改组合树 + 起实例）。
4. **加载序**：草案 `dsh.client.inject` 是否足以保证 `sidebarRightTabs` 先 provide——未在真实客户端运行时验证。
5. **0.1.1 现役根为什么没有同样撞车**：本档未比对该根的组合树/patch 结构（越界），故不对"为何 0.1.1 正常"作断言。
6. **`keepMounted` / `multiple` / `store` / `children` 语义**：只读契约未实测。
7. **`SidebarDistributedNodesTree` 与 `useTabInfo` 的适配**（方案 2）未跑通；方案 2 的 diff 只是草案。

## 需要用户裁决的点

1. **方案取舍**：采用方案 1（新包，零既有文件改动，第一版只读）还是方案 2（改 ssh-gui，
   保留目录浏览/串口控制台，但耦合上升）？本档推荐 **方案 1 起步 + 方案 2 的组件移植作为第二版**。
2. **mixed-provider 是否并列前置**：是否同意「remoteHosts UI 上线」与「mixed provider 修复」
   作为同一闸门，避免交付"能看见节点但远端执行面仍坏"的半成品？
   （修法需改 `$A/home/profiles/web/package.json` 的 `dsh.profile.bundles`——**属协调者写入范围**。）
3. **`CH_DWS` 修法范围**：是否授权一并修 ssh-gui 的 7 处 `/dsw` 调用（不修则节点树能显示、
   但「打开为工作区」的 `session.route` 仍 404）？
4. **`nodes.json` 为空表**：验收时是只验空态，还是要求协调者先注入一条测试节点（不含真实密钥）？
5. **可否起 3099 一次性实例**做 E.5 列的实机验证（严格"同命令内起→验→kill"，绝不触碰 3080/3097/3098）。

## 我没有做的事

- **没有**启动/重启/停止任何 web 服务（3080 / 3097 / **3098** 全程未触碰），未监听任何端口。
- **没有**修改 `~/.dsh/**`、`~/.dsh-017/**`、`$A/**` 的任何既有文件；全部产出只落在 `.workspace/audit-020/p1/**`。
- **没有**把草案包安装进任何 profile，**没有**改 profile 的 `cordis.patch.yml` / `package.json`。
- **没有**输出任何主机名 / 用户名 / 密钥明文（`nodes.json` 为空表，仅报字段名与计数）。
- **没有**改 `reports/` 下他人已写的文件；**没有**重开 D1–D25 的任何裁决。
- **没有**对 `remoteHosts` 的旧上游实现做任何"照记忆推断"——A 节每条结论都带版本树与行号。
