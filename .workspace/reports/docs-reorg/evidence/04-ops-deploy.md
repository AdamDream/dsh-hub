# 04 — 运维 / 部署 / 重启 / 验证 证据档

采集者：只读证据子代理（未改动任何文件；未执行任何 `.workspace/deploy-*/` 脚本；未触碰 PID 20806）。
采集时点：本会话（运行实例为 `node .../bin/dsh web` PID 20806）。
格式：每条结论一行，后接 `— 证据：path:line「verbatim quote」`。所有引文为逐字短引。
分节：**A. VERIFIED（已核实）** / **B. UNVERIFIED / 未知**。

---

## A. VERIFIED

### A0. 当前运行实例（采集时点实测）

- 采集时点运行的唯一 DSH web 宿主进程就是 **PID 20806**，由 `npm exec` 包装链启动，命令行为 `node /home/CNS2026495165/.npm-global/bin/dsh web`。
  — 证据：`ps -p 20806 -o pid=,ppid=,args=` 实测输出「20806 20805 node /home/CNS2026495165/.npm-global/bin/dsh web」（非文件证据，命令实测）
- 该进程持有 **127.0.0.1:3080**，即文档所称「默认端口 3080」的真实监听者。
  — 证据：`ss -ltnp` 实测输出「LISTEN 0 511 127.0.0.1:3080 0.0.0.0:* users:(("node",pid=20806,fd=25))」（非文件证据，命令实测）
- 冒烟 URL / 端口在仓库内被固化为常量 `http://127.0.0.1:3080/`（脚本默认值）。
  — 证据：`.workspace/deploy-lag/dsh-restart.sh:47`「SMOKE_URL="${DSH_WEB_URL:-http://127.0.0.1:3080/}"」
- 重启脚本自述其重启命令即「`dsh web` = profile web 别名」。
  — 证据：`.workspace/deploy-lag/dsh-restart.sh:46`「LAUNCH_CMD="${DSH_RESTART_CMD:-npx --no-install @deepseek-ai/dsh web}"」
- README 把「重启与静态核验」的冒烟写成对 3080 的 curl + boot graph 抓取。
  — 证据：`.workspace/master-runbook.md:54`「curl -s http://127.0.0.1:3080/ | grep -o '"id":"[^"]*"' | grep -E 'pptmaster|workspace|workerspace|usage|taste|wallpaper|dsh-btw'」
- deploy-lag README 明确「冒烟 = 轮询 curl 到 HTTP 200（上限 30s）」并给出启动命令的同 profile 语义。
  — 证据：`.workspace/deploy-lag/README.md:50`「5. **冒烟**：轮询 `curl -sf http://127.0.0.1:3080/` 至 HTTP 200（上限 30s），打印 boot URL。」
  — 证据：`.workspace/deploy-lag/README.md:47`「4. **重启**：`npx --no-install @deepseek-ai/dsh web`（= `dsh web` = profile web 别名，」

### A1. `.workspace/` 下 shell 脚本清单（≤2 层，排除 node_modules 与 backup 目录）与自述用途

- 共 18 个 `*.sh`。用途一律取自脚本自身头部注释（verbatim）：

1. `.workspace/deploy-lag/replay-lag-fix.sh`（463 行，`-rwxr-xr-x`）
   — 证据：`.workspace/deploy-lag/replay-lag-fix.sh:3`「# replay-lag-fix.sh — subagent 多开卡顿修复 重放脚本（U-1..U-8 全量固化 + P0 btw 子代理打开修复）」
2. `.workspace/deploy-lag/patch-official-015.sh`（270 行）
   — 证据：`.workspace/deploy-lag/patch-official-015.sh:3`「# patch-official-015.sh — 0.1.5-rc.2 增量借码重放脚本（P0/P1/P2 全采纳）」
3. `.workspace/deploy-slots/patch-official-slots.sh`（186 行）
   — 证据：`.workspace/deploy-slots/patch-official-slots.sh:3`「# patch-official-slots.sh — 官方 dsh-client-ui-workspace 槽位路径 B 补丁 重放脚本」
4. `.workspace/deploy-lag/dsh-restart.sh`（328 行）
   — 证据：`.workspace/deploy-lag/dsh-restart.sh:3`「# dsh-restart — DSH web 优雅重启 / 宿主 lib 变更自动重启辅助（P0-c）」
5. `.workspace/deploy-ssh-gui/deploy.sh`
   — 证据：`.workspace/deploy-ssh-gui/deploy.sh:2`「# deploy.sh —— @local/dsh-ssh-gui（分布式控制）部署脚本（薄插件，零第三方依赖，绝不执行 npm/pnpm install）。」
6. `.workspace/deploy-workerspace/deploy.sh`
   — 证据：`.workspace/deploy-workerspace/deploy.sh:2`「# deploy.sh —— dsh-workerspace 部署脚本（底座 dsh-workspace-enhancement@0.1.2-rc2 适配版 + 薄插件）。」
7. `.workspace/side-deploy/deploy-side.sh`
   — 证据：`.workspace/side-deploy/deploy-side.sh:3`「# deploy-side.sh —— 支线收尾：把 usage 与 session-board 部署包装上 web profile」
8. `.workspace/plugin-restore/apply-restore.sh`
   — 证据：`.workspace/plugin-restore/apply-restore.sh:3`「# apply-restore.sh — 插件恢复应用脚本（web profile 0.1.1-rc.2）」
9. `.workspace/acceptance-probe/probe-context-window.sh`
   — 证据：`.workspace/acceptance-probe/probe-context-window.sh:2`「# 受控加压探测：adam / deepseek-v4.1-flash 的真实上下文窗口」
10. `.workspace/acceptance-probe/probe-context-window-round2.sh`
   — 证据：`.workspace/acceptance-probe/probe-context-window-round2.sh:2`「# 加压探测第二轮：把边界夹到"刚好 1.0M 上下"，并加一个已知成功档做对照」
11. `.workspace/acceptance-probe/probe-channel-availability.sh`（**已写好未运行**，见 `.workspace/acceptance-exec.md:375`）
   — 证据：`.workspace/acceptance-probe/probe-channel-availability.sh:2`「# 渠道可用性实测：deepseek-v4.1-flash vs deepseek-v4-flash（极小请求，成本可忽略）」
12. `.workspace/mmt-probe/probe-adam-multimodal.sh`
   — 证据：`.workspace/mmt-probe/probe-adam-multimodal.sh:2`「# 探针：adam 网关 deepseek-v4.1-flash 是否支持原生多模态（图像输入）」
