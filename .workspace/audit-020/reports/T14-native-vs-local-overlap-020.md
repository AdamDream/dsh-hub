# T14 审计报告：官方原生能力 × 本机私有定制 —— 重叠面在 0.2.0 的变化

- **轨道**：T14（审计阶段；**只产出结论与方案，未改任何产品代码/配置**）
- **目标版本**：`0.2.0-rc.1`；对照版本：现役 `0.1.1-rc.2`（3080）、隔离 `0.1.7-rc.2`（3097）
- **采样时刻**：本轮实测（2026-09-29）
- **只读纪律执行声明**：未启停任何服务（3080/3097 未触碰）、未发起任何模型请求、未读任何密钥正文、未修改 `~/.dsh/**`、`~/.dsh-017/**` 与仓库既有文件；唯一写入 = 本报告文件。未使用 `sandbox_permissions`。
- **证据口径**：【源码】= 本轮实读文件原文 + 行号；【实测】= 本机可复现命令的真实输出；【否定】= 全量检索 0 命中，**必附检索范围**（见 §8）。

---

## 1. 结论摘要

### 1.1 三分类计数

| 判定 | 条数 | 条目 |
|---|---:|---|
| **官方已内置可退役** | **1** | `~/.dsh/.agent-presets/standard-glm/`（目录式 agent preset） |
| **部分重叠需裁剪** | **2** | `@local/dsh-subagent-model`、`@local/dsh-pptmaster` |
| **官方无、必须保留** | **10** | `@local/dsh-btw` `dsh-logfile` `dsh-ssh-gui` `dsh-usage` `dsh-wallpaper` `dsh-web-search-sse` `dsh-workerspace` `@deepseek-ai/dsh-taste`(本地自制) `dsh-session-board`(本地自制) `@deepseek-ai/dsh-vision-adam`(本地自制) |
| **官方无、必须保留（第三方底座）** | **1** | `dsh-workspace-enhancement`（非 `@local/`，但属本机私有定制链） |
| **必须保留（非插件资产）** | **4** | `grill-me` / `ppt-master` / `program-notebook` / `session-handoff` 四个自建技能 |

> 合计 14 个插件 + 4 个技能 + 1 个自建 preset。与并行轨迹 T08（本地插件清点 13 个）**条目一致**：本报告额外把 T08 未单列的 `~/.dsh/.agent-presets/standard-glm/` 与四个技能纳入同一张表，因此表行数为 14 + 4 + 1。

### 1.2 最重要 3 条发现（先给结论）

**发现 1 —— 「`~/.dsh/.agent-presets/` 目录式自建 preset」在 0.2.0 是死机制，这是本轮唯一一条确定可退役项。**
0.1.1 的 `@deepseek-ai/dsh-agent-presets` 含 `lib/types/discovery.js`，其中有 `export const USER_PRESET_DIR = '.agent-presets'` 与目录扫描实现（【源码】`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-agent-presets/lib/types/discovery.js:38`）。0.2.0 该包被**拆成两个**（`dsh-agent-preset` + `dsh-agent-preset-registry`），二者源码中 `.agent-presets` **0 命中**（【否定】检索范围 = `.workspace/iso-020/npm-global/node_modules/@deepseek-ai/**/*.js` 全量 289 包回环，唯一命中是 `dsh-agent-preset-registry/lib/types/invariant.js:11` 的常量名 `'agent-presets-invariant'`，非路径）。官方 README 明确：「Definitions are ordinary plugin rows; **the registry neither scans directories nor accepts preset paths**」（【源码】`dsh-agent-preset-registry/README.md`）。⇒ `~/.dsh/.agent-presets/standard-glm/` 与 `~/.dsh-017/.agent-presets/standard-glm/`（本轮实测二者 `diff -r` **全等**）在 0.2.0 **不会被加载**，且**无静默降级**（直接退回官方 `standard`）。替代写法是 profile patch 的 `insert` 一行 `@deepseek-ai/dsh-agent-preset`。

**发现 2 —— 8/11 个私有定制在 0.2.0 上「不满足导入契约」，失败点是同一个：`@deepseek-ai/dsh-settings` 的两个导出被删除。**
0.2.0 的 `dsh-settings` 删除了 `settingsNamespace` 与 `installSettingsSection`（【源码】对比 `~/.dsh/.../dsh-settings/lib/types/index.d.ts:20,341` 有声明 ↔ `.workspace/iso-020/.../dsh-settings/lib/types/index.d.ts:4-118` 无声明；新版导出面只剩 `redactSecrets` / `SettingsForms` / `SettingsConflictError` 等）。逐个静态解析 11 个定制的 `import { … } from "@deepseek-ai/<pkg>"` 并对 0.2.0 导出面求差：

| 定制 | 缺失符号 |
|---|---|
| `@local/dsh-btw` | `settingsNamespace` |
| `@local/dsh-wallpaper` | `settingsNamespace` |
| `@local/dsh-ssh-gui` | `installSettingsSection`, `settingsNamespace` |
| `@local/dsh-subagent-model` | `installSettingsSection`, `settingsNamespace` |
| `@local/dsh-web-search-sse` | `installSettingsSection`, `settingsNamespace` |
| `@local/dsh-workerspace` | `installSettingsSection`, `settingsNamespace` |
| `@deepseek-ai/dsh-vision-adam`（本地自制） | `installSettingsSection`, `settingsNamespace` |
| `@deepseek-ai/dsh-taste`（本地自制） | 见 §6 保留清单（同族 settings 面） |
| `@deepseek-ai/dsh-session-board`（本地自制） | 见 §6 保留清单（同族 settings 面） |
| `@local/dsh-logfile` / `dsh-pptmaster` / `dsh-usage` / `dsh-workspace-enhancement` | **无缺失**（4 个） |

这与并行轨迹 T13 的结论独立一致（T13 从 settings 重写与 profile 条目 id 语义切入，本轨道从**导入面静态求差**切入，两条路径同结论）。⇒ 0.2.0 迁移**不存在"照搬即用"的定制**；settings 面改造是所有定制的公共前置。

**发现 3 —— 四项 0.2.0 新能力里，三项与本地定制**语义正交**、**不能**互相替代；且被官方「看起来有」的能力，真实挂载面是空的。**
- `dsh-skill-office`（0.2.0 新）**没有被任何 bundle 挂载**：[否定] 检索范围 = `.workspace/iso-020/.../dsh-base/cordis.patch.yml`（94 行 `- id:`）+ `dsh-web-app/cordis.patch.yml`（112 行 `- id:`）+ `dsh-web-app/presets/{standard,minimal,ptc}.patch.yml`，`skill-office` **0 命中** ⇒ 0.2.0 web 面默认**没有** office-docx/pptx/xlsx 技能面。（这与 0.1.7 的表现一致，0.1.7 时它也只被 `dsh-sdk-app` 引用。）
- `dsh-tool-subagent-control`（0.2.0 ）提供 `send_message` / `interrupt_agent` / `list_agents`（【源码】`dsh-tool-subagent-control/package.json` description + `lib/index.js` 中 `name: "send_message"` / `name: "interrupt_agent"`），**是 0.1.1 就已存在的官方包**，并非 0.2.0 覆盖本地能力的增量 —— 本机也没为它写定制。
- `dsh-workflow-ptc` / `dsh-experimental-*`（agent-team、auto-review、voice-input、speech-to-text、schedule-bundle）全部**未被 base/web bundle 挂载**（同上检索范围，逐名 0 命中），且**无一**覆盖本地定制语义（详见 §5）。
- 真正命中本地缺口的是 `dsh-skill-office` **的宿主前置**：0.2.0 新增 `dsh-office-to-pdf` + `libreoffice-kit` + `dsh-tool-workspace-dependencies`（后者提供 `load_workspace_dependencies` 工具，返回 bundled Python/Node/pnpm 绝对路径；【源码】`dsh-tool-workspace-dependencies/package.json` description + `lib/index.js:9-11`）。这是一条**本地目前没有、可白拿**的能力线。

### 1.3 与既有报告的对账

