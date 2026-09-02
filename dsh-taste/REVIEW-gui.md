# dsh-taste Web GUI 独立复核报告（第 2 轮复验）

> 复核对象：`/home/CNS2026495165/dsh/dsh-taste`（bridge.js / client.js / package.json / index.js / 测试）
> 契约：`/home/CNS2026495165/dsh/pi-taste-analysis/gui-design.md` + `gui-design-audit.md`（issues 修订指令已并入契约）
> 参照源码（只读）：`/home/CNS2026495165/.dsh/profiles/web/node_modules/@deepseek-ai/`
> 结论：**PASS**（0 blocker / 0 issue）

---

## 0. 总裁决

| 项 | 结论 |
|---|---|
| 亲跑（123 测试全绿 + 语法 + inject 冒烟） | ✅ 通过 |
| bundle 格式（`__ModuleLoader__.load` 逐字） | ✅ 通过 |
| package.json（exports 三映射 / dsh.client / "."） | ✅ 通过 |
| bridge.js（rpc.handle / authority / 封闭 / 白名单） | ✅ 通过 |
| client.js（槽名 / jsx-runtime / locale / 轮询 / 空错态） | ✅ 通过 |
| 审计高危修复（ISSUE-1 present 语义） | ✅ 按修正语义实现 |
| 第 1 轮返工（sessions cwd 通道） | ✅ 根因正确、接线正确 |
| 回归 + 范围纪律 | ✅ 通过 |

**blocker 判定**：五类 blocker（契约违背 / 签名与源码不符 / 白名单破洞 / 测试不绿 / bundle 格式错误）**均未触犯**。

---

## 1. 亲跑验证

### 1.1 测试全绿
`cd /home/CNS2026495165/dsh/dsh-taste && node --test "test/*.test.js"`
→ `# tests 123 / # pass 123 / # fail 0 / # cancelled 0 / # skipped 0`
（含 bridge 新测试 `test/bridge.test.js` 与 client 冒烟 `test/client.test.js`，均绿。）

### 1.2 语法 + 冒烟
- `node --check lib/client.js` → `SYNTAX_OK`（无 JSX、纯 jsx-runtime 调用，node 可解析）。
- `import("lib/index.js")` → `INJECT=agents,commands,systemPrompt,connection`。
  **inject 含 `connection` 且四件套完整**（`test/index.test.js:169` 同步断言 `["agents","commands","systemPrompt","connection"]`）。

### 1.3 bundle 结构（`lib/client.js` 头尾逐字）
```
window.__ModuleLoader__.load({
  id: "@deepseek-ai/dsh-taste",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react_jsx_runtime = require("react/jsx-runtime");
    let react = require("react");
    let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
    ...
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
```
与设计 §3.1 逐字一致（id / factory / require seed-word 表 / `return module.exports` / 尾 `exports.apply`+`exports.inject`）。seed word 三个（react、react/jsx-runtime、ui-primitives）与审计 §4 实测 staticModules 表一致。

---

## 2. 逐项对照核验

### 2.1 package.json（§1.2 / 审计 ISSUE-2/3）
- `exports` 三映射精确：`"."→./lib/index.js`、`"./client"→./lib/client.js`、`"./package.json"→./package.json`。
  - `clientExportOf`（dsh-client-modules lib/index.js:136-146）接受字符串形式，`"./client":"./lib/client.js"` 合法。
  - 审计 ISSUE-2「删 types 键」已吸收：原设计 `{types,default}` 简化为纯字符串，`default` 语义保留，`clientExportOf` 取字符串直用，无类型文件依赖。
  - `"."→./lib/index.js` 与 `main:"lib/index.js"` 同路径，**保 host 半 main 解析**。
  - `"./package.json"` 已放行（resolveMeta `require.resolve` 不抛 `ERR_PACKAGE_PATH_NOT_EXPORTED`）。
