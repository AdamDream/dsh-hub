# T03 — 配置与 settings schema 层增量审计（0.1.7 → 0.2.0）

- 轨道：T03（只读审计，不改产品代码）
- 采样时刻：2026-09-29（当轮实测）
- 审计对象：`@deepseek-ai/dsh-settings`、`@deepseek-ai/dsh-config-editor`、`@deepseek-ai/dsh-app-boot`、`@deepseek-ai/dsh-atomic-write`、CLI（`--dump-config-schema`）、bundle 组合层（`dsh-base` / `dsh-web-app` 及 `presets/`）
- 基线对照：**0.1.7-rc.2 → 0.2.0-rc.1**（任务指定），并对**现役 0.1.1-rc.2** 追加对照（现役 settings.yaml 由 0.1.1 写入，必须对照）
- 只读约束遵守情况：仅写 `.workspace/**`；未触碰 `~/.dsh/settings.yaml`、`~/.dsh/**`、`~/.dsh-017/**`；未启动任何监听端口进程；未发起模型请求；未使用 `sandbox_permissions`。

---

## 一、结论摘要

**核心结论（一句话）：配置与 settings schema 层在 0.1.7 → 0.2.0 之间"零代码变更"——`dsh-settings` / `dsh-config-editor` / CLI / bundle 运行时代码逐字节相同，只有 bundle 的 YAML patch 层差异；真正的迁移断层发生在 0.1.1 → 0.1.7（settings 存储从 `settings.yaml` 整体搬到 profile patch），而现役 3080 恰好是 0.1.1-rc.2。**

1. **`@deepseek-ai/dsh-settings` 0.1.7 与 0.2.0 的实现代码逐字节相同**（`lib/index.js`、`lib/types/*` 全部 diff 无输出），仅 `package.json` 的 version 与依赖 pin 不同。⇒ 任务 1/2 中"0.2.0 是否新增校验/迁移/版本字段"的答案是：**没有**（0.2.0 未新增任何 settings 校验、迁移框架或 schema 版本字段）。
2. **0.2.0 提供 `dsh --profile <name> --dump-config-schema`，但它同样存在于 0.1.7 且文件逐字节相同**（`lib/dump-config-schema-DhhNOaro.js` + `lib/types/dump-config-schema.d.ts` diff 无输出）。因此它不是"0.2.0 新增"，而是**相对现役 0.1.1 新增**（0.1.1 的 app-boot 无 `generateConfigSchema`）。
3. **settings 命名空间 = profile 插件条目 id，settings 写入目标是 profile 的 `cordis.patch.yml`，不再是 `settings.yaml`**。`settings.yaml` 在 0.1.7+ 只被**读取一次**（导入后 `rename` 为 `settings.yaml.imported`）。现役 12 个命名空间里有 **5 个的命名空间名与 0.2.0 的条目 id 不一致**（`agent-presets`、`dsh-workerspace`、`dsh-ssh-gui`、`dsh-subagent`、`ui-onboarding`），其中 `ui-onboarding` 有官方重映射表兜底，其余 4 个**会以 warn 级日志静默丢失整段配置**。
4. **未知键 / 未知命名空间一律"警告并跳过"，绝不报错**：`settings.yaml` 导入路径抛错被 catch 成 `logger.warn`；profile patch 的未知 target 同样"warned and skipped"。⇒ 失败是**静默的**（只出现在 stderr / 日志），这正是本迁移最大的可迁移性风险。
5. **配置写入者只有一个**：`ConfigEditor.edit()` → `withFileLock(profile.dir/package.json)` + `writeFileAtomic(profile patch, {mode: 0o600})`，用 `yaml.parseDocument` **保留注释**。新增的规范化行为只有两条（0.1.7 就已存在）：`document.contents.flow = false` 强制块式；写入值若与继承层深等则**删除该 `config:` 键（必要时连行一起删）**。**不会**重排、不会丢注释、不会重写 `settings.yaml`。
6. **默认组合（bundle/默认 composition）在 0.1.7 → 0.2.0 的差异极小且全部集中在遥测与 Schedule**：base bundle 只加 `otel` 行并改 `session-telemetry-otel` 配置（端点域名 + `maxRequestBytes`）；web-app bundle 加 `desktop-product-telemetry` / `product-analytics`（非 desktop profile 下 disabled）/ `ui-settings-session-log`，删 `time-context` / `schedule` / `ui-schedule`（迁往新可选 bundle `dsh-experimental-schedule-bundle`，并进入 `OPTIONAL_BUNDLES`）。**agent preset 默认值（`standard`）、model 默认值（`deepseek-official`/`deepseek-flash`）、sandbox 默认（`DSH_PERMISSION_MODE ?? 'workspace-write'`）、approval 默认（`ask`，danger-full-access 时 `never`）、`presets/*.patch.yml` 技能与工具开关全部逐字节未变。**
7. **最大现实风险不在产品包，而在树外本地插件**：`@local/dsh-subagent-model`、`@local/dsh-workerspace`、`@local/dsh-ssh-gui`、`@local/dsh-wallpaper`、`@local/dsh-web-search-sse`、`@local/dsh-usage` 以及 `@deepseek-ai/dsh-vision-adam@0.2.0`（本地版）都 `import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'`。该导出在 0.1.1 存在、在 **0.1.7 与 0.2.0 均已删除**（当轮用 Node 链接期探针实测复现 `SyntaxError: ... does not provide an export named 'installSettingsSection'`）。⇒ 这些插件在 0.2.0 下**模块加载即失败**，其 settings 段必然无法导入。

---

## 二、证据（当轮命令与输出摘要）

### 2.1 环境与前置（只读核对）

```
$ sha256sum ~/.dsh/settings.yaml
0f19b0fe0e1b8c801bb9459c743cfa1c9aa84112753c14a1a1b7087a3a03fb57  ~/.dsh/settings.yaml
```
与协调者给定活值一致 ⇒ 本轨道的证据绑定在同一采样基线上。

```
$ sha256sum ~/.dsh/profiles/web/cordis.patch.yml ~/.dsh-017/profiles/web/cordis.patch.yml ~/.dsh-017/settings.yaml.imported
513413e7cffb319149a7be2bbab829e898e59c9d626909e33869429794487471   (现役 profile patch)
61adb8ae5758c12e466e3f08744fb4d7e38a95ec79a427ab3f5c4aa0dd036524   (0.1.7 profile patch)
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855   (.dsh-017/settings.yaml.imported = 空文件哈希)
```
> `e3b0c442…` 是空文件（0 字节）的 sha256 ⇒ 0.1.7 隔离实例**已经执行过一次 legacy 导入**，且当时那份 `settings.yaml` 是空的。这也反证"导入后原文件被 rename"的行为在 0.1.7 已生效。

```
$ ls ~/.dsh/profiles/web/           → cordis.patch.yml, cordis.yml, package.json, pnpm-workspace.yaml
$ ls ~/.dsh-017/profiles/web/       → 同上
$ ls ~/.dsh/cordis.patch.yml        → 不存在（无 home 级 patch 层）
$ ls ~/.dsh-017/cordis.patch.yml    → 不存在
$ cat ~/.dsh/profiles/web/cordis.yml → "[]"（空根，组合全靠 patch 层）
```

### 2.2 包解包（全部落在 `.workspace/audit-020/pkgs/`，`npm_config_cache` 指向工作区内）

```
$ npm pack @deepseek-ai/dsh@0.1.7-rc.2 @deepseek-ai/dsh@0.2.0-rc.1 \
    @deepseek-ai/dsh-settings@{0.1.1-rc.2,0.1.7-rc.2,0.2.0-rc.1} \
    @deepseek-ai/dsh-config-editor@{0.1.7-rc.2,0.2.0-rc.1} \
    @deepseek-ai/dsh-base@{0.1.7-rc.2,0.2.0-rc.1} \
    @deepseek-ai/dsh-web-app@{0.1.7-rc.2,0.2.0-rc.1} \
    @deepseek-ai/dsh-atomic-write@{0.1.7-rc.2,0.2.0-rc.1} \
    @deepseek-ai/dsh-app-boot@{0.1.1-rc.2,0.1.7-rc.2,0.2.0-rc.1} \
    @deepseek-ai/dsh-{agent-default-model,llm-pi-ai,llm-deepseek,web-search-deepseek,client-ui-theme,client-ui-settings-general,agent-preset-registry,tool-subagent}@{0.1.7-rc.2,0.2.0-rc.1} \
    @deepseek-ai/cordis-plugin-loader@1.0.5
```
关键 tarball 哈希（可复核）：

