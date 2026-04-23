/**
 * Per-waifu voice profiles for TTS playback.
 *
 * Kept intentionally generic so the desktop can pass these straight into
 * the Web Speech API (SpeechSynthesisUtterance.pitch/rate/voice) while
 * leaving room for a future pluggable TTSProvider (ElevenLabs, OpenAI TTS)
 * to consume the same profile.
 */

export interface VoiceProfile {
  /** 0.5-2.0; lower is deeper, higher is brighter. */
  pitch: number;
  /** 0.5-2.0; words per second relative to default. */
  rate: number;
  /** 0-1; playback volume. */
  volume: number;
  /** BCP 47 locale hint for the voice. */
  lang: string;
  /**
   * Ordered list of voice-name substrings to try. First match wins.
   * Example: ["Google UK English Female", "Samantha", "Microsoft Zira"].
   */
  voiceNamePreferences: string[];
  /**
   * Character budget for the utterance. Longer responses are truncated at a
   * sentence boundary to avoid 5+ minute monologues.
   */
  maxChars: number;
}

const DEFAULT_PROFILE: VoiceProfile = {
  pitch: 1,
  rate: 1,
  volume: 1,
  lang: "en-US",
  voiceNamePreferences: [],
  maxChars: 400,
};

const PROFILES: Record<string, VoiceProfile> = {
  // Cheerful, bright — slightly faster and higher.
  aria: {
    ...DEFAULT_PROFILE,
    pitch: 1.2,
    rate: 1.05,
    voiceNamePreferences: [
      "Google UK English Female",
      "Samantha",
      "Microsoft Zira",
      "Karen",
    ],
  },
  // Energetic, teaching-focused — warm and round.
  sakura: {
    ...DEFAULT_PROFILE,
    pitch: 1.15,
    rate: 1.0,
    voiceNamePreferences: [
      "Google US English",
      "Samantha",
      "Microsoft Aria",
      "Ava",
    ],
  },
  // Calm, formal — measured pace, lower pitch.
  rei: {
    ...DEFAULT_PROFILE,
    pitch: 0.95,
    rate: 0.92,
    voiceNamePreferences: [
      "Microsoft Jenny",
      "Kate",
      "Serena",
      "Google UK English Female",
    ],
  },
  // Tsundere, sharp — quicker cadence, slightly lower pitch.
  hana: {
    ...DEFAULT_PROFILE,
    pitch: 1.05,
    rate: 1.1,
    voiceNamePreferences: [
      "Microsoft Aria",
      "Tessa",
      "Samantha",
    ],
  },
  // Mysterious, philosophical — slow, breathy.
  luna: {
    ...DEFAULT_PROFILE,
    pitch: 0.9,
    rate: 0.88,
    voiceNamePreferences: [
      "Google UK English Female",
      "Serena",
      "Microsoft Jenny",
    ],
  },
};

export function getVoiceProfile(waifuId: string): VoiceProfile {
  return PROFILES[waifuId] ?? DEFAULT_PROFILE;
}

/**
 * Picks the best voice from a list of available voices for a given profile.
 * Returns null when the host exposes no voices at all (voice synthesis
 * still works with the browser default).
 */
export function pickVoice<V extends { name: string; lang: string }>(
  voices: V[],
  profile: VoiceProfile
): V | null {
  if (!voices.length) return null;
  for (const pref of profile.voiceNamePreferences) {
    const match = voices.find((v) => v.name.toLowerCase().includes(pref.toLowerCase()));
    if (match) return match;
  }
  // Fall back to any voice that matches the locale.
  const byLang = voices.find((v) => v.lang.toLowerCase().startsWith(profile.lang.toLowerCase().slice(0, 2)));
  return byLang ?? voices[0] ?? null;
}

/**
 * Trim a long message at the last sentence boundary that fits within maxChars.
 * Keeps TTS from reading entire code dumps.
 */
export function trimForSpeech(text: string, maxChars: number): string {
  const stripped = text.trim();
  if (stripped.length <= maxChars) return stripped;
  const slice = stripped.slice(0, maxChars);
  const boundary = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "));
  return boundary > maxChars * 0.5 ? slice.slice(0, boundary + 1) : slice + "…";
}
