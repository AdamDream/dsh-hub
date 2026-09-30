# T11 — 技能（skill）子系统 0.1.7 → 0.2.0 增量与兼容性审计

- 轨道：T11（审计阶段，只读；未改动任何产品代码/技能文件）
- 审计时间：2026-09-29（当轮实测）
- 被审对象：`@deepseek-ai/dsh-skill`、`dsh-skill-filesystem`、`dsh-skill-office`、`dsh-tool-skill`、`dsh-skill-badge`、`dsh-client-ui-skill`，以及承载它们的组合（`dsh-base` / `dsh-web-app` / `dsh-agent-preset` / `dsh-sdk-app` / 本机 profile 与 agent preset）
- 基线：`0.1.7-rc.2`（隔离根 `~/.dsh-017`，3097）与 `0.2.0-rc.1`（CLI 包已解于 `.workspace/dsh-020-pkg/x/package/`）
- 原始证据：`.workspace/audit-020/t11/evidence.txt`（当轮命令输出汇总）、`.workspace/audit-020/t11/harness/`（两个实测 harness）

---

## 1. 结论摘要

1. **技能子系统在 0.1.7-rc.2 → 0.2.0-rc.1 之间是零功能增量。** 六个技能相关包的 `lib/index.js` 全部**逐字节相同**（sha256 相同），差异只出现在 `package.json` 的版本号与 peer/dev 依赖版本号上。技能发现路径、rank 常量、frontmatter 解析、缓存/失效机制、目录装配行**均无任何变化**。
2. **协调者事实基线与 PLAN.md §已核实事实中的"0.2.0 依赖清单里新增了 `dsh-skill-office`"不成立。** 该包在 `dsh@0.1.7-rc.2` 的 `dependencies` 中**已存在**（第 65 行），`dsh-tool-subagent-control`（第 86 行）、`dsh-workflow-ptc`（第 94 行）同样已存在。当轮实测的依赖集合差：**0.1.7 → 0.2.0 只新增 `@deepseek-ai/dsh-experimental-schedule-bundle` 一项，无删除**。此结论与 T01 报告第 27/215–217 行互相印证（独立得到）。
3. **`dsh-skill-office` 在本部署中是"休眠包"。** 它仅被 `@deepseek-ai/dsh-sdk-app` 的 bundle 挂载（且行级 `disabled` 受 `DSH_PRIMARY_RUNTIME`/`DSH_BUNDLED_PRIMARY_RUNTIME` 门控），**`dsh-base`、`dsh-web-app` 及其全部 preset 都不挂载它**；本机两个 profile（`~/.dsh`、`~/.dsh-017`）的 `bundles` 都是 `[dsh-base, dsh-web-app]`，不含 `dsh-sdk-app`。⇒ 无论 0.1.7 还是 0.2.0，本机都不会出现 `office-docx` / `office-pptx` / `office-xlsx`。
4. **`dsh-skill-office` 与本机自建的 `dsh-office-handoff` 完全正交、互不替代**：前者是 Word/PPT/Excel 的**创作与结构校验**技能提供者（a-skill provider）；后者是 Nautilus 右键**投递/纳入工作区**的接收器 CLI（copy + journal + 受限回滚）。一个是"写文档"，一个是"把文件搬进工作区"，无任何功能交集。
5. **本机 4 个用户级技能在 0.2.0 上全部可被正确发现与加载**——用真实的 0.2.0 `FileSystemSkillProvider` 对真实技能根跑 `list()` / `get()`：4/4 成功，**0 条 provider 警告**，`metadata.version` 完整保留，`grill-me` 的 `disable-model-invocation: true` 被正确解析为 `modelInvocable: false`。
6. **不存在"官方同名技能遮蔽本机技能"的风险**——技能内置清单（`agent-experience`、`cordis-composition-reference`、`cordis-plugin-development`、`editing-cordis-compositions`、`office-docx`、`office-pptx`、`office-xlsx`）与本机 4 个技能名**零重合**；且 rank/分层裁决规则两版本逐字节一致，不存在"rank 变化导致遮蔽"。反方向（本机遮蔽官方）在当前名字集下也为 0。
7. **本轨道判定：技能子系统无需任何代码级修正。** 最小修正清单只剩"部署动作"与"可选加固"（§8）。
8. **附带发现（主责属 T02/T03，但对技能可见性链路有影响）**：agent preset 注册表插件的行 id 在 **0.1.1 是 `agent-presets`（包名复数 `@deepseek-ai/dsh-agent-presets`），自 0.1.7 起改为 `agent-preset-registry`（单数）**，0.1.7→0.2.0 不再变化。现役 `~/.dsh/profiles/web/cordis.patch.yml:16` 用的是旧 id ⇒ 迁到 0.1.7/0.2.0 后该条目**静默不命中**，`config.default: standard-glm` 失效、默认 preset 回落到官方 `standard`。**技能目录不变**（`standard` preset 同样挂 `skill-filesystem`），损失的是子代理模型固定（`adam/deepseek-v4.1-flash`）；隔离根的 `~/.dsh-017` patch 已是修正版，以它为准。另：`@local/dsh-btw` 以**硬编码路径** `$DSH_HOME/skills/grill-me/SKILL.md` 读技能正文并静默降级（`lib/index.js:1181`），是技能目录之外的第二条路径依赖。

---

## 2. 证据（当轮命令与源码行号）

### 2.1 包获取与哈希

