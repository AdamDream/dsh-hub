# 调研 A——DSH 宿主加载器机制与热重载理论可行性

- 角色：审计阶段子代理（只读，机制级取证）
- 目标：弄清宿主侧装载与运行机制，找出"免重启热载宿主代码"（改官方包/插件宿主 lib 后不重启进程即生效）的可行点与硬约束
- 取证基线：`~/.npm-global/lib/node_modules/@deepseek-ai/dsh/`（dsh 0.1.1-rc.2，`dsh web` 于本机以单进程运行中，PID 2437836，`node /home/CNS2026495165/.npm-global/bin/dsh web`，无 `--expose-internals`、无 NODE_OPTIONS）
- 结论摘要见文末"第 5 节"

---

## 0. 全局图：DSH 的进程/装载拓扑

```
dsh CLI (bin.js)
 └─ runProfile() (profile-boot-*.js)
     └─ boot() (dsh-app-boot)
         ├─ new Context()                     [cordis 根上下文]
         ├─ ctx.plugin(Loader)                [cordis-plugin-loader 的 Loader 服务]
         ├─ mountRootInclude()                [cordis:include → Include 树，读 cordis.yml + patch 层]
         │    └─ EntryTree 逐 entry import() + registry.plugin()  [全部宿主插件]
         ├─ 启动完成后：
         │    ├─ ctx.loader.create(timer) + create(hmr, {root: []})   [profile-boot:258-261]
         │    └─ watchUserPatches() ×2         [profile patch + home patch，配置热载]  [profile-boot:264-270]
         └─ web-app 等 bundle 插件在同一进程内提供 webServer/frontend-static  [dsh-web-app/lib/index.js:172-214]
```

关键事实（都有文件行号佐证，见下）：
1. **宿主全部插件跑在 dsh 这个单一 Node 进程内**。`dsh web` 不 fork worker 线程/子进程跑宿主代码（`dsh-web-app` 唯一 spawn 的是"打开浏览器"的一次性子进程，与宿主无关）。
2. **插件装载统一走 ESM 动态 `import()`**（cordis `EntryTree.import`），CJS 插件经 Node 的 CJS→ESM 互操作包装后被同样装载。
3. **官方 HMR（cordis-plugin-hmr）在每个 dsh 表面默认挂载**，但配置为 `{root: []}`——即**只热载配置文件（patch YAML），不监视任何宿主代码目录**；宿主代码（node_modules）即使被监视到，也会被归类为 externals 走 `loader.exit()`，而 `Loader.exit()` 在本部署中无人覆写、是空操作。
4. **官方另有一条"运行时动态插件"通道**（cordis_define/run/stop/undefine，dsh-cordis-host-runner）——进程内定义/运行/更新/回滚插件，但定义不落盘、不存活于重启。

---

## 1. cordis loader：装载时机、顺序、ctx 装配；reload/restart/watch API 盘点

### 1.1 装载入口与顺序

- `dsh` bin → `runProfile`（`dsh/lib/profile-boot-DG5t9aNs.js`）→ `boot()`（`dsh-app-boot/lib/index.js:1167-1189`）：
  1. `ctx = new Context()`；`ctx.baseUrl = profile 目录`；
  2. `ctx.plugin(Loader)`——**Loader 服务先于一切 config 树装载**（`boot` :1173）；
  3. `mountRootInclude()`（`dsh-app-boot/lib/index.js:964-991`）把 `Include`（`@deepseek-ai/cordis-plugin-include` 的同构实现）注册为 `ctx.loader.builtins.include`、`Group` 注册为 `ctx.loader.builtins.group`，然后 `ctx.loader.create(rootInclude)` 创建根 include entry（读 `cordis.yml` + 按序应用 bundle 层/profile 层/home 层/--patch 覆盖层）；
  4. `await ctx.get("loader")?.await()` 等树 settle，`assertEntriesActivated`（:1076-1136）对未激活 entry fail-loud；
  5. 启动完成后 `ctx.loader.create({name:"@deepseek-ai/cordis-plugin-timer"})`、`ctx.loader.create({name:"@deepseek-ai/cordis-plugin-hmr", config:{root:[]}})`（profile-boot:258-261），再 `watchUserPatches` 注册两个 patch 文件的精确监视（profile-boot:264-270；`watchUserPatches` 实现 `dsh-app-boot/lib/index.js:761-781`）。
