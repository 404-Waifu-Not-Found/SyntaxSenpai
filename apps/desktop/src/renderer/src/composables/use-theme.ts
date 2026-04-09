import { ref, watch, onMounted, onUnmounted, computed } from 'vue'

export interface ThemeColors {
  bg: string
  surface: string
  surface2: string
  fg: string
  primary: string
  accent: string
  userBubble: string
  assistantBubble: string
}

export interface RainbowSettings {
  enabled: boolean
  speed: number      // 1-10, how fast the hue cycles
  saturation: number  // 0-100
  lightness: number   // 0-100 (lower = darker, higher = lighter)
}

export interface ThemeConfig {
  colors: ThemeColors
  rainbow: RainbowSettings
}

const STORAGE_KEY = 'syntax-senpai-theme'

const DEFAULT_THEME: ThemeConfig = {
  colors: {
    bg: '#0f0f0f',
    surface: '#111216',
    surface2: '#0d0f13',
    fg: '#ffffff',
    primary: '#6366f1',
    accent: '#ec4899',
    userBubble: '#4f46e5',
    assistantBubble: '#1a1a2e',
  },
  rainbow: {
    enabled: false,
    speed: 5,
    saturation: 70,
    lightness: 55,
  },
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result
    ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
    : { r: 0, g: 0, b: 0 }
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('')
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100
  l /= 100
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
    return Math.round(255 * color)
  }
  return rgbToHex(f(0), f(8), f(4))
}

/** Lighten or darken a hex color by a percentage (-100 to 100) */
function adjustBrightness(hex: string, percent: number): string {
  const { r, g, b } = hexToRgb(hex)
  const amt = Math.round(2.55 * percent)
  return rgbToHex(r + amt, g + amt, b + amt)
}

// Singleton state so all components share the same theme
const theme = ref<ThemeConfig>(loadTheme())
const currentRainbowHue = ref(0)
let rainbowFrame: number | null = null
let rainbowHue = 0

function loadTheme(): ThemeConfig {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      return { ...DEFAULT_THEME, ...parsed, colors: { ...DEFAULT_THEME.colors, ...parsed.colors }, rainbow: { ...DEFAULT_THEME.rainbow, ...parsed.rainbow } }
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_THEME, colors: { ...DEFAULT_THEME.colors }, rainbow: { ...DEFAULT_THEME.rainbow } }
}

function saveTheme() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(theme.value))
}

function applyThemeToDOM(colors: ThemeColors) {
  const root = document.documentElement
  root.style.setProperty('--bg', colors.bg)
  root.style.setProperty('--surface', colors.surface)
  root.style.setProperty('--surface-2', colors.surface2)
  root.style.setProperty('--fg', colors.fg)
  root.style.setProperty('--primary', colors.primary)
  root.style.setProperty('--primary-rgb', (() => { const { r, g, b } = hexToRgb(colors.primary); return `${r},${g},${b}` })())
  root.style.setProperty('--accent', colors.accent)
  root.style.setProperty('--accent-rgb', (() => { const { r, g, b } = hexToRgb(colors.accent); return `${r},${g},${b}` })())
  root.style.setProperty('--user-bubble', colors.userBubble)
  root.style.setProperty('--assistant-bubble', colors.assistantBubble)

  // Generate shades for primary
  root.style.setProperty('--primary-100', adjustBrightness(colors.primary, 60))
  root.style.setProperty('--primary-200', adjustBrightness(colors.primary, 40))
  root.style.setProperty('--primary-300', adjustBrightness(colors.primary, 25))
  root.style.setProperty('--primary-400', adjustBrightness(colors.primary, 10))
  root.style.setProperty('--primary-500', colors.primary)
  root.style.setProperty('--primary-600', adjustBrightness(colors.primary, -10))
  root.style.setProperty('--primary-700', adjustBrightness(colors.primary, -20))
}

function startRainbow() {
  if (rainbowFrame) return
  const tick = () => {
    const rb = theme.value.rainbow
    if (!rb.enabled) { rainbowFrame = null; return }

    rainbowHue = (rainbowHue + rb.speed * 0.3) % 360
    currentRainbowHue.value = rainbowHue
    const primary = hslToHex(rainbowHue, rb.saturation, rb.lightness)
    const accent = hslToHex((rainbowHue + 120) % 360, rb.saturation, rb.lightness)
    const userBubble = hslToHex(rainbowHue, rb.saturation, Math.max(rb.lightness - 15, 10))

    const root = document.documentElement
    root.style.setProperty('--primary', primary)
    root.style.setProperty('--primary-rgb', (() => { const { r, g, b } = hexToRgb(primary); return `${r},${g},${b}` })())
    root.style.setProperty('--accent', accent)
    root.style.setProperty('--accent-rgb', (() => { const { r, g, b } = hexToRgb(accent); return `${r},${g},${b}` })())
    root.style.setProperty('--user-bubble', userBubble)
    root.style.setProperty('--primary-100', adjustBrightness(primary, 60))
    root.style.setProperty('--primary-200', adjustBrightness(primary, 40))
    root.style.setProperty('--primary-300', adjustBrightness(primary, 25))
    root.style.setProperty('--primary-400', adjustBrightness(primary, 10))
    root.style.setProperty('--primary-500', primary)
    root.style.setProperty('--primary-600', adjustBrightness(primary, -10))
    root.style.setProperty('--primary-700', adjustBrightness(primary, -20))

    rainbowFrame = requestAnimationFrame(tick)
  }
  rainbowFrame = requestAnimationFrame(tick)
}

function stopRainbow() {
  if (rainbowFrame) {
    cancelAnimationFrame(rainbowFrame)
    rainbowFrame = null
  }
}

export function useTheme() {
  onMounted(() => {
    applyThemeToDOM(theme.value.colors)
    if (theme.value.rainbow.enabled) startRainbow()
  })

  onUnmounted(() => {
    // Don't stop rainbow on unmount since theme is app-global
  })

  watch(() => theme.value.colors, (colors) => {
    if (!theme.value.rainbow.enabled) {
      applyThemeToDOM(colors)
    }
    saveTheme()
  }, { deep: true })

  watch(() => theme.value.rainbow, (rb) => {
    saveTheme()
    if (rb.enabled) {
      startRainbow()
    } else {
      stopRainbow()
      applyThemeToDOM(theme.value.colors)
    }
  }, { deep: true })

  function resetTheme() {
    theme.value.colors = { ...DEFAULT_THEME.colors }
    theme.value.rainbow = { ...DEFAULT_THEME.rainbow }
    stopRainbow()
    applyThemeToDOM(theme.value.colors)
    saveTheme()
  }

  function setColor(key: keyof ThemeColors, value: string) {
    theme.value.colors[key] = value
  }

  function setRainbow(updates: Partial<RainbowSettings>) {
    Object.assign(theme.value.rainbow, updates)
  }

  return {
    theme,
    currentRainbowHue,
    hslToHex,
    resetTheme,
    setColor,
    setRainbow,
    DEFAULT_THEME,
  }
}
