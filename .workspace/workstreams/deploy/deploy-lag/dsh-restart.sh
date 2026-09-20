#!/usr/bin/env bash
# ============================================================================
# dsh-restart — DSH web 优雅重启 / 宿主 lib 变更自动重启辅助（P0-c）
#
# 与既有脚本的分工（先读这条）:
#   replay-lag-fix.sh / patch-official-015.sh = 补丁重放（把补丁写进全局树 lib 文件），管「改代码」；
#   dsh-restart.sh                            = 进程编排（SIGTERM 有界等待 → 重启 → 冒烟 200），管「重启进程」。
#   两者正交：先跑补丁脚本（改代码），再跑本脚本（让新代码生效）；本脚本不写任何 lib 文件。
#
# 用法:
#   dsh-restart                       一键优雅重启当前 dsh web（同 profile、同启动方式；
#                                     先打印 dry-run 预览 + 交互确认；--yes 跳过确认）
#   dsh-restart --dry-run             走完整个重启流程但只打印（目标进程/命令/冒烟），零副作用
#   dsh-restart --watch <dir...>      监视宿主 lib .js 变更，防抖 Ns 自动重启（Ctrl+C 退出）
#   dsh-restart --watch --daemon [<dir...>]  后台 watch（日志文件 + pidfile；--stop 停止）
#   dsh-restart --stop                停止 watch daemon（只杀 watcher，不动 dsh web 进程）
#   dsh-restart --pid <pid>           指定目标 dsh web 进程（多实例时，本脚本拒绝猜测）
#   dsh-restart --force               SIGTERM 有界等待超时后 SIGKILL（默认超时即中止，不杀）
#   dsh-restart --yes                 跳过交互确认（脚本/自动化调用；非交互环境必须显式给）
#   dsh-restart --debounce <sec>      watch 防抖窗口（默认 2）
#   dsh-restart --poll <sec>          watch 轮询间隔（默认 1）
#   dsh-restart --help
#
# 环境变量:
#   DSH_RESTART_CMD          重启命令（默认 npx --no-install @deepseek-ai/dsh web，即 dsh web=profile web）
#   DSH_WEB_URL              冒烟 URL（默认 http://127.0.0.1:3080/）
#   DSH_RESTART_DEBOUNCE     防抖秒数（默认 2）
#   DSH_RESTART_POLL         轮询秒数（默认 1）
#   DSH_RESTART_STOP_WAIT    SIGTERM 有界等待秒数（默认 15；dispose 5s + 余量）
#   DSH_RESTART_BOOT_WAIT    重启后冒烟等待秒数（默认 30）
#   DSH_RESTART_LOG          日志文件（默认 ~/.dsh/backups/dsh-restart.log，>2MB 轮转为 .1）
#   DSH_RESTART_WATCH_LOG    watch daemon 日志（默认 ~/.dsh/backups/dsh-restart-watch.log）
#
# 会话自动 resume（无需手动恢复）:
#   会话持久化为 zstd JSONL（~/.dsh/sessions/<workspace>/<sid>/session.jsonl.zstd）+ checkpoint；
#   重启后浏览器自动重连（client-connection 重连/心跳补丁）；仅「进行中回合」的内存态丢失（需重发）。
#
# 安全边界:
#   只对 /proc cmdline 校验通过的 dsh web 进程（含 bin/dsh + " web"）发信号；
#   默认 dry-run 预览 + 交互确认；--dry-run 不杀不启；不静默杀非 dsh 进程；
#   SIGKILL 仅在显式 --force 且超时后使用；所有动作留日志。
# ============================================================================
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAUNCH_CMD="${DSH_RESTART_CMD:-npx --no-install @deepseek-ai/dsh web}"
SMOKE_URL="${DSH_WEB_URL:-http://127.0.0.1:3080/}"
DEBOUNCE_SECS="${DSH_RESTART_DEBOUNCE:-2}"
POLL_SECS="${DSH_RESTART_POLL:-1}"
STOP_WAIT="${DSH_RESTART_STOP_WAIT:-15}"
BOOT_WAIT="${DSH_RESTART_BOOT_WAIT:-30}"
LOG_FILE="${DSH_RESTART_LOG:-$HOME/.dsh/backups/dsh-restart.log}"
WATCH_LOG="${DSH_RESTART_WATCH_LOG:-$HOME/.dsh/backups/dsh-restart-watch.log}"
PIDFILE="$HOME/.dsh/backups/dsh-restart-watch.pid"

