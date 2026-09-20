# 调研 B — DSH 现有热载机制盘点 + 我们部署的真实重启清单

> 审计子代理（路由 adam/deepseek-v4-flash）产物 · 只读调研 · 证据格式 `文件:行号`
> 目标：回答「每次改动哪些要重启、哪些已热载」→ 为「值得热载的改动类别」排序。
> 部署基线：`@deepseek-ai/dsh` 0.1.1-rc.2，profile `web`（bundles = dsh-base + dsh-web-app），
> 运行进程 `node /home/CNS2026495165/.npm-global/bin/dsh web`（PID 2437836，127.0.0.1:3080）。
> 全局树：`~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/<pkg>`（= `$P`）。
> profile 共享层 `~/.dsh/profiles/node_modules/@deepseek-ai/*` 均为指向 $P 的符号链接（官方包），
> 自装插件为真实目录（`@local/*` 与部分 `@deepseek-ai/*`）。

---

## 1. 热载机制全盘点（触发面 × 生效粒度）

### 1.1 settings.yaml 配置热载 — 配置值级 ✅ 已热载

- 宿主：`dsh-settings-file`（base bundle 行 `settings`，`dsh-base/cordis.patch.yml:78-79`，注释明言 "hot-reloaded"）。
- watch：chokidar 精确文件 watch（`dsh-settings-file/lib/index.js:179-199`），
  `ignoreInitial: true` + `awaitWriteFinish`（`stabilityThreshold = debounceMs`，默认 100ms，`index.js:74-75`）；
  `watcher.on("all") → queueRefresh()`（`index.js:187-190`）。
- 生效链：`refresh() → reconcileFromDisk() → publish(doc)`（`index.js:228-261`）；
  `Settings.commit()` 仅在 deep-equal 变化时 swap + 通知 watchers + 发 `settings/updated` 事件
  （`dsh-settings/lib/index.js:544-581`）；插件侧 `installSettingsSection → scope.watch(onChange)`
  （`dsh-settings/lib/index.js:618-636`）。
- 粒度：**配置值级**（整文件重读，但 commit 按命名空间 deep-equal 去抖；新命名空间段、段内值变化都热生效）。
- 部署内受益面（`~/.dsh/settings.yaml`）：llm-pi-ai 的 providers 段 → llm-pi-ai 通过
  `installSettingsSection` + `onChange` 热注册/注销 provider 路由（`dsh-llm-pi-ai/lib/index.js:2472-2477`）；
  agent-default-model / vision-adam / wallpaper / web-search-deepseek / dsh-ssh-gui 段同理。
- 证据：`~/.dsh/settings.yaml` 当前被 163 行配置引用，改动无需重启。

### 1.2 skills 文件热发现 — 文件级 ✅ 已热载

- 宿主：`dsh-skill-filesystem`（`dsh-skill-filesystem/lib/index.js`）。
- watch：chokidar watch skill roots（`depth: 1`，`awaitWriteFinish` stability 200ms / poll 100ms，`index.js:372-384`）；
  事件 add/addDir/change/unlink/unlinkDir → `handleWatchEvent → queueInvalidation → control.invalidate()`
  （`index.js:412-420, 431-442, 462-471`）；另监听 `fs/observed` 一写方 mutation（`index.js:57-60`）。
- 生效链：`control.invalidate()` → skills 注册表 `invalidateCache` + 发 `skills/change` 事件
  （`dsh-skill/lib/index.js:404`）。
- 粒度：**文件级**（新技能文件/目录、修改、删除均触发重发现）。
- 部署内受益面：`~/.dsh/skills/` 与各项目 `.dsh/skills` 下技能改动即热生效。

### 1.3 客户端 bundle 按 rev 内容哈希动态服务 — 文件级 ✅ 刷新即生效（并有 SSE 热换）

- 宿主：`dsh-client-modules`（web-app bundle 行 `modules`，`dsh-web-app/cordis.patch.yml:159-160`）。
- boot 图：graphRow 的 `url = /plugins/<id>/client.js?rev=<sha1-12>`（`dsh-client-modules/lib/index.js:147-156`）；
  每次页面请求经 `webserver/index-inject` 注入当前 graph（`index.js:300-302, 209-250`），
  `serveBundle` 每次 GET 从磁盘读文件、`cache-control: no-cache`（`index.js:459-490`）。
- 粒度：**bundle 文件级**；改任一 client.js → 下次页面刷新拿到新 rev 新内容。无需重启宿主。

### 1.4 客户端 HMR（SSE 热换，无刷新）— bundle 文件级 ✅ 部署内可生效

