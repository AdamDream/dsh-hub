# dsh-taste Web GUI 客户端半调研（任务 A）

> 范围：客户端插件发现机制 + UI 扩展面。所有结论均以已安装包源码为准（本部署无 `apps/web` checkout）。
> 关键包根：`/home/CNS2026495165/.dsh/profiles/web/node_modules/@deepseek-ai/`（官方 web 包真实目录）。
> 自装包根：`/home/CNS2026495165/.dsh/profiles/node_modules/@deepseek-ai/`（`dsh-session-board` / `dsh-vision-adam` / `dsh-taste` 为真实目录，其余为指向 web profile 的符号链接）。

---

## 1. 发现链路：浏览器如何枚举 client 插件

### 结论（一句话）
浏览器**不扫描任何 node_modules**。client 插件由 **host 半的 `dsh-client-modules`（`ClientModuleRegistry` Service）** 在 host 侧扫描「已被 cordis Loader 装载的插件条目」，凡 package.json 声明了 `dsh.client`（`platform:"web"`）且 `exports["./client"]` 指向存在的 bundle 文件，就被编入 `window.__DSH_BOOT__` 图并按需经 `/plugins/<id>/client.js` 动态 `<script>` 注入。**自装插件的 client 半进入发现范围的前提是：该包已被 host Loader 装载（cordis.patch.yml `insert`）+ package.json 有 `dsh.client` + `exports["./client"]` + 该路径下 bundle 文件存在。**

### 证据链

**(a) 扫描源 = host Loader 的条目，不是 node_modules 目录。**

`dsh-client-modules/lib/index.js`（host 半，`ClientModuleRegistry extends Service`）：
```js
// L259
static inject = ["webServer", "loader"];
// L290  构造时把「当前所有已装载条目」标记为 dirty
for (const entry of ctx.loader.entries()) this.dirty.add(entry.options.name);
// L277-289  增量：每个 fiber 构造/销毁（internal/plugin 事件）把 entry 名标 dirty，微任务 flush
ctx.on("internal/plugin", (fiber) => { ... this.dirty.add(entryName); ... queueMicrotask(() => this.flush(...)) });
```
条目名 `entry.options.name` 就是包名（如 `@deepseek-ai/dsh-taste`）。

**(b) 判定一个条目是否是 client 包 = 读它的 package.json。**

`resolveMeta(pkgName)`（`dsh-client-modules/lib/index.js` L377-404）：
```js
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const decl = parseDshClient(pkgName, pkg.dsh?.client);        // 解析 dsh.client 声明
if (decl === void 0 || decl.platform !== "web") { ... return null; }   // L390 平台必须 === "web"
const clientRel = clientExportOf(pkgName, pkg.exports);       // 解析 exports["./client"]
if (clientRel === void 0) throw new Error(`... declares dsh.client but exports no "./client" bundle`);
const meta = { clientPath: join(dirname(pkgPath), clientRel), inject, external, immediately };
```
- `clientExportOf`（L136-146）：`exports["./client"]` 接受字符串或 `{default: "..."}` 一阶条件导出。
- `initialBundleRevision`（L412-419）：`shortHash(readFileSync(clientPath))`；`ENOENT` 抛 `MissingClientBundleError`，恢复指引原文 = **"run `pnpm run build` before launch"**。

**(c) 编入 boot 图 + bundle 服务。**

`graphRow`（L152-161）给每个条目一行：
```js
{ id, url: `/plugins/${id}/client.js?rev=${rev}`, rev, ...(inject?{inject}:{}), ...(immediately?{immediately:true}:{}), ...(external.length>0?{external}:{}) }
```
`serveBundle`（L459-490）服务 `/plugins/<id>/client.js`，关键响应头 `"cache-control": "no-cache"`。
`bootInjections`（L209-250）把三样东西注入 index HTML：`window.__ModuleLoader__` 内联队列 + `@deepseek-ai/dsh-client-modules` / `@deepseek-ai/dsh-client-runtime` 的 parser-preload 脚本 + `window.__DSH_BOOT__` 全局图。

**(d) `dsh.client` 声明的确切格式（官方真实例子）。**

