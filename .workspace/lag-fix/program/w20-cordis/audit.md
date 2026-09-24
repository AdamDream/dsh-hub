# W20 cordis 线审计报告：插件生命周期与热载 —— 热载真实边界 / 装载失败静默性 / patch 与升级路径 / 日志出口 / 前三候选

- 日期：2026-09-22（傍晚）｜工作区 `/home/CNS2026495165/dsh`｜独占写入目录 `.workspace/lag-fix/program/w20-cordis/`
- **宿主（本报告末尾快照）**：**PID 2988915**，`node /home/CNS2026495165/.npm-global/bin/dsh web`，**启动 18:11:49**（前宿主 301709 于 18:11 冷面重启中退出）。本报告开头阶段的观测对象是旧宿主 301709（已退出）。
- **纪律声明（可复核）**：全程**只读** —— 未重启宿主、未 `pkill`、未改任何产品文件、未写 `~/.dsh` 任何文件、未写任何 profile；工具调用**全程未传 `sandbox_permissions`**（本会话审批已禁用）。唯一的"写"是向本目录落盘产物。**未启动任何隔离宿主**（未触碰 `exec-hmr/tmp/`）。
- **探针锁**：使用 `.workspace/lag-fix/lib/probe-lock.mjs`。本档进入时锁被 `w14-residual-env`（pid 860747）持有且判 **ALIVE** ⇒ **本档全程未取锁、未做任何高负载 live 探测**（本报告不需要：结论由源码 file:line + 离线实跑 + 静态普查支撑）。查锁记录见 §7.0。
- 授权二级子代理：**2 个**（分支 A = 热载判据表；分支 B = patch/升级路径）。**两个分支均在本轮基础设施级集体中断（含 18:11:49 冷面重启）中失败**，只留下分支 B 的一个已完成产物（`raw/w20-compose-replay.*`，其结论已并入本报告并复核）；分支 A 零产物。因授权额度已用尽，**其余全部工作由本档自行完成**（§6 诚实清单第 1 条）。
- 证据级别标注：**【实跑】**=真文件字节 / 真 md5 / 真进程与 `/proc` 观测 / 真 CLI 输出；**【离线实跑】**=用**真实实现**（真实 npm 包代码）在零宿主负载下执行；**【只读推断】**=仅由源码 file:line 推出。

---

## 0. 结论先行（逐条 PASS / FAIL / INCONCLUSIVE）

| # | 结论 | 判定 | 级别 |
|---|---|---|---|
| **1** | **热载判据表已建立且可判定**：DSH 的"热"只有**三档**——**热①配置重应用**（`cordis.patch.yml` 的 insert/config/disabled，**不重读模块**）、**热②值级**（`settings.yaml` 的**值**，下一次读取即新值）、**热③客户端 bundle**（`lib/client.js` 内容哈希换 rev）；**其余全部是冷面**（宿主 `lib/*.js` 因 **ESM 模块缓存**永不重读、`package.json` 的 `dsh.client` 因 **pkgMeta 永不失效**、settings **schema**、`dsh.profile.bundles` 列表、preset 文件对**已存在会话/子代理**）。见 §1 判据表。 | **PASS** | 【只读推断】+【实跑】 |
| **2** | **热①的机制是"重新应用 config，不重读模块"**，代码级三条链：`dsh/lib/profile-boot-DG5t9aNs.js:256-273`（boot 后确保 `hmr`+`timer`，对 **profile patch 文件**与 **home patch 文件**注册 watcher）→ `dsh-app-boot/lib/index.js:761-781`（`hmr.registerConfig` → `entry.update({config:{...patches}})`）→ `cordis-plugin-hmr/lib/index.js:118-165`（chokidar 盯父目录）→ `Include._apply`（`dsh-app-boot/lib/index.js:236-242`）。**模块重读点**只有 `dsh-app-boot/lib/index.js:966-975` 与 `cordis-plugin-loader/lib/index.js:270-281`（`import()`）⇒ 命中 Node ESM 缓存。 | **PASS** | 【只读推断】 |
| **3** | **热①的两个未被任何既有文档记录的硬边界**（本档新增判据）：① **改 bundle 自带 patch 文件（如 `@deepseek-ai/dsh-base/cordis.patch.yml`）不是热**——`composeLive`（`profile-boot-DG5t9aNs.js:241-246`）**在 boot 时就把 `composed.bundlePatches` 冻结**，watcher 只重读 profile patch 与 home patch；② 改 `~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles` **不是热**（`loadProfile` 只在 boot 跑，`dsh-app-boot/lib/index.js:539-566`）。 | **PASS** | 【只读推断】 |
| **4** | **`@local/*` 的 5 个 `cordis.patch.yml` 全部是死文件**（任务书"当前 5 个 patch 文件"的前提**不成立**）：`~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles` **只有 `["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app"]`**，而 `loadProfile` 只装载 **bundles 列表内**包声明的 patch（`dsh-app-boot/lib/index.js:546-557`）。实跑 compose replay：`bundleLayers` = 仅这两个包，**活跃 patch 文件 = 3 个（2 bundle + 1 profile）+ home 层不存在**；死文件 = **7 个**（5 个 `@local/*` + `dsh-workspace-enhancement` + 1 个备份）。 | **FAIL**（任务书前提） | 【实跑】 |
| **5** | **`insert` 条目自身能活过插件升级，插件 payload 里的手改不能活** ⇒ **静默回滚**：`insert` 写在 **profile patch（包外）**，覆盖 `~/.dsh/profiles/node_modules/@local/<pkg>` 不会碰它；但 `lib/*.js` 与 `package.json` 的手改**全部只在 deployed**。逐包 md5 普查：**8 个包中 7 个**至少有一个 payload 文件与"workspace 源"不一致（唯一例外 `@local/dsh-subagent-model`，其 `lib/` 与源逐字节相同）。 | **PASS** | 【实跑】 |
| **6** | ⚠️ **不是 `dsh-usage` 独有，而是 `@local/*` 全体通病**（w05 §4.4 的泛化）：deployed-only 手改实例——`dsh-usage/lib/client.js`（**81 631 B vs 源 35 294 B**，dated `2026-09-12 heatmap redesign v2`）、`dsh-usage/package.json`（`dsh.client.inject` **多出 `@deepseek-ai/dsh-client-ui-settings`**）、`dsh-workerspace/lib/index.js`（2 处 `additionalProperties: false`）、`dsh-wallpaper/lib/client.js`（`shadedTokens` 覆盖层去重 19 行）、`dsh-workspace-enhancement/package.json`（多出 `cpu-features`/`koffi`/`node-pty`）。**而且漂移是双向的**：`dsh-btw/lib/client.js` 的 **workspace 源更新**（17:15、+727 行）而 **deployed 仍停在 16:55**。 | **PASS** | 【实跑】 |
| **7** | **U-IG3"只存在于 deployed"逐字复核通过**：`dsh-usage/lib/db.js` workspace `md5 9c34690e…` vs deployed `md5 d187d449…`（**与 w05 §4.1 记录的 md5 逐字一致**），diff 显示 deployed 独有 `PRAGMA busy_timeout = 5000`、`PRAGMA temp_store = 2`、`spanDays` 区间对齐 DELETE、日历锚定 `hiExclusive`。 | **PASS** | 【实跑】 |
| **8** | 🔴 **全局树（产品包）的手改补丁在升级后会静默丢失，且恢复脚本已不覆盖最新补丁**：既有恢复器 `.workspace/workstreams/deploy/deploy-lag/replay-lag-fix.sh`（mtime **09-20 16:07**）只覆盖 **5 个包**（`dsh-agent-loop`/`dsh-client-ui-subagent`/`dsh-web-search-deepseek`/`dsh-host-apiproxy`/`dsh-subagent`）+ `settings.yaml`；对 `dsh-client-runtime`（P1/P2 性能补丁）、`dsh-client-ui-settings-general`、`dsh-client-ui-renderer`+`dsh-client-hmr`（exec-hmr 实时缺陷修复，已 sha256 核对落地）、`dsh-client-modules`、`@local/dsh-usage` 的命中数**全部 = 0**。 | **FAIL** | 【实跑】 |
| **9** | **patch 条目未命中 id 时"静默跳过"**：`applyEntryPatches`（`dsh-app-boot/lib/index.js:73-99`）对 `insert` 目标不存在 / 非 group / `name` 不匹配**只 `warn` 后 `continue`**；而该 warn 的出口是 `:199-201` `this.ctx.root.logger?.("loader").warn(...)` ⇒ 撞上结论 11/12 的日志黑洞 ⇒ **零诊断**。反之 **插件本身装载失败是大声失败**（`installFailLoud` `:1043`、`assertEntriesLoaded` `:1076`、`assertEntriesActivated` `:1107`、`FAIL_LOUD_RELEASE_TIMEOUT_MS=2e3` `:1013`）。 | **PASS**（机制确证） | 【只读推断】 |
| **10** | **`web` profile 的 bundles 列表不会被静默改写**：`INSTALLATION_OWNED_PROFILE_TUPLES` 只含 `headless`（`dsh-app-boot/lib/index.js:328-333`），`normalizeShippedProfile`（`:473-498`）对 `web` 直接 `return manifest`。⇒ `insert` 层无"自愈回滚"风险。 | **PASS** | 【只读推断】 |
| **11** | **w13 的 F1 独立复核成立**：cordis **唯一** exporter 是 1000 条内存环形缓冲（`cordis/lib/index.js:583-604`），且 `self.buffer` **全树零读取点**（`:584` 声明、`:601` 写入、`:602` 裁剪；全 `@deepseek-ai/*` 树 + Web 前端 bundle 复核后无其它读点）。`~/.dsh/logs` **不存在**；`journalctl _PID=<host>` ⇒ **No entries**；进程链 `host ← bash ← terminator ← gnome-shell` **【实跑】**。 | **PASS** | 【实跑】 |
| **12** | 🔴 **对 F1 的加强（本档新增，w13 未记）**：**`warn` 与 `debug` 连环形缓冲都进不去，被完全丢弃**。过滤式 `cordis/lib/index.js:474` 的阈值 = `exporter.levels?.default ?? this.level ?? 1`，而内置 exporter（`:598-603`）**没有 `levels` 字段**，且**三个活跃 patch 层（dsh-base / dsh-web-app / profile）与 home 层全都不含 `logger:` 条目**（逐文件 grep 命中 0）⇒ `this.level === undefined` ⇒ 阈值 = **1**；而 `:457-460` 定义 `error=0 / info=1 / warn=2 / debug=3` ⇒ **`warn` 被 `continue` 掉**。**离线实跑**：无 logger 配置时环形缓冲只收到 `["error","info"]`（长度 2）；阳性对照 `exporter.levels.default=3` 时四级全过。⇒ **"`log.warn` 落进终端回滚缓冲"不成立：它哪儿都没去。** | **PASS** | 【离线实跑】+【实跑 grep】 |
| **13** | **② 未注册命名空间静默失效确证**：`dsh-settings/lib/index.js:388-390` `get(ns) { return this.registrations.get(ns)?.resolved; }` —— **未注册返回 `undefined` 不抛**（`register` 的重复注册才抛，`:312`）；消费方 `dsh-tool-subagent/lib/index.js:119-136` `effectiveConfiguredAgentOptions`：`:121-126` 把 `settings` 服务缺失**与 `get` 抛错**一并吞成 `settingsValue = undefined`，`:127` `if (settingsValue === void 0 …) return configured;` ⇒ **静默回落 preset**。 | **PASS** | 【只读推断】 |
| **14** | ⚠️ **②的修法与④强耦合（关键裁决）**：在该消费点加**一次性 `warn`** 是"最小"的，但按结论 12，该 warn **会被级别过滤直接丢弃** ⇒ **只修 ② 的收益严格为 0**。⇒ 最小告警方案**必须**与一个**可见出口**同批落地（方案见 §2.3：W-1 热面 exporter + W-2 冷面一次性 warn + W-3 热面孤儿段巡检）。 | **PASS** | 【离线实跑】+【只读推断】 |
| **15** | **④最小修法可完全走热面（零重启）**：`LoggerService.exporter()` 是公开 API（`cordis/lib/index.js:613-617`），而"往组合里 `insert` 一个本地插件"是**热①**（结论 2）⇒ 一个注册**文件 exporter** 的薄插件即可拿到宿主持久日志出口，**不需要冷面重启**。⚠️ **但卸载不自动回收**：`exporter()` 内部的 `this.ctx.effect(...)` 绑在**根 ctx**（`:613-617` 的 `this.ctx.effect` 里 `this.ctx` 是 LoggerService 构造时传入的**根 ctx**，见 `:595-596` 与 `:1687`）⇒ 插件必须自己再登记一个 `ctx.effect` 调用返回的 disposer，**否则热删除 `insert` 条目后 exporter 仍活着**。 | **PASS**（可行性）/ **INCONCLUSIVE**（端到端未跑） | 【只读推断】 |
| **16** | **新 HMR 时序缺陷的修复已逐字节落地**：`dsh-client-ui-renderer/lib/client.js` sha256 = **`7468f0c67407622f83a483d8d7f1788069ead374218aff2d6ef0b76cd4143172`**（= `exec-hmr/candidate/A1-renderer.patched.client.js`）、`dsh-client-hmr/lib/client.js` sha256 = **`8ea91bb3b48ccb3f2b416739ab9fb305966f442042f5152c4f97b0f9412b1efc`**（= A2）。**两者与候选逐字节相等 ⇒ 落地确认**。 | **PASS** | 【实跑】 |
| **17** | **相邻缺陷（跨插件样式误删）机制确证、可达性未证实**：`dsh-client-modules/lib/client.js:130-138` `claimStyles(id)` 第 `:135` 行 `document.querySelectorAll("style:not([data-plugin])")` 把**所有未打标 `<style>` 认领给"当时正在物化的插件"**（全仓唯一打标点），而 `dsh-client-hmr/lib/client.js:27-28` `removeOwnedStyles(id)` 在 `:53`（`await entry.refresh()` **之前**）**逐字比较 `data-plugin` 属性删除**。若插件 A 的样式在 A 的 `claimStyles` 之前就已存在于 DOM，而 B 此时物化，标签会被记到 B 名下 ⇒ B 热刷新时删掉 A 的样式。**但**探明各插件用 `data-plugin-css` 幂等标记在 factory 内同步注入，且 `claimStyles` 紧随 factory ⇒ 未构造出可达路径。 | **机制 PASS / 可达性 INCONCLUSIVE** | 【只读推断】 |
| **18** | **冷面锚点（本次重启提供）**：新宿主 18:11:49 启动，`@local/*` + `dsh-workspace-enhancement` 的宿主侧 `lib/*.js` **57/57 全部早于启动时刻**（NEWER than boot = **0**）⇒ 当前**没有冷面待生效漂移**；所有宿主侧改动都已在生效代际内。 | **PASS** | 【实跑】 |

