#!/usr/bin/env bash
# deploy.sh —— dsh-workerspace 部署脚本（底座 dsh-workspace-enhancement@0.1.2-rc2 适配版 + 薄插件）。
#
# 设计：
#   - 默认 **dry-run**：只打印将执行的命令与将写入的片段，绝不改动 ~/.dsh（本交付物约束）；
#   - `--apply`：由操作者在目标机上显式执行真实安装（本仓库交付时不代为执行）；
#   - `--rollback`：回滚（还原 cordis.patch.yml 备份 + 删除拷贝 + 卸载 ssh2）；
#   - 幂等：已存在条目/拷贝会跳过或给出提示。
#
# 用法：
#   bash deploy.sh                 # dry-run（打印全量计划）
#   bash deploy.sh --apply         # 真实安装（目标机，人工确认）
#   bash deploy.sh --rollback      # 回滚
#
# 产物约束：本脚本默认不写 ~/.dsh；--apply/--rollback 由操作者显式触发。
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROFILE_MODULES="${DSH_PROFILE_MODULES:-$HOME/.dsh/profiles/node_modules}"
PROFILE_DIR="${DSH_PROFILE_DIR:-$HOME/.dsh/profiles/web}"
PATCH_FILE="$PROFILE_DIR/cordis.patch.yml"
SETTINGS_FILE="${DSH_SETTINGS_FILE:-$HOME/.dsh/settings.yaml}"
BASE_NAME="dsh-workspace-enhancement"
BASE_SRC="$DEPLOY_DIR/base/patch/dsh-workspace-enhancement-0.1.2-rc2"
PLUGIN_NAME="dsh-workerspace"
PLUGIN_SRC="$DEPLOY_DIR/$PLUGIN_NAME"
SSH2_SPEC="ssh2@^1.16.0"

MODE="${1:-dry-run}"

