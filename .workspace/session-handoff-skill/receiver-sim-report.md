# 继任会话模拟接手报告（干净上下文）

- 模拟角色：全新继任会话，仅持可粘贴启动指令，对本任务历史零背景
- 受检对象：`/home/CNS2026495165/dsh/handoff-skill_NEXT_SESSION_PROMPT.md`（207 行，mtime 2026-09-25 12:02）
- 实跑时间：2026-09-25 12:04–12:06（本机、`main`、danger-full-access）
- 纪律：全程只读 + 只读命令；唯一例外两处已如实披露（见 §6-E、§6-F）

---

## 1. skill 是否可加载

**是。** `skill` 工具 `name=session-handoff` 返回 `<skill_content name="session-handoff">`，含 `<skill_resources>`：

```text
Base directory for this skill: /home/CNS2026495165/.dsh/skills/session-handoff
```

- 与 `§0` 所写「先加载 session-handoff skill 的接手模式」一致；调用后正文确实给出接手模式入口
  （`references/resume-playbook.md`），无需用户再敲 `/session-handoff`。
- 按 skill 指示读了 `references/resume-playbook.md`（57 行，六步 + 闸门表 + 复述模板 + 回写规则 + 禁止事项），
  本报告的骨架即按该文件「复述模板」五项 + 用户追加的 8 项要求组织。
- **结论：可加载、可导航、接手模式文档自洽。** 该 skill 的「接手模式」相对我零背景的处境是够用的
  ——它明确告诉我先实跑核对、再复述、闸门不过就停，这条顺序我照做了。

---

## 2. 前置核对结果（`§0` 给的命令，逐条实跑）

### 2.1 命令 1：路径存在性

```text
$ ls -d ~/.dsh/skills/session-handoff ~/.dsh/skills/session-handoff/references agent-skills/session-handoff
agent-skills/session-handoff
/home/CNS2026495165/.dsh/skills/session-handoff
/home/CNS2026495165/.dsh/skills/session-handoff/references
exit=0
```

**三个路径全部存在，退出码 0。** 与 `§0` 预期一致。

### 2.2 命令 2：两处 SKILL.md SHA-256

```text
$ shasum -a 256 ~/.dsh/skills/session-handoff/SKILL.md agent-skills/session-handoff/SKILL.md
16baa4be483ca9b4f89116691250f303a2791f7d217e172b6cedd7ef976cffd2  /home/CNS2026495165/.dsh/skills/session-handoff/SKILL.md
16baa4be483ca9b4f89116691250f303a2791f7d217e172b6cedd7ef976cffd2  agent-skills/session-handoff/SKILL.md
exit=0
```

**两处 SHA 完全一致（`16baa4be…cffd2`）。** 我另按 `§8` Runbook A 跑了全 5 文件比对，结论 **5/5 MATCH**
（`SKILL.md`、`references/handoff-spec.md`、`references/generate-playbook.md`、`references/resume-playbook.md`、
`references/examples-and-pitfalls.md`），与 `§1`「5 文件 SHA-256 两处全 MATCH」一致。

### 2.3 命令 3：本件自检（`§8` Runbook B）

```text
$ bash .workspace/session-handoff-skill/check-sections.sh handoff-skill_NEXT_SESSION_PROMPT.md; echo $?
sections found: 0 1 2 3 4 5 6 7 8 9
budget(§0-§5+§9) counted=96 limit=100 PASS
SECTIONS: PASS
exit=0

$ bash .workspace/session-handoff-skill/probe-reachability.sh handoff-skill_NEXT_SESSION_PROMPT.md; echo $?
repo_root=/home/CNS2026495165/dsh
--- checked=31 missing=0
REACHABILITY: PASS
exit=0
```

**编号 0–9 齐全有序、§0–§5+§9 实测 96 行 ≤ 100 预算、31 条路径 0 缺失。** 两个脚本都真的取了退出码
（按 `§7` 坑 4 的纪律，未接 `| tail`）。`§8` Runbook 的两条自检命令**可用且结果与文档声称一致**。

**前置核对总判：`§0` 的两条命令全过、`§8` Runbook A/B 全过。前置闸门未触发停手。**

---

## 3. 事实基线可核对性（`§1` 逐项）

