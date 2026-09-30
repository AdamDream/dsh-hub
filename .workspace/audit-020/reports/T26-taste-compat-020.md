# T26 — taste 子系统在 0.1.7 → 0.2.0 的变化与兼容性审计

- 审计轨道：T26（只读审计，结论与方案，不改产品代码）
- 审计时刻：2026-09-29（本轮实测；所有结论绑定本轮命令输出与哈希）
- 审计基线：现役 3080 = `@deepseek-ai/dsh@0.1.1-rc.2`、隔离 3097 = `0.1.7-rc.2`、迁移目标 `0.2.0-rc.1`
- 写入范围：仅 `.workspace/audit-020/**`（详见 §7 副作用申明）

---

## 1. 结论摘要

| # | 结论 | 判定 |
|---|---|---|
| C1 | **0.2.0 不发布 `@deepseek-ai/dsh-taste`**，历史上也从未发布过任何版本 | **确认** |
| C2 | taste **不是官方包**，而是**私有本地插件**（借用了 `@deepseek-ai/` 作用域命名），**不需要也无法"单独安装"** | **确认（修正协调者前提）** |
| C3 | 0.2.0 官方依赖闭包（CLI `package.json` 92 项 + 全量安装 289 个 `@deepseek-ai/*`）中**无 taste**，故不存在"0.1.7→0.2.0 的 dsh-taste 包级差异"——**唯一存在的 taste 制品是本地 0.1.0，两端同一份** | **确认** |
| C4 | 历史缺陷「5 个 `Icon*Outline16` 退役图标」**在 0.2.0 依然存在，且不是 0.2.0 引入的**：断点在 **0.1.1→0.1.7**，0.1.7 与 0.2.0 的图标清单**逐名完全相同** | **确认（修正归因）** |
| C5 | 0.1.7→0.2.0 对 taste 的**服务端契约、客户端槽位、模块种子、locale API、存储格式全部无破坏性变化** | **确认** |
| C6 | 工作区 `dsh-taste/` 是**受 git 跟踪的权威源码**，部署件是它的**逐字节快照**（31/31 文件同哈希），**无未回流改动** | **确认** |
| C7 | 迁移方式：**原样复制（cp -a）为主 + 1 个必需的图标改造单元（生产代码）+ 2 个可选收尾单元**；**无需源码重建** | **判定** |
| C8 | 协调者前提「底层 markdown 数据文件保持英文」**与实测不符**：现网数据文件**已是中文单轨**，英文展示层已退役 | **修正前提（见 §4.4）** |
| C9 | 在本轮实测环境中，taste 自测套件在 0.2.0 上 **215/218 通过**，与 0.1.1 基线**完全一致**；0.1.7/0.2.0 上多出的失败**全部来自测试夹具漂移**，非产品缺陷、非运行时缺陷 | **确认** |
| C10 | **决定性归属证据**：`@deepseek-ai/dsh-taste` 在 **0.1.7 与 0.2.0 两棵官方对照树上均 ABSENT**，从未进入任何官方安装闭包 → 它连"官方包"都不是，更无 0.2.0 版 | **确认（§8.2）** |
| C11 | taste 的 `lib/` 口径 0.1.7 vs 0.2.0 差异：**N/A，两侧均无对照物**（`churn-lib-017-020.txt` 中亦无条目） | **确认（§8.2）** |
| C12 | **两项 0.2.0 新增的真实 UI 影响面**（0.1.7 无）：① `dsh-client-ui-plugin-manager` 新增占用 `shell.overlay`（**严重度低**，且该槽位**在 0.1.7 就已是多占用者的 list 槽位**——`dsh-client-ui-workspace` 早已在其中注册重命名/归档对话框——故非新争用模型；toast 仅刷新失败时出现、`pointer-events:none` 不拦截点击，**建议不改**）；② 官方新增 `--dsh-frame-overlay-top` 约定并把 `--dsh-frame-top-clearance` 扩到 Windows 标题栏，taste 面板硬编码 `top:12px` 未跟随（**严重度低**，Linux 零影响，列可选单元 U5） | **确认（§8.4）** |
| C13 | 主题 token 与 primitives 导出面在 0.1.7→0.2.0 均为**零删除、纯增量**（token 395→400 加 5 删 0；导出 279→280 加 1 删 0）；taste 使用的 14 个 `--dsw-*` token 在 0.2.0 **14/14 全部仍有定义** | **确认（§8.4-3）** |

> **依据分级（全文适用）**：**A 类 = `lib` 哈希全等推定未变（未读源码，仅用于缩小排查面）**；**B 类 = 0.2.0 源码实读确认（唯一可支撑改造结论的依据）**。详见 §8.0；§2.5.4 表已按此标注。

**一句话裁决**：taste 的 0.2.0 迁移**不涉及上游包差异**（因为上游根本没有这个包），风险集中在**客户端图标命名**这一个真实改造点；**可以直接复制部署件，加一处图标替换即可**。
**协调者插播校正后追加**：判定口径已收窄到 `lib/`，图标/槽位核验已集中到 5 个真正有改动的客户端包，并**新识别出 2 项 0.2.0 新增的影响面（均低严重度、均不影响 Linux）** —— 全部结论见 §8。

---

## 2. 证据

### 2.1 包身份与可获取性（结论 C1 / C2）

**2.1.1 公开 npm registry 查询（含可达性对照）**

```
registry = https://registry.npmjs.org/   (npm 10.9.8, node v22.23.2)
```

| 包名 | `npm view <pkg> version` 结果 |
|---|---|
| `@deepseek-ai/dsh-home-paths`（官方对照） | `0.0.1-rc.3` ✅ |
| `@deepseek-ai/dsh-client-ui-primitives`（官方对照） | `0.0.1-rc.1` ✅ |
| `@deepseek-ai/dsh-subagent`（官方对照） | `0.0.1-rc.1` ✅ |
| **`@deepseek-ai/dsh-taste`** | **`npm error code E404 — Not Found`** ❌ |
| `@deepseek-ai/dsh-usage`（同为私有件） | E404 ❌ |
| `@local/dsh-btw`（私有作用域） | E404 ❌ |

- `npm view @deepseek-ai/dsh-taste versions --json` → `E404`，「`'@deepseek-ai/dsh-taste@*' is not in this registry`」
- `npm view @deepseek-ai/dsh-taste dist-tags --json` → `E404`
- 官方对照包的 `dist-tags` 正常返回 `{"latest":"0.0.1-rc.3","alpha":"0.1.7-alpha.2","next":"0.2.0-rc.1"}`
  → **registry 可达、查询有效**，故 taste 的 404 是**真实的不存在**，而非网络/鉴权故障。

> **结论**：`@deepseek-ai/dsh-taste` **任何版本都未发布**。因此"0.2.0 是否仍发布该包、版本号是多少、是否需要单独安装"的回答是：
> **不发布；无版本号；不存在"单独安装"这一选项**。该名字是私有本地件借用了 `@deepseek-ai/` 作用域。

**2.1.2 0.2.0 官方依赖闭包中无 taste**

- `.workspace/dsh-020-pkg/x/package/package.json`（`@deepseek-ai/dsh@0.2.0-rc.1`）中 `grep -i taste` → **0 命中**
- 0.2.0 全量隔离安装树 `.workspace/iso-020/npm-global/node_modules/@deepseek-ai/` 共 **289** 个包 → `ls -d *taste*` → **(no taste)**
- 对照：`@deepseek-ai/dsh-taste` 在 `~/.dsh/profiles/node_modules/@deepseek-ai/` 与 `~/.dsh-017/profiles/node_modules/@deepseek-ai/` 中均为**真实目录**（非符号链接），是人工放置的私有件

**2.1.3 现网部署件版本**

`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-taste/package.json` 与 `~/.dsh-017/...` 与工作区源码三者**同文件同哈希**：

```json
{ "name": "@deepseek-ai/dsh-taste", "version": "0.1.0", "type": "module",
  "main": "lib/index.js",
  "exports": { ".": "./lib/index.js", "./client": "./lib/client.js", "./package.json": "./package.json" },
  "dsh": { "client": { "platform": "web",
      "inject": ["@deepseek-ai/dsh-client-runtime","@deepseek-ai/dsh-client-locale","@deepseek-ai/dsh-client-connection"] } },
  "peerDependencies": { "@deepseek-ai/cordis": "^4.0.1",
      "@deepseek-ai/dsh-agent": "^0.1.1-rc.2", "@deepseek-ai/dsh-atomic-write": "^0.1.1-rc.2",
      "@deepseek-ai/dsh-client-connection": "^0.1.1-rc.2", "@deepseek-ai/dsh-home-paths": "^0.1.1-rc.2",
      "@deepseek-ai/dsh-llm": "^0.1.1-rc.2", "@deepseek-ai/dsh-subagent": "^0.1.1-rc.2",
      "@deepseek-ai/dsh-tools": "^0.1.1-rc.2", "@deepseek-ai/schemastery": "^3.18.1" } }
```

版本恒为 **`0.1.0`**（自有版本号，与 DSH 版本线无关）。

**2.1.4 `npm pack` 规范制品（本轮实测）**

在 `.workspace/audit-020/t26/dsh-taste-src`（工作区源码的副本）执行 `npm pack`：

| 项 | 值 |
|---|---|
| tarball | `deepseek-ai-dsh-taste-0.1.0.tgz` |
| sha256 | `4072ca8e940cc7151291a0ab0f00420f344d014012ed4144efd6d6052d27feba` |
| npm shasum | `46fa525d3c3529ede244a98357326187a5fb73c3` |
| 文件数 | **31** |