13. `.workspace/mmt-probe/probe-image.sh`
   — 证据：`.workspace/mmt-probe/probe-image.sh:2`「# 探针（修正版）：图像输入实测 —— deepseek-v4.1-flash vs deepseek-v4-flash-vision-exp」
14. `.workspace/mmt-probe/probe-transcribe.sh`
   — 证据：`.workspace/mmt-probe/probe-transcribe.sh:2`「# 探针2：转录保真度对照 —— adam 网关 deepseek-v4.1-flash vs deepseek-v4-flash-vision-exp」
15. `.workspace/twin-probe/verify_twin.sh`
   — 证据：`.workspace/twin-probe/verify_twin.sh:2`「# adam 网关「模型替身」自查脚本 —— 串行 + 限速，不会打断网关」
16. `.workspace/settings-lag/scan_sessions.sh`
   — 证据：`.workspace/settings-lag/scan_sessions.sh:2`「# READ-ONLY scan: classify every DSH session by whether it ever ran a turn.」
17. `.workspace/baseline-011/fetch.sh` — **无头部注释**：纯 curl 批量下载 0.1.1-rc.2 各包 tgz，无 usage/选项文本。
   — 证据：`.workspace/baseline-011/fetch.sh:1`「curl -fsSL --retry 2 -o dsh-subagent-fork-in-process-0.1.1-rc.2.tgz "https://registry.npmmirror.com/@deepseek-ai/dsh-subagent-fork-in-process/-/dsh-subagent-fork-in-process-0.1.1-rc.2.tgz"」
18. `.workspace/research/fetch.sh` — **无头部注释**：按参数拉取 npm registry JSON 元数据。
   — 证据：`.workspace/research/fetch.sh:6`「  echo "$p -> http=$code size=$(stat -c%s "$out" 2>/dev/null)"」

### A2. 补丁脚本的 fail-closed 契约（备份 → 应用 → 校验 → FAIL 非零；`--dry-run` / `--rollback`）

- 三段式契约在三个脚本头部被显式声明为「默认执行（备份 -> 应用 -> 校验）」。
  — 证据：`.workspace/deploy-lag/replay-lag-fix.sh:17`「#   ./replay-lag-fix.sh            默认执行（备份 -> 应用 -> 校验）」
  — 证据：`.workspace/deploy-lag/patch-official-015.sh:18`「#   ./patch-official-015.sh            默认执行（备份 -> 应用 -> 校验）」
- `--dry-run` 语义 = 只打印、**不写任何文件**。
  — 证据：`.workspace/deploy-lag/replay-lag-fix.sh:18`「#   ./replay-lag-fix.sh --dry-run  只打印将执行的步骤 + 全部前置校验，不写任何文件」
  — 证据：`.workspace/deploy-lag/replay-lag-fix.sh:42`「  --dry-run) DRY=1 ;;」
- `--rollback` 语义 = 用**最新备份**还原，且还原后必须重启 DSH。
  — 证据：`.workspace/deploy-lag/replay-lag-fix.sh:19`「#   ./replay-lag-fix.sh --rollback 用最新备份还原（还原后需重启 DSH）」
  — 证据：`.workspace/deploy-lag/replay-lag-fix.sh:43`「  --rollback) ROLLBACK=1 ;;」
  — 证据：`.workspace/deploy-lag/replay-lag-fix.sh:357`「  latest="$(ls -d "$BACKUP_ROOT"/backup-* 2>/dev/null | sort | tail -n 1)"」
- 备份先于任何写入：先做「是否需要应用」判定，需要才 `backup_all`（4+1 包 + settings.yaml 全量快照）。
  — 证据：`.workspace/deploy-lag/replay-lag-fix.sh:405`「  backup_all」
  — 证据：`.workspace/deploy-lag/replay-lag-fix.sh:403`「  dry "将先全量备份 5 包（4 包 + dsh-subagent）+ settings.yaml 到 $BACKUP_ROOT/backup-<时间戳>/"」
  — 证据：`.workspace/deploy-lag/patch-official-015.sh:141`「  BACKUP_DIR="$BACKUP_ROOT/backup-015-$stamp"」
  — 证据：`.workspace/deploy-slots/patch-official-slots.sh:170`「backup_all」
- 应用前必先 `patch --dry-run` 预检（未命中即判漂移并中止，**不写文件**）。
  — 证据：`.workspace/deploy-lag/replay-lag-fix.sh:210`「  if ! (cd "$ROOT" && patch --batch -p0 --dry-run < "$PATCHES/$patch_file" >/dev/null 2>&1); then」
  — 证据：`.workspace/deploy-lag/replay-lag-fix.sh:211`「    fail "$unit patch dry-run 未命中（live 文件可能已漂移，需重新锚定），中止"」
  — 证据：`.workspace/deploy-lag/patch-official-015.sh:166`「  if ! (cd "$ROOT/$pkg" && patch --batch -p1 --dry-run < "$PATCHES/$patchfile" >/dev/null 2>&1); then」
  — 证据：`.workspace/deploy-slots/patch-official-slots.sh:171`「if ! (cd "$PKG_DIR" && patch --batch -p1 --dry-run < "$PATCH_FILE" >/dev/null 2>&1); then」
- 校验用 `node --check`（语法）+ 锚点 grep 计数 + sha256/字节比对三件套。
  — 证据：`.workspace/deploy-lag/replay-lag-fix.sh:317`「  node --check "$AGENT_LOOP" >/dev/null 2>&1 || { fail "U-1 agent-loop node --check 失败"; return 1; }」
  — 证据：`.workspace/deploy-lag/replay-lag-fix.sh:188`「  if [ "$got" != "$known_sha" ]; then」
  — 证据：`.workspace/deploy-lag/patch-official-015.sh:196`「    [ "$got" = "$want" ] || { fail "$pkg $rel sha256 与 known 不符（实得 $got）"; ok=0; }」
  — 证据：`.workspace/deploy-slots/patch-official-slots.sh:112`「  if diff -q "$PATCHED_COPY/lib/client.js" "$CLIENT_JS" >/dev/null 2>&1 \」
- FAIL 是**粘性标志 + 非零退出**：`fail()` 置 `FAILED=1`，脚本末尾 `exit "$FAILED"`。
  — 证据：`.workspace/deploy-lag/replay-lag-fix.sh:77`「fail() { printf '[FAIL] %s\n' "$*" >&2; FAILED=1; }」
  — 证据：`.workspace/deploy-lag/replay-lag-fix.sh:463`「exit "$FAILED"」
  — 证据：`.workspace/deploy-lag/patch-official-015.sh:65`「fail() { printf '[FAIL] %s\n' "$*" >&2; FAILED=1; }」
  — 证据：`.workspace/deploy-lag/patch-official-015.sh:270`「exit "$FAILED"」
  — 证据：`.workspace/deploy-slots/patch-official-slots.sh:61`「fail() { printf '[FAIL] %s\n' "$*" >&2; FAILED=1; }」
  — 证据：`.workspace/deploy-slots/patch-official-slots.sh:186`「exit "$FAILED"」
