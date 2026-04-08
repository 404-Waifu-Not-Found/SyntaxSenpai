#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$SCRIPT_DIR"
DESKTOP_DIR="$REPO_DIR/apps/desktop"
ELECTRON_DIST=""

resolve_electron_dist() {
  local electron_root
  electron_root="$(find "$REPO_DIR/node_modules/.pnpm" -maxdepth 1 -type d -name 'electron@*' | sort | tail -n 1)"
  if [[ -z "$electron_root" ]]; then
    return 1
  fi

  ELECTRON_DIST="$electron_root/node_modules/electron/dist/Electron.app/Contents"
}

repair_electron_bundle() {
  if ! resolve_electron_dist; then
    return 0
  fi

  local frameworks_dir="$ELECTRON_DIST/Frameworks"
  local framework_root
  local framework_name
  local versions_dir
  local current_version="A"
  local link_name

  for framework_root in "$frameworks_dir"/*.framework; do
    [[ -d "$framework_root" ]] || continue

    framework_name="$(basename "$framework_root" .framework)"
    versions_dir="$framework_root/Versions"
    [[ -d "$versions_dir/$current_version" ]] || continue

    if [[ ! -e "$versions_dir/Current" ]]; then
      ln -s "$current_version" "$versions_dir/Current"
    fi

    for link_name in "$framework_name" "Resources" "Libraries" "Helpers"; do
      if [[ ! -e "$framework_root/$link_name" && -e "$versions_dir/Current/$link_name" ]]; then
        ln -s "Versions/Current/$link_name" "$framework_root/$link_name"
      fi
    done
  done
}

cd "$DESKTOP_DIR"

echo "🚀 Starting SyntaxSenpai Desktop..."
echo "📦 Installing dependencies..."
pnpm install --prefer-frozen-lockfile || pnpm install

if ! pnpm ls prebuild-install --depth -1 >/dev/null 2>&1; then
  echo "🧩 Installing prebuild-install for native deps..."
  pnpm add -Dw prebuild-install
fi

echo "🩹 Repairing Electron bundle symlinks if needed..."
repair_electron_bundle

echo "🔨 Building..."
pnpm run build

echo "✅ Launching Electron app..."
pnpm run start

exit 0
