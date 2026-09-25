# session-handoff skill — 修订执行复核一体档 自复核报告（`exec.md`）

- 执行档沙箱：`workspace-write`，工作区 `/home/CNS2026495165/dsh`；**未使用** `sandbox_permissions`，**未写**任何 `~/.dsh/**`。
- 执行契约：`.workspace/session-handoff-skill/audit.md`（519 行，R1–R12 + U1–U8）；上游方案：`.workspace/session-handoff-skill/plan.md`（40 决策）。
- 事实基线（实测）：分支 `main`、HEAD `fa118d91`（与 plan.md:5 一致）。
- 落盘文件（全部在授权边界内）：

| 文件 | 行数 |
|---|---|
| `agent-skills/session-handoff/SKILL.md` | 59 |
| `agent-skills/session-handoff/references/handoff-spec.md` | 137 |
| `agent-skills/session-handoff/references/generate-playbook.md` | 198 |
| `agent-skills/session-handoff/references/resume-playbook.md` | 57 |
| `agent-skills/session-handoff/references/examples-and-pitfalls.md` | 85 |
| `.gitignore`（末尾追加 3 行块） | 103 → 106 |

- 仓库改动面（实测）：`git status --short -- .gitignore agent-skills .dsh` → `M .gitignore` + `?? agent-skills/`，**没有其他改动**。

---

## A. 交付单元逐条完成情况

| 单元 | 目标 | 状态 | 关键验收（真实输出见下） |
|---|---|---|---|
| **U1** | `SKILL.md`（8 个小节 + frontmatter 3 字段） | ✅ 完成 | `head -1` = `---`；`name: session-handoff`；camelCase 旧键 0 命中；4 个 reference 文件名各 ≥1 |
| **U2** | `references/handoff-spec.md`（13 个小节） | ✅ 完成 | `grep -c '^## '` = **13**；§0–§9 全覆盖；`bash` 片段 0 |
| **U3** | `references/generate-playbook.md`（七步 + 取证清单 + 片段 + 自检清单） | ✅ 完成 | 8 个步骤标题（含 1.5）；5 个 `bash` 块**逐个 `bash -n` OK**；`100` 仅 1 行 |
| **U4** | `references/resume-playbook.md`（六步 + 闸门 + 复述模板 + 回写规则 + 禁止事项） | ✅ 完成 | 6 个编号步骤 + 5 个 `##`；`bash` 片段 0；复述模板含 5 项验收 4 对齐词 |
| **U5** | `references/examples-and-pitfalls.md`（两骨架 + 差异 + 反例清单 + 纪律 + 边界） | ✅ 完成 | §0–§9 十个编号词齐全；反例 **8 条**；`repo1` 命中 **0**；`未找到` 5 行 |
| **U6** | `.gitignore` 追加 `.dsh/handoffs/` | ✅ 完成 | `git check-ignore -v` 退出 **0**；`git diff --numstat` = `3 0` |
| **U7** | `SKILL.md` 内 `## 副本与同步`（**非**独立文件） | ✅ 完成 | 小节恰 1 个；含权威副本路径 / `手工同步` / `version` |
| **U8** | `~/.dsh/AGENTS.md` 增补 | ⛔ **不在本档写入边界**（工作区外，沙箱不可写）→ 由主代理提权执行；本档已为 U8 准备好产出依据（产物位置与命名以 U1/U2 为准） |

---

## B. 每条验收的真实命令与输出

### B1. R3 / U1：frontmatter 首行与字段

```
$ head -1 agent-skills/session-handoff/SKILL.md
---
$ awk 'NR==1{exit !($0=="---")}' agent-skills/session-handoff/SKILL.md ; echo $?
0
$ sed -n '1,9p' SKILL.md | grep -nE '^[a-zA-Z_-]+:'
2:name: session-handoff
3:description: "把当前会话的工作内容…历史归档于 .dsh/handoffs/。"
4:metadata:
$ grep -nE '^(disableModelInvocation|modelInvocable|userInvocable):' SKILL.md ; echo $?
1                      # 空 = 通过（这 3 个 camelCase 旧键会 throw 并丢弃整份技能）
$ grep -n '^name:' SKILL.md
2:name: session-handoff
```

frontmatter **只含** `name` / `description` / `metadata` 三个字段（`description` + `metadata` 下的 `version`/`author`/`updated`）；**未加** `allowed-tools` / `license` / `whenToUse` / `disable-model-invocation`。
四个 reference 文件名在正文各命中：`handoff-spec.md`=2、`generate-playbook.md`=2、`resume-playbook.md`=2、`examples-and-pitfalls.md`=1。

