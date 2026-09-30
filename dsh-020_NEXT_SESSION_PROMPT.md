---
generated_at: "2026-09-30 12:12:25"
prefix: "dsh-020"
cwd: "/home/CNS2026495165/dsh"
repo_root: "/home/CNS2026495165/dsh"
git_head: "66ef701c"
git_branch: "main"
goal:
  objective: "完成 dsh-020 会话迁移工作的剩余任务：① P0-A 把 3080 的历史会话转换迁移到 0.2.0；② 修复两个模型路由插件在 0.2.0 不可用；③ 把未迁移的 skill 成功迁移到 0.2.0 并可用；④ 其余 P0-B settings 投放、P0-C 办公入口 Route B、P1 remoteHosts、P2 文档收口。全程不得停改 3080/3097，不得动 ~/.dsh/** 与 ~/.dsh-017/** 的活值。"
  id: "goal-2659dee9-cbd7-4923-89ea-0a870bc37316"
  revision: 2
other_units:
  - prefix: "handoff-skill"
    path: "handoff-skill_NEXT_SESSION_PROMPT.md"
    generated_at: "2026-09-25 12:01:47"
    one_line_status: "session-handoff 技能自身的交接件（已交付并入库），与 0.2.0 迁移主线无关 [已核实：读其 YAML 头]"
  - prefix: "office-upgrade"
    path: "office-upgrade_NEXT_SESSION_PROMPT.md"
    generated_at: "2026-09-29 16:36:30"
    one_line_status: "0.1.7 迁移交接件；其 §2 的 P0-A/P0-B/P0-C 已全部由 dsh-020 线处理或取代 [已核实：读其 YAML 头]"
archive:
  dir: ".dsh/handoffs"
  retained: "4"
---

> **勘误回写块（接手方实测后追加，原文不删不改）**
>
> **2026-09-30 12:12（本次生成）** —— 本件取代同日 11:34 版（已归档）。**11:34 版之前那份 10:40 版的两条关键叙述已被实证推翻**，
> 接手方以本件为准；两条勘误在本轮已由第三方执行档独立复核（见 §6）：
>
> - ❌ 10:40 版 §2 P0-A / §5：「余 40% 卡在三种打包行（`text-chunks`/`reasoning-chunks`/`tool-call-chunks`）」。
>   **不成立**：0.2.0 的 v0 codec **本来就支持**打包行。真正的第二道闸是**插件消息来源缺 `sections` 数组**。
> - ❌ 10:40 版 §5：「修 descriptor 后 60%」。实测 **81.82%**（只改 descriptor、不补 sections 的消融）。
> - ❌ 10:40 版 §5 隐含「一道 codec 闸门就够」。**漏了第三道闸**：会话日志的**物理布局**（首帧必须恰好只有一行 header），
>   否则持久层 `listArtifacts` 会**静默跳过整根**（不报错、枚举 0）。
> - ❌ 10:40 版 §5「N1 三插件已修」在 GUI 上仍表现为**设置页不可用** —— 那是**另一道门**（`.volatile()` 契约），本轮才修。
> - ⚠️ 10:40 版**完全没记录技能面**，这正是用户点名「很多 skill 没有成功迁移」的文档侧成因（真因：`$DSH_HOME/skills/` 此前根本不存在）。
>
> **2026-09-30 12:12 自纠（本次生成过程中发现）**：本会话一度用**含 `AUTH` 的臆造正则**判定插件的环境擦洗面，
> 把 `XAUTHORITY` 误报为「会被擦掉」；已用源码真正则 `/KEY|PASSWORD|SECRET|TOKEN/i` 复核——**`XAUTHORITY` 会被转发**。
> 同类自纠见 §7 第 1 条。

## §0 你的第一件事

1. 先加载 `session-handoff` 的**接手模式**，再读本件全文；按它先实跑核对、再复述、过闸门后才动手。
2. **必读（按序）**：本件 → `.workspace/audit-020/reports/COORDINATOR-ROUND-STATUS.md`（本轮总纲与全部数字）→
   `.workspace/audit-020/reports/RESTART-AND-VERIFY-RUNBOOK.md`（**若 3098 还没重启，一切修复都还没生效**）→
   `.workspace/audit-020/reports/OPEN-IN-APP-FIX.md` → `.workspace/audit-020/reports/DECISIONS-BEFORE-CUTOVER.md`（D1–D25，不得重开）。
3. 不得重开 D1–D25（唯一例外：D1 已被 2026-09-30 裁决取代）；不得停改 `3080` / `3097`；不得改 `/home/CNS2026495165/.dsh/**` 与 `/home/CNS2026495165/.dsh-017/**`。
4. **不得自行重启 3098** —— 接手方若跑在同一宿主进程里，重启会杀掉自己的会话；重启由用户执行。
5. 第一动作（只读，三条一起跑）：`ss -ltn | grep -E ':(3080|3097|3098) '`；
   `git log --oneline -3`；`node .workspace/audit-020/verify-settings-served.mjs 3098`
   —— **PASS = 重启已完成；FAIL（报 2 条 MISSING）= 还没重启**。

## §1 客观事实基线

