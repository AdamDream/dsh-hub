# dsh-workerspace（@local/dsh-workerspace）—— DSH SoC/嵌入式薄插件

> 定位：补 DSH 生态「SoC/嵌入式本地面」空白（串口 / 烧录 / 产物落盘），与底座
> **dsh-workspace-enhancement@0.1.2** 分工：远程主机/交叉编译走底座（sw_* 工具 + 缝路由），
> 本插件只碰**本机 USB 串口与本地烧录**。零运行时依赖（默认 stty 后端），无 client 注入。

## 一、安装与装配

```bash
# 1) 拷贝插件到 profile 模块目录（loader 向上解析命中）
cp -r <deploy>/dsh-workerspace ~/.dsh/profiles/node_modules/@local/dsh-workerspace
# 2) profile cordis.patch.yml 追加（备份先行）：
#   - insert:
#       - id: workerspace
#         name: '@local/dsh-workerspace'
# 3) 重启 dsh web，验证（见 RUNBOOK.md 第 5 节）
```

peer 依赖：`@deepseek-ai/cordis ^4.0.1`（4.0.2 ✓）、`dsh-tools / dsh-credentials / dsh-settings /
dsh-subprocess / dsh-fs / dsh-user-approval / dsh-home-paths ^0.1.1-rc.2`（本机全装）、
`@deepseek-ai/schemastery ^3.18.1`（3.18.2 ✓）—— 全部 strict ✓，无第二份实例。

## 二、工具面（host defineTool，6 个，全 `ws_` 前缀不与底座/官方重名）

| 工具 | 参数 | 行为 |
|---|---|---|
| `ws_serial_list` | `filter?` | 枚举本机 USB 串口（/dev/serial/by-id + /dev/ttyUSB*/ttyACM*） |
| `ws_serial_open` | `port?`、`baudRate?`、`backend?` | 打开会话（stty 配置 raw -echo + O_NONBLOCK 轮询；或 serialport 后端）；返回 sessionId + 日志路径；端口排他 |
| `ws_serial_send` | `sessionId`、`data`、`encoding?`(text/hex)、`lineEnding?`(none/lf/cr/crlf) | 发送字节并记日志 |
| `ws_serial_read` | `sessionId`、`maxBytes?`、`timeoutMs?`、`encoding?` | 增量读取（上次偏移起）；空且 timeout>0 轮询等待 |
| `ws_serial_close` | `sessionId` | 关闭会话、收尾日志、返回收发统计 |
| `ws_flash` | `templateId`、`artifacts?`（name→path） | 白名单模板执行 + 产物围栏 + 凭据槽 + 高危确认 + 脱敏 + 日志落盘 |

> **未提供 ws_upload/ws_download**：底座（workspace-enhancement）的混合 fs 缝已覆盖远端文件
> 传输（ssh:// 路径经 SFTP 读写，官方 read/write 工具即可用）；再自研上传下载属重复。
> **未做交叉编译工具链封装**：复用底座远端 bash（构建机/目标机跑 make），符合需求边界。

## 三、settings 命名空间 `dsh-workerspace`（schemastery Config，settings.yaml 段）

| 键 | 默认 | 说明 |
|---|---|---|
| `serial.port` | `""` | ws_serial_open 缺省端口 |
| `serial.baudRate` | `115200` | 缺省波特率（整数 50..4000000） |
| `serial.logDir` | `""` | 串口日志目录；空 → `<artifacts.dir>/serial` |
| `serial.backend` | `"stty"` | `stty`（零依赖默认）/ `serialport`（需 profile 装 npm serialport） |
| `flash.templates` | `[]` | 白名单模板数组 `{ id, command, dangerous=true, timeoutMs=600000 }` |
| `artifacts.dir` | `""` | 产物根；空 → `~/.dsh/workerspace/` |
| `security.confirmDangerous` | `true` | 高危烧录前走 `ctx.approval.request` 确认模态（fail-closed） |
| `security.commandAllowlist` | 见下 | 可执行名白名单（默认五项） |
| `hosts[]` | `[]` | `{ id, name?, host, port, user, keyRef }` —— **引用性说明键**：底座自带机器注册表（sshRegistry / machines.json / TOFU / sw_connect），本插件不实现连接；远程烧录用底座 sw_exec |

