# 切换前裁决记录（grill-me 六轮，2026-09-29）

用户于本轮明确新增要求：**「不接受双轨并存」「明早之前必须出一个完整可用的、迁移到 0.2.0 的 DSH」**。
其余为本轮逐条裁决，**执行档不得重开**。

| # | 议题 | 裁决 |
|---|---|---|
| D1 | 迁移路径（N17） | **选 (c)** —— 0.1.1 管历史、0.2.0 管新会话、零数据改写（已双向实测：0.1.1 `decodeStorageRecord` 零错误展开 65 145 打包行 → 1 364 372 事件；0.2.0 仅 3%） |
| D2 | 遥测 | **`DSH_TELEMETRY_MODE=DISABLED`** |
| D3 | 凭据面 | **搬入模型配置，让新实例可用**（接受该实例联网发起模型请求） |
| D4 | 3097（0.1.7）去向 | **手动择时退役**（不设自动触发条件） |
| D5 | 本轮插件范围 | 只做「纯技术、无产品取舍」的 3 个 |
| D6 | 文档收口 | **合并成单一操作入口 + 保留证据附录**；**以 `RUNBOOK-020.md` 为主干**，并入切换预案 |
| D7 | WE 升版次序（W-20） | **先把 3 处补丁回流到 0.1.4 源码，再升版** |
| D8 | N2 子代理路由 | 官方不支持热切换 ⇒ **重新打宿主补丁**；**从 profile patch 条目的 config 读值** |
| D9 | preset 模型值 | **统一为 `deepseek-v4-pro`**（跟随现役实际生效值；现役 preset 写 flash 而 settings 段是 pro，已自相矛盾） |
| D10 | preset 基底 | **改用官方 `standard`**，只保留必要的 profile 覆盖 |
| D11 | WE 的 peer 范围 | **改写为 `^0.1.5-rc.1 \|\| ^0.2.0-rc.1`**（升版也解决不了 peer 闸门，两版范围实测都拒绝 0.2.0） |
| D12 | WE 落地位置 | **现役与新根同时更新** |
| D13 | WE 的 package.json 偏离 | **沿用现役改动**（peer 升级 + `cpu-features`/`koffi`/`node-pty` + `ssh2 ^1.17`） |
| D14 | 必要 settings 段 | **`ui-theme` + `agent-default-model` + 子代理路由 + `wallpaper` + `llm-pi-ai` + `web-search-deepseek` + `vision-adam` + `dsh-ssh-gui` + `dsh-workerspace`** |
| D15 | WE↔ssh-gui 通道耦合 | **与 ssh-gui 同批改造**（0.1.4 移除了独立 `/dsw` 通道，而 ssh-gui 客户端硬编码 `CH_DWS="/dsw"`） |
| D16 | 3 个 settings 断层插件 | **三个都修**（`dsh-session-board` / `dsh-vision-adam` / `dsh-subagent-model`） |
| D17 | 办公入口 | **Route B（改成 host 侧插件）** —— 明确推翻旧裁决；**前置：先查清官方能力**（已派勘查档） |
| D18 | `remoteHosts` 回归 | **评估用右栏停靠面（`dsh-client-ui-sidebar-right`）重新实现** |
| D19 | taste 语言基线 | **中文存储 + 中文展示**（符合实测现状）；**只清理残留的英文侧车机制**，不回译数据 |
| D20 | 执行次序 | **先修存量、再开新特性** |
| D21 | 证据去留 | `n17-evidence/`（1.4 GB）**保留至少到切换完成** |
| D22 | (b2) 报官方 issue | **等存量修复完再写** |
| D23 | btw | **下一轮修**（21 个单元；U07 读面 / U15 导航落点 / U11 `prompt-transform` 三处需先定案） |
| D24 | 中间版本 | **明确不追 0.1.7 / 0.1.8 等中间版本** |
| D25 | 双轨并存 | **不接受** —— 目标是一个完整可用的 0.2.0（见下方执行解释） |

## D25 的执行解释（协调者按用户最终指令裁定）
用户要求「明早之前出一个完整可用的 0.2.0」，同时「不接受双轨并存」。两者叠加的解释是：
**交付一个功能完整的 0.2.0 实例，并把「切换」收敛为一条已实测的启动命令**；
但**不在用户离场期间不可逆地处置 3080 上的 2 466 份历史会话**（那是不可再生数据）。
⇒ 落地形态：
- 0.2.0 在新端口完整可用（插件全加载、可对话、设置到位）；
- 3080 保持原样不动（保历史与回滚路径），**待用户到场后一次性完成最终切换**；
- 切换方案与回滚命令在交付文档中给出，且**已实测**。

---

## D17 重大更新：Route B **不需要自建插件** —— 官方已有现成件

Office Route B 的勘查档（`OFFICE-ROUTE-B-CAPABILITY-PROBE.md`，656 行）查出**决定性事实**，把 D17 的成本大幅下调：

