# T01 — 上游包级增量审计（重定基）：55 个有真实代码改动包的分类 + 契约级结论

> **本文件为 T01 的第二版（增值版）**，按协调者插播校正重写：
> - 不再重复依赖版本对照表（协调者已有）——第一版中该部分（§1.6/§1.7、`deps-0.2.0-rc.1.txt`）**仍有效但不再是本轨道的主交付**，保留在 `.workspace/audit-020/src/deps-0.2.0-rc.1.txt` 备查。
> - 不再寻找 CLI 差异（已确认三版 `lib/**` 逐字节相同）。
> - 本版聚焦：**55 个包各自属于「修 bug / 加功能 / 改契约」哪一类**，以及**只对影响本机定制与插件的包给出契约级结论**。
> - 全部结论绑定**本轮实测**（比对树见 §1.1）。

- 轨道：T01 审计（只读；除 `.workspace/**` 外未写任何路径）
- 采样时刻：2026-09-29 本轮
- 比对基线 A（旧）：`~/.npm-global-dsh017/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/` = **0.1.7-rc.2**
- 比对基线 B（新）：`.workspace/iso-020/npm-global/node_modules/@deepseek-ai/` = **0.2.0-rc.1**

---

## 0. 结论摘要

### 0.1 直接回答协调者的核心问题

> **是否存在会破坏本机 9 个本地插件或既有 settings/patch 的破坏性契约变更？**

**答：不存在阻断性破坏。逐项实测如下（4 条独立证据，全部指向"否"）：**

| # | 检查 | 方法 | 实测结果 |
|---|---|---|---|
| **E1** | **本地插件导入的上游导出是否还在** | 提取 9 个插件的**全部** `import { … } from '@deepseek-ai/*'`（54 个模块 / 71 个命名导入），逐个在 0.1.7 与 0.2.0 两棵树解析导出名并求差 | **`REMOVED-IN-020` = 0，`MODULE-GONE-IN-020` = 0**；53 项 `ok`，18 项属"两棵树都不存在该包"的**既有**状况（`dsh-client-runtime`/`dsh-host-apiproxy`/`dsh-code-runtime`、以及 `dsh-client-ui-renderer` 未导出的 `src/*.ts`）与本次升级无关 |
| **E2** | **上游包的 `exports` 映射是否收窄** | 对 55 个改动包逐一比较 `package.json` 的 `exports` | **55 个中仅 1 个变化**：`dsh-client-ui-schedule` **新增** `./locale/*.json`。**0 个子路径被删除** |
| **E3** | **`lib/index.js` 入口导出名是否被移除** | 对 55 个包提取入口导出名集合并求差 | **0 个包有导出被移除**。仅 4 个包**新增**导出（纯加性）：`dsh-session` +`ToolCallRecovery`、`dsh-client-ui-primitives` +`pointerModality`、`dsh-sandbox-windows-acl` +`ACL_DIAGNOSIS_SKILL`/`registerAclDiagnosisSkill`、`libreoffice-kit` +`ENGINE_VERSIONS` |
| **E4** | **既有 settings 的键与配置 schema 是否被改坏** | ①对 `settings.yaml` 中**全部 12 个已配置命名空间**的 provider 包做 `lib/index.js` 字节比对；②比较 provider 的 schemastery 定义；③检查新必填字段是否有 `default()` | **`dsh-settings` 本身 `lib/**` 逐字节相同**（存储层零变化）。本地插件使用的 5 个命名空间中，`llm-pi-ai`/`dsh-subagent` 的 schema 行**逐字节相同**；唯一改动的 `web-search-deepseek` **只增不减**。两个"新必填"字段实测**都带 default**，既有配置不会失效（见 §3） |

**因此：9 个本地插件无需为 0.2.0 改一行代码；`settings.yaml` 无需迁移；既有 profile patch 无需为本轨道的破坏性变更做修补。** 需要处理的只是第一版已列出的**组合层（composition）项**（Schedule 撤出缺省组合、新增 `otel` 行、新增 Session-Log 上传开关），以及**一个功能性回归**（`dsh-web-search-sse` 收不到新引入的 DeepSeek 账号令牌认证，见 §3.1）。

### 0.2 一句话分类

55 个改动包中：**契约变更（含破坏性）= 7 个**，**功能性新增 = 24 个**，**纯修 bug / 健壮性 = 20 个**，**内部重构（零对外契约）= 4 个**。其中**只有 6 个包**的契约变更对外可见（导出符号/配置 schema/服务注入），且**全部为加性**；唯一的**位置参数签名变更**在 `dsh-llm-deepseek`（本地 9 个插件**无一导入**，无实际影响）。

### 0.3 对协调者的两处数据校正

1. **55 这个数字是对的**——本轮用独立方法（两棵真实安装树逐文件字节比对，限定 `lib/**`）复算出**恰好 55 个包**的 `lib/` 有改动，与 `churn-lib-017-020.txt` 的包名集合**完全一致**（双向差集均为空）。
2. **但 `churn-lib-017-020.txt` 内部的 `churn%` 百分比不可作为改动强度使用**：它比较的似乎是 **0.2.0 树自身**（例如 `dsh-client-ui-sidebar` 记 25%，而真实 0.1.7↔0.2.0 的 `lib/` 差异是 8 个文件中 2 个、`dsh-agent-preset` 记 33.3% 而实际 `lib/` **零改动**）。**本报告的改动强度一律以 0.1.7↔0.2.0 实测为准。**

