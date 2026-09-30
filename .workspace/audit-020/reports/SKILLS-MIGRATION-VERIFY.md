# WP4：技能（skill）迁移的独立复核 + 未迁移资产清点

- **工单号**：WP4（dsh-020 迁移轮）
- **状态**：**完成**
- **执行档**：subagent `session-4b5cc4e5-5c9c-4ca9-8889-33d1c4e113e5`（agentPreset `standard-glm`，parent `session-763d8e98-152a-4a31-983a-bdb47743b145`）
- **唯一写入边界（本报告 + 证据脚本，未越界一个字）**：
  - `/home/CNS2026495165/dsh/.workspace/audit-020/reports/SKILLS-MIGRATION-VERIFY.md`（本文件）
  - `/home/CNS2026495165/dsh/.workspace/audit-020/verify-skills/**`

## 0. 实跑命令与证据路径

| # | 命令（可复现） | 证据文件 |
|---|---|---|
| 1 | `DSH_HOME=$A/home node verify-skills/probe-roots.mjs` | [probe-roots.out.txt](</home/CNS2026495165/dsh/.workspace/audit-020/verify-skills/probe-roots.out.txt>)、脚本 [probe-roots.mjs](</home/CNS2026495165/dsh/.workspace/audit-020/verify-skills/probe-roots.mjs>) |
| 2 | `node verify-skills/probe-assets.mjs` | [probe-assets.out.txt](</home/CNS2026495165/dsh/.workspace/audit-020/verify-skills/probe-assets.out.txt>)、脚本 [probe-assets.mjs](</home/CNS2026495165/dsh/.workspace/audit-020/verify-skills/probe-assets.mjs>) |
| 3 | `zstd -dc <session>/session.v4.jsonl.zstd > verify-skills/parent-session.jsonl; node verify-skills/extract-catalog.mjs parent-session.jsonl > catalog-blocks.txt` | [catalog-blocks.txt](</home/CNS2026495165/dsh/.workspace/audit-020/verify-skills/catalog-blocks.txt>)、[parent-session.jsonl](</home/CNS2026495165/dsh/.workspace/audit-020/verify-skills/parent-session.jsonl>)、[extract-catalog.mjs](</home/CNS2026495165/dsh/.workspace/audit-020/verify-skills/extract-catalog.mjs>) |
| 4 | 同上，对**本会话自身**的日志 | [current-session.jsonl](</home/CNS2026495165/dsh/.workspace/audit-020/verify-skills/current-session.jsonl>) |

路径代号：`$A = /home/CNS2026495165/dsh/.workspace/audit-020/assembly-020`；
`$B = $A/prefix-cli-rc2/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai`。

**实跑环境（`/proc/1/environ`，PID 1 = 本会话宿主进程）**：

```
HOME=$A/home  DSH_HOME=$A/home  DSH_PROFILE=web  DSH_PROFILE_DIR=$A/home/profiles/web
DSH_SESSION_ID=4b5cc4e5-...   DSH_AGENTS_HOME=(unset)   DSH_BUNDLED_SKILL_DIR=(unset)
DSH_PPT_DESIGN_SYSTEM_ROOT=(unset)   DSH_WORKBUDDY_PPT_SKILL_ROOT=(unset)
```

---

## A. 发现路径复核（源码级 + 实跑）

### A.1 源码

- `roots()` 本体：`$B/dsh-skill-filesystem/lib/index.js:150-188`（已逐行读出，与工单给的行号一致）。
- rank 常量：`:21-25` → `PROJECT_DSH=100 / PROJECT_AGENTS=200 / CUSTOM=300 / USER_DSH=400 / USER_AGENTS=500`；
  `BUNDLED_SKILL_RANK=600` 由 `$B/dsh-skill/lib/index.js:23` 引入（`:9` import）。
- 根构造语义：project 根 = `findProjectRoot(cwd)` 向上找 `.git`（`:807`，README:56 同述）；
  `user-agents` = `agentsHome ?? $DSH_AGENTS_HOME ?? homedir()/.agents`（`:78`）；
  `bundled` 根 = `config.bundledSkillDir ?? (includeDefaultRoots ? $DSH_BUNDLED_SKILL_DIR : undefined)`（`:84`）。

