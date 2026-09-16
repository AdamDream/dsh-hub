# dsh-hub — 高度个人定制化的 DSH 插件工作区

> ⚠️ **本仓库是高度个人定制化版本**，不是通用发行版。
> 它是为**作者本人这台机器的 DSH 部署**逐项调优的成果：包含大量针对本机
> profile 布局、符号链接农场、特定网关（adam / opencode 中转）与个人工作流的
> 定制与补丁。**直接 clone 到别的环境大概率不能开箱即用**，部署前务必先审计
> 本文件与各目录文档。

本仓库承载三样东西：**自装插件源码**（`dsh-btw/`、`dsh-usage/`、`dsh-ssh-gui/` 等）、
**官方包补丁与重放脚本**（`.workspace/deploy-*/`）、**审计/执行/验证证据**（`.workspace/*-audit.md` / `*-exec.md`）。

## 状态

**个人基线 · PREVIEW。** 全部能力为作者本机逐项调优与实测的成果；能力状态以
[功能地图](FEATURE-MAP.md) 为准，状态均带日期。请始终让部署与它实际运行的 DSH
构建版本（当前 0.1.1-rc.2）保持一致。

| 状态标记 | 含义 |
| --- | --- |
| **已实现·实测** | 已落地部署，并在本机实测/验收过（GUI 验收矩阵或真实调用）。 |
| **已实现·未真机** | 代码与本地单测通过，但依赖真机环境的部分（串口、烧录、远端主机）未实测。 |
| **尚不可用** | 机制存在或闸门通过，但当前不可用（具名原因，如 B 通道热载未投产）。 |
| **计划中** | 当前未实现，计划后续提供。 |
| **延期** | 长期方向；不要围绕它设计（如 0.1.5 的 S15/S16 workspace UI）。 |

**诚实边界：** 本仓库**不含**通用发行版、官方包源码、任何密钥/凭据
（密钥全部在 `~/.dsh/.credentials.yaml`，永不入库）。未开放或条件性的能力
（真机串口/烧录、B 通道热载、vision 原图直传等）在[功能地图](FEATURE-MAP.md)里
如实标为「已实现·未真机 / 尚不可用 / 条件」，不当作可用功能写。

## 仓库内容

| 目录 | 说明 |
| --- | --- |
| `dsh-btw/` | btw 侧边对话插件（@local/dsh-btw）：图片经 vision-adam 转文本、侧聊跳转列表、项目总览、面板对齐、行为开关 |
| `dsh-taste/` | taste 偏好记忆插件（@deepseek-ai/dsh-taste，本地 fork/port） |
| `dsh-usage/` | API 用量统计插件（@local/dsh-usage）：面积/柱状/热力图（自绘 SVG，蓝单色系）+ 自绘 tooltip |
| `dsh-wallpaper-local/` | 壁纸插件本地 fork（@local/dsh-wallpaper，静态图版） |
| `session-board/` | 会话状态看板（@deepseek-ai/dsh-session-board） |
| `pi-taste-analysis/` | taste 条目分析工具与 pi-taste 调研文档 |
| `cc-switch-src/` | 第三方 vendored 项目（cc-switch，非自研）——已 gitignore 并移除，**不入库**（含公开 Gemini OAuth 凭据，见 git log 80ef4ec6） |
| `.workspace/` | 审计/诊断/部署产物与证据（探针、Runbook、事故记录、重放脚本、deploy-*/ 部署包等） |
| `FEATURE-MAP.md` | 功能地图：所有能力的状态与起点（插件/补丁/热载三类） |
| `DOC-STYLE.md` | 文档风格约定：未来所有 dsh-hub 文档按此写 |

## 从这里开始

