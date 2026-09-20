# audit-rebuild — 客户端/宿主插件代码改完后「如何生效」的确切机制（只读调研）

> 只读调研产物 · 目标：查清给官方包 `@deepseek-ai/dsh-client-runtime` 的 `lib/client.js` 打补丁后，
> 浏览器怎样才能真正加载到新代码；以及本部署是否有源码重建能力、既有的打补丁惯例。
> 部署基线：`@deepseek-ai/dsh` **0.1.1-rc.2**，profile `web`（bundles = `dsh-base` + `dsh-web-app`），
> 运行进程 `node /home/CNS2026495165/.npm-global/bin/dsh web`（PID **20806**，启动于 2026-09-20 11:47:23，
> 127.0.0.1:3080）。**全程只读**：未写入 `~/.dsh` / `~/.npm-global` 任何文件，未重启/未发送任何信号给 20806，
> 未执行任何构建；HTTP 探针 **3 次**（串行单发）。
> 全局树 `$P` = `~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai`；
> `~/.dsh/profiles/node_modules/@deepseek-ai/*`（官方包）**全部是指向 `$P` 的符号链接**（`ls -la` 实证）。

---

## 0. 一句话结论

1. **改官方客户端 bundle 不需要重启宿主、也不需要构建**：`/plugins/<id>/client.js` 由 `dsh-client-modules`
   **每次 GET 时从磁盘 `readFile`** 并带 `cache-control: no-cache`，URL 里的 `?rev=` **只是缓存破坏串、不参与内容选择**
   （`rev` = 文件内容 sha1 前 12 位）。因此**原地改文件 → 浏览器刷新即拿到新代码**；且 `dsh-client-hmr` 常驻，
   ~500ms stat 轮询发现 mtime/size 变化 → 重算 rev → 经 SSE `/plugins/events` 推 `rebuilt` 帧 →
  **浏览器自动热换该插件（连刷新都不必）**。
2. **本部署不具备源码重建能力**：装机树只有 tsdown/rolldown 产物（`lib/client.js`，无 `src/`、无构建配置、
   无 tsdown/rolldown/vite 可执行、profiles/web 无 `apps/web`、无 `scripts`）→ **只能原地打补丁**。
3. **本部署已有成熟的官方包原地打补丁惯例**：补丁脚本（备份 → 应用 → 校验 → 回滚 → 幂等）+ `dsh-restart.sh` 管进程层；
   其中**官方客户端 bundle 的原地补丁已有 2 个活体先例**（`dsh-client-ui-subagent/lib/client.js` 的 tok/s 锚点、
   `dsh-client-ui-workspace/lib/client.js` 的槽位 B 补丁），均**免重启**。
4. **宿主侧 `lib/index.js`（宿主半）改动是冷面**：web 表面显式 `disabled` 了模块级 HMR，`profile-boot` 兜底挂的
   `cordis-plugin-hmr` 配置为 `root: []`（不监视任何根）→ **必须重启宿主**。

---

## 1. Q1 — 客户端 bundle 是「预构建产物」还是「源码」？

**判定：预构建产物（tsdown/rolldown bundle，随 npm 包发布），不可当作源码维护。**

| 证据 | 内容 |
| --- | --- |
| 构建脚本 | `$P/dsh-client-modules/package.json`：`"scripts": { "bundle": "tsdown", "watch": "tsdown --watch" }`（唯一构建入口，且 tsdown 未随包安装） |
| 发布面 | `files` 白名单只含 `lib/index.js` `lib/invariant.js` `lib/client.js` `lib/types/**/*.d.ts`；**无 `src/`** |
| exports | `exports["./client"]` → `{"types":"./lib/types/client/index.d.ts","default":"./lib/client.js"}`（类型是 tsc 产物、运行时是 bundle 产物，双轨） |
| 无源码 | `$P/dsh-client-runtime/src/` 不存在；全树只有 cordis 系第三方包带 `src/`（`cordis`、`cordis-plugin-{hmr,loader,group,include,timer}`、`cosmokit`、`schemastery`、`node-addon-landlock-run`），**没有任何 `dsh-*` 包带 `src/`** |
| bundle 指纹 | `$P/dsh-client-runtime/lib/client.js` 为 `window.__ModuleLoader__.load({ id, factory: (require) => { var module… } })` 包裹的 CJS-in-IIFE；含 `//#region lib/types/client/*.js` 区域注释；CSS 为**压缩后单行**且类名**带构建期 hash**（`$P/dsh-client-ui-workspace/lib/client.js` 中 `.qDHVXG_root{--dsh-session-list-edge-inset:…}`）——CSS Modules 哈希是构建期变换，手写不可能 |
| sourcemap 缺失 | 文件尾 `//# sourceMappingURL=client.js.map`，但 `lib/*.map` **未随包发布**（`files` 排除 map）→ 无法从 map 还原原始 TS |
| 构建器未安装 | `command -v tsdown` 失败；`find …/node_modules -name "tsdown*" -o -name "rolldown*"` 无结果 |

