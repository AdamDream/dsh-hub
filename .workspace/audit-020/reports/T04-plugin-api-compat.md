# T04 — 本地/自建插件 × DSH 0.2.0 插件 API 兼容性审计

> ## ⚠️ 本报告已按协调者实测基线重锚（第 2 版）
>
> **第 1 版把 diff 基准错设为 `0.1.1-rc.2`（现役 3080 的宿主树），而迁移基线是 `0.1.7-rc.2 → 0.2.0-rc.1`。**
> 重锚后**结论发生实质性改变**：第 1 版的全部"0.2.0 新不兼容点"（`dsh-client-runtime`、`settingsScope`、
> `conversationEvents`、`installSettingsSection`/`settingsNamespace`、`Icon*Outline16`）在 **0.1.7-rc.2 里就已经不存在**
> ——它们是**未清偿的 0.1.7 迁移债**，不是 0.2.0 引入的回归。详见 §1.1 与 §9。
>
> 依据分级：**[H]** = 该包 `lib/` 在 0.1.7→0.2.0 逐字节相同，故契约不可能变（哈希推定）；
> **[R]** = 该包 `lib/` 有真实改动，契约经 **0.2.0 源码实读**确认；
> **[H-]** = 该包 `lib/` 逐字节相同 **且** 契约点在 0.1.7 侧确实**不存在**（同样的哈希推定也证明 0.2.0 不存在）。

- **轨道**：T04（审计阶段，只读；不改产品代码）
- **审计对象**：`~/.dsh/profiles/node_modules/@local/` 下 9 个插件 + `@deepseek-ai/dsh-vision-adam`（本地识图插件）+ `dsh-workspace-enhancement`（隔离侧本地插件）共 **11 个**
- **迁移目标**：`0.2.0-rc.1`
- **基准对**：`0.1.7-rc.2`（`.npm-global-dsh017/…`）→ `0.2.0-rc.1`（`.workspace/audit-020/t30/full020/…`）
- **采样时刻**：2026-09-29；全部结论绑定当轮实测文件与哈希（见 §2、`evidence.txt`）

---

## 1. 结论摘要

### 1.1 三分类清单

| 类别 | 数量 | 插件 |
|---|---|---|
| **A. 原样可用（无需修改）** | **1** | `dsh-logfile 0.1.0` |
| **B. 必须修改** | **9** | `dsh-btw 0.4.0-btw.1`、`dsh-pptmaster 0.1.0`、`dsh-ssh-gui 0.2.0`、`dsh-subagent-model 0.1.0`、`dsh-usage 0.1.0`、`dsh-wallpaper 0.5.0`、`dsh-workerspace 0.1.0`、`dsh-vision-adam 0.2.0`、`dsh-web-search-sse 0.1.0` |
| **C. 需重写或退役** | **1** | `dsh-workspace-enhancement 0.1.2`（判定理由见 §3.11） |

> **判定口径**：**A** = 其宿主面与客户端面所引用的每个契约点，在 0.1.7 与 0.2.0 中**要么 `lib/` 逐字节相同，要么经源码实读确认存在**，且**修不修都不影响能否加载**；**B** = 存在明确、局部、可点名的修补点（本批的修补点**全部是承接 0.1.7 债**，无 0.2.0 新增）；**C** = 依赖的核心机制需在 0.2.0 重建，逐点修补成本高于重写。
>
> **关于 `dsh-web-search-sse`**：它与其余 B 类不同——其阻塞**不在插件源码的新旧，而在部署副本选错**（§9.4）。它同时也是 §5 F-4 修复范式的**已完成样例**，因此 dev 工作量最低、部署动作最明确。

### 1.1b 分类修正记录

第 1 版曾把 `dsh-workerspace` 判为 B；重锚后一度升为 A（理由是证明包全部 [H] 逐字节相同），
但**在报告定稿前对该结论做了自检并推翻**：`dsh-workerspace/lib/index.js` 实测含
`import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings"`（各 2 处）与
`installSettingsSection(ctx, WS_SETTINGS_NAMESPACE, Config, config, {...})` 调用
⇒ 与 `dsh-web-search-sse` 同型，**加载期即失败**，维持 **B 类**。
（该自检同时说明：**证明包 [H] 只能证明"上游契约未变"，不能证明"插件自己没用到已消失的符号"**——
判 B/C 必须落回插件自身源码，不能只看依赖包的哈希。§2.2 的 [H] 表因此只用来说明"上游未变"，不用于免除插件侧核验。）

### 1.2 最关键的发现（重锚后）

**① 本批插件的全部"客户端面断裂"都是 0.1.7 既有债，0.2.0 一项未新增 —— 但同样必须在本次迁移中清偿**

对 `0.1.7-rc.2` 全树（`*.js` + `*.d.ts`）grep，以下 token **0 命中**，在 `0.2.0-rc.1` 同样 **0 命中**：

| token | 0.1.7 | 0.2.0 | 受影响插件 |
|---|---|---|---|
| `dsh-client-runtime` | ABSENT | ABSENT | btw / pptmaster / wallpaper（bundle 内 `require` 它） |
| `settingsScope` | ABSENT | ABSENT | btw / subagent-model / usage / wallpaper |
| `conversationEvents` | ABSENT | ABSENT | pptmaster |
| `installSettingsSection` | ABSENT | ABSENT | ssh-gui / subagent-model / web-search-sse / workerspace |
| `settings.plugin.item` | 仅 `dsh-client-ui-settings-models:1`（注释） | 同左 | usage |
| `sidebar.workspaces.remoteHosts` | ABSENT | ABSENT | ssh-gui |
| `Icon*Outline16`（8 个名字） | ABSENT | ABSENT | btw（7 个）/ pptmaster（1 个） |

**哈希确证**：`dsh-settings`、`dsh-client-ui-settings`、`dsh-client-ui-settings-plugins`、`dsh-client-ui-slots`
四个包在 0.1.7→0.2.0 **`lib/` 逐字节相同**（§2.2）。即上表的"两边都不存在"是**结构性事实**，不是采样遗漏。

**② 槽位机制整体未变：`dsh-client-ui-slots` 0.1.7→0.2.0 `lib/` 逐字节相同**

⇒ `SlotCore.register`/`inject`/`subscribe`、`SlotMap` 契约、`id`/`order`/`label`/`key`/`priority`/`select` 选项形状
**全部未变**（[H]）。这单独消灭了"0.2.0 槽位注册 API 变了"这一整类风险。

**③ 已核验的槽位键集在 0.1.7 与 0.2.0 完全相同**

| 声明包 | 0.1.7 键集 | 0.2.0 键集 |
|---|---|---|
| `dsh-client-ui-tool` | `tool.call.images`, `tool.call.toolview` | 同 |
| `dsh-client-ui-chat` | `conversation.chat.commandview`, `.node`, `.turnTail`, `conversation.message.images` | 同 |
| `dsh-client-ui-workspace` | 6 键（含 `sidebar.workspaces.directoryFlow` 等，**不含** `remoteHosts`） | 同 |
| `dsh-client-ui-settings` | 9 键（含 `settings.section`, `settings.general.item`） | 同（[H] 逐字节相同） |

**④ `dsh-web-search-deepseek` 的 75% churn 不传导到本机定制（事实证伪协调者的头号风险假设）**

`@local/dsh-web-search-sse` **不是**上游的 import 包装，而是**自包含重实现**：它只从 `dsh-web` 取 `WebError`、
从 `dsh-credentials` 取 `credentialRef`、从 `dsh-launch-environment` 取 `launchEnvironmentOf`，挂载缝是
`ctx.web.registerSearchProvider(...)` + `inject:["web"]`。这四个证明包在 0.1.7→0.2.0 **全部 `lib/` 逐字节相同**（§9）。
⇒ 上游 75% 改动（新增 `deepseek-account` provider 路由、新增 `dsh-deepseek-account` peer dep、新增 `got` HTTP 栈）
**只影响官方 provider 自身**，不打断本机 fork 的挂载。

**⑤ 真正的头号阻塞在本机部署面：现役 3080 的 `dsh-web-search-sse` 副本是坏的**

| 副本 | sha256(lib/index.js) | 导入 `@deepseek-ai/dsh-settings` 的符号 | 在 0.1.7 可用？ |
|---|---|---|---|
| `~/.dsh/profiles/node_modules/@local/`（3080 现役） | `88d6387e351af5a6` | `installSettingsSection, settingsNamespace` | **✘ 两个符号都不存在** |
| `~/.dsh-017/profiles/node_modules/@local/`（3097 隔离） | `5947d09095507cff` | （无该 import） | **✔** |

0.1.7 与 0.2.0 的 `dsh-settings` 导出均为 `{ SettingsConflictError, SettingsForms, SettingsForms as default, redactSecrets }`
——现役副本 import 的两个名字**两版都不存在**，属**模块加载期即失败**。已有 0.1.7 兼容副本在仓内（`5947d090…`），
本次迁移应直接采用它而非 3080 的那份。

### 1.3 与 0.2.0 真正相关的改动点（重锚后仅剩这些）

| # | 改动 | 依据 | 影响插件 |
|---|---|---|---|
| **N1** | `dsh-web-search-deepseek` 75% `lib/` 改动（新 provider 路由 + 新 peer dep） | [R] | `dsh-web-search-sse` **不受影响**（⑤ 才是其阻塞） |
| **N2** | `dsh-client-ui-workspace` 33.3% 改动（`client.js` + 7 个 `.d.ts`） | [R] | `dsh-ssh-gui`（其 `sidebar.workspaces.remoteHosts` 两版皆无 → 非新增） |
| **N3** | `dsh-client-ui-primitives` 13 文件改动（含 `index.js` 与 `types/index.d.ts`） | [R] | 图标集合 0.1.7 与 0.2.0 **均为 98 Regular + 98 Medium、0 Outline16** ⇒ 图标名无 0.2.0 改动 |
| **N4** | `dsh-subagent` / `dsh-session-reference` 各 1 文件改动 = `typert.host.js` 里的**声明字符串** | [R] diff 确认 | 无（typert 描述符文本，非 API） |
| **N5** | 设置命名空间改由 Loader entry id 决定（键漂移） | 见 §1.4 | 7 插件 |

### 1.4 仍需在迁移中处置的"键漂移"（与 0.2.0 相关，但机制在 0.1.7 已存在）

0.2.0 的 `SettingsForms` 以 `entry.fiber.entry?.options.id` 为命名空间。现网 entry id 与注册名的对照：

| 插件 | entry id | 注册命名空间 | `~/.dsh/settings.yaml` 段名 | 对齐 |
|---|---|---|---|---|
| dsh-wallpaper | `wallpaper` | `wallpaper` | `wallpaper:` | ✅ |
| dsh-usage | `usage` | `dsh-usage` | （无段） | ❌ |
| dsh-btw | `btw` | `dsh-btw` | （无段） | ❌ |
| dsh-ssh-gui | `ssh-gui` | `dsh-ssh-gui` | `dsh-ssh-gui:` | ❌ 会**孤立现有配置** |
| dsh-workerspace | `workerspace` | `dsh-workerspace` | `dsh-workerspace: {}` | ❌ 会孤立 |
| dsh-subagent-model | `dsh-subagent-model` | `dsh-subagent` | `dsh-subagent:` | ❌ 会孤立（子代理热路由唯一入口） |
| dsh-web-search-sse | `web-search-sse` | `web-search-deepseek-sse` | （无段） | ❌ |

**结论**：0.2.0 迁移的插件工作量**几乎全部落在"清偿 0.1.7 债 + 键漂移"**，而非 0.2.0 新 API。

### 1.5 修订执行档的最小动作清单（据 §9.4b / §9.5）

