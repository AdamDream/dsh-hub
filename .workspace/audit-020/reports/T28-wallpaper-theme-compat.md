# T28 — wallpaper / ui-theme 在 0.2.0 的兼容性审计

- 轨道：T28（审计阶段，只读；除 `.workspace/**` 外未写任何路径）
- 审计时刻：2026-09-29（当轮实测；所有哈希/行号/命令输出均为本轮采得）
- 未触碰：现役 3080（0.1.1-rc.2）、隔离 3097（0.1.7-rc.2）均未启动/未连接/未修改；未写入 `~/.dsh/**`、`~/.dsh-017/**`、工作区既有源码
- 未发起任何模型请求；未启动任何监听端口的服务（唯一的 node 执行是本地静态 import + 纯内存单测，无 listen）

## 路径简写（下文全部使用）

| 简写 | 绝对路径 |
|---|---|
| `[DEP3080]` | `/home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-wallpaper` |
| `[DEP017]` | `/home/CNS2026495165/.dsh-017/profiles/node_modules/@local/dsh-wallpaper` |
| `[SRC-WS]` | `/home/CNS2026495165/dsh/dsh-wallpaper-local` |
| `[BK-PLUGINS]` | `/home/CNS2026495165/dsh/.workspace/backups/plugins/plugins/@local/dsh-wallpaper` |
| `[BK-UPGRADE]` | `/home/CNS2026495165/dsh-upgrade-backup/20260925-110042/local-plugins/@local/dsh-wallpaper` |
| `[PORT017]` | `/home/CNS2026495165/dsh/workbuddy-reverse-proxy/_migration/settings-017/dsh-wallpaper` |
| `[ASM017]` | `/home/CNS2026495165/dsh/workbuddy-reverse-proxy/_audit/unified-assembly-20260929-121756/home/profiles/node_modules/@local/dsh-wallpaper` |
| `[V020]` | `/home/CNS2026495165/dsh/.workspace/audit-020/t30/full020/node_modules/@deepseek-ai`（0.2.0-rc.1 完整安装树，289 包） |
| `[V017]` | `/home/CNS2026495165/dsh/.workspace/audit-020/work/closure017/node_modules/@deepseek-ai`（0.1.7-rc.2 闭包） |
| `[V011]` | `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai`（**正在运行的 0.1.1-rc.2** 的包树，只读） |

本轮新增的审计产物（均在 `.workspace/audit-020/t28/` 内，纯副本，未改动任何既有源码）：
`t28/pkg/`（`[PORT017]` 的副本 + 指向 `[V020]` schemastery 的软链）、
`t28/peercheck.mjs`、`t28/probe/config-contract.mjs`、`t28/probe/dump*.mjs`。

---

## 1. 结论摘要

1. **迁移方式判定：需改造（以 0.1.7 移植档为基线的源码重建 + 5 个最小改造单元）。既不能"部署件复制"，也不能用工作区源码直接重建。**
   - `[DEP3080]` / `[DEP017]` / `[BK-UPGRADE]` 都是 **0.1.1 时代**的部署件（`lib/client.js` = `0fc4fd87fe4e`，走 `ctx.settingsScope` + `@deepseek-ai/dsh-client-runtime`）。这两个契约在 0.1.7/0.2.0 中**都已不再存在**（§3 H9/H10/C21），直接复制会整插件加载失败。
   - `[SRC-WS]` 是**过期源码**（`lib/client.js` = `28141d52c252`，**缺少** 2026-09-21 的"FC1 主题重入"热修），不能作为基线。
   - `[PORT017]`（`client.js` = `e3000eeb6dfa`、`index.js` = `068f94e7c141`、`package.json` = `548913e4a96f`）是**唯一可用基线**：已完成 configForms 移植、已含 FC1 热修与 C-R4/FC-1 媒体根隔离修复、并带一个 7 用例 FC-1 回归测试。
2. **契约点核验矩阵共 35 条：存在 28 条、变化（存在但需注意/需改）3 条、消失 4 条、另有未判定 2 条。**
   - **对 0.2.0 仍需动手的契约点不兼容数 = 1**：`sessions.list.getSnapshot().current` 已消失（0.1.1 有，0.1.7 起被移除），导致"会话页"per-page 覆盖**永远不生效**（`currentPage()` 恒返回 `home`）。这是 0.1.7 移植档遗留缺陷，必须在 0.2.0 迁移中一并修掉。
   - 另 3 条"消失"（`settingsNamespace`、`ctx.settingsScope`、`@deepseek-ai/dsh-client-runtime`）**已由 0.1.7 移植档处理完毕**，对 0.2.0 无残留动作。
   - 3 条"变化"：`peerDependencies` 上界 `<0.2.0`（当前侥幸通过，**官方稳定 0.2.0 一发布即 deny 整个插件行**）、`install.sh`/包元数据陈旧（仍指向已消失的 `dsh-client-runtime`）、`dsh.client.inject` 中的冗余项。
   - 其余 28 条（`Config` 所有权、volatile 门、entry id 键控、`configForms`、`theme.overrideTokens`、`slots.inject/register`、`settings.general.item` 槽、`webServer` prefix 路由、`dshHomePath`、模块表/种子词、`SettingsPathOpView` …）在 0.2.0 **逐条存在且签名未变**；其中承载这些契约的 12 个官方包里，**9 个的 `lib/**` 在 0.1.7↔0.2.0 逐字节相同**（只有 `package.json` 版本号不同）。
3. **`ui-theme` 是官方包，本机没有任何 fork。** 主题定制只是**配置值**（`preference: light`），插件代码零改造；0.2.0 官方 Web bundle 默认就组合 `- id: ui-theme, name: '@deepseek-ai/dsh-client-ui-theme'`，`ctx.theme` 与 `settings.general.item` 槽默认存在。
4. **资源只剩 1 个文件要带**：`~/.dsh/wallpapers/37758c1c-9ca8-47d2-bade-3048ab825fb6.png`（2 334 260 B，sha256 `5fd2309b21d9…`）。落位规则 = `<DSH_HOME>/wallpapers/<uuid>.<ext>`。
5. **配置（含壁纸与该主题偏好）有一条官方自动迁移通道**：0.2.0 的 `dsh-settings` 在 boot 后会执行 `importLegacyDocument()`——把 `<profile.home>/settings.yaml` 改名为 `.imported`，再按 **section 名 = profile patch entry id** 逐段写进对应 entry 的 Config。壁纸节名恰好是 `wallpaper`、主题节名恰好是 `ui-theme`，与 entry id 完全一致 ⇒ 可零代码迁移。但它是 **rename-first 一次性**操作，必须先完成 profile patch 再投放 `settings.yaml`（§4.3）。
6. **0.1.7 那一轮实际上没有迁移壁纸资产与配置**（实测：`[ASM017]` 所在 home 的 `wallpapers/` 为空目录、`settings.yaml.imported` 内容仅 `{}\n`、profile patch 的 `wallpaper` 条目只有 `id`/`name` 而无 `config:`）。0.2.0 这一轮必须显式补做。

---

## 2. 证据

### 2.1 源码位置与部署件逐文件哈希对账

`sha256 | 字节 | mtime | 路径`

**`lib/client.js`（浏览器半，631 行）**

| sha256(前 12) | 字节 | mtime | 位置 | 说明 |
|---|---|---|---|---|
| `28141d52c252` | 31079 | 2026-09-08 14:29 | `[SRC-WS]/lib/client.js` | 工作区源码；**无 FC1 热修** |
| `28141d52c252` | 31079 | 2026-09-08 14:34 | `[BK-PLUGINS]/lib/client.js` | 与工作区源码同版 |
| `28141d52c252` | 31079 | 2026-09-11 | `~/.dsh/profiles-archive/web2-20260915-105429/node_modules/@local/dsh-wallpaper/dsh-wallpaper/lib/client.js` | 历史归档 |
| `0fc4fd87fe4e` | 31803 | 2026-09-21 17:21 | `[DEP3080]` | **现役 3080 部署件**；settingsScope 版 + FC1 热修 |
| `0fc4fd87fe4e` | 31803 | 同 | `[DEP017]` | **隔离 3097 的部署件与 3080 完全相同** |
| `0fc4fd87fe4e` | 31803 | 同 | `[BK-UPGRADE]` | |
| `0fc4fd87fe4e` | 31803 | | `~/.dsh/profiles-archive/...`、多个 `_audit/*/home/profiles/...` | |
| `e3000eeb6dfa` | 33276 | 2026-09-28 15:48 | `[PORT017]/lib/client.js` | **0.1.7 移植档（configForms 版）** |
| `e3000eeb6dfa` | 33276 | 同 | `[ASM017]`、`_audit/p1-settings-deploy-20260928-182223/...`、`_audit/rem-audit-20260929-114800/...`、`_audit/unified-assembly-*/rollback/**` | 移植档的这些副本与 `[PORT017]` 逐字节相同 |
| `0fc4fd87fe4e` | 31803 | | `[ASM017]` 的 `rollback/drill`、`rollback/B2` 之外的旧副本 | |

