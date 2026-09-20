# 02 — 插件系统（plugin system）证据档

采集者：只读取证 subagent。采集时间：2026-09-20。工作目录 `/home/CNS2026495165/dsh`。
规则：每条断言一行，后接 `— 证据：path:line「verbatim quote」`。
`[VERIFIED]` = 本次直接读到文件/行；`[UNVERIFIED]` = 未在本次取证中确证（含"未读""仅文档转述""机制链未逐行复核"）。

路径约定：`$DSH_HOST` = `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh`
（部署宿主安装树；用 `$DSH_HOST/...` 简写，正文首次出现时给出全路径）。

---

## 0. 结论摘要（供文档作者先读）

- 本部署自写插件的**仓库根**在 `/home/CNS2026495165/dsh`，但**运行时装单位**在
  `~/.dsh/profiles/node_modules/@local/`（部署位），两者靠人工/脚本同步（**非符号链接**）。
- 插件契约 = cordis 插件（`name` / `inject` / `apply` / 可选 `Config`）+ 可选客户端 bundle
  （`window.__ModuleLoader__.load({id, factory})`，`id` 必须 == package.json `name`）。
- 入口**不在本仓库**：`~/.dsh/profiles/web/cordis.patch.yml` 的 `insert` 列表是唯一挂载入口。

---

## 1. 插件工作区仓库布局（逐目录）

### 1.1 `dsh-btw` —— 自写（上游 `@lukeknow0/dsh-side-chat` fork）
- 包名 `@local/dsh-btw`，版本 `0.4.0-btw.1`，`"main": "lib/index.js"`（ESM，`"type": "module"`）；有 host + client 双面。
  — 证据：`dsh-btw/package.json:2-3`「`"name": "@local/dsh-btw",` / `"version": "0.4.0-btw.1",`」
  — 证据：`dsh-btw/package.json:26`「`"main": "lib/index.js",`」
- 客户端 bundle 经 `exports["./client"]` 显式导出。
  — 证据：`dsh-btw/package.json:33`「`"./client": "./lib/client.js",`」
- 声明 `dsh.bundle.patch`（自带宽层 patch 文件）与 `dsh.client`（平台 web + inject 列表）。
  — 证据：`dsh-btw/package.json:73-76`「`"dsh": {` / `"bundle": {` / `"patch": "./cordis.patch.yml"` / `},`」
  — 证据：`dsh-btw/package.json:78-79`「`"client": {` / `"inject": [`」
- 产物实体：host 代码与 client bundle 都是可读的**未压缩** JS（client 8675 行），另有 `lib/typert.host.js` / `lib/typert.remote-client.js` 等额外导出。
  — 证据：`dsh-btw/lib/client.js:1-3`「`window.__ModuleLoader__.load({` / `id: "@local/dsh-btw",` / `factory: (require) => {`」
  — 证据：`dsh-btw/lib/index.js`（65970 字节，2026-09-18 10:51 构建产物）——本档只据 `ls -l dsh-btw/lib` 观测存在与大小，未逐行通读。

### 1.2 `dsh-usage` —— 纯自写（`author: CNS2026495165`）
- 包名 `@local/dsh-usage`，版本 `0.1.0`，`main: lib/index.js`，`type: module`。
  — 证据：`dsh-usage/package.json:3`「`"version": "0.1.0",`」
  — 证据：`dsh-usage/package.json:17`「`"main": "lib/index.js",`」
- `dsh.client.platform = web`，inject 仅 `@deepseek-ai/dsh-client-connection`。
  — 证据：`dsh-usage/package.json:34-37`「`"client": {` / `"platform": "web",` / `"inject": [` / `"@deepseek-ai/dsh-client-connection"`」
- 手写 client bundle（487 行、未压缩），自行以 `__ModuleLoader__.load` 注册，id == 包名。
  — 证据：`dsh-usage/lib/client.js:1-2`「`window.__ModuleLoader__.load({` / `id: "@local/dsh-usage",`」
- host 侧 `lib/` 为多文件手写模块（index/db/ingest-dsh/ingest-cc/rpc/charts/zstd），**非打包产物**。
  — 证据：`dsh-usage/package.json:11`「`"dsh-plugin",`」（关键词；仅辅助判据）＋本次 `ls -la dsh-usage/lib` 观测到 8 个 .js。

### 1.3 `dsh-taste` —— 命名为官方命名空间，实为本仓库自写源码
- 包名 `@deepseek-ai/dsh-taste`（**不是** `@local/*`），版本 `0.1.0`，`main: lib/index.js`，`exports["./client"] = ./lib/client.js`。
  — 证据：`dsh-taste/package.json:2-4`「`"name": "@deepseek-ai/dsh-taste",` / `"version": "0.1.0",` / `"type": "module",`」
  — 证据：`dsh-taste/package.json:9`「`"./client": "./lib/client.js",`」
- **无** `dsh.bundle.patch` 段（对照 dsh-btw/dsh-usage/dsh-wallpaper-local 都有）。挂载在 profile patch 里以 `name: '@deepseek-ai/dsh-taste'` 的 insert 完成。
  — 证据：`dsh-taste/package.json:11-20`（`dsh` 段只有 `client`，无 `bundle`）——本次 `cat -n` 全文确认。
  — 证据：`~/.dsh/profiles/web/cordis.patch.yml:19-21`「`- insert:` / `- id: taste` / `name: '@deepseek-ai/dsh-taste'`」
- 有 host（`lib/index.js` 27073 B）与 client（`lib/client.js` 794 行、未压缩）。
  — 证据：`dsh-taste/lib/client.js:1`「`window.__ModuleLoader__.load({`」

### 1.4 `dsh-wallpaper-local` —— 自写（上游 `@frog755/dsh-wallpaper` fork）
- 包名 `@local/dsh-wallpaper`，版本 `0.5.0`，`main: lib/index.js`，host+client 双面（`exports["./client"]`）。
  — 证据：`dsh-wallpaper-local/package.json:2-3`「`"name": "@local/dsh-wallpaper",` / `"version": "0.5.0",`」
  — 证据：`dsh-wallpaper-local/package.json:25`「`"main": "lib/index.js",`」
- `dsh.client` 带官方 4 个 inject，且 `"immediately": true`（首屏即执行，非懒加载）。
  — 证据：`dsh-wallpaper-local/package.json:51`「`"inject": [`」
  — 证据：`dsh-wallpaper-local/package.json:57-58`「`"platform": "web",` / `"immediately": true`」
- 有 `cordis.patch.yml`（含"移除了钉 9191 端口的 webserver 条目"的 fork 说明）。
  — 证据：`dsh-wallpaper-local/cordis.patch.yml:4-8`「`#   - The webserver entry that pinned DSH to port 9191 is REMOVED. This`」

