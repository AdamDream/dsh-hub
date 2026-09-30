# T30 · `@local/dsh-btw` 在 DSH `0.2.0-rc.1` 上的兼容性与迁移工作量审计

> **档位**：T30 审计轨道（只读审计，只出结论与方案，**不改产品代码**）。
> **写入面**：仅 `.workspace/audit-020/**`（本报告 + `t30/` 下的对账/探针/下载产物）。未写 `~/.dsh/**`、未写 `~/.dsh-017/**`、
> 未改工作区内既有 `dsh-btw` 源码（哈希对账证明其 `mtime`/内容在本轮零变化）、未起监听端口的服务、未发起模型请求。
> **未使用** `sandbox_permissions`。现役 `0.1.1-rc.2`(3080) 与隔离 `0.1.7-rc.2`(3097) 全程未触碰。
> **证据口径**：凡结论均附 `文件:行号`（0.2.0 侧一律指
> `.workspace/audit-020/t30/full020/node_modules/@deepseek-ai/` 下的 **实装制品**，由
> `npm install @deepseek-ai/dsh@0.2.0-rc.1` 装出，545 包 / 289 个 `@deepseek-ai/*` 行）；
> 0.1.1 侧指 `~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`；btw 侧指 `/home/CNS2026495165/dsh/dsh-btw/`。
> 未能读到源码的一律标 **【未判定】**，不做经验补全。
> **报告不含会话正文、密钥、原始会话 id**（会话 id 一律以 `＜session-id＞` 占位）。
> 实测时间：2026-09-29 17:0x–17:2x。

---

## 0. 结论摘要

| # | 问题 | 结论 |
|---|---|---|
| 1 | **T30 交付物路径** | `.workspace/audit-020/reports/T30-btw-compat-020.md`（本文件） |
| 2 | 源码/部署件哈希对账判定 | **部署件 ≠ 工作区源码**：89 个共有文件中 **48 same / 38 diff**（`src` 18、`lib` 6、`tests` 10、`scripts` 1、根 3）；工作区另有 **26 个部署件没有的文件**（含 10 个新 `src`、10 个新 `tests`、3 个新 `lib` chunk）。部署件时间戳 **2026-09-23 18:23:20**，工作区源码 **2026-09-25 10:2x–10:34** ⇒ **部署件落后约 40 小时，且带未回流改动**（工作区是超集）。**迁移基线必须取工作区源码，不是部署件。** |
| 3 | 契约点不兼容数 | **26 条不兼容**：**硬失败 19 条（H-1…H-19）** + **静默退化 7 条（S-1…S-7）**；另有 **2 条【未判定】**（U-1/U-2）。硬失败里 **4 条在 0.1.7 时还不是问题、是 0.2.0 新引入的**（`dsh-client-runtime` 整包消失、`ISessions` 导航面重写、`settings` 命名空间制与 `get` 全删、`assistant/chunk` 事件消失）。 |
| 4 | 与 0.2.0 新包的重叠判定 | **无需因重叠而重构或简化 btw**。四个被点名的包里：`dsh-tool-subagent-control` = 给**模型**的 `send_message`/`interrupt_agent`（agent↔agent 控制面，btw 是做**人机侧聊**）；`dsh-session-reference` = **用户显式 @-引用**的跨会话快照（btw 是**父会话已完成回合前缀 fork + 边界消息**，继承语义不同）；`dsh-session-query` = **替代 btw 手搓的 `session/title` 事件扫描与 `listSessions` 结构读**（是机会，不是冲突）；`dsh-agent-tool-presentation` = **工具呈现模式选择器（native/ptc/both）**，与 btw 的「侧聊面板 presentation」只是**同名巧合**。另发现 3 处**未被点名但更值得注意**的重叠面：`dsh-client-ui-sidebar-right`（右栏停靠面，btw 的 `shell.overlay` 抽屉可考虑迁入）、`dsh-client-ui-reference`（`@session` 选择器，与 btw 的 JumpList 有功能交叠）、`dsh-compaction-image-offload`（图片离载策略，与 btw 的图片管线有部分语义交叠）。 |
| 5 | 改造交付单元条数 | **21 条（T30-U01…T30-U21）**，其中 **17 条为「不起就废」必需**（U01–U17），**4 条为「能起但行为退化」配套**（U18–U21）。 |
| 6 | 工作量相对 0.1.7 迁移的判断 | **大体相当、略高**（约 **1.1–1.3×** 的 0.1.7 迁移量）。0.1.7 迁移是 **18 破坏点 / 13 必需单元**，本轮 **26 不兼容 / 21 单元 / 17 必需**。工作量构成变化明显：**0.1.7 的难点是「换承载面」（settings→volatile Config、client-runtime→client-store），0.2.0 的难点是「换数据面 + 换导航面」**——`Session.events` 消失把 btw 的**摘要/转录/seed 三条核心读取路径全部作废**，`ISessions` 导航面重写把 **JumpList 的跳转能力作废**，`session/prompt-image-transform` 缺失把**主会话图片转文本路径整条作废**。三条都不是「改个 import 就能过」。 |
| 7 | 一条最容易被漏判的硬闸 | **`TypertCodec.schema → create()` 在 0.2.0 是「注册期硬抛」**（0.1.7 时才只是形状变化）：`dsh-typert-loader/lib/index.js:211` `if (typeof codec.create !== "function") throw new Error(...)`、`:87` 同形检查；`dsh-typert-registry/lib/index.js:565` 同样硬抛。⇒ btw 手写并签入的 10 条描述符（`src/remote-descriptors.ts:37-48`）不改就**整个插件在 apply 期抛错**，不是「首次 RPC 才炸」。 |

---

## 1. 证据 A：源码 ↔ 部署件逐文件哈希对账

### 1.1 对账方法与原始产物

- 源码根：`/home/CNS2026495165/dsh/dsh-btw`
- 部署件根：`/home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-btw`
- 方法：两侧各自递归遍历（排除 `node_modules`、`.git`），逐文件 `sha256`，按**相对路径**取交集/差集比对。
- 原始产物：`.workspace/audit-020/t30/hashes.json`、`hash-src-all.txt`、`hash-dep-all.txt`、`cmp-common.txt`。

### 1.2 文件集规模

| 侧 | 文件数（不含 node_modules/.git） |
|---|---|
| 工作区源码 `dsh-btw/` | **112** |
| 部署件 `@local/dsh-btw/` | **89** |

### 1.3 结果（按目录归类）

| 类别 | 共有 | 其中 hash 不同 |
|---|---|---|
| `src/**` | 21 | **18** |
| `lib/**` | 7 | **6** |
| `tests/**` | 15 | **10** |
| `scripts/**` | 2 | 1 |
| `docs/**` | 23 | 0 |
| `.github/**` | 1 | 0 |
| 根级（`package.json`/`LICENSE`/`tsconfig*` 等 17 个共有） | 17 | **3**（`CHANGELOG.md`、`README.md`、`tsdown.config.ts`） |
| **合计** | **86** | **38** |

- **48 个 hash 相同**：含 `package.json`、`LICENSE`、`cordis.patch.yml`、全部 `docs/**`（含资产）、`CONTRIBUTING.md`、`SECURITY.md`、`THIRD_PARTY_NOTICES.md`、`README.zh.md`、`.github/workflows/ci.yml`、`.gitignore`、`requirements-brand-assets.txt`、`tsconfig*.json`、`vitest.config.json`、`lib/typert.host.d.ts`、`src/client/SideChatButton.tsx`、`src/client/SideChatSign.tsx`、`src/client/styles.d.ts`、`scripts/render-brand-assets.py`、5 个 `tests/*.spec.ts`。
- **38 个 hash 不同**（关键词）：`src/index.ts`、`src/host/side-chat-service.ts`、`src/host/btw-registry.ts`、`src/shared/remote.ts`、`src/shared/tool-policy.ts`、`src/remote-descriptors.ts`、`src/typert.host.ts`、`src/client/{index,controller,presentation,locales,remote,overlay-placement,use-overlay-placement,view-store}.ts(x)`、`src/client/{SideChatDrawer,SideChatSurface}.tsx`、`src/client/side-chat.module.css`、`lib/*`（6 个）、`tsdown.config.ts`、`scripts/smoke-build.mjs`、`README.md`、`CHANGELOG.md` 及 10 个 `tests/*`。
- **26 个文件只有工作区源码有**（部署件完全没有）：
  - `src/host/prompt-transform.ts`、`src/host/vision.ts`、`src/client/btw-settings.ts`、`src/client/drawer-size.ts`、`src/client/drawer-size-store.ts`、`src/client/SideChatJumpList.tsx`、`src/client/SideChatResizeHandle.tsx`、`src/client/SideChatToolRow.tsx`、`src/shared/dsh-attachment.d.ts`、`src/shared/vision-adam.d.ts`
  - 10 个新 spec：`tests/{banner-theme,capability-detect,host-activity,host-image,host-list,host-recovery,overlay-placement-explicit,prompt-transform,vision-template}.spec.ts`、`tests/jump-list.spec.tsx`
  - `scripts/verify-btw-model-hotread.mjs`、`package-lock.json`、`.workbuddy-btw-exec-report.md`
  - `lib/remote-bQu4rpiV.js`、`lib/remote-descriptors-BNvafF-2.js`、`lib/remote-DkypAFlI.d.ts`
- **3 个文件只有部署件有**（工作区已重建为新 hash）：`lib/remote-C2Gojj6I.js`、`lib/remote-descriptors-Cu5331mU.js`、`lib/remote-D8pzPah2.d.ts`。

### 1.4 内容级定性（证明「部署件落后 + 有未回流改动」）

| 证据 | 位置 | 事实 |
|---|---|---|
| 时间戳 | `stat` 两侧 `lib/*` | 部署件 `lib/` 全部 **2026-09-23 18:23:20**；工作区 `lib/` 全部 **2026-09-25 10:34:27** |
| 时间戳 | `find src -printf %T` | 部署件 `src/**` 全部 **2026-09-08 16:34**（陈旧快照）；工作区 `src/**` 最新 **2026-09-25 10:25** |
| 功能级差异 1 | 部署件 `lib/index.js:340,363,371` vs 工作区 `src/host/side-chat-service.ts:86-140` | 部署件 **没有** provider 可配置化：`lib/index.js:826,932,996,1436` 一律硬用 `BTW_PROVIDER`（单常量）；工作区已实现 `btwDefaultProvider`/`btwRoutableRoutes`/`btwDefaultRoute`/`sanitizeBtwRoute`（每调用热读 `dsh-btw.model.provider`） |
| 功能级差异 2 | 工作区 `CHANGELOG.md:3-9`「## Unreleased」4 条 | 部署件 `CHANGELOG.md` 无 Unreleased 段（部署件的 `## 0.4.0` 之后直接是 `## 0.3.0`）⇒ 部署件 = Unreleased 之前的构建 |
| 功能级差异 3 | 工作区独有 10 个 `src` 文件 | 侧聊跳转列表（JumpList）、抽屉缩放手柄（ResizeHandle）、工具行（ToolRow）、抽屉尺寸持久化（drawer-size-store/drawer-size）、行为开关绑定（btw-settings）、主会话图片转文本（prompt-transform + vision）、能力检测（`modelAcceptsImage`）**部署件一概没有** |
| git 侧证 | `git status --porcelain -- dsh-btw` | `src/index.ts`、`src/host/side-chat-service.ts`、`src/host/vision.ts`、`src/shared/remote.ts`、`src/client/btw-settings.ts`、`src/client/SideChatSurface.tsx` + 全部 `lib/*` 均标 `M`（工作区已改、未提交）；`lib/remote-{bQu4rpiV,descriptors-BNvafF-2,DkypAFlI}` 标 `??`（新建）；`lib/remote-{C2Gojj6I,descriptors-Cu5331mU,D8pzPah2}` 标 `D`（已删） |