| 既有结论 | 本轨道复核 | 处置 |
|---|---|---|
| `workbuddy-reverse-proxy/reports/017-native-local-feature-overlap.md` §2.1：vision / peer-board / 壁纸 / SSH 远程 / 主机日志 5 项在 0.1.7 **无原生对应物** | **0.2.0 上依然成立**，且本轮补了可复现的否定检索范围（§8） | 采信并加固 |
| 同上 §2.1：`dsh-skill-office` 在 0.1.7 **只被 sdk-app 引用** | **0.2.0 亦然**（本轮实读 0.2.0 三份组合文件，0 命中） | 采信并加固到 0.2.0 |
| 同上 §2.1：「usage / office-PPT / 日志 3 项是同名不同物」 | **0.2.0 上仍成立**：`dsh-token-meter` 提供的是 per-turn `tokenUsage` 投影（【源码】`dsh-token-meter/lib/types/usage-projection.d.ts:57`），非本地 `@local/dsh-usage` 的双源（dsh + Claude Code）历史统计面板 | 采信并具体化 |
| T13 §1.4：0.2.0 的 `subagent-model-selection-settings` **不是**「子代理默认模型」⇒ 定制**不可退役** | **本轨道给出更细的判定**：语义确为「允许模型每次挑选 + 白名单」，确实**不等于**宿主固定默认路由；但「可退役」与否取决于一个**明确的产品取舍**（是否接受"让模型选"替代"宿主定死"）。本轨道裁定为**部分重叠需裁剪**，并把取舍点显式写出（§5.2），供执行档裁决 | **收窄表述，不推翻结论** |

---

## 2. 证据基线：三个「面」的物理位置

| 代号 | 路径 | 身份 | 本轮读法 |
|---|---|---|---|
| **LOC-011** | `~/.dsh/profiles/node_modules/{@local,*,@deepseek-ai}` | 现役 0.1.1-rc.2 本机私有定制落点 | `ls` / `read` / 静态 import 解析 |
| **LOC-017** | `~/.dsh-017/profiles/{web,headless,node_modules}` | 0.1.7-rc.2 隔离实例 | `read`（三份 `cordis.patch.yml`） |
| **PKG-020** | `.workspace/iso-020/npm-global/node_modules/` | **完整 0.2.0-rc.1 安装闭包**，289 个 `@deepseek-ai/*`（278 个版本恰为 `0.2.0-rc.1`） | 全量 `grep` / `read`（只读） |
| **CLI-020** | `.workspace/dsh-020-pkg/x/package/` | `npm pack` 自 registry 的 `@deepseek-ai/dsh@0.2.0-rc.1` CLI tarball 解包 | `package.json` 依赖清单 |
| **TREE-011** | `~/.dsh/profiles/node_modules/@deepseek-ai/` | 现役 0.1.1-rc.2 官方包安装树，252 包 | 对照面 |

> **PKG-020 的效力**：`@deepseek-ai/dsh/package.json` 版本 `0.2.0-rc.1`（【源码】`CLI-020/package.json`），其 `dependencies` + `devDependencies` 共列 **151 个** `@deepseek-ai/*` 直接依赖；PKG-020 是它的传递闭包，因此「0.2.0 有哪些包」这个问题在本轮是**全量可判**的，不依赖抽样。

---

## 3. 仓库与官方包的关系（结论 + 证据）

### 3.1 结论

**本仓库不是官方 monorepo 的检出。** 它是作者个人的 **DSH 插件与定制工作区**（git remote `git@github.com:AdamDream/dsh-hub.git`），承载自装插件源码、官方包补丁/重放脚本、审计与执行证据。它与官方发布包的关系是**"消费方 + 补丁方"**，不是"上游生产者"。

### 3.2 证据

| 判据 | 实读结果 | 证据 |
|---|---|---|
| 仓库根 `package.json` | **不存在** | 【实测】`ls package.json` → `没有那个文件或目录` |
| 仓库根 `pnpm-workspace.yaml` | **不存在** | 同上 |
| git remote | `origin  git@github.com:AdamDream/dsh-hub.git`（fetch/push 同一） | 【实测】`git remote -v` |
| 自述 | 「**dsh-hub — 高度个人定制化的 DSH 插件工作区**」「本仓库是高度个人定制化版本，不是通用发行版」「**本仓库不含通用发行版、官方包源码**」 | 【源码】`README.md:1-3, :22-25` |
| 官方 `@deepseek-ai/dsh` 的 `repository` 字段 | `git+https://github.com/deepseek-ai/deepseek-harness.git`，`directory: apps/cli` | 【源码】`CLI-020/package.json` |

⇒ 官方 monorepo 的 URL 与 remote 完全不同；仓库内既无 workspace 配置也无官方包源码 ⇒ **无一一对应关系**。

### 3.3 `distributions.json` / `distributions-skipped.json` 是什么 —— **任务书前提需更正**

**它们与 DSH、与 `@deepseek-ai/*` 发布包没有任何关系。它们是 Firefox 遥测（telemetry）的直方图导出数据。**

| 判据 | 实读结果 | 证据 |
|---|---|---|
| 顶层结构 | dict，**31 个 key** | 【实测】`python3` 解析 |
| key 前缀分布 | `metrics#gfx.*` **30 个**、`metrics#a11y.*` **1 个** | 同上 |
| key 样例 | `metrics#gfx.checkerboard.duration`、`metrics#gfx.content.frame_time.from_paint`、`metrics#a11y.tree_update_timing` | 同上 |
| 值形态 | `{subtag, nbuckets, bins:[{bin,count}…]}` —— Glean 直方图 | 【源码】`distributions.json:1-25` |
| `distributions-skipped.json` | 数组，每项 `{key, payload_len, subtag, nbuckets}`，41 项，全部 `metrics#gfx.*` / `metrics#a11y.*` | 【源码】`distributions-skipped.json:1-45` |
| 含 `deepseek`/`dsh` 字样 | **0 命中**（两个文件都 0） | 【实测】`grep -c -i "deepseek\|dsh"` → `0` / `0` |
| git 归属 | 两个文件**均未被 git 跟踪**（`git status` 显示 `??`），也**不在 `.gitignore` 里** | 【实测】`git status --porcelain` → `?? distributions.json`；`git check-ignore -v` 无输出；`git ls-files --error-unmatch` 报"未匹配任何 git 已知文件" |
| 同源已入库副本 | 仓库内**已跟踪**的同源副本在 `.workspace/lag-fix/incident2/firefox-telemetry/`（`distributions.json` / `distributions-skipped.json` / `distributions-old.json` / `distributions.txt` + `subagent-units/glean-core_src_metrics_custom_distribution.rs`） | 【实测】`git ls-files \| grep -i firefox-telemetry` |

**推论**：仓库根这两个文件是 `.workspace/lag-fix/incident2/firefox-telemetry/` 工作的**未跟踪散落副本**（名称相同、目录层级不同）。任何「工作区里存在 `distributions.json` / `distributions-skipped.json` ⇒ 本仓库与官方发布包一一对应」的推断**不成立**；`gfx` / `a11y` 命名空间与 Glean subagent 单元文件名 `glean-core_src_metrics_custom_distribution.rs` 已足以定性。

> **给迁移执行档的附带结论**：这两个根目录文件是**噪声**，不承载任何 DSH 语义，迁移时无需处理（既非配置也非清单）。

---

## 4. 私有定制清单表（逐条：提供的功能语义）

> 表内「源」= 部署件的物理落点；「挂载」= 在 `cordis.patch.yml` 中的 entry id。