---

### 0.1 任务书五问 → 结论索引

| 任务书要求 | 覆盖位置 | 一句话结论 |
|---|---|---|
| ① **热载覆盖面的真实边界**（宿主模块 ESM 缓存 / schema 属冷 / 组合文件 stamp） | §1 判据表（18 行） | **热只有三档**（热① 配置重应用、热② 值级、热③ client bundle）；**ESM 缓存 + pkgMeta 永不失效 + schema + bundles 列表 + preset 对已存在会话** 是五条冷线。**新增两条边界**：bundle 自带 patch 与 bundles 列表改动**连热①都不算** |
| ② **插件装载失败与缺失的静默性** + 最小告警 | §2 | 缺口确证（`dsh-settings:388-390` + `dsh-tool-subagent:119-136`）；**但 warn-only 修法收益为 0**（§0 结论 12/14）⇒ 三单元最小方案 |
| ③ **`cordis.patch.yml` 补丁与升级路径** | §3 | **活跃 patch = 3，死文件 = 7**（任务书"5 个"是死文件数）；**insert 层活、payload 层死**；**静默回滚是 `@local/*` 全体通病**；**全局树升级后有 6 类补丁没有任何脚本保护** |
| ④ **插件日志出口缺失 + 最小修法** | §4 | F1 复核 PASS 并**加强**（warn 也被丢）；最小修法 = **热面 exporter 薄插件**（零重启），含卸载不回收的坑 |
| ⑤ **前三优化候选** | §5 | C1 宿主日志出口（热面）> C2 未注册命名空间告警（热+冷）> C3 部署漂移校验器（冷+热） |

---

## 1. ① 热载覆盖面的真实边界 —— 可判定判据表

### 1.1 判据表（主交付）

> **判据写法约定**：每行给一个**不依赖主观判断、可在不重启前提下执行的判定动作**。
> "热"= 按判据做完后**不重启即观察到生效**；"冷"= 按判据做完后**不重启永远观察不到生效**。

