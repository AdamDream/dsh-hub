# dsh-020 接手轮 · 协调者总结（2026-09-30）

- 状态：**已完成可交付部分；一项待用户执行（重启 3098）；一项在执行档收尾中（WP1）**
- 本件由协调者（主 agent）写；各执行档的完整报告见 §5 索引
- 本轮所有改动都在 `.workspace/audit-020/assembly-020/**` 内，**源根 `~/.dsh/**` 与 `~/.dsh-017/**` 全程只读**

---

## 1. 用户点名的三件事：结论

### ① 两个「模型路由插件」不可用 —— **已修复，待重启生效**

| | 结论 |
|---|---|
| 真因 | 0.2.0 的设置面**只暴露 `.volatile()` 字段**；两个插件的 `Config` 一个 volatile 字段都没有 ⇒ `describe()` **整条跳过**，客户端快照落到 `status:"unavailable"`，于是显示「设置命名空间未注册」 |
| 依据 | `$B/dsh-settings/README.md:12,33`、`$B/dsh-settings/lib/index.js:418-419`、`:505-507`、`$B/dsh-client-ui-settings/lib/client.js:1226-1233` |
| 改动 | `@local/dsh-subagent-model`：`provider`/`model` 加 `.volatile()`；`@deepseek-ai/dsh-vision-adam`：`apiKeyEnv`/`baseURL`/`model`/`maxTokens` 加 `.volatile()`；两处 `apply()`/`current()` 增加 cosmokit volatile 引用解包 |
| 顺带加固 | 两个插件的 `peerDependencies` 按 D11 同形放宽为 `^0.1.0-rc.7 \|\| ^0.2.0-rc.1` ⇒ **不再依赖 `compatibility.json` 的人工豁免**（实跑验证：删掉该文件后两者仍加载） |
| 实跑证据 | 隔离 drill（端口 3099）真启动 0.2.0-rc.2，进程内探针直读 `settings.describe()`：`subagent-model` 与 `vision-adam` 均 `applies=live`，value 见下；`disabling profile plugin row` **0**、`failed to import` **0** |
| 一锤定音的数字 | 现役 3098 实抓 `/api/settings/describe` = **25** 条；修后 drill = **27** 条 = 25 + **恰好这 2 条** |

```
subagent-model  value={"provider":"adam","model":"deepseek-v4-pro"}
vision-adam     value={"apiKeyEnv":"ADAM_API_KEY","baseURL":"https://llmapi.roboscience.xyz/v1","model":"gpt-6-astra","maxTokens":393216}
```

> 第二行同时证明 **P0-B 的 settings 投放已生效**——用的是现役 `settings.yaml` 的原值，
> 不是插件默认的 opencode 网关。**改动需要重启宿主**（宿主半是 ESM 模块，内存里仍是旧件；
> `hmr root: []` 不重载）。重启与验收命令见 `reports/RESTART-AND-VERIFY-RUNBOOK.md`。

### ② 「很多 skill 没有成功迁移」 —— **已修复，且当场生效（无需重启）**

| 事项 | 结论 |
|---|---|
| 真因 | `$A/home/skills/` **此前根本不存在**。0.2.0 的用户级技能根是 `$DSH_HOME/skills`（`$B/dsh-skill-filesystem/lib/index.js:172`） |
| 改动 | 复制 `~/.dsh/skills/{grill-me,ppt-master,program-notebook,session-handoff}`；并补 `$A/home/wallpapers/`（壁纸本体）、`$A/home/taste/`、**`$A/home/AGENTS.md`** |
| 实跑证据 | 本轮会话技能目录**当场**由 2 条变 5 条（`ppt-master` / `ppt-template-fidelity` / `program-notebook` / `session-handoff` / `workbuddy-ppt`）。`grill-me` 因 `disable-model-invocation: true` 不进模型目录，属预期。`AGENTS.md` 就位后本会话的工作区指令来源已切到 `$DSH_HOME/AGENTS.md` |
| 独立复核 | WP4：真实 `FileSystemSkillProvider` **4/4 加载、警告 0**；三棵树 sha256 一致 |
| 反例澄清 | `ppt-design-systems` **不是迁移丢失**：它只在 `pptDesignSystemRoot`/`DSH_PPT_DESIGN_SYSTEM_ROOT` 非空时注册（`@local/dsh-pptmaster/lib/index.js:82013-82014`），而全树该变量**只有读取方、没有写入方**，`~/.dsh-017/office-ppt` 实测 0 条目 ⇒ **从未启用** |
| 协调者裁决（纠正 WP4） | WP4 说「静态推演应为 6」是把 `grill-me` 算进了模型目录；`grill-me` 是 userInvocable-only，**5 才是正确值**，与实测一致 |