| # | 动作 | 目标 | 依据 |
|---|---|---|---|
| **A1** | 用 `5947d09095507cff` 替换 3080 的 `88d6387e351af5a6` 副本 | `dsh-web-search-sse` | §9.4 |
| **A2** | 对 `dsh-btw`/`dsh-ssh-gui`/`dsh-subagent-model`/`dsh-usage`/`dsh-wallpaper`/`dsh-workerspace` 6 个插件**照抄 §9.5 范式**：删 `dsh-settings` import → schema 字段加 `.volatile()` → 命名空间改字面量 → `apply` 内改 `config.X.get()` | 6 插件宿主半 | §9.4b + §3.9 |
| **A3** | 按 §1.4 对齐 entry id 与命名空间（优先改 entry id，保住现网 `settings.yaml` 段） | 7 插件 | §1.4 |
| **A4** | 清偿图标债：`Icon*Outline16` → `Icon*OutlineRegular`（8 个名字） | `dsh-btw`(7) / `dsh-pptmaster`(1) | §9.7 |
| **A5** | 清偿客户端债：`dsh-client-runtime/client` 改指 `dsh-client-store` / `dsh-session/surface`；`settingsScope`→`configForms`；`conversationEvents`→`uiConversation.events` | btw/pptmaster/wallpaper 等 | §5 F-1/F-2/F-5 |
| **A6** | 槽位重定位：`sidebar.workspaces.remoteHosts`（ssh-gui）、`settings.plugin.item`（usage） | 2 插件 | §5 F-6/F-7 |
| **A7** | **复核 3097 隔离实例是否真的加载了这 6 个插件** | 部署前提 | §9.4b 推论 2 |

> A1–A7 **全部不涉及 0.2.0 的新 API**——0.2.0 对本批插件只带来"键漂移"这一项新约束。
②③④⑤ 与本节共同决定了实际工作量。

---

## 2. 证据基线（可复现）

### 2.1 使用的三棵树

| 标签 | 路径 | 说明 |
|---|---|---|
| **0.1.7**（基准） | `/home/CNS2026495165/.npm-global-dsh017/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai` | 283 包，隔离 3097 的 0.1.7-rc.2 宿主树（只读） |
| **0.2.0**（目标） | `.workspace/audit-020/t30/full020/node_modules/@deepseek-ai` | 289 包的 0.2.0 完整闭合树（复用既有工作区产物） |
| **0.1.1**（历史，仅用于债龄考证） | `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai` | 现役 3080 的宿主树；**不是**迁移基准 |
| **0.1.1-clientpin** | `~/.dsh/profiles/node_modules/@local/dsh-pptmaster/node_modules/@deepseek-ai/` | 插件内嵌的 0.1.1-rc.2 客户端包（图标对照用） |
| **0.2.0-cross-check** | `.workspace/dsh-020-pkgs/x/` | 本轮**独立**从 npm 下载的 42 个 0.2.0 包 |

### 2.1b 依据分级（本报告每格标注）

| 级别 | 含义 | 判定力 |
|---|---|---|
| **[H]** | 该包 `lib/` 在 0.1.7→0.2.0 逐文件 sha256 相同 | 契约**不可能**变；无需读签名 |
| **[R]** | 该包 `lib/` 有真实改动 | 契约经 **0.2.0 源码/类型实读**确认 |
| **[H-]** | 该包 `lib/` 相同 **且** 契约点在 0.1.7 侧不存在 | 同样的哈希推定证明 0.2.0 侧亦不存在 |
| **[?]** | 未取得证据 | 见 §6 未判定项 |

### 2.2 本轮独立复算的 `lib/` churn（验证协调者基线）

用 `t04/verify_churn.py` / `verify_named.py` 自行逐文件 sha256 复算，**与协调者 `churn-lib-017-020.txt` 完全一致**。

**A. 契约证明包（决定本报告多数结论）**

| 包 | 0.1.7→0.2.0 | 证据级别 | 本报告依赖它的哪条结论 |
|---|---|---|---|
| `dsh-client-ui-slots` | **IDENTICAL** | [H] | 全部槽位注册/注入机制未变（§1.2②） |
| `dsh-settings` | **IDENTICAL** | [H] | `SettingsForms` 导出集两版相同（§5 F-4 重写） |
| `dsh-client-ui-settings` | **IDENTICAL** | [H] | `settings.section` / `settings.general.item` 未变 |
| `dsh-client-ui-settings-plugins` | **IDENTICAL** | [H-] | `settings.plugin.item` 两版皆无（§5 F-6 重写） |
| `dsh-web` | **IDENTICAL** | [H] | `registerSearchProvider` 挂载缝未变（§9） |
| `dsh-credentials` | **IDENTICAL** | [H] | `credentialRef` 未变 |
| `dsh-launch-environment` | **IDENTICAL** | [H] | `launchEnvironmentOf` 未变 |
| `dsh-tools` | **IDENTICAL** | [H] | btw/pptmaster/workerspace/vision-adam 的 `ctx.tools` 未变 |
| `dsh-skill` / `dsh-skill-filesystem` | **IDENTICAL** | [H] | pptmaster 的 `ctx.skills` 未变 |
| `dsh-home-paths` | **IDENTICAL** | [H] | logfile/usage 的路径解析未变 |
| `dsh-tool-fs` | **IDENTICAL** | [H] | 未变 |
| `dsh-client-modules` | **IDENTICAL** | [H] | `dsh.client` 启动契约（`inject`/`immediately`）未变 |
| `dsh-plugin-manager` | **IDENTICAL** | [H] | 插件装载机制未变 |
| `dsh-user-approval` | **IDENTICAL** | [H] | workerspace 的 `ctx.approval` 未变 |
| `dsh-subprocess` | **IDENTICAL** | [H] | pptmaster/ssh-gui/workerspace 的 `ctx.subprocess` 未变 |
| `dsh-atomic-write` / `dsh-tool-web` / `dsh-tool-subagent-control` | **IDENTICAL** | [H] | 未变 |
| `dsh-tool-subagent` | **IDENTICAL** | [H] | `dsh-subagent` 命名空间的读取方未变 |
| `dsh-agent` / `dsh-session-query` / `dsh-system-prompt` | **IDENTICAL** | [H] | btw 的 `ctx.agents`/`ctx.sessionQuery`、pptmaster 的 `ctx.systemPrompt` 未变 |
| `dsh-host-webserver` | **IDENTICAL** | [H] | usage/wallpaper 的 `ctx.webServer` 未变 |
| `dsh-client-connection` | **IDENTICAL** | [H] | usage/ssh-gui/pptmaster 的 `ctx.connection` 未变 |
| `dsh-client-ui-renderer` | **IDENTICAL** | [H] | 客户端 `ctx.slots` 提供方未变 |

**B. 有真实改动的包（[R]）**

| 包 | 改动文件 | 是否影响本批插件 |
|---|---|---|
| `dsh-web-search-deepseek` | `index.js`, `types/index.d.ts`, `types/provider.d.ts` | **否** —— §9 已证伪；影响官方 provider 自身 |
| `dsh-client-ui-workspace` | `client.js` + 7 个 `.d.ts`（含 `contract/slots.d.ts`） | 槽位键集**逐项比对相同**；`remoteHosts` 两版皆无 |
| `dsh-client-ui-primitives` | `index.js` + 12 个 `.d.ts`/`.module.css` | 图标集合两版**均 98 Regular + 98 Medium、0 Outline16** |
| `dsh-client-ui-theme` | `client.js` | `getTheme`/`overrideTokens` 未变（wallpaper 用） |
| `dsh-client-ui-tool` | `client.js` | 槽位键集相同（`tool.call.toolview` 在） |
| `dsh-client-ui-chat` | `client.js`, `index.js`, + 6 `.d.ts`（add 2 新文件） | 槽位键集相同（`conversation.chat.turnTail` 在） |
| `dsh-client-ui-conversation` | `client.js` + 7 `.d.ts`（add `submission-analytics.d.ts`） | `conversationEvents` 两版皆无（F-5） |
| `dsh-subagent` | `typert.host.js` **仅声明字符串** | 否（diff 确认是 `SessionEventMap` 描述符文本） |
| `dsh-session-reference` | `typert.host.js` **仅声明字符串** | 否（同上） |

**结论**：协调者"需核"的 5 个包中，`dsh-tool-subagent-control`/`dsh-atomic-write`/`dsh-tool-web`/`dsh-user-approval`
经本轮复算 **`lib/` 逐字节相同**（协调者标注的"1 改"落在 `package.json` 版本号字符串上，符合基线 §4 末的提醒）；
`dsh-session-reference` 与 `dsh-subagent` 的 1 个改动确为 `lib/typert.host.js`，但**内容是 typert 声明描述符文本，不是代码逻辑**。

### 2.3 0.2.0 树可信度校验

本轮把独立下载树与 `full020` 做逐文件 sha256 对照，抽样 5 包 11 文件**全部 MATCH**：

```
dsh-client-ui-settings   package.json 7af787733731a1d7 == 7af787733731a1d7
dsh-client-ui-settings   lib/index.js 9c2408bebe9024bd == 9c2408bebe9024bd
dsh-client-ui-settings   lib/client.js 2ac7f186165c5a8e == 2ac7f186165c5a8e
dsh-client-ui-primitives package.json 58f30d44aa54a233 == 58f30d44aa54a233
dsh-client-ui-primitives lib/index.js 035f17661fcf8604 == 035f17661fcf8604
dsh-client-ui-slots      package.json 857f0a84910e95e7 == 857f0a84910e95e7
dsh-client-ui-slots      lib/index.js 57e1314e31a2015f == 57e1314e31a2015f
dsh-settings             package.json d2bb753425bd7708 == d2bb753425bd7708
dsh-settings             lib/index.js 9432b872597b7a31 == 9432b872597b7a31
dsh-tools                package.json 4d94a4285686e430 == 4d94a4285686e430
dsh-tools                lib/index.js 40f47709337c3c20 == 40f47709337c3c20
```

（下表的"0.1.1"列仅作历史对照，**不构成任何兼容性判定依据**。）

| 文件 | 0.2.0 | 0.1.1 |
|---|---|---|
| `dsh-client-ui-primitives/lib/index.js` | `035f17661fcf8604` | `ABSENT`（0.1.1 宿主树不含此包，用 clientpin 树） |
| `dsh-client-runtime/lib/client.js` | **包不存在** | `0bb539a48ca7cbce` |
| `dsh-client-ui-settings/lib/client.js` | `2ac7f186165c5a8e` | `d93f420e0c9caff2` |
| `dsh-settings/lib/index.js` | `9432b872597b7a31` | `18e5dd394cf88b8d` |
| `dsh-client-modules/lib/index.js` | `03ea21df556256a6` | — |
| `dsh-client-ui-renderer/lib/client.js` | `d92aaa305d566311` | — |

### 2.2 npm registry 直查（0.2.0 的包边界）

```
$ npm view @deepseek-ai/dsh-client-runtime@0.2.0-rc.1 version
npm error code E404 ... is not in this registry.
$ npm view @deepseek-ai/dsh-client-runtime versions
  ... "0.1.0-rc.8", "0.1.1-rc.1", "0.1.1-rc.2"     ← 最高 0.1.1-rc.2

$ npm view @deepseek-ai/dsh-client-schema-form versions
  ... "0.1.0-rc.6", "0.1.0-rc.7"                    ← 最高 0.1.0-rc.7，无 0.2.0

$ npm view @deepseek-ai/dsh-vision-adam
  npm error 404 Not Found                            ← 从未发布到 npm（本地自建包）
```

0.2.0 的 CLI `package.json` 依赖清单**不含** `dsh-client-runtime` / `dsh-client-schema-form`；
`grep -rl dsh-client-runtime` 遍历 0.2.0 全树仅命中 `dsh-invariants/README*.md`。

### 2.3 判定脚本（本轮自建，落盘可复跑）

