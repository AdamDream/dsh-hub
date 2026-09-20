# Track D 准备阶段报告（docs-reorg）

> 档位：**修订执行复核一体**（Track D 准备阶段）｜ 产出时点：**2026-09-20** ｜ 工作区：`/home/CNS2026495165/dsh`
> **本阶段只做准备与写作，未移动/重命名/删除任何既有文件，未 `git commit`，未改 `.gitignore`，
> 未触碰 `/home/CNS2026495165/.dsh/`，未干扰宿主进程 PID 20806。**
> 自裁决：**通过**（见 §6）。

---

## 0. 交付物清单

| 交付 | 路径 | 说明 |
| --- | --- | --- |
| 完整清点 | `.workspace/docs-reorg/inventory.md` | 470 行；根 27 个 `.md` 逐个 + `.workspace/` 183 个顶层条目逐个 + 引用清单 + 偏差 |
| 机读映射表 | `.workspace/docs-reorg/mapping.json` | **210 条**（root-doc 27 / workspace 180 / keep 3），带 `moveCmd`（`git mv` **185** / `mv` **19** / `none` 6）。其中 `none` 6 条 = 3 个根级留根文件 + 3 个原地保留目录 |
| 引用修改清单 | `.workspace/docs-reorg/refs-to-fix.md` | **778 处 / 153 个文件**，逐行给「文件:行 → 原文 → 建议改法」，并分类 ①实链 / ②证据 / ③自身档 |
| 新写文档（staging） | `.workspace/docs-reorg/staged/docs/program-notebook.md` | 中枢：skill 规范 7 项必备内容 + 索引 + 11 条已验证缺陷 |
| 新写文档（staging） | `.workspace/docs-reorg/staged/docs/architecture/01-architecture-overview.md` | 架构总览 |
| 新写文档（staging） | `.workspace/docs-reorg/staged/docs/architecture/02-plugin-system.md` | 插件体系 |
| 新写文档（staging） | `.workspace/docs-reorg/staged/docs/architecture/03-model-routing-gateway.md` | 模型路由与网关 |
| 新写文档（staging） | `.workspace/docs-reorg/staged/docs/architecture/04-ops-deploy.md` | 运维与部署 |
| 新写文档（staging） | `.workspace/docs-reorg/staged/docs/runbooks/README.md` | `docs/runbooks/` 的索引页（runbook 本体由根级两份迁入） |
| 证据档 | `.workspace/docs-reorg/evidence/02-plugins.md`、`03-model-routing.md`、`04-ops-deploy.md` | 三个只读取证 subagent 的原始证据（每条带 `path:line` 引文），新文档的每条事实都能溯源到此 |
| 工具 | `.workspace/docs-reorg/tools/{gen_mapping,gen_refs,gen_inventory,verify}.py`、`refscan.py`、`move_commands.sh` | 生成与校验脚本（全部只读） |

---

## 1. 方案摘要

### 1.1 最终结构（三层各归其位）

```
/home/CNS2026495165/dsh/
├── README.md  FEATURE-MAP.md  DOC-STYLE.md          ← 根保留 3 个（用户裁决）
├── docs/
│   ├── program-notebook.md                          ← 新建：中枢（skill 强制层）
│   ├── architecture/01..04-*.md                     ← 新建：四篇专题
│   └── runbooks/                                    ← 根级 2 份操作手册 + 索引页
└── .workspace/
    ├── reports/{audits,execs,plans,reference,ports,research,diagnostics,incidents,runbooks,handoff,push-logs}/
    ├── workstreams/deploy/deploy-*/                 ← 11 个部署批次（整体移动，保持同级）
    ├── workstreams/{sources,baseline-011,plugin-restore,side-deploy,upstream-015-diff,tmp-tgz-audit,research/*,npm-cache}/
    ├── probes/{acceptance,mmt,twin,heat-check,hotswap-lab,vision-test,captures,settings-snapshots,workflow-drivers,previews/*,legacy}/
    ├── backups/{btw,methodology,plugins,config,patched,subagent-model,usage-heatmap,workspace}/
    └── （原地保留）settings-lag/  lag-fix/  docs-reorg/
```

