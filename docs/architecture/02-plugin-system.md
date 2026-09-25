# 02 · 插件体系（plugin contract · 组合图装载 · 冷热边界）

> **Tier 3 · 参考** · [指南地图](../../README.md) · [程序笔记本](../program-notebook.md) · [架构总览](01-architecture-overview.md)

> **数据时点**：2026-09-20 ｜ **部署基线**：`@deepseek-ai/dsh` **0.1.1-rc.2**（profile `web`）
> **范围**：插件契约、最小文件集、host/client 两面、组合图装载顺序、settings 槽、`cordis.patch.yml` 条目语义、热载矩阵。
> **本页不包含**：模型路由与网关（→ `03-model-routing-gateway.md`）、补丁重放与重启操作（→ `04-ops-deploy.md`、`../runbooks/`）。

---

## 1. 归属表

| 职责 | 归属 | 判据 |
| --- | --- | --- |
| 插件**源码** | 本仓库插件目录 | 各目录自带 `package.json` |
| 插件**运行时装单位** | `~/.dsh/profiles/node_modules/@local/`（真实目录，非符号链接） | 见 §6 |
| 插件**挂载入口** | `~/.dsh/profiles/web/cordis.patch.yml` 的 `insert` 列表 | 该文件不在本仓库 |
| 组合图装配与 patch 应用 | 官方包 `@deepseek-ai/dsh-app-boot` | §4.1 |
| client bundle 的注册与换版 | 官方包 `@deepseek-ai/dsh-client-modules` / `dsh-client-hmr` | §4.3 |

判据（可复判）：如果移除本页，读者仍能从 `01-architecture-overview.md` 知道「有哪些插件」，
但**无法**知道「插件怎么写、怎么进进程、改哪一层要重启」——后者是本页的独有职责。

---

## 2. 插件契约与最小文件集

### 2.1 最小文件集（脚手架 `examples/minimal-plugin/`）

| 文件 | 必选 | 内容 |
| --- | --- | --- |
| `package.json` | **必选** | `name` / `version` / `type: module` / `main` / `exports` / peer 依赖 / 可选 `dsh` 段 |
| `lib/index.js` | **必选** | host 插件：`name` / `inject` / `apply` /（可选）`Config` |
| `lib/client.js` | 可选 | client bundle：`window.__ModuleLoader__.load({id, factory})`；host-only 插件不需要 |
| `cordis.patch.yml` | 可选 | 只有声明 `dsh.bundle.patch` 的包才需要（本仓库仅 3 个包有） |

脚手架**没有** `cordis.patch.yml`：挂载靠 profile 层 `insert`，不在插件包内。

### 2.2 host 契约（4 个导出）

```js
// 契约（宿主 cordis 插件必需导出）：name / inject / apply / Config（可选）。
export { Config, MINIMAL_SETTINGS_NS, apply, inject, name };
```

| 导出 | 语义 |
| --- | --- |
| `name` | 插件 id，用于 `cordis.patch.yml` 的 `insert` 条目 id 语义 |
| `inject` | 声明所需宿主服务（例：`["tools"]`）；cordis 保证就绪后才调用 `apply` |
| `apply` | 装配点：注册工具、注册设置命名空间、`ctx.effect` 清理 |
| `Config`（可选） | schemastery/zod schema，配合 `installSettingsSection` 得到字段级设置 |

- 工具注册：`ctx.tools.register(defineTool({ name, description, … }))`。
- 卸载清理：`ctx.effect(() => () => { … }, "dsh-minimal-plugin: cleanup")`——返回的 dispose 函数在卸载时执行。

**纪律（脚手架 README 明文）**：

1. **client 模块 `id` 必须等于 `package.json` 的 `name`**（曾因此出过启动事故）。
2. **工具名前缀**：`ws_` / `minimal_` 这类前缀避免与官方/其它插件重名。
3. **高危操作走 `ctx.approval.request`** 确认模态（fail-closed，先例：`ws_flash`）。