**判定**：
1. **部署件 ≠ 源码** —— 38 个共有文件内容不同。
2. **有未回流改动** —— 方向是「工作区超前」：工作区 112 文件 ⊃ 部署件 89 文件，且 Unreleased 段、6 个 provider 函数、10 个新 `src` 文件都只在工作区。部署件是 2026-09-23 的旧构建，**不是**工作区当前状态的构建产物。
3. **迁移基线 = 工作区 `dsh-btw/`**（不是部署件；部署件只需在迁移后整目录覆盖重装）。
4. 顺带结论：**0.1.7 迁移的落地结果并未回流成部署件**——0.1.7 隔离实例（3097）用的是另一份部署根，与此处对账的 0.1.1 部署根无冲突；但两侧都没有反映工作区 09-25 的改动。**【未判定】** 0.1.7 隔离实例 `~/.dsh-017/profiles/node_modules/@local/dsh-btw` 的具体 hash 未在本轮对账（不在 T30 写入/读取授权面的必要性内；若需，可与本报告 §1.1 同法对账）。

---

## 2. 证据 B：btw 的完整契约面清单

### 2.1 宿主入口（`src/index.ts`）

| 契约点 | btw 落点 | 事实 |
|---|---|---|
| 插件身份 | `src/index.ts:10` `export const name = 'dsh-btw'`；profile 行 id 为 `btw`（`~/.dsh/profiles/web/cordis.patch.yml` 的 `- id: btw / name: '@local/dsh-btw'`） | Loader 身份 = `@local/dsh-btw`；settings 段名历史上是 `dsh-btw` |
| `ctx.*` 服务依赖 | `src/host/side-chat-service.ts:689` `static inject = ['agents','sessions','attachments','settings','subagents','sessionQuery']`；另 `ctx.get('llm')`（`src/host/vision.ts:91`）、`ctx.get('agentDefaultModel')`（`:77`）、`ctx.inject(['settings'])`（`src/index.ts:71`） | 6 个 inject + 3 个结构读 |
| 注册的 settings 段 | `src/index.ts:6,13,22-68,71-73` | `settingsNamespace('dsh-btw')` 品牌 + `settings.register(NS, SCHEMA)`；schema 含 `ui.{banner,modelSelect,imageBadge}`、`vision.autoTransform`、`model.{provider,default,options}` |
| 注册的工具 | `src/host/side-chat-service.ts:1014-1122` `btw_ask_user`（`defineTool`，注册在**子 agent 作用域** `childCtx.tools.register`） | 唯一自有工具 |
| 注册的 Remote 服务 | `src/host/side-chat-service.ts:688-698` `class SideChatService extends TypertRemoteService`，`super(ctx,'sideChat')`；10 个方法 `start/read/send/answer/cancel/close/setModel/readImage/listTree/listProject`；描述符表 `src/remote-descriptors.ts:37-48`；`src/typert.host.ts` TYPERT 清单 | 手写描述符，`scripts/smoke-build.mjs` 断言 `invocations.length === 10` |
| 会话引用机制 | `src/host/btw-registry.ts:48-55,89-181` 自建 sidecar 索引 `~/.dsh/btw/index.json`（`parentSessionId → childSessionId` + `parentTitle/parentCwd/lastPreview`，原子 rename 写）；`src/host/side-chat-service.ts:219-227` `hiddenSideChatMeta` **刻意剥掉 `parentSession`** 让子会话对会话目录/子代理目录都不可见；`:828-887` `recoverParent` 冷恢复父会话 | **btw 不用任何官方「会话引用」设施**，全靠 sidecar + 手搓恢复 |
| 子 agent 组合 | `src/host/side-chat-service.ts:779-796,915-931` `resolveChildDepth` / `resolveChildAgentOptions` / `childSessionMeta`；`:962-975` `appendDelegatedPolicyOverrides` + `applyChildComposition` + `childCtx.tools.guard` | 4 个官方组合原语 |
| 事件 waterfall | `src/host/prompt-transform.ts:66-74,121-123` 声明并注册 `session/prompt-image-transform` waterfall | 该 waterfall 由**打过补丁的** `dsh-host-apiproxy` 触发 |
| 模型选择耦合 | `src/host/side-chat-service.ts:9,988-1012` `installModelSelection` + `ModelSelectionRef` | 官方 agent 面 API |
| 环境读取 | `src/host/vision.ts:160`、`src/host/btw-registry.ts:49` `process.env.DSH_HOME ?? ~/.dsh`；`src/host/side-chat-service.ts:1160` 读 `$DSH_HOME/skills/grill-me/SKILL.md` | 无官方 API，纯文件系统 |

### 2.2 客户端入口（`src/client/**`）

| 契约面 | btw 落点 | 事实 |
|---|---|---|
| 插件注入 | `src/client/index.ts:17-18` `name='dsh-btw/client'`、`inject=['slots','sessions','remote','locale','settingsScope']`；`apply` 返回 disposer（`:20-24`） | 5 个客户端服务 |
| 槽位 | `src/client/index.ts:52-61` `conversation.session.header.actions`（`id:'dsh-btw.action'`, `order:40`）；`:63-91` `shell.overlay`（`id:'dsh-btw.drawer'`, `order:100`, `store: drawerSize`） | 2 个槽位 |
| store | `src/client/drawer-size-store.ts:17,25-27` `defineStore({init, persist:'dsh.btw.drawerSize', actions})` | 唯一 store；根作用域 localStorage 键 `dsh.btw.drawerSize` |
| 第三方服务 | `src/client/index.ts:45-50` `ctx.inject(['betterSidebar'])` → `presentation.attachBetterSidebar`；`src/client/presentation.tsx:7-9` `dsh-better-sidebar/client/service` 类型 | 依赖本机自建 `dsh-better-sidebar@0.14.0`（devDep `package.json:128`） |
| 图标/品牌 | `src/client/SideChatSign.tsx`（37 行，hash 与部署件相同）、`src/client/SideChatButton.tsx`（40 行，同）、`side-chat.module.css` | 自绘 SVG 标记 + CSS Module（构建期内联为 `<style data-plugin-css>`，见 `tsdown.config.ts:60-63`） |
| `data-*` 约定 | `data-dsh-btw-root` / `data-dsh-btw-drawer` / `data-dsh-btw-safe-area` / `data-dsh-btw-scrim`（`SideChatDrawer.tsx:124-139`）、`data-dsh-btw-handle` / `data-height-edge`（`SideChatResizeHandle.tsx:298,317`）、`data-placement-mode` / `data-placement-degraded`（`SideChatDrawer.tsx:125-126`）、`data-side-chat-surface-mode`（`SideChatSurface.tsx:466`）、`data-tool`/`data-variant`/`data-state`/`data-error`（`SideChatToolRow.tsx:38,48,78`）、`__dshA11yBtwChord`（`index.ts:95`）、`__DSH_SIDE_CHAT_AVOID_SELECTORS__`（`use-overlay-placement.ts:110`） | 自有标记，另**读**宿主标记：`[data-shell-overlay]`、`[data-slot="shell.overlay"]`、`:scope > [data-pane="sidebar"/"details"]`、`.sidebarCol` / `.detailsCol`、`[data-sidebar-collapsed]` / `[data-details-collapsed]` / `[data-dragging]`（`use-overlay-placement.ts:90-101,155-176,423`） |
| 键盘快捷键 | `src/client/index.ts:93-117` `Cmd/Ctrl+Shift+.` | — |
| 本地化 | `src/client/locales.ts`（104 行）+ `ctx.locale.register(NS,{zh,en})`（`index.ts:42`） | — |

### 2.3 与 0.1.7 官方 API 的耦合点（`package.json` peer 面）

`package.json:89-108` peer：`@deepseek-ai/cordis ^4.0.1`、`dsh-agent`、`dsh-api-remotes`、`dsh-client-locale`、`dsh-client-runtime`、`dsh-client-ui-conversation`、`dsh-client-ui-layout`、`dsh-client-ui-primitives`、`dsh-client-ui-slots`、`dsh-attachment`、`dsh-llm`、`dsh-session`、`dsh-subagent`、`dsh-tools`、`dsh-typert-protocol`、`dsh-vision-adam`（**树外**）、`dsh-workspace`、`react ^18.2.0`，全部 `<0.2.0`。
`package.json:68-84` `dsh.bundle.patch = ./cordis.patch.yml`、`dsh.client.inject = [dsh-client-runtime, dsh-api-remotes, dsh-client-ui-conversation, dsh-client-ui-layout, dsh-client-ui-primitives, dsh-client-locale, dsh-client-ui-settings]`、`platform: web`。
`package.json:21` JSX 版本仍钉 `0.1.1-rc.2`（`devDependencies:111-124`），配 `@deepseek-ai/schemastery ^3.18.1`（`:86`）、`typescript ^6.0.3`（`:136`）。
`tsdown.config.ts:14-24` 客户端 external 列表含 `@deepseek-ai/dsh-client-runtime/client`。

---

## 3. 契约点核验矩阵（逐条核验 0.2.0）

图例：**存在** / **签名变化** / **消失** / **未判定**。
`层` 标记失败阶段：`build` = 构建期（tsc/bundler）｜`link` = ESM 链接期｜`apply` = 插件 apply/mount 期｜`call` = 调用期｜`quiet` = 不抛错但语义退化。

### 3.1 硬失败（19 条）

