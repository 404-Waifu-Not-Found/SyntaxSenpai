import { describe, expect, it, vi } from 'vitest'

import { sendWeChatImageWithFallback } from '../wechat-image-send'

const render = vi.fn(async () => ({ base64: 'abc', width: 640, height: 480 }))

describe('sendWeChatImageWithFallback', () => {
  it('passes original content to the main process and reports an accepted image ID', async () => {
    const invoke = vi.fn(async () => ({ success: true, deliveryMode: 'image' as const, messageId: 42 }))
    const result = await sendWeChatImageWithFallback({
      invoke, render, toUserId: 'peer', content: 'hello', title: 'Title',
    })
    expect(invoke).toHaveBeenCalledWith('wechat:send', {
      toUserId: 'peer', kind: 'image', imageBase64: 'abc', fallbackText: 'hello',
    })
    expect(result).toContain('messageId=42')
  })

  it('never claims an image was delivered when upload fell back to text', async () => {
    const invoke = vi.fn(async () => ({
      success: true, deliveryMode: 'text_fallback' as const, parts: 2,
      imageError: { code: 'CDN_CLIENT_ERROR', targetShape: 'opaque_param' },
    }))
    const result = await sendWeChatImageWithFallback({
      invoke, render, toUserId: 'peer', content: 'hello',
    })
    expect(result).toContain('No image was delivered')
    expect(result).toContain('2 message(s)')
    expect(result).toContain('opaque_param')
  })

  it('sends text if rendering the image itself fails', async () => {
    const invoke = vi.fn(async () => ({ success: true }))
    const result = await sendWeChatImageWithFallback({
      invoke,
      render: async () => { throw new Error('canvas unavailable') },
      toUserId: 'peer', content: 'hello',
    })
    expect(invoke).toHaveBeenCalledWith('wechat:send', {
      toUserId: 'peer', kind: 'text', content: 'hello',
    })
    expect(result).toContain('sent content as text')
  })

  it('reports both failures if rendering and text fallback fail', async () => {
    const result = await sendWeChatImageWithFallback({
      invoke: async () => ({ success: false, error: 'offline' }),
      render: async () => { throw new Error('canvas unavailable') },
      toUserId: 'peer', content: 'hello',
    })
    expect(result).toContain('text fallback failed: offline')
  })
})