| # | 定制 | 版本 | 挂载 id | 提供的功能语义（模型面 / 宿主面） | 关键证据 |
|---|---|---|---|---|---|
| 1 | `@local/dsh-vision-adam`（注：作用域名为 `@deepseek-ai/`） | 0.2.0 | `vision-adam` | 注册**唯一模型面工具 `analyze_image`**：读本地**图片或视频**文件 → 交给配置的 vision 模型（OpenAI 兼容 `/chat/completions`，图片走 `image_url`，视频走智谱式 `video_url`）→ **只返回文本**。使纯文本模型也能"看图"，绕开宿主"模型不接受图片输入"的切换守卫。另导出 `analyzeImageBytes` / `resolveOptions` / `resolveApiKey` 供 btw 插件运行时复用 | 【源码】`lib/index.js:1-33`（模块 JSDoc）；`grep defineTool` 命中 |
| 2 | `@local/dsh-btw` | 0.4.0-btw.1 | `btw` | **持久化只读侧对话（btw）**：`@lukeknow0/dsh-side-chat` v0.4.0 的 fork，新增持久化、进行中摘要（digest）、面板内回问通道；注册 `btw` 与 `btw_ask_user` 两个工具；客户端半边为对话面板 | 【源码】`package.json` description；`lib/index.js` 中 `name: "btw_ask_user"` |
| 3 | `@local/dsh-taste`（注：作用域名为 `@deepseek-ai/`） | 0.1.0 | `taste` | **个人偏好学习/注入/路由**（taste library）：从会话轮次采集证据 → learner 提炼 → 经 systemPrompt 注入 + 路由建议；带 Web GUI 桥（`ctx.connection.rpc.handle("/taste", …, {authority:"loopback"})`）与 `/taste backfill` 历史回填 | 【源码】`lib/bridge.js:1-16`；`lib/index.js`、`lib/backfill.js:10-30` |
| 4 | `@local/dsh-session-board`（注：作用域名为 `@deepseek-ai/`） | 0.1.0 | `session-status-board` | **会话状态看板**：装配分组键/存储/渲染/捕获/注入/工具六模块；注册 `query_peers` 工具；Channel A/B 两种注入方式；镜像 `ctx.agents.roots()` 顶层代理；`lastTurn` 幂等表 | 【源码】`lib/index.js:1-30`（中文装配清单 §3）；工具面实测可见 `query_peers` |
| 5 | `@local/dsh-logfile` | 0.1.0 | `logfile` | **宿主侧持久日志出口**：注册一个**显式声明 `levels`** 的 logger exporter，把 warn/info/error 落进**有界 JSONL**（`maxBytes`/`maxFiles` 轮转）+ 孤儿 settings 段巡检（`orphanWatch`）。存在理由是一个真实宿主缺陷：cordis 内置 exporter 不声明 `levels`，而阈值解析为 `exporter.levels?.[name] ?? exporter.levels?.default ?? this.level ?? 1`，级别定义 `error=0/info=1/warn=2/debug=3` ⇒ **warn/debug 被 `continue` 直接丢弃** | 【源码】`lib/index.js:1-20`；**残留缺陷在 0.2.0 仍在**：`cordis@4.0.4/lib/index.js:598-604`（内置 exporter 只设 `colors:3` + `export`，**无 `levels`**）、`:473-474`（阈值解析式） |
| 6 | `@local/dsh-wallpaper` | 0.5.0 | `wallpaper` | **静态图片壁纸**：per-page 覆盖 + 暗色遮罩 + URL/路径/上传三种来源，持久化在 settings；`@frog755/dsh-wallpaper` 的本地 fork；宿主半边暴露 `/wallpapers` | 【源码】`package.json` description；`lib/index.js` 中 `/wallpapers` |
| 7 | `@local/dsh-usage` | 0.1.0 | `usage` | **本机 token 用量统计面板**：**dsh + Claude Code 双数据源**（`ingest-dsh.js` / `ingest-cc.js`）、自绘 SVG 图表、零运行时依赖、settings 卡片式仪表盘；非计费口径 | 【源码】`package.json` description；`lib/` 下 `charts.js` `db.js` `ingest-cc.js` `ingest-dsh.js` `ingest-runner.js` `ingest-worker.js` |
| 8 | `@local/dsh-workerspace` | 0.1.0 | `workerspace` | **SoC/嵌入式本地面**：USB 串口收发+日志（`stty`/`serialport` 双后端），烧录白名单封装（esptool/openocd/dfu-util/uuu/fastboot 模板 + 高危确认模态），产物落 `~/.dsh/workerspace/`。注册工具 `ws_serial_list/open/send/read/close` + `ws_flash` | 【源码】`package.json` description；`lib/index.js` 中 `toolName: "ws_flash"`、`core.js`/`serial.js`/`flash.js` |
| 9 | `@local/dsh-ssh-gui` | 0.2.0 | `ssh-gui` | **分布式节点控制 GUI**：统一节点抽象 `node = {id, name, transport, target}`，transport 覆盖 **`ssh://` 远程主机 / `serial://` 本地 USB 串口（复用 workerspace 串口后端）/ `serial-tcp://` TCP 串口服务器**；连接管理、节点状态、`exec.run` 命令执行、`file.get`/`file.put` 文件操作、目录浏览 + `keyRef` 凭据绑定；走 `dsh-workspace-enhancement` 的 `/dsw` 注册表 + 私有 `/ssh-gui` loopback 通道。**终端控制台外置**（不内嵌交互式终端） | 【源码】`package.json` description；`lib/core.js` 中 `ssh://` `serial://` `serial-tcp://`；`lib/index.js` 中 `ctx.connection.rpc.handle` |
| 10 | `@local/dsh-pptmaster` | 0.1.0 | `dsh-pptmaster` | **自包含可编辑 PPTX 生成链**：6 个模型面工具 `pptmaster_list_templates` / `pptmaster_get_template_pages` / `pptmaster_scene_check` / `pptmaster_scene_create` / `pptmaster_create` / `pptmaster_update_slide`；含**确定性场景 QA**（几何/文字溢出/重叠/图表）、**原生 PPTX 模板保真工作流**（`template_page_number` + `template_reference_rationale`）、**单页聚焦修改**、本地交付 | 【源码】`package.json` description；`grep toolName` 命中 6 个工具名 |
| 11 | `@local/dsh-web-search-sse` | 0.1.0 | `web-search-sse` | **SSE 容错 web 搜索 provider**：`@deepseek-ai/dsh-web-search-deepseek` 的派生实现，**只新增 `text/event-stream` 组装**（其余请求形状/凭据解析/结果映射与原版一致），provider id = `deepseek-sse`。存在理由：部分 Anthropic 兼容网关在请求体带 server-side `web_search_20250305` 时**强制返回 SSE 且忽略 `stream:false`**，而原版无条件 `response.json()` | 【源码】`package.json` description；`lib/index.js` 中 `SSE_PROVIDER_ID = "deepseek-sse"`、`text/event-stream`、`registerSearchProvider` |
| 12 | `@local/dsh-subagent-model` | 0.1.0 | `dsh-subagent-model` | **子代理默认模型设置页 + `dsh-subagent` settings 命名空间**（`provider`/`model` 皆可选）：其解析值是 `subagent`/`subagent_fork` 派发的**热默认路由**，由 `dsh-tool-subagent` 执行层**每轮派发读取并覆盖 preset 静态 `config.agentOptions`**；缺失/读取失败则退回 preset 路由不动 | 【源码】`lib/index.js:1-30`（模块 JSDoc 全文写明机制）；`settingsNamespace("dsh-subagent")` 见 `lib/index.js:26` |
| 13 | `dsh-workspace-enhancement`（顶层，非 `@local/`） | 0.1.2 | `ssh-remote` / `ssh-web-channel`（`directory-picker-ssh` 被 disable） | **SSH 远程开发底座**：`ctx.ssh` / `ctx.subprocess` / `ctx.fs` 三个远程 provider（ProxyJump 链、SFTP 文件系统、PTY over ssh2）+ 本机/远程目录 browse 后端 + 多连接注册表与 `/dsw` RPC。是 `@local/dsh-ssh-gui` 的**阻断性上游依赖** | 【源码】`package.json` description + `exports`（`./ssh` `./subprocess` `./fs` `./picker` `./web` `./client`） |
| 14 | `~/.dsh/.agent-presets/standard-glm/` | — | （经 `agent-presets` config `default: standard-glm` 生效） | **自建 agent preset**：与官方 `standard` 唯一区别 = `subagent` / `subagent_fork` 的 `agentOptions` 固定 `provider: adam` / `model: deepseek-v4.1-flash` | 【源码】`preset.yml` + `agent.cordis.yml:186-207`；两份（`~/.dsh` 与 `~/.dsh-017`）`diff -r` **全等** |
| 15 | 自建技能 ×4（`grill-me` / `ppt-master` / `program-notebook` / `session-handoff`） | — | （经 `skill-filesystem` 发现） | 分别提供：严苛设计面试、AI 驱动 PPTX 工作流、项目笔记本维护、会话交接双模式。落点 `~/.dsh/skills/` 与 `~/.dsh-017/skills/`；`session-handoff` 另有仓库副本 `agent-skills/session-handoff/` | 【实测】`ls ~/.dsh/skills/`；各 `SKILL.md` frontmatter |