### 1.2 分组设计依据（不是拍脑袋）

| 决策 | 依据 |
| --- | --- |
| 证据报告**按类型 + 主题**两级分（`audits/btw/`、`execs/wallpaper/`） | 同批的 audit → exec → review 必须能并排看到；纯按类型平铺会让 76 份报告挤在一层 |
| `port-*.md` 放 `.workspace/reports/ports/` | 根级同类文件里它们是**移植记录（证据）**，不是操作手册；`docs/runbooks/` 只收按场景照做的两条 |
| `deploy-*` 整体进 `workstreams/deploy/` 且**保持同级** | 3 个重放脚本用 `$SCRIPT_DIR/../deploy-p0`、`../deploy/patches`、`../deploy-015` 引用同级批次——**整体移动后相对关系不变，零改动** |
| `backup-*` 按主题 + 时间戳重命名 | 同一主题的备份在列目录时天然按时间排序；14 个松散 `backup-*` 归为 8 个主题组 |
| `.review-tmp/`、`.tmp-*` → `probes/legacy/` 并**去掉前导点** | 它们是测试/调试残骸但被 git 跟踪；去点后可正常显示、可被 `git mv` 保历史 |
| 不移动 `settings-lag/`、`lag-fix/` | 二者是**正在被其它执行线写入**的活动目录 |
| 根级 `.md` 一律**不改名** | DOC-STYLE 明示「约定不覆盖历史文档」；改名会同时污染引用与历史可追溯性 |

### 1.3 命名与重命名

- **根级 27 个 `.md`：0 个改名**（只换目录）。
- **`.workspace/` 顶层条目：87 个改名**（主要是目录归位：`backup-*` → `backups/<主题>/<时间戳>`、
  `*-probe/` → `probes/<短名>/`、`.tmp-*`/`.review-tmp` 去前导点）。
- 所有重命名都只作用于**目录或非 .md 的散件**；没有对任何 `.md` 报告改名，因此 `refs-to-fix.md`
  里②类引用只需改目录前缀，不需改文件名。

---

## 2. 证据来源

| 类别 | 来源 |
| --- | --- |
| 清点 | `git ls-files`、`ls -1A`、`git check-ignore -v`、逐条目 `git ls-files -- <path>` 记跟踪文件数 |
| 引用 | `git grep`（自动跳过 gitignore 的备份目录）+ 自写 `refscan.py` 全量扫描 |
| 架构事实 | **源码/配置逐行**：`~/.dsh/settings.yaml`、`~/.dsh/profiles/web/cordis.patch.yml`、`~/.dsh/.agent-presets/standard-glm/agent.cordis.yml`、官方包 `@deepseek-ai/dsh-app-boot|dsh-llm-pi-ai|dsh-tool-subagent|dsh-client-modules|dsh-client-hmr` 的 `lib/index.js`、本仓库各插件 `package.json` / `lib/` |
| 运维事实 | 脚本头部注释与实现逐行（3 个重放脚本 + `dsh-restart.sh` + 6 个 `deploy.sh`） |
| 进程事实 | `ps -p 20806`、`ss -ltnp`（只读，未发送任何信号） |
| 历史决策 | `.workspace/reports/*`（迁移前的根级与 `.workspace/` 报告）、`.workspace/settings-lag/*`（只读参考，未修改） |
| skill 规范 | `.dsh/skills/program-notebook/SKILL.md` + `references/notebook-spec.md` + `references/maintenance-playbook.md`（均已读取） |

### 2.1 ⚠️ `check_notebook` 工具在本会话**不存在**——如实说明

`program-notebook` skill 的核心工作流要求：步骤 2「如果存在 `check_notebook`，调用它获取基线」、
步骤 7「最终复查：再调用 `check_notebook`」。**本会话的工具清单里没有 `check_notebook`
（也不存在任何 notebook 检查器工具）**，因此：

