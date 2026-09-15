# dsh-workerspace 调研报告：DSH 远程 / Linux SoC 嵌入式工作区插件现状与自研方案

- 调研日期：2026-09-14（本报告所有联网查询与仓库克隆均当日完成）
- 调研方式：web_search 联网检索 + npm/GitHub/PyPI registry 实测 + 12 个候选仓库浅克隆源码级核查 + 本部署（DSH 0.1.1-rc.2）本地只读核查；全部结论注明来源 URL 或仓库文件路径。
- 目标部署：个人 DSH 0.1.1-rc.2（cordis 插件体系：host `defineTool` + client UI + settings namespace），插件装于 `~/.dsh/profiles/node_modules/@deepseek-ai/`，启用入口 `~/.dsh/profiles/web/cordis.patch.yml`。
- 暂名插件：`dsh-workerspace`（面向「远程主机 + Linux SoC 嵌入式开发」的工作区插件）。

---

## 0. TL;DR（结论式摘要）

1. **存在性**：`dsh-workerspace` 这个名字在 npm（404）、GitHub 仓库搜索（0 命中）、全网均不存在，名称可自由使用。**但「DSH 远程主机 SSH 工作区」类插件已高度拥挤**：GitHub 搜 `deepseek harness ssh` 命中 114 个仓库，npm 上已发布至少 7 个相关包（`@dsh-ssh/dsh-ssh`、`dsh-remote`、`dsh-ssh-ops`、`dsh-plugin-ssh`、`dsh-remote-ssh`、`dsh-workspace-enhancement`、`dsh-ssh`(UynajGI) 等）。**「远程主机 + SSH 执行 + 文件传输」不存在需要从零自研的问题，只存在选型问题。**
2. **可移植性（本部署 0.1.1-rc.2）**：
   - **`@dsh-ssh/dsh-ssh@0.1.3`（MIT）peer 完全兼容本部署**：node 22.23.2 ✓（要求 ≥22）、cordis 4.0.2 ✓（^4.0.1）、dsh-* 0.1.1-rc.2 ✓（^0.1.0-rc.6）、schemastery 3.18.2 ✓（^3.18.1）。它是「把 DSH 工作区整体放到远端」的语义最接近者：bash/read/write/edit/glob/grep/read_image 七工具在远端执行、TOFU 主机指纹、后台任务与 sandbox 远端化。`dsh plugin --profile web add @dsh-ssh/dsh-ssh` 可装。
   - **`dsh-remote`（flymysql，74★，MIT，最活跃）**：21 个 `rw_*` 工具 + 镜像同步，npm 0.8.15；但 **0.8.15 硬依赖 dsh-better-sidebar（需 dsh-session ≥ 0.1.2-rc.1）+ 2 个 peer 高于本部署 → 不建议 rc.2 直接用**（可回退 0.5.x 线，或用其 rc.2 适配分支 chai1110/dsh-ssh-remote）。
   - **`dsh-ssh-ops`（caoyiwei850，20★，MIT，npm 0.3.5）**：无 peerDependencies 声明，右侧边栏交互终端（xterm）+ SFTP + 端口转发 + 数据库，凭据直连本部署 `~/.dsh/.credentials.yaml`，TOFU 主机指纹 + 高危命令确认模态；最完整的「运维面板」形态。
   - **`dsh-remote-ssh-ops`（weisiren000，GitHub 分发）**：**API 级兼容 rc.2 已逐项核实**（peer 全 optional 且范围满足；ctx.tools/systemPrompt.section/webServer prefix/client slots/__ModuleLoader__ 在本部署 0.1.1-rc.2 全部存在）；三层架构（plugin/controller/hostd）中仅 plugin 子层触碰 DSH，controller/hostd 纯 Node 可剥离复用；工程防护扎实（托管密钥供给、CAS 锁、指纹锁定、OTP 拒绝、有界输出）+ 28 个测试文件。**但仓库无 LICENSE（fork 前须作者授权）+ host_bash 无确认/白名单闸门**——代码复用受限，架构与行为可参考。
   - 其余（`dsh-workspace-enhancement`、`dsh-plugin-ssh`、`dsh-remote-ssh`(Yan-Zero) 等）peer 要求 ≥ ^0.1.2-rc.1 / ^0.1.5-rc.1，**与本部署不 peer 兼容**，但架构可 port（见 §4 兼容矩阵）。
   - **本部署特有障碍**：`dsh-client-ui-slots`、`dsh-client-ui-primitives` 两个 client 包符号链接悬空（指向已消失的 npx 缓存），npm 有 0.1.1-rc.2 版本可补装——任何带 client UI 注入的插件装前需先恢复。
3. **缺口（需要自研的部分，而非全部）**：DSH 生态里「SoC/嵌入式专属能力」几乎空白——串口 console 仅 2 个 alpha/小项目（peer 不兼容本部署）、交叉编译链封装 0 个、烧录（fastboot/flash 工具语义）0 个。MCP 生态有可补位的候选（`mcp-remote-access`：SSH+串口一体、AGPL；`jlink-mcp`/`openocd-mcp`：烧录调试；`ssh-mcp` 系列）。
4. **自研推荐（二选一，均免造 SSH 轮子）**：
   - **方案 A（推荐）：底座装现成 `@dsh-ssh/dsh-ssh`，自研薄插件 `dsh-workerspace` 只补 SoC 面**——host 侧用 `defineTool` 注册 `ssh_exec` / `ssh_upload` / `ssh_download` / `serial_*` 一组工具；settings 加 `dsh-workerspace` 命名空间（主机清单、命令白名单、串口配置、烧录命令模板）；密钥一律走 `@deepseek-ai/dsh-credentials` 槽（本部署 `~/.dsh/.credentials.yaml`，0600），settings 只存 `credential-ref` 引用，**明文永不进模型上下文/浏览器存储**；产物落盘约定为 `~/.dsh/workerspace/artifacts/<host>/<ts>/` 或会话工作区子目录。
   - **方案 B（最轻）：纯 MCP 组合**——用内置 `dsh-mcp-client` 在 cordis.yml 注册 `mcp-remote-access`（SSH+串口）或 `@yawlabs/ssh-mcp`（SSH 更完善）+ `jlink-mcp`/`openocd-mcp`（本机烧录调试），零插件代码；代价是工具名带 `mcp__` 前缀、凭证经工具参数会进模型上下文、60s 默认超时对烧录需调大、串口只覆盖 MCP 进程本机 USB。