### 1.5 `session-board` —— 自写，包在**子目录** `session-board/dsh-session-board/`
- **仓库根 `session-board/` 没有 package.json**；真正的插件包是同级子目录。
  — 证据：本次 `cat session-board/package.json` 返回「没有那个文件或目录」（否定证据，属本次观测）
- 包名 `@deepseek-ai/dsh-session-board`，版本 `0.1.0`，`main: lib/index.js`，**纯 host-only（无 `lib/client.js`、无 `exports` 段）**。
  — 证据：`session-board/dsh-session-board/package.json:2-5`「`"name": "@deepseek-ai/dsh-session-board",` / `"version": "0.1.0",` / `"type": "module",` / `"main": "lib/index.js",`」
- **无 `cordis.patch.yml`**：该目录下只有 CONTRACT.md / README.md / install.sh / lib / package.json / test。
  — 证据：本次 `ls -la session-board/dsh-session-board/` 输出中无 `cordis.patch.yml`
- lib/ 为 7 个手写模块（index/board/capture/grouping/inject/storage/tool），index.js 自带装配清单注释。
  — 证据：`session-board/dsh-session-board/lib/index.js:7-8`「`* 装配步骤顺序（§3，不得颠倒）：` / `*   0. 动态配置（settingsNamespace + installSettingsSection → current() 约定）`」

### 1.6 `pi-taste-analysis` —— **不是插件**，是调研/移植分析产物 + vendored 上游源码
- 仓库根 `pi-taste-analysis/` 无 package.json；内容为 `*.md` 分析档 + `vendor/pi-taste/`。
  — 证据：本次 `cat pi-taste-analysis/package.json` 返回「没有那个文件或目录」（否定证据）
  — 证据：`pi-taste-analysis/vendor/pi-taste/package.json:2-4`「`"name": "pi-taste",` / `"version": "0.5.6",` / `"description": "Local, transparent Taste learning for the Pi coding agent",`」
- 结论：这是 **Pi coding agent 的 TS 源码副本**（入口 `./index.ts`），作为移植 `dsh-taste` 的参考，不可挂载为 DSH 插件。
  — 证据：`pi-taste-analysis/vendor/pi-taste/package.json:5-7`「`"type": "module",` / `"types": "./index.ts",` / `"exports": {`」

### 1.7 `examples/minimal-plugin` —— 脚手架示例（见 §2）

### 1.8 运行时装单位（部署位）＝ `~/.dsh/profiles/node_modules/@local/`
- 目录实体（真实目录，不是符号链接）：
  `dsh-btw` / `dsh-pptmaster` / `dsh-ssh-gui` / `dsh-subagent-model` / `dsh-usage` / `dsh-wallpaper` / `dsh-workerspace`。
  — 证据：本次 `ls -la ~/.dsh/profiles/node_modules/@local/` 输出中各项 `drwxrwxr-x … dsh-usage` 等（无 `->` 箭头）
- 注意：**插件名 ≠ 目录名 **（`dsh-wallpaper-local/` → 部署目录 `@local/dsh-wallpaper`；`session-board/dsh-session-board/` → `@deepseek-ai/dsh-session-board`）。
  — 证据：`dsh-wallpaper-local/package.json:2`「`"name": "@local/dsh-wallpaper",`」＋本次 `ls ~/.dsh/profiles/node_modules/@local/` 有 `dsh-wallpaper`
- `[UNVERIFIED]` `session-board`（`@deepseek-ai/dsh-session-board`）在本次取证中**未**出现在 `~/.dsh/profiles/node_modules/@local/` 列表；其实际部署位置未确证（可能装在别处或由其它 profile 提供）。

---

## 2. 插件契约：`examples/minimal-plugin/` 全量

### 2.1 最小文件集
- README 明确：`package.json` + `lib/index.js`（**必选**）+ `lib/client.js`（**可选**，host-only 不需要）。
  — 证据：`examples/minimal-plugin/README.md:12-14`「`package.json    — @local/dsh-minimal-plugin（peer 依赖：cordis / dsh-tools / dsh-settings / schemastery）` / `lib/index.js    — 最小 host 插件：name/inject/apply + 1 个示例工具 minimal_hello + 可选 settings 段` / `lib/client.js   — 最小客户端骨架（**可选**：host-only 插件不需要；要 UI 才启用，见 §4）`」
- 该目录**没有** `cordis.patch.yml`：挂载靠 profile 层 insert，不在插件包内。
  — 证据：本次 `find examples -type f` 输出仅 `examples/minimal-plugin/{lib/index.js,lib/client.js,README.md,package.json}`

### 2.2 package.json 关键字段
  — 证据：`examples/minimal-plugin/package.json:2-3`「`"name": "@local/dsh-minimal-plugin",` / `"version": "0.1.0",`」
  — 证据：`examples/minimal-plugin/package.json:15`「`"main": "lib/index.js",`」
  — 证据：`examples/minimal-plugin/package.json:16-19`「`"exports": {` / `".": "./lib/index.js",` / `"./package.json": "./package.json"` / `},`」
  — 证据：`examples/minimal-plugin/package.json:28`「`"dependencies": {},`」（零运行时依赖）
  — 证据：`examples/minimal-plugin/package.json:30-33`「`"@deepseek-ai/cordis": "^4.0.1",` / `"@deepseek-ai/dsh-settings": "^0.1.1-rc.2",` / `"@deepseek-ai/dsh-tools": "^0.1.1-rc.2",` / `"@deepseek-ai/schemastery": "^3.18.1"`」

### 2.3 host 契约（4 个导出）
- 契约 = `name` / `inject` / `apply` / `Config`（可选）。
  — 证据：`examples/minimal-plugin/lib/index.js:3`「`// 契约（宿主 cordis 插件必需导出）：name / inject / apply / Config（可选）。`」
  — 证据：`examples/minimal-plugin/lib/index.js:80`「`export { Config, MINIMAL_SETTINGS_NS, apply, inject, name };`」
- `name` 用于 patch 的 insert 条目 id 语义。
  — 证据：`examples/minimal-plugin/lib/index.js:4-5`「`//   - name：插件 id，用于 cordis.patch.yml 的 insert 条目；`」
- `inject` 声明所需宿主服务（此处 `tools`），cordis 保证就绪后再 apply。
  — 证据：`examples/minimal-plugin/lib/index.js:18`「`const inject = ["tools"];`」
