#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$SCRIPT_DIR"
MOBILE_DIR="$REPO_ROOT/apps/mobile"
PBXPROJ_PATH="$MOBILE_DIR/ios/SyntaxSenpai.xcodeproj/project.pbxproj"

NO_INSTALL=0
SKIP_PREBUILD=0
APPLE_TEAM_ID="${APPLE_TEAM_ID:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-install)
      NO_INSTALL=1
      shift
      ;;
    --skip-prebuild)
      SKIP_PREBUILD=1
      shift
      ;;
    -h|--help)
      cat <<'EOF'
Usage: ./build-iPhone.sh [options]

Build and install the SyntaxSenpai iOS app to a connected physical iPhone.

Options:
  --no-install     Skip pnpm install
  --skip-prebuild  Skip Expo prebuild and pod install
  --help           Show this help

Examples:
  ./build-iPhone.sh
  ./build-iPhone.sh --no-install
  ./build-iPhone.sh --skip-prebuild
  APPLE_TEAM_ID=YOURTEAMID ./build-iPhone.sh
EOF
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script requires macOS." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required." >&2
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required." >&2
  exit 1
fi

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "Xcode and Xcode Command Line Tools are required." >&2
  exit 1
fi

cd "$REPO_ROOT"

if [[ $NO_INSTALL -eq 0 ]]; then
  echo "Installing dependencies..."
  pnpm install --prefer-frozen-lockfile || pnpm install
fi

cd "$MOBILE_DIR"

if [[ $SKIP_PREBUILD -eq 0 ]]; then
  echo "Syncing native iOS project..."
  npx expo prebuild -p ios
  npx pod-install ios
fi

if [[ -n "$APPLE_TEAM_ID" ]]; then
  echo "Applying Apple team ID: $APPLE_TEAM_ID"
  perl -0pi -e 's/DEVELOPMENT_TEAM = [A-Z0-9]+;/DEVELOPMENT_TEAM = '"$APPLE_TEAM_ID"';/g' "$PBXPROJ_PATH"
  if ! grep -q "DEVELOPMENT_TEAM = $APPLE_TEAM_ID;" "$PBXPROJ_PATH"; then
    perl -0pi -e 's/(CODE_SIGN_STYLE = Automatic;\n)/$1\t\t\t\tDEVELOPMENT_TEAM = '"$APPLE_TEAM_ID"';\n/g' "$PBXPROJ_PATH"
  fi
fi

echo "Building and installing on connected iPhone..."
npx expo run:ios --device
