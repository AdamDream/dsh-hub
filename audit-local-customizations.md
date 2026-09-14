# 本机 DSH 本地定制全清点 + 升级爆炸半径评估

日期：2026-09-11　范围：`~/.dsh/`、`~/.dsh/profiles/web/`、扁平 fallback 目录、会话工作区 `/home/CNS2026495165/dsh/`
方法：全部结论以**文件系统实测**为依据（mtime / 哈希 / 符号链接可达性 / 解析实测 / 源码读取），不凭印象。

---

## 0. 环境基线（实测）

| 项 | 值 | 依据 |
|---|---|---|
| 运行版 | `@deepseek-ai/dsh@0.1.1-rc.2` | `profiles/web/node_modules/@deepseek-ai/dsh/package.json` |
| 运行进程 | PID 1640228 `node .dsh/profiles/web/node_modules/.bin/dsh web`，cwd=`profiles/web` | `ps` + `/proc/1640228/cwd` |
| 安装时间 | 2026-08-28 09:54（`package-lock.json` / `yarn.lock` / `.package-lock.json` 同秒） | mtime |
| npm registry | `registry.npmmirror.com` | `.package-lock.json` 的 `resolved` 字段 |
| web 侧官方包数 | `profiles/web/node_modules/@deepseek-ai/` = **199** 条 | `ls \| wc -l` |
| 客户端插件表 | 运行服务实际注册 **45** 个插件（含 `@local/dsh-btw`、`@local/dsh-wallpaper`、`@deepseek-ai/dsh-taste`） | `GET /` 的 `__DSH_BOOT__.entries` |
| 扁平 fallback | `profiles/node_modules/` **无 package.json**（非 npm 管理，手工扁平目录）；顶层 241 链接 / `@deepseek-ai` 202 链接 | 实测 |

### 0.1 DSH 对扁平目录的官方语义（决定"幸存的依据"）

读 `profiles/web/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js`：

- L391-405：扁平目录 = "one symlink per package in the dsh app's resolvable dependency CLOSURE (BFS)"，**幂等**："correct links are kept and moved installations are re-pointed; a stale link to a vanished package stays until its name is reused"。
- L370-390 `ensureSymlink`：**"a real directory throws"** —— 若目标路径已是真实目录，DSH 直接抛 `dsh: <path> exists and is not a symlink; remove it so dsh can manage the installation fallback`。
- L344-369 `initProfile`："Existing files are never touched, so re-running is a no-op on an initialized profile." —— `package.json` / `cordis.patch.yml` / `pnpm-workspace.yaml` **仅在缺失时创建**。
- L457-488 `writeProfileManifest`：唯一重写 manifest 的路径，且 `...manifest` 展开保留原字段，只规范化 `dsh.profile.bundles`。

⇒ **推论（后文反复引用）**：
1. 扁平目录里 DSH 只维护自己闭包的链接，**从不剪枝非官方条目** → 放在那里的真实目录（用户的私有插件）**在 DSH 重启与 npx 重装下均幸存**。
2. 若上游新版**恰好有个包与用户真实目录同名**，`ensureSymlink` 会抛错 → **启动失败**（潜在命名冲突风险，见 §4 无法判定项）。
3. `profiles/web/` 内的三个脚手架文件**不会被 DSH 覆盖**。

---

## 1. 定制资产表

图例：类型 = 配置 / 插件 / 补丁 / 数据 / 脚本；幸存判定分「升级路径 a/b/c」三列，见 §2。

### 1.1 `~/.dsh/` 顶层（**在 profile 之外**）