- 工具注册经 `ctx.tools.register(defineTool({...}))`。
  — 证据：`examples/minimal-plugin/lib/index.js:49-52`「`ctx.tools.register(` / `defineTool({` / `name: "minimal_hello",` / `description: "Minimal-plugin scaffold example: returns a greeting from settings.",`」
- 卸载清理用 `ctx.effect(() => () => {...}, "...")`。
  — 证据：`examples/minimal-plugin/lib/index.js:40-44`「`ctx.effect(` / `() => () => {` / … / `"dsh-minimal-plugin: cleanup",`」

### 2.4 挂载方式（拷贝 + profile patch insert）
  — 证据：`examples/minimal-plugin/README.md:21`「`cp -r examples/minimal-plugin ~/.dsh/profiles/node_modules/@local/dsh-minimal-plugin`」
  — 证据：`examples/minimal-plugin/README.md:29-30`「`在 \`~/.dsh/profiles/web/cordis.patch.yml\` 末尾追加（**insert 的 name 必须是 bare 包名**——` / `P0-a 实测：用文件路径名 insert 会在运行实例 import 失败并整次回滚）：`」
  — 证据：`examples/minimal-plugin/README.md:34-36`「`- insert:` / `- id: minimal-plugin` / `name: '@local/dsh-minimal-plugin'`」
- 热载观测手段：`curl -s http://127.0.0.1:3080/ | grep -o '"id":"[^"]*"' | grep minimal-plugin`。
  — 证据：`examples/minimal-plugin/README.md:43`「`# 观测：curl -s http://127.0.0.1:3080/ | grep -o '"id":"[^"]*"' | grep minimal-plugin`」

### 2.5 client 契约（可选面）
- 手写 bundle 惯例：`__ModuleLoader__.load({ id, factory })` 自注册，platform 种子词 `react` / `react/jsx-runtime` 可用。
  — 证据：`examples/minimal-plugin/lib/client.js:8-9`「`// 手写 bundle 惯例（@local/dsh-usage、@local/dsh-ssh-gui 先例）：` / `//   __ModuleLoader__.load({ id, factory }) 自注册；platform 种子词 react / react/jsx-runtime 可用。`」
- client 模块 `id` **必须等于** package.json `name`。
  — 证据：`examples/minimal-plugin/lib/client.js:12`「`id: "@local/dsh-minimal-plugin", // 必须 == package.json name`」
- 启用 client 还需在 package.json 增加 `dsh.client` 声明；**改后需重启 web 一次**。
  — 证据：`examples/minimal-plugin/README.md:54-55`「`- 要 UI 时：在 package.json 增加 \`dsh.client\` 声明（client-modules 扫描活动 loader 条目的` / `  package.json，改后需重启 web 一次）：`」
- `slots` 不存在时优雅降级（host-only 环境）。
  — 证据：`examples/minimal-plugin/lib/client.js:23-24`「`const slots = ctx.get("slots", false);` / `if (slots === undefined) return; // 无 UI 槽环境（host-only 场景）优雅降级`」
- 纪律：`id == 包名`、工具名前缀、高危走 `ctx.approval.request`。
  — 证据：`examples/minimal-plugin/README.md:89-91`「`- **id == 包名**（client 模块 id 必须等于 package.json name；master-runbook §1 事故 #6）。` / `- **工具名前缀**：\`ws_\`/\`minimal_\` 这类前缀避免与官方/其它插件重名。` / `- **安全**：高危操作走 \`ctx.approval.request\` 确认模态（fail-closed，见 workerspace ws_flash 先例）；`」

---

## 3. `cordis.patch.yml` 分布与代表性条目

### 3.1 本仓库根级（排除 node_modules / .workspace）只有 3 个
- `dsh-btw/cordis.patch.yml`、`dsh-usage/cordis.patch.yml`、`dsh-wallpaper-local/cordis.patch.yml`。
  — 证据：本次 `find . -name "cordis.patch.yml" -not -path "*/node_modules/*" -not -path "./.workspace/*"` 输出恰为上列 3 条
- 因此：**只有声明了 `dsh.bundle.patch` 的包才带 patch 文件**；`dsh-taste`、`session-board/dsh-session-board`、`examples/minimal-plugin` 都不带。
  — 证据：`dsh-btw/package.json:74-76`「`"bundle": {` / `"patch": "./cordis.patch.yml"` / `},`」

### 3.2 代表性条目（insert / 裸包名）
  — 证据：`dsh-btw/cordis.patch.yml:1-3`「`- insert:` / `- id: btw` / `name: '@local/dsh-btw'`」
  — 证据：`dsh-usage/cordis.patch.yml:1-3`「`- insert:` / `- id: usage` / `name: '@local/dsh-usage'`」
  — 证据：`dsh-wallpaper-local/cordis.patch.yml:9-11`「`- insert:` / `- id: wallpaper` / `name: '@local/dsh-wallpaper'`」

### 3.3 profile 层（运行入口）同时展示 insert / config / disable / `!!js` 表达式
  — 证据：`~/.dsh/profiles/web/cordis.patch.yml:1-3`「`# Your patch layer for this dsh profile, applied after every bundle layer:` / `# a top-level YAML array of loader patch entries (id-targeted config` / `# overrides, disables, and insert lists; \`!!js\` expressions allowed).`」
  — 证据：`~/.dsh/profiles/web/cordis.patch.yml:16-18`（id-targeted config 覆盖）「`- id: agent-presets` / `config:` / `default: standard-glm`」
  — 证据：`~/.dsh/profiles/web/cordis.patch.yml:72-73`（disable）「`- id: directory-picker` / `disabled: true`」
  — 证据：`~/.dsh/profiles/web/cordis.patch.yml:67-71`（`!!js` 表达式）「`- insert:` / `- id: dsh-pptmaster` / `name: '@local/dsh-pptmaster'` / `config:` / `root: !!js dshHomePath('office-ppt')`」
  — 证据：`~/.dsh/profiles/web/cordis.patch.yml:78-80`（注释说明 disable 动机：避免重复注册 directoryPicker）「`# 禁用 dsh-workspace-enhancement 的 SSH 目录选择器，避免与 browse 后端重复注册 directoryPicker` / `- id: directory-picker-ssh` / `disabled: true`」
- profile 自身的 manifest 声明了两个 bundle 层，并显式开启补丁热重载。
  — 证据：`~/.dsh/profiles/web/package.json:9-14`「`"dsh": {` / `"profile": {` / `"bundles": [` / `"@deepseek-ai/dsh-base",` / `"@deepseek-ai/dsh-web-app"` / `],`」
  — 证据：`~/.dsh/profiles/web/package.json:15`「`"patchReload": "live"`」

---

## 4. DSH 宿主插件加载器（真实代码路径 + 引文）