**另记 3 项非 `@local/` 但**同样是本机私有定制**、且作用域名借用官方 `@deepseek-ai/`（极易被误判为官方包）**：`dsh-taste`、`dsh-session-board`、`dsh-vision-adam`。三项在 npm registry 上**均不存在**：
- `@deepseek-ai/dsh-vision-adam` → `E404 Not Found`（【实测】`npm view`）
- `@deepseek-ai/dsh-taste` → `E404`
- `@deepseek-ai/dsh-session-board` → `E404`
⇒ 它们**不可能**有任何"官方升级版本"；迁移时必须整体带过去。

**同法对账的一组反例（是官方包，勿误判）**：`@deepseek-ai/dsh-agent-presets` registry 上**存在**（24 个版本，`latest = 0.0.1-rc.1`、`next = 0.1.5-rc.3`、`alpha = 0.1.6-alpha.2`）—— 它是 0.1.x 的官方包，在 0.2.0 被拆成 `dsh-agent-preset` + `dsh-agent-preset-registry`，属**官方包替换**，不是本地定制。

---

## 5. 三分类判定（每格附证据）

### 5.1 `官方已内置可退役`（1 条）

#### R-1 · `~/.dsh/.agent-presets/standard-glm/`（目录式自建 preset）

- **判定**：**可退役**（功能被 0.2.0 的声明式 preset 机制内置覆盖；且该目录**在 0.2.0 不会生效**）。
- **0.2.0 原生等价物**：`@deepseek-ai/dsh-agent-preset`（声明一个 preset 为普通 plugin row）+ `@deepseek-ai/dsh-agent-preset-registry`（注册表 + revision + `default`）。
- **证据**：
  1. 【源码】0.2.0 `dsh-agent-preset-registry/README.md`：「Definitions are ordinary plugin rows; **the registry neither scans directories nor accepts preset paths**.」并给出写法：
     ```yaml
     - id: agent-preset-registry
       name: '@deepseek-ai/dsh-agent-preset-registry'
       config: { default: standard }
     - id: preset-standard
       name: '@deepseek-ai/dsh-agent-preset'
       config: { id: standard, plugins: [] }
     ```
  2. 【否定】`.agent-presets` 路径在 PKG-020 全量 `.js` 中 **0 命中**（唯一命中是 invariant 常量名 `'agent-presets-invariant'`，`dsh-agent-preset-registry/lib/types/invariant.js:11`），检索范围见 §8-A。
  3. 【源码】对照 0.1.1 确实有目录发现：`~/.dsh/.../dsh-agent-presets/lib/types/discovery.js:38` `export const USER_PRESET_DIR = '.agent-presets'`，且 `:14` 注明 `@module …/discovery`「Filesystem discovery of agent presets」。
  4. 【源码】0.2.0 `dsh-web-app/cordis.patch.yml:562` 挂载 `agent-preset-registry`；其 `default` 字段语义为「Preset ID used when none is requested」。
- **退役前置验证（执行档须做）**：
  - **V-R1-a**：确认 `standard-glm` 的**唯一差异**是否仍是「子代理固定路由」。本轮实读 `agent.cordis.yml`：与官方 `standard` 相同的行之外，差异只在 `subagent`/`subagent_fork` 的 `agentOptions`（`:193-195`、`:202-204`）与 `preset.yml` 的 `name`/`description`/`order`。**若确认唯一差异就是子代理路由**，则连这个 preset 都不必重建 —— 直接改用 0.2.0 的原生能力（见 R-2 / §5.2）。
  - **V-R1-b**：把 `agent-presets: { default: standard-glm }` 改为 `agent-preset-registry: { default: standard }`，并确认新会话拿到官方 `standard` 组合（对比工具面是否变了 —— 特别是 `tool-present` / `tool-str-replace-editor` / `tool-bash-persistent` 等 0.2.0 新增行是否会因换 preset 而丢失）。
  - **V-R1-c**：**不要**只删目录就上线。若不改 `default` 而目录失效，0.2.0 会退回部署默认；需确认退回后的组合是**预期**的，而不是无声降级。
- **风险**：`standard-glm` 的名字与描述已经把「子代理固定 v4.1-flash」写进 UI，退役后该文案消失；若用户仍想要「宿主固定默认路由」语义，则该需求**不能**由官方 preset 机制表达（官方 preset 是静态声明，本机现状的"热生效"靠的是 R-2 的私有补丁）—— 此时应转为 §5.2 的取舍。

### 5.2 `部分重叠需裁剪`（2 条）

#### P-1 · `@local/dsh-subagent-model`（子代理默认模型）

- **判定**：**部分重叠**。0.2.0 新增了**原生子代理模型选择面**（设置页 + 服务 + 投影），确实**取代了该插件的一部分存在理由**；但它管理的语义与本地插件**不同**，且本地插件依赖的两条腿（`dsh-settings` 两个导出、`dsh-tool-subagent` 的宿主补丁）在 0.2.0 **双双失效**。
- **0.2.0 原生能力的准确语义**（逐条实读，避免夸大）：
  - 【源码】`dsh-tool-subagent/lib/types/model-selection-settings.d.ts:11-25`：`SubagentModelSelectionSettings { enabled: boolean; allowedModels: AllowedModelRoute[] }`，注释：「**User preference sampled when a new Session receives delegation tools**」「Whether newly composed top-level Sessions **receive model selection**」「**Exact child LLM routes offered** to newly composed top-level Sessions」。
  - 【源码】`dsh-tool-subagent/lib/types/model-selection.d.ts:6-11`：`AllowedModelRoute { provider: string; model: string }` —— 「One **exact** child LLM route **authorized by a user setting**」；`:26-30` `DelegationModelRequest { provider?, model?, reasoning_effort? }` 是**模型面**字段，即**由父模型在每次委派时挑选**。
  - 【源码】`dsh-client-ui-settings-subagent/lib/client.js` 的 UI 文案（实读字符串）：`"Allow agents to choose models for Subagents"`、`"Models agents may choose"`、`"Model selection"`、`"Select at least one model before saving."`、`"Set Subagent recursion depth, count, and models."`，以及关闭态语义「Subagents use configured defaults or inherit the parent agent's model」。
  - 【源码】`dsh-web-app/cordis.patch.yml:66-67` 挂载 `subagent-model-selection-settings`；`dsh-web-app/presets/standard.patch.yml:95` 在 `tool-subagent` 行设 `modelSelectionSettings: true`。
  - 【源码】`dsh-tool-subagent/lib/index.js:582-587`：`modelSelectionSettings !== true` 时**直接 return**（不装模型面选择）；为 `true` 时强制要求 `@deepseek-ai/dsh-tool-subagent/model-selection-settings` 在 Host 作用域内，否则 **throw**。
- **重叠面（可裁剪的部分）**：本地插件的目标是「让子代理跑在**非父模型**的固定路由上」。0.2.0 原生若开启 `modelSelectionSettings` + 白名单，父模型**可以**把子代理指到 `adam/deepseek-v4.1-flash` 或 `adam/deepseek-v4-pro` —— **功能上可达同一结果**，但由**模型**在每次派发时决定，而非宿主定死。
- **不可替代面（必须保留的部分）**：
  1. 「**宿主固定默认路由 + 不随主会话模型变化 + 模型无需显式挑选**」—— 原生 `agentOptions` 是**静态**的（【源码】`dsh-tool-subagent/lib/index.js:258-263` 的 Config schema），原生选择是**模型面**的，两者都不提供"设置页里改一个默认值、改完对后续派发热生效"。
  2. 本地插件的**客户端设置页**（在官方「子智能体」页之外再开一个入口）—— 若原生页已可用，本地页属**重复入口**，应裁剪掉（这是 0.1.7 起就存在的重复，见 `reports/017-native-local-feature-overlap.md` 第 1 条）。
- **取舍点（执行档必须裁决，本报告不代替裁决）**：
  - **选项 A（推荐给"少维护"优先）**：**采用原生**。删除 `@local/dsh-subagent-model` 整个插件；删除 `dsh-subagent:` settings 段与 `standard-glm` preset 里的 `agentOptions` 固定；在 profile patch 里给 `subagent-model-selection-settings` 配 `enabled: true` + `allowedModels: [{provider: adam, model: deepseek-v4.1-flash}, {provider: adam, model: deepseek-v4-pro}]`。**代价**：子代理路由由**模型**决定，不再由宿主保证；需接受"模型这次可能给子代理选了别的白名单内模型"。
  - **选项 B（推荐给"行为不变"优先）**：**保留并重写**。删除客户端设置页（裁掉重复入口），宿主半边改写为「自带 `Config` + 注册成 0.2.0 settings 面」，并对 0.2.0 的 `dsh-tool-subagent` **重新施加派发时读取的宿主补丁**（该补丁在升级时**必然丢失** —— 见下）。**代价**：每次 0.2.0 小版本升级都要重新打这个宿主补丁并复核。
