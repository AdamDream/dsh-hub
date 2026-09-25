# session-handoff skill — 方案契约（经用户 grill-me 逐轮裁决后批准）

- 状态：**已批准执行**（用户在 8 轮交互问答中逐项裁决，最后批准本方案）
- 目标 goal：`goal-02598d0f-fece-426d-ab49-c4e45097a15a`
- 事实基线：仓库 `/home/CNS2026495165/dsh`，分支 `main`，HEAD `fa118d91`
- 本文件是**审计档与执行档的唯一契约**。任何未写入本文件的决策一律视为未裁决，不得自行添加。

---

## 一、已裁决决策清单（不可自行变更、不可重开）

| # | 决策点 | 裁决 |
|---|---|---|
| 1 | skill 名 | `session-handoff`（kebab-case，符合 `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`） |
| 2 | 触发方式 | **仅显式调用**（用户 `/session-handoff` 或 skill 工具指名）；**不设** `disable-model-invocation`，保留模型自行加载的可能 |
| 3 | 权威落盘 | `~/.dsh/skills/session-handoff/`（用户级，rank 400，全工作区生效） |
| 4 | 分发快照 | 仓库内 `agent-skills/session-handoff/`（**非 DSH 发现路径**，不会遮蔽用户级）；手工同步，不做自动同步脚本；快照头部写明"权威副本在用户级" |
| 5 | 交接产物 | 仓库根 `<前缀>_NEXT_SESSION_PROMPT.md`；**一律带前缀**（无无前缀特例） |
| 6 | 历史归档 | `.dsh/handoffs/<前缀>_<YYYYMMDD-HHMMSS>.md`；**只留最近 20 份**，超出删最旧；归档目录写入 `.gitignore` |
| 7 | 前缀来源 | goal 关键词 → 若无 goal 则从本会话主线提炼 → 仍不明确则问用户；**绝不**静默用 `main`/`handoff` 等无信息前缀。生成前向用户展示 nominee 并允许修改 |
| 8 | 事实依据 | **强制取证、禁止凭 agent 记忆**；每条关键断言带行内标记 `[已核实]`（须附命令输出或文件路径）/ `[仅记忆]`（未取证） |
| 9 | 深度档位 | 深度版（标准内容 + Runbook + 历史坑 + 环境事实） |
| 10 | 交接范围 | 本会话快照 + 声明同仓并行会话/其他单元 |
| 11 | 双模式 | **生成模式 + 接手模式**（全新增量：竞品两者皆缺） |
| 12 | 与 program-notebook 边界 | **严格分离**：本 skill 不编辑 `docs/program-notebook.md`，只在文档中列"建议下个会话更新的 notebook 条目" |
| 13 | 文档语言 | 中文（硬编码，不做语言可配） |
| 14 | 启动块 | **必须包含**可直接粘贴到新会话的第一条指令（`§0`），且块内写明"先加载本 skill 的接手模式" |
| 15 | 取证范围 | 只读状态取证（`git status/diff/log`、路径存在性、goal/todo、读将被提及的文件）；**不主动跑构建/测试** |
| 16 | Runbook 写法 | 引用落盘 Runbook 文件路径 + **内嵌继续工作必需的关键命令** |
| 17 | 生成前交互 | 取证后先向用户确认 2–3 个真实未决项，再落盘 |
| 18 | 生成后自检 | **必须真跑命令**（竞品教训 1.17.0"从未运行却报 clean"）：逐条实跑文档中的 git 命令 + **通用**路径可达性扫描（自定位仓库根，**禁止硬编码本机路径**） |
| 19 | 篇幅预算 | **§0–§5 + §9 合计 ≤100 行**；§6–§8 与不编号附录不限；**禁空壳小节**（无内容的小节宁可省略） |
| 20 | §编号契约 | 固定 `§0`–`§9`，**编号含义永不改变**，新增只能往后加；省略小节时**不重排编号** |
| 21 | §3 与本附录 | `§3` 只留 ≤5 行摘要（结论 + commit/文件指向），详细过程与时间线进**不编号附录** |
| 22 | 勘误机制 | 采纳"勘误回写块"，位置在 YAML 元数据之后、`§0` 之前，**不编号**；由接手方实测后回写，可累积，每条带日期与证据 |
| 23 | 权威层级 | 四层：已裁决不得重开 / 已授权 / 未授权 / 已否决 |
| 24 | 引用户原句 | 关键裁决**必须引用户原句**；若该裁决只存在于对话、从未落盘，仍引原句但标 `[仅对话原文·未落盘]`，并在自检报告中建议用户落盘 |
| 25 | 死路专节 | `§6 已排除的死路与已证伪的假设` 独立成节 |
| 26 | 结构 | 固定小节 + 头部 YAML 元数据 |
| 27 | 聚焦模式 | 支持"只交接某条支线"（其余支线在索引表里各列一行状态） |
| 28 | git dirty | 写明未提交改动清单 + 处置建议；并写明"不得回滚已通过验证但未提交的实现" |
| 29 | 提交固定版本 | 生成前**提醒**用户"建议先提交固定版本"（其历史习惯），但**skill 自己不动 git、不自动提交** |
| 30 | 并发写保护 | 多单元同仓靠**前缀 + 索引表**区分；写入前记录目标文件当前哈希，发现已被其他会话改过**不静默覆盖**，先报告用户 |
| 31 | 脱敏 | **不加任何脱敏/密钥检查**（用户明确裁决；可分发风险自担） |
| 32 | 首条指令块位置 | `§0 你的第一件事`（可粘贴启动块）；`§9 一句话开启方式` 保留（面向人的那一句） |
| 33 | 自检后处理 | 落盘 → 自检 → 报告路径 + 自检结果 + 未核实项 + 归档体积 |
| 34 | frontmatter | `name` + `description`（≤500 字符）+ `metadata`（version/author/updated）；**无** `allowed-tools`（该字段不存在） |
| 35 | references 拆分 | 拆 `references/`（仿 `program-notebook` 的按需加载结构） |
| 36 | 接手模式序列 | 六步：加载 skill → 实跑核对 §0/§1 → 读勘误块回报偏差 → 复述理解与前 3 个动作 → 查 §2 前置条件闸门（不满足即停并问用户）→ 用户确认后才动手 |
| 37 | AGENTS.md | 在 `~/.dsh/AGENTS.md` 增补**两行精简版**「交接协议」（只写"何时用 + 产物位置"） |
| 38 | skill 点名 | 交接文档中**不写**"接手方应加载哪些 skill" |
| 39 | 验收 | ①frontmatter 合法 ②实测 skill 加载 ③用**本次会话**产出真实交接件并通过全部自检 ④**派干净子代理模拟继任会话**验证自足性 ⑤归档 ≤20 份、两处副本 SHA 一致、AGENTS.md 新节存在 |
| 40 | 执行方式 | 审计档拆细粒度交付单元 → 修订执行复核一体档落地并自复核 |