`dsh-cordis-client-runner/package.json`：
```json
"exports": { "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" }, ... },
"dsh": { "client": { "inject": ["@deepseek-ai/dsh-client-runtime", "@deepseek-ai/dsh-api-remotes", "@deepseek-ai/dsh-client-modules", "@deepseek-ai/dsh-client-ui-theme"], "platform": "web" } }
```
`dsh-client-ui-goal/package.json` 的 `dsh.client` 只有 `inject` + `platform`，无 `external`（其 `require("@deepseek-ai/dsh-client-ui-primitives")` 走 seed word，见 §2）。

字段语义（由 `parseDshClient` L120-134 / `parseBootManifest` L47-104 确认）：
- `platform`：字符串，必须 `"web"`。
- `inject`：字符串数组 —— **包名**级依赖（该 client bundle 激活前需先装载哪些其他 client bundle）。
- `external`：字符串数组 —— **模块图**边（bundle `require` 的其他 client 包，用于拓扑排序到达顺序）。
- `immediately`：布尔 —— 立即装载（`dsh-client-runtime` / `dsh-client-hmr` 用）。
注意：这与 bundle 内导出对象里的 `inject`（**服务名**，见 §3）是两层，别混淆。

**(e) 用户自装插件的装载清单与模块解析。**

- `/home/CNS2026495165/.dsh/profiles/web/cordis.yml` = `[]`（空）。
- `/home/CNS2026495165/.dsh/profiles/web/cordis.patch.yml` 用 `insert` 装载（L21-23）：
  ```yaml
  - insert:
      - id: taste
        name: '@deepseek-ai/dsh-taste'
  ```
- profile base = `~/.dsh/profiles/web/`；loader 向上解析 node_modules，命中 `~/.dsh/profiles/node_modules`（扁平回退目录，`install-plugins.sh` L5 注释明确）。自装包（taste/session-board/vision-adam）放在这里作真实目录，官方包在此是指向 web profile 的符号链接。

**(f) 自装 client 半是否需要构建步骤？—— 不需要强制构建，只要文件格式对。**

`clientExportOf` 只要求 `exports["./client"]` 指向的相对路径可读；`serveBundle` 只是 `readFile` + 服务。真正的约束是**内容格式**：bundle 必须是一个调用 `window.__ModuleLoader__.load({id: "<包名>", factory})` 的普通 JS，且 factory 返回 `{ apply, inject }`（见 §2/§3）。官方包用 `tsdown`（rolldown）把 TS+JSX+CSS-modules 编译成这个单文件（`lib/client.js` 顶部可见 `\0rolldown/runtime.js`），但**手写同等格式的 `lib/client.js` 同样被接受**（`dsh-client-modules/lib/client.js` L190-208 `arrive()` 只校验「脚本加载后 `factories.has(id)`」，L189-194 拒绝重复注册）。运行时是动态 `<script src=/plugins/...>` 注入（`defaultLoadBundle` L114-127），非构建时打进 shell。

---

## 2. UI 框架与技术栈 + 最小可模仿结构

### 结论
- **框架**：React **18.2.0** + react-dom 18.2.0（`dsh-web-frontend/package.json` devDependencies `react: ^18.2.0`、`@vitejs/plugin-react ^4`；各 client-ui 包 devDeps 同）。JSX 编译为 `react/jsx-runtime`。
- **样式**：CSS Modules（编译后以 `<style data-plugin data-plugin-css>` 内联注入 head）+ 设计 token `var(--dsw-*)`（由 `dsh-client-ui-theme` 提供）。
- **组件/槽位基础库**：`@deepseek-ai/dsh-client-ui-primitives`（Tooltip、Icon*Outline16、MessageText、FishLogo 等）与 `@deepseek-ai/dsh-client-ui-slots`（SlotCore）—— 二者都是 **seed word**（静态模块，打包进 Vite shell dist）。
- **构建**：官方包 `tsdown`（rolldown）产 `lib/client.js`；shell 用 Vite 6 构建（`dsh-web-frontend`）。

**seed word 证据**：`dsh-web-frontend/dist/assets/index-ClqxG24t.js` 内出现模块 id `"react"`、`"react/jsx-runtime"`、`"react-dom"`、`"@deepseek-ai/dsh-client-ui-primitives"`、`"@deepseek-ai/dsh-client-ui-slots"`；`dsh-client-modules` 的 `makeRequire`（client.js L251-261）解析顺序为 seed → loadCache → factories，故 client 插件 `require("react")`/`require("@deepseek-ai/dsh-client-ui-primitives")` 不需要声明 `external`。