| `§1` 项 | 实跑命令 | 实测值 | 判定 |
|---|---|---|---|
| 仓库/分支/HEAD | `git rev-parse HEAD / --abbrev-ref HEAD / --show-toplevel` | `fa118d91c2e474db5f2c7e799e4040a69f8acb02` / `main` / `/home/CNS2026495165/dsh` | **一致** |
| 工作树规模 | `git status --short \| wc -l` | **386**（354 `??` + 29 `M` + 3 `D`） | **不一致（+1）** |
| 本会话改动仅 4 项 | `git status --short -- .gitignore agent-skills research/vision-probe .workspace/session-handoff-skill` | ` M .gitignore`、`?? .workspace/session-handoff-skill/`、`?? agent-skills/`、`?? research/vision-probe/` | **一致** |
| 本件自身未跟踪 | `git status --short \| grep NEXT_SESSION_PROMPT`；`git ls-files --error-unmatch` | `384:?? handoff-skill_NEXT_SESSION_PROMPT.md`；`error: 路径规格…未匹配任何 git 已知文件` | **一致** |
| 同仓并行会话 | `ls -la --time-style=full-iso ~/.dsh/` | `.credentials.yaml` 与 `settings.yaml.bak-visiondecl-20260925-120100` 的 mtime 均为 `2026-09-25 11:52:33` | **一致（11:52:33 时刻 corroborated）** |
| skill 落盘两处 SHA | `shasum -a 256` ×5 | 5/5 MATCH | **一致** |
| 图像门禁判据源码 | `sed -n '188,206p' ~/.dsh/profiles/node_modules/@local/dsh-btw/lib/index.js` | 见下方 3.1 | **一致（行号近似，语义吻合）** |
| 历史交接件（旧命名） | `wc -l .workspace/reports/handoff/NEXT_SESSION_PROMPT.txt .workspace/lag-fix/NEXT_SESSION_PROMPT.txt` | `228` / `56` | **一致** |
| 「本仓**不存在**任何 `*_NEXT_SESSION_PROMPT.md`」 | `find . -name "*_NEXT_SESSION_PROMPT.md" -not -path "./node_modules/*"` | `./handoff-skill_NEXT_SESSION_PROMPT.md` | **不一致（自指悖论，见 §6-A）** |

### 3.1 门禁判据源码复核（真实输出片段）

```text
async function modelAcceptsImage(ctx, route, signal) {
	const llm = ctx.get?.("llm");
	if (llm?.resolveModelInfo === void 0) return false;
	try {
		const info = await llm.resolveModelInfo(route.provider, route.model, signal);
		return Array.isArray(info?.inputModalities) && info.inputModalities.includes("image");
	} catch { return false; }
```

`§1` 记 `@local/dsh-btw/lib/index.js:192-203`；实测该函数体落在 199–205 行、其上方 192–198 是解释
`inputModalities` 的 doc 注释。**语义完全吻合，行号有 ±3 的漂移**（不影响可用性，但属"近似引用"）。

### 3.2 无法独立核对项

- `§1`「另一会话于 **11:52:33** 改写 `settings.yaml`（**225→158 行**）」：时刻与 158 行**均已被旁证**
  （见上表 + 下条），但「改写前的 225 行」无法直接核对——最近的旁证是
  `settings.yaml.bak-workbuddy-20260925-101844` = **224 行**（差 1 行，可能是当时快照口径）。判 **基本一致、1 行级存疑**。
- `§1`「`settings.yaml` 当前 158 行」：**当前实测 215 行**（`wc -l`），与文档不符——原因可完整解释且**不是第三方改写**：

```text
$ wc -l ~/.dsh/settings.yaml
215
$ stat -c '%y' ~/.dsh/settings.yaml
2026-09-25 12:01:00        # 本会话自己的 visiondecl 写入时刻
$ wc -l ~/.dsh/settings.yaml.bak-visiondecl-20260925-120100
158                        # 写入前快照
```

`158 + 19 模型 × 3 行 = 215`，与 `§3`/附录 B「12:01 提权修正 settings.yaml（19 个模型补 `input`）」精确自洽
⇒ **数字本身没错，是 `§1` 那一行没随本会话自身的写入更新。**

---

## 4. 理解复述（≤200 字）

