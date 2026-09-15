# MCP 生态调研：SSH / 串口 / 嵌入式开发工具（供 DSH「远程主机 + Linux SoC 工作区插件」可行性报告）

> 调研方式：① 三个指定仓库全部源码级核实（README / pyproject / package.json / 核心源码）；② web_search 定位候选后**浅克隆 7 个外部仓库读真实 README/源码**，并用 GitHub API / npm registry / PyPI 核验 star、许可、版本；③ 对照 `@deepseek-ai/dsh-mcp-client` README（`/home/CNS2026495165/.dsh/profiles/node_modules/@deepseek-ai/dsh-mcp-client/README.md`）判定可消费性。以下所有结论均有来源（URL 或仓库文件路径），无臆测。

## 0. dsh-mcp-client 消费条件（判定基准）

- 每 server 一个插件实例，config 字段：`transport`（stdio/streamable-http 必填）、`serverName`、stdio 用 `command`+`args`+`env`+`cwd`，http 用 `url`+`headers`；通用 `toolCallTimeoutMs`（默认 **60000ms**）、`failOnStartupError`、`reconnect.*`（自动重启崩溃的 stdio 子进程并重同步工具）。
- 工具以 `mcp__<serverName>__<rawName>` 暴露，≤64 字符规范化（超长自动加 hash）；仅桥接 **Tools**，Resources/Prompts 不桥接。
- **关键点**：`env` 是"在 scrubbed 环境之上合并"→ 依赖 `SSH_AUTH_SOCK` 等环境变量的 server，需在 config `env` 显式注入；`toolCallTimeoutMs` 对长任务（烧录/120s 等待）需调大。

## 1. 三个指定仓库档案

### 1.1 mcp-remote-access（RFingAdam）——本调研最贴近目标的单服务器
- **URL/许可/依赖**：https://github.com/RFingAdam/mcp-remote-access ；AGPL-3.0-or-later（v0.2.0 由 Apache-2.0 改授，见 CHANGELOG.md）；Python≥3.10，依赖 `mcp>=2.0.0` + `paramiko`（SSH）+ `pyserial`（串口）——**纯 Python 库实现，不依赖系统 ssh 命令**（pyproject.toml）。
- **能力面**：26 工具 = SSH 9（`ssh_connect/ssh_execute/ssh_execute_background/ssh_check_background/ssh_list_background/ssh_upload(SFTP)/ssh_download(SFTP)/ssh_disconnect/ssh_list_connections`）+ 串口 17（`serial_list_ports/serial_connect/serial_connect_match(按 VID/PID/serial 选口)/serial_esp32_connect/serial_send/serial_send_bytes(hex 二进制)/serial_read/serial_read_bytes/serial_wait_for/serial_expect(登录/AT 流程)/serial_send_break/serial_set_dtr/serial_set_rts/serial_reset_device(esp32/stm32/dtr/rts 脉冲)/serial_flush/serial_disconnect/serial_list_connections`），工具清单与 server.py 逐条核对一致。
- **transport**：**仅 stdio**（server.py `main()` 用 `stdio_server`，无 HTTP；README 的"two transports"指 SSH+串口两类）。
- **dsh 可消费**：✅ 直接可用。config：`transport: stdio, command: uvx, args: [--from, ..., mcp-remote-access]`（或 `uv run --directory <repo> mcp-remote-access`）；凭证走工具参数（host/user/password/key_path）；工具名均短、无规范化冲突。
- **安全模型**：密码仅内存、断连清除、无磁盘会话存储；stdio 只服务本机 client；`AutoAddPolicy` 接受未知 host key（无 known_hosts 保护）；无命令白名单；串口需 dialout 组权限。
- **成熟度**：v0.2.0（2026-05-13），beta 分类器，CI + smoke test，2026-09 仍活跃，**1 star**，单作者（eng-mcp-suite 一员）。
- **短板**：无交叉编译/烧录内置工具；但 ssh_exec 可远程跑 make、serial_expect + reset 可脚本化 U-Boot/ESP32 引导烧录交互（esp32_bootloader 复位序列已内置，无 esptool 集成）。