### 🔑 官方已把「外部事件 → 工作区会话」打包成 0.2.0 官方插件
**`@deepseek-ai/dsh-webhook`** —— 包描述原文：*"creates Workspace-backed DeepSeek Harness Sessions"*；
README：*"the one built-in action, creating an ordinary root Session inside a Web Workspace"*。
其**内置动作入参恰是** `{workspacePath, title, prompt, agentPreset, permissionPreset, model?}`，
运行时自己完成「解析/创建工作区 → 以该路径为 `SessionHeader.cwd` 调 `ctx.agents.create()` → 挂 preset → attachSession → 设权限 → 设标题 → 投 prompt」，**并带完整回滚**。

配套官方适配器 **`dsh-webhook-github`** 给出入口范式：在 `ctx.webServer` 上注册**一个非 `/api` 的精确路由**
⇒ **完全绕开 `admit()` cookie 门**，鉴权自带（HMAC 先于 JSON 解析、限长、202 不等待）。

⇒ **D17 从「自研 host 侧插件」简化为「配置 + 复用官方 `dsh-webhook`」**，自建面只剩「投递侧触发 + 白名单」。

### `workspace.list` 的替代品已查实
`workspace` 命名空间在 0.2.0 **只有 11 个端点且没有 `list`**。列举改为**流**：
**`workspace/follow`**（`@Remote({mode:"stream"})`）—— 首个 item 即 baseline `{items, archivedSessionIds, pinnedSessionIds}`，其后增量。
（注意 `session/list`、`workspaceFiles/list`、`directoryPicker/list` **语义不同、都不是替代品**。）

### ⚠️ 新增信任边界（必须写进实现要求）
Route B 开的是 `/api` cookie 门**之外**的一扇窄门：
`dsh-host-webserver` 的**自注册路由本身不带任何 TLS / 认证 / Origin 策略**（README 原文），默认 loopback，但一配 `0.0.0.0` 即裸奔。
⇒ **实现必须**：自建签名鉴权 + 目录/扩展名白名单，**优先走 stdio（照 `dsh-acp`）而非 HTTP**。
与现役 Route A 相比：信任面**净变小但性质改变** —— Route A 时代 0.1.1 只把 14 个方法钉 loopback、其余 ~38 个（含 `session.create`/`workspace.create`）对任何过 Host/Origin 栅栏者开放；Route B 收窄为「自建精确路径 + 自建鉴权 + 白名单」，但**不受 0.2.0 新 cookie 门保护**。

### 供实现使用的源码锚点（已核实）
- **会话创建面**：`ctx.agents.create(options)` = `dsh-agent/lib/index.js:451`；类型注释明写该面是给消费者（**举例即 ACP bridge**）编程用。官方实际调用者：`dsh-acp:695-704`、`dsh-headless:316-321`、**`dsh-webhook:163-175`**。
- **`ctx.sessions` 的 `create` 不够用**：类型注释原文 *"a session published outside that lifecycle persists nothing"* ⇒ **必须走 `ctx.agents`**。
- **修正一处我方表述**：`open(id,'write')` **不在 `ctx.sessions`**，而在 **`ctx.sessionPersistence`**，是**日志单写者所有权**、**无任何权限含义**。
- **`session/create` 语义**：`workspaceId` XOR `cwd`；缺会话时会 `mkdir(cwd,{recursive:true})` ⇒ 走 webhook 的 `workspaceRegistry.create()`（**不 mkdir**）可回避任意建目录。
- **鉴权不可关**：`Config` 只有 4 个字段，README 明说 *"there is no method-specific loopback tier"*；0.2.0 全树 `PRIVILEGED` **0 命中**（0.1.1 的名单机制已删）。
- **插件天然绕过**：*"a composition without Connection … owns an operator scope"* + Gateway `operatorPeer()` ⇒ 进程内 `ctx.typertGateway.invoke({namespace,method,args,signal,peer?})`。

### office 能力现状（与 D19/新台子相关）
- `dsh-skill-office` **只被 `dsh-sdk-app` 挂载且受 `DSH_PRIMARY_RUNTIME` 门控**，**web bundle 未挂载**；但它是普通插件（`inject:["skills"]`）⇒ **可被 profile 加一行复用**（`assetRoot`/`node` 须绝对路径）。
- `dsh-office-to-pdf` **在 web layer 已挂载**（`dsh-web-app/cordis.patch.yml:269-270`），端点 `officeToPdf/render` + `officeToPdf/generation`，且 **in-process `convert()` 不需要授权服务**。
- **0.1.1 完全没有 office 能力**（`ls $T011 | grep -i 'office\|libre'` 为空）⇒ **office-to-pdf 是「迁到 0.2.0 才新增」的能力**。

