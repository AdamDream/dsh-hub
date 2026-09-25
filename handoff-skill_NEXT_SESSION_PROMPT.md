---
generated_at: "2026-09-25 12:01:47"
prefix: "handoff-skill"
cwd: "/home/CNS2026495165/dsh"
repo_root: "/home/CNS2026495165/dsh"
git_head: "fa118d91"
git_branch: "main"
goal:
  objective: "交付 DSH skill `session-handoff`：把当前会话的工作内容/进展/目标整理为 `<前缀>_NEXT_SESSION_PROMPT.md` 供下一会话快速接手 [已核实：get_goal 实测]"
  id: "goal-02598d0f-fece-426d-ab49-c4e45097a15a"
  revision: 1
other_units: []
archive:
  dir: ".dsh/handoffs"
  retained: 0
---

> **勘误回写块（接手方实测后回写；原文不删不改，只往后追加）**
>
> **2026-09-25 · 由"接手方模拟"实测回写（干净上下文子代理，报告 `.workspace/session-handoff-skill/receiver-sim-report.md`）**
> 该模拟**不追问用户即完成**前置核对与复述（`§2` P0-1 闸门通过），但抓出 6 处不足，逐条修正如下：
> 1. `§2` P0-2 的判定命令会误导：`analyze.py` 当时读 `models.json` 的**写入前快照**，实测打出 20 条"需补声明"，与原文"22=22 已相等"矛盾，照做会**重复写入已存在的声明**。→ 已把脚本改为**读 `settings.yaml` 现况**并加末行 `>>> 一致性:` 判定；P0-2 改写为按该末行判定。
> 2. `§1` 的 `settings.yaml` 行数（原写 158）未计入本会话 12:01 自行的写入。→ 已补"行数演变"行（158 → 215 → 212），并注明 212≠158 是本会话造成的、不是第三个会话。
> 3. `§1` 两处自指矛盾：计数 385 与实测差 1（差的就是本件自身）；"本仓不存在任何 `*_NEXT_SESSION_PROMPT.md`"被本件自身推翻。→ 已改为"387 行（含本件自身 1 项）"与"除本件自身外，本仓无其他 `*_NEXT_SESSION_PROMPT.md`"，并新增**计数口径警告**。
> 4. `§8` Runbook 标称"可直接复制运行"却有写副作用。→ 已在 C 段标注**非只读**（`analyze.py` 会重写 `tiers.json`）。
> 5. `§7` 两条坑被实测证伪/半真。→ 坑 2 已补沙箱前提（`workspace-write` 不持久 / `danger-full-access` 持久，两者均实测）；坑 3 已更正（`\b` 在 GNU grep 可用、仅跨平台不可移植）。技能内 `generate-playbook.md` 的同一错误说法已同步更正。
> 6. `§6` 两条源码引用不可按给定路径/行号复核。→ 已替换为**绝对路径 + 实测行号**（`discoverRoot` :583-594、`entryFromFs` :756-764、`collectLayer` :312-325）。
> 7. **模拟档自身的一处误报已核实驳回**：它称两个源码文件"不存在"，实测三个候选路径**全部存在**（`dsh-skill/lib/index.js` 565 行）——复核不照搬结论。
>
> **2026-09-25 · 第二轮接手方模拟回写（报告 `.workspace/session-handoff-skill/receiver-sim-round2.md`）**
> 上一轮 6 处修正经实测证实**全部有效、无造假**；但抓出 5 处"改了正文没同步周边"的残留，已逐条修正：
> N1 附录 A 的 385/353 与 `§1` 的 387/355 自相矛盾 → 附录 A 改为**只写稳定归类、不写会腐烂的硬数字**，总数改为"重跑即得"并写明漂移口径。
> N2 Runbook 总标题无条件写"可直接复制运行"，未覆盖 D 段写副作用 → 标题改为按段标注只读/有写。
> N3 附录 A 仍无条件断言"`/tmp` 不持久"，与更正后的 `§7` 坑 2 矛盾 → 已改为落工作区 + 指向坑 2 的沙箱前提。
> N4 `§7` 坑 8 的 `counted=96` 是历史值，现值 99/100（余量仅 1 行）→ 已补现值与余量警告。
> N5 `§1`「本会话改动」未标明含验证产物 → 已补口径。
>
> **同时由本会话补采发现**：`gemini-3.1-flash-lite` 在补采样后 6 次中错 1 次 → 由 A 级降为 C 级，其**已写入的 `input` 声明已回退**（`settings.yaml` 声明数 22 → 21）。