内容清单（`tar tzf`）为 13 个 `lib/*.js` + 11 个 `test/*.test.js` + `package.json` + `config.example.json` + `README.md` + 4 个 `REVIEW*.md` + `scripts/migrate-chinese-single-track.mjs`。

### 2.2 源码锚点（文件 + 行号）

工作区源码 `/home/CNS2026495165/dsh/dsh-taste/`（3815 行）：

| 关注点 | 锚点 |
|---|---|
| 插件名 | `lib/index.js:54` `const name = "taste";` |
| 服务端 inject | `lib/index.js:57` `const inject = ["agents","commands","systemPrompt","connection"];` |
| 声明式 Config schema | `lib/index.js:60` `const Config = z.object({ … })`（learningEnabled / injection{enabled,maxChars,includeSubagents,minConfidence} / observer{modelMode,provider,model,maxInputChars,timeoutMs,maxTurns} / storage{categoriesEnabled}） |
| 导出面 | `lib/index.js:697` `export { Config, apply, inject, name };` |
| 运行时配置文件名 | `lib/config.js:12` 与 `lib/index.js:103`（镜像常量，注释要求同步）`CONFIG_FILENAME = "config.json"` |
| RPC 桥 | `lib/bridge.js:287` `ctx.connection.rpc.handle("/taste", handle, { authority: "loopback" })` |
| 客户端 inject | `lib/client.js:761` `const inject = ["slots","locale","connection","sessions"];` |
| 自建 store | `lib/client.js:142` `function createTasteStore()` |
| locale 注册 | `lib/client.js:763` `ctx.locale.register(NS, { zh, en })`，`NS = "taste"`（`lib/client.js:32`） |
| 槽位注册 | `lib/client.js:772` `sidebar.footer.action`（id `taste`, order 90）；`lib/client.js:781` `shell.overlay`（id `taste-panel`, order 100） |
| **退役图标使用点（5 处）** | `lib/client.js:298` `IconTrashOutline16`（size 12）<br>`lib/client.js:383` `IconPersonalizationOutline16`（size wide?14:18）<br>`lib/client.js:706` `IconRefreshOutline16`（size 14）<br>`lib/client.js:707` `IconSettingsOutline16`（size 14）<br>`lib/client.js:708` `IconCloseOutline16`（size 14） |
| 文件白名单 | `lib/storage.js:182-191`：仅 `taste.md` 或 `{category}/taste.md` |

### 2.3 哈希对账（结论 C6）

聚合口径：`find . -type f | sort | xargs sha256sum | sha256sum`（31 个文件、相对路径排序、内容级联哈希）。

| 副本 | 聚合 sha256 | 文件数 |
|---|---|---|
| 工作区 `/home/CNS2026495165/dsh/dsh-taste/` | `fcf78771a07b3ca13e1e3db6a58311f71f780f87394cddf8644dc927673a25f4` | 31 |
| 现役 `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-taste/` | `fcf78771a07b3ca13e1e3db6a58311f71f780f87394cddf8644dc927673a25f4` | 31 |
| 隔离 `~/.dsh-017/profiles/node_modules/@deepseek-ai/dsh-taste/` | `fcf78771a07b3ca13e1e3db6a58311f71f780f87394cddf8644dc927673a25f4` | 31 |
| 历史归档 `~/.dsh/profiles-archive/web2-20260915-105429/...` | `39eb143e2e2d42fdbae29546757ddbbe077890455835e5bfa65d7ff3099564bf`（**不同，旧修订**） | 31 |

- 三处**逐文件 md5 全等**（31/31 `SAME`），且**文件集合完全相同**（`diff` 文件清单无差异 → **部署目录无"仅部署"多余文件**，无 `translate.js` 等遗留件）
- git：`dsh-taste/` **受跟踪 31 个文件**，`git status --short -- dsh-taste/` 输出 **0 行（干净）**；最后一次提交 `88c68288f94abc76af4c62c8e709c889fe2dccc8`（2026-09-14）
- 历史 `REVIEW-unified-chinese-taste.md` 记载的同步方式为 `rsync -a /home/…/dsh-taste/ → ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-taste/`，与本轮哈希全等**互相印证**

### 2.4 运行时依赖解析链（证明 taste 装在哪、靠什么解析）

- `~/.dsh/profiles/node_modules/@deepseek-ai/` 中 **`dsh-client-ui-primitives`、`dsh-client-ui-slots` 是失效符号链接**，指向已删除的 npx 缓存 `~/.npm/_npx/1e7f6d9597241db0/dsh…`（`-e` 测试失败，`readlink -f` 为空）→ 该扁平回退目录**已部分腐烂**，但**不影响 taste**：浏览器侧 `dsh-client-ui-primitives` 是**壳层种子词**（见 §2.5），不走 Node 解析。
- 服务端半边的解析依赖 `~/.dsh/profiles/node_modules/@deepseek-ai/*` 的真实目录（`schemastery`、`dsh-agent`、`dsh-tools` 等）。

### 2.5 0.1.7 vs 0.2.0 关键契约逐项核对

**2.5.1 浏览器「种子词」表（`staticModules`）——taste 客户端 `require` 的唯一来源**

从各版本 `dsh-web-frontend/dist/assets/index-*.js` 提取的 `return{react:…}` 字面量：

| 版本 | 种子词集合 | 数量 |
|---|---|---|
| 0.1.1-rc.2 | `react`, `react/jsx-runtime`, `react-dom`, `react-dom/client`, `@deepseek-ai/cordis`, `@deepseek-ai/dsh-client-ui-slots`, `@deepseek-ai/dsh-client-ui-primitives` | 7 |
| 0.1.7-rc.2 | 上述 7 + `@deepseek-ai/dsh-client-store`, `@deepseek-ai/dsh-client-ui-dockkit` | **9** |
| 0.2.0-rc.1 | 同上 9 项，**逐字相同** | **9** |

→ taste client 的 `require("@deepseek-ai/dsh-client-ui-primitives")`（`lib/client.js:9`）在 **0.1.7 与 0.2.0 都命中种子词**，可解析；**0.1.7→0.2.0 无变化**。

**2.5.2 槽位声明**

`grep` 两个版本 `dsh-client-ui-layout` / `dsh-client-ui-sidebar`：

- 0.1.7 与 0.2.0 **同样声明** `"shell.overlay"`、`"sidebar.footer.action"`（两版本槽位名单逐字相同：`shell.leading`、`shell.overlay`、`sidebar.brand.mark`、`sidebar.brand.name`、`sidebar.footer.action`、`sidebar.left.toggle`、`sidebar.panellist`、`sidebar.settings`、`sidebar.toggle.badge`、`sidebar.workspaces`）
- 两包 `lib/client.js` 的实际差异仅 19 行 / 11 行，内容为：**版本字符串**（`0.1.7-rc.2-c127551` → `0.2.0-rc.1-62962ee`）、**一条埋点调用**（`sidebar_menu_click`）、**Windows 标题栏 CSS 变量新增**（`--dsh-frame-overlay-top` 等）→ **与 taste 无关**

**2.5.3 客户端模块装载器契约**

`@deepseek-ai/dsh-client-modules`（`lib/client.js` + `lib/index.js`，10 个文件）在 0.1.7 与 0.2.0 之间 **逐文件哈希全等（diff=0）**。清单校验 `parseDshClient`（`lib/index.js:61-78`）要求 `dsh.client.platform` 为字符串、`inject`/`external` 为字符串数组、`exports["./client"]` 存在 —— taste 的 `package.json` **全部满足**。

- 宿主侧 `orderByModuleGraph`（`lib/index.js:415-440`）**只校验 `external`，不校验 `inject`**
- 客户端侧 `arriveGraphRow`（`lib/client.js:646-663`）对**解析不到的 inject 依赖直接跳过**（`if (dependency !== void 0)`）
  → taste 中**已失效的 `@deepseek-ai/dsh-client-runtime`**（该包**仅 0.1.1 存在**，0.1.7/0.2.0 均无）**不会导致报错**，属**陈旧声明**而非破坏点（可作为可选清理项，见 §6 U3）

**2.5.4 taste 直接依赖包 0.1.7→0.2.0 逐文件哈希对比**

> **依据分级**：本表"全等"行一律为 **A 类（`lib` 哈希全等推定未变，未读源码）**，仅用于**缩小排查面**；"CHANGED"行的结论已由 **B 类（0.2.0 源码实读）** 复核，见 §2.5.2 与 §8.3。
> 口径：`find lib -type f | sort | xargs md5sum`，与协调者 `churn-lib-017-020.txt` 的 `lib/` 口径一致（逐条对照见 §8.1-②）。

