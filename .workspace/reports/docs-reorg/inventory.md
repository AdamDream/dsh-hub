# Track D 整理清点（inventory）

> 生成工具：`.workspace/docs-reorg/tools/gen_mapping.py` + `tools/gen_inventory.py`（只读清点）。
> 机读映射表：[`mapping.json`](mapping.json)；引用修改清单：[`refs-to-fix.md`](refs-to-fix.md)。
> **本阶段不搬动任何既有文件**——本页只是计划。

## 0. 清点汇总

| 项 | 数量 |
| --- | --- |
| 仓库根 `*.md` | **27**（全部被 git 跟踪；`git ls-files '*.md' \| grep -v /` 实测 27） |
| `.workspace/` 顶层条目 | **183**（`ls -1A` 实测；目录 47 个） |
| 其中目录 | 47 |
| 其中文件 | 136 |
| 原地保留 | 3（`settings-lag/`、`lag-fix/`、`docs-reorg/`——均为活动目录） |
| 需 `git mv`（有跟踪文件） | 185 |
| 需普通 `mv`（无跟踪文件，多为已 gitignore） | 19 |

### 0.1 与任务书数字的差异（如实报告）

| 任务书 | 实测 | 说明 |
| --- | --- | --- |
| 根目录 27 个跟踪 .md | **27** ✅ 一致 | `git ls-files '*.md' \| grep -v /` |
| `.workspace/` 175 个顶层条目 | **183** | 清点时点较任务书晚；差额来自清点期间由其它执行线新建的目录（`vision-test/` 15:12 出现、`lag-fix/`、`settings-lag/`、`twin-probe/`），另有 `docs-reorg/` 为本任务自建。**全部已纳入映射表** |
| `backup-*` 目录 20+ 个 | **14 个** | 顶层 `backup-*` 实测 14 个；若把 `deploy-lag/` 内的 3 个与 `deploy-slots/` 内的 1 个算上共 18 个 |
| 根目录 `*.sh` | **0 个** ✅ 一致 | 脚本类硬引用风险为零；`.workspace/` 下有 18 个 `.sh` |

---

## 1. 根目录 27 个 `.md`：逐个清点

| 当前路径 | 建议目标路径 | 重命名 | 归类理由 |
| --- | --- | --- | --- |
| `audit-btw-model.md` | `.workspace/reports/audits/btw/audit-btw-model.md` | 否 | btw 模型路由审计 → 证据层 audits/btw |
| `audit-btw-subagent.md` | `.workspace/reports/audits/btw/audit-btw-subagent.md` | 否 | btw 交叉验证版审计（执行阶段以此为准）→ 证据层 audits/btw |
| `audit-btw.md` | `.workspace/reports/audits/btw/audit-btw.md` | 否 | btw 审计（已被交叉验证版取代，保留为历史）→ 证据层 audits/btw |
| `audit-local-customizations.md` | `.workspace/reports/audits/machine/audit-local-customizations.md` | 否 | 本机本地定制全清点 + 升级爆炸半径 → 证据层 audits/machine |
| `audit-subagent-arch-A.md` | `.workspace/reports/audits/subagent/audit-subagent-arch-A.md` | 否 | 子代理 worker_threads 可行性审计（A 版）→ 证据层 audits/subagent |
| `audit-subagent-arch-B.md` | `.workspace/reports/audits/subagent/audit-subagent-arch-B.md` | 否 | 同上（B 版独立审计）→ 证据层 audits/subagent |
| `audit-upstream-upgrade.md` | `.workspace/reports/audits/upstream/audit-upstream-upgrade.md` | 否 | 上游 0.1.1→0.1.5 升级审计 → 证据层 audits/upstream |
| `audit-wallpaper.md` | `.workspace/reports/audits/wallpaper/audit-wallpaper.md` | 否 | 壁纸功能审计 v2 → 证据层 audits/wallpaper |
| `execute-btw.md` | `.workspace/reports/execs/btw/execute-btw.md` | 否 | btw 修订执行（U0–U10）→ 证据层 execs/btw |
| `execution-btw-model.md` | `.workspace/reports/execs/btw/execution-btw-model.md` | 否 | btw 模型切换执行 → 证据层 execs/btw |
| `review-btw.md` | `.workspace/reports/execs/btw/review-btw.md` | 否 | btw 复核记录 → 与对应执行同目录 execs/btw（便于对照） |
| `execution-2b.md` | `.workspace/reports/execs/subagent/execution-2b.md` | 否 | ②b 非流式落盘执行记录（多份报告引用其行号）→ 证据层 execs/subagent |
| `execution-subagent-tokps.md` | `.workspace/reports/execs/subagent/execution-subagent-tokps.md` | 否 | subagent tok/s 执行 → 证据层 execs/subagent |
| `execute-wallpaper.md` | `.workspace/reports/execs/wallpaper/execute-wallpaper.md` | 否 | 壁纸修订执行 → 证据层 execs/wallpaper |
| `review-wallpaper.md` | `.workspace/reports/execs/wallpaper/review-wallpaper.md` | 否 | 壁纸复核记录 → 与对应执行同目录 execs/wallpaper |
| `btw-wallpaper-plan.md` | `.workspace/reports/plans/btw-wallpaper-plan.md` | 否 | 需求对齐契约基线（grill-me）→ 证据层 plans |
| `wiring-plan.md` | `.workspace/reports/plans/wiring-plan.md` | 否 | 接线计划 → 证据层 plans |
| `port-taste.md` | `.workspace/reports/ports/port-taste.md` | 否 | taste 移植记录 → port 家族集中放 reports/ports（避免与 docs/runbooks 混杂） |
| `port-tokps-web2.md` | `.workspace/reports/ports/port-tokps-web2.md` | 否 | tok/s web2 移植记录 → reports/ports |
| `port-vision-adam.md` | `.workspace/reports/ports/port-vision-adam.md` | 否 | vision-adam 移植记录 → reports/ports |
| `port-wallpaper.md` | `.workspace/reports/ports/port-wallpaper.md` | 否 | 壁纸移植记录 → reports/ports |
| `local-api-surface.md` | `.workspace/reports/reference/local-api-surface.md` | 否 | 本地部署 API 面 vs master 差异（fork 接线必读）→ 证据层 reference |
| `DOC-STYLE.md` | `DOC-STYLE.md` | 否 | **根保留**（用户裁决）：Tier 0 写作约定，被 README 引用 |
| `FEATURE-MAP.md` | `FEATURE-MAP.md` | 否 | **根保留**（用户裁决）：Tier 2 能力地图，被 README/DOC-STYLE 引用 |
| `README.md` | `README.md` | 否 | **根保留**（用户裁决）：人类入口/导航中枢，被 FEATURE-MAP/DOC-STYLE 与子项目引用 |
| `switch-web2-runbook.md` | `docs/runbooks/switch-web2-runbook.md` | 否 | **操作手册类**（切 web2 实例验收步骤）→ docs/runbooks/（用户裁决） |
| `verify-runbook.md` | `docs/runbooks/verify-runbook.md` | 否 | **操作手册类**（btw 8 步 + 壁纸 12 步合并验收）→ docs/runbooks/（用户裁决） |

