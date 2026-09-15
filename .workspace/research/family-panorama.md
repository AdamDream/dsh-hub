# DSH 插件家族全景：SSH / 远程主机 / 嵌入式

> 调研时间：2026-09-14（registry `time` 字段与 GitHub `pushed_at` 均为当日抓取值）
> 目标部署：`@deepseek-ai/dsh` **0.1.1-rc.2**，`@deepseek-ai/cordis` **4.0.2**，Linux 本机 + `npm_config_cache` 只读
> 证据来源：npm registry（`https://registry.npmjs.org/<name>`、`/-/v1/search`、`api.npmjs.org/downloads`）、GitHub（`raw.githubusercontent.com`、`api.github.com`）、**本机已安装的 dsh 0.1.1-rc.2 产物**（`/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/`）
> 凡属推断而未经直接证据支持的结论，均显式标注 **（推测）**；查不到的字段写「未查到」，不做编造。

---

## 0. 结论速览（TL;DR）

| 结论 | 判定 |
|---|---|
| 候选总量 | **≥30 个** npm 已发布 + **≥11 个** GitHub-only 仓库（本报告详解 26 个） |
| 与「远程主机 SSH 开发」最相关且能在 0.1.1-rc.2 上装的前 3 | 1) `@captain1275/dsh-ssh@0.3.1`（peer 明确写 `^0.1.1-rc.2`，**rc.2 唯一显式命中**）<br>2) `dsh-remote-ssh@0.2.4`（peer 全 `*`，通配放行）<br>3) `dsh-ssh-ops@0.3.5` / `@linxin666/dsh-ssh@0.3.22`（peerDependencies 不含 `@deepseek-ai/*`，无 peer 冲突；但各有硬门槛，见 §3） |
| 串口通信 | **有**：`dsh-serial@0.1.0`（pyserial 脚本驱动）、`LTY-lty666/dsh-serial`（Node serialport，仅 GitHub）、`@infinitepersistence/dsh-serial-console`（xterm 共享串口控制台，**peer 不支持 rc.2**） |
| 固件烧录（esptool/openocd/dfu/rockusb/uuu/fastboot） | **无任何候选具备**。全 npm/GitHub 检索未发现 DSH 烧录插件。最接近：`dsh-adb`（ADB 设备运维，不含 fastboot/烧录）、`dsh-hdc-bridge`（鸿蒙 hdc 设备调试） |
| 交叉编译工具链集成 | **无专用插件**。最接近：`dsh-embedded-workbench`（Keil MDK/ARMCLANG 的**技能与代理文本**，不调工具链二进制） |
| GDB/OpenOCD 调试 | **部分**：`@hy-sde-org/dsh-tool-debug` + `@hy-sde-org/dsh-dap`（通用 Debug Adapter Protocol，28 个操作，可接 GDB；**peer 需 `^0.1.2-rc.1`，rc.2 不满足**）。无 OpenOCD 专属集成。 |
| `dsh-client-ui-slots` / `dsh-client-ui-primitives` | **npm 上存在，且 rc.2 线已发布**（两者 `0.1.1-rc.2` 均于 2026-08-21T12:42 发布）。**「rc.2 线未发布」的说法不成立。** 本机未安装是因为它们**从来不是 `dsh@0.1.1-rc.2` / `dsh-web-app@0.1.1-rc.2` 的运行时依赖**（详见 §5） |
| 是否被合并/改名 | **没有被合并、也没有改名**：两个包名一直独立发布到 `0.1.5-rc.2`。变化的是**依赖关系**——`dsh-client-runtime` 在 `0.1.0-rc.8` 起把它们从 `dependencies` 移出（降为官方包内部的 `devDependencies`） |

---

## 1. 发现方法（可复现）

npm registry search（`https://registry.npmjs.org/-/v1/search?text=<query>&size=20`）关键词组：
`dsh ssh`、`dsh remote`、`dsh serial`、`dsh embedded`、`dsh scp`、`dsh sftp`、`dsh terminal`、`dsh ops`、`dsh tty`、`dsh adb`、`dsh cross-compile`、`dsh openocd`、`dsh firmware`、`dsh flash burn`、`dsh fastboot bootloader`、`dsh uart`、`dsh serialport`、`dsh esptool`、`dsh dfu flashing`、`dsh uuu rockusb`、`dsh jtag gdb debug`、`dsh mcu board debug`、`dsh hdc harmonyos device`、`dsh keil mdk armclang`、`dsh stc32 compiler`、`dsh tftp nfs yocto`、`dsh 远程`、`dsh remote development`、`deepseek-harness ssh|embedded`。

GitHub repository search（`https://api.github.com/search/repositories`）：`dsh plugin ssh`、`dsh ssh ops`、`dsh serial`、`dsh embedded firmware`、`deepseek harness plugin remote`。

> 说明：npm 关键词搜索的 `total` 普遍是 1.3 万~35 万级噪音（多为无关包），因此对每个命中都做了**人工相关性过滤**（包名或描述含 dsh / DeepSeek Harness / cordis）。

---

## 2. 对比表

### 2.A 远程主机 / SSH 家族（host-plane 与 client 注入类）