- 任一单元失败即 `exit 1` **立刻中止后续单元**（不继续往下应用）。
  — 证据：`.workspace/deploy-lag/replay-lag-fix.sh:422`「patch_unit "U-4" "dsh-host-apiproxy.u4.patch" "if (!subscribed.has(session.id)) return;" || exit 1」
  — 证据：`.workspace/deploy-lag/patch-official-015.sh:252`「  apply_unit "$pkg" "$patchfile" "$anchor" "$mincount" "$note" || exit 1」
- **关键语义：失败不回滚**（注释逐字写明「任一失败 -> FAIL + 退出非零，不回滚」）。
  — 证据：`.workspace/deploy-lag/replay-lag-fix.sh:314`「# 校验（每单元，任一失败 -> FAIL + 退出非零，不回滚）」
  — 证据：`.workspace/deploy-lag/patch-official-015.sh:178`「# 校验（每单元，任一失败 -> FAIL + 退出非零，不回滚）」
  — 证据：`.workspace/deploy-lag/replay-lag-fix.sh:461`「  say "===== 存在 FAIL 单元（已回滚 = 无，需人工介入或 --rollback）====="」
- 幂等契约：已应用（锚点命中 / 字节全等 / 值正确）即 SKIP，重复跑不产生副作用；全绿时「无操作」直接 exit 0。
  — 证据：`.workspace/deploy-lag/replay-lag-fix.sh:20`「# 幂等：每单元已应用（锚点命中/字节全等/值正确）则跳过并提示 SKIP」
  — 证据：`.workspace/deploy-lag/replay-lag-fix.sh:399`「  say "全部单元均已应用，无操作。"」
- `patch-official-slots.sh` 的默认动作与其他两个相反：**默认即 dry-run**，真实写入必须显式 `--apply`。
  — 证据：`.workspace/deploy-slots/patch-official-slots.sh:10`「#   bash patch-official-slots.sh            dry-run（默认：只打印计划 + 前置校验，不写任何文件）」
  — 证据：`.workspace/deploy-slots/patch-official-slots.sh:11`「#   bash patch-official-slots.sh --apply    真实应用（备份 -> patch -p1 -> 校验 -> 与 patched 副本字节比对）」
  — 证据：`.workspace/deploy-slots/patch-official-slots.sh:24`「MODE="${1:-dry-run}"」
- 前置校验（只读）先跑，缺工具/缺 tgz/缺锚点即 `exit 1`，绝不带病写入。
  — 证据：`.workspace/deploy-lag/replay-lag-fix.sh:383`「precheck || { fail "前置校验未通过"; exit 1; }」
  — 证据：`.workspace/deploy-lag/patch-official-015.sh:229`「precheck || { fail "前置校验未通过"; exit 1; }」
  — 证据：`.workspace/deploy-slots/patch-official-slots.sh:152`「precheck || { fail "前置校验未通过"; exit 1; }」

### A3. `dsh-restart.sh`：SIGTERM → 有界等待 dispose → 重启 → HTTP 200 冒烟；标志；目标进程守卫

- 脚本与补丁脚本的**正交分工**被逐字写明（补丁=改代码，本脚本=重启进程，且本脚本不写任何 lib 文件）。
  — 证据：`.workspace/deploy-lag/dsh-restart.sh:7`「#   dsh-restart.sh                            = 进程编排（SIGTERM 有界等待 → 重启 → 冒烟 200），管「重启进程」。」
  — 证据：`.workspace/deploy-lag/dsh-restart.sh:8`「#   两者正交：先跑补丁脚本（改代码），再跑本脚本（让新代码生效）；本脚本不写任何 lib 文件。」
- 四步序列在预览中被逐条打印：SIGTERM+有界等待 → 等进程退出/端口释放 → 启动 → curl 冒烟 200。
  — 证据：`.workspace/deploy-lag/dsh-restart.sh:134`「  note "  1) SIGTERM -> ${TARGET_PID:-（无）}，有界等待 ${STOP_WAIT}s dispose"」
  — 证据：`.workspace/deploy-lag/dsh-restart.sh:136`「  note "  2) 等进程退出 + 端口释放"」
  — 证据：`.workspace/deploy-lag/dsh-restart.sh:138`「  note "  4) 冒烟: curl -sf ${SMOKE_URL} 轮询至 HTTP 200（上限 ${BOOT_WAIT}s），打印 boot URL"」
- SIGTERM 后有界轮询（默认 15s = dispose 5s + 余量），进程退出即返回 0。
  — 证据：`.workspace/deploy-lag/dsh-restart.sh:30`「#   DSH_RESTART_STOP_WAIT    SIGTERM 有界等待秒数（默认 15；dispose 5s + 余量）」
  — 证据：`.workspace/deploy-lag/dsh-restart.sh:164`「  kill -TERM "$pid" 2>/dev/null || { note "SIGTERM 失败（进程可能已退出）"; return 1; }」
  — 证据：`.workspace/deploy-lag/dsh-restart.sh:166`「    if ! kill -0 "$pid" 2>/dev/null; then note "进程已退出（${i}s）"; return 0; fi」
- 超时且未 `--force` 时**默认中止重启、不杀进程**（安全默认，这是防止误杀 20806 的核心闸）。
  — 证据：`.workspace/deploy-lag/dsh-restart.sh:176`「  note "警告：${STOP_WAIT}s 后仍存活：默认中止重启（未杀进程）。可用 --force 或手动处理。"」
  — 证据：`.workspace/deploy-lag/dsh-restart.sh:211`「    stop_web "$TARGET_PID" || { note "停止阶段失败，取消重启"; return 1; }」
- SIGKILL 仅在显式 `--force` 且超时后使用。
  — 证据：`.workspace/deploy-lag/dsh-restart.sh:169`「  if [ "$FORCE" -eq 1 ]; then」
  — 证据：`.workspace/deploy-lag/dsh-restart.sh:171`「    kill -KILL "$pid" 2>/dev/null || true」
- 启动后冒烟：轮询 `curl -sf` 直到 HTTP 200，成功打印 boot URL；超时则告警并提示查日志。
  — 证据：`.workspace/deploy-lag/dsh-restart.sh:191`「    if curl -sf "$SMOKE_URL" >/dev/null 2>&1; then」
  — 证据：`.workspace/deploy-lag/dsh-restart.sh:192`「      note "✅ boot OK（${i}s）: $SMOKE_URL（HTTP 200 冒烟通过）"」
  — 证据：`.workspace/deploy-lag/dsh-restart.sh:196`「  note "警告：${BOOT_WAIT}s 内未就绪：请查 $LOG_FILE（进程可能仍在 boot；会话自动 resume 无需手动恢复）"」