- `dsh.client` 满足 `parseDshClient`（dsh-client-modules lib/index.js:120-134）：`platform:"web"` 为字符串、`inject` 为 3 元素字符串数组（runtime/locale/connection 包名）、无非法 `immediately`。✅
- 审计 ISSUE-3 已吸收：`peerDependencies` 增 `@deepseek-ai/dsh-client-connection`（package.json:25）。✅

### 2.2 bridge.js（§2 / 审计 ISSUE-1/4/5）
- `rpc.handle("/taste", handle, { authority: "loopback" })`（bridge.js:138）——**authority:"loopback" 逐字**；`handle = async (endpoint, payload, signal)` 三参签名与 `rpcFetchHandler` 调用点 `handler(endpoint, message.payload, request.signal)` 逐字相符。
- **endpoint 封闭**：`ENDPOINTS = new Set(["getTree","getStatus"])`，其余一律 `{ok:false,error:{code:"unknown-endpoint"}}`（bridge.js:52-53）。测试覆盖 `handler("evil")`。
- **白名单封闭**（亲跑 probe 证实）：`getTree` 唯一输入 `cwd` 仅喂 `projectDirForCwd`，一切读取经 `listTasteFiles`/`readTasteFile`→`resolveTastePath` 白名单；`resolveTastePath` 拒空/绝对/盘符/`..` 穿越并做 `startsWith(base+sep)` 越界检查。构造 `{cwd:"/etc"}`、`{cwd:"/"}`、`{cwd:"../../"}`、`{path:...}`、`{file:...}`、`{dir:...}`、`{relPath:"../../"}` 等 11 组恶意 payload，**均无内容越权**（探针判定 `PASS_NO_CONTENT_LEAK`；返回只含 `statement`/`confidence`，无原始字节/`content`/`bytes`/`raw` 字段）。
- **返回解析后 JSON 非原始字节**：`scopeFiles` 只 push `parseTasteFile` 的 `{statement,confidence}` + `mtime/count`；`getStatus` 只回 `learning/injection(modelMode 不回显 provider/model 名)/queue/breakerCooling`。
- **审计 ISSUE-1 修正语义已实现（fix b）**：`present: project !== void 0 && existsSync(project)`（bridge.js:100）+ `import { existsSync } from "node:fs"`。测试 `bridge.test.js:164` 断言 `cwd:"/nonexistent"` → `present===false`，与实现一致，不再矛盾。
- **审计 ISSUE-4 已吸收**：`getStatus` 改 `async` 并 `await loadConfig(globalDir())`（bridge.js:123），deps 由 `currentConfig` 改为 `loadConfig`，index.js 装配处传 `loadConfig`（index.js:522），首读无失真。
- **审计 ISSUE-5 保留且幂等**：`ctx.effect(() => dispose, "taste.rpc.channel")`（bridge.js:142），测试断言激活+dispose 后 route 恰好反注册一次（bridge.test.js:114-120）。

### 2.3 client.js（§3/§4）
- **槽名与注册 API 对照参照包逐字**：`ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({name:"sidebar.footer.action", id:"taste", order:90, locale:NS, inject:()=>({onToggle})}, TasteTrigger))`；`ctx.slots.inject("shell.overlay", () => ctx.slots.register({name:"shell.overlay", id:"taste-panel", order:100, locale:NS, inject:()=>({useOpen,rpc,onClose,useSessionCwd})}, TastePanel))`。两槽名与 dsh-client-ui-sidebar:307-310 / dsh-client-ui-layout:420-423 声明逐字一致。
- **React 无 JSX**：全部 `(0, react_jsx_runtime.jsx)(...)` / `jsxs(...)`，`react.useState/useEffect/useCallback/useRef/useSyncExternalStore`，无 `<div>` JSX 语法。
- **locale key 完整 zh/en**：zh 表 23 key、en 表 23 key，键集一致（`test/client.test.js:124` 断言 `Object.keys(zh)===Object.keys(en)`），覆盖 trigger/title/tab.*/empty*/error.load/loading/refresh/confidence/entryCount/status.*/close。
- **轮询与刷新语义**：`POLL_MS = 10_000`；`getTree`+`getStatus` `Promise.all` 并行；仅在 `open` 时 `setInterval`，close/unmount 清 timer（client.js:316-328）。
- **空错态渲染**：`tree===null && !error`→loading；`totalEntries===0`→empty.all；`error`→error.load+详情；`scope.present===false`→tab disabled（client.js:385-396）。

