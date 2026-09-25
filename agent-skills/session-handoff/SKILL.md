---
name: session-handoff
description: "把当前会话的工作内容、进展与目标整理成仓库根 `<前缀>_NEXT_SESSION_PROMPT.md`，供下一个会话快速接手；也提供接手模式：读取既有交接文档、实跑核对现状、回报偏差、复述理解、按前置闸门开工。用于用户要求交接/交班/换会话继续、会话即将结束或上下文将满、需跨会话续接工作、或拿到一份 *_NEXT_SESSION_PROMPT.md 要接着干时。生成件含可粘贴启动块、事实基线、任务优先级、已裁决不得重开、死路、历史坑、关键文件索引与 Runbook，历史归档于 .dsh/handoffs/。"
metadata:
  version: "1.0.1"
  author: "CNS2026495165"
  updated: "2026-09-25"
---

# 会话交接（Session Handoff）

## 核心原则

- **强制取证，禁止凭 agent 记忆**：交接文档里每条关键断言都必须来自本次会话真跑的命令输出或已读文件；取不到证的标 `[仅记忆]`，不得当作事实陈述。
- **编号含义固定、省略不重排**：`§0`–`§9` 的含义由「编号契约」固定；无内容的小节宁可省略，省略后**不重排**编号、不留空壳小节。
- **勘误可累积、由接手方实测回写**：接手方实测出的偏差写回「勘误回写块」，原文保留不删。
- **只读取证，不跑构建/测试**：取证只用只读命令（`git status/diff/log`、路径存在性、阅读文件）；本 skill **不动 git、不自动提交**、不跑构建与测试。

## 缓存友好的按需加载

- 本文件只保留触发条件、核心工作流与边界；同一任务中读一次即可，不要每轮重复加载。
- 只在真正需要对应细节时读 reference，不要一次性加载全部四个文件。
- 已读入当前会话且文件未变化时，不要重复读取。

| 当前任务 | 按需读取 |
|---|---|
| 生成交接文档：格式、YAML 字段、`§0`–`§9` 职责、编号契约、篇幅预算、聚焦模式 | [references/handoff-spec.md](references/handoff-spec.md) |
| 生成交接文档：七步流程、取证清单、自检命令与可执行片段 | [references/generate-playbook.md](references/generate-playbook.md) |
| 接手一份既有交接文档：六步、闸门、复述模板、勘误回写时机 | [references/resume-playbook.md](references/resume-playbook.md) |
| 想看真实历史交接件骨架、编号差异、竞品失败模式「不要这样做」 | [references/examples-and-pitfalls.md](references/examples-and-pitfalls.md) |

## 两种模式

### 生成模式

- **触发**：用户要求交接/交班/换会话继续/整理进度给下一个会话；或会话即将结束、上下文将满。
- **第一步**：读 [references/generate-playbook.md](references/generate-playbook.md) 走七步；格式、字段与阈值一律以 [references/handoff-spec.md](references/handoff-spec.md) 为准。
- **产物**：仓库根 `<前缀>_NEXT_SESSION_PROMPT.md`（一律带前缀）；旧件归档到 `.dsh/handoffs/`。

### 接手模式

- **触发**：拿到一份 `*_NEXT_SESSION_PROMPT.md`；用户说「接着干」「接手」「按这份文档开工」。
- **第一步**：读 [references/resume-playbook.md](references/resume-playbook.md) 走六步：先实跑核对，再复述理解，过闸门后才动手。

## 边界

- **严格不编辑 `docs/program-notebook.md`**（那是 `program-notebook` skill 的职责）；本 skill 只在交接文档里列「建议下个会话更新的 notebook 条目」。
- **不在交接文档里写「接手方应加载哪些 skill」**：交接文档只描述事实、任务、闸门与索引，不替接手方决定加载什么。

## 副本与同步

- **权威副本**：`~/.dsh/skills/session-handoff/`（DSH 实际加载；用户级，rank 400，全工作区生效）
- **分发快照**：仓库内 `agent-skills/session-handoff/`（**非** DSH 发现路径，不会遮蔽权威副本）
- **同步方式**：**手工同步**；修改后两处文件须逐字节一致（`shasum -a 256` 比对）
- **变更记录**：`1.0.1` = 修复 `check-sections.sh` 预算计数把「不编号附录」算进 `§9`（假 FAIL）；补 §1 自指计数口径规则；更正 `grep -E \b` 的错误说法。`1.0.0` = 首次交付。
- **version**：`1.0.1`（与 frontmatter `metadata.version` 保持一致）

## 最终回复格式

生成模式收尾必须报四件事：① 产物路径（仓库根交接件 + 归档件）② 自检结果（逐条命令的真实输出摘要）③ 未核实项清单 ④ 归档体积（`.dsh/handoffs/` 现存的份数）。