- `--yes` / `--watch` / `--stop` / `--dry-run` / `--force` / `--pid` / `--debounce` / `--poll` 均在参数解析表中。
  — 证据：`.workspace/deploy-lag/dsh-restart.sh:296`「    --yes) YES=1; shift ;;」
  — 证据：`.workspace/deploy-lag/dsh-restart.sh:299`「    --watch) WATCH_MODE=1; shift」
  — 证据：`.workspace/deploy-lag/dsh-restart.sh:302`「    --stop) STOP_DAEMON=1; shift ;;」
  — 证据：`.workspace/deploy-lag/dsh-restart.sh:295`「    --dry-run) DRY_RUN=1; shift ;;」
  — 证据：`.workspace/deploy-lag/dsh-restart.sh:297`「    --force) FORCE=1; shift ;;」
  — 证据：`.workspace/deploy-lag/dsh-restart.sh:298`「    --pid) PID_ARG="${2:-}"; [ -n "$PID_ARG" ] || { note "--pid 需要参数"; exit 2; }; shift 2 ;;」
- `--yes` 的必要性：非交互环境若未给 `--yes` 则**跳过并 exit 2**（防自动化误重启）。
  — 证据：`.workspace/deploy-lag/dsh-restart.sh:147`「    note "非交互环境：未加 --yes，跳过确认（预览请用 --dry-run；自动化请显式 --yes）"」
  — 证据：`.workspace/deploy-lag/dsh-restart.sh:148`「    [ "$hard" -eq 1 ] && exit 2」
- `--dry-run` 走完全流程但**零副作用**（不发信号、不启动进程）。
  — 证据：`.workspace/deploy-lag/dsh-restart.sh:206`「    note "== dry-run 结束：以上仅为预览，未发送任何信号、未启动任何进程 =="」
- 默认动作即「一键重启当前 dsh web（同 profile、同启动方式；先 dry-run 预览 + 交互确认）」。
  — 证据：`.workspace/deploy-lag/dsh-restart.sh:11`「#   dsh-restart                       一键优雅重启当前 dsh web（同 profile、同启动方式；」
  — 证据：`.workspace/deploy-lag/dsh-restart.sh:12`「#                                     先打印 dry-run 预览 + 交互确认；--yes 跳过确认）」
- **PID 守卫（回答「20806 是不是宿主？脚本会不会乱杀」）**：目标进程由 `/proc/<pid>/cmdline` 校验必须含 `bin/dsh` + ` web`，只向通过校验者发信号。
  — 证据：`.workspace/deploy-lag/dsh-restart.sh:95`「  tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -qE "bin/dsh.* web"」
  — 证据：`.workspace/deploy-lag/dsh-restart.sh:123`「    note "进程校验: /proc cmdline 含 bin/dsh + web ✓（仅向该校验通过的进程发信号）"」
- 发现**多个** dsh web 进程时拒绝猜测、要求 `--pid`（多实例安全闸）；`--pid` 校验失败也拒绝。
  — 证据：`.workspace/deploy-lag/dsh-restart.sh:112`「    note "发现多个 dsh web 进程：${pids[*]} —— 请用 --pid 指定（本脚本拒绝猜测）"」
  — 证据：`.workspace/deploy-lag/dsh-restart.sh:108`「    note "拒绝：--pid $PID_ARG 不是 dsh web 进程（/proc cmdline 校验失败）"」
- 0 个候选进程时「仅启动新实例，不杀任何进程」。
  — 证据：`.workspace/deploy-lag/dsh-restart.sh:131`「    note "未发现运行中的 dsh web 进程 → 将仅启动新实例（不杀任何进程）"」
- `--stop` 只杀 watcher daemon，**明确不动 dsh web 进程**，且校验 pidfile 进程命令行匹配 `dsh-restart*--watch*` 否则拒杀。
  — 证据：`.workspace/deploy-lag/dsh-restart.sh:279`「      note "SIGTERM -> watch daemon pid=$dpid（只杀 watcher，不动 dsh web 进程）"」
  — 证据：`.workspace/deploy-lag/dsh-restart.sh:285`「      note "pidfile 进程不是 dsh-restart watch（$cmd）：拒绝杀。请手动处理并删除 $PIDFILE"」
- watch 默认监视面 = 自装 `@local` 宿主 lib + 全局补丁包树（两处最高频改动源）。
  — 证据：`.workspace/deploy-lag/dsh-restart.sh:316`「      "$HOME/.dsh/profiles/node_modules/@local"」
  — 证据：`.workspace/deploy-lag/dsh-restart.sh:317`「      "$HOME/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai"」
- 日志与 pidfile 落位 `~/.dsh/backups/`，>2MB 轮转为 `.1`。
  — 证据：`.workspace/deploy-lag/dsh-restart.sh:52`「LOG_FILE="${DSH_RESTART_LOG:-$HOME/.dsh/backups/dsh-restart.log}"」
  — 证据：`.workspace/deploy-lag/dsh-restart.sh:54`「PIDFILE="$HOME/.dsh/backups/dsh-restart-watch.pid"」
  — 证据：`.workspace/deploy-lag/dsh-restart.sh:69`「  if [ -f "$LOG_FILE" ] && [ "$(wc -c < "$LOG_FILE" 2>/dev/null || echo 0)" -gt 2097152 ]; then」
- 会话在重启后无需手动 resume（zstd JSONL 持久化 + 浏览器自动重连），只有「进行中回合」的内存态会丢。
  — 证据：`.workspace/deploy-lag/dsh-restart.sh:35`「#   会话持久化为 zstd JSONL（~/.dsh/sessions/<workspace>/<sid>/session.jsonl.zstd）+ checkpoint；」
  — 证据：`.workspace/deploy-lag/dsh-restart.sh:36`「#   重启后浏览器自动重连（client-connection 重连/心跳补丁）；仅「进行中回合」的内存态丢失（需重发）。」

### A4. 端口 / profile / 符号链接农场事实

- **默认端口是 3080（唯一监听者 = dsh web 宿主 PID）**，见 A0 的命令实测与脚本常量。
  — 证据：`.workspace/deploy-lag/dsh-restart.sh:26`「#   DSH_WEB_URL              冒烟 URL（默认 http://127.0.0.1:3080/）」
