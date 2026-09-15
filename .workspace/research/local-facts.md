# 本部署（DSH 0.1.1-rc.2）机制级核查记录

> 本文是主代理亲手复现的一手证据集，供 `workspace-plugins-deep-research.md` 引用。
> 全部命令于 2026-09-14 在本机执行，只读。

## A. 部署事实

| 项 | 值 | 证据 |
|---|---|---|
| DSH 元包 | `@deepseek-ai/dsh` **0.1.1-rc.2** | `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/package.json` |
| 子包版本 | 全系 **0.1.1-rc.2**（dsh-tools / dsh-fs / dsh-fs-local / dsh-fs-sandbox / dsh-llm / dsh-sandbox / dsh-sandbox-policy / dsh-subprocess / dsh-subprocess-local / dsh-timeout / dsh-system-prompt / dsh-host-directory-picker(-native) / dsh-client-locale / dsh-host-webserver / dsh-client-ui-renderer / dsh-invariants / dsh-session / dsh-agent / dsh-subagent / dsh-settings） | `.../dsh/node_modules/@deepseek-ai/*/package.json` 逐个读取 |
| cordis | **4.0.2** | 同上 |
| node | v22.23.2 | `node -v` |
| 活跃 profile | `web`（`~/.dsh/profiles/web/`） | `profiles/web/package.json` |
| profile 依赖 | `@deepseek-ai/dsh: ^0.1.1-rc.2`, `@deepseek-ai/cordis-plugin-group: ^1.0.1` | 同上 |
| 模块回退目录 | `~/.dsh/profiles/node_modules`（277 顶层项，其中 252 个 `@deepseek-ai/*`） | `ls` |
| 包管理器配置 | `nodeLinker: hoisted`、**`autoInstallPeers: false`** | `~/.dsh/profiles/web/pnpm-workspace.yaml` |

## B. 「dsh plugin」= pnpm 薄转发器（决定 peer 冲突的严重性）

证据：`/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/lib/plugin-9h8shc4d.js`

- `runPlugin()` 直接 `spawnSync("pnpm", args, { cwd: profileDir })`（第 ~96-108 行），
  **DSH 自身不做 peer 校验**，安装语义完全等于「在 profile 目录里跑 `pnpm add <spec>`」。
- 装完只做 `reconcilePlugins()`：把「解析得到且声明了 `dsh.bundle.patch` 的依赖」加入
  `dsh.profile.bundles` 层栈；普通库只打一行 warning。
- → **推论**：插件能否装、装后是否报错，取决于 pnpm 的策略，而本 profile 显式设了
  `autoInstallPeers: false`（不自动装 peer；pnpm 默认 `strict-peer-dependencies=false`）
  ⇒ **peer 版本不满足 ≈ 警告，不会安装失败**；
  **真正的门槛是运行期 API 是否存在**，而不是 peer 字面范围。

## C. semver 预发布规则实测（推翻上一轮结论的关键）

用本机 DSH 自带的 **semver 7.8.5**（npm 同源库）实测：

```
$ node -e "const s=require('.../dsh/node_modules/semver'); ..."
0.1.1-rc.2   ^0.1.0-rc.6       NOT satisfied     ← 上一轮标记为「✓」的地方
0.1.1-rc.2   ^0.1.0-rc.8       NOT satisfied
0.1.1-rc.2   ^0.1.1-rc.1       SATISFIED
0.1.1-rc.2   ^0.1.1-rc.2       SATISFIED
0.1.1-rc.2   ^0.1.2-rc.1       NOT satisfied
0.1.1-rc.2   ^0.1.5-rc.1       NOT satisfied
0.1.1-rc.2   >=0.1.1-rc.2 <0.2.0   SATISFIED
0.1.1-rc.2   >=0.1.0-rc.6 <0.2.0   NOT satisfied
0.1.1-rc.2   ^0.1.0                NOT satisfied
0.1.1-rc.2   *                     NOT satisfied   ← 预发布版本的 `*` 也不满足
0.1.1-rc.2   ^0.1.0-rc.6 || ^0.1.1-rc.2   SATISFIED
4.0.2        ^4.0.1            SATISFIED
3.18.2       ^3.18.1           SATISFIED
Range('^0.1.0-rc.6').range = '>=0.1.0-rc.6 <0.2.0-0'
Range('^0.1.1-rc.2').range = '>=0.1.1-rc.2 <0.2.0-0'
intersects('^0.1.0-rc.6','0.1.1-rc.2') = false
```

**规则**：带预发布标签的版本只有在「比较器集合中存在**同一 [major,minor,patch] 元组**且带预发布标签的比较器」时才可能被满足。
`^0.1.0-rc.6` 的元组是 `0.1.0`/`0.2.0`，而本部署是 `0.1.1-rc.2`（元组 `0.1.1`）⇒ **不满足**。

