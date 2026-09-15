# 重启前终审 D —— 分布式控制插件（dsh-ssh-gui v0.2.0）专项

- **阶段**：两阶段闭环 · 审计（只读，未写 `~/.dsh`，未用 sandbox_permissions）
- **路由**：adam/deepseek-v4-flash · 时间：2026-09-15
- **裁决**：**全绿（无 blocker，可重启交付）**
- 对照：`.workspace/distributed-control-exec.md`（执行档自裁决 pass）+ `.workspace/deploy-ssh-gui/` + 部署位 `~/.dsh/profiles/node_modules/@local/dsh-ssh-gui/`

---

## 结论式摘要

**重启就绪。** 7 项必查全部通过；风险清单 Q1–Q10 逐条确认**均不影响启动**（含重点 Q5 exports 绕行——已从部署位实测成立；Q8 部署后实测为重启后跟进项，非 blocker）。唯一需注意的运行事实：当前 web 进程（14:38 启动）已带 11:56 首次部署的 ssh-gui insert 正常运行，证明 patch 插入块可被 cordis 真实加载；16:26 落地的 v0.2.0 最终代码需本次重启生效（即「重启前终审」的对象）。

---

## 1. 部署一致 —— ✅ 全绿

`cmp -s` 逐字节比对部署位 vs 源码位 `.workspace/deploy-ssh-gui/dsh-ssh-gui/`，**8 个文件全部 IDENTICAL**：

```
IDENTICAL  lib/client.js   lib/core.js   lib/index.js   lib/serial-tcp.js
IDENTICAL  package.json    README.md     LICENSE        cordis.patch.yml
```

`node --check` 部署位 4 文件：`SYNTAX-OK client / core / index / serial-tcp`（4/4）。

## 2. host 通道 —— ✅ 全绿

- **/ssh-gui handle**：`index.js:460` `ctx.connection.rpc.handle('/ssh-gui', dispatch, { authority: 'loopback' })`；全 profile 扫描 `/ssh-gui` 注册点**仅此一处**（另为 client 端常量 `CH_SSH="/ssh-gui"`，L63）；底座 `/dsw` 单 handle（web.js:504）未动、未二次注册。
- **serial exports-map 绕行（重点 Q5）**：从部署位实测模拟（`createRequire` 以部署位 `lib/index.js` 为基准）：
  ```
  RESOLVE-OK  pkgJson   = ~/.dsh/profiles/node_modules/@local/dsh-workerspace/package.json
  RESOLVE-OK  serialPath= …/dsh-workerspace/lib/serial.js
  EXPORTS: SerialSession:function  listSerialPorts:function  serialLogPath:function
           formatLogLine:function  RING_CAP:number  POLL_MS:number
  ```
  dsh-workerspace `exports` 确只导出 `.` 与 `./package.json`、`files:["lib",…]` → 经 package.json 推导 `lib/serial.js` 的绕行**成立**（index.js L78-93 实现与注释一致）。
- **serial-tcp**：`lib/serial-tcp.js` 用 `node:net` 的 `connect`（connectFn 可注入，测试用假 socket）；接口与 SerialSession 对齐（open/write/readSince/stats/close），ring 缓冲 1MiB。
- **路径可写**：全部写目标自带 `mkdir(recursive)`：
  - `writeNodesFile`：`mkdirSync(dirname, {recursive, mode:0o700})` + `writeFileSync(…, {mode:0o600})`（core.js L841-842）；
  - `serialTcpLogPath`：`mkdir(recursive, 0o700)`（serial-tcp.js L196）；
  - workerspace `serialLogPath`：`mkdir(recursive, 0o700)`（serial.js L329）；底座 registry 持久化前 `mkdirSync(dirname, {recursive:true})`（registry.js L244）。
  - `exec-audit.log` 走 `appendFile`（best-effort，失败不阻断执行）；其所在目录 `~/.dsh/remote-workspaces`（`DSH_HOME=/home/CNS2026495165/.dsh` 已确认）由首次 nodes.json 写入自建，先于任何 exec.run（loadUnifiedNodes 在 exec 前必被调用）。**目录当前不存在属正常**（重启前未生成），首次使用自建。
  - 说明：ssh-gui 产物（nodes.json/exec-audit.log/serial-logs）在 `~/.dsh/remote-workspaces/`；`~/.dsh/workerspace/` 是 dsh-workerspace 工具的产物目录（ws_serial_* 日志），两处互不依赖。

## 3. client 注册 —— ✅ 全绿

