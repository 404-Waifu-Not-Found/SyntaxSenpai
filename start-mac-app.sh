#!/usr/bin/env bash
set -euo pipefail

# start-mac-app.sh — Launch SyntaxSenpai on macOS
# Unified single-window app with AI chat companion
#
# Usage: ./start-mac-app.sh [OPTION]
#   desktop              Launch desktop app (Electron) [default]
#   mobile               Launch mobile app (Expo)
#   --help               Show this help
#   --no-install         Skip pnpm install
#   --skip-build         Skip building packages

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$SCRIPT_DIR"
cd "$REPO_ROOT"

# Parse arguments
APP_TYPE="desktop"
NO_INSTALL=0
SKIP_BUILD=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    desktop) APP_TYPE="desktop"; shift ;;
    mobile) APP_TYPE="mobile"; shift ;;
    --no-install) NO_INSTALL=1; shift ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    -h|--help)
      cat <<EOF
╔══════════════════════════════════════════════════════════════╗
║                      SyntaxSenpai                            ║
║          Your AI Companion That Codes With You               ║
╚══════════════════════════════════════════════════════════════╝

USAGE: ./start-mac-app.sh [OPTION]

OPTIONS:
  desktop              Launch Electron desktop app (default)
  mobile               Launch Expo mobile app (iOS/Android simulator)
  --no-install         Skip pnpm install
  --skip-build         Skip building packages
  --help               Show this help

EXAMPLES:
  ./start-mac-app.sh                 # Start desktop app
  ./start-mac-app.sh mobile          # Start mobile app
  ./start-mac-app.sh desktop --no-install

FEATURES:
  ✅ Single unified window (no window spam)
  ✅ 5 AI waifus with unique personalities
  ✅ 8+ AI provider integrations
  ✅ Streaming chat responses
  ✅ Secure local storage
  ✅ Dark-first minimalist UI

API SETUP:
  1. Select waifu from list
  2. Choose AI provider (Anthropic, OpenAI, Gemini, etc.)
  3. Enter your API key
  4. Start chatting!

DOCS:
  Desktop:  apps/desktop/README.md
  Mobile:   apps/mobile/README.md
  Full:     IMPLEMENTATION_COMPLETE.md

EOF
      exit 0
      ;;
    *) echo "❌ Unknown option: $1" >&2; exit 1 ;;
  esac
done

# Platform check
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "⚠️  Warning: This script is intended for macOS (Darwin)." >&2
fi

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║ SyntaxSenpai - $APP_TYPE app launcher                         ║"
echo "║ Root: $REPO_ROOT" | head -c 59
echo "║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Check dependencies
if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js not found"
  echo "   Install Node >=20: https://nodejs.org/"
  exit 1
fi
echo "✅ Node: $(node --version)"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "❌ pnpm not found"
  echo "   Install via: npm i -g pnpm"
  exit 1
fi
echo "✅ pnpm: $(pnpm --version)"
echo ""

# Install dependencies
if [[ $NO_INSTALL -eq 0 ]]; then
  echo "📦 Installing workspace dependencies..."
  pnpm install --prefer-frozen-lockfile || pnpm install
  echo "✅ Dependencies installed"
  echo ""
fi

# Build packages
if [[ $SKIP_BUILD -eq 0 ]]; then
  echo "🔨 Building core packages (best-effort)..."
  pnpm -w -r \
    --filter @syntax-senpai/waifu-core \
    --filter @syntax-senpai/ai-core \
    --filter @syntax-senpai/storage \
    --filter @syntax-senpai/ui \
    run build || true
  echo "✅ Packages built"
  echo ""
fi

# Launch app
case "$APP_TYPE" in
  desktop)
    echo "🚀 Launching desktop app (Electron)..."
    echo "   App will open in a new window"
    echo ""
    if [[ $SKIP_BUILD -eq 0 ]]; then
      echo "🔧 Building desktop app..."
      pnpm -w --filter syntax-senpai-desktop run build || true
    fi
    echo "🚪 Starting app in production mode"
    env -u ELECTRON_RUN_AS_NODE pnpm --filter syntax-senpai-desktop run start
    ;;
  mobile)
    echo "🚀 Launching mobile app (Expo)..."
    echo "   Scan the QR code with Expo Go app"
    echo "   Or press 'i' for iOS simulator / 'a' for Android"
    echo ""
    pnpm -w --filter syntax-senpai-mobile run dev
    ;;
esac

exit 0