**结论（对选型的影响）**：
1. 上一轮报告里「peer ^0.1.0-rc.6 ✓ 本部署」的判定**系统性错误**（涉及 `@dsh-ssh/dsh-ssh`、`dsh-ssh`(UynajGI)、`dsh-remote` 等一大批）。
2. 但结合 §B，这在**本 profile 下只降级为 pnpm 警告**，不阻断安装；因此结论应从
   「peer 越界 ⇒ 不能用」修正为「peer 越界 ⇒ 无版本契约保护，必须逐 API 核验运行期兼容」。
3. 唯一真正「peer 满足」的写法是 `^0.1.1-rc.x` / `>=0.1.1-rc.2 <0.2.0`。

## D. `dsh-client-ui-slots` / `dsh-client-ui-primitives` 悬空真相（障碍复核）

### D1 现象
```
~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-slots
   -> /home/CNS2026495165/.npm/_npx/1e7f6d9597241db0/node_modules/@deepseek-ai/dsh-client-ui-slots   (DANGLING)
~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-primitives
   -> /home/CNS2026495165/.npm/_npx/1e7f6d9597241db0/node_modules/@deepseek-ai/dsh-client-ui-primitives (DANGLING)
```
- npx 缓存目录已被清理 ⇒ 悬空。`@deepseek-ai/*` 共 252 项，其中 **52 项悬空**（另 200 项真实指向 bundled dsh 的 node_modules）。
- 52 项悬空名单（节选）：`dsh-client-ui-slots`、`dsh-client-ui-primitives`、**`dsh-client-ui-sidebar-right`**、
  `dsh-client-ui-chat`、`dsh-client-ui-approval`、`dsh-client-ui-session`、`dsh-client-web`、`dsh-acp`、`dsh-sdk-*`、
  `dsh-session-format-*`、`dsh-util-*`、`dsh-webhook*`、`dsh-hooks-*`、`dsh-http-proxy`、`dsh-web-fetch-http`、
  `dsh-deepseek-llm-api-extensions`、`node-addon-system` 等。
- → **这批悬空名是「另一条 DSH 版本线（npx 缓存里那份）」的指纹**：它们是 0.1.1-rc.2 打包树里**没有**的包。
  其中 `dsh-client-ui-sidebar-right` 正是 `dsh-better-sidebar@0.19.x` 客户端注入所需的包。

### D2 这两个包在 npm 上有没有 0.1.1-rc.2？
**有，可安装。** registry 实测：

| 包 | 版本数 | dist-tags | `0.1.1-rc.2` 发布时间 | license |
|---|---|---|---|---|
| `@deepseek-ai/dsh-client-ui-slots` | 21 (0.0.1-rc.1 … 0.1.5-rc.2) | `latest=0.0.1-rc.1`、`next=0.1.5-rc.2` | 2026-08-21T12:42:49Z | MIT |
| `@deepseek-ai/dsh-client-ui-primitives` | 21 (同上) | `latest=0.0.1-rc.1`、`next=0.1.5-rc.2` | 2026-08-21T12:42:58Z | MIT |

⚠️ **坑**：两包 `dist-tags.latest` 都停在 `0.0.1-rc.1`（BSD-3-Clause 老版），
`pnpm add @deepseek-ai/dsh-client-ui-slots` **不带版本会装到 0.0.1-rc.1**。必须显式 `@0.1.1-rc.2`。
⚠️ `primitives@0.1.1-rc.2` 带 **20 个运行时依赖**（react/react-dom/clsx/shiki/katex/anser/micromark-/mdast- 全家），
这正是 `~/.dsh/profiles/node_modules` 里那 162 个悬空项的来源。

### D3 它们**是否需要**补齐？——客户端侧其实由 web shell 内置提供
证据 1：`.../dsh-web-frontend/dist/assets/index-ClqxG24t.js` 内的**平台种子表**：
```js
function Jd(){return{
  react:…, "react/jsx-runtime":…, "react-dom":…, "react-dom/client":…,
  "@deepseek-ai/cordis":…,
  "@deepseek-ai/dsh-client-ui-slots":g6,
  "@deepseek-ai/dsh-client-ui-primitives":Kd
}}
```
（该文件中 `@deepseek-ai/dsh-client-ui-slots` / `-primitives` 各只出现 1 次，即此表；shell 自身不 `__ModuleLoader__.load` 任何模块。）

证据 2：客户端 loader 的解析失败文案（`dsh-client-modules/lib/client.js:259`）：
> `require("<spec>") missed the module table — not a platform seed word, not a materialized module, and no registered package factory`

⇒ **`slots` 与 `primitives` 是 web shell 的「平台种子词」，任何插件 client bundle 在浏览器里 `require()` 它们都能命中**，
与 node_modules 是否存在无关。**当前悬空不影响客户端 UI 运行。**