### A.2 实跑复算（cwd=`/home/CNS2026495165/dsh`，`DSH_HOME=$A/home`）——**全部根 + rank + 是否命中**

| rank | source | 路径 | 命中 |
|---|---|---|---|
| 100 | `project-dsh` | `/home/CNS2026495165/dsh/.dsh/skills` | **MISS**（目录不存在） |
| 200 | `project-agents` | `/home/CNS2026495165/dsh/.agents/skills` | **MISS** |
| 300 | `custom`（`customSkillDirs`） | 本部署 **未配置 ⇒ 无此行** | — |
| 400 | `user-dsh`（`skipSystem:true`） | `$A/home/skills` | **HIT，4 目录** |
| 500 | `user-agents` | `$A/home/.agents/skills`（`homedir()` 被 `HOME=$A/home` 改写） | **MISS** |
| 600 | `bundled` | `$DSH_BUNDLED_SKILL_DIR` 未设 ⇒ **无此行** | — |

对照场景（同一真实 provider，仅改 config）：
- 加 `customSkillDirs`（= 官方 `dsh-web-app/presets/cordis.patch.yml:146` 的算法）⇒ 多出 **rank 300 `custom`** 根，命中 `$B/dsh-agent-preset/skills`，**4 目录**。
- 显式给 `bundledSkillDir` ⇒ 多出 **rank 600 `bundled`** 根，命中同一目录。

> `[实跑]` 三个场景的完整输出见 `probe-roots.out.txt`。`[源码]` 该目录算法可复现：
> `createRequire($B/dsh-web-app/presets/cordis.patch.yml).resolve('@deepseek-ai/dsh-agent-preset/package.json')` 逐字符解析到
> `$B/dsh-agent-preset/package.json`。

### A.3 关键否定结论（本工单新增，T11 未覆盖）

**本部署的 preset 层 `skill-filesystem` 行是"裸行"。** 依据：

- `$A/home/profiles/web/cordis.patch.yml:442-443`（`preset-standard-glm` 的嵌套 `plugins` 内）与
  `$A/home/.agent-presets/standard-glm/agent.cordis.yml:83-84`：两处都只有 `id` + `name`，**没有 `config`**。
- 因此 `Config.customSkillDirs` 取默认 `[]`（`$B/dsh-skill-filesystem/lib/index.js:36`），
  **官方 preset 里那段 `customSkillDirs: !!js …dsh-agent-preset/skills` 是 bundle 层的内容，不会自动带进用户 preset**。

**且 host 层那行是被官方关掉的。** `$B/dsh-web-app/cordis.patch.yml:484-488`：
`- id: skill-filesystem  disabled: true`（`tool-skill` 同被禁用），注释原文 *"the base host `skill-filesystem` row is disabled here (presets own local discovery)"*。
⇒ **本部署的本地技能发现 100% 来自 preset 那条裸行**：4 个用户技能、`source=user-dsh`、`rank=400`。

---

## B. 逐技能加载复核（实跑，真实 `FileSystemSkillProvider`）

用 `$B/dsh-skill-filesystem/lib/index.js` 的**真实** `FileSystemSkillProvider`（rc.2 件，888 行），
以 `{watch:false, dshHome:$A/home}` 构造，跑真实 `roots()` / `list()` / `get()`：

| 技能 | provider | source | rank | `modelInvocable` | `userInvocable` | `metadata.version` | 正文长度 | `get()` |
|---|---|---|---|---|---|---|---|---|
| `grill-me` | `filesystem` | `user-dsh` | 400 | **false** | true | (无 metadata) | 2221 | OK |
| `ppt-master` | `filesystem` | `user-dsh` | 400 | true | true | **6.1.0** | 5567 | OK |
| `program-notebook` | `filesystem` | `user-dsh` | 400 | true | true | (无 metadata) | 2383 | OK |
| `session-handoff` | `filesystem` | `user-dsh` | 400 | true | true | **1.0.1** | 2064 | OK |

- `list()` 返回 **4 个候选**（普通数组 ⇒ `complete=true`，未降级）。
- **provider 警告条数 = 0**。
- `ppt-master` 的附带 metadata 键：`version, copyright, license, official_repository`；
  `session-handoff`：`version, author, updated`。