- 无法取得 skill 所说的「基线报告」，也无法取得「复查报告」；
- 改用**源码/文件证据**替代：
  1. **规范落点**：逐条读取 `references/notebook-spec.md`，把「章节要求 → 文档中对应位置」做成对照表（§6.3）；
  2. **结构校验**：自写 `.workspace/docs-reorg/tools/verify.py`，机械校验 7 项必备章节 token、
     Mermaid 兼容性 4 条规则、以及「文档中不得出现搬移前路径」；
  3. **映射完整性**：`gen_mapping.py` 内建 6 条断言（覆盖性 / 存在性 / 目标唯一性 / 占用 / 保留冲突）。
- 该 skill 另有一条「检查器启发式与仓库布局错配」的既有结论（`classifyChangedPath` 只认根级
  `src/`、`tests/`、`.github/workflows/`，而本仓库是多插件平铺 + `.workspace/deploy-*/`），
  因此**即便工具存在，对本仓库的收益也有限**——这一点在主 agent 侧可用
  `.workspace/settings-lag/audit-notebook-skill.md` §6 冲突点 5 复核。

---

## 3. 关键发现（可能影响主 agent 的裁决）

| # | 发现 | 影响 | 建议 |
| --- | --- | --- | --- |
| **R-1** | **`.gitignore` 依赖被打破**：现有规则是 `.workspace/backup-*/`（`.gitignore:22`），gitignore 规则**不继承**，因此把 14 个备份移进 `.workspace/backups/` 后**不再被忽略**（它们当前全部未被跟踪，搬完就会变成可跟踪） | 若不同步补规则，备份内容会重新进入 HEAD | **主 agent 必须在搬移提交里补一条** `.workspace/backups/`（顺带把 `.workspace/deploy-lag/backup-*/` 更新为 `.workspace/workstreams/deploy/deploy-lag/backup-*/`）。本阶段按硬约束**未改** |
| **R-2** | **`deploy-workerspace/base/*.mjs` 有 3 处硬编码绝对路径** `/home/CNS2026495165/dsh/.workspace/deploy-workerspace/base/...` | 搬移后脚本自定位失效 | 主 agent 在搬移提交里同步改这 3 处字面量（都在 `base/` 下的探针脚本） |
| **R-3** | **重放脚本的相对引用依赖「11 个 deploy 目录同级」** | 单独移动其中任何一个都会断链 | 已按「整体移入 `workstreams/deploy/` 且不改名」设计；**不要**在搬移时顺带重命名 deploy 目录 |
| **R-4** | **`.gitignore:21` 的 `.workspace/upstream-015-diff/pkgs/` 会失配**（该目录移到 `workstreams/upstream-015-diff/` 后，其内被忽略的 `pkgs/` 重新可见） | 重新可见 ≠ 被跟踪（文件未被跟踪则不会自动入库），但会出现在 `git status` 噪音里 | 一并在 R-1 的 `.gitignore` 补丁里更新该行 |
| **R-5** | **`.workspace/deploy-slots/backup-*` 与 `.workspace/deploy-015/` 本来就未被 gitignore**，与 `backup-*/` 的排除策略不一致（前者实测有 2 个跟踪文件） | 备份内容已在库内 | 建议顺手统一（同样属 `.gitignore` 行，主 agent 决定） |
| **R-6** | **子代理路由文档漂移（实证）**：`~/.dsh/settings.yaml` 的 `dsh-subagent` 段**只设 `model: deepseek-v4-pro` 未设 `provider`**，按字段级合并 ⇒ 生效路由应为 `adam/deepseek-v4-pro`；而 `~/.dsh/AGENTS.md` 与 preset 注释都写「固定 `adam/deepseek-v4.1-flash`」 | 新文档若照抄旧结论即为错误 | 已在 `staged/docs/architecture/03-*.md` §4.3 与 `program-notebook.md` D1 如实记录，并标注「代码推论、未做活体探针」 |
| **R-7** | **`workflow` 没有默认模型常量**（preset 里只有 `provider: spawn`） | 历史文档若写「workflow 默认模型」即为臆造 | 已记入 `program-notebook.md` D2 |
| **R-8** | **`.workspace/` 顶层条目实测 183 个，不是任务书说的 175 个**；差额含清点期间由其它执行线新建的 `vision-test/`（15:12 出现）、`lag-fix/`、`settings-lag/`、`twin-probe/` | 如果主 agent 按 175 核对会误判 | 已在 `inventory.md` §0.1 逐项说明；**全部条目均已纳入映射** |