> **未对任何根目录 `.md` 改名**（全部 `重命名=否`）：DOC-STYLE 明示「约定不覆盖历史文档」（`audit-*` / `*.exec.md` 按落盘时的档期格式保留），改名会同时污染引用与历史可追溯性。
> 根目录最终只留 3 个文件：`README.md`、`FEATURE-MAP.md`、`DOC-STYLE.md`。

---

## 2. `.workspace/` 183 个顶层条目：逐个目标位置

按目标桶分组；每一行都是一个顶层条目（无遗漏，可机读校验见 §6）。


### 2.1 `reports/audits` —— 审计证据（32 项）

| 当前路径 | 目标路径 | 重命名 | 类型 | 跟踪文件数 |
| --- | --- | --- | --- | --- |
| `.workspace/audit-a-lagfix.md` | `.workspace/reports/audits/lagfix/audit-a-lagfix.md` | 否 | 文件 | 1 |
| `.workspace/audit-b-btw.md` | `.workspace/reports/audits/btw/audit-b-btw.md` | 否 | 文件 | 1 |
| `.workspace/audit-c-usage-vision.md` | `.workspace/reports/audits/usage-vision/audit-c-usage-vision.md` | 否 | 文件 | 1 |
| `.workspace/audit-d-plugins.md` | `.workspace/reports/audits/plugins/audit-d-plugins.md` | 否 | 文件 | 1 |
| `.workspace/btw-image-pipeline-audit.md` | `.workspace/reports/audits/btw/btw-image-pipeline-audit.md` | 否 | 文件 | 1 |
| `.workspace/btw-live-stream-audit.md` | `.workspace/reports/audits/btw/btw-live-stream-audit.md` | 否 | 文件 | 1 |
| `.workspace/btw-ui-gap-audit.md` | `.workspace/reports/audits/btw/btw-ui-gap-audit.md` | 否 | 文件 | 1 |
| `.workspace/btw-upgrade-audit.md` | `.workspace/reports/audits/btw/btw-upgrade-audit.md` | 否 | 文件 | 1 |
| `.workspace/btw-upgrade-impl-audit.md` | `.workspace/reports/audits/btw/btw-upgrade-impl-audit.md` | 否 | 文件 | 1 |
| `.workspace/btw-usage-ui-audit.md` | `.workspace/reports/audits/btw/btw-usage-ui-audit.md` | 否 | 文件 | 1 |
| `.workspace/final-audit-a-patches.md` | `.workspace/reports/audits/final/final-audit-a-patches.md` | 否 | 文件 | 1 |
| `.workspace/final-audit-b-plugins.md` | `.workspace/reports/audits/final/final-audit-b-plugins.md` | 否 | 文件 | 1 |
| `.workspace/final-audit-c-config.md` | `.workspace/reports/audits/final/final-audit-c-config.md` | 否 | 文件 | 1 |
| `.workspace/final-audit-d-distributed.md` | `.workspace/reports/audits/final/final-audit-d-distributed.md` | 否 | 文件 | 1 |
| `.workspace/goal-round-gap-audit.md` | `.workspace/reports/audits/goal/goal-round-gap-audit.md` | 否 | 文件 | 1 |
| `.workspace/lag-audit-diff.md` | `.workspace/reports/audits/lagfix/lag-audit-diff.md` | 否 | 文件 | 1 |
| `.workspace/lag-audit-mechanism.md` | `.workspace/reports/audits/lagfix/lag-audit-mechanism.md` | 否 | 文件 | 1 |
| `.workspace/lag-fix-audit.md` | `.workspace/reports/audits/lagfix/lag-fix-audit.md` | 否 | 文件 | 1 |
| `.workspace/slot-mod-audit.md` | `.workspace/reports/audits/slots/slot-mod-audit.md` | 否 | 文件 | 1 |
| `.workspace/ssh-gui-audit.md` | `.workspace/reports/audits/ssh-gui/ssh-gui-audit.md` | 否 | 文件 | 1 |
| `.workspace/subagent-model-gui-audit.md` | `.workspace/reports/audits/subagent-model/subagent-model-gui-audit.md` | 否 | 文件 | 1 |
| `.workspace/upstream-015-diff.md` | `.workspace/reports/audits/upstream/upstream-015-diff.md` | 否 | 文件 | 1 |
| `.workspace/upstream-borrow-validation.md` | `.workspace/reports/audits/upstream/upstream-borrow-validation.md` | 否 | 文件 | 1 |
| `.workspace/usage-chart-audit.md` | `.workspace/reports/audits/usage/usage-chart-audit.md` | 否 | 文件 | 1 |
| `audit-btw-model.md` | `.workspace/reports/audits/btw/audit-btw-model.md` | 否 | 文件 | 1 |
| `audit-btw-subagent.md` | `.workspace/reports/audits/btw/audit-btw-subagent.md` | 否 | 文件 | 1 |
| `audit-btw.md` | `.workspace/reports/audits/btw/audit-btw.md` | 否 | 文件 | 1 |
| `audit-local-customizations.md` | `.workspace/reports/audits/machine/audit-local-customizations.md` | 否 | 文件 | 1 |
| `audit-subagent-arch-A.md` | `.workspace/reports/audits/subagent/audit-subagent-arch-A.md` | 否 | 文件 | 1 |
| `audit-subagent-arch-B.md` | `.workspace/reports/audits/subagent/audit-subagent-arch-B.md` | 否 | 文件 | 1 |
| `audit-upstream-upgrade.md` | `.workspace/reports/audits/upstream/audit-upstream-upgrade.md` | 否 | 文件 | 1 |
| `audit-wallpaper.md` | `.workspace/reports/audits/wallpaper/audit-wallpaper.md` | 否 | 文件 | 1 |

### 2.2 `reports/execs` —— 执行/复核证据（39 项）