### B2. R1：`description` 按 DSH 语义实测（**不用 `wc -c`**）

```
$ DESC=$(node -e '…从 SKILL.md 抽取 description 值并 JSON 编码…')
$ node .workspace/session-handoff-skill/measure-desc.mjs "$DESC"
--- 候选1: len=257 ✅合格
   wc -m(字符)=257  wc -c(字节)=613
```

- 归一化（`replaceAll(/\s+/g," ")` + `trim()`）后 **257 字符 ≤ 497（有效上限）/ ≤500（硬判据）**，**未触发** `slice(0,497)+"..."`。
- 对照：同一串 `wc -c` = **613 字节** —— 证实审计 R1 的假阴性陷阱（若按 `wc -c` 判会误报超限）。本档**未用 `wc -c` 作判据**。
- 采用审计 B3 候选 A 全文，未裁剪。

### B3. 脚本实测（`check-sections.sh` + `probe-reachability.sh`）

**（1）`check-sections.sh` —— 合规交接示例（本档按 v1 契约现写的冒烟件，含 §0–§9 与真实路径）**

```
$ bash .workspace/session-handoff-skill/check-sections.sh /tmp/smoke/EXAMPLE_smoke_NEXT_SESSION_PROMPT.md
sections found: 0 1 2 3 4 5 6 7 8 9
budget(§0-§5+§9) counted=28 limit=100 PASS
SECTIONS: PASS
exit=0
```

**（2）`check-sections.sh` —— 故意缺 §2/§4/§5 的坏例（验证真能查错，不是恒绿）**

```
sections found: 0 1 3
MISSING SECTION: §2
MISSING SECTION: §4
MISSING SECTION: §5
MISSING SECTION: §9
budget(§0-§5+§9) counted=5 limit=100 PASS
SECTIONS: FAIL
exit=1
```

**（3）空壳小节检查（审计片段 c）**

```
坏例：EMPTY SECTION: ## §1 事实基线 → EMPTY-CHECK DONE
合规示例：EMPTY-CHECK DONE          # 无 EMPTY SECTION 行
```

**（4）`probe-reachability.sh` —— 对四份 references 实跑（**0 不可达**）**

```
$ bash .workspace/session-handoff-skill/probe-reachability.sh agent-skills/session-handoff/references/handoff-spec.md
repo_root=/home/CNS2026495165/dsh
--- checked=1 missing=0
REACHABILITY: PASS        exit=0
$ … references/generate-playbook.md
repo_root=/home/CNS2026495165/dsh
--- checked=2 missing=0
REACHABILITY: PASS        exit=0
$ … references/resume-playbook.md
--- checked=1 missing=0    REACHABILITY: PASS   exit=0
$ … references/examples-and-pitfalls.md
--- checked=6 missing=0    REACHABILITY: PASS   exit=0
```

**（5）`probe-reachability.sh` —— 对 `SKILL.md` 实跑：1 处 MISSING，为**预期中的真实缺口**

```
$ bash .workspace/session-handoff-skill/probe-reachability.sh agent-skills/session-handoff/SKILL.md
repo_root=/home/CNS2026495165/dsh
MISSING: ~/.dsh/skills/session-handoff
--- checked=3 missing=1
REACHABILITY: FAIL        exit=1
```

这是**真 TRUE POSITIVE**：权威副本目录此刻确实不存在（`ls -d ~/.dsh/skills/session-handoff` → `没有那个文件或目录`），由主代理提权拷贝后才存在。该路径是决策 3/4 与 U7 要求必须写出的声明，**不构成缺陷**；主代理拷贝后重跑即为 PASS。

**（6）探针 fail-closed 行为（仓库外文档）**

```
$ bash probe-reachability.sh /tmp/smoke/EXAMPLE_smoke_NEXT_SESSION_PROMPT.md
FATAL: not inside a git repo: /tmp/smoke/EXAMPLE_smoke_NEXT_SESSION_PROMPT.md
exit=2
```

**（7）开发中自查抓到并已修的 2 处假 MISSING（本档真跑发现的真问题）**

