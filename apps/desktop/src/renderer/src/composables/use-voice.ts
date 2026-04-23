import { ref, computed, onMounted, onUnmounted } from 'vue'
import { getVoiceProfile, pickVoice, trimForSpeech } from '@syntax-senpai/waifu-core'

const ENABLED_STORAGE_KEY = 'syntax-senpai-voice-enabled'

/**
 * Speech synthesis composable. Pronounces waifu messages via the browser's
 * Web Speech API using the per-waifu profile from waifu-core.
 *
 * The toggle persists across sessions; calls to speak() while disabled are
 * silent no-ops so we don't have to gate every call-site.
 */
export function useVoice() {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window
  const enabled = ref<boolean>(
    supported && localStorage.getItem(ENABLED_STORAGE_KEY) === 'true'
  )
  const voices = ref<SpeechSynthesisVoice[]>([])
  const speaking = ref(false)

  function refreshVoices() {
    if (!supported) return
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
    if (!supported) return
    try {
      window.speechSynthesis.cancel()
    } catch {
      /* best effort */
    }
    speaking.value = false
  }

  function speak(text: string, waifuId: string) {
    if (!supported || !enabled.value) return
    const profile = getVoiceProfile(waifuId)
    const trimmed = trimForSpeech(text, profile.maxChars)
    if (!trimmed) return

    // Cancel any in-flight utterance so only the latest response is heard.
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

  const voiceOptions = computed(() =>
    voices.value.map((v) => ({ name: v.name, lang: v.lang }))
  )

  onMounted(() => {
    if (!supported) return
    refreshVoices()
    window.speechSynthesis.addEventListener('voiceschanged', refreshVoices)
  })

  onUnmounted(() => {
    if (!supported) return
    window.speechSynthesis.removeEventListener('voiceschanged', refreshVoices)
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
