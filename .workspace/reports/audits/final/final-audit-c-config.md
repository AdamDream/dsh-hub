# 终审 C —— 配置、缓存与装配一致性（重启前）

- 档期：2026-09-15（重启前）
- 角色：两阶段闭环【审计】阶段，只读，无 sandbox_permissions
- 结论：**全绿 —— 无 blocker**。4 项观察（非 blocker，见 §8）
- 复核证据基线：当前 `dsh web` 进程（PID 1817494，14:38 启动，node v22.23.2）正以本审计盘面运行（本会话即为其产物）——patch 装配已被实证可启动。

---

## 1. settings.yaml（~/.dsh/settings.yaml，4558B）

| 检查 | 结果 |
|---|---|
| python3 yaml.safe_load | ✅ 通过（top-level dict，10 键） |
| 重复键（DupKeyLoader 硬检） | ✅ 无重复键 |
| 缩进错误 | ✅ 无（safe_load 全解析） |
| `!!js` 标签 | ✅ 无（settings 层不应有，符合预期） |
| llm-pi-ai 双 provider | ✅ `providers.opencode-go`（apiKeyEnv=OPENCODE_GO_API_KEY，16 模型）+ `providers.adam`（apiKeyEnv=ADAM_API_KEY，baseURL https://llmapi.roboscience.xyz/v1/，api=openai-completions，40+ 模型） |
| agent-default-model | ✅ provider=adam, model=deepseek-v4-flash |
| vision-adam | ✅ model=deepseek-v4.1-flash, baseURL=opencode.ai/zen/go/v1, apiKeyEnv=OPENCODE_GO_API_KEY, maxTokens=393216（与期望 deepseek-v4.1-flash/opencode/393216 全符） |
| dsh-workerspace | ✅ `{}`（空对象，插件自注册） |
| dsh-ssh-gui | ⚠️ 有 file.maxBytes=10485760 / exec.timeoutMs=30000 / exec.maxOutputBytes=1048576 / security.confirmExec=true / security.execAllowlist=[]；**nodes.seed 缺省**——但插件 zod schema 中 `nodes` 整体 `.default({})`、`seed` `.default([])`（dsh-ssh-gui/lib/index.js:122-135），缺省=空种子合法，**非错误** |
| web-search-deepseek | ✅ baseURL + maxUses=100000 |
| wallpaper | ✅ global.source=/dsh-wallpaper/media/37758c1c-….png，文件真实存在（~/.dsh/wallpapers/37758c1c-9ca8-47d2-bade-3048ab825fb6.png） |
| agent-presets | ✅ default=standard-glm（与 patch 冗余一致；~/.dsh/.agent-presets/standard-glm/ 存在，agent.cordis.yml 子代理固定 provider=adam） |

**判定：无需修改。**

## 2. cordis.patch.yml（~/.dsh/profiles/web/cordis.patch.yml，80 行）

- 容忍 `!!js` 解析（`!!js` 仅在 dsh-pptmaster 的 `root: !!js dshHomePath('office-ppt')` 一处，属预期用法；经 passthrough 构造器解析成功）✅
- 顶层条目 **16**：13 个 insert + 2 个 disable + 1 个 config 覆盖（agent-presets）
- insert id **13 个全部唯一** ✅
  vision-adam / taste / btw / wallpaper / usage / session-status-board / ssh-remote / directory-picker-ssh / ssh-web-channel / workerspace / dsh-pptmaster / directory-picker-browse / ssh-gui
- **disabled 有效性**（2 个，均有效，无孤儿）：
  - `directory-picker`（entry 13）：id 由 **dsh-web-app bundle patch**（cordis.patch.yml:96-97 `- id: directory-picker, name: '@deepseek-ai/dsh-host-directory-picker-auto'`）提供 → 有效。另 workspace-enhancement 自带 bundle patch 也 disable 同一行（幂等，无冲突）
  - `directory-picker-ssh`（entry 15）：同一 patch 内 entry 9 先 insert、entry 15 再 disable（app-boot applyEntryPatches 支持后 patch 命中前 insert）→ 有效
  - 兜底语义：dsh-app-boot/lib/index.js:51「patch 匹配不到仅 warn+skip」——即使误 disable 也不会启动失败