## §0 你的第一件事

先加载 `session-handoff` skill 的接手模式：`skill` 工具 `name=session-handoff`（或用户敲 `/session-handoff`），
然后读本文件（仓库根 `handoff-skill_NEXT_SESSION_PROMPT.md`）与 `§8` 列出的「开工必读」4 件。

不得重开：`§4` 的已裁决事项（尤其 40 条设计裁决、前缀一律带前缀、只声明 A 级模型、不做脱敏）。
第一步动作（前置闸门，失败即停并报我，不要自行重建）：

```bash
ls -d ~/.dsh/skills/session-handoff ~/.dsh/skills/session-handoff/references agent-skills/session-handoff 2>&1
shasum -a 256 ~/.dsh/skills/session-handoff/SKILL.md agent-skills/session-handoff/SKILL.md
```

## §1 客观事实基线

| 项 | 实测值 |
|---|---|
| 仓库 / 分支 / HEAD | `/home/CNS2026495165/dsh`、`main`、`fa118d91` [已核实：`git rev-parse`] |
| 工作树规模 | `git status --short` **382 行（本件已入库，不再计入）** = 351 `??` + 28 `M` + 3 `D` [已核实] |
| **本会话改动 → 已入库** | `b84a71f0`（`.gitignore` + `agent-skills/session-handoff/` 5 文件）、`c5ac4c00`（`.workspace/session-handoff-skill/` 9 件 + 本件 + 两处文档同步）；**未入库**：`research/vision-probe/`、`research/vision-crosscheck/`（该目录 0 跟踪，属既有惯例）[已核实：`git log --oneline`] |
| 计数口径警告 | 本节数字是**生成时刻快照**；生成后本会话仍在写盘，**接手方重跑得到不同值是正常的**，不要据此判定"基线被其他会话改写"。 |
| 本件自身 | 仓库根 `handoff-skill_NEXT_SESSION_PROMPT.md` **本次自生成**，已于 `c5ac4c00` 入库（按规范不加入 `.gitignore`）[已核实] |
| 同仓并行会话 | **存在且活跃**：另一会话在做 WorkBuddy 网关接入，并于 **11:52:33 改写 `~/.dsh/settings.yaml`（225→158 行）**，配套备份 `settings.yaml.bak-workbuddy/websearch/teardown-*` [已核实：`stat` + `ls -1t`] |
| `settings.yaml` 行数演变 | 11:52:33 peer 改写后 **158 行** → 本会话 12:01 补 19 个 `input` 声明（158+19×3=**215**）→ 12:08 移除 1 个误声明（3 行）→ **212 行**［已核实：`wc -l`]。**关键**：本会话自己也改过该文件，212≠158 是本会话造成的，不是第三个会话。 |
| skill 落盘 | 权威副本 `~/.dsh/skills/session-handoff/`（rank 400）+ 分发快照 `agent-skills/session-handoff/`，5 文件 SHA-256 两处全 MATCH [已核实：`shasum -a 256`] |
| 图像门禁判据 | `settings.yaml` 模型条目的 `input` 含 `image` → registry `inputModalities` → 原图直传 [已核实：`~/.dsh/profiles/node_modules/@local/dsh-btw/lib/index.js:192-203`] |
| 历史交接件（旧命名） | `.workspace/reports/handoff/NEXT_SESSION_PROMPT.txt`（228 行）、`.workspace/lag-fix/NEXT_SESSION_PROMPT.txt`（56 行）；**除本件自身外**，本仓无其他 `*_NEXT_SESSION_PROMPT.md` [已核实：全树 `find`（该命令会返回本件自身）] |

