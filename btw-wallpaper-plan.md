# btw + 壁纸 功能需求与实现路线（grill-me 对齐结果）

> 状态：需求对齐完成（grill-me frontier 已空）。btw 与壁纸均已全对齐。本文件是后续三阶段审计闭环的契约基线。
> 持久目标：goal-f5524679-14b5-4f76-b8a2-3ac1ea5b0b38

## 目标
为 DSH 新增两个功能：
1. **btw** —— Web GUI 侧边只读对话面板（模型与主会话一致、可并发对话、持久化）。
2. **壁纸** —— 静态图片背景（按页面可配置 + GUI 设置面板）。

## btw（已全对齐）
- 平台：仅 Web GUI。
- 入口：会话页右侧可折叠按钮 + 侧栏面板。
- 独立只读、**不回灌**主 agent；**始终可用**（持久侧栏）。
- 工具集：读会话 + 读文件 + 联网搜索 + **完整 grill-me 技能**（可反向提问）。
- 上下文：完整只读主会话记录 + **进行中进度摘要**（以落盘为事实基准）。
- 模型：默认 = 主会话 `adam/glm-5.3`，可配置覆盖（settings.yaml 字段 + GUI 下拉）。
- 持久化：随会话保存（不受 30min 闲置清理影响）。
- **实现路线：Fork `@lukeknow0/dsh-side-chat` + 补齐三处缺口**
  1. 持久化（去掉 30 分钟闲置清理）
  2. 进行中进度摘要（原版只 fork 已完成回合前缀）
  3. 完整 grill-me / 反向提问能力（原版只读白名单未验证含问答工具）

## 壁纸（已全对齐）
- 静态图片（本地文件 / URL）。
- 全局默认 + 按页面覆盖（会话页 / 设置页 / 首页）。
- 显示：cover 铺满 + 可选暗色遮罩。
- 来源：GUI 上传（`~/.dsh/wallpapers/`）+ 绝对路径 + URL；png/jpg/webp/gif，单张 ≤10MB。
- 配置：GUI 设置面板 + 落 settings.yaml。
- 默认外观：无内置图，未设置时保持现状。
- **实现路线：Fork `@frog755/dsh-wallpaper` + 补齐缺口**（per-page 覆盖 / URL / cover+遮罩 / settings.yaml 持久化）

## 调研结论
- 官方 `deepseek-ai/deepseek-harness`：无 btw 类功能，无壁纸功能（仅 light/dark token 主题；issues 关闭、无 PR）。
- 社区：`@lukeknow0/dsh-side-chat` 最接近 btw（含四层只读策略）；`@frog755/dsh-wallpaper` 最接近壁纸（Settings 卡片 + `~/.dsh/wallpapers`）。
- btw 接线：官方 `ctx.slots` + `ui-sidebar-right` 的 `ctx.sidebarRightTabs.register`；社区 `ctx.agents.create`(fork seed) + `Agent.followup()` + `archiveSession` 隐藏子会话。
- 壁纸接线：`body { background: var(--dsw-alias-bg-base) }`（`packages/client/web/src/base.css`）；插件 `installThemeStyles(ctx)` 注入 `<style>` + `ctx.theme` + `ctx.slots` + host webserver 供媒体。

## 待办
1. 用户确认共享理解 → 进入审计。
2. 三阶段审计闭环（审计 → 修订并执行 → 复核，统一 glm-5.3）落地实现并验证。
