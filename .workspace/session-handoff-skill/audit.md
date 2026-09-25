# session-handoff skill — 审计报告（审计档）

- 审计对象：`.workspace/session-handoff-skill/plan.md`（161 行，40 条决策，用户已批准）
- 事实基线核对：分支 `main`、HEAD `fa118d91` —— 与 plan.md:5 一致（`git rev-parse --abbrev-ref HEAD` / `git rev-parse --short HEAD` 实测）
- 本档只读 + 只写本文件与 `.workspace/session-handoff-skill/` 下的实测脚本；未改任何交付物
- 证据纪律：凡机制断言均回源码或实跑命令；无法核实者标「未核实」

---

## A. 审计裁决

**需按下列修订实施**（R1–R12）。

方案主体（40 条决策、交付物清单、交接文档规范）**成立、可实现、与 DSH 真实机制相容**；
但存在 **2 处硬冲突**（R2、R3，均涉及 U7 与验收 5）、**1 处计量错误**（R1，会让验收假阴性）、
**3 处空洞/遗漏**（R4、R6、R12）、**2 处判据不可客观判定**（R8、R9）、**3 处表述不精确**（R5、R10、R11）、
**1 处引用歧义**（R7）。以上均不推翻任何已裁决决策，只做**精确化与补洞**。

| # | 问题 | 证据 | 修订内容 |
|---|---|---|---|
| **R1** | 验收标准 1 用 `wc -c` 实测 `description` 字符数 —— `wc -c` 计**字节**，DSH 实际计 **UTF-16 字符数**。中文描述会**假阴性**：实测 257 字符 = 613 字节，`wc -c` 会误报 >500 | plan.md:128 `（wc -c 实测）`；`dsh-tool-skill/lib/index.js:338-341`：`const normalized = value.replaceAll(/\s+/g," ").trim(); return normalized.length <= maxLength ? ...`；实测 `printf '%s' "把当前会话的工作内容、进展与目标整理成仓库根" \| wc -c` → **66**，`\| wc -m` → **22**；实测候选 description：`len=257 wc -m=257 wc -c=613` | 验收 1 改为：**复刻归一化（`replaceAll(/\s+/g," ")` + `trim()`）后取 `.length` ≤500**；退路 `wc -m`。**禁止**用 `wc -c`。另记：超限时 DSH 会切成 `slice(0,497)+"..."`（实测 600→500，`endsWith("...")==true`），故有效正文上限是 **497** |
| **R2** | 决策 4（分发快照**头部声明**"权威副本在用户级"）与验收 5（两处副本 **SHA-256 一致**）**硬冲突**：快照若多一段独有头部，两文件不可能字节相同 | plan.md:17 决策 4「快照头部写明"权威副本在用户级"」；plan.md:132 验收 5「`agent-skills/session-handoff/` 与 `~/.dsh/skills/session-handoff/` 文件 SHA-256 一致」 | **声明改写为 SKILL.md 正文的一个小节，两副本同体**（内容一致 → SHA 相同 → 同时满足决策 4 与验收 5）。**唯一解释**：不新建只存在于快照的独立文件、不加任何仅快照才有的字节。小节建议标题 `## 副本与同步` |
| **R3** | U7 若把声明放在 frontmatter **之前**，该 SKILL.md 会被**静默忽略**（技能整体不加载） | `dsh-skill-filesystem/lib/index.js:772-775`：`if (raw.slice(0, firstLineEnd).replace(/\r$/,"") !== "---") return void 0;`；`:675-677` → `skill file … ignored: missing YAML frontmatter`（仅 warn，不报错） | 硬约束：**首行必须严格是 `---`**。声明只能放 (a) frontmatter **之后**的正文，或 (b) frontmatter **内部**的 YAML `#` 注释。禁止任何前置标题/HTML 注释/说明行 |
| **R4** | 生成七步未包含创建目录，而 `.dsh/handoffs/` 与 `agent-skills/` **当前都不存在** | 实测 `ls -la .dsh/handoffs/` → `没有那个文件或目录`；`ls -la agent-skills/` → `没有那个文件或目录`；plan.md:65 仅写「生成模式首次运行时创建」，plan.md:107-114 七步无 `mkdir` | 步骤 5 显式补 `mkdir -p .dsh/handoffs`；U1/U2–U5 落盘前 `mkdir -p agent-skills/session-handoff/references` |
| **R5** | 决策 20「编号含义**永不改变**」被 plan **自身**打破：本方案把历史件的 §6/§7/§8 含义整体改写 | 历史 228 行件：§6=历史坑与硬约束、§7=关键文件索引、§8=方法论、§9=一句话（`.workspace/reports/handoff/NEXT_SESSION_PROMPT.txt:165,186,213,224`）；plan 定：§6=死路、§7=历史坑、§8=索引+Runbook（plan.md:99-101）；`research/handoff-history-audit.md:195-196` 有**外部仓** `mcu-hil/AGENTS.md` 按 `§2 裁决 2`/`§6 第 2 条`/`§4 P2` 引用**旧编号**的实证 | spec 必须声明：**§0–§9 是本 skill v1 契约，不与 2026-09 之前的历史交接件编号兼容**；若被替换的历史件其 `§N` 已被下游文档引用，生成时须提示作者同步更新引用。决策 20 的「往后加」落地为：**新增编号只能 ≥ §10，且置于不编号附录之前**（§9 含义固定为最后一个编号小节） |
| **R6** | 决策 27「聚焦模式」在四份 references 与生成七步中**没有任何落点**（空洞）：无人规定如何进入、如何自检 | plan.md:40 决策 27「支持只交接某条支线（其余支线在索引表里各列一行状态）」；对照 plan.md:74-77（references 划分，仅 spec 提「聚焦模式」一句）与 plan.md:107-114（七步无聚焦模式） | `generate-playbook.md` 增**步骤 1.5「判定聚焦模式」**（触发：用户指定支线/前缀/范围）；`handoff-spec.md` 增**聚焦模式下索引表的强制形状**（其余支线各一行：prefix·path·generated_at·one_line_status）；自检增一项：聚焦模式下索引表行数 = 其余活跃支线数 |
| **R7** | plan §六 的「repo1」**有歧义**：两份竞品报告各自把不同的仓库叫 repo1 | `research/competitor-agent-handoff-skill.md:28`：repo1 = `WeirdSky924/agent-handoff-skill`；`research/competitor-dsh-handoff-plugins.md:42`：repo1 = `WeiYe6/dsh-session-handoff`。§六.6 的 `do not invent facts` 证据实际在 **plugins 报告** `:33` 与 `:281`（`lib/llm.mjs:17`） | U5 引用一律**写全仓库名 + 报告文件名 + 行号**，禁止使用「repo1/repo2」这类局部标签 |
| **R8** | 验收 4（干净子代理模拟继任会话）判据是**主观**的（"能完成…若必须追问即不达标"），不可客观判定 | plan.md:131 | 改为 **5 项客观清单**，全部满足才算通过：①报出 `repo_root` ②报出 `git_head` 与 §1 的一致/不一致 ③复述前 3 个动作且与 §2 的 P0–P2 对应 ④显式指出 ≥1 处歧义，或显式声明"未发现歧义" ⑤给出 §2 闸门判定（通过/停并问）。且**全程未向用户提问** |
| **R9** | 验收 5「不破坏既有结构」是**主观**的 | plan.md:132 | 改为可判定：`git diff --stat -- ~/.dsh/AGENTS.md`（提权后）**仅有新增行、0 删除行**，且既有 `^#` 标题数量与增补前一致（`grep -c '^#' ` 前后相等） |
| **R10** | 决策 34「**无** `allowed-tools`（该字段不存在）」表述不精确：源码**不拒绝**未知字段，而是**静默忽略**；真正会**抛错并导致整份 SKILL.md 被忽略**的只有 3 个 camelCase 旧键 | `dsh-skill-filesystem/lib/index.js:833-840`：只读 `name`/`description`/`whenToUse`/`metadata` 四个键；`:841-853` `rejectLegacyInvocationKey` 对 `disableModelInvocation`/`modelInvocable`/`userInvocable` **throw**，抛错在 `:692-694` 被捕获 → **整个技能文件被丢弃**；实证未知字段被忽略：`~/.dsh/skills/program-notebook/SKILL.md:4` 有 `license: MIT`，而解析器从不读取 `license` | 验收 1 的「无非法字段」改为**可判定**：`grep -nE '^(disableModelInvocation\|modelInvocable\|userInvocable):' SKILL.md` 必须**为空**（这 3 个会致命）。同时明确：`whenToUse` 是**合法**字段但 plan 未授权使用 → **不加**；沿用 `program-notebook` 的 `license:` 写法 → **不加**（未授权且无作用） |
| **R11** | 生成步骤 1 的 `glob "*_NEXT_SESSION_PROMPT.md"` 语义是**全树任意深度**，不是"仓库根" | 实测 `glob "*_NEXT_SESSION_PROMPT.md"`（path=/home/CNS2026495165/dsh）→ `No files found`；`find . -name "*NEXT_SESSION_PROMPT*"` → 两件均为 **`.txt`** 且在 `.workspace/` 深处 | 明确注释：glob 用于**全树**发现同仓其他单元交接件（支撑决策 10/30 的索引表）；**仓库根**同前缀文件的存在性与哈希必须用显式 `ls` / `shasum` 判定，不得用 glob 的返回值代替 |
| **R12** | 生成的仓库根 `<前缀>_NEXT_SESSION_PROMPT.md` **自身**会作为未跟踪文件进入 §1 的 `git status`，形成自指噪声；而决策 6 只忽略归档目录，未处理根文件 | 实测 `git check-ignore -v .dsh/handoffs/test.md` → `exit 1`（**未被忽略**）；`git ls-files .dsh` → 空（`.dsh/` 完全未跟踪）；plan.md:19 决策 6 只规定归档目录入 `.gitignore` | spec 增一条：§1 必须把本次自生成的 `<前缀>_NEXT_SESSION_PROMPT.md` 标注为「**本次自生成，非待处理改动**」。**唯一解释**：**不**把仓库根交接件加入 `.gitignore`（plan 未授权，"一律带前缀"的交接件应可被提交与传递） |

