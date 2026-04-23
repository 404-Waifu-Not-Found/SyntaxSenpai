# Modern UI Guide - SyntaxSenpai
**Modern, Minimal Design | Dark-First | Character-Centered**

---

## 🎨 Design Philosophy

Our UI is inspired by modern, minimalist design principles:
- **Character-First**: Waifu avatar is central focus
- **Dark Mode**: Beautiful dark theme by default
- **Minimal**: Clean, uncluttered interface
- **Modern**: Smooth animations, subtle effects
- **Responsive**: Works on all screen sizes

---

## 🎯 New Modern Components

### 1. WaifuAvatar
Centered character display with animations and status indicators.

```typescript
import { WaifuAvatar } from "@syntax-senpai/ui";

<WaifuAvatar
  name="Ayame"
  avatarUrl="/avatars/ayame.png"
  expression="happy"
  isTyping={false}
  size="lg"
/>
```

**Features**:
- Large, centered character display
- Glow effects and animations
- Status indicator (online, typing)
- Multiple sizes: sm | md | lg

---

### 2. ModernChat
Complete, polished chat interface with modern design.

```typescript
import { ModernChat } from "@syntax-senpai/ui";

<ModernChat
  messages={messages}
  waifuName="Ayame"
  waifuAvatar="/avatars/ayame.png"
  onSendMessage={handleMessage}
  isLoading={isLoading}
  showAvatar={true}
/>
```

**Features**:
- Character avatar at top
- Welcome message for new conversations
- Typing indicators with animation
- Auto-expanding textarea
- Smooth scrolling
- Minimal top bar
- Modern input area
- Keyboard shortcuts (Shift+Enter)

---

### 3. OnboardingFlow
Beautiful, minimal onboarding experience.

```typescript
import { OnboardingFlow } from "@syntax-senpai/ui";

<OnboardingFlow
  waifus={builtInWaifus}
  providers={[
    { id: "anthropic", name: "Anthropic", displayName: "Claude" },
    { id: "groq", name: "Groq", displayName: "Groq (Free)" }
  ]}
  onComplete={(waifuId, provider, apiKey) => {
    // Handle setup complete
  }}
/>
```

**Features**:
- Welcome step with call-to-action
- Waifu selection grid
- API key input with security note
- Progress tracking
- Back navigation
- Completion screen

---

## 🎨 Color System

```typescript
// Dark theme (default)
const colors = {
  bg: {
    primary: "#0f0f0f",      // Nearly black
    secondary: "#1a1a1a",    // Slightly lighter
    tertiary: "#2a2a2a",     // Hover states
    input: "#1f1f1f"
  },
  text: {
    primary: "#ffffff",      // White
    secondary: "#a0a0a0",    // Gray
    muted: "#606060"         // Very light gray
  },
  border: "#333333",
  accent: "#6366f1",         // Indigo (waifu color)
  error: "#ef4444",
  success: "#10b981"
}
```

---

## 📱 Complete App Example

Here's how to build a complete modern app:

```typescript
import React, { useState } from "react";
import {
  ModernChat,
  OnboardingFlow,
  WaifuAvatar,
  setTheme,
} from "@syntax-senpai/ui";
import { AIChatRuntime } from "@syntax-senpai/ai-core";
import { builtInWaifus } from "@syntax-senpai/waifu-core";
import { createChatStore, APIKeyManager } from "@syntax-senpai/storage";

export function ModernChatApp() {
  setTheme("dark"); // Enable dark mode

  const [isSetup, setIsSetup] = useState(false);
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentWaifu, setCurrentWaifu] = useState(null);
  const [apiKey, setApiKey] = useState("");
  const [provider, setProvider] = useState("anthropic");

  const keyManager = new APIKeyManager("desktop");
  const chatStore = createChatStore("desktop");

  const handleSetupComplete = async (
    waifuId: string,
    selectedProvider: string,
    key: string
  ) => {
    await keyManager.setKey(selectedProvider, key);
    setCurrentWaifu(builtInWaifus.find((w) => w.id === waifuId));
    setApiKey(key);
    setProvider(selectedProvider);
    setIsSetup(true);
  };

  const handleSendMessage = async (text: string) => {
    setIsLoading(true);
    const newUserMessage = {
      id: `user-${Date.now()}`,
      role: "user" as const,
      content: text,
      timestamp: new Date().toLocaleTimeString(),
    };

    setMessages((prev) => [...prev, newUserMessage]);

    try {
      const runtime = new AIChatRuntime({
        provider: { type: provider, apiKey },
        model: "claude-opus-4-1",
        systemPrompt: `You are ${currentWaifu?.displayName}. ${currentWaifu?.backstory}`,
      });

      const result = await runtime.sendMessage({
        text,
        history: messages,
      });

      const newAssistantMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant" as const,
        content: result.response.content,
        timestamp: new Date().toLocaleTimeString(),
      };

      setMessages((prev) => [...prev, newAssistantMessage]);

      // Save to database
      if (chatStore && currentWaifu) {
        const conv = await chatStore.createConversation(currentWaifu.id);
        await chatStore.addMessage(conv.id, newUserMessage);
        await chatStore.addMessage(conv.id, newAssistantMessage);
      }
    } catch (error) {
      alert(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Show onboarding if not set up
  if (!isSetup) {
    return (
      <OnboardingFlow
        waifus={builtInWaifus}
        providers={[
          { id: "anthropic", name: "Anthropic", displayName: "Claude 3.5" },
          { id: "groq", name: "Groq", displayName: "Groq (Free)" },
          { id: "openai", name: "OpenAI", displayName: "GPT-4o" },
        ]}
        onComplete={handleSetupComplete}
      />
    );
  }

  // Show modern chat
  return (
    <ModernChat
      messages={messages}
      waifuName={currentWaifu?.displayName || "Waifu"}
      waifuAvatar={currentWaifu?.avatar.expressions.neutral.uri}
      onSendMessage={handleSendMessage}
      isLoading={isLoading}
      showAvatar={messages.length === 0}
    />
  );
}
```

