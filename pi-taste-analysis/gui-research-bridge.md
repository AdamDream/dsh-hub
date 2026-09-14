# 任务 B · 宿主↔浏览器通信与数据通道（dsh-taste Web GUI 桥接调研）

> 结论先行（TL;DR，细节见各节）：本部署的 host↔browser 通道是 **cordis 服务注入 + HTTP POST 上行 / WebSocket 下行** 的双向 RPC，不存在「浏览器直接调 cordis ctx」的魔法。给 dsh-taste（一个 **静态自装插件**，经 `cordis.patch.yml` 挂载）加只读 client 接口的最小改动是：
>
> 1. **host 半**：`inject: ["connection"]`，在 `apply()` 里 `ctx.connection.rpc.handle("/taste", handler, { authority: "loopback" })` —— `handler(endpoint, payload, signal)` 只读白名单 taste 目录（`listTasteFiles` + `parseTasteFile` + `loadTasteSnapshot`），返回 `{ ok: true, value }`。
> 2. **client 半**：package.json 增加 `exports["./client"]` + `dsh.client` 声明，新增 `lib/client.js`（`window.__ModuleLoader__.load(...)`），`inject: ["connection"]`，`const { rpc } = ctx.get("connection")`，`await rpc.call("/taste", "getSnapshot", payload)`。
> 3. **实时性**：自定义 host 事件无法进浏览器（转发白名单 `API_REMOTE_FORWARDED_EVENTS` 是编译在 `dsh-api-remotes` 里的闭集），taste 队列/学习状态用 **轮询** `rpc.call("/taste","getStatus")` 实现。
>
> 改动量：host 半约 30–50 行（新增一个 `lib/bridge.js` + `index.js` 两处注入），client 半新增一个文件约 80–120 行，package.json 3 处。**无需改动任何官方核心包**。

---

## 1. 通信原语：client 半调用 host 半的机制

**结论：不是 `ctx.call`，是「cordis 服务注入 + HTTP 上行 JSON-RPC」。** 上行请求走 HTTP POST + JSON 信封（`{ type:"client-request", rpcId, method, payload }`），由 host 侧 `connection` 服务把「频道名 + endpoint」映射到 handler。下行推送走 WebSocket（见 §2）。

### 1.1 标准数据获取模式（client-ui 插件实证）

`dsh-client-ui-settings-plugins/lib/client.js`（读插件清单/凭据）是最干净的例子：

```js
// client.js:1216-1223 —— 插件声明依赖的服务（cordis fiber inject）
const inject = ["slots", "locale", "connection", "remote", "settingsScope"];
// client.js:1228-1229 —— apply 里取 connection 服务，解构出 api
function apply(ctx) {
    const { api } = ctx.get("connection");
    ...
    // client.js:1057 —— 拉 host 数据（凭据描述）
    response = await this.api.credentials.describe({ refs: [ref] });
    // client.js:1101 —— 写 host 数据
    await this.api.credentials.set({ ... });
```

`dsh-client-ui-settings-models/lib/client.js`（读模型配置）同样走 `ctx.get("connection").api.settings.describe(...)` / `api.llm.providers(...)` 等。**模式归纳：`inject: ["connection", ...]` → `ctx.get("connection")` → `{ api, rpc, hostDescription, isLoopback, start() }` → `api.<namespace>.<method>(payload)`。**

### 1.2 `connection` 服务的真实 API 签名（client 侧）

`dsh-client-connection/lib/client.js:10262-10316` `apply()`：

```js
const api = fixtureClient ?? transport?.createApiClient() ?? new WebApiClient();
const rpc = fixtureClient?.rpc ?? createWebConnectionRpc(transport?.fetch);
const handle = { api, isLoopback, hostDescription, rpc, start(sinks, config) {...} };
ctx.provide("connection", handle);           // client.js:10315
```

即 `ctx.get("connection")` 返回：

| 成员 | 类型 / 签名 | 用途 |
|---|---|---|
| `api` | 类型化 API Proxy 客户端 | `api.host.describe / api.llm.models / api.settings.describe / api.credentials.* / api.workspace.* / api.sessions.* / api.events.mux|host / api.respond` |
| `rpc` | `{ call(channel, endpoint, payload, signal?) }` | **泛化频道 RPC**（第三方插件可用的通用入口） |
| `hostDescription` | `{ getSnapshot, subscribe }` | 连接建立后的 host 能力描述快照 |
| `isLoopback` | `boolean` | 页面是否 loopback 源 |
| `start(sinks, config)` | 启动双流循环 | 由运行时调用，插件一般不用 |