### 1.2 MCP-Embedded-Helper（w4ysonch）
- **URL/许可/依赖**：https://github.com/w4ysonch/MCP-Embedded-Helper（PyPI `mcp-embedded-helper` 0.1.0）；MIT；Python≥3.9 + FastMCP，构建执行走**系统 `make` 命令**（build_runner.py 用 subprocess），环境诊断用 `shutil.which`。
- **能力面**：仅 4 工具——`run_build_and_analyze`（执行 make + 解析 arm-gcc 报错为 7 类错误/3 级严重度 + 收集源码上下文）、`analyze_build_error`、`check_cross_env`（CROSS_COMPILE/ARCH/CC、扫描 8 种常见前缀）、`list_files`。**纯本地**编译助手，无远程/串口/烧录；设备树生成、内核 Oops 解码均标注"开发中"。
- **transport**：stdio（FastMCP 默认）。**dsh 可消费**：✅（`command: mcp-embedded-helper`），但工具在 DSH 进程 cwd 下执行 make/list_files，属"本地交叉编译报错分析器"，价值在 error_parser 可借鉴。
- **安全/成熟度**：无凭证；32 个单测；2 stars；2026-06 后停更。

### 1.3 Serial-Agent（Rance-OwO）
- **URL/许可/依赖**：https://github.com/Rance-OwO/Serial-Agent ；MIT；npm `@ranceowo/serial-agent-mcp` v1.1.0（依赖仅 `@modelcontextprotocol/sdk`）。真正能力在 **VS Code 扩展内嵌 Bridge**（HTTP on 127.0.0.1），烧录走系统命令 Keil `UV4.exe` / `JLink.exe` / `STM32_Programmer_CLI` / OpenOCD（keil-toolchain.ts 核实，FlashMethod=jlink|stlink|openocd）。
- **能力面**：14 MCP 工具（index.ts 逐条核对）——串口 `get_serial_status/list_serial_ports/connect_serial/disconnect_serial/read_serial_log/send_serial_data/clear_serial_log/wait_for_output/send_and_wait` + 固件 `check_keil_config/build_keil_project/flash_keil_firmware/build_and_flash_keil/run_custom_command`。
- **transport**：stdio（MCP）→ localhost HTTP（MCP→Bridge，发现文件 `~/.serialagent/bridge.json`）。
- **dsh 可消费**：⚠️ 技术上可行（`command: npx, args: [-y, @ranceowo/serial-agent-mcp]`），但**硬依赖本机 VS Code + Serial Agent 扩展常驻**，且面向 Windows/Keil/MCU（STM32），**非远程主机、非 Linux SoC**；`wait_for_output` 最长 120s > dsh 默认 60s，需调 `toolCallTimeoutMs`。
- **安全模型**：Bridge 仅绑定 127.0.0.1、随机 UUID token Bearer 认证、CORS 限 localhost（bridge-server.ts 核实）。
- **成熟度**：**40 stars（三仓库最高）**，vitest 单测 + 硬件 e2e（tests/e2e-keil-flash-bootlog.js、test-bridge-real-hw.ts），2026-08 活跃。

## 2. 生态代表性 ssh-mcp（web 调研 + 克隆读码）