| 包 | 0.1.7 → 0.2.0 | lib 文件数 | 差异文件数 | 判定 |
|---|---|---|---|---|
| `@deepseek-ai/schemastery` | 3.18.4 → 3.18.4 | 4 | 0 | 全等 |
| `@deepseek-ai/dsh-home-paths` | 0.1.7 → 0.2.0 | 2 | 0 | 全等 |
| `@deepseek-ai/dsh-agent` | 0.1.7 → 0.2.0 | 20 | 0 | 全等 |
| `@deepseek-ai/dsh-system-prompt` | 0.1.7 → 0.2.0 | 4 | 0 | 全等 |
| `@deepseek-ai/dsh-atomic-write` | 0.1.7 → 0.2.0 | 2 | 0 | 全等 |
| `@deepseek-ai/dsh-llm` | 0.1.7 → 0.2.0 | 34 | 0 | 全等 |
| `@deepseek-ai/dsh-tools` | 0.1.7 → 0.2.0 | 22 | 0 | 全等 |
| `@deepseek-ai/cordis` | 4.0.4 → 4.0.4 | 19 | 0 | 全等 |
| `@deepseek-ai/dsh-commands` | 0.1.7 → 0.2.0 | 14 | 1（`lib/typert.host.js`，字节数相同） | 非语义 |
| `@deepseek-ai/dsh-subagent` | 0.1.7 → 0.2.0 | 54 | 1（`lib/typert.host.js`，字节数相同） | 非语义 |
| `@deepseek-ai/dsh-client-ui-slots` | 0.1.7 → 0.2.0 | 4 | 0 | 全等 |
| `@deepseek-ai/dsh-client-locale` | 0.1.7 → 0.2.0 | 12 | 0 | 全等 |
| `@deepseek-ai/dsh-client-connection` | 0.1.7 → 0.2.0 | 18 | 0 | 全等 |
| `@deepseek-ai/dsh-client-store` | 0.1.7 → 0.2.0 | 3 | 0 | 全等 |
| `@deepseek-ai/dsh-client-modules` | 0.1.7 → 0.2.0 | 10 | 0 | 全等 |
| `@deepseek-ai/dsh-client-ui-primitives` | 0.1.7 → 0.2.0 | 123 | 13 | 见下 |
| `@deepseek-ai/dsh-client-ui-sidebar` | 0.1.7 → 0.2.0 | 8 | 2 | 见 §2.5.2 |
| `@deepseek-ai/dsh-client-ui-layout` | 0.1.7 → 0.2.0 | 11 | 1 | 见 §2.5.2 |

`dsh-client-ui-primitives` 的 13 个差异文件为：`lib/index.js`、6 个 `*.module.css`（Menu/Modal/Switch/TextShimmer/Tooltip 等）、6 个 `lib/types/*.d.ts`。
**其类型导出面差异仅 1 行新增**：

```diff
--- 0.1.7/lib/types/index.d.ts
+++ 0.2.0/lib/types/index.d.ts
@@ -54,1 +55,1 @@
+ export { pointerModality } from './input-modality.ts';
```

→ **纯增量，无删除、无重命名**。

**2.5.5 CLI / profile 引导（部署路径不变性）**

`@deepseek-ai/dsh` 的 `lib/` 关键文件在 0.1.7 与 0.2.0 之间 **逐文件哈希全等**：`profile-boot.js`、`profile-boot-BZ2ZjNWi.js`、`bin.js`、`plugin-DkYIj96-.js`、`dump-config-BEDI-dNY.js`。
加载器插件版本亦相同：`cordis-plugin-loader 1.0.5`、`cordis-plugin-include 1.0.9`、`cordis-plugin-timer 1.1.6`、`cordis-plugin-group 1.0.4`。

→ `cordis.patch.yml` 的 `- insert: - id: taste  name: '@deepseek-ai/dsh-taste'` 挂载方式、以及 `~/.dsh/profiles/node_modules` 扁平回退解析，**在 0.2.0 完全沿用**。

**2.5.6 客户端 `dsh.client` 清单契约**

taste `package.json` 的 `dsh.client` = `{ platform: "web", inject: [3 项] }`；`exports["./client"] = "./lib/client.js"` 存在 → 通过 0.2.0 的 `parseDshClient` 与 `resolveMeta`（`dsh-client-modules/lib/index.js:701-733`）校验。**0.1.7 与 0.2.0 校验逻辑逐字节相同。**

---

## 3. 0.1.7 → 0.2.0 差异（taste 视角）

### 3.1 包级差异：不存在

- 上游**从未发布** `@deepseek-ai/dsh-taste`（§2.1.1），0.2.0 依赖闭包与全量安装树中**无它**（§2.1.2）
- 因此 **"npm pack 对比 0.1.7 → 0.2.0 的 dsh-taste"这一命题无对象**：不存在 0.2.0 版 taste 制品可比
- 唯一存在的 taste 制品版本恒为 **0.1.0**，且 `~/.dsh`（0.1.1 代）与 `~/.dsh-017`（0.1.7 代）**同一份**（§2.3）

### 3.2 行为级差异：仅图标一处（且非 0.2.0 引入）

见 §4.1。0.1.7 → 0.2.0 之间**图标清单零变化**，故 **0.2.0 相对 0.1.7 对 taste 的行为级差异 = 无**。

### 3.3 非破坏性差异（记录备查）

| 项 | 0.1.7 | 0.2.0 | 对 taste 影响 |
|---|---|---|---|
| primitives 类型导出面 | — | +`pointerModality` | 无（纯增量） |
| `dsh-client-ui-layout` CSS | — | +`--dsh-frame-overlay-top`（Windows 标题栏） | **低**：taste 面板自用 `position:fixed; top:12px`，未跟随官方 overlay 顶部变量；在 Windows 标题栏场景可能压到标题栏。Linux 无关 |
| sidebar 埋点 | — | +`sidebar_menu_click` | 无 |
| `dsh.client.external` 机制 | 存在 | 逐字相同 | 无（taste 未声明 `external`，靠种子词） |

### 3.4 陈旧声明（非破坏）

`dsh.client.inject` 首项 `@deepseek-ai/dsh-client-runtime` **仅 0.1.1-rc.2 存在**，0.1.7 与 0.2.0 均无此包 → 该 inject 项自 0.1.7 起**已是死条目**，被装载器静默跳过（§2.5.3），**不报错、不影响功能**。

---

## 4. 历史缺陷点复核结果

> 纪律：历史坑只作"待核查点"，下列每条均为**本轮实测**结论。

### 4.1 图标集合 `Icon*Outline16` —— **仍然退役，但归因修正**

**实测方法**：从各版本 `@deepseek-ai/dsh-client-ui-primitives/lib/index.js` 的 `export { … }` 语句解析导出名集合（程序化判定，非字符串猜测）。

| 导出名 | 0.1.1-rc.2 | 0.1.7-rc.2 | 0.2.0-rc.1 |
|---|---|---|---|
| `IconTrashOutline16` | ✅ 存在 | ❌ **不存在** | ❌ **不存在** |
| `IconPersonalizationOutline16` | ✅ | ❌ | ❌ |
| `IconRefreshOutline16` | ✅ | ❌ | ❌ |
| `IconSettingsOutline16` | ✅ | ❌ | ❌ |
| `IconCloseOutline16` | ✅ | ❌ | ❌ |
| 替代品 `Icon{Trash,Personalization,Refresh,Settings,Close}Outline{Regular,Medium}` | ❌ 不存在 | ✅ **全部存在** | ✅ **全部存在** |
| 该包导出总数 | 104 | 279 | 280 |
| `Icon*16` 命名总数 | 48 | **0** | **0** |

**关键归因修正**：
- 断点在 **0.1.1-rc.2 → 0.1.7-rc.2**，**不是** 0.1.7 → 0.2.0。
- 0.1.7 与 0.2.0 的 `Icon*` 名字集合**逐名对比差异为 0**（`comm` 双向 0 行）。
- ⇒ **0.1.7 隔离实例（3097）上的 taste 客户端自 0.1.7 起就已引用 5 个不存在的导出**（0.2.0 不是新问题，是**继承**问题）。
- ⇒ 该缺陷**必须在本次迁移中一并修掉**，否则 0.2.0 交付态与 0.1.7 现状同样是坏的。

**替代品签名兼容性**（`grep -A3` 逐版本比对）：

```js
// 0.1.7 与 0.2.0 逐字节相同
const IconTrashOutlineArtwork = ({ size = 16, className, strokeWidth }) => jsxs("svg", { width: size, height: size, … })
const IconTrashOutlineRegular = (props) => jsx(IconTrashOutlineArtwork, { ...props, strokeWidth: 1 })
```

→ 仍接受 `size` 属性；taste 现用 `size: 12/14/18` **原样可用**，**无需改调用参数，只需换导出名**。

**失败机理**：taste client 的 `require` 返回模块命名空间；缺失导出求值为 `undefined`；`jsx(undefined, …)` 在 React 中抛 `Element type is invalid`。`IconPersonalizationOutline16` 位于 `TasteTrigger`（`lib/client.js:383`，注册进 `sidebar.footer.action`，**常驻渲染**）→ 侧边栏入口按钮**必然崩溃**。

### 4.2 settings 命名空间与 schema —— **机制与 0.1.7 相同，且与 0.2.0 无关**

- taste **不注册任何 DSH settings 命名空间**：全库 `grep ctx.settings` / `settings:` → **0 命中**（无 `ctx.settings`、无 `z.object` 注册到 settings 服务）
- 它用的是 **cordis 插件声明式配置**：`lib/index.js:60` 的 `Config = z.object({...})`，配合 `lib/index.js:54/57/697` 的 `name/inject/export` 四件套
- 运行时值走**自有** `config.json`（`lib/config.js:12`），路径 = `dshHomePath("settings.yaml")` 的所在目录（`lib/index.js:370` → `~/.dsh/taste/`）
- 客户端「模型设置」面板**不是** DSH 设置页：它经 `/taste` RPC 的 `getSettings` / `setObserver`（`lib/bridge.js:287` 通道）读写 `config.json`，并只**只读**解析 `~/.dsh/settings.yaml` 的 `llm-pi-ai` 注册表来填下拉（`lib/bridge.js:248-256`，`lib/model-registry.js`）

本轮实测的现网 `~/.dsh/taste/config.json`（与 `~/.dsh-017/taste/config.json` 同 345 字节）：

