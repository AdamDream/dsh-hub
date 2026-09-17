# 功能地图 —— dsh-hub 能力状态与起点

> **Tier 2 · 能力** · [指南地图](README.md)

先读本页，再决定用哪个能力、去哪份文档。每一项都给出**状态（带日期）**、
**入口**与**一句话说明**；状态词汇与[README](README.md)一致，可复判。

| 状态标记 | 含义 |
| --- | --- |
| **已实现·实测** | 已落地部署，并在本机实测/验收过（GUI 验收矩阵或真实调用）。 |
| **已实现·未真机** | 代码与本地单测通过，但依赖真机环境的部分未实测（在说明中标注哪部分）。 |
| **尚不可用** | 机制存在或闸门通过，但当前不可用（具名原因）。 |
| **计划中** | 当前未实现，计划后续提供。 |
| **延期** | 长期方向；不要围绕它设计。 |

> 数据时点：2026-09-16。事实来源：`.workspace/*-exec.md` / `*-audit.md` 落盘报告（每项入口列给出）；
> 本页不臆造状态，条件性与未开放项一律如实标注。部署基线：DSH 0.1.1-rc.2（profile web）。

---

## 一、插件（`@local/*` 与 `@deepseek-ai/*`，部署于 `~/.dsh/profiles/node_modules/`）

