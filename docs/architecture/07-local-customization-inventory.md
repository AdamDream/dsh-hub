# 07 · 本地定制清单（`@local/*` 插件 · 挂载的官方件 · 各自的 settings 面）

> **Tier 3 · 参考** · [指南地图](../../README.md) · [程序笔记本](../program-notebook.md) · [组合与插件架构](06-dsh-020-composition-and-plugin-architecture.md)
> **数据时点**：2026-09-30 ｜ **盘点对象**：隔离组合 `.workspace/audit-020/assembly-020/home/profiles/node_modules/`
> **证据根**（下文简写）：
> - `$A` = `.workspace/audit-020/assembly-020`（隔离组合根）
> - `$L` = `$A/home/profiles/node_modules`（**本组合的运行时挂载面**：`@local/` + 官方件 + `dsh-workspace-enhancement`）
> - `$P` = `$A/home/profiles/web/cordis.patch.yml`（**650 行**，本组合的 profile patch 层）
> - **纪律**：本页只描述**这份磁盘件**。仓库源码（`/home/CNS2026495165/dsh/dsh-btw` 等）与部署件**可能不同步**——
>   凡两者结论冲突，**以部署件为准**（先例见 `../program-notebook.md` §5.6.2 勘误 E3）。
>
> **本页不包含**：0.2.0 的组合/patch/settings/技能/会话机制本身（→ `06-dsh-020-composition-and-plugin-architecture.md`）、
> 现役 0.1.1 面上的模块清单（→ `01-architecture-overview.md` §模块清单、`02-plugin-system.md` §6）、
> 迁移门禁与报告索引（→ `../program-notebook.md` §5.6/§5.7）。

---

## 1. 归属表（谁拥有什么）

| 职责 | 归属 | 判据 |
| --- | --- | --- |
| `@local/*` 插件的**源码** | 本仓库目录（`dsh-btw/`、`dsh-usage/`、`dsh-wallpaper-local/` …）或 `.workspace/` 下的候选件 | 各目录自带 `package.json` |
| `@local/*` 插件的**运行时单位** | `$A/home/profiles/node_modules/@local/`（**真实目录拷贝，非符号链接**） | `[实跑]` `ls -la $A/home/profiles/node_modules/` |
| 挂载**入口** | `$P` 的 `insert` 列表 + 少量 id 级 `config` 覆盖 | `[实跑]` `grep -n "^- insert:\|^- id:" $P` |
| 官方件（被 patch/被 insert 的） | `$B`（0.2.0 官方件源码根，288 包）——**不在本仓库** | `06-…md` §1 归属表 |
| 第三方官方外插件 | `$L/dsh-workspace-enhancement/`（**0.2.2**，作者 DobyChao） | `$L/dsh-workspace-enhancement/package.json` |

判据（可复判）：移除本页后，读者仍能从 `06-…md` 知道**机制怎么跑**，但**无法**知道
「本组合到底挂了哪 13 个件、每个件负责什么、它的设置面叫什么名字、改哪个键」——后者是本页的独有职责。

---

## 2. 盘点总表（13 个本地定制件）

`[实跑]` 版本取自各 `package.json`；「settings 命名空间」取自插件内 `ENTRY_ID` 字面量或导出常量；
「挂载点」取自 `$P`。**命名空间 = profile 条目 id** 是本轮核实的关键规则（`06-…md` §4.1）。