```
export npm_config_cache=/home/CNS2026495165/dsh/.workspace/npm-cache
export npm_config_logs_dir=/home/CNS2026495165/dsh/.workspace/npm-logs
npm pack @deepseek-ai/dsh-skill@0.1.7-rc.2 @deepseek-ai/dsh-skill-filesystem@0.1.7-rc.2 \
         @deepseek-ai/dsh-tool-skill@0.1.7-rc.2 @deepseek-ai/dsh-skill-badge@0.1.7-rc.2 \
         @deepseek-ai/dsh-skill-office@0.1.7-rc.2 @deepseek-ai/dsh@0.1.7-rc.2
# 0.2.0 同集合 + dsh-base / dsh-web-app / dsh-agent-preset / dsh-client-ui-skill / dsh-sdk-app
```

`lib/index.js` sha256（0.1.7-rc.2 vs 0.2.0-rc.1，**两两相同**；完整表见 `evidence.txt`）：

| 包 | sha256 |
|---|---|
| `dsh-skill` | `4b88621be4e7ff09b05c175fc6dcb67e77a22e5c5570e3aa603338b2937ea791` |
| `dsh-skill-filesystem` | `244e92e032ef15e96cb60c9e2cfddf5d89e167eb171fcbfd83e9415b0455a0d7` |
| `dsh-tool-skill` | `5d4e2d7d475ac02674c85dde090bb293fbbbad48faf2ee8d098849e98592ad48` |
| `dsh-skill-office` | `203d1680ef0f6f35f5885aa2b6050a33ef0294ed0aa5ec9441dada9e0b987d84` |
| `dsh-skill-badge` | `e5b52ecf52c51316a70bf6fd837c8e7369a373960626bc2839661bab581f121d` |
| `dsh-client-ui-skill` | `8f546f3e000abab99f33f1f66446c69192bfa1efa2405d08ac0cd4ffbcd8a29f` |
| `dsh-sdk-app`（`cordis.patch.yml`） | **byte-identical**（`diff` 返回空） |

### 2.2 组合层证据

- `dsh-base@0.2.0-rc.1/cordis.patch.yml` **row-id 集合差**：`30a31 > otel`——两版之间 base bundle **只新增了 `otel` 一行**；技能行 `skill`(L294) / `skill-filesystem`(L297) / `skill-badge`(L300, `disabled: true`) / `tool-skill`(L304) 完全未动。**没有任何 `dsh-skill-office` 行**。
- `dsh-web-app@0.2.0-rc.1/cordis.patch.yml`：注释块 L475–482 明确"the base host `skill-filesystem` row is disabled here (presets own local discovery)"，随后 `- id: skill-filesystem` L484 + `disabled: true` L485、`- id: tool-skill` L487 + `disabled: true` L488。0.1.7 同段逐字相同（注释 L472–479，行 L481/L484）。该 bundle 的 skill/office 相关行只有 `office-to-pdf`（L269，两版均存在，非新增）。
- `dsh-web-app/presets/{standard,ptc}.patch.yml` L34–37：只挂 `skill-filesystem` + `tool-skill`，**无 `customSkillDirs`**。
- `dsh-web-app/presets/cordis.patch.yml` L143–149：`skill-filesystem` 带 `customSkillDirs: [<dsh-agent-preset>/skills]`。两版相同。
- `dsh-sdk-app/{0.1.7-rc.2,0.2.0-rc.1}/cordis.patch.yml` L36–41：**唯一**挂载 `dsh-skill-office` 的地方，`disabled: !(DSH_PRIMARY_RUNTIME ?? DSH_BUNDLED_PRIMARY_RUNTIME)`，`assetRoot: <PRIMARY_RUNTIME>/../office-skills`。两版**逐字节相同**。
- `DSH_BUNDLED_SKILL_DIR` 在 CLI/base/web-app/各 skill 包的 `lib/` 中**只有读取方、没有写入方**（`.workspace/audit-020/t11/evidence.txt` 末段），故 filesystem 的 bundled 根（rank 600）在所有默认部署中都不激活。
- 本机 profile：`~/.dsh/profiles/web/package.json:11` 与 `~/.dsh-017/profiles/web/package.json:9` 的 `dsh.profile.bundles` 均为 `["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"]`；`grep sdk-app` 两处皆空。

### 2.2b 附带发现：preset 注册表插件在 0.1.1 → 0.1.7 之间**改名换 id**（本轨道顺带取证，主责属 T02/T03）

| 版本 | web-app bundle 中的行 | 插件包名 |
|---|---|---|
| 0.1.1-rc.2（现役） | `- id: agent-presets`（`…/dsh-web-app/cordis.patch.yml:442–446`） | `@deepseek-ai/dsh-agent-presets`（**复数**） |
| 0.1.7-rc.2 | `- id: agent-preset-registry`（`bundles/x/deepseek-ai-dsh-web-app-0.1.7-rc.2/package/cordis.patch.yml:559–564`） | `@deepseek-ai/dsh-agent-preset-registry`（单数） |
| 0.2.0-rc.1 | `- id: agent-preset-registry`（`…/0.2.0-rc.1/package/cordis.patch.yml:562–567`） | 同上（0.1.7→0.2.0 **无变化**） |

两侧本机 profile 的 patch 行：