- **profile 层结构与「web profile 路径」**：`~/.dsh/profiles/` 下并列 `node_modules/`（共享依赖层）、`web/`（运行 profile）、`.backup-p0-20260914-112357`。
  — 证据：`ls -la /home/CNS2026495165/.dsh/profiles/` 实测输出含「node_modules」「web」「.backup-p0-20260914-112357」（非文件证据，命令实测）
- **`~/.dsh/profiles/web` 自身没有 `node_modules` 目录**（实测 ENOENT）——依赖解析来自共享的 `~/.dsh/profiles/node_modules` 农场。
  — 证据：`ls -ld /home/CNS2026495165/.dsh/profiles/web/node_modules` 实测「没有那个文件或目录」（非文件证据，命令实测）
- **该农场确实是符号链接农场**：`~/.dsh/profiles/node_modules/` 顶层大量条目为指向全局安装树的符号链接。
  — 证据：`ls -la /home/CNS2026495165/.dsh/profiles/node_modules/` 实测「accepts -> /home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/accepts」（非文件证据，命令实测）
- **自装插件位**是该农场的 `@local/`（真实目录，非链接）：`dsh-btw`/`dsh-pptmaster`/`dsh-ssh-gui`/`dsh-subagent-model`/`dsh-usage`/`dsh-wallpaper`/`dsh-workerspace`。
  — 证据：`ls -la /home/CNS2026495165/.dsh/profiles/node_modules/@local/` 实测目录清单（非文件证据，命令实测）
- **README 的仓库级警戒（逐字）**：`~/.dsh/profiles/*` 为符号链接农场，**绝不对 `~/.dsh/profiles/web` 执行 npm/pnpm install**，因为曾致全体补丁失效。
  — 证据：`README.md:162`「- DSH 本体（当前 0.1.1-rc.2，全局安装于 `~/.npm-global/...`；`~/.dsh/profiles/*` 为符号链接农场，**绝不对 `~/.dsh/profiles/web` 执行 npm/pnpm install**——曾致全体补丁失效，见 master-runbook §1b）」
- 事故档给出成因与防复发约定：`npm install --prefix ~/.dsh/profiles/web ssh2` 会把 198 个 @deepseek-ai 包装成未打补丁的本地副本，绕回全部补丁。
  — 证据：`.workspace/master-runbook.md:35`「**根因**：`npm install --prefix ~/.dsh/profiles/web ssh2@^1.16.0`（部署 dsh-workerspace 时）会读取」
  — 证据：`.workspace/master-runbook.md:37`「`profiles/web/node_modules/@deepseek-ai/`——运行进程优先加载这些副本，**②b 非流式 / mux+FrameQueue 加固 /」
  — 证据：`.workspace/master-runbook.md:44`「**⚠️ 防复发（写入约定）**：**绝不对 `~/.dsh/profiles/web` 执行任何 npm/pnpm install**。」
- 该禁令在 `.workspace` 内被二次引用为架构选择依据（"profile 层真实目录 fork"的代价说明）。
  — 证据：`.workspace/settings-lag/audit-rebuild.md:307`「- 代价：profile 层从此与全局树分叉（升级不同步）；`README.md:162` 明确禁止在 `profiles/web` 跑 npm/pnpm install。」
- web profile 的形态证据：`pnpm-workspace.yaml` 声明 hoisted linker 且 packages 仅 `.`（即不会有 profile 私有依赖树）。
  — 证据：`~/.dsh/profiles/web/pnpm-workspace.yaml:1`「packages:」（`packages: - .` / `nodeLinker: hoisted` / `autoInstallPeers: false`，文件共 6 行）
- web profile 的 `package.json` 声明 profile 名、bundle 列表与 `patchReload: "live"`。
  — 证据：`~/.dsh/profiles/web/package.json`「"name": "dsh-profile-web"」与「"patchReload": "live"」（文件共 17 行）
- **重要限定**：`replay-lag-fix.sh` 自称「本环境 pnpm 不可用，勿依赖」，但 `.workspace/settings-lag/audit-rebuild.md:153` 判定该说法**已过期**（pnpm 二进制存在，只是无工程可 build）。文档写作时勿沿用旧结论。
  — 证据：`.workspace/deploy-lag/replay-lag-fix.sh:28`「#       node（--check）/ python3 + pyyaml。本环境 pnpm 不可用，勿依赖。」
  — 证据：`.workspace/settings-lag/audit-rebuild.md:153`「`pnpm` 二进制**存在**（`~/.npm-global/bin/pnpm`，注意旧脚本 `replay-lag-fix.sh` 里"本环境 pnpm 不可用"的说法已过期），」

### A5. 验收 / 冒烟程序（master-runbook + acceptance-exec）

- `master-runbook.md` §0「已部署清单」给出「线 / 内容 / 部署位」三列部署台账（卡顿修复、btw v2、btw P0、usage、识图、ppt-master、workerspace、插件基线共 9 行）。
  — 证据：`.workspace/master-runbook.md:8`「| 线 | 内容 | 部署位 |」
- §1「六项启动问题修复确认」= 6 行「报错 / 修复（已应用）/ 验证」验收表。
  — 证据：`.workspace/master-runbook.md:20`「## 1. 六项启动问题修复确认（2026-09-14 实测全部解决）」
  — 证据：`.workspace/master-runbook.md:22`「| # | 报错 | 修复（已应用） | 验证 |」
- §1b 是**事故档**（见 A4），标题逐字为「npm 遮蔽导致补丁集体失效」。
  — 证据：`.workspace/master-runbook.md:33`「## 1b. 重大事故记录：npm 遮蔽导致补丁集体失效（2026-09-15 根因，已修复）」
- §2「重启与静态核验」= 4 条命令（`npx @deepseek-ai/dsh web`；curl 3080 抓 boot graph；grep settings；ls skill）。
  — 证据：`.workspace/master-runbook.md:49`「## 2. 重启与静态核验」
  — 证据：`.workspace/master-runbook.md:52`「npx @deepseek-ai/dsh web」
- §3「GUI 验收矩阵」= 9 行「项 / 操作 / 期望」矩阵（btw P0、btw 图片、btw 面板、btw 跳转、usage、识图、ppt-master、workerspace、回归）。
  — 证据：`.workspace/master-runbook.md:59`「## 3. GUI 验收矩阵」
  — 证据：`.workspace/master-runbook.md:61`「| 项 | 操作 | 期望 |」
- §4「回滚」= 4 类回滚路径：P0 官方补丁 `patch -R`；lib 从 backup-* 还原；卡顿修复跑 `replay-lag-fix.sh --rollback`；插件移除走 cordis.patch.yml 备份。
  — 证据：`.workspace/master-runbook.md:73`「## 4. 回滚」
  — 证据：`.workspace/master-runbook.md:80`「cd /home/CNS2026495165/dsh/.workspace/deploy-lag && bash replay-lag-fix.sh --rollback」
  — 证据：`.workspace/master-runbook.md:82`「# 全部备份：.workspace/backup-*、~/.dsh/profiles/.backup-p0-*」