- **entry 装载顺序**：`EntryGroup.update` 对同一组内 entries 用 `Promise.allSettled(config.map(o => this.create(o)))` **并发**装载（`cordis-plugin-loader/lib/index.js:97`），失败时回滚新建的 entry（:104-122）。装载等待靠 `loader.await()`/fiber await。
- **ctx 装配**：每个 entry 有独立 child ctx：`Entry` 构造时 `loader.ctx.extend({[Entry.key]: this})`（loader index.js:348），fiber 构造时再 `parent.extend({fiber: this})`（cordis core index.js:1053）；ctx 通过原型链继承根 ctx 的服务解析，service 解析走 `ReflectService.handler.get` 的 `internal/get` waterfall（core:680-694）。`Entry._patchContext`（loader:383-388）用 `Object.setPrototypeOf(this.ctx, this.parent.ctx)` 重构原型链。

### 1.2 模块怎么被 import

`EntryTree.import(name)`（`cordis-plugin-loader/lib/index.js:270-284`）：
- `name.startsWith("cordis:")` → `ctx.loader.builtins[...]`（内置：include/group）；
- 否则若 `ctx.loader.internal` 可用 → `internal.import(name, baseUrl, {})`（**走 Node 内部 ModuleLoader 的 module job，带自定义 baseUrl**）；
- 否则 → 普通 `import(new URL(name, baseUrl).href)` 或 `import(name)`。
- `loader.internal = ModuleLoader.fromInternal()`（loader:672；实现 :29-40）：优先 `--expose-internals` 的 `require("internal/modules/esm/loader")`，否则用 `node-addon-require-builtin` 原生扩展取内部 loader。**当前运行进程无 --expose-internals**，internal 来自原生扩展（HMR 服务能挂载即证明 internal 可用）。
- 装载后 `loader.unwrapExports()`（loader:746-751）归一化 ESM/CJS default 形状，再 `registry.plugin(plugin, config)` 建 fiber（loader:532-543）。

### 1.3 reload/restart/watch API 盘点（本构建实有）

| API/事件 | 位置 | 语义 |
|---|---|---|
| `Entry.update(options, create, force)` | loader:405-492 | **核心热更新入口**：options diff 只含 config 且 name/inject/group 未变 → `_patchContext` → 同模块 `fiber.update(config)` 重启（**配置热载**，代码不换）；含 `name` 变更 → **重新 `import()` 新模块** → dispose 旧 fiber → 启动新 fiber（:464-491） |
| `Entry.refresh()` | loader:389-393 | 未初始化时补 init |
| `EntryGroup.update(config)` | loader:86-123 | 整组 diff 增删改 + 失败回滚（先 `Promise.allSettled` 创建新，后移除消失的） |
| `Fiber.restart()` / `Fiber.update()` | cordis core:1409-1441 | 同模块配置重启（经 `internal/update` waterfall，HMR 可 veto） |
| `loader.exit()` | loader:743-744 | "Hook for hosts that can restart the process on full-reload requests"——**默认空实现，全树无任何覆写**（grep 验证） |
| `ctx.on("internal/update")` | loader:685-705 | config 变更 → 写回 entry.options + 持久化 + 打 `reload` 日志 |
| `internal/plugin` unload 钩子 | loader:706-722 | 插件被父级 dispose 时把 entry 标记 disabled（`unload` 日志） |
| HMR 服务 `registerConfig` | hmr:118-166 | 精确文件监视 + 串行 refresh（供 patch 热载） |
| HMR `partialReload()` | hmr:324-435 | 缓存清理 + 重 import + registry 换纤维（详见 §2.3） |
| 事件 `hmr/change`、`hmr/reload`、`loader/partial-dispose` | hmr:220,433；loader:84 | 供 UI/日志 |

**结论：cordis loader 层面存在完整的"配置热载 + 同进程换插件纤维"机制**，但没有"清缓存重载文件模块"的公共 API——那个能力只存在于 HMR 插件的内部实现里，且默认未对宿主代码启用。

---

## 2. 模块装载与缓存（CJS vs ESM，loader hook）

### 2.1 装载形式