DRY_RUN=0
WATCH_MODE=0
DAEMON=0
YES=0
FORCE=0
STOP_DAEMON=0
PID_ARG=""
TARGET_PID=""
WATCH_DIRS=()

# 日志：同时写 stderr 与日志文件（>2MB 轮转为 .1）
note() {
  local msg="[dsh-restart] $*"
  if [ -f "$LOG_FILE" ] && [ "$(wc -c < "$LOG_FILE" 2>/dev/null || echo 0)" -gt 2097152 ]; then
    mv -f "$LOG_FILE" "$LOG_FILE.1" 2>/dev/null || true
  fi
  printf '%s\n' "$msg" | tee -a "$LOG_FILE" >&2
}

usage() {
  awk '/^# ===+$/{c++; next} c==1{print substr($0,3)} c==2{exit}' "$0"
  exit 0
}

# ---- 进程发现（只读） ----
# node 主服务进程：cmdline 含 bin/dsh 且含 " web"（npm exec / sh -c 包装层不含 bin/dsh，天然排除）
find_server_pids() {
  # 排除自身管道自匹配：awk/ps/grep 与其父 shell 的命令行里同样含 "bin/dsh" 与 " web" 字串，
  # 会把它们自己当成宿主（实测导致「发现多个 dsh web 进程」误报）。只认真实 node 宿主。
  ps -eo pid=,args= 2>/dev/null | awk -v self="$$" '
    $1 == self {next}
    $0 ~ /awk|grep|ps -eo|dsh-restart/ {next}
    $0 ~ /node/ && $0 ~ /bin\/dsh/ && $0 ~ / web/ {print $1}
  '
}

# 启动命令来源证据（包装链，仅展示）：含 dsh 与 web、非 bin/dsh、非本脚本
find_wrappers() {
  ps -eo pid=,args= 2>/dev/null \
    | awk '$0 ~ /dsh/ && $0 ~ / web/ && $0 !~ /bin\/dsh/ && $0 !~ /dsh-restart/ {print "    PID " $0}'
}

is_dsh_web_pid() {
  local pid="$1"
  [ -r "/proc/$pid/cmdline" ] || return 1
  tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -qE "bin/dsh.* web"
}

# 解析目标 PID：0 个 → 空（调用方决定仅启动）；1 个 → 用之；多个/--pid 校验失败 → 报错退出
resolve_target() {
  local pids=() p
  mapfile -t pids < <(find_server_pids)
  if [ "${#pids[@]}" -eq 0 ]; then
    TARGET_PID=""
    return 0
  fi
  if [ -n "$PID_ARG" ]; then
    if is_dsh_web_pid "$PID_ARG"; then TARGET_PID="$PID_ARG"; return 0; fi
    note "拒绝：--pid $PID_ARG 不是 dsh web 进程（/proc cmdline 校验失败）"
    exit 2
  fi
  if [ "${#pids[@]}" -gt 1 ]; then
    note "发现多个 dsh web 进程：${pids[*]} —— 请用 --pid 指定（本脚本拒绝猜测）"
    exit 2
  fi
  TARGET_PID="${pids[0]}"
}

# ---- 预览 ----
preview() {
  note "== 预览（未执行任何杀/启动作）=="
  if [ -n "$TARGET_PID" ]; then
    note "目标进程: PID=$TARGET_PID  $(tr '\0' ' ' < /proc/$TARGET_PID/cmdline 2>/dev/null)"
    note "进程校验: /proc cmdline 含 bin/dsh + web ✓（仅向该校验通过的进程发信号）"
    local wrappers
    wrappers="$(find_wrappers)"
    if [ -n "$wrappers" ]; then
      note "启动命令来源（ps 推断的包装链，供确认同 profile/同启动方式）:"
      printf '%s\n' "$wrappers" | while IFS= read -r w; do note "$w"; done
    fi
  else
    note "未发现运行中的 dsh web 进程 → 将仅启动新实例（不杀任何进程）"
  fi
  note "将执行:"
  note "  1) SIGTERM -> ${TARGET_PID:-（无）}，有界等待 ${STOP_WAIT}s dispose"
  note "     （超时且未 --force → 中止重启不杀进程；已 --force → SIGKILL）"
  note "  2) 等进程退出 + 端口释放"
  note "  3) 启动: ${LAUNCH_CMD}  （后台分离，日志 ${LOG_FILE}）"
  note "  4) 冒烟: curl -sf ${SMOKE_URL} 轮询至 HTTP 200（上限 ${BOOT_WAIT}s），打印 boot URL"
  note "  5) 会话自动 resume：zstd JSONL 持久化 + 浏览器自动重连，无需手动恢复"
}