| # | 改动对象 | 热/冷 | 生效延迟 | **可判定判据** | file:line 依据 | 等级 |
|---|---|---|---|---|---|---|
| H1 | `~/.dsh/profiles/web/cordis.patch.yml` 的 `insert`（新增插件 id） | **热①** | 文件落盘后 chokidar 事件 → `entry.update()` 完成（既有实测 ~1 s） | 写文件后**不重启**，`session.list`/GUI 里出现该插件注册的工具或设置段（或 `host.describe` 类枚举里出现新条目） | `dsh/lib/profile-boot-DG5t9aNs.js:256-273`（watcher 注册）→ `dsh-app-boot/lib/index.js:761-781`（`hmr.registerConfig` + `entry.update`）→ `cordis-plugin-hmr/lib/index.js:118-165`（chokidar）→ `dsh-app-boot/lib/index.js:236-242`（`_apply` → `root.update(data)`） | 【只读推断】（延迟为既有实测） |
| H2 | 同上，对**已存在条目**的 `id` 级 `config` 覆盖 / `disabled: true` | **热①** | 同上 | 同上；配置类（如 `disabled`）判据 = 该插件注册的工具在**不重启**下消失/出现 | `dsh-app-boot/lib/index.js:87-103`（`id` 级覆盖走同一 `applyEntryPatches`） | 【只读推断】 |
| H3 | `~/.dsh/cordis.patch.yml`（home 层） | **热①** | 同上 | 同上（**注意该文件当前不存在**，`homePatchExists:false`） | `profile-boot-DG5t9aNs.js:269-273`；`dsh-app-boot/lib/index.js:793-811`（缺失=无层，不报错） | 【实跑】 |
| H4 | **bundle 自带**的 `cordis.patch.yml`（`dsh-base` / `dsh-web-app` / 任何 `dsh.profile.bundles` 内的包） | **不热（且不冷）** | 改它**不触发任何 watcher**；要等**下一次 profile patch / home patch 有改动**才被连带重算，但**重算时用的仍是 boot 时冻结的 bundlePatches** ⇒ **必须重启** | 改该文件后不重启、且**不动** profile patch ⇒ 行为**完全不变**（即使随后动一下 profile patch，仍不变，因为 bundlePatches 是 boot 快照） | `profile-boot-DG5t9aNs.js:241-246` `composeLive` 用 `...composed.bundlePatches`（boot 期捕获）+ 重新 `loadOptionalPatches(profile.patchPath)` / `loadOptionalPatches(homePatchPath())` | 【只读推断】 |
| H5 | `~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles` 列表 | **冷** | 重启 | 改完后不重启 ⇒ `loader` 图不变（`bundleLayers` 不变） | `dsh-app-boot/lib/index.js:539-557`（`loadProfile` 只在 boot 调）；`profile-boot-DG5t9aNs.js:166-198`（`composeProfile` 只在 boot 调） | 【只读推断】 |
| H6 | **`@local/*` 包内的 `cordis.patch.yml`** | **死文件** | 永不 | 改它**永远无效果**（该包不在 `bundles` 列表 ⇒ `loadProfile` 从不读它） | `dsh-app-boot/lib/index.js:546-557`；实跑 `bundleLayers` 仅 `dsh-base`+`dsh-web-app`（`raw/w20-compose-replay.out.json`） | **【实跑】** |
| H7 | 插件**宿主** `lib/*.js`（含 `@local/*` 与全局树产品包） | **冷** | 重启 | 改完后不重启 ⇒ 行为按**旧**字节（可用"改一行可见行为"判定） | 模块重读点只有 `dsh-app-boot/lib/index.js:966-975` 与 `cordis-plugin-loader/lib/index.js:270-281`；`cordis-plugin-loader/lib/index.js:466` **`name` 未变时直接复用 `previous.runtime.callback`（连 import 都不发起）**，即使发起也命中 **Node ESM 缓存** ⇒ `apply` 之外无任何新代码 | 【只读推断】+【实跑】（H7 的冷面锚点：结论 18） |
| H8 | `~/.dsh/settings.yaml` 的**值** | **热②** | 下一次读取 | 改值后不重启，读一次消费点（如派发一个子代理看模型）即见新值 | `dsh-tool-subagent/lib/index.js:119-136`（**每次派发重读** `:123`）→ `dsh-settings/lib/index.js:388-390`。⚠️ **前提是该命名空间已注册**，否则退化为"静默无效"（§2） | 【只读推断】（行为切点由 w06 §5.1 四重证据钉死） |
| H9 | settings 的 **schema / `Config`** | **冷** | 重启 | 改 schema 后不重启 ⇒ 设置页字段与新校验**不出现**；已存值仍按旧 schema 解析 | `dsh-settings/lib/index.js:311-326`（`register(ns, schema, …)` 把 `schema` 与 `resolved` **一次性快照**进 registration，`:319`）；`registration` 全靠**插件 `apply` 重跑**才能刷新，而 `apply` 重跑需要新模块（H7）⇒ 冷 | 【只读推断】 |
| H10 | `lib/client.js`（客户端 bundle）内容 | **热③** | 浏览器刷新（或等 SSE `rebuilt` 换 rev） | 改文件后**不重启宿主**，**刷新页面** ⇒ 新行为出现；URL 上 `?rev=<hash>` 变化 | `dsh-client-hmr/lib/index.js:40-102`（statSync 轮询 + rehash）、`:43` `ctx.clientModules.rebuilt(id)`、`:11/:147` SSE `/plugins/events`；`dsh-client-modules/lib/index.js:327-339`（`shortHash(readFileSync(clientPath))`）、`:152-157`（`/plugins/<id>/client.js?rev=<rev>`） | 【只读推断】+【实跑】（exec-hmr 已实测触发 `rebuilt` 帧） |
| H11 | `package.json` 的 `dsh.client` 声明（含 `inject` / `platform` / `immediately`） | **冷** | 重启 | 改完不重启 ⇒ graph 行**不变**（`inject` 不生效） | `dsh-client-modules/lib/index.js:81-85` 文档字面：**"Package metadata (including the negative 'not a client package' verdict) is cached per name and never expires — plugin-set changes take effect on restart"**；`pkgMeta = new Map()` `:261`；`resolveMeta` `:377-403` **无任何失效路径** | **【实跑（文档字面）+ 只读推断】** |
| H12 | preset 文件（`~/.dsh/.agent-presets/*/agent.cordis.yml`）对 **新建会话** | **半热（"下次 mount 生效"）** | 下一个 `mount()` | 改后不重启，**新开一个会话** ⇒ 新组合；**同一批已存在会话** ⇒ 旧代际 | `dsh-agent-presets/lib/index.js:954-961` `mount()` → `:1130-1159` `ensureStanding`，`:1134` 用 `compositionStamp(preset.path)` 比对（`:1162-1169` = `mtimeMs + size`）；stamp 变了才删 standing 重挂 | 【只读推断】 |
| H13 | preset 文件对**子代理**（`composeFrom`） | **冷（本会话内永久）** | 不可能 | 改 preset 后**不重启**派发子代理 ⇒ 仍用**父代**组合 | `dsh-agent-presets/lib/index.js:988-995` `composeFrom` → `standingMountFor(parentCtx)` + `bindScopeParent(agentKey, standing.key)`：**不读 roster、不 stat 文件、不调 `ensureStanding`**（docstring `:968-972` 自陈）；实测旁证（w06 §7.1：改 preset 后 41 s 派发的子代理仍用旧模型） | 【只读推断】+【实跑旁证】 |
| H14 | 组合**结构**（`insert`/`remove`）对**已存在会话** | **冷（本会话内）** | — | 改组合后**不重启**、**已存在的会话** ⇒ 仍用旧 fiber 图 | 同 H12/H13：已存在会话不重新 `mount()` | 【只读推断】 |
| H15 | `dsh-client-modules` 之外的**宿主→客户端**契约（`exports["./client"]` 缺失） | **大声失败** | 不适用 | 启动即抛（`client-modules: <pkg> declares dsh.client but exports no "./client" bundle`） | `dsh-client-modules/lib/index.js:395`（`throw new Error(...)`） | 【只读推断】 |
| H16 | `cordis.patch.yml` 的 `insert` 用**文件路径**而非 bare 包名 | **大声失败（整次回滚）** | 不适用 | 启动即失败/整次回滚 | 架构文档 `docs/architecture/02-plugin-system.md:124-125`（"实测固化"）；`mountRootInclude` 的 `internal.import(specifier, bareModuleBaseUrl, {})` `dsh-app-boot/lib/index.js:966-975` | 【只读推断】 |
| H17 | `insert` 的 `id` 与已有条目**重复** | **热①（覆盖）** | 同上 | 追加一个同 id 条目 ⇒ 后写覆盖（`buildMap` 以 id 为键，后入胜） | `dsh-app-boot/lib/index.js:60-67`、`:84` | 【只读推断】 |
| H18 | 组合条目针对**不存在的 id** 打补丁 | **静默失败** | 永不 | 打补丁后不重启 ⇒ 无任何变化，**且无任何日志**（见 §3.4） | `dsh-app-boot/lib/index.js:73-75`（`warn` + `continue`）→ warn 出口 `:199-201` `logger.warn`（被结论 12 丢弃） | 【只读推断】 |

### 1.2 冷热边界的**机制根**（为什么只有这三档）

```
                      ┌─ profile patch / home patch  ──► chokidar ──► entry.update(config)
改配置（组合层） ─────┤                                              ⇒ 热①（只重跑 apply，不重读模块）
                      └─ bundle patch / bundles 列表 ──────────────► boot 期冻结 ⇒ 冷
改模块代码（lib/*.js）────────────────────────────────────────────► ESM 模块缓存 ⇒ 冷（永不重读）
改 settings 值 ───────────────────────────────────────────────────► 每次读 YAML ⇒ 热②
改 settings schema ───────────────────────────────────────────────► schema 随 register() 快照 ⇒ 冷
改 client.js 内容 ────────────────────────────────────────────────► 内容 sha1 换 rev ⇒ 热③（刷新即见）
改 package.json dsh.client ───────────────────────────────────────► pkgMeta 永不失效 ⇒ 冷
改 preset 文件 ───────────────────────────────────────────────────► mount() 查 stamp ⇒ 下次 mount 生效；
                                                                      subagent 走 composeFrom 不查 ⇒ 冷
```

**一句话判据**（给现场用）：**"这次改的是**文件内容**还是**配置对象**？改文件内容（`lib/*.js`、`package.json` 结构）几乎一律冷；改 profile/home 层的 `cordis.patch.yml` 一律热；改 client bundle 内容一律热（刷新）；改 settings 的**值**一律热，改它的**形状**一律冷。"**

### 1.3 未覆盖 / 新发现（本档新增，既有文档 §5 矩阵没有的行）

| 新增行 | 内容 | 为什么既有矩阵漏了 |
|---|---|---|
| **H4** | **bundle 自带 patch 改动不是热**（`composeLive` 冻结 `bundlePatches`） | 既有矩阵只写"`cordis.patch.yml` 的 insert/config 覆盖 = 热①"，**未区分 profile 层与 bundle 层**；两者语义完全不同 |
| **H5** | `dsh.profile.bundles` 列表改动是冷 | 既有矩阵只提"`cordis.patch.yml` 的 insert/remove/disable/name/config"，未提 bundles 列表本身 |
| **H6** | `@local/*/cordis.patch.yml` 是**死文件**（包不在 bundles 列表） | 既有矩阵与 §2.1 只说该文件"可选、只有声明 `dsh.bundle.patch` 的包才需要"，**未指出"声明了但不在 bundles 列表里 ⇒ 永不装载"** |
| **H11** | `dsh.client` 声明冷，**并有逐字文档依据**（pkgMeta never expires） | 既有矩阵写"冷（pkgMeta 缓存）"，**未给 file:line 与"永不失效"的字面** |
| **H13** | preset 对子代理**本会话内永久冷** | 既有矩阵只写"新建会话即生效；已存在会话保持原代际"，**未指出子代理走 `composeFrom` ⇒ 连 `mount()` 的 stamp 检查都绕开** |
| **H18** | 组合条目打不存在的 id ⇒ **静默失败且零日志** | 既有 §4.2 只写"失败即大声失败"（指非顶层数组 / bundle 缺 `dsh.bundle` / `--patch` 缺文件），**未覆盖"id 未命中"这一类**，而它恰恰是静默的 |

### 1.4 本次冷面重启提供的实证锚点【实跑】

| 项 | 值 |
|---|---|
| 新宿主 PID / 启动时刻 | **2988915** / **2026-09-22 18:11:49**（`/proc/2988915` ctime） |
| `@local/*` + `dsh-workspace-enhancement` 宿主侧 `lib/*.js` | **57 个**；早于启动 = **57**；**晚于启动（冷面待生效）= 0** |
| client bundle（`lib/client.js` × 7） | 最晚 17:21:48（壁纸），全部早于启动 |
| 最"新"的 deployed 宿主改动 | `@local/dsh-usage/lib/db.js` **09-21 17:12:07**（w05 的 U-IG3 修复，晚于本次启动 ⇒ **已在生效代际内**） |
| 推论 | 当前**不存在**"改了没生效"的宿主侧漂移；**但** `dsh-btw/lib/client.js` 的 **workspace 源（17:15:06，+727 行）尚未部署到 deployed（16:55:55）** ⇒ 这是一条**随时可做、且走热③（刷新即见）**的待落地项 |

---

## 2. ② 插件装载失败与缺失的静默性 —— 缺口、耦合与最小告警方案

### 2.1 缺口逐条确证（file:line 逐字）

| # | 环节 | 逐字行为 | file:line | 判定 |
|---|---|---|---|---|
| S-1 | 读取未注册命名空间 | `get(ns) { return this.registrations.get(ns)?.resolved; }`；JSDoc 明写 *"the resolved value, or `undefined` while unregistered"* ⇒ **不抛** | `dsh-settings/lib/index.js:383-390`（JSDoc `:386`、实现 `:388-390`） | **PASS** |
| S-2 | 重复注册才抛 | `if (this.registrations.has(ns)) throw new Error(...)` | `dsh-settings/lib/index.js:312` | **PASS** |
| S-3 | 消费点吞掉"服务缺失"与"读取抛错" | `try { const settings = runtimeCtx.get("settings"); settingsValue = settings === void 0 \|\| typeof settings.get !== "function" ? void 0 : settings.get("dsh-subagent"); } catch { settingsValue = void 0; }` | `dsh-tool-subagent/lib/index.js:120-126` | **PASS** |
| S-4 | 静默回落 preset | `if (settingsValue === void 0 \|\| typeof settingsValue !== "object" \|\| settingsValue === null) return configured;` | `dsh-tool-subagent/lib/index.js:127` | **PASS** |
| S-5 | 调用点（每次派发） | `const effectiveAgentOptions = effectiveConfiguredAgentOptions(runtimeCtx, config.agentOptions);` | `dsh-tool-subagent/lib/index.js:530` | **PASS** |
| S-6 | **零告警的放大器** | 即使有人补了 `warn`，它走 `cordis/lib/index.js:474` 的级别过滤 ⇒ **被丢弃**（阈值 1 < warn 的 2） | `cordis/lib/index.js:457-460、:474、:598-603` | **PASS（本档新增）** |