| 当前路径 | 目标路径 | 重命名 | 类型 | 跟踪文件数 |
| --- | --- | --- | --- | --- |
| `.workspace/RESTART-ACCEPTANCE.md` | `.workspace/reports/execs/acceptance/RESTART-ACCEPTANCE.md` | 否 | 文件 | 1 |
| `.workspace/acceptance-exec.md` | `.workspace/reports/execs/acceptance/acceptance-exec.md` | 否 | 文件 | 1 |
| `.workspace/borrow-015-exec.md` | `.workspace/reports/execs/borrow-015/borrow-015-exec.md` | 否 | 文件 | 1 |
| `.workspace/borrow-015-groupA-exec.md` | `.workspace/reports/execs/borrow-015/borrow-015-groupA-exec.md` | 否 | 文件 | 1 |
| `.workspace/borrow-015-groupB-exec.md` | `.workspace/reports/execs/borrow-015/borrow-015-groupB-exec.md` | 否 | 文件 | 1 |
| `.workspace/borrow-015-groupC-exec.md` | `.workspace/reports/execs/borrow-015/borrow-015-groupC-exec.md` | 否 | 文件 | 1 |
| `.workspace/btw-model-v41-exec.md` | `.workspace/reports/execs/btw/btw-model-v41-exec.md` | 否 | 文件 | 1 |
| `.workspace/btw-p0-exec.md` | `.workspace/reports/execs/btw/btw-p0-exec.md` | 否 | 文件 | 1 |
| `.workspace/btw-ui-batch-exec.md` | `.workspace/reports/execs/btw/btw-ui-batch-exec.md` | 否 | 文件 | 1 |
| `.workspace/btw-ui-exec.md` | `.workspace/reports/execs/btw/btw-ui-exec.md` | 否 | 文件 | 1 |
| `.workspace/btw-upgrade-impl-exec-patches.md` | `.workspace/reports/execs/btw/btw-upgrade-impl-exec-patches.md` | 否 | 文件 | 1 |
| `.workspace/btw-upgrade-impl-exec.md` | `.workspace/reports/execs/btw/btw-upgrade-impl-exec.md` | 否 | 文件 | 1 |
| `.workspace/distributed-control-exec.md` | `.workspace/reports/execs/distributed/distributed-control-exec.md` | 否 | 文件 | 1 |
| `.workspace/doc-restructure-exec.md` | `.workspace/reports/execs/docs/doc-restructure-exec.md` | 否 | 文件 | 1 |
| `.workspace/goal-p0a-exec.md` | `.workspace/reports/execs/goal/goal-p0a-exec.md` | 否 | 文件 | 1 |
| `.workspace/goal-pending-subagent-exec.md` | `.workspace/reports/execs/goal/goal-pending-subagent-exec.md` | 否 | 文件 | 1 |
| `.workspace/lag-fix-exec.md` | `.workspace/reports/execs/lagfix/lag-fix-exec.md` | 否 | 文件 | 1 |
| `.workspace/lag-fix-guard.md` | `.workspace/reports/execs/lagfix/lag-fix-guard.md` | 否 | 文件 | 1 |
| `.workspace/lowrisk-fix-exec.md` | `.workspace/reports/execs/lagfix/lowrisk-fix-exec.md` | 否 | 文件 | 1 |
| `.workspace/p0a-patch-hmr-exec.md` | `.workspace/reports/execs/p0-hotload/p0a-patch-hmr-exec.md` | 否 | 文件 | 1 |
| `.workspace/p0b-settings-switch-exec.md` | `.workspace/reports/execs/p0-hotload/p0b-settings-switch-exec.md` | 否 | 文件 | 1 |
| `.workspace/p0c-restart-helper-exec.md` | `.workspace/reports/execs/p0-hotload/p0c-restart-helper-exec.md` | 否 | 文件 | 1 |
| `.workspace/p1-hotswap-gate-exec.md` | `.workspace/reports/execs/p0-hotload/p1-hotswap-gate-exec.md` | 否 | 文件 | 1 |
| `.workspace/pptmaster-exec.md` | `.workspace/reports/execs/pptmaster/pptmaster-exec.md` | 否 | 文件 | 1 |
| `.workspace/ssh-gui-exec.md` | `.workspace/reports/execs/ssh-gui/ssh-gui-exec.md` | 否 | 文件 | 1 |
| `.workspace/subagent-model-settings-exec.md` | `.workspace/reports/execs/subagent-model/subagent-model-settings-exec.md` | 否 | 文件 | 1 |
| `.workspace/usage-chart-restart-acceptance.md` | `.workspace/reports/execs/acceptance/usage-chart-restart-acceptance.md` | 否 | 文件 | 1 |
| `.workspace/usage-heatmap-exec.md` | `.workspace/reports/execs/usage/usage-heatmap-exec.md` | 否 | 文件 | 1 |
| `.workspace/usage-tooltip-exec.md` | `.workspace/reports/execs/usage/usage-tooltip-exec.md` | 否 | 文件 | 1 |
| `.workspace/vision-prompt-exec.md` | `.workspace/reports/execs/vision/vision-prompt-exec.md` | 否 | 文件 | 1 |
| `.workspace/vision-settings-capability-exec.md` | `.workspace/reports/execs/vision/vision-settings-capability-exec.md` | 否 | 文件 | 1 |
| `.workspace/workerspace-exec.md` | `.workspace/reports/execs/workerspace/workerspace-exec.md` | 否 | 文件 | 1 |
| `execute-btw.md` | `.workspace/reports/execs/btw/execute-btw.md` | 否 | 文件 | 1 |
| `execute-wallpaper.md` | `.workspace/reports/execs/wallpaper/execute-wallpaper.md` | 否 | 文件 | 1 |
| `execution-2b.md` | `.workspace/reports/execs/subagent/execution-2b.md` | 否 | 文件 | 1 |
| `execution-btw-model.md` | `.workspace/reports/execs/btw/execution-btw-model.md` | 否 | 文件 | 1 |
| `execution-subagent-tokps.md` | `.workspace/reports/execs/subagent/execution-subagent-tokps.md` | 否 | 文件 | 1 |
| `review-btw.md` | `.workspace/reports/execs/btw/review-btw.md` | 否 | 文件 | 1 |
| `review-wallpaper.md` | `.workspace/reports/execs/wallpaper/review-wallpaper.md` | 否 | 文件 | 1 |

### 2.3 `reports/plans` —— 计划与契约（3 项）

| 当前路径 | 目标路径 | 重命名 | 类型 | 跟踪文件数 |
| --- | --- | --- | --- | --- |
| `.workspace/btw-upgrade-plan.md` | `.workspace/reports/plans/btw/btw-upgrade-plan.md` | 否 | 文件 | 1 |
| `btw-wallpaper-plan.md` | `.workspace/reports/plans/btw-wallpaper-plan.md` | 否 | 文件 | 1 |
| `wiring-plan.md` | `.workspace/reports/plans/wiring-plan.md` | 否 | 文件 | 1 |