# 确认（hard=1 一次性模式：拒绝即退出；hard=0 watch 模式：拒绝即跳过本轮继续 watch）
confirm_or_exit() {
  local hard="${1:-1}"
  [ "$YES" -eq 1 ] && return 0
  if [ ! -t 0 ]; then
    note "非交互环境：未加 --yes，跳过确认（预览请用 --dry-run；自动化请显式 --yes）"
    [ "$hard" -eq 1 ] && exit 2
    return 1
  fi
  printf '[dsh-restart] 确认执行上述重启序列？[y/N] ' >&2
  local ans
  read -r ans
  case "$ans" in
    y|Y|yes|YES) return 0 ;;
    *) note "已取消" ; [ "$hard" -eq 1 ] && exit 1 || return 1 ;;
  esac
}

# ---- 停止 / 启动（有界、留痕） ----
stop_web() {
  local pid="$1" i=0
  note "SIGTERM -> PID $pid（有界等待 ${STOP_WAIT}s dispose）"
  kill -TERM "$pid" 2>/dev/null || { note "SIGTERM 失败（进程可能已退出）"; return 1; }
  while [ "$i" -lt "$STOP_WAIT" ]; do
    if ! kill -0 "$pid" 2>/dev/null; then note "进程已退出（${i}s）"; return 0; fi
    sleep 1; i=$((i + 1))
  done
  if [ "$FORCE" -eq 1 ]; then
    note "警告：${STOP_WAIT}s 后仍存活，--force 已给：SIGKILL -> PID $pid"
    kill -KILL "$pid" 2>/dev/null || true
    sleep 1
    if kill -0 "$pid" 2>/dev/null; then note "SIGKILL 后仍存活，中止"; return 1; fi
    return 0
  fi
  note "警告：${STOP_WAIT}s 后仍存活：默认中止重启（未杀进程）。可用 --force 或手动处理。"
  return 1
}

start_web() {
  mkdir -p "$(dirname "$LOG_FILE")"
  note "启动: $LAUNCH_CMD （后台分离，日志 $LOG_FILE）"
  if command -v setsid >/dev/null 2>&1; then
    ( cd "$HOME" && setsid bash -c "$LAUNCH_CMD" >>"$LOG_FILE" 2>&1 & )
  else
    nohup bash -c "$LAUNCH_CMD" >>"$LOG_FILE" 2>&1 &
  fi
  local i=0
  while [ "$i" -lt "$BOOT_WAIT" ]; do
    sleep 1; i=$((i + 1))
    if curl -sf "$SMOKE_URL" >/dev/null 2>&1; then
      note "✅ boot OK（${i}s）: $SMOKE_URL（HTTP 200 冒烟通过）"
      return 0
    fi
  done
  note "警告：${BOOT_WAIT}s 内未就绪：请查 $LOG_FILE（进程可能仍在 boot；会话自动 resume 无需手动恢复）"
  return 1
}

# ---- 重启序列（--dry-run 走完全流程只打印） ----
do_restart() {
  local hard="${1:-1}"
  resolve_target
  preview
  if [ "$DRY_RUN" -eq 1 ]; then
    note "== dry-run 结束：以上仅为预览，未发送任何信号、未启动任何进程 =="
    return 0
  fi
  confirm_or_exit "$hard" || return $?
  if [ -n "$TARGET_PID" ]; then
    stop_web "$TARGET_PID" || { note "停止阶段失败，取消重启"; return 1; }
  else
    note "未发现运行中的 dsh web 进程 → 直接启动新实例"
  fi
  start_web
}

# ---- watch：快照 + 防抖窗口 ----
snapshot() {
  find "$@" -type f -name '*.js' -print0 2>/dev/null \
    | sort -z | xargs -0 -r md5sum 2>/dev/null | md5sum | awk '{print $1}'
}

watch_loop() {
  local dirs=("$@")
  note "watch 模式: ${dirs[*]}（.js 变更 → 防抖 ${DEBOUNCE_SECS}s → 自动重启；Ctrl+C 退出；--dry-run 时仅预览）"
  local prev cur
  prev="$(snapshot "${dirs[@]}")"
  while true; do
    sleep "$POLL_SECS"
    cur="$(snapshot "${dirs[@]}")"
    if [ "$cur" != "$prev" ]; then
      note "检测到 .js 变更 → 进入防抖窗口（${DEBOUNCE_SECS}s，防保存风暴）"
      local stable=0 changed="$cur"
      while [ "$stable" -lt "$DEBOUNCE_SECS" ]; do
        sleep "$POLL_SECS"
        cur="$(snapshot "${dirs[@]}")"
        if [ "$cur" != "$changed" ]; then
          changed="$cur"; stable=0
          note "防抖窗口内又发生变更，重新计时"
        else
          stable=$((stable + POLL_SECS))
        fi
      done
      note "防抖结束（${DEBOUNCE_SECS}s 无新变更）→ 触发自动重启"
      do_restart 0
      prev="$(snapshot "${dirs[@]}")"
      note "基线已重建（继续 watch）"
    fi
  done
}

