# T15 — 官方 office 能力在 0.2.0 的形态 · 与本机自建 office 交付链的关系

- 轨道：**T15（审计阶段，只读）**；未改动任何产品代码 / profile / 配置 / 插件字节；未启动监听端口的服务；零模型请求。
- 审计时间：2026-09-29（当轮实测）。
- 被审对象：`@deepseek-ai/dsh-skill-office`（0.2.0-rc.1 与 0.1.7-rc.2 双版本）、`@deepseek-ai/dsh-office-to-pdf`、本机自建链路 `@local/dsh-pptmaster` + `deck/preview`、`workbuddy-reverse-proxy/office-handoff`（Nautilus 投递接收器 + `~/.dsh/office-handoff/` journal）、`workbuddy-reverse-proxy/`（反代调研目录）。
- 基线：0.2.0-rc.1 CLI 包已解于 `.workspace/dsh-020-pkg/x/package/`；本轨道自解包副本在 `.workspace/audit-020/t15/`（`x017/`、`x020/` = skill-office 双版本；`cli/c017`、`cli/c020` = CLI 双版本）。
- 只读约束遵守情况：写入路径仅 `.workspace/audit-020/t15/**` 与本报告；`~/.dsh/**`、`~/.dsh-017/**`、`workbuddy-reverse-proxy/**` 仅读；未使用 `sandbox_permissions`。

---

## 1. 结论摘要

1. **`@deepseek-ai/dsh-skill-office` 不是 0.2.0 的新增能力。** 该包在 `dsh@0.1.7-rc.2` 的 `dependencies` 中已存在（`dsh-0.1.7-rc.2.tgz:package/package.json` → `@deepseek-ai/dsh-skill-office: 0.1.7-rc.2`；0.2.0 同位置为 `0.2.0-rc.1`）。协调者事实基线中「0.2.0 新增依赖 `dsh-skill-office`」**不成立**——当轮实测的 CLI 依赖集合差只有一项：**新增 `@deepseek-ai/dsh-experimental-schedule-bundle`，无删除**。（与 T11 报告 §1.2 独立同结论。）
2. **更关键：`dsh-skill-office` 的 0.2.0 包体与 0.1.7 逐字节相同，只差 `package.json` 的 5 个版本文本。** `.workspace/audit-020/t15/x017/package` 与 `x020/package` 全文件 md5 对比：**10 个文件中 9 个完全相同**（`lib/index.js`、`lib/types/index.d.ts`、3 个 `assets/*/SKILL.md`、`assets/scripts/check_office.py`、两份 README、LICENSE、README.i18n.yaml），唯一差异是 `package.json`（`version` 与 `peerDependencies`/`devDependencies` 的版本号 + 两条 devDep 顺序换位）。⇒ **官方 office 能力在 0.1.7→0.2.0 之间是零功能增量。**
3. **它在本部署（`web` profile）根本没挂载**：唯一的挂载点是 `@deepseek-ai/dsh-sdk-app/cordis.patch.yml:36–41`，且该行被 `disabled: !(DSH_PRIMARY_RUNTIME ?? DSH_BUNDLED_PRIMARY_RUNTIME)` 门控。本机两个 profile 的 `bundles` 都是 `["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app"]`（`~/.dsh/profiles/web/package.json`、`~/.dsh-017/profiles/web/package.json`），且实测两个 profile 的 `node_modules` 里**都没有** `dsh-skill-office` 目录。⇒ 迁到 0.2.0 也**不会**凭空出现 `office-docx/pptx/xlsx`。
4. **web 面真正挂载的官方 office 能力只有一件：`office-to-pdf`。** `dsh-web-app/cordis.patch.yml:269–270` 的 `office-to-pdf` 行在 0.1.7 与 0.2.0 **同在且逐字节相同**；它为右栏 Document Preview 提供 Office→PDF（DOC/DOCX/XLS/XLSX/PPT/PPTX）。本机现役 0.1.1（3080）**没有**这个包（实测 `~/.dsh/profiles/node_modules/@deepseek-ai/` 与 `~/.npm-global/.../dsh/node_modules/@deepseek-ai/` 均无 `dsh-office-to-pdf`，也无 `dsh-client-ui-sidebar-documentpreview`）⇒ 这是**迁移到 0.2.0 才会新增的能力**，但它与自建 PPT 链**零耦合**。
5. **自建 PPT 链（`@local/dsh-pptmaster`）与官方 office 能力是互补而非重叠**：pptmaster 自查称「不依赖 LibreOffice、不依赖 office-to-pdf」——实测在 `~/.dsh/profiles/node_modules/@local/dsh-pptmaster/lib/index.js` 中 `libreoffice` / `soffice` / `officeToPdf` / `office-to-pdf` / `libreoffice-kit` 出现次数**全部为 0**；其渲染与预览走自有 `deck/*` RPC（`deck/create`、`deck/download`、`deck/location`、`deck/preview`、`deck/update-slide`）。官方 `office-pptx` 的默认流程依赖 `python-pptx` + `load_workspace_dependencies` + LibreOffice Kit CLI，**三者在本机 profile 都不存在**。
6. **`workbuddy-reverse-proxy/` 不是「办公反向代理」，与 office 无功能关系。** 该目录 README 首行自述为**模型网关反代调研存档**（把腾讯 WorkBuddy/CodeBuddy 的活动优惠模型反向代理出来给 DSH 调用），且顶部明示「**历史调研存档，不是当前部署指令**……自建网关及其 DSH provider 已拆除」。**不构成 0.2.0 的 office 能力面**，也不参与保留/裁剪判定。
7. **`office-handoff`（Nautilus 右键投递 + journal）与官方 office 能力完全正交**，且**不依赖 skill-office**：它只调用宿主内置 `/api`（`workspace.create` / `workspace.list`）。该路由在 0.1.7 与 0.2.0 中**均存在**（`dsh-api-workspace-controller` 的 `workspace/create` RPC 注册在 0.1.7/0.2.0 两份 `lib/typert.host.js` 中逐行同名），⇒ 迁移到 0.2.0 **不需要**改动投递链路（仍须另行实跑验证，本轨道未跑）。
8. **历史缺陷点复核（本轮源码级）**：
   - **中文硬编码引导**：0.2.0 仍在（`dsh-client-ui-settings-models/lib/client.js` 同时含 `Configure later`(L2954)/`稍后配置`(L3070)），但**这是官方 i18n 双语字典，不是缺陷**；0.1.7 同款同位置（L2957/L3073）。历史「验收受阻」的根因已在历史档中核实为**测试驱动只唯一匹配中文**（`workbuddy-reverse-proxy/reports/office-upgrade-finish-onboarding-audit.md:4–5`）⇒ **0.2.0 无回归，复测驱动仍需中英双匹配。**
   - **PPT 工具两个退役图标**：0.2.0 中两个旧符号**确认已不在** `dsh-client-ui-primitives@0.2.0-rc.1`（`IconBrowseOutline16`/`IconInspectOutline12` 命中 0），新符号 `IconBrowseOutlineRegular`/`IconInspectOutlineRegular` **存在**；而本机**现役安装副本**仍是旧符号（`~/.dsh/profiles/node_modules/@local/dsh-pptmaster/lib/client.js` sha256 `e2b5d28b…`，旧符号 3+1 处）——**但它自带的嵌套 `node_modules` 里是 `dsh-client-ui-primitives@0.1.1-rc.2`，该版本恰好导出这两个旧符号**，所以现役不崩；危险在迁移时若把依赖提升到共享树（0.1.7 与 0.2.0 共享树都只有新符号）而**不带图标改名**⇒ 立即 `undefined` 组件。存活迁移副本已改名（`workbuddy-reverse-proxy/_migration/ppt-017/dsh-pptmaster/lib/client.js` sha256 `d2190648…`，旧符号 0 处、新符号 3+1 处）。**这是本轨道最重要的可执行发现。**
   - **turn 尾卡 `id` 消费**：0.2.0 中 `conversation.chat.turnTail` 仍是 **`kind:"list"`**（`dsh-client-ui-chat/lib/client.js:6906–6909`），而 `dsh-client-ui-slots` 的 `register()` 对 list 槽**要求 `options.id`**（`lib/index.js:181–185`，`if (options.id === void 0) throw`）。本机现役 pptmaster 客户端注册该槽时**未传 `id`**（`lib/client.js:42322–42328`，只有 `select`/`priority`/`locale`/`inject`），官方 `dsh-client-ui-deliverables` 的同槽注册**传了 `id`**（`lib/client.js:2265–2267`）。`ctx.slots.inject` 是延缓到槽被声明后才执行的注册装饰器，故无法在静态读源码层面判定它是否必然抛出——**列为未验证项 U-1**（0.2.0 未新增该约束：`dsh-client-ui-slots` 两版本 `lib/index.js` sha256 **完全相同** `57e1314e…`，因此**不是 0.2.0 回归**，但迁移时必须在隔离实例实跑复核）。

