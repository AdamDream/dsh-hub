# deploy-lag — dsh-restart：dsh web 优雅重启 / 宿主 lib 变更自动重启辅助（P0-c）

> 规格来源：`.workspace/hotreload-e-design.md` §2 方案 D（裁决采纳）+ 附录候选单元 D1；
> 用户裁决：做一个自动重启辅助，消灭「忘记重启 / 被迫中断」。
> 本 README 与脚本同目录（`dsh-restart.sh`），报告见 `.workspace/p0c-restart-helper-exec.md`。

## 0. 与既有脚本的分工（先读这条）

| 脚本 | 职责 | 动作面 |
|---|---|---|
| `replay-lag-fix.sh`（lag-fix 补丁重放） | 把补丁写进全局树 lib 文件（备份/应用/校验/回滚/幂等） | **改代码** |
| `patch-official-015.sh`（0.1.5 借码重放） | 同上（12 包上游移植补丁） | **改代码** |
| `dsh-restart.sh`（本脚本） | 进程编排：SIGTERM 有界等待 dispose → 重启 → 冒烟 200 | **管进程** |

- **正交，无冲突**：补丁脚本管「代码层」（文件内容），本脚本管「进程层」（信号与拉起）。
  标准流水线：先跑补丁脚本（`--dry-run` 预览 → run），**再跑本脚本**让新代码生效——
  即替代各 RUNBOOK 里那句手动的「重启 DSH（npx @deepseek-ai/dsh web）」。
- 本脚本**不写任何 lib 文件**（不碰全局树/农场），补丁脚本**不碰任何进程**。
- 补丁脚本仍各自独立回滚；回滚补丁后同样只需再跑一次本脚本完成重启。

## 1. 依赖与安装

- 依赖：`bash(≥4) / ps / kill / curl / find(GNU) / sort / xargs / md5sum / awk / sed / tee`；
  可选 `setsid`（有则用，无则退 `nohup`）。本部署已全部具备（Node v22.23.2 环境实测）。
- 无需安装：直接执行 `./dsh-restart.sh ...`（已带可执行位）。

## 2. 一键优雅重启（默认模式）

```bash
./dsh-restart.sh                 # 打印 dry-run 预览 + 交互确认（y/N）后执行
./dsh-restart.sh --yes           # 跳过确认（脚本尾部/自动化调用；非交互环境必须显式给）
./dsh-restart.sh --dry-run       # 走完整个流程但只打印（目标进程/命令/冒烟），零副作用
./dsh-restart.sh --pid <pid>     # 指定目标进程（多个 dsh web 实例时必须，脚本拒绝猜测）
./dsh-restart.sh --force         # SIGTERM 有界等待超时后 SIGKILL（默认超时即中止，不杀）
```

执行序列（与审计证据 E1 对齐：`dsh web` 内置 5s 有界 dispose）：

1. **发现并校验目标**：`ps` 匹配 cmdline 含 `bin/dsh` + `" web"` 的 **node 主服务进程**
   （自动排除 `npm exec` / `sh -c` 包装层，它们不直接收信号）；再以 `/proc/<pid>/cmdline`
   二次校验，**校验不过绝不发信号**。
2. **确认启动命令来源**：预览里打印 ps 推断的包装链（`npm exec @deepseek-ai/dsh web` →
   `sh -c dsh web` → `node …/bin/dsh web`），供确认同 profile / 同启动方式。
3. **SIGTERM 有界等待**：默认 15s（dispose 5s + 余量）；超时未退出：
   - 未 `--force` → **中止重启、不杀进程**（安全默认）；
   - 已 `--force` → SIGKILL 兜底。
4. **重启**：`npx --no-install @deepseek-ai/dsh web`（= `dsh web` = profile web 别名，
   与原启动同 profile 同方式；`--no-install` 防 npx 意外联网安装），`setsid`/`nohup` 后台分离，
   日志 `~/.dsh/backups/dsh-restart.log`。
5. **冒烟**：轮询 `curl -sf http://127.0.0.1:3080/` 至 HTTP 200（上限 30s），打印 boot URL。

## 3. watch 模式：保存即自动重启（防抖 + daemon）

```bash
# 前台（Ctrl+C 退出）：显式指定监视目录
./dsh-restart.sh --watch ~/.dsh/profiles/node_modules/@local \
                        ~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai

# 不传目录 = 上面两个默认监视面（自装 @local 插件宿主 lib + 全局补丁包树 = 最高频改动源）
./dsh-restart.sh --watch

# 后台运行（日志文件 + pidfile）
./dsh-restart.sh --watch --daemon
./dsh-restart.sh --stop          # 只杀 watcher，不动 dsh web 进程

# 参数
./dsh-restart.sh --watch <dir...> --debounce 3 --poll 1 --yes   # 防抖 3s，轮询 1s，免确认
./dsh-restart.sh --watch <dir...> --dry-run                     # 变更触发时只打印预览
```

