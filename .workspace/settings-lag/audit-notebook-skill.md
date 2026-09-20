# program-notebook skill 调研报告（只读）

- 目标仓库：https://github.com/LycanW/program-notebook
- 调研时间：本次会话；调研方式：GitHub API / raw.githubusercontent / `git ls-remote` 只读抓取 + 本地文件读取。**未 clone、未安装、未写入任何被调研目标**（本报告文件除外）。
- 抓取到的固定版本：`main` = `4ace5d3150d0e52575c79ba0480e5b3f7b3b34c7`；最新 tag `v0.4.1`（同 commit）；npm 包 `program-notebook@0.4.1`。
- 结论一句话：**它是 Codex / OpenCode / Kimi Code / Pi 四平台的"项目中枢文档"插件 + skill + 只读检查器；本身不是 DSH skill，但它的 `skills/program-notebook/` 是一个标准 `SKILL.md` + `references/` 目录包，DSH 的 `dsh-skill-filesystem` 可直接消费。**

---

## 0. 给主 agent 的速览

| 问题 | 答案 |
|---|---|
| 是什么 | 文档方法论 + 只读检查器 + 四平台插件壳；核心是"`docs/program-notebook.md` 中枢 + `docs/architecture/*.md` 专题"的固定文档结构 |
| 是否 DSH skill | 不是；**但可直接当 DSH 目录包 skill 安装**（frontmatter 合规） |
| 单文件还是多文件 | 多文件小目录包：`SKILL.md` + `references/×2`（+ 可选 `agents/openai.yaml`，DSH 不需要） |
| 装到哪 | 推荐 **工作区级** `/home/CNS2026495165/dsh/.dsh/skills/program-notebook/`（**在可写范围内，无需审批**）；或用户级 `~/.dsh/skills/`（**需用户批准**） |
| 需要联网/代理 | 需要联网，**不需要代理**（github.com、raw.githubusercontent、registry.npmjs.org 均直连可达，已实测） |
| 装完要重启吗 | 不需要。新根由 skill-filesystem 的缺路径轮询（100ms）发现并热更新 catalog |
| 它的整理规则 | 固定 2 层文档（中枢 + architecture 01–04），7 项必需章节，Mermaid 兼容表，证据规则；**它不定义"根目录散落 md 如何收纳"** |
| 映射草案规模 | 24 个文件移动 → 4 个新目录（`docs/architecture/`、`docs/superpowers/specs/`、`docs/superpowers/plans/`、`docs/runbooks/`）+ 新建 5 个文件（中枢 + 4 篇 architecture）；3 个文件留根 |

---

## 1. 仓库结构（GitHub API 全树，`recursive=1`，truncated=false）

```
.agents/plugins/marketplace.json          (Codex marketplace 清单)
.codex-plugin/plugin.json                 (Codex plugin 清单)
.codex/INSTALL.md                         (给 Codex agent 的安装说明)
.github/workflows/publish.yml             (npm 发布 CI)
.gitignore
.kimi/INSTALL.md                          (给 Kimi Code agent 的安装说明)
.mcp.json                                 (Codex 的 check_notebook MCP 配置)
.opencode/INSTALL.md                      (给 OpenCode agent 的安装说明)
.opencode/commands/check-notebook.md      (/check-notebook 命令模板)
.opencode/plugins/program-notebook.ts     (OpenCode 插件入口 5533B)
AGENTS.md                                 (7724B，仓库自身 agent 指南)
LICENSE                                   (MIT)
README.md                                 (8498B)
bin/check-notebook-mcp.ts                 (MCP server 源码 7284B)
bin/check-notebook.ts                     (CLI 入口 560B)
bun.lock
dist/check-notebook-mcp.mjs               (19118B，Node 直跑，不依赖 Bun)
dist/check-notebook.mjs                   (12654B，Node 直跑，不依赖 Bun)
extensions/program-notebook.ts            (Pi extension 2596B)
kimi.plugin.json                          (Kimi plugin 清单)
lib/program-notebook-lib.ts               (13511B，可测试检查逻辑)
package.json                              (1928B)
scripts/build-runtime.ts
skills/program-notebook/SKILL.md          (5360B，四平台共用精简入口)  ★
skills/program-notebook/agents/openai.yaml (535B，Codex UI/MCP 元数据)
skills/program-notebook/references/maintenance-playbook.md (5133B)  ★
skills/program-notebook/references/notebook-spec.md        (4710B)  ★
tests/check-notebook-cli.test.ts / check-notebook-mcp.test.ts /
tests/codex-plugin.test.ts / pi-package.test.ts / program-notebook-lib.test.ts
```

### 性质判定

- **不是 Cursor rules、不是 Claude Code skills 目录形态**，也不是纯文档方法论。
- 它是**给 4 个 agent 平台（Codex / OpenCode / Kimi Code / Pi）分发的插件包**：每个平台一套清单 + 安装说明 + 入口（Codex 走 MCP、OpenCode 走插件 + 命令、Kimi 走 plugin 清单、Pi 走 npm package extension），四者**共用同一份 `skills/program-notebook/` skill 目录**。
- 内容形态上是「**文档方法论（skill + references）+ 只读证据检查器（CLI/MCP，同源 `lib/`）**」。检查器严格只读；写文档由被加载 skill 的 agent 执行。

`package.json`（仓库根）：声明 npm 包名 `program-notebook`，`pi-package` keyword + `pi.extensions` / `pi.skills` 资源；`bun.lock` 表示开发用 Bun 构建，但**发布产物 `dist/*.mjs` 用 Node ≥18 直接运行，不需要 Bun**。

---

## 2. 关键文件原文摘录

### 2.1 `skills/program-notebook/SKILL.md`（全文，含 frontmatter）