| tarball | sha256 |
|---|---|
| `@deepseek-ai/dsh@0.1.7-rc.2` | `5f2da7272d9485abc223e681075809a8d929697c5232ee445718e1b7e066bff8` |
| `@deepseek-ai/dsh@0.2.0-rc.1` | `ceb66bebe8117044e05f6932deaca15daea6a1ae1d0cffad079e33895f10d216` ← 与协调者给定 tarball 哈希一致 |
| `@deepseek-ai/dsh-settings@0.1.7-rc.2` | `934205e502d20c2a8afc6f697c582e9e9a093c61165d8f8ea5b2c0ca5f299a95` |
| `@deepseek-ai/dsh-settings@0.2.0-rc.1` | `1ccbce196909debd74613f40d02b372f46251d7f43c544c5c818c418f72bb37c` |

### 2.3 settings 包逐字节对比（决定性证据）

```
$ diff -u s017/package/lib/index.js          s020/package/lib/index.js          → 无输出（identical）
$ diff -u s017/package/lib/types/index.d.ts  s020/package/lib/types/index.d.ts  → 无输出
$ diff -u s017/package/lib/types/schema.d.ts s020/package/lib/types/schema.d.ts → 无输出
$ diff -u s017/package/lib/types/types.d.ts  s020/package/lib/types/types.d.ts  → 无输出
$ diff -u s017/package/lib/types/redact.d.ts s020/package/lib/types/redact.d.ts → 无输出
$ diff -u s017/package/README.md             s020/package/README.md             → "README identical"
$ diff -u s017/package/package.json          s020/package/package.json          → 仅 version 与 peer/devDependencies 的 0.1.7-rc.2→0.2.0-rc.1 pin
```
两个版本的导出语句完全相同：
```
$ tail -3 s017/package/lib/index.js   → export { SettingsConflictError, SettingsForms, SettingsForms as default, redactSecrets };
$ tail -3 s020/package/lib/index.js   → export { SettingsConflictError, SettingsForms, SettingsForms as default, redactSecrets };
$ grep -c installSettingsSection s017/package/lib/index.js s020/package/lib/index.js  → 0 / 0
```
0.1.1 对照：
```
$ tail -3 s011/package/lib/index.js
export { SettingsConflictError, SettingsProvider, SettingsProvider as default, deepEqualJson, installSettingsSection, redactSecrets, settingsNamespace };
$ grep '"version"' s011/package/package.json → 0.1.1-rc.2
```

### 2.4 CLI 对比（含 `dump-config-schema`）

```
$ ls cli017/package/lib/  → bin.js dump-config-BEDI-dNY.js dump-config-crgOY3tW.js dump-config-schema-DhhNOaro.js plugin-DkYIj96-.js profile-boot-BZ2ZjNWi.js profile-boot.js types
$ ls cli020/package/lib/  → 同一组文件名（完全一致）
$ for f in bin.js dump-config-*.js plugin-*.js profile-boot*.js; do diff -q cli017/... cli020/...; done → 全部 identical
$ diff -rq cli017/package/lib/types cli020/package/lib/types → 无输出
$ diff -rq cli020/package /home/CNS2026495165/dsh/.workspace/dsh-020-pkg/x/package → 无输出（解包件与工作区 0.2.0 包一致）
```
`--dump-config-schema` 存在性（0.2.0 `lib/bin.js:104`）：
```
.option("--dump-config-schema", "print JSON Schema for profile entries and patches without mounting")
```
`lib/types/args.d.ts` 中 `DumpConfigSchemaInvocation { mode: 'dump-config-schema'; profile; fromDefaultProfile?; patches }`。

### 2.5 app-boot 对比（schema 生成能力与兼容策略）

```
$ diff -u dsh-app-boot-0.1.7-rc.2/lib/index.js dsh-app-boot-0.2.0-rc.1/lib/index.js
@@ -552,7 +552,8 @@
 const OPTIONAL_BUNDLES = [
 	"@deepseek-ai/dsh-experimental-agent-team-profile",
 	"@deepseek-ai/dsh-experimental-voice-input-bundle",
-	"@deepseek-ai/dsh-experimental-auto-review"
+	"@deepseek-ai/dsh-experimental-auto-review",
+	"@deepseek-ai/dsh-experimental-schedule-bundle"
 ];
```
⇒ **整个 app-boot 运行时代码 0.1.7→0.2.0 只有这 1 行新增。**（加载器/兼容策略/schema 投影全部未变。）

0.1.1 对照（能力从无到有）：
```
$ grep -c "PROFILE_COMPATIBILITY_FILENAME\|evaluatePluginCompatibility\|generateConfigSchema" dsh-app-boot-0.1.1-rc.2/lib/index.js → 0
$ 同上（0.1.7-rc.2）→ 9
$ tail -4 dsh-app-boot-0.1.1-rc.2/lib/index.js → 导出仅 { DEFAULT_PROFILE_BUNDLES, PROFILES_DIR, PROFILE_PATCH_FILENAME, PROFILE_TEMPLATES, healProfilesModuleFallback, initProfile, loadProfile, readProfileManifest, resolveProfileDir, writeProfileManifest }
```

### 2.6 命名空间导出实测（Node ESM 链接期探针，无网络、无服务）

在 `.workspace/audit-020/pkgs/node_modules/` 下建立依赖桩（`@deepseek-ai/cordis`、`cordis-plugin-loader`、`schemastery`、`cosmokit`、`yaml`）并把三个版本的 settings 包软链为可解析包，然后用与本地插件**逐字相同**的 import 语句探测：

```
$ node probe/p011.mjs
011 OK function function function function function
$ node probe/p017.mjs
SyntaxError: The requested module '@deepseek-ai/dsh-settings-017' does not provide an export named 'installSettingsSection'
    at ModuleJob._instantiate (node:internal/modules/esm/module_job:226:21)
$ node probe/p020.mjs
SyntaxError: The requested module '@deepseek-ai/dsh-settings' does not provide an export named 'installSettingsSection'
    at ModuleJob._instantiate (node:internal/modules/esm/module_job:226:21)
```
⇒ 0.1.1 提供该导出，**0.1.7 与 0.2.0 都不提供**。这是"本地插件在 0.1.7/0.2.0 下加载即失败"的直接实测证据（注意：这也说明隔离 3097 实例里这批本地插件很可能同样没有真正生效）。

### 2.7 settings.yaml 结构（键名/结构级，值仅取非凭据标识）

用自写 `probe/keys.mjs` 只输出"行号 + 缩进 + 键名 + 是否带内联标量"，不打印值：

```
1   0  ui-onboarding          2  2  welcomeNoticeVersion <scalar>
3   0  llm-deepseek <scalar>   ← 内联 `{}`（空 flow map）
4   0  llm-pi-ai
5   2  providers
6   4  adam
7   6  apiKeyEnv  8 api  9 baseURL  10 models
11..215  models[] 的 id / contextWindow / maxTokens / input ...
216 0  agent-default-model   217 provider  218 model
219 0  vision-adam           220 model 221 baseURL 222 apiKeyEnv 223 maxTokens
224 0  agent-presets         225 default
226 0  web-search-deepseek   227 baseURL 228 model 229 maxUses
230 0  wallpaper             231 global → 232 source 233 darkMask 234 opacity 235 blur
237 0  dsh-workerspace <scalar>  ← 内联 `{}`
239 (注释行，102 字符)
240 0  dsh-ssh-gui           241 file.maxBytes 243 exec.timeoutMs/maxOutputBytes 246 security.confirmExec/execAllowlist
249 0  ui-theme              250 preference
251 0  dsh-subagent          252 model
```
同轮对**凭据类键名**做定向检索：
```
$ grep -nE "^[[:space:]]*(apiKey|key|token|secret|password|credential)[[:space:]]*:" ~/.dsh/settings.yaml | sed 's/:.*/:/'
（无输出）
```
⇒ **现役 settings.yaml 中不存在任何凭据值字段**；仅存在凭据**引用名**（`llm-pi-ai.providers.adam.apiKeyEnv`、`vision-adam.apiKeyEnv`，值为环境变量名）。本报告因此不含任何凭据值。