三注册（client.js L987-1007），与需求逐项吻合：

| 槽 | id | order | label |
|---|---|---|---|
| `settings.section` | `@local/dsh-ssh-gui` | 50 | 分布式控制 · dsh-ssh-gui |
| `conversation.session.header.actions` | `@local/dsh-ssh-gui-actions` | 26 | 节点 |
| `sidebar.workspaces.remoteHosts` | **`@local/dsh-ssh-gui-remote-hosts`** | **10** | **分布式节点** |

- **槽位 B 匹配**：部署树官方 ui-workspace `lib/client.js` 含 `renderSlot("sidebar.workspaces.remoteHosts", {})`（L2013）与 children 声明 `"sidebar.workspaces.remoteHosts": { kind: "list", scope: "root" }`（L2440），`slots.d.ts` L65 同契约；补丁文件 `.workspace/deploy-slots/patches/dsh-client-ui-workspace.remote-hosts-slot.patch` 与之对应，REPLAY.md 已登记。
- **端点调用面与 core.js 签名一致**：client 使用 `config.get / nodes.list,add,remove,setCurrent,test / node.status / keyref.list,set,unbind / exec.run / serial.open,read,close,ports / file.list,get,put`（7×nodes.list、2×nodes.add、8×node.status 等），core dispatch 端点为 `config.get / nodes.list,add,remove,setCurrent,test / node.status / keyref.list,set,unbind / exec.run / serial.ports,open,send,read,close / file.list,get,put`——**client 调用面 ⊆ core 端点全集**，载荷校验（isNodeAddPayload{node,password?,keyRef?} 等）在位；串口面板发送走 `exec.run{id,command,lineEnding}`（core console 执行 open→send→read-until-quiet），`serial.send` 端点存在但 GUI 未用（无缺端点）。

## 4. nodes.json —— ✅ 全绿（未生成，代码路径验证）

- `~/.dsh/remote-workspaces/nodes.json` **尚未生成**（目录不存在，重启前正常）——schema 经代码验证：`migrateMachinesToNodes` 产出 `{version:1, currentId, nodes:[{id,name,transport,target}]}`（target 按 ssh/serial/serial-tcp 三类规范化）；`readNodesFile` 容错（缺失/损坏回退空表）。
- **machines.json 迁移不冲突**：ssh-gui **从不直写 machines.json**——ssh 节点 `nodes.add` 走 `env.registry.saveMachine`（底座服务，其自身 persist 自建目录）；`syncNodesWithMachines` 只读 `listMachines()` 结果按 id 对齐（导入新增/修剪已删/更新字段），serial/serial-tcp 节点只在本表。双向同步语义与底座生态共存（Q1 决策，README/RUNBOOK 已注明）。
- **0600**：`writeNodesFile` 创建即 `0o600`；PEM 密钥 `mkdir 0o700 + write 0o600 + chmod 0o600`（core.js L149-151）；keyrefs 侧表同 `0o700/0o600`。

## 5. 与既有功能冲突 —— ✅ 全绿

- **无重复注册/服务冲突**：ssh-gui host 侧**零工具注册**（index.js 无 registerTool）→ 与底座 sw_* 工具（tools.js：sw_connect/sw_pick_workspace/sw_status 等）和 dsh-workerspace 工具（`ctx.tools.register` ws_serial_list/open/send/read/close + ws_flash）零重叠；workerspace 无 rpc.handle，通道面无冲突。
- **serial.js 复用**：作为纯模块 import（非 cordis service 注册）→ 无服务层冲突；GUI 会话表与 workerspace 工具会话表独立（Q6，同端口二次打开由 OS 拒绝自然上抛）。
- **picker**：既有布线（`directory-picker` 禁用 ×2 + `directory-picker-browse` 插入）为历史面，ssh-gui client 对 directory-picker/directoryFlow **零注册**，未触碰。
- **侧栏 slot 语义**：官方槽声明 `'sidebar.workspaces.remoteHosts': { kind:'list' }`（注释明示「list-kind, so any plugin may add its own folder section without touching the single-kind directory-flow holes」）vs `directoryFlow { kind:'single' }`（底座 SshWorkspaceFlow 所在）——ssh-gui 只注册 list 槽，**与 single 槽语义正交，不冲突**。
- **settings/patch 唯一性**：settings.yaml 顶层 `dsh-ssh-gui:` 键 **1 处**（file/exec/security，serial/nodes 走 Config 默认）；profile cordis.patch.yml 中 ssh-gui insert **1 处**，无重复条目。

