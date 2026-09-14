#!/usr/bin/env bash
# 把本地 dsh-session-board 插件包装进 harness 的「持久」模块目录。
#
# 为什么装到这里：
#   - loader 从 ~/.dsh/profiles/web/ 向上解析模块，会命中 ~/.dsh/profiles/node_modules；
#   - 这个目录是 DSH 的扁平回退目录，官方包（schemastery/dsh-tools/dsh-llm/...）都在这里，
#     所以插件自身的 import（peerDependencies）能解析到；
#   - 它位于 ~/.dsh 下，不会被 npx 重装（清 ~/.npm/_npx）抹掉；
#   - DSH 启动时只给官方包重指符号链接、从不剪枝非官方条目，所以这里放真实目录是安全的。
#
# 用法：
#   bash ~/.dsh/session-board/install.sh
#   然后把挂载条目加入 ~/.dsh/profiles/web/cordis.patch.yml（顶层数组）：
#     - insert:
#         - id: session-status-board
#           name: '@deepseek-ai/dsh-session-board'
#   重启 dsh 生效：npx @deepseek-ai/dsh web
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FB="$HOME/.dsh/profiles/node_modules/@deepseek-ai"

[ -f "$SCRIPT_DIR/package.json" ] || { echo "ERROR: 缺少 $SCRIPT_DIR/package.json（请在包目录内或用包内脚本运行）" >&2; exit 1; }

mkdir -p "$FB"
rm -rf "$FB/dsh-session-board"
cp -r "$SCRIPT_DIR" "$FB/dsh-session-board"
echo "已安装 dsh-session-board -> $FB/dsh-session-board"

cat <<'EOF'
下一步：把挂载条目加入 ~/.dsh/profiles/web/cordis.patch.yml 顶层数组（紧邻现有插件条目）：

  - insert:
      - id: session-status-board
        name: '@deepseek-ai/dsh-session-board'

然后重启 dsh：npx @deepseek-ai/dsh web（重启后新会话生效）。
EOF
