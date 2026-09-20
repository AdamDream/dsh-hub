#!/usr/bin/env bash
# ============================================================
# install-skill.sh —— 安装 ppt-master skill 到 $DSH_HOME/skills/
# 幂等：重复执行会先备份旧目录再整体重拷；pip 安装天然幂等。
# 用法：
#   ./install-skill.sh                          # 完整安装（备份→拷贝→guard→pip）
#   ./install-skill.sh --verify-only            # 只对已部署目录跑 guard，零写入
#   ./install-skill.sh --python python3.12      # 指定解释器
#   ./install-skill.sh --pip-args "--user"      # 附加 pip 参数（如 --user / --dry-run）
# 环境变量：DSH_HOME（默认 ~/.dsh）、PIP_ARGS（等价于 --pip-args）。
#
# 由主代理在部署期执行；本 staging 目录本身不做任何 ~/.dsh 写入。
# ============================================================
set -euo pipefail

# --- 定位 staging 源（脚本所在目录的上级 = deploy-pptmaster/）--------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAGE_ROOT="$(dirname "$SCRIPT_DIR")"          # deploy-pptmaster/
SKILL_SRC="$STAGE_ROOT/skills/ppt-master"
SKILL_NAME="ppt-master"

# --- 目标 ----------------------------------------------------------------
DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
SKILL_DST="$DSH_HOME_DIR/skills/$SKILL_NAME"
PYTHON_BIN="python3"
PIP_ARGS_EXTRA="${PIP_ARGS:-}"
VERIFY_ONLY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --verify-only) VERIFY_ONLY=1; shift ;;
    --python) PYTHON_BIN="${2:?--python needs a value}"; shift 2 ;;
    --pip-args) PIP_ARGS_EXTRA="${2:?--pip-args needs a value}"; shift 2 ;;
    *) echo "[ppt-master] unknown arg: $1" >&2; exit 2 ;;
  esac
done

echo "[ppt-master] DSH_HOME=$DSH_HOME_DIR"
echo "[ppt-master] skill source : $SKILL_SRC"
echo "[ppt-master] skill target : $SKILL_DST"
echo "[ppt-master] python      : $PYTHON_BIN"

if [[ ! -d "$SKILL_SRC" ]]; then
  echo "[ppt-master] ERROR: staging skill source missing: $SKILL_SRC" >&2
  exit 1
fi

verify_guard() {
  local dir="$1"
  if [[ ! -f "$dir/scripts/attribution_guard.py" ]]; then
    echo "[ppt-master] ERROR: attribution_guard.py missing in $dir" >&2
    return 1
  fi
  ( cd "$dir" && "$PYTHON_BIN" scripts/attribution_guard.py )
}

# 1) 冒烟校验：先对 staging 副本跑 guard（exit 0 才算可部署）
if ! verify_guard "$SKILL_SRC"; then
  echo "[ppt-master] ERROR: staging guard check failed (non-zero). Aborting — do not deploy a broken skill." >&2
  exit 1
fi
echo "[ppt-master] staging guard OK (exit 0)"

# 2) --verify-only：只对已部署目录跑 guard，不做任何写入
if [[ "$VERIFY_ONLY" == "1" ]]; then
  if [[ ! -d "$SKILL_DST" ]]; then
    echo "[ppt-master] ERROR: --verify-only but target not installed: $SKILL_DST" >&2
    exit 1
  fi
  if verify_guard "$SKILL_DST"; then
    echo "[ppt-master] deployed skill guard OK (exit 0)"
    exit 0
  fi
  echo "[ppt-master] ERROR: deployed skill guard FAILED (non-zero)" >&2
  exit 1
fi

# 3) 备份旧目录（幂等：已有旧目录时先备份再覆盖）
local_backup=""
if [[ -d "$SKILL_DST" ]]; then
  local_backup="$SKILL_DST.bak-$(date +%Y%m%d-%H%M%S)"
  mv "$SKILL_DST" "$local_backup"
  echo "[ppt-master] backed up existing skill -> $local_backup"
fi

# 4) 拷贝 + 可执行位
mkdir -p "$DSH_HOME_DIR/skills"
cp -r "$SKILL_SRC" "$SKILL_DST"
chmod +x "$SKILL_DST/scripts/attribution_guard.py"
echo "[ppt-master] copied skill -> $SKILL_DST ($(find "$SKILL_DST" -type f | wc -l) files)"

# 5) 部署后 guard 冒烟（非零即回滚本次拷贝）
if ! verify_guard "$SKILL_DST"; then
  echo "[ppt-master] ERROR: post-copy guard FAILED; rolling back" >&2
  rm -rf "$SKILL_DST"
  if [[ -n "$local_backup" && -d "$local_backup" ]]; then mv "$local_backup" "$SKILL_DST"; fi
  exit 1
fi
echo "[ppt-master] deployed guard OK (exit 0)"

# 6) pip 依赖（幂等；默认装 skill 内部权威清单；--pip-args/PIP_ARGS 可追加 "--user" 等）
REQ_FILE="$SKILL_DST/requirements.txt"
if [[ ! -f "$REQ_FILE" ]]; then
  echo "[ppt-master] WARNING: $REQ_FILE missing; falling back to staged requirements.txt" >&2
  REQ_FILE="$STAGE_ROOT/requirements.txt"
fi
echo "[ppt-master] installing python deps from $REQ_FILE ..."
# shellcheck disable=SC2086
"$PYTHON_BIN" -m pip install $PIP_ARGS_EXTRA -r "$REQ_FILE"
"$PYTHON_BIN" -c "import pptx; print('[ppt-master] python-pptx OK', pptx.__version__)"

echo "[ppt-master] install-skill.sh done. Next: restart DSH (skill-filesystem hot-discovers ~/.dsh/skills/)"
