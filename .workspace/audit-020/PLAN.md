# 0.2.0 迁移大规模审计 — 主计划（协调者维护）

## 目标锚点
把迁移目标从 0.1.7-rc.2 改锚到 **0.2.0（npm 实际存在的 `0.2.0-rc.1`，dist-tag `next`，发布 2026-09-28T12:34:03Z）**，
在**全新隔离根**内完成源码/配置/插件/会话数据兼容迁移与端到端验证，交付可复制执行的 Runbook。

## 已核实事实（协调者实测，2026-09-29）
- 现役 3080=0.1.1-rc.2，隔离 3097=0.1.7-rc.2；两者均 LISTEN，不得作为实验场。
- `~/.dsh/profiles/web/cordis.patch.yml` sha256 `513413e7…`；`~/.dsh-017/…` `61adb8ae…`；`~/.dsh/settings.yaml` `0f19b0fe…`（活值，仅本采样时刻有效）。
- 仓库 HEAD `651b17124a76581f00f1e73ca3d152d21ccba47f`，branch `main`。
- npm dist-tags：`latest=0.1.7-rc.2`、`next=0.2.0-rc.1`、`alpha=0.1.7-alpha.2`。**无稳定 0.2.0。**
- 0.2.0-rc.1 tarball sha256 `ceb66bebe8117044e05f6932deaca15daea6a1ae1d0cffad079e33895f10d216`，integrity 见 `reports/`.
- 0.2.0-rc.1 相对 0.1.7 新增依赖：`dsh-skill-office`、`dsh-tool-subagent-control`、`dsh-workflow-ptc`（另有一批已在 0.1.7 存在）。
- 现役本地插件 9 个：dsh-btw 0.4.0-btw.1 / dsh-logfile / dsh-pptmaster / dsh-ssh-gui 0.2.0 / dsh-subagent-model / dsh-usage / dsh-wallpaper 0.5.0 / dsh-web-search-sse / dsh-workerspace。
- node v22.23.2，npm 10.9.8；npm 默认 cache 只读，必须 `npm_config_cache` 指向工作区内目录。

## 轨道（Track）清单
| T | 名称 | 阶段 | 产物 |
|---|---|---|---|
| T01 | 上游包级增量 0.1.7→0.2.0 | 审计 | reports/T01-upstream-package-delta.md |
| T02 | CLI/profile-boot 源码增量 | 审计 | reports/T02-cli-boot-delta.md |
| T03 | 配置 schema/settings 命名空间增量 | 审计 | reports/T03-settings-schema-delta.md |
| … | （见 TRACKS.md） | | |

## 纪律
- 只读审计轨道**禁止写入**工作区外的任何路径（尤其 `~/.dsh/**`、`~/.dsh-017/**`）。
- 所有轨道产物落 `.workspace/audit-020/reports/`。
- 结论必须绑定**当轮实测**的命令输出与哈希，不得复用历史轮证据。