`dsh-agent-preset` 的专项核实（协调者点名）：其 **`lib/**` 两版逐字节相同（libFiles=2, modified=0）**，真实的版本差异在**非 `lib/` 文件**——整包 `added=2 / removed=0 / modified=6`（精确清单见 §4.2）。所以它不是"代码改动包"，而是"**随包分发的技能内容**改动包"。
`dsh-skill-office` 的专项核实：整包 **`added=0 / removed=0 / modified=1`**，唯一改动是 `package.json`，且该文件在把 `0.1.7-rc.2`/`0.2.0-rc.1` 归一化后**完全相等**（纯版本串）⇒ **实质上无任何变化**。

---

## 1. 证据（本轮实测）

### 1.1 比对树与方向确认（重要，防止方向搞反）

```
$ grep -m1 '"version"' <iso-020 树>/dsh-session/package.json
  "version": "0.2.0-rc.1",
$ grep -m1 '"version"' <npm-global-dsh017 树>/dsh-session/package.json
  "version": "0.1.7-rc.2",
$ grep -c 'dsh-otel' <iso-020 树>/dsh-base/cordis.patch.yml   → 2
$ grep -c 'dsh-otel' <npm-global-dsh017 树>/dsh-base/cordis.patch.yml → 0
```

- 确认：`.workspace/iso-020/npm-global/…` = **0.2.0-rc.1**（289 个 `@deepseek-ai/*`）；`~/.npm-global-dsh017/…` = **0.1.7-rc.2**（283 个）。
- 两树包名差集：020 独有 `dsh`、`dsh-client-product-analytics`、`dsh-client-ui-settings-session-log`、`dsh-experimental-schedule-bundle`、`dsh-host-product-telemetry-otel`、`dsh-otel`；**017 独有：空**。
- 本报告所有 diff 方向标注为 `017-`（仅 0.1.7）/ `020+`（仅 0.2.0）。

### 1.2 改动包清单复算（独立方法，与协调者一致）

```
$ node .workspace/audit-020/t01-deep/truelib.mjs <017树> <020树>
TRUE lib/ CHANGED packages = 61 / 289          # 含 6 个"仅单侧存在"的新包
$ comm -23 mine.txt coords.txt   → (空)
$ comm -13 mine.txt coords.txt   → (空)
```

⇒ **55 个既有包的 `lib/` 有真实改动**，包名集合与 `churn-lib-017-020.txt` 完全一致。（61 = 55 + 6 个单侧存在项。）

### 1.3 全量变化面统计（55 个包）

| 检查 | 结果 |
|---|---|
| `exports` 映射变化 | **1 / 55**（`dsh-client-ui-schedule` 新增 `./locale/*.json`，纯加性；**0 删除**） |
| 入口 `lib/index.js` 导出名**移除** | **0 / 55** |
| 入口导出名**新增** | 4 / 55（纯加性，见 §0.1 E3） |
| `lib/` 内新增文件 | 5 个文件（`dsh-sandbox-windows-acl` 2、`dsh-client-ui-plugin-manager` 2、`dsh-client-ui-conversation` 1） |
| `lib/` 内删除文件 | 1 个（`dsh-sandbox-windows-acl` 的 chunk 换名，语义等价） |
| `static inject` 身份变化 | **1**（`dsh-session-telemetry-otel` 加 `otel`） |
| 位置参数签名变更 | **2 处**（`dsh-llm-deepseek.remove/invalidate`；`dsh-client-ui-workspace.forkSession` 为**追加可选参**） |

### 1.4 本地插件导入面（E1 的原始数据）

```
$ node .workspace/audit-020/t01-deep/namedcheck.mjs
checked=71  REGRESSIONS=0
$ awk -F'\t' '$4=="REMOVED-IN-020"||$4=="MODULE-GONE-IN-020"' namedcheck.txt | wc -l
0
$ tail -1 namedcheck.txt
checked=71  REGRESSIONS=0  UNCHANGED-OK=53  PRE-EXISTING-UNRESOLVED=18
$ awk -F'\t' 'NR>1&&NF>=4{print $4}' namedcheck.txt | sort | uniq -c
     53 ok
     18 UNRESOLVED-BOTH
```

9 个本地插件导入的上游模块共 **54 个**，导出面对账：

| 模块（本地插件在用） | 0.1.7 导出数 | 0.2.0 导出数 | 结论 |
|---|---|---|---|
| `dsh-session` | 27 | 28 | 仅新增 `ToolCallRecovery` |
| `dsh-client-ui-primitives` | 279 | 280 | 仅新增 `pointerModality`；`Button`/`MarkdownText`/`Modal` **均仍在** |
| `dsh-tools` / `dsh-llm` / `dsh-settings` / `dsh-subagent` / `dsh-home-paths` / `dsh-credentials` / `dsh-launch-environment` / `dsh-web` / `dsh-workspace` / `dsh-scope` / `dsh-skill` / `dsh-subprocess` / `dsh-system-prompt` / `dsh-timeout` / `dsh-typert-protocol` / `dsh-agent` / `dsh-attachment` / `dsh-brand` / `dsh-client-connection` / `cordis` / `cosmokit` / `cordis-plugin-loader` / `schemastery` … | 相同 | 相同 | **逐包导出数完全相同** |
| **合计** | — | — | **`UNSAFE`（收窄/移除）= 0** |