- 宿主：`dsh-client-hmr`（web-app bundle 行 `client-hmr`，`dsh-web-app/cordis.patch.yml:150-151`；注释说明
  "always mounted… idle until a rebuild watcher actually rewrites client bundles"）。
- 宿主侧：每 500ms statSync 每个 graph 行的 client bundle（`dsh-client-hmr/lib/index.js:78-91`），
  mtime/size 变化 → `ctx.clientModules.rebuilt(id)`（`index.js:41-54`）→ 重哈希出新 rev →
  SSE `/plugins/events` 推 `rebuilt` 帧（`index.js:145-152`）。
- 浏览器侧：EventSource 收 `rebuilt` 帧 → `modLoader.invalidate(id)` + prefetch 新 rev + `entry.refresh()` 热换
  （`dsh-client-hmr/lib/client.js:38-56, 58-68, 70-85`）。
- 粒度：**单插件 client bundle 级**；改了文件即热换，不刷新页面、不重启宿主。
- 注意：官方注释的预期链路是 dev watcher（`pnpm run dev:web`）重写 bundle；但我们部署直接改写
  node_modules 里包自带的 `lib/client.js` 时，同一 stat 轮询同样命中（证据：lag-fix 补丁
  `dsh-client-ui-subagent/lib/client.js` 的 "tok/s" 锚点已写入 live 树，grep 命中 2 处）。

### 1.5 cordis loader 的「long-lived surfaces 热载」— 条目级（配置/插入热应用，模块代码不热）

- 机制：`cordis-plugin-hmr`（chokidar watch + ESM loadCache/require.cache 清除 + 依赖图分类 + 插件 fiber 换装，
  `cordis-plugin-hmr/lib/index.js:196-435`）。
- 但 **web 表面明确禁用**：`dsh-web-app/cordis.patch.yml:21-23`：
  ```
  # TODO: Re-enable shared HMR for Web after its reload lifecycle is tested.
  - id: hmr
    disabled: true
  ```
  base 层的 `hmr` 行（`root: ['.']`，`dsh-base/cordis.patch.yml:19-22`）在 web 层被 disable，
  模块级代码热载在 web 不生效。
- 仍生效的窄面：**cordis.patch.yml（用户 patch 层）经 `watchUserPatches` 热重载**：
  `dsh-app-boot/lib/index.js:761-781` 用 `hmr.registerConfig(filename, refresh)` 注册精确路径 watch，
  变化时重读 patch 列表并 `entry.update({config:{patches}})` 事务性重应用；
  profile-boot 在 hmr 缺失时自动挂 `cordis-plugin-hmr`（`profile-boot-DG5t9aNs.js:256-273`）。
- 粒度：**条目级**（insert/disable/config 覆盖热应用，`cordis-plugin-loader/lib/index.js:405-492`：
  config-only diff 走 `_patchContext → fiber.update` 热更；name/inject/group 变化走 dispose + 重 import）。
- 结论：**改 cordis.patch.yml（新插件注册、禁用、配置覆盖）在 web 表面已热载**；改插件**代码文件**不热载。

### 1.6 其他热载

- `dsh-credentials-local`：chokidar watch 凭据文件，debounce 100ms（`dsh-credentials-local/lib/index.js:3,397,451-452`）→ 值级热载。

### 1.7 热载机制总表

| 机制 | 宿主包 | watch 手段 | 触发面 | 生效粒度 | 部署内状态 |
|---|---|---|---|---|---|
| settings.yaml | dsh-settings-file | chokidar 精确文件 | 文件写 | 配置值级（按命名空间 commit） | ✅ 热载 |
| skills | dsh-skill-filesystem | chokidar roots (depth 1) | 文件增/改/删 | 文件级发现 | ✅ 热载 |
| 客户端 bundle | dsh-client-modules | 每请求读盘 + rev 哈希 | 刷新即新内容 | bundle 文件级 | ✅ 无重启 |
| 客户端 HMR | dsh-client-hmr | 500ms stat 轮询 + SSE | 文件 mtime/size | 单插件 bundle 级热换 | ✅ 可生效 |
| 插件注册/配置覆盖 | cordis-plugin-hmr + watchUserPatches | chokidar patch 精确路径 | cordis.patch.yml 写 | 条目级热应用 | ✅ 已热载 |
| 插件模块代码 | cordis-plugin-hmr | chokidar 模块 root | 代码文件写 | 模块级换装 | ❌ web 禁用（hmr row disabled） |
| 凭据 | dsh-credentials-local | chokidar | 文件写 | 值级 | ✅ 热载 |

