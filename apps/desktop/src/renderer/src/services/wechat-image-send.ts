/** Renderer-side image send orchestration. The main process owns upload fallback. */

type SendReply = {
  success?: boolean
  error?: string
  deliveryMode?: 'image' | 'text_fallback'
  messageId?: number | null
  parts?: number
  imageError?: { code?: string; targetShape?: string }
}

type Invoke = (channel: string, payload: Record<string, unknown>) => Promise<SendReply>
type Render = (content: string, options: { title?: string }) => Promise<{
  base64: string
  width: number
  height: number
}>

export async function sendWeChatImageWithFallback(options: {
  invoke: Invoke
  render: Render
  toUserId: string
  content: string
  title?: string
}): Promise<string> {
  const { invoke, render, toUserId, content, title } = options
  let rendered: Awaited<ReturnType<Render>>
  try {
    rendered = await render(content, { title })
  } catch (renderError) {
    const reason = renderError instanceof Error ? renderError.message : String(renderError)
    try {
      const fallback = await invoke('wechat:send', { toUserId, kind: 'text', content })
      return fallback?.success
        ? `Could not render WeChat image (${reason}); sent content as text to ${toUserId} instead.`
        : `WeChat image rendering failed (${reason}); text fallback failed: ${fallback?.error ?? 'unknown'}`
    } catch (fallbackError) {
      return `WeChat image rendering failed (${reason}); text fallback failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`
    }
  }

  const res = await invoke('wechat:send', {
    toUserId,
    kind: 'image',
    imageBase64: rendered.base64,
    fallbackText: content,
  })
  if (!res?.success) return `WeChat send failed: ${res?.error ?? 'unknown'}`
  if (res.deliveryMode === 'text_fallback') {
    return `WeChat image upload failed (${res.imageError?.code ?? 'unknown'}, shape=${res.imageError?.targetShape ?? 'unknown'}); sent content as text to ${toUserId} in ${res.parts ?? 1} message(s) instead. No image was delivered.`
  }
  return `WeChat accepted image (${rendered.width}x${rendered.height}px) for ${toUserId}${res.messageId != null ? ` (messageId=${res.messageId})` : ''}.`
}
