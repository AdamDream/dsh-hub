# 修订执行复核一体档报告 —— ssh-gui 泛化为「分布式控制」框架（SSH + 本地串口 + TCP 串口服务器）

- **阶段**：修订执行复核一体（Revise-Execute-Review，执行档 + 同档自复核）
- **路由**：adam/deepseek-v4-flash
- **时间**：2026-09-15（DSH 进程未重启；未写 `~/.dsh`；未使用 sandbox_permissions）
- **输入**：`.workspace/ssh-gui-audit.md`、`.workspace/ssh-gui-exec.md`、`.workspace/slot-b-exec.md` + `.workspace/deploy-slots/`、`.workspace/workerspace-exec.md` + `.workspace/deploy-workerspace/dsh-workerspace/`（串口后端源码）
- **交付目录**：`.workspace/deploy-ssh-gui/`（改源码，未部署）
- **自裁决**：**pass（可交付主代理部署；验收项全部本地可验证；部署后实测项见 §5）**

---

## §1 结论式摘要

1. **统一「分布式控制节点」抽象已落地**：`node = { id, name, transport, target }`，
   `transport ∈ ssh:// / serial:// / serial-tcp://`；命令/文件/状态全部经传输适配器分发
   （ssh=底座连接池，serial=复用 dsh-workerspace 串口后端，serial-tcp=自有 net 会话）。
2. **终端交外部**：GUI 只做 连接管理/节点状态/exec.run/file.get-put/目录浏览；串口控制台
   面板明示「不内嵌交互终端」（发送命令 + 读取输出，非 PTY）。
3. **统一配置 nodes.json**（`~/.dsh/remote-workspaces/nodes.json`，0600，一张表）：
   machines.json 首启迁移并入 + settings 种子导入 serial/serial-tcp；SSH 节点与底座
   machines.json **双向同步**（sw_* 工具/底座目录流保持一致）；keyRef 侧表沿用，无明文。
4. **工具保留**：`ws_serial_*` / `ws_flash` 零改动；serial 适配器**模块解析复用**
   dsh-workerspace 的 `SerialSession`/`listSerialPorts`/`serialLogPath`（含 exports-map
   绕行方案，见 §4-Q3）；ws_flash 仍为本地烧录。
5. **面板泛化**：侧栏「分布式节点」大文件夹（槽位 B `sidebar.workspaces.remoteHosts` 注册
   id 沿用 `@local/dsh-ssh-gui-remote-hosts`，未改名）、settings 页三类 CRUD 表单、
   header「节点」按钮 → 命令/文件按节点类型适配（ssh=命令面板+目录树，serial/serial-tcp=
   控制台发送/读取）。
6. **验证**：81/81 单测（48 既有 + 33 新增）、`node --check` 4 文件全过、client bundle 冒烟
   4/4、ESM 加载冒烟 + 跨插件串口后端复用实测通过、`bash deploy.sh` dry-run 零副作用；
   写入面仅 `.workspace/deploy-ssh-gui/` 与报告（git status 复核，未碰 dsh-workerspace
   源码 / deploy-015/ / deploy-lag/ / ~/.dsh）。

---

## §2 改动文件清单（`.workspace/deploy-ssh-gui/`）