非凭据的关键标识（供迁移清单使用）：`agent-default-model.provider=adam` / `.model=deepseek-v4-pro`；`agent-presets.default=standard-glm`；`ui-theme.preference=light`；`dsh-subagent.model=deepseek-v4-pro`；`web-search-deepseek.model=claude-opus-4-6` / `.maxUses=100000`；`vision-adam.model=gpt-6-astra` / `.maxTokens=393216`。

### 2.8 组合层（bundle）差异

```
$ diff -u b017/package/cordis.patch.yml b020/package/cordis.patch.yml   → 2 个 hunk，43 行
  +   - id: otel / name: '@deepseek-ai/dsh-otel'                        （新增行）
  ~   session-telemetry-otel.config：+maxRequestBytes: 4000000
      exporter.url 默认值 harness-telemetry.deepseeksvc.com → dsh-otel-collector.deepseeksvc.com
$ diff -u w017/package/cordis.patch.yml w020/package/cordis.patch.yml   → 3 个 hunk
  +   - id: desktop-product-telemetry  (disabled unless profileContext.name === 'desktop')
  +   - id: product-analytics         (disabled unless profileName === 'desktop')
  +   - id: ui-settings-session-log
  -   - id: time-context  (disabled: true)
  -   - id: schedule      (disabled: true)
  -   - id: ui-schedule   (disabled: true)
$ diff -q b017/package/lib/index.js b020/package/lib/index.js          → identical
$ diff -q w017/package/lib/index.js w020/package/lib/index.js          → identical
$ diff -q w017/package/lib/startup.js w020/package/lib/startup.js      → identical
$ for f in presets/cordis.patch.yml presets/standard.patch.yml presets/ptc.patch.yml presets/minimal.patch.yml; do diff w017/package/$f w020/package/$f; done
  → 4 个 preset patch 文件全部 identical
$ diff -rq aw017/package aw020/package → 仅 package.json 不同（atomic-write 行为未变）
```
0.1.1 对照（现役 bundle 明显不同）：0.1.1 的 base bundle `settings` 行是 `name: '@deepseek-ai/dsh-settings-file'`，0.1.7/0.2.0 都是 `name: '@deepseek-ai/dsh-settings'`；0.1.1 的 web-app bundle 里 preset 行是 `- id: agent-presets / name: '@deepseek-ai/dsh-agent-presets' / config.default: standard`，0.1.7/0.2.0 都是 `- id: agent-preset-registry / name: '@deepseek-ai/dsh-agent-preset-registry' / config.default: standard`。

---

## 三、settings 机制结论（0.2.0）

### 3.1 定位与加载

- **角色**：`@deepseek-ai/dsh-settings` 在 0.1.7+ 是 `SettingsForms` 服务（`ctx.settings`），**不是**文件 provider。它把 Loader 里每个可寻址条目的 Config schema 投影成配置表单，并**通过 `configEditor` 把写入落到 profile patch**（`lib/index.js:322-342`）。
- **挂载**：base bundle `- id: settings / name: '@deepseek-ai/dsh-settings' / disabled: !!js "!ctx.get('profileContext')"`（`b020/package/cordis.patch.yml`，与 `b017` 同）。依赖 `static inject = ["configEditor","profileContext"]`（`:325`）。
- **命名空间来源**：`describe()` 遍历 `configEditor.configuration()`，只保留 `entry.fiber.state === 2` 且 `runtime.Config` 可投影的条目，`ns` 直接取 **`entry.options.id`**（`:413-420`、`:443`）。⇒ **settings 命名空间 = profile 插件条目 id**，不再是插件自选名。
- **可编辑字段判定**：`volatileForm()` 只保留带 `.volatile()` 的字段（`lib/types/schema.js:122-131`），`isVolatilePath()` 决定某路径是否可写（`:153-158`）。
- **没有独立的"用户层文件"**：`documentPath` 就是 `configEditor.documentPath` = `profileContext.patchPath`（`:400-402`；`dsh-config-editor/lib/index.js:24-25`）。`writable` 恒为 `true`（`:396-398`）。

### 3.2 `settings.yaml` 的最终归宿：**只读一次，然后被改名**

`SettingsForms` 构造时注册：
```js
ctx.root.loader.await().then(() => this.importLegacyDocument()).catch((error) => { ctx.logger.error(error); });
```
（`lib/index.js:339-341`）

`importLegacyDocument()`（`:343-363`）逐步行为：

1. `const path = join(profile.home, "settings.yaml")`（`:348`）——`profile.home = resolveDshHome()`，即 **`$DSH_HOME/settings.yaml`**（`cli020/package/lib/profile-boot-BZ2ZjNWi.js:267`、`:110-115`）。
2. 不存在则直接返回（`:349`）。
3. **先 `rename(path, path + ".imported")`**，再读 `.imported`（`:351-352`）——"改名前先落盘，部分导入永不重放"。
4. 逐段：`const ns = LEGACY_SECTION_ENTRIES[section] ?? section;` 然后 `await this.update(ns, values)`（`:353-356`）。
5. 抛错时 **只 warn，不中断**：`logger.warn("settings: section %s of %s was not imported into entry %s", …)` + `logger.warn(error)`（`:357-360`）。
6. 结束后 `logger.info("settings: imported %s into profile %s", …)`（`:362`）。

**官方重映射表**（`LEGACY_SECTION_ENTRIES`，`:302-308`）：

| 旧 settings.yaml 段名 | 目标条目 id |
|---|---|
| `ui-developer-tools` | `ui-settings` |
| `ui-onboarding` | `ui-settings-general` |
| `shell` | `win32 ? 'pwsh-sandbox' : 'bash-sandbox'` |

### 3.3 未知键 / 未知命名空间的处理策略

**结论：全部"警告 + 跳过"，没有任何一处会 fail loud，也不会写回任何提示文件。**

| 场景 | 代码位置 | 行为 |
|---|---|---|
| 段落对应的条目 id 不存在 | `lib/index.js:502-504` `throw new Error(\`No configurable plugin entry "${ns}"\`)` | 被 `:357` catch → `logger.warn` → **整段不导入**，值只留在 `settings.yaml.imported` |
| 条目存在但该插件加载失败 / 无 `runtime.Config` | 同上（`schema(entry)` 返回 `undefined`，`:538-541`） | 同上 |
| 条目存在但没有 volatile 字段 | `:505-506` `throw ... has no volatile fields` | 同上（整段丢弃，即使键合法） |
| 段落里含**非 volatile 键** | `:507`（显式路径）/ `:513-523` `validatePaths(next, form)` | 同上（整段丢弃） |
| 条目 id 存在、根 Config 整体 volatile | `isVolatilePath` 在根即 `true`（`schema.js:153-158`） | **任意未知键都会被写入**（不报错），随后由 schemastery 解析时被忽略 ⇒ **更隐蔽的静默失效** |
| profile patch 里 target 指向不存在的 id | `dsh-app-boot/lib/index.js:2760` schema 描述原文："Unknown targets and non-insert patches without a nonempty id are **warned and skipped**." | warn + 跳过，不报错 |