- 全部 `@deepseek-ai/*` 宿主包均为 ESM（package.json `"type":"module"`，实测无 CJS 包）。
- 用户插件同样为 ESM：`@local/dsh-btw`（`/home/CNS2026495165/dsh/dsh-btw`，`"type":"module"`，main `lib/index.js`，`lib/remote-*.js` 是 rolldown remote chunk 的 ESM 文件，index.js 直接 `import ... from "./remote-DxLkxvnp.js"`）。用户侧"打包成 CJS 的 lib/index.js"与本构建无对应物——**本树中不存在 CJS 宿主/用户插件**；若未来有 CJS 插件，见 2.2 的双缓存结论。
- 解析路径：loader 的 `baseUrl` = profile 目录；bare 包名先按安装锚点（dsh 安装）解析，再按 profile 目录解析（`resolveBundleDir`，dsh-app-boot:518-524）；profile 目录的父目录 `$DSH_HOME/profiles/node_modules` 是**安装闭包 + 用户插件的平铺 fallback**（`healProfilesModuleFallback`，dsh-app-boot:409-438）。用户插件（`@local/*`）目前以**真实目录拷贝**部署在 `~/.dsh/profiles/node_modules/@local/`（与 checkout 字节相同，diff 验证），由 Node 父目录上溯解析到。

### 2.2 缓存语义（热载的关键）

- **ESM**：`import()` 命中 Node 内部 `ModuleLoader.loadCache`（URL → ModuleJob），**同一 URL 二次 import 返回同一模块命名空间**——不破缓存改文件不生效。
- **CJS 经 `import()` 装载**：Node ≥22 的 CJS-ESM 互操作下，CJS 模块**同时出现在 ESM loadCache 与 CJS `require.cache`**（Node 24 下两种缓存都命中，HMR 注释明示：hmr:353-367）。只清一处会吃到另一处的陈旧模块。
- **清缓存手段（已被官方 HMR 实现并验证）**：`Map.prototype.get/delete.call(this.internal.loadCache, url)`（兼容 Node 22/23 的普通 Map 与 Node 24 的 LoadCache 子类，hmr:368-381）+ `delete require.cache[fileURLToPath(url)]`（:375-379）。清完再 `ctx.loader.import(url)` 重新装载。
- **loader hook**：全树**无任何** `module.register`/`--experimental-loader`/`registerHooks` 使用（grep 验证）。即当前没有自定义 resolve/load 钩子可截获；将来若要"按需清缓存+重装载"也不需 loader hook——HMR 已经直接操作内部 loadCache。

### 2.3 官方 HMR 对"代码变更"的处理（这就是标准答案）

`cordis-plugin-hmr/lib/index.js`：
- externals = **进程入口（process.argv[1]）的整棵依赖闭包**（:192-195 `loadDependencies(mainJob)`，mainJob = `internal.loadCache.get(pathToFileURL(process.argv[1]))`）——对 dsh 而言**所有 @deepseek-ai/dsh-* 宿主包都在闭包内**（bin.js → app-boot → …）。
- 变更分类（`analyzeChanges` :282-323）：externals → declined；变更文件及其依赖 → accepted。
- 处理（:213-220）：**externals 变更 → `loader.exit()`**（= 空操作，见 1.3）；非 external 且 `loadCache.has(url)` → stashed → `partialReload()`：清 ESM+CJS 缓存（:368-381）→ 重 import 全部 reloads（:388）→ `registry.delete(oldPlugin)`（:406）→ 对每个旧 fiber `registry.plugin(newPlugin, oldFiber._config)` 重建（:393-400）→ 失败回滚恢复缓存+旧纤维（:382-385, 420-432）。
- **为什么"官方包改 lib 必须重启"**：① 这些文件在 node_modules，被默认 watch ignored 排除（`**/node_modules`，hmr:441-446），且本部署 hmr `root:[]` 根本没监视；② 即便监视到，属于 externals → `loader.exit()` 空转。**官方设计就是"宿主代码变更 → 整个进程重启"**，HMR 只服务用户代码树（非 external）。

---

## 3. 服务/工具注册时机与"重复注册"冲突

### 3.1 注册时机：**全部在装载时（插件 apply 同步执行）**

- 服务：`Service` 构造函数内 `ctx.reflect.provide(name, self, check)`（cordis core:1781）；`ctx.provide` 直接调用同路径（core:799-823）。例：`DirectoryPicker extends Service` 在构造时注册（dsh-host-directory-picker/lib/index.js:33-44）。
- 工具：插件 apply 内 `ctx.tools.register(defineTool({...}))`（例：dsh-tool-bash/lib/index.js:219,259）→ `ScopedLayers.effect` → `NamedEntries.insert`（dsh-scope/lib/index.js:189-218, 27-38）。
- 事件/slot/prompt 段：同为 apply 内 `ctx.on`/`systemPrompt.section` 等 fiber effect。
- 首次调用不做注册；**注册即装载**。fiber dispose 时 effect 反注册（`provide` 的 disposer 删 store 并 notify，core:816-821；`tools.register` 的 disposer 调 undo，dsh-scope:211-215）——所以注册表**并非只增不减**，正常卸载会清理。