全部位于 `.workspace/audit-020/t04/`：
`scan3.py`（插件契约面提取，**修正版**——首版因 `'node_modules' in root` 剪枝缺陷把 `@local` 全路径跳过，产出假阴性，已删除）、
`check_services.py` / `check_client_services.py`（服务存在性）、
`check_slots.py` / `confirm_slots.py` / `resolve_slots.py`（槽位存在性）、
`sig_compare.py`（签名对照）、`final_matrix.py`（tokens 全量矩阵）、
`plugin_members.py` / `probe_*.py`（各专项）、
`validate_tree.py`（0.2.0 树字节校验）、`freeze_evidence.py` → `evidence.txt`。

> 复跑注意：`check_services.py` 与 `check_client_services.py` 用的是"声明处 token 扫描"，
> 对本轮 30 个服务名做过逐项人工核对；其中 `settingsScope` / `conversationEvents` 的
> **消失判定**另经 `grep -rl` 全树（`*.js` + `*.d.ts`）二次确认（0 命中），不依赖该脚本。

---

## 3. 逐插件契约清单

格式：`宿主入口` / `客户端入口`；`inject` 为运行时注入的服务数组；`→` 后为 0.2.0 判定。
所有 `lib/*.js` 均为 **构建产物**（bundle），行号不适用于此，故证据以"文件 + 符号"给出。

### 3.1 `@local/dsh-btw 0.4.0-btw.1`

| 面 | 契约点 | 0.2.0 |
|---|---|---|
| package.json | `exports` 含 `.` / `./client` / `./typert` / `./remote` / `./cordis.patch.yml` | `dsh.client` 机制在 |
| `dsh.client.inject` | `dsh-client-runtime`、`dsh-api-remotes`、`dsh-client-ui-conversation`、`dsh-client-ui-layout`、`dsh-client-ui-primitives`、`dsh-client-locale`、`dsh-client-ui-settings` | **1 项消失**（client-runtime） |
| peerDeps | 18 项，全部 `<0.2.0` 上界 | 语义需重审 |
| 宿主 `inject` | `agents`,`sessions`,`attachments`,`settings`,`subagents`,`sessionQuery` | 6/6 存在 |
| 宿主 imports | `dsh-agent`,`dsh-attachment`,`dsh-llm`,`dsh-session`,`dsh-settings`,`dsh-subagent`,`dsh-tools`,`dsh-typert-protocol`,`dsh-vision-adam`,`@deepseek-ai/cordis`,`schemastery` | 均存在 |
| 宿主 settings | `settingsNamespace("dsh-btw")` + `settings.register(ns, schema)` | **消失** |
| 宿主 vision | `import("@deepseek-ai/dsh-vision-adam")` → `analyzeImageBytes`/`resolveOptions`/`resolveApiKey` | 3/3 导出均在（本机 vision-adam 0.2.0） |
| 客户端 `inject` | `slots`,`sessions`,`remote`,`locale`,`settingsScope` | `settingsScope` **消失** |
| 客户端 imports | `@deepseek-ai/dsh-client-runtime/client`（`defineStore`）、`@deepseek-ai/dsh-client-ui-layout/lib/client.js`、`@deepseek-ai/dsh-client-ui-primitives` | client-runtime **消失** |
| 客户端图标 | `primitives.IconBranchOutline16`/`IconBrowseOutline16`/`IconCloseOutline16`/`IconCodeOutline16`/`IconEditOutline16`/`IconSearchOutline16`/`IconSendOutline16`（7 个） | **7/7 消失**（F-10） |
| 客户端成员 | `slots.register`, `locale.bind/getSnapshot/register/subscribe`, `sessions.binding/list/open/openSubagent`, `remote.answer/cancel/close/listProject/listTree/read/readImage/send/setModel/sideChat/start` | 均在 |
| 槽位 | `conversation.session.header.actions`, `shell.overlay` | 2/2 存在（declarer 分别 `dsh-client-ui-conversation:…/contract/slots.d.ts:155`、`dsh-client-ui-layout:…/index.d.ts:85`） |

### 3.2 `@local/dsh-logfile 0.1.0` —— **A 类**

| 面 | 契约点 | 0.2.0 |
|---|---|---|
| package.json | 无 `dsh` 段、无 `engines`、无 peerDeps、`exports: { ".": "./lib/index.js" }` | 无契约面 |
| `inject` | 未声明 | — |
| 宿主成员 | `logger`, `settings.describe()`, `settings.documentPath`, `provide`, `effect`, `on`, `root` | **均在**（0.2.0 `SettingsForms` 公开 `describe` / `documentPath`） |
| imports | `@deepseek-ai/dsh-home-paths` | 存在 |
| 依赖 | 无客户端半；无槽位；无 settings 注册 | — |
| 附注 | `settings.describe()` 返回项在 0.2.0 为 `SettingsDescriptor`（含 `ns` 字段），`orphan-settings.js` 取 `.ns` 的用法仍成立 | 无需修改 |

### 3.3 `@local/dsh-pptmaster 0.1.0`

| 面 | 契约点 | 0.2.0 |
|---|---|---|
| package.json | `exports` `.`/`./client`/`./invariant`/`./runtime-staging`/`./pptd`/`./cordis.patch.yml` | 机制在 |
| `dsh.client.inject` | `dsh-client-connection`,`dsh-client-locale`,`dsh-client-runtime`,`dsh-client-ui-conversation`,`dsh-client-ui-tool` | **1 项消失** |
| 宿主 `inject` | `connection`,`tools`,`systemPrompt`,`skills`,`subprocess` | 5/5 存在 |
| 宿主 imports | `dsh-skill`,`dsh-tools`,`schemastery` | 均在 |
| invariant 半 | `inject = ["invariants"]` | `invariants` 存在 |
| 客户端 `inject` | `slots`,`locale`,`connection`,`conversationEvents` | `conversationEvents` **消失** |
| 客户端 imports | `@deepseek-ai/dsh-client-runtime/client`（`isAppendSurfaceEvent`）、`@deepseek-ai/dsh-client-ui-primitives` | client-runtime **消失**；替代导出在 `dsh-session/surface` 存在 |
| 客户端图标 | `primitives.IconBrowseOutline16`（3 个渲染点） | **消失**（F-10） |
| 客户端成员 | `connection.rpc`, `locale.register`, `theme.bgFillStyles/colorScheme/effectStyles/fillStyles/lineStyles/majorFont/minorFont/slice`（画布用）, `slots.register` | 均在 |
| 槽位（存在） | `conversation.chat.turnTail`（0.2.0 declarer 移至 `dsh-client-ui-chat:…/contract/slots.d.ts:272`）、`tool.call.toolview`（`dsh-client-ui-tool:…:18`） | 2/2 存在 |
| 槽位（**两版皆不存在**） | `conversation.hero.actions`、`conversation.hero.inputAccessory` | 两版全树均为 0 处声明；**非迁移回归**，是既有死注册（详见 §6 U-3） |
| 依赖 | `dsh-client-ui-slots` 内嵌 0.1.1-rc.2 副本 | 需重钉 |

### 3.4 `@local/dsh-ssh-gui 0.2.0`

| 面 | 契约点 | 0.2.0 |
|---|---|---|
| `dsh.client.inject` | `dsh-client-connection` | 存在 |
| 宿主 `inject` | `connection`,`subprocess` | 均在（`settings` 由 installSettingsSection 自注入） |
| 宿主 imports | `dsh-credentials`,`dsh-settings`,`schemastery` | 均在 |
| 宿主 settings | `settingsNamespace('dsh-ssh-gui')` + `installSettingsSection(...)` | **消失** |
| 宿主服务 | `ctx.sshRegistry`（由 `dsh-workspace-enhancement/web` 提供，**不在** 0.2.0 树内）、`ctx.credentials`（存在）、`ctx.webServer` | `sshRegistry` **未判定**（见 §7） |
| peerDeps | `dsh-workspace-enhancement 0.1.2` | 该包不在 0.2.0 官方树 |
| 客户端 `inject` | `slots`,`connection`,`sessions`,`workspaces` | 4/4 存在 |
| 客户端成员 | `connection.rpc`, `sessions.open`, `workspaces.connectWorkspace/create/remoteHosts`, `slots.register` | 均在 |
| 槽位 | `conversation.session.header.actions`（存在）、`settings.section`（存在）、**`sidebar.workspaces.remoteHosts`** | **消失**（0.1.1 declarer `dsh-client-ui-workspace:…/contract/slots.d.ts:65`；0.2.0 全树 0 命中） |

### 3.5 `@local/dsh-subagent-model 0.1.0`

| 面 | 契约点 | 0.2.0 |
|---|---|---|
| `dsh.client.inject` | `dsh-client-runtime`,`dsh-client-ui-settings` | **1 项消失**（但其客户端 bundle 实际不 require client-runtime） |
| `inject`（宿主） | `[]`（空） | — |
| 宿主 imports | `dsh-settings`,`schemastery` | 均在 |
| 宿主 settings | `settingsNamespace("dsh-subagent")` + `installSettingsSection` | **消失** |
| 客户端 `inject` | `slots`,`settingsScope` | `settingsScope` **消失** |
| 客户端成员 | `settingsScope.bind(...)` | 需改 `configForms.get(...)` |
| 槽位 | `settings.section` | 存在 |
| 语义 | 其值被 `dsh-tool-subagent` 每次派发时读取（热路由） | 命名空间键漂移会**静默失效**（见 §1.2③） |

### 3.6 `@local/dsh-usage 0.1.0`

| 面 | 契约点 | 0.2.0 |
|---|---|---|
| `dsh.client.inject` | `dsh-client-connection`,`dsh-client-ui-settings` | 均在 |
| 宿主 `inject` | `connection`,`webServer` | 均在 |
| 宿主 `ctx.inject(["timer"])` | `lib/index.js:346`（45s ingest 循环） | ✔ `timer: TimerService` 在 `cordis-plugin-timer/lib/types/index.d.ts:4` |
| 宿主 imports | `schemastery`；`lib/rpc.js` → `dsh-client-connection`；`lib/db.js`/`ingest-dsh.js` → `dsh-home-paths`；`lib/zstd.js` → `dsh-session-persistence-jsonl` | 均在 |
| 宿主 settings | `settings.register("dsh-usage", Config)` | **消失** |
| 宿主 RPC | `ctx.connection.register(ctx, '/usage', handler)`（0.1.5 起姿势） | 需实跑（见 §7） |
| 客户端 `inject` | `slots`,`connection`,`sessions`,`settingsScope` | `settingsScope` **消失** |
| 客户端成员 | `settingsScope.getSnapshot/subscribe`, `connection.rpc`, `sessions.select`, `slots.register` | 除 settingsScope 均在 |
| 槽位 | **`settings.plugin.item`** | **消失**（0.1.1 由 `dsh-client-ui-settings-plugins` 运行时声明，该包 `lib/client.js` 中 11 处；0.2.0 该包改为只声明 `settings.section` + `renderSlot("settings.plugins.tab")`，`settings.plugin.item` 仅剩 `dsh-client-ui-settings-models` 的一句注释） |
| 依赖 | `ctx.webServer` 存在 | — |

### 3.7 `@local/dsh-wallpaper 0.5.0`

