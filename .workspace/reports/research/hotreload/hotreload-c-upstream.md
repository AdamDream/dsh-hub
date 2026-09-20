# 调研 C：上游（0.1.5）与 Node/cordis 生态的热载能力

- 日期：2026-09-16
- 角色：两阶段闭环【审计】子代理（路由 adam/deepseek-v4-flash）
- 只读约束：✓ 未修改归档树/全局树/工作区任何文件；未使用 sandbox_permissions
- 素材：
  - 归档 0.1.5 树 `~/.dsh/profiles-archive/web2-20260915-105429/node_modules/@deepseek-ai/`
  - 全局 0.1.1 树 `~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`（运行中实例 PID 2437836）
  - 当前 profile `~/.dsh/profiles/web/`（cordis.yml / cordis.patch.yml / node_modules/@local/*）
  - 工作区既有借码体系 `.workspace/deploy-015/`、`borrow-015-exec.md`
  - Node 运行时 v22.23.2

---

## 0. TL;DR（结论式摘要）

1. **上游从未、也没有打算热载宿主代码**。cordis-plugin-hmr 把「CLI 入口的依赖树」（即 `@deepseek-ai/dsh-*` 与 dsh 主入口等**框架代码**）定义为 `externals`：externals 内任何文件变更 → `loader.exit()` **全量重启进程**。0.1.5 与此完全一致（hmr 插件字节级相同）。
2. **cordis 热载基础设施在 0.1.1 就已完整存在**（不是 0.1.5 的增量）：
   - cordis 4.0.2 `fiber.restart()`（dispose + 以当前 config 重载）；
   - cordis-plugin-loader 1.0.3 `loader.create/update/remove`（程序化插件热换）+ `exit()` 全量重启 hook；
   - **cordis-plugin-hmr 1.0.17**（0.1.1 与 0.1.5 字节相同）：应用模块变更 → 清 ESM loadCache + CJS `require.cache` → 重新 import → 以**插件 fiber 为替换单元**热换（保留 entry、不重启进程）；配置（cordis.yml/include/patch 层）→ `refreshConfig`/`registerConfig` 热刷新；`--expose-internals` 或 native addon（`node-addon-require-builtin`）双通道取 Node internal loader；
   - profile-boot 0.1.1 即自动装载 hmr + `watchUserPatches`（patch 文件热载）。
3. **0.1.5 的热载增量很小，且与「免重启宿主」无关**：patchReload 策略模板化（web=live，acp/headless/sdk=startup）、watchUserPatches 完整化、以及一系列**「重启后状态可恢复」**的改进（agent-loop durable inbox/assistant-stream、SessionSeq/SessionLogOffset/persistedHeader）——0.1.5 的方向是「重启无痛」，不是「免重启」。
4. **「免重启热载宿主代码」无现成路径**（上游/生态均无）。cordis 模型下宿主就是依赖树根，天然属于 externals。**现成路径是「插件级热载」**：把频繁改动的代码放在插件层（非 node_modules 源码），可享受 hmr 的 fiber 热换——而 0.1.1 **自带**这套能力，无需借码。
5. **最短路径（对本工作区）**：① 不改宿主热载（上游都不做，勿逆势而为）；② 把需要高频迭代的宿主侧代码**下沉为本地插件**（当前 `@local/*` 插件已是此形态，但需移出 `profiles/node_modules`——hmr 明确跳过 node_modules，这是唯一现实约束）；③ 宿主本体变更维持重启，借鉴 0.1.5「durable 状态 + 重启恢复」思想（不借源码）降低重启成本。

---

## 1. 上游 0.1.1 vs 0.1.5：逐项对比

### 1.1 包结构盘点（同版本 = 生态未变）

| 包 | 0.1.1 | 0.1.5 | 结论 |
|---|---|---|---|
| cordis | 4.0.2 | 4.0.2 | 相同 |
| cordis-plugin-hmr | 1.0.17 | 1.0.17 | **src/index.ts 逐字相同（diff 0 行）** |
| cordis-plugin-loader | 1.0.3 | 1.0.3 | 相同（0.1.1 dsh 声明 ^1.0.2 实装 1.0.3） |
| cosmokit | 1.8.3 | 1.8.3 | 相同（纯工具库，非 loader） |
| dsh-cordis-host-runner | 0.1.1-rc.2 | 0.1.5-rc.2 | **仅 1 行 import 差异**（snapshotJsonValue 来源迁移） |
| dsh-agent-loop | 0.1.1-rc.2 | 0.1.5-rc.2 | **重写**（1322 → 1936 行） |
| dsh-api-gateway | 0.1.1-rc.2 | 0.1.5-rc.2 | **扩展**（396 → 1108 行） |
| dsh-client-runtime | 0.1.1-rc.2 | **删除** | 职责并入 dsh-cordis-client-runner |
| dsh-app-boot | 0.1.1-rc.2 | 0.1.5-rc.2 | 扩展（1216 → 1575 行） |

### 1.2 agent-loop 重写与热载的关系（重点核查）

- 0.1.5 新增 `ReactLoopInbox`（durable inbox）：`agent/inbox/spliced` 事件投影（`inboxProjectionDefinition`，含 seq 校验、id 去重、splice 合法性检查），next-turn/next-step 双队列持久化；`AssistantStreamAccumulator`、`LlmAttemptId`、`SessionSeq`/`SessionLogOffset`、`persistedHeader`（openTurnStartSeq/lastStepStartSeq 持久化）。
- grep `reload|hot|hmr`：**0.1.5 dsh-agent-loop 零命中**——没有热载通道。
- 语义：这些是**会话状态持久化**（重启后从磁盘恢复未完成轮次），与热载正交。**0.1.5 对 agent-loop 的定位是「重启后无缝续接」，不是「免重启」**。对本目标（免重启热载宿主）0.1.5 没有提供新通道。

### 1.3 client-runtime 删除

- 0.1.1 `dsh-client-runtime` = "Client core services: SlotRegistry, SessionRuntime (scope tree + object layer)"。
- 0.1.5 删除该包，职责并入 `dsh-cordis-client-runner/lib/client.js`（desc: "Browser half of dynamic dual-half plugin packages: event subscription, closure evaluation, guard facade, and loader entries"；含 guard/runtime）。
- 与热载无关（SlotRegistry 是浏览器侧注册表；0.1.1 的 SessionRuntime 是 scope 树）。

### 1.4 api-gateway（WS mux）热载通道（重点核查）

- grep `reload|restart|hot`：**0.1.5 dsh-api-gateway 零命中**——无热载/重载/重启通道。
- 0.1.5 的扩展是 **Typert Remote stream mux**：`/api/remote.mux` WS 路由承载 Remote 流、`$events` 逻辑端点、snapshot/journal/stream 协议（stream-protocol / stream-server / client 三件套，lib 396 → 1108 行）。角色 = Host↔Client 事件与结果 RPC 的传输层，不是热载层。
- 浏览器断线重连由 `dsh-client-connection`（0.1.5，788 行）负责；其中 "Connection reloads" 仅指 launch token 跨连接保留（认证语义），非代码热载。

### 1.5 插件装载与模块缓存机制变化（重点核查）

**装载/缓存机制本体未变**：
- `cordis-plugin-loader/lib/index.js`（1.0.3，两版本相同）`ModuleLoader.fromInternal()`：
  - Node ≥ 22 才尝试（`if (major < 22) return`）；
  - 通道 A：`--expose-internals` → `require("internal/modules/esm/loader").getOrInitializeCascadedLoader()`；
  - **通道 B（无 flag 回退）**：`node-addon-require-builtin`（native addon）→ `requireBuiltin(id)`——**这就是 dsh 不带 `--expose-internals` 也能拿到 internal loader 的机制**（0.1.1 树 `dsh/node_modules/node-addon-require-builtin` 存在；当前运行进程 cmdline 无 `--expose-internals`，故当前 HMR 走通道 B）；
  - v1/v2 分类（`getModuleJobForImport` / `getOrCreateModuleJob`，v2 于 Node 24.12）。
- 模块缓存 = Node internal `loadCache`（Map<url, ModuleJob>）+ CJS `Module._cache`；`loader.import` 在有 internal 时直接走 `internal.import`。
- `loader.exit()`（`:743` 注释 "Hook for hosts that can restart the process on full-reload requests"）= 全量重启 hook，dsh 未 override（空实现）——**上游 host 侧 full-reload 是「谁都不接」的挂起通道**。

**真正变化在 app-boot / profile-boot（0.1.5 增量）**：
- 0.1.5 `PROFILE_TEMPLATES` 增加 `patchReload` 字段：`web: "live"`（唯一官方 live 模板）、`acp/headless/sdk/sdk-minimal: "startup"`；自定义 profile 默认 `"live"`（`DEFAULT_PROFILE_PATCH_RELOAD`，注释 "Custom profiles retain the historical live patch-file behavior"）；manifest 校验 `dsh.profile.patchReload ∈ {live, startup}`。
- 0.1.1 profile-boot **无条件**装载 timer+hmr 并 watchUserPatches；0.1.5 改为 `patchReload === "live"` 才装。
- `watchUserPatches`：0.1.1 仅内联 3 处（app-boot `:763-767`：`hmr.registerConfig(filename, ...)`）；0.1.5 完整化（`dsh-app-boot/lib/index.js` `:1108-1136`：事务性 compose → `entry.update({ config: { ...includeConfig, patches } })`，`INACTIVE_EFFECT` 兜底为 no-op disposer）。
- **hmr 装载形态**（两版本相同）：`config: { root: [] }` —— **root 为空数组 = 不 watch 源码目录，只依赖 registerConfig 的精确路径 watch**。即上游出厂形态只热载「patch/配置文件」，**插件源码热载需要另行配置 hmr root 指向源码目录**（官方教程 06 用 `root: ['.']`）。

### 1.6 小结：0.1.5 是否改善热载？

- **对「配置/patch 层」**：机制没变（0.1.1 已有），只是策略显式化（live/startup 分档，web 保持 live）。
- **对「应用插件代码」**：机制没变（cordis-plugin-hmr 同字节），0.1.5 未在 dsh 出厂配置里启用源码监视（root: []）。
- **对「宿主框架代码」**：**没有改善，且明确不可热载**（externals → loader.exit() 重启）。0.1.5 的实质改善是「重启后状态可恢复」（durable agent-loop / session seq），即**降低重启代价**，而非消除重启。

---

## 2. cordis/cosmokit 生态热载能力

### 2.1 cordis 4.0.2 原生 reload API（已内置，无需插件）

- `fiber.restart()`（cordis lib/index.js `:1404-1415`）："Dispose and immediately reload this plugin with its current config"，配合 `_reload()`/`_unload()`（`:1348`/`:1385`）与 `inertia` 去抖、epoch 状态机（INACTIVE→reload→1 / unload→5）。
- `loader.update(id, options)`：更新配置并**重启该 entry**（官方 README API 表）；`loader.create/remove/await/locate` 程序化插件图操作。
- `include.refresh()`（cordis-plugin-include）：文件树（cordis.yml）变更 → 按 **entry id diff** 只挂载/卸载/重配置变更条目——**无显式 id 的条目每次读取生成新 id，视为删除+新增而全量重挂**（官方文档 06 明确警告）。
- 生命周期契约：卸载释放 effects、加载依赖驱动 → HMR 可安全地「卸载→加载」替换运行中插件。

### 2.2 @cordisjs/plugin-hmr（官方 HMR 插件，deepseek-harness 官方教程）

- 官方教程：[docs/cordis-tutorial/06-composition-and-hmr.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-tutorial/06-composition-and-hmr.md)（含中文版）："Because unloading releases effects and loading follows dependencies, HMR can replace a running plugin by unloading and loading it. The @deepseek-ai/cordis-plugin-hmr plugin watches your files and does exactly that on save." 依赖 timer + loader internal（"Run Cordis under tsx / node --import"）。
- 实现要点（`src/index.ts`）：
  - `externals` = `process.argv[1]`（CLI worker 入口）的递归依赖树（跳过 node: / node_modules）；**externals 变更 → `loader.exit()` 全量重启**（`if (this.externals.has(url)) return loader.exit()`）。
  - `loadDependencies(job)` **显式跳过 `node_modules`**（"to focus on user code"）→ **node_modules 内的模块（含本地插件源码若装在那里）永远不参与依赖传播，无法 partialReload**。
  - `partialReload`：stashed 分类 accepted/declined → 备份+清除 ESM `loadCache`（`Map.prototype.delete`，兼容 Node 22-24）与 CJS `require.cache` → `loader.import` 重新加载插件入口 → **以 fiber 为替换单元**（`registry.plugin(plugin, config)` 重建 fiber、保留 entry、`runtime.fibers` 逐个热换）→ 失败回滚（rollback 恢复两套缓存）。
  - `registerConfig(filename, refresh)`：精确路径 watch（findWatchRoot 上溯最近存在祖先），`hmr/config-update-failed` 事件报告刷新失败——**dsh 的 patch 热载即此通道**。
- 生态变体：[@agentbrain-harness/cordis-plugin-hmr](https://www.npmjs.com/package/@agentbrain-harness/cordis-plugin-hmr)、[@xneog/cordis-plugin-hmr](https://www.npmjs.com/package/@xneog/cordis-plugin-hmr)（fork）；第三方 DSH fork（oh-my-deepseek-harness）有 [slot 级 HMR 设计笔记](https://github.com/Truly-Private/oh-my-deepseek-harness/blob/d7d622923f5f943de4aadf8600f116f13fc03eef/.agents/notes/implemented/architecture/2026-08-05-slot-declaration-injection.md)——同样以「Cordis 插件 fiber 作为替换单元」为模式，无宿主级热载先例。

### 2.3 cosmokit

- cosmokit 1.8.3 = "A collection of common utilities"（Dict/Logger/deepEqual/defineProperty/isNullable 等），**不参与模块解析与缓存**。任务所述「cosmokit loader」实际指 `@cordisjs/plugin-loader` 的 `ModuleLoader`（见 1.5）——模块解析=Node 自带 internal loader，缓存=Node ESM loadCache + CJS cache。

---

## 3. Node 22 生态可借方案

### 3.1 `node --watch`（v22 稳定）—— 自动重启，非免重启

- 官方文档（[cli.md](https://nodejs.org/docs/latest-v22.x/api/cli.html)）："When in watch mode, changes in the watched files cause the **Node.js process to restart**." v22.0.0 转正；默认 watch 入口点+依赖图；`--watch-path` 限定目录；`--watch-kill-signal`（v22.18.0）自定义重启信号。
- 判定：比手动重启优雅（自动、无遗忘），但**本质是重启进程**，不能保住 in-process 状态（会话/插件图/WS 连接全断，需重连重载）。对 DSH（长会话、WS 客户端、agent 运行中）而言重启即中断，除非配 0.1.5 式 durable 恢复。**可作「宿主变更」的默认重启器，不是热载**。
- 已知坑：watch 与 worker_threads 的兼容问题（[nodemon#1764](https://github.com/remy/nodemon/issues/1764)：引入 worker 后 watch 反复重启——同类方案都需注意）。

### 3.2 `module.register()`（ESM loader hooks）—— 替换通道，非替换本身

- 官方文档（[module.md](https://nodejs.org/docs/latest-v22.x/api/module.html)）：v20.6.0/v18.19.0 引入，v22.13.1 权限模型变更；`resolve`/`load` hooks（异步版）+ `module.registerHooks`（v22 同步版）。
- 判定：hooks 能改写/拦截加载，但 **ESM 模块缓存以 URL 为键**——同 URL 二次 import 命中缓存，load hook 不重跑；要真正换码必须清 Node internal `loadCache`（cordis-plugin-hmr 的 `Map.prototype.delete` 方案正是此路，且已兼容 Node 22-24 的 LoadCache 差异）。**module.register 是「注册 hooks」的通道，不做热替换**；「webpack-hot 思路」在 Node 服务端即「清缓存+重 import+重挂副作用」，cordis-plugin-hmr 是此思路的成熟落地（比手写可靠）。

### 3.3 worker_threads / 子进程隔离热替换

- worker_threads 换 worker：主进程保活、替换单个 worker 线程（成熟模式，任务/崩溃隔离），但 DSH 宿主状态（context/registry/session fiber 树）几乎全在主进程，拆 worker 需定义进程间状态协议，属大改。
- pm2 cluster `reload`：多实例滚动重启（零停机），但 DSH 是单机工具、单实例语义，无集群价值。
- **对 cordis 模型**：cordis 的「服务依赖图 + fiber 生命周期」天然是进程内替换（卸载 effects→装载新码），worker/pm2 方案与它正交，仅适用于「整体宿主」维度——结论同 3.1：重启维度的事，不是热载维度的事。

---

## 4. 借源码评估（可移植 vs 借鉴思想）

### 4.1 P0 可借（借源码，按既有 deploy-015 体系落地）

| # | 内容 | 来源 | 面 | 冲突 |
|---|---|---|---|---|
| C-1 | **启用插件源码级热载**：配置 hmr `root` 指向本地插件源码目录（出厂 `root: []` 只热 patch 文件）+ 把目标插件源码移出 `node_modules` | 上游已自带 cordis-plugin-hmr，**仅需配置与布局调整，非借码** | 0 行代码（改 profile manifest/overlay 配置 + 布局） | 无（配置层） |
| C-2 | app-boot 0.1.5 `watchUserPatches` 完整版（事务性 `entry.update` + `INACTIVE_EFFECT` 兜底）替换 0.1.1 内联简化版 | `dsh-app-boot/lib/index.js` 0.1.5 `:1108-1136` | ~30 行 | 无（既有 12 包补丁不涉 app-boot） |
| C-3 | profile `patchReload` 策略字段（live/startup 分档 + manifest 校验）——若需统一 web/acp 行为 | 0.1.5 `dsh-app-boot` `:331-347`/`:846-848` | ~25 行 | 无 |

> 注：cordis-plugin-hmr / cordis-plugin-loader / cordis 本体**无需也不应借**——0.1.1 已装同版本（1.0.17/1.0.3/4.0.2），借 = 重复。

### 4.2 只借鉴思想（不借源码）

| 思想 | 来源 | 借鉴点 |
|---|---|---|
| **「重启无痛」而非「免重启」**：durable 会话状态（seq/投影）+ 启动恢复 | 0.1.5 agent-loop（inbox 投影、SessionSeq/persistedHeader） | 设计方向：宿主变更→自动重启→状态无缝续接；不移植 1936 行重写 |
| 以 fiber 为替换单元的热换协议（卸载 effects→装新码→保留 entry） | cordis-plugin-hmr partialReload / 官方教程 06 | 若未来自研宿主热载，先定义「哪些状态可卸载、哪些需迁移」 |
| 双通道 internal loader（--expose-internals / native addon 回退） | cordis-plugin-loader fromInternal | 依赖 Node internal 的能力已有免 flag 路径，无需自己造 |

### 4.3 勿借（明确否决）

| 项 | 原因 |
|---|---|
| **宿主框架代码热载（externals 语义）** | 上游（0.1.1/0.1.5 一致）明确定义框架依赖树变更 = `loader.exit()` 重启；cordis 模型下宿主是依赖树根，无替换单元可言；逆势实现 = 重写 cordis 加载模型，超范围 |
| agent-loop 0.1.5 重写（durable inbox/assistant-stream） | 宿主核心 1936 行重写，非「借码」是「升级」；与「借源码不升级」原则冲突；热载目标不需要它 |
| api-gateway Remote stream mux | 与热载无关（通信传输层） |
| `node --watch` 作热载 | 重启方案；仅可作宿主变更的自动重启器（配合 C-2/C-3 与 durable 思想） |
| worker_threads/pm2 隔离替换 | 进程级隔离与 cordis 进程内 fiber 模型正交，大改无收益 |
| 清缓存重 import 自研热载（invalidate-module / re-require-module 等） | cordis-plugin-hmr 已实现（含 Node 22-24 LoadCache 兼容 + CJS 双清 + 回滚），自研是重复造轮子且更不可靠 |

### 4.4 与既有补丁的冲突检查

- 既有借码（borrow-015-exec.md，12 包）：dsh-tool-web / dsh-atomic-write / dsh-goal-round-driver / dsh-user-approval / dsh-mcp-client / dsh-tool-fs-search / dsh-tool-bash-persistent / dsh-fs / dsh-fs-local / dsh-tool-str-replace-editor / dsh-launch-environment / dsh-llm-deepseek。
- C-1..C-3 涉及包：**dsh-app-boot、profile manifest/overlay 配置、插件布局**——与既有 12 包**零重叠**，无 diff 冲突；deploy-015 的 `patches/*.patch` 重放脚本（`deploy-lag/patch-official-015.sh`）不受影响。
- 布局变更（C-1 把插件源码移出 node_modules）影响 `~/.dsh/profiles/`（非全局树），需在修订执行档明确回滚方案（软链/复制）。

---

## 5. 结论与最短路径

**上游/生态视角判定：**
- 「免重启热载宿主代码」：**无现成路径**。0.1.1 与 0.1.5 一致——宿主=externals=变更即重启；0.1.5 的「改善」是重启后状态可恢复（durable），不是免重启。
- 「免重启热载配置/插件」：**0.1.1 已自带完整现成路径**（cordis-plugin-hmr + profile-boot 自动装载 + watchUserPatches），且当前运行实例经 native addon 通道（无 --expose-internals）大概率已在运行（patch 层热载）；唯一缺口是**出厂 hmr `root: []` 未启用插件源码监视**。

**最短路径（推荐，按序）：**
1. **核实并固化 patch/配置热载现状**（C-0，0 行代码）：确认当前实例 hmr 服务激活（日志/行为验证），把「patch 文件变更即热生效」变成已知能力。
2. **启用插件源码热载**（C-1）：hmr `root` 指向本地插件源码目录 + 目标插件源码移出 `profiles/node_modules`（hmr 跳过 node_modules 是硬约束）→ 本地 `@local/*` 插件（dsh-btw/taste/usage/wallpaper 等）获得保存即热换。
3. **宿主本体变更 = 自动重启 + 无痛续接**：C-2/C-3（watchUserPatches 完整版、patchReload 分档）提升重启前后的配置一致性；借鉴 0.1.5 durable 思想（不借源码）确保长会话在重启后可恢复。
4. 不做：宿主代码热载（上游都不做，勿借勿造）。

**一句话**：上游 0.1.5 没有、也不会给「免重启宿主」；但 0.1.1 已自带 cordis 生态的插件级 HMR——把要热改的代码放插件层（源码移出 node_modules + hmr root），宿主变更维持重启并靠 durable 状态无痛续接，这是生态给出的最短真实路径。

---

## 6. 证据索引

**本地（只读）：**
- `cordis-plugin-hmr/src/index.ts`（1.0.17，0.1.1=0.1.5 逐字相同）：externals→`loader.exit()`；`--expose-internals` 检查；`loadDependencies` 跳过 node_modules；`partialReload` 清 ESM loadCache+CJS cache、fiber 热换、rollback；`registerConfig` 精确路径 watch。
- `cordis-plugin-loader/lib/index.js`（1.0.3）：`ModuleLoader.fromInternal()`（Node≥22、双通道、v1/v2）；`:743` exit() full-reload hook；`loader.create/update/remove`。
- `cordis/lib/index.js`（4.0.2）：`fiber.restart()` `:1404-1415`、`_reload` `:1348`。
- `dsh-agent-loop/lib/index.js`：0.1.1=1322 行 / 0.1.5=1936 行；0.1.5 durable inbox region `:14-212`、`SessionSeq/SessionLogOffset/persistedHeader`；grep reload/hot/hmr 零命中。
- `dsh-api-gateway`：0.1.1=396 行 / 0.1.5=1108 行；Remote stream mux（`/api/remote.mux`）；grep reload/restart 零命中。
- `dsh-app-boot/lib/index.js`：0.1.1 hmr 引用 3 处 `:763-767`；0.1.5 引用 18 处（PROFILE_PATCH_FILENAME `:313`、templates `:331-347`、watchUserPatches `:1108-1136`、校验 `:846-848`）。
- `dsh/lib/profile-boot-*.js`：0.1.1 无条件装 timer+hmr（root: []）+watchUserPatches `:256-262`；0.1.5 条件 `patchReload==="live"` `:322-337`。
- `dsh-client-runtime/package.json`（0.1.1）desc；0.1.5 中 ABSENT；替代=dsh-cordis-client-runner/lib/client.js。
- 运行实例 PID 2437836：`node /home/CNS2026495165/.npm-global/bin/dsh web`，无 `--expose-internals`、无 NODE_OPTIONS；`node-addon-require-builtin` 位于 `dsh/node_modules/`。
- 本地插件布局：`~/.dsh/profiles/node_modules/@local/{dsh-btw,dsh-pptmaster,dsh-ssh-gui,dsh-usage,dsh-wallpaper,dsh-workerspace}`（**在 node_modules 内，hmr 不可达**）。
- 既有借码：`.workspace/deploy-015/`（12 包）、`borrow-015-exec.md`、`deploy-lag/patch-official-015.sh`。

**网络（来源标注）：**
- 官方 HMR 教程：<https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-tutorial/06-composition-and-hmr.md>（entry id 语义、hmr 需要 timer+loader internal、卸载→装载热换）
- Node CLI（--watch 稳定、--watch-path、--watch-kill-signal v22.18.0）：<https://nodejs.org/docs/latest-v22.x/api/cli.html>
- Node module.register（v20.6.0/v18.19.0、v22.13.1 变更）：<https://nodejs.org/docs/latest-v22.x/api/module.html>
- watch×worker_threads 兼容问题（反面案例）：<https://github.com/remy/nodemon/issues/1764>
- 第三方 DSH fork slot 级 HMR 笔记（fiber 替换单元佐证）：<https://github.com/Truly-Private/oh-my-deepseek-harness/blob/d7d622923f5f943de4aadf8600f116f13fc03eef/.agents/notes/implemented/architecture/2026-08-05-slot-declaration-injection.md>
- 生态 fork：<https://www.npmjs.com/package/@agentbrain-harness/cordis-plugin-hmr>、<https://www.npmjs.com/package/@xneog/cordis-plugin-hmr>
