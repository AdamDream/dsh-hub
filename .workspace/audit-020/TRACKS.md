# 0.2.0 迁移审计 — 31 条轨道台账

交付物统一落 `.workspace/audit-020/reports/Txx-*.md`。

| T | 名称 | 类型 | 产物 |
|---|---|---|---|
| T01 | 上游包级增量 0.1.7→0.2.0 | 审计 | T01-upstream-package-delta.md |
| T02 | CLI/profile-boot 源码增量 | 审计 | T02-cli-boot-delta.md |
| T03 | settings/schema/默认组合增量 | 审计 | T03-settings-schema-delta.md |
| T04 | 插件 API 兼容矩阵（11 插件×契约点） | 审计 | T04-plugin-api-compat.md |
| T05 | 会话代际与格式增量 | 审计 | T05-session-format-delta.md |
| T06 | cordis patch 层在 0.2.0 的可用性 | 审计 | T06-official-patch-layer-020.md |
| T07 | guard 工具链前向兼容 | 审计 | T07-guard-toolchain-forward-compat.md |
| T08 | 本地插件资产清点与源-部署对账 | 审计 | T08-local-plugin-inventory.md |
| T09 | 全新隔离根安装路径勘察 | 勘察 | T09-isolated-root-install-path.md |
| T10 | 上一轮迁移教训提炼（作战手册） | 审计 | T10-prior-migration-lessons.md |
| T11 | 技能子系统与 dsh-skill-office | 审计 | T11-skills-compat-020.md |
| T12 | 会话恢复/冷恢复/投影链 | 审计 | T12-session-resume-compat.md |
| T13 | 模型路由定制与 preset | 审计 | T13-subagent-model-routing-compat.md |
| T14 | 官方原生 vs 本机私有定制重叠 | 审计 | T14-native-vs-local-overlap-020.md |
| T15 | 官方 office 能力在 0.2.0 的形态 | 审计 | T15-office-feature-020.md |
| T16 | Web 客户端插件加载与槽位/图标 | 审计 | T16-web-client-plugin-compat.md |
| T17 | SSH/远程工作区族兼容 | 审计 | T17-ssh-remote-workspace-020.md |
| T18 | 依赖/engines/原生模块/安全面 | 审计 | T18-deps-engines-security.md |
| T19 | 可回滚迁移与备份方案 | 审计 | T19-rollback-and-backup-plan.md |
| T20 | 隔离运行 harness（unshare/端口/存活/零模型证明） | 勘察+实测 | T20-isolated-harness-verification.md |
| T21 | 会话数据面迁移与无损判据 | 审计 | T21-session-data-migration.md |
| T22 | 零模型请求下的可运行性 | 审计 | T22-zero-model-operability.md |
| T23 | office-handoff journal 兼容 | 审计 | T23-office-handoff-compat.md |
| T24 | workspace-enhancement 改造单元 | 审计 | T24-workspace-enhancement-units.md |
| T25 | 0.2.0 隔离安装与启动实测 | 执行勘察 | T25-isolated-020-boot-attempt.md |
| T26 | taste 子系统兼容 | 审计 | T26-taste-compat-020.md |
| T27 | npm 离线打包与安装闭包 | 勘察+实测 | T27-npm-offline-packaging.md |
| T28 | wallpaper/ui-theme 兼容与资源迁移 | 审计 | T28-wallpaper-theme-compat.md |
| T29 | 0.2.0 官方版本情报与破坏性变更 | 联网调研 | T29-020-release-intel.md |
| T30 | btw 客户端插件兼容与改造单元 | 审计 | T30-btw-compat-020.md |
| T31 | 文档与清单面影响盘点 | 审计 | T31-docs-impact-inventory.md |

## 阶段二（修订执行复核一体）待主代理在审计汇总后派发