```json
{ "learningEnabled": true,
  "injection": { "enabled": true, "maxChars": 16000, "includeSubagents": false, "minConfidence": 0.7 },
  "observer": { "modelMode": "custom", "provider": "adam", "model": "gpt-6-astra",
                "maxInputChars": 16000, "timeoutMs": 120000, "maxTurns": 20 },
  "storage": { "categoriesEnabled": true } }
```

**判定**：该机制**全部在 taste 自身代码内闭合**，只依赖 `@deepseek-ai/schemastery@3.18.4`（0.1.7↔0.2.0 全等）与 `dsh-home-paths`（全等）→ **0.2.0 下原样成立**。

### 4.3 store 实现 —— **自建，未使用官方 `dsh-client-store`**

- `grep -rn "dsh-client-store" lib/ test/ package.json` → **0 命中**
- 客户端开合状态由 `lib/client.js:142` 的 `createTasteStore()`（闭包 + `Set<listener>` + `useSyncExternalStore`）自持，被 `sidebar.footer.action` 与 `shell.overlay` 两个槽位共享（`lib/client.js:765`）
- **历史坑复核成立**：`grep "store"` 会命中 `lib/client.js:183/186/261` 等 **JSDoc 注释**（如「Bind a React hook over the sessions service's list snapshot store」）。**若按"1 行 store 替换"行号去改，会改到注释里** —— 该伪单元在本轮实测中被**证伪**（源码里根本没有可替换的 store 引入行）。
- 官方 `@deepseek-ai/dsh-client-store` 在 0.1.7 与 0.2.0 **逐文件全等**，且已是**浏览器种子词**（§2.5.1）。但它是**另一套** snapshot store，与 taste 的 30 行自建实现无冲突 → **不构成迁移必改项**（列为可选 U3 之外的观察项，**本轮不建议改**）。

### 4.4 数据文件位置与格式；「英文 markdown + 中文显示」机制 —— **前提需要修正**

**机制现状（源码级）**：

| 层 | 实现 | 是否翻译 |
|---|---|---|
| UI 骨架文案 | `lib/client.js:763` `ctx.locale.register("taste", { zh, en })`，两本词典**内嵌在 client bundle**（`const zh`/`const en` 起始于 `lib/client.js:33` / `:84`；zh 与 en 各 **49 个键，键集相同**） | ✅ 中文 |
| 分类名 | `lib/client.js:346` `group.category \|\| t("category.root")` → **只翻译"根目录"这一个固定键**（`category.root`: 根目录） | 部分：真实分类名**原样显示** |
| 条目正文 | `lib/client.js:279` `.ts_entryText` 直接渲染 `entry.text` / `statement` | ❌ **逐字原样** |
| 落盘数据 | `taste.md`，格式 `- <语句> Confidence: 0.65`（`lib/storage.js:109` 解析、`:178` 渲染） | 不涉及 |

**⇒ 结论：taste 从来**没有**"把英文条目翻译成中文显示"的运行时代码。** 曾经的「中文显示」是靠一个**sidecar 覆盖文件** 实现的，而该 sidecar **已经在 2026-09-03 被退役**。

**sidecar 退役实测证据**：

- `~/.dsh/taste/display.zh.json` 内容 = **`{}`**（3 字节）；`~/.dsh-017/taste/display.zh.json` 同为 `{}`
- 两者旁均存在 `display.zh.json.migrated-backup-2026-09-03T09-06-15-960Z`（4422 字节，旧覆盖表备份）
- **运行时无任何代码读取它**：`grep -rn "display.zh" lib/` → **0 命中**；唯一命中在一次性迁移脚本 `scripts/migrate-chinese-single-track.mjs:68`
- 该脚本头部注释自述为「一次性中文单轨迁移事务…迁移完成后本脚本按设计应删除」，语义为**把英文条目按受控词典逐条译成中文写入 taste.md 本体**，并把旧 sidecar 就地改名为时间戳备份（绝不 unlink）

**现网数据文件实测（本轮 charset 统计）**：

| 文件 | 字节 | 行数 | CJK 字符数 |
|---|---|---|---|
| `~/.dsh/taste/taste.md` | 17002 | 62 | **4482** |
| `~/.dsh-017/taste/taste.md` | 16163 | 59 | **4241** |

抽样首行即为中文：`- 解释嵌入式系统架构与技术选型时，偏好以其已有的单片机基础和两年机器人大赛经历为起点… Confidence: 0.65`

**⇒ 对协调者前提的修正**：
> 「GUI 用中文显示条目，底层 markdown 保持英文」**与当轮实测不符**。
> 实际现行约定是 **「中文单轨」**：`taste.md` **本体就是中文**，展示层 sidecar 已退役为空对象，条目正文在 GUI 中**原样直显**。
> 该机制的**成立性在 0.2.0 完全不变**（存储与 locale 全在 taste 自身代码内，仅依赖 0.1.7↔0.2.0 全等的 `dsh-home-paths` / `schemastery`）。
> **迁移动作：无。** 但**请协调者更新前提**——若按"保持英文"去规划，会误判现有 48 条中文条目为"数据污染"而错误地触发回译，属**方向性错误**，必须避免。

**数据文件位置**（0.2.0 不变）：全局 `<DSH_HOME>/taste/taste.md`（`lib/index.js:370` 起）；项目 `<git-root|cwd>/.dsh/taste/taste.md`（`lib/index.js:150-160` `createProjectDirResolver`）；Command Code 兼容只读源 `~/.commandcode/taste` 与 `<root>/.commandcode/taste`（`lib/storage.js:461-462`）。

### 4.5 现有自测套件在 0.2.0 上的实际表现（本轮实测）

**方法**：把工作区源码复制到 `.workspace/audit-020/t26/`，**只读地**用 `node_modules` 符号链接分别指向三套依赖树，运行 `node --test test/*.test.js`，`TMPDIR` 指向工作区内。

| 依赖树 | tests | pass | fail | 备注 |
|---|---|---|---|---|
| **0.1.1-rc.2**（taste peerDeps 目标代） | 218 | **215** | 3 | 基线 |
| **0.1.7-rc.2** | 218 | **199** | 19 | 复跑 2 次均 199/19 |
| **0.2.0-rc.1** | 218 | **199** | 19 | 复跑 3 次均 199/19（稳定） |
| **0.2.0-rc.1 + 夹具补丁** | 218 | **215** | 3 | **与 0.1.1 基线完全一致** |

**0.1.7 与 0.2.0 的失败集合逐名相同**（差异 0，除一次采样噪声）。

**失败根因定位（唯一根因 + 环境性残余）**：

1. **14 个 `learner.test.js` 用例** → `TypeError: stream is not iterable`
   栈顶：
   ```
   joinAssistantStreamText (dsh-llm/lib/index.js:1435)
     ← AssistantOutputFold.push (dsh-subagent/lib/index.js:156)
     ← finalAssistantOutput (dsh-subagent/lib/index.js:186)
     ← runLearner (dsh-taste/lib/learner.js:233)
   ```
   代码级差异（`dsh-subagent/lib/index.js`）：
   ```diff
   // 0.1.1
   push(event) { if (event.type === "assistant/message") { … } 
                 else if (event.type === "assistant/chunk" && …) this.pushText(…) }
   // 0.1.7 / 0.2.0
   push(event) { if (event.type === "assistant/message") { … }
                 if (event.type === "assistant/message" || event.type === "assistant/attempt")
                     this.pushText(joinAssistantStreamText(event.data.stream)); }   // ← 新增，且无条件求值
   ```
   **运行时是否受影响？不受影响。** 真实事件确实带 `stream`：
   `dsh-agent-loop/lib/index.js:1144-1150` → `this.session.append("assistant/message", { turn, step, message, usage, stream: live.stream })`。
   → 这是**测试夹具漂移**（fake 事件省略了 `stream`），**不是 taste 产品缺陷，也不是运行时缺陷**。
2. **2 个 `backfill.test.js` 用例** → `waitFor: condition not met in time`（2000 ms 超时，实测 2010 ms）
   → 同一根因的**级联**：learner 抛错 → 瀑布熔断 → 第 2 块未入队 → `followups.length` 停在 4 而非 5。
3. **3 个用例**（`index.test.js` ×2、`storage.test.js` ×1）→ **环境性**，**在 0.1.1 上也失败**，与版本无关：
   - `bridge.test.js:195-197` 用 `projectRootFor(work)` 计算项目目录并**写入宿主仓库**；当 `TMPDIR` 位于 dsh git 仓库内时，`projectRootFor` 上溯到仓库根，于是写进 `/home/CNS2026495165/dsh/.dsh/taste/taste.md`（字面量 `- Prefer tabs over spaces. Confidence: 0.8`）
   - 该泄漏被 `index.test.js` 的「returns empty when there is no snapshot to project」等用例读到 → 期望 `""` 实得 `<taste>\n- Prefer tabs over spaces. Confidence: 0.80\n\n</taste>`
   - `storage.test.js:417`「returns the cwd itself when no .git is found」同理被仓库 `.git` 破坏

**夹具补丁验证（假设确证）**：在每个 fake `assistant/message` 事件里补 `stream: []`（6 处：`learner.test.js:31/208/288`、`backfill.test.js:31/409`、`index.test.js:44`）后，0.2.0 上得 **215 pass / 3 fail**，与 0.1.1 基线**逐项相同** → **taste 源码在 0.2.0 上无版本归因失败**。

**⇒ 对历史"212 passed / 0 failed"的处置**：该历史结论在当前依赖树上**不可复现**；它记录的是 0.1.1-rc.2 依赖树的一次快照（当时为 212 用例）。**不得把"套件全绿"当作 0.2.0 迁移验收闸门**，除非先修夹具（U2）。

