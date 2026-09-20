# 本地部署 API 面 vs master 源码差异（fork 接线必读）

> 本地部署版本：@deepseek-ai/dsh **0.1.1-rc.2**（`~/.dsh/profiles/web/node_modules`，编译产物）
> master 源码：/tmp/dsh-repo（c389f96，2026-09-08，比本地新）

## 本地已存在（fork 可依赖）
- `dsh-client-ui-sidebar` —— 左侧栏（workspace/session 列表），非右侧聊天栏
- `dsh-client-ui-theme` —— `installThemeStyles(ctx)`（styles.d.ts L6）+ `ThemeService.overrideTokens`（index.d.ts L70）
- `dsh-client-ui-layout` —— 把 `ctx.theme` 快照投影到 `document.body`（theme-presenter）
- `dsh-client-ui-renderer`、`dsh-client-ui-layout`
- `dsh-client-runtime` —— 内含 slots 契约 `lib/types/client/slots.d.ts`（本地 slots 不单独成包）
- `dsh-subagent` —— `followup(parent, childId, content, options)`（index.d.ts L136）
- `dsh-tool-subagent-control` —— `ctx.subagents.followup()`
- `dsh-workspace` —— `archiveSession(sessionId)`（index.d.ts L124）
- `dsh-web` —— `ctx.web.registerSearchProvider`（index.d.ts L61）
- `dsh-agent` / `dsh-agent-loop` —— `followup(message)`
- `dsh-agent-loop` —— `ctx.agents.create(id, options?, meta?)`（index.d.ts L134，Agent 注册表 create）
- `dsh-agent` —— `createAgent(ownerCtx, options)`（index.d.ts L184）
- `dsh-session` —— `Session.create(id, seed?, header?)`（index.d.ts L154，**seed 即 fork 入口**）
- `dsh-subagent` —— `child-agent.d.ts` L39/57 引用 `ctx.agents.create()` 的 resolved options/meta

## 本地缺失（master 有、本地 0.1.1-rc.2 无）
- `dsh-client-ui-sidebar-right` —— **`ctx.sidebarRightTabs` 不存在于本地**（master 的右侧栏 tab 注册表）
- `dsh-client-ui-slots` —— 本地无此独立包（slots 契约并入 dsh-client-runtime）

## 对 fork 的含义
1. **btw 不能走 master 的 `ctx.sidebarRightTabs`**（本地没有）。应走社区插件已验证的本地可用路径：`ctx.agents.create`(fork seed) + `Agent.followup`/`ctx.subagents.followup` + `archiveSession` 隐藏子会话 + 用本地 slots 契约（dsh-client-runtime）或 portal 挂 UI。
2. **壁纸可走本地已有的** `installThemeStyles(ctx)` 注入 `<style>` + `ctx.theme.overrideTokens` / 直接覆写 `body` background。
3. 审计若以 master 为准给出 `sidebarRightTabs` 方案，需在裁决/执行阶段替换为本地可用 API。
4. 上游两个插件（@lukeknow0/dsh-side-chat、@frog755/dsh-wallpaper）本身是社区插件，装进 0.1.1-rc.2 部署时其内部调用的 API 需逐一对齐本地版本。