**⇒ 段静默失效的完整链**：`@local/dsh-subagent-model` 未挂载（或挂载失败被 `disabled`）⇒ `registrations` 里没有 `dsh-subagent` ⇒ `get()` 返回 `undefined` ⇒ 消费方回落 preset ⇒ **`~/.dsh/settings.yaml` 里的 `dsh-subagent:` 段完全无效，宿主与日志零告警**。同一模式适用于**任何**"插件注册命名空间 + 其它插件消费"的组合（`dsh-usage` / `session-status-board` / `wallpaper` / `vision-adam` 同构）。

### 2.2 为什么不能只加一个 `warn`（关键裁决）

| 假设修法 | 名义收益 | 实际收益 | 依据 |
|---|---|---|---|
| 只在 `effectiveConfiguredAgentOptions` 加一次性 `warn` | "有告警了" | **0** | 该 warn 级别 = 2，阈值 = 1 ⇒ 在 exporter 循环 `cordis/lib/index.js:474` 被 `continue`，**连环形缓冲都不进**（结论 12 的离线实跑：缓冲只收到 error/info）；且无 console/file exporter（结论 11）⇒ **没有任何人能看见它** |
| 只加 `console.warn`（旁路 logger） | 落到宿主 stderr | **低但非 0**：宿主 stderr 是 **Terminator 的 pty**（进程链实跑）⇒ 只在终端回滚缓冲里，滚屏即丢，重启即丢，无时间戳落盘 | 进程链 `host ← bash ← terminator ← gnome-shell`【实跑】 |
| **加 exporter + 升级别阈值 + 一次性 warn** | 告警**可见、可留存、可复查** | **正收益** | §2.3 |

### 2.3 最小告警方案（三单元，含热冷面/验收/回滚）

> 设计目标：**最小**（一个薄插件 + 一处冷面 warn）、**可判定**、**可回滚**、**不新增产品文件**。

#### W-1（热面，零重启）宿主日志文件出口 —— 同时是 §4 的最小修法

新建本地插件 `~/.dsh/profiles/node_modules/@local/dsh-logfile/`，经 **profile patch 的 `insert`（热①）**挂载：

```js
// ~/.dsh/profiles/node_modules/@local/dsh-logfile/lib/index.js
import { createWriteStream, mkdirSync } from 'node:fs'
export const name = '@local/dsh-logfile'
export const inject = []                     // 不 inject ⇒ 尽早注册，能抓到 boot 期的 warn

export function apply(ctx, config) {
  const dir = config?.dir ?? '/home/CNS2026495165/.dsh/logs'
  mkdirSync(dir, { recursive: true })
  // NOTE: 唯一需要斟酌的点 —— 文件句柄随插件卸载关闭（见下面 rollback）
  const stream = createWriteStream(`${dir}/dsh-host.jsonl`, { flags: 'a' })

  // ⚠️ cordis/lib/index.js:595-596 + :613 的 effect 绑在【根 ctx】(:1687)，卸载本插件不会移除 exporter
  //    ⇒ 必须自己登记 effect，在 dispose 时调用 exporter() 返回的 disposer
  ctx.effect(() => {
    const dispose = ctx.logger.exporter({
      colors: 0,
      // 阈值语义（cordis/lib/index.js:474）：level 数值越小越严重
      //   error=0 / info=1 / warn=2 / debug=3；默认阈值 1 ⇒ warn 被丢（结论 12）
      levels: { default: config?.level ?? 2 },   // 2 = error+info+warn；3 = 含 debug
      export: (m) => {
        stream.write(JSON.stringify({
          ts: m.ts, type: m.type, level: m.level, name: m.name,
          msg: m.args.map((a) => (a instanceof Error ? (a.stack ?? a.message) : a)),
        }) + '\n')
      },
    })
    return () => { try { dispose?.() } catch {} ; stream.end() }
  }, '@local/dsh-logfile: exporter')
}
```

挂载（**一处 insert，热①，不重启**）：

```yaml
# 追加到 ~/.dsh/profiles/web/cordis.patch.yml 末尾
- insert:
    - id: logfile
      name: '@local/dsh-logfile'
```

- **收益**：宿主第一次拥有**持久、带时间戳、可 grep** 的插件日志出口；**同时把 `warn` 级（阈值 2）从"被丢弃"变成"被记录"** ⇒ 这是②③④三条线的共同数据源前提（与 w13 的 `I-1` 同一靶点，本档给出**热面落地形态**）。
- **风险**：① 高频日志会写盘 —— 用**同步 `write` 到流**（非 `appendFileSync`）+ 阈值 2（不含 debug）即可，量级 = 现有 warn 频率；② 若某插件在满负载下 `warn` 风暴，需要给 `export` 加**简单的行数/字节上限轮转**（可选）；③ **不要把阈值设成 3**（debug 量级未知）。
- **验收（可判定）**：
  1. 落地后**不重启**，手工触发一次已知 `warn`（例如把某条 `insert` 指向一个**不存在的 id** ⇒ `applyEntryPatches:74` 发 warn），然后 `grep <id> ~/.dsh/logs/dsh-host.jsonl` **必须命中**（这一条同时验收了 W-1 与 H18 的可观测性）。
  2. **重启宿主**后文件**仍有**历史行（`flags: 'a'`）且新 boot 的 `warn/info` 继续追加 ⇒ 证明"重启后仍在"。
  3. **反例对照**：`levels.default` 缺省（=1）时同一触发**必须不落盘** ⇒ 证明级别阈值改对了。
- **回滚**：**热面** —— 从 `cordis.patch.yml` 删掉该 `insert` 条目即可（若 `ctx.effect` 的 dispose 正确，exporter 与文件句柄同时关闭）；**若发现热卸载未回收 exporter**，则降级为"重启回滚"（属本单元必须自测的副作用）。
- **面**：**热面（零重启）**。

#### W-2（冷面）未注册命名空间一次性告警 —— 源头修法

在 `dsh-settings` 的 `get()`（产品包，冷面）加**每命名空间一次性** warn：

```js
// dsh-settings/lib/index.js:388-390 附近（示意；产品包改动 => 冷面）
get(ns) {
  const reg = this.registrations.get(ns);
  if (reg === void 0) {
    this.unregisteredWarned ??= new Set();
    if (!this.unregisteredWarned.has(ns)) {          // 一次性：避免热路径刷屏
      this.unregisteredWarned.add(ns);
      this.ctx.logger?.('settings').warn(
        'settings namespace %C is not registered; readers get undefined (silent). ' +
        'A consumer plugin may be missing or failed to mount.', ns);
    }
    return void 0;
  }
  return reg.resolved;
}
```

- **收益**：**一处**修法覆盖**所有**"插件缺失 ⇒ 命名空间消失 ⇒ 消费方静默回落"的组合（`dsh-subagent` / `dsh-usage` / `session-status-board` / `wallpaper` / `vision-adam` …），而不是逐个消费点打补丁。
- **风险**：① `get()` 是热路径，**必须一次性去重**（上面用 `Set`）；② 某些插件**故意**探测未注册命名空间（可选依赖探测）⇒ 会有噪声 ⇒ 缓解：只对**在 `settings.yaml` 里存在该段**的 ns 报（见 W-3），或给 `get` 加 `get(ns, {optional:true})` 显式静默（**新增 API = 冷面 + 兼容面，建议次批**）；③ **冷面**：`dsh-settings` 是产品包 ⇒ 需重启，且**必须与 W-1 同批**，否则告警照样看不见（结论 14）。
- **验收**：① 制造"命名空间未注册但 settings.yaml 有该段"的状态（例如把 `@local/dsh-subagent-model` 的 `insert` 注释掉 —— **注意这是热①，不需要重启就能制造**），要求**恰好一行** warn 且 `dsh-subagent:` 段被点名；② 连续派发 10 个子代理，要求 warn **仍只有 1 行**（一次性生效）【反例对照：不加 `Set` 应出现 10 行】；③ 恢复正常后**无**该 warn。
- **回滚**：还原 `get()` 到 388-390 原字节（一行）。
- **面**：**冷面**（`dsh-settings` 是产品包）。

#### W-3（热面，零重启）孤儿 settings 段巡检 —— 覆盖"未注册"的**检测侧**

一个薄插件（可并入 W-1 同包），在 `apply()` 时与**每次 settings 变更**时对比两个集合：

| 集合 | 来源（都是公开 API） |
|---|---|
| **已注册命名空间** | `settings.describe()`（`dsh-settings/lib/index.js:352-382`，返回**逐注册项**的 `ns`） |
| **settings.yaml 里的段名** | `settings.documentPath`（`:291`）/ `prepareDocument()`（`:298-300`）给的**文档路径** ⇒ 只读 YAML 顶层键 |

差集非空 ⇒ **warn + 落盘**："settings 段 X 没有任何插件注册它 ⇒ 该段静默无效"。

- **收益**：**不需要改任何产品文件**就用**热面**覆盖②的全部检测面（含"插件根本没装"这种 `dsh-settings` 也无从知道的场景 —— 因为 W-2 只在**有人调用 `get()`** 时才报警，而"没人调用"的孤儿段只有本方案能发现）。
- **风险**：① `describe()` 在命名空间很多时是一次 O(n) 调用 ⇒ 只在 apply 与 settings 变更时跑，不在热路径；② 需要读 YAML（`yaml` 已在依赖树里，例如 `dsh-app-boot` 用它）；③ 误报面：**故意保留的历史段**（用户留着的旧配置）会被点名 ⇒ 用 info 级而非 warn，或加白名单。
- **验收**：① 在 `settings.yaml` 里加一个假段 `w20-nonexistent:` ⇒ 不重启即在日志里出现"该段无注册方"；② 删掉该段 ⇒ 告警消失；③ 对 5 个已知有主段（`dsh-subagent` / `dsh-usage` / `wallpaper` / `vision-adam` / `session-status-board`）**必须不告警**（阴性对照）。
- **回滚**：删掉 `insert` 条目（热面）。
- **面**：**热面**。