这条线是**交付并验收一个 DSH skill `session-handoff`**：它把某会话的工作内容/进展/目标整理成仓库根
`<前缀>_NEXT_SESSION_PROMPT.md`，供下一会话零背景接手（生成模式 + 接手模式双档，权威副本在
`~/.dsh/skills/`，仓库内 `agent-skills/` 只是分发快照）。当前状态：skill 本体 5 文件已两处落盘且
SHA 全等（验收 2、5 已过），交接件已生成并通过编号/预算/可达性自检；**卡在验收 4**——还没有干净子代理
真跑过一次接手，且本批改动未提交。`§2` 的 P0 是两个收尾：**P0-1** 派干净上下文子代理模拟继任会话读本件，
判定标准是"不追问用户即能完成前置核对→复述→指出歧义"；**P0-2** 收敛 vision 实测结论
（A 级集合 == `settings.yaml` 声明 `image` 的集合）。附带产物：adam 网关 53 模型 × 4 探针的 image 能力实测
（`research/vision-probe/`）。

---

## 5. 前 3 个动作（按 `§2` 顺序，可执行命令）

**动作 ①（P0-1）派干净上下文子代理模拟继任会话，跑验收 4**
前置闸门已实测通过（`~/.dsh/skills/session-handoff/SKILL.md` 存在且与仓库快照 SHA 一致）。
动作本体：`subagent`（干净上下文、禁止提问）投喂 `§9` 启动句 + 本件路径，要求其逐项交付
「前置核对输出 / 复述五项 / 歧义清单」；判定标准：**全程未向用户提问即完成**。不达标 ⇒ 按反馈改本件或 skill 正文后重验
（注：与 `§4`③ 的边界冲突见 §6-H）。

**动作 ②（P0-2）独立复核 vision 声明一致性**
不要在未加修正的情况下照抄 Runbook C。按 `§2` 原文的命令跑：

```bash
cd /home/CNS2026495165/dsh && python3 research/vision-probe/analyze.py | tail -30
```

**实测输出与 `§2` 声称不符**（20 条「需补声明」而非「22 = 22 已相等」，原因见 §6-D）。
真正可靠的复核是我在核对阶段自写的只读核算 —— 直接对比 `tiers.json` 的 A 级集合与 `settings.yaml`
现况的 `- image` 声明集合：

```text
A级数= 22   settings声明image数= 22
A - decl (缺声明): []
decl - A (多声明): []
相等? True
```

**结论：22 = 22 客观成立**，但必须用上表口径而非 Runbook C。判定标准达成 ⇒ P0-2 事实层面已收尾，
「落地」动作本身属已完成项。

**动作 ③（P1 前置）停下取裁决，不自行开工**
`§2` P1 前置闸门写明「先由用户裁决（`§5` 第 1 条），**不得自动提交**」；闸门表「用户裁决已给」不满足
⇒ 按接手手册必须**停并问**。可先跑其判定命令（只读、exit 0）供裁决参考：

```bash
git check-ignore -v .dsh/handoffs/x.md   # → .gitignore:106:.dsh/handoffs/  exit=0  ✅
```

---

## 6. 歧义与缺料清单（最重要）

**总判：`§0`/`§5`/`§8` 足以让我"开始 P0-1"，但 `§1`/`§2`/`§7` 存在 6 处会真实误导接手方的缺陷，
其中 2 处（D、F）会让我做出错误判断或错误动作。就"是否必须向用户追问"而言：**
**— 开始 P0-1 不需要追问（闸门全过，判定标准客观）；**
**— P1/P2 必须追问，但那是 `§2` 自己写明的裁决停点，属设计而非缺陷。**

逐条如下（按危害排序）：

### A. `§1` 工作树 385 行 ⇒ 实测 386 行，且差的就是本件自己（自指悖论）— 真实缺陷
`385 = 353 ?? + 29 M + 3 D`；实测 `386 = 354 ?? + 29 M + 3 D`，多出的那一行经 `grep -n` 定位为
`384:?? handoff-skill_NEXT_SESSION_PROMPT.md`。`§1` 一边把本件单列一行、一边把它排除在计数之外
（生成时刻 `git status` 早于本件落盘），接手方**无法判定以哪个为准**。
**建议**：把该行改为「385（本件落盘前）/ 386（含本件自身，本件为唯一增量）」并注明本件恒为 `??`。