| # | 契约点 | btw 落点 | 0.2.0 状态 | 0.2.0 依据（file:line） | 0.1.1 依据 | 层 |
|---|---|---|---|---|---|---|
| H-1 | `settingsNamespace()` 具名导出 | `src/index.ts:6`、`:13` | **消失** | `.../dsh-settings/lib/index.js:544` 导出表仅 `{SettingsConflictError, SettingsForms, SettingsForms as default, redactSecrets}`；`dsh-settings/lib/types/index.d.ts:4-6` 只 `export type { SettingsNamespace }` | `dsh-settings/lib/types/index.d.ts:20` `export declare function settingsNamespace(value: string): SettingsNamespace` | link |
| H-2 | `ctx.settings.register(ns, schema)` | `src/index.ts:71-73` | **消失** | `dsh-settings/lib/types/index.d.ts:62-117` `SettingsForms` 只有 `configure/describe/update/replace/mutate/writable/documentPath/prepareDocument`；无 `register` | `dsh-settings/lib/types/index.d.ts:341` `installSettingsSection(...)`；`register` 在 0.1.1 服务面存在 | apply |
| H-3 | `ctx.settings.get(namespace)` 服务方法 | `src/host/vision.ts:147-149`、`:181-186` | **消失** | 同 H-2（无 `get`）；服务文档改为「profile entry id」寻址：`dsh-settings/lib/types/types.d.ts:5` `type SettingsNamespace = Branded<'SettingsNamespace'>`（「Nominal id of one profile plugin entry」）、`:22`「Namespace key (`llm-deepseek`, `llm-pi-ai`, …)」 | `ctx.settings.get(ns)` 在 0.1.1 为公开读面 | quiet（因写成 `?.get?.()`，不抛错 → **静默失效**）→ 但在 S-1 中体现 |
| H-4 | `Session.events` 访问器 | `src/host/side-chat-service.ts:297,375,514,1371`；`:209-213` `completedTurnSeed`；`:374-445` `progressDigestLines` | **消失** | `dsh-session/lib/types/index.d.ts:119-143` 类体只有 `header/inheritedEventCount/firstLiveSeq/firstLifecycleSeq`；**无 `events`** —— 探针实测 `probe-11-session-surface-events.ts(4,18): error TS2339: Property 'events' does not exist on type 'Session'` | `dsh-session/lib/types/index.d.ts:174` `get events(): readonly SessionEvent[]` | build / link |
| H-5 | `Session.header.seedLength` | `src/host/side-chat-service.ts:939`（`handle.agent.session.header.seedLength ?? 0`），消费点 `:514`、`:675`、`:1371`、`:1482` | **消失** | `dsh-session/lib/types/types.d.ts:58-95` `SessionHeader` 只有 `isSeeded: boolean`(`:76`)，**无 `seedLength`**；等价量搬到 `Session.inheritedEventCount`（`dsh-session/lib/types/index.d.ts:121`）。探针：`probe-04-seedlength.ts(3,59): error TS2339: Property 'seedLength' does not exist on type 'SessionHeader'` | `dsh-session/lib/types/types.d.ts:59` `readonly seedLength?: number` | build / quiet |
| H-6 | `TypertCodec` strict 分支形状 | `src/remote-descriptors.ts:30,32`（10 方法 × 入参/结果） | **签名变化（注册期硬抛）** | `dsh-typert-protocol/lib/types/types.d.ts:199-203` = `{mode:'strict'; typeSymbol; create: () => TypertSchema; decode?; encode?}`（**`schema` 改名 `create`，`src-json` 分支删除**）；`dsh-typert-loader/lib/index.js:211` `if (typeof codec.create !== "function") throw ...`、`:87` 同形；`dsh-typert-registry/lib/index.js:565` 同形；消费点 `dsh-api-gateway/lib/index.js:1504` `codec.create().parse(value)` | `dsh-typert-protocol/lib/types/types.d.ts:111-117` `{mode:'strict'; typeSymbol; schema: TypertSchema} | {mode:'src-json'}` | apply（注册期） |
| H-7 | `@deepseek-ai/dsh-client-runtime` 整包 | `src/client/{index.ts:1-2, controller.ts:1, presentation.tsx:2, btw-settings.ts:2,4, SideChatDrawer.tsx:2, SideChatJumpList.tsx:2, SideChatSurface.tsx:5, drawer-size-store.ts:17}`（10 处导入）+ `package.json:74`（`dsh.client.inject`）+ `tsdown.config.ts:19`（external） | **消失（整包不存在）** | `ls .workspace/audit-020/t30/full020/node_modules/@deepseek-ai/` 无 `dsh-client-runtime`；`dsh-base/lib/cordis.patch.yml` 无该行；探针：`probe-06-client-runtime.ts(2,47)/(3,59)/(4,29): error TS2307: Cannot find module '@deepseek-ai/dsh-client-runtime/client'` | 0.1.1 有该包，且 `dsh-client-modules/lib/index.js:198` `PARSER_PRELOAD_IDS = [CLIENT_MODULES_ID, "@deepseek-ai/dsh-client-runtime"]` 把它当 parser 预载行 | build（tsc）+ link（浏览器 `require` 未命中模块表） |
| H-8 | `defineStore` 的**来源包** | `src/client/drawer-size-store.ts:17` | **签名变化（改包即可）** | `dsh-client-store/lib/types/index.d.ts:89-91` `defineStore<T,A>(decl: StoreSpec<T,A> & {actions})`；`StoreSpec`（`.../contract.d.ts:45-49`）= `{init: () => T; persist?: string; actions: A}` —— **与 btw 现用形状逐字一致**。可 `require` 的 client 行：`dsh-client-locale/client`、`dsh-api-session-controller/client` 等（`dsh-client-store` 本身**不在** web-app 的 client 依赖表内，是 host 侧 dep） | 0.1.1 `dsh-client-runtime/client` 再导出 `defineStore` | build + link |
| H-9 | `ClientContext` 类型 | `src/client/index.ts:1`、`presentation.tsx:2`、`controller.ts:1` | **签名变化** | 0.2.0 客户端插件一律 `import type { Context as ClientContext } from '@deepseek-ai/cordis'`（例：`dsh-client-ui-jobs/lib/types/client/index.d.ts:7`）；旧的别名包已不存在 | `dsh-client-runtime/lib/types/client/index.d.ts:55` `export type ClientContext = Context` | build |
| H-10 | `SessionId` 客户端类型来源 | `src/client/index.ts:1`、`SideChatDrawer.tsx:2`、`SideChatJumpList.tsx:2`、`SideChatSurface.tsx:5`、`controller.ts:1`、`presentation.tsx:2` | **签名变化** | 0.2.0 用 `@deepseek-ai/dsh-session/types`（例 `dsh-api-session-controller/lib/types/client/contract/sessions.d.ts:4`、`.../session.d.ts:8`）或 `dsh-client-connection/client` | `dsh-client-runtime/lib/types/client/index.d.ts:53` `export type { SessionId } from '@deepseek-ai/dsh-client-connection/client'` | build |
| H-11 | `SettingsScope` / `SettingsScopeSnapshot` | `src/client/btw-settings.ts:2,4`；`src/client/index.ts:2`；`presentation.tsx`（`settingsScope` prop） | **消失** | 全 0.2.0 树（`.d.ts` + `.js`）grep `SettingsScope` **零命中**；替代面是 `dsh-client-ui-settings` 的 `SettingsDescribeMirror`（`dsh-client-ui-settings/lib/types/client/settings-mirror.d.ts:40-60` `SettingsDescribeFace{getSnapshot,subscribe,ensure,acceptView}`）+ 宿主侧 `SettingsForms.describe()/update()/mutate()`（`dsh-settings/lib/types/index.d.ts:96,102,108,114`） | `dsh-client-runtime/client` 导出 `SettingsScope`/`SettingsScopeSnapshot` | build（类型）+ apply（`inject:['settingsScope']` 等待的服务不存在 ⇒ fiber 永不 ACTIVE） |
| H-12 | `ISessions.open()` | `src/client/controller.ts:432` | **消失** | `dsh-api-session-controller/lib/types/client/contract/sessions.d.ts:47-156` `ISessions` 成员表**无 `open`**；探针 `probe-07-session-list.ts(8,5): error TS2339: Property 'open' does not exist on type 'ISessions'` | 0.1.1 `ISessions.open(id)` 存在 | build |
| H-13 | `ISessions.openSubagent()` | `src/client/controller.ts:429` | **消失** | 同上；探针 `probe-07-session-list.ts(7,5): error TS2339: Property 'openSubagent' does not exist on type 'ISessions'`；替代 = `retain(target, options)`（`:53`）、`using(...)`（`:63`）、`subagentAddress(id)`（`:90`）、`scope(id)`（`:135`）、`sessionOf(ctx)`（`:151`） | 0.1.1 存在 | build |
| H-14 | `SessionListState.subagentsByParent` | `src/client/controller.ts:455`（`subagentsByParentOf` 结构读） | **消失（静默）** | `dsh-api-session-controller/.../service.d.ts:56-69` `SessionListState` = `{ids, byId, phase, projectionsBySession}`；全树 grep `subagentsByParent` **零命中** | 0.1.1 客户端 catalog 快照带该键 | quiet（读成 `undefined` ⇒ 子代理地址永远找不到 ⇒ JumpList 对子代理不可跳） |
| H-15 | `assistant/chunk` 事件类型 | `src/host/side-chat-service.ts:355,416-429,549-558`（部分文本/推理流） | **消失，改名 `assistant/attempt`** | `diff` 事件键集：0.1.1 `{assistant/chunk, assistant/message, request/context, request/header, session/end-seed, step/end, step/start, todo/write, tool/call, tool/result, turn/end, turn/start, user/message}` → 0.2.0 `{assistant/attempt, assistant/message, developer/message, request/context, request/header, session/end-seed, step/end, step/start, system/message, tool/call, tool/result, turn/end, turn/start, user/message}`（`assistant/chunk`、`todo/write` 删；`assistant/attempt`、`developer/message`、`system/message` 增）；`assistant/attempt` 负载 = `{turn, step, stream: AssistantStreamRecord[]}`（`dsh-session/lib/types/types.d.ts:333-336`），而 `AssistantStreamRecord` 是**打包 delta 运行**（`dsh-llm/lib/types/assistant-stream.d.ts:16-40`：`{type:'text-chunks', dt:number[], texts:string[]}` / `'reasoning-chunks'` / `'tool-call-chunks'` / `'chunk'`），**不是** `{type:'text-delta', text}`。探针 `probe-14-event-types.ts(7,9): error TS2367: This comparison appears to be unintentional ... and '"assistant/chunk"' have no overlap` | 0.1.1 `assistant/chunk` = `{turn, step, chunk: StreamChunk}` | build / quiet |
| H-16 | `session/prompt-image-transform` waterfall | `src/host/prompt-transform.ts:66-74`（`declare module` 扩 `Events`）、`:121-123`（`ctx.on(...)`） | **消失** | 全 0.2.0 树 grep `prompt-image-transform` **零命中**（`.js` 也零命中）；承载包 `@deepseek-ai/dsh-host-apiproxy` **整包不存在**（`ls -d .../dsh-host-apiproxy` → ABSENT）；0.2.0 的图片闸门已内建：`dsh-api-session-controller/lib/index.js:873` `if (model.inputModalities !== void 0 && !model.inputModalities.includes("image")) throw new RemoteError("session/attachment-invalid", ..., {reason:"MODEL_DOES_NOT_SUPPORT_IMAGES"})` | `dsh-host-apiproxy/lib/index.js:2872` `await ctx.waterfall("session/prompt-image-transform", {agent, content}, () => void 0)` | call（主会话图片路径整条死） |
| H-17 | `childSessionMeta(parent, depth, isSeeded)` 第三参类型 | `src/host/side-chat-service.ts:224`（传 `forkSeq: number`） | **存在（签名同上，类型已是 boolean）** | `dsh-subagent/lib/types/child-agent.d.ts:70` `childSessionMeta(parent: Agent, childDepth: number, isSeeded: boolean)`；实现 `dsh-subagent/lib/index.js`（同形） | 0.1.1 是 `(parent, childDepth, lineageSeedLength: number)` | build（tsc 类型不匹配）；运行期把 number 落进 `isSeeded` ⇒ 0.2.0 header 校验硬抛（同 H-18 机制） |
| H-18 | `agents.create({ ..., inheritedEventCount })` | `src/host/side-chat-service.ts:786-796`（**未传**） | **签名变化（新增必填耦合）** | `dsh-agent/lib/types/index.d.ts:67-78` `CreateAgentOptions` 注释「Exact fork-inherited prefix length when the session metadata sets `isSeeded`」（`inheritedEventCount?: SessionLogOffset`）；`dsh-session/lib/types/index.d.ts:152-155` `static create(id, seed?, header?, inheritedEventCount?, projections?)` + `:155` 注释「@throws when a seed event requires a missing message interpreter or fails validation」 | 0.1.1 用 `meta.seedLength`（`dsh-session-0.1.1/lib/types/types.d.ts:59`）承载 | call（抛错 ⇒ 新建侧聊失败） |
| H-19 | `agent.session.events` 的同类读面在 `progressDigest`/`transcript`/`hydrateImageRefs` 三处的**全部消费点** | `:209-213`、`:375-445`、`:513-686`、`:1370-1386`、`:939` | **消失（见 H-4/H-5）** | 0.2.0 替代面：`session.snapshotEvents(from,to)`（`dsh-session/lib/types/index.d.ts:193`）、`session.ownEvents()`（`:201`）、`session.eventAt(seq)`（`:182`）、`session.isOwnSeq(seq)`（`:206`）、订阅 `'session/event'`（`:64`，**带 `@deepseek-ai/dsh-scope` 作用域过滤**：「agent-scoped listeners receive only events from sessions entered through that agent's context」）—— 注意 `snapshotEvents`/`ownEvents` 均标 **`@deprecated`**「new calls are prohibited」（`:185-186`、`:193-196`） | — | build + 运行期语义 |