- 现役 `~/.dsh/profiles/web/cordis.patch.yml:16` = `- id: agent-presets  config.default: standard-glm` ⇒ 在 0.1.1 上**命中**，在 0.1.7/0.2.0 上**不命中**（新 bundle 里无 `agent-presets` 行，`grep "id: agent-presets"` 在 0.1.7/0.2.0 的 base+web-app 中为空）。
- 隔离 `~/.dsh-017/profiles/web/cordis.patch.yml:16` = `- id: agent-preset-registry  config.default: standard-glm` ⇒ **已按新 id 修好**。

### 2.3 源码行号（0.2.0，行号在 0.1.7 完全一致，因文件逐字节相同）

`dsh-skill/lib/index.js`
- L17 `const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/` —— 技能名文法
- L20–23 `RUNTIME_PROVIDER="runtime"`、`RUNTIME_RANK=250`、`BUNDLED_SKILL_RANK=600`
- L108–118 分层裁决语义注释："the nearest layer's entry wins a duplicate name outright, and the rank order decides duplicates only within one layer"
- L119 `class SkillRegistry extends Service`；L147–183 `registerProvider()`；L193–215 `register()`（runtime 技能）
- L265–297 `collect()`（`revision` + `MAX_COLLECT_ATTEMPTS=2` + `collectCacheMaxEntries=128`）
- L298–311 `collectFresh()`：`layers = [global, ...chainLayers(scope)]`，`merged.set(name, entry)` **后层覆盖前层**
- L312–330 `collectLayer()`：`entries.sort(compareIndexedCandidates)` 后 first-wins，被丢弃者打 `skill "X" from <source> ignored because a higher-priority skill already exists`
- L519–521 `compareIndexedCandidates = rank 升序 || providerOrder || localOrder`（**数值小者优先级高**）
- L511–518 `compareSkillSummary` 按 name 码点排序；L566 导出清单 `BUNDLED_SKILL_RANK, SkillRegistry, escapeText, isModelInvocable, isSkillName, isUserInvocable, renderSkillContent`

`dsh-skill-filesystem/lib/index.js`
- L21–25 根 rank：`PROJECT_DSH_RANK=100`、`PROJECT_AGENTS_RANK=200`、`CUSTOM_RANK=300`、`USER_DSH_RANK=400`、`USER_AGENTS_RANK=500`
- L31–44 `Config`（`providerName` 默认 `"filesystem"`、`includeDefaultRoots`、`dshHome`、`agentsHome`、`customSkillDirs`、`watch*`、`bundledSkillDir`）
- L150–188 `roots()`：L155 `.dsh/skills`(100)、L160 `.agents/skills`(200)、L166 `customSkillDirs`(300)、L172 `$DSH_HOME/skills`(400, `skipSystem: true`)、L177 `~/.agents/skills`(500)、L181 `bundledSkillDir`(600)
- L77 `resolveDshHome(config.dshHome)`；配套 `dsh-home-paths` L15 `DSH_HOME_ENV="DSH_HOME"`、L73–76 `resolveDshHome(configured, env) = resolve(expandHomePath(configured ?? (DSH_HOME 非空 ? DSH_HOME : defaultDshHome())))`、L49–51 `defaultDshHome() = homedir()/.dsh`
- L584–592 `discoverRoot()`：目录 `<name>/SKILL.md` 或根下扁平 `<name>.md`（**技能名取自 frontmatter，不取自目录名**）
- L664–705 `parseSkillFile()`；L679–688 `name`/`description` 必须为非空字符串且 `isSkillName(name)` 成立，否则 warn + 忽略
- L780–806 `parseFrontmatter()`：首行必须恰为 `---`（容忍 `\r`），须有闭合 `---`，`yaml.parse` 结果必须是**非 null、非数组的对象**
- L849–878 `parseInvocationPolicy()`：L850–852 `rejectLegacyInvocationKey` 对 `disableModelInvocation` / `modelInvocable` / `userInvocable` 三个**旧驼峰键直接抛错**（→ 该文件被忽略）；规范化键为 `disable-model-invocation` / `user-invocable`
- L879–883 `optionalMetadata()`：`metadata` 只要是对象即**原样透传**，无 `version` 必填/校验

`dsh-tool-skill/lib/index.js`
- L40 `DEFAULT_CATALOG_DESCRIPTION_MAX_LENGTH = 500`；L49 `Config`
- L359–362 `catalogDescription()`：空白折叠后超 500 截断为 500 并追加 `...`
- L373 `SKILL_GESTURE = /(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/g`（用户侧 `/技能名` 手势）
- L168–202 用户显式调用注入；L203–236 catalog 发布/替换

`dsh-skill-office/lib/index.js`
- L11–15 `SKILL_NAMES = ["office-docx","office-pptx","office-xlsx"]`；L23 `name="skill-office"`；L25 `inject=["skills"]`
- L26–36 `parseSkill()`：**无 frontmatter 或缺 `description` 即抛错**（比 filesystem 更严：不要求 `name`）
- L37–48 `officeRuntime()`：L43 若 `node`/`cli` 不是**绝对路径且存在的文件**即抛错
- L54–79 `apply()`：L57 若 `assetRoot/scripts/check_office.py` 不存在即抛错；三个候选 `provider:"dsh-office"`、`source:"bundled"`、`rank: BUNDLED_SKILL_RANK`、`resourceBase={kind:"directory"}`
- L80–95 provider 注册：`ctx.skills.registerProvider(() => provider)`

### 2.4 实测 harness（在真实 0.2.0 代码上跑真实本机技能根）

`harness/run.mjs`（真实 `FileSystemSkillProvider`，`watch:false`，`ctx.get("fs")===undefined` 走 Node fs 回退）：