| 事项 | 已核实事实（含证据） |
| --- | --- |
| 仓库 / HEAD | `[已核实]` `/home/CNS2026495165/dsh`、`main`、**HEAD `66ef701c`**（`git rev-parse` 实测）；**与 `origin/main` 同步，0 个未推送提交** |
| 本轮提交 | `[已核实]` **`66ef701c`**「dsh-020: 两处插件修复 + 历史会话迁移 100% + Open in App 桌面环境转发」，135 文件 / +89 759 行 / 19.6 MB，**已 `git push` 成功**（`651b1712..66ef701c`） |
| 隔离根 | `[已核实]` `.workspace/audit-020/assembly-020/`：`prefix-cli-rc2/`（rc.2 CLI）+ `home/`（伪装 `DSH_HOME`）+ `drill-home/`（验证用，`sessions` 为软链）+ `boot-web.sh` |
| 现役 / 隔离 | `[已核实]` `3080`=0.1.1-rc.2、`3097`=0.1.7-rc.2、`3098`=0.2.0-rc.2 **均在监听且全程未动** |
| 组合规模 | `[已核实]` `--dump-config` **rc=0 / 200 条目 / 27 disabled**；drill 真启动 **`disabling` 0 / `failed to import` 0** |
| 设置面 served | `[已核实]` 现役 3098 实抓 `/api/settings/describe` = **25**；修后 drill = **27**（差额**恰好** = `subagent-model` + `vision-adam`）⇒ **代码正确但需重启才生效** |
| 历史语料 | `[已核实]` `/home/CNS2026495165/.dsh/sessions` = **2508 份 `.zstd` + 3 lock / 1.23 GB**（v0 2505 / v3 3）；**活跃 append-only 根**（冻结后又增长） |
| 会话迁移 | `[已核实]` 基线 **9.13%** → 转换后 **2508/2508 = 100.00%**；两处白名单修复 R1 2275 处 / R2 912 处 |
| 落盘 | `[已核实]` `assembly-020/home/sessions/` 2511 文件（sha256 2511/2511）+ 附件 996 文件（996/996）；整根 `framecheck` 全绿 |
| 端到端 | `[已核实]` drill 真启动：`listArtifacts()` = **2521**（v0 2502 / v3 3 / v4 16）、**legacy read-open 40/40 成功** |
| 技能 | `[已核实]` `assembly-020/home/skills/` 4 个用户技能 + `AGENTS.md`；实跑 provider **4/4 加载、警告 0**；本轮会话目录当场 2 → 5 条 |
| 本件自身 | `[已核实]` 本次自生成，**非待处理脏改动**；`git status --short` 共 **442 行**（**含本件自身 1 项**；不含本件时 441），其中绝大多数为**前序会话遗留**与他人工作区，全文见不编号附录 A |

## §2 最高优先级任务清单

**P0-A（阻塞用户执行）重启 3098 并验收**
- 前置闸门：读 `.workspace/audit-020/reports/RESTART-AND-VERIFY-RUNBOOK.md`；**重启必须由用户在真实桌面终端执行**。
- 判定标准：`node .workspace/audit-020/verify-settings-served.mjs 3098` 输出 **`RESULT: PASS`**（4 条全 OK、served count = 27）；
  且 GUI 里设置页两个表单可渲染、技能目录 5 条、右上角 Open in App 的真实窗口出现。
- **不以 HTTP 200 或命令退出 0 结案**（`launched` 语义过宽，见 §6）。

**P0-B 切换前重取语料快照 + 重跑转换与两道闸门**（用户 2026-09-30 新裁决）
- 前置闸门：确认 `/home/CNS2026495165/.dsh/sessions` 处于静止窗口（或明确接受「以某时刻快照为准」）。
- 判定标准：重跑 `.workspace/audit-020/p0a/census.py` → `p0a/scan.mjs` → `p0a/framecheck.mjs` → `p0a/convert.mjs`，
  **两道闸门全绿**（codec 层 100% + 首帧 header-only 100%），再重做 `p0a/deploy/` 落盘与 sha256 清单。
- ⚠ 本轮 2508 份是**冻结时刻口径，不得当切换终稿**。

**P1-A 落地办公入口 Route B**（用户 2026-09-30 授权）
- 前置闸门：`p0c/REPORT.md` 结尾的 5 个裁决点需用户先答（端口 / 白名单根 / 独立监听 / 投递器补丁 / 令牌轮换）。
- 判定标准：投递一个文件 → 0.2.0 侧真的出现工作区/会话；鉴权与目录/扩展名白名单到位；拒绝时返回明确状态码。
- 现有资产：`p0c/REPORT.md`、`p0c/RUNBOOK-WP5.md`、`p0c/cordis.patch.insert.yml`、`p0c/plugin-draft/`（自测 34/34 + 18/18）；**必须先读 WP5 对上一轮「官方件够用」的更正：自建薄插件不可避免。**

**P1-B 落地 remoteHosts**（用户 2026-09-30 授权）
- 判定标准：右栏停靠面能列出/切换远端主机；`CH_DWS` 7 处对齐；`dsh.profile.bundles` 补 WE 后 mixed-provider 告警消失。
- 现有资产：`p1/WP6-REPORT.md`、`p1/draft/`（方案 1 草案）、`p1/verify/run-all.sh`（66 PASS）。

**P2 复验 N1 / N10 / N16；GUI 层逐项验收**（详见 §5）

## §3 本会话已完成的工作

1. **两个模型路由插件修复**：真因是 `.volatile()` 契约（不是插件没加载）；修完 drill 实证 served 25 → 27，并放宽 peer 使其不再依赖豁免文件。
2. **技能迁移**：补齐 `skills/` + `wallpapers/` + `taste/` + `AGENTS.md`，实跑 4/4 加载（当场生效，无需重启）。
3. **P0-A 完成并实证**：2508/2508 = 100% 可读 + 落盘 + 端到端 `listArtifacts`/read-open；发现并修掉第三道「物理布局」闸门。
4. **P0-B settings 投放**（`vision-adam`/`wallpaper`/`ssh-gui` 三段）+ **Open in App 修复**（启动脚本转发桌面变量，源码级闭环）。
5. **文档收口与交付**：`docs/program-notebook.md` 扩到 695 行（索引 48 → 55 份 + 勘误 E9 + §7 D36–D38 + §8 未验证项 13–16）；全部入 commit `66ef701c` 并推送。

## §4 已裁决与权威四层

沿用 `.workspace/audit-020/reports/DECISIONS-BEFORE-CUTOVER.md` 的 **D1–D25**（**不得重开**）。本轮相关四条：

- `[已核实·落盘]` **D1 已被取代**：2026-09-30 用户裁决「**尝试把历史全部迁到 0.2.0**」（原句）——本轮已用转换器证明**技术上可达 100%**。
- `[已核实·落盘]` **新增裁决①**：**切换前重取语料快照 + 重跑转换与两道闸门**（源根是活跃 append-only 根）。
- `[已核实·落盘]` **新增裁决②**：**P0-C Route B 与 P1 remoteHosts 两项均授权落地**。
- `[已核实·落盘]` **新增裁决③**：**同类 peer 风险一并收**（已完成：6 个插件解除对 `compatibility.json` 的人工依赖）。
- 权威顺序：用户明确裁决 > 隔离安全边界 > 已授权具体范围 > 未授权不扩展 > 已否决不得复活。

## §5 待办与开放项

- **需你裁决**：① Route B 的 5 个裁决点（见 `p0c/REPORT.md` 结尾）；② remoteHosts 方案 1 / 方案 2 取舍；
  ③ 切换时点（是否设静止窗口）。