---

## 2. 证据（当轮命令 + 源码路径行号）

### 2.1 包身份与逐字节等价

| 断言 | 证据 |
|---|---|
| skill-office 0.2.0 tarball 身份 | `workbuddy-reverse-proxy/_audit/sub/deepseek-ai-dsh-skill-office-0.2.0-rc.1.tgz` sha256 `94338c99b609e25d627bc4e24c91d5ad584f9ec997334293ff1d8fbb9709fe0d`（与 T11 独立解包副本 `t11/pkgs020/…tgz` sha256 **相同**） |
| 0.1.7 → 0.2.0 内容等价 | `md5sum` 全树对比：`x017/package` vs `x020/package`，**仅 `./package.json` 不同**（其余 9 文件 md5 全等） |
| 行数 | `lib/index.js` 98 行 / `lib/types/index.d.ts` 24 行 / `office-docx/SKILL.md` 57 / `office-pptx/SKILL.md` 81 / `office-xlsx/SKILL.md` 74 / `assets/scripts/check_office.py` 279（两版本行数一致） |
| 版本差具体内容 | `diff -u` 仅：`version: 0.1.7-rc.2→0.2.0-rc.1`；`peerDependencies`/`devDependencies` 中 `@deepseek-ai/dsh-skill` 版本；两条 cordis devDep 的**书写顺序**换位；无其它 |

### 2.2 CLI 依赖集合差（0.1.7 vs 0.2.0）

- 方法：`tar xzOf <tgz> package/package.json` 后做集合差。
- 结果：`017 total 81` / `020 total 82`；**新增仅 `@deepseek-ai/dsh-experimental-schedule-bundle`**；`@deepseek-ai/dsh-skill-office`、`dsh-tool-subagent-control`、`dsh-workflow-ptc` **两版都在**（`YES`）。
- 交叉证据：`workbuddy-reverse-proxy/_audit/unified-assembly-20260929-121756/prefix/.../@deepseek-ai/dsh/package.json`（实装 0.1.7-rc.2）中 `@deepseek-ai/dsh-skill-office` = `0.1.7-rc.2`（确实随 0.1.7 装进了依赖闭包）。

### 2.3 挂载点门控（skill-office 在本部署为「休眠包」）

- `dsh-sdk-app/cordis.patch.yml:36–41`（0.2.0 与 0.1.7 逐字节相同）：
  ```yaml
  - insert:
      - id: workspace-dependencies
        name: '@deepseek-ai/dsh-tool-workspace-dependencies'
        disabled: !!js "!(process.env.DSH_PRIMARY_RUNTIME ?? process.env.DSH_BUNDLED_PRIMARY_RUNTIME)"
      - id: skill-office
        name: '@deepseek-ai/dsh-skill-office'
        disabled: !!js "!(process.env.DSH_PRIMARY_RUNTIME ?? process.env.DSH_BUNDLED_PRIMARY_RUNTIME)"
        config:
          assetRoot: !!js "…resolve(<PRIMARY_RUNTIME> ?? '', '..', 'office-skills')"
          node: !!js "…resolve(<PRIMARY_RUNTIME> ?? '', 'dependencies','node','bin','node')"
  ```
- 全闭包 grep（`.workspace/audit-020/work/closure020/node_modules/`）中引用 `skill-office` 的文件只有：包自身、`dsh/package.json`（依赖声明）、`dsh-sdk-app/{cordis.patch.yml,package.json,README*,}`、`dsh-tool-workspace-dependencies/README*`、`dsh-agent-preset/skills/.../packages.md`、`.package-lock.json`。
- `dsh-base/cordis.patch.yml` 的技能行只有 `skill`(L294) / `skill-filesystem`(L297) / `skill-badge`(L300) / `tool-skill`(L304)，**无** `skill-office`；`dsh-web-app/cordis.patch.yml` 与 4 个 `presets/*.patch.yml` 中 grep `office` 只命中 `office-to-pdf` 一行（L269–270）。
- `dsh-sdk-app` 只被 `dsh-sdk-minimal/cordis.patch.yml:7` 与自身引用；`dsh-base`/`dsh-web-app` 均不引用它。