---

## B. 方案内部一致性检查（逐条结论）

### B1. 40 条决策之间是否有冲突

先记：**40 条决策确认为 40 条**（plan.md:16–55，逐行计数 `#1`–`#40`）。

| 检查项 | 结论 | 依据 |
|---|---|---|
| 决策 5「一律带前缀」 vs 决策 6 归档命名 | ✅ **一致**，无冲突 | plan.md:18-19；两者都要求 `<前缀>_…`，归档只多一个 `<YYYYMMDD-HHMMSS>` |
| 决策 5 vs 决策 7（绝不静默用无信息前缀） | ✅ **一致** | plan.md:20；决策 7 是决策 5 的前置约束，非例外 |
| 决策 20「省略小节不重排编号」 vs 决策 19「禁空壳小节，无内容宁可省略」 | ✅ **一致**（同一条规则的两面：可省略、但省略后不留空洞/不重排） | plan.md:32-33；plan.md:105 |
| 决策 19「100 行预算」 vs 决策 9「深度版（标准+Runbook+历史坑+环境事实）」 | ✅ **不冲突** —— 因为深度内容主要落在**不受限**的 §6–§8 与与不编号附录：Runbook 在 §8、历史坑在 §7、死路在 §6（plan.md:99-101），§6–§8 明示「不限」（plan.md:32,105）。仅「环境事实」(§1) 在预算内 —— plan 已在 §七.1 自陈张力并给出缓解（紧凑表+详情入附录） | plan.md:32、:99-101、:105、:157 |
| 决策 27「聚焦模式（其余支线在索引表各列一行）」 vs 索引表完整性 | ⚠️ **规范上一致，但落地空洞** → 见 **R6** | plan.md:40 vs :74-77、:107-114 |
| 决策 21「§3 ≤5 行摘要」 vs 决策 19「≤100 行」 | ✅ **一致**（≤5 是更严的子约束） | plan.md:34、:96 |
| 决策 14「§0 必须含可粘贴启动块」 vs 决策 32「§9 保留面向人的一句话」 | ✅ **一致**：§0 面向**下一个 agent**（含"先加载接手模式"）、§9 面向**人**。但 plan 未把这一区分写成明文 → **下档须在 spec 写明**，否则两节会写成同义重复 | plan.md:27、:45 |
| 决策 22「勘误块在 YAML 之后、§0 之前，不编号」 vs 决策 26「固定小节 + 头部 YAML」 | ✅ **一致** | plan.md:35、:39；spec 表 plan.md:92 与 plan.md:93 顺序相符 |
| 决策 20「编号含义永不改变」 vs plan 自身重定义 §6/§7/§8 | ❌ **冲突** → 见 **R5** | plan.md:33 vs :99-101；历史件 :165,186,213,224 |

### B2. `references/` 四文件职责边界

**结论：边界基本清晰，但有 3 处重叠风险 + 1 处空洞（R6）。**

| 项 | 结论 | 修订 |
|---|---|---|
| **重叠 1：前缀命名与归档规则** | `handoff-spec.md` 被指派「前缀命名与归档规则」（plan.md:74），`generate-playbook.md` 又有步骤 2「前缀提名与确认」+ 步骤 7「归档裁剪」（plan.md:109,114）→ 同一规则两处表述，必然漂移 | **spec 持有规则（唯一权威）**，playbook 只写步骤动作并**指回 spec 小节号**，不复制规则文本 |
| **重叠 2：勘误块** | spec 定义**格式**（plan.md:74），resume-playbook 定义**回写规则**（plan.md:76）。职责可切分，但必须显式互相指引 | spec 写格式 + 指向 resume-playbook 的回写时机；resume-playbook 写时机 + 指向 spec 的格式，**均不重述对方内容** |
| **重叠 3：自检清单 vs 规范数值** | `generate-playbook.md` 有「自检清单」（plan.md:75），spec 有「100 行预算归属」（plan.md:74） | 自检项**只写"跑哪个命令、判据是什么"**，数值上限一律引用 spec，不在 playbook 重复「100 / 20 / 500」这些数字 |
| **空洞：聚焦模式** | 仅 spec 一句，无步骤、无自检 → **R6** | 见 R6 |
| **SKILL.md 正文该写什么** | 按 plan.md:48「仿 program-notebook 的按需加载结构」+ 样板实证：`program-notebook/SKILL.md` 正文只放 ①核心原则 ②「缓存友好的按需加载」+ 一张**「当前任务 → 按需读取哪个 reference」表** ③固定文档边界 ④工作流步骤；细则全在 `references/*.md`（实测该 skill 仅 2 个 reference 文件） | SKILL.md **只写**：触发条件、核心原则（强制取证/不重排编号/勘误可累积）、**按需加载表**、生成/接手两模式入口（各 ≤6 行，细则指向 reference）、最终回复格式。**不写**：§0–§9 逐节职责表、YAML 字段全表、七步/六步全流程、bash 片段、历史骨架、竞品清单 |

### B3. `description` 候选（已实测字符数）

按 DSH 真实计量（**复刻 `dsh-tool-skill/lib/index.js:338-341` 的 `replaceAll(/\s+/g," ")` + `trim()` 后取 `.length`**）：

**候选 A（推荐，257 字符 / 613 字节，✅ 合格）**

```
把当前会话的工作内容、进展与目标整理成仓库根 `<前缀>_NEXT_SESSION_PROMPT.md`，供下一个会话快速接手；也提供接手模式：读取既有交接文档、实跑核对现状、回报偏差、复述理解、按前置闸门开工。用于用户要求交接/交班/换会话继续、会话即将结束或上下文将满、需跨会话续接工作、或拿到一份 *_NEXT_SESSION_PROMPT.md 要接着干时。生成件含可粘贴启动块、事实基线、任务优先级、已裁决不得重开、死路、历史坑、关键文件索引与 Runbook，历史归档于 .dsh/handoffs/。
```

- 实测：`len=257  wc -m=257  wc -c=613` → **合格（≤500 字符）**
- ⚠️ 若按 plan.md:128 原写法用 `wc -c`，会得 613 而**误判超限**（见 R1）
- 两模式与触发条件均已表达：生成（"整理成…供下一个会话快速接手"）、接手（"也提供接手模式…"）、触发（"用于用户要求交接/…"）

**候选 B（保守裁剪版，167 字符 / 387 字节，✅ 合格且 `wc -c` 也过）**

```
把当前会话的工作内容、进展与目标整理成仓库根 `<前缀>_NEXT_SESSION_PROMPT.md`，供下一个会话快速接手；同时提供接手模式。触发场景：用户要求交接/交班/换会话继续/整理进度给下一个会话；会话即将结束或上下文将满；需要跨会话续接工作；以及拿到一份 *_NEXT_SESSION_PROMPT.md 需要接着干时。
```

