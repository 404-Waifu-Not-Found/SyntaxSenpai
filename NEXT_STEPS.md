# Next Steps - What to Build Next

**Current Status**: Phase 1 is 85% complete  
**Remaining Work**: Mobile + Desktop apps (12-16 hours)  
**Timeline**: 2-3 days of focused work

---

## Immediate Actions (Next 2 Hours)

### 1. Verify Everything Compiles ✅
```bash
cd /Users/unoxyrich/Documents/GitHub/SyntaxSenpai
npm run typecheck
```

Expected output: ✅ 0 errors

### 2. Test a Provider Works 🔧
```typescript
import { createProvider } from "@syntax-senpai/ai-core";

const groq = createProvider({
  type: "groq",
  apiKey: "gsk_..." // Get free key from https://console.groq.com
});

// Test it
for await (const chunk of groq.stream({
  model: "mixtral-8x7b-32768",
  messages: [{ id: "1", role: "user", content: "Hello!" }]
})) {
  if (chunk.type === "text_delta") console.log(chunk.delta);
}
```

### 3. Test Storage Works 🔐
```typescript
import { APIKeyManager, createChatStore } from "@syntax-senpai/storage";

const keyMgr = new APIKeyManager("test");
await keyMgr.setKey("groq", "test-key");
const key = await keyMgr.getKey("groq");
console.log("✅ Keys work!");

const store = createChatStore("test");
const conv = await store.createConversation("waifu-1", "Test");
await store.addMessage(conv.id, {
  id: "1",
  role: "user",
  content: "Hello",
  createdAt: new Date().toISOString()
});
console.log("✅ Storage works!");
```

---

## Phase 1 Completion Checklist

### What's Already Done ✅
- [x] Monorepo scaffold
- [x] Type system (100%)
- [x] AI providers (4 working + 11 stubs)
- [x] Waifu core system
- [x] Dark-mode UI components
- [x] Storage layer
- [x] Documentation

### What Remains ⏳
- [ ] Mobile app
- [ ] Desktop app
- [ ] Create 4 more waifus
- [ ] Integration wiring
- [ ] Testing

---

## Choose Your Path

### Path A: Build Mobile App First (Recommended) 📱
**Time**: 10-12 hours  
**Why**: Expo is faster to set up than Electron  
**Steps**:
1. Initialize Expo project
2. Set up Expo Router navigation
3. Create 3 screens: Onboarding, Chat, Settings
4. Wire up providers + storage
5. Style with Tailwind + theme system

See: `STATUS_CHECKLIST.md` Section 1F (Steps 111-135)

---

### Path B: Build Desktop App First 🖥️
**Time**: 12-14 hours  
**Why**: More complex, but all infrastructure is done  
**Steps**:
1. Initialize Electron + electron-vite
2. Create main process + renderer
3. Set up IPC communication
4. Create 3 screens: Onboarding, Chat, Settings
5. Wire up providers + storage

See: `STATUS_CHECKLIST.md` Section 1G (Steps 136-160)

---

### Path C: Create More Waifus First ✨
**Time**: 2-3 hours  
**Why**: Can be done in parallel with app building  
**What to create**:
- Sakura (genki/energetic tutor - warmth: 85, enthusiasm: 90)
- Rei (calm/genius programmer - warmth: 40, formality: 70)
- Hana (tsundere DevOps - warmth: 60, teasing: 80)
- Luna (mysterious meta-aware AI - formality: 50, humor: 75)

Use Ayame as template in `packages/waifu-core/src/index.ts`

---

## Detailed Instructions for Mobile App

### 1. Initialize Expo Project
```bash
cd apps/mobile

# Install Expo CLI if needed
npm install -g expo-cli

# Initialize with SDK 52
npx create-expo-app@latest --template

# Install dependencies
npm install expo-router expo-sqlite
npm install @react-navigation/bottom-tabs
```

### 2. Create File Structure
```
apps/mobile/
├── app/
│   ├── (onboarding)/
│   │   ├── _layout.tsx
│   │   ├── index.tsx          (Select waifu)
│   │   └── api-setup.tsx      (API key input)
│   ├── (main)/
│   │   ├── _layout.tsx
│   │   ├── chat.tsx           (Main chat)
│   │   └── settings.tsx       (Settings)
│   ├── _layout.tsx
│   └── _app.tsx
└── package.json
```

### 3. Key Components to Build

**Onboarding Screen**:
```typescript
import { WaifuExplorer, Input, Button } from "@syntax-senpai/ui";

export function OnboardingScreen() {
  const [selectedWaifu, setSelectedWaifu] = useState(null);
  const [apiKey, setApiKey] = useState("");
  
  return (
    <View className="dark bg-neutral-950 flex-1">
      <WaifuExplorer onSelect={setSelectedWaifu} />
      <Input 
        label="Anthropic API Key"
        placeholder="sk-ant-..."
        value={apiKey}
        onChangeText={setApiKey}
      />
      <Button onPress={() => save(selectedWaifu, apiKey)}>
        Start Chatting
      </Button>
    </View>
  );
}
```