5. **风险要点**：依赖选 ssh2（纯 Node，跨平台）而非系统 ssh 命令；平台差异（远端仅 Linux/macOS，`dsh-ssh` 明确不支持 Windows 远端）；与 dsh-bash-local 无冲突（前者是本机工具，工作区插件是远端工具路由）；权限模型沿用 DSH 现有 sandbox + 用户审批链，需叠加命令白名单/高危确认（参考 dsh-ssh-ops 的确认模态实现）。

---

## 1. 调研方法与证据链

| # | 动作 | 结果 | 来源 |
|---|---|---|---|
| 1 | web_search：DSH 生态远程/SSH/工作区插件 | 命中 dsh-plugins、dsh-workspace-enhancement、dsh-remote-ssh-ops 等 | [dsh-plugins](https://github.com/artemiroshnichenko/dsh-plugins)、[dsh-workspace-enhancement](https://github.com/DobyChao/dsh-workspace-enhancement)、[dsh-remote-ssh-ops](https://github.com/weisiren000/dsh-remote-ssh-ops) |
| 2 | npm registry 实测 `dsh-workerspace` | **404 Not Found** | https://registry.npmjs.org/dsh-workerspace |
| 3 | GitHub 仓库搜索 `dsh-workerspace` / `dsh workerspace` | **0 / 0 命中** | https://api.github.com/search/repositories?q=dsh-workerspace |
| 4 | GitHub 仓库搜索 `deepseek harness ssh` | **114 命中**，含 dsh-remote(74★)、dsh-ssh-ops(20★)、dsh-ssh(7★) 等 | https://api.github.com/search/repositories?q=deepseek+harness+ssh |
| 5 | npm view 批量核验 10+ 个包名（含 peer/deps/engines） | 见 §4 兼容矩阵 | https://www.npmjs.com/package/@dsh-ssh/dsh-ssh 等 |
| 6 | 浅克隆 12 个候选仓库做源码级核查 | 全部成功 | 克隆于 `~/.dsh/.../research-dsh-workerspace/repos/`（见下） |
| 7 | 本部署只读核查（版本、凭据库、cordis 配置、插件范例 dsh-vision-adam） | cordis 4.0.2 / dsh-* 0.1.1-rc.2 / schemastery 3.18.2 / node 22.23.2；凭据库 0600；2 个 client 包悬空 | 见 §4 |
| 8 | web_search：Claude Code / OpenAI Codex 远程执行、嵌入式交叉编译助手、Linux SoC 行业实践 | Seeed 官方 reCamera Pro skill、garycli、soc-agent、Serial-Agent 等 | 见 §3.8 |

克隆的候选仓库（本报告机制级分析的实物依据）：
`/home/CNS2026495165/dsh/.workspace/research-dsh-workerspace/repos/` 下：`dsh-ssh`（org）、`dsh-remote-ssh`（cmukanisa）、`dsh-ssh-remote`（chai1110）、`dsh-remote`（flymysql）、`dsh-remote-ssh-ops`（weisiren000）、`dsh-workspace-enhancement`（DobyChao）、`dsh-plugins`（artemiroshnichenko）、`dsh-remote-workspace`（lengmoXXL）、`dsh-ssh-ops`（caoyiwei850）、`garycli`、`mcp-remote-access`、`MCP-Embedded-Helper`、`Serial-Agent`。

---

## 2. 存在性结论

### 2.1 「dsh-workerspace」名称
- npm：`npm view dsh-workerspace` → **404 Not Found**（2026-09-14 实测）。
- GitHub 仓库搜索：`q=dsh-workerspace` 与 `q=dsh+workerspace` → **均 0 命中**（GitHub API 实测）。
- 全网 web 检索：无任何同名词条。
- 结论：**名称可自由使用**；但注意「work-space 类」命名已被社区占位（`dsh-workspace-enhancement`、`dsh-remote-workspace`、`dsh-coding-workspace`、`dsh-open-workspace`），建议发布前在 npm/GitHub 再查重一次。

### 2.2 生态现状：远程主机类已拥挤，SoC/嵌入式类空白
- **远程主机（SSH 工作区/运维）**：GitHub 114 个仓库、npm ≥7 个已发布包，成熟度从「旗舰作品」到「个人实验」都有（详见 §3、§4）。
- **SoC/嵌入式专属**：
  - 串口 console：npm `@infinitepersistence/dsh-serial-console@0.1.0-alpha.1`（peer 要求 `dsh-tools <0.1.0`，**与本部署冲突**）、`dsh-serial@0.1.0`（pyserial 驱动，无 peer 详情，2026-08 发布）。
  - 交叉编译链封装 / 烧录（fastboot、分区镜像）：**DSH 生态 0 个**。
  - 结论：**「远程主机」不必自研；「SoC 面」必须自研或借道 MCP。**

---

## 3. 现成候选机制级分析

### 3.1 重点候选 1：`@dsh-ssh/dsh-ssh` v0.1.3（推荐底座，语义最接近「远程工作区」）
- 仓库：https://github.com/dsh-ssh/dsh-ssh （org 仓库，7★，MIT，最后推送 2026-08-27；npm：https://www.npmjs.com/package/@dsh-ssh/dsh-ssh ）
- 机制（源码级核验，packages/dsh-ssh/index.js / tools.js / client.js / cordis.patch.yml）：完全基于 DSH 官方公开插件契约构建的**附加型插件**（不改 core 一行、远端零安装、仅需普通 sshd）。
  - host 侧：注册 cordis Service `ctx.sshPool`（SshPool over ssh2，exec + SFTP 复用、maxConnections 默认 4）；settings 命名空间 **`dsh-ssh-hosts`**（增删改 host/port/user/密钥或口令，设置页"测试连接"经官方 Typert 网关）。
  - 工具路由：监听 **`agent/created` 钩子**，仅在会话 cwd 命中远端占位路径（`$DSH_HOME/remote/...`）时，在 **agent 自身作用域注册七工具同名实现**（遮蔽官方同名工具，本地路径回退委托宿主工具）——这是"同名同参、模型无感"的实现方式。
  - 工作区：创建时浏览远端目录树选为工作区，本地放占位目录；workspace 记录删除时联动清理占位目录（domain/changed 订阅）。
  - client 侧：注入官方 settings.section 槽（`ssh-hosts`），**client.js require `@deepseek-ai/dsh-client-ui-primitives`**（Button/Input/图标）→ 本部署装前需先补该包（见 §4.1/§6.8）。
  - 七工具：bash/read/write/edit/read_image/glob/grep 全在远端执行；后台任务整链远端化（run_in_background + job_list/job_output/job_kill）；sandbox 三种模式远端同行为；原子写入（临时文件 + rename）；TOFU 主机指纹 + known_hosts 校验 + 断线自动重连。
  - 凭据：口令经 settings secret 机制只写保存；私钥按本地路径引用。
- 依赖：`ssh2 ^1.17.0`、`diff ^9.0.0`；engine node ≥22；monorepo（pnpm workspace），npm 包 `@dsh-ssh/dsh-ssh`。
- 安全模型：TOFU 主机指纹 + known_hosts；连接信任 = SSH 认证；远端执行权限 = 远端用户权限（无远端沙箱，与同类一致）。
- 已知限制（README 声明）：远端仅 Linux/macOS（**不支持 Windows 远端**）；远端仅需 sshd。
- **本部署适配性：peer 全部满足，可直接安装**（详见 §4）。

### 3.2 重点候选 2：`dsh-remote`（flymysql）与 `dsh-ssh-remote`（chai1110 适配版）
- 仓库：https://github.com/flymysql/dsh-remote （**74★，MIT，npm 0.8.15，最后推送 2026-09-12，生态内最活跃**）；https://github.com/chai1110/dsh-ssh-remote （基于 flymysql/dsh-remote 的 MIT 分支，**明确适配 0.1.1-rc.2**，多机并行）。
- `dsh-remote` 机制：连接 SSH（密钥/口令/agent/keyboard-interactive/proxy jump）→ 选远端工作区 → 以 **21 个 `rw_*` 工具**（rw_edit/rw_stat/rw_mkdir/rw_remove/rw_move/rw_forward 等）操作远端；带冲突感知的镜像同步（rw_sync/rw_push）；**0.8.15 硬依赖 `dsh-better-sidebar@0.18.1`（import SessionLogOffset，需要 dsh-session ≥ 0.1.2-rc.1）**，且 peer 含 dsh-client-locale / dsh-client-ui-renderer ^0.1.2-rc.1 → **0.8.15 不建议直接装在 rc.2**（源码核验判定：peer 越界 + 侧边栏硬依赖有整树 boot 风险）；若要此工具集路线，用 chai1110 适配版或回退 0.5.x 线（其 peer 仍 ^0.1.0-rc.6）。
- `dsh-ssh-remote`（v0.6.0，未发布 npm，GitHub + install.sh 分发）适配 rc.2 的手法（对自研有直接借鉴价值）：
  - **零 peerDependencies**：对 @deepseek-ai/dsh-tools 等裸 import，运行时从 profile node_modules 解析到宿主单例——避开 pnpm 严格 peer 校验（本部署家族版本不匹配也不拦截）。
  - install.sh 把官方 agent-presets 复制进 `~/.dsh/.agent-presets/<模式>/` 再追加插件行（first-root-wins），并 symlink 进 `~/.dsh/profiles/web/node_modules/`。
  - **多机并行**：`pools = Map<id, {machine, pool}>`，每台机器独立 `SshPool`（单 ssh2 client 复用 exec/SFTP）；全部 `rw_*` 工具带 `machineId` 参数、缺省回退 current 机；`rw_switch/rw_disconnect/rw_info`；**无多跳链**（仅解析 ~/.ssh/config 的 ProxyJump 填表单）。
  - **安全最弱（不可照抄）**：密码**明文存 machines.json**；`rw_connect` 把 password/privateKeyPath **作为模型工具参数**传递（凭据进模型上下文/会话日志，违反 §5 安全红线）；无审批门、无沙箱围栏；有 TOFU。维护状态已标注暂停、**零测试**。
- 本部署适配性：`dsh-ssh-remote` 按作者声明适用 rc.2（零 peer + 裸名解析）；`dsh-remote` 0.8.15 不适用（见上）。

### 3.3 重点候选 3：`dsh-ssh-ops`（caoyiwei850）
- 仓库：https://github.com/caoyiwei850/dsh-ssh-ops （**20★，MIT，npm 0.3.5，2026-09-13 最后推送，几乎每日更新**）
- 机制：host 半用 ssh2 管会话（连接池 + keepalive 20s/3 次 + 指数退避重连 + 断线重试）；client 半注入官方右侧边栏（xterm 交互终端 + SFTP 文件管理 + 端口转发 + 数据库面板）。主对话驱动：`ssh_exec` 继承交互 shell 当前目录，命令回显到右侧终端。
- 能力面：SSH 6 工具（ssh_list/connect/exec/read/write/disconnect）+ SFTP 6 + 隧道 + 批量（ssh_batch 勾选确认）+ 数据库 11（MySQL/PG/Redis/Mongo，词法级只读闸 + 高危 SQL 拦截）；ProxyJump 链 ≤8 跳；共享凭据；**TOFU 主机指纹**（accept-new/verify/off 三档）；**高危命令确认模态**（删除/删库/格式化/terraform destroy 等入队待确认，人工点击执行）；输出脱敏（私钥/Bearer/API Key/口令）；凭据存 `~/.dsh/.credentials.yaml`（owner-only），浏览器存储与模型上下文均不见明文。
- 依赖：ssh2 + pg/redis/mysql2/mongodb/zod；**无 peerDependencies 声明**（自带完整前端注入）。
- 安全模型：DSH 权限机制之上叠加黑名单 + 一次一密确认模态 + 凭据库引用 + TOFU。
- 本部署适配性：无 peer 约束；注入官方 sidebarRightTabs（rc.2 有该槽，README 明示旧版自动回退浮动面板）→ **大概率可装，需实测**（装前需补 `dsh-client-ui-primitives` 等缺失 client 包，见 §4）。
- 注意：它是「运维面板」形态，不是「工作区透明路由」形态——与 `@dsh-ssh/dsh-ssh` 互补而非互斥。

### 3.4 其余候选一览（机制要点 + 适配性）

| 项目 | 仓库/npm | 许可 | 形态 | 机制要点 | 本部署适配 |
|---|---|---|---|---|---|
| dsh-remote-ssh-ops（weisiren000） | https://github.com/weisiren000/dsh-remote-ssh-ops | **无 LICENSE 文件**（默认 all-rights-reserved，fork 前须向作者确认授权） | 运维插件（三层：plugin/controller/hostd） | 仅 ssh2@1.17 运行时依赖（纯 JS）；每主机持久会话 + keepalive + 退避重连；host_bash 前台/后台（接 DSH jobs）；**SFTP only（无 scp）+ CAS 锁 + 原子写 + 10MiB/文件上限**；版本化条件写 + 变更审阅；**托管密钥供给**（自动生成 ed25519 装公钥、移除时回滚，私钥 `~/.dsh/remote-ssh-ops/keys/<hostId>.key` 0600，仅 controller 进程读盘）；keyboard-interactive 密码 + **OTP/MFA 一律拒绝**；JumpServer 仅降级支持（无 ProxyJump 级联）；hostd 为可选远端守护（配对码 8 字符 TTL + device token + 工作区路径越狱，非回环强制 TLS）；输出三档截断；28 个测试文件 ~4900 行（node:test）；**API 级兼容 rc.2 已逐项核实**（ctx.tools/systemPrompt.section/webServer prefix/slots/__ModuleLoader__ 均存在于本部署 0.1.1-rc.2） | peer 全 optional 且范围满足 → **✅ 可装**；但：无 LICENSE 不可直接 fork 代码（可剥离 controller/hostd 纯 Node 层参考，仅 plugin 层触碰 DSH）；**host_bash 无逐命令确认/白名单**（最大信任缺口，靠 systemPrompt 约束）；无 ProxyJump；10MiB 文件上限 |
| dsh-workspace-enhancement（DobyChao） | https://github.com/DobyChao/dsh-workspace-enhancement · npm 0.1.4 | MIT | 工作区增强 | fork dsh-ssh + merge dsh-remote（ADR-0002）；**接缝引擎路线**：ctx.subprocess/ctx.fs 换成 Mixed* 实现，按 cwd 前缀 `ssh://<id>/` 路由远端（本地大脑、远端手脚，远端零装 DSH）；单连接多跳 ProxyJump + 逐跳 TOFU；**ctx.approval 审批门**（off/human/ai 三态，AI 白名单只读自动放权）；**bwrap 远端沙箱 runner**（read-only/workspace-write，fail-closed，SFTP 写面除外）；OS 钥匙串存密钥 + **凭据红线：密钥永不进模型工具参数**；side workspace（薄声明清单，权限语义已退役）；34 测试文件/471 用例/8 E2E + 三流水线 CI；文档极全（23 个 ADR） | peer 13 项全系 ^0.1.5-rc.1 + client 槽位面向 0.1.5（61 槽，rc.2 为 52 槽）→ **不兼容 rc.2，需 backport**；但 npm 曾发布过面向 rc.2 家族的 0.1.1 版（deps dsh-fs ^0.1.0-rc.6 等）——**backport 有界且曾被证明可跑**；**架构与安全模型是三候选中最值得作母体的** |
| dsh-remote-ssh（Yan-Zero） | npm 0.2.4（Apache-2.0） | Apache-2.0 | 透明工作区 | 基于 @microsoft/agent-host-protocol；替换 fs/spill/subprocess 等 seam 实现透明本地/远端 | peer 多为 `*`，cordis ^4.0.1-rc.1 ✓ → **peer 上可装**，未实测 |
| dsh-remote-ssh（cmukanisa） | https://github.com/cmukanisa/dsh-remote-ssh | MIT | 工作区 | v0.3.0（private，未发 npm，install.sh 分发）；**seam 路由**（ctx.fs/ctx.shell/ctx.subprocess 路由器，本地路径保持原 provider）；**依赖系统 ssh + ControlMaster 复用连接**（非 ssh2）；多服务器同时连接、连接跨会话共享、Settings→Plugins 开关；三语文档 + SECURITY.md + Docker e2e 测试 | node ≥22.19 ✓；未发布 npm，需 install.sh；依赖系统 ssh（Windows 注意）；需实测 |
| dsh-ssh（UynajGI） | npm 0.3.0-pre（MIT） | MIT | 远程执行 | ProxyJump 链 + SFTP 文件系统 + subprocess/PTY over ssh2；**注意与 org 版同名异主** | peer ^0.1.0-rc.6 → **兼容 rc.2**；pre-release |
| dsh-plugin-ssh（techflag） | npm 0.1.0（MIT） | MIT | SSH/SFTP 工作区 | 多主机终端、文件传输与编辑、复用宿主模型 AI 命令助手 | peer ^0.1.2-rc.1 → **不兼容 rc.2** |
| dsh-remote-workspace（lengmoXXL） | https://github.com/lengmoXXL/dsh-remote-workspace | MIT | 工作区（Rust agent） | 远端自安装静态 Rust 单二进制（linux/darwin × x86_64/aarch64），随机 loopback 端口 + token 认证，ssh -L 隧道，JSON-RPC 2.0；seam 替换（fs/subprocess/shell） | `private` 未发布；peer ^0.1.5-rc.1 + 缺 2 client 包 → **需移植**；SoC 瘦设备友好但缺 armv7/riscv64 |
| dsh-remote-workspace（GooDAnDReaDY 变体） | https://github.com/GooDAnDReaDY/dsh-remote-workspace | MIT | 工作区（企业版变体） | SSH + SFTP 同步 + 隧道 | 未发布；0★ |
| dsh-plugins / dsh-ssh（artemiroshnichenko） | https://github.com/artemiroshnichenko/dsh-plugins | MIT | 远程 agent 执行（ACP 桥） | 远端**预装完整 DSH**，经 `ssh host dsh --profile acp` + ACP JSON-RPC 桥接；本地 AgentLoop 按 cwd 路由远端/本地；审批中继到本地浏览器 | 未发布 npm；peer ^0.1.0-rc.6 + cordis ^4.0.0 ✓（rc.2 需 override 实测）；**远端需完整 node 运行时，对 SoC 不现实** |
| dsh-server-deck（meyaomiao） | https://github.com/meyaomiao/dsh-server-deck | ? | 服务器卡片仪表盘 | 状态卡片 + 一键 xterm | 4★，未细核 |

### 3.5 MCP 路线候选（经内置 dsh-mcp-client 直连，零插件代码）
- 判定基准：`@deepseek-ai/dsh-mcp-client` 内置，每个 server 一个插件实例（transport: stdio/streamable-http），工具以 `mcp__<serverName>__<rawName>` 暴露；仅桥接 Tools；`toolCallTimeoutMs` 默认 60s；`env` 需显式注入（如 SSH_AUTH_SOCK）。
- **`mcp-remote-access`（RFingAdam）**：https://github.com/RFingAdam/mcp-remote-access — **唯一同时覆盖 SSH（exec/后台/SFTP）+ 串口（expect/AT/二进制/DTR-RTS 复位/ESP32 引导）** 的单服务器，26 工具，Python（paramiko+pyserial，不依赖系统 ssh 命令），纯 stdio，dsh 可直接接入零改动。**AGPL-3.0-or-later**（服务端分发有传染性考量）；AutoAddPolicy（信任未知 host key）无白名单；1★。
- **`@yawlabs/ssh-mcp`**：https://github.com/YawLabs/ssh-mcp （npm 0.15.3，MIT，Node+ssh2）— 21 工具：ssh_exec/ssh_multi_exec + SFTP 全家 + find/tail/service_status；连接池 60s TTL；ProxyJump + ~/.ssh/config；白名单/黑名单仅覆盖 exec（SFTP 写不受门控，README 明示）；单测+Docker 集成测试，成熟度较高。
- **`jlink-mcp`**（https://github.com/Klievan/jlink-mcp ，30★，MIT，npm）：47 工具，flash/halt/断点/寄存器/RTT 日志流/diagnose_crash（Cortex-M fault 解码），**真实 nRF52840-DK 硬件 HIL CI**；适合本机探针烧录调试。
- **`openocd-mcp`**（https://github.com/microhenrio/openocd-mcp ，4★，MIT）：~33 工具，含 `set_permissions`（只读模式、flash-erase 门控、路径/大小限制）——权限门设计值得借鉴。
- **`Serial-Agent`**（https://github.com/Rance-OwO/Serial-Agent ，40★，MIT）：VS Code 扩展 + MCP Bridge（127.0.0.1 + token），串口 9 工具 + Keil/JLink/ST-Link/OpenOCD 烧录 5 工具；**绑定 Windows/Keil/MCU 场景，与 Linux SoC 方向错位**，但「编译/烧录→串口日志→自动分析」闭环是 SoC 工作流的样板。
- 远程交叉编译 MCP 范式：`kernel-build-mcp`（https://github.com/arttttt/kernel-build-mcp ，0★、**无许可证文件不可复用**）给出现成模式——MCP 部署在远程构建机，客户端 `command: ssh, args:[host, python3, -m, kernel_build_mcp]`（stdio-over-SSH 桥接），与 dsh-mcp-client 完全兼容；**只能借鉴架构，需自研**。

### 3.6 通用 AI 助手生态与 Linux SoC 行业实践（背景与可借鉴范式）
- **Claude Code / Codex**：无官方内置 SSH 工具；远程/嵌入式能力靠 MCP（如 EricGrill/mcp-multi-agent-ssh「Stateful SSH connections for Claude Code via MCP」、ZuhaadRathore/ssh-mcp）+ skills（[Seeed 官方「Develop reCamera Pro Applications with AI Coding Agents」](https://wiki.seeedstudio.com/recamera_pro_development_cpp_skill/)：reCamera Pro 是 Rockchip Linux SoC 摄像头模组，官方提供 **C++ 应用模板 + skill（指令/脚本/技术参考打包）** 给 AI 编码代理做交叉编译开发——「skill + 模板 + 交叉编译链」是厂商采纳的 SoC 工作流范式；DSH 同样内置 dsh-skill/dsh-skill-filesystem，可照搬）。
- **garycli**（https://github.com/garycli/garycli ）：AI 原生嵌入式工程代理（Python CLI）：需求→代码→构建→烧录→运行时验证→诊断修复；覆盖 ESP/CANMV/RP2040/MicroPython、SWD/UART-ISP/串口监视、Keil/IAR/CMake/PlatformIO 工具链。非 DSH 插件，但印证「嵌入式全链代理」是成熟需求方向，其 hardware/ 模块（swd.py、uart_isp.py、serial_mon.py）可作工具设计参考。
- **llm-net/soc-agent**（https://github.com/llm-net/soc-agent ，MIT）：部署在 ARM 设备上的 AI API 网关 + Codex/Claude Code/Cursor 开发工具接入——「在 SoC 板子上跑开发工具」的对偶思路（与「从 PC 连 SoC」互补），非工作区插件。
- **embed-ai-tool**（LeoKemp223）：https://github.com/leokemp223/embed-ai-tool — 面向 AI 编程助手的嵌入式开发技能集：多工具链构建（Keil/IAR/CMake/PlatformIO）+ 烧录 + GDB + 串口监视 + Modbus/CAN/VISA 协议调试 + 流水线编排，三平台。**「技能集」形态 = skills 目录 + 脚本**，与 DSH skill 体系亲和。

---

## 4. 本部署（0.1.1-rc.2）插件范式与兼容性矩阵

### 4.1 本地核查事实
- 核心版本（`~/.dsh/profiles/node_modules/@deepseek-ai/` 实测）：cordis **4.0.2**、dsh-tools / dsh-settings / dsh-credentials / dsh-fs / dsh-subprocess / dsh-sandbox / dsh-llm / dsh-session / dsh-agent / dsh-host-webserver / dsh-commands / dsh-client-locale / dsh-client-ui-renderer / dsh-system-prompt 等全部 **0.1.1-rc.2**、schemastery **3.18.2**；node **v22.23.2**；内置 `dsh-mcp-client`（stdio/streamable-http 双 transport）。
- 插件启用方式：`~/.dsh/profiles/web/cordis.yml` 为空数组，`cordis.patch.yml` 以 `- insert: {id, name}` 追加插件行（如 vision-adam、taste、btw、wallpaper、usage、session-status-board）；CLI `dsh plugin --profile web add <pkg>` 可用（转发给 pnpm）。
- 插件开发范式（本部署既有范例 `dsh-vision-adam`，v0.2.0，MIT）：
  - 包结构：`package.json`（peer: `@deepseek-ai/cordis ^4.0.1`、`dsh-tools/dsh-credentials/dsh-launch-environment/dsh-settings/dsh-fs ^0.1.0-rc.7`、`@deepseek-ai/schemastery ^3.18.1`）+ `lib/index.js`。
  - 工具注册：`import { defineTool } from "@deepseek-ai/dsh-tools"`；settings：`import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings"`；凭据：`import { credentialRef } from "@deepseek-ai/dsh-credentials"`；schema：schemastery `z.object({...})`，敏感字段 `.role("secret")`、环境引用 `.role("credential-ref")`。
  - 凭据库：`~/.dsh/.credentials.yaml`（**0600**，owner-only），结构为 version/refs/records——settings 里只存引用，值由 dsh-credentials-local 解析，**明文不进模型上下文**。这正是「密钥引用方式」的官方答案。
- **本部署特有缺口**：`dsh-client-ui-slots`、`dsh-client-ui-primitives` 两个包的符号链接**悬空**（指向已消失的 npx 缓存，bundled dsh 与缓存内均无原件）→ 任何注入 client UI 且 import 这两个包的插件装前需先补装 npm 上对应的 `0.1.1-rc.2` 版本。

### 4.2 兼容性矩阵（peer 级判定，npm 严格 semver）

| 候选（npm 版本） | cordis | dsh-tools | 其他关键 peer | 本部署 peer 判定 |
|---|---|---|---|---|
| **@dsh-ssh/dsh-ssh 0.1.3** | ^4.0.1 ✓ | ^0.1.0-rc.6 ✓ | dsh-fs/dsh-sandbox/dsh-settings/dsh-shell/dsh-typert-protocol ^0.1.0-rc.6 ✓；dsh-client-ui-primitives ^0.1.0-rc.6（⚠ 需补装）| **✅ 直接可装** |
| dsh-remote 0.8.15 | ^4.0.1 ✓ | ^0.1.0-rc.6 ✓ | dsh-commands rc.6 ✓；**dsh-client-locale/dsh-client-ui-renderer ^0.1.2-rc.1 ✗**；**硬依赖 dsh-better-sidebar@0.18.1（需 dsh-session≥0.1.2-rc.1）✗** | ❌ 需 0.1.2-rc.1+ 或回退 0.5.x 线；非 fork 基础 |
| dsh-ssh-ops 0.3.5 | 无 peer 声明 | 无 peer 声明 | 注入官方 sidebar 槽（rc.2 存在） | ⚠️ 大概率可装，需实测 |
| dsh-ssh-remote（chai1110） | **零 peer 依赖**（裸 import 解析宿主单例） | — | 按作者声明适配 0.1.1-rc.2 | ✅ 按作者声明适配（安全弱、零测试） |
| dsh-remote-ssh 0.2.4（Yan-Zero） | ^4.0.1-rc.1 ✓ | `*` ✓ | 其余 peer 全 `*` ✓ | ✅ peer 可装，未实测 |
| dsh-ssh 0.3.0-pre（UynajGI） | ^4.0.1 ✓ | ^0.1.0-rc.6 ✓ | — | ✅ peer 兼容（pre-release） |
| dsh-workspace-enhancement 0.1.4 | ^4.0.2 ✓ | **^0.1.5-rc.1 ✗** | dsh-fs 等全系 ^0.1.5-rc.1 ✗；schemastery ^3.18.2 ✓ | ❌ 需降 peer 移植 |
| dsh-plugin-ssh 0.1.0 | ^4.0.2 ✓ | **^0.1.2-rc.1 ✗** | dsh-client-connection/dsh-host-webserver/dsh-llm/dsh-session ^0.1.2-rc.1 ✗ | ❌ 需移植 |
| dsh-remote-ssh-ops（weisiren000，GitHub 分发） | ^4.0.1 ✓ | ^0.1.0-rc.6 ✓（peer 全 optional） | schemastery ^3.18.1 ✓；react ^18.2.0 ✓；client 注入含 dsh-client-ui-primitives（⚠ 需补装） | ✅ **API 级兼容已核实**（无 LICENSE 限制代码复用） |
| @infinitepersistence/dsh-serial-console 0.1.0-alpha.1 | ^4.0.1 ✓ | **<0.1.0 ✗**（本部署 0.1.1-rc.2 越界） | react ^18.2.0 | ❌ alpha + peer 越界，仅可借鉴 |

注：peer 满足 ≠ 运行期一定通过；0.1.1-rc.2 与 rc.6/rc.7 属近邻版本，运行期差异小但未逐个实测（列为装后验证项）。

---

## 5. 自研方案建议（最小可用）

### 5.1 方案 A（推荐）：现成底座 + 薄 SoC 插件
**底座**：`dsh plugin --profile web add @dsh-ssh/dsh-ssh`（先补装 `dsh-client-ui-primitives@0.1.1-rc.2` 等缺失 client 包），获得「远程主机登记 + 远端工作区 + 七工具远端执行 + TOFU + 后台任务远端化」——覆盖需求清单里的：远程主机登记（host:user:key）、SSH 执行、远程文件读写。**不重复造轮子。**

底座备选路线（按需升级）：
- 若要「审批门 + 远端沙箱 + 密钥红线」的更强安全语义，备选底座 = **dsh-workspace-enhancement 的 backport**（0.1.5→0.1.1-rc.2：把 13 项 peer 改回 rc.2 家族、裁掉 readByteRange 等 0.1.5 增量、client 槽位 61→52 映射；npm 曾发布过面向 rc.2 的 0.1.1 版，证明该线在 rc.2 跑通过；34 测试文件/471 用例可作回归基线）。
- 若只求最快演示：`dsh-ssh-remote`（chai1110）零 peer 直装 rc.2，但**密码明文 + 凭据进模型参数 + 无审批门**，仅限非生产试用。

**自研 `dsh-workerspace`（薄，仅 SoC 面）**，完全按 §4.1 的官方范式：
- **host defineTool 工具面（最小集，6 个）**：
  1. `ws_upload`（本地→远端 scp/sftp 等价，ssh2 内实现）：推送固件/内核/dtb/应用。
  2. `ws_download`（远端→本地）：拉取产物/日志。
  3. `ws_serial_open/ws_serial_send/ws_serial_read`（串口控制台：列出端口、收发、expect 等待字符串；本地 USB 串口，Linux 用 pyserial 等价库 `serialport`/`serialport-stream` 或系统 `picocom` 子进程两种后端可切换）。
  4. `ws_flash`（烧录命令模板执行：fastboot / rkdeveloptool / uuu / dd / 厂商 CLI，命令模板来自 settings 白名单，实际命令在确认模态后执行）。
  - 交叉编译：不封装工具链，直接复用 `@dsh-ssh/dsh-ssh` 的远端 bash 在构建机/目标机跑 make + `ws_upload/download` 取产物——**最小可用即「远端 bash + 上传下载」**。
- **settings 键（命名空间 `dsh-workerspace`，schemastery schema）**：
  - `hosts`：数组 `{ id, name, host, port, user, keyRef(credential-ref), jumpHost? }`——**主机清单放 settings 层（~/.dsh/settings.yaml），密钥不落地 settings**。
  - `serial.port`、`serial.baudRate`（默认 115200）、`serial.logDir`（串口日志落盘目录，默认 `~/.dsh/workerspace/serial/`）。
  - `flash.templates`：白名单命令模板数组（如 `fastboot flash boot {{boot}}`、`rkdeveloptool wl 64 {{idbloader}}`），占位符只接受来自 ws_upload 的产物路径。
  - `artifacts.dir`：产物落盘目录（默认 `~/.dsh/workerspace/artifacts/`，可指向会话工作区子目录）。
  - `security.confirmDangerous`（默认 true）、`security.commandAllowlist`。
- **密钥引用方式（本部署官方答案）**：一律经 `@deepseek-ai/dsh-credentials` 槽——`keyRef` 是 `credential-ref`（如 `SSH_KEY_<HOST>` 指向 `~/.dsh/.credentials.yaml` 的 records 条目），解析后的密钥**只存在于 host 进程内**，不写 settings、不进浏览器存储、不进模型上下文；私钥文件路径方式也可（`@dsh-ssh/dsh-ssh` 采用）。不要自己发明密钥存储。
- **产物落盘**：`ws_upload/download` 与 `ws_flash` 的日志、串口抓包统一落 `~/.dsh/workerspace/`（或 settings.artifacts.dir），并在工具返回里给绝对路径，方便后续文件工具引用。
- **client UI（最小）**：设置页「SSH/SoC 资源」表单（复用官方 settings 渲染，installSettingsSection 自动出现）+ 可选串口控制台面板（xterm，参考 `@infinitepersistence/dsh-serial-console` 的「user/AI 共享串口」设计）；MVP 可以只有 host 侧工具、无 client 注入。
- **安全边界（必须）**：
  - 命令白名单 + 占位符强校验（`flash.templates` 只允许模板内命令；串口 `ws_flash` 执行前弹确认模态——复用 dsh-ssh-ops 的「高危入队待确认」模式）。
  - 密钥零泄露：任何工具返回/日志/错误信息里对私钥、口令做脱敏（参考 dsh-ssh-ops 的脱敏实现）；工具 schema 里 secret 字段 `.role("secret")` 且不回显。
  - TOFU 主机指纹（复用 @dsh-ssh/dsh-ssh 的实现而非重写）。
  - 沿用 DSH sandbox 权限模型：远端执行不逃逸本地沙箱；远端权限 = 远端用户权限，settings 里提示用户用最小权限账号。

### 5.2 方案 B（最轻）：纯 MCP 组合（零插件代码）
`~/.dsh/profiles/web/cordis.patch.yml` 加三个 insert（dsh-mcp-client 实例）：
```yaml
- insert:
    - id: mcp-ssh-serial
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: ssh
        transport: stdio
        command: uvx
        args: ['--from', 'git+https://github.com/RFingAdam/mcp-remote-access', 'mcp-remote-access']
        toolCallTimeoutMs: 120000
```
（SSH 用 @yawlabs/ssh-mcp 更完善；烧录调试用 jlink-mcp/openocd-mcp；远程构建借用 kernel-build-mcp 的 `command: ssh ...` 桥接范式。）
- 优点：零开发、走官方通道、HMR 热换。
- 代价：工具名 `mcp__ssh__*` 前缀；凭证走工具参数会**进模型上下文**（除非 server 支持环境/配置文件读凭据）；60s 默认超时对烧录不够（需逐 server 调大）；串口仅覆盖 MCP 进程本机 USB；模型需自行编排多 server；无「工作区」语义（MCP 工具不感知 DSH 会话工作区/沙箱）。

### 5.3 方案对比

| 维度 | A：底座 + 薄插件 | B：纯 MCP |
|---|---|---|
| 开发量 | 中（1 个薄插件） | 0（配置即用） |
| 工作区语义（远端 cwd/sandbox/后台任务） | ✅ 继承 @dsh-ssh/dsh-ssh | ❌ 无 |
| 密钥管理 | ✅ 官方 credentials 槽 | ⚠️ 凭据经工具参数入模型上下文 |
| SoC 串口/烧录 | ✅ 自研工具（白名单+确认） | ⚠️ 借 MCP server，权限面受制于人 |
| 品牌/可维护性 | ✅ 自己的插件，可发 npm | 依赖第三方 server 存活 |
| 推荐 | **推荐**（若接受 ~1-2 天开发量） | 过渡期/验证需求时先用 |

---

## 6. 风险与边界

1. **依赖选型**：DSH 生态多数成熟候选（@dsh-ssh/dsh-ssh、dsh-remote、dsh-ssh-ops）均用 **ssh2（纯 Node 库）**，跨平台、无系统命令依赖；**例外是 cmukanisa/dsh-remote-ssh 用系统 `ssh` + ControlMaster**（依赖本机 ssh 客户端存在、Windows 行为差异）。自研推荐 ssh2（与底座一致）；串口侧 `serialport`（node-serialport）是纯 Node 事实标准，也可用 pyserial 子进程（dsh-serial 的做法）作轻量替代。不推荐走系统 `ssh/scp` 子进程（引号转义、密钥代理、Windows 差异都是坑）。
2. **平台差异**：@dsh-ssh/dsh-ssh 明确**不支持 Windows 远端**（Linux/macOS 远端才可用）；本机侧 macOS/Linux/Windows 均可（ssh2 纯 JS）。若目标 SoC 是 Linux（大部分情况）无碍；烧录工具（fastboot/rkdeveloptool/uuu）是厂商 CLI，必须按目标 SoC 验证。
3. **与既有工具重叠**：`dsh-bash-local`/`dsh-tool-bash` 是本机执行，与远端工作区插件**不冲突**（dsh-ssh 是工具路由到远端，本地工具仍在）；注意**不要**在自研插件里再注册同名 `bash`/`ssh_exec` 之类工具造成模型歧义——自研工具一律用 `ws_` 前缀。
4. **权限模型**：DSH 的 sandbox/审批链对远端执行**不直接覆盖**（远端是另一个用户态）；必须自建：命令白名单 + 高危确认模态 + TOFU + 输出脱敏。参考 dsh-ssh-ops 的安全实现（确认模态、黑名单动词识别、凭据库引用）作为基线。
5. **许可证**：`dsh-remote-ssh-ops`（weisiren000）**无 LICENSE 文件**——默认保留所有权利，**不得 fork/复制其代码**，只能参考行为；`kernel-build-mcp` 同无许可不可复用；其余主要候选 MIT/Apache-2.0（dsh-remote-ssh Yan-Zero 版 Apache-2.0），fork 无障碍。`mcp-remote-access` 为 AGPL-3.0（若经其衍生分发需注意传染性）。
6. **npm 名称占用**：`dsh-ssh`（UynajGI）、`dsh-plugins`（MeCKodo）、`dsh-remote`（flymysql）等已被占用；`dsh-workerspace` 当前空闲，但发布前需复查 npm + GitHub。
7. **版本漂移**：DSH 官方迭代快（0.1.1-rc.2 → 0.1.2-rc.1 → 0.1.5-rc.1 已在 npm），社区插件多锁定特定 rc；自研插件 peer 应写宽（如 `^0.1.0-rc.6`）并跟随官方升级测试。
8. **client 包缺失**：本部署 `dsh-client-ui-slots`/`dsh-client-ui-primitives` 悬空，装任何带 client 注入的插件前先补 `@deepseek-ai/dsh-client-ui-slots@0.1.1-rc.2`、`@deepseek-ai/dsh-client-ui-primitives@0.1.1-rc.2`，否则 client 侧 import 失败。
9. **超时与长任务**：烧录/串口等待类工具默认 60s 超时不够（dsh-mcp-client 的 toolCallTimeoutMs 可调；自研工具用 dsh-timeout 或显式长超时参数）。
10. **安全红线**：任何设计下，私钥/口令**不得**出现在模型上下文、工具结果、日志、settings 明文里；只经 credentials 槽或本地文件路径引用。

---

## 7. 结论

- **有无现成可移植**：有。`@dsh-ssh/dsh-ssh@0.1.3`（MIT）与本部署 0.1.1-rc.2 **peer 完全兼容**，是「远程主机工作区」语义的最直接可移植现成品；`dsh-ssh-remote`（chai1110）明确适配 0.1.1-rc.2；`dsh-ssh-ops`（20★，运维面板 + 终端 UI）与 `dsh-remote`（74★，rw_* 工具）经 override/实测后大概率可用。**「远程主机 + SSH 执行 + 文件传输」不需要自研。**
- **需要自研的只有 SoC 面**：串口控制台、交叉编译产物流转、烧录（fastboot/厂商 CLI）在 DSH 生态无现成插件。
- **推荐自研方案**：方案 A——装 `@dsh-ssh/dsh-ssh` 做底座，自研薄插件 `dsh-workerspace`（host 侧 `defineTool` 注册 `ws_upload/ws_download/ws_serial_*/ws_flash` + settings 命名空间 `dsh-workerspace` + 密钥经 `dsh-credentials` 槽引用 `~/.dsh/.credentials.yaml` + 产物落盘 `~/.dsh/workerspace/` + 命令白名单/确认模态/TOFU/脱敏），按官方 `dsh-vision-adam` 范例的组织方式实现；或先以方案 B（内置 dsh-mcp-client + mcp-remote-access/ssh-mcp）快速验证需求再转 A。
- **最小功能面（MVP 判定线）**：远程主机登记（host:user:keyRef）→ 远端 bash 执行（继承底座）→ `ws_upload`/`ws_download`（ssh2 SFTP）→ 串口收发 + 日志落盘 → `ws_flash` 白名单模板 + 确认执行。满足即达到「远程主机 + Linux SoC 嵌入式开发工作区」的最小闭环。

---

## 附录 A：来源 URL 全集

**DSH 生态插件（远程/SSH/工作区）**
- https://github.com/dsh-ssh/dsh-ssh · https://www.npmjs.com/package/@dsh-ssh/dsh-ssh
- https://github.com/flymysql/dsh-remote · https://www.npmjs.com/package/dsh-remote
- https://github.com/chai1110/dsh-ssh-remote
- https://github.com/caoyiwei850/dsh-ssh-ops · https://www.npmjs.com/package/dsh-ssh-ops
- https://github.com/weisiren000/dsh-remote-ssh-ops
- https://github.com/DobyChao/dsh-workspace-enhancement · https://www.npmjs.com/package/dsh-workspace-enhancement
- https://github.com/cmukanisa/dsh-remote-ssh
- https://www.npmjs.com/package/dsh-remote-ssh （Yan-Zero 版，Apache-2.0）
- https://github.com/artemiroshnichenko/dsh-plugins
- https://github.com/lengmoXXL/dsh-remote-workspace · https://github.com/GooDAnDReaDY/dsh-remote-workspace
- https://github.com/UynajGI/dsh-ssh · https://www.npmjs.com/package/dsh-ssh
- https://github.com/techflag/dsh-plugin-ssh · https://www.npmjs.com/package/dsh-plugin-ssh
- https://github.com/meyaomiao/dsh-server-deck · https://github.com/Xingkong42/dsh-open-workspace · https://github.com/Aealen/dsh-coding-workspace
- npm 串口/SoC 类：https://www.npmjs.com/package/@infinitepersistence/dsh-serial-console 、https://www.npmjs.com/package/dsh-serial 、https://www.npmjs.com/package/@yin52133/dsh-luban-win-debug
- DSH 插件市场：https://www.npmjs.com/package/dshmarket

**MCP 生态（SSH/串口/嵌入式）**
- https://github.com/RFingAdam/mcp-remote-access （AGPL-3.0）
- https://github.com/YawLabs/ssh-mcp · https://www.npmjs.com/package/@yawlabs/ssh-mcp
- https://github.com/slepp/ssh-mcp · https://pypi.org/project/slepp-ssh-mcp/
- https://github.com/NikolaNddTesla/ssh-mcp-server · https://www.npmjs.com/package/@nl4ever/sshmcp
- https://www.npmjs.com/package/@davidfei/ssh-mcp · https://gitlab.com/davidfei1971/ssh-mcp
- https://github.com/EricGrill/mcp-multi-agent-ssh · https://github.com/ZuhaadRathore/ssh-mcp
- https://github.com/Klievan/jlink-mcp · https://github.com/microhenrio/openocd-mcp
- https://github.com/arttttt/kernel-build-mcp
- https://github.com/w4ysonch/MCP-Embedded-Helper · https://pypi.org/project/mcp-embedded-helper/
- https://github.com/Rance-OwO/Serial-Agent · https://www.npmjs.com/package/@ranceowo/serial-agent-mcp

**通用 AI 助手 / Linux SoC 行业实践**
- https://wiki.seeedstudio.com/recamera_pro_development_cpp_skill/ （Seeed reCamera Pro + AI 编码代理）
- https://github.com/garycli/garycli
- https://github.com/llm-net/soc-agent
- https://github.com/leokemp223/embed-ai-tool
- https://github.com/deepseek-ai/DeepSeek-Harness/blob/master/docs/cookbook/adding-a-tool.md （官方工具开发参考）
- https://github.com/deepseek-ai/deepseek-harness/discussions/5317 （dsh-remote：手机远程控制，同名异义，注意区分）

**本报告衍生文件**
- MCP 生态子报告：`/home/CNS2026495165/dsh/.workspace/research-dsh-workerspace/mcp-ecosystem-report.md`
- 克隆仓库目录：`/home/CNS2026495165/dsh/.workspace/research-dsh-workerspace/repos/`

（本报告由联网检索 + npm/GitHub/PyPI registry 实测 + 12 个仓库源码级核查 + 本部署只读核查得出；peer 兼容判定基于 npm 严格 semver，运行期兼容列为装后验证项。）