- **升级必然丢失的既存补丁（关键，须先记账）**：现役 `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-tool-subagent/lib/index.js` **不是**官方 0.1.1 的字节：其中 `:108` 注释「hot-reloaded `dsh-subagent` settings namespace over the preset-static」、`:123` `settings.get("dsh-subagent")`、`:527` 注释 `P0' dsh-subagent settings default layer: hot, per-dispatch read.` —— 均为**本地改造**。0.2.0 的官方 `dsh-tool-subagent` 中 `P0'` / `settingsNamespace("dsh-subagent")` **0 命中**。⇒ 升级后**这段逻辑消失**，且**不会有任何报错**，只会静默退回 preset 静态路由。与 T13 §1.2 独立同结论。

#### P-2 · `@local/dsh-pptmaster`（可编辑 PPTX 工具链）

- **判定**：**部分重叠**。0.2.0 新增了官方 **office 技能线**，覆盖"生成/编辑/检查 PPTX"的**基础面**；但本地工具链有一套官方**没有**的**原生 PPTX 模板保真 + 场景确定性 QA + 单页修改**能力，且**官方技能在 0.2.0 web 面根本没挂载**。
- **0.2.0 官方能力的准确语义**：
  - 【源码】`dsh-skill-office/package.json` description：「Bundled Word, PowerPoint, and Excel workflows and structural checks」；资产为 `assets/office-pptx/SKILL.md`（81 行）、`assets/office-docx/SKILL.md`（57 行）、`assets/office-xlsx/SKILL.md`（74 行）、`assets/scripts/check_office.py`（279 行）。
  - 【源码】`office-pptx/SKILL.md`：创建用 **`python-pptx`**（「For a new deck, use `python-pptx` with editable text, tables, and charts」）；检查用 `check_office.py`（「checks ZIP/XML integrity and internal relationships and reports slide count and extracted text」）；渲染用 **`libreoffice-kit` CLI**（`render` / `convert --output *.pdf`）；交付用 `present({files:[…]})`。明确边界：「**Library support for writing PPTX is not a rendering engine or a guarantee that every PowerPoint feature survives editing**」「Structural success does not establish text fit, alignment, readable contrast, or rendering fidelity」。
  - 【源码】`dsh-skill-office/README.md`：挂载方式 `- name: '@deepseek-ai/dsh-skill-office'`，并提供 `assetRoot` / `node` / `cli` 配置；「The provider supplies instructions and scripts; **the deployment supplies its interpreters, authoring libraries, execution tools, and file delivery tool**」。
  - 【否定】**0.2.0 的 base/web bundle 都没有挂它** —— 检索范围 = `dsh-base/cordis.patch.yml`(94 行 `- id:`) + `dsh-web-app/cordis.patch.yml`(112 行 `- id:`) + `dsh-web-app/presets/{standard,minimal,ptc}.patch.yml` ⇒ `skill-office` **0 命中**。
- **重叠面**：都提供「生成可编辑 PPTX + 结构化检查 + 交付」。
- **不可替代面（本地独有，逐条对官方源码）**：
  1. **原生 PPTX 模板保真工作流**：本地有 `pptmaster_list_templates` / `pptmaster_get_template_pages`（源页语义目录 + 简化指引 + 静态 SlideP JSX 结构引用）与 `template_page_number` / `template_reference_rationale` 传参。官方技能是「用 `python-pptx` 自己写」，**无模板源页语义索引**。
  2. **确定性场景 QA**：本地 `pptmaster_scene_check` 产出几何/文字溢出/重叠/图表/工作区图片五类 findings + 内容绑定 hash，并**必须在同轮以该 hash 调 create**。官方 `check_office.py` 只做「ZIP/XML 完整性 + 关系 + 页数 + 抽取文本」，**自述不做** fit/对齐/对比度/保真判断（引文见上）。
  3. **单页聚焦修改**：本地 `pptmaster_update_slide`（按 1-based 页号改一页并产出新 revision）。官方技能是脚本式整体编辑。
  4. **GUI 内交付面**：本地是完整 cordis 插件（有 `./client` 半边），官方是 skill provider + 外置 `present` 工具。
- **裁剪建议（可退役的部分）**：
  - 本地工具链**不必**自带 LibreOffice 渲染/转 PDF —— 0.2.0 的 `libreoffice-kit` + `dsh-office-to-pdf`（【源码】`dsh-web-app/cordis.patch.yml` 挂载 `office-to-pdf`）可以承担。**裁剪项**：本地若有重复实现，改为复用官方；**保留项**：6 个 `pptmaster_*` 工具与其场景 QA。
  - **可白拿的增强**：0.2.0 新增 `dsh-tool-workspace-dependencies`（`load_workspace_dependencies` 工具，返回 bundled Python/Node/pnpm 绝对路径）。若本地 pptmaster 依赖本机 Python/pptxgenjs 环境，可评估改为走该工具，减少环境耦合。
- **退役前置验证**：
  - **V-P2-a**：把 `dsh-skill-office` 显式 insert 进 profile patch，实测 `office-pptx` 技能是否出现在技能目录、`check_office.py` 与 `libreoffice-kit` CLI 是否可用（依据其 README，deployment 必须提供 `node`/`cli` 绝对路径）。**未挂载 + 未配 `node`/`cli` 时不要承诺 office 能力**。
  - **V-P2-b**：**不要**以「官方有 skill-office」为由删本地 pptmaster。至少保留 `pptmaster_scene_check`（确定性 QA）与模板保真（`template_page_number` 链路），否则相关 skill（`ppt-master` / `workbuddy-ppt` / `ppt-template-fidelity`）会失去其指定的工具后端。

### 5.3 `官方无、必须保留`（11 条）

> 本节的每一条都给出**否定检索范围**（§8），以支撑「0.2.0 无此能力」这一否定断言。