### 2.4 本机 profile 实况（只读）

- `~/.dsh/profiles/web/package.json`：`dsh.profile.bundles = ["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app"]`；deps `@deepseek-ai/dsh ^0.1.1-rc.2`。
- `~/.dsh-017/profiles/web/package.json`：同 bundles；`@deepseek-ai/dsh 0.1.7-rc.2`（无 `patchReload`）。
- `ls ~/.dsh/profiles/node_modules/@deepseek-ai/ | grep -i office` → **空**；`ls -d ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-skill-office` → 不存在；`~/.dsh-017` 同。二者均无 `dsh-office-to-pdf`。
- 现役 3080 所用 CLI 树（`~/.npm-global/lib/node_modules/@deepseek-ai/dsh`）版本 `0.1.1-rc.2`，`node_modules/@deepseek-ai` 共 197 包，`grep -i office` → **空**（只有 `dsh-skill` / `dsh-skill-badge` / `dsh-skill-filesystem` / `dsh-tool-skill` / `dsh-client-ui-skill`）。
- `~/.dsh/profiles/web/cordis.patch.yml` 中**无**任何 office 相关行（grep `office` 空）；`~/.dsh/settings.yaml` 中**无** office 段（顶层段仅 `ui-onboarding`、`llm-deepseek`、`llm-pi-ai`、`agent-default-model`、`vision-adam`、`agent-presets`、`web-search-deepseek`、`wallpaper`、`dsh-workerspace`、`dsh-ssh-gui`、`ui-theme`、`dsh-subagent`）。
- 现役用户技能根 `~/.dsh/skills/`：`program-notebook`、`session-handoff`、`grill-me`、`ppt-master`（**无** `office-*`）。

### 2.5 office-to-pdf（web 面唯一实际挂载的官方 office 能力）

- 行：`dsh-web-app/cordis.patch.yml:269–270`（0.1.7 版同位置 263–264）；两版上下文与注释逐字相同。
- 包：`@deepseek-ai/dsh-office-to-pdf@0.2.0-rc.1`，`repository.directory = packages/document/office-to-pdf`；同为 `dsh-web-app/package.json:137` 与 `dsh-api-remotes/package.json:88` 的依赖。
- 契约（`README.md` Summary + Use）：`ctx.officeToPdf.convert()`，输入 = 授权的源身份/版本/可选字节大小/延迟有界读取/Office 扩展名/调度优先级；输出 = caller-owned PDF 字节 + missing fonts + cache key + conversion generation；DOC/DOCX/XLS/XLSX/PPT/PPTX 支持；native LibreOffice 引擎优先，否则 Node WASM（`@deepseek-ai/libreoffice-kit-wasm`）；**给宿主消费者（含 Document Preview）用**，不是模型工具。

### 2.6 自建 PPT 链（`@local/dsh-pptmaster`）契约面

- 包：`~/.dsh/profiles/node_modules/@local/dsh-pptmaster/package.json`，`@local/dsh-pptmaster@0.1.0`，`dsh.client.platform = "web"`，`dsh.client.inject = [connection, locale, runtime, ui-conversation, ui-tool]`。
- 单独挂载行：`cordis.patch.yml`（包内）与 `~/.dsh/profiles/web/cordis.patch.yml:67–71`（`id: dsh-pptmaster`，`config.root: dshHomePath('office-ppt')`）。
- 模型侧工具（8 个，从 `lib/index.js` 符号表实测）：`pptmaster_create`、`pptmaster_list_templates`、`pptmaster_get_template_pages`、`pptmaster_scene_check`、`pptmaster_scene_create`、`pptmaster_update_slide`（+ `pptx`、`pptxgenjs` 为库名字面量）。
- 技能注册：`ctx.skills.registerProvider`（`lib/index.js:192`、`:80043`、`:80819` 三处 provider），每处带 `resourceBase`（`:133`/`:147`/`:80753`），`modelInvocable:true` + `userInvocable:true`（`:20–21`、`:79995–79996`、`:80719–80720`）⇒ 与 `skill-office` 同一契约面（`ctx.skills.registerProvider`）。
- 浏览器 RPC（`lib/types/rpc.d.ts` + `lib/client.js`）：`deck/create`、`deck/download`、`deck/location`、`deck/preview`、`deck/update-slide`；**loopback-only**。
- 客户端槽位：`conversation.chat.turnTail`（`:42322`）、`conversation.hero.inputAccessory`（`:42288`）、`conversation.hero.actions`（`:42295`）、`tool.call.toolview`（`:42302`，`key: pptmaster_create` 等）。
- 与 LibreOffice 的关系：`libreoffice`/`soffice`/`officeToPdf`/`office-to-pdf`/`libreoffice-kit` 在服务端 `lib/index.js` 命中 **0**。

### 2.7 office-handoff（投递 + journal）与 `/api` 面

- 目录：`workbuddy-reverse-proxy/office-handoff/`（`bin/dsh-office-handoff`、`desktop/nautilus-script.sh`、`lib/`、`scripts/`、`install.sh`/`uninstall.sh`、`tests/`、`.iso/`）。
- 机制与归属（`docs/architecture/office-handoff.md`）：§1 归属表（L17–30）、§2 Route A 时序（L31–67，即 journal 写在 `workspace.create` **之前**、失败按 identity 回滚并补记 `rollback`）、§2.1 机制锚点（L68–82）、§5 状态（L138；办公投递 = 已部署 + 用户已确认验收；升级线 = NOT READY/STOP）、§5.1 已部署实况（L149–177：入口 symlink、Nautilus 脚本、安装副本 19 文件、`cmp` 逐字节相同）。
- 运行时投递对象：`~/.dsh/office-handoff/`（一个 `journal/` 目录 + 一个配套机密文件；目录/文件权限实测 `700`/`600`）。**本报告不读出、不引用其内容**。
- `/api` 依赖：`dsh-api-workspace-controller` 的 `workspace/create` RPC —— 0.1.7 与 0.2.0 两份 `lib/typert.host.js:289,302,309` 同名同结构（含 parameter/result schema 行号一致）。