- `acceptance-exec.md` §0 是「与交接材料的事实偏差（实测修正）」表 —— 明确「不以"生成成功"代替验收」。
  — 证据：`.workspace/acceptance-exec.md:10`「## 0. 与交接材料的事实偏差（实测修正）」
  — 证据：`.workspace/acceptance-exec.md:7`「- **所有结论均由本节原始输出支撑；未取到的证据一律标 ⏳/⚠️，不以"生成成功"代替验收**」
- §1「P0 四项」首项 P0-1「重启存活」给出**完整冒烟四证据链**：ps 包装链 + `ss -ltnp | grep 3080` + `curl -w http_code` + 旧 PID 已消失。
  — 证据：`.workspace/acceptance-exec.md:23`「## 1. P0 四项」
  — 证据：`.workspace/acceptance-exec.md:25`「### P0-1 重启存活 ✅ 通过」
  — 证据：`.workspace/acceptance-exec.md:38`「$ curl -s -o /dev/null -w 'http_code=%{http_code}\n' http://127.0.0.1:3080/」
- P0-1 的**判据一句话**（可直接抄进 runbook 作为通过标准）。
  — 证据：`.workspace/acceptance-exec.md:43`「**判据**：3080 由单一进程持有、HTTP 200、旧 PID 消失 → 重启发生且唯一实例在服务。」
- §3.1 预检结论 = GO + 1 红灯（R1：回滚 glob 展开 0 个文件，按字面回滚会失败）+ 黄灯（btw 备份态不等于 live）。
  — 证据：`.workspace/acceptance-exec.md:19`「| 6 | 备份与回滚路径 | **NO-GO（1 处红灯）** | 5 个回滚目标中 **4 个真实可解析**；但 §3 表格第 4 行 `dsh-tool-subagent.index.js.bak-*.bak` 的 glob **实际解析为 0 个文件**（见 §6 红灯 R1），按字面执行会导致回滚静默失败 |」（引文出自 `.workspace/acceptance-probe/preflight.md:19`）
  — 证据：`.workspace/acceptance-exec.md:210`「- **红灯 R1（回滚失效类）**：`RESTART-ACCEPTANCE.md` §3 第 4 行 glob `...index.js.bak-*.bak` 实测展开 **0 个文件** → 按字面回滚会失败。最小修复：去掉多余的 `.bak`（或写死 `…bak-20260917-165928`）。→ 纳入文档回写。」
- §3.2 给出**测试验收的量化基线**（该批次）：全量 24 files / 231 passed / 2 skipped；单文件隔离复跑 10/10 PASS。
  — 证据：`.workspace/acceptance-exec.md:237`「run1/2/3:  Test Files 24 passed (24) | Tests 231 passed | 2 skipped (233)」
  — 证据：`.workspace/acceptance-exec.md:233`「PASS=10  FAIL=0」
- §4 记录「仍未做」项（历史重写暂缓、ssh-gui/workerspace 未接真机、除 v4.1-flash 外窗口值为声明值而非实测）——文档需保留这些 ⏳ 标记。
  — 证据：`.workspace/acceptance-exec.md:354`「- `dsh-ssh-gui` / `dsh-workerspace` 真机实测 —— 你本轮选择不接真机（未排期）。」