对比：本仓库自研插件 `dsh-usage/lib/client.js` 是**手写兼容同一模块格式**（`dsh-taste/README.md:81` 明言「免构建手写 bundle」），
与官方 bundle 的差别不在外层 wrapper，而在「无构建期 hash 的 CSS Modules / 无 `//#region` 类型分区注释」。

**含义**：官方 bundle 里的函数可以被原地改写（它就是普通 JS，`node --check` 可校验），
但**不能**通过「改 src 再编译」的方式维护——一旦上游重装包，补丁即丢失（见 §4 风险）。

---

## 2. Q2 — 谁在服务 `/plugins/...`？`?rev=` 怎么算？原地改文件会不会自动换 rev？

### 2.1 服务者与读盘位置

`@deepseek-ai/dsh-client-modules` 的**宿主半**（`$P/dsh-client-modules/lib/index.js`）：

- `ClientModuleRegistry`（`static inject = ["webServer","loader"]`）在构造期扫描 Loader 条目里声明
  `dsh.client.platform === "web"` 的包，用 `createRequire(ctx.baseUrl)` 解析每个包的 `package.json`，
  由 `exports["./client"]` 得出 **绝对路径** `meta.clientPath = join(dirname(pkgJson), clientRel)`；
- 注册路由：`:295-299` `ctx.webServer.register({ kind: "prefix", path: "/plugins", handler: this.serveBundle })`；
- **serveBundle（`:459-490`）每次请求**：校验 GET/HEAD → 从 pathname 剥出 id → `this.clientPath(id)`
  取**内存表里的绝对路径** → `await readFile(path)` → `200` + `content-type: text/javascript` +
  **`cache-control: no-cache`**（`:483`）。**没有内存缓存、没有 ETag/Last-Modified、不读 URL 的 query**；
- 因此**磁盘文件就是唯一真相源**：文件内容一改，下一个 GET 就返回新内容。

**读盘目录 = 包解析路径**：本部署下即 `$P/<pkg>/lib/client.js`（`~/.dsh/profiles/node_modules/@deepseek-ai/*` 是它的符号链接）。
若某包在 profile 层以**真实目录**遮蔽（如 `@local/*`、`dsh-vision-adam`），则读的是 profile 层那份。

### 2.2 `rev` 的计算与更新

- `rev = shortHash(readFileSync(clientPath))` = **sha1 前 12 位十六进制**（`:147-149` `shortHash`）。
  激活期由 `initialBundleRevision()`（`:406-415`）计算；
- URL 形态：`graphRow()` `:151-158` → `url = /plugins/<id>/client.js?rev=<rev>`；
- **rev 的刷新路径只有一条**：`rebuilt(id)`（`:323-338`）——重读文件重算 sha1，与旧 rev 不同则替换 entry、
  重组 graph、通知 `onRebuilt` 订阅者与 `onGraphChanged`；
- **`rebuilt(id)` 的调用者 = `dsh-client-hmr` 的宿主半**（这是官方设计的唯一入口）：
  `$P/dsh-client-hmr/lib/index.js` `pollIntervalMs` 默认 **500ms**（`:28`），`pollWatches`（`:78-91`）
  对每个 graph 行的 `clientPath` 做 `statSync`，**mtimeMs 或 size 变化**即 `rehash()`（`:41-54`）→ `ctx.clientModules.rebuilt(id)`。
- boot 图注入是**每请求现算**：`dsh-host-webserver` `collectIndexInjections()`（`:288-299`，注释明言
  "Fresh per call, so subscribers read live state (module graph …) at emit time"）→ `client-modules` 的
  `ctx.on("webserver/index-inject", table => table.push(...bootInjections(this.composed)))`（`:300-302`）。

**结论（对追问的直接回答）**：
- **原地改文件 → rev 会自动变**（前提是 mtime 或 size 变了；`cp`/`patch`/编辑器保存都会变），
  因为 client-hmr 常驻且每 500ms 轮询；下一次 `GET /` 的 `__DSH_BOOT__` 里就是新 rev。
- **即使 rev 没变（例如用 `cp -p` 保留了旧 mtime 且长度恰好相同），浏览器也照样拿到新内容**：
  服务端忽略 query、每次读盘、`no-cache` 无验证器 → 不会命中缓存复用。
- 实测（探针 1、2）：`sha1sum $P/dsh-client-runtime/lib/client.js | cut -c1-12` = **`aba836a0c42d`**，
  `curl -s http://127.0.0.1:3080/` 注入的 preload 行 = `/plugins/@deepseek-ai/dsh-client-runtime/client.js?rev=aba836a0c42d` —— **逐位一致**；
  `curl -sI ".../client.js?rev=deadbeef"` → `HTTP/1.1 200` + `cache-control: no-cache`（**假 rev 也照常返回真字节**）。

### 2.3 第二条生效通道：SSE 热换（连刷新都不需要）