---

## 二、交付物清单

| 路径 | 作用 | 写入方 |
|---|---|---|
| `~/.dsh/skills/session-handoff/SKILL.md` | 权威副本（DSH 实际加载） | 执行档写工作区暂存 → **主代理提权拷贝** |
| `~/.dsh/skills/session-handoff/references/*.md` | 按需加载细则 | 同上 |
| `agent-skills/session-handoff/`（仓库内） | 分发快照（手工同步） | 执行档直接写 |
| `~/.dsh/AGENTS.md` | 增补两行「交接协议」 | **主代理提权写入**（工作区外） |
| `.dsh/handoffs/` | 交接文档历史归档（入 .gitignore，保留 20 份） | 生成模式首次运行时创建 |
| `<前缀>_NEXT_SESSION_PROMPT.md`（仓库根） | 本次会话的真实交接件（验收产物） | 主代理/执行档 |

**关键约束**：子代理继承本会话沙箱（workspace-write），**无法写 `~/.dsh/`**。因此执行档只写工作区内路径（`agent-skills/session-handoff/` 作为暂存与分发快照同体），由主代理提权拷贝到 `~/.dsh/skills/session-handoff/`。

### references 划分（4 个文件）

| 文件 | 内容 |
|---|---|
| `references/handoff-spec.md` | 交接文档规范：§0–§9 职责表与**禁止漂移**说明、YAML 元数据字段表、勘误块格式、`[已核实]/[仅记忆]` 标记法、四层权威定义、100 行预算归属、前缀命名与归档规则、聚焦模式 |
| `references/generate-playbook.md` | 生成七步 + 取证清单 + **通用**路径可达性自检片段（自定位仓库根，不硬编码本机路径；用 `git rev-parse --show-toplevel`）+ 归档裁剪 + 自检清单 |
| `references/resume-playbook.md` | 接手六步 + 前置条件闸门 + 勘误回写规则 + 复述模板 |
| `references/examples-and-pitfalls.md` | 两份历史真实交接件骨架摘录 + 竞品失败模式"不要这样做"清单 |