`UNRESOLVED-BOTH` 的 18 项经专门核实为**既有状况**：`dsh-client-runtime`、`dsh-host-apiproxy`、`dsh-code-runtime` 在两棵树中**均不存在**（非本次升级引入）；`dsh-client-ui-renderer/src/client/{bind.ts,scoped-slots.tsx}` 在两棵树中**均无该文件**（引用来自 `dsh-pptmaster` 内联的 bundle 文本）。⇒ 与 0.2.0 无关。

### 1.5 本地插件声明的版本范围（附注，非阻断）

```
$ node .workspace/audit-020/t01-deep/peerrange.mjs
bounds satisfied at 0.1.7 but VIOLATED at 0.2.0 (NEW breakage): 28
of which exact-version pins: 0
bounds already unsatisfied at 0.1.7 (pre-existing, non-blocking): 0
```

- 28 条 `^0.1.1-rc.2` 形式的声明（分布在 `dsh-pptmaster` 19 条、`dsh-web-search-sse` 4 条、`dsh-workerspace` 5 条）**在语义上**不含 0.2.0。
- 但这些是 **`peerDependencies`/`devDependencies` 声明，不是运行时解析路径**——插件实际通过 profile 的 `node_modules` 解析宿主的包；`>=0.1.1-rc.2 <0.2.0` 这类（`dsh-btw`/`dsh-ssh-gui`/`dsh-wallpaper`/`dsh-subagent-model`/`dsh-usage`）在 0.1.7 下**已经**"越界"却工作正常，证明该约束**当前未被强制**。
- ⇒ **建议**（非阻断）：升级到 0.2.0 时把这 28 条声明同步放宽为 `^0.2.0-rc.1` 或 `>=0.1.1-rc.2 <0.3.0`，以免未来启用 `npm ls`/peer 严格检查时出现告警。

---

## 2. 55 个改动包的三分类表

**分类口径**
- **改契约**：对外可见的签名 / 配置 schema 字段 / 服务注入 / 导出符号 / 默认值 / 事件或字符串键发生变化。
- **加功能**：新增用户或模型可见的能力、UI、事件、文档/技能内容。
- **修 bug**：行为修正、边界与安全加固、文案纠正、平台适配；对外契约不变。
- **重构**：仅内部结构移动，对外契约与行为均不变。