- 宿主半无条件挂载（`$P/dsh-web-app/cordis.patch.yml:150` 行 `client-hmr`），SSE 端点是 `/plugins/events`（`:132-159`），
  `rebuilt` 帧内容 `{type:"rebuilt", id, rev}`（`:145-152`）。
- 浏览器半 `$P/dsh-client-hmr/lib/client.js`：`EventSource("/plugins/events")`（`:71`），收到 `rebuilt` →
  `modLoader.invalidate(id)`（`:44`）→ `await modLoader.prefetch(id)`（`:45`）→ 拆旧 fiber → `await entry.refresh()`（`:54`）
  —— **单插件热换，不刷页面**。
- 运输细节：`defaultLoadBundle`（`$P/dsh-client-modules/lib/client.js:114-127`）就是 `document.createElement("script")` +
  `el.src = url`，url 用的仍是**浏览器内存里的旧 rev**；但服务端忽略 query 且 `no-cache`，故取到的是新字节 → 热换成立。
- **实测（探针 3）**：`timeout 3 curl -sN http://127.0.0.1:3080/plugins/events` 返回
  `: connected` + `data: {"type":"graph","graph":{"rev":"6d1a5612ce50","entries":[…]}}`
  —— **证明运行中的 20806 上 client-hmr 宿主半确实活着**，热换链路不是"文档声称"，是活体。
- 例外：`invalidate(id)` 对 **bootstrap id** 直接 return（`:279-283` + `:173`），
  而 bootstrap id 只有 `@deepseek-ai/dsh-client-modules`（HTML 队列 facade 用 `CLIENT_MODULES_ID` 构造，`lib/index.js:210-243`）。
  `@deepseek-ai/dsh-client-runtime` **不在** seed 表（seed 仅 `react` / `react/jsx-runtime` / `react-dom` / `react-dom/client` /
  `@deepseek-ai/cordis` / `@deepseek-ai/dsh-client-ui-slots` / `@deepseek-ai/dsh-client-ui-primitives`，
  见 `$P/dsh-web-frontend/dist/assets/index-ClqxG24t.js` 的 `function Jd(){return{…}}`）→ 它是**普通 graph 行**，
  **可被 SSE 热换**。

### 2.4 行为级注意（给打补丁的人）

- 改写官方 client bundle 里的**核心运行时**（`dsh-client-runtime` 持有 SlotRegistry / SessionRuntime 等服务实例）时，
  SSE 热换会**重挂插件**（旧实例被 dispose、新实例建立），但**已抓到旧引用的 shell/其他插件不会被改写**。
  因此对 runtime 这类核心 bundle，**推荐动作是「浏览器整页刷新」**（确定性最强、一次到位），
  SSE 热换可作为便利通道但不宜作为唯一验收手段。
- 反过来，对**叶子 UI 插件**（如 ui-subagent / ui-workspace 的 client.js），SSE 热换已被本部署实际使用（§4）。

---

## 3. Q3 — 能不能"重建"？（明确判定：**不能**）

### 3.1 `~/.dsh/profiles/web/` 不是前端源码工作区

| 文件 | 实证内容 | 判定 |
| --- | --- | --- |
| `package.json` | `name: dsh-profile-web`、`private: true`、deps 仅 `@deepseek-ai/cordis-plugin-group` / `@deepseek-ai/dsh` / `ssh2`；`dsh.profile.bundles = [dsh-base, dsh-web-app]`、`patchReload: "live"`；**完全没有 `scripts` 段** | profile 依赖锚点，非构建工程 |
| `pnpm-workspace.yaml` | `packages: [.]`、`nodeLinker: hoisted`、`autoInstallPeers: false` | **只声明"自己是唯一包"**，没有 `apps/*`、`packages/*` 成员 |
| `cordis.yml` | `[]`（注释：树由 bundles → cordis.patch.yml → --patch 叠加组合） | 装配清单，非构建 |
| 目录实体 | `ls ~/.dsh/profiles/web`：只有上述文件 + 一堆 `cordis.patch.yml.bak-*` + `.dsh-module-fallback/node_modules`（空）；**无 `node_modules`、无 `src/`、无 `vite.config.*`、无 `apps/`** | 无源码 |
| 依赖 | `cordis.patch.yml` 里 `@local/*` 与 `dsh-workspace-enhancement*` 来自 `~/.dsh/profiles/node_modules/`（自装真目录） | 与前端构建无关 |

> `~/.dsh/profiles/web/package.json` 的 `patchReload: "live"` 指的是 **cordis.patch.yml 条目级热载**（P0-a 实测 ~1s 生效），
> **不是**前端热构建。

### 3.2 全机不存在可重建的前端/客户端源码

- `$P`（全局安装）只有 `config/` + `lib/*.js` + `node_modules/`，**没有 `apps/`、没有 `packages/`**（`ls` 实证）；
- `apps/web` 的产物作为 npm 包发布：`$P/dsh-web-frontend`（`package.json` 描述 "Web application entry: vite build … `dist/` served by apps/cli's dsh web"，repo directory `apps/web`），
  只有 `dist/`（`index.html` + `assets/index-*.js` / `vendor-*.js` / `vendor-*.css`），**无源码、无 vite 可执行**；