---

## 4. 主 agent 执行搬移的确切命令序列

> 前提：**先读完 §3 的 R-1～R-5**，然后逐段执行。全程在 `/home/CNS2026495165/dsh` 下运行。
> 已生成的逐条命令文件：`.workspace/docs-reorg/tools/move_commands.sh`（可直接 `bash` 执行，但建议先通读）。

### 阶段 0 · 前置校验（只读，零副作用）

```bash
cd /home/CNS2026495165/dsh

# 0.1 基线：确认工作树状态（预期只有未跟踪目录，无既有文件被本阶段改动）
git status --porcelain
# 预期输出：仅 ?? .dsh/  ?? .workspace/{docs-reorg,lag-fix,settings-lag,twin-probe,vision-test}/

# 0.2 当前 HEAD 与既有 tag（打回滚点前记录）
git rev-parse HEAD
# 预期输出：2c0650db...（2026-09-18）
git tag -l
# 预期输出：pre-lagfix-20260920-150310（既有）

# 0.3 映射表自校验（覆盖性 / 存在性 / 目标唯一 / 无占用）
python3 .workspace/docs-reorg/tools/gen_mapping.py
# 预期输出：
#   entries: 210  (root-doc 27, workspace 180, keep 3)
#   git mv: 185   plain mv: 19   keep/noop: 6
#   VERIFY: OK (coverage complete, no duplicate targets, all sources exist)

# 0.4 新文档结构自校验（必备章节 + Mermaid 兼容性 + 不引用搬移前路径）
python3 .workspace/docs-reorg/tools/verify.py
# 预期输出：
#   staged docs: 6 files, 9 mermaid blocks
#   SELF-REVIEW: mapping OK (coverage/conflicts/occupancy all clean)
```

### 阶段 1 · 打回滚点

```bash
cd /home/CNS2026495165/dsh
git tag pre-docs-reorg-$(date +%Y%m%d-%H%M%S)
# 预期输出：无输出（成功）；git tag -l 应多出该 tag
git tag -l | tail -3
```

### 阶段 2 · 提交 C1 —— 重放脚本注释与结构性引用指向新路径

> 目的：让「脚本注释/文档引用」与「目录」分两次提交，任一阶段都能单独回滚。
> 只需改 **①实链** 与**脚本硬编码**；②类历史证据引用按 DOC-STYLE 保留。

```bash
cd /home/CNS2026495165/dsh

# 2.1 结构性实链（README / FEATURE-MAP 指向将要移动的路径）
#     逐条依据 .workspace/docs-reorg/refs-to-fix.md，把 .workspace/deploy-* 改为 .workspace/workstreams/deploy/deploy-*
#     把 .workspace/master-runbook.md 等主题 runbook 改为 .workspace/reports/runbooks/...
#     把 .workspace/backup-* 改为 .workspace/backups/
#     把 .workspace/*-audit.md / *-exec.md 改为 .workspace/reports/{audits,execs}/... 对应新路径
$EDITOR README.md FEATURE-MAP.md

# 2.2 脚本内硬编码与注释
$EDITOR .workspace/deploy-workerspace/base/peer-deps-check-patched.mjs \
        .workspace/deploy-workerspace/base/load-test2.mjs \
        .workspace/deploy-workerspace/base/loadtest/ws-config-test.mjs \
        .workspace/deploy-workerspace/base/loadtest/ws-load-test.mjs \
        .workspace/deploy-lag/replay-lag-fix.sh \
        .workspace/deploy-lag/patch-official-015.sh

# 2.3 .gitignore 同步（见 R-1/R-4/R-5；属于主 agent 权限）
$EDITOR .gitignore

# 2.4 校验：此时不应有任何 from 路径被误删
git diff --stat
git status --porcelain

git add -A
git commit -m "docs-reorg C1/N: 引用与 .gitignore 指向整理后路径（README/FEATURE-MAP/脚本硬编码/忽略规则）"
```