---

## 三、交接文档规范（`references/handoff-spec.md` 必须逐条落地）

### 文件名与归档
- 仓库根：`<前缀>_NEXT_SESSION_PROMPT.md`（一律带前缀）
- 归档：`.dsh/handoffs/<前缀>_<YYYYMMDD-HHMMSS>.md`，保留最近 20 份（超出删最旧），目录入 `.gitignore`

### 结构

| 位置 | 内容 |
|---|---|
| 头部 YAML | `generated_at` / `prefix` / `cwd` / `repo_root` / `git_head` / `git_branch` / `goal`(objective·id·revision) / `other_units[]`(同仓其他单元索引表：prefix·path·generated_at·one_line_status) / `archive`(dir·retained) |
| 勘误块（不编号） | 接手方实测后回写的偏差条目（日期 + 证据 + 修正内容），可累积 |
| `§0` | 你的第一件事（＝可直接粘贴的启动块；≤10 行；写明"先加载 `session-handoff` 的接手模式"、必读文件、不得重开事项、第一步动作） |
| `§1` | 客观事实基线（紧凑表，逐项 ≤2 行 + 指针；`git status` 全文放附录） |
| `§2` | 最高优先级任务清单（P0–P2 + 判定标准 + 前置条件闸门） |
| `§3` | 本会话已完成的工作（**≤5 行摘要**，结论 + commit/文件指向；详情入附录） |
| `§4` | 已裁决与权威四层（附用户原句；未落盘标 `[仅对话原文·未落盘]`） |
| `§5` | 待办与开放项（含"需你裁决"清单） |
| `§6` | 已排除的死路与已证伪的假设 |
| `§7` | 历史坑与硬约束（按代价排序） |
| `§8` | 关键文件索引 + Runbook 速查（引用式 + 内嵌关键命令） |
| `§9` | 一句话开启方式 |
| 不编号附录 | 详细过程与时间线、`git status` 全文、未核实项清单 |

预算：`§0`–`§5` + `§9` ≤100 行；正文其余与附录不限；**禁空壳小节**（无内容宁可省略，且**不重排编号**）。

### 生成七步
1. **前置检查**：读 goal（`get_goal`）；检测同仓其他单元交接件（`glob *_NEXT_SESSION_PROMPT.md`）；若工作树脏则**提醒**"建议先提交固定版本"（不自动提交）
2. **前缀提名与确认**：goal 关键词 → 主线提炼 → 不明确则问用户；展示 nominee 允许修改
3. **强制取证**：实跑 `git status --short` / `git diff --stat` / `git log --oneline -20` / `git rev-parse HEAD`；逐条核对文档将引用的路径是否存在；读将被提及的关键文件；读 goal/todo。**禁止**凭记忆写任何事实
4. **确认未决项**：向用户问 2–3 个真实未决问题（下一步优先级、是否有未声明的裁决等）
5. **落盘**：先把现有同前缀文件复制进 `.dsh/handoffs/`（若存在且哈希与记录不一致 → 报告用户、不静默覆盖），再写新文件
6. **自检闸门（必须真跑）**：§编号齐全有序；`§0–§5+§9` 行数实测 ≤100；路径可达性扫描 0 不可达；无空壳小节；每条关键断言有标记
7. **归档裁剪 + 报告**：保留 20 份；报告路径 + 自检结果 + 未核实项 + 归档体积