- 客户端插件 bundle 的构建命令是各包自己的 `tsdown`（见 §1），**装机树无 tsdown/rolldown**；
- 本机也没有 deepseek-harness 源码 checkout：`find /home/CNS2026495165 -maxdepth 4 -type d -name "deepseek-harness" -o -name harness`、
  `find … -path "*packages/client/runtime*"` 均**无结果**；
- `~/.dsh/profiles/web2/`（0.1.5 归档树，见 `.workspace/lag-audit-diff.md` §6）同样是**产物树**，非源码。

### 3.3 官方提到的 `pnpm run dev:web` 在本部署**不可用**

`$P/dsh-client-hmr/README.zh.md:5` 与 `dsh-web-app/cordis.patch.yml:147` 都提到「重建 watcher（`pnpm run dev:web`）改写客户端 bundle」。
该脚本属于**上游 monorepo 根 package.json**，本机安装树里除 `@google/genai` 的同名无关脚本外**没有任何 `dev:web` 定义**
（`grep -rn "dev:web" $P` 实证）。
`pnpm` 二进制**存在**（`~/.npm-global/bin/pnpm`，注意旧脚本 `replay-lag-fix.sh` 里"本环境 pnpm 不可用"的说法已过期），
**但没有工程可 build**。

**判定：无法重建；只能原地打补丁（in-place patch）。** 补丁后由 §2 的机制自动到达浏览器。

---

## 4. Q4 — 本部署既有的官方包打补丁惯例（先例 + 文档 + 脚本）

### 4.1 机制分工（本仓库的三条规则之一，`README.md:63-89`）

| 层 | 归属 | 载体 |
| --- | --- | --- |
| **代码层**（改官方包/自装包 `lib/*.js`） | 补丁重放脚本：**备份 → 应用 → 校验（`node --check` + 锚点 + sha256/字节比对）→ 回滚 → 幂等** | `.workspace/deploy-lag/replay-lag-fix.sh`、`.workspace/deploy-lag/patch-official-015.sh`、`.workspace/deploy-slots/patch-official-slots.sh`、`.workspace/deploy-p0/`、`.workspace/deploy-vision-*/` |
| **进程层**（何时重启） | `dsh-restart.sh`（SIGTERM 有界等待 dispose → 重启 → `curl` 冒烟 200；`--dry-run`/`--pid`/`--watch`/`--force`） | `.workspace/deploy-lag/dsh-restart.sh`（`README.md` §0 分工表：**"改代码不重启不生效，重启不改代码"**） |
| **热载面** | `cordis.patch.yml` 条目级热载、`settings.yaml` 值级热载、**client bundle 刷新即生效** | `.workspace/deploy-lag/README.md` §9 支持矩阵（P0-a 实测固化） |

### 4.2 **官方客户端 bundle 原地补丁的活体先例（关键先例）**

| 官方包 client bundle | 补丁内容 | 应用者 | 现状实证 |
| --- | --- | --- | --- |
| `$P/dsh-client-ui-subagent/lib/client.js` | tok/s 显示 | `.workspace/deploy-lag/replay-lag-fix.sh`（`UI_CLIENT="$ROOT/dsh-client-ui-subagent/lib/client.js"`，`:60`；从 `~/dsh-upgrade-backup/patched-official-files.tgz` 解包 `cp` 覆盖 + `known-sha256.txt` 校验；restore 单元 `:411`） | mtime **9月12 16:08**（同目录兄弟文件为 14:56）；`grep -c "tok/s"` = **2**（锚点已写入 live 树）→ **正在被服务** |
| `$P/dsh-client-ui-workspace/lib/client.js` | 槽位 B `sidebar.workspaces.remoteHosts` 声明 + 渲染点 | `.workspace/deploy-slots/patch-official-slots.sh`（`patch -p1` 于包目录 + 备份 `backup-$stamp/` + `node --check` + 锚点数校验 + 与交付副本 `diff -q`；`--rollback` 用最新备份还原） | 脚本自带 Runbook；§2.4 同机制 |
| `$P/dsh-tool-subagent/lib/index.js`（宿主半） | P0' settings 默认模型层 | `.workspace/deploy-subagent-model/`（含 `dsh-tool-subagent.p0.diff`） | mtime 9月17 17:00 → **重启后才生效**（FEATURE-MAP 记载 9月17 17:45:39 重启） |
| `$P/dsh-goal-round-driver/lib/index.js`（宿主半） | R1warn 可见性加固 | `.workspace/acceptance-probe/goal-r1-warn.diff` | mtime 9月17 18:34，FEATURE-MAP 明记「**宿主 lib 属冷面，待下一次重启才生效**」 |
| `$P/dsh-client-connection/lib/client.js`、`dsh-client-ui-trajectory/lib/client.js`、`dsh-host-frontend-static/lib/index.js` 等 | lag-fix / 借码补丁批次 | 各重放脚本 | mtime 9月15 16:25 / 16:05（成批恢复） |