> **三单元的最小组合建议**：**W-1 单独先上（热面、零风险、立刻有日志）**。W-1 落地并验收后，W-3 才有意义（否则告警没出口）。W-2 属冷面，与下一次批次重启同批。

---

## 3. ③ `cordis.patch.yml` 的补丁与升级路径

### 3.1 "当前 5 个 patch 文件？"—— **前提不成立**（任务书判定 FAIL）

**实跑 compose replay**（`raw/w20-compose-replay.mjs` → `.out.json`，用**真实实现** `loadProfile` / `loadOverlayPatches` / `composeEntries` 复刻 `composeProfile` 的层序，不启服务器）：

| 项 | 实测值 |
|---|---|
| bundle 层 | `@deepseek-ai/dsh-base`（1 条）、`@deepseek-ai/dsh-web-app`（29 条）⇒ **bundlePatchEntryCount = 30** |
| profile 层 | `~/.dsh/profiles/web/cordis.patch.yml` ⇒ **17 条** |
| home 层 | `~/.dsh/cordis.patch.yml` ⇒ **不存在**（`homePatchExists: false`, `homePatchEntryCount: 0`） |
| `--patch` overlays | 本次复刻传 `[]`（`dsh web` 未带） |
| 组合后总条目 | **149 行** |
| `skippedPatchWarnings` | **`[]`**（当前无未命中 id 的条目） |
| `wroteProfileManifest` | **`false`**（复刻未改写 profile manifest） |

**文件全枚举与活性判定**（`find ~/.dsh/profiles -name cordis.patch.yml` 的全部命中）：

| 文件 | 是否被装载 | 依据 |
|---|---|---|
| `profiles/web/cordis.patch.yml`（91 行） | ✅ **活跃（profile 层）** | `dsh-app-boot/lib/index.js:558-564` |
| `@deepseek-ai/dsh-base/cordis.patch.yml` | ✅ **活跃（bundle 层）** | `dsh-base/package.json` 的 `dsh.bundle.patch`；`loadProfile:546-557` |
| `@deepseek-ai/dsh-web-app/cordis.patch.yml` | ✅ **活跃（bundle 层）** | 同上 |
| `@local/dsh-btw/cordis.patch.yml` | ❌ **死文件** | 包**声明了** `dsh.bundle.patch`，但**不在** `profiles/web/package.json` 的 `dsh.profile.bundles`（只有 base + web-app）⇒ `loadProfile` 从不读它 |
| `@local/dsh-pptmaster/cordis.patch.yml` | ❌ **死文件** | 同上 |
| `@local/dsh-ssh-gui/cordis.patch.yml` | ❌ **死文件** | 同上 |
| `@local/dsh-usage/cordis.patch.yml` | ❌ **死文件** | 同上 |
| `@local/dsh-wallpaper/cordis.patch.yml` | ❌ **死文件** | 同上 |
| `dsh-workspace-enhancement/cordis.patch.yml` | ❌ **死文件** | 同上 |
| `profiles/.backup-p0-20260914-112357/dsh-btw/cordis.patch.yml` | ❌ 备份（不在任何解析路径） | — |

> **⇒ 活跃 patch 文件 = 3 个（2 bundle + 1 profile）+ home 层缺失；死 patch 文件 = 7 个。** 任务书所指的"5 个" 恰好是 5 个 `@local/*` 的 patch 文件 —— **它们全部是死文件**。这条**本身就是一条应登记的坑**：这些文件由脚手架惯例生成（`docs/architecture/02-plugin-system.md:35-37` 明写"只有声明 `dsh.bundle.patch` 的包才需要"），**声明了却不在 bundles 列表 ⇒ 永不生效且零告警**（无任何工具会告诉你它没被读）。

### 3.2 装配语义与"大声/静默"分界（file:line）

| 行为 | 后果 | file:line |
|---|---|---|
| `insert` 无 `id` ⇒ 追加到根 | 生效 | `dsh-app-boot/lib/index.js:83` |
| `insert` 带 `id` ⇒ 追加到**该 group** 的 `config` | 生效；目标非 group ⇒ warn+skip | `:70-82`（`:74` "not found"、`:78` "is not a group"） |
| `- id: X` + 覆盖字段 | 逐字段赋值 | `:87-103`；`name` 不匹配 ⇒ warn+skip `:96-99` |
| `id` 未命中 | **静默跳过（唯一出口是 logger.warn ⇒ 被级别过滤丢弃）** | `:92-95` + `:199-201`（+ 结论 12） |
| patch 文件非顶层数组 / 不可解析 / 不可读 | **抛错（大声）** | `loadOptionalPatches` `:793-810`、`Include.read` `:189-192` |
| bundle 缺 `dsh.bundle` | **抛错（大声）** | `loadProfile` `:548-549` |
| 插件 `apply` 失败 | **大声 + 失败退出** | `installFailLoud` `:1043-1075`、`assertEntriesLoaded` `:1076-1087`、`assertEntriesActivated` `:1107-1166`、`FAIL_LOUD_RELEASE_TIMEOUT_MS=2000` `:1013`、`observeLoaderRejectionCheckpoint` `:1001-1008` |

⇒ **"失败即大声失败"只覆盖"文件/包级"错误；"条目级"错误（id 未命中、name 不匹配）是静默的，而且它的告警通道是坏的。**

### 3.3 升级路径：什么能活、什么会静默回滚

| 层 | 升级动作 | 后果 | 依据 |
|---|---|---|---|
| **profile patch 的 `insert` 条目** | 覆盖 `~/.dsh/profiles/node_modules/@local/<pkg>/lib/*.js` | ✅ **条目活着**（patch 文件在包外，没被碰） | 路径事实 + `loadProfile:558-564` |
| **插件 payload 的手改** | 同上（覆盖式部署） | ❌ **静默回滚** | §3.4 的 md5 普查 |
| **插件 `package.json` 的手改** | 同上 | ❌ **静默回滚**（含 `dsh.client` 声明 ⇒ **冷面**，见 H11） | §3.4 |
| **`@local/*/cordis.patch.yml`** | 同上 | ✅ 活着，但**它本来就是死的**（H6） | §3.1 |
| **profile 的 `dsh.profile.bundles`** | 任何 `npm/pnpm install` / `dsh plugin … add` | ⚠️ 不会被"自愈"改写（`web` 非 installation-owned），**但 install 本身是重大事故源**（§3.5） | `dsh-app-boot/lib/index.js:328-333、:473-498` |
| **全局树（`@deepseek-ai/*`）的手改补丁** | `npm i -g` 升级 / 重装 dsh | ❌ **静默回滚**，恢复靠**手工跑** `replay-lag-fix.sh`，而该脚本**已不覆盖最新补丁**（6 类命中为 0） | §3.6 |

### 3.4 ⚠️ 部署漂移普查（本档核心实跑）：**`@local/*` 全体通病，不是 `dsh-usage` 独有**

方法：`raw/w20-md5-census.mjs`（只读）对每个包的 deployed 目录与**每一个候选 workspace 源**做**全 payload 文件**（`lib/**` + `package.json` + `cordis.patch.yml`）md5 比对。结果 `raw/w20-md5-census.json`。

**汇总表（只列 payload 内容不一致，已剔除"源目录多出的 staging 附件"这类假阳性）**

| 包（`package.json` 的 `name`） | deployed 版本 | 候选源 | 源文件数 | payload 内容不一致 | 具体文件（`src` md5 → `dep` md5） |
|---|---|---|---|---|---|
| `@local/dsh-btw` | 0.4.0-btw.1 | `dsh-btw/` | 66 | **1** | `lib/client.js` `bdc5c240…` → `6b3245b9…` |
| `@local/dsh-pptmaster` | 0.1.0 | `.workspace/…/deploy-pptmaster/plugin/dsh-pptmaster/` | 54 | **2** | `lib/client.js` `792097ed…` → `39d26793…`；`package.json` `82e0cd01…` → `74450112…` |
| `@local/dsh-ssh-gui` | 0.2.0 | `.workspace/…/deploy-ssh-gui/dsh-ssh-gui/` | 6 | **1** | `lib/client.js` `b60a406f…` → `fa6d88b5…` |
| `@local/dsh-subagent-model` | 0.1.0 | `.workspace/…/deploy-subagent-model/` | 10 | **0** ✅（**唯一干净包**） | — |
| `@local/dsh-usage` | 0.1.0 | `dsh-usage/` | 14 | **7 + 2 only-deployed** | `lib/charts.js` `da762615…`→`72405176…`；`lib/client.js` `79a006a6…`→`9433ec67…`；**`lib/db.js` `9c34690e…`→`d187d449…`**；`lib/index.js` `1f0aeeb3…`→`eae532a7…`；`lib/ingest-cc.js` `e551eef1…`→`5763aee1…`；`lib/rpc.js` `4e7e0ace…`→`fa2654ab…`；`package.json` `056e32a4…`→`1e351dac…`；**deployed 独有** `lib/ingest-runner.js` `23c88e51…`、`lib/ingest-worker.js` `9dc04f44…` |
| 同上（第二源） | — | `.workspace/workstreams/sources/dsh-usage-src/` | 20 | **5 + 2 only-deployed** | 同上除去 charts/index；**⇒ 该包存在 3 份互相漂移的"源"** |
| `@local/dsh-wallpaper` | 0.5.0 | `dsh-wallpaper-local/` | 6 | **1** | `lib/client.js` `b9cd4747…` → `885bde89…` |
| `@local/dsh-workerspace` | 0.1.0 | `.workspace/…/deploy-workerspace/dsh-workerspace/` | 8 | **1** | `lib/index.js` `c7ccff29…` → `cad264e3…` |
| `dsh-workspace-enhancement` | 0.1.2 | `.workspace/…/dsh-workspace-enhancement-0.1.2-rc2/` | 77 | **2** | `lib/client.js` `202a966d…` → `a6e1f8b1…`；`package.json` `b0a39bb8…` → `04a5490d…` |

**deployed-only 手改的性质（逐例抽样 diff，全部【实跑】）**

