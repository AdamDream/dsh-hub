# P0-c 修订执行复核一体执行报告 — dsh-restart 自动重启辅助

- **档**：两阶段闭环【修订执行复核一体】阶段子代理（路由 adam/deepseek-v4-flash）
- **时间**：2026-09-16
- **任务**：按需求实现 `.workspace/deploy-lag/dsh-restart.sh`（一键优雅重启 + watch 自动重启）、
  README（分工/用法/会话 resume）、同档自复核并落盘本报告
- **约束遵守**：只写 `.workspace/deploy-lag/dsh-restart.sh`、`.workspace/deploy-lag/README.md`、
  本报告；**全程 dry-run 验证，未实际重启/杀任何进程**（运行中的 dsh web pid=2437836 全程存活）；
  未使用 sandbox_permissions。
- **恢复说明**：本档曾因输出上限截断中断，主代理已代写 117 行草稿并发现核心 bug；
  经 send_message 恢复同档后，据磁盘草稿与 bug 描述直接收尾（未重读重搜）。

---

## 1. 修复点（主代理发现的 bug + 顺带修正的草稿硬伤）

### 1.1 核心 bug：`--dry-run` 只设标志、不触发默认动作 → 静默无输出

- **根因**（草稿 L94-105）：`[ "$#" -eq 0 ] && set -- restart` + case 里 `restart) do_restart`——
  只有显式传 `restart` 词才执行重启；`./dsh-restart.sh --dry-run` 只把 `DRY_RUN=1` 设上，
  参数解析完没有任何动作，退出码 0、零输出。
- **修法**：改为「**默认动作 = 一键重启，标志只改行为**」。参数循环只消费标志
  （`--dry-run/--yes/--force/--pid/--watch/--daemon/--stop/--debounce/--poll/--help`），
  `restart` 词保留为显式同义词（可省）；解析结束后非 watch 一律 `do_restart`。
  `--dry-run` 现在走完 `do_restart` 全流程（发现目标 → 校验 → 预览 → 冒烟计划），
  只在 `kill`/`start` 两个执行点前短路打印，零副作用。
- **实测确认修复**：`./dsh-restart.sh --dry-run`（无 `restart` 词）→ 打印完整预览
  （目标 PID 2437836、进程校验、ps 包装链、SIGTERM/启动/冒烟命令），rc=0；进程未受影响。

### 1.2 顺带修正的草稿硬伤（自复核发现，同档一并修）

| # | 草稿问题 | 风险 | 修复 |
|---|---|---|---|
| 1 | `find_pid` 用 `pgrep -f "deepseek-ai/dsh.*web"` | node 主进程 cmdline 是 `node …/bin/dsh web`，**不含** "deepseek-ai"；该 pattern 只命中 `npm exec @deepseek-ai/dsh web` **包装层**——会打错目标（杀 npm 包装层 ≠ 触发 node 的 dispose） | 改为 ps 匹配 cmdline 含 `bin/dsh` + `" web"` 的 node 主服务进程，天然排除包装层；再以 `/proc/<pid>/cmdline` 二次校验 |
| 2 | `stop_web` 15s 后无条件 SIGKILL | 与「SIGTERM 有界等待 dispose」的优雅性冲突；无显式授权即杀 | SIGTERM 有界等待（默认 15s，E1 的 5s dispose + 余量）；超时未 `--force` → **中止重启、不杀**；`--force` 才 SIGKILL |
| 3 | 多实例时 `head -1` 猜第一个 | 静默选错目标 | 多实例 → 报错列出、要求 `--pid`（拒绝猜测） |
| 4 | watch 防抖只是 `sleep 2` 采样 | 保存风暴期间多次触发 | md5 快照 + 防抖窗口（默认 2s 无新变更才触发一次），触发后重建基线防重复触发 |
| 5 | daemon 重入丢 `--dry-run/--yes/--force/--pid` | daemon 行为与前台不一致 | 参数数组完整透传 |
| 6 | daemon 无法停止 | 后台进程无管理入口 | `--stop`：读 pidfile → 校验进程 cmdline 为 dsh-restart watch → SIGTERM（只杀 watcher，不动 dsh web） |
| 7 | 无交互确认 | 一键脚本误触风险 | 默认 dry-run 预览 + 交互 y/N；非交互未 `--yes` → 拒绝（rc=2）；watch 触发时非交互未 `--yes` → 跳过本轮继续 watch |