| 文件 | 行数 | 说明 |
|---|---|---|
| `dsh-ssh-gui/lib/core.js` | 1683 | **核心扩展**：节点注册表（normalizeNode / migrateMachinesToNodes / syncNodesWithMachines / read-writeNodesFile / nodeView）、三类 target 规范化（ssh/serial/serial-tcp）、console 载荷编码（lineEnding/hex）、sanitizeConfig 增 nodes.seed 投影、**传输分发 dispatch**（nodes.*/node.status/serial.* 端点 + exec.run/file.* 按 transport 路由 + keyref↔nodes 同步） |
| `dsh-ssh-gui/lib/serial-tcp.js` | 201 | **新增**：`SerialTcpSession`（net.connect，socket 可注入；接口与 dsh-workerspace SerialSession 对齐：open/write/readSince/stats/close；ring 缓冲 + hex 日志 + 会话式） |
| `dsh-ssh-gui/lib/index.js` | 480 | cordis 接线：Config 增 serial.logDir + nodes.seed；**serial 适配器**（动态 import dsh-workerspace serial.js，exports 绕行）+ **serial-tcp 适配器**（SerialTcpSession）；console 会话表（nodeId 键、卸载全关）；`nodesFile`/`auditLog`/registryStatus-Probe-Remove-SetCurrent 注入；`/ssh-gui` 通道（沿用，未新建） |
| `dsh-ssh-gui/lib/client.js` | 1014 | **泛化**：asNode/transportLabel/nodeIcon/nodeMeta；`SerialConsolePanel`（serial/serial-tcp 命令面：状态/打开关闭/发送/读取/确认）；`NodeForm`（类型选择 + 三类条件字段）；`DistributedControlSettingsPage`（节点表 + CRUD + keyRef + 目录/控制台树）；`CommandPanel`（ssh 节点）；`DistributedControlActions`（header「节点」）；`SidebarDistributedNodesTree`（侧栏「分布式节点」）；3 条槽注册（id 不变） |
| `dsh-ssh-gui/package.json` | 56 | v0.2.0（泛化 minor）；描述/关键字更新 |
| `dsh-ssh-gui/README.md` | 113 | 分布式控制文档（nodes.json 形态/装配/settings/传输分发表/安全） |
| `dsh-ssh-gui/cordis.patch.yml` | 10 | insert-only 注释更新（id `ssh-gui` 不变） |
| `deploy.sh` | 206 | settings 段增 serial.logDir/nodes.seed 注释示例；验证段改 nodes.list 冒烟；文案更新 |
| `RUNBOOK.md` | 151 | 分布式控制验收（nodes.json / serial 控制台 / serial-tcp / 安全矩阵 / 决策记录） |
| `test/nodes.test.mjs` | 215 | **新增 12 用例**：三传输 target 规范化 / 迁移 / 同步 / 读写 / 载荷编码 |
| `test/serial-tcp.test.mjs` | 173 | **新增 10 用例**：假 socket 会话（open/write/readSince/stats/close/日志） |
| `test/transport.test.mjs` | 367 | **新增 11 用例**：传输分发全链路（迁移 / nodes CRUD / exec 按传输 / file 拒绝 / serial.* / keyref↔nodes / 审计） |
| `test/slots-registration.test.mjs` | 93 | 侧栏 label 断言 远程主机→分布式节点（注册 id/order 不变） |

## §3 nodes.json 形态（统一配置）

```json
{
  "version": 1,
  "currentId": "c1",
  "nodes": [
    { "id": "c1", "name": "m1", "transport": "ssh://",
      "target": { "host": "h1", "port": 22, "username": "u1", "keyRef": "MY_SSH_KEY" } },
    { "id": "s1", "name": "esp32", "transport": "serial://",
      "target": { "port": "/dev/ttyUSB0", "baudRate": 115200, "backend": "stty" } },
    { "id": "t1", "name": "rack", "transport": "serial-tcp://",
      "target": { "host": "10.0.0.5", "port": 4001, "tty": "/dev/ttyS0" } }
  ]
}
```

- **ssh:// target**：host/port/username/workspace?/cwd?/agent?/**keyRef（只存 ref 名）**——绝无口令/私钥内容；与底座 machines.json 双向同步（首启迁移 + 底座新增自动导入 + 面板删除同时删底座 + keyref.set/unbind 同步 target.keyRef）。
- **serial:// target**：port（设备路径）/baudRate（50–4000000，默认 115200）/backend（stty|serialport）。
- **serial-tcp:// target**：host/port/tty?——**无凭据**（raw TCP；访问控制由 ser2net/socat 侧负责）。
- 首启迁移：nodes.json 不存在时 = machines 全量 → ssh 节点 + settings `nodes.seed.serial/serialTcp` 导入（id 自动 s1…/t1…）；此后 GUI CRUD 是节点权威。
- 同域文件：`ssh-keyrefs.json`（沿用，machineId→refName）、`.secrets/keys/<id>`（0600 PEM）、`serial-logs/`（会话日志）、`exec-audit.log`（exec 审计 JSONL）。

## §4 适配器接口（console 统一面）与跨插件复用说明

**console 适配器**（serial:// 与 serial-tcp:// 共用；host index.js 注入、core dispatch 调用）：

