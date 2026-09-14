import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import {
  createPromptImageTransformHandler,
  registerPromptImageTransform,
  type PromptImageAnalyzer,
} from '../src/host/prompt-transform.ts'
import { wrapImageDescriptions } from '../src/host/vision.ts'

const content = [
  { type: 'image' as const, mediaType: 'image/png', data: 'aGVsbG8=' },
  { type: 'text' as const, text: '看看这个' },
  { type: 'image' as const, mediaType: 'image/webp', data: 'd29ybGQ=' },
]

describe('session/prompt-image-transform handler (U-G-1)', () => {
  it('replaces image parts with the R1-9 template when analysis succeeds', async () => {
    const analyze: PromptImageAnalyzer = vi.fn(async (_ctx, _images) => ['第一张', '第二张'])
    const handler = createPromptImageTransformHandler({} as unknown as Context, analyze)

    const result = await handler({ agent: {}, content }, async () => undefined)

    expect(result).toEqual([{
      type: 'text',
      text: wrapImageDescriptions(['第一张', '第二张'], '看看这个'),
    }])
    expect(analyze).toHaveBeenCalledWith(
      expect.anything(),
      [
        { mediaType: 'image/png', data: 'aGVsbG8=' },
        { mediaType: 'image/webp', data: 'd29ybGQ=' },
      ],
    )
  })

  it('analyzes from an earlier plugin\'s resolved content instead of the original', async () => {
    const analyze: PromptImageAnalyzer = vi.fn(async () => ['替身图'])
    const handler = createPromptImageTransformHandler({} as unknown as Context, analyze)
    // An earlier plugin already replaced one image; the handler works on the
    // resolved remainder (one image + the earlier text).
    const earlier = [
      { type: 'text' as const, text: '第一张已经被别的插件转好了' },
      { type: 'image' as const, mediaType: 'image/png', data: 'cmVtYWlu' },
    ]

    const result = await handler({ agent: {}, content }, async () => earlier)

    expect(result).toEqual([{
      type: 'text',
      text: wrapImageDescriptions(['替身图'], '第一张已经被别的插件转好了'),
    }])
    expect(analyze).toHaveBeenCalledWith(
      expect.anything(),
      [{ mediaType: 'image/png', data: 'cmVtYWlu' }],
    )
  })

  it('throws (never sends) when analysis fails and never returns a partial transform', async () => {
    const analyze: PromptImageAnalyzer = vi.fn(async () => {
      throw new Error('vision-adam 分析失败: boom')
    })
    const handler = createPromptImageTransformHandler({} as unknown as Context, analyze)

    await expect(handler({ agent: {}, content }, async () => undefined))
      .rejects.toThrow('vision-adam 分析失败: boom')
  })

  it('returns undefined for text-only content (no interception)', async () => {
    const analyze: PromptImageAnalyzer = vi.fn(async () => [])
    const handler = createPromptImageTransformHandler({} as unknown as Context, analyze)

    const result = await handler(
      { agent: {}, content: [{ type: 'text' as const, text: '纯文本' }] },
      async () => undefined,
    )

    expect(result).toBeUndefined()
    expect(analyze).not.toHaveBeenCalled()
  })

  it('skips image parts whose media type the vision chain rejects', async () => {
    const analyze: PromptImageAnalyzer = vi.fn(async () => [])
    const handler = createPromptImageTransformHandler({} as unknown as Context, analyze)

    const result = await handler(
      {
        agent: {},
        content: [
          { type: 'image' as const, mediaType: 'image/tiff', data: 'aGVsbG8=' },
          { type: 'text' as const, text: 'hi' },
        ],
      },
      async () => undefined,
    )

    expect(result).toBeUndefined()
    expect(analyze).not.toHaveBeenCalled()
  })

  it('registers a listener under the waterfall event name', () => {
    const listeners = new Map<string, () => unknown>()
    const ctx = {
      on: (name: string, handler: () => unknown) => { listeners.set(name, handler) },
    } as unknown as Context
    registerPromptImageTransform(ctx)
    expect(listeners.has('session/prompt-image-transform')).toBe(true)
  })
})