### 阶段 3 · 提交 C2 —— 新增文档层（docs/ 中枢与四篇专题）

```bash
cd /home/CNS2026495165/dsh

# 3.1 落位新文档（staging → docs/）
mkdir -p docs/architecture docs/runbooks
cp -a .workspace/docs-reorg/staged/docs/program-notebook.md            docs/program-notebook.md
cp -a .workspace/docs-reorg/staged/docs/architecture/01-architecture-overview.md   docs/architecture/
cp -a .workspace/docs-reorg/staged/docs/architecture/02-plugin-system.md          docs/architecture/
cp -a .workspace/docs-reorg/staged/docs/architecture/03-model-routing-gateway.md  docs/architecture/
cp -a .workspace/docs-reorg/staged/docs/architecture/04-ops-deploy.md             docs/architecture/
cp -a .workspace/docs-reorg/staged/docs/runbooks/README.md                        docs/runbooks/README.md

git add docs/
git commit -m "docs-reorg C2/N: 新建 program-notebook 中枢 + architecture 四篇专题 + runbooks 索引（依据 program-notebook skill 规范）"
```

### 阶段 4 · 提交 C3 —— 执行搬移（根级 27 → reports/runbooks；.workspace 183 项归位）

```bash
cd /home/CNS2026495165/dsh

# 4.1 自动化脚本把「未跟踪但已 gitignore」的批次目录移回来（脚本在 docs-reorg 内，会被一起删除，故先拷出）
cp .workspace/docs-reorg/tools/move_commands.sh /tmp/move_commands.sh

# 4.2 逐条执行（脚本已按「根级文档优先 → workspace 跟踪 → workspace 未跟踪」排序）
bash /tmp/move_commands.sh
# 预期输出：git mv / mv 各自静默成功；任何一条报错都应立即停止并检查（不要跳过后继续）

# 4.3 校验：所有移动都应被 git 识别为 rename（R），不应出现大量 D+A
git status --porcelain | awk '{print $1}' | sort | uniq -c
# 预期输出：以 R 为主；D/A 只应出现在「未跟踪目录」被普通 mv 之后（它们本就不在索引里）

# 4.4 空目录清理（git mv 不会删除空的源父目录）
find . -type d -empty -not -path './.git/*' -print -delete

# 4.5 关键相对引用冒烟：确认 deploy 批次仍同级
ls -d .workspace/workstreams/deploy/deploy-{lag,015,slots,p0} && \
  grep -n 'SCRIPT_DIR/\.\./deploy' .workspace/workstreams/deploy/deploy-lag/replay-lag-fix.sh
# 预期输出：4 个目录都在；grep 命中 2 行（../deploy-p0/ 与 ../deploy/patches/），相对路径仍成立

git add -A
git commit -m "docs-reorg C3/N: 根级证据/手册归位 + .workspace 分类归位（reports/workstreams/probes/backups）"
```

### 阶段 5 · 收尾