**结论：官方客户端 bundle 就地打补丁在本部署是既成事实、有两个活体先例，且"刷新即生效、无需重启"是仓库文档明确结论**
（`README.md:54`、`README.md:75-78`、`FEATURE-MAP.md:69`「client bundle 热载 | 已实现·实测（机制）」、
`.workspace/lag-audit-diff.md` §4.2「客户端补丁按请求读盘 + rev=sha1，**刷新即生效，无需重启**」、
`.workspace/hotreload-b-inventory.md` §1.3/§1.4）。

### 4.3 关于「`.bak-restore-…` 与更新 mtime」的核实（**订正一处误解**）

- `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam/` 是 **profile 层自装真实目录**（`drwxrwxr-x`，创建于 8月28 11:16，
  文件权限 `-rw-------`），由 `~/.dsh/install-plugins.sh` 从工作区 `…/orca_core-main/dsh-vision-adam` **整体 `cp -r` 安装**
  （官方名称/描述同源，version **0.2.0**，`@deepseek-ai` scope）。
  **全局树 `$P` 里没有任何 `*vision*` 包**（`ls` 实证）→ 它是**本地 fork 包**，不是"对官方包的原地修改"。
- 它的 `lib/index.js.bak-restore-20260912-161015` 是**一次还原操作的备份**，`lib/index.js` / `lib/client.js` 的较新 mtime
  （9月16 11:25 / 9月17 18:05）来自 `deploy-vision-settings` / `deploy-vision-prompt` 的迭代
  （`~/.dsh/backups/vision-adam.index.js.bak`、`vision-adam.package.json.bak`、
  `.workspace/deploy-vision-prompt/vision-adam-index.js.diff` 为证）。
- **真正的"官方包原地补丁"证据在 `$P`（全局树）里**，见 §4.2 表（符号链接农场指向 `$P`，改 `$P` 即改运行态）。
- 另一处订正：`patch-official-slots.sh` 头注写「生效方式 = 重启 dsh web + 浏览器刷新」；
  按机制（§2）该重启**并非必需**——client bundle 走按请求读盘 + client-hmr 重哈希，
  **仅刷新浏览器即可**（或等 SSE 热换）。该头注与 `lag-audit-diff.md` §4.2 / `README.md:54` 冲突，以机制与活体为准。

### 4.4 相关文档/脚本索引（可复判）

- `.workspace/master-runbook.md`（总 Runbook）、`.workspace/lag-fix-runbook.md`、`.workspace/btw-v2-runbook.md`（各主题）
- `.workspace/lag-fix-audit.md` §4 / `lag-audit-diff.md` §4-§6（客户端/宿主补丁的生效面与风险）
- `.workspace/deploy-lag/README.md` §9（热载支持矩阵 + 免重启清单 + 硬约束）、§0（分工表）
- `.workspace/hotreload-b-inventory.md` §1.3/§1.4/§1.5（客户端 rev 服务 / SSE 热换 / loader 条目级热载的代码级证据）
- `README.md` 三条规则、`FEATURE-MAP.md` 热载节、`DOC-STYLE.md`（文档约定）
- 备份位置惯例：`.workspace/deploy-*/backup-*`、`.workspace/backup-*`、`~/.dsh/backups/`、
  `~/dsh-upgrade-backup/{patched-official-files.tgz,self-built-plugins.tgz,dsh-home-config.tgz}`

---

## 5. Q5 — 宿主侧（server）插件改动如何生效？

**判定：冷面，必须重启宿主；`cordis-plugin-hmr` 在本部署的 web 表面不监视插件代码。**

证据链：

1. `$P/dsh-web-app/cordis.patch.yml:19-23`：
   ```yaml
   # TODO: Re-enable shared HMR for Web after its reload lifecycle is tested.
   - id: hmr
     disabled: true
   ```
   base 层的 `hmr` 行（`$P/dsh-base/cordis.patch.yml:19-22`，`config.root: ['.']`）在 web patch 层被**禁用**。
2. `dsh/lib/profile-boot-DG5t9aNs.js:257-263`：`if (ctx.get("hmr") === void 0) { … loader.create({ name: "@deepseek-ai/cordis-plugin-hmr", config: { root: [] } }) }`
   —— 兜底再挂一个实例，但 **`root: []` = 不监视任何目录**（`cordis-plugin-hmr/lib/index.js:440` `root: z.array(String).default(["."])`；
   `:196` `watch(root, …)`；`:226` `readyState = root.length === 0 ? "resolved" : "pending"`）。
   该实例的唯一用途是承载 `registerConfig(filename, refresh)`（`:118`）。
3. `profile-boot-DG5t9aNs.js:264-274`：随即用 `watchUserPatches()` 精确 watch **两个文件**——
   profile 的 `cordis.patch.yml` 与 `$DSH_HOME/cordis.patch.yml`——变化时事务性重应用 patch 列表。
   这与 `.workspace/deploy-lag/README.md` §9.4 的机制链记载一致。