### 4.1 部署宿主安装树是可读源码（**不是** minified bundle）
- `$DSH_HOST/lib/` 仅 6 个 JS，最大 283 行（`profile-boot-DG5t9aNs.js`）；插件加载逻辑的真正实现在
  `$DSH_HOST/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js`（1216 行，带完整 JSDoc，未压缩）。
  — 证据：`$DSH_HOST/lib/profile-boot-DG5t9aNs.js:283`「`export { resolveTelemetryPatch as a, prepareProfile as i, PROFILE_ROOT_FILENAME as n, runProfile as o, homePatchPath as r, INSTALL_ANCHOR as t };`」
  — 证据：`$DSH_HOST/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js:539`「`function loadProfile(binName, name, installAnchor, home = resolveDshHome(), options = {}) {`」
- 包名/版本（据此写文档时标注版本）：`@deepseek-ai/dsh` = `0.1.1-rc.2`，bin = `lib/bin.js`。
  — 证据：`$DSH_HOST/package.json:3`「`"version": "0.1.1-rc.2",`」
  — 证据：`$DSH_HOST/package.json:15-17`「`"bin": {` / `"dsh": "lib/bin.js"` / `},`」
- 明确记录为"架构分层、非 minified"：`profile-boot-DG5t9aNs.js` 是 esbuild 产物但保留 JSDoc 与可读函数名。
  — 证据：`$DSH_HOST/lib/profile-boot-DG5t9aNs.js:75-77`「`* patch layers (bundle layers in \`dsh.profile.bundles\` order, the profile's` / `* own \`cordis.patch.yml\`, \`--patch\` overlays, the telemetry switch), mount the` / `* tree over the profile's empty root config, keep the profile patch layer`」

### 4.2 patch 文件名常量与 profile 结构定义
  — 证据：`$DSH_HOST/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js:311`「`const PROFILE_PATCH_FILENAME = "cordis.patch.yml";`」
  — 证据：`$DSH_HOST/node_modules/@deepseek-ai/dsh-app-boot/lib/types/profile.d.ts:7-13`「`* \`dsh --profile\` launcher family.` … `* \`"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }\`; the tree is` / `* composed by applying each bundle's patch list in \`dsh.profile.bundles\` order over` / `* an empty entry list, then the profile's own patches, then any launcher` / `* layers (\`--patch\` files and flag-derived patches).`」

### 4.3 组合顺序：bundle 层 → profile 层 → home 层 → overlays
  — 证据：`$DSH_HOST/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js:546`「`const layers = (normalizeShippedProfile(name, dir, readProfileManifest(binName, dir)).dsh?.profile?.bundles ?? []).map((packageName) => {`」
  — 证据：`$DSH_HOST/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js:548`「`const declared = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")).dsh?.bundle?.patch;`」
  — 证据：`$DSH_HOST/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js:564`「`patches: options.userLayer !== false && existsSync(patchPath) ? loadOverlayPatches(binName, patchPath) : []`」
  — 证据：`$DSH_HOST/lib/profile-boot-DG5t9aNs.js:241-246`「`const composeLive = () => structuredClone([` / `...composed.bundlePatches,` / `...loadOptionalPatches(NAME, composed.profile.patchPath) ?? [],` / `...loadOptionalPatches(NAME, homePatchPath()) ?? [],` / `...composed.overlays` / `]);`」

### 4.4 patch 应用算法（insert / id 覆盖 / name 校验），单一实现 `applyEntryPatches`
  — 证据：`$DSH_HOST/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js:57`「`function applyEntryPatches(data, patches, warn) {`」
  — 证据：`$DSH_HOST/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js:69-70`「`const { id, insert, name, ...overrides } = patch;` / `if (insert) {`」
  — 证据：`$DSH_HOST/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js:83`「`} else data.push(...insert);`」（无 id 的 insert 追加到顶层条目列表）
  — 证据：`$DSH_HOST/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js:96-98`「`if (name && name !== target.name) {` / `warn("patch: name mismatch for %C (expected %C, got %C), skipping", id, target.name, name);` / `continue;`」
  — 证据：`$DSH_HOST/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js:575-579`「`function composeEntries(layers, warn = () => {}) {` / `return applyEntryPatches([], structuredClone(layers.flat()), (message, ...args) => {`」
- 校验严格性：patch 文件必须是顶层 YAML 数组、每项必须是 mapping，否则抛错（fail loud）。
  — 证据：`$DSH_HOST/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js:841`「`if (!Array.isArray(parsed)) throw new Error(\`${binName}: ${label} ${file} must be a top-level YAML array of loader patch entries\`);`」
  — 证据：`$DSH_HOST/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js:786-788`「`* file means "no layer"; an unreadable, unparsable, or non-array file throws —` / `* a present patch file that cannot apply is a misconfiguration and must fail` / `* loud at boot, never be silently skipped.`」
- bundle 层 patch 缺失是硬错误；`--patch` overlay 缺失也是硬错误。
  — 证据：`$DSH_HOST/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js:549`「`if (declared === void 0) throw new Error(\`${binName}: profile bundle ${JSON.stringify(packageName)} declares no dsh.bundle in its package.json\`);`」
  — 证据：`$DSH_HOST/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js:806-807`「`* but a missing file throws, because the caller named this file — its absence` / `* is a misconfiguration, not "no overlay".`」

### 4.5 挂载：root Include entry + 裸包名 import 基底（bareModuleBaseUrl）
  — 证据：`$DSH_HOST/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js:964-965`「`async function mountRootInclude(ctx, absoluteConfigPath, patches = [], bareModuleBaseUrl) {` / `ctx.loader.builtins.include = bareModuleBaseUrl === void 0 ? Include : class HostResolvedRootInclude extends Include {`」
  — 证据：`$DSH_HOST/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js:973`「`return internal.import(specifier, bareModuleBaseUrl, {});`」
  — 证据：`$DSH_HOST/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js:977-984`「`const rootInclude = {` / `id: "include",` / `name: "cordis:include",` / `config: {` / `path: pathToFileURL(absoluteConfigPath).href,` / `...patches.length > 0 ? { patches: [...patches] } : {}`」
- `[UNVERIFIED]` `bareModuleBaseUrl` 的确切实参（是否即 `~/.dsh/profiles/`）——本次只读到该参数被透传给 `internal.import`，**未**在 `dsh-web-app` 中定位其赋值点（`grep bareModuleBaseUrl $DSH_HOST/node_modules/@deepseek-ai/dsh-web-app/lib/index.js` 无命中，返回空）。