- `modelInvocable=false` 的映射点已核实：`$B/dsh-skill-filesystem/lib/index.js:850-856`
  （`disable-model-invocation: true` ⇒ `modelInvocable:false`）。
- 拷贝保真：`~/.dsh/skills`、`~/.dsh-017/skills`、`$A/home/skills` 三棵树
  **内容寻址 sha256 完全相同 = `046e663545e8453ea378f09be3cbde9887fcd3c89e662dba1d16277c5dcdd663`**，`diff -rq` rc=0。

**判定**：`[实跑]` **4/4 全部加载成功，警告 0**。其中 **3/4** 进入模型目录（`grill-me` 按设计不进，属预期）。

### B.1 ⚠ 与工单描述不符的一处实测差异（如实报告，不掩盖）

工单/协调者口径：「技能目录当场从 **2 条**变为 **5 条**」。
`[实跑]` 我解压了父会话与本会话的真实日志，目录块如下（`extract-catalog.mjs` 输出）：

| 时刻(UTC) | 会话 | update | 条数 | 名字 |
|---|---|---|---|---|
| 02:45:48 | 父 `session-763d8e98` boot | false | **2** | `ppt-template-fidelity`, `workbuddy-ppt` |
| 02:52:15 | 父 `session-763d8e98` 更新块 | **true** | **5** | `ppt-master`, `ppt-template-fidelity`, `program-notebook`, `session-handoff`, `workbuddy-ppt` |
| 03:05:41 | 本会话 `4b5cc4e5` boot | false | **5** | 同上一行 |

**静态推演应为 6**：4（preset 裸行 `user-dsh`，去掉 `grill-me`）+ 2（`@local/dsh-pptmaster` 在**部署作用域**全局注册的
`workbuddy-ppt` + `ppt-template-fidelity`，均 rank 600） **= 6**。
其中 `tencent-pptx` 正确缺席：其 SKILL.md 在 `<workbuddyRuntimeRoot>/skills/tencent-pptx/SKILL.md`，
`$A/home/office-ppt/` 不存在 ⇒ `registerTencentPptSkill` 的 `list()` 用 `readFile` 探测后**主动过滤**（`$A/home/profiles/node_modules/@local/dsh-pptmaster/lib/index.js:80789-80794`）。

**差异候选解释（不能定案，标 `[未验证]`）**：会话内**未出现任何**
`skill "X" ignored because a higher-priority skill already exists`（`$B/dsh-tool-skill/lib/index.js` 目录钩子
只在 `snapshot.complete=true` 时发布，`:214`），故**不像是同层遮蔽**；也无 `.system`、无符号链接、无重名。

同时可以**排除一个候选**：差额**不是**"`ctx.fs` 存在时走 `listSkillRootEntriesFromFileSystem`（`:826-834`）、
裸 Node 兜底时走 `listSkillRootEntriesFromNode` 导致的结果不同"。
反证来自上表本身：同一进程、同一 preset 行在 **02:52:15 确实一次性新增了 4 个 `user-dsh` 名字**
（2 → 5 的那次目录更新），说明**运行态的 preset `filesystem` provider 当时确实吐出了 4 条**。
但两个 `user-dsh` 条目（`program-notebook`、`session-handoff`）在**此前 7 分钟**的 boot 目录里并不存在，
而它们在磁盘上是 09-20 / 09-25 的旧文件 —— 也就是说 boot 那一刻 provider 只看到了 2 条（`ppt-*`），
**`$A/home/skills/` 被看到的时刻晚于进程启动**，与 `$A/home/skills` 目录 mtime `10:52:15`（= 02:52:15 UTC）**精确吻合**。
⇒ 这 4 条只能来自 `SkillWatchManager` 的**首次根扫描**，而**首扫晚于进程启动 6 分 27 秒**（boot 02:45:48 → 目录更新 02:52:15）：
`SkillWatchManager` 的 chokidar 初始化/根探测存在可观测的延迟，`observeRoots` 在不完整时会
`complete=false`（`:104-110`）而**不缓存**。**该延迟本身是可复现的真实风险点**（新会话开头可能整段看不到用户技能），
但其"少 1 条"的精确成因仍未定案。