### 2.8 历史缺陷点专项证据

| 点 | 0.1.7 / 0.2.0 实测 | 结论 |
|---|---|---|
| 引导弹窗中文硬编码 | 0.2.0 `dsh-client-ui-settings-models/lib/client.js:2952–2954`（EN：`Add an API key to get started` / `Configure later`）、`:3070`（ZH：`稍后配置`）、`:3970`（`credentialOnboarding` 默认 true）、`:4010`（`&& !("dshDesktop" in globalThis)`）；0.1.7 同位置 `:2957`/`:3073`/`:3973`/`:4013` | 双语字典**同在**，非缺陷；历史阻塞根因是**测试驱动只匹配中文**（历史档 `office-upgrade-finish-onboarding-audit.md:4–5`）。0.2.0 **无回归** |
| 两个退役图标 | 0.2.0 `dsh-client-ui-primitives@0.2.0-rc.1`：`IconBrowseOutline16`=0、`IconInspectOutline12`=0、`IconBrowseOutlineRegular`/`IconInspectOutlineRegular` 均 **存在**；0.1.7 同（命中 0/0/3/3）。现役安装副本 `@local/dsh-pptmaster/lib/client.js` sha256 `e2b5d28b…`：旧符号 **3+1**、新符号 **0**；其嵌套 `node_modules/@deepseek-ai/dsh-client-ui-primitives` 版本 **0.1.1-rc.2**，该版本导出旧符号 **3+3**。存活迁移副本 `_migration/ppt-017/.../client.js` sha256 `d2190648…`：旧符号 0、新符号 3+1 | **迁移必须带图标改名 + 依赖提升策略同时成立**；只改一处即断 |
| turn 尾卡 `id` 消费 | 0.2.0 `dsh-client-ui-chat/lib/client.js:6906–6909` = `kind:"list"`；`dsh-client-ui-slots/lib/index.js:181–185` list 槽 `register` 要求 `id`；现役 pptmaster `:42322–42328` 无 `id`；官方 `dsh-client-ui-deliverables/lib/client.js:2265–2267` 有 `id`；`dsh-client-ui-slots/lib/index.js` 两版本 sha256 相同 `57e1314e…` | 不是 0.2.0 回归；是否必然抛出**未验证**（U-1） |

### 2.9 反代目录定性

- `workbuddy-reverse-proxy/README.md:1–5`：`# WorkBuddy 反代调研 · 主报告` + `⛔ 历史调研存档，不是当前部署指令。自建网关及其 DSH provider 已拆除；目标改为 DSH 0.1.7-rc.2 + 第三方 WorkBuddy 插件`。标题/结论对象是**模型网关**（`linguo2625469/workbuddy2api-panel`、OAuth 设备授权、`127.0.0.1:7863/v1`、`copilot.tencent.com` 上游）。
- ⇒ 该目录**不是**「办公反向代理」；其中与 office 有关的仅是 `office-handoff/`（投递接收器）与 `reports/`（历史证据）。

---

## 3. `dsh-skill-office` 契约面（0.2.0-rc.1）

**提供物**：一个 Cordis 插件（skill provider），**不是**工具、不是命令、不是 UI 入口。

| 面 | 值 | 证据 |
|---|---|---|
| 插件名 | `skill-office` | `lib/index.js:23` |
| 注入 | `inject = ["skills"]` | `lib/index.js:25` |
| 注册 API | `ctx.skills.registerProvider(() => provider)` | `lib/index.js:95` |
| provider 名 | `dsh-office` | `lib/index.js:81` |
| 技能名（3 个） | `office-docx`、`office-pptx`、`office-xlsx` | `lib/index.js:11–15` |
| 调用面 | `modelInvocable: true`、`userInvocable: true` | `lib/index.js:66–69` |
| source / rank | `source:"bundled"`、`rank: BUNDLED_SKILL_RANK`(=600) | `lib/index.js:71–72`；`dsh-skill/lib/index.js:23` |
| 资源基 | `resourceBase:{kind:"directory", path:<assetRoot>/<skill>}` | `lib/index.js:73–76` |
| 配置 schema | `assetRoot: string(min1)`、`node: string(min1)`、`cli: string(min1) \| false` | `lib/index.js:17–21`，`lib/types/index.d.ts:5–12` |
| 默认 assetRoot | 包内 `../assets/` | `lib/index.js:55` |
| 默认 node | `process.execPath`（SEA/Electron 必须显式给） | `lib/index.js:39–40` |
| 默认 cli | `require.resolve('@deepseek-ai/libreoffice-kit/package.json')` 同目录 `lib/cli.js` | `lib/index.js:42` |
| 硬校验（激活即抛） | ① `assetRoot` 必须是绝对路径；② 必须存在 `<assetRoot>/scripts/check_office.py`；③ `node`/`cli` 必须是**绝对路径且是文件**；④ 每个 `SKILL.md` 必须有 YAML frontmatter 且含非空 `description` | `lib/index.js:56–57`、`:43`、`:28`、`:31` |
| 关闭 CLI | `cli: false` ⇒ 技能正文追加 "LibreOffice Kit is disabled in this deployment." | `lib/index.js:38` |
| 技能正文末尾注入 | `## Installed LibreOffice Kit` + `{libreofficeKit:{node,cli}}` 绝对路径 JSON | `lib/index.js:44–47` |
| 依赖的宿主工具（技能正文引用，非包自带） | `load_workspace_dependencies`（`dsh-tool-workspace-dependencies`）、`read_image`、`present`（`dsh-tool-present`）、脚本解释器 | `assets/office-pptx/SKILL.md:8,66,81`；`office-docx/SKILL.md:8`；`office-xlsx/SKILL.md:8` |
| 自带脚本 | `assets/scripts/check_office.py`（**纯标准库** OOXML 只读校验：ZIP/XML 完整性、内部关系、结构摘要、可选 `--contains TEXT` / `--count N`；退出码 0/1/2） | `assets/scripts/check_office.py:1–24`；`README.md:48` |
| 渲染能力 | 经 `@deepseek-ai/libreoffice-kit` CLI：`capabilities --json`、`render --pages --dpi`、`convert --output <pdf>` | `assets/office-pptx/SKILL.md:70–75` |
| settings 命名空间 | **无**（`lib/index.js` 中 `settings` 命中 0） | 实测 grep |
| UI 入口 | **无**（只有 `dsh-client-ui-skill` 渲染目录条目/正文） | 包 `files` 字段无 client 产物 |