| 候选 | URL | star/许可 | 依赖 | 能力面 | transport / dsh 消费 | 安全 | 成熟度 |
|---|---|---|---|---|---|---|---|
| **@yawlabs/ssh-mcp** | https://github.com/YawLabs/ssh-mcp · npm v0.15.3 | 4 / MIT | Node + ssh2（SSH 库）；ssh 命令仅诊断 | **21 工具**：环境管理（agent/密钥/known_hosts/git 检查）+ `ssh_exec/ssh_multi_exec` + SFTP 全家（read/write/upload/download/ls/stat/mkdir/delete）+ `ssh_find/ssh_tail/ssh_service_status`；连接池 60s TTL/上限 100、ProxyJump、~/.ssh/config | stdio / ✅ `npx -y @yawlabs/ssh-mcp`（可设 `env: {SSH_MCP_RUNTIME: node}`；agent 依赖 `SSH_AUTH_SOCK` 需显式注入） | 默认**信任未知 host**（非 TOFU，`SSH_MCP_STRICT_HOST_KEY=1` 收紧）；`SSH_MCP_COMMAND_WHITELIST/BLACKLIST` 仅覆盖 exec 类（README 明示 SFTP 写工具不受门控） | 高：丰富单测+ Docker 集成测试、SECURITY.md/CLAUDE.md 硬性约束、2026-09 仍活跃 |
| **slepp/ssh-mcp** | https://github.com/slepp/ssh-mcp · PyPI 0.2.0 | 22 / MIT | **纯 Python，包装系统 ssh/scp/rsync** | **18 工具**：`ssh_exec/ssh_scp/ssh_sync(rsync)/ssh_view/ssh_create/ssh_edit/ssh_grep/ssh_glob` + **持久交互会话**（ensure/read/write/stop/list_session + tmux 观察）+ 端口转发（独立权限门） | stdio / ✅ `uvx --from slepp-ssh-mcp ssh-mcp` | 单用户设计；shlex.quote 防注入；屏蔽 -L/-R/-D/ProxyCommand；会话转录落盘 0600（含密码风险，需清理）；无命令白名单 | 中：测试较全、2026-07 活跃 |
| **@davidfei/ssh-mcp** | npm v1.0.0（源码在 GitLab davidfei1971/ssh-mcp，GitHub 无同名仓库） | npm 无 star / MIT | Node + ssh2 | **仅 1 工具 `ssh_exec`**（密码/私钥/口令认证，结构化 stdout/stderr/exitCode） | stdio / ✅ | 无白名单无池化，凭证每次传参 | 极简示例级，无更新 |
| **@nl4ever/sshmcp**（NikolaNddTesla/ssh-mcp-server） | https://github.com/NikolaNddTesla/ssh-mcp-server | 11 / MIT（GitHub 标注 NOASSERTION） | Node + SDK + ssh2 | **21 工具**：多服务器配置管理 + `execute` + 文件（read/write/upload/download_file/_directory/transfer_status，**零 token SFTP 传输**、目录 tar.gz、异步传输进度）+ SOCKS 代理 + 跳板 ProxyJump + 多认证（密码/私钥/agent/OTP） | stdio / ✅ `npx -y @nl4ever/sshmcp` | 服务器配置（含凭证）由 add_server 持久化落盘 | 中低：功能丰富但较新（2026-05） |

## 3. 嵌入式交叉编译 / 烧录 MCP（web 调研补充）

| 候选 | URL | star/许可 | 依赖 | 能力面 | transport / dsh 消费 | 安全/成熟度 |
|---|---|---|---|---|---|---|
| **kernel-build-mcp** | https://github.com/arttttt/kernel-build-mcp | 0 / **无许可证文件**（不可复用代码） | Python + FastMCP，**部署在远程 Linux 构建机**，make/交叉编译器为系统命令 | 11 工具：`get_config/set_config/git_pull/git_reset/build/build_module/make_defconfig/clean/get_build_log/get_artifact(base64 拉产物)/run_command`，profile 化多套内核源码+工具链 | **stdio-over-SSH 桥接**：客户端 `command: ssh, args:[host, python3, -m, kernel_build_mcp]`（.mcp.json 原文）——该模式**与 dsh-mcp-client 完全兼容**（stdio 任意 command），是"远程主机 MCP"的现成范式 | 依赖 Tailscale SSH；run_command 任意命令；0 star、单人、无测试 |
| **jlink-mcp**（Klievan） | https://github.com/Klievan/jlink-mcp · npm jlink-mcp | 30 / MIT | Node + 系统 `JLinkExe/JLinkGDBServer`（亦可 OpenOCD / Black Magic / arm-none-eabi-gdb） | **47 工具**：flash、halt/resume/step、断点/观察点、寄存器/内存读写、**RTT 日志流(rtt_search)**、`diagnose_crash`（Cortex-M fault 自动解码）、SVD 外设寄存器、GDB 会话、snapshot；**真实 nRF52840-DK 硬件验证（HIL CI）** | stdio / ✅ `npx -y jlink-mcp` + `env: {JLINK_DEVICE: ...}`（烧录大镜像需调大 toolCallTimeoutMs） | 无凭证，对探针所在本机完全可控；~187 单测+硬件双级测试、npm 发布、2026-08 活跃 |
| **openocd-mcp**（microhenrio） | https://github.com/microhenrio/openocd-mcp | 4 / MIT | Python 3.10+ + 驱动 OpenOCD（仓库自带 Windows 预编译 exe / 自动下载 / `OPENOCD_BIN`） | ~33 工具：configure/show_config/**set_permissions(只读模式、flash-erase 门控、路径/大小限制)**/start/stop_openocd/status/connect/halt/resume/reset/step/寄存器/内存/断点(含条件断点)/观察点/flash_write/flash_info/flash_erase_sector/load_elf/ELF 符号变量读写/SVD 外设寄存器/run_command | stdio（FastMCP）/ ✅ | 权限门设计是其亮点；4 star、2026-07 活跃 |

