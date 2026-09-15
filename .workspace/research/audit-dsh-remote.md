# 源码级审计：`dsh-remote` 0.8.15（flymysql/dsh-remote）+ 硬依赖 `dsh-better-sidebar`

- 审计对象：npm 包 **`dsh-remote`**（GitHub `flymysql/dsh-remote`），最新 0.8.15（2026-09-12）
- 下游环境：本机 DSH `@deepseek-ai/dsh` **0.1.1-rc.2**，全部 `@deepseek-ai/dsh-*` 子包 **0.1.1-rc.2**，`@deepseek-ai/cordis` **4.0.2**
- 方法：克隆源码（`--depth 50`）+ 拉取 npm registry 全版本元数据 + 下载关键版本 tarball 做静态导入解析 + 与本机 0.1.1-rc.2 安装包逐符号比对
- 证据根目录：
  - 源码：`/home/CNS2026495165/dsh/.workspace/repos/dsh-remote`
  - tarball 展开：`/home/CNS2026495165/dsh/.workspace/research/tarballs/{dr-0.8.14,dr-0.8.15,bs-0.14.0,bs-0.15.0,bs-0.16.0,bs-0.17.1,bs-0.18.0,bs-0.18.1,bs-0.19.1}`
  - registry 原始 JSON：`/home/CNS2026495165/dsh/.workspace/research/data/dsh-remote-registry.json`、`dsh-better-sidebar-registry.json`
  - 本机 DSH：`/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`

> 所有行号均指上述路径下的真实文件；下文引用格式为 `文件:行号`。

---

## 0. 结论速览（TL;DR）

| 问题 | 结论 |
|---|---|
| 它是什么？ | **「SSH 远程运维 + 远程工作区接入」二合一**的 DSH 插件。不是远程 DSH 节点接入，也不是移动端/局域网控制台。核心是：把一台或多台 SSH 主机变成 DSH 的「远程工作区」（本地镜像 + SFTP 同步），并给 agent 20 个 `rw_*` 工具直接读写/执行远端。 |
| 硬依赖 `dsh-better-sidebar` 是否必需？ | **打包层必需、代码层可选**。`package.json:60` 是 dependencies（不是 peer），`cordis.patch.yml:33-38` 会把它作为 bundle 行注入；但 `lib/client.js` 对它的调用**全部有守卫**（`ctx.inject(['betterSidebar'])` + `ctx.get('betterSidebar')` + try/catch），删掉依赖**不需要改一行 lib/ 源码**。 |
| rc.2 上能不能直接用 0.8.15？ | **不能**。0.8.15 依赖 `dsh-better-sidebar@^0.18.1` → 解析到 0.18.1/0.19.1 → 其 host 半 `import { SessionLogOffset } from "@deepseek-ai/dsh-session"`，而本机 `dsh-session@0.1.1-rc.2` **不导出该符号**（实测：26 个导出，`SessionLogOffset` 不存在）→ 整个插件树加载失败。 |
| 最佳落地方案 | **dsh-remote 0.8.15 + 把 `dsh-better-sidebar` 锁到 0.18.0**（overrides）。0.18.0 的 host 只 import 4 个符号，rc.2 **全部存在**，且不含 `SessionLogOffset`。零源码改动。 |
| 次优 | 0.8.14（dep `^0.14.0` 自然解析到 0.14.0 → rc.2 的 `settingsNamespace` 仍在）。代价：丢失 0.8.15 的 issue #30 修复。 |
| 保底 | 0.8.15 + 关闭内嵌侧栏行（`- id: dsh-remote-sidebar / disabled: true`），保留 20 个 host 工具，放弃侧栏远程文件树。 |
| peer 约束 | 53 个版本**没有任何一个**的 peer 范围覆盖 `0.1.1-rc.2`（脚本实测：提及 `0.1.1` 的 peer 条目数 = 0）。但 DSH 用 pnpm 装插件、且 `git grep peerDependencies` 在 `@deepseek-ai/dsh/lib/` 下**零命中**（CLI 不做 peer 校验），pnpm 默认 `strict-peer-dependencies=false` → **peer 不匹配只是警告，不是失败原因**。真正的失败原因是上面的静态导入。 |
| 侵入核心程度 | **极低**。host 半边只 import 两个 `@deepseek-ai/*` 符号（`schemastery` 默认导出、`dsh-tools` 的 `defineTool`），不 patch 核心、不用私有 API、不碰 `dsh-workspace`。 |
| 许可 | MIT（`LICENSE` 存在，Copyright (c) 2026 dsh-remote contributors）；更好的侧栏也是 MIT（`Copyright (c) 2026 dsh-external`）。 |

---

## 1. 仓库与版本线

### 1.1 克隆与 HEAD

```
git clone --depth 50 https://github.com/flymysql/dsh-remote \
  /home/CNS2026495165/dsh/.workspace/repos/dsh-remote
```

- HEAD：`559e26c5eee2147e036aa78c418e288be34b7309`，**2026-09-12 19:36:52 +0800**
  - `docs(0.8.15): the embedded sidebar needs dsh >= 0.1.2-rc.1 (verified A/B) + disable-row escape hatch`
- 上一提交：`2e510991f3b101a139d718b384d0a7f99c004b94`，2026-09-12 19:15:17 —— `release(0.8.15): route failures always answer JSON (issue #30) + sidebar 0.18 (issue #29)`
- `git diff --stat v0.8.15 HEAD` → 只改了 `CHANGELOG.md` / `README.md` / `README.zh.md`（+43 行，0 删）→ **HEAD 与 v0.8.15 的代码完全一致**。

### 1.2 发布物 = 源码（已核验）

```
sha256(dr-0.8.15/lib/index.js)  = ed8804b48d506656a754be536391485971105300230da39bd5b4770213a1e877
sha256(repo/lib/index.js)       = ed8804b48d506656a754be536391485971105300230da39bd5b4770213a1e877   ✓ 相同
sha256(dr-0.8.15/lib/client.js) = ec9dbe3faf9de75f91185bac98ed16db8d8ecc0cc36503ce6e64cb353935ebab
sha256(repo/lib/client.js)      = ec9dbe3faf9de75f91185bac98ed16db8d8ecc0cc36503ce6e64cb353935ebab   ✓ 相同
```

> 注意：仓库**不分发 `src/`**，`lib/*.js` 就是源码（`package.json:32-35` `files: ["lib","cordis.patch.yml"]`）。`lib/index.js` 159 KB、`lib/client.js` 130 KB，都是未压缩的可读源码（非打包产物），`export const name = 'dsh-remote'`（`lib/index.js:50`）等 ESM 原样可见。`client.js` 是 `window.__ModuleLoader__.load({id, factory})` 形式的浏览器侧经典脚本（`lib/client.js:22-24`）。

### 1.3 LICENSE

- `/LICENSE` 存在，145 字节头：
  ```
  MIT License
  Copyright (c) 2026 dsh-remote contributors
  ```
- `package.json:5` `"license": "MIT"`，registry 元数据一致。

### 1.4 版本节奏与 tag 对应

- npm 共 **53 个版本**，`0.1.0`（2026-08-14）→ `0.8.15`（2026-09-12），**29 天**。
- git tag 共 25 个：`v0.5.10 v0.5.5 v0.6.7 v0.6.8 v0.6.9 v0.7.0 … v0.8.15`（早期 0.1.x–0.5.4 未打 tag）。
- 发布高峰：0.8.0–0.8.15 集中在 **2026-08-20 → 2026-09-12**（24 天 15 个版本）。
- 最近 12 次提交全部 ≤ 2026-09-12，**维护活跃**。

### 1.5 `dsh-better-sidebar` 对照线（npm）

- 共 **24 个版本**，`0.10.0`（2026-08-13）→ `0.19.1`（2026-09-11），latest = **0.19.1**。
- 近两周：`0.18.0`(09-03) → `0.18.1`(09-08) → `0.19.0-alpha.1`(09-09) → `0.19.0`(09-10) → `0.19.1`(09-11)。
- 许可 MIT，`Copyright (c) 2026 dsh-external`。

---

## 2. 功能面：它到底做什么

**定位（原文，`README.md:12-14`）**：
> Manage several SSH machines, then pick a **remote workspace** (or a **local** one) and let the agent operate right there without leaving the harness … keeping that remote directory mirrored into a real local workspace object.