**部署侧前置（README 明示，`README.md:28,44,94–96`）**：provider 只提供指令+脚本，**不安装** Python 或文档库；checker 需 Python ≥3.9；DOCX/PPTX/XLSX 之外不覆盖。

---

## 4. 与自建链路的重叠与差异

### 4.1 对照总表

| 维度 | 官方 `dsh-skill-office`（0.2.0） | 官方 `dsh-office-to-pdf`（0.2.0，**web 面已挂**） | 自建 `@local/dsh-pptmaster` | 自建 `office-handoff`（投递 + journal） |
|---|---|---|---|---|
| 形态 | skill provider（3 个技能） | 宿主服务（`ctx.officeToPdf`） | 插件：6 个模型工具 + 3 个技能 provider + 客户端 UI + loopback RPC | 桌面入口脚本 + 接收器 CLI |
| 触发面 | 模型/用户 `use skill` | 宿主内部（Document Preview） | 模型工具调用 + `deck/*` RPC + UI 卡片 | Nautilus 右键 |
| 产物 | DOCX/PPTX/XLSX 创作与结构校验 | PDF（预览用） | **可编辑 PPTX**（场景/模板/校验/交付）+ turn 尾卡预览 | 工作区登记 + journal 记录 |
| 渲染/预览 | LibreOffice Kit CLI（render/convert） | LibreOffice native 或 WASM | **自有**（`deck/preview`，不经 LibreOffice） | 无 |
| 依赖宿主服务 | `ctx.skills` | `ctx.officeToPdf` + Remote 授权 | `ctx.skills`、`ctx.tools`、client slots、`dsh-client-*` | 宿主内置 `/api`（`workspace.create`/`workspace.list`） |
| 本部署是否可用 | **否**（未挂载） | 0.1.7/0.2.0 **是**；现役 0.1.1 **否** | 是（现役已装） | 是（已部署 + 用户验收） |
| 0.1.7→0.2.0 变化 | 零（包体逐字节同） | 零（行同、包版本号变） | 需另核（T08 职责） | 零（`/api` 路由同） |

### 4.2 功能重叠面

1. **技能注册契约相同**：官方 `ctx.skills.registerProvider`（`index.js:95`）与 pptmaster `ctx.skills.registerProvider`（`lib/index.js:192/:80043/:80819`）同 API；两者都与 `dsh-tool-skill` 协作把候选渲染进会话目录。
2. **同名能力是 `PPTX` 一条线**：官方 `office-pptx`（python-pptx 生成/编辑 + LibreOffice 渲染 + 结构校验）与 pptmaster（PPTX 生成/模板/场景 QA/交付）在**功能目标**上重叠。
3. **结构校验重叠**：官方 `check_office.py --count/--contains` 与 pptmaster 的场景/几何/溢出校验都做「结构层自检」。

### 4.3 差异面（决定性）

1. **入口形态不同**：官方是「技能正文 + Python 脚本 + LibreOffice CLI」，须模型自己写 Python；pptmaster 是**原生工具**（`pptmaster_scene_check`/`pptmaster_scene_create` 等），由宿主校验并直接产出可编辑 PPTX。
2. **渲染器不同且互不依赖**：官方转 PDF 走 LibreOffice（native/WASM）；pptmaster 走自有 `deck/preview`，实测服务端 `libreoffice`/`soffice`/`office-to-pdf` 命中 **0**。
3. **交付落点不同**：官方走 `present`（`dsh-tool-present`，源路径交付）；pptmaster 有 turn 尾卡（`conversation.chat.turnTail` + `deck/preview`）与本地交付流。
4. **模板/品牌能力**：pptmaster 有模板索引（`pptmaster_list_templates`/`get_template_pages`）、设计系统 skill、静态 JSX 场景；官方 office 技能**完全没有**模板/品牌概念。
5. **投递 vs 创作正交**：`office-handoff` 只把文件搬进工作区并写 journal；官方 office 能力只写文档，**不搬文件**。两者零交集。
6. **依赖前置差异悬殊**：官方要求 Python≥3.9 + `python-pptx`/`python-docx`/`openpyxl`/`pandas` + `load_workspace_dependencies` payload（`primary-runtime/`）+ LibreOffice Kit；本机实测：Python 3.12.3 有、`docx 1.2.0` 有，**`pptx`/`openpyxl`/`pandas` 缺失**，`load_workspace_dependencies` 未挂载，`libreoffice-kit@0.1.2` 只在审计解包树内（`lib/cli.js` 存在）而**不在本机 profile**。

---

## 5. 保留 · 裁剪 · 退役判定

### 5.1 判定汇总