**防抖行为**（实测通过，见报告 §3）：对监视目录下所有 `.js` 做 md5 快照（排序归一），
每 `--poll`（默认 1s）比对；发现变更进入防抖窗口——窗口内（默认 2s）每有新变更就重新计时，
连续 `--debounce` 秒无新变更才触发一次自动重启（防保存风暴）；重启后重建基线，避免旧变更重复触发。

- daemon：`--daemon` 分离后台运行，日志 `~/.dsh/backups/dsh-restart-watch.log`，
  pidfile `~/.dsh/backups/dsh-restart-watch.pid`；`--stop` 读 pidfile、校验进程确为
  dsh-restart watch（防误杀）后 SIGTERM。
- watch 触发时的确认：`--yes` 或交互终端 y/N；非交互且未 `--yes` → 跳过本轮、继续 watch。

## 4. 会话自动 resume（无需手动恢复）

- 会话本体持久化在 `~/.dsh/sessions/<workspace>/<sid>/session.jsonl.zstd`（zstd JSONL）
  + checkpoint 投影（`~/.dsh/storages/session_projcache/`），进程重启**不丢会话**。
- 浏览器侧由官方 `dsh-client-connection` 重连/心跳（经我们的补丁加固）自动重连，无需刷新/重登。
- **唯一损失**：重启瞬间「进行中回合」的内存态（进行中的 agent 回合需重发/续接）。
  建议在改动批次收口时触发重启，或让 watch 在空闲窗口兜底。

## 5. 安全边界

- 只对 `/proc` cmdline 校验通过的 dsh web 进程（`bin/dsh` + `" web"`）发信号；
  校验失败即拒绝（`--pid` 指定也先校验）。
- 默认 dry-run 预览 + 交互确认；`--dry-run` 不杀不启；非交互未 `--yes` 直接拒绝。
- SIGKILL 仅在显式 `--force` 且 SIGTERM 有界等待超时后使用。
- `--stop` 杀 daemon 前校验 pidfile 进程 cmdline 含 `dsh-restart` + `--watch`。
- 多实例：拒绝猜测，必须 `--pid`。
- 所有动作与警告写日志 `~/.dsh/backups/dsh-restart.log`（>2MB 轮转为 `.1`）。

## 6. 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `DSH_RESTART_CMD` | `npx --no-install @deepseek-ai/dsh web` | 重启命令（同 profile/启动方式） |
| `DSH_WEB_URL` | `http://127.0.0.1:3080/` | 冒烟/boot URL |
| `DSH_RESTART_DEBOUNCE` | `2` | watch 防抖窗口（秒） |
| `DSH_RESTART_POLL` | `1` | watch 轮询间隔（秒） |
| `DSH_RESTART_STOP_WAIT` | `15` | SIGTERM 有界等待（秒） |
| `DSH_RESTART_BOOT_WAIT` | `30` | 重启后冒烟等待（秒） |
| `DSH_RESTART_LOG` | `~/.dsh/backups/dsh-restart.log` | 主日志 |
| `DSH_RESTART_WATCH_LOG` | `~/.dsh/backups/dsh-restart-watch.log` | daemon 日志 |

## 7. 验证（本档实测，见报告 §3）

- `bash -n dsh-restart.sh` ✓
- `./dsh-restart.sh --dry-run`：打印目标进程/校验/包装链/将执行命令/冒烟 URL，rc=0，不杀进程 ✓
- 非交互未 `--yes`：预览后拒绝执行（rc=2），进程不受影响 ✓
- `--pid 999999`（非 dsh 进程）与 `--watch` 不存在目录：拒绝（rc=2）✓
- watch 防抖 dry-run：连续两次变更各进入防抖窗口 → 各触发一次 dry-run 预览 → 基线重建；服务进程全程存活 ✓
- daemon 生命周期：`--daemon` 启动（pidfile）→ 变更触发写日志文件 → `--stop` 只杀 watcher、服务进程不受影响、pidfile 清理 ✓

## 8. 已知限制

- 重启会打断进行中的 agent 回合（内存态），会话本身自动 resume（见 §4）。
- 从 dsh 会话内部跑**真实**重启会杀掉当前服务进程本身；建议从终端跑，或 watch 用 `--daemon`。
- watch 是 md5 轮询（非 inotify）：约 1s 级延迟，足够"保存即重启"；大规模目录树注意轮询成本。
- 多实例必须 `--pid`；本脚本不做负载均衡/多实例编排。

## 9. 运行时热载能力（P0-a 实测固化，2026-09-16）

> 实测档：`.workspace/p0a-patch-hmr-exec.md`（证据时间线、观测手段、自复核）。
> 一句话结论：**cordis.patch.yml 条目级热载成立**——insert / remove / disable / name 更换
> 均在**运行实例**上实测热生效（~1s 级），无需重启；config 覆盖走同一热链（代码路径实证）。
> 以下清单用于回答「这次改动要不要重启」：**只改本表"热"行的文件 → 不用跑本脚本。**