### B. `§1`「本仓**不存在**任何 `*_NEXT_SESSION_PROMPT.md`」被自身推翻 — 真实缺陷（设计级）
`find` 现在返回 `./handoff-skill_NEXT_SESSION_PROMPT.md`。这条 `[已核实]` 断言在**交接件生成的那一瞬间
即失效**，属"基线项自相矛盾"，不是外部漂移。
**建议**：改写为「除本件自身外，本仓不存在其他 `*_NEXT_SESSION_PROMPT.md`；历史件为旧命名 `*.txt` 两份」，
并让 `probe-reachability.sh` 的自检把「除本件外」计入判据。

### C. `§1` settings.yaml「158 行」未随本会话自身写入更新，且与 `§7` 坑 1 叠加成陷阱 — 真实缺陷
现状 215 行（§3.2 已给出 `158 + 19×3` 的精确解释）。危险在于 `§7` 坑 1 强警告「有别的会话在改
settings.yaml」，接手方看到 `158 ≠ 215` 极易误判为"**第三个**会话刚改过、基线已崩"，从而触发不必要的停手。
**建议**：`§1` 该行补「本会话 12:01 写入 19 条声明后为 **215** 行（`bak-visiondecl-*` = 写入前 158 行）」，
并在 `§7` 坑 1 写明「先看本会话自己的写入记录，再怀疑并发改写」。

### D. `§2` P0-2 的**判定命令本身输出与声称不符** — 真实缺陷（最有价值的一条）
`§2` P0-2 写「判定标准：`python3 research/vision-probe/analyze.py` 输出的 A 级集合与 `settings.yaml` 中
声明 `image` 的模型集合**完全相等**（当前 22 = 22，实测已相等）」。实跑 Runbook C 的真实尾部：

```text
=== A 级（建议补声明 input:[text,image]）: 22 ===
  + claude-sonnet-4-6                  （需补声明）
  + gemini-3-flash                     （需补声明）
  ... （共 20 条「需补声明」，仅 4 条「已声明」）
```

根因（已读源码定位）：`analyze.py:22` `DECLARED = {m["id"]: m.get("declared_input") for m in MODELS["settings_models"]}`
—— 它读的是 `models.json` 里的**快照字段**，不是当前 `settings.yaml`。该快照生成于 12:01 声明写入**之前**，
于是"已声明/需补声明"标签整体过期。
**后果严重**：接手方若照 `§2` 原文判定，会得出「P0-2 不达标」，进而按文档提示"按 `tiers.json` 收敛"去**重复补写
19 条已存在的声明**——在 `§7` 坑 1 明说"别整文件重写"的文件上做一次多余写入。
**建议**：`§2` P0-2 判定口径改为「对比 `settings.yaml` 现况的 `- image` 声明集合与 `tiers.json` A 级集合」，
并把 `analyze.py` 的 `declared_input` 改为**实时解析 settings.yaml**（或在该行显式标注"此列为快照，勿用于判定"）。

### E. Runbook 被标为「可直接复制运行」，但 C 项有写副作用 — 真实缺陷（我因此踩了一次）
`analyze.py:83` 有 `(HERE / "tiers.json").write_text(...)`。我在核对阶段执行了文档明确推荐的 Runbook C，
**导致 `research/vision-probe/tiers.json` 被同内容重写**：`stat` 显示 mtime 变为 `2026-09-25 12:05:29`
（原为 12:01）。内容不变（重算 `entries 53 / A 22` 与文档一致），但**违反了"核对阶段只读"的纪律，
且属于文档诱导**。如实披露，未做任何回滚动作（不写入即不备份）。
**建议**：`§8` Runbook 给 C 项加注「**非只读**：会重写 `tiers.json`」，或另给只读变体
（`python3 -c "import json;d=json.load(open('research/vision-probe/tiers.json'));print(sum(1 for v in d.values() if v['tier']=='A_reliable'))"`）。

### F. `§7` 两条"历史坑"在当前环境下**不成立** — 真实缺陷（削弱 `§7` 可信度）
- 坑 2「`/tmp` 在 bash 调用之间不持久（沙箱独立）」：实测**不成立**。第一次调用写
  `/tmp/dsh_persist_probe.txt`，第二次调用 `ls -la` + `cat` 正常读回 `test-persist-4049`。
  该坑显然是某个**受限沙箱模式**下的观察，但文档未标注前提；当前会话为 `danger-full-access`。