指针（详情进不编号附录）：`git status` 全文见附录 A；时间线见附录 B；未核实项见附录 C。

## §2 最高优先级任务清单

**P0-1 GUI 端到端验证图像直传**（唯一仍未验证的关键链路）
- 判定标准：在界面粘贴一张截图，确认该模型的 `input` 声明与实际路径（原图直传 / 经 vision-adam 转文本）一致；判据与证据见 `research/vision-probe/REPORT.md`。
- 前置闸门：`python3 research/vision-probe/analyze.py | tail -6` 末行须为 `>>> 一致性: PASS（相等）`。

**P0-2 C 级不稳定的网关侧根因**（需网关访问权限；拿不到就明确记为受阻，**不要猜**）
- 证据起点：`claude-opus-4-7` 同图连发呈两态、错态逐字节恒定（`20250522`，被 4 个模型共用）。

**原 P0/P1/P2 四项均已闭环**（两轮模拟接手、vision 声明一致性、入库、E 级注释），逐项证据见 `§3` 与 `§4`。

## §3 本会话已完成的工作

- 交付 DSH skill `session-handoff`：5 个文件落 `agent-skills/session-handoff/` 并拷贝到用户级权威副本；`~/.dsh/AGENTS.md` 增补「交接协议」两行（117→121 行，既有行零改动）。证据：`.workspace/session-handoff-skill/exec.md`。
- 完成 skill 的验收 2（`skill` 工具实测加载，热发现生效无需重启）与验收 5（5 文件 SHA-256 两处 MATCH）。
- 完成 adam 网关 **53 个模型 × 4 探针**的 image 能力实测（跨 7 轮采样、共 400+ 次请求），产出 `research/vision-probe/REPORT.md`，并按实测把 `settings.yaml` 的 image 声明从 **3 → 21 个**（补采后回退了 1 个误声明：`gemini-3.1-flash-lite` 6 次中错 1 次，由 A 降 C）。
- 已入库两个提交：`b84a71f0`（skill 快照 + `.gitignore`）、`c5ac4c00`（验收证据 + 本件 + `docs/architecture/02-plugin-system.md` §8 与 `docs/program-notebook.md` §5.2/§6 的 skill 清单同步）。详细时间线见附录 B。

## §4 已裁决与权威四层

**① 已裁决不得重开**（"用户原句"为逐字引用；其余为选项裁决，标注 `[选项裁决]`）

| 事项 | 原句 / 选项 |
|---|---|
| skill 名与形态 | `[选项裁决]` `session-handoff`，用户级权威副本 + 仓库内非发现路径快照 |
| 触发方式 | `[选项裁决]` 仅显式调用，但**不设** `disable-model-invocation` |
| 交接件命名 | 用户原句：「我觉得可以引入前缀，这一块单元的交接和下一块单元的交接，因为我不想分仓设置工作区，那样存在麻烦的上下文截断再整理的问题」→ `[选项裁决]` **一律带前缀**，无无前缀特例 |
| 交付物格式 | 用户原句（本次任务起点）：「我想写一个整理交接提示词的skill，用于把会话内目前的工作内容，工作进展和工作目标整理一下，用于下一个会话的快速交接，提示词的格式为NEXT_SESSION_PROMPT.md，你联网搜索一下看看有没有类似的skill或者dsh插件，派几个subagent」 |
| 接手侧是否需要显式加载 | 用户原句：「落盘后自检，以及你再说明一下新会话的交接流程，是不是也是要显式声明skill」→ 已答：是，且启动块内写明让新会话加载本 skill |
| 事实依据纪律 | `[选项裁决]` 强制取证、禁止凭记忆；行内标 `[已核实]` / `[仅记忆]` |
| 权威层级 | `[选项裁决]` 四层：已裁决 / 已授权 / 未授权 / 已否决 |
| 篇幅预算 | `[选项裁决]` `§0`–`§5` + `§9` ≤ **100 行**（先选 80，后经权衡放宽到 100） |
| 脱敏 | `[选项裁决]` **不加任何脱敏/密钥检查**（可分发风险自担） |
| 与 notebook 的边界 | `[选项裁决]` 严格分离，只「建议」不代写 `docs/program-notebook.md` |
| vision 声明口径 | `[选项裁决]` 只给实测 **A 级**模型补 `input: [text, image]` |
| 图像能力测试范围 | 用户原句：「哦对，分别测试一下adam网关的各个模型的image能力，避免每次主会话粘贴图片的时候都需要先提前验证」→ `[选项裁决]` 51/53 个条目全测 |