| # | 包名 | 版本 | 形态 | 挂载点（`$P:行`） | settings 命名空间 | 一句话职责 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `@local/dsh-btw` | `0.4.0-btw.1` | host + client | `:31-32` insert | `btw` | 侧边只读对话（btw）：贴图经 vision-adam 转文本、子代理树/项目总览跳转 |
| 2 | `@local/dsh-logfile` | `0.1.0` | **host-only** | `:130-135` insert | `logfile` | 宿主日志文件出口：**显式声明 `levels`** + 有界 JSONL 轮转 |
| 3 | `@local/dsh-pptmaster` | `0.1.0` | host + client | `:84-88` insert | `dsh-pptmaster`（无 volatile 字段） | 可编辑 PPTX 生成、场景 QA、模板工作流 |
| 4 | `@local/dsh-ssh-gui` | `0.2.0` | host + client | `:102-119` insert | `ssh-gui` | 分布式控制 GUI（节点抽象 + 远端子功能） |
| 5 | `@local/dsh-subagent-model` | `0.1.0` | host + client | `:120-125` insert | `subagent-model` | 子代理默认模型（provider/model）的 settings 面 |
| 6 | `@local/dsh-usage` | `0.1.0` | host + client | `:49-51` insert + `:632-638` 覆盖 | `usage` | API 用量统计（面积/柱状/热力图） |
| 7 | `@local/dsh-wallpaper` | `0.5.0` | host + client | `:39-41` insert + `:643-650` 覆盖 | `wallpaper` | 静态壁纸（per-page 覆盖 + 暗色遮罩） |
| 8 | `@local/dsh-web-search-sse` | `0.1.0` | **host-only** | `:146-152` insert | `web-search-deepseek-sse` | SSE 容错的 web search provider（官方件的派生物） |
| 9 | `@local/dsh-workerspace` | `0.1.0` | **host-only** | `:81-83` insert | `workerspace` | 本地 USB 串口收发 + 烧录白名单封装 |
| 10 | `@deepseek-ai/dsh-session-board` | `0.1.0` | **host-only** | `:54-57` insert | `session-status-board` | 会话状态看板 |
| 11 | `@deepseek-ai/dsh-taste` | `0.1.0` | host + client | `:27-29` insert | `taste` | 偏好记忆（**自写源码占用官方命名空间**） |
| 12 | `@deepseek-ai/dsh-vision-adam` | `0.2.0` | host + client | `:4-14` insert | `vision-adam` | 识图（`analyze_image` / btw 图片分析） |
| 13 | `dsh-workspace-enhancement` | `0.2.2` | host + client | `:59-80` 三条 insert | `ssh-remote` 等 3 个条目 id | SSH 远程执行底座（3 个 provider + 2 个 UI 行） |

**「13 个」口径**：`reports/PLUGIN-MATRIX.md` 与 `reports/T08-local-plugin-inventory.md` 均按 13 个件计量。
本组合的 `[实跑]` 目录列表**多出一个** `@local/dsh-settings-probe`（`dsh.client` 缺失、`$P` 无挂载行）
——它是 **2026-09-30 11:06 落盘的探测件，不参与组合**，不计入 13。

### 2.1 `@local/*` 客户端半的有无

`[实跑]`（`lib/client.js` 是否存在 + `package.json` 的 `dsh.client` 声明）：

| 有客户端半（7） | 仅宿主半（4） |
| --- | --- |
| `dsh-btw`（372 347 B）、`dsh-pptmaster`（4 098 247 B）、`dsh-ssh-gui`（63 253 B）、`dsh-subagent-model`（18 732 B）、`dsh-usage`（82 225 B）、`dsh-wallpaper`（33 276 B） | `dsh-logfile`、`dsh-web-search-sse`、`dsh-workerspace`、`dsh-settings-probe` |

⇒ **「宿主半 import 成功」不等于插件可用**：客户端半的服务 `inject` 是**独立的**一道门
（0.2.0 曾因 `settingsScope` 被删导致两个客户端插件整块 pending —— 见 `../program-notebook.md` §7 D34）。

---

## 3. 各件的 settings 面（键级）

**通用规则**：0.2.0 的设置页**只暴露标了 `.volatile()` 的字段**（`06-…md` §4.2）。
「无 volatile 字段」的条目**整条不进 served 命名空间**，客户端显示 `status:"unavailable"`。