### 2.4 `reports/reference` —— 参考档（2 项）

| 当前路径 | 目标路径 | 重命名 | 类型 | 跟踪文件数 |
| --- | --- | --- | --- | --- |
| `.workspace/btw-request-images-explained.md` | `.workspace/reports/reference/btw-request-images-explained.md` | 否 | 文件 | 1 |
| `local-api-surface.md` | `.workspace/reports/reference/local-api-surface.md` | 否 | 文件 | 1 |

### 2.5 `reports/research` —— 调研（12 项）

| 当前路径 | 目标路径 | 重命名 | 类型 | 跟踪文件数 |
| --- | --- | --- | --- | --- |
| `.workspace/dsh-workerspace-research.md` | `.workspace/reports/research/dsh-workerspace-research.md` | 否 | 文件 | 1 |
| `.workspace/glm53-flash-image-smoke.md` | `.workspace/reports/research/glm53-flash-image-smoke.md` | 否 | 文件 | 1 |
| `.workspace/hotreload-a-loader.md` | `.workspace/reports/research/hotreload/hotreload-a-loader.md` | 否 | 文件 | 1 |
| `.workspace/hotreload-b-inventory.md` | `.workspace/reports/research/hotreload/hotreload-b-inventory.md` | 否 | 文件 | 1 |
| `.workspace/hotreload-c-upstream.md` | `.workspace/reports/research/hotreload/hotreload-c-upstream.md` | 否 | 文件 | 1 |
| `.workspace/hotreload-e-design.md` | `.workspace/reports/research/hotreload/hotreload-e-design.md` | 否 | 文件 | 1 |
| `.workspace/opencode-deepseek-v4-flash-probe.md` | `.workspace/reports/research/opencode-deepseek-v4-flash-probe.md` | 否 | 文件 | 1 |
| `.workspace/pptmaster-research.md` | `.workspace/reports/research/pptmaster/pptmaster-research.md` | 否 | 文件 | 1 |
| `.workspace/pptmaster-skill-research.md` | `.workspace/reports/research/pptmaster/pptmaster-skill-research.md` | 否 | 文件 | 1 |
| `.workspace/vision-exp-probe.md` | `.workspace/reports/research/vision/vision-exp-probe.md` | 否 | 文件 | 1 |
| `.workspace/vision-flash-test.md` | `.workspace/reports/research/vision/vision-flash-test.md` | 否 | 文件 | 1 |
| `.workspace/workspace-plugins-deep-research.md` | `.workspace/reports/research/workspace-plugins-deep-research.md` | 否 | 文件 | 1 |

### 2.6 `reports/diagnostics` —— 诊断（1 项）

| 当前路径 | 目标路径 | 重命名 | 类型 | 跟踪文件数 |
| --- | --- | --- | --- | --- |
| `.workspace/btw-open-p0-diagnosis.md` | `.workspace/reports/diagnostics/btw/btw-open-p0-diagnosis.md` | 否 | 文件 | 1 |

### 2.7 `reports/incidents` —— 事故（1 项）

| 当前路径 | 目标路径 | 重命名 | 类型 | 跟踪文件数 |
| --- | --- | --- | --- | --- |
| `.workspace/incident-piai-model-selection.md` | `.workspace/reports/incidents/incident-piai-model-selection.md` | 否 | 文件 | 1 |

### 2.8 `reports/runbooks` —— 主题 Runbook（证据层）（4 项）

| 当前路径 | 目标路径 | 重命名 | 类型 | 跟踪文件数 |
| --- | --- | --- | --- | --- |
| `.workspace/btw-v2-runbook.md` | `.workspace/reports/runbooks/btw-v2-runbook.md` | 否 | 文件 | 1 |
| `.workspace/combined-restore-runbook.md` | `.workspace/reports/runbooks/combined-restore-runbook.md` | 否 | 文件 | 1 |
| `.workspace/lag-fix-runbook.md` | `.workspace/reports/runbooks/lag-fix-runbook.md` | 否 | 文件 | 1 |
| `.workspace/master-runbook.md` | `.workspace/reports/runbooks/master-runbook.md` | 否 | 文件 | 1 |

### 2.9 `reports/ports` —— 移植记录（4 项）

| 当前路径 | 目标路径 | 重命名 | 类型 | 跟踪文件数 |
| --- | --- | --- | --- | --- |
| `port-taste.md` | `.workspace/reports/ports/port-taste.md` | 否 | 文件 | 1 |
| `port-tokps-web2.md` | `.workspace/reports/ports/port-tokps-web2.md` | 否 | 文件 | 1 |
| `port-vision-adam.md` | `.workspace/reports/ports/port-vision-adam.md` | 否 | 文件 | 1 |
| `port-wallpaper.md` | `.workspace/reports/ports/port-wallpaper.md` | 否 | 文件 | 1 |

### 2.10 `reports/handoff` —— 交接（1 项）

| 当前路径 | 目标路径 | 重命名 | 类型 | 跟踪文件数 |
| --- | --- | --- | --- | --- |
| `.workspace/NEXT_SESSION_PROMPT.txt` | `.workspace/reports/handoff/NEXT_SESSION_PROMPT.txt` | 否 | 文件 | 1 |

### 2.11 `reports/push-logs` —— 推送日志（2 项）

| 当前路径 | 目标路径 | 重命名 | 类型 | 跟踪文件数 |
| --- | --- | --- | --- | --- |
| `.workspace/push-log.txt` | `.workspace/reports/push-logs/push-log.txt` | 否 | 文件 | 1 |
| `.workspace/push-log2.txt` | `.workspace/reports/push-logs/push-log2.txt` | 否 | 文件 | 1 |

### 2.12 `probes` —— 探针/一次性产物（63 项）

