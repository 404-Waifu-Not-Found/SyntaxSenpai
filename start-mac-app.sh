#!/usr/bin/env bash
set -euo pipefail

# start-mac-app.sh — convenience helper to launch the quick Electron app on macOS
# Usage: ./start-mac-app.sh [--no-install] [--no-build]
#  --no-install  skip pnpm install
#  --no-build    skip building @syntax-senpai/waifu-core and @syntax-senpai/ui

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$SCRIPT_DIR"
cd "$REPO_ROOT"

NO_INSTALL=0
NO_BUILD=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-install) NO_INSTALL=1; shift ;;
    --no-build) NO_BUILD=1; shift ;;
    -h|--help)
      echo "Usage: $0 [--no-install] [--no-build]"
      exit 0
      ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Warning: This script is intended for macOS (Darwin)." >&2
fi

echo "Starting SyntaxSenpai desktop (quick) from: $REPO_ROOT"

if ! command -v node >/dev/null 2>&1; then
  echo "Node not found. Install Node >=20: https://nodejs.org/" >&2
  exit 1
fi

echo "Node: $(node --version)"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm not found. Install via: npm i -g pnpm" >&2
  exit 1
fi

if [[ $NO_INSTALL -eq 0 ]]; then
  echo "Running pnpm install (workspace) ..."
  pnpm install --prefer-frozen-lockfile || pnpm install
fi

if [[ $NO_BUILD -eq 0 ]]; then
  echo "Building @syntax-senpai/waifu-core and @syntax-senpai/ui (best-effort) ..."
  pnpm -w -r --filter @syntax-senpai/waifu-core --filter @syntax-senpai/ui run build || true
fi

echo "Launching quick desktop entry (electron main.js) ..."
# Use root helper which runs the filtered command; this ensures workspace pnpm is used
pnpm run desktop:quick

exit 0
