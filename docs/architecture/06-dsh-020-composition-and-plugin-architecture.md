# 06 · 0.2.0 组合与插件架构（patch 分层 · bundle/preset · settings 命名空间 · 技能发现 · 会话代际）

> **Tier 3 · 参考** · [指南地图](../../README.md) · [程序笔记本](../program-notebook.md) · [插件体系（0.1.1 基线）](02-plugin-system.md)
> **数据时点**：2026-09-30 ｜ **部署基线**：`@deepseek-ai/dsh` **0.2.0-rc.2**（隔离组合 `.workspace/audit-020/assembly-020/`）
> **证据根**（下文简写）：
> - `$A` = `.workspace/audit-020/assembly-020`（隔离组合根）
> - `$B` = `$A/prefix-cli-rc2/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai`（**0.2.0 官方件源码根**，288 个包）
> - 本文所有 `$B/...:行号` 均为**本轮实读**该目录下的**真件**；`[实跑]` 为当轮命令输出。
>
> **本页不包含**：0.1.1 现役体系的插件契约与热载矩阵（→ `02-plugin-system.md`，其基线为 2026-09-20 的 0.1.1-rc.2）、
> 逐插件的本地定制职责与 settings 面（→ `07-local-customization-inventory.md`）、
> 迁移门禁 N1/N10/N16/N17 的现状与报告索引（→ `../program-notebook.md` §5.6/§5.7）。

---

## 1. 归属表（谁拥有什么）

| 职责 | 归属 | 判据（可复判） |
| --- | --- | --- |
| 组合图**装配算法**（patch 分层、条目合并、peer 闸门） | 官方包 `@deepseek-ai/dsh-app-boot` | `$B/dsh-app-boot/lib/index.js:61`（`applyEntryPatches`）、`:1023`（`readProfilePatches`）、`:286`（`evaluatePluginCompatibility`） |
| **bundle 层** | 各包自带 `dsh.bundle.patch` | `$B/dsh-base/package.json` 的 `dsh.bundle.patch = "./cordis.patch.yml"` |
| **profile 层**（用户 patch） | `$A/home/profiles/web/cordis.patch.yml` | `$B/dsh-app-boot/lib/index.js:487`（`PROFILE_PATCH_FILENAME = "cordis.patch.yml"`） |
| **settings 面**（表单/读写） | 官方包 `@deepseek-ai/dsh-settings` | `$B/dsh-settings/lib/index.js:418-419`（`describe`）、`:505-506`（`write`） |
| **技能发现** | 官方包 `@deepseek-ai/dsh-skill-filesystem`；合并去重在 `@deepseek-ai/dsh-skill` | `$B/dsh-skill-filesystem/lib/index.js:21-25`（rank 常量）、`:150-188`（`roots()`）；`$B/dsh-skill/lib/index.js:319-323`（同名冲突 warn） |
| **会话格式与迁移链** | `dsh-session-format` + `-catalog` + 四个 `-vN-to-vN+1` 包 | `$B/dsh-session-format-catalog/lib/index.js:4-7`（四个编解码器导入） |
| 本地定制插件（`@local/*`） | 本仓库源码 + `$A/home/profiles/node_modules/` | 见 `07-local-customization-inventory.md` |

判据（可复判）：移除本页后，读者仍能从 `02-plugin-system.md` 知道 0.1.1 基线的插件契约，
但**无法**知道 0.2.0 的「bundle/preset 从哪来、命名空间怎么变成条目 id、技能根 rank 是多少、会话有哪几代」——后者是本页的独有职责。

---

## 2. 组合图：四层 patch 叠加

### 2.1 装配顺序

```
bundles 层（profile package.json 的 dsh.profile.bundles，按数组顺序逐个应用其 dsh.bundle.patch）
  → profile 自身层（<profileDir>/cordis.patch.yml，用户可编辑）
    → home 层（$DSH_HOME/cordis.patch.yml）
      → --patch overlays（命令行覆盖层）
```

`[实跑]` 隔离组合的 bundle 列表（`$A/home/profiles/web/package.json`）：

```json
{ "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"] } } }
```