| 当前路径 | 目标路径 | 重命名 | 类型 | 跟踪文件数 |
| --- | --- | --- | --- | --- |
| `.workspace/.review-tmp` | `.workspace/probes/legacy/review-tmp` | 是 | 目录 | 17 |
| `.workspace/.tmp-boot3080-plugin-restore.html` | `.workspace/probes/legacy/tmp-boot3080-plugin-restore.html` | 是 | 文件 | 1 |
| `.workspace/.tmp-boot3080.html` | `.workspace/probes/legacy/tmp-boot3080.html` | 是 | 文件 | 1 |
| `.workspace/.tmp-cordis.js` | `.workspace/probes/legacy/tmp-cordis.js` | 是 | 文件 | 1 |
| `.workspace/.tmp-inventory.js` | `.workspace/probes/legacy/tmp-inventory.js` | 是 | 文件 | 1 |
| `.workspace/acceptance-probe` | `.workspace/probes/acceptance` | 是 | 目录 | 16 |
| `.workspace/btw-ui-previews` | `.workspace/probes/previews/btw-ui` | 是 | 目录 | 3 |
| `.workspace/btw-wf-v2.cjs` | `.workspace/probes/workflow-drivers/btw-wf-v2.cjs` | 否 | 文件 | 1 |
| `.workspace/btw-wf-v2.mjs` | `.workspace/probes/workflow-drivers/btw-wf-v2.mjs` | 否 | 文件 | 1 |
| `.workspace/diag-piai-route.mjs` | `.workspace/probes/workflow-drivers/diag-piai-route.mjs` | 否 | 文件 | 1 |
| `.workspace/diag-settings-config.mjs` | `.workspace/probes/workflow-drivers/diag-settings-config.mjs` | 否 | 文件 | 1 |
| `.workspace/dsh-index.html` | `.workspace/probes/legacy/dsh-index.html` | 否 | 文件 | 1 |
| `.workspace/glm53_image.json` | `.workspace/probes/captures/glm53_image.json` | 否 | 文件 | 1 |
| `.workspace/glm53_text.json` | `.workspace/probes/captures/glm53_text.json` | 否 | 文件 | 1 |
| `.workspace/heat-check` | `.workspace/probes/heat-check` | 否 | 目录 | 5 |
| `.workspace/lag-fix-wf.mjs` | `.workspace/probes/workflow-drivers/lag-fix-wf.mjs` | 否 | 文件 | 1 |
| `.workspace/mmt-probe` | `.workspace/probes/mmt` | 是 | 目录 | 20 |
| `.workspace/models_fresh.json` | `.workspace/probes/captures/models_fresh.json` | 否 | 文件 | 1 |
| `.workspace/models_list.json` | `.workspace/probes/captures/models_list.json` | 否 | 文件 | 1 |
| `.workspace/oc_models.json` | `.workspace/probes/captures/oc_models.json` | 否 | 文件 | 1 |
| `.workspace/oc_models_v41_probe.json` | `.workspace/probes/captures/oc_models_v41_probe.json` | 否 | 文件 | 1 |
| `.workspace/oc_req_v41_image.json` | `.workspace/probes/captures/oc_req_v41_image.json` | 否 | 文件 | 1 |
| `.workspace/oc_req_v41_text.json` | `.workspace/probes/captures/oc_req_v41_text.json` | 否 | 文件 | 1 |
| `.workspace/oc_req_vexp2_image.json` | `.workspace/probes/captures/oc_req_vexp2_image.json` | 否 | 文件 | 1 |
| `.workspace/oc_req_vexp_image.json` | `.workspace/probes/captures/oc_req_vexp_image.json` | 否 | 文件 | 1 |
| `.workspace/oc_req_vexp_text.json` | `.workspace/probes/captures/oc_req_vexp_text.json` | 否 | 文件 | 1 |
| `.workspace/oc_resp_v41_image.json` | `.workspace/probes/captures/oc_resp_v41_image.json` | 否 | 文件 | 1 |
| `.workspace/oc_resp_v41_text.json` | `.workspace/probes/captures/oc_resp_v41_text.json` | 否 | 文件 | 1 |
| `.workspace/oc_resp_vexp2_image.json` | `.workspace/probes/captures/oc_resp_vexp2_image.json` | 否 | 文件 | 1 |
| `.workspace/oc_resp_vexp_image.json` | `.workspace/probes/captures/oc_resp_vexp_image.json` | 否 | 文件 | 1 |
| `.workspace/oc_resp_vexp_text.json` | `.workspace/probes/captures/oc_resp_vexp_text.json` | 否 | 文件 | 1 |
| `.workspace/p1-hotswap-lab` | `.workspace/probes/hotswap-lab` | 是 | 目录 | 33 |
| `.workspace/req1_image.json` | `.workspace/probes/captures/req1_image.json` | 否 | 文件 | 1 |
| `.workspace/req1b_bigbudget.json` | `.workspace/probes/captures/req1b_bigbudget.json` | 否 | 文件 | 1 |
| `.workspace/req2_text.json` | `.workspace/probes/captures/req2_text.json` | 否 | 文件 | 1 |
| `.workspace/req_a_rawb64.json` | `.workspace/probes/captures/req_a_rawb64.json` | 否 | 文件 | 1 |
| `.workspace/req_b_image.json` | `.workspace/probes/captures/req_b_image.json` | 否 | 文件 | 1 |
| `.workspace/req_gem_ctrl.json` | `.workspace/probes/captures/req_gem_ctrl.json` | 否 | 文件 | 1 |
| `.workspace/req_vexp_ctrl.json` | `.workspace/probes/captures/req_vexp_ctrl.json` | 否 | 文件 | 1 |
| `.workspace/req_vexp_image.json` | `.workspace/probes/captures/req_vexp_image.json` | 否 | 文件 | 1 |
| `.workspace/req_vexp_text.json` | `.workspace/probes/captures/req_vexp_text.json` | 否 | 文件 | 1 |
| `.workspace/resp1_raw.json` | `.workspace/probes/captures/resp1_raw.json` | 否 | 文件 | 1 |
| `.workspace/resp1b.json` | `.workspace/probes/captures/resp1b.json` | 否 | 文件 | 1 |
| `.workspace/resp2_raw.json` | `.workspace/probes/captures/resp2_raw.json` | 否 | 文件 | 1 |
| `.workspace/resp_a.json` | `.workspace/probes/captures/resp_a.json` | 否 | 文件 | 1 |
| `.workspace/resp_b.json` | `.workspace/probes/captures/resp_b.json` | 否 | 文件 | 1 |
| `.workspace/resp_gem_ctrl.json` | `.workspace/probes/captures/resp_gem_ctrl.json` | 否 | 文件 | 1 |
| `.workspace/resp_vexp_ctrl.json` | `.workspace/probes/captures/resp_vexp_ctrl.json` | 否 | 文件 | 1 |
| `.workspace/resp_vexp_image.json` | `.workspace/probes/captures/resp_vexp_image.json` | 否 | 文件 | 1 |
| `.workspace/resp_vexp_text.json` | `.workspace/probes/captures/resp_vexp_text.json` | 否 | 文件 | 1 |
| `.workspace/settings-after-fix.json` | `.workspace/probes/settings-snapshots/settings-after-fix.json` | 否 | 文件 | 1 |
| `.workspace/settings-fixed-test.json` | `.workspace/probes/settings-snapshots/settings-fixed-test.json` | 否 | 文件 | 1 |
| `.workspace/settings-live-check.json` | `.workspace/probes/settings-snapshots/settings-live-check.json` | 否 | 文件 | 1 |
| `.workspace/settings-live-final.json` | `.workspace/probes/settings-snapshots/settings-live-final.json` | 否 | 文件 | 1 |
| `.workspace/settings-sim-final.json` | `.workspace/probes/settings-snapshots/settings-sim-final.json` | 否 | 文件 | 1 |
| `.workspace/settings-sim-new.json` | `.workspace/probes/settings-snapshots/settings-sim-new.json` | 否 | 文件 | 1 |
| `.workspace/settings-sim-old.json` | `.workspace/probes/settings-snapshots/settings-sim-old.json` | 否 | 文件 | 1 |
| `.workspace/settings-snapshot.json` | `.workspace/probes/settings-snapshots/settings-snapshot.json` | 否 | 文件 | 1 |
| `.workspace/twin-probe` | `.workspace/probes/twin` | 是 | 目录 | 0 |
| `.workspace/usage-tooltip-previews` | `.workspace/probes/previews/usage-tooltip` | 是 | 目录 | 10 |
| `.workspace/v4f-test.png` | `.workspace/probes/captures/v4f-test.png` | 否 | 文件 | 1 |
| `.workspace/vision-test` | `.workspace/probes/vision-test` | 是 | 目录 | 0 |
| `.workspace/workflow-2phase-template.mjs` | `.workspace/probes/workflow-drivers/workflow-2phase-template.mjs` | 否 | 文件 | 1 |