| **本轮三项裁决** | 用户原句：「第一，入库，第二，加注释，第三，维持」→ ① 入库（两提交已落）② E 级不可用条目**加注释、不删除**（20 条已注释）③ **维持** `vision-adam = deepseek-v4.1-flash` |
| skill 清单文档同步 | `[选项裁决]` 两处都补（`02-plugin-system.md` §8 + `program-notebook.md` §5.2/§6） |
| 其余产物入库范围 | `[选项裁决]` 入 `.workspace` 证据 + 交接件；`research/` 维持不入 |

`[仅对话原文·未落盘]`：**无** —— 据你 12:01 与 14:1x 两次确认，除上述已引用内容外没有其他关键裁决仅存在于对话中。

**② 已授权**（范围以授权原句为准，不得扩大）
- 提权写工作区外：`~/.dsh/skills/session-handoff/`（复制权威副本）与 `~/.dsh/AGENTS.md`（追加两行）。用户以选项裁决批准了该落盘方案。
- 按实测结果**自动修正** `~/.dsh/settings.yaml` 的 `input` 声明（`[选项裁决]`「报告 + 自动修正声明」）。

**③ 未授权**（未写明的一律不动作）
- 改 `vision-adam` 的后端模型、删除 E 级模型条目、改 `agent-default-model`；
- 任何 git 提交 / 推送（skill 与 plan.md 都明确禁止自动 git 操作）；
- 修改 skill 的 40 条设计裁决。

**④ 已否决**
- 只注入会话内、不落盘成文件；自动新建 DSH 会话；自动 `git commit`；脱敏闸门；无前缀的 `NEXT_SESSION_PROMPT.md` 特例；「把 agent 记忆当事实」。

## §5 待办与开放项

**需你裁决**：**无** —— 三项已全部裁决（见 `§4` 末三行：入库 / E 级加注释 / 维持 `vision-adam`）。

**开放项**
- **GUI 端到端未验证**：图像直传路径未在界面里真实贴图确认 → 已提升为 `§2` P0-1。
- **C 级根因未定位**：需网关侧权限才能定论 → 已提升为 `§2` P0-2。
- **产物留存**：`research/vision-probe`、`research/vision-crosscheck`（含 400+ 原始响应与竞品源码留档）按既有惯例未入库；若需长期留存请另行裁决。

## §6 已排除的死路与已证伪的假设