---

## 2. 实现清单（对照需求）

| 需求 | 实现位置（dsh-restart.sh） | 说明 |
|---|---|---|
| 一键优雅重启，同 profile/同启动方式 | `do_restart` + `stop_web` + `start_web` | 启动命令默认 `npx --no-install @deepseek-ai/dsh web`（`dsh web`=profile web，`--no-install` 防意外联网装包；`DSH_RESTART_CMD` 可覆盖） |
| 先确认已有进程与启动命令来源 | `resolve_target` + `preview` | 预览打印目标 PID/`/proc` 校验/ps 推断包装链（npm exec → sh -c → node），再交互确认 |
| SIGTERM 有界等待 dispose → 重启 → 打印 boot URL + 冒烟 200 | `stop_web`（15s 有界，超时默认中止/`--force` SIGKILL）+ `start_web`（setsid/nohup 分离 + curl -f 轮询至 200，上限 30s，打印 ✅ URL） | dispose 5s 与 E1 对齐 |
| watch 模式（可选） | `watch_loop` + `snapshot` | `--watch <dir...>`；默认监视 `~/.dsh/profiles/node_modules/@local` + 全局补丁包树（最高频两改动源）；`.js` md5 快照 |
| 防抖 | `watch_loop` 防抖窗口 | 默认 2s 无新变更才触发；窗口内新变更重新计时；`--debounce/--poll` 可调 |
| --daemon 后台 + 日志到文件 | `start_watch_daemon` + `stop_watch_daemon` | nohup 分离 + pidfile + watch 日志文件；`--stop` 停止 |
| 安全：默认只读 dry-run 预览 | `preview` + `confirm_or_exit` | 默认预览后确认；`--dry-run` 全流程零副作用 |
| restart 前校验进程存在 | `resolve_target` | 无进程 → 明确提示（仅启动新实例）；多实例 → 拒绝要求 `--pid` |
| 不静默杀非 dsh 进程 | `is_dsh_web_pid` / `stop_watch_daemon` 校验 | 信号前 `/proc` cmdline 校验；SIGKILL 需显式 `--force` |
| 会话自动 resume 说明 | README §4 + 预览第 5 步 | zstd JSONL + checkpoint + 浏览器自动重连（补丁加固），无需手动恢复；仅进行中回合内存态丢失 |
| 与 replay/patch-official 分工 | README §0 + 脚本头注释 | 补丁脚本=改代码，本脚本=管进程，正交无冲突 |

---

## 3. 验证结果（全部 dry-run，进程 pid=2437836 全程存活）

| # | 命令 | 结果 | 证据 |
|---|---|---|---|
| 1 | `bash -n dsh-restart.sh` | ✅ 语法通过 | SYNTAX OK |
| 2 | `./dsh-restart.sh --help` | ✅ 用法完整 | 分工/用法/环境变量/安全边界 齐全 |
| 3 | `./dsh-restart.sh --dry-run`（**修复验证**） | ✅ 走完整流程：目标 PID=2437836、校验 ✓、包装链（2437821 npm exec / 2437835 sh -c）、SIGTERM/启动/冒烟命令、dry-run 结束标记；rc=0 | 见 §3 实测输出摘录 |
| 4 | 非交互 `echo \| ./dsh-restart.sh`（无 --yes） | ✅ 预览后拒绝（rc=2），进程不受影响 | rc=2 + server alive |
| 5 | `--dry-run --pid 999999`（非 dsh 进程） | ✅ 拒绝（rc=2） | `/proc cmdline 校验失败` |
| 6 | `--watch /nonexistent` | ✅ 拒绝（rc=2） | `watch 目录不存在` |
| 7 | watch 防抖 dry-run（临时目录，两次连发变更） | ✅ 两次变更各进防抖窗口 → 各触发一次 dry-run 预览 → 基线重建；全程未杀进程 | watcher.out 完整时序见下 |
| 8 | daemon 生命周期 | ✅ `--daemon` 启动（pidfile=2485900）→ 变更触发写日志文件（`~/.dsh/backups/dsh-restart-watch.log`）→ `--stop` 只杀 watcher、服务进程不受影响、pidfile 清理 | 见下 |