| 你的情况 | 路径 |
| --- | --- |
| **第一次接触，想知道这台机器能做什么** | [功能地图 FEATURE-MAP.md](FEATURE-MAP.md)（每项带状态与入口） |
| **部署后要重启 + 验收** | [总 Runbook](.workspace/master-runbook.md) → 对应主题 Runbook（见下方索引） |
| **全局树重装后要补丁重放** | `.workspace/deploy-lag/replay-lag-fix.sh` → `patch-official-015.sh` → `patch-official-slots.sh`（先 `--dry-run` 预览） |
| **改插件/补丁代码后想生效** | 先判断冷热：插件 client bundle 替换 + 刷新浏览器即可；宿主 lib 代码 → `.workspace/deploy-lag/dsh-restart.sh` 重启 |
| **改 settings 想立即生效** | 行为开关键（dsh-usage 5 键 / dsh-btw 4 键）值级热载；schema/代码类改动需重启一次 |
| **查热载能力 / 免重启清单** | [功能地图](FEATURE-MAP.md) 热载节 · `.workspace/deploy-lag/README.md` §9（P0-a 实测固化） |
| **写插件 / 改 UI** | 参考 `@local` 先例（`dsh-usage` 手写 bundle、`dsh-workerspace` host-only、`dsh-ssh-gui` 三类传输）与对应 exec 报告 |
| **回滚** | 各补丁脚本 `--rollback`（备份在 `.workspace/backup-*`、`.workspace/deploy-*/backup-*`、`~/.dsh/backups/`） |
| **查某能力的证据与决策** | `.workspace/*-audit.md`（审计）、`.workspace/*-exec.md`（修订执行复核一体），两阶段闭环产物即证据 |

## 两条能解释大部分行为的规则

1. **补丁归脚本，进程归 dsh-restart。**
   官方包补丁一律由重放脚本管理（`replay-lag-fix.sh` / `patch-official-015.sh` /
   `patch-official-slots.sh`：备份 → 应用 → 校验 → 回滚 → 幂等，管**代码层**）；
   `dsh-restart.sh` 管**进程层**（SIGTERM 有界等待 dispose → 重启 → 冒烟 200）。
   改代码不重启不生效，重启不改代码——两者正交，标准流水线是「先跑补丁脚本，再跑 dsh-restart」。
   （来源：`.workspace/deploy-lag/README.md` §0 分工表。）

2. **配置与 UI 已热载，宿主代码改动需重启。**
   `settings.yaml` 值级热载（P0-b 实测：改行为开关键无需重启）、`cordis.patch.yml`
   条目级热载（P0-a 实测：insert/remove/disable/name/config 约 1s 生效）、插件
   client bundle 替换后刷新浏览器即生效；而改任何插件/官方包的**宿主 lib 代码**
   都是冷改动，必须 `dsh-restart.sh` 重启一次。
   （来源：`.workspace/p0a-patch-hmr-exec.md`、`.workspace/p0b-settings-switch-exec.md`、
   `.workspace/usage-tooltip-exec.md` §5 生效方式。）

## 文档分层

| 页面 | 回答什么 |
| --- | --- |
| **Tier 0 · 约定与范式** | |
| [README（本页）](README.md) | 这是什么仓库、从哪里开始、两条规则、Runbook 去哪找 |
| [DOC-STYLE.md](DOC-STYLE.md) | 未来所有 dsh-hub 文档的写作约定（归属表/状态词汇/诚实边界/导航表） |
| 方法论 | 两阶段闭环（审计 → 修订执行复核一体），见本机 `~/.dsh/AGENTS.md`（不入库） |
| **Tier 1 · 部署与验证** | |
| [总 Runbook](.workspace/master-runbook.md) | 已部署清单、六项启动修复、事故记录、验收矩阵、回滚 |
| 各主题 Runbook | 见下方「部署与验证 Runbook 索引」 |
| **Tier 2 · 能力** | |
| [功能地图 FEATURE-MAP.md](FEATURE-MAP.md) | 每个能力的状态与起点——先读这一页 |
| **Tier 3 · 参考与证据** | |
| `.workspace/*-audit.md` / `*-exec.md` | 每项能力的审计结论、交付单元、执行与自复核证据、问题清单 |

## 部署与验证 Runbook 索引（全量以这些文件为准，本页不再内嵌步骤）

