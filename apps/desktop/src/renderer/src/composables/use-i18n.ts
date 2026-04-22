import { ref, computed } from 'vue'

export type Locale = 'en' | 'zh' | 'fr' | 'ru' | 'ja'

const STORAGE_KEY = 'syntax-senpai-locale'

/**
 * Human-readable language name for each locale — injected into the system
 * prompt so the AI knows what language the user prefers to read and write.
 */
export const LOCALE_LANGUAGE_NAME: Record<Locale, string> = {
  en: 'English',
  zh: 'Chinese (Simplified) / 简体中文',
  fr: 'French / Français',
  ru: 'Russian / Русский',
  ja: 'Japanese / 日本語',
}

/**
 * Locale-aware cost display. We store USD internally (that's what provider
 * pricing pages quote); convert on display with a rough static rate table.
 * Conversion doesn't need to be precise — users see this for rough "is this
 * chat getting expensive" awareness, not billing.
 *
 * `minFractionDigits` per currency matches local convention (JPY is usually
 * shown without decimals). Values under 1 unit still get extra precision so
 * micro-turns don't round to zero.
 */
interface CurrencySpec {
  code: string
  symbol: string
  usdRate: number   // 1 USD = <rate> of target
  minFractionDigits: number
}
const LOCALE_CURRENCY: Record<Locale, CurrencySpec> = {
  en: { code: 'USD', symbol: '$',   usdRate: 1,    minFractionDigits: 3 },
  zh: { code: 'CNY', symbol: '¥',   usdRate: 7.2,  minFractionDigits: 2 },
  fr: { code: 'EUR', symbol: '€',   usdRate: 0.92, minFractionDigits: 3 },
  ru: { code: 'RUB', symbol: '₽',   usdRate: 90,   minFractionDigits: 2 },
  ja: { code: 'JPY', symbol: '¥',   usdRate: 150,  minFractionDigits: 0 },
}

