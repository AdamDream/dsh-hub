---
generated_at: "2026-09-30 11:40:00"
prefix: "dsh-020"
cwd: "/home/CNS2026495165/dsh"
repo_root: "/home/CNS2026495165/dsh"
git_branch: "main"
goal:
  objective: "DSH 0.2.0-rc.2 迁移：阶段一（审计+可运行组合+文档）已完成；阶段二「把 3080 的历史会话迁到 0.2.0」+ 剩余功能补齐"
  id: "goal-a8d4c364-8e85-4c26-8004-acc4f872ad85"
  revision: 3
前件:
  - "dsh-020_NEXT_SESSION_PROMPT.md（2026-09-30 10:40 版，已归档到 .dsh/handoffs/）"
  - "office-upgrade_NEXT_SESSION_PROMPT.md（更早的 0.1.7 迁移件，已被取代）"
archive:
  dir: ".dsh/handoffs"
  retained: "3"
---

> **勘误回写块（本轮实测后追加，原文不删不改）**
>
> **2026-09-30 11:40（本轮生成）** —— 本件取代 10:40 版。**上一版 §2 P0-A 与 §5 的两条关键叙述已被本轮证伪**，接手方
> 以本件为准：
>
> - ❌ 上一版：「余 40% 卡在三种打包行（`text-chunks`/`reasoning-chunks`/`tool-call-chunks`）」。
>   **不成立**：0.2.0 的 v0 codec **本来就支持**打包行（`dsh-session-format-v0-to-v1:1610-1614/1656-1690/1796-1808/1809-1843`）。
>   349 份含打包行的日志里 **162 份在完全未修复时即可读**（最大单文件 72,479 行打包行）。
> - ✅ 正确叙述：**第二道闸是「插件消息来源 `form:"snapshot"` 缺 `sections` 数组」**，挡 **456** 份，
>   判定点 `dsh-session-format-v0-to-v1:942-947`，出现在 v0 的三处消息位置；
>   写入侧先例是 `dsh-taste/learner.js:219`（0.1.1 与 0.2.0 **逐字节相同**）。
> - ❌ 上一版 §5 的「修 descriptor 后 60%」→ 实测 **81.82%**（消融：只改 descriptor，不补 sections）。
> - ✅ **修完两处 = 2508/2508 = 100.00% 可读**。
> - ⚠️ 上一版 §5「N1 三插件已修」在 GUI 上仍表现为**设置页不可用**——真因不是插件没加载，
>   而是 0.2.0 的设置面**只暴露 `.volatile()` 字段**；两个插件当时一个 volatile 字段都没有。本轮已修。
> - ⚠️ 上一版完全没记录**技能面**，这正是用户点名「很多 skill 没有成功迁移」的文档侧成因。

## §0 你的第一件事

1. **先读 `.workspace/audit-020/reports/RESTART-AND-VERIFY-RUNBOOK.md`** —— 若 3098 还没重启，
   一切修复都还没生效（宿主半是 ESM 模块，`hmr root: []` 不重载）。**重启由用户执行**，
   agent 不能自己重启 3098（会话跑在该进程里，重启会杀掉会话）。
2. 再读（按序）：`reports/COORDINATOR-ROUND-STATUS.md`（本轮总结，含全部数字）→
   `reports/VOLATILE-FIX-VERIFY.md`（两插件复核）→ `reports/N17-ROOT-CAUSE-CORRECTION.md`（N17 勘误）→
   `reports/SKILLS-MIGRATION-VERIFY.md`（技能复核）→ `p0a/BRIEF.md`（P0-A 共享事实基线）。
3. 不得重开：`reports/DECISIONS-BEFORE-CUTOVER.md` 的 D1–D25（唯一例外：D1 已被 2026-09-30 用户裁决取代）。
4. 不得停改 `3080` / `3097`；不得改 `~/.dsh/**` 与 `~/.dsh-017/**`（**只读源**）。
5. 第一动作（只读）：`cd /home/CNS2026495165/dsh && ss -ltn | grep -E ':(3080|3097|3098) '`

## §1 客观事实基线（本轮实测）

| 事项 | 已核实事实 |
|---|---|
| 隔离根 | `.workspace/audit-020/assembly-020/`：`prefix-cli-rc2/`（0.2.0-rc.2 CLI）、`home/`（伪装 DSH_HOME）、`drill-home/`（验证用，51 MB，sessions 为软链）、`boot-web.sh` |
| 现役/隔离 | `3080`=0.1.1-rc.2、`3097`=0.1.7-rc.2、`3098`=0.2.0-rc.2 **均在监听** |
| 组合规模 | `--dump-config` **rc=0 / 200 条目 / 27 disabled**；drill 真启动 **`disabling profile plugin row` = 0、`failed to import` = 0** |
| 设置面 served | 现役 3098 实抓 **25** 条 → 修后 drill **27** 条（差额**恰好** = `subagent-model` + `vision-adam`） |
| 历史语料 | `~/.dsh/sessions` = **2508 份 `.zstd` + 3 lock**（v0 2505 / v3 3），1.23 GB；**活跃 append-only 根** |
| 会话转换 | 基线 **9.13%** → 转换后 **100.00%**（两把闸门全过） |
| 落盘 | `assembly-020/home/sessions/` 2511 文件（sha256 2511/2511）→ 整根 2543 文件；附件 996 文件（sha256 996/996） |
| 端到端 | drill 真启动：`listArtifacts() = 2521`（v0 2502 / v3 3 / v4 16）、**legacy read-open 40/40 成功** |
| 技能 | `$A/home/skills/` 4 个用户技能；实跑 provider **4/4 加载、警告 0**；本轮会话目录当场 2 → 5 条 |
| 本件自身 | 本次自生成 |