**该差额不影响 B 的 4/4 结论**（4 个技能确实全部可被 `get()` 加载），但意味着"模型实际看到的条目数"
在会话早期是**不稳定**的：boot 时 5 条、依赖后续 watcher 补齐。复现命令已给出（表格第 1、3 行）。

---

## C. `ppt-design-systems` 的定性

### C.1 结论：**属于「从未启用」，不是「迁移丢失」** `[源码]` + `[实跑]`

三条独立证据：

1. `[源码]` **注册是条件式的**。`$A/home/profiles/node_modules/@local/dsh-pptmaster/lib/index.js:82013-82014`：

   ```js
   const pptDesignSystemRoot = config.pptDesignSystemRoot ?? process.env.DSH_PPT_DESIGN_SYSTEM_ROOT;
   if (pptDesignSystemRoot !== void 0 && pptDesignSystemRoot.trim() !== "")
       registerPptDesignSystems(ctx, await loadPptDesignSystemLibrary(pptDesignSystemRoot));
   ```

   两者皆空 ⇒ **该 provider 连注册都没执行**（整个 `@local/dsh-pptmaster` 的三个注册点里，只有 `:192` 这一个受此门控）。

2. `[实跑]` **本机从未设置过**。全树 grep `DSH_PPT_DESIGN_SYSTEM_ROOT` 只命中三处
   `lib/index.js:82013` 的**读取方**（现役 `~/.dsh`、`~/.dsh-017`、`$A/home` 三份同源件），
   **零个写入方**；`/proc/1/environ` 未设；`~/.bashrc`/`~/.profile`/`/etc/environment` 均无 `DSH_` 写入；
   `$A/boot-web.sh` 也不注入。三个 profile patch 给的都只是
   `root: !!js dshHomePath('office-ppt')`（`OfficePptStore` 用），**不是 `pptDesignSystemRoot`**。

3. `[实跑]` **参照根是空的**。`~/.dsh-017/office-ppt` = 存在但 **0 条目**；`~/.dsh/office-ppt` **不存在**；
   `$A/home/office-ppt` **不存在**。且全树找不到任何 staged 的 `academic.md|promotion.md|work.md`，
   也找不到任何 `ppt-style-*`。**⇒ 现役 0.1.1 侧同样没有这个 skill，迁移不可能"丢"它。**

> 语义注记：`OfficePptStore(config.root)` 的 `root` 是 **PPT 产物存储根**，按需创建；
> `$A/home/office-ppt` 缺失**不影响**任何现有功能，**不列为迁移缺失项**（见 D）。

### C.2 若用户想启用：确切步骤（**我没有执行任何一步**）

**第 0 步（判定门槛）**：库是**运营商 staging** 语义，不是随包分发。
`$A/home/profiles/node_modules/@local/dsh-pptmaster/skills/ppt-design-systems/SKILL.md`（2436 B）**已随包存在**，
缺的只有**数据目录**。

**第 1 步：stage 三个分类文件到某个绝对目录 `$R`**（建议 `$DSH_HOME/office-ppt/design-systems/`，
与 `root` 的产物根分开，避免产物与素材混放）。

约束（全部来自 `loadPptDesignSystemLibrary` `:95-116` + `parsePptDesignSystemSources` `:63-96`）：

| # | 约束 | 源码 |
|---|---|---|
| 1 | `root` 必须是**绝对路径**，否则 `throw "pptDesignSystemRoot must be absolute"` | `:104` |
| 2 | 文件名**恰好三个**：`academic.md`、`promotion.md`、`work.md`（`EXPECTED_CATEGORIES`，`:24-28`），逐个 `readFile`，缺一即抛 | `:107-113` |
| 3 | 每个 style 用标记 `<!-- === 套件: <category>/<slug> === -->` 分隔；`category ∈ {academic,promotion,work}`，`slug = [a-z0-9-]+`，否则抛 `unsupported design-system marker` | `:65-72` |
| 4 | 每个 style 的正文必须同时含 `## PART A` 与 `## PART B`，否则抛 | `:74` |
| 5 | 每个 style 正文必须有一级标题匹配 `^# <标题> · …STYLE DESIGN SYSTEM$`，否则抛 `contains a style without a DESIGN SYSTEM heading` | `:50-54` |
| 6 | 每个 style 必须有一行 `One-sentence style signature: <文本>`（`One sentence` 亦可），否则抛 | `:55-60` |
| 7 | **每类恰好 6 个、总数恰好 18 个**；重复 `ppt-style-<slug>` 会抛 duplicate | `:76-95` |
| 8 | 产出名固定为 `ppt-style-<slug>`，`source=bundled`，`rank=600` | `:78`、`:128-141` |

