# SyntaxSenpai Mobile

Expo / React Native companion app for SyntaxSenpai. The mobile client pairs to the desktop app by QR code and communicates through the shared WebSocket protocol.

## Run

From the repository root:

```bash
pnpm install
pnpm dev:mobile
```

Then open the Expo app on a device/simulator and scan the QR shown by desktop under **Settings -> Mobile**.

Package-local commands:

```bash
pnpm --filter syntax-senpai-mobile run dev
pnpm --filter syntax-senpai-mobile run ios
pnpm --filter syntax-senpai-mobile run android
pnpm --filter syntax-senpai-mobile run web
pnpm --filter syntax-senpai-mobile run typecheck
pnpm --filter syntax-senpai-mobile run lint
```

## Structure

```text
apps/mobile/
├── app/
│   ├── _layout.tsx
│   └── (main)/
│       ├── chat.tsx
│       ├── scan.tsx
│       ├── pair-confirm.tsx
│       └── settings.tsx
├── src/
│   ├── constants/
│   └── hooks/
├── assets/
├── app.json
└── tailwind.config.ts
```

## Notes

- Uses Expo Router and NativeWind.
- Pairs with desktop rather than acting as a fully standalone provider-key manager.
- Uses `@syntax-senpai/ws-protocol` for shared pairing/message types.
- iOS local device builds require a valid Apple Developer team and bundle identifier in Xcode.

## Troubleshooting

Clear the Expo cache:

```bash
pnpm --filter syntax-senpai-mobile run dev -- --clear
```

If iOS signing fails, open `ios/SyntaxSenpai.xcworkspace`, enable automatic signing for your team, and use a bundle identifier registered to that team.