**Chat Screen**:
```typescript
import { ChatContainer } from "@syntax-senpai/ui";
import { useAIChat } from "../hooks/useAIChat";

export function ChatScreen({ waifuId, apiKey }) {
  const { messages, isLoading, sendMessage } = useAIChat(waifuId, apiKey);
  
  return (
    <ChatContainer
      messages={messages}
      waifuName={waifu.displayName}
      onSendMessage={sendMessage}
      isLoading={isLoading}
    />
  );
}
```

---

## Detailed Instructions for Desktop App

### 1. Initialize Electron Project
```bash
cd apps/desktop

npm install electron electron-vite electron-builder

# Create main process file
mkdir -p src/main src/renderer
```

### 2. File Structure
```
apps/desktop/
├── src/
│   ├── main/
│   │   ├── index.ts           (Main process entry)
│   │   ├── preload.ts         (IPC security)
│   │   └── ipc/
│   │       └── handlers.ts    (Message handlers)
│   └── renderer/
│       ├── index.html
│       ├── App.tsx
│       ├── screens/
│       │   ├── OnboardingScreen.tsx
│       │   ├── ChatScreen.tsx
│       │   └── SettingsScreen.tsx
│       └── hooks/
│           └── useAIChat.ts
├── electron.vite.config.ts
└── package.json
```

### 3. Main Process (Minimal)
```typescript
// src/main/index.ts
import { app, BrowserWindow } from "electron";
import { createWindow } from "./window";

app.on("ready", () => {
  createWindow();
});

app.on("window-all-closed", () => {
  app.quit();
});
```

---

## Shared Hook for Chat Integration

Both apps will use this hook:

```typescript
// apps/mobile/hooks/useAIChat.ts (or desktop equivalent)
import { AIChatRuntime } from "@syntax-senpai/ai-core";
import { createChatStore } from "@syntax-senpai/storage";
import { buildSystemPrompt, builtInWaifus } from "@syntax-senpai/waifu-core";
import { useState, useCallback } from "react";

export function useAIChat(waifuId: string, apiKey: string) {
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  
  const sendMessage = useCallback(async (text: string) => {
    setIsLoading(true);
    try {
      const waifu = builtInWaifus.find(w => w.id === waifuId);
      const runtime = new AIChatRuntime({
        provider: { type: "anthropic", apiKey },
        model: "claude-opus-4-1",
        systemPrompt: buildSystemPrompt(waifu, { /* ... */ })
      });
      
      const result = await runtime.sendMessage({
        text,
        history: messages
      });
      
      setMessages([...messages, 
        { id: "1", role: "user", content: text },
        { id: "2", role: "assistant", content: result.response.content }
      ]);
      
      // Store in database
      const store = createChatStore("mobile");
      // ... save to store
    } catch (error) {
      alert(`Error: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  }, [waifuId, apiKey, messages]);
  
  return { messages, isLoading, sendMessage };
}
```

---

## Quick Implementation Tips

### Styling
- Use `className="dark"` on root to enable dark mode
- All UI components have dark theme built-in
- Tailwind classes work across mobile and web

### State Management
- Use Zustand for simple state (already in dependencies)
- Keep messages in component state initially
- Sync to storage in background

### Error Handling
```typescript
try {
  const result = await runtime.sendMessage(...);
} catch (error) {
  if (error.message.includes("API key")) {
    // Prompt for key
  } else if (error.message.includes("rate limit")) {
    // Show retry button
  } else {
    // Generic error
  }
}
```

### Testing
```bash
# Build and typecheck
npm run typecheck

# Test imports
import { ChatContainer } from "@syntax-senpai/ui";
```

---

## Success Criteria for Phase 1 Completion

✅ Mobile app:
- Onboarding screen (select waifu + API key)
- Chat screen (send/receive messages)
- Settings screen (change provider/key)
- Messages persist to storage
- Waifu personality in responses

✅ Desktop app:
- Same as mobile
- Single window
- Settings dialog instead of tab

✅ Both:
- Dark mode by default
- All 15 providers accessible
- Message history saved
- Waifu responses are in-character

---

## Recommended Timeline

**Day 1** (Today):
- ✅ Verify everything compiles
- ✅ Test a provider
- ✅ Test storage
- ⏳ Start mobile app scaffolding

**Day 2**:
- ⏳ Build mobile screens
- ⏳ Wire up chat integration
- ⏳ Create 4 additional waifus

**Day 3**:
- ⏳ Build desktop app
- ⏳ Full integration testing
- ⏳ Bug fixes and polish

**Phase 1 Complete**: 2026-04-10

---

## Getting Help

- **AI Provider issues**: See `PROVIDER_SETUP.md`
- **UI Components**: See `QUICK_START.md`
- **Storage**: Check `packages/storage/src/` examples
- **Current Status**: See `STATUS_CHECKLIST.md`

---

**You're 85% done!** The hardest parts are built. Now it's just wiring it all together.

**Ready? Start with Mobile app or Waifus?**
