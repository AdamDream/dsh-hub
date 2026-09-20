# 调研 E — 综合热载落地方案设计与裁决（审计报告）

- **审计档**：调研 E（两阶段闭环【审计】阶段子代理，路由 adam/deepseek-v4-flash）
- **时间**：2026-09-16
- **任务**：独立盘点"免重启热载宿主代码"的真实盘面 → 方案矩阵（A–F）→ P0 建议 → 最终裁决（含"不做"选项）
- **约束**：只读取证（未写全局树/`~/.dsh` 任何文件）；报告文件为唯一写产物
- **方法与证据**：以运行中部署盘面（`~/.npm-global/lib/node_modules/@deepseek-ai/dsh` 全局树 + `~/.dsh/profiles` 农场 + 本仓库 `.workspace` 交付物）实读为准；证据编号 E1–E17 见附录

---

## 0. 结论摘要（TL;DR）

> **裁决：不做"通用宿主代码热载"大改造（A/B/C/E 全部不建议立即投入）；维持"重启 + 批处理"为主路径，叠加两个低投入高收益增量：D（自动重启编排，把"手动重启"变"保存即重启"）+ F（settings 驱动的行为开关，把"为改参数重启"降到零）。**
>
> 关键新发现（修正用户已知约束的 ③）：**`~/.dsh/profiles/web/cordis.patch.yml`（profile patch 层）本身是热的**——`dsh web` 启动即注册了 `hmr.registerConfig` 对 patch 文件的精确 watch（E1/E5），编辑 patch（insert/disable/config 覆盖）会事务性重放根 Include（E4），机制上**插入新插件条目可运行时挂载**。真正冷（必须重启）的是：**一切 node_modules 内的代码**（全局树宿主 lib + 农场插件 lib）——cordis HMR 默认忽略 `**/node_modules` 且 web 面 HMR root 为空数组（E1/E2），且重载算法对 node_modules 内模块不产生 reload（E2 分析），外加 typert/tools 重复注册守卫（E10/E11）。
>
> 高频重启原因（独立判断）：**① 迭代自装 @local 插件宿主 lib（btw/ssh-gui/usage/workerspace/pptmaster）——次数最多；② 官方补丁包成批改（lag-fix / 015 借鉴 / slots，次数少但每次全量重启）；③ 新增插件落地（9 月内 3 次：pptmaster/workerspace/ssh-gui，每次 copy+patch+重启）**。D 精准覆盖 ①② 的"忘记重启/被迫中断"痛点，F 覆盖"改一个行为参数也要重启"的次高频痛点。

---

## 1. 独立盘点：五条已知约束取证 + 补充遗漏

### 1.1 装配/热载机制地图（先立基线）

`dsh web`（= `--profile web`，E15）→ `bin.js` → `runProfile`（E1）做四件事：

1. 装配：bundle 层（`web/package.json` 的 `dsh.profile.bundles`）→ profile patch 层（`~/.dsh/profiles/web/cordis.patch.yml`）→ home patch 层（`~/.dsh/cordis.patch.yml`，当前不存在）→ `--patch` 覆盖层 → 空根 `cordis.yml` 上的 Include 树（E1 L240-254）。
2. 挂 HMR：**`config: { root: [] }`**（E1 L259-262）——模块级 watch root 为空，只 watch 精确注册的 config 路径。
3. **热 patch**：`watchUserPatches(ctx, { filename: profile patchPath })` + home patch 路径（E1 L264-273）——`hmr.registerConfig` 精确 watch → 事务性 `entry.update`（E4/E5）。
4. 常驻进程：SIGTERM/SIGINT 走 5s 有界 dispose（E1 L230-239），无 supervisor（E17）。

### 1.2 五条约束逐条核实