**第 2 步：把 `pptDesignSystemRoot: <$R>` 交给 `@local/dsh-pptmaster` 的 config。**

⚠ **落点是 `dsh-pptmaster` 行，不是 `skill-filesystem` 行。**
`pptDesignSystemRoot` 是 `@local/dsh-pptmaster` 自己的 `Config` 键（`lib/index.js:81981`），
`dsh-skill-filesystem` 完全不认识它。正确改法是给
`$A/home/profiles/web/cordis.patch.yml:85-88` 这条已有行**加一个并列的键**：

```yaml
- insert:
    - id: dsh-pptmaster
      name: '@local/dsh-pptmaster'
      config:
        root: !!js dshHomePath('office-ppt')
        pptDesignSystemRoot: /绝对路径/design-systems      # ← 新增这一行
```

替代方案：设环境变量 `DSH_PPT_DESIGN_SYSTEM_ROOT=/绝对路径/design-systems`（在 `$A/boot-web.sh` 注入，
与 `DSH_HOME`/`DSH_TELEMETRY_MODE` 并列）。
两条替代路径**都不要**用 `!!js dshHomePath('office-ppt')` 去指已有 `root:` 那个目录——
`~/.dsh-017/office-ppt` 为空，照抄会得到"目录存在但 0 style"的空库，
此时 `parsePptDesignSystemSources` 会抛 `PPT design-system library requires 18 styles; received 0`（`:95`）：
**失败是显式的，不会静默降级**，代价是整条 `dsh-pptmaster` 激活失败。

**第 3 步（验收）**：重启会话后模型目录应新增 **19** 条（1 个 `ppt-design-systems` + 18 个 `ppt-style-*`）。
**若用户在 `$R` 里放了不满足第 3–7 条的文件，插件会在 `apply()` 里抛错，即整条 `dsh-pptmaster` 激活失败**
（`:82014` 是 `await` 直调，异常会冒到组合装载）——这是启用前必须先本地校验一遍的理由。

> **我没有做**：没有创建 `$R`、没有写任何 `.md`、没有改任何 profile patch、没有设环境变量。按工单，这是产品决策。

---

## D. 未迁移资产清点（穷举，命中/未命中）

口径：**技能可见性 + 技能相关行为**。`$DSH_HOME=$A/home`。

