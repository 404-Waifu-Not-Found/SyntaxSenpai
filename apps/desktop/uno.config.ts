import { defineConfig, presetUno, presetIcons, presetWebFonts } from 'unocss'

export default defineConfig({
  presets: [
    presetUno(),
    presetIcons({
      scale: 1.2,
      cdn: 'https://esm.sh/',
    }),
    presetWebFonts({
      fonts: {
        sans: 'DM Sans:400,500,600,700',
        display: 'Comfortaa:400,700',
        cute: 'Nunito:400,700',
        mono: 'JetBrains Mono:400,500',
      },
    }),
  ],
  theme: {
    colors: {
      primary: {
        50: '#eef2ff',
        100: '#e0e7ff',
        200: '#c7d2fe',
        300: '#a5b4fc',
        400: '#818cf8',
        500: '#6366f1',
        600: '#4f46e5',
        700: '#4338ca',
        800: '#3730a3',
        900: '#312e81',
        950: '#1e1b4b',
      },
      accent: {
        300: '#f472b6',
        400: '#f06292',
        500: '#ec4899',
      },
    },
  },
  shortcuts: {
    'glass': 'backdrop-blur-md bg-white/4 border border-white/4 rounded-xl',
    'glass-surface': 'backdrop-blur-xl bg-neutral-900/80 border border-neutral-800/60',
    'btn-primary': 'rounded-xl backdrop-blur-md bg-primary-500/15 hover:bg-primary-500/20 active:bg-primary-500/30 border-2 border-solid border-primary-500/5 text-primary-100 focus:ring-2 focus:ring-primary-300/60 px-4 py-2 text-sm font-medium transition-all duration-200 ease-in-out outline-none',
    'btn-secondary': 'rounded-xl backdrop-blur-md bg-neutral-700/60 hover:bg-neutral-700/80 active:bg-neutral-700/60 border-2 border-solid border-neutral-700/30 text-neutral-100 focus:ring-2 focus:ring-neutral-600/30 px-4 py-2 text-sm font-medium transition-all duration-200 ease-in-out outline-none',
    'btn-danger': 'rounded-xl backdrop-blur-md bg-red-700/30 hover:bg-red-700/40 active:bg-red-700/30 border-2 border-solid border-red-900/30 text-red-100 focus:ring-2 focus:ring-red-600/30 px-4 py-2 text-sm font-medium transition-all duration-200 ease-in-out outline-none',
    'btn-ghost': 'bg-transparent hover:bg-neutral-800/50 text-neutral-400 focus:ring-2 focus:ring-neutral-600/30 px-3 py-2 text-sm rounded-lg transition-all duration-200 outline-none',
    'input-field': 'w-full rounded-lg px-3 py-2 text-sm outline-none bg-neutral-950 focus:bg-neutral-900 focus:border-primary-400/50 border-2 border-solid border-neutral-900 text-neutral-100 shadow-sm transition-all duration-200 ease-in-out',
  },
  rules: [
    [/^animate-slide-up$/, () => ({ animation: 'slideUpAndFade 400ms cubic-bezier(0.16, 1, 0.3, 1) forwards' })],
    [/^animate-slide-down$/, () => ({ animation: 'slideDownAndFade 400ms cubic-bezier(0.16, 1, 0.3, 1) forwards' })],
    [/^animate-fade-in$/, () => ({ animation: 'fadeIn 200ms ease-in-out forwards' })],
    [/^animate-fade-out$/, () => ({ animation: 'fadeOut 200ms ease-in-out forwards' })],
    [/^animate-content-show$/, () => ({ animation: 'contentShow 150ms cubic-bezier(0.16, 1, 0.3, 1) forwards' })],
    [/^animate-pop-in$/, () => ({ animation: 'popIn 420ms cubic-bezier(.2,.8,.2,1)' })],
  ],
  preflights: [
    {
      getCSS: () => `
        @keyframes slideUpAndFade { from { opacity: 0; transform: translateY(2px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes slideDownAndFade { from { opacity: 0; transform: translateY(-2px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }
        @keyframes contentShow { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
        @keyframes popIn { 0% { transform: scale(0.98); } 60% { transform: scale(1.02); } 100% { transform: scale(1); } }
        @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        @keyframes typing { 0% { transform: translateY(0); opacity: 0.6; } 50% { transform: translateY(-6px); opacity: 1; } 100% { transform: translateY(0); opacity: 0.6; } }
        @keyframes circleExpand { from { transform: scale(0); } to { transform: scale(1); } }
        @keyframes lampFlicker {
          0%,6%,22%,33%,52%,68%,86%,100% { opacity: 1; }
          3% { opacity: 0.74; } 9% { opacity: 0.92; } 13% { opacity: 0.38; }
          18% { opacity: 0.58; } 27% { opacity: 0.44; } 29% { opacity: 0.84; }
          41% { opacity: 0.42; } 45% { opacity: 0.88; } 57% { opacity: 0.62; }
          61% { opacity: 0.8; } 73% { opacity: 0.36; } 74.4% { opacity: 0.08; }
          75.2% { opacity: 0.82; } 78% { opacity: 0.94; } 91% { opacity: 0.52; }
        }

        :root {
          --chromatic-hue: 220.44;
          --bg: #0f0f0f;
          --surface: #111216;
          --surface-2: #0d0f13;
          --fg: #ffffff;
          --primary: #6366f1;
          --primary-rgb: 99,102,241;
          --primary-100: #e0e7ff;
          --primary-200: #c7d2fe;
          --primary-300: #a5b4fc;
          --primary-400: #818cf8;
          --primary-500: #6366f1;
          --primary-600: #4f46e5;
          --primary-700: #4338ca;
          --accent: #ec4899;
          --accent-rgb: 236,72,153;
          --user-bubble: #4f46e5;
          --assistant-bubble: #1a1a2e;
        }

        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body, #app { width: 100%; height: 100%; background-color: var(--bg); color: var(--fg); }
        body { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }

        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: #555; }

        /* Theme-aware overrides — these use CSS vars set by use-theme.ts */
        .themed-bg { background-color: var(--bg) !important; }
        .themed-surface { background-color: var(--surface) !important; }
        .themed-fg { color: var(--fg) !important; }
        .themed-primary-text { color: var(--primary-400) !important; }
        .themed-user-bubble { background: linear-gradient(to right, var(--primary-600), var(--primary-500)) !important; }
        .themed-active-item { background: linear-gradient(to right, var(--primary-600), var(--primary-500)) !important; }
        .themed-new-chat-btn { background: linear-gradient(to right, var(--primary-600), var(--primary-500)) !important; }
        .themed-new-chat-btn:hover { box-shadow: 0 10px 15px -3px rgba(var(--primary-rgb), 0.25) !important; }
        .themed-user-avatar { background-color: var(--primary-700) !important; }
        .themed-assistant-avatar { background: linear-gradient(to bottom right, var(--primary-500), var(--accent)) !important; }
        .themed-ambient-1 { background: radial-gradient(circle at 10% 10%, rgba(var(--primary-rgb),0.12), transparent 8%) !important; }
        .themed-ambient-2 { background: radial-gradient(circle at 90% 90%, rgba(var(--accent-rgb),0.08), transparent 18%) !important; }
        .themed-btn-primary {
          background-color: rgba(var(--primary-rgb), 0.15) !important;
          border-color: rgba(var(--primary-rgb), 0.05) !important;
          color: var(--primary-100) !important;
        }
        .themed-btn-primary:hover { background-color: rgba(var(--primary-rgb), 0.20) !important; }
        .themed-btn-primary:focus { ring-color: rgba(var(--primary-rgb), 0.6) !important; }
        .themed-input:focus { border-color: rgba(var(--primary-rgb), 0.5) !important; }
      `,
    },
  ],
})
