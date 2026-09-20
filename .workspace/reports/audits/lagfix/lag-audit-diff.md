# lag-audit-diff：0.1.5 升级尝试 → 回退 前后 subagent 相关包差异审计

> 只读审计 + 本报告落盘；未改动任何被审计文件。审计时间：2026-09-12。
> 证据基线：npm 原厂 0.1.1-rc.2 tarball（自 registry.npmmirror.com 抓取，22 个包 sha512 全部对照 `~/.dsh/profiles/web/package-lock.json`(8/28) integrity **逐包验证通过**，解包于 `.workspace/baseline-011/x/`）。

## 0. 结论摘要

- **回退完整性（包内容层）：回退完整。** 当前运行世界（= 全局安装 `~/.npm-global/lib/node_modules/@deepseek-ai/dsh/`，即 GUI 运行底座与共享层 symlink 目标）中，dsh 元包与 **22 个 subagent 相关 @deepseek-ai 包全部与 npm 原厂 0.1.1-rc.2 逐字节一致**（sha256 全等），全局 @deepseek-ai 187 包版本全部 `0.1.1-rc.2`，**无任何 0.1.5-rc.x 版本标签/代码残留**。回退方式证据：npm log `2026-09-12T06_55_27_603Z` → `npm install --global @deepseek-ai/dsh@0.1.1-rc.2`（前置 uninstall + `cache clean --force`）。
- **被覆盖/丢失的 = 3 个本地补丁（部署态直接修改，重装被抹），其中 1 个正是「subagent 非流式写入」机制：`dsh-agent-loop` 补丁丢失 → 子代理回归逐 chunk 流式写事件。**（用户怀疑成立。）
- **「worker 独立线程被覆盖」不成立（未确认用户所指）：** 0.1.1 与 0.1.5 的子代理驱动均为 in-process（同一 Cordis context）；worker_threads 机制包（`dsh-workflow-worker-thread` / `dsh-code-runtime-worker-thread`）两版同构、当前=原厂完好；审计（audit-subagent-arch-A/B）的「子代理 worker_threads」线从未落地，无任何产物。
- 唯一非补丁差异 = 配置层 `cordis.patch.yml` 多出 4 条 dsh-fix disabled（9/12 14:31-14:44 写入），其中 `subagent-model-selection-settings` 是 0.1.5 新增插件的 id，0.1.1 树中不存在（0.1.5 尝试期残留）。

## 1. 当前解析链（事实底座）

- `web/node_modules` **为空**（9/12 14:44 重建）→ 解析回退到扁平共享层 `~/.dsh/profiles/node_modules/`，其中 `@deepseek-ai/*` 全部为 symlink → **全局安装** `~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/*`。
- 运行进程：沙箱无法观测宿主进程（bwrap unshare-pid）；按系统提示（harness checkout = 全局安装路径）与 9/8 execute-btw.md 记录（web → 共享层 → global）一致，GUI 由全局安装承载。post-回退 boot 快照 `.workspace/.tmp-boot3080.html`（15:02）含 `dsh-client-runtime`（仅 0.1.1 存在）与 `@local/dsh-btw` → 确认运行世界为 0.1.1。

## 2. 被覆盖文件/包清单（基线 → 当前）

| 包 / 文件 | 升级前基线（patched-official-files.tgz，9/11 14:26） | 当前（= 原厂 0.1.1-rc.2） | 性质 |
|---|---|---|---|
| `dsh-agent-loop/lib/index.js` | 48,119 B（补丁：L612 `isSubagent` 判定 depth>0，L622 `if (!isSubagent)` 跳过逐 chunk `assistant/chunk` append，即**子代理非流式写入**） | 47,991 B 原厂：无条件逐 chunk append | **自定义补丁丢失（关键机制）** |
| `dsh-client-ui-subagent/lib/client.js` | 42,608 B（tok/s 显示补丁，含 `formatTokensPerSecond`/`decodeTokensPerSecond`，对应 audit B9，sha1 508ed11aec66） | 41,404 B 原厂 | 自定义补丁丢失 |
| `dsh-web-search-deepseek/lib/index.js` | 13,746 B（补丁 L143 加 `"x-opencode-session": crypto.randomUUID()` 请求头） | 13,698 B 原厂 | 自定义补丁丢失 |
| `dsh-subagent` / `-in-process-driver` / `-fork-in-process` / `-spawn-in-process` / `dsh-agent` / `dsh-host-apiproxy` / `dsh-typert-protocol` / `dsh-typert-loader` / `-registry` / `dsh-client-modules` / `dsh-tool-subagent*` / `dsh-code-runtime*` / `dsh-workflow-worker-thread` / `dsh-agent-*` | 原厂 0.1.1-rc.2 | 原厂 0.1.1-rc.2（sha256 全等） | **无差异**（回退完整） |