首次对 `generate-playbook.md` 跑探针得到 `checked=4 missing=2`，两条均为**假 MISSING**——原因是该文件在「必须遵守的写法」里**逐字写出了两个 bug 的错误输出串**（`docs/program-notebook`（无 `.md`）与 `.workspace/backup-`（被 `*` 断词）），探针把它们当成被引用路径。已改写为**描述性表述**（不含那两个裸串），重跑得 `checked=2 missing=0 REACHABILITY: PASS`。
⇒ 结论：**文档里举例写「错误路径串」会污染自己的可达性自检**，这本身是该 skill 使用者要知道的坑（本文件已在「三条必须遵守的写法」保留其原理表述）。

### B4. U3：四个嵌入片段逐一 `bash -n`

```
$ awk '…按 ```bash 切块抽出…' references/generate-playbook.md
  block1.sh: bash -n OK
  block2.sh: bash -n OK
  block3.sh: bash -n OK
  block4.sh: bash -n OK
  block5.sh: bash -n OK
```

（block1 = 通用可达性脚本全文；block2 = `check-sections.sh` 全文；block3 = 可达性调用；block4 = 空壳 awk；block5 = 归档裁剪。）

### B5. U2 / U3 / U4 / U5 逐条判据（一次批量实跑）

```
===== U2 handoff-spec =====
^## 计数: 13
  kw[归档]=10  kw[勘误]=3  kw[编号契约]=2  kw[篇幅预算]=2  kw[前缀命名]=2  kw[聚焦模式]=2
  kw[§0 与 §9]=2  kw[自指]=2
  §0=10 §1=7 §2=2 §3=3 §4=3 §5=3 §6=7 §7=3 §8=5 §9=9      # 0–9 全覆盖
  "20"=2   "100"=1   "resume-playbook.md"=2   bash块=0

===== U3 generate-playbook =====
  步骤=12  1.5=1  mkdir -p .dsh/handoffs=1  聚焦模式=5  bash块=5  "100"=1

===== U4 resume-playbook =====
  列表/标题=16  实跑核对=2  勘误=4  复述=3  闸门=6  bash块=0
  模板词 repo_root=2  git_head=3  歧义=3

===== U5 examples-and-pitfalls =====
  §N 关键词数=10   §0..§9 各≥1=0123456789   粘贴这段=1   勿凭记忆=1
  research/competitor 行数=8   清单条数=8   repo1=0   未找到=5
```

全部满足（U2 要求 ≥13 节 / §0–§9 齐 / `20` 与 `100` 各 ≥1 / 引用 `resume-playbook.md` / `bash` 块 0；U3 要求 `步骤` ≥7 且含 `1.5` / `bash` 块 ≥4 / 含 `mkdir -p .dsh/handoffs` 与「聚焦模式」/ `100` ≤2；U4 要求 ≥6 且关键词齐 / `bash` 块 0；U5 要求 §0–§9 / 两条历史件关键词 / ≥7 条反例 / `repo1`=0 / 含「未找到」）。

### B6. U6：`.gitignore`

```
$ tail -3 .gitignore