即：**「SSH 远程运维」为手段，「远程工作区接入」为目的**。它不把远端变成 DSH 节点（不是远程 DSH agent 主机），也不是移动端/局域网控制台；`README.md:16` 明确说 DSH Web UI 故意绑 `127.0.0.1`，「这个插件反过来——**你主动连出去**」。

### 2.1 host 工具（20 个 `defineTool`，全部注册于 `lib/index.js:1483-2200`）

| # | 工具 | 行号 | 作用 |
|---|---|---|---|
| 1 | `rw_info` | 1484 | 连接/平台/工作区状态 |
| 2 | `rw_connect` | 1536 | 建连（host/user/password/privateKeyPath/port，`save=false` 则不落库） |
| 3 | `rw_pick_workspace` | 1599 | 设定远端工作区根 |
| 4 | `rw_sync` | 1633 | 远端 → 本地镜像（三方冲突感知，可 async） |
| 5 | `rw_push` | 1684 | 本地镜像 → 远端（同上） |
| 6 | `rw_list_dir` | 1733 | 列目录（size + mtime） |
| 7 | `rw_stat` | 1770 | 单路径 stat |
| 8 | `rw_read_file` | 1801 | 读文件（utf-8/gbk 编码感知） |
| 9 | `rw_write_file` | 1843 | 写文件 |
| 10 | `rw_edit` | 1869 | 字面替换 + **mtime 乐观锁** |
| 11 | `rw_append` | 1917 | 追加 |
| 12 | `rw_mkdir` | 1942 | 建目录 |
| 13 | `rw_remove` | 1961 | 删文件/递归删目录（有界） |
| 14 | `rw_move` | 1989 | 移动/重命名 |
| 15 | `rw_exec` | 2011 | 远端执行 shell 命令（`pty` / `env` / `cwd`） |
| 16 | `rw_search` | 2059 | SFTP 树遍历搜索（跨平台，含上下文行） |
| 17 | `rw_download` | 2103 | SFTP fastGet（流式 + 大小上限） |
| 18 | `rw_upload` | 2138 | SFTP fastPut |
| 19 | `rw_forward` | 2162 | 建端口转发 |
| 20 | `rw_disconnect` | 2200 | 断连 |

> 计数差异：`package.json:4` 的 description 写 "21 rw_* tools"，`README.md` 写 "20 tools"，源码实际 `grep -c "name: 'rw_[a-z_]*'"` = **20**。以源码为准（20）。

### 2.2 斜杠命令（3 个，`lib/index.js:2262/2281/2289`）

| 命令 | 行号 | 作用 |
|---|---|---|
| `/remote` | 2262 | 显示当前远端工作区 / 连接状态 / 活跃转发 |
| `/remote-forget-key` | 2281 | 丢弃当前主机 TOFU 主机密钥记录 |
| `/remote-ignore` | 2289 | 显示镜像 ignore 规则文件位置与默认模式 |

> 命令名必须匹配 `/^[a-z][a-z0-9_-]*$/u`（`check.mjs:24`）——`check.mjs` 的注释记录了一次历史事故：v0.6.1 把命令命名为 `remote.forget-key`（含点号）导致整个插件树加载失败、DSH Desktop 起不来。该闸门仍在 CI 中（`.github/workflows/ci.yml:24`）。

### 2.3 HTTP 路由（25 条，全部挂在 `host-webserver`，注册于 `lib/index.js:3266`）

```js
3266:  const disposers = routes.map((r) => webServer.register(r))
3267:  ctx.effect(() => () => disposers.forEach((d) => d && d()), 'dsh-remote.routes')
```

| 路径 | 行号 | 说明 |
|---|---|---|
| `/dsh-remote/status` | 2425 | GET 状态（支持 `sessionId` 做 per-session 判定，issue #13） |
| `/dsh-remote/resolve-mirror` | 2447 | 本地路径 → 远端路径映射 |
| `/dsh-remote/connect` | 2535 | POST 连一台机器 |
| `/dsh-remote/ls` | 2565 | 列远端目录（picker 用） |
| `/dsh-remote/read` | 2602 | 读远端文件（侧栏用） |
| `/dsh-remote/write` | 2675 | 写远端文件（mtime 乐观锁，冲突 409） |
| `/dsh-remote/fs` | 2703 | 远端文件操作（重命名/删除/新建目录） |
| `/dsh-remote/workspace` | 2778 | 设/清远端工作区 |
| `/dsh-remote/mirror` | 2798 | 建本地镜像目录 |
| `/dsh-remote/local-pick` | 2819 | 调系统原生文件夹对话框 |
| `/dsh-remote/local-list` | 2866 | 列本地目录（browse 兜底） |
| `/dsh-remote/local-mkdir` | 2888 | 本地建目录 |
| `/dsh-remote/machines` | 2911 | 机器注册表增删改（**凭据落盘**） |
| `/dsh-remote/test-connect` | 3024 | 「测试连接」 |
| `/dsh-remote/current` | 3072 | 切换当前机器 |
| `/dsh-remote/forget-key` | 3094 | 丢弃主机密钥 |
| `/dsh-remote/forwards` | 3103 | 转发增删启停 |
| `/dsh-remote/task` | 3144 | 单个后台任务进度/结果/取消 |
| `/dsh-remote/tasks` | 3171 | 任务列表 |
| `/dsh-remote/audit` | 3179 | 审计日志（最近 30 条） |
| `/dsh-remote/ssh-config` | 3188 | 解析 `~/.ssh/config` 的 Host 别名 |
| `/dsh-remote/home` | 3201 | 远端家目录 |
| `/dsh-remote/update-check` | 3216 | 版本检查 |
| `/dsh-remote/update-apply` | 3235 | 自更新 |
| `/dsh-remote/update-mode` | 3251 | 更新模式 |

### 2.4 前端注入的 UI

- **Settings → 远程工作区**整页：`lib/client.js:1975-1977`
  ```js
  slots.inject('settings.section', () =>
    slots.register({ name: 'settings.section', id: 'dsh-remote', order: 40, label: () => tr('settings.title') },
                   () => React.createElement(RemoteWorkspacePage, null)),
  )
  ```
- **两个目录选择器插槽**（填 DSH 原生 workspace picker 的洞）：`lib/client.js:1978-1981`
  ```js
  for (const slot of ['conversation.hero.workspace.directoryFlow', 'sidebar.workspaces.directoryFlow']) {
    slots.inject(slot, () => slots.register({ name: slot, id: 'dsh-remote', priority: -100 }, DirPicker))
  }
  ```
  两 tab：**本机**（走系统原生对话框）／**远程**（选机器 → 浏览/补全远端目录 → 建本地镜像 → 交回 DSH 当真实 workspace）。
- **better-sidebar 侧栏 tab（可选）**：`lib/client.js:1907-1955`
  - `SIDEBAR_EXPLORER_ID`：`🌐` 远程文件浏览器 tab（`single: true, order: 55`）
  - `SIDEBAR_FILE_ID`：远程文件查看/编辑 tab（`hidden: true, dedupeKey: tab => tab.path`，不在 `+` 菜单里，从树点开）
  - 自动打开：监听 `bs.subscribeState`，仅当该 session 的 cwd 真的落在镜像里才 `bs.openTab(...)`（`lib/client.js:1929-1952`）
- **i18n**：zh/en 双字典，经 `dsh-client-locale` 的 `locale` 服务（`lib/client.js:28-100` 附近），带 en 回退。

### 2.5 能力清单（逐项回答）