| 资产 | 来源（现役） | `$A/home` | 影响 | 定性 |
|---|---|---|---|---|
| `skills/` | `~/.dsh/skills`（4 目录） | **HIT** | 3 条进模型目录、1 条（`grill-me`）供 btw 侧聊用 | ✅ 已做（sha256 一致） |
| `.agent-presets/standard-glm/` | `~/.dsh/.agent-presets/…` | **HIT** | preset `standard-glm` 可挂载 | ✅ 已做（见 E） |
| `wallpapers/` | `~/.dsh/wallpapers` | **HIT**（1 张 PNG，与现役同 md5 尺寸 2334260 B） | 壁纸本体可读 | ✅ 已做 |
| `taste/` | `~/.dsh/taste` | **HIT**（`config.json`/`display.zh.json`/`taste.md`，且多带一份 `display.zh.json.migrated-backup-*` = 017 侧拷贝痕迹，非本轮新增） | `dshHomePath("taste")`（`$A/home/profiles/node_modules/@deepseek-ai/dsh-taste/lib/index.js:366`）命中 | ✅ 已做 |
| `office-ppt/` | `~/.dsh` **不存在**；`~/.dsh-017/office-ppt` **空** | **MISS** | `OfficePptStore` 按需创建该目录；**当前无内容可迁、无功能损失** | ⚪ 非缺失项 |
| **`AGENTS.md`** | `~/.dsh/AGENTS.md`（11874 B）、`~/.dsh-017/AGENTS.md`（同字节，md5 同） | **MISS** | **全局用户指令整段丢失**：`$B/dsh-agent-instructions/lib/index.js:141` `USER_GLOBAL_FILE="AGENTS.md"`、`:561` `const userGlobal = join(config.dshHome, USER_GLOBAL_FILE)`（0.2.0 从 **`$DSH_HOME/AGENTS.md`** 读，一行一处）；`config.dshHome` 由 `$DSH_HOME` 决定。旁证 `[实跑]`：本会话（seq 10 目录块）与父会话日志内**没有任何 `source.kind="agent-instructions"` 的消息记录**（12 次 `agent-instructions` 字样全部来自本工单提示词与我的推理文本；唯一的 `Instructions from:` 命中在 `tool/result` 里，是我自己 grep 的输出） | ❌ **真缺失** |
| `~/.agents/skills` / `$DSH_HOME/.agents` | 现役与 017 **都不存在**；`$A/home/.agents` **不存在** | **MISS** | rank 500 `user-agents` 根为空。**无内容可迁**；`DSH_AGENTS_HOME` 未设（`$B/dsh-skill-filesystem/lib/index.js:78`） | ⚪ 非缺失项 |
| `$B/dsh-agent-preset/skills/`（`agent-experience`、`cordis-composition-reference`、`cordis-plugin-development`、`editing-cordis-compositions`，共 4 个） | 随 CLI 包发布 | **不可见** `[实跑]` | 官方 web-app preset 用 `customSkillDirs` 把这 4 条挂到 rank 300（`$B/dsh-web-app/presets/cordis.patch.yml:146`）；本部署的用户 preset 是**裸行**（§A.3），**故这条接不上** | ⚠ **行为上与「随包发布却不可见」**；T11 D2 的验收口径**明确预期不含**它们 ⇒ 属"符合预期"但**能力丢失**，取舍得由协调者裁决 |
| `DSH_BUNDLED_SKILL_DIR` | — | **未设** | `[实跑]` 全 `prefix-cli-rc2/` 树 grep：**3 处读取方**（`dsh-skill-filesystem/lib/index.js:84`、`lib/types/index.d.ts:40`、README×2），**0 处写入方**；`boot-web.sh`、`~/.bashrc`、`/etc/environment` 全无 ⇒ **只有读取方没有写入方**，本部署永远拿不到 rank 600 的 bundled 根 | ⚪ 事实确认（同 T11 未验证项 5/9 的口径） |
| `/home/CNS2026495165/dsh/agent-skills/`（仓库内快照，仅 `session-handoff`，git 跟踪 5 文件） | 仓库分发快照 | **不在任何发现路径上** `[实跑]` | 全 `prefix-cli-rc2/` 树 grep `agent-skills` **0 命中**；`roots()` 六个根无一处指向它 | ⚪ 非发现路径（仅作版本库内分发物） |

补充穷举（技能可见性相关的其余候选，均已核对）：
`.dsh/skills`（仓库根）**MISS**、`.agents/skills`（仓库根）**MISS**、`$DSH_HOME/skills/.system` **不存在**（`skipSystem` 无对象）、
`~/.dsh/office-handoff` 与技能无关。

**缺失清单（仅 1 项）**：**`$A/home/AGENTS.md`**。
建议动作（协调者执行，我未执行）：`cp ~/.dsh-017/AGENTS.md $A/home/AGENTS.md`（017 与现役逐字节相同，任取其一）。

---

## E. 与交接件 / 审计件的差异勘误

### E.1 T11 §8.2 的 D1–D4：**实际做了 4/4** `[实跑]`

