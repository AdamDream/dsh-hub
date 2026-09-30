# T16 — Web 前端与客户端插件在 0.2.0 的加载机制与兼容性审计

- 审计轨道：T16（只读审计，未改任何产品代码/配置）
- 审计时刻：本轮实测（2026-09-29，全部命令与哈希见下）
- 目标版本：`@deepseek-ai/dsh@0.2.0-rc.1`
- 对照基线：**0.1.7-rc.2**（逐文件主对照，迁移起点）+ **0.1.1-rc.2**（现役 3080，用于判定历史坑是否仍在）
- 证据根：
  - 0.2.0 安装闭包 `/home/CNS2026495165/dsh/.workspace/audit-020/work/closure020/node_modules/@deepseek-ai/`（289 包）
  - 0.1.7 安装闭包 `/home/CNS2026495165/dsh/.workspace/audit-020/work/closure017/node_modules/@deepseek-ai/`（284 包）
  - 0.1.1 真实安装树 `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`（197 包，只读）
- 本轨道产物：`reports/T16-web-client-plugin-compat.md`（本文）、`work/t16/`（脚本与原始清单）

> 纪律声明：**所有结论均绑定本轮源码实测**。历史坑（槽位名变化、`Icon*Outline16` 退役、`settings.section` 席位、bundle 形态）在本报告中只作为「待核查点」，均已逐一实测并给出当轮证据或明确的「不存在」结论。

---

## 1. 结论摘要

### 1.1 机制层：0.2.0 的客户端插件加载链路相对 0.1.7 **零变化**

客户端插件的**发现 / bundle 构建要求 / 静态服务路径 / 编码与缓存策略**在 0.1.7 → 0.2.0 之间**逐字节一致**（下列文件 sha256 相同，见 §2.1）：

| 环节 | 承载包 | 0.1.7 vs 0.2.0 |
|---|---|---|
| 发现 + 组合 + 服务 | `@deepseek-ai/dsh-client-modules` | `lib/index.js` **sha256 完全相同** |
| 静态 dist 服务（fallback 席位） | `@deepseek-ai/dsh-host-frontend-static` | `lib/index.js` **sha256 完全相同** |
| HTTP 载体 / index 注入表 | `@deepseek-ai/dsh-host-webserver` | `lib/index.js` **sha256 完全相同** |
| 浏览器端 loader / HMR 传输 | `dsh-client-hmr` | `lib/client.js`、`lib/index.js` **sha256 完全相同** |
| 槽位内核 | `dsh-client-ui-slots` | `lib/index.js` **sha256 完全相同** |
| 客户端 API 目录（自动生成） | `dsh-cordis-client-runner` | `lib/client.js` 仅方法签名文本差异（`session.fork` 的 `onCreated`），与加载机制无关 |
| Web 应用装配 | `dsh-web-app` | `lib/index.js`、`lib/startup.js` **sha256 完全相同**；`cordis.patch.yml` 有真实差异（仅装配行，见 §3.4） |
| SPA 构建产物 | `dsh-web-frontend` | `dist/index.html` 与资产文件名哈希变化（内容等价，仅版本号/构建哈希不同） |

⇒ **T16 范围内，0.2.0 不存在「客户端插件加载机制不兼容」这一风险面。** 迁移风险全部来自**上游 API 表面（客户端包集合 / 槽位集合 / 图标集合）在 0.1.1 → 0.1.7 已经发生、0.2.0 原样沿用**的变更——即本机插件在 0.1.1 上构建、却被直接复制进 0.1.7/0.2.0 的隔离栈（§2.4 已实测两份副本完全相同）。

### 1.2 本机 7 个客户端插件的裁决（按客户端半）

| # | 插件 | 裁决 | 关键原因（客户端半） |
|---|---|---|---|
| 1 | `@local/dsh-subagent-model` 0.1.0 | **原样可用** | 只 `require("react")`；席位 `settings.section` 在 0.2.0 仍是 `list/root` 且仍由 `sidebar.settings` 声明 |
| 2 | `dsh-workspace-enhancement` 0.1.2 | **原样可用** | 只 `require("react"/"react/jsx-runtime")`；4 个席位全部存在于 0.2.0；无退役图标；无 `runtime` 包依赖 |
| 3 | `@local/dsh-usage` 0.1.0 | **需改（小）** | 唯一席位 `settings.plugin.item` 在 0.1.7 起被删除 → `slots.inject` 静默不触发，UI 无声消失（不抛错） |
| 4 | `@local/dsh-ssh-gui` 0.2.0 | **需改（小）** | 3 个席位中 `sidebar.workspaces.remoteHosts` 在 0.1.1 是 `dsh-client-ui-workspace` 声明的 `list/root` 真席位、**0.1.7 起被删除** → 该处静默消失；另 2 处正常 |
| 5 | `@local/dsh-wallpaper` 0.5.0 | **需改（机械）** | `require("@deepseek-ai/dsh-client-runtime/client")` 在 0.1.7 起包已不存在 → 模块表未命中，**materialize 时抛 Error**；用到 `defineStore`，0.2.0 已有同实现的新家 `@deepseek-ai/dsh-client-store`（seed 词） |
| 6 | `@local/dsh-btw` 0.4.0-btw.1 | **需改（机械）** | 同 #5 的 `runtime` 缺失 + **9 个已退役图标名**（`Icon*Outline16` / `Icon*16`）→ 渲染期 React 元素类型无效 |
| 7 | `@local/dsh-pptmaster` 0.1.0 | **重写/重构** | `runtime` 缺失 + 1 个退役图标 + `conversation.chat.turnTail` 由 **chain 变 list**（注册期直接抛错，且组件契约 `matched` 失效）+ 2 个席位在任何版本都不存在 |

计数：**原样可用 2 个 / 需改 4 个 / 重写 1 个**（共 7 个；题面点名的 6 个 `@local/*` 之外另含 `dsh-workspace-enhancement`）。

### 1.3 三条最关键发现

1. **「注册期不报错、渲染期 TypeError」的静默失败模式在 0.2.0 仍然存在，且是 0.2.0 上最可能的真实故障形态。**
   `ctx.slots.inject(key, cb)` 在 key 未被任何条目声明时**直接 `return`**（`dsh-client-ui-renderer/lib/client.js:1361-1368`），既不抛错也不告警 ⇒ 席位被改名/删除的插件表现为「UI 无声消失」。反之，key 存在但**类型（kind）变了**时会在注册期抛错（`dsh-client-ui-slots/lib/index.js:163-190`）。本机同时命中两种形态（`dsh-usage` 命中静默型，`dsh-pptmaster` 命中抛错型）。

2. **`@deepseek-ai/dsh-client-runtime` 自 0.1.7 起已从发行版中整体消失，而本机 4 个插件的客户端 bundle 在运行时 `require` 它。**
   0.1.1 安装树有该包（0.1.1-rc.2）；0.1.7 安装树（283 包）与 0.2.0 闭包（289 包）均无；`dsh-web-app` 两版的依赖列表都不含它；0.2.0 的 shell 静态种子表（9 个 PLATFORM_MODULES 键，§4.2）也不含它。⇒ `dsh-wallpaper`/`dsh-btw`/`dsh-pptmaster` 的客户端半在 0.2.0 上会在模块表解析处抛错；`dsh-workspace-enhancement` 的 `dsh.client.inject` 虽仍列它，但 `inject` 只用于到达排序，缺项被静默跳过，故它不受影响。

3. **`Icon*Outline16` / `Icon*16` 系列确实已退役——退役发生在 0.1.7，0.2.0 与 0.1.7 完全一致（194 个导出、97 个基名、零 `*16`）。**
   0.1.1 的 `dsh-client-ui-primitives` 暴露 48 个 `*16` 图标名、零 `Medium/Regular`；0.2.0 暴露 194 个 `Medium/Regular`、零 `*16`。48 个旧基名**全部**能一一映射到 0.2.0 的新名（后缀改 `Outline16`→`OutlineMedium/Regular`、`Fill16`→`FillMedium/Regular`、裸 `16`→`Medium/Regular`）。本机 `dsh-btw` 用了 9 个退役名、`dsh-pptmaster` 用了 1 个。

---

## 2. 证据（源码路径 + 行号）

### 2.1 关键文件哈希（证明机制层零变化）

命令（本轮实测）：

```bash
cd /home/CNS2026495165/dsh/.workspace/audit-020/work
sha256sum closure017/node_modules/@deepseek-ai/<pkg>/<file> closure020/node_modules/@deepseek-ai/<pkg>/<file>
```

| 文件 | sha256（前 16）0.1.7 | 0.2.0 | 判定 |
|---|---|---|---|
| `dsh-client-modules/lib/index.js` | `03ea21df556256a6` | `03ea21df556256a6` | **逐字节相同** |
| `dsh-host-frontend-static/lib/index.js` | `19bb095c5175bd5d` | `19bb095c5175bd5d` | **逐字节相同** |
| `dsh-host-webserver/lib/index.js` | `6efea1375eadeff6` | `6efea1375eadeff6` | **逐字节相同** |
| `dsh-client-ui-slots/lib/index.js` | `57e1314e31a2015f` | `57e1314e31a2015f` | **逐字节相同** |
| `dsh-client-hmr/lib/client.js` | `0e312a088abf4ec4` | `0e312a088abf4ec4` | **逐字节相同** |
| `dsh-client-hmr/lib/index.js` | `dcc6157a921254b0` | `dcc6157a921254b0` | **逐字节相同** |
| `dsh-web-app/lib/index.js` | `50c7ce5b93e8a7ac` | `50c7ce5b93e8a7ac` | **逐字节相同** |
| `dsh-web-app/lib/startup.js` | `95a47053483fbe8e` | `95a47053483fbe8e` | **逐字节相同** |
| `dsh-web-app/cordis.patch.yml` | `f7b71d8301495e51` | `df7653ee4c324dca` | 有真实差异（§3.4） |
| `dsh-cordis-client-runner/lib/client.js` | — | `b3235edbd148e7c2` | 仅 `session.fork` 文档签名变更 |

全量归一化对比脚本：`work/t16/normcmp.sh`（**归一化前必须把文件名作为参数传给 `sed`**——本轮首次实现曾因 `sed` 吞掉调用方 stdin 而产生「伪相同/伪差异」，已修正后重跑，结果见 `work/t16/realdiff.txt`）。

`work/t16/realdiff.txt` 结论（`web|frontend|client|static|host` 全匹配包）：
- 归一化后**只剩 `package.json` 版本号差异**的包（共 46 个）：`dsh-client-connection`、`dsh-client-hmr`、`dsh-client-locale`、`dsh-client-modules`、`dsh-client-resources`、`dsh-client-shortcuts`、`dsh-client-ui-agent-preset`、`dsh-client-ui-commands`、`dsh-client-ui-renderer`、`dsh-client-ui-slots`、`dsh-host-frontend-static` …（完整清单见 `work/t16/realdiff.txt`）
- 归一化后**只剩 `package.json` 版本号差异**的包：精确计数 **46 个**（脚本口径：该包全部差异文件去掉 `.map`/README/LICENSE 后恰为 `['package.json']`）
- **有真实运行时内容差异**的客户端包（20 个）：`dsh-client-ui-chat`、`-conversation`、`-layout`、`-model-selection`、`-plugin-manager`、`-primitives`、`-schedule`、`-settings-account`、`-settings-general`、`-settings-models`、`-settings-plugin-inventory`、`-settings-web-search`、`-sidebar`、`-sidebar-browser`、`-sidebar-documentpreview`、`-skill`、`-theme`、`-tool`、`-workflow-run`、`-workspace`（均为**上游 UI 自身的功能迭代**，非加载机制变化）
- 依赖差异：核心机制包（`dsh-client-modules`、`dsh-client-ui-slots`、`dsh-client-hmr`、`dsh-host-frontend-static`、`dsh-host-webserver`、`dsh-cordis-client-runner`）**零依赖变化**