# ---- daemon 生命周期 ----
start_watch_daemon() {
  mkdir -p "$(dirname "$WATCH_LOG")"
  local args=( --watch "${WATCH_DIRS[@]}" )
  [ "$DRY_RUN" -eq 1 ] && args+=( --dry-run )
  [ "$YES" -eq 1 ]     && args+=( --yes )
  [ "$FORCE" -eq 1 ]   && args+=( --force )
  [ -n "$PID_ARG" ]    && args+=( --pid "$PID_ARG" )
  nohup bash "$0" "${args[@]}" >>"$WATCH_LOG" 2>&1 &
  local dpid=$!
  printf '%s\n' "$dpid" > "$PIDFILE"
  note "watch daemon 已启动 pid=$dpid（日志 $WATCH_LOG，pidfile $PIDFILE；停止: --stop）"
  exit 0
}

stop_watch_daemon() {
  if [ ! -f "$PIDFILE" ]; then note "无 watch daemon pidfile（$PIDFILE）"; exit 1; fi
  local dpid cmd
  dpid="$(cat "$PIDFILE")"
  if ! kill -0 "$dpid" 2>/dev/null; then
    note "pidfile 中的进程已不存在（$dpid），清理 pidfile"
    rm -f "$PIDFILE"; exit 0
  fi
  cmd="$(tr '\0' ' ' < "/proc/$dpid/cmdline" 2>/dev/null || true)"
  case "$cmd" in
    *dsh-restart*--watch*)
      note "SIGTERM -> watch daemon pid=$dpid（只杀 watcher，不动 dsh web 进程）"
      kill -TERM "$dpid" 2>/dev/null
      rm -f "$PIDFILE"
      exit 0
      ;;
    *)
      note "pidfile 进程不是 dsh-restart watch（$cmd）：拒绝杀。请手动处理并删除 $PIDFILE"
      exit 1
      ;;
  esac
}

# ---- 参数解析：默认动作 = 一键重启；标志只改行为 ----
while [ "$#" -gt 0 ]; do
  case "$1" in
    restart) shift ;;   # 显式动作词（可省，默认即 restart）
    --dry-run) DRY_RUN=1; shift ;;
    --yes) YES=1; shift ;;
    --force) FORCE=1; shift ;;
    --pid) PID_ARG="${2:-}"; [ -n "$PID_ARG" ] || { note "--pid 需要参数"; exit 2; }; shift 2 ;;
    --watch) WATCH_MODE=1; shift
      while [ "$#" -gt 0 ] && [ "${1#-}" = "$1" ]; do WATCH_DIRS+=("$1"); shift; done ;;
    --daemon) DAEMON=1; shift ;;
    --stop) STOP_DAEMON=1; shift ;;
    --debounce) DEBOUNCE_SECS="${2:-}"; case "$DEBOUNCE_SECS" in ''|*[!0-9]*) note "--debounce 需要正整数"; exit 2;; esac; shift 2 ;;
    --poll) POLL_SECS="${2:-}"; case "$POLL_SECS" in ''|*[!0-9]*) note "--poll 需要正整数"; exit 2;; esac; shift 2 ;;
    --help|-h) usage ;;
    *) note "未知参数: $1"; usage ;;
  esac
done

[ "$STOP_DAEMON" -eq 1 ] && stop_watch_daemon

if [ "$WATCH_MODE" -eq 1 ]; then
  if [ "${#WATCH_DIRS[@]}" -eq 0 ]; then
    # 默认监视面：自装 @local 插件宿主 lib + 全局补丁包树（最高频两个改动源）
    WATCH_DIRS=(
      "$HOME/.dsh/profiles/node_modules/@local"
      "$HOME/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai"
    )
  fi
  for d in "${WATCH_DIRS[@]}"; do
    [ -d "$d" ] || { note "watch 目录不存在: $d"; exit 2; }
  done
  if [ "$DAEMON" -eq 1 ]; then start_watch_daemon; fi
  watch_loop "${WATCH_DIRS[@]}"
else
  do_restart 1
  exit $?
fi