| 能力 | 有/无 | 证据 |
|---|---|---|
| 文件传输（SFTP 上传/下载） | ✅ | `lib/index.js:2103`（fastGet）、`2138`（fastPut）；`sftp()` 于 `lib/index.js:691` |
| 端口转发 | ✅ 本地 + 反向 | `lib/forwards.js:137-164`；`client.forwardOut`（137）、`client.forwardIn`（164）+ `tcpip` 事件 |
| 多服务器管理 | ✅ | 机器注册表 `lib/registry.js`；`/dsh-remote/machines`；`dsh-better-sidebar` 无关 |
| 鉴权 | ✅ 密码/私钥/`SSH_AUTH_SOCK` agent/keyboard-interactive(OTP)/跳板机；主机密钥 TOFU | `lib/index.js:440-486`、`lib/hostkey.js`、`lib/credential.js` |
| 双向同步 | ✅ 三方冲突感知 | `lib/sync.js:1-17`、`lib/ignore.js`（gitignore 语法）、`.dsh-remote-ignore` |
| SSH 远程运维（命令执行） | ✅ 但**非流式** | 见 §6 |
| 远程 DSH 节点接入 | ❌ | 无任何 DSH 协议/节点相关代码 |
| 移动端/局域网控制台 | ❌ | 反方向：本机主动出连（`README.md:16`） |
| 串口（serialport） | ❌ | `package.json:57-62` 无 `serialport`；全仓 `grep serialport` 零命中 |
| 烧录 / 交叉编译专用能力 | ❌ | 只有通用 `rw_exec`（`lib/index.js:2011-2053`），无烧录器/工具链感知 |
| 交互式 PTY 会话（像 `ssh` 那样长驻 shell） | ⚠️ 仅 `exec` 级 `pty: true` | `lib/index.js:611` `if (opts && opts.pty) execOpts.pty = true`——**没有** `client.shell()` 长驻会话 |

---

## 3. 硬依赖核实：`dsh-better-sidebar`

### 3.1 它是 dependencies，不是 peer

`package.json:57-62`：
```json
"dependencies": {
  "ssh2": "^1.16.0",
  "@deepseek-ai/schemastery": "^3.18.1",
  "dsh-better-sidebar": "^0.18.1",
  "iconv-lite": "^0.6.3"
}
```
即 **运行时会被真实安装**（不是可选的 peer）。

### 3.2 它同时被写进 bundle patch

`cordis.patch.yml:33-38`：
```yaml
- insert:
    - id: dsh-remote
      name: 'dsh-remote'
    - id: dsh-remote-sidebar
      name: 'dsh-better-sidebar'
      disabled: !!js >-
        (function () { … 扫描 patches 栈，若已有别的行挂 dsh-better-sidebar 则本行 disabled … })()
```
设计意图（文件头注释）：`dsh plugin add dsh-remote` **一条命令就把侧栏带出来**，用**专用 id** `dsh-remote-sidebar` + 顺序无关的守卫，避免双挂载 `duplicate prefix route "/sidebar/api"` 导致启动崩溃（issue #12）。

### 3.3 代码层是**可选**的——降级路径确实存在

`lib/client.js:1983-1985`（`apply()` 内）：
```js
ctx.inject(['betterSidebar'], (inner) => {
  inner.effect(() => registerSidebarIntegration(inner), 'dsh-remote.betterSidebar')
})
```

`lib/client.js:1907-1930`：
```js
// ── better-sidebar registration (guarded: plugin may be absent) ────────
function registerSidebarIntegration(ctx) {
  const bs = (ctx && ctx.get && ctx.get('betterSidebar')) || null
  if (!bs || typeof bs.registerTab !== 'function') return
  const disposers = []
  try {
    disposers.push(bs.registerTab({ id: SIDEBAR_EXPLORER_ID, … }))
    disposers.push(bs.registerTab({ id: SIDEBAR_FILE_ID, hidden: true, dedupeKey: (tab) => tab.path, … }))
  } catch (e) {
    console.warn('[dsh-remote] better-sidebar integration skipped:', e)
    disposers.forEach((d) => { try { d() } catch {} })
    return
  }
  …
  try { bs.openTab({ type: SIDEBAR_EXPLORER_ID, … }) } catch (e2) {
    console.warn('[dsh-remote] better-sidebar auto-open skipped:', e2)
  }
```

还有对 side-effect 的兜底：
- `lib/client.js:1929-1930` 与 `1950-1951` 的 `console.warn` 而非 throw；
- `const snap = bs.getSnapshot && bs.getSnapshot()`（`lib/client.js:1921`）——方法不存在也不炸；
- `CHANGELOG.md:510`（0.7.0 条目）：*"dsh-better-sidebar 未安装时优雅跳过（`ctx.get('betterSidebar')` 守卫）"*。

**结论**：
1. 它是**打包层必需**（依赖 + bundle 行），**代码层可选**（无 better-sidebar 时 host 工具、Settings 页、目录选择器照常工作，只是没有侧栏的远程文件树/编辑器）。
2. 降级路径：**有**，3 层（`ctx.inject` 服务等待 → `ctx.get` 空值返回 → `try/catch` + warn）。**不是**动态 import。
3. 无 better-sidebar 时**不需要改任何 lib/ 代码**。

### 3.4 downstream 需要的 better-sidebar API（全部符号与来源）

| API | 调用点 | 用途 | 0.14.0 有？ | 0.18.0/0.18.1 有？ |
|---|---|---|---|---|
| `ctx.get('betterSidebar')` 服务名 | `lib/client.js:1909` | 服务发现 | ✅ `ctx.provide("betterSidebar", service)` @ `bs-0.14.0/lib/client.js:9947` | ✅ @ `bs-0.18.1/lib/client.js:19256` |
| `bs.registerTab({id,title,icon,order,single,component})` | `lib/client.js:1910` | 注册侧栏 tab | ✅ `bs-0.14.0/lib/client.js:1121` | ✅ `bs-0.18.1/lib/client.js:1645` |
| `bs.registerTab({id,hidden,dedupeKey,component})` | `lib/client.js:1918` | 注册隐藏的「远程文件」tab | ✅ 同上 | ✅ 同上 |
| `bs.getSnapshot()` | `lib/client.js:1921` | 取当前 snapshot（读 sessionId） | ✅ | ✅ |
| `bs.subscribeState(fn)` | `lib/client.js:1946` | 监听状态（自动开 tab） | ✅ | ✅ |
| `bs.openTab(seed, scope)` | `lib/client.js:1937`、`lib/client.js:1655` | 打开 tab | ✅ | ✅ |
| 守卫 `typeof bs.registerTab !== 'function'` | `lib/client.js:1910` | 能力探测 | — | — |

> 服务契约在 0.18.1 未变（`CHANGELOG.md:47`：*"集成面已核对 0.18.1 未变：服务名仍是 `ctx.provide('betterSidebar')`，`registerTab` / `openTab(seed, scope)` / `getSnapshot` / `subscribeState`、`single`/`dedupeKey` 语义一致"*）——已用源码逐条复核为真。

### 3.5 从哪个版本开始引入

| 版本 | `dsh-better-sidebar` dep |
|---|---|
| 0.1.0 – 0.7.1 | **无** |
| **0.7.2**（2026-08-20）起 | `^0.14.0` |
| 0.7.2 – 0.8.14 | `^0.14.0` |
| **0.8.15**（2026-09-12） | `^0.18.1` |

引入点：git commit `d084484 feat: embed dsh-better-sidebar as a hard dependency (auto-install + auto-mount)`（2026-08-20）；对应 npm **0.7.2**。`CHANGELOG.md:459-474` 记载 *"`dsh-better-sidebar` 从可选变成硬依赖；`dsh plugin add dsh-remote` 自动带出侧边栏"*。

**存在不依赖它的历史版本**：**0.7.1 及以前（0.1.0–0.7.1，共 32 个版本）**。

---

## 4. 能否降级 / 去依赖适配 rc.2

### 4.1 关键事实：rc.2 到底缺什么、有什么（实测）

对本机 `@deepseek-ai/*@0.1.1-rc.2` 逐个 `import()` 求导出：

