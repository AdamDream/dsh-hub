# `@local/dsh-office-route-b`（草案 · v0.1.0-draft）

WP5 · Route B 的**宿主侧薄插件草案**。产物位置
`/home/CNS2026495165/dsh/.workspace/audit-020/p0c/plugin-draft/`，**未装配**
（装配动作属协调者；本工单只写 `p0c/**`）。

## 它做什么

| 层 | 谁 | 内容 |
|---|---|---|
| 官方件 | `@deepseek-ai/dsh-webhook`（零代码，profile 加一行） | `ctx.webhookRuntime`：`register(rule)` / `dispatch(delivery)`；唯一内置动作 = 在 Web Workspace 里建普通 root Session，带完整回滚 |
| 自建件 | **本包** | ① 一个非 `/api` 精确路由 `/office-handoff`（Bearer 令牌 + 常量时间比较 + 请求体限长）；② 目标目录 / 扩展名 / 数量与单文件字节**三重白名单**（以 `realpath` + `lstat`/`stat` 事实为准）；③ 一条规则，把已授权投递映射成 `WebhookSessionRequest` |

## 为什么必须有一个自建插件

`dsh-webhook` **没有** Config（`lib/index.js` 里没有 `Config` 导出），也**没有**
YAML 配置规则的入口。官方 README 原文：规则由 *"User-authored rule plugins"*
通过 `ctx.webhookRuntime.register()` 提供，并把 disposer 交给自己的 `ctx.effect`。
⇒ **"只改投递器、不加宿主插件"在结构上不可能**。

## 文件

| 文件 | 说明 |
|---|---|
| `lib/core.js` | 纯逻辑（**零 DSH 依赖**）：白名单、`verifyToken`（双侧 sha256 + `timingSafeEqual`）、`buildTitle`/`buildPrompt`、扩展名/附注归一 |
| `lib/index.js` | Cordis 插件：`name` / `inject` / `Config` / `apply`；含有界读体、HTTP 状态码表、`authorizeDelivery`、`toSessionRequest` |
| `package.json` | `type: module`、`peerDependencies` 指向 rc.2 真件 |

## 契约（与投递器草案、Runbook 三方对齐）

```
GET  <origin><route>              ⇒ 405 +                 allow: POST      (零副作用探针)
POST <origin><route>
  authorization: Bearer <token>                                       (必需，唯一值，只认 Bearer)
  content-type: application/json
  {"workspacePath":"<abs dir>","files":["<abs file>", …],"note":"<可选，≤2000 字>"}
  ⇒ 202 空体   已受理并 dispatch（**不代表**规则命中或会话建成）
  ⇒ 400 body-not-an-object / files-missing / file-duplicated / JSON 非法 / Content-Length 非法
  ⇒ 401 authorization-* / invalid handoff token
  ⇒ 403 workspace-path-outside-allowlist / workspace-path-missing-on-disk /
        workspace-path-symlink-escape / workspace-path-not-a-directory / workspace-path-unreadable /
        file-outside-workspace / file-extension-not-allowlisted / file-is-symlink /
        file-not-regular / file-too-large / files-over-limit / file-symlink-escape /
        file-missing-on-disk / file-unreadable
  ⇒ 405 非 POST
  ⇒ 413 body-too-large
  ⇒ 415 content-type 非 application/json
  ⇒ 503 token 不可解析 / runtime 不可用 / 意外错误（fail-closed）
```

## 安全性质（逐条）

1. **令牌从不进日志**：`selftest.mjs` 断言"全部日志行不含令牌字面量"；
   错误响应体都是固定文案，不回显请求头/体。
2. **常量时间比较**：两侧 sha256 后 `timingSafeEqual` ⇒ 比较耗时与输入长度无关，
   且不会因长度不等抛异常。
3. **不信调用方**：`workspacePath` 与每个 `files[]` 都过 `realpath`；
   `..` 逃逸与符号链接逃逸都被具名拒绝；文件必须是普通文件（`lstat` 非符号链接）。
4. **不凭空造目录**：宿主的规则路径**永不**按调用方输入 `mkdir`；
   只在本插件 `apply()` 期按组合里的固定绝对路径创建白名单根。
5. **不含可注入文本**：标题与提示词 100% 由宿主生成；调用方文本只作
   "**不可信文本**"块附在提示词末尾（对齐官方 GitHub 规则的姿势）。
6. **绕过 `admit()` 是既定事实**：该路由不在 `/api` 前缀下 ⇒ 不享受 0.2.0 的
   cookie 门。**绝不允许**为了它把 `webServer.host` 改成 `0.0.0.0`。

## 自测（不启动任何服务）

```bash
cd /home/CNS2026495165/dsh/.workspace/audit-020/p0c
node harness/selftest.mjs
```

**预期**：`=== 结果：34/34 通过，0 失败 ===`。

自测在**真实 0.2.0-rc.2 依赖树**上加载 `lib/index.js`（经 `p0c/node_modules/@deepseek-ai`
这条**仅测试用**软链），用内存假 `ctx` / 假 `request` / 假 `response` 覆盖
`apply()` 的注册面与路由 handler 的全部出口。

> ⚠️ `p0c/node_modules/`、`p0c/harness/`、`p0c/probe-home/`、`p0c/resolve-check/`
> **都不是**插件的一部分，**不要**一起复制到 `profiles/node_modules/@local/`。

## 安装（协调者执行；本工单未执行）

```bash
A=/home/CNS2026495165/dsh/.workspace/audit-020/assembly-020
P=/home/CNS2026495165/dsh/.workspace/audit-020/p0c
install -d "$A/home/profiles/node_modules/@local/dsh-office-route-b"
cp -a "$P/plugin-draft/lib" "$P/plugin-draft/package.json" \
      "$A/home/profiles/node_modules/@local/dsh-office-route-b/"
# 校验可解析（模拟 loader 的裸名解析；`-e` 的解析基点是 cwd）
cd "$A/home/profiles" && node --input-type=module -e "
const m = await import('@local/dsh-office-route-b');
console.log('resolved:', m.name, JSON.stringify(m.inject));"
```
**预期**：`resolved: office-route-b ["webServer","webhookRuntime","credentials"]`。