```
console: {
  open(node, signal)            → { logPath, alreadyOpen }        // 会话式：每节点最多一个会话
  send(node, bytes, signal)     → { sentBytes }
  currentOffset(node)           → number                          // 绝对字节偏移（exec.run 预取）
  read(node, { fromOffset, timeoutMs, quietMs, maxBytes, signal }) → { buf, moreAvailable, nextOffset, totalReceived, lossy, timedOut }
  stats(node)                   → { state: open|closed|error, receivedBytes, sentBytes, logPath, readError }
  close(node, signal)           → { logPath, receivedBytes, sentBytes }
  ports()                       → [{ path, label }]               // serial 发现（serial.ports 端点）
}
```

- **serial:// 后端复用**：动态 `import` `@local/dsh-workerspace/lib/serial.js` 的
  `SerialSession`/`listSerialPorts`/`serialLogPath`（stty 零依赖默认 + serialport 可选，
  同一后端逻辑，零改动 dsh-workerspace）。**跨插件解析方案**：dsh-workerspace 的
  `exports` 只导出 `.` 与 `./package.json`（不导出 ./lib/serial.js）→ 经
  `require.resolve('@local/dsh-workerspace/package.json')` 定位包根再推导
  `lib/serial.js` 路径（"files" 含 lib/，安装后必然存在）。懒加载 + 未装时优雅降级
  （serial:// 报「workerspace plugin not installed」，ssh/serial-tcp 不受影响）。
- **ssh:// 适配器**：底座连接池 `registry.get/getActive` 的 `connection.exec`/`getSftp`
  （既有路径零回归——`resolveExecNode` 对未知/未同步 id 回落 legacy ssh 行为）。
- **serial-tcp:// 适配器**：`lib/serial-tcp.js` 的 `SerialTcpSession`（node:net，socket
  注入可测；与 SerialSession 接口对齐，故 console 适配器统一处理两类节点）。

**通道选择（按最小面）**：**沿用 `/ssh-gui` 通道扩展端点**（未新建 /distributed）——
单一 loopback handle + dispatch switch 增长，无二次 handle/授权、client 通道零改动；
通道名保留 ssh-gui（历史名），README/RUNBOOK 已注明其现为分布式控制统一通道。

**槽位注册**：id 沿用 `@local/dsh-ssh-gui-remote-hosts`（未改 `-nodes`）——避免破坏
deploy-slots 已登记文档/锚点；label 更新为「分布式节点」（settings 页「分布式控制 ·
dsh-ssh-gui」、header「节点」）。

## §5 自复核（逐需求核对 + 自裁决）

| 需求 | 核对 | 证据 |
|---|---|---|
| ① 统一节点抽象（三类传输 + 适配器分发） | ✅ | core normalizeNode/TRANSPORTS + 传输分发 dispatch；transport.test.mjs 11 用例 |
| ② 终端控制台交外部 | ✅ | 无 PTY；SerialConsolePanel 命令/状态面 + 明示文案；文件/目录/命令/状态四类操作齐 |
| ③ 统一 nodes.json（迁移并入 + keyRef） | ✅ | migrateMachinesToNodes + syncNodesWithMachines + keyRef 侧表沿用；nodes.test.mjs |
| ④ 工具保留（ws_serial_*/ws_flash + 后端复用） | ✅ | dsh-workerspace 零改动；模块解析复用实测通过（SerialSession/listSerialPorts/serialLogPath）；ws_flash 仍为本地烧录工具 |
| ⑤ 面板泛化（侧栏大文件夹 + 三类子项 + 串口控制台面 + header 适配） | ✅ | client.js 泛化；槽位 B 注册保持（id 沿用，label 更新）；ssh 打开为工作区既有链路、串口不做工作区 |
| 执行 1 host 侧（适配器/通道/注册表） | ✅ | core.js 传输适配器 + /ssh-gui 扩展端点（最小面，注明）+ nodes.json 注册表 |
| 执行 2 client 侧（树/命令/文件适配 + serial/serial-tcp 表单 + 槽保持） | ✅ | client.js；slots-registration 4/4 |
| 执行 3 配置/安全（三类、keyRef、serial-tcp 无凭据、确认白名单按传输、日志落盘） | ✅ | allowlist 对全部传输生效（host 硬闸）+ confirmExec 客户端确认；serial/serial-tcp 会话日志 + exec 审计落盘 |
| 执行 4 测试（适配器分发/迁移/连接构造/文件上限/确认逻辑 + node --check + bundle 冒烟） | ✅ | 81/81 单测；node --check 4 文件；bundle 冒烟 4/4；ESM 加载 + 跨插件复用实测 |
| 执行 5 自复核 + 零重叠 | ✅ | 本表 + git status 复核（仅 deploy-ssh-gui 写入）；未碰 dsh-workerspace 源码 / deploy-015/ / deploy-lag/ / ~/.dsh |
| 执行 6 报告 | ✅ | 本档 |

