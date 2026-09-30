# T06 — cordis patch 层在 0.2.0（0.2.0-rc.1）上的可用性审计

- 轨道：T06 / 阶段：审计（只读，未改任何产品代码与配置）
- 审计时间：2026-09-29（本轮实测）
- 审计对象：`~/.dsh/profiles/web/cordis.patch.yml`（现役 0.1.1）与
  `~/.dsh-017/profiles/web/cordis.patch.yml`（隔离 0.1.7）两份 patch 层 → 目标运行时 `@deepseek-ai/dsh` **0.2.0-rc.1**
- 写入范围：仅 `.workspace/audit-020/**`（报告 + 解析脚本 + 0.2.0 包样本）
- 未触碰：`~/.dsh/**`、`~/.dsh-017/**`、任何监听端口、任何模型请求

---

## 1. 结论摘要

1. **patch 机制在 0.1.7 → 0.2.0 之间没有变化**：`@deepseek-ai/dsh` CLI 的 `lib/**` 在 **0.1.1-rc.2 / 0.1.7-rc.2 / 0.2.0-rc.1 三版逐字节相同**（协调者硬基线 `MEASURED-BASELINE.md` §2，15 个文件 sha256 全等；本轨道独立复核了 0.1.7↔0.2.0 六个 boot 文件 `cmp` 全等），`@deepseek-ai/dsh-app-boot` 的 `applyEntryPatches`（THE patch 语义）逐字节相同，0.1.7→0.2.0 全文件只差 **一行**（`OPTIONAL_BUNDLES` 增加 `@deepseek-ai/dsh-experimental-schedule-bundle`）。
   ⇒ patch 层的**应用机制与层序在三版之间没有变化**，本报告 §3 的机制结论以此为唯一依据，不再追溯机制差异。
2. **但 0.1.1 → 0.2.0 有两处真实的行为变化，且都朝向"更安静"**：
   - 新增 **插件兼容性 preflight**：peer 与运行时不兼容的行会被**静默加上 `disabled: true`**，只在 stderr 打一行，**不阻断启动**（0.1.1 完全没有这套机制）。
   - boot 末尾的 **fail-loud 断言被替换为非致命审计**：0.1.1 是 `await assertEntriesActivated(...)`（任一 enabled 行未激活即抛错）；0.2.0 改成 `await auditStartupEntries(...)`，只有 bootstrap include 与 `requiredStartupEntryIds = {agent-loop, webserver, modules}` 才致命，其余只写 stderr。
3. **id 漂移只有 1 条**：0.1.1 层的 `- id: agent-presets` 在 0.2.0 不存在（官方在 0.1.7 已改名 `agent-preset-registry`）。0.1.7 层的 **27 条全部 id 目标在 0.2.0 组合中可解析，`name` 无一条漂移**（已用同一份 `applyEntryPatches` 算法逐条实测）。
4. **真正的风险不是 id 而是 peer**：把 0.1.7 层原样搬到 0.2.0，**7 条会被 preflight 静默 disable**（`vision-adam`、`taste`、`ssh-remote`、`ssh-web-channel`、`workerspace`、`dsh-pptmaster`、`web-search-sse`），另 1 条（`directory-picker-browse`）取决于是否装入 0.2.0 版包。
5. **另有 1 条"装了也不生效"的语义型静默失效**：`@local/dsh-subagent-model` 的消费侧是**本地改造过的 `dsh-tool-subagent`**（现役 0.1.1 安装体 695 行 vs 官方 pristine 0.1.1 的 296 行；0.1.7/0.2.0 官方包均无该读取点）。在全新 0.2.0 上只会出现一个无人消费的设置页。
6. **office 相关结论（修正 PLAN.md 的一处事实）**：`dsh-skill-office`、`dsh-tool-subagent-control`、`dsh-workflow-ptc` **不是 0.2.0 相对 0.1.7 的新增依赖** —— 三者同样出现在 0.1.7-rc.2 的 CLI `package.json`（第 65/86/94 行）；`office-to-pdf` 行在 0.1.7 的 web-app 层（第 263 行）也已存在。因此"0.2.0 官方已内置 office 能力、可直接退役本地 fork"**不成立**：0.2.0 的 base / web-app / 四个 preset 层里**没有任何一行挂载 `@deepseek-ai/dsh-skill-office`**（`grep` 全层零命中），官方组合默认不提供 office-pptx/docx/xlsx 技能。
7. 交付了**面向 0.2.0 的 patch 层草案** `T06-proposed-cordis.patch.020.yml`（16 条生效条目，全部经同一算法解析验证：0 warning），可直接作为迁移执行档输入。
8. **（二次校正轮，据协调者硬基线）** 以 `.workspace/audit-020/churn-lib-017-020.txt`（`lib/` 逐文件 sha256）为主判据复核后：草案引用的 **34 个 plugin specifier 中 27 个落在"`lib/` 逐字节相同"的 225 个包内**（目标必然仍在，无需读源码），**只有 1 个落在 55 个改动包内**（`@deepseek-ai/dsh-workflow-ptc`，已读 0.2.0 源码确认 `Config.provider` 仍在且默认即 `spawn`）；被 id 定向覆盖的 9 个官方行中，7 个的**承载配置的 `lib/index.js` 逐字节相同**。详见 §2.4。
9. **（二次校正轮新增发现）官方组合中有且仅有 3 个 id 在 0.1.7 → 0.2.0 之间消失**：`time-context` / `schedule` / `ui-schedule`（0.1.7 中三者均 `disabled: true`，且**现役 0.1.1 组合里根本没有这三行**），它们被搬进新包 `@deepseek-ai/dsh-experimental-schedule-bundle`（0.2.0 才进入 CLI 直接依赖，且列在 app-boot 的 `OPTIONAL_BUNDLES`）。两份本地 patch 层**都没有**条目指向这三个 id，故不构成既有条目的静默失效；但它意味着"**一行 patch 打开日程/自动化**"这个开关在 0.2.0 上失效，需按 §5.4 处理。新增 id 4 个（`otel` / `desktop-product-telemetry` / `product-analytics` / `ui-settings-session-log`）。

### 1.1 「静默失效」风险条目数

以 **0.1.7 层（27 条）** 为口径：**9 条**。

| 类别 | 条数 | 条目 |
|---|---|---|
| A. peer 不兼容 ⇒ preflight 静默 `disabled` | 7 | vision-adam / taste / ssh-remote / ssh-web-channel / workerspace / dsh-pptmaster / web-search-sse |
| B. 条件性 peer 风险（取决于装入的包版本） | 1 | directory-picker-browse |
| C. 装得上但无人消费（语义无效） | 1 | dsh-subagent-model |
| D. id 漂移 ⇒ warn 后丢弃 | 0（0.1.7 层）／**1**（0.1.1 层：`agent-presets`） | — |
| E. 因官方把行搬进可选 bundle 而失效 | **0** | 两份本地层都没有条目指向 `time-context` / `schedule` / `ui-schedule`（§5.4 是决策项，不是失效项） |