```
== ROOTS (rank ascending = higher priority) ==
  rank=100 source=project-dsh    path=/home/CNS2026495165/dsh/.dsh/skills
  rank=200 source=project-agents path=/home/CNS2026495165/dsh/.agents/skills
  rank=400 source=user-dsh       path=/home/CNS2026495165/.dsh/skills  [skipSystem]
  rank=500 source=user-agents    path=/home/CNS2026495165/.agents/skills

== CANDIDATES (4) ==
  rank=400 user-dsh name=grill-me         descLen=51
  rank=400 user-dsh name=ppt-master       descLen=534
  rank=400 user-dsh name=program-notebook descLen=125
  rank=400 user-dsh name=session-handoff  descLen=257

== LOAD (provider.get) ==
  grill-me:         OK invoc={"modelInvocable":false,"userInvocable":true} metadata=none bodyLen=2221
  ppt-master:       OK invoc={"modelInvocable":true,"userInvocable":true}  metadata={"version":"6.1.0",...} bodyLen=5567
  program-notebook: OK invoc={"modelInvocable":true,"userInvocable":true}  metadata=none bodyLen=2383
  session-handoff:  OK invoc={"modelInvocable":true,"userInvocable":true}  metadata={"version":"1.0.1",...} bodyLen=2064

== PROVIDER WARNINGS (0) ==
```

`harness/run2.mjs`（真实 `SkillRegistry` + `dsh-scope` 的 `createScope`，跨层同名冲突）：

```
scoped view  : [["collide","scoped-user-filesystem-400","filesystem"]]
unscoped view: [["collide","global-bundled-office-600","dsh-office"]]
scoped get() : "filesystem-BODY"
after scope disposal, scoped view: [["collide","dsh-office"]]
```

⇒ 近层（preset 作用域）以 **layer** 决定性地压过远层（host 全局），**与 rank 无关**；同层内才由 rank 数值升序裁决。

---

## 3. 技能子系统差异（0.1.7 → 0.2.0）

| 维度 | 0.1.7-rc.2 | 0.2.0-rc.1 | 差异 |
|---|---|---|---|
| 发现路径 | project `.dsh/skills`(100) / `.agents/skills`(200)、custom(300)、`$DSH_HOME/skills`(400,skipSystem)、`~/.agents/skills`(500)、bundled `$DSH_BUNDLED_SKILL_DIR`(600) | 同 | **无** |
| 优先级/rank | `RUNTIME_RANK=250`、`BUNDLED_SKILL_RANK=600`；同层 rank 升序、跨层近者胜 | 同 | **无** |
| frontmatter 字段 | `name`(必填,kebab)、`description`(必填)、`whenToUse`(选)、`disable-model-invocation`(选)、`user-invocable`(选)、`metadata`(选,原样透传)；旧驼峰键抛错 | 同 | **无** |
| `metadata.version` | 仅透传，不参与校验/排序/门控 | 同 | **无** |
| 加载与缓存 | revision + 128 条 LRU + 最多 2 次重试；watcher 失效 + `fs/observed` 写后失效 | 同 | **无** |
| 技能注册表/清单 | `SkillRegistry`（Service seam，provider registry + 分层）；无"技能清单文件"机制 | 同 | **无（两版都没有清单文件机制）** |
| 组合装配 | base 挂 skill/skill-filesystem/skill-badge(off)/tool-skill；web-app 关掉 host skill-filesystem/tool-skill，preset 各挂一份 | 同 | **无**（base 仅新增 `otel` 行） |
| `dsh-agent-preset/skills` | 3 个技能目录 | **4 个**（新增 `skills/agent-experience/SKILL.md`；另新增 `cordis-plugin-development/references/user-actions.md`） | **有**——但仅在 `cordis` preset（有 `customSkillDirs`）下可见；`standard`/本机 `standard-glm` 均不设 `customSkillDirs` ⇒ 本部署**不可见** |
| `dsh-skill-office` 装配 | `dsh-sdk-app` 唯一行，受 env 门控 | **逐字节相同** | **无** |

### 3.1 附：从现役 0.1.1-rc.2 直接跳 0.2.0 的技能面增量（供协调者判断口径）

现役 3080 是 `0.1.1-rc.2`。若以它（而非 0.1.7）为基线，技能面**确实有**微小改动（当轮安装树逐行 diff）：

| 包 | 0.1.1 → 0.2.0 变更行数 | 实质 |
|---|---|---|
| `dsh-skill` | 5 | `assertNever` 的 import 从 `dsh-llm` 改为 `dsh-util-values`；`toSummary()` 增加 `path` 透出 |
| `dsh-skill-filesystem` | 28 | 技能定义/摘要的 `path` 改为 **`realpath` 解析后的路径**（新增 `realpath` import；`readSkillText` 返回值改为 `{path, content}`） |
| `dsh-tool-skill` | 43 | `skill` 工具描述措辞；step 决策由 `{kind:"enter", ...}` 改为 `{...decision, ...}`（属 agent-loop 协议面，非技能格式面） |
| `dsh-client-ui-skill` | 0 | 无 |
| `dsh-skill-badge` | 0（逐字节同） | 无 |

**无一项触及发现路径、rank、frontmatter 必填字段**。

---

## 4. `dsh-skill-office` 定位结论