| 符号 | 来源包 | rc.2 是否存在 | 谁需要 |
|---|---|---|---|
| `SessionLogOffset` | `@deepseek-ai/dsh-session` | ❌ **不存在**（共 26 个导出，无此名） | `dsh-better-sidebar` **0.18.1 / 0.19.1** |
| `settingsNamespace` | `@deepseek-ai/dsh-settings` | ✅ **存在** | `dsh-better-sidebar` 0.14.0–0.17.1 |
| `SettingsConflictError` | `@deepseek-ai/dsh-settings` | ✅ 存在 | bs 0.14.0–0.19.1 |
| `defineTool` | `@deepseek-ai/dsh-tools` | ✅ 存在 | dsh-remote + bs 全版本 |
| `createUserMessage` | `@deepseek-ai/dsh-llm` | ✅ 存在 | bs 0.15.0–0.19.1 |
| `snapshotSubagentDescriptor` | `@deepseek-ai/dsh-subagent` | ✅ 存在 | bs 0.15.0–0.19.1 |
| `systemPrompt.section()` | `@deepseek-ai/dsh-system-prompt` | ✅ `lib/index.js:186` | dsh-remote |
| `webServer.register(route)` | `@deepseek-ai/dsh-host-webserver` | ✅ `lib/index.js:128` | dsh-remote |
| `slots` 服务（`inject` / `register` / `pruneStoreScope`） | `@deepseek-ai/dsh-client-runtime`（内联了 `dsh-client-ui-slots` 的 `SlotCore`） | ✅ `super(ctx,"slots")` @ `lib/client.js:35`；`inject()` @ `:55`；`register()` @ `:331` | dsh-remote client 半 |
| `locale` 服务 | `@deepseek-ai/dsh-client-locale` | ✅ `ctx.provide("locale", locale)` @ `lib/client.js:1230` | dsh-remote client 半 |
| `@deepseek-ai/dsh-client-ui-slots`（客户端模块 id） | 前端 bundle 内置虚拟模块 | ✅ 出现在 `dsh-web-frontend/dist/assets/index-ClqxG24t.js` | bs client 半 |
| `@deepseek-ai/dsh-client-ui-primitives`（客户端模块 id） | 前端 bundle 内置虚拟模块 | ✅ 同上 | bs client 半（0.14.0–0.19.1 全部 `require` 它） |
| `@deepseek-ai/dsh-client-ui-renderer` | npm 包 | ✅ 0.1.1-rc.2 已安装 | dsh-remote `dsh.client.inject` |
| `@deepseek-ai/dsh-client-locale` | npm 包 | ✅ 0.1.1-rc.2 已安装 | 同上 |

> ⚠️ 注意：`dsh-client-ui-slots` / `dsh-client-ui-primitives` 在 rc.2 的 `node_modules` 里**不存在实体目录**，但它们是**前端 bundle 注册的虚拟客户端模块**（`dsh-web-frontend/dist/assets/index-ClqxG24t.js` 里能找到这两个 id 字面量，且 rc.2 自带的 `dsh-client-ui-conversation@0.1.1-rc.2/lib/client.js:8` 就 `require("@deepseek-ai/dsh-client-ui-slots")`）。所以「本机未安装这两个包」**不是**兼容性障碍。

### 4.2 为什么不能用 0.8.15 + 0.18.1/0.19.1

`dsh-better-sidebar` host 半边静态导入（tarball 实测）：

```
bs-0.18.1/lib/index.js:11:import { SettingsConflictError } from "@deepseek-ai/dsh-settings";
bs-0.18.1/lib/index.js:13:import { defineTool } from "@deepseek-ai/dsh-tools";
bs-0.18.1/lib/index.js:14:import { createUserMessage } from "@deepseek-ai/dsh-llm";
bs-0.18.1/lib/index.js:15:import { snapshotSubagentDescriptor } from "@deepseek-ai/dsh-subagent";
bs-0.18.1/lib/index.js:16:import { SessionLogOffset } from "@deepseek-ai/dsh-session";     ← rc.2 没有
```

ESM 静态导入在 link 阶段解析 → **模块加载直接失败** → 整个插件树 abort。项目自己在 `README.md:82-87` 承认：
> **Harness requirement of the embedded sidebar (0.8.15+): `dsh ≥ 0.1.2-rc.1`.** `dsh-better-sidebar` 0.18.x imports `SessionLogOffset` from `@deepseek-ai/dsh-session`, which only exists from 0.1.2-rc.1 on. On an older harness (0.1.0-rc.x) that import fails and the loader aborts the whole plugin tree, so dsh does not start at all.

并给了实测四组对照表（`CHANGELOG.md:60-66`）：

| harness | 插件 | 结果 |
|---|---|---|
| 0.1.2-rc.1 | dsh-remote 0.8.15 + sidebar 0.18.1 | ✅ 启动，0 加载错误 |
| 0.1.0-rc.8 | dsh-remote 0.8.14 + sidebar 0.14.0 | ✅ 启动 |
| 0.1.0-rc.8 | dsh-remote 0.8.15 + sidebar 0.18.1 | ❌ **启动失败（整个插件树，dsh 起不来）** |
| 0.1.0-rc.8 | dsh-remote 0.8.15 + **关闭内嵌侧边栏行** | ✅ 启动，#30 修复照常生效 |

### 4.3 ✅ 新发现：0.18.0 不含 `SessionLogOffset` —— rc.2 的甜点版本

tarball 逐版本静态导入比对：

```
bs-0.14.0/index.js:9 : SettingsConflictError, settingsNamespace  (dsh-settings)  + defineTool
bs-0.15.0/index.js:11: SettingsConflictError, settingsNamespace  + defineTool + createUserMessage + snapshotSubagentDescriptor
bs-0.16.0/index.js:11: 同上
bs-0.17.1/index.js:11: 同上
bs-0.18.0/index.js:11: SettingsConflictError                    + defineTool + createUserMessage + snapshotSubagentDescriptor   ← 无 SessionLogOffset！
bs-0.18.1/index.js:16: 同上 + SessionLogOffset(dsh-session)      ← 从这里开始需要 dsh ≥ 0.1.2-rc.1
bs-0.19.1/index.js:16: 同上
```

**`dsh-better-sidebar@0.18.0` 是最后一个能在 rc.2 上静态加载的版本**（它已经移除了 `settingsNamespace` 依赖——那对 rc.2 无害，因为 rc.2 那儿还多导出该符号）。

0.18.0 元数据（`bs-0.18.0/package.json`）：
- `dsh.bundle.patch: ./cordis.patch.yml`，`dsh.client.inject: [dsh-client-locale, dsh-client-ui-slots, dsh-client-ui-conversation, dsh-client-modules]`（rc.2 全部可解析）
- peers 要求 `@^0.1.2-rc.1`（不满足 rc.2，但见 §4.6 —— 只是警告）
- license MIT

### 4.4 无任何版本的 peer 覆盖 `0.1.1-rc.2`

脚本遍历 53 个版本（`dsh-remote-registry.json`）：**提及 `0.1.1` 的 peer 条目 = 0**。只有 3 类 peer 组合：

| peer 组合 | 覆盖版本 | 数量 |
|---|---|---|
| `cordis@^4.0.1, commands@^0.1.0-rc.6, host-webserver@^0.1.0-rc.6` | 0.1.0 – 0.1.4 | 5 |
| `+ tools/system-prompt@^0.1.0-rc.6` | 0.2.0 – 0.3.1 | 5 |
| `+ client-runtime@^0.1.0-rc.6, client-ui-workspace@^0.1.0-rc.6` | 0.3.2 – **0.8.13** | **41** |
| `client-ui-renderer@^0.1.2-rc.1, client-locale@^0.1.2-rc.1`（换掉上面两个） | **0.8.14 – 0.8.15** | 2 |

semver 预发布规则下 `^0.1.0-rc.6`（比较元组 `0.1.0`）与 `^0.1.2-rc.1`（元组 `0.1.2`）**都不匹配** `0.1.1-rc.2`（元组 `0.1.1`）——与任务前提一致。

**「peer 约束最接近 rc.2 的版本」= 不存在真正满足者**。按「实际可解析的已安装包」看：
- **0.8.13 及以前**：peer 线是 `client-runtime` + `client-ui-workspace` → 二者在 rc.2 中**都是已安装的实体包**（0.1.1-rc.2）✅
- **0.8.14 / 0.8.15**：peer 线换成 `client-ui-renderer` + `client-locale` → 二者在 rc.2 中**同样是已安装的实体包**（0.1.1-rc.2）✅

即：**peer 版本号不匹配，但 peer 指向的包在实际环境里都存在且可用**。dsh-remote 的 client 半（`lib/client.js`）**没有 import 任何 `@deepseek-ai/*` 符号**（全文件零 `import`/`require("@deepseek-ai/…")`），它只 `require('react')` 并通过 `ctx.get('slots')` / `ctx.get('locale')` 用服务——所以 renderer 版本号差异的实际影响很小。

### 4.5 推荐方案（按优先级）

#### ✅ 方案 A（推荐，零源码改动）：0.8.15 + 锁 `dsh-better-sidebar@0.18.0`

理由：0.18.0 的 host 导入在 rc.2 **全部存在**；侧栏功能（远程文件树 + 文件编辑 tab）保留；拿到 0.8.15 的 issue #30 修复。