### 最小可模仿结构（`dsh-client-ui-goal/lib/client.js`，447 行，读透后归纳）

```js
// 1) 包一层 ModuleLoader 注册（id 必须是裸包名）
window.__ModuleLoader__.load({
  id: "@deepseek-ai/dsh-client-ui-goal",
  factory: (require) => {
    var exports = {};                                   // 2) CJS 形式导出面
    let react = require("react");
    let jsx = require("react/jsx-runtime");
    let primitives = require("@deepseek-ai/dsh-client-ui-primitives");

    // 3) CSS：字符串 + 一次性注入 <style data-plugin data-plugin-css>（L11-19）
    const css = "…"; const tagId = "@deepseek-ai/dsh-client-ui-goal/GoalBar.module.css";
    if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css="+JSON.stringify(tagId)+"]") === null) {
      const tag = document.createElement("style");
      tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-goal";
      tag.dataset.pluginCss = tagId; tag.textContent = css; document.head.appendChild(tag);
    }
    // 4) React 组件（用 jsx()/jsxs() 而不是 JSX 文本）
    function GoalBar(props) { /* ... */ }

    // 5) 插件体：导出的 { inject(服务名数组), apply(ctx) }
    const inject = ["slots", "sessions", "remote", "remote.goals", "locale", "conversationEvents"];
    function apply(ctx) {
      ctx.conversationEvents.register(goalCommandInputDefinition);
      ctx.effect(() => ctx.locale.register("goal", { zh, en }), "ui-goal: dictionaries");
      ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
        name: "conversation.input.dock", id: "goal", order: 10, locale: "goal",
        inject: (sessionId) => ({ /* 传给组件的 props/回调 */ })
      }, GoalDock));
    }
    exports.apply = apply; exports.inject = inject; return exports;
  }
});
```
要点：bundle 内 `inject` 是**服务名**（`slots`/`locale`/`sessions`/`remote.*`/`conversationEvents`…），由 fiber 的 inject gating 控制激活；`apply(ctx)` 里用 `ctx.slots.inject(slot, () => ctx.slots.register({...}, Component))` 挂 UI。

---

## 3. 扩展点清单（一个插件能把 UI 放到哪些位置）

**先澄清：没有 URL 路由系统。** shell 是「槽位树」，`dsh-client-ui-layout` 注册进 `root` 槽，整个页面 = `renderSlot("root")`。`ctx-level renderSlot` 只允许渲染 `root`（`SlotRegistry.renderSlot` L154-159）。所以「独立路由页」的等价物是槽位，不是 URL。

### 3.1 槽位服务 API（`SlotRegistry`，`dsh-client-runtime/lib/client.js` L24-334）
- `ctx.slots.register(rawOptions, component) -> disposer`（L331-334，内部走 `ctx.effect` 挂 fiber 清理）。
  `rawOptions` 关键字段：`name`（目标槽名）、`id`（list/keyed 槽必需）、`key`（keyed 槽）、`order`（list 排序）、`label`（可函数）、`locale`（翻译命名空间）、`children`（子槽声明）、`inject`（给组件注入 props/回调）、`store`（defineStore 句柄）、`priority`（single 遮蔽优先）、`registrant`。
- `ctx.slots.inject(slotKey, callback) -> disposer`（L55-114）：等该槽被声明后执行 callback（callback 内再 register）。
- 其他：`spec(key)`、`entries(key)`、`entriesOfSlot(key)`、`subscribe(key,fn)`、`getVersion(key)`、`snapshot(root)`、`onEntryError(fn)`。
- 子槽声明：`children: { "槽名": { kind: "single"|"list"|"chain"|"keyed", scope: "root"|"session"|"session-maybe" } }`。

### 3.2 根/布局（`dsh-client-ui-layout/lib/client.js` L401-435）
```js
ctx.slots.register({ name: "root",
  children: {
    "sidebar":      { kind: "single", scope: "root" },
    "conversation": { kind: "single", scope: "session-maybe" },
    "details":      { kind: "single", scope: "session" },
    "shell.overlay":{ kind: "list",   scope: "root" }
  }, store: createLayoutStore, inject: (actions) => {...}
}, AppFrame);
```
→ 四个顶层挂载位：侧栏、会话中心区、详情面板（session 作用域）、**覆盖层 `shell.overlay`（list/root，全局模态位）**。