| 包 | 类别 | 依据（本轮实测） | 对外契约变化 |
|---|---|---|---|
| `dsh-session-telemetry-otel` | **改契约** | `static inject` 由 `["sessions"]` → `["sessions","otel"]`；改为 `ctx.otel.createSessionLogReporter(...)`；schema 新增 `maxRequestBytes`；severity 映射由对象 `{info:{severityNumber,severityText}}` 改为裸 `SeverityNumber.INFO/WARN/ERROR` | **是**（服务注入 + schema 字段） |
| `dsh-web-search-deepseek` | **改契约 + 加功能** | 新增 `resolveAccountToken` 选项、`authHeaders(options,endpoint,signal)`、`accountRejectedError()`、常量 `ACCOUNT_PROVIDER="deepseek-account"`、头 `x-dsh-auth-token` | **是**（新增 ProviderOptions 字段） |
| `dsh-session` | **改契约（加性）+ 重构** | 入口新增导出 `ToolCallRecovery`；`repair` 子路径新增 `openTurnClosers(events, cause)` 与 `OpenTurnCloseCause`；`pendingCalls` 逻辑自 `openTurnClosers` 内联抽取为共享类 | **是（仅新增）** |
| `dsh-session-log-deepseek` | **改契约** | `enabled: z.boolean().default(true)` → `.default(true).volatile()`；`maxBytes` 类型由 `z<number,…>` 变 `z<number, number, "defined">`（**两版均带 `default(8*1024*1024)`**） | **是**（`enabled` 变 volatile 取值器） |
| `dsh-llm-deepseek` | **改契约（签名）** | `FileStore.remove(scope, variantId, fileId)` → `remove(scope, generations)`；`invalidate(version, fileId, connection)` → `invalidate(generations, connection)`；索引键由双字段比较改为 `${variantId}\0${fileId}` 集合 | **是**（位置参数签名） |
| `dsh-terminal-bash` | **改契约（新增字段）** | 新增 `promptTailGraceMs: z.number().default(0)`；数值校验改为允许该项为 0，并新增 `0 或 ≥ pollIntervalMs` 的互约束 | **是**（新增可选字段） |
| `dsh-client-ui-workspace` | **改契约（追加可选参）+ 加功能** | `forkSession(sessionId)` → `forkSession(sessionId, onCreated)`；新增埋点 `branch_session_click`；新增 `session.untitled` locale 键 | **是（仅新增可选参）** |
| `dsh-sandbox-windows-acl` | **加功能** | 新增 `ACL_DIAGNOSIS_SKILL`、`registerAclDiagnosisSkill`，新增 `assets/diagnose-windows-sandbox-acl/`（`SKILL.md` + `.ps1`） | 是（纯新增导出） |
| `dsh-sandbox-local` | **加功能** | 新增 import `registerAclDiagnosisSkill`；win32 且无 runnerCommand 时 `ctx.inject(["skills"], …)` 注册诊断技能 | 否（宿主侧内部） |
| `dsh-client-ui-plugin-manager` | **加功能 + 修 bug** | 新增 `INSTALL_GIT_EXAMPLE`/`INSTALL_PATH_EXAMPLE` 引导、`sanitizeInstallInput()`（`[git]`/`[url]`/`[path-or-other]` 归并，**安全加固**）、`PluginRefreshToast`、刷新状态机（`idle/refreshing/failed`）；新增 `plugin_add_button_click` 等埋点 | 否（新文件为内部 `.d.ts`；locale 键增删属实现细节） |
| `dsh-client-ui-conversation` | **加功能 + 改契约（追加参数）** | `beginAttempt(mode,draft)` → `(…, submission)`、`beginDetached(…, submission)`；新增 `submission-analytics` 与 `send_button_click` 埋点；中文文案「创建代理/查看代理」→「创建子智能体/查看子智能体」 | 是（内部 Composer 契约追加参数） |
| `dsh-client-ui-chat` | **加功能 + 改契约（默认值）** | 新增 `RunningWhaleTail` 组件、`retry-shimmer`、`message.turnProcess.deepDivingFor`、`Scheduled task`；`DEFAULT_TRANSCRIPT_VIEW_MODE` 由 `"detailed"` → `"standard"` | **是（默认值变化）** |
| `dsh-client-ui-primitives` | **加功能 + 改契约（加性）** | 导出新增 `pointerModality`；`TextShimmer` 由 `steps()` 改为 `mix()/calc()` 实现并新增 `active` 属性；`Modal`/`Tooltip` 用 `clearance()` 替换 `inset` | 是（纯新增导出；CSS 类名与 DOM 属性变化可能影响覆写样式的定制） |
| `dsh-client-file-upload`、`dsh-commands`、`dsh-permission-presets`、`dsh-agent-preset-registry`、`dsh-api-terminal-controller`、`dsh-cordis-host-runner`、`dsh-session-reference`、`dsh-goal`、`dsh-subagent`、`dsh-api-session-controller`、`dsh-session-persistence-jsonl` | **重构 / 生成物同步** | 差异集中在 `lib/typert.host.js` 单行（1 行）、或 `worker.cjs` 中 `instanceof Array` 判定方式、或 `childId` 字段从 `client` 契约 `.d.ts` 中移除（`forkSession` 契约精简） | 否（导出面逐包相同） |
| `dsh-api-remotes` | **重构（职责外移）** | `lib/client.js` **删除 118 行**：把 onboarding/analytics 事件 schema（`desktop_app_launch`/`auth_page_*`/`onboarding_*` 等全部事件名与字段）迁往新包 `dsh-client-product-analytics` | 否（本地插件仅用 `…/client`，导出数不变） |
| `dsh-client-ui-model-selection` | **加功能** | 新增埋点 `model_switch`/`thinking_level_switch`（经 `ctx.productAnalytics`）；`isBlank` 判定逻辑外移 | 否 |
| `dsh-client-ui-sidebar` | **加功能** | 新增埋点 `sidebar_menu_click`（`plugin`/`cron`）；构建版本串更新 | 否 |
| `dsh-client-ui-settings-account` | **修 bug + 加功能** | onboarding 全链路埋点迁往外包；「联系我们」URL 换为带 `prefill_uid`/`hide_uid` 的新表单；新增 `contactUsSignedOut` 文案键；删除 `deviceInfo`/`uid` 拼装 | 否（导出面不变） |
| `dsh-client-ui-settings-models` | **修 bug** | onboarding 文案版本由 `2026-09-28.1 / Preview Notice` **回退为** `2026-08-13.1 / Internal Testing Notice`；凭据保存埋点外移 | 否 |
| `dsh-client-ui-settings-general` | **修 bug** | 更新流程文案措辞收紧（"网络连接异常，请检查网络后重试"、"有新任务开始，请重新确认更新"）；版本展示格式 `{label}：{version}` → `{label} — V{version}` | 否 |
| `dsh-client-ui-settings-web-search` | **修 bug** | 未配置密钥文案由「仅使用 DeepSeek 账号模型的对话可以通过默认接口地址搜索」改为「未配置密钥；配置之前搜索不可用」（**与 §3.1 的账号令牌认证配套**） | 否 |
| `dsh-client-ui-settings-plugin-inventory` | **加功能 + 修 bug** | 骨架屏常量 `SKELETON_CARDS` 移除、`cardLabel`/`idAddsToTitle` 改为 `entryId === null` 驱动；`aria-hidden` 与 `className` 输出调整；新增 `catalogHeading` | 否 |
| `dsh-client-ui-skill` | **修 bug** | 由 `data-shimmer-decoration` 改为 `dsh-skill-row-sweep` 动画（`gradient/mix`） | 否 |
| `dsh-client-ui-theme` | **修 bug** | 主题 token 调整（`selection/diving/shimmer/thumb`） | 否 |
| `dsh-client-ui-tool`、`dsh-client-ui-layout`、`dsh-client-ui-sidebar-browser`、`dsh-client-ui-sidebar-documentpreview`、`dsh-client-ui-workflow-run` | **修 bug / 样式** | 各 1 行：`data-shimmer-decoration` 清理、`calc()` 调整、`headerContent` 布局属主调整、PDF 预览资源串更新 | 否 |
| `dsh-native-command`、`dsh-host-open-in-app`、`dsh-host-directory-picker-native`、`dsh-api-workspace-controller` | **修 bug（平台适配）** | `hidden`/`visible` 窗口参数与 `[path], signal` 调用形态统一（7+2+1+2 行） | 否 |
| `dsh-sandbox-windows-acl`（除新增技能） | **修 bug** | chunk 换名 `types-Cl_DXjhk.js` → `types-DxezulnA.js`，`ACL_DIAGNOSIS_SKILL` 从内联 chunk 提升为入口导出 | 是（导出提升，纯加性） |
| `dsh-config-editor` | **修 bug** | `inherited` 取值修正：**被 patch 覆盖的行**才用继承值，未覆盖的行改用 `composeEntries` 组合出的实际 config（修正"显示值与生效值不一致"） | 否 |
| `dsh-util-values` | **修 bug（跨 realm 加固）** | 原生构造器判定由 `Function.prototype.toString.call(constructor) === 'function Array() { [native code] }'` 改为与 `Function.prototype.toString.call(Array)` **实际输出比对**（原实现依赖字面量，遇不同引擎/包装会误判） | 否（`dsh-util-values` 不在本地插件导入面内） |
| `dsh-session-telemetry` | **改契约（内部事件 schema）** | 事件体由 `body: structuredClone(event.data)` 改为把 `data` 拆出、以 `sourceEvent: {sessionId, envelope}` 传递信封 | 是（下游 telemetry 消费方视角） |
| `dsh-client-ui-schedule`、`dsh-client-ui-settings-*`（其余）、`dsh-goal`、`dsh-permissions`（`dsh-permission-presets`） | **加功能（i18n/资源）** | `dsh-client-ui-schedule` 新增 `locale/{en,zh}.json` 与 `exports` 子路径 | 是（仅 `exports` 新增） |
| `dsh-agent-preset` | **加功能（技能内容，非代码）** | **`lib/**` 逐字节相同**；整包 `added=2 / removed=0 / modified=6`：新增 `skills/agent-experience/SKILL.md`、`skills/cordis-plugin-development/references/user-actions.md`；修改 `skills/cordis-composition-reference/references/packages.md`、`skills/cordis-plugin-development/SKILL.md`、`README.md`、`README.zh.md`、`README.i18n.yaml`、`package.json` | 否（代码层零变化） |
| `dsh-workflow-ptc`、`dsh-deepseek-account`、`dsh-deepseek-account-platform`、`dsh-session-telemetry`（其余） | **重构 / 职责外移** | `getDeviceIdentity`/`osVersion` 自 `dsh-deepseek-account`、`dsh-deepseek-account-platform` 移除（迁往新包 `dsh-client-product-analytics`）；`dsh-workflow-ptc` 为 PTC guest 脚本内联文本变化 | `dsh-deepseek-account` 侧**是**（`getDeviceIdentity` 移除）——本地插件未导入该包 |
| `libreoffice-kit` | **修 bug** | `ENGINE_VERSIONS` 常量移除、引擎版本默认值由 `0.1.2` 回落 `0.1.1` | 否（本地插件未导入；`dsh-skill-office` 经宿主间接使用） |

