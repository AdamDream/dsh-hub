# 审计 D — 插件群与装配状态（独立交叉审计）

- **审计档**：审计阶段子代理（路由 adam/deepseek-v4-flash）
- **审计时间**：2026-09-15 10:4x（进程 1669657 `node ~/.npm-global/bin/dsh web` 运行中，pts/0 启动于 10:38）
- **方法**：只读。逐项以真实盘面证据（文件内容、require.resolve、node --check、venv python 实跑、YAML 容忍解析、:3080 boot JSON、运行进程产物 mtime）为准，不信任何执行报告。
- **总体裁决**：**无需修改（全部 6 项通过）**。未发现任何缺陷；仅 1 条信息性说明（office-ppt 目录惰性创建）。

---

## 1. 恢复插件（taste / wallpaper / vision-adam / usage / session-board）— ✅ 通过

### 1.1 cordis.patch.yml insert 在位且无 disabled — ✅
`~/.dsh/profiles/web/cordis.patch.yml`（活动 profile = web，进程无 DSH_PROFILE 覆盖）容忍解析（!!js 注册为 passthrough）后为顶层数组、15 条 = 12 insert + 1 config + 2 disable。五个恢复插件 insert 全部在位、均无 disabled：

| insert id | name | 行号 | disabled? |
|---|---|---|---|
| vision-adam | @deepseek-ai/dsh-vision-adam | L4-6 | 无 |
| taste | @deepseek-ai/dsh-taste | L14-16 | 无 |
| wallpaper | @local/dsh-wallpaper | L23-25 | 无 |
| usage | @local/dsh-usage | L27-29 | 无 |
| session-status-board | @deepseek-ai/dsh-session-board | L32-34 | 无 |

插件自身导出 name 与 insert id 一致：taste → `const name = "taste"`；usage → `const name = "usage"`；dsh-session-board → `export const name = "session-status-board"`；vision-adam → `const name = "vision-adam"`。

### 1.2 包目录 require.resolve — ✅
自 `~/.dsh/profiles/node_modules` 逐一 `require.resolve` 全部 OK：
`@deepseek-ai/dsh-vision-adam`、`@deepseek-ai/dsh-taste`、`@deepseek-ai/dsh-session-board`、`@local/dsh-wallpaper`、`@local/dsh-usage`、`@local/dsh-btw`、`@local/dsh-pptmaster`、`@local/dsh-workerspace`、`dsh-workspace-enhancement` → 均解析到 `lib/index.js`。

### 1.3 wallpaper 媒体文件与 settings 键 — ✅
- 媒体：`~/.dsh/wallpapers/37758c1c-9ca8-47d2-bade-3048ab825fb6.png`（2,334,260 B，9-12 落盘）在位。
- 运行时可达：`GET http://127.0.0.1:3080/dsh-wallpaper/media/37758c1c-…png` → **200**，size_download 恰好 2,334,260 B（同名同字节）。
- settings.yaml `wallpaper.global`：`source=/dsh-wallpaper/media/37758c1c-…png`、`darkMask:0`、`opacity:0.88`、`blur:0` —— 与插件 Config schema 逐键匹配（`source: z.string()`、`darkMask/opacity: z.percent()`、`blur: z.number().min(0).max(60)`）。

### 1.4 运行期活跃证据（host 侧，非 client bundle）— ✅
- **vision-adam**：无 client.js（host-only）。活跃证据 = 本会话工具集含 `analyze_image`，其描述文本与 `dsh-vision-adam/lib/index.js` L232 注册的 defineTool 描述逐字一致。
- **session-board**：无 client.js。活跃证据 = `~/.dsh/session-board/peers/*.json` 4 个文件，最新 mtime **10:47 今日**，内容为本会话 peer-board 注入源。
- **usage**：`~/.dsh/storages/usage/usage.db`（30.8 MB）+ wal/shm，mtime 10:38 今日。
- **btw**：`~/.dsh/btw/index.json`（parent-4/parent-7 子会话条目），mtime 10:41 今日。

---

## 2. pptmaster — ✅ 通过