| 件 | 命名空间 | 键级 settings 面（源码证据） | 本组合在 `$P` 的取值 |
| --- | --- | --- | --- |
| `dsh-btw` | `btw` | `ui.banner` / `ui.modelSelect` / `ui.imageBadge` / `vision.autoTransform` / `model.provider` / `model.default` / `model.options[]`（全部 `.volatile()`；`$L/dsh-btw/lib/index.js:1952-1970`） | 未覆盖（用默认：`provider: adam`、`default: deepseek-v4.1-flash`） |
| `dsh-logfile` | `logfile` | `level` / `maxBytes` / `maxFiles` / `orphanWatch`（`$P:130-135` 注释即其契约） | `level: 2`（error+info+warn）/ `maxBytes: 8388608` / `maxFiles: 3`（硬顶 24 MiB）/ `orphanWatch: true` |
| `dsh-pptmaster` | `dsh-pptmaster` | `root`（required）+ `maxUploadBytes` / `maxSlides` / `workbuddy*` 系列（`$L/dsh-pptmaster/lib/index.js:81953-81970`） | `root: !!js dshHomePath('office-ppt')`；**其余键未覆盖** |
| `dsh-ssh-gui` | `ssh-gui` | `file.maxBytes` / `exec.timeoutMs` / `exec.maxOutputBytes` / `security.confirmExec` / `security.execAllowlist`（全部 `.volatile()`；`:138-152`） | `file.maxBytes: 10485760` / `exec.timeoutMs: 30000` / `exec.maxOutputBytes: 1048576` / `security.confirmExec: true` / `execAllowlist: []` |
| `dsh-subagent-model` | `subagent-model` | **仅 `provider` / `model`，均 `.volatile()`**（`:39-41`） | `provider: adam` / `model: deepseek-v4-pro` |
| `dsh-usage` | `usage` | `ui.tooltip` / `heatmap.peakRing` / `heatmap.monthLabels` / `heatmap.legendNote` / `heatmap.levels`（`.volatile()`；`:95-112`） | `heatmap.levels: 3` / `ui.tooltip: false`（`:632-638`，**晚于** `:49-51` 的 insert） |
| `dsh-wallpaper` | `wallpaper` | `global`（PageSchema）+ `pages.session` / `pages.settings` / `pages.home`（均 `.volatile()`；`:110-115`） | `global.source: /dsh-wallpaper/media/37758c1c-….png` / `darkMask: 0` / `opacity: 0.8` / `blur: 2`（`:643-650`，**晚于** `:39-41`） |
| `dsh-web-search-sse` | `web-search-deepseek-sse` | `apiKey`(`role:"secret"`) / `apiKeyEnv`(`role:"credential-ref"`) / `baseURL` / `model` / `apiVersion` / `maxTokens` / `maxUses`（全部 `.volatile()`；`:46-53`） | 未覆盖；末端由 `- id: web` 的 `searchProvider: deepseek-sse` 选中（`$P:621-624`） |
| `dsh-workerspace` | `workerspace` | `serial.port` / `serial.baudRate` / `serial.logDir` / `serial.backend` / `flash.templates[]`（`.volatile()`；`:92-108`） | 未覆盖（默认 `baudRate: 115200`、`backend: "stty"`） |
| `dsh-session-board` | `session-status-board` | 默认 `enabled: true` / `maxBoardTokens: 500`（`$P:54-57` 注释） | 未覆盖 |
| `dsh-taste` | `taste` | **无 `dsh.bundle.patch`**；不进设置页（本组合 `$P:27-29` 仅 insert，无 config） | 未覆盖 |
| `dsh-vision-adam` | `vision-adam` | `model` / `baseURL` / `apiKeyEnv` / `maxTokens`（全部 `.volatile()`） | `model: gpt-6-astra` / `baseURL: https://llmapi.roboscience.xyz/v1` / `apiKeyEnv: ADAM_API_KEY` / `maxTokens: 393216`（`$P:5-14`） |
| `dsh-workspace-enhancement` | `ssh-remote` 等 | 见其自身 `Config`；`$P:96-101` 对 `directory-picker-ssh` 无 config | `$P:91-101` 仅 `- id: directory-picker` `disabled: true` + `- id: directory-picker-ssh`（无 config） |