**两个关键调用函数（`dsh-client-connection/lib/client.js`）：**

- 类型化 apiProxy 上行：`callUnary(method, payload)` → `POST /api/<method>`（client.js:6203-6227），信封 `{ type:"client-request", rpcId, method, payload }`（client.js:6204-6209）。
- **泛化频道上行：`createWebConnectionRpc`**（client.js:10206-10228）：

```js
return { async call(channel, endpoint, payload, signal) {
    const message = { type: "client-request", rpcId: RpcId(randomUuid()), method: endpoint, payload };
    const response = await send(new URL(`${channel}/${endpoint}`, resolveBase()), {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(message), ...(signal===void 0 ? {} : {signal}) });
    ...
    return full.result;              // { ok:true, value } | { ok:false, error }
} };
```

注意：`api.<ns>.<method>` 是编译进 `dsh-host-apiproxy` 的**闭集**（client.js:10023-10058 那个 `switch` 就是全表），第三方插件**不能**往 `api` 上挂新 namespace；但它能拿到 `rpc.call(channel, endpoint, payload)` 这个**开放**入口——这正是 dsh-taste 该用的。

### 1.3 host 侧对应物

`dsh-client-connection/lib/index.js` 的 `HostConnectionService`（`extends Service`，`super(ctx, "connection")`，index.js:206-217）暴露：

```js
get rpc() {                                    // index.js:219-225
    const owner = this.ctx;
    return {
        handle: (channel, handler, options) => this.register(owner, channel, handler, options),
        intercept: (channel, matches, handler, options) => this.registerInterceptor(owner, channel, matches, handler, options)
    };
}
```

即 **host 插件 `ctx.connection.rpc.handle(channel, handler, options)`** 注册一个上行频道，`register()`（index.js:241-258）把 `{kind:"prefix", path:channel, handler}` 挂到 `owner.webServer.register(route)`，并在 handler 里先过 `isTrustedApiRequest` 信任栅栏。handler 的规范化签名见 `rpcFetchHandler`（index.js:275-301）：

```js
const result = await handler(endpoint, message.payload, request.signal);
return fullResponse(message.rpcId, result);   // result 必须是 {ok:true,value}|{ok:false,error}
```

频道名约束：`CHANNEL_PATTERN = /^\/[A-Za-z0-9._~-]+$/`，`/api` 保留（index.js:203, 330-332）；endpoint 段 `ENDPOINT_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/`（index.js:204, 310-315）。

---

## 2. 数据推送：host 事件如何到浏览器

**结论：下行是 WebSocket 帧流，不是轮询；但「可订阅的事件名」是编译期白名单闭集，第三方插件无法新增自定义事件 → taste 实时性只能靠轮询。**

### 2.1 下行载体

`dsh-client-connection/lib/index.js:16-18` 定义两条 WebSocket 路径：

```js
const MUX_EVENTS_PATH = `${API_PATH}/events.mux`;   // "/api/events.mux"
const HOST_EVENTS_PATH = `${API_PATH}/events.host`; // "/api/events.host"
```

host 侧 `WebSocketDownlinks`（index.js:374-451）把 `apiProxy.events.mux(...)` / `apiProxy.events.host(...)` 的帧泵到 socket；`apply()` 里 `registerDownlink(...)`（index.js:563-585）把两条升级路由挂到 `webServer.registerUpgrade(...)`。client 侧 `WebApiClient.openMux/openHost`（client.js:10124-10129）用浏览器 `WebSocket` 读帧（`server-request` 信封：`{type:"server-request", rpcId, method, payload}`，见 index.js:336-343、client.js:5169-5175）。

### 2.2 订阅 API：`ctx.remote.$on`（白名单闭集）

client 插件订阅 host 事件用 `ctx.remote.$on(eventName, handler)`。实证 `dsh-cordis-client-runner/lib/client.js:4185-4201`：

```js
ctx.remote.$on("cordis/request-run", (request) => orchestrator.open(request));
ctx.remote.$on("cordis/inspect-query", (request) => inspect.query(request).catch(...));
```

host 侧事件名与白名单在 `dsh-api-remotes/lib/types/remote-events.js:16-28`：

```js
export const API_REMOTE_FORWARDED_EVENTS = [
    'agent-preset/selected', 'commands/change', 'credentials/reference-updated',
    'cordis/request-run', 'cordis/request-run-resolved', 'cordis/dynamic-package',
    'cordis/dynamic-retract', 'cordis/inspect-query', 'cordis/inspect-query-resolved',
    'llm/adapters-updated', 'settings/document-updated'
];
```

