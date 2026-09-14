import { describe, expect, it } from 'vitest'
import { VISION_DEFAULTS, VISION_DEFAULT_QUESTION, wrapImageDescriptions } from '../src/host/vision.ts'

describe('wrapImageDescriptions (R1-9 template)', () => {
  it('wraps a single description with the heading and the user text', () => {
    const text = wrapImageDescriptions(['绿色背景，左上角红色方块，白色文字 V4F-73。'], '这图讲了什么？')
    expect(text).toContain('用户附带了 1 张图片，以下为各图片的描述（vision-adam 生成）：')
    expect(text).toContain('[图片 1] 绿色背景，左上角红色方块，白色文字 V4F-73。')
    expect(text).toContain('用户原文：\n这图讲了什么？')
    expect(text.startsWith('用户附带了')).toBe(true)
  })

  it('wraps multiple descriptions in order with numbered segments', () => {
    const text = wrapImageDescriptions(['第一张', '第二张'], '对比这两张')
    expect(text).toContain('用户附带了 2 张图片，以下为各图片的描述（vision-adam 生成）：')
    expect(text.indexOf('[图片 1]')).toBeLessThan(text.indexOf('[图片 2]'))
    expect(text).toContain('[图片 1] 第一张')
    expect(text).toContain('[图片 2] 第二张')
    expect(text).toContain('用户原文：\n对比这两张')
  })

  it('omits the 用户原文 segment entirely for pure-image messages (no trailing blank line)', () => {
    const text = wrapImageDescriptions(['只有图'], '')
    expect(text).toContain('[图片 1] 只有图')
    expect(text).not.toContain('用户原文')
    expect(text.endsWith('只有图')).toBe(true)
    expect(text.trimEnd()).toBe(text)
  })

  it('trims surrounding whitespace from the original text', () => {
    const text = wrapImageDescriptions(['描述'], '  带空格的原文  ')
    expect(text).toContain('用户原文：\n带空格的原文')
    expect(text).not.toContain('  \n')
  })

  it('exposes the R1-4/R1-5 defaults and the default question', () => {
    expect(VISION_DEFAULTS).toMatchObject({
      model: 'deepseek-v4.1-flash',
      baseURL: 'https://opencode.ai/zen/go/v1',
      apiKeyEnv: 'OPENCODE_GO_API_KEY',
      maxTokens: 2000,
    })
    expect(VISION_DEFAULT_QUESTION).toContain('图片')
  })
})