- **两处副本用软链同步** —— 已证伪：DSH skill 发现**静默跳过软链**。准确引用（路径为 `~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-skill-filesystem/lib/index.js`）：`discoverRoot` 里 `locator === void 0` 就 `continue`（:583-594），而 `locator` 只在 `entry.type` 为 `directory` 或 `.md` 文件时才有值；`entryFromFs` 的类型判定只认 `isDirectory()`/`isFile()`（:756-764），软链两者皆假。改为手工同步 + SHA-256 校验（验收 5 已过）。
- **复用 `.workspace/lag-fix/probes/check-executable-refs.sh`** —— 已否决：它硬编码本机 `ROOT` 与 `.workspace/lag-fix`，与"可分发"目标冲突。改写成自定位仓库根的通用片段（`git rev-parse --show-toplevel`）。
- **用 `wc -c` 判 `description` 长度** —— 已证伪：DSH 按字符计（中文 257 字符 = 613 字节），`wc -c` 会假阴性。改用字符计量，有效上限 497。
- **把 DSH compaction 摘要当交接件** —— 已否决：摘要只覆盖被丢弃区间、不含裁决/待办/Runbook，且 agent 无读自身会话事件的工具。
- **单轮采样判定模型视觉能力** —— 已证伪：首轮把 `gemini-3-flash-preview` 误判为能力不足，实为 `max_tokens=300` 截断伪影；且同模型同图时对时错（实测 `claude-opus-4-7` 连发 8 次：5 次对、3 次逐字节相同的编造）。已改为跨 7 轮重复采样 + 确定性判定。
- **用小样本（n=2）判定"可靠"** —— 已证伪：真实可靠度 50% 的模型有 25% 概率蒙到 2/2 全对。补采样后 `gemini-3.1-flash-lite` 从 A 级掉到 C 级（6 次中 1 次错），其已写入的声明被回退。A 级结论一律要求 n≥6。
- **在两个发现根放同名 skill** —— 已排除：低 rank 胜出、落选者被静默隐藏。准确引用：`~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-skill/lib/index.js:312-325`（`collectLayer` 中 `seen.has(skill.name)` → warn `higher-priority skill already exists` → `continue`）；该文件在 `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-skill/lib/index.js` 亦有同名副本。
- **竞品做法**（三条已明确不抄）：只注入不落盘、靠文案+正则抠会话 id、2400 字符硬预算。
- **「5 个 Claude 模型的 C 级判定属误判」这一交叉验证结论 —— 已被我的复测证伪**：独立交叉验证档在另一时间窗实测 276/276 全对，据此判为上游时间局部性故障、应改判 A。我在其之后（12:32，同图同 prompt 同参数）复测**仍复现**（`claude-opus-4-7` 4 对 / 2 编造；`claude-opus-4-6` 3 对 / 3 编造，编造值均为日期型）。**结论：C 级维持、这 5 个模型不声明**；故障确为**共享上游**（编造值 `20250522` 被 4 个不同模型共用共 6 次），但**至今未消除**。复查命令与证据见 `research/vision-probe/REPORT.md` 的「六·补」节，**别据单一时间窗下结论**。

## §7 历史坑与硬约束（按代价排序）

1. **`~/.dsh/settings.yaml` 有别的会话在改**（实测 11:52:33 从 225 行变 158 行）。任何改动必须：先备份、记录写入前后 SHA-256、加并发写保护、用外科式行插入而非整文件重写。改 `adam` 之外的区块前先确认区块范围。
2. **`/tmp` 的持久性取决于沙箱模式**：`workspace-write`（子代理默认）下**不跨 bash 调用持久**；`danger-full-access` 下**持久**（两者均已实测）。跨调用要保留的中间产物一律落工作区，别赌 `/tmp`。
3. **`grep -E` 的坑**：**不支持 `(?:…)`**（实测成立）；`\b` 在 GNU grep 下**可用**，但 BSD/macOS grep 不支持，跨平台别用——早期文档写成"两者都不支持"是**错的，已更正**。另两个真坑：剥尾部标点**别把 `.md` 一起吃掉**（会造假 MISSING）；路径含 `*` 会在通配符处断词造假 MISSING。
4. **取脚本退出码不要 `| tail`**：那会拿到 `tail` 的退出码，自检恒绿。必须 `bash x.sh doc; echo $?`。
5. **DejaVu 字体没有中文字形**：中文值会渲染成豆腐块（本会话造探针图时踩过），中文必须用 `/usr/share/fonts/truetype/arphic/uming.ttc`。
6. **skill 文件的三条硬约束**：首行必须严格是 `---`（否则整条技能被静默忽略）；只认一层深度 `<root>/<name>/SKILL.md`；`description` 是唯一进模型目录的字段且硬截断 500 字符。
7. **历史交接件编号与本 skill v1 契约不同**：历史件 `§6`=历史坑/`§7`=索引/`§8`=方法论，本契约 `§6`=死路/`§7`=历史坑/`§8`=索引。外部仓 `mcu-hil/AGENTS.md` 曾按旧 `§N` 引用，引用历史件时必须提示同步。
8. **`check-sections.sh` 的预算计数曾把「不编号附录」整段算进 `§9`**（只认 `§N` 标题、不认普通标题）→ 本件实测 `counted=126 FAIL`，而规范明确附录不参与预算；修好后 `counted=96`（本件后续增补后为 **99/100，余量仅 1 行**，再加两行正文即 FAIL）；**判据**：任何级别的标题都必须终止计数。