| 路径 | 类型 | 作用 | 升级后幸存 | 依据 |
|---|---|---|---|---|
| `AGENTS.md` (12K, 9-11) | 配置 | 主 agent 方法论（目标锚点 + 三阶段闭环 + 模型路由裁决） | ✅ 幸存 | 位于 `$DSH_HOME`，两套 node_modules 均不覆盖它 |
| `settings.yaml` (8K, 9-11) | 配置 | 全部模型路由与网关（见 §1.1.1） | ✅ 幸存（**键语义可能变**） | 同上；无 schema 清单随包分发，故键兼容性无法静态判定 |
| `.credentials.yaml` (264B) | 数据 | API 密钥 | ✅ 幸存 | 同上 |
| `.anonymous-user-id` (37B) | 数据 | 匿名标识 | ✅ 幸存 | 同上 |
| `install-plugins.sh` (1.1K) | 脚本 | 把 `dsh-vision-adam` 从 orca_core 工作区拷进扁平目录 | ✅ 幸存，但**已失效** | 脚本 L14 的源 `.../orca_core-main/dsh-vision-adam` **实测不存在**（见 §1.3） |
| `.agent-presets/standard-glm/preset.yml` (175B) | 配置 | 自定义 preset 元信息（`name: 标准模式（子代理 deepseek-v4-flash）`, `order: 1`） | ✅ 幸存 | 在 `$DSH_HOME`；由 `cordis.patch.yml` 的 `agent-presets.default` 指向 |
| `.agent-presets/standard-glm/agent.cordis.yml` (13K) | 配置 | preset 插件树：`tool-subagent` / `tool-subagent-fork` 固定 `provider: adam, model: deepseek-v4-flash` | ✅ 幸存 | 同上；**内部引用的插件名是否在新版仍存在**属未知（§4） |
| `taste/` (36K) | 配置+数据 | `config.json`（observer = adam/gpt-6-astra）、`taste.md`（12.8K 偏好条目）、`display.zh.json`、`.migrated-backup-2026-09-03…` | ✅ 幸存 | 在 `$DSH_HOME/taste`，非 node_modules |
| `skills/grill-me/SKILL.md` (1.9K) | 数据 | 用户技能 | ✅ 幸存 | 同上 |
| `sessions/` | 数据 | **11 个按工作区命名的会话目录** | ✅ 幸存（**schema 迁移风险**） | 同上；格式随新版演进属未知（§4） |
| `storages/` | 数据 | `session_projcache.json` (5.6M)、`message_feedback.json`、`workspace.json` | ✅ 幸存（同上） | 同上 |
| `btw/index.json` (392B) | 数据 | btw 侧聊持久化索引（2 条 parent→child 映射） | ✅ 幸存 | 由 `@local/dsh-btw` 读写 `$DSH_HOME/btw` |
| `wallpapers/980648dd-….png` (7.5M) | 数据 | 壁纸原图（`settings.yaml` 的 `wallpaper.global.source` 指向它） | ✅ 幸存 | 同上 |
| `attachments/` | 数据 | 会话附件 | ✅ 幸存 | 同上 |

#### 1.1.1 `settings.yaml` 中"升级会静默改变行为"的配置项

**结论：全部写在 `settings.yaml`（profile 之外）→ 文件本身不会被覆盖；风险在于"新版是否仍识别这些键"，而非"文件被删"。**

| 键 | 当前值 | 作用 | 若失效的后果 |
|---|---|---|---|
| `agent-default-model` | `{provider: adam, model: deepseek-v4-flash}` | 主会话默认模型 | provider/模型名不被识别 → 会话起不来或回落默认 |
| `llm-pi-ai.providers.adam` | `apiKeyEnv: ADAM_API_KEY`, `api: openai-completions`, `baseURL: https://llmapi.roboscience.xyz/v1/`, 40+ 模型清单 | **自定义网关**（本机几乎所有路由的落点） | 整个 `adam` provider 消失 → 全部 agent/子代理/workflow/taste 路由失效 |
| `llm-pi-ai.providers.opencode-go` | `apiKeyEnv: OPENCODE_GO_API_KEY` + 16 个模型 | 第二个自定义网关 | 同上 |
| `llm-deepseek.baseURL` | `https://opencode.ai/zen/v1/models` | **中转网关**（用户明确裁决保留，不切官方端点） | 回落官方端点（用户已明确否决） |
| `web-search-deepseek.baseURL` | `https://opencode.ai/zen/go/v1` + `maxUses: 100000` | 搜索走中转 go 端点 | 搜索走官方端点或失效 |
| `vision-adam` | `{model: glm-5.3-flash, maxTokens: 100000}` | 识图插件配置 | 需 `dsh-vision-adam` 插件在（已装，见 §1.3） |
| `agent-presets.default` | `standard-glm` | 指向自定义 preset | 回落官方 standard（子代理模型路由丢失） |
| `wallpaper.global` | `source: /dsh-wallpaper/media/980648dd-….png`, `darkMask/opacity/blur` | 壁纸 | 需 `@local/dsh-wallpaper` 在（已装） |
| `ui-onboarding.welcomeNoticeVersion` | `2026-08-13.1` | 引导版本 | 无害 |

