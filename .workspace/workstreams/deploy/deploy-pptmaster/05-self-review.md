# 自复核（05-self-review）—— 修订执行复核一体档

> 逐需求核对 + 实跑验证 + 自裁决。本档不另派独立复核（用户已裁决两阶段闭环）。

## 0. 自裁决：**通过（pass）**（附 2 个待部署期注意项，非返工级问题）

---

## 1. 逐需求核对

| # | 需求 | 证据 | 判定 |
|---|---|---|---|
| ① | 装 pn1024/dsh-ppt-master skill（直拷 ~/.dsh/skills/ppt-master + pip 装 python-pptx 等） | staging `skills/ppt-master/` 从 pn1024 克隆原样拷贝（12 937 文件 / 116MB，无 .git）；`scripts/attribution_guard.py` 实跑 **exit 0**（staging 位多次复跑一致）；`install-skill.sh` 幂等 + 备份旧目录 + 部署前后双冒烟 + pip 装依赖 | ✅ |
| ② | 并行 port dsh-workbuddy-ppt 为本地插件（改名 dsh-pptmaster，确定性渲染/校验/无头预览兜底） | staging `plugin/dsh-pptmaster/` = npm tarball 0.1.0 解包 + 改名（包名/插件 id/6 工具名，见 PORT-NOTES）；node --check 全过；功能零改动 | ✅ |
| ③ | 衔接边界=工作区 .pptx + 与 btw 共用 imageDir | `03-integration.md`：约定 `{session cwd}/images/`；消费侧源码实证（workspace 包含性 + hash 绑定）；`.pptx` 落盘约定（`{safeTitle}(-rN)/{title}.pptx`）| ✅ |
| ④ | 排除 ljwei / SkillHub 付费版 / zbsph | staging 全量 grep 无 ljwei/skillhub/zbsph/ppt-studio 痕迹；peer 冲突已在 Runbook 标注 | ✅ |

## 2. 实跑验证记录（2026-09-14）

| 验证 | 命令 | 结果 |
|---|---|---|
| skill 完整性门禁 | `python3 skills/ppt-master/scripts/attribution_guard.py` | **exit 0**（staging 位） |
| guard 可执行位 | `ls -l scripts/attribution_guard.py` | `-rwxrwxr-x`（chmod +x 已设） |
| SKILL.md 元数据 | 读 frontmatter | `name: ppt-master`、`description` 齐全、kebab-case、metadata.version 6.1.0 |
| 引用文件完整 | guard 9 个 gate 文件 + LICENSE + routing.md 逐个 `-f` 检查 | 全部存在 |
| 插件语法 | `node --check lib/{index,client,invariant,pptd,runtime-staging,bin}.js` | 6/6 OK |
| 改名完整性 | 残留扫描 `ppt_scene_check` 等旧名 in `lib/`+`skills/` | **0 处**；`dsh-workbuddy-ppt` 仅剩溯源 URL/README |
| peer 核对 | profile/dsh 安装树逐包比对 | `@deepseek-ai/*@^0.1.1-rc.2`（实际 0.1.1-rc.2）✓；cordis ^4.0.1（4.0.2）✓；react ^18.2（18.3.1）✓；Node ^22.19\|\|>=24（v22.23.2）✓ |
| 运行时依赖缺口 | `for p in pptxgenjs @aiden0z/pptx-renderer typescript …` | **缺 3 个**：pptxgenjs / @aiden0z/pptx-renderer / typescript（部署期 `pnpm install` 补，见 Runbook §3.2）|
| python-pptx 实测 | staging venv（`.venv-ppt-test`）`pip install python-pptx PyYAML` → `import pptx` | **python-pptx 1.0.2 / PyYAML 6.0.3 import OK**（沙箱内 staging 试装成功；未污染系统 site） |
| 排除项 | `grep -ril ljwei\|skillhub\|zbsph\|ppt-studio`（staging） | 0 命中 |

## 3. 问题清单（均为非阻塞、部署期注意项）

1. **运行时依赖缺口（必须部署期补装）**：profile node_modules 缺 `pptxgenjs`、`@aiden0z/pptx-renderer`、`typescript`；`deploy.sh` 已含 `pnpm install` 步骤，或手工 `pnpm add`（Runbook §3.2）。**未实测** `dsh plugin --profile web add <本地路径>` 对 @local 名包的行为（涉 ~/.dsh 写入，本档禁止）；Runbook 已给手工兜底路径。
2. **btw vision 管线未落地（衔接契约待生效）**：当前 btw 0.4.0-btw.1 无 vision.ts/imageDir；`images/` 约定是面向未来 vision 管线的契约，当前即时生效的是"工作区图片资产"消费侧（详见 03-integration.md §1.1-1.2）。若 btw 后续用了不同目录名需回改（唯一耦合点）。
3. **脚本语法**：`bash -n` 两脚本通过；**未实测执行**（会写 ~/.dsh，本档禁止；由主代理部署期跑）。
4. **无头预览**：插件 `dsh-pptd screenshot`（SVG+Sharp）与 skill SVG 工作区预览未实跑（需安装后 + 运行时）；skill 侧依赖 Python 包完整安装后可用。
5. **skill 体积**：116MB/12 937 文件进 `~/.dsh/skills/` 会让 chokidar 盯一个大目录（已知项，不阻塞；首次发现/列表成本可接受）。

## 4. 验收对照（交付单元自检）

- [x] skill 部署包：staged `skills/ppt-master/`（guard exit 0、元数据齐、引用全、guard 可执行）+ `requirements.txt`（标版本）+ `install-skill.sh`（幂等+备份）
- [x] 插件 port：staged `plugin/dsh-pptmaster/`（包名 `@local/dsh-pptmaster`、插件 id `dsh-pptmaster`、工具 `pptmaster_*`、peer 核对、node --check）+ `PORT-NOTES.md` + cordis-insert 片段（Runbook §3.3）+ settings 键表（Runbook §5）
- [x] 衔接说明：`03-integration.md`（btw imageDir 共用约定 + 工作区 .pptx 落盘约定）
- [x] 部署脚本 + Runbook：`scripts/deploy.sh` + `scripts/install-skill.sh` + `04-Runbook.md`（install 顺序、验证命令、回滚）
- [x] 自复核：本节；python-pptx 已实测（venv 试装）
- [x] 报告：`pptmaster-exec.md`（见根目录）
