# REVIEW — usage + session-board 部署包复核报告（执行+复核一体）

- **日期**：2026-09-12 16:45
- **模式**：执行+复核一体（用户裁决，未走审计/独立复核）
- **Verdict**：**pass**（附 1 个 **P0 兼容性警示**需用户裁决 + 1 个 P1 元数据缺陷 + 2 个「未确认」项）
- **边界遵守**：全程只读 `~/.dsh`、只写 `.workspace/side-deploy/`；未使用 sandbox_permissions

---

## 1. 产物清单（全部在 `.workspace/side-deploy/`）

| 产物 | 说明 |
|---|---|
| `usage/` | `@local/dsh-usage` v0.1.0 完整包（与 web2 源逐字节一致，140K） |
| `session-board/` | `@deepseek-ai/dsh-session-board` v0.1.0 完整包（与源码逐字节一致，172K） |
| `deploy-side.sh` | 部署脚本（备份→拷贝→幂等 insert；`--dry-run`；`bash -n` 通过） |
| `cordis-insert-usage.yml` / `cordis-insert-session-board.yml` | insert 片段（YAML 合法，已用 yaml 包解析验证） |
| `usage-compat-011.diff` | 可选：usage 适配 0.1.1-rc.2 RPC API 的 1 行补丁（已实测可应用） |
| `DEPRECATED-web2.md` | web2 废弃标记文本（主代理部署期单独放入 `~/.dsh/profiles/web2/`） |
| `README.md` | 部署 runbook |
| `_sim/` | 验证用仿真树（flat 层解析/ESM 全量 import/假 HOME 部署测试，含测试证据） |

## 2. usage 部署要点

- **部署位**：`~/.dsh/profiles/node_modules/@local/dsh-usage/`（与 dsh-btw/dsh-wallpaper 同级；`@local/` 为非官方真实目录区，安全）。
- **cordis insert**（与 web2 patch.yml 末尾逐字一致，已程序化验证）：
  ```yaml
  - insert:
      - id: usage
        name: '@local/dsh-usage'
  ```
- **settings 键**：无。插件运行时自注册 `dsh-usage` 命名空间（空 schema）；0.1.1-rc.2 的 `settings.register(ns, schema, options)` 对 options 用可选链（`options?.base`），安全。
- **依赖**：peer `cordis ^4.0.1` / `dsh-settings >=0.1.1-rc.2 <0.2.0` / `dsh-home-paths *` / `schemastery ^3.18.1` —— profiles 层实测版本 4.0.2 / 0.1.1-rc.2 / 0.1.1-rc.2 / 3.18.2，**全部满足**（semver 校验通过）。零 runtime dependencies。engines `^22.19.0 || >=24`：本机 node v22.23.2 ✓。
- **解析验证**：`require.resolve` 仿真（部署后等效位置）+ `_sim` 扁平树 **全量 ESM import 通过**。

### 🔴 P0：usage v0.1.0 的 RPC 注册姿势与 web profile（0.1.1-rc.2）不兼容

- 现象：`lib/rpc.js:216` 使用 0.1.5 姿势 `ctx.connection.register(ctx, "/usage", handle)`（**无 options 参数**）。
- 证据链（全部基于真实盘面）：
  1. web profile 运行位 `profiles/node_modules/@deepseek-ai/dsh-client-connection@0.1.1-rc.2/lib/index.js:241-243`：`register(owner, channel, handler, options)` 中 `const trustedHosts = options.authority === "loopback" ? ...` —— **无条件解引用第 4 参**，无默认值 → `options` 为 undefined 时 **TypeError**。
  2. 同包 `lib/types/rpc-host.d.ts` 声明 `private register` —— 公开 API 是 `get rpc()` 的 `handle(channel, handler, options)`（index.js:222 别名到 register）。
  3. 生产先例：web profile 正在运行的 `dsh-taste@0.1.0/lib/bridge.js:287` 用 `ctx.connection.rpc.handle("/taste", handle, { authority: "loopback" })`。
- 后果：`lib/index.js:140` 在 apply 内**同步调用** `registerUsageRpc` 且无 try/catch → usage 插件加载失败（仅 usage 自身失败，不影响其他插件与整机）。
- 修复（已备好）：`usage-compat-011.diff` 将 1 行改为 `ctx.connection.rpc.handle("/usage", handle, { authority: "loopback" })`。两条路径最终汇入同一 `rpcFetchHandler`，handler 信封 `(endpoint, payload, signal) => ({ok,value}|{ok:false,error})` 形状不变。已实测：patch 干净应用、`node --check` 通过、补丁后 rpc.js 在仿真扁平树全量 import 通过。
- **需用户裁决**：原样部署（usage 不加载，其余无碍）**或**先应用补丁再部署（推荐，usage 可正常工作）。

## 3. session-board 部署要点

- **部署位**：`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-session-board/`（与 dsh-vision-adam / dsh-taste 同级；两者在 `@deepseek-ai/` 下即为真实目录，先例成立 ✓；官方包为符号链接，DSH 只重链官方条目，不剪枝非官方真实目录）。
- **cordis insert**（挂载 id 与 install.sh / README / lib/index.js 的 `name` 常量一致）：
  ```yaml
  - insert:
      - id: session-status-board
        name: '@deepseek-ai/dsh-session-board'
  ```