改动面：
```yaml
# pnpm-workspace.yaml（DSH profile 目录）
overrides:
  dsh-better-sidebar: 0.18.0
```
或 `package.json` 的 `pnpm.overrides` / `npm overrides`。**不改 lib/ 一行**。

风险（须实测）：
1. 0.18.0 的 client 半在 rc.2 的 `slots` 契约下能否正常渲染（`dsh.client.inject` 里的 `dsh-client-ui-conversation` 等要能解析）——**我未做运行时验证**，只是静态可加载。
2. 0.18.0 的 `dsh.client.inject` 未列 `dsh-client-ui-settings`（peers 里有），若其设置项注册依赖该模块 id 可能缺失（低风险）。
3. `0.18.0` 是 2026-09-03 的版本，dsh-remote 从未在其上做过 comfy 测试（它 pin 的是 0.18.1）。

#### ✅ 方案 B（最保守，项目自述已验证同族组合）：降到 **0.8.14**

- `dr-0.8.14/package.json`：`dependencies.dsh-better-sidebar = "^0.14.0"` → 自然解析 0.14.x（0.14.0 静态导入只有 `SettingsConflictError` + `settingsNamespace`，**rc.2 两者都在**）。
- `dsh.client.inject: ["@deepseek-ai/dsh-client-ui-renderer","@deepseek-ai/dsh-client-locale"]`——同 0.8.15，两包 rc.2 已装。
- client 半同样只用 `slots.inject` / `slots.register`（`dr-0.8.14/lib/client.js:1967/1971`）、`exports.inject = ['slots','locale']`（`:1981`）——与 rc.2 API 一致。
- **代价**：丢掉 issue #30 的两个修复，体感明显：
  1. `/dsh-remote/test-connect` 与 `/connect` 失败时永远只剩空 HTTP 400（`catch` 里引用 `try` 内 `const body/payload` 抛 `ReferenceError`），密码错/DNS 失败/端口不通**长得一模一样、没有原因**；
  2. Windows DPAPI 缺 `Add-Type` → 密码被静默丢弃 → 「保存了机器但每次连接必失败且无提示」。

#### ⚠️ 方案 C（保底，项目自述已在 0.1.0-rc.8 验证）：0.8.15 + 关掉内嵌侧栏行

```yaml
# profile 的 cordis.patch.yml
- id: dsh-remote-sidebar
  disabled: true
```
（`README.md:88-96` 原文给出，并注明 *"verified working on 0.1.0-rc.8 — the `rw_*` tools keep working, the sidebar UI is what you give up"*）

0.1.0-rc.8 **早于** 0.1.1-rc.2 → rc.2 只会更好；我另外静态复核了 0.8.15 host 用到的全部 `@deepseek-ai/*` 符号在 rc.2 均存在（§4.1 表）。同时**不要**再单独列一个 `dsh-better-sidebar` bundle 行。

#### ❌ 方案 D（不推荐）：直接 `dsh plugin add dsh-remote`
→ pnpm 装 `dsh-better-sidebar@0.19.1`（latest）→ 启动时 `SessionLogOffset` 缺失 → **dsh 起不来**。

### 4.6 关于 peer 不匹配会不会装不上：不会

- DSH 的插件安装走 **pnpm**（`@deepseek-ai/dsh/lib/plugin-9h8shc4d.js` 里全是 pnpm 调用与 `pnpm-workspace.yaml`）：
  `"pnpm not found on PATH — install pnpm to man…"`、`"pnpm runs with cwd = the profile directory"`。
- 在 `@deepseek-ai/dsh/lib/` 下 `grep peerDependencies` **零命中** → CLI 自己**不做 peer 校验**。
- pnpm 默认 `strict-peer-dependencies=false` → 未满足 peer 只打印 warning。
- 所以 **peer 范围不是准入闸门**；真正的闸门是 §4.2 的静态导入。

### 4.7 「去依赖」适配的具体改动面

因为代码层已经有完整守卫（§3.3），**去依赖 = 纯打包配置改动**：

| # | 文件 | 改动 | 行号 |
|---|---|---|---|
| 1 | `package.json` | 删除 `"dsh-better-sidebar": "^0.18.1"` 这一行 | `package.json:60` |
| 2 | `cordis.patch.yml` | 删除整个 `- id: dsh-remote-sidebar / name: 'dsh-better-sidebar' / disabled: !!js …` 插入块（含那段几十行的守卫表达式，它变成死代码） | `cordis.patch.yml:36-38`（起）+ 文件头 12-32 行的说明注释 |
| 3 | `package-lock.json` | 重新生成（移除 sidebar 及其 30+ 传递依赖，含 `node-pty` / `mermaid` / `@codemirror/*` / `dompurify` / `react-icons` / `ws`） | — |
| 4 | `lib/` | **零改动** | — |

- 需要自己实现侧栏容器吗？**不需要**。放弃的就是侧栏那两块 UI（远程文件树 + 远程文件编辑 tab）；host 侧 20 个 `rw_*` 工具、Settings 页、目录选择器全部照常。
- 预计工作量：**小（S）**，配置编辑 + 装包验证，<1 小时，无需写代码。
- 主要风险：
  1. **包体积/依赖树锐减的副作用**：sidebar 的 `node-pty` 是原生模块，去掉后反而少一个 native build 坑（**利好**）。
  2. 若用户**同时**装了独立的 `dsh-better-sidebar` bundle，去依赖后 dsh-remote 不再自动挂载——需要用户自己装；但守卫逻辑（`ctx.get('betterSidebar')`）依然会让集成自动生效，**不会双挂载**。
  3. 失去「一条命令装齐」的体验，且每次升级 dsh-remote 都要重打这两个 patch（建议直接用 §4.5 方案 A 的 overrides，维护成本更低）。

---

## 5. 代码结构（分层 + 触碰 DSH 核心的层）

### 5.1 `lib/` 目录树概览

```
dsh-remote/
├── package.json            (74 行)  清单：dsh.bundle.patch + dsh.client.inject
├── cordis.patch.yml                  bundle 行注入（dsh-remote + dsh-remote-sidebar）
├── check.mjs                         ★ 部署前静态闸门（命令名/注册约束，纯文本不 import）
├── sync.sh                           本地 → DSH profile 的部署脚本
├── lib/
│   ├── index.js      159,690 B  ★ HOST 主入口：apply()、SshPool、20 个 rw_* 工具、3 个命令、25 条 HTTP 路由、systemPrompt 段
│   ├── client.js     130,618 B  ★ CLIENT 主入口：window.__ModuleLoader__ 工厂、Settings 页、DirPicker、i18n、better-sidebar 集成
│   ├── paths.js        8,490 B    POSIX/Windows 路径互转、shell 引用、远端路径拼接
│   ├── binding.js      4,313 B    本地镜像 ↔ 远端绑定（$DSH_HOME/remote-workspaces 下读 .dsh-remote-meta.json）
│   ├── registry.js     4,229 B    多机器注册表（machines.json 读写/脱敏/迁移）
│   ├── credential.js   8,153 B    OS 钥匙串：macOS security / Windows DPAPI(PowerShell) / Linux secret-tool
│   ├── sshconfig.js    2,168 B    解析 ~/.ssh/config 的 Host 别名（只取路径引用）
│   ├── hostkey.js      1,918 B    TOFU 主机密钥（known_hosts.json + SHA256 指纹）
│   ├── errors.js       3,199 B    错误归类（auth / network / host key / timeout → 友好文案）
│   ├── sync.js        11,445 B    三方冲突感知镜像同步（pull / push / dryRun / 快照）
│   ├── search.js       4,351 B    SFTP 树遍历搜索（glob + 上下文行）
│   ├── ignore.js       3,861 B    gitignore 语法忽略规则 + 默认模式
│   ├── forwards.js     7,441 B    端口转发管理器（本地 forwardOut / 反向 forwardIn）
│   ├── tasks.js        2,524 B    后台长任务（single-flight 队列）
│   └── update.js       7,501 B    自更新（npm registry 版本比较 / 下载 / 应用）
├── test/               17 个文件（node --test），CHANGELOG 记 0.8.15 全绿 97/97
├── docs/               ui-settings-panel.png / ui-picker-panel.png / *.svg / blog/showcase-{zh,en}.md
└── .github/workflows/ci.yml   npm ci --legacy-peer-deps → node --check → check.mjs → npm test → boot-smoke
```

