# pptmaster 修订执行复核一体报告（exec）

> 阶段：修订执行复核一体（route adam/deepseek-v4-flash）。目标：按已对齐需求落地 pptmaster（skill + 插件组合）至 staging，同档自复核（自裁决 pass/rework）。
> 数据时点：2026-09-14。全部产物落 `/home/CNS2026495165/dsh/.workspace/deploy-pptmaster/`（未碰部署位 ~/.dsh）。
> 自裁决：**pass**（问题清单均为部署期注意项，非返工级）。

## 结论摘要

1. **① skill 主线（A）已 staged**：`skills/ppt-master/` = pn1024/dsh-ppt-master v6.1.0 克隆原样拷贝（12 937 文件 / 116MB，无 .git），与克隆 **diff 零差异**；`attribution_guard.py` 实跑 **exit 0**（guard 校验 LICENSE 摘要 + 9 个 gate 文件 + SKILL.md 标记行，拷贝即用）；SKILL.md `name: ppt-master`/description 齐全（DSH frontmatter 契约满足）；guard 已 chmod +x；`requirements.txt` 标版本（python-pptx>=0.6.21 核心等）；`install-skill.sh`（幂等 + 备份旧目录 + 部署前后双冒烟 + pip 装依赖 + --verify-only 模式）。
2. **② 插件辅线（B）已 staged**：`plugin/dsh-pptmaster/` = npm `dsh-workbuddy-ppt@0.1.0` tarball 解包 + **仅改名**（不改功能）：包名 `@local/dsh-pptmaster`、插件 id `dsh-pptmaster`（cordis.patch + lib name const + client module id + invariant）、6 个工具改名 `ppt_*` → `pptmaster_*`（含全部引用：index.js 32 处 / client.js 6 处 / tencent-skill.d.ts 5 处 / SKILL.md 5 处）；残留扫描旧名 **0 处**；`node --check` 6/6 通过；peer 核对全绿（@deepseek-ai 全系 0.1.1-rc.2、cordis 4.0.2、react 18.3.1、Node 22.23.2）。
3. **③ 衔接边界**：`03-integration.md` 给出与 btw 共用 imageDir 约定（`{session cwd}/images/`）与工作区 .pptx 落盘约定（`{safeTitle}(-rN)/{title}.pptx` + STORY/DESIGN/pages/resources/images）；消费侧为源码实证（workspace 包含性校验 + 字节 hash 防篡改）。
4. **④ 排除项确认**：staging 全量扫描无 ljwei / SkillHub / zbsph / ppt-studio 痕迹；ljwei peer 冲突、SkillHub 付费、zbsph 基线问题均已在 Runbook 标注不装。
5. **部署脚本 + Runbook**：`scripts/deploy.sh`（skill→插件顺序、依赖补装、cordis.patch 幂等追加、验证）、`scripts/install-skill.sh`、`04-Runbook.md`（手工步骤、验证命令、cordis-insert 片段、settings 键表 30+ 项、回滚 §6）。
6. **实测**：python-pptx **1.0.2** / PyYAML **6.0.3** 在 staging venv 试装成功并 `import` 通过（沙箱内完成，未污染系统 site）；`bash -n` 两脚本通过。

## 待部署期注意（非阻塞）

- **插件运行时依赖缺口**：profile node_modules 实测缺 `pptxgenjs` / `@aiden0z/pptx-renderer` / `typescript`，`deploy.sh`/Runbook §3.2 已给 `pnpm install` 路径（未实测执行——涉 ~/.dsh 写入，本档禁止）。
- **btw vision 管线未落地**：当前 btw 0.4.0-btw.1 无 vision.ts/imageDir（peer 会话的 vision-prompt 部署未生效）；imageDir 约定为契约待生效，当前即时生效的是工作区图片消费侧。
- 脚本/部署命令均未实测执行（本档约束只写 staging；由主代理部署期跑）。

## 产物清单（deploy-pptmaster/）

- `skills/ppt-master/`（skill 部署包，116MB）+ `requirements.txt`
- `plugin/dsh-pptmaster/`（插件 port + `PORT-NOTES.md` 改名映射）
- `scripts/install-skill.sh`、`scripts/deploy.sh`
- `03-integration.md`（btw imageDir + .pptx 衔接）、`04-Runbook.md`（含 cordis-insert 片段与 settings 键表、回滚）、`05-self-review.md`
- 证据物：`wb-src.tgz`（上游 tarball 溯源）、`.venv-ppt-test/`（python-pptx 试装实证，57MB，可删）

## 待主代理裁决/执行

1. 按 `04-Runbook.md` 执行部署（`deploy.sh --profile web` 或手工）；部署后重启 dsh web，新会话验证 `<available_skills>` 含 `ppt-master`、工具含 `pptmaster_*`。
2. 决定 Python 依赖安装形态（venv `~/.venvs/ppt-master` 推荐 / `--user`），在 Runbook 既有选项上拍板。
3. btw vision 管线落地后按 `03-integration.md` §1.2 回核对 imageDir（唯一耦合点）。