| 文件 | deployed 独有的内容 | 面向 |
|---|---|---|
| `@local/dsh-usage/lib/db.js` | `PRAGMA busy_timeout = 5000`、`PRAGMA temp_store = 2`、`spanDays` 区间对齐 DELETE、日历锚定 `hiExclusive`（**U-IG3 修法 A+B**） | **冷面** |
| `@local/dsh-usage/lib/client.js` | `2026-09-12 heatmap redesign v2`（主题感知蓝阶 `--du-heat-0..6`）+ tooltip 定位 CSS + 深色主题覆盖（**81 631 B vs 源 35 294 B**） | **热③** |
| `@local/dsh-usage/package.json` | `dsh.client.inject` 多出 `@deepseek-ai/dsh-client-ui-settings` | **冷面（H11）** |
| `@local/dsh-workerspace/lib/index.js` | 2 处 JSON schema 加 `additionalProperties: false` | **冷面** |
| `@local/dsh-wallpaper/lib/client.js` | 覆盖层 `shadedTokens` 去重（`sameShadedTokens` 19 行） | **热③** |
| `dsh-workspace-enhancement/package.json` | 多出 `cpu-features` / `koffi` / `node-pty`，`ssh2` 提到 `^1.17.0` | **冷面** |
| `@local/dsh-pptmaster/package.json` | `@aiden0z/pptx-renderer` `1.2.4` → `^1.2.4`；devDependencies 被裁剪 | **冷面**（依赖解析） |

**⇒ 双向漂移（两个方向都发生了）**

| 方向 | 实例 | 影响面 |
|---|---|---|
| deployed → 领先源 | `dsh-usage`（7 个 payload 文件）、`dsh-workerspace`、`dsh-wallpaper`、`dsh-workspace-enhancement` | 从源重部署 ⇒ **回滚** |
| **源 → 领先 deployed** | `@local/dsh-btw/lib/client.js`：**源 17:15:06（361 651 B）vs deployed 16:55:55（335 993 B）**，源多出 `dsh-client-runtime` require 与 `drawer.resizeWidth/resizeHeight/resizeCorner/resizeHint` i18n 串 | 已写好的改动**尚未上线**；因属**热③**，部署后**刷新即见**，是当前最低成本的待落地项 |

### 3.5 `~/.dsh/profiles/web` 的 `npm/pnpm install` 硬约束：机制级根因

**事故档**：`.workspace/reports/runbooks/master-runbook.md:44` §1b；同 `docs/runbooks/README.md:26-27`。**逐字根因（实跑读取）**：

> `npm install --prefix ~/.dsh/profiles/web ssh2@^1.16.0`（部署 dsh-workerspace 时）会读取 profile 的 `package.json`，并把**整棵依赖树（198 个 `@deepseek-ai` 包）安装成未打补丁的本地副本**到 `profiles/web/node_modules/@deepseek-ai/` —— 运行进程**优先加载这些副本**，②b 非流式 / mux+FrameQueue 加固 / P0 materialize / 图片变换补丁**全部被绕回**。

**机制级解释（本档补充）**：这是 **Node 模块解析的遮蔽（shadowing）**，不是"补丁文件被删"。解析顺序从 `profiles/web` 起走 `node_modules` 链（`dsh-app-boot/lib/index.js:493-517` `packageDirFromAnchor` 明确实现了"**Node 自己的 node_modules 查找顺序**"）⇒ 一旦 `profiles/web/node_modules/@deepseek-ai/` 存在，它**先于**符号链接农场指向的全局打补丁树命中 ⇒ 所有落在**全局树**的手改补丁被绕过，**而文件本身毫发无损**（所以现场表现为"行为退回"而非"文件丢了"，极难归因）。

**当前状态【实跑】**：`~/.dsh/profiles/web/node_modules` **不存在**（已按事故档恢复为空态）⇒ 该遮蔽当前**未发生**，但**任何一次在 `profiles/web` 里跑 npm/pnpm install 都会立刻复发**。

### 3.6 🔴 全局树升级后的补丁存活（新发现的 FAIL）

**既有恢复器**：`.workspace/workstreams/deploy/deploy-lag/replay-lag-fix.sh`（463 行，mtime **2026-09-20 16:07**）。逐字读取其头部注释 `:7-14`：

> 目标：live 全局树 **4 包**（`dsh-agent-loop` / `dsh-client-ui-subagent` / `dsh-web-search-deepseek` / `dsh-host-apiproxy`）+ 官方 `dsh-subagent`（P0 materialize 补丁）+ `~/.dsh/settings.yaml`

**覆盖缺口【实跑】**：在该脚本里 grep 下列包名，命中数**全部为 0**：

| 未被任何脚本保护的手改补丁 | 证据 |
|---|---|
| `dsh-client-runtime/lib/client.js`（`dsh-perf-fix P1/P2`） | **全局树里带 `dsh-perf-fix` provenance 标记的文件只有 2 个**，它就是其一（另一个见下行备注）；`replay-lag-fix.sh` 命中 **0** |
| `dsh-client-ui-renderer/lib/client.js`（exec-hmr A-1，已 sha256 核对落地） | `replay-lag-fix.sh` 命中 0 |
| `dsh-client-hmr/lib/client.js`（exec-hmr A-2，已 sha256 核对落地） | 同上 |
| `dsh-client-modules/lib/client.js` | 同上 |
| `dsh-client-ui-settings-general/lib/client.js`（另一个 `dsh-perf-fix` 标记文件） | `replay-lag-fix.sh` 命中 **0** |
| `@local/dsh-usage` 全部手改（§3.4） | 同上（脚本完全不涉及 `@local`） |

⇒ **全局树升级（`npm i -g` / 重装 dsh）后，恢复器只能恢复 5 个包的旧补丁；上表 6 类（命中数全为 0）补丁会静默丢失，且没有任何校验会告诉你。** 这与 §3.4 的 `@local/*` 回滚是**两个独立的静默回滚通道**。

### 3.7 U-IG3 专项复核（逐条 PASS/FAIL/INCONCLUSIVE）

| 条目 | 要求 | 实测 | 判定 |
|---|---|---|---|
| U-I1 | deployed `db.js` 含修法 A（区间对齐） | `spanDays` 声明/枚举 + `DELETE … WHERE day IN (${placeholders})).run(...spanDays)` + 日历锚定 `hiExclusive` | **PASS** |
| U-I2 | deployed `db.js` 含修法 B（UPSERT 保险） | `ON CONFLICT(day, data_source, model, project) DO UPDATE SET …` | **PASS** |
| U-I3 | deployed 含 `busy_timeout` / `temp_store` 加固 | `PRAGMA busy_timeout = 5000`、`PRAGMA temp_store = 2` | **PASS** |
| U-I4 | md5 与 w05 记录一致 | workspace `9c34690e…` / deployed `d187d449…`，**与 w05 §4.1 逐字一致** | **PASS** |
| U-I5 | workspace 源缺全部修复 | `dsh-usage/lib/db.js` 与 `.workspace/workstreams/sources/dsh-usage-src/lib/db.js`（`e872c646…`）**均无任何一项**（diff 81 行） | **PASS** |
| U-I6 | 运行中宿主加载的是修复字节 | 本次重启 18:11:49 **晚于** `db.js` mtime 09-21 17:12:07 ⇒ 在生效代际内 | **PASS** |
| U-I7 | **w05 的"泛化"结论**（是否只 usage 独有） | **不只是**：§3.4 普查证明 8 个包中 7 个有 deployed-only payload 改动 | **PASS**（新结论） |
| U-I8 | "从 workspace 重新部署会静默回滚哪些东西" | 给不出唯一源 ⇒ 见 §3.4 的可判定清单 | **PASS**（清单已给） |
| U-I9 | 回滚是否**已被实测** | **未实测**（本档只读，未跑任何 install/deploy） | **INCONCLUSIVE**（读码 + md5 推断） |

---

## 4. ④ 插件日志出口缺失 —— 核对与最小修法

### 4.1 w13 F1 独立复核（PASS）

| 检查 | 结果 | 依据 |
|---|---|---|
| 唯一 exporter 是内存环形缓冲 | ✅ 全树 `\.exporter\(\|exporter\(\{` 命中 **3 处**：host `cordis/lib/index.js:598`（内置）、`:617`（方法定义）、Web 前端 bundle `dist/assets/index-ClqxG24t.js` 的内联副本（同源） | 【实跑 grep】 |
| 环形缓冲定义 | `bufferSize = 1e3`（`:583`）、`buffer = []`（`:584`）、`self.buffer.push(message)`（`:601`）、`self.buffer.slice(-bufferSize)`（`:602`） | 【实跑】 |
| **该 buffer 有无读取点** | ❌ **零读取点**：除 `:584/:601/:602` 外全树无任何 `logger.buffer` / 对该字段的读取（唯一的 `.buffer.slice` 命中全是 `ArrayBuffer.isView(source)` 的无关代码） | 【实跑 grep 全树】 |
| 有无 console exporter / file exporter | ❌ 无 | 【实跑】 |
| 有无 journald | ❌ `journalctl _PID=301709` ⇒ **No entries**；cgroup 为 `vte-spawn-…scope`（Terminator 子作用域） | 【实跑】 |
| 有无日志文件 | ❌ `~/.dsh/logs` **不存在**；`~/.dsh/` 下无任何日志文件候选 | 【实跑】 |
| 宿主 stderr 去哪 | **Terminator 的 pty**：`2988915 ← bash(10771) ← terminator(10761) ← gnome-shell(4139) ← systemd --user` | 【实跑】 |
| 有无日志端点 | ❌ 无（全树无消费 `buffer` 的 RPC/HTTP） | 【实跑】 |

### 4.2 ⚠️ 对 F1 的加强：**`warn` 连环形缓冲也进不去**（本档新增，离线实跑）

**机制**：`cordis/lib/index.js:474`

```js
if ((exporter.levels?.[this.name] ?? exporter.levels?.default ?? this.level ?? 1) < level) continue;
```

- 内置 exporter 注册为 `self.exporter({ colors: 3, export: … })`（`:598-603`）——**没有 `levels` 字段**。
- `this.level` 来自 `Logger` 的 `options.level`，而 `options = { name, level: l.level, … }`，`l = this._resolveConfig()`（`:619-627`）沿 `ctx[symbols.intercept]` 链收集自己的 `logger` 配置。
- **本部署三层活跃 patch + home 层全部不含 `logger:` 条目**（逐文件 grep 命中 0）⇒ `l.level === undefined` ⇒ 阈值 = `?? 1` = **1**。
- 级别定义在 `:457-460`：`error=0 / info=1 / warn=2 / debug=3` ⇒ `1 < 2` ⇒ **`warn` 与 `debug` 在进入 exporter 循环体的前一行就被 `continue` 丢弃**。

