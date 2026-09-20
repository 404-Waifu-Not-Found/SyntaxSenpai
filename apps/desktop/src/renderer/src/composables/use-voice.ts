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

const ENABLED_STORAGE_KEY = 'syntax-senpai-voice-enabled'

/**
 * Speech synthesis composable. Pronounces waifu messages via the browser's
 * Web Speech API using the per-waifu profile from waifu-core.
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
    if (activeRequestId.value) {
      invoke('tts:cancel', activeRequestId.value).catch(() => {})
      activeRequestId.value = null
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
    cancel()
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
    emotionMode: 'auto' | 'manual'
    manualEmotion: string
  } {
    const tts = (waifu?.tts || {}) as WaifuTtsConfig
    return {
      provider: tts.provider === 'indextts' ? 'indextts' : 'web-speech',
      fallback: tts.fallback === 'silent' ? 'silent' : 'web-speech',
      enabled: typeof tts.enabled === 'boolean' ? tts.enabled : enabled.value,
      voicePresetId: typeof tts.voicePresetId === 'string' ? tts.voicePresetId : '',
      referenceWavId: typeof tts.referenceWavId === 'string' ? tts.referenceWavId : '',
      emotionMode: tts.emotion?.mode === 'manual' ? 'manual' : 'auto',
      manualEmotion: typeof tts.emotion?.manual === 'string' ? tts.emotion.manual : 'neutral',
    }
  }

  async function speak(text: string, waifuId: string, waifu?: Waifu | null, expression?: Expression) {
    if (!supported) return
    const config = resolveTtsConfig(waifu)
    if (!config.enabled) return

    if (config.provider !== 'indextts') {
      speakViaWebSpeech(text, waifuId)
      return
    }

    const profile = getVoiceProfile(waifuId)
    const trimmed = trimForSpeech(text, profile.maxChars)
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
        speakViaWebSpeech(text, waifuId)
      }
    } catch {
      if (config.fallback === 'web-speech') {
        speakViaWebSpeech(text, waifuId)
      }
    } finally {
      if (activeRequestId.value === requestId) activeRequestId.value = null
    }
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
    enabled,
    voices,
    voiceOptions,
    speaking,
    setEnabled,
    speak,
    cancel,
    refreshVoices,
  }
}