```markdown
---
name: program-notebook
description: 创建、更新或校验 docs/program-notebook.md 时使用；非极简项目缺失该文件时负责初始化。也用于接手陌生代码库、执行跨模块改动，或源码、配置、构建、测试、架构和数据流发生结构性变化时。纯格式化、局部重命名和极简项目通常不需要加载。
license: MIT
---

# 项目笔记本（Program Notebook）

## 核心原则

**Skill 负责维护决策，`check_notebook` 负责只读证据，Agent 负责读取代码并编辑文档。**

不能凭记忆信任或更新 notebook。所有架构事实、缺陷、限制和状态必须来自当前源码、配置、测试、Git 历史或已读文档；无法验证的内容标记为未知，不得猜测补全。

插件和检查工具本身保持只读；需要写文档时，由已加载本 skill 的 Agent 基于证据执行。

## 缓存友好的按需加载

- 本文件只保留触发条件和核心工作流；在同一任务中读取一次即可，不要每轮重复加载。
- 只在真正需要对应细节时读取 reference，不要一次性加载全部材料。
- 已经读入当前会话且文件未变化时，不要重复读取。
- 不通过系统提示或逐轮事件重复注入本 skill、reference 或状态报告。

| 当前任务 | 按需读取 |
|---|---|
| 仅检查 notebook 是否存在、索引是否完整或是否可能陈旧 | 通常无需 reference；先调用 `check_notebook` |
| 创建 notebook、补章节、拆分 architecture docs、编写 Mermaid | [references/notebook-spec.md](references/notebook-spec.md) |
| 结构性代码改动、判断哪些文档要同步、验证最终状态 | [references/maintenance-playbook.md](references/maintenance-playbook.md) |
| 同时创建文档并完成跨模块改动 | 按上述顺序分别读取两个 reference |

## 固定文档边界

- `docs/program-notebook.md`：中枢索引和摘要，记录项目地图、当前状态、关键决策、进度、风险、已知缺陷和参考资料入口。
- `docs/architecture/*.md`：结构图、数据流、CI、协议、部署、复杂模块等展开型专题。
- `README.md` / `HOW2USE.md`：面向用户和开发者的入口。
- `AGENTS.md` / `CLAUDE.md`：Agent 约束和项目命令。

Notebook 是目录和摘要，不是全部正文。专题文档更新后，必须检查 notebook 中的索引与摘要。

## 工作流

1. **判断是否适用。**
   - 适用：陌生代码库、跨模块修改、公共 API、数据流、状态机、配置 schema、构建、部署、CI、测试架构或已知限制发生变化。
   - 通常不适用：纯格式化、拼写、局部变量重命名、无行为影响的小优化、一次性脚本或少于约 10 个源文件的极简项目。
2. **获取基线。** 如果存在 `check_notebook`，调用它；`projectRoot` 必须是当前用户项目根目录，而不是插件安装目录。
3. **处理缺失文档。** 若项目非极简且 notebook 缺失，按需读取 [references/notebook-spec.md](references/notebook-spec.md)，基于源码证据直接创建 `docs/program-notebook.md`，不要只给建议或先询问。仅在当前任务明确只读、用户禁止写文档或项目确属极简时不创建，并说明原因。
4. **读取证据。** 先读已有 notebook、被其索引的 architecture docs、README、Agent 指南和本次变化涉及的源码/配置/测试。
5. **执行任务。** 不为填模板而创建空文档，不把未经验证的推测写入文档。
6. **检查同步需求。** 对照实际 diff 判断 notebook 和哪些专题文档受影响；需要更新时与代码在同一变更集中完成。
7. **最终复查。** 再调用 `check_notebook`，但把报告当作证据入口而不是源码阅读的替代品。
8. **报告结果。** 明确说明文档已创建、已更新、已确认当前、无需更新，或因只读/禁止写入/极简项目而未创建；列出仍有的未验证项。

## 必须触发文档判断的变化

- 模块边界、入口点、公共 API、生命周期、线程或任务所有权
- 函数、服务、进程、设备之间的数据流或状态传播
- 状态机、运行模式、错误处理、安全门、故障恢复
- 配置来源、schema、默认值、环境变量、CLI 参数
- 构建脚本、代码生成、部署、CI、测试架构和质量门
- 已知限制、TODO/stub、已验证缺陷的新增、修复或推翻
- 协议、驱动、硬件交互和关键外部依赖行为

## `check_notebook` 使用约定

建议在以下时机显式调用，而不是每轮自动调用：

- 接手陌生项目时
- 跨模块或结构性改动前
- 结构性源码、配置、构建或测试变更完成后
- 最终声称 notebook 或 architecture docs 已同步前

报告中的时间戳、Git 状态和路径建议不能证明文档内容正确；关键事实仍需读取对应文件。

## 最终回复格式

- Notebook 状态：已创建 / 已更新 / 已确认当前 / 无需更新 / 因只读、禁止写入或极简项目而未创建
- 专题文档状态：更新了哪些 `docs/architecture/*.md`，或为何无需更新
- 检查证据：读过的文件、搜索/Git 结果、`check_notebook` 报告
- 变更范围：数据流 / 架构 / 运行流 / 配置 / 模块 / CI / 缺陷
- 未验证项：仅在确实无法验证时列出
```

### 2.2 `skills/program-notebook/references/notebook-spec.md`（全文）——**这就是它的"整理方法论"本体**

```markdown
# Program Notebook 结构规范

只在创建 notebook、补充结构、拆分专题文档或编写 Mermaid 时读取本文件。

## 定位与文档分层

`docs/program-notebook.md` 是项目中枢文档，让新成员和 Agent 快速知道项目状态、关键资料位置、已经验证的事实和当前风险。它不能替代所有文档。

| 文档 | 职责 |
|---|---|
| `docs/program-notebook.md` | 中枢索引、项目摘要、当前状态、关键决策、进度、风险、已知缺陷、参考资料入口 |
| `docs/architecture/*.md` | 完整结构图、详细数据流、测试覆盖、CI、协议、驱动、部署、代码风格等专题 |
| `docs/superpowers/specs/` | 设计规格、需求和技术决策过程 |
| `docs/superpowers/plans/` | 实现计划、任务拆解和执行记录 |
| `README.md` / `HOW2USE.md` | 面向人类使用者和开发者的入口 |
| `AGENTS.md` / `CLAUDE.md` | Agent 约束、命令和注意事项 |

专题文档必须被 notebook 索引并摘要。不要复制全文，也不要把专题文档当作 notebook 的替代品。

## Notebook 必需内容

### 1. 全局数据流摘要

使用 Mermaid `graph LR` 展示关键模块、函数或任务之间的数据、命令、状态和反馈流。只描述项目自身的核心调用链，不追踪外部库内部实现。详细数据流超过一个图时，移入 `docs/architecture/02-data-flow.md`。

### 2. 架构摘要

使用 `graph TD` 或 `graph LR` 展示关键模块关系。每个节点至少参与一条有效连线，不能出现孤立节点。

不要展开结构体内部字段。需要说明关键结构体时，用自然段记录设计要点、生命周期、所有权和边界情况。完整结构和模块职责移入 `01-program-structure.md`。

### 3. 程序运行流摘要

使用 `sequenceDiagram` 或短列表说明从入口到退出的生命周期：启动、运行、关闭，以及关键错误或恢复路径。

### 4. 配置加载链

记录配置来源、优先级、合并规则、覆盖策略和消费模块。必须回答：配置从哪里加载，以及谁使用它。

### 5. 模块摘要

按模块或目录分组，核心模块详写，辅助模块一行带过。大型项目不要逐文件罗列。

核心模块优先说明：

- 入口点和调用链
- 设计决策与取舍
- 模块边界和数据流向
- 生命周期、所有权、陷阱和边界条件

### 6. 参考资料索引

索引架构专题、依赖声明、构建脚本、运行时配置、容器和部署、Agent 指南、使用说明、设计规格与计划。不要复制这些文件的正文。

### 7. 已验证的实现缺陷与限制

每条必须有当前代码、测试或 Git 证据。典型类型包括死代码、未完成功能、架构漂移和文档漂移。无法验证的内容标记为未知或不写。

## 何时拆分 `docs/architecture/`

出现以下情况时，把细节从 notebook 拆出：

- 完整程序结构超过一个 Mermaid 图
- 数据流包含硬件、网络、异步任务、状态机、协议或多层反馈
- 测试覆盖需要按子系统、CI 阶段或验证链路说明
- CI/CD、部署、协议、驱动初始化、硬件排障需要独立维护
- 单个 notebook 章节超过约 100–150 行，影响其入口价值

推荐命名：

| 文件 | 用途 |
|---|---|
| `docs/architecture/01-program-structure.md` | 完整程序结构、模块职责、关键依赖 |
| `docs/architecture/02-data-flow.md` | 运行时数据流、硬件反馈、网络路径、状态传播 |
| `docs/architecture/03-ci-pipeline.md` | 测试覆盖、CI 验证链路、质量门 |
| `docs/architecture/04-code-style.md` | 代码风格、复杂模块、维护风险、重构建议 |

只有内容确实需要长期维护时才创建专题，不为填表创建空文件。

## Mermaid 兼容性

| 使用 | 避免 | 原因 |
|---|---|---|
| `graph LR` / `graph TD` | `flowchart` | 部分解析器不支持较新的语法 |
| `stateDiagram-v2` | `stateDiagram` | v2 是现行形式 |
| 每个目标单独写箭头 | `A --> B & C` | 多目标语法兼容性较差 |
| ASCII 节点 ID | 中文节点 ID | Unicode ID 可能导致解析失败 |
| `-.->` 表示实现关系 | 所有关系都用实线 | 能区分实现与调用/数据关系 |

## 结构与绘图常见错误

- 箭头方向错误：实现应指向接口（trait/interface），不是反过来。
- 子图与节点 ID 冲突，例如同时使用 `subgraph CONFIG[...]` 和节点 `CONFIG`。
- 图中出现无连线的孤立节点。
- 大型项目逐文件展开，导致 notebook 很快陈旧。
- 复述结构体字段，而不是记录设计边界和所有权。
- 专题文档存在但 notebook 没有索引和摘要。
```

### 2.3 `references/maintenance-playbook.md`（要点原文摘录）

```markdown
## 证据规则

**不推测。** 写入任何架构事实、缺陷、限制或风险前，必须通过以下至少一种证据验证：
- 当前源码和配置 / 搜索结果和调用点 / 测试文件与执行结果 / Git diff、status 或历史 / 已读且仍与实现一致的项目文档
工具报告只是证据入口，不能替代读取源码。无法验证的内容明确标记为"未验证"，不要补全猜测。

## 更新映射
1. 新增、删除、移动模块或入口 → 更新 notebook 模块摘要；必要时更新 `01-program-structure.md`
2. 数据流、状态机、协议、驱动、异步任务变化 → 更新 notebook 数据流/运行流摘要；必要时 `02-data-flow.md`
3. 配置、命令、部署步骤、构建行为变化 → 更新配置加载链、运行流或参考资料索引
4. 测试、CI、质量门变化 → 更新 notebook 测试/状态摘要；必要时 `03-ci-pipeline.md`
5. 复杂模块、维护风险、风格约定变化 → 更新风险或维护说明；必要时 `04-code-style.md`
6. 缺陷修复 → 删除已经失效的缺陷，或标记为已解决并附当前证据

## 陈旧检测
- 源码目录和 notebook 模块列表是否一致
- notebook 中记录的缺陷与限制是否仍成立
- `git log docs/program-notebook.md docs/architecture` 是否明显早于结构性源码变更
- notebook 是否引用不存在、重命名或过期的专题文档
- 配置、构建、CI 和测试说明是否仍与当前文件一致
时间戳只能表明"值得检查"，不能证明内容已经陈旧。

## 红灯信号
| 借口 | 应采取的行动 |
|---|---|
| "改动很小，不用判断" | 先确认是否影响接口、数据流、配置或风险 |
| "稍后统一更新" | 在当前上下文仍完整时完成判断和必要更新 |
| "只是重构" | 检查模块边界、调用链和所有权是否改变 |
| "文件太多，写不全" | 按模块分组，必要时拆分专题 |
| "插件已经提醒过" | 提醒不等于结论，必须读取证据 |
| "notebook 太长" | 保留摘要，把细节拆到 architecture docs |

## 最终报告模板
- Notebook 状态：已创建 / 已更新 / 已确认当前 / 无需更新 / 因只读、禁止写入或极简项目而未创建
- 专题文档状态：列出更新文件，或说明无需更新
- 检查证据：源码/配置/测试/Git/工具报告
- 变更章节：数据流 / 架构 / 运行流 / 配置 / 模块 / CI / 缺陷
- 未验证项：只列仍无法验证的事实
```

### 2.4 `README.md` 关键段（固定文档结构，原文）

```markdown
## 固定文档结构

- `docs/program-notebook.md`：中枢索引、项目摘要、当前状态、关键决策、进度、风险、已知缺陷、参考资料入口。
- `docs/architecture/01-program-structure.md`：完整程序结构框图、模块职责、关键依赖。
- `docs/architecture/02-data-flow.md`：运行时数据流、硬件反馈、网络路径、状态传播。
- `docs/architecture/03-ci-pipeline.md`：测试覆盖、CI 验证链路、质量门。
- `docs/architecture/04-code-style.md`：代码风格、复杂模块、维护风险、重构建议。
```

四平台安装命令（原文，供对照——**这些都不是 DSH 的路径**）：

```bash
# Codex（已验证基线 codex-cli 0.151.0；本机为 0.147.0）
codex plugin marketplace add LycanW/program-notebook
codex plugin add program-notebook@program-notebook

# OpenCode：在 ~/.config/opencode/opencode.jsonc 的 plugin 数组加 "program-notebook"
# Kimi Code：/plugins install https://github.com/LycanW/program-notebook
# Pi：pi install npm:program-notebook     （本机 pi 0.84.4 存在）
```

### 2.5 检查器硬编码常量（`lib/program-notebook-lib.ts`，决定"它认什么路径"）

```ts
export const NOTEBOOK_PATH = "docs/program-notebook.md"
export const ARCHITECTURE_DIR = "docs/architecture"

const REQUIRED_NOTEBOOK_SECTIONS = [
  { name: "文档分层或参考资料索引", patterns: [/文档分层/, /参考资料/, /参考文件/, /架构参考/] },
  { name: "数据流摘要", patterns: [/数据流/] },
  { name: "架构摘要", patterns: [/架构/, /结构图/, /结构摘要/] },
  { name: "程序运行流", patterns: [/程序运行流/, /运行流/, /启动流程/, /生命周期/] },
  { name: "配置加载链", patterns: [/配置加载/, /配置链/, /配置/] },
  { name: "模块摘要", patterns: [/模块摘要/, /逐模块/, /代码组织/, /模块职责/] },
  { name: "已知缺陷与限制", patterns: [/缺陷/, /限制/, /已知问题/, /TODO/, /NotImplemented/] },
]

export function classifyChangedPath(path: string): string[] {
  const docs = new Set<string>([NOTEBOOK_PATH])
  if (path.startsWith("tests/") || path.startsWith(".github/workflows/")) {
    docs.add("docs/architecture/03-ci-pipeline.md"); return Array.from(docs)
  }
  if (path.startsWith("src/")) {
    docs.add("docs/architecture/01-program-structure.md")
    if (/driver|drivers|protocol|can|imu|websocket|socket|runtime|executor|state|safety|fault/i.test(path)) docs.add("docs/architecture/02-data-flow.md")
    if (/style|lint|format|clippy/i.test(path)) docs.add("docs/architecture/04-code-style.md")
  }
  return Array.from(docs)
}
```

其它要点：
- `architectureDocs` = `readdirSync(docs/architecture)` 里**一层**的 `.md`，按名排序；`missingArchitectureReferences` 判定方式是「notebook 正文是否**字面包含** `docs/architecture/NN-xxx.md` 路径字符串」。
- 忽略目录：`.git .next .nuxt .venv build coverage dist node_modules out target vendor venv`。
- 受关注文件（`shouldWatchPath`）：扩展名 `.rs .ts .tsx .js .jsx .py .go .c .cc .cpp .h .hpp .toml .json .yaml .yml .proto .sh`，文件名 `Cargo.toml/Cargo.lock/build.rs/package.json/package-lock.json/pnpm-lock.yaml/bun.lock/Makefile/CMakeLists.txt/Dockerfile/AGENTS.md/CLAUDE.md/README.md/HOW2USE.md`，或 `src/ tests/ config/ deploy/ .github/workflows/` 前缀。
- 报告上限 48KB，超出按行截断。

---

## 3. DSH 的 skill 发现约定（含 `dsh-skill-filesystem` 代码证据）

证据文件：`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-skill-filesystem/lib/index.js`（v0.1.1-rc.2，880 行）+ 同包 `README.md`；名称校验来自 `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-skill/lib/index.js`。

### 3.1 发现根与优先级（代码 `roots(cwd)`，常量在文件头）

```js
const PROJECT_DSH_RANK = 100;
const PROJECT_AGENTS_RANK = 200;
const CUSTOM_RANK = 300;
const USER_DSH_RANK = 400;
const USER_AGENTS_RANK = 500;
```

| Rank | source | 路径 | 本机实况 |
|---|---|---|---|
| 100 | `project-dsh` | `<projectRoot>/.dsh/skills` | **`/home/CNS2026495165/dsh/.dsh/skills`（不存在，可创建）** |
| 200 | `project-agents` | `<projectRoot>/.agents/skills` | `/home/CNS2026495165/dsh/.agents/skills`（不存在） |
| 300 | `custom` | `settings.dsh-skill-filesystem.customSkillDirs` | `~/.dsh/settings.yaml` 无该段 → `[]` |
| 400 | `user-dsh` | `<dshHome>/skills`（`skipSystem: true`） | `/home/CNS2026495165/.dsh/skills`（现有 `grill-me`、`ppt-master`） |
| 500 | `user-agents` | `<agentsHome>/skills` | `/home/CNS2026495165/.agents/`（**不存在**） |
| — | `bundled` | `$DSH_BUNDLED_SKILL_DIR` | 本 shell 未导出；会话目录里的 `workbuddy-ppt` / `ppt-template-fidelity` 来自插件 `@local/dsh-pptmaster/skills/` |

项目根解析（代码 `findProjectRoot`）：**从 cwd 向上找最近的含 `.git` 的祖先，找不到则退回 cwd**：

```js
async function findProjectRoot(cwd, fs) {
  let current = cwd;
  while (true) {
    if (await pathExists(join(current, ".git"), fs)) return current;
    const parent = dirname(current);
    if (parent === current) return cwd;
    current = parent;
  }
}
```

→ 本会话 cwd 为 `/home/CNS2026495165/dsh`，且该目录**含 `.git`**，所以 `projectRoot = /home/CNS2026495165/dsh`，工作区级 skill 根 = **`/home/CNS2026495165/dsh/.dsh/skills`**。

### 3.2 单层目录约定与文件名要求（代码 `discoverRoot`）

```js
const locator = entry.type === "directory" ? { path: join(entry.path, "SKILL.md"), directory: entry.path }
  : entry.type === "file" && entry.name.endsWith(".md") ? { path: entry.path, directory: root.path }
  : void 0;
```

- 两种形态：**目录包 `<root>/<name>/SKILL.md`**（推荐，可带 `references/`）或**扁平文件 `<root>/<name>.md`**。
- **只扫一层**：`**/SKILL.md` 嵌套发现被明确排除（README "Known Limitations"：*Discovery is one level deep*）。
- `resourceBase` = 该 skill 所在目录 → `references/*.md` 相对链接可用。

### 3.3 frontmatter 要求（代码 `parseSkillFile`）

```js
const name = stringField(parsed.data, "name");
const description = stringField(parsed.data, "description");
if (name === void 0 || description === void 0) { ctx.logger.warn(... "frontmatter requires name and description"); return; }
if (!isSkillName(name)) { ... "invalid skill name" ... }
```

- 必需：`name`、`description`（非空字符串）；可选：`whenToUse`、`metadata`、`disable-model-invocation`、`user-invocable`。
- `name` 必须 kebab-case：`@deepseek-ai/dsh-skill` 中 `const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/` → `program-notebook` ✅。
- YAML frontmatter 必须首行 `---` 且能被 `yaml` 解析为对象。
- 拒绝 camelCase 旧键（`disableModelInvocation`/`modelInvocable`/`userInvocable`）→ **整条 skill 被丢弃**。
- **`program-notebook` 的 SKILL.md frontmatter 为 `name: program-notebook` + `description: …`（含中文），完全合规**；多余的 `license` 字段被当 open YAML 忽略，无害。

### 3.4 工作区级 vs 用户级

- **用户级 `~/.dsh/skills/<name>/SKILL.md` 确实是 DSH 认可的形式**（rank 400，现有 `grill-me`、`ppt-master` 即此形态；`ppt-master` 也是多文件目录包，含 `references/ scripts/ templates/ workflows/`）。
- **工作区级同样会被发现**，确切路径 `/home/CNS2026495165/dsh/.dsh/skills/<name>/SKILL.md`（rank 100，优先级高于用户级）。
- 工作区里现有的 `/home/CNS2026495165/dsh/.dsh/taste/`（`taste.md` + 内容为 `*` 的 `.gitignore`，0700）**不是 skill，也不参与 skill 发现**——它不在任何发现根之下（发现根只有 `.dsh/skills`），与 taste 插件的数据目录同形。**不要把它当成 skill 先例**。

### 3.5 热更新行为（代码 `apply` 中的 `fs/observed` + watcher）

```js
ctx.on("fs/observed", (target, _observation, actor) => {
  if (mutationToolName(actor) === void 0) return;      // 仅 edit / write 工具
  provider.observeHostMutation(target.displayPath);
});
```

- 新增/删除/改写 `SKILL.md`、扁平 `<name>.md`、skill 包目录 → 触发 catalog 失效重建，**无需重启 DSH**；`references/` 下的文件变动**不**触发 catalog 变更（正文按需读，无所谓）。
- 根**尚不存在**时，由 `fs.watchFile` 逐段探测（`watchPollIntervalMs=100`），根一旦出现即挂 chokidar。
- 注意：**用 bash/curl 建 skill** 不走 `fs/observed` 快路径，依赖 watcher 轮询；若当前会话目录未立刻刷新，开新一轮对话或刷新页面即可。

---

## 4. 确切安装步骤

### 4.0 联网与权限前提（实测）

- `git ls-remote https://github.com/LycanW/program-notebook` ✅、`curl https://raw.githubusercontent.com/...` ✅、`https://api.github.com/...` ✅、`registry.npmjs.org` ✅（`npm view program-notebook version` → `0.4.1`）。**无需代理**。
- 本机工具实况：`node v22.23.2` ✅、`npm 10.9.8`、`git 2.43.0`、`pi 0.84.4`（存在）；`codex-cli 0.147.0`（**低于仓库已验证基线 0.151.0**，且 `codex plugin` 子命令存在但未验证 marketplace 流程）；`opencode`、`kimi`、`bun` **不存在**。
- 沙箱：`workspace-write`，可写范围仅 `/home/CNS2026495165/dsh`；**审批已禁用**，`~/.dsh` 写入会被自动拒绝。
- `npm` 默认 cache 在 `~/.npm/_cacache`，在本沙箱下 **EACCES**（`npm view` 直接失败）；需 `--cache <可写目录>` 或由用户执行。

### 方案 A（**推荐**：工作区级安装，全部在可写范围内，无需审批）

装 3 个文件，保持 `references/` 相对结构（这样 SKILL.md 里的 `references/notebook-spec.md` 相对链接可用）：

```bash
set -euo pipefail
REF=refs/tags/v0.4.1          # 固定版本；要跟 main 就改成 refs/heads/main
BASE=https://raw.githubusercontent.com/LycanW/program-notebook/$REF/skills/program-notebook
DEST=/home/CNS2026495165/dsh/.dsh/skills/program-notebook
mkdir -p "$DEST/references"
curl -fsSL -o "$DEST/SKILL.md"                                "$BASE/SKILL.md"
curl -fsSL -o "$DEST/references/notebook-spec.md"             "$BASE/references/notebook-spec.md"
curl -fsSL -o "$DEST/references/maintenance-playbook.md"      "$BASE/references/maintenance-playbook.md"

# 自检：frontmatter 必须是 name: program-notebook（kebab-case）
head -4 "$DEST/SKILL.md"
ls -l "$DEST" "$DEST/references"
```

特性：
- ✅ 在 `/home/CNS2026495165/dsh` 之下 → **不需要用户批准，主 agent 可直接执行**。
- ⚠️ 会产生 git 未跟踪文件：`.dsh/skills/**`。建议同步在 `.gitignore` 加 `.dsh/skills/`（或反之提交入库，二选一，需裁决；`.dsh/taste/.gitignore` 的既有做法是目录内自 ignore）。
- 只装 skill（3 文件）即可，**不需要**装 `agents/openai.yaml`（那是 Codex UI/MCP 元数据）、`dist/*`、`.mcp.json`。

### 方案 B（用户级安装：**需用户批准或用户亲自执行**）

```bash
mkdir -p ~/.dsh/skills/program-notebook/references
BASE=https://raw.githubusercontent.com/LycanW/program-notebook/refs/tags/v0.4.1/skills/program-notebook
curl -fsSL -o ~/.dsh/skills/program-notebook/SKILL.md                           "$BASE/SKILL.md"
curl -fsSL -o ~/.dsh/skills/program-notebook/references/notebook-spec.md        "$BASE/references/notebook-spec.md"
curl -fsSL -o ~/.dsh/skills/program-notebook/references/maintenance-playbook.md "$BASE/references/maintenance-playbook.md"
```

- ⚠️ **写 `~/.dsh` 属会话可写范围之外**：本子代理的审批被禁用，会被自动拒绝 → **必须由用户批准会话扩权，或用户自己在终端执行**。
- 优点：所有项目可用（rank 400，被 rank 100 的工作区级覆盖）。

### 方案 C（其它平台路线：本机基本不可用，仅供知情）

| 平台 | 命令 | 本机可行性 |
|---|---|---|
| Pi | `pi install npm:program-notebook`（或 `pi -e npm:program-notebook` 免写配置试用） | `pi 0.84.4` 存在，但装进 **Pi**，**DSH 看不到**；且 npm cache 目录不可写，需 `npm_config_cache=/tmp/npmcache`（会写 ~/.pi） |
| Codex | `codex plugin marketplace add LycanW/program-notebook` → `codex plugin add program-notebook@program-notebook` | `codex-cli 0.147.0` < 基线 0.151.0；且写 `~/.codex` 需批准 |
| OpenCode / Kimi | 改 `~/.config/opencode/opencode.jsonc` / `/plugins install` | 两者均未安装 |

### 可选加强项（都需要用户批准或用户执行）

1. **接入 `check_notebook` 只读检查器**（DSH 目前没有这个工具）：把仓库 clone 到**已被 gitignore 的** `.workspace/repos/`：

   ```bash
   git clone --depth 1 --branch v0.4.1 https://github.com/LycanW/program-notebook \
     /home/CNS2026495165/dsh/.workspace/repos/program-notebook
   node /home/CNS2026495165/dsh/.workspace/repos/program-notebook/dist/check-notebook.mjs /home/CNS2026495165/dsh
   ```
   实测前提：`.gitignore` 已含 `.workspace/repos/`（免污染 git status）；`dist/check-notebook.mjs` 用 **Node ≥18 直跑，无需 bun**。这一步**在工作区内，无需批准**。
2. **把它注册成 DSH MCP 工具**（需要在 `~/.dsh/settings.yaml` 加 `mcp` 段）→ **需用户批准**，非必需。

---

## 5. 它规定的整理方法论（逐条列出）

### 5.1 固定路径（硬约束，检查器按字面匹配）

1. `docs/program-notebook.md` —— 唯一中枢文档（note：`NOTEBOOK_PATH` 常量，不可配置）。
2. `docs/architecture/*.md` —— 专题展开层，**只扫一层**。
3. 推荐命名 `01-program-structure.md` / `02-data-flow.md` / `03-ci-pipeline.md` / `04-code-style.md`（编号固定，含义固定）。
4. notebook 必须**字面包含**每个 architecture 文档的路径字符串，否则报"architecture 未完整索引"。
5. `README.md` / `HOW2USE.md` 留在根：面向人类入口。
6. `AGENTS.md` / `CLAUDE.md` 留在根：Agent 约束与命令。
7. `docs/superpowers/specs/` —— 设计规格、需求、技术决策过程。
8. `docs/superpowers/plans/` —— 实现计划、任务拆解、执行记录。

### 5.2 notebook 必需 7 项内容（检查器用中文正则判定）

1. 数据流摘要（Mermaid `graph LR`）→ 过长拆 `02-data-flow.md`
2. 架构摘要（`graph TD`/`graph LR`，无孤立节点）→ 过长拆 `01-program-structure.md`
3. 程序运行流摘要（`sequenceDiagram`，启动/运行/关闭/恢复）
4. 配置加载链（来源、优先级、合并规则、覆盖策略、消费模块）
5. 模块摘要（按模块分组，核心详写、辅助一行）
6. 参考资料索引（只索引不复制正文）
7. 已验证的实现缺陷与限制（每条必须有代码/测试/Git 证据；无证据标"未知"或删除）

### 5.3 拆分 `docs/architecture/` 的触发条件

结构图超过 1 张 / 数据流含硬件·网络·异步·状态机·协议·多层反馈 / 测试覆盖需按子系统或 CI 阶段说明 / CI·部署·协议·驱动·硬件排障需独立维护 / 单章节超 100–150 行。

### 5.4 Mermaid 兼容表（`graph LR|TD` 而非 `flowchart`；`stateDiagram-v2`；每条边单独写；节点 ID 用 ASCII；`-.->` 表实现关系）

### 5.5 证据与维护纪律

- **不推测**：任何架构事实/缺陷/限制/风险需源码、配置、测试、Git 或已读文档之一支撑；无法验证写"未验证"。
- 工具报告只是证据入口，不能代替读源码；时间戳只说明"值得检查"，**不能证明内容陈旧**。
- 不做空文档填表；不为满足检查器写空标题/空图/无证据缺陷。
- 每轮不重复注入 skill 或状态报告（缓存友好）。
- 输出必须给出：Notebook 状态 / 专题文档状态 / 检查证据 / 变更章节 / 未验证项。

### 5.6 明确不适用（不要用它整理）的场景

纯格式化、拼写、局部重命名、无行为影响的小优化、一次性脚本，或**源文件少于约 10 个的极简项目**。

> **⚠️ 关键限定：它没有、也不打算定义"工作区根目录散落 md 文件如何收纳"。** 它的分层表只覆盖 `docs/`、`README/AGENTS` 两类；`audit-*` / `execute-*` / `review-*` 这类审计·执行·复核证据报告**在该 skill 里没有对应层**（最接近的是 `docs/superpowers/specs`＝决策过程 与 `docs/superpowers/plans`＝执行记录）。所以下面的映射草案是**在它的分层框架内做的合理外推**，不是它明文规定的动作——必须如实告知用户。

---

## 6. 27 个根目录 `.md` → 目标结构映射草案

现状：`/home/CNS2026495165/dsh` 根目录 **27 个 `.md`，全部被 git 跟踪**（`git ls-files '*.md' | grep -v /` = 27）；**没有 `docs/` 目录**，**没有根级 `AGENTS.md`/`CLAUDE.md`/`HOW2USE.md`**。

分类：审计 8 + 执行 5 + 复核 2 + port 调研 4 + 计划 2 + runbook 2 + 参考 1 + 约定/地图 2 + 入口 1 = 27 ✅

### 方案 A（**推荐**：对齐 program-notebook 分层；24 移动 / 3 留根 / 5 新建，新目录 4 个）

**A-1 新建（skill 强制层，5 个文件 / 2 个目录）**

| 目标路径 | 来源 | 说明 |
|---|---|---|
| `docs/program-notebook.md` | 新建 | 中枢：7 项必需章节 + 参考资料索引（索引下面所有移动后的文档 + `.workspace/` 证据） |
| `docs/architecture/01-program-structure.md` | 新建（可由 `README.md` §仓库内容 + `FEATURE-MAP.md` 插件行 + `wiring-plan.md` 提炼） | 模块职责、关键依赖 |
| `docs/architecture/02-data-flow.md` | 新建（可由 `audit-btw.md` / `execute-btw.md` / `local-api-surface.md` 提炼） | 数据流、状态传播 |
| `docs/architecture/03-ci-pipeline.md` | 新建（可由 `verify-runbook.md` / `.workspace/acceptance-exec.md` 提炼） | 测试覆盖、验证链路、质量门 |
| `docs/architecture/04-code-style.md` | 新建（可由 `DOC-STYLE.md` + 审计里的维护风险提炼） | 风格、复杂模块、维护风险 |

**A-2 移动到 `docs/superpowers/specs/`（13 个：需求 / 差距 / 技术决策过程）**

```
audit-btw.md                    → docs/superpowers/specs/audit-btw.md
audit-btw-model.md              → docs/superpowers/specs/audit-btw-model.md
audit-btw-subagent.md           → docs/superpowers/specs/audit-btw-subagent.md
audit-local-customizations.md   → docs/superpowers/specs/audit-local-customizations.md
audit-subagent-arch-A.md        → docs/superpowers/specs/audit-subagent-arch-A.md
audit-subagent-arch-B.md        → docs/superpowers/specs/audit-subagent-arch-B.md
audit-upstream-upgrade.md       → docs/superpowers/specs/audit-upstream-upgrade.md
audit-wallpaper.md              → docs/superpowers/specs/audit-wallpaper.md
port-taste.md                   → docs/superpowers/specs/port-taste.md
port-tokps-web2.md              → docs/superpowers/specs/port-tokps-web2.md
port-vision-adam.md             → docs/superpowers/specs/port-vision-adam.md
port-wallpaper.md               → docs/superpowers/specs/port-wallpaper.md
local-api-surface.md            → docs/superpowers/specs/local-api-surface.md
```

**A-3 移动到 `docs/superpowers/plans/`（9 个：计划 / 执行记录 / 复核记录）**

```
execute-btw.md                  → docs/superpowers/plans/execute-btw.md
execute-wallpaper.md            → docs/superpowers/plans/execute-wallpaper.md
execution-2b.md                 → docs/superpowers/plans/execution-2b.md
execution-btw-model.md          → docs/superpowers/plans/execution-btw-model.md
execution-subagent-tokps.md     → docs/superpowers/plans/execution-subagent-tokps.md
review-btw.md                   → docs/superpowers/plans/review-btw.md
review-wallpaper.md             → docs/superpowers/plans/review-wallpaper.md
btw-wallpaper-plan.md           → docs/superpowers/plans/btw-wallpaper-plan.md
wiring-plan.md                  → docs/superpowers/plans/wiring-plan.md
```

**A-4 移动到 `docs/runbooks/`（2 个：**技能分层表外的扩展**，需用户确认）**

```
switch-web2-runbook.md          → docs/runbooks/switch-web2-runbook.md
verify-runbook.md               → docs/runbooks/verify-runbook.md
```

**A-5 留根（3 个，符合 skill 的"人类入口 + 索引"层）**

```
README.md      （人类入口，skill 明示留根；被 FEATURE-MAP/DOC-STYLE/execute-* 引用）
FEATURE-MAP.md （能力索引，Tier 2，被 README/DOC-STYLE 引用）
DOC-STYLE.md   （Tier 0 约定，被 README 引用）
```

重命名建议：**默认不改文件名**（最小化引用破坏；历史证据报告按 DOC-STYLE「按落盘时的档期格式保留」）。若想统一为 `dsh-btw/docs/superpowers/` 已用的 `YYYY-MM-DD-<slug>.md` 先例，需先从 `git log --follow --format=%cs --diff-filter=A` 取每个文件的首提日期，且**必须同步改所有引用**——建议第二阶段再做，不与移动混在一次提交。

### 方案 B（**低扰动、与仓库既有约定一致**：只收纳证据，不动分层）

| 目标 | 内容 |
|---|---|
| `.workspace/reports/audits/` | 8 个 `audit-*.md` |
| `.workspace/reports/execs/` | 5 个 `execute-*/execution-*.md` |
| `.workspace/reports/reviews/` | 2 个 `review-*.md` |
| `.workspace/reports/ports/` | 4 个 `port-*.md` |
| `.workspace/reports/plans/` | `btw-wallpaper-plan.md`、`wiring-plan.md`、`local-api-surface.md` |
| `.workspace/reports/runbooks/` | 2 个 runbook |
| 根保留 | `README.md`、`FEATURE-MAP.md`、`DOC-STYLE.md` |
| 新建 | `docs/program-notebook.md` + `docs/architecture/01–04.md`（skill 强制层，仍必须建） |

依据：`README.md` 明文「`.workspace/` 审计/诊断/部署产物与证据」；`.workspace/` 下已有 **249 个被跟踪的 `.md`** 证据报告（`audit-a-lagfix.md`、`acceptance-exec.md`、`btw-ui-exec.md`…），既有命名后缀 `-audit` / `-exec` 与本仓库根目录这 27 个完全同源。**这是与仓库现状冲突最小的方案**，代价是文档埋在 dot 目录里、可发现性差（需靠 `docs/program-notebook.md` 索引弥补）。

### 冲突点（必须如实上报）

1. **工作区已有一套"Tier 分层"文档体系**：`README.md`（指南地图，Tier 0/2 引路）+ `DOC-STYLE.md`（Tier 0 约定）+ `FEATURE-MAP.md`（Tier 2 能力地图）+ `.workspace/*-audit.md|*-exec.md`（证据报告）。program-notebook 要求的中枢叫 **`docs/program-notebook.md`**，与本仓库"README 即中枢 + 功能地图"的既有职责**部分重叠**：新中枢应作为**索引/摘要层**，不得取代 README/FEATURE-MAP。
2. **证据报告没有对应的 skill 层**：`audit-*` / `execute-*` / `review-*` 在 spec 分层表里无归属（最接近 specs/plans），方案 A 属外推；方案 B 才是仓库自认的家。
3. **`docs/superpowers/` 已是"每个插件自己一套"的先例**：`dsh-btw/docs/superpowers/{specs,plans}/`（日期前缀命名）。在根再建同名 `docs/superpowers/` 会造成"根级 vs 插件级"同名同构的潜在混淆，需在 hub 里说明边界。
4. **`docs/runbooks/` 是技能分层表外的自造层**（spec 只有 architecture / superpowers/specs / superpowers/plans）→ 属扩展，需用户拍板；替代做法是把 runbook 放 `docs/` 直下或并入 `docs/superpowers/plans/`。
5. **检查器启发式与仓库布局错配**：`classifyChangedPath` 只认根级 `src/`、`tests/`、`.github/workflows/`；本仓库是多插件目录（`dsh-btw/ dsh-usage/ dsh-wallpaper-local/ session-board/ examples/`）+ `.workspace/deploy-*/` 脚本，**根级既无 `src/` 也无 `tests/`** → 检查器的"精确文档建议"对本仓库几乎只会输出 `docs/program-notebook.md` 一条，价值有限；其"受关注文件"（`.md` 大多不在白名单）也基本不覆盖本仓库的文档改动。**这削弱了安装检查器的收益。**
6. **`docs/program-notebook.md` 的 7 个必需章节是中文正则匹配**（如 `/模块摘要/`、`/配置加载链/`），沿用中文标题即可满足；但 `/架构/`、`/配置/`、`/限制/` 这类宽正则容易误判"已具备"，属于弱检查。
7. 移动会**改变被引用路径**（见 §8 清单），其中 `audit-local-customizations.md` 自身是一个"伪索引"（引用 8 个同批文件 + `README.md`），移动后其内部相对链接方向全部要改。

---

## 7. 风险与安全做法

### 7.1 当前 git 基线（实测，适合起手）

```
$ git status --porcelain
?? .workspace/settings-lag/
?? .workspace/twin-probe/
```
**工作树干净**（仅 2 个未跟踪的 `.workspace/` 探针目录，与本任务无关）。HEAD = `2c0650db274066ca3d791bbae37230db396ec0a7`（2026-09-18）。→ 满足"先 `git status` 清白检查"。

### 7.2 建议的安全做法（按序）

1. **落盘映射表**：把 A-2/A-3/A-4 的 `旧路径 → 新路径` 表写入 `.workspace/settings-lag/migration-map.md`（或直接以本报告 §6 为映射源），作为回滚与引用更新的唯一真相源。
2. **用 `git mv` 保历史**（不要 `mv` + `git add`）：

   ```bash
   cd /home/CNS2026495165/dsh
   mkdir -p docs/superpowers/specs docs/superpowers/plans docs/runbooks docs/architecture
   git mv audit-btw.md docs/superpowers/specs/audit-btw.md
   # … 逐个执行；可脚本化但要保证每行都经映射表核对
   git status --porcelain | grep '^R'      # 应全是 R（rename），无 D+A
   ```
   注意：`git mv` 需要目标目录存在；`git status --porcelain=v1` 的 rename 检测在 `-z` 模式下更可靠（该 skill 自己的 `parseGitStatusPorcelainZ` 也如此处理）。
3. **同一次提交完成"移动 + 引用更新"**，避免中间态留下断链；提交信息里附映射表摘要。
4. **分两阶段**：① 先做 `git mv` + 引用修正 + 新建中枢（可验证、可回滚）；② 再考虑文件名规范化（日期前缀）。**不要与文件重命名混在一次提交**。
5. **回滚预案**：`git reset --hard HEAD`（已提交前）/ `git restore --staged --worktree .` + 反向 `git mv`（映射表倒序）；建议先 `git tag pre-doc-reorg` 或建分支。
6. **新建中枢后再跑检查器**：`node .workspace/repos/program-notebook/dist/check-notebook.mjs /home/CNS2026495165/dsh`（只读），确认 `architecture docs 未完整索引 / 缺失关键章节` 等建议项清零。
7. **`.dsh/skills/` 的入库策略**需先裁决：加 `.gitignore`（推荐，参考 `.dsh/taste/.gitignore` 的做法）或提交入库。
8. **不要移动**：`README.md`、`.workspace/`（249 份被跟踪证据）、`dsh-btw/docs/**`（插件自有 docs，skill 的 projectRoot 只有一个 = 仓库根）。
9. **DOC-STYLE.md 的既有豁免**（「约定不覆盖历史文档（`audit-*.md` / `*.exec.md` 等证据类报告按落盘时的档期格式保留）」）意味着**移动历史报告不改其内容**是合规的；若顺手重写其标题/格式反而违反该条——只移动，不改正文。

### 7.3 移动的额外副作用提示

- `docs/` 变成新目录后，`shouldWatchPath`/检查器的 `walkFiles` 会扫全仓（max 2000 文件）；本仓库 `.workspace/` 有 1360 个 `.md`，可能触及报告 48KB 截断 → 建议给检查器传更窄的 root 或接受截断。
- `git log --follow` 才能跨改名追踪历史；仓库若用了 `--no-renames` 汇总（skill 的 `gitTimestampMap` 就是 `--no-renames`），移动后旧路径时间戳会丢，检查器的"陈旧检测"会把移动当作新文件 → **中枢首次创建后建议尽快提交，让时间戳稳定**。

---

## 8. 被引用位置清单（在 `/home/CNS2026495165/dsh` 下 grep 文件名，排除 `node_modules/ .git/ .workspace/`）

> 说明：grep 只匹配"文件名字符串"，**未区分 markdown 链接与正文提及**；执行前需逐条确认是链接（要改路径）还是纯文本（可保留原名）。

| 文件 | 被引用于 | 移动后需改链接 |
|---|---|---|
| `audit-btw.md` | `audit-btw-subagent.md` | 是 |
| `audit-btw-model.md` | `execution-btw-model.md` | 是 |
| `audit-btw-subagent.md` | `audit-btw.md`、`execute-btw.md`、`review-btw.md` | 是 |
| `audit-local-customizations.md` | 无外部引用（但它自己引用 8 个） | — |
| `audit-subagent-arch-A.md` | 无 | — |
| `audit-subagent-arch-B.md` | 无 | — |
| `audit-upstream-upgrade.md` | 无 | — |
| `audit-wallpaper.md` | `execute-wallpaper.md`、`review-wallpaper.md` | 是 |
| `btw-wallpaper-plan.md` | `audit-btw-subagent.md`、`audit-local-customizations.md`、`audit-wallpaper.md` | 是 |
| `DOC-STYLE.md` | `README.md` | 是（DOC-STYLE 留根 → **无需改**） |
| `execute-btw.md` | `review-btw.md`、`verify-runbook.md` | 是 |
| `execute-wallpaper.md` | `review-wallpaper.md`、`verify-runbook.md` | 是 |
| `execution-2b.md` | 无 | — |
| `execution-btw-model.md` | 无 | — |
| `execution-subagent-tokps.md` | `audit-local-customizations.md` | 是 |
| `FEATURE-MAP.md` | `DOC-STYLE.md`、`README.md` | 否（留根） |
| `local-api-surface.md` | `audit-local-customizations.md` | 是 |
| `port-taste.md` | `FEATURE-MAP.md`、`switch-web2-runbook.md` | 是（**FEATURE-MAP 留根但指向会变**） |
| `port-tokps-web2.md` | `switch-web2-runbook.md` | 是 |
| `port-vision-adam.md` | `switch-web2-runbook.md` | 是 |
| `port-wallpaper.md` | `FEATURE-MAP.md`、`switch-web2-runbook.md` | 是 |
| `README.md` | `audit-local-customizations.md`、`audit-wallpaper.md`、`DOC-STYLE.md` + 大量子项目内 `README.md`（`dsh-btw/**`、`dsh-usage/**`、`dsh-wallpaper-local/**`、`session-board/**`、`pi-taste-analysis/**`、`examples/**`） | 否（留根） |
| `review-btw.md` | 无 | — |
| `review-wallpaper.md` | 无 | — |
| `switch-web2-runbook.md` | 无 | — |
| `verify-runbook.md` | `audit-local-customizations.md` | 是 |
| `wiring-plan.md` | `audit-local-customizations.md` | 是 |

补充：**根目录没有任何 `*.sh`**（`ls *.sh` 为空），脚本类引用风险为零；`.workspace/deploy-*/` 下脚本经 grep 未出现这些文件名。引用集中在**这 27 个文件彼此之间 + `README.md`/`FEATURE-MAP.md`/`DOC-STYLE.md`** 三份留根文件。共 **约 12 个文件含需改写的引用**（主体是 `audit-local-customizations.md`，一个文件就引用 8 个待移动文件）。

---

## 9. 未验证项 / 限制

1. **无法在本会话内验证安装效果**：本子代理只读，未创建 `.dsh/skills/`，因此"装完即被 DSH catalog 发现"是基于代码（rank 100 根 + `findProjectRoot` + watcher）的推断；确证需装完后看会话 skill 目录是否出现 `program-notebook`。
2. **未实测 `codex plugin marketplace add` 流程**（codex-cli 0.147.0 < 仓库基线 0.151.0；且写 `~/.codex` 需批准）；未实测 `pi install`（写 `~/.pi` 需批准）。
3. **未运行 `dist/check-notebook.mjs`**（需先 clone；本会话任务限定只读，未 clone）。其行为由 `lib/program-notebook-lib.ts` 源码与 `bin/check-notebook.ts` 入口推得。
4. `$DSH_BUNDLED_SKILL_DIR` 的具体取值未在当前 shell 环境看到（`env | grep DSH` 无该变量），故 `workbuddy-ppt` / `ppt-template-fidelity` 的确切发现根只确认到 `@local/dsh-pptmaster/skills/` 存在（`SKILL.md` 已定位），未深挖其 provider 注册方式。
5. `~/.dsh/settings.yaml` 中**没有任何 skill 相关段**（`grep -i skill` 无输出），故 `includeDefaultRoots` 为默认 `true`、`customSkillDirs` 为 `[]`；若用户后续加了 `dsh-skill-filesystem` 配置段，本报告结论需重核。
6. 映射草案中"哪些引用是 markdown 链接"未逐条打开确认（§8 已标注该限制）。