### 1.2 `~/.dsh/profiles/web/`

| 路径 | 类型 | 作用 | 升级后幸存 | 依据 |
|---|---|---|---|---|
| `cordis.patch.yml` (974B, 9-11) | **配置（核心定制）** | 用户 patch 层：`insert` vision-adam / taste / btw / wallpaper 四条 + `agent-presets.config.default=standard-glm` 一条 | ✅ 幸存（a/b 均不覆盖）；**b 路径需手工重建** | `initProfile` 只在缺失时写；patch 层被声明为"hot-reloaded on long-lived surfaces"（app-boot L310-311） |
| `cordis.yml` (223B) | 配置 | `[]` 空数组；注释明示"The tree is composed as patches… **Edit cordis.patch.yml, not this file**" | ✅ 幸存 | DSH 生成的骨架，非定制 |
| `package.json` (298B) | 配置 | deps `@deepseek-ai/dsh@^0.1.1-rc.2` + `cordis-plugin-group@^1.0.1`；`dsh.profile.bundles = [dsh-base, dsh-web-app]` | ⚠️ **可能被改写** | `writeProfileManifest` 只规范化 bundles 且保留其它字段；但 (a) 路径的 `npm install <新版>` 会改 deps 版本 |
| `package-lock.json` (320K, 8-28) | 配置 | npm 锁 | ⚠️ 会被改写 | `npm install` 必然更新 |
| `yarn.lock` (158K, 8-28) | 配置 | **残留**（本部署实际用 npm；无 yarn 状态文件） | 无关 | `node_modules` 里存在 `.package-lock.json`（npm）而无 pnpm/yarn 状态文件 |
| `pnpm-workspace.yaml` (61B) | 配置 | `packages: [.]` / `nodeLinker: hoisted` / `autoInstallPeers: false` | ✅ 幸存 | DSH 生成，只在缺失时写 |
| `node_modules/` | 插件产物 | 199 个官方包 + **3 处手工补丁**（§1.4） | ❌ **补丁会被覆盖** | `.package-lock.json` 记录 integrity（§2.0） |

**注：`cordis.patch.yml` 中没有任何 `path:` 引用**——全部是 `name:` 模块说明符。实测 4 条 `insert` 全部解析成功（见 §1.3.1），故"path 引用失效"这一风险在当前配置下**不存在**；等效风险转移到"模块说明符能否解析"。

### 1.3 扁平 fallback 目录 `~/.dsh/profiles/node_modules/`

`@local/` 与 2 个手工安装的 `@deepseek-ai/` 条目都是**真实目录**（`@deepseek-ai/` 下 199+ 条中仅这 2 个非符号链接）：

| 路径 | 版本 | 类型 | 结构 | 挂载方式 | 升级后幸存 |
|---|---|---|---|---|---|
| `@local/dsh-btw` | **0.4.0-btw.1** | 插件 | 整包拷贝：`lib/`(9 文件) + `src/` + `tests/` + `docs/` + `tsdown.config.ts` + `vitest.config.ts` + `cordis.patch.yml` + `package.json` | profile `cordis.patch.yml` 的 `- insert: {id: btw, name: '@local/dsh-btw'}` | ✅ 幸存（扁平目录非 npm 管理；DSH 不剪枝非官方条目） |
| `@local/dsh-wallpaper` | **0.5.0** | 插件 | `lib/`(client.js+index.js+types) + `assets/`(2 PNG) + `install.sh` + `cordis.patch.yml` + `package.json`（**无 src**） | profile `cordis.patch.yml` 的 `- insert: {id: wallpaper, name: '@local/dsh-wallpaper'}` | ✅ 幸存 |
| `@deepseek-ai/dsh-taste` | **0.1.0** | 插件 | `lib/`(12 JS) + `scripts/` + `test/` + 4 份 `REVIEW*.md` + `package.json` | profile `cordis.patch.yml` 的 `- insert: {id: taste, name: '@deepseek-ai/dsh-taste'}` | ✅ 幸存（**占用官方 scope 命名空间**，见 §4） |
| `@deepseek-ai/dsh-vision-adam` | **0.2.0** | 插件 | `lib/` + `package.json` + `README.md`（**无 src**） | profile `cordis.patch.yml` 的 `- insert: {id: vision-adam, name: '@deepseek-ai/dsh-vision-adam'}` | ✅ 幸存，但**源已丢失**（见下） |