注释（remote-events.js:3-15、index.js:3-15）说得明白：**「wire 名 = host cordis 事件名，payload = 参数表；转发一个新事件 = 在此数组加一行，仅此而已」**——但这个数组**编译在 `dsh-api-remotes` 里**，dsh-taste 是第三方包，加 `taste/queue-changed` 必须改官方包（违反「本部署无源码 checkout、以已安装包为准」的约束，也不应改）。

### 2.3 对 taste 的结论

- `agent/turn-stopping` → `queue.push` → `runLearner` 完成/失败，目前**没有任何 `ctx.emit` 广播**（`dsh-taste/lib/index.js:473-499` 的 hook、`queue.js` 的 `stats()` 都不发事件）。
- 即使补 `ctx.emit("taste/queue-changed", ...)`，浏览器也收不到（不在白名单）。
- **可行实时方案 = 轮询**：client 定时 `rpc.call("/taste","getStatus")` 拉 `queue.stats()`（`{pending, failCount, cooldownUntil, running}`，`dsh-taste/lib/queue.js:144-146`），配合 `connection/reset`（`dsh-cordis-client-runner/client.js:1528-1532` 记载该事件名）在重连后强制重拉。偏好树本身靠 mtime 缓存（`index.js:250-262`）已很廉价，轮询成本可忽略。

---

## 3. host 侧服务暴露：声明可供 client 调用的接口

**结论：三种暴露方式，dsh-taste 用第一种即可。**

### 3.1 方式 A — `ctx.connection.rpc.handle(channel, handler, {authority})`（推荐）

证据见 §1.3。这是为「泛化连接 RPC 频道」准备的开放注册点（`dsh-client-connection` 注释 index.js:201-204「Host registry and HTTP adapter for generic Connection RPC channels」）。签名：

```js
ctx.connection.rpc.handle(
    "/taste",                                        // channel，^\/[A-Za-z0-9._~-]+$
    async (endpoint, payload, signal) => ({ ok: true, value: ... }), // endpoint="getSnapshot" 等
    { authority: "loopback" }                        // 非 loopback 请求 403（见 §5）
)
```

### 3.2 方式 B — `ctx.provide(name, value)`（进程内服务，非浏览器可见）

cordis 标准服务注入（`dsh-cordis-host-runner` 沙箱白名单里就有 `provide`，index.js:550-561 的 `CTX_VERBS`）。但 `provide` 只对 **host 进程内** 其他插件可见，浏览器**不能**直接消费它；要让它被浏览器消费，仍需包一层 RPC 频道。dsh-taste 现有 `inject = ["agents","commands","systemPrompt"]` 是**普通 cordis ctx**（`dsh-taste/lib/index.js:45-46`），没有 `ctx.services` 这种东西。

### 3.3 方式 C — `harness.handle(method, fn)`（仅动态双半包，taste 不适用）

`dsh-cordis-host-runner/lib/index.js` 沙箱里的 `harness.handle`（index.js:525-533，签名 `harness.handle(method, handler)`）→ client `host.call(method, args)` → `ctx.remote.dynamicCordisRunner.invoke(pluginId, pluginRunId, method, args)`（`dsh-cordis-client-runner/client.js:4116-4124`）。**这是「模型动态挂载的双半包」专用**（靠 `pluginId/pluginRunId` 路由、走 node:vm 沙箱），dsh-taste 是静态自装插件，没有 pluginRunId 沙箱，不应走这条路。

### 3.4 对 dsh-taste 的最小改动方案

dsh-taste 是静态插件，`apply(ctx, config)` 里 `ctx` 就是普通 cordis 上下文。新增：

```js
// lib/index.js
import { registerTasteBridge } from "./bridge.js";
const inject = ["agents", "commands", "systemPrompt", "connection"];  // +"connection"
// apply() 内：
registerTasteBridge(ctx, {
    globalDir: () => globalDir,
    projectDir: (cwd) => projectDirForCwd(cwd),
    loadTasteSnapshot, listTasteFiles, parseTasteFile, readTasteFile, normalizePreferenceKey,
    queue, currentConfig,
});
```