### 9.1 支持矩阵（实测或代码实证；运行实例 = `dsh web` PID 2437836 @ 127.0.0.1:3080）

| 变更类型 | 改什么 | 热/冷 | 证据等级 | 生效时间 |
|---|---|---|---|---|
| **insert 新插件**（bare 包名，包已在可解析 node_modules） | `~/.dsh/profiles/web/cordis.patch.yml` | **热** | 实测：boot graph 49→50 行，`curl /` 可见新 client 行 | ~1s |
| **remove insert**（删条目） | 同上 | **热** | 实测：graph 50→49，行消失 | ~1s |
| **disable 已有条目**（`- id: X` + `disabled: true`） | 同上 | **热** | 实测：graph 行消失（fiber dispose） | ~1s |
| **name 更换**（同 id 换包名） | 同上 | **热** | 实测：graph 行换 id（dispose 旧 + re-import 新） | ~1s |
| **config 覆盖**（给已有条目加/改 `config:` 键值） | 同上 | **热** | 代码实证：config-only diff → `_patchContext` → `fiber.update(config)` 重应用；链已实测执行（同链 insert/disable 均热） | ~1s |
| **改插件宿主 lib 代码**（$P 官方包 / profiles/node_modules 自装包 `lib/*.js`） | 代码文件 | **冷** | 机制：ESM loadCache + web 表面模块 HMR 禁用（hmr row disabled）+ externals→`loader.exit()` 空转 | 重启（本脚本） |
| **insert 用文件路径名**（`name: /abs/path.mjs` 或 `file://…`） | patch + 文件 | **冷（失败回滚）** | 实测：运行实例 import 不执行、整次刷新回滚、无残留；bare 包名无此问题 | — |

### 9.2 免重启操作清单（团队可用）

以下场景**改完即生效，不用重启**（保存 `cordis.patch.yml` 后 ~1s 内生效）：

1. **注册一个新插件**（包已 `npm/cp` 装到可解析 node_modules，例如 `~/.dsh/profiles/node_modules/@local/`）：
   ```yaml
   - insert:
       - id: my-plugin
         name: '@local/my-plugin'
         config: { ... }        # 可选
   ```
   验证：`curl -s http://127.0.0.1:3080/ | grep -o '"id":"@local/my-plugin"'`（有 client 声明的插件会出现在 boot graph）。
2. **卸载一个插件**：删掉对应 `insert` 条目（或 `- id: X` + `disabled: true` 禁用）；graph 行消失即生效。
3. **给已有插件改配置**：加/改 `- id: X` + `config:` 覆盖（注意插件 `Config` 校验失败会回滚保留旧值，需看终端日志确认）。
4. **换插件的包**：同 id 改 `name`（走 re-import 热换）。

**仍然要重启（跑 `./dsh-restart.sh`）的场景**：改任何插件**宿主 lib 代码**（官方补丁包 / `@local` 自装包 `lib/*.js`）、已挂载条目的 `dsh.client` 声明变更、批量补丁批次收口。

### 9.3 硬约束与坑（实测）

- **文件路径 insert 不热**：`name: /tmp/foo.mjs` / `file://…` 在运行实例 import 失败（顶层代码不执行）→ 整次 patch 刷新回滚；必须用 **bare 包名**（已装包）。
- **改代码不热**：条目热载只重应用**配置**，不重读模块文件（ESM 缓存）；模块级 HMR 在 web 表面显式禁用。
- **`dsh --profile web --dump-config` 会重写 `cordis.yml`**（内容不变、mtime 变，实测）；它不是运行进程的配置——只反映**磁盘**组合，不能用来验证运行进程是否已热载。
- **观测运行实例热载**：boot graph 走 `curl http://127.0.0.1:3080/`（每次请求注入当前图）或 SSE `curl -N /plugins/events`；进程日志（loader 的 `reload plugin X` / hmr 的 `config reload … failed`）只进启动终端（`/dev/pts/0`），**无法从会话内读取**——热载成败以 graph/行为为准，失败诊断需在终端看日志。

### 9.4 机制链（一句话，供排障）

`保存 patch → hmr.registerConfig 精确 watch（profile-boot 挂载，`{root:[]}` 出厂态）→ watchUserPatches 事务性 `entry.update({patches})` → include fiber update → applyPatches → EntryGroup.update 条目 diff（insert=import+activate；remove=dispose；config-only=`_patchContext`→`fiber.update(config,true)`；name=`re-import`）→ `internal/plugin` 事件 → client-modules 增量 reconcile boot graph → 浏览器刷新即见`。
证据行号：`dsh-app-boot/lib/index.js:761-781`、`profile-boot-DG5t9aNs.js:264-270`、`cordis-plugin-hmr/lib/index.js:118-166`、`cordis-plugin-loader/lib/index.js:405-492`、`cordis-plugin-include/lib/index.js:139-146`。