| # | 约束 | 核实结论 | 证据 |
|---|---|---|---|
| ① | 宿主 lib 改动需重启（Node 模块缓存） | ✅ **属实**。宿主 lib 全在 node_modules（全局树 32 包 + 农场 @local 拷贝），而 (a) web 面 HMR root=[] 不 watch 任何模块；(b) cordis-hmr 默认 ignored 含 `**/node_modules`；(c) 即使放开 watch，重载算法 `loadDependencies` 跳过 node_modules 且 externals 判定把主入口依赖树（宿主 lib 正是其中）判为 externals → `loader.exit()`（E2）。ESM loadCache + CJS `Module._cache` 双重缓存（cordis-hmr 自带注释，E3）保证旧模块不被新代码覆盖 | E1, E2, E3 |
| ② | 新增 dsh.client 声明需重启（boot 图） | ⚠️ **基本属实，需细分**。客户端模块图本身是**动态**的（loader 条目挂载/卸载实时增删行 + `onGraphChanged`，E9）；client bundle **内容**热载（E8）。但：**宿主侧声明**（`lib/typert.host.js`，如 btw 的 sideChat 服务面）是宿主模块，冷；`package.json` 的 `dsh.client` 元数据被 `resolveMeta` 一次性缓存（E9 L377-404），改元数据/新增注入需重启；"immediately" 预载行在 boot 计算 | E8, E9, E10 |
| ③ | 新插件/cordis 服务注册需重启 | ❌ **机制上不成立（重大修正）**。profile patch 层是热的：编辑 `cordis.patch.yml`（insert 新条目 / disable / config 覆盖）→ 精确 watch 触发 → `Include._apply` → `EntryGroup.update` 事务性增删改条目（E4/E5），插入的新插件在**包已就位**时理论可运行时挂载。但：**实践中团队以重启为准**（ssh-gui RUNBOOK §4 明文"HMR 不覆盖 host 装配变更，必须重启"，E13）；且**插件 lib 代码改动**（条目已存在、模块已加载）不随 patch 重放而重载（loader 返回缓存模块）——**新插件的"注册"热，"改插件代码"仍冷**。插入新插件在运行时从未被验证（只读无法实测），存在未证可靠性与级联风险（client 图重排、typert/tools 注册、webServer 路由） | E1, E4, E5, E13 |
| ④ | settings/skills/client-bundle 已热载 | ✅ **属实（三面都验证）**。settings：`dsh-settings-file` chokidar watch 默认开（E6），改 `~/.dsh/settings.yaml` 即热刷新（vision-settings 页写入即生效为旁证）；skills：`dsh-skill-filesystem` watch manager + provider invalidation（E7），`~/.dsh/skills` 增改 SKILL.md 新会话即见；client-bundle：`dsh-client-hmr` 按图行轮询 clientPath 产物 mtime/size → `rebuilt(id)` 换 rev → SSE `/plugins/events` → 浏览器热换（E8）。**前提**：需先跑构建把 `src/` → `lib/client.js` 产物写盘（轮询只看产物） | E6, E7, E8 |
| ⑤ | 我们的补丁全是宿主 lib（全局树）+ 自装插件宿主 lib（profiles） | ✅ **属实，且可量化**。官方补丁面 32 包、225 个 .js（deploy-015 28 包 + lag-fix 面 + slots，E12）；农场 `@local` 6 真实目录 + `@deepseek-ai` 下 3 本地目录（session-board/taste/vision-adam）与源码工作区逐文件一致（diff -rq 空，E12）；官方包全部符号链接到全局树，故补全局树=补农场（E12）。非冷面只有 settings（热）+ client 产物（热，需构建） | E12 |

### 1.3 补充遗漏的"需重启面"（用户清单未覆盖）

1. **`web/package.json` 的 `dsh.profile.bundles` 变更**（bundle 层组合）→ 仅 boot 装配时读 → 重启（E1）。
2. **bundle 层自带 patch**（如 `dsh-web-app` 包内 `cordis.patch.yml` 的 directory-picker 行）→ boot 时叠加，不热（E12 final-audit-c §2）。
3. **插件 `package.json` 的 `dsh.client`/`dsh.bundle` 元数据变更** → `pkgMeta` 缓存（E9）→ 重启。
4. **新 client bundle 且声明 `immediately: true`** → boot 预载集 → 重启。
5. **插件新增第三方依赖 / 换原生模块**（ssh2/cpu-features/koffi/node-pty 等 native addon）→ 已加载模块图不重解析、native 绑定不可热换 → 重启。
6. **`.env` / bootstrap-only 环境变量**（`dsh-launch-environment` 白名单）→ 启动期注入 → 重启。
7. **根 `cordis.yml`**（PROFILE_ROOT_FILENAME）→ boot 时读 → 重启。
8. **webServer 路由/SSE 端点**（插件 mount 时注册，如 btw 的 `/side-chat/*`）→ 需插件重挂载。
9. **浏览器侧 shell**（`dsh-web-frontend` dist / index.html）→ 需**重建 Web 产物 + 刷新页面**（非进程重启，但属"改码要等构建"，见系统级 GUI 说明）。
10. **agent-presets 目录**：新会话生效（无需进程重启，但既有会话固定）。