- 实测：`len=167  wc -m=167  wc -c=387`
- **推荐采用 A**（信息更全，余量 243 字符充足）；B 仅作 A 被主代理否决时的退路。

**裁剪版（若 A 将来被扩写超限）**：删末句产物清单，保留前两句，可降至约 150 字符。**不要**在超限时依赖 DSH 自动截断 —— 截断会切在 `slice(0,497)+"..."`，句中折断且丢失"接手模式"语义。

### B4. `metadata` 与 DSH 对未知字段的处理

**结论：`metadata` 完全兼容，可放心使用。**

- 源码依据：`dsh-skill-filesystem/lib/index.js:871-875`
  `function optionalMetadata(data){ const value = data.metadata; if (typeof value === "object" && value !== null && !Array.isArray(value)) return { metadata: value }; return {}; }`
  → **只要求是「非 null、非数组的对象」**，内部键名/类型**不做任何校验**。
- 且已透传到加载结果：`:132` `...parsed.metadata !== void 0 ? { metadata: parsed.metadata } : {}`（`provider.get()` 返回值含 `metadata`）
- **实测 YAML 取值类型**（`yaml@^2.4.2`，即源码 `import { parse } from "yaml"`）：未加引号的 `updated: 2026-09-25` 解析为**字符串 `'2026-09-25'`，不是 Date**；`version: 1.0.0` → 字符串 `'1.0.0'`。
  → **不存在**"未加引号变 Date 对象"的风险。仍建议统一加引号（防御性，且与 `program-notebook` 的写法无冲突）。
- **未知字段处理（实测 + 源码）**：**静默忽略**，不抛错。只有 3 个 camelCase 旧键会 `throw` 并导致**整个技能文件被丢弃**（见 R10）。

### B5. 生成七步 / 接手六步中 agent 真跑不了的步骤

| 步骤 | 可执行性 | 证据 | 可执行替代 |
|---|---|---|---|
| 生成 1 `get_goal` | ✅ **可执行**，且**无 goal 时不报错** | 本档实测 `get_goal` → `{"goal":null}`（本档为子代理，无自身 goal；主会话有 goal，见 peer board `goal-02598d0f-…`） | 保持；但须写明：返回 `{"goal":null}` 是**正常分支**，直接走决策 7 的「从本会话主线提炼」 |
| 生成 1 `glob "*_NEXT_SESSION_PROMPT.md"` | ⚠️ 可执行但**语义与预期不符**（全树而非仓库根） | 实测返回 `No files found`；历史两件是 `.txt`（`find` 实证） | 见 **R11**：glob 用于全树发现；仓库根同前缀判定用 `ls`+`shasum` |
| 生成 3 取证 git 命令 | ✅ 可执行 | `git status --short` / `git diff --stat` / `git log --oneline -20` / `git rev-parse HEAD` 均为只读 | 保持；只读取证符合决策 15（不跑构建/测试） |
| 生成 5 `mkdir -p .dsh/handoffs` | ❌ **原缺口**：目录不存在且七步未提 | `ls -la .dsh/handoffs/` → `没有那个文件或目录` | 见 **R4**：步骤 5 补 `mkdir -p` |
| 生成 5 记录/比对目标文件哈希 | ✅ 可执行（`shasum -a 256`），但**首次运行无同前缀文件** | 仓库根无 `*_NEXT_SESSION_PROMPT.md`（`find` 实证） | 写明**两分支**：无同前缀文件 → 跳过归档复制；有 → 复制进归档后再写新文件 |
| 生成 6 路径可达性扫描 | ❌ 不能复用既有探针 | `.workspace/lag-fix/probes/check-executable-refs.sh:17` `ROOT="/home/CNS2026495165/dsh"` —— **硬编码本机路径** | 用 U3 的**通用片段**（已实测，见 C.U3） |
| 生成 7 归档裁剪到 20 份 | ✅ 可执行 | 本档实测：25 份 → `ls -1t \| tail -n +21` 删除 → 20 份 | 用 U3 的已实测片段 |
| 接手 2 `git rev-parse HEAD` + 文件存在性 | ✅ 可执行 | 只读 | 保持 |
| **写 `~/.dsh/skills/session-handoff/`** | ❌ **子代理不可执行** | 本档沙箱为 workspace-write：**只可写 `/home/CNS2026495165/dsh`**；plan.md:68 亦已自陈 | **由主代理提权拷贝**（plan.md:61,68 已定，保持）。执行档只写 `agent-skills/session-handoff/` |
| **写 `~/.dsh/AGENTS.md`** | ❌ **子代理不可执行** | 同上（`~/.dsh/` 在工作区外） | **主代理提权写入**（plan.md:64 已定，保持） |
| **验收 2「实测调用 skill 工具」** | ⚠️ **时序依赖**：必须先由主代理完成用户级拷贝 | `dsh-tool-skill/lib/index.js:123` 每次调用**实时** `ctx.skills.list(lookup)` 查注册表 → 拷贝后应可热发现（`SkillWatchManager`+chokidar，`:191-214`） | 明确**闸门顺序**：执行档写快照 → **主代理拷贝** → 再由（子）代理跑 `skill(name=session-handoff)` 验证 |

> 附：`skill` 工具返回体**不含 `description`**，只有 `name`/`provider`/`resourceBase`/`content`（`dsh-tool-skill/lib/index.js:129-135`）。
> ⇒ 验收 2 的「返回 `<skill_content>` 与 base directory」应写作 **`resourceBase`**（其 `{kind:"directory", path:…}` 即 base directory）。
> ⇒ 并再次印证 plan.md:160「`description` 是唯一目录入口」：description 只出现在 **catalog** 里，且**会被截断到 500**。

### B6. 通用路径可达性自检的技术方案（已实测）

**要求**：自定位仓库根、不硬编码本机路径、能从 Markdown 反引号与正文明文提取路径并检测存在性。

**实测脚本**：`.workspace/session-handoff-skill/probe-reachability.sh`（本档落盘，可直接作为 U3 的待嵌入片段；`bash -n` 通过）

实测结果（真跑了 3 份真实文档）：

| 文档 | checked | missing | 退出码 |
|---|---|---|---|
| `.workspace/session-handoff-skill/plan.md` | 13 | 3（均为**尚未创建**的目标文件：`agent-skills/session-handoff`、`~/.dsh/skills/session-handoff`、`…/SKILL.md`） | 1 |
| `.workspace/reports/handoff/NEXT_SESSION_PROMPT.txt` | 34 | 21（历史件引用了已删除/迁走的路径 —— 证明**真能查出错**） | 1 |
| `.workspace/lag-fix/NEXT_SESSION_PROMPT.txt` | 7 | 1 | 1 |

**开发中实测抓到的 3 个真 bug（务必写进 U3，避免执行档重蹈）**：