### 2.3 client 契约（可选面）

- 手写 bundle 惯例：`__ModuleLoader__.load({ id, factory })` 自注册；platform 种子词
  `react` / `react/jsx-runtime` 可用。
- 要启用 client 面：在 `package.json` 增加 `dsh.client` 声明（含 `platform: "web"` 与 `inject` 列表）；
  **改后需重启 web 一次**。
- `slots` 不存在时优雅降级（host-only 环境）：

```js
const slots = ctx.get("slots", false);
if (slots === undefined) return; // 无 UI 槽环境（host-only 场景）优雅降级
```

---

## 3. settings 槽与设置命名空间（两侧各自的 API）

**客户端侧**（本仓库实际用过**三个不同槽名**，不是只有一个）：

| 槽名 | 使用者 |
| --- | --- |
| `settings.section` | `examples/minimal-plugin/`（示例） |
| `settings.plugin.item` | `dsh-usage` |
| `settings.general.item` | `dsh-wallpaper-local` |

非 settings 槽先例：`sidebar.footer.action` / `shell.overlay`（`dsh-taste`）、
`conversation.session.header.actions`（`dsh-btw`）。

**宿主侧**两条注册路径：

1. `installSettingsSection(ctx, NS, Config, config, { setSource, onChange })` + `settingsNamespace()`（推荐，field-level 读写）；
2. `ctx.inject(["settings"], (c) => c.settings.register(ns, schema))`（直接注册命名空间）。

设置值经 `settingsNamespace` 落到 `~/.dsh/settings.yaml` 的对应段（例：`vision-adam`、`dsh-subagent`、`wallpaper`）。

---

## 4. 组合图装载（真代码路径）

### 4.1 装配顺序

```
bundles 层（dsh.profile.bundles 顺序，逐个应用其 dsh.bundle.patch）
  → profile 自身层（~/.dsh/profiles/web/cordis.patch.yml）
    → home 层（$DSH_HOME/cordis.patch.yml）
      → --patch overlays（命令行覆盖层）
```

- patch 文件名常量：`PROFILE_PATCH_FILENAME = "cordis.patch.yml"`。
- 装配由官方包 `@deepseek-ai/dsh-app-boot/lib/index.js`（1216 行，**未压缩、带 JSDoc**）实现；
  入口之一是 `loadProfile(binName, name, installAnchor, home, options)`。
- 加载逻辑**不在** 全局安装树的 `lib/` 目录（那里只有 6 个文件、最大 283 行的 esbuild 产物）。

### 4.2 `cordis.patch.yml` 的条目语义

| 条目形态 | 语义 | 本仓库/本部署实例 |
| --- | --- | --- |
| `- insert: [{id, name, config?}]` | 新增插件到组合图 | `- insert:` / `- id: btw` / `name: '@local/dsh-btw'` |
| `- id: X` + `config:` | 对已有条目做 id 级配置覆盖 | `- id: agent-presets` / `config:` / `default: standard-glm` |
| `- id: X` + `disabled: true` | 停用某条目 | `- id: directory-picker` / `disabled: true` |
| `!!js <expr>` | 配置值可含 JS 表达式（home 路径等） | `config:` / `root: !!js dshHomePath('office-ppt')` |

**硬约束**：`insert` 的 `name` 必须是 **bare 包名**——用文件路径名在运行实例里 `import` 不执行，
且会导致**整次回滚**（实测固化）。

**失败即大声失败**：非顶层数组、bundle 缺 `dsh.bundle`、`--patch` 指向缺文件——都直接抛错/中止，不静默降级。

### 4.3 client 面：bundle 怎么进浏览器

- 官方 `ClientModuleRegistry` 扫描活动 loader 条目的 `package.json`，把有 `dsh.client` 的包编成图。
- graph 行 url 形如 `/plugins/<id>/client.js?rev=<hash>`，取 `exports["./client"]`；
  缺 `exports["./client"]` 直接抛错（不静默跳过）。