---

## 5. 源码与部署件关系结论（决定重建 vs 复制）

| 判定项 | 结论 | 依据 |
|---|---|---|
| `dsh-taste/` 是什么 | **受 git 跟踪的权威源码**（非只读快照） | `git ls-files dsh-taste/` = 31；`git status --short -- dsh-taste/` = 0 行干净 |
| 部署件是什么 | 源码的**逐字节副本**（rsync -a 语义） | 三处聚合 sha256 全等 `fcf78771…`；31/31 逐文件 md5 全等；**文件集合无差异** |
| 是否存在未回流改动 | **不存在** | 三处同哈希；部署目录**无多余文件**；`git` 工作树干净 |
| 现役 `~/.dsh` 与隔离 `~/.dsh-017` 是否漂移 | **无漂移** | 两代部署件彼此同哈希 |
| 历史归档副本 | 旧修订（`39eb143e…`），**不参与迁移** | 与三方不同哈希 |
| 谁在真正运行 | `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-taste`（真实目录，非符号链接），由 `cordis.patch.yml` 的 `insert` 行加载 | `~/.dsh/profiles/web/cordis.patch.yml:19-21`、`~/.dsh-017/profiles/web/cordis.patch.yml:19-21` |

> **⇒ 上游无 0.2.0 制品可比、本地源码与部署件又完全一致**，所以"**源码重建**"与"**直接复制现有源码**"在**内容上等价**；差别只在**走不走 npm pack 制品**。
> **推荐：以工作区 git 源码为唯一真相源，改造后生成规范 tarball 再落地部署**（既得到可校验的 `integrity`，又保留 git 可追溯性），**而不是**从 `~/.dsh` 反向复制（那会丢失来源可追溯性）。

---

## 6. 迁移方式与最小改造单元

### 6.1 迁移方式判定

**判定：原样迁移 + 1 个必需的生产代码改造单元（图标）+ 2 个可选收尾单元。**

**明确否决"源码重建"**：taste 的 0.2.0 兼容缺口**只有图标命名一处**，功能层面无任何契约破坏（§3.2）。按"重建"去做会引入不必要的重写风险，且没有任何上游新制品可对齐。

### 6.2 必需改造单元

> ⚠️ **本节清单已由 §8.5 取代（协调者插播校正后修订版，含新增可选单元 U5 与"明确不改"项 U6）。**
> 本节保留原判（**U1 仍为唯一必需项，结论未变**）以备追溯；**执行请以 §8.5 表为准**。

#### U1（必需，生产代码）— 客户端图标导出名迁移

| 项 | 内容 |
|---|---|
| **文件** | `dsh-taste/lib/client.js` |
| **行** | **298、383、706、707、708**（共 5 处） |
| **改动** | `IconTrashOutline16` → `IconTrashOutlineRegular`<br>`IconPersonalizationOutline16` → `IconPersonalizationOutlineRegular`<br>`IconRefreshOutline16` → `IconRefreshOutlineRegular`<br>`IconSettingsOutline16` → `IconSettingsOutlineRegular`<br>`IconCloseOutline16` → `IconCloseOutlineRegular`<br>**仅改标识符**；`size` 实参**保持不变**（`12`/`wide?14:18`/`14`/`14`/`14`） |
| **依据** | §4.1：0.1.7 与 0.2.0 的 `Icon*Outline16` 导出数均为 0；替代品 `Icon*OutlineRegular\|Medium` 在两版本**均存在**且签名 `({size=16,className,strokeWidth})` 与 0.1.7 **逐字节相同**，接受 `size` |
| **为何选 `Regular`** | `Regular` = `strokeWidth: 1`，是 16px 常规字重；`Medium` = 1.3px。taste 使用的是 12–18px 小图标，`Regular` 与原 `Icon*Outline16` 的字重语义最接近。若视觉评审偏好更粗，可整体换 `Medium`（同样满足验收） |
| **验收标准** | ① `grep -n "Outline16" dsh-taste/lib/client.js` → **0 命中**<br>② `node --check dsh-taste/lib/client.js` → 通过<br>③ 5 个替换名**逐一**在 `@deepseek-ai/dsh-client-ui-primitives@0.2.0-rc.1` 的 `export {}` 名单中**存在**（用导出名集合判定，**不得**用字符串包含判定——`IconTrashOutline` 是 `IconTrashOutlineRegular` 的前缀，字符串包含会产生**假阳性**）<br>④ 在 0.2.0 实例中打开 taste 面板：侧边栏入口按钮**渲染不崩**、面板头部 3 个按钮（刷新/设置/关闭）与条目删除按钮**图标正常显示**；浏览器控制台**无** `Element type is invalid` |
| **测试同步（可选但建议）** | `dsh-taste/test/client.test.js` 需一并改名：**mock 表 5 个键**（`:34-38`，`requireMock()` 内）与 **2 处字符串门**（`:204` `code.includes("IconTrashOutline16")`、`:205` `code.includes("IconSettingsOutline16")`）。否则改完产品代码后 `client.test.js` 会**立刻失败**。这属 U1 的**附属必改项**，不单独计单元 |

#### U2（可选，测试夹具）— `assistant/message` 夹具补 `stream`

| 项 | 内容 |
|---|---|
| **文件** | `test/learner.test.js`（:31、:208、:288）、`test/backfill.test.js`（:31、:409）、`test/index.test.js`（:44） |
| **改动** | 每个 fake `{ type: "assistant/message", data: { message: … } }` 的 `data` 中补 `stream: []` |
| **依据** | §4.5：`dsh-subagent` 自 0.1.7 起在 `AssistantOutputFold.push` 无条件调用 `joinAssistantStreamText(event.data.stream)`；真实事件带 `stream`（`dsh-agent-loop/lib/index.js:1144-1150`），夹具未带 |
| **验收标准** | 在 0.2.0 依赖树上 `node --test test/*.test.js` → **≥215 pass**（与本轮 0.1.1 基线一致）。剩余 3 项环境性失败需**另择 TMPDIR（不在任何 git 仓库内）**后才应归零 |
| **风险/注意** | 本轮已实测该补丁有效（215/3）。**但**：该夹具修的是"测试与库的契约"，**不改产品行为**，故为**可选**；若不修，则**不得**把套件绿灯作为验收依据 |

#### U3（可选，声明清理）— 移除失效 inject 项

| 项 | 内容 |
|---|---|
| **文件** | `dsh-taste/package.json` |
| **改动** | 从 `dsh.client.inject` 中删除 `"@deepseek-ai/dsh-client-runtime"`（该包**仅 0.1.1 存在**）；可选补 `"@deepseek-ai/dsh-client-ui-primitives"`、`"@deepseek-ai/dsh-client-store"` 以表达真实依赖 |
| **依据** | §3.4 + §2.5.3：装载器对解析不到的 inject 依赖**静默跳过**，无报错 |
| **验收标准** | 面板加载与槽位注册行为**无变化**（回归对照） |
| **优先级** | **低**。纯清理，**不修也能正常迁移**；若无瑕处理可整体跳过 |

#### U4（可选，peerDependencies 语义）— 版本区间

| 项 | 内容 |
|---|---|
| **文件** | `dsh-taste/package.json` |
| **改动** | `peerDependencies` 中 7 个 `^0.1.1-rc.2` → `^0.2.0-rc.1` |
| **依据** | 用真实 semver 实测：`satisfies("0.2.0-rc.1", "^0.1.1-rc.2")` = **false**（`^0.1.1-rc.2` 上界为 `<0.2.0`，且预发布版不跨区间）。现部署为**手工复制**、不经 npm 解析，故**当前无实际后果**；但一旦改用 `dsh plugin add` / pnpm 解析，会报 unmet peer |
| **验收标准** | `npm pack` 成功；若走 pnpm 安装路径，无 unmet peer 警告 |
| **优先级** | **低**（仅在未来改用包管理器安装时生效） |

### 6.3 部署路径（与 0.1.x 完全一致的写法）

1. 在**隔离根**（如 `<ISO_HOME>`）建 `profiles/node_modules/@deepseek-ai/dsh-taste/`，`cp -a` 落地 U1 后的源码（或解开 §2.1.4 的规范 tarball）
2. `<ISO_HOME>/profiles/web/cordis.patch.yml` 保留/写入：
   ```yaml
   - insert:
       - id: taste
         name: '@deepseek-ai/dsh-taste'
   ```
3. 依据 §2.5.5（CLI `profile-boot*` 与 loader 插件逐字节全等）**该路径与写法在 0.2.0 无需调整**
4. 数据面：`<ISO_HOME>/taste/{taste.md,config.json}` 从现役复制即可（格式未变，§4.4）；`display.zh.json` 已是 `{}`，**可复制亦可不复制**（无运行时读取方）
5. **注意**：先修正**协调者前提**（§4.4）——**不要**把现有中文 `taste.md` 当作英文数据去做回译

---

## 7. 未验证项