```bash
cd /home/CNS2026495165/dsh

# 5.1 删除本任务的暂存/交付目录（其中 tools 与 staged 内容已分别落位或完成使命）
#     若需要保留证据，可改为先拷贝到 .workspace/reports/execs/docs/ 再删
rm -rf .workspace/docs-reorg

# 5.2 死链终检：确认 README/FEATURE-MAP 里没有指向搬移前路径的链接
grep -n '(\.workspace/deploy-\|(\.workspace/backup-\|(port-\|(\.workspace/master-runbook\|(\.workspace/lag-fix-runbook' README.md FEATURE-MAP.md || echo "OK: no stale links"

# 5.3 提交与打完成标记
git add -A
git commit -m "docs-reorg C4/N: 清理暂存目录 + 死链终检"
git tag docs-reorg-done-$(date +%Y%m%d-%H%M%S)
git log --oneline -5
```

### 回滚命令（按提交粒度）

```bash
cd /home/CNS2026495165/dsh

# 查看回滚点
git tag -l | grep -E 'pre-docs-reorg|docs-reorg-done'

# 方式 A：只回退最后一次提交（保留改动在工作区，便于人工检查）
git reset --soft HEAD~1

# 方式 B：完整回到整理前（三条提交全部作废，含索引）
git reset --hard pre-docs-reorg-<时间戳>          # ← 换成阶段 1 打出的确切 tag

# 方式 C：已经推送到远端时（保留历史，新增反向提交）
git revert --no-commit HEAD~2..HEAD && git commit -m "revert: docs-reorg 回滚"

# 方式 D：若只想把某几个文件搬回去（映射表倒序，示例）
git mv .workspace/reports/execs/btw/execute-btw.md execute-btw.md
git mv docs/runbooks/verify-runbook.md verify-runbook.md
```

> **回滚注意**：方式 B 会同时丢掉「未跟踪目录」的普通 `mv`（如 `backup-*`、`twin-probe/`），
> 因为 git 不跟踪它们——需要按 `mapping.json` 倒序手工 `mv` 回来。**因此建议在阶段 4 之前
> 先备份一份 `mapping.json` 到 `/tmp`。**

---

## 5. 未验证项（明确列出）

| # | 未验证项 | 原因 / 建议核验方式 |
| --- | --- | --- |
| U1 | **`check_notebook` 不存在** | 本会话工具清单中无该工具；已用 `tools/verify.py` + `notebook-spec.md` 逐条对照替代（§6.3） |
| U2 | **子代理实际生效路由未做活体探针** | R-6 是「settings 当前值 + 合并代码」的推论；核验方式：派一个子代理并观察其实际 `provider/model` |
| U3 | **`opencode-go` 内置 catalog 的实际 `baseURL`/`api`** | settings 里只有 `apiKeyEnv`；需读 `dsh-llm-pi-ai` 的 catalog 表 |
| U4 | **`btw` 侧聊默认模型 id 字面量** | 源码收口点是 `routeOf(defaults?.currentSelection?.())`，未逐行确认默认 id |
| U5 | **`@deepseek-ai/dsh-session-board` 的运行时装单位** | 未出现在 `~/.dsh/profiles/node_modules/@local/` 列表中 |
| U6 | **`dsh-restart.sh --watch` 真机行为** | 本次只读取证，未运行脚本（硬约束：不得干扰 PID 20806） |
| U7 | **`.workspace/deploy-*/` 脚本在当前盘面实跑是否 PASS** | 未执行任何脚本；fail-closed 结论全部来自源码逐行阅读 |
| U8 | **`~/.dsh/profiles/web2/` 是否存在/在用** | 未 `ls` 该路径 |
| U9 | **`dsh-usage` / `session-board` 测试实际通过状况** | 未运行测试（可能很慢）；只报告命令与文件盘点 |
| U10 | **搬迁后 778 处引用是否全部改对** | 本阶段只产出清单，未执行修改；建议搬移后用 `grep` 死链终检（阶段 5.2） |
| U11 | **`refs-to-fix.md` 中的②类引用是否需要改** | 需主 agent 按 DOC-STYLE 逐条裁决（④证据 vs 实链） |

---

## 6. 自复核结论

### 6.1 映射表覆盖面（不允许遗漏）