- 内容哈希换 `rev` ⇒ 浏览器刷新即见新 bundle；`dsh-client-hmr` 通过 `/plugins/events` SSE 推送 `rebuilt` 帧。
- boot 页注入 `window.__DSH_BOOT__`（仅 `dsh web` 注入，故 `apps/web` 的 Vite 入口不是独立应用）。

---

## 5. 冷热边界矩阵

| 改动对象 | 生效方式 | 代价 | 证据 |
| --- | --- | --- | --- |
| `cordis.patch.yml` 的 `insert` / `remove` / `disable` / `name` / `config` 覆盖 | **热①（约 1s）** | 无 | deploy-lag README §9.1 实测 |
| `~/.dsh/settings.yaml` 的**值**（行为开关键、`contextWindow`、`dsh-subagent:` 段、btw 默认模型） | **热②（下一次读取即新值）** | 无 | p0b §4 五步链实测 |
| 插件 `lib/client.js` 替换 | 刷新浏览器（或等 SSE 换 rev） | 手动刷新 | p0b §5 |
| `package.json` 的 `dsh.client` 声明变更 | **冷（需重启）** | 重启 | p0a §3（pkgMeta 缓存） |
| 插件宿主 `lib/*.js` | **冷（需重启）** | 重启 | deploy-lag §9.2 |
| `module.exports` / settings **schema** 变化 | **冷（随插件部署重启一次）** | 重启 | p0b §4/§5 |
| preset 文件（`~/.dsh/.agent-presets/*/agent.cordis.yml`） | **新建会话**即生效；已存在会话保持原代际 | 新开会话 | `dsh-agent-presets` 的 `compositionStamp`(mtimeMs+size) 检查 |
| 纯函数模块热载（B 通道） | **尚不可用** | — | `FEATURE-MAP.md` §三；p1 闸门实验 |

> **机制级边界**：条目热载只**重新应用配置**，不重读模块（ESM 缓存）。因此「改宿主 lib 代码」
> 永远落在冷面——这是本仓库无数「改了没生效」问题的同一根因。

---

## 6. 部署形态：源码仓库 vs 运行时装单位

| 项 | 值 |
| --- | --- |
| 源码仓库 | `/home/CNS2026495165/dsh`（本仓库） |
| 运行时装单位 | `~/.dsh/profiles/node_modules/@local/`（**真实目录拷贝，非符号链接**） |
| 该目录下的实体 | `dsh-btw` / `dsh-pptmaster` / `dsh-ssh-gui` / `dsh-subagent-model` / `dsh-usage` / `dsh-wallpaper` / `dsh-workerspace` |
| 依赖解析 | `~/.dsh/profiles/node_modules` 是**符号链接农场**，指向全局安装树 |

**两条硬约束**：

1. **绝不对 `~/.dsh/profiles/web` 执行 `npm/pnpm install`**——曾致全体补丁失效（事故档见
   `.workspace/reports/runbooks/master-runbook.md` §1b）。
2. 部署位的包名以 `package.json` 的 `name` 为准，**不是目录名**：`dsh-wallpaper-local/` 装成
   `@local/dsh-wallpaper`；`session-board/dsh-session-board/` 的包名是 `@deepseek-ai/dsh-session-board`。

---

## 7. 未验证项