| 面 | 契约点 | 0.2.0 |
|---|---|---|
| `dsh.client` | `inject: [runtime, locale, ui-theme, ui-settings]`，`immediately: true` | client-runtime **消失**；`immediately` 启动契约**仍在** |
| 宿主 `inject` | `webServer` | 存在 |
| 宿主 imports | `dsh-settings`,`schemastery` | 均在 |
| 宿主 settings | `settingsNamespace("wallpaper")` + `settings.register` | **消失** |
| 客户端 `inject` | `slots`,`locale`,`theme`,`settingsScope`,`sessions` | `settingsScope` **消失** |
| 客户端 imports | `@deepseek-ai/dsh-client-runtime/client`（`defineStore`）、`react`,`react/jsx-runtime` | client-runtime **消失** |
| 客户端成员 | `theme.getTheme/overrideTokens`, `locale.register`, `sessions.list`, `slots.register` | 均在（`overrideTokens(source, tokens)` 签名逐字未变） |
| 槽位 | `settings.general.item` | 存在（declarer `dsh-client-ui-settings:…/contract/slots.d.ts:120`） |
| 资产路由 | `/dsh-wallpaper/media` 自有路由 | 不受影响 |

### 3.8 `@local/dsh-web-search-sse 0.1.0` —— **D 类：迁移前置阻塞（部署面）**

> **详细核验见 §9（协调者指定的首要重点）。** 本表只列契约面。

| 面 | 契约点 | 0.1.7→0.2.0 |
|---|---|---|
| package.json | `exports` 仅 `.`，无 `dsh` 段 → **无客户端半**；peerDeps: `cordis`,`dsh-credentials`,`dsh-launch-environment`,`dsh-settings`,`dsh-web` | — |
| 宿主 `inject` | `web` | [H] `dsh-web` 逐字节相同 |
| 宿主 imports（实读） | `WebError`←`dsh-web`；`credentialRef`←`dsh-credentials`；`launchEnvironmentOf`←`dsh-launch-environment`；`z`←`schemastery` | **四者全在**（§9.3） |
| ~~`dsh-settings` import~~ | **仅现役 3080 的坏副本有**（`installSettingsSection`,`settingsNamespace`）；`5947d090…` 修复副本已删除该 import | 两版都不存在该符号（§9.4） |
| 挂载缝 | `ctx.web.registerSearchProvider(new SseSearchProvider(...))` | [H] 签名未变 |
| 配置读取 | 修复副本用 `config.X.get()`（7 处） | [H] 与 0.2.0 官方同一惯用法 |
| provider id | `deepseek-sse`；经 `web` 行 config `searchProvider: deepseek-sse` 选中 | 未变 |
| **部署态** | 3080 副本 `88d6387e351af5a6` **坏**；3097/仓内 5+ 处副本 `5947d09095507cff` **已修** | **本次迁移须换用修复副本** |
| 命名空间键 | 注册名 `web-search-deepseek-sse` vs entry id `web-search-sse` | **漂移**，见 §1.4 |

### 3.9 `@local/dsh-workerspace 0.1.0` —— **B 类**

| 面 | 契约点 | 0.1.7→0.2.0 | 证据 |
|---|---|---|---|
| package.json | `exports` 仅 `.`，无 `dsh` 段 → **无客户端半**；`engines.node >=22.0.0` | — | — |
| 宿主 `inject` | `tools`,`systemPrompt`,`subprocess` | 均在 | [H] `dsh-tools`/`dsh-system-prompt`/`dsh-subprocess` 全部逐字节相同 |
| 宿主 imports | `dsh-credentials`,`dsh-home-paths`,`dsh-tools`,`schemastery` | 均在 | [H] 逐字节相同 |
| 宿主服务 | `ctx.approval`,`ctx.subprocess`,`ctx.fs` | 均在 | [H] `dsh-user-approval`/`dsh-subprocess`/`dsh-fs` 逐字节相同 |
| **宿主 settings** | `import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings"`（各 2 处）+ `installSettingsSection(ctx, WS_SETTINGS_NAMESPACE, Config, config, {...})` | **两版都不存在该符号** | 实测：`lib/index.js:…` import 行 + 2 处调用；`dsh-settings` [H] 导出仅 `{SettingsConflictError, SettingsForms, redactSecrets}` |
| 修复 | 同 §9.5 范式（删 import → 字段加 `.volatile()` → 命名空间字面量 → `config.X.get()`） | 低难度 | — |
| 依赖 | 无槽位、无客户端半 | — | — |
| 键漂移影响 | `~/.dsh/settings.yaml` 的 `dsh-workerspace: {}` 为**空段** ⇒ §1.4 漂移的**配置迁移影响为零** | — | — |

### 3.10 `@deepseek-ai/dsh-vision-adam 0.2.0`（本地识图插件）

| 面 | 契约点 | 0.2.0 |
|---|---|---|
| 版本 | `0.2.0`（本地版本号，非 npm 版本） | — |
| `dsh.client.inject` | `dsh-client-runtime`,`dsh-client-ui-settings` | **1 项消失** |
| 客户端 bundle | `lib/client.js` 仅 `require("react")`；`dsh-client-runtime` 出现 **0 次** | 实际不受影响，但 `inject` 声明陈旧 |
| 宿主 imports | `dsh-credentials`,`dsh-launch-environment`,`dsh-settings`,`dsh-tools`,`schemastery` | 均在 |
| 宿主 `ctx.*` | `fs`,`get`,`systemPrompt`,`tools`,`emit` | 均在 |
| 宿主导出 | `analyzeImageBytes`,`resolveOptions`,`resolveApiKey`,`apply`,`inject`,`name`,`Config`,`VISION_ADAM_SETTINGS_NAMESPACE` | 3/3（btw 所需）+ 其余均在 |
| 宿主 settings | 含 `VISION_ADAM_SETTINGS_NAMESPACE` → 同一 `ctx.settings` 迁移问题 | **消失** |

### 3.11 `dsh-workspace-enhancement 0.1.2`（隔离侧本地插件）

| 面 | 契约点 | 0.2.0 |
|---|---|---|
| 存在性 | 仅存在于 `~/.dsh-017/profiles/node_modules/`；0.2.0 完整树中**不存在** | 非官方包，需自行迁移 |
| 对外契约 | 向 `dsh-ssh-gui` 提供 `ctx.sshRegistry`，并由 profile patch 行 `ssh-web-channel` 挂载 | **未判定**（未逐读其源码） |
| 判定 | 依赖它的 `dsh-ssh-gui` 是本地核心 GUI 插件；二者在 0.2.0 同为树外包 | **C 类：需重写或退役**（依据：核心服务提供关系需在 0.2.0 客户端/宿主服务表重建，且 0.2.0 已把 `sessions`/`workspaces`/`connection` 全部搬入 `dsh-api-*` / `dsh-client-*` 控制器层，原 seam 需重新对位） |

---

## 4. 兼容矩阵

图例：`✔` 在 0.1.7 与 0.2.0 **均存在**且签名未变 ｜ `△` 存在但归属/签名未逐字比对 ｜ `✘` **两版均不存在** ｜ `?` 未判定

> **⚠️ 本矩阵的 `✘` 一律不是 0.2.0 新增**。经 §2.2 的 `lib/` 哈希复算与两版全树 grep 确认：
> 所有 `✘` 契约点（`dsh-client-runtime`、`settingsScope`、`conversationEvents`、
> `installSettingsSection`/`settingsNamespace`、`settings.plugin.item`、`sidebar.workspaces.remoteHosts`、
> `Icon*Outline16`）在 **0.1.7-rc.2 就已经不存在**。它们必须在本次迁移中清偿，但**归因属于 0.1.1→0.1.7**。
> 每格依据级别见 §2.1b；`[H]` 格由包级 `lib/` 逐字节相同推出，`[R]` 格为 0.2.0 源码实读。

### 4.1 宿主侧（host half）

| 契约点 | btw | logfile | pptmaster | ssh-gui | subagent-model | usage | wallpaper | web-search-sse | workerspace | vision-adam |
|---|---|---|---|---|---|---|---|---|---|---|
| `ctx.effect/get/inject/on` (cordis) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `ctx.logger` | — | ✔ | — | — | — | ✔ | — | — | — | — |
| `ctx.provide` | — | ✔ | — | — | — | — | — | — | — | — |
| `ctx.tools` | ✔ | — | ✔ | — | — | — | — | — | ✔ | ✔ |
| `ctx.agents` | ✔ | — | — | — | — | — | — | — | — | — |
| `ctx.sessions` | ✔ | — | ✔ | — | — | — | — | — | — | — |
| `ctx.attachments` | ✔ | — | — | — | — | — | — | — | — | — |
| `ctx.subagents` | ✔ | — | — | — | — | — | — | — | — | — |
| `ctx.sessionQuery` | ✔ | — | — | — | — | — | — | — | — | — |
| `ctx.connection` | — | — | ✔ | ✔ | — | ✔ | — | — | — | — |
| `ctx.webServer` | — | — | — | — | — | ✔ | ✔ | — | — | — |
| `ctx.systemPrompt` | — | — | ✔ | — | — | — | — | — | ✔ | ✔ |
| `ctx.skills` | — | — | ✔ | — | — | — | — | — | — | — |
| `ctx.subprocess` | — | — | ✔ | ✔ | — | — | — | — | ✔ | — |
| `ctx.invariants` | — | — | ✔ | — | — | — | — | — | — | — |
| `ctx.credentials` | — | — | — | ✔ | — | — | — | — | — | ✔ |
| `ctx.approval` | — | — | — | — | — | — | — | — | ✔ | — |
| `ctx.web` | — | — | — | — | — | — | — | ✔ | — | — |
| `ctx.fs` | — | — | — | — | — | — | — | — | ✔ | ✔ |
| `timer` 服务（经 `ctx.inject(["timer"])`） | — | — | — | — | — | ✔ | — | — | — | — |
| `settingsNamespace()` | ✘ | n/a | — | ✘ | ✘ | — | ✘ | ✘ | ✘ | ✘ |
| `ctx.settings.register()` | ✘ | n/a | — | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ |
| `installSettingsSection()` | — | n/a | — | ✘ | ✘ | — | — | ✘ | ✘ | — |
| `ctx.settings.describe()` | — | ✔ | — | — | — | — | — | — | — | — |
| `ctx.settings.documentPath` | — | ✔ | — | — | — | — | — | — | — | — |
| `import dsh-vision-adam` 3 导出 | ✔ | — | — | — | — | — | — | — | — | 本体 |
| `ctx.sshRegistry` | — | — | — | **?** | — | — | — | — | — | — |
| RPC 通道名 (`/btw` `/usage` `/ssh` …) | ? | — | ? | ? | — | ? | — | — | — | — |

### 4.2 客户端侧（client half）

| 契约点 | btw | pptmaster | ssh-gui | subagent-model | usage | wallpaper |
|---|---|---|---|---|---|---|
| `@deepseek-ai/dsh-client-runtime/client` | **✘** | **✘** | n/a | n/a | n/a | **✘** |
| `dsh.client.inject` 启动契约 | △ | △ | ✔ | △ | ✔ | △ |
| `dsh.client.immediately` | — | — | — | — | — | ✔ |
| `ctx.slots.register(...)` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `ctx.slots.inject(...)` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| register 选项 `id/order/label/key/priority/select` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `ctx.locale.register/bind` | ✔ | ✔ | — | — | — | ✔ |
| `ctx.theme.getTheme/overrideTokens` | — | ✔ | — | — | — | ✔ |
| `ctx.sessions.*` | ✔ | — | ✔ | — | ✔ | ✔ |
| `ctx.remote.*` | ✔ | — | — | — | — | — |
| `ctx.workspaces.*` | — | — | ✔ | — | — | — |
| `ctx.connection.rpc` | — | ✔ | ✔ | — | ✔ | — |
| `ctx.settingsScope` | **✘** | — | — | **✘** | **✘** | **✘** |
| `ctx.conversationEvents` | — | **✘** | — | — | — | — |
| `@deepseek-ai/dsh-client-ui-primitives` | ✔ | ✔ | — | — | — | — |
| **`Icon*Outline16` 图标名** | **✘(7个)** | **✘(1个)** | — | — | — | — |
| 槽位 `shell.overlay` | ✔ | — | — | — | — | — |
| 槽位 `conversation.session.header.actions` | ✔ | — | ✔ | — | — | — |
| 槽位 `conversation.chat.turnTail` | — | △ | — | — | — | — |
| 槽位 `tool.call.toolview` | — | ✔ | — | — | — | — |
| 槽位 `conversation.hero.actions` | — | ✘(两版皆无) | — | — | — | — |
| 槽位 `conversation.hero.inputAccessory` | — | ✘(两版皆无) | — | — | — | — |
| 槽位 `settings.section` | — | — | ✔ | ✔ | — | — |
| 槽位 `settings.general.item` | — | — | — | — | — | ✔ |
| 槽位 `settings.plugin.item` | — | — | — | — | **✘** | — |
| 槽位 `sidebar.workspaces.remoteHosts` | — | — | **✘** | — | — | — |
| `data-turn-tail` 属性 | — | — | — | — | — | — |