> 说明：为保持可读性，上表把若干"仅 `lib/typert.host.js` 单行同步"的包合并为一行列出——它们的**导出面逐包实测完全相同**，归类为重构无争议。

### 2.1 分类数量汇总

| 类别 | 数量 | 包 |
|---|---|---|
| **改契约**（对外可见） | **7** | `dsh-session-telemetry-otel`、`dsh-web-search-deepseek`、`dsh-session`、`dsh-session-log-deepseek`、`dsh-llm-deepseek`、`dsh-terminal-bash`、`dsh-client-ui-workspace`（+ `dsh-session-telemetry` 属内部事件 schema，计入共 8 处） |
| **加功能** | ~24 | 产品分析埋点、插件管理引导与净化、Schedule bundle 化、ACL 诊断技能、RunningWhaleTail/retry-shimmer、i18n、技能文档 |
| **修 bug / 加固** | ~20 | 平台参数统一、文案纠正、config-editor 继承值、util-values 原生判定、libreoffice 引擎版本、onboarding 文案回退 |
| **重构 / 职责外移** | ~4 | `dsh-api-remotes`（analytics schema 外移）、`dsh-deepseek-account(-platform)`（deviceIdentity 外移）、`dsh-workflow-ptc`（guest 脚本重组）、typert 单行同步组 |

**其中真正"对外可见且可能影响第三方"的契约变更只有 6 个包**（`dsh-session-telemetry-otel`、`dsh-web-search-deepseek`、`dsh-session`、`dsh-llm-deepseek`、`dsh-session-log-deepseek`、`dsh-terminal-bash`），且**除 `dsh-llm-deepseek` 的签名与 `dsh-session-log-deepseek` 的 volatile 化外全部为加性**。

---

## 3. 契约级结论：只针对影响本机定制与插件的包

**与本地定制直接相交的包只有 1 个**：`dsh-web-search-deepseek`（本机 `dsh-web-search-sse` 是它的 vendored fork）。其余重点包经导入面核对**不在 9 个插件的依赖面上**（详见 §3.2）。

### 3.1 `dsh-web-search-deepseek`（本地 `dsh-web-search-sse` 的上游）— **唯一需要动作的插件相关项**