4. 后果：**改插件宿主代码（`lib/index.js`）不热**（ESM loadCache 缓存 + 上述 HMR 禁用），
   **但改 `cordis.patch.yml` 的 insert/remove/disable/name/config 是热的（~1s）**。
5. 本部署实证一致：FEATURE-MAP 多处标注「宿主 lib 属冷面 → 需重启一次」（`dsh-goal-round-driver` R1warn、
   `dsh-tool-subagent` P0'、`dsh-agent-loop`/`dsh-host-apiproxy` lag-fix），并已于 9月17 17:45:39 重启加载。
6. 重启工具：`.workspace/deploy-lag/dsh-restart.sh`（本文未执行；**它会 SIGTERM 目标进程，属用户裁决动作**。
   该脚本默认拒绝猜测目标，多实例时须 `--pid`）。

---

## 6. Q6 — 给上层的可行路径对照表（推荐排序）

> 目标诉求：修改官方包 `@deepseek-ai/dsh-client-runtime` 的 `lib/client.js`（客户端半）。
> 下面每条都给出：确切命令 / 需要重启什么 / 浏览器动作 / 回滚。**命令仅为规范，本次调研未执行。**

### 决策速查

| # | 路径 | 需要重启宿主？ | 浏览器动作 | 适用 | 风险 |
| --- | --- | --- | --- | --- | --- |
| **A（推荐）** | **全局树原地补丁 + 补丁脚本固化** | **否** | **刷新（F5）；约 0.5-1s 后 SSE 亦会自动热换** | 全部客户端 bundle 改动 | 上游重装即丢；需备份+校验+回滚脚本 |
| B | 用 `@local` 覆盖插件改行为（不改官方包） | 否 | 刷新（或 cordis.patch.yml 热载后自动） | 能被 slot / UI 缝覆盖的需求 | 改不到 runtime 内部逻辑 |
| C | profile 层真实目录 fork 整个包（`dsh-vision-adam` 先例） | **是**（宿主半也换了） | 刷新 | 宿主+客户端都要改、且改动大 | 需删除符号链接改真目录；`README.md:162` 明确警告「**绝不对 `~/.dsh/profiles/web` 执行 npm/pnpm install**——曾致全体补丁失效」 |
| D | 源码重建 | — | — | — | **不可用**：本机无源码、无 tsdown/vite（§3） |

### A. 原地补丁（推荐；沿用本部署惯例）

```bash
# A1 备份（改名带时间戳，落在自建备份目录，勿散放）
B=~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai
cp "$B/dsh-client-runtime/lib/client.js" "/path/to/backup/dsh-client-runtime.lib.client.js.$(date +%Y%m%d-%H%M%S).bak"

# A2 原地应用（cp 交付副本，或 patch -p1 于包目录；两种本仓库都有先例）
cp /path/to/patched/dsh-client-runtime/lib/client.js "$B/dsh-client-runtime/lib/client.js"
# 或：cd "$B/dsh-client-runtime" && patch -p1 < /path/to/xxx.patch

# A3 校验（fail-closed：语法 + 锚点 + 与交付副本字节一致）
node --check "$B/dsh-client-runtime/lib/client.js" && echo "syntax OK"
grep -c '<你的锚点串>' "$B/dsh-client-runtime/lib/client.js"    # 期望 ≥1
diff -q /path/to/patched/dsh-client-runtime/lib/client.js "$B/dsh-client-runtime/lib/client.js"

# A4 生效验证（只读探针，串行）
sha1sum "$B/dsh-client-runtime/lib/client.js" | cut -c1-12        # 记为 NEWREV
curl -s http://127.0.0.1:3080/ | grep -o 'dsh-client-runtime/client.js?rev=[a-f0-9]*'
#   → 期望 NEWREV（client-hmr 500ms 轮询内刷新；若仍是旧 rev，见下方"rev 未变"处置）
curl -s "http://127.0.0.1:3080/plugins/@deepseek-ai/dsh-client-runtime/client.js?rev=any" | sha1sum
#   → 期望与磁盘 sha1 一致（证明"服务端按请求读盘"，与 rev 无关）
timeout 3 curl -sN http://127.0.0.1:3080/plugins/events   # 可选：观察 rebuilt 帧
```

- **需要重启什么**：**不需要重启宿主**（客户端 bundle 属热面）。
- **浏览器动作**：**整页刷新**（Ctrl/Cmd+R）即为确定生效；
  `dsh-client-hmr` 常驻，正常情况下 ~0.5-1s 内会推 `rebuilt` 并**自动热换该插件（无需刷新）**；
  对 `dsh-client-runtime` 这类核心 bundle，**以刷新为准**（避免旧引用残留导致混合态，见 §2.4）。