> 15 个 `lib/*.js` 全部通过 `node --check`（本地实测，2026-09-14）。

### 5.2 分层表：每层依赖的 `@deepseek-ai/*` 符号 vs 本机 rc.2

| 层 | 文件 | 依赖的 `@deepseek-ai/*` 符号 | rc.2 是否存在 | 不兼容点 |
|---|---|---|---|---|
| **host 入口/工具层** | `lib/index.js:21` | `z` ← `@deepseek-ai/schemastery`（默认导出） | ✅ 3.18.x 已安装 | 无 |
| | `lib/index.js:22` | `defineTool` ← `@deepseek-ai/dsh-tools` | ✅ 实测 `'defineTool' in exports === true` | 无 |
| | `lib/index.js:55` | 服务注入 `['tools','systemPrompt','webServer']` | ✅ `ctx.tools` / `ctx.systemPrompt`（`section()` @ `lib/index.js:186`）/ `ctx.get('webServer')` + `register()` @ `lib/index.js:128` | 无 |
| | `lib/index.js:2219` | `ctx.tools.register(t)` | ✅ | 无 |
| | `lib/index.js:2230` | `ctx.systemPrompt.section({name,order,text})` | ✅ | 无 |
| | `lib/index.js:2260` | `ctx.get('commands')` + `commands.register({name,description,handler})` | ✅ 但**非 inject，是可选读** | 无（`undefined` 时跳过） |
| | `lib/index.js:3266` | `webServer.register(route)` → 返回 disposer | ✅ | 无 |
| | `lib/index.js:2396` | `ctx.get('directoryPicker')`（**可选读，null 安全**） | ✅ | 无 |
| | `lib/index.js:1329/2458` | `ctx.get('sessions')`（可选读） | ✅ | 无 |
| | `lib/index.js` | `ctx.effect(fn, label)` ×5 | ✅ cordis 4.0.2 | 无 |
| **SSH 传输层** | `lib/index.js`（`SshPool`） | `ssh2` 的 `Client`（`lib/index.js:48 const { Client } = ssh2`） | 第三方包，与 DSH 无关 | 无 |
| **CLIENT 入口层** | `lib/client.js:22` | `window.__ModuleLoader__.load({id, factory})` | ✅ DSH 客户端模块系统（`dsh-client-modules`） | 无 |
| | `lib/client.js:29` | `require('react')` | ✅ 前端 bundle 内置 seed 模块 | 无 |
| | `lib/client.js:1975-1980` | `ctx.get('slots')` → `slots.inject(key, cb)` / `slots.register({name,id,order\|priority}, comp)` | ✅ `dsh-client-runtime@0.1.1-rc.2`：`super(ctx,"slots")` @ `:35`；`inject()` @ `:55`；`register()` @ `:331` | 无（签名一致） |
| | `lib/client.js` | `locale` 服务（i18n） | ✅ `dsh-client-locale` @ `lib/client.js:1230` | 无 |
| | `lib/client.js:1983` | `ctx.inject(['betterSidebar'], cb)` | ✅ cordis 语义；服务缺席时回调不执行 | 无 |
| | `package.json:41-44` | `dsh.client.inject: [dsh-client-ui-renderer, dsh-client-locale]` | ✅ 两包 0.1.1-rc.2 已装 | **版本号 peer 写 `^0.1.2-rc.1`**，语义上不匹配，实际包存在 |
| | `package.json:36-39` | `dsh.bundle.patch: ./cordis.patch.yml` | ✅ | 无 |
| **bundle 补丁层** | `cordis.patch.yml:33-38` | 注入 `dsh-remote` + `dsh-better-sidebar` 两行 | ✅ 机制可用 | **side bar 行在 rc.2 上会加载失败**（见 §4.2） |
| **可选侧栏层** | `lib/client.js:1907-1955` | `betterSidebar` 客户端服务的 `registerTab/openTab/getSnapshot/subscribeState` | 依赖装的 sidebar 版本 | **0.18.1+ 在 rc.2 上 host 半加载即失败** |

### 5.3 是否使用私有/内部 API？是否 patch 核心？

- **不使用私有 API**：全仓 `lib/` 里 `@deepseek-ai/*` 引用**只有两行**（`lib/index.js:21-22`）：
  ```
  lib/index.js:21:import z from '@deepseek-ai/schemastery'
  lib/index.js:22:import { defineTool } from '@deepseek-ai/dsh-tools'
  ```
  其余全部走公开服务（`ctx.tools` / `ctx.systemPrompt` / `ctx.get('webServer')` / `ctx.get('commands')` / `ctx.get('directoryPicker')` / `ctx.get('sessions')` / `ctx.get('slots')`）与可选读的 `ctx.get(...)`。
- **不 patch 核心**：`README.md` 明写 *"**No official `dsh-workspace` core is modified** — everything is delivered as a normal plugin"*；`lib/index.js:17` 注释 *"`ctx.fs` / the local workspace registry stay untouched"*。它通过**填 `directoryFlow` 插槽**（不是改 `dsh-workspace`）来实现远程工作区选择。
- **是否依赖 0.1.2-rc.1+ 才有的 slot/webserver/renderer API**：
  - `webServer.register` → rc.2 有（`lib/index.js:128`）。
  - `slots.inject` / `slots.register` → rc.2 有（`dsh-client-runtime/lib/client.js:55/331`）。
  - `settings.section` 用 `order`（不是 `priority`）→ rc.2 的类型契约明确写 *"`order` (nav position)"*（`dsh-client-ui-settings/lib/types/client/contract/slots.d.ts:58-59`），**rc.2 就是对的**。
  - `directoryFlow` 用 `priority: -100` → rc.2 的 `StoredEntry.options` 里 `order?: number` 与 `priority?: number` **并存**（`dsh-cordis-client-runner/lib/client.js:1953`），`directoryFlow` 是 `kind: "single"`，`replaceRisk: "shadows-shipped-ui"`；`priority` 对 single slot 是否生效**需运行时验证**（若失效只是「远程 tab 没顶掉原生 picker」，不会崩）。
  - `dsh-client-ui-renderer` / `dsh-client-locale` 作为 client inject 目标 → rc.2 已装，且 client 半**不直接 import 其符号**。
- **版本敏感的历史包袱**（说明作者对老 harness 的照顾）：
  - `lib/index.js` 与 `lib/client.js` 中大量 `ctx.get(...)` 而非裸属性读——`CHANGELOG.md:99-109`（0.8.13）：0.1.2-rc.1 的 cordis 代理对未声明服务属性访问**直接抛** `cannot get property "workspaces" without inject`；0.8.13 起统一走 `ctx.get`（**rc.8 前行为不变，rc.1+ 不再触发严格代理报错**）——**这条对 rc.2 是纯利好**（rc.2 < 0.1.2-rc.1，本来也不会抛）。

---

## 6. SSH 能力细节（对「远程主机 + Linux SoC 嵌入式」需求）

### 6.1 认证方式（`lib/index.js:434-488`）

```js
434:        const opts = {
435:          host: this.config.host, port: this.config.port, username: this.config.username,
440:          readyTimeout: this.config.connectTimeoutMs,      // 默认 15000
441:          keepaliveInterval: 15000,
442:          keepaliveCountMax: 3,
443:          hostVerifier: (key) => guard.verifier(key),      // TOFU 主机密钥校验
444:        }
445:        if (sock) opts.sock = sock                       // 跳板机复用通道
446:        if (this.config.useAgent) { … opts.agent = sockPath }   // SSH_AUTH_SOCK
453:        if (password) { opts.password = password; opts.tryKeyboard = true }
456:        } else if (this.config.keyboardInteractive && !this.config.privateKeyPath) { opts.tryKeyboard = true }
460:        if (this.config.privateKeyPath) {
461:          const keyPath = this.resolveKeyPath()
471:          opts.privateKey = key                               // readFileSync(keyPath)
472:          opts.passphrase = this.config.passphrase || undefined
474:        } else if (!password && !opts.agent) {
475:          throw new Error('no credentials: set a password, a privateKeyPath, or enable useAgent to connect')
```

