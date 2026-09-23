import { WeChatImageUploadError } from '@syntax-senpai/wechat-ilink'

type ImageErrorDetails = {
  stage: 'image_upload'
  code: string
  targetShape: string
  status: number | null
  responseBody: string | null
}

type DeliveryResult =
  | { success: true; deliveryMode: 'image'; messageId: number | null }
  | { success: true; deliveryMode: 'text_fallback'; messageId: number | null; parts: number; imageError: ImageErrorDetails }
  | { success: false; error: string; imageError: ImageErrorDetails; fallbackError?: string }

/** Only upload-stage failures are safe to retry as text; sendmessage may have succeeded. */
export async function deliverImageWithTextFallback(options: {
  sendImage: () => Promise<{ message_id?: number }>
  sendTextFallback: () => Promise<{ messageId: number | null; parts: number }>
  fallbackText: string
}): Promise<DeliveryResult> {
  try {
    const response = await options.sendImage()
    return { success: true, deliveryMode: 'image', messageId: response.message_id ?? null }
  } catch (err) {
    if (!(err instanceof WeChatImageUploadError)) throw err
    const imageError: ImageErrorDetails = {
      stage: err.stage,
      code: err.code,
      targetShape: err.targetShape,
      status: err.status ?? null,
      responseBody: err.responseBody ?? null,
    }
    if (!options.fallbackText.trim()) return { success: false, error: err.message, imageError }
    try {
      const { messageId, parts } = await options.sendTextFallback()
      return { success: true, deliveryMode: 'text_fallback', messageId, parts, imageError }
    } catch (fallbackErr) {
      const fallbackError = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)
      return {
        success: false,
        error: `Image upload failed (${err.code}); text fallback also failed: ${fallbackError}`,
        imageError,
        fallbackError,
      }
    }
  }
}