### 4.6 热重载入口：HMR 装配 + `watchUserPatches`
  — 证据：`$DSH_HOST/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js:761-767`「`async function watchUserPatches(ctx, options) {` / `const { binName, filename, compose = (patches) => patches } = options;` / `const hmr = ctx.get("hmr");` / `if (hmr === void 0) throw new Error(\`${binName}: user patch-layer watching requires the Cordis HMR service\`);`」
  — 证据：`$DSH_HOST/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js:769-773`「`const patches = compose(loadOptionalPatches(binName, filename) ?? []);` / `await entry.update({ config: {` / `...includeConfig,` / `patches` / `} });`」
  — 证据：`$DSH_HOST/lib/profile-boot-DG5t9aNs.js:257-268`「`if (ctx.get("hmr") === void 0) {` / `if (ctx.get("timer") === void 0) await ctx.loader.create({ name: "@deepseek-ai/cordis-plugin-timer" });` / `await ctx.loader.create({` / `name: "@deepseek-ai/cordis-plugin-hmr",` / `config: { root: [] }` … / `await watchUserPatches(ctx, {`」
  — 证据：`$DSH_HOST/lib/profile-boot-DG5t9aNs.js:269-273`（home 层同样被 watch）「`await watchUserPatches(ctx, {` / `binName: NAME,` / `filename: homePatchPath(),` / `compose: composeLive` / `});`」

### 4.7 client 面：`dsh.client` 扫描 → boot graph → `/plugins/<id>/client.js`
  — 证据：`$DSH_HOST/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js:67-73`「`* Node half of the client module system (\`dsh.client\` dual-face package): scans` / `* the host Loader's entries for packages declaring \`dsh.client\`, composes the`」
  — 证据：`$DSH_HOST/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js:259`「`static inject = ["webServer", "loader"];`」
  — 证据：`$DSH_HOST/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js:277-280`「`ctx.on("internal/plugin", (fiber) => {` / `const entryName = fiber.entry?.options.name;` / `if (entryName === void 0) return;` / `this.dirty.add(entryName);`」
  — 证据：`$DSH_HOST/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js:390-395`「`if (decl === void 0 || decl.platform !== "web") {` / `this.pkgMeta.set(pkgName, null);` / `return null;` / `}` / `const clientRel = clientExportOf(pkgName, pkg.exports);` / `if (clientRel === void 0) throw new Error(\`client-modules: ${pkgName} declares dsh.client but exports no "./client" bundle\`);`」
  — 证据：`$DSH_HOST/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js:152-156`「`function graphRow(id, rev, fields) {` / `return {` / `id,` / `url: \`/plugins/${id}/client.js?rev=${rev}\`,` / `rev,`」
  — 证据：`$DSH_HOST/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js:483`「`"cache-control": "no-cache"`」
  — 证据：`$DSH_HOST/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js:246-248`「`name: "__DSH_BOOT__",` / `value: graph` / `}`」

### 4.8 客户端 bundle 热替换链（内容哈希 rev + SSE 通知）
  — 证据：`$DSH_HOST/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js:328`「`const rev = shortHash(readFileSync(record.meta.clientPath));`」
  — 证据：`$DSH_HOST/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js:325`「`rebuilt(id) {`」（注释：HMR watch 的注册钩子）
  — 证据：`$DSH_HOST/node_modules/@deepseek-ai/dsh-client-hmr/lib/index.js:11`「`const EVENTS_ENDPOINT = "/plugins/events";`」
  — 证据：`$DSH_HOST/node_modules/@deepseek-ai/dsh-client-hmr/lib/index.js:15-18`「`* HMR plugin, node half: the host end of the dev reload chain. One interval` / `* stat-polls every graph row's client bundle (polling by design: network` / `* mounts deliver no inotify events), reports content changes through` / `* \`clientModuleHost.rebuilt(id)\`, and serves the \`/plugins/events\` SSE channel`」
  — 证据：`$DSH_HOST/node_modules/@deepseek-ai/dsh-client-hmr/lib/index.js:28`「`const Config = z.object({ pollIntervalMs: z.number().step(1).min(1).default(500) });`」
  — 证据：`$DSH_HOST/node_modules/@deepseek-ai/dsh-client-hmr/lib/index.js:145-150`「`const unsubscribe = ctx.clientModules.onRebuilt((id, rev) => {` / `const line = sseData({` / `type: "rebuilt",` / `id,` / `rev` / `});`」

### 4.9 `dsh plugin` CLI = profile 目录内的 pnpm 透传 + bundles 层对账
  — 证据：`$DSH_HOST/lib/plugin-9h8shc4d.js:8-11`「`* \`dsh plugin --profile <name> <args...>\` — profile plugin management as a` / `* thin pnpm forwarder: initialize the profile on first use, run` / `* \`pnpm <args...>\` in the profile directory, then reconcile the` / `* \`dsh.profile.bundles\` layer list against the installed state (a dependency`」
  — 证据：`$DSH_HOST/lib/plugin-9h8shc4d.js:57`「（无 `dsh.bundle` 的依赖只作为普通依赖安装，不成为 profile 层）——引文见该行 `declares no dsh.bundle — installed as a plain dependency, not a profile layer`」

### 4.10 `[UNVERIFIED]` 未逐行复核的加载器内部
- cordis 内核 loader 的条目 diff / 失败回滚（`EntryGroup.update`、`Entry.update` 的 config-only → `_patchContext` → `fiber.update`）本次**未读**，属文档 `.workspace/deploy-lag/README.md:173` 的行号转述。
- 未确证 host 侧是否存在对插件 `lib/*.js` 的**模块级** HMR（deploy-lag 文档称 web 表面显式禁用，但本次未读该 disabled 行的实际配置位置）。

---

## 5. `settings.section`（设置页）API 用法

- 槽名常量是 **`settings.section`**；用法 = `slots.inject("settings.section", () => slots.register({...}))`。
  — 证据：`examples/minimal-plugin/lib/client.js:25-31`「`slots.inject("settings.section", () =>` / `slots.register({` / `name: "minimal-plugin",` / `id: "@local/dsh-minimal-plugin",` / `order: 90,` / `label: () => "minimal-plugin 示例设置",` / `inject: () => ({}),`」
- `slots` 从 ctx 取：`ctx.get("slots", false)`，需在 `dsh.client.inject` 里声明 `@deepseek-ai/dsh-client-runtime` 与 `@deepseek-ai/dsh-client-ui-settings`。
  — 证据：`examples/minimal-plugin/lib/client.js:20-23`「`// 需要把 "@deepseek-ai/dsh-client-runtime" 与 "@deepseek-ai/dsh-client-ui-settings"` / `// 加入 package.json 的 dsh.client.inject 后，这里才能拿到 slots / settingsScope。` / `apply(ctx) {` / `const slots = ctx.get("slots", false);`」