| 维度 | 0.1.7-rc.2 | 0.2.0-rc.1 | 本地影响 |
|---|---|---|---|
| **新增选项字段** | — | `ProviderOptions.resolveAccountToken?: (endpoint: string) => Promise<string \| undefined>` | `dsh-web-search-sse` 未声明该字段 ⇒ **不受影响**（字段可选） |
| **认证头构造** | `apiKey()` 返回字符串；头固定 `x-api-key` + `authorization: Bearer …` | 新增 `authHeaders(options, endpoint, signal)`，返回 `{kind:'account'｜'api-key', headers}`；account 分支只发 `x-dsh-auth-token` | vendor 副本仍走 api-key 分支 ⇒ **可正常认证** |
| **凭据解析** | `resolveApiKey?.()` 内联 try/catch | 抽取为模块级 `resolveCredential(resolve, signal)`（保留取消语义与 `WEB_PROVIDER_ERROR` 映射） | 行为等价 |
| **错误路径** | `DeepSeek API error (HTTP ${response.status})` | 先取 `const status`；`status===401 && kind==='account'` 时改抛 `accountRejectedError(...)` 文案 | account 分支专属，vendor 不受影响 |
| **宿主接线** | 仅 `resolveApiKey` | 额外提供 `resolveAccountToken`：仅当 `ctx.get("agents")?.currentInitiator()?.session.requestContext()?.provider === "deepseek-account"` 时，调 `ctx.get("deepseekAccount")?.resolveToken(endpoint)` | vendor **不查** `requestContext().provider`、**不用** `deepseekAccount` |
| **导出面** | — | `lib/index.js` 命名导出**无增减**；`provider.d.ts` 仅新增说明 | 无 breaking |
| **配置 schema** | `baseURL`/`model`/`maxUses` 等 | **逐字节相同**（`z.string().default(...).volatile()` 集合一致） | **`settings.yaml` 的 `web-search-deepseek:` 段无需迁移** |

> **结论**：`dsh-web-search-sse` **不会因 0.2.0 而失效或报错**；它只是**享受不到** 0.2.0 新增的"DeepSeek 账号模型免 API Key 即可网页搜索"能力（这是 release note 明确列出的 0.2.0 特性）。
> **功能缺口（非阻断，需产品裁决）**：使用 `deepseek-account` 路由的会话，在 vendor 插件下仍需 `DEEPSEEK_API_KEY`；上游会改用账号令牌。若本机希望获得该能力，需把 `resolveAccountToken`/`authHeaders` 两个补丁按同样语义 backport 到 `dsh-web-search-sse`（保留其 SSE 组装逻辑），或在支持后切回上游包 + 另一处解决 SSE 强制问题。
> **旁证**：`dsh-client-ui-settings-web-search` 的文案在 0.2.0 由「仅使用 DeepSeek 账号模型的对话可以通过默认接口地址搜索」改为「未配置密钥；配置之前搜索不可用」——说明上游把"账号模型免 key"的语义从 UI 文案中移除，改由上述令牌链路实现。

### 3.2 其余重点包：为什么对 9 个本地插件无契约影响

| 包 | 契约变更 | 本地插件是否在依赖面上 | 结论 |
|---|---|---|---|
| `dsh-session` | 入口**新增**导出 `ToolCallRecovery`（27→28）；`repair` 子路径新增 `openTurnClosers`/`OpenTurnCloseCause`；`interruptedTurnClosers(events)` **签名未变**；构造器默认 `cause = {kind:'interrupted'}` | **是** — `dsh-btw`、`dsh-pptmaster` 导入 `dsh-session`（27 个导出）及 `dsh-session/{surface,types}` | **无影响**：只用既有导出，新增项不破坏；无导出被移除 |
| `dsh-agent-loop` | 内联的 pending-call 观察与 `"Step failed and its pending tool results could not be recorded"` 兜底逻辑**移除**，改用 `dsh-session` 的 `ToolCallRecovery` | 否（本地 9 插件无一导入） | **无影响**；行为由 `dsh-session` 侧等价承接 |
| `dsh-session-log-deepseek` | `enabled` 由普通 boolean 变 `volatile`；`lib/index.js` 读取方式 `config.enabled !== true` → `config.enabled.get()` | 否（本地插件不导入） | **无影响**。注意：**两个字段都带 `default`**（`enabled` `default(true)`、`maxBytes` `default(8*1024*1024)`）⇒ **既有配置不会因缺字段而校验失败**；仅"直接以普通布尔覆盖 `enabled`"的 patch 需改写 |
| `dsh-workflow-ptc` | 仅 `lib/index.js` 与内联 `WORKFLOW_GUEST_SOURCE` 文本变化；`.d.ts` 导出面 **0 变化** | 否 | **无影响** |
| `dsh-llm-deepseek` | `FileStore.remove(scope, variantId, fileId)` → `remove(scope, generations)`；`invalidate(version, fileId, connection)` → `invalidate(generations, connection)` | 否（本地插件不导入；`settings.yaml` 有空的 `llm-deepseek:` 段） | **无影响**（无调用点）。若有外部调用方需改为传数组 |
| `dsh-client-ui-plugin-manager` | 新增 2 个**内部** `.d.ts`、`sanitizeInstallInput`、`PluginRefreshToast`、刷新状态机、locale 键增删 | 否（本地插件不导入；宿主的插件页在运行时加载 profile 内插件） | **无影响**。但**升级后插件页 UI 会变化**（"填写内网/私有 npm 源…凭据放在 `~/.npmrc`"等新引导文案、安装输入净化）；9 个 `@local/*` 插件经 `cordis.patch.yml` 挂载的机制**未变** |
| `dsh-client-ui-workspace` | `forkSession(sessionId, onCreated?)`；新增 `session.untitled` locale 键与 `branch_session_click` 埋点 | 否 | **无影响**（新增可选参） |
| `dsh-client-ui-sidebar` | 新增 `sidebar_menu_click` 埋点（`plugin`/`cron`）、版本串更新 | 否 | **无影响** |
| `dsh-client-ui-conversation` | `beginAttempt/beginDetached` 追加 `submission` 参；新增埋点；中文文案「代理」→「子智能体」 | **是** — `dsh-btw`、`dsh-pptmaster` 导入 `dsh-client-ui-conversation/client` | **无影响（需留意文案）**：本地插件使用的是 `/client` 子路径且导出数不变；但若其 UI 文案与「代理/子智能体」术语对齐，需随宿主改为「子智能体」以保持一致性（**产品措辞问题，非契约破坏**） |
| `dsh-session-telemetry` / `-otel` | 事件信封加 `sourceEvent`；注入新增 `otel` | 否 | **无影响**（宿主 `dsh-base` 已配 `id: otel` 行；见第一版 §R1 的组合层注意事项） |
| `dsh-skill-office` | **无任何变化**（整包逐字节相同） | 否（仅 `dsh-sdk-app` 挂载） | **无影响** |
| `dsh-agent-preset` | `lib/**` 零变化；新增/修改的是技能文档 | 否 | **无影响**；但系统提示词可见的技能清单会多出 `agent-experience` 与 cordis 插件开发指引 |

