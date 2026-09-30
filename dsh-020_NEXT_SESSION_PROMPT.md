---
generated_at: "2026-09-30 10:40:07"
prefix: "dsh-020"
cwd: "/home/CNS2026495165/dsh"
repo_root: "/home/CNS2026495165/dsh"
git_head: "651b1712"
git_branch: "main"
goal:
  objective: "DSH 0.2.0-rc.2 迁移：阶段一（审计+可运行组合+文档）已完成；阶段二为「把 3080 的 2507 份历史会话迁移到 0.2.0」+ 剩余功能补齐"
  id: "goal-a8d4c364-8e85-4c26-8004-acc4f872ad85"
  revision: 3
other_units:
  - prefix: "handoff-skill"
    path: "handoff-skill_NEXT_SESSION_PROMPT.md"
    generated_at: "2026-09-25 12:01:47"
    one_line_status: "session-handoff 技能自身的交接件（已交付并入库），与 0.2.0 迁移主线无关"
  - prefix: "office-upgrade"
    path: "office-upgrade_NEXT_SESSION_PROMPT.md"
    generated_at: "2026-09-29 16:36:30"
    one_line_status: "上一轮的 0.1.7 迁移交接件；本会话已把它改锚到 0.2.0，其 §2 三项任务已被本件取代"
archive:
  dir: ".dsh/handoffs"
  retained: "2"
---

> **勘误回写块（接手方实测后追加，原文不删不改）**
>
> **2026-09-30 10:40（本次生成）** —— 本件取代 `office-upgrade_NEXT_SESSION_PROMPT.md` 成为 0.2.0 迁移主线；后者保留为历史（其 §2 的 P0-A/P0-B/P0-C 已全部由本会话处理或取代）。接手方**无需**再读那份的 §2。

## §0 你的第一件事
1. 先加载 `session-handoff` 的**接手模式**，再读本件全文；按它先实跑核对、再复述、过闸门后才动手。
2. 必读（按序）：本件 → `.workspace/audit-020/reports/DELIVERY-020-FINAL.md`（当前交付状态）→ `MIGRATION-RC2-DONE.md`（rc.2 迁移与验收）→ `DECISIONS-BEFORE-CUTOVER.md`（**25 条裁决，不得重开**）→ `MIGRATION-ASSESSMENT.md`（N1–N17 全部门禁）。
3. 不得重开：D1–D25 全部裁决（见 §4）；3080/3097 不得停改；不得动 `~/.dsh/**` 与 `~/.dsh-017/**`。
4. 第一动作（只读）：`cd /home/CNS2026495165/dsh && ss -ltn | grep -E ':(3080|3097|3098) '`、`sha256sum ~/.dsh/profiles/web/cordis.patch.yml ~/.dsh/settings.yaml`、确认 `.workspace/audit-020/assembly-020/boot-web.sh` 存在。

## §1 客观事实基线
| 事项 | 已核实事实（含证据） |
|---|---|
| 仓库 / HEAD | `[已核实]` `/home/CNS2026495165/dsh`、`main`、HEAD `651b17124a76581f00f1e73ca3d152d21ccba47f`（`git rev-parse`） |
| 目标版本 | `[已核实]` **`@deepseek-ai/dsh@0.2.0-rc.2`**（npm `latest`+`next`，2026-09-29T09:56Z）；隔离组合已装并跑通 |
| 现役 / 隔离 | `[已核实]` `3080`=0.1.1-rc.2、`3097`=0.1.7-rc.2 **均在监听且全程未动**；`3098`=0.2.0-rc.2 实例（本会话新起） |
| 活值（每轮重取） | `[已核实]` 现役 patch `513413e7…`、现役 settings `0f19b0fe…`（采样 2026-09-30 10:40）。**活值，不得写入** |
| 隔离根 | `[已核实]` `.workspace/audit-020/assembly-020/`：`prefix-cli-rc2/`（rc.2 CLI，541 包/518M）、`home/`（伪装 DSH_HOME）、`boot-web.sh` |
| 组合规模 | `[已核实]` `--dump-config` **rc=0 / 200 条目**；peer 闸门禁用 **0**；未激活插件 **0**；客户端插件无 pending |
| 插件 | `[已核实]` 13/13 宿主半 import 成功；两处客户端半已迁到 `configForms`（`adaptSettingsScope`） |
| WE 版本 | `[已核实]` `dsh-workspace-enhancement@0.2.2`（含 P1 补丁回流 + 13 条 peer 放宽 + ssh2 链接） |
| N2 补丁 | `[已核实]` rc.2 的 `dsh-tool-subagent/lib/index.js` 691 行（官方 662），读 `subagent-model` 条目实时值 |
| 历史语料（迁移对象） | `[已核实]` `~/.dsh/sessions` = **2507 份 `.zstd` 日志 / 21 工作区 / 1.2 GB**；`~/.dsh/attachments` = **995 对象 / 205 MB** |
| 本件自身 | `[已核实]` 本次自生成，非待处理脏改动；`git status --short` 共 **397 行**（含本件自身 1 项） |