**全量版本扫描**：全局 @deepseek-ai 187 包 = `0.1.1-rc.2`；非 0.1.1-rc.2 仅基座依赖 cordis 4.0.2 / cordis-plugin-* (1.0.17/1.0.7/1.0.3/1.1.4/1.0.2) / cosmokit 1.8.3 / schemastery 3.18.2 / node-addon-landlock-run 0.1.1 —— npm log 证实为 `install dsh@0.1.1-rc.2` 按 `^` 范围解析到的最新 patch（审计 9/11 记录旧部署为 4.0.1/3.18.1/1.8.2）。性质：**semver 漂移，非 0.1.5 残留、非混装**。

## 3. worker 线程与写入机制精确位置

- **子代理驱动（两版同构，当前完好）**：`dsh-subagent-in-process-driver/lib/index.js` `startInProcessRun()` → `parent.ctx.agents.create()`（同一 Cordis context/事件循环）；`dsh-tool-subagent` 亦走 `ctx.agents.create()`。两版均**无** worker-thread 子代理驱动；全盘无 `worker-driver`/`subagent-worker` 字符串、无 `@local/dsh-subagent-worker` fork。
- **写入机制（差异点）**：0.1.1 原厂 `dsh-agent-loop/lib/index.js` step() L617-627 无条件 `session.append("assistant/chunk", …)` 逐 chunk（事件风暴源）；本地补丁对该循环加 `if (!isSubagent)` 门控；0.1.5 上游直接删除 `assistant/chunk`（grep=0），改 append `assistant/attempt`×3 / `assistant/message`×2 → **0.1.5 上游天然非流式**（runbook 断言属实）。
- worker_threads 包：`dsh-workflow-worker-thread`（lib/worker.cjs，3 处 worker_threads）与 `dsh-code-runtime-worker-thread` 当前=原厂 0.1.1，结构同 0.1.5。

## 4. 恢复建议（最小集合）

从 `~/dsh-upgrade-backup/patched-official-files.tgz` 恢复 **3 个文件**到当前物理落点（**注意：不再是 `web/node_modules`，而是全局安装**）：

1. `dsh-agent-loop/lib/index.js` → `~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js`（恢复非流式写入，唯一机制关键项）
2. `dsh-client-ui-subagent/lib/client.js` → 同树 `dsh-client-ui-subagent/lib/client.js`（tok/s；客户端补丁按请求读盘 + rev=sha1，刷新即生效，无需重启）
3. `dsh-web-search-deepseek/lib/index.js` → 同树 `dsh-web-search-deepseek/lib/index.js`

恢复前建议逐文件 diff 确认与现文件差异仅为本次审计所列 hunk（已给出精确差异）。可选：清除 `cordis.patch.yml` 中 4 条 disabled（含 0.1.5 残留 id `subagent-model-selection-settings`），恢复基线=备份 tgz 内版本（`dsh-home-config.tgz` `./profiles/web/cordis.patch.yml`）；**但 dsh-fix 禁用 wallpaper/vision-adam/taste 可能是 9/12 有意操作，恢复前需确认意图**。

## 5. 风险点

1. **补丁无 npm 层保护**：任何再执行 `npm install --global @deepseek-ai/dsh…` 都会再次抹掉恢复的 3 个补丁；建议把恢复写成可重放脚本（现有 `/tmp/patch-subagent.py` 只覆盖 tok/s）。
2. **旧路径失效**：APPLY.md 等既有补丁脚本目标为 `profiles/web/node_modules/@deepseek-ai/…`，该目录现为空；需改指全局安装路径。
3. **未应用的 btw 补丁**：`.workspace/deploy/patches/dsh-host-apiproxy.sessions-prompt-transform.patch`（U-G-2）尚未应用且目标路径过期；恢复动作勿覆盖该文件，btw 主线继续时需更新路径再应用。
4. **插件禁用态**：当前 btw 存活（boot 快照含 @local/dsh-btw）；wallpaper/vision-adam/taste 被 disabled，与基线不符——恢复配置前先确认是否为有意修复。
5. **宿主侧补丁需重启 DSH 生效**（agent-loop 非热载）；客户端补丁刷新即生效。
6. 会话数据与插件（@local/dsh-btw 0.4.0-btw.1、@local/dsh-wallpaper 0.5.0、dsh-taste、dsh-vision-adam 0.2.0）已核与备份逐字节一致，不在恢复范围。

## 6. 交叉核对提示（lag-audit-mechanism）

- 「被覆盖了什么」事实底座 = **3 个本地补丁丢失**（agent-loop 非流式写入、ui-subagent tok/s、web-search 头）；包本体零 0.1.5 残留。
- 若另一线判定「当前为流式写入/事件风暴」→ 根因是 **agent-loop 补丁丢失**（0.1.1 原厂行为），不是 0.1.5 代码覆盖。
- 「0.1.5 覆盖后长什么样」参照 = `~/.dsh/profiles/web2/node_modules/@deepseek-ai/`（0.1.5-rc.2 原厂 + 移植补丁，dsh-subagent lib 138,385 B、agent-loop 71,267 B、tool-subagent 35,293 B、新增 model-selection-settings 等）。
- 不确定项：宿主进程实时解析（沙箱隔离）；dsh-fix 禁用 4 插件的意图；「worker 独立线程」确切所指（若指子代理线程化，两版均不存在该机制）。
