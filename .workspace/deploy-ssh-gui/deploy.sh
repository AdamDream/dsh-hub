#!/usr/bin/env bash
# deploy.sh —— @local/dsh-ssh-gui（分布式控制）部署脚本（薄插件，零第三方依赖，绝不执行 npm/pnpm install）。
#
# 设计：
#   - 默认 **dry-run**：只打印将执行的命令与将写入的片段，绝不改动 ~/.dsh；
#   - `--apply`：由操作者在目标机上显式执行真实安装（本交付物代为生成，不代为执行）；
#   - `--rollback`：回滚（还原 cordis.patch.yml / settings.yaml 备份 + 删除插件拷贝）；
#   - 幂等：已存在条目/拷贝会跳过或给出提示。
#
# 用法：
#   bash deploy.sh                 # dry-run（打印全量计划）
#   bash deploy.sh --apply         # 真实安装（目标机，人工确认）
#   bash deploy.sh --rollback      # 回滚
#
# 约束遵守：绝不执行 npm/pnpm install --prefix ~/.dsh/profiles/web（会重新遮蔽全局补丁树）；
# 本插件零第三方依赖（ssh2 / dsh-* 全部复用底座与 DSH 自带包），无需任何安装步骤。
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROFILE_MODULES="${DSH_PROFILE_MODULES:-$HOME/.dsh/profiles/node_modules}"
PROFILE_DIR="${DSH_PROFILE_DIR:-$HOME/.dsh/profiles/web}"
PATCH_FILE="$PROFILE_DIR/cordis.patch.yml"
SETTINGS_FILE="${DSH_SETTINGS_FILE:-$HOME/.dsh/settings.yaml}"
PLUGIN_NAME="dsh-ssh-gui"
PLUGIN_NS="@local/$PLUGIN_NAME"
PLUGIN_SRC="$DEPLOY_DIR/$PLUGIN_NAME"
INSERT_ID="ssh-gui"

MODE="${1:-dry-run}"