- §5 列出本轮后台事实档（acceptance-probe/*）——可作为 runbook 的证据目录清单。
  — 证据：`.workspace/acceptance-exec.md:365`「## 5. 本轮后台事实档与产物」

### A6. 测试架构（各自撰插件：test 命令 + 测试文件盘点；**未运行任何测试**）

| 插件 | 仓库路径 | test 命令 | 测试文件数 | 证据 |
|---|---|---|---|---|
| `dsh-btw` | `dsh-btw/`（git 跟踪 107 文件） | `vitest run` | **24**（`tests/**/*.spec.{ts,tsx}`） | 见下 |
| `dsh-usage` | `dsh-usage/`（`@local/dsh-usage`） | `node test/verify.mjs` | **3**（test/verify.mjs、test/bundle-smoke.mjs、test/verify-result.json） | 见下 |
| `dsh-taste` | `dsh-taste/`（`@deepseek-ai/dsh-taste`） | `node --test "test/*.test.js"` | **11** | 见下 |
| `dsh-wallpaper-local` | `dsh-wallpaper-local/`（`@local/dsh-wallpaper`） | **无测试脚本、无测试目录** | **0** | 见下 |
| `session-board` | `session-board/dsh-session-board/` | `node --test`（提案口径） | **2** | 见下 |

- **dsh-btw 是唯一在 `package.json` 里声明 test 脚本的插件**：`"test": "vitest run"`，且 `check` 串起 lint→typecheck→test→build→smoke→publint。
  — 证据：`dsh-btw/package.json:64`「    "test": "vitest run",」
  — 证据：`dsh-btw/package.json:66`「    "check": "pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run build && pnpm run smoke && publint --level error"」
- dsh-btw 测试面由 vitest 配置限定为 `tests/**/*.spec.{ts,tsx}`，且空测试集**判失败**。
  — 证据：`dsh-btw/vitest.config.ts:3`「export default defineConfig({ test: { include: ['tests/**/*.spec.{ts,tsx}'], passWithNoTests: false } })」
- dsh-btw 测试文件清单（24 个，全部位于 `dsh-btw/tests/`）：banner-theme / capability-detect / controller / host-activity / host-image / host-lease / host-list / host-opening / host-persistence / host-recovery / jump-list / overlay-measurement / overlay-placement / package-contract / presentation / prompt-transform / readme-mermaid / remote-contract / safe-boundary / side-chat-surface / sign-contract / tool-policy / view-store / vision-template（后缀 .spec.ts 或 .spec.tsx）。
  — 证据：`find dsh-btw -type f \( -name '*.test.*' -o -name '*.spec.*' \)` 实测 24 个，目录 `dsh-btw/tests`（非文件证据，命令实测）
- dsh-btw 另有构建冒烟脚本（非 vitest）：`scripts/smoke-build.mjs`，由 `smoke` 脚本调用。
  — 证据：`dsh-btw/package.json:65`「    "smoke": "node scripts/smoke-build.mjs",」
- dsh-btw 上游 CI 的等价门 = `pnpm run check`（即跑同一套 test；CI 用 pnpm 而本机 pnpm 无网不可用）。
  — 证据：`dsh-btw/.github/workflows/ci.yml:40`「      - run: pnpm run check」
- **dsh-usage 的 `package.json` 没有 `scripts` 段**（grep `"scripts"` 零命中）——测试走独立验收脚本，命令写在脚本头注释里。
  — 证据：`dsh-usage/package.json` 无 `"scripts"` 字段（全文 47 行，逐行 grep 无命中）
  — 证据：`dsh-usage/test/verify.mjs:3`「 * 独立运行：`node test/verify.mjs`。输出 JSON 汇总（test/verify-result.json），」
- dsh-usage 验收脚本覆盖面很宽（U04 zstd / U05 db / U06 dsh 全量对账 / U07 cc 全量对账 / U08 rpc 9 端点 …）。
  — 证据：`dsh-usage/test/verify.mjs:7`「 *   U04 zstd：真实文件行数/首行/completeBytes；合成撕裂帧 tornStart；双帧扫描。」
  — 证据：`dsh-usage/test/verify.mjs:19`「 *   U08 rpc：registerUsageRpc 用 ctx stub 注册 `/usage`，9 端点逐一调用返回」
- **dsh-taste 的 `package.json` 也没有 `scripts` 段**；测试命令写在 README/REVIEW 中，用 node 内置 runner。
  — 证据：`dsh-taste/README.md:129`「cd /home/CNS2026495165/dsh/dsh-taste && node --test "test/*.test.js"」
  — 证据：`dsh-taste/REVIEW.md:12`「| 测试套件 | `cd dsh-taste && node --test "test/*.test.js"` | **106/106 pass / 0 fail / 0 skip**（suites 22） |」
- dsh-taste 测试文件清单（11 个，`dsh-taste/test/`）：backfill / bridge / client / collector / config / index / learner / learner-tools / model-registry / queue / storage（均 `.test.js`）。
  — 证据：`find dsh-taste -type f -name '*.test.*'` 实测 11 个，目录 `dsh-taste/test`（非文件证据，命令实测）
- **dsh-wallpaper-local 无任何测试**：`package.json` 无 scripts 段、无 `test/` 或 `tests/` 目录、无 `*.test.*`/`*.spec.*` 文件。
  — 证据：`dsh-wallpaper-local/package.json` 无 `"scripts"` 字段；`ls -la dsh-wallpaper-local/` 实测只有 assets/cordis.patch.yml/install.sh/lib/LICENSE/package.json/README*（非文件证据，命令实测）
- **session-board 亦无 test 脚本**（内层 `package.json` 无 scripts 段），测试命令只在提案档中以 `node --test` 口径给出。
  — 证据：`session-board/dsh-session-board/package.json` 无 `"scripts"` 字段（全文 18 行）
  — 证据：`session-board/FIX-PROPOSAL.md:357`「> 目标：`node --test`（或 `node test/*.mjs`）零新增依赖可跑。测试 a 仅用 node 内置模块，可在源码树」
- session-board 测试文件清单（2 个，`session-board/dsh-session-board/test/`）：`grouping-ttl.test.mjs`、`unified-source.test.mjs`。
  — 证据：`find session-board -type f \( -name '*.test.*' -o -name '*.spec.*' \)` 实测 2 个（非文件证据，命令实测）
  — 证据：`session-board/FIX-NOTES.md:39`「- **测试**：`test/grouping-ttl.test.mjs`（TTL 注入缩短 + 假解析器，验证再解析/原子替换/不抖动/」
- **注意（写作时勿踩）**：`.workspace/acceptance-exec.md` 记录 dsh-btw 全量 vitest 首跑曾 1 failed，但隔离复跑 10/10 与全量复跑 3 次均全绿，定性为**负载敏感 flake 且已加固**，不是回归。
  — 证据：`.workspace/acceptance-exec.md:213`「### 3.2 vitest 实测与交接声称不符 ⚠️ 判定为负载敏感 flake（非回归）」
  — 证据：`.workspace/acceptance-exec.md:246`「结论：**负载敏感的测试缺陷，不是 btw 本批次改动引入的回归**。已按裁决加固：`tests/host-opening.spec.ts:145` 的固定 tick 轮询改为 wall-clock 上限 10s 的条件等待」

### A7. 备份布局与 gitignore

**.workspace/backup-\*（仓库内，14 个）**：backup-batch-20260914-142844、backup-batch2-20260914-142947、backup-btw-20260917-170146、backup-btw-20260917-172915、backup-btw-deploy-20260912-165932、backup-btw-deploy-20260912-180420-lib、backup-config、backup-methodology-20260912-164548、backup-methodology-20260912-164933、backup-patched、backup-plugins、backup-subagent-model-20260917-165928、backup-usage-heatmap-20260914-094352、backup-ws-20260914-145449。
  — 证据：`ls -d .workspace/backup-*` 实测 14 个目录（非文件证据，命令实测）
- 这一族整体被 gitignore 覆盖（`git check-ignore -v` 命中）。
  — 证据：`.gitignore:22`「.workspace/backup-*/」
  — 证据：`git check-ignore -v .workspace/backup-btw-20260917-170146` 实测「.gitignore:22:.workspace/backup-*/」（非文件证据，命令实测）

**.workspace/deploy-\*/backup-\*（部署脚本自建，仅 3 个）**：deploy-lag/backup-015-20260915-162541、deploy-lag/backup-20260912-160759、deploy-lag/backup-20260912-160832、deploy-slots/backup-20260915-162522。
  — 证据：`ls -d .workspace/deploy-*/backup-*` 实测（非文件证据，命令实测）
- **只有 `deploy-lag/` 的备份被 ignore**；`deploy-slots/backup-*` 实测 **NOT-IGNORED**（会入库）——文档/清理策略需要点出这个不一致。
  — 证据：`.gitignore:23`「.workspace/deploy-lag/backup-*/」
  — 证据：`git check-ignore -v .workspace/deploy-slots/backup-20260915-162522` 实测无命中「NOT-IGNORED」（非文件证据，命令实测）
- 同理 `.workspace/deploy-015/`（12 包补丁源与 known-sha256）**未被 ignore**。
  — 证据：`git check-ignore -v .workspace/deploy-015` 实测「NOT-IGNORED」（非文件证据，命令实测）
- `node_modules` 与其符号链接农场被仓库级 ignore 覆盖。
  — 证据：`.gitignore:1`「# 依赖与链接（指向 DSH profile node_modules 的环境特定符号链接）」
  — 证据：`.gitignore:3`「**/node_modules/」