### 2.2 客户端插件发现（0.2.0）

`closure020/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js`

- `:541` `for (const entry of ctx.loader.entries()) this.dirty.add(entry.options.name);` —— **发现源只有 host Loader 条目**（即插件行 / cordis 行），不做全盘扫描
- `:542-545` `this.composed = this.compose(); this.flush(...)`；组合失败聚合为 `ClientPackageCompositionError`（`:144-157`）
- `:703-733` `resolveMeta(loaderName, baseUrl)`：定位该 Loader 条目对应的 `package.json`，读 `pkg.dsh.client`
- `:713` `const decl = parseDshClient(packageName, dsh !== null && typeof dsh === "object" ? dsh.client : void 0);`
- `:714-717` `if (decl === void 0 || decl.platform !== "web") { ... return null; }` —— `platform` 必须是字符串 `"web"`，否则该包**不是**客户端包
- `:718-719` `const clientRel = clientExportOf(packageName, pkg.exports); if (clientRel === void 0) throw new Error('client-modules: <pkg> declares dsh.client but exports no "./client" bundle');` —— **声明了 `dsh.client` 却无 `exports["./client"]` 是启动期硬错误**
- `:735-806` `locatePkgJson()`：优先用 Loader 的 `internal.resolveSync` 解析该条目，再向上找最近声明该名字的 `package.json`
- `:795-800` `captureArtifactBaseline(clientPath)`：`statSync` 取 `mtimeMs/ctimeMs/size`
- `:809-820` 读 bundle 字节；`ENOENT` → `MissingClientBundleError`（`:130-142`，文案 `run \`pnpm run build\` before launch`）
- `:193-199` `artifactRevision(baseline)`：**修订号只由 mtime/ctime/size 派生，不哈希内容** ⇒ 未改动的产物跨重启保持同一 rev，SSE 重连不会替换浏览器侧插件
- `:415-437` `orderByModuleGraph()`：按 `external` 依赖做拓扑排序；自请求、环 → 抛错
- `:159` `const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";`

### 2.3 bundle 服务路径 / 编码 / 缓存（0.2.0）

`closure020/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js`

- `:201` `const PLUGIN_ROUTE = "/plugins";`
- `:546-551` `webCtx.webServer.register({ kind: "prefix", path: PLUGIN_ROUTE, handler: this.serveBundle })` —— 通过 `ctx.inject(["webServer"], ...)` 绑定：**webServer 服务被替换时会重新注册**
- `:169` `const CLIENT_CHUNK = /^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/;` —— 包内 chunk 命名约定；入口 `client.js` 本身不匹配该正则（入口 URL 恒为 `/plugins/<包名>/client.js`，与磁盘文件名无关）
- `:203-228` combo/URL 生成：`/plugins/??<id>/client.js[,<id2>/client.js]&rev=<12位摘要>`，`.map` 变体独立
- `:161` `MAX_COMBO_URL_BYTES = 3 * 1024`；`:236-249` 按 3 KiB 上限分组，超限抛错
- `:164-165` `SOURCE_MAP_TRAILER = /(?:\r?\n)?\/\/# sourceMappingURL=[^\r\n]*(?:\r?\n)?$/`
- `:254-263` `prepareSource()`：剥掉 `sourceMappingURL` / `sourceURL` 尾注，保证不以换行结尾时补 `\n`
- `:270-281` `readSourceMap()`：`.map` **缺失可容忍**（`ENOENT` → `undefined`）；存在但不是 Source Map v3（`version!==3` / `sources` / `names` / `mappings` 不合规）→ **抛错**
- `:958-976` `bundleResource()`：非 GET/HEAD → 405；未命中 → 404；命中 → `content-type: <response.contentType>` + `cache-control: public, max-age=31536000, immutable`；`HEAD` 返回同样的不可变头但不生成 body
- content-type 实际取值：`text/javascript; charset=utf-8`（脚本/chunk）、`application/json; charset=utf-8`（map）
- 索引注入：`:552-554` `ctx.on("webserver/index-inject", (table) => { table.push(...bootInjections(this.composed)); });`
- `:443-500` `bootInjections()`：`window.__ModuleLoader__` 队列 facade + application 预载 + 阻塞式 bootstrap combo + `window.__DSH_BOOT__` 图
- `:439-441` `CLIENT_MODULES_ID = "@deepseek-ai/dsh-client-modules"`、`PARSER_PRELOAD_IDS = [CLIENT_MODULES_ID]`

静态 dist 服务（与插件 bundle 是两条不同路径）：
`closure020/node_modules/@deepseek-ai/dsh-host-frontend-static/lib/index.js`
- `:21` `inject = ["webServer", "connection"]`
- `:24-33` MIME 表：`.html`/`.js`/`.css` 带 `; charset=utf-8`，未知扩展 `application/octet-stream`
- `:50-55` 越出 dist 根 → 403；`:59-62` dist 根与 distIndex 都走 `authorizeIndex()` + `renderIndex()`（即注入表渲染）
- `:85` 注入 `<base href="./">`
- `:87-96` `ctx.webServer.registerFallback(...)` —— **fallback 席位全站唯一**

HTTP 载体：
`closure020/node_modules/@deepseek-ai/dsh-host-webserver/lib/index.js`
- `:141-147` `Config`：`host`/`port`/`compression`（默认 `"none"`）/`compressionLevel`（默认 1）/`compressionThresholdBytes`（默认 1024）
- `:177-184` `register()`：同名同 kind 重复 → 抛错；`:206-212` `registerFallback()`：第二个 fallback → 抛错
- `:350-363` `collectIndexInjections()` / `renderIndex()`：结构化注入行先渲染，`tapIndex` 原始变换后执行
- `:65` `READY_MARKUP`：`globalThis.__DSH_BOOT_READY__ ??= Promise.withResolvers()).resolve()`
- 装配层（0.2.0 与 0.1.7 相同）：`dsh-web-app/cordis.patch.yml:169-176` `compression: gzip`、`compressionLevel: 1`、`port: !!js ctx.webStartup.port ?? 3080`

### 2.4 本机插件「已被复制进 0.1.7 隔离栈」的实测

```
diff -rq ~/.dsh/profiles/node_modules/@local/<p> ~/.dsh-017/profiles/node_modules/@local/<p>
```
对 6 个 `@local/*` 插件全部**无差异**（`docs/`、README 除外亦无差异）⇒ 0.1.7 隔离栈里跑的就是 0.1.1 构建的同一份客户端 bundle，**没有为 0.1.7 重建过**。

客户端 bundle 哈希（本轮实测）：

| 插件 | `lib/client.js` sha256（前 16） | 体积 |
|---|---|---|
| `@local/dsh-pptmaster` | `e2b5d28b45174e13` | 4 096 057 B |
| `@local/dsh-btw` | `d9dda3bbf907244e` | 365 269 B |
| `@local/dsh-usage` | `51fd8d9b0cb6fa17` | 81 631 B |
| `@local/dsh-wallpaper` | `0fc4fd87fe4e4ba5` | 31 803 B |
| `@local/dsh-ssh-gui` | `b3e0c225b3da3918` | 63 253 B |
| `@local/dsh-subagent-model` | `5f16927be1db9f1d` | 17 099 B |
| `dsh-workspace-enhancement` | `56faaf956705a406` | 267 838 B |

---

## 3. 客户端加载机制差异（0.1.7 → 0.2.0）

### 3.1 发现（discovery）——无变化

两版 `dsh-client-modules/lib/index.js` 哈希相同。发现规则不变：
1. 插件必须作为一个 **host Loader 条目**存在（`cordis.patch.yml` / profile patch 的 `insert` 行或包内 `dsh.bundle.patch`）；
2. 该条目解析到的 `package.json` 必须有 `dsh.client` 对象且 `platform === "web"`；
3. 必须有 `exports["./client"]` 指向一个**已存在于磁盘**的构建产物。

### 3.2 构建 / 加载——无变化

- **必须预构建**：host 直接读 `exports["./client"]` 指向的文件字节（`index.js:809-820`）；文件不存在 → `MissingClientBundleError`，并在启动期以 `ClientPackageCompositionError` 聚合报出「run `pnpm run build` before launch + 包名/路径清单」。
- **不支持 TS 源码直载**：包内 README「Build requirements」原文——*"The host serves built client bundles, so `pnpm run build` must have produced each `lib/client.js` before launch; a missing bundle fails activation loudly with one build instruction and a package/path list. Source launch maps host imports to TypeScript source but still consumes the built client export."* ⇒ **源码启动只影响 host 半的 import 映射，客户端半永远是构建产物。**
- **bundle 形态**：`window.__ModuleLoader__.load({ id, factory })` 的懒 CJS 形态；执行 bundle 只注册 factory，模块体副作用（含 CSS 注入）在 materialize 时才跑。多个包可被合并成一个 combo 脚本（脚本内顺序注册）。
- 包内动态 chunk：源里被拆分的 `import()` 编译成 `require.async("./client.<name>.js")`；文件名必须匹配 `CLIENT_CHUNK` 正则。

### 3.3 静态服务路径 / 编码 / 缓存——无变化

- 路径：`/plugins/<包名>/client.js[?rev=…]`、`/plugins/??<id>,<id>&rev=…`（combo）、`…/client.<name>.js`（chunk）、各自 `.map` 变体。两版一致。
- 编码：`text/javascript; charset=utf-8` / `application/json; charset=utf-8`（插件 bundle）；`.js/.css/.html` 带 `charset=utf-8`（dist 静态）。两版一致。
- 缓存：插件 bundle 恒为 `public, max-age=31536000, immutable`（版本化 URL 不可变）；dist 静态**无 cache-control 头**（无版本化 URL，交给浏览器默认策略）。两版一致。
- 压缩：`webServer.Config` 默认 `none`，装配层 patch 显式设 `gzip` + level 1，两版一致；`text/event-stream` 与带 `content-range` 的响应被排除。

### 3.4 唯一真实的装配层差异（`dsh-web-app/cordis.patch.yml`）

0.1.7 → 0.2.0 该文件的真实差异（去掉版本号归一化后）：

**新增两行**（均 `disabled: !!js "ctx.get('profileContext')?.name !== 'desktop'"`，对 web profile 不生效）：
```yaml
- id: desktop-product-telemetry
  name: '@deepseek-ai/dsh-host-product-telemetry-otel'
- id: product-analytics
  name: '@deepseek-ai/dsh-client-product-analytics'
```

**删除一段**（0.1.7 有、0.2.0 无）：
```yaml
- id: time-context
  name: '@deepseek-ai/dsh-time-context'
  disabled: true
```

对应依赖差异（`dsh-web-app/package.json`）：
- 新增：`@deepseek-ai/dsh-client-product-analytics`、`@deepseek-ai/dsh-client-ui-settings-session-log`、`@deepseek-ai/dsh-host-product-telemetry-otel`
- 移除：`@deepseek-ai/dsh-client-ui-schedule`、`@deepseek-ai/dsh-schedule`、`@deepseek-ai/dsh-time-context`

影响面：**不涉及客户端插件的发现/加载/服务契约**；`dsh-schedule`（含其 `client` 半）不再由 `dsh-web-app` 直接装配——使用 `ui-schedule` 席位的插件需按新的 schedule 装配行确认。

### 3.5 HMR——无变化

`dsh-client-hmr/lib/client.js` 与 `lib/index.js` 两版逐字节相同；`dsh-client-modules` 的 `rebuilt()` 钩子、combo rev 派生、SSE 重连不换插件的语义均未变。

---

## 4. 入口约定结论

### 4.1 package.json 字段（0.2.0 实测校验规则）

来源：`closure020/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js:61-75`（`parseDshClient`）、`:171-181`（`clientExportOf`）