- **未闭门禁（不得包装为通过）**：
  - **重启未执行** ⇒ 两插件修复与 Open in App 修复在 3098 里**尚未生效**。
  - **GUI 层未逐项验收**：设置页点击保存、识图工具调用、btw 侧聊面板、SSH 远端子功能**均未验证**。
  - **N17 未全闭**：历史可读已解决，但活跃根需重取快照、且**上游存在「自写自读失败」缺陷**（0.2.0 写出的 v0 日志被自家 codec 拒收，实测 9 份中 7 份被拒），按 D22 留待存量修完再报。
  - **N1 / N10 / N16**：本轮未复验。
  - **P0-C / P1**：已授权但**只有草案**，未落地。

## §9 一句话开启方式

接手 `dsh-020_NEXT_SESSION_PROMPT.md`：先读 `.workspace/audit-020/reports/RESTART-AND-VERIFY-RUNBOOK.md`，
**若 3098 未重启就先让用户重启**（一次重启同时生效两插件设置页修复与 Open in App），
再按 `.workspace/audit-020/reports/COORDINATOR-ROUND-STATUS.md` 与 §2 的 P0-B / P1-A / P1-B 推进。

---

# 不编号附录

## A. `git status --short` 全文（`[实跑]` 2026-09-30 12:12，含本件自身 1 项）

> **自检口径（必读）**：本节是 `git status --short` 的**逐字转储**，含**其它会话**的非 ASCII 文件名。
> 可达性探针 `probe-reachability.sh` 对本节会报 **2 处假 MISSING** ——
> `git status --short` 把非 ASCII 路径转义成八进制（如 `\345\237\213…`），正则字符类在反斜杠处断词，
> 于是只剩一个**不存在的前缀**。**这两个文件在磁盘上真实存在**（实测 651 822 B 与 655 404 B，见
> `.workspace/audit-020/evidence/handoff-selfcheck.txt`）；**本件正文（§0–§9）的引用路径 0 不可达**。
> 该断词类假阴性是 skill `generate-playbook.md` 已登记的已知坑（其「三条必须遵守的写法」第 3 条）。

口径：**442 行**；绝大多数是**前序会话遗留**（`.workspace/lag-fix/` 等）与**被本轮 `.gitignore` 新挡住的运行产物**
（后者不再出现于本清单）。本轮已提交内容见 `git show --stat 66ef701c`。

