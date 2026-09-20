# dsh-taste 宿主侧 bridge 0.1.1 → 0.1.5 移植报告

日期：2026-09（web2 = DSH 0.1.5-rc.2 并行 profile）
结论：**移植完成，boot 实测干净，/taste RPC 通道端到端可用**。仅改 web2 副本 taste 包两个文件（bridge.js、index.js）；client.js 核验后**无需修改**（协议双向兼容）。未触碰共享层、web 旧 profile 及其它插件。

## 1. 故障根因（代码级验证）

0.1.5 `dsh-client-connection/lib/index.js`：
- `get rpc()`（L540-546）把 owner **硬编码为连接插件自身 ctx**（`const owner = this.ctx`），`handle(channel, handler)` 转发到 `this.register(owner, channel, handler)`。
- `register(owner, channel, handler)`（L602-619）在 L618 执行 `owner.effect(() => owner.webServer.register(route))` —— owner 必须已注入 webServer。
- 0.1.5 连接插件的 `inject = ["credentials"]`（L736），webServer 只在 apply 内 `ctx.inject(["webServer"], (webCtx) => …)`（L758）的**独立 webCtx 作用域**出现 → 连接服务自身的 `this.ctx` 永远没有 webServer → 任何调用方执行 `ctx.connection.rpc.handle(...)` 必然抛 `cannot get property "webServer" without inject`。
- 0.1.1 对比：旧版 `inject = ["webServer"]`（web profile index.js L479），连接插件自己的 ctx 就带 webServer，`rpc.handle` 能落地 → 这是 0.1.5 结构性破坏，非 taste 自身缺陷。0.1.5 官方包树内无任何包使用 `rpc.handle`（实测 grep），官方姿势即带 owner 的 `register`。

## 2. 改动（旧 → 新映射）

只允许的三个文件中的两个被修改：

### 2.1 `web2/node_modules/@deepseek-ai/dsh-taste/lib/bridge.js`
- L287（registerTasteBridge 尾部）：
  - 旧：`const dispose = ctx.connection.rpc.handle("/taste", handle, { authority: "loopback" });`
  - 新：`const dispose = ctx.connection.register(ctx, "/taste", handle);`
- teardown 语义（原 ISSUE-5 注释）等价保留：`ctx.effect(() => dispose, "taste.rpc.channel")` 不变。`register` 内部是 `owner.effect(() => owner.webServer.register(route), …)` —— 传入的 owner 就是 taste 插件自身 ctx，路由**本就随插件生命周期**注册/注销；外层 `ctx.effect` 二次绑定幂等，保持原 ISSUE-5 的显式可测性。比 0.1.1 更强：0.1.1 路由绑在连接插件 ctx 上靠外层 dispose 解绑，0.1.5 直接绑在本插件 ctx 上。
- 同步更新模块头 docstring 与 `registerTasteBridge` JSDoc。

### 2.2 `web2/node_modules/@deepseek-ai/dsh-taste/lib/index.js`
- inject 清单（L57）：`["agents", "commands", "systemPrompt", "connection"]` → `["agents", "commands", "systemPrompt", "connection", "webServer"]`。cordis 会等待 webServer 注入后才运行 apply，route owner 的 `ctx.webServer` 保证就绪。

### 为什么不用 `fetch.register`（官方 exact-route 姿势）？
`ctx.connection.fetch.register(route)` 要求 route.path 落在 `/api/` 下（`assertFetchRoute` → `endpointFromPath("/api", path)`）且**不经过 rpcFetchHandler 帧处理**（无 client-request/server-response 信封、无 rpcId 关联）——要用它就得在 taste 里重新实现整层 RPC 信封，且 /taste prefix 语义会丢。`connection.register(ctx, channel, handler)` 是 0.1.5 对"命名 RPC channel"的正规 API（`rpc.handle` 内部就是调它），prefix 语义、RPC 帧、requestRejection 围栏全部原样保留，是最小等价移植。

### 安全围栏映射（0.1.1 → 0.1.5）
- 0.1.1：`{authority: "loopback"}` → route fence = `isTrustedApiRequest(req, [])`（仅 Host/Origin，非 loopback 一律 403）。
- 0.1.5：`register` 的 route handler 套 `requestRejection(req)` = `isTrustedApiRequest(req, trustedHosts)`（403）+ `browserAuth.isAuthenticated`（401）。默认 trustedHosts=[] 时 loopback 围栏与 0.1.1 等价且**更严**（多一道浏览器会话 cookie 认证；浏览器经启动 token 换 cookie 后同源请求天然携带）。实测：伪造 Host 头 → 403；无 cookie → 401。