**`lib/index.js`（宿主半）**

| sha256(前 12) | 字节 | 位置 |
|---|---|---|
| `05d42901206a` | 11498 | `[SRC-WS]`、`[DEP3080]`、`[DEP017]`、`[BK-PLUGINS]`、`[BK-UPGRADE]`（0.1.1 版：模块级 `MEDIA_ROOT` + `settingsNamespace`） |
| `068f94e7c141` | — | `[PORT017]`、`[ASM017]`（0.1.7 版：`export const Config` + per-apply `mediaRoot`） |

**其余文件（`[PORT017]` 全景）**

| 文件 | sha256 | 与 `[DEP3080]` 关系 |
|---|---|---|
| `package.json` | `548913e4a96f` | **不同**（1960 B → 1896 B：去掉 `dsh-settings` 的 `dsh.client.inject` 项、peer 列表调整） |
| `lib/types/index.d.ts` | `d61d91e7e44b` | **不同**（改写为"profile entry id + Config"措辞） |
| `lib/types/client/index.d.ts` | `ddcf3133d8d9` | **不同**（去掉 0.1.1 的 slots 增强） |
| `assets/wallpaper-effect.png` | `4df113e45034` | 相同 |
| `assets/wallpaper-settings.png` | `b471432c492e` | 相同 |
| `cordis.patch.yml` | `487288f97e67` | 相同 |
| `install.sh` | `20d9362ac772` | 相同（**即 0.1.1 原文，尚未更新**，见 MU5） |
| `LICENSE` | `054a4441272a` | 相同 |
| `README.md` / `README.zh-CN.md` | `c17c87351909` / `f3aa1bff30a1` | 相同 |
| `tests/media-root.spec.mjs` | `d16b96476b9a` | 新增（0.1.1 无） |

**对账结论**

- 工作区源码（`[SRC-WS]`）**落后于现役部署件**：`lib/client.js` 缺 2026-09-21 的 FC1 热修（`sameShadedTokens` 相同层去重）。即**本仓库不存在"源码=部署"的单一真相**；工作区副本不可用于重建。
- 现役/隔离两个部署件（`0fc4fd87fe4e`）是 0.1.1 时代产物，**其客户端半与 `[DEP017]` 完全相同**——说明 0.1.7 那一轮的移植档 `[PORT017]` **只被部署进了 `_audit/unified-assembly-*/home`，没有部署进 `~/.dsh-017`**（本轮只记录该哈希事实，不推断原因；原因见 §7-6）。
- 因此迁移基线只能取 `[PORT017]`。三个候选基线的其余判定见 §6 开头。

**FC1/C-R4 两处关键修复均在 `[PORT017]` 中（逐行确认）**

1. 客户端 FC1（主题重入去重）：`[PORT017]/lib/client.js:187-193`（`shadedTokens` + `sameShadedTokens`）、`:209-215`（内容相同则跳过重挂 `overrideTokens`）。
2. 宿主 FC-1/C-R4（媒体根模块态污染）：`[PORT017]/lib/index.js:50`（`LEGACY_MEDIA_ROOT` 降级为纯常量）、`:246-255`（`mediaRoot` 改为 per-apply 闭包态，经 `ctx.get("dshHomePath")` 解析）、`:288/:300` 等所有文件操作显式传 `mediaRoot`。

### 2.2 本轮实测命令与结果（可复核）

**(A) 官方 0.2.0 的 peer 兼容闸门对三个壁纸 manifest 的裁决**（`t28/peercheck.mjs`）

直接 import `[V020]/dsh-app-boot/lib/index.js` 导出的 `evaluatePluginCompatibility`，分别用 0.2.0 与 0.1.7 的 app-boot 跑：

```
## app-boot 0.2.0-rc.1
   deployed-3080/017 (~/.dsh, ~/.dsh-017): COMPATIBLE (no incompatible peers)
   017-port (settings-017 payload):       COMPATIBLE (no incompatible peers)
   workspace source (dsh-wallpaper-local): COMPATIBLE (no incompatible peers)
## app-boot 0.1.7-rc.2
   （同上，三条均 COMPATIBLE）
```

⇒ `>=0.1.1-rc.2 <0.2.0` **在 0.2.0-rc.1 下不触发拒绝**（semver：`0.2.0-rc.1 < 0.2.0` 成立），但它是"侥幸通过"，见 §3 H12。

**(B) 壁纸 `Config` 是否满足 0.2.0 的 Config 契约**（`t28/probe/config-contract.mjs`，import `[PORT017]` 副本 + `[V020]` schemastery 3.18.4 + `[V020]` app-boot projector）

```
exports: Config,WALLPAPER_ENTRY_ID,apply,inject
root.meta: {"default":{}}
dict keys: global,pages
  global: type=object volatile=true
  pages:  type=object volatile=true
volatileForm defined: true | form fields: global,pages
isVolatilePath([global])              = true
isVolatilePath([pages])               = true
isVolatilePath([pages,session])       = true
createConfigProjector: OK, acceptsMissing = unknown
Config({}) -> {"global":{},"pages":{}}
```

⇒ 0.2.0 的 `volatileForm` / `isVolatilePath` / `validateVolatilePlacement`（projector 第一步）**全部接受**该 Config；`['global']`、`['pages']` 子树可写。

**(C) 宿主半 FC-1 回归测试在 0.2.0 模块树下重跑**（`t28/pkg/` = `[PORT017]` 副本 + 指向 `[V020]/@deepseek-ai/schemastery` 的软链，`node --test tests/media-root.spec.mjs`）

```
# tests 7
# pass 7
# fail 0
```

⇒ 宿主半（唯一的外部宿主依赖是 0.2.0 的 schemastery）在 0.2.0 下**功能自洽**：媒体根优先级（service > `$DSH_HOME` > 遗留 `~/.dsh`）、两次 apply 的根隔离、DELETE 不外溢、状态码/头/Content-Type 保持。

**(D) 逐字节 diff：0.1.7 vs 0.2.0 契约包**

`diff -rq [V017]/<pkg> [V020]/<pkg>`：