默认白名单：`esptool`、`esptool.py`、`openocd`、`dfu-util`、`uuu`、`fastboot`。

settings.yaml 示例：

```yaml
dsh-workerspace:
  serial:
    port: /dev/ttyUSB0
    baudRate: 115200
    backend: stty
  flash:
    templates:
      - id: esp32-boot
        command: esptool.py --chip esp32 --port /dev/ttyUSB0 write_flash 0x1000 {{artifact:fw}}
        dangerous: true
        timeoutMs: 300000
      - id: soc-dump
        command: esptool.py --chip esp32 read_flash 0x0 0x100000 {{artifact:dump}}
        dangerous: false
      - id: fastboot-boot
        command: fastboot flash boot {{artifact:boot_img}}
        dangerous: true
  artifacts:
    dir: ~/.dsh/workerspace
  security:
    confirmDangerous: true
    commandAllowlist: [esptool, esptool.py, openocd, dfu-util, uuu, fastboot]
  hosts:
    - id: build-soc
      name: SoC 构建机
      host: 192.168.1.10
      port: 22
      user: builder
      keyRef: SSH_KEY_BUILD_SOC
```

## 四、安全模型（四道闸）

1. **命令白名单**：模板 argv[0] 必须命中 `security.commandAllowlist`；默认只放行五项烧录工具。
2. **占位符强校验**：只认 `{{artifact:<name>}}` / `{{credential:<ref>}}` **整 token**；字面 token
   禁 shell 元字符（`;|&<>$()\` 引号空格等）；argv 直传 `ctx.subprocess.spawn`、**无 shell**；
   产物路径经 realpath 包含性围栏（防 `..` / symlink 逃逸）；凭据值经
   `@deepseek-ai/dsh-credentials` 槽 `credentialRef()` 解析（非法 ref 抛错）。
3. **高危确认模态**：`dangerous !== false` 且 `security.confirmDangerous !== false` 时，
   `ctx.approval.request({agent, toolName:'ws_flash', reason: <脱敏 argv>})`，结果
   非 `allowed-once`（rejected/cancelled/unavailable）一律 fail-closed。
4. **输出脱敏**：工具返回、错误、落盘日志中的凭据值一律替换为 `[redacted:<n>]`；
   密钥/私钥只以 credential-ref / 路径引用存在，明文永不进模型上下文与浏览器。

## 五、测试

```bash
node --test test/core.test.mjs test/flash.test.mjs test/serial.test.mjs   # 42 用例
node --check lib/*.js                                                     # 语法
```

覆盖：模板解析 / 白名单 / 占位符 / 路径围栏 / 脱敏 / 确认门 / 退出码 / 串口缓冲与计数
（纯逻辑 + 假 provider，不触真实设备）。

## 六、边界与已知限制（诚实清单）

- 串口 stty 后端面向 Linux（GNU stty `-F`）；macOS 需 `-f`（未适配，列为 TODO）；
- `serialport` 后端需 profile 内安装 npm `serialport`（可选，未装时使用会得到安装提示）；
- 烧录超时默认 10 分钟（模板可调 timeoutMs），超出经 AbortSignal 中止进程树；
- ws_flash 仅本机 USB；远程/远端 USB 烧录走底座 sw_exec（本插件明确不实现）；
- hosts 键仅作引用性说明，不参与连接（连接/TOFU/密钥托管全在底座）；
- 真机（真实串口/烧录器）行为未实测 —— 属装后验证项，见 RUNBOOK.md 第 5 节。