| # | 定制 | 0.2.0 检索结论 | 检索范围（§8 编号） | 必须保留的理由 |
|---|---|---|---|---|
| K-1 | `@deepseek-ai/dsh-vision-adam` | 0.2.0 **无** `analyze_image` 工具、**无**视频/图片转文本能力 | A、B | 唯一能"媒体→文本"的路径。0.2.0 与媒体相关的只有 `dsh-compaction-image-offload`（【源码】description「Durable image offload for image-capable routes: replace over-budget request images with placeholders and retry」）—— 那是**把超预算图片换成占位符并重试**，语义**相反**（是减法不是识图）；以及 `dsh-llm-deepseek` 的 vision-token 计量（【源码】`lib/index.js:58-69,178-200`）与 `UNSUPPORTED_CONTENT` 守卫（`:1415`），那是**给支持图片的模型算 token**，不是给纯文本模型看图 |
| K-2 | `@local/dsh-btw` | 0.2.0 **无**侧对话/side-chat | A、B | 持久只读侧对话是独立产品面；与 `dsh-compaction-*`（上下文压缩）、`dsh-session-reference`（跨会话快照引用）语义不同 |
| K-3 | `@deepseek-ai/dsh-taste`（本地自制） | 0.2.0 **无** taste/偏好学习/风格路由 | A、B | 官方**删除了** 0.1.1 的 `dsh-taste` 行（见下 K-3 注）；本机该包是本地自制（registry E404），与官方同名包无升级关系 |
| K-4 | `@deepseek-ai/dsh-session-board`（本地自制） | 0.2.0 **无** `query_peers` / 会话状态看板 | A、B | 官方 0.1.1 的 `dsh-session-board` 在 0.2.0 **整包消失**（见下 K-4 注）；本机该包是本地自制（registry E404） |
| K-5 | `@local/dsh-logfile` | 0.2.0 **无**本地文件日志出口；且**内置缺陷仍在** | A、B | 【源码】`cordis@4.0.4/lib/index.js:598-604` 内置 exporter 只设 `colors:3`+`export`，**不声明 `levels`**；`:473-474` 阈值解析 ⇒ 若不显式声明 `levels`，warn/debug 被丢弃。0.2.0 新增的 `dsh-otel` 是 **OTLP 出口**（发往 `https://dsh-otel-collector.deepseeksvc.com/v1/logs`，【源码】`dsh-base/cordis.patch.yml:211`），**不是本地有界 JSONL**，且受 session-log 授权约束 |
| K-6 | `@local/dsh-wallpaper` | 0.2.0 **无** wallpaper | A、B | 壁纸是纯 Web 外观面，官方 `dsh-client-ui-theme` 只管 light/dark/system 配色 token，无背景图 |
| K-7 | `@local/dsh-usage` | 0.2.0 有 `dsh-token-meter`，但**非**历史用量面板 | A、B | 【源码】`dsh-token-meter/lib/types/usage-projection.d.ts:57` `tokenUsageProjectionDefinition` 是**会话投影**（per-turn/上下文压力），无 dsh+Claude Code 双源历史聚合、无图表面板、无 SQLite 库。`dsh-client-product-analytics` / `dsh-host-product-telemetry-otel` 是**产品分析事件上报**到官方，方向相反 |
| K-8 | `@local/dsh-workerspace` | 0.2.0 **无**串口、**无**烧录 | A、B | 检索 `serialport` / `ttyUSB` / `baudRate` / `esptool` / `openocd` / `dfu-util` / `fastboot` 全 0 命中 |
| K-9 | `@local/dsh-ssh-gui` | 0.2.0 **无** SSH/串口节点控制面 | A、B | 检索 `ssh2` / `ssh://` / `ProxyJump` 全 0 命中。0.2.0 新增的 `dsh-api-terminal-controller`（【源码】description「Session-owned interactive terminals with shell discovery, screen recovery and typed Remote control」）与 `dsh-client-ui-sidebar-terminal` 是**本地交互式终端**（右侧栏 shell tab），**不含 `ssh://`/`serial://` transport 抽象**，不能替代分布式节点 GUI |
| K-10 | `@local/dsh-web-search-sse` | 0.2.0 官方 provider **仍不支持 SSE** | C（最窄但最确定） | 【源码】`dsh-web-search-deepseek@0.2.0/lib/index.js` 全文仅两处响应消费：`:153` `const parsed = await response.json();`（错误分支）与 `:163` `return mapAnthropicResponse(await response.json());`（成功分支）—— **无** `getReader` / `ReadableStream` / `text/event-stream` 处理。⇒ 网关强制 SSE 时报错「unexpected token 'e', "event: mes"」的原故障**在 0.2.0 依然存在** |
| K-11 | `dsh-workspace-enhancement`（顶层第三方底座） | 0.2.0 **无**原生 SSH 远程执行 | A、B | 同上 K-9 范围。0.2.0 的 `dsh-workspace`（【源码】description「Workspace entity registry (ctx.workspaceRegistry): durable workspace records with validated session attachment」）是**本地工作区实体注册表**，`dsh-api-workspace-controller` 是其 Remote 传输，二者都**不含远程主机 transport**。且它是 `@local/dsh-ssh-gui` 的阻断性上游依赖（后者 `import { remoteWorkspacesRoot } from 'dsh-workspace-enhancement'`） |

**K-3 / K-4 的两条关键补充证据（官方包被删除，不等于"没有覆盖"，而是"面被撤走"）**：
- 【实测】本机 `@deepseek-ai/dsh-taste@0.1.0` 与 `@deepseek-ai/dsh-session-board@0.1.0` 均**无 `description` 字段**、目录内含 `REVIEW*.md` / `CONTRACT.md` 等本地评审文档、文件 mtime 为 9 月上旬且权限为 `-rw-------`（本地手写特征），且 registry **E404** ⇒ **本地自制**。
- 【实测】PKG-020 与 TREE-011 的包名集合求差：`dsh-taste`、`dsh-session-board` 出现在**只在 0.1.1** 一侧（即 0.2.0 没有这两个名字的包）。因为本机这两个包是借用了官方名字的**本地包**，所以「0.2.0 没有 `dsh-taste`」这件事**既不能读作"官方撤了该能力"，也不能读作"本地包已过时"** —— 它只说明：这两个名字在 0.2.0 的官方闭包里不存在，**本机必须把自己的那两份带过去**。

**K-5 补充（唯一可"部分裁剪"的保留项）**：`@local/dsh-logfile` 的两件事里，**(b) 有界文件落盘**必须保留（官方无）；**(a) 显式声明 `levels` 打开 warn** 在 0.2.0 也可能通过 profile patch 的 `logger:` 条目达成（0.2.0 内置 exporter 仍读 `this.level`），但 **patch 层的 `logger:` 条目本轮未实测其字段形状**，因此**不建议**据此裁掉插件 —— 见 §7 未验证项 U-3。

---

## 6. 退役清单与前置验证

### 6.1 可删除（退役）清单

| 编号 | 删除对象 | 类型 | 前置验证 | 回滚 |
|---|---|---|---|---|
| **D-1** | `~/.dsh/.agent-presets/standard-glm/`（及其 0.1.7 同源副本 `~/.dsh-017/.agent-presets/standard-glm/`） | 自建 preset 目录 | **V-R1-a/b/c**（§5.1） | 目录保留在仓库/备份即可随时恢复；0.2.0 恢复它**无效**，恢复路径只能是重建为 `@deepseek-ai/dsh-agent-preset` 行 |
| **D-2** | patch 中的 `- id: agent-presets` + `config: {default: standard-glm}` | 组合行 | 改为 `agent-preset-registry: {default: standard}`（0.2.0 id） | 单行还原 |
| **D-3** | `@local/dsh-subagent-model` 的**客户端设置页**（`./client` 半边与 `package.json` 的 `dsh.client`） | 重复入口 | 官方「子智能体」页在 0.2.0 已挂载且可用（【源码】`dsh-web-app/cordis.patch.yml` 挂 `ui-settings-subagent`） | 保留 `./client` 文件，仅从组合中摘除 |
| **D-4**（**仅当采纳选项 A**） | `@local/dsh-subagent-model` 整体 + `dsh-subagent:` settings 段 + `standard-glm` 里的 `agentOptions` 固定 | 整插件 | **V-P1-a**：先在 patch 中给 `subagent-model-selection-settings` 配 `enabled: true` + `allowedModels` 并**实测一轮真实派发**确认父模型能选到目标路由；再删 | 插件目录整体备份；`agentOptions` 是纯声明，单行还原 |
| **D-5** | `@local/dsh-pptmaster` 中与官方 `libreoffice-kit` / `dsh-office-to-pdf` 重复的渲染/转 PDF 分支（**若存在**） | 冗余实现 | **V-P2-a**：先挂 `dsh-skill-office` 并配好 `node`/`cli`，实测渲染可用；**V-P2-b**：确认模板保真与 `scene_check` 不受影响 | 本地分支代码保留在仓库 |
| **D-6** | 仓库根 `distributions.json` / `distributions-skipped.json` | 非 DSH 噪声文件（未跟踪） | 无（已证为 Firefox 遥测；同源副本已在 `.workspace/lag-fix/incident2/firefox-telemetry/` 入库） | 无需回滚；**这只是清理建议，本轨道不执行删除** |

> **D-1/D-4/D-5 是本轨道唯一认可的"删除类"动作**，其余 10 个定制**一律不得以"官方已内置"为由删除**。
>
> **明令禁止的误删（本轮已用证据否证）**：
> - ❌ 以「0.2.0 有 `dsh-skill-office`」删 `@local/dsh-pptmaster` —— 该技能在 0.2.0 **未挂载**，且其能力面是 `python-pptx` 自绘，**不含**模板保真与确定性场景 QA。
> - ❌ 以「0.2.0 有 `subagent-model-selection-settings`」直接保持现状 —— 本地实现的两条腿（`dsh-settings` 导出 + `dsh-tool-subagent` 宿主补丁）**都已失效**，不改就是**静默退回 preset 静态路由**。
> - ❌ 以「0.2.0 有 `dsh-api-terminal-controller`」删 `@local/dsh-ssh-gui` —— 前者是本地交互式终端，后者是 `ssh://`/`serial://`/`serial-tcp://` 节点控制面。
> - ❌ 以「0.2.0 有 `dsh-otel` / `session-log-deepseek`」删 `@local/dsh-logfile` —— 前者是发往官方的 OTLP 出口，后者是本地有界 JSONL。