---

## 2. 方案矩阵（A–F）

统一评估维度：改动面 / 覆盖的改动类型 / 风险（服务重复注册、状态丢失、内存泄漏、事件监听泄漏）/ 回滚 / 与既有补丁链的关系。

### A — require-cache 清理 + 重装载纯函数模块

- **改动面**：自建宿主热载垫片（新 @local 包或并入既有补丁包）+ **改造既有补丁代码为"注册壳 + 纯函数体"**；目标模块遵守"无注册副作用、无模块级单例"约定。
- **覆盖**：纯函数/纯数据模块（schema、格式化、算法、常量）的代码改动。
- **风险**：中间态（重载一半失败需回滚）；闭包捕获旧引用（调用了旧函数）；模块级单例/全局状态泄漏；副作用重复执行（一旦混入注册，触发 E10/E11 守卫直接抛错）。
- **回滚**：cordis-hmr 已有可借鉴的备份/回滚模式（E3：ESM+CJS 双缓存备份、失败整体还原）。
- **与补丁链**：与 32 包官方补丁正交但**要求把补丁拆层**——我们的补丁绝大多数是注册/装配型（waterfall 挂接、服务类、工具注册、事件订阅），纯函数占比低，改造成本高。
- **可行性旁证**：cordis-plugin-hmr 的 `partialReload` 就是本代码库内现成的"清 loadCache + 清 require.cache + 回滚"实现（E3），且注明 Node 22/24 下 CJS 经 `import()` 双缓存细节——**机制可行，但它是为 node_modules 外的文件设计的**（E2 分析：node_modules 内模块不会被 reload）。**需要实验验证的正是"把 CJS+ESM 混合插件产物当目标"时行为是否符合预期。**

### B — cordis reload 通道补丁（打通条目级 reload）

- **改动面**：全局树 3 个官方包：`cordis-plugin-hmr`（放开 node_modules 忽略 + 解除 `loadDependencies`/`isExcluded` 的 node_modules 排除 + externals 豁免）、`cordis-plugin-loader`（新增条目级 `reload(name)` 通道）、`dsh-app-boot`（装配时对农场/补丁包注册精确 watch root）。
- **覆盖**：插件 lib 代码改动（dispose 旧 fiber → 清缓存重 import → 重挂纤维）；宿主 lib 若在 externals 之外。
- **风险**：**核心风险是 externals**——宿主 lib 在主入口依赖树内，改动触发 `loader.exit()`（E2 L215），等于把重启变成"看门狗拉起"；服务重复注册/状态丢失已被 E10/E11 + effect 清理机制大幅缓解（typert/tools 全部注册走 `ctx.effect`，fiber dispose 自动反注册，"HMR cleanup" 是官方设计意图，E11 L2800-2801），但**未验证每插件是否把副作用都挂进 effect**；事件监听泄漏（部分插件裸 `ctx.on`/`process.on`）需逐个审计。
- **回滚**：HMR 已有回滚（E3）。
- **与补丁链**：直接复用 patch-official 流程，但属于对官方安全边界的**系统性放松**——官方刻意排除 node_modules + externals→exit，说明官方判断宿主代码热载不安全。

### C — worker 隔离热替换

- **改动面**：大。插件/补丁代码移入独立 worker_thread/child process + RPC 边界（session/storage/tools/approval 全部跨进程）+ 版本切换 + 流量切换。
- **覆盖**：一切宿主代码（含原生依赖）。
- **风险**：状态迁移（会话、存储句柄、事件订阅跨进程）；双写/双事件风险；RPC 序列化限制（函数引用/EventEmitter 不可跨线程）；调试复杂度陡增。
- **回滚**：切回旧 worker。
- **与补丁链**：与全部既有补丁冲突（补丁都是进程内假设）。

### D — node --watch / supervisor 自动重启（最粗粒度热载）

- **改动面**：进程管理面（启动脚本或 systemd/pm2；或 `node --watch`），**零宿主代码改动**；可选配合现有 5s 优雅 dispose（E1）。
- **覆盖**：一切（全量重启）。`node --watch` 默认 watch 已加载模块图——宿主 lib/插件 lib 全在图上（E15 加载链），改即重启；是否含 node_modules 需实测（v22 行为待验证，见 §3.4）。
- **风险**：**进行中 agent 回合中断**（in-memory 回合丢失，需人工重发；会话本体持久化在 jsonl，重启后可恢复，E14 浏览器重连已具备且被我们 patch 加固）；watch 抖动（保存半截文件触发多次重启——可用 debounce/快照校验缓解）；启动耗时需实测。
- **回滚**：天然（重启即回到新状态；出错可手动回滚部署）。
- **与补丁链**：完全正交，不碰任何补丁。