- 槽位/id/order 惯例有先例：vision-adam 用 `id "@deepseek-ai/dsh-vision-adam"`、`order 60`。
  — 证据：`examples/minimal-plugin/lib/client.js:18-19`「`// 示例：向 settings 页注册一个条目（settings.section 槽）。` / `// 槽位与 id/order 惯例：vision-adam 用 id "@deepseek-ai/dsh-vision-adam"、order 60。`」
- 实际部署插件里出现的 settings 槽不止一个，**文档必须列全**：
  - `settings.plugin.item`（dsh-usage，id `dsh-usage`）
    — 证据：`dsh-usage/lib/client.js:470-472`「`ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({` / `name: "settings.plugin.item",` / `key: "dsh-usage",`」
  - `settings.general.item`（dsh-wallpaper，id `wallpaper`，order 30）
    — 证据：`dsh-wallpaper-local/lib/client.js:578-581`「`ctx.slots.inject("settings.general.item", () => ctx.slots.register({` / `name: "settings.general.item",` / `id: "wallpaper",` / `order: 30,`」
  - 非 settings 槽先例：`sidebar.footer.action` / `shell.overlay`（dsh-taste）
    — 证据：`dsh-taste/lib/client.js:772`「`ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({`」
    — 证据：`dsh-taste/lib/client.js:781`「`ctx.slots.inject("shell.overlay", () => ctx.slots.register({`」
  - `conversation.session.header.actions` / `shell.overlay`（dsh-btw）
    — 证据：`dsh-btw/lib/client.js:8620`「`ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({`」
    — 证据：`dsh-btw/lib/client.js:8631`「`ctx.slots.inject("shell.overlay", () => ctx.slots.register({`」
- **宿主侧** settings 命名空间注册有两条等价路径：
  1) `installSettingsSection(ctx, NS, Config, config, { setSource, onChange })` + 模块级 `settingsNamespace("...")`。
     — 证据：`examples/minimal-plugin/lib/index.js:12`「`import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";`」
     — 证据：`examples/minimal-plugin/lib/index.js:21`「`const MINIMAL_SETTINGS_NS = settingsNamespace("dsh-minimal-plugin");`」
     — 证据：`examples/minimal-plugin/lib/index.js:32-37`「`installSettingsSection(ctx, MINIMAL_SETTINGS_NS, Config, config, {` / `setSource: (source) => {` / `current = source;` / `},` / `onChange: () => {},` / `});`」
     — 证据：`session-board/dsh-session-board/lib/index.js:78-82`「`const NS = settingsNamespace("session-status-board"); // F17：kebab-case 校验通过` / `installSettingsSection(ctx, NS, Config, config, {` / `setSource: (thunk) => { current = thunk; }, // thunk = () => scope.get()`」
  2) 直接 `ctx.inject(["settings"], …)` + `settings.register(ns, schema)`。
     — 证据：`dsh-wallpaper-local/lib/index.js:166-168`「`ctx.inject(["settings"], (settingsCtx) => {` / `settingsCtx.settings.register(WALLPAPER_NAMESPACE, WallpaperSettingsSchema);` / `});`」
     — 证据：`dsh-wallpaper-local/lib/index.js:30`「`const WALLPAPER_NAMESPACE = settingsNamespace("wallpaper");`」
- 宿主侧调用面（签名，来自官方包 d.ts，非本仓库）：
  — 证据：`$DSH_HOST/node_modules/@deepseek-ai/dsh-settings/lib/types/index.d.ts:20`「`export declare function settingsNamespace(value: string): SettingsNamespace;`」
  — 证据：`$DSH_HOST/node_modules/@deepseek-ai/dsh-settings/lib/types/index.d.ts:341`「`export declare function installSettingsSection<T>(ctx: Context, ns: SettingsNamespace, schema: z<T>, entry: T, hooks: SettingsSectionHooks<T>): void;`」
- `[UNVERIFIED]` `settings.section` 槽本身的宿主实现位置（哪个 client 包提供该槽）本次未定位；只确证了**消费侧**写法与先例。

---

## 6. 冷热边界（hot vs cold）

### 6.1 权威矩阵（文档正文，含实测等级）——`.workspace/deploy-lag/README.md` §9.1
- 热：`insert` 新插件（bare 包名，包已在可解析 node_modules）→ 实测 graph 49→50，~1s。
  — 证据：`.workspace/deploy-lag/README.md:138`「`| **insert 新插件**（bare 包名，包已在可解析 node_modules） | \`~/.dsh/profiles/web/cordis.patch.yml\` | **热** | 实测：boot graph 49→50 行，\`curl /\` 可见新 client 行 | ~1s |`」
- 热：remove insert / disable 已有条目 / name 更换 / config 覆盖。
  — 证据：`.workspace/deploy-lag/README.md:139-142`「`| **remove insert**（删条目） | 同上 | **热** | 实测：graph 50→49，行消失 | ~1s |`」…「`| **config 覆盖**（给已有条目加/改 \`config:\` 键值） | 同上 | **热** | 代码实证：config-only diff → \`_patchContext\` → \`fiber.update(config)\` 重应用；…`」
- 冷：改插件**宿主 lib 代码**（官方包 / `profiles/node_modules` 自装包 `lib/*.js`）→ 必须重启。
  — 证据：`.workspace/deploy-lag/README.md:143`「`| **改插件宿主 lib 代码**（$P 官方包 / profiles/node_modules 自装包 \`lib/*.js\`） | 代码文件 | **冷** | 机制：ESM loadCache + web 表面模块 HMR 禁用（hmr row disabled）+ externals→\`loader.exit()\` 空转 | 重启（本脚本） |`」
- 冷（失败回滚）：insert 用文件路径名（`/abs/path.mjs`、`file://…`）→ 运行实例 import 不执行、整次刷新回滚。
  — 证据：`.workspace/deploy-lag/README.md:144`「`| **insert 用文件路径名**（\`name: /abs/path.mjs\` 或 \`file://…\`） | patch + 文件 | **冷（失败回滚）** | 实测：运行实例 import 不执行、整次刷新回滚、无残留；bare 包名无此问题 | — |`」
- 免重启清单（4 条）与"仍要重启"的 3 类场景。
  — 证据：`.workspace/deploy-lag/README.md:150`「`1. **注册一个新插件**（包已 \`npm/cp\` 装到可解析 node_modules，例如 \`~/.dsh/profiles/node_modules/@local/\`）：`」
  — 证据：`.workspace/deploy-lag/README.md:162`「`**仍然要重启（跑 \`./dsh-restart.sh\`）的场景**：改任何插件**宿主 lib 代码**（官方补丁包 / \`@local\` 自装包 \`lib/*.js\`）、已挂载条目的 \`dsh.client\` 声明变更、批量补丁批次收口。`」