1. **`grep -E` 不支持 `(?:…)` 与 `\b`** —— 初版 PAT 用了 `(?:agent-skills|research)/`，导致只剩 1 条命中（`checked=1`）。**必须写纯 ERE**。
2. **尾部标点剥离不能包含 `.`** —— 初版 `p="${p%%[\`),.:;]*}"` 会把 `docs/program-notebook.md` 截成 `docs/program-notebook` → 假 MISSING。**必须逐字符剥离 `` ` ``,`)`,`,`,`;`,`:` ``，保留 `.md`**。
3. **glob 通配会因 `*` 断词造假 MISSING** —— `.workspace/backup-*/` 被匹配成 `.workspace/backup-` → 假 MISSING。**PAT 末尾加 `[*/]?`，并在 `*` 命中时跳过**。

另注：`git rev-parse --show-toplevel` 自定位已验证（三份文档均正确报出 `repo_root=/home/CNS2026495165/dsh`）；`~/` 路径按 `$HOME` 展开（仓库外路径，如 `~/.dsh/skills/…`）。

### B7. 验收 5 条的可客观判定性

| # | 原文 | 可判定？ | 改写 / 判定命令 |
|---|---|---|---|
| 1 | frontmatter 合法；description ≤500（`wc -c`）；无非法字段 | ⚠️ **计量错 + 末项不可判定** | 改：①`name` 匹配 `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`（源码 `dsh-skill/lib/index.js:17` `SKILL_NAME` 一致 ✅）②description：**归一化后 `.length` ≤500**（禁止 `wc -c`，见 R1）③「无非法字段」→ `grep -nE '^(disableModelInvocation\|modelInvocable\|userInvocable):'` **为空**（见 R10） |
| 2 | 实测调用 skill 工具返回 `<skill_content>` 与 base directory | ✅ 可判定（措辞需精确） | 调 `skill(name="session-handoff")` → 返回体含 `content` 与 `resourceBase`（源码 `dsh-tool-skill/lib/index.js:129-135`）。**前置闸门**：主代理已完成用户级拷贝（见 B5） |
| 3 | 用本次会话产出真实交接件并通过全部自检 | ✅ 可判定 | 逐条跑 U3 的 4 个自检命令，全绿；产物存在于仓库根 |
| 4 | 派干净子代理模拟继任会话验证自足性 | ❌ **主观** → **R8** | 改为 5 项客观清单（见 R8），全中且未追问用户 = 通过 |
| 5 | 归档 ≤20；两处 SHA-256 一致；AGENTS.md 新节存在且不破坏既有结构 | ⚠️ 前两项可判定，末项主观 → **R9** | ①`ls -1 .dsh/handoffs \| wc -l` ≤20 ②`shasum -a 256` 逐文件比对两处副本全等 ③（提权后）`git diff --stat -- ~/.dsh/AGENTS.md` 仅新增、`grep -c '^#'` 前后相等、新节标题可 grep 到 |

**另外补一条客观判据（plan 未列，但为 R2/R3 的直接验收）**：`head -1 agent-skills/session-handoff/SKILL.md` 必须**恰好**输出 `---`（R3），且两副本无一字节差异（R2）。

---

## C. 交付单元清单

> 通用约定
> - 执行档沙箱：workspace-write，**只写 `/home/CNS2026495165/dsh` 内**；`~/.dsh/**` 由**主代理提权**写入。
> - 仓库内唯一落盘根：`agent-skills/session-handoff/`（当前**不存在**，需 `mkdir -p`）。
> - 每个单元落盘后须跑该单元的验收命令；§ 编号与目录结构的自检脚本见 U3。
> - **凡 plan 未授权的字段/小节/skill，一律不加**（plan.md:6「任何未写入本文件的决策一律视为未裁决」）。

---

### U1 — `agent-skills/session-handoff/SKILL.md`

- **目标文件**：`/home/CNS2026495165/dsh/agent-skills/session-handoff/SKILL.md`（新建；需先 `mkdir -p agent-skills/session-handoff`）
- **依赖**：无（U2–U5 的路径已在正文引用，可在其之前落盘）
- **改动内容**（结构，小节级清单）：

  1. **frontmatter** —— **首行必须严格是 `---`**（R3）。字段**只**用 plan 决策 34 授权的 3 个：
     ```yaml
     ---
     name: session-handoff
     description: "<B3 候选 A 全文，257 字符>"
     metadata:
       version: "1.0.0"
       author: "CNS2026495165"
       updated: "2026-09-25"
     ---
     ```
     - **不加** `allowed-tools`、`license`、`whenToUse`（R10：未授权；`license`/`allowed-tools` 会被静默忽略，`whenToUse` 合法但无授权）
     - **禁止** `disableModelInvocation` / `modelInvocable` / `userInvocable`（会 throw → 整个技能被丢弃）
     - **不加** `disable-model-invocation`（决策 2：保留模型自行加载）
  2. 标题 `# 会话交接（Session Handoff）`
  3. `## 核心原则` —— 4 条，每条一句：①强制取证，禁止凭 agent 记忆（决策 8）②编号含义固定、省略不重排（决策 20）③勘误可累积、由接手方实测回写（决策 22）④只读取证，不跑构建/测试（决策 15）
  4. `## 缓存友好的按需加载` —— 仿 `program-notebook/SKILL.md` 的写法：3–4 条 bullet（本文件只放触发条件与核心工作流；只在需要时读 reference；已读且未变不重复读；不逐轮重复加载）+ **一张「当前任务 → 按需读取」表**，落到 U2–U5 四个文件
  5. `## 两种模式` —— 两个子小节，各 ≤6 行并**指向** reference（不复制细则）：
     - `### 生成模式`：触发（用户要求交接/交班/换会话继续/会话将尽/上下文将满）→ 「第一步读 `references/generate-playbook.md`；交接文档格式以 `references/handoff-spec.md` 为准」
     - `### 接手模式`：触发（拿到 `*_NEXT_SESSION_PROMPT.md` 或被要求接手）→ 「第一步读 `references/resume-playbook.md`」
  6. `## 边界` —— 2 条：①**严格不编辑 `docs/program-notebook.md`**，只在文档里列「建议下个会话更新的 notebook 条目」（决策 12）②不在交接文档里写「接手方应加载哪些 skill」（决策 38）
  7. `## 最终回复格式` —— 生成模式收尾须报：**产物路径 + 自检结果 + 未核实项 + 归档体积**（决策 33）
  8. `## 副本与同步` —— **R2 的落地**：一句声明「本 skill 权威副本位于 `~/.dsh/skills/session-handoff/`；仓库内 `agent-skills/session-handoff/` 为**分发快照**，**手工同步**」，并写入 `version`（与 frontmatter `metadata.version` 一致）
- **验收标准**（可执行）：
  - `head -1 agent-skills/session-handoff/SKILL.md` 输出恰为 `---`
  - `node -e` 复刻归一化取 `.length` → ≤500；**且** `grep -c . ` 无超限
  - `grep -nE '^(disableModelInvocation|modelInvocable|userInvocable):' agent-skills/session-handoff/SKILL.md` → **空**（退出码 1）
  - `awk 'NR==1{exit !($0=="---")}' file` → 退出码 0
  - 正文出现 `references/handoff-spec.md`、`generate-playbook.md`、`resume-playbook.md`、`examples-and-pitfalls.md` 四个文件名各 ≥1 次
- **歧义与唯一推荐解释**：
  - `metadata.author` 取值 plan 未定 → **推荐 `"CNS2026495165"`**（本机账户标识，可从 `$USER` 取得，最小可辩护值；若主代理认为不宜外泄，统一改 `"dsh"`，但**必须两副本一致**）。
  - `metadata.updated` 格式 plan 未定 → **推荐 `YYYY-MM-DD` 字符串（加引号）**；已实测 `yaml@2` 不加引号也是字符串（非 Date），加引号仅为防御。
  - **description 内出现反引号与前缀占位 `<前缀>`**：实测计数已含这两个字符，无需转义；YAML 用**双引号**包裹整串即可（串内无反引号冲突、无 `"` 字符）。

---

### U2 — `agent-skills/session-handoff/references/handoff-spec.md`

- **目标文件**：`/home/CNS2026495165/dsh/agent-skills/session-handoff/references/handoff-spec.md`（新建；需先 `mkdir -p …/references`）
- **依赖**：无
- **改动内容**（**规范唯一权威**；小节级清单，逐条覆盖 plan.md:81-105）：
  1. `## 文件名与归档` —— 仓库根 `<前缀>_NEXT_SESSION_PROMPT.md`（**一律带前缀，无例外**）；归档 `.dsh/handoffs/<前缀>_<YYYYMMDD-HHMMSS>.md`；**保留最近 20 份，超出删最旧**；归档目录入 `.gitignore`
  2. `## 头部 YAML 元数据` —— 字段表，逐字段给类型与来源：`generated_at` / `prefix` / `cwd` / `repo_root` / `git_head` / `git_branch` / `goal{objective,id,revision}` / `other_units[]{prefix,path,generated_at,one_line_status}` / `archive{dir,retained}`。**明示**：`goal` 可为 `null`（无 goal 会话，实测 `get_goal` → `{"goal":null}`）
  3. `## 勘误回写块（不编号）` —— 位置：**YAML 之后、§0 之前**；可累积；每条 = 日期 + 证据 + 修正内容；**写回时机指向 `resume-playbook.md`**（不在此重述时机）
  4. `## §0–§9 职责表` —— 10 行表，逐节给「职责 + 行数约束 + 禁止漂移说明」：
     §0 你的第一件事（可粘贴启动块，≤10 行，须写明「先加载本 skill 的接手模式」、必读文件、不得重开事项、第一步动作）；
     §1 客观事实基线（紧凑表，逐项 ≤2 行 + 指针，`git status` 全文入附录）；
     §2 最高优先级任务清单（P0–P2 + **可判定标准** + 前置条件闸门）；
     §3 本会话已完成（**≤5 行**摘要 = 结论 + commit/文件指向，详情入附录）；
     §4 已裁决与权威四层（附用户原句）；
     §5 待办与开放项（含「需你裁决」清单）；
     §6 已排除的死路与已证伪的假设；§7 历史坑与硬约束（按代价排序）；
     §8 关键文件索引 + Runbook 速查（引用落盘 Runbook 路径 + **内嵌继续工作必需的关键命令**）；
     §9 一句话开启方式
  5. `## 不编号附录` —— 详细过程与时间线、`git status` 全文、未核实项清单
  6. `## 编号契约` —— **R5 的落地**：①§0–§9 为本 skill **v1** 契约，**不与 2026-09 之前的历史交接件编号兼容**（历史件 §6=历史坑/§7=索引/§8=方法论，本契约 §6=死路/§7=历史坑/§8=索引+Runbook）②**省略小节不重排编号**、**禁空壳小节**（无内容宁愿省略）③新增编号只能 **≥§10 且置于不编号附录之前** ④若被替换的历史件其 `§N` 已被下游文档（如外部仓 `AGENTS.md`）按旧编号引用，生成时**必须提示作者同步更新引用**（依据 `research/handoff-history-audit.md:195-196`）
  7. `## 篇幅预算` —— `§0`–`§5` + `§9` 合计 **≤100 行**；`§6`–`§8` 与不编号附录**不限**；给出**计数口径**（标题形如 `## §N …`，仅计 §0–§5/§9 的正文行，不含标题行）+ **实测命令**（U3 的 `check-sections.sh`）
  8. `## 事实标记法` —— `[已核实]`（须附命令输出或文件路径）/ `[仅记忆]`（未取证）；关键裁决**必须引用户原句**，只存在于对话且从未落盘者引原句并标 `[仅对话原文·未落盘]`，同时在自检报告中建议用户落盘
  9. `## 权威四层` —— 已裁决不得重开 / 已授权 / 未授权 / 已否决
  10. `## 前缀命名与归档规则`（**唯一权威**，playbook 只指回此处）—— 提名顺序：goal 关键词 → 本会话主线提炼 → 不明确则问用户；**绝不**静默用 `main`/`handoff` 等无信息前缀；生成前**展示 nominee 并允许修改**
  11. `## 聚焦模式`（**R6**）—— 触发条件（用户指定支线/前缀/范围）；**索引表强制形状**：被聚焦支线正常书写，**其余每条支线在索引表各列一行**（`prefix`·`path`·`generated_at`·`one_line_status`）；未指定聚焦时索引表仍列全部同仓单元
  12. `## §0 与 §9 的分工`（plan 未明文，须补齐以免两节重复）—— §0 面向**下一个 agent**（含加载 skill 的指令、必读文件、第一步动作，可直接粘贴）；§9 面向**人**（一句可对模型说的话）
  13. `## 自指说明`（**R12**）—— §1 必须把本次自生成的 `<前缀>_NEXT_SESSION_PROMPT.md` 标注为「**本次自生成，非待处理改动**」；并声明该文件**不**入 `.gitignore`
- **验收标准**：
  - 上述 13 个小节标题 `grep -c '^## '` ≥13，且第 1/3/6/7/10/11/12/13 节均可 grep 到关键词（`归档`/`勘误`/`编号契约`/`篇幅预算`/`前缀命名`/`聚焦模式`/`§0 与 §9`/`自指`）
  - 表中 §0–§9 十节**齐全**（`grep -c '§[0-9]'` 覆盖 0–9 各 ≥1）
  - 文中出现 `20`（归档保留数）与 `100`（行预算）各 ≥1 次；且 `resume-playbook.md` 被引用 ≥1 次
  - **本文件不重复任何 bash 片段**（片段属于 U3）：`grep -c '```bash'` == 0
- **歧义与唯一推荐解释**：plan.md:74 把「100 行预算归属」放在 spec，而「自检清单」放在 playbook → **推荐：spec 拥有数值（100/20/500）与口径，playbook 只拥有命令与判据**，避免双写漂移。

---

### U3 — `agent-skills/session-handoff/references/generate-playbook.md`

- **目标文件**：`/home/CNS2026495165/dsh/agent-skills/session-handoff/references/generate-playbook.md`（新建）
- **依赖**：U2（格式规则指回 spec，不复制）
- **改动内容**：
  1. `## 生成七步` —— 逐步写，每步含「动作 + 命令 + 失败分支」：
     - **步骤 1 前置检查**：读 goal（`get_goal`；**`{"goal":null}` 是正常分支** → 走步骤 2 的「主线提炼」）；`glob "*_NEXT_SESSION_PROMPT.md"` 用于**全树**发现同仓其他单元交接件（**R11**：glob 是任意深度，不代表仓库根）；工作树脏则**提醒**"建议先提交固定版本"（**不自动提交**，决策 29）
     - **步骤 1.5 判定聚焦模式**（**R6**）—— 用户指定支线/前缀/范围则进入聚焦模式，索引表按 spec「聚焦模式」节书写
     - **步骤 2 前缀提名与确认** —— 按 spec「前缀命名与归档规则」；展示 nominee 允许修改
     - **步骤 3 强制取证** —— 实跑 `git status --short` / `git diff --stat` / `git log --oneline -20` / `git rev-parse HEAD`；逐条核对文档将引用的路径是否存在；读将被提及的关键文件；读 goal/todo。**禁止凭记忆写任何事实**
     - **步骤 4 确认未决项** —— 向用户问 2–3 个真实未决问题（下一步优先级、是否有未声明的裁决等）
     - **步骤 5 落盘** —— 先 `mkdir -p .dsh/handoffs`（**R4**）；若有**同前缀**既有文件：记录其哈希，与 `other_units` 记录比对，**不一致 → 报告用户、不静默覆盖**；一致则复制进归档；**若无同前缀文件则跳过归档复制**（明确两分支）。再写新文件
     - **步骤 6 自检闸门（必须真跑）** —— 跑下方 4 条命令，全绿方可继续
     - **步骤 7 归档裁剪 + 报告** —— 保留 20 份；报告路径 + 自检结果 + 未核实项 + 归档体积
  2. `## 取证清单` —— 表格：取证项 / 命令 / 记录进哪一节（§1 / §4 / §7 / §8）
  3. `## 通用路径可达性自检片段` —— **内嵌下方已实测脚本全文**，并写明三条**必须遵守**的写法（纯 ERE / 尾部剥离保留 `.md` / `*` 通配跳过）与三个实测 bug 教训（见 B6）
  4. `## 自检命令（逐条实测）` —— **内嵌下方 4 条已实测片段**：§编号与预算、路径可达性、无空壳小节、归档裁剪
  5. `## 自检清单` —— 勾选表：§编号齐全有序 / `§0–§5+§9` ≤100 行 / 路径 0 不可达 / 无空壳小节 / 每条关键断言有标记 / 索引表行数=其余活跃支线数（聚焦模式）；**数值上限一律引用 spec 小节，不重复数字**
  6. 末尾 `## 完成报告格式` —— 4 项：产物路径、自检结果、未核实项、归档体积
- **必须内嵌的已实测片段**（均为本档真跑通过，`bash -n` 无错）：

  **(a) 路径可达性（`probe-reachability.sh`，实测 checked=13/34/7，正确报出 missing 且退出码 1）**
  ```bash
  #!/usr/bin/env bash
  # 通用路径可达性自检：自定位仓库根，不硬编码本机路径。
  set -uo pipefail
  DOC="${1:?usage: probe-reachability.sh <doc>}"
  [ -f "$DOC" ] || { echo "FATAL: no such doc: $DOC" >&2; exit 2; }
  ROOT="$(git -C "$(dirname "$DOC")" rev-parse --show-toplevel 2>/dev/null)" \
    || { echo "FATAL: not inside a git repo: $DOC" >&2; exit 2; }
  echo "repo_root=$ROOT"
  # 纯 ERE（grep -E 不支持 (?:) / \b）
  PAT='\.workspace/[A-Za-z0-9._/-]+[*/]?|docs/[A-Za-z0-9._/-]+[*/]?|research/[A-Za-z0-9._/-]+[*/]?|agent-skills/[A-Za-z0-9._/-]+[*/]?|~/.dsh/[A-Za-z0-9._/-]+[*/]?'
  miss=0; tot=0
  while IFS= read -r p; do
    [ -z "$p" ] && continue
    # 逐字符剥尾部标点（必须保留 .md 内的点）
    while :; do
      c="${p: -1}"
      case "$c" in '`'|')'|','|';'|':'|'"'|"'") p="${p%?}";; *) break;; esac
    done
    p="${p#\`}"; [ -z "$p" ] && continue
    case "$p" in *'*'*|*'<'*|*'>'*|*'$'*) continue;; esac
    p="${p%/}"
    case "$p" in '~/'*) abs="$HOME/${p#\~/}";; *) abs="$ROOT/$p";; esac
    tot=$((tot+1)); [ -e "$abs" ] || { echo "MISSING: $p"; miss=$((miss+1)); }
  done < <(grep -oE "$PAT" "$DOC" 2>/dev/null | sort -u)
  echo "--- checked=$tot missing=$miss"
  if [ "$miss" -eq 0 ]; then echo "REACHABILITY: PASS"; exit 0; else echo "REACHABILITY: FAIL"; exit 1; fi
  ```
  注：必须**直接取退出码**（`bash probe.sh doc; echo $?`），不要 `| tail` 后再看 `$?`（会取到 `tail` 的退出码）。

  **(b) §编号齐全有序 + 预算（`check-sections.sh`，实测：缺 §2/§4/§5 时正确报 MISSING；181 行正确 FAIL；§6–§8 正确排除在预算外）**
  ```bash
  #!/usr/bin/env bash
  # 标题形如 "## §N ..."；§6-§8 可省略且不计入预算
  set -uo pipefail
  DOC="${1:?usage: check-sections.sh <doc> [budget]}"; [ -f "$DOC" ] || { echo "FATAL: no doc: $DOC" >&2; exit 2; }
  BUDGET="${2:-100}"
  mapfile -t SEC < <(grep -oE '^#{2,3}[[:space:]]*§[0-9]+' "$DOC" | grep -oE '[0-9]+')
  echo "sections found: ${SEC[*]:-<none>}"
  ok=1; prev=-1
  for n in "${SEC[@]}"; do
    if [ "$n" -le "$prev" ]; then echo "ORDER: FAIL (non-increasing $prev -> $n)"; ok=0; fi
    prev="$n"
  done
  for need in 0 1 2 3 4 5 9; do
    printf '%s\n' "${SEC[@]}" | grep -qx "$need" || { echo "MISSING SECTION: §$need"; ok=0; }
  done
  awk -v B="$BUDGET" '
    BEGIN { cur="skip"; c=0 }
    /^#{2,3}[[:space:]]*§[0-9]+/ { n=$0; sub(/^#{2,3}[[:space:]]*§/,"",n); sub(/[^0-9].*$/,"",n);
      cur=(n=="0"||n=="1"||n=="2"||n=="3"||n=="4"||n=="5"||n=="9") ? n : "skip"; next }
    { if (cur!="skip") c++ }
    END { printf "budget(§0-§5+§9) counted=%d limit=%d %s\n", c, B, (c<=B?"PASS":"FAIL") }
  ' "$DOC"
  [ "$ok" -eq 1 ] && echo "SECTIONS: PASS" || { echo "SECTIONS: FAIL"; exit 1; }
  ```

  **(c) 无空壳小节**
  ```bash
  # 任一 "## §N ..." 标题之后、下一个标题之前至少要有 1 行非空正文
  awk '/^#{2,3}[[:space:]]*§[0-9]+/ { if (h!="" && c==0) print "EMPTY SECTION: " h; h=$0; c=0; next }
       { if (h!="" && $0 ~ /[^[:space:]]/) c++ }
       END { if (h!="" && c==0) print "EMPTY SECTION: " h; print "EMPTY-CHECK DONE" }' "$DOC"
  ```

  **(d) 归档裁剪到 20 份（实测 25 → 20）**
  ```bash
  RETAIN=20; DIR=.dsh/handoffs
  ls -1t "$DIR" | tail -n +$((RETAIN+1)) | while read -r f; do rm -f "$DIR/$f"; done
  echo "retained=$(ls -1 "$DIR" | wc -l)"
  ```
- **验收标准**：
  - 文件含 7 个步骤标题（`grep -c '步骤'` ≥7 且含「1.5」）、且含 ```` ```bash ```` 块 ≥4 个
  - 4 条片段**逐一复制到临时文件并 `bash -n` 通过**；且 (a) 至少对 1 份真实文档跑通过并输出 `repo_root=` 行
  - 文档中出现 `mkdir -p .dsh/handoffs`（R4）与「聚焦模式」（R6）各 ≥1 次
  - `grep -c '100' ` 出现次数 ≤2（数值权威在 spec，避免双写漂移）