```
 M .workspace/lag-fix/exec-audit/BATCH-PLAN.md
 M .workspace/lag-fix/incident2/VERDICT.md
 M .workspace/lag-fix/incident2/firefox-a11y/analyze.mjs
 M .workspace/lag-fix/incident2/firefox-a11y/audit.md
 M .workspace/lag-fix/incident2/firefox-a11y/proof/verdict.json
 M .workspace/lag-fix/incident2/firefox-a11y/proof/verdict.md
 M .workspace/lag-fix/incident2/instrument-tiebreak/lib/lock.mjs
 M .workspace/lag-fix/incident2/instrument-tiebreak/lib/probe.js
 M .workspace/lag-fix/incident2/instrument-tiebreak/runners/matrix.mjs
 M docs/program-notebook.md
 M dsh-020_NEXT_SESSION_PROMPT.md
 M dsh-btw/CHANGELOG.md
 M dsh-btw/README.md
 M dsh-btw/lib/client.js
 M dsh-btw/lib/index.d.ts
 M dsh-btw/lib/index.js
 D dsh-btw/lib/remote-C2Gojj6I.js
 D dsh-btw/lib/remote-D8pzPah2.d.ts
 D dsh-btw/lib/remote-descriptors-Cu5331mU.js
 M dsh-btw/lib/typert.host.js
 M dsh-btw/lib/typert.remote-client.d.ts
 M dsh-btw/lib/typert.remote-client.js
 M dsh-btw/scripts/smoke-build.mjs
 M dsh-btw/src/client/SideChatSurface.tsx
 M dsh-btw/src/client/btw-settings.ts
 M dsh-btw/src/host/side-chat-service.ts
 M dsh-btw/src/host/vision.ts
 M dsh-btw/src/index.ts
 M dsh-btw/src/shared/remote.ts
 M dsh-btw/tests/controller.spec.ts
 M dsh-btw/tests/host-opening.spec.ts
 M dsh-btw/tests/remote-contract.spec.ts
 M dsh-btw/tests/side-chat-surface.spec.tsx
?? .dsh/
?? .iso/
?? .npm-cache-tmp/
?? .npmrc-home/
?? .p0b-root
?? .p0exec-root
?? .probe/
?? .tmp-1954/
?? .ud1-root
?? .workspace/audit-020/dump-017.err
?? .workspace/audit-020/dump-020.err
?? .workspace/audit-020/evidence/check-sections.sh
?? .workspace/audit-020/evidence/patch-notebook-2.py
?? .workspace/audit-020/evidence/patch-notebook-3.py
?? .workspace/audit-020/evidence/probe-reachability.sh
?? .workspace/audit-020/extracted/
?? .workspace/audit-020/fakehome/
?? .workspace/audit-020/fakehome017/
?? .workspace/audit-020/final_table.py
?? .workspace/audit-020/import-probe-017/
?? .workspace/audit-020/import-probe/
?? .workspace/audit-020/jdiff.py
?? .workspace/audit-020/match.py
?? .workspace/audit-020/n10-probe/
?? .workspace/audit-020/packs/
?? .workspace/audit-020/peer-widen-backup/
?? .workspace/audit-020/pick.awk
?? .workspace/audit-020/pkg020/
?? .workspace/audit-020/pkgs/
?? .workspace/audit-020/planA-backup/
?? .workspace/audit-020/preset-fix-backup/
?? .workspace/audit-020/probe-v3/
?? .workspace/audit-020/recon.py
?? .workspace/audit-020/scan-desc.sh
?? .workspace/audit-020/src-011/
?? .workspace/audit-020/src-016a/
?? .workspace/audit-020/src-017/
?? .workspace/audit-020/src-020/
?? .workspace/audit-020/src/
?? .workspace/audit-020/t01-deep/
?? .workspace/audit-020/t04/
?? .workspace/audit-020/t10-notes/
?? .workspace/audit-020/t11/
?? .workspace/audit-020/t12/
?? .workspace/audit-020/t13-pkgs020/
?? .workspace/audit-020/t15/
?? .workspace/audit-020/t16/
?? .workspace/audit-020/t17/
?? .workspace/audit-020/t19/
?? .workspace/audit-020/t21/
?? .workspace/audit-020/t22/
?? .workspace/audit-020/t23/
?? .workspace/audit-020/t26/
?? .workspace/audit-020/t28/
?? .workspace/audit-020/taste-iconfix-backup/
?? .workspace/audit-020/tools/
?? .workspace/audit-020/verify-http/
?? .workspace/audit-020/we-probe/
?? .workspace/audit-020/x020/
?? .workspace/btw-question/.preimage-path
?? .workspace/btw-question/.preimage-path-D30
?? .workspace/btw-question/d30/2026-09-23T09-39-03-928Z-probe-1-drawer-open.png
?? .workspace/btw-question/d30/2026-09-23T09-39-03-928Z-probe-2-attempt1-no-card.png
?? .workspace/btw-question/d30/2026-09-23T09-39-03-928Z-probe-2-attempt2-no-card.png
?? .workspace/btw-question/d30/2026-09-23T09-39-03-928Z-probe-3-observe.png
?? .workspace/btw-question/d30/2026-09-23T09-39-03-928Z-probe-4-after-reopen.png
?? .workspace/btw-question/d30/2026-09-23T09-45-09-345Z-probe2-1-open.png
?? .workspace/btw-question/d30/2026-09-23T09-45-09-345Z-probe2-2-A-natural-multiselect.png
?? ".workspace/btw-question/d30/2026-09-23T09-47-16-326Z-probe3-B-detail-\345\237\213\347\202\271\345\245\221\347\272\246.png"
?? ".workspace/btw-question/d30/2026-09-23T09-47-16-326Z-probe3-C-\351\251\274\345\263\260-multiSelect.png"
?? .workspace/btw-question/d30/2026-09-23T09-50-56-764Z-probe4-1-baseline.png
?? .workspace/btw-question/d30/2026-09-23T09-50-56-764Z-probe4-2-frozen.png
?? .workspace/btw-question/d30/2026-09-23T09-50-56-764Z-probe4-3-after-reopen.png
?? .workspace/btw-question/d30/2026-09-23T09-50-56-764Z-probe4-4-after-stop.png
?? .workspace/btw-question/e2e-cover/fullpage-2026-09-23T10-40-17-467Z-FATAL.png
?? .workspace/btw-question/e2e-cover/fullpage-2026-09-23T10-40-44-836Z-T1-1-card-appeared.png
?? .workspace/btw-question/e2e-cover/fullpage-2026-09-23T10-40-44-836Z-T1-2-after-click-hold.png
?? .workspace/btw-question/e2e-cover/fullpage-2026-09-23T10-40-44-836Z-T1-3-after-submit.png
?? .workspace/btw-question/e2e-cover/fullpage-2026-09-23T10-40-44-836Z-T2-1-second-card-fresh.png
?? .workspace/btw-question/e2e-cover/fullpage-2026-09-23T10-40-44-836Z-T2-2-after-click-hold.png
?? .workspace/btw-question/e2e-cover/fullpage-2026-09-23T10-40-44-836Z-T3-1-bottom-sheet-640x800.png
?? .workspace/btw-question/e2e-cover/fullpage-2026-09-23T10-40-44-836Z-T3-2-after-click-hold.png
?? .workspace/btw-question/e2e-cover/fullpage-2026-09-23T10-40-44-836Z-T3-3-final.png
?? .workspace/btw-question/e2e-cover/fullpage-2026-09-23T10-40-44-836Z-T4-1-after-space-on.png
?? .workspace/btw-question/e2e-cover/fullpage-2026-09-23T10-40-44-836Z-T4-2-after-space-off.png
?? .workspace/btw-question/e2e-cover/fullpage-2026-09-23T10-40-44-836Z-T4-3-after-arrows.png
?? .workspace/btw-question/e2e-cover/fullpage-2026-09-23T10-44-10-837Z-T4b-A1-official-card.png
?? .workspace/btw-question/e2e-cover/fullpage-2026-09-23T10-44-10-837Z-T4b-A2-official-after-keys.png
?? .workspace/btw-question/e2e-cover/fullpage-2026-09-23T10-44-10-837Z-T4b-B1-btw-multi-card.png
?? .workspace/btw-question/e2e-cover/fullpage-2026-09-23T10-44-10-837Z-T4b-B2-btw-after-keys.png
?? .workspace/btw-question/e2e-cover/fullpage-2026-09-23T10-45-10-835Z-T3x-1440x900.png
?? .workspace/btw-question/e2e-cover/fullpage-2026-09-23T10-45-10-835Z-T3x-640x800-scrolled.png
?? .workspace/btw-question/e2e-cover/fullpage-2026-09-23T10-45-10-835Z-T3x-640x800.png
?? .workspace/btw-question/e2e-cover/fullpage-2026-09-23T10-49-34-289Z-T4e-1-after-enter.png
?? .workspace/btw-question/e2e-cover/fullpage-2026-09-23T10-49-34-289Z-T4e-2-after-shifttab.png
?? .workspace/btw-question/e2e/2026-09-23T03-20-58-748Z-before-error.png
?? .workspace/btw-question/e2e/2026-09-23T03-24-41-842Z-before-1-before-click.png
?? .workspace/btw-question/e2e/2026-09-23T03-24-41-842Z-before-2-after-click-200ms.png
?? .workspace/btw-question/e2e/2026-09-23T03-24-41-842Z-before-3-after-hold.png
?? .workspace/btw-question/e2e/2026-09-23T03-26-30-367Z-main-ref-1-official-card.png
?? .workspace/btw-question/e2e/2026-09-23T03-26-30-367Z-main-ref-2-official-selected.png
?? .workspace/btw-question/e2e/2026-09-23T03-39-41-934Z-after-1-before-click.png
?? .workspace/btw-question/e2e/2026-09-23T03-39-41-934Z-after-2-after-click-200ms.png
?? .workspace/btw-question/e2e/2026-09-23T03-39-41-934Z-after-3-after-hold.png
?? .workspace/btw-question/e2e/2026-09-23T03-40-20-357Z-after-dense-1-before-click.png
?? .workspace/btw-question/e2e/2026-09-23T03-40-20-357Z-after-dense-2-after-click-200ms.png
?? .workspace/btw-question/e2e/2026-09-23T03-40-20-357Z-after-dense-3-after-hold.png
?? .workspace/btw-question/e2e/2026-09-23T03-40-45-729Z-main-ref2-1-official-card.png
?? .workspace/btw-question/e2e/2026-09-23T03-40-45-729Z-main-ref2-2-official-selected.png
?? .workspace/btw-question/e2e/2026-09-23T04-02-20-233Z-after-1-before-click.png
?? .workspace/btw-question/e2e/2026-09-23T04-02-20-233Z-after-2-after-click-200ms.png
?? .workspace/btw-question/e2e/2026-09-23T04-02-20-233Z-after-3-after-hold.png
?? .workspace/btw-question/e2e/2026-09-23T04-02-36-077Z-main-ref3-1-official-card.png
?? .workspace/btw-question/e2e/2026-09-23T04-02-36-077Z-main-ref3-2-official-selected.png
?? .workspace/btw-question/e2e/2026-09-23T08-01-30-565Z-after-green-1-before-click.png
?? .workspace/btw-question/e2e/2026-09-23T08-01-30-565Z-after-green-2-after-click-200ms.png
?? .workspace/btw-question/e2e/2026-09-23T08-01-30-565Z-after-green-3-after-hold.png
?? .workspace/btw-question/e2e/2026-09-23T08-03-24-466Z-final-1-before-click.png
?? .workspace/btw-question/e2e/2026-09-23T08-03-24-466Z-final-2-after-click-200ms.png
?? .workspace/btw-question/e2e/2026-09-23T08-03-24-466Z-final-3-after-hold.png
?? .workspace/btw-question/e2e/skill-scope-dex.png
?? .workspace/btw-question/e2e/skill-scope-dsh.png
?? .workspace/btw-question/e2e/ws-probe-landing.png
?? .workspace/btw-question/e2e/ws-probe-menu.png
?? .workspace/dsh-020-pkg/
?? .workspace/dsh-020-pkgs/
?? .workspace/lag-fix/exec-a11y/evidence/
?? .workspace/lag-fix/exec-a11y/out/
?? .workspace/lag-fix/exec-a11y/patched/
?? .workspace/lag-fix/exec-a11y/patches/
?? .workspace/lag-fix/exec-a11y/pre-image/
?? .workspace/lag-fix/exec-a11y/probes/
?? .workspace/lag-fix/exec-a11y/report.template.md
?? .workspace/lag-fix/exec-a11y/scripts/
?? .workspace/lag-fix/exec-a11y/selftest-spec.json
?? .workspace/lag-fix/exec-a11y/selftest/
?? .workspace/lag-fix/exec-bashconc/apply-BashConc-v1.mjs
?? .workspace/lag-fix/exec-bashconc/bin/
?? .workspace/lag-fix/exec-bashconc/candidate/
?? .workspace/lag-fix/exec-bashconc/corpus/
?? .workspace/lag-fix/exec-bashconc/evidence/
?? .workspace/lag-fix/exec-bashconc/raw/
?? .workspace/lag-fix/exec-blurfix/.sandbox/
?? .workspace/lag-fix/exec-blurfix/apply-BlurFix-v1.mjs
?? .workspace/lag-fix/exec-blurfix/candidates/
?? .workspace/lag-fix/exec-blurfix/raw/
?? .workspace/lag-fix/exec-blurfix/shots/
?? .workspace/lag-fix/exec-blurfix/tools/
?? .workspace/lag-fix/exec-boot/MANIFEST.json
?? .workspace/lag-fix/exec-boot/candidates/
?? .workspace/lag-fix/exec-boot/evidence/
?? .workspace/lag-fix/exec-boot/probe/
?? .workspace/lag-fix/exec-boot/raw/
?? .workspace/lag-fix/exec-boot/scripts/
?? .workspace/lag-fix/exec-boot/uboot3/
?? .workspace/lag-fix/exec-boot2/MANIFEST.json
?? .workspace/lag-fix/exec-boot2/candidates/
?? .workspace/lag-fix/exec-boot2/evidence/
?? .workspace/lag-fix/exec-boot2/raw/
?? .workspace/lag-fix/exec-boot2/scripts/
?? .workspace/lag-fix/exec-btw-resize/baseline/
?? .workspace/lag-fix/exec-btw-resize/candidates/
?? .workspace/lag-fix/exec-btw-resize/dom-check/
?? .workspace/lag-fix/exec-btw-resize/phase1-shadow/
?? .workspace/lag-fix/exec-btw-resize/phase2/
?? .workspace/lag-fix/exec-btw-resize/raw/
?? .workspace/lag-fix/exec-btw-resize/scripts/
?? .workspace/lag-fix/exec-btw-resize/shots/
?? .workspace/lag-fix/exec-btwclose/STATUS.md
?? .workspace/lag-fix/exec-btwclose/btsrc-plain/
?? .workspace/lag-fix/exec-btwclose/btsrc/
?? .workspace/lag-fix/exec-btwclose/candidate/
?? .workspace/lag-fix/exec-btwclose/patches/
?? .workspace/lag-fix/exec-btwclose/probes/
?? .workspace/lag-fix/exec-btwclose/raw/
?? .workspace/lag-fix/exec-btwclose/shots/
?? .workspace/lag-fix/exec-btwclose/static/
?? .workspace/lag-fix/exec-btwclose/tools/
?? .workspace/lag-fix/exec-cold-batch/candidates/
?? .workspace/lag-fix/exec-cold-batch/deployed-manifest-v1.json
?? .workspace/lag-fix/exec-cold-batch/evidence/
?? .workspace/lag-fix/exec-cold-batch/out/
?? .workspace/lag-fix/exec-cold-batch/pre-image/
?? .workspace/lag-fix/exec-cold-batch/raw/
?? .workspace/lag-fix/exec-cold-batch/scripts/
?? .workspace/lag-fix/exec-cold-batch/stage/
?? .workspace/lag-fix/exec-cold-batch/subagent-verify/
?? .workspace/lag-fix/exec-countfix/apply-CountFix-v1.mjs
?? .workspace/lag-fix/exec-countfix/candidates/
?? .workspace/lag-fix/exec-countfix/mirror-b/
?? .workspace/lag-fix/exec-countfix/mirror-c/
?? .workspace/lag-fix/exec-countfix/mirror-neg4/
?? .workspace/lag-fix/exec-countfix/raw/
?? .workspace/lag-fix/exec-countfix/tools/
?? .workspace/lag-fix/exec-hmr/candidate/
?? .workspace/lag-fix/exec-hmr/dump-config.err
?? .workspace/lag-fix/exec-hmr/dump-config.txt
?? .workspace/lag-fix/exec-hmr/evidence/
?? .workspace/lag-fix/exec-hmr/index-3099-shadow.html
?? .workspace/lag-fix/exec-hmr/index-3099.html
?? .workspace/lag-fix/exec-hmr/iso-main.sh
?? .workspace/lag-fix/exec-hmr/isolated-home/
?? .workspace/lag-fix/exec-hmr/patch-hmr-timing.mjs
?? .workspace/lag-fix/exec-hmr/plan.md
?? .workspace/lag-fix/exec-hmr/probe-hmr.mjs
?? .workspace/lag-fix/exec-hmr/resolve-probe.mjs
?? .workspace/lag-fix/exec-hmr/run-arms.sh
?? .workspace/lag-fix/exec-hmr/shots/
?? .workspace/lag-fix/exec-hmr/tmp/
?? .workspace/lag-fix/exec-hostrpc/apply-HostRPC-v1.mjs
?? .workspace/lag-fix/exec-hostrpc/candidates-hr1only/
?? .workspace/lag-fix/exec-hostrpc/candidates/
?? .workspace/lag-fix/exec-hostrpc/patch-plan.json
?? .workspace/lag-fix/exec-hostrpc/pre-image/
?? .workspace/lag-fix/exec-hostrpc/raw/
?? .workspace/lag-fix/exec-hostrpc/scripts/
?? .workspace/lag-fix/exec-hostrpc/tmp/
?? .workspace/lag-fix/exec-keepalive/apply-KeepAlive-v1.mjs
?? .workspace/lag-fix/exec-keepalive/candidate/
?? .workspace/lag-fix/exec-keepalive/pre-image/
?? .workspace/lag-fix/exec-keepalive/raw/
?? .workspace/lag-fix/exec-keepalive/tools/
?? .workspace/lag-fix/exec-logdrift/drift/
?? .workspace/lag-fix/exec-logdrift/iso/
?? .workspace/lag-fix/exec-logdrift/raw/
?? .workspace/lag-fix/exec-logdrift/scripts/
?? .workspace/lag-fix/exec-logdrift/tmp/
?? .workspace/lag-fix/exec-mask/apply-Mask-v1.mjs
?? .workspace/lag-fix/exec-mask/logs/
?? .workspace/lag-fix/exec-mask/raw/
?? .workspace/lag-fix/exec-mask/shots/
?? .workspace/lag-fix/exec-mask/tools-mine/
?? .workspace/lag-fix/exec-masklook/apply-MaskLook-v1.mjs
?? .workspace/lag-fix/exec-masklook/candidate/
?? .workspace/lag-fix/exec-masklook/raw/
?? .workspace/lag-fix/exec-masklook/report-assets/
?? .workspace/lag-fix/exec-masklook/shots/
?? .workspace/lag-fix/exec-masklook/tools/
?? .workspace/lag-fix/exec-proj/candidate/
?? .workspace/lag-fix/exec-proj/out/
?? .workspace/lag-fix/exec-proj/raw/
?? .workspace/lag-fix/exec-proj/scripts/
?? .workspace/lag-fix/exec-projcache/apply-ProjCache-v1.mjs
?? .workspace/lag-fix/exec-projcache/candidates/
?? .workspace/lag-fix/exec-projcache/media/
?? .workspace/lag-fix/exec-projcache/mirror/
?? .workspace/lag-fix/exec-projcache/raw/
?? .workspace/lag-fix/exec-projcache/tools/
?? .workspace/lag-fix/exec-shellfix/candidates/
?? .workspace/lag-fix/exec-shellfix/evidence/
?? .workspace/lag-fix/exec-shellfix/raw/
?? .workspace/lag-fix/exec-shellfix/tools/
?? .workspace/lag-fix/exec-usage9/apply-Usage9-v1.mjs
?? .workspace/lag-fix/exec-usage9/backup/
?? .workspace/lag-fix/exec-usage9/candidate/
?? .workspace/lag-fix/exec-usage9/harness/
?? .workspace/lag-fix/exec-usage9/probe/
?? .workspace/lag-fix/exec-usage9/raw/
?? .workspace/lag-fix/exec-usage9/verify-static.mjs
?? .workspace/lag-fix/exec-virtual/apply-Virtual-v1.mjs
?? .workspace/lag-fix/exec-virtual/candidate/
?? .workspace/lag-fix/exec-virtual/pre-image/
?? .workspace/lag-fix/exec-virtual/raw/
?? .workspace/lag-fix/exec-virtual/shots/
?? .workspace/lag-fix/exec-virtual/tools/
?? .workspace/lag-fix/hmr-probe-backup/
?? .workspace/lag-fix/incident2/firefox-a11y/logs/dpr2-pid.txt
?? .workspace/lag-fix/incident2/firefox-a11y/logs/final.out
?? .workspace/lag-fix/incident2/firefox-a11y/logs/list-pid.txt
?? .workspace/lag-fix/incident2/firefox-a11y/logs/listmut-pid.txt
?? .workspace/lag-fix/incident2/firefox-a11y/logs/real-pid.txt
?? .workspace/lag-fix/incident2/firefox-a11y/logs/run-list-final.sh
?? .workspace/lag-fix/incident2/firefox-a11y/longtask-control.mjs
?? .workspace/lag-fix/incident2/firefox-a11y/page/list-299.html
?? .workspace/lag-fix/incident2/firefox-a11y/page/longtask-control.html
?? .workspace/lag-fix/incident2/firefox-a11y/raw/dpr2-live-summary.json
?? .workspace/lag-fix/incident2/firefox-a11y/raw/final-live-summary.json
?? .workspace/lag-fix/incident2/firefox-a11y/raw/final-scroll-summary.json
?? .workspace/lag-fix/incident2/firefox-a11y/raw/list299-summary.json
?? .workspace/lag-fix/incident2/firefox-a11y/raw/list299mut-summary.json
?? .workspace/lag-fix/incident2/firefox-a11y/raw/longtask-control.json
?? .workspace/lag-fix/incident2/firefox-a11y/raw/real-a11y-OFF-r1.json
?? .workspace/lag-fix/incident2/firefox-a11y/raw/real-a11y-OFF-r2.json
?? .workspace/lag-fix/incident2/firefox-a11y/raw/real-a11y-OFF-r3.json
?? .workspace/lag-fix/incident2/firefox-a11y/raw/real-a11y-ON-r1.json
?? .workspace/lag-fix/incident2/firefox-a11y/raw/real-a11y-ON-r2.json
?? .workspace/lag-fix/incident2/firefox-a11y/raw/real-a11y-ON-r3.json
?? .workspace/lag-fix/incident2/firefox-a11y/raw/real-summary.json
?? .workspace/lag-fix/incident2/firefox-a11y/raw/realsmoke-summary.json
?? .workspace/lag-fix/incident2/firefox-a11y/realpage-a11y.mjs
?? .workspace/lag-fix/incident2/glean-ab/dist-A-120055.txt
?? .workspace/lag-fix/incident2/glean-ab/dist-B-143637.txt
?? .workspace/lag-fix/incident2/glean-ab/snap/B-143637.bin
?? .workspace/lag-fix/incident2/instrument-tiebreak/analyze.mjs
?? .workspace/lag-fix/incident2/instrument-tiebreak/audit.md
?? .workspace/lag-fix/incident2/instrument-tiebreak/logs/
?? .workspace/lag-fix/incident2/instrument-tiebreak/prior-methods.md
?? .workspace/lag-fix/incident2/instrument-tiebreak/raw/analysis.json
?? .workspace/lag-fix/incident2/instrument-tiebreak/raw/chrome153.json
?? .workspace/lag-fix/incident2/instrument-tiebreak/raw/dryrun1.json
?? .workspace/lag-fix/incident2/instrument-tiebreak/raw/recon2.json
?? .workspace/lag-fix/incident2/instrument-tiebreak/runners/chain.sh
?? .workspace/lag-fix/incident2/instrument-tiebreak/runners/gecko.mjs
?? .workspace/lag-fix/incident2/instrument-tiebreak/runners/recon2.mjs
?? .workspace/lag-fix/incident2/instrument-tiebreak/verify-independent.md
?? .workspace/lag-fix/program/w01-client-render/raw/
?? .workspace/lag-fix/program/w01-client-render/static-coupling.md
?? .workspace/lag-fix/program/w01-client-render/tools/
?? .workspace/lag-fix/program/w02-host-rpc/raw/
?? .workspace/lag-fix/program/w02-host-rpc/sa-evb/
?? .workspace/lag-fix/program/w02-host-rpc/sb-projcache/
?? .workspace/lag-fix/program/w02-host-rpc/scripts/
?? .workspace/lag-fix/program/w03-persistence/raw/
?? .workspace/lag-fix/program/w03-persistence/sa1-scan/
?? .workspace/lag-fix/program/w03-persistence/sa2-projcache/
?? .workspace/lag-fix/program/w04-plugin-load/raw/
?? .workspace/lag-fix/program/w04-plugin-load/sub-a/
?? .workspace/lag-fix/program/w04-plugin-load/sub-b/
?? .workspace/lag-fix/program/w04-plugin-load/tools/
?? .workspace/lag-fix/program/w05-usage-ingest/raw/
?? .workspace/lag-fix/program/w05-usage-ingest/sub-a-rpc-resend.md
?? .workspace/lag-fix/program/w05-usage-ingest/sub-b-correctness.md
?? .workspace/lag-fix/program/w05-usage-ingest/w05-g1-live.mjs
?? .workspace/lag-fix/program/w05-usage-ingest/w05-hb-child.mjs
?? .workspace/lag-fix/program/w05-usage-ingest/w05-rpc-dist.mjs
?? .workspace/lag-fix/program/w05-usage-ingest/w05-rpc-dist2.mjs
?? .workspace/lag-fix/program/w05-usage-ingest/w05-sessions-cost.mjs
?? .workspace/lag-fix/program/w06-subagent/raw/
?? .workspace/lag-fix/program/w06-subagent/subagent-A-report.md
?? .workspace/lag-fix/program/w06-subagent/subagent-B-report.md
?? .workspace/lag-fix/program/w07-streaming/raw/
?? .workspace/lag-fix/program/w07-streaming/tools/
?? .workspace/lag-fix/program/w08-boot/evidence/
?? .workspace/lag-fix/program/w08-boot/raw/
?? .workspace/lag-fix/program/w08-boot/scripts/
?? .workspace/lag-fix/program/w09-btw-load/out/
?? .workspace/lag-fix/program/w09-btw-load/probes/
?? .workspace/lag-fix/program/w09-btw-load/raw/
?? .workspace/lag-fix/program/w09-btw-load/shots/
?? .workspace/lag-fix/program/w09-btw-load/verify/
?? .workspace/lag-fix/program/w10-btw-resize/evidence/
?? .workspace/lag-fix/program/w11-mask-look/audit-static.md
?? .workspace/lag-fix/program/w11-mask-look/raw/
?? .workspace/lag-fix/program/w11-mask-look/shots/
?? .workspace/lag-fix/program/w11-mask-look/tools/
?? .workspace/lag-fix/program/w12-input-ux/out/
?? .workspace/lag-fix/program/w12-input-ux/raw/
?? .workspace/lag-fix/program/w12-input-ux/tools/
?? .workspace/lag-fix/program/w13-feedback/evidence/
?? .workspace/lag-fix/program/w14-residual-env/logs/
?? .workspace/lag-fix/program/w14-residual-env/out/
?? .workspace/lag-fix/program/w14-residual-env/probes/
?? .workspace/lag-fix/program/w14-residual-env/recipes/
?? .workspace/lag-fix/program/w14-residual-env/research/
?? .workspace/lag-fix/program/w14-residual-env/scripts/
?? .workspace/lag-fix/program/w15-sessionlist/
?? .workspace/lag-fix/program/w16-llm/raw/
?? .workspace/lag-fix/program/w17-tools/raw/
?? .workspace/lag-fix/program/w18-projection/raw/
?? .workspace/lag-fix/program/w18-projection/scripts/
?? .workspace/lag-fix/program/w18-projection/tools/
?? .workspace/lag-fix/program/w19-slots/raw/
?? .workspace/lag-fix/program/w19-slots/tools/
?? .workspace/lag-fix/program/w20-cordis/branch-B/
?? .workspace/lag-fix/program/w20-cordis/raw/
?? .workspace/lag-fix/program/w21-storage/raw/
?? .workspace/lag-fix/program/w21-storage/tools/
?? .workspace/lag-fix/program/w22-serve/evidence/
?? .workspace/lag-fix/program/w22-serve/raw/
?? .workspace/lag-fix/program/w22-serve/scripts/
?? .workspace/lag-fix/program/w23-nav/out/
?? .workspace/lag-fix/program/w23-nav/raw/
?? .workspace/lag-fix/program/w23-nav/static/
?? .workspace/lag-fix/program/w23-nav/tools/
?? .workspace/lag-fix/program/w24-shell/evidence/
?? .workspace/lag-fix/program/w24-shell/raw/
?? .workspace/lag-fix/program/w24-shell/section-02-handles-static.md
?? .workspace/lag-fix/program/w24-shell/section-04-focus-zindex.md
?? .workspace/lag-fix/program/w24-shell/tools/
?? .workspace/lag-fix/program/w25-conversation/out/
?? .workspace/lag-fix/program/w25-conversation/raw/
?? .workspace/lag-fix/program/w25-conversation/tools/
?? .workspace/lag-fix/program/w26-integrity/raw/
?? .workspace/lag-fix/program/w26-integrity/sa1-projcache/
?? .workspace/lag-fix/program/w26-integrity/sa2-usage-storages/
?? .workspace/lag-fix/program/w26-integrity/scripts/
?? .workspace/lag-fix/program/w27-scale150/out/
?? .workspace/lag-fix/program/w27-scale150/probes/
?? .workspace/lag-fix/program/w27-scale150/raw/
?? .workspace/lag-fix/program/w27-scale150/routeB-4090.md
?? .workspace/lag-fix/program/w27-scale150/routeC-wayland.md
?? .workspace/lag-fix/program/w27-scale150/scripts/
?? .workspace/lag-fix/program/w28-btw-close/probes/
?? .workspace/lag-fix/program/w28-btw-close/raw/
?? .workspace/lag-fix/program/w28-btw-close/shots/
?? .workspace/lag-fix/program/w28-btw-close/static-close-path.md
?? .workspace/lag-fix/program/w28-btw-close/static-host-close.md
?? .workspace/lag-fix/program/w28-btw-close/tools/
?? .workspace/lag-fix/program/w29-blur-survey/raw/
?? .workspace/lag-fix/program/w29-blur-survey/shots/
?? .workspace/lag-fix/program/w29-blur-survey/tools/
?? distributions-skipped.json
?? distributions.json
?? docs/architecture/office-handoff.md
?? dsh-btw/.workbuddy-btw-exec-report.md
?? dsh-btw/lib/remote-DkypAFlI.d.ts
?? dsh-btw/lib/remote-bQu4rpiV.js
?? dsh-btw/lib/remote-descriptors-BNvafF-2.js
?? office-upgrade_NEXT_SESSION_PROMPT.md
?? reports/
?? research/
?? workbuddy-reverse-proxy/
```