### ③ 会话迁移（P0-A）—— **转换完成并已落盘，100% 可读**

见 §2。

---

## 2. P0-A：2508 份历史会话迁移

### 2.1 修正后的 N17 因果链（**交接件原叙述被证伪**）

交接件 §5 说：修 descriptor 后 60%，余 40% 卡在三种打包行。
**本轮实测推翻了后半句，并给出正确的第二道闸：**

| 闸 | 规模 | 判定点 |
|---|---|---|
| ① `subagent/descriptor` 写 `version: 2`，codec 只收 `3` | **2275** 份 | `$B/dsh-session-format-v0-to-v1/lib/index.js:1582-1587`、`:1289-1291` |
| ② 插件消息来源 `form:"snapshot"` 缺 `sections` 数组 | **456** 份 | 同上 `:942-947`（`user/message.data.source`、`agent/inbox/spliced.data.inserted[].source`、`[].message.source` 三处） |
| ~~三种打包行 `text-chunks`/`reasoning-chunks`/`tool-call-chunks`~~ | **不是闸门** | `:1610-1614`（`PACKED_TAGS`）、`:1656-1690`（packed 分支）、`:1796-1808`（`decodePackedRun`）、`:1809-1843`（`expandAssistantChunkRun`）——**本来就支持** |

**反证**：349 份含打包行的日志中，**162 份在完全未修复时即可读**（最大单文件 72,479 行打包行）。
WP8 独立复现，与协调者**逐份 2508/2508 完全一致，disagree = 0**。

### 2.2 通过率

| 阶段 | 可读 | 占比 |
|---|---|---|
| 基线（原始语料，0.2.0 真实 catalog） | 229 / 2508 | **9.13%** |
| 只修 descriptor（消融，sections 注入 0） | 2052 / 2508 | 81.82% |
| **修完两处（转换产物）** | **2508 / 2508** | **100.00%**（失败清单 0） |

### 2.3 转换纪律与两把闸门（**其中一把是执行档查出来的真缺陷**）

- 只在**语料副本** `p0a/corpus/` 上做，源根只读；物理格式/文件名/header **一律不变**（仍是 v0/v3）。
- 白名单修复只有两条，逐条记录在 `p0a/recon/convert-report.jsonl`：
  - **R1** `subagent/descriptor.data.version` 2 → 3（2727 处）
  - **R2** 插件 snapshot 来源补 `sections: []`（912 处）——**不新增内容、不删字段、不改 `form`**
- **闸门 A（codec 层）**：`p0a/scan.mjs` —— 真实 0.2.0 catalog 逐份读打开 ⇒ 2508/2508
- **闸门 B（物理布局）**：`p0a/framecheck.mjs` —— 首帧必须**恰好只有一行 header**
  （`$B/dsh-session-persistence-jsonl/lib/index.js:2293-2295`；`:3040-3044` 会把该错误**静默 continue** ⇒ 整根枚举为空）⇒ 2508/2508
  > **这一条是 WP1 复核时发现协调者转换器缺陷后补上的**：第一版把每份日志压成单帧，codec 层 100% 通过，
  > 但持久层会**一份都枚举不到**。协调者已修（frame#0 = header 单独一帧），并已重跑全部闸门。

### 2.3b WP1 独立复核（全量、无抽样）

WP1 用独立写的 `p0a/verify/verify-v4.mjs`（6 种模式）对**全量 2508 份**复跑，结论与协调者**逐份一致**：