### 2.1 SKILL.md — ✅
`~/.dsh/skills/ppt-master/SKILL.md` 存在；frontmatter `name: ppt-master`、`description:` 多行块就位（version 6.1.0）。**skill 被发现**：本会话可用技能目录（available skills）含 `ppt-master`；发现机制 = `dsh-skill-filesystem/lib/index.js` L172 `join(dshHome, "skills")` 一层子目录含 SKILL.md（~/.dsh/skills 下仅 grill-me、ppt-master 两级平铺，符合一层约定）。

### 2.2 attribution_guard.py — ✅
`~/.dsh/skills/ppt-master/scripts/attribution_guard.py`（7,609 B，`-rwxrwxr-x`）可执行；venv python（`~/.dsh/.venvs/ppt-master/bin/python` = python3，Python 3.12.3）实跑 **exit=0**。SKILL.md L38 指示 `python3 "${SKILL_DIR}/scripts/attribution_guard.py"`，与部署路径一致。

### 2.3 venv python-pptx — ✅
`python -c "import pptx"` → `python-pptx 1.0.2` OK。

### 2.4 插件 @local/dsh-pptmaster — ✅
- 包名 `@local/dsh-pptmaster` v0.1.0；client.js L2 `id: "@local/dsh-pptmaster"`（包名 == client id）；cordis 入口 id `dsh-pptmaster`（profile patch L62-66，含 `root: !!js dshHomePath('office-ppt')`）。
- lib node --check：`index/client/invariant/pptd/runtime-staging/bin.js` 6 个文件全部 OK。
- 运行时依赖 resolve（插件自身 node_modules 内）：`pptxgenjs`、`@aiden0z/pptx-renderer`、`typescript`、`echarts`、`zrender`、`katex`、`jszip` 全部 OK。
- cordis insert 在位（见 1.1 之外的 web patch L62-66）。`dshHomePath` 由 `dsh-app-boot/lib/index.js` `ctx.provide("dshHomePath", …)` 提供，!!js 表达式可解析。
- 信息性：`~/.dsh/office-ppt` 当前不存在，但为**惰性创建**（`OfficePptStore` 构造 `mkdir(this.root, …)`，lib/index.js L79875），非缺陷。
- 插件自带技能 `skills/{ppt-design-systems,ppt-template-fidelity,workbuddy-ppt}/SKILL.md` 与本会话技能目录中的 ppt-template-fidelity / workbuddy-ppt 吻合。

---

## 3. dsh-workerspace — ✅ 通过

### 3.1 底座 dsh-workspace-enhancement@0.1.2 — ✅
- 目录在位；**4 行适配已落地**：`package.json` 中 2 个 peer（dsh-system-prompt、dsh-tools）与 2 个 picker dep（dsh-host-directory-picker、-native）均为 `^0.1.1-rc.2`。
- **peer-deps-check-patched 实跑**（`/home/CNS2026495165/dsh/.workspace/deploy-workerspace/base/peer-deps-check-patched.mjs` 对部署树）：**13 项 @deepseek-ai deps + 2 peers 全 strict ✓，不满足 0**；`npm ls --depth=0` 显示全树单一 0.1.1-rc.2 实例（无第二份 picker 实例风险）。
- 原生依赖 resolve：`ssh2` / `cpu-features` / `koffi` / `node-pty` 全部 OK（底座自 node_modules 内）。
- 底座自带 cordis.patch.yml 与 profile patch 语义一致（disable directory-picker-auto/subprocess/fs-sandbox；insert ssh-remote/directory-picker-ssh/ssh-web-channel）。

### 3.2 薄插件 @local/dsh-workerspace — ✅
- 目录在位 v0.1.0；`lib/index.js` 含 **6 个 defineTool**：`ws_serial_list`(L176) / `ws_serial_open`(L233) / `ws_serial_send`(L307) / `ws_serial_read`(L368) / `ws_serial_close`(L432) / `ws_flash`(L479)。
- `ws_flash` 的 `artifacts` 参数：`{ type: "object", additionalProperties: false, … }` ✅；高危确认走 `ctx.approval.request` 且仅 `allowed-once` 放行、无 agent 上下文时 fail-closed。
- settings 命名空间：`WS_SETTINGS_NAMESPACE = settingsNamespace("dsh-workerspace")`，`installSettingsSection` 注册；**settings.yaml L152 `dsh-workerspace: {}` 在位**。
- 全部 lib JS（core/serial/flash/index）node --check OK。