1. **未做浏览器/UI 实跑验证（U1 的验收项 ④）**。本轮受"不得启动监听端口的服务"与"不得发起模型请求"约束，**没有**在任何 0.2.0 实例上真实打开 taste 面板。U1 的图标结论是**导出名集合的程序化判定 + React 渲染机理推断**，**不是**端到端实测。→ **上机验证必须由执行档在隔离 0.2.0 实例上补做。**
2. **未在 3097（0.1.7）实跑确认"侧边栏入口按钮已经崩溃"**。该推论（§4.1）由"0.1.7 primitives 无该导出 + `TasteTrigger` 常驻渲染"推出，属**强推断**而非**观测**。3097 日志（`~/.dsh-017/logs/dsh-host.jsonl`）中 `grep` 不到相关报错，但**客户端渲染异常不进宿主日志**，故日志无命中**不能**作为反证。→ 建议执行档顺带用无头浏览器取证。
3. **未验证 `taste.md` / `config.json` 在 0.2.0 实例中的读写闭环**（`/taste` RPC 的 `getTree`/`deleteEntry`/`getSettings`/`setObserver` 四个端点）。服务端契约（`ctx.connection.rpc.handle`，`dsh-client-connection` 0.1.7↔0.2.0 逐文件全等）判为**兼容**，但**未实跑**。
4. **未验证 learner 真实链路**（`agents.create` → `whenIdle` → `finalAssistantOutput`）。本轮只证明"**真实事件确实携带 `stream`**"（源码级），**未在 0.2.0 上跑通一次真实/仿真 learner 回合**（受"不得发起模型请求"约束）。
5. **未验证 `--dump-config` 级别的组合结果**：`insert` 行在 0.2.0 组合后的 profile 树中是否与 taste 期望的 `Config` 默认值一致（本轮只核对 `profile-boot` 字节全等与 loader 版本相同，**未实际 dump**）。
6. **未验证 Windows 平台的面板定位**（§3.3 的 `--dsh-frame-overlay-top`）。本机为 Linux，属**低风险未验证项**。
7. **未验证 `@deepseek-ai/dsh-usage` / `@deepseek-ai/dsh-vision-adam` / `@deepseek-ai/dsh-session-board` 等其它私有件的同类问题**（本轮仅顺带确认 `dsh-usage` 亦为 E404）；它们属**其它轨道**（T08/T24/T28）范围。
8. **未覆盖 0.2.0 之后的新版本**：本轮锚定 `0.2.0-rc.1`；registry `next` 标签当前指向它，**无稳定 0.2.0**。

---

## 8. 证据校正与客户端 UI 影响面复核（协调者插播后追加）

> 本节为收到协调者插播校正（依据 `.workspace/audit-020/reports/MEASURED-BASELINE.md`）后的**追加复核**。
> §1–§7 的结论**未被推翻**；本节做三件事：**把依据分级写明**、**把判定口径收窄到 `lib/`**、**把图标/槽位核验集中到真正有改动的客户端包**。

### 8.0 依据分级（本报告全文适用的硬纪律）

| 级别 | 含义 | 方法论 | 可否单独支撑改造结论 |
|---|---|---|---|
| **A 类｜`lib` 哈希全等推定未变** | 两棵对照树 `<pkg>/lib` 逐文件 sha256 相等 | 哈希比对，**未读源码** | ❌ **不可**。仅用于**缩小排查面** |
| **B 类｜0.2.0 源码实读确认** | 直接读 0.2.0 的 `lib/**` 源码 / 导出名单 / 类型声明得出结论 | `diff -r`、导出名集合解析、源码精读 | ✅ **可**，且是唯一依据 |

**判定规则**：凡"槽位 / 图标 / 契约在 0.2.0 是否可用"的结论，**一律以 B 类为准**；A 类只在 B 类不便逐包精读时用于排除。本报告 §4.1（图标）与 §2.5.1（种子词）、§2.5.2（槽位）、本 §8.3–§8.4 **均为 B 类**；§2.5.4 表中标注"全等"的 15 个包为 **A 类**，其余为 B 类。

### 8.1 对协调者 5 点校正的逐条回应

**① `dsh-skill-office` 在 0.1.7 已存在 —— 确认，且本报告从未引用**

- 本轮实测：`~/.npm-global-dsh017/.../node_modules/@deepseek-ai/dsh-skill-office/package.json` → **version `0.1.7-rc.2`**（存在）；0.2.0 侧为 `0.2.0-rc.1`。**协调者正确，它不是 0.2.0 新增包。**
- `grep -n "skill-office" T26-taste-compat-020.md` → **0 命中**。本报告全文**没有**把它当 0.2.0 新特性论证（T26 为 taste 专项，未涉及该包）。无需修正。

**② `lib/` 口径 225/280 全等、55 个有真实改动 —— 确认，本报告数字与之逐条一致**

本报告 §2.5.4 的比对**本来就用 `lib/` 口径**（`find lib -type f | sort | xargs md5sum`）。与协调者 `churn-lib-017-020.txt` 逐条对照：

| 包 | 本报告 §2.5.4 数字 | 协调者 churn 文件 | 一致 |
|---|---|---|---|
| `dsh-client-ui-primitives` | 13 个差异文件 / 123 总 | `123 110 0 0 13 10.6%` | ✅ |
| `dsh-client-ui-sidebar` | 2 / 8 | `8 6 0 0 2 25.0%` | ✅ |
| `dsh-client-ui-layout` | 1 / 11 | `11 10 0 0 1 9.1%` | ✅ |
| `dsh-commands` | 1 / 14 | `14 13 0 0 1 7.1%` | ✅ |
| `dsh-subagent` | 1 / 54 | `54 53 0 0 1 1.9%` | ✅ |
| `dsh-client-modules` / `-locale` / `-connection` / `-store` / `-ui-slots` / `dsh-llm` / `dsh-tools` / `dsh-agent` / `dsh-home-paths` / `dsh-system-prompt` / `dsh-atomic-write` / `schemastery` / `cordis` | 全等 | **均不在 churn 清单中**（= lib 全等） | ✅ |

⇒ 本报告 §3.1/§3.2"行为级差异仅图标一处"的结论**在 `lib/` 口径下成立**。§2.5.4 表已按 A/B 类重新标注。

**③ `dsh-skill` / `dsh-skill-filesystem` / `dsh-skill-office` 的 `lib/` 口径** —— 属 T11 轨道范围，本报告不重复论证（§7 未验证项 7 已声明）。但协调者 ③ 的括号里明确要求"**需按 `lib/` 口径复核是否真代码**"，本轮已实测，**结论：不是真代码**（B 类，`diff -r`）：

| 包 | `lib/` 文件数 | `lib/` 口径 | 整包文件数 | 整包唯一差异文件 | 差异实质 |
|---|---|---|---|---|---|
| `dsh-skill` | 2 | **逐文件全等** | — | （无差异） | — |
| `dsh-skill-filesystem` | 2 | **逐文件全等** | — | （无差异） | — |
| **`dsh-skill-office`** | **2** | **逐文件全等 → CODE-IDENTICAL** | **11** | **`package.json`（唯一）** | **纯版本字符串**：`version 0.1.7-rc.2 → 0.2.0-rc.1`、`peerDependencies/dependencies` 中 `@deepseek-ai/dsh-skill` 版本号同步；`devDependencies` 键顺序调整（`cordis-plugin-include` 与 `cordis-plugin-loader` 互换）→ **纯装饰性** |

> **⚠️ 值得回传协调者的口径一致性发现**：协调者 ③ 写的"**`dsh-skill-office` 11 个文件中 1 个改动**"里，**"11 个文件"是整包口径**（`assets/*4 + lib/*2 + LICENSE + package.json + README×3 = 11`），而**那"1 个改动"正是 `package.json` 的版本号字符串** —— 即协调者 ② 亲口警告的**同一个陷阱**（"多数『单文件差异』实为 `package.json` 里的版本号字符串"）在 ③ 中就地复现了一次。
> **按 `lib/` 口径，`dsh-skill-office` 应归入"code-identical（225 个之一）"，而非"55 个有真实改动"。** 建议协调者在 T11/T15 中按 `lib/` 口径复核该项，避免把一个纯版本号变更记为"11 个文件中 1 个改动"而产生误导。

**④ 对照树与判定方法** —— 已按指定路径与指定方法（`diff -r <A>/<pkg>/lib <B>/<pkg>/lib`）**重跑全部核验**，见 §8.2–§8.4。

**⑤ 客户端 UI 改动面收敛到 5 个包** —— 已执行，见 §8.3；**并据此发现 2 项 0.2.0 新增的真实影响面**，见 §8.4。

### 8.2 `@deepseek-ai/dsh-taste` 的官方/本地归属 与 0.1.7 vs 0.2.0 `lib/` 口径结论

**决定性证据（B 类，比 §2.1 更硬）**：把两棵**官方对照树**都查一遍：

```
~/.npm-global-dsh017/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-taste  → ABSENT
.workspace/iso-020/npm-global/node_modules/@deepseek-ai/dsh-taste                             → ABSENT
```

`diff -r <017>/dsh-taste/lib <020>/dsh-taste/lib` 实际执行结果：

```
diff: .../0.1.7 树/dsh-taste/lib: 没有那个文件或目录
diff: .../0.2.0 树/dsh-taste/lib: 没有那个文件或目录
```

**⇒ 结论（归属）**：`@deepseek-ai/dsh-taste` 是**本地私有插件**，**不是官方包**。
它**在两棵官方树上都不存在**（0.1.7 侧也不存在），只存在于三处**人工放置位置**：工作区 `dsh-taste/`、`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-taste/`、`~/.dsh-017/profiles/node_modules/@deepseek-ai/dsh-taste/`。这比 §2.1 的 npm 404 更直接——**它从未进入任何官方安装闭包**。

**⇒ 结论（`lib/` 口径差异）**：**不适用（N/A）—— 两侧均无对照物**。
`diff -r` 无从执行；"0.1.7→0.2.0 的 taste `lib/` churn"**这一命题在定义上不成立**（`churn-lib-017-020.txt` 中亦无 taste 条目，因为该表的包集合取自官方树）。
**唯一可比的是 taste 自身版本**：三处副本版本恒为 `0.1.0`、聚合 sha256 全等 `fcf78771a07b3ca13e1e3db6a58311f71f780f87394cddf8644dc927673a25f4`（§2.3，31/31 文件）。