#### 1.3.1 引用解析实测（全部 OK）

从 `profiles/web/` 出发用 Node 解析（`createRequire`）：

```
OK   @deepseek-ai/dsh-vision-adam -> profiles/node_modules/@deepseek-ai/dsh-vision-adam  (v0.2.0)
OK   @deepseek-ai/dsh-taste       -> profiles/node_modules/@deepseek-ai/dsh-taste        (v0.1.0)
OK   @local/dsh-btw               -> profiles/node_modules/@local/dsh-btw                (v0.4.0-btw.1)
OK   @local/dsh-wallpaper         -> profiles/node_modules/@local/dsh-wallpaper          (v0.5.0)
OK   @deepseek-ai/dsh-base        -> profiles/web/node_modules/@deepseek-ai/dsh-base     (v0.1.1-rc.2)
OK   @deepseek-ai/dsh-web-app     -> profiles/web/node_modules/@deepseek-ai/dsh-web-app  (v0.1.1-rc.2)
OK   @deepseek-ai/dsh             -> profiles/web/node_modules/@deepseek-ai/dsh          (v0.1.1-rc.2)
OK   zod (btw 唯一运行时依赖)      -> profiles/web/node_modules/zod                        (v4.4.3)
```

⇒ **4 条插件引用与 2 条 bundle 引用全部可达，无失效引用。**

#### 1.3.2 ⚠️ 现存脆弱点：5 个断链符号链接（实测已断）

`@local/dsh-wallpaper/install.sh` 头部自述："several entries under `~/.dsh/profiles/node_modules/@deepseek-ai/` are **broken symlinks into a cleared npx cache**"，并列出 5 个包。**实测确认断链**：

| 包 | 链接目标 | 目标存在 | 从 profile 解析 | 插件路由 |
|---|---|---|---|---|
| `dsh-client-ui-slots` | `~/.npm/_npx/1e7f6d9597241db0/...` | ❌ | ❌ MODULE_NOT_FOUND | 404 |
| `dsh-client-ui-primitives` | 同上 | ❌ | ❌ MODULE_NOT_FOUND | 404 |
| `dsh-client-web` | 同上 | ❌ | ❌ | 404 |
| `dsh-client-web-react` | 同上 | ❌ | ❌ | 404 |
| `dsh-client-schema-form` | 同上 | ❌ | ❌ | 404 |

`~/.npm/_npx/1e7f6d9597241db0` 已不存在（现存的是另一个缓存目录 `2453649666e7772c`，其 `@deepseek-ai` 条目数为 0）。
扁平目录整体：**顶层 241 链接中 77 个断链**；`@deepseek-ai` 202 链接中 5 个断链。

**当前影响**：GUI 正常运行，故这些名字在运行期**未通过 Node 解析**被消费（浏览器侧由客户端模块系统满足；但分发出去的 `dsh-client-runtime/client.js` 与 `@local/dsh-btw/client.js` 中**仍含** `require("@deepseek-ai/dsh-client-ui-slots")` / `require("@deepseek-ai/dsh-client-ui-primitives")` 字样）。机制未完全判定，列入 §4。

#### 1.3.3 同步方式（用户项目源码 ↔ 部署产物）