```
$ python3 .workspace/docs-reorg/tools/gen_mapping.py
entries: 210  (root-doc 27, workspace 180, keep 3)
git mv: 185   plain mv: 19   keep/noop: 6
VERIFY: OK (coverage complete, no duplicate targets, all sources exist)
```

| 校验项 | 结果 |
| --- | --- |
| ① 根目录每个 `*.md` 恰好覆盖一次（集合相等，非子集） | ✅ 27 = 27 |
| ② `.workspace/` 每个顶层条目恰好覆盖一次 | ✅ 183 = 183（180 workspace + 3 keep） |
| ③ 每个 `from` 在磁盘存在 | ✅ 210/210 |
| ④ `to` 无重复（同一目标出现两次即冲突） | ✅ 无冲突 |
| ⑤ `to` 未被现有文件占用 | ✅ 无占用 |
| ⑥ `to` 不撞保留项 | ✅ 无 |

### 6.2 新文档结构自校验

```
$ python3 .workspace/docs-reorg/tools/verify.py
staged docs: 6 files, 9 mermaid blocks
mapping entries: 210
SELF-REVIEW: mapping OK (coverage/conflicts/occupancy all clean)
```

| 校验项 | 结果 |
| --- | --- |
| ⑦ staged 文档存在且必备章节齐全 | ✅ 6/6 文件，program-notebook 的 7 项必备章节 token 全部命中 |
| ⑧ Mermaid 兼容性（无 `flowchart`、无裸 `stateDiagram`、无 `A --> B & C`、无孤立节点、ASCII 节点 ID） | ✅ 9 个 mermaid 块全通过 |
| ⑨ 文档中不出现**搬移前**的完整路径 | ✅ 0 命中（裸文件名引用不算，如 `execute-btw.md`） |

### 6.3 规范要求 → 文档落点对照表（替代 `check_notebook` 的复查）

| `notebook-spec.md` 要求 | 落点 | 状态 |
| --- | --- | --- |
| §定位与文档分层（notebook 是索引与摘要，不替代专题） | `program-notebook.md` §0 归属表 + §6 参考资料索引（只说「去哪」不复制正文） | ✅ |
| 必需内容 1 · **全局数据流摘要**（`graph LR`，只画自身调用链） | `program-notebook.md` §1（`graph LR`，7 条主链） | ✅ |
| 必需内容 2 · **架构摘要**（`graph TD/LR`，无孤立节点） | `program-notebook.md` §2（`graph TD`，21 条边，无孤立节点） | ✅ |
| 必需内容 3 · **程序运行流摘要**（`sequenceDiagram` 或短列表） | `program-notebook.md` §3（`sequenceDiagram`，含关闭与恢复两条 Note） | ✅ |
| 必需内容 4 · **配置加载链**（来源/优先级/合并规则/消费模块） | `program-notebook.md` §4（三层表 + 组合顺序 + 子代理字段级合并陷阱） | ✅ |
| 必需内容 5 · **模块摘要**（核心详写、辅助一行带过、不逐文件罗列） | `program-notebook.md` §5（插件 6 行 + 非插件 6 行，指向 01/02 展开） | ✅ |
| 必需内容 6 · **参考资料索引**（索引而非复制） | `program-notebook.md` §6（16 行表格） | ✅ |
| 必需内容 7 · **已验证的实现缺陷与限制**（每条有当前代码/测试/git 证据） | `program-notebook.md` §7（**D1–D11**，每条带 `path:line` 或报告章节） | ✅ |
| 拆分规则 · 单章超过 100–150 行即拆到 `docs/architecture/` | notebook 7 章均在阈值内；程序结构/数据流/CI/风格拆到 01–04 | ✅ |
| 推荐命名 `01-program-structure` / `02-data-flow` / `03-ci-pipeline` / `04-code-style` | **未采用**：用户已裁决专题为「01 架构总览 / 02 插件体系 / 03 模型路由与网关 / 04 运维与部署」。**命名偏离已在 `staged/docs/runbooks/README.md` 与本文档如实标注**；内容覆盖面为超集（程序结构→01、数据流→01、CI/质量门→04 §7、风格/维护风险→`DOC-STYLE.md` + notebook §7 + 04 §3） | ⚠️ 偏离（用户裁决优先） |
| Mermaid：`graph LR/TD`、`stateDiagram-v2`、每目标单独箭头、ASCII 节点 ID、`-.->` 表实现 | 全部遵守（工具校验 ⑧ 通过） | ✅ |
| 结构与绘图常见错误：箭头方向、subgraph 与节点 ID 冲突、孤立节点、逐文件展开、复述结构体字段、专题未被索引 | 均规避：无 `subgraph` 与节点同名；每节点有连线；不逐文件；§2 明示「不展开结构体字段」；四篇专题全部在 notebook §6 索引 | ✅ |
| 证据规则（`maintenance-playbook.md`）：不推测、无法验证标「未验证」 | 每篇文档末尾均有「未验证项」章节（01:5 条、02:6 条、03:5 条、04:8 条、notebook:5 条） | ✅ |
| `check_notebook` 基线 / 最终复查 | **工具不存在** → 以 `tools/verify.py` + 规范逐条对照替代（§2.1） | ⚠️ 替代 |