## §8 关键文件索引 + Runbook 速查

**开工必读（4 件，按序）**
1. `.workspace/session-handoff-skill/plan.md` — 40 条已裁决决策（方案契约，权威）
2. `.workspace/session-handoff-skill/audit.md` — 审计结论 R1–R12 + 8 个交付单元
3. `.workspace/session-handoff-skill/exec.md` — 执行档自复核（含每条验收的真实命令与输出）
4. `agent-skills/session-handoff/SKILL.md` + `references/` — 已交付的 skill 本体（权威副本在 `~/.dsh/skills/session-handoff/`）

**本会话其它产物**：`research/vision-probe/REPORT.md`（vision 实测报告）、`research/vision-probe/tiers.json`（A/B/C/D/E 分档）、`research/{handoff-skill-web-research,dsh-skill-mechanism-recon,handoff-history-audit,competitor-agent-handoff-skill,competitor-dsh-handoff-plugins}.md`（调研四件套 + 竞品源码核实）、`research/.dl/`、`research/.tmp-fetch/`（竞品原始源码留档）。

**Runbook（A/B 段只读；C 段会重写 `tiers.json`；D 段会新建 `raw_responses_new.jsonl` 并重写 `tiers.json`）**

```bash
cd /home/CNS2026495165/dsh

# A. 校验 skill 落盘完整性与两处副本一致性（期望：5 个 MATCH）
for f in SKILL.md references/handoff-spec.md references/generate-playbook.md references/resume-playbook.md references/examples-and-pitfalls.md; do
  a=$(shasum -a 256 "agent-skills/session-handoff/$f" | cut -d' ' -f1)
  b=$(shasum -a 256 "$HOME/.dsh/skills/session-handoff/$f" | cut -d' ' -f1)
  [ "$a" = "$b" ] && echo "MATCH $f" || echo "DIFF  $f"
done

# B. 本件自检（编号有序 + 预算 + 路径可达性 + 无空壳；必须直接取退出码，别接 | tail）
bash .workspace/session-handoff-skill/check-sections.sh handoff-skill_NEXT_SESSION_PROMPT.md; echo "exit=$?"
bash .workspace/session-handoff-skill/probe-reachability.sh handoff-skill_NEXT_SESSION_PROMPT.md; echo "exit=$?"

# C. vision 分档与声明一致性（期望末行 >>> 一致性: PASS（相等））
#    ！注意：C 段不是只读 —— analyze.py 会重写 research/vision-probe/tiers.json（重算，内容通常不变）
python3 research/vision-probe/analyze.py | tail -6

# D. 需要重测某模型时（新模型上新后照此追加）
cd research/vision-probe && python3 sweep.py --workers 4 --max-tokens 1200 --out raw_responses_new.jsonl --only <model-id> && python3 analyze.py
```

## §9 一句话开启方式

接手 `handoff-skill` 这条线：先让模型加载 `session-handoff` 的接手模式，读仓库根 `handoff-skill_NEXT_SESSION_PROMPT.md`，跑它的 `§0` 前置核对并复述前 3 个动作给我确认，然后做 `§2` 的 P0-1（派干净子代理模拟继任会话验收这份交接件）。