- 坑 3「`grep -E` 的坑：不支持 `(?:…)` 与 `\b`」：**半真**。GNU grep 3.11 下
  `printf 'foo bar\n' | grep -E '\bbar'` → 命中 `foo bar`、`exit=0`（**支持 `\b`**）；
  `grep -E '(?:foo)'` → `exit=1` 并告警"表达式以 ? 开头"（**确实不支持 `(?:)`**）。
**建议**：两条都补上环境前提（沙箱模式 / grep 实现与版本），否则接手方要么白绕一圈，要么误信"`\b` 不可用"
而写更脆的正则；更值得注意的是——**坑 3 已被 `probe-reachability.sh:10` 的注释当作事实固化进脚本**。

### G. `§6` 的源码引用无法按给定路径定位 — 真实缺陷（索引质量）
- `§6` 说 `dsh-skill-filesystem/lib/index.js:581-614`「DSH skill 发现静默跳过软链」。实际文件在
  `<dsh checkout>/node_modules/@deepseek-ai/dsh-skill-filesystem/lib/index.js`；该区间（583 行起
  `discoverRoot`）**看不到** symlink 判据——`grep -n symlink` 只命中 763/765 两处与 `/dev/null` 有关的注释。
  真正生效的机制是 `discoverRoot` 的 `locator === void 0 → continue`（目录才认 `SKILL.md`），
  配合 `entryFromFs`（620-639）透传的 `entry.type`（Node 侧 `type: type ?? "other"`，符号链接不被识别为
  `directory`/`file`）⇒ 结论**对**，但引用行号与所在文件**对不上**。
- `§6` 说 `dsh-skill/lib/index.js:315-324`「低 rank 胜出、落选者被静默隐藏」。在
  `~/.dsh/profiles/node_modules/@deepseek-ai/` 下**无此路径**；我按内容二分才在
  `dsh-workspace-enhancement/node_modules/@deepseek-ai/dsh-skill/lib/index.js:313-325` 找到
  `collectLayer` 的 `compareIndexedCandidates` 排序 + `seen` 去重 + `logger.warn(...ignored because a higher-priority skill already exists)`
  ⇒ 结论**对**，路径**不可直接定位**。
**建议**：`§6`/`§7` 的源码引用一律给**绝对路径**（或"包名 + 文件 + 行号 + 定位命令"），否则接手方要自己
全盘 `find`，正是 `§6` 想避免的浪费。

### H. `§2` P0-1 授权"改 skill 正文"与 `§4`③"未授权修改 40 条设计裁决"边界重叠 — 中等问题
P0-1 写「按其反馈改本件或 skill 正文后重验」，`§4`③ 又写「修改 skill 的 40 条设计裁决」属未授权。
若子代理的反馈恰好指向某条裁决（例如"§2 判定命令有写副作用"→ 需要改 `analyze.py` 口径，若该口径源自裁决），
接手方**无法判定该改还是该停**。
**建议**：补一句判定规则——「仅当反馈落在**非裁决**范围内（表述、索引、判定命令、可执行性）方可自行修订；
触及 `plan.md` 决策表任一条即停并问」。

### I. 轻微项（不影响开工，一并记录）
- `§4`① 称「40 条设计裁决」，但表格只摘 12 条；其余在 `plan.md`（14,455 字节，`§8` 必读 1，可达 ✅）。
  接手方要读完整 `plan.md` 才能确知"40 条"边界——可接受，但建议在 `§4` 标注条数来源行。
- 头部 YAML `archive.retained: 0` 与实测一致（`.dsh/handoffs/` 为空目录）✅。
- `§7` 坑 5「DejaVu 无中文字形」：旁证成立 —— `fc-list :lang=zh | grep -ci dejavu` = **0**，
  且 `fc-list :lang=zh | wc -l` = 89、`/usr/share/fonts/truetype/arphic/uming.ttc` 存在
  ⇒ "要用 uming.ttc" 的建议**可执行**。（未做实际渲染复现，标为"旁证 + 未端到端复现"。）
- `§7` 坑 7（历史件 `§N` 契约不同）：抽查 `reports/handoff/NEXT_SESSION_PROMPT.txt` 确为
  `## 0. 你的第一件事` / `## 1. 客观事实基线` 的**旧编号写法**（`§1.1/§1.2` 三级标题），
  与本件 `§N` 契约确不相同 ⇒ 该坑**成立且有用**。

---

## 7. `§6`/`§7` 的有效性（它真的挡住了坑吗）