## B. 详细过程与时间线（2026-09-30 接手轮）

- **接手与核对**：读 `dsh-020_NEXT_SESSION_PROMPT.md`（10:40 版）→ 实跑核对 3080/3097/3098 均在监听、`assembly-020/boot-web.sh` 存在。
- **两个插件修复**：源码定位 `.volatile()` 契约（`dsh-settings:418-419/505-507`）→ 改两插件 → 白盒单测 →
  drill（端口 3099，`drill-home` 私有 profile）真启动实证 served 25 → 27；并放宽 peer。
- **技能迁移**：发现 `assembly-020/home/skills/` **不存在** → 复制 4 技能 + `wallpapers/` + `taste/` + `AGENTS.md`；
  技能目录**当场**由 2 条变 5 条；独立复核 4/4 加载。
- **P0-A 全流程**：全量只读预检（2508 份 2.47 M 行）→ 基线 9.13% → 写转换器 →
  **发现并修掉单帧缺陷**（物理布局闸门）→ 100% → 落盘（sha256 全等）→ drill 端到端（`listArtifacts` 2521 / read-open 40/40）。
- **8 个执行档并行**：WP1 转换语料独立验证、WP2 落盘、WP3 插件复核、WP4 技能复核、WP5 Route B、WP6 remoteHosts、WP7 文档、WP8 N17 勘误。
  其中 **WP1 查出我的转换器单帧缺陷**（高危，已修并加闸门）。