### 3.2 静默退化（7 条）

| # | 契约点 | btw 落点 | 0.2.0 状态 | 0.2.0 依据 | 现象 |
|---|---|---|---|---|---|
| S-1 | `dsh-btw` settings 段的承载面 | `src/host/vision.ts:175-192` `readBtwSettings`（`?.get?.(...)`）→ 供 `btwDefaultProvider`/`btwRoutableModels`/`btwDefaultRoute`（`side-chat-service.ts:108-140`）与 `vision.autoTransform`（`:1233`） | **承载面变化** | 0.2.0 起 `settings.yaml` **被弃用**：`dsh-settings/lib/index.js:302`「Entry ids of the removed `settings.yaml` sections whose owning entry carries another id」、`:324` `static inject = ["configEditor","profileContext"]`、`:339` `ctx.root.loader.await().then(() => this.importLegacyDocument())`、`:346-348` `importLegacyDocument()` 读 `join(profile.home, "settings.yaml")` 并**迁入 active profile**；新家 = profile patch 中该 entry 的 `config:` 行 | `readBtwSettings` 恒返回 `{}` ⇒ provider 可配置化、`vision.autoTransform` 开关、`ui.banner/modelSelect/imageBadge` **全部静默失效**（回到代码常量） |
| S-2 | 插件配置入口 | `src/index.ts:22-68`（`settings.register` 的 schema） | **签名变化** | 0.2.0 范式 = 插件自带 `Config: z<...>` + `apply(ctx, config)`（例 `dsh-agent-tool-presentation/lib/types/index.d.ts:32-49`、`dsh-tool-present/lib/types/index.d.ts:7-20`、`dsh-session-title-first-prompt-llm/lib/types/index.d.ts:8-16`）+ 自动页由 `SettingsDescriptor.autoGenerate` 决策（`dsh-settings/lib/types/index.d.ts:11`）；自定义页用 `settings.configure({auto:false}, owner)`（`dsh-clien-ui-theme/lib/index.js:90` 等 20+ 处） | 不做则设置页**没有 btw 的条目** |
| S-3 | `ISessions.list` 快照形状 | `src/client/controller.ts:116`（`this.sessions.list.subscribe(...)`）、`:127`、`:424` | **存在** | `dsh-api-session-controller/.../contract/sessions.d.ts:47` `readonly list: ObservableSnapshot<SessionListState>`；`ObservableSnapshot` = `{getSnapshot(), subscribe(fn)}`（`dsh-client-store/lib/types/contract.d.ts:3-12`）—— `subscribe`/`getSnapshot` 都在 | 无退化（唯一**好消息**：`list` 面兼容） |
| S-4 | 列/pane DOM 标记 | `src/client/use-overlay-placement.ts:90`（`[data-pane="sidebar"/"details"]`）、`:93`（`.sidebarCol` / `.detailsCol`） | **签名变化** | 0.2.0 `dsh-client-ui-layout/lib/client.js:326-360` frame 子列类名 = `sidebarCol` / 中心列 / **`rightbarCol`**（`detailsCol` 不存在）；全树 grep `data-pane` **零命中**；`lib/client.js:322` 只有 `data-sidebar-collapsed`，**`data-details-collapsed` 零命中**（改用 `data-rightbar-collapsed` / `data-rightbar-fullscreen` / `data-rightbar-instant`，`:323-325`） | 碰撞感知布局的 `nativePanes` 恒为 `[]`、`details` 列找不到 ⇒ 避让/贴靠几何失效（不抛错、UI 只是变丑） |
| S-5 | `[data-shell-overlay]` / `[data-slot="shell.overlay"]` | `use-overlay-placement.ts:100,165` | **存在** | `dsh-client-ui-layout/lib/client.js:345` `"data-shell-overlay": true`；`dsh-client-ui-renderer/lib/client.js:1100` `"data-slot": slotKey` | 兼容（`shell.overlay` 徽标仍在） |
| S-6 | 两个槽位名 | `src/client/index.ts:55,66` | **存在** | `dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts:155-159` `'conversation.session.header.actions': {kind:'list', scope:'session', owner:ConversationHeaderActionOwnerProps}`；`dsh-client-ui-layout/lib/types/client/index.d.ts:85-88` `'shell.overlay': {kind:'list', scope:'root'}`（注释：「the additive seat for a frame-wide surface of your own」）；`dsh-client-ui-slots/lib/types/index.d.ts:789,802` `register(...)` 两个重载仍以 `SlotMap` 为键、`BaseOptions` 仍带 `id`/`order`/`locale`/`store`/`inject` | 兼容（探针 `probe-17-slots.tsx` 零错误） |
| S-7 | `defineStore` 语义（`persist`/`init`/`actions`） | `drawer-size-store.ts:25-50` | **存在** | `dsh-client-store/lib/types/contract.d.ts:45-49` `StoreSpec{init,persist?,actions}`；`StoreDecl = StoreHandle | StoreFactory`（`:97`）—— `shell.overlay` 的 `store` 座仍接受工厂（btw 传的正是工厂） | 兼容（只需改包名，见 H-8） |

### 3.3 已核验为「兼容、无需改」的契约点（避免执行档多做无用功）

| 契约点 | btw 落点 | 0.2.0 依据 |
|---|---|---|
| `defineTool` 定义形状（`parameters`/`output.schema`/`output.render`/`execute`） | `side-chat-service.ts:1015-1121` | `dsh-tools/lib/types/schema.d.ts` 与 0.1.1 逐行 diff = **纯增量**（新增 `deferLoading?`、`projectContent?`；`JsonValue` 来源包从 `dsh-session` 改为 `dsh-util-values`） |
| `ctx.tools.guard(execution => string|undefined)` | `side-chat-service.ts:973` | `dsh-tools/lib/types/index.d.ts:522` `ToolGuard = (execution) => string | undefined`、`:655` `guard(guard: ToolGuard): () => void` |
| `ToolRestriction{allow}` | `side-chat-service.ts:970` | `dsh-tools/lib/types/index.d.ts:508-513` `{allow?: readonly string[]; deny?: readonly string[]}` |
| `applyChildComposition` / `resolveChildDepth` / `resolveChildAgentOptions` / `appendDelegatedPolicyOverrides` | `:779,915,964,968` | `dsh-subagent/lib/types/child-agent.d.ts:31,52,106,144`（4 个签名与 0.1.1 一致；`applyChildComposition` 的 `ChildComposition{persona?,toolFilter?}` 在 `:71-77`） |
| `installModelSelection` / `ModelSelectionRef{current,assembled}` | `:9,991-1011` | `dsh-agent/lib/types/model-selection.d.ts`（0.2.0 导出仍在） |
| `createUserMessage` / `ContentBlock` | `:11,945,1125,1256` | `dsh-llm/lib/types/message.d.ts` |
| `admitEncodedImages` / `ImageAttachmentRef` / `StoredImageAttachment` / `ctx.attachments.readImage` | `:1210-1214,1245,1417` | `dsh-attachment/lib/types/admission.d.ts`、`dsh-attachment/lib/types/index.d.ts:14` `attachments: AttachmentStore` |
| `AgentHandle{agent,dispose}` / `Agent.inject` / `Agent.followup` / `Agent.cancel` / `Agent.status` / `session.requestHeader()` | `:938,1139,1270,1305,431,996` | `dsh-agent/lib/types/index.d.ts:143-146` `{agent: Agent; dispose(): Promise<void>}`；探针 `probe-11` 除 `session.events` 外零错误 |
| `TypertRemoteService` 构造/绑定 | `:688,698` | `dsh-typert-protocol/lib/types/index.d.ts:66-76` `protected constructor(ctx, serviceKey, options?)` + `typertRemote` 绑定 |
| `TypertRemoteContribution{package,descriptors}` / `$mount` / `RemoteResult` | `src/client/remote.ts:1,39` | `dsh-typert-protocol/lib/types/types.d.ts:344-349`；`:356` `$mount(contribution): Promise<TypertDisposer>`；`dsh-api-gateway/lib/types/client/index.d.ts:18` `ClientRemote extends TypertClientRemote` |
| `sessionQuery.listSessions(signal)` | `:880-887,1457-1467` | `dsh-session-query/lib/types/index.d.ts:67` `listSessions(signal?): Promise<SessionRecord[]>`；`SessionRecord{header: SessionHeader; live; persisted}`（`.../types.d.ts:14-21`）；`header.origin`/`parentSession`/`cwd`/`id` 仍在（`dsh-session/lib/types/types.d.ts:65-81`） |
| `subagents.listDescendants(rootSessionId, signal)` | `:1434` | `dsh-subagent/lib/types/index.d.ts:234` `listDescendants(rootSessionId: SessionId, signal?): Promise<SubagentDescendantListEntry[]>` |
| `ctx.inject/effect/plugin/on/get` | 全场 | Cordis 4 面不变（探针 `probe-02/17` 除目标 API 外零错误） |
| `SessionFace.getSnapshot()` | `SideChatSurface.tsx:21,23` | `dsh-api-session-controller/.../session.d.ts:156` `type SessionFace = ISession & ObservableSnapshot<SessionSnapshot>` |
| `ctx.locale.register/bind/getSnapshot/subscribe` | `index.ts:42`、`presentation.tsx:57-61` | `dsh-client-locale` 仍在且 `dsh.client` 已声明 |
| `data-*` 自有标记、`dsh.btw.drawerSize` 持久化键、`betterSidebar` 注入 | §2.2 | 自有面，与 DSH 版本无关 |

### 3.4 未判定（2 条）