**离线实跑证据**（`raw/w20-cordis-logger-threshold.mjs` → `raw/w20-logger-threshold.json`，用真实 `cordis` 包，零宿主负载）：

| 用例 | 探针 exporter 观察到 | 内置环形缓冲内容 | 缓冲长度 |
|---|---|---|---|
| **无 logger 配置（= 本部署现状）** | `["error","info"]` | `["error","info"]` | **2** |
| `ctx.logger.level = 3`（无效对照：`_resolveConfig` 不读 callable 自身属性） | `["error","info"]` | `["error","info"]` | 2 |
| **`exporter.levels.default = 3`（阳性对照）** | `["error","info","warn","debug"]` | — | — |

> **⇒ 必须修正 w13 F1 的措辞**：不是"`log.warn` 沉入 ring buffer / 终端回滚缓冲"，而是**`warn` 与 `debug` 被级别过滤完全丢弃，不去任何地方**。这把 F1 的严重度**上调一档**：`loader.warn`（`dsh-app-boot/lib/index.js:200、272、273` 三条）、`dsh-usage` 的 4 处 `log.warn`（`:184/:188/:310/:335`）、`agent-presets` 的 1 处（`dsh-agent-presets/lib/index.js:866`，该文件在 `invariant.js:825` 有同构副本）——**全部是彻底的静默黑洞**。

### 4.3 最小修法（= §2.3 的 W-1）

**修法本体与验收/回滚见 §2.3 W-1**（同一件东西：一个注册文件 exporter 的薄插件，经**热①** 挂载，零重启）。

**本档补充的两个必须写进实现的坑**：

| 坑 | 说明 | file:line |
|---|---|---|
| **P-1 卸载不自动回收** | `exporter()` 内部的 `this.ctx.effect(...)` 用的是 **LoggerService 自己的 `this.ctx`**，而 `this.logger = new LoggerService(self)` 里的 `self` 是**根 ctx** ⇒ 该 effect 挂在**根 fiber** 上，**卸载插件不会移除 exporter** ⇒ 插件必须自己再登记一个 `ctx.effect` 并在 dispose 里调用 `exporter()` 返回的 disposer（§2.3 W-1 代码已含）。 | `cordis/lib/index.js:595-596`（`Object.assign(self, this)` 把 `ctx` 带上）、`:613-617`（`exporter()` 用 `this.ctx.effect`）、`:1687`（`new LoggerService(self)`，`self` 是根 ctx） |
| **P-2 阈值必须显式声明** | 不写 `levels` 就等于继承"被丢弃"的现状（§4.2）⇒ **落地后必须用"缺省 vs 显式"对照验收**（W-1 验收第 3 条）。 | `cordis/lib/index.js:474`、`:598-603` |
| **P-3 不要用 `appendFileSync`** | 宿主主线程已被 w06 实测钉在 84–95 %（旧宿主现场），同步写盘是新增阻塞点 ⇒ 用 `createWriteStream` + 简单上限轮转。 | w06 §2.1；本档 §2.3 W-1 代码 |

---

## 5. ⑤ 前三优化候选（收益 / 风险 / 验收 / 回滚 / 热冷面）

> 排序依据：**（a）是否解锁其它项的观测能力** >（b）热面性（零重启 = 零风险窗口）>（c）修复面宽度 >（d）成本。
> 本档范围内的三条；与 w13 的 `I-1`（宿主日志落地）是**同一靶点的两块**，本档给出其**热面落地形态**。

### 候选 C1（第一优先）：**宿主日志文件出口（含 warn 级别解禁）** —— 热面，零重启

- **靶点**：新增本地薄插件 `@local/dsh-logfile`（`lib/index.js` 只有一个 `ctx.logger.exporter`），经 `~/.dsh/profiles/web/cordis.patch.yml` 的 `insert` 挂载（**热①**）。
- **收益**：
  - 宿主**首次**拥有持久、带时间戳、可 grep 的插件日志出口（现状：唯一出口是零读取点的 1000 条内存缓冲，见 §4.1）。
  - **同时解禁 `warn`**（阈值 1 → 显式 2）⇒ 一口气把 §4.2 列出的 **8 处既有 `log.warn`** 从"彻底丢弃"变成"被记录"。
  - **解锁②③的观测能力**：②的静默失效、③的 `applyEntryPatches` 未命中 id 告警，**都只有在本项落地后才可能被看见**（§0 结论 14）。
  - 与 w13 `I-1` 同靶点 ⇒ **两条线合并成一次动作**，不重复投入。
- **风险**：① 写盘量（缓解：阈值 2、不含 debug、上限轮转）；② 若 `ctx.effect` 的 dispose 写法不对，热卸载后 exporter 残留（缓解：P-1 已在代码里显式处理，且验收第 1 条会暴露）；③ 插件目录属 `@local/*` ⇒ **会被 §3.4 的静默回滚通道影响**（缓解：本插件只有 1 个文件，纳入 C3 的校验清单）。
- **验收（可判定，全部不需浏览器）**：
  1. 落地后**不重启**，临时把一条 `insert` 指向不存在的 id（制造 `dsh-app-boot/lib/index.js:74` 的 warn），`grep` 日志文件**必须命中**（同时验收 H18 可观测性）；
  2. **重启宿主**后文件**仍有**历史行且继续追加（"重启后仍在"）；
  3. **反例对照**：去掉 `levels` 字段后同一触发**必须不落盘**（证明阈值改对了）；
  4. 阴性对照：正常启动 5 分钟，日志文件里**不出现** `debug` 行、不出现每秒级刷屏。
- **回滚**：**热面** —— 删掉那一行 `insert` 条目（秒级）；若发现 exporter 未回收，改走"重启回滚"。
- **面**：**热面（零重启）**。

### 候选 C2（第二优先）：**未注册命名空间告警（W-3 热 + W-2 冷）**

- **靶点**：① **W-3 热面**：薄插件（可与 C1 同包）在 `apply()` 与每次 settings 变更时，用 `settings.describe()`（`dsh-settings/lib/index.js:352-382`）拿已注册 ns 集合，与 `settings.documentPath`（`:291`）指向的 YAML 顶层键做差集，非空即 warn；② **W-2 冷面**：`dsh-settings.get()`（`:388-390`）加**每 ns 一次性** warn。
- **收益**：把"**装了插件但没注册命名空间 / 没装插件但 settings 有段**"这**整类静默失效**变成可发现。覆盖面：`dsh-subagent`（w06 已实证的真缺口）、`dsh-usage`、`session-status-board`、`wallpaper`、`vision-adam` 同构组合。W-3 是**唯一**能发现"孤儿段"（没人调用 `get()`，所以 W-2 不会触发）的形态。
- **风险**：① **依赖 C1**（没有出口的 warn = 零收益，§0 结论 14）⇒ **C1 必须先落地**；② `get()` 在热路径 ⇒ 一次性去重是**硬要求**；③ 误报面 = 用户保留的历史段 ⇒ 建议 W-3 用 info 级 + 白名单，W-2 保持 warn；④ W-2 若想做得更精确会引出新 API（`get(ns,{optional:true})`）⇒ **属兼容面，建议次批**。
- **验收**：见 §2.3 的 W-2/W-3 各自验收（含"连续 10 次派发只 1 行"与 5 个有主段阴性对照）；**并加一条端到端**：把 `@local/dsh-subagent-model` 的 `insert` 注释掉（**热①，不需重启即可制造**），要求日志出现"`dsh-subagent` 未注册"且**派发的子代理真的回落 preset 路由**（用 w06 §5.1 的模型切点法复核）。
- **回滚**：W-3 = 删 `insert`（热）；W-2 = 还原 `get()` 一行（冷，与下次批次重启同批）。
- **面**：**热 + 冷（混合）**。

### 候选 C3（第三优先）：**部署漂移校验器 + 声明单一真源**

- **靶点**：把 §3.4 / §3.6 的两条静默回滚通道变成**可判定失败**。形态：一份**清单文件**（每包每 payload 文件的期望 md5/sha256）+ 一个**只读校验脚本**（`--check` 默认；不一致即打印逐文件 diff 摘要并非零退出）；清单来源 = **当前 deployed 的字节**（因为 §3.4 已证明"deployed 是唯一真源"，w05 §4.4 的建议 ②）。
- **收益**：① 任何"从 workspace / 从 deploy staging 重新部署"**立刻**被拦住；② 全局树升级后**立刻**暴露 `dsh-client-runtime` / `dsh-client-ui-renderer` / `dsh-client-hmr` / `dsh-client-modules` / `@local/dsh-usage` 的丢失（§3.6 的 FAIL 正是因为没有这道闸门）；③ 顺带解决 §3.4 的"多份源互相漂移"（3 份 `dsh-usage` 源）—— 校验器一旦存在，**漂移就变成显式台账**而不是隐性风险。
- **风险**：① **登记成本**：`@local/*` 的 payload 文件量级是**个位数到几十个**（普查已给逐文件清单，见 `raw/w20-md5-census.json`），可脚本化生成；全局树侧成本高（198 包）⇒ **建议只对"已知有手改"的包+文件登记**（当前可枚举的起点：带 `dsh-perf-fix` 标记的 2 个文件 + exec-hmr 的 2 个文件 + replay 脚本覆盖的 5 个包 + §3.4 的 `@local/*`）；② **合法修改会被判为漂移** ⇒ 校验器必须提供"更新台账"的显式通道（`--accept`，且打印 diff 要求确认）；③ **不解决"改完谁生效"**（H7 冷面）—— 它只管"文件字节对不对"，不管"是否重启"。
- **验收**：① **阳性**：把 `@local/dsh-workerspace/lib/index.js` 的 `additionalProperties: false` 删掉（**不改文件，只做 dry-run 对比**）⇒ 校验器**必须**报该文件不一致并给出两行 diff；② **阴性对照**：对当前全部 deployed 运行 `--check` ⇒ **必须零不一致**（这是建立台账的基线，可判定）；③ **升级演练（可选，冷面）**：在**隔离宿主**里对全局树做一次"模拟升级"（换掉 `dsh-client-hmr/lib/client.js`）⇒ 校验器必须点名该文件。
- **回滚**：删脚本与台账（无运行时影响，**不挂进任何热路径**）。
- **面**：**离线冷面（脚本本身）**；但它守护的补丁**分布在冷面与热③两面**。

---