> **`$P` 同名条目出现两次的处理**（`usage` / `wallpaper`）：`insert`（`:49-51` / `:39-41`）给出条目与默认 config，
> 文末的 `- id: usage` / `- id: wallpaper`（`:632` / `:643`）做**整对象替换**。
> ⇒ 生效值以上表中的**文末覆盖**为准（这是 `06-…md` §2.3 硬约束 2「`config` 整体替换而非深合并」的本组合实例）。

---

## 4. 挂载的官方件（本组合的 patch 面）

`[实跑]` `$P` 里出现、且**不属于** §2 的官方条目（按 `$P` 行序）：

| 条目 id | 官方包 | 处理方式 | `$P:行` |
| --- | --- | --- | --- |
| `agent-preset-registry` | `@deepseek-ai/dsh-agent-preset-registry` | **id 级 config**：`default: standard-glm` | `:24-26` |
| `directory-picker` | `@deepseek-ai/dsh-host-directory-picker` | **`disabled: true`** | `:89-90` |
| `directory-picker-browse` | `@deepseek-ai/dsh-host-directory-picker-browse` | insert（替代上面被禁的官方件） | `:91-95` |
| `directory-picker-ssh` | `dsh-workspace-enhancement/picker` | insert（+ `$P:96-101` 附近为重复注册规避） | `:68-73` |
| `ui-settings-general` | `@deepseek-ai/dsh-client-ui-settings-general` | id 级 config：`welcomeNoticeVersion: 2026-09-28.1` | `:155-158` |
| `llm-pi-ai` | `@deepseek-ai/dsh-llm-pi-ai` | id 级 config：`providers.adam`（`apiKeyEnv`/`api`/`baseURL`/`models[]`） | `:159-334` |
| `agent-default-model` | `@deepseek-ai/dsh-agent-default-model` | id 级 config：`provider: adam` / `model: deepseek-v4-pro` | `:335-339` |
| `web-search-deepseek` | `@deepseek-ai/dsh-web-search-deepseek` | id 级 config：`baseURL` / `maxUses` / `model` | `:340-345` |
| `ui-theme` | `@deepseek-ai/dsh-client-ui-theme` | id 级 config：`preference: light` | `:346-349` |
| `preset-standard-glm` | `@deepseek-ai/dsh-agent-preset` | insert（用户自建 agent preset，`order: 2`） | `:350-620` |
| `web` | `@deepseek-ai/dsh-web-app` 的 web 行 | id 级 config：`searchProvider: deepseek-sse` / `fetchProvider: http` | `:621-624` |
| `connection` | `@deepseek-ai/dsh-client-connection` | id 级 **`inject`** 覆盖：`[webRuntime, webServer]` | `:630-631` |
| `session-log-deepseek` | `@deepseek-ai/dsh-session-log-deepseek` | 重指 `name` + `config.enabled: false` | `:639-642` |

**三条不得写错的语义**：

1. `- id: directory-picker` + `disabled: true` = **停用官方件**；`directory-picker-browse` 是**替代实现**，不是同一件的别名。
2. `- id: connection` 那条只写 `inject`、**刻意不写 `name` 与 `credentials`**
   （`$P:625-631` 注释：写 `name` 会触发 include 的 name 守卫；写 `credentials` 会把静态 intercept 值置 `null`）。
3. `- id: llm-pi-ai` 的 `providers` 是**整体替换**：`:159-334` 必须复述全部 provider 与 `models[]`，漏掉即丢配置。

---

## 5. 与官方面的重叠与冲突（改之前先看这里）