| # | 项 | 缺口 | 验证途径 |
|---|---|---|---|
| U-1 | `dsh-vision-adam` 在 0.2.0 下的可加载性 | 该包**不在** 0.2.0 官方树内（`ls .workspace/audit-020/t30/full020/node_modules/@deepseek-ai \| grep -i vision` → 空），是 profile 自建的**树外插件**（`~/.dsh/profiles/web/cordis.patch.yml` 的 `- id: vision-adam / name: '@deepseek-ai/dsh-vision-adam'`）。btw 用 `await import('@deepseek-ai/dsh-vision-adam')`（`src/host/vision.ts:135`）并断言 3 个导出 `analyzeImageBytes/resolveOptions/resolveApiKey`（`:136-140`）。本轮**未读**该树外实现，无法判定它对 0.2.0 的 `dsh-credentials`/`dsh-llm` 面是否仍然可用 | 在 0.2.0 隔离组合里实载该插件，或读其源码核对它 import 的官方符号在 0.2.0 是否仍在（0.1.7 报告 18 §2.2 已判定它在 **0.1.7** 就加载失败，因为用了 `installSettingsSection`/`settingsNamespace` —— 这两个符号在 **0.2.0 同样不存在**，见 H-1/H-2 ⇒ 高概率同样失败） |
| U-2 | `ctx.slots.inject(...)` 与 `register({..., locale, store, inject})` 在 0.2.0 的**运行期**（非类型期）验收 | 类型期探针 `probe-17-slots.tsx` 零错误，槽位名与选项位均在；但 0.2.0 `SlotMap` 引入了 `owner` 属性与 `ChildrenDecl`/`EntryKey` 泛型收紧（`dsh-client-ui-slots/lib/types/index.d.ts:789,802`），**运行期**是否对 btw 的 `inject: (_sessionId) => {...}` 形态有新增校验，本轮未跑真机 | 起 0.2.0 隔离组合后打开侧聊，看 `dsh-btw.action` / `dsh-btw.drawer` 两个 entry 是否 ACTIVE |

---

## 4. 与 0.2.0 新包的重叠判定

### 4.1 被点名的四个包

| 包 | 它到底是什么（源码级） | 与 btw 能力的关系 | 判定 |
|---|---|---|---|
| **`dsh-tool-subagent-control`** | **给模型的工具**：`send_message` + `interrupt_agent`，是 `ctx.subagents.sendMessage()` / `ctx.subagents.interrupt()` 的薄适配器；「they live apart from the provider-bound `@deepseek-ai/dsh-tool-subagent` instances so multiple delegation tools share one control API」（`.../dsh-tool-subagent-control/lib/types/index.d.ts:1-18`，`export declare const name = "tool-subagent-control"`） | btw 的「侧聊」是**人机**侧面板；btw 的子会话被**刻意**做成 `origin:'subagent'` **且无 `parentSession`**（`side-chat-service.ts:219-227`），而 `sendMessage` 要求「**direct** parent or **direct** continuable child」且有邻接校验（`dsh-subagent/lib/types/index.d.ts:143-157`）+ `UNAUTHORIZED`（`:186`）。btw 也把子会话限制为只读工具集（`shared/tool-policy.ts:20-37`）。 | **无重叠**。〔插播〕= btw 的 ask-back 通道是**自己的** `btw_ask_user`（`side-chat-service.ts:1014-1122`），不是 `send_message`；btw 之所以自造通道，是因为官方 `ask_user_question` 对委派子会话被双重封死（`shared/tool-policy.ts:14-18` 注释）。**不需要重构或简化。** |
| **`dsh-session-reference`** | 跨会话**快照准备**服务：`SessionReferenceResolver extends TypertRemoteService`，`ctx.sessionReferenceResolver`，公开 `listCandidates(agent, query?, limit?, signal?)` + `prepareDirectMessages`；机制 =「Replace canonical mentions in direct user messages and place each prepared snapshot immediately after the message that cited it」（`.../dsh-session-reference/lib/types/index.d.ts:23-38,50`）；URI 面 `SESSION_REFERENCE_SCHEME` / `encodeSessionReferenceUri` / `parseSessionReferenceText`（`:17`） | 两者都叫「父会话引用」，但**机制与语义都不同**：btw = **自动 fork 父会话已完成回合前缀**（`completedTurnSeed`，`side-chat-service.ts:209-213`）+ 注入边界消息与进度摘要（`:78`、`:364-445`、`:1124-1133`）；session-reference = **用户在消息里显式 @ 引用**才准备快照（opt-in、逐条、按字节预算 `DEFAULT_MAX_REFERENCE_BYTES`/`MAX_REFERENCES`）。**父会话不 live 也能开侧聊**（项目裁决）依赖 btw 自己的 sidecar + `recoverParent`（`:828-887`），session-reference 不提供这条 | **部分重叠（≈30%），不可替代**。**不需要重构**；可选收获：`listCandidates` 可替代 btw 手搓的父会话候选枚举（但 btw 的 JumpList 需要的是「**已有侧聊**的父会话」列表，来自自家 sidecar，语义不同）。 |
| **`dsh-session-query`** | `SessionQueryEngine extends Service`（`ctx.sessionQuery`）；公开 `observeSession`、`listSessions`、`readSession`、`filterSessions`、`readTitle`、`readTitleSnapshot(s)`、`listEvents`、`filterEvents`、`searchSessions`、`searchEvents`（`.../dsh-session-query/lib/types/index.d.ts:35-118`）；`SessionRecord = {header: SessionHeader; live; persisted}`（`.../types.d.ts:14-21`）；`SessionLogSnapshot = {session; inheritedEventCount; events}`（`:33-41`） | **btw 的能力里有三条正是这个包现在正式提供的**：① 列出语料（btw 用 `listSessions` + 结构读 `header.cwd/id` 做 realpath 归组，`:1452-1473`）；② 读父会话标题（btw 现在**手扫 `session/title` 事件**，`:296-313`）；③ 读历史（btw 现在读 `session.events`，而这在 0.2.0 已消失，见 H-4） | **不是冲突，是「该换过去」**。`readTitle(sessionId)` 与 `readSession(sessionId)`（返回带 `inheritedEventCount` 的快照）能同时消掉 **H-4/H-5/H-19 + S-1 的一部分**，并让 btw 摆脱已 `@deprecated` 的 `snapshotEvents`/`ownEvents`。**建议作为 T30-U07 的正解。** |
| **`dsh-agent-tool-presentation`** | **工具呈现模式选择器**：「the row an agent preset carries to say **which form of its tools the model sees**」——`native` / `ptc`（只发 `run_code` + 生成 SDK）/ `both`；`ctx.tools.presentAs()` 声明在**挂载作用域**（`.../dsh-agent-tool-presentation/lib/types/index.d.ts:1-49`，`Config{mode: ToolPresentationMode}`） | 与 btw 的「侧聊面板 presentation」（`src/client/presentation.tsx` = Better Sidebar 适配 + 最小化/结束控制）**只是同名巧合**，一个在 agent 面、一个在浏览器 UI 面 | **无重叠**。**不需要重构。** |

### 4.2 未被点名但值得注意的重叠面

| 包 | 它是什么 | 与 btw 的关系 | 建议 |
|---|---|---|---|
| `dsh-client-ui-sidebar-right` | 「Right Sidebar: the docking surface's session-bound state, its panel and header expand control, and the navigation service over it」（`.../package.json` description），0.2.0 新增；`ISessions` 也新增了 `data-rightbar-*` 帧属性 | btw 现在用 `shell.overlay`（无槽位、绝对定位、自己做碰撞避让）。0.2.0 把右侧栏做成了**一等停靠面**，且 `shell.overlay` 的注释仍说它是「the additive seat for a frame-wide surface of your own」 | **不是必须**，但**若**要根治 S-4（列类名/`data-details-collapsed` 全变），把抽屉迁进 `rightbar` 座是结构性正解；本轮**不建议**纳入迁移批（会显著扩大范围），列为后续可选优化 |
| `dsh-client-ui-reference` | 「Unified Web `@file` and `@session` **reference source**」 | 与 btw 的 `SideChatJumpList`（侧聊跳转列表，`:1-16` 注释：R0-3/R0-4/R0-5）有功能交叠：都在做「跳到另一个会话」 | 语义不同（引用插入 vs 导航跳转），**不替代**；若迁移中 `open/openSubagent` 的替代方案需要会话选择器，可参考它的实现 |
| `dsh-compaction-image-offload` | 图片离载：路由报 `IMAGE_OFFLOAD_REQUIRED` 时记录 `image/offload` 决策并降级为占位文本（`.../dsh-compaction-image-offload/lib/types/index.d.ts:1-17`） | 与 btw 的图片管线（`vision.ts` + `prompt-transform.ts`）方向相近（都是「模型吃不下就转文本」），但触发条件与作用面完全不同 | **不替代**；但它是 H-16 之后「主会话图片降级」可考虑的官方缝 |

### 4.3 重叠判定总结

- **需要重构的：0 个**（四个被点名的包没有一个是 btw 的替代品）。
- **可以简化的：1 处**（`dsh-session-query` 的 `readTitle`/`readSession`/`listSessions` 可以替换 btw 三处手搓实现，见 T30-U07；这同时是 H-4/H-5/H-19 的修复路径）。
- **可选后续优化：1 处**（迁入 `dsh-client-ui-sidebar-right`，根治 S-4；**不纳入本批**）。
- **一个必须做的减法**：btw 不能再靠 `dsh-host-apiproxy` 的补丁缝（H-16）——0.2.0 没有这个包，主会话图片转文本必须另找落点或声明为已知回退。

---

## 5. 改造交付单元清单（21 条）

**约定**：`现状` 行给出 btw 侧 `文件:行号`；`改为` 行给出目标形状 + 0.2.0 依据行号；`验收` 为可执行判据。
所有单元作用于 **工作区 `dsh-btw/`**（迁移基线 = 工作区源码，见 §1.4）；试改请先整目录复制到 `.workspace/audit-020/`。

### A. 构建与依赖面（先做，否则后面无法编译）

| 单元 | 文件·位置 | 现状 | 改为 | 依据行号 | 验收 |
|---|---|---|---|---|---|
| **T30-U01** | `package.json:85-108`（deps + peerDependencies）；`:109-138`（devDependencies） | peer 全部 `<0.2.0`；devDep 钉 `0.1.1-rc.2`（`:111-124`）；`@deepseek-ai/schemastery ^3.18.1`（`:86`） | peer 改 `0.2.0-rc.1`（或 `>=0.2.0-rc.1 <0.3.0`）；**删 `@deepseek-ai/dsh-client-runtime`，加 `@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-api-session-controller`、`@deepseek-ai/dsh-session`（client 类型来源）**；devDep 同步钉 `0.2.0-rc.1`；`schemastery` 对齐 `~3.18.4`、`@deepseek-ai/cordis` 对齐 0.2.0 所需（`dsh-base/package.json` 的 `@deepseek-ai/cordis-plugin-timer ~1.1.6` 同批） | `dsh-base/lib/package.json` 依赖表；`dsh-client-store/package.json` 存在；`dsh-client-runtime` 在 0.2.0 树中不存在 | `node_modules` 重装后 `pnpm run typecheck` 不再出现 `TS2307: Cannot find module '@deepseek-ai/dsh-client-runtime/client'` |
| **T30-U02** | `package.json:68-84`（`dsh` 段） | `dsh.client.inject` 含 `@deepseek-ai/dsh-client-runtime` | 从 `inject` 删该行；按需补 `@deepseek-ai/dsh-client-store`（若其可作为 graph 行）或改用 `external` 精确声明 | `dsh-client-modules/lib/types/client/manifest.d.ts:48-64`（`inject`=「package-name dependency edges used for factory arrival and plugin composition」；`external`=「exact non-inject module requests」）；`:83-88` 同义；行序算法 `dsh-client-modules/lib/index.js:414-437` 只对 `external` 建边 | 0.2.0 web 启后 `window.__DSH_BOOT__` 的 `entries` 里有 `@local/dsh-btw` 行，且其 `inject` 不含已消失包 |
| **T30-U03** | `tsdown.config.ts:14-24`（`CLIENT_EXTERNALS`） | 含 `'@deepseek-ai/dsh-client-runtime/client'` | 删该项，改为实际被 `require` 的包（`defineStore` 的实际来源包；`H-8` 定案后同步） | `dsh-client-modules/lib/index.js:254-269`：模块表 require 未命中即 `throw ... require("…") missed the module table …`；`:269` `cannot resolve "…" — not a seed word, not a materialized module, and not a row in the boot graph` | `lib/client.js` 重新构建后 `grep -o 'require("…")'` 不再出现 `dsh-client-runtime`（现有 bundle 该处为 `lib/client.js` 第 1 个 require 段，见 §1 证据） |
| **T30-U04** | `src/host/vision.ts:132-142`（`loadVisionAdam`） | 断言 `analyzeImageBytes`/`resolveOptions`/`resolveApiKey` 三个导出 | 保持断言，但把失败话术改为「与 0.2.0 不兼容」并**把 U-1 的判定结果写进注释**；若 U-1 判定该插件在 0.2.0 不可用，则给出降级路径（文本模型拒绝图片 + 明确报错，而非抛「部署副本缺导出」） | `src/host/vision.ts:136-140`（现状）；H-16 使主会话侧无法再由宿主补位 | 未装 `dsh-vision-adam` 时，纯图片消息得到**可读的中文错误**且不崩侧聊；装了且可用时图片照常转文本 |