| 包名 | 最新版本 | 发布时间 | 周下载 | license | peerDependencies 关键约束（精简） | slots/primitives 依赖 | 串口/烧录/交叉编译 | 仓库 URL |
|---|---|---|---|---|---|---|---|---|
| `dsh-ssh` | 0.3.0-pre | 2026-08-16 | 285 | MIT | **无 peerDependencies**；但 `dependencies` 里带 `@deepseek-ai/dsh-fs ^0.1.0-rc.6` 等 8 个官方包 | 无 | 无 | [UynajGI/dsh-ssh](https://github.com/UynajGI/dsh-ssh) |
| `dsh-ssh-ops` | 0.3.5 | 2026-09-13 | 868 | MIT | **`{}`（完全无约束）** | 无 | 无 | [caoyiwei850/dsh-ssh-ops](https://github.com/caoyiwei850/dsh-ssh-ops) |
| `@linxin666/dsh-ssh` | 0.3.22 | 2026-09-13 | 36579 | Apache-2.0 | 仅 `react ^18.2.0`、`react-dom ^18.2.0` | 无 | 无 | [zhu1090093659/dsh-web](https://github.com/zhu1090093659/dsh-web) |
| `@captain1275/dsh-ssh` | 0.3.1 | 2026-08-22 | 144 | Apache-2.0 | `@deepseek-ai/dsh-* ^0.1.1-rc.2`（含 **`dsh-client-ui-slots ^0.1.1-rc.2`**） | **是**（slots，版本正好 rc.2） | 无 | [CAPTAIN1275/dsh-ui-web](https://github.com/CAPTAIN1275/dsh-ui-web) |
| `@zhangfengshun/dsh-remote-ssh` | 2.4.4 | 2026-09-12 | 1172 | MIT | `dsh-tools ^0.1.0-rc.6`、`dsh-client-locale ^0.1.0-rc.6`、**`dsh-client-ui-primitives ^0.1.0-rc.6`**、`cordis ^4.0.1` | **是**（primitives） | 无 | [ZhangFengshun/dsh-remote-ssh](https://github.com/ZhangFengshun/dsh-remote-ssh) |
| `dsh-remote-ssh` | 0.2.4 | 2026-08-15 | 93 | Apache-2.0 | 官方包全部 `*` 通配 + `cordis ^4.0.1-rc.1` | 无 | 无 | [Yan-Zero/dsh-remote-ssh](https://github.com/Yan-Zero/dsh-remote-ssh) |
| `dsh-remote` | 0.8.15 | 2026-09-12 | 1443 | MIT | `^0.1.0-rc.6` 一批 + **`dsh-client-locale ^0.1.2-rc.1`** + **`dsh-client-ui-renderer ^0.1.2-rc.1`** | 无（但用 renderer） | 无 | [flymysql/dsh-remote](https://github.com/flymysql/dsh-remote) |
| `dsh-remote-dev` | 1.0.0 | 2026-08-20 | 43 | MIT | `{}`；`dependencies` 里带 `@deepseek-ai/dsh-tools ^0.0.1-rc.1` | 无 | 无 | [tsja2001/dsh-remote-dev](https://github.com/tsja2001/dsh-remote-dev) |
| `dsh-remote-server` | 0.1.1 | 2026-08-25 | 106 | MIT | 官方包**精确锁定 `0.1.0-rc.6`**，含 **slots 与 primitives** | **是**（两者） | 无 | [MRZHUH/dsh-remote-server](https://github.com/MRZHUH/dsh-remote-server) |
| `dsh-plugin-ssh` | 0.1.0 | 2026-09-09 | 199 | MIT | `^0.1.2-rc.1 \|\| ^0.1.3-alpha.2`（连接、host-webserver、llm、session、tools） | 无 | 无 | [techflag/dsh-plugin-ssh](https://github.com/techflag/dsh-plugin-ssh) |
| `dsh-workspace-enhancement` | 0.1.4 | 2026-09-13 | 311 | MIT | 全部 `^0.1.5-rc.1`（fs / fs-local / sandbox / subprocess / directory-picker / llm …） | 无 | 无 | [DobyChao/dsh-workspace-enhancement](https://github.com/DobyChao/dsh-workspace-enhancement) |
| `dsh-remote-tunnel` | 0.1.9 | 2026-09-05 | 362 | MIT | `dsh-cmdline ^0.1.2-alpha.3` | 无 | 无 | [Linjiangxian0203/dsh-remote-tunnel](https://github.com/Linjiangxian0203/dsh-remote-tunnel) |
| `@hyzyn/dsh-tty` | 0.17.0 | 2026-09-13 | 1084 | Apache-2.0 | `dsh-tools ^0.1.2-rc.1`（唯一） | 无 | 无 | [hyzyn/dsh-plugin-kit](https://github.com/hyzyn/dsh-plugin-kit) |
| `dsh-ssh-tui` | 0.6.3 | 2026-09-12 | 2291 | MIT | `>=0.1.2-rc.1 <0.1.6 \|\| >=0.1.3-alpha.2 <0.1.6 \|\| >=0.1.5-alpha.1 <0.1.6` | 无 | 无 | [cyjyyd/dsh-ssh-tui](https://github.com/cyjyyd/dsh-ssh-tui) |
| `dsh-workbench-ecs` | 0.6.7 | 2026-09-12 | 未查到（registry 无 downloads 字段；search 未返回 wk） | MIT | `dsh-tools ^0.1.1-rc.2`、`cordis ^4.0.1` | 无 | 无 | [nishuoyang/dsh-workbench-ecs](https://github.com/nishuoyang/dsh-workbench-ecs) |
| `dsh-remote-plugin` | 0.6.24 | 2026-09-05 | 479 | MIT | `{}`（无约束） | **是**（`dsh.client.inject` 含 `@deepseek-ai/dsh-client-ui-slots`，无版本号） | 无 | [Blank-not-black/dsh-Remote](https://github.com/Blank-not-black/dsh-Remote) |
| `dsh-remote-mod-plugin` | 0.7.9-mod.1 | 2026-09-13 | 38 | MIT | `{}` | 未查到（推测继承上游 dsh-remote-plugin） | 无 | [produce123/dsh-Remote-mod](https://github.com/produce123/dsh-Remote-mod) |
| `dsh-better-sidebar` | 0.19.1 | 2026-09-11 | 73829 | MIT | 全部 `^0.1.5-rc.1` | **是**（peer 内，见 §3.18） | 无 | [omdsh-dev/DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) |
| `@elinpf/dsh-ops`（套件） | 0.3.0 | 2026-09-14 | 未查到 | MIT | 子包 `dsh-tools`/`dsh-invariants`/`dsh-llm` 为 `^0.1.0-rc.8` | 无 | 无 | [Elinpf/dsh-ops-plugins](https://github.com/Elinpf/dsh-ops-plugins) |
| `@unieai/uad-remote-machine` | 0.1.21 | 2026-08-31 | 49 | MIT | `@unieai/uad-invariants ^0.1.21`、`@unieai/cordis ^4.0.2`（**私有 fork 命名空间**） | 无 | 无 | [UnieAI/UnieAI-Agent-Desktop](https://github.com/UnieAI/UnieAI-Agent-Desktop) |
| `@artificialnotimbecile/dsh-remote-runtime` | 0.1.2 | 2026-08-21 | 120 | MIT | **精确锁定 `0.1.0-rc.8`**（api-remotes / client-runtime / client-ui-settings / **slots** / typert-protocol），`cordis 4.0.1` | **是**（slots） | 无 | [ArtificialNotImbecile/dsh-remote-runtime](https://github.com/ArtificialNotImbecile/dsh-remote-runtime) |

### 2.B 串口 / 嵌入式 / 设备烧录家族

| 包名 | 最新版本 | 发布时间 | 周下载 | license | peerDependencies 关键约束（精简） | slots/primitives 依赖 | 串口/烧录/交叉编译 | 仓库 URL |
|---|---|---|---|---|---|---|---|---|
| `dsh-serial` | 0.1.0 | 2026-08-17 | 13 | MIT | **`{}`**（peer 与 deps 均为空） | 无 | **串口 ✓**（pyserial 脚本，4 工具）；无烧录/交叉编译 | npm `repository` 字段为 **null**；对应 [hgy043/dsh-serial](https://github.com/hgy043/dsh-serial) |
| `@infinitepersistence/dsh-serial-console` | 0.1.0-alpha.1（`latest`）／`0.1.0-rc.4`（`next`） | alpha.1 = 2026-08-19；rc.4 = 2026-08-25 | 126 | MIT | `dsh-tools >=0.0.1-rc.1 <0.1.0`、`dsh-system-prompt` 同、`dsh-typert-protocol >=0.1.0-rc.6 <0.2.0`、rc.4 另加 **`dsh-client-ui-primitives >=0.1.0-rc.7 <0.2.0`** | **是**（rc.3 起加 primitives） | **串口 ✓**（xterm.js VT 终端 + 人机共享会话 + HEX 视图 + 审计导出）；无烧录/交叉编译 | [InfinitePersistence/dsh-serial-console](https://github.com/InfinitePersistence/dsh-serial-console) |
| `dsh-embedded-workbench` | 0.8.9 | 2026-09-10 | 655 | MIT | `dsh-llm`/`dsh-agent`/`dsh-session ^0.1.0-rc.6`、`dsh-skill-filesystem ^0.1.0-rc.8`、`cordis ^4.0.2` | 无 | **交叉编译仅「知识层」**：Keil MDK UV4/ARMCLANG 技能与代理文本，不调工具链二进制 | [AmethystLuna/embedded-workbench](https://github.com/AmethystLuna/embedded-workbench) |
| `dsh-embedded` | 0.0.1 | 2026-08-24 | 3 | MIT | `{}` | 无 | **无**（占名包，「first release in development」） | [dushaobindoudou/dsh-plugin](https://github.com/dushaobindoudou/dsh-plugin)（`packages/dsh-embedded`） |
| `dsh-adb` | 1.7.0 | 2026-08-31 | 175 | MIT | `{}`；deps 仅 `schemastery ^3.13.1` | 无 | **设备运维 ✓ / 烧录 ✗**：设备发现、结构化 logcat、apk 安装、文件 push/pull、性能快照、崩溃报告 | npm `repository` = **null**，未查到 GitHub 仓库 |
| `dsh-adb-logcat` | 1.0.0 | 2026-08-26 | 40 | MIT | 仅 `react ^18.2.0` | 无 | 无（logcat 查看器） | [dxsdyhm/dsh-adb-logcat](https://github.com/dxsdyhm/dsh-adb-logcat) |
| `@windypro-rourou/dsh-logcat` | 0.7.0 | 2026-09-13 | 141 | Apache-2.0 | `react ^18.2.0`、`react-dom ^18.2.0` | 无 | 无（logcat 查看器 + `logcat_recent` 工具） | [WindyPro-rourou/dsh-logcat](https://github.com/WindyPro-rourou/dsh-logcat) |
| `@zseven-w/dsh-android` | 0.1.0-rc.4 | 2026-08-21 | 377 | MIT | `^0.1.0-rc.6` 一批，含 **`dsh-client-ui-slots ^0.1.0-rc.6`**；README 自称「Tested with DSH 0.1.1-rc.1」 | **是**（slots） | 无烧录（adb 驱动 build/run/交互） | [ZSeven-W/dsh-android](https://github.com/ZSeven-W/dsh-android) |
| `dsh-hdc-bridge` | 0.9.1 | 2026-09-08 | 183 | MIT | `{}`；deps `{}`（零依赖） | 无（`dsh.client.inject: []`） | **设备侧 ✓**：鸿蒙 hdc 设备调试、DevEco CLI 编译/签名/模拟器；**非 Linux SoC，无串口/烧录** | [1na-ko/dsh-hdc-bridge](https://github.com/1na-ko/dsh-hdc-bridge) |
| `harmonyos-dev-mcp-for-dsh` | 0.1.1 | 2026-08-19 | 48 | Apache-2.0 | `{}`；deps `{}` | 无 | 设备发现/构建部署/UI 自动化/E2E；无串口/烧录 | [NormanFxxkingRockwell/harmonyos-dev-mcp-for-dsh](https://github.com/NormanFxxkingRockwell/harmonyos-dev-mcp-for-dsh) |
| `@hy-sde-org/dsh-tool-debug` | 0.1.2-rc.1 | 2026-09-06 | 179 | MIT | `dsh-tools`/`dsh-system-prompt`/`dsh-timeout`/`dsh-invariants` **`^0.1.2-rc.1`**、`cordis ^4.0.2` | 无 | **调试 ✓（DAP，可接 GDB）**；无 OpenOCD 专属支持、无烧录 | [hy-sde/dsh-tool-debug](https://github.com/hy-sde/dsh-tool-debug) |
| `@hy-sde-org/dsh-dap` | 0.1.2-rc.1 | 2026-09-06 | 177 | MIT | `dsh-invariants ^0.1.2-rc.1`、`dsh-subprocess ^0.1.2-rc.1`、`cordis ^4.0.2` | 无 | DAP 能力缝（adapter 解析 / 会话管理 / 断点 / 栈帧 / 变量求值） | [hy-sde/dsh-tool-debug](https://github.com/hy-sde/dsh-tool-debug) |
| `@fadinglight/dsh-device-automation` | 1.0.0 | 2026-08-27 | 5 | MIT | `cordis ^4.0.1`、`dsh-invariants 0.1.1-rc.2`；deps 含 `dsh-atomic-write 0.1.1-rc.2`、`dsh-home-paths 0.1.1-rc.2` | 无（有独立 `dsh-client-ui-device-automation`） | 跨平台设备自动化（鸿蒙 uitest 等）；无串口/烧录 | [cheliangzhao/dsh-device-automation](https://github.com/cheliangzhao/dsh-device-automation) |

### 2.C 相关基础设施（非远程主机，但选型时常被牵入）

| 包名 | 最新版本 | 发布时间 | 周下载 | license | 说明 |
|---|---|---|---|---|---|
| `dsh-terminal` | 0.1.1 | 2026-08-15 | 122 | MIT | 本机 PTY 面板（node-pty + xterm.js），**非远程**。[giiiiiithub/terminal](https://github.com/giiiiiithub/terminal) |
| `@deepseek-ai/dsh-terminal` | 0.0.1-rc.3（`latest`）/ 0.1.5-rc.2（`next`） | 0.0.1-rc.3 = 2026-08-12 | 392628 | BSD-3-Clause | 官方 PTY 会话缝（`ctx.terminal`）。注意 `latest` tag 停在 0.0.1-rc.3 |
| `@monotykamary/dsh-terminal-web` | 0.1.9 | 2026-09-02 | 40 | MIT | 官方 terminal-web 的第三方 fork（`@monotykamary/*` 命名空间） |
| `@linxin666/dsh-web-all` | 0.3.22 | 2026-09-13 | 33215 | Apache-2.0 | 全家桶聚合（含 remote-web-ui 等），与 SSH 远程开发是**不同需求**（手机/远程访问 GUI） |

---

## 3. 逐候选详情

### 3.1 `dsh-ssh@0.3.0-pre`（UynajGI）
- **功能面**：SSH 远程执行插件 — ProxyJump 跳板链、SFTP 文件系统、`subprocess` 与 PTY 全走 ssh2。即把 DSH 的 fs/subprocess 缝**转发到远端**。
- **架构**：host 工具 + 缝替换。`dependencies`（**不是 peer**）引用 `@deepseek-ai/dsh-fs ^0.1.0-rc.6`、`dsh-subprocess`、`dsh-host-directory-picker(-native)`、`dsh-invariants`、`dsh-timeout`、`@deepseek-ai/cordis ^4.0.1`。
- **许可证**：npm 声明 MIT；仓库 LICENSE 存在性**本次未逐字节核验**（GitHub API 触发 403 限流）。**标注为待核**。
- **rc.2 兼容性**：**不合格（有风险）**。把官方缝包写进 `dependencies` 而非 `peerDependencies`，npm 会为插件安装**第二份** `dsh-fs`/`dsh-subprocess`；在同一进程里出现两个缝实例，通常导致 `ctx.fs` 解析到错误的实现。且 `^0.1.0-rc.6` 的 semver 预发布规则**不覆盖 0.1.1-rc.2**（tuple 0.1.0 ≠ 0.1.1）。**判定：不建议在 0.1.1-rc.2 上直接使用。**
- **客户端注入**：无（纯 host 侧）。
- **URL**：https://registry.npmjs.org/dsh-ssh ｜ https://github.com/UynajGI/dsh-ssh

### 3.2 `dsh-ssh-ops@0.3.5`（caoyiwei850）★ 推荐候选
- **功能面**：主对话驱动 SSH + 右侧真实交互式终端 + SFTP 文件管理 + 端口转发 + 数据库管理（MySQL/PostgreSQL/Redis/MongoDB）。v0.3.4 起「分栏各走一条独立通道」，Agent 作用目标可见可切换；对不符合 RFC 4253 的 SSH 横幅做了容错。v0.3.5 移除了失效的「运维模式」预设安装器。
- **架构**：host 半管理 ssh2 会话，client 半渲染终端与数据库面板。`dsh` 字段：`{"bundle":{"patch":"./cordis.patch.yml"},"client":{"inject":["@deepseek-ai/dsh-client-runtime"],"platform":"web"}}` —— **只注入官方 `dsh-client-runtime`，不注入 slots/primitives**。
- **许可证**：npm 声明 MIT；README 带 MIT badge；仓库 `caoyiwei850/dsh-ssh-ops` 存在。
- **rc.2 兼容性**：**peerDependencies 为空 `{}`** → **无 peer 冲突，可安装**。风险点：`dependencies` 里带了 `pg`、`mysql2`、`redis`、`mongodb`、`pg-cursor` 等**数据库驱动**，即使你只用 SSH 也会被一并拉下（体积/攻击面）。本机 0.1.1-rc.2 是否满足其 `inject` 的 `dsh-client-runtime` 无版本约束 —— **推测可用**（`client-runtime@0.1.1-rc.2` 在本机存在，见 §5 第 5 条）。
- **客户端注入**：需要 `@deepseek-ai/dsh-client-runtime`（**本机已装**，见 §5）。
- **URL**：https://registry.npmjs.org/dsh-ssh-ops ｜ https://github.com/caoyiwei850/dsh-ssh-ops

### 3.3 `@linxin666/dsh-ssh@0.3.22`（linxin666 / zhu1090093659）★ 功能最全
- **功能面**：主机配置库（`~/.dsh/dsh-ssh.json`，可从 `~/.ssh/config` 导入）、持久 ssh2 连接池（支持跳板机）、exec / PTY Web 终端 / SFTP 传输 / 本地端口转发隧道 / 集群批量执行。
- **架构**：**独立的 web GUI 插件族**（同一 monorepo 还发 `@linxin666/dsh-client-ui-web-ui-settings`、`-market`、`-task-board`、`-skin-center`、`dsh-i18n` 等）。`dsh` 字段非常明确：
  `{"engines":{"dsh":">=0.1.5-rc.1"},"bundle":{"patch":"./cordis.patch.yml"},"client":{"inject":["@deepseek-ai/dsh-client-locale","@deepseek-ai/dsh-client-ui-renderer","@deepseek-ai/dsh-client-ui-settings"],"platform":"web"}}`
- **许可证**：npm 声明 Apache-2.0（与 `@linxin666/*` 全族一致）。
- **rc.2 兼容性**：**明确不合格**。它自己声明了 **`dsh.engines.dsh >= 0.1.5-rc.1`** —— 这是插件自带的硬门槛，**0.1.1-rc.2 不满足**。虽然 `peerDependencies` 只有 react/react-dom（因此 `npm install` 不会报 peer 错），但启动时 bundle 层会因版本门槛拒绝加载（**推测**：依据 `dsh.engines` 语义）。**判定：不能用于 0.1.1-rc.2。**
- **客户端注入**：`dsh-client-locale`、`dsh-client-ui-renderer`、`dsh-client-ui-settings`（均为本机已装官方包，见 §5）。
- **URL**：https://registry.npmjs.org/@linxin666%2Fdsh-ssh ｜ https://github.com/zhu1090093659/dsh-web

### 3.4 `@captain1275/dsh-ssh@0.3.1`（CAPTAIN1275）★ rc.2 唯一显式命中
- **功能面**：描述与 `@linxin666/dsh-ssh` **逐字相同**（「Remote SSH operations for the dsh web GUI…」），依赖集也相同（`@xterm/xterm ^6.0.0`、`@xterm/addon-fit`、`ssh2 ^1.17.0`、`ws ^8.18.0`）→ **是 linxin666 那套代码的 fork**。
- **架构**：host + client 注入。
- **许可证**：npm 声明 Apache-2.0（与上游一致）。
- **rc.2 兼容性**：**★ 唯一在 peer 里显式钉 `^0.1.1-rc.2` 的 SSH 插件** —— 含 `dsh-client-ui-slots ^0.1.1-rc.2`、`dsh-client-ui-sidebar`、`dsh-client-ui-settings`、`dsh-client-runtime`、`dsh-client-locale`、`dsh-client-connection`、`dsh-host-webserver`、`dsh-settings`、`dsh-system-prompt`、`dsh-tools` 全部 `^0.1.1-rc.2`。**按 semver 规则 `^0.1.1-rc.2` 完全覆盖 0.1.1-rc.2 → 合格。**
- **代价**：**停止更新**（0.3.1 发布于 2026-08-22，之后无新版本；上游已到 0.3.22，落后约 20 个版本）。周下载 144（上游 36579）。
- **客户端注入**：**需要 `@deepseek-ai/dsh-client-ui-slots ^0.1.1-rc.2`** —— 本机**未安装**，需显式装（见 §5）。
- **URL**：https://registry.npmjs.org/@captain1275%2Fdsh-ssh ｜ https://github.com/CAPTAIN1275/dsh-ui-web

### 3.5 `@zhangfengshun/dsh-remote-ssh@2.4.4`（ZhangFengshun）★ 高下载
- **功能面**：类 VSCode Remote-SSH 的远程开发：SSH 到超算/服务器、远程工作区、文件浏览器、集成终端，并与 `dsh-better-sidebar` 和 DSH 设置集成。
- **架构**：host 工具 + client UI（依赖 `dsh-client-ui-primitives`）；`dependencies` 仅 `schemastery ^3.18.0`（干净）。
- **许可证**：npm 声明 MIT。
- **rc.2 兼容性**：**不合格**。peer 为 `@deepseek-ai/dsh-tools ^0.1.0-rc.6`、`dsh-client-locale ^0.1.0-rc.6`、**`dsh-client-ui-primitives ^0.1.0-rc.6`**、`cordis ^4.0.1`。按 semver 预发布规则，`^0.1.0-rc.6` 的允许 tuple 是 `0.1.0`，**0.1.1-rc.2（tuple 0.1.1）不被覆盖** → peer 冲突。其目标线是 **0.1.0-rc.6 ~ 0.1.0-rc.8**。
- **客户端注入**：需要 `@deepseek-ai/dsh-client-ui-primitives`。
- **URL**：https://registry.npmjs.org/@zhangfengshun%2Fdsh-remote-ssh ｜ https://github.com/ZhangFengshun/dsh-remote-ssh

### 3.6 `dsh-remote-ssh@0.2.4`（Yan-Zero）★ rc.2 可装（通配）
- **功能面**：「Transparent local and Remote SSH workspaces」——本地/远程 SSH 工作区对 DSH 透明。
- **架构**：把官方缝**全部列为 peer 且用 `*` 通配**：`dsh-agent`、`dsh-fs`、`dsh-fs-local`、`dsh-fs-sandbox`、`dsh-settings`、`dsh-spill`、`dsh-spill-local`、`dsh-subprocess`、`dsh-subprocess-local`、`dsh-bash-local`、`dsh-pwsh-local`、`dsh-tool-bash`、`dsh-tool-pwsh`、`dsh-workspace`、`dsh-host-webserver`、`dsh-host-directory-picker…` 等；`cordis ^4.0.1-rc.1`。`dependencies` 仅 `@microsoft/agent-host-protocol 0.7.0`。
- **许可证**：npm 声明 Apache-2.0。
- **rc.2 兼容性**：**合格（peer 层面）**。`*` 通配接受任何版本（含 0.1.1-rc.2）；`cordis ^4.0.1-rc.1` 同样接受 4.0.2（4.0.2 非预发布，落在 `>=4.0.1-rc.1 <4.1.0` 内）。**但**：`*` 通配意味着**放弃版本适配**，0.1.1-rc.2 与 0.1.0-rc.x 之间缝接口若有变化，会在运行时而不是安装期炸掉。**判定：可安装，兼容性需实机验证。**
- **客户端注入**：无 slots/primitives（纯 host 缝替换）。
- **URL**：https://registry.npmjs.org/dsh-remote-ssh ｜ https://github.com/Yan-Zero/dsh-remote-ssh

### 3.7 `dsh-remote@0.8.15`（flymysql）★ 工具面最广
- **功能面**：远程工作助手 — SSH 连接（密码/密钥/agent/keyboard-interactive/跳板机）、选远程工作区、用 **21 个 `rw_*` 工具**操作远端（`rw_edit`/`rw_stat`/`rw_mkdir`/`rw_remove`/`rw_move` 等）。
- **架构**：host 工具 + client 注入（**依赖 `dsh-client-ui-renderer`**）；`dependencies` 含 `ssh2 ^1.16.0`、`iconv-lite`、**`dsh-better-sidebar ^0.18.1`**、`schemastery`。
- **许可证**：npm 声明 MIT。
- **rc.2 兼容性**：**不合格，且是双重不合格**。peer 同时要求 `^0.1.0-rc.6`（一批）与 **`^0.1.2-rc.1`**（`dsh-client-locale`、`dsh-client-ui-renderer`）。`^0.1.2-rc.1` 的 tuple 是 0.1.2，`^0.1.0-rc.6` 的 tuple 是 0.1.0，**都没有 0.1.1 的 tuple → 0.1.1-rc.2 两个都不满足**。其目标线是 **0.1.2-rc.1 及以上**。
- **注意**：它把 `dsh-better-sidebar` 写进 `dependencies`（`^0.18.1`），而 `dsh-better-sidebar@0.19.1` 的 peer 全是 `^0.1.5-rc.1` → 会连带把整棵 0.1.5 线的 peer 需求拉进来（**推测**：安装期报 peer 冲突）。
- **客户端注入**：`@deepseek-ai/dsh-client-ui-renderer ^0.1.2-rc.1`。
- **URL**：https://registry.npmjs.org/dsh-remote ｜ https://github.com/flymysql/dsh-remote

### 3.8 `dsh-remote-dev@1.0.0`（tsja2001）
- **功能面**：AI 远程开发的 SSH 插件 — 在 Linux/Windows 服务器上执行命令、读/写/浏览文件。
- **架构**：极简，host 工具型。`dependencies` = `@deepseek-ai/dsh-tools ^0.0.1-rc.1` + `ssh2 ^1.17.0`；monorepo（`packages/remote-ssh`）。`engines.node >=18`。
- **许可证**：npm 声明 MIT。
- **rc.2 兼容性**：**不合格（有风险）**。`@deepseek-ai/dsh-tools` 被写在 **`dependencies`** 且范围是 `^0.0.1-rc.1`（tuple 0.0.1）→ 既**不覆盖** 0.1.1-rc.2，又会装出**第二份 `dsh-tools`**。源码最后发布 2026-08-20，落后。
- **客户端注入**：无。
- **URL**：https://registry.npmjs.org/dsh-remote-dev ｜ https://github.com/tsja2001/dsh-remote-dev

### 3.9 `dsh-remote-server@0.1.1`（MRZHUH）
- **功能面**：在会话里用 `@` 提及一台服务器，即通过 SSH 在其上执行命令，带「失败即关闭」的两级审批门。
- **架构**：host 工具 + client UI（`@` 输入触发器）。
- **许可证**：npm 声明 MIT。
- **rc.2 兼容性**：**不合格**。peer 是**精确锁定**（无 `^`）：`dsh-client-runtime`、`dsh-client-ui-input-trigger`、`dsh-client-ui-primitives`、`dsh-client-ui-settings`、`dsh-client-ui-slots`、`dsh-host-webserver`、`dsh-llm`、`dsh-session`、`dsh-settings`、`dsh-subprocess`、`dsh-tools`、`dsh-user-approval` **全部 `= 0.1.0-rc.6`**。精确版本 + tuple 0.1.0 → **0.1.1-rc.2 绝不满足**。
- **客户端注入**：**同时需要 slots 与 primitives**（都是 0.1.0-rc.6）。
- **URL**：https://registry.npmjs.org/dsh-remote-server ｜ https://github.com/MRZHUH/dsh-remote-server

### 3.10 `dsh-plugin-ssh@0.1.0`（techflag）
- **功能面**：SSH/SFTP 工作区：多主机管理（增删改、指纹核对、记住密码）、SSH 终端（多会话标签、交互式、快捷命令）、SFTP 文件（目录浏览、彩色文件类型、拖放/多选上传、安全替换、下载、UTF-8 文本编辑）。AI 复用宿主已配置的模型。
- **架构**：host + client（侧栏 SSH 入口）。
- **许可证**：npm 声明 MIT。
- **rc.2 兼容性**：**不合格**。peer 为 `^0.1.2-rc.1 || ^0.1.3-alpha.2`（connection / host-webserver / llm / session / tools），`cordis ^4.0.2`。tuple 0.1.2 与 0.1.3 → **0.1.1-rc.2 不满足**。目标线 **0.1.2-rc.1 / 0.1.3-alpha.2**。
- **客户端注入**：无 slots/primitives。
- **URL**：https://registry.npmjs.org/dsh-plugin-ssh ｜ https://github.com/techflag/dsh-plugin-ssh

### 3.11 `dsh-workspace-enhancement@0.1.4`（DobyChao）
- **功能面**：「本地 + 远程（SSH）工作区统一管理」：一个会话可持有**多个工作区**（主 cwd + 侧目录声明表），机器、TOFU 主机密钥、keychain 密码都存在本地 `~/.dsh`。远程走**单条多跳 SSH 链**跑 bash/文件/PTY/目录浏览；**已有使用 `ctx.subprocess`/`ctx.fs` 的工具无需改代码即可远程工作**。
- **架构**：缝替换型（最贴近「透明远程执行世界」的定位）。基于 ssh2。
- **许可证**：npm 声明 MIT。
- **rc.2 兼容性**：**不合格**。peer 全部 `^0.1.5-rc.1`（fs、fs-local、fs-sandbox、host-directory-picker(-native)、llm、sandbox、sandbox-policy、subprocess、subprocess-local …）→ tuple 0.1.5 → **0.1.1-rc.2 不满足**。目标线 **0.1.5-rc.x**。
- **客户端注入**：无。
- **URL**：https://registry.npmjs.org/dsh-workspace-enhancement ｜ https://github.com/DobyChao/dsh-workspace-enhancement

### 3.12 `dsh-remote-tunnel@0.1.9`（Linjiangxian0203）
- **功能面**：远程主机隧道管理器 —— 分配/登记远程端口，通过 systemd 在远程 Linux 服务器上跑 `dsh web`，并维持本机到它的**韧性 SSH 隧道**。属于「把 DSH 本身部署到远程主机」而非「用 DSH 开发远程主机」。
- **架构**：CLI 型插件。peer `@deepseek-ai/dsh-cmdline ^0.1.2-alpha.3`；deps `js-yaml`、`commander ^15`。
- **许可证**：npm 声明 MIT。
- **rc.2 兼容性**：**不合格**（tuple 0.1.2 ≠ 0.1.1）。
- **URL**：https://registry.npmjs.org/dsh-remote-tunnel ｜ https://github.com/Linjiangxian0203/dsh-remote-tunnel

### 3.13 `@hyzyn/dsh-tty@0.17.0`（hyzyn）★ 终端面最强
- **功能面**：Web GUI 终端面板：侧栏「终端」大弹窗、xterm.js + PTY 全交互终端、**ssh2 原生 SSH 远程连接**、tmux 会话持久化，并暴露扩展点 `ttyConnbar`（连接栏）、`ttyTerminal`（终端服务）、`ttyPanel`（面板内挂载位）。
- **架构**：host（ssh2 + ws + `@xterm/headless` + 自有 kit `@hyzyn/dsh-kit`）+ client 面板。
- **许可证**：npm 声明 Apache-2.0。
- **rc.2 兼容性**：**不合格**。唯一 peer 是 `@deepseek-ai/dsh-tools ^0.1.2-rc.1` → tuple 0.1.2 → **0.1.1-rc.2 不满足**。
- **客户端注入**：无 slots/primitives。
- **URL**：https://registry.npmjs.org/@hyzyn%2Fdsh-tty ｜ https://github.com/hyzyn/dsh-plugin-kit

### 3.14 `dsh-ssh-tui@0.6.3`（cyjyyd）★ 注意语义陷阱
- **功能面**：**「SSH-friendly interactive terminal TUI」** —— 名字里有 SSH，但含义是**「适合在 SSH 会话里运行的 TUI」**，即给 DSH 做终端交互界面，**不是**去连远程主机的插件。
- **架构**：TUI profile 插件，无 web client。
- **许可证**：npm 声明 MIT。
- **rc.2 兼容性**：**不合格**，且它自己给了明确的自证：`dsh.compatibility.dsh = ">=0.1.2-rc.1 <0.1.6 || >=0.1.3-alpha.2 <0.1.6 || >=0.1.5-alpha.1 <0.1.6"`，并附 `dshReleases` 逐版本标注（`0.1.2-rc.1`/`0.1.5-rc.1`/`0.1.5-rc.2`/`0.1.3-alpha.2`/`0.1.5-alpha.1`/`0.1.5-alpha.2` = compatible，**未列 0.1.1-rc.2**）。tuple 0.1.2/0.1.3/0.1.5 → **0.1.1-rc.2 不满足**。
- **URL**：https://registry.npmjs.org/dsh-ssh-tui ｜ https://github.com/cyjyyd/dsh-ssh-tui

### 3.15 `dsh-workbench-ecs@0.6.7`（nishuoyang）★ rc.2 可装
- **功能面**：阿里云 Workbench CLI 插件 —— 让 DSH Agent 直接控制远程 ECS 实例。属于「远程主机」但经云厂商 CLI 而非裸 SSH。
- **架构**：host 工具型。peer `dsh-tools ^0.1.1-rc.2`、`cordis ^4.0.1`。
- **许可证**：npm 声明 MIT。
- **rc.2 兼容性**：**合格**。`^0.1.1-rc.2` tuple = 0.1.1，**覆盖 0.1.1-rc.2**；`cordis ^4.0.1` 接受 4.0.2。22 个版本、持续更新到 2026-09-12。
- **URL**：https://registry.npmjs.org/dsh-workbench-ecs ｜ https://github.com/nishuoyang/dsh-workbench-ecs

### 3.16 `dsh-remote-plugin@0.6.24`（Blank-not-black，即 `dsh-Remote`）
- **功能面**：DSH 左侧原生边栏入口 + 右侧抽屉管理控制台；内置网关随 DSH 自动启停（systemd 独立单元）；`/fs/*` 文件传输端点（列表/断点下载/上传）；配合 Android App 远程操控会话/审批/提问/goal 与文件互传。
- ****重要区分**：这是**「用手机远程控制 DSH」**（远程访问 GUI），**不是「用 DSH 开发远程主机」**。需求场景不同，选型时极易混淆。
- **架构**：bundle 插件 + 独立网关进程。`dsh.client.inject = ["@deepseek-ai/dsh-client-runtime", "@deepseek-ai/dsh-client-ui-slots"]`。
- **许可证**：npm 声明 MIT，仓库 `LICENSE` 文件存在（root 列表可见 `LICENSE`）。
- **rc.2 兼容性**：**peerDependencies 为空 `{}` → 无 peer 冲突，可安装**。但 `inject` 里的 `@deepseek-ai/dsh-client-ui-slots` **本机未安装**，需显式补装（见 §5）。**推测**：该 inject 项应在运行时被模块加载器解析。
- **URL**：https://registry.npmjs.org/dsh-remote-plugin ｜ https://github.com/Blank-not-black/dsh-Remote

### 3.17 `@elinpf/dsh-ops` 套件 0.3.0（Elinpf）★ 全新发现
- **功能面**：运维套件 —— `@elinpf/dsh-ops` 是单包部署单元（host-plane 行 + ops agent preset），底层是细粒度包族：`dsh-ops-access`（凭据 YAML 注册表 + `ctx.opsAccess` 缝）、`dsh-ops-access-ssh`（SSH 凭据校验/密钥路径展开）、`dsh-ops-tool-ssh`（**通过 `ctx.shell` 执行 SSH 命令**，自动注入凭据路径）、`dsh-ops-shell-tool`、`dsh-ops-tool-kubectl`、`dsh-ops-tool-ceph`、`dsh-ops-tool-prometheus`、`dsh-ops-tool-trace`、`dsh-ops-tool-environment`、`dsh-ops-panel`、`dsh-ops-prompts` 等 **19 个包**。
- **架构**：**能力缝（service）+ provider** 的规范设计 —— 这是本家族里架构最「正统」的一套（不 patch 核心，靠 `ctx.opsAccess` 注册）。
- **许可证**：全部 npm 声明 MIT；**但仓库 `Elinpf/dsh-ops-plugins` 的 `LICENSE` 文件返回 404（已核实）** → **npm 声明 MIT 而仓库无 LICENSE 文件，两者不一致，必须标注**。（注意：`package.json` 里 `license` 字段亦为空 —— 根 `package.json` 只有 `name: dsh-ops-plugins`、`private: true`。）
- **rc.2 兼容性**：**部分不合格**。分两类：
  - `@elinpf/dsh-ops@0.3.0`（聚合）与 `@elinpf/dsh-ops-tool-ssh`（peer 仅 `cordis ^4.0.1`）→ **无 rc.2 冲突**；
  - `dsh-ops-access`（`dsh-invariants`/`dsh-llm`/`dsh-tools ^0.1.0-rc.8`）、`dsh-ops-tool-environment`（`dsh-tools ^0.1.0-rc.8`）、`dsh-ops-access-ssh`（含 `@elinpf/dsh-ops-access` 依赖）→ tuple 0.1.0 → **0.1.1-rc.2 不满足**。
  由于聚合包 `@elinpf/dsh-ops` 依赖全部子包，**整套装上去会连带触发 rc.8 的 peer 需求 → 在 0.1.1-rc.2 上不成立**。
- **客户端注入**：无 slots/primitives（有独立 `dsh-ops-access-ui` / `dsh-ops-panel` / `dsh-ops-trace-ui` client 包，peer 未声明 slots/primitives）。
- **URL**：https://registry.npmjs.org/@elinpf%2Fdsh-ops ｜ https://github.com/Elinpf/dsh-ops-plugins

### 3.18 `dsh-better-sidebar@0.19.1`（omdsh-dev）
- **功能面**：类 VSCode 的右侧栏（explorer / editor / terminal / git / browser），每会话隔离；**对其他插件暴露服务**以注册侧栏标签与文件视图 —— 是「远程 SSH 插件挂 UI」的常用底座（`dsh-remote@0.8.15` 就依赖它）。
- **许可证**：npm 声明 MIT，周下载 **73829**（本家族最高，属于基础设施而非 SSH 插件）。
- **rc.2 兼容性**：**不合格**。peer 全部 `^0.1.5-rc.1`（llm/agent/tools/session/settings/subagent/invariants/client-locale/host-webserver/…）。目标线 **0.1.5-rc.x**。
- **URL**：https://registry.npmjs.org/dsh-better-sidebar ｜ https://github.com/omdsh-dev/DSH-better-sidebar

### 3.19 `@unieai/uad-remote-machine@0.1.21`（UnieAI）
- **功能面**：「the execution world on a machine reached over SSH」，由 `@unieai/uad-bash-local`、`uad-ssh`、`uad-subprocess-ssh`、`uad-fs-ssh` 组成 —— 架构上正是「远程执行世界」的正解形态。
- ****关键问题**：它属于 **`@unieai/*` fork 命名空间**（peer 是 `@unieai/uad-invariants ^0.1.21` + `@unieai/cordis ^4.0.2`），**不是 `@deepseek-ai/*`**。
- **许可证**：npm 声明 MIT。
- **rc.2 兼容性**：**与官方 0.1.1-rc.2 无关**，不可混用（除非整体切换到 UnieAI 的 fork 栈）。
- **URL**：https://registry.npmjs.org/@unieai%2Fuad-remote-machine ｜ https://github.com/UnieAI/UnieAI-Agent-Desktop

### 3.20 `@artificialnotimbecile/dsh-remote-runtime@0.1.2`
- **功能面**：通过 OpenSSH 管理**隔离的 DSH 运行时**，带原生 Web 控制面。
- **rc.2 兼容性**：**不合格**（peer 精确锁 `0.1.0-rc.8`，含 `dsh-client-ui-slots 0.1.0-rc.8`）。
- **许可证**：npm 声明 MIT。
- **URL**：https://registry.npmjs.org/@artificialnotimbecile%2Fdsh-remote-runtime ｜ https://github.com/ArtificialNotImbecile/dsh-remote-runtime

### 3.21 `dsh-serial@0.1.0`（hgy043）★ 串口方案 A
- **功能面**：嵌入式串口调试工具插件，**由 pyserial Python 脚本驱动，零原生依赖**。4 个工具：
  - `serial_scan` — 枚举串口（描述/VID/PID/芯片名/序列号/位置），支持关键词过滤
  - `serial_send` — 发文本或 Hex（支持行尾、重复发送、等待响应），**README 明确点名适合「AT 命令与刷机命令」**
  - `serial_monitor` — 实时监控输出（正则过滤/排除、超时自动结束、可中止）
  - `serial_log` — 抓取输出存为 text/csv/jsonl
  安全规则内置在工具契约里：绝不猜波特率、绝不替你选串口、无明确意图不发数据。
- **架构**：`dsh` 字段仅 `{"bundle":{"patch":"./cordis.patch.yml"}}`，**peer 与 deps 全空** → bundle 型纯 host 插件。要求 **Python 3 + `pip install pyserial`**，并需串口驱动。README 给出 GEC6818 嵌入式 Linux 开发板（COM7，PL2303GT）实测样例。
- **许可证**：npm 声明 MIT。
- **rc.2 兼容性**：**无 peer 约束 → 可安装**。但**完全不引用任何 `@deepseek-ai/*` 包**，与 DSH 的耦合仅靠 `cordis.patch.yml` 的 bundle 机制 —— **推测**：它依赖 host 注入的工具注册 API，接口漂移风险自担。
- **安装后必须重启 web**（bundle 层栈在 boot 时合成）。
- **URL**：https://registry.npmjs.org/dsh-serial ｜ https://github.com/hgy043/dsh-serial （npm `repository` 字段为 null）

### 3.22 `@infinitepersistence/dsh-serial-console@0.1.0-rc.4`★ 串口方案 B（最强，但 rc.2 不合）
- **功能面**：**用户与 AI 共享同一个可审计串口会话** —— 浏览器看板卡启动日志与实时输出、键盘直接操作设备（Tab 补全/方向键/退格/粘贴/输入法/终端控制键）、选择串口与波特率与 CR/LF/CRLF 行尾、Text 与 HEX 视图切换、`Ctrl+F` 历史查找、会话事件导出 + 独立串口审计记录。Text 模式是**真实 VT 终端**（提示符、ANSI 颜色、光标移动、同行刷新）。适用 Linux 开发板、U-Boot、MCU Shell、AT 指令设备。
- **架构**：host（zod + `@xterm/xterm` + `@xterm/addon-fit`）+ client。**`dsh.client.inject` 与 slots/primitives 的关系**：rc.3 起 peer 增加 `@deepseek-ai/dsh-client-ui-primitives`。
- **许可证**：npm 声明 MIT，README 带 MIT badge。
- **rc.2 兼容性**：**不合格（多重）**。全部 7 个版本（alpha.0 ~ rc.4）的 peer 都含 **`@deepseek-ai/dsh-tools >=0.0.1-rc.1 <0.1.0`** 与 **`dsh-system-prompt >=0.0.1-rc.1 <0.1.0`** → 上限 **< 0.1.0**，**0.1.1-rc.2 被显式排除**。rc.4 另加 `dsh-client-ui-primitives >=0.1.0-rc.7 <0.2.0`（tuple 0.1.0 → 0.1.1-rc.2 亦不满足）。
- **注意 dist-tags 异常**：`latest = 0.1.0-alpha.1`（2026-08-19），`next = 0.1.0-rc.4`（2026-08-25）→ **`npm install` 默认装到 alpha.1（更旧）**，要装 rc.4 必须显式 `@0.1.0-rc.4`。
- **URL**：https://registry.npmjs.org/@infinitepersistence%2Fdsh-serial-console ｜ https://github.com/InfinitePersistence/dsh-serial-console

### 3.23 `dsh-embedded-workbench@0.8.9`（AmethystLuna）★ 嵌入式最相关（但只是知识层）
- **功能面**：嵌入式 C/C++ 固件开发工具箱 —— **4 个代理**（`architecture-steward` 只读规划、`design-reviewer` 设计文档事实核查、`execution-worker` 计划→审批→实施含编译验证、`quality-coordinator` 实现审查）+ **8 个技能**（`embedded-workbench` 引导、`debug-methodology` 8 条调试铁律、`embedded-firmware-dev` FreeRTOS/中断/NVM/异步生命周期/LVGL 陷阱、**`keil-mdk-build` UV4 CLI / ARM Compiler 5/6 / .map 分析 / 合并打包 / 构建诊断**、`c-cpp-dev`、`state-machine-design`、`hardfault-triage` 故障寄存器/栈帧/PC 定位源码）。基于 Agent Skills 开放标准，声称跨平台（Claude Code、Codex CLI、Cursor、Kimi CLI、OpenCode、ZCode）。
- **架构**：**无 host 工具、无 client 注入** —— 纯 skill/agent 内容包（peer 只引用 `dsh-llm`/`dsh-agent`/`dsh-session`/`dsh-skill-filesystem`/`cordis`/`schemastery`）。
- **许可证**：npm 声明 MIT，仓库 LICENSE 存在（已核实 raw 可达）。
- **rc.2 兼容性**：**不合格**（`^0.1.0-rc.6` 与 `^0.1.0-rc.8`，tuple 0.1.0/0.1.0）。目标线 **0.1.0-rc.6 ~ rc.8**。
- **关键限制**：**它是「知识/流程」，不是「工具链」** —— 不驱动 arm-none-eabi-gcc、不调 CMake、不烧录、不连串口。所谓「Keil MDK 构建」是**给模型的操作技能文本**，仍需宿主 bash 工具真正执行命令。周下载 655。
- **URL**：https://registry.npmjs.org/dsh-embedded-workbench ｜ https://github.com/AmethystLuna/embedded-workbench

### 3.24 `dsh-adb@1.7.0`
- **功能面**：ADB 设备与台架操作 —— 设备发现、结构化 logcat、apk 安装、文件 pull/push、性能快照、性能基线、崩溃报告、一键设备健康报告、条件等待、操作编排。`dsh` 字段 `{"bundle":{"patch":"./cordis.patch.yml"},"client":{"platform":"web"}}`。
- **架构**：host + client。`peerDependencies = {}`，deps 仅 `schemastery ^3.13.1`。
- **许可证**：npm 声明 MIT。**npm `repository` 字段为 null，未查到 GitHub 仓库** → 无法核对仓库 LICENSE 文件与源码，**审计盲区，选型需谨慎**。
- **rc.2 兼容性**：**可安装**（无 peer 约束）。16 个版本持续更新到 2026-08-31。
- **能力边界**：**不含 fastboot / 分区烧录 / 固件刷写**；是「已有设备上的运维与调试」。
- **URL**：https://registry.npmjs.org/dsh-adb

### 3.25 `dsh-hdc-bridge@0.9.1`（1na-ko）
- **功能面**：DSH 原生鸿蒙开发助手 —— hdc 设备闭环调试、输入行开发面板、**离线官方版本化 API 知识层**（Tier-1 随包）、DevEco 编译辅助、独立 Command Line Tools 支持。
- **架构**：host（`lib/host.js`）+ client（`dsh.client.inject: []` 空注入）。**peer 与 deps 全空（零依赖）**。
- **许可证**：npm 声明 MIT。
- **rc.2 兼容性**：**可安装**（无 peer 约束）。
- **能力边界**：设备侧（鸿蒙/Android 生态），**非 Linux SoC 串口/烧录**。
- **URL**：https://registry.npmjs.org/dsh-hdc-bridge ｜ https://github.com/1na-ko/dsh-hdc-bridge

### 3.26 `@hy-sde-org/dsh-tool-debug@0.1.2-rc.1` + `@hy-sde-org/dsh-dap@0.1.2-rc.1`★ 唯一调试器路径
- **功能面**：
  - `dsh-dap` = Debug Adapter Protocol **能力缝**（capability seam）：adapter 解析 + 会话管理器（启动/附加、设断点、单步、列线程与栈帧、读作用域与变量、求值）。
  - `dsh-tool-debug` = 面向模型的 `debug` 工具，**28 个操作**：launch/attach、断点、continue/pause/step、threads/stackTrace/scopes/variables/evaluate、**disassembly**、**memory**、modules、output 等。
- **架构**：规范的 seam + consumer 两层（`dsh-tool-debug` 依赖 `@hy-sde-org/dsh-dap ^0.1.2-rc.1`）。基于 `ctx.subprocess` 拉起 adapter。
- **许可证**：两者 npm 均声明 MIT。
- **rc.2 兼容性**：**不合格**。`dsh-tool-debug` peer = `dsh-invariants`/`dsh-system-prompt`/`dsh-timeout`/`dsh-tools` **`^0.1.2-rc.1`** + `cordis ^4.0.2`；`dsh-dap` peer = `dsh-invariants`/`dsh-subprocess ^0.1.2-rc.1`。tuple 0.1.2 → **0.1.1-rc.2 不满足**。目标线 **0.1.2-rc.1 及以上**。
- **嵌入式适用性**：**理论上可接 `gdb`（DAP 适配器）做交叉调试，但无 OpenOCD/JTAG 专属集成，也无烧录能力**（**推测**：需自行提供 DAP adapter 与 launch 配置）。
- **URL**：https://registry.npmjs.org/@hy-sde-org%2Fdsh-tool-debug ｜ https://registry.npmjs.org/@hy-sde-org%2Fdsh-dap ｜ https://github.com/hy-sde/dsh-tool-debug

---

## 4. 专项：串口 / 烧录 / 交叉编译 / 调试（明确回答）

### 4.1 串口通信（serialport）—— **有 3 个候选，但都不在 rc.2 上顺畅**

| 候选 | 串口实现 | rc.2 可装 | 备注 |
|---|---|---|---|
| `dsh-serial@0.1.0`（hgy043） | **pyserial**（Python 脚本子进程），**零原生依赖** | **✓ 可装**（peer `{}`） | 需 `pip install pyserial` + 串口驱动；4 工具（scan/send/monitor/log）；README 明确支持「刷机命令」的发送（≠ 真正的烧录协议） |
| `LTY-lty666/dsh-serial`（GitHub only） | **Node.js `serialport`**（NAPI prebuild 免编译），Windows/Linux 双平台 | **未发布到 npm** | 6 工具 `serial_list/open/write/read/query/close`；在 `package.json` 里自称 `dsh-serial`，**但 npm 上该名已被 hgy043 占用（404 无法发布）**；peer `dsh-tools 0.1.1-rc.2`、`cordis 4.0.1` → **恰好命中 rc.2 线**，若手动从源码安装理论可行 |
| `@infinitepersistence/dsh-serial-console` | 浏览器 xterm.js ↔ 串口，人机共享 + 审计 | **✗ 不可装** | peer 显式 `<0.1.0` 上限，**0.1.1-rc.2 被排除**；功能最强（VT 终端、HEX、审计导出） |

### 4.2 固件烧录（esptool / openocd / dfu / rockusb / uuu / fastboot）—— **无候选具备**

- npm 定向检索 `dsh esptool`、`dsh dfu flashing`、`dsh uuu rockusb`、`dsh fastboot bootloader`、`dsh flash firmware soc` **均未返回任何 DSH 烧录插件**（返回的全部是 `dshmarket`、`@deepseek-ai/dsh-home-paths` 等不相关包）。
- GitHub 检索 `dsh embedded firmware`（total = **1**）、`dsh serial`（total = 13，逐条核对后仅 3 条与串口真相关）**亦无烧录插件**。
- **最接近的**：
  - `dsh-adb@1.7.0` —— 设备运维（apk 安装、push/pull、logcat），**不含 fastboot 刷写**；
  - `dsh-hdc-bridge@0.9.1` —— 鸿蒙 hdc 设备调试与 DevEco 编译/签名，**不含固件烧录**；
  - `dsh-serial@0.1.0` 的 `serial_send` —— 可以**手工发送**烧录命令的字节串，但**没有 esptool/openocd/dfu 等烧录工具的编排、进度解析、校验与回滚**。
- **结论：本家族在「固件烧录」上是空白，需要自研。**

### 4.3 交叉编译工具链集成 —— **无专用插件**

- `dsh-embedded-workbench@0.8.9` 是最接近的：它有 `keil-mdk-build` 技能（UV4 CLI、ARM Compiler 5/6、.map 分析、合并打包、构建诊断）与 `c-cpp-dev` 技能 —— 但**这些是给模型的技能文本，不封装工具链、不做工具链探测/环境注入/多目标矩阵构建**。真正的编译仍由宿主 `ctx.shell`/bash 工具执行。
- `@elinpf/dsh-ops-tool-environment@0.3.0` 是「环境清单扫描器」，但只扫 k8s 集群/工作负载/中间件，**不扫交叉工具链**。
- **结论：无交叉编译插件；需要自研（或复用 `dsh-embedded-workbench` 的技能文本 + 宿主 bash）。**

### 4.4 GDB / OpenOCD 调试 —— **有通用 DAP 路径，无 OpenOCD 专属集成**

- `@hy-sde-org/dsh-dap` + `@hy-sde-org/dsh-tool-debug`（0.1.2-rc.1，28 操作，含 disassembly / memory / modules）是目前**唯一**的调试器集成路径，走 DAP 协议 → 理论上可接 GDB（进而接 OpenOCD 的 gdb server）。
- 但：**peer `^0.1.2-rc.1` 与 0.1.1-rc.2 不兼容**；且**没有 OpenOCD/JTAG/探针（J-Link/ST-Link）任何专属集成**。
- **结论：」GDB 调试可自建 DAP 路径；OpenOCD 集成需自研。**

### 4.5 缺口清单（需自研）

1. **固件烧录编排**：esptool / openocd / dfu-util / rockusb / uuu / fastboot 的封装（进度、校验、失败回滚）。
2. **交叉工具链集成**：工具链探测、`sysroot`/`CMAKE_TOOLCHAIN_FILE` 注入、多目标矩阵构建、产物分析。
3. **OpenOCD/探针集成**：J-Link/ST-Link/OpenOCD 目标配置、烧写-复位-挂载调试一体化。
4. **远程文件同步**：现有 SSH 插件多为 SFTP 单文件传输/编辑；**增量 rsync/双向同步/文件监听**未见到（`dsh-ssh-workspace-manager` 号称含 `sync`，但**未发布到 npm**）。

---

## 5. 本机部署障碍专项：`dsh-client-ui-slots` 与 `dsh-client-ui-primitives`

### 5.1 npm 存在性与版本（**关键纠正**）

`curl https://registry.npmjs.org/@deepseek-ai%2Fdsh-client-ui-slots` 与 `.../dsh-client-ui-primitives` 均返回 **HTTP 200**（两者均已发布）。

| 项 | `dsh-client-ui-slots` | `dsh-client-ui-primitives` |
|---|---|---|
| dist-tags | `latest = 0.0.1-rc.1`、`next = 0.1.5-rc.2`、`alpha = 0.1.5-alpha.2` | 同左 |
| 全部版本数 | 21 | 21 |
| 版本列表 | 0.0.1-rc.1/rc.2/rc.3/rc.5、0.1.0-rc.2/rc.3/rc.6/rc.7/rc.8、**0.1.1-rc.1、0.1.1-rc.2**、0.1.2-alpha.2/3/4/5、0.1.2-rc.1、0.1.3-alpha.2、0.1.5-alpha.1/2、0.1.5-rc.1、**0.1.5-rc.2** | 完全相同 |
| **是否存在 0.1.1-rc.2** | **✅ 存在**，发布于 **2026-08-21T12:42:49Z** | **✅ 存在**，发布于 **2026-08-21T12:42:58Z** |
| 最新发布 | 0.1.5-rc.2（2026-09-10T14:57:22Z） | 0.1.5-rc.2（2026-09-10T14:57:35Z） |
| license（按版本） | `0.0.1-rc.1` = **BSD-3-Clause**；`0.1.1-rc.2` 与 `0.1.5-rc.2` = **MIT** | 同左（0.0.1-rc.1 BSD-3-Clause → 0.1.1-rc.2 起 MIT） |
| peerDependencies | 0.1.1-rc.2：`cordis ^4.0.1`、`dsh-invariants ^0.1.1-rc.2`<br>0.1.5-rc.2：`cordis ^4.0.2` | 0.1.1-rc.2：同上；另有 deps `clsx`/`anser`/`katex`/`react`/`shiki`/`react-dom`<br>0.1.5-rc.2：deps 变空，peer 仅 `cordis ^4.0.2` |
| repository | `deepseek-ai/deepseek-harness`，`directory: packages/client/ui-slots` | `…/packages/client/ui-primitives` |
| 描述 | Slot registry pure core: SlotMap declaration merging, single register composition API, four-share props types, store-seat types, renderer install seam | Pure React atoms for the dsh web UI: controls, icons, markdown, and JSON inspectors (zero cordis) |

> **回答「是否存在 0.1.1-rc.2 版本可安装」：是，明确存在且可直接 `npm install`。「rc.2 线未发布」的说法不成立。**
> **注意 `latest` dist-tag 陷阱**：两个包的 `latest` 都停在 **0.0.1-rc.1**（2026-08-10），裸 `npm i @deepseek-ai/dsh-client-ui-slots` 会装到最老的 rc.1。要装 rc.2 线必须显式写 `@0.1.1-rc.2`（或 `@next` 装 0.1.5-rc.2）。

### 5.2 为什么本机生产安装里没有它们（根因，已由产物证据确认）

本机安装：`/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`（**197 个包**）。核查结果：

1. **两者都不在本机 node_modules 中**（`ls` 确认不存在）。
2. **`dsh@0.1.1-rc.2` 的 `dependencies` 不含它们**：该版本共 62 个依赖，其中 client/host `@deepseek-ai` 依赖只有 `dsh-client-ui-agent-preset ^0.1.1-rc.2`、`dsh-client-ui-cordis ^0.1.1-rc.2`、`dsh-web-app ^0.1.1-rc.2`（另 0.1.2-rc.1 与 0.1.5-rc.1 起增加 `dsh-webhook*`）。
3. **`dsh-web-app@0.1.1-rc.2` 的 `dependencies` 也不含它们**（共 69 个依赖，逐一过滤后无 slots/primitives；0.0.1-rc.1 → 0.1.5-rc.2 全部 8 个抽样版本都一样）。
4. **它们只出现在官方 UI 包的 `devDependencies`（构建期）**：本机 `@deepseek-ai/dsh-client-ui-*` 里，**35 个包的 `devDependencies` 有 slots、31 个有 primitives**（例如 `dsh-client-ui-layout/package.json` 的 `devDependencies` 含 `"@deepseek-ai/dsh-client-ui-slots": "^0.1.1-rc.2"`，而其 `peerDependencies` 只有 `cordis`/`dsh-client-runtime`/`dsh-client-ui-theme`/`dsh-invariants`）。**发布版同样如此**：`dsh-client-ui-layout@0.1.2-rc.1` 与 `@0.1.5-rc.2` 的 slots 也只出现在 `devDependencies`（`^0.1.2-rc.1` / `^0.1.5-rc.2`）。
5. 唯一例外是 `dsh-client-ui-renderer@0.1.1-rc.2` 的 **`lib/client.js` 第 14 行有一处真实运行时 `require`**：
   `let _deepseek_ai_dsh_client_ui_slots = require("@deepseek-ai/dsh-client-ui-slots");`
   同时 renderer 的 `peerDependencies` 也**不含** slots。→ 该 `require` 需由客户端模块加载器解析；**推测**：官方构建/加载链在运行时注入该模块，本机未安装时该代码路径的解析行为**未经实测验证**（标注为未知风险）。

### 5.3 是否被合并 / 改名到 `dsh-client-ui-layout` / `-sidebar` / `-theme`？—— **否**

- **改名/合并：无证据支持，且反证成立。** 两个包名一直独立发布到 **0.1.5-rc.2**（2026-09-10），仓库目录仍是 `packages/client/ui-slots` 与 `packages/client/ui-primitives` —— 若已合并，不会再持续发新版。
- `dsh-client-ui-layout`、`-sidebar`、`-theme`、`-settings`、`-conversation`、`-renderer` 都**没有**把它们吸收进 `dependencies`（抽样 `0.0.1-rc.1`/`0.0.1-rc.5`/`0.1.0-rc.6`/`0.1.0-rc.8`/`0.1.1-rc.2`/`0.1.2-rc.1`/`0.1.5-rc.1`/`0.1.5-rc.2` 八个版本，`dependencies` 里 slots/primitives 一律 **NONE**）。
- **真正发生的变化是「依赖关系下沉」**，证据在 `@deepseek-ai/dsh-client-runtime` 的版本历史：
  | `dsh-client-runtime` 版本 | 发布时间 | `dependencies` 中 slots | 说明 |
  |---|---|---|---|
  | 0.0.1-rc.1 | 2026-08-10 | `@deepseek-ai/dsh-client-ui-slots ^0.0.1-rc.1` | 共 17 个依赖，**slots 是硬运行时依赖** |
  | 0.0.1-rc.5 | 2026-08-12 | `^0.0.1-rc.5` | 共 15 个 |
  | 0.1.0-rc.6 | 2026-08-13 | `^0.1.0-rc.6` | 共 15 个 |
  | **0.1.0-rc.8** | 2026-08-19 | **无** | 依赖骤降到 **2 个**（仅 `immer`、`zustand`） |
  | **0.1.1-rc.2** | 2026-08-21 | **无** | 仍为 2 个 |
- **结论**：从 **0.1.0-rc.8** 起，slots/primitives 被从 `dsh-client-runtime` 的运行时依赖中**移出**，改为官方 UI 包在**构建期**通过 `devDependencies` 内联/bundle。它们**没有被合并，也没有改名**；仍是独立发布的包，但**不再是 `dsh@0.1.1-rc.2` 生产安装的一部分**。

### 5.4 对本机的实际影响与建议

- **症状解释**：本机没有这两个包**不是安装错误，而是 0.1.1-rc.2 的正常形态**（生产安装不拉官方包的 devDependencies）。
- **谁真的需要显式安装**：**以运行时 peer 声明了它们的第三方插件**。已核实清单：
  | 插件 | 声明的 slots/primitives 版本 |
  |---|---|
  | `@captain1275/dsh-ssh@0.3.1` | `dsh-client-ui-slots ^0.1.1-rc.2` ← **与本机 rc.2 精确匹配** |
  | `dsh-remote-server@0.1.1` | `slots` + `primitives` **= 0.1.0-rc.6**（精确） |
  | `@zhangfengshun/dsh-remote-ssh@2.4.4` | `dsh-client-ui-primitives ^0.1.0-rc.6` |
  | `@zseven-w/dsh-android@0.1.0-rc.4` | `dsh-client-ui-slots ^0.1.0-rc.6` |
  | `@artificialnotimbecile/dsh-remote-runtime@0.1.2` | `slots` **= 0.1.0-rc.8** |
  | `@infinitepersistence/dsh-serial-console@0.1.0-rc.3+` | `primitives >=0.1.0-rc.7 <0.2.0` |
  | `dsh-remote-plugin@0.6.24` | `dsh.client.inject` 含 `slots`（无版本号） |
- **建议**：若选 `@captain1275/dsh-ssh@0.3.1`，需 `npm i @deepseek-ai/dsh-client-ui-slots@0.1.1-rc.2`（**不要裸装，会被 `latest` 带到 0.0.1-rc.1**）；其余插件的 peer 版本线（0.1.0-rc.x / 0.1.2-rc.x）与本机 0.1.1-rc.2 不兼容，装了也会有 `dsh-invariants ^0.1.1-rc.2` 之类的传递约束（**推测**）。

---

## 6. 同名混乱：npm 包名 ↔ GitHub 仓库 对应关系

### 6.1 已给候选的核查结论（任务点名）

| GitHub 仓库 | `package.json` 里的 name | version | private | license | npm 上的实际归属 |
|---|---|---|---|---|---|
| [weisiren000/dsh-remote-ssh-ops](https://github.com/weisiren000/dsh-remote-ssh-ops) | `dsh-remote-ssh-ops` | 0.1.0 | **`true`** | **无 `license` 字段**；仓库根目录**无 LICENSE 文件**（raw 返回 404，已核实） | **未发布到 npm**（npm `dsh-remote-ssh-ops` 返回 404 已复核）。根目录有 `.gitmodules`（含子模块）、`cordis.patch.yml`、`docs/`、`test/`。peer 声明 `dsh-client-runtime`/`dsh-client-ui-conversation`/`dsh-client-ui-settings-plugins`/`dsh-client-ui-primitives`/`dsh-client-ui-slots` 全 `^0.1.0-rc.6` |
| [Elinpf/dsh-ops-plugins](https://github.com/Elinpf/dsh-ops-plugins) | 根 = `dsh-ops-plugins`（monorepo，无 version、`private: true`） | — | `true` | **根 `license` 字段为空；仓库无 LICENSE 文件（404，已核实）** | **实际发布为 `@elinpf/dsh-ops-*` scope**（19 个包，全部 `0.3.0`，2026-09-14，npm license 字段 **MIT**）—— **即「npm 声明 MIT 但仓库无 LICENSE 文件」，两者不一致**。`packages/` 目录：`ops`、`ops-access`、`ops-access-hub`、`ops-access-ui`、`ops-panel`、`ops-prompts`、`ops-shell-tool`、`ops-tool-ceph`、`ops-tool-environment`、`ops-tool-kubectl`、`ops-tool-prometheus`、`ops-tool-ssh`、`ops-tool-trace`、`ops-trace-ui` |
| [Blank-not-black/dsh-Remote](https://github.com/Blank-not-black/dsh-Remote) | `dsh-remote` | **0.6.24** | `true` | MIT（仓库 **有** LICENSE 文件） | **对应 npm `dsh-remote-plugin@0.6.24`** —— 证据：npm 的 `repository` 是该仓库且 `directory: packages/plugin`，versions 与 name 版本号一致。33 stars（本家族最高） |
| [Blank-not-black/dsh-remote-plugin](https://github.com/Blank-not-black/dsh-remote-plugin) | `dsh-remote-plugin` | 0.6.24 | 否（有 `publishConfig.access: public`） | MIT（有 LICENSE） | 同上插件族的**独立包仓库**；npm 上 `dsh-remote-plugin` 的 `repository` 指向的是 `dsh-Remote`(目录 `packages/plugin`) 而非本仓库 → **两个仓库同版本号，npm 只认其中一个来源，属易混点** |

### 6.2 同名冲突（不同作者，同一 npm 名）

| npm 包名 | npm 实际归属（repository 字段） | 同名但**未能发布**的仓库 | 证据 |
|---|---|---|---|
| `dsh-remote` | [flymysql/dsh-remote](https://github.com/flymysql/dsh-remote)（0.8.15，wk 1443） | [aur3l14no/dsh-remote](https://github.com/aur3l14no/dsh-remote)（其 `package.json` name = `dsh-remote-workspace`，`private: true`；npm `dsh-remote-workspace` = **404**）；[JochenYang/dsh-remote](https://github.com/JochenYang/dsh-remote)（Kotlin，手机端，未查到 npm 发布） | registry `repository` 字段；npm 404 复核 |
| `dsh-remote-ssh` | [Yan-Zero/dsh-remote-ssh](https://github.com/Yan-Zero/dsh-remote-ssh)（0.2.4，Apache-2.0） | [aijunjiang/dsh-remote-ssh](https://github.com/aijunjiang/dsh-remote-ssh)（其 package.json name 也是 `dsh-remote-ssh`，version **0.3.3**，license MIT，**但 npm 上最高只有 0.2.4 → 未发布**）；[cmukanisa/dsh-remote-ssh](https://github.com/cmukanisa/dsh-remote-ssh)（`private: true`） | 版本号对不上是最强的证据 |
| `dsh-plugin-ssh` | [techflag/dsh-plugin-ssh](https://github.com/techflag/dsh-plugin-ssh)（0.1.0，MIT，2026-09-09） | [hzxwonder-dsh-plugins/dsh-plugin-ssh](https://github.com/hzxwonder-dsh-plugins/dsh-plugin-ssh)（同名 `dsh-plugin-ssh` 0.1.0，**license LGPL-3.0-only**，peer 硬钉 `dsh-tools 0.1.5-rc.2`）—— **许可与目标线都完全不同，却共用同一仓库名** | 名字被 techflag 占用 → 推测无法发布；**注意 LGPL-3.0 vs MIT 的许可差异** |
| `dsh-serial` | hgy043（npm `repository` = **null**，凭描述与 [hgy043/dsh-serial](https://github.com/hgy043/dsh-serial) 完全一致判定） | [LTY-lty666/dsh-serial](https://github.com/LTY-lty666/dsh-serial)（package.json name = `dsh-serial`，0.1.0，MIT，peer `dsh-tools 0.1.1-rc.2`）—— 名字被占用，**未发布** | 两者实现完全不同（pyserial vs Node serialport）；**后者才是 rc.2 线** |
| `dsh-ssh-ops` | [caoyiwei850/dsh-ssh-ops](https://github.com/caoyiwei850/dsh-ssh-ops)（0.3.5） | [ADXZXCD/dsh-ssh-ops-timeout](https://github.com/ADXZXCD/dsh-ssh-ops-timeout)（package.json name = `dsh-ssh-ops`，version `0.2.15-timeout.1`）—— 未发布 | 同名占位 |
| `dsh-remote-workspace` | **404（无此包）** | 有两个不同仓库都用这个名字：[lengmoXXL/dsh-remote-workspace](https://github.com/lengmoXXL/dsh-remote-workspace)（0.0.1，`private: true`，peer 走 `^0.1.5-rc.1`）、[aur3l14no/dsh-remote](https://github.com/aur3l14no/dsh-remote)（根 package.json name = `dsh-remote-workspace`，`private: true`） | 两者互相冲突，均未发布 |
| `dsh-remote-hosts` | **404** | [catcatchcatast/dsh-remote-hosts](https://github.com/catcatchcatast/dsh-remote-hosts)（根 name = `dsh-remote-hosts-workspace`，0.2.0，`private: true`，Apache-2.0，描述称支持 DSH 0.1.2 Preview / 0.1.5 adapting） | 未发布 |

### 6.3 GitHub-only 候选（未发布到 npm，但真与远程主机/串口相关）

以下仓库均经 `package.json` + npm 404 双重核实，**未发布到 npm**，只能 `dsh plugin add github:<repo>` 或源码安装：

| 仓库 | package.json name / version | license | 相关性 |
|---|---|---|---|
| [telagod/dsh-ssh-workspace-manager](https://github.com/telagod/dsh-ssh-workspace-manager) | `dsh-ssh-workspace-manager` 0.3.2 | MIT（**有 LICENSE 文件**，`files` 里也含 LICENSE） | **SSH 主机、工作区绑定、remote exec/sync/compose** —— 唯一自称含 **sync** 的候选，但未发布 |
| [tiphareth0/dsh-sshworkspaces](https://github.com/tiphareth0/dsh-sshworkspaces) | `dsh-sshworkspaces` 0.1.0（`private: true`） | BSD-3-Clause | 工作区级 SSH 远程开发：跨多主机透明走缝路由 fs / git / terminal；4 stars |
| [WODE25500/dsh-ssh-pro](https://github.com/WODE25500/dsh-ssh-pro) | `dsh-ssh-pro` 0.1.0 | Apache-2.0 | 补齐 base `dsh-ssh` 缺口：连接测试/远程目录/ssh-config 导入/指纹检查/多主机批量；peer 全 `*` |
| [hesiwen66/OctoOps](https://github.com/hesiwen66/OctoOps) | `dsh-octoops` 0.1.0 | MIT | 统一 **SSH/Telnet & JumpServer 堡垒机**编排；peer 钉 `0.1.0-rc.6` |
| [Yantingmo/dsh-ssh-terminal-sync](https://github.com/Yantingmo/dsh-ssh-terminal-sync) | `dsh-ssh-terminal-sync` 0.1.0 | Apache-2.0 | Agent↔GUI 终端同屏互操作（`ssh_terminal_list/write/read/open/close` 驱动同一个 xterm.js） |
| [artemiroshnichenko/dsh-plugins](https://github.com/artemiroshnichenko/dsh-plugins) | 根 = `dsh-plugins-monorepo`（`private: true`，MIT LICENSE 文件存在） | MIT | 「Production-ready plugins：remote SSH agent execution + integrated terminal & file tree + security guardrailing」 |
| [QingZhuo99/dsh-ssh-servers](https://github.com/QingZhuo99/dsh-ssh-servers) | `dsh-ssh-servers` 0.1.0（`private: true`） | license 字段空（**LICENSE 文件存在**） | 「用于 harness 的服务器连接插件」 |
| [yin52133/dsh-luban](https://github.com/yin52133/dsh-luban) | `dsh-luban` 0.1.3（`private: true`） | MIT | 自定义工作台套件：局域网鉴权、任务板、**SSH + tmux keep-alive**、Windows/Ubuntu 共享；npm `@yin52133/*` scope 检索 total = **0**（未发布） |
| [1692775560/dsh-Mimir-Academic-research](https://github.com/1692775560/dsh-Mimir-Academic-research) | — | MIT | **GPU 服务器 SSH 任务编排** + LaTeX/arXiv 科研工作台；370 stars；npm `dsh-mimir-academic-research` = 404 |
| [horizon105457/tsstream](https://github.com/horizon105457/tsstream) | 根 = `tsstream-workspace` 0.0.0（`private: true`） | license 字段空 | 「terminal/**serial byte streams** → indexed, queryable, event-stream」—— 串口字节流可观测方向；npm `tsstream` = 404 |
| [LTY-lty666/dsh-serial](https://github.com/LTY-lty666/dsh-serial) | `dsh-serial` 0.1.0 | MIT | **Node `serialport` 串口插件，peer 恰好钉 `dsh-tools 0.1.1-rc.2`**（见 §4.1） |

### 6.4 其他易混「远程」家族（同名不同义，**不是 SSH 远程开发**）

| 包名 | 含义 | 证据 |
|---|---|---|
| `@mrrisega/dsh-remote` | 手机远程控制 DSH（0.6.5，wk 4686） | registry description |
| `@xgone/dsh-remote` | 远程访问 + 鉴权（登录门/MFA/签名） | 同上 |
| `ds-harness-remote` | 端到端加密远程访问（0.4.13） | 同上 |
| `dsh-remote-mobile` / `dsh-remote-desktop` / `dsh-remote-cpolar` / `dsh-remote-web-gateway` / `dsh-remote-auth` / `dsh-webgate` / `dsh-pocket` | 均为**手机/公网访问 DSH GUI**，与「用 DSH 开发远程 Linux/嵌入式主机」需求方向相反 | 同上 |
| `dsh-ssh-tui` | 「适合 SSH 会话中运行的 TUI」，**不连远程主机** | README/描述 |

> **选型提醒**：搜索 `dsh remote` 会返回 5 万+ 结果，**绝大多数是「手机远程控制 DSH」**（远程访问），与本次需求的「DSH 远程开发主机」（远程执行）是**反向的两类插件**。请以 `dsh.client.inject` / `peerDependencies` 中是否引用 `dsh-fs*`、`dsh-subprocess*`、`ssh2` 来区分。

---

## 7. 0.1.1-rc.2 兼容性判定汇总（semver 预发布规则应用）

**规则**（npm/node-semver）：预发布版本只能满足「比较器集合中至少有一个比较器与之 `major.minor.patch` 相同且自身带预发布标签」的范围。
→ `^0.1.0-rc.6`（tuple **0.1.0**）、`^0.1.2-rc.1`（tuple **0.1.2**）、`^0.1.5-rc.1`（tuple **0.1.5**）**都不覆盖 0.1.1-rc.2**（tuple **0.1.1**）；只有 `^0.1.1-rc.x`、`*`、或非预发布范围才可能覆盖。

| 判定 | 候选 | 依据 |
|---|---|---|
| **✅ 显式命中** | `@captain1275/dsh-ssh@0.3.1` | peer 全为 `^0.1.1-rc.2`（含 slots） |
| **✅ 通配放行** | `dsh-remote-ssh@0.2.4` | 官方包 peer 全 `*`；`cordis ^4.0.1-rc.1` 接受 4.0.2 |
| **✅ 命中** | `dsh-workbench-ecs@0.6.7` | `dsh-tools ^0.1.1-rc.2` |
| **✅ 无 peer 约束（可装）** | `dsh-ssh-ops@0.3.5`、`dsh-adb@1.7.0`、`dsh-serial@0.1.0`、`dsh-hdc-bridge@0.9.1`、`dsh-remote-plugin@0.6.24`、`dsh-remote-mod-plugin@0.7.9-mod.1`、`dsh-remote-dev@1.0.0`（但有 deps 风险）、`@elinpf/dsh-ops-tool-ssh@0.3.0` | `peerDependencies = {}` 或仅 `cordis` |
| **⚠️ 有条件** | `@linxin666/dsh-ssh@0.3.22` | peer 无冲突，但 `dsh.engines.dsh >= 0.1.5-rc.1` 硬门槛 → **不合格** |
| **❌ 不合格** | `@zhangfengshun/dsh-remote-ssh@2.4.4`（`^0.1.0-rc.6`）<br>`dsh-remote@0.8.15`（`^0.1.0-rc.6` + `^0.1.2-rc.1`）<br>`dsh-remote-server@0.1.1`（精确 `0.1.0-rc.6`）<br>`dsh-plugin-ssh@0.1.0`（`^0.1.2-rc.1`）<br>`dsh-workspace-enhancement@0.1.4`（`^0.1.5-rc.1`）<br>`dsh-remote-tunnel@0.1.9`（`^0.1.2-alpha.3`）<br>`@hyzyn/dsh-tty@0.17.0`（`^0.1.2-rc.1`）<br>`dsh-ssh-tui@0.6.3`（`>=0.1.2-rc.1`）<br>`dsh-better-sidebar@0.19.1`（`^0.1.5-rc.1`）<br>`@artificialnotimbecile/dsh-remote-runtime@0.1.2`（`=0.1.0-rc.8`）<br>`@infinitepersistence/dsh-serial-console`（`<0.1.0`）<br>`dsh-embedded-workbench@0.8.9`（`^0.1.0-rc.6/rc.8`）<br>`@zseven-w/dsh-android@0.1.0-rc.4`（`^0.1.0-rc.6`）<br>`@hy-sde-org/dsh-dap` + `dsh-tool-debug@0.1.2-rc.1`（`^0.1.2-rc.1`）<br>`@elinpf/dsh-ops`（聚合，子包 `^0.1.0-rc.8`） | 见各行 |
| **❌ 命名空间不兼容** | `@unieai/uad-remote-machine@0.1.21` | 依赖 `@unieai/uad-*` + `@unieai/cordis`，非 `@deepseek-ai/*` |

> **总体判断**：整个第三方 SSH/远程家族**绝大多数在 2026-08~09 间同步跟随了 0.1.0-rc.x / 0.1.2-rc.x / 0.1.5-rc.x 三条更晚的线**，**明确适配 0.1.1-rc.2 的只有 `@captain1275/dsh-ssh`（显式）与 `dsh-remote-ssh`（通配）**。若必须留在 0.1.1-rc.2，选择面很窄；若可升级 DSH 到 0.1.5-rc.x，则 `@zhangfengshun/dsh-remote-ssh`、`dsh-remote`、`dsh-workspace-enhancement`、`dsh-better-sidebar`、`@hyzyn/dsh-tty` 等一大批可用（**推测**：需按各自 peer 线的最高版本对齐）。

---

## 8. 未查到 / 待核项（诚实清单）

1. `dsh-ssh@0.3.0-pre`、`dsh-ssh-tui`、部分包的**仓库 LICENSE 文件内容**未逐字节核验（GitHub API 中途返回 403 限流）；除已明确标注「仓库无 LICENSE 文件」的 `weisiren000/dsh-remote-ssh-ops` 与 `Elinpf/dsh-ops-plugins`（两者 raw LICENSE 均 404，已核实）外，其余仅凭 npm `license` 字段。
2. `dsh-adb@1.7.0`、`dsh-serial@0.1.0`、`@elinpf/dsh-ops-*` 的 npm `repository` 字段为 **null**，无法自动核对源码与 LICENSE 文件；`dsh-adb` **未查到对应 GitHub 仓库**。
3. `dsh-workbench-ecs`、`@elinpf/*` 的**周下载量未查到**（npm 搜索接口未返回其 `downloads.weekly`，且未单独查询下载端点）。
4. `dsh-remote-mod-plugin@0.7.9-mod.1` 的 `dsh.client.inject` 字段未直接读取（推测继承上游 `dsh-remote-plugin`）。
5. `dsh-client-ui-renderer` 在 0.1.1-rc.2 下那处 `require("@deepseek-ai/dsh-client-ui-slots")`（`lib/client.js:14`）在**缺少 slots 包**时的运行时解析行为**未实测**；`dsh.client.inject` 的解析机制（客户端模块加载器如何把 bare specifier 映射到已装包）**未在本次只读调研中验证**。
6. GitHub `api.github.com/search/*` 在调研后段触发 **403 rate limit**，故 GitHub 侧的候选发现（§6.3）**可能不完整**；npm 侧检索相对完整。
7. 各候选「是否 patch DSH 核心」的判定，本次主要依据 `dsh.bundle.patch`（均指向各自的 `cordis.patch.yml`）+ peer 依赖形态**推断**为「通过 bundle patch 层挂载、不修改核心源码」，**未逐个读取其 `cordis.patch.yml` 内容**加以确证（标注为 **推测**）。

---

## 9. 关键来源 URL

**官方包（registry 直查）**
- https://registry.npmjs.org/@deepseek-ai%2Fdsh （元包，20 个版本；0.1.1-rc.2 共 62 deps）
- https://registry.npmjs.org/@deepseek-ai%2Fdsh-client-ui-slots （21 版本，含 0.1.1-rc.2）
- https://registry.npmjs.org/@deepseek-ai%2Fdsh-client-ui-primitives （21 版本，含 0.1.1-rc.2）
- https://registry.npmjs.org/@deepseek-ai%2Fdsh-client-runtime （0.1.0-rc.8 起移除 slots 依赖的版本证据）
- https://registry.npmjs.org/@deepseek-ai%2Fdsh-web-app （8 个抽样版本均无 slots/primitives）

**npm 搜索接口**
- https://registry.npmjs.org/-/v1/search?text=dsh%20ssh ｜ `dsh%20remote` ｜ `dsh%20serial` ｜ `dsh%20embedded` ｜ `dsh%20sftp` ｜ `dsh%20hdc%20harmonyos%20device`
- https://api.npmjs.org/downloads/point/last-week/<name>

**候选仓库**
- https://github.com/caoyiwei850/dsh-ssh-ops ｜ https://github.com/zhu1090093659/dsh-web ｜ https://github.com/CAPTAIN1275/dsh-ui-web
- https://github.com/ZhangFengshun/dsh-remote-ssh ｜ https://github.com/Yan-Zero/dsh-remote-ssh ｜ https://github.com/flymysql/dsh-remote
- https://github.com/DobyChao/dsh-workspace-enhancement ｜ https://github.com/hyzyn/dsh-plugin-kit ｜ https://github.com/techflag/dsh-plugin-ssh
- https://github.com/AmethystLuna/embedded-workbench ｜ https://github.com/hgy043/dsh-serial ｜ https://github.com/LTY-lty666/dsh-serial
- https://github.com/InfinitePersistence/dsh-serial-console ｜ https://github.com/hy-sde/dsh-tool-debug
- https://github.com/1na-ko/dsh-hdc-bridge ｜ https://github.com/Elinpf/dsh-ops-plugins ｜ https://github.com/Blank-not-black/dsh-Remote
- https://github.com/weisiren000/dsh-remote-ssh-ops

**本机产物证据**
- `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-layout/package.json`（slots 仅在 `devDependencies`）
- `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-renderer/lib/client.js` 第 14 行（slots 运行时 `require`）
- `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-runtime/package.json`（0.1.1-rc.2 仅 `immer`+`zustand`）