- **歧义与唯一推荐解释**：plan 把「取证清单 + 通用路径可达性自检片段 + 归档裁剪 + 自检清单」都放进本文件（plan.md:75）→ **推荐：本文件拥有可执行命令与判据；一切阈值数字（100/20/500）只在 spec 出现**。

---

### U4 — `agent-skills/session-handoff/references/resume-playbook.md`

- **目标文件**：`/home/CNS2026495165/dsh/agent-skills/session-handoff/references/resume-playbook.md`（新建）
- **依赖**：U2（勘误块**格式**指向 spec）
- **改动内容**：
  1. `## 接手六步` —— 逐步写明动作与判据（plan.md:116-122）：
     1. 加载 `session-handoff` 接手模式
     2. 按 `§0`/`§1` **实跑核对**：`git rev-parse HEAD`、关键文件是否存在（用 U3 的通用可达性片段）
     3. 读**勘误块**，逐条回报与现状的偏差（格式见 spec「勘误回写块」）
     4. 复述理解 + 前 3 个动作
     5. 检查 `§2` **前置条件闸门**，不满足**即停**并问用户
     6. 用户确认后才动手；发现偏差**回写勘误块**
  2. `## 前置条件闸门` —— 闸门判据表（逐条给「满足条件 / 不满足时的动作=停并问」）
  3. `## 复述模板` —— 可复制的固定文本骨架，含 5 项（**与验收 4 的客观清单对齐**）：`repo_root` / `git_head 是否与 §1 一致` / 前 3 个动作（对应 §2 P0–P2）/ 发现的歧义（或"未发现歧义"）/ 闸门判定
  4. `## 勘误回写规则` —— 何时回写（实测发现偏差即写）、每条要素（日期 + 证据 + 修正内容）、可累积；**不重述格式细节，指向 spec**
  5. `## 禁止事项` —— ①不得跳过 §0/§1 实跑核对 ②不得在闸门不满足时开工 ③不得重开 §4「已裁决不得重开」事项 ④不得把 `[仅记忆]` 当事实