> 部署前必读：① 先读对应 Runbook 再动手；② 审计各插件与补丁是否适配你的
> DSH 版本；③ 切勿把 `~/.dsh` 下的 settings/credentials/会话数据带入任何环境。

| 主题 | 入口 |
| --- | --- |
| 总 Runbook（本机基线 + 事故记录 + 验收矩阵） | [.workspace/master-runbook.md](.workspace/master-runbook.md) |
| 卡顿修复（lag-fix 5 补丁 + settings） | [.workspace/lag-fix-runbook.md](.workspace/lag-fix-runbook.md) |
| 紧急恢复合并（一次重启统一验证） | [.workspace/combined-restore-runbook.md](.workspace/combined-restore-runbook.md) |
| btw v2（图片管线/跳转/面板） | [.workspace/btw-v2-runbook.md](.workspace/btw-v2-runbook.md) |
| 分布式控制（ssh-gui v0.2.0，SSH/串口/TCP 串口） | [.workspace/deploy-ssh-gui/RUNBOOK.md](.workspace/deploy-ssh-gui/RUNBOOK.md) |
| 本地串口/烧录（workerspace，ws_serial_*/ws_flash） | [.workspace/deploy-workerspace/RUNBOOK.md](.workspace/deploy-workerspace/RUNBOOK.md) |
| ppt-master（skill + 插件） | [.workspace/deploy-pptmaster/04-Runbook.md](.workspace/deploy-pptmaster/04-Runbook.md) |
| vision-adam 识图设置页 + 能力检测 | [.workspace/deploy-vision-settings/README.md](.workspace/deploy-vision-settings/README.md) |
| 识图提示词（完整转录 + 审美分析） | [.workspace/deploy-vision-prompt/APPLY.md](.workspace/deploy-vision-prompt/APPLY.md) |
| 0.1.5 借码补丁重放（脚本 `--help` 内嵌 Runbook） | [.workspace/deploy-lag/patch-official-015.sh](.workspace/deploy-lag/patch-official-015.sh) |
| 槽位 B（sidebar.workspaces.remoteHosts） | [.workspace/deploy-slots/REPLAY.md](.workspace/deploy-slots/REPLAY.md) |
| btw P0 materialize（dsh-subagent 官方补丁） | [.workspace/deploy-p0/APPLY-P0.md](.workspace/deploy-p0/APPLY-P0.md) |
| 重启辅助（dsh-restart，`--help` 内嵌 Runbook） | [.workspace/deploy-lag/dsh-restart.sh](.workspace/deploy-lag/dsh-restart.sh) |
| 运行时热载能力（P0-a 实测固化） | [.workspace/deploy-lag/README.md](.workspace/deploy-lag/README.md) §9 |

## 运行时依赖（不在本仓库，需本机具备）

- DSH 本体（当前 0.1.1-rc.2，全局安装于 `~/.npm-global/...`；`~/.dsh/profiles/*` 为符号链接农场，**绝不对 `~/.dsh/profiles/web` 执行 npm/pnpm install**——曾致全体补丁失效，见 master-runbook §1b）
- **API 密钥全部在 `~/.dsh/.credentials.yaml`**（`ADAM_API_KEY` / `OPENCODE_GO_API_KEY` / `DEEPSEEK_API_KEY`），**永不入库**；settings.yaml 只存 `apiKeyEnv` 环境变量名
- 网关：adam（llmapi.roboscience.xyz）+ opencode 中转（opencode.ai/zen/go/v1，web 搜索与识图 vision-adam 走此）

## 方法论

- 两阶段闭环（审计 → 修订执行复核一体），详见本机 `~/.dsh/AGENTS.md`（不入库）；阶段产物（audit/exec/runbook）全部落盘 `.workspace/`，磁盘即记忆
- 模型路由：workflow/subagent/btw 统一 `adam/deepseek-v4-flash`；识图 = opencode `deepseek-v4.1-flash`（网关实测 max_tokens 上限 393216）
- 本仓库文档写作遵守 [DOC-STYLE.md](DOC-STYLE.md)