### 4.3 图标集合：`Icon*Outline16` —— **退役发生在 0.1.1→0.1.7，不是 0.2.0**（重锚后）

| 树 | `dsh-client-ui-primitives/lib/index.js` | 版本 | `Icon*Outline16` | `Icon*OutlineRegular` | `Icon*OutlineMedium` |
|---|---|---|---|---|---|
| `@local/dsh-pptmaster/node_modules/…`（插件内嵌） | 288 921 B | **0.1.1-rc.2** | **42** | 0 | 0 |
| `.npm-global-dsh017/…` | 522 894 B | **0.1.7-rc.2** | **0** | **98** | **98** |
| `.workspace/audit-020/t30/full020/…` | 525 728 B | **0.2.0-rc.1** | **0** | **98** | **98** |

**⇒ 图标名集合在 0.1.7 与 0.2.0 之间完全一致（[H] 侧证明：两者均为 98 Regular + 98 Medium、0 Outline16）。**
退役是 **0.1.1→0.1.7** 这一步发生的；0.2.0 未再改动图标集合（`lib/index.js` 有 13 文件 churn，但看图标名集合的结论是"两版相同"）。

- 0.1.1 的 42 个 `Icon*Outline16`（列举 40 个）：`IconAgentPresetOutline16`, `IconBranchOutline16`, `IconBrowseOutline16`, `IconCheckOutline16`, `IconCloseOutline16`, `IconCodeOutline16`, `IconCopyOutline16`, `IconDarkOutline16`, `IconDataOutline16`, `IconDislikeOutline16`, `IconDownloadOutline16`, `IconEditOutline16`, `IconEllipsisOutline16`, `IconEnhanceOutline16`, `IconFolderOpenOutline16`, `IconFollowsystemOutline16`, `IconFullscreenOutline16`, `IconGoalOutline16`, `IconLightOutline16`, `IconLikeOutline16`, `IconLinkOutline16`, `IconListPenOutline16`, `IconLoadingOutline16`, `IconNewChatOutline16`, `IconPanelLeftOutline16`, `IconPaperclipOutline16`, `IconPauseOutline16`, `IconPersonalizationOutline16`, `IconPlayOutline16`, `IconPlusOutline16`, `IconProjectAddOutline16`, `IconRefreshOutline16`, `IconRightUpOutline16`, `IconSearchOutline16`, `IconSendOutline16`, `IconSettingsOutline16`, `IconShareOutline16`, `IconSkillOutline16`, `IconThinkOutline16`, `IconTrashOutline16`
- **本轮扫描结论（已修正并重锚）**：`dsh-btw` 自有 `client.js` 引用 **7 个**（`IconBranchOutline16`/`IconBrowseOutline16`/`IconCloseOutline16`/`IconCodeOutline16`/`IconEditOutline16`/`IconSearchOutline16`/`IconSendOutline16`），`dsh-pptmaster` 引用 **1 个**（`IconBrowseOutline16`，3 个渲染点）。
  逐版验证：这 8 个名字在 **0.1.1 有**、在 **0.1.7 与 0.2.0 都没有**。
  ⇒ **这两个插件在 0.1.7 上就已经是坏的**（渲染到这些节点时抛 `TypeError`），并非 0.2.0 引入。
- 8 个名字在 0.1.7/0.2.0 均有 `*Regular` / `*Medium` 直系替代（§9.7）。
- **本轮自身纠错**：初版扫描报告的"无引用"是脚本缺陷所致（用 `'node_modules' in root` 剪枝，误把 `@local` 全路径跳过）。修正后同时重跑了 `ctx.*` / `imports` 提取。
- **二次纠错**：初版把该退役归因于 0.2.0（因基准取 0.1.1）。重锚到 0.1.7 后归因改为 0.1.1→0.1.7。

---

## 5. 不兼容点与最小修复

> 修复难度：**低** = 改字面量/导入路径；**中** = 需改写一段逻辑并自测；**高** = 需重新设计数据流。
> 风险：**低** = 影响面局限在单插件；**中** = 涉及配置持久化或跨插件契约；**高** = 影响现网配置或热路由。

### F-1 `dsh-client-runtime/client` 消失（**归因：0.1.1→0.1.7，非 0.2.0**；3 插件）

| 项 | 内容 |
|---|---|
| 证据 | `npm view …/dsh-client-runtime versions` 最高 `0.1.1-rc.2`；0.2.0 全树 `grep -rl dsh-client-runtime` 仅命中 `dsh-invariants/README*.md`；3 个插件 `lib/client.js` 各 1 处 `require("@deepseek-ai/dsh-client-runtime/client")` |
| 受影响符号 | `defineStore`（`dsh-btw`、`dsh-wallpaper`）、`isAppendSurfaceEvent`（`dsh-pptmaster`） |
| 0.2.0 替代 | `defineStore` → `@deepseek-ai/dsh-client-store`（0.2.0 `lib/types/index.d.ts` 导出 `defineStore`，`dsh-client-store/lib/index.js` 已确认；40 个 0.2.0 客户端 bundle require 它）<br>`isAppendSurfaceEvent` → `@deepseek-ai/dsh-session/surface`（`dsh-session/package.json` `exports` 含 `./surface`；亦经 `dsh-api-session-controller` 再导出） |
| 最小修复 | 1) 改 `lib/client.js` 中的 require 说明符（无构建链的手写 bundle 直接可改）。<br>2) 改 `package.json` 的 `dsh.client.inject`：删 `@deepseek-ai/dsh-client-runtime`，加 `@deepseek-ai/dsh-client-store`（btw/wallpaper）或 `@deepseek-ai/dsh-session`（pptmaster）；`peerDependencies` 同步。<br>3) 若走构建链，改源 `src/client/*` 的 import 后重建。 |
| 难度 / 风险 | **低 / 低** —— 符号语义未变（`defineStore` 在两个包中是同一族 `createSnapshotStore`/`shallowEqual` 的同伴导出） |

### F-2 `ctx.settingsScope` 消失（4 插件客户端）

| 项 | 内容 |
|---|---|
| 证据 | 0.2.0 全树（`*.js` + `*.d.ts`）`grep -rl settingsScope` → **0 命中**；0.1.1 由 `dsh-client-ui-settings/lib/types/client/settings-scope.d.ts:86` 声明 `settingsScope: SettingsScopeBinder` |
| 0.2.0 替代 | `ctx.settings`（**宿主侧** `SettingsForms`）与 `ctx.configForms`（**客户端** `ConfigForms`，`dsh-client-ui-settings/lib/types/client/config-form.d.ts`）。`ConfigFormController` 的成员与旧 `SettingsScopeController` **逐字同构**：`getSnapshot()` / `subscribe(fn)` / `set(field, value)` / `unset(field)`；差异是取用入口由 `settingsScope.bind(spec)` 变为 `configForms.get(spec)`，且 `spec` 由 `SettingsScopeSpec` 改称 `ConfigFormSpec`（字段仍是 `{ namespace, decode? }`） |
| 最小修复 | 1) `inject` 数组：`"settingsScope"` → `"configForms"`。<br>2) 调用点：`ctx.settingsScope.bind({namespace: NS, …})` → `ctx.configForms.get({namespace: NS, …})`；消费侧成员名不变。<br>3) `dsh-usage` 用到的 `settingsScope.getSnapshot()/subscribe()` 对应 `ConfigForm.getSnapshot()/subscribe()`。 |
| 难度 / 风险 | **中 / 中** —— 需确认 `configForms` 需要 `@deepseek-ai/dsh-client-ui-settings` 先激活（同类依赖已在 `dsh.client.inject` 里），且**命名空间键必须按 §F-3 一并改对**，否则读到空值 |

### F-3 设置命名空间键从"注册名"改为"Loader entry id"（7 插件，静默）

| 项 | 内容 |
|---|---|
| 证据 | 0.2.0 `dsh-settings/lib/types/index.d.ts`：`SettingsForms.schema(entry)` = `entry.fiber?.runtime?.Config`；`dsh-llm-pi-ai/lib/index.js` 明写 `const settingsNs = ctx.fiber.entry?.options.id ?? NS`；`SettingsForms` 无 `register`，只剩 `configure(presentation, owner?)`（仅控制自动页面策略） |
| 对照 | 见 §1.2③ 表格——现网 entry id 与 `settings.yaml` 段名有 5 处不一致 |
| 最小修复 | 两条路，择一：<br>**(a) 改 entry id 与文档段名对齐**（改 profile patch，不动插件逻辑）：`wallpaper`→需 `wallpaper`（已对齐）；`usage`→`dsh-usage`；`btw`→`dsh-btw`；`ssh-gui`→`dsh-ssh-gui`；`workerspace`→`dsh-workerspace`；`dsh-subagent-model`→`dsh-subagent`；`web-search-sse`→`web-search-deepseek-sse`。**entry id 变更会同时影响行序/引用，需核 patch 内是否有其他行按 id 引用。**<br>**(b) 保留 entry id，把 `settings.yaml` 段名改成新 id**，并接受配置一次性迁移。<br>推荐 (a)，因为它保住现网配置且不动插件逻辑；但 `dsh-subagent-model` 的 `dsh-subagent:` 段必须逐字保留（它是子代理热路由的**唯一**入口）。 |
| 难度 / 风险 | **中 / 高** —— 静默失效：段读不到不会报错，只会退回 composition base/默认值。`dsh-subagent-model` 失效会导致子代理静默回到 preset 路由 |

### F-4 `installSettingsSection()` / `settingsNamespace()` 与 `SettingsProvider.register()` 消失（7 插件宿主）

| 项 | 内容 |
|---|---|
| 证据 | 0.2.0 `dsh-settings/lib/index.js` 末尾导出 `{ SettingsConflictError, SettingsForms, SettingsForms as default, redactSecrets }`；0.1.1 末行导出含 `installSettingsSection, settingsNamespace, SettingsProvider, deepEqualJson`。0.2.0 `lib/types/index.d.ts` 无 `SettingsRegisterOptions`/`SettingsSectionHooks`/`SettingsApplies`/`SettingsScope` |
| 受影响 | `dsh-btw`、`dsh-ssh-gui`、`dsh-subagent-model`、`dsh-usage`、`dsh-wallpaper`、`dsh-web-search-sse`、`dsh-workerspace` |
| 最小修复 | 逐一改写为自己的"读 Config"逻辑：0.2.0 里插件的配置来源是**自身 `Config`（schemastery）+ Loader entry config**，`apply(ctx, config)` 的 `config` 即活值（见 `dsh-agent-default-model`：`this.config.provider.get()`）。因此：<br>1) 删掉 `settingsNamespace()` / `installSettingsSection()` 调用与 `settings.register()`；<br>2) 在 `apply(ctx, config)` 里直接持有 `config`（0.2.0 的 `config` 字段是**活 source**，用 `config.xxx.get()` 读）；<br>3) 需要"文档覆盖 composition base"语义时，改为在自己的 `Config` 上声明字段并让 Loader entry config 提供 base；<br>4) 若仍需自动生成设置页，调 `ctx.settings.configure({auto: true})`（默认即 `auto: true`，显式 `configure({auto:false})` 表示自绘页面——0.2.0 官方插件普遍用 `auto:false`）。<br>5) `lib/orphan-settings.js`（仅 `dsh-logfile` 用）不需改。 |
| 难度 / 风险 | **中 / 高** —— 这是本批**最重**的修订；语义从"插件运行时注册命名空间"变成"Loader entry 即命名空间"，涉及配置读写路径重排 |