- 插件 id/name 一致性：13 个 insert 的 name 全部可解析（见 §3 解析实测）；10 个期望插件族全覆盖（ssh-gui/workerspace/pptmaster/workspace-enhancement×3/usage/session-status-board/taste/wallpaper/vision-adam/btw + directory-picker-browse）
- 与归档 web2 patch 关系：web patch 是 web2 的**超集**（+session-board/workspace-enhancement/workerspace/pptmaster/directory-picker/ssh-gui 30 行），非意外漂移

**判定：无需修改。**

## 3. 符号链接农场（profiles/node_modules）

- **断链总数：162**（find -L），分类：
  - 97 个 → `~/.npm/_npx/1e7f6d9597241db0/…`（npx 缓存已清理/不存在）
  - 65 个 → `dsh/node_modules/…`（0.1.1-rc.2 安装被剪枝的旧依赖，如 undici/@stablelib/base64/@earendil-works/pi-telemetry + 52 个 @deepseek-ai 子包：dsh-sdk-*/dsh-session-format*/dsh-webhook*/dsh-client-web(-react)/dsh-client-ui-primitives/slots/schema-form 等）
- **启动影响：无**（三层证据）：
  1. 依赖闭包交集=∅：加载集（dsh-base+dsh-web-app bundle + 13 插入插件）的 309 项依赖闭包与 162 断链**零交集**；web-app 66 依赖、base 77 依赖从真实安装位置 require.resolve **全过**（唯一 MISS `dsh-web-frontend` 为裸名解析假阳性——实际源码走导出子路径 `dist/index.html`，resolve 成功）
  2. 插入插件名从 profile 上下文 16/16 全部解析成功（含 `dsh-workspace-enhancement/picker`、`/web` 经 exports 子路径）
  3. 本地插件依赖从各自位置解析：11 个包 0 MISS
- **@deepseek-ai 下三个真实目录**（dsh-session-board/dsh-taste/dsh-vision-adam）：官方 npm-global 副本不存在，本地真实目录为唯一提供者（lib/ 齐全、无 cordis.yml 与官方布局一致、insert 显式 id 不依赖包内 cordis.yml）→ **已知例外，非遮蔽副本**
- **profiles/web/node_modules：不存在**（无遮蔽副本）✅
- **@local 6 目录齐全**：dsh-btw/dsh-pptmaster/dsh-ssh-gui/dsh-usage/dsh-wallpaper/dsh-workerspace，且**与源码工作区逐文件一致**（`diff -rq` lib/ 为空：dsh-usage-src ↔ @local/dsh-usage、dsh-btw ↔ @local/dsh-btw）✅

**判定：无需修改（162 断链为陈旧残骸，建议后续清理，见 §8-1）。**

## 4. 缓存陈旧（:3080 web shell 与运行时缓存）

- **web shell bundle 无需重建**。机制：
  - shell 静态产物 `dsh-web-frontend/dist/`（index-ClqxG24t.js / vendor-D22_Mp1f.js / 两个 css，均为 **rev 内容哈希文件名**，9月12 14:56 构建）——shell 源码未变（安装包内无 apps/web 源码，shell 由上游 dsh-web-frontend 预构建产物提供），**index.html 引用的哈希文件名不变 → 无需重建、浏览器命中同 URL**
  - 「client.js 动态服务」= `/plugins/<id>/client.js?rev=<rev>`，rev = **文件内容 sha1 前 12 位**（dsh-client-modules/lib/index.js:147,328）→ client.js 内容变更（dsh-usage lib/client.js 9月14、dsh-btw lib/client.js 已随部署同步）**自动换 rev、浏览器自动取新**，重启即生效，零构建
  - 「官方包 client 声明」= 包 package.json `dsh.client`（inject 列表）+ bundle patch 的 client roster 行——由 dsh-client-modules **启动时扫描 loader 树动态组成**（进 window.__DSH_BOOT__），非静态产物
  - 浏览器侧 inject 裸名（如 `@deepseek-ai/dsh-client-ui-primitives`）走 shell 内静态表 chunk（随 shell 一起构建），不依赖 farm 符号链接——故 §3 断链不影响客户端