**二次校正轮（`lib/` 哈希判据）对该数字的影响**：不变（9 条），但**每条"目标是否仍存在"的确定性从"逐包读源码"提升为"27/28 个包由 `lib/` 逐字节相同直接推定、1 个包源码实读"**（§2.4）。

---

## 2. 证据（本轮实测）

### 2.1 输入件与哈希

| 件 | 路径 | sha256（本轮实测） |
|---|---|---|
| 现役 patch 层（123 行） | `~/.dsh/profiles/web/cordis.patch.yml` | `513413e7cffb319149a7be2bbab829e898e59c9d626909e33869429794487471` |
| 隔离 patch 层（635 行） | `~/.dsh-017/profiles/web/cordis.patch.yml` | `61adb8ae5758c12e466e3f08744fb4d7e38a95ec79a427ab3f5c4aa0dd036524` |
| 0.2.0 bundle 包 | `.workspace/audit-020/pkg020/deepseek-ai-dsh-base-0.2.0-rc.1.tgz` | `664cf31c422dc9cc8337fe908153341a9505ee8d3a6f399e945554e51bb050c6` |
| 0.2.0 web-app 包 | `.workspace/audit-020/pkg020/deepseek-ai-dsh-web-app-0.2.0-rc.1.tgz` | `430cb785d6a800a6112a3b57d916d6450d90bb94134af19b3394ecd5a9b2e3f7` |
| 0.2.0 base 层 | `pkg020/base/package/cordis.patch.yml`（529 行） | `9c2be64f46a193eff3cca190c26e697e8e8eee25c9b40149dfdb56f8142c252d` |
| 0.2.0 web-app 层 | `pkg020/webapp/package/cordis.patch.yml`（565 行） | `df7653ee4c324dca706034631926c86f13a2cf17c280cc018f8c070a0aaad19e` |
| 0.2.0 preset 层 | `pkg020/webapp/package/presets/{standard,ptc,minimal,cordis}.patch.yml` | `6cd2f197…` / `8fcf6b04…` / `71ef887f…` / `b74d7190…` |
| app-boot 0.1.7-rc.2 | 下载样本 `x017-appboot/package/lib/index.js` | `43dccddf285e7a0262d8ab3794f0fd65912e0dc33178dd782bcd8e87745ecfc2` |
| app-boot 0.2.0-rc.1 | `x-deepseek-ai-dsh-app-boot-0.2.0-rc.1/package/lib/index.js` | `234db45e1b3f8c683b5bc1f551948b2a2ec52a6468c7b6937725a23f1c0e0d96` |
| app-boot 0.1.1-rc.2 | `x-deepseek-ai-dsh-app-boot-0.1.1-rc.2/package/lib/index.js` | `9d4b7f214cd35b3e8ce4e027b12cca34a416d355577aeacbf08a5b324f0cabb6` |