| 项 | 结果 |
|---|---|
| **Q2 写打开 / v4 全链**（`createSessionFormatCatalogWithChildren(真实 child facts)`，v0→v1→v2→v3→v4） | **2508/2508 = 100.00%**，失败清单 0；`validation:'transformed'`（持久层真实接线 `:2704-2707`）同 100%。facts：291 个父、2276 条子代事实、0 失败 |
| **Q3-1 头部不变量** | 头部整行**逐字节** 2508/2508；字段深比差异 **0** |
| **Q3-2 地标计数** | 9 个地标两侧全等、**差异文件 0**；`assistant/chunk` 展开后两侧同为 **34,085,630** |
| **Q3-3 消息投影哈希** | 行级**扣除白名单后 2508/2508 相等**，非白名单差异 **0**；**raw 相等的恰好是 229 份 = 基线可读集**（集合相等——天然对照组）；0.1.1 侧成对 **2505/2505** 事件数相等 |
| **白名单面精确性** | R1 **2275** 处 + R2 **912** 处；**已有非空 `sections` 的 12,095 处未被触碰** |
| **物理闸门** | 修订后真件 `readFirstZstdLine` **2508/2508**；`listArtifacts` 枚举 **2505 = 目录数**（零静默跳过） |
| **A/B 可复现反证** | 同内容**单帧**根：gate **0/60** + 枚举 **0**；同内容**分帧**根：gate **60/60** + 枚举 **418** |

> WP1 并已按协调者口径把 `curgen` 30/30 明确判为「**判据不适用于本轮口径**」（转换产物刻意保持 v0/v3，
> v4 后继由 0.2.0 在**写打开**时惰性发布），未误记为失败。

### 2.4 端到端实测（隔离 drill 真启动 0.2.0-rc.2，指向**已落盘**的隔离根）

```
SVC ctor=JsonlSessionPersistence methods=["list","stat","open","listArtifacts"]
SVC listArtifacts() => 2521 in ~650ms
SVC sourceVersion histogram: {"v4":16,"v0":2502,"v3":3}
SVC legacy(sourceVersion<=3) count: 2505
SVC legacy read-open sample: 40/40 succeeded
```

**账目完全对得上**：磁盘 2524 个 `.zstd` − 3 个**被更高代际遮蔽**的下代文件 = **2521**。
（那 3 个 session 目录里同时存在 `session.jsonl.zstd` 与 `session.v3.jsonl.zstd`，
`listGenerations` 按"取最高代际"选 v3、忽略 v0——**这是正确语义，不是丢失**。）

### 2.5 落盘与附件

- 会话：`$A/home/sessions/` **2511** 文件（2508 `.zstd` + 3 个 0 字节 `session.lock`），sha256 **2511/2511 一致**
- 附件：`$A/home/attachments/v1/` **996** 文件（987 objects + 9 request-images），sha256 **996/996 一致**
- 整根 `framecheck`：**ok 2524 / bad 0**（含 3098 运行时写入的 16 份 v4，同口径通过）
- 未混入任何未压缩 `.jsonl`（否则整根会被判 `legacyLayout` 拒绝）

### 2.6 ⚠ 两条必须在正式切换前处理的事

1. **源根是活跃 append-only 根**（WP8 实测：快照后 +2 份、7 份被追加、单文件 +577 帧）
   ⇒ **正式切换前必须重取一次快照再转换**，不要用本轮这份冻结语料直接当终稿。
2. **0.2.0 自己也在写 0.1.1 形态的日志**（WP8 实测：10:55 后新写入 9 份中 7 份当场被自家 v0 codec 拒收）
   ⇒ 更准确的说法不是"0.2.0 读不了 0.1.1 的历史"，而是**0.2.0 的 v0 codec 读不了 0.2.0 自己写出的 v0 日志**。
   这是**上游真实缺陷**（snapshot 校验过严 + 自写自读失败），按 D22 留待存量修完再报。

---

## 3. 其余工单