| 包 | lib/** 是否相同 | 备注 |
|---|---|---|
| `dsh-client-ui-settings` | **完全相同** | 只有 `package.json` 版本号不同 ⇒ `ConfigForms.get`、`ConfigFormSnapshot`、`mutate` 语义未变 |
| `dsh-client-ui-slots` | **完全相同** | |
| `dsh-client-locale` | **完全相同** | |
| `dsh-client-store` | **完全相同** | |
| `dsh-client-modules` | **完全相同** | ⇒ `dsh.client` 声明与模块表契约未变 |
| `dsh-client-ui-renderer` | **完全相同** | `ctx.slots` 的实际提供者（见 C6） |
| `dsh-host-webserver` | **完全相同** | |
| `dsh-settings` | **完全相同** | ⇒ volatile 门、legacy 导入器均与 0.1.7 一致 |
| `dsh-client-resources` | **完全相同** | |
| `dsh-client-ui-theme` | **不同**（仅 `lib/client.js` 内联 CSS 串） | 见 §5 |
| `dsh-client-ui-settings-general` | **不同**（CSS + 更新行文案 + 版本号串） | `settings.general.item` 渲染点未变 |
| `dsh-api-session-controller` | **不同**（类型 + impl） | `ISessions.list` 未变；`SessionListState` 无 `current`（017↔020 之间 `SessionListState` 定义**逐字节相同**） |

### 2.3 关键源码行号（供逐条复核）

**0.2.0 侧**

| 契约 | 位置 |
|---|---|
| entry Config 读取 | `[V020]/dsh-settings/lib/index.js:538-540`（`entry.fiber?.runtime?.Config`）；`[V020]/dsh-app-boot/lib/index.js:2950`（`Reflect.get(plugin,"Config")`） |
| volatile 表单 | `[V020]/dsh-settings/lib/index.js:118-131`（`volatileForm`）、`:148-158`（`isVolatilePath`）、`:501-507`（`write` 门，含 `entry.options.id === ns`、`has no volatile fields`、`is not volatile`）、`:513-523`（`validatePaths`）、`:524-534`（`strip`） |
| 禁止 volatile 嵌套 | `[V020]/dsh-app-boot/lib/index.js:2322-2332`（`validateVolatilePlacement`，`createConfigProjector` 第一步 `:2350-2351`） |
| 浏览器表单键控 = entry id | `[V020]/dsh-client-ui-settings/lib/client.js:1309-1312`（`get(entryId)` → `new ConfigFormController(this.owner,{namespace: entryId},…)`） |
| 表单快照/写操作 | `[V020]/dsh-client-ui-settings/lib/types/client/config-form-types.d.ts:6-32`（`status:'loading'\|'ready'\|'unavailable'`、`value`、`revision`、`writable`、`mode`）、`:36-73`（`getSnapshot`/`subscribe`/`mutate`/`set`/`unset`） |
| 写入 op 形状 | `[V020]/dsh-client-ui-settings/lib/types/client/config-form.d.ts:26-93`（`ConfigFormController`）、`:106-142`（`ConfigForms.get<T>(entryId)`） |
| `SettingsPathOpView` | `[V020]/dsh-settings/lib/types/types.d.ts:43-54`（`{op:'set',path:string[],value:JsonValue} \| {op:'unset',path:string[]}`） |
| legacy settings.yaml 导入 | `[V020]/dsh-settings/lib/index.js:302-308`（`LEGACY_SECTION_ENTRIES`，含 `ui-developer-tools→ui-settings`、`ui-onboarding→ui-settings-general`、`shell→*-sandbox`；**`wallpaper`/`ui-theme` 不在映射内 ⇒ section 名即 entry id**）、`:339-342`（loader settle 后触发）、`:343-360`（`importLegacyDocument`：rename-first、逐 section `update`、拒绝的 section 只 warn 且仅留在 `.imported`）、`:465-473`（`update`） |
| `dshHomePath` 根域服务 | `[V020]/dsh-app-boot/lib/index.js:4071`（`ctx.provide("dshHomePath", dshHomePath)`）；`[V020]/dsh-home-paths/lib/index.js:82-84`（`dshHomePath(...segments)`）、`:73-76`（优先级 显式配置 > `$DSH_HOME` > `~/.dsh`，空白 `$DSH_HOME` 视为未设） |
| webServer prefix 路由 | `[V020]/dsh-host-webserver/lib/types/index.d.ts:30`（`'prefix' p 匹配 p 与 p/<anything>`）、`:31-39`（`WebRoute{kind,path,handler}`）、`:90`（`register(route):()=>void`，重复 `(kind,path)` 抛错） |
| 主题服务契约 | `[V020]/dsh-client-ui-theme/lib/types/client/index.d.ts:109-188`（`ThemeRuntime`；`:131 getTheme()`、`:178 overrideTokens(source,tokens)`）、`:84-96`（`Context.theme`、`'theme/change'`） |
| 主题 token 仍存在 | `[V020]/dsh-client-ui-theme/lib/client.js:1148`（基础 CSS 含 `--dsw-alias-bg-base`，light=`var(--dsw-static-neutral-bluish-00)`、dark=`var(--dsw-static-neutral-bluish-950)`）、`:1234-1241`（内省表 `--dsw-alias-bg-base`，`requiresLightAndDark:true`）、`:1225-1233`（内置主题 `tokens: {}`） |
| 主题插入点实现 | `[V020]/dsh-client-ui-theme/lib/client.js:1390`（`getTheme()`）、`:1474`（`overrideTokens(source,tokens)`）、`:1487-1496`（`buildSnapshot`）、`:1598/:1613`（sync） |
| ui-theme 宿主半 | `[V020]/dsh-client-ui-theme/lib/index.js:80-82`（`Config = z.object({preference:…volatile(), fontSize:…volatile()})`）、`:88-97`（`apply(ctx,config)`、`inject:["settings"]`、`webserver/index-inject`） |
| 槽注册服务 | `[V020]/dsh-client-ui-renderer/lib/types/client/index.d.ts:25-30`（`ctx.slots: SlotRegistry`、`ctx.uiRenderer`）；`[V020]/dsh-client-ui-renderer/lib/client.js:1343`（`inject(key, callback)`）、`:1578`（`_register(options, component)`） |
| 槽注册规则 | `[V020]/dsh-client-ui-slots/lib/index.js:163-185`（`register(options, component)`；未声明抛 `slot "X" is not declared`；`list` 槽要求 `options.id`） |
| `settings.general.item` 槽 | `[V020]/dsh-client-ui-settings/lib/types/client/contract/slots.d.ts:106-124`（`kind:'list'`、`scope:'root'`、owner 无 props）；`[V020]/dsh-client-ui-settings-general/lib/client.js:638`（`renderSlot("settings.general.item", {})`）、`:1177`（子槽声明）、`:957/:967`（官方同一写法的 `ctx.slots.inject` 用例） |
| 会话 list 契约 | `[V020]/dsh-api-session-controller/lib/types/client/contract/sessions.d.ts:42-45`（`readonly list: ObservableSnapshot<SessionListState>`）；`[V020]/dsh-client-store/lib/types/contract.d.ts:3-12`（`getSnapshot`/`subscribe`） |
| `SessionListState`（**无 current**） | `[V020]/dsh-api-session-controller/lib/types/client/sessions/service.d.ts:43-52`（仅 `ids`/`byId`/`phase`/`projectionsBySession`）；`[V020]/dsh-api-session-controller/lib/client.js:2963-2970` 与 `:3167-3170`（构造点，无 `current` 键；该包内 `"current"` 字面量 grep 为空） |
| **0.1.1 曾有 current** | `[V011]/dsh-client-runtime/lib/types/client/sessions/service.d.ts:72`（`current: SessionId \| undefined;`） |
| session-maybe 作用域 | `[V020]/dsh-client-ui-session/lib/types/client/index.d.ts:85-92`（`SessionMaybeStandardProps.sessionId: SessionId \| undefined`，"absent while no Session is selected"）；`:67-70`（`SlotScopeTargetMap.session`） |
| layout 面板选择 | `[V020]/dsh-client-ui-layout/lib/types/client/service.d.ts:24-50`（`ILayout.panelInfo: HostObservable<PanelInfo>`；`activePanelId: MainPanelId \| null`，"null displays the current Conversation"、`:1-9` 注明 current-session 选择归 sessions 服务） |
| 0.2.0 Web bundle 默认组合 | `[V020]/dsh-web-app/cordis.patch.yml:236-237`（`ui-theme`）、`:291-292`（`ui-settings-general`）；`[V020]/dsh-web-app/cordis.patch.yml` 中**无 `wallpaper` 条目**，全树亦无 wallpaper/background 功能包 |
| 平台种子词 | `[V020]/dsh-web-frontend/dist/assets/index-Dy0OhsZ5.js`：`function QS(){return{react:…,"react/jsx-runtime":…,"react-dom":…,"react-dom/client":…,"@deepseek-ai/cordis":…,"@deepseek-ai/dsh-client-store":…,"@deepseek-ai/dsh-client-ui-slots":…,"@deepseek-ai/dsh-client-ui-primitives":…,"@deepseek-ai/dsh-client-ui-dockkit":…}}`（`staticModules` 消费于 `[V020]/dsh-client-modules/lib/client.js:548`） |
| inject 的运行时语义 | `[V020]/dsh-client-modules/lib/client.js:643-660`（`inject` 仅用于"先到达依赖行"；`:657-658` 对**不是图行**的名字（如种子词 `dsh-client-store`）**静默跳过**，不报错） |
| 模块表 | `[V020]/dsh-client-modules/lib/client.js:1,17`（`window.__ModuleLoader__.load({id,factory})`）、`:456`（注入面）、`:700-705`（`require` 未命中即抛，含 "not a platform seed word" 文案） |
| peer 兼容闸门 | `[V020]/dsh-app-boot/lib/types/plugin-compatibility.d.ts:1-34`；`[V020]/dsh-app-boot/lib/index.js:286-313`（`evaluatePluginCompatibility`：仅对 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` 前缀 peer，`semver.satisfies(runtime, range, {includePrerelease:true})` 不满足即记为不兼容）、`:320-323`（诊断文案 + `dsh plugin allow-version` 精确版本豁免）；`types/compatibility-preflight.d.ts:4-25`（不兼容行被 `disabled`） |
| patch `insert` 支持 | `[V020]/cordis-plugin-include/lib/types/index.d.ts:29`（`insert?: EntryOptions[]`） |

**壁纸侧（`[PORT017]`）**

| 契约 | 位置 |
|---|---|
| entry id | `lib/index.js:66`（`export const WALLPAPER_ENTRY_ID = "wallpaper"`）、`lib/client.js:26`（同值） |
| Config | `lib/index.js:110-117`（`export const Config = z.object({global: PageSchema.default(DEFAULT_GLOBAL).volatile(), pages: z.object({session,settings,home}).default({}).volatile()})`） |
| 宿主 apply | `lib/index.js:219`（`export const inject = ["webServer"]`）、`:246-255`（`apply(ctx, config)` + `ctx.get("dshHomePath")` + per-apply `mediaRoot`） |
| 媒体路由 | `lib/index.js:51`（`ROUTE`）、`:255`（`ctx.webServer.register({kind:"prefix", path:ROUTE, …})`）、`:52/:57`（10 MiB、扩展名白名单） |
| 客户端注入面 | `lib/client.js:579`（`const inject = ["slots","locale","theme","configForms","sessions"]`） |
| 表单绑定 | `lib/client.js:586`（`ctx.configForms.get("wallpaper")`）、`:591`（`getSnapshot`）、`:603`（`subscribe`）、`:528-529`（`mutate([{op:"set",path:[field],value}])`）、`:570-573`（`status==="ready" && writable`） |
| 主题着色 | `lib/client.js:33`（`BASE` 兜底）、`:187-219`（FC1 去重 + `overrideTokens`）、`:609`（`ctx.on("theme/change")`） |
| 槽注册 | `lib/client.js:612-623`（`ctx.slots.inject("settings.general.item", () => ctx.slots.register({name,id:"wallpaper",order:30,store,locale:SETTINGS_NS,inject}, WallpaperRow))`） |
| 设置面板信号 | `lib/client.js:536-540`（`notifySettingsOpen`：行组件挂载/卸载即信号）、`:352-355`（`currentPage()`） |
| **缺陷点** | `lib/client.js:604-608`（`pageState.current = ctx.sessions.list.getSnapshot().current`） |
| 本地化 | `lib/client.js:22`（`SETTINGS_NS = "settings.wallpaper"`）、`:611`（`ctx.locale.register(SETTINGS_NS,{zh,en})`） |

---

## 3. 契约点核验矩阵

判定口径：**存在** = 0.2.0 中该载体存在且签名/语义与 0.1.7 一致（含实测）；**变化** = 存在但需改代码/元数据或行为有偏移；**消失** = 0.2.0 中不再存在；**未判定** = 需在隔离实例的浏览器中实测才能定。

### 3.1 宿主半（13 条）

| # | 契约点 | 壁纸用法（`[PORT017]`） | 0.2.0 载体（文件:行号） | 判定 |
|---|---|---|---|---|
| H1 | `export const Config` 使 entry 可配置 | `lib/index.js:110` | `[V020]/dsh-settings/lib/index.js:538-540`；`[V020]/dsh-app-boot/lib/index.js:2950`；**实测** `volatileForm(Config)` 有值、字段 `global,pages` | 存在 |
| H2 | `global`/`pages` 声明为 volatile **节点** | `lib/index.js:111,116` | `[V020]/dsh-settings/lib/index.js:118-131,148-158`；**实测** `isVolatilePath([global])=[pages]=[pages,session]=true` | 存在 |
| H3 | volatile 不得嵌套 | 注释显式声明无嵌套（`lib/index.js:100-108`） | `[V020]/dsh-app-boot/lib/index.js:2322-2332`；**实测** `createConfigProjector` 不抛 | 存在 |
| H4 | entry id 必须等于 patch `id:` | `WALLPAPER_ENTRY_ID="wallpaper"`；`cordis.patch.yml` `- insert: [{id: wallpaper, name: '@local/dsh-wallpaper'}]` | `[V020]/dsh-settings/lib/index.js:502`（`row.options.id === ns`） | 存在 |
| H5 | `apply(ctx, config)` 双导出 | `lib/index.js:246` | 由 `runtime.Config` + entry 调用（同上） | 存在 |
| H6 | `ctx.get("dshHomePath")` 根域服务 | `lib/index.js:248-253` | `[V020]/dsh-app-boot/lib/index.js:4071`；`[V020]/dsh-home-paths/lib/index.js:73-84` | 存在 |
| H7 | `ctx.inject(["webServer"])` + `register({kind:'prefix',path,handler})` | `lib/index.js:219,255` | `[V020]/dsh-host-webserver/lib/types/index.d.ts:30-39,90` | 存在 |
| H8 | 同路由下 `POST /upload`、`POST /import`、`POST /cleanup`、`GET`/`DELETE` | `lib/index.js:255-…` | 同上（同一 handler 自持响应） | 存在 |
| H9 | `settingsNamespace()`（`@deepseek-ai/dsh-settings`） | 移植档已移除 host import | 0.2.0 全树 grep `settingsNamespace` = **无命中** | 消失（移植档已处理 ✅） |
| H10 | `ctx.settingsScope` | 移植档已改用 `configForms` | 0.2.0 全树无 `settingsScope` | 消失（移植档已处理 ✅） |
| H11 | `cordis.patch.yml` 的 `- insert:` 语法 | `cordis.patch.yml:8-10` | `[V020]/cordis-plugin-include/lib/types/index.d.ts:29` | 存在 |
| H12 | `peerDependencies`：4 条 `@deepseek-ai/dsh-*`，上界 `<0.2.0` | `lib/../package.json:peerDependencies` | `[V020]/dsh-app-boot/lib/index.js:286-313`；**实测** 0.2.0-rc.1 下 COMPATIBLE（`0.2.0-rc.1 < 0.2.0` 成立） | **变化**（稳定 0.2.0 发布即 deny 整行；且 `dsh-settings` 这条 peer 已无实际用途——index.js 不再 import） |
| H13 | `install.sh` 的安装/校验逻辑与注释 | sh:35-39, 82-89, 97-104 | 0.2.0 树**无** `dsh-client-runtime`（0.1.1 曾有） | **变化**（脚本引用了已消失的包名与过时描述；见 MU5） |

### 3.2 客户端半（22 条）

| # | 契约点 | 壁纸用法 | 0.2.0 载体 | 判定 |
|---|---|---|---|---|
| C1 | `window.__ModuleLoader__.load({id,factory})` | `client.js:9-11` | `[V020]/dsh-client-modules/lib/client.js:1,17,456`（**017↔020 逐字节相同**） | 存在 |
| C2 | `require("react")` / `require("react/jsx-runtime")` | `client.js:15-16` | 种子词表（web-frontend dist，`QS()`） | 存在 |
| C3 | `require("@deepseek-ai/dsh-client-store")`（替代已消失的 `dsh-client-runtime/client`） | `client.js:20` | 种子词表含该键；`[V020]/dsh-client-store/lib/index.js:147,178`（**017↔020 相同**） | 存在 |
| C4 | `runtime.defineStore({init,actions})` | `client.js:328-338` | 同上 | 存在 |
| C5 | `ctx.locale.register(ns,{zh,en})`（双字典重载） | `client.js:611` | `[V020]/dsh-client-locale/lib/types/client/index.d.ts:199`；impl `lib/client.js:1387-1389`（**相同**） | 存在 |
| C6 | `ctx.slots.inject(key, cb)` | `client.js:612` | **`ctx.slots` 由 `dsh-client-ui-renderer` 提供**：`types/client/index.d.ts:25-30`（`slots: SlotRegistry`）；`lib/types/client/registry.d.ts:46`（`SlotRegistry extends Service`）；`lib/client.js:1280`（类体）、`:1843`（`new SlotRegistry(ctx)`）、`:1343`（`inject(key,callback)`） | 存在 |
| C7 | `ctx.slots.register(options, Component)` | `client.js:612-623` | `[V020]/dsh-client-ui-renderer/lib/client.js:1788`（`SlotRegistry.prototype.register(rawOptions, component)`）、`:1578`（`_register`）；`[V020]/dsh-client-ui-slots/lib/index.js:163-185`（`list` 槽需 `options.id`） | 存在 |
| C8 | 槽位 `settings.general.item` 存在且被渲染 | 同上 | `[V020]/dsh-client-ui-settings/.../contract/slots.d.ts:120`；`ui-settings-general/lib/client.js:638,1177`；默认组合见 `dsh-web-app/cordis.patch.yml:291-292` | 存在 |
| C9 | `ctx.theme.getTheme()` | `client.js:202` | `[V020]/dsh-client-ui-theme/lib/types/client/index.d.ts:131`；`lib/client.js:1390` | 存在 |
| C10 | `ctx.theme.overrideTokens(source,{token:{light,dark}})` 返回 disposer | `client.js:215` | 同上 `:178`；`lib/client.js:1474` | 存在 |
| C11 | `ctx.on("theme/change")` | `client.js:609` | `[V020]/dsh-client-ui-theme/.../index.d.ts:88-96` | 存在 |
| C12 | token `--dsw-alias-bg-base` 存在且为双模 | `client.js:33,191,195,204` | `[V020]/dsh-client-ui-theme/lib/client.js:1148,1234-1241` | 存在 |
| C13 | `getTheme().active.tokens` 对内置主题为空 ⇒ 期望走硬编码 `BASE` | `client.js:194-197` | `[V020]/dsh-client-ui-theme/lib/client.js:1225-1233`（内置 `tokens:{}`，与 0.1.7 相同） | 存在（行为不变；但意味着"跟随真实 token 取值"从未生效，属既有设计） |
| C14 | `ctx.configForms.get(entryId)` | `client.js:586` | `[V020]/dsh-client-ui-settings/lib/client.js:1309-1312` | 存在 |
| C15 | `form.getSnapshot()` / `form.subscribe()` | `client.js:591,603` | `config-form-types.d.ts:37-44` | 存在 |
| C16 | 快照字段 `status`/`value`/`revision`/`writable` | `client.js:331-335,570-573` | `config-form-types.d.ts:6-32`（`status` 三值枚举一致） | 存在 |
| C17 | `form.mutate([{op:"set",path:[f],value}])` | `client.js:528-529` | `config-form-types.d.ts:55`；`[V020]/dsh-settings/lib/types/types.d.ts:47-54` | 存在 |
| C18 | **`ctx.sessions.list.getSnapshot().current`** | `client.js:604,606` | 0.1.1 `[V011]/dsh-client-runtime/.../sessions/service.d.ts:72` 有；0.2.0 `[V020]/dsh-api-session-controller/.../service.d.ts:43-52` **无**（`SessionListState` 在 017↔020 间逐字节相同；`client.js:2963-2970` 构造点无该键） | **消失** ⛔ |
| C19 | `dsh.client.inject` 的 4 个包名需可解析 | `package.json` `dsh.client.inject` | `[V020]/dsh-client-modules/lib/client.js:61-75,643-660`（非图行**静默跳过**）；`dsh-client-store` 是种子词而非图行 | 变化（该条 inject 无效但无害，属"需注意"级） |
| C20 | 媒体 URL 同源直取 `<img>/background-image` → `url("/dsh-wallpaper/media/<uuid>.<ext>")` | `client.js:263` | 路由见 H7；`GET` 走同一 prefix handler | 存在 |
| C21 | `require("@deepseek-ai/dsh-client-runtime/client")` | 0.1.1 部署件使用 | 0.2.0 全树无 `dsh-client-runtime` | 消失（移植档已处理 ✅） |
| C22 | `ctx.effect(fn,label)` / 清理 | `client.js:603,610` | cordis 4.0.4（0.2.0） | 存在 |

### 3.3 未判定项（2 条）

| # | 契约点 | 为什么未判定 |
|---|---|---|
| U1 | `session` 页信号的替代源（C18 的修复载体） | 两个候选都**存在**，但需要在真实 0.2.0 浏览器里验证哪一个能拿到稳定信号：**(a)** 在自由槽位挂哨兵组件以读取 `session-maybe` 作用域 prop `sessionId`（`[V020]/dsh-client-ui-session/.../index.d.ts:85-92`）——须先实测哪些 `session-maybe` 槽未被占用（`ui-conversation` 的 `main.conversation`/`conversation.header`/`conversation.composer.bar`/`conversation.hero.agentPreset` 多为 `single` 且已被占，见 `ui-conversation/.../contract/slots.d.ts:122-125,135-138,207-212,246-250`）；**(b)** `ctx.layout.panelInfo.activePanelId`（`ui-layout/.../service.d.ts:24-32`）配合其它信号区分 home/session。 |
| U2 | 浏览器侧端到端加载 | 本轮只做静态契约核验 + 宿主半 Node 侧实测，**未启动任何实例、未开浏览器**（任务硬约束）。`ctx.slots.inject` 的实际挂载时机、`store`/`locale` 注入面、遮罩与着色的视觉结果均未实测。 |

### 3.4 计数

- 矩阵条目 **35**（§3.1 宿主半 H1–H13 = 13；§3.2 客户端半 C1–C22 = 22）；另 §3.3 未判定 2 条（U1、U2）。

| 判定 | 条数 | 明细 |
|---|---|---|
| 存在 | **28** | H1–H8、H11（9）；C1–C17、C19 之外的 C 项：C1–C17、C20、C22（19） |
| 变化（存在但需注意/需改） | **3** | H12（peer 上界）、H13（install.sh/元数据）、C19（inject 冗余项） |
| 消失 | **4** | H9、H10、C21 —— **已由 0.1.7 移植档处理**，无残留动作；C18（`sessions.list…current`）—— **未处理，唯一功能性不兼容** |
| 未判定 | **2** | U1（`session` 页替代信号源）、U2（浏览器侧端到端） |

- 一句话口径：**对 0.2.0 仍需动手的契约点不兼容数 = 1（C18）**；另有 3 条"存在但需注意/需改元数据"（H12、H13、C19）与 2 条未判定（U1、U2）。

---

## 4. 资源落位与迁移清单

### 4.1 资源落位规则（0.2.0 实测确认）

1. **媒体根** = `dshHomePath("wallpapers")`，即 `<DSH_HOME>/wallpapers`；由 root 域服务 `dshHomePath` 提供（`[V020]/dsh-app-boot/lib/index.js:4071`），优先级 **显式配置 > `$DSH_HOME` > `~/.dsh`**，空白 `$DSH_HOME` 视为未设（`[V020]/dsh-home-paths/lib/index.js:73-84`）。
2. **仅在服务缺失时**才降级为 `join(homedir(),".dsh","wallpapers")`（`[PORT017]/lib/index.js:50,253`）。这条降级路径是**越权删除风险源**：若隔离实例既没有该服务也没有 `$DSH_HOME`，其媒体根会指向**现役** `~/.dsh/wallpapers`，而客户端的 `/cleanup`（`client.js:314-320`，keep 列表来自当前配置）会删除未被引用的图片。⇒ **隔离前提**：确认实例自己的 `<home>/wallpapers` 被创建，且现役图片哈希不变。
3. **不是静态目录、不是数据 URL**：图片由插件自己注册的 **prefix HTTP 路由** `/dsh-wallpaper/media` 提供（`lib/index.js:51,255`；`[V020]/dsh-host-webserver/.../index.d.ts:30-39,90`），浏览器以同源相对 URL 引用。文件名恒为 **`<uuid>.<ext>`**（`lib/index.js` 上传/导入路径均 `randomUUID()`），扩展名白名单 `\.(png|jpe?g|webp|gif)$`（`:57`），单文件上限 **10 MiB**（`:52`），响应头 `private, max-age=31536000, immutable`。
4. **上传/导入落盘位置**：`<mediaRoot>/<uuid>.<ext>`；导入只做 **copy**（绝不直接服务源路径）；`DELETE /media/<name>` 单删；`POST /media/cleanup` 删除所有匹配 uuid 命名且不在 `keep` 中的文件。

### 4.2 现役实况（本轮实测）

| 项 | 值 |
|---|---|
| 媒体文件 | `~/.dsh/wallpapers/37758c1c-9ca8-47d2-bade-3048ab825fb6.png` |
| 大小 / sha256 | `2334260` B / `5fd2309b21d90a812dded98e3efdf4319b4cb07498cc98e1dbe79efb3467edad` |
| 文件权限 / mtime | `664` / 2026-09-12 11:47:42 |
| 目录权限 | `~/.dsh/wallpapers` = `775` |
| 配置（现行，settings.yaml） | `wallpaper: {global: {source: /dsh-wallpaper/media/37758c1c-9ca8-47d2-bade-3048ab825fb6.png, darkMask: 0, opacity: 0.88, blur: 0}}`；无 `pages` |
| 主题偏好（现行） | `ui-theme: {preference: light}` |
| `~/.dsh/settings.yaml` | 252 行，sha256 `0f19b0fe0e1b8c801bb9459c743cfa1c9aa84112753c14a1a1b7087a3a03fb57`，mode `600` |
| `~/.dsh-017/wallpapers/` | **不存在 / 0 文件** |
| `[ASM017]` 所在 home 的 `wallpapers/` | **存在但为空**；`settings.yaml.imported` = `{}\n`（3 B） |
| 隔离实例的 profile patch | `~/.dsh-017/profiles/web/cordis.patch.yml` 中 `- id: ui-theme, config: {preference: light}` 在（`:350-352`），而 `wallpaper` 条目**只有 id/name、无 `config:`**（`:26-30`） |

⇒ 0.1.7 那轮的结论：**壁纸配置与图片都没有跟着迁移**（其 profile patch 无 `config:`、home 内 `wallpapers/` 为空、`settings.yaml` 未投放而只留下空的 `.imported`）。

### 4.3 迁移动作（配置 + 资源）

**要带走的文件（就这些）**

| # | 源 | 目标 | 必需？ | 校验 |
|---|---|---|---|---|
| R1 | `~/.dsh/wallpapers/37758c1c-9ca8-47d2-bade-3048ab825fb6.png`（2 334 260 B） | `<新home>/wallpapers/37758c1c-9ca8-47d2-bade-3048ab825fb6.png` | **是**（唯一被引用的壁纸） | sha256 必须等于 `5fd2309b21d9…`；mode 保持 `644`（或 ≥ 读），目录 `755+` |
| R2 | `~/.dsh/settings.yaml` 的 `wallpaper:` 节 | `<新home profile patch>` 的 `wallpaper` entry `config:`（`global`,`pages`） | 是 | boot 后 patch 中 `global.source` 指向 R1 的文件名 |
| R3 | `~/.dsh/settings.yaml` 的 `ui-theme:` 节 | 同上，`ui-theme` entry `config:`（`preference`,`fontSize`） | 是（否则主题回默认 `system`/14px） | patch 中 `ui-theme.config.preference == "light"` |
| R4 | `~/.dsh/settings.yaml` 其余 8 个节（`ui-onboarding`、`llm-deepseek`、`llm-pi-ai`、`agent-default-model`、`vision-adam`、`agent-presets`、`web-search-deepseek`、`dsh-workerspace`、`dsh-ssh-gui`、`dsh-subagent`） | 各自 entry（**不属于 T28 范围**，但**同一次 rename-first 导入会一并消费**，见下） | 与 T03/T13/T17 各轨道交接 | 见下 |

**两条可选路径**

- **路径 A（推荐）：让 0.2.0 的官方 legacy 导入器做**。把 `~/.dsh/settings.yaml` 复制进新 home，boot 时 `importLegacyDocument()`（`[V020]/dsh-settings/lib/index.js:339-360`）会把它改名成 `settings.yaml.imported` 并按 section 名 = entry id 写进对应 entry 的 Config。`wallpaper` 与 `ui-theme` 的节名与 entry id 恰好一致（`LEGACY_SECTION_ENTRIES` 无需映射）。
  - **前置条件（顺序不可颠倒）**：新 profile patch 中必须**已经存在** `id: wallpaper` 与 `id: ui-theme` 两个可配置 entry；否则该 section 会走进 `:356-359` 的 warn 分支，**值只留在 `.imported` 里、不再重试**。
  - **一次性**：rename 在任何写入之前完成，因此**不能靠重启补救**；失败后只能手工把值从 `.imported` 抄进 patch。
- **路径 B（可控）：手工写入 config**。直接把 `global: {source: …}` 写进 `wallpaper` entry、把 `preference: light` 写进 `ui-theme` entry，**不投放** `settings.yaml`（其余节按各自轨道单独处理）。
  - 优点：不会一次性消费整份文档，不会把别的轨道的 section 一起卷进来；缺点：需人工保证字段与 schema 一致。
  - 本轮已实测该 Config 在 0.2.0 下可通过 `volatileForm`/`isVolatilePath`/`createConfigProjector`（§2.2-B），并已由 legacy 导入器的 `update(ns, values)` 走同一条 `write()` 通道（`dsh-settings/lib/index.js:470-473, 501-507`）⇒ **路径 A 与路径 B 的写入门完全一致**。

**迁移完整性校验（4 条硬判据）**

1. `sha256(<新home>/wallpapers/37758c1c-….png) == 5fd2309b21d9…`，且 `sha256(~/.dsh/wallpapers/37758c1c-….png)` **与迁移前一致**（未被越权删除/改写）。
2. 新 profile patch 中 `wallpaper` 条目含 `global.source = /dsh-wallpaper/media/37758c1c-9ca8-47d2-bade-3048ab825fb6.png`；`<新home>/wallpapers/` 内文件集合 == 配置中引用的媒体名集合（多一个都会被 `/cleanup` 删掉，少一个会 404）。
3. 若走路径 A：`<新home>/settings.yaml` **不再存在**、`<新home>/settings.yaml.imported` 存在且内容覆盖原有全部 section；bootstrap 日志中**无** `settings: section … was not imported into entry …` 警告（该文案见 `dsh-settings/lib/index.js:358`）。
4. 客户端 `/cleanup` 的 keep 名单来自 `referencedMediaNames(latestValue)`（`client.js:121-131`），只有在 `snapshot.status === "ready"` 时才触发（`client.js:597-600`）⇒ 若 `wallpaper` entry 未被组合，`status` 会停在 `loading`，**不会**误删文件（这既是保护也是"配置未生效"的信号）。

**权限要求**：无特权需求。`mkdirSync(root,{recursive:true})` 建目录（`lib/index.js:ensureMediaRoot`）、`createReadStream` 读、`rmSync` 删、`copyFileSync` 导入——全部以 harness 运行用户身份完成。现役为 `664` 文件 / `775` 目录，属同一用户，直接 `cp -p` 即可。

---

## 5. `ui-theme` 在 0.2.0 的角色结论

1. **官方包，不是本地定制。** 三棵树里 `ui-theme` 都只有官方包：
   - 0.1.1（现役）：`[V011]/dsh-client-ui-theme` = `0.1.1-rc.2`，宿主半 `lib/index.js:1,12,55` 用 `settingsNamespace("ui-theme")` + `lib/index.js:71` 的 `ctx.inject(["settings"], …settings.register…)`；
   - 0.1.7：同包 `0.1.7-rc.2`；
   - 0.2.0：同包 `0.2.0-rc.1`，宿主半改为 `lib/index.js:80-82` 的 `export const Config = z.object({preference: z.union([...THEME_PREFERENCES]).default(DEFAULT_PREFERENCE).volatile(), fontSize: z.number().step(1).min(12).max(17).default(14).volatile()})` + `apply(ctx, config)`，form 由 **entry id** 派生。
   - 本轮在仓库根（maxdepth 3）、`~/.dsh/profiles/node_modules`、`~/.dsh-017/profiles/node_modules` 全量搜 `*ui-theme*`：仅命中官方目录一处，**无任何 fork/本地替代**。
2. **主题定制的实质是配置值，不是代码。** `~/.dsh/settings.yaml` 的 `ui-theme: {preference: light}` 是唯一"定制"；0.1.1 里它落在 settings 文档的 `ui-theme` 命名空间，0.2.0 里同一 section 名会被 legacy 导入器写进 `id: ui-theme` 的 entry（`ui-theme` 已在官方默认 bundle 中，见 `dsh-web-app/cordis.patch.yml:236-237`）。
3. **0.2.0 官方 bundle 默认组合 `ui-theme` 与 `ui-settings-general`**（`:236-237`、`:291-292`）⇒ `ctx.theme` 与 `settings.general.item` 槽**默认存在**，壁纸插件依赖的两条路径不会因缺少组合而失效。
4. **0.2.0 内 ui-theme 的唯一实质变化对内联 CSS**（`diff -u [V017]/dsh-client-ui-theme/lib/client.js [V020]/…` 全量仅 11 行 diff）：
   - 新增/调整 token：`--dsw-alias-bg-document-selection`、`--dsw-alias-label-deep-diving`、`--dsw-alias-label-deep-diving-shimmer`、`--dsw-alias-label-shimmer`、`--dsw-alias-switch-thumb`；
   - `--dsw-alias-bg-base` 与 `--dsw-alias-bg-layer-*`、`--dsw-specific-sidebar-fill`、`--dsw-alias-border-l2`、`--dsw-alias-button-elevated-fill`、`--dsw-alias-state-error-primary`、`--dsw-alias-brand-primary` 等壁纸样式所用 token **均未变**（`lib/client.js:1148` 基础 CSS 与 `:1236` 内省表）。
   - `ThemeRuntime`（`getTheme`/`overrideTokens`/`ThemeSnapshot`/`BUILTIN_THEMES`）在 0.1.7↔0.2.0 **同址同签名**（`client.js:1390/1474/1487`、`1225-1233`）。
5. **主题定制在 0.2.0 需要改造吗？不需要。** 结论：**零代码改造**；只需把 `ui-theme.preference` 搬到新 profile patch 的 `ui-theme` entry（MU3 一并覆盖）。壁纸侧对 ui-theme 的依赖（`getTheme` + `overrideTokens('dsh-wallpaper:surface')` + `theme/change` 事件）逐条保持。

---

## 6. 最小改造单元清单（MU）

**基线选择（唯一）**：`[PORT017]`（`client.js e3000eeb6dfa` / `index.js 068f94e7c141` / `package.json 548913e4a96f`）。
**否决的基线**：`[DEP3080]`/`[DEP017]`/`[BK-UPGRADE]`（0.1.1 时代，`settingsScope`+`dsh-client-runtime` 双双消失）；`[SRC-WS]`/`[BK-PLUGINS]`（缺 FC1 热修的过期源码）。

### MU1 — `package.json` peer 与注入元数据收口

| 项 | 内容 |
|---|---|
| 文件 | `@local/dsh-wallpaper/package.json`（`peerDependencies`、`dsh.client.inject`） |
| 改动 | ① 把 4 条 peer 的上界 `<0.2.0` 改为 `<0.3.0`（或按"允许任一 0.2.x"写 `>=0.1.1-rc.2 <0.3.0`）；② 删除已无 import 的 `@deepseek-ai/dsh-settings` peer；③ 若希望 express 顺序，可将 `dsh.client.inject` 中的 `@deepseek-ai/dsh-client-store` 保留（种子词，跳过解析，无害），并新增 `@deepseek-ai/dsh-client-ui-renderer`（`ctx.slots` 的实际提供者）以保证槽服务先于本插件就绪 |
| 依据 | `[V020]/dsh-app-boot/lib/index.js:286-313`（仅 `includePrerelease` 的 `semver.satisfies` 失败才 deny，deny 后整 entry `disabled`）、`types/plugin-compatibility.d.ts:1-10`、`types/compatibility-preflight.d.ts:4-25`；`[V020]/dsh-client-modules/lib/client.js:643-660`（inject 非图行静默跳过）；`[PORT017]/lib/index.js` 已无 `dsh-settings` import |
| 验收 | ① `evaluatePluginCompatibility(manifest,{}, "0.2.0-rc.1")` **且** `…, "0.2.0"` 均返回 `undefined`；② 启动日志无 `is incompatible with dsh`；③ `.dsh/profiles/*/compatibility.json` 中**不出现**该插件 |

### MU2 — 「会话页」信号重建（本族唯一功能性不兼容）

| 项 | 内容 |
|---|---|
| 文件 | `@local/dsh-wallpaper/lib/client.js`，`604-608`（`pageState.current = ctx.sessions.list.getSnapshot().current` 及其 subscribe 回调） |
| 改动 | 停止读取 `SessionListState.current`（0.2.0 已无该字段），改为经一个可验证信号源维护 `pageState.current`：**候选 (a)** 在未被占用的 `session-maybe` 槽注册一个不渲染 DOM 的哨兵组件，从作用域 prop 读 `sessionId: SessionId \| undefined`；**候选 (b)** 用 `ctx.layout.panelInfo.activePanelId === null`（表示正在显示 Conversation）配合 (a)/(c) 的补充信号区分 home/session。选定后在 `apply` 中替换 `604-608` 两处赋值与订阅 |
| 依据 | `[V020]/dsh-api-session-controller/lib/types/client/sessions/service.d.ts:43-52`（无 `current`）、`lib/client.js:2963-2970`（构造点无该键）；`[V011]/dsh-client-runtime/lib/types/client/sessions/service.d.ts:72`（0.1.1 曾有）；`[V020]/dsh-client-ui-session/lib/types/client/index.d.ts:85-92`（`session-maybe` 的 `sessionId`，无会话时 absent）；`[V020]/dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts:122-125,135-138,207-212,246-250`（现有 `session-maybe` 槽多为 single 且已占用）；`[V020]/dsh-client-ui-layout/lib/types/client/service.d.ts:24-32` |
| 验收 | 三态实测（浏览器）：① 无会话（home）→ 命中 `home` 覆盖；② 选中/新建会话 → 命中 `session` 覆盖（**当前 0.1.7 移植档在这条上必然失败**，因此这是本单元的回归判据）；③ 打开设置面板 General 区 → 命中 `settings` 覆盖（该路径由 `notifySettingsOpen`（`client.js:536-540`）+ 行组件挂载驱动，应与本次改动互不干扰）；④ 关闭设置面板后回落到 ①/② 的正确状态 |
| 备注 | 具体选 (a) 还是 (b) 属 **U1 未判定**，须在 0.2.0 隔离实例的浏览器中实测后由审计/协调者拍定；本单元只钉死"必须替换"与验收标准 |

### MU3 — 配置持久化迁移（数据面；不改插件代码）

| 项 | 内容 |
|---|---|
| 文件 | 新 root 的 `<新home>/profiles/web/cordis.patch.yml`（新增/补全 `wallpaper` 的 `config:` 与 `ui-theme` 的 `config:`），或 `<新home>/settings.yaml` |
| 改动 | 路径 A（推荐）：先把 patch 里两个 entry 准备到"可配置"状态，再把 `~/.dsh/settings.yaml` 复制进新 home，交由 boot 的 `importLegacyDocument()` 一次性导入；路径 B：手工把 `wallpaper.global`（与可选 `pages`）和 `ui-theme.preference` 写进 patch，不投放 `settings.yaml` |
| 依据 | `[V020]/dsh-settings/lib/index.js:302-308`（section 名 = entry id）、`:339-360`（rename-first、逐 section update、拒绝只 warn）、`:465-473 update` → `:501-507 write` 门；**实测**（§2.2-B）壁纸 Config 通过 `volatileForm`/`isVolatilePath([global])`/`createConfigProjector` |
| 验收 | 见 §4.3 四条硬判据（尤其：`.imported` 存在且完整、日志无 "was not imported into entry" 警告、patch 中 `wallpaper.global.source` 指向迁移后的图片） |
| 风险 | rename-first ⇒ **顺序不可颠倒**；任一 section 的 entry 不存在即永久只留在 `.imported`。T28 只管 `wallpaper`/`ui-theme` 两节；若走路径 A，必须与 T03/T13/T17 等轨道确认其余 9 节的 entry 就绪，否则**改走路径 B** |

### MU4 — 壁纸资源迁移

| 项 | 内容 |
|---|---|
| 文件 | `~/.dsh/wallpapers/37758c1c-9ca8-47d2-bade-3048ab825fb6.png` → `<新home>/wallpapers/` 同名 |
| 改动 | `cp -p` 复制（保留权限），**不要**改名、不要转格式、不要放进 `<新home>/wallpapers/` 之外的任何目录 |
| 依据 | `[PORT017]/lib/index.js:246-255`（mediaRoot 解析）、`:57`（`<uuid>.<ext>` 白名单）、`:52`（10 MiB）、客户端 `/cleanup` 只保留配置引用的名字（`client.js:121-131,314-320,597-600`） |
| 验收 | ① 目标文件 sha256 == `5fd2309b21d9…`；② 源文件 sha256 **不变**（现役未被越权改删）；③ `<新home>/wallpapers/` 文件集合 == 配置引用集合；④ 实例运行一段时间后源文件仍不变（证明媒体根未回落到 `~/.dsh`） |

### MU5 — `install.sh` 与包元数据刷新（推荐，非功能性阻塞）

| 项 | 内容 |
|---|---|
| 文件 | `@local/dsh-wallpaper/install.sh`、`README*.md`（可选）、`lib/types/*.d.ts`（已由 `[PORT017]` 更新） |
| 改动 | ① `CLIENT_INJECT_PKGS`（`:37`）把 `dsh-client-runtime` 换成 `dsh-client-store`（并按 MU1 决定是否加 `ui-renderer`）；② `HOST_DEPS`（`:39`）删除 `@deepseek-ai/dsh-settings`，保留 `@deepseek-ai/schemastery`；③ `BROKEN_PKGS`（`:35`）在 0.2.0 树中复核后收窄（`dsh-client-ui-slots`/`dsh-client-ui-primitives` 已是正常官方包）；④ 默认路径支持 `$DSH_HOME`（`:28-30`），避免误装进现役 `~/.dsh`；⑤ 追加条目时写入 MU3 的 `config:` 块，注释中"配置走 ~/.dsh/settings.yaml"（`:100`）改为"配置走 profile patch 的 wallpaper 条目" |
| 依据 | 0.2.0 树无 `dsh-client-runtime`；`[PORT017]/lib/index.js` 无 `dsh-settings` import；`[V020]/dsh-app-boot/lib/index.js` 有 `PROFILE_PATCH_FILENAME="cordis.patch.yml"`（`:487`）与 `resolveDshHome`；`install.sh:82-89` 的存在性检查会因缺失包直接 `exit 1` |
| 验收 | 在隔离根用 `WALLPAPER_INSTALL_DEST`/`WALLPAPER_PROFILE_PATCH`/`WALLPAPER_CLIENT_MODULES` 覆盖执行，脚本成功结束；执行前后 `sha256sum ~/.dsh/wallpapers/* ~/.dsh/settings.yaml ~/.dsh/profiles/web/cordis.patch.yml` 完全不变 |

### 改造顺序与依赖

```
MU1（元数据，无依赖）
MU4（资源，无依赖）
   └─> MU3（配置，依赖 MU4 的文件已就位；路径 A 还需 MU1 后的 patch 结构）
MU2（客户端缺陷修复，独立；其验收需 MU3+MU4 完成才看得到真实效果）
MU5（收尾，依赖 MU1/MU3 的最终决定）
```

---

## 7. 未验证项（显式标注）

1. **浏览器侧端到端未验证（U2）**：本轮**没有**在真实 0.2.0 浏览器里 materialize 过该 client 包（硬约束禁止启动实例/监听端口）。因此以下均**未实测**：`ctx.slots.inject("settings.general.item", …)` 的实际挂载时机、`store`/`locale` 注入面是否如期交付、遮罩与半透明着色的视觉结果、`theme/change` 触发下的重入行为。
2. **会话页替代信号源未判定（U1）**：候选 (a) `session-maybe` 作用域 `sessionId` 与候选 (b) `ctx.layout.panelInfo` 何者可用/更稳，需在隔离实例浏览器中实测。
3. **`Config({})` 的默认填充行为未与 0.1.7 对照实测**：本轮实测 0.2.0 下 `Config({})` 解析为 `{"global":{},"pages":{}}`（未见 `.default(DEFAULT_GLOBAL)` 被深填），而客户端 `normalizePage`（`client.js:99-107`）会对空对象补齐默认值、故功能上无害；但"0.1.7 是否同样如此"本轮只做了源码相同性对照（`dsh-settings` lib 逐字节相同），**未做 0.1.7 侧同命令实测**。
4. **官方稳定 0.2.0 的 deny 行为未实测**：H12 的风险判定基于 semver 规则 + 0.2.0-rc.1 实测；"发布 `0.2.0`（无 prerelease）后是否必然 deny" 未实测（因为该版本尚不存在）。
5. **`/cleanup` 的实际删除范围未实测**：未启动任何实例，故未验证隔离实例的媒体根是否会（在服务缺失 + `$DSH_HOME` 未设时）回落到现役 `~/.dsh/wallpapers`。MU4 验收 ④ 就是为此设置的观测点。
6. **`~/.dsh-017` 部署件为何仍是 0.1.1 版未判定**：实测哈希显示其 `lib/client.js` = `0fc4fd87fe4e`（0.1.1 时代 + FC1 热修），而 0.1.7 移植档（`e3000eeb6dfa`）只出现在 `_audit/unified-assembly-*/home` 等位置。"是移植档未部署到该 home，还是曾部署后被回滚"——本轮仅有哈希事实，**不推断原因**。对本轨道的实际影响：迁移基线必须以 `[PORT017]` 为准，不能以 `~/.dsh-017` 的现状为准。
7. **`install.sh` 端到端未执行**：MU5 的验收命令本轮未跑（脚本会 `rm -rf` 目标目录并追加 profile patch，属阶段二的写操作）。
8. **未核验 `dsh-client-ui-renderer` 加入 `dsh.client.inject` 是否必需**：本轮只证明 `ctx.slots` 由渲染器提供、且非图行 inject 会被静默跳过；"缺这条 inject 是否真的会抢跑" 未实测（属 MU1 的可选增强）。

---

## 附：本报告引用的实测命令（可复现）

```bash
# 0.2.0 / 0.1.7 基线树
V020=/home/CNS2026495165/dsh/.workspace/audit-020/t30/full020/node_modules/@deepseek-ai
V017=/home/CNS2026495165/dsh/.workspace/audit-020/work/closure017/node_modules/@deepseek-ai

