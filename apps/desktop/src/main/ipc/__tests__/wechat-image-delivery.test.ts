import { describe, expect, it, vi } from 'vitest'
import { WeChatImageUploadError } from '@syntax-senpai/wechat-ilink'

import { deliverImageWithTextFallback } from '../wechat-image-delivery'

describe('deliverImageWithTextFallback', () => {
  it('returns the image message ID without sending text when upload succeeds', async () => {
    const sendTextFallback = vi.fn(async () => ({ messageId: 2, parts: 1 }))
    const result = await deliverImageWithTextFallback({
      sendImage: async () => ({ message_id: 1 }),
      sendTextFallback,
      fallbackText: 'original content',
    })
    expect(result).toEqual({ success: true, deliveryMode: 'image', messageId: 1 })
    expect(sendTextFallback).not.toHaveBeenCalled()
  })

  it('sends original content as text after a broken upload parameter', async () => {
    const sendTextFallback = vi.fn(async () => ({ messageId: 3, parts: 2 }))
    const result = await deliverImageWithTextFallback({
      sendImage: async () => { throw new WeChatImageUploadError('MISSING_UPLOAD_TARGET', 'invalid', 'invalid target') },
      sendTextFallback,
      fallbackText: 'original content',
    })
    expect(sendTextFallback).toHaveBeenCalledOnce()
    expect(result).toMatchObject({
      success: true, deliveryMode: 'text_fallback', messageId: 3, parts: 2,
      imageError: { stage: 'image_upload', code: 'MISSING_UPLOAD_TARGET', targetShape: 'invalid' },
    })
  })

  it('does not duplicate an image when sendmessage has an ambiguous failure', async () => {
    const sendTextFallback = vi.fn(async () => ({ messageId: 3, parts: 1 }))
    await expect(deliverImageWithTextFallback({
      sendImage: async () => { throw new Error('sendmessage connection lost') },
      sendTextFallback,
      fallbackText: 'original content',
    })).rejects.toThrow('sendmessage connection lost')
    expect(sendTextFallback).not.toHaveBeenCalled()
  })

  it('reports both image and text errors when fallback also fails', async () => {
    const result = await deliverImageWithTextFallback({
      sendImage: async () => { throw new WeChatImageUploadError('CDN_CLIENT_ERROR', 'opaque_param', 'HTTP 403', 403, 'bad signature') },
      sendTextFallback: async () => { throw new Error('WeChat offline') },
      fallbackText: 'original content',
    })
    expect(result).toMatchObject({
      success: false,
      imageError: { code: 'CDN_CLIENT_ERROR', targetShape: 'opaque_param', status: 403, responseBody: 'bad signature' },
      fallbackError: 'WeChat offline',
    })
  })
})