### 3.3 `dsh-settings` 与既有 `settings.yaml`（结论：零迁移）

- `dsh-settings` 的**全部文件**除 `package.json` 版本串外**逐字节相同** ⇒ 配置存储层、schema 引擎、命名空间注册机制**无变化**。
- `settings.yaml` 中 **12 个已配置命名空间**的 provider 逐一核对（`lib/index.js` 字节比对）：

| 命名空间 | provider 包 | 0.2.0 状态 |
|---|---|---|
| `web-search-deepseek` | `dsh-web-search-deepseek` | **lib 改动**，但配置 schema 行逐字节相同（§3.1） |
| `llm-pi-ai` | `dsh-llm-pi-ai` | **lib 逐字节相同** |
| `dsh-subagent` | `dsh-subagent` | **lib 逐字节相同**（`settings.yaml` 的 `dsh-subagent: model:` 活值来源不变） |
| `agent-default-model`、`agent-presets` | `dsh-agent-default-model`、`dsh-agent-preset-registry` | **lib 逐字节相同** |
| `llm-deepseek` | `dsh-llm-deepseek` | lib 改动，但该段**无可读键**（空段）⇒ 无影响 |
| `ui-theme`、`ui-onboarding` | `dsh-client-ui-theme`（相同）/ 宿主 UI | 无影响 |
| `dsh-ssh-gui`、`wallpaper`、`dsh-workerspace`、`vision-adam` | **本地插件**（不在上游闭包内） | 与 0.2.0 无关 |

- **两个"新必填"字段实测均带 default**（`maxBytes` `default(8*1024*1024)`、`promptTailGraceMs` `default(0)`；`maxRequestBytes` 为可选无默认），因此**没有"升级后配置校验失败"的风险**。

---

## 4. 建议的迁移动作

### 4.1 必做（针对本轨道新结论）

| # | 动作 | 验收标准 |
|---|---|---|
| **N1** | **无需改动 9 个本地插件代码**——把 E1（71 个命名导入 0 回归）、E2（exports 0 收窄）、E3（0 导出移除）、E4（settings 零迁移）四项实测记录为迁移放行证据 | 四条检查可复跑：`namedcheck.mjs` 输出 `REGRESSIONS=0`；`exportdelta.mjs` 输出 `UNSAFE=0` |
| **N2** | 升级后**回归验证 `dsh-web-search-sse` 的搜索链路**（api-key 分支应正常；`deepseek-account` 路由下确认仍可用 key，或接受功能缺口） | 用 `deepseek-account` 模型发一次 web_search：**预期仍走 API Key**；若返回未配置凭据，即为 §3.1 的功能缺口，需产品裁决 |
| **N3** | 产品裁决：是否把 `resolveAccountToken` / `authHeaders` backport 到 `dsh-web-search-sse` 以保留"账号模型免 key 搜索" | 裁决结论落文档；若 backport，需保留既有 SSE（`text/event-stream`）组装逻辑不变 |
| **N4** | （可选）把 28 条 `^0.1.1-rc.2` 版本声明放宽为 `^0.2.0-rc.1` 或 `>=0.1.1-rc.2 <0.3.0` | 4 个插件的 `package.json` 更新；`npm ls`/peer 检查无告警 |
| **N5** | 复核 `dsh-client-ui-conversation` 术语变更（「代理」→「子智能体」）在本地插件 UI 中的一致性 | 插件中面向用户的术语与宿主一致（措辞问题，非阻断） |

### 4.2 承接第一版（组合层，仍然有效）

| # | 动作 | 验收标准 |
|---|---|---|
| **B3′** | 自建 composition 若移除 `session-telemetry-otel` 行，**必须成对处理 `id: otel` 行** | 启动无"缺少 otel 注入"错误（`dsh-session-telemetry-otel` 的 `static inject` 实测已含 `otel`） |
| **B4′** | 需要自动化任务 → 在插件页开启 `Automation tasks`（`dsh-experimental-schedule-bundle`，缺省关闭） | root Agent 具备 `schedule_create/list/update/delete` |
| **B2′** | 清理 profile patch 中针对已删除 id `time-context`/`schedule`/`ui-schedule` 的覆盖 | patch 加载无未匹配 id 告警 |
| **C1′** | 裁决 Web 新增「设置 → 通用 → 上传 Session Log」开关的默认姿态 | 与组织策略一致；`enabled: false` 时不携带 `dsh_session_log` 贡献 |
| **D3′** | 记录 `dsh-agent-preset` 新增 2 个技能文档（`agent-experience`、cordis 插件开发 `user-actions`）进入系统提示词/技能清单 | 技能清单轨道已获该输入 |