# (A) peer 闸门
node /home/CNS2026495165/dsh/.workspace/audit-020/t28/peercheck.mjs

# (B) Config 契约
cd /home/CNS2026495165/dsh/.workspace/audit-020/t28/probe && node config-contract.mjs

# (C) 宿主半 FC-1 回归（0.2.0 schemastery）
cd /home/CNS2026495165/dsh/.workspace/audit-020/t28/pkg && node --test tests/media-root.spec.mjs

# (D) 契约包逐字节对账
for p in dsh-client-ui-settings dsh-client-ui-slots dsh-client-locale dsh-client-store \
         dsh-client-modules dsh-client-ui-renderer dsh-host-webserver dsh-settings \
         dsh-client-ui-theme dsh-client-ui-settings-general dsh-api-session-controller; do
  echo "== $p"; diff -rq "$V017/$p" "$V020/$p"
done

# (E) 关键字段是否存在
grep -rn 'SessionListState' -A 12 "$V020/dsh-api-session-controller/lib/types/client/sessions/service.d.ts"
grep -n 'current: SessionId' /home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-runtime/lib/types/client/sessions/service.d.ts
grep -rn 'settingsNamespace\|settingsScope' "$V020"            # 期望：无命中
grep -n 'provide("dshHomePath"' "$V020/dsh-app-boot/lib/index.js"
grep -n 'insert?: EntryOptions\[\]' "$V020/cordis-plugin-include/lib/types/index.d.ts"
```