| 重叠点 | 本地件 | 官方件 | 处置 / 依据 |
| --- | --- | --- | --- |
| 目录选择器 | — | `dsh-host-directory-picker` | **官方件被 `disabled: true`**，改用 `-browse` 后端（`$P:89-95`） |
| 目录选择器（SSH） | `dsh-workspace-enhancement/picker` | `dsh-host-directory-picker-ssh` | 避免重复注册 `directoryPicker`；`$P:68-73` 与 `:96-101` |
| web search provider | `@local/dsh-web-search-sse`（provider id `deepseek-sse`） | `@deepseek-ai/dsh-web-search-deepseek` | 两者**同时挂载**；由 `- id: web` 的 `searchProvider: deepseek-sse` **选择**本地件（`$P:621-624`） |
| 会话日志 | — | `@deepseek-ai/dsh-session-log-deepseek` | **官方件被 `config.enabled: false` 关闭**（`$P:639-642`） |
| 子代理模型 | `@local/dsh-subagent-model` | `@deepseek-ai/dsh-tool-subagent` | 官方件**无 settings 读取逻辑** ⇒ 热路由是**本地补丁**（rc.2 上 691 行 vs 官方 662）——见 `../program-notebook.md` §5.6.1 |
| 宿主日志出口 | `@local/dsh-logfile` | 内置 exporter | 内置 exporter **不声明 `levels`** ⇒ `warn`/`debug` 被级别过滤丢弃；本地件补上（`$L/dsh-logfile/lib/index.js:8-18`、`:262`） |
| 壁纸 / 主题 | `@local/dsh-wallpaper` | `ui-theme` 官方件 | 与官方 `ui-theme` **并存**：`wallpaper` 只管背景，`ui-theme` 管 `preference: light` |
| taste | `@deepseek-ai/dsh-taste`（**自写源码占官方命名空间**） | 无官方同名包发布 | `reports/T26-taste-compat-020.md` C1：**0.2.0 不发布 `@deepseek-ai/dsh-taste`，历史上从未发布过任何版本** |

---

## 6. 边界与诚实声明

1. **本页是「这份磁盘件」的清单，不是「这些插件能用」的证明。**
   `reports/PLUGIN-MATRIX.md` 的 13/13 只覆盖**宿主半 ESM `import()` 成功**；
   客户端半 UI、设置页表单读写、识图工具调用、btw 侧聊面板、SSH 远端子功能**均未逐一验证**
   （见 `../program-notebook.md` §5.6.2）。
2. **源码树 ≠ 部署件**：本组合的 `btw` / `ssh-gui` / `wallpaper` / `workerspace` 四个的**部署件在上一轮已被改造**
   （源码里保留「0.1.7 已无 `installSettingsSection`」注释，例 `$L/dsh-ssh-gui/lib/index.js:65,69`、
   `$L/dsh-workerspace/lib/index.js:41`）⇒ 若按仓库源码派工会对这 4 个**已修件做重复劳动**
   （`reports/PLUGIN-MATRIX.md` 末尾「重要口径声明」）。
3. `@local/dsh-settings-probe` **不计入**定制清单（探测件，2026-09-30 11:06 落盘、无挂载行）——见 §2 注释。
4. **本页未做**：未逐个打开 13 个件的 `lib/client.js` 核对客户端行为；未在本页重跑 `PLUGIN-MATRIX` 的 import 实测
   （13/13 与 3 个 FAIL 的数字**引自 `reports/PLUGIN-MATRIX.md`**，本轮未复跑）。

> **[未验证]** `dsh-workspace-enhancement` 的 3 个条目 id 与它自身 `Config` 的键级对应关系未在本轮逐键实读
> （表中「`ssh-remote` 等 3 个条目 id」只给出 `$P:59-80` 的挂载事实）。
> **[未验证]** `dsh-taste` 的 settings 面为空的结论来自「`$P` 无 config + 无 `dsh.bundle.patch`」，
> 未打开其 `lib/index.js` 确认是否导出 `Config`。

---

## 7. 维护触发条件

- **新增/删除/改名本地定制件**，或 `$P` 的 `insert` 列表变化 → 更新 §2 与 `../program-notebook.md` §5.1/§5.6。
- **某件的 settings 命名空间变化**（`ENTRY_ID` 改动）→ 更新 §3 与 `06-…md` §4.1（命名空间 = 条目 id）。
- **某件的字段被加/去 `.volatile()`** → 更新 §3，并核对 `../program-notebook.md` §7 D34 的结论行。
- **官方件新增替代品或本地件与官方件出现新重叠** → 更新 §5。
- **部署件相对源码被改造** → 更新 §6 第 2 条（本组合四个已修件的名单会变）。