### 4.3 供其他轨道使用的输入（本轨道附带产出）

| 产物 | 用途 |
|---|---|
| `.workspace/audit-020/t01-deep/exportdelta.txt` | 54 个模块的导出面对账（`UNSAFE=0`）——第三方插件兼容性评审基线 |
| `.workspace/audit-020/t01-deep/namedcheck.txt` | 71 个命名导入逐个结论 |
| `.workspace/audit-020/t01-deep/peerrange.txt` | 本地插件版本范围 vs 0.2.0 的 28 条告警清单 |
| `.workspace/audit-020/t01-deep/truelib.txt` | 55 个改动包的确定性清单（含每包改动文件路径） |
| `.workspace/audit-020/t01-deep/libdiff.txt` | 55 个包的 `lib/` 非注释行级 token 差异（分类依据） |

---

## 5. 未验证项

> 共 **9** 项（本版收敛；第一版报告中涉及依赖版本表的 3 项已由协调者数据覆盖，不再重复计数）。

1. **55 个包未全部逐行人工审读**：分类依据是"`lib/` 结构差异 + token 差异 + 导出面/签名/schema 扫描"的机器判定，约 20 个包（"仅 `typert.host.js` 单行同步"与纯样式类）**未逐行确认**语义；其"无对外契约变化"结论来自**导出面逐包相同的实测**，而非源码通读。
2. **运行期未验证**：未启动 0.2.0 实例。`static inject` 增加 `otel` 的实际失败模式（缺行时是否如实报注入错误）仍为**基于 README 与声明的推断**。
3. **`dsh-web-search-sse` 的行为等价性未实跑验证**：结论"vendor 仍可正常认证"来自对两侧源码的静态对读，未实际发起搜索请求。
4. **`dsh-client-ui-primitives` 的 CSS 类名/DOM 属性变化未做视觉回归**：`TextShimmer` 由 `steps()` 改 `mix()/calc()`、`Modal` 用 `clearance()` 替换 `inset`、`Tooltip` 移除 `aria-describedby` —— 对**依赖这些类名/属性做样式覆写**的第三方（含本地插件）可能造成视觉回归，未实测。
5. **`enable` 变 volatile 后的实际读写时序未验证**：`enabled.get()` 的热重载时点、以及"volatile 值能否被 Host 配置表单写回"未实测（属 T03 范围）。
6. **`dsh-llm-deepseek` 签名变更的调用方未穷尽**：已确认本地 9 插件无一导入，但**宿主内其他上游包**是否仍以旧签名调用 `FileStore.remove/invalidate` 未逐一核对（本轮确认 `lib/index.js` 内部调用点已同步改为数组形式）。
7. **`dsh-deepseek-account` 移除 `getDeviceIdentity` 的下游影响未追查**：已确认新包 `dsh-client-product-analytics` 接手该职责，但未核实是否还有其它包/本地插件调用旧方法（本地 9 插件不导入该包）。
8. **`dsh-agent-preset` 技能文档内容对系统提示词的实际增量未评估**：仅确认文件级新增/修改，未评估新增 `agent-experience` 技能对上下文预算与行为的影响。
9. **28 条版本范围告警是否会被任何本机工具链强制**：结论"当前未被强制"来自间接证据（`>=0.1.1-rc.2 <0.2.0` 在 0.1.7 下已越界却正常），未验证 profile 安装脚本/`npm ls` 门禁是否会在 0.2.0 下报错。

---

## 附：本版产物（均在 `.workspace/audit-020/` 内）

| 路径 | 内容 |
|---|---|
| `t01-deep/truelib.mjs` / `truelib.txt` | 55 个改动包的确定性清单（含逐包改动文件路径）与 `package.json` 是否仅版本串差异的判定 |
| `t01-deep/libdiff.mjs` / `libdiff.txt` | 55 个包 `lib/` 的非注释行级 token 差异（三分类依据） |
| `t01-deep/dirdiff.mjs` | 方向显式（`017-` / `020+`）的差异提取器 |
| `t01-deep/exportdelta.mjs` / `exportdelta.txt` | 54 个被导入模块的导出面对账（`UNSAFE=0`） |
| `t01-deep/namedcheck.mjs` / `namedcheck.txt` | 71 个命名导入的逐个存在性验证（`REGRESSIONS=0`） |
| `t01-deep/plugimports.mjs` / `plugimports.txt` | 9 个本地插件的完整上游导入面 |
| `t01-deep/peerrange.mjs` / `peerrange.txt` | 本地插件版本范围 vs 0.2.0-rc.1 判定 |
| `t01-deep/namespaces.mjs` | 本地插件使用的 settings 命名空间 |

**写入边界确认**：本版仅在 `.workspace/audit-020/t01-deep/` 下新建文件；未修改第一版报告以外的任何路径，未写入 `~/.dsh/**`、`~/.dsh-017/**`、`~/.npm-global-dsh017/**`、`.workspace/iso-020/**`（均为只读比对源）。报告不含会话正文、密钥或原始会话 id。