**~/.dsh/backups/（仓库外，15 个条目 + 1 子目录）**：含 settings.yaml 的 5 个 .bak、cordis.patch.yml.bak-*、AGENTS.md/FEATURE-MAP.md/taste.md/project-taste.md 的 .bak、host lib 的 `dsh-tool-subagent.index.js.bak-*` / `goal-round-driver.index.js.*.bak` / `vision-adam.*.bak`、`dsh-btw.lib.bak-*` 目录、两个 tar.gz（btw-p0b-prev / usage-p0b-prev），以及 dsh-restart 自己的两个日志。
  — 证据：`ls -la /home/CNS2026495165/.dsh/backups/` 实测 22 行条目（非文件证据，命令实测）
- `~/.dsh/backups/` 在仓库外，**不受本仓库 .gitignore 管辖**（无 `.gitignore` 覆盖它的规则）。
  — 证据：`.gitignore` 全文 32 行，无任何 `~/.dsh` 或 `backups` 路径规则（仅 `.workspace/*` 系列与 node_modules/编辑器/运行产物）
- 每行脚本的**回滚基准就是「最新备份」**（前缀匹配 + 时间戳排序取尾）。
  — 证据：`.workspace/deploy-lag/patch-official-015.sh:207`「  latest="$(ls -d "$BACKUP_ROOT"/backup-015-* 2>/dev/null | sort | tail -n 1)"」
  — 证据：`.workspace/deploy-slots/patch-official-slots.sh:126`「  latest="$(ls -d "$BACKUP_ROOT"/backup-* 2>/dev/null | sort | tail -n 1)"」
- 部分脚本明确提示「回滚后需重启 DSH」。
  — 证据：`.workspace/deploy-lag/patch-official-015.sh:220`「  say "回滚完成。请重启 DSH（npx @deepseek-ai/dsh web）使宿主侧改动生效。"」
  — 证据：`.workspace/deploy-slots/patch-official-slots.sh:145`「  say "请重启 DSH（npx @deepseek-ai/dsh web）并刷新浏览器使客户端改动生效。"」
- 回滚成功性自身也要断言（slots 脚本回滚后检查锚点是否真的消失）——这是可写进 runbook 的"回滚验证"范式。
  — 证据：`.workspace/deploy-slots/patch-official-slots.sh:141`「    warn "回滚后锚点仍命中（remoteHosts 仍存在）——请人工检查备份时间戳与 live 文件"」
- 部署脚本族还有一条通用约定：**默认 dry-run，真实安装必须 `--apply`，且「绝不执行 npm/pnpm install」**。
  — 证据：`.workspace/deploy-ssh-gui/deploy.sh:5`「#   - 默认 **dry-run**：只打印将执行的命令与将写入的片段，绝不改动 ~/.dsh；」
  — 证据：`.workspace/deploy-workerspace/deploy.sh:6`「#   - `--apply`：由操作者在目标机上显式执行真实安装（本仓库交付时不代为执行）；」

---

## B. UNVERIFIED / 未知

- **`--watch` 模式的真机行为未核实**：本档只读，未运行 `dsh-restart.sh --watch`；其防抖/自动重启逻辑仅由源码阅读确认（`snapshot()` md5 聚合、防抖窗口、`do_restart 0` 软确认分支）。
  — 证据：`.workspace/deploy-lag/dsh-restart.sh:233`「      note "检测到 .js 变更 → 进入防抖窗口（${DEBOUNCE_SECS}s，防保存风暴）"」（源码在，行为未实测）
- **deploy-lag README 的支持矩阵中记录的运行实例 PID（2437836）已过期**：采集时点实例为 PID 20806，文档若引用 PID 必须标注时点或改引「谁持有 3080」的判定法。
  — 证据：`.workspace/deploy-lag/README.md:134`「### 9.1 支持矩阵（实测或代码实证；运行实例 = `dsh web` PID 2437836 @ 127.0.0.1:3080）」（与采集时点实测 PID 20806 不符）
- **`dsh-usage` / `session-board` 的测试「实际通过状况」未核实**：按指令未运行任何测试（可能很慢）；仅报告命令与文件盘点。dsh-usage 的 `test/verify-result.json` 是历史产物（mtime 09-12），不代表当前树状态。
  — 证据：`.workspace/usage-chart-audit.md:544`「  - `~/.dsh/profiles/node_modules/@local/dsh-usage/data/verify.db`、`smoke.mjs`、`test/verify.mjs` 等测试资产未纳入本次审计（与趋势图渲染路径无关）。」
- **`acceptance-probe/probe-channel-availability.sh` 写好了但未运行**（本轮明确不消耗配额），其结论不存在。
  — 证据：`.workspace/acceptance-exec.md:375`「| `.workspace/acceptance-probe/probe-channel-availability.sh` | **已写好未运行**：v4.1-flash vs v4-flash 通道可用率对比脚本（按你指示不再消耗配额） |」
- **R1 红灯是否已在文档层修复未核实**：acceptance-exec 称"纳入文档回写"，但仓库内 **不存在 `docs/` 目录**，`docs/architecture/04-*.md` 与 `docs/runbooks/*` 均为待创建目标。
  — 证据：`ls -la /home/CNS2026495165/dsh/docs/` 实测「没有那个文件或目录」（非文件证据，命令实测）
- **`~/.dsh/profiles/web2/` 的存在性/状态未核实**：仅见文档称其为「0.1.5 归档树、已废弃」，本档未 `ls` 该路径。
  — 证据：`.workspace/settings-lag/audit-rebuild.md:147`「`~/.dsh/profiles/web2/`（0.1.5 归档树，见 `.workspace/lag-audit-diff.md` §6）同样是**产物树**，非源码。」
- **「哪个备份对应哪个 live 态」不可保证**：acceptance-exec 明示现存两个 btw 备份都不等于 live 当前态，回滚会连带退掉后续单元 —— 文档做回滚指引时必须保留该警告。
  — 证据：`.workspace/acceptance-exec.md:211`「- **黄灯**：btw 回滚目标 `backup-btw-20260917-170146` 是 v4.1 之前的更早态，回滚会连带退掉 P0-b 热读等后续单元；现存两个 btw 备份都不等于 live 当前态。」
- **本档未执行任何 `.workspace/deploy-*/` 脚本**（按任务约束），故「脚本在当前盘面上实跑是否 PASS」一律 Unknown；所有 fail-closed 结论均来自源码逐行阅读。
- **PID 20806 的启动方式来源**：`ps` 显示其父为 20805（`npm exec` 包装链），但采集时点未读取父进程完整命令行，故"是否由 dsh-restart.sh 启动"未知。
  — 证据：`ps -p 20806 -o pid=,ppid=,args=` 实测「20806 20805 node /home/CNS2026495165/.npm-global/bin/dsh web」（非文件证据，命令实测）