- 默认 bundle 只有一个：`$B/dsh-app-boot/lib/index.js:543` `DEFAULT_PROFILE_BUNDLES = ["@deepseek-ai/dsh-base"]`。
- **可选 bundle**（`$B/dsh-app-boot/lib/index.js:552-557` `OPTIONAL_BUNDLES`，4 项）：
  `dsh-experimental-agent-team-profile` / `dsh-experimental-voice-input-bundle` /
  `dsh-experimental-auto-review` / `dsh-experimental-schedule-bundle`。
  0.1.7→0.2.0 的 bundle 层唯一一行差异就是本数组**新增了 `dsh-experimental-schedule-bundle`**（依据 `reports/T06-official-patch-layer-020.md` §1 的逐文件 `cmp`）——即**自动化任务在 0.2.0 降级为可选 bundle**。
- profile 根文件 `cordis.yml` 的语义是**空条目表**，组装全部来自 patch 层（`$A/home/profiles/web/cordis.yml` 原文头注："an empty entry list. The tree is composed as patches"）。

### 2.2 `dsh.bundle.patch` 可以由多个文件组成

- `$B/dsh-base/package.json`：`dsh.bundle.patch = "./cordis.patch.yml"`（**单文件**）。
- `$B/dsh-web-app/package.json`：`dsh.bundle.patch` 是**数组**，按序为
  `["./cordis.patch.yml", "./presets/standard.patch.yml", "./presets/ptc.patch.yml", "./presets/minimal.patch.yml", "./presets/cordis.patch.yml"]`。
  ⇒ **preset 是 bundle 层的一种形态**，不是另一套机制；`standard` / `ptc` / `minimal` / `cordis` 四个 agent preset 由 web-app bundle 一并铺下。

### 2.3 `cordis.patch.yml` 的条目语义（四类）

| 条目形态 | 语义 | 本组合实例（`$A/home/profiles/web/cordis.patch.yml`） |
| --- | --- | --- |
| `- insert: [{id, name, config?}]` | 新增插件到组合图 | `:8-9` `id: vision-adam` / `name: '@deepseek-ai/dsh-vision-adam'` |
| `- id: X` + `config:` | 对已有条目做 **id 级配置覆盖** | `:335-338` `- id: agent-default-model` + `provider: adam` / `model: deepseek-v4-pro` |
| `- id: X` + `disabled: true` | 停用某条目 | 官方件内先例：`$B/dsh-web-app/cordis.patch.yml:405`、`:409`（`!!js process.platform === 'win32'`） |
| `!!js <expr>` | 配置值可含 JS 表达式 | `$A/.../cordis.patch.yml:88` `root: !!js dshHomePath('office-ppt')` |

**两条硬约束**（承接 `02-plugin-system.md` §4.2，0.2.0 未变）：

1. `insert` 的 `name` 必须是 **bare 包名**——用文件路径名会 import 失败并**整次回滚**。
2. `config` 是**整体替换而非深合并**（`reports/T06-official-patch-layer-020.md` §2 语义要点）：覆盖某行必须**复述该行拥有的全部键**。

**默认端口陷阱**：`$B/dsh-web-app/cordis.patch.yml:174` 是 `port: !!js ctx.webStartup.port ?? 3080`
⇒ **组合默认端口 = 3080 = 现役端口**。启动 0.2.0 实例**必须显式传 `--port`**，否则会与现役冲突。

---

## 3. peer 闸门与 `compatibility.json`（0.2.0 的静默陷阱）

机制（`$B/dsh-app-boot/lib/index.js`）：

- `:286` `evaluatePluginCompatibility(manifest, exemptions, runtimeVersion)`
- `:359` `readProfileCompatibility(profileDir)`
- 命中后**只打一条 stderr `disabling profile plugin row` 并给该行加 `disabled`**，不中止启动。

豁免文件 = `<profileDir>/compatibility.json`，形如 `"<name>@<version>": ["<精确 DSH 版本>", ...]`（`$B/dsh-app-boot` 的 `PROFILE_COMPATIBILITY_FILENAME`）。
`[实跑]` 本组合当前 6 条豁免（`$A/home/profiles/web/compatibility.json`，全部值 = `"0.2.0-rc.2"`）：
`@deepseek-ai/dsh-taste@0.1.0` / `@deepseek-ai/dsh-vision-adam@0.2.0` / `dsh-workspace-enhancement@0.1.2` /
`@local/dsh-pptmaster@0.1.0` / `@local/dsh-web-search-sse@0.1.0` / `@local/dsh-workerspace@0.1.0`。

**铁律**：豁免值与运行时版本做 `includes` 精确比对，**不接受 semver 范围**；
内核版本一改（rc.1→rc.2）就必须同步改这里，否则原本豁免的条目会被**重新静默禁用**
（实测 rc.2 冷启动出现 10 条 `disabling profile plugin row`，改值后归 0 —— 见 `../program-notebook.md` §7 D35）。