### 2.13 `backups` —— 备份（14 项）

| 当前路径 | 目标路径 | 重命名 | 类型 | 跟踪文件数 |
| --- | --- | --- | --- | --- |
| `.workspace/backup-batch-20260914-142844` | `.workspace/backups/plugins/20260914-142844-batch` | 是 | 目录 | 0 |
| `.workspace/backup-batch2-20260914-142947` | `.workspace/backups/plugins/20260914-142947-batch2` | 是 | 目录 | 0 |
| `.workspace/backup-btw-20260917-170146` | `.workspace/backups/btw/20260917-170146` | 是 | 目录 | 0 |
| `.workspace/backup-btw-20260917-172915` | `.workspace/backups/btw/20260917-172915` | 是 | 目录 | 0 |
| `.workspace/backup-btw-deploy-20260912-165932` | `.workspace/backups/btw/20260912-165932-deploy` | 是 | 目录 | 0 |
| `.workspace/backup-btw-deploy-20260912-180420-lib` | `.workspace/backups/btw/20260912-180420-deploy-lib` | 是 | 目录 | 0 |
| `.workspace/backup-config` | `.workspace/backups/config` | 否 | 目录 | 0 |
| `.workspace/backup-methodology-20260912-164548` | `.workspace/backups/methodology/20260912-164548` | 是 | 目录 | 0 |
| `.workspace/backup-methodology-20260912-164933` | `.workspace/backups/methodology/20260912-164933` | 是 | 目录 | 0 |
| `.workspace/backup-patched` | `.workspace/backups/patched` | 否 | 目录 | 0 |
| `.workspace/backup-plugins` | `.workspace/backups/plugins/plugins` | 是 | 目录 | 0 |
| `.workspace/backup-subagent-model-20260917-165928` | `.workspace/backups/subagent-model/20260917-165928` | 是 | 目录 | 0 |
| `.workspace/backup-usage-heatmap-20260914-094352` | `.workspace/backups/usage-heatmap/20260914-094352` | 是 | 目录 | 0 |
| `.workspace/backup-ws-20260914-145449` | `.workspace/backups/workspace/20260914-145449` | 是 | 目录 | 0 |

### 2.14 `workstreams` —— 主题工作目录（24 项）

| 当前路径 | 目标路径 | 重命名 | 类型 | 跟踪文件数 |
| --- | --- | --- | --- | --- |
| `.workspace/baseline-011` | `.workspace/workstreams/baseline-011` | 否 | 目录 | 453 |
| `.workspace/deploy` | `.workspace/workstreams/deploy/deploy` | 否 | 目录 | 6 |
| `.workspace/deploy-015` | `.workspace/workstreams/deploy/deploy-015` | 否 | 目录 | 447 |
| `.workspace/deploy-lag` | `.workspace/workstreams/deploy/deploy-lag` | 否 | 目录 | 16 |
| `.workspace/deploy-p0` | `.workspace/workstreams/deploy/deploy-p0` | 否 | 目录 | 4 |
| `.workspace/deploy-pptmaster` | `.workspace/workstreams/deploy/deploy-pptmaster` | 否 | 目录 | 68 |
| `.workspace/deploy-slots` | `.workspace/workstreams/deploy/deploy-slots` | 否 | 目录 | 10 |
| `.workspace/deploy-ssh-gui` | `.workspace/workstreams/deploy/deploy-ssh-gui` | 否 | 目录 | 19 |
| `.workspace/deploy-subagent-model` | `.workspace/workstreams/deploy/deploy-subagent-model` | 否 | 目录 | 17 |
| `.workspace/deploy-vision-prompt` | `.workspace/workstreams/deploy/deploy-vision-prompt` | 否 | 目录 | 4 |
| `.workspace/deploy-vision-settings` | `.workspace/workstreams/deploy/deploy-vision-settings` | 否 | 目录 | 20 |
| `.workspace/deploy-workerspace` | `.workspace/workstreams/deploy/deploy-workerspace` | 否 | 目录 | 384 |
| `.workspace/dsh-usage-src` | `.workspace/workstreams/sources/dsh-usage-src` | 是 | 目录 | 43 |
| `.workspace/dsh-vision-adam-src` | `.workspace/workstreams/sources/dsh-vision-adam-src` | 是 | 目录 | 6 |
| `.workspace/npm-cache` | `.workspace/workstreams/npm-cache` | 否 | 目录 | 34 |
| `.workspace/plugin-restore` | `.workspace/workstreams/plugin-restore` | 否 | 目录 | 8 |
| `.workspace/repos` | `.workspace/workstreams/research/repos` | 是 | 目录 | 0 |
| `.workspace/research` | `.workspace/workstreams/research/research` | 是 | 目录 | 31 |
| `.workspace/research-dsh-workerspace` | `.workspace/workstreams/research/research-dsh-workerspace` | 是 | 目录 | 88 |
| `.workspace/research-luxweft-doc` | `.workspace/workstreams/research/research-luxweft-doc` | 是 | 目录 | 0 |
| `.workspace/side-deploy` | `.workspace/workstreams/side-deploy` | 否 | 目录 | 47 |
| `.workspace/tmp-ppt-research` | `.workspace/workstreams/research/tmp-ppt-research` | 是 | 目录 | 0 |
| `.workspace/tmp-tgz-audit` | `.workspace/workstreams/tmp-tgz-audit` | 否 | 目录 | 13 |
| `.workspace/upstream-015-diff` | `.workspace/workstreams/upstream-015-diff` | 否 | 目录 | 6 |