| # | 对象 | 判定 | 一句话依据 |
|---|---|---|---|
| K1 | `@local/dsh-pptmaster` 全部（6 工具 + 3 技能 + 客户端 UI + `deck/*` RPC + turn 尾卡） | **保留** | 官方在 web 面**无**任何可编辑 PPTX 生成工具链；`office-pptx` 未挂载且能力不等价（无模板/无场景校验/无 turn 卡） |
| K2 | `~/.dsh/profiles/web/cordis.patch.yml:67–71` 的 `dsh-pptmaster` 挂载行 + `config.root: dshHomePath('office-ppt')` | **保留** | pptmaster 全部能力靠它挂载；`dsh.client.platform="web"`，无替代 |
| K3 | `office-handoff/` 投递接收器 + `~/.dsh/office-handoff/journal` | **保留** | 官方 office 能力只创作/转换，**不做**工作区投递与 journal；且其唯一宿主依赖 `workspace/create` 在 0.2.0 仍在（同名同结构） |
| K4 | pptmaster 的图标符号改名（→ `IconBrowseOutlineRegular`/`IconInspectOutlineRegular`） | **保留（且必须随迁移落地）** | 现役安装副本旧符号 3+1 处，只在插件自带 `primitives@0.1.1-rc.2` 嵌套树下才成立；共享树（0.1.7/0.2.0）**只有新符号** |
| K5 | pptmaster 自带 `node_modules` 的**嵌套依赖策略** | **保留但须显式审计** | 该嵌套树是旧符号存活的唯一原因，也是版本漂移风险的来源；提升/去嵌套必须与 K4 同批 |
| C1 | 在 0.2.0 内**启用**官方 office 技能（挂 `dsh-skill-office` + `dsh-tool-workspace-dependencies`） | **裁剪（默认不做）** | 需额外 payload（`primary-runtime/` + Python 文档库）；本机缺 `python-pptx`/`openpyxl`/`pandas`；与 pptmaster 目标重叠但能力更弱；按需再启用（§6 给出精确片段） |
| C2 | 把 `dsh-sdk-app` 加进 profile `bundles` 以「顺便」拿到 office 技能 | **裁剪（明确禁止）** | 会连带 SDK/JSON-RPC 形态行、`session-title-llm` 禁用、`hmr` 禁用等副作用；`skill-office` 行本身仍被 `DSH_PRIMARY_RUNTIME` 门控为 disabled |
| C3 | `workbuddy-reverse-proxy/` 反代部分（proto/、RUNBOOK 安装命令、网关 provider） | **退役（维持已退役状态）** | 该目录自述「历史调研存档……自建网关及其 DSH provider 已拆除」；与 office 无关；**不得**在 0.2.0 迁移中重新启用 |
| C4 | `workbuddy-reverse-proxy/reports/**` 与 `office-upgrade-*` 历史档 | **退役（只作证据，不进决策链）** | 属历史证据；本报告所有结论均以当轮源码实测为准 |
| C5 | 官方 `office-docx` / `office-xlsx`（即便将来启用 office 技能） | **裁剪（按需）** | 与自建链零重叠、零冲突；仅在确有 Word/Excel 交付需求且 payload 就绪时启用 |
| R1 | 期待「0.2.0 官方 office 能力取代自建 PPT 链」 | **退役该预期** | 官方 web 面只有 `office-to-pdf`（PDF 预览），`office-pptx` 未挂载；能力面不含可编辑 PPTX 工具链、模板、场景校验、turn 尾卡 |
| R2 | 为「官方 office 技能」准备新 profile/settings 段 | **退役（非必需）** | `dsh-skill-office` **不注册任何 settings 命名空间**（`lib/index.js` 中 `settings` 命中 0）；只有显式启用（C1）才需要 profile 行 |

**计数：保留 5 条（K1–K5）／裁剪 3 条（C1、C2、C5）／退役 4 条（C3、C4、R1、R2）。**

### 5.2 关于「本机 office 定制是否仍需要全量保留」

**是，仍需要全量保留。** 理由（全部当轮实测）：

1. 官方在 0.2.0 的 web 面**没有**可编辑 PPTX 生成能力：`dsh-skill-office` 未挂载（§2.3/§2.4），web 面唯一 office 行是 `office-to-pdf`（PDF 转换，非创作）。
2. 即便显式启用 `office-pptx`，它与 pptmaster **不等价**：无模板体系、无场景/几何校验工具、无 turn 尾卡交付、无 `deck/preview`、依赖外部 Python 库而本机缺三项。
3. `office-handoff` 的投递 + journal 面在官方**完全不存在**（官方无「把外部文件纳入工作区并记账」的能力）。
4. 唯一可裁的是「是否**额外**启用官方 office 技能」（C1），且默认**不启用**。

### 5.3 0.2.0 迁移对自建链的最小动作集（本轨道产出，供执行档）

1. **必须**：pptmaster 客户端图标 4 处改名（`IconBrowseOutline16`→`IconBrowseOutlineRegular` ×3 尺寸 15 保持；`IconInspectOutline12`→`IconInspectOutlineRegular` ×1 尺寸 12 保持），并让解析目标落到共享树的新 `primitives`（即迁移副本 `d2190648…` 的既有做法）。
2. **必须**：在隔离实例实跑 `conversation.chat.turnTail` 注册是否抛 `list slot … requires options.id`（U-1），若抛则在同一注册处补 `id`（官方先例：`@deepseek-ai/dsh-client-ui-deliverables`）。
3. **不变**：`office-handoff` 与 journal 无需改动（`/api` `workspace/create` 在 0.2.0 存在且结构同）。
4. **不变**：`dsh-pptmaster` 挂载行与 `config.root` 无需改动。
5. **复核（属 T13 范围，仅提示）**：`~/.dsh/profiles/web/cordis.patch.yml:16` 用的 `agent-presets` 是 0.1.1 旧 id（0.1.7 起为 `agent-preset-registry`），迁到 0.2.0 会静默不命中——与本轨道无重叠，仅登记。

---

## 6. 启用配置片段（仅在决定启用官方 office 技能时）

### 6.1 是否「需要新配置」

- **不启用 ⇒ 不需要任何新配置。** `dsh-skill-office` 无 settings 命名空间、无 profile 行生命周期要求；它在本部署保持休眠。
- `office-to-pdf` **随 `dsh-web-app` bundle 自动挂载**，无需 profile 或 settings 改动（`dsh-web-app/cordis.patch.yml:269–270`）。
- **仅在显式启用官方 office 技能时**需要 profile 行（`cordis.patch.yml`）；`settings.yaml` 仍不需要。

### 6.2 profile 行（写入 profile 的 `cordis.patch.yml`，**本轮未写入**）

前置条件（否则插件激活即抛错，不是静默降级）：
- `assetRoot` 必须绝对且含 `scripts/check_office.py`（缺则 `lib/index.js:57` 抛）；
- `node`、`cli` 必须是**绝对路径文件**（缺则 `lib/index.js:43` 抛）；`node` 缺省 = 当前进程可执行文件（npm 部署可用），`cli` 缺省 = 从 `@deepseek-ai/libreoffice-kit` 解析到 `lib/cli.js`（实测该文件存在于 0.2.0 依赖闭包：`…/libreoffice-kit/lib/cli.js`，81047 B）；
- 技能默认流程还需要 `load_workspace_dependencies` 工具与 `primary-runtime/` payload（`runtime.json` + `dependencies/python/bin/python3` + `site-packages`），否则 `office-pptx`/`office-xlsx` 的默认 Python 流程不可用。