### 3.3 cordis insert 与 picker 冲突解 — ✅
web patch 容忍解析第 8-15 条：
- insert：`ssh-remote`(L37-45)、`directory-picker-ssh`(L46-51)、`ssh-web-channel`(L52-57)、`workerspace`(L59-61) 在位；
- `directory-picker` **disabled: true**（L67-68）✅；
- `directory-picker-browse`（@deepseek-ai/dsh-host-directory-picker-browse）**插入**（L69-71）✅；
- `directory-picker-ssh` **disabled: true**（L73-75，注释：避免与 browse 后端重复注册 directoryPicker）✅。
- 与 peer-board 运行态描述（directory-picker-browse 本机/远程目录登记入口为预期组件）一致。

---

## 4. @local client id 批量一致性 — ✅ 通过

含 client.js 的 4 个 @local 插件 `id` 均 == 包名：

| 包 | client.js id | 结论 |
|---|---|---|
| @local/dsh-btw | `"@local/dsh-btw"` | ✅ |
| @local/dsh-pptmaster | `"@local/dsh-pptmaster"` | ✅ |
| @local/dsh-usage | `"@local/dsh-usage"` | ✅ |
| @local/dsh-wallpaper | `"@local/dsh-wallpaper"` | ✅ |

`@local/dsh-workerspace` 无 client.js（host-only）→ 规则不适用（N/A）。

---

## 5. 装配一致性 — ✅ 通过

### 5.1 cordis.patch.yml 顶层结构 — ✅
容忍 !!js 解析：顶层为数组、15 条（12 insert + 1 config:agent-presets + 2 disable），结构无损坏；唯一 !!js 表达式 `dshHomePath('office-ppt')` 由 app-boot provider 解析（解析警告为预期，非错误）。

### 5.2 settings.yaml 各段无格式损坏 — ✅
yaml 库解析：单文档 OK。`llm-pi-ai.providers.opencode-go`（16 models）/ `.adam`（46 models，baseURL=`https://llmapi.roboscience.xyz/v1/`）；`vision-adam` = {model: deepseek-v4.1-flash, baseURL, apiKeyEnv: OPENCODE_GO_API_KEY, maxTokens: 393216}；`dsh-workerspace: {}`；`wallpaper.global`；`agent-default-model`{provider: adam, model: deepseek-v4-flash}；`agent-presets.default: standard-glm` —— 全部在位、结构完好。

### 5.3 web2 DEPRECATED — ✅
`~/.dsh/profiles/web2/DEPRECATED.md` 在位（废弃标记 2026-09-12、处置说明完整）。web2 **未被引用**：web 活动配置（cordis.patch.yml / settings.yaml / web/package.json）中仅 L26 注释提及「web2 同款」（信息性，非引用）；运行进程无 DSH_PROFILE 环境变量，活动 profile = web（bundles = dsh-base + dsh-web-app，patchReload live）。

---

## 6. boot 图（:3080）— ✅ 通过

实时抓取 `http://127.0.0.1:3080/` 的 `__DSH_BOOT__`：**47 个 client entries**，插件群全部在线：

| 目标 | boot 条目 | 序号 |
|---|---|---|
| taste | @deepseek-ai/dsh-taste | 42 |
| btw | @local/dsh-btw | 43 |
| wallpaper | @local/dsh-wallpaper | 44 |
| usage | @local/dsh-usage | 45 |
| workspace-enhancement | dsh-workspace-enhancement | 46 |
| pptmaster | @local/dsh-pptmaster | 47 |

vision-adam / session-board / workerspace 无 client.js，属 host-only，正确地不出现在 client boot 列表；其活跃性由 §1.4 运行期证据覆盖（analyze_image 工具在册 / peers 目录实时写入 / 无 client bundle）。

---

## 结论

**全部 6 项审计通过 → 无需修改**。装配盘面（cordis.patch.yml insert/disable、包解析、pptmaster 技能与 venv、workerspace 底座 4 行适配与六工具、@local client id、settings.yaml 各段、web2 废弃、:3080 boot 47 插件）与预期一致，无任何缺陷。唯一信息性说明：`~/.dsh/office-ppt` 为惰性创建（首次交付 PPT 时 mkdir），当前缺失属预期，无需处理。