### 3.3 侧栏（`dsh-client-ui-sidebar/lib/client.js` L287-313）
```js
ctx.slots.register({ name: "sidebar", children: {
  "sidebar.brand.mark":    { kind: "single", scope: "root" },
  "sidebar.brand.name":    { kind: "single", scope: "root" },
  "sidebar.workspaces":    { kind: "single", scope: "root" },
  "sidebar.settings":      { kind: "single", scope: "root" },
  "sidebar.footer.action": { kind: "list",   scope: "root" }   // ← 图标动作入口，可追加
}}, SidebarRoot);
```

### 3.4 设置页 tab（`dsh-client-ui-settings-general/lib/client.js` L536-595）
- 顶层注册 `sidebar.settings` + 子槽 `settings.trigger/header/action/close/section/onboarding`。
- **`settings.section` 是 `list` 槽** —— 每个「设置 tab」就是一个 `settings.section` 条目：
```js
ctx.slots.inject("settings.section", () => ctx.slots.register({
  name: "settings.section", id: "general", order: 0, label: () => t("general.nav"), locale: NS,
  children: { "settings.general.item": { kind: "list", scope: "root" } }
}, GeneralSection));
```
- `dsh-client-ui-settings-plugins/lib/client.js` L1276+ 同模式注册 `{id:"plugins", order:15, ...}`，并演示 `kind:"keyed"` 子槽（`settings.plugin.item`）与 `function* () { yield ctx.slots.register(...); ... }` 的多条目注册。

### 3.5 会话内卡片 / slot（`dsh-client-ui-goal/lib/client.js` L381-437，槽由 `dsh-client-ui-conversation` 声明）
- `conversation.chat.node`（消息节点视图，`key:"command-input"`）。
- `conversation.input.dock`（composer 上方 dock，GoalBar；`id:"goal", order:10, inject:(sessionId)=>({...动词})`）。
- 另有 `tool.view.cordis`（`dsh-cordis-client-runner/lib/client.js` L262-265，key 绑定到 package id）。

### 扩展点速查表

| 挂载位 | 槽名 | 类型/作用域 | 现有用例 |
|---|---|---|---|
| 全屏覆盖层 | `shell.overlay` | list / root | layout 声明，官方暂空的全局模态位 |
| 详情面板 | `details` | single / session | layout 声明（session 级） |
| 侧栏底部动作 | `sidebar.footer.action` | list / root | sidebar 声明 |
| 侧栏设置入口 | `sidebar.settings` | single / root | settings-general 占据 |
| 设置页 tab | `settings.section` | list / root | general(order0)/plugins(order15) |
| composer 上方 dock | `conversation.input.dock` | （conversation 声明） | goal 的 GoalBar |
| 消息节点 | `conversation.chat.node` | （conversation 声明） | goal 的 command-input 视图 |

---

## 4. 自装先例：dsh-session-board 是否带 client 半

### 结论
**dsh-session-board 是纯 host 半插件，没有 client 半。** 它是「无源码 checkout 环境下自装 **host** 插件可行」的强证据，但**不是**「自装插件 **GUI** 可行」的证据（它根本没做 GUI）。

### 证据
- `package.json`（`/home/CNS2026495165/.dsh/profiles/node_modules/@deepseek-ai/dsh-session-board/package.json`）：只有 `name/version/type/main:"lib/index.js"/license/peerDependencies/dependencies`，**无 `dsh` 字段、无 `exports` 字段** → 不会被 `dsh-client-modules` 编入 boot 图。
- `lib/` 七个文件全部是 host 侧（`index.js/board.js/capture.js/grouping.js/inject.js/storage.js/tool.js`），用的是 `dsh-system-prompt`/`dsh-session`/`dsh-tools`/`dsh-atomic-write` 等 host 服务，无 `lib/client.js`。
- 装载方式（`install.sh` + CONTRACT.md）：`cp -r` 到 `~/.dsh/profiles/node_modules/@deepseek-ai/`，再在 `cordis.patch.yml` `insert {id, name}`，重启。与 dsh-taste 完全同款。