- **settings 键**：无。运行时自注册 `session-status-board` 命名空间，Config 默认值：`enabled=true` / `maxBoardTokens=500` / `injection=runtime-context` / `activeWindowMinutes=30` / `refreshIntervalSeconds=10` / `queryLimit=5` / `queryDetailBytes=2048` / `queryTotalBytes=8192` / `maxPeerEntries=8`。
- **依赖**：peer `cordis ^4.0.1`（装 4.0.2 ✓）/ `dsh-tools ^0.1.1.2` / `dsh-settings ^0.1.1.2` / `dsh-atomic-write ^0.1.1.2` / `dsh-llm ^0.1.1.2`；dependency `@deepseek-ai/schemastery ^3.18.1`（装 3.18.2 ✓）。profiles 层与 live 全局树版本一致（官方包为指向 live 树的符号链接）。
- **API 面核对**（逐项对 0.1.1-rc.2 源码验证）：`ctx.tools.register` ✓（dsh-tools:2762）、`ctx.agents.roots()` ✓（dsh-agent:715）、`settingsNamespace`+`installSettingsSection` ✓（dsh-settings:638 导出，签名 `(ctx,ns,schema,entry,hooks)` 与调用匹配）、`createUserMessage` ✓（dsh-llm:1658）、`withFileLock`/`writeFileAtomic` ✓（dsh-atomic-write:117）、`schemastery` default export ✓、`ctx.inject(["systemPrompt"])`/`on`/`effect`/`get`（cordis 4.0.2）✓、`sessionProjections` 经 `ctx.get` 缺席时优雅降级（M2）✓。
- **校验**：`node --check` 7 个 lib + 2 个 test 全过；`_sim` 扁平树全量 ESM import 通过。
- **🟡 P1 元数据缺陷**：peerDependencies 的 `^0.1.1.2` 是**非法 semver 范围**（4 段版本号，`semver.validRange` 返回 null；`0.1.1.2` 不可解析）。运行期无影响（Node 不校验 peer 范围，手动平铺安装不经 npm）；若日后走 npm 安装会报 invalid comparator。建议改为 usage 同款 `>=0.1.1-rc.2 <0.2.0`（装版本 0.1.1-rc.2 满足该意图）。本次不擅自改包（保持与源码逐字节一致）。

## 4. deploy-side.sh 验证结果

| 项 | 结果 |
|---|---|
| `bash -n` | ✅ PASS |
| `--dry-run`（真实 HOME） | ✅ 零写入（md5 比对确认） |
| 全量部署（fake HOME 隔离测试） | ✅ 备份→拷贝→insert 全链路正确 |
| 幂等（第 2 次运行） | ✅ 两条 insert 均 SKIP，id 各仅 1 条；已存在目标先备份 `.bak-<TS>` 再重拷 |
| YAML 合法性 | ✅ patched 文件顶层 7 条（原 5 + 新 2）；两个片段文件各 1 条，均经 yaml 包解析 |
| web2 对照 | ✅ usage insert 与 web2 patch.yml 条目逐字一致 |
| 边界 | ✅ 操作性命令只触碰两个目标目录 + `web/cordis.patch.yml`（+就地 `.bak-<TS>`）；零操作性 web2 / dsh-btw / dsh-wallpaper / settings.yaml / live 树（卡顿修复区）引用；目标为符号链接时拒绝覆盖 |

## 5. web2 废弃标记

`DEPRECATED-web2.md`：含日期（2026-09-12）、状态（已废弃·勿启用）、原因（0.1.5-rc.2 升级尝试残留，用户裁决直接废弃、不再考虑 0.1.5 迁移）、处置与可选清理说明。**主代理部署期单独放入 `~/.dsh/profiles/web2/`**（脚本不碰 web2）。

## 6. 问题清单

- **[P0] usage RPC 姿势不兼容**（见 §2）：`connection.register(ctx, '/usage', handle)` 在 0.1.1-rc.2 抛 TypeError → usage 不加载。修复补丁已备好，待用户裁决。
- **[P1] session-board peer 范围非法**（见 §3）：`^0.1.1.2` 非法 semver。运行期无影响，建议后续包内修正。
- **[未确认] usage 客户端半部**：`client.js` 在 web profile 前端 bundle 中的端到端行为（`ctx.connection?.rpc.call`、`ctx.sessions` 注入）未经运行验证，需部署重启后人工确认；0.1.1-rc.2 client 侧 `rpc.call` 存在（lib/client.js:9943/10208），静态面一致。
- **[未确认] sessionProjections 服务**：web profile 是否挂载 `sessionProjections` 未确认；缺席时 session-board 按 M2 设计优雅降级（goal/todos 归 null），非阻塞。
- **[P3/说明] usage 注入 `webServer`**：0.1.1 姿势下 `webServer` 不再被 rpc.js 使用（`rpc.handle` 绑定到 connection 服务自身 ctx）；保留在 inject 列表无害（`webServer` 服务由 dsh-host-webserver 提供），如需最小化可在适配时一并移除——本次保持包内原样。

## 7. 主代理部署期注意点

1. **先裁决 usage P0**：原样部署（usage 不加载）或先 `patch -p1 < usage-compat-011.diff`（在 `usage/lib/` 上应用）再部署。
2. 演练：`bash deploy-side.sh --dry-run` → 正式：`bash deploy-side.sh`（自动备份，回滚可还原 `*.bak-<TS>`）。
3. `DEPRECATED-web2.md` 单独放入 `~/.dsh/profiles/web2/`。
4. 重启 dsh web（0.1.1-rc.2 运行位）→ 新会话生效。
5. 验证点：设置页出现 `dsh-usage` 卡片且图表数据可加载（应用补丁后）；新会话出现会话状态看板注入与 `query_peers` 工具；日志无 usage / session-board 报错。
