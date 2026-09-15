# RUNBOOK —— @local/dsh-ssh-gui（分布式控制）部署与验收

> 执行档：`.workspace/deploy-ssh-gui/`。约束遵守：**绝不执行 `npm/pnpm install
> --prefix ~/.dsh/profiles/web`**（会重新遮蔽全局补丁树）；本插件零第三方依赖
> （ssh2 / dsh-* 全部复用底座与 DSH 自带包），部署只做拷贝 + patch 追加 + settings 段。

## 1. 前置（须先就位）

| 项 | 检查 | 命令 |
|---|---|---|
| 底座 | dsh-workspace-enhancement@0.1.2 在位 | `[ -d ~/.dsh/profiles/node_modules/dsh-workspace-enhancement ]` |
| 底座 web 行 | ssh-web-channel 在位 | `grep -n ssh-web-channel ~/.dsh/profiles/web/cordis.patch.yml` |
| workerspace | @local/dsh-workerspace 在位（serial:// 节点必需；未装则 serial 传输报错，ssh/serial-tcp 不受影响） | `[ -d ~/.dsh/profiles/node_modules/@local/dsh-workerspace ]` |
| credentials | ctx.credentials（dsh-credentials-local，dsh-base patch 已挂） | 无需动作（服务存在性运行时验证） |
| node | >= 22 | `node --version` |

## 2. 本地校验（本仓库交付前已执行，可复跑）

```bash
cd .workspace/deploy-ssh-gui
node --check dsh-ssh-gui/lib/core.js
node --check dsh-ssh-gui/lib/index.js
node --check dsh-ssh-gui/lib/serial-tcp.js
node --check dsh-ssh-gui/lib/client.js
node --test test/*.test.mjs          # keyRef / exec / file / security / nodes / serial-tcp / transport / slots
bash -n deploy.sh
bash deploy.sh                       # dry-run（不写 ~/.dsh）
```

## 3. 部署（由操作者在目标机执行，人工确认）

```bash
bash deploy.sh --apply
# 输出应含：插件拷贝 → patch 追加（id: ssh-gui）→ settings.yaml 追加 dsh-ssh-gui 段
```

> 若 `settings.yaml` 不需要显式段（默认值即可），可仅保留 patch 追加；
> `dsh-ssh-gui:` 段缺省时插件走 schema 默认（file.maxBytes=10MB / confirmExec=true）。

## 4. 重启（bundle/insert 生效）

```bash
# 停掉当前 dsh web（如 node ~/.npm-global/bin/dsh web）后按原方式重启
# HMR 不覆盖 host 装配变更，必须重启
```

## 5. 验收

### 5.1 装配冒烟（boot 面）

```bash
curl -s http://127.0.0.1:3080/ | grep -o '@local/dsh-ssh-gui'   # boot 出现新 client 条目
# host 行在线：nodes.list 直查（应回三类传输 + 已迁移节点）
curl -s -X POST http://127.0.0.1:3080/ssh-gui/nodes.list \
  -H 'content-type: application/json' \
  -d '{"type":"client-request","rpcId":"smoke-1","method":"nodes.list","payload":{}}'
# 期望：{"ok":true,"value":{"nodes":[...],"currentId":"...","transports":["ssh://","serial://","serial-tcp://"]}}
curl -s -X POST http://127.0.0.1:3080/ssh-gui/config.get \
  -H 'content-type: application/json' \
  -d '{"type":"client-request","rpcId":"smoke-2","method":"config.get","payload":{}}'
```

### 5.2 GUI 面（分布式控制面板）

1. 设置页出现「分布式控制 · dsh-ssh-gui」条目（order 50）；
2. 「新建节点」三类表单：SSH（host/user/port/agent/口令/keyRef）、本地串口
   （设备路径下拉来自 `serial.ports` / 波特率 / 后端）、TCP 串口服务器（host/port/tty）→ 保存；
3. 节点列表：传输徽章（SSH/串口/TCP串口）+ 目标 + keyRef + 状态点 + 操作
   （编辑/设当前/测试/忘记密钥(ssh)/绑定解绑 keyRef(ssh)/删除）；
4. 会话头部「节点」按钮 → 对话框：选节点 → 命令 tab（ssh=命令面板，serial/serial-tcp=控制台
   发送/读取）；文件 tab（ssh=目录树+上传下载，serial=不支持提示）；
5. **侧栏「分布式节点」文件夹（槽位路径 B，需先应用官方补丁）**：侧栏出现「分布式节点」
   section（定高 + 内部滚动）→ 各节点展开：ssh = 目录浏览 + 「打开为工作区」（复用
   /dsw session.route + workspaces.create + connectWorkspace）；serial/serial-tcp = 串口
   控制台（打开/关闭会话、发送命令、读取更多、日志路径；**不做工作区**）。
   - 前置：`cd ~/dsh/.workspace/deploy-slots && bash patch-official-slots.sh --apply`（官方
     ui-workspace 声明 `sidebar.workspaces.remoteHosts` list 槽）+ 重启 + 刷新；
   - 反向验收：未装 ssh-gui（或未应用官方补丁）时侧栏**零变化**；
   - 回归：底座 SSH 流「添加工作区」入口/对话框与官方 picker 行为不变。

### 5.3 统一配置 nodes.json + keyRef