### 2.15 `keep` —— 原地保留（3 项）

| 当前路径 | 目标路径 | 重命名 | 类型 | 跟踪文件数 |
| --- | --- | --- | --- | --- |
| `.workspace/docs-reorg` | `.workspace/docs-reorg` | 否 | 目录 | 0 |
| `.workspace/lag-fix` | `.workspace/lag-fix` | 否 | 目录 | 0 |
| `.workspace/settings-lag` | `.workspace/settings-lag` | 否 | 目录 | 0 |

> 这三个目录是**活动工作目录**，本阶段不动：`settings-lag/`（同批审计产物的只读参考）、`lag-fix/`（另一条执行线在用）、`docs-reorg/`（本任务自身产物，主 agent 搬移完成后应删除）。

### 2.16 `` —— （1 项）

| 当前路径 | 目标路径 | 重命名 | 类型 | 跟踪文件数 |
| --- | --- | --- | --- | --- |
| `README.md` | `README.md` | 否 | 文件 | 1 |

### 2.17 `.md` —— .md（1 项）

| 当前路径 | 目标路径 | 重命名 | 类型 | 跟踪文件数 |
| --- | --- | --- | --- | --- |
| `FEATURE-MAP.md` | `FEATURE-MAP.md` | 否 | 文件 | 1 |

### 2.18 `d` —— d（1 项）

| 当前路径 | 目标路径 | 重命名 | 类型 | 跟踪文件数 |
| --- | --- | --- | --- | --- |
| `DOC-STYLE.md` | `DOC-STYLE.md` | 否 | 文件 | 1 |

### 2.19 `ks` —— ks（2 项）

| 当前路径 | 目标路径 | 重命名 | 类型 | 跟踪文件数 |
| --- | --- | --- | --- | --- |
| `switch-web2-runbook.md` | `docs/runbooks/switch-web2-runbook.md` | 否 | 文件 | 1 |
| `verify-runbook.md` | `docs/runbooks/verify-runbook.md` | 否 | 文件 | 1 |

---

## 3. `backup-*` 合并分组方案（14 个顶层 + 4 个嵌套）

分组规则：**先按主题、再按时间戳**。目录名统一为 `<主题>/<YYYYMMDD-HHMMSS>[-<后缀>]`，
使同一主题的历史备份在列目录时天然按时间排序。

| 原路径 | 新路径 | 分组依据 |
| --- | --- | --- |
| `.workspace/backup-btw-deploy-20260912-165932` | `.workspace/backups/btw/20260912-165932-deploy` | btw 插件备份 |
| `.workspace/backup-btw-deploy-20260912-180420-lib` | `.workspace/backups/btw/20260912-180420-deploy-lib` | btw 插件备份 |
| `.workspace/backup-btw-20260917-170146` | `.workspace/backups/btw/20260917-170146` | btw 插件备份 |
| `.workspace/backup-btw-20260917-172915` | `.workspace/backups/btw/20260917-172915` | btw 插件备份 |
| `.workspace/backup-config` | `.workspace/backups/config` | settings 配置备份 |
| `.workspace/backup-methodology-20260912-164548` | `.workspace/backups/methodology/20260912-164548` | 方法论/文档稿备份 |
| `.workspace/backup-methodology-20260912-164933` | `.workspace/backups/methodology/20260912-164933` | 方法论/文档稿备份 |
| `.workspace/backup-patched` | `.workspace/backups/patched` | 官方包补丁前备份 |
| `.workspace/backup-batch-20260914-142844` | `.workspace/backups/plugins/20260914-142844-batch` | 批量插件备份（batch / batch2） |
| `.workspace/backup-batch2-20260914-142947` | `.workspace/backups/plugins/20260914-142947-batch2` | 批量插件备份（batch / batch2） |
| `.workspace/backup-plugins` | `.workspace/backups/plugins/plugins` | 插件目录备份 |
| `.workspace/backup-subagent-model-20260917-165928` | `.workspace/backups/subagent-model/20260917-165928` | subagent 模型设置页备份 |
| `.workspace/backup-usage-heatmap-20260914-094352` | `.workspace/backups/usage-heatmap/20260914-094352` | usage 热力图备份 |
| `.workspace/backup-ws-20260914-145449` | `.workspace/backups/workspace/20260914-145449` | 工作区快照备份 |

**嵌套备份保持原位**（不搬入 `backups/`）：`.workspace/workstreams/deploy/deploy-lag/backup-*`（3 个，
补丁脚本按 `$BACKUP_ROOT`/`SCRIPT_DIR` 就地解析，搬走会断链）与
`.workspace/workstreams/deploy/deploy-slots/backup-*`（1 个，同理）。
它们随各自 deploy 批次整体移动，相对关系不变。

> ⚠️ **`.gitignore` 依赖已上报**：现有规则 `.workspace/backup-*/`（`.gitignore:22`）
> **不匹配**新目录名 `backups/`，因此搬移后这 14 个（当前未被跟踪的）备份会变成可跟踪状态。
> 主 agent 必须在搬移提交里同步补一条 `.workspace/backups/` 规则——本阶段按硬约束**未改** `.gitignore`。

---

## 4. 被引用位置清单（哪些文件引用了将被移动的路径）

完整逐行清单（778 处 / 153 个文件）见 [`refs-to-fix.md`](refs-to-fix.md)。这里给出**必须先处理的结构性引用**：