**测试 7 关键时序（watcher.out 摘录）**：`watch 模式: /tmp/dsh-restart-watch-test` →
`检测到 .js 变更 → 进入防抖窗口（1s…）` → `防抖结束 → 触发自动重启` → dry-run 预览 →
`dry-run 结束` → `基线已重建（继续 watch）` → 第二次变更重复同序列。两次变更在防抖窗口内
各自归并、只触发一次（若保存风暴，窗口内新变更会重新计时）。

**测试 8 关键输出**：`watch daemon 已启动 pid=2485900（日志 …watch.log，pidfile …watch.pid）` →
文件修改后 daemon 日志尾部出现 dry-run 预览 + `基线已重建`；`--stop` →
`SIGTERM -> watch daemon pid=2485900（只杀 watcher，不动 dsh web 进程）`；之后
`daemon stopped ✓ / dsh web server untouched ✓ / pidfile removed ✓`。

---

## 4. 同档自复核

### 4.1 对照需求逐条自检
- 优雅性（SIGTERM 序列）：✅ 单信号 SIGTERM → node 主进程；有界等待（15s，覆盖 E1 的 5s dispose）；
  超时默认中止不杀，`--force` 才 SIGKILL。信号只发校验通过的进程，包装层不直接收信号。
- 防误杀：✅ `/proc` cmdline 二次校验；`--pid` 指定也先校验；daemon `--stop` 校验 pidfile
  进程 cmdline；多实例拒绝猜测。测试 5/8 实测通过。
- 日志：✅ 主日志 `~/.dsh/backups/dsh-restart.log`（>2MB 轮转 .1）+ watch daemon 日志文件
  （`DSH_RESTART_LOG/DSH_RESTART_WATCH_LOG` 可覆盖）；所有动作/警告留痕。
- README 完整：✅ 分工（§0）、依赖（§1）、一键用法+执行序列（§2）、watch/防抖/daemon（§3）、
  会话 resume（§4）、安全边界（§5）、环境变量表（§6）、验证（§7）、已知限制（§8）。

### 4.2 自裁决
**通过**（无需返工）。核心 bug 已修复并有实测证据（测试 3）；需求 1-5 全部落地并有
dry-run/防抖/daemon 生命周期实测（测试 3/4/5/6/7/8）；未实际重启任何进程（约束遵守）。

### 4.3 问题清单（如实上报，均非阻断）
1. **watch 触发真实重启会打断进行中 agent 回合**（内存态）；会话自动 resume，但回合需重发——
   属方案 D 固有取舍（设计文档已声明），README §4/§8 已说明。
2. 从 dsh 会话内部跑**真实**一键重启会杀掉当前服务进程本身（脚本会在被杀前完成派发吗？——
   注意：真实执行时，若本脚本以 dsh 子进程方式运行，SIGTERM 主进程后脚本自身可能被回收；
   已用 setsid 分离启动新实例降低风险，但**推荐从终端运行**，watch 用 `--daemon`。README §8 已说明）。
3. watch 用 md5 轮询（非 inotify）：1s 级延迟、大目录树有轮询成本（默认监视面 ~225 个 .js，实测无感）。
4. 冒烟 URL 默认 `http://127.0.0.1:3080/`，若部署改端口需 `DSH_WEB_URL` 覆盖（环境变量已提供）。
5. 日志轮转简单（>2MB → .1 覆盖旧 .1），未做按天/压缩轮转——当前量级足够。

### 4.4 交付物
- `.workspace/deploy-lag/dsh-restart.sh`（可执行，~260 行，bash）
- `.workspace/deploy-lag/README.md`（分工 + 用法 + 会话 resume + 安全 + 环境变量 + 验证）
- 本报告 `.workspace/p0c-restart-helper-exec.md`
- 运行日志（脚本运行时产物）：`~/.dsh/backups/dsh-restart.log` / `dsh-restart-watch.log`