### 三条影响决策的未核项
1. 全部结论为**静态源码核验、未实跑**；`dsh-webhook` 挂进本部署后其 6 个 inject 服务是否全解析、与自建 preset 是否兼容，**未实跑**。
2. **「创建会话需人工确认」我没找到官方开放面**（未穷尽排查 `ctx.userQuestions`/`dsh-user-approval`/`dsh-permission-presets`）；
   建议做法：**适配器只落待办，GUI 侧确认后再 `dispatch()`**。
3. `dsh-webhook`/`-github` 的「无 bundle 挂载」grep **未覆盖 CLI 源码与 profile 全层级**。

---

## 规划 A 的精确实施卡片（已定位到行，可直接开工）

用户指示「不接受双轨并存、明早要完整可用」。协调者裁定**先做规划 A（3 个插件 + N2）**。以下为已核实的精确改动点。

### A-1 `@local/dsh-subagent-model`（最小，先做 —— 它同时是 N2 的读值源）
**现状**（`lib/index.js`，49 行）：用 `installSettingsSection(ctx, NS, Config, {...DEFAULT_ROUTE, ...config}, {setSource, onChange})` 把值挂成「热 settings 源」，并 `export { Config, DEFAULT_ROUTE, NS, apply, inject, name }`。
**0.2.0 事实**：`installSettingsSection` / `settingsNamespace` 已删；`Config` 自动成表单且**不再有 `setSource`**；条目 config 只能由 profile patch 提供（**静态**）。
⇒ **热切换必须改换读值源**：
1. 把 `apply(ctx, config)` 改为：**把生效值挂到一个运行时服务**（例如 `ctx.set('subagentDefaultRoute', { get: () => live })`）+ 用 `ctx.effect` 做生命周期清理；
2. 若仍要「改值即热生效」，需要一条**运行时可变**的通道 —— 候选：`ctx.inject(['configForms'], …)` 读条目当前值，或自建一个带 RPC 的小服务（客户端表单调用它写值）。**该二选一需实测确认哪条可用**（`settings.get()` 已不存在，这是 N2 的真障碍）。
3. `export` 面保持 `{ Config, DEFAULT_ROUTE, apply, inject, name }`（去掉 `NS` 或保留为字面量）。

### A-2 N2 宿主补丁（`dsh-tool-subagent`）
**补丁已完整提取**（现役件 vs 官方 0.2.0 的 diff）：
- 函数 `effectiveConfiguredAgentOptions(runtimeCtx, configured)`：现役 `:105-136`（含 JSDoc `:107-118`），逻辑 = 读 `runtimeCtx.get("settings").get(ns)`，用非空 `provider`/`model` 覆盖 preset 的 `agentOptions`，读失败则原样回落、永不抛。
- 调用点：现役 `:527-530`（`// P0' dsh-subagent settings default layer`）→ **0.2.0 对应位置是 `:496`**（`const requestedChildAgentOptions = requestedAgentOptions(parentOptions, …)` 之前插入）。
- 另含 2 处**更早的本地偏离**：`SUBAGENT_SECTION_ORDER = 116.5`（现役 `:282-283`）与 `maxDepth` 的 `z.union([…z.const("provider-mode")])`（现役 `:301`）—— 需一并决定是否沿用。
- **必改**：函数体内的 `settings.get(ns)` 在 0.2.0 不存在 ⇒ 改为读 A-1 挂出的服务。
- 目标文件：`$ROOT/prefix-cli/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tool-subagent/lib/index.js`（**0.2.0 官方件，662 行**）。

### A-3 `@deepseek-ai/dsh-session-board`（会话看板）
- 现状：`lib/index.js:78-79`，`settingsNamespace("session-status-board")` + `installSettingsSection(ctx, NS, Config, config, {…})`。
- 改动：去掉旧 import；`Config` 保留（自动成表单）；`apply(ctx, config)` 内直接用 `config`。
- 其条目 id 与命名空间**当前不一致**（段名 `session-status-board`），按 D14 需在 patch 里对齐。
- **注意**：目录声明 `id: session-status-board`（`cordis.patch.yml:36-39`）。

### A-4 `@deepseek-ai/dsh-vision-adam`（识图）
- 现状：`lib/index.js:3` 具名 import；`:81` `settingsNamespace("vision-adam")`；`:227` `installSettingsSection(…)`。
- 改动同上。**注意**：它是本地演进的 0.2.0-v2 线（与备份里的 pristine 0.2.0 不是同一条），改前先做备份。

### A-5 patch 层（三者的承载）
- 现 patch 里**没有** `@local/dsh-subagent-model` 条目（`grep` 无命中）⇒ 需新增 insert。
- 组合树中已存在的是官方 `subagent-model-selection-settings`（**不同东西**，勿混）。
- 落地后需复核 `--dump-config` 仍为 199 条目（±新增条目数）。

### 验收标准（A 完成时）
1. `--dump-config` rc=0；2. 冷启动 `disabling = 0`；3. **未激活插件 = 0**（当前 2）；4. 三个插件各自 `import` 成功；5. 子代理路由值可读且与 patch config 一致；6. 现役指纹不变。