### 推论（正向）
既然 client 半发现机制 = 「host Loader 条目 + package.json `dsh.client` + `exports["./client"]` + bundle 文件存在」（§1），而 dsh-taste 已被 `cordis.patch.yml` 装载为 host 条目，那么**给 dsh-taste 补上 `dsh.client` 声明 + `exports["./client"]` + 手写 `lib/client.js`，重启后其 client 半就会进入 boot 图** —— 这条路径不依赖任何源码 checkout，机制上完全成立。官方 `dsh-client-ui-*`（~40 个 static `dsh.client` 双面包）就是「client 半存在且被服务」的既有事实。

---

## 5. 推荐形态（taste 查看页最优挂载）

### 裁定：`sidebar.footer.action` 图标入口 + `shell.overlay` 全屏查看面板（备选：`settings.section` 加 tab）

**理由**
1. **无独立路由页可用**（§3：整个 shell 是槽位树，无 URL router）。taste.md 是**全局/项目级文件系统数据、非 per-session**，必须挂 **root 作用域**槽，不能挂 session 作用域的 `details`/`conversation`。
2. `shell.overlay`（list/root）正是全局模态/全屏面板的官方预留位，适合大段 md 阅读；入口用 `sidebar.footer.action`（list/root）一个图标，点开 overlay。
3. 备选 `settings.section` 加 tab（`{id:"taste", order:20}`）**模式最成熟、代码最少**（settings-general/plugins 双示范），但 settings 面板窄、不适合长文阅读，只适合当"分类/置信度一览"的轻量视图；可作为第二入口。

**数据访问（必须同步到方案里）**：浏览器无 fs，静态双面包的 client 半不能直接读 taste.md。标准路径是 **host 半注册一个 Remote**，client 半经 `ctx.remote.taste.*` 调用：
- host 半参考 `dsh-goal/lib/index.js` L422-437：`import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol"`，方法挂 `@Remote("methodName")` 装饰器（如 `@Remote("edit")`），成为 `remote.goals.edit`。
- dsh-taste host 半（当前 `inject = ["agents","commands","systemPrompt"]`，`export { Config, apply, inject, name }`）需新增一个 TypertRemoteService，暴露**只读**方法：`listSources()`（全局/项目/Command Code 分源）、`readTaste(pathOrKey)`、`categories()`、`confidence()/learningStatus()` 等。

**注册代码骨架（client 半 `lib/client.js`，手写即可）**：
```js
window.__ModuleLoader__.load({
  id: "@deepseek-ai/dsh-taste",
  factory: (require) => {
    const react = require("react");
    const jsx = require("react/jsx-runtime");
    const primitives = require("@deepseek-ai/dsh-client-ui-primitives");
    const inject = ["slots", "locale", "remote", "remote.taste", "layout"];
    const NS = "taste";
    function TasteTrigger(props) { /* 图标按钮，onClick -> 展开 overlay（用本地 state / ctx.layout.openDetails 或 overlay 内部状态） */ }
    function TastePanel(props) { /* 读 remote.taste.listSources() -> 分源/分类/置信度/学习状态表格 */ }
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh: {...}, en: {...} }), "taste: dict");
      ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
        name: "sidebar.footer.action", id: "taste", order: 100, locale: NS
      }, TasteTrigger));
      ctx.slots.inject("shell.overlay", () => ctx.slots.register({
        name: "shell.overlay", id: "taste-panel", order: 0, locale: NS
      }, TastePanel));
    }
    return { apply, inject };
  }
});
```
**package.json 增量**：
```json
"exports": { ".": "./lib/index.js", "./client": "./lib/client.js" },
"dsh": { "client": { "platform": "web", "inject": ["@deepseek-ai/dsh-client-runtime", "@deepseek-ai/dsh-client-locale"] } }
```
（`inject` 里列出 client bundle 依赖的**包名**；`external` 一般可空，因为只 `require` React/primitives 这些 seed word。）

---

## 6. 热更与缓存

### 结论
- **热更（无刷新）只在 `pnpm run dev:web`（或 tsdown/vite `--watch`）重写 bundle 文件时才发生**；本部署没有该 watcher，所以对 dsh-taste 而言，**改 `lib/client.js` → 浏览器刷新** 是最简单可靠的生效路径。
- 无 service worker、无内容 hash 缓存坑（client bundle 走 `no-cache` + 每次读盘）。