**验证记录**：`node --test test/*.test.mjs` → 81/81 pass；`node --check` core/index/client/serial-tcp 全过；
`bash deploy.sh` dry-run 零副作用；`bash -n deploy.sh` OK；ESM 加载冒烟（index.js name/inject/apply/Config）；
跨插件 serial.js 解析实测（`SerialSession,formatLogLine,listSerialPorts,serialLogPath`）。

### 自裁决：**pass**（可交付主代理部署；无 blocker）

### 问题清单（如实）

| # | 类型 | 内容 | 影响 / 处置 |
|---|---|---|---|
| Q1 | 记录决策 | SSH 节点双写 machines.json ↔ nodes.json（底座是 ssh 集合权威，nodes.json 是面板统一表；双向同步）。这是与底座生态（sw_* / 目录流）共存的必要取舍 | 已在 README/RUNBOOK §7 注明；若未来底座移除可单表化 |
| Q2 | 记录决策 | serial/serial-tcp 的「文件面」：串口控制台无文件系统，文件 tab/端点对 console 节点返回「传输不支持文件操作（用 ssh:// 节点）」。需求 5「串口节点…只做命令/文件面」按此诚实呈现解释 | 已在报告/RUNBOOK 注明；如需串口设备文件面（如 mpy 文件系统）属范围外增强 |
| Q3 | 记录决策 | serial-tcp 无凭据（raw TCP），访问控制委托 ser2net/socat 侧 | 需求既定；README 注明 |
| Q4 | 记录决策 | console 传输 exec.run 语义：命令文本 + `\n`（`lineEnding` 可覆盖）、read-until-quiet（静默 400ms）、exitCode=null（无进程退出码） | 已在 RUNBOOK §7 注明 |
| Q5 | 跨插件实现细节 | dsh-workerspace exports 不导出 ./lib/serial.js → 经 package.json 路径推导（零改动 workerspace） | 已在 index.js 注释 + README 注明；已实测通过 |
| Q6 | 已知边界 | GUI 串口会话表与 workerspace 工具会话表独立；同端口二次打开由 OS 拒绝并上抛 | 已在 RUNBOOK §7 注明 |
| Q7 | 文档归属 | deploy-slots 的 slot-b-exec.md/REPLAY.md 仍记旧 label（远程主机/SidebarRemoteHostsTree）——历史记录，deploy-slots 不在本档写入面 | 主代理可决定是否更新（不影响运行） |
| Q8 | 部署后实测 | boot 条目 / GUI 渲染 / 真机 SSH exec / 真串口 / 真 serial-tcp 服务器 / 0600 产物落盘 | 部署 + 重启后按 RUNBOOK §5 执行（本档不得写 ~/.dsh/重启） |
| Q9 | 记录决策 | exec 审计日志恒开（无 settings 开关，保持最小面） | README 注明；如需开关为后续增强 |
| Q10 | 记录决策 | 包版本 0.1.0 → 0.2.0（框架泛化 minor） | deploy.sh 整目录拷贝，无版本耦合 |

### 给主代理的部署指针

```bash
cd /home/CNS2026495165/dsh/.workspace/deploy-ssh-gui
bash deploy.sh              # dry-run（已验，零副作用）
bash deploy.sh --apply      # 真实部署（拷贝插件 + patch 1 行 insert + settings 段）
# 前置：dsh-workerspace 须已装（serial:// 用）；侧栏槽位 B 需先
#   cd ~/dsh/.workspace/deploy-slots && bash patch-official-slots.sh --apply
# 重启 dsh web → 按 RUNBOOK.md §5 验收（nodes.list 冒烟 / 设置页 / header「节点」/ 侧栏「分布式节点」）
bash deploy.sh --rollback   # 回滚
```