1. 客户端收到 `rebuilt` SSE 帧后是否**自动重载**（vs 需手动刷新）——未读客户端代码确认。
2. `settings.section` 槽的**宿主提供方包**未定位（只确证消费侧写法与三处先例）。
3. cordis 内核 `EntryGroup.update` / `Entry.update` / `_patchContext` 的逐行实现未读（结论以实测+官方包注释为准）。
4. `bareModuleBaseUrl` 的实参来源未定位。
5. `@deepseek-ai/dsh-session-board` 的运行时装单位未确证。
6. `dsh-btw/lib/index.js`（约 65 KB）与 `dsh-taste/lib/index.js`（约 27 KB）未逐行通读，本文对其内部结构的描述属声明级。
7. 本节 §8 的"全局用户根对所有工作区生效"结论为**源码 + 既有先例**推证，**未**在别的 cwd 起过新会话做端到端确认（沙箱内任何 `dsh` 启动都要写 `~/.dsh/profiles/`，被 EACCES 挡下）。

---

## 8. skill 发现根与优先级（2026-09-23 实测）

skill 由插件 `@deepseek-ai/dsh-skill-filesystem` 的 provider 发现（包版本 `0.1.1-rc.2`，config schema：`includeDefaultRoots` 默认 `true` / `dshHome` / `agentsHome` / `customSkillDirs` 默认 `[]` / `bundledSkillDir`；`package/lib/index.js:33-36`）。三类根：

| 根 | 路径 | 来源标记 | rank | 作用域 |
| --- | --- | --- | --- | --- |
| 项目 | `<projectRoot>/.dsh/skills` | `project-dsh` | 100 | **按 cwd**（`findProjectRoot(cwd)`） |
| 项目 | `<projectRoot>/.agents/skills` | `project-agents` | 200 | 按 cwd |
| 自定义 | `settings` 的 `customSkillDirs`（本部署未设） | `custom` | 300 | 全局 |
| **用户** | `$DSH_HOME/skills`（= `~/.dsh/skills`，`skipSystem:true`） | `user-dsh` | 400 | **与 cwd 无关，所有工作区** |
| 用户 | `$DSH_AGENTS_HOME/skills`（默认 `~/.agents/skills`） | `user-agents` | 500 | 与 cwd 无关 |
| 插件 | `bundledSkillDir` / `ctx.skills.registerProvider`（如 `@local/dsh-pptmaster` 的 `skills/`） | `bundled` 等 | — | 全局，随插件 |

证据：`.../dsh-skill-filesystem/lib/index.js:150-188`（`roots(cwd)`；项目两根受 `cwd !== undefined` 门控，**用户两根无条件加入**）、`:21-25`（rank 常量）。

**三条硬事实（本部署实测）**

1. 同一层内**同名 skill 只留高优先级那份**，被忽略者只打一条 `warn`：`dsh-skill/lib/index.js:319-323`（`skill "<name>" from <source> ignored because a higher-priority skill already exists`）。rank 数字**越小越优先**（项目 100 > 项目-agents 200 > custom 300 > 用户 400 > 用户-agents 500）。
   ⇒ **不要在两处放同名 skill**（会静默出现"改了全局那份但在本项目不生效"）。
2. **符号链接不可靠**：发现逻辑只接受 `entry.type === "directory"` 或 `.md` 文件（`:586-593`），而 fs 列目录把软链标为 `type: "symlink"`（`.../dsh-fs-local/lib/index.js:203` `pathLinkType`）⇒ 用软链挂 skill 目录会被静默跳过。跨根共享请用**真实目录**。
3. `disable-model-invocation: true`（frontmatter）的 skill **不进模型可见目录**（例：`~/.dsh/skills/grill-me`），只在被显式点名时加载。

**本部署现状**：`~/.dsh/skills/` = `grill-me`（手动）、`ppt-master`（含 `references/`、`scripts/`、`templates/`、`workflows/`）、`program-notebook`（2026-09-23 从本仓库 `.dsh/skills/` **移入**，使全部工作区可用；仓库内原副本已删除，避免第 1 条的遮蔽陷阱）、`session-handoff`（2026-09-25 新增：会话交接文档生成 + 接手双模式，v1.0.1；仓库内**非发现路径**的分发快照在 `agent-skills/session-handoff/`，两处须逐字节一致——见 `docs/program-notebook.md` §5.2）。