| 能力 | 状态 | 入口 | 一句话说明 |
| --- | --- | --- | --- |
| **dsh-btw 侧边对话 v2** | 已实现·实测（2026-09-12 部署；09-16 增量：能力检测 + 行为开关） | [btw-v2-runbook.md](.workspace/btw-v2-runbook.md) · [vision-settings-capability-exec.md](.workspace/vision-settings-capability-exec.md) · [p0b-settings-switch-exec.md](.workspace/p0b-settings-switch-exec.md) | 侧聊插件：粘贴图片经 vision-adam 转文本 + R1-9 模板包装、转录缩略图可放大；子代理树/项目总览跳转列表（listTree/listProject）；面板对齐（运行横幅、工具行、图片序号徽标）；模型声明支持图片时原图直传。 |
| **dsh-usage 用量统计 + tooltip** | 已实现·实测（2026-09-14） | [usage-tooltip-exec.md](.workspace/usage-tooltip-exec.md) · [usage-heatmap-exec.md](.workspace/usage-heatmap-exec.md) | 面积/柱状/热力图（自绘 SVG，蓝单色系）；三图自绘跟随鼠标 tooltip（日期 MM-DD + token 紧凑格式化，四象限防溢出）；热力图蓝阶/空心/月份标签/峰值环。 |
| **行为开关（settings 值级热载）** | 已实现·实测（2026-09-16） | [p0b-settings-switch-exec.md](.workspace/p0b-settings-switch-exec.md) | dsh-usage 5 键（ui.tooltip / heatmap.peakRing / monthLabels / legendNote / levels）+ dsh-btw 4 键（ui.banner / modelSelect / imageBadge / vision.autoTransform）；改 `~/.dsh/settings.yaml` 即生效，默认值 = 旧行为。 |
| **vision-adam 识图（2026-09-17 起走 adam 网关）** | 已实现·实测（2026-09-12 配置化；09-14 提示词；09-17 换网关） | [vision-prompt-exec.md](.workspace/vision-prompt-exec.md) · [mmt-probe/RESULTS.md](.workspace/mmt-probe/RESULTS.md) | 默认网关 = adam（`https://llmapi.roboscience.xyz/v1/` + `ADAM_API_KEY`，model `deepseek-v4.1-flash`，maxTokens 393216 实测被接受）；提示词为「完整转录 + 审美/设计合理性分析」（真实 API 冒烟通过）。opencode go 网关配置可作为回退手动改回。 |
| **vision-adam 识图设置页** | 已实现·实测（2026-09-16 部署） | [deploy-vision-settings/README.md](.workspace/deploy-vision-settings/README.md) | settings.section「vision-adam 识图设置」（order 60）：model / baseURL / apiKeyEnv / maxTokens 字段级读写，清空即恢复默认；apiKey/maxBytes 等键永不触碰。 |
| **图像能力检测（直传 vs 转文本）** | 已实现·**实测生效**（2026-09-16 实现；2026-09-17 声明并实测直传） | [vision-settings-capability-exec.md](.workspace/vision-settings-capability-exec.md) §2/§3 · [mmt-probe/RESULTS.md](.workspace/mmt-probe/RESULTS.md) | 模型条目声明 `input` 含 `image` → 主会话/btw 原图直传，否则 vision-adam 转文本（检测基准 = 声明，非运行时探测）。2026-09-17 实测 adam 网关 `deepseek-v4.1-flash` 原生多模态**可用**（UI 图大字/色值逐字命中 15/17）→ settings.yaml 已为 `deepseek-v4.1-flash`、`deepseek-v4-flash-vision-exp` 声明 `input: [text, image]`，主会话带截图不再经识图插件；`deepseek-v4-flash` **故意不声明**（实测看不懂图、静默空输出）。 |
| **dsh-pptmaster（skill + 插件）** | 已实现·实测（2026-09-14 部署） | [deploy-pptmaster/04-Runbook.md](.workspace/deploy-pptmaster/04-Runbook.md) · [pptmaster-exec.md](.workspace/pptmaster-exec.md) | PPT 生成/编辑：skill `ppt-master`（pn1024/dsh-ppt-master v6.1.0，attribution_guard 通过）+ 插件 `@local/dsh-pptmaster`（dsh-workbuddy-ppt 0.1.0 改名，工具 `pptmaster_*`）；工作区 .pptx 落盘约定见 03-integration.md。 |
| **dsh-workerspace 本地串口/烧录** | 已实现·**未真机**（2026-09-14；42 单测本地全绿） | [deploy-workerspace/RUNBOOK.md](.workspace/deploy-workerspace/RUNBOOK.md) · [workerspace-exec.md](.workspace/workerspace-exec.md) | `ws_serial_list/open/send/read/close`（stty 默认后端 + serialport 可选）+ `ws_flash`（白名单模板 esptool/openocd/dfu-util/uuu/fastboot + 高危确认模态 + 输出脱敏）；**真机串口探测/烧录未实测**，装后必须真 boot 冒烟（静态兼容 ≠ 能启动）。 |
| **分布式控制（dsh-ssh-gui v0.2.0）** | 已实现·**未真机**（2026-09-15；81/81 单测本地通过） | [deploy-ssh-gui/RUNBOOK.md](.workspace/deploy-ssh-gui/RUNBOOK.md) · [distributed-control-exec.md](.workspace/distributed-control-exec.md) | 统一「分布式控制节点」：SSH / 本地串口 / TCP 串口三类传输，`~/.dsh/remote-workspaces/nodes.json`（0600）统一注册表（machines.json 首启迁移 + 双向同步）；侧栏「分布式节点」树、settings 三类 CRUD、header「节点」命令面板/串口控制台（不内嵌 PTY）；keyRef 只存引用名；exec 审计恒开。**真机 SSH/串口/serial-tcp 服务器未实测**（需部署后按 RUNBOOK §5）。 |
| **dsh-taste / dsh-wallpaper-local / session-board** | 已实现·实测（基线启用） | [master-runbook.md](.workspace/master-runbook.md) §0 · [port-taste.md](port-taste.md) · [port-wallpaper.md](port-wallpaper.md) | 偏好记忆 / 静态壁纸本地 fork / 会话状态看板：简单启用状态；0.1.5 bridge/命名空间移植记录见各 port 报告。 |

## 二、补丁（全局树官方包改动，重放脚本管理；重装全局树后需重放）