## §2 最高优先级任务清单

**P0-A 把 3080 的 2507 份历史会话迁移到 0.2.0（用户 2026-09-30 明确裁决「尝试把历史全部迁到 0.2.0」）**
- 前置闸门：先做**全量只读预检**（按帧解码统计每份日志的拒因分布）；确认 `zstd` CLI、0.1.1 的 `decodeStorageRecord`、0.2.0 的 `expandAssistantStream` 三者可用（**已实测均可用**）。
- 已知两道硬闸：**① `subagent/descriptor` version 2**（2 229 份命中；改 3 即可，v2 成员集是 v3 子集）；**② 顶层打包行** `text-chunks`/`reasoning-chunks`/`tool-call-chunks`（需展开成 `assistant/chunk` 事件）。
- 判定标准：转换后在 0.2.0 侧**逐份真实打开**；对每份给出「消息投影哈希相等 + 地标计数不变 + 头部不变量成立」三项证据。
- 失败处置：**必须先备份再改**；在**语料副本**上做，不得原地改 `~/.dsh/sessions`。

**P0-B 必要 settings 段投放（D14 的 9 段）**
- 现状：新根只有 `settings.yaml.import-source`（252 行，刻意未投放），新实例跑的是 profile patch 的 config。
- 判定标准：`settings.yaml` 投放后重启，逐段核对生效；**投放次序不可反**（机制是「读一次即改名 `.imported`」，必须先备好 profile patch）。

**P0-C 办公入口 Route B**
- 已查明**官方已有现成件** `@deepseek-ai/dsh-webhook`（内置动作入参 `{workspacePath,title,prompt,agentPreset,permissionPreset,model?}`），配套 `dsh-webhook-github` 给出「非 `/api` 精确路由」范式（绕开 cookie 门）。
- 判定标准：右键投递一个文件 → 在 0.2.0 侧真的出现工作区/会话；且自建鉴权 + 目录/扩展名白名单到位。

**P1 `remoteHosts` 回归修复**（用户裁决：用右栏停靠面 `dsh-client-ui-sidebar-right` 重新实现）
**P2 文档收口**：把本会话 47 份报告索引进 `docs/program-notebook.md` 与 `docs/architecture/`。

## §3 本会话已完成的工作
1. 把迁移目标从 0.1.7-rc.2 **改锚到 0.2.0**，并随上游推进到 **rc.2**；32 轨道审计 + 47 份报告（`.workspace/audit-020/reports/`）。
2. **规划 B**：WE 升 0.2.2（3 处补丁回流 + peer 放宽 + ssh2），SSH 族全部激活（见 `reports/PLAN-B-DONE.md`）。
3. **规划 A**：3 个 settings 断层插件全部修复 + N2 宿主补丁重打（见 `reports/PLAN-A-DONE.md`）；两处客户端半迁到 `configForms`。
4. **实测跑通**：0.2.0-rc.2 实例 HTTP 200 / 37KB 真 UI；GUI 内对话成功（「你好」→ 回复，6 秒）；`peer 禁用 0 / 未激活 0 / 客户端 pending 无`。
5. 交付 `RUNBOOK-020.md`（695 行）、`MIGRATION-ASSESSMENT.md`（783 行 / N1–N17）、`STAGE2-WORK-ORDER.md`（838 行）、`CUTOVER-PLAN-dual-instance.md`（899 行）等。

## §4 已裁决与权威四层
以下 25 条为 2026-09-29/30 grill-me 六轮逐条裁决，**大多只存在于对话**，故标 `[仅对话原文·未落盘]`（已于 `reports/DECISIONS-BEFORE-CUTOVER.md` 落盘）：

- `[已核实·落盘]` **D1** 迁移路径：原选 (c) 双实例；**2026-09-30 用户改为「尝试把历史全部迁到 0.2.0」**（原句：「尝试把历史全部迁到 0.2.0」）——**这是最新裁决，覆盖 D1 原值**。
- `[已核实·落盘]` **D2** 遥测 `DSH_TELEMETRY_MODE=DISABLED`；**D3** 凭据搬入让新实例可用。
- `[已核实·落盘]` **D7** WE 补丁先回流再升版；**D11** peer 改写为 `^0.1.5-rc.1 || ^0.2.0-rc.1`；**D12** 现役与新根同时更新；**D13** 沿用现役 `package.json` 依赖改动。
- `[已核实·落盘]` **D8** N2 重打宿主补丁 + 从 profile patch 读值；**D9** 模型值统一 `deepseek-v4-pro`；**D10** preset 基底改官方 `standard`。
- `[已核实·落盘]` **D14** 必要 settings 段 = ui-theme / agent-default-model / 子代理路由 / wallpaper / llm-pi-ai / web-search-deepseek / vision-adam / dsh-ssh-gui / dsh-workerspace。
- `[已核实·落盘]` **D16** 三个 settings 插件都修；**D17** 办公入口走 Route B；**D18** remoteHosts 用右栏停靠面重实现；**D19** taste 中文存储+中文展示（只清理残留英文侧车）。
- `[已核实·落盘]` **D20** 先修存量再开新特性；**D22** (b2) 报官方 issue 等存量修复完再写；**D23** btw 下一轮修；**D24** 不追 0.1.7/0.1.8 中间版本。
- `[已核实·落盘]` **D4** 3097 由用户手动择时退役；**D5** 本轮插件范围；**D6** 文档合并以 `RUNBOOK-020.md` 为主干；**D21** `n17-evidence/` 保留到切换完成。
- `[仅对话原文·未落盘]` **本轮新增**：前缀 `dsh-020`；提交范围「文档+报告+交接件入仓、运行产物不入」；历史迁移方式「全部迁到 0.2.0」。
- 权威顺序：用户明确裁决 > 隔离安全边界 > 已授权具体范围 > 未授权不扩展 > 已否决不得复活。