**注意**：`loader.await()` 用 `Promise.allSettled`，且 entry import 失败被 `Entry._init` 吞成 `logger.error`（`cordis-plugin-loader/lib/index.js:154-160`、`:448-457`），因此**某个插件模块加载失败不会阻止 legacy 导入流程继续执行**——只是那段必然导入失败。这一点已通过读 loader 源码澄清（初判"会整体中断"不成立）。

### 3.4 是否新增校验 / 迁移 / 版本字段

- `grep -n "migrat\|version" s020/package/lib/index.js` → **无输出**：settings 包中不存在 schema 版本字段、不存在迁移框架。
- 唯一"迁移"逻辑就是 3.2 的 legacy 段落导入，且它**在 0.1.7 就已存在**（代码逐字节相同）。
- schema dump 文档顶层字段（`dsh-app-boot/lib/index.js:2919-2937`）：`$schema`（JSON Schema 2020-12）、`title`、`description`、`$comment`、`type: "array"`、`items`、`$defs`、`x-cordis: { profile, complete, entries, diagnostics, patchSchema }`。**没有 `x-dsh-schema-version` 之类的版本字段。**
- 新增的"版本/兼容"机制属于 **app-boot 层**且是相对 0.1.1 新增：`PROFILE_COMPATIBILITY_FILENAME = "compatibility.json"`（`:328`）、`readProfileCompatibility`（`:359+`）、`evaluatePluginCompatibility` / `pluginCompatibilityWarning`（`:320-324`）、`setProfileVersionExemption`（`dsh plugin allow-version`）。两个现役安装目录下都**没有** `compatibility.json`，所以 0.2.0 首启时是"无豁免、可改写"状态。

---

## 四、schema 逐键差异（0.1.7 → 0.2.0）

本节逐一比对"现役 settings.yaml 12 段"落在 0.2.0 里的宿主条目与 Config schema。**判定 = 键是否仍被 schema 接受且 volatile。**

### 4.1 产品插件（有官方 0.2.0 版本，代码可逐字节对比）

| 命名空间 | 0.2.0 宿主条目 id | 宿主条目来源 | Config schema（0.2.0） | 与 0.1.7 差异 |
|---|---|---|---|---|
| `agent-default-model` | `agent-default-model` ✓ | base bundle `b020:…`，`name: '@deepseek-ai/dsh-agent-default-model'` | `provider: z.string().required().volatile()`、`model: z.string().required().volatile()`、`reasoningEffort: z.string().volatile()` | **逐字节相同**（两版 `lib/index.js:21-25` 一致） |
| `llm-pi-ai` | `llm-pi-ai` ✓ | base bundle `b020:127-128`，`name: '@deepseek-ai/dsh-llm-pi-ai'` | `z.object({ providers: z.dict(profile).default({}).volatile() })`（`:1047`） | **整个 `lib/index.js` diff = 0 行**；`profile` 子 schema 含 `apiKeyEnv`/`displayName`/`api`/`baseURL`/`models[]`(`id`,`contextWindow`,`maxTokens`,`input`,…)/`modelOverrides`/`compat`/… 全部未变 |
| `llm-deepseek` | `llm-deepseek` ✓ | base bundle，`name: '@deepseek-ai/dsh-llm-deepseek-api-key'` | （段为空 `{}`，无键可校验） | 条目 id/name 未变 |
| `web-search-deepseek` | `web-search-deepseek` ✓ | base bundle，`name: '@deepseek-ai/dsh-web-search-deepseek'` | `apiKey`(role=secret) / `apiKeyEnv`(role=credential-ref, default `DEEPSEEK_API_KEY`) / `baseURL` / `model` / `apiVersion` / `maxTokens` / `maxUses` — **全部 volatile** | **逐字节相同**（`lib/index.js:236-244` vs `:276-284`） |
| `ui-theme` | `ui-theme` ✓ | web-app bundle `w020:236`，`name: '@deepseek-ai/dsh-client-ui-theme'` | `preference: z.union([...THEME_PREFERENCES]).default(DEFAULT_PREFERENCE).volatile()`、`fontSize: z.number().step(1).min(12).max(17).default(14).volatile()` | **逐字节相同**（`:80-83`） |
| `ui-onboarding` | **重映射为** `ui-settings-general` | web-app bundle `w020:291`，`name: '@deepseek-ai/dsh-client-ui-settings-general'` | `z.object({ welcomeNoticeVersion: z.string().volatile() })`（`lib/index.js:4`） | **逐字节相同** |
| `agent-presets` | **✗ 不存在该 id**（已改名 `agent-preset-registry`） | web-app bundle `w020:562-565`，`name: '@deepseek-ai/dsh-agent-preset-registry'` | `default: z.string().required()`（**非 volatile**）、`selectedDefault: z.string().volatile()` | **条目 id 改名**（0.1.7 已是 `agent-preset-registry`）；且 `default` 非 volatile ⇒ 即便手动改 target 也**不能**通过 settings 写入 |

**`llm-pi-ai` 的额外校验**（`lib/index.js:1060-1065`，两版相同）：`rejectRemovedFields()` 只拒绝三个字段——`provider`（已移到 dict key）、`maxRetries`、`maxRetryDelayMs`。现役 `providers.adam` 的键为 `apiKeyEnv` / `api` / `baseURL` / `models[]`，**不在拒绝名单内，且全部命中 `profile` schema** ⇒ `llm-pi-ai` 段在 0.2.0 完全可用。

### 4.2 树外/本地插件（无 0.2.0 兼容版本）

| 命名空间 | 现役宿主条目 id | 0.2.0 条目 id 是否匹配 | 插件 `@deepseek-ai/dsh-settings` API 用法 | 判定 |
|---|---|---|---|---|
| `vision-adam` | `vision-adam` | ✓ **ID 匹配** | `import { installSettingsSection, settingsNamespace }`；`settingsNamespace("vision-adam")`；`installSettingsSection(ctx, NS, Config, config, …)`（`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js:3,81,227`） | **加载即失败**（导出不存在）；版本 0.2.0（本地版），`.dsh` 与 `.dsh-017` 两份同版本同写法 |
| `wallpaper` | `wallpaper` | ✓ **ID 匹配** | `import { settingsNamespace }`；`settingsCtx.settings.register(WALLPAPER_NAMESPACE, WallpaperSettingsSchema)`（`@local/dsh-wallpaper/lib/index.js:17,30,167`） | **加载即失败** + `settings.register` API 已不存在 |
| `dsh-workerspace` | `workerspace` | ✗ **不匹配**（`dsh-workerspace` ≠ `workerspace`） | `installSettingsSection` + `settingsNamespace("dsh-workerspace")`（`@local/dsh-workerspace/lib/index.js:30,41`） | 双重失败；段本身为 `{}`，无实际损失 |
| `dsh-ssh-gui` | `ssh-gui` | ✗ **不匹配** | `installSettingsSection` + `settingsNamespace('dsh-ssh-gui')`（`@local/dsh-ssh-gui/lib/index.js:49,68`） | 双重失败；段有真实配置 |
| `dsh-subagent` | `dsh-subagent-model` | ✗ **不匹配** | `installSettingsSection(ctx, NS, Config, …)`，`NS = settingsNamespace("dsh-subagent")`（`@local/dsh-subagent-model/lib/index.js:19,26,46`） | 双重失败；且 0.2.0 的 `dsh-tool-subagent` **不再读该命名空间**（见 4.3） |

其它同样受影响的本地插件（非这 12 段但同因崩溃）：`@local/dsh-web-search-sse`（注册命名空间 `web-search-deepseek-sse`）、`@local/dsh-usage`（`settings.register("dsh-usage", Config)`）、`@local/dsh-btw`（导入 `settingsNamespace`）。

### 4.3 `dsh-subagent` 的语义变化（重点）

- 0.2.0 的 `@deepseek-ai/dsh-tool-subagent` 的 `lib/index.js` 与 0.1.7 **逐字节相同**，其路由来源是服务 `subagentModelSelection`：
  ```
  :586  const settings = ctx.get("subagentModelSelection");
  :587  if (settings === void 0) throw new Error("tool-subagent: `modelSelectionSettings` requires @deepseek-ai/dsh-tool-subagent/model-selection-settings in the Host scope");
  ```