### E — 插件级"再激活"通道（重跑 defineTool/注册）

- **改动面**：自建 `dsh-plugin-reactivate` 宿主包 + **每个 @local 插件适配**（启动逻辑拆成可重入 activate/deactivate；副作用显式挂 effect）。
- **覆盖**：我们自己的 @local 插件宿主代码（btw/ssh-gui/usage/workerspace/pptmaster）——**与最高频重启原因 ① 精确对齐**。
- **风险**：服务重复注册是核心难点但已部分缓解（typert/tools 的 effect 自动反注册，E10/E11）；状态丢失（插件内存态如 btw 的 registry、usage 的聚合缓存）；每插件适配工作量 ×6。
- **回滚**：再激活失败 → 回退旧模块实例。
- **与补丁链**：新增一层，不动官方补丁；但要求插件侧重构（每个插件拆 activate/deactivate 是持久维护成本）。

### F — 只扩展现有热载面（settings 驱动的行为开关）

- **改动面**：仅插件内部（把"行为差异"声明为 settings 键）+ settings schema；零宿主装配改动。
- **覆盖**：参数/行为开关类改动（开关、阈值、文案、提示词、模型路由、超时、上限……）——不覆盖逻辑重构。
- **风险**：低。注意 **settings schema 本身是插件代码**（改 schema 仍需重启；以"只增不改/默认值兼容"写法规避）；键粒度要提前设计。
- **回滚**：改回 settings 值即可（settings 热，E6）。
- **与补丁链**：完全正交；与 ④ 已热面一致。

| 方案 | 改动面 | 覆盖类型 | 重复注册风险 | 状态/内存/监听风险 | 回滚 | 与补丁链关系 | 成本/收益 |
|---|---|---|---|---|---|---|---|
| A require-cache 重载纯函数 | 新垫片 + 补丁拆层 | 纯函数/数据 | 高（混入注册即炸） | 中（闭包/单例） | 有现成模式(E3) | 需改造 32 包补丁结构 | 低/低 |
| B cordis reload 通道 | hmr+loader+app-boot 3 包 | 插件 lib + 部分宿主 lib | 中（effect 清理，未全覆盖） | 中-高（externals 触发 exit） | 有(E3) | 复用 patch-official | 中-高/高（P1 候选） |
| C worker 隔离热替换 | 架构级 | 一切 | 低（隔离） | 高（状态迁移） | 切旧 worker | 与全部补丁冲突 | 周级/中 |
| D 自动重启 | 进程管理 | 一切（全量） | 无（新进程） | 中（回合中断，会话持久化可恢复） | 天然 | 正交 | 极低/高 |
| E 插件再激活通道 | 新包 + 6 插件适配 | 自装插件宿主 | 中（effect 缓解） | 中-高（插件内存态） | 回退旧实例 | 新增层 | 中-高/中 |
| F settings 行为开关 | 插件内部 + settings | 参数/开关 | 无 | 低 | 改值即回滚 | 正交 | 低/高 |

---

## 3. P0 建议

### 3.1 最高频重启原因（独立判断）

基于 9/8–9/16 交付物序列（`.workspace/*exec*.md` 15+ 档提及重启；deploy 批次：lag-fix → btw UI 批 → usage heatmap/tooltip → pptmaster → workerspace → ssh-gui → vision-settings → 015 借鉴 28 包 → slots）：

1. **迭代自装 @local 插件宿主 lib**（btw 侧聊服务/prompt-transform、ssh-gui core、usage 统计、workerspace 串口、pptmaster）——**次数最多**，每次功能迭代都动 `lib/index.js` 或 `lib/*.js`，且农场拷贝与工作区需逐文件一致（diff 校验，E12），改码→copy→重启。
2. **官方补丁包成批改**（lag-fix 4 包、015 借鉴 28 包、slots）——**次数少但代价大**：32 包 225 个 .js 的验证面 + 全量重启，且是跨批累积（"借上游"模式）。
3. **新增插件落地**（9 月 3 次：pptmaster/workerspace/ssh-gui）——次数最少，但每次"copy + patch 追加 + settings 段 + 重启"，RUNBOOK 明文要求重启（E13）。

