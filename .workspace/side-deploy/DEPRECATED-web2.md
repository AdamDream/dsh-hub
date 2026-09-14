# ⚠️ DEPRECATED — web2 profile（废弃标记）

- **标记日期**：2026-09-12（支线收尾，由主代理在部署期放入本目录）
- **状态**：**已废弃 · 勿启用**
- **原因**：web2 是 **0.1.5-rc.2 升级尝试的残留 profile**（`dsh@0.1.5-rc.2`，2026-09-11 创建，
  对应 `web2/package.json` 的 `"@deepseek-ai/dsh": "0.1.5-rc.2"`）。该升级未达可运行状态后被遗弃。
  用户裁决：web2 **直接废弃**，**不再考虑 0.1.5 迁移**。
- **处置**：
  - usage 插件（`@local/dsh-usage` v0.1.0）已按「web2 同款」准备平移至 web profile
    （0.1.1-rc.2 运行位，见 `~/.dsh/profiles/node_modules/@local/dsh-usage/` 与
    `~/.dsh/profiles/web/cordis.patch.yml` 的 usage insert）；
  - 本目录保留作**只读参照**（usage 包的原始部署源仍在 `web2/node_modules/@local/dsh-usage/`）；
  - **不要**以 web2 启动 profile（如 `dsh --profile web2` / 恢复 web2 为活动 profile），
    **不要**修改本目录内容。
- **清理（可选，日后执行）**：确认 usage 已在 web profile 正常运行、且工作区
  `.workspace/side-deploy/usage/` 留存了包副本后，可整目录删除本 profile。