| # | 动作 | 实际状态 | 证据 |
|---|---|---|---|
| **D1** | 4 个技能就位到新 `DSH_HOME/skills` | **已做** | `$A/home/skills/` 4 目录、SKILL.md 字节数与源一致、整树 sha256 `046e6635…` 与 `~/.dsh/skills` 相同；父会话目录块 02:52:15 起出现 4 个新名 |
| **D2** | `.agent-presets/standard-glm/{agent.cordis.yml,preset.yml}` 就位 | **已做** | `preset.yml` md5 `f81531b6…` 与 `~/.dsh`/`~/.dsh-017` **完全相同**；`agent.cordis.yml` 与 `~/.dsh-017` **完全相同**（`4db474a7…`），与现役 `~/.dsh`（`b3de3aaf…`）**有意不同**——assembly 版按 0.2.0 闭包移除了 `workflow-worker-thread` 行并把 `text:` 改成 `prefix:`（`diff` 两处），是**升级修正**不是漏迁 |
| **D3** | preset 选择器 id 用 `agent-preset-registry`（不是 `agent-presets`） | **已做** | assembly `cordis.patch.yml:24` = `- id: agent-preset-registry` + `default: standard-glm`；现役 `~/.dsh:16` = 旧 id `agent-presets`；`~/.dsh-017:16` = 新 id |
| **D4** | 不加 `@deepseek-ai/dsh-sdk-app` 到 bundles | **已做** | `$A/home/profiles/web/package.json` bundles = `["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app"]`；会话目录块无任何 `office-*` |

⇒ **T11「技能子系统无需任何代码级修正，只需 D1–D4 部署动作」这个结论，在部署侧已 100% 兑现。**

### E.2 T11 未覆盖、本轮新增的实际情况

1. **`AGENTS.md` 不在 T11 的 D 清单里，但它确实缺，且属"技能可用性同族"的全局指令面**（§D）。
   T11 只审了 `dsh-skill*` 一族包，`dsh-agent-instructions` 未进它的取证范围。**这是本轮实质新增的缺失项。**
2. **`customSkillDirs` 只在"官方 preset"里存在，用户 preset 是裸行**（§A.3）。
   T11 §7.3 R1 注意到预设的 `skill-filesystem` 行"不设 `customSkillDirs`"，但把它当作**未验证项 12**（未逐行 diff），
   且推断口径是"两者默认根集合相同"——**本轮把它证成了硬事实**：官方那段 `!!js` 表达式在用户 preset 路径上**根本不生效**，
   4 条随包发布的 `agent-experience`/`cordis-*` **必然不可见**。
3. **`DSH_BUNDLED_SKILL_DIR` 是"只有读取方、没有写入方"的死钩子**（§D），本部署 rank 600 根永远缺席。
4. **实测目录条数与静态推演差 1（5 vs 期望 6）**（§B.1）。T11 的 harness 只看 provider 层，看不到会话内目录块；
   本轮把"运行态契约"与"静态推演"的差额显式暴露出来。
5. **`tencent-pptx` 的缺席是"显式过滤"，不是漏注册**：`registerTencentPptSkill` 的 `list()` 先 `readFile` 探测再决定是否进目录
   （`@local/dsh-pptmaster/lib/index.js:80789-80794`）⇒ 本部署 `office-ppt/` 不存在 ⇒ 只有 `ppt-template-fidelity` 一条。
   核实方法见 `probe-assets.mjs`（`registerProvider` 三个调用点 `:192/:80043/:80819`）。
6. **`~/.dsh-017/office-ppt` 为空**（本轮实测 0 条目），据此把 `ppt-design-systems` 定成**「从未启用」**（§C）。

### E.3 交接件 `dsh-020_NEXT_SESSION_PROMPT.md` 的勘误

- §5「**N1**：…三插件已修」——`[实跑]` 与 `reports/PLAN-A-DONE.md` 一致，**成立**（不在 WP4 范围，仅记录一致）。
- §5「**N17** … 余 40% 卡在三种打包行」——与 `p0a/BRIEF.md` §2.1 **冲突**：BRIEF 已用源码行号否证该说法
  （真正的第二道闸是「插件消息来源缺 `sections`」）。**以 BRIEF 为准，交接件该句应删。**（非本工单主责，仅勘误记录。）
- §5 **完全没有提"技能迁移只做了 4 个目录、`$DSH_HOME/skills` 此前根本不存在"这一事实**，
  也没有 D1–D4 的落地状态；§3「本会话已完成的工作」4 条里**技能迁移 0 提及**。
  ⇒ **交接件对技能面是"零记录"**，这正是用户点名"还有很多 skill 没有成功迁移"的文档侧成因。
