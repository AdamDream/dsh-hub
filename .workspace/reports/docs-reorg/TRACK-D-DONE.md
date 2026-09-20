# Track D 执行完成记录（文档整理）

**执行时间**：2026-09-20 15:49~15:55 · **执行者**：主 agent
**回滚点**：`pre-docs-reorg-20260920-154951`（整理前）→ 完成 tag：`docs-reorg-done-20260920-155524`

---

## 一、结果

| 项 | 前 | 后 |
|---|---|---|
| 根目录 `.md` | **27 个** | **3 个**（`README.md` / `FEATURE-MAP.md` / `DOC-STYLE.md`） |
| `.workspace` 顶层条目 | **183 个** | **6 个**（`backups` / `lag-fix` / `probes` / `reports` / `settings-lag` / `workstreams`） |
| 新建文档 | — | `docs/program-notebook.md`（12 章节）+ `docs/architecture/01..04`（9 个 mermaid 块）+ `docs/runbooks/` |
| 搬移动作 | — | **204 条命令全部成功**（`OK=204 / SKIP=0 / FAIL=0`；其中 3 条为自映射 no-op，**有效搬移 201 条**） |
| 跟踪文件完整性 | 2229 个 | **0 丢失**（独立按内容 sha 复核：238 条原地未动、1978 条内容在新路径逐字节命中、13 条有意改写且均有新落点）；本整理**净增 661 条路径**（HEAD 2895）——"2229→2229"应读作"未丢失"而非"未新增" |
| git 历史 | — | 全部经 `git mv` 保留（`git status` 识别 1975 条 `R100` 重命名） |
| 引用修正 | — | 70+ 处（README 14 / FEATURE-MAP 26 / DOC-STYLE 4 / docs 8 / 探针脚本 14 …） |

**归位规则**（按用户第 8 轮裁决）：证据类 → `.workspace/reports/{audits,execs,plans,research,runbooks,ports,reference}/`；手册类（`port-*` / runbook）→ `docs/runbooks/`；根目录保留 3 个。

---

## 二、提交（2 次）与**与原计划的偏差**

原计划是"**移动与重命名分两次提交**"。实际改为**按关注点分两次**：

| commit | 内容 |
|---|---|
| `2ece7258` | 文档整理：搬移 + 新增 docs + `.gitignore` + 引用修正（2483 文件） |
| `7cfa1369` | 补齐根级 24 个 `.md` 的删除 + 卡顿修复工作区侧改动（dsh-usage 补丁 / restart 脚本修复 / lag-fix 产物 / skill 导入） |

**偏差理由**：搬移与重命名由生成脚本**一步执行完毕**（204 条），此时再按"移动 vs 重命名"拆两次提交，第一次提交会是一个**明知不完整的中间态**（路径已变、引用未改）。改按关注点拆分，每次提交都自洽可回滚。

**我的失误（如实登记）**：第一次提交的 pathspec 漏了**根目录级删除**，导致仓库中一度出现新旧路径并存；已在第二次提交中补齐 24 条删除并验证"每个文件只在新位置存在"。

---

## 三、执行中发现并处置的问题

| # | 问题 | 处置 |
|---|---|---|
| 1 | 生成器规则已改（`port-*` → `docs/runbooks/`），但 `tools/move_commands.sh` **未随之重生成** | 从纠正后的 `mapping.json` **重新生成**并校验（`reports/ports` 0 命中） |
| 2 | R-1：`.gitignore` **13 条路径规则**随目录重构失效（不修则 51MiB venv 与备份目录会入库） | 逐条迁移 + 新增备份/临时区/`__pycache__`/`*.pyc` 排除；用 `git check-ignore` 逐个验证 |
| 3 | 提交前发现 **738MiB 的 B2 备份 tar** 会被 `git add -A` 扫入 | 追加 `.workspace/lag-fix/backup/` 等 5 条排除规则；`git add --dry-run` 复核 0 处大体积路径 |
| 4 | 用户截图规则（`.workspace/mmt-probe/pasted-2048.png`）未随迁移 | 更新为 `.workspace/probes/mmt/pasted-2048.png` |
| 5 | **我的自动引用改写器引入了 3 处污染**：把已是正确路径里的裸文件名也替换，产生 `runbooks/runbooks/`、`/dsh/../../`、双重前缀 | 全仓扫污染模式 → 逐一修正 → 复查不可达引用 |
| 6 | 2 条引用在 **HEAD 里就不存在**（`.workspace/btw-upgrade-impl-review.md`、`.workspace/lag-fix-review.md`） | 判定为**本次之前就有的陈旧引用**，未改（登记） |
| 7 | D3（准备档上报）：`deploy-slots/backup-*` 有 **2 个文件被 git 跟踪**却无忽略规则 | **既有卫生问题**（非本次造成），未动；建议后续 `git rm --cached` + 补规则 |

---

## 四、回滚（**经独立审计更正：三种简单方案都不完整**）

审计实测结论：方案 ①/② 都不能完整回滚；方案 ③ 是唯一能覆盖的，但有独立注意事项。

| 方案 | 能覆盖什么 | 缺口（审计实测） |
|---|---|---|
| ① `git reset --hard pre-docs-reorg-20260920-154951` | 全部**跟踪**文件与 `.gitignore`（一并回到旧规则） | **不覆盖 19 条普通 `mv` 搬走的未跟踪/已忽略目录（约 41 MiB）**——它们会滞留在新路径；且丢弃此后**全部提交** |
| ② `git revert --no-commit <commits>` | 跟踪文件的逆操作 | 有未提交改动时会失败（实测）；同样**不覆盖那 19 条** |
| ③ 按 `mapping.json` 倒序 `mv` 回原位 | 唯一能覆盖 19 条未跟踪目录 | 回滚后 `.gitignore` 仍是**新规则** → 那 41 MiB 备份重新变成"可入库" |

### 推荐完整回滚步骤

```bash
cd /home/CNS2026495165/dsh
cp .workspace/reports/docs-reorg/mapping.json /tmp/mapping.json          # ① 映射表存到仓库外
git reset --hard pre-docs-reorg-20260920-154951                          # ② 跟踪文件 + .gitignore 一起回退
python3 -c "
import json, os, subprocess
m = json.load(open('/tmp/mapping.json'))
for e in reversed([x for x in m['entries'] if x.get('moveCmd') == 'mv' and x['from'] != x['to']]):
    if os.path.exists(e['to']) and not os.path.exists(e['from']):
        os.makedirs(os.path.dirname(e['from']) or '.', exist_ok=True)
        subprocess.run(['mv', e['to'], e['from']], check=False)
        print('moved back:', e['to'], '->', e['from'])
"                                                                        # ③ 补回那 19 条未跟踪目录
git status --porcelain                                                   # ④ 复核：无新旧并存
```
