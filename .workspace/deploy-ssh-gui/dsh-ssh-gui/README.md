# @local/dsh-ssh-gui

DSH 部署的「分布式控制」GUI 薄插件。把 **SSH 主机 + 本地 USB 串口 + TCP 串口服务器**
统一为「分布式控制节点」：

```
node = { id, name, transport, target }
transport ∈ ssh://（远端主机） / serial://（本地 USB 串口） / serial-tcp://（ser2net/socat）
```

复用底座 `dsh-workspace-enhancement@0.1.2` 的全局 seam（`ctx.sshRegistry` 主机注册表 /
`machines.json` / TOFU / `/dsw` RPC / `ctx.credentials` 凭据槽）与 `@local/dsh-workerspace`
的串口后端（模块解析复用），**不改底座、不改 core、不改 dsh-workerspace**。

**终端交外部**：GUI 只做 连接管理 / 节点状态 / 命令执行（`exec.run`）/ 文件操作
（`file.get/put`）/ 目录浏览——不内嵌交互终端。

## 统一配置：nodes.json

`~/.dsh/remote-workspaces/nodes.json`（一张表，0600）：

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

- **ssh://**：与底座 `machines.json` 双向同步（机器迁移并入 + 底座新增自动导入 + 面板删除
  同时删底座；`sw_*` 工具 / 底座目录流保持一致）。凭据仍 **keyRef**（`~/.dsh/.credentials.yaml`
  引用，无明文；侧表 `ssh-keyrefs.json` 沿用，密钥 0600 落盘）。
- **serial://**：本地 USB 串口；复用 `dsh-workerspace` 的 `SerialSession` 后端
  （stty 零依赖默认 / serialport 可选）。**要求 `@local/dsh-workerspace` 已装**
  （未装时 serial:// 节点报「workerspace plugin not installed」错误，ssh/serial-tcp 不受影响）。
- **serial-tcp://**：`net.connect(host:port)` → 远端串口控制台（ser2net/socat），raw 字节
  收发 + 日志 + 会话式；**无凭据**（raw TCP）。
- 首启迁移：nodes.json 不存在时导入 `machines.json` + settings 种子
  （`dsh-ssh-gui.nodes.seed.*`），此后 GUI CRUD 是权威。

## 装配

- profile `cordis.patch.yml` 追加一条 insert（插件自带 `cordis.patch.yml` 同款）：
  `- insert: [{ id: ssh-gui, name: '@local/dsh-ssh-gui' }]`。
- 依赖底座行 `ssh-web-channel`、`dsh-credentials-local` 与 `@local/dsh-workerspace`
  （serial:// 用）；全部服务/模块懒取，行序无关。
- **零第三方依赖**（ssh2 由底座自带；串口后端由 dsh-workerspace 自带；不执行任何
  `npm/pnpm install`）。

## settings（settings.yaml `dsh-ssh-gui:` 段，全部可选）

```yaml
dsh-ssh-gui:
  file:
    maxBytes: 10485760        # 单文件传输上限，默认 10MB
  exec:
    timeoutMs: 30000          # 单命令执行超时，默认 30s（上限 600s）
    maxOutputBytes: 1048576   # 每流输出上限，超出截断
  security:
    confirmExec: true         # 客户端执行/发送前二次确认（所有传输生效）
    execAllowlist: []         # 非空 = 首 token 精确白名单（host 侧硬闸，所有传输生效）
  serial:
    logDir: ""                # 控制台会话日志目录（缺省 ~/.dsh/remote-workspaces/serial-logs）
  nodes:
    seed:                     # 首启迁移种子（仅 nodes.json 不存在时导入）
      serial: []              # [{ id?, name?, port, baudRate?, backend? }]
      serialTcp: []           # [{ id?, name?, host, port, tty? }]
```

## GUI 入口

- **设置页** `settings.section`（id `@local/dsh-ssh-gui`，order 50）：节点 CRUD
  （类型选择：SSH / 本地串口 / TCP 串口服务器）+ keyRef 绑定 + 测试连接 + 设当前 +
  「节点 → 目录浏览 / 串口控制台」树。
- **会话头部按钮** `conversation.session.header.actions`（id `@local/dsh-ssh-gui-actions`，
  order 26）：「节点」→ 对话框（命令面板 / 文件树，按节点类型适配：ssh 命令/文件，
  serial/serial-tcp 控制台发送/读取）。
- **侧栏「分布式节点」文件夹** `sidebar.workspaces.remoteHosts`（id
  `@local/dsh-ssh-gui-remote-hosts`，order 10）：侧栏目录流真集成（槽由官方 ui-workspace
  补丁声明，见 `.workspace/deploy-slots/`）→ 各节点展开：ssh = 目录浏览 + 「打开为工作区」
  （复用 `/dsw session.route`）；serial/serial-tcp = 串口控制台（**不做工作区**）。

> directoryFlow 说明：`conversation.hero.workspace.directoryFlow` /
> `sidebar.workspaces.directoryFlow` 是官方 single 槽，底座 `SshWorkspaceFlow` 已占用；
> 本插件不注册任何 directoryFlow / directoryPicker seam（见报告 §0 / slot-mod-audit.md）。

## 传输分发（host `/ssh-gui` 通道）

| 面 | ssh:// | serial:// / serial-tcp:// |
|---|---|---|
| exec.run | `connection.exec`（cwd/退出码/stdout/stderr） | 控制台：open → send(命令+\n) → read-until-quiet（exitCode=null；`lineEnding` 可选） |
| file.list/get/put | SFTP（base64，上限默认 10MB） | **不支持**（bad-request 提示用 ssh:// 节点） |
| node.status | 底座 `statusOf`（active/offline/unknown） | 会话状态（closed/open/error + 字节计数 + 日志路径） |
| 打开为工作区 | ✅ 底座链路 | ❌（不做工作区） |
| 凭据 | keyRef（credentials ref → 0600 PEM） | 无（serial-tcp raw TCP 无凭据） |
| 日志 | exec.run 审计（`exec-audit.log` JSONL） | 会话收发 hex+文本 + exec 审计 |

## 安全

1. **TOFU accept-new**：ssh 沿用底座 `HostKeyGuard`；serial-tcp raw TCP 无指纹面
   （访问控制由 ser2net/socat 侧负责）；
2. **PEM 0600**：`mkdir 0700 + write 0600 + chmod` 三重显式，密钥内容永不进模型/浏览器；
3. **命令白名单/确认**：`security.execAllowlist` 对**所有传输**生效（host 侧硬闸）；
   `confirmExec` 客户端二次确认（ssh 执行 / 串口发送均弹确认）；
4. **脱敏 + 日志落盘**：错误消息私钥路径/口令值一律 `<redacted>`；会话收发与命令审计落盘
   （`~/.dsh/remote-workspaces/serial-logs/`、`exec-audit.log`）。
