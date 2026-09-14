#!/usr/bin/env bash
# Install @local/dsh-wallpaper into this deployment's DSH profile.
#
# Pattern follows ~/.dsh/install-plugins.sh (the flat fallback module dir):
#   - the loader resolves from ~/.dsh/profiles/web/ upward, so it hits
#     ~/.dsh/profiles/node_modules; peer deps (react, cordis, dsh-client-*, ...)
#     resolve through that tree to the official packages;
#   - the directory lives under ~/.dsh, so npx reinstalls cannot wipe it;
#   - DSH only re-points symlinks for official packages and never prunes
#     non-official entries, so a real directory here is safe.
#
# The package is installed as a REAL directory copy (cp -r), never a symlink.
# Reason: several entries under ~/.dsh/profiles/node_modules/@deepseek-ai/ are
# broken symlinks into a cleared npx cache (dsh-client-ui-slots,
# dsh-client-ui-primitives, dsh-client-web-react, dsh-client-web,
# dsh-client-schema-form — verified 2026-09-08); anything that resolves through
# them fails to load. The post-install checks below refuse to install if the
# plugin ever grows a dependency on any of them.
#
# Usage: bash install.sh
# Env overrides (used by the package's self-tests; leave unset for real install):
#   WALLPAPER_INSTALL_DEST   install destination directory
#   WALLPAPER_PROFILE_PATCH  profile patch file to append the activation entry to
#   WALLPAPER_CLIENT_MODULES dir that must hold the client-inject packages
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${WALLPAPER_INSTALL_DEST:-$HOME/.dsh/profiles/node_modules/@local/dsh-wallpaper}"
PROFILE_PATCH="${WALLPAPER_PROFILE_PATCH:-$HOME/.dsh/profiles/web/cordis.patch.yml}"
CLIENT_MODULES="${WALLPAPER_CLIENT_MODULES:-$HOME/.dsh/profiles/web/node_modules/@deepseek-ai}"

# Packages that are broken symlinks in this deployment's module tree; the
# plugin's client half must never depend on any of them (the slots/theme
# contracts it needs all live in @deepseek-ai/dsh-client-runtime).
BROKEN_PKGS=(dsh-client-ui-slots dsh-client-ui-primitives dsh-client-web-react dsh-client-web dsh-client-schema-form)
# Client packages the plugin injects (package.json dsh.client.inject).
CLIENT_INJECT_PKGS=(dsh-client-runtime dsh-client-locale dsh-client-ui-theme dsh-client-ui-settings)
# Host-half runtime imports (resolved by plain Node from lib/index.js).
HOST_DEPS=("@deepseek-ai/schemastery" "@deepseek-ai/dsh-settings")

[ -f "$SRC/lib/index.js" ] && [ -f "$SRC/lib/client.js" ] || {
  echo "ERROR: $SRC is not the @local/dsh-wallpaper package directory" >&2
  exit 1
}

mkdir -p "$(dirname "$DEST")"
rm -rf "$DEST"
# REAL directory copy, never a symlink (see header).
cp -r "$SRC" "$DEST"
rm -rf "$DEST/.git"
if [ ! -d "$DEST" ] || [ -L "$DEST" ]; then
  echo "ERROR: install destination is not a real directory: $DEST" >&2
  exit 1
fi
echo "installed package (real directory copy) -> $DEST"

# --- post-install verification (fail fast before touching the profile) ------

# 1) Refuse any reference to the broken-symlink packages.
broken_pattern="$(IFS='|'; echo "${BROKEN_PKGS[*]}")"
if grep -qE "$broken_pattern" "$DEST/package.json" "$DEST/lib/client.js" "$DEST/lib/index.js" 2>/dev/null; then
  echo "ERROR: the plugin references a package that is a broken symlink in this" >&2
  echo "       deployment (${broken_pattern}); refusing to install" >&2
  exit 1
fi
echo "  ok: no dependency on broken-symlink packages"

# 2) Host-half imports must resolve from the install location (they run under
#    plain Node module resolution starting at lib/).
command -v node >/dev/null || { echo "ERROR: node not found on PATH" >&2; exit 1; }
for dep in "${HOST_DEPS[@]}"; do
  if ! resolved="$(node -e "console.log(require.resolve('$dep/package.json', { paths: ['$DEST/lib'] }))" 2>/dev/null)"; then
    echo "ERROR: host-half dependency $dep does not resolve from $DEST/lib" >&2
    echo "       (missing, or a broken symlink in the module tree)" >&2
    exit 1
  fi
  echo "  ok: $dep -> $resolved"
done

# 3) Client-inject packages must exist (and not be broken symlinks) in the Web
#    profile module tree the browser loader serves from.
for pkg in "${CLIENT_INJECT_PKGS[@]}"; do
  if [ ! -d "$CLIENT_MODULES/$pkg" ]; then
    echo "ERROR: client-inject package missing or a broken symlink:" >&2
    echo "       $CLIENT_MODULES/$pkg" >&2
    exit 1
  fi
  echo "  ok: $pkg"
done

# --- activation --------------------------------------------------------------

# Activate the plugin in the Web profile patch layer (idempotent append).
if [ -f "$PROFILE_PATCH" ] && grep -q "name: '@local/dsh-wallpaper'" "$PROFILE_PATCH"; then
  echo "patch entry already present in $PROFILE_PATCH"
else
  cat >> "$PROFILE_PATCH" <<'EOF'

# 壁纸插件（@frog755/dsh-wallpaper 的本地 fork，静态图片版）：
# per-page 覆盖 + 暗色遮罩 + URL/路径/上传来源，配置走 ~/.dsh/settings.yaml。
- insert:
    - id: wallpaper
      name: '@local/dsh-wallpaper'
EOF
  echo "appended insert entry to $PROFILE_PATCH"
fi

echo "done. restart DSH to load it: npx @deepseek-ai/dsh web"