```jsonc
{
  "name": "@scope/pkg",
  "exports": {
    ".": "...",
    "./client": "./lib/client.js"        // 必需：string，或 { default: string } 一级条件形式
  },
  "dsh": {
    "client": {
      "platform": "web",                 // 必需：字符串，且必须恰为 "web"，否则不被视为客户端包
      "inject":   ["@scope/other-pkg"],  // 可选：string[]；仅作「到达顺序」前置依赖
      "external": ["@scope/other-pkg/client"], // 可选：string[]；动态模块请求，参与拓扑排序与图构成校验
      "immediately": true                // 可选：boolean
    }
  }
}
```

校验强度：
- `dsh.client` 非对象 → `client-modules: <pkg> has a non-object dsh.client declaration`
- `platform` 非字符串 → `... dsh.client.platform must be a string`
- `inject`/`external` 非 string[] → `... <field> must be a string array`
- `immediately` 非 boolean → `... dsh.client.immediately must be a boolean`
- `exports["./client"]` 非 string / 非 `{default:string}` → `... exports["./client"] must be a string or an object with a string default`
- 声明了 `dsh.client` 但无 `exports["./client"]` → `... declares dsh.client but exports no "./client" bundle`（**启动期失败**）
- `external` 里自指 → `... requests module "<name>" that it answers itself`；图成环 → 环路径报错

### 4.2 解析与「种子词」边界（0.2.0 实测）

- `require(spec)` 解析顺序（`lib/client.js:697-706`）：**① 静态种子表（`seed`）→ ② 已 materialize 的 `loadCache` → ③ 已注册 factory（图行）→ ④ 否则抛错**：
  `client-modules: require("<spec>") missed the module table — not a platform seed word, not a materialized module, and no registered package factory (a build-time externals drift, or a dynamic dependency that did not arrive)`
- `require.async(spec)`：非 `./` 前缀走 `import(spec)`，走图行（`lib/client.js:738`，未命中抛 `cannot resolve "<specifier>" … (the runtime mirror of the bundle purity gate)`）；`./` 前缀走包内 chunk。
- **静态种子表（PLATFORM_MODULES）= 9 个键，0.1.7 与 0.2.0 完全一致**。实测位置：`closure020/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-Dy0OhsZ5.js`（0.1.7 为 `index-Q6zc2uHV.js`），函数体：

```js
{ react, "react/jsx-runtime", "react-dom", "react-dom/client",
  "@deepseek-ai/cordis", "@deepseek-ai/dsh-client-store",
  "@deepseek-ai/dsh-client-ui-slots", "@deepseek-ai/dsh-client-ui-primitives",
  "@deepseek-ai/dsh-client-ui-dockkit" }
```

⇒ **任何插件 bundle 只能无障碍 `require` 这 9 个（以及 `…/client` 后缀归一化后的同 9 个）**，除此之外必须由 host Loader 里存在同名 `dsh.client` 包（形成图行）来提供；`dsh.client.inject` / `external` 只能保证「到达顺序」，不能凭空创造解析来源。

- `inject` 缺失项的容错（`lib/client.js:656-659`）：
  ```js
  for (const packageName of row.inject) {
    const dependency = this.graphRows.get(packageName);
    if (dependency !== void 0) await this.arriveDependency(row.id, dependency, [], visited);
  }
  ```
  ⇒ `inject` 列出不存在的包**不报错**；`external` 同理（`:650-654`）。**但 bundle 里真去 `require` 它就会抛错**——这是本报告 §1.3-2 的判定依据。

### 4.3 本机 7 个插件的 require 实测（对照 0.2.0 解析边界）

| 插件 | 客户端 bundle 的 `require(...)` | 0.2.0 可解析性 |
|---|---|---|
| `dsh-subagent-model` | `react` | ✅ seed |
| `dsh-workspace-enhancement` | `react`, `react/jsx-runtime` | ✅ seed |
| `dsh-usage` | `react` | ✅ seed |
| `dsh-ssh-gui` | `react` | ✅ seed |
| `dsh-wallpaper` | `react`, `react/jsx-runtime`, **`@deepseek-ai/dsh-client-runtime/client`** | ❌ 非 seed、非图行 → 抛错 |
| `dsh-btw` | `react`, `react-dom`, `react/jsx-runtime`, `@deepseek-ai/dsh-client-ui-primitives`, **`@deepseek-ai/dsh-client-runtime/client`** | ❌ 同上 |
| `dsh-pptmaster` | `react`, `react/jsx-runtime`, `@deepseek-ai/dsh-client-ui-primitives`, **`@deepseek-ai/dsh-client-runtime/client`** | ❌ 同上 |

`dsh-client-runtime` 的存在性证据：
```
0.1.1 安装树：/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-runtime  存在，version 0.1.1-rc.2
0.1.7 安装树：/home/CNS2026495165/.npm-global-dsh017/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/  （283 包）无该目录
0.2.0 闭包  ：work/closure020/node_modules/@deepseek-ai/  （289 包）无该目录
0.2.0 shell 种子表：无该键
0.1.7 / 0.2.0 的 dsh-web-app 依赖列表：均无该包
```

---

## 5. 槽位与注册 API 现状

### 5.1 注册 API（0.2.0）

- **内核**：`@deepseek-ai/dsh-client-ui-slots` 的 `SlotCore`（`lib/index.js:47`），导出 `SlotCore, SlotOwnershipError, StaleAuthorizationError, resolveSlotLabel, standardHookPropName`（`:575`）。
- **Cordis 服务层**：`ctx.slots`（`dsh-client-ui-renderer/lib/client.js:1323` `super(ctx, "slots")`），核心类 `SlotRegistry`，`register` 走 `ctx.effect`（`:1788-1790`），`_register` 追加 factory 铸型 + registrant 戳 + store 实例账（`:1578-1598`）。
- **四个 kind**：`single`（单占用） / `list`（有序多条） / `keyed`（按 key 分派） / `chain`（条目自选举）。
- **声明纪律**：`declare` = 授权渲染 = 运行时 spec；`SlotMap` 在本包内声明为空，由消费方 `declare module` 合并。`SlotFactoryMap` 是另一张表（Component Factory）。
- `root` 由 `SlotCore` 构造时预置（"a-priori"）。

### 5.2 校验强度与两种失败模式（题面高危点，本项目实测结论）

**（A）注册期硬校验 —— 席位不存在 or 类型不对，抛错**