# 交接文档历史归档（2026-09-25 session-handoff skill 决策 6）：只保留最近 20 份
.dsh/handoffs/
$ git check-ignore -v .dsh/handoffs/x.md
.gitignore:106:.dsh/handoffs/	.dsh/handoffs/x.md
exit=0                                   # 增补前实测为 exit=1（未被忽略）→ 修复生效
$ grep -c '^\.dsh/handoffs/$' .gitignore
1
$ git diff --numstat -- .gitignore
3	0	.gitignore                      # 仅新增 3 行、0 删除
```

未添加仓库根 `<前缀>_NEXT_SESSION_PROMPT.md` 的忽略规则（R12：plan 未授权），也未添加 `agent-skills/`。

### B7. U7：`副本与同步` 小节（R2）

```
$ grep -c '^## 副本与同步$' agent-skills/session-handoff/SKILL.md
1
$ grep -c '~/.dsh/skills/session-handoff/' SKILL.md   # 1
$ grep -c '手工同步' SKILL.md                          # 1
$ grep -c 'version' SKILL.md                          # 2（小节内 version: 1.0.0 + 说明）
```

声明写在 **SKILL.md 正文**（frontmatter 之后），**未新建任何仅快照才有的文件/字节** ⇒ 与验收 5 的 SHA-256 一致性不冲突。`version` = `1.0.0`，与 `metadata.version` 一致。

### B8. 副本唯一性与「未写 `~/.dsh`」

```
$ find . -path ./node_modules -prune -o -name 'SKILL.md' -path '*session-handoff*' -print
./agent-skills/session-handoff/SKILL.md
./research/.tmp-fetch/a2/session-handoff-main/plugins/session-handoff/SKILL.md   # 见下方说明
$ ls -d ~/.dsh/skills/session-handoff
ls: 无法访问 '…/.dsh/skills/session-handoff': 没有那个文件或目录
$ ls -la ~/.dsh/skills/
grill-me  ppt-master  program-notebook        # 无 session-handoff → 本档 0 次写入 ~/.dsh
```

- 第二处 `SKILL.md` 是**调研阶段抓取的外部快照**（`WeirdSky924/agent-handoff-skill` v1.26.0，95 577 字节，目录 mtime 8月13日，落在 `research/.tmp-fetch/`，`git ls-files` 为空=未跟踪），**不是本 skill 的第二副本**，与本档无关。
- 结论：本档**只存在一份**交付物副本（工作区 `agent-skills/session-handoff/`），**没有**创建第二份、**没有**任何 `~/.dsh` 写入。

### B9. 四份 references 职责边界（对照审计 B.2 结论逐条确认）

| 审计 B.2 项 | 落实证据 |
|---|---|
| 重叠 1：前缀命名与归档规则 | 规则**只在** spec「前缀命名与归档规则」；playbook 步骤 2 只写动作并**指回 spec**（`handoff-spec.md` 在 playbook 命中 10 次），且无散文阈值（`grep '20 份\|100 行\|≤100'` → 空） |
| 重叠 2：勘误块 | spec 定义**格式**（命中 3 次含指针「写回时机指向 resume-playbook.md」）；resume 定义**时机**并指回 spec（`handoff-spec.md` 命中 2 次） |
| 重叠 3：自检清单 vs 规范数值 | playbook「自检清单」8 项**只给命令 + 判据**，阈值一律写「以 `handoff-spec.md` 为准」；`100` 在 playbook 仅 1 行（脚本内的 `BUDGET="${2:-100}"` 默认值，属审计要求内嵌的已实测片段），`20 份/100 行` 散文 0 处 |
| 空洞：聚焦模式（R6） | spec 有「聚焦模式」强制形状（4 字段表）；playbook 有**步骤 1.5「判定聚焦模式」**；自检清单第 6 项「索引表行数 = 其余活跃支线数」 |
| SKILL.md 该写什么 | SKILL.md 只写：核心原则 4 条、按需加载表、两模式（生成 3 行 / 接手 2 行，均指向 reference）、边界 2 条、副本与同步、最终回复格式；**不含** §0–§9 逐节职责表 / YAML 全表 / 七步六步流程 / bash 片段 |
| 交叉引用完备 | spec→playbook 6 处、spec→resume 2 处；playbook→spec 10 处；resume→spec 2 处、resume→playbook 2 处；examples→spec 3 处 |
| 整行重复抽查 | `comm -12` U3 前 80 行 × U4 全量 → 仅 `|---|---|---|`（表格分隔符，假阳性），**无重复段落** |

### B10. R1–R12 落地对照

| # | 落地位置 | 实测证据 |
|---|---|---|
| R1 | `description` 全文（审计 B3 候选 A） | `measure-desc.mjs` → `len=257 ✅合格`；对照 `wc -c=613`；**全程未用 `wc -c` 判长度** |
| R2 | `SKILL.md`「副本与同步」（正文小节，无快照独有文件） | `grep -c '^## 副本与同步$'` = 1；文件树仅 SKILL.md + 4 references |
| R3 | `SKILL.md` 第 1 行 | `head -1` = `---`；`awk NR==1` 退出 0 |
| R4 | playbook 步骤 1「目录前置」+ 步骤 5 `mkdir -p .dsh/handoffs` | `grep -c 'mkdir -p .dsh/handoffs'` = 1；spec「文件名与归档」同述 |
| R5 | spec「编号契约」+ examples「与 §0–§9 契约的差异」 | 声明 v1 契约不与 2026-09 前历史件兼容；新增编号 ≥§10 且置于不编号附录前；引 `research/handoff-history-audit.md:195-196` |
| R6 | spec「聚焦模式」+ playbook「步骤 1.5」+ 自检清单第 6 项 | 三处齐（见 B9） |
| R7 | examples「竞品…清单」8 条 + 「引用纪律」 | **每条**写全仓库名 + 报告名 + 行号；`grep -c 'repo1'` = **0**；`research/competitor` 行数 = 8 |
| R8 | resume「复述模板」五项（与验收 4 客观清单对齐） | 模板含 `repo_root` / `git_head` 一致判定 / 前 3 动作（P0–P2）/ 歧义（或「未发现歧义」）/ 闸门判定；**验收动作本体属主代理验收阶段** |
| R9 | 属 U8（`~/.dsh/AGENTS.md`，主代理提权） | 本档不可写 → 判据（`git diff --numstat` 删除列 0、`grep -c '^#'` 前后差 1）留给主代理执行 |
| R10 | `SKILL.md` frontmatter 只 3 字段；camelCase 旧键 0 命中 | `grep -nE '^(disableModelInvocation\|modelInvocable\|userInvocable):'` 退出 1；**未**写「不存在 allowed-tools」这类不精确表述，也未加未授权字段 |
| R11 | playbook 步骤 1 | 明写「该 glob 匹配**全树任意深度**，不是「仓库根」」；仓库根同前缀判定要求用显式 `ls`/`shasum` |
| R12 | spec「自指说明」+ playbook 自检清单第 8 项 | §1 必须标注「本次自生成，非待处理改动」；明确该件**不**入 `.gitignore` |

---

## C. 自裁决

**通过（pass）** —— 本档负责的验收项**全部实测通过**，无一项依赖主观判断：

1. ✅ `head -1` = `---`；frontmatter 仅合法字段；`name == session-handoff`；camelCase 旧键 0 命中。
2. ✅ `description` 归一化后 **257 字符 ≤ 497**（`measure-desc.mjs` 实测，未用 `wc -c`）。
3. ✅ `check-sections.sh` 对合规示例 `SECTIONS: PASS`（sections `0…9`、`counted=28 limit=100 PASS`）、对缺节坏例 `SECTIONS: FAIL` 退出 1；`probe-reachability.sh` 对四份 references 全部 `REACHABILITY: PASS / missing=0`；探针对仓库外文档 fail-closed（exit 2）。
4. ✅ 四份 references 职责不重叠、无空洞（B9 逐条对照审计 B.2），交叉引用完备。
5. ✅ `.gitignore`：`git check-ignore -v .dsh/handoffs/x.md` 退出 0（增补前为 1），`git diff --numstat` = `3 0`。
6. ✅ 只有一份副本、未创建第二份、**0 次写入 `~/.dsh`**。

**未通过项：无。**

---

## D. 上报：歧义、审计单元缺陷与残余风险

### D1. ⚠️ 审计 U5 两处引用与报告原文不符（本档按「回原文核对」处理并上报，未静默改设计）

1. **U5 反例第 5 条「客户端 slot 名硬编码」的仓库名给错**。审计写 `Totoro-qaq/dsh-plugin-bridge`（`research/competitor-dsh-handoff-plugins.md:243`、`:1130`、`:1185`）；但实测这三行**都属于 `WeiYe6/dsh-session-handoff`**（该报告 `:42` 明示 `## 1. WeiYe6/dsh-session-handoff` 为第一节；`:1127`/`:1185` 的表格行前缀为同一仓库；报告 `:1232` 把 `dsh-plugin-bridge` 记为另一仓库）。
   → **本档按证据写成 `WeiYe6/dsh-session-handoff`**（R7 的本意就是「写对全仓库名」，按审计原标签会留下**无法复核**的引用）。**上报请审计/主代理确认**。