### F-5 `ctx.conversationEvents` 消失（`dsh-pptmaster` 客户端，1 处）

| 项 | 内容 |
|---|---|
| 证据 | 0.2.0 全树 `grep -rl conversationEvents` → 0 命中；0.1.1 `dsh-client-runtime/lib/types/client/index.d.ts:111` 声明 `conversationEvents: ConversationEventRegistry` |
| 0.2.0 替代 | `ConversationEventRegistry` 类**原样迁移**到 `@deepseek-ai/dsh-client-ui-conversation/lib/types/client/conversation/event-registry.d.ts`（`register`/`registerFallback`/`fallbackEntry` 签名逐字未变，仅去掉 `constructor(ctx)`）；挂载点为 `ctx.uiConversation.events`（`dsh-client-ui-conversation/lib/types/client/index.d.ts` 的 Context 增补：`uiConversation: UiConversation`；`conversation/assembly.d.ts:40` `readonly events: ConversationEventRegistry`） |
| 最小修复 | `inject`：`"conversationEvents"` → `"uiConversation"`；调用点 `ctx.conversationEvents.register(def)` → `ctx.uiConversation.events.register(def)` |
| 难度 / 风险 | **低 / 低** —— 插件只用了 `.register` |

### F-6 槽位 `settings.plugin.item` 消失（`dsh-usage` 客户端）

| 项 | 内容 |
|---|---|
| 证据 | 0.1.1 `dsh-client-ui-settings-plugins/lib/client.js` 内 11 处（含 `renderSlot("settings.plugin.item", …)` 与 `ctx.slots.subscribe("settings.plugin.item", …)`）；0.2.0 同包 `settings.plugin.item` 出现 **0** 次，只声明 `settings.section` 且 `renderSlot` 只调 `settings.plugins.tab`。0.2.0 全树对该 slot 仅剩 `dsh-client-ui-settings-models/lib/types/client/slot-contract.d.ts:11` 的一句注释（"keying on the namespace follows `settings.plugin.item`"） |
| 语义差异 | 0.1.1 的 `settings.plugin.item` 是 **keyed**（键=命名空间），供插件为"我自己的设置命名空间"挂一张卡；0.2.0 改由 `settings.plugins.tab`（**list**，键=行 id）+ 表单自动投影承担。`settings.plugins.tab` 在两版均存在（0.1.1 `dsh-client-ui-settings:…/slots.d.ts:80`；0.2.0 同文件 `:86`） |
| 最小修复 | 把卡片改为注册进 `settings.plugins.tab`（`kind:'list'`，用 `id`+`order`+`label` 取代 `key`），或直接退役该卡片——0.2.0 的配置表单会自动为受管命名空间生成页面，自绘卡片的必要性下降 |
| 难度 / 风险 | **中 / 低** —— 消息契约从 keyed 变 list，卡片组件 props 需重取 |

### F-7 槽位 `sidebar.workspaces.remoteHosts` 消失（`dsh-ssh-gui` 客户端）

| 项 | 内容 |
|---|---|
| 证据 | 0.1.1 declarer `dsh-client-ui-workspace/lib/types/client/contract/slots.d.ts:65`，且 `lib/client.js:2013` `renderSlot("sidebar.workspaces.remoteHosts", {})`、`:2440` 声明表；0.2.0 `dsh-client-ui-workspace` 全树（`.d.ts`+`.js`）对该串 **0 命中** |
| 行为 | 因为 `ctx.slots.inject(key, cb)` 的语义是"该 key 被声明时同步执行 cb，否则不执行"（0.2.0 `dsh-client-ui-renderer/lib/types/client/registry.d.ts` 保留 `inject`），所以 0.2.0 下**不抛错、静默不挂载**——远端主机入口从侧栏消失 |
| 最小修复 | 二选一：<br>(a) 迁到仍存在的邻近席位（`dsh-client-ui-sidebar`/`sidebarRight` 或 `uiWorkspace` 服务的导航扩展面）；<br>(b) 用 0.2.0 的 `dsh-client-ui-sidebar-right` 标签注册接续远端主机面板。<br>**需先确定 0.2.0 侧栏的等位扩展点**——本轮未逐读 `dsh-client-ui-sidebar*` 的 SlotMap 全表，见 §6 U-2 |
| 难度 / 风险 | **中 / 中** —— 影响本地 SSH/串口 GUI 的可达入口 |

### F-8 `conversation.hero.actions` / `conversation.hero.inputAccessory` —— **两版皆无，非迁移回归**

| 项 | 内容 |
|---|---|
| 证据 | 0.1.1 与 0.2.0 全树对 `hero.actions` / `hero.inputAccessory` / `inputAccessory` 均 **0 命中**；两版 `conversation.hero.*` 实际只有 `agentPreset` / `brand.mark` / `workspace` / `workspace.directoryFlow` |
| 行为 | `dsh-pptmaster` 的 `ctx.slots.inject("conversation.hero.actions", …)` 因声明永不到达 ⇒ cb 永不执行 ⇒ **两版都是死注册**（不报错、不渲染）。`slots.register` 对未声明槽位会 `throw new Error('slot "…" is not declared …')`，故若哪天被激活反而会报错 |
| 最小修复 | 与 0.2.0 迁移**无关**，可不改；若要恢复该 UI，需先确认目标宿主槽位真名（`conversation.hero.workspace.directoryFlow` 等）再重指 |
| 难度 / 风险 | **低 / 低**（且不属于迁移范围） |

### F-9 陈旧 `dsh.client.inject` 声明（`dsh-vision-adam`、`dsh-subagent-model` 等）

| 项 | 内容 |
|---|---|
| 证据 | `dsh-vision-adam/package.json` `dsh.client.inject = ["@deepseek-ai/dsh-client-runtime", "@deepseek-ai/dsh-client-ui-settings"]`，但其 `lib/client.js`（11 604 B）只 `require("react")`，`dsh-client-runtime` 出现 0 次；`dsh-subagent-model` 同形 |
| 判定 | 0.2.0 的 `dsh.client` 解析器只读 `dsh.client.inject` 与 `dsh.client.external`（`dsh-client-modules/lib/index.js` 中 `"dsh.client.inject"` / `"dsh.client.external"` 为仅有的两个受支持键），`external` 指向未知包才报错；`inject` 是"信息性依赖边"（`WebBootEntry`/`BootPluginRow` 注释：*informational*） |
| 最小修复 | 从 `inject` 中删掉 `@deepseek-ai/dsh-client-runtime`（换 `@deepseek-ai/dsh-client-store` 或直接删） |
| 难度 / 风险 | **低 / 未判定** —— 见 §6 U-1：`inject` 是否参与启动期硬校验本轮未取得 0.2.0 的解析器分支证据 |

### F-10 `Icon*Outline16` 图标族退役（**归因：0.1.1→0.1.7，非 0.2.0**；2 插件）

| 项 | 内容 |
|---|---|
| 证据 | 见 §4.3：0.1.1 有 42 个 `Icon*Outline16`；**0.1.7 为 0（98 Regular + 98 Medium）**；0.2.0 同 0.1.7 |
| **归因修正** | 第 1 版归因于 0.2.0（基准取 0.1.1）。重锚后：**退役发生在 0.1.1→0.1.7**，0.2.0 未再改图标集合 ⇒ 属**未清偿的 0.1.7 债** |
| **实际命中** | `dsh-btw/lib/client.js`（365 269 B）引用 **7 个**：`IconBranchOutline16`、`IconBrowseOutline16`、`IconCloseOutline16`、`IconCodeOutline16`、`IconEditOutline16`、`IconSearchOutline16`、`IconSendOutline16`；`dsh-pptmaster/lib/client.js`（4 096 057 B）引用 **1 个**：`IconBrowseOutline16` |
| 引用形态 | 均为 `_deepseek_ai_dsh_client_ui_primitives.IconXOutline16` 属性访问，例如<br>`jsx(_deepseek_ai_dsh_client_ui_primitives.IconBrowseOutline16, { size: 14 })` |
| 故障形态 | 0.1.7 与 0.2.0 下该属性均为 `undefined`，作为 JSX 组件渲染时抛 `TypeError`（不是加载期报错，而是**渲染该节点时**报错）⇒ **这两个插件在 0.1.7 上已经是坏的** |
| 替代 | 8 个名字在 **0.1.7 与 0.2.0 均**有直系替代（逐个确认 `*Regular` 与 `*Medium` 都在）：`IconBranchOutline`、`IconBrowseOutline`、`IconCloseOutline`、`IconCodeOutline`、`IconEditOutline`、`IconSearchOutline`、`IconSendOutline`、`IconLoadingOutline` | 
| 最小修复 | 机械改名：`X Outline16` → `X OutlineRegular`（常规）或 `X OutlineMedium`（强调态，1.3px 描边）。<br>1) `dsh-btw`：改 `lib/client.js` 7 处 + 源 `src/client/SideChatButton.tsx`（`IconBranchOutline16`）与 `src/client/SideChatSurface.tsx`（`IconSendOutline16`）后重建；测试夹具 `tests/*.spec.tsx`（3 文件，含 `IconLoadingOutline16`）同步改。<br>2) `dsh-pptmaster`：改 `lib/client.js` 1 处（3 个渲染点共用该符号）。<br>**同一份改名对 0.1.7 与 0.2.0 都成立**（两版图标集合完全一致）⇒ 可一次改完同时兼容。 |
| 难度 / 风险 | **低 / 低** —— 纯符号改名，无几何/布局重排；`IconProps`（`{ size?: number; className?: string }`）逐字未变，`size` 参数可原样保留 |
| 附注 | `dsh-btw/docs/**` 与 `tests/**` 中的 `IconLoadingOutline16` 是源码/夹具引用，不在 bundle 内，但**若走重建路径会一并编译失败** |

**本轮自身纠错记录**：首版报告曾判定"本批插件无 `Icon*Outline16` 引用"——那是因为初版扫描脚本用 `'node_modules' in root` 作为剪枝条件，把路径中含 `node_modules` 段的所有文件（含 `@local` 下的全部插件）都跳过了。修正后的扫描（仅剪枝目录名恰为 `node_modules` 的子树）得出上表结果。**该缺陷同时影响过 `ctx.*`/`imports` 提取，已随 `scan3.py` 一并修正并重跑。**

### F-11 `data-turn-tail` 属性

| 项 | 内容 |
|---|---|
| 证据 | `grep -rl "data-turn-tail" ~/.dsh/profiles/node_modules/@local/` 唯一命中 `dsh-pptmaster/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js`——即**内嵌的 0.1.1 依赖副本**，不是 pptmaster 自己的代码 |
| 判定 | pptmaster 自身不写该属性；它只注册 `conversation.chat.turnTail` 槽位（该槽位 0.2.0 存在，declarer 迁到 `dsh-client-ui-chat:…/contract/slots.d.ts:272`） |
| 结论 | **无需修改**（作为独立契约点） |

---

## 6. 未判定项与如何判定

