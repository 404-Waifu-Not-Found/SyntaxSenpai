import { ref, computed } from 'vue'

export type Locale = 'en' | 'zh'

const STORAGE_KEY = 'syntax-senpai-locale'

const messages: Record<Locale, Record<string, string>> = {
  en: {
    // App
    'app.name': 'SyntaxSenpai',
    'app.booting': 'Booting Your Waifu Workspace',

    // Setup
    'setup.title': 'SyntaxSenpai',
    'setup.subtitle': 'Your AI companion that codes with you',
    'setup.getStarted': 'Get Started',
    'setup.demoMode': 'Try Demo Mode (no API)',

    // Sidebar
    'sidebar.newChat': 'New Chat',
    'sidebar.waifu': 'Waifu',
    'sidebar.autoSaved': 'auto-saved',
    'sidebar.allChats': 'All Chats',
    'sidebar.favorites': 'Favorites',
    'sidebar.searchPlaceholder': 'Search conversations...',
    'sidebar.noConversations': 'No conversations yet',
    'sidebar.noFavorites': 'No favorite chats yet',
    'sidebar.agent': 'Agent',
    'sidebar.settings': 'Settings',
    'sidebar.collapse': 'Collapse',
    'sidebar.groupChat': 'Group Chat',
    'sidebar.groupToggle': 'Group',
    'sidebar.selectWaifus': 'Select waifus for group chat:',

    // Header
    'header.affection': 'Affection',

    // Affection tiers
    'affection.icy': 'Icy',
    'affection.distant': 'Distant',
    'affection.neutral': 'Neutral',
    'affection.friendly': 'Friendly',
    'affection.close': 'Close',
    'affection.attached': 'Attached',
    'affection.devoted': 'Devoted',

    // Chat
    'chat.emptyIcon': '💬',
    'chat.emptyTitle': 'Chat with {name}',
    'chat.emptyTitleGroup': 'Group chat with {names}',
    'chat.emptySubtitle': 'Start a conversation!',
    'chat.inputPlaceholder': 'Say something... (Press / to focus)',
    'chat.send': '➤ Send',
    'chat.sending': '⚙️ Sending',
    'chat.inputHint': 'Press Enter to send, Shift+Enter for newline',

    // Settings
    'settings.title': 'Settings',
    'settings.general': 'General',
    'settings.theme': 'Theme',
    'settings.language': 'Language',
    'settings.waifu': 'Waifu',
    'settings.provider': 'Provider',
    'settings.apiKey': 'API Key',
    'settings.exportData': 'Export Data',
    'settings.exportDescription': 'Save chats, memories, and local app settings to a JSON file. API keys are never included.',
    'settings.exportButton': 'Export JSON',
    'settings.importButton': 'Import JSON',
    'settings.importDescription': 'Restore chats, memories, and local app settings from a previous export. API keys still stay excluded.',
    'settings.metricsTitle': 'Waifu Performance',
    'settings.metricsDescription': 'Live response timing, recent history, and spike alerts without leaving Settings.',
    'settings.metricsLatest': 'Latest',
    'settings.metricsAverage': 'Average',
    'settings.metricsP95': 'P95',
    'settings.metricsAlerts': 'Alerts',
    'settings.metricsHistory': 'History',
    'settings.metricsEmpty': 'No response-time data yet. Send a few messages and I will start tracking it.',
    'settings.metricsThreshold': 'Spike threshold',
    'settings.maxIterations': 'Max iterations',
    'settings.maxIterationsDescription': 'Maximum AI/tool-call loops allowed before the reply is forced to stop.',
    'settings.responseThreshold': 'Response threshold',
    'settings.responseThresholdDescription': 'Latency in milliseconds before a spike alert fires.',
    'settings.cancel': 'Cancel',
    'settings.save': 'Save',
    'settings.skipDemo': 'Skip (Demo)',

    // Theme
    'theme.rainbowMode': 'Rainbow Mode',
    'theme.rainbowDesc': 'Cycles through colors automatically',
    'theme.presets': 'Color Presets',
    'theme.presetsDesc': 'Apply a ready-made palette, then fine-tune anything below.',
    'theme.speed': 'Speed',
    'theme.saturation': 'Saturation',
    'theme.lightness': 'Lightness',
    'theme.colors': 'Colors',
    'theme.primary': 'Primary',
    'theme.accent': 'Accent',
    'theme.background': 'Background',
    'theme.surface': 'Surface',
    'theme.text': 'Text',
    'theme.userBubble': 'User Bubble',
    'theme.aiBubble': 'AI Bubble',
    'theme.surfaceAlt': 'Surface Alt',
    'theme.primaryRgb': 'Primary RGB',
    'theme.preview': 'Preview',
    'theme.previewUser': 'Hey, how\'s it going?',
    'theme.previewAi': 'I\'m doing great! What can I help with?',
    'theme.button': 'Button',
    'theme.resetDefaults': 'Reset Defaults',
    'theme.done': 'Done',
    'preset.default': 'Default',
    'preset.ocean': 'Ocean',
    'preset.sunset': 'Sunset',
    'preset.emerald': 'Emerald',
    'preset.rose': 'Rose',
    'preset.cherryBlossom': 'Cherry Blossom',
    'preset.lavender': 'Lavender',
    'preset.amber': 'Amber',
    'preset.midnight': 'Midnight',
    'preset.lightMode': 'Light Mode',

    // Model Picker
    'model.title': 'Choose Model',
    'model.description': 'Pick which model {provider} should use with this saved API key.',
    'model.label': 'Model',

    // Agent
    'agent.title': 'Agent Access',
    'agent.description': 'Choose how the agent can act on your machine.',
    'agent.askTitle': 'Ask before running',
    'agent.askDesc': 'Confirm every command before it executes',
    'agent.autoTitle': 'Edit automatically',
    'agent.autoDesc': 'Auto-run common commands (read, write, build) — confirm others',
    'agent.fullTitle': 'Full access',
    'agent.fullDesc': 'Run any command without confirmation — use with caution',

    // Memory
    'memory.title': 'AI Memory',
    'memory.entries': '{count} entries',
    'memory.description': 'Persistent memory the AI uses across all chats. The AI auto-saves things you share (name, preferences), or you can add entries manually.',
    'memory.labelPlaceholder': 'Label (e.g. favorite_language)',
    'memory.valuePlaceholder': 'Value (e.g. TypeScript)',
    'memory.add': 'Add',
    'memory.empty': 'No memories yet. Chat naturally and the AI will remember key details, or add them manually above.',
    'memory.close': 'Close',
    'memory.clearAll': 'Clear All',

    // Toast
    'toast.memorySaved': 'Memory saved',
    'toast.memoriesCleared': 'All memories cleared',
    'toast.exportSaved': 'Export saved',
    'toast.exportFailed': 'Export failed',
    'toast.importSaved': 'Import completed',
    'toast.importFailed': 'Import failed',
  },
  zh: {
    // App
    'app.name': 'SyntaxSenpai',
    'app.booting': '正在启动你的工作空间',

    // Setup
    'setup.title': 'SyntaxSenpai',
    'setup.subtitle': '与你一起编程的 AI 伙伴',
    'setup.getStarted': '开始使用',
    'setup.demoMode': '试用演示模式（无需 API）',

    // Sidebar
    'sidebar.newChat': '新对话',
    'sidebar.waifu': '角色',
    'sidebar.autoSaved': '自动保存',
    'sidebar.allChats': '所有对话',
    'sidebar.favorites': '收藏',
    'sidebar.searchPlaceholder': '搜索对话...',
    'sidebar.noConversations': '暂无对话',
    'sidebar.noFavorites': '暂无收藏对话',
    'sidebar.agent': '代理',
    'sidebar.settings': '设置',
    'sidebar.collapse': '收起',
    'sidebar.groupChat': '群聊',
    'sidebar.groupToggle': '群聊',
    'sidebar.selectWaifus': '选择群聊角色：',

    // Header
    'header.affection': '好感度',

    // Affection tiers
    'affection.icy': '冰冷',
    'affection.distant': '疏离',
    'affection.neutral': '普通',
    'affection.friendly': '友好',
    'affection.close': '亲近',
    'affection.attached': '依恋',
    'affection.devoted': '挚爱',

    // Chat
    'chat.emptyIcon': '💬',
    'chat.emptyTitle': '和 {name} 聊天',
    'chat.emptyTitleGroup': '和 {names} 群聊',
    'chat.emptySubtitle': '开始对话吧！',
    'chat.inputPlaceholder': '说点什么... （按 / 聚焦）',
    'chat.send': '➤ 发送',
    'chat.sending': '⚙️ 发送中',
    'chat.inputHint': '按 Enter 发送，Shift+Enter 换行',

    // Settings
    'settings.title': '设置',
    'settings.general': '通用',
    'settings.theme': '主题',
    'settings.language': '语言',
    'settings.waifu': '角色',
    'settings.provider': '服务商',
    'settings.apiKey': 'API 密钥',
    'settings.exportData': '导出数据',
    'settings.exportDescription': '将聊天、记忆和本地应用设置保存为 JSON 文件。不会包含 API 密钥。',
    'settings.exportButton': '导出 JSON',
    'settings.importButton': '导入 JSON',
    'settings.importDescription': '从之前的导出文件恢复聊天、记忆和本地应用设置。API 密钥仍然不会被导入。',
    'settings.metricsTitle': 'Waifu 性能',
    'settings.metricsDescription': '在设置里实时查看响应时间、历史趋势和延迟尖峰提醒。',
    'settings.metricsLatest': '最新',
    'settings.metricsAverage': '平均',
    'settings.metricsP95': 'P95',
    'settings.metricsAlerts': '告警',
    'settings.metricsHistory': '历史',
    'settings.metricsEmpty': '还没有响应时间数据。先发送几条消息，我就会开始记录。',
    'settings.metricsThreshold': '尖峰阈值',
    'settings.maxIterations': '最大迭代次数',
    'settings.maxIterationsDescription': '单次回复允许的 AI / 工具调用循环上限，超出后会强制停止。',
    'settings.responseThreshold': '响应时间阈值',
    'settings.responseThresholdDescription': '延迟超过该毫秒值时触发尖峰告警。',
    'settings.cancel': '取消',
    'settings.save': '保存',
    'settings.skipDemo': '跳过（演示）',

    // Theme
    'theme.rainbowMode': '彩虹模式',
    'theme.rainbowDesc': '自动循环颜色',
    'theme.presets': '颜色预设',
    'theme.presetsDesc': '先套用现成配色，再继续微调下面的自定义选项。',
    'theme.speed': '速度',
    'theme.saturation': '饱和度',
    'theme.lightness': '亮度',
    'theme.colors': '颜色',
    'theme.primary': '主色',
    'theme.accent': '强调色',
    'theme.background': '背景色',
    'theme.surface': '表面色',
    'theme.text': '文字色',
    'theme.userBubble': '用户气泡',
    'theme.aiBubble': 'AI 气泡',
    'theme.surfaceAlt': '备选表面色',
    'theme.primaryRgb': '主色 RGB',
    'theme.preview': '预览',
    'theme.previewUser': '你好呀，最近怎么样？',
    'theme.previewAi': '我很好！有什么可以帮你的吗？',
    'theme.button': '按钮',
    'theme.resetDefaults': '恢复默认',
    'theme.done': '完成',
    'preset.default': '默认',
    'preset.ocean': '海洋',
    'preset.sunset': '落日',
    'preset.emerald': '翡翠',
    'preset.rose': '玫瑰',
    'preset.cherryBlossom': '樱花',
    'preset.lavender': '薰衣草',
    'preset.amber': '琥珀',
    'preset.midnight': '午夜',
    'preset.lightMode': '浅色模式',

    // Model Picker
    'model.title': '选择模型',
    'model.description': '选择 {provider} 使用的模型。',
    'model.label': '模型',

    // Agent
    'agent.title': '代理权限',
    'agent.description': '选择代理在你的设备上如何操作。',
    'agent.askTitle': '执行前确认',
    'agent.askDesc': '每条命令执行前都需要确认',
    'agent.autoTitle': '自动编辑',
    'agent.autoDesc': '自动执行常用命令（读取、写入、构建）— 其他操作需确认',
    'agent.fullTitle': '完全访问',
    'agent.fullDesc': '无需确认直接执行任何命令 — 请谨慎使用',

    // Memory
    'memory.title': 'AI 记忆',
    'memory.entries': '{count} 条记录',
    'memory.description': 'AI 跨对话使用的持久记忆。AI 会自动保存你分享的信息（姓名、偏好等），你也可以手动添加。',
    'memory.labelPlaceholder': '标签（如 favorite_language）',
    'memory.valuePlaceholder': '值（如 TypeScript）',
    'memory.add': '添加',
    'memory.empty': '暂无记忆。自然聊天，AI 会记住关键细节，也可以在上方手动添加。',
    'memory.close': '关闭',
    'memory.clearAll': '清除全部',

    // Toast
    'toast.memorySaved': '记忆已保存',
    'toast.memoriesCleared': '所有记忆已清除',
    'toast.exportSaved': '导出已保存',
    'toast.exportFailed': '导出失败',
    'toast.importSaved': '导入完成',
    'toast.importFailed': '导入失败',
  },
}

const locale = ref<Locale>(
  (localStorage.getItem(STORAGE_KEY) as Locale) || 'en',
)

function setLocale(l: Locale) {
  locale.value = l
  localStorage.setItem(STORAGE_KEY, l)
}

function t(key: string, params?: Record<string, string | number>): string {
  let text = messages[locale.value]?.[key] || messages.en[key] || key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(`{${k}}`, String(v))
    }
  }
  return text
}

const localeOptions = [
  { value: 'en' as Locale, label: 'English' },
  { value: 'zh' as Locale, label: '中文' },
]

export function useI18n() {
  return {
    locale,
    setLocale,
    t,
    localeOptions,
  }
}