### B. 宿主运行时面（核心）

| 单元 | 文件·位置 | 现状 | 改为 | 依据行号 | 验收 |
|---|---|---|---|---|---|
| **T30-U05** | `src/index.ts:5-6,13,22-76` | `import { settingsNamespace } from '@deepseek-ai/dsh-settings'`；`BTW_SETTINGS_NS = settingsNamespace('dsh-btw')`；`ctx.inject(['settings'], c => c.settings.register(NS, SCHEMA))` | ① 删 `settingsNamespace` 具名导入与 `BTW_SETTINGS_NS`（0.2.0 无此函数、无此品牌面）；② 改为**插件自带 `Config`**：`export const Config = z.object({...同 BTW_SETTINGS_SCHEMA...})`，`apply(ctx, config: Config)`，并把配置对象下传（或注入一个 `BtwConfig` 结构体给 `SideChatService`）；③ 若需要**自定义设置页**，追加 `ctx.effect(() => ctx.settings.configure({auto:false}, ctx.fiber))` | `dsh-settings/lib/index.js:544`（导出表无 `settingsNamespace`）；`dsh-settings/lib/types/index.d.ts:62-117`（`SettingsForms` 无 `register`）；`:11` `autoGenerate`；范式参照 `dsh-agent-tool-presentation/lib/types/index.d.ts:32-49`、`dsh-tool-present/lib/types/index.d.ts:7-20`、`dsh-client-ui-theme/lib/index.js:90` | 0.2.0 启后 btw fiber **ACTIVE**（无 `register is not a function`）；设置页出现 `btw` 条目；改 profile patch 里 `btw` 行的 `config:` **值级热生效**（不开新版侧聊即生效） |
| **T30-U06** | `src/host/vision.ts:144-192`（`readVisionConfig`、`readBtwSettings`）；消费点 `side-chat-service.ts:108-140,1233` | `ctx.get('settings')?.get?.('dsh-btw')` 结构读（`?.` 使失败静默） | 改为从 **U05 注入的 `Config`** 读（宿主侧每次调用读同一 config 引用即可获得值级热更新）；`vision-adam` 段同样走 Config（`vision.ts:145-154`）。**保留** `?.` 防御但**加一次显式 warn**（把静默失效变可见） | `dsh-settings/lib/index.js:324,339,346-348`（`settings.yaml` 已迁入 profile）；`dsh-settings/lib/types/index.d.ts:96-114`（`describe/update/mutate` 是唯一读/写面） | 在 profile patch 的 `btw` 行写 `config: {model:{provider: …}}`，`btwDefaultProvider()` 返回值随值变化（**不重启**）；把该行写成非法值时回退代码常量且有日志 |
| **T30-U07** | `src/host/side-chat-service.ts:209-213`（`completedTurnSeed`）、`:296-313`（`parentTitleOf`）、`:374-445`（`progressDigestLines`）、`:513-686`（`transcript`）、`:1370-1386`（`hydrateImageRefs`）、`:939`（`entry.seedLength`） | 全部读 `session.events` / `header.seedLength` / 手扫 `session/title` 事件 | ① `Session.events` → **`sessionQuery.readSession(sessionId)`** 拿 `SessionLogSnapshot{events, inheritedEventCount}`（推荐，避开 `@deprecated`）或退一步用 `session.snapshotEvents()`/`ownEvents()`（**已标 `@deprecated`「new calls are prohibited」**，仅作过渡）；② `header.seedLength` → **`session.inheritedEventCount`**（resume 路径语义：0.1.1 `seedLength` 表达「fork 线边界」，0.2.0 拆成 `header.isSeeded` + `Session.inheritedEventCount` + `Session.firstLiveSeq` 三者，需按 `:186-199` 的注释分别取用）；③ `parentTitleOf` → **`sessionQuery.readTitle(parentId)`**；④ 订阅式增量（`transcript` 的实时性）改用 **`'session/event'`**（带 `dsh-scope` 作用域过滤，子 agent 作用域订阅者只收自己 session 的事件） | `dsh-session/lib/types/index.d.ts:64`（`'session/event'`，`@dshScopeScan unsupported`）、`:182`（`eventAt`）、`:193`（`snapshotEvents`，`@deprecated`）、`:201`（`ownEvents`，`@deprecated`）、`:121`（`inheritedEventCount`）、`:137`（`firstLiveSeq`）；`dsh-session-query/lib/types/index.d.ts:67,74,88`；`dsh-session/lib/types/types.d.ts:58-95`（`isSeeded: boolean`，无 `seedLength`） | `tsc` 三档零 `TS2339 'events'` / 零 `TS2339 'seedLength'`；真机：侧聊转录**不含**父会话历史、进度摘要行数正确、父会话标题正确 |
| **T30-U08** | `src/host/side-chat-service.ts:219-227`（`hiddenSideChatMeta` 的 `forkSeq` 实参）、`:789`（传 `seed.length`） | `childSessionMeta(parent, childDepth, seed.length)` | 第三参改 **`isSeeded: boolean`**（`seed.length > 0`），并把精确前缀长度改由 `agents.create` 的 `inheritedEventCount` 传（见 U09） | `dsh-subagent/lib/types/child-agent.d.ts:70` `childSessionMeta(parent, childDepth, isSeeded: boolean)`；`:145-155` `ChildCreateInputs{lineageSeedLength}` 注释同义 | 新建侧聊不抛 `session header isSeeded must be a boolean`；子会话 header 里 `isSeeded` 是 **boolean** |
| **T30-U09** | `src/host/side-chat-service.ts:786-796`（`parent.ctx.agents.create({...})`） | 未传 `inheritedEventCount` | 补 `inheritedEventCount: SessionLogOffset(seed.length)`（品牌类型，**直接传 number 编译不过**）；`:923-931` 的 `agents.resume({...})` 同查 | `dsh-agent/lib/types/index.d.ts:67-78`（`CreateAgentOptions` 的新字段）；`dsh-session/lib/types/index.d.ts:152-155`（`Session.create(id, seed?, header?, inheritedEventCount?, projections?)`） | `tsc` 无 `SessionLogOffset` 相关报错；新建侧聊成功且 transcript 从 child 自己的第一条事件开始 |
| **T30-U10** | `src/remote-descriptors.ts:25-34`（`directDescriptor` 工厂体）、`:37-48`（10 条描述符） | `codec: { mode:'strict', typeSymbol, schema: <zod schema> }` | 改为 `codec: { mode:'strict', typeSymbol, create: () => schema }`（**`create` 必须是函数**，返回同一个 zod schema 实例即可）；同时把 `sourceLocation.line` 从 `444/784/793/870/886/899/924/943/977/1000` 更新为真实行号 | `dsh-typert-protocol/lib/types/types.d.ts:199-203`（`create: () => TypertSchema`）；`dsh-typert-loader/lib/index.js:87,211`（**注册期** `throw ... has no create() factory`）；`dsh-typert-registry/lib/index.js:565`；`dsh-api-gateway/lib/index.js:1504`（`codec.create().parse(value)`） | btw 插件**能 apply 通过**（不再在注册期抛 `has no create() factory`）；`scripts/smoke-build.mjs` 的 `invocations.length === 10` 断言仍过；`sideChat/start` 一次真机 RPC 成功往返 |
| **T30-U11** | `src/host/prompt-transform.ts:1-123`（整文件）；`src/index.ts:8,75`（注册） | 注册 `session/prompt-image-transform` waterfall，让主会话的图片按目标模型能力直传或经 vision-adam 转文本 | **该缝在 0.2.0 不存在**（承载包消失）。三选一：**(a)** 删除 `prompt-transform.ts` 与 `registerPromptImageTransform`，主会话图片交回官方闸门（`dsh-api-session-controller/lib/index.js:873`：模型不支持图片即报 `session/attachment-invalid`）——**推荐**，最小风险；**(b)** 改用 0.2.0 官方 `dsh-compaction-image-offload` 缝（仅覆盖 `IMAGE_OFFLOAD_REQUIRED` 场景，**覆盖面比原来窄**）；**(c)** 另寻 agent 面 `agent/request` waterfall 做等效拦截（**本轮未验证其能力边界，不要直接上**） | `grep -rn 'prompt-image-transform' <0.2.0 tree>` 零命中；`ls -d .../dsh-host-apiproxy` → ABSENT；`dsh-api-session-controller/lib/index.js:873`；`dsh-compaction-image-offload/lib/types/index.d.ts:1-17` | 主会话图片路径**不再依赖不存在的包**；`tsc` 零错误；真机：把图片贴进主会话时，支持图片的模型原图直传、不支持的模型给出**可读错误**（而不是静默失败） |
| **T30-U12** | `src/host/vision.ts:90-99`（`modelAcceptsImage`）、`:72-81`（`resolveAgentRoute`） | 读 `ctx.get('llm').resolveModelInfo(provider, model, signal).inputModalities` 与 `ctx.get('agentDefaultModel').currentSelection()` | 结构读**保留**（两者在 0.2.0 都仍在），但把「闸门」语义与 U11 对齐：既然官方闸门自己就用 `model.inputModalities`（`dsh-api-session-controller/lib/index.js:873`），btw 的能力检测应改为**只服务侧聊内部决策**（自建子会话的模型能否吃图），不要再声称能拦住主会话 | 同上 | 侧聊内部：支持图片的模型走原图直传、不支持走 vision-adam 文本路径；`vision.autoTransform=false` 时给可读拒绝 |

### C. 客户端运行时面