log()  { printf '\033[1;36m[deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

# 幂等判断
patch_has() { grep -qF "$1" "$PATCH_FILE" 2>/dev/null; }
dir_has()  { [ -d "$1" ]; }

preflight() {
  node --version | grep -qE '^v2[2-9]' || warn "node >= 22 推荐（当前 $(node --version)）"
  [ -d "$PROFILE_MODULES" ] || die "profile 模块目录不存在：$PROFILE_MODULES"
  [ -f "$PROFILE_DIR/package.json" ] || die "profile 目录不存在：$PROFILE_DIR"
  node "$DEPLOY_DIR/base/peer-deps-check-patched.mjs" >/dev/null 2>&1 \
    && log "preflight: 底座 13 deps + 2 peers 对本机 strict ✓" \
    || warn "preflight: 底座 peer/deps 核对脚本异常（见 base/README.md）"
}

plan_base() {
  log "1) 底座（适配版）拷贝：$BASE_SRC → $PROFILE_MODULES/$BASE_NAME"
  cat <<'EOF'
    rm -rf "$PROFILE_MODULES/$BASE_NAME"
    cp -r "$BASE_SRC" "$PROFILE_MODULES/$BASE_NAME"
EOF
  log "2) 底座唯一非官方依赖：ssh2"
  echo "    (cd $PROFILE_DIR && pnpm add $SSH2_SPEC)"
  log "3) profile patch 追加底座条目（先备份 PATCH_FILE）："
  cat <<'EOF'
    cp cordis.patch.yml cordis.patch.yml.bak-dsw-$(date +%Y%m%d%H%M%S)
    追加：
    # ---- dsh-workspace-enhancement@0.1.2（底座，rc.2 适配版）----
    - id: directory-picker
      name: '@deepseek-ai/dsh-host-directory-picker-auto'
      disabled: true
    - id: subprocess
      name: '@deepseek-ai/dsh-subprocess-local'
      disabled: true
    - id: fs-sandbox
      name: '@deepseek-ai/dsh-fs-sandbox'
      disabled: true
    - insert:
        - id: ssh-remote
          name: dsh-workspace-enhancement
          config:
            host: 127.0.0.1
            port: 22
            username: ssh
            cwd: /tmp
        - id: directory-picker-ssh
          name: dsh-workspace-enhancement/picker
          config:
            maxEntries: 1000
        - id: ssh-web-channel
          name: dsh-workspace-enhancement/web
          config:
            maxEntries: 1000
EOF
}

plan_plugin() {
  log "4) 薄插件拷贝：$PLUGIN_SRC → $PROFILE_MODULES/@local/$PLUGIN_NAME"
  cat <<'EOF'
    mkdir -p "$PROFILE_MODULES/@local"
    rm -rf "$PROFILE_MODULES/@local/$PLUGIN_NAME"
    cp -r "$PLUGIN_SRC" "$PROFILE_MODULES/@local/$PLUGIN_NAME"
EOF
  log "5) profile patch 追加薄插件 insert 行："
  cat <<'EOF'
    - insert:
        - id: workerspace
          name: '@local/dsh-workerspace'
EOF
}

plan_settings() {
  log "6) settings.yaml 追加 dsh-workerspace 段（示例，按需修改）："
  cat <<'EOF'
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
          - id: fastboot-boot
            command: fastboot flash boot {{artifact:boot_img}}
            dangerous: true
      artifacts:
        dir: ~/.dsh/workerspace
      security:
        confirmDangerous: true
        commandAllowlist: [esptool, esptool.py, openocd, dfu-util, uuu, fastboot]
EOF
}

plan_verify() {
  log "7) 验证（重启后执行，见 RUNBOOK.md 第 5 节）："
  cat <<EOF
    # 工具列出（GUI 会话内可问模型/或经 dsh 日志确认 ws_serial_list 等 6 工具注册成功）
    ls -l /dev/ttyUSB* /dev/ttyACM* /dev/serial/by-id/* 2>/dev/null   # 串口探测
    # ws_flash dry-run：对未授权模板应被拒（如 id=nope 或 工具名不在白名单）
    # 说明：工具本身无 dry-run 参数 —— 用「未知模板/非白名单」路径验证拒绝逻辑
    node --test "$PLUGIN_SRC/test/*.test.mjs"   # 或跑 42 用例冒烟（glob 形式，目录裸参在 node 22 不可用）
EOF
}

apply_base() {
  log "applying: 底座"
  rm -rf "$PROFILE_MODULES/$BASE_NAME"
  cp -r "$BASE_SRC" "$PROFILE_MODULES/$BASE_NAME"
  (cd "$PROFILE_DIR" && pnpm add "$SSH2_SPEC")
  if ! patch_has "id: ssh-remote"; then
    cp "$PATCH_FILE" "$PATCH_FILE.bak-dsw-$(date +%Y%m%d%H%M%S)"
    cat >> "$PATCH_FILE" <<EOF

# ---- dsh-workspace-enhancement@0.1.2（底座，rc.2 适配版）----
- id: directory-picker
  name: '@deepseek-ai/dsh-host-directory-picker-auto'
  disabled: true
- id: subprocess
  name: '@deepseek-ai/dsh-subprocess-local'
  disabled: true
- id: fs-sandbox
  name: '@deepseek-ai/dsh-fs-sandbox'
  disabled: true
- insert:
    - id: ssh-remote
      name: dsh-workspace-enhancement
      config:
        host: 127.0.0.1
        port: 22
        username: ssh
        cwd: /tmp
    - id: directory-picker-ssh
      name: dsh-workspace-enhancement/picker
      config:
        maxEntries: 1000
    - id: ssh-web-channel
      name: dsh-workspace-enhancement/web
      config:
        maxEntries: 1000
EOF
  else
    warn "patch 已含 ssh-remote 条目，跳过追加"
  fi
}

apply_plugin() {
  log "applying: 薄插件"
  mkdir -p "$PROFILE_MODULES/@local"
  rm -rf "$PROFILE_MODULES/@local/$PLUGIN_NAME"
  cp -r "$PLUGIN_SRC" "$PROFILE_MODULES/@local/$PLUGIN_NAME"
  if ! patch_has "id: workerspace"; then
    cp "$PATCH_FILE" "$PATCH_FILE.bak-dsw-$(date +%Y%m%d%H%M%S)"
    cat >> "$PATCH_FILE" <<EOF

# ---- dsh-workerspace（薄插件：SoC 本地面）----
- insert:
    - id: workerspace
      name: '@local/dsh-workerspace'
EOF
  else
    warn "patch 已含 workerspace 条目，跳过追加"
  fi
}

apply_settings() {
  log "applying: settings.yaml 段（已存在则跳过）"
  if grep -q '^dsh-workerspace:' "$SETTINGS_FILE" 2>/dev/null; then
    warn "settings.yaml 已含 dsh-workerspace 段，跳过"
  else
    cp "$SETTINGS_FILE" "$SETTINGS_FILE.bak-dsw-$(date +%Y%m%d%H%M%S)" 2>/dev/null || true
    cat >> "$SETTINGS_FILE" <<'EOF'

# dsh-workerspace 薄插件（SoC 本地面：串口 + 烧录 + 产物落盘）
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
  artifacts:
    dir: ~/.dsh/workerspace
  security:
    confirmDangerous: true
    commandAllowlist: [esptool, esptool.py, openocd, dfu-util, uuu, fastboot]
EOF
  fi
}

restart_hint() {
  log "8) 重启 dsh web（bundle/insert 生效）："
  echo "    # 停掉当前 dsh web 后重启（HMR 不覆盖 host 装配变更）"
  echo "    npx @deepseek-ai/dsh web   # 或按你的启动方式"
}

rollback() {
  log "rollback: 还原 patch（最近一次 .bak-dsw-*）"
  local newest
  newest="$(ls -t "$PATCH_FILE".bak-dsw-* 2>/dev/null | head -1 || true)"
  if [ -n "$newest" ]; then
    cp "$newest" "$PATCH_FILE"
    echo "  已还原 $newest"
  else
    warn "无 .bak-dsw-* 备份；请手工移除以下条目：ssh-remote / directory-picker-ssh / ssh-web-channel / workerspace 及三个 disabled 行"
  fi
  log "rollback: 删除插件拷贝"
  rm -rf "$PROFILE_MODULES/$BASE_NAME" "$PROFILE_MODULES/@local/$PLUGIN_NAME"
  log "rollback: 卸载 ssh2（若为底座唯一使用者）"
  echo "  (cd $PROFILE_DIR && pnpm remove ssh2)   # 谨慎：确认无其他插件依赖"
  log "rollback: 还原 settings.yaml（最近一次 .bak-dsw-*）"
  local snew
  snew="$(ls -t "$SETTINGS_FILE".bak-dsw-* 2>/dev/null | head -1 || true)"
  [ -n "$snew" ] && cp "$snew" "$SETTINGS_FILE" && echo "  已还原 $snew" || warn "无 settings 备份，请手工移除 dsh-workerspace 段"
}

main() {
  preflight
  case "$MODE" in
    dry-run)
      log "===== DRY-RUN（不写 ~/.dsh）====="
      plan_base
      plan_plugin
      plan_settings
      plan_verify
      restart_hint
      log "===== 确认无误后执行：bash deploy.sh --apply ====="
      ;;
    --apply)
      log "===== APPLY（将修改 ~/.dsh，需人工确认）====="
      apply_base
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