| 项目 | 工作区路径 | 部署目标 | 同步机制 | 一致性实测 |
|---|---|---|---|---|
| dsh-btw | `~/dsh/dsh-btw` (415M) | `profiles/node_modules/@local/dsh-btw` | 工作区 `tsdown` 构建 → 拷 `lib/` 进部署副本 | **`lib/` 5 个 JS 逐文件 sha1 一致**；**`src/` 9 个文件不一致**（部署侧停留在 9-08 16:34，工作区为 9-11 10:09；部署 src 中 `deepseek-v4-flash` 命中 **0** 文件，工作区命中 **3** 文件） |
| dsh-taste | `~/dsh/dsh-taste` (540K) | `profiles/node_modules/@deepseek-ai/dsh-taste` | 同上 | **`lib/` 12 个 JS 全部 sha1 一致** |
| dsh-wallpaper | `~/dsh/dsh-wallpaper-local` (1.2M) | `profiles/node_modules/@local/dsh-wallpaper` | 自带 `install.sh`：`rm -rf $DEST` → `cp -r $SRC $DEST` → `rm -rf $DEST/.git` → 幂等追加 patch 条目 | **`lib/client.js` 与 `lib/index.js` sha1 一致** |
| dsh-vision-adam | **源已丢失** | `profiles/node_modules/@deepseek-ai/dsh-vision-adam` | `~/.dsh/install-plugins.sh`（`rm -rf` + `cp -r`） | 无法比对：脚本 L14 的源目录 `~/Dexterous_Hand_23Dof/Dexterous_Hand_23Dof/orca_core-main/dsh-vision-adam` **实测不存在**（`orca_core-main/` 下无任何 vision 目录） |

**⇒ "以谁为准"的判定（重要）：**
- **运行时权威 = 部署副本的 `lib/`**（浏览器/host 加载的就是它，且与工作区构建产物一致）。
- **源码权威 = 工作区**（`~/dsh/dsh-btw`）。**部署副本里的 `src/` 是 9-08 的陈旧快照，不可作为源码依据**——若有人依据它重建，会丢掉今天刚做的 btw 模型路由（`deepseek-v4-flash` 三选一）。
- **vision-adam 是唯一单点丢失资产**：其源已不存在，**仅存部署副本**，`install-plugins.sh` 已无法复现。

### 1.4 🔴 落在 `node_modules/` 内、**会被重新安装覆盖**的一切

三处**原地手工补丁**，全在 `profiles/web/node_modules/`，全部被 `.package-lock.json` 的 integrity 哈希覆盖：

| # | 文件 | 改了什么 | 时间 | 备份 | npm integrity 条目 |
|---|---|---|---|---|---|
| 1 | `@deepseek-ai/dsh-agent-loop/lib/index.js` | 子代理**不再写** `assistant/chunk` 会话事件：新增 `const isSubagent = (this.options.subagentDepth ?? 0) > 0 \|\| (this.session.header?.delegationDepth ?? 0) > 0;`，并把 `chunkSeqs.push(this.session.append("assistant/chunk", {…}))` 改为 `if (!isSubagent) …` | 9-08 17:04 | ✅ 整目录 `.orig-20260908/`（13 文件，仅 `lib/index.js` 有差异） | `sha512-2uJZ6kjJ3IYLRGn6/NhiZ…` |
| 2 | `@deepseek-ai/dsh-web-search-deepseek/lib/index.js` | 注入中转网关要求的会话头 `"x-opencode-session": crypto.randomUUID()`（L141） | 9-07 16:19 | ❌ **无备份** | `sha512-g8wl7k0Htd0MI5CCh0XHK…` |
| 3 | `@deepseek-ai/dsh-client-ui-subagent/lib/client.js` | subagent 目录行 + 只读子会话页脚显示 `tok/s`（41404 → 42608 B，5 处锚点替换；补丁脚本 `/tmp/patch-subagent.py`） | 9-11 10:58 | ✅ `lib/client.js.bak-20260911-105723` | `sha512-YvlWV2GpDVKR/0Ay4rn9w…` |

**另外**：`@deepseek-ai/dsh-client-ui-subagent/lib/client.js.bak-20260911-105723` 是包目录内的**新增文件**，属"多余文件"，重装该包时随目录一并消失。

**覆盖机制**：`profiles/web/node_modules/.package-lock.json`（291KB, 8-28）为每个包记录 `integrity` + `resolved`。任何 `npm install / npm ci / npm update` 都会按哈希校验磁盘内容，不符即从 tarball 重新解包 → 三处补丁全部静默消失。

### 1.5 会话工作区 `/home/CNS2026495165/dsh/`

