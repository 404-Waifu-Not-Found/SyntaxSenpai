/**
 * Waifu personality model and data types
 */

export type WaifuExpression =
  | "neutral"
  | "happy"
  | "excited"
  | "thinking"
  | "confused"
  | "embarrassed"
  | "determined"
  | "sad";

/**
 * Personality traits on a 0-100 scale
 */
export interface WaifuPersonalityTraits {
  warmth: number; // 0: cold/professional ↔ 100: warm/affectionate
  formality: number; // 0: casual ↔ 100: formal
  enthusiasm: number; // 0: calm ↔ 100: hyper energetic
  teasing: number; // 0: sincere ↔ 100: playful/tsundere
  verbosity: number; // 0: terse ↔ 100: elaborate
  humor: number; // 0: serious ↔ 100: comedic
}

/**
 * Communication style and speech patterns
 */
export interface WaifuCommunicationStyle {
  greetingPrefix?: string; // e.g. "O-oh, you're asking me again~"
  affirmationPhrase?: string; // e.g. "Leave it to me!"
  deflectionPhrase?: string; // e.g. "I-it's not like I wanted to help you..."
  signatureEmojis: string[]; // e.g. ["✨", "💻", "🌸"]
  speaksIn3rdPerson: boolean;
  usesHonorificSelf?: string; // e.g. "boku", "atashi", "ore"
}

/**
 * Avatar sprite for an expression
 */
export interface AvatarAsset {
  type: "lottie" | "png" | "svg";
  uri: string; // bundled asset path or remote URL
}

/**
 * Waifu avatar with expressions
 */
export interface WaifuAvatar {
  expressions: Record<WaifuExpression, AvatarAsset>;
  idleAnimation?: string; // key or URI to Lottie/Skia animation
}

/**
 * What tools/capabilities the waifu can access
 */
export interface WaifuCapabilities {
  fileSystem: boolean;
  shellExecution: boolean;
  webSearch: boolean;
  codeExecution: boolean;
  remoteDesktopControl: boolean; // only true if desktop agent connected
}

/**
 * Core waifu definition
 */
export interface Waifu {
  id: string; // uuid
  name: string; // internal name
  displayName: string; // name shown to user (may include honorifics)
  sourceAnime?: string; // e.g. "Re:Zero" (if based on existing character)
  backstory: string; // 200-500 word narrative
  personalityTraits: WaifuPersonalityTraits;
  communicationStyle: WaifuCommunicationStyle;
  avatar: WaifuAvatar;
  capabilities: WaifuCapabilities;
  systemPromptTemplate: string; // Handlebars template, filled at runtime
  preferredAIProvider?: string; // provider id hint
  preferredModel?: string;
  createdAt: string; // ISO 8601
  isBuiltIn: boolean;
  tags: string[]; // e.g. ["tsundere", "hacker", "kuudere"]
  catchphrases?: string[]; // signature lines
}

/**
 * Per-user relationship with a waifu
 */
export interface WaifuRelationship {
  waifuId: string;
  userId: string;
  nickname?: string; // user's custom name for the waifu
  affectionLevel: number; // 0-100
  memorySummary?: string; // compressed long-term memory
  customPersonalityOverrides?: Partial<WaifuPersonalityTraits>;
  selectedAIProvider: string;
  selectedModel: string;
  createdAt: string; // ISO 8601
  lastInteractedAt: string; // ISO 8601
}

/**
 * Runtime context for system prompt building
 */
export interface SystemPromptContext {
  userId: string;
  waifuNickname?: string;
  affectionLevel?: number;
  memorySummary?: string;
  availableTools?: string[];
  platform?: "mobile" | "desktop";
}