- **session_projcache.json = 7,850,654 B（7.5MB）**：仅观察项，非 blocker（JSON 全量加载解析毫秒级；运行中进程持续维护，9月15 16:34 仍在更新）
- **.rej/.orig 残留：profiles 层 = 0** ✅

**判定：无需修改（shell 不重建；client.js 与 client 声明走 rev 哈希/启动扫描自动更新）。**

## 5. web2 归档态

- `~/.dsh/profiles/web2` **不存在** ✅；已归档至 `profiles-archive/web2-20260915-105429/`（含其 cordis.patch.yml 备份）✅
- profiles 层配置**零引用** `profiles/web2`（grep 计数 0）✅
- web2 时代的 npx-cache 符号链接残骸（§3）与 client-ui 旧包断链（dsh-client-ui-session/chat/schedule 等）已不在 web 闭包内，与 web2 退役一致

**判定：无需修改。**

## 6. nodes.json / machines.json（remote-workspaces）

- `~/.dsh/remote-workspaces/` **尚未生成**（目录与文件均无）→ **首启迁移态，非错误**：
  - workspace-enhancement registry：machines.json 路径 `<dsh home>/remote-workspaces/machines.json`，空/缺省走 first-run migration（非空列表永不改写，registry.js:252-260）
  - ssh-gui：nodes.json 仅当文件不存在时导入（lib/core.js:520,713-714「首启迁移：machines.json 全量 → ssh 节点 + settings 种子导入 serial/serial-tcp」；缺失/损坏回退空表，core.js:805）
- 两端 schema 兼容性：ssh-gui 复用底座 machines.json（ssh 权威）做双向同步、keyRef 侧表 ssh-keyrefs.json 沿用（core.js:540-541,770）——无冲突设计

**判定：无需修改（首启态）。**

## 7. credentials refs

- `~/.dsh/.credentials.yaml`：version/refs/records 三段，**三个 ref 全部存在且有值**：DEEPSEEK_API_KEY / OPENCODE_GO_API_KEY / ADAM_API_KEY ✅
- 插件 keyRef 侧表（ssh-keyrefs.json、machines.json bindings）**尚未创建**（remote-workspaces 首启态）→ 无引用即无悬空 ✅
- ssh-gui 读侧表容错（缺失/损坏回退空 bindings，core.js:1053,1378）✅
- 与 settings 的 apiKeyEnv 交叉核对：llm-pi-ai.opencode-go→OPENCODE_GO_API_KEY ✓、llm-pi-ai.adam→ADAM_API_KEY ✓、vision-adam→OPENCODE_GO_API_KEY ✓

**判定：无需修改。**

## 8. 观察项（非 blocker）

1. **162 断链符号链接**（§3）：启动无影响，但建议后续清理（npx 缓存目标可直接删除；dsh 剪枝目标可留作 fall-through 语义或一并清理）
2. **session_projcache.json 7.5MB**：持续增长中；启动仅解析（毫秒级），暂不处理
3. **dsh-ssh-gui settings 无 nodes.seed**：可选默认，若首启想预置 serial/serial-tcp 种子节点可补（非必需）
4. **settings.yaml.bak-ssh-gui-20260915115645 / cordis.patch.yml.bak-ssh-gui-20260915115645 等 12 个 patch 备份** 留在 profiles/web/：只读审计确认无活性影响（loader 只读 cordis.patch.yml 主文件），备份陈旧可择机归档

## 9. 汇总

- **blocker：无（0）**
- 需修改：无
- 可重启交付：✅（settings/cordis/装配/缓存/归档/首启迁移/凭据七项全部通过；当前运行进程即本盘面实证）