**结论：`§6` 大部分有效且真的挡住了我；`§7` 一半有效、两条被实测证伪。**

**挡住了的（具体例证 1）**：`§6`「两处副本用软链同步 —— 已证伪：DSH skill 发现静默跳过软链」+「在两个发现根
放同名 skill —— 已排除：低 rank 胜出、落选者被静默隐藏」。我接手第一个动作就是 `§0` 的 SHA 比对；读完 `§6`
后我**没有**去动 `agent-skills/` 与 `~/.dsh/skills/` 的关系、也**没有**产生"两处放同名 skill 会不会遮蔽"的
疑问（那是零背景接手方最自然的第一个疑问），改为直接按 Runbook A 做 5 文件哈希比对并得到 5/5 MATCH。
**这条死路清单确实省掉了一次代价不明（可能改动落盘结构）的探索。**

**挡住了的（具体例证 2）**：`§6`「用 `wc -c` 判 description 长度 —— 已证伪（中文按字符计）」。我在核对
`SKILL.md` 时确实下意识想 `wc -c`，被该条拦住，改用字符口径 ⇒ `§6` 对**工程细节类**坑的拦截是有效的。
`§6`「把 DSH compaction 摘要当交接件」也有效：我没有任何读自身会话事件的工具，该条让我不会去走"你们聊过什么"
的歪路（这条恰好也是我零背景处境下最该被拦住的方向）。

**没挡住的（反例）**：`§7` 坑 2 `/tmp` 不持久、坑 3 `\b` 不支持 —— 两条实测均不成立（§6-F）。
危害不是"绕远路"，而是**可信度折损**：我按坑 4「取退出码别 `| tail`」、坑 6「首行必须 `---`」、坑 7「历史件编号
不同」逐条验证都成立且有用（尤其坑 7 我抽查确认为真），但坑 2/3 让我对 `§7` 整体产生"需逐条复核"的态度——
对一份宣称"强制取证"的交接件来说，`§7` 里混入环境相关而未标注前提的断言，是它最该避免的递减项。

**另外，`§6` 挡住了坑、却没挡住"引用不可定位"**：三条死路我都是**同意结论、但无法按给定路径验证**
（§6-G），等于把 `§6` 从"可复核的死路清单"降级为"需部分信任的断言"。

---

## 8. 自裁决

### **基本自足但有 6 处需补**（缺陷集中在 `§1` 与 `§2`/`§7` 的可核对性，不在结构与任务方向）

**理由（正面）**：
1. 交接件**结构可用**：编号 0–9 齐全有序、§0–§5+§9 实测 96 行（预算 100）、31 条路径 0 缺失、
   两个自检脚本都真实取退出码并 PASS —— 作为"干净接手"的入口，它的**骨架是过硬的**。
2. **闸门是真的过**：`§0` 两条前置命令实跑全过；`§2` P0-1 的前置闸门（`SKILL.md` 两处 SHA 一致）实测成立，
   我**不需要为了"能不能开工"去问用户**。这恰好是 `§2` P0-1 判定标准要考的东西，而我没有追问即完成了
   前置核对 + 复述 + 歧义清单 ⇒ 这条流程**基本达标**。
3. `§3`/`§8`/`附录 B` 提供的旁证链**能自洽复原**（例：`158 + 19×3 = 215` 精确对上），
   说明事实来源是真的取过证，不是编的。
4. `§6` 的死路清单在本任务最相关的两个方向（软链同步、同名 skill 遮蔽）上**真实挡住了我**。