## 6. 诚实清单（未测 / 不可判定 / 明确边界）

1. **两个授权二级子代理全部失败**：本档被基础设施级集体中断（含 18:11:49 冷面重启）打断两次；分支 B 只留下一个已完成且被本档复核的产物（`raw/w20-compose-replay.*`），**分支 A 零产物**。授权额度已用尽 ⇒ **§1 判据表由本档自行完成**，未获得第二双眼睛的独立复核。这是本报告最大的方法学边界。
2. **热①的"~1 s"生效延迟未在本轮复测**：机制已由 file:line 钉死（§0 结论 2），但**延迟数字沿用既有实测**（架构文档 §5 引 deploy-lag README §9.1）。本档**未做任何热载实验**（未取锁、未起隔离宿主、未写任何 profile 文件）⇒ 该延迟标 **INCONCLUSIVE**。可用的现成载体是 `exec-hmr/tmp/iso-main.sh`（独立 `DSH_HOME` + 独立端口 + shadow 副本）—— 但它属别的单元，本档未触碰。
3. **未在活体宿主上验证"warn 被丢弃"**：宿主内存中的环形缓冲**无法从外部读取**（无读取点、无端点、`/proc/<pid>/fd` 对本用户 EACCES）。§4.2 的结论由**离线实跑（真实 cordis 包）+ 三层 patch 无 `logger:` 条目的实跑 grep** 共同支撑，**不是**从活体缓冲里数出来的。⇒ 若协调者需要一个活体判据，唯一路径是先在隔离宿主上装 W-1 exporter 再触发一次 warn。
4. **`ctx.effect` 的返回值类型未逐行确认**：`:1168-1250` 的 `effect()` 只读到实现中段，**未读到 return 语句**。§2.3 W-1 的 P-1 写法（"用返回的 disposer"）依据的是 `cordis` 自己的 JSDoc（`exporter()` "@returns a disposer that removes the exporter"）。⇒ **P-1 的 dispose 形状需在实现时实测确认**。
5. **`data-plugin` 跨插件样式误删（§0 结论 17）的可达性未证实**：机制（`:135` 唯一打标点 × `removeOwnedStyles` 逐字比较）已确证，但**没有构造出可达路径**——现有插件都在 factory 内用 `data-plugin-css` 幂等标记同步注入，`claimStyles` 紧随 factory。判 **INCONCLUSIVE**，并给出可判定试验：让两个插件的物化**交错**（一个 `immediately: true`）后热刷新被误认领的一方，看另一方的 `<style>` 是否消失。
6. **`applyEntryPatches` 的 warn 是否真的"零观测"未在活体上验**：本档只能证明"该 warn 走 `logger.warn` + `logger.warn` 在当前组合下被级别过滤" ⇒ **推断**为不可观测。§2.3 W-1 验收第 1 条正是把这条变成**可判定**的动作（本档未执行）。
7. **`@local/*` 的"workspace 源"本身是不可靠的**：普查里唯一的例外（`dsh-subagent-model` 的 `lib/` 逐字节相同）说明**差异不是"部署一定手改过"的证明**，而是"**源与 deployed 至少有一份不是另一个的产物**"。本档**没有**判定每一处 diff 的**方向**（谁更正确）—— 除 `dsh-usage/lib/db.js`（U-IG3，deployed 明确更正确）与 `dsh-btw/lib/client.js`（按 mtime 与内容判断源更新）两例之外，**其余 8 处 payload diff 的方向未判定**。
8. **未评估 `@local/*` 的"反写回 workspace"动作**：w05 §4.4 给过三条建议（反写 / 声明 deployed 为唯一真源 / 至少在 LANDING-LOG 标注），本档只**确认了它的普遍性**并给出 C3，**未执行任何写入**。
9. **全局树手改补丁的完整清单仍未建立**：本档只能列出"带 `dsh-perf-fix` provenance 标记的 **2 个**文件（`dsh-client-runtime/lib/client.js`、`dsh-client-ui-settings-general/lib/client.js`）"+ "exec-hmr 的 2 个文件（sha256 核对落地）"+ "replay 脚本覆盖的 5 个包"。**标记约定不统一**（多数手改不带任何 provenance 注释）⇒ **无法断言"这就是全部"**。这恰恰是 C3 要解决的问题。
10. **未复核 w06 §4 的 settings 热载四重证据本身**：本档只**独立复核了它的两条代码级前提**（`dsh-settings:388-390` 与 `dsh-tool-subagent:119-136`，§2.1），**未重跑** 1105 条子会话的模型字段统计（那需要扫会话库，属别的线的成本）。
11. **`logger:` 条目"不存在于任何 patch 层"的 grep 覆盖范围**：本档 grep 了 3 个活跃 patch（`dsh-base` / `dsh-web-app` / profile）+ home 层（不存在）。**未**穷举 `--patch` overlays（`dsh web` 未带）与运行时通过 `ctx.loader.create()` 动态插入的条目（`profile-boot-DG5t9aNs.js:258-262` 就动态插入了 `timer` 与 `hmr`）。⇒ "阈值 = 1"在**当前**组合下成立，但**若将来有人加一条 `logger:` 配置，结论 12 会立即失效** —— 这正是 C1 要求**显式声明 `levels`** 的原因（P-2）。

---

## 7. 复现

### 7.0 探针锁状态（只读查询）

```bash
node -e "import('/home/CNS2026495165/dsh/.workspace/lag-fix/lib/probe-lock.mjs').then(m=>console.log(JSON.stringify(m.inspect())))"
# 本档进入时输出：{"held":true,"owner":{"raw":"agent=w14-residual-env pid=860747 …"},"liveness":"ALIVE"}
# ⇒ BUSY ⇒ 本档未取锁（本报告不需要高负载探测）
```

### 7.1 离线实跑：cordis 日志级别阈值（§4.2）

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/program/w20-cordis
node raw/w20-cordis-logger-threshold.mjs raw/w20-logger-threshold.json
# 期望：case1（无 logger 配置）ringBuffer_types == ["error","info"]（长度 2）
#       case3（exporter levels.default=3）probeExporter_saw == ["error","info","warn","debug"]
```

### 7.2 实跑：组合层 replay（§3.1）

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/program/w20-cordis
node raw/w20-compose-replay.mjs        # 只读：不启服务器、不写 profile
# 期望：bundleLayers = [dsh-base(1), dsh-web-app(29)]；profilePatchEntryCount = 17；
#       homePatchExists = false；composedRowCount = 149；skippedPatchWarnings = []；
#       wroteProfileManifest = false
```
> ⚠️ 该脚本会用**真实实现**调用 `loadProfile(...)`；若 profile 目录缺失它会走 `initProfile`。本档跑时 `profiles/web/package.json` 已存在，实测 `wroteProfileManifest=false`（无写入）。**在只读纪律下再次运行前请确认 `profiles/web/package.json` 存在。**

### 7.3 实跑：workspace ↔ deployed 逐文件 md5 普查（§3.4）

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/program/w20-cordis
node raw/w20-md5-census.mjs > raw/w20-md5-census.json
# 期望：8 个包；除 @local/dsh-subagent-model（payload 差异 0）外，每包 ≥1 处 payload 内容不一致
```

### 7.4 实跑：部署漂移 / 冷面锚点 / 日志出口 / 恢复器覆盖（§4.1、§1.4、§3.6）

```bash
# 冷面锚点：宿主侧 lib 是否有晚于本次启动的（= 冷面待生效）
python3 - <<'EOF'
import os, glob, time
p='/proc/2988915'                     # 换成当前宿主 pid
boot=os.stat(p).st_ctime
pats=['/home/CNS2026495165/.dsh/profiles/node_modules/@local/*/lib/**/*.js',
      '/home/CNS2026495165/.dsh/profiles/node_modules/dsh-workspace-enhancement/lib/**/*.js']
tot=after=0
for pat in pats:
    for f in glob.glob(pat, recursive=True):
        tot+=1
        if os.path.getmtime(f)>boot:
            after+=1; print('COLD-PENDING', time.ctime(os.path.getmtime(f)), f)
print('total',tot,'newer-than-boot',after)
EOF

# 日志出口：三查（全树 exporter / 文件 / journald / buffer 读点）
grep -rn "\.exporter(" ~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/ --include=*.js
ls -la ~/.dsh/logs ; journalctl _PID=2988915 --no-pager | head ; ps -o pid,ppid,cmd -p 2988915

# 恢复器覆盖缺口
R=/home/CNS2026495165/dsh/.workspace/workstreams/deploy/deploy-lag/replay-lag-fix.sh
for p in dsh-client-runtime dsh-client-ui-renderer dsh-client-hmr dsh-client-modules dsh-usage; do
  printf '%-26s %s\n' "$p" "$(grep -c "$p" $R)"; done     # 期望全为 0
```

### 7.5 实跑：exec-hmr 修复落地确认（§0 结论 16）

```bash
sha256sum ~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-renderer/lib/client.js
#   7468f0c67407622f83a483d8d7f1788069ead374218aff2d6ef0b76cd4143172
sha256sum ~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-hmr/lib/client.js
#   8ea91bb3b48ccb3f2b416739ab9fb305966f442042f5152c4f97b0f9412b1efc
```

---

## 8. 产物清单（本目录）

| 文件 | 内容 |
|---|---|
| `audit.md` | 本报告（主交付） |
| `raw/w20-cordis-logger-threshold.mjs` + `raw/w20-logger-threshold.json` | **离线实跑**：cordis 环形缓冲级别阈值（证明 `warn` 被丢弃；含阳性对照） |
| `raw/w20-compose-replay.mjs` + `raw/w20-compose-replay.out.json` | **实跑**：用真实 `loadProfile`/`composeEntries` 复刻组合层（活跃 patch 判定、149 行组合、0 未命中告警、未改写 manifest）。*原始由分支 B 产出（该分支随后失败），本档复核其完整性与数字。* |
| `raw/w20-md5-census.mjs` + `raw/w20-md5-census.json` | **实跑**：8 个 `@local`/本地包的 deployed ↔ 全部候选 workspace 源**逐 payload 文件 md5** 普查（§3.4 主证据） |
| `raw/w20-md5-census.err` | 空（脚本无 stderr 输出，作为"无异常退出"的证据） |
| `branch-A/`、`branch-B/` | 两个失败分支的目录（branch-B 含其产物的原始副本；branch-A 为空） |

**未写入**：任何产品文件、`~/.dsh` 下任何文件、任何 profile、任何隔离宿主目录。宿主未重启、未 `pkill`。