- **验收标准**：
  - 六步齐全（`grep -cE '^[0-9]\.|^### '` ≥6），含关键词 `实跑核对`/`勘误`/`复述`/`闸门` 各 ≥1
  - 复述模板含 `repo_root`、`git_head`、`歧义`、`闸门` 四个词各 ≥1
  - `grep -c '```bash'` == 0（命令来自 U3，不重复）
  - 与 U3 无重复段落：`grep -F -f <(grep -v '^$' U3 | head -50) U4` 无整行命中（抽查即可）
- **歧义与唯一推荐解释**：plan.md:49 决策 36 的六步里「读勘误块回报偏差」与「发现偏差回写勘误块」分列第 3、6 步 → **推荐：第 3 步只**读并回报**（不改文档），第 6 步才**回写****；两处都指向 spec 的格式节。

---

### U5 — `agent-skills/session-handoff/references/examples-and-pitfalls.md`

- **目标文件**：`/home/CNS2026495165/dsh/agent-skills/session-handoff/references/examples-and-pitfalls.md`（新建）
- **依赖**：U2、U3、U4（引用其小节，不复制规则）
- **改动内容**：
  1. `## 历史真实交接件骨架（两份）` —— 摘录，**每份每条都带出处**：
     - **A. `.workspace/reports/handoff/NEXT_SESSION_PROMPT.txt`（228 行）** —— 骨架：`§0 你的第一件事（已完成，保留供追溯）`(第 29 行) / `§1 客观事实基线`(44，含 1.1 仓库与运行盘面、1.2 三处模型当前事实、1.3 已部署但尚未生效) / `§2 最高优先级任务清单（按序）`(79) / `§3 本批次已完成的工作内容（分线）`(94，含 3.1–3.5) / `§4 已裁决、**不得重开**的事项`(136) / `§5 待办与开放项`(150) / `§6 历史坑与硬约束（都踩过）`(165) / `§7 关键文件索引`(186) / `§8 方法论（`.dsh/AGENTS.md` 摘要，照此执行）`(213) / `§9 一句话开启方式（可直接对模型说）`(224)。**要点**：条款句式为「编号裁决 + 不许做什么 + 推翻条件」；事实基线用**表格**且带「生效状态」列；§7 分类分组并标「开工必读」
     - **B. `.workspace/lag-fix/NEXT_SESSION_PROMPT.txt`（56 行，精简范式）** —— 骨架：`一句话背景`(3) → `## 粘贴这段`(8，**一个 fenced 代码块内含可直接粘贴的编号指令**，第 10–28 行) → `当前状态（供核对，勿凭记忆）`(32) → `坑（务必记住）`(47，6 条)。**要点**：把"可粘贴块"做成独立 fenced block 是 §0 的最佳形态；第 32 行标题「供核对，**勿凭记忆**」正是决策 8 的朴素原型；该件以**哈希指纹**（`a0fb4bb225d3…`/`sha256 7df7a655…`）固定证据
  2. `## 与 §0–§9 契约的差异` —— 明示历史件编号含义与 v1 契约**不同**（历史 §6=历史坑→契约 §7；历史 §7=索引→契约 §8；历史 §8=方法论→契约无对应，方法论并入 §7），支撑 U2 的「编号契约」小节（**R5**）
  3. `## 竞品"不要这样做"清单` —— **每条写全仓库名 + 报告文件名 + 行号**（**R7**）：
     1. **靠文案 + 正则抠会话 id** —— `WeiYe6/dsh-session-handoff`（`research/competitor-dsh-handoff-plugins.md:255`、`:1127`）：子会话 id 从命令结果文本正则抠出，`SUCCESS_PREFIX` 文案改动即静默失效
     2. **依赖未承诺的内部 API** —— `Totoro-qaq/dsh-plugin-bridge`（`research/competitor-dsh-handoff-plugins.md:1192`）：注释自陈「projection 形状随部署而异」（`lib/dsh-alpha-host.js:83` `row?.projections?.values`），必然随版本漂移
     3. **字符硬预算** —— `dongsheng123132/task-passport`（`research/competitor-dsh-handoff-plugins.md:871` `SUMMARY_CHAR_BUDGET = 2400`）：适合省 token，不适合交接完整性
     4. **只注入会话内不落盘** —— `WeiYe6/dsh-session-handoff`（`research/competitor-dsh-handoff-plugins.md:288-294`，README 自陈 `HANDOFF.md` 留作后续）
     5. **客户端 slot 名硬编码** —— `Totoro-qaq/dsh-plugin-bridge`（`research/competitor-dsh-handoff-plugins.md:243` `ctx.slots.inject('conversation.chat.node', …)`、`:1130`、`:1185`）：`0.1.2-alpha.1` 拆分会话 UI 已把它打坏一次（README 自陈）
     6. **无强制取证机制** —— `WeiYe6/dsh-session-handoff`（`research/competitor-dsh-handoff-plugins.md:33`、`:281`，`lib/llm.mjs:17`）：仅 system prompt 一句 `do not invent facts`
     7. **"从未运行却报 clean"** —— `WeirdSky924/agent-handoff-skill`（`research/competitor-agent-handoff-skill.md:582`）：1.17.0 的 reverse-lint 步骤因 `git diff --name-only HEAD~N..HEAD` 把 `HEAD~N` 写成字面量（git 退出 128、循环体从不执行）而在**每次安装都扫 0 个文件**，却把 "never ran" 写成 "clean"；**两次**如此。⇒ 本 skill 的自检**必须真跑并记录真实输出**（对应决策 18）
  4. `## 引用纪律` —— 本文件所有断言必须带「仓库名 + 报告文件 + 行号」；**禁止**使用 `repo1`/`repo2` 这类局部标签（**R7** 的根因）
  5. `## 联网生态的边界` —— 明示 `research/handoff-skill-web-research.md:160-172` 的「**未找到**」清单：`NEXT_SESSION_PROMPT.md` 这一确切文件名**未见任何公开规范**；Anthropic **未找到**官方 handoff skill；Cursor/Windsurf 官方交接机制**未找到来源** ⇒ **本 skill 的规范是本仓自定契约，不得对外声称"遵循某既有标准"**