### 接手六步（`references/resume-playbook.md`）
1. 加载 `session-handoff` 接手模式
2. 按 `§0`/`§1` 实跑核对（`git rev-parse HEAD`、关键文件是否存在）
3. 读勘误块，回报与现状的偏差
4. 复述理解 + 前 3 个动作
5. 检查 `§2` 前置条件闸门，不满足**即停**并问用户
6. 用户确认后才动手；发现偏差回写勘误块

---

## 四、验收标准（可执行，逐条实测）

1. `SKILL.md` frontmatter 合法：`name` 匹配 `^[a-z0-9]+(-[a-z0-9]+)*$`；`description` 归一化后 ≤500 字符（`wc -c` 实测）；无非法字段
2. **实测调用** skill 工具 `name=session-handoff` 返回 `<skill_content>` 与 base directory
3. 用**本次会话**产出真实 `<前缀>_NEXT_SESSION_PROMPT.md`，通过全部自检（同生成七步第 6 步）
4. **派干净上下文子代理模拟继任会话**（只给交接文档 + 启动块），能在不追问用户的情况下完成：前置核对、复述理解、指出歧义；若必须追问才能开工 → 记为不达标，修文档或 skill 后重验
5. 归档 ≤20 份；`agent-skills/session-handoff/` 与 `~/.dsh/skills/session-handoff/` 文件 SHA-256 一致；`~/.dsh/AGENTS.md` 新节存在且不破坏既有结构

---

## 五、依据来源（审计档应重读，不得只信本文件）

- `/home/CNS2026495165/dsh/research/dsh-skill-mechanism-recon.md` — DSH skill 机制（发现根/优先级/frontmatter/500 字符/无 hooks/compaction 不可复用）
- `/home/CNS2026495165/dsh/research/handoff-history-audit.md` — 历史两份真实交接件骨架、taste 0.95 需求原文、`.md` vs `.txt` 两条裁决、`§N` 被 `AGENTS.md` 引用的实证
- `/home/CNS2026495165/dsh/research/handoff-skill-web-research.md` — 联网同类生态与模板小节（含"未找到"清单，勿当既有规范引用）
- `/home/CNS2026495165/dsh/research/competitor-agent-handoff-skill.md` — `WeirdSky924/agent-handoff-skill`（★29）与 `wan-huiyan/session-handoff` 全量源码核实
- `/home/CNS2026495165/dsh/research/competitor-dsh-handoff-plugins.md` — 三个 DSH 交接插件源码核实（含本机接口对拍）
- 历史交接件实物：`.workspace/reports/handoff/NEXT_SESSION_PROMPT.txt`（228 行）、`.workspace/lag-fix/NEXT_SESSION_PROMPT.txt`（56 行）
- 既有探针：`.workspace/lag-fix/probes/check-executable-refs.sh`（**硬编码本机 ROOT，不可复用**，只借其"可达性体检"思想）

## 六、明确不抄的竞品坑

1. 靠文案 + 正则抠会话 id（文案即协议，宿主改词客户端静默失效）
2. 依赖未承诺的内部 API（如 `row.projections.values`）
3. 2400 字符硬预算（适合省 token，不适合交接完整性）
4. 只注入会话内不落盘（竞品 `WeiYe6/dsh-session-handoff` 的做法）
5. 客户端 slot 名硬编码（已被上游 UI 拆分打坏过）
6. 无强制取证机制的交接（竞品 repo1 仅 system prompt 一句 `do not invent facts`）

## 七、已知张力与边界（写入 references 时如实声明）

1. `§1` 计入 100 行预算而事实基线天然长 → 缓解：紧凑表 + 详情入附录
2. 两处副本手工同步可能漂移 → 靠快照头部声明 + 验收校验哈希
3. 不做脱敏 → 可分发文档可能含内网地址/凭证，用户已知悉自担风险
4. DSH 无 hook → 完全依赖显式加载，`description` 是唯一目录入口
5. 未验证项：本 skill 未在其他机器/profile 实测，"可分发"声明仅基于机制事实