---

## 4. settings：命名空间 = profile 条目 id

### 4.1 与 0.1.1 的断层

0.1.7 起删除 `installSettingsSection` / `settingsNamespace`；0.2.0 的替换机制是
**「profile 条目 id」即命名空间 + 插件导出 `Config` 自动生成表单**（依据 `reports/PLAN-A-DONE.md`；`$B/dsh-settings` 在 0.1.7↔0.2.0 逐字节相同，故断层发生在 0.1.1→0.1.7）。
⇒ 具名导入这两个符号的插件在 **ESM 链接期**就失败，整行不加载（不是运行期报错）。

`[实跑]` 本组合的命名空间取值与条目 id 一一对应：
`$A/.../cordis.patch.yml:121-122` `id: subagent-model` ↔ 插件内 `ENTRY_ID = "subagent-model"`；
`ssh-gui` / `workerspace` / `wallpaper` / `btw` / `usage` 同形（各插件 `lib/index.js` 内的 `ENTRY_ID` 字面量）。
读回通道：`ctx.get('settings').describe().find(r => r.ns === ENTRY_ID)?.value`
—— `SettingsDescriptor` 携带 `value` / `revision` / `applies:'live'`，**天然热生效**。

### 4.2 `.volatile()` 契约（设置面只暴露 volatile 字段）

| 断言 | 证据 |
| --- | --- |
| README 口径：表单**只**暴露 active、唯一寻址的 profile 条目的 **volatile** 字段 | `$B/dsh-settings/README.md:12`（"Forms expose only volatile fields…"） |
| `volatileForm(schema) === undefined` ⇒ 该条目**整条被跳过**，不进 served 命名空间 | `$B/dsh-settings/lib/index.js:418-419` |
| 写入侧同样拒绝：`Plugin entry "<ns>" has no volatile fields` | `$B/dsh-settings/lib/index.js:505-506` |
| 非 volatile 字段的写入被拒：`Config field "<path>" is not volatile` | `$B/dsh-settings/lib/index.js:507`、`:520` |
| 客户端在命名空间不在 view 里时把快照置 `status:"unavailable"` | `$B/dsh-client-ui-settings/lib/client.js:1226-1233` |

⇒ **用户可见症状**：设置页显示「设置命名空间未注册（…插件未加载？）」。
⇒ **修法**：把要暴露的字段标 `.volatile()`（本组合先例：`@local/dsh-subagent-model` 的 `provider`/`model`、
`@deepseek-ai/dsh-vision-adam` 的 `apiKeyEnv`/`baseURL`/`model`/`maxTokens`；官方同形参考 `$B/dsh-agent-default-model/lib/index.js:21-25`）。

### 4.3 `settings.yaml` 一次性导入

`$B/dsh-settings/README.md:33`：早期版本留下的 `<harness home>/settings.yaml` 在 Loader 稳定后**导入一次**，
逐段写入**同 id** 的条目，并在**首次写入前**改名为 `settings.yaml.imported`。
⇒ **投放次序不可反**：必须先备好 profile patch 层，再放 `settings.yaml`；否则段落在被拒绝的组合上会只留在改名后的文件里。

---

## 5. 技能子系统：发现根、rank 与遮蔽

发现由 `@deepseek-ai/dsh-skill-filesystem` 的 provider 完成（`$B/dsh-skill-filesystem/lib/index.js`）。

### 5.1 rank 常量与发现根

`$B/dsh-skill-filesystem/lib/index.js:21-25`：

| 常量 | 值 |
| --- | --- |
| `PROJECT_DSH_RANK` | 100 |
| `PROJECT_AGENTS_RANK` | 200 |
| `CUSTOM_RANK` | 300 |
| `USER_DSH_RANK` | 400 |
| `USER_AGENTS_RANK` | 500 |

`roots(cwd)`（`:150-188`）的装配顺序与门控：