## 6. 测试 —— ✅ 全绿（部署位副本复跑）

测试导入面全部为纯逻辑 + `mkdtemp(tmpdir)`（零 `~/.dsh` 写面、零网络、slots 测试纯读 client.js）。以**部署位插件目录**为被测对象复跑（test/ 拷入 /tmp，`dsh-ssh-gui → 部署位符号链接`，与被测源码逐字节一致）：

```
node --test test/nodes.test.mjs test/serial-tcp.test.mjs test/transport.test.mjs test/slots-registration.test.mjs
→ # tests 37  # pass 37  # fail 0    （nodes 12 + serial-tcp 10 + transport 11 + slots 4）
node --test test/*.test.mjs（全量 9 文件）
→ # tests 81  # pass 81  # fail 0    （与执行档 81/81 声称一致）
```

## 7. 风险清单 Q1–Q10 逐条确认（重点标★）

| # | 内容 | 影响启动？ | 结论 |
|---|---|---|---|
| Q1 | ssh 节点双写 machines.json↔nodes.json（底座 ssh 权威 + 面板统一表） | **否** | 决策项；写穿走底座服务无文件冲突，README/RUNBOOK 已注明 |
| Q2 | console 节点无文件面（file.* 对 console 返回「传输不支持文件操作」） | **否** | 运行时 UX 边界，非启动路径 |
| Q3 | serial-tcp 无凭据（raw TCP，访问控制委托 ser2net/socat） | **否** | 需求既定，README 注明 |
| Q4 | console exec.run 语义（命令+`\n`、read-until-quiet 400ms、exitCode=null） | **否** | 运行时语义，RUNBOOK §7 注明 |
| **Q5** | **dsh-workerspace exports 不导出 ./lib/serial.js → package.json 路径推导绕行** | **否** | ★ **已从部署位实测成立**（§2 证据：RESOLVE-OK + 6 导出就位）；index.js 注释与实现一致，可关项 |
| Q6 | GUI 会话表与 workerspace 工具会话表独立，同端口二次打开由 OS 拒绝 | **否** | 运行时边界，RUNBOOK §7 注明 |
| Q7 | deploy-slots slot-b-exec.md/REPLAY.md 仍记旧 label（远程主机） | **否** | 纯文档历史记录，不影响运行（主代理可决定是否更新） |
| **Q8** | **部署后实测：boot 条目 / GUI 渲染 / 真机 SSH exec / 真串口 / 真 serial-tcp / 0600 产物落盘** | **否**（重启后跟进） | ★ 重启前已尽的证据：cordis patch insert 已被**运行中进程实测加载**（web 14:38 启动带 11:56 部署的 insert 正常运行未崩）；最终代码 node --check 4/4 + 与源码逐字节一致 + 81/81 测试；真机实测按 RUNBOOK §5 于重启后执行，属后续验收动作而非启动阻塞 |
| Q9 | exec 审计日志恒开（无 settings 开关） | **否** | 决策项，README 注明 |
| Q10 | 包版本 0.1.0→0.2.0（泛化 minor） | **否** | deploy.sh 整目录拷贝，无版本耦合 |

## 附注（非 blocker 观察）

1. 部署位 `lib/*.js` 权限 0600（cp 保留源码位权限）——web 以同用户运行，可读，无影响。
2. `cordis.patch.yml` 全文件用 js-yaml/py-yaml 解析报 `!!js` 未知 tag——那是 cordis 自定义 tag（dsh-pptmaster `root: !!js dshHomePath('office-ppt')` 同款，**当前运行实例已在用**），须由 cordis 自身 loader 解析；ssh-gui insert 块本身为纯 YAML，与已正常加载的 workerspace insert 同构，无文件缺陷。
3. `~/.dsh/remote-workspaces` 与 `~/.dsh/workerspace` 当前均不存在——均由各自插件首次使用时自建（mkdir recursive），重启后首次 nodes.list / 会话打开时生效。
4. workerspace 目录内含 `index.js.bak`——dsh-workerspace 自身历史产物，不在本插件写入面。

## 验收对照（重启后按 RUNBOOK §5）

重启 → `nodes.list` 冒烟（自动建 nodes.json，0600）→ 设置页「分布式控制 · dsh-ssh-gui」→ header「节点」→ 侧栏「分布式节点」→ 真机 SSH exec / 真串口 / 真 serial-tcp / exec-audit.log 落盘。