证据 3（对照实例）：本地插件 `dsh-btw` 的 `lib/client.js` 第 9 行真实 `require("@deepseek-ai/dsh-client-ui-primitives")`，
而它**自带** `dsh-btw/node_modules/@deepseek-ai/dsh-client-ui-primitives@0.1.1-rc.2`（真实目录，非链接，MIT）
——自带副本只为 **TypeScript 类型检查/构建**（`src/client/*.tsx` 里 `import { Button } from '@deepseek-ai/dsh-client-ui-primitives'`），
运行期并不需要。

### D4 host 侧何时才会真正用到这两个包？
`dsh-client-modules/lib/index.js`（host 半）：
```js
const require = createRequire(ctx.baseUrl);          // baseUrl = profile 目录
this.resolvePkgJson = (spec) => require.resolve(`${spec}/package.json`);
...
resolveMeta(pkgName) { try { pkgPath = this.resolvePkgJson(pkgName) } catch { return null } ... }
processOne(entryName) { ... const meta = this.resolveMeta(entryName); if (meta === null) return false; ... }
```
- 只对 **cordis loader entry 的名字**（第 429 行）调用 `resolveMeta`；解析失败 → `return null` → 该行**被静默跳过**（客户端 UI 不出现），**不报错、不阻断启动**。
- `dsh.client.inject` 只作为元数据透传给浏览器（`graphRow` 的 `inject` 字段，第 157 行），host **不解析** inject 列表。
- 实测：从 profile 锚点解析
  ```
  OK    @deepseek-ai/dsh-client-ui-layout  -> .../dsh/node_modules/...
  OK    @deepseek-ai/dsh-tools              -> ...
  FAIL  @deepseek-ai/dsh-client-ui-primitives -> MODULE_NOT_FOUND
  FAIL  @deepseek-ai/dsh-client-ui-slots      -> MODULE_NOT_FOUND
  FAIL  @deepseek-ai/dsh-client-ui-sidebar-right -> MODULE_NOT_FOUND
  ```
⇒ **只有当某个插件把这两个包名本身当作 cordis entry 时（极罕见），或插件 host 半 `import` 它们时，才需要补齐**；
常规「插件 client bundle 里 require 它们」的场景**不需要**。

### D5 如果要补齐，怎么做（本机已有可用素材）
1. **最干净**：`cd ~/.dsh/profiles/web && pnpm add @deepseek-ai/dsh-client-ui-slots@0.1.1-rc.2 @deepseek-ai/dsh-client-ui-primitives@0.1.1-rc.2`
   （注意 profile 配置了 `autoInstallPeers:false`，primitives 的 20 个依赖会被正常装入；如要避免污染 profile 依赖，见下。）
2. **零网络（本机已有实物）**：`dsh-btw` 自带 **0.1.1-rc.2 原版**：
   `/home/CNS2026495165/dsh/dsh-btw/node_modules/@deepseek-ai/dsh-client-ui-{slots,primitives}/`（真实目录，MIT）。
   可 `cp -r` 覆盖 `~/.dsh/profiles/node_modules/@deepseek-ai/` 下的两个悬空软链，
   并按需复用 `dsh-btw/node_modules` 内已存在的 20 个依赖（它们与 profile 里那 162 个悬空项同名）。
3. **最稳妥（推荐）**：仅当确有必要时补；否则**保留现状即可**（不影响当前 GUI 与客户端插件），
   把「悬空清单」当作插件安装前的核对清单使用。

## E. 需要修正/补充的其它本地事实

- `~/.dsh/profiles/web2/` 是 **0.1.5-rc.2 升级尝试的残留 profile**，已被部署方标记 `DEPRECATED.md`（勿启用）。
  但它是**只读参照金矿**：`web2/node_modules/@deepseek-ai/dsh` = **0.1.5-rc.2**，
  且其中 `dsh-client-ui-sidebar-right` = **0.1.5-rc.2（真实存在）**，可用来对照「0.1.5 线比 rc.2 多了什么包」。
  （注意：web2/node_modules 里 `slots`/`primitives` 同样 ABSENT ⇒ 0.1.5 线也不需要它们做 node 包。）
- `@deepseek-ai/dsh` 元包的 dependencies 在 **0.1.1-rc.2 / 0.1.2-rc.1 / 0.1.5-rc.1 / 0.1.5-rc.2 四个版本里都不含**
  `dsh-client-ui-slots`、`dsh-client-ui-primitives`、`dsh-client-ui-layout`、`dsh-client-ui-sidebar`、
  `dsh-client-ui-sidebar-right`、`dsh-host-webserver`、`dsh-credentials`（后两者由 `dsh-web-app` 等间接引入）。
  ⇒ 不能通过「升级 DSH 元包」来补齐这两个包，必须显式安装。
- `~/.dsh/install-plugins.sh` 的存在说明本部署的**本地插件安装惯例**是
  「把插件真实目录拷进 `~/.dsh/profiles/node_modules/@deepseek-ai/`（该目录不会被 npx 重装清掉）」，
  而非走 `dsh plugin add`。选型/自研落地时应沿用该惯例。