### 3.2 重复注册错误的真实机制（"service "directoryPicker" has been registered"）

- `provide`（core:799-823）：服务按 `ctx.root[isolate][name] ??= Symbol(name)` 的**同一隔离符号**入 `reflect.store`；`if (this.store[key]) throw new Error('service "${name}" has been registered at <...>')`（**core:812**）。同一作用域下同名服务只允许一个活跃实现。directory-picker 文档明示："one implementation per context; loading a second throws"。
- 工具重名：`NamedEntries.insert` 同层重名直接抛（dsh-scope:29）。
- **热载下的冲突窗口**：`registry.delete(oldPlugin)`（hmr:406）→ `fiber.dispose()` 是**异步**的（`_unload` 先 `await Promise.resolve()` 再跑 disposers，core:1371-1382），而 HMR `reload()` 同步创建新 fiber。微任务顺序通常保证旧 disposer 先跑（旧 fiber dispose 先排队），**常见情形不冲突**；但：
  1. 若旧插件的某个服务由**另一个未被重载的插件**注册（跨插件耦合），重载方同名 provide 必然抛"has been registered"；
  2. 若旧 fiber 卸载中抛错/挂起（disposer 异常被吞进 `_unload` 的 catch，core:1379-1381），store 残留 → 新 provide 抛错 → HMR 走 rollback；
  3. 若新旧插件**都提供同一服务名但隔离符号不同**（用了 isolate/intercept），会造成双实现并存、notify 竞态。
- **动态插件通道规避此问题的做法**（可借鉴）：`retract()` **先 `await run.fiber.dispose()` 完成再启动新包**（dsh-cordis-host-runner/lib/index.js:2538-2549）——严格 stop-then-start。

### 3.3 真实风险清单（热载重装载会踩的坑）

1. 服务单实例约束（core:812）：同作用域同名服务双活 → 抛错/回滚。
2. 工具全局层单实例（dsh-scope global layer，:141）：所有未 scope 的宿主工具进同一 `NamedEntries`，重名即抛；**热载"改名工具"期间旧名未清+新名未建，存在中间态**。
3. `NamedEntries`/`AnonymousEntries` 迭代器在"排空后新代"才 detach（dsh-scope:36,107）——热载瞬间读表可能看到双条目或空条目。
4. `props[name]` 声明（core:801-803）不随 provide 反注册——热载多次后 props 是幂等覆写，无碍，但 accessor 声明（core:859-867）若重载会因"already declared"抛错。
5. 事件监听 `ctx.on` 按 fiber 自动清理（core:371-380），但 `{global:true}` 监听（Loader 自己的 internal/update 等，loader:685-705）挂在根链上，重载 Loader 本身会重复注册——**Loader/HMR 这类"基础设施插件"不可热载**。
6. **类身份变化**：新模块的 class/`instanceof`/`static inject`/`static Config` 全部是新身份；依赖旧 class 的第三方引用（如 `instanceof DirectoryPickerError`）在新模块下失效。

---

## 4. 状态面：ctx 上长驻状态的交接与丢失