### 6.2 退役前置验证汇总（执行档 checklist）

| 验证 | 内容 | 通过判据 |
|---|---|---|
| **V-R1-a** | `standard-glm` 与官方 `standard` 的差异是否**只有**子代理路由 | 逐行 diff `agent.cordis.yml` ↔ 0.2.0 `dsh-web-app/presets/standard.patch.yml`，差异集合 = `{subagent.agentOptions, subagent_fork.agentOptions}` |
| **V-R1-b** | 换成 `agent-preset-registry: {default: standard}` 后组合正确 | 新会话工具目录包含 0.2.0 新增行（`tool-bash-persistent` / `tool-present` / `tool-str-replace-editor` 等），且无 `agent-preset-registry` 加载错误 |
| **V-R1-c** | 无静默降级 | 若 `default` 指向不存在的 preset，确认宿主是**报错**还是**静默回退**（本轮未实测，见 U-1） |
| **V-P1-a** | 原生 `subagent-model-selection-settings` 真能达成目标路由 | 一轮真实派发中，父模型在工具调用里带上 `provider`/`model`，子代理实际落到该路由 |
| **V-P1-b** | 「宿主固定默认」是否仍为硬需求 | 用户裁决；若是，走选项 B（重写 + 重打宿主补丁） |
| **V-P2-a** | `dsh-skill-office` 可用 | 技能目录出现 `office-docx`/`office-pptx`/`office-xlsx`；`check_office.py` 可跑；`libreoffice-kit` `capabilities --json` 成功 |
| **V-P2-b** | pptmaster 核心能力未退化 | `pptmaster_scene_check` 返回 pass/warning 且 hash 可与 `pptmaster_scene_create` 配对；模板保真链路（`template_page_number`）可用 |
| **V-SET** | settings 面改造（**所有 8 个受影响定制的公共前置**） | 每个定制的配置项在 0.2.0 有落点：要么进 profile patch 的 entry `config`，要么注册为 0.2.0 的 settings 面；无 `settingsNamespace`/`installSettingsSection` 残留 import |

---

## 7. 保留清单（必须移植的定制）

### 7.1 必须整体移植（10 + 1 条）

| # | 定制 | 移植方式建议 | 关键改造点（0.2.0 契约变化） |
|---|---|---|---|
| K-1 | `@deepseek-ai/dsh-vision-adam` | 源码重建（本地包） | 移除 `installSettingsSection`/`settingsNamespace` 依赖，配置改走自有 `Config`；`peerDependencies` 的 `>=0.1.1-rc.2 <0.2.0` 区间需放宽 |
| K-2 | `@local/dsh-btw` | 源码重建 | `settingsNamespace` → 0.2.0 settings 面；`peerDependencies` 全部为 `>=0.1.1-rc.2 <0.2.0`，需整体重钉；客户端半边 require 的 `dsh-client-runtime/client` 在 0.2.0 已不存在，需改裸标识 `@deepseek-ai/dsh-client-store`（0.2.0 seed 表含该字，见 §7.2） |
| K-3 | `@deepseek-ai/dsh-taste` | 源码重建 | 同族 settings 改造；**注意本机是本地包，registry 无版本可依赖** |
| K-4 | `@deepseek-ai/dsh-session-board` | 源码重建 | `lib/index.js` 装配步骤 0 即 `settingsNamespace + installSettingsSection → current()`，需整段重写；`ctx.agents.roots()` / `sessionProjections` 用 `ctx.get`（服务缺席判空）的写法在 0.2.0 仍适用 |
| K-5 | `@local/dsh-logfile` | 源码重建 | **导入面已 OK**（0.2.0 下静态检查无缺失符号）；但**必须**保留显式 `levels` 声明（`cordis@4.0.4` 缺陷仍在） |
| K-6 | `@local/dsh-wallpaper` | 需改造 | `settingsNamespace` → 0.2.0 settings 面；客户端半边 require 面核对 0.2.0 seed 表 |
| K-7 | `@local/dsh-usage` | 部署件直接复制（**无导入面缺失**） | 导入面无缺失；注意 T08 已实测「仓库源码无法复现部署件」，**必须从部署件搬运而非从仓库重建** |
| K-8 | `@local/dsh-workerspace` | 需改造 | `installSettingsSection`/`settingsNamespace` → 0.2.0 settings 面；其余（`stty`/串口/白名单）无 0.2.0 契约依赖 |
| K-9 | `@local/dsh-ssh-gui` | 需改造 | settings 面改造；依赖 `dsh-workspace-enhancement@0.1.2`（同为硬依赖，见 K-11） |
| K-10 | `@local/dsh-web-search-sse` | 需改造（**改动量小**） | `settingsNamespace` → 0.2.0 settings 面。**好消息**：`dsh-web` 的公开导出面 0.1.1 ↔ 0.2.0 **逐名相同**（【源码】对比两份 `lib/types/index.d.ts` 的 `export` 集合，diff 为空）；官方 provider 仍用 `ctx.web.registerSearchProvider(...)` 且**导出集逐名相同**（【源码】两版 `lib/index.js` 末行 `export { Config, …, DeepSeekSearchProvider, WEB_SEARCH_DEEPSEEK_SETTINGS_NAMESPACE, apply, inject, name };`）⇒ **SSE 组装逻辑可原样搬运**，只需修 settings 面 |
| K-11 | `dsh-workspace-enhancement` | 需改造 | **导入面已 OK**（静态检查无缺失；0.2.0 闭包含其全部 `@deepseek-ai` 依赖：`dsh-fs` `dsh-fs-local` `dsh-fs-sandbox` `dsh-host-directory-picker` `dsh-host-directory-picker-native` `dsh-llm` `dsh-sandbox-policy` `dsh-subprocess` `dsh-subprocess-local` `dsh-timeout` `dsh-tools` 全部 PRESENT）。风险在其他面（T08 记录该 0.1.2 源码线已不存在，只有构建产物） |

### 7.2 与移植相关的 0.2.0 客户端契约（本轮实测，直接可用）

- **0.2.0 客户端 seed 表**（9 个字，【源码】`dsh-web-frontend/dist/assets/index-Dy0OhsZ5.js` 中 `function QS(){return{…}}`）：
  `react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@deepseek-ai/cordis`、`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-ui-dockkit`。
- **新增字**：`@deepseek-ai/dsh-client-ui-dockkit`（0.1.1 **不存在**该目录）。
- **已下线**：`@deepseek-ai/dsh-client-runtime`（0.2.0 闭包与 `dsh` 依赖清单中均无）；`@deepseek-ai/dsh-client-schema-form`、`dsh-client-web`、`dsh-client-web-react` 同样不在 0.2.0 包名集合里。
- ⇒ 客户端半边的 `require`/`import` 只能落在**上述 9 个字**里，否则 0.2.0 加载期 THROW（与 `reports/017-client-store-replacements.md` 的裁定一致，本轨道在 0.2.0 面上复核了字表内容）。

### 7.3 移植时**必须一并搬走**的既存本地补丁（否则静默丢失）

| 对象 | 补丁 | 证据 |
|---|---|---|
| `@deepseek-ai/dsh-tool-subagent/lib/index.js`（现役安装树，**非**官方字节） | `P0'` 派发时读取 `dsh-subagent` settings 命名空间并覆盖 preset 静态 `agentOptions` | 【源码】`:108`（注释「hot-reloaded `dsh-subagent` settings namespace over the preset-static」）、`:123`（`settings.get("dsh-subagent")`）、`:527`（注释 `P0' dsh-subagent settings default layer: hot, per-dispatch read.`）；0.2.0 官方同文件 **0 命中** |
| 六个插件的「现场热修未回流源码」（wallpaper 主题叠层去重、ssh-gui keep-alive guards、pptmaster module-loader id、workerspace `additionalProperties:false`、workspace-enhancement 去重 + keep-alive、vision-adam 0.2.0-v2 演进线） | 详见并行轨迹 T08 §1 关键发现 2 | 本轨道**未重复取证**，直接引用 T08；移植时以**部署件**为 preimage，不要以仓库源码重建 |

---

## 8. 否定断言的检索范围（防假阴性）

> 以下每条「0.2.0 无 X」都对应一个**已执行的、范围明确的**检索。范围外未检索 = 未证。