| 路径 | 类型 | 说明 |
|---|---|---|
| `dsh-btw/` (415M) | 用户项目源码 | btw 插件源码 + `lib/` 构建产物 + 自有 git |
| `dsh-taste/` (540K) | 用户项目源码 | taste 插件源码 |
| `dsh-wallpaper-local/` (1.2M) | 用户项目源码 | 壁纸插件（含 `install.sh`） |
| `pi-taste-analysis/` (812K) | 分析产物 | taste 分析 |
| `session-board/` (332K) | 用户项目 | 会话看板 |
| `node_modules` → **符号链接** 到 `~/.dsh/profiles/web/node_modules` | 环境链接 | 故工作区依赖直接复用 profile 的 199 个官方包；**升级 profile 会同时改变工作区的依赖视图** |
| `.dsh/taste/taste.md` + `.gitignore` | 配置 | **项目级 taste**（与 `~/.dsh/taste/taste.md` 并存的第二份） |
| `audit-*.md` / `execute-*.md` / `review-*.md` / `execution-*.md` / `verify-runbook.md` / `wiring-plan.md` / `local-api-surface.md` / `README.md` / `btw-wallpaper-plan.md` | 审计产物 | 14 份历史审计/执行记录（含本次 `execution-subagent-tokps.md`） |
| `.git` | 版本控制 | 3 次提交；**59 个未提交改动**（`git status --porcelain`）→ 不能仅依赖 git 做备份 |
| `.gitignore` | 配置 | 忽略 `node_modules`（因是指向 profile 的符号链接） |

---

## 2. 三条升级路径的爆炸半径对照

### 2.0 通用机制（先说明"为什么会被破坏"）

- `npm install` 只管理**自己的** `node_modules`（即 `profiles/web/node_modules/`），**不会动父级的 `profiles/node_modules/`**（扁平 fallback 无 package.json，非 npm 管理）→ 用户的真实目录插件天然幸存。
- 但 `profiles/web/node_modules/` 内的一切按 integrity 重建 → §1.4 三处补丁必失。
- DSH 启动时按 §0.1 的 `ensureSymlink` 维护扁平目录链接（幂等、不剪枝）。

### 2.1 对照表

| 影响面 | (a) 原地升级 `npm install @deepseek-ai/dsh@新版` | (b) 全新 profile + 搬定制 | (c) 只升级部分包（混合版本） |
|---|---|---|---|
| `profiles/web/node_modules/**` 官方包 | 🔴 全部按新版重装 | 🟢 新目录全新安装，旧目录可保留为回退 | 🔴 **部分升级** → 同目录内新旧混装，契约错配面最大 |
| §1.4 三处手工补丁 | 🔴 **全部被 integrity 覆盖抹掉**（agent-loop 子代理 chunk 抑制、web-search 会话头、ui-subagent tok/s） | 🔴 补丁需在新 profile 重新施加（备份可还原） | 🔴 同 (a)，且更易被后继 `npm install` 二次覆盖 |
| `@local/dsh-btw` / `@local/dsh-wallpaper` | 🟢 **文件幸存**（在 `profiles/node_modules`） | 🟢 跨 profile 共享解析仍可达（`profiles/node_modules` 是全局扁平层） | 🟡 幸存，但 peer 失配风险最高（见下行） |
| `@deepseek-ai/dsh-taste` / `dsh-vision-adam` | 🟢 文件幸存 | 🟢 文件幸存（vision-adam **无源可重建，须先备份**） | 🟡 同左 |
| `cordis.patch.yml` | 🟢 不被 DSH 覆盖、不被 npm 触碰 | 🔴 **新 profile 只有模板，5 条定制条目须手工重建**（可直接拷贝旧文件） | 🟢 不动 |
| `profiles/web/package.json` / 锁文件 | 🟡 deps 版本被改写、锁文件重写（`dsh.profile.bundles` 由 `writeProfileManifest` 保留） | 🟢 全新生成 | 🟡 部分改写，锁文件与实装可能不一致 |
| `cordis.yml` / `pnpm-workspace.yaml` | 🟢 `initProfile` 不覆盖已存在文件 | 🟢 自动生成 | 🟢 |
| 4 条插件引用可达性 | 🟢 说明符解析路径不变（`profiles/node_modules` 未变）；**但新版若改了 `client-runtime`/slot 契约 → 加载期报错** | 🟢 同上 | 🔴 **最危险**：host（client-runtime）与各 client 插件版本错配 |
| peer 依赖区间 | 🟡 `@local/dsh-btw` 钉 `>=0.1.1-rc.2 <0.2.0`（14 条 peer）；`dsh-taste` 钉 `^0.1.1-rc.2`。**升到 0.2.x 即违约**；升到 0.1.x 内则满足 | 🟡 同左 | 🔴 同左且叠加混装 |
| `~/.dsh/` 配置与数据（settings / taste / presets / sessions / storages / btw / wallpapers / skills） | 🟢 全在 profile 之外，**文件幸存**；风险仅在**键/格式语义**是否被新版识别 | 🟢 自动沿用（同一 `$DSH_HOME`） | 🟢 同 (a) |
| 工作区 `~/dsh/node_modules` 符号链接 | 🟡 指向 `profiles/web/node_modules` → 依赖视图随升级变化 | 🟡 需改指向新 profile | 🔴 同左 |
| 回退难度 | 🟡 需重装旧版 + 重打 3 处补丁 | 🟢 **最易**（旧 profile 目录原样保留） | 🔴 最难（混合态难以精确回退） |
| 综合风险 | 中 | **低（推荐）** | **高** |