- **rev 未变的处置**：只可能是 mtime 与 size 都没变（如 `cp -p` 保留 mtime 且长度相同）。
  内容仍会以新字节送达（`no-cache` + 按请求读盘），刷新即可；若还想让 manifest rev 更新，
  `touch` 一下文件使 mtime 变化即可（**注意：这是写操作**）。
- **回滚**（三档，任选）：
  1. `cp <A1 的 .bak> "$B/dsh-client-runtime/lib/client.js"` —— 最小面回滚（客户端改动**刷新即回滚**，无需重启）；
  2. 若有对应重放脚本：`bash .workspace/deploy-*/xxx.sh --rollback`（用最新 `backup-*` 还原，并做锚点消失断言）；
  3. 面最大化：`npm i -g @deepseek-ai/dsh@0.1.1-rc.2` 重装全局树 → **会抹掉本机全部官方包补丁**，
     之后必须按 `README.md:114-127` 顺序重放：`replay-lag-fix.sh` → `patch-official-015.sh` → `patch-official-slots.sh` → `dsh-restart.sh`。
- **固化要求（fail-closed，本仓库规则 3）**：把 A1-A3 写成幂等重放脚本（备份 → 应用 → `node --check` + 锚点/sha256 校验 →
  `--rollback` 一键还原），并把补丁副本/`known-sha256` 纳入 `.workspace/deploy-*/`；
  校验失败必须 `FAIL` 非零退出、绝不静默部分生效。**升级/重装 npm 包会再次抹掉补丁**（`.workspace/lag-audit-diff.md` §5.1）。

### B. 不改官方包（当改动能被缝覆盖时）

- 新写 `@local/xxx` 插件（`examples/minimal-plugin/` 脚手架）→ `~/.dsh/profiles/node_modules/@local/xxx` →
  在 `~/.dsh/profiles/web/cordis.patch.yml` 追加 `insert` → **热载 ~1s 生效，零重启**（`.workspace/deploy-lag/README.md` §9.2 实测）。
- 回滚：删除 insert 条目（热）或 `- id: X` + `disabled: true`。
- 限制：只能覆盖/占据 UI 缝（slot、tool view、settings section），**改不到 `dsh-client-runtime` 的内部实现**。

### C. profile 层真实目录 fork（仅在同时要改宿主半时才考虑）

- 命令面：把改造后的整包放到 `~/.dsh/profiles/node_modules/@deepseek-ai/<pkg>`（**真实目录**遮蔽全局符号链接），
  然后 `dsh-restart.sh` 重启。先例：`~/.dsh/install-plugins.sh`（`rm -rf` + `cp -r` + 重启提示）。
- 代价：profile 层从此与全局树分叉（升级不同步）；`README.md:162` 明确禁止在 `profiles/web` 跑 npm/pnpm install。
- 回滚：删除该真实目录即回落到全局符号链接。

### D. 源码重建（**不可行，别围绕它设计**）

- 装机树无 `src/`、无 tsdown/rolldown/vite、`profiles/web` 无 `apps/web`、本机无 monorepo checkout（§3）。
- 唯一形态是"拿到上游对应版本源码后重建"，本机不具备，且会引入版本漂移风险。

---

## 7. 证据附录（本次实际执行的只读命令与输出摘要）