## §2 本轮已完成（可复现）

1. **两个模型路由插件修复**：`.volatile()` 契约；两处 cosmokit 引用解包；**peer 范围放宽**（不再依赖 `compatibility.json` 豁免，实跑验证）。
2. **技能迁移**：4 个用户技能 + `wallpapers/` + `taste/` + **`AGENTS.md`** 就位（当场生效，无需重启）。
3. **P0-A 历史会话转换**：两处白名单修复（R1 descriptor 2→3、R2 补 `sections: []`），**两把闸门**（codec 层 + 物理布局层），
   全量落盘 + 附件落盘 + 逐文件 sha256 清单。
4. **P0-B settings 投放**：`vision-adam` / `wallpaper` / `ssh-gui` 三段按现役原值写进 profile patch（drill 实测 `applies=live`）。
5. **文档收口（P2）**：`docs/program-notebook.md` 已含 48/48 报告索引与 8 条勘误；新增两份 `docs/architecture/`。
6. **勘察/草案（未落地）**：Route B（`p0c/`）、remoteHosts（`p1/`）。

## §3 下一步优先级

- **P0-1（用户执行）**：重启 3098 并跑 `verify-settings-served.mjs`（见 §0 的 Runbook）。
- **P0-2**：**正式切换前重取语料快照再转换一次** —— 源根是活跃 append-only 根
  （本轮实测：快照后 +2 份、7 份被追加）。本轮转换产物只能作为**技术验证**，不能直接当终稿。
- **P1**：把 `p0c/` 的 Route B 草案**落地**（需用户裁决 5 点，见 `p0c/REPORT.md` 结尾）。
- **P1**：把 `p1/` 的 remoteHosts 方案**落地**（首选方案 1；另需处理 `CH_DWS` 7 处不对齐与 `dsh.profile.bundles` 缺 WE 的问题）。
- **P2**：N1 / N10 / N16 复验（本轮未做）。
- **P2**：GUI 层逐项验收（设置页保存、识图工具调用、btw 侧聊、SSH 远端子功能）——本轮只做到进程内 + RPC 层。

## §4 已裁决（不得重开）

沿用 `reports/DECISIONS-BEFORE-CUTOVER.md` 的 D1–D25。本轮**新增/强化的三条**：

- **D1 取代版**：迁移方式 = 「尝试把历史全部迁到 0.2.0」（2026-09-30 用户裁决）。本轮已用转换器证明**技术上可达 100%**。
- **新增**：修复"设置页不可用"类问题，一律先查 `.volatile()` 契约，不要先怀疑插件没加载。
- **新增**：会话产物的正确性必须**同时**过两把闸门（codec 层 + 物理布局首帧），缺一不可
  （第一版转换器只过 codec 层，持久层会整根枚举为空）。

## §5 待办与开放项

- **需你裁决**：① 正式切换的时点（源根仍在写，需一个静止窗口或接受"以某时刻快照为准"）；
  ② Route B 的 5 个裁决点；③ remoteHosts 的方案取舍；④ 是否允许把其余 4 个仍依赖 `compatibility.json` 豁免的插件
  （`taste`/`workerspace`/`dsh-pptmaster`/`web-search-sse`）也做 peer 放宽。
- **未闭门禁（不得包装为通过）**：
  - **重启未执行** → 两处修复在 3098 里**尚未生效**。
  - **N17 未全闭**：历史可读已解决，但 ①活跃根需重取快照、②**0.2.0 自己写的 v0 日志会被自家 codec 拒收**
    （本轮实测：10:55 后新写 9 份中 7 份被拒）—— 属上游真实缺陷，按 D22 留待存量修完再报。
  - **N1 / N10 / N16**：本轮未复验。
  - **GUI 层**：只做了进程内 + RPC 层实证；设置页表单**实际点击保存未做**。
  - **P0-C / P1**：只有草案与勘察，**未落地**。

## §9 一句话开启方式

接手 `dsh-020_NEXT_SESSION_PROMPT.md`：先读
`.workspace/audit-020/reports/RESTART-AND-VERIFY-RUNBOOK.md`，**若 3098 未重启就先让用户重启并跑
`node verify-settings-served.mjs 3098`**；然后按 §3 的优先级推进——**P0-2 是重取快照再转换**（源根是活跃根），
其次是 `p0c/` 与 `p1/` 两个草案的落地裁决。