- **验收标准**：
  - 两份历史骨架均可 grep 到出处文件名，且 A 含 10 个 `§N` 关键词、B 含「粘贴这段」与「勿凭记忆」
  - 「不要这样做」清单 ≥7 条，**每条都同时含仓库名与 `research/` 报告路径**：`grep -c 'research/competitor'` ≥7
  - `grep -c 'repo1'` == 0（R7）
  - 含「未找到」清单小节（`grep -c '未找到'` ≥1）
- **歧义与唯一推荐解释**：plan.md:77 只写「两份历史真实交接件骨架摘录 + 竞品失败模式"不要这样做"清单」。**推荐：摘录指"骨架 + 出处行号"，不复制全文**（228 行件已指明其路径，执行档按需再读）；且摘录必须点明**历史编号与 v1 契约的差异**，否则会诱导继任会话按旧编号理解。

---

### U6 — `.gitignore`（仓库根）增补 `.dsh/handoffs/`

- **目标文件**：`/home/CNS2026495165/dsh/.gitignore`
- **依赖**：无
- **现状证据（本档实测）**：
  - 文件共 **103 行**；`grep -n "dsh/handoffs\|^\.dsh\|/handoffs" .gitignore` → **无输出**（**尚无该条**）
  - `git check-ignore -v .dsh/handoffs/test.md` → **退出码 1**（**当前未被忽略**）
  - `git ls-files .dsh` → **空**（`.dsh/` 完全未跟踪；仅 `.dsh/taste/.gitignore:1` 有 `*` 自忽略）
  - `grep -n "agent-skills" .gitignore` → **无输出**（快照目录也无规则）
- **改动内容**：
  - 在**文件末尾**追加一个新块（**不修改任何既有行**）：
    ```gitignore
    # 交接文档历史归档（2026-09-25 session-handoff skill 决策 6）：只保留最近 20 份
    .dsh/handoffs/
    ```
  - **不要**添加仓库根 `<前缀>_NEXT_SESSION_PROMPT.md` 的忽略规则（**R12**：plan 未授权，交接件应可提交/传递）
  - **不要**添加 `agent-skills/` 忽略规则（它是需入库的分发快照）
- **验收标准**：
  - `tail -3 .gitignore` 含 `.dsh/handoffs/`
  - `git check-ignore -v .dsh/handoffs/x.md` → 退出码 **0**，且输出指向 `.gitignore`
  - `git diff --stat -- .gitignore` **仅新增行、0 删除**（`git diff --numstat` 删除列为 0）
  - `grep -c '^\.dsh/handoffs/$' .gitignore` == 1（不重复添加）
- **歧义与唯一推荐解释**：plan 未指定插入位置与注释 → **推荐：追加到文件末尾并带一行中文注释说明依据（决策 6）**，理由是该文件既有风格即"按主题分块 + 中文注释 + 注明依据日期"，且末尾追加可保证 0 删除行。

---

### U7 — 分发快照头部声明

- **目标文件**：**U1 的 `SKILL.md` 内新增小节 `## 副本与同步`**（**不新建独立文件**）
- **依赖**：U1
- **改动内容**：
  - 在 `SKILL.md` **正文**（frontmatter 之后）写：
    ```markdown
    ## 副本与同步

    - **权威副本**：`~/.dsh/skills/session-handoff/`（DSH 实际加载；用户级，rank 400，全工作区生效）
    - **分发快照**：仓库内 `agent-skills/session-handoff/`（**非** DSH 发现路径，不会遮蔽权威副本）
    - **同步方式**：**手工同步**；修改后两处文件须逐字节一致（`shasum -a 256` 比对）
    - **version**：`1.0.0`（与 frontmatter `metadata.version` 保持一致）
    ```
  - **禁止**把上述内容放在 frontmatter 之前（**R3**：首行非 `---` 会导致整个技能被静默忽略）
  - **禁止**在快照侧多出任何仅快照才有的字节（**R2**：否则验收 5 的 SHA-256 一致性永远不可能达成）
- **验收标准**：
  - `head -1 agent-skills/session-handoff/SKILL.md` == `---`（R3）
  - `grep -c '^## 副本与同步$' agent-skills/session-handoff/SKILL.md` == 1
  - 该小节含 `~/.dsh/skills/session-handoff/`、`手工同步`、`version` 三个关键词
  - **主代理拷回后**：`for f in SKILL.md references/*.md; do shasum -a 256 agent-skills/session-handoff/$f ~/.dsh/skills/session-handoff/$f; done` 每对哈希相同