```bash
# 1) 首启迁移：nodes.json 由 machines.json + settings 种子自动生成（只读检查）
ls -l ~/.dsh/remote-workspaces/nodes.json          # 0600，一张表（ssh + serial + serial-tcp）
cat ~/.dsh/remote-workspaces/nodes.json            # 形态见 README
# 2) 在 ~/.dsh/.credentials.yaml 配置 PEM 私钥（值永不出 host）：
#    MY_SSH_KEY: |
#      -----BEGIN OPENSSH PRIVATE KEY-----
#      ...
# 3) GUI：SSH 节点「绑定 keyRef」→ 输入 MY_SSH_KEY → 保存
# 4) 核验产物（只读检查）：
ls -l ~/.dsh/remote-workspaces/.secrets/keys/c1        # 0600
ls -l ~/.dsh/remote-workspaces/ssh-keyrefs.json         # 0600，只存引用名
grep -o '"keyRef"[^,]*' ~/.dsh/remote-workspaces/nodes.json   # ssh 节点带 ref 名（无值）
# 5) 解绑：主机行「解绑 keyRef」→ 密钥文件删除、machines.json 的 privateKeyPath 清除、
#    nodes.json 的 keyRef 清除
```

### 5.4 serial / serial-tcp 控制台

```bash
# 1) 新建 serial:// 节点（如 /dev/ttyUSB0 @ 115200）或 serial-tcp:// 节点（host:port）
# 2) 控制台面板：打开会话 → 发送命令（如 help）→ 读取输出（exec.run 自动 open→send→read）
# 3) 日志落盘（只读检查）：
ls -l ~/.dsh/remote-workspaces/serial-logs/            # serial-*.log / serial-tcp-*.log（hex+文本）
tail -n 5 ~/.dsh/remote-workspaces/exec-audit.log      # exec.run 审计 JSONL（node/transport/command/exitCode）
# 4) serial-tcp 连通测试：nodes.test（open→close 探活）；或直接控制台发送
# 5) 反向：file 页对 serial 节点提示「传输不支持文件操作」
```

### 5.5 安全核对

| 项 | 验收 |
|---|---|
| TOFU accept-new | ssh 新主机首连接受指纹（沿用底座 HostKeyGuard）；serial-tcp raw TCP 无指纹面 |
| PEM 0600 | `stat -c '%a' ~/.dsh/remote-workspaces/.secrets/keys/*` == 600 |
| 明文不进模型/浏览器 | nodes.json / keyref.list 只含 ref 名；GUI 无密钥内容输入/回显 |
| 命令白名单/确认 | `execAllowlist` 非空时白名单外命令被 host 拒（bad-request，**所有传输**）；
  confirmExec=true 时 ssh 执行与串口发送均弹确认 |
| 脱敏 | 连接/读键失败消息中私钥路径显示 `<redacted>` |
| 大文件 | `file.get/put` 超 `file.maxBytes`（默认 10MB）返回明确错误并提示走 `sw_*` 工具 |

## 6. 回滚

```bash
bash deploy.sh --rollback
# 还原 cordis.patch.yml / settings.yaml 最近备份 + 删除 ~/.dsh/profiles/node_modules/@local/dsh-ssh-gui
# 无备份时手工：移除 patch 中 id: ssh-gui 的 - insert: 块；移除 settings.yaml 的 dsh-ssh-gui 段
# 注意：不删除用户已绑定的 ~/.dsh/remote-workspaces/.secrets/keys/*、ssh-keyrefs.json、
# nodes.json 与日志（数据归属用户）
```

## 7. 已知约束与记录在案的决策

- **目录流槽位**：官方 directoryFlow 是 single 槽（底座已占），本插件不注册任何
  directoryFlow / directoryPicker seam；侧栏走 sidecar list 槽 `sidebar.workspaces.remoteHosts`
  （id 沿用 `@local/dsh-ssh-gui-remote-hosts`，未改名——避免破坏 deploy-slots 已登记文档）。
- **通道名沿用**：RPC 通道仍是 `/ssh-gui`（未新建 /distributed）——最小面选择：单一
  loopback 通道 + dispatch 增长，无需二次 handle/授权，client 侧零改动面。
- **nodes.json 权威性**：ssh 节点与底座 machines.json 双向同步（底座是 ssh 集合权威，
  nodes.json 是面板统一表）；serial/serial-tcp 仅存在于 nodes.json；GUI CRUD 是节点权威。
- **serial 后端复用**：serial:// 经模块解析复用 `@local/dsh-workerspace/lib/serial.js`
  （纯 node builtins；懒加载；未装时优雅降级）。GUI 会话表与 workerspace 工具会话表独立，
  同端口二次打开由 OS 拒绝并上抛错误。
- **serial-tcp 无凭据**：raw TCP；访问控制由 ser2net/socat 侧负责。
- **exec.run 于 console 传输**：发送命令文本 + `\n`（可用 `lineEnding` 覆盖），
  read-until-quiet（静默 400ms 判定输出结束）；exitCode=null（无进程退出码）。
- **file.get/put 用 stat + readFile/writeFile**（ssh2 fastXfer 引擎的内存安全封装），
  语义等同 fastGet/fastPut + base64；大文件提示走 `sw_*`。
- **目录流 symlink**：自有树不跟随 symlink 目录（底座目录流跟随）——已知 UX 差异。