export function formatLocalizedCost(usd: number, loc: Locale): string {
  const spec = LOCALE_CURRENCY[loc] || LOCALE_CURRENCY.en
  const value = usd * spec.usdRate
  let digits: number
  if (spec.minFractionDigits === 0) {
    // Integer currency (JPY). Still show sub-unit precision for tiny amounts
    // so a $0.003 turn doesn't round to ¥0.
    digits = value < 1 ? 2 : value < 10 ? 1 : 0
  } else {
    digits = value < 0.01 ? 4 : spec.minFractionDigits
  }
  return `${spec.symbol}${value.toFixed(digits)}`
}

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
    'settings.groupChat': 'Group Chat',
    'settings.groupChatDescription': 'Send one message to multiple waifus. They can react to each other and hand follow-up tasks across the room.',
    'settings.groupChatParticipants': 'Participants',
    'settings.groupChatHint': 'Choose 2 to 4 waifus for desktop group chat.',
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
    'preset.rainbow': 'Rainbow',
    'preset.cherryBlossomDark': 'Sakura Dark',
    'preset.dracula': 'Dracula',
    'preset.nord': 'Nord',
    'preset.tokyoNight': 'Tokyo Night',
    'preset.catppuccin': 'Catppuccin',
    'preset.synthwave': 'Synthwave',
    'preset.matrix': 'Matrix',

    // Interface (density / radius / blur / petals)
    'interface.title': 'Interface',
    'interface.density': 'UI Density',
    'interface.densityDesc': 'Compact tightens padding across the app.',
    'interface.densityCozy': 'Cozy',
    'interface.densityCompact': 'Compact',
    'interface.radius': 'Corner Radius',
    'interface.radiusDesc': 'Global roundness of cards, bubbles and buttons.',
    'interface.radiusSharp': 'Sharp',
    'interface.radiusDefault': 'Default',
    'interface.radiusRounded': 'Rounded',
    'interface.blur': 'Glass Blur',
    'interface.blurDesc': 'Backdrop blur strength on frosted surfaces.',
    'interface.petals': 'Sakura Petals',
    'interface.petalsDesc': 'Drifting petals in the background. Pairs well with Sakura themes.',


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
    'toast.conversationExported': 'Conversation exported',
    'toast.attachmentFailed': 'Attachment failed',

    // AI tab
    'settings.refreshModels': '↻ Refresh model list',
    'settings.modelsLoaded': '{count} model(s) loaded',
    'settings.exportMarkdownTitle': 'Export current conversation',
    'settings.exportMarkdownDesc': 'Saves the active chat as a Markdown file. Good for sharing a coding session or pasting into a PR.',
    'settings.exportMarkdownButton': '⬇ Export as .md',

    // Mobile pairing
    'mobile.title': 'Desktop Connection',
    'mobile.description': 'Pair your phone to use the chatbot remotely via your local network.',
    'mobile.noDevice': 'No device connected',
    'mobile.connected': 'Connected: {device}',
    'mobile.showQr': 'Show QR Code',
    'mobile.disconnect': 'Disconnect',
    'mobile.done': 'Done',
    'mobile.connectTitle': 'Connect Mobile',
    'mobile.generating': 'Generating QR code…',
    'mobile.connectedHeading': 'Connected!',
    'mobile.scanHint': 'Open SyntaxSenpai on your phone and scan this code to connect.',
    'mobile.waitingDevice': 'Waiting for device…',
    'mobile.networkInterface': 'Network interface',
    'mobile.qrError': 'Could not generate QR code. Make sure the desktop app is running.',

    // Attachments + input chrome
    'input.attachImage': 'Attach image',
    'input.dropHint': 'Drop image(s) to attach',
    'input.removeAttachment': 'Remove {name}',

    // Message actions
    'message.regenerate': '↻ Regenerate',
    'message.delete': '🗑 Delete',
    'message.regenerateTitle': 'Regenerate this reply',
    'message.deleteTitle': 'Delete this message',

    // Usage strip
    'usage.promptTokens': '↑ prompt tokens',
    'usage.completionTokens': '↓ completion tokens',
    'usage.estCost': 'Estimated cost ({currency})',

    // Shortcuts overlay
    'shortcuts.title': 'Keyboard shortcuts',
    'shortcuts.newChat': 'New chat',
    'shortcuts.openSettings': 'Open settings',
    'shortcuts.closeModal': 'Close any modal',
    'shortcuts.showOverlay': 'Show this overlay',
    'shortcuts.sendMessage': 'Send message',
    'shortcuts.newline': 'Newline in message',
    'shortcuts.gotIt': 'Got it',
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
    'settings.groupChat': '群聊',
    'settings.groupChatDescription': '一条消息同时发给多个角色。她们会互相回应，并把后续任务分配给更合适的角色。',
    'settings.groupChatParticipants': '参与角色',
    'settings.groupChatHint': '为桌面群聊选择 2 到 4 个角色。',
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
    'preset.rainbow': '彩虹',
    'preset.cherryBlossomDark': '暗夜樱花',
    'preset.dracula': '德古拉',
    'preset.nord': '北欧',
    'preset.tokyoNight': '东京之夜',
    'preset.catppuccin': '猫咪浓缩',
    'preset.synthwave': '合成波',
    'preset.matrix': '黑客帝国',

    'interface.title': '界面',
    'interface.density': '界面密度',
    'interface.densityDesc': '紧凑模式会收紧整体内边距。',
    'interface.densityCozy': '舒适',
    'interface.densityCompact': '紧凑',
    'interface.radius': '圆角',
    'interface.radiusDesc': '卡片、气泡和按钮的全局圆润度。',
    'interface.radiusSharp': '锐利',
    'interface.radiusDefault': '默认',
    'interface.radiusRounded': '圆润',
    'interface.blur': '毛玻璃模糊',
    'interface.blurDesc': '毛玻璃表面的背景模糊强度。',
    'interface.petals': '樱花花瓣',
    'interface.petalsDesc': '背景中飘落的樱花花瓣,与樱花主题相得益彰。',


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
    'toast.conversationExported': '对话已导出',
    'toast.attachmentFailed': '附件添加失败',

    // AI tab
    'settings.refreshModels': '↻ 刷新模型列表',
    'settings.modelsLoaded': '已加载 {count} 个模型',
    'settings.exportMarkdownTitle': '导出当前对话',
    'settings.exportMarkdownDesc': '把当前对话保存为 Markdown 文件。方便分享编程过程或粘贴到 PR 里。',
    'settings.exportMarkdownButton': '⬇ 导出为 .md',

    // Mobile pairing
    'mobile.title': '桌面端连接',
    'mobile.description': '配对你的手机,通过本地网络远程使用聊天机器人。',
    'mobile.noDevice': '尚未连接设备',
    'mobile.connected': '已连接:{device}',
    'mobile.showQr': '显示二维码',
    'mobile.disconnect': '断开连接',
    'mobile.done': '完成',
    'mobile.connectTitle': '连接手机',
    'mobile.generating': '正在生成二维码…',
    'mobile.connectedHeading': '已连接!',
    'mobile.scanHint': '在手机上打开 SyntaxSenpai,扫描此二维码即可连接。',
    'mobile.waitingDevice': '等待设备连接…',
    'mobile.networkInterface': '网络接口',
    'mobile.qrError': '无法生成二维码,请确认桌面应用正在运行。',

    // Attachments + input chrome
    'input.attachImage': '添加图片',
    'input.dropHint': '把图片拖到这里即可附加',
    'input.removeAttachment': '移除 {name}',

    // Message actions
    'message.regenerate': '↻ 重新生成',
    'message.delete': '🗑 删除',
    'message.regenerateTitle': '重新生成这条回复',
    'message.deleteTitle': '删除这条消息',

    // Usage strip
    'usage.promptTokens': '↑ 提示 token',
    'usage.completionTokens': '↓ 回复 token',
    'usage.estCost': '预估费用({currency})',

    // Shortcuts overlay
    'shortcuts.title': '键盘快捷键',
    'shortcuts.newChat': '新建对话',
    'shortcuts.openSettings': '打开设置',
    'shortcuts.closeModal': '关闭当前弹窗',
    'shortcuts.showOverlay': '显示此快捷键列表',
    'shortcuts.sendMessage': '发送消息',
    'shortcuts.newline': '消息内换行',
    'shortcuts.gotIt': '知道了',
  },

  fr: {
    // App
    'app.name': 'SyntaxSenpai',
    'app.booting': 'Démarrage de votre espace Waifu',

    // Setup
    'setup.title': 'SyntaxSenpai',
    'setup.subtitle': 'Votre compagne IA qui code avec vous',
    'setup.getStarted': 'Commencer',
    'setup.demoMode': 'Essayer le mode démo (sans API)',

    // Sidebar
    'sidebar.newChat': 'Nouveau chat',
    'sidebar.waifu': 'Waifu',
    'sidebar.autoSaved': 'enregistrement auto',
    'sidebar.allChats': 'Toutes les conversations',
    'sidebar.favorites': 'Favoris',
    'sidebar.searchPlaceholder': 'Rechercher des conversations…',
    'sidebar.noConversations': 'Aucune conversation',
    'sidebar.noFavorites': 'Aucun favori',
    'sidebar.agent': 'Agent',
    'sidebar.settings': 'Paramètres',
    'sidebar.collapse': 'Réduire',
    'sidebar.groupChat': 'Chat de groupe',
    'sidebar.groupToggle': 'Groupe',
    'sidebar.selectWaifus': 'Choisir les waifus pour le chat de groupe :',

    // Header
    'header.affection': 'Affection',

    // Affection tiers
    'affection.icy': 'Glaciale',
    'affection.distant': 'Distante',
    'affection.neutral': 'Neutre',
    'affection.friendly': 'Amicale',
    'affection.close': 'Proche',
    'affection.attached': 'Attachée',
    'affection.devoted': 'Dévouée',

    // Chat
    'chat.emptyIcon': '💬',
    'chat.emptyTitle': 'Discuter avec {name}',
    'chat.emptyTitleGroup': 'Chat de groupe avec {names}',
    'chat.emptySubtitle': 'Lancez la conversation !',
    'chat.inputPlaceholder': 'Écris quelque chose… (Appuyez sur / pour focaliser)',
    'chat.send': '➤ Envoyer',
    'chat.sending': '⚙️ Envoi',
    'chat.inputHint': 'Entrée pour envoyer, Maj+Entrée pour un saut de ligne',

    // Settings
    'settings.title': 'Paramètres',
    'settings.general': 'Général',
    'settings.theme': 'Thème',
    'settings.language': 'Langue',
    'settings.waifu': 'Waifu',
    'settings.groupChat': 'Chat de groupe',
    'settings.groupChatDescription': 'Envoie un message à plusieurs waifus. Elles peuvent se répondre et se passer des tâches au fil de la discussion.',
    'settings.groupChatParticipants': 'Participantes',
    'settings.groupChatHint': 'Choisissez de 2 à 4 waifus pour le chat de groupe.',
    'settings.provider': 'Fournisseur',
    'settings.apiKey': 'Clé API',
    'settings.exportData': 'Exporter les données',
    'settings.exportDescription': 'Enregistre les conversations, les souvenirs et les paramètres locaux dans un fichier JSON. Les clés API ne sont jamais incluses.',
    'settings.exportButton': 'Exporter en JSON',
    'settings.importButton': 'Importer un JSON',
    'settings.importDescription': 'Restaure les conversations, les souvenirs et les paramètres locaux depuis un export précédent. Les clés API restent exclues.',
    'settings.metricsTitle': 'Performances Waifu',
    'settings.metricsDescription': 'Temps de réponse en direct, historique et alertes de latence sans quitter les paramètres.',
    'settings.metricsLatest': 'Dernier',
    'settings.metricsAverage': 'Moyenne',
    'settings.metricsP95': 'P95',
    'settings.metricsAlerts': 'Alertes',
    'settings.metricsHistory': 'Historique',
    'settings.metricsEmpty': 'Aucune donnée de temps de réponse. Envoyez quelques messages et je commencerai à suivre.',
    'settings.metricsThreshold': 'Seuil de pic',
    'settings.maxIterations': 'Itérations max',
    'settings.maxIterationsDescription': 'Nombre maximal de boucles IA/outil autorisées avant l\'arrêt forcé de la réponse.',
    'settings.responseThreshold': 'Seuil de réponse',
    'settings.responseThresholdDescription': 'Latence en millisecondes avant le déclenchement d\'une alerte.',
    'settings.cancel': 'Annuler',
    'settings.save': 'Enregistrer',
    'settings.skipDemo': 'Passer (démo)',

    // Theme
    'theme.rainbowMode': 'Mode Arc-en-ciel',
    'theme.rainbowDesc': 'Cycle automatique des couleurs',
    'theme.presets': 'Préréglages de couleurs',
    'theme.presetsDesc': 'Appliquez une palette prête, puis affinez en-dessous.',
    'theme.speed': 'Vitesse',
    'theme.saturation': 'Saturation',
    'theme.lightness': 'Luminosité',
    'theme.colors': 'Couleurs',
    'theme.primary': 'Primaire',
    'theme.accent': 'Accent',
    'theme.background': 'Arrière-plan',
    'theme.surface': 'Surface',
    'theme.text': 'Texte',
    'theme.userBubble': 'Bulle utilisateur',
    'theme.aiBubble': 'Bulle IA',
    'theme.surfaceAlt': 'Surface alt.',
    'theme.primaryRgb': 'RVB primaire',
    'theme.preview': 'Aperçu',
    'theme.previewUser': 'Salut, comment ça va ?',
    'theme.previewAi': 'Ça va super ! Comment puis-je aider ?',
    'theme.button': 'Bouton',
    'theme.resetDefaults': 'Réinitialiser',
    'theme.done': 'Terminé',
    'preset.default': 'Par défaut',
    'preset.ocean': 'Océan',
    'preset.sunset': 'Coucher de soleil',
    'preset.emerald': 'Émeraude',
    'preset.rose': 'Rose',
    'preset.cherryBlossom': 'Fleur de cerisier',
    'preset.lavender': 'Lavande',
    'preset.amber': 'Ambre',
    'preset.midnight': 'Minuit',
    'preset.lightMode': 'Mode clair',
    'preset.rainbow': 'Arc-en-ciel',
    'preset.cherryBlossomDark': 'Sakura Sombre',
    'preset.dracula': 'Dracula',
    'preset.nord': 'Nord',
    'preset.tokyoNight': 'Tokyo Night',
    'preset.catppuccin': 'Catppuccin',
    'preset.synthwave': 'Synthwave',
    'preset.matrix': 'Matrix',

    // Interface
    'interface.title': 'Interface',
    'interface.density': 'Densité',
    'interface.densityDesc': 'Le mode compact resserre les marges dans toute l\'application.',
    'interface.densityCozy': 'Confortable',
    'interface.densityCompact': 'Compacte',
    'interface.radius': 'Arrondi',
    'interface.radiusDesc': 'Arrondi global des cartes, bulles et boutons.',
    'interface.radiusSharp': 'Net',
    'interface.radiusDefault': 'Défaut',
    'interface.radiusRounded': 'Arrondi',
    'interface.blur': 'Flou de verre',
    'interface.blurDesc': 'Intensité du flou d\'arrière-plan sur les surfaces givrées.',
    'interface.petals': 'Pétales de sakura',
    'interface.petalsDesc': 'Pétales qui dérivent à l\'arrière-plan. Va bien avec les thèmes Sakura.',

    // Model Picker
    'model.title': 'Choisir un modèle',
    'model.description': 'Choisis quel modèle {provider} utilisera avec cette clé API.',
    'model.label': 'Modèle',

    // Agent
    'agent.title': 'Accès de l\'agent',
    'agent.description': 'Choisissez comment l\'agent peut agir sur votre machine.',
    'agent.askTitle': 'Demander avant d\'exécuter',
    'agent.askDesc': 'Confirmer chaque commande avant exécution',
    'agent.autoTitle': 'Éditer automatiquement',
    'agent.autoDesc': 'Exécuter automatiquement les commandes courantes (lecture, écriture, build) — confirmer les autres',
    'agent.fullTitle': 'Accès complet',
    'agent.fullDesc': 'Exécuter toute commande sans confirmation — à utiliser avec prudence',

    // Memory
    'memory.title': 'Mémoire de l\'IA',
    'memory.entries': '{count} entrées',
    'memory.description': 'Mémoire persistante utilisée par l\'IA dans toutes les conversations. L\'IA enregistre automatiquement ce que vous partagez (nom, préférences), ou vous pouvez ajouter manuellement.',
    'memory.labelPlaceholder': 'Étiquette (ex. favorite_language)',
    'memory.valuePlaceholder': 'Valeur (ex. TypeScript)',
    'memory.add': 'Ajouter',
    'memory.empty': 'Aucun souvenir. Discutez normalement et l\'IA retiendra les détails clés, ou ajoutez-les manuellement ci-dessus.',
    'memory.close': 'Fermer',
    'memory.clearAll': 'Tout effacer',

    // Toast
    'toast.memorySaved': 'Mémoire enregistrée',
    'toast.memoriesCleared': 'Toutes les mémoires effacées',
    'toast.exportSaved': 'Export enregistré',
    'toast.exportFailed': 'Échec de l\'export',
    'toast.importSaved': 'Import terminé',
    'toast.importFailed': 'Échec de l\'import',
    'toast.conversationExported': 'Conversation exportée',
    'toast.attachmentFailed': 'Échec de la pièce jointe',

    // AI tab
    'settings.refreshModels': '↻ Rafraîchir la liste des modèles',
    'settings.modelsLoaded': '{count} modèle(s) chargé(s)',
    'settings.exportMarkdownTitle': 'Exporter la conversation en cours',
    'settings.exportMarkdownDesc': 'Enregistre la conversation actuelle en Markdown. Pratique pour partager une session de code ou coller dans une PR.',
    'settings.exportMarkdownButton': '⬇ Exporter en .md',

    // Mobile pairing
    'mobile.title': 'Connexion bureau',
    'mobile.description': 'Appairez votre téléphone pour utiliser le chatbot à distance sur votre réseau local.',
    'mobile.noDevice': 'Aucun appareil connecté',
    'mobile.connected': 'Connecté : {device}',
    'mobile.showQr': 'Afficher le QR code',
    'mobile.disconnect': 'Déconnecter',
    'mobile.done': 'Terminé',
    'mobile.connectTitle': 'Connecter un mobile',
    'mobile.generating': 'Génération du QR code…',
    'mobile.connectedHeading': 'Connecté !',
    'mobile.scanHint': 'Ouvrez SyntaxSenpai sur votre téléphone et scannez ce code pour vous connecter.',
    'mobile.waitingDevice': 'En attente d\'un appareil…',
    'mobile.networkInterface': 'Interface réseau',
    'mobile.qrError': 'Impossible de générer le QR code. Vérifiez que l\'application de bureau est en cours d\'exécution.',

    // Attachments + input chrome
    'input.attachImage': 'Joindre une image',
    'input.dropHint': 'Déposez une ou plusieurs images pour les joindre',
    'input.removeAttachment': 'Retirer {name}',

    // Message actions
    'message.regenerate': '↻ Régénérer',
    'message.delete': '🗑 Supprimer',
    'message.regenerateTitle': 'Régénérer cette réponse',
    'message.deleteTitle': 'Supprimer ce message',

    // Usage strip
    'usage.promptTokens': '↑ tokens de prompt',
    'usage.completionTokens': '↓ tokens de réponse',
    'usage.estCost': 'Coût estimé ({currency})',

    // Shortcuts overlay
    'shortcuts.title': 'Raccourcis clavier',
    'shortcuts.newChat': 'Nouveau chat',
    'shortcuts.openSettings': 'Ouvrir les paramètres',
    'shortcuts.closeModal': 'Fermer la fenêtre',
    'shortcuts.showOverlay': 'Afficher ces raccourcis',
    'shortcuts.sendMessage': 'Envoyer le message',
    'shortcuts.newline': 'Saut de ligne',
    'shortcuts.gotIt': 'Compris',
  },

  ru: {
    // App
    'app.name': 'SyntaxSenpai',
    'app.booting': 'Запуск вашего рабочего пространства',

    // Setup
    'setup.title': 'SyntaxSenpai',
    'setup.subtitle': 'Ваш ИИ-компаньон, который программирует с вами',
    'setup.getStarted': 'Начать',
    'setup.demoMode': 'Демо-режим (без API)',

    // Sidebar
    'sidebar.newChat': 'Новый чат',
    'sidebar.waifu': 'Вайфу',
    'sidebar.autoSaved': 'авто-сохранение',
    'sidebar.allChats': 'Все чаты',
    'sidebar.favorites': 'Избранное',
    'sidebar.searchPlaceholder': 'Поиск по чатам…',
    'sidebar.noConversations': 'Пока нет чатов',
    'sidebar.noFavorites': 'Пока нет избранных',
    'sidebar.agent': 'Агент',
    'sidebar.settings': 'Настройки',
    'sidebar.collapse': 'Свернуть',
    'sidebar.groupChat': 'Групповой чат',
    'sidebar.groupToggle': 'Группа',
    'sidebar.selectWaifus': 'Выберите вайфу для группового чата:',

    // Header
    'header.affection': 'Симпатия',

    // Affection tiers
    'affection.icy': 'Ледяная',
    'affection.distant': 'Отстранённая',
    'affection.neutral': 'Нейтральная',
    'affection.friendly': 'Дружелюбная',
    'affection.close': 'Близкая',
    'affection.attached': 'Привязанная',
    'affection.devoted': 'Преданная',

    // Chat
    'chat.emptyIcon': '💬',
    'chat.emptyTitle': 'Чат с {name}',
    'chat.emptyTitleGroup': 'Групповой чат с {names}',
    'chat.emptySubtitle': 'Начните разговор!',
    'chat.inputPlaceholder': 'Напишите что-нибудь… (нажмите / для фокуса)',
    'chat.send': '➤ Отправить',
    'chat.sending': '⚙️ Отправка',
    'chat.inputHint': 'Enter — отправить, Shift+Enter — новая строка',

    // Settings
    'settings.title': 'Настройки',
    'settings.general': 'Общие',
    'settings.theme': 'Тема',
    'settings.language': 'Язык',
    'settings.waifu': 'Вайфу',
    'settings.groupChat': 'Групповой чат',
    'settings.groupChatDescription': 'Отправьте одно сообщение нескольким вайфу. Они могут отвечать друг другу и передавать задачи по комнате.',
    'settings.groupChatParticipants': 'Участники',
    'settings.groupChatHint': 'Выберите от 2 до 4 вайфу для группового чата.',
    'settings.provider': 'Провайдер',
    'settings.apiKey': 'API-ключ',
    'settings.exportData': 'Экспорт данных',
    'settings.exportDescription': 'Сохранить чаты, память и локальные настройки в JSON-файл. API-ключи никогда не включаются.',
    'settings.exportButton': 'Экспорт JSON',
    'settings.importButton': 'Импорт JSON',
    'settings.importDescription': 'Восстановить чаты, память и локальные настройки из предыдущего экспорта. API-ключи по-прежнему исключены.',
    'settings.metricsTitle': 'Производительность Waifu',
    'settings.metricsDescription': 'Время ответа в реальном времени, история и оповещения без выхода из настроек.',
    'settings.metricsLatest': 'Последнее',
    'settings.metricsAverage': 'Среднее',
    'settings.metricsP95': 'P95',
    'settings.metricsAlerts': 'Тревоги',
    'settings.metricsHistory': 'История',
    'settings.metricsEmpty': 'Пока нет данных о времени ответа. Отправьте несколько сообщений, и я начну отслеживать.',
    'settings.metricsThreshold': 'Порог всплеска',
    'settings.maxIterations': 'Максимум итераций',
    'settings.maxIterationsDescription': 'Максимум циклов ИИ/инструментов, разрешённых перед принудительной остановкой ответа.',
    'settings.responseThreshold': 'Порог ответа',
    'settings.responseThresholdDescription': 'Задержка в миллисекундах, после которой срабатывает тревога.',
    'settings.cancel': 'Отмена',
    'settings.save': 'Сохранить',
    'settings.skipDemo': 'Пропустить (демо)',

    // Theme
    'theme.rainbowMode': 'Режим радуги',
    'theme.rainbowDesc': 'Автоматический цикл цветов',
    'theme.presets': 'Цветовые пресеты',
    'theme.presetsDesc': 'Примените готовую палитру, затем подстройте детали ниже.',
    'theme.speed': 'Скорость',
    'theme.saturation': 'Насыщенность',
    'theme.lightness': 'Яркость',
    'theme.colors': 'Цвета',
    'theme.primary': 'Основной',
    'theme.accent': 'Акцент',
    'theme.background': 'Фон',
    'theme.surface': 'Поверхность',
    'theme.text': 'Текст',
    'theme.userBubble': 'Пузырь пользователя',
    'theme.aiBubble': 'Пузырь ИИ',
    'theme.surfaceAlt': 'Альт. поверхность',
    'theme.primaryRgb': 'Основной RGB',
    'theme.preview': 'Превью',
    'theme.previewUser': 'Привет, как дела?',
    'theme.previewAi': 'Отлично! Чем могу помочь?',
    'theme.button': 'Кнопка',
    'theme.resetDefaults': 'Сбросить',
    'theme.done': 'Готово',
    'preset.default': 'По умолчанию',
    'preset.ocean': 'Океан',
    'preset.sunset': 'Закат',
    'preset.emerald': 'Изумруд',
    'preset.rose': 'Роза',
    'preset.cherryBlossom': 'Сакура',
    'preset.lavender': 'Лаванда',
    'preset.amber': 'Янтарь',
    'preset.midnight': 'Полночь',
    'preset.lightMode': 'Светлая тема',
    'preset.rainbow': 'Радуга',
    'preset.cherryBlossomDark': 'Тёмная сакура',
    'preset.dracula': 'Дракула',
    'preset.nord': 'Nord',
    'preset.tokyoNight': 'Токио ночью',
    'preset.catppuccin': 'Catppuccin',
    'preset.synthwave': 'Synthwave',
    'preset.matrix': 'Матрица',

    // Interface
    'interface.title': 'Интерфейс',
    'interface.density': 'Плотность',
    'interface.densityDesc': 'Компактный режим уменьшает отступы во всём приложении.',
    'interface.densityCozy': 'Уютная',
    'interface.densityCompact': 'Компактная',
    'interface.radius': 'Скругление',
    'interface.radiusDesc': 'Глобальное скругление карточек, пузырей и кнопок.',
    'interface.radiusSharp': 'Острые',
    'interface.radiusDefault': 'По умолчанию',
    'interface.radiusRounded': 'Скруглённые',
    'interface.blur': 'Размытие стекла',
    'interface.blurDesc': 'Интенсивность размытия заднего фона для матовых поверхностей.',
    'interface.petals': 'Лепестки сакуры',
    'interface.petalsDesc': 'Лепестки, медленно падающие на фоне. Хорошо подходит к темам сакуры.',

    // Model Picker
    'model.title': 'Выбрать модель',
    'model.description': 'Выберите, какую модель {provider} использовать с этим ключом API.',
    'model.label': 'Модель',

    // Agent
    'agent.title': 'Доступ агента',
    'agent.description': 'Выберите, как агент может действовать на вашем устройстве.',
    'agent.askTitle': 'Спрашивать перед запуском',
    'agent.askDesc': 'Подтверждать каждую команду перед выполнением',
    'agent.autoTitle': 'Редактировать автоматически',
    'agent.autoDesc': 'Автоматически выполнять обычные команды (чтение, запись, сборка) — остальное подтверждать',
    'agent.fullTitle': 'Полный доступ',
    'agent.fullDesc': 'Выполнять любые команды без подтверждения — использовать осторожно',

    // Memory
    'memory.title': 'Память ИИ',
    'memory.entries': '{count} записей',
    'memory.description': 'Постоянная память, которую ИИ использует во всех чатах. ИИ автоматически сохраняет то, чем вы делитесь (имя, предпочтения), или вы можете добавить записи вручную.',
    'memory.labelPlaceholder': 'Метка (напр. favorite_language)',
    'memory.valuePlaceholder': 'Значение (напр. TypeScript)',
    'memory.add': 'Добавить',
    'memory.empty': 'Пока нет воспоминаний. Общайтесь естественно — ИИ запомнит важное, или добавьте записи вручную выше.',
    'memory.close': 'Закрыть',
    'memory.clearAll': 'Очистить всё',

    // Toast
    'toast.memorySaved': 'Память сохранена',
    'toast.memoriesCleared': 'Все воспоминания очищены',
    'toast.exportSaved': 'Экспорт сохранён',
    'toast.exportFailed': 'Ошибка экспорта',
    'toast.importSaved': 'Импорт завершён',
    'toast.importFailed': 'Ошибка импорта',
    'toast.conversationExported': 'Разговор экспортирован',
    'toast.attachmentFailed': 'Не удалось добавить вложение',

    // AI tab
    'settings.refreshModels': '↻ Обновить список моделей',
    'settings.modelsLoaded': 'Загружено моделей: {count}',
    'settings.exportMarkdownTitle': 'Экспортировать текущий чат',
    'settings.exportMarkdownDesc': 'Сохраняет активный чат как Markdown-файл. Удобно, чтобы поделиться кодом или вставить в PR.',
    'settings.exportMarkdownButton': '⬇ Экспорт в .md',

    // Mobile pairing
    'mobile.title': 'Подключение к рабочему столу',
    'mobile.description': 'Сопрягите телефон, чтобы использовать чат-бот удалённо через локальную сеть.',
    'mobile.noDevice': 'Устройство не подключено',
    'mobile.connected': 'Подключено: {device}',
    'mobile.showQr': 'Показать QR-код',
    'mobile.disconnect': 'Отключить',
    'mobile.done': 'Готово',
    'mobile.connectTitle': 'Подключить телефон',
    'mobile.generating': 'Создание QR-кода…',
    'mobile.connectedHeading': 'Подключено!',
    'mobile.scanHint': 'Откройте SyntaxSenpai на телефоне и отсканируйте этот код для подключения.',
    'mobile.waitingDevice': 'Ожидание устройства…',
    'mobile.networkInterface': 'Сетевой интерфейс',
    'mobile.qrError': 'Не удалось создать QR-код. Убедитесь, что приложение для рабочего стола запущено.',

    // Attachments + input chrome
    'input.attachImage': 'Прикрепить изображение',
    'input.dropHint': 'Перетащите изображение(я), чтобы прикрепить',
    'input.removeAttachment': 'Убрать {name}',

    // Message actions
    'message.regenerate': '↻ Перегенерировать',
    'message.delete': '🗑 Удалить',
    'message.regenerateTitle': 'Перегенерировать этот ответ',
    'message.deleteTitle': 'Удалить это сообщение',

    // Usage strip
    'usage.promptTokens': '↑ токены запроса',
    'usage.completionTokens': '↓ токены ответа',
    'usage.estCost': 'Примерная стоимость ({currency})',

    // Shortcuts overlay
    'shortcuts.title': 'Сочетания клавиш',
    'shortcuts.newChat': 'Новый чат',
    'shortcuts.openSettings': 'Открыть настройки',
    'shortcuts.closeModal': 'Закрыть окно',
    'shortcuts.showOverlay': 'Показать эти сочетания',
    'shortcuts.sendMessage': 'Отправить сообщение',
    'shortcuts.newline': 'Перенос строки',
    'shortcuts.gotIt': 'Понятно',
  },

  ja: {
    // App
    'app.name': 'SyntaxSenpai',
    'app.booting': 'ワイフ ワークスペースを起動中',

    // Setup
    'setup.title': 'SyntaxSenpai',
    'setup.subtitle': 'あなたと一緒にコードを書く AI パートナー',
    'setup.getStarted': 'はじめる',
    'setup.demoMode': 'デモモードを試す(API 不要)',

    // Sidebar
    'sidebar.newChat': '新しいチャット',
    'sidebar.waifu': 'ワイフ',
    'sidebar.autoSaved': '自動保存済み',
    'sidebar.allChats': 'すべてのチャット',
    'sidebar.favorites': 'お気に入り',
    'sidebar.searchPlaceholder': 'チャットを検索…',
    'sidebar.noConversations': 'まだチャットはありません',
    'sidebar.noFavorites': 'お気に入りはまだありません',
    'sidebar.agent': 'エージェント',
    'sidebar.settings': '設定',
    'sidebar.collapse': '折りたたむ',
    'sidebar.groupChat': 'グループチャット',
    'sidebar.groupToggle': 'グループ',
    'sidebar.selectWaifus': 'グループチャットに参加するワイフを選択:',

    // Header
    'header.affection': '好感度',

    // Affection tiers
    'affection.icy': '冷たい',
    'affection.distant': 'よそよそしい',
    'affection.neutral': '普通',
    'affection.friendly': '親しみ',
    'affection.close': '親しい',
    'affection.attached': '愛着',
    'affection.devoted': '献身的',

    // Chat
    'chat.emptyIcon': '💬',
    'chat.emptyTitle': '{name} と会話',
    'chat.emptyTitleGroup': '{names} とのグループチャット',
    'chat.emptySubtitle': '会話を始めましょう!',
    'chat.inputPlaceholder': 'メッセージを入力…(/ でフォーカス)',
    'chat.send': '➤ 送信',
    'chat.sending': '⚙️ 送信中',
    'chat.inputHint': 'Enter で送信、Shift+Enter で改行',

    // Settings
    'settings.title': '設定',
    'settings.general': '一般',
    'settings.theme': 'テーマ',
    'settings.language': '言語',
    'settings.waifu': 'ワイフ',
    'settings.groupChat': 'グループチャット',
    'settings.groupChatDescription': '複数のワイフに一度にメッセージを送信します。彼女たちはお互いに反応し、後続のタスクを受け渡すことができます。',
    'settings.groupChatParticipants': '参加者',
    'settings.groupChatHint': 'デスクトップ版のグループチャット用に 2〜4 人を選択してください。',
    'settings.provider': 'プロバイダー',
    'settings.apiKey': 'API キー',
    'settings.exportData': 'データのエクスポート',
    'settings.exportDescription': 'チャット、記憶、ローカル設定を JSON ファイルに保存します。API キーは含まれません。',
    'settings.exportButton': 'JSON でエクスポート',
    'settings.importButton': 'JSON をインポート',
    'settings.importDescription': '以前にエクスポートしたファイルからチャット、記憶、ローカル設定を復元します。API キーは引き続き除外されます。',
    'settings.metricsTitle': 'Waifu パフォーマンス',
    'settings.metricsDescription': '応答時間、履歴、スパイクアラートを設定画面から確認できます。',
    'settings.metricsLatest': '最新',
    'settings.metricsAverage': '平均',
    'settings.metricsP95': 'P95',
    'settings.metricsAlerts': 'アラート',
    'settings.metricsHistory': '履歴',
    'settings.metricsEmpty': '応答時間データはまだありません。メッセージを数回送信すると、計測を開始します。',
    'settings.metricsThreshold': 'スパイクしきい値',
    'settings.maxIterations': '最大反復回数',
    'settings.maxIterationsDescription': '返信が強制的に停止されるまでに許可される AI/ツール呼び出しループの上限。',
    'settings.responseThreshold': '応答しきい値',
    'settings.responseThresholdDescription': 'スパイクアラートが発動する前のレイテンシー(ミリ秒)。',
    'settings.cancel': 'キャンセル',
    'settings.save': '保存',
    'settings.skipDemo': 'スキップ(デモ)',

    // Theme
    'theme.rainbowMode': 'レインボーモード',
    'theme.rainbowDesc': '色を自動で循環',
    'theme.presets': 'カラープリセット',
    'theme.presetsDesc': '既成パレットを適用してから、下の項目で微調整できます。',
    'theme.speed': '速度',
    'theme.saturation': '彩度',
    'theme.lightness': '明度',
    'theme.colors': 'カラー',
    'theme.primary': 'プライマリー',
    'theme.accent': 'アクセント',
    'theme.background': '背景',
    'theme.surface': 'サーフェス',
    'theme.text': 'テキスト',
    'theme.userBubble': 'ユーザー吹き出し',
    'theme.aiBubble': 'AI 吹き出し',
    'theme.surfaceAlt': '代替サーフェス',
    'theme.primaryRgb': 'プライマリー RGB',
    'theme.preview': 'プレビュー',
    'theme.previewUser': 'やあ、調子はどう?',
    'theme.previewAi': 'いい感じ!何を手伝える?',
    'theme.button': 'ボタン',
    'theme.resetDefaults': 'デフォルトに戻す',
    'theme.done': '完了',
    'preset.default': 'デフォルト',
    'preset.ocean': 'オーシャン',
    'preset.sunset': 'サンセット',
    'preset.emerald': 'エメラルド',
    'preset.rose': 'ローズ',
    'preset.cherryBlossom': '桜',
    'preset.lavender': 'ラベンダー',
    'preset.amber': 'アンバー',
    'preset.midnight': 'ミッドナイト',
    'preset.lightMode': 'ライトモード',
    'preset.rainbow': 'レインボー',
    'preset.cherryBlossomDark': '夜桜',
    'preset.dracula': 'ドラキュラ',
    'preset.nord': 'ノルド',
    'preset.tokyoNight': '東京ナイト',
    'preset.catppuccin': 'カトプチン',
    'preset.synthwave': 'シンセウェイブ',
    'preset.matrix': 'マトリックス',

    // Interface
    'interface.title': 'インターフェース',
    'interface.density': 'UI の詰め込み度',
    'interface.densityDesc': 'コンパクトモードはアプリ全体のパディングを詰めます。',
    'interface.densityCozy': 'ゆったり',
    'interface.densityCompact': 'コンパクト',
    'interface.radius': '角の丸み',
    'interface.radiusDesc': 'カード・吹き出し・ボタンの全体的な丸み。',
    'interface.radiusSharp': 'シャープ',
    'interface.radiusDefault': 'デフォルト',
    'interface.radiusRounded': '丸め',
    'interface.blur': 'ガラスのぼかし',
    'interface.blurDesc': 'フロスト表面の背景ぼかしの強さ。',
    'interface.petals': '桜の花びら',
    'interface.petalsDesc': '背景に舞い落ちる花びら。桜テーマとよく合います。',

    // Model Picker
    'model.title': 'モデルを選択',
    'model.description': '{provider} に保存された API キーでどのモデルを使うか選んでください。',
    'model.label': 'モデル',

    // Agent
    'agent.title': 'エージェントのアクセス権',
    'agent.description': 'エージェントがあなたのマシン上でどう振る舞うかを選択します。',
    'agent.askTitle': '実行前に確認',
    'agent.askDesc': '各コマンドを実行前に確認',
    'agent.autoTitle': '自動編集',
    'agent.autoDesc': '一般的なコマンド(読み取り、書き込み、ビルド)は自動実行 — その他は確認',
    'agent.fullTitle': 'フルアクセス',
    'agent.fullDesc': '確認なしで任意のコマンドを実行 — 慎重に使用してください',

    // Memory
    'memory.title': 'AI の記憶',
    'memory.entries': '{count} 件',
    'memory.description': 'AI がすべてのチャットで使う永続的な記憶。共有された内容(名前、好みなど)は自動的に保存されますが、手動でも追加できます。',
    'memory.labelPlaceholder': 'ラベル(例: favorite_language)',
    'memory.valuePlaceholder': '値(例: TypeScript)',
    'memory.add': '追加',
    'memory.empty': 'まだ記憶はありません。自然に会話すれば AI が重要な詳細を覚えます。上から手動で追加もできます。',
    'memory.close': '閉じる',
    'memory.clearAll': 'すべてクリア',

    // Toast
    'toast.memorySaved': '記憶を保存しました',
    'toast.memoriesCleared': 'すべての記憶をクリアしました',
    'toast.exportSaved': 'エクスポートを保存しました',
    'toast.exportFailed': 'エクスポートに失敗しました',
    'toast.importSaved': 'インポートが完了しました',
    'toast.importFailed': 'インポートに失敗しました',
    'toast.conversationExported': '会話をエクスポートしました',
    'toast.attachmentFailed': '添付に失敗しました',

    // AI tab
    'settings.refreshModels': '↻ モデル一覧を更新',
    'settings.modelsLoaded': '{count} 個のモデルを読み込みました',
    'settings.exportMarkdownTitle': '現在の会話をエクスポート',
    'settings.exportMarkdownDesc': '現在のチャットを Markdown として保存します。コーディングセッションの共有や PR への貼り付けに便利です。',
    'settings.exportMarkdownButton': '⬇ .md でエクスポート',

    // Mobile pairing
    'mobile.title': 'デスクトップ接続',
    'mobile.description': 'ローカルネットワーク経由でスマートフォンからリモートでチャットボットを使えるようにペアリングします。',
    'mobile.noDevice': 'デバイスが接続されていません',
    'mobile.connected': '接続済み: {device}',
    'mobile.showQr': 'QR コードを表示',
    'mobile.disconnect': '切断',
    'mobile.done': '完了',
    'mobile.connectTitle': 'モバイルを接続',
    'mobile.generating': 'QR コードを生成中…',
    'mobile.connectedHeading': '接続しました!',
    'mobile.scanHint': 'スマートフォンで SyntaxSenpai を開き、このコードをスキャンしてください。',
    'mobile.waitingDevice': 'デバイスを待っています…',
    'mobile.networkInterface': 'ネットワークインターフェース',
    'mobile.qrError': 'QR コードを生成できませんでした。デスクトップアプリが実行中か確認してください。',

    // Attachments + input chrome
    'input.attachImage': '画像を添付',
    'input.dropHint': '画像をドロップして添付',
    'input.removeAttachment': '{name} を削除',

    // Message actions
    'message.regenerate': '↻ 再生成',
    'message.delete': '🗑 削除',
    'message.regenerateTitle': 'この返信を再生成',
    'message.deleteTitle': 'このメッセージを削除',

    // Usage strip
    'usage.promptTokens': '↑ プロンプトトークン',
    'usage.completionTokens': '↓ 応答トークン',
    'usage.estCost': '推定コスト({currency})',

    // Shortcuts overlay
    'shortcuts.title': 'キーボードショートカット',
    'shortcuts.newChat': '新しいチャット',
    'shortcuts.openSettings': '設定を開く',
    'shortcuts.closeModal': 'ウィンドウを閉じる',
    'shortcuts.showOverlay': 'このショートカットを表示',
    'shortcuts.sendMessage': 'メッセージを送信',
    'shortcuts.newline': '改行を挿入',
    'shortcuts.gotIt': 'わかった',
  },
}

const SUPPORTED_LOCALES: Locale[] = ['en', 'zh', 'fr', 'ru', 'ja']
function loadInitialLocale(): Locale {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw && SUPPORTED_LOCALES.includes(raw as Locale)) return raw as Locale
  } catch { /* ignore */ }
  return 'en'
}

const locale = ref<Locale>(loadInitialLocale())

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
  { value: 'fr' as Locale, label: 'Français' },
  { value: 'ru' as Locale, label: 'Русский' },
  { value: 'ja' as Locale, label: '日本語' },
]

export function useI18n() {
  return {
    locale,
    setLocale,
    t,
    localeOptions,
  }
}