| # | 命令（只读） | 关键输出 |
| --- | --- | --- |
| E1 | `ps -o pid,ppid,lstart,etime,cmd -p 20806` | `PID 20806 PPID 20805 STARTED 日 9月20 11:47:23 2026 CMD node /home/CNS2026495165/.npm-global/bin/dsh web`（全程未触碰） |
| E2 | `ls -la ~/.dsh/profiles/node_modules/@deepseek-ai/` | 官方包全为符号链接 → `$P`（如 `dsh-client-runtime -> …/dsh/node_modules/@deepseek-ai/dsh-client-runtime`） |
| E3 | `cat $P/dsh-client-modules/package.json` | `"scripts":{"bundle":"tsdown","watch":"tsdown --watch"}`；`files` 白名单无 `src`/无 `*.map`；`exports["./client"].default="./lib/client.js"` |
| E4 | `grep -n` on `$P/dsh-client-modules/lib/index.js` | `:147-149` sha1-12；`:151-158` `url=/plugins/<id>/client.js?rev=`；`:295-299` prefix 路由；`:300-302` index-inject；`:323-338` `rebuilt()`；`:406-415` 激活期 rev；`:459-490` `serveBundle`（`:483` `no-cache`） |
| E5 | `sed -n '288,302p' $P/dsh-host-webserver/lib/index.js` | `collectIndexInjections()` 注释：`Fresh per call, so subscribers read live state (module graph …) at emit time` |
| E6 | `$P/dsh-client-hmr/lib/index.js` 全文 | `:28` poll 500ms；`:78-91` `pollWatches`（mtime/size）；`:41-54` `rehash → clientModules.rebuilt`；`:132-159` `/plugins/events` SSE + `rebuilt` 帧 |
| E7 | `$P/dsh-client-hmr/lib/client.js` 全文 | `:44` `invalidate(id)`；`:45` `prefetch(id)`；`:54` `entry.refresh()`；`:71` `new EventSource("/plugins/events")` |
| E8 | `$P/dsh-client-modules/lib/client.js` | `:114-127` `defaultLoadBundle`（`script.src=url`）；`:173` 仅 modules 为 bootstrapId；`:272-278` prefetch；`:279-283` invalidate |
| E9 | `$P/dsh-web-frontend/dist/assets/index-ClqxG24t.js` | `function Jd(){return{react…,"@deepseek-ai/dsh-client-ui-primitives":Kd}}`（seed 表无 client-runtime）；`i.create({boot:n.__DSH_BOOT__,staticModules:Jd(),…})` |
| E10 | `$P/dsh-web-app/cordis.patch.yml` | `:19-23` `- id: hmr / disabled: true`（TODO 注释）；`:150` `client-hmr` 无条件挂载注释；`:159` `modules`；`:176` `client-runtime` |
| E11 | `sed -n '250,275p' dsh/lib/profile-boot-DG5t9aNs.js` | `ctx.get("hmr")===void 0 → loader.create({name:"@deepseek-ai/cordis-plugin-hmr", config:{root:[]}})` + `watchUserPatches()` ×2 |
| E12 | `grep -n root $P/cordis-plugin-hmr/lib/index.js` | `:118` `registerConfig`；`:196` `watch(root,…)`；`:226` `root.length===0 → resolved`；`:440` root 默认 `["."]` |
| E13 | **探针 1**：`sha1sum $P/dsh-client-runtime/lib/client.js` + `curl -s http://127.0.0.1:3080/ \| grep -o 'client.js?rev=[a-f0-9]*'` | 磁盘 `aba836a0c42d`；HTML 注入 `/plugins/@deepseek-ai/dsh-client-runtime/client.js?rev=aba836a0c42d` → **rev = 内容 sha1-12，实锤** |
| E14 | **探针 2**：`curl -sI "http://127.0.0.1:3080/plugins/@deepseek-ai/dsh-client-runtime/client.js?rev=deadbeef"` | `HTTP/1.1 200 OK`、`content-type: text/javascript; charset=utf-8`、`cache-control: no-cache`（假 rev 也返回真字节 → **query 不参与内容选择**） |
| E15 | **探针 3**：`timeout 3 curl -sN http://127.0.0.1:3080/plugins/events` | `: connected` + `data: {"type":"graph","graph":{"rev":"6d1a5612ce50","entries":[…]}}` → **PID 20806 上 client-hmr 宿主半活着** |
| E16 | `grep -c "tok/s" $P/dsh-client-ui-subagent/lib/client.js`；`ls -la` 同目录 | `2`（锚点已写入 live 树）；`client.js` mtime 9月12 16:08 vs 兄弟 14:56 → **官方客户端 bundle 原地补丁活体先例** |
| E17 | `ls -la ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam/` + `head package.json` + `ls -d $P/*vision*` | 真实目录（8月28 创建，`-rw-------`）、`@deepseek-ai/dsh-vision-adam@0.2.0`；`$P` 无任何 vision 包 → **该 `.bak` 属"profile 层本地 fork 的还原备份"，非官方包原地修改** |
| E18 | `cat ~/.dsh/install-plugins.sh` | `rm -rf $FB/dsh-vision-adam; cp -r $WS/dsh-vision-adam $FB/dsh-vision-adam` → vision-adam 的安装惯例（profile 层真目录） |
| E19 | `ls .workspace/deploy-*/`、`find .workspace -name "*.patch" -o -name "*.diff"`、`grep -n "lib/client.js" --include=*.sh` | `replay-lag-fix.sh:60,102,411`（官方 `dsh-client-ui-subagent/lib/client.js`）、`patch-official-slots.sh:7,48,97,112,132`（官方 `dsh-client-ui-workspace/lib/client.js`）→ 打补丁惯例与回滚面 |
| E20 | `command -v pnpm/npm/npx/tsdown`；`find $P -name "tsdown*" -o -name "rolldown*"`；`find … -name src` | pnpm/npm/npx 有；**tsdown/rolldown 无**；`src/` 仅 cordis 系第三方包；`find … -path "*packages/client/runtime*"` 无结果 → **不可重建** |
| E21 | `.workspace/hotreload-b-inventory.md` §1.3/§1.4/§1.5、`.workspace/deploy-lag/README.md` §9.1-§9.4、`README.md:63-89`、`FEATURE-MAP.md:66-71`、`.workspace/lag-audit-diff.md` §4-§6 | 本仓库既有结论与本报告机制一致；**订正**：`patch-official-slots.sh` 头注的"需重启"对客户端 bundle 不成立 |

**纪律复核**：本报告未修改 `~/.dsh`、`~/.npm-global`、`.workspace/deploy-*` 任何既有文件（仅在会话工作区新建本文件）；
未重启/未向 PID 20806 发信号；未执行任何构建；HTTP 探针 3 次（E13/E14/E15），串行单发。