`lib/bridge.js` 里 `ctx.connection.rpc.handle("/taste", handler, { authority: "loopback" })`，handler 按 `endpoint` 分发 `getSnapshot / getTree / getStatus`。**安全关键**：只读，且只允许调用 storage 层已有的白名单函数（`resolveTastePath` 强制 `taste.md` 或 `{category}/taste.md`，见 §5），**绝不向浏览器暴露任意路径读**。

---

## 4. 鉴权与会话边界

**结论：没有真正的用户鉴权层；边界 =「loopback + 同源」信任栅栏。taste 只读、loopback-only，无需自建 HTTP/WS 端点，无需绑定 session。**

### 4.1 路由注册（`dsh-host-webserver`）

`dsh-host-webserver/lib/index.js` 的 `WebServer extends Service`（`super(ctx,"webServer")`）提供：

- `register(route)`（index.js:128-135）：`{kind:"exact"|"prefix", path, handler}`，重复 `(kind,path)` 抛错。
- `registerUpgrade(route)`（index.js:142-148）：`{path, handler}` WebSocket 升级。
- `registerFallback(handler)`（index.js:157-163）：SPA dist 兜底。
- `tapIndex` / `collectIndexInjections`（index.js:171-177, 297-301）：index.html 注入。

**dsh-taste 无需自建端点**：`ctx.connection.rpc.handle` 内部已把频道包装成 `webServer.register` 的 prefix 路由（§1.3），并叠加信任栅栏与 JSON 信封校验。

### 4.2 信任栅栏（`isTrustedApiRequest`）

`dsh-client-connection/lib/index.js:184-198`：

```js
function isTrustedApiRequest(request, trustedHosts) {
    const host = header(request.headers, "host"); if (host === void 0) return false;
    const hostUrl = parseAuthority(host); if (hostUrl === void 0) return false;
    if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false;
    if (header(request.headers, "sec-fetch-site") === "cross-site") return false;
    const origin = header(request.headers, "origin"); if (origin === void 0) return true;
    try { return new URL(origin).host === hostUrl.host; } catch { return false; }
}
```

即：**Host 头必须是 loopback 或 `trustedHosts` 白名单**，`sec-fetch-site` 不得 cross-site，`Origin` 必须同源。这是 DNS-rebinding + 跨站请求双重防「混淆代理」，注释明确（index.js:106-120）「**binding policy 属于 webserver config，此栅栏不是鉴权层**」。

### 4.3 会话边界

- 上行 RPC **默认无会话上下文**（`client-request` 信封只有 `rpcId/method/payload`）。
- 只有 `dsh-cordis-host-runner` 的 Typert 远程方法用 `scope.context:"agent", wire:"agentId"` 做 session 绑定（`typert.host.js:214-230` 等处 `scope: { context:'agent', wire:'agentId' }`），并有 subagent 归属栅栏（`dsh-api-remotes/lib/index.js:55-73` `hasApiRemoteSubagentOwner`）。
- **taste 数据天然无 session 维度**：偏好按「全局目录 + 项目 cwd 目录」分源（`dsh-taste/lib/index.js:335-336, 427`），不是按 session。所以只读接口只需按 `payload.projectDir`（或由 client 传当前会话 cwd）选源，无需 agentId 绑定。

---

## 5. 安全边界：client→host 调用的权限模型

**结论：权限模型 = 「loopback 同源栅栏 + `PRIVILEGED_METHODS` 特权方法白名单 + `authority` 选项」。taste 偏好文本（已脱敏）走 loopback-only 只读通道，无额外要求。**

### 5.1 现有权限模型（`dsh-client-connection/lib/index.js:484-520`）

```js
/** Methods gated to loopback even on a trusted-host deployment... */
const PRIVILEGED_METHODS = new Set([
    "agentPreset.read", "agentPreset.copy", "agentPreset.openDocument", "agentPreset.remove",
    "host.pickDirectory", "host.openPath",
    "settings.describe", "settings.openDocument", "settings.update", "settings.replace", "settings.mutate",
    "credentials.describe", "credentials.set", "credentials.unset",
    "llm.discoverModels"
]);
```

`apply()` 的 `/api` 兜底 handler（index.js:535-548）在分发前：`PRIVILEGED_METHODS.has(method) && !isTrustedApiRequest(request, [])` → 403（**特权方法即使 `trustedHosts` 部署也钉死在 loopback**）。模型目录 `llm.providers/llm.models` 刻意**不在**特权集（注释 index.js:500-503：不含端点/密钥，LAN 客户端选模型需要它）。

### 5.2 泛化频道的权限选项