---

## 🎬 Features Overview

### ModernChat Features
- ✅ Character avatar display (first message)
- ✅ Welcome message with statistics
- ✅ Real-time typing indicators
- ✅ Smooth message animations
- ✅ Auto-scrolling
- ✅ Auto-expanding textarea
- ✅ Keyboard shortcuts
- ✅ Loading states
- ✅ Message timestamps
- ✅ Focus states with animations

### OnboardingFlow Features
- ✅ Welcome screen
- ✅ Waifu selection grid
- ✅ Provider selection dropdown
- ✅ API key input
- ✅ Security information
- ✅ Back navigation
- ✅ Completion screen
- ✅ Step-by-step progress

### WaifuAvatar Features
- ✅ Large circular display
- ✅ Glow effects
- ✅ Status indicator
- ✅ Typing animation
- ✅ Fallback initials
- ✅ Multiple sizes

---

## 🎨 Customization

### Change Theme

```typescript
import { setTheme } from "@syntax-senpai/ui";

// Set dark mode
setTheme("dark");

// Set light mode
setTheme("light");

// Toggle
toggleTheme();
```

### Customize Colors

```typescript
import { colors } from "@syntax-senpai/ui";

// Access colors
const bgColor = colors.dark.bg.primary; // "#0f0f0f"
const accentColor = colors.dark.accent; // "#6366f1"
```

### Custom Styling

All components use Tailwind CSS, so you can override with custom classes:

```typescript
<ModernChat
  className="custom-chat-class"
  // ... other props
/>
```

---

## 📱 Mobile-Optimized

All components are fully responsive:

```typescript
// Works on mobile
<ModernChat
  messages={messages}
  waifuName="Ayame"
  // Layout adapts automatically
/>
```

**Mobile optimizations**:
- Touch-friendly buttons
- Large text areas
- Full viewport height
- Smooth scrolling
- Responsive grid layouts
- Mobile-friendly onboarding

---

## ⌨️ Keyboard Shortcuts

In ModernChat:
- **Enter** - Send message
- **Shift+Enter** - New line
- **Esc** - Clear (optional, not implemented)

---

## 🎭 Avatar Expressions

WaifuAvatar supports multiple expressions:
- `neutral` - Default
- `happy` - Positive conversation
- `sad` - Empathetic responses
- `thinking` - Processing input
- `excited` - Enthusiastic replies

---

## 🚀 Using in Your App

### Desktop (Electron)

```typescript
import { ModernChat, setTheme } from "@syntax-senpai/ui";

export function App() {
  setTheme("dark");
  return <ModernChat {...props} />;
}
```

### Mobile (Expo)

```typescript
import { ModernChat, setTheme } from "@syntax-senpai/ui";
import { View } from "react-native";

export function App() {
  setTheme("dark");
  return (
    <View style={{ flex: 1 }}>
      <ModernChat {...props} />
    </View>
  );
}
```

---

## 📊 Component Sizes

### WaifuAvatar
- `sm` - 96px (6rem)
- `md` - 128px (8rem)
- `lg` - 192px (12rem)

### Button
- `sm` - Compact
- `md` - Standard (default)
- `lg` - Large

---

## 🎨 Dark Mode by Default

All components come with beautiful dark theme by default:

```typescript
// Dark mode is automatic
<ModernChat />

// But you can override
<div className="light">
  <ModernChat />
</div>
```

---

## Animation Classes

The UI uses these Tailwind animation classes:

```css
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes bounce { ... }
@keyframes pulse { ... }
```

---

## Performance

- ✅ Lightweight components
- ✅ Minimal re-renders
- ✅ Lazy loading support
- ✅ Smooth 60fps animations
- ✅ No external animation libraries

---

## Next Steps

1. **Copy** this guide structure to your app
2. **Use ModernChat** for main chat interface
3. **Use OnboardingFlow** for setup
4. **Use WaifuAvatar** for character display
5. **Connect to AI providers** and storage
6. **Deploy** with confidence!

---

**The UI is ready. The design is modern. The theming is complete.**

Now it's just about wiring it to your mobile and desktop apps! 🚀