- 该服务的条目是 web-app bundle 的 `- id: subagent-model-selection-settings / name: '@deepseek-ai/dsh-tool-subagent/model-selection-settings'`（`w020:64-66`；`w017` 同），其 Config：
  ```
  static Config = z.object({
      enabled: z.boolean().default(false).volatile(),
      allowedModels: z.array(AllowedModelRouteSchema).default([]).volatile()
  });
  ```
  （`lib/model-selection-settings.js:43-46`；两版 identical）
- ⇒ **`dsh-subagent:` 段在 0.2.0 已无消费者**。其 `model: deepseek-v4-pro` 必须迁移为 `subagent-model-selection-settings` 的 `enabled` + `allowedModels`（否则子代理模型回落到 agent preset 的静态默认）。

---

## 五、12 命名空间逐个处置

判定标准：**能否被 0.2.0 的 legacy 导入自动接住**（条目 id 匹配 + 键存在 + 键 volatile），以及**是否需要人工搬运**。

| # | 段名 | 段内容（键） | 0.2.0 目标条目 | 自动导入 | 处置 | 理由与依据 |
|---|---|---|---|---|---|---|
| 1 | `ui-onboarding` | `welcomeNoticeVersion` | `ui-settings-general`（重映射） | ✅ 可 | **保留（无需改动）** | `LEGACY_SECTION_ENTRIES` 已把 `ui-onboarding`→`ui-settings-general`；目标 Config `{ welcomeNoticeVersion: z.string().volatile() }` 两版逐字节相同（`settings/lib/index.js:305`；`client-ui-settings-general/lib/index.js:4`） |
| 2 | `llm-deepseek` | 空（内联 `{}`） | `llm-deepseek` | ✅ 可（无键） | **删除该段** | 空 map 无信息；导入 `{}` 也只会触发一次无意义的 patch 写入（`update()` → `mergeLayers(current,{})`，若与继承层深等则被 `isDeepStrictEqual` 分支删空，`config-editor:99`） |
| 3 | `llm-pi-ai` | `providers.adam.{apiKeyEnv, api, baseURL, models[]}` | `llm-pi-ai` | ✅ 可 | **保留，逐字搬运** | 条目 id/name 未变（`b020:127-128`）；插件代码 0.1.7↔0.2.0 diff=0；`providers` 为 volatile；`adam` 各键全部命中 `profile` schema 且不在 `rejectRemovedFields` 名单（`llm-pi-ai/lib/index.js:1047,1060-1065`）。**这是全量 provider 目录 + 凭据引用，务必整体迁移** |
| 4 | `agent-default-model` | `provider=adam`, `model=deepseek-v4-pro` | `agent-default-model` | ✅ 可 | **保留** | 两键均 `required().volatile()`；条目 id 存在于 base bundle。注意 0.2.0 bundle 基线为 `provider: deepseek-official / model: deepseek-flash`，用户段会以 profile-patch 形式覆盖。可**补默认** `reasoningEffort`（0.2.0 支持，非必填） |
| 5 | `vision-adam` | `model, baseURL, apiKeyEnv, maxTokens` | `vision-adam` | ❌ 否 | **暂缓：需先把本地插件改造为 0.2.0 settings 形态，否则删除该段** | 条目 id 匹配，但插件 `installSettingsSection` 导出已删（探针实测）；`entry.fiber.runtime` 为 null ⇒ `settings(entry)` 返回 undefined ⇒ 按 `settings/lib/index.js:504` 抛 "No configurable plugin entry" → warn 丢弃 |
| 6 | `agent-presets` | `default=standard-glm` | **无此 id**（应为 `agent-preset-registry`） | ❌ 否 | **改名搬运（手工）**：写成 profile patch 的 `- id: agent-preset-registry` + `config.default: standard-glm` | 条目 id 已改名为 `agent-preset-registry`（`w020:562-565`，`w017` 同）；且 `default` **非 volatile**（`:471-474`），settings 表单/legacy `update()` 都写不进去（`write()` 的 `validatePaths` 会抛 "not volatile"，`:513-523`）；必须走 patch 条目 config |
| 7 | `web-search-deepseek` | `baseURL, model, maxUses` | `web-search-deepseek` | ✅ 可 | **保留** | 三键在 0.2.0 schema 中均存在且 volatile（`lib/index.js:276-284`）；bundle 基线仅 `apiKeyEnv: DEEPSEEK_API_KEY` |
| 8 | `wallpaper` | `global.{source, darkMask, opacity, blur}` | `wallpaper`（条目 id 匹配） | ❌ 否 | **暂缓：随本地插件改造一并处理；否则该段整体丢弃** | 插件用已删除的 `settingsNamespace` + `settings.register`（`@local/dsh-wallpaper/lib/index.js:17,30,167`）。`source` 指向 `$DSH_HOME/dsh-wallpaper/media/…` 的绝对路径，搬 home 时需同步拷媒体文件（见第八节） |
| 9 | `dsh-workerspace` | 空（内联 `{}`） | 条目 id 应为 `workerspace`（不匹配） | ❌ 否（但无损失） | **删除该段** | 段为空；且命名空间名 `dsh-workerspace` ≠ 条目 id `workerspace`，导入必然失败并产生一条 warn 噪声 |
| 10 | `dsh-ssh-gui` | `file.maxBytes, exec.timeoutMs, exec.maxOutputBytes, security.confirmExec, security.execAllowlist` | 条目 id 应为 `ssh-gui`（不匹配） | ❌ 否 | **手工搬运**：把 5 个键写成 profile patch 的 `- id: ssh-gui` + `config: {...}`（并在本地插件改造后把命名空间对齐为条目 id） | 命名空间名 ≠ 条目 id（`settingsNamespace('dsh-ssh-gui')` vs 现役 patch 行 `- id: ssh-gui`）；即使插件改造好，`LEGACY_SECTION_ENTRIES` 也没有这条映射 ⇒ 必须人工改 target。键本身无害（`confirmExec: true`、`execAllowlist: []`） |
| 11 | `ui-theme` | `preference=light` | `ui-theme` | ✅ 可 | **保留** | 条目 id 匹配（`w020:236`），`preference` volatile，且 0.2.0 多了可选键 `fontSize`（default 14，可**补默认**） |
| 12 | `dsh-subagent` | `model=deepseek-v4-pro` | 条目 id 应为 `dsh-subagent-model`（不匹配）；语义宿主已变为 `subagent-model-selection-settings` | ❌ 否 | **语义改名 + 人工搬运**：转为 `- id: subagent-model-selection-settings` 的 `enabled: true` + `allowedModels: [...]` | 见 4.3：0.2.0 的 `dsh-tool-subagent` 读 `subagentModelSelection` 服务而非 `dsh-subagent` settings 段；命名空间名与条目 id 也不匹配 |

**小结（12 段 = 6 + 1 + 5）**：
- **6 段可被 legacy 导入自动接住**：`ui-onboarding`、`llm-deepseek`（空段，无需导入）、`llm-pi-ai`、`agent-default-model`、`web-search-deepseek`、`ui-theme`；
- **1 段建议直接删除**：`dsh-workerspace`（空段 + 命名空间名与条目 id 不符，导入只会产生 warn 噪声）；
- **5 段必须人工搬运或随本地插件改造**：`agent-presets`（条目改名）、`vision-adam`、`wallpaper`（两者依赖本地插件先行改造）、`dsh-ssh-gui`、`dsh-subagent`（命名空间名与条目 id 不符 / 语义宿主变更）。

---

## 六、writer 与原子性

### 6.1 0.2.0 中谁写配置