| 引用方 | 行 | 被引对象 | 类型 | 处置 |
| --- | --- | --- | --- | --- |
| `FEATURE-MAP.md` | 35 | `port-taste.md`、`port-wallpaper.md` | **Markdown 实链** `](port-taste.md)` | **必改**为 `.workspace/reports/ports/port-taste.md`（留在根的 FEATURE-MAP 指向会断） |
| `README.md` | 53/54/57/70/107/117/123/124/135-144/149-153 | `.workspace/deploy-lag/*`、`.workspace/deploy-*/` | **实链 + 可执行命令块** | **必改**为 `.workspace/workstreams/deploy/...`；README 的 Runbook 索引与补丁重放示例块都要改 |
| `README.md` | 43/60/117-124 | `.workspace/backup-*`、`.workspace/master-runbook.md` 等 | 实链/正文 | 备份族改 `.workspace/backups/`；总 Runbook 改 `.workspace/reports/runbooks/` |
| `FEATURE-MAP.md` | 29-46 | `.workspace/deploy-*`、`.workspace/acceptance-exec.md`、`.workspace/*-exec.md` | 实链 | 全部改新路径 |
| `docs/runbooks/switch-web2-runbook.md`（原根级） | 19 | `port-*.md` | 正文指路 | 改为 `../reports/ports/...` 或保留裸文件名（同批档） |
| `docs/runbooks/verify-runbook.md`（原根级） | 4 | `execute-btw.md`、`execute-wallpaper.md` | 正文指路 | 改为 `.workspace/reports/execs/...` |
| 根级历史审计/执行档之间 | 多行 | 同批文件 | 正文证据指认（非链接） | 按 DOC-STYLE「历史档按落盘格式保留」**可保留**；改则只改路径不改语义 |
| `.workspace/workstreams/deploy/deploy-lag/replay-lag-fix.sh` | 258 / 455 | `.workspace/deploy/patches` | 脚本内**提示文本**（非实际路径解析） | 改为 `.workspace/workstreams/deploy/deploy/patches`（文案一致性）；**实际资源解析用 `SCRIPT_DIR/../deploy/`，批次整体移动后仍成立** |
| `.workspace/workstreams/deploy/deploy-lag/patch-official-015.sh` | 25 | `.workspace/deploy-015` | 脚本内注释 | 同上，改注释即可（实际用 `P015_DIR:-$SCRIPT_DIR/../deploy-015`） |
| `.workspace/workstreams/deploy/deploy-workerspace/base/*.mjs` | 多处 | `.workspace/deploy-workerspace/base` | **硬编码绝对路径** | **必改**为新绝对路径，否则脚本自定位失效 |
| `.workspace/probes/twin/verify_twin.sh`、`probes/*/probe-*.sh` | — | 自身目录 | 相对自身 | 随目录搬走即可 |
| `settings-lag/audit-notebook-skill.md` 等只读参考档 | — | 旧路径 | 历史审计叙述 | **不改**（只读参考，且为历史档） |
| `.gitignore` | 22 / 23 | `.workspace/backup-*/`、`.workspace/deploy-lag/backup-*/` | 忽略规则 | **本阶段禁改**；主 agent 需补 `.workspace/backups/` 与 `.workspace/workstreams/deploy/deploy-lag/backup-*/` |

---

## 5. 需要主 agent 特别留意的偏差与决策点

| # | 事项 | 说明 | 建议 |
| --- | --- | --- | --- |
| A1 | **`.gitignore` 依赖** | 搬 `backup-*` → `backups/` 后原规则失配（见 §3 警告） | 在搬移提交里同步补 `.workspace/backups/`；这是本阶段被硬约束禁止、必须由主 agent 完成的一步 |
| A2 | **`docs/` 目录是新建** | 目前 `docs/`、`docs/architecture/`、`docs/runbooks/` **都不存在**（实测 ENOENT） | `git mv` 会自动创建目标父目录；`staged/docs/` 的 6 篇新文档也由主 agent 一并落到 `docs/` |
| A3 | **部署批次必须整体移动** | 3 个重放脚本用 `SCRIPT_DIR/../deploy-p0`、`../deploy/patches`、`../deploy-015` 引用同级批次 | 11 个 `deploy*` 目录**保持同级**一并移入 `workstreams/deploy/`，相对关系不变 |
| A4 | **`.workspace/deploy-015/pkgs/` 被 gitignore** | 该目录不在跟踪内，但它由 batch 内部相对引用 | 与 A3 同一提交移动，避免出现半移动状态 |
| A5 | **`deploy-workerspace/base/*.mjs` 硬编码绝对路径** | 3 处 `const root = "/home/.../.workspace/deploy-workerspace/base/..."` | 主 agent 搬移后必须同步改这 3 处字面量 |
| A6 | **`.review-tmp/` 是测试残骸** | 被跟踪 17 个文件，内容是 fake root/fakebackup 测试夹具 | 已映射到 `.workspace/probes/legacy/review-tmp/`（改名前缀去掉前导点，避免再被当隐藏目录忽略） |
| A7 | **`.tmp-*` 隐藏文件** | `.tmp-boot3080.html` / `.tmp-cordis.js` / `.tmp-inventory.js` 等为一次性调试产物但**被跟踪** | 映射到 `.workspace/probes/legacy/`（去前导点改名），`git mv` 保历史 |
| A8 | **清点期间新增目录** | `vision-test/`（15:12 出现，另一条线的视觉能力探针）、`lag-fix/`、`settings-lag/`、`twin-probe/` | 已全部纳入映射；`lag-fix/`、`settings-lag/` 标为 keep（活动目录），`twin-probe/`、`vision-test/` 归入 probes |
| A9 | **`reports/*` 无迁移前的同名冲突** | `mapping.json` 逐项校验 `to` 无重复、无占用 | 见 §6 校验输出 |
| A10 | **`refs-to-fix.md` 的 778 处引用** | 其中大量是历史证据档的正文指认（非链接） | 建议只改 **①实链** 与 **脚本硬编码**；②证据引用按 DOC-STYLE 保留 |

---

## 6. 覆盖性与冲突校验（实测输出）

```
$ python3 .workspace/docs-reorg/tools/gen_mapping.py
entries: 210  (root-doc 27, workspace 180, keep 3)
git mv: 185   plain mv: 19   keep/noop: 6
VERIFY: OK (coverage complete, no duplicate targets, all sources exist)

$ python3 .workspace/docs-reorg/tools/verify.py
staged docs: 6 files, 9 mermaid blocks
mapping entries: 210

SELF-REVIEW: mapping OK (coverage/conflicts/occupancy all clean)
```

校验项：① 根 `.md` 全覆盖且无重复；② `.workspace` 顶层全覆盖且无重复；③ 每个 `from` 在磁盘存在；
④ `to` 无重复（同一目标出现两次即冲突）；⑤ `to` 未被现有文件占用；⑥ `to` 不撞保留项；
⑦ staged 文档存在且必备章节齐全；⑧ Mermaid 兼容性；⑨ 文档中不出现搬移前路径。
