import { ref, computed, onMounted, onUnmounted } from 'vue'
import {
  getVoiceProfile,
  pickVoice,
  trimForSpeech,
  mapExpressionToTtsEmotion,
  type Waifu,
  type WaifuTtsConfig,
  type Expression,
} from '@syntax-senpai/waifu-core'
import { useIpc } from './use-ipc'
import { normalizeVoiceoverText } from '../utils/assistant-output'

const ENABLED_STORAGE_KEY = 'syntax-senpai-voice-enabled'

/**
 * Speech synthesis composable. Assistant-selected voice-over uses the
 * waifu's MiniMax clone; other configured engines remain available for previews.
 *
 * The toggle persists across sessions; calls to speak() while disabled are
 * silent no-ops so we don't have to gate every call-site.
 */
export function useVoice() {
  const { invoke } = useIpc()
  const webSpeechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window
  const ipcAvailable = typeof window !== 'undefined' && Boolean((window as any).electron?.ipcRenderer)
  const supported = webSpeechSupported || ipcAvailable
  const enabled = ref<boolean>(
    (webSpeechSupported || ipcAvailable) && localStorage.getItem(ENABLED_STORAGE_KEY) === 'true'
  )
  const voices = ref<SpeechSynthesisVoice[]>([])
  const speaking = ref(false)
  const activeAudio = ref<HTMLAudioElement | null>(null)
  const activeRequestId = ref<string | null>(null)

  function refreshVoices() {
    if (!webSpeechSupported) return
    voices.value = window.speechSynthesis.getVoices()
  }

  function setEnabled(value: boolean) {
    enabled.value = value
    try {
      localStorage.setItem(ENABLED_STORAGE_KEY, value ? 'true' : 'false')
    } catch {
      /* localStorage may be unavailable in some sandboxes */
    }
    if (!value) cancel()
  }

  function cancel() {
    stopCurrentPlayback()
    if (activeRequestId.value) {
      invoke('tts:cancel', activeRequestId.value).catch(() => {})
      activeRequestId.value = null
    }
  }

  function stopCurrentPlayback() {
    if (webSpeechSupported) {
      try {
        window.speechSynthesis.cancel()
      } catch {
        /* best effort */
      }
    }
    if (activeAudio.value) {
      try {
        activeAudio.value.pause()
      } catch {
        /* best effort */
      }
      activeAudio.value = null
    }
    speaking.value = false
  }

  function speakViaWebSpeech(text: string, waifuId: string) {
    if (!webSpeechSupported) return
    const profile = getVoiceProfile(waifuId)
    const trimmed = trimForSpeech(text, profile.maxChars)
    if (!trimmed) return

    cancel()
    const utterance = new SpeechSynthesisUtterance(trimmed)
    utterance.pitch = profile.pitch
    utterance.rate = profile.rate
    utterance.volume = profile.volume
    utterance.lang = profile.lang
    const picked = pickVoice(voices.value, profile)
    if (picked) utterance.voice = picked

    utterance.onend = () => {
      speaking.value = false
    }
    utterance.onerror = () => {
      speaking.value = false
    }
    speaking.value = true
    try {
      window.speechSynthesis.speak(utterance)
    } catch {
      speaking.value = false
    }
  }

  async function playAudio(audioPath: string) {
    // A synthesis request has already completed by the time its audio is
    // played. Stop the previous player without cancelling that request again.
    stopCurrentPlayback()
    const audio = new Audio(audioPath)
    activeAudio.value = audio
    speaking.value = true
    audio.onended = () => {
      if (activeAudio.value === audio) activeAudio.value = null
      speaking.value = false
    }
    audio.onerror = () => {
      if (activeAudio.value === audio) activeAudio.value = null
      speaking.value = false
    }
    try {
      await audio.play()
    } catch {
      if (activeAudio.value === audio) activeAudio.value = null
      speaking.value = false
      throw new Error('audio-playback-failed')
    }
  }

  function resolveTtsConfig(waifu?: Waifu | null): Required<Pick<WaifuTtsConfig, 'provider' | 'fallback'>> & {
    enabled: boolean
    voicePresetId: string
    referenceWavId: string
    minimaxVoiceId: string
    emotionMode: 'auto' | 'manual'
    manualEmotion: string
  } {
    const tts = (waifu?.tts || {}) as WaifuTtsConfig
    return {
      provider: tts.provider === 'web-speech' || tts.provider === 'indextts' ? tts.provider : 'minimax-clone',
      fallback: tts.fallback === 'silent' ? 'silent' : 'web-speech',
      enabled: typeof tts.enabled === 'boolean' ? tts.enabled : enabled.value,
      voicePresetId: typeof tts.voicePresetId === 'string' ? tts.voicePresetId : '',
      referenceWavId: typeof tts.referenceWavId === 'string' ? tts.referenceWavId : '',
      minimaxVoiceId: typeof tts.minimaxVoiceId === 'string' ? tts.minimaxVoiceId : '',
      emotionMode: tts.emotion?.mode === 'manual' ? 'manual' : 'auto',
      manualEmotion: typeof tts.emotion?.manual === 'string' ? tts.emotion.manual : 'neutral',
    }
  }

  function canSpeak(waifu?: Waifu | null) {
    return supported && resolveTtsConfig(waifu).enabled
  }

  function canSpeakMiniMaxClone(waifu?: Waifu | null) {
    const config = resolveTtsConfig(waifu)
    return ipcAvailable && config.enabled && !!config.minimaxVoiceId.trim()
  }

  async function speakMiniMaxClone(
    text: string,
    waifuId: string,
    waifu?: Waifu | null,
    expression?: Expression,
  ): Promise<{ success: boolean; error?: string }> {
    if (!ipcAvailable) return { success: false, error: 'MiniMax voice playback requires the desktop app.' }
    const config = resolveTtsConfig(waifu)
    if (!config.enabled) return { success: false, error: 'Voice output is disabled for this waifu.' }
    if (!config.minimaxVoiceId.trim()) {
      return { success: false, error: 'No MiniMax cloned voice is configured for this waifu.' }
    }

    const spokenText = normalizeVoiceoverText(text)
    const profile = getVoiceProfile(waifuId)
    const trimmed = trimForSpeech(spokenText, profile.maxChars)
    if (!trimmed) return { success: false, error: 'There is no speakable text to read.' }

    cancel()
    const requestId = `tts_${Date.now()}_${Math.random().toString(16).slice(2)}`
    activeRequestId.value = requestId
    try {
      const emotion = config.emotionMode === 'manual'
        ? config.manualEmotion
        : mapExpressionToTtsEmotion(expression as any)
      const result: any = await invoke('tts:synthesize', {
        provider: 'minimax-clone',
        text: trimmed,
        waifuId,
        voiceId: config.minimaxVoiceId,
        emotion,
        requestId,
      })
      if (!result?.success || typeof result.audioPath !== 'string' || !result.audioPath) {
        return { success: false, error: result?.error || 'MiniMax voice synthesis returned no audio.' }
      }
      if (activeRequestId.value !== requestId) {
        return { success: false, error: 'MiniMax voice playback was cancelled before it started.' }
      }

      await playAudio(result.audioPath)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error?.message || String(error) || 'MiniMax voice playback failed.' }
    } finally {
      if (activeRequestId.value === requestId) activeRequestId.value = null
    }
  }

  async function speak(text: string, waifuId: string, waifu?: Waifu | null, expression?: Expression) {
    if (!supported) return
    const config = resolveTtsConfig(waifu)
    if (!config.enabled) return
    const spokenText = normalizeVoiceoverText(text)
    if (!spokenText) return

    if (config.provider === 'web-speech') {
      speakViaWebSpeech(spokenText, waifuId)
      return
    }
    if (config.provider === 'minimax-clone') {
      const result = await speakMiniMaxClone(spokenText, waifuId, waifu, expression)
      if (!result.success) console.warn('MiniMax voice playback failed:', result.error)
      return
    }

    const profile = getVoiceProfile(waifuId)
    const trimmed = trimForSpeech(spokenText, profile.maxChars)
    if (!trimmed) return
    const requestId = `tts_${Date.now()}_${Math.random().toString(16).slice(2)}`
    activeRequestId.value = requestId
    try {
      const emotion = config.emotionMode === 'manual'
        ? config.manualEmotion
        : mapExpressionToTtsEmotion(expression as any)
      const res: any = await invoke('tts:synthesize', {
        text: trimmed,
        waifuId,
        voicePresetId: config.voicePresetId,
        referenceWavId: config.referenceWavId,
        emotion,
        requestId,
      })
      if (res?.success && typeof res.audioPath === 'string' && res.audioPath) {
        await playAudio(res.audioPath)
        return
      }
      if (config.fallback === 'web-speech') {
        speakViaWebSpeech(spokenText, waifuId)
      }
    } catch {
      if (config.fallback === 'web-speech') {
        speakViaWebSpeech(spokenText, waifuId)
      }
    } finally {
      if (activeRequestId.value === requestId) activeRequestId.value = null
    }
  }

  async function cloneMiniMaxVoice(displayName: string) {
    return invoke('tts:minimaxCloneVoice', { displayName })
  }

  const voiceOptions = computed(() =>
    voices.value.map((v) => ({ name: v.name, lang: v.lang }))
  )

  onMounted(() => {
    if (!webSpeechSupported) return
    refreshVoices()
    window.speechSynthesis.addEventListener('voiceschanged', refreshVoices)
  })

  onUnmounted(() => {
    if (webSpeechSupported) {
      window.speechSynthesis.removeEventListener('voiceschanged', refreshVoices)
    }
    cancel()
  })

  return {
    supported,
    canSpeak,
    canSpeakMiniMaxClone,
    enabled,
    voices,
    voiceOptions,
    speaking,
    setEnabled,
    speak,
    speakMiniMaxClone,
    cloneMiniMaxVoice,
    cancel,
    refreshVoices,
  }
}