| 根 | 路径 | source | rank | 门控 |
| --- | --- | --- | --- | --- |
| 项目 | `<projectRoot>/.dsh/skills` | `project-dsh` | 100 | `includeDefaultRoots && cwd !== undefined` |
| 项目 | `<projectRoot>/.agents/skills` | `project-agents` | 200 | 同上 |
| 自定义 | `config.customSkillDirs[]`（本组合未设） | `custom` | 300 | 无条件 |
| 用户 | `<dshHome>/skills`（= `$DSH_HOME/skills`） | `user-dsh` | 400 | `includeDefaultRoots`（带 `skipSystem: true`） |
| 用户 | `<agentsHome>/skills`（默认 `~/.agents/skills`） | `user-agents` | 500 | `includeDefaultRoots` |
| 插件 | `bundledSkillDir` / `ctx.skills.registerProvider` | `bundled` | `BUNDLED_SKILL_RANK` | 仅当 `bundledSkillDir !== undefined`（带 `trustedHost: true`） |

⇒ **rank 数字越小越优先**；用户根**与 cwd 无关**，对所有工作区生效。

### 5.2 遮蔽规则（不要在两处放同名 skill）

`$B/dsh-skill/lib/index.js:319-323`：同名 skill **只留高优先级那份**，被忽略者只打一条 warn
`skill "<name>" from <source> ignored because a higher-priority skill already exists`。
⇒ 在两处放同名 skill 会静默出现「改了全局那份但在本项目不生效」。
`[实跑]` 本轮用户级技能根已就位 5 个：`ppt-master` / `ppt-template-fidelity` / `program-notebook` / `session-handoff` / `workbuddy-ppt`
（`grill-me` 因 frontmatter `disable-model-invocation: true` 不进模型可见目录，属预期 —— 依据 `p0a/BRIEF.md` §2.3）。

> **[未验证]** `roots()` 的 `BUNDLED_SKILL_RANK` 具体数值本轮未实读（只确认常量名与 `:21-25` 的五个 rank 值）。
> **[未验证]** 软链目录在 0.2.0 发现逻辑下的可接受性未在本轮复测（0.1.1 侧结论「只接受 `type === "directory"` 或 `.md`」见 `02-plugin-system.md` §8 硬事实 2，**未在 0.2.0 复验**）。

---

## 6. 会话格式代际与迁移链 v0 → v4

### 6.1 代际与迁移包

`$B/dsh-session-format-catalog/lib/index.js:4-7` 导入四个编解码器 + 四个迁移步：

| 包 | 导入符号 | 作用 |
| --- | --- | --- |
| `dsh-session-format-v0-to-v1` | `releasedV0SessionFormatCodec` / `releasedV1SessionFormatCodec` / `sessionFormatV0ToV1` | v0 读 + v0→v1 |
| `dsh-session-format-v1-to-v2` | `releasedV2SessionFormatCodec` / `sessionFormatV1ToV2` | v2 读 + v1→v2 |
| `dsh-session-format-v2-to-v3` | `assertReleasedV3Header` / `releasedV3SessionFormatCodec` / `restoreReleasedV3Artifact` / `sessionFormatV2ToV3` | v3 header 断言 + 读 + 工件还原 + v2→v3 |
| `dsh-session-format-v3-to-v4` | `RELEASED_V3_EVENT_TYPES` / `assertReleasedV4Header` / `createSessionFormatV3ToV4` / `releasedV4SessionFormatCodec` / `restoreReleasedV4Artifact` | v3 事件类型清单 + v4 header 断言 + v3→v4 |

`[实跑]` `$B` 下确实存在且**仅存在**这四步包：`dsh-session-format-v0-to-v1` / `-v1-to-v2` / `-v2-to-v3` / `-v3-to-v4`（`ls -d $B/dsh-session-format-v*`）。
⇒ **0.2.0 支持 v0–v4，当前代际 = v4**；`dsh-session-format` 等包的 `lib/index.js` 在 0.1.7↔0.2.0 **逐字节相同**
（依据 `reports/T05-session-format-delta.md` §1.1）——**升级不引入新代际，也不引入新字段**。

### 6.2 代际选择算法（读侧）

`resolveGenerationInDirectory()` 把会话目录内所有规范名 `session[.vN].jsonl.zstd` 解析出代际号，
**按版本号降序取第一个**（`$B/dsh-session-persistence-jsonl/lib/index.js:3327-3357`，取最高在 `:3351`），
**不校验内容包含/父集关系**（依据 `reports/T05-session-format-delta.md` §1.1 第 2 条）。

> **[未验证]** 上述 `:3327-3357` 行号引自 `T05` 报告（该报告基线为 0.2.0-rc.1）；本轮**未逐行复读** 0.2.0-rc.2 的同一文件。

### 6.3 v0 打包行（`*-chunks`）：0.2.0 的 v0 codec **支持**，拒因在别处