**它是什么**：官方自带的"办公文档技能提供者"插件（Cordis plugin，`name="skill-office"`, `inject=["skills"]`），向 `ctx.skills` 注册 **3 个 bundled 技能**：`office-docx` / `office-pptx` / `office-xlsx`（`lib/index.js:11–15`）。每个技能 = 一段 `SKILL.md` 指令 + 共享的纯标准库 Python 结构校验器 `assets/scripts/check_office.py`（`import` 仅 `argparse/json/posixpath/sys/zipfile/zlib/pathlib/urllib/xml.etree`，实测无第三方依赖）。渲染/转 PDF 走可选依赖 `@deepseek-ai/libreoffice-kit`（`package.json` deps）。

**它与本机「办公入口/office-handoff」的关系：互补、无交集，不是替代。**

| | `dsh-skill-office`（官方包） | `dsh-office-handoff`（本机自建） |
|---|---|---|
| 形态 | DSH 技能提供者插件（`ctx.skills.registerProvider`） | 桌面接收器 CLI，`~/.local/bin/dsh-office-handoff` → `~/.local/lib/dsh-office-handoff/bin/…`；文档 `.iso/lock-rework-20260928-104937/README.md` 自述"零插件" |
| 职责 | 生成/编辑/校验 DOCX、PPTX、XLSX（内容创作 + OOXML 结构检查） | Nautilus 右键把选中文件**复制**进目标目录，并 `POST /api/workspace.create` 登记为 DSH 工作区；journal + 受限回滚 |
| 面向 | 模型（技能指令） | 用户桌面（右键菜单 + zenity 确认） |
| 状态 | **未挂载**（本机两版 profile 都不含 `dsh-sdk-app` bundle） | 已安装（`~/.local/lib/dsh-office-handoff`、符号链接均在；状态根 `~/.dsh/office-handoff/{journal,journal.secret}` 存在） |
| 交叉 | 无。office-handoff 不做文档创作/校验；skill-office 不做投递/工作区登记 | 同 |

**判定**：既非"官方内置替代本机自建能力"，也非"必须二选一"。若将来要启用官方 office 技能，需要的是**新增挂载 + 补齐运行时**（见 §8），与本机 office-handoff 并存无冲突；且官方 office 技能默认工作流依赖 `load_workspace_dependencies` 工具（`office-pptx/SKILL.md:8`），该工具由 `@deepseek-ai/dsh-tool-workspace-dependencies` 提供、**同样只在 `dsh-sdk-app` bundle 中挂载**（`x/sdkapp-0.2.0-rc.1/package/cordis.patch.yml:30–34`），本机 profile 未挂 → 直接照搬挂载会得到"技能可加载但默认流程的第一步不可用"。

---

## 5. 本机技能可加载性逐条核对

发现路径实测（`harness/run.mjs`）：`~/.dsh/skills` 以 `source=user-dsh, rank=400, skipSystem=true` 命中；`~/.agents/skills` 根存在但空；仓库项目根（`/home/CNS2026495165/dsh`，含 `.git`）下的 `.dsh/skills` 与 `.agents/skills` **均不存在**；仓库内 `agent-skills/`（分发快照）**不在任何发现路径中**（`roots()` L150–188 无此项），故其对 DSH 不可见。

| # | 技能 | 文件 | `name` 合法(kebab) | `description` 非空 | 旧驼峰键 | 加载结果 | 备注 |
|---|---|---|---|---|---|---|---|
| 1 | `session-handoff` | `~/.dsh/skills/session-handoff/SKILL.md` | ✅ | ✅ 257 字符 | 无 | ✅ OK | `metadata.version="1.0.1"` 保留 |
| 2 | `program-notebook` | `~/.dsh/skills/program-notebook/SKILL.md` | ✅ | ✅ 125 字符 | 无 | ✅ OK | 顶层 `license: MIT` 被忽略（非解析字段） |
| 3 | `ppt-master` | `~/.dsh/skills/ppt-master/SKILL.md` | ✅ | ✅ **534 字符** | 无 | ✅ OK | `metadata.version="6.1.0"` 保留；顶层 `AIGC:` 块被忽略但 YAML 解析正常；**description 超 500 → catalog 行被截断**（见 §8 可选加固） |
| 4 | `grill-me` | `~/.dsh/skills/grill-me/SKILL.md` | ✅ | ✅ 51 字符 | 无 | ✅ OK | `disable-model-invocation: true` → `modelInvocable:false, userInvocable:true`（用户 `/grill-me` 可用、模型不可自动加载） |

**结论**：4/4 全部被正确发现与加载，**0 条 provider 警告**，无需任何 frontmatter 修正。0.2.0 相对 0.1.7 **没有**新增必填字段、**没有**收紧 YAML 解析（`parseFrontmatter`/`parseInvocationPolicy`/`stringField` 逐字节相同），因此"若 0.1.7 上能加载，0.2.0 上必然能加载"具备源码级充分性。

插件侧技能（不在 `~/.dsh/skills`）：`@local/dsh-pptmaster` 用 `ctx.skills.registerProvider()` 注册 `ppt-design-systems`（+ 风格子技能）/ `ppt-template-fidelity` / `workbuddy-ppt`（`lib/index.js:192` 等 3 处注册；`skills/` 下只有这 3 个目录）。**它不提供 `ppt-master`**，因此 `ppt-master` 只来自 `~/.dsh/skills/ppt-master`，二者不冲突。该插件 `import { BUNDLED_SKILL_RANK } from "@deepseek-ai/dsh-skill"`，0.2.0 的导出清单（`dsh-skill/lib/index.js:566`）与 0.1.1/0.1.7 **完全一致**，导入面不会断（peer 版本号写的是 `^0.1.1-rc.2`，只是声明不匹配，运行时解析到 0.2.0 的同一符号）。