- 两条硬约束：改代码不热（条目热载只重应用配置，不重读模块，ESM 缓存）；观测走 boot graph / SSE。
  — 证据：`.workspace/deploy-lag/README.md:167`「`- **改代码不热**：条目热载只重应用**配置**，不重读模块文件（ESM 缓存）；模块级 HMR 在 web 表面显式禁用。`」
  — 证据：`.workspace/deploy-lag/README.md:169`「`- **观测运行实例热载**：boot graph 走 \`curl http://127.0.0.1:3080/\`（每次请求注入当前图）或 SSE \`curl -N /plugins/events\`；…`」
- §9.4 机制链（一句话）+ 证据行号索引（可直接被文档引用）。
  — 证据：`.workspace/deploy-lag/README.md:173`「`` `保存 patch → hmr.registerConfig 精确 watch（profile-boot 挂载，`{root:[]}` 出厂态）→ watchUserPatches 事务性 `entry.update({patches})` → include fiber update → applyPatches → EntryGroup.update 条目 diff（insert=import+activate；remove=dispose；config-only=`_patchContext`→`fiber.update(config,true)`；name=`re-import`）→ `internal/plugin` 事件 → client-modules 增量 reconcile boot graph → 浏览器刷新即见` ``」
  — 证据：`.workspace/deploy-lag/README.md:174`「`证据行号：\`dsh-app-boot/lib/index.js:761-781\`、\`profile-boot-DG5t9aNs.js:264-270\`、\`cordis-plugin-hmr/lib/index.js:118-166\`、\`cordis-plugin-loader/lib/index.js:405-492\`、\`cordis-plugin-include/lib/index.js:139-146\`。`」（**上列后三个包本次未读，属文档转述**）
- 文档明确"运行实例 = PID 2437836"（**与本次会话的 PID 20806 不同**，属历史实测基线）。
  — 证据：`.workspace/deploy-lag/README.md:134`「`### 9.1 支持矩阵（实测或代码实证；运行实例 = \`dsh web\` PID 2437836 @ 127.0.0.1:3080）`」

### 6.2 实测原始记录——`.workspace/p0a-patch-hmr-exec.md`
- §0 TL;DR：四类条目级变更均在运行实例上实测热生效，~1s，全程未重启。
  — 证据：`.workspace/p0a-patch-hmr-exec.md:13`「`1. **patch 条目级热载成立**：insert（新插件，bare 包名）/ remove / disable / name 更换四种变更均在**运行实例**上实测热生效，~1s 级，全程未重启。`」
- §2.1 实验 B-1（insert 热挂载，graph 49→50，~1s）。
  — 证据：`.workspace/p0a-patch-hmr-exec.md:46-47`「`- 观测：**~1s 后** graph 出现该包行 \`"rev":"437bb481f196"\`，entry 数 49→**50**。` / `- 结论：**insert 热挂载成立**（import + activate + client graph 增量，全程无重启）。`」
- §2.2 remove 热卸载（50→49）；§2.3 disable 热禁用（fiber dispose）；§2.4 name 更换热 re-import。
  — 证据：`.workspace/p0a-patch-hmr-exec.md:53`「`- 结论：**remove 热卸载成立**（dispose + graph 行回收）。`」
  — 证据：`.workspace/p0a-patch-hmr-exec.md:60`「`- 结论：**disable 热生效成立**；同时证明"对已有条目的选项级覆盖"走热链。`」
  — 证据：`.workspace/p0a-patch-hmr-exec.md:66`「`- 结论：**name 更换热 re-import 成立**（Entry.update 的 name-diff 分支实测走通）。`」
- §2.5 文件路径 insert **不热**（import 阶段即失败），根因未定位（如实记为硬约束）。
  — 证据：`.workspace/p0a-patch-hmr-exec.md:71`「`- **执行**：v1（含 internal/update 监听）、v2（最小）、v3（\`file://\` URL）、v4（顶层副作用标记，区分 import/apply 失败）四种形态全部**未激活**；…`」
  — 证据：`.workspace/p0a-patch-hmr-exec.md:72`「`…**根因未在本次限定范围内定位**（运行进程日志不可读；文件路径插件名亦非正常部署形态），如实记为硬约束。`」
- §2.5 config 覆盖：**代码路径实证 + 链实测**，但"值级直接观测"未达成（诚实标注的观测缺口）。
  — 证据：`.workspace/p0a-patch-hmr-exec.md:73`「`- **最终判定**：config 覆盖热载 = **成立**，证据为 (a) 代码路径实证（config-only diff → \`_patchContext\` → \`fiber.update(config, true)\` → 插件重应用，loader:445-462/405-492）；…**值级直接观测**（看某个具体插件 apply 收到的新 config）本次未达成（观测受限，见 §5 问题 1）。`」
- §2.6 全程安全监控：cordis.yml 内容/md5 全程未变；无 .tmp 残留；回滚后 graph rev 与基线逐字节一致。
  — 证据：`.workspace/p0a-patch-hmr-exec.md:80`「`- 运行实例：全程未重启，graph rev 回滚后与启动基线**逐字节一致**（\`df972a3eb063\`），SSE 存活，会话（本档）正常工作。`」
- §3 支持矩阵含第 8 行"已挂载条目 dsh.client 声明变更 = 冷（pkgMeta 缓存）"。
  — 证据：`.workspace/p0a-patch-hmr-exec.md:95`「`| 已挂载条目 dsh.client 声明变更 | package.json | **冷** | pkgMeta 缓存（既有审计 B） | 重启 |`」
- §1 取证基线：hmr 装配与 watchUserPatches 的代码行号（与本次 §4.6 读到的实现一致）。
  — 证据：`.workspace/p0a-patch-hmr-exec.md:26`「`| hmr 装配 | \`profile-boot-DG5t9aNs.js:256-273\` | \`ctx.get("hmr")===void 0\` 时程序化 \`loader.create({name:"@deepseek-ai/cordis-plugin-hmr", config:{root:[]}})\`，随后两处 \`watchUserPatches\`（profile patch + home patch） |`」

### 6.3 settings 值级热载——`.workspace/p0b-settings-switch-exec.md` §4
- 结论：改 `~/.dsh/settings.yaml` → 值级热载 → 行为变化，**无需重启**（5 步链）。
  — 证据：`.workspace/p0b-settings-switch-exec.md:98`「`**改 \`~/.dsh/settings.yaml\` → 值级热载 → 行为变化，无需重启**：`」
  — 证据：`.workspace/p0b-settings-switch-exec.md:100-104`「`1. \`dsh-settings-file\`（chokidar watch 默认开）收到文件变更 → \`refresh()\` → \`reconcileFromDisk()\` → \`publish(doc)\`;` … `3. **deep-equal commit**：仅当解析值与上次不同才提交 → 宿主发 \`settings/updated\` … + \`settings/document-updated\`（revision 变化）;` …」