### 8.3 5 个被点名客户端包的 `lib/` 口径复核（依据 ⑤）

方法：`diff -r <017>/<pkg>/lib <020>/<pkg>/lib`（含 `-q` 列表）。**因 taste 只依赖两个槽位与图标导出面**，故每包都检查三件事：**槽位名集合是否增删**、**是否声明 taste 用的槽位**、**是否改动图标导出面**。

| 包 | churn | 实际差异文件 | 槽位名集合增删（程序化 set-diff） | 对 taste 的影响 |
|---|---|---|---|---|
| `dsh-client-ui-sidebar` | 2/8 | `lib/client.js`（版本串 `0.1.7-rc.2-c127551`→`0.2.0-rc.1-62962ee` + 新增 `sidebar_menu_click` 埋点）<br>`lib/types/client/index.d.ts`（**仅删除 1 行 JSDoc**：`/** Registers the sidebar shell and global panel navigation. */`） | **ADDED: 无 / REMOVED: 无** | **无**。`sidebar.footer.action` 在两版本**均声明**（B 类实读） |
| `dsh-client-ui-conversation` | 7/72 +1 新增 | `lib/client.js`、6 个 `lib/types/client/**/*.d.ts`、新增 `input/submission-analytics.d.ts` | **ADDED: 无 / REMOVED: 无** | **无**。taste 不注册 `conversation.*` 槽位 |
| `dsh-client-ui-theme` | 1/16 | `lib/client.js`（`design-platform.css` token 表） | ADDED: 无 / REMOVED: 无 | 见 §8.4-2（token 面 `0 删除 / 5 新增`，taste 的 14 个 token 全在） |
| `dsh-client-ui-plugin-manager` | 4/18 +2 新增 | `lib/client.js`、`lib/types/client/{index,locales,manager-store}.d.ts`、新增 `PluginRefreshToast.d.ts`、`sanitize-install-input.d.ts` | **ADDED: `shell.overlay` / REMOVED: 无** | ⚠️ **新发现**，见 §8.4-1 |
| `dsh-client-ui-workspace` | 7/21 | `lib/client.js`、6 个 `lib/types/client/**/*.d.ts`（含 `contract/slots.d.ts`） | **ADDED: `session.untitled` / REMOVED: 无** | **无**。`contract/slots.d.ts` 的唯一改动是**一行 JSDoc 措辞**（`displayTitle`: "persisted title, project basename, or Session id" → "persisted title, or empty when the Session has none"），**接口签名未变**；`session.untitled` 是 release note"无标题会话显示未命名"的文案键，**不属 taste 槽位**。注：该包**在 0.1.7 与 0.2.0 均**注册 `shell.overlay`（重命名/归档对话框），两版本**逐项相同** → 见 §8.4-1 收敛点 |

**共同结论（B 类）**：5 个包中，**4 个对 taste 零影响**；**唯一有实际影响的是 `dsh-client-ui-plugin-manager` 新增占用 `shell.overlay`**（§8.4-1）。**taste 依赖的两个槽位名（`sidebar.footer.action`、`shell.overlay`）与图标导出面，在这 5 个包中均无增删。**

### 8.4 两项 0.2.0 新增的真实影响面（新发现）

#### 8.4-1 `shell.overlay` 在 0.2.0 新增了一个官方占用者（严重度：低）

**B 类证据（0.2.0 源码实读）**——`dsh-client-ui-plugin-manager/lib/client.js:3722-3730`：

```js
ctx.slots.inject("shell.overlay", () => ctx.slots.register({
    name: "shell.overlay",
    id: "plugin-manager.refresh-toast",     // ← 0.2.0 新增，0.1.7 无
    locale: NS,
    inject: () => ({ hooks: { pluginManager: face.hooks.pluginManager }, dismissNotice: face.dismissNotice })
}, PluginRefreshToast));
```

| 项 | 0.1.7 | 0.2.0 |
|---|---|---|
| plugin-manager 的 `slots.inject` 调用 | `main`、`sidebar.panellist`（**2 个**） | `main`、**`shell.overlay`**、`sidebar.panellist`（**3 个**） |
| `shell.overlay` 字符串出现 | `grep -c` = **0** | 2 处（3722/3723） |

**冲突评估（B 类，逐项实读）**：

1. **槽位是 list 型，不会互相顶掉** —— `dsh-client-ui-layout/lib/client.js` 声明 `"shell.overlay": { kind: "list", scope: "root" }`；**0.1.7 与 0.2.0 逐字相同**（layout 的唯一差异是 CSS）。⇒ 多插件**可共存**，无驱逐、无覆盖。
2. **`shell.overlay` 本来就不是独占槽位（关键收敛点）** —— 权威依据为 `slots.inject` 调用点逐包对比（B 类）：

   | 包 | 0.1.7 `slots.inject` | 0.2.0 `slots.inject` | 是否变化 |
   |---|---|---|---|
   | `dsh-client-ui-sidebar` | `shell.leading`、`sidebar` | 同 | **否** |
   | `dsh-client-ui-conversation` | `conversation.input.dock`、`main`、`settings.general.item` | 同 | **否** |
   | `dsh-client-ui-theme` | `settings.general.item` | 同 | **否** |
   | `dsh-client-ui-workspace` | `conversation.hero.workspace`、**`shell.overlay`**、`sidebar.workspaces`、`sidebar.workspaces.session.menu.item`、`sidebar.workspaces.session.row.action` | 同（逐项相同） | **否** |
   | **`dsh-client-ui-plugin-manager`** | `main`、`sidebar.panellist` | `main`、**`shell.overlay`**、`sidebar.panellist` | ✅ **是（唯一变化）** |

   ⇒ **`shell.overlay` 在 0.1.7 就已多占用者**：`dsh-client-ui-workspace` 早已在其中注册 `workspace.session-rename` 与 `workspace.session-archive` 两个对话框（`workspace/lib/client.js:4366-4376` 于 0.1.7、`:4376-4386` 于 0.2.0，**逐项相同**）。
   ⇒ 因此 0.2.0 的 plugin-manager toast **只是给一个本就共享的 list 槽位再加一个占用者**，**不是新的争用模型**；"taste 面板与其它 overlay 内容共存"这一模式在 0.1.7 已被两个对话框证明可用。
3. **排序由 `priority` 再 `order` 升序决定** —— `dsh-client-ui-slots/lib/index.js:221`：
   `(a.options.priority ?? 0) - (b.options.priority ?? 0) || (a.options.order ?? 0) - (b.options.order ?? 0)`
   - taste：`order: 100`、无 `priority` → **(0, 100)**
   - plugin-manager toast：**无 `order`、无 `priority`** → **(0, 0)**
   - workspace 的两个对话框：同样无 `order`/`priority` → **(0, 0)**
   ⇒ toast 与既有对话框同序，均**排在 taste 面板之前**（DOM 顺序在前）。此排序在 0.1.7 即已如此。
4. **视觉叠压** —— toast 用 primitives 的 `Toast`，`lib/Toast.module.css`（B 类实读，**该 CSS 在 0.1.7/0.2.0 之间未变**）：
   `position:fixed; top:40px; left:50%; z-index:1100; pointer-events:none; transform:translateX(-50%)`
   taste 面板：`position:fixed; top:12px; right:12px; bottom:12px; width:480px; z-index:40`
   ⇒ **z-index 1100 > 40**：toast 绘制在 taste 面板之上；`pointer-events:none` ⇒ **不拦截点击**。
   ⇒ **几何重叠仅在窄视口**（居中 toast 宽 vs 右侧 480px 面板，视口 <约 1000px 时相交）。
5. **触发条件罕见** —— `PluginRefreshToast` 首行 `if (notice?.kind !== "refresh-failed") return null;`（`lib/client.js:3638`）⇒ **仅在插件刷新失败时短暂出现**。

**⇒ 判定：严重度【低】，不构成迁移阻塞项**，且经收敛点 2 后**进一步降级**——`shell.overlay` 本就是共享 list 槽位，0.2.0 只是增加了一个（罕见的、非拦截点击的）失败提示占用者。语义上该提示**本就应该浮在最上层**，无需对抗。
**建议：不改。** 明确**不要**为压过 toast 而抬高 taste 面板 `z-index` —— 那会反向遮挡官方失败提示与 workspace 的重命名/归档对话框。

#### 8.4-2 0.2.0 新增 `--dsh-frame-overlay-top` 与 Windows 标题栏避让；taste 未跟随（严重度：低，且**是 0.2.0 相对 0.1.7 的真实新增面**）

**B 类证据 1 —— 官方新增的 overlay 顶部约定**（`dsh-client-ui-layout/lib/client.js` CSS）：

```diff
 0.1.7: html[data-platform=darwin]{--dsh-frame-top-clearance:48px}
 0.2.0: html[data-platform=darwin]{--dsh-frame-top-clearance:48px}
+       html[data-windows-titlebar]{--dsh-frame-top-clearance:var(--dsh-windows-titlebar-height);
+                                   --dsh-frame-chrome-top:var(--dsh-windows-titlebar-height)}
+       html[data-platform=darwin],html[data-windows-titlebar]{
+           --dsh-frame-overlay-top:calc(var(--dsh-frame-top-clearance) + 20px)}
+       html[data-platform=darwin][data-fullscreen],html[data-windows-titlebar][data-fullscreen]{
+           --dsh-frame-overlay-top:20px;--dsh-frame-chrome-top:0px}
```