### 2.4 第 1 轮返工复验（sessions cwd 通道根因）
- **根因成立**：`sessions`（`SessionRuntime`，dsh-client-runtime lib/client.js:8850/8948 `reflect.provide("sessions", this)`）的 `list` 是裸 snapshot store（`createSnapshotStore`，8908-8916），快照形状 `{ids, byId, current, ...}`；`projectList()`（9217-9238）把 `entry.cwd` 拷入 `byId[id].cwd`（9233）。故正确取项目源 cwd 的语义是 **`byId[current].cwd`**，而非把 `current`（会话 id 字符串）当 cwd——上一轮选择器取 `state.current` 正是致 cwd 恒 undefined 的根因。
- **接线正确**：`createSessionCwdHook(sessions)` 用 `useSyncExternalStore(subscribe, getSnapshot, getSnapshot)` 绑 `sessions.list`，`getSnapshot = () => { const id = snapshot?.current; return id===void 0 ? void 0 : snapshot.byId?.[id]?.cwd }`（client.js:144-164）；`apply(ctx)` 绑 `ctx.sessions` 并把 `useSessionCwd` 经面板槽 `inject()` 下发（client.js:412/428）；`TastePanel` 取 `cwd = useSessionCwd()` 喂 `getTree({cwd})`（client.js:279/297）。
- **优雅降级**：`sessions?.list` 缺 `subscribe/getSnapshot` 或服务缺失时返回恒 `undefined` 的 hook（client.js:146-150），bridge 侧 `present:false` 禁用项目 tab，不崩。
- 测试 `client.test.js:128-186` 断言：inject 含 `useSessionCwd` 通道、取值 `/workspace/a` 正确、`current` 置空→`undefined`、缺 sessions 服务→`undefined`。全部绿。

### 2.5 回归 + 范围纪律
- **无回归**：123 测试全绿；storage/queue 未出现在 `git status` 变更列表；learner.js/config.js/commands.js 的 diff 均为**上一阶段 custom 路由工作**（`custom` modelMode 路由 / `/taste model` 命令），非 GUI 改动。GUI 侧仅新增 bridge.js/client.js/bridge.test.js/client.test.js，index.js 仅 inject 追加 `connection` + 导入 `loadCommandCodeTaste`/`registerTasteBridge` + bridge 装配调用，package.json 仅 exports/dsh.client/peer dep。
- **只读无写端点**：bridge 不暴露 `saveConfig`/`writeFileAtomicTaste`/`withTasteLock`，forget/remember 留 `/taste` 命令；getTree/getStatus 为唯一端点。
- **零官方包改动**：仅只读参照 `<web>` 各包，未改任何 `@deepseek-ai/*`。
- **未夹带设置页/推送**：仅注册 `sidebar.footer.action` + `shell.overlay` 两槽；无 `settings.section`、无 WebSocket/SSE，10s 轮询是唯一实时性手段。

---

## 3. Issues 清单

**无 issue（0 blocker / 0 issue）。**

仅一处**非阻断观察**（沿用审计 §5 已定性为「轻微提示」）：`getTree` 返回的 `dir` 字段回显绝对路径（含 home 用户名路径），但该字段是设计 §2.3 契约的一部分、`authority:"loopback"` 只放行本机同源、且为浏览器自身已可得知的信息，非越权泄露，无需修改。

---

## 4. 结论

GUI 实现是设计文档 + 审计修订指令 + 第 1 轮返工指令的忠实吸收：核心机制（B 裁定 rpc.handle/rpc.call）、发现链、槽位、bundle 格式、安全边界、审计 ISSUE-1..5 修复、sessions cwd 通道根因修复均验证成立；测试 123 全绿、无回归、范围纪律守界。**判定：通过（pass），无需返工。**