2. **U5 反例第 2 条的源文件行号无法核实**。审计写 `lib/dsh-alpha-host.js:83` `row?.projections?.values`；报告内实际表述为 `:1192`（表格行）+ `:1133`（正文，注释引 `migrate.js:551`），`grep 'dsh-alpha-host'` 只命中 `:784/:958/:1123/:1232`，**均不含 `:83` 与该取值表达式**。
   → 本档改写为**可复核引法**：`research/competitor-dsh-handoff-plugins.md:1192`、`:1133`（报告内引 `migrate.js:551`），仓库名 `Totoro-qaq/dsh-plugin-bridge` 保留（该条归属正确）。

### D2. 任务书第 3 项「对 references 示例文档实跑」的执行解释（已上报，未自行拍板）

- 原文：「用 `check-sections.sh` 与 `probe-reachability.sh` 对你写出的 references 示例文档实跑，确认…0 不可达 / 编号有序」。
- 本档的**唯一可执行解释**（并已按此执行）：`probe-reachability.sh` 要求被检文档**在 git 仓库内**（否则 fail-closed exit 2），而 `check-sections.sh` 需要一份**符合 v1 契约的交接件**（四份 references 本身不是交接件，跑出来必然 `MISSING SECTION`——这是脚本正确行为）。
  → 因此：**可达性**对四份 references 实跑（全 PASS / missing=0）；**编号有序 + 预算**对按 v1 契约现写的冒烟交接件实跑（PASS），并对故意缺 §2/§4/§5 的坏例实跑（FAIL exit 1）以证明非恒绿。
  → 若主代理要求「冒烟件必须落在仓库内」，请指定路径（**本档未在仓库内新建任何冒烟/临时文件**，以免越界写入）。