`[源码]` 0.2.0 的 v0 codec **本来就解码打包行**：

| 断言 | 证据（`$B/dsh-session-format-v0-to-v1/lib/index.js`） |
| --- | --- |
| 打包 tag 清单 | `:1610-1614`（`PACKED_TAGS`） |
| `scanRows` 的 packed 分支 | `:1656-1690` |
| 解包函数（事件数 = 载荷长度） | `:1796-1808`（`decodePackedRun`，`eventCount = payload.length`） |
| 展开成 `assistant/chunk` | `:1809-1843`（`expandAssistantChunkRun`） |
| snapshot 形态要求 `sections` 是数组 | `:942-947`（`form === "snapshot"` ⇒ `sections` 必须是数组） |

⇒ **「三种顶层打包行是第二道硬闸」这一说法在本轮被证伪**（详见 `../program-notebook.md` §5.6.3 勘误 E1）。
真正的第二道闸是**插件消息来源缺 `sections` 数组**，出现在 v0 的三处消息位置：
`user/message.data.source`、`agent/inbox/spliced.data.inserted[].source`、带 `message` 包装的 `[].message.source`。

**为什么缺 `sections` 是「既有写入形态」而非数据损坏**：0.1.1 与 0.2.0 的 `dsh-taste/lib/learner.js` **逐字节相同**，
其 `:219` 即 `source: { kind: "plugin", plugin: "taste", form: "snapshot" }`（**无 sections**）——即 emit 侧至今这么写。
⇒ 修复取**最小结构补全** `sections: []`（不新增内容、不删字段、不改 `form`）。

`[实跑]` P0-A 全量基线（依据 `p0a/BRIEF.md` §2.1，工具落 `.workspace/audit-020/p0a/recon/scan-before.jsonl`）：
语料 **2508 份 `.zstd`**（v0 = 2505 / v3 = 3）＋ 3 个 `session.lock`；0.2.0 真实 catalog 下**可读 229 / 2508 = 9.1%**，拒因两类：
`subagent/descriptor` 版本 2 **2275 份**、`agent/inbox/spliced` 缺 `sections` **4 份**。
转换报告 `.workspace/audit-020/p0a/recon/convert-report.jsonl` 共 **2511** 条（log 2508 + copy 3），
`changed` 2281 条 = `R1:descriptor` 2275 + `R2:plugin`(sections) 456（同一条目可命中多个标签）。

### 6.4 新根不得混入未压缩 `.jsonl`

`$B/dsh-session-persistence-jsonl/lib/index.js:3429-3455`：混合布局会被整根判为 `legacyLayout` 并**拒绝**。
⇒ 迁移产出的新根**只能有 `.zstd`**（依据 `p0a/BRIEF.md` §2.1 的"注意"）。
`session.lock`（0 字节）**按字节复制，不重建、不删除**。

---

## 7. 未验证项（本页明确不声称）

1. `BUNDLED_SKILL_RANK` 的具体数值未实读（§5.1）。
2. 0.2.0 下软链 skill 目录的可接受性未复测（§5.2）。
3. `dsh-session-persistence-jsonl` 的代际选择行号引自 `T05`（0.2.0-rc.1 基线），**未在 rc.2 逐行复读**（§6.2）。
4. `releasedV4` 之外是否存在更高代际的**草稿**包（未发布）未检索；本文结论限于**已发布包集合**。
5. 本页未对 288 个官方包做逐包通读：凡引用 `$B/...:行号` 的断言均为**本轮直接打开该行**得到；
   凡引用 `reports/Txx` 的断言已在文中显式标注来源报告，**未二次复验**。

---

## 8. 维护触发条件

- **bundle / preset 列表变化**（`dsh.profile.bundles`、`dsh.bundle.patch` 数组、`OPTIONAL_BUNDLES`）→ 更新 §2。
- **patch 条目语义或合并规则变化**（深合并 / `!!js` / `insert` 名称解析）→ 更新 §2.3 与 `02-plugin-system.md` §4。
- **`compatibility.json` 语义或豁免比对方式变化** → 更新 §3 与 `../program-notebook.md` §7 D35。
- **settings 面的 volatile 契约或命名空间规则变化** → 更新 §4 与 `../program-notebook.md` §7 D34。
- **技能发现根 / rank / 遮蔽规则变化** → 更新 §5 与 `02-plugin-system.md` §8。
- **出现 v5 代际或迁移链增删** → 更新 §6 与 `../program-notebook.md` §5.6。