- §1 表格「仓库/HEAD `651b1712…`」等活值不在 WP4 范围，未复核。

---

## F. 结论强度汇总

| 结论 | 强度 |
|---|---|
| A：六个根、rank、命中状态；`customSkillDirs`/`bundledSkillDir` 缺席；host 行被官方 disabled | `[实跑]` + `[源码]` |
| B：4/4 加载成功、`modelInvocable` 3 true/1 false、警告 0、正文长度与 version | `[实跑]` |
| B.1：会话内目录 **5 条** vs 静态推演 **6 条** 的差额 | `[实跑]`（差额本身）+ `[未验证]`（成因） |
| C：`ppt-design-systems` = **从未启用**，非迁移丢失 | `[源码]` + `[实跑]` |
| C.2：启用所需的 8 条约束与落点 | `[源码]` |
| D：`AGENTS.md` 是唯一真缺失项；其余 HIT 或"无内容可迁" | `[实跑]` |
| E：T11 D1–D4 = 4/4 已做；T11 未覆盖 6 项 | `[实跑]` |

## G. 未验证项

1. `[未验证]` **B.1 的差额成因**：为何运行态目录 5 条而静态推演 6 条。已排除同层遮蔽、`.system`、符号链接、重名，
   也排除了"`ctx.fs` 路径差异"（同一进程在 02:52:15 确实一次性吐出了 4 个 `user-dsh` 名字）。
   **剩余未验证点**：那一次目录发布是否恰逢 `SkillWatchManager` 的 debounce 窗口，使 `collectFresh` 只观察到 4 个新目录中的 3 个；
   以及"新会话 boot 时用户技能整段缺席、需靠 watcher 后续补齐（本例迟了 6 分 27 秒）"这一**延迟**在实际迁移中是否可接受。
   未在真实组合内复现 provider 装配（硬约束：禁止起服务、禁止重启 3098）。
2. `[未验证]` **0.1.1（3080）与 0.1.7（3097）实例的实际技能目录**。工单禁触；`ppt-design-systems` 的
   "现役也没启用"结论由**磁盘/配置/环境变量三处实证**推出，**不是**由这两个实例的运行态目录推出。
3. `[未验证]` **`@local/dsh-pptmaster` 在 `pptDesignSystemRoot` 指向"非空但不合规"目录时的实际报错路径**
   （是否冒到组合装载、是否只 warn）。仅由 `:82014` 的无 try/catch `await` 推得 `[源码]`。
4. `[未验证]` **`AGENTS.md` 缺失对会话行为的量化影响**（丢了多少字符/哪些段）。只核实了"读取点为
   `$DSH_HOME/AGENTS.md`"与"该文件不存在"；未读 11874 B 原文逐段比对。
5. `[未验证]` **把 4 条随包技能接进来的可行性**（在用户 preset 行加 `customSkillDirs` + `!!js` 求解 `baseUrl`）。
   未试配、未跑 `--dump-config`（会起进程）。
6. `[未验证]` **`agent.cordis.yml` 有意差异（去掉 `workflow-worker-thread`）是否覆盖了该 preset 的全部 0.2.0 契约变化**——
   只做了 `diff`，未逐条核对 0.2.0 闭包。
7. `[未验证]` **活值**（HEAD、patch 指纹、2508/2507 之类的计数）本轮一律未复核，不在 WP4 范围。

## H. 我没有做的事（纪律自证）

- **没有**写 `$A/home/**` 任何一个字（`skills/` 只读、profile patch 未动、未创建 `office-ppt/`、未放 `AGENTS.md`）。
- **没有**写 `~/.dsh/**`、`~/.dsh-017/**`、`reports/` 下任何**他人**文件、`p0a/**`。
- **没有**起任何服务、**没有** curl 任何端口、**没有** kill/restart 3080/3097/3098。
- **没有** stage 任何 design-system 文件、**没有**设环境变量、**没有**改 profile patch。
- **没有**把"资料缺失"写成"验证通过"：`AGENTS.md` 与"5 vs 6 差额"均按缺失/未定案如实登记。
- 全部写入仅落在：本报告 + `verify-skills/`（2 个 probe、1 个 extractor、4 个输出/证据文件）。