| 单元 | 文件·位置 | 现状 | 改为 | 依据行号 | 验收 |
|---|---|---|---|---|---|
| **T30-U13** | 10 处 `import ... from '@deepseek-ai/dsh-client-runtime/client'`：`src/client/index.ts:1,2`、`controller.ts:1`、`presentation.tsx:2`、`btw-settings.ts:2,4`、`SideChatDrawer.tsx:2`、`SideChatJumpList.tsx:2`、`SideChatSurface.tsx:5`、`drawer-size-store.ts:17` | 全部指向已消失的包 | 按符号分别改源：`ClientContext` → `import type { Context as ClientContext } from '@deepseek-ai/cordis'`；`SessionId` → `@deepseek-ai/dsh-session/types`（或 `@deepseek-ai/dsh-client-connection/client`）；`ISessions`/`SessionBinding`/`SessionFace` → `@deepseek-ai/dsh-api-session-controller/client`（或 `/types`）；`defineStore` → 见 U14；`SettingsScope`/`SettingsScopeSnapshot` → **无对应物，见 U16** | `dsh-client-ui-jobs/lib/types/client/index.d.ts:7`（ClientContext 范式）；`dsh-api-session-controller/lib/types/client/contract/sessions.d.ts:4`（SessionId 来源）、`:47-156`（ISessions）、`:100-108`（SessionBinding）；`.../session.d.ts:156`（SessionFace） | `tsc -p tsconfig.client.json` 零 `TS2307` |
| **T30-U14** | `src/client/drawer-size-store.ts:17,25-50` | `defineStore` from client-runtime | 改 `defineStore` 的**来源包**为 0.2.0 里可 `require` 的 client 行；形状**不用改**（`{init, persist, actions}` 与 0.2.0 `StoreSpec` 逐字一致）；同步 U03 的 external 列表 | `dsh-client-store/lib/types/contract.d.ts:45-49`（`StoreSpec{init,persist?,actions}`）、`:80-90`（`StoreHandle.create(scopeKey?)`）、`:95-97`（`StoreDecl = StoreHandle | StoreFactory`）；`dsh-client-store/lib/types/index.d.ts:89-91` | 抽屉尺寸在**刷新/插件重载/宿主重启**后仍保持（localStorage `dsh.btw.drawerSize` 有值且被读回） |
| **T30-U15** | `src/client/controller.ts:109-131,415-459` | `this.sessions.list.subscribe/getSnapshot`（**兼容**）；`this.sessions.binding(id)`（**兼容**）；**不兼容**：`this.sessions.open(...)`（`:432`）、`this.sessions.openSubagent(...)`（`:429`）、`list.getSnapshot().subagentsByParent`（`:455`） | ① `open/openSubagent` → 用 `retain(target, options)` + `using(...)`（`SessionTarget` 支持「durable direct-parent address」），导航意图交给视图所有者；② `subagentsByParent` → 用 **`ISessions.subagentAddress(id)`**（`dsh-api-session-controller/.../sessions.d.ts:90`，注释明确「Resolve an already discovered direct-parent address without opening it — Feature plugins use this to avoid Agent-bound RPCs in persisted child views」），或 `scope(id)`/`scopeOf(ctx)`/`sessionOf(ctx)`（`:135,142,148`）；③ 若确实需要「跳到那个会话」，参考 `dsh-client-ui-sidebar-right`/`dsh-client-ui-session` 的导航实现【未判定：其运行期 API 本轮未读】 | `dsh-api-session-controller/lib/types/client/contract/sessions.d.ts:47-156`（成员表：**无 open/openSubagent**）；探针 `probe-07-session-list.ts(7,5)/(8,5): TS2339` | `tsc -p tsconfig.client.json` 零 `TS2339 open/openSubagent`；真机：JumpList 点一个父会话能切过去（或给出可读的「不支持」提示，**不得静默无反应**） |
| **T30-U16** | `src/client/btw-settings.ts:1-124`（整文件）；`src/client/index.ts:2,18,33-36,78`；`presentation.tsx` 的 `settingsScope` prop 全链 | 依赖 `settingsScope` 客户端服务 + `SettingsScope<BtwSettingsSection>` | `settingsScope` 服务**已取消**。改为 0.2.0 的设置读面：**(a)** 宿主侧走 U05/U06 的 `Config`，客户端**不再需要跨进程读设置**（侧聊的行为开关可由 `sideChat/read` 的返回体携带，如 `value.ui`）——**推荐**，改动最小且与 0.2.0 的「Config 是唯一承载面」一致；**(b)** 若必须客户端直读，用 `dsh-client-ui-settings` 的 `SettingsDescribeMirror`/`SettingsDescribeFace`（`getSnapshot/subscribe/ensure/acceptView`）+ `remote.settings.describe()`/`mutate()` | `dsh-settings/lib/index.js:544`（无 `settingsScope` 相关导出）；全 0.2.0 树 grep `SettingsScope` 零命中；`dsh-client-ui-settings/lib/types/client/settings-mirror.d.ts:14-60`；`dsh-client-ui-permission-presets/lib/client.js:655`（客户端写设置范式：`ctx.remote.settings.mutate(ns, ops, revision)`） | 客户端插件 fiber **ACTIVE**（不再永久等待 `settingsScope`）；侧聊面板的 `banner`/`modelSelect`/`imageBadge` 开关在改配置后**热生效** |
| **T30-U17** | `src/client/use-overlay-placement.ts:90-101,155-176,423`（`pane()` 与 observer 的 `attributeFilter`） | 认 `:scope > [data-pane="sidebar"/"details"]`、`.sidebarCol` / `.detailsCol`、`[data-details-collapsed]` | 更新为 0.2.0 的真实帧结构：列类名 `sidebarCol` / **`rightbarCol`**；折叠属性 `data-sidebar-collapsed` / **`data-rightbar-collapsed`**（拖拽中 `data-dragging` 不变）；`data-pane` 与 `detailsCol` 已不存在 ⇒ 删除该分支或改为按列序 + 类名双轨匹配；`[data-shell-overlay]`、`[data-slot="shell.overlay"]` **保留** | `dsh-client-ui-layout/lib/client.js:322-325`（`data-sidebar-collapsed`/`data-rightbar-collapsed`/`data-rightbar-fullscreen`/`data-rightbar-instant`/`data-dragging`）、`:326-360`（子列类名 `sidebarCol` / `rightbarCol`）、`:345`（`data-shell-overlay`）；`dsh-client-ui-renderer/lib/client.js:1100`（`data-slot`）；全树 grep `data-pane`/`data-details-collapsed` 零命中 | 真机：抽屉在侧栏展开/折叠、右栏展开/折叠、窗口缩放三种状态下**都不与原生面板重叠**；`data-placement-degraded` 不常驻 |

### D. 行为退化配套（能起但不对）

| 单元 | 文件·位置 | 现状 | 改为 | 依据行号 | 验收 |
|---|---|---|---|---|---|
| **T30-U18** | `src/host/side-chat-service.ts:355,416-429`（digest 的 `assistant/chunk` 部分文本）、`:549-558`（transcript 的 `assistant/chunk`） | 读 `event.data.chunk.type === 'text-delta' / 'reasoning-delta'` 与 `event.data.chunk.text` | 改为读 **`assistant/attempt`** 事件的 `data.stream: AssistantStreamRecord[]`：`'text-chunks'`/`'reasoning-chunks'` 的 `texts: string[]` 拼接；`'chunk'` 记录里的 `StreamChunk` 才是原形状。`tool-call-chunks` 可按需映射到工具摘要 | `dsh-session/lib/types/types.d.ts:333-336`（`assistant/attempt{stream}`）；`dsh-llm/lib/types/assistant-stream.d.ts:16-40`（4 个 record 分支）、`:49`（`RawStreamChunkType` 排除三种 delta） | 真机：侧聊运行中「正在生成」的**部分文本**能实时出现（不是等 assistant/message 落地才出现）；`tsc` 零 `TS2367` |
| **T30-U19** | `src/host/side-chat-service.ts:1221-1253`（`send` 的图片分支） | `entry.modelSelection?.current` + `modelAcceptsImage` + `analyzeImages` | 逻辑**保留**（这是 btw 自建子会话的能力检测，H-16 不影响它）；但要把「模型不支持且 `autoTransform=false`」的拒绝文案统一，并补一条：**子会话模型不支持图片时，`read_image` 工具是可用的兜底**（`shared/tool-policy.ts:27` 已列 `read_image`，0.2.0 的 `read_image` 在 `dsh-tool-fs` 里仍在，见 `dsh-tool-fs/lib/index.js:975`） | `src/shared/tool-policy.ts:20-37`；`dsh-tool-fs/lib/index.js:975` | 贴图到侧聊：支持图片的模型原图直传；不支持且开关开 → 转文本成功；开关关 → **可读中文拒绝**、消息不发送、`requestId` 未记录（可重试） |
| **T30-U20** | `src/client/SideChatSurface.tsx` / `SideChatDrawer.tsx` / `SideChatToolRow.tsx` 中未被 0.2.0 覆盖的 UI 面 | 依赖 `@deepseek-ai/dsh-client-ui-primitives` 与 `@deepseek-ai/dsh-client-ui-slots` 的组件/类型 | 复核 `dsh-client-ui-primitives` 在 0.2.0 的导出面是否齐全（本轮只验证了包**存在**与 `PropsLocale` 等类型位可用）；缺什么就按 0.2.0 的等价组件补 | `dsh-client-ui-primitives` 在 0.2.0 树中存在；`dsh-client-ui-slots/lib/types/index.d.ts:789,802` 的 `register` 泛型已收紧 | `tsc -p tsconfig.client.json` 零 `TS2305 无导出` 类错误 |
| **T30-U21** | `src/typert.host.ts:1-28`、`src/remote-descriptors.ts:33`（`sourceLocation.file/line`）、`scripts/smoke-build.mjs:16-19`、`tests/*` | 描述符行号指向旧版 `src/host/side-chat-service.ts` 的 `444/784/793/...`；`smoke-build` 断言 10 条 invocation；15 个 spec 里 10 个 hash 与部署件不同 | 同步行号；把 U05–U18 的新契约写进 spec（尤其：`create()` codec、`inheritedEventCount`、`assistant/attempt`、`sessionQuery.readTitle`）；`smoke-build` 断言改为「10 条 invocation 且每条 codec 有 `create` 函数」 | `src/remote-descriptors.ts:38-47`；`dsh-typert-loader/lib/index.js:87,211` | `pnpm run test` 全绿；`pnpm run smoke` 全绿；`tsc` 三档全绿 |

### 5.1 建议落地顺序（依赖链）

1. **U01 → U02 → U03**（构建与依赖面；不先做后面全都编译不过）
2. **U05 → U06**（settings 承载面；U16 依赖 U05/U06 的形态定案）
3. **U08 → U09 → U07**（子会话创建与事件读面；U07 是最大的单点工作量）
4. **U10**（typert 描述符；独立，可与上面并行）
5. **U11 → U12 → U19**（图片面；U11 是删除/改向的判断题）
6. **U13 → U14 → U15 → U16 → U17**（客户端面；U15 有【未判定】分支，需先读 `dsh-client-ui-session` 导航实现）
7. **U18 → U20 → U21**（行为与测试收尾）

---

## 6. 工作量估计（相对 0.1.7 迁移）

### 6.1 与 0.1.7 迁移的量化对照