**唯一 writer：`@deepseek-ai/dsh-config-editor` 的 `ConfigEditor.edit()`**（`ce020/package/lib/index.js:69-135`）。
`settings.yaml` 在 0.2.0 中**没有任何 writer**：
```
$ grep -rl "settings.yaml" /home/CNS2026495165/dsh/.workspace/dsh-020-pkg/x/package/   → 无输出
$ grep -c "dsh-settings-file" <0.2.0 CLI package.json>                                 → 0
$ grep -n "settings\.yaml" s020/package/lib/index.js
  302 / 343 / 348   ← 仅注释与 legacy 读取路径
```

写入链条（`settings.update/replace/mutate` → `write` → `configEditor.edit`）：

| 环节 | 位置 | 行为 |
|---|---|---|
| 入参 JSON 化 | `settings/lib/index.js:471,480,489` + `cloneJsonShaped` `:237-273` | 只接受 JSON 数据；`Date`/`Map`/`BigInt`/非有限数/循环引用在建栈前就按 `$` 路径抛错 |
| 条目/schema 解析 | `:502-507` | 条目不存在、无 Config、无 volatile 字段、路径非 volatile → 抛错（对 legacy 导入即 = 丢弃该段） |
| 并发保护 | `:511` `SettingsConflictError`（`expectedRevision` 不符即拒绝） | 防陈旧编辑器覆盖 |
| 落盘 | `config-editor/lib/index.js:72` `await withFileLock(join(profile.dir, "package.json"), …)` | **跨进程文件锁**，锁对象是 profile 的 `package.json` |
| 写前校验 | `:76-95` `reconcileProfilePatches` → `resolveConfig(fiber.runtime, resolved)` | 先按 schemastery 全量校验新配置，不通过不写 |
| 原子替换 | `:123` `await writeFileAtomic(path, String(document), { mode: 384 })` | `384` = `0o600`；`@deepseek-ai/dsh-atomic-write` 提供 `writeFileAtomic` / `withFileLock`（该包 0.1.7↔0.2.0 仅 package.json 版本不同，**行为未变**） |
| 失败回滚 | `:125-130` | 若 `reconcileProfilePatches` 抛错，用同一原子写把 `before` 原文写回，再 reconcile 回旧状态 |

### 6.2 是否新增"写回规范化 / 重排 / 丢注释"

**没有新增规范化，也没有丢注释。** 具体：

- **注释保留**：`:96-97` 用 `yaml.parseDocument(before, { customTags: [{ tag: 'tag:yaml.org,2002:js', … }] })` 解析原文本，再用 `document.setIn([index,'config'], document.createNode(next))` / `document.add(...)` 修改，最后 `String(document)` 序列化 ⇒ 既有注释（含文件头注释、行内注释）保留。
- **唯一格式规范化**：`:97` `document.contents.flow = false` —— 顶层序列强制块式（若原 patch 用 flow 风格会被改成块式）。
- **唯一"内容消失"行为**：`:99-105` 当 `isDeepStrictEqual(next, inherited)` 时，删除该条目的 `config:` 键；若删后该行仅剩 `id`/`name` 则整行删除。⇒ **把配置写成与继承层完全相同的值 = 被抹掉**（等价语义，但文件里不再留痕）。
- **`!!js` 表达式保留**：`:113-121` 用 `visit` 把单键 `__jsExpr` 映射重建为 `tag:yaml.org,2002:js` Scalar。
- **overlay 保护**：`:120-121` 若写入结果会被 home patch（`$DSH_HOME/cordis.patch.yml`）或命令行 `--patch` 覆盖，直接抛错拒绝（`Configuration for "…" is overridden by a home patch or command-line overlay`）。两份现役安装都**没有** home patch 文件，故不构成阻碍。
- **`settings.yaml` 本身不会被重写**：导入用 `rename`（字节不动），成功导入的段落到 `cordis.patch.yml`；未成功的段落以原始字节留在 `settings.yaml.imported`。

### 6.3 0.1.1 的 writer（对照，用于判断现役文件的"可迁移性"）

0.1.1 的 provider 是 `@deepseek-ai/dsh-settings-file`：
```
:31   const filename = resolve(config.path ?? join(resolveDshHome(config.dshHome), "settings.yaml"));
:117  await withFileLock(this.spec.filename, …)
:170  await writeFileAtomic(this.spec.filename, output, { … })
```
其 `renderYaml()` 注释原文："Render the next YAML text by patching one namespace in the **comment-preserving** document. The next section lands as a leaf-level diff … so comments inside the section survive edits to their siblings"。⇒ 现役 `settings.yaml` 同样是"注释保留 + 原子写 + 跨进程锁"产物，**没有历史规范化损伤**，可安全作为迁移输入。

### 6.4 0.1.7 → 0.2.0 writer 差异（唯一一处）

`dsh-config-editor` 两版只差 1 个 hunk，在 `configuration()`：

```diff
-			return this.entries().map((entry) => ({
-				entry,
-				inherited: this.inherited(entry, loaded),
+			const entries = this.entries();
+			const overridden = new Set(loaded.patches.filter((p) => p.insert === void 0 && Object.hasOwn(p, "config")).map((p) => p.id));
+			const composed = new Map();
+			if (entries.some((entry) => !overridden.has(entry.options.id))) {
+				for (const row of flatten(composeEntries([...loaded.layers.map((l) => l.patches), loaded.patches]))) if (!composed.has(row.id)) composed.set(row.id, row);
+			}
+			return entries.map((entry) => ({
+				entry,
+				inherited: overridden.has(entry.options.id) ? this.inherited(entry, loaded) : structuredClone(composed.get(entry.options.id)?.config ?? {}),
```
（`ce017/lib/index.js` vs `ce020/lib/index.js:39-51`）

影响面：**只有"未被 profile patch 显式覆盖的条目"的 `inherited`（= settings 视图的 `base` 层，以及 `edit()` 里判定"是否与继承层相等"的基准）** 取值路径变了。它不改变写入目标、不改变原子性、不改变注释策略；但在 `:99` 的"与继承层深等则删键"判定上可能让某些写入从"被删"变成"保留"（或反之）。对本迁移的实际影响：**导入 legacy 段落时，"值与 bundle 基线相同"的键更可能被识别为继承值而不再写进 patch 文件**——属于良性的去冗余，但会让"patch 文件里看不到该键"。

---

## 七、默认 profile 组合的变化

### 7.1 0.1.7 → 0.2.0 的全部差异（穷举）

**base bundle `cordis.patch.yml`（2 个 hunk）：**
1. 新增 `- id: otel / name: '@deepseek-ai/dsh-otel'`（无 config）。
2. `session-telemetry-otel` 配置修改：
   - `config.maxRequestBytes: 4000000`（**新增键**）
   - `exporter.url` 默认值 `https://harness-telemetry.deepseeksvc.com/v1/logs` → `https://dsh-otel-collector.deepseeksvc.com/v1/logs`
   - 仅注释文本变化（批量/超时语义说明）

**web-app bundle `cordis.patch.yml`（3 个 hunk）：**
3. 新增 `- id: desktop-product-telemetry / name: '@deepseek-ai/dsh-host-product-telemetry-otel'`，`disabled: !!js "ctx.get('profileContext')?.name !== 'desktop'"`。
4. 新增 `- id: product-analytics / name: '@deepseek-ai/dsh-client-product-analytics'`，同样仅 desktop profile 启用。
5. 新增 `- id: ui-settings-session-log / name: '@deepseek-ai/dsh-client-ui-settings-session-log'`。
6. **删除** `- id: time-context`（原 `disabled: true`）。
7. **删除** `- id: schedule`（原 `disabled: true`）。
8. **删除** `- id: ui-schedule`（原 `disabled: true`）。
9. `package.json` 依赖相应移除 `@deepseek-ai/dsh-time-context` / `dsh-schedule` / `dsh-client-ui-schedule`。

**app-boot `lib/index.js`（1 行）：**
10. `OPTIONAL_BUNDLES += "@deepseek-ai/dsh-experimental-schedule-bundle"`（`dsh-app-boot/lib/index.js:552-556`）。