### 2.2 已实测的"版本错配真实后果"（支持 (c) 判为高危）

今天实测到一次真实的契约错配：源码树 `0.1.3-alpha.2` 与运行版 `0.1.1-rc.2` 的 `@deepseek-ai/dsh-client-ui-subagent` 外部依赖集**不同**——

| | 版本 | 外部依赖（bundle 的 `require`） |
|---|---|---|
| 线上 | 0.1.1-rc.2 | react / react-dom / **`@deepseek-ai/dsh-client-runtime/client`** / ui-primitives |
| 源码树 | 0.1.3-alpha.2 | react / react-dom / ui-primitives（**已不再依赖 client-runtime**） |

i18n 约定也不同（0.1.1-rc.2 内联 `` `${formatTokens(v)} tok` ``，无 `tokens.total` 键）。**故当时否决了"把新版构建产物投放到旧运行时"的做法，改为对线上版本做微创补丁**。这正是 (c) 路径风险的实证。

---

## 3. 升级前必备份清单（可直接 `tar`）

总计约 **24 MB**（不含 `sessions/` 与 `wallpapers/` 之外的大件；`wallpapers` 7.5M、`@local` 8.8M、`dsh-btw` 工作区 415M 另计）。

```bash
# 一次性打包全部定制资产（profile 之外 + 私有插件 + 补丁）
tar -czf ~/dsh-custom-backup-$(date +%Y%m%d-%H%M%S).tar.gz \
  -C "$HOME/.dsh" \
    settings.yaml AGENTS.md .credentials.yaml install-plugins.sh .anonymous-user-id \
    .agent-presets taste skills btw wallpapers \
    profiles/node_modules/@local \
    profiles/node_modules/@deepseek-ai/dsh-taste \
    profiles/node_modules/@deepseek-ai/dsh-vision-adam \
    profiles/web/cordis.patch.yml profiles/web/package.json \
    profiles/web/node_modules/@deepseek-ai/dsh-agent-loop.orig-20260908 \
    profiles/web/node_modules/@deepseek-ai/dsh-client-ui-subagent/lib/client.js.bak-20260911-105723 \
  && ls -lh ~/dsh-custom-backup-*.tar.gz
```

**强烈建议一并备份（数据，体积大但不可再生）：**

```bash
tar -czf ~/dsh-data-backup-$(date +%Y%m%d-%H%M%S).tar.gz \
  -C "$HOME/.dsh" sessions storages attachments
```

**工作区（含 59 个未提交改动，不能只靠 git）：**

```bash
tar -czf ~/dsh-workspace-backup-$(date +%Y%m%d-%H%M%S).tar.gz \
  --exclude=node_modules --exclude='dsh-btw/node_modules' --exclude='*/node_modules' \
  -C "$HOME" dsh
```

> 注：`~/dsh/node_modules` 是指向 profile 的符号链接，且 `dsh-btw` 体积 415M 主要来自依赖；用 `--exclude=node_modules` 后体积可控。若需完整保留 btw 的工作区依赖视图，另行 `cp -a ~/.dsh/profiles/web/node_modules` 或保留旧 profile 目录。

**补丁文本备份（比二进制备份更重要，便于在新版重打）：**