---

## 2. 我们部署的「重启清单」（每次改动需要重启的准确集合）

### 2.1 官方补丁包宿主侧 lib（全局树 = 符号链接指向 $P，改 $P 下包目录）— 必须重启

- 涉及集合（deploy-015 28 包 + deploy-lag 5 补丁位，全部已落到 live 树，锚点验证见 §1.4/§2.1 下）：
  - deploy-015：dsh-agent / dsh-agent-loop / dsh-atomic-write / dsh-client-connection /
    dsh-client-ui-trajectory / dsh-cmdline / dsh-file-reference-local / dsh-fs / dsh-fs-local /
    dsh-goal-round-driver / dsh-host-frontend-static / dsh-launch-environment / dsh-llm-deepseek /
    dsh-llm-retry / dsh-mcp-client / dsh-session / dsh-session-persistence / dsh-session-projection /
    dsh-spill-local / dsh-subagent / dsh-subagent-fork-in-process / dsh-subagent-spawn-in-process /
    dsh-tool-bash-persistent / dsh-tool-fs-search / dsh-tool-str-replace-editor / dsh-tool-subagent /
    dsh-tool-web / dsh-user-approval
  - deploy-lag：dsh-agent-loop（reasoningEffort/isSubagent）、dsh-host-apiproxy（u4/u5/u5b）、
    dsh-client-ui-subagent（`lib/client.js`）、dsh-web-search-deepseek
- 改动文件：`lib/index.js`（个别含 `.d.ts` / `client.js`）。
- 为什么重启：宿主侧模块在 boot 时被 loader `import` 进 ESM loadCache；§1.5 已证 web 表面模块级 HMR
  被禁用；loader 的 include/entry 装配（`cordis-plugin-loader`）只认启动时的 import 结果。
- 替代路径：**无热载**。可接受的最小化：批量补丁 + 一次重启（现有 deploy 脚本已是批处理模式：
  `patch-official-015.sh` / `replay-lag-fix.sh`，均"应用后重启 DSH"）。
- 例外：其中纯客户端 bundle 改动（如 dsh-client-ui-subagent 的 `lib/client.js`）走 §1.3/§1.4，**刷新/SSE 即生效**。

### 2.2 自装插件宿主 lib（真实目录，非符号链接）— 必须重启

- 集合与位置：
  - `~/.dsh/profiles/node_modules/@local/`：dsh-btw / dsh-pptmaster / dsh-ssh-gui / dsh-usage /
    dsh-wallpaper / dsh-workerspace
  - `~/.dsh/profiles/node_modules/@deepseek-ai/` 真实目录：dsh-session-board / dsh-taste / dsh-vision-adam
  - `~/.dsh/profiles/node_modules/dsh-workspace-enhancement`（SSH 底座，3 入口：/picker /web /主）
- 改动文件：各包 `lib/index.js`（taste 另有 bridge/collector/learner/storage 等多文件宿主侧；vision-adam 有
  `lib/index.js.bak-restore-*` 历史备份佐证其宿主侧迭代频率）。
- 为什么重启：同 §2.1——宿主侧模块 boot 时 import + web 模块 HMR 禁用；且这些包**不在** cordis patch
  热载的代码面内（patch 热载只重应用配置，不重读模块文件）。
- 替代路径：宿主侧**无热载**；客户端侧（`lib/client.js`）走刷新/SSE 热换。
- 最小化：host 逻辑改动攒批一次重启；UI 类改动尽量下沉到 client bundle 侧（免重启）。

### 2.3 新插件注册（cordis insert）— ✅ 已热载（patch 层），但有前提

- 改动文件：`~/.dsh/profiles/web/cordis.patch.yml`（insert 条目；`dsh-app-boot/lib/index.js:761-781` 热重应用）。
- 前提：插件包**必须已存在于可解析的 node_modules**（cp/npm 安装到 `~/.dsh/profiles/node_modules`），
  否则 loader import 失败 → 装配失败。
- 为什么有时需要重启：仅当同时改了插件宿主 lib 代码（§2.2）才需要；纯新增 insert（包已在盘上）不重启。
- 注意：历史 runbook（`combined-restore-runbook.md`）曾删除/恢复 insert 后要求重启——那是因同批还改了
  vision-adam 宿主 lib 与 settings.yaml 段，非 insert 本身要求。

### 2.4 客户端声明（dsh.client boot 图）— 视改动类型

