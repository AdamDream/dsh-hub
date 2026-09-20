# Runbook 索引（docs/runbooks）

> **Tier 1 · 部署与验证** · [指南地图](../../README.md) · [程序笔记本](../program-notebook.md)

操作手册层：**按场景照做**的步骤与预期输出。与证据层的分工是——
**结论在** `docs/architecture/04-ops-deploy.md` 与 `.workspace/reports/`，**操作在这里**。
工具机制与 fail-closed 契约不在本层重复，只给指针。

| 场景 | 入口 | 回答什么 |
| --- | --- | --- |
| 切到 web2 独立实例并验收 | [docs/runbooks/switch-web2-runbook.md](docs/runbooks/switch-web2-runbook.md) | 启动第二实例、`sleep 12` 后查日志、逐项核对 |
| 合并手工验收清单 | [docs/runbooks/verify-runbook.md](docs/runbooks/verify-runbook.md) | btw 8 步（`../../.workspace/reports/execs/btw/execute-btw.md` U10）+ 壁纸 12 步（`../../.workspace/reports/execs/wallpaper/execute-wallpaper.md` §5 U14）合并为一轮 |
| 补丁重放 / 重启 / 回滚（全局树） | `.workspace/reports/runbooks/master-runbook.md` | 部署台账、六项启动修复确认、事故记录、重启与静态核验、GUI 验收矩阵、四类回滚路径 |
| 卡顿修复专属 | `.workspace/reports/runbooks/lag-fix-runbook.md` | lag-fix 5 补丁 + settings 的部署与验证 |
| btw v2 专属 | `.workspace/reports/runbooks/btw-v2-runbook.md` | btw 升级 v2 主线部署与验收 |
| 紧急恢复合并（一次重启统一验证） | `.workspace/reports/runbooks/combined-restore-runbook.md` | 多线合并恢复 |
| 重启后批次验收 | `.workspace/reports/execs/acceptance/RESTART-ACCEPTANCE.md` | 重启验收批次（含已知红灯/黄灯） |
| 各插件部署批次 Runbook | `.workspace/workstreams/deploy/deploy-{ssh-gui,workerspace,pptmaster,vision-settings,vision-prompt,slots,p0}/` | `RUNBOOK.md` / `APPLY.md` / `REPLAY.md` / `04-Runbook.md` |

## 使用前必读（三条）

1. **改代码不重启不生效，重启不改代码**：补丁脚本管代码层，`dsh-restart.sh` 管进程层；
   标准流水线是「先跑补丁脚本，再跑 `dsh-restart`」。
2. **一切写操作先 `--dry-run`**：补丁脚本与 `dsh-restart.sh` 都支持零副作用预览；
   `patch-official-slots.sh` 更是**默认即 dry-run**，真实写入必须显式 `--apply`。
3. **绝不执行 npm/pnpm install**：对 `~/.dsh/profiles/web` 的任何 npm/pnpm install 都曾导致
   全部补丁失效（事故档见 `.workspace/reports/runbooks/master-runbook.md` §1b）。

## 未验证项

- 本索引列出的各 Runbook 的**步骤在本次整理中未被重新执行**；本页只保证路径正确与分工陈述准确。
- 历史 Runbook 中出现的运行实例 PID 可能已过期（例：某 README 记 PID 2437836，而整理时点实际
  由 PID 20806 持有 3080）。**引用 PID 必须标时点**，或改用判定法「3080 由单一进程持有 + HTTP 200
  + 旧 PID 消失」。