- `/tmp/patch-subagent.py`（ui-subagent tok/s 补丁脚本）→ 建议移入 `~/dsh/` 长期保存（`/tmp` 会被清理）。
- agent-loop 的差异可用 `diff -u dsh-agent-loop.orig-20260908/lib/index.js dsh-agent-loop/lib/index.js > ~/dsh/patch-agent-loop.diff` 固化。
- web-search 的补丁**无备份**，建议**立即**生成差异基线：该处仅 1 行（`x-opencode-session` 头），可在升级后按 L141 手工恢复。

---

## 4. 无法判定项（需要上游新版到位或额外信息才能定论）

| # | 事项 | 现状与缺口 |
|---|---|---|
| 1 | 5 个断链包在浏览器端的满足机制 | 实测：扁平目录 5 个链接断链、Node 解析从 profile 与运行进程均失败、`/plugins/<pkg>/client.js` 均 404；但分发出去的 `dsh-client-runtime` 与 `@local/dsh-btw` bundle 中**确实含** `require("@deepseek-ai/dsh-client-ui-slots")` / `require("@deepseek-ai/dsh-client-ui-primitives")`，且 GUI 运行正常。**推断**由客户端模块系统在浏览器侧提供，但未能在不重载浏览器的情况下证实 |
| 2 | `dsh-taste` / `dsh-vision-adam` 的**命名冲突**风险 | 二者占用**官方 scope** `@deepseek-ai/`。据 `ensureSymlink`（真实目录即抛错），若上游某新版闭包中出现同名包 → **DSH 启动直接失败**。无法预判上游命名，故无法静态判定 |
| 3 | `~/.dsh/sessions` / `storages` 的存储格式迁移 | 11 个会话目录 + `session_projcache.json`(5.6M) 的 schema 是否随新版演进并自动迁移，无本地可判定依据 |
| 4 | `settings.yaml` 各键在新版的兼容性 | 无随包分发的配置 schema 清单；`adam`/`opencode-go` 自定义 provider、`llm-deepseek.baseURL` 中转、`web-search-deepseek.baseURL`、`vision-adam`、`wallpaper` 等键是否仍被识别，只能在升级后实测 |
| 5 | `.agent-presets/standard-glm/agent.cordis.yml` 内部插件引用 | 该 13K 文件引用的插件名在新版是否仍存在（如 `dsh-subagent` 的 `tool-subagent` / `tool-subagent-fork` 形态是否变更）未逐条比对 |
| 6 | `@local/dsh-btw` / `dsh-taste` 与新版 client-runtime 的契约兼容性 | peer 区间为 `>=0.1.1-rc.2 <0.2.0` / `^0.1.1-rc.2`；**0.1.x 内的新版是否真的二进制/契约兼容**未验证（今天已证同类错配真实存在，见 §2.2） |
| 7 | `yarn.lock` 的角色 | 与 `package-lock.json` 同期（8-28 09:54），但 `node_modules` 内只有 npm 的 `.package-lock.json`、无 yarn/pnpm 状态文件；判定为历史残留，但**为何同日生成**未查明 |

---

## 5. 结论摘要

- **"升级会覆盖/丢失"的资产 = 3 处**（全部在 `profiles/web/node_modules/` 内、被 `.package-lock.json` 的 integrity 校验抹掉）：
  1. `dsh-client-ui-subagent/lib/client.js` —— 今天的 subagent **tok/s** 补丁（有备份）
  2. `dsh-agent-loop/lib/index.js` —— **子代理不再写 `assistant/chunk`**（有整目录备份）
  3. `dsh-web-search-deepseek/lib/index.js` —— **`x-opencode-session` 中转会话头**（**无备份**）
- **会"丢源"的资产 = 1 处**：`@deepseek-ai/dsh-vision-adam` 源工作区已不存在，仅存部署副本。
- **文件层面幸存、但语义面临风险**：`~/.dsh/settings.yaml`（全部模型路由/网关/中转配置）、`cordis.patch.yml`、`.agent-presets/`、`taste/`、4 个私有插件实体。
- **推荐路径 (b)**：新建干净 profile 再搬定制——旧 profile 目录可原样留作回退，三处补丁与 vision-adam 副本都能有序重施，且避开 (c) 的混合版本错配（今天已实测到该风险的真实后果）。