复核基线（现役/隔离安装树，只读）：
- 0.1.1 bundle：`~/.dsh/profiles/node_modules/@deepseek-ai/{dsh-base,dsh-web-app}/cordis.patch.yml`（dsh-base 451 行 / web-app 445 行，均标 `0.1.1-rc.2`；web-app **无 presets/**）。
- 0.1.7 bundle：`~/.npm-global-dsh017/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/{dsh-base,dsh-web-app}/`（528 / 562 行，均标 `0.1.7-rc.2`；web-app **有 presets/**，且 `dsh.bundle.patch` 已声明 5 个 patch 文件）。

### 2.2 本轮执行的验证（脚本落在 `.workspace/audit-020/tools/`）

| 脚本 | 作用 |
|---|---|
| `dump_patch.py` | 解析 patch 层（保留 `!!js` 表达式原文），逐条打印 `insert` / `id` 定向覆盖 |
| `resolve.py` | **忠实复刻** `applyEntryPatches`（含 id 索引 last-write-wins、`name` 守卫、warn-and-skip），把官方 bundle 层 + profile patch 组合成最终条目表并输出跳过的 patch |
| `table.py` | 对每个被 patch 定向的 id，横向打印其在 0.1.1 / 0.1.7 / 0.2.0 三层组合中的 `name` / `disabled` / config 键 |
| `peercheck.mjs` / `peercheck2.mjs` | 用真实 `semver@7.8.5` 复刻 `evaluatePluginCompatibility`（`includePrerelease: true`），逐个本地插件判定在 0.2.0-rc.1 下是否会被 preflight 拒绝 |
| `gen_draft2.py` | 用**文本手术**（非 YAML round-trip）生成 0.2.0 草案，保全 `!!js` 与块标量原文 |

关键实测输出（摘要）：

```
# 0.2.0 官方组合（base + web-app + 4 presets）= 183 条顶层行 / 183 个不同 id
# 0.1.1 profile patch 打到 0.2.0 上：
  [id-not-found] patch: entry 'agent-presets' not found
# 0.1.7 profile patch 打到 0.2.0 上：
  (none: every id-targeted entry resolved)
# T06 草案打到 0.2.0 上：
  (none: every id-targeted entry resolved)   # 190 条顶层行 / 190 个 id / 0 warning
```

### 2.3 源码级证据（file:line）

- patch 语义：`x-deepseek-ai-dsh-app-boot-0.2.0-rc.1/package/lib/index.js:61`（`function applyEntryPatches`）；未知 id → `warn("patch: entry %C not found", id)` 后 `continue`（同文件 97 行）；`name` 不符 → 101 行 warn 后跳过；覆盖是 `target[key] = value`（106-109 行）⇒ **`config` 整体替换**。
- `!!js`：同文件 20 行 `JsExpr = new yaml.Type("tag:yaml.org,2002:js", {construct: d => ({__jsExpr: d})})`；`userPatchesSchema = entryListSchema`（3460 行）；`parsePatchList` 用该 schema 解析（3562 行）。
- `dshHomePath` 在表达式作用域内：同文件 `boot()` 内 `ctx.provide("dshHomePath", dshHomePath)`（4075 行附近）。
- 层序：`readProfilePatches`（1023-1039 行）= bundle 层 → profile 层 → `$DSH_HOME/cordis.patch.yml` → `--patch` → telemetry。
- 组合折叠成**一个 insert**：`prepareProfilePatches`（2150 行）→ `[{insert: rows}]`；`mountRootInclude`（3691 行）把 `cordis.yml`（内容恒为 `[]`）作为 `cordis:include` 挂载。
- 兼容性 preflight：`preflight`（2051 行起）/`prepareProfileEntries`（2047 行）/`evaluatePluginCompatibility`（286 行）/`readProfileCompatibility`（359 行，文件名常量 `compatibility.json`，328 行）；被拒绝的行 `row.disabled = true` 并 `process.stderr.write('dsh: disabling profile plugin …')`。
- 失败语义差异：0.1.1 `boot()` 末尾 `await assertEntriesActivated(ctx, binName)`（`x-deepseek-ai-dsh-app-boot-0.1.1-rc.2/…:1179`，其实现 1107-1145 行：任一 enabled 行未激活即 throw）；0.2.0 `boot()` 末尾 `await auditStartupEntries(ctx, binName)`（4086 行），`requiredStartupEntryIds = {agent-loop, webserver, modules}`（3836-3839 行）。
- 本地改造证据：现役 `~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tool-subagent/lib/index.js` 695 行，含 `settings.get("dsh-subagent")`（123 行）；官方 pristine `@deepseek-ai/dsh-tool-subagent@0.1.1-rc.2` 296 行、**无**该读取；0.1.7-rc.2 与 0.2.0-rc.1 官方包亦无（`grep -c dsh-subagent` = 1，仅包名残留）。
- 官方 SSE 缺口仍在：`@deepseek-ai/dsh-web-search-deepseek@0.2.0-rc.1` 第 153/163 行仍是**无条件 `await response.json()`**（local fork 的存在理由在 0.2.0 依然成立）。
- 官方默认不挂载 office 技能：`grep -rn "office\|skill-office" base/package/cordis.patch.yml webapp/package/cordis.patch.yml webapp/package/presets/*.patch.yml` 仅命中 `office-to-pdf`（web-app 269-270 行），**无 `skill-office` 行**。

---

### 2.4 目标存在性的判据分层（据 `churn-lib-017-020.txt`，`lib/` 口径）

判据规则（协调者硬基线 §4）：`lib/` 逐文件 sha256 对比给出 225/280 个包**代码逐字节相同**、55 个包有真实改动。
⇒ **不在 55 名单内的包，其内部 id/导出/注册点/Config schema 必然未变**，无需读源码；只有落在名单内的目标才需要 0.2.0 源码实读。

### 2.4.1 patch 引用的 plugin specifier → 包级判据映射

| 层 | 不同 specifier 总数 | `lib 全等`（推定） | `CHANGED`（需源码实读） | 官方树缺包 | 本地包 | 内置 |
|---|---|---|---|---|---|---|
| 0.1.1 层 | 16 | 1 | 0 | 3 | 12 | 0 |
| 0.1.7 层 | 41 | 24 | **1** | 3 | 12 | 1 |
| T06 草案 | 34 | 27 | **1** | 0 | 5 | 1 |

- 唯一的 `CHANGED` 目标：`@deepseek-ai/dsh-workflow-ptc`（churn 20%，`lib/index.js` + 1 个 `.d.ts`）。
  **0.2.0 源码实读结论**：`static Config = z.object({ provider: z.string().default("spawn"), … })`（`…/dsh-workflow-ptc/lib/index.js` 尾部）⇒ 预设行 `config: {provider: spawn}` 依然合法且正是默认值。该包两版 `lib/index.js` 仅差 58 字节，差异位于内嵌 guest 源字符串（VM 物化重构），不在配置面。
- 三个"缺包"（`@deepseek-ai/dsh-vision-adam`、`dsh-taste`、`dsh-session-board`）在两个官方树中都不存在：**非 npm 发布物，必须随迁移自带**（与 §5.2 的 peer 改造合流）。
- 完整逐条清单见 `.workspace/audit-020/tools/map-pkgs-out.txt`（由 `tools/map_pkgs.py` 生成）。

### 2.4.2 被 patch 定向覆盖的官方 id → 承载包判据映射

行本身是否存在，由 bundle 层文件（`dsh-base` / `dsh-web-app` 的 `cordis.patch.yml` + 4 个 preset）决定，已在 §4 表 A/C 逐条对比（0.1.7 → 0.2.0：**除 schedule 三行外 id 集合完全相同**）。
行背后的插件包是否改了配置面，按下表判定（"承载配置文件"= 声明 Config 的 `lib/index.js`）：

| 被定向的 id | 承载包 | 包 churn | 配置面文件 | 判据 |
|---|---|---|---|---|
| `agent-preset-registry` | `dsh-agent-preset-registry` | CHANGED 4.2% | `lib/typert.host.js` 变、**`lib/index.js` 逐字节相同** | `lib 哈希全等推定`（配置面）+ 0.2.0 源码实读交叉确认 `default: z.string().required()` |
| `ui-settings-general` | `dsh-client-ui-settings-general` | CHANGED 5.9% | `lib/client.js` 变、**`lib/index.js` 相同** | 同上；`welcomeNoticeVersion` 键未变 |
| `ui-theme` | `dsh-client-ui-theme` | CHANGED 6.3% | `lib/client.js` 变、**`lib/index.js` 相同** | 同上；`preference` 键未变 |
| `web-search-deepseek` | `dsh-web-search-deepseek` | **CHANGED 75%** | `lib/index.js` **变** | **`0.2.0 源码实读`**：`apiKeyEnv`（默认 `DEEPSEEK_API_KEY`）/`baseURL`/`maxUses`/`model` 键仍在；且 153/163 行仍是无条件 `response.json()` |
| `llm-pi-ai` | `dsh-llm-pi-ai` | 不在 55 名单 | — | `lib 哈希全等推定` |
| `agent-default-model` | `dsh-agent-default-model` | 不在 55 名单 | — | `lib 哈希全等推定` |
| `web` | `dsh-web` | 不在 55 名单 | — | `lib 哈希全等推定` |
| `connection` | `dsh-client-connection` | 不在 55 名单 | — | `lib 哈希全等推定` |
| `directory-picker` | `dsh-host-directory-picker-auto` | 不在 55 名单 | — | `lib 哈希全等推定` |
| `preset-standard-glm` 的 19 个插件行 | 见表（27 个 `lib 全等` + `workflow-ptc`） | 仅 `workflow-ptc` | — | 见 2.4.1 |

### 2.4.3 `dsh-agent-preset` 的 33.3% 整包 churn 到底是什么（协调者指定必查项）

按 `lib/` 口径复核：**`dsh-agent-preset` 不在 55 个改动包名单内**，其 `lib/index.js` 与 `lib/types/index.d.ts` **均逐字节相同**。
整包层面 8 个差异文件全部在 `lib/` 之外：

| 差异文件 | 性质 |
|---|---|
| `package.json` | 版本号（0.1.7-rc.2 → 0.2.0-rc.1） |
| `README.md` / `README.zh.md` / `README.i18n.yaml` | 文档 |
| `skills/agent-experience/`（目录） | 新增技能 |
| `skills/cordis-composition-reference/references/packages.md` | 技能文档更新 |
| `skills/cordis-plugin-development/SKILL.md`、`…/references/user-actions.md` | 技能文档更新/新增 |

⇒ **不是代码改动，也不是 Config schema 改动**：预设行的 `{id, name, description, order, plugins}` 契约由 `lib/index.js` 承载，**必然未变**。协调者的怀疑（"那 6 个是否为 package.json 版本号"）部分成立 —— 差异**不在 lib/**，而是 package.json + 3 个 README + 4 个 skills 文件（合计 8 项）。

### 2.4.4 组合 id 增删全量（0.1.7 vs 0.2.0）

```
011 ids: 135   017 ids: 182   020 ids: 183
消失（0.1.7 有、0.2.0 无）：time-context / schedule / ui-schedule   （0.1.7 中三者 disabled: true）
新增（0.2.0 有、0.1.7 无）：otel / desktop-product-telemetry / product-analytics / ui-settings-session-log
```

---

## 3. 机制结论（回答任务第 3 问）

> 前提（协调者硬基线 §2 + 本轨道复核）：CLI `lib/**` 三版逐字节相同、`applyEntryPatches` 0.1.7↔0.2.0 逐字节相同
> ⇒ 下列机制描述对 0.1.1 / 0.1.7 / 0.2.0 三版**同时成立**；唯一的变化点是 §3.5 表末两行（0.1.1 没有 preflight、且末尾是 fail-loud 断言）。

### 3.1 应用顺序（0.2.0，与 0.1.7 相同）

`readProfilePatches()` 构造的有序 patch 列表：

1. `dsh.profile.bundles` 顺序的每个 bundle 层（本部署 = `@deepseek-ai/dsh-base` → `@deepseek-ai/dsh-web-app`）；
   **0.2.0 的 web-app 层本身是 5 个 patch 文件**：`cordis.patch.yml` → `presets/standard.patch.yml` → `presets/ptc.patch.yml` → `presets/minimal.patch.yml` → `presets/cordis.patch.yml`（顺序取自包内 `dsh.bundle.patch` 数组）。
2. profile 自己的 `cordis.patch.yml`（本审计主角）。
3. **`$DSH_HOME/cordis.patch.yml`**（home 层，优先级高于 profile 层）。
4. `--patch <file>` 覆盖层（argv 顺序）。
5. telemetry 开关（`DSH_TELEMETRY_DISABLED` 非空且组合含 `session-telemetry-otel` 行时追加 `{id: session-telemetry-otel, disabled: true}`）。

全部层随后被 `prepareProfilePatches` **折叠成单个 `{insert: rows}`**，插入到恒为 `[]` 的 `profiles/web/cordis.yml` 所挂载的 `cordis:include` 中。
⇒ 行级"最后一次写入获胜"、`insert` 按序 append、**同一 patch 文件内后出现的条目可以定向到本文件先 insert 的行**（`buildMap` 在每次 insert 后重建索引，61-84 行）。

### 3.2 `insert` / `disable` / id 定向覆盖的语义

- `insert`（不带 `id`）：append 到顶层；带 `id`：把条目 append 到**该 id 指向的 group 的 `config` 数组**（目标不存在或非 group 则 warn+跳过）。
- `id` 定向覆盖：把给定键**整体赋值**到目标行；支持 `config` / `disabled` / `inject` / 任意键。
  **`config` 不做深合并** —— 覆盖某行必须复述它拥有的全部键，否则被省略的键回落到插件默认值。
- `name` 若写出：作为**断言守卫**（与目标行 name 不等则 warn+跳过），不是重命名。0.1.7 层 `connection` 条目的注释"N13：不写 name"正是为此。

### 3.3 `!!js` 表达式与 `dshHomePath`

- `!!js` 在 **0.1.1 / 0.1.7 / 0.2.0 三版都支持**（`userPatchesSchema = entryListSchema`，含 `tag:yaml.org,2002:js`）；表达式**不被 app-boot 求值**，而是以 `{__jsExpr}` 形式原样交给 Loader，在条目激活时求值。
- `boot()` 里 `ctx.provide("dshHomePath", dshHomePath)` ⇒ patch 中的 `root: !!js dshHomePath('office-ppt')` 在 0.2.0 依旧可用。
- 注意：`applyEntryPatches` 对 `disabled: !!js …` 一律按**真值对象**处理（`disabled === true` 的判定写在各消费点，如 preflight 的 `row.disabled === true && !row.group`），所以 `!!js` 结果交给 Loader 求值后再生效 —— 语义三版一致。

### 3.4 `include` 插件与 `cordis.patch.yml` 的关系

- `cordis.patch.yml` **不是**一个 `include` 条目，而是被 `loadOverlayPatches` 读成 **patch 列表**，再由 `mountRootInclude` 折成单个 insert 交给根 `cordis:include`（其 `config.path` 指向 `profiles/<name>/cordis.yml`，该文件每次启动都被**重写为 `[]`**，防止 Loader 回写把组合烘进文件造成下一轮重复插入）。
- 反向关系存在：**patch 层里可以 insert 一个 `cordis:include` 行**；此时 preflight 会额外递归检查该 include 文件所到达的插件，若其中有不兼容插件，**整个 include 行被禁用**（注释原文：`its included file … reaches an incompatible plugin, and that file is never rewritten`）。
- 版本约束：`@deepseek-ai/cordis-plugin-include` 在 0.1.7 与 0.2.0 的 CLI 依赖里都是 `~1.0.9`（`@deepseek-ai/dsh-app-boot` 的 peer 同为 `~1.0.9`），`cordis` 为 `~4.0.4`（0.1.1 为 `^4.0.1` 区间，实测安装体同为 4.0.x 线）。

### 3.5 失败语义（关键：0.1.1 → 0.2.0 有变化）

| 情形 | 0.1.1（现役） | 0.2.0 | 是否静默 |
|---|---|---|---|
| patch 文件不可读 / 不可解析 / 顶层非数组 / 条目非 mapping | 抛错（`failed to parse patches …`） | **同左，抛错** | 否，致命 |
| bundle 层缺失或 peer 不允许 | 跳过并 `skippedBundles`（stderr 一行），**该 bundle 的整层被丢弃** | 同左 | 半静默（仅 stderr） |
| `id` 定向条目找不到目标 | warn 后跳过 | **同左** | **静默**（仅 logger.warn） |
| `name` 断言不符 | warn 后跳过 | 同左 | **静默** |
| 插件 peer 与运行时冲突 | **无此机制** | **`row.disabled = true`**，stderr 一行 `dsh: disabling profile plugin …` | **静默**（新增！） |
| 插件名无法解析（import 失败） | boot 抛错（`plugin(s) failed to load` / `N entries did not activate`） | 仅当属于 bootstrap include 或 `{agent-loop, webserver, modules}` 才抛 `StartupError`；否则写 stderr 继续 | **0.2.0 起半静默（新增！）** |
| 条目激活失败（inject 服务缺位等） | 非 active 即抛错 | 同上，非 required 只报 stderr | **0.2.0 起半静默（新增！）** |

> 结论：**"应用失败"在条目粒度上从来不是致命错误**（0.1.1 也一样只 warn+skip），但 0.2.0 把**两类原本会炸的失败降级为 stderr**，并对 peer 冲突新增了自动 disable。迁移时必须显式核对 stderr 与 `dsh --dump-config`，不能以"能启动"作为通过判据。

---

## 4. 条目清单表

说明：
- 「目标身份」= 该条目在 0.2.0 官方组合中定向到的行（id → `name`）。
- `insert` 条目的「目标存在性」= 其 `name` 在 0.2.0 生态中的可解析性与版本兼容性（不涉及官方组合）。
- peer 判定使用与 `evaluatePluginCompatibility` 相同的 `semver.satisfies(runtime, range, {includePrerelease:true})`，runtime = `0.2.0-rc.1`。
- **「0.2.0 存在性」一列的证据类型（二次校正轮）**：凡目标包在 `churn-lib-017-020.txt` 的 225 个"`lib/` 逐字节相同"集合内，一律标注为 `lib 全等`（依据：该包 `lib/` 逐文件 sha256 全等 ⇒ id/导出/注册点/Config schema 必然未变）；仅 `web-search-deepseek`（承载 id 的行）与 `workflow-ptc`（预设内插件行）落在 55 个改动包内，两者均已读 0.2.0 源码逐键确认，标注为 `源码实读`。完整映射见 §2.4。

### 表 A — 0.1.7 层 27 条（0.1.1 层是其子集，逐条已在其列标注）

| # | 类型 | id | name / config | 0.2.0 目标身份 | 0.2.0 存在性 | 判定 |
|---|---|---|---|---|---|---|
| 0 | insert | `vision-adam` | `@deepseek-ai/dsh-vision-adam` | 新增行（官方无此 id） | 包**不在 npm**（需自带 0.2.0 版本地包）；peer `^0.1.0-rc.7` ⇒ **不兼容** | 改造 |
| 1 | config | `agent-preset-registry` | `default: standard-glm` | `@deepseek-ai/dsh-agent-preset-registry`（web-app 层） | **存在**，键 `default` 仍是 `z.string().required()` | 保留 |
| 2 | insert | `taste` | `@deepseek-ai/dsh-taste` | 新增行 | 包**不在 npm**；本地 0.1.0 peer `^0.1.1-rc.2` ⇒ **不兼容** | 改造 |
| 3 | insert | `btw` | `@local/dsh-btw` | 新增行 | peer `>=0.1.1-rc.2 <0.2.0` ⇒ **兼容** | 保留 |
| 4 | insert | `wallpaper` | `@local/dsh-wallpaper` | 新增行 | **兼容** | 保留 |
| 5 | insert | `usage` | `@local/dsh-usage` | 新增行 | **兼容** | 保留 |
| 6 | insert | `session-status-board` | `@deepseek-ai/dsh-session-board` | 新增行 | 包不在 npm；peer `>=0.1.1-rc.2 <0.2.0` ⇒ **兼容** | 保留（需自带包） |
| 7 | insert | `ssh-remote` | `dsh-workspace-enhancement`（config 4 键） | 新增行 | 本地 0.1.2 peer `^0.1.1-rc.2` ⇒ **不兼容** | 改造 |
| 8 | insert | `directory-picker-ssh` | `dsh-workspace-enhancement/picker` | 新增行 | 同一包 ⇒ **不兼容** | 改造 |
| 9 | insert | `ssh-web-channel` | `dsh-workspace-enhancement/web` | 新增行 | 同一包 ⇒ **不兼容** | 改造 |
| 10 | insert | `workerspace` | `@local/dsh-workerspace` | 新增行 | peer `^0.1.1-rc.2` ⇒ **不兼容** | 改造 |
| 11 | insert | `dsh-pptmaster` | `@local/dsh-pptmaster`，`root: !!js dshHomePath('office-ppt')` | 新增行 | peer 16 条 `^0.1.1-rc.2` ⇒ **不兼容** | 改造／业务退役 |
| 12 | disabled | `directory-picker` | `disabled: true` | `@deepseek-ai/dsh-host-directory-picker-auto` | **存在**，name 三层未变 | 保留 |
| 13 | insert | `directory-picker-browse` | `@deepseek-ai/dsh-host-directory-picker-browse` | 新增行（0.2.0 官方是 web-app 依赖但**未挂载**） | 0.2.0 版 peer 仅 `cordis ~4.0.4` ⇒ **兼容**；沿用 0.1.1 旧包 ⇒ 不兼容 | 保留（须装 0.2.0 版） |
| 14 | disabled | `directory-picker-ssh` | `disabled: true` | 本层第 8 条自己插入的行 | 自反可解析（同一 patch 内先插后禁） | 保留（随第 8 条） |
| 15 | insert | `ssh-gui` | `@local/dsh-ssh-gui` | 新增行 | **兼容** | 保留 |
| 16 | insert | `dsh-subagent-model` | `@local/dsh-subagent-model` | 新增行 | 插件兼容，但**消费侧 = 本地改造过的 `dsh-tool-subagent`**，0.2.0 官方包无读取点 | 退役或改造 |
| 17 | insert | `logfile` | `@local/dsh-logfile`（level/maxBytes/maxFiles/orphanWatch） | 新增行 | **兼容**；0.2.0 组合层中 `logfile` 关键词零命中（是否由某官方插件内置文件 exporter 未逐一排查，见 §7） | 保留 |
| 18 | insert | `web-search-sse` | `@local/dsh-web-search-sse`（4 键） | 新增行 | peer `^0.1.1-rc.2` ⇒ **不兼容**；官方 `dsh-web-search-deepseek` **仍无 SSE 组装** | 改造 |
| 19 | config | `ui-settings-general` | `welcomeNoticeVersion` | `@deepseek-ai/dsh-client-ui-settings-general` | **存在**；0.2.0 源码 `Config = z.object({ welcomeNoticeVersion: z.string().volatile() })` | 保留 |
| 20 | config | `llm-pi-ai` | `providers: {adam: … 46 models}` | `@deepseek-ai/dsh-llm-pi-ai` | **存在**（官方该行 config 为空）；0.2.0 provider schema 仍接受 `apiKeyEnv/api/baseURL/models[{id,contextWindow,maxTokens,input}]` | 保留 |
| 21 | config | `agent-default-model` | `provider: adam, model: gpt-6-astra` | `@deepseek-ai/dsh-agent-default-model` | **存在**（官方值 `deepseek-official/deepseek-flash`，键相同） | 保留 |
| 22 | config | `web-search-deepseek` | `baseURL/maxUses/model` | `@deepseek-ai/dsh-web-search-deepseek` | **存在**（官方 config 仅 `apiKeyEnv: DEEPSEEK_API_KEY`） | 保留（建议复述 `apiKeyEnv`） |
| 23 | config | `ui-theme` | `preference: light` | `@deepseek-ai/dsh-client-ui-theme` | **存在**，键仍是 `preference` | 保留 |
| 24 | insert | `preset-standard-glm` | `@deepseek-ai/dsh-agent-preset`，config `{id,order,name,description,plugins[16]}` | 新增行 | 包存在；0.2.0 Config = `{id,name,description,order,plugins}` 完全匹配 | 改造（基线换成 0.2.0 standard） |
| 25 | config | `web` | `searchProvider: deepseek-sse, fetchProvider: http` | `@deepseek-ai/dsh-web` | **存在**（官方 `deepseek-official/http`）；键均为 `z.string()` | 保留（依赖第 18 条生效） |
| 26 | inject | `connection` | `inject: [webRuntime, webServer]` | `@deepseek-ai/dsh-client-connection` | **存在**；官方 web-app 层已覆盖为 `inject: [webRuntime]`，静态 inject 仍是 `["credentials"]`；`webServer` 服务在 0.2.0 仍是 `@deepseek-ai/dsh-host-webserver` 的 `super(ctx, "webServer")` | 保留 |

### 表 B — 0.1.1 层相对 0.1.7 层的差异（仅 1 条实质差异）

| 0.1.1 层条目 | 0.1.7 层对应 | 0.2.0 结果 |
|---|---|---|
| `- id: agent-presets` / `config.default: standard-glm` | `- id: agent-preset-registry` | 0.2.0 **无 `agent-presets` 行** ⇒ `patch: entry 'agent-presets' not found`，warn 后**静默丢弃**，默认 preset 仍是官方 `standard` |
| （0.1.1 层缺 7 条） | `ui-settings-general` / `llm-pi-ai` / `agent-default-model` / `web-search-deepseek` / `ui-theme` / `preset-standard-glm` / `connection inject` | 0.1.1 层在 0.2.0 上会**丢失这些本地定制**（不影响启动，但行为退化） |

### 表 C — 0.2.0 与 0.1.7 官方组合的 id 漂移（仅列与本 patch 相关的部分）

| 关注点 | 0.1.7 | 0.2.0 | 结论 |
|---|---|---|---|
| 顶层行 / 不同 id 数 | 182 / 182 | 183 / 183 | 仅 +1 行 |
| `directory-picker` | `@deepseek-ai/dsh-host-directory-picker-auto` | 同 | 未漂移 |
| `web` / `connection` / `ui-theme` / `ui-settings-general` / `web-search-deepseek` / `llm-pi-ai` / `agent-default-model` / `agent-preset-registry` | 见上 | **name 全部一致** | 未漂移 |
| `preset-standard` 内容 | 19 行插件 | 解析后**逐字段相同**（同 id、同 name、同 config，含 `modelSelectionSettings: true`） | 未漂移 |
| `present` / `command-goal` / `tool-plugin-manager` | 已存在 | 已存在 | **不是 0.2.0 新增**（相对 0.1.1 层才是新增） |

---

## 5. 保留 · 改造 · 退役判定（逐条）

### 5.1 保留（改动前即可直接落地，共 15 条）

`btw`(3)、`wallpaper`(4)、`usage`(5)、`session-status-board`(6，需自带给 0.2.0 profile)、`directory-picker` disabled(12)、`directory-picker-browse`(13，装 0.2.0 版包)、`ssh-gui`(15)、`logfile`(17)、`ui-settings-general`(19)、`llm-pi-ai`(20)、`agent-default-model`(21)、`web-search-deepseek`(22)、`ui-theme`(23)、`web`(25)、`connection`(26)。
理由：id 与 name 在 0.2.0 组合中逐条实测存在；config 键在其 0.2.0 插件源码的 Config schema 中逐条实测有效。
（15 保留 + 9 改造 + 1 条件 + 2 退役 = 27，与 0.1.7 层条目数闭合。）

### 5.2 改造（共 9 条 + 1 条件条）

| 条目 | 改造内容 | 依据 |
|---|---|---|
| `vision-adam`(0)、`taste`(2) | 两个包**不在 npm**，必须随迁移自带；并**放宽 `@deepseek-ai/dsh-*` peer 到 0.2.0**（或在 profile 写 `compatibility.json` 授权豁免） | `evaluatePluginCompatibility` 286 行；vision-adam 0.2.0 peer `^0.1.0-rc.7`、taste 0.1.0 peer `^0.1.1-rc.2` 均不含 0.2.0-rc.1 |
| `ssh-remote`(7)、`directory-picker-ssh`(8)、`ssh-web-channel`(9) | 重建 `dsh-workspace-enhancement`（0.1.2 → 0.2.0 基线）并放宽 peer | 现役包 peer `@deepseek-ai/dsh-system-prompt/tools ^0.1.1-rc.2` |
| `workerspace`(10)、`dsh-pptmaster`(11) | 重建 `@local/*` 包并放宽 peer；`dsh-pptmaster` 的 `root: !!js dshHomePath('office-ppt')` **写法无需改**（`dshHomePath` 在 0.2.0 boot 仍 provide） | 两包均 16/6 条 `^0.1.1-rc.2` peer |
| `web-search-sse`(18) | 重建包并放宽 peer；**不要退役** —— 0.2.0 官方 `dsh-web-search-deepseek` 仍无条件 `response.json()`（153/163 行），Anthropic 兼容网关返回 SSE 时依旧报 `unexpected token 'e'` | 源码实测 |
| `preset-standard-glm`(24) | 用 **0.2.0 官方 `presets/standard.patch.yml` 为基线**重建插件列表（19 行），并把子代理路由钉在 `tool-subagent` / `tool-subagent-fork` 的 `config.agentOptions`；0.1.7 层的 16 行版本缺 `present` / `command-goal` / `tool-plugin-manager` | 逐条 diff：0.1.7 层 16 行 vs 0.2.0 standard 19 行，本地缺 3 行、无 name 漂移 |

条件条：`directory-picker-browse`(13) —— 装 `@deepseek-ai/dsh-host-directory-picker-browse@0.2.0-rc.1` 则**兼容**（peer 仅 `cordis ~4.0.4`）；若沿用 0.1.1 旧包（peer `@deepseek-ai/dsh-invariants ^0.1.1-rc.2`）则被静默 disable。

### 5.3 退役（2 条）

| 条目 | 退役理由 |
|---|---|
| `dsh-subagent-model`(16) | 插件本体与 0.2.0 兼容、能装能挂，但其**唯一消费侧**是本地改造过的 `dsh-tool-subagent`（现役 695 行 vs 官方 296 行）。0.2.0 官方包无 `settings.get("dsh-subagent")` ⇒ 装上只会出现一个**无人消费的设置页**，属"静默无效"。退役后子代理路由改由 `preset-standard-glm` 的 `agentOptions` 钉死（或改用 0.2.0 官方 `subagent-model-selection-settings` + `tool-subagent.modelSelectionSettings`，二者语义不同：官方是**每会话可选的授权路由列表**，不是固定默认值）。 |
| 0.1.1 层的 `- id: agent-presets`(1') | 0.2.0 无该 id，官方自 0.1.7 起改名 `agent-preset-registry`；旧写法只会得到一条 warn 并被丢弃。**已在 0.1.7 层完成等效替换，迁移时直接采用新 id。** |

对"官方已内置 office 能力 ⇒ 可退役本地 fork"的明确回答：**否**。
- 0.2.0 的 base / web-app / 4 个 preset 层**没有任何 `skill-office` 行**（`@deepseek-ai/dsh-skill-office` 只是 CLI 依赖，README 明示需另行 "Mount this provider beside the skill registry"）。
- 官方 `office-to-pdf` 行与 `@deepseek-ai/dsh-tool-present`（`present` 工具）在 **0.1.7 已存在**，不是 0.2.0 新增能力。
- 因此 `@local/dsh-pptmaster`（提供 `pptmaster_*` 工具 + `ppt-design-systems` / `ppt-template-fidelity` / `workbuddy-ppt` 三个技能）**在功能上与官方 office 技能包重叠**，但官方默认不启用 ⇒ 是否退役属**业务裁决**，本审计只给事实与改造路径（放宽 peer 后可原样继续用）。

---

### 5.4 新增迁移决策项（非既有条目失效，但必须显式裁决）：日程/自动化三行迁出官方组合

| 事实 | 证据 |
|---|---|
| 0.1.7 官方组合含 `time-context` / `schedule` / `ui-schedule` 三行（`@deepseek-ai/dsh-time-context` / `dsh-schedule` / `dsh-client-ui-schedule`），**三行均 `disabled: true`** | `~/.npm-global-dsh017/…/dsh-web-app/cordis.patch.yml:125-130`、`:370-372`，用同一 `applyEntryPatches` 复算后 `disabled=True` |
| **0.2.0 官方组合中这三行完全消失**（不是 disabled，是行不存在） | 0.2.0 `dsh-base`/`dsh-web-app`/4 个 preset 全层 `grep schedule` 零命中；组合 id 差集 = {time-context, schedule, ui-schedule} |
| 功能搬到新包 `@deepseek-ai/dsh-experimental-schedule-bundle@0.2.0-rc.1`（`dsh.bundle.patch = ./cordis.patch.yml`，其 patch 正是插入这三行；依赖 `dsh-client-ui-schedule` / `dsh-schedule` / `dsh-time-context`） | `iso-020/npm-global/node_modules/@deepseek-ai/dsh-experimental-schedule-bundle/{package.json,cordis.patch.yml}` |
| 该包**不在**本 profile 的 `dsh.profile.bundles`（= `["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app"]`）中 ⇒ 默认不挂载 | `~/.dsh/profiles/web/package.json`；app-boot `OPTIONAL_BUNDLES` 只是"允许被选"的白名单，不会自动挂载 |
| 现役 0.1.1 组合**没有**这三行 ⇒ 相对现役部署**没有行为退化** | `grep -n "id: schedule\|id: ui-schedule" ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-web-app/cordis.patch.yml` → 无命中 |

**结论与建议**：这**不是**静默失效（两份本地 patch 都没有条目指向这三个 id），而是**能力开关的迁移决策**：
- 若不需要日程/自动化 → **什么都不做**，与现役一致。
- 若需要（例如将来要用 release note 提到的"自动化任务"）→ 二选一，且**必须显式写入迁移执行档**：
  1. 首选：在 profile 的 `package.json` 里把 `@deepseek-ai/dsh-experimental-schedule-bundle` 加入 `dsh.profile.bundles`（bundle 级；app-boot 的 `OPTIONAL_BUNDLES` 已把它列入可选项白名单，不会触发 bundle 兼容性告警）；
  2. 备选：在 patch 层 insert 它贡献的三行（`time-context` / `schedule` / `ui-schedule`），效果等价但绕过了 bundle 声明。
- **不要**沿用"`- id: schedule` / `disabled: false`"这种写法：在 0.2.0 上这三行已不存在，该条目会得到一条 `patch: entry 'schedule' not found` 的 warn 后被丢弃（这正是 §3.5 的静默路径）。

---

## 6. 面向 0.2.0 的新 patch 层草案

**产物**：`.workspace/audit-020/reports/T06-proposed-cordis.patch.020.yml`（文本手术生成，`!!js` 与块标量保持原文；每条条目在草案内标注判据类型）
**验证**：用同一份 `applyEntryPatches` 算法叠加到 0.2.0 官方组合（183 行）之上 ⇒ **0 warning，190 条顶层行 / 190 个 id**，`connection.inject = ['webRuntime','webServer']`、`directory-picker.disabled = true`、`web.searchProvider = 'deepseek-sse'`、`preset-standard-glm(id=standard-glm, order=5, plugins=19)` 均按预期落位。

草案生效条目 16 条（A 组 15 条 + `llm-pi-ai`）。**每条的依据类型**（`lib 哈希全等推定` / `0.2.0 源码实读` / `组合复算`，定义见 §2.4 与草案文件头）：

| 草案块 | 条目 | 依据类型 | 备注 |
|---|---|---|---|
| A1 | `insert btw / wallpaper / usage / ssh-gui` | `组合复算` + peer 判定 | peer 兼容，仅需装包 |
| A2 | `insert logfile` + 4 键 config | `组合复算` | 新增行，官方组合无同 id |
| A3 | `id: agent-preset-registry` → `default: standard-glm` | **`lib 哈希全等推定`**（承载 Config 的 `lib/index.js` 逐字节相同）+ `组合复算` | 键为 `z.string().required()` |
| A4 | `id: ui-settings-general` → `welcomeNoticeVersion`；`id: ui-theme` → `preference: light` | **`lib 哈希全等推定`**（仅 `lib/client.js` 变）+ `组合复算` | 官方两行 config 为空 |
| A5 | `id: agent-default-model` → `provider/model`（全键复述） | **`lib 哈希全等推定`**（不在 55 名单）+ `组合复算` | 官方为 `deepseek-official/deepseek-flash` |
| A6 | `id: web-search-deepseek` → `apiKeyEnv + baseURL + maxUses + model` | **`0.2.0 源码实读`**（本层唯一 churn 75% 目标）+ `组合复算` | **补回 `apiKeyEnv`**（整体替换语义） |
| A7 | `id: web` → `searchProvider: deepseek-sse, fetchProvider: http` | **`lib 哈希全等推定`**（不在 55 名单）+ `组合复算` | 需 C 组 `web-search-sse` 生效 |
| A8 | `id: directory-picker` disabled + `insert directory-picker-browse` | **`lib 哈希全等推定`**（两者均不在 55 名单）+ `组合复算` | 官方未挂载 browse 行 |
| A9 | `id: connection` → `inject: [webRuntime, webServer]` | **`lib 哈希全等推定`**（`dsh-client-connection`、`dsh-host-webserver` 均不在 55 名单）+ `组合复算` | 不写 `name`、不写 `credentials`（N13 结论仍有效） |
| E | `id: llm-pi-ai` → `providers`（逐字照抄 0.1.7 层第 125-337 行） | **`lib 哈希全等推定`**（`dsh-llm-pi-ai` 不在 55 名单）+ `组合复算` | 0.2.0 provider schema 必然未变 |
| G | `insert preset-standard-glm` = **0.2.0 官方 standard 的 19 行** + 两处 `agentOptions {provider: adam, model: deepseek-v4-pro}`，`order: 5` | 19 行中 18 行的包 `lib 哈希全等推定`；`workflow-ptc` 为 **`0.2.0 源码实读`**（`Config.provider` 仍在，默认即 `spawn`） | 自动带上 `present` / `command-goal` / `tool-plugin-manager` |

草案另含两个**默认关闭、需显式裁决**的可粘贴块：

| 块 | 内容 | 依据类型 | 验证 |
|---|---|---|---|
| B | `dsh-subagent-model` 的去留（退役 / 继续维护本地改造的 `dsh-tool-subagent`） | `0.2.0 源码实读`（官方包无 `settings.get("dsh-subagent")`；该包 `lib/` 零改动 ⇒ 0.1.7 官方实现即 pristine 基线） | — |
| C | `vision-adam` / `taste` / `session-status-board` / `dsh-workspace-enhancement` 三行 / `workerspace` / `dsh-pptmaster` / `web-search-sse` 的 peer 放宽或 `compatibility.json` 豁免 | peer 判定（真实 `semver@7.8.5` 复刻 `evaluatePluginCompatibility`） | — |
| C2 | 日程/自动化三行（`time-context` / `schedule` / `ui-schedule`），见 §5.4 | `组合复算` | **已实测**：把 C2 三行启用的临时副本打到 0.2.0 组合上 ⇒ `0 warning，193 条顶层行 / 193 个 id` |

### 6.1 迁移执行档的前置条件（草案落地前必须完成）

1. 新 profile 的 `package.json` 依赖装到 `@deepseek-ai/dsh@0.2.0-rc.1` + `@deepseek-ai/cordis-plugin-group`，bundle 列表保持 `["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app"]`。
2. 把 B/C 组涉及的本地包（`@local/*` 9 个、`dsh-workspace-enhancement`、`@deepseek-ai/dsh-vision-adam`、`@deepseek-ai/dsh-taste`、`@deepseek-ai/dsh-session-board`）装进新 profile 的 `node_modules`；对仍需保留但**来不及重建**的包，在 profile 目录写 `compatibility.json`（`{"<name>@<精确版本>": ["0.2.0-rc.1"]}`）授权豁免。
3. `~/.dsh-017/.agent-presets/standard-glm/agent.cordis.yml` 与 0.2.0 内置 `preset-standard` 的差异已由草案 G 组覆盖，无需再依赖该目录。

---

## 7. 未验证项

0. **判据适用范围（必须随结论一起引用）**：§2.4 的 `lib 哈希全等推定` 基于 `churn-lib-017-020.txt`，即 **0.1.7-rc.2 ↔ 0.2.0-rc.1** 的 `lib/` 对比。它只能支撑"**0.1.7 时存在的包，其 0.2.0 代码未变**"，**不能**用于推断 0.1.1 ↔ 0.1.7 之间的变化。本报告所有"目标必然仍在"的结论都限定在这个方向上；行 id 是否存在则另有直接对比（0.1.7 与 0.2.0 的 bundle 层文件 + §4 表 A/C + §2.4.4 差集），不依赖该推定。
1. **未做 0.2.0 实机启动**（约束：不得启动监听端口）。preflight 的静默 disable、`auditStartupEntries` 的非致命降级均为**源码级判读 + 同算法离线复刻**，未在真实 `dsh --profile … web` 上观察 stderr 文本。
2. **未验证 `compatibility.json` 的实际授权效果**（只读审计，未写任何 profile 目录）。豁免键值格式取自 `readProfileCompatibility`/`validatePluginVersionExemption` 源码（`<name>@<精确版本>` → DSH 精确版本数组），未实跑。
3. **`dsh-llm-pi-ai` 的 46 个 models 条目**只做了 schema 键级核对（`contextWindow`/`maxTokens`/`input` 接受），未逐个校验网关可达性（属 T07/网关轨道范围）。
4. **`@deepseek-ai/dsh-session-board` 1.0 的运行时行为**未验证（该包不在 npm、peer 区间兼容但代码为 0.1.x 期产物）。
5. **`preset-standard-glm` 中 `agentOptions` 与 `modelSelectionSettings: true` 并存的最终优先级**未实机验证：源码显示 `requestedAgentOptions(parentOptions, configured, request, enabled)` 以 `configured`（agentOptions）为基线、模型显式传入时覆盖；`subagent-model-selection-settings` 默认 `enabled: false`（`allowedModels: []`），故默认路由应由 `agentOptions` 决定 —— 需在一次真实子代理派发中确认。
6. **0.1.1 层在 0.2.0 上"丢失的 7 条本地定制"是否已在 0.1.7 层全部等价覆盖**：仅做了条目级对比（见 5.3 表 B），未逐字段比对 `welcomeNoticeVersion` 等取值的历史意图。
7. **`@local/dsh-logfile` 的替代性**只做到"0.2.0 组合层关键词零命中"这一层：官方是否由某个插件（例如 host 侧 logger 或插件管理器）内置等价的有界文件 exporter，未逐一排查源码。
8. **§5.4 的日程/自动化是业务决策**：本报告只给出两条等价路径与实测结果（C2 备选在离线复算中 0 warning、193 id），未替操作者选择；启用日程会改变会话行为（按到期时间向原会话投递 follow-up），需人工裁决。
9. **bundles 级变更（把 `@deepseek-ai/dsh-experimental-schedule-bundle` 加进 `dsh.profile.bundles`）未实机验证**：只核对了它的 `package.json`/`cordis.patch.yml` 与 app-boot 的 `OPTIONAL_BUNDLES` 白名单，未真实启动校验 bundle 兼容性评估路径。
10. `dist-tags` 与 tarball 完整性：本轨道只按协调者给定事实使用 `0.2.0-rc.1`，未复核 npm dist-tag 现状（属 T01 范围）。

---

## 8. 与其他轨道的关系（本轨道边界声明）

本报告只回答"**patch 层能不能把本地定制落到 0.2.0**"，并给出条目级落点。以下相邻问题不由本轨道裁决，只在此标注落点：

- 子代理模型路由的**方案取舍**（官方 `subagent-model-selection-settings` vs 本地 `dsh-subagent` 命名空间 vs preset `agentOptions`）→ 见 T13；本报告的落点是条目 16 的退役判定与草案 G 组的 `agentOptions` 引脚。
- 本地插件与官方原生的**功能重叠矩阵** → 见 T14；本报告的落点是"哪些 insert 条目因 peer 会被静默禁用"。
- office/PPT 能力的**业务取舍** → 见 T15；本报告的落点是"0.2.0 官方组合默认未挂载 `dsh-skill-office`"这一事实级证据。
- 本地包的**重建/放宽 peer 清单** → 见 T08；本报告的落点是 C 组条目与 `compatibility.json` 机制判读。