- **歧义与唯一推荐解释（重要）**：决策 4 要求「快照头部写明权威副本在用户级」，而验收 5 要求两副本 SHA-256 一致 —— **唯二自洽解释**：(i) 声明写入**两副本共有的 SKILL.md 正文**（**推荐**，同时满足两条）；(ii) 另建仅存在于快照的独立文件（如 `SNAPSHOT.md`）并在其中声明，镜像集只含 `SKILL.md` + `references/`。**推荐 (i)**，因为 plan.md:17 明确写的是"快照**头部**"（指 SKILL.md 的头部区域，而非新增文件），且 (ii) 会引入一个不在交付物清单（plan.md:59-66）中的额外文件。

---

### U8 — `~/.dsh/AGENTS.md` 增补文本（**两行精简版**，由主代理提权写入）

- **目标文件**：`/home/CNS2026495165/.dsh/AGENTS.md`（**工作区外；本档不写，执行档也写不了**）
- **依赖**：U1（产物与命名以 U1/U2 为准）
- **写入方**：**主代理提权**（plan.md:64、:68）
- **拟定原文**（两行，仅写「何时用 + 产物位置」，**不写流程细则**）：
  ```markdown
  ## 交接协议
  - **何时用**：需要把当前会话的工作内容/进展/目标交给下一个会话时（用户要求交接/交班/换会话继续，或会话即将结束、上下文将满），以及拿到一份 `*_NEXT_SESSION_PROMPT.md` 要接着干时，加载 `session-handoff` skill（生成模式 / 接手模式）。
  - **产物位置**：交接件落仓库根 `<前缀>_NEXT_SESSION_PROMPT.md`；历史归档在 `.dsh/handoffs/`（保留最近 20 份，已入 `.gitignore`）；权威 skill 副本在 `~/.dsh/skills/session-handoff/`。
  ```
- **验收标准**（提权后由主代理/子代理跑）：
  - `grep -c '^## 交接协议$' ~/.dsh/AGENTS.md` == 1
  - 该节下恰有 **2 个** `- **` 开头的 bullet
  - `git diff --numstat -- ~/.dsh/AGENTS.md`（若该文件在 git 内）删除列 == 0；`grep -c '^#'` 增补前后差值 == 1
  - 既有正文未被改动：增补前 `md5sum` 之外的既有行集合不变（可用 `diff <(grep -v '^## 交接协议$' 新) <(旧)` 近似核对）
- **歧义与唯一推荐解释**：plan.md:50 决策 37「两行精简版（只写"何时用 + 产物位置"）」—— **推荐解释：两行 = 两个 bullet（"何时用" 一行 + "产物位置" 一行），置于单个新 `## 交接协议` 标题之下**（标题不计入"两行"）。位置：**追加到 `~/.dsh/AGENTS.md` 末尾**，不插入既有小节内部。理由：实测该文件现 11322 字节、`grep -c '交接\|handoff\|NEXT_SESSION'` == **0**（与 `research/handoff-history-audit.md:285` 一致），追加到末尾可保证"不破坏既有结构"（验收 5）可被客观验证（仅新增行）。

---

### 单元依赖与闸门顺序（执行档须遵守）

```
U1 ──┬─→ U7（U7 修改 U1 的文件：副本与同步小节 → 二者应同一写入者，建议合并为一次写入）
     └─→ U8（主代理提权，最后做）
U2 ──┬─→ U3
     ├─→ U4
     └─→ U5
U6（独立，可并行）
```
**跨档闸门**：U1–U7 全部落盘并通过各自验收 → **主代理提权拷贝到 `~/.dsh/skills/session-handoff/`** → 再由（子）代理跑 **验收 2**（实测 `skill` 调用）、**验收 4**（派干净子代理模拟接手）、**验收 5**（两处 SHA-256 + AGENTS.md 新节）。

**建议的单一写入者安排**：U1 与 U7 触碰同一文件 → **同一写入者一次写完**；U2–U5 四个文件互不重叠，可并行；U6 独立可并行。

---

## D. 风险与残余不确定

### 未核实（需下档或主代理实测）

1. **未核实**：`~/.dsh/skills/` 下的新增目录能否被**已运行**的宿主进程 watcher **热发现**（源码有 `SkillWatchManager`+chokidar，`dsh-skill-filesystem/lib/index.js:191-214`，且 `ctx.skills.list()` 每次实时查询，`dsh-tool-skill/lib/index.js:123`）—— 机制上应可热发现，但**本档未实测**（因为本档无权写 `~/.dsh/`）。**降级方案**：若拷贝后 `skill(name=session-handoff)` 报 `unknown or no longer available`，则需重启 `dsh web` 后重试，再判验收 2。
2. **未核实**：本 skill 在**其他机器/profile** 的可分发性（plan.md:161 已自陈）。本档只核到 `~/.dsh/skills`（rank 400，`dsh-skill-filesystem/lib/index.js:24`）与 `~/.agents/skills`（rank 500，`:25`）两个用户级根；若目标机器只用 `.agents/skills`，需改放该处（rank 不同但同样生效）。
3. **未核实**：`description` 在 **GUI 设置页/技能列表**的可视化截断是否与 catalog 的 500 不同（本档只核到 catalog 路径 `catalogDescription`）。
4. **未核实**：`get_goal` 在**主会话**中的返回形状（本档为子代理，实测 `{"goal":null}`；peer board 显示主会话有 `goal-02598d0f-…`）。生成步骤 1 需按主会话实际返回取 `objective`/`id`/`revision` 三个字段。
5. **未核实**：外部仓 `mcu-hil/`（`research/handoff-history-audit.md:171,195`）**不在本仓库内**（本档 `find -maxdepth 4 -name mcu-hil` 为空）→ R5 的"下游按 §N 引用"只在本仓之外成立，本仓内**未发现**任何按 `§N` 引用历史交接件的文档。

### 执行档可能踩的坑

1. **frontmatter 首行**（R3）：任何在 `---` 之前的标题、HTML 注释、空行都会让整个 SKILL.md **静默失效**（只 warn，不报错）→ 表现为"技能莫名不存在"。**务必 `head -1` 自检**。
2. **camelCase 旧键**（R10）：误写 `disableModelInvocation` 会 `throw` → 同样静默丢弃整份技能。
3. **`wc -c` 陷阱**（R1）：中文 description 用 `wc -c` 会误报超限（实测 257 字符 = 613 字节），进而诱导"裁剪到语义残缺"。
4. **`grep -E` 的 `(?:)` 与 `\b` 不支持**（B6）：会静默减少命中数（实测 `checked=1`），让"路径全可达"**假绿**。
5. **尾部剥离吃掉 `.md`**（B6）：`${p%%[.…]*}` 会把 `docs/program-notebook.md` 截成 `docs/program-notebook` → **假 MISSING**。
6. **`*` 通配断词**（B6）：`.workspace/backup-*/` 变 `.workspace/backup-` → **假 MISSING**。
7. **`| tail` 后取 `$?`**：会拿到 `tail` 的退出码 → 自检恒"通过"。**必须直接取命令退出码**。
8. **`.dsh/handoffs/` 与 `agent-skills/` 均不存在**（R4）：不 `mkdir -p` 会直接写失败。
9. **R2 自相矛盾陷阱**：若给快照加独有头部，验收 5 的 SHA-256 一致性**永远不可能通过**，执行档可能误以为是"同步没做对"而反复拷贝。
10. **双写漂移**（B2 重叠 1–3）：同一规则写进 spec 又写进 playbook，后续修订只改一处。**按 U2–U5 的"数值只在 spec、命令只在 playbook"约束执行**。
11. **不授权的字段/小节**：`whenToUse`（合法但未授权）、`license`（静默忽略）、`allowed-tools`（不存在但**不报错**）→ 加了不会报错，但违反 plan.md:6「未写入本文件的一律视为未裁决」。**一律不加**。

### 本档产出的实测脚本（供执行档直接取用）

| 文件 | 用途 | 实测结论 |
|---|---|---|
| `.workspace/session-handoff-skill/probe-reachability.sh` | 通用路径可达性自检 | `bash -n` 通过；对 3 份真实文档实跑成功（checked=13/34/7），正确报 MISSING 并返回退出码 1 |
| `.workspace/session-handoff-skill/check-sections.sh` | §编号齐全有序 + §0–§5+§9 预算 | `bash -n` 通过；缺 §2/§4/§5 时正确报 MISSING；181 行正确 FAIL；§6–§8 正确排除在预算外 |
| `.workspace/session-handoff-skill/measure-desc.mjs` | 复刻 DSH 的 description 归一化与计量 | 实测候选 A = 257 字符/613 字节；截断行为 600→500 且 `endsWith("...")` |