```yaml
# 1) 官方 office 技能（skill provider，注册 office-docx / office-pptx / office-xlsx）
- insert:
    - id: skill-office
      name: '@deepseek-ai/dsh-skill-office'
      config:
        # 缺省即包内 assets/；仅在把资源放到归档外时才需要显式给绝对路径
        assetRoot: /absolute/path/to/skill-office-assets
        # node 缺省 = 当前可执行文件（npm 部署无需给）；Electron/SEA 必须显式给
        # cli 缺省 = 已安装 libreoffice-kit 的 lib/cli.js；纯 Python 部署显式关闭：
        cli: false          # 或 "/abs/path/to/@deepseek-ai/libreoffice-kit/lib/cli.js"

# 2) 只有同时要“官方技能里的默认 Python 解释器”时才需要
- insert:
    - id: workspace-dependencies
      name: '@deepseek-ai/dsh-tool-workspace-dependencies'
      config:
        source: /absolute/path/to/primary-runtime   # 必填；须含 runtime.json 与 dependencies/
        # root 可选：给了就首次调用时复制到 Harness home 下复用，不给则原位使用
```

**最小化替代（不装 office 技能，但要用官方结构校验器）**：`check_office.py` 是纯标准库脚本，可直接由 `python3` 调用，**不需要**挂 `skill-office`：

```sh
python3 /abs/path/to/dsh-skill-office/assets/scripts/check_office.py \
  <file.pptx> --out <checks.json> [--contains TEXT]... [--count N]
```

### 6.3 明确不推荐的配置

```yaml
# ✗ 不要为了 office 技能把 SDK 形态 bundle 加进 web profile：
"dsh.profile.bundles": ["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app","@deepseek-ai/dsh-sdk-app"]
# 理由：会连带 sdk-app-startup / sdk-jsonrpc-server 行、session-title-llm 禁用、hmr 禁用；
# 且 skill-office 行本身仍由 DSH_PRIMARY_RUNTIME 门控为 disabled（未设该 env 时等于没挂）。
```

---

## 7. 未验证项

| # | 项 | 为什么未验证 | 需要什么才能定 |
|---|---|---|---|
| U-1 | 现役 pptmaster 在 0.2.0 下注册 `conversation.chat.turnTail` 是否抛 `list slot "…" requires options.id` | `ctx.slots.inject` 是延迟到槽被声明后才执行的注册装饰器（0.2.0 闭包内 258 处使用），静态读源码无法判定执行时机；且本轨道禁止起服务 | 隔离实例实跑 + 客户端 console 断言（历史闸门口径：console 无 `requires options.id`、无 `slot entry crashed in 'conversation.chat.turnTail'`） |
| U-2 | 「PPT 工具显示两个退役图标」在 0.2.0 运行时的**可见症状** | 未起浏览器、未渲染；只做了符号存在性普查 | 隔离实例 UI 观测（PPT 工具行图标是否为空/崩溃） |
| U-3 | 图标改名的实际解析目标 | 需决定「保留插件自带嵌套 `node_modules`（0.1.1-rc.2）还是提升到共享树（0.2.0）」；本轨道不起安装、不改 profile | 执行档在隔离根确定依赖布局后实跑 |
| U-4 | pptmaster 是否在新组合下解析到 `dsh-client-ui-chat/client` 等 0.1.7+ 分包 | 同 U-3；本轮只读符号与槽名普查 | 隔离实例模块路由断言（历史口径：客户端模块 `require` 失败数 = 0） |
| U-5 | `office-handoff` 在 0.2.0 上的端到端投递 | 需要**运行**宿主 `/api` 并做 workspace 登记（禁止起服务/零模型请求） | 隔离实例实跑（本轮只证明路由 `workspace/create` 在同名同结构存在） |
| U-6 | `office-to-pdf` 在 0.2.0 本机是否真能转换（native 引擎 vs WASM） | 需实际调用转换（拉起 LibreOffice） | 隔离实例实跑；本轮只证明行挂载与包存在 |
| U-7 | `dsh-skill-office` 在**本机 profile** 显式启用后是否全部前置齐备 | 需实际安装 payload 与 Python 库（本轨道只读，不安装） | 执行档按 §6.2 安装后实跑 `list()`/`get()` 与一次 `check_office.py` |
| U-8 | `workbuddy-reverse-proxy/` 之外的其它历史 office 产物是否有 0.2.0 相关债 | 本轨道未穷举（`.iso/`、`_lab*`、`_migration/` 仅按需抽读） | T08/T10 轨道（本地插件清单 / 历史教训）覆盖 |

---

## 8. 与本轮其它轨道的关系（避免重复/冲突）

- **T11（技能子系统）** 已独立得到「skill-office 非 0.2.0 新增」「本部署未挂载」「与 office-handoff 正交」三条结论，与本报告 §1.1/§1.3/§1.7 一致（**独立复核，非复用**）。
- **T15 独有增量**：① 自建 **PPT 交付链**（工具/技能/客户端 UI/`deck/*`）与官方能力的**逐面差异与保留判定**；② **历史缺陷点三点的源码级复核**（中文硬编码 = 非缺陷、图标符号共享树缺失 = 真实迁移风险、turn 尾卡 `id` = 非回归但待实跑）；③ **`office-to-pdf` 是 web 面唯一已挂载官方 office 能力**及 `skill-office` 的启用片段。
- 本报告**不**触碰 T08（本地插件清单）、T13（子代理模型路由）、T02/T03（CLI/settings schema）的结论面，仅在 §5.3-5 提示一处 `agent-presets` 旧 id 属 T13 范围。

---

## 9. 复现命令（只读，均在仓库根执行）