log()  { printf '\033[1;36m[deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

# 幂等判断
patch_has() { grep -qF "$1" "$PATCH_FILE" 2>/dev/null; }
dir_has()   { [ -d "$1" ]; }

preflight() {
  node --version | grep -qE '^v2[2-9]' || warn "node >= 22 推荐（当前 $(node --version)）"
  [ -d "$PROFILE_MODULES" ] || die "profile 模块目录不存在：$PROFILE_MODULES"
  [ -f "$PROFILE_DIR/package.json" ] || die "profile 目录不存在：$PROFILE_DIR"
  # 底座必须在位（ctx.sshRegistry / /dsw 依赖它）
  [ -d "$PROFILE_MODULES/dsh-workspace-enhancement" ] \
    && log "preflight: 底座 dsh-workspace-enhancement 在位 ✓" \
    || die "preflight: 底座缺失 —— 请先部署 dsh-workspace-enhancement（deploy-workerspace）"
  # 语法自检
  for f in "$PLUGIN_SRC"/lib/*.js; do
    node --check "$f" >/dev/null 2>&1 && log "preflight: $f 语法 OK" || die "preflight: $f 语法错误"
  done
  # 单测（纯逻辑，不触网、不写 ~/.dsh）
  if ls "$DEPLOY_DIR"/test/*.test.mjs >/dev/null 2>&1; then
    node --test "$DEPLOY_DIR"/test/*.test.mjs >/dev/null 2>&1 \
      && log "preflight: 单测全绿 ✓" \
      || warn "preflight: 单测未通过（先修 test/ 再 apply）"
  fi
}

plan_plugin() {
  log "1) 插件拷贝：$PLUGIN_SRC → $PROFILE_MODULES/$PLUGIN_NS"
  cat <<'EOF'
    mkdir -p "$PROFILE_MODULES/@local"
    rm -rf "$PROFILE_MODULES/@local/dsh-ssh-gui"
    cp -r "$DEPLOY_DIR/dsh-ssh-gui" "$PROFILE_MODULES/@local/dsh-ssh-gui"
EOF
  log "2) profile patch 追加 insert 行（先备份 PATCH_FILE）："
  cat <<'EOF'
    cp "$PATCH_FILE" "$PATCH_FILE.bak-ssh-gui-$(date +%Y%m%d%H%M%S)"
    追加：
    # ---- dsh-ssh-gui（分布式控制薄插件：SSH 主机 + 串口 + TCP 串口服务器）----
    - insert:
        - id: ssh-gui
          name: '@local/dsh-ssh-gui'
EOF
}

plan_settings() {
  log "3) settings.yaml 追加 dsh-ssh-gui 段（全部默认即可，按需修改）："
  cat <<'EOF'
    cp "$SETTINGS_FILE" "$SETTINGS_FILE.bak-ssh-gui-$(date +%Y%m%d%H%M%S)" 2>/dev/null || true
    追加：
    # dsh-ssh-gui（分布式控制：SSH 主机 + 本地串口 + TCP 串口服务器统一节点）
    dsh-ssh-gui:
      file:
        maxBytes: 10485760
      exec:
        timeoutMs: 30000
        maxOutputBytes: 1048576
      security:
        confirmExec: true
        execAllowlist: []
      # serial:
      #   logDir: ""          # 控制台会话日志目录（缺省 ~/.dsh/remote-workspaces/serial-logs）
      # nodes:
      #   seed:               # 首启迁移种子（仅 nodes.json 不存在时导入）
      #     serial: []        # [{ id?, name?, port, baudRate?, backend? }]
      #     serialTcp: []     # [{ id?, name?, host, port, tty? }]
EOF
}

plan_verify() {
  log "4) 验证（重启后执行，见 RUNBOOK.md）："
  cat <<EOF
    # 重启 dsh web 后（bundle/insert 生效）：
    curl -s http://127.0.0.1:3080/ | grep -o '"@local/dsh-ssh-gui"'   # boot 出现新 client 条目
    # GUI：设置页出现「分布式控制 · dsh-ssh-gui」；会话头部出现「节点」按钮；侧栏「分布式节点」文件夹
    # 冒烟（nodes.list 应回三类传输 + 已迁移节点）：
    curl -s -X POST http://127.0.0.1:3080/ssh-gui/nodes.list -H 'content-type: application/json' \
      -d '{"type":"client-request","rpcId":"smoke-1","method":"nodes.list","payload":{}}'
EOF
}

apply_plugin() {
  log "applying: 插件拷贝"
  mkdir -p "$PROFILE_MODULES/@local"
  rm -rf "$PROFILE_MODULES/$PLUGIN_NS"
  cp -r "$PLUGIN_SRC" "$PROFILE_MODULES/$PLUGIN_NS"
  if ! patch_has "id: $INSERT_ID"; then
    cp "$PATCH_FILE" "$PATCH_FILE.bak-ssh-gui-$(date +%Y%m%d%H%M%S)"
    cat >> "$PATCH_FILE" <<EOF

# ---- dsh-ssh-gui（分布式控制薄插件：SSH 主机 + 串口 + TCP 串口服务器）----
- insert:
    - id: ssh-gui
      name: '@local/dsh-ssh-gui'
EOF
    log "patch 已追加 insert（id: $INSERT_ID）"
  else
    warn "patch 已含 id: $INSERT_ID 条目，跳过追加"
  fi
}

apply_settings() {
  log "applying: settings.yaml 段（已存在则跳过）"
  if grep -q '^dsh-ssh-gui:' "$SETTINGS_FILE" 2>/dev/null; then
    warn "settings.yaml 已含 dsh-ssh-gui 段，跳过"
  else
    cp "$SETTINGS_FILE" "$SETTINGS_FILE.bak-ssh-gui-$(date +%Y%m%d%H%M%S)" 2>/dev/null || true
    cat >> "$SETTINGS_FILE" <<'EOF'

# dsh-ssh-gui（分布式控制：SSH 主机 + 本地串口 + TCP 串口服务器统一节点；默认值即可，按需修改）
dsh-ssh-gui:
  file:
    maxBytes: 10485760
  exec:
    timeoutMs: 30000
    maxOutputBytes: 1048576
  security:
    confirmExec: true
    execAllowlist: []
EOF
    log "settings.yaml 已追加 dsh-ssh-gui 段"
  fi
}

restart_hint() {
  log "5) 重启 dsh web（bundle/insert 生效；HMR 不覆盖 host 装配变更）："
  echo "    # 停掉当前 dsh web 后重启（同现有启动方式）"
}

rollback() {
  log "rollback: 还原 patch（最近一次 .bak-ssh-gui-*）"
  local newest
  newest="$(ls -t "$PATCH_FILE".bak-ssh-gui-* 2>/dev/null | head -1 || true)"
  if [ -n "$newest" ]; then
    cp "$newest" "$PATCH_FILE"
    echo "  已还原 $newest"
  else
    warn "无 .bak-ssh-gui-* 备份；请手工移除以下条目：id: $INSERT_ID（及其所在 - insert: 块）"
  fi
  log "rollback: 删除插件拷贝"
  rm -rf "$PROFILE_MODULES/$PLUGIN_NS"
  log "rollback: 还原 settings.yaml（最近一次 .bak-ssh-gui-*）"
  local snew
  snew="$(ls -t "$SETTINGS_FILE".bak-ssh-gui-* 2>/dev/null | head -1 || true)"
  [ -n "$snew" ] && cp "$snew" "$SETTINGS_FILE" && echo "  已还原 $snew" \
    || warn "无 settings 备份，请手工移除 dsh-ssh-gui 段"
}

main() {
  preflight
  case "$MODE" in
    dry-run)
      log "===== DRY-RUN（不写 ~/.dsh）====="
      plan_plugin
      plan_settings
      plan_verify
      restart_hint
      log "===== 确认无误后执行：bash deploy.sh --apply ====="
      ;;
    --apply)
      log "===== APPLY（将修改 ~/.dsh，需人工确认）====="
      apply_plugin
      apply_settings
      restart_hint
      ;;
    --rollback)
      rollback
      ;;
    *)
      die "用法：bash deploy.sh [dry-run|--apply|--rollback]"
      ;;
  esac
}

main