| ID | 未判定内容 | 为什么未判定 | 如何判定（建议命令/方法） |
|---|---|---|---|
| **U-1** | 0.2.0 启动期是否对 `dsh.client.inject` 里指向**不存在包**的条目做硬校验 | 本轮只读到 `dsh-client-modules` 对 `external` 的校验与对 `inject` 的"信息性"注释（`lib/types/client/manifest.d.ts`），未逐行读 `lib/index.js` 的 `inject` 消费分支 | `grep -n "inject" .workspace/audit-020/t30/full020/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js` 并读 `orderByModuleGraph` 全文；或在隔离 0.2.0 组合里临时插一个带陈旧 inject 的哑包，看 `/plugins/<id>/client.js` 是否仍被服务 |
| **U-2** | 0.2.0 侧栏/工作区导航中 `sidebar.workspaces.remoteHosts` 的等位替代席位 | 本轮只确认该 key 消失，未通读 `dsh-client-ui-sidebar*`（5 个包）的 SlotMap 全表 | `python3 .workspace/audit-020/t04/check_slots.py` 扩表后重跑；或 `grep -rn "'sidebar\." .workspace/audit-020/t30/full020/node_modules/@deepseek-ai/dsh-client-ui-sidebar*/lib/types/` |
| **U-3** | `conversation.hero.actions` / `.inputAccessory` 是否曾由**树外**插件在现网声明 | 扫描范围是 0.1.1 CLI 树 + 插件内嵌 `@deepseek-ai` 副本；未审计 `workbuddy-reverse-proxy/_migration/**` 等其他树外客户端包 | `grep -rn "conversation.hero.actions" /home/CNS2026495165/dsh --include=*.js --include=*.ts -l`（排除 node_modules 巨型目录），并核对现网 `/plugins/` 客户端 roster |
| **U-4** | 各插件 RPC 通道名在 0.2.0 是否仍可用（`/btw`、`/usage`、`/ssh*`、pptmaster 通道） | `ctx.connection.rpc` 访问器两版均在（`rpc-host.d.ts` `get rpc(): HostConnectionRpc`），通道注册/鉴权语义未逐读 | 隔离 0.2.0 组合里实跑各插件，或比对 0.1.1/0.2.0 `dsh-client-connection/lib/types/rpc-host.d.ts` 与 `dsh-api-gateway` 的注册校验 |
| **U-5** | `ctx.sshRegistry`（`dsh-workspace-enhancement` 提供给 `dsh-ssh-gui`）在 0.2.0 的服务表位置 | 该包不在 0.2.0 树内，且本轮未读其源码 | 读 `~/.dsh-017/profiles/node_modules/dsh-workspace-enhancement` 的 `lib/*` 与其 `cordis.patch.yml` 的 `ssh-web-channel` 行，对照 0.2.0 的 `dsh-client-connection` / `dsh-api-*` 服务表 |
| **U-6** | entry id 变更（F-3 方案 a）对 profile patch 内其他行 id 引用的影响 | 本轮未通读 `~/.dsh/profiles/web/cordis.patch.yml` 全文（32 KB）的 id 引用图 | `grep -n "^ *- id:\|name: '@local/" ~/.dsh/profiles/web/cordis.patch.yml`，构建 id→引用表；特别检查是否有行按 `btw`/`usage`/`ssh-gui` 等 id 做 `disable`/`override` |
| **U-7** | 0.2.0 `SettingsForms` 的 `importLegacyDocument` 是否能自动把旧 `settings.yaml` 段迁到新 entry-id 命名空间 | 只读到私有方法注释（"Move the sections of the removed settings.yaml into the active profile once the Loader has settled every entry"），未验证 key 匹配规则 | 在隔离 0.2.0 组合里放一个已知段名的 `settings.yaml`，启动后看是否生成 `.imported` 改名与本 profile patch 的写入 |
| **U-8** | `dsh-client-schema-form`（本地 `dsh-pptmaster` peerDep 中无、但 0.1.1 树中曾被引用）在 0.2.0 的替代 | 该包 npm 最高 `0.1.0-rc.7`，0.2.0 无发版；`dsh-client-ui-primitives` 0.2.0 已把 `SettingsForm`/`SettingsFormModel`/`settingsNumberField`/`settingsTextField` 收进自身导出 | `grep -rn "dsh-client-schema-form" ~/.dsh/profiles/node_modules/@local/`；若有引用则改用 `@deepseek-ai/dsh-client-ui-primitives` 的 `SettingsFormModel` |
| **U-9** | **隔离 3097 实例是否真的加载了 §9.4b 中那 6 个"未修"插件** | 本轮为只读静态审计：**未启动任何服务**，无法观测运行时加载结果。已确认的事实是：3097 的 `@local` 副本与 3080 现役**逐字节相同**（除 `dsh-web-search-sse`），而它们都 import 了 0.1.7/0.2.0 均不存在的符号 ⇒ **静态上不应加载成功** | 查 3097 的启动日志/`ctx.logger` 输出与插件 fiber 状态：`~/.dsh-017/logs/**`、或在该实例上查看插件列表是否包含这 6 个；**须由有权启动服务的轨道执行**（T04 受"不得启动服务"约束） |
| **U-10** | 这 6 个插件的加载失败是被**静默容错**还是**阻断整个组合** | 同上，需运行时观测 | 同上；重点看 `dsh-plugin-manager`（[H] 逐字节相同）对 entry `apply()` 抛错的处置分支 |

---

## 7. 未验证项（本轨道明确没有做的事）

1. **未在真实 0.2.0（或 0.1.7）运行时加载任何插件**。本轨道全程只读静态源码/类型/`package.json`/registry 元数据；结论是"契约存在性"级别的判定，**不等价于**端到端跑通。三分类中的 A 类（`dsh-logfile`）也是"静态契约全在"的判定。
2. **未启动任何服务、未发起任何模型请求、未写 `~/.dsh/**` 与 `~/.dsh-017/**`**；所有产出限于 `.workspace/audit-020/t04/` 与 `.workspace/dsh-020-pkgs/`。
3. **未验证配置持久化的端到端行为**：F-3/F-4 的修复方向来自类型与实现片段的对照，未做"写一次设置 → 重启 → 读回"的闭环。
4. **未审计 0.2.0 的 `dsh-web-app` / `dsh-web-frontend` 装配层**（本轮只读了 `dsh-web-app` 的 `package.json` 与 `cordis.patch.yml` 的 roster 行）；`dsh-web-app` 的 client roster 与插件 `dsh.client` 行的实际拼装结果未验证。
5. **未审计会话数据格式**（0.2.0 新增 `session-format-v2-to-v3` 等包）——不属 T04 范围。
6. **`dsh-workspace-enhancement` 判定为 C 类是基于"核心服务提供关系需重建"的结构性理由，未逐读其源码**（见 U-5）；若 U-5 判定其 `ssh-web-channel` 面在 0.2.0 可原样挂载，该 C 类判定应下调为 B 类。
7. **`conversation.chat.turnTail` 的 owner props 形状未做逐字段 diff**（只确认两版均存在）；矩阵中标 `△` 即为"存在但归属/签名未逐字比对"。
8. **§9.4b "这 6 个插件在当前隔离实例上无法加载"是静态推断，未做运行时确认**（因本轨道不得启动服务）——见 U-9/U-10。该推断的**静态部分**（副本逐字节相同、符号两版皆无）是实测硬事实。
9. **未逐文件通读 55 个 churn 包的全部改动**：本轮只对**与本批插件契约相关**的包做了改动内容实读（见 §2.2 B 表）。
10. 本报告不含会话正文、密钥或原始会话 id。

---

## 8. §9 之前：重锚后的修订记录

第 1 版（基准 `0.1.1`）的结论**已作废**，逐条对应关系如下——**这一节是给修订执行档的"不要按旧结论动手"清单**：

| 第 1 版结论 | 重锚后的正确结论 | 依据 |
|---|---|---|
| "F-1 `dsh-client-runtime` 在 0.2.0 被删除 → 3 插件客户端会失败" | 该包在 **0.1.7 就已不在**（[H-]）。是未清偿的 0.1.7 债；0.2.0 未新增 | 0.1.7 全树 0 命中；npm 最高 `0.1.1-rc.2` |
| "F-2 `ctx.settingsScope` 消失（4 插件）" | 0.1.7 已消失（[H-]，`dsh-client-ui-settings` 逐字节相同） | 两版全树 0 命中 |
| "F-4 `installSettingsSection`/`settingsNamespace` 消失（7 插件宿主）" | 0.1.7 已消失（[H]），且**已有一个插件被修好过**（web-search-sse 仓内存在修复副本） | `dsh-settings` 逐字节相同；§9 |
| "F-5 `conversationEvents` 消失（pptmaster）" | 0.1.7 已消失（[H-]） | 两版全树 0 命中 |
| "F-6 槽位 `settings.plugin.item` 消失（usage）" | 该槽在 **0.1.1 有、0.1.7 已无**（`dsh-client-ui-settings-plugins` 逐字节相同） | 两版仅剩一句注释 |
| "F-7 槽位 `sidebar.workspaces.remoteHosts` 消失（ssh-gui）" | 0.1.7 已无（[R] 但键集逐项比对相同） | 两版键集相同 |
| "F-10 `Icon*Outline16` 在 0.2.0 退役（blocing, 2 插件）" | **0.1.7 已退役**（0.1.7 也是 98 Regular + 98 Medium、0 Outline16）→ 两插件在 0.1.7 上**已经坏了** | §9.3 |
| "F-3 `dsh-usage` 命名空间漂移" | 成立，但机制在 0.1.7 已存在（`SettingsForms` 相同）；是**键漂移**而非 0.2.0 新 API | §1.4 |
| "三分类 A=1 / B=9 / C=1" | **A=2 / B=7 / C=1 / D=1**（workerspace 升 A；web-search-sse 单列 D） | §1.1 |

---

## 9. 首要重点：`dsh-web-search-sse`（协调者指定）

### 9.1 结论

**`dsh-web-search-deepseek` 的 75% `lib/` churn 不传导到本机定制；本机定制的真实阻塞在部署面，不在 0.2.0。**

### 9.2 上游 75% churn 的实质（[R]，源码实读）

`dsh-web-search-deepseek` 逐文件 sha256（0.1.7 → 0.2.0）：

| 文件 | 0.1.7 | 0.2.0 | 判定 |
|---|---|---|---|
| `lib/index.js` | `22faa27ec4f6c80e` | `77ee0524e540a798` | CHANGED |
| `lib/types/index.d.ts` | `d1d05fe23f421d65` | `2b8127bd4bb1722f` | CHANGED |
| `lib/types/provider.d.ts` | `c12a0bd0fb657d24` | `2b242b83ed5e1336` | CHANGED |
| `lib/types/types.d.ts` | `591ea0410b532fe5` | `591ea0410b532fe5` | SAME |

改动内容（实读确认）：

1. `package.json` peerDeps 新增 `@deepseek-ai/dsh-deepseek-account@0.2.0-rc.1`；
2. `lib/index.js` 新增 `ACCOUNT_PROVIDER = "deepseek-account"` 常量与注释
   "Provider route id `dsh-llm-deepseek-account` registers; `request/context` events record it per Session"
   → 新增一条**由 DeepSeek 账号驱动的搜索路由**（对应 release note「DeepSeek 账号模型免额外 Key 即可网页搜索」）；
3. 官方 provider id 仍为 `DEEPSEEK_PROVIDER_ID = "deepseek-official"`，配置读取仍是 `config.X.get()`（7 处）；
4. 导出集**未增未减**：`{ Config, DEEPSEEK_DEFAULT_*, DEEPSEEK_PROVIDER_ID, DeepSeekSearchProvider, WEB_SEARCH_DEEPSEEK_SETTINGS_NAMESPACE, apply, inject, name }` 两版相同。

⇒ 变化集中在**官方 provider 自身的行为与路由**，不改变 `ctx.web` 的 provider 注册契约。

### 9.3 本机 fork 的挂载缝（实读确认，全部 [H]）