| 批次 | 状态 | 入口 | 一句话说明 |
| --- | --- | --- | --- |
| **lag-fix 5 补丁 + settings**（②b 子代理非流式 / mux 订阅过滤 seam / FrameQueue 有界 4096（应答帧永不丢弃）/ 图片变换 waterfall+门禁放行 / materialize 冷恢复 / tok·s 显示 / x-opencode-session 头；settings：adam maxTokens 990000、opencode-go 追加 deepseek-v4.1-flash、vision-adam 段） | 已实现·实测（2026-09-12 部署；六项启动问题 09-14 实测全部解决） | [deploy-lag/replay-lag-fix.sh](.workspace/deploy-lag/replay-lag-fix.sh) · [lag-fix-runbook.md](.workspace/lag-fix-runbook.md) · [master-runbook.md](.workspace/master-runbook.md) | 一键恢复 4 包 + dsh-subagent + settings（备份/应用/校验/回滚/幂等）；覆盖 5 个既有补丁包。 |
| **0.1.5 借码批次（patch-official-015.sh）**：lean 12（P0：tool-web untrusted-notice、atomic-write Windows rename 重试（Linux no-op）；P1：goal attempt-attribution、user-approval scopeTarget 路由、mcp-client cursor 去重；P2：fs byte-range、bash 状态报告、str-replace null 占位、launchedThroughSsh、image-tokens 等）+ 组A 6（spill 清理 sweep、saveTextFile 竞态重试、ConnectionController 恢复增强、trajectory zh 字典…）+ 组B 4（subagent 族：effort 泄漏修复、run-settlement 诊断、fork/spawn agentOptions 旗标、tool-subagent 模型选择）+ 组C 8（session tool/result isError、projection restore 校验、reasoningEffort、WS 心跳+写串行化、session-persistence 错误、llm-retry 投影化、模型切换 notice） | 已实现·实测（2026-09-15 三段式重放完成；终审 32 包 225 .js node --check 全绿） | [deploy-lag/patch-official-015.sh](.workspace/deploy-lag/patch-official-015.sh) · [deploy-015/patches/](.workspace/deploy-015/patches) · [final-audit-a-patches.md](.workspace/final-audit-a-patches.md) | 0.1.5 高价值项向 0.1.1 最小面移植（unified diff + 完整副本 + sha256 锚点 + 幂等）；image-tokens 为纯新增导出（无消费者）；launchedThroughSsh 纯导出新增。 |
| **goal 修复（P0-A + 方案 A）** | 已实现·实测（2026-09-16；mock 7+13 断言全过） | [goal-p0a-exec.md](.workspace/goal-p0a-exec.md) · [goal-pending-subagent-exec.md](.workspace/goal-pending-subagent-exec.md) | dsh-goal-round-driver：宿主 pause 中止运行中 round（keepInbox 不丢状态）+ 等待 subagent 期间空转注入修复（per-agent pendingSubagents 计数 + competingQueued 窄窗口兜底）；宿主 lib 改动需重启生效。 |
| **槽位 B（sidebar.workspaces.remoteHosts）** | 已实现·实测（2026-09-15；48/48 单测） | [deploy-slots/patch-official-slots.sh](.workspace/deploy-slots/patch-official-slots.sh) · [deploy-slots/REPLAY.md](.workspace/deploy-slots/REPLAY.md) | 官方 ui-workspace 补丁（client.js +4 行、slots.d.ts +9 行）新增 sidecar list 槽 + ssh-gui 侧栏「分布式节点」树（复用「打开为工作区」链路）；空槽零 UI。 |
| **btw P0 materialize（dsh-subagent 官方补丁）** | 已实现·实测（2026-09-12） | [deploy-p0/APPLY-P0.md](.workspace/deploy-p0/APPLY-P0.md) | `materializeContinuableChild`：仅恢复不投递的冷恢复公开方法；btw 打开冷子代理会话（host 打开链路不要求 parent live）。 |
| **未采纳 / 勿借（如实列出）**：P0-B `startsRequestSeries`；流式/传输层整族（api-gateway、remote.mux WS 重写、client-connection、http-proxy 架构级变更）；`CallId→ToolCallId` 重命名；S15（workspace 搜索 reveal 滚动）/ S16（空白行不计折叠上限） | **延期 / 勿借**（2026-09-15 裁决） | [upstream-015-diff.md](.workspace/upstream-015-diff.md) §4 · [borrow-015-exec.md](.workspace/borrow-015-exec.md) §6 | 架构级破坏面或超出最小面，未移植；S15/S16 为 P2 workspace UI 项，顺延（当前不可用）；借码时**不要**围绕这些设计。 |

## 三、热载能力（2026-09-16 实测批次）