**B 类证据 2 —— 谁在消费它（全树 `grep -rl`）**：

| 版本 | `--dsh-frame-overlay-top` 消费方 |
|---|---|
| 0.1.7 | **（无 —— 变量不存在）** |
| 0.2.0 | `dsh-client-ui-layout/lib/client.js`、`dsh-client-ui-primitives/lib/Menu.module.css`、`dsh-client-ui-primitives/lib/Modal.module.css`、`dsh-client-ui-schedule/lib/client.js`、`dsh-client-ui-settings-general/lib/client.js` |

典型用法（B 类实读）：
- `primitives/lib/Menu.module.css`：`max-height: calc(100vh - 12px - max(12px, var(--dsh-frame-overlay-top, 12px)))`
- `primitives/lib/Modal.module.css`：`padding: max(24px, var(--dsh-frame-overlay-top, 24px)) 24px`
- `settings-general/lib/client.js`：`height:min(800px, calc(100vh - 2 * max(24px, var(--dsh-frame-overlay-top,24px))))`

**B 类证据 3 —— 配套的内部辅助函数语义在 0.2.0 变更**（`dsh-client-ui-primitives/lib/index.js:3517-3520` vs `:3546-3551`）：

```diff
- 0.1.7: return Number.isNaN(clearance) ? min : Math.max(min, clearance);
+ 0.2.0: return Math.max(min, (root.hasAttribute("data-fullscreen") ? 0 : clearance) + 20);
```
（注：该函数 `overlayTopMargin` **未出现在任一版本的 `export {}` 名单中**——按导出名集合实测 **0.1.7=false、0.2.0=false**，属 primitives **内部**辅助，插件**无法**通过种子词调用。）

**taste 现状（B 类实读 `dsh-taste/lib/client.js:21`）**：
`.ts_root{position:fixed;top:12px;right:12px;bottom:12px;z-index:40;…}`
→ `grep -rn "overlayTopMargin\|--dsh-frame" dsh-taste/lib/` → **0 命中**。**taste 完全未跟随该约定。**

**影响面判定**：
- `--dsh-frame-top-clearance` 在 **0.1.7 仅 darwin 存在**；**0.2.0 扩展到 Windows 标题栏** ⇒ **受影响平台集合在 0.2.0 变宽（新增 Windows）**。
- 本机 Linux：`data-platform` 非 darwin 且无 `data-windows-titlebar` ⇒ **当前零影响**。
- macOS：taste 面板顶端 12px 落在红绿灯/拖拽条区（**0.1.7 起已如此，非 0.2.0 新增**）。
- Windows：**0.2.0 起**该区被正式声明为保留区，taste 面板顶端 12px 会进入标题栏拖拽带（**0.2.0 相对 0.1.7 的新增面**）。

**⇒ 判定：严重度【低】（外观/可点性，非功能破坏；Linux 无影响）。** 列为**可选**单元 U5，由是否支持 Windows 桌面决定是否执行。

#### 8.4-3 附带核对：主题 token 与 primitives 导出面（B 类，均为"零删除"）

| 面 | 0.1.7 | 0.2.0 | 删除 | 新增 |
|---|---|---|---|---|
| `dsh-client-ui-theme` 定义的 `--dsw-*` token | 395 | 400 | **0** | **5**：`--dsw-alias-bg-document-selection`（对应 release note「Office/PDF 预览选区清晰度」）、`--dsw-alias-label-deep-diving`、`--dsw-alias-label-deep-diving-shimmer`、`--dsw-alias-label-shimmer`、`--dsw-alias-switch-thumb`（对应「深色主题开关对比度」） |
| **taste 实际使用的 14 个 `--dsw-*` token 在 0.2.0 theme 中的定义率** | — | **14 / 14（缺失 0）** | — | — |
| `dsh-client-ui-primitives` 导出名集合 | 279 | 280 | **0** | **1**：`pointerModality` |

⇒ 主题 token 与 primitives 导出面在 0.1.7→0.2.0 均为**纯增量、零删除**；taste 的配色与图标依赖面**未被打断**。**这也再次从源码侧确认：0.2.0 不存在"图标退役"这一类回归。**

### 8.5 修订后的最小改造单元清单（取代 §6.2）

| 单元 | 类别 | 文件 / 行 | 改动 | 严重度 | 是否必需 |
|---|---|---|---|---|---|
| **U1** | 生产代码 | `lib/client.js` :298/383/706/707/708 | 5 个 `Icon*Outline16` → `Icon*OutlineRegular` | **阻塞（面板崩溃）** | ✅ **必需** |
| U1b | 测试同步 | `test/client.test.js` :34-38 / :204-205 | 5 个 mock 键 + 2 处字符串门改名 | — | ✅ 随 U1 必改 |
| U2 | 测试夹具 | `test/learner.test.js` :31/208/288、`test/backfill.test.js` :31/409、`test/index.test.js` :44 | fake `assistant/message` 事件补 `stream: []` | 低 | 可选（不修则不得以套件绿灯作验收） |
| U3 | 声明清理 | `package.json` → `dsh.client.inject` | 删失效的 `@deepseek-ai/dsh-client-runtime` | 低 | 可选 |
| U4 | 依赖声明 | `package.json` → `peerDependencies` | 7 个 `^0.1.1-rc.2` → `^0.2.0-rc.1` | 低（仅 pnpm 路径生效） | 可选 |
| **U5** | 生产代码（CSS，**0.2.0 新增面**） | `lib/client.js:21` `.ts_root` | `top:12px` → `top:max(12px, var(--dsh-frame-overlay-top, 12px))`，与官方 5 个消费方写法一致 | 低（Windows/macOS 外观） | 可选（Linux 无影响） |
| U6 | 明确**不改** | — | **不抬高** taste 面板 `z-index` 以压过 plugin-manager 的失败 toast；**不**引入官方 `dsh-client-store` 替换自建 store（§4.3） | — | ❌ 明确否决 |

**U5 依据（B 类）**：§8.4-2 列出的官方 5 个消费方统一写法 `var(--dsh-frame-overlay-top, <fallback>)`；taste 面板恰为 `shell.overlay` 子节点（`lib/client.js:781`），与该约定同域。
**U5 验收标准**：Linux 上渲染前后**像素级无差异**（因变量缺失回退到 12px）；`grep -n "dsh-frame-overlay-top" dsh-taste/lib/client.js` 命中 1 处；Windows（或 `document.documentElement` 置 `data-windows-titlebar` 的仿真）下顶部不再侵入标题栏拖拽带。

**迁移方式判定不变（§6.1）**：**原样复制 + U1（必需）+ 2 个可选收尾**；**否决源码重建**。U5/U4/U3 均为**可选增强**，不执行不影响 0.2.0 运行。

---

## 9. 审计副作用申明（只读约束的诚实披露）

本轮为取得 §4.5 的三方对照证据，在 `.workspace/audit-020/t26/` 内复制源码并**运行了 taste 自带测试套件**。由于该套件存在**测试隔离缺陷**（`test/bridge.test.js:195-197` 用 `projectRootFor(work)` 推导项目目录并写入），当 `TMPDIR` 位于 dsh git 仓库内时，会向**仓库内路径**写入一个文件：

- 受影响路径：`/home/CNS2026495165/dsh/.dsh/taste/taste.md`
- 当前状态：**0 字节**，mtime `2026-09-29 17:16:15`
- 影响评估：该目录**预先存在**（`2026-09-01`）且其中已有一个内容为 `*` 的 `.gitignore`，**该文件被 git 完全忽略**（`git check-ignore` 命中所属 `.gitignore:1`），`git status` 中**不出现任何 `.dsh/` 条目** → **对仓库与部署零影响**
- 处置：**未删除**该文件（删除同属对 `.workspace` 之外的写入，且无法确证其此前是否已存在），**保留现状并在此披露**
- 其余写入**全部**位于 `.workspace/audit-020/t26/**`（源码副本、三套 `node_modules` 符号链接、tarball、测试输出）
- **未**触碰 `~/.dsh/**`、`~/.dsh-017/**` 的任何文件内容；**未**修改工作区内既有 `dsh-taste/` 源码（改造实验一律在 `.workspace` 副本内进行）
- **未**启动任何监听端口的服务；**未**发起任何模型请求

---

## 附：本轮使用的证据文件（均在 `.workspace/audit-020/t26/`）

| 文件 | 内容 |
|---|---|
| `deepseek-ai-dsh-taste-0.1.0.tgz` | `npm pack` 规范制品（sha256 `4072ca8e…`） |
| `dsh-taste-src/` | 源码副本（含 U1 未改版）+ 指向 0.2.0 依赖树的符号链接 |
| `dsh-taste-src-017/` | 指向 0.1.7 依赖树的对照副本 |
| `dsh-taste-src-011/` | 指向 0.1.1 依赖树的对照副本（= 历史 peerDeps 目标代） |
| `test-011.txt` / `test-017.txt` / `test-020.txt` / `test-020-full.txt` | 三套依赖树的完整 TAP 输出 |
| `test-020-patched.txt` | 施加 U2 夹具补丁后的 0.2.0 输出（215 pass / 3 fail） |
| `R020-{1,2,3}.txt`、`stable020.txt` | 0.2.0 三次复跑的失败集合与稳定性交集（证明 199/19 稳定） |
| `diffs/dsh-client-ui-sidebar.client.diff`、`diffs/dsh-client-ui-layout.client.diff` | 槽位宿主包 0.1.7→0.2.0 的实际差异（证明与 taste 无关） |