| 编号 | 检索范围 | 命令形态 | 结果 |
|---|---|---|---|
| **A** | `.workspace/iso-020/npm-global/node_modules/@deepseek-ai/**`（289 包，278 个版本为 `0.2.0-rc.1`，含全部 `lib/*.js` 与 `lib/**/*.d.ts`），排除嵌套 `node_modules/` | `grep -rli <pat> --include=*.js --include=*.d.ts .` | 见 §5.3 各条 |
| **B** | `.workspace/iso-020/npm-global/node_modules/@deepseek-ai/**`（同上）+ 逐包 `package.json` 的 `description` 全量 289 行 dump | 上述 + `python3` 遍历解析 | 用于判断"能力是否以包形式存在" |
| **C** | `dsh-web-search-deepseek@0.2.0/lib/index.js` 全文（341 行），专门检查响应消费分支 | `grep -nE "response\.|\.json\(\)|\.text\(\)|getReader\|ReadableStream\|stream"` | 仅 `:149` `:150` `:153` `:163`，**无流式** |
| **D** | 0.2.0 组合面：`dsh-base/cordis.patch.yml`（94 个 `- id:`）、`dsh-web-app/cordis.patch.yml`（112 个 `- id:`）、`dsh-web-app/presets/{standard,minimal,ptc}.patch.yml` | `grep -c "^\s*- id:"` + 逐名 `grep` | 用于判定"是否实际挂载"（区别于"包是否存在"） |
| **E** | `cordis@4.0.4/lib/index.js` logger 实现（exporter 注册 + 级别过滤） | `sed -n '585,625p'`、`grep -n "levels\|level ?? 1"` | 内置 exporter **无 `levels`** |
| **F** | npm registry（`npm view`，只读查询） | `npm view @deepseek-ai/<name> version` | `dsh-vision-adam` / `dsh-taste` / `dsh-session-board` → **E404** |
| **G** | 本机两代官方包导出面对比：`~/.dsh/profiles/node_modules/@deepseek-ai/<pkg>/lib/types/index.d.ts` ↔ `.workspace/iso-020/.../<pkg>/lib/types/index.d.ts`（只比较 `export` 声明名，不比较实现） | `node` 脚本正则抽取 + 集合差 | `dsh-settings` 删 6 个导出；`dsh-web` / `dsh-fs` **零差异** |

**范围外的空白（不得当作已证，见 §9）**：
- 未检索 `dsh-*` 的 **npm registry alpha/next 版本**（例如 `@deepseek-ai/dsh-vision-something@0.3.x-alpha`）。**本报告的「官方无」仅指 0.2.0-rc.1 安装闭包范围内无**。
- 未检索第三方社区包（非 `@deepseek-ai` 作用域）。
- 未实测任何运行时行为（未启动服务、未发模型请求）⇒ 所有判定都是**源码级**，不是**行为级**。

---

## 9. 未验证项

| 编号 | 未验证内容 | 为什么未验证 | 影响 / 建议下一步 |
|---|---|---|---|
| **U-1** | 0.2.0 中 patch 的 `agent-preset-registry.config.default` 指向**不存在**的 preset 时，是**报错**还是**静默回退**到 `standard` | 需运行实例才能观察；本轨道不得启停服务 | 影响 V-R1-c；执行档在隔离实例上先做这一步，再决定 D-1 的删除时序 |
| **U-2** | `standard-glm` 与 0.2.0 官方 `standard` 的**组合差异全集**（不止子代理路由） | 执行档需拿 0.1.1 官方 `standard` 的等价物与 0.2.0 `presets/standard.patch.yml`（112 行）逐行比；本轮只核了子代理段 | 直接决定 R-1 能否退役；若差异不止子代理路由，则 `standard-glm` 需重建而非退役 |
| **U-3** | 0.2.0 的 profile patch 是否能通过 `logger:` 条目达到「显式声明 `levels`」的效果 | 未实测 patch 层 `logger:` 的字段形状；0.1.1 审计记录称"三层活跃 patch + home 层都没有 `logger:` 条目" | 影响 K-5 能否部分裁剪；**在不实测前一律保留插件**（本报告已如此裁定） |
| **U-4** | `@local/dsh-web-search-sse` 在 0.2.0 上**运行时**是否真能工作 | 需要真实网关 + 真实请求；本轨道禁止发模型请求。仅证明「导入面 OK + 官方 provider 仍未支持 SSE + `dsh-web` 导出面零差异」 | 三件事都指向"可移植且仍必要"，但**运行时未证**；执行档需一次真实 `web_search` 调用 |
| **U-5** | `dsh-workspace-enhancement@0.1.2` 在 0.2.0 的运行时可加载性 | 需启动实例；且其 `peerDependencies` 钉在 `>=0.1.1-rc.2 <0.2.0` 区间 | 本轮只证「导入面符号全在」；它是 K-9 的阻断依赖，**必须先解决它再谈 K-9** |
| **U-6** | `dsh-skill-office` 在 0.2.0 挂载后的**实际可用性**（`node` / `cli` 绝对路径、bundled Python 是否含 `python-pptx`） | 需实际挂载 + 跑 `check_office.py`；且 `dsh-tool-workspace-dependencies` 的 payload（`.workspace/iso-020/pkgs/` 为**空目录**）本轮未取得 | 直接影响 P-2 的裁剪决策与 §1.2 发现 3 的"可白拿能力"是否真能白拿 |
| **U-7** | 0.2.0 的 `settings.yaml` 一次性导入（改名 `settings.yaml.imported`）对现役 12 个顶层段的**逐段**可导入性 | 需运行实例触发导入；T13 从源码侧断言 `dsh-subagent` 段会导入失败（段名 ≠ profile 条目 id），本轨道从「无 `settingsNamespace`」侧得到同构结论，但**未逐段实测** | 影响所有 8 个 settings 面定制的配置落点；建议执行档按 `describe()` 输出逐段核对 |
| **U-8** | 0.2.0 是否仍是「个人定制不受支持」的部署形态（例如 preset 编辑是否需要 Creator 模式 / `plugin_manager`） | 官方 README 提到 "Creator mode authors such bundles in conversation" 与 `plugin_manager` 安装路径，但本轨道未验证该路径在本机可用 | 影响 R-1 替代写法的**落地方式**（直接编辑 patch 文件 vs 走 `plugin_manager`） |

---

## 10. 复现指引

本报告的全部判定可在以下只读命令下复现（不启动服务、不发模型请求）：

```bash
# 0.2.0 全量闭包位置
P=/home/CNS2026495165/dsh/.workspace/iso-020/npm-global/node_modules/@deepseek-ai
# 现役 0.1.1 安装树
A=~/.dsh/profiles/node_modules/@deepseek-ai

# (C) 官方 web-search 是否支持 SSE —— 预期只出现 response.json()
grep -nE "response\.|\.json\(\)|getReader|ReadableStream" $P/dsh-web-search-deepseek/lib/index.js

# (E) cordis 内置 logger exporter 是否声明 levels —— 预期无 levels
sed -n '585,625p' $P/cordis/lib/index.js
grep -n "levels" $P/cordis/lib/index.js | head

# (D) skill-office / experimental-* / workflow-ptc 是否被 base|web bundle 挂载 —— 预期 0 命中
grep -rn "skill-office\|experimental-\|workflow-ptc" $P/dsh-base/cordis.patch.yml $P/dsh-web-app/cordis.patch.yml $P/dsh-web-app/presets/*.yml

# (G) dsh-settings 导出面 0.1.1 → 0.2.0 —— 预期删除 settingsNamespace / installSettingsSection
grep -nE "^export" $A/dsh-settings/lib/types/index.d.ts      # 0.1.1: 有
grep -nE "^export" $P/dsh-settings/lib/types/index.d.ts      # 0.2.0: 无

# (A) .agent-presets 目录发现是否退役 —— 预期无路径命中
grep -rn "agent-presets" --include=*.js $P/ | grep -v node_modules/

# §3.3 distributions.json 定性 —— 预期 0 命中 deepseek/dsh
grep -c -i "deepseek\|dsh" /home/CNS2026495165/dsh/distributions.json

# §7.2 客户端 seed 表
grep -oE "function [A-Za-z_$]{1,3}\(\)\{return\{[^}]*\}\}" $P/dsh-web-frontend/dist/assets/index-*.js | head -3
```

---

*本报告为审计阶段产物，不含会话正文、密钥或原始会话 id。全部结论绑定本轮实测文件证据；否定断言均标注检索范围。*