---

## 6. 技能与插件的职责边界变化

**0.1.7 → 0.2.0 在技能/插件边界上没有发生任何迁移。** 逐项核对：

1. **没有任何原本由插件提供的能力被挪到技能层**：base bundle 的 row-id 差集只有 `otel`；web-app bundle 仅删除 schedule 相关行（`time-context` / `schedule` / `ui-schedule`），这三行是"排程能力改由新依赖 `dsh-experimental-schedule-bundle` 提供"的**宿主插件重组**，与技能层无关；preset 的技能行两版逐字相同。
2. **也没有任何技能层能力被挪到插件层**。
3. **新增了一处"官方内置技能"，但不落入本部署可见面**：`dsh-agent-preset@0.2.0` 新增 `skills/agent-experience/SKILL.md`（内容为"面向模型的工具定义与技能设计准则"）。它只能通过 `customSkillDirs` 被访问，而 `customSkillDirs` 只写在 `dsh-web-app/presets/cordis.patch.yml:143–147`；`standard` / `ptc` preset 不设，本机 `standard-glm` 也不设（`~/.dsh/.agent-presets/standard-glm/agent.cordis.yml:83–87` 为裸行，无 `config`）。⇒ 本部署的会话 catalog 不会出现 `agent-experience`（与当前 3097/3080 会话实际目录一致）。
4. **技能提供者接口面未变**：`SkillRegistry.registerProvider` / `register`、`SkillCandidate`/`SkillDefinition` 字段、`BUNDLED_SKILL_RANK` 导出，两版本逐字节相同 ⇒ 本机 9 个插件中任何调用 `ctx.skills.*` 的代码（实测仅 `@local/dsh-pptmaster`）在 0.2.0 上行为不变。
5. **`tool-skill` 的 step 决策形态变了**（`{kind:"enter",…}` → `{...decision,…}`，0.1.1→0.2.0），这是 agent-loop 协议面变化而非技能/插件边界变化；0.1.7→0.2.0 该项为零。

---

## 7. 冲突与遮蔽风险

### 7.1 裁决规则（两版本一致，源码级）

- **跨层：近层胜，与 rank 无关。** `dsh-skill/lib/index.js:108–118` 注释 + `L298–311` `merged.set()` 后层覆盖前层；`harness/run2.mjs` 实证：preset 作用域 provider（rank 400）压过 host 全局 provider（rank 600），`get()` 返回近层正文；scope 释放后自动回落到全局。
- **同层：rank 数值小者胜**，再比 `providerOrder`、`localOrder`（`L519–521`）；失败者打日志 `skill "X" from <source> ignored because a higher-priority skill already exists`（`L320`）。
- 因此本机用户技能的 rank 400 < 官方 bundled 600，**同层也稳赢**。

### 7.2 名字集比对（本机 vs 0.2.0 内置）

本机用户级：`grill-me`、`ppt-master`、`program-notebook`、`session-handoff`
本机插件提供：`ppt-design-systems`（+ 风格子技能）、`ppt-template-fidelity`、`workbuddy-ppt`
0.2.0 内置（全部来源）：`agent-experience`、`cordis-composition-reference`、`cordis-plugin-development`、`editing-cordis-compositions`（agent-preset，仅 cordis preset 可见）、`office-docx`、`office-pptx`、`office-xlsx`（skill-office，本部署未挂载）

**交集 = ∅** ⇒ 双向遮蔽风险均为 0，且 rank 机制两版本无变化 ⇒ **不存在"rank 变化导致本机技能被官方同名技能静默遮蔽"的高危情形**。

### 7.3 仍需提示的四条风险（R1 / R2 / R2b / R3；非"当前缺陷"，是迁移时的行为敏感点）

- **R1（最高，但现在已有明确证据与解法）：本机技能可见性依赖 agent preset 的 `skill-filesystem` 行；而现役 profile 的 preset 选择器在新版本上会静默失效。**
  - 事实：本地发现全部由 **preset 作用域**的 `skill-filesystem` 提供（host 那行被 web-app 关闭：0.2.0 为 `cordis.patch.yml:484–488`，0.1.7 为 `:481–485`）。preset 由 `agent-preset-registry`（0.1.7/0.2.0）／`agent-presets`（0.1.1）按 `config.default` 选定。
  - 现役 `~/.dsh/profiles/web/cordis.patch.yml:16` 写的是 `- id: agent-presets`（旧 id）。迁移到 0.1.7/0.2.0 后该 patch 条目**匹配不到任何行** ⇒ `config.default: standard-glm` 变成 no-op ⇒ 默认 preset 回落到 bundle 的 `standard`。
  - **对技能面的影响是有界且可判定的**：官方 `standard` preset 同样挂 `skill-filesystem` + `tool-skill`（`presets/standard.patch.yml:34–37`），**不设 `customSkillDirs`** ⇒ 本地 4 个技能**仍会被发现**，catalog 与 `standard-glm` 下**完全相同**。丢失的是 `standard-glm` 的核心用途（`subagent`/`subagent_fork` 的 `provider=adam, model=deepseek-v4.1-flash` 固定），**不是技能**。
  - 仅当被选中的 preset 是 `minimal` 时本地技能才会**全部消失**：`presets/minimal.patch.yml` 全文 61 行、`grep -c skill` = **0**（无任何技能行）。默认值不是 `minimal`，故这是"被误配才会发生"的次生风险。
  - **解法**：迁移时 `~/.dsh-017/profiles/web/cordis.patch.yml` 已经是修正版（`:16` 即为 `agent-preset-registry`），以它为准。