- 前提：**schema/代码改动**需随插件部署一次（重启或重载插件）——即"改 schema 冷、改值热"。
  — 证据：`.workspace/p0b-settings-switch-exec.md:108`「`**前提**：schema/代码改动需随插件部署一次（重启或重载插件）——本档只改工作区/仓库源码，`」
- 部署注意点（§5）明确三分：`lib/client.js` 替换 + 刷新页面即生效；宿主 `index.js`（schema）需重启/重挂；`dsh.client.inject` 变更（pkgMeta 缓存）需重启 web 一次。
  — 证据：`.workspace/p0b-settings-switch-exec.md:117`「`2. \`lib/client.js\` 为浏览器 bundle：替换 + 刷新页面即生效；宿主 \`index.js\`（schema）需插件重载一次（重启 web 或重挂插件），此后 settings 值热载。`」
  — 证据：`.workspace/p0b-settings-switch-exec.md:118`「`3. \`package.json\` \`dsh.client.inject\` 变更属客户端元数据（pkgMeta 缓存）→ 需重启 web 一次使注入生效（与 schema 重启同批）。`」
  — 证据：`.workspace/p0b-settings-switch-exec.md:123`「`3. 客户端注入 \`@deepseek-ai/dsh-client-ui-settings\` 已加入 \`dsh.client.inject\` → 重启 web 一次生效；此后 \`ui.*\` 三键热载。`」

### 6.4 客户端 bundle 热替换的机制级证据（本次直读，可与上面实测互证）
- 只要 client bundle 内容哈希（rev）改变，graph 行即换 url → **浏览器刷新即拿到新 bundle**；服务端 `no-cache`。
  — 证据：`$DSH_HOST/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js:155`「`url: \`/plugins/${id}/client.js?rev=${rev}\`,`」
  — 证据：`$DSH_HOST/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js:325-331`「`rebuilt(id) {` … `const rev = shortHash(readFileSync(record.meta.clientPath));` / `if (rev === record.entry.rev) return rev;` / `record.entry = graphRow(id, rev, record.meta);`」
- 轮询式（500ms 默认）stat 探测 → 设计上因"网络挂载无 inotify"而选择轮询。
  — 证据：`$DSH_HOST/node_modules/@deepseek-ai/dsh-client-hmr/lib/index.js:16-17`「`* stat-polls every graph row's client bundle (polling by design: network` / `* mounts deliver no inotify events), reports content changes through`」
- `[UNVERIFIED]` 浏览器端收到 `rebuilt` 帧后是否**自动重载**（vs 仅提示/需手动刷新）：本次只读到 host 端 SSE 推送（`client.js` 侧未逐行读），文档若写"自动热替换"需补证。

### 6.5 冷热边界小结（供文档一句话表格，均可溯源至 §6.1–§6.4）
| 改动对象 | 冷/热 | 依据 |
|---|---|---|
| `~/.dsh/profiles/web/cordis.patch.yml`（insert / remove / disable / name / config） | 热（~1s） | deploy-lag §9.1 + p0a §2.1–2.5 |
| 插件 `lib/client.js`（浏览器 bundle 内容） | 热（换 rev + 浏览器刷新） | client-modules:155/325-331；p0b §5 |
| 插件宿主 `lib/*.js`（含 schema） | 冷（重启） | deploy-lag §9.1/§9.2:162；p0b:108/117 |
| 插件 `package.json` 的 `dsh.client`（inject/platform/immediately） | 冷（pkgMeta 缓存） | p0a:95；p0b:118/123 |
| `~/.dsh/settings.yaml` 的**值** | 热 | p0b §4:98-104 |
| `name:` 用文件路径而非 bare 包名 | 冷（失败回滚） | deploy-lag §9.1:144；p0a §2.5:71-72 |

---

## 7. 给文档作者的"必须写进正文"清单（均有本档引文）

1. 插件 = cordis 插件；四个导出 `name/inject/apply/Config`；`apply(ctx, config)` 内 `ctx.effect` 清理、`ctx.tools.register(defineTool(...))` 注册工具。
2. 客户端面 = 手写 `window.__ModuleLoader__.load({id, factory})`，`id` **必须 == 包名**；需 `dsh.client` 声明 + `exports["./client"]`，否则 host 侧 `resolveMeta` 抛
   「`declares dsh.client but exports no "./client" bundle`」。
3. 挂载 = profile `cordis.patch.yml` 的 `insert`（bare 包名）；文件路径名不热且失败回滚。
4. 组合顺序 = bundle 层 → profile 层 → home 层（`$DSH_HOME/cordis.patch.yml`）→ `--patch` overlays。
5. 运行时装单位 = `~/.dsh/profiles/node_modules/@local/`（**仓库 ≠ 部署位**，需人工/脚本同步）。
6. settings 有**两侧** API：宿主 `installSettingsSection` / `settings.register`，客户端 `slots.inject("settings.section" | "settings.plugin.item" | "settings.general.item", …)`。
7. 冷热三分：patch 条目热 / client bundle 热（+刷新）/ 宿主 lib 与 `dsh.client` 元数据冷（重启）。

## 8. 明确的 UNVERIFIED 清单（文档中不得断言）

- `[UNVERIFIED]` `bareModuleBaseUrl` 的实参来源（未定位赋值点）。
- `[UNVERIFIED]` `@deepseek-ai/dsh-session-board` 的实际部署位置（不在 `profiles/node_modules/@local/`）。
- `[UNVERIFIED]` cordis 内核 `EntryGroup.update` / `Entry.update` / `_patchContext` 的逐行实现（仅 deploy-lag:174 转述行号）。
- `[UNVERIFIED]` `settings.section` 槽的宿主提供方包位置。
- `[UNVERIFIED]` 浏览器端收到 `rebuilt` 帧后是否自动重载。
- `[UNVERIFIED]` `dsh-btw/lib/index.js`（65 KB）与 `dsh-taste/lib/index.js`（27 KB）的内部结构——本次只按其 `package.json` / 首行 / 体积判定为 host 代码。
- `[UNVERIFIED]` 文档 `.workspace/deploy-lag/README.md` 中 PID 2437836 的运行实例与当前会话 PID 20806 的关系（未介入、未验证当前进程的 patch 状态）。