| 状态 | 载体（文件:行） | 热载影响 |
|---|---|---|
| settings 快照 | `dsh-settings` 内存 `this.document[ns]`（dsh-settings/lib/index.js:460）+ 文件持久化；命名空间注册 `applies ?? "live"`（:317） | 文件为真相源，插件重载后从文件重建；**settings 本身已支持 live 应用**（SettingsApplies='live'|'restart'，dsh-tool-cordis:5898） |
| 会话表 | `dsh-session`（`SessionId` 等；`create/update` 签名见 dsh-tool-cordis:2331,2556） | 会话持久化在 `~/.dsh/sessions` + 各 provider；**宿主插件重载不丢会话文件，但内存中的 session 对象句柄若被旧模块持有则悬空** |
| 连接池/远程 provider | 用户插件 `dsh-workspace-enhancement` 提供 `ctx.ssh/ctx.subprocess/ctx.fs` 远程 provider（"占位连接，懒建立"）；官方树中无 `sshPool` 字样（全树 grep 无命中） | 懒连接句柄存在 provider 插件自己的模块闭包/ctx 字段里；**重载 provider 插件 = 旧池对象被 GC 悬空、连接需重建**（若未在 dispose 中关闭则是泄漏） |
| 日志句柄 | `LoggerService.exporters` Map + 环形 buffer（cordis core:582-605）；exporter 以 fiber effect 注册（:613-617） | exporter 随 fiber 清理，webserver 等宿主日志 sink 若被重载则断流重建 |
| 后台任务/定时器 | `ctx.jobs`（dsh-tool-bash:103 提及）、cordis timer（cordis-plugin-timer） | fiber dispose 走 effect 清理；**插件自己 new 的裸定时器/子进程不在 effect 里则泄漏** |
| 事件总线 `events._hooks` | 按 fiber 注册（core:335-345,371-380） | 随 fiber 清理，安全 |
| 动态插件注册表（cordis_define/run） | dsh-cordis-host-runner 内存 registry | **定义不落盘，进程重启即失**（dsh-tool-cordis:6877）——重启≠热载会丢动态插件，这是动态通道的反向约束 |
| 系统提示/agent preset | `systemPrompt` 服务的 section 注册 | "a dev HMR reload of that plugin drops it until the next boot"（dsh-app-boot:1200-1201 注释）——**提示段热载即丢** |

**交接结论**：cordis 的 fiber 生命周期（dispose→effect 反注册→`_unload`）能干净回收**通过 ctx.effect/ctx.on/ctx.provide/tools.register 注册的一切**；**模块闭包私有状态（连接、缓存、裸定时器、句柄）没有任何交接机制**——旧模块状态在重载时要么泄漏要么悬空，新模块必须自行重建。官方 HMR 与动态插件通道都**不尝试交接私有状态**，靠的是"插件作者在 apply 里重建 + dispose 里清理"。

---

## 5. 结论：理论可行的热载通道清单 + 硬约束与风险

### 现状一句话
**"必须重启"的其实是：① 宿主 node_modules 代码变更（官方设计为 externals → loader.exit() 空转）；② 需要清 ESM/CJS 缓存才能生效的同一入口代码变更。配置（patch YAML）、settings、客户端（浏览器）插件本就热载。**

### 通道清单（按可行度排序）

**通道 1：patch 配置热载（今天就能用，零改动）**
- 机制：HMR `registerConfig` 监视 `~/.dsh/profiles/<p>/cordis.patch.yml` 与 `~/.dsh/cordis.patch.yml`（profile-boot:264-270）→ `Include.refresh` → `EntryGroup.update` 增删改 entry（loader:86-123）。
- 能做什么：**新增一个从未装载的插件入口**（全新 name）→ 现场 import + 启动，免重启；改已有 entry 的 config → 同模块重启。
- 硬约束：改已有插件的**代码**无效（ESM 缓存：同 URL 二次 import 返回旧模块，除非先清缓存）；agent-presets 等"装载时固化"的组合对新会话才生效（用户 patch 注释已注明）。
- 风险：组更新失败有回滚保护（loader:104-122）；重复 id 抛 `duplicate loader entry id`（loader:91）。

**通道 2：官方 HMR partialReload（机制存在，但宿主代码默认不启用；需小改动启用）**
- 机制：`cordis-plugin-hmr` 的 `partialReload()`（hmr:324-435）完整实现了"清 ESM loadCache + CJS require.cache → 重 import → registry 换纤维 → 失败回滚"。
- 可行前提（当前都不满足）：① hmr 配置 `root` 需包含被监视目录（现为 `[]`，profile-boot:261）；② 变更文件不得是 externals（宿主包全在闭包内，hmr:192-195）——**需改 externals 判定或对宿主目录特判**；③ `loader.exit()` 需覆写为"重启进程"或"跳过"（现为空）。
- 硬约束：改造点在官方包 `cordis-plugin-hmr`（或 fork），属于"改官方包"本身——用户改的就是这些 lib，改完仍要重启一次才能生效（鸡生蛋问题，可用通道 4 或一次性重启破解）。
- 风险：仅适合**结构不变的同名插件换代码**；换 name/inject 走 entry.update 的 re-import 路径与 partialReload 路径行为不一致；全局服务/工具双活窗口见 §3.3。