| 能力 | 状态 | 入口 | 一句话说明 |
| --- | --- | --- | --- |
| **patch 条目级热载** | 已实现·实测（2026-09-16，运行实例实测） | [deploy-lag/README.md](.workspace/deploy-lag/README.md) §9 · [p0a-patch-hmr-exec.md](.workspace/p0a-patch-hmr-exec.md) | `cordis.patch.yml` 的 insert（bare 包名）/remove/disable/name 更换/config 覆盖均约 1s 热生效，全程免重启；**硬约束**：insert 用文件路径名在运行实例 import 不执行（整次回滚），改插件宿主代码不热。 |
| **settings 值级热载（行为开关）** | 已实现·实测（2026-09-16） | [p0b-settings-switch-exec.md](.workspace/p0b-settings-switch-exec.md) §4 | 改 `~/.dsh/settings.yaml` → 解析 → deep-equal commit → 客户端镜像/宿主读取全部走新值，无需重启；schema 与代码改动需随插件部署重启一次。 |
| **client bundle 热载** | 已实现·实测（机制） | [usage-tooltip-exec.md](.workspace/usage-tooltip-exec.md) §5 | 插件 `lib/client.js` 替换后**刷新浏览器即生效**，无需重启宿主（dsh-usage/btw 均为此形态）。 |
| **dsh-restart 自动重启** | 已实现·实测（2026-09-16；dry-run/防抖/daemon 生命周期全验证；真实重启由用户执行） | [deploy-lag/dsh-restart.sh](.workspace/deploy-lag/dsh-restart.sh) · [p0c-restart-helper-exec.md](.workspace/p0c-restart-helper-exec.md) | 一键优雅重启（SIGTERM 有界等待 dispose → 重启 → 冒烟 200，默认只读预览+确认）+ `--watch` 保存即自动重启（md5 防抖 + daemon 可 `--stop`）；会话自动 resume，进行中回合内存态丢失为已知取舍。 |
| **纯函数热载 B 通道** | **尚不可用**（闸门通过 · 未投产，2026-09-16） | [p1-hotswap-gate-exec.md](.workspace/p1-hotswap-gate-exec.md) · [p1-hotswap-lab/](.workspace/p1-hotswap-lab) | 实验证明 CJS+ESM 混合纯函数模块热载机制可行（internal 真清 loadCache，可回滚、无泄漏），但投产需改官方 `cordis-plugin-hmr`（解除 node_modules 排除）+ 模块白名单 + 一次重启落地（鸡生蛋问题）——当前不可用，勿围绕它设计。 |

---

## 诚实边界（本页之外，还有哪些不可用 / 条件性）

- **真机串口与烧录未实测**：`ws_serial_*` / `ws_flash` 只过了本地单测与静态加载；真机探测、烧录、串口日志需按
  [deploy-workerspace/RUNBOOK.md](.workspace/deploy-workerspace/RUNBOOK.md) §5 实测后才算「已实现·实测」。
- **分布式控制真机面未实测**：SSH 命令执行、真串口、serial-tcp 服务器、nodes.json 0600 落盘均需部署后按
  [deploy-ssh-gui/RUNBOOK.md](.workspace/deploy-ssh-gui/RUNBOOK.md) 实测。
- **vision 原图直传已按声明生效**：检测基准 = 模型条目声明（settings.yaml `input` 字段）。2026-09-17 已为 adam
  `deepseek-v4.1-flash` / `deepseek-v4-flash-vision-exp` 声明 `input: [text, image]`（实测原生多模态可用）→ 主会话原图直传；
  未声明 `image` 的模型（如 `deepseek-v4-flash`）仍走 vision-adam 转文本，把图直发给未声明的模型会被宿主闸门拒绝（预期）。
- **直传的小字保真度有限**：实测小字（10-11px）在直传下会退化为语义替换式幻觉（放大裁剪后同一路径 3/3 正确）；
  用户裁决不做放大预处理，故小字场景仍以 vision-adam 路径对照为准。
- **B 通道热载未投产**（见上）；**S15/S16 workspace UI 顺延**；**P0-B startsRequestSeries 勿借**。
- 本仓库为个人定制部署，clone 到别处大概率不能开箱即用；能力状态随部署演进，以最新 exec 报告与 README 验收矩阵为准。

## 接下来去哪

| Tier | 问题 | 页面 |
| --- | --- | --- |
| **1 · 部署** | 怎么让这些能力上屏/生效？ | [master-runbook.md](.workspace/master-runbook.md) + 对应主题 Runbook（README 索引） |
| **2 · 能力** | 用哪个能力、怎么用？ | 本页 → 各「入口」列的文档/脚本 |
| **3 · 证据** | 为什么这么实现、有什么取舍？ | `.workspace/*-audit.md` / `*-exec.md`（每项入口列已给出） |