---

## 附录（不编号）

### 附录 A：`git status` 全文（生成时刻快照，按目录归类；不写会腐烂的硬数字）

- **归类**（稳定，不随会话继续写盘而变化）：
  - 本次会话新增：`M .gitignore`、`?? agent-skills/`、`?? research/vision-probe/`、`?? research/vision-crosscheck/`、`?? .workspace/session-handoff-skill/`
  - 本件自身与验证产物：`handoff-skill_NEXT_SESSION_PROMPT.md`（**本次自生成**，已于 `c5ac4c00` 入库，故当前 `git status` 中**不再出现**）；两份模拟接手报告**生成后已移入 `.workspace/session-handoff-skill/`**（`receiver-sim-report.md`、`receiver-sim-round2.md`），并以该路径为准
  - 前序会话遗留：29 `M` + 3 `D` + 其余 `??`，与 `.workspace/lag-fix/`、`.workspace/workstreams/`、`docs/` 相关批次产物与文档同步
- **逐行原文与总数**：`git status --short | tee .dsh/handoffs/.gs-snapshot.txt | wc -l`（落**工作区**而不是 `/tmp`；`/tmp` 的持久性取决于沙箱模式，见 `§7` 坑 2）。
- **数字口径**：`§1` 给出的总数只对应生成时刻；本会话在本件生成后仍继续写盘，**接手方重跑必然更大**（实测：生成时 387 → 第二轮模拟报告落盘后 388），这不是"基线被改写"。

> 未逐行粘贴的原因已如实声明：`§1` 只放摘要与指针，避免把这一节变成流水账；逐行原文随时可由上述命令重建。

### 附录 B：时间线

- 11:0x–11:2x 调研四件套并行派发并回收（联网同类生态 / DSH skill 机制 / 本地交接历史审计 / 竞品源码核实）
- 11:2x–11:4x 5 个竞品仓库源码全量取回并逐文件核实（`research/.dl/`、`research/.tmp-fetch/`）
- 11:4x–11:5x grill-me 8 轮交互裁决 → `plan.md`；审计档 → `audit.md`（12 条修订 + 8 单元）；执行档落地 → `exec.md`
- 11:55 提权拷贝权威副本到 `~/.dsh/skills/session-handoff/`；AGENTS.md 追加「交接协议」两行
- 11:35–12:01 vision 实测：探针图与冒烟 → 全量 212 请求 → 复核轮 48 → 重复轮 3×48 + 补采 8 → 分档 → `REPORT.md`
- 12:01 提权修正 `settings.yaml`（19 个模型补 `input: [text, image]`，备份 `settings.yaml.bak-visiondecl-20260925-120100`）
- 12:01:47 生成本件

### 附录 C：未核实项清单（取不到什么证、需要谁核实）

1. **DSH GUI 端到端未验证**：已核实门禁判据是 `inputModalities`（源码级）且配置已写入，但**未真实粘贴一张图**验证「A 级模型走原图直传」全链路。需要：用户在 GUI 里贴一张图复核。
2. **A 级模型的小样本项**：除 `claude-sonnet-4-6`(12)、`deepseek-v4.1-flash`(8)、`gpt-6-sol`(8)、`qwen3.8-max`(8) 外，多数 A 级模型仅 2 次观测。需要：关键场合追加重复轮。
3. **C 级不稳定的网关侧根因**：只确证现象与形态，未进网关排查（上游路由 / 格式转换丢图）。需要：网关侧访问权限。
4. **skill 在其他机器/profile 的可分发性**：仅在本机 `~/.dsh/skills`（rank 400）实测；若目标机器只用 `~/.agents/skills`（rank 500）需改放该处。需要：目标机器实测。
5. **`settings.yaml` 写入后的 DSH 侧热载**：配置已落盘且人工核对，但未重启/未做 GUI 复核（同第 1 条）。需要：GUI 复核。