### 3.2 值得做（P0）

- **D（自动重启编排）** —— 唯一覆盖 ①② 且改动面≈0 的方案。把"改完手动重启/忘记重启/被迫中断手头工作"变成"保存即自动重启"：部署脚本末尾触发（或轻量文件快照 + debounce 检测），SIGTERM 优雅 dispose（已有 5s 兜底，E1），浏览器自动重连（已被我们 patch 加固的 client-connection 重连/心跳，E14 + final-audit-a）。**收益：消灭"忘记重启导致的陈旧行为"与"被迫在会话中途重启"两个高频摩擦。**
- **F（settings 行为开关）** —— 覆盖次高频"为改一个行为参数重启"。先选 1–2 个插件试点（如 btw 的模型/超时/文案键、usage 的阈值/展示键），把易调参数搬进 settings（热，E6），schema 以"只增 + 默认值"演进。

### 3.3 不值得 / 风险过大

- **C（worker 隔离）**：工程量周级，状态迁移风险最高，收益（覆盖原生依赖热换）非当前痛点 → **否决**。
- **A（通用 require-cache 热载）**：我们的补丁是注册/装配型而非纯函数型，拆层改造成本高、收益低；且 cordis-hmr 已证明机制对 node_modules 内模块**不生效**（E2），要生效需同时做 B 的解除排除 → 单独做 A 无意义。
- **E（插件再激活通道）**：与最高频痛点 ① 对齐，但每插件适配成本 ×6 + 插件内存态迁移难；**可降级为 F 的"参数面"覆盖，不建通用通道**。
- **B（cordis reload 通道）**：技术上最有"根治"价值，但 (a) externals→`loader.exit()` 使宿主 lib 热载在官方边界内即失败；(b) 需要解除 node_modules 排除才能对插件生效；(c) 属于系统性放松官方安全边界——**列为 P1 实验线，不作为 P0 投入**。

### 3.4 落地前置条件

1. **（D 前置）实测 `node --watch` 行为**：确认 v22.23.2 下是否 watch node_modules（决定用 `node --watch` 还是自写"md5 快照 + debounce + 重启"脚本）；实测冷启动耗时与重启期间浏览器重连体验（利用现有 client-connection 重连补丁）；确认会话 jsonl 持久化重启后恢复路径。
2. **（D 前置）重启窗口策略**：空闲时重启 / 批次攒够再重启 / 部署脚本内嵌 `dsh restart-web`；明确"进行中回合会被打断"的取舍（配合批处理：一天一次收口重启 + 紧急改动用 D 自动兜底）。
3. **（F 前置）试点选择**：btw（模型路由/超时/文案）或 usage（阈值/展示）先搬 3–5 个键，验证"改 settings 即生效"闭环（vision-settings 页已有写入 settings 的成熟范式可复用）。
4. **（B/P1 前置）纯函数模块热载实验**：按 E3（cordis-plugin-hmr partialReload）模式写最小实验：目标 = 农场某插件 `lib/` 下**纯函数子模块**（如 ssh-gui 的 keyRef 解析、usage 的聚合函数）；验证 CJS+ESM 混合（CJS bundle 经 `import()` 加载，Node 22/24 双缓存）下清缓存 → 重 import → 新行为生效且旧引用无泄漏；通过后**仅**评估把该实验路径接入 B 的可行性，不直接铺开。

---

## 4. 裁决

**最终推荐：维持"重启 + 批处理"为主路径（现状），不投入通用宿主热载大改造；P0 增量 = D（自动重启编排）+ F（settings 行为开关）；B 降为 P1 实验线（以 §3.4-4 实验为闸门）。**

"不做、维持重启+批处理"选项的如实评估：
- **重启的真实成本并不高**：装配/重启由脚本化 Runbook 覆盖（`replay-lag-fix.sh`/`patch-official-015.sh`/deploy.sh 幂等，备份回滚齐全，E12）；进程 boot 为秒级（审计档进程 10:38 启动、10:4x 即产出，旁证）；会话持久化 + 浏览器重连（E14）使重启的破坏面集中在"进行中回合"。
- **通用热载的收益被高估、风险被低估**：cordis 生态本身把"宿主代码热载"排除在安全边界外（node_modules 忽略 + externals→exit，E2），typert/tools 的 effect 清理是为"插件重挂"设计而非"宿主热换"设计；我们 32 包补丁是装配型代码，热载后最可能炸在重复注册/状态丢失上，调试成本远超省下的重启时间。
- **结论：不做 A/B/C/E 是**理性**选择；做 D+F 是**划算**选择。** 若后续"每两三天一次全量重启"升级为"每天多次"，再以 §3.4-4 实验结果为闸门重新评估 B。