## §5 待办与开放项
- **需你裁决**：① 历史迁移若因打包行/descriptor 无法 100% 通过，**接受的最低比例**是多少；② 是否允许**原地转换** `~/.dsh/sessions`（当前授权仅限副本）；③ 3080 在历史迁完后是否退役。
- 待办：P0-A / P0-B / P0-C 三项（§2）；P1 remoteHosts；P2 文档收口。
- **未闭门禁（不得包装为通过）**：
  - **N17**：0.2.0 读不了 0.1.1 的历史会话。实测抽样 **3% 可读**；修 descriptor 后 **60%**；余 40% 卡在三种打包行。**根因已查清**：packing 实现从 `dsh-session` 顶层行迁到 `dsh-llm` 的 `event.data.stream`，且旧位置解码器被移除。
  - **N1**：`installSettingsSection`/`settingsNamespace` 断层（**0.1.7 就已删除**，非 0.2.0 引入）——三插件已修，但同类风险需在每轮升级复查。
  - **N10**：`dsh-workspace-enhancement` 的 provider 契约返工（原报 22 条不兼容）——**升 0.2.2 后已大幅缓解，但未逐条复验**。
  - **N16**：btw 的 26 条契约不兼容（T30 结论基于**工作区源码**，部署件实测残留为 0，**须以部署件为准复核**）。
  - GUI 层仅做了「对话成功」这一条实证；设置页表单、识图工具调用、btw 侧聊面板、SSH 远端子功能**均未逐一验证**。

## §9 一句话开启方式
接手 `dsh-020_NEXT_SESSION_PROMPT.md`：先按接手模式实跑核对（3080/3097 仍在、指纹未变、`assembly-020/boot-web.sh` 存在），然后**在语料副本上做 P0-A（把 2507 份历史会话转换到 0.2.0）**——两道硬闸与转换工具都已定位（`descriptor v2→3` + 三种打包行展开），**不得原地改 `~/.dsh/sessions`**。

---

# 不编号附录

## A. 详细过程与时间线（2026-09-29 → 2026-09-30）
- 09-29 上午：接手 `office-upgrade_NEXT_SESSION_PROMPT.md`（其目标为 0.1.7）；用户改锚到 0.2.0。
- 09-29 下午：32 轨道并行审计；发现「CLI `lib/**` 三版逐字节相同」「225/280 包 `lib/` 零改动」「0.2.0 peer 闸门会静默禁用本地插件」。
- 09-29 晚：grill-me 六轮 → 25 条裁决；规划 B（WE 0.2.2 + 补丁回流 + peer 放宽）与规划 A（3 插件 + N2 补丁）落地。
- 09-30 上午：上游发布 **0.2.0-rc.2** → 迁移到 rc.2（独立前缀、重打补丁、农场切 rc.2、豁免升版）。
- 09-30 上午：**GUI 实测**暴露两个客户端插件 pending（`settingsScope` 已删）→ 修复 inject + 迁到 `configForms`；用户实测对话成功。

## B. `git status --short` 口径
本次实测 **397 行**（含本件自身 1 项）：已跟踪改动 **32**、未跟踪 **365**。绝大多数为**前序会话遗留**与 `.workspace/` 下的审计证据。复跑：`git status --short`。**本会话未提交、未 reset、未 clean。**

## C. 未核实项清单
1. 历史会话转换的**全量成功率**：未做全量预检（只抽样 200 + 120 份）。
2. 打包行展开后与 0.2.0 期望的 `assistant/chunk` 事件**是否逐字段等价**：`expandAssistantStream` 已读实现，但**未对真实数据做转换后回读验证**。
3. GUI 层：设置页表单是否真的可编辑保存、识图工具是否可调用、btw 侧聊面板是否可用、SSH 远端子功能是否工作 —— **均未验证**。
4. `remoteHosts` 在 0.2.0 的替代落点（`dsh-client-ui-sidebar-right`）**未勘察**。
5. WE 0.2.2 与 ssh-gui 的 `/dsw` 通道兼容性 —— ssh-gui 能加载，但**远端子功能未实测**。
6. `settings.yaml` 的 9 个必要段投放后行为 —— **未执行**。
7. 提交范围中「文档+报告」的确切文件清单 —— 用户选了方向，**具体清单未逐条确认**。
