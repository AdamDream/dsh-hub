# 重启前终审 B —— 插件群接口与依赖（审计结论）

- 阶段：审计（两阶段闭环阶段一，只读）
- 路由：adam/deepseek-v4-flash
- 日期：2026-09-15
- 结论：**全绿，无 blocker**（详见 §7 重启注意，非 blocker 级）

---

## 1. 自装插件完整性 —— ✅ 全绿

9 个自装插件（`~/.dsh/profiles/node_modules/`）：

| 插件 | main | lib/index.js | node --check 全部 lib/*.js | require() 加载 |
|---|---|---|---|---|
| @local/dsh-btw 0.4.0-btw.1 | lib/index.js | ✅ | ✅ | ✅ |
| @local/dsh-pptmaster 0.1.0 | lib/index.js | ✅ | ✅ | ✅ |
| @local/dsh-usage 0.1.0 | lib/index.js | ✅ | ✅ | ✅ |
| @local/dsh-wallpaper 0.5.0 | lib/index.js | ✅ | ✅ | ✅ |
| @local/dsh-ssh-gui 0.2.0 | lib/index.js | ✅ | ✅ | ✅ |
| @local/dsh-workerspace 0.1.0 | lib/index.js | ✅ | ✅ | ✅ |
| @deepseek-ai/dsh-taste 0.1.0 | lib/index.js | ✅ | ✅ | ✅ |
| @deepseek-ai/dsh-vision-adam 0.2.0 | lib/index.js | ✅ | ✅ | ✅ |
| @deepseek-ai/dsh-session-board 0.1.0 | lib/index.js | ✅ | ✅ | ✅ |

证据（节选）：
- `node -e "require('./<pkg>')"` → `LOAD-OK` × 9
- `for f in <pkg>/lib/*.js; do node --check $f; done` → `ALL-LIB-JS-SYNTAX-OK`
- 无害遗留：`@local/dsh-pptmaster/lib/client.js.bak`、`@local/dsh-workerspace/lib/index.js.bak`（惰性备份，扫描/加载路径均不指向 `.bak`）

## 2. 原生/运行时依赖解析 —— ✅ 全绿

- **dsh-workspace-enhancement 底座**（ssh-gui 的 peer，`dsh-workspace-enhancement@0.1.2` 精确匹配已装 0.1.2）自带 node_modules，从其自身目录全部解析 + 原生加载成功：
  - `ssh2` → 自身 node_modules/ssh2/lib/index.js（Client 加载 OK）
  - `cpu-features` → 自身 node_modules（加载 OK）
  - `node-pty` → 自身 node_modules（spawn OK）
  - `koffi` → 自身 node_modules/index.cjs（proto OK）
- **ssh-gui 全部 peer 解析 OK**：@deepseek-ai/cordis、dsh-credentials、dsh-settings、schemastery、dsh-workspace-enhancement（从 ssh-gui 目录实测）
- **dsh-workerspace 全部 peer 解析 OK**：cordis、credentials、fs、settings、subprocess、tools、user-approval、schemastery
- **zod**：dsh-tool-subagent 要求 `^4.4.3`，实测解析到全局 dsh 安装 zod **4.6.2**（semver 满足）；dsh-btw 同源
- **dsh-pptmaster**（自带 node_modules 172 项）：pptxgenjs、typescript ^6.0.3、@aiden0z/pptx-renderer、koffi、zod 全部解析 OK；lightningcss-linux-x64-gnu 原生二进制在场
- **serialport**：`~/.dsh/settings.yaml` 为 `dsh-workerspace: {}`（无 `serial.backend`）→ 默认 **stty**，serialport **非必装**；即便用户配置 `backend: serialport`，serial.js L185 走 `createRequire` 懒解析，未装时抛带安装提示的优雅错误（open 期，非启动期）→ 非 blocker
- 观察（非 blocker）：profile `web/package.json` 声明 `ssh2 ^1.17.0` 但顶层未装（实际运行用 workspace-enhancement 自带副本）；顶层 node-pty/koffi 是指向全局 dsh 安装的遗留符号链接（9月12 创建），不影响解析

## 3. client __ModuleLoader__ 注册 —— ✅ 全绿

- 5 个带 client 的 @local 插件 entry id == 包名：
  - `@local/dsh-btw`、`@local/dsh-pptmaster`、`@local/dsh-usage`、`@local/dsh-wallpaper`、`@local/dsh-ssh-gui`（均 `window.__ModuleLoader__.load({id:"@local/<name>"…})`）
- **ssh-gui 三注册**（client.js L987-1006）：
  1. `settings.section`，id `@local/dsh-ssh-gui`，order 50
  2. `conversation.session.header.actions`，id `@local/dsh-ssh-gui-actions`，order 26
  3. `sidebar.workspaces.remoteHosts`，id `@local/dsh-ssh-gui-remote-hosts`，order 10
- **槽位匹配**：`.workspace/deploy-slots/patched/dsh-client-ui-workspace/lib/client.js` 声明 `sidebar.workspaces` children 含 `"sidebar.workspaces.remoteHosts": {kind:"list", scope:"root"}`（L2440 区域）+ `wide && renderSlot("sidebar.workspaces.remoteHosts", {})` 渲染点（L2013）。安装位 `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js` **MD5 与 patched 完全一致**（16:25 已部署），orig 无此槽（补丁真实生效），无 .rej/.orig 残留。注册槽名与声明槽名一致 ✅
- **client 包发现**：带 `dsh.client.platform:"web"` 的插件（btw/pptmaster/usage/wallpaper/ssh-gui/taste/workspace-enhancement）全部有 `exports["./client"]` 指向存在的 client.js；无 dsh.client 声明的（workerspace/vision-adam/session-board）无 client.js，一致 ✅
- ssh-gui client `inject: ["slots","connection","sessions","workspaces"]` — `workspaces` 是合法 client 服务 seam（ui-workspace 自身 inject 同名，L2360 区域）

## 4. cordis insert 幂等/无重复 —— ✅ 全绿

- `dsh --profile web --dump-config`：**148 条 entry，0 重复 id**（grep id 排序 uniq -d 为空）
- 13 个自定义 insert 全部在场且唯一：vision-adam、taste、btw、wallpaper、usage、session-status-board、ssh-remote、directory-picker-ssh（disabled: true）、ssh-web-channel、workerspace、dsh-pptmaster（root=office-ppt）、directory-picker-browse、ssh-gui
- **insert+disable 语义确认**（`@deepseek-ai/dsh-app-boot/lib/index.js` `applyEntryPatches`）：插入行随 `buildMap(insert)` 进 entryMap，后续 `- id: X, disabled: true` 定向补丁对插入行生效（set disabled）→ `directory-picker-ssh` 插入后正确 disabled；`directory-picker`（auto）disabled: true 也生效。dump 实证两行均为 `disabled: true`
- ssh-gui 在 patch 文件与最终树中**各出现一次**（无重复追加）
- agent-presets `config.default: standard-glm` 已应用（dump L504-507 实证）
- 注：subprocess/fs-sandbox 保持启用（workspace-enhancement bundle 未作 profile 层），但 workspace-enhancement 聚合行经 `ctx.set('subprocess', MixedSubprocessRuntime)` / `owner.set('fs', MixedFileSystem)` 覆盖 seam 值（plugin.js L74-109，行序在其后，消费者按 seam 名注入必得 facade）；安装失败有 try/catch 回退 pure-SSH（L121-128）→ 无服务冲突，非 blocker

## 5. skill 发现 —— ✅ 全绿

- 一层约定成立：`~/.dsh/skills/`（user-dsh root）下 `ppt-master/`、`grill-me/` 均为一层子目录含 `SKILL.md`；loader `discoverRoot`（dsh-skill-filesystem L581）对每个目录 entry 找 `<dir>/SKILL.md` ✅
- **ppt-master**：SKILL.md frontmatter `name: ppt-master` + description 有效；`attribution_guard.py` 位于 `scripts/`（SKILL.md L38 用 `python3 "${SKILL_DIR}/scripts/attribution_guard.py"` 调用），文件 `-rwxrwxr-x` 可执行、shebang `#!/usr/bin/env python3` 有效，`python3 3.12.3` 可用 ✅
- **grill-me**：SKILL.md 完整未损坏（frontmatter + 正文正常；`disable-model-invocation: true` 解释其不出现在本会话调用目录——预期行为）✅

## 6. cross-check：分布式插件 serial 适配器 —— ✅ 全绿

- **exports-map 绕行成立**：`@local/dsh-workerspace` package.json `exports` 仅 `"."` 与 `"./package.json"`（无 `./lib/serial.js`）；ssh-gui `loadWsSerialModule`（index.js L84-93）经 `require_.resolve('@local/dsh-workerspace/package.json')` → 推导 `lib/serial.js` → `import(pathToFileURL())`。**从 ssh-gui 目录实测成功**：resolve OK → import OK，导出 `POLL_MS,RING_CAP,SerialSession,formatLogLine,listSerialPorts,serialLogPath` ✅
- **无双重装载**：workerspace 相对 `import "./serial.js"` 与 ssh-gui 的 `pathToFileURL` 指向同一文件 URL（均为真实目录，无符号链接）→ ESM 单实例；模块仅有常量与类，无双实例危害 ✅
- **共用后端不冲突**：两插件各自独立会话表；默认 stty 后端；同端口二次打开自然上抛错误（文档化行为，非崩溃）。ws_serial_open 后端选择 `args.backend ?? cfg.serial?.backend ?? "stty"`，serialport 分支仅在配置时 require ✅
- ws_serial 工具（list/open/send/read/close）与 ws_flash（模板白名单 esptool/esptool.py/openocd/dfu-util/uuu/fastboot + 产物围栏）注册齐全，index.js 加载 OK ✅

## 7. 重启注意（非 blocker）

1. **重启为必须**：运行中实例（14:38 启动）早于 ssh-gui 安装（16:26）与 ui-workspace 槽位补丁部署（16:25）——重启后 client-modules 以新 rev 扫描并服务新 client bundle，remoteHosts 槽 + ssh-gui 面板才生效（这正是本终审所在的重启目的）。
2. 顶层 `ssh2` 未装 / node-pty、koffi 顶层符号链接：历史遗留，运行时解析不受影响；如需整洁可后续 `dsh plugin --profile web` 同步依赖，非本次阻塞。
3. 客户端侧 `workspaces` 等服务的激活时序（slots.inject 懒注册）为浏览器运行时行为，host 启动不受影响；如重启后 ssh-gui 面板未出现，优先看浏览器 console 的 client-modules 报错（与本次 host 侧审计无关）。

---

## 结论

**全绿，无 blocker。** 六项必查（插件完整性 / 原生与运行时依赖 / client 注册与槽位匹配 / cordis 幂等 / skill 发现 / serial 跨插件解析）全部通过，命令输出证据见上文各节。可进入重启交付。