- ✅ **密码**、✅ **私钥 + passphrase**、✅ **SSH agent**（`SSH_AUTH_SOCK`）、✅ **keyboard-interactive（OTP/MFA）**（`lib/index.js:481-485` 用配置密码回答所有 prompt）
- ✅ **跳板机**：`lib/index.js:396-403`
  ```js
  400:        const pclient = await this.proxyPool.connect()
  403:          pclient.forwardOut('127.0.0.1', 0, this.config.host, this.config.port, (e, ch) => …)
  ```
  即「先连跳板机 → `forwardOut` 拿 channel → 作为 `opts.sock` 给目标连接」的经典 ssh2 双层跳板（**不是** ssh2 的 `sock`+`proxyJump` 语法糖）。
- ✅ **主机密钥 TOFU**：`lib/hostkey.js`，模式 `accept-new`（默认）/ `verify` / `off`（`lib/index.js:81-82`），存在 `$DSH_HOME/remote-workspaces/known_hosts.json`，`/remote-forget-key` 或 `/dsh-remote/forget-key` 重置。
- ❌ 无 `algorithms` / `hostHash` / `compress` 调优字段（配置 schema `lib/index.js:57-124` 里没有）——对老 SoC 上只支持 `ssh-rsa`/`diffie-hellman-group1-sha1` 的 dropbear/老 OpenSSH 可能需要改代码（**嵌入式场景的真实风险点**，见 §7）。

### 6.2 命令执行与输出（`lib/index.js:588-690`）

```js
588:  exec(command, timeoutMsOrOpts) {
      // Windows 远端：把命令 pipe 给 Git Bash 的 `bash -s`
590:        return this._execRaw(`"${this.gitBashPath}" -s`, { … }, (stream) => { stream.end(script) })
613:            c.exec(command, execOpts, (err, stream) => {
617:                // channel open failure / 会话终止 ⇒ 认为池中连接已死，作废并**重连一次**
620:                  if (!retried && /channel open failure|open failed|…session termination|disconnect/i.test(String(err?.message||''))) {
621:                    retried = true; this.invalidate()
622:                    return this.connect().then((fresh) => runOn(fresh), …)
632:              const hardCap = Math.max(this.config.maxOutputChars * 4, 1024*1024)
640:              const timer = setTimeout(() => {
643:                try { if (typeof stream.signal === 'function') stream.signal('SIGTERM') } catch {}
647:                }, 800)                                  // 800ms 后 stream.close() 强断
651:              }, timeoutMs)
668:              stream.on('data', (d) => { if (stdout.length < hardCap) stdout += d })
671:              stream.stderr.on('data', (d) => { … })
```

**关键结论：输出是「攒完再返回」，不是流式。**

- `stream.on('data')` 只把 chunk 累加进 `stdout` 字符串（`lib/index.js:668-672`），**没有任何增量回调 / onChunk / 进度推送**；`settle()`（`lib/index.js:641-650`）在 `close` 或超时才 resolve。
- 因此 `rw_exec` 的返回（`lib/index.js:2040-2052`）是**一次性文本**：
  ```
  const res = await b.pool.exec(full, { timeoutMs: config.commandTimeoutMs, pty: !!args.pty, env: args.env })
  → parts = [stdout, '-- stderr --\n' + stderr]；超时补 '[command timed out after Nms]'；非 0 补 '[exit code: N]'
  ```
- 输出上限：`maxOutputChars` 默认 **200,000** 字符（`lib/index.js:78`），硬上限 `4×` = 800 KB（`lib/index.js:632`）。
- 超时：`commandTimeoutMs` 默认 **20,000 ms**（`lib/index.js:74`），超时先 `stream.signal('SIGTERM')`（**杀远端进程**，不是只丢 channel），800 ms 后 `stream.close()` 硬断。
- **重连/自愈**：仅针对「channel open failure / session termination / disconnect / unexpected close」类错误，**重试一次**，事后 `invalidate()` 连接池；`sftp()`（`lib/index.js:691-710`）用同一套策略。心跳 `keepaliveInterval: 15000` + `keepaliveCountMax: 3`。
- **pty**：`lib/index.js:611` `if (opts && opts.pty) execOpts.pty = true`——只影响 `exec` 通道，**没有 `client.shell()` 长驻交互 shell**（全仓 grep `shell(` 无命中）。所以「像 ssh 一样开个终端敲交互式命令」**不支持**——除非走 better-sidebar 自己的终端（那是 sidebar 的功能，不是 dsh-remote 的）。

> 对嵌入式场景的含义：`make -j` / 长时间烧录 / 交互式 `minicom` **不适合**用 `rw_exec`（会撞 20s 超时且无中间输出）。要做长任务只能 `rw_exec` 里自己 `nohup … > log &` 然后轮询读日志文件。

### 6.3 SFTP 文件管理

- 单连接池（每机器一个 `SshPool`，按 session 隔离，`CHANGELOG.md:151` 起 issue #25 的 per-session pool 修复）
- `lib/index.js:691-740`：`sftp()` promisify + 与 `exec` 相同的断线重连一次
- 上传/下载：`rw_upload` → `sftp.fastPut(local, remote)`（**0.8.10 修过参数顺序错误**，`CHANGELOG` 记 issue；`lib/index.js:2138-2160`）、`rw_download` → `fastGet`，均流式 + `maxFileBytes` 上限（默认 50 MB，`lib/index.js:80`）
- 编码：`iconv-lite` 支持 `utf-8`/`gbk` 等（`lib/index.js:29`、`config.encoding`）
- 路径抽象：`lib/paths.js` 的 `toSftpPath`（Win32-OpenSSH 的 `/D:/…` 形式）/ `toShellPath`（Git Bash 的 `/c/Users/…`）/ `toDisplayPath`（Windows 的 `C:\Users\…`）；`rw_*` 工具两种形式都接受

### 6.4 端口转发（`lib/forwards.js`）

- **本地转发**：`lib/forwards.js:137-152` `net.createServer` + `client.forwardOut('127.0.0.1', 0, targetHost, targetPort, cb)`，监听 `127.0.0.1:<listenPort>`
- **反向转发**：`lib/forwards.js:159-172` `client.forwardIn('127.0.0.1', listenPort, cb)` + `client.on('tcpip', …)`；版本不支持时返回中文错误 `'此 ssh2 版本不支持反向转发 (forwardIn)'`（`:161-163`）。要求远端 sshd `AllowTcpForwarding`
- 定义持久化在 `forwards.json`；连接建立时只自动重启 `direction === 'local' && autoStart`（反向**永不自动重启**，注释理由：会重新暴露本地端口），连接关闭时全部拆除（`lib/forwards.js:53-58`）
- 工具侧：`rw_forward`（`lib/index.js:2162-2199`，校验 `1 ≤ listenPort ≤ 65535`）+ `/dsh-remote/forwards` 面板

### 6.5 串口 / 烧录 / 交叉编译专项能力

- **串口**：❌ 无 `serialport` 依赖（`package.json:57-62` 只有 ssh2 / schemastery / dsh-better-sidebar / iconv-lite），全仓 grep 零命中。要串口只能：`rw_exec` 里跑远端 `picocom`/`minicom`/`screen` **且因无流式+PTY 长驻会话而基本不可用**，或用 §6.4 的**本地转发 + 本机串口工具**。
- **烧录**：❌ 无专用能力，只有通用 `rw_exec`（`lib/index.js:2011`）。任何 `openocd`/`esptool`/`flashrom` 都靠自己写命令。
- **交叉编译**：❌ 无工具链感知；只是一条 SSH exec。不过 `rw_sync`/`rw_push` 能把交叉编译产物（`dist/`、`build/`、`target/`——**默认 ignore 模式里包含这些**，`lib/ignore.js` 的 `DEFAULT_IGNORE`）同步过去。
- **嵌入式 SoC 相关的潜在摩擦**：
  1. 老 dropbear/老 OpenSSH 的**算法协商**（`diffie-hellman-group1-sha1`、`ssh-rsa`）在 ssh2 里有默认禁用项，而 dsh-remote **不暴露 `algorithms` 配置**（`lib/index.js:57-124` 无该字段）→ 需要改源码或改用 `~/.ssh/config`（但 `algorithms` 并不从 config 读，只读 Host/HostName/User/Port/IdentityFile 之类）。
  2. 无 SFTP 子系统的最小固件：`rw_list_dir`/`rw_read_file` 等**全部走 SFTP**（`README.md` 强调 "all file access is SFTP-protocol-level (no shell dependency)"）→ 远端 sshd 必须有 `Subsystem sftp`。若没有，只剩 `rw_exec` 可用（而 `rw_exec` 走 shell channel，还是能用的）。
  3. 交互式串口/看门狗场景需要 PTY 长驻会话——**没有**。