`@local/dsh-web-search-sse` **不 import 上游包**（全文对 `dsh-web-search-deepseek` 仅 1 处提及，且是文档性引用），
是**自包含重实现**。它对外部符号的**全部**依赖只有 4 个：

| 依赖符号 | 来源包 | 0.1.7→0.2.0 | 证据 |
|---|---|---|---|
| `WebError` | `@deepseek-ai/dsh-web` | **IDENTICAL** | [H] `dsh-web/lib/types/index.d.ts` 含 `WebError` |
| `credentialRef` | `@deepseek-ai/dsh-credentials` | **IDENTICAL** | [H] `dsh-credentials/lib/types/index.d.ts` 含 `credentialRef` |
| `launchEnvironmentOf` | `@deepseek-ai/dsh-launch-environment` | **IDENTICAL** | [H] 同左，含 `launchEnvironmentOf` |
| `ctx.web.registerSearchProvider(provider)` | `@deepseek-ai/dsh-web` | **IDENTICAL** | [H] `dsh-web` 0.2.0 导出 `WebRuntime` 且成员签名 `registerSearchProvider(provider: WebSearchProvider): () => void` |

配置读取用 `config.X.get()`（7 处），与 0.2.0 官方 `dsh-web-search-deepseek` **完全同一惯用法**（官方也是 7 处）。
`inject: ["web"]` 未变。

**⇒ 一个在 0.1.7 上能挂载的 `dsh-web-search-sse`，在 0.2.0 上同样能挂载；无需为 0.2.0 改动它。**

### 9.4 真正的阻塞：现役 3080 的副本是坏的（部署面）

| 副本 | sha256(`lib/index.js`) | 大小 | `import ... from "@deepseek-ai/dsh-settings"` | 状态 |
|---|---|---|---|---|
| `~/.dsh/profiles/node_modules/@local/dsh-web-search-sse`（**3080 现役**） | `88d6387e351af5a6` | 15 564 B | **`installSettingsSection, settingsNamespace`** | ✘ 两版都不存在 ⇒ 模块加载期失败 |
| `~/.dsh-017/profiles/node_modules/@local/dsh-web-search-sse`（3097 隔离） | `5947d09095507cff` | 15 581 B | （无该 import） | ✔ 已按 0.1.7 修复 |
| `.workspace/audit-020/assembly-020/home/profiles/node_modules/@local/…` | `5947d09095507cff` | 15 581 B | （无） | ✔ 同修复副本 |
| `.workspace/audit-020/t32|sandbox-017|sandbox-020|import-probe*/…` | `5947d09095507cff` | 15 581 B | （无） | ✔ 同修复副本 |
| `.workspace/lag-fix/*`（4 处旧快照） | `88d6387e351af5a6` | 15 564 B | 有 | ✘ 与 3080 同（坏） |

**0.1.7 与 0.2.0 的 `dsh-settings` 导出逐字相同**：
`export { SettingsConflictError, SettingsForms, SettingsForms as default, redactSecrets };`
⇒ 现役副本 import 的两个名字**不是被 0.2.0 移除的，而是早已不存在**。

### 9.4b 该符号缺口的完整爆炸半径：7 个插件，其中**只有 1 个被修过**

对 `~/.dsh/profiles/node_modules/@local/*/lib/index.js` 与 `~/.dsh-017/…/@local/*/lib/index.js` 逐文件复核
（注意：`dsh-ssh-gui` 用**单引号** import，正则必须同时匹配两种引号，本轮首扫曾漏掉它）：

| 插件 | 3080 现役 `lib/index.js` | 0.1.7 隔离副本 | 用到的已消失符号 | 状态 |
|---|---|---|---|---|
| `dsh-btw` | `9634c6eac09b` 67 542 B | 同（一致） | `settingsNamespace` + `settings.register()` | ✘ **未修** |
| `dsh-ssh-gui` | `ccb51fafbdf4` 18 103 B | 同（一致） | `installSettingsSection`,`settingsNamespace` | ✘ **未修** |
| `dsh-subagent-model` | `e93de18da406` 2 211 B | 同（一致） | `installSettingsSection`,`settingsNamespace` | ✘ **未修** |
| `dsh-usage` | `b67c064b8123` 16 863 B | 同（一致） | `settings.register()` | ✘ **未修** |
| `dsh-wallpaper` | `05d42901206a` 11 498 B | 同（一致） | `settingsNamespace` + `settings.register()` | ✘ **未修** |
| `dsh-workerspace` | `4362201dacb9` 22 487 B | 同（一致） | `installSettingsSection`,`settingsNamespace` | ✘ **未修** |
| `dsh-web-search-sse` | `88d6387e351a` 15 564 B | **`5947d0909550` 15 581 B（已修）** | 已删除 | ✔ **已修** |
| `dsh-logfile` | `043f4065fc69` | 同 | —（只用 `describe`/`documentPath`） | ✔ 无需修 |
| `dsh-pptmaster` | `7eefe05324fa` | 同 | — | ✔ 无需修 |

**两个必须上报的推论**：

1. **爆炸半径是 7/9，不是 4/9**（第 1 版据宿主/客户端面粗略估计为 4 个客户端 + 7 个宿主，现精确为 7 个宿主侧）。
2. **3097 隔离实例的 `@local` 副本与 3080 现役逐字节相同（除 web-search-sse）** ⇒
   **这 6 个插件在隔离 3097 上同样无法加载**。要么隔离实例并未真正把这些插件跑起来，
   要么其插件加载失败被上层容错而未被发现。**协调者应据此复核"3097 已端到端可用"这一前提**
   （属 T04 观测到的事实，不属 T04 结论范围；本轨道未启动任何服务，无法进一步判定运行时行为）。
3. 反向结论：`dsh-web-search-sse` 的修复副本 `5947d090…` **是仓内唯一一份已验证的 §9.5 范式实现**，
   其余 6 个插件的修复应直接照抄它，而不是重新设计。

### 9.5 修复副本的 diff（即为该插件的迁移范式）

`diff(live-3080 88d6387e, 0.1.7-fixed 5947d090)` 只有 3 处改动（399 行 → 399 行）：

```diff
-import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
+（删除该 import）

 const Config = z.object({
-  apiKey: z.string().role("secret"),
-  apiKeyEnv: z.string().role("credential-ref").default(DEFAULT_API_KEY_ENV),
-  baseURL: z.string(),
+  apiKey: z.string().role("secret").volatile(),
+  apiKeyEnv: z.string().role("credential-ref").default(DEFAULT_API_KEY_ENV).volatile(),
+  baseURL: z.string().volatile(),
   ...（其余 4 个字段同样加 .volatile()）

-const WEB_SEARCH_SSE_SETTINGS_NAMESPACE = settingsNamespace("web-search-deepseek-sse");
+const WEB_SEARCH_SSE_SETTINGS_NAMESPACE = "web-search-deepseek-sse";

 function apply(ctx, config) {
-  let current = () => config;
-  installSettingsSection(ctx, NS, Config, config, { setSource: (s)=>{current=s;}, onChange(){} });
-  ctx.web.registerSearchProvider(new SseSearchProvider(() => resolveOptions(ctx, current())));
+  ctx.web.registerSearchProvider(new SseSearchProvider(() => resolveOptions(ctx, {
+    apiKey: config.apiKey.get(), apiKeyEnv: config.apiKeyEnv.get(), baseURL: config.baseURL.get(),
+    model: config.model.get(), apiVersion: config.apiVersion.get(),
+    maxTokens: config.maxTokens.get(), maxUses: config.maxUses.get()
+  })));
 }
```

**这就是 §5 F-4 所有 7 个插件的最小修复范式**：删 import → 字段加 `.volatile()` → 命名空间改为字面量 →
`apply` 内用 `config.X.get()` 直读。**仓内已有一份经过 0.1.7 验证的可用实现可直接照抄。**

### 9.6 该插件的迁移动作

1. **采用 `5947d09095507cff` 那份替换 3080 的坏副本**（或等价地把 3 处 diff 应用到 3080 副本）；
2. **不要**引入上游 `dsh-web-search-deepseek`（它已新增 `dsh-deepseek-account` peer dep 与新 HTTP 栈，且本机 fork 无此需求）；
3. **核 `web-search-sse` 的 entry id 与命名空间对齐**（§1.4）：现 entry id `web-search-sse` ≠ 命名空间 `web-search-deepseek-sse`；
   0.2.0 下命名空间取自 entry id ⇒ 需把 entry id 改为 `web-search-deepseek-sse`（或反之，并把 `settings.yaml` 段名对齐）；
4. 迁移后**实跑一次搜索**验证 SSE 组装路径（本轮未做，见 §7）。

---

### 9.7 图标债的精确结论（因 §4.3 / F-10 引用此节）

| 项 | 结论 |
|---|---|
| 退役时点 | **0.1.1 → 0.1.7**（不是 0.2.0）。0.1.7 与 0.2.0 的图标名集合完全相同：**98 `*Regular` + 98 `*Medium`，0 个 `*Outline16`** |
| 受影响插件 | `dsh-btw`（7 个名字：`IconBranch`/`IconBrowse`/`IconClose`/`IconCode`/`IconEdit`/`IconSearch`/`IconSend` + `Outline16`）、`dsh-pptmaster`（1 个：`IconBrowseOutline16`，3 个渲染点） |
| 当前是否已坏 | **是，在 0.1.7 上就已坏**（引用 `undefined` 作为 JSX 组件 → 渲染该节点时抛 `TypeError`） |
| 替代映射 | `XOutline16` → `XOutlineRegular`（常规）或 `XOutlineMedium`（强调，1.3px 描边）；8 个名字两版全有替代 |
| 一次改完是否两版通吃 | **是** —— 两版图标集合一致，故同一份改名同时满足 0.1.7 与 0.2.0 |
| 附加注意 | `dsh-btw/src/client/SideChatButton.tsx`、`src/client/SideChatSurface.tsx`、`tests/*.spec.tsx`（3 文件）也含该族名字（含 `IconLoadingOutline16`）；若走重建路径会一并编译失败 |

---

## 10. 交付物与复跑入口

- 本报告：`.workspace/audit-020/reports/T04-plugin-api-compat.md`（**第 2 版**，基准 `0.1.7-rc.2 → 0.2.0-rc.1`）
- 冻结证据（重锚版，**优先引用**）：`.workspace/audit-020/t04/evidence-reanchored.txt`
  （含 A 契约证明包逐文件 sha256、B "两版皆不存在"全树 grep、C 各 web-search-sse 副本哈希、D dsh-settings 导出、E 三版图标集合）
- 冻结证据（首版，基准 0.1.1，**结论已作废，仅作方法参考**）：`.workspace/audit-020/t04/evidence.txt`
- 复跑脚本：`.workspace/audit-020/t04/`
  - 重锚核心：`reanchor.py`、`verify_churn.py`、`verify_named.py`、`recheck_client.py`、`resolve_changed.py`
  - 首轮（基准 0.1.1，结论已作废，**仅作方法参考**）：`scan3.py` / `check_services.py` / `check_client_services.py` / `check_slots.py` / `confirm_slots.py` / `resolve_slots.py` / `sig_compare.py` / `final_matrix.py` / `validate_tree.py` / `freeze_evidence.py`
  - 专项：`websesarch_priority.py`、`websearch_seam.py`、`websearch_seam2.py`、`websearch_copies.py`、`websearch_diff.py`、`websearch_verify_fixed.py`、`icon_versions.py`
- 0.2.0 合同定义包（本轮独立下载，用于交叉校验）：`.workspace/dsh-020-pkgs/x/`（42 包）
- 基准来源：`.workspace/audit-020/reports/MEASURED-BASELINE.md`、`.workspace/audit-020/churn-lib-017-020.txt`
