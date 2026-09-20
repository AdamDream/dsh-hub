# 底座部署包：dsh-workspace-enhancement@0.1.2（rc.2 原生适配版）

> 用途：本目录是「底座」部署包的完整交付物（staging，不碰部署位）。
> 底座 = SSH 远程开发 + 多工作区（sw_status / sw_connect / sw_pick_workspace / sw_exec /
> PTY + ProxyJump + SFTP + bwrap 远端沙箱 + 审批门 + TOFU），见 `.workspace/workspace-plugins-deep-research.md`。
> 目标宿主：`@deepseek-ai/dsh` 0.1.1-rc.2、`@deepseek-ai/cordis` 4.0.2、node v22.23.2、profile `web`。

## 目录

| 路径 | 内容 |
|---|---|
| `dsh-workspace-enhancement-0.1.2.tgz` | npm 官方 tarball（`npm pack dsh-workspace-enhancement@0.1.2`，sha256 `6aeb0f3c…`，与本机 `.workspace/research/tgz/workspace-enhancement-0.1.2.tgz` 一致） |
| `tarball/package/` | tarball 展开（原样） |
| `patch/dsh-workspace-enhancement-0.1.2-rc2.patch` | 适配 unified diff（**4 行实际变更**，<50 行） |
| `patch/dsh-workspace-enhancement-0.1.2-rc2/` | 应用 diff 后的完整副本（部署用） |
| `peer-deps-check.mjs` / `peer-deps-check-patched.mjs` | 13 项 @deepseek-ai deps + 2 peer 对本机版本的核对脚本（原版/适配后） |
| `load-test2.mjs` | 静态加载测试：用本机 0.1.1-rc.2 模块树解析发布物全部 ESM 静态 import |
| `loadtest/` | 自包含解析链 staging（profile 包符号链接 + ssh2 1.17.0 及其依赖，仅用于验证，不碰 ~/.dsh） |
| `ssh2-install/` 说明 | ssh2 是底座唯一非官方运行时依赖（`dependencies: ssh2 ^1.16.0`），部署时经 `pnpm add` 安装 |
| `cordis-insert.md` | 装配片段（两种路径）+ 三行 config/settings 键说明 |
| `client-slots.md` | client 注入 6 包 + 5 slot 在 rc.2 的核验 + slots/primitives 悬空结论 |

## 核对结论（2026-09-14 实机）

### 1) 13 个 @deepseek-ai deps vs 本机 —— 原版 11/13 strict ✓，2 项仅预发布放行
`node peer-deps-check.mjs`：

- **strict ✓（11/13）**：cordis ^4.0.1→4.0.2、dsh-fs/fs-local/fs-sandbox/llm/sandbox/sandbox-policy/
  subprocess/subprocess-local/timeout 全 `^0.1.1-rc.2`→0.1.1-rc.2、schemastery ^3.18.1→3.18.2。
- **仅 prerelease-ok（2/13）**：`dsh-host-directory-picker` / `dsh-host-directory-picker-native`
  `^0.1.0-rc.6`（元组 0.1.0 ≠ 0.1.1，strict 不满足；includePrerelease 放行）。
  **风险**：pnpm 解析会把它们装成第二份 0.1.0-rc.8 —— 而审计核验的是本机 0.1.1-rc.2 的符号面，
  第二份实例 = 未核验面 + 双实例风险 → **必须适配消除**。
- **peers（2/13 之外）**：`dsh-tools`、`dsh-system-prompt` `^0.1.0-rc.6`，strict 均不满足
  （本 profile `autoInstallPeers:false` + strict-peer 关闭 → 仅警告不阻断，但按单实例原则一并放宽）。

### 2) 适配（4 行，<50 行，无架构改动）
`patch/dsh-workspace-enhancement-0.1.2-rc2.patch` 把上述 4 处 `^0.1.0-rc.6` → `^0.1.1-rc.2`：
2 个 peer（dsh-tools、dsh-system-prompt）+ 2 个 picker dep。应用后 `peer-deps-check-patched.mjs`
**13 deps + 2 peers 全 strict ✓** —— 整棵 `@deepseek-ai/*` 解析到本机单实例，无第二份。

### 3) 运行期 API 逐符号核验（继承审计结论 + 本次实测补充）
- 发布物 `lib/` 无 `connection.fetch` / `uiWorkspace` / `/api/dsw`（0.1.4-only 符号，grep 零命中）；
  0.1.2 用的是 `ctx.connection.rpc.handle('/dsw', …)`（`lib/web.js:504`）—— rc.2 存在的 API。
- **静态加载测试**（`node load-test2.mjs`）：12 个 host 模块（index/plugin/web/picker/runtime/
  filesystem/subprocess/mixed/registry/exec-tools/hostkey/credential）**全部在本机 rc.2 树成功加载**；
  唯一 FAIL 是 `lib/client.js`（浏览器 bundle，顶层引用 `window`）—— 在 Node 里失败是正常形态，
  host 侧只 `require.resolve` 它的 package.json（见 client-slots.md），不影响启动。
- ⚠️ 静态加载 ≠ 真 boot：作者 F1 教训（typecheck 全绿 ≠ 能启动）。真 boot 冒烟列 Runbook 验证项。

### 4) 非官方依赖
仅 `ssh2 ^1.16.0`（dependencies）+ `schemastery ^3.18.1`（本机 3.18.2 ✓）。ssh2 部署时安装
（`pnpm add ssh2@^1.16.0` 于 profile web 目录）；loadtest staging 里放了 ssh2 1.17.0 及其
asn1/bcrypt-pbkdf 依赖链用于验证。

## 为什么是 0.1.2 而不是 0.1.3/0.1.4
- **0.1.4 不可跑**：硬依赖 rc.2 不存在的 `ctx.connection.fetch.register` + client `uiWorkspace`
  （audit §5.3/§5.4），backport 200–500 行。
- **0.1.3**：deps 全改 peer 且收窄到 0.1.2-rc.1 家族，安装更别扭、收益低于 0.1.2。
- **0.1.2**：deps 天然对准 rc.2（11/13 strict ✓），接缝全对上，<50 行放宽即可 —— 审计的基线推荐。
- 注意：作者 2026-09-11 单方面退出 0.1.2 家族（0.1.3/0.1.4 跳线到 0.1.2-rc.1/0.1.5-rc.1），
  **0.1.2 是无人维护的「历史正确版」** —— 功能面稳定，但无上游修复，装后需自测（Runbook 已含）。

## 产物约束
- 本目录为 staging：**不碰部署位**（不写 ~/.dsh）。真实安装命令见 `deploy.sh` / `RUNBOOK.md`。