## 4. 结论：MCP 路线最贴近者与差距

**最贴近「远程主机 + Linux SoC（串口 + 交叉编译 + 烧录）」的单服务器：`mcp-remote-access`。** 它是唯一同时覆盖 SSH（exec/后台任务/SFTP 上传下载）与串口（expect/AT 流程/二进制收发/DTR-RTS 复位/ESP32 引导）的服务器，README 即定位 embedded-bringup（ssh_upload + serial_expect + 引导交互），dsh 可直接以 stdio 接入零改动。

**但「MCP 路线」整体是组合而非单点**，最贴近目标的编排是三类并接：

1. **远程主机层**：mcp-remote-access（SSH+串口）或 @yawlabs/ssh-mcp（SSH 更完善：连接池/ProxyJump/SFTP/白名单）——dsh 一个 `mcp__ssh__*` server 即可；交叉编译直接用 `ssh_exec` 远程跑 make + `ssh_upload/download` 拉产物，**无需专门 build server**。
2. **远程构建专用（可选）**：照搬 kernel-build-mcp 的 `command: ssh ...` 桥接范式（dsh-mcp-client 原生支持），把任意 MCP server 部署到远程主机；但该 repo 无许可、0 star，仅可借鉴架构，需自研。
3. **烧录层**：探针在本机 → jlink-mcp / openocd-mcp 直接 stdio 接入；探针在远程 SoC 主机 → 同 2 的 ssh 桥接部署。

**差距清单（若走纯 MCP 路线）**：
- **无单一覆盖全链**：串口+SSH+交叉编译+烧录需 2~3 个 server 组合；dsh-mcp-client 每次请求都全量携带各 server 的工具 schema（token 成本），且模型需自行编排工具链。
- **串口位置约束**：serial 工具作用于 MCP 进程本机 USB；板卡若走网络 console（IP 串口）不在覆盖内；跨机器串口需把 server 部署到 USB 所在机。
- **烧录语义**：U-Boot/ESP32 引导交互可脚本化，但无 esptool/tftp 分区烧录集成、无内核/dtb 烧录语义。
- **安全**：mcp-remote-access 用 AutoAddPolicy（信任未知 host key）且无命令白名单；YawLabs 白名单只覆盖 exec；凭证以工具参数传递会**进入模型上下文**（隐私/token）；`SSH_AUTH_SOCK` 等需在 dsh config `env` 显式注入（dsh 会 scrub 环境）。
- **超时**：dsh 默认 `toolCallTimeoutMs=60s`，对烧录/120s 等待需逐 server 调大。
- **许可**：mcp-remote-access 为 **AGPL-3.0**（服务端分发场景有传染性考量）；其余主要 MIT，kernel-build-mcp 无许可不可复用。
- **成熟度**：候选全部为 0–40 star 个人项目；三指定仓库中 Serial-Agent 最成熟（40 star+硬件测试）但绑定 VS Code/Windows/Keil，与 Linux SoC 方向错位。
- **工作区集成空白**：MCP 工具不感知 DSH 会话工作区/沙箱，本地↔远端文件同步需模型自行拼装（slepp `ssh_sync` 可补此环节）。

## 5. 来源

- 三指定仓库源码：`/home/CNS2026495165/dsh/.workspace/research-dsh-workerspace/repos/{mcp-remote-access,MCP-Embedded-Helper,Serial-Agent}`（README、pyproject/package.json、server.py、index.ts、bridge-server.ts、keil-toolchain.ts 等，均已实际读取）
- 外部候选克隆：`.../repos/ext/{ssh-mcp,slepp-ssh-mcp,ssh-mcp-server,kernel-build-mcp,jlink-mcp,openocd-mcp}`（README/源码实际读取）；@davidfei/ssh-mcp 经 npm registry（https://www.npmjs.com/package/@davidfei/ssh-mcp）核实，源码托管于 https://gitlab.com/davidfei1971/ssh-mcp
- star/许可/最近推送：GitHub REST API `api.github.com/repos/<owner>/<repo>`（2026-09-14 查询）；npm/PyPI registry 元数据
- dsh 消费条件：`/home/CNS2026495165/.dsh/profiles/node_modules/@deepseek-ai/dsh-mcp-client/README.md`
- web 检索：GitHub / npm / PyPI / MCP registry 相关页面（YawLabs、slepp、@davidfei、@nl4ever、kernel-build-mcp、jlink-mcp、openocd-mcp）