- 改动文件：各包 `package.json` 的 `dsh.client` 声明（inject 表 / platform / immediately）。
- 已挂载条目的声明变更（改 inject/顺序）：`dsh-client-modules` 的 `resolveMeta` 有 `pkgMeta` 缓存
  （`index.js:377-404`），声明变化不触发重解析 → **需重启**（或至少重新 activate 该 entry）。
- 新插件的声明（随 §2.3 insert）：activation 时 `internal/plugin` 事件 → `processOne` 增量纳入
  （`dsh-client-modules/lib/index.js:277-289, 420-437`），新行进入 boot 图；浏览器刷新即见。**不重启**。

### 2.5 重启清单总表

| # | 改动类别 | 改动文件 | 是否重启 | 为什么 | 替代路径 |
|---|---|---|---|---|---|
| 1 | 官方补丁包宿主侧（28+5 包） | $P/<pkg>/lib/index.js 等 | **重启** | ESM 模块缓存 + web HMR 禁用 | 无；批量补丁一次重启 |
| 2 | 自装插件宿主侧（btw/ssh-gui/vision-adam/taste/session-board/usage/wallpaper/pptmaster/workerspace/workspace-enhancement） | ~/.dsh/profiles/node_modules/<pkg>/lib/*.js | **重启** | 同上 | 无；UI 逻辑下沉 client bundle |
| 3 | cordis.patch.yml insert/disable/config | ~/.dsh/profiles/web/cordis.patch.yml | 不重启 | watchUserPatches 热重应用 | 热载已生效 |
| 4 | settings.yaml 段/值 | ~/.dsh/settings.yaml | 不重启 | settings-file chokidar | 热载已生效 |
| 5 | skills 文件 | ~/.dsh/skills、项目 .dsh/skills | 不重启 | skill-filesystem chokidar | 热载已生效 |
| 6 | 客户端 bundle（官方/自装 client.js） | 各包 lib/client.js | 不重启 | rev 动态服务 + HMR SSE | 刷新即生效 / SSE 热换 |
| 7 | 已挂载条目的 dsh.client 声明 | 各包 package.json | **重启** | pkgMeta 缓存 | 无（低频） |
| 8 | 新插件的 dsh.client 声明 | 随 insert | 不重启 | internal/plugin 增量入图 | 刷新即见 |

---

## 3. 重启成本评估

### 3.1 一次 `npx @deepseek-ai/dsh web` 重启

- 进程形态：`npm exec @deepseek-ai/dsh web` → `sh -c dsh web` → `node ~/.npm-global/bin/dsh web`
  （实测 PID 2437836 树，`ps` 验证）。当前 RSS ≈ **1.30 GB**（1297 MB，`ps -o rss`），
  启动于 2026-09-16 11:40:54。
- 启动时间：web2 独立验收 runbook 用 `sleep 12` 后查日志（`switch-web2-runbook.md` §2），
  即启动到 URL 行就绪在秒级（~2-12s，含 profile 装配 + webserver bind）。
- 会话状态：**保留**——session 持久化为 zstd JSONL（`~/.dsh/sessions/<workspace>/<id>/session.jsonl.zstd`，
  已实测存在；`dsh-session-persistence-jsonl` root=`dshHomePath('sessions')`，`dsh-base/cordis.patch.yml:98-102`），
  重启后可 resume；`dsh-session-checkpoint-policy` 在每次模型请求前做耐久 checkpoint
  （`dsh-session-checkpoint-policy/lib/index.js` 注释），中断轮次以 `interrupted` closers 收尾
  （`dsh-session/lib/index.js:650-748 interruptedTurnClosers`）。
- 进行中的 agent 任务：**中断**——subagent/工作流/后台 job 为进程内 registry
  （`dsh-subagent/lib/index.js:727,755` 内存 Map；`dsh-jobs-local/lib/index.js:105` 内存 Map），
  进程退出即亡；无优雅迁移。goal 走 session 投影（durable），重启后需 resume。
- 浏览器：`dsh-client-connection` 指数退避重连（base 500ms ×2 cap 10s，`lib/client.js:10-12`），
  服务回来后自动重连。

### 3.2 DSH 是否支持优雅重启/热切换

- **无优雅重启**：无 SIGUSR2/SIGHUP reload；SIGTERM/SIGINT → `createProcessShutdown` 有界 5s dispose
  后强退（`profile-boot-DG5t9aNs.js:11 PROCESS_SHUTDOWN_TIMEOUT_MS = 5e3`）。
- **无进程级热切换**：无 gateway swap / 无 cluster / 无 `restart` 命令面（cmdline 仅 `appExit`，
  `dsh-cmdline/lib/index.js:30,50-62`）。
- 结论：重启 = 手工 kill + 重新 `npx @deepseek-ai/dsh web`；成本 ≈ 秒级启动 + 中断进程内任务 + 浏览器自动重连。

---

## 4. 结论：按「高频改动优先」给「值得热载的改动类别」排序

### 4.1 现状一句话

**「必须重启」的其实只有两类：官方补丁包宿主侧 lib 与自装插件宿主侧 lib（含已挂载条目的 dsh.client 声明变更）。
配置、skills、客户端 bundle、插件注册（cordis insert）在 web 表面均已热载。**

### 4.2 排序（按我们部署的实际改动频率）

| 优先级 | 改动类别 | 频率 | 现状 | 值得做热载？ | 现有替代方案 |
|---|---|---|---|---|---|
| 1 | 自装插件**宿主侧** lib（btw/ssh-gui/vision-adam/taste/…） | 高（自研插件迭代） | ❌ 重启 | **最值得** | 无；UI 逻辑下沉 client bundle（刷新/SSE 已热载） |
| 2 | 官方补丁包宿主侧 lib（agent-loop/host-apiproxy/subagent/fs/…） | 中（批量补丁时） | ❌ 重启 | 次值得 | 批量补丁脚本 + 一次重启（deploy-015/lag 模式） |
| 3 | 客户端 bundle / dsh.client 新声明 | 高（UI 迭代） | ✅ 已热载 | 无需 | 刷新即生效 / SSE 热换（client-hmr 已在 web 挂载） |
| 4 | settings.yaml 配置 | 高（模型/壁纸/ssh-gui 参数） | ✅ 已热载 | 无需 | 值级热载 |
| 5 | skills | 中 | ✅ 已热载 | 无需 | 文件级热发现 |
| 6 | 插件注册/禁用/配置覆盖（cordis.patch.yml） | 中 | ✅ 已热载 | 无需 | 条目级热重应用（watchUserPatches） |
| 7 | 已挂载条目 dsh.client 声明变更 | 低 | ❌ 重启 | 低（可接受） | 无 |

### 4.3 给后续修订档的关键提示（依据）

1. **首选改造面**：若要做热载，目标是「自装插件宿主侧」——但官方 web 表面**模块级 HMR 被显式禁用**
   （`dsh-web-app/cordis.patch.yml:21-23` TODO），且 `cordis-plugin-hmr` 默认 `ignored: ["**/node_modules", ...]`
   （`cordis-plugin-hmr/lib/index.js:441-446`）——自装插件位于 node_modules 下，即使启用 hmr row 也被 ignore。
   两条都需先解（重新启用 hmr + 调整 ignored/root 指向自装插件目录），属大改，风险见 TODO。