| 工单 | 状态 | 一句话 |
|---|---|---|
| WP3 两个插件修复的独立复核 | 完成 | 缺口修复后 **0 条**（修复前 2 条）；200 条条目全登记；17 个有设置页的命名空间全部可 served；结论「足够但需重启」 |
| WP4 技能迁移复核 | 完成 | 4/4 加载、警告 0；`AGENTS.md` 缺失已由协调者补上；`ppt-design-systems` = 从未启用 |
| WP5 办公入口 Route B | 完成草案 | **官方件不够到零代码**：`dsh-webhook` 无 Config、无 YAML 规则入口 ⇒ 自建薄插件不可避免；草案自测 34/34 + 18/18，`--dump-config` exit 0；**未落地，待裁决** |
| WP6 remoteHosts | 完成勘察 | 旧席位 `sidebar.workspaces.remoteHosts` 自 0.1.7 起被官方删除；新落点 `sidebar-right` 存在且已挂载；**mixed-provider 告警根因 = WE 的 `dsh.bundle.patch` 从未被套用**；方案草案 66 PASS |
| WP7 P2 文档收口 | 完成 | `docs/program-notebook.md` 492→658 行、新增两份 `docs/architecture/`（257 + 169 行）；**48/48 报告索引**；8 条勘误只改 docs |
| WP8 N17 根因勘误 | 完成 | 655 行；逐条判定交接件原叙述（3 条不成立、1 条部分成立）；与协调者逐份一致 |

---

## 4. 未闭门禁（**不得包装为通过**）

- **重启未执行**：两处修复代码正确但**在 3098 里尚未生效**（宿主 boot 10:34:48 早于改动 10:50+）。
  协调者**不能**自行重启——本会话就跑在 3098 进程里，重启会杀掉会话。⇒ 由用户执行 Runbook。
- **N17 未全闭**：本轮解决了"历史可读"，但 §2.6 两条（活跃根需重取快照、上游自写自读缺陷）仍在。
- **N1 / N10 / N16**：本轮未复验（不在本轮工单内），状态沿用交接件。
- **GUI 层**：本轮只做了"进程内 + RPC 层"实证，**设置页表单的实际点击保存未做**（那需要浏览器操作）。
- **P0-C / P1**：只有草案与勘察，**未落地**（越过了用户授权边界，待裁决）。
- **本轮未做的**：未提交 git、未改 `reports/` 下他人文件、未重启任何实例、未动 `~/.dsh/**`。

## 5. 证据索引（本轮新增）

| 文件 | 内容 |
|---|---|
| `reports/RESTART-AND-VERIFY-RUNBOOK.md` | **用户要执行的：重启 3098 + 验收 + 回滚** |
| `verify-settings-served.mjs` | 重启后一条命令验收（走 `/api/settings/describe`，与浏览器同通道） |
| `reports/VOLATILE-FIX-VERIFY.md` | WP3：两个插件修复的独立复核（含 200 条条目登记表） |
| `reports/SKILLS-MIGRATION-VERIFY.md` | WP4：技能迁移复核 |
| `reports/N17-ROOT-CAUSE-CORRECTION.md` | WP8：N17 根因勘误（655 行） |
| `p0c/REPORT.md` + `p0c/RUNBOOK-WP5.md` | WP5：Route B 设计与 Runbook |
| `p1/WP6-REPORT.md` | WP6：remoteHosts 勘察与方案 |
| `docs/program-notebook.md`、`docs/architecture/06-*.md`、`07-*.md` | WP7：文档收口 |
| `p0a/BRIEF.md` | 执行档共享事实基线 |
| `p0a/{census.py,scan.mjs,framecheck.mjs,convert.mjs}` | P0-A 四件套（预检 / 两把闸门 / 转换器） |
| `p0a/recon/{census,scan-before,scan-after,convert-report}.jsonl` | 逐份原始结果 |
| `p0a/deploy/DEPLOY-REPORT.md` + `manifest.jsonl` | 落盘与完整性清单（3543 行） |
| `logs/drill-3099-*.log`、`logs/drill-enum.json` | drill 端到端实测原始输出 |
| `volatile-fix-backup/` | 两插件 + profile patch 的改前原件（回滚用） |