## 3. 客户端协议核验（client.js 未改）

浏览器侧 0.1.1 与 0.1.5 的 `createWebConnectionRpc` **线上格式逐字节一致**：
- URL：`POST ${channel}/${endpoint}`（taste 用 `CHANNEL = "/taste"`，调用形如 `rpc.call("/taste", "getTree", { cwd })`）。
- 请求信封：`{type:"client-request", rpcId, method: endpoint, payload}`，`content-type: application/json`。
- 响应信封：`{type:"server-response", rpcId, result:{ok:true,value}|{ok:false,error:{code,message,details}}}`，客户端校验 rpcId 关联。
- 唯一差异是宿主侧 0.1.5 对 method/endpoint 不匹配返回 `code:"gateway/bad-request"`（0.1.1 为 `"bad-request"`）——taste client.js 对任何 `{ok:false}` 走通用错误展示，无影响；0.1.5 新增的 415/400 前置校验（非 JSON POST）taste 调用恒满足。
- taste client.js 插件面（L761-766）：`inject = ["slots","locale","connection","sessions"]`，`ctx.connection.rpc` 在 0.1.5 客户端 `ctx.provide("connection", handle)` 中仍为带 `call(channel, endpoint, payload, signal)` 的同一形状 → **0.1.5 下直接兼容，未改动**。

## 4. Boot 实测（决定性）

```
cd /home/CNS2026495165/.dsh/profiles/web2 && node ./node_modules/.bin/dsh --profile web2 --port 3081 --no-open
```
- 日志仅一行 `dsh web: http://127.0.0.1:3081/?token=…`；`plugin tree failed` / `Error:` 出现 **0 处** → boot 干净。
- 根路径 `GET /` 无凭证时 401（0.1.5 浏览器认证门，预期）；用启动 token 换 cookie 后 `GET /` → **200**。
- 页面插件清单含：`@deepseek-ai/dsh-taste`、`@local/dsh-btw`、`@local/dsh-wallpaper`、`@deepseek-ai/dsh-client-store`。`dsh-vision-adam` 不在页面属**结构性正常**：它是纯宿主侧插件（lib/ 下只有 index.js，无 client.js，cordis.patch.yml 中 id: vision-adam 已插入且 boot 无错）——客户端 bundle 清单本就不含它。
- **/taste RPC 端到端（决定性验证移植正确）**：
  - `POST /taste/getStatus` → `{"type":"server-response","rpcId":"test-1","result":{"ok":true,"value":{learning/injection/modelMode/queue…}}}` ✓
  - `POST /taste/getTree`（cwd 传入）→ ok:true，scopes/files/entries 真实数据 ✓
  - 未知 endpoint → `{ok:false, error:{code:"unknown-endpoint",…}}` ✓
  - 伪造非 loopback Host 头 → **403**（围栏生效）✓
  - 无 cookie → **401** ✓
- 测完已 `kill` 进程（pid 1811911），确认 3081 端口释放。

## 5. 遗留风险

1. **fixture 模式**（`?fixture` URL）：0.1.5 fixture RPC 只接受 `/api` channel（client.js L5942），taste 面板 `rpc.call("/taste",…)` 会 reject——与 0.1.1 行为一致（0.1.1 fixture 同样仅 /api），非本次移植引入，测试专用路径，不修。
2. **cookie 认证依赖**：/taste 现受浏览器会话 cookie 保护（比 0.1.1 更严）。若未来有非浏览器同源调用方（脚本/扩展）直接 POST /taste，会收到 401——这是 0.1.5 连接插件整体设计（/api 同款围栏），非 taste 特例。
3. **owner 绑定变更**：路由现直接绑 taste 插件 ctx（0.1.1 绑连接插件 ctx + 外层 dispose）。若连接插件先于 taste 卸载，两者路径都正确解绑（各自 ctx 生效），无悬空路由；若未来有人改为在 taste 之外复用同一 handle，需自行显式 dispose。
4. **web2 副本内 node_modules 为本地补丁**：`pnpm install` / 重装会覆盖这两处改动，需在 web2 移植清单中固化（如 patch 脚本或记录）。