`dsh-client-ui-slots/lib/index.js:163-198`（`register()` 全函数，含末尾 store 席位校验）：
```js
register(options, component) {
  const rec = this.records.get(options.name);
  if (!rec?.spec) throw new Error(`slot "${options.name}" is not declared (a parent entry's children table must declare it)`);
  const spec = rec.spec;
  switch (spec.kind) {
    case "single": ... if (occupant) throw new Error(`single slot "${options.name}" already has a registration ...`);
    case "keyed":  ... if (options.key === void 0) throw new Error(`keyed slot "${options.name}" requires options.key`);
                   ... if (occupant) throw new Error(`keyed slot "${options.name}" already has an entry for key "${options.key}" ...`);
    case "list":   ... if (options.id === void 0) throw new Error(`list slot "${options.name}" requires options.id`);
                   ... if (occupant) throw new Error(`list slot "${options.name}" already has an entry with id "${options.id}" ...`);
    case "chain":  ... if (options.select === void 0) throw new Error(`chain slot "${options.name}" requires options.select`);
  }
  if (options.children) for (const childKey of Object.keys(options.children)) {
    const childRec = this.records.get(childKey);
    if (childRec?.spec) throw new Error(`slot "${childKey}" is already declared (by ${childRec.declaredBy ?? "an unknown entry"})`);
  }
  ...
}
```
- **重复占用 / 重复声明 / 缺 key / 缺 id / 缺 select 都会在注册期抛错**；`single` 的报错还给出「换 priority 遮蔽（lowest renders）」的提示。
- `store` 席位跨 scope 复用 → 抛错（`:197`）。

**（B）静默型——`slots.inject` 对未声明 key 直接返回，不报错**

`dsh-client-ui-renderer/lib/client.js:1343-1398`，关键行：
```js
1343  inject(key, callback) {
...
1358    const reconcile = () => {
1359      if (stopped) return;
1361      const spec = this._core.specDynamic(key);
1362      const epoch = this._core.declarationEpoch(key);
1363      if (active !== void 0 && activeEpoch === epoch) return;
...
1368      if (spec === void 0) return;       // ← 未声明：静默跳过，callback 永不执行
1369      const disposeEffect = ctx.effect(callback, `slots.inject(${JSON.stringify(key)}): declaration`);
```
- 语义：key 已被声明时同步执行；未声明时挂起等待声明；**声明被 collapse 后 `stop()`**——因此「席位被上游改名/删除」的插件表现为 **UI 无声消失**，日志里既没有错误也没有警告。
- 与之对照：如果 key 存在但 **kind 变了**，`inject` 会正常触发、随后 `register` 抛错 → **插件客户端半 apply 失败**（`inject` 内部 `try { reconcile(); } catch (error) { stop(); throw error; }`，`:1389-1392`）。

**结论：题面所述的「注册期不报错、渲染期 TypeError」在 0.2.0 不是「TypeError」而是更隐蔽的「静默不渲染」；但另一种「注册期直接抛错」的模式同样存在（kind 漂移）。两种模式在本机插件上都有实例（§7）。**

### 5.3 0.2.0 可注册槽位清单（权威获取方法 + 实测结果）

**获取方法（推荐，无需跑起服务）**：`@deepseek-ai/dsh-cordis-client-runner` 的 `lib/client.js` 内嵌一份**自动生成的槽位目录**（每项含 `key / kind / scope / summary / doc / registerOptions / ownerProps / keyDomain / hookContext / slotInject / declaredBy / occupants / replaceRisk / example / source`）。

本轮已把三个版本的目录落盘：
- `work/t16/slotcatalog-020.json`（89 项，0.2.0）
- `work/t16/slotcatalog-017.json`（89 项，0.1.7）
- `work/t16/slotcatalog-011.json`（48 项，0.1.1）
- 提取脚本 `work/t16/dumpplots.mjs`（注意：`registerOptions` / `ownerProps` / `standardProps` / `occupants` 是**多行数组字段**，抽取器必须跨行累积，否则会得到空数组——本轮已修正）。

辅助方法（类型面）：跨包 `grep -rn "interface SlotMap" --include='*.d.ts'`（0.1.7 与 0.2.0 均为 **20 个文件**，一一对应）。

**目录完整性交叉验证（脚本 `work/t16/slotcompleteness.mjs`）**：从全部 `@deepseek-ai/*` 的 `*.js` 抽取 `renderSlot("…")` / `renderSlotChain("…")` / `useFactorySlot("…")` / `slots.inject("…")` / `slots.register("…")` 的字符串字面量，与目录 key 求差。

| 版本 | 代码提及的名字 | 目录 key | 差集 | 结论 |
|---|---|---|---|---|
| 0.2.0 | 86 | 89 | 2（`views`、`widthControls`） | 两者都是 **Component Factory 的 occurrence-local `slots` 选项名**，非全局 `SlotMap` key ⇒ **目录对全局席位完备** |
| 0.1.7 | 86 | 89 | 2（同名两项） | 同上完备，且与 0.2.0 逐项相同 |
| 0.1.1 | 48 | 48 | 1（`sidebar.workspaces.remoteHosts`） | 该版目录生成器漏收的一个**真实**席位 ⇒ 0.1.1 目录为 48/49 近似完备 |

⇒ **本报告所有「某席位不存在」的判定一律以全树 `grep -rl` 为准**，不单凭 0.1.1 目录。

**每个席位的注册选项与 owner 契约可直接机读**：89 个席位全部带 `registerOptions`（每项含 `name` / `requirement`（`required`|`optional`）/ `type` / `doc`）与 `ownerProps`（TypeScript 接口原文）。实测抽样：

| 席位 | `registerOptions` 必填项 | `ownerProps`（要点） |
|---|---|---|
| `conversation.chat.turnTail` | `id`（string） | `{ turn: TurnLocation; seq: number; openFile: (path) => void }`，doc 明确「无内容返回 null」 |
| `settings.section` | `id` | `{ close: () => void }` |
| `tool.call.toolview` | `key` | `ToolCallCommonProps`（`useDisclosure`/`callId`/`toolName`/`cwd`/`home`/`openFile`/`loadImage`/`inspect`） |
| `settings.plugin.item` | — | **0.2.0 不存在（0.1.1 有）** |

这与 `SlotCore.register` 的运行时校验一一对应（单/键/列表/链分别强制 `priority` 冲突规避、`key`、`id`、`select`）。

辅助方法（类型面）：跨包 `grep -rn "interface SlotMap" --include='*.d.ts'`（0.1.7 与 0.2.0 均为 **20 个文件**，一一对应）。注意类型面只覆盖 `declare module` 增强的静态键；**运行时还有通过父条目 `children` 表动态声明的子席位**，因此以自动目录为准。

**实测差异：**
- **0.1.7 → 0.2.0：89 → 89，`key | kind | scope | declaredBy` 逐项完全相同（diff 为空）。**
- **0.1.1 → 0.1.7：48 → 89**，其中：
  - **被删除（5 个）**：`conversation`、`conversation.details.tool`、`details`、`settings.plugin.item`，以及目录外的 `sidebar.workspaces.remoteHosts`（0.1.1 由 `dsh-client-ui-workspace` 声明、0.1.7 删除；0.1.1 目录漏收该项，靠全树 grep 发现——见本节完整性验证）
  - **kind/scope 漂移（仅 2 个）**：
    - `conversation.chat.turnTail`：`chain/session` → **`list/session`**
    - `conversation.hero.agentPreset`：`single/root` → `single/session-maybe`
  - 其余为新增席位（`main`、`main.conversation`、`rightbar`、`rightbar.session`、`plugins.*` 一组、`settings.launcher`、`settings.models.*`、`settings.plugins.tab`、`sidebar.panellist`、`sidebar.right.pane.tab*`、`sidebar.right.tab.*`、`sidebar.session.row.*`、`shell.leading`、`shell.overlay`、`shell.quota-notice`、`tool.call.images`、`deliverables.*`、`conversation.header*`、`conversation.input.activity/permission`、`conversation.plan-review.actions`、`conversation.session.header.corner`、`conversation.trajectory.images`、`settings.general.item` 仍然在 …）

**0.2.0 的 89 个席位（按声明父节点分组，节选关键项）**：

| 席位 | kind | scope | 声明者 |
|---|---|---|---|
| `root` | single | root | 运行时内置（**勿注册**，会遮蔽整个 AppFrame） |
| `shell.overlay` | list | root | 条目 `root` (client-ui-layout) —— 浮层推荐落点 |
| `shell.leading` | single | root | 条目 `root` (client-ui-layout) |
| `sidebar` | single | root | 条目 `root` |
| `sidebar.panellist` / `sidebar.footer.action` / `sidebar.settings` / `sidebar.brand.*` / `sidebar.toggle.badge` | list/single | root | 条目 `sidebar` |
| `sidebar.workspaces` | single | root | 条目 `sidebar` |
| `sidebar.workspaces.directoryFlow` | single | root | 条目 `sidebar.workspaces` (client-ui-workspace) |
| `sidebar.workspaces.session.row.action` / `sidebar.session.row.hover` / `sidebar.session.row.leading` | list | root | 条目 `sidebar.workspaces` |
| `sidebar.workspaces.session.menu.item` | list | root | 条目 `sidebar.workspaces` |
| `sidebar.right.pane.tab` / `sidebar.right.pane.tab.title` | keyed | session | 条目 `rightbar.session` |
| `sidebar.right.tab.guide` / `…guide.entry` / `…menu.item` | chain/keyed/list | session | 条目 `sidebar.right.pane.tab` / `rightbar.session` |
| `sidebar.right.tab.document*` | keyed/list | session | 条目 `sidebar.right.pane.tab` |
| `rightbar` | single | root | 条目 `root` |
| `rightbar.session` | single | session | 条目 `rightbar` |
| `main` | keyed | root | 条目 `root` (client-ui-layout) |
| `main.conversation` | single | session-maybe | 条目 `main` |
| `conversation.header` / `…leading` / `…session.header*` | single/list | session(-maybe)/root | 条目 `main.conversation` 等 |
| `conversation.session.header.actions` / `…corner` / `…lineage` / `…utilities` | list/single | session | 条目 `conversation.session.header` |
| `conversation.view` / `conversation.chat.node` (keyed) / `…chat.assistant-actions` / `…chat.commandview` / **`conversation.chat.turnTail`** | list/keyed/list | session | 条目 `conversation.session` / `conversation.view` / `conversation.chat.node` |
| `conversation.message.images` / `conversation.trajectory.images` | single | session | 条目 `conversation.view` |
| `conversation.composer` (chain) / `…composer.bar` / `…composer.dock` | chain/single/list | session(-maybe) | factory `conversation.content` / 条目 `conversation.composer.bar` |
| `conversation.input.left` / `…right` / `…dock` / `…activity` / `…attachments` / `…model` / `…overlay` / `…permission` / `…plan` | list/single | session(-maybe) | 条目 `conversation.composer.bar` 等 |
| `conversation.hero.workspace` / `…workspace.directoryFlow` / `…agentPreset` / `…brand.mark` | single | root/session-maybe | factory `conversation.content` / 条目 `conversation.hero.workspace` |
| `conversation.plan-review.actions` | list | session | 条目 `conversation.composer` |
| `tool.call.toolview` | keyed | session | 条目 `conversation.chat.node` |
| `tool.call.images` | single | session | 条目 `tool.call.toolview` |
| `tool.view.cordis` | keyed | session | 条目 `tool.call.toolview` |
| `settings.section` | **list** | root | 条目 `sidebar.settings` (client-ui-settings-general) |
| `settings.general.item` | list | root | 条目 `settings.section` |
| `settings.plugins.tab` | list | root | 条目 `settings.section` |
| `settings.action` / `settings.close` / `settings.header` / `settings.launcher` / `settings.trigger` / `settings.onboarding` | list/single | root | 条目 `sidebar.settings` |
| `settings.models.*` | list/keyed/single | root | 条目 `settings.section` / `settings.onboarding` |
| `plugins.item` / `plugins.detail.*` / `plugins.row.config` / `plugins.bundle.*` | list/keyed | root | 条目 `main` (client-ui-plugin-manager) |
| `deliverables.file.actions` / `deliverables.review.file.actions` | list | session | 条目 `conversation.chat.turnTail` / `sidebar.right.pane.tab` |

> 完整 89 项（含 summary/doc/ownerProps/示例代码）见 `work/t16/slotcatalog-020.json`。

**历史坑核查结论：**
- 「槽位名变化」**属实，但发生在 0.1.1 → 0.1.7，0.2.0 未再变**。
- 「`settings.section` 席位」：0.1.1 与 0.2.0 都是 `list/root`，由 `sidebar.settings` 声明；**席位本身没变**。真正被删的是 `settings.plugin.item`（0.1.1 为 `keyed/root`，由 `settings.plugins.tab` 声明）。
- 「注册期不报错」**属实且仍在**（`slots.inject` 静默 `return`）。

---

## 6. 图标集合现状

### 6.1 实测

| 版本 | `dsh-client-ui-primitives` 图标导出 | `Icon*Outline16` / `Icon*16` |
|---|---|---|
| 0.1.1-rc.2 | 48 个 `*16` 名（`IconCloseOutline16` … `IconSparkle16`、`IconStopFill16`、`IconFolderClose16`、`IconFolderOpen16`），**零** `Medium/Regular` | **存在**（0.1.1 安装树 21 个文件引用） |
| 0.1.7-rc.2 | 194 个 `*Medium` / `*Regular`（97 个基名），**零** `*16` | **不存在**（全树仅 1 处文档注释里的 Figma 字形名 `IcDsLogOutOutline16`） |
| 0.2.0-rc.1 | **194 个（97 基名），与 0.1.7 完全相同** | **不存在**（同上，仅注释） |

- 0.2.0 相对 0.1.7 在 `dsh-client-ui-primitives` 上**唯一的导出变化**是新增一个非图标导出 `pointerModality`；`lib/index.js` 体积 523 090 B → 525 922 B。
- `ICON_REGULAR_STROKE = 1`、`ICON_MEDIUM_STROKE = 1.3`（`lib/index.js:249`、`:251`）。
- 命名规律：`Icon<Base>OutlineMedium` / `Icon<Base>OutlineRegular` / `Icon<Base>FillMedium` / `Icon<Base>FillRegular` / `Icon<Base>Medium` / `Icon<Base>Regular`。

### 6.2 0.1.1 → 0.2.0 的完整映射可行性

- **48 个 0.1.1 基名全部能在 0.2.0 找到对应基名**（`comm -23` 结果为空）。
- 后缀改写规则：
  - `IconXOOOutline16` → `IconXOOOutline{Medium|Regular}`
  - `IconXOOFill16` → `IconXOOFill{Medium|Regular}`
  - `IconXOO16`（无 Outline/Fill 段，如 `IconSparkle16`）→ `IconXOO{Medium|Regular}`
- 0.2.0 额外新增 49 个基名（无 16 系对应物），例如 `IconAlarmClockOutline`、`IconArchiveCheckOutline`、`IconCheckCircleFill`、`IconChevron*`、`IconCompareSplitOutline`、`IconContextInjectionOutline`、`IconCordisPluginOutline`、`IconDeliverDoc`、`IconFlatListOutline`、`IconGaugeOutline`、`IconGlobeOutline`、`IconInspectOutline`、`IconMicrophoneOutline`、`IconPaperPlaneOutline`、`IconPin*`、`IconPluginPinwheelOutline`、`IconQueueOutline`、`IconShieldOutline`、`IconSlidersTwoOutline`、`IconTreeCorner`、`IconTriangleRightFill`、`IconUnarchiveOutline`、`IconUsersOutline`、`IconWarningTriangleOutline`、`IconWorkspaceTreeOutline`、`IconWrapFill`、`IconWrapLinesOutline`、`IconFullAccess`、`IconReadOnly`、`IconWorkspaceWrite`、`IconNowrapFill` 等。

### 6.3 0.2.0 图标清单获取方法（源码/导出）

三种等价来源，任选：

1. **直接读导出表（最权威、无需启动服务）**
   ```bash
   grep -oE 'Icon[A-Za-z0-9]+(Outline|Fill)?(Medium|Regular)' \
     <closure020>/node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/index.js | sort -u
   # 194 行，本轮已落盘 work/t16/icons-020-full.txt
   grep -oE 'Icon[A-Za-z0-9]+(Outline|Fill)?(Medium|Regular)' <同上> | sort -u \
     | sed -E 's/(Medium|Regular)$//' | sort -u    # 97 个基名 → work/t16/icons-020-bases.txt
   ```
   也可直接看该包 `lib/index.js` 末尾那一行 `export { … }`（0.2.0 在第 12258 行，含全部 194 个图标名）。
2. **类型面**：`dsh-client-ui-primitives/lib/types/index.d.ts`（`main`/`types` 指向 `lib/types/index.d.ts`，图标名通过 `Icon.tsx` 等再导出）。
3. **运行时面**：浏览器控制台 `Object.keys(require("@deepseek-ai/dsh-client-ui-primitives")).filter(k=>k.startsWith("Icon"))` —— 因为该包是 shell 静态种子词，`require` 直接可用。

---

## 7. 逐插件迁移清单（原样 · 需改 · 重写）

判定口径：只判**客户端半**（`lib/client.js` + `package.json#dsh.client`）。host 半不在本轨道范围（列于 §9 未验证项）。

### 7.1 原样可用（2 个）

| 插件 | 席位使用（对照 0.2.0） | 图标 | require | 结论 |
|---|---|---|---|---|
| `@local/dsh-subagent-model` 0.1.0 | `settings.section` `list/root` ✅ | 无 | `react` ✅ | **原样可用**（`dsh.client.inject` 里的 `@deepseek-ai/dsh-client-runtime` 是死项，但 `inject` 缺项静默跳过，无副作用） |
| `dsh-workspace-enhancement` 0.1.2 | `settings.section` ✅ / `conversation.session.header.actions` ✅ / `sidebar.workspaces.directoryFlow` ✅ / `conversation.hero.workspace.directoryFlow` ✅（4/4 命中） | 无（该 bundle 内 grep 到的 `IconInfo`/`IconWrap` 实为 CSS 类名片段 `confirmIconInfo`/`confirmIconWrap`，不是图标组件；其 require 列表也不含 `dsh-client-ui-primitives`） | `react`, `react/jsx-runtime` ✅ | **原样可用**（同上，`inject` 中 `dsh-client-runtime` 为死项但不致命） |

> 建议（非必须）：把这两个包 `dsh.client.inject` 里的 `@deepseek-ai/dsh-client-runtime` 删掉，避免后续 `inject` 语义收紧时变成硬错误。

### 7.2 需改（4 个）

| 插件 | 症状 | 失败模式 | 改动量 |
|---|---|---|---|
| `@local/dsh-usage` 0.1.0 | `slots.inject("settings.plugin.item")` 席位在 0.1.7 起被删除 | **静默**（UI 消失，无日志） | 1 处席位迁移 |
| `@local/dsh-ssh-gui` 0.2.0 | `slots.inject("sidebar.workspaces.remoteHosts")` 席位在 **0.1.7 起**被删除 | **静默**（1/3 处消失） | 1 处席位迁移 |
| `@local/dsh-wallpaper` 0.5.0 | `require("@deepseek-ai/dsh-client-runtime/client")`（用 `defineStore`） | **抛错**（模块表未命中） | 1 行 require 替换（实现体逐字节相同） |
| `@local/dsh-btw` 0.4.0-btw.1 | 同上 `runtime`（用 `defineStore`）；另 9 个退役图标 | **抛错** + 渲染期 React 元素无效 | 1 行 require + 9 个图标名替换 |

### 7.3 重写 / 重构（1 个）

| 插件 | 症状 | 失败模式 | 为什么不是机械替换 |
|---|---|---|---|
| `@local/dsh-pptmaster` 0.1.0 | ① `runtime` 缺失（用 `isAppendSurfaceEvent`）② `IconBrowseOutline16` 退役 ③ `conversation.chat.turnTail` 由 **chain → list**（0.1.1 起就在链上，0.1.7 变成列表）④ `conversation.hero.actions`、`conversation.hero.inputAccessory` 两个席位在 **0.1.1/0.1.7/0.2.0 三版都不存在** | ③ → **注册期抛错** `list slot "conversation.chat.turnTail" requires options.id`，未捕获则整个 client half apply 失败；④ → 静默 | ③ 的组件 `OfficePptTurnDelivery({ matched, … })` 依赖 chain 选举产出的 `matched` 属性；list 席位没有选举也没有 `matched`，必须改为「组件自己按 owner 上下文判空」，即契约重构而非改字符串 |

---

## 8. 最小改动点

> 前提：本机只有 `@local/dsh-btw` 带完整 TS 源码（`src/` + `tsdown.config.ts`）；`dsh-usage`/`dsh-pptmaster`/`dsh-wallpaper`/`dsh-ssh-gui`/`dsh-subagent-model` 在 profile 里**只有构建产物**，机器上另行找到的副本同样无 `src/`。因此最小改动一律给「**直接改 `lib/client.js` 构建产物**」的形态，改完 `chmod`/mtime 变化会被 host 检测为新 rev（§2.2 的 mtime/size rev 机制），**无需重启也能被浏览器 HMR 换掉**。
>
> 若要正式重建，需先把源码恢复（备份位置见 §8.6），再按 0.2.0 的 bundle 约定产出：单文件 `__ModuleLoader__.load({ id, factory })` + 可选 `//# sourceMappingURL`（若带 `.map`，必须是 Source Map v3，否则请求该 map 时抛错）。

### 8.1 `@local/dsh-wallpaper` — 1 行

文件：`~/.dsh/profiles/node_modules/@local/dsh-wallpaper/lib/client.js`

- **第 15 行**
  ```js
  // 改前
  const runtime = require("@deepseek-ai/dsh-client-runtime/client");
  // 改后
  const runtime = require("@deepseek-ai/dsh-client-store");
  ```
- 理由：`runtime` 的唯一用法是第 320 行 `runtime.defineStore({ init, actions, persist })`。0.2.0 `@deepseek-ai/dsh-client-store/lib/index.js:147-168` 的 `defineStore(decl)` 函数体与 0.1.1 `dsh-client-runtime/lib/client.js:5472` 的 `defineStore(decl)` **逐字节相同**（同样返回 `{ spec, create(scopeKey){…persist…}, … }`），且该包是 shell 静态种子词 ⇒ 直接替换即可，无需其它改动。
- `package.json`：`dsh.client.inject` 里的 `@deepseek-ai/dsh-client-runtime` 可一并删除（不删也无害）。
- 席位 `settings.general.item`（`list/root`）在 0.2.0 存在，**无需改**。

### 8.2 `@local/dsh-btw` — 1 行 + 9 个符号名

文件：`~/.dsh/profiles/node_modules/@local/dsh-btw/lib/client.js`

1. **第 11 行**：`require("@deepseek-ai/dsh-client-runtime/client")` → `require("@deepseek-ai/dsh-client-store")`
   （唯一用例在第 9222 行 `(0, _deepseek_ai_dsh_client_runtime_client.defineStore)({…})`，同 §8.1 理由。）
2. **9 个退役图标名替换**（每一处都是 `_deepseek_ai_dsh_client_ui_primitives.<旧名>`）：

   | 旧名（0.2.0 中为 `undefined`） | 新名 | 备注 |
   |---|---|---|
   | `IconBranchOutline16` | `IconBranchOutlineMedium` 或 `IconBranchOutlineRegular` | 第 2137 行 |
   | `IconBrowseOutline16` | `IconBrowseOutlineMedium` / `…Regular` | |
   | `IconCloseOutline16` | `IconCloseOutlineMedium` / `…Regular` | 另有 `IconCloseFillMedium/Regular` |
   | `IconCodeOutline16` | `IconCodeOutlineMedium` / `…Regular` | |
   | `IconEditOutline16` | `IconEditOutlineMedium` / `…Regular` | |
   | `IconSearchOutline16` | `IconSearchOutlineMedium` / `…Regular` | |
   | `IconSendOutline16` | `IconSendOutlineMedium` / `…Regular` | |
   | `IconSparkle16` | `IconSparkleMedium` / `IconSparkleRegular` | 第 1100 行，带 `size: 14` |
   | `IconStopFill16` | `IconStopFillMedium` / `IconStopFillRegular` | 第 1920 行 |

   选择建议：`size` 由组件显式传入（如 `size: 14`）时 `Medium`/`Regular` 二者皆可——两者的差别是描边粗细（1.3 vs 1）；沿用旧 `*16` 的视觉密度更接近 `Medium`。推荐统一用 `…Medium`。
3. 席位：`conversation.session.header.actions`（`list/session`）✅、`shell.overlay`（`list/root`）✅ —— **无需改**。
4. （可选）`package.json#dsh.client.inject` 删除 `@deepseek-ai/dsh-client-runtime`。

### 8.3 `@local/dsh-pptmaster` — 2 处字符串 + 1 处契约重构 + 2 处席位迁移

文件：`~/.dsh/profiles/node_modules/@local/dsh-pptmaster/lib/client.js`

1. **第 10 行** `require("@deepseek-ai/dsh-client-runtime/client")` —— 本包只用到一个导出 `isAppendSurfaceEvent`（唯一用例在第 42218 行）。
   **推荐：直接内联，去掉这行 require**。第 42218 行的上下文已经是
   ```js
   if (event.type === "tool/result" && (0, _deepseek_ai_dsh_client_runtime_client.isAppendSurfaceEvent)(event)) return {…};
   ```
   而 0.2.0 的语义为（`dsh-session/lib/index.js:174-176`、`:189`）：
   ```js
   const SURFACE_EVENT_TYPES = new Set(["system/message","developer/message","user/message","assistant/message","tool/result"]);
   function isSurfaceEvent(e){ return SURFACE_EVENT_TYPES.has(e.type) && e.surfaceOp !== void 0; }
   function isAppendSurfaceEvent(e){ return isSurfaceEvent(e) && e.surfaceOp === "append"; }
   ```
   因调用点已把 `event.type === "tool/result"` 作为前置条件（而 `"tool/result"` 就在集合内），等价最小改写为：
   ```js
   if (event.type === "tool/result" && event.surfaceOp === "append") return {…};
   ```
   然后删除第 10 行的 require（若该变量在别处无其它引用）。
   *备选（需追加声明）*：改为 `require("@deepseek-ai/dsh-client-ui-chat")` 并在 `dsh.client.external` 加 `"@deepseek-ai/dsh-client-ui-chat/client"`——不推荐，引入了对一个大型 UI 包的运行时耦合。

2. **退役图标 `IconBrowseOutline16` → `IconBrowseOutlineMedium`**（3 处：第 692、699、41409 行，均带 `size: 15`）。

3. **`conversation.chat.turnTail`：chain → list（必须改，否则注册期抛错）**
   现状（第 42322 行起）：
   ```js
   ctx.slots.inject("conversation.chat.turnTail", () => ctx.slots.register({
       name: "conversation.chat.turnTail",
       select: selectOfficePptDelivery,   // chain 专属；list 席位忽略该字段
       priority: -10,
       locale: NS,
       inject: injectHero
   }, OfficePptTurnDelivery));
   ```
   0.2.0 中该席位为 `list/session`，`SlotCore.register` 要求 `options.id`，缺则：
   `Error: list slot "conversation.chat.turnTail" requires options.id`
   最小改动：
   ```js
   ctx.slots.inject("conversation.chat.turnTail", () => ctx.slots.register({
       name: "conversation.chat.turnTail",
       id: "office-ppt",              // ← 新增，list 必需
       order: 20,                     // ← 原 priority 排序语义改由 order 承担
       // select: … 删除（list 无选举）
       locale: NS,
       inject: injectHero
   }, OfficePptTurnDeliveryGuarded));
   ```
   并改造组件契约：原 `OfficePptTurnDelivery({ matched, client, openFile, t })`（第 41849 行）依赖 chain 选举结果 `matched`。list 席位不提供 `matched`；0.2.0 目录给出的该席位契约是（`work/t16/slotcatalog-020.json` → `conversation.chat.turnTail`）：

   - `registerOptions`：`id`（**required**，string）、`order`（optional，number）、`label`（optional，`string | (() => string)`）
   - `ownerProps`：`TurnTailOwnerProps = { turn: TurnLocation; seq: number; openFile: (path: string) => void }`
   - `doc`：「Each entry receives the Turn, closing sequence, and file opener. A fresh `id` adds an entry; **entries without content return null**.」

   据此最小重构：
   ```js
   function OfficePptTurnDeliveryGuarded({ turn, seq, client, openFile, t }) {
     const matched = deliveryForClosing(turn.data.get("officePptDelivery"), seq); // 即原 selectOfficePptDelivery 的逻辑
     if (matched === undefined || matched === null) return null;                  // 上级目录明确要求「无内容返回 null」
     return jsx(DeckDelivery, { deckId: matched.deckId, ...(matched.fileName === undefined ? {} : { deliveredFileName: matched.fileName }), client, openFile, t });
   }
   ```
   （`deliveryForClosing` 与 `selectOfficePptDelivery` 已在同 bundle 内，第 42203-42205 行可复用。）
   **这是本插件唯一需要「重写」而非「替换字符串」的点。**

4. **两个不存在席位的迁移（静默失效，需重新选落点）**
   - `conversation.hero.inputAccessory`（第 42288 行）→ 0.2.0 无 hero accessory 席位；等价落点为 **`conversation.input.left`**（`list/session`，"Compact controls at the left of the composer tool row"）或 `conversation.input.dock`（`list/session`）。改动：`name` 改为 `conversation.input.left` 且补 `id`、把 `order: 20` 保留。
   - `conversation.hero.actions`（第 42295 行）→ 0.2.0 hero 只有 `conversation.hero.agentPreset` / `…workspace` / `…brand.mark`（均 `single`，且都是上游占用），无通用 actions 列表；建议并入 `conversation.input.left`（与上一条同席位、不同 `id`/`order`），或落 `shell.leading`（`single/root`）。
   - **重要事实澄清**：这两个席位在 **0.1.1 也从未存在**——判定依据是**全树 grep**（`grep -rl "conversation.hero.actions" <0.1.1 真实安装树>` → 0 文件；同法 `conversation.hero.inputAccessory` → 0 文件），而非目录（0.1.1 目录为 48/49 近似完备，见 §5.3）。0.1.1 的 `dsh-client-ui-conversation` 只出现 `conversation.hero.agentPreset|brand.mark|workspace`。它们只出现在 pptmaster 自己的 `lib/types/client/OfficePptHero.d.ts`（类型层 `declare module` 增强），**运行时从未被声明过** ⇒ 属**既有失效**，不是 0.2.0 回归。
   - 对照：同插件的 `conversation.chat.turnTail` 与 `tool.call.toolview` 是**真席位**（0.1.1 起即存在），因此本插件的失效是「2 处既有 + 1 处 0.1.7 起的 kind 漂移」混合，不能一概归因于 0.2.0。

5. 保留不动：`tool.call.toolview`（`keyed/session`）✅、`conversation.chat.turnTail` 之外的席位无需动。
6. `package.json#dsh.client.inject` 删除 `@deepseek-ai/dsh-client-runtime`。

### 8.4 `@local/dsh-usage` — 1 处席位迁移

文件：`~/.dsh/profiles/node_modules/@local/dsh-usage/lib/client.js`（第 1390 行起）

```js
ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
    name: "settings.plugin.item",
    key: "dsh-usage",
    locale: "dshUsage",
    …
```
- `settings.plugin.item` 在 0.1.1 是 `keyed/root`（由 `settings.plugins.tab` 声明的「插件配置区里某插件的卡片」），0.1.7 起被删除，0.2.0 无此席位。
- 最小改动：改为 `settings.section`（`list/root`，`settings.section` 是「一个设置页」），把 `key:` 换成 `id:`，其余字段原样保留：
  ```js
  ctx.slots.inject("settings.section", () => ctx.slots.register({
      name: "settings.section",
      id: "@local/dsh-usage",     // list 必需（原 key 是 keyed 语义，list 会忽略 key）
      order: 60,
      locale: "dshUsage",
      // REVIEW P3: `connection` is declared in package.json …
      inject: () => ({ useStore, rpc: ctx.connection?.rpc ?? null, sessions: ctx.sessions, settingsScope }),
  }, UsageCard));
  ```
  `SlotCore.register` 对 `list` 只强制 `id`（`dsh-client-ui-slots/lib/index.js:182-186`），`label`/`order` 均为可选——原注册调用本来也没有 `label`，无需新增。
  （若希望保持「插件卡片」观感，另一候选是 `settings.plugins.tab`（`list/root`，"One page inside the Plugins settings section"），同样需要 `id`。）
- 该包只 `require("react")`，无其它阻塞点。

### 8.5 `@local/dsh-ssh-gui` — 1 处席位迁移

文件：`~/.dsh/profiles/node_modules/@local/dsh-ssh-gui/lib/client.js`（第 1018 行起）

```js
ctx.slots.inject("sidebar.workspaces.remoteHosts", () => ctx.slots.register({
    name: "sidebar.workspaces.remoteHosts",
    id: "@local/dsh-ssh-gui-remote-hosts",
    order: 10,
    label: () => "分布式节点",
    …
```
- `sidebar.workspaces.remoteHosts` **在 0.1.1 是真实上游席位**：由 `dsh-client-ui-workspace` 声明为 `list/root` 子席位并渲染。
  实测（0.1.1 真实安装树）：
  ```
  dsh-client-ui-workspace/lib/types/client/contract/slots.d.ts:65   'sidebar.workspaces.remoteHosts': {
  dsh-client-ui-workspace/lib/client.js:2013                        wide && renderSlot("sidebar.workspaces.remoteHosts", {}),
  dsh-client-ui-workspace/lib/client.js:2440                        }, "sidebar.workspaces.remoteHosts": { kind: "list", scope: "root" } },
  ```
  0.1.7 真实安装树（`~/.npm-global-dsh017/...`）与该席位相关的文件数 = **0** ⇒ **0.1.7 起被删除**，属真实回归（非既有死项）。
- 候选落点（均为 `list/root` 的加性席位）：
  - `sidebar.footer.action` —— "Optional actions beside Settings at the sidebar foot"（若「分布式节点」是随时的全局入口，最贴近）
  - `sidebar.panellist` —— 侧栏面板列表（若要一块常驻面板）
  - `sidebar.workspaces.session.row.action` —— "hover buttons at the end of one Session row"（若入口是「某会话的远程执行」）
- 改动：替换 `name` 值（`id`/`order`/`label` 可原样保留；三个候选都是 list ⇒ `id` 必需，已具备）。
- 其余两个席位 `settings.section`（`list/root`）✅、`conversation.session.header.actions`（`list/session`）✅ 无需改；该包只 `require("react")`。

### 8.6 源码恢复位置（若要正式重建而非改产物）

| 插件 | 本机可用源码 | 构建入口 |
|---|---|---|
| `@local/dsh-btw` | **有**：`~/.dsh/profiles/node_modules/@local/dsh-btw/src/` + `tsdown.config.ts` + `package.json#scripts.build = "tsdown"` | `pnpm run check`（lint+typecheck+test+build+smoke+publint） |
| `@local/dsh-usage` | 仓库内 `/home/CNS2026495165/dsh/dsh-usage`（本轮实测无 `src/`）、`.workspace/workstreams/sources/dsh-usage-src` | — |
| 其余 4 个 | 仅备份副本：`/home/CNS2026495165/dsh-upgrade-backup/20260925-110042/local-plugins/@local/<p>`、`dsh-workspace-enhancement` 在 `…/local-plugins/dsh-workspace-enhancement`（均无 `src/`） | — |

⇒ **本机当前无法对这 5 个插件做「源码重建」，只能改构建产物或在别处找回源码。**

---

## 9. 未验证项

以下条目本轨道**未实测**，迁移执行档必须另行验证，不得从本报告推断：

1. **host 半的兼容性未审计。** 本报告只判客户端半。`dsh-pptmaster`/`dsh-usage`/`dsh-btw`/`dsh-wallpaper`/`dsh-ssh-gui`/`dsh-workspace-enhancement` 的 `lib/index.js`（cordis 服务、settings 命名空间、`/api` 路由、SSH provider、工具注册）在 0.2.0 上是否可用，需 T 系列其它轨道覆盖。
2. **未实际启动 0.2.0 web 实例。** 全部结论来自源码/产物静态读取；「改完后 UI 是否真的出现」「静默失效是否真的无日志」属运行时断言，需在隔离根内实跑 `dsh web` 并观察 Web boot audit 报告后确认。
3. **`__DSH_BOOT__` 图与 Web boot audit 的实际输出未采集。** §4.2 的「模块表未命中」抛错文案是从源码取得；其是否被 audit 汇总为可读条目、是否阻断整个插件加载，未实测。
4. **`conversation.chat.turnTail` 的 owner share 形状已从 0.2.0 目录核实**（`{ turn: TurnLocation; seq: number; openFile }`，`id` 必填）——见 §8.3-3。但 `TurnLocation` 这一引用类型的具体字段、以及 `turn.data` 在 0.2.0 中的读取方式（`TurnLocation.data` 是否仍是同一 Map 形态）**未逐一核对**，实施时须以 `dsh-client-ui-chat` 的运行时 `TurnTailOwnerProps` 实际传入值为准。
5. **`settings.section` 改成 usage 的落点后，`label` 与 `locale` 的呈现细节未验证**；`settings.general.item` 与 `settings.section` 的取舍属产品决策，本报告只给技术可行候选。
6. **`Icon*Medium` vs `Icon*Regular` 的视觉取舍未做像素级比对**，只核对了描边常量（1.3 / 1）与命名规律。
7. **`dsh-web-app` 移除 `dsh-schedule` / `dsh-time-context` 对 `ui-schedule` 席位的连带影响未展开**（§3.4 仅记录事实与依赖差异）。
8. **`dsh-host-frontend-static` 的 dist 无 `cache-control` 是否在 0.2.0 引入新的缓存失效问题未评估**（属宿主行为，非插件兼容）。
9. **本轨道未使用 `sandbox_permissions`，未写 `~/.dsh/**`、`~/.dsh-017/**` 或任何既有插件源码**；如需「改产物验证」的动作，请在执行轨道复制到 `.workspace/audit-020/` 下进行（题面硬约束）。

---

## 10. 本轨道留存的原始证据文件

| 路径 | 内容 |
|---|---|
| `work/t16/normcmp.sh` | 0.1.7↔0.2.0 归一化逐文件对比脚本（含 stdin 陷阱修正注释） |
| `work/t16/realdiff.txt` | 上述脚本的完整输出（真实内容差异清单） |
| `work/t16/dumpplots.mjs` | 从 `dsh-cordis-client-runner/lib/client.js` 抽取槽位目录的脚本（处理多行数组字段） |
| `work/t16/slotcompleteness.mjs` | 槽位目录完整性交叉验证（代码提及的席位名 vs 目录 key，覆盖 0.1.1/0.1.7/0.2.0） |
| `work/t16/slotcatalog-020.json` | 0.2.0 全部 89 个席位（key/kind/scope/summary/doc/declaredBy/ownerProps/replaceRisk/source） |
| `work/t16/slotcatalog-017.json` | 0.1.7 的 89 个席位（与 020 逐项相同） |
| `work/t16/slotcatalog-011.json` | 0.1.1 的 48 个席位（用于定位历史漂移） |
| `work/t16/icons-020-full.txt` | 0.2.0 的 194 个图标导出名 |
| `work/t16/icons-020-bases.txt` | 0.2.0 的 97 个图标基名 |
| `work/t16/icons-011-bases.txt` | 0.1.1 的 48 个 `*16` 图标基名 |
| `work/t16/slots-closure017.txt` / `slots-closure020.txt` | 席位 key/kind/scope/declaredBy 简表（两版逐项相同） |

---

# 附录 A — T16 独立复核增补（第二轮，2026-09-29；协调者插播证据校正后的补充审计）

> **性质**：本节由**第二档 T16 审计**在协调者插播「证据校正」（`reports/MEASURED-BASELINE.md` + `lib/` churn 口径 + 5 项实测事实）后追加。
> 本档**不覆盖**上文任何结论，只做三件事：① 对协调者点名包按 **`lib/` 逐文件口径**独立复算；② 补上本文未触及的**第三类破坏面（服务端 settings 导入断层）**；③ 对本文一处**归属时点**做证据级修正。
> 本档对照树 = 协调者指定：**0.2.0** = `.workspace/iso-020/npm-global/node_modules/@deepseek-ai/`（289 目录，实测 `dsh` = `0.2.0-rc.1`）；**0.1.7** = `~/.npm-global-dsh017/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`（283 目录，抽样 10 包全部 `0.1.7-rc.2`）；**0.1.1** = `~/.dsh/profiles/node_modules/@deepseek-ai/` + `~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`。
> 原始输出：`.workspace/audit-020/t16/{api-check,export-check,slot-icon-check}.mjs|json|txt`。

## A.0 证据类型口径（本档强制）

| 标记 | 含义 | 边界 |
|---|---|---|
| **[哈希]** | `lib/` 逐文件 `cmp -s` 全等 ⇒ **推定**未变 | 不含非 `lib/` 路径（包根 `cordis.patch.yml`、`presets/*.yml`、`exports`、`package.json`）；不证明对第三方插件的**解析目标**安全 |
| **[实读]** | 当轮打开 0.2.0 文件读到具名符号/行号，或两树符号集合差 | — |
| **[实读/011]** | 0.2.0 源码 + 0.1.1 现役制品对照（取证方式随结论注明） | 0.1.1 侧若依赖 shell bundle 而非包源码，须显式声明 |

## A.1 协调者问 1：点名包按 `lib/` 口径独立复算

| 包 | 简报数字 | **本档实测 `lib/` 递归全量** | differ 文件 | 是否真为代码 |
|---|---|---|---|---|
| `dsh-client-modules` | 零改动 | **10 文件，differ 0** | — | 无（一致） |
| `dsh-client-ui-cordis` | 22 文件 1 改 | **17 文件，differ 0** | — | **无** |
| `dsh-cordis-client-runner` | 18 文件 2 改 | **13 文件，differ 1** | `client.js` | **是** |
| `dsh-plugin-manager` | 34 文件 1 改 | **29 文件，differ 0** | — | **无** |
| `dsh-host-frontend-static` | 7 文件 1 改 | **2 文件，differ 0** | — | **无** |
| `dsh-host-webserver` | 8 文件 1 改 | **3 文件，differ 0** | — | **无** |
| `dsh-web-app` | 14 文件 5 改（35.7%） | **`lib/` 4 文件 differ 0**；包根另有实质改动 | `cordis.patch.yml`（41 行差）、`package.json`（271 行差）；`presets/*.yml` ×4 全等 | **`lib/` 无；组合补丁层有** |

**结论**：点名 7 包中**只有 `dsh-cordis-client-runner/lib/client.js` 一处真实代码改动**；`dsh-web-app` 的变化**不在 `lib/`**。⇒ 「判定改动必须看 `lib/`」这条口径**同时**意味着**不能只看 `lib/`**：bundle 补丁层与 `package.json`（`exports` 映射）在 `lib/` 之外，须单独比对。

**口径分歧登记（不掩盖）**：上表 5 个包的简报数字与本档不一致（22↔17、34↔29、7↔2、8↔3、14↔4）。本档按 `lib/` 递归**全量文件**（含 `lib/types/**`）计数，且已逐文件列名复核：上述 5 包的 020/017 两侧 `lib/` **文件清单完全一致且逐字节相同**。分歧**不影响**两条结论（① 这些包 `lib/` 无代码改动；② 真实改动面集中在 §A.2 表列出的包）。建议 T01/T02 统一口径后回填；本档不据简报数字下任何结论。
**另需更正一条**：`dsh-web-app` 的 41 行包根差异**不是**「客户端插件加载面变化」，而是组合行变化（见 A.5）。

## A.2 官方 Web 客户端面增量的本档独立复算 [哈希]

| 包 | `lib/` totFiles | same | differ | 备注 |
|---|---|---|---|---|
| `dsh-client-modules` | 10 | 10 | **0** | 发现/加载机制未变（与本文 §1.1 一致） |
| `dsh-client-ui-slots` | 4 | 4 | **0** | 槽核心未变（含 list 槽 `id` 约束） |
| `dsh-settings` | 9 | 9 | **0** | 见 A.3：断层系 0.1.7 已发生 |
| `dsh-tools`/`dsh-skill`/`dsh-agent`/`dsh-llm`/`dsh-credentials`/`dsh-typert-protocol`/`schemastery` | 22/2/20/34/8/11/4 | 全等 | **0** | 本机 6 插件服务端导入面的多数目标 |
| `dsh-session` | 24 | 19 | **5** | 见 T12 |
| `dsh-subagent` | 54 | 53 | **1** | 见 T13 |
| `dsh-client-ui-primitives` | 123 | 110 | **13** | 1 JS + 5 CSS + 7 `.d.ts` |
| `dsh-client-ui-conversation` | 72 | 64 | **7**（+1 新增） | 新增 `types/client/input/submission-analytics.d.ts`（"对话实时"） |
| `dsh-client-ui-chat` | 94 | 85 | **7**（+2 新增） | 新增 `RunningStatus.d.ts`、`RunningWhaleTail.d.ts`（"实时动画"） |
| `dsh-client-ui-plugin-manager` | 18 | 12 | **4**（+2 新增） | 新增 `PluginRefreshToast.d.ts`、`sanitize-install-input.d.ts`（"插件管理交互"） |
| `dsh-client-ui-tool` | 42 | 41 | **1** | `client.js` |
| `dsh-client-ui-theme` | 16 | 15 | **1** | `client.js` |
| `dsh-client-ui-skill` | 6 | 5 | **1** | `client.js` |
| `dsh-cordis-client-runner` | 13 | 12 | **1** | `client.js` |
| `dsh-client-ui-cordis`/`dsh-plugin-manager`/`dsh-host-frontend-static`/`dsh-host-webserver`/`dsh-web-app` | 17/29/2/3/4 | 全等 | **0** | 见 A.1 |

## A.3 【本文未覆盖 · 关键新增】服务端 settings 导入断层：6 个客户端插件里 4 个硬失败

本文 §1.2 判定 `@local/dsh-subagent-model`「原样可用」、`@local/dsh-wallpaper`「需改（机械，因 runtime 包）」。本档**修正为**：这两个插件（以及 `dsh-btw`、`dsh-ssh-gui`）还命中**第四类破坏面——ESM 具名导入的服务端符号在 0.1.7 起已被整体删除**，属**链接期（load-time）硬失败**，比席位静默消失更硬。

| 插件 | 导入语句（实测 `lib/index.js` 行号） | 用到的符号 | 0.1.1 | 0.1.7 | 0.2.0 |
|---|---|---|---|---|---|
| `@local/dsh-btw` | `:3` `import { settingsNamespace } from "@deepseek-ai/dsh-settings"` | `settingsNamespace`（`:1734`） | **有** | **无** | **无** |
| `@local/dsh-ssh-gui` | `:49` `import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'` | 二者（`:68`） | **有** | **无** | **无** |
| `@local/dsh-subagent-model` | `:19` 同款双导入 | 二者（`:26`） | **有** | **无** | **无** |
| `@local/dsh-wallpaper` | `:17` `import { settingsNamespace } from "@deepseek-ai/dsh-settings"` | `settingsNamespace`（`:30`） | **有** | **无** | **无** |

- **[实读]** `@deepseek-ai/dsh-settings` 导出集合：**0.1.1** = `{SettingsConflictError, SettingsProvider, deepEqualJson, default, installSettingsSection, redactSecrets, settingsNamespace}`；**0.1.7 = 0.2.0** = `{SettingsConflictError, SettingsForms, SettingsForms as default, redactSecrets}`（0.2.0 `lib/index.js:544` 的 `export {…}` 行；`SettingsForms` 类定义在 `:322`）。
- **[哈希]** `dsh-settings/lib/` 9 文件 0.1.7↔0.2.0 **differ 0** ⇒ **不是 0.2.0 引入**，与 `reports/PLUGIN-MATRIX.md` §2「上一轮 0.1.7 迁移的未闭缺口」一致，本档给出**符号级证据与文件行号**。
- **为何是硬失败**：ESM 具名导入在**链接期**解析，符号不存在即抛 ⇒ **插件根 fiber 加载即失败**，不只是设置页丢失。这解释并加强了 `PLUGIN-MATRIX` 中 3 个插件 0.2.0 `FAIL` 的根因（本档另指出 `dsh-btw`、`dsh-ssh-gui` 也会命中同一断层，但二在 PLUGIN-MATRIX 里未被标记为 FAIL —— 差异可能来自该矩阵的本地插件件版本或解析路径不同，**建议协调者对 `dsh-btw`/`dsh-ssh-gui` 复跑一次导入矩阵**）。
- **0.2.0 官方替代形态** [实读 `dsh-settings/README.md:24–43`]：命名空间**不再由插件显式注册**——表单 "identify each plugin **by its profile entry id**"，只暴露该条目 Config 中**以 `.volatile()` 声明**的字段；需自绘页面者用 `ctx.inject(['settings'], …)` 子作用域内 `configure({ auto: false }, ctx.fiber)` 声明策略；客户端页面继续 `ctx.slots.register({name:"settings.section"})` + `ctx.configForms.describe()/get()`。
- **[实读] 客户端服务面未变**：`configForms.*` 实际被引用的成员集合 0.1.7 与 0.2.0 **完全相同**（`describe` / `get` / `whileServed` / `developerTools`）。

## A.4 座位面：本档独立复算（90=90 / 67=67）

- **声明槽名集合**：0.1.7 与 0.2.0 各 **90** 个，双向差集 **空**（来源三类：`children` 表键 `"<name>": { kind|scope }`、`slots.inject("<name>",…)`、`renderSlot("<name>",…)`）。**与本文 §5.1 的 89 个席位目录互为独立方法学印证（差异仅计数口径）。**
- **`slots.inject` 动态名集合**：两版各 **67** 个，**逐字相同**。⇒ 本机插件自建动态座（`conversation.hero.actions` / `conversation.hero.inputAccessory` / `settings.plugin.item` / `sidebar.workspaces.remoteHosts`）所依赖的机制未变；四者**在官方两树均 0 命中**，属**既有失效，非 0.2.0 回归**（与本文 §8.3.4 结论一致）。
- **`ctx.slots.inject` 语义定位说明**：本档另行确认 `dsh.client.inject` 与 `slots.inject` 是两个不相干的东西（见 A.6）；`slots.inject` 的实现在 `dsh-client-ui-renderer`（与本文 §1.3-1 的锚点一致），不在 `dsh-client-ui-slots/lib/index.js` 内。

## A.5 【本文未覆盖 · 新增发现】0.2.0 把 schedule/time 三行移出 web-app

[实读] 行 id 集合差：

- `dsh-web-app/cordis.patch.yml`：**+** `desktop-product-telemetry`、`product-analytics`、`ui-settings-session-log`；**−** `time-context`、`schedule`、`ui-schedule`（41 行差）
- `dsh-base/cordis.patch.yml`：**+** `otel`（仅此一行）
- `dsh-web-app/presets/{standard,ptc,minimal,cordis}.patch.yml`：**4 文件逐字节相同** [哈希]

移出目标：**新增包** `@deepseek-ai/dsh-experimental-schedule-bundle`，其 `cordis.patch.yml:3–16` 注释明写 *"Experimental Schedule over the shipped Web composition, which carries none of these rows"*，并插入 `time-context` / `schedule` / `ui-schedule` 三行。
**影响面**：本机 6 个客户端插件**均不注册** schedule/time 相关座 ⇒ **不受影响**；但任何依赖"会话内定时任务 / 时间上下文"的既有工作流，迁到 0.2.0 后需显式插入该 bundle 行。两行新增 telemetry 均为 desktop 专属（`disabled: ctx.get('profileContext')?.name !== 'desktop'`），web profile 不生效。

## A.6 协调者问 4：`dsh.client.inject` 是否为运行时硬依赖（本档给出定论）

**不是。** [实读] `@deepseek-ai/dsh-package-manifest/lib/types/types.d.ts:76–89`：

- `platform: string`（必填）
- `inject?: string[]` —— **原文注释：`Informational package-name dependencies, not Cordis service injection`**
- `immediately?: boolean`
- `external?: string[]` —— 原文：`Exact module-table requests beyond the implicit client baseline, including subpaths such as <pkg>/client; absent means baseline externals only. Type-only imports are erased and create no module request.`

[实读] `dsh-client-modules/lib/index.js:65–67` 只强校验 `platform` 必须为 string，`inject`/`external` 走 `optionalStringArray`（缺失合法、类型错才抛）。⇒ 本机插件把 `inject` 写成**在 0.1.7/0.2.0 已不存在的** `@deepseek-ai/dsh-client-runtime`（实测两树无该目录；全树 grep 仅 `dsh-invariants/README*` 的历史提及）**不构成加载失败**。6 个插件也均未声明 `external`，与两个官方样例同形 [实读]。
**但 `require("@deepseek-ai/dsh-client-runtime/client")` 是另一回事**：它是**真实模块请求**，落在基线种子表/模块图之外的解析即抛（本文 §1.3-2 已定此项）；`dsh-pptmaster` 现役能跑只因**自带嵌套树**仍供应该包（见 A.7）。

## A.7 【本文一处归属时点的证据级修正】`turnTail` 的 chain→list 发生在 **0.1.1**，不是「0.1.7 起」

本文 §8.3.3 结论方向正确（`conversation.chat.turnTail` 在 0.2.0 是 `list`，`select` 无效，缺 `id` 注册期抛错），但**把该 kind 漂移归到「0.1.7 起」不准确**。本档三版本源码实测：

| 版本 | 声明者 | kind | 渲染入口 |
|---|---|---|---|
| **0.1.1** | `dsh-client-ui-conversation/lib/client.js:9820–9823`（`children` 表内） | **`chain`** | `renderSlotChain("conversation.chat.turnTail", …)` `:9721` |
| **0.1.7** | `dsh-client-ui-chat/lib/client.js:6787–6790` | **`list`** | `renderSlot("conversation.chat.turnTail", …)` `:6512` |
| **0.2.0** | `dsh-client-ui-chat/lib/client.js:6906–6909` | **`list`** | `renderSlot("conversation.chat.turnTail", …)` `:6631` |

- 0.1.7 与 0.2.0 的该 `children` 声明、`scope`、渲染入口**逐字相同**；`0.1.1 → 0.1.7` 之间不仅 kind 由 `chain` 变 `list`，声明者还从 `dsh-client-ui-conversation` 迁到 **新建包 `dsh-client-ui-chat`**（0.1.1 树中**无** `dsh-client-ui-chat`，实测 `ls` 不存在）。
- ⇒ **修正表述**：`turnTail` 的 chain→list 是 **0.1.1 → 0.1.7 的破坏性变更**；0.1.7 → 0.2.0 **无变化**。因此该项对「0.1.7 已迁移部署」是**存量债**，对「0.1.1 直迁 0.2.0」是**新增债**——**两种路径都要改**，但归因不同。
- **本档同时更正自己在第一轮 T15 审计中的一处判断**：T15 §1（历史缺陷点 D3）曾据 0.1.7 与 0.2.0 的 `dsh-client-ui-slots` 哈希相同推断「非 0.2.0 回归，是否抛出待实跑」。现经三版本 seat-kind 实读，**该判断方向正确但归因不完整**：真因是 `chain→list` 的 kind 漂移（此前我未比对 0.1.1 的 kind），而**不是** list 槽 `id` 约束本身新引入。含 `select` 的注册在 0.1.7/0.2.0 的 list 槽上**必然**在注册期抛错（`SlotCore.register` 对 list 分支先校验 `id`），故本文 §8.3.3 的「必须改」判定**成立**。

## A.8 本档对协调者问 2/3 的独立复算

- **问 2（高 churn 包是否影响本机注册点/图标）**：**不影响**。三条独立证据：① 声明槽名 **90=90、双向差集空**；② `slots.inject` 名单 **67=67 逐字相同**；③ `dsh-client-ui-primitives` 导出符号 **0.2.0 = 280 个、0.1.7 = 279 个，仅新增 `pointerModality`，无删除** [实读]。逐包点名的 12 个包**无一处增删槽名**；其中 4 个含**纯新增**类型文件（`submission-analytics`、`RunningStatus`、`RunningWhaleTail`、`PluginRefreshToast`、`sanitize-install-input`）。
- **问 3（release note 三项）**：**均不影响本机 6 插件**。
  - 插件管理界面/清单布局/安装引导 → `dsh-client-ui-plugin-manager/lib/client.js`（4 改）+ `dsh-client-ui-settings-plugin-inventory`（1 改）：槽名集合不变；本机 6 插件**无一**注册到 plugins 面板座（`sidebar.panellist` / `settings.plugins.tab` / `plugins.item`）。
  - 深色主题开关对比度 → `dsh-client-ui-primitives/lib/Switch.module.css` 新增 `.switch[aria-checked='false'] .thumb { background: var(--dsw-alias-switch-thumb); }`（[实读] diff 4 行）：纯样式；`dsh-client-ui-theme/lib/client.js` 槽名集合不变，本机 `dsh-wallpaper` 只注册 `settings.general.item`（未被改）。
  - 桌面弹窗避让标题栏 → `Modal.module.css` 变量改名 `--dsh-frame-top-clearance` → `--dsh-frame-overlay-top`；**实测本机 6 插件均未引用旧变量**（逐个 `grep` 命中 0），且两行 telemetry 为 desktop 专属。

## A.9 本档的保留 / 裁剪 / 退役增量（仅记增量，不重列本文 §7）

| # | 对象 | 判定 | 依据 |
|---|---|---|---|
| A-K1 | 6 插件的 `dsh.client` 声明块（`platform` + `exports["./client"]`） | **保留原样** | [实读] `clientExportOf` 仍读 `exports["./client"]`；6 个**全部合规**（2 个 `types`+`default`、4 个纯字符串） |
| A-K2 | 4 个插件自建动态座 | **保留原样** | [实读] 官方两版皆 0 命中；`slots.inject` 机制未变 |
| A-C1 | 4 个插件的 `@deepseek-ai/dsh-settings` 具名导入 | **裁剪（替换为 0.2.0 形态）** | [实读] 符号在 0.1.7/0.2.0 均不存在；ESM 链接期硬失败 |
| A-C2 | `dsh-btw` 11 个旧图标名 / `dsh-pptmaster` 2 个 | **裁剪（改名）** | [实读/011] 旧名两版各 0 命中、新名齐备 |
| A-C3 | `dsh-client-runtime` 作为 `require` 目标（3 插件） | **裁剪（指向真实供给者）** | [实读] 该包 0.1.7/0.2.0 均不存在 |
| A-C4 | schedule/time 三行（若需保留该能力） | **裁剪（显式插入 `dsh-experimental-schedule-bundle`）** | [实读] 行 id 集合差 + bundle 注释 |
| A-R1 | 「`dsh.client.inject` 缺项会导致插件加载失败」这一预期 | **退役** | [实读] 该字段明示为信息性；校验器只在类型错时抛 |
| A-R2 | 「`dsh-web-app` 客户端加载面随 churn 变化」 | **退役（就 `lib/` 而言）** | [哈希] `dsh-web-app/lib/` 4 文件全等；变化在组合补丁层 |
| A-R3 | 「turnTail 的 chain→list 是 0.1.7 起」 | **退役（更正时点）** | [实读] 0.1.1 已是 `chain`、0.1.7 已是 `list`（A.7 表） |

**本档增量计数：保留 2 条 / 裁剪 4 条 / 退役 3 条。**

## A.10 本档未验证项

| # | 项 | 原因 | 需要什么 |
|---|---|---|---|
| A-U1 | `dsh-btw` / `dsh-ssh-gui` 在 `PLUGIN-MATRIX` 中未被标 FAIL，与本档推断的 ESM 硬失败不符 | 两档的本地插件件版本/解析路径可能不同 | 协调者对这两件复跑导入矩阵并核对本地件版本 |
| A-U2 | 0.1.1 侧 `dsh-client-ui-primitives` 的**源码级**导出表 | 该包在现役为**断链软链**（`→ ~/.npm/_npx/1e7f6d9597241db0/…`，实测不可达） | 若能取得 0.1.1 该包字节，可把 A-C2 的 [实读/011] 升级为纯 [实读] |
| A-U3 | 6 插件在 0.2.0 上的**替换后**行为（settings 新形态、图标新名） | 需实改并实跑（阶段二） | 阶段二执行 + 隔离实例 UI/console 验收 |
| A-U4 | `dsh-web-app` 包根 41 行差异的逐行语义（本档只做行 id 集合差） | 聚焦客户端插件契约面 | T03/T06 |
| A-U5 | `settings.plugin.item` / `sidebar.workspaces.remoteHosts` 是否为真实官方座 | 官方两树 0 命中；`slots.inject` 实现体在 `dsh-client-ui-renderer`，本档未逐行读其"座不存在时的行为" | 读 `dsh-client-ui-renderer` 对应区段或隔离实例实测 |

## A.11 本档复现命令（只读）

```bash
A=/home/CNS2026495165/dsh/.workspace/iso-020/npm-global/node_modules/@deepseek-ai          # 0.2.0
B=$HOME/.npm-global-dsh017/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai      # 0.1.7
L=$HOME/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai             # 0.1.1

# A.1/A.2 lib 逐文件口径
for p in dsh-client-modules dsh-client-ui-cordis dsh-cordis-client-runner dsh-plugin-manager \
         dsh-host-frontend-static dsh-host-webserver dsh-web-app dsh-client-ui-primitives \
         dsh-client-ui-conversation dsh-client-ui-chat dsh-client-ui-plugin-manager \
         dsh-client-ui-theme dsh-client-ui-skill; do
  t=0; d=0; while read -r f; do t=$((t+1)); cmp -s "$A/$p/lib/$f" "$B/$p/lib/$f" || d=$((d+1)); done \
    < <(cd "$A/$p/lib" && find . -type f|sort); echo "$p tot=$t differ=$d"; done

# A.3 settings 导出集合（三版本）
for d in "$L" "$B" "$A"; do echo "[$d]"; grep -oE "export \{[^}]*\}" $d/dsh-settings/lib/index.js; done
node /home/CNS2026495165/dsh/.workspace/audit-020/t16/export-check.mjs   # 6 插件逐个请求×三树

# A.4/A.7 座位 kind 与集合
for v in L B A; do eval "d=\$$v"; echo "[$v]"; \
  grep -o '"conversation.chat.turnTail": {[^}]*}' $d/dsh-client-ui-chat/lib/client.js 2>/dev/null | head -2; done
node /home/CNS2026495165/dsh/.workspace/audit-020/t16/slot-icon-check.mjs

# A.5 组合行 id 集合差
rowof(){ grep -oE "^\s+- id: .*" "$1" | sed 's/.*id: //'; }
diff <(rowof $B/dsh-web-app/cordis.patch.yml) <(rowof $A/dsh-web-app/cordis.patch.yml)
diff <(rowof $B/dsh-base/cordis.patch.yml)    <(rowof $A/dsh-base/cordis.patch.yml)

# A.6 dsh.client 字段语义
grep -n "DshClientManifest" -A 14 $A/dsh-package-manifest/lib/types/types.d.ts
grep -n "client.modules\|optionalStringArray(pkgName, \"dsh.client" $A/dsh-client-modules/lib/index.js | head
```