### 证据
**(a) HMR 链 = `dsh-client-hmr`（dev-only）**
- node 半 `lib/index.js`：`setInterval(pollWatches, pollIntervalMs=500)` 对每个 graph row 的 **bundle 文件**做 `statSync`（mtime+size），变化 → `ctx.clientModules.rebuilt(id)`（re-hash 出新 rev）→ SSE `/plugins/events` 广播 `{type:"rebuilt", id, rev}`（L96-110、L158-180）。**它 poll 的是构建产物，不是源码。**
- browser 半 `lib/client.js`：`new EventSource("/plugins/events")`，收 rebuilt → `modLoader.invalidate(id)` + `prefetch(id)` + 删旧 fiber + `removeOwnedStyles(id)` + `entry.refresh()` + `fiber.await()`（L35-56）。即「无刷新热替换」。
- `dsh-web-app/cordis.patch.yml` 明确：`client-hmr` 行「always mounted: it is idle until a rebuild watcher (pnpm run dev:web) actually rewrites client bundles」；同文件顶部还有 `hmr`（cordis-plugin-hmr）行 `disabled: true`（"TODO: Re-enable shared HMR for Web after its reload lifecycle is tested"）。
- `dsh-web-app/lib/index.js` L98（persona 原文）再次确认："client-plugin changes reload without a refresh **only while `pnpm run dev:web` is also running** from this same checkout to rebuild their bundles."

**(b) 浏览器刷新足够**
- `serveBundle` 每次请求 `readFile` 磁盘 + `"cache-control": "no-cache"`（`dsh-client-modules/lib/index.js` L480-485），URL 里的 `?rev=` 只作缓存破坏、不参与内容选择。
- HMR `rebuilt()` 会更新 `composed` 图，下次页面加载的 `__DSH_BOOT__` 带新 rev；即便**手动改 bundle 文件没走 `rebuilt()`**，`no-cache` + 每次读盘仍让刷新拿到新内容。

**(c) 缓存坑排查**
- dist 无 service worker（`dsh-web-frontend/dist/` 只有 `index.html + assets + manifest.webmanifest + favicon`）。
- Vite shell 资产有内容 hash（`index-ClqxG24t.js`），但那是 shell，与 client 插件无关。
- 唯一要注意的坑：官方 client-ui 包 `files` 只 ship 编译产物、`lib/client.js` 是 rolldown bundle（**没有 src**），所以「改 client.js」改的是编译产物；若要改 TS 源码需 checkout + 构建。**自装 dsh-taste 手写 `lib/client.js` 则无此问题。**

---

## 实现路径裁定（末尾结论）

1. **可行性成立**：无源码 checkout 环境下，dsh-taste 自装 client GUI 完全可行。发现机制只依赖三件事——dsh-taste 已被 `cordis.patch.yml` 装载为 host 条目（已满足）、package.json 补 `dsh.client` + `exports["./client"]`（待加）、`lib/client.js` 以 `window.__ModuleLoader__.load` 格式存在（待手写）。**无需 Vite/tsdown 构建、无需 `apps/web` checkout、无需 HMR watcher。**

2. **技术栈照抄官方**：React 18（`require("react")`/`require("react/jsx-runtime")`）+ `@deepseek-ai/dsh-client-ui-primitives` 图标/组件 + CSS 内联 `<style data-plugin>` + design token `--dsw-*`。

3. **挂载形态**：`sidebar.footer.action`（图标入口）+ `shell.overlay`（root 级全屏/模态查看面板）；`settings.section` 加 tab 作为轻量备选。数据经 host 半新增的 **TypertRemoteService Remote** 暴露（`ctx.remote.taste.*`）。

4. **改动清单**：① dsh-taste package.json 加 `exports["./client"]` + `dsh.client`；② 手写 `lib/client.js`（返回 `{apply, inject}`，inject 服务名 `["slots","locale","remote","remote.taste",...]`）；③ host 半加只读 Remote（`listSources/readTaste/…`）；④ `cp` 到 `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-taste`；⑤ 重启 `npx @deepseek-ai/dsh web`，刷新 `http://127.0.0.1:3080`。

5. **风险提示**：`exports` 字段一旦加入会改变该包的模块解析面（当前 dsh-taste 只有 `main`），需确认 host 半 `main` 入口仍可解析（建议 `exports` 同时保留 `"."`）；host 半当前 `inject` 无 `webServer`/`typert-registry`，注册 Remote 需要相应服务依赖（这是任务 B「host 半」要落地的细节）。