| 维度 | 0.1.7 迁移（历史实测，`btw-017-consolidated-units.md` §1.1） | 0.2.0 迁移（本轮） | 变化 |
|---|---|---|---|
| 破坏点总数 | 18（宿主 H1–H11 + 客户端 C1–C7） | **26 不兼容**（硬失败 19 + 静默退化 7） | **+8（≈1.44×）** |
| 「必须改才能加载/构建」 | 10 | **19** | **+9（1.9×）** |
| 交付单元 | 13 必需 + 2 可选 | **21（17 必需 + 4 配套）** | **+6（1.35×）** |
| `tsc` 宿主档错误基线 | 12 errors | **未在本档实跑全档**（只跑了逐点探针；探针侧 13 errors 覆盖 8 个独立契约点） | — |
| 最大单点工作量 | C1（client-runtime → client-store 换承载面，1 处 import + 1 处 external） | **U07**（`Session.events` 消失 ⇒ 摘要/转录/seed 三条读取路径重写） | **工作量主体从「换承载面」变成「换数据面」** |

### 6.2 三个「0.2.0 新引入、0.1.7 时还不存在」的难点

1. **`Session.events` 整条读面消失（H-4/H-5/H-19 → U07）**
   0.1.7 时 `session.events` 仍在（只是 `header.seedLength` 变了）。0.2.0 类体里**完全删掉了 `events` 访问器**（`dsh-session/lib/types/index.d.ts:119-143`），且替代的 `snapshotEvents()`/`ownEvents()` 已被官方标 **`@deprecated`「new calls are prohibited」**。btw 的核心三件事——**父会话摘要**（`:374-445`）、**子会话转录**（`:513-686`）、**图片 ref 复原**（`:1370-1386`）——全部建立在这个访问器上。这是本轮**唯一需要重新设计**（而非机械改签名）的单元。

2. **客户端导航面重写（H-12/H-13/H-14 → U15）**
   0.1.7 时 `ISessions.open/openSubagent` 和 `subagentsByParent` 都在（0.1.7 审计的 BU-08/BU-09/BU-10 只是「`current`/`subagentsByParent` 的键名问题」）。0.2.0 把它们**整体换成 `retain/using/scope/subagentAddress/sessionOf` 的资源保留模型**（`dsh-api-session-controller/.../sessions.d.ts:47-156`）。btw 的 `jumpTo()`（`controller.ts:421-438`）依赖「打开另一个会话」这个动作，而新模型把**导航交给视图所有者**（注释「navigation belongs to view owners」）。⇒ 要么找到新的导航入口（【未判定】，需读 `dsh-client-ui-session`/`sidebar-right` 实现），要么把 JumpList 降级为「只展示、不跳转」。

3. **主会话图片转文本缝消失（H-16 → U11）**
   0.1.7 时 `dsh-host-apiproxy` 的 `session/prompt-image-transform` 补丁缝还在（报告 19-52 只把它当依赖方问题）。0.2.0 **整个 `dsh-host-apiproxy` 包不存在**，图片闸门内建进 `dsh-api-session-controller`（`:873` 直接按 `inputModalities` 抛错）。⇒ btw 的 `prompt-transform.ts`（123 行）**要么删、要么改走 `dsh-compaction-image-offload`（覆盖面变窄）**。

### 6.3 相对工作量判断

| 判断项 | 结论 |
|---|---|
| **总量对比** | **0.2.0 迁移 ≈ 0.1.7 迁移的 1.1–1.3×**（单元数 21 vs 15，必需单元 17 vs 13；但 0.1.7 的 13 个单元中有 5 个是「装 peer 即消」或「改键名即消」的轻量项，0.2.0 的 21 个里只有 U01/U14/U21 属于那类轻量项） |
| **是否需要「先设计再落地」** | **需要，且比 0.1.7 更甚**。0.1.7 的 13 个单元全部是「换 API 名/换承载包/补一个字段」的机械改；0.2.0 的 **U07（事件读面重写）与 U15（导航面重写）必须先定方案**——U07 要在「`sessionQuery.readSession`（推荐）/ `session/event` 订阅 / 已废弃的 `snapshotEvents`」三选一，U15 有【未判定】分支。⇒ 建议在修订执行复核档之前，先加一个**小规模方案定案**（U07 的读面选型 + U15 的导航落点确认）。 |
| **单档能否做完** | **不建议单档**。建议拆 3 档：**(A) 构建+宿主**（U01–U12）、**(B) 客户端**（U13–U17）、**(C) 行为+测试**（U18–U21）。(A) 与 (B) 文件边界不重叠，可并行；但 (B) 的 U16 依赖 (A) 的 U05/U06 定案，(C) 依赖 (A)(B) 全绿。 |
| **必须重启的次数** | 宿主代码改动 ⇒ **必须重启一次**（btw 是宿主插件，改 `lib/index.js` 需重载）。客户端 bundle ⇒ 0.2.0 的 `dsh-client-hmr` 仍在组合里（`dsh-base/lib/cordis.patch.yml` 有 `hmr` 行），btw 的 client bundle 走 `dsh-client-modules` 的 bundle 路由 + `rebuilt()` 增量重建（`dsh-client-modules/lib/index.js:600-618`）⇒ **理论上不重启**。**【未判定】**：本轮未实测 0.2.0 下第三方插件 client bundle 的 HMR 重建延迟。配置值 ⇒ 0 次（Config 是值级热提交）。 |
| **净估计** | **1 次宿主重启**（迁移后首启）；若 (A)(B) 分档落地，可能 2 次。 |

### 6.4 风险与红线（给执行档）

1. **不要把部署件当基线**：部署件落后 40 小时且缺 26 个文件（§1）。改完必须以工作区 `dsh-btw/` 重新构建、再整目录覆盖部署位置。
2. **不要删 `SideChatService.static inject` 里的 `'settings'`**：0.2.0 的 `settings` 服务**仍在**（服务名不变、类变成 `SettingsForms`，`dsh-settings/lib/types/index.d.ts:62`），只是**方法面全变**。U05/U06 是对的修法，删 inject 是错解。
3. **不要用已废弃的读面收尾**：`snapshotEvents()`/`ownEvents()` 能编译、能跑，但官方注释明写「new calls are prohibited」（`dsh-session/lib/types/index.d.ts:185-186,193-196`）。若 (A) 档时间紧，可以过渡，但必须在报告里显式声明为**技术债**。
4. **`typert` 描述符失败阶段已从「调用期」变成「注册期」**：不要等到真机 RPC 才发现（§0 第 7 条、U10）。
5. **`options` 必须保持 `string[]`**：0.1.7 已确认 schemastery 非 strict + last-good 回退的约束；0.2.0 的 `Config` 走同一 schemastery 面，**不要**改成对象数组（会让旧 profile 段校验失败并整段回退）。**【未判定】** 0.2.0 的 `app-boot` 是否仍有 `validateVolatilePlacement` 的「volatile 不得嵌套 / 数组内禁 volatile」约束（本轮未读 0.2.0 的 `dsh-app-boot` 该校验函数）。

---

## 7. 未验证项

| # | 项 | 为什么没验 | 建议的验证动作 |
|---|---|---|---|
| U-1 | `@deepseek-ai/dsh-vision-adam` 在 0.2.0 下的可加载性（§3.4） | 该包是**树外** profile 自建插件，不在 0.2.0 官方 npm 树内；本档未读其实现 | 读其源码核对它 import 的官方符号（`installSettingsSection`/`settingsNamespace` 等）在 0.2.0 是否仍在；或在 0.2.0 隔离组合里实载 |
| U-2 | `ctx.slots.inject/register` 在 0.2.0 的**运行期**校验（§3.4） | 只做了类型期探针（零错误），未起 0.2.0 组合 | 起隔离组合后看 `dsh-btw.action` / `dsh-btw.drawer` 两个 entry 是否 ACTIVE |
| U-3 | `dsh-better-sidebar@0.14.0` 在 0.2.0 客户端行里的可加载性 | btw 通过 `ctx.inject(['betterSidebar'])` 使用它；它是本机自建（`~/.dsh/profiles/node_modules/` 内），本轮未读其 client bundle 的 external 列表 | 检查其 `lib/client.js` 是否 `require` 了已消失的包（同 btw 的 H-7 问题） |
| U-4 | 0.2.0 下第三方插件 client bundle 的 **HMR 重建延迟** | 未起 0.2.0 隔离组合 | §6.3 的「0 次重启」结论依赖此项（结构性证据已有：`dsh-client-modules/lib/index.js:600-618` `rebuilt()` 路径 + `dsh-base` 的 `hmr` 行，但未实测） |
| U-5 | `dsh-client-ui-primitives` / `dsh-client-ui-slots` 在 0.2.0 的**导出面完整性** | 本轮只验证了包存在、`PropsLocale`/`SlotMap`/`register` 在；未逐符号核对 btw 用到的每个 primitive 组件 | 对 btw 的 `SideChatSurface.tsx`/`SideChatDrawer.tsx`/`SideChatToolRow.tsx`/`SideChatButton.tsx` 逐个符号跑一次 tsc（U20） |
| U-6 | `ISessions` 新导航模型的**对外入口**（U15 的替代方案） | `dsh-api-session-controller` 注释明说「navigation belongs to view owners」，但本轮**未读** `dsh-client-ui-session`/`dsh-client-ui-sidebar`/`dsh-client-ui-sidebar-right` 的导航实现 | 读这三个包的 client 面，找出「以插件身份请求切换当前会话」的合法 API |
| U-7 | 0.2.0 的 `dsh-app-boot` 是否保留 `validateVolatilePlacement`（§6.4 第 5 条） | 本轮未读 0.2.0 的 `dsh-app-boot` | grep 其 `lib/index.js` |
| U-8 | `~/.dsh-017/profiles/node_modules/@local/dsh-btw` 与工作区源码的哈希关系 | 超出 T30 的必要读取面 | 用 §1.1 同法对账 |
| U-9 | (A) 档的**全档 tsc 基线**（宿主/客户端/测试三档各多少 error） | 本档只做了**逐契约点探针**（17 个 probe 文件），未把 btw 源码整体指向 0.2.0 树跑全档 | 在 `.workspace/audit-020/` 内复制一份 btw 源码 + 指向 `t30/full020/node_modules` 的 tsconfig，跑三档 `--noEmit` 取基线（给执行档当闸门） |

---

## 8. 本轮实测产物索引（供复核）

| 路径 | 内容 |
|---|---|
| `.workspace/audit-020/reports/T30-btw-compat-020.md` | 本报告 |
| `.workspace/audit-020/t30/hashes.json` | 两侧全量 `{相对路径: sha256}` 字典 |
| `.workspace/audit-020/t30/hash-src-all.txt` / `hash-dep-all.txt` / `cmp-common.txt` | 原始 sha256 列表与交集比对 |
| `.workspace/audit-020/t30/full020/` | `npm install @deepseek-ai/dsh@0.2.0-rc.1` 装出的**完整 0.2.0 核验树**（289 个 `@deepseek-ai/*` 行），本报告所有 0.2.0 `文件:行号` 均可在其中实读 |
| `.workspace/audit-020/t30/pkgs020/x/` | 单独 `npm pack` 出的 4 个关键包：`dsh-tool-subagent-control`、`dsh-base`、`dsh-agent-tool-presentation`、`dsh-tool-subagent`（0.2.0-rc.1） |
| `.workspace/audit-020/t30/probe/` | 17 个逐契约点类型探针 + `tsconfig.json` + `tsc-020.txt`（13 errors，逐条对应 §3 矩阵） |
| `.workspace/audit-020/t30/install.log` | `npm install` 日志（含 546 packages / 35s） |
