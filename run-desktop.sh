#!/bin/bash
set -euo pipefail

# Simple desktop launcher - bypass electron-vite issues
cd "$(dirname "$0")/apps/desktop"

echo "🚀 Starting SyntaxSenpai Desktop..."
echo "📦 Installing dependencies..."
pnpm install --prefer-frozen-lockfile || pnpm install

echo "🔨 Building..."
pnpm run build 2>/dev/null || true

echo "✅ Launching Electron app..."
pnpm run start

exit 0
