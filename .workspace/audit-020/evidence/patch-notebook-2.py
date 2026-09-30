#!/usr/bin/env python3
# 笔记本补丁批次 2：勘误 E9 + 报告索引 48 → 55
import sys

p = "docs/program-notebook.md"
s = open(p, encoding="utf-8").read()
orig = s


def rep(old, new, cnt=1, tag=""):
    global s
    n = s.count(old)
    assert n == cnt, f"[{tag}] 期望 {cnt} 处命中，实得 {n}: {old[:70]!r}"
    s = s.replace(old, new)
    print(f"  ok [{tag}]")


# E9：物理布局闸门
anchor = "| **E8** | §5.5 多数数字的**基线版本** | §5.5 行文时点为 **rc.1**"
assert s.count(anchor) == 1, "E8 行锚点不唯一"
E9 = (
    "| **E9** | 「会话迁移只有 codec 层一道闸」 | **新增第三道闸：物理布局**。0.2.0 持久层要求"
    "**首帧恰好只有一行 header**（`dsh-session-persistence-jsonl/lib/index.js:2293-2295`），"
    "且 `:3040-3044` 把该错误**静默 `continue`** ⇒ **整根枚举为空**（不是报错，是「看不见」）。"
    "第一版转换器把每份日志压成单帧：**codec 层 2508/2508 通过，但 `listArtifacts` 枚举 0**；"
    "同内容分帧后 **418/418**。⇒ 任何会话产物必须**同时**过 codec 闸门与物理闸门 | "
    "`p0a/framecheck.mjs`；`p0a/verify/VERIFY-REPORT.md` §5；§5.6.4 |\n"
)
line_end = s.index("\n", s.index(anchor))
s = s[: line_end + 1] + E9 + s[line_end + 1 :]
print("  ok [插入 E9]")

# §5.7 标题
rep(
    "### 5.7 本轮报告总索引（`.workspace/audit-020/reports/`，全部 48 份）",
    "### 5.7 报告总索引（`.workspace/audit-020/reports/`，全部 55 份）",
    tag="5.7 标题",
)

# §5.7 口径 ④
rep(
    "> ④ 覆盖数 **48/48**（目录内 `*.md` 47 份 + `*.yml` 1 份）；⑤ 交接件 §2 P2 说的「47 份」是 rc.1 期计数（同型差异见勘误 E5）。",
    "> ④ 覆盖数 **55/55**（目录内 `*.md` 54 份 + `*.yml` 1 份）；⑤ 交接件 §2 P2 说的「47 份」是 rc.1 期计数（同型差异见勘误 E5）；\n"
    "> ⑥ **接手轮新增 7 份**（#49–#55）已并入下表并重算三个集合。",
    tag="5.7 口径",
)

# 追加 #49–#55
last48 = "| 48 | `T06-proposed-cordis.patch.020.yml` |"
i = s.index(last48)
eol = s.index("\n", i)
rows = "\n".join(
    [
        "| 49 | `COORDINATOR-ROUND-STATUS.md` | 接手轮协调者总结：三件点名事的结论 + 全部数字 + 证据索引 | 已定案 | 该轮总纲；数字被 §5.6.4 引用 |",
        "| 50 | `RESTART-AND-VERIFY-RUNBOOK.md` | **重启 3098 与验收 Runbook**（一次重启覆盖两插件修复 + Open in App） | 已定案 | 含 GUI 逐项验收与回滚；**重启未执行** |",
        "| 51 | `OPEN-IN-APP-FIX.md` | Open in App 无响应：源码级因果链闭环 + 启动脚本修复 | 已定案 | 修复已实施并脚本层实证；**真实窗口未验收** |",
        "| 52 | `VOLATILE-FIX-VERIFY.md` | 两插件 `.volatile()` 修复的独立复核（含 200 条 profile 条目可服务性登记表） | 已定案 | 缺口修复前 2 条 / 修复后 **0 条**；结论「足够但需重启」 |",
        "| 53 | `SKILLS-MIGRATION-VERIFY.md` | 技能迁移独立复核（发现路径、逐技能加载、未迁移资产清点） | 已定案 | 4/4 加载、警告 0；`AGENTS.md` 缺失已补 |",
        "| 54 | `N17-ROOT-CAUSE-CORRECTION.md` | N17 根因勘误（逐条判定交接件原叙述） | 已定案 | 基线 9.13% / 只修 descriptor 82% / 修完两处 **100%**；与协调者逐份一致 |",
        "| 55 | `COORDINATOR-SUBAGENT-MESSAGES.md` | 协调者发给执行档的 3 条追加消息原文（导出件） | 已定案 | 供复核 `send_message` 内容；对应子会话 seq 已记录 |",
    ]
)
s = s[: eol + 1] + rows + "\n" + s[eol + 1 :]
print("  ok [追加 #49-#55]")

# 三个集合重算
rep("| **已定案** | **37** |", "| **已定案** | **44** |", tag="集合-已定案")
rep("（逐行相加 = **37**） |", "（逐行相加 = **37 + 新增 7 = 44**） |", tag="集合-逐行")
rep("| 三集合合计 | **48** | 37 + 4 + 7 = **48** |", "| 三集合合计 | **55** | 44 + 4 + 7 = **55** |", tag="集合-合计")
rep(
    "| 目录核验 | **48** | 目录内 `*.md` **47** + `*.yml` **1** = **48**",
    "| 目录核验 | **55** | 目录内 `*.md` **54** + `*.yml` **1** = **55**",
    tag="集合-核验",
)

open(p, "w", encoding="utf-8").write(s)
print(f"\n完成：行数 {orig.count(chr(10))} -> {s.count(chr(10))}")