---

## 附录：证据索引

| 编号 | 证据 | 位置 |
|---|---|---|
| E1 | runProfile：boot + hmr `{root:[]}` + 两处 watchUserPatches + 5s 优雅关闭 | `~/.npm-global/lib/node_modules/@deepseek-ai/dsh/lib/profile-boot-DG5t9aNs.js` L230-281 |
| E2 | cordis-hmr：ignored 默认含 `**/node_modules`（L441-446）、externals=主入口依赖树→`loader.exit()`（L192-215）、node_modules 排除导致 reload 不命中（L286/L343-346） | `…/cordis-plugin-hmr/lib/index.js` |
| E3 | partialReload：ESM loadCache + CJS require.cache 双清 + rollback；Node 22/24 双缓存注释 | `…/cordis-plugin-hmr/lib/index.js` L352-435 |
| E4 | Include：`internal/update`→applyPatches→`root.update`（热重放）；refresh/_apply 事务 | `…/cordis-plugin-include/lib/index.js` L139-146, L226-242 |
| E5 | dsh-app-boot：PROFILE_PATCH_FILENAME "hot-reloaded on long-lived surfaces"；watchUserPatches | `…/dsh-app-boot/lib/index.js` L310-311, L761-781 |
| E6 | dsh-settings-file：watch 默认 true，chokidar → enqueue refresh | `…/dsh-settings-file/lib/index.js` L37, L179-202 |
| E7 | dsh-skill-filesystem：watch manager + provider invalidation | `…/dsh-skill-filesystem/lib/index.js` L37-56, L80-97 |
| E8 | dsh-client-hmr：轮询 clientPath mtime/size → rebuilt → SSE `/plugins/events` | `…/dsh-client-hmr/lib/index.js` L14-23, L92-130 |
| E9 | dsh-client-modules：loader 条目↔client 图 reconcile（动态）、pkgMeta 缓存、onGraphChanged | `…/dsh-client-modules/lib/index.js` L330-457 |
| E10 | typert 重复注册抛错 + effect 自动反注册 | `…/dsh-typert-registry/lib/index.js` L44-102 |
| E11 | dsh-tools：重复工具名抛错 + `layers.effect` disposer（"HMR cleanup"） | `…/dsh-tools/lib/index.js` L2524, L2760-2806 |
| E12 | 补丁面：32 包 225 .js；农场 @local 6 真实目录与工作区 diff 空；官方包全符号链接 | `.workspace/final-audit-a-patches.md` §1；`.workspace/final-audit-c-config.md` §3；`.workspace/deploy-lag/replay-lag-fix.sh`；`.workspace/deploy-ssh-gui/deploy.sh` |
| E13 | RUNBOOK 明文"重启（bundle/insert 生效）…HMR 不覆盖 host 装配变更，必须重启" | `.workspace/deploy-ssh-gui/RUNBOOK.md` §4 |
| E14 | client-connection 重连/心跳（被补丁加固的官方恢复面） | `…/dsh-client-connection/lib/client.js` L39-83；`.workspace/final-audit-a-patches.md` §2 |
| E15 | `dsh web` = profile web 别名 → runProfile | `…/dsh/lib/bin.js` L91-94, L132-133 |
| E16 | 浏览器侧 shell 需重建 Web 产物 + 刷新（Vite dev 仅 `dev:web` 运行时存在） | 系统级 GUI 部署说明 |
| E17 | 无 supervisor：`npm exec @deepseek-ai/dsh web` → sh -c → node bin（pts/0 手动） | `ps -ef`（2026-09-16） |

## 附录：留给修订执行复核一体档的候选单元（若主 agent 采纳 D/F）

- D1：写 `dsh-restart-web.sh`（md5 快照 + debounce + SIGTERM + 健康检查 :3080 + 日志轮转），接入部署脚本尾部可选调用。
- D2：实测 `node --watch` 对 `~/.npm-global/bin/dsh web` 的 node_modules 覆盖行为与抖动，出对比结论。
- F1：选定试点插件，把 3–5 个易调行为键搬进 settings schema（只增+默认值），验证"改 settings 即热生效"。
- P1（闸门实验）：按 E3 模式写 CJS+ESM 混合纯函数热载最小实验，产实验报告后再议 B。
