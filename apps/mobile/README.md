# SyntaxSenpai Mobile App

Modern, character-centered AI companion for iOS and Android with Expo and Expo Router.

## Features

- **Character-Centered Design**: Beautiful waifu avatar with animations
- **Dark-First Theme**: Minimalist dark mode by default
- **Streaming Chat**: Real-time AI responses with visual streaming
- **Secure Storage**: API keys stored in OS keychain (iOS Keychain / Android Keystore)
- **Local History**: All conversations saved locally on device
- **Multi-Provider**: Anthropic, OpenAI, Groq, Together AI, and more

## Setup

### Prerequisites

- Node.js 18+ (with npm or yarn)
- Expo Go (for testing) or EAS CLI (for building)
- iOS device/simulator or Android device/emulator

### Installation

1. Install dependencies:

```bash
npm install
```

2. Start the development server:

```bash
npm run dev
```

3. Open with Expo Go:
   - Scan the QR code with Expo Go on your phone
   - Or press `i` for iOS simulator or `a` for Android emulator

### First Run

1. Select your waifu from the onboarding screen
2. Choose your AI provider (Anthropic, OpenAI, etc.)
3. Enter your API key
4. Start chatting!

## Project Structure

```
apps/mobile/
├── app/
│   ├── app.tsx              # Root layout with onboarding check
│   ├── (onboarding)/        # Onboarding flow
│   │   ├── _layout.tsx
│   │   └── index.tsx        # Multi-step setup wizard
│   └── (main)/              # Main app after onboarding
│       ├── _layout.tsx
│       └── chat.tsx         # Chat screen with streaming
├── src/
│   └── hooks/
│       └── useAppState.ts   # App state management
├── app.json                 # Expo configuration
├── babel.config.js          # Babel config for nativewind
├── tailwind.config.ts       # Tailwind CSS config
└── tsconfig.json            # TypeScript config
```

## Scripts

- `npm run dev` - Start dev server
- `npm run ios` - Build and run on iOS simulator
- `npm run android` - Build and run on Android emulator
- `npm run web` - Run web version
- `npm run build` - Build for EAS
- `npm run typecheck` - Check TypeScript
- `npm run lint` - Lint code

## Development

### Adding a New Screen

Create a new file in `app/(main)/`:

```typescript
import { Stack } from "expo-router";

export default function NewScreen() {
  return (
    <>
      <Stack.Screen options={{ title: "New Screen" }} />
      {/* Your content */}
    </>
  );
}
```

### Styling

Uses Tailwind CSS via NativeWind v4. All standard Tailwind classes work:

```typescript
<View className="flex-1 bg-neutral-950 px-4">
  <Text className="text-white font-bold">Hello</Text>
</View>
```

### Storage

- **AsyncStorage**: App state (selectedWaifu, selectedProvider, onboarding status)
- **API Key Storage**: Secure OS keychain via `@syntax-senpai/storage`
- **Chat History**: In-memory (can be extended with SQLite via expo-sqlite)

## Building for Production

### iOS

```bash
npx eas build --platform ios
```

### Android

```bash
npx eas build --platform android
```

## Testing

Currently using Expo's built-in testing. Expand with React Native Testing Library:

```bash
npm run test
```

## Deployment

1. Set up EAS account
2. Update app version in `app.json`
3. Run `npx eas build --platform ios --platform android`
4. Submit to App Store / Play Store

## Troubleshooting

### iOS provisioning profile error

If Xcode fails with a message like `No profiles for 'com.syntaxsenpai.app' were found`, local
device builds are using a bundle identifier or Apple team that does not match your developer
account. Open `ios/SyntaxSenpai.xcworkspace` in Xcode, enable automatic signing for your team, and
use a bundle identifier that exists under that team.

If `eas` is not installed globally, run it with `npx eas ...`.

### Port already in use
```bash
npm run dev -- --clear
```

### Module resolution issues
```bash
rm -rf node_modules
npm install
```

### Clear Expo cache
```bash
npm run dev -- -c
```

## Contributing

Pull requests welcome! Please follow the existing code style and create feature branches.

## License

MIT - See root LICENSE