**通道 3：动态 Cordis 插件（官方支持，进程内定义代码）**
- 机制：`cordis_define`（进程内定义不可变 Package，不落盘）→ `cordis_run`（首次激活/restart 当前/update 换版本/rollback）→ `cordis_stop`/`cordis_undefine`（dsh-tool-cordis:6896-6924；host-runner `retract` 先 await dispose 再启新，:2538-2549）。
- 能做什么：**免重启新增/更新/删除宿主侧插件**（含注册工具/服务/事件），有批准流与回滚。
- 硬约束：定义仅存活于当前进程（dsh-tool-cordis:6877）——**重启即失**；每次改代码要 define 新 Package；不能改已装载的官方包文件本身（代码是字符串注入，不是文件装载）。
- 风险：受限执行环境非安全边界（:6878）；更新失败不会自动回滚旧版本（:6916）。

**通道 4：文件级热载的"自举"方案（理论可行，需实现）**
- 机制：利用 loader 既有 API 组合：清缓存（仿 hmr:368-381）→ `loader.import(url)` 重装 → `registry.delete(old)` → `registry.plugin(new, oldConfig)`，或对 entry 走 `entry.update({name: <同URL新specifier>})` 触发 re-import（loader:466）。宿主代码放 watch 目录 + 排除 externals，或独立 watcher（chokidar 已随 hmr 依赖在位）。
- 硬约束：**只热载"纯插件叶子"（改 apply 内逻辑、注册内容），不热载基础设施**（Loader/HMR/settings/session 宿主服务——它们的旧实例被系统引用）；需要 `internal` loader 可用（已可用）；CJS+ESM 双缓存都要清（§2.2）。
- 风险：状态交接无（§4 全部私有状态重载即重建/悬空）；类身份变化（§3.3-6）；服务/工具重名竞态（§3.3-1/2）；回滚需要保留旧模块引用（仿 hmr:382-385）。

**通道 5：worker 隔离重载（最稳，最重）**
- 机制：把可热载插件跑进 `worker_threads`/独立进程，宿主保留稳定入口，worker 内整树可重建。`dsh-workflow-worker-thread` 已证明 worker 通道可用。
- 硬约束：跨 realm 无共享 ctx/service 引用，需 RPC 桥；worker 内插件能访问的 host 能力受限。
- 风险：与现有单进程架构差异大，属大改。

### 推荐判断（供主代理裁决）
- **低投入高确定**：通道 1（patch 热载）+ 通道 3（动态插件）已是官方能力——"新增/更新插件逻辑"无需重启；先确认用户场景是否能用这两条覆盖。
- **中等投入**：通道 2/4 组合——给 hmr 配置宿主 watch 目录 + 覆写 externals 判定 + 覆写 `loader.exit()`（改为跳过或触发受控重启），即可对"改 lib/index.js 的叶子插件"免重启；硬约束是插件须遵守"无私有状态或可重建"约定。
- **不推荐**：对基础设施插件（Loader/HMR/settings/session 等官方宿主服务）做文件级热载——注册表单实例 + 类身份 + 状态句柄三重约束下风险远大于收益。

### 附件：证据索引（全部读自安装树）
- 装载：`cordis-plugin-loader/lib/index.js:270-284, 29-40, 672, 743-744, 405-492, 503-543`
- HMR：`cordis-plugin-hmr/lib/index.js:107, 192-220, 282-323, 324-435, 368-385`
- boot/挂载：`dsh-app-boot/lib/index.js:964-991, 1167-1189, 761-781, 1076-1136`；`dsh/lib/profile-boot-DG5t9aNs.js:258-270`
- cordis 核心：`cordis/lib/index.js:799-823 (812), 1007-1114, 1371-1441, 1564-1640, 1741-1783, 582-617, 1683-1689`
- 注册面：`dsh-scope/lib/index.js:132-218, 27-38, 91-124`；`dsh-tools/lib/index.js:2553-2595, 2762-2770`；`dsh-host-directory-picker/lib/index.js:33-44`；`dsh-tool-bash/lib/index.js:219,259`
- 动态插件：`dsh-tool-cordis/lib/index.js:6873-6924`；`dsh-cordis-host-runner/lib/index.js:2538-2549`
- 状态面：`dsh-settings/lib/index.js:317,460`；`cordis/lib/index.js:582-617`；`dsh-app-boot/lib/index.js:1200-1201`
- 运行时事实：`ps` 显示 `node ~/.npm-global/bin/dsh web` 单进程，无 `--expose-internals`；用户插件部署于 `~/.dsh/profiles/node_modules/@local/*`（真实目录拷贝，与 checkout diff 一致）