**理由（不足，即"需补"的 6 处）**：`§1` 有两处**自指矛盾**（A 计数 385/386、B "不存在任何 `*_NEXT_
SESSION_PROMPT.md`"被自身推翻）——这类缺陷对**任何**交接件都必然发生，说明该 skill 的 `§1` 模板缺少
"本件自身如何计入基线"的规定；`§1` 有一处**未随本会话自身写入更新**并与 `§7` 坑 1 叠加成误导陷阱（C）；
`§2` P0-2 的**判定命令本身给出与声称相反的输出**（D），是本报告最严重的一条——它会让接手方做出错误动作
（重复写入 19 条已存在的声明）；`§8` Runbook 未标注 C 项的**写副作用**（E），使我"只读核对"的纪律被迫破例
（我已如实披露并说明无内容变更）；`§7` 有**两条被实测证伪**且其中一条已被固化进脚本注释（F）；
`§6` 的**源码引用不可直接定位**（G）。

**是否必须向用户追问**：
- 为完成 `§2` P0-1（本件 `§9` 指名让我先做的动作）：**不需要追问**，闸门全过、判定标准客观，
  我已按文档自足地走完"前置核对 → 复述 → 歧义清单"三步。
- 为推进 P1/P2：**必须问**，但这是 `§2` 明文设计的裁决停点（`§5` 需你裁决 1–3 条），不算文档不自足。
- **唯一"我被迫想追问"的地方是 D**：`§2` 说 A 级集合 22 = 22 已相等，而它给的命令输出说 20 条需补声明。
  我没有问你，而是**自己重写了核算口径**并证明 22 = 22 客观成立 —— 换句话说，**D 迫使接手方绕开文档
  自证，这正是"文档不够自足"的定义**。

**给文档的最小修补清单（按性价比）**：
1. 修 `§2` P0-2 判定口径（别再指 `analyze.py` 的 `declared_input` 快照列）（D）。
2. `§1` settings.yaml 行数补"本会话 12:01 写入后 215 行"（C）。
3. `§1` 两条自指矛盾改写（A、B）。
4. Runbook C 标注"非只读，会重写 tiers.json"（E）。
5. `§7` 坑 2/3 补环境前提，并同步修 `probe-reachability.sh:10` 的注释（F）。
6. `§6`/`§7` 源码引用改绝对路径（G）。

---

## 附：本次实跑命令清单（可复现）

```text
skill(name=session-handoff)
ls -d ~/.dsh/skills/session-handoff ~/.dsh/skills/session-handoff/references agent-skills/session-handoff
shasum -a 256 ~/.dsh/skills/session-handoff/SKILL.md agent-skills/session-handoff/SKILL.md
for f in SKILL.md references/*.md; do shasum -a 256 两处比对; done        # 5/5 MATCH
git rev-parse HEAD / --abbrev-ref HEAD / --show-toplevel
git status --short | wc -l ; git status --short | grep -c '^??' ; grep -c '^ M'
git status --short -- .gitignore agent-skills research/vision-probe .workspace/session-handoff-skill
git ls-files --error-unmatch handoff-skill_NEXT_SESSION_PROMPT.md        # 未跟踪
find . -name "*_NEXT_SESSION_PROMPT.md" -not -path "./node_modules/*"
wc -l .workspace/reports/handoff/NEXT_SESSION_PROMPT.txt .workspace/lag-fix/NEXT_SESSION_PROMPT.txt
wc -l ~/.dsh/settings.yaml ; for f in ~/.dsh/settings.yaml.bak-*; do wc -l "$f"; done
stat -c '%y %s %n' ~/.dsh/settings.yaml ~/.dsh/settings.yaml.bak-visiondecl-20260925-120100
ls -la --time-style=full-iso ~/.dsh/                                    # 11:52:33 旁证
bash .workspace/session-handoff-skill/check-sections.sh handoff-skill_NEXT_SESSION_PROMPT.md; echo $?
bash .workspace/session-handoff-skill/probe-reachability.sh handoff-skill_NEXT_SESSION_PROMPT.md; echo $?
python3 research/vision-probe/analyze.py | tail -30                     # ⚠ 有写副作用（tiers.json）
python3 - <<'EOF'  # 自写只读核算：tiers.json A 级集合 vs settings.yaml 现况 - image 声明集合 → 相等 True
EOF
git check-ignore -v .dsh/handoffs/x.md ; echo $?                        # → .gitignore:106 exit=0
sed -n '188,206p' ~/.dsh/profiles/node_modules/@local/dsh-btw/lib/index.js
sed -n '620,660p' <dsh checkout>/node_modules/@deepseek-ai/dsh-skill-filesystem/lib/index.js
grep -n symlink <同上> ; sed -n '310,328p' …/dsh-workspace-enhancement/node_modules/@deepseek-ai/dsh-skill/lib/index.js
printf 'foo bar\n' | grep -E '\bbar' ; printf 'foo bar\n' | grep -E '(?:foo)'   # §7 坑 3 半真
写 /tmp/dsh_persist_probe.txt → 下一次 bash 调用读回                              # §7 坑 2 证伪
fc-list :lang=zh | grep -ci dejavu ; ls -la /usr/share/fonts/truetype/arphic/uming.ttc
```