```bash
# 解包双版本（写入仅限 .workspace）
mkdir -p .workspace/audit-020/t15/{x020,x017}
tar xzf workbuddy-reverse-proxy/_audit/sub/deepseek-ai-dsh-skill-office-0.2.0-rc.1.tgz -C .workspace/audit-020/t15/x020
tar xzf workbuddy-reverse-proxy/_audit/sub/deepseek-ai-dsh-skill-office-0.1.7-rc.2.tgz -C .workspace/audit-020/t15/x017
diff -rq .workspace/audit-020/t15/x017/package .workspace/audit-020/t15/x020/package   # 仅 package.json 不同

# CLI 依赖集合差
mkdir -p .workspace/audit-020/t15/cli/{c017,c020}
tar xzf workbuddy-reverse-proxy/_audit/sub/deepseek-ai-dsh-0.1.7-rc.2.tgz -C .workspace/audit-020/t15/cli/c017
tar xzf workbuddy-reverse-proxy/_audit/sub/deepseek-ai-dsh-0.2.0-rc.1.tgz  -C .workspace/audit-020/t15/cli/c020
# 再比对两者的 package.json dependencies 键集

# 挂载点门控
grep -n "skill-office" -A 6 -B 2 .workspace/audit-020/work/closure020/node_modules/@deepseek-ai/dsh-sdk-app/cordis.patch.yml
grep -rn "skill-office" .workspace/audit-020/work/closure020/node_modules/@deepseek-ai/dsh-base/cordis.patch.yml \
  .workspace/audit-020/work/closure020/node_modules/@deepseek-ai/dsh-web-app/cordis.patch.yml \
  .workspace/audit-020/work/closure020/node_modules/@deepseek-ai/dsh-web-app/presets/*.yml      # 空

# 图标符号普查（0.2.0 共享树 vs 现役插件自带嵌套树）
grep -rho "IconBrowseOutline16\|IconInspectOutline12" .workspace/audit-020/work/closure020/node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/ | wc -l   # 0
for n in IconBrowseOutline16 IconInspectOutline12 IconBrowseOutlineRegular IconInspectOutlineRegular; do
  grep -o "$n" ~/.dsh/profiles/node_modules/@local/dsh-pptmaster/lib/client.js | wc -l
done   # 3 / 1 / 0 / 0
python3 -c "import json;print(json.load(open('$HOME/.dsh/profiles/node_modules/@local/dsh-pptmaster/node_modules/@deepseek-ai/dsh-client-ui-primitives/package.json'))['version'])"  # 0.1.1-rc.2

# list 槽 id 约束 / turnTail 声明
grep -n "requires options.id" .workspace/audit-020/work/closure020/node_modules/@deepseek-ai/dsh-client-ui-slots/lib/index.js
grep -n "conversation.chat.turnTail" -A 4 .workspace/audit-020/work/closure020/node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js | head

# 引导弹窗双语字典（0.2.0）
grep -n "onboardingLater\|credentialOnboarding" .workspace/audit-020/work/closure020/node_modules/@deepseek-ai/dsh-client-ui-settings-models/lib/client.js | head
```

## 10. 补记（第二轮，2026-09-29 协调者插播证据校正后追加）

**本补记只做一处归因更正，不改变 §1–§9 的任何保留/裁剪/退役判定。**

### 10.1 更正：turn 尾卡（`conversation.chat.turnTail`）的 `chain → list` 漂移发生在 **0.1.1**，不是「0.1.7 起」

§2.8 表格该行结论方向正确（0.2.0 该槽是 `list`、含 `select` 的注册会失败、`id` 缺失会抛错），但归因不完整。三版本源码实测（[实读]）：

| 版本 | 声明者与行号 | kind | 渲染入口 |
|---|---|---|---|
| **0.1.1** | `dsh-client-ui-conversation/lib/client.js:9820–9823`（`children` 表，父 `conversation.chat.node` / `key:"turn-tail"`） | **`chain`** | `renderSlotChain("conversation.chat.turnTail", …)` `:9721` |
| **0.1.7** | `dsh-client-ui-chat/lib/client.js:6787–6790` | **`list`** | `renderSlot("conversation.chat.turnTail", …)` `:6512` |
| **0.2.0** | `dsh-client-ui-chat/lib/client.js:6906–6909` | **`list`** | `renderSlot("conversation.chat.turnTail", …)` `:6631` |

- 0.1.7 与 0.2.0 的声明体、`scope`、渲染入口**逐字相同**；漂移发生在 **0.1.1 → 0.1.7**，同时声明者由 `dsh-client-ui-conversation` 迁入**新建包 `dsh-client-ui-chat`**（实测 0.1.1 树**无** `dsh-client-ui-chat`）。
- ⇒ 对「0.1.7 → 0.2.0」是**存量债**（非本次新增）；对「0.1.1 直迁 0.2.0」才是新增债。**两种路径都必须改**，但归因不同。
- 先前 §2.8 的判据「`dsh-client-ui-slots` 两版 sha256 相同 ⇒ 非 0.2.0 回归」**仍然成立**；本补记只是把它从「待实跑」升级为「已由 seat-kind 实读定因」：含 `select` 的注册在 list 槽上**必然**在注册期失败（`SlotCore.register` 的 list 分支先校验 `id`）。

### 10.2 两条与本轨道相关的外部校正（来自协调者插播，采用但不重复论证）

1. **判定改动必须按 `lib/` 逐文件 sha256 口径**（0.1.7↔0.2.0：225/280 包代码逐字节相同，仅 55 包有真实改动）；本机多数包的「差异」实为 `package.json` 里的版本文本。本轨道对 `dsh-skill-office` 的结论（§1.2：全包逐字节相同）**与该口径同向且更严**（连 `package.json` 的代码字段都只有版本文本差异）。
2. **`dsh-pptmaster` 的图标改名与嵌套依赖策略必须同批落地**（§2.8 表格第 2 行、§5.1 K4/K5）；第二档 T16 独立复核以 seat-kind/符号级证据确认该结论，并在 `reports/T16-web-client-plugin-compat.md` 附录 A 中记载互相印证关系。

### 10.3 新增未验证项（并入 §7 台账）

| # | 项 | 原因 | 需要什么 |
|---|---|---|---|
| U-9 | `conversation.hero.actions` / `conversation.hero.inputAccessory` 是否为**真实存在**的官方座 | 官方 0.1.1/0.1.7/0.2.0 三树皆 0 命中（`dsh-client-ui-chat` 在 0.1.1 不存在，其声明者在 3 个版本均未出现这两个名字） | 读 `dsh-client-ui-renderer` 中 `slots.inject` 的"座不存在时行为"分支，或隔离实例实测该注册是否生效 |
| U-10 | `@local/dsh-pptmaster` 在 0.2.0 下 `require("@deepseek-ai/dsh-client-runtime/client")` 与 `dsh-client-ui-primitives` 的**实际解析目标** | 该包自带嵌套 `node_modules`（23 个 `@deepseek-ai` 包，`primitives` = `0.1.1-rc.2`），现役靠它兜住；共享树（0.1.7/0.2.0）**无** `dsh-client-runtime` | 隔离组合内定案依赖布局后做模块解析断言（客户端模块 `require` 失败数 = 0） |

（§7 原 U-1…U-8 保持原位，本表续编 U-9/U-10。）

---