- **用户点名第三项**：Open in App 无响应 → 读启动链源码闭环因果 → 改 `boot-web.sh`（保留 `env -i`，白名单转发）→ 干跑 + 向子进程注入探针实证。
- **推送**：范围经用户确认（A+B）→ `.gitignore` 加固 → 显式路径暂存 135 文件 19.6 MB → 提交 `66ef701c` → `git push`（`AdamDream` 身份，密钥在真实 `HOME`，用 `GIT_SSH_COMMAND` 指路）。

## C. 未核实项清单

1. **运行中宿主 3098 的 `environ` 未读**：工具跑在 `bwrap --unshare-pid --tmpfs /tmp` 里，
   既看不到宿主进程 `/proc`，`/tmp/.X11-unix` 也被 tmpfs 遮蔽 ⇒ 「实例由 `boot-web.sh` 启动」仍是**强间接证据**（但对修复不构成阻碍）。
2. **我的工具环境不可当宿主环境证据**（含 harness 注入的 `DSH_*` / `NO_COLOR` / `VIPSHOME`）——该口径已作为死路记入 §6。
3. **Open in App 的真实窗口**未验收；用户点击时的 HTTP 状态码仍为源码推导（未抓包）。
4. **切换时点**未定；`/home/CNS2026495165/.dsh/sessions` 的静止窗口未确认。
5. **Route B 的 5 个裁决点、remoteHosts 的方案取舍**均待用户。
6. **`XDG_CONFIG_HOME` 默认不转发**对 VS Code 实例/配置复用的实际影响未实测。
7. **DBUS 打通后 GNOME Terminal 是否仍继承隔离 HOME** 未验证（用户报告自陈的隔离风险）。
8. **v4 后继的实际落盘与发布后读回**未验证（WP1 只到全链解码）
9. **隔离根不在版本控制内（重要）**：`.workspace/audit-020/assembly-020/` 被 `.gitignore:109` 整体忽略，因此**本轮所有落在该树内的修复都不在仓库里** —— 两个插件的 `.volatile()` 改动、6 个插件的 peer 放宽、profile patch 的三段 settings 投放、`boot-web.sh` 的桌面变量转发。仓库侧只带**改前原件 + diff + 报告**：`.workspace/audit-020/volatile-fix-backup/`、`.workspace/audit-020/peer-widen-backup/`、`.workspace/audit-020/openinapp-fix-backup/`、`.workspace/audit-020/openinapp-fix.diff`。接手方若在新机器重建隔离根，须按这些证据重放。