**presets / 运行时代码：**
11. `presets/{cordis,standard,ptc,minimal}.patch.yml` 四个文件 **identical**。
12. `dsh-base/lib/index.js`、`dsh-web-app/lib/index.js`、`dsh-web-app/lib/startup.js`、全部 `cli/lib/*.js`、`cli/lib/types/*`、`dsh-settings/*`、`dsh-atomic-write/*`(除 package.json) **全部 identical**。

### 7.2 会改变现役行为的默认值变化（逐项核对）

| 关注点 | 0.2.0 基线值 | 与 0.1.7 相比 | 会不会改变现役行为 |
|---|---|---|---|
| **agent preset 默认值** | `agent-preset-registry.config.default: standard`（`w020:562-565`） | **未变** | ❌ 不会（但**现役用户段覆写为 `standard-glm`**，见第五节 #6——该覆写会因条目改名而失效，从而回落为 `standard`。这是本次迁移**唯一真正会改变现役 agent 行为**的默认值风险） |
| **model 默认值** | `agent-default-model.config: { provider: deepseek-official, model: deepseek-flash }`（base bundle） | **未变** | ❌ 不会（现役覆写为 `adam` / `deepseek-v4-pro`，需成功迁移） |
| **sandbox 默认** | `sandbox-policy.config.mode: !!js process.env.DSH_PERMISSION_MODE ?? 'workspace-write'`；`sandbox` 行无 config | **未变** | ❌ 不会 |
| **approval 默认** | `approval.config.policy: !!js "(process.env.DSH_PERMISSION_MODE ?? 'workspace-write') === 'danger-full-access' ? 'never' : 'ask'"` | **未变** | ❌ 不会 |
| **permission presets** | `permission.config.presets: { read-only: {sandbox: read-only, approval: ask}, workspace-write: … }` | **未变** | ❌ 不会 |
| **技能默认开关** | base bundle `skill` / `skill-filesystem` 启用，`skill-badge` `disabled: true`；`tool-skill` 启用；web-app bundle 关闭 base 的 host 级 `skill-filesystem` 由 preset 拥有 | **未变**（bundle 与 4 个 preset 文件均 identical） | ❌ 不会 |
| **工具默认开关** | `presets/standard.patch.yml`：`tool-bash`(非 win32) / `tool-pwsh`(win32) / `tool-fs` / `tool-fs-search` / `tool-jobs` / `skill-filesystem` / `tool-skill` / `tool-goal` / `tool-ask-user` / `tool-todo` / `tool-web` / `tool-workflow` 启用；`tool-ralph` disabled、`tool-plugin-manager` disabled、`tool-subagent-codex`/`-claude-code` disabled | **未变** | ❌ 不会 |
| **Schedule / time-context** | web-app bundle 中**不存在**这些行；改由可选 bundle `dsh-experimental-schedule-bundle` 提供并列入 `OPTIONAL_BUNDLES` | **变了**（0.1.7 是"存在但 disabled"，0.2.0 是"不存在"） | ⚠️ 功能等价（0.1.7 也是关闭的），但**若 profile patch 里有针对 `schedule`/`time-context`/`ui-schedule` 的行，会变成"未知 target → warn + 跳过"**。两份现役用户 patch 均未涉及这三个 id ⇒ 实际无影响 |
| **新增遥测行** | `otel`、`session-telemetry-otel(maxRequestBytes)`、`desktop-product-telemetry`、`product-analytics` | **新增** | ⚠️ `otel` 无条件挂载；`desktop-*` 仅 desktop profile。现役是 web profile ⇒ 只多一个 `otel` 行，需在执行档确认其不产生外部网络副作用（`session-telemetry-otel` 默认 `FEEDBACK_ONLY`） |
| **`compatibility.json` 强制** | 相对 **0.1.1** 新增（app-boot 从无到有）；相对 0.1.7 未变 | 0.1.7→0.2.0 未变 | ⚠️ 迁移自现役 0.1.1 时是**新增门禁**：peer 不匹配的插件默认被 skip 并告警，需 `dsh plugin allow-version` 显式豁免 |

---

## 八、迁移动作清单（可直接执行）

> 前提假设（执行档按实际调整）：0.2.0 落在**全新隔离根**，`DSH_HOME=<NEW_HOME>`（`~/.dsh` 与 `~/.dsh-017` 均不得触碰）。所有"写入"都指写 `<NEW_HOME>/profiles/web/cordis.patch.yml`。

### A. 输入准备

- **A1** 备份并只读固化现役基线：`sha256sum ~/.dsh/settings.yaml`（应为 `0f19b0fe…`）、`~/.dsh/profiles/web/cordis.patch.yml`（`513413e7…`）。
- **A2** 把 `~/.dsh/settings.yaml` **复制**（不是移动）到 `<NEW_HOME>/settings.yaml`，供一次性 legacy 导入。**不要**在 `~/.dsh` 原地启动 0.2.0——否则 `rename` 会把现役活文件改成 `settings.yaml.imported`，0.1.1 实例后续写入会重建一份分歧文件。
- **A3** 同步拷入 `~/.dsh/.credentials.yaml`（凭据存储，**不在本报告处理范围，值不得抄录**）、`~/.dsh/.agent-presets/`（含 `standard-glm/`）、`~/.dsh/dsh-wallpaper/media/`（wallpaper `source` 指向的绝对路径）。
- **A4** 首次启动后立即 `sha256sum <NEW_HOME>/settings.yaml.imported` 与 A1 比对 ⇒ 必须**字节相等**（证明导入是 rename 而非重写）。

### B. 逐段处置（对应第五节）

| 段 | 动作 | 落地位置/形式 |
|---|---|---|
| `ui-onboarding` | **保留**，等自动导入 | 由 `LEGACY_SECTION_ENTRIES` 写入 `ui-settings-general` |
| `llm-deepseek` | **删除**（空段） | 从 `<NEW_HOME>/settings.yaml` 中移除，避免无意义 warn/写入 |
| `llm-pi-ai` | **保留**，自动导入 | 导入后必须核对：`providers.adam.models[]` 全量、`apiKeyEnv: ADAM_API_KEY` 仍在 |
| `agent-default-model` | **保留**，自动导入；可选**补默认** `reasoningEffort` | 覆盖 bundle 基线 `deepseek-official/deepseek-flash` |
| `vision-adam` | **暂缓（阻塞项）**：先按 0.2.0 形态改造 `@deepseek-ai/dsh-vision-adam`（去掉 `installSettingsSection`/`settingsNamespace`，改用条目 Config + `ctx.settings.configure`），再把 4 个键写成 `- id: vision-adam` 的 config；若本轮不改造，则**删除该段并接受 vision-adam 不可用** | `<NEW_HOME>/profiles/web/cordis.patch.yml` 行 config |
| `agent-presets` | **改名搬运（必做，否则 agent 行为静默变化）** | 改写为 `- id: agent-preset-registry` + `config: { default: standard-glm }`（`default` 非 volatile，只能走 patch config）；确认 `standard-glm` preset 已在 `<NEW_HOME>/.agent-presets/standard-glm/` |
| `web-search-deepseek` | **保留**，自动导入 | 覆盖 bundle 基线 `apiKeyEnv: DEEPSEEK_API_KEY` 的其余三项 |
| `wallpaper` | **暂缓（阻塞项）**：与 `@local/dsh-wallpaper` 改造一并处理；改造后条目 id 已是 `wallpaper`，可写成 `- id: wallpaper` 的 config（`global.{source,darkMask,opacity,blur}`），并确保媒体文件已随 A3 拷入 | 同上 |
| `dsh-workerspace` | **删除**（空段 + 命名空间名与条目 id 不符） | 从 settings.yaml 移除 |
| `dsh-ssh-gui` | **手工搬运**：写成 `- id: ssh-gui` + `config: { file: {maxBytes: 10485760}, exec: {timeoutMs: 30000, maxOutputBytes: 1048576}, security: {confirmExec: true, execAllowlist: []} }`；同时把本地插件的命名空间 `dsh-ssh-gui` 对齐为条目 id（或反之统一） | 同上 |
| `ui-theme` | **保留**，自动导入；可选**补默认** `fontSize: 14` | — |
| `dsh-subagent` | **语义改名 + 手工搬运**：改为 `- id: subagent-model-selection-settings` + `config: { enabled: true, allowedModels: [ { provider: adam, model: deepseek-v4-pro } ] }`（按 `AllowedModelRouteSchema` 实际形状核对）；对应地把 `@local/dsh-subagent-model` 改造或停用 | 同上 |