`register()`（index.js:241-258）：`options.authority === "loopback"` → `trustedHosts = []`，即频道只认 loopback。**dsh-taste 应传 `{ authority: "loopback" }`**，与「偏好文本是本地私密数据」的定位一致，且不会在 LAN 部署上泄露。

### 5.3 taste 数据的额外要求

- 偏好文本在写入前已 `redactSensitive` 脱敏（`dsh-taste/lib/storage.js:252-257`，剥 `sk-/ghp_/github_pat_/xox*/Bearer/api_key/...`），但仍是**用户私密偏好**，应视为读特权数据 → loopback-only 只读即可，无需更强机制。
- **文件系统安全**：浏览器能传的只有 `endpoint` + `payload`。handler 内部**必须**只用 `resolveTastePath`/`listTasteFiles` 白名单（`storage.js:151-182` 只放行 `taste.md` 或 `{category}/taste.md`，拒绝绝对路径/`..`/越界），**绝不能**把 `payload` 里的路径拼给 `node:fs` 直接读。本方案返回的是**解析后的 JSON 偏好树**（statement+confidence），而非原始文件字节，天然隔离了文件系统。
- 学习状态 `queue.stats()` 无敏感信息；config 里的 `observer` 字段（model/provider 名）可在 getStatus 里省略或只回显 `modelMode`（同 `/taste model` 命令，`commands.js:203-212`）。

---

## 6. 最小桥接方案（推荐实现骨架 + 改动量评估）

### 6.1 host 半改动

**`dsh-taste/package.json`**：`peerDependencies` 增 `"@deepseek-ai/dsh-client-connection": "^0.1.1-rc.2"`。

**`dsh-taste/lib/index.js`**：
- `inject = ["agents","commands","systemPrompt","connection"]`（第 46 行加一项）。
- 在 `registerTasteCommands(...)` 之后加 `registerTasteBridge(ctx, {...})`（复用已就绪的 `globalDir/projectDir/loadTasteSnapshot/queue/currentConfig` 与 storage fns，见 index.js:501-510 的 deps 形状）。

**新增 `dsh-taste/lib/bridge.js`**（约 40 行）：

```js
// 只读桥：把 taste 白名单数据暴露给浏览器，loopback-only。
export function registerTasteBridge(ctx, deps) {
    ctx.connection.rpc.handle("/taste", async (endpoint, payload, signal) => {
        const { globalDir, projectDir, loadTasteSnapshot, listTasteFiles, parseTasteFile, readTasteFile, queue, currentConfig } = deps;
        const gdir = globalDir();
        const pdir = projectDir(typeof payload?.cwd === "string" ? payload.cwd : undefined);
        switch (endpoint) {
            case "getSnapshot":   // 合并后的偏好文本（分源投影在 client 端由 getTree 提供）
                return { ok: true, value: { text: await loadTasteSnapshot(gdir, pdir) } };
            case "getTree": {     // 分源偏好树 + 置信度
                const scopes = [];
                for (const [name, dir] of [["project", pdir], ["global", gdir]]) {
                    if (!dir) continue;
                    const files = [];
                    for (const rel of await listTasteFiles(dir)) {
                        const entries = parseTasteFile(await readTasteFile(dir, rel).catch(() => ""));
                        files.push({ relPath: rel, entries });
                    }
                    scopes.push({ name, dir, files });
                }
                return { ok: true, value: { scopes } };
            }
            case "getStatus":     // 学习开关 + 队列 + 置信度统计
                return { ok: true, value: {
                    learning: currentConfig().learningEnabled,
                    queue: queue.stats(),               // {pending,failCount,cooldownUntil,running}
                    config: { injection: currentConfig().injection, observer: { modelMode: currentConfig().observer.modelMode } },
                } };
            default:
                return { ok: false, error: { code: "bad-request", message: `unknown endpoint ${endpoint}`, details: {} } };
        }
    }, { authority: "loopback" });
}
```

> 注：Command Code 兼容源（`~/.commandcode/taste`）已并入 `loadTasteSnapshot`（`storage.js:423-445`），`getSnapshot` 覆盖；如需在 GUI 里单列「Command Code」分源，可仿 `commands.js` 增一个 `loadCommandCodeTaste` 只读查询，本质同款白名单扫描。

### 6.2 client 半改动

**`dsh-taste/package.json`**：加两处（`dsh-client-connection` 同款，见其 package.json:16-38）：

```json
"exports": {
    ".": { "default": "./lib/index.js" },
    "./client": { "default": "./lib/client.js" },
    "./package.json": "./package.json"
},
"dsh": { "client": { "inject": ["@deepseek-ai/dsh-client-runtime"], "platform": "web" } }
```