- **R2：`DSH_HOME` 变化会整体搬走用户技能根。** `roots()` L172 用 `join(this.dshHome, "skills")`，`dshHome` 经 `resolveDshHome()`（`DSH_HOME` 环境变量优先）。新迁移根若使用独立 `DSH_HOME`，必须把 `~/.dsh/skills/{grill-me,ppt-master,program-notebook,session-handoff}` 就位到 `<新根>/skills`（`~/.dsh-017/skills` 已有同样的 4 份副本，可作参照）。这是**文件搬运**问题，不是格式问题。
- **R2b：`@local/dsh-btw` 用硬编码路径读 `grill-me`。** `lib/index.js:1175–1189` 的 `loadGrillMeText()` 直接读 `join(process.env.DSH_HOME ?? ~/.dsh, "skills", "grill-me", "SKILL.md")`，并用 `/^---\n[\s\S]*?\n---\n?/` 去 frontmatter 后内联进侧聊 persona；文件缺失时 `catch` 静默返回 `undefined`，**降级为无 grill-me 的 persona，不报错**。⇒ 若 R2 未处理，btw 侧聊会"静默少一段行为"，且它在技能注册表之外**不产生任何 catalog 警告**。
- **R3：若把 `dsh-skill-office` 挂到 host 全局层，不会遮蔽本地技能**（跨层近者胜，§7.1 实证）；但会对同名者产生**反向**遮蔽：本地技能会盖住官方技能。当前名单无重合，实际风险 0。

---

## 8. 最小修正清单

### 8.1 技能格式/代码修正：**0 项**

本机 4 个技能无需改动：无新增必填字段、无需补 `metadata.version`、无旧驼峰 invocation 键、YAML 全部可解析。0.2.0 的技能解析代码与 0.1.7 逐字节相同，无"更严的 YAML 解析"这一情形（该解析严格性在 0.1.1 时就已存在，见 §3.1）。

### 8.2 部署动作（迁移时必须做，与本轨道强相关）

| # | 动作 | 依据 | 验收 |
|---|---|---|---|
| D1 | 把 `~/.dsh/skills/{grill-me,ppt-master,program-notebook,session-handoff}` 就位到新 `DSH_HOME/skills`（复制或软链） | `dsh-skill-filesystem/lib/index.js:172`（`join(dshHome,"skills")`）+ `dsh-home-paths` L73–76 | 新根会话 catalog 出现这 4 个技能名；`@local/dsh-btw` 侧聊 persona 仍含 `<grill-me>` 段（否则静默降级，见 R2b） |
| D2 | 把 `~/.dsh/.agent-presets/standard-glm/{agent.cordis.yml,preset.yml}` 就位到新 `DSH_HOME/.agent-presets/standard-glm/` | `web-app/presets/*.patch.yml:34–37` | 新会话的技能目录 = 本地 4 + 插件 3，且不含 `agent-experience`/`cordis-*` |
| D3 | **修正 profile patch 的 preset 选择器 id**：以 `~/.dsh-017/profiles/web/cordis.patch.yml:16` 的 `- id: agent-preset-registry  config.default: standard-glm` 为准；**不要**照抄现役 `~/.dsh` 的 `- id: agent-presets`（旧 id，在 0.1.7/0.2.0 上不命中，会让 `default` 回落到 `standard`） | §2.2b（0.1.1 `agent-presets` vs 0.1.7/0.2.0 `agent-preset-registry`） | 新根会话的 preset 确为 `standard-glm`（子代理固定 `adam/deepseek-v4.1-flash`）。**注意**：即使该项漏做，本地技能仍会发现（官方 `standard` preset 同样挂 `skill-filesystem`）——技能面无损失，损失在子代理路由 |
| D4 | **不要**在新 profile 的 `bundles` 里加入 `@deepseek-ai/dsh-sdk-app`（除非确实要做 SDK/桌面形态） | `sdk-app/cordis.patch.yml:36–41` 的 `skill-office` 行依赖 `DSH_PRIMARY_RUNTIME` 与 `<PRIMARY_RUNTIME>/../office-skills` 目录布局 | profile bundles 仍为 `[dsh-base, dsh-web-app]`；catalog 不出现 `office-*` |

### 8.3 可选加固（非阻塞，均为"要不要"而非"必须"）

| # | 项 | 依据 | 说明 |
|---|---|---|---|
| O1 | 若决定启用官方 Office 技能：需**同时**挂 `dsh-skill-office` 与 `dsh-tool-workspace-dependencies`，并保证 `@deepseek-ai/libreoffice-kit` 已装且 `lib/cli.js` 存在，或显式 `cli: false` | `skill-office/lib/index.js:43`（node/cli 非"绝对路径且存在文件"即抛错）、`:57`（`assetRoot` 缺 `scripts/check_office.py` 即抛错）；`assets/office-pptx/SKILL.md:8,70` | 若只挂 skill-office 而不满足上述任一条件，**插件激活即抛错**（不是静默降级）。本机现状：`libreoffice-kit` 未安装、`soffice` 不在 PATH、`python3` 有 `docx 1.2.0` 但 **缺 `python-pptx` 与 `openpyxl`** ⇒ 官方 office-pptx 默认流程（`python-pptx`）与 office-xlsx 默认流程当前不可用，只有纯结构校验器可用（纯标准库） |
| O2 | 保持 `~/.dsh/skills` 下不出现官方保留名（`office-docx`/`office-pptx`/`office-xlsx`/`agent-experience`/`cordis-*`） | §7.1 | 避免将来挂载官方行时产生"ignored because a higher-priority skill already exists"日志噪音与语义歧义 |
| O3 | 可把 `ppt-master` 的 `description` 压到 ≤500 字符 | `dsh-tool-skill/lib/index.js:40, 359–362` | 当前 534 字符，catalog 行会被截断为 500 + `...`。**这是 0.1.1 起既有行为、0.2.0 不变**，不属迁移回归；仅影响"模型能否从目录行读到完整触发条件" |

