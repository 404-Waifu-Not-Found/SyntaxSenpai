Avatars generator

This package includes a small script to fetch consistent avatar images (SVG) for waifus.

- Source: DiceBear Avatars (adventurer style)
- Format: SVG
- Background: white (#ffffff)
- Size: 512x512 (square)

Usage:

1. From the monorepo root run:
   pnpm --filter @syntax-senpai/ui run avatars:generate

2. Generated files are saved to: packages/ui/public/avatars/*.svg

Notes:
- Avatars are generated from waifu ids exported by @syntax-senpai/waifu-core (if available).
- If you want custom images (real artwork), ensure they are square PNG/SVG with plain white background to match the UI.
- This script uses DiceBear (MIT) so images are safe to redistribute. Replace the fetch URL if you prefer another source.
