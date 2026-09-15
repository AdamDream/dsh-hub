#!/usr/bin/env bash
# ============================================================
# deploy.sh —— pptmaster 组合部署（install 顺序：skill → 插件）
# 用法：
#   ./deploy.sh [--profile web] [--python python3] [--pip-args "..."] [--skip-plugin-deps]
# 环境变量：DSH_HOME（默认 ~/.dsh）、PROFILE（默认 web）。
# 由主代理在部署期执行；本脚本会写 ~/.dsh（skills + profiles），
# staging 目录本身不含任何 ~/.dsh 写入。
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAGE_ROOT="$(dirname "$SCRIPT_DIR")"
SKILL_DIR="$STAGE_ROOT/skills/ppt-master"
PLUGIN_DIR="$STAGE_ROOT/plugin/dsh-pptmaster"
PROFILE="${PROFILE:-web}"
PYTHON_BIN="python3"
PIP_ARGS_EXTRA=""
SKIP_PLUGIN_DEPS=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE="${2:?--profile needs a value}"; shift 2 ;;
    --python) PYTHON_BIN="${2:?--python needs a value}"; shift 2 ;;
    --pip-args) PIP_ARGS_EXTRA="${2:?--pip-args needs a value}"; shift 2 ;;
    --skip-plugin-deps) SKIP_PLUGIN_DEPS=1; shift ;;
    *) echo "[deploy] unknown arg: $1" >&2; exit 2 ;;
  esac
done

DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
PROFILE_DIR="$DSH_HOME_DIR/profiles/$PROFILE"
PATCH_FILE="$PROFILE_DIR/cordis.patch.yml"

echo "===== [deploy] pptmaster 组合部署 ====="
echo "DSH_HOME=$DSH_HOME_DIR  profile=$PROFILE  python=$PYTHON_BIN"

# ---------- 0) 预检 ----------
command -v dsh >/dev/null || { echo "[deploy] ERROR: dsh CLI not found" >&2; exit 1; }
command -v "$PYTHON_BIN" >/dev/null || { echo "[deploy] ERROR: $PYTHON_BIN not found" >&2; exit 1; }
[[ -d "$SKILL_DIR" ]] || { echo "[deploy] ERROR: staged skill missing: $SKILL_DIR" >&2; exit 1; }
[[ -f "$PLUGIN_DIR/package.json" ]] || { echo "[deploy] ERROR: staged plugin missing: $PLUGIN_DIR" >&2; exit 1; }
[[ -f "$PATCH_FILE" ]] || { echo "[deploy] ERROR: profile patch missing: $PATCH_FILE" >&2; exit 1; }
echo "[deploy] preflight OK"

# ---------- 1) skill 主线（A）----------
echo "===== [deploy] 1/2 install skill (ppt-master) ====="
bash "$SCRIPT_DIR/install-skill.sh" --python "$PYTHON_BIN" ${PIP_ARGS_EXTRA:+--pip-args "$PIP_ARGS_EXTRA"}

# ---------- 2) 插件辅线（B：dsh-pptmaster port）----------
echo "===== [deploy] 2/2 install plugin (@local/dsh-pptmaster) ====="
PLUGIN_TARGET="$DSH_HOME_DIR/profiles/node_modules/@local/dsh-pptmaster"
mkdir -p "$DSH_HOME_DIR/profiles/node_modules/@local"
if [[ -d "$PLUGIN_TARGET" ]]; then
  backup="$PLUGIN_TARGET.bak-$(date +%Y%m%d-%H%M%S)"
  mv "$PLUGIN_TARGET" "$backup"
  echo "[deploy] backed up existing plugin -> $backup"
fi
cp -r "$PLUGIN_DIR" "$PLUGIN_TARGET"
echo "[deploy] copied plugin -> $PLUGIN_TARGET"

# 依赖安装（运行时依赖 pptxgenjs/@aiden0z/pptx-renderer/typescript 等在 profile 缺失）
if [[ "$SKIP_PLUGIN_DEPS" == "1" ]]; then
  echo "[deploy] --skip-plugin-deps: 跳过插件依赖安装（请手动执行 pnpm install）"
else
  echo "[deploy] installing plugin runtime deps into profile..."
  ( cd "$PROFILE_DIR" && pnpm install --no-frozen-lockfile )
fi

# cordis.patch.yml 追加 insert（幂等：已存在则跳过）
if grep -q "name: '@local/dsh-pptmaster'" "$PATCH_FILE" 2>/dev/null; then
  echo "[deploy] cordis.patch.yml already contains @local/dsh-pptmaster (skip append)"
else
  cp "$PATCH_FILE" "$PATCH_FILE.bak-$(date +%Y%m%d-%H%M%S)"
  cat >> "$PATCH_FILE" <<'EOF'
- insert:
    - id: dsh-pptmaster
      name: '@local/dsh-pptmaster'
      config:
        root: !!js dshHomePath('office-ppt')
EOF
  echo "[deploy] appended insert entry to $PATCH_FILE (backup taken)"
fi

# ---------- 3) 部署后验证 ----------
echo "===== [deploy] verification ====="
bash "$SCRIPT_DIR/install-skill.sh" --verify-only --python "$PYTHON_BIN"
node --check "$PLUGIN_TARGET/lib/index.js" && echo "[deploy] plugin lib/index.js syntax OK"
node --check "$PLUGIN_TARGET/lib/client.js" && echo "[deploy] plugin lib/client.js syntax OK"
"$PYTHON_BIN" -c "import pptx; print('[deploy] python-pptx OK', pptx.__version__)" || echo "[deploy] WARNING: python-pptx import failed (check pip install)"

echo ""
echo "===== [deploy] DONE ====="
echo "下一步（需人工/主代理）:"
echo "  1. 重启 dsh web（$PROFILE profile）使插件与 skill 目录生效；"
echo "  2. 新会话验证 <available_skills> 含 ppt-master 与 workbuddy-ppt；"
echo "  3. 模型侧调用 skill 工具 / pptmaster_* 工具冒烟。"
echo "回滚参考：$STAGE_ROOT/04-Runbook.md §6"
