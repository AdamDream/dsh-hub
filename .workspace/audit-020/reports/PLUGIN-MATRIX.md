# 本地插件 × 0.1.7/0.2.0 导入面实测矩阵（协调者实测，方法学可复现）

方法：把官方包树与本地插件树组装成**扁平 node_modules 沙箱**（本地插件以真实目录复制，官方包按版本符号链接），
再以 ESM 动态 `import()` 逐个加载 13 个插件入口。两个沙箱仅官方包版本不同：
- `sandbox-017`：官方 = `~/.npm-global-dsh017/.../dsh/node_modules`（0.1.7-rc.2）+ U 组合的本地插件件
- `sandbox-020`：官方 = `.workspace/audit-020/assembly-020/prefix-cli/.../dsh/node_modules`（0.2.0-rc.1）+ 新组合的本地插件件

| 插件 | 0.1.7-rc.2 | 0.2.0-rc.1 | 迁移判定 |
|---|---|---|---|
| `@local/dsh-btw` | OK | OK | 原样可用 |
| `@local/dsh-logfile` | OK | OK | 原样可用 |
| `@local/dsh-pptmaster` | OK | OK | 原样可用 |
| `@local/dsh-ssh-gui` | OK | OK | 原样可用 |
| `@local/dsh-usage` | OK | OK | 原样可用 |
| `@local/dsh-wallpaper` | OK | OK | 原样可用 |
| `@local/dsh-web-search-sse` | OK | OK | 原样可用 |
| `@local/dsh-workerspace` | OK | OK | 原样可用 |
| `@deepseek-ai/dsh-taste` | OK | OK | 原样可用 |
| `dsh-workspace-enhancement` | OK | OK | 原样可用 |
| `@deepseek-ai/dsh-session-board` | **OK** | **FAIL** | 须改造（settings API） |
| `@deepseek-ai/dsh-vision-adam` | **OK** | **FAIL** | 须改造（settings API） |
| `@local/dsh-subagent-model` | **FAIL** | **FAIL** | 须改造（settings API，**两版同坏**） |

## 结论
1. **0.1.7 与 0.2.0 的差异恰好是 2 个插件**（`dsh-session-board`、`dsh-vision-adam`）从 OK 变 FAIL；其余 11 个两版行为完全相同。
2. **3 个插件失败的真因是 settings API 断层，与 0.1.7/0.2.0 无关**：
   `installSettingsSection` / `settingsNamespace` 在 **0.1.1** 存在，在 **0.1.7 与 0.2.0 均已删除**（`dsh-settings` 两版逐字节相同）。
   ⇒ 这是**上一轮 0.1.7 迁移的未闭缺口**，不是 0.2.0 引入的。
3. 为什么 `dsh-session-board`/`dsh-vision-adam` 在 0.1.7 沙箱里 OK 却在上表 0.2.0 沙箱里 FAIL：
   两者的 U 组合部署件在 `@deepseek-ai/dsh-settings` 上解析到了**不同的树**（0.1.7 沙箱里被本地插件自带的嵌套 `node_modules` 兜住，
   0.2.0 沙箱里解析到 0.2.0 的树）。**这不改变结论**：静态源码证据显示两者都 `import { installSettingsSection, settingsNamespace }`，
   在任一 ≥0.1.7 运行时上都必然失败；0.1.7 沙箱的 OK 属解析偶然，不是能力证据。
4. 另有 1 处**依赖缺失**（非版本问题）：`@local/dsh-btw` 需要 `zod`，新组合的顶层 `node_modules` 未提供（现役 profile 有 `zod`）。
   ⇒ 组装时必须显式提供 `zod`。

## ⚠️ 重要口径声明：本矩阵测的是「**部署件**」，不是「源码树」

本轮多份审计报告（T15/T16/T17/T24/T30）分析的是**插件源码 / 0.1.1 原始部署件**，其「settings 具名导入致链接期失败」的清单
与**本组合实际部署件**不一致。协调者对本组合部署件逐文件实测，权威结论如下：

| 插件 | 部署件是否具名导入 `installSettingsSection` | 在 0.2.0 解析树下 `import` |
|---|---|---|
| `@local/dsh-btw` | **否（已迁移）** | **OK** |
| `@local/dsh-ssh-gui` | **否（已迁移）** | **OK** |
| `@local/dsh-wallpaper` | **否（已迁移）** | **OK** |
| `@local/dsh-workerspace` | **否（已迁移）** | **OK** |
| `@local/dsh-usage` / `dsh-pptmaster` / `dsh-web-search-sse` / `dsh-logfile` | 否 | **OK** |
| `@deepseek-ai/dsh-taste` | 否 | **OK** |
| `@local/dsh-subagent-model` | **是**（`lib/index.js:19`） | **FAIL** |
| `@deepseek-ai/dsh-session-board` | **是**（`lib/index.js:30`） | **FAIL** |
| `@deepseek-ai/dsh-vision-adam` | **是**（`lib/index.js:3`） | **FAIL** |

⇒ **settings 断层在本组合上只阻塞 3 个插件**（`dsh-subagent-model` / `dsh-session-board` / `dsh-vision-adam`），
因为 `btw` / `ssh-gui` / `wallpaper` / `workerspace` 四个的**部署件在上一轮已被改造过**（源码里保留着
「0.1.7 已无 `installSettingsSection`，改用 `liveConfig()`/`cfg()`」的注释）。
**落地时必须以部署件实测为准**；若按源码树派工，会对这 4 个已修插件做重复劳动。