### C. 本地插件（与 settings 直接相关的阻塞项，必须与执行档联动）

- **C1** 6 个插件（`dsh-subagent-model`、`dsh-workerspace`、`dsh-ssh-gui`、`dsh-wallpaper`、`dsh-web-search-sse`、`dsh-usage`）+ `dsh-vision-adam` 需从 `installSettingsSection`/`settingsNamespace`/`settings.register` 改造为 0.2.0 形态：把可写字段声明 `.volatile()` 进插件 Config，用 `ctx.inject(['settings'], (child) => child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)))` 注册页面策略，值直接读 `config.<field>.get()`。**未改造的插件在 0.2.0 下模块加载即 `SyntaxError`**（探针实测）。
- **C2** 本地插件的 settings 段必须**改名为其 profile 条目 id**（`workerspace`、`ssh-gui`、`dsh-subagent-model`、`web-search-deepseek-sse`），否则即使插件改造完成，legacy 导入也接不住。
- **C3** 若本地插件的 peer 版本与 0.2.0 不匹配，`evaluatePluginCompatibility` 会 skip 该 bundle/插件；需用 `dsh plugin allow-version`（写 `<NEW_HOME>/profiles/<p>/compatibility.json`）显式豁免——但**先确认这是有意接受风险**，不要为绕过加载失败而盲目开豁免。

### D. 验证（0.2.0 侧）

- **D1** `<NEW_HOME>/profiles/web/cordis.patch.yml` 里应出现的条目：`ui-settings-general`(welcomeNoticeVersion)、`llm-pi-ai`(providers)、`agent-default-model`、`web-search-deepseek`、`ui-theme`，以及人工搬运的 `agent-preset-registry` / `ssh-gui` / `subagent-model-selection-settings`。
- **D2** 启动日志中**不得**出现 `settings: section … was not imported into entry …`（`settings/lib/index.js:358`）。出现即表示该段静默丢失。
- **D3** 对比 `<NEW_HOME>/settings.yaml.imported` 与 A1 基线哈希，逐段确认"可导入段"均已落到 patch 文件。
- **D4** 可用 `dsh --profile web --dump-config-schema` 导出组合 schema 做键级核对（见第九节注意事项）。

---

## 九、未验证项

以下条目本轨道**没有实测**，结论为源码/静态证据推导，执行档必须实跑确认：

1. **未实际启动任何 0.2.0 profile**，因此"12 段中哪些真的成功导入"是**静态推导**（依据：条目 id 存在性 grep + Config schema 键可见性 + `write()` 的分支条件），而非运行观测。缺 D2 的日志实证。
2. **未运行 `dsh --profile web --dump-config-schema`**。原因：`runDumpConfigSchema` 调 `prepareProfile(profile, true, fromDefaultProfile)`，README 明确"Profile initialization writes match the YAML dump"，且"Imports and lazy schema builders execute trusted module code" —— 在本轮隔离准备不足时运行可能产生 `$DSH_HOME` 内写入与插件顶层代码执行。**待执行档在隔离根内运行**，并注意 `x-cordis.complete === false` 时进程 `exitCode = 1`（`cli/lib/dump-config-schema-DhhNOaro.js`）。
3. **`dsh --dump-config-schema` 与 `--dump-config` 的实际 schema 内容差异**未取（因此"0.2.0 schema 相对 0.1.7 的键级 diff"这一问，我给出的是**插件 Config schema 级的逐键对照**，不是两个 dump 文件的逐键 diff —— 因两者在 0.1.7/0.2.0 代码逐字节相同，dump 输出差异只可能来自 bundle/preset 层，而该层差异已在第七节穷举）。
4. **`entry.options.id` 与插件注册命名空间的对应关系未穷举**：我只核对了现役 settings.yaml 涉及的 12 个命名空间 + 受影响的 7 个本地/树外插件；0.2.0 组合中"哪些条目带 volatile 字段从而成为可配置命名空间"未做全量枚举（settings 表单实际显示的命名空间总数未知）。
5. **`AllowedModelRouteSchema` 的精确字段形状未展开**（只知 `allowedModels` 是它的数组），故第五节 #12 的 `allowedModels` 示例形状需在执行档按包内 schema 校准。
6. **`@local/dsh-pptmaster`、`@local/dsh-usage`、`@local/dsh-btw`、`@local/dsh-logfile`、`dsh-workspace-enhancement` 的 0.2.0 兼容性未逐个验证**（仅确认 `dsh-usage`/`dsh-btw` 命中同一 settings API 断层；`dsh-pptmaster`/`dsh-logfile` 的 import 列表未逐行读）。
7. **0.1.7 隔离实例（3097）的实际运行状态未验证**：`.dsh-017/profiles/node_modules/` 下**没有** `@deepseek-ai/dsh` 与绝大多数 `@deepseek-ai/*`（只有 4 个），无法据此确认 3097 的真实运行根；且若它复用了那份本地插件，本地插件在 0.1.7 下同样应加载失败——**这条与协调者的既有认知可能冲突，建议交给 T01/T02 复核**（本轨道未触碰该实例，未 `ps`/未连端口）。
8. **未验证 `otel` 行的运行时副作用**（是否发起外联、`@deepseek-ai/dsh-otel` 的 Config 形状）。
9. **`profile.home` 在非默认 `DSH_HOME` 下的解析未实测**（仅由 `resolveDshHome()` 调用点断言）。
10. **并发/冲突语义未实测**：`SettingsConflictError` 与 `withFileLock(profile.dir/package.json)` 的真实并发行为未构造用例。

---

## 九之二、与其他轨道的交叉点（供协调者去重）

- **§4.3 / §5 #12（`dsh-subagent` 命名空间在 0.2.0 无消费者）** 与 `reports/T13-subagent-model-routing-compat.md` 主题重叠。本轨道只从"settings 命名空间注册/写入"角度给出结论；**子代理路由的最终处置请以 T13 为准**，本报告不重复其结论。
- **§7（bundle 默认组合差异）** 与 `reports/T01-upstream-package-delta.md` 的包级增量、`reports/T02-cli-boot-delta.md` 的 CLI 增量有交叠：本轨道只覆盖"影响配置/默认值/命名空间"的那部分，包级清单以 T01/T02 为准。
- **§8 C1（本地插件 settings API 断层）** 与 `reports/T08-local-plugin-inventory.md` 重叠，插件清单以 T08 为准。
- **§9 第 7 项（0.1.7 隔离实例 3097 的实际运行根存疑）** 建议交 T02/T25 复核。

## 十、附：本轨道产出的中间件（均在 `.workspace/audit-020/` 内，可复核）

- `pkgs/*.tgz` — 所有对比用 tarball（`dsh`、`dsh-settings`×3、`dsh-config-editor`、`dsh-base`、`dsh-web-app`、`dsh-app-boot`×3、`dsh-atomic-write`、8 个插件包 + `cordis-plugin-loader`）
- `pkgs/s011|s017|s020/` — 三个版本 settings 包的解包树
- `pkgs/cli011|cli017|cli020/`、`pkgs/b017|b020/`、`pkgs/w017|w020/`、`pkgs/ce017|ce020/`、`pkgs/aw017|aw020/`
- `pkgs/plugins/u/` — 插件包解包树
- `pkgs/node_modules/` — 探针依赖桩（stub）
- `pkgs/probe/p011.mjs|p017.mjs|p020.mjs` — ESM 命名导出存在性探针
- `probe/keys.mjs` — settings.yaml 结构安全导出脚本（只输出键名，不输出值）