（`dsh.client.inject` 是模块图排序依赖，`platform` 必填字符串；`immediately` 可选。发现机制见 §6.3。）

**新增 `dsh-taste/lib/client.js`**（`window.__ModuleLoader__.load({...})` 打包，约 100 行）：`inject: ["connection"]`，`apply(ctx)` 里：

```js
const { rpc } = ctx.get("connection");
const tree = await rpc.call("/taste", "getTree", { cwd: currentCwd });   // {ok:true,value:{scopes}}
const status = await rpc.call("/taste", "getStatus", {});
```

再用 `ctx.slots`（`settings.section` 或 sidebar 槽位）挂一个 React 面板渲染偏好树/置信度/学习状态。`ctx.remote.$on("connection/reset"...)` 不必要——`connection` 服务自身在重连后会置 `hostDescription`，client 用轮询即可。

### 6.3 client 半发现机制（为什么不用额外挂载）

`dsh-client-modules/lib/index.js:67-86`：Node 半「**扫描 host Loader 的 entries，找声明了 `dsh.client` 的包**」，组装 `window.__DSH_BOOT__` 模块图，服务 `/plugins/<id>/client.js`。`parseDshClient` 校验 `dsh.client`（index.js:119-133），`clientExportOf` 解析 `exports["./client"]`（index.js:135-146），缺失则抛「declares dsh.client but exports no ./client bundle」（index.js:395）。**dsh-taste 已在 host Loader entries（`~/.dsh/profiles/web/cordis.patch.yml:21-23`），加了 `dsh.client`+`exports["./client"]` 后其 client 半会自动进浏览器模块图，无需改 cordis.patch.yml。**

### 6.4 改动量评估

| 文件 | 改动 | 规模 |
|---|---|---|
| `dsh-taste/package.json` | `exports["./client"]` + `dsh.client` + peer 依赖 `dsh-client-connection` | ~10 行 |
| `dsh-taste/lib/index.js` | `inject` 加 `connection`；`apply` 加 1 行 `registerTasteBridge` | ~4 行 |
| `dsh-taste/lib/bridge.js`（新） | `ctx.connection.rpc.handle("/taste", …)` 只读分发 | ~40 行 |
| `dsh-taste/lib/client.js`（新） | `__ModuleLoader__` 打包 + `inject:["connection"]` + `rpc.call` + UI 槽位 | ~100 行 |

**总计约 150 行，零官方核心包改动，无需自建 HTTP/WS 端点，无需重启之外的额外挂载**（改包后 `npx @deepseek-ai/dsh web` 重启生效，client bundle 由 `dsh-client-modules` 重新组合）。

---

## 桥接方案裁定（一页）

1. **通信原语**：`inject:["connection"]` → `ctx.get("connection")` → 上行 `api.<ns>.<method>`（闭集）或 `rpc.call(channel, endpoint, payload)`（开放）；下行 WebSocket 帧。dsh-taste 用 `rpc.call`。
2. **host 暴露**：`ctx.connection.rpc.handle("/taste", handler, {authority:"loopback"})`，handler 返回 `{ok:true,value}|{ok:false,error}`。**不用** `provide`（进程内）或 `harness.handle`（仅动态双半包）。
3. **数据推送/实时**：自定义事件进不了浏览器（`API_REMOTE_FORWARDED_EVENTS` 闭集），**轮询** `getStatus` 即可，偏好树有 mtime 缓存、成本极低。
4. **鉴权/会话**：无真实鉴权，边界 = loopback+同源栅栏；taste 只读 loopback-only，无需 session 绑定、无需自建端点。
5. **安全**：`authority:"loopback"` + handler 内只走 `resolveTastePath/listTasteFiles` 白名单 + 返回解析后 JSON（非原始字节），满足「只暴露 taste 目录白名单数据」。
6. **最小改动**：host 半 +`connection` inject + `bridge.js`（~40 行）；client 半 +`exports["./client"]`+`dsh.client`+`client.js`（~100 行）；总计 ~150 行，不动官方包。

**唯一非平凡前提**：`lib/client.js` 需要按 `dsh-client-ui-*` 的 `window.__ModuleLoader__.load({ id, factory })` 形式打包（React 经 `require("react")` 从模块表注入，不能内联 node 依赖），本部署无源码 checkout、无官方构建管线，client bundle 需手工产出或复用 `dsh-client-web-react` 的运行时约定。