---

## 9. 未验证项

1. **未在真实 0.2.0 进程内验证**（硬约束：不启动服务、不发起模型请求）。技能目录装配结论来自**静态源码 + 独立 harness**（`harness/run.mjs`、`run2.mjs`，用真实 0.2.0 包代码 + 真实本机技能根，但宿主是裸 Node 而非 DSH 进程）。故第 7.3 节 R1（preset 缺失时的实际回落行为）未在运行态复现。
2. **未验证 0.2.0 全量依赖闭包中是否还有未被点名的技能提供者**。本轮只审计了 CLI `dependencies` 中点名含 `skill` 的包（`dsh-skill` / `dsh-skill-filesystem` / `dsh-skill-office` / `dsh-tool-skill`，`dsh-skill-badge` 由 `dsh-base` 引入）+ `dsh-base`/`dsh-web-app`/`dsh-agent-preset`/`dsh-sdk-app`/`dsh-client-ui-skill` 五个组合面；未做全闭包穷举（未执行 `npm i`）。
3. **未安装验证 `@deepseek-ai/libreoffice-kit`**：其 `lib/cli.js` 是否真能在此机器上渲染（依赖系统 LibreOffice 与否）未验证；`soffice`/`libreoffice` 不在 PATH 是当轮 `which` 的结果，不排除存在非 PATH 安装。
4. **未验证 `dsh-skill-office` 在被挂载后的运行态行为**（例如 `assetRoot` 指向 npm 包自带 `assets/` 而非 `<PRIMARY_RUNTIME>/../office-skills` 时是否成功）——只做了源码级失败条件判定。
5. **未验证 `DSH_AGENTS_HOME` 覆盖场景**：`~/.agents/skills` 在本机不存在，`agentsHome` 非默认时的行为仅由源码（`dsh-skill-filesystem/lib/index.js:78`）推断。
6. **未采样 3097（0.1.7）与 3080（0.1.1）运行实例的实际 catalog**（不触碰运行服务）；"0.1.7 上本地技能可见"由 0.1.7 与 0.2.0 代码逐字节相同 + 本机 `~/.dsh-017/skills` 内容相同推断，而非实测会话。
7. **未对 npm registry 全量包做穷举检索**，只对 `@deepseek-ai/dsh-skill*` / `dsh-tool-skill` / `dsh-client-ui-skill` / `dsh-sdk-app` / `dsh-base` / `dsh-web-app` / `dsh-agent-preset` 做了定点取证。
8. **未穷举本机 9 个插件的全部技能名**：仅对 9 个本地插件做 `grep skills.` 定位，命中者只有 `@local/dsh-pptmaster`（3 个 provider 注册点）+ `@local/dsh-btw`（提及 skill，未注册 provider）。若某插件通过字符串拼接等间接方式注册技能，本轮会漏检。
9. **harness 的依赖版本非 0.2.0 精确闭包**：`@deepseek-ai/cordis` 用现役树内 4.0.2（0.2.0 声明 `~4.0.4`）、`schemastery` 3.18.2（声明 `~3.18.4`）、`chokidar` 4.0.3、`yaml` 2.9.1；`dsh-skill`/`dsh-scope`/`dsh-util-values`/`dsh-home-paths` 用 0.2.0 原件。差异只可能影响 `Service`/`effect`/`filter` 语义，**不影响 frontmatter 解析与 rank 排序结论**（后者由纯函数与常量决定）。
10. **`dsh-tool-skill` 的 catalog 上限只做了静态判读**（`catalogDescriptionMaxLength` 默认 500），未实测超过 500 时的截断输出（截断算法简单且源码充分，风险低）。
11. **preset 注册表改名（§2.2b）只做了 id/包名/`config.default` 三项取证**：未验证 0.1.1 的 `@deepseek-ai/dsh-agent-presets` 与 0.1.7/0.2.0 的 `@deepseek-ai/dsh-agent-preset-registry` 在 preset 发现目录（`.agent-presets/`）、preset 文件 schema（`preset.yml` 的 `name/description/order`）上是否有其它差异；也未在运行态验证"patch 条目不命中时 `config.default` 的确切回落值"（该结论由 bundle 默认 `default: standard` 推出）。此三项请以 T02/T03 为准。
12. **未验证 `standard-glm` 与官方 `standard` preset 的技能面是否真的逐项等价**：结论基于两者 `skill-filesystem` 行均为"裸行、无 config"（`agent.cordis.yml:83–87` vs `presets/standard.patch.yml:34–37`）⇒ 两者默认根集合相同。未逐行 diff 两个 preset 的其它部分（非本轨道范围）。