2. **低成本替代**（不改官方生命周期）：把高频迭代逻辑尽量放 client bundle 侧（已热载）+ settings 侧（已热载）；
   宿主侧改动攒批一次重启（现状 runbook 已如此）。
3. **客户端 bundle 改动当前即可无重启生效**（§1.3/§1.4 已验：rev 动态服务 + client-hmr 500ms 轮询 + SSE 热换），
   这是「重启麻烦」投诉中唯一可以立刻承诺免重启的通道；宿主侧是硬重启区。

---

## 附：关键证据索引（文件:行号）

- settings 热载：`dsh-settings-file/lib/index.js:179-199,228-261`；`dsh-settings/lib/index.js:544-581,618-636`
- skills 热载：`dsh-skill-filesystem/lib/index.js:372-384,412-442,462-471`；`dsh-skill/lib/index.js:404`
- client rev 服务：`dsh-client-modules/lib/index.js:147-156,300-302,459-490`
- client HMR：`dsh-client-hmr/lib/index.js:41-54,78-91,145-152`；`dsh-client-hmr/lib/client.js:38-85`
- patch 层热载：`dsh-app-boot/lib/index.js:761-781`；`profile-boot-DG5t9aNs.js:256-273`
- web 禁用模块 HMR：`dsh-web-app/cordis.patch.yml:21-23`；`dsh-base/cordis.patch.yml:19-22`；
  `cordis-plugin-hmr/lib/index.js:441-446`
- 重启成本：`profile-boot-DG5t9aNs.js:11`；`dsh-cmdline/lib/index.js:30,50-62`；
  `dsh-client-connection/lib/client.js:10-12`；session 持久化 `dsh-base/cordis.patch.yml:98-102`
- 进程实测：PID 2437836（node dsh web，RSS 1297MB）；boot 图 49 行（curl 127.0.0.1:3080）