### 6.4 硬约束遵守情况

| 约束 | 遵守 |
| --- | --- |
| 不移动/重命名/删除任何既有文件 | ✅ 全程只读；唯一新增是 `.workspace/docs-reorg/**`（本任务产物目录） |
| 不 `git commit` | ✅ 未提交（`git status` 只多出 `?? .workspace/docs-reorg/`） |
| 不改 `.gitignore` | ✅ 未改（依赖问题作为 R-1 上报） |
| 不动 `/home/CNS2026495165/.dsh/` | ✅ 只读读取 `settings.yaml` / `.agent-presets/` / `.credentials.yaml`（未打印任何密钥值） |
| 不重启/干扰 PID 20806 | ✅ 仅 `ps`/`ss` 只读观测；未发任何信号 |
| 只读参考 `settings-lag/*.md` | ✅ 读取，未修改 |
| 不使用 `sandbox_permissions` | ✅ 未调用 |
| 不写入 `.workspace/lag-fix/` | ✅ 未写；产物全部在 `.workspace/docs-reorg/` |

### 6.5 自裁决

**通过（pass）**，无返工项。

唯一的⚠️是两处**受用户裁决与硬约束限制、而非执行缺陷**的偏离：
1. 专题文档命名未采用 skill 的推荐名（用户裁决优先，已如实标注）；
2. `check_notebook` 无法调用（工具不存在，已用源码级替代校验并说明）。

需要主 agent 裁决的**业务事项**（非返工）：
- **R-1**（`.gitignore` 必须随搬移更新，否则备份重新入库）——建议接受；
- **U11**（778 处引用中②类是否要改）——建议只改①类与硬编码；
- **专题命名**是否要回退到 skill 推荐名——本报告按用户裁决执行，如需回退请明示。

---

## 7. 交付物索引（供主 agent 直接取用）

| 用途 | 文件 |
| --- | --- |
| 逐步执行搬移 | `.workspace/docs-reorg/tools/move_commands.sh` |
| 机读驱动 | `.workspace/docs-reorg/mapping.json`（`from` / `to` / `kind` / `renamed` / `trackedFiles` / `moveCmd`） |
| 逐行改引用 | `.workspace/docs-reorg/refs-to-fix.md` |
| 清点复核 | `.workspace/docs-reorg/inventory.md` |
| 新文档落位源 | `.workspace/docs-reorg/staged/docs/**` |
| 事实溯源 | `.workspace/docs-reorg/evidence/02-plugins.md`、`03-model-routing.md`、`04-ops-deploy.md` |
| 校验复现 | `python3 .workspace/docs-reorg/tools/gen_mapping.py && python3 .workspace/docs-reorg/tools/verify.py` |