---

## 7. 风险清单

| 维度 | 评级 | 依据 |
|---|---|---|
| **License** | 🟢 低 | dsh-remote MIT（`LICENSE` / `package.json:5`）；dsh-better-sidebar MIT（`bs-0.18.1/LICENSE`：`Copyright (c) 2026 dsh-external`）。无 copyleft、无商业限制。 |
| **维护活跃度** | 🟢 高 | 29 天 53 个版本；最近提交 2026-09-12（HEAD）；17 个测试文件；CI（GitHub Actions）含 `node --check` + `check.mjs` 静态闸门 + `npm test` + 启动冒烟；`CHANGELOG.md` 极详尽（55 KB），逐条记 issue 复现/根因/验证。**注意**：这是 1 人主导的高频迭代项目（`author: flymysql`），0.8.x 曾有 3 次「启动崩溃」级回归（#9、#12、#26），靠 `check.mjs` 闸门兜。 |
| **侵入 DSH 核心** | 🟢 极低 | host 半只 import 2 个符号（`lib/index.js:21-22`）；不 patch 核心；不读写 `dsh-workspace`；`ctx.fs` 完全不用；`README.md` 明示。 |
| **版本耦合（结构性）** | 🔴 高 | **53 个版本无一 peer 覆盖 rc.2**；`dsh-better-sidebar` 硬依赖把 dsh-remote 的 harness 最低要求**间接**抬到 0.1.2-rc.1（0.8.15 起）。侧栏项目本身 24 个版本、11 天里出 5 个，contract 漂移快（0.14→0.18 之间 `settingsNamespace` 被移除；0.18.1 又引入 0.1.2-rc.1-only 的 `SessionLogOffset`）。 |
| **rc.2 适配风险** | 🟡 中 | 直接装 **必定失败**；但有三条可落地路径（§4.5）。**方案 A 未经运行时验证**（我把 0.18.0 的导入对 rc.2 逐符号核过，但没在 rc.2 上真跑起来——那需要改 profile 配置，超出本次只读+联网范围）。方案 B/C 是项目自己 A/B 实测过的同族组合，间接证据更硬。 |
| **安全 / 凭据** | 🟡 中 | 密码可用 OS 钥匙串（macOS Keychain / Windows DPAPI / Linux `secret-tool`），失败**回退明文**存 `machines.json`（`lib/credential.js:109-112` + 0.8.15 新增 `persistPassword`），现在会回传 `warning: 'secret-store-failed'` 告知 UI。主机密钥 TOFU 默认开（`accept-new`）。**但**：`/dsh-remote/*` 路由**无独立鉴权**，只靠 DSH Web UI 绑 `127.0.0.1`（`README.md:16`）——一旦有人把 DSH web 暴露出去，这些路由就能改机器注册表（含凭据）。 |
| **供应链** | 🟡 中 | sidebar 拉入 `node-pty`（原生编译）、`mermaid`、`dompurify`、`react-icons`、`ws`、全套 `@codemirror/*`；CI 用 `npm ci --legacy-peer-deps`（peer 不满足是常态）。 |
| **自更新能力** | 🟡 中 | `lib/update.js` + `updateMode: 'auto'` 会**自动从 npm 拉新版并覆盖自身文件**（`applyUpdate`），`CHANGELOG.md` 记 `updateMode` 默认 `manual`（安全默认），但 `auto` 一旦打开就是自更新通道。企业环境建议显式 `updateMode: 'off'`。 |
| **API 稳定性** | 🟡 中 | 项目在 0.8.13→0.8.15 连续修 rc.1/rc.2 语境下的服务访问方式（`ctx.get` vs 裸属性、`order` vs `priority`）——说明它对上游 cordis 代理/插槽契约敏感。rc.2 恰好是「严格代理之前」的版本，反而**少一类炸点**。 |
| **文档/描述准确性** | 🟢 低（小瑕疵） | `package.json:4` 写 21 个工具，实为 20；`README.md` 写 20。 | 

---

## 8. 与 `Blank-not-black` 那条线的区分（一句话）

npm 上存在**两个不同的 `dsh-remote` 生态**：本报告针对的是 **`dsh-remote`（作者 `flymysql`，GitHub `flymysql/dsh-remote`，latest 0.8.15，53 个版本，SSH 远程运维 + 远程工作区）**；另一条线是 **`dsh-remote-plugin`（GitHub `Blank-not-black/dsh-Remote`，registry 实测 latest **0.6.24**、41 个版本、repository 为 `git+https://github.com/Blank-not-black/dsh-Remote.git`）** —— **包名不同、作者不同、代码库不同**，两者互不相关，选型/审计时不可混淆。此外 GitHub 另有一个 `Blank-not-black/dsh-remote-plugin` 仓库名，同属那条线。

---

## 9. 证据索引（可复现命令）

```bash
# 1) 源码
git clone --depth 50 https://github.com/flymysql/dsh-remote \
  /home/CNS2026495165/dsh/.workspace/repos/dsh-remote
cd /home/CNS2026495165/dsh/.workspace/repos/dsh-remote
git log -3 --format='%H|%ad|%s' --date=iso
git diff --stat v0.8.15 HEAD            # 仅文档差异

# 2) 全版本 deps/peers（含 dsh-better-sidebar 引入点）
curl -s https://registry.npmjs.org/dsh-remote -o .../data/dsh-remote-registry.json
node -e '...'                            # 见 §1.4 / §4.4 表格

# 3) rc.2 缺哪个符号（决定性证据）
node -e "import('/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session/lib/index.js').then(m=>console.log('SessionLogOffset' in m, Object.keys(m).length))"
# → false 26

node -e "import('.../dsh-settings/lib/index.js').then(m=>console.log('settingsNamespace' in m))"
# → true

# 4) better-sidebar 各版本静态导入
grep -n 'from "@deepseek-ai' bs-0.18.0/lib/index.js   # 无 SessionLogOffset
grep -n 'from "@deepseek-ai' bs-0.18.1/lib/index.js   # 有 SessionLogOffset (第 16 行)

# 5) rc.2 的 slots / locale / 虚拟客户端模块
grep -n 'super(ctx, "slots")\|inject(key, callback)\|prototype.register' \
  .../dsh-client-runtime/lib/client.js
grep -o '"@deepseek-ai/dsh-client-ui-slots"' \
  .../dsh-web-frontend/dist/assets/index-ClqxG24t.js

# 6) DSH CLI 不校验 peer
grep -rn "peerDependencies" /home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/lib/   # 零命中
grep -o "pnpm[^\"']\{0,40\}" .../dsh/lib/plugin-9h8shc4d.js | sort -u
```

**复现所用全部中间产物**：
- `/home/CNS2026495165/dsh/.workspace/research/data/dsh-remote-registry.json`
- `/home/CNS2026495165/dsh/.workspace/research/data/dsh-better-sidebar-registry.json`
- `/home/CNS2026495165/dsh/.workspace/research/tarballs/*`（9 个版本 tarball + 展开目录）
- `/home/CNS2026495165/dsh/.workspace/repos/dsh-remote`（源码，HEAD `559e26c`）

### 未完成 / 未验证的事项（诚实声明）

1. **没有在 rc.2 上真跑起来**：审计为只读 + 联网，改 profile 配置 / 装包并重启 DSH 超出范围。所有 rc.2 结论都是**静态符号比对**（`import()` 求导出 + 逐行读源码），不是运行时 A/B。
2. **没有读 `dsh-better-sidebar` 的 `src/`**：npm tarball 的 `files` 列了 `src`，但展开后未见该目录，只审了 `lib/*.js`（编译后的可读源码）+ `lib/types/*.d.ts`。
3. **`directoryFlow` 的 `priority: -100` 在 rc.2 的 single-slot 语义**未运行时验证（只确认 `priority` 字段在类型里存在）。
4. `test/` 未被执行（克隆无 `node_modules`，跑测试需要装 ssh2/iconv-lite/dsh-tools 等）；只做了 `node --check`（15 个 lib 文件全过）。