### D3. 残余风险 / 依赖（不影响本档自裁决）

1. **`~/.dsh/skills/session-handoff/` 尚不存在**（本档无权创建）→ `SKILL.md` 的探针因此有 1 处真实 MISSING；验收 2（实测 `skill` 调用）与验收 5（两处 SHA-256 一致）**必须由主代理提权拷贝后**执行。拷贝需**逐字节**（含 `references/` 4 文件），否则 R2/验收 5 不成立。
2. **`.dsh/handoffs/` 不存在**（plan.md:65 定为「生成模式首次运行创建」）——本档未创建，`git check-ignore` 对不存在的路径同样有效（已实测 exit 0）。生成模式运行时按 playbook 步骤 1/5 `mkdir -p`。
3. **验收 4 的「干净子代理模拟继任会话」**：其客观 5 项清单已落进 resume「复述模板」（R8），但**执行与判定属主代理验收阶段**，本档未派发子代理（会与主代理的验收编排重复）。
4. **U8 未做**：`~/.dsh/AGENTS.md` 在工作区外，沙箱不可写——按审计 U8 与 plan.md:64 由**主代理提权写入**（两行 bullet + 一个 `## 交接协议` 标题，追加到文件末尾）。本档已在 `.gitignore`/references 中提供其引用的产物位置事实。
5. **未核实项（沿用审计 D 节，本档未新增）**：宿主 watcher 能否热发现新拷贝的 skill；`description` 在 GUI 设置页的截断是否与 catalog 一致；主会话 `get_goal` 的返回形状（生成步骤 1 需按实际返回取 `objective`/`id`/`revision`）。
6. **本档未派发任何子代理、未跑构建/测试、未动 git**（不 `add`、不 `commit`、不 `push`），符合决策 15/29。

---

## E. 给主代理的接力清单（供验收阶段使用）

**交付物 SHA-256（拷到 `~/.dsh/skills/session-handoff/` 后须与下列值逐条相同；R2 / 验收 5）**

| 文件 | SHA-256 |
|---|---|
| `SKILL.md` | `16baa4be483ca9b4f89116691250f303a2791f7d217e172b6cedd7ef976cffd2` |
| `references/handoff-spec.md` | `80987a1ef2877b0b014d0cf0d32a873e6a1c8dc5a007082879c407fab1d2e5e7` |
| `references/generate-playbook.md` | `4d664907edff0f5b051fbf12cc18180d64b2360d5a127daa7b8fe78f62d50aae` |
| `references/resume-playbook.md` | `b63c65d9d111e25b2d2c75018796b660753a325a22c91d5fa2889d6e83b30428` |
| `references/examples-and-pitfalls.md` | `b75740d0b95c2026d6f1b7a50537c2839928fc641740d0a1a997376a5302be83` |

**建议的验收顺序（存在真实依赖，不可打乱）**

1. 主代理提权拷贝（`agent-skills/session-handoff/` → `~/.dsh/skills/session-handoff/`，保持目录结构），再 `shasum -a 256` 逐文件比对上表；
2. 跑 **验收 2**：`skill(name="session-handoff")` → 返回体含 `content` 与 `resourceBase`（**没有 `description` 字段是正常的**）；失败则重建 `dsh web` 后重试（审计 D.1）；
3. 跑 **验收 3**：用生成模式产出仓库根真实交接件，逐条跑 playbook「自检命令」4 条 + 8 项自检清单（注意：`.dsh/handoffs/` 需先 `mkdir -p`）；
4. 跑 **验收 4**（R8 客观 5 项清单：`repo_root` / `git_head` 一致性 / 前 3 动作对应 P0–P2 / ≥1 歧义或显式「未发现歧义」 / 闸门判定，且**全程未向用户提问**）；
5. 写 **U8**（`~/.dsh/AGENTS.md` 追加 `## 交接协议` + 2 bullet），跑 **验收 5**（R9 判据：`git diff --numstat` 删除列 0、`grep -c '^#'` 前后差 1、`ls -1 .dsh/handoffs | wc -l` ≤20、两处副本哈希全等）。
